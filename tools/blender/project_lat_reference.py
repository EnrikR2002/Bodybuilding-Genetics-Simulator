"""Project Z-Anatomy's left/right lat geometry onto the app control cage."""
import bpy
import json
import math
import os
from mathutils import Vector
from mathutils.bvhtree import BVHTree

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
NEUTRAL = os.path.join(ROOT, 'assets-src', 'authoring', 'neutral-cage.obj')
OUT = os.path.join(ROOT, 'assets-src', 'anatomy-reference', 'lat-cage-map.json')

# Fit measured from the atlas lat bounds to the neutral cage's existing
# axilla/waist landmarks. Z-Anatomy is metres/Z-up; the app is decimetres/Y-up.
SCALE = 10.57
OFFSET_Y = -8.045
OFFSET_Z = 0.15


def cage_positions(path):
    out = []
    with open(path, encoding='utf8') as handle:
        for line in handle:
            if line.startswith('v '):
                p = line.split()
                out.append((float(p[1]), float(p[2]), float(p[3])))
    return out


def bvh_for(obj):
    verts = [obj.matrix_world @ v.co for v in obj.data.vertices]
    faces = [list(p.vertices) for p in obj.data.polygons]
    return BVHTree.FromPolygons(verts, faces, all_triangles=False)


lat_l = bpy.data.objects.get('Latissimus dorsi muscle.l')
lat_r = bpy.data.objects.get('Latissimus dorsi muscle.r')
if not lat_l or not lat_r:
    raise RuntimeError('Z-Anatomy lat objects are missing')
bvhs = {'L': bvh_for(lat_l), 'R': bvh_for(lat_r)}


def to_reference(p):
    # Inverse of: mx=x*S; my=z*S+OY; mz=-y*S+OZ.
    return Vector((p[0] / SCALE, -(p[2] - OFFSET_Z) / SCALE,
                   (p[1] - OFFSET_Y) / SCALE))


def smooth(a, b, x):
    t = max(0.0, min(1.0, (x - a) / (b - a)))
    return t * t * (3.0 - 2.0 * t)


records = []
distances = []
for index, p in enumerate(cage_positions(NEUTRAL)):
    side = 'L' if p[0] >= 0 else 'R'
    hit = bvhs[side].find_nearest(to_reference(p))
    if hit is None:
        continue
    nearest, normal, face, distance = hit
    distances.append(distance)
    # Skin-to-muscle separation varies with body fat and base-mesh depth.
    # Retain a broad falloff, then let the actual mesh boundary supply shape.
    weight = 1.0 - smooth(0.006, 0.043, distance)
    if weight <= 0.0005:
        continue
    records.append({
        'v': index,
        'side': side,
        'distance': round(distance, 7),
        'weight': round(weight, 7),
        'nearest': [round(nearest.x, 7), round(nearest.y, 7), round(nearest.z, 7)],
    })

distances.sort()
quantile = lambda q: distances[min(len(distances) - 1, int((len(distances) - 1) * q))]
payload = {
    'source': 'Z-Anatomy / BodyParts3D latissimus dorsi meshes',
    'license': 'CC BY-SA 4.0 / CC BY-SA 2.1 Japan',
    'transform': {'scale': SCALE, 'offsetY': OFFSET_Y, 'offsetZ': OFFSET_Z},
    'distance_quantiles_m': {str(q): quantile(q) for q in (0, .01, .05, .1, .25, .5)},
    'records': records,
}
os.makedirs(os.path.dirname(OUT), exist_ok=True)
with open(OUT, 'w', encoding='utf8') as handle:
    json.dump(payload, handle, separators=(',', ':'))
print('WROTE', OUT, 'WITH', len(records), 'CAGE VERTICES', payload['distance_quantiles_m'])

