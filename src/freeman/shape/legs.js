/* ---------------------------------------------------------------------------
   Legs: calf insertion and quad teardrop.

   Calf insertion transports the sculpted gastrocnemius along the shin on the
   back of the leg. A high calf ends the belly early and leaves a long Achilles
   interval; a low calf carries the belly toward the ankle. The knee and ankle
   joints never move.
   --------------------------------------------------------------------------- */
import { clamp, mix, smooth, select } from "./context.js";

const A = 0.1, B = 0.66;
const endFor = (value) => (value < 0.5 ? mix(0.52, B, value * 2) : mix(B, 0.77, (value - 0.5) * 2));

function limb(ctx, side) {
  const b = ctx.bones[`shin.${side}`], ax = b.axis;
  // "back" is -Z with the shin axis component removed
  let fx = ax[0] * ax[2], fy = ax[1] * ax[2], fz = -1 + ax[2] * ax[2];
  const l = Math.hypot(fx, fy, fz);
  return { side, sign: side === "L" ? 1 : -1, head: b.head, axis: ax, length: b.length,
    front: [fx / l, fy / l, fz / l] };
}

export default {
  id: "legs",
  traits: ["calfInsertion", "quadTeardrop"],
  prepare(ctx) {
    return {
      limbs: [limb(ctx, "L"), limb(ctx, "R")],
      verts: select(ctx, (v) => ctx.leg[v] > 0.4 && ctx.base[v * 3 + 1] < 60),
    };
  },
  apply(ctx, r, s, out) {
    const value = s.calfInsertion;
    if (value === 0.5) return;
    const end = endFor(value), definition = 1 - s.bodyFat * 0.72;
    const growK = Math.sqrt((B - A) / (end - A)) - 1;
    for (const v of r.verts) {
      const o = v * 3;
      for (const L of r.limbs) {
        const px = out[o], py = out[o + 1], pz = out[o + 2];
        if (px * L.sign < 2) continue;
        const dx = px - L.head[0], dy = py - L.head[1], dz = pz - L.head[2], ax = L.axis;
        const t = (dx * ax[0] + dy * ax[1] + dz * ax[2]) / L.length;
        if (t < 0.1 || t > 1.03) continue;
        const rx = dx - ax[0] * t * L.length, ry = dy - ax[1] * t * L.length, rz = dz - ax[2] * t * L.length;
        const rr = Math.hypot(rx, ry, rz);
        if (rr < 0.1 || rr > 15) continue;
        const angular = smooth(-0.12, 0.72, (rx * L.front[0] + ry * L.front[1] + rz * L.front[2]) / rr);
        const target = t + (end - B) * smooth(A, B, t) * (1 - smooth(B, 1, t));
        const gate = angular * smooth(0.1, 0.25, t) * (1 - smooth(0.92, 1.02, t)) * definition;
        const along = (target - t) * L.length * gate;
        const belly = Math.sin(Math.PI * clamp((t - A) / (B - A)));
        const growth = growK * Math.max(0, rr - 3.2) * belly * gate / rr;
        out[o] += ax[0] * along + rx * growth;
        out[o + 1] += ax[1] * along + ry * growth;
        out[o + 2] += ax[2] * along + rz * growth;
      }
    }
  },
};
