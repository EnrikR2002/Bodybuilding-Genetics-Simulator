/* ---------------------------------------------------------------------------
   Which CC0 MakeHuman files the bake pipeline needs.
   Everything listed here is CC0 (see makehuman/LICENSE.ASSETS.md).
   --------------------------------------------------------------------------- */

export const MH_REPO = 'https://github.com/makehumancommunity/makehuman.git';
export const MH_DATA = 'makehuman/data';

/* the base mesh, the skeleton and its skin weights */
export const CORE = [
  '3dobjs/base.obj',
  'rigs/default.mhskel',
  'rigs/default_weights.mhw',
];

/* ---- macro targets ------------------------------------------------------ */
/* We are always male + young, so the ethnicity/gender/age axis collapses to
   a single target. Muscle and weight stay live (3x3 bilinear blend).
   Height and proportions use the average-muscle/average-weight variants:
   the muscle-specific copies differ by under a millimetre and cost 8x more. */
const MUSCLE = ['minmuscle', 'averagemuscle', 'maxmuscle'];
const WEIGHT = ['minweight', 'averageweight', 'maxweight'];

export const MACRO = [
  'targets/macrodetails/caucasian-male-young.target',
  ...MUSCLE.flatMap(m => WEIGHT.map(w =>
    `targets/macrodetails/universal-male-young-${m}-${w}.target`)),
  'targets/macrodetails/height/male-young-averagemuscle-averageweight-minheight.target',
  'targets/macrodetails/height/male-young-averagemuscle-averageweight-maxheight.target',
  'targets/macrodetails/proportions/male-young-averagemuscle-averageweight-idealproportions.target',
  'targets/macrodetails/proportions/male-young-averagemuscle-averageweight-uncommonproportions.target',
];

/* ---- detail targets ----------------------------------------------------- */
const pair = base => [`${base}-incr.target`, `${base}-decr.target`];
const sides = base => ['l', 'r'].flatMap(s => pair(`targets/armslegs/${s}-${base}`));

export const DETAIL = [
  /* limb muscle + fat, sculpted per segment */
  ...sides('upperarm-muscle'),
  ...sides('lowerarm-muscle'),
  ...sides('upperarm-shoulder-muscle'),
  ...sides('upperleg-muscle'),
  ...sides('lowerleg-muscle'),
  ...sides('upperarm-fat'),
  ...sides('lowerarm-fat'),
  ...sides('upperleg-fat'),
  ...sides('lowerleg-fat'),
  /* limb segment lengths and joint girth */
  ...sides('upperarm-scale-vert'),
  ...sides('lowerarm-scale-vert'),
  ...sides('upperleg-scale-vert'),
  ...sides('lowerleg-scale-vert'),
  ...sides('hand-scale'),
  ...sides('foot-scale'),

  /* torso */
  ...pair('targets/torso/torso-muscle-dorsi'),
  ...pair('targets/torso/torso-muscle-pectoral'),
  ...pair('targets/torso/torso-scale-horiz'),
  ...pair('targets/torso/torso-scale-depth'),
  ...pair('targets/torso/torso-scale-vert'),
  ...pair('targets/stomach/stomach-tone'),
  ...pair('targets/stomach/stomach-pregnant'),
  ...pair('targets/hip/hip-scale-horiz'),
  ...pair('targets/hip/hip-scale-depth'),
  ...pair('targets/hip/hip-scale-vert'),
  ...pair('targets/buttocks/buttocks-volume'),
  ...pair('targets/pelvis/pelvis-tone'),
  ...pair('targets/neck/neck-scale-horiz'),
  ...pair('targets/neck/neck-scale-depth'),
  ...pair('targets/neck/neck-scale-vert'),

  /* tape-measure targets: these move one girth without touching the rest */
  ...['shoulder-dist', 'bust-circ', 'underbust-circ', 'waist-circ', 'hips-circ',
      'frontchest-dist', 'napetowaist-dist', 'waisttohip-dist',
      'upperarm-circ', 'upperarm-length', 'lowerarm-length', 'wrist-circ',
      'thigh-circ', 'knee-circ', 'calf-circ', 'ankle-circ',
      'upperleg-height', 'lowerleg-height', 'neck-circ', 'neck-height']
      .flatMap(m => pair(`targets/measure/measure-${m}`)),
];

export const ALL_TARGETS = [...MACRO, ...DETAIL];
export const ALL_FILES = [...CORE, ...ALL_TARGETS];
