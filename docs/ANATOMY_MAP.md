# The Freeman anatomy map

`public/models/freeman-anatomy.{json,bin}` tells every vertex of the Mike
Freeman sculpt which muscle (or bone showing through) lies under it, how far
along that muscle it sits, and where each structure's origin, insertion,
peak and centre are. The format and vocabulary are fixed in
`docs/ARCHITECTURE.md` ("Anatomy map"); this page explains how the map is
made and what it can and cannot be trusted for.

```sh
npm run anatomy:freeman                         # full projection (node tools/bake-freeman-anatomy.mjs)
node tools/bake-freeman-anatomy.mjs --shots     # + shots/anatomy-map-*.png (by structure and by along)
node tools/bake-freeman-anatomy.mjs --focus     # + shots/anatomy-focus-<set>-<view>.png (fixed colours)
node tools/bake-freeman-anatomy.mjs --atlas     # + the warped dissection itself, same colours
node tools/bake-freeman-anatomy.mjs --probe     # print the ray stack at named skin points
node tools/bake-freeman-anatomy.mjs --extract   # re-read the atlas (after editing the extractor)
node --test tests/freeman-anatomy.test.mjs
```

Needs Blender 4.5 (`BLENDER_PATH`, default `.tools/blender-runtime/...`) and
the Z-Anatomy `Startup.blend` (`ZANATOMY_BLEND`, default
`.assets-cache/z-anatomy/extracted/Z-Anatomy/Startup.blend`) — only for the
first run and for review renders. The extracted atlas and the registration's
displacement grid are cached in `assets-src/anatomy-reference/build/`
(git-ignored); with the cache a full bake takes about 30 s.

## Source

Z-Anatomy (built on BodyParts3D), CC BY-SA 4.0 / CC BY-SA 2.1 Japan: a
complete dissection of one ordinary adult male — muscles, bones, the skin
split into anatomical regions, the origin and insertion patches of each
muscle ("Muscular insertions") and labelled bone landmarks. The sculpt is
CC0. The map is a derived work of the atlas and carries its licence.

Files: `tools/blender/project_freeman_anatomy.py` (extract),
`tools/bake-freeman-anatomy.mjs` (everything else),
`tools/freeman-anatomy-table.mjs` (which atlas object is which structure,
and every anatomical rule below, in one place),
`tools/freeman-anatomy-geometry.mjs` (BVH, geodesics, distance fields),
`tools/blender/render_freeman_anatomy.py` (review renders).

## Method

1. **Extract.** Blender opens the atlas once and writes every muscle, bone,
   skin region, attachment patch and bone marker, evaluated in world space
   and converted to the Freeman frame (cm, Y up, +Z forward, +X = the
   figure's left). Sheets the skin never shows (fasciae, bursae, sheaths,
   ligaments) and the inside of the head are skipped.
2. **Orient.** About half of the BodyParts3D meshes (303 of 643) are wound
   inside out. The cast tells "entering" from "leaving" by the facing of the
   triangle it crosses, so every structure is turned outward by the sign of
   its signed volume. Without this, a third of all rays misjudged where a
   muscle began and how thick it was.
3. **Register.** The cadaver is a different body in a different stance
   (171 cm, arms hanging, ordinary muscle); Freeman is 180 cm, arms out at
   about 45°, heroic muscle.
   - a uniform scale to his height;
   - skeleton-driven skinning: each limb bone of the atlas (humerus,
     radius/ulna, femur, tibia/fibula) is carried onto the matching Freeman
     joint pair with a rotation and a stretch along the bone; every atlas
     point moves with the bones it is nearest to (inverse-distance weights
     over voxel distance fields), so the arm swings out and lengthens
     without tearing the shoulder;
   - a smooth displacement field that lays the atlas' own skin onto
     Freeman's skin (one ray per atlas skin vertex along its normal, robust
     neighbourhood averaging, then a 2 cm grid) and carries everything under
     the skin with it. A muscle that is 3 cm thicker on Freeman pushes the
     atlas skin out, and the muscle under it follows.
