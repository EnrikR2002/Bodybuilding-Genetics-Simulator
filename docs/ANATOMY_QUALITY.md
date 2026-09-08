# Anatomy and rendering changes

The September 2026 update improves the existing MakeHuman / Z-Anatomy pipeline.
It is still an illustrative physique model, not a validated reconstruction of
an individual athlete or a finished photorealistic character asset.

## What changes with the controls

- Biceps belly length uses a continuous profile in humeral coordinates, fitted
  over the current distal arm radius. Gastrocnemius length resamples the
  existing calf surface. Shortening removes distal fullness and redistributes
  it proximally; lengthening carries fullness toward the distal joint. Atlas
  relief is transported with each belly. This is a runtime approximation, not
  an artist-authored endpoint pair or an exact muscle-volume simulation.
- Biceps peak shape redistributes central fullness independently of belly
  length. The longitudinal compensation approximates constant volume.
- Additional development follows distance to the atlas's actual muscle
  borders. Overlapping generic regions are restrained so several muscles do
  not inflate the same back or shoulder patch.
- Abdominal segments, inscriptions and stagger are geometry. Stagger zero
  aligns the rows; increasing it offsets the two sides. The inscriptions are
  registered below the template's pec fold. A continuous displacement layer
  softens the discrete atlas borders before normals are recomputed.
- The rig is derived before muscle reshaping, so changing a belly does not
  move a joint inferred from surface vertices. Bone-width and length morphs
  still change the rig normally.

The biceps has both a short and a long anatomical head. Those names should not
be confused with a shorter or longer visible muscle belly. The study controls
describe belly length, and deliberately make no claims about measurements of
Arnold Schwarzenegger or Sergio Oliva. See the
[NCBI anatomy reference](https://www.ncbi.nlm.nih.gov/books/NBK519538/) and the
[distal biceps anatomical study](https://pmc.ncbi.nlm.nih.gov/articles/PMC4622363/).

## Rendering and inspection

- Volume-preserving dual-quaternion skinning is shared by skin, clay, shadow
  and ambient-occlusion passes. CPU picking uses the equivalent transform.
- The upper arm is oriented toward the elbow flexion plane; twist is shared
  through the humerus. Double-biceps targets raise the elbows, and hand curl
  is reduced to avoid folding fingers through the palm.
- Inner clavicle skin weights transfer support to the thorax, and three
  connected-edge smoothing passes ease the upper-body weight transitions.
  This removes the raised patches beside the neck during arm elevation.
- Fine skin bumps now use view-space surface derivatives. The previous shader
  added an object-space gradient to a view-space normal. Excessive cavity
  pigmentation and roughness noise have been reduced.
- Each eye has its own iris and pupil coordinates.
- Skin and neutral-clay modes support equal-material comparisons. Atlas mode
  is a **reference map**, not a dynamically relabelled muscle segmentation.
- A pinned figure includes the same anatomical layers as the live figure and
  solves subsequent poses against its own proportions.
- Callouts use render vertices and the same skinning transform as the body.
  The biceps and calf anchors move along the current belly, instead of staying
  attached to a neutral peak on one rigid bone.

## Projection correction

Atlas ray hits are restricted to structures appropriate to their bone chain.
An arm intersecting a torso ray is not accepted as rib-cage anatomy, and torso
projection stops before the head. Rebuild with `npm run anatomy:bake`; the
corrected bundle is included under `public/models/`.

## Verification

```sh
npm run bake
npm test
npm run build
node tests/visual-review.mjs
node tests/interaction-review.mjs
```

Numeric tests cover fixed joints, finite and continuous endpoints, reduction
of visible insertion differences under fat, measurement isolation, all ten
poses at frame extremes, normalized skin weights, moving callout anchors, and
preservation of radius under a 180-degree twist.
The browser review checks equal-state comparison geometry and exercises actual
study buttons and material selectors. Screenshots cover torso, limbs, body
composition, lat endpoints, the principal poses and biceps endpoints in clay.
The interaction review also covers editing a pinned comparison, posed callouts
and the narrow-screen study controls.
These checks do not establish anatomical or clinical validity.

## Remaining quality work

The generic base still limits the quality of the pec-to-deltoid transition,
axilla, distal arm, hands, nipples, quadriceps and abdominal wall. Some extreme
poses still show pinching or excessive stretching. Smooth interpolation and
finite vertices do not imply a production-quality sculpt. The skin is a
procedural approximation, not scanned skin or physically simulated subsurface
scattering. Forearm vascular paths are not individually anatomically authored.

The next quality gate is an anatomy artist's review of topology-matched
bodybuilder sculpts, including pose correctives and all remaining genetic
endpoints. The local Blender installation and OBJ import/export path already
support that workflow; a new MCP connection is not needed to use them.

A more muscular source candidate, PixelPete's CC0 Mike Freeman model, was
identified from its published preview. Its download currently requires
BlendSwap sign-in. See [source intake notes](../assets-src/mike-freeman/README.md).
It has not been downloaded, tested or integrated.
