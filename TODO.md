# Production-model handoff

## Objective

Make the simulator's human figure read as a professional bodybuilding anatomy
sculpt, with genetic sliders changing muscle origins, insertions, tendon gaps,
belly lengths, and silhouettes—not moving or resizing smooth blobs.

The most important rule for future work is:

> A genetic endpoint must remain identifiable in an untextured clay render,
> without labels and without comparing measurements.

## Start here next session

1. Read this file, `README.md`, and `assets-src/authoring/README.md`.
2. Run:

   ```powershell
   npm install
   npm run bake
   npm run build
   node tests/shots.mjs --script tests/scripts/lat-authored.json
   node tests/shots.mjs --script tests/scripts/pose-review.json
   ```

3. Inspect these current baselines before editing:

   - `shots/lat-authored-high-spread.png`
   - `shots/lat-authored-low-spread.png`
   - `shots/lat-authored-high-double.png`
   - `shots/lat-authored-low-double.png`
   - `shots/pose-front-double.png`
   - `shots/pose-back-double.png`
   - `shots/pose-side-chest.png`
4. Keep the stable MakeHuman runtime cage until a replacement passes every
   pose. Do not switch the browser build to the Blender Studio mesh merely
   because its neutral render looks better.

## Current production state

- Runtime body: CC0 MakeHuman body, rig, weights, and morph targets.
- Control cage: 13,380 vertices / 13,378 quads.
- Render mesh after subdivision: 107,024 triangles.
- Runtime bundle: `public/models/body.bin`.
- Muscle-region bundle: `public/models/regions.bin`.
- Stable production source remains MakeHuman. The binary header should say
  `source: "makehuman"`.
- `assets-src/studio-base/realistic_human_base.blend` is a CC BY authoring
  reference. Automatic and nearest-weight transfers were tested and produced
  unacceptable shoulder/hip tearing. `tools/studio-source.mjs` remains for
  research, not for the production bake.
- `assets-src/anatomy-reference/superficial-muscles.blend` is the compact
  Z-Anatomy / BodyParts3D reference containing separated superficial muscles.
- `.tools/blender-runtime/blender-4.5.13-windows-x64/blender.exe` is the local
  Blender executable used by the authoring scripts. `.tools/` is gitignored.
- Licence and attribution files are next to the corresponding source assets.

## What is already completed

- [x] A topology-checked endpoint-corrective contract exists for all seven
  visible genetic traits in `tools/corrective-contract.mjs`.
- [x] `npm run sculpt:export` exports the exact neutral authoring cage.
- [x] `npm run sculpt:import -- <trait> <0|1> <file.obj>` validates and imports
  manually sculpted endpoint meshes.
- [x] Lat insertion has two authored endpoint targets:
  `latInsertion-0.target` and `latInsertion-1.target`.
- [x] High lat insertion exposes a flatter lumbar interval and terminates the
  inferior muscular border higher.
- [x] Low lat insertion carries the lat sheet toward the waist/iliac region.
- [x] A global, leanness-dependent posterior corrective exists at
  `assets-src/targets/correctives/anatomy-back.target`.
- [x] The posterior target uses separately normalised Z-Anatomy fields for
  lats, trapezius, rhomboids, and teres, plus paired erector columns.
- [x] Atlas posterior depth is transferred only on the back-facing axis so
  production rig landmarks and topology remain stable.
- [x] Muscle valleys and broad planes were strengthened in
  `src/body/anatomy.js`; shader cavity response was strengthened in
  `src/render/skin.js`.
- [x] Front/rear double-biceps arms were lowered from the old hands-over-head
  pose. Side-chest and side-triceps feet are now planted cleanly.
- [x] Rear-camera pose review was corrected in
  `tests/scripts/pose-review.json`.

## Known quality problems

These are the reasons the whole figure is not yet studio-grade:

1. The neutral MakeHuman surface is still too generic. It lacks authored
   deltoid heads, biceps/triceps transitions, pec borders, quad heads,
   hamstrings, calves, and convincing tendon planes.
