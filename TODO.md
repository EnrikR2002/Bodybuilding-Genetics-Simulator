# Production-model handoff

## Objective

Make the simulator's human figure read as a professional bodybuilding anatomy
sculpt, with genetic sliders changing muscle origins, insertions, tendon gaps,
belly lengths, and silhouettes—not moving or resizing smooth blobs.

The most important rule for future work is:

> A genetic endpoint must remain identifiable in an untextured clay render,
> without labels and without comparing measurements.

## Architectural verdict — revised

The previous handoff concluded that only a new authored production sculpt could
fix the figure, and that the alternative was more JavaScript deformation code.
That was a false choice. There was a third option, and it is now shipped.

**The surface is measured off a real dissection instead of described by
formulas.** For every vertex of the *subdivided* mesh, a ray is fired inward at
the Z-Anatomy atlas in the frame of the bone that vertex sits on. What it hits
is, by definition, the structure that shapes the skin there. Subtract the smooth
shape of the limb from those readings and what remains is muscle relief:
bellies proud, the gaps between them sunken, flat tendons flat.

This is not procedural geometry and it is not a hand sculpt. It is a
measurement, and it supplies exactly the thing arcs and bands could not: real
borders, real termination, real negative space, over the whole body at once.

Read `README.md` — "Where the muscle shape comes from" — before changing any of
it.

### What this replaced

| Was | Is |
|---|---|
| Muscle territories from hand-typed angle arcs around each bone | Territories from what the ray actually hits, with the dissection's own borders |
| Definition from valleys inferred where one arc mask meets the next | Definition measured as height against the limb's own smooth shape |
| Detail carried on a 13k control cage and averaged away by subdivision | Detail carried on the 59k subdivided mesh and applied after subdivision |
| Abdominal wall: a cage-resolution corrective too narrow to survive | Authored at render resolution, driven by leanness and the stagger slider |
| A key light fixed to the front, so the back was lit only by rims | The whole light rig turns with the camera |

The generated valleys in `anatomy.js` are kept and turned down to a trace where
the dissection reaches. They still carry the hands, the face and the feet.

## Control strategy: sliders versus selections

Do not remove the current sliders merely to make authoring easier. Endpoint
correctives share one topology, so Blender and Three.js can interpolate between
them in the normal way. A high-insertion shape at `0`, a neutral shape at
`0.5`, and a low-insertion shape at `1` can produce a legitimate continuous
range if the endpoints and midpoint are authored carefully.

Use this decision rule for each genetic trait:

1. Author both endpoint shapes and, where needed, a neutral/midpoint corrective.
2. Render values `0`, `0.25`, `0.5`, `0.75`, and `1` in neutral clay.
3. Keep the slider if the insertion border, tendon interval, volume, and
   silhouette move continuously without melting or inflating.
4. If good interpolation would require excessive compatibility shapes or still
   produces implausible anatomy, change only that UI control to a segmented
   selection such as `High / Average / Low`.

Even when the UI becomes a selection, retain the numeric state internally and
map the choices to `0`, `0.5`, and `1`. This preserves saved states, comparison
logic, measurement code, and the option to restore continuous control later.

Recommended control types:

| Trait type | Preferred control | Fallback |
|---|---|---|
| Muscle mass, leg mass, back development, body fat | Continuous slider | None; these are genuinely continuous |
| Clavicle, rib cage, hips, torso/limb lengths, bone thickness | Continuous slider | Coarser slider steps if morph/rig combinations are expensive |
| Biceps, lat, pec, calf, trap, and ab genetic forms | Continuous authored blend | `High / Average / Low` segmented selection if the blend fails its visual gate |

Do not use a selection model to hide weak endpoint sculpts. The high and low
options still have to be professionally authored and visibly anatomical.

## Start here next session

1. Read this file and the "Where the muscle shape comes from" section of
   `README.md`.
2. Run:

   ```powershell
   npm install
   npm run bake
   npm run build
   node tests/shots.mjs --script tests/scripts/torso.json
   node tests/shots.mjs --script tests/scripts/range.json
   ```

