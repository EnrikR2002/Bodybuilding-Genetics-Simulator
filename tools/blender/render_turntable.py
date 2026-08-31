"""Render neutral clay review views of the Blender Studio source body."""
import bpy
import math
import os
from mathutils import Vector

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
OUT = os.path.join(ROOT, 'shots')
PREFIX = os.environ.get('REVIEW_PREFIX', 'studio-base')
REQUESTED = {v.strip() for v in os.environ.get('REVIEW_VIEWS', 'front,threeq,back').split(',') if v.strip()}
os.makedirs(OUT, exist_ok=True)

scene = bpy.context.scene
scene.render.engine = 'BLENDER_EEVEE_NEXT'
scene.render.resolution_x = 720
scene.render.resolution_y = 900
scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = 'PNG'
scene.render.film_transparent = False
scene.render.use_freestyle = False
scene.use_nodes = False
scene.render.image_settings.color_mode = 'RGBA'
scene.view_settings.look = 'Medium High Contrast'
scene.world.color = (0.008, 0.009, 0.014)

clay = bpy.data.materials.new('Review Clay')
clay.diffuse_color = (0.42, 0.18, 0.10, 1.0)
clay.use_nodes = True
bsdf = clay.node_tree.nodes.get('Principled BSDF')
bsdf.inputs['Base Color'].default_value = (0.33, 0.095, 0.045, 1.0)
bsdf.inputs['Roughness'].default_value = 0.48
bsdf.inputs['Specular IOR Level'].default_value = 0.30

for obj in scene.objects:
    if obj.type == 'MESH':
        obj.data.materials.clear()
        obj.data.materials.append(clay)
        for p in obj.data.polygons:
            p.use_smooth = True

camera_data = bpy.data.cameras.new('Review Camera')
camera = bpy.data.objects.new('Review Camera', camera_data)
scene.collection.objects.link(camera)
scene.camera = camera
camera.data.lens = 72


def area(name, energy, size, loc, color):
    data = bpy.data.lights.new(name, 'AREA')
    data.energy = energy
    data.shape = 'DISK'
    data.size = size
    data.color = color
    obj = bpy.data.objects.new(name, data)
    scene.collection.objects.link(obj)
    obj.location = loc
    point(obj, Vector((0, 0, 0.95)))


def point(obj, target):
    obj.rotation_euler = (target - obj.location).to_track_quat('-Z', 'Y').to_euler()


area('Key', 820, 3.0, (-2.2, -2.8, 2.8), (1.0, 0.73, 0.58))
area('Fill', 460, 2.5, (2.5, -1.7, 1.5), (0.55, 0.68, 1.0))
area('Rim L', 760, 1.7, (-2.0, 1.8, 2.0), (1.0, 0.34, 0.18))
area('Rim R', 560, 1.5, (2.2, 1.6, 1.2), (0.48, 0.60, 1.0))

target = Vector((0, 0, 0.91))
for label, loc in {
    'front': (0, -3.6, 0.94),
    'threeq': (-2.35, -2.75, 1.00),
    'back': (0, 3.6, 0.94),
}.items():
    if label not in REQUESTED:
        continue
    camera.location = loc
    point(camera, target)
    scene.render.filepath = os.path.join(OUT, f'{PREFIX}-{label}.png')
    scene.render.image_settings.color_mode = 'RGB'
    bpy.ops.render.render(write_still=True)
    print('WROTE', scene.render.filepath)
