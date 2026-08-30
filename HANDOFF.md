# Prompt for another AI

Copy everything below the line.

---

I have a working browser app at
`C:\Users\enrik\Desktop\Coding Projects\Bodybuilding Genetics Simulator`.
It is a physique genetics tool: 18 sliders change a 3D man's skeleton, muscle
insertion points and body composition; there are 10 bodybuilding poses, an
orbit camera, leader-line callouts, a tape measure and a side-by-side
comparison. All of that works and I want to keep it.

**The problem is that the man looks bad.** He reads as an inflated mannequin —
a balloon in a muscle suit — not as a muscular human. Fixing this is the whole
job. Everything else in the app is done.

## What is wrong, specifically

Look at the app in the front double biceps pose with Upper-body mass near
maximum and Body fat low. Then look at a photograph of a real bodybuilder in
the same pose. The differences:

- **The torso is one smooth blob.** No groove between the pec and the front
  delt. No line where the pec ends. No serratus. No ab separation worth the
  name. No lat edge down the side of the ribs.
- **The delts are spheres.** The front, side and rear heads do not separate.
  There is no notch where the delt meets the arm.
- **The arms have no shape.** The upper arm is a cylinder with a bulge on it —
  no biceps peak, no split between the two heads, no triceps horseshoe, no
  tendon flattening near the elbow. The forearm is short and featureless.
- **The legs are smooth tubes.** No vastus lateralis sweep, no line between
  the rectus femoris and the vastus medialis, no teardrop above the knee, no
  knee structure, no calf split.
- **Everything is convex.** That is the core of it. A muscular body reads
  because of the *hollows between* muscles, the flat tendon planes and the
  bone showing through. This figure has volume added everywhere and hollows
  nowhere.
- **The proportions are cartoonish.** The head is too small and the neck too
  thick for the body, so it looks like an action figure.
- **The skin is uniform pink plastic** with broad soft highlights.

## Why I think it is wrong

The base mesh is MakeHuman's generic base body — a smooth, androgynous,
average human. The current code takes that mesh and adds muscle by pushing
vertices outward along their normals, using region weights derived from the
rig (see `src/body/regions.js` and `tools/bake-regions.mjs`).

Pushing a smooth surface outward inflates it. It cannot carve the concave
separations that make muscle read, because those are not a lack of volume —
they are specific sculpted forms. The muscle detail has to come from sculpted
data, not from a displacement formula. That is the ceiling this approach hit,
and I do not think tuning the numbers further will clear it.

## What to try, roughly in order of how likely I think each is to work

1. **Replace the base mesh with one that already has bodybuilder anatomy
   sculpted into it.** An ecorché or anatomy-reference model, a photoscanned
   athlete, or a good character asset. Then the sliders only have to modulate
   forms that already exist instead of inventing them. This is the change I
   would make first. Licence must be permissive (CC0 / CC-BY) or bought with
   the right to use.

2. **If the base has to stay, get real sculpted shapes instead of
   displacement.** Derive or sculpt corrective blendshapes per muscle group in
   Blender (or with a muscle simulation), bake them, and blend them at runtime
   the way the existing morph targets are blended. Formula-driven normal
   displacement should not be doing the anatomy.

3. **Treat the hollows as first-class.** Whatever approach you take, the
   grooves between muscle groups, the tendon planes and the bony landmarks
   need to be authored deliberately, not left as whatever is left over
   between two bulges.

4. **Fix the proportions.** Head size relative to body, neck thickness,
   shoulder-to-waist ratio, limb-to-torso ratio.

You are free to throw away my geometry pipeline entirely if a better one
exists. You are also free to change the rendering stack. Do not throw away the
UI, the sliders, the poses, the measurements, the callouts or the comparison
mode — those are finished and I want them kept working.

## How the project is laid out

```
src/
  main.js              app state, camera, UI, render loop
  body/
    figure.js          the deform -> subdivide -> skin chain
    morph.js           blends the sculpted MakeHuman targets
    params.js          the 18 sliders -> morph target weights
    regions.js         the muscle map: insertion mechanic, definition, softening
    subdiv.js          Catmull-Clark subdivision and normals
    skeleton.js        bones derived from helper vertices inside the mesh
    measure.js         tape measure from real mesh cross-sections
    binary.js          reader for the baked bundle
  pose/ik.js           two-bone IK solver and the pose rig
  render/
    stage.js           HDRI, lights, GTAO/bloom/ACES post chain
    skin.js            the skin material (subsurface, veins, striations, hair)
  data/
    sliders.js         slider definitions, archetypes, judging copy
    poses.js           the 10 poses, written as hand and foot targets
  ui/callouts.js       leader-line anchors
tools/
  fetch-assets.mjs     pulls the CC0 MakeHuman assets into assets-src/
  bake-mesh.mjs        mesh, subdivision topology, rig, morph targets -> body.bin
  bake-regions.mjs     the muscle map -> regions.bin
  region-table.mjs     where each muscle sits, as bone segment + band + arc
tests/
  shots.mjs            Playwright screenshot harness
  sheet.mjs            builds contact sheets from shots/
```

Run it with `npm run dev`, then open http://localhost:5188.
Rebuild the baked data with `npm run bake`.

## How to check your work

There is a screenshot harness already set up. Use it — do not report the work
as done without looking at the images.

```bash
node tests/shots.mjs --script tests/scripts/verify.json && node tests/sheet.mjs v- sheet-poses.png 5
```

Other scripts in `tests/scripts/`: `sweep.json` walks every silhouette slider
end to end, `insert.json` and `bic.json` show the insertion sliders at both
extremes, `skin.json` shows the joints under load and the lean/fat/untrained
range, `bench.json` times a full shape rebuild.

## The bar

Put a render of the app next to a photograph of a real bodybuilder in the same
pose. The silhouette and the muscle separation should be in the same league.
Right now they are not close.
