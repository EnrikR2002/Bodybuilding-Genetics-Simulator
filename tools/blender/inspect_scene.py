"""Print a compact machine-readable inventory of the open Blender scene."""
import bpy
import json


def bounds(obj):
    if obj.type != 'MESH':
        return None
    pts = [obj.matrix_world @ v.co for v in obj.data.vertices]
    if not pts:
        return None
    return {
        'min': [min(p[i] for p in pts) for i in range(3)],
        'max': [max(p[i] for p in pts) for i in range(3)],
    }


items = []
for obj in bpy.context.scene.objects:
    rec = {
        'name': obj.name,
        'type': obj.type,
        'parent': obj.parent.name if obj.parent else None,
        'hidden_render': obj.hide_render,
        'bounds': bounds(obj),
    }
    if obj.type == 'MESH':
        rec.update({
            'vertices': len(obj.data.vertices),
            'edges': len(obj.data.edges),
            'polygons': len(obj.data.polygons),
            'uv_layers': [uv.name for uv in obj.data.uv_layers],
            'materials': [m.name if m else None for m in obj.data.materials],
            'shape_keys': ([k.name for k in obj.data.shape_keys.key_blocks]
                           if obj.data.shape_keys else []),
            'vertex_groups': len(obj.vertex_groups),
            'modifiers': [
                {'name': m.name, 'type': m.type,
                 'levels': getattr(m, 'levels', None),
                 'render_levels': getattr(m, 'render_levels', None)}
                for m in obj.modifiers
            ],
        })
    elif obj.type == 'ARMATURE':
        rec['bones'] = [b.name for b in obj.data.bones]
    items.append(rec)

print('SCENE_INVENTORY_BEGIN')
print(json.dumps({
    'file': bpy.data.filepath,
    'version': bpy.app.version_string,
    'objects': items,
}, indent=2))
print('SCENE_INVENTORY_END')

