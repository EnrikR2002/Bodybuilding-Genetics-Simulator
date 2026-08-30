/* ---------------------------------------------------------------------------
   The eighteen sliders, the archetypes, and the judging copy.

   Split into what you were given and what you earned, because that split is
   the whole argument of the page: fourteen of these eighteen were decided
   before anyone touched a weight.
   --------------------------------------------------------------------------- */

const pick = (s, list) => list[Math.min(list.length - 1, Math.floor(s * list.length))];

export const SLIDERS = [
  { g: 'grpFrame', k: 'clavicle', label: 'Clavicle width', lo: 'Narrow', hi: 'Wide',
    unit: (s, m) => `${m.shoulder.toFixed(0)} cm across delts` },
  { g: 'grpFrame', k: 'ribcage', label: 'Rib cage', lo: 'Shallow', hi: 'Barrel',
    unit: (s, m) => `${m.ribWidth.toFixed(0)} cm wide` },
  { g: 'grpFrame', k: 'hipWidth', label: 'Pelvis width', lo: 'Narrow', hi: 'Wide',
    unit: (s, m) => `${m.hipWidth.toFixed(0)} cm across` },
  { g: 'grpFrame', k: 'torsoLength', label: 'Torso length', lo: 'Short', hi: 'Long',
    unit: (s, m) => `${m.torso.toFixed(0)} cm` },
  { g: 'grpFrame', k: 'armLength', label: 'Arm length', lo: 'Short', hi: 'Long',
    unit: (s, m) => `${m.armLength.toFixed(0)} cm` },
  { g: 'grpFrame', k: 'legLength', label: 'Leg length', lo: 'Short', hi: 'Long',
    unit: (s, m) => `${m.legLength.toFixed(0)} cm` },
  { g: 'grpFrame', k: 'boneThickness', label: 'Joint thickness', lo: 'Fine', hi: 'Thick',
    unit: s => `${pick(s, ['fine', 'light', 'average', 'sturdy', 'thick'])} wrists & ankles` },

  { g: 'grpIns', k: 'bicepInsertion', label: 'Biceps insertion', lo: 'High', hi: 'Low',
    unit: s => s < 0.33 ? 'long tendon, big gap' : s < 0.66 ? 'a finger and a half' : 'belly runs to the elbow' },
  { g: 'grpIns', k: 'bicepPeak', label: 'Biceps shape', lo: 'Flat', hi: 'Peaked',
    unit: s => s < 0.4 ? 'long and flat' : s < 0.7 ? 'moderate peak' : 'high peak, short belly' },
  { g: 'grpIns', k: 'latInsertion', label: 'Lat insertion', lo: 'High', hi: 'Low',
    unit: s => s < 0.35 ? 'sweep starts high' : s < 0.7 ? 'mid attachment' : 'sweep starts at the waist' },
  { g: 'grpIns', k: 'pecGap', label: 'Pec attachment', lo: 'Full inner', hi: 'Wide gap',
    unit: s => s < 0.35 ? 'pecs meet at the sternum' : s < 0.7 ? 'slight separation' : 'wide sternal gap' },
  { g: 'grpIns', k: 'abStagger', label: 'Ab insertion', lo: 'Blocky', hi: 'Staggered',
    unit: s => s < 0.35 ? 'even, squared rows' : s < 0.7 ? 'slightly offset' : 'staggered left to right' },
  { g: 'grpIns', k: 'calfInsertion', label: 'Calf insertion', lo: 'High', hi: 'Low',
    unit: s => s < 0.35 ? 'diamond, long achilles' : s < 0.7 ? 'mid belly' : 'full down to the ankle' },
  { g: 'grpIns', k: 'trapHeight', label: 'Trap attachment', lo: 'Low', hi: 'High',
    unit: s => s < 0.4 ? 'low, square shoulders' : s < 0.75 ? 'moderate' : 'high traps into the neck' },

  { g: 'grpCond', k: 'mass', label: 'Upper-body mass', lo: 'Untrained', hi: 'Extreme',
    unit: s => pick(s, ['untrained', 'trained', 'advanced', 'competitive', 'elite']) },
  { g: 'grpCond', k: 'legMass', label: 'Leg development', lo: 'Neglected', hi: 'Extreme',
    unit: (s, m) => `${m.thigh.toFixed(0)} cm thigh` },
  { g: 'grpCond', k: 'backThickness', label: 'Back thickness', lo: 'Flat', hi: 'Dense',
    unit: s => s < 0.4 ? 'flat' : s < 0.75 ? 'thick' : 'slabs' },
  { g: 'grpCond', k: 'bodyFat', label: 'Body fat', lo: 'Shredded', hi: 'Off-season',
    unit: s => `${(4 + s * 21).toFixed(1)}% body fat` },
];

export const SLIDER_BY_KEY = Object.fromEntries(SLIDERS.map(s => [s.k, s]));

