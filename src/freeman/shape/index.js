/* ---------------------------------------------------------------------------
   The rest-space shape pipeline.

   out = artist surface
     → coverage (body fat relaxes the surface)
     → arms, legs, back, torso (insertion traits move sculpted forms)
     → volume (mass and fat along the relaxed normal)
     → frame (the skeleton; also applied to joints and eyes)

   Every stage is { id, traits, prepare(ctx) → region, apply(ctx, region,
   state, out), applyPose?(ctx, region, state, pose, out, rig) }. `prepare`
   runs once per loaded sculpt and is shared by all figures. `apply` must be a
   no-op, bit for bit, when its traits are at their DEFAULT values: the
   neutral figure is the artist's sculpt exactly.
   --------------------------------------------------------------------------- */
import { coverage, volume } from "./condition.js";
import arms from "./arms.js";
import legs from "./legs.js";
import back from "./back.js";
import torso from "./torso.js";
import frame, { params as frameParams, point as framePoint } from "./frame.js";

export const STAGES = [coverage, arms, legs, back, torso, volume, frame];

export function prepareShape(ctx) {
  if (!ctx.__shape) ctx.__shape = STAGES.map((stage) => ({ stage, region: stage.prepare(ctx) }));
  return ctx.__shape;
}

export function applyShape(ctx, state, out) {
  out.set(ctx.base);
  for (const { stage, region } of prepareShape(ctx)) stage.apply(ctx, region, state, out);
  return out;
}

/* Pose-dependent shape (flexed biceps, lat flare, vacuum), in rest space after
   the frame edit and before skinning. */
export function applyPoseShape(ctx, state, pose, out, rig) {
  for (const { stage, region } of prepareShape(ctx))
    stage.applyPose?.(ctx, region, state, pose, out, rig);
}

/* Transform joints or extra meshes with the same frame edit as the surface. */
export function frameTransform(ctx, state, arr, arm = 0) {
  const P = frameParams(ctx, state);
  if (P.neutral) return arr;
  for (let o = 0; o < arr.length; o += 3) framePoint(P, arr, o, arm);
  return arr;
}
