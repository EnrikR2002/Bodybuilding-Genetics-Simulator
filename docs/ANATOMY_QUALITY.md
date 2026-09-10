# Freeman anatomy and quality notes

The main app now uses the supplied Mike Freeman sculpt directly. Its neutral, lean surface preserves the author's evaluated multiresolution mesh, rather than adding a projected anatomy layer to the old MakeHuman figure.

## Geometry and posing

The runtime body contains 154,442 vertices and 308,864 triangles. The export includes the original eye and eyebrow geometry, a 21-bone inspection rig and normalized four-influence skin weights. Hair is omitted from the viewer. The rest-pose arm landmarks are measured against the sculpt's actual shoulder, elbow and forward-reaching wrist positions.

The app evaluates dual-quaternion deformation when the user changes a preset or pose, then recomputes normals from the resulting surface. This avoids presenting interpolated rest-pose shading as muscle detail and avoids repeated skinning during camera motion. The supported poses are the artist's original stance, a controlled curl, front/back double biceps and front/rear lat spreads. These are authored for the Freeman rig in `src/freeman/poses.js`; the previous app's pose catalogue remains separate.

Raised arms include clavicle elevation and matching shoulder-support rotation. A local relaxation pass softens stretched axilla folds. Bodybuilding poses also use a continuous finger-curl corrective and a smooth lateral lat expansion. These are approximate surface corrections, not independently articulated fingers or simulated scapulae. Pose directions resolve against the edited skeleton to preserve limb lengths. See [the visual pose review](POSE_REVIEW.md).

Belly controls transport the existing surface along the humerus or lower leg, with smooth angular and longitudinal falloffs. A shorter belly redistributes some fullness proximally; a longer belly extends fullness toward the distal interval. A separate flexed shape and biceps-profile control alter the contour. Bone landmarks are independent of those belly controls. Frame presets deform the skeleton and surface together.

Lat sweep, pec spacing, abdominal stagger and trap profile are localized sculpt-space deformations. Development adds regional volume. Definition blends toward a smoothed version of the same topology and adds surface coverage, so a softer physique does not retain the same sharp separations at a larger radius.

## Rendering and comparison

Skin uses a physical material with restrained procedural variation and fine surface noise. It is not a scanned albedo, roughness or subsurface texture set. Neutral sculpt removes skin colour variation to aid shape inspection. Both finishes retain the posing-brief mask. Studio HDR illumination, directional lights, shadows and desktop ambient occlusion reveal the underlying forms.

Orthographic projection keeps a pinned and current physique at the same apparent scale and angle. Camera-relative separation keeps them beside one another when orbiting. Each comparison owns separate geometry, materials and bone state; editing the current physique does not change the pinned surface. Both follow the same pose and finish controls.

## Verification

`npm test` checks asset completeness, normalized weights, exact neutral lean surface preservation, visible insertion displacements with fixed joints, finite geometry and normals at every preset endpoint in all six poses, combined extremes, reversible posing, limb lengths, joint placement and comparison isolation.

`npm run test:browser` exercises the rendered desktop/mobile interface, checks for a visible model rather than only a loaded page, verifies stable canvas sizing, presets, snapshot isolation, matching finishes, camera changes and mobile overflow. It also selects every bodybuilding pose, verifies the rear camera presets, preserves the selected pose in comparisons and projects the surface vertices to check framing. Screenshots are written to `shots/` for visual review; passing numerical tests alone does not establish anatomical realism.

## Limits

This is an illustrative surface model, not a validated biomechanical simulation. The endpoints are procedural deformations of one artist's sculpt, not individually sculpted or measured human variants. Tendons, individual internal muscle heads and attachment sites are not separate volumetric anatomy. Volume compensation is approximate. Frame and development presets are qualitative, not predictions of strength, achievable muscularity, training response or body-fat percentage.

In particular, a shorter visible biceps belly should not be called a short *head*: the two anatomical heads are a separate distinction. No athlete measurements are inferred from appearance. A fully photorealistic character would additionally require authored skin textures, more detailed hand/pose rigs and artist-reviewed corrective shapes across the full motion range.