4. **Cast.** One ray per Freeman vertex, from 2.5 cm outside the skin, 7 cm
   inward along the relaxed normal, through one BVH of the whole warped
   dissection. The first structure the ray enters owns the vertex, except:
   - a sheet thinner than 3 mm with something within 2.5 cm under it is
     seen through — a named sheet only to another named structure;
   - named aponeuroses, measured with `--probe`: the external oblique over
     the rectus abdominis (the anterior rectus sheath, two ~4 mm layers),
     the latissimus over the lumbar erectors (the thoracolumbar aponeurosis,
     ~8 mm) hand the skin straight to the muscle they cover;
   - a pose correction: the cadaver's hanging arm drapes the latissimus over
     the teres major; with Freeman's arm out and a trained teres, the teres
     belly shows above the lat's thin upper edge (< 1.6 cm);
   - the iliotibial tract is seen through; a limb structure cannot own
     trunk skin and vice versa (rig region weights);
   - the internal oblique, where it shows through gaps in the atlas'
     aponeurosis, counts as the oblique wall; coracobrachialis as the short
     biceps.
5. **Clean.** A majority filter over mesh adjacency; islands smaller than 25
   vertices (or 3 % of the structure's largest piece) are absorbed by their
   neighbours; unnamed patches up to 220 vertices are filled from their rim
   inward. Hands, feet below the ankle and the genitals are masked and stay
   0. The face stays 0 (the rays find skull and facial muscles, which are
   not in the vocabulary).
6. **Pool the sides.** The sculpt is mirror-symmetric vertex for vertex
   (99.98 % of vertices pair up exactly). The atlas is one real, slightly
   asymmetric body, so its left and right halves disagree by up to 30 % on
   narrow structures. Every smoothing step below works on a vertex and its
   mirror together, so the map is exactly symmetric and each side uses both
   halves of the evidence. Left/right is decided by the sign of x.
7. **Straighten borders.** Each label's indicator is diffused over the mesh
   (a Gaussian about 1.2 cm wide) and every vertex takes the strongest; saw
   teeth from the ray grid and the atlas triangulation straighten, specks
   shrink away. Small structures (tendons, exposed bone, teres major) count
   1.2–2× at that decision so they are not eroded by their big neighbours.
8. **Snap to grooves.** Within 1.8 cm of every border, a marker watershed on
   concavity moves the border into the valley the sculptor carved: each
   side floods from its own interior, convex ground first, and the floods
   meet along the bottom of the groove. A small penalty for crossing onto
   the other side's original ground keeps a border where it is when there
   is no groove. A light 0.5 cm straightening follows.
9. **Along.** Measured on the atlas muscle itself, before warping: for each
   atlas vertex, `d_origin / (d_origin + d_insertion)` between the muscle's
   real attachment patches (or, where the atlas has none, its extreme
   vertices in a stated direction). The ray carries it to the skin by
   barycentric interpolation; it is smoothed inside each structure and
   pooled with the mirror. Origin is the proximal / fixed end: biceps
   shoulder → elbow, gastrocnemius knee → heel, latissimus spine/pelvis →
   armpit, rectus abdominis pubis → ribs, serratus ribs → scapula.
10. **Biceps tendon.** The atlas biceps thins from 1.5 cm at along 0.7 to
    0.6 cm at 0.8: the belly ends there. Skin of either head beyond along
    0.78 becomes `biceps_tendon` with its own 0 → 1; the heads keep the
    atlas' along, so their skin runs 0 → ~0.78.
11. **Soft borders.** Within 1.2 cm of a border, `muscle2` holds the
    neighbour and `blend` falls from 255 to 128 at the border itself.
12. **Landmarks**, per structure and side, all vertex indices of that
    structure: `origin` and `insertion` (nearest the mean of the lowest /
    highest 2 % of `along`), `peak` (largest offset of the sculpt from its
    relaxed surface along the normal — the top of the belly), `centroid`
    (nearest the mean position). The right side is the mirror of the left.
