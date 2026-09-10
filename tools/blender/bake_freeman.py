"""Bake the CC0 Freeman sculpt and a compact inspection rig for the web app."""
import bpy,os,json,struct,math
from mathutils import Vector
ROOT=os.path.abspath(os.path.join(os.path.dirname(__file__),'..','..'))
OUT=os.path.join(ROOT,'public','models')
body=bpy.data.objects['Mike_Freeman']
# Head and limb landmarks in the sculpt's original metre frame.
spec=[('pelvis',None,(0,.015,.98),(0,.01,1.15)),('abdomen','pelvis',(0,.01,1.15),(0,.025,1.38)),('chest','abdomen',(0,.025,1.38),(0,.01,1.66)),('neck','chest',(0,.01,1.66),(0,.01,1.79)),('head','neck',(0,.01,1.79),(0,.01,1.96))]
for side,sign in [('L',1),('R',-1)]:
 def p(x,y,z):return (x*sign,y,z)
 spec.extend([
 ('clavicle.'+side,'chest',p(.025,.01,1.62),p(.235,.005,1.63)),
 ('upperarm.'+side,'clavicle.'+side,p(.235,.005,1.63),p(.455,-.005,1.365)),
 ('forearm.'+side,'upperarm.'+side,p(.455,-.005,1.365),p(.646,-.015,1.19)),
 ('hand.'+side,'forearm.'+side,p(.646,-.015,1.19),p(.744,-.030,1.132)),
 ('thigh.'+side,'pelvis',p(.105,.01,1.015),p(.116,-.027,.58)),
 ('shin.'+side,'thigh.'+side,p(.116,-.027,.58),p(.123,.012,.12)),
 ('foot.'+side,'shin.'+side,p(.123,.012,.12),p(.125,-.16,.025)),
 ])
# Landmarks measured in cross-sections of the evaluated sculpt (centimetres).
# In particular, its hands extend forward; a planar arm rig misses the wrists.
SCALE=180/2.01757878;FLOOR=-.0388782583
def source_cm(x,y,z):return (x/SCALE,-z/SCALE,y/SCALE+FLOOR)
for side,sign in [('L',1),('R',-1)]:
 def c(x,y,z):return source_cm(sign*x,y,z)
 points={'clavicle':(c(2.2,147,-1),c(18.5,142,-4)),
 'upperarm':(c(18.5,142,-4),c(37,124,-3)),
 'forearm':(c(37,124,-3),c(52,114,5)),
 'hand':(c(52,114,5),c(62,110,14))}
 for i,(name,parent,h,t) in enumerate(spec):
  if name.endswith('.'+side) and name.split('.')[0] in points:
   h,t=points[name.split('.')[0]];spec[i]=(name,parent,h,t)
for side in ['L','R']:
 original=next(s for s in spec if s[0]=='upperarm.'+side)
 spec.append(('upperarm_support.'+side,original[1],original[2],original[3]))
arm_data=bpy.data.armatures.new('FreemanInspection');arm=bpy.data.objects.new('FreemanInspection',arm_data);bpy.context.collection.objects.link(arm)
bpy.context.view_layer.objects.active=arm;arm.select_set(True);bpy.ops.object.mode_set(mode='EDIT')
for name,parent,head,tail in spec:
 b=arm_data.edit_bones.new(name);b.head=head;b.tail=tail
 if 'support' in name:b.use_deform=False
 if parent:b.parent=arm_data.edit_bones[parent]
bpy.ops.object.mode_set(mode='OBJECT')
bpy.ops.object.select_all(action='DESELECT');body.select_set(True);arm.select_set(True);bpy.context.view_layer.objects.active=arm
bpy.ops.object.parent_set(type='ARMATURE_AUTO')
# Export the evaluated sculpt, including multires detail and interpolated weights.
body.modifiers[0].levels=2;body.modifiers[0].render_levels=2
for poly in body.data.polygons:poly.use_smooth=True
bpy.context.view_layer.update()
deps=bpy.context.evaluated_depsgraph_get();ev=body.evaluated_get(deps);mesh=ev.to_mesh(preserve_all_data_layers=True,depsgraph=deps);mesh.calc_loop_triangles()
# Y up, forward +Z, centimetres. Grounded at zero; author proportions retained.
SCALE=180/2.01757878;FLOOR=-.0388782583
def conv(p):return (p.x*SCALE,(p.z-FLOOR)*SCALE,-p.y*SCALE)
positions=[];normals=[];weights=[];indices=[];uvs=[];cover=[]
bone_idx={s[0]:i for i,s in enumerate(spec)}
group_names={g.index:g.name for g in body.vertex_groups}
for v in mesh.vertices:
 p=body.matrix_world@v.co;positions.extend(conv(p));normals.extend((v.normal.x,v.normal.z,-v.normal.y))
 w=[]
 for g in v.groups:
  name=group_names[g.group]
  if name not in bone_idx or g.weight<=1e-7:continue
  weight=g.weight
  if name in ['upperarm.L','upperarm.R']:
   s=spec[bone_idx[name]];head=Vector(s[2]);axis=Vector(s[3])-head
   t=(p-head).dot(axis)/axis.length_squared
   blend=max(0,min(1,(.45-t)/.38));blend=blend*blend*(3-2*blend)
   w.append((bone_idx['upperarm_support.'+name[-1]],weight*blend));weight*=1-blend
  w.append((bone_idx[name],weight))
 w.sort(key=lambda a:-a[1]);w=w[:4]
 if not w:raise RuntimeError('Missing heat weights on vertex '+str(v.index))
 total=sum(x[1] for x in w);weights.extend([x[1]/total for x in w]+[0]*(4-len(w)));indices.extend([x[0] for x in w]+[0]*(4-len(w)))
 # Sculpt-space posing brief: a crisp smooth curved hem; no face/neck masks.
 x,y,z=conv(p);hem=82+5*min(1,abs(x)/13)
 cover.append(1 if y>hem and y<99 else 0)
