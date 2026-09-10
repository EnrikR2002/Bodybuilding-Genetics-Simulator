/* ---------------------------------------------------------------------------
   Measurements taken off the rest surface (unposed, unflexed), so the numbers
   do not jump when the pose changes.

   Contract: measure(fig) returns an object of plain numbers in centimetres,
   kilograms and ratios. See docs/ARCHITECTURE.md for the full field list.
   This is a placeholder until the tape measure lands.
   --------------------------------------------------------------------------- */
export function measure(fig) {
  const shoulders = fig.joint("upperarm.L").distanceTo(fig.joint("upperarm.R"));
  return { height: fig.height, shoulderJoints: shoulders };
}
