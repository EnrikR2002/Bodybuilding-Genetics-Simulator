# Insertion — a physique genetics plate

An interactive 3D figure whose muscle insertion points and skeleton you can
change with sliders, pose in ten IFBB poses, and measure with a tape.

The point of the app is the thing you cannot train. Fourteen of the eighteen
sliders were decided before anyone touched a weight; four of them respond to
work. The figure exists to make that difference visible.

---

## Run it

```bash
npm install
```

```bash
npm run dev
```

Then open http://localhost:5188.

The mesh and muscle map are already built and committed under `public/models/`.
You only need the steps below if you want to rebuild them.

---

## Where the body comes from

The current control cage is the MakeHuman base body, released as CC0 in 2020 by
Data Collection AB, Joel Palmius and Jonas Hauquier. Along with the mesh, the
project uses MakeHuman's CC0 skeleton, skin weights, and 144 sculpted morph
targets. Those assets provide proportion and body-composition changes; they do
**not** provide bodybuilding-quality muscle insertions.

The production path therefore accepts a separate set of artist-authored trait
correctives. When a complete endpoint pair is installed, it replaces the
generated region deformation for that slider. Until then, the older
bone-derived region map remains only as a visible fallback. The first accepted
pair is the lat-insertion range; its inferior border is projected from the
separated Z-Anatomy latissimus meshes and then sculpted into two distinct
topology-matched endpoints.

| Asset | Licence | Used for |
|---|---|---|
| MakeHuman `base.obj` | CC0 | the body: 13,378 quads, quad-dominant, UV-unwrapped |
| MakeHuman `default.mhskel` + `default_weights.mhw` | CC0 | 163-bone rig and skin weights |
| MakeHuman morph targets (144 of them) | CC0 | mass, body fat, frame, limb lengths, girths |
| Z-Anatomy / BodyParts3D superficial muscles | CC BY-SA 4.0 / CC BY-SA 2.1 Japan | anatomical outlines, posterior surface planes, and lat insertion endpoints |
| Blender Studio realistic human base by Julien Kaspar | CC BY | authoring and topology reference; not shipped as the runtime cage |
| Poly Haven `brown_photostudio_02` | CC0 | studio HDRI for image-based lighting |

Licence text and attribution are copied into `assets-src/` next to the assets
they cover. The Blender Studio mesh was evaluated as a replacement surface,
but its transferred skin weights did not pass the pose-deformation gate. It is
kept as an authoring reference rather than pretending a prettier neutral mesh
is production-ready when shoulders and hips tear in motion.

---

## How a slider becomes a body

Every shape change runs the same chain, start to finish, inside one frame:

```
rest cage (13,378 quads)
  -> sculpted morph targets        params.js   size, frame, body composition
  -> authored trait correctives    params.js   real insertion endpoint sculpts
  -> atlas surface relief          params.js   separated posterior muscle planes
  -> procedural fallback           regions.js  only for missing endpoint pairs
  -> definition / softening        regions.js  lean sharpens, fat blurs
  -> Catmull-Clark subdivision     subdiv.js   107,024 triangles
  -> normals
  -> skeleton rebuilt from the same cage
```

Four things in there are worth knowing about.

**The skeleton is derived from the mesh.** MakeHuman stores each joint as a
group of helper vertices sitting inside the body. Those vertices are part of the
mesh, so a morph that widens the pelvis moves the hip joints with it. There is
nothing to keep in sync, because there is only one thing — which is why the mesh
never tears at the shoulder when a slider moves.

**Production insertions are authored shapes, not size changes.** Each slider has
two vertex-matched endpoint sculpts. For example, the lat endpoints change the
inferior border, exposed lumbar fascia, tendon transition, and silhouette as a
single controlled shape. `regions.js` supplies an interim approximation only
when those assets have not yet been installed.

**The fallback muscle map is derived, not painted.** `tools/bake-regions.mjs` builds a
frame that follows each bone run, then asks of every vertex: how far along, what
angle around, and does the rig already agree this vertex belongs to that limb.
The rig check is what stops the biceps region leaking onto the ribs.
`shots/regions-front.png` is the debug render used to check it.

