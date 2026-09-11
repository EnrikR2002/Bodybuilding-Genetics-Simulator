"""Bake the CC0 Freeman sculpt and its inspection rig for the web app.

The surface (positions, normals, UVs, triangles, coverage, the relaxed copy and
the eye/eyebrow meshes) and its vertex order are fixed: other data (the
projected anatomy) is indexed by it. This script re-derives only the rig and
the skin weights, then checks the surface against the committed bake and
refuses to write anything that would change it.

Rig: the original 21 inspection bones keep their names, order and joints.
Appended per side: a forearm twist helper, three bones per finger and thumb
placed on the sculpt's own fingers (joint centres measured from geodesic ring
centroids of each finger), and a toe bone for heel-raised stances.

Weights: Blender heat weights, then a cleanup. Inside the hand the heat total
of hand + finger bones is kept, but it is redistributed along the nearest
finger chain so a finger never pulls the palm or its neighbour: a soft
nearest-chain membership shares only the webs, and each joint blends over a
short span (narrow and slightly distal on the back of the knuckle so fists
keep square knuckles, wider on the palm side where skin folds).
"""
import bpy, os, json, struct, math, array
from mathutils import Vector

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
OUT = os.path.join(ROOT, 'public', 'models')
body = bpy.data.objects['Mike_Freeman']
SCALE = 180 / 2.01757878; FLOOR = -.0388782583
def source_cm(x, y, z): return (x / SCALE, -z / SCALE, y / SCALE + FLOOR)
def conv(p): return (p.x * SCALE, (p.z - FLOOR) * SCALE, -p.y * SCALE)

# The committed bake is the reference for the surface. Read it before anything is written.
ref_header = json.load(open(os.path.join(OUT, 'freeman.json')))
ref_blob = open(os.path.join(OUT, 'freeman.bin'), 'rb').read()
def ref_block(name):
    b = next(x for x in ref_header['blocks'] if x['name'] == name)
    a = array.array(b['type']); a.frombytes(ref_blob[b['offset']:b['offset'] + b['length'] * a.itemsize])
    return a

# ---------------------------------------------------------------- original rig
# Head and limb landmarks in the sculpt's original metre frame.
spec = [('pelvis', None, (0, .015, .98), (0, .01, 1.15)), ('abdomen', 'pelvis', (0, .01, 1.15), (0, .025, 1.38)),
        ('chest', 'abdomen', (0, .025, 1.38), (0, .01, 1.66)), ('neck', 'chest', (0, .01, 1.66), (0, .01, 1.79)),
        ('head', 'neck', (0, .01, 1.79), (0, .01, 1.96))]
for side, sign in [('L', 1), ('R', -1)]:
    def p(x, y, z): return (x * sign, y, z)
    spec.extend([
        ('clavicle.' + side, 'chest', p(.025, .01, 1.62), p(.235, .005, 1.63)),
        ('upperarm.' + side, 'clavicle.' + side, p(.235, .005, 1.63), p(.455, -.005, 1.365)),
        ('forearm.' + side, 'upperarm.' + side, p(.455, -.005, 1.365), p(.646, -.015, 1.19)),
        ('hand.' + side, 'forearm.' + side, p(.646, -.015, 1.19), p(.744, -.030, 1.132)),
        ('thigh.' + side, 'pelvis', p(.105, .01, 1.015), p(.116, -.027, .58)),
        ('shin.' + side, 'thigh.' + side, p(.116, -.027, .58), p(.123, .012, .12)),
        ('foot.' + side, 'shin.' + side, p(.123, .012, .12), p(.125, -.16, .025)),
    ])
# Landmarks measured in cross-sections of the evaluated sculpt (centimetres).
# In particular, its hands extend forward; a planar arm rig misses the wrists.
for side, sign in [('L', 1), ('R', -1)]:
    def c(x, y, z): return source_cm(sign * x, y, z)
    points = {'clavicle': (c(2.2, 147, -1), c(18.5, 142, -4)),
              'upperarm': (c(18.5, 142, -4), c(37, 124, -3)),
              'forearm': (c(37, 124, -3), c(52, 114, 5)),
              'hand': (c(52, 114, 5), c(62, 110, 14))}
    for i, (name, parent, h, t) in enumerate(spec):
        if name.endswith('.' + side) and name.split('.')[0] in points:
            h, t = points[name.split('.')[0]]; spec[i] = (name, parent, h, t)
