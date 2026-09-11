"""Blender half of the Freeman anatomy projection.

`tools/bake-freeman-anatomy.mjs` drives this file in two stages. Both run in
background mode; neither touches the Freeman sculpt or its bake.

extract  (run on the Z-Anatomy Startup.blend)
    Writes every structure the projection may need to one flat cache:
    muscles and bones (evaluated meshes, world space), the dissection's skin
    surface ("Regions of human body"), the origin/insertion patches
    ("Muscular insertions", *.ol / *.el objects) and the bone landmark
    markers ("Bonus collection", two-vertex *.j objects).
    Coordinates are converted to the Freeman convention on the way out:
    centimetres, Y up, +Z forward, +X = the body's left.

        blender -b Startup.blend --python project_freeman_anatomy.py -- extract <out.json> <out.bin>

cast  (run on an empty scene: --factory-startup)
    Reads the atlas triangles after `bake-freeman-anatomy.mjs` has warped
    them into the Freeman body, and one query ray per Freeman vertex. Every
    ray is marched through the warped dissection and reports a stack of the
    first distinct structures it enters, with the entry depth and the
    thickness it measured through each. Which one owns the skin is decided
    in the node bake, where the rules live in one place.

        blender -b --factory-startup --python project_freeman_anatomy.py -- cast <dir>

Z-Anatomy / BodyParts3D: CC BY-SA 4.0 / CC BY-SA 2.1 Japan.
"""
import bpy
import json
import os
import struct
import sys

import numpy as np

ARGS = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
STAGE = ARGS[0] if ARGS else ''

# Names never worth a triangle in the cache: sheets the skin does not show,
# sacs, sheaths, label objects and everything inside the head.
SKIP = ('bursa', 'sheath', 'fascia', 'retinacul', 'septum', 'aponeurosis',
        'ligament', 'platysma', 'linea alba', 'hairs', 'tooth', 'molar',
        'incisor', 'canine', 'premolar', 'incus', 'malleus', 'stapes',
        'system.g', 'tongue', 'glossus', 'pharyn', 'aryt', 'cricoid',
        'thyroid cartilage', 'epiglott', 'palat', 'conch', 'nasal', 'orbic',
        'oculi', 'rectus muscle', 'superior oblique muscle',
        'inferior oblique muscle', 'levator palpebrae',
        'tarsus', 'trochlea', 'tendinous ring', 'ethmoid', 'vomer', 'sinus')
# Names that contain a SKIP word but are muscles the skin shows.
KEEP = ('tensor fasciae latae', 'external abdominal oblique')


def base_name(name):
    """'(Adductor minimus).l' -> ('Adductor minimus', 'L')."""
    side = ''
    stem = name
    if len(name) > 2 and name[-2] == '.':
        tag = name[-1]
        if tag in ('l', 'r'):
            side = tag.upper()
            stem = name[:-2]
    return stem.replace('(', '').replace(')', '').strip(), side


def to_freeman(co):
    """Atlas metres, Z up, +Y posterior -> cm, Y up, +Z anterior."""
    out = np.empty_like(co)
    out[:, 0] = co[:, 0] * 100.0
    out[:, 1] = co[:, 2] * 100.0
    out[:, 2] = -co[:, 1] * 100.0
    return out


def mesh_arrays(obj, depsgraph):
    ev = obj.evaluated_get(depsgraph)
    me = ev.to_mesh()
    me.calc_loop_triangles()
    nv = len(me.vertices)
    nt = len(me.loop_triangles)
    co = np.empty(nv * 3, dtype=np.float32)
    me.vertices.foreach_get('co', co)
    co = co.reshape(-1, 3)
    tri = np.empty(nt * 3, dtype=np.int32)
    me.loop_triangles.foreach_get('vertices', tri)
    ev.to_mesh_clear()
    m = np.array(obj.matrix_world, dtype=np.float64)
    world = (co.astype(np.float64) @ m[:3, :3].T) + m[:3, 3]
    return to_freeman(world).astype(np.float32), tri