3. Inspect these baselines before editing:

   - `shots/torso-front.png`, `shots/torso-back.png`, `shots/torso-threeq.png`
   - `shots/range-untrained.png` through `shots/range-contest.png`
   - `shots/lat-authored-high-spread.png` and `-low-spread.png`
   - `shots/pose-front-double.png`, `shots/pose-back-double.png`

4. Do not start with shader tuning. The next deliverable is P0 below.

## Current production state

- Runtime body: CC0 MakeHuman body, rig, weights, and morph targets.
- Control cage: 13,380 vertices / 13,378 quads.
- Render mesh after subdivision: 59,292 vertices / 107,024 triangles.
- Runtime bundles: `public/models/body.bin`, `regions.bin`, `anatomy.bin`.
- `anatomy.bin` is the measured surface: 46 structures projected from the
  Z-Anatomy dissection onto every render vertex of the trunk and limbs.
- One shape rebuild takes about 41 ms, which is what a slider drag costs.
- `.tools/blender-runtime/blender-4.5.13-windows-x64/blender.exe` is the local
  Blender used by the authoring scripts. `.tools/` is gitignored.
- The full Z-Anatomy `Startup.blend` in `.assets-cache/` is required to rebuild
  the projection. `assets-src/anatomy-reference/superficial-muscles.blend` is
  the older compact extract, still used by the lat and posterior authoring.
- Licence and attribution files sit next to the assets they cover.

## What is already completed

- [x] A topology-checked endpoint-corrective contract for all seven visible
  genetic traits, in `tools/corrective-contract.mjs`.
- [x] Lat insertion has two authored endpoint targets and reads clearly in the
  rear lat spread at both extremes.
- [x] The whole trunk and both limbs now carry measured anatomical relief:
  deltoid heads, pec borders, serratus, biceps and triceps heads, forearm
  bellies, quadriceps heads, hamstrings, both gastrocnemius heads, the soleus
  break, and the collarbone, shin and hip crest.
- [x] A visible abdominal wall — four rows, linea alba, semilunar lines —
  authored at render resolution and driven by leanness.
- [x] The light rig turns with the camera, so the back is lit when you look at
  it. Ambient occlusion retuned to the width of a real intermuscular groove.
- [x] Bone frames extracted to `tools/mh-frames.mjs` and shared by the region
  bake and the anatomy projection, so the two can never disagree.
- [x] Verified across the full range: an untrained body at 55 % fat shows no
  separation at all, a contest body at 3 % shows all of it.

## Known quality problems

1. **Size still inflates rather than shapes.** `regions.js` adds mass as smooth
   Gaussian pushes along a bone. At extreme back development that produces one
   dome, and the measured relief has to fight it. The next real gain is to give
   the added mass the dissection's own envelope, the same way the definition
   now gets it.
2. The atlas is an ordinary cadaver, so the medial thigh and the medial
   gastrocnemius measure smaller than a trained one. Relief scales with the
   sliders, which covers most of it, but a per-structure development bias may
   be worth authoring.
3. Skin microdetail is still mottled at close range — visible as blotches on
   the upper back. That is the tone and vein maps, not geometry.
4. Back double biceps hands still expose too much finger and palm from the
   rear. This needs a fist corrective, not a larger curl angle.
5. Linear skinning still needs pose-space corrections at the shoulder, axilla,
   elbow, hip, knee and wrist.
6. Only lat insertion has a completed two-endpoint sculpt. The other six
   genetic traits still use the procedural fallback in `regions.js`, which now
   sits underneath a much better surface but is still the weakest link in the
   app's actual argument.

## Recommended order of work

### P0 — Give the mass the same treatment as the definition

This is now the largest remaining visual defect and the cheapest big win.

- [ ] Replace the Gaussian belly in `regions.js` with an envelope derived from
  the measured relief, so growing a muscle grows its own shape rather than a
  blob on its bone.
- [ ] Check it at the extremes first: rear lat spread at mass 0.95 is the pose
  that currently fails.
- [ ] Keep the insertion sliders working through it — they slide the belly
  along the bone, and that has to survive the change.