**Body fat and definition are the same operation with the sign flipped.** Fat
blends the surface toward a Laplacian-smoothed copy of itself; being lean and
full blends it away. That is what actually happens to a physique between April
and October, and it is why the same insertion sliders read as nothing at 25 %
body fat and as everything at 5 %.

**The taper is protected.** Rib cage, back thickness and upper-body mass all
widen the chest, and the sculpted body-composition targets drag the waist along
with them. Left alone, every slider at the top turns the torso into a rectangle.
The waist is taken back down by a share of whatever widened the chest, so the
figure gets bigger without ever losing its shape. The two macro axes are also
capped short of their maximum, because MakeHuman's max-muscle-max-weight sculpt
is a strongman — a barrel with no waist — and the muscle map does a better job
of the last of the size, because it shapes rather than inflates.

---

## What makes it read as a body rather than a mannequin

Beyond the shape, four things carry most of the realism. All four are driven by
the same sliders, so they arrive and leave for the right reasons.

**Bone.** Narrow ridges where the skin lies straight on the skeleton — the
collarbone, the sternum, the hip crest, the shoulder blade, the point of the
elbow, the kneecap, the shin, the ankle bones, the achilles. They are driven by
leanness alone and have nothing to do with muscle, so they appear as the fat
comes off and vanish as it goes back on.

**Veins.** Ridged noise stretched along the limb, masked to the forearms,
biceps, delts and calves, and gated to appear only on a lean arm with something
in it. Sampling a fine noise octave gives a dense mesh of closed loops that
reads as snakeskin; sampling the coarsest one puts the lines four or five
centimetres apart, which is where veins actually sit.

**Striations.** The fibre bundles of a muscle showing through the skin. The bake
works out which way the fibres run at every vertex from the bone frames — with
the pec, lat and trap overridden to fan toward the arm — and the shader stretches
its noise along that direction. Striations need lean, full *and* contracted all
at once, which is why they are the thing every competitor is chasing on stage.

**Skin colour.** Hands, face and feet run redder because the blood is closer to
the surface; knuckles, elbows and knees run darker; a shaved jaw runs cooler;
and a broad drift stops the body being one flat tone from neck to ankle.

---

## Posing

A pose says where the hands and feet go, in fractions of the limb's own length,
read in the body's own frame. A closed-form two-bone solver works out the
angles. Hand-tuned Euler angles look right on one body and put the hands through
the head on a longer-armed one; a target does not have that problem.

Poses where the hands meet use one shared grip target measured from the
shoulder midpoint. That keeps side-chest, side-triceps and most-muscular grips
together when arm length or clavicle width changes, instead of solving two
independent hands that only happen to meet on the default body.

The elbow can only bend one way because the pole vector fixes the plane before
the angle is applied, and the humerus cannot twist into a candy wrapper because
the roll is clamped and shared between the twist bones the way a real forearm
shares pronation.

The shoulder girdle moves with the arm — roughly a third of the humerus swing
goes to the clavicle. That is how a real shoulder works, and it also fixes the
worst artefact in the whole app: with the entire rotation on one joint, linear
blend skinning collapses the vertices split between the arm and the torso, their
triangles go to zero area, and you can see the backdrop through the armpit.
Sharing the rotation out fixes the anatomy and the hole together. Displacement is
damped in every joint blend zone for the same reason, and the skin renders
double-sided so a deep crease can never show through as a hole.

Poses also change the body, not only its angles: a lat spread genuinely widens
the back, a vacuum genuinely empties the waist, and a flexed muscle is a
different shape from a relaxed one. Those go through the same sculpt system the
sliders use.

---

## Rendering

- Studio HDRI through `PMREMGenerator`, plus a key, a cool fill and two rims
- `MeshPhysicalMaterial` patched with `onBeforeCompile`: triplanar skin detail
  (no UV seams, no stretching at the armpit), curvature-driven cavity darkening,
  wrap-lit subsurface with a warm terminator, and oiled specular that pools on
  the high points and skips the creases
