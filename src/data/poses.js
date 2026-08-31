/* ---------------------------------------------------------------------------
   The ten poses.

   Each one says where the hands and feet go, in fractions of the limb's own
   length, measured from the shoulder or hip and read in the body's own frame.
   The solver in pose/ik.js works out the joint angles. Nothing here is an
   Euler angle except the spine and neck, where a number is genuinely clearer.

   `geo` is the part of a pose that changes the body rather than its angles: a
   lat spread really does widen the back, a vacuum really does empty the waist,
   and a flexed muscle really is a different shape from a relaxed one. Those
   go through the same sculpt system the sliders use.
   --------------------------------------------------------------------------- */

export const POSES = [
  {
    id: 'relaxed', name: 'Relaxed', cam: 0,
    geo: { latFlare: 0.05, chestUp: 0.10, vacuum: 0, flex: 0.25 },
    note: 'Arms down, nothing flexed. The baseline your structure gives you before any effort.',
    arm: { hand: [0.235, -0.945, 0.12], pole: [0.90, -0.20, -0.38], roll: 0.1, curl: 0.55 },
    leg: { foot: [0.13, -0.985, 0.02], pole: [0.24, 0.05, 1.0] },
  },
  {
    id: 'frontDouble', name: 'Front double biceps', cam: 0,
    geo: { latFlare: 0.58, chestUp: 0.45, vacuum: 0.22, flex: 1 },
    note: 'Every insertion is on trial here: biceps length, lat width, quad sweep, all at once.',
    /* the pole is almost pure sideways, which is what puts the upper arm
       level with the shoulder instead of angled up at the head */
    arm: { hand: [0.16, 0.18, 0.03], pole: [1.10, -0.02, -0.04], roll: -0.70, curl: 2.20 },
    legL: { foot: [0.18, -0.968, 0.06], pole: [0.30, 0.05, 1.0], toeOut: 0.28 },
    legR: { foot: [0.15, -0.988, -0.02], pole: [0.28, 0.05, 1.0], toeOut: 0.22 },
    joints: { spine01: [-0.03, 0, 0] },
  },
  {
    id: 'latSpread', name: 'Front lat spread', cam: 0,
    geo: { latFlare: 1, chestUp: 0.85, vacuum: 0.35, flex: 0.85 },
    note: 'Pure width. Where the lats insert decides whether the sweep starts at the armpit or the waist.',
    arm: { hand: [0.04, -0.62, -0.20], pole: [0.85, -0.50, -0.20], roll: 0.35, wristY: -0.5, curl: 0.5 },
    leg: { foot: [0.18, -0.978, 0.02], pole: [0.28, 0.05, 1.0], toeOut: 0.24 },
    joints: { spine01: [-0.05, 0, 0] },
  },
  {
    id: 'sideChest', name: 'Side chest', cam: 0,
    geo: { latFlare: 0.45, chestUp: 1, vacuum: 0.45, flex: 0.9 },
    note: 'Turned side-on so rib cage depth and pec thickness read instead of width.',
    joints: { root: [0, 1.05, 0], spine02: [0, -0.14, 0], spine01: [-0.06, -0.10, 0], neck02: [0, -0.42, 0] },
    grip: [-0.28, -0.52, 0.24],
    armL: { pole: [0.72, -0.42, 0.74], roll: 0.62, wristY: 0.34, curl: 0.86 },
    armR: { pole: [1.00, -0.36, 0.18], roll: 0.42, wristY: -0.24, curl: 0.86 },
    legL: { foot: [0.16, -0.985, -0.12], pole: [0.20, 0.05, 1.0], ankle: 0.12, toeOut: 0.30 },
    legR: { foot: [0.12, -0.99, 0.10], pole: [0.24, 0.05, 1.0] },
  },
  {
    id: 'sideTriceps', name: 'Side triceps', cam: 0,
    geo: { latFlare: 0.35, chestUp: 0.7, vacuum: 0.5, flex: 0.9 },
    note: 'The long head of the triceps sets the hang of the arm from this angle.',
    joints: { root: [0, 1.05, 0], spine02: [0, -0.08, 0], neck02: [0, -0.40, 0] },
    grip: [-0.25, -0.69, -0.10],
    armL: { pole: [0.80, -0.24, -0.72], roll: 0.72, wristY: 0.18, curl: 0.62 },
    armR: { pole: [0.84, -0.32, -0.50], roll: 0.62, wristY: -0.18, curl: 0.62 },
    legL: { foot: [0.16, -0.985, -0.14], pole: [0.20, 0.05, 1.0], ankle: 0.14, toeOut: 0.30 },
    legR: { foot: [0.12, -0.99, 0.10], pole: [0.24, 0.05, 1.0] },
  },
  {
    id: 'backDouble', name: 'Back double biceps', cam: 0,
    geo: { latFlare: 0.70, chestUp: 0.2, vacuum: 0.2, flex: 1 },
    note: 'Lat insertion is unmissable from behind — high insertions leave a gap above the waist.',
    joints: { root: [0, Math.PI, 0], spine01: [-0.03, 0, 0] },
    arm: { hand: [0.16, 0.18, 0.03], pole: [1.10, -0.02, -0.04], roll: -0.70, curl: 2.20 },
    legL: { foot: [0.20, -0.975, 0.02], pole: [0.30, 0.05, 1.0], toeOut: 0.26 },
    legR: { foot: [0.20, -0.955, -0.18], pole: [0.30, 0.05, 1.0], ankle: 0.40, toeOut: 0.26 },
  },
  {
    id: 'rearLat', name: 'Rear lat spread', cam: 0,
    geo: { latFlare: 1, chestUp: 0.3, vacuum: 0.3, flex: 0.85 },
    note: 'The classic cobra. Width here is lat insertion plus clavicle, and neither is trainable.',
    joints: { root: [0, Math.PI, 0], spine01: [-0.04, 0, 0] },
    arm: { hand: [0.04, -0.62, -0.20], pole: [0.85, -0.50, -0.20], roll: 0.35, wristY: -0.5, curl: 0.5 },
    legL: { foot: [0.18, -0.978, 0.02], pole: [0.28, 0.05, 1.0], toeOut: 0.24 },
    legR: { foot: [0.18, -0.955, -0.18], pole: [0.28, 0.05, 1.0], ankle: 0.40, toeOut: 0.24 },
  },
  {
    id: 'mostMuscular', name: 'Most muscular', cam: 0,
    geo: { latFlare: 0.40, chestUp: 0.48, vacuum: 0.2, flex: 1 },
    note: 'Everything contracted at once. Traps and pec insertions dominate the read.',
    joints: { spine01: [0.12, 0, 0], neck02: [0.14, 0, 0], 'clavicle.L': [0, 0, -0.18], 'clavicle.R': [0, 0, 0.18] },
    /* the crab: hands meeting low in front, elbows driven forward */
    arm: { hand: [-0.30, -0.48, 0.40], pole: [1.15, 0.10, 0.08], roll: 0.48, wristY: 0.16, curl: 1.45 },
    leg: { foot: [0.22, -0.965, 0.02], pole: [0.32, 0.05, 1.0], toeOut: 0.28 },
  },
  {
    id: 'absThigh', name: 'Abs and thigh', cam: 0,
    geo: { latFlare: 0.3, chestUp: 0.4, vacuum: 0.55, flex: 0.8 },
    note: 'Ab insertions on show: blocky and even, or staggered and offset.',
    /* hands clasped behind the head, elbows flared wide */
    arm: { hand: [-0.10, 0.34, -0.20], pole: [1.12, 0.08, 0.40], roll: -0.82, curl: 0.64 },
    legL: { foot: [0.16, -0.90, 0.34], pole: [0.26, 0.10, 1.0], ankle: -0.30, toeOut: 0.22 },
    legR: { foot: [0.12, -0.99, 0.02], pole: [0.24, 0.05, 1.0] },
    joints: { spine01: [-0.04, 0, 0] },
  },
  {
    id: 'vacuum', name: 'Vacuum', cam: 0,
    geo: { latFlare: 0.8, chestUp: 1, vacuum: 1, flex: 0.6 },
    note: 'Rib cage lifted, waist pulled in. Structure over mass — the old-school test.',
    arm: { hand: [-0.04, -0.58, 0.26], pole: [1.05, 0.14, 0.26], roll: 0.35, wristY: -0.5 },
    leg: { foot: [0.13, -0.985, 0.02], pole: [0.24, 0.05, 1.0] },
    joints: { spine01: [-0.06, 0, 0] },
  },
];

export const POSE_BY_ID = Object.fromEntries(POSES.map(p => [p.id, p]));