for side in ['L', 'R']:
    original = next(s for s in spec if s[0] == 'upperarm.' + side)
    spec.append(('upperarm_support.' + side, original[1], original[2], original[3]))
ORIGINAL = len(spec)

# ---------------------------------------------------------------- added rig
# Left-hand joints in figure centimetres (x left, y up, z forward), from the
# knuckle (the thumb's carpometacarpal base) to the tip. The sculpt is exactly
# mirror-symmetric, so the right hand is the mirror image.
FINGERS = [
    ('thumb', 1.30, [(53.58, 113.69, 10.25), (56.53, 114.49, 15.82), (58.85, 114.55, 18.31), (60.55, 114.59, 20.14)]),
    ('finger_index', 1.15, [(61.49, 112.02, 14.92), (64.72, 110.98, 17.77), (66.61, 110.45, 19.29), (67.83, 109.34, 20.18)]),
    ('finger_middle', 1.25, [(61.63, 110.60, 12.21), (65.66, 108.86, 15.60), (68.04, 107.98, 17.30), (69.64, 106.65, 18.46)]),
    ('finger_ring', 1.14, [(61.89, 109.07, 10.96), (65.93, 106.85, 12.74), (68.21, 105.87, 13.81), (69.11, 104.78, 15.13)]),
    ('finger_pinky', 0.95, [(62.21, 107.10, 8.84), (64.83, 105.82, 9.77), (66.21, 105.04, 10.40), (66.93, 104.14, 10.82)]),
]
TOE = ((16.0, 2.2, 11.0), (16.3, 1.5, 17.5))
for side, sign in [('L', 1), ('R', -1)]:
    def c(x, y, z): return source_cm(sign * x, y, z)
    fore = next(s for s in spec if s[0] == 'forearm.' + side)
    mid = tuple((a + b) / 2 for a, b in zip(fore[2], fore[3]))
    spec.append(('forearm_twist.' + side, 'forearm.' + side, mid, fore[3]))
    for name, _, joints in FINGERS:
        for k in range(3):
            spec.append(('%s.%02d.%s' % (name, k + 1, side), 'hand.' + side if k == 0 else '%s.%02d.%s' % (name, k, side),
                         c(*joints[k]), c(*joints[k + 1])))
    spec.append(('toe.' + side, 'foot.' + side, c(*TOE[0]), c(*TOE[1])))
HELPERS = ('upperarm_support', 'forearm_twist')  # weighted by hand below, not by heat

arm_data = bpy.data.armatures.new('FreemanInspection'); arm = bpy.data.objects.new('FreemanInspection', arm_data)
bpy.context.collection.objects.link(arm)
bpy.context.view_layer.objects.active = arm; arm.select_set(True); bpy.ops.object.mode_set(mode='EDIT')
for name, parent, head, tail in spec:
    b = arm_data.edit_bones.new(name); b.head = head; b.tail = tail
    if name.split('.')[0] in HELPERS: b.use_deform = False
    if parent: b.parent = arm_data.edit_bones[parent]
bpy.ops.object.mode_set(mode='OBJECT')
bpy.ops.object.select_all(action='DESELECT'); body.select_set(True); arm.select_set(True); bpy.context.view_layer.objects.active = arm
bpy.ops.object.parent_set(type='ARMATURE_AUTO')

# Export the evaluated sculpt, including multires detail and interpolated weights.
body.modifiers[0].levels = 2; body.modifiers[0].render_levels = 2
for poly in body.data.polygons: poly.use_smooth = True
bpy.context.view_layer.update()
deps = bpy.context.evaluated_depsgraph_get(); ev = body.evaluated_get(deps)
mesh = ev.to_mesh(preserve_all_data_layers=True, depsgraph=deps); mesh.calc_loop_triangles()

