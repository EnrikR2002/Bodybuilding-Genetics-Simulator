/* Which part of the body a rig bone belongs to. The shape deformers and the
   pose code use these regions to decide which vertices they may move, so any
   new bone must be classified here.

   Rig (tools/blender/bake_freeman.py): pelvis, abdomen, chest, neck, head;
   per side clavicle, upperarm, forearm, hand, thigh, shin, foot (the original
   inspection bones), then the helpers upperarm_support (shoulder twist) and
   forearm_twist (pronation/supination), three bones per finger and thumb
   (`finger_index.01.L` … `.03`, `thumb.01.L` … `.03`) and `toe.L`. */
export function boneRegion(name) {
  if (/^(hand|finger|thumb|palm)/.test(name)) return "hand";
  if (/^(upperarm|forearm)/.test(name)) return "arm";          // includes the twist helpers
  if (/^(thigh|shin|foot|toe)/.test(name)) return "leg";
  if (/^(head|neck|jaw)/.test(name)) return "head";
  return "trunk";
}

export const boneSide = (name) => (name.endsWith(".L") ? 1 : name.endsWith(".R") ? -1 : 0);

/* Digits from the radial side, and the bone of joint k (1 = knuckle or thumb
   base, 2 = middle, 3 = tip segment). */
export const DIGITS = ["thumb", "finger_index", "finger_middle", "finger_ring", "finger_pinky"];
export const digitBone = (digit, k, side) => `${digit}.0${k}.${side}`;

/* Helper bones are driven by the pose code from their main bone; they carry
   part of a twist so the skin does not candy-wrap. */
export const HELPERS = { "upperarm_support": "upperarm", "forearm_twist": "forearm" };
