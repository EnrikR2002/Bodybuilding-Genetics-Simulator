"""Render Studio and current cages overlaid in the same app coordinate frame."""
import bpy
import os
from mathutils import Vector

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
OUT = os.path.join(ROOT, 'shots')
os.makedirs(OUT, exist_ok=True)

bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)


def import_obj(path, name, color, alpha):
    before = set(bpy.data.objects)
    bpy.ops.wm.obj_import(filepath=path, forward_axis='NEGATIVE_Z', up_axis='Y')
    created = [o for o in bpy.data.objects if o not in before and o.type == 'MESH']
    if not created:
        raise RuntimeError('OBJ import created no mesh: ' + path)
    obj = created[0]
    obj.name = name
    mat = bpy.data.materials.new(name + ' Material')
    mat.diffuse_color = (*color, alpha)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get('Principled BSDF')
    bsdf.inputs['Base Color'].default_value = (*color, 1)
    bsdf.inputs['Roughness'].default_value = 0.54
    bsdf.inputs['Alpha'].default_value = alpha
    mat.surface_render_method = 'DITHERED'
    obj.data.materials.clear()
    obj.data.materials.append(mat)
    for p in obj.data.polygons:
        p.use_smooth = True
    return obj


studio = import_obj(os.path.join(ROOT, 'assets-src', 'studio-base', 'studio-body.obj'),
                    'Studio cage', (0.12, 0.48, 1.0), 0.62)
current = import_obj(os.path.join(ROOT, 'assets-src', 'authoring', 'neutral-cage.obj'),
                     'Current cage', (1.0, 0.16, 0.07), 0.38)

scene = bpy.context.scene
scene.render.engine = 'BLENDER_EEVEE_NEXT'
scene.render.resolution_x = 720
scene.render.resolution_y = 900
scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = 'PNG'
scene.render.image_settings.color_mode = 'RGB'
try:
    scene.view_settings.look = 'Medium High Contrast'
except TypeError:
    scene.view_settings.look = 'AgX - Medium High Contrast'
scene.world.color = (0.006, 0.007, 0.012)

cam_data = bpy.data.cameras.new('Camera')
cam = bpy.data.objects.new('Camera', cam_data)
scene.collection.objects.link(cam)
scene.camera = cam
cam.data.lens = 70


def point(obj, target):
    obj.rotation_euler = (target - obj.location).to_track_quat('-Z', 'Y').to_euler()


for name, energy, loc, size, color in [
    ('Key', 900, (-18, -24, 28), 16, (1.0, 0.70, 0.55)),
    ('Fill', 550, (19, -14, 13), 14, (0.48, 0.67, 1.0)),
    ('Rim', 1000, (0, 20, 22), 12, (0.50, 0.65, 1.0)),
]:
    data = bpy.data.lights.new(name, 'AREA')
    data.energy, data.shape, data.size, data.color = energy, 'DISK', size, color
    light = bpy.data.objects.new(name, data)
    scene.collection.objects.link(light)
    light.location = loc
    point(light, Vector((0, 0, 0.5)))

target = Vector((0, 0, 0.55))
for label, loc in {'front': (0, -34, 0.7), 'side': (34, 0, 0.7)}.items():
    cam.location = loc
    point(cam, target)
    scene.render.filepath = os.path.join(OUT, f'cage-alignment-{label}.png')
    bpy.ops.render.render(write_still=True)
    print('WROTE', scene.render.filepath)
