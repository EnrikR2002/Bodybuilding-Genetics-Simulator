# The Freeman anatomy map

`public/models/freeman-anatomy.{json,bin}` tells every vertex of the Mike
Freeman sculpt which muscle (or bone showing through) lies under it, how far
along that muscle it sits, and where each structure's origin, insertion,
peak and centre are. The format and vocabulary are fixed in
`docs/ARCHITECTURE.md` ("Anatomy map"); this page explains how the map is
made and what it can and cannot be trusted for.

```sh
npm run anatomy:freeman            # full projection (node tools/bake-freeman-anatomy.mjs)
node tools/bake-freeman-anatomy.mjs --shots     # also render shots/anatomy-map-*.png
node tools/bake-freeman-anatomy.mjs --extract   # re-read the atlas (after editing the extractor)
node --test tests/freeman-anatomy.test.mjs
```

Needs Blender 4.5 (`BLENDER_PATH`, default `.tools/blender-runtime/...`) and
the Z-Anatomy `Startup.blend` (`ZANATOMY_BLEND`, default
`.assets-cache/z-anatomy/extracted/Z-Anatomy/Startup.blend`) — only for the
first run and for review renders; the extracted atlas is cached in
`assets-src/anatomy-reference/build/` (git-ignored).

## Source

Z-Anatomy (built on BodyParts3D), CC BY-SA 4.0 / CC BY-SA 2.1 Japan: a
complete dissection of an ordinary adult male — muscles, bones, the skin
split into anatomical regions, the origin and insertion patches of each
muscle ("Muscular insertions") and labelled bone landmarks. The sculpt is
CC0. The map is a derived work of the atlas and carries its licence.

## Method

<!-- results and limits are filled in below after review -->

1. **Extract** (`tools/blender/project_freeman_anatomy.py extract`). Blender
   opens the atlas once and writes every muscle, bone, skin region,
   attachment patch and bone marker, evaluated in world space and converted
   to the Freeman frame (cm, Y up, +Z forward, +X = the figure's left).
2. **Register** (`bake-freeman-anatomy.mjs`, stage 2). The cadaver is a
   different body in a different stance: 171 cm, arms hanging, ordinary
   muscle. Freeman is 180 cm, arms out at about 45°, heroic muscle.
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
     the skin with it. This is what makes a trained body work: a muscle that
     is 3 cm thicker on Freeman pushes the atlas skin out, and the muscle
     under it follows, so it still lies just under his skin.
3. **Cast**. One ray per Freeman vertex, starting 2.5 cm outside the skin and
   travelling 7 cm inward along the relaxed (smoothed) normal, through one
   BVH of the whole warped dissection. The first structure the ray enters
   owns the vertex, with stated exceptions: sheets thinner than 3 mm with
   muscle right under them are seen through (the skin shows the belly, not
   the aponeurosis); the iliotibial tract is seen through; a limb structure
   cannot own trunk skin and vice versa (rig region weights).
4. **Clean**. A 3-pass majority filter over mesh adjacency; islands smaller
   than 40 vertices (or 3 % of the structure's largest piece) are absorbed
   by their neighbours; unlabelled or out-of-vocabulary patches up to 220
   vertices are filled from their rim inward. Left/right is decided by the
   sign of x, never by the atlas object. Hands, feet below the ankle and the
   genitals are masked and stay 0.
5. **Snap to grooves**. Within 1.8 cm of every border between two
   structures, a marker watershed on concavity moves the border into the
   valley the sculptor carved: each side floods from its own interior,
   convex ground first, and the two floods meet along the bottom of the
   groove. A small penalty for crossing onto the other side's original
   ground keeps a border where it is when there is no groove to find.
6. **Soft borders**. Within 1.2 cm of a border, `muscle2` holds the
   neighbour and `blend` falls from 255 to 128 at the border itself.
7. **Along**. Measured on the atlas muscle itself, before warping: for each
   atlas vertex, `d_origin / (d_origin + d_insertion)`, where the two ends
   are the muscle's real attachment patches (or, where the atlas has none,
   its extreme vertices in a stated direction). The ray carries the value
   to the skin by barycentric interpolation; it is then smoothed inside
   each structure. Origin is the proximal / fixed end: biceps shoulder →
   elbow, gastrocnemius knee → heel, latissimus spine/pelvis → armpit,
   rectus abdominis pubis → ribs, serratus ribs → scapula.
8. **Landmarks**, per structure and side, all vertex indices of that
   structure: `origin` and `insertion` (the skin vertices nearest the mean
   of the lowest / highest 2 % of `along`), `peak` (the most prominent
   vertex: largest offset of the sculpt from its relaxed surface along the
   normal), `centroid` (nearest to the mean position).
