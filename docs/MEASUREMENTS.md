# Measurements

Every number in the Numbers panel is taken off the figure's rest surface —
unposed and unflexed — so it does not change when you switch poses. The code
is in `src/freeman/measure.js`; the tests are in `tests/freeman-measure.test.mjs`.

## How the tape works

- **Girths** slice the surface and take the perimeter of the slice's convex
  hull. That is what a tape does: it bridges the groove between two muscles
  instead of dipping into it.
- **Limb girths** (arm, forearm, wrist, thigh, calf, ankle) are sliced square to
  the bone, on the left side. The largest girth along the belly is kept for
  muscles; the smallest near the joint is kept for the wrist and ankle.
- **Chest** is the largest trunk girth a few centimetres above the chest joint
  (nipple line), arms excluded. **Waist** is the smallest trunk girth between
  the pelvis and the rib cage. **Hips** is the largest girth across the glutes.
- **Shoulders** (the tape) goes around both deltoids with the upper arms. The
  sculpt stands with its arms out, so this reads a little larger than a tape
  taken with the arms hanging. **Shoulder width** is the bideltoid breadth: the
  distance between the outermost points of the two lateral deltoids.
- The **arm** girth is relaxed. Most published arm figures are flexed.

## Weight, body fat and FFMI

- The body mesh is closed, so its **volume** follows exactly from the
  divergence theorem. 1.5 litres are removed for air in the lungs and gut.
- **Density** follows Siri's two-compartment equation, D = 495 / (%BF + 450)
  g/cm³, so a leaner figure is denser.
- **Body fat** is an estimate tied to the Body fat trait: 5 % at "Stage" (the
  sculpt as authored) up to 22 % at "Off-season".
- **FFMI** = lean mass (kg) / height (m)². **Normalised FFMI** adds
  6.1 × (1.8 − height in m) (Kouri et al., 1995). The bands shown are rough
  guides: about 20 for trained lifters, 22 for advanced, 25 as the level
  natural lifters rarely pass.

The neutral sculpt measures about 180 cm, 90 kg and an FFMI near 26: a heroic
physique, which is how it was sculpted.

## Ratios

- **Adonis index**: shoulder girth ÷ waist girth. The classical target is the
  golden ratio, 1.618.
- Chest ÷ waist, waist ÷ height (the panel treats 0.45 or lower as good),
  legs ÷ torso (leg bone length ÷ neck-to-pelvis height).

## Published estimates

These are shown as other people's published targets, not as predictions for
any real person.

- **John McCallum** ("Keys to Progress"): chest = 6.5 × wrist; waist 70 %,
  hips 85 %, thigh 53 %, neck 37 %, arm 36 %, calf 34 % and forearm 29 % of the
  chest.
- **Casey Butt** ("Your Muscular Potential"), from height H, wrist W and
  ankle A in inches, at the given body fat:
  - maximum lean mass (lb) = H^1.5 × (√W / 22.6670 + √A / 17.0104) × (%BF / 224 + 1)
  - chest = 1.6817 W + 1.3759 A + 0.3314 H
  - arm (flexed) = 1.2033 W + 0.1236 H
  - forearm = 0.9626 W + 0.0989 H
  - neck = 1.1424 W + 0.1236 H
  - thigh = 1.3868 A + 0.1805 H
  - calf = 0.9298 A + 0.1210 H

  The lean-mass equation and its coefficients were checked against a
  calculator that reproduces it (fitmatic.com). The girth equations are the
  ones widely reproduced from the book; they could not be checked against the
  book itself while this was written. For a 71-inch man with 7-inch wrists and
  9-inch ankles they give a 17.2-inch flexed arm and 183 lb of lean mass at
  10 % body fat, which matches the book's published examples in scale.

## Insertion readouts

Measured on the edited surface with the projected muscle map, left side:

- **Biceps belly ends … above the elbow**: the 97th percentile of the belly
  along the humerus, subtracted from the elbow crease at 97 % of the bone.
- **Triceps long head reaches … % of the humerus** (85th percentile).
- **Calf belly … % of the shin** and **Achilles tendon** length below it.
- **Lat sweep ends … above the waist**: the lowest lateral lat fibres against
  the height of the narrowest waist slice.
- **Sternal gap**: the distance between the inner edges of the two pecs at the
  nipple line.
- **Upper traps rise … over the shoulder**: the top of the upper trapezius
  slope against the shoulder joint.
