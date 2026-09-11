"""Render the Freeman sculpt with per-vertex colours (and optional overlay
meshes) for reviewing the projected anatomy map.

    blender -b --factory-startup --python render_freeman_anatomy.py -- <config.json>

config = {
  "freeman": {"json": "public/models/freeman.json", "bin": "public/models/freeman.bin"},
  "colors": "<Uint8 RGBA per vertex>"            (optional; grey when absent),
  "xray": 0.0..1.0                                (optional; see-through figure),
  "overlays": [{"verts": "<f32 xyz cm>", "tris": "<u32>", "color": [r, g, b]}],
  "size": [w, h],
  "views": [{"name": "front", "az": 0, "el": 0, "target": [0, 95, 0], "scale": 195}],
  "out": "<folder>/<prefix>"                      (writes <prefix>-<view>.png)
}
Coordinates are Freeman's: cm, Y up, +Z forward, +X = the figure's left.
az 0 looks at the front, 180 at the back, 90 at the figure's left side.
"""
import bpy
import json
import math
import sys

import numpy as np
from mathutils import Vector

cfg = json.load(open(sys.argv[sys.argv.index('--') + 1], encoding='utf8'))


def to_blender(p):
    """Freeman (x, y-up, z-forward) -> Blender (x, -z, y)."""
    out = np.empty_like(p)
    out[:, 0] = p[:, 0]
    out[:, 1] = -p[:, 2]
    out[:, 2] = p[:, 1]
    return out


def make_mesh(name, verts, tris, rgba):
    me = bpy.data.meshes.new(name)
    v = to_blender(verts.reshape(-1, 3)).astype(np.float32)
    t = tris.reshape(-1, 3)
    me.vertices.add(len(v))
    me.vertices.foreach_set('co', v.ravel())
    me.loops.add(t.size)
    me.loops.foreach_set('vertex_index', t.ravel().astype(np.int32))
    me.polygons.add(len(t))
    me.polygons.foreach_set('loop_start', np.arange(0, t.size, 3, dtype=np.int32))
    me.polygons.foreach_set('loop_total', np.full(len(t), 3, dtype=np.int32))
    me.update()
    me.validate()
    attr = me.color_attributes.new('Col', 'BYTE_COLOR', 'POINT')
    attr.data.foreach_set('color', (rgba.reshape(-1, 4) / 255.0).astype(np.float32).ravel())
    me.color_attributes.active_color = attr
    for p in me.polygons:
        p.use_smooth = True
    obj = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(obj)
    return obj


for o in list(bpy.data.objects):
    bpy.data.objects.remove(o)

meta = json.load(open(cfg['freeman']['json'], encoding='utf8'))
raw = open(cfg['freeman']['bin'], 'rb').read()
blocks = {b['name']: b for b in meta['blocks']}


def block(name, dtype):
    b = blocks[name]
    return np.frombuffer(raw, dtype=dtype, count=b['length'], offset=b['offset'])


pos = block('position', np.float32).copy()
if cfg.get('positions'):
    pos = np.fromfile(cfg['positions'], dtype=np.float32)
idx = block('index', np.uint32)
n = len(pos) // 3
if cfg.get('colors'):
    col = np.fromfile(cfg['colors'], dtype=np.uint8)
else:
    col = np.tile(np.array([200, 196, 188, 255], dtype=np.uint8), n)
if not cfg.get('hide_freeman'):
    make_mesh('Freeman', pos, idx, col)

for i, ov in enumerate(cfg.get('overlays', [])):
    v = np.fromfile(ov['verts'], dtype=np.float32)
    t = np.fromfile(ov['tris'], dtype=np.uint32)
    if ov.get('colors'):
        rgba = np.fromfile(ov['colors'], dtype=np.uint8)   # per vertex
    else:
        c = np.array(list(ov.get('color', [220, 60, 60])) + [255], dtype=np.uint8)
        rgba = np.tile(c, len(v) // 3)
    make_mesh('Overlay%d' % i, v, t, rgba)

scene = bpy.context.scene
scene.render.engine = 'BLENDER_WORKBENCH'
shading = scene.display.shading
shading.light = 'STUDIO'
shading.color_type = 'VERTEX'
shading.show_cavity = False
shading.show_specular_highlight = False
if cfg.get('xray'):
    shading.show_xray = True
    shading.xray_alpha = float(cfg['xray'])
scene.render.film_transparent = False
scene.world = bpy.data.worlds.new('W') if not scene.world else scene.world
scene.display_settings.display_device = 'sRGB'
scene.view_settings.view_transform = 'Standard'
w, h = cfg.get('size', [900, 1200])
scene.render.resolution_x = w
scene.render.resolution_y = h
scene.render.resolution_percentage = 100

cam_data = bpy.data.cameras.new('Cam')
cam_data.type = 'ORTHO'
cam = bpy.data.objects.new('Cam', cam_data)
scene.collection.objects.link(cam)
scene.camera = cam

for view in cfg['views']:
    tx, ty, tz = view.get('target', [0, 95, 0])
    target = Vector((tx, -tz, ty))
    az = math.radians(view.get('az', 0))
    el = math.radians(view.get('el', 0))
    # az 0: camera on the figure's front (+Z freeman = -Y blender)
    d = Vector((math.sin(az) * math.cos(el), -math.cos(az) * math.cos(el), math.sin(el)))
    cam.location = target + d * 500
    cam.rotation_euler = (-d).to_track_quat('-Z', 'Y').to_euler()
    cam_data.ortho_scale = view.get('scale', 195)
    cam_data.clip_end = 2000
    scene.render.filepath = '%s-%s.png' % (cfg['out'], view['name'])
    bpy.ops.render.render(write_still=True)
    print('RENDERED', scene.render.filepath)
