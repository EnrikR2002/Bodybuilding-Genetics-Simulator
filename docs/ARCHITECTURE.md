# Physique Studio architecture

This is the map of the Freeman app: which file does what, the rules every
change must keep, and the contracts between modules. Read it before editing.

## The rules that never change

1. **The neutral figure is the artist's sculpt, bit for bit.** With every trait
   at its `DEFAULT` and the anatomy pose, `positions` equals the baked surface
   exactly. `npm test` checks this.
2. **No formula-generated body surface.** Every visible form comes from the
   Mike Freeman sculpt. Traits *move, scale, relax or blend* sculpted surface;
   they never invent a muscle out of a Gaussian bump. Where a trait needs to
   know which muscle a vertex belongs to, it uses the projected anatomy
   (`ctx.anatomy`), not a hand-typed box.
3. **Insertions change attachment anatomy, not just volume.** A belly-length
   trait moves where the belly ends and the tendon begins; the joints do not
   move. A trait must be recognisable in untextured clay with labels hidden.
4. **Poses are reversible and idempotent.** `setPose(a)` then `setPose(b)` then
   `setPose(a)` gives the same surface.
5. **Speed.** `update(state)` plus the re-pose must stay well under 100 ms on a
   desktop (it is about 25 ms for the shape and 20–70 ms for a pose today), so
   a slider can be dragged live.
6. **No real athletes.** Presets are archetypes. Never name or imitate a real
   person.
7. **Verify by looking.** Numbers passing is not enough. Render screenshots and
   look at them.

## Coordinates and data

Centimetres, Y up, +Z forward, +X is the figure's **left**. Floor at y = 0,
crown near y = 180. Vertex order is fixed by `public/models/freeman.bin`; any
per-vertex file must use the same order and count (154,442).

`loadFreeman()` (browser) and `readFreeman()` (node, `tools/read-freeman.mjs`)
return `{ meta, position, normal, uv, skinIndex, skinWeight, index, cover,
smoothPosition, smoothNormal, extraPosition*, extraIndex*, anatomy }`.

## File map and owners

| Area | Files |
|---|---|
| Trait catalogue | `src/freeman/traits.js` — keys, groups, defaults, stops, notes, presets |
| Figure core | `src/freeman/model.js`, `src/freeman/shape/context.js`, `src/freeman/shape/index.js` |
| Shape stages | `src/freeman/shape/{arms,legs,torso,back,condition,frame}.js`; `shape/muscle.js` finds a trait's muscle in the anatomy map (soft masks, bone coordinates) |
| Rig and poses | `tools/blender/bake_freeman.py`, `tools/fix-freeman-weights.mjs` (cleans the baked skin weights), `src/freeman/{pose,poses,bones,geometry}.js` |
| Anatomy map | `tools/blender/project_freeman_anatomy.py`, `tools/bake-freeman-anatomy.mjs`, `tools/freeman-anatomy-*.mjs`, `src/freeman/anatomy.js`, `public/models/freeman-anatomy.*` (CC BY-SA, see its licence file) |
| Rendering | `src/render/stage.js` (lighting presets), `src/freeman/materials.js` (surfaces, anatomy overlay, ghost) |
| Interface | `index.html`, `src/freeman/app.js`, `src/freeman/studio.css`, `src/freeman/ui/controls.js` (sliders), `src/freeman/ui/share.js` (URL state) |
| Measurements | `src/freeman/measure.js`, `src/freeman/ui/metrics.js`, `src/freeman/ui/callouts.js`, `src/freeman/ui/analysis.css`; formulas in `docs/MEASUREMENTS.md` |

When parallel work is under way each worker owns one row and edits nothing
outside it. If you need a change in a file you do not own, put a clear
"integration request" in your report instead of editing it.

## Trait catalogue — `traits.js`

`TRAITS` is an array of `{ key, group, label, stops: [lo, mid, hi], default,
note, muscles, focus, view, pose }`. Keys and the 0 → 1 direction of each trait
are fixed (see the comment at the top of the file); labels, notes and presets
may be improved. `GROUPS` is `insertions | frame` (given) and `development |
condition` (earned). `bodyFatPercent(v)` converts the body-fat trait to an
estimate. `PRESETS` are archetypes; `presetState(id)` returns a full state.

`muscles` uses the anatomy vocabulary below, without the side suffix.
`focus` is one of `arms | chest | abs | torso | back | legs | calves | full`.

## Shape pipeline — `shape/`

```
out = artist surface
  → coverage   (condition.js: body fat relaxes toward smoothPosition)
  → arms, legs, back, torso   (insertion traits move sculpted forms)
  → volume     (condition.js: mass and fat along the relaxed normal)
  → frame      (frame.js: skeleton; also applied to joints and eyes)
```

A stage is:

```js
export default {
  id: "arms",
  traits: ["bicepInsertion", ...],          // keys this stage answers for
  prepare(ctx) { return region; },          // once per sculpt, shared by all figures
  apply(ctx, region, state, out) {},        // rest space; must be an exact no-op at DEFAULT
  applyPose(ctx, region, state, pose, out, rig) {}, // optional: pose shapes (flex, flare)
};
```

`ctx` (from `shape/context.js`) holds `base`, `normal`, `smoothPosition`,
`smoothNormal` (unit), `index`, per-vertex region weights `arm` (includes the
hand), `hand`, `leg`, `head`, the rest rig `bones[name] = { index, head, tail,
axis, length, parent }`, `anatomy` (or null), and `adjacency()` (CSR vertex
neighbours). Helpers: `clamp`, `smooth`, `mix`, `diffuse(ctx, field, passes,
rate, only)` to soften a mask over the surface, `select(ctx, test)`.