bone_idx = {s[0]: i for i, s in enumerate(spec)}
group_names = {g.index: g.name for g in body.vertex_groups}

def smoothstep(a, b, x):
    t = min(1.0, max(0.0, (x - a) / (b - a))); return t * t * (3 - 2 * t)

class Hand:
    """Finger chains of one hand in centimetres, for the weight cleanup."""
    def __init__(self, side, sign):
        self.side = side
        self.wrist = Vector((52 * sign, 114, 5))
        self.chains = []
        for name, radius, joints in FINGERS:
            J = [Vector((x * sign, y, z)) for x, y, z in joints]
            L = [(J[k + 1] - J[k]).length for k in range(3)]
            bones = [bone_idx['%s.%02d.%s' % (name, k + 1, side)] for k in range(3)]
            self.chains.append((name, radius, J, L, bones))
        J = {n: [Vector((x * sign, y, z)) for x, y, z in j] for n, _, j in FINGERS}
        a = J['finger_pinky'][0] - J['finger_index'][0]
        f = J['finger_middle'][0] - self.wrist
        n = a.cross(f) if sign > 0 else f.cross(a)
        self.palm = n.normalized()   # points out of the palm
        self.hand = bone_idx['hand.' + side]
        self.bones = {self.hand} | {b for c in self.chains for b in c[4]}

    def chain(self, p, J, L):
        """Distance to a joint chain, arc length from its base (negative before it) and the joint-space offset."""
        best = None; acc = 0.0
        for k in range(3):
            a = J[k]; ab = J[k + 1] - a; t = (p - a).dot(ab) / (L[k] * L[k])
            q = a + ab * min(1.0, max(0.0, t)); d = (p - q).length
            s = acc + (t if k == 0 and t < 0 else min(1.0, max(0.0, t))) * L[k]
            if best is None or d < best[0]: best = (d, s, p - q)
            acc += L[k]
        return best

    def distribute(self, p):
        """Shares of hand + finger bones for a vertex at p (cm); they sum to 1."""
        found = []
        for name, radius, J, L, bones in self.chains:
            d, s, off = self.chain(p, J, L)
            thumb = name == 'thumb'
            near = 1 - (smoothstep(radius + 0.8, radius + 2.4, d) if thumb else smoothstep(radius + 0.5, radius + 1.6, d))
            if near <= 0: continue
            # palmar (1) or dorsal (0) side of the chain: joints fold on the palm side
            u = smoothstep(-0.45, 0.45, off.dot(self.palm) / max(radius, 1e-3))
            joints = [0.0, L[0], L[0] + L[1]]
            if thumb:
                spans = [(0.9, 1.3), (0.0, 0.6), (0.0, 0.45)]
            else:
                spans = [(0.35 * (1 - u), 0.6 + 0.4 * u), (0.12 * (1 - u), 0.5 + 0.15 * u), (0.08 * (1 - u), 0.38 + 0.1 * u)]
            r = [smoothstep(c + dc - h, c + dc + h, s) for c, (dc, h) in zip(joints, spans)]
            found.append((d, near, [r[0] - r[1], r[1] - r[2], r[2]], bones, r[0]))
        out = {self.hand: 1.0}
        if not found: return out
        dmin = min(f[0] for f in found)
        g = [math.exp(-(f[0] - dmin) / 0.3) for f in found]; gs = sum(g)
        for (d, near, parts, bones, r0), gi in zip(found, g):
            m = gi / gs * near
            out[self.hand] -= m * r0
            for b, w in zip(bones, parts):
                if w * m > 1e-6: out[b] = out.get(b, 0.0) + w * m
        return out

hands = {'L': Hand('L', 1), 'R': Hand('R', -1)}
toe_bones = {bone_idx['toe.L']: bone_idx['foot.L'], bone_idx['toe.R']: bone_idx['foot.R']}

