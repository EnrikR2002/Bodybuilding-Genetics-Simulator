"""Answer the skin's questions with real anatomy.

`export-anatomy-rays.mjs` wrote one ray per skin vertex, aimed inward at the
body in the frame of the bone that vertex sits on. Each ray is fired at the
Z-Anatomy dissection here. The first thing it touches is, by definition, the
structure that shapes the skin at that point: a muscle belly, the flat tendon
it ends in, or bare bone where nothing covers the skeleton at all.

That single answer carries everything the region bake could never get from
hand-typed arcs:

  * which muscle owns this patch of skin, with its real borders;
  * how far that structure stands off its own bone, which is the relief the
    skin has to sit on;
  * which way that surface faces, which is the direction a belly grows in;
  * how far along its own length the hit sits, which is what an insertion
    slider slides.

Run:
  blender -b <Z-Anatomy Startup.blend> --python tools/blender/project_anatomy_rays.py
"""
import bpy
import json
import os
import struct

from mathutils import Vector
from mathutils.bvhtree import BVHTree

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
BUILD = os.path.join(ROOT, 'assets-src', 'anatomy-reference', 'build')
RAYS = os.path.join(BUILD, 'anatomy-rays.bin')
META = os.path.join(BUILD, 'anatomy-rays.json')
OUT = os.path.join(BUILD, 'anatomy-hits.bin')

# Every structure that reaches the skin somewhere on a lean, trained body.
# Left of the colon is the name the production muscle map uses; right of it
# are the Z-Anatomy object names, matched as lowercase substrings.
GROUPS = {
    # ---- shoulder and upper arm ----
    'deltoid_ant': ('clavicular part of deltoid',),
    'deltoid_lat': ('acromial part of deltoid',),
    'deltoid_post': ('scapular spinal part of deltoid',),
    'biceps_long': ('long head of biceps brachii',),
    'biceps_short': ('short head of biceps brachii', 'coracobrachialis'),
    'brachialis': ('brachialis muscle',),
    'triceps_long': ('long head of triceps brachii',),
    'triceps_lat': ('lateral head of triceps brachii',),
    'triceps_med': ('medial head of triceps brachii', 'anconeus muscle'),
    # ---- forearm ----
    'forearm_ext': ('brachioradialis muscle', 'extensor carpi radialis longus',
                    'extensor carpi radialis brevis', 'extensor digitorum.',
                    'humeral head of extensor carpi ulnaris',
                    'ulnar head of extensor carpi ulnaris',
                    'abductor pollicis longus', 'extensor pollicis longus',
                    'extensor pollicis brevis'),
    'forearm_flex': ('superficial head of pronator teres', 'flexor carpi radialis',
                     'palmaris longus', 'humeral head of flexor carpi ulnaris',
                     'ulnar head of flexor carpi ulnaris',
                     'humero-ulnar head of flexor digitorum superficialis',
                     'radial head of flexor digitorum superficialis'),
    # ---- chest, trunk, neck ----
    'pec_upper': ('clavicular head of pectoralis major',),
    'pec_lower': ('sternocostal head of pectoralis major',
                  'abdominal part of pectoralis major'),
    'serratus': ('serratus anterior',),
    'obliques': ('external abdominal oblique',),
    'rectus_abs': ('rectus abdominis',),
    'sternomastoid': ('sternocleidomastoid muscle',),
    # ---- back ----
    'lat': ('latissimus dorsi',),
    'trap_upper': ('descending part of trapezius',),
    'trap_mid': ('transverse part of trapezius', 'ascending part of trapezius'),
    'rhomboids': ('rhomboid major', 'rhomboid minor'),
    'teres': ('teres major muscle', 'teres minor muscle'),
    'infraspinatus': ('infraspinatus muscle',),
    'erectors': ('longissimus thoracis', 'iliocostalis thoracis',
                 'iliocostalis lumborum', 'spinalis thoracis',
                 'multifidus lumborum', 'posterior layer of thoracolumbar fascia'),
    # ---- hip and thigh ----
    'glutes': ('gluteus maximus',),
    'glute_med': ('gluteus medius',),
    'it_band': ('iliotibial tract',),
    'rectus_fem': ('rectus femoris',),
    'vastus_lat': ('vastus lateralis',),
    'vastus_med': ('vastus medialis',),
    'adductors': ('adductor longus', 'adductor magnus', 'adductor brevis',
                  'gracilis muscle', 'pectineus muscle'),
    'sartorius': ('sartorius muscle',),
    'ham_lat': ('long head of biceps femoris', 'short head of biceps femoris'),
    'ham_med': ('semitendinosus', 'semimembranosus'),
    # ---- calf ----
    'gastroc_med': ('medial head of gastrocnemius',),
    'gastroc_lat': ('lateral head of gastrocnemius',),
    'soleus': ('soleus muscle',),
    'tibialis': ('tibialis anterior', 'extensor digitorum longus.'),
    'peroneals': ('fibularis longus muscle', 'fibularis brevis muscle'),
    # ---- bone that reaches the skin ----
    # A collarbone, a shin and a hip crest are the strongest signal that a
    # body is a body. They are in the dissection too, so they cost nothing.
    'clavicle_b': ('clavicle.',),
    'sternum_b': ('body of sternum', 'manubrium of sternum'),
    'scapula_b': ('scapula.',),
    'iliac_b': ('hip bone.',),
    'patella_b': ('patella.',),
    'tibia_b': ('tibia.',),
    'ribs_b': ('rib ', 'costal cartilage'),
}