2. Most of the body still gets its muscularity from broad procedural region
   pushes in `src/body/regions.js`. Those are useful for volume but cannot
   establish professional anatomy by themselves.
3. Only lat insertion has a completed two-endpoint sculpt. The other six
   genetic traits still use procedural fallbacks.
4. Extreme back development can become too wide relative to arms and delts.
   Do not tune this purely by reducing overall size; correct the muscle planes
   first, then rebalance bulk.
5. Back double-biceps hands still expose too much finger/palm geometry from the
   rear. Increasing `curl` beyond roughly 2.2 created claw-like fists, so this
   needs a better hand pose or fist corrective rather than a larger angle.
6. Linear skinning still needs pose-space corrections at the shoulder/axilla,
   elbow, hip, knee, and wrist for genuinely polished stage poses.
7. Skin microdetail can look noisy or mottled at close range. Geometry must
   pass a flat-clay test before spending time on material polish.

## Recommended order of work

### P0 — Author a professional neutral muscular surface

This is the highest-value task. Do it before small UI or shader refinements.

- [ ] Build a Blender authoring scene containing:
  - `assets-src/authoring/neutral-cage.obj` as the only sculpted/exported body;
  - `assets-src/anatomy-reference/superficial-muscles.blend` as anatomical
    reference geometry;
  - `assets-src/studio-base/realistic_human_base.blend` as surface/topology
    reference only.
- [ ] Sculpt or script a full-body neutral corrective on the production cage.
  Suggested target name: `correctives/anatomy-neutral.target`.
- [ ] Work from large forms to small forms:
  1. rib cage, pelvis, clavicles, scapulae, and limb cylinders;
  2. pec/delt/lat/upper-arm transitions;
  3. quad/adductor/hamstring and glute transitions;
  4. calf heads, soleus, Achilles, knees, elbows, wrists, and ankles;
  5. negative space and tendon planes.
- [ ] Use the Z-Anatomy meshes to locate irregular muscle outlines and surface
  depth. Do not replace them with ellipsoids or Gaussian blobs.
- [ ] Prefer shallow changes of plane over deep engraved grooves. A muscle
  border should be visible because adjacent planes meet, not because a dark
  line was cut around it.
- [ ] Apply the neutral anatomy target according to muscle mass and body fat in
  `src/body/params.js`, similarly to `correctives/anatomy-back`.
- [ ] Review the target with the skin shader simplified to neutral clay. It
  must improve front, side, and back views before it is accepted.

If scripting the projection, generalise the proven back workflow instead of
starting over:

- `tools/blender/project_back_reference.py` projects separated atlas surfaces.
- `tools/author-back-anatomy.mjs` turns those fields into a compatible target.
- Add front/arm/leg groups with independent near/far distance profiles.
- Transfer only the appropriate local depth axis for each body region.
- Keep per-muscle support fields separate so broad superficial muscles cannot
  erase smaller neighbours.

### P1 — Complete all genetic endpoint sculpts

Author both endpoints, validate them in multiple poses, and only then disable
the corresponding fallback. Recommended order is based on visual impact:

- [ ] `bicepInsertion-0/1`
  - high insertion: long distal tendon and clear elbow gap;
  - low insertion: belly continues toward the elbow without merely enlarging;
  - preserve approximately equal upper-arm volume between endpoints.
- [ ] `bicepPeak-0/1`
  - long, flatter belly versus shorter, peaked belly;
  - change longitudinal form, not arm circumference alone.
- [ ] `pecGap-0/1`
  - full sternal attachment versus wider sternal gap;
  - reshape the inner border and sternum plane without moving nipples or
    inflating the outer chest.
- [ ] `calfInsertion-0/1`
  - high belly/long Achilles versus low belly/short Achilles;
  - preserve separate medial and lateral gastrocnemius heads.
