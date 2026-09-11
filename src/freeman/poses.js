/* ---------------------------------------------------------------------------
   The pose catalogue, in the order the UI lists it. Ids are fixed: the UI and
   the trait catalogue refer to them.

   Shape fields read by the shape stages (applyPose):
     flex     biceps contraction 0..1        spread   lat flare 0..1
     vacuum   waist drawn in 0..1            chestUp  rib cage lifted 0..1

   Frame: centimetres and degrees, +Y up, +Z forward. For a limb, x is always
   "outward on that side", so `arm` and `leg` describe both sides and are
   mirrored; `armL`/`armR` and `legL`/`legR` override fields per side.

   body     { pelvis, abdomen, chest, neck, head }: [bend forward, turn toward
            the figure's left, lean to the figure's right] in degrees, each
            relative to its parent. `hips` moves the pelvis (cm); the pelvis
            also drops by itself when the stance is too wide for the legs.
   arm      shrug, reach   clavicle up / forward (degrees)
            upper, fore    humerus and forearm directions in the chest frame
            ik             instead of directions: { from: bone, to: [x,y,z] cm in
                           that bone's posed frame, pole: elbow direction }; the
                           wrist is placed at the target (limb lengths are kept)
            hand, palm     wrist→knuckle direction and the direction the palm
                           faces (chest frame); the difference to the forearm
                           becomes pronation/supination along the forearm
            grip           a name in GRIPS or an object of the same shape
   leg      step [x, z]    where the ball of the foot goes on the floor (cm)
            turn           toe-out (degrees)
            heel           heel raised, pivoting on the ball of the foot (degrees)
            knee           knee pole direction
   view     camera azimuth in degrees (0 front, 180 back, -90 the figure's right)
   --------------------------------------------------------------------------- */

/* Hand shapes. Fingers: [knuckle, middle joint, tip joint, spread] in degrees,
   flexion toward the palm; spread is away from the middle finger. Thumb:
   [across the palm, away from the palm, roll toward the fingers, knuckle, tip]. */
export const GRIPS = {
  fist: {
    // fitted so the thumb pad lies across the middle phalanges of index and middle
    thumb: [22, 27, -12, 27, 85],
    index: [84, 102, 64, -2], middle: [88, 104, 66, 0], ring: [92, 104, 64, -8], pinky: [96, 100, 62, -12],
  },
  relaxed: {
    thumb: [8, 10, 12, 10, 12],
    index: [16, 26, 14, 2], middle: [20, 30, 16, 0], ring: [24, 34, 18, -1], pinky: [28, 36, 20, -2],
  },
  /* flat on the obliques: fingers together and a little curved to the waist, thumb along the index */
  flat: {
    thumb: [-8, 0, 0, 6, 6],
    index: [8, 10, 4, -4], middle: [8, 10, 4, 0], ring: [9, 11, 5, -12], pinky: [10, 12, 6, -15],
  },
  grasp: {
    thumb: [28, 34, 48, 18, 16],
    index: [52, 62, 34, -2], middle: [56, 64, 36, 0], ring: [60, 66, 36, -2], pinky: [64, 64, 34, -5],
  },
  /* cupping the back of the head */
  clasp: {
    thumb: [4, 0, 10, 12, 12],
    index: [30, 34, 18, -6], middle: [32, 38, 20, 0], ring: [34, 40, 22, -12], pinky: [36, 40, 22, -15],
  },
};

const STANCE = { step: [1.5, 0], turn: 8 };