Rules for stages: precompute masks and vertex lists in `prepare`; keep `apply`
to typed-array loops over those lists; return early when your traits are at
their defaults; blend every mask smoothly to zero so there is never a visible
seam; never move a vertex of the hands, face or feet unless that is the trait.

`applyPose` runs after the frame edit, before skinning, on the rest surface.
`pose` is the pose definition from `poses.js` (`flex`, `spread`, `vacuum`, …).
`rig.heads` / `rig.tails` are the frame-edited joints as `Vector3` by bone
index.

## Anatomy map — `anatomy.js`

Produced by projecting the Z-Anatomy dissection onto the Freeman surface.
Header `freeman-anatomy.json`:

```json
{ "vertices": 154442,
  "muscles": ["none", "biceps_long.L", "biceps_long.R", ...],
  "groups": { "biceps_long": "arm", ... },
  "landmarks": { "biceps_long.L": { "origin": 1234, "insertion": 5678, "peak": 910, "centroid": 1112 } },
  "blocks": [{ "name": "muscle", "type": "B", "offset": 0, "length": 154442 }, ...] }
```

Blocks, one value per vertex: `muscle` (Uint8 primary id, 0 = none), `muscle2`
(Uint8 secondary id near a border), `blend` (Uint8, weight of the primary ×255),
`along` (Uint8, 0 at the primary's origin → 255 at its insertion). Landmarks
are vertex indices.

`parseAnatomy`, `loadAnatomy`, `attachAnatomy(geometry, anatomy)` (adds
`aMuscle`, `aMuscle2`, `aBlend`, `aAlong` attributes) and `idsFor(anatomy,
names)` are the API.

### Vocabulary (append `.L` / `.R`)

- Neck: `sternocleidomastoid`
- Shoulder: `deltoid_anterior`, `deltoid_lateral`, `deltoid_posterior`
- Chest: `pectoralis_clavicular`, `pectoralis_sternal`, `serratus`
- Arm: `biceps_long`, `biceps_short`, `biceps_tendon`, `brachialis`,
  `triceps_long`, `triceps_lateral`, `triceps_medial`, `brachioradialis`,
  `forearm_flexors`, `forearm_extensors`
- Abdomen: `rectus_abdominis`, `external_oblique`
- Back: `trapezius_upper`, `trapezius_middle`, `trapezius_lower`, `latissimus`,
  `teres_major`, `infraspinatus`, `rhomboid`, `erector_spinae`
- Hip: `gluteus_maximus`, `gluteus_medius`, `tensor_fasciae_latae`
- Thigh: `rectus_femoris`, `vastus_lateralis`, `vastus_medialis`, `sartorius`,
  `adductors`, `gracilis`, `biceps_femoris`, `semitendinosus`,
  `semimembranosus`, `patellar_tendon`
- Lower leg: `gastrocnemius_medial`, `gastrocnemius_lateral`, `soleus`,
  `calcaneal_tendon`, `tibialis_anterior`, `fibularis`
- Bone showing through: `bone_clavicle`, `bone_acromion`, `bone_sternum`,
  `bone_iliac`, `bone_patella`, `bone_tibia`

## Rigging and posing — `pose.js`, `poses.js`

`applyPose(fig, id)`: rest surface → finger curl → stage `applyPose` hooks →
bone aims → CPU dual-quaternion skinning (`geometry.js`) → shoulder relax →
normals. Poses live in `poses.js` as `{ id, name, view, flex, spread, ... }`
and are listed in the UI in array order. The first pose (`anatomy`) is the
artist's stance and must stay unskinned. Bone names are classified in
`bones.js`; a new bone must be classified there.

## Rendering — `stage.js`, `materials.js`

`LIGHTING` (exported from `stage.js`) is a list of `{ id, label, apply(stage) }`;
`stage.setLighting(id)`. `SURFACES` and `TONES` (from `materials.js`) list the
finishes; `fig.setSurface(mode, tone)`. `fig.setOverlay({ mode: "off" | "all"
| "focus", focus: [ids] })` shows the anatomy map (ids from `idsFor`). Each
figure owns its own materials. A `"ghost"` surface, when present, draws a
figure as a see-through outline for overlay comparisons.

## Measurements — `measure.js`

`measure(fig)` reads the rest surface (`fig.restPositions`) and returns plain
numbers: `height`, `weight`, `bodyFatPct`, `leanMass`, `ffmi`, `ffmiAdjusted`,
`shoulders` (bideltoid breadth), `shoulderGirth`, `chest`, `waist`, `hips`,
`neck`, `arm`, `forearm`, `wrist`, `thigh`, `calf`, `ankle`, `ratios`
(`shoulderWaist`, `chestWaist`, `waistHip`, `waistHeight`, `armWrist`,
`legTorso`), `ideal` (classic proportion targets) and `insertion`
(`bicepsGap`, `calfBelly`, `latReach`, …). Centimetres and kilograms.

## Test hooks — `window.__app`

The screenshot harness (`tests/shots.mjs`) and the browser test drive the app
through `window.__app`: `set(state)`, `pose(id)`, `view(azimuth, el, zoom,
target)`, `surface(mode)`, `pin()`, `comparison()`, `choose(key, value)`,
`info()`, `state()`, plus `figure` and `stage`. Keep these working; add to them
freely. `window.__ready` turns true after the first render.

## Checking your work

```sh
npm test                                  # model invariants
npm run test:browser                      # real UI on desktop and mobile
PORT=5191 node tests/shots.mjs --script tests/scripts/freeman-poses.json
npm run build
```

`PORT` lets several checkouts run their own dev servers at once. Screenshots
go to `shots/` (ignored by git). Look at them.
