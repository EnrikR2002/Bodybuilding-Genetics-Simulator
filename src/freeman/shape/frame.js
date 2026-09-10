/* ---------------------------------------------------------------------------
   Frame: the skeletal traits.

   The same transform is applied to every surface vertex, to the rig joints
   and to the eyes and eyebrows, so bones always follow the surface. It runs
   last in the rest-space pipeline, after every muscle deformer.

   `point(P, arr, o, arm)` transforms the point stored at arr[o..o+2] in place.
   `arm` is the vertex's arm weight (1 for arm joints, 0 for extras).
   --------------------------------------------------------------------------- */
import { clamp, smooth } from "./context.js";

export function params(ctx, s) {
  const P = {
    clav: (s.clavicle - 0.5) * 2,
    hip: (s.hipWidth - 0.5) * 2,
    rib: (s.ribcage - 0.5) * 2,
    armA: (s.armLength - 0.5) * 0.24,
    leg: (s.legLength - 0.5) * 0.2,
    torso: (s.torsoLength - 0.5) * 0.2,
    shL: ctx.bones["upperarm.L"].head,
    shR: ctx.bones["upperarm.R"].head,
  };
  P.neutral = !P.clav && !P.hip && !P.rib && !P.armA && !P.leg && !P.torso;
  return P;
}

export function point(P, arr, o, arm) {
  let px = arr[o], py = arr[o + 1], pz = arr[o + 2];
  const sign = Math.sign(px), x = px, y = py;
  px += sign * P.clav * 3.7 * Math.max(arm, smooth(123, 145, y) * (1 - smooth(158, 170, y)) * smooth(3, 20, Math.abs(x)));
  px += x * P.hip * 0.12 * (1 - smooth(96, 120, y));
  const rib = P.rib * smooth(107, 119, y) * (1 - smooth(141, 151, y)) * (1 - arm);
  px *= 1 + rib * 0.075;
  pz *= 1 + rib * 0.13;
  if (arm > 0.001) {
    const sh = sign > 0 ? P.shL : P.shR, a = P.armA * arm;
    px += (x - sh[0]) * a;
    py += (y - sh[1]) * a;
    pz += (pz - sh[2]) * a;
  }
  py += Math.min(py, 94) * P.leg + clamp(py - 94, 0, 53) * P.torso;
  arr[o] = px; arr[o + 1] = py; arr[o + 2] = pz;
}

export default {
  id: "frame",
  traits: ["clavicle", "ribcage", "hipWidth", "waist", "torsoLength", "armLength", "legLength",
    "boneThickness", "headSize"],
  prepare() { return null; },
  apply(ctx, r, s, out) {
    const P = params(ctx, s);
    if (P.neutral) return;
    for (let v = 0; v < ctx.n; v++) point(P, out, v * 3, ctx.arm[v]);
  },
};