SKIP = ('bursa', 'sheath', 'tendon sheath', '.o1', '.el', '.ol', '.j',
        'region', 'insertion')


def wanted(obj):
    if obj.type != 'MESH' or len(obj.data.vertices) < 40:
        return None
    name = obj.name.lower().replace('(', '').replace(')', '')
    if any(s in name for s in SKIP):
        return None
    for key, terms in GROUPS.items():
        if any(term in name for term in terms):
            return key
    return None


# ---------------------------------------------------------------------------
# one BVH over the whole dissection, plus a lookup from face to muscle
# ---------------------------------------------------------------------------
print('collecting muscle geometry')
verts = []
faces = []
face_group = []
group_ids = {key: i for i, key in enumerate(GROUPS)}
group_points = {key: [] for key in GROUPS}
found = set()

for obj in bpy.data.objects:
    key = wanted(obj)
    if key is None:
        continue
    found.add(key)
    base = len(verts)
    matrix = obj.matrix_world
    mesh = obj.data
    for v in mesh.vertices:
        verts.append(matrix @ v.co)
    gid = group_ids[key]
    for poly in mesh.polygons:
        loop = [base + i for i in poly.vertices]
        # BVHTree.FromPolygons accepts n-gons, but fanning here keeps the
        # face-to-muscle lookup a plain flat list.
        for i in range(1, len(loop) - 1):
            faces.append((loop[0], loop[i], loop[i + 1]))
            face_group.append(gid)
    side = 'R' if obj.name.lower().endswith('.r') else 'L'
    group_points[key].append((side, base, len(mesh.vertices)))

missing = sorted(set(GROUPS) - found)
if missing:
    print('WARNING missing groups:', ', '.join(missing))
print('  %d structures, %d vertices, %d triangles'
      % (len(found), len(verts), len(faces)))

tree = BVHTree.FromPolygons(verts, faces, all_triangles=True, epsilon=0.0)


# ---------------------------------------------------------------------------
# each muscle's own long axis, so a hit can report how far along it landed
# ---------------------------------------------------------------------------
def long_axis(points):
    """Principal direction of a point cloud, by power iteration on its
    covariance. Three passes is plenty: a muscle belly is not a sphere."""
    n = len(points)
    centre = Vector((0, 0, 0))
    for p in points:
        centre += p
    centre /= n
    axis = Vector((0, 0, 1))
    for _ in range(24):
        nxt = Vector((0, 0, 0))
        for p in points:
            d = p - centre
            nxt += d * d.dot(axis)
        if nxt.length < 1e-12:
            break
        axis = nxt.normalized()
    lo = min((p - centre).dot(axis) for p in points)
    hi = max((p - centre).dot(axis) for p in points)
    return centre, axis, lo, hi


