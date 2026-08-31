"""Project separated Z-Anatomy back muscles onto the MakeHuman authoring cage.

The output records the distance to each named superficial muscle.  A separate
Node authoring step turns ownership changes into a topology-compatible sculpt;
keeping projection and sculpt generation separate makes the anatomical source
auditable and the artistic strength easy to revise.
"""
import bpy
import json
import os
from mathutils import Vector
from mathutils.bvhtree import BVHTree

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
NEUTRAL = os.path.join(ROOT, 'assets-src', 'authoring', 'neutral-cage.obj')
OUT = os.path.join(ROOT, 'assets-src', 'anatomy-reference', 'back-cage-map.json')

SCALE = 10.57
OFFSET_Y = -8.045
OFFSET_Z = 0.15

GROUPS = {
    'lat': ('latissimus dorsi muscle',),
    'trap_upper': ('descending part of trapezius muscle',),
    'trap_mid': ('transverse part of trapezius muscle',
                 'ascending part of trapezius muscle'),
    'rhomboids': ('rhomboid major muscle', 'rhomboid minor muscle'),
    'teres': ('teres major muscle', 'teres minor muscle'),
    # The compact extraction joins the four longitudinal erector columns into
    # one bilateral object, while the full atlas retains their individual
    # names. Accept both representations so this remains reproducible from
    # either source file.
    'erectors': ('erector spinae', 'longissimus thoracis muscle',
                 'iliocostalis thoracis muscle',
                 'iliocostalis lumborum muscle', 'spinalis thoracis muscle'),
}


def read_positions(path):
    verts = []
    with open(path, encoding='utf8') as handle:
        for line in handle:
            if line.startswith('v '):
                p = line.split()
                verts.append((float(p[1]), float(p[2]), float(p[3])))
    return verts


def to_reference(p):
    return Vector((p[0] / SCALE, -(p[2] - OFFSET_Z) / SCALE,
                   (p[1] - OFFSET_Y) / SCALE))


def bvh(obj):
    verts = [obj.matrix_world @ v.co for v in obj.data.vertices]
    faces = [list(poly.vertices) for poly in obj.data.polygons]
    return BVHTree.FromPolygons(verts, faces, all_triangles=False)


catalog = {}
for key, terms in GROUPS.items():
    catalog[key] = {'L': [], 'R': []}
    for obj in bpy.data.objects:
        if obj.type != 'MESH':
            continue
        name = obj.name.lower().replace('(', '').replace(')', '')
        if not any(term in name for term in terms):
            continue
        side = 'L' if name.endswith('.l') else 'R' if name.endswith('.r') else None
        tree = bvh(obj)
        if side:
            catalog[key][side].append(tree)
        elif key == 'erectors':
            # The extracted Erector spinae.j object spans both sides.
            catalog[key]['L'].append(tree)
            catalog[key]['R'].append(tree)

missing = [f'{key}.{side}' for key, sides in catalog.items()
           for side, trees in sides.items() if not trees]
if missing:
    raise RuntimeError('Missing Z-Anatomy back objects: ' + ', '.join(missing))

records = []
for index, p in enumerate(read_positions(NEUTRAL)):
    # Posterior torso only. The pose mismatch is small here; it is large in
    # the arms, which are intentionally left to the rig-local region maps.
    if p[1] < 1.15 or p[1] > 6.45 or p[2] > 0.35 or abs(p[0]) > 2.85:
        continue
    side = 'L' if p[0] >= 0 else 'R'
    q = to_reference(p)
    distances = {}
    surface_dm = {}
    for key, sides in catalog.items():
        hits = [hit for tree in sides[side]
                if (hit := tree.find_nearest(q)) and hit[3] is not None]
        best = min(hits, key=lambda hit: hit[3]) if hits else None
        if best is not None:
            distances[key] = round(best[3], 7)
            # Only the posterior depth is transferred into the body cage. X/Y
            # remain on the production topology, avoiding pose/proportion
            # drift while retaining each atlas muscle's actual surface plane.
            surface_dm[key] = round(-best[0].y * SCALE + OFFSET_Z, 7)
    if distances and min(distances.values()) < 0.060:
        records.append({'v': index, 'side': side, 'distance_m': distances,
                        'surface_z_dm': surface_dm})

payload = {
    'source': 'Z-Anatomy / BodyParts3D separated superficial back muscles',
    'license': 'CC BY-SA 4.0 / CC BY-SA 2.1 Japan',
    'transform': {'scale': SCALE, 'offsetY': OFFSET_Y, 'offsetZ': OFFSET_Z},
    'groups': list(GROUPS),
    'records': records,
}
with open(OUT, 'w', encoding='utf8') as handle:
    json.dump(payload, handle, separators=(',', ':'))
print('WROTE', OUT, 'WITH', len(records), 'POSTERIOR CAGE VERTICES')