positions = []; normals = []; weights = []; indices = []; cover = []
for v in mesh.vertices:
    p = body.matrix_world @ v.co; positions.extend(conv(p)); normals.extend((v.normal.x, v.normal.z, -v.normal.y))
    pcm = Vector(conv(p))
    w = []
    for g in v.groups:
        name = group_names[g.group]
        if name not in bone_idx or g.weight <= 1e-7: continue
        weight = g.weight
        if name in ['upperarm.L', 'upperarm.R']:
            s = spec[bone_idx[name]]; head = Vector(s[2]); axis = Vector(s[3]) - head
            t = (p - head).dot(axis) / axis.length_squared
            blend = max(0, min(1, (.45 - t) / .38)); blend = blend * blend * (3 - 2 * blend)
            w.append((bone_idx['upperarm_support.' + name[-1]], weight * blend)); weight *= 1 - blend
        if name in ['forearm.L', 'forearm.R']:
            # the distal forearm follows pronation and supination progressively
            s = spec[bone_idx[name]]; head = Vector(s[2]); axis = Vector(s[3]) - head
            t = (p - head).dot(axis) / axis.length_squared
            share = smoothstep(0.12, 0.98, t)
            w.append((bone_idx['forearm_twist.' + name[-1]], weight * share)); weight *= 1 - share
        b = bone_idx[name]
        if b in toe_bones:
            # the toes bend at the ball of the foot; nothing behind it may follow them
            keep = smoothstep(8.5, 11.0, pcm.z)
            w.append((toe_bones[b], weight * (1 - keep))); weight *= keep
        w.append((b, weight))
    hand = hands['L' if pcm.x > 0 else 'R']
    hp = sum(x[1] for x in w if x[0] in hand.bones)
    if hp > 0 and (pcm - hand.wrist).length < 32:
        w = [x for x in w if x[0] not in hand.bones]
        w.extend((b, hp * share) for b, share in hand.distribute(pcm).items())
    merged = {}
    for b, x in w: merged[b] = merged.get(b, 0.0) + x
    # the hand share is a difference of sums; never let float noise go negative
    w = sorted(((b, x) for b, x in merged.items() if x > 1e-7), key=lambda a: -a[1])[:4]
    if not w or w[0][1] <= 0: raise RuntimeError('Missing heat weights on vertex ' + str(v.index))
    total = sum(x[1] for x in w)
    weights.extend([x[1] / total for x in w] + [0] * (4 - len(w))); indices.extend([x[0] for x in w] + [0] * (4 - len(w)))
    # Sculpt-space posing brief: a crisp smooth curved hem; no face/neck masks.
    x, y, z = conv(p); hem = 82 + 5 * min(1, abs(x) / 13)
    cover.append(1 if y > hem and y < 99 else 0)
triangles = [v for tri in mesh.loop_triangles for v in tri.vertices]
# A softened version of the same topology lets surface coverage obscure the
# sculpted separations instead of merely inflating an equally shredded body.
soft = body.modifiers.new('Surface coverage', 'SMOOTH'); soft.factor = .8; soft.iterations = 120
bpy.context.view_layer.update()
soft_ev = body.evaluated_get(bpy.context.evaluated_depsgraph_get()); soft_mesh = soft_ev.to_mesh()
smooth_positions = [c for v in soft_mesh.vertices for c in conv(body.matrix_world @ v.co)]
smooth_normals = [c for v in soft_mesh.vertices for c in (v.normal.x, v.normal.z, -v.normal.y)]
assert len(smooth_positions) == len(positions)
soft_ev.to_mesh_clear(); body.modifiers.remove(soft)
bpy.context.view_layer.update()
deps = bpy.context.evaluated_depsgraph_get(); ev = body.evaluated_get(deps)
mesh = ev.to_mesh(preserve_all_data_layers=True, depsgraph=deps)
# Retain UVs for future scanned skin, without welding across UV seams.
uv_layer = mesh.uv_layers.active
uvs = [0.] * (len(mesh.vertices) * 2)
if uv_layer:
    for loop in mesh.loops: uvs[loop.vertex_index * 2:loop.vertex_index * 2 + 2] = uv_layer.data[loop.index].uv[:]