axes = {}
for key, spans in group_points.items():
    for side in ('L', 'R'):
        pts = []
        for s, base, count in spans:
            if s != side:
                continue
            pts.extend(verts[base:base + count])
        if len(pts) < 8:
            continue
        centre, axis, lo, hi = long_axis(pts)
        # Point every axis the same way — superior to inferior — so that a
        # muscle's zero end is always the one nearer the head. Which end is
        # origin and which is insertion is decided in the region table, not
        # here; this only has to be consistent.
        if axis.z > 0:
            axis = -axis
            lo, hi = -hi, -lo
        axes[(key, side)] = (centre, axis, lo, hi)

# ---------------------------------------------------------------------------
# fire the rays
# ---------------------------------------------------------------------------
# One hit is not enough. A dissection has sheets: the oblique's aponeurosis is
# draped over the whole rectus abdominis, the iliotibial tract runs down the
# outside of the vastus lateralis, and the thoracolumbar fascia covers the
# erectors. Stopping at the first surface names the sheet and never names the
# muscle. So the ray is marched through everything it meets and the whole
# stack is reported; which structure actually owns that patch of skin is
# decided in the bake, where the rule can be stated in one place.
STACK = 6
EPS = 0.0006

meta = json.load(open(META, encoding='utf8'))
stride = meta['stride']
raw = open(RAYS, 'rb').read()
count = meta['count']
rays = struct.unpack('<%df' % (count * stride), raw)
print('casting %d rays' % count)

OUT_STRIDE = 6 * STACK
blank = (-1.0, 0.0, 0.0, 0.0, 0.0, 0.0)
out = []
hit_count = 0
deep = 0
for i in range(count):
    row = rays[i * stride:(i + 1) * stride]
    side = 'L' if row[2] < 0.5 else 'R'
    origin = Vector((row[6], row[7], row[8]))
    direction = Vector((row[9], row[10], row[11]))
    travelled = 0.0
    seen = {}
    order = []
    for _ in range(STACK * 3):
        hit = tree.ray_cast(origin, direction, 1.2 - travelled)
        if hit[0] is None:
            break
        location, normal, index, distance = hit
        gid = face_group[index]
        radius = meta['standoff'] - (travelled + distance)
        if gid not in seen:
            key = list(GROUPS)[gid]
            entry = axes.get((key, side))
            if entry is None:
                along = 0.5
            else:
                centre, axis, lo, hi = entry
                along = ((location - centre).dot(axis) - lo) / max(hi - lo, 1e-6)
            seen[gid] = (float(gid), radius, along, normal.x, normal.y, normal.z)
            order.append(gid)
            if len(order) >= STACK:
                break
        step = distance + EPS
        origin = origin + direction * step
        travelled += step
    if order:
        hit_count += 1
        if len(order) > 1:
            deep += 1
    stack = [seen[g] for g in order] + [blank] * (STACK - len(order))
    for rec in stack:
        out.append(rec)

with open(OUT, 'wb') as handle:
    for row in out:
        handle.write(struct.pack('<6f', *row))

with open(os.path.join(BUILD, 'anatomy-hits.json'), 'w', encoding='utf8') as handle:
    json.dump({
        'count': count,
        'stack': STACK,
        'stride': OUT_STRIDE,
        'fields': ['group', 'radius', 'along', 'nx', 'ny', 'nz'],
        'groups': list(GROUPS),
        'source': 'Z-Anatomy / BodyParts3D',
        'license': 'CC BY-SA 4.0 / CC BY-SA 2.1 Japan',
    }, handle, indent=1)

print('WROTE %s  %d of %d rays hit anatomy, %d passed through more than one layer'
      % (OUT, hit_count, count, deep))
