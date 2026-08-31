"""Export Blender Studio's body cage in the app's MakeHuman coordinate frame."""
import bpy
import json
import os

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
NEUTRAL = os.path.join(ROOT, 'assets-src', 'authoring', 'neutral-cage.obj')
OUT = os.path.join(ROOT, 'assets-src', 'studio-base', 'studio-body.obj')
META = os.path.join(ROOT, 'assets-src', 'studio-base', 'alignment.json')


def obj_positions(path):
    out = []
    with open(path, encoding='utf8') as handle:
        for line in handle:
            if line.startswith('v '):
                p = line.split()
                out.append((float(p[1]), float(p[2]), float(p[3])))
    return out


def axis_bounds(points, axis):
    values = [p[axis] for p in points]
    return min(values), max(values)


body = bpy.data.objects.get('GEO-body')
if not body or body.type != 'MESH':
    raise RuntimeError('GEO-body is missing from the Blender Studio file')

mh = obj_positions(NEUTRAL)
mh_x = axis_bounds(mh, 0)
mh_y = axis_bounds(mh, 1)
mh_z = axis_bounds(mh, 2)

world = [body.matrix_world @ v.co for v in body.data.vertices]
st_x = axis_bounds(world, 0)
st_y = axis_bounds(world, 1)
st_z = axis_bounds(world, 2)

scale = (mh_y[1] - mh_y[0]) / (st_z[1] - st_z[0])
mh_depth_c = (mh_z[0] + mh_z[1]) * 0.5
st_depth_c = (st_y[0] + st_y[1]) * 0.5

# The Studio A-pose keeps its arms closer to the torso than MakeHuman's bind
# pose. Stretch only the limb span outside the shoulder seam; scaling the whole
# X axis would turn the rib cage into a barrel before any slider is applied.
shoulder = 0.215 * scale
source_half = max(abs(st_x[0]), abs(st_x[1])) * scale
target_half = max(abs(mh_x[0]), abs(mh_x[1]))
arm_scale = (target_half - shoulder) / max(1e-6, source_half - shoulder)
depth_scale = 1.23


def convert(p):
    x = p.x * scale
    if abs(x) > shoulder:
        x = (1 if x >= 0 else -1) * (shoulder + (abs(x) - shoulder) * arm_scale)
    y = mh_y[0] + (p.z - st_z[0]) * scale
    z = mh_depth_c - (p.y - st_depth_c) * scale * depth_scale

    # The two sources use different bind poses.  The Studio cage keeps the
    # forearms almost in the coronal plane, while MakeHuman bends them forward.
    # Match that bend before building the surface correspondence; otherwise a
    # nearest-surface transfer maps the wrists onto the hips and gives the arm
    # unusable skin weights.  The gate follows the arm silhouette and eases to
    # zero across the deltoid seam so the torso is completely untouched.
    ax = abs(x)
    arm_edge = 1.72 + max(0.0, y - 4.35) * 0.18
    arm_w = min(1.0, max(0.0, (ax - arm_edge) / 0.58))
    if arm_w > 0.0 and y < 6.15:
        if y >= 3.86:
            dz = -0.42
        elif y >= 2.58:
            t = (3.86 - y) / (3.86 - 2.58)
            # Smooth interpolation makes this a bend around the elbow rather
            # than a hard shear line through the forearm.
            t = t * t * (3.0 - 2.0 * t)
            dz = -0.42 + 1.46 * t
        else:
            dz = 1.04
        z += dz * arm_w
    return x, y, z


mesh = body.data
uv = mesh.uv_layers.active.data if mesh.uv_layers.active else None
lines = [
    '# Blender Studio realistic human base, aligned to Insertion cage space',
    '# Source CC-BY: Julien Kaspar / Blender Studio, Project Heist',
    'o studio_body',
]
for p in world:
    x, y, z = convert(p)
    lines.append(f'v {x:.8f} {y:.8f} {z:.8f}')

if uv:
    for loop in mesh.loops:
        u, v = uv[loop.index].uv
        lines.append(f'vt {u:.8f} {v:.8f}')

lines.append('g body')
for poly in mesh.polygons:
    if len(poly.loop_indices) not in (3, 4):
        raise RuntimeError(f'Non tri/quad face {poly.index} has {len(poly.loop_indices)} corners')
    refs = []
    for li in poly.loop_indices:
        vi = mesh.loops[li].vertex_index + 1
        refs.append(f'{vi}/{li + 1}' if uv else str(vi))
    lines.append('f ' + ' '.join(refs))

os.makedirs(os.path.dirname(OUT), exist_ok=True)
with open(OUT, 'w', encoding='utf8', newline='\n') as handle:
    handle.write('\n'.join(lines) + '\n')
with open(META, 'w', encoding='utf8') as handle:
    json.dump({
        'scale': scale,
        'shoulder_dm': shoulder,
        'arm_scale': arm_scale,
        'depth_scale': depth_scale,
        'studio_bounds_m': {'x': st_x, 'y': st_y, 'z': st_z},
        'makehuman_bounds_dm': {'x': mh_x, 'y': mh_y, 'z': mh_z},
        'vertices': len(mesh.vertices),
        'polygons': len(mesh.polygons),
    }, handle, indent=2)
print('WROTE', OUT, 'WITH', len(mesh.vertices), 'VERTICES')
