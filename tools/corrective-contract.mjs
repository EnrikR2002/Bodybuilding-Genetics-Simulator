/* ---------------------------------------------------------------------------
   Artist-authored genetics correctives.

   Each slider has two endpoint sculpts.  They are additive deltas from the
   authoring-neutral cage exported by tools/export-sculpt-cage.mjs:

     <slider>-0.target   the endpoint named by the slider's left label
     <slider>-1.target   the endpoint named by the slider's right label

   Keeping the contract independent of MakeHuman is deliberate.  The current
   cage can use it today, and a replacement production cage can use the same
   semantic names later.  Missing correctives are legal while assets are being
   authored; the runtime falls back to the older procedural region deformation.
   --------------------------------------------------------------------------- */

export const TRAIT_CORRECTIVES = Object.freeze({
  bicepInsertion: ['High insertion / long distal tendon', 'Low insertion / full distal belly'],
  bicepPeak:      ['Long, flatter belly', 'Shorter, peaked belly'],
  latInsertion:   ['High inferior border', 'Low sweep into the waist'],
  pecGap:         ['Full sternal attachment', 'Wide sternal gap'],
  abStagger:      ['Even rectus intersections', 'Staggered rectus intersections'],
  calfInsertion:  ['High belly / long Achilles', 'Low belly / short Achilles'],
  trapHeight:     ['Low upper-trap sweep', 'High upper traps into the neck'],
});

export const correctiveName = (slider, endpoint) =>
  `correctives/${slider}-${endpoint}`;

export const GLOBAL_CORRECTIVES = Object.freeze([
  'targets/correctives/anatomy-back.target',
]);

export const CORRECTIVE_TARGETS = [...GLOBAL_CORRECTIVES, ...Object.keys(TRAIT_CORRECTIVES).flatMap(slider => [
  `targets/${correctiveName(slider, 0)}.target`,
  `targets/${correctiveName(slider, 1)}.target`,
])];
