"""Find the Z-Anatomy joint centres, so its muscles can be read through the
same bone frames the production rig uses.

The two bodies do not stand the same way: the atlas arm hangs almost straight
down, the MakeHuman base arm is out at forty degrees, and the atlas forearm is
supinated. Comparing them in world space is therefore useless. Comparing them
in bone space is exact, and bone space needs joint centres.

A joint centre here is the centroid of the cap of bone nearest the joint. That
is not a surgeon's definition, but both bodies are measured the same way and
only the ratio along the bone matters downstream.

Run: blender -b <full Z-Anatomy Startup.blend> --python tools/blender/export_atlas_joints.py
"""
import bpy
import json
import os

from mathutils import Vector

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
OUT = os.path.join(ROOT, 'assets-src', 'anatomy-reference', 'atlas-joints.json')

# name of the bone, which end of it, and how deep a cap to average over.
# 'hi' is the superior end in the atlas's Z-up space, 'lo' the inferior one.
CAPS = {
    'shoulder': [('Humerus.%s', 'hi', 0.030)],
    'elbow': [('Humerus.%s', 'lo', 0.022), ('Ulna.%s', 'hi', 0.022)],
    'wrist': [('Radius.%s', 'lo', 0.018), ('Ulna.%s', 'lo', 0.018)],
    'hip': [('Femur.%s', 'hi', 0.026)],
    'knee': [('Femur.%s', 'lo', 0.026), ('Tibia.%s', 'hi', 0.026)],
    'ankle': [('Tibia.%s', 'lo', 0.022)],
}


def cap_centre(obj, end, depth):
    """Centroid of the vertices within `depth` of one end of a bone."""
    points = [obj.matrix_world @ v.co for v in obj.data.vertices]
    zs = [p.z for p in points]
    edge = max(zs) if end == 'hi' else min(zs)
    keep = [p for p in points
            if (edge - p.z if end == 'hi' else p.z - edge) <= depth]
    total = Vector((0, 0, 0))
    for p in keep:
        total += p
    return total / len(keep), len(keep)


joints = {}
for side in ('l', 'r'):
    for name, parts in CAPS.items():
        found = []
        for pattern, end, depth in parts:
            obj = bpy.data.objects.get(pattern % side)
            if obj is None or obj.type != 'MESH':
                raise RuntimeError('missing atlas bone ' + (pattern % side))
            centre, count = cap_centre(obj, end, depth)
            found.append(centre)
            print('  %-10s %-14s %4d verts  %s' %
                  (name, pattern % side, count,
                   ' '.join('%.4f' % c for c in centre)))
        mean = sum(found, Vector((0, 0, 0))) / len(found)
        joints['%s.%s' % (name, side.upper())] = [mean.x, mean.y, mean.z]

payload = {
    'source': 'Z-Anatomy / BodyParts3D skeletal system',
    'license': 'CC BY-SA 4.0 / CC BY-SA 2.1 Japan',
    'space': 'atlas metres, Z up, +X left, +Y posterior',
    'joints': joints,
}
os.makedirs(os.path.dirname(OUT), exist_ok=True)
with open(OUT, 'w', encoding='utf8') as handle:
    json.dump(payload, handle, indent=1)
print('WROTE', OUT, 'WITH', len(joints), 'JOINT CENTRES')
