"""Inventory superficial-muscle candidates in the Z-Anatomy source scene."""
import bpy
import json
import os
from collections import Counter

TOKENS = (
    'latiss', 'trapez', 'teres', 'rhombo', 'delto', 'pector', 'serratus',
    'biceps', 'triceps', 'brachio', 'oblique', 'rectus abdom', 'erector',
    'glute', 'vastus', 'rectus fem', 'hamstring', 'femoris', 'gastrocn',
    'soleus', 'tibialis', 'achilles', 'fascia', 'iliac', 'scapul',
)

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
objects = list(bpy.context.scene.objects)
matches = []
for obj in objects:
    collections = [c.name for c in obj.users_collection]
    haystack = ' | '.join([
        obj.name,
        obj.data.name if getattr(obj, 'data', None) else '',
        ' | '.join(collections),
    ]).lower()
    if (obj.type != 'MESH' or '4: Muscular system' not in collections
            or not any(t in haystack for t in TOKENS)):
        continue
    if any(skip in obj.name.lower() for skip in (
        'bursa', 'node', 'region', 'line', 'vein', 'arter', 'nerve',
        'tendon sheath', 'joint', '.j',
    )):
        continue
    matches.append({
        'name': obj.name,
        'data': obj.data.name,
        'vertices': len(obj.data.vertices),
        'polygons': len(obj.data.polygons),
        'collections': collections,
    })

inventory = {
    'file': bpy.data.filepath,
    'object_count': len(objects),
    'types': dict(Counter(o.type for o in objects)),
    'matches': matches,
}
out = os.path.join(ROOT, 'assets-src', 'anatomy-reference', 'superficial-muscles.json')
os.makedirs(os.path.dirname(out), exist_ok=True)
with open(out, 'w', encoding='utf8') as handle:
    json.dump(inventory, handle, indent=2)
print('WROTE', out, 'WITH', len(matches), 'MATCHES')