triangles=[v for tri in mesh.loop_triangles for v in tri.vertices]
# A softened version of the same topology lets surface coverage obscure the
# sculpted separations instead of merely inflating an equally shredded body.
soft=body.modifiers.new('Surface coverage','SMOOTH');soft.factor=.8;soft.iterations=120
bpy.context.view_layer.update()
soft_ev=body.evaluated_get(bpy.context.evaluated_depsgraph_get());soft_mesh=soft_ev.to_mesh()
smooth_positions=[c for v in soft_mesh.vertices for c in conv(body.matrix_world@v.co)]
smooth_normals=[c for v in soft_mesh.vertices for c in (v.normal.x,v.normal.z,-v.normal.y)]
assert len(smooth_positions)==len(positions)
soft_ev.to_mesh_clear();body.modifiers.remove(soft)
bpy.context.view_layer.update()
deps=bpy.context.evaluated_depsgraph_get();ev=body.evaluated_get(deps);mesh=ev.to_mesh(preserve_all_data_layers=True,depsgraph=deps)
# Retain UVs for future scanned skin, without welding across UV seams.
uv_layer=mesh.uv_layers.active
uvs=[0.]*(len(mesh.vertices)*2)
if uv_layer:
 for loop in mesh.loops:uvs[loop.vertex_index*2:loop.vertex_index*2+2]=uv_layer.data[loop.index].uv[:]
# Eye and eyebrow meshes are separate, rigid to the head; hair is optional.
extras=[]
for name in ['Roundcube.002','Roundcube.003','eyebrow','hair']:
 obj=bpy.data.objects.get(name)
 if not obj:continue
 for m in obj.modifiers:
  if m.type=='SUBSURF':m.levels=2
 e=obj.evaluated_get(deps);me=e.to_mesh();me.calc_loop_triangles()
 extras.append({'name':name,'position':[c for v in me.vertices for c in conv(obj.matrix_world@v.co)],'index':[v for t in me.loop_triangles for v in t.vertices]})
 e.to_mesh_clear()
blocks=[];blob=bytearray()
def block(name,data,fmt):
 while len(blob)%4:blob.append(0)
 offset=len(blob);blob.extend(struct.pack('<'+fmt*len(data),*data));blocks.append({'name':name,'offset':offset,'length':len(data),'type':fmt})
block('position',positions,'f');block('normal',normals,'f');block('uv',uvs,'f');block('skinIndex',indices,'H');block('skinWeight',weights,'f');block('index',triangles,'I');block('cover',cover,'f')
block('smoothPosition',smooth_positions,'f')
block('smoothNormal',smooth_normals,'f')
for i,e in enumerate(extras):
 block('extraPosition'+str(i),e.pop('position'),'f');block('extraIndex'+str(i),e.pop('index'),'I')
header={'source':'Mike Freeman / Péter Józsa Jr.','license':'CC0','vertices':len(mesh.vertices),'triangles':len(triangles)//3,'blocks':blocks,'extras':extras,'bones':[{'name':n,'parent':bone_idx.get(p,-1),'head':conv(Vector(h)),'tail':conv(Vector(t))} for n,p,h,t in spec]}
os.makedirs(OUT,exist_ok=True)
with open(os.path.join(OUT,'freeman.json'),'w') as f:json.dump(header,f,separators=(',',':'))
with open(os.path.join(OUT,'freeman.bin'),'wb') as f:f.write(blob)
print('EXPORTED',header['vertices'],'vertices',header['triangles'],'triangles',len(blob),'bytes')
ev.to_mesh_clear()