export const DEFAULT = {
  clavicle: 0.62, ribcage: 0.55, hipWidth: 0.34, torsoLength: 0.48, armLength: 0.5,
  legLength: 0.5, boneThickness: 0.42, bicepInsertion: 0.45, bicepPeak: 0.6,
  latInsertion: 0.6, pecGap: 0.4, abStagger: 0.3, calfInsertion: 0.5, trapHeight: 0.5,
  mass: 0.62, legMass: 0.6, backThickness: 0.55, bodyFat: 0.2,
};

export const PRESETS = [
  { n: 'Classic', v: { clavicle: .82, ribcage: .5, hipWidth: .16, torsoLength: .4, armLength: .55, legLength: .6, boneThickness: .24, bicepInsertion: .5, bicepPeak: .8, latInsertion: .78, pecGap: .32, abStagger: .2, calfInsertion: .42, trapHeight: .3, mass: .52, legMass: .5, backThickness: .45, bodyFat: .1 } },
  { n: 'Mass', v: { clavicle: .7, ribcage: .92, hipWidth: .62, torsoLength: .55, armLength: .32, legLength: .32, boneThickness: .86, bicepInsertion: .62, bicepPeak: .4, latInsertion: .55, pecGap: .55, abStagger: .62, calfInsertion: .6, trapHeight: .92, mass: 1, legMass: .95, backThickness: .95, bodyFat: .46 } },
  { n: 'Long limbs', v: { clavicle: .5, ribcage: .34, hipWidth: .3, torsoLength: .2, armLength: .95, legLength: .95, boneThickness: .18, bicepInsertion: .12, bicepPeak: .78, latInsertion: .28, pecGap: .82, abStagger: .5, calfInsertion: .1, trapHeight: .62, mass: .46, legMass: .34, backThickness: .4, bodyFat: .28 } },
  { n: 'Compact', v: { clavicle: .56, ribcage: .78, hipWidth: .72, torsoLength: .82, armLength: .1, legLength: .1, boneThickness: .9, bicepInsertion: .86, bicepPeak: .22, latInsertion: .82, pecGap: .22, abStagger: .42, calfInsertion: .84, trapHeight: .72, mass: .82, legMass: .86, backThickness: .88, bodyFat: .66 } },
  { n: 'All high', v: { bicepInsertion: 0, bicepPeak: .9, latInsertion: 0, pecGap: .85, calfInsertion: 0, abStagger: .5, trapHeight: .85 } },
  { n: 'All low', v: { bicepInsertion: 1, bicepPeak: .28, latInsertion: 1, pecGap: .08, calfInsertion: 1, abStagger: .15, trapHeight: .25 } },
];

/* ---------------------------------------------------------------------------
   Judging notes. Same argument as the original plate, unchanged.
   --------------------------------------------------------------------------- */
export function judge(S) {
  const out = [];
  const bi = S.bicepInsertion, li = S.latInsertion, ci = S.calfInsertion;
  const cl = S.clavicle, hp = S.hipWidth;

  out.push(['Arms', bi < 0.35
    ? 'A high biceps insertion leaves a visible gap between the muscle belly and the elbow. It peaks higher when flexed but the arm looks shorter and empties out near the joint. No amount of curling fills that gap.'
    : bi < 0.7 ? 'An average biceps insertion — about a finger and a half of tendon showing at the elbow crease when flexed.'
    : 'A low insertion means the belly runs almost to the elbow. The arm looks full and thick from every angle but tends to peak less.']);

  out.push(['Back', li < 0.35
    ? 'High lat insertions leave a gap between the lat and the top of the pelvis. Width has to come from the clavicles, because the sweep starts too high to reach the waist.'
    : li < 0.7 ? 'Mid lat insertions: the sweep starts around the bottom of the rib cage.'
    : 'Low lat insertions carry the sweep down to the waist. This is the cheat code for width from the back — the taper reads even when relaxed.']);

  out.push(['Calves', ci < 0.35
    ? 'A high calf insertion gives a short, diamond-shaped belly over a long achilles tendon. Hardest body part on the board to make look big.'
    : ci < 0.7 ? 'Mid calf insertion — a normal belly with a visible tendon.'
    : 'A low calf insertion fills the leg almost to the ankle. Calves look developed even untrained.']);

  const vt = cl - hp;
  out.push(['Frame', vt > 0.35
    ? 'Wide clavicles over a narrow pelvis. This is the structural jackpot: the taper exists before any muscle is added.'
    : vt > 0.1 ? 'A workable frame — clavicles clear the hips, so added lat and delt mass will read as width.'
    : 'Clavicles and pelvis are close in width. Width has to be bought with delt and lat mass, and the waist will always fight it.']);

  if (S.bodyFat > 0.55) {
    out.push(['Condition', 'At this body fat the separations close up. Every insertion on this page is still there — it just cannot be seen. This is why the same physique scores differently in April and October.']);
  } else if (S.bodyFat < 0.15) {
    out.push(['Condition', 'Contest-lean. Ab insertions, serratus and the lower pec line are all visible — for better or worse, structure has nowhere to hide.']);
  }

  out.push(['The honest part', 'Four of the eighteen sliders on this page respond to training. The other fourteen were set at birth. Judging a physique — including your own — without accounting for that is judging a hand of cards as if the player chose them.']);
  return out;
}
