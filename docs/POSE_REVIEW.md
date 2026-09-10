# Freeman bodybuilding pose review

Four bodybuilding presets are available in the Pose selector. These extend the current Freeman sculpt and preserve the original anatomy stance. This is a visual review of the rendered model, not a biomechanical validation.

## Findings by pose

| Pose | What reads well | What still needs improvement |
| --- | --- | --- |
| Front double biceps | Raised elbows, flexed upper arms, chest and abdominal proportions are readable. Compact curved fingers improve the silhouette over the original open palms. | The grip is still cupped rather than a tightly closed fist. Shoulder-to-pec transitions remain angular, and the biceps contour could use an authored contraction shape. |
| Back double biceps | Rear deltoids, upper-back relief and the taper into the waist remain visible with both arms raised. | Scapulae do not rotate independently; back folds are carried from the rest sculpt. The symmetric flat-foot stance lacks a competition-style calf display. |
| Front lat spread | Elbows move outward and hands sit beside the waist. Added lat expansion makes the torso wider while retaining the waist. | Wrist/waist contact is approximate and varies with frame presets. Chest lift and shoulder protraction need coordinated corrective shapes. |
| Rear lat spread | The rear view exposes lat width, the spinal groove and calf proportions; it is useful for comparing lat sweep and back development. | The expanded back retains too much of the original scapular relief. A dedicated spread sculpt would give a more convincing continuous back surface. |

## Changes made during review

- Shoulder-support bones follow arm elevation, preventing the upper arm from being tethered to its inspection position.
- A localized relaxation pass softens the small shoulder/armpit folds that stretch under posing. The original neutral surface remains exact.
- Bodybuilding poses curve the original finger geometry into a compact grip; this avoids adding disconnected replacement hands.
- A smooth lat expansion strengthens the spread silhouette, with a smaller expansion in double biceps poses.
- Camera fit and comparison separation use posed bounds, including raised hands and edited arm lengths. Comparisons retain an explicitly selected bodybuilding pose.

## Recommended model work

1. Add finger and thumb joints, with authored closed-fist and waist-contact grips. This is the most visible remaining weakness in the double biceps poses.
2. Author shoulder, axilla and scapula corrective shapes for raised arms and lat spreads. Local smoothing helps sharp folds but cannot reproduce muscle sliding and shoulder-blade movement.
3. Add asymmetric foot placement, knee flexion and a raised rear heel. The current poses retain the source leg stance for stable comparisons.

The existing proportions are a usable basis for comparing physiques; these views point primarily to pose articulation and deformation work rather than replacing the whole sculpt.

## Reproduce the review

```sh
npm run shots -- --script tests/scripts/freeman-poses.json --w 1200 --h 1000
npm test
npm run test:browser
npm run build
```

The screenshot script writes `shots/poses-front-double.png`, `poses-back-double.png`, `poses-front-lat.png`, `poses-rear-lat.png`, and `poses-double-side.png`. Browser checks additionally capture each pose, a neutral-sculpt comparison, a developed frame and a mobile comparison. Screenshots are local review artifacts in the ignored `shots/` directory.