- [ ] `trapHeight-0/1`
  - low upper-trap sweep versus high traps climbing into the neck;
  - keep neck circumference and shoulder width stable.
- [ ] `abStagger-0/1`
  - even versus staggered tendinous intersections;
  - maintain the linea alba and avoid painted six-pack rectangles.

For every pair:

1. Export/import through the existing authoring commands.
2. Confirm `addAuthoredTrait()` detects both endpoints.
3. Ensure the fallback in `src/body/regions.js` becomes neutral when the pair
   is present; never stack a full procedural bulge under an authored sculpt.
4. Add a focused Playwright screenshot script like `lat-authored.json`.
5. Test values `0`, `0.25`, `0.5`, `0.75`, and `1` for smooth interpolation.

### P2 — Add pose-space correctives

- [ ] Extend the corrective contract to support pose-space targets.
- [ ] Author at least these paired/weighted corrections:
  - shoulder elevation and external rotation;
  - lat-spread axilla fill without an armpit hole;
  - elbow flexion, including biceps bunching and triceps lengthening;
  - side-chest shoulder/pec compression;
  - hip flexion and planted-knee tracking;
  - calf contraction and ankle plantar flexion;
  - wrist/fist shape for front and rear double-biceps.
- [ ] Drive pose targets from actual joint angles in `src/pose/ik.js`, not only
  from the pose name, so they work across different limb proportions.
- [ ] Consider dual-quaternion skinning only after pose targets are tested.
  Replacing the skinning system is higher-risk than adding focused correctives.

### P3 — Rebalance bodybuilding proportions

Do this after P0/P1, because tuning bulk against the current smooth surface can
hide anatomical problems.

- [ ] Review `BULK` and the back drive multiplier in `src/body/regions.js`.
- [ ] Reduce the tendency for an extreme rear lat spread to become a single
  square sheet while retaining a clear high/low insertion silhouette.
- [ ] Bring delts, biceps, triceps, forearms, glutes, and hamstrings into better
  proportion with the current back and calves.
- [ ] Check all slider extremes for believable circumference and silhouette.
- [ ] Keep the protected waist/taper logic in `src/body/params.js` unless a
  measurement test proves it is wrong.

### P4 — Finish the pose library

- [ ] Replace the double-biceps hand curl with either a proper fist pose or a
  small hand pose-space corrective. Do not simply increase finger curl.
- [ ] Compare each pose against real bodybuilding stage references:
  - elbows and wrists;
  - scapular position;
  - rib-cage lift;
  - hip/knee/foot placement;
  - which muscles should shorten or lengthen.
- [ ] Review front double, front lat, side chest, side triceps, back double,
  rear lat, most muscular, abs-and-thigh, vacuum, and relaxed at short and long
  limb extremes.
- [ ] Ensure both feet contact the floor unless the pose deliberately uses a
  controlled toe stance.

### P5 — Material and presentation polish

Only start this after clay renders pass.

- [ ] Reduce close-up skin mottling and make pore scale consistent across the
  torso, limbs, hands, and face.
- [ ] Make roughness/specular respond more subtly to stretched versus compressed
  skin.
- [ ] Tune cavity darkening so it supports real geometry without drawing fake
  borders.
- [ ] Improve hair and eyebrow repetition if they remain visible in final
  framing.
- [ ] Verify lighting with a neutral clay material and the production skin
  material; neither should be required to hide malformed geometry.

## Visual acceptance gates

Do not call a model or endpoint complete until all relevant checks pass:

- [ ] The difference is obvious in flat clay with callouts disabled.
- [ ] The endpoint changes attachment/termination anatomy, not only volume.
- [ ] Midpoint blends are smooth and do not collapse the mesh.
- [ ] No shoulder, axilla, hip, elbow, knee, wrist, or ankle tearing.
- [ ] No dark painted line is doing the work of missing geometry.
- [ ] Fat appropriately covers separation without changing the insertion.
- [ ] Low muscle mass reduces prominence without moving attachment points.
- [ ] Front, side, back, and three-quarter silhouettes remain believable.
- [ ] All principal stage poses pass at normal and extreme body proportions.
- [ ] Measurements remain within a plausible range and do not jump between
  neighbouring slider values.

