// Directions are in the physique's frame (+X outward on the left, +Z forward).
// The rig resolves them after frame edits, preserving each limb's own length.
export const POSES = [
  { id: "anatomy", name: "Anatomy pose", view: 0, flex: 0 },
  { id: "flex", name: "Flexed arms", view: 0, flex: 1 },
  {
    id: "frontDouble", name: "Front double biceps", view: 0, flex: 1,
    upper: [1, 0.12, 0], fore: [-0.32, 0.94, 0.12],
    hand: [-0.3, 0.94, 0.12], shoulder: 0.12, spread: 0.3,
  },
  {
    id: "backDouble", name: "Back double biceps", view: 180, flex: 1,
    upper: [1, 0.16, -0.1], fore: [-0.34, 0.93, -0.02],
    hand: [-0.3, 0.94, 0], shoulder: 0.14, spread: 0.4,
  },
  {
    id: "latSpread", name: "Front lat spread", view: 0, flex: 0.35,
    upper: [0.65, -0.76, 0.05], fore: [-0.82, -0.5, 0.28],
    hand: [-0.12, -0.96, 0.25], shoulder: 0.04, spread: 1,
  },
  {
    id: "rearLat", name: "Rear lat spread", view: 180, flex: 0.35,
    upper: [0.65, -0.76, 0.02], fore: [-0.82, -0.5, 0.28],
    hand: [-0.12, -0.96, 0.25], shoulder: 0.04, spread: 1,
  },
];
export const POSE_BY_ID = Object.fromEntries(POSES.map(p => [p.id, p]));