- `EffectComposer`: GTAO → bloom → ACES tone mapping → sRGB → SMAA
- Soft shadows with `normalBias` tuned so a curved body does not stripe itself

---

## Rebuilding the assets

```bash
npm run assets && npm run bake
```

`npm run assets` clones MakeHuman (blobless, shallow) into `.assets-cache/` and
copies out the 147 files listed in `tools/assets-manifest.mjs`.
`npm run bake` writes `public/models/body.bin` and `public/models/regions.bin`.
Both take a few seconds.

## Authoring production anatomy

```bash
npm run sculpt:export
npm run sculpt:import -- latInsertion 0 path/to/high-lat.obj
npm run sculpt:import -- latInsertion 1 path/to/low-lat.obj
npm run bake
```

The exporter writes the exact vertex-ordered neutral cage an anatomy artist
should use. The importer validates topology and scale, converts an endpoint OBJ
to a sparse runtime target, and the next bake picks it up automatically. The
complete fourteen-sculpt contract and its visual acceptance tests live in
`assets-src/authoring/README.md`.

The checked-in lat and back assets can be regenerated without opening Blender's
sculpt UI:

```bash
# Project the Z-Anatomy latissimus meshes, then author both insertion endpoints
blender -b assets-src/anatomy-reference/superficial-muscles.blend \
  --python tools/blender/project_lat_reference.py
npm run sculpt:lats

# Project the separated posterior muscles and rebuild their surface relief
blender -b assets-src/anatomy-reference/superficial-muscles.blend \
  --python tools/blender/project_back_reference.py
npm run sculpt:back
npm run bake
```

The posterior corrective transfers atlas depth only along the back-facing axis;
it deliberately retains the production cage's X/Y topology and rig landmarks.
Each muscle is normalised independently before its outline is traced, so the
broad superficial lat cannot erase the deeper teres, rhomboid, and trapezius
planes simply by being the nearest object everywhere.

---

## Looking at it

There is no substitute for opening the images. `tests/shots.mjs` drives the real
app in Playwright and writes PNGs to `shots/`; `tests/sheet.mjs` lays a batch of
them out as one contact sheet.

```bash
node tests/shots.mjs --script tests/scripts/verify.json && node tests/sheet.mjs v- sheet-poses.png 5
```

Useful scripts already in `tests/scripts/`:

| Script | What it shows |
|---|---|
| `verify.json` | all ten poses, front / side / back |
| `insert.json` | lat and calf insertion at both extremes |
| `bic.json` | biceps insertion at both extremes, framed on the arms |
| `skin.json` | joints under load, plus lean / fat / untrained |
| `bench.json` | how long a full shape rebuild takes |
| `lat-authored.json` | high/low lat insertion in rear spread and rear double-biceps |
| `pose-review.json` | the seven principal stage poses with the correct rear camera |

---

## Layout

```
src/
  main.js              app: state, camera, UI, loop
  body/
    anatomy.js         negative-space seams and muscle/tendon planes
    figure.js          the deform -> subdivide -> skin chain
    morph.js           sculpted target blending
    params.js          eighteen sliders -> target weights
    regions.js         insertion mechanic, definition, softening
    subdiv.js          Catmull-Clark and normals
    skeleton.js        bones derived from the mesh
    measure.js         tape measure from real cross-sections
    binary.js          bundle reader
  pose/ik.js           two-bone solver and the rig
  render/
    stage.js           environment, lights, post chain
    skin.js            the skin material
  data/
    sliders.js         slider definitions, archetypes, judging copy
    poses.js           the ten poses
  ui/callouts.js       leader-line anchors
tools/
  fetch-assets.mjs     stage the CC0 source assets
  bake-mesh.mjs        mesh, subdivision topology, rig, targets
  bake-regions.mjs     the muscle map
  region-table.mjs     where each muscle sits
  author-lat-correctives.mjs  Z-Anatomy lat outlines -> endpoint sculpts
  author-back-anatomy.mjs     separated posterior muscles -> surface relief
tests/
  shots.mjs            screenshot harness
  sheet.mjs            contact sheets
```