## Required regression commands

Run these after any production anatomy, rig, or pose change:

```powershell
npm run bake
npm run build
node tests/shots.mjs --script tests/scripts/lat-authored.json
node tests/shots.mjs --script tests/scripts/pose-review.json
```

Also run:

```powershell
git diff --check
```

The Vite build currently reports a chunk-size warning around 691 kB. That is a
known optimisation warning, not a failed build and not the current art-quality
bottleneck.

## Useful authoring commands

```powershell
# Rebuild the current atlas-derived lat map
$blender = '.tools\blender-runtime\blender-4.5.13-windows-x64\blender.exe'
& $blender -b 'assets-src\anatomy-reference\superficial-muscles.blend' `
  --python 'tools\blender\project_lat_reference.py'
npm run sculpt:lats

# Rebuild the current posterior atlas map/target
& $blender -b 'assets-src\anatomy-reference\superficial-muscles.blend' `
  --python 'tools\blender\project_back_reference.py'
npm run sculpt:back

# Export/import a manually sculpted endpoint
npm run sculpt:export
npm run sculpt:import -- bicepInsertion 0 path\to\high-bicep.obj
npm run sculpt:import -- bicepInsertion 1 path\to\low-bicep.obj
npm run bake
```

## Important files

- `src/body/params.js` — slider-to-target weights and global correctives.
- `src/body/regions.js` — procedural muscle volume and endpoint fallbacks.
- `src/body/anatomy.js` — negative-space seams and broad muscle planes.
- `src/body/figure.js` — deformation/subdivision/skinning pipeline.
- `src/pose/ik.js` — limb solver and finger curl.
- `src/data/poses.js` — stage-pose targets.
- `src/render/skin.js` — skin, cavity, ridge, vein, and striation shading.
- `tools/corrective-contract.mjs` — accepted corrective names.
- `tools/import-corrective.mjs` — topology/scale validation.
- `tools/author-lat-correctives.mjs` — current lat endpoint generator.
- `tools/author-back-anatomy.mjs` — current atlas posterior generator.
- `tools/blender/project_lat_reference.py` — atlas lat projection.
- `tools/blender/project_back_reference.py` — posterior atlas projection.
- `assets-src/authoring/neutral-cage.obj` — the production sculpt cage.
- `assets-src/anatomy-reference/` — compact anatomy source, maps, and licence.
- `assets-src/studio-base/` — realistic authoring reference and licence.
- `assets-src/targets/correctives/` — sparse runtime sculpt targets.

## Do not repeat these failed approaches

- Do not enable the Blender Studio surface in the runtime with the current
  transferred weights. Both automatic weights and nearest MakeHuman weight
  transfer produced visible tearing in stage poses.
- Do not use a smooth free basemesh just because its neutral face is nicer. It
  must be genuinely muscular, legally redistributable, and rig-compatible.
- Do not bypass account-gated downloads or assume “free to download” means the
  asset can be redistributed in this project.
- Do not fake insertions by changing only the size or position of a radial
  region push.
- Do not deepen every muscle outline into an engraved trench.
- Do not use shader lines as a substitute for silhouette and surface planes.
- Do not retune the entire body around a single close-up or single pose.
- Do not remove the stable MakeHuman fallback until the replacement passes the
  complete pose and slider review.

## Definition of the next meaningful milestone

The next session should aim to finish one coherent milestone rather than touch
every item lightly:

> A full-body neutral anatomy corrective plus the biceps insertion pair,
> reviewed in clay across front double-biceps, rear double-biceps, relaxed,
> and side-chest poses, with no deformation regressions.

That milestone will improve every view and prove that the endpoint workflow can
scale beyond the completed lat example.