### P1 — Finish the genetic endpoints

The app's whole argument is the six traits that still fall back to formulas.

- [ ] The projection already reports, per vertex, how far along its own muscle
  each hit landed. That is exactly what an insertion slider needs, and it is
  measured rather than assumed. Drive the remaining traits from it before
  reaching for hand-sculpted endpoint pairs.
- [ ] Traits: biceps insertion, biceps form, pec attachment, rectus
  intersections, calf insertion, trap height.
- [ ] Test each at 0, 0.25, 0.5, 0.75 and 1, in neutral clay, unlabelled.
- [ ] Record a per-trait UI decision after those renders. Keep the continuous
  slider when interpolation passes; otherwise expose High / Average / Low while
  keeping the numeric value 0 / 0.5 / 1 internally.

### P2 — Skin

Geometry now passes. The material is the next thing that dates the figure.

- [ ] Rebuild the tone and vein maps: the current mottling reads as blemishes
  rather than skin at close range.
- [ ] Keep pores and mottling at physically plausible scale.
- [ ] Do not paint muscle boundaries into a texture. They are geometry now.

### P3 — Pose quality

- [ ] Pose-space corrective shapes at shoulder, axilla, elbow, hip, knee,
  wrist, driven by joint angles rather than pose names.
- [ ] A proper fist, which fixes the rear double biceps hands.

### P4 — Regression coverage

- [ ] Add the anatomy map render to the standard regression set.
- [ ] Build labelled and unlabelled contact sheets for every genetic pair, and
  ask the core question: would someone notice the difference with the labels
  hidden?

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
node tests/shots.mjs --script tests/scripts/relief.json
node tests/shots.mjs --script tests/scripts/torso.json
node tests/shots.mjs --script tests/scripts/range.json
node tests/shots.mjs --script tests/scripts/lat-authored.json
node tests/shots.mjs --script tests/scripts/pose-review.json
```

Also run `git diff --check`.

The Vite build reports a chunk-size warning around 700 kB. That is a known
optimisation warning, not a failed build.

## Rebuilding the measured surface

Only needed when the muscle list, the ray density, or the filtering changes.
It needs the full Z-Anatomy file in `.assets-cache/`.

```powershell
$blender = '.tools\blender-runtime\blender-4.5.13-windows-x64\blender.exe'
$atlas   = '.assets-cache\z-anatomy\extracted\Z-Anatomy\Startup.blend'

# once, or whenever the atlas changes: joint centres from its own skeleton
& $blender -b $atlas --python 'tools\blender\export_atlas_joints.py'

npm run anatomy:rays                                    # ~23,000 questions
& $blender -b $atlas --python 'tools\blender\project_anatomy_rays.py'   # ~20 s
npm run anatomy:bake                                    # -> public/models/anatomy.bin
```

Then look at it, which is the only check that counts:

```powershell
node tests/shots.mjs --script tests/scripts/anatomy-map.json
node tests/shots.mjs --script tests/scripts/torso.json
```

## Useful authoring commands

```powershell
# Export/import a manually sculpted endpoint
npm run sculpt:export
npm run sculpt:import -- bicepInsertion 0 path\to\high-bicep.obj
npm run sculpt:import -- bicepInsertion 1 path\to\low-bicep.obj
npm run bake
```

## Important files

- `tools/mh-frames.mjs` — the bone frames both bakes are written in.
- `tools/export-anatomy-rays.mjs` — one question per render vertex.
- `tools/blender/project_anatomy_rays.py` — fires them at the dissection.
- `tools/blender/export_atlas_joints.py` — the atlas's own joint centres.
- `tools/bake-anatomy.mjs` — measurement to relief, borders and territories.
- `src/body/anatomy.js` — how strongly each part of the body shows it.
- `src/body/figure.js` — applies it after subdivision; also the abdominal wall.
- `src/body/params.js` — slider-to-target weights and global correctives.
- `src/body/regions.js` — procedural muscle volume and endpoint fallbacks.
- `src/render/stage.js` — the light rig that turns with the camera.
