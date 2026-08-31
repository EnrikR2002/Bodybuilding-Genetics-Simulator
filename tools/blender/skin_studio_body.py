"""Bind the aligned Blender Studio cage to the simulator skeleton.

The result is a compact JSON weight table consumed by studio-source.mjs.  This
uses Blender's bone-heat solver on the actual production topology instead of
copying weights from whichever old surface vertex happens to be nearest.
"""
import bpy
import json
import os
import re
from mathutils import Vector

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
BODY = os.path.join(ROOT, 'assets-src', 'studio-base', 'studio-body.obj')
RIG = os.path.join(ROOT, 'assets-src', 'studio-base', 'makehuman-neutral-rig.json')
OUT = os.path.join(ROOT, 'assets-src', 'studio-base', 'studio-weights.json')

KEEP = re.compile(
    r'^(root|spine0[1-5]|neck0[1-3]|head|clavicle\.[LR]|shoulder01\.[LR]|'
    r'upperarm0[12]\.[LR]|lowerarm0[12]\.[LR]|wrist\.[LR]|'
    r'upperleg0[12]\.[LR]|lowerleg0[12]\.[LR]|foot\.[LR]|toe1-1\.[LR]|'
    r'breast\.[LR]|pelvis\.[LR]|metacarpal[1-4]\.[LR]|finger[1-5]-[1-3]\.[LR])$')


def read_obj(path):
    verts, faces = [], []
    with open(path, encoding='utf8') as handle:
        for line in handle:
            if line.startswith('v '):
                p = line.split()
                verts.append((float(p[1]), float(p[2]), float(p[3])))
            elif line.startswith('f '):
                faces.append(tuple(int(x.split('/')[0]) - 1 for x in line.split()[1:]))
    return verts, faces


bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)

verts, faces = read_obj(BODY)
mesh = bpy.data.meshes.new('Studio Body')
mesh.from_pydata(verts, [], faces)
mesh.update()
body = bpy.data.objects.new('Studio Body', mesh)
bpy.context.collection.objects.link(body)

with open(RIG, encoding='utf8') as handle:
    rig = json.load(handle)

arm_data = bpy.data.armatures.new('Insertion Rig')
arm = bpy.data.objects.new('Insertion Rig', arm_data)
bpy.context.collection.objects.link(arm)
bpy.context.view_layer.objects.active = arm
arm.select_set(True)
bpy.ops.object.mode_set(mode='EDIT')

edit = {}
for name, record in rig['bones'].items():
    if not KEEP.match(name):
        continue
    b = arm_data.edit_bones.new(name)
    b.head = Vector(record['head'])
    b.tail = Vector(record['tail'])
    if (b.tail - b.head).length < 0.002:
        b.tail = b.head + Vector((0, 0.01, 0))
    edit[name] = b

for name, b in edit.items():
    parent = rig['bones'][name].get('parent')
    while parent and parent not in edit:
        parent = rig['bones'].get(parent, {}).get('parent')
    if parent in edit and parent != name:
        b.parent = edit[parent]

bpy.ops.object.mode_set(mode='OBJECT')
for b in arm.data.bones:
    b.use_deform = True

body.select_set(True)
arm.select_set(True)
bpy.context.view_layer.objects.active = arm
try:
    bpy.ops.object.parent_set(type='ARMATURE_AUTO')
except RuntimeError as exc:
    print('AUTO WEIGHTS FAILED, USING ENVELOPES:', exc)
    for vg in list(body.vertex_groups):
        body.vertex_groups.remove(vg)
    bpy.ops.object.parent_set(type='ARMATURE_ENVELOPE')

# Normalize and discard numerical dust.  The runtime reduces each vertex to
# its strongest four influences during the binary bake.
weights = {}
for vertex in body.data.vertices:
    for group in vertex.groups:
        if group.weight <= 1e-5:
            continue
        name = body.vertex_groups[group.group].name
        weights.setdefault(name, []).append([vertex.index, round(group.weight, 7)])

payload = {
    'source': 'Blender automatic weights on Blender Studio realistic human base',
    'vertices': len(body.data.vertices),
    'bones': weights,
}
with open(OUT, 'w', encoding='utf8') as handle:
    json.dump(payload, handle, separators=(',', ':'))
print('WROTE', OUT, 'WITH', len(weights), 'WEIGHTED BONES')