# Eye and eyebrow meshes are separate, rigid to the head; hair is optional.
extras = []
for name in ['Roundcube.002', 'Roundcube.003', 'eyebrow', 'hair']:
    obj = bpy.data.objects.get(name)
    if not obj: continue
    for m in obj.modifiers:
        if m.type == 'SUBSURF': m.levels = 2
    e = obj.evaluated_get(deps); me = e.to_mesh(); me.calc_loop_triangles()
    extras.append({'name': name, 'position': [c for v in me.vertices for c in conv(obj.matrix_world @ v.co)],
                   'index': [v for t in me.loop_triangles for v in t.vertices]})
    e.to_mesh_clear()

# ---------------------------------------------------------------- surface check
surface = {'position': (positions, 'f'), 'normal': (normals, 'f'), 'uv': (uvs, 'f'), 'index': (triangles, 'I'),
           'cover': (cover, 'f'), 'smoothPosition': (smooth_positions, 'f'), 'smoothNormal': (smooth_normals, 'f')}
for i, e in enumerate(extras):
    surface['extraPosition' + str(i)] = (e['position'], 'f'); surface['extraIndex' + str(i)] = (e['index'], 'I')
committed = {}
for name, (data, fmt) in surface.items():
    ref = ref_block(name)
    new = array.array(fmt, data)
    if len(new) != len(ref): raise RuntimeError('The %s block changed length (%d, was %d)' % (name, len(new), len(ref)))
    if new.tobytes() != ref.tobytes():
        worst = max(abs(a - b) for a, b in zip(new, ref))
        if fmt != 'f' or worst > 1e-3: raise RuntimeError('The %s block changed by %g; the surface must stay identical' % (name, worst))
        print('SURFACE', name, 'differs by', worst, '(float noise); the committed values are kept')
    committed[name] = ref   # the committed bytes, bit for bit
old_bones = [b['name'] for b in ref_header['bones']]
if [s[0] for s in spec[:len(old_bones)]] != old_bones: raise RuntimeError('Existing bone names or order changed')

blocks = []; blob = bytearray()
def block(name, data, fmt):
    while len(blob) % 4: blob.append(0)
    offset = len(blob)
    blob.extend(data.tobytes() if isinstance(data, array.array) else struct.pack('<' + fmt * len(data), *data))
    blocks.append({'name': name, 'offset': offset, 'length': len(data), 'type': fmt})
block('position', committed['position'], 'f'); block('normal', committed['normal'], 'f'); block('uv', committed['uv'], 'f')
block('skinIndex', indices, 'H'); block('skinWeight', weights, 'f'); block('index', committed['index'], 'I')
block('cover', committed['cover'], 'f')
block('smoothPosition', committed['smoothPosition'], 'f')
block('smoothNormal', committed['smoothNormal'], 'f')
for i, e in enumerate(extras):
    block('extraPosition' + str(i), committed['extraPosition' + str(i)], 'f'); block('extraIndex' + str(i), committed['extraIndex' + str(i)], 'I')
    e.pop('position'); e.pop('index')
for b in blocks:
    r = next(x for x in ref_header['blocks'] if x['name'] == b['name'])
    if (r['offset'], r['length'], r['type']) != (b['offset'], b['length'], b['type']): raise RuntimeError('Block layout changed: ' + b['name'])
header = {'source': 'Mike Freeman / Péter Józsa Jr.', 'license': 'CC0', 'vertices': len(mesh.vertices), 'triangles': len(triangles) // 3,
          'blocks': blocks, 'extras': extras,
          'bones': [{'name': n, 'parent': bone_idx.get(p, -1), 'head': conv(Vector(h)), 'tail': conv(Vector(t))} for n, p, h, t in spec]}
os.makedirs(OUT, exist_ok=True)
with open(os.path.join(OUT, 'freeman.json'), 'w') as f: json.dump(header, f, separators=(',', ':'))
with open(os.path.join(OUT, 'freeman.bin'), 'wb') as f: f.write(blob)
print('EXPORTED', header['vertices'], 'vertices', header['triangles'], 'triangles', len(spec), 'bones', len(blob), 'bytes')
ev.to_mesh_clear()
