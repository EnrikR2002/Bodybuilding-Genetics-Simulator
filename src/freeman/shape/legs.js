/* ---------------------------------------------------------------------------
   Legs: calf insertion and quad teardrop.

   Calf insertion slides the distal end of both gastrocnemius heads, as found
   in the anatomy map, along the shin: a high calf ends early over a long
   Achilles tendon, a low calf carries the belly toward the ankle. The quad
   teardrop moves the whole vastus medialis up or down the femur. Knee and
   ankle joints never move.
   --------------------------------------------------------------------------- */
import { clamp, smooth } from "./context.js";
import { softMask, boneCoords, quantile, pick } from "./muscle.js";

function calf(ctx, side) {
  const mine = softMask(ctx, ["gastrocnemius_medial", "gastrocnemius_lateral"], { side, passes: 4, rings: 2 });
  const move = softMask(ctx, ["gastrocnemius_medial", "gastrocnemius_lateral", "calcaneal_tendon", "soleus"],
    { side, passes: 8, rings: 5 });
  if (!mine || !move) return null;
  const bone = ctx.bones[`shin.${side}`];
  const c = boneCoords(bone, move.verts, ctx.base);
  const own = pick(mine.field, move.verts), ts = [];
  own.forEach((w, i) => { if (w > 0.8) ts.push(c.t[i]); });
  return { bone, verts: move.verts, move: pick(move.field, move.verts), own, ...c,
    t0: quantile(ts, 0.03), t1: quantile(ts, 0.97), joint: 0.93 };
}

function teardrop(ctx, side) {
  const m = softMask(ctx, ["vastus_medialis"], { side, passes: 10, rings: 6 });
  if (!m) return null;
  return { bone: ctx.bones[`thigh.${side}`], verts: m.verts, move: pick(m.field, m.verts) };
}

export default {
  id: "legs",
  traits: ["calfInsertion", "quadTeardrop"],
  prepare(ctx) {
    if (!ctx.anatomy) return null;
    return ["L", "R"].map((side) => ({ calf: calf(ctx, side), vmo: teardrop(ctx, side) }));
  },
  apply(ctx, sides, s, out) {
    if (!sides || (s.calfInsertion === 0.5 && s.quadTeardrop === 0.5)) return;
    const definition = 1 - s.bodyFat * 0.72;
    for (const { calf: C, vmo: Q } of sides) {
      if (C && s.calfInsertion !== 0.5) {
        const v = s.calfInsertion, { t0, t1, joint } = C, [ax, ay, az] = C.bone.axis, L = C.bone.length;
        const shift = v < 0.5 ? (v - 0.5) * 2 * 0.13 : (v - 0.5) * 2 * Math.min(0.07, joint - 0.06 - t1);
        const grow = Math.sqrt((t1 - t0) / Math.max(0.05, t1 + shift - t0)) - 1;
        for (let i = 0; i < C.verts.length; i++) {
          const t = C.t[i], o = C.verts[i] * 3;
          const w = smooth(t0, t1, t) * (1 - smooth(t1, joint, t));
          const along = shift * w * L * C.move[i] * definition;
          const u = clamp((t - t0) / (t1 - t0)), bell = u > 0 && u < 1 ? Math.sin(Math.PI * u) : 0;
          const rl = Math.max(C.rl[i], 0.1);
          const radial = grow * Math.max(0, rl - 3) * bell * C.own[i] * definition / rl;
          out[o] += ax * along + C.r[i * 3] * radial;
          out[o + 1] += ay * along + C.r[i * 3 + 1] * radial;
          out[o + 2] += az * along + C.r[i * 3 + 2] * radial;
        }
      }
      if (Q && s.quadTeardrop !== 0.5) {
        const v = s.quadTeardrop, [ax, ay, az] = Q.bone.axis;
        const d = (v < 0.5 ? (v - 0.5) * 2 * 0.075 : (v - 0.5) * 2 * 0.04) * Q.bone.length * definition;
        for (let i = 0; i < Q.verts.length; i++) {
          const o = Q.verts[i] * 3, k = d * Q.move[i];
          out[o] += ax * k; out[o + 1] += ay * k; out[o + 2] += az * k;
        }
      }
    }
  },
};
