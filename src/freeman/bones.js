/* Which part of the body a rig bone belongs to. The shape deformers and the
   pose code use these regions to decide which vertices they may move, so any
   new bone (fingers, toes, spine segments) must be classified here. */
export function boneRegion(name) {
  if (/^(hand|finger|thumb|palm)/.test(name)) return "hand";
  if (/^(upperarm|forearm)/.test(name)) return "arm";
  if (/^(thigh|shin|foot|toe)/.test(name)) return "leg";
  if (/^(head|neck|jaw)/.test(name)) return "head";
  return "trunk";
}

export const boneSide = (name) => (name.endsWith(".L") ? 1 : name.endsWith(".R") ? -1 : 0);
