"""Create a compact, named superficial-muscle reference from Z-Anatomy."""
import bpy
import os

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
OUT = os.path.join(ROOT, 'assets-src', 'anatomy-reference', 'superficial-muscles.blend')

KEEP = (
    'latissimus dorsi muscle',
    'ascending part of trapezius muscle',
    'descending part of trapezius muscle',
    'transverse part of trapezius muscle',
    'teres major muscle', 'teres minor muscle',
    'rhomboid major muscle', 'rhomboid minor muscle',
    'acromial part of deltoid muscle', 'clavicular part of deltoid muscle',
    'scapular spinal part of deltoid muscle',
    'clavicular head of pectoralis major muscle',
    'sternocostal head of pectoralis major muscle',
    'abdominal part of pectoralis major muscle',
    'serratus anterior muscle', 'external abdominal oblique muscle',
    'rectus abdominis muscle', 'erector spinae',
    'long head of biceps brachii', 'short head of biceps brachii',
    'brachialis muscle', 'brachioradialis muscle',
    'medial head of triceps brachii', 'lateral head of triceps brachii',
    'long head of triceps brachii',
    'gluteus maximus muscle', 'gluteus medius muscle',
    'rectus femoris muscle', 'vastus lateralis muscle', 'vastus medialis muscle',
    'adductor longus muscle', 'sartorius muscle',
    'long head of biceps femoris', 'semitendinosus muscle', 'semimembranosus muscle',
    'lateral head of gastrocnemius', 'medial head of gastrocnemius',
    'soleus muscle', 'tibialis anterior muscle',
)


def wanted(obj):
    if obj.type != 'MESH':
        return False
    collections = {c.name for c in obj.users_collection}
    if '4: Muscular system' not in collections:
        return False
    name = obj.name.lower().replace('(', '').replace(')', '')
    return any(term in name for term in KEEP)


kept = [obj for obj in bpy.context.scene.objects if wanted(obj)]
keep_names = {obj.name for obj in kept}
for obj in list(bpy.data.objects):
    if obj.name not in keep_names:
        bpy.data.objects.remove(obj, do_unlink=True)

for obj in kept:
    obj.hide_viewport = False
    obj.hide_render = False
    obj.hide_set(False)

os.makedirs(os.path.dirname(OUT), exist_ok=True)
bpy.ops.wm.save_as_mainfile(filepath=OUT, compress=True)
print('WROTE', OUT, 'WITH', len(kept), 'MUSCLE OBJECTS')