def extract(out_json, out_bin):
    depsgraph = bpy.context.evaluated_depsgraph_get()
    records = []
    chunks = []
    offset = 0

    def put(arr):
        nonlocal offset
        data = arr.tobytes()
        chunks.append(data)
        start = offset
        offset += len(data)
        return start

    for obj in bpy.data.objects:
        if obj.type != 'MESH':
            continue
        cols = [c.name for c in obj.users_collection]
        low = obj.name.lower()
        kind = None
        if '2: Muscular insertions' in cols:
            kind = 'patch'
        elif '9: Regions of human body' in cols:
            if len(obj.data.vertices) >= 10 and 'hair' not in low:
                kind = 'skin'
        elif 'Bonus collection' in cols and low.endswith('.j') and len(obj.data.vertices) == 2:
            kind = 'marker'
        elif '4: Muscular system' in cols or '1: Skeletal system' in cols:
            skipped = any(s in low for s in SKIP) and not any(k in low for k in KEEP)
            if len(obj.data.vertices) >= 40 and not skipped:
                if not (low.endswith('.j') or low.endswith('.i') or low.endswith('.g')):
                    kind = 'muscle' if '4: Muscular system' in cols else 'bone'
        if kind is None:
            continue
        pos, tri = mesh_arrays(obj, depsgraph)
        if kind == 'marker':
            # A marker is a two-vertex label line; the end nearest the bone is
            # the one with the lower index in every sample we checked, but the
            # node side takes both and decides against the bone surface.
            tri = np.zeros(0, dtype=np.int32)
        if kind in ('muscle', 'bone', 'skin') and len(tri) == 0:
            continue
        stem, side = base_name(obj.name)
        records.append({
            'name': obj.name, 'base': stem, 'side': side, 'kind': kind,
            'cols': [c for c in cols if not c[0].isdigit()][:4],
            'v': put(pos), 'nv': int(len(pos)),
            't': put(tri.astype(np.uint32)), 'nt': int(len(tri) // 3),
        })

    with open(out_bin, 'wb') as fh:
        for c in chunks:
            fh.write(c)
    with open(out_json, 'w', encoding='utf8') as fh:
        json.dump({
            'source': 'Z-Anatomy / BodyParts3D',
            'license': 'CC BY-SA 4.0 / CC BY-SA 2.1 Japan',
            'space': 'cm, Y up, +Z anterior, +X body left (converted from atlas metres)',
            'objects': records,
        }, fh)
    print('EXTRACTED %d objects, %.1f MB' % (len(records), offset / 1048576))


# ---------------------------------------------------------------------------
# cast
# ---------------------------------------------------------------------------
STACK = 5          # distinct structures reported per ray
EPS = 0.02         # cm: step past a surface before casting again


def cast(folder):
    from mathutils import Vector
    from mathutils.bvhtree import BVHTree

    meta = json.load(open(os.path.join(folder, 'cast.json'), encoding='utf8'))
    raw = np.fromfile(os.path.join(folder, 'cast-verts.bin'), dtype=np.float32).reshape(-1, 3)
    tris = np.fromfile(os.path.join(folder, 'cast-tris.bin'), dtype=np.uint32).reshape(-1, 3)
    owner = np.fromfile(os.path.join(folder, 'cast-owner.bin'), dtype=np.uint16)
    rays = np.fromfile(os.path.join(folder, 'cast-rays.bin'), dtype=np.float32).reshape(-1, 7)
    reach = float(meta['reach'])
    print('building BVH over %d triangles' % len(tris))
    verts = [Vector(p) for p in raw.tolist()]
    tree = BVHTree.FromPolygons(verts, tris.tolist(), all_triangles=True, epsilon=0.0)

    # per ray: STACK x (structure id, entry depth, thickness, facing)
    out = np.full((len(rays), STACK, 4), -1.0, dtype=np.float32)
    hits = 0
    for i, row in enumerate(rays.tolist()):
        origin = Vector(row[0:3])
        direction = Vector(row[3:6])
        start = row[6]                    # how far outside the skin the ray starts
        travelled = 0.0
        open_at = {}                      # structure -> depth where the ray entered it
        found = []
        o = origin
        for _ in range(STACK * 6):
            left = reach + start - travelled
            if left <= 0:
                break
            loc, nrm, idx, dist = tree.ray_cast(o, direction, left)
            if loc is None:
                break
            sid = int(owner[idx])
            depth = travelled + dist - start
            entering = nrm.dot(direction) < 0
            if entering:
                if sid not in open_at and all(f[0] != sid for f in found):
                    open_at[sid] = depth
                    found.append([sid, depth, -1.0, -nrm.dot(direction)])
            else:
                if sid in open_at:
                    for f in found:
                        if f[0] == sid and f[2] < 0:
                            f[2] = depth - f[1]
                    del open_at[sid]
                elif all(f[0] != sid for f in found):
                    # started inside (the skin cut through it): entry at the skin
                    found.append([sid, max(0.0, -start), depth + start, 0.0])
            step = dist + EPS
            o = o + direction * step
            travelled += step
            if len(found) >= STACK and not open_at:
                break
        if found:
            hits += 1
            for k, f in enumerate(found[:STACK]):
                out[i, k] = f
    out.tofile(os.path.join(folder, 'cast-hits.bin'))
    print('CAST %d rays, %d hit' % (len(rays), hits))


if STAGE == 'extract':
    extract(ARGS[1], ARGS[2])
elif STAGE == 'cast':
    cast(ARGS[1])
else:
    print('usage: -- extract <json> <bin> | -- cast <dir>')