export const POSES = [
  {
    id: "anatomy", name: "Anatomy pose", view: 0, flex: 0, spread: 0, vacuum: 0, chestUp: 0, rest: true,
    note: "The artist's stance, untouched: the reference every other pose is measured against.",
  },
  {
    id: "relaxed", name: "Front relaxed", view: 0, flex: 0.1, spread: 0.3, vacuum: 0.15, chestUp: 0.35,
    note: "Arms down, nothing flexed hard. The baseline your structure gives you before any effort.",
    body: { chest: [-2, 0, 0], head: [1, 0, 0] },
    arm: { upper: [0.3, -0.95, 0.02], fore: [0.2, -0.97, 0.13], hand: [0.12, -0.99, 0.12], palm: [-0.95, 0.1, 0.25], grip: "relaxed" },
    leg: STANCE,
  },
  {
    id: "flex", name: "Arms flexed", view: 0, flex: 1, spread: 0.15, vacuum: 0.1, chestUp: 0.3,
    note: "A clean, symmetric biceps presentation: elbows at shoulder height, fists turned in.",
    arm: { shrug: 4, upper: [1, 0.06, 0.1], fore: [-0.12, 1, 0.12], hand: [-0.55, 0.83, 0.05], palm: [-0.8, -0.45, -0.35], grip: "fist" },
    leg: STANCE,
  },
  {
    id: "frontDouble", name: "Front double biceps", view: 0, flex: 1, spread: 0.65, vacuum: 0.3, chestUp: 0.6,
    note: "Every insertion is on trial here: biceps length, lat width, quad sweep, all at once.",
    body: { chest: [-4, 0, 0], head: [-2, 0, 0] },
    arm: { shrug: 8, upper: [1, 0.22, 0.04], fore: [-0.28, 1, 0.1], hand: [-0.62, 0.78, 0.02], palm: [-0.75, -0.55, -0.35], grip: "fist" },
    legL: { step: [5, 5], turn: 22 }, legR: { step: [1, 0], turn: 12 },
  },
  {
    id: "latSpread", name: "Front lat spread", view: 0, flex: 0.4, spread: 1, vacuum: 0.35, chestUp: 0.85,
    note: "Pure width. Where the lats insert decides whether the sweep starts at the armpit or the waist.",
    body: { chest: [-4, 0, 0] },
    /* palms flat on the obliques, fingers down, elbows driven out and forward */
    arm: { shrug: 3, reach: 10, ik: { from: "pelvis", to: [17, 20, 0], pole: [1, 0.05, 0.35] },
      hand: [-0.05, -0.95, 0.3], palm: [-1, 0, 0.05], grip: "flat" },
    leg: { step: [3, 0], turn: 20 },
  },
  {
    id: "sideChest", name: "Side chest", view: -90, flex: 0.9, spread: 0.45, vacuum: 0.45, chestUp: 1,
    note: "Turned side-on so rib cage depth and pec thickness read instead of width.",
    body: { pelvis: [0, -8, 0], abdomen: [0, -10, 0], chest: [-4, -14, 0], neck: [0, -12, 0], head: [2, -20, 0] },
    armR: { reach: 10, upper: [0.12, -0.9, 0.4], fore: [-0.62, -0.02, 0.78], hand: [-0.6, 0.1, 0.78], palm: [0, 0.2, -1], grip: "fist" },
    armL: { reach: 14, ik: { from: "hand.R", to: [-1.5, 1.5, -1], pole: [0.6, -0.7, 0.2] },
      hand: [-1, 0.1, 0.1], palm: [0, -0.3, -1], grip: "grasp" },
    legR: { step: [-5, 7], turn: 10, heel: 32, knee: [-0.35, 0, 1] },
    legL: { step: [0, -2], turn: 12 },
  },
  {
    id: "sideTriceps", name: "Side triceps", view: -90, flex: 0.3, spread: 0.35, vacuum: 0.5, chestUp: 0.7,
    note: "The long head of the triceps sets the hang of the arm from this angle.",
    body: { pelvis: [0, -6, 0], abdomen: [0, -8, 0], chest: [-3, -10, 0], neck: [0, -12, 0], head: [2, -22, 0] },
    armR: { shrug: -2, upper: [0.06, -0.99, -0.14], fore: [0.02, -0.98, -0.2], hand: [0.02, -0.97, -0.24], palm: [0.1, 0, -1], grip: "fist" },
    armL: { ik: { from: "hand.R", to: [-1, 1.5, -1.5], pole: [0.7, -0.4, -0.8] },
      hand: [-1, -0.2, 0], palm: [0, 0, 1], grip: "grasp" },
    legR: { step: [-5, 7], turn: 10, heel: 32, knee: [-0.35, 0, 1] },
    legL: { step: [0, -2], turn: 12 },
  },
  {
    id: "backDouble", name: "Back double biceps", view: 180, flex: 1, spread: 0.7, vacuum: 0.2, chestUp: 0.2,
    note: "Lat insertion is unmissable from behind — high insertions leave a gap above the waist.",
    body: { chest: [-3, 0, 0], head: [-8, 0, 0] },
    arm: { shrug: 8, upper: [1, 0.2, -0.08], fore: [-0.3, 1, -0.02], hand: [-0.62, 0.78, -0.05], palm: [-0.75, -0.55, -0.35], grip: "fist" },
    legL: { step: [3, -20], turn: 12, heel: 38 }, legR: { step: [1, 0], turn: 10 },
  },
  {
    id: "rearLat", name: "Rear lat spread", view: 180, flex: 0.4, spread: 1, vacuum: 0.3, chestUp: 0.3,
    note: "The classic cobra. Width here is lat insertion plus clavicle, and neither is trainable.",
    body: { chest: [-2, 0, 0], head: [-4, 0, 0] },
    arm: { shrug: 3, reach: 12, ik: { from: "pelvis", to: [17, 20, 0], pole: [1, 0.05, 0.35] },
      hand: [-0.05, -0.95, 0.3], palm: [-1, 0, 0.05], grip: "flat" },
    legL: { step: [3, -20], turn: 12, heel: 38 }, legR: { step: [1, 0], turn: 10 },
  },
  {
    id: "absThigh", name: "Abs and thigh", view: 0, flex: 0.3, spread: 0.2, vacuum: 0, chestUp: 0.2,
    note: "Ab insertions on show: blocky and even, or staggered and offset.",
    body: { abdomen: [9, 0, 0], chest: [5, 0, 0], neck: [4, 0, 0], head: [6, 0, 0] },
    /* hands cupping the back of the head, the left over the right; elbows out */
    arm: { shrug: 6, hand: [-0.97, 0.05, -0.1], palm: [0, 0.1, 1], grip: "clasp" },
    armL: { ik: { from: "head", to: [9.5, 3, -13], pole: [1, 0.45, 0.15] } },
    armR: { ik: { from: "head", to: [9.5, 2.5, -10.8], pole: [1, 0.45, 0.15] } },
    legL: { step: [5, 20], turn: 16 }, legR: { step: [0, -2], turn: 10 },
  },
  {
    id: "mostMuscular", name: "Most muscular", view: 0, flex: 1, spread: 0.4, vacuum: 0.2, chestUp: 0.45,
    note: "Everything contracted at once. Traps and pec insertions dominate the read.",
    body: { abdomen: [8, 0, 0], chest: [10, 0, 0], neck: [-2, 0, 0], head: [2, 0, 0] },
    /* the crab: fists meeting low in front, elbows driven forward and out */
    arm: { shrug: 14, reach: 16, ik: { from: "pelvis", to: [10.5, 15, 23], pole: [1, 0.3, 0.55] },
      hand: [-0.85, -0.4, 0.15], palm: [0.05, 0.4, -0.9], grip: "fist" },
    leg: { step: [6, 0], turn: 22, knee: [0.3, 0, 1] }, hips: [0, -2, 0],
  },
  {
    id: "vacuum", name: "Vacuum", view: 0, flex: 0.2, spread: 0.6, vacuum: 1, chestUp: 1,
    note: "Rib cage lifted, waist pulled in, hands behind the head. Structure over mass — the old-school test.",
    body: { abdomen: [-3, 0, 0], chest: [-6, 0, 0], head: [-2, 0, 0] },
    arm: { shrug: 8, hand: [-0.97, 0.05, -0.1], palm: [0, 0.1, 1], grip: "clasp" },
    armL: { ik: { from: "head", to: [9.5, 3, -13], pole: [1, 0.55, -0.1] } },
    armR: { ik: { from: "head", to: [9.5, 2.5, -10.8], pole: [1, 0.55, -0.1] } },
    leg: { step: [0, 0], turn: 12 },
  },
];
export const POSE_BY_ID = Object.fromEntries(POSES.map((p) => [p.id, p]));
