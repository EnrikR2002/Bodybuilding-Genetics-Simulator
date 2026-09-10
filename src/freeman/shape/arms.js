/* ---------------------------------------------------------------------------
   Arms: biceps belly length, biceps peak, triceps long head.

   Belly length transports the existing sculpted surface along the humerus in
   the front of the arm, with smooth falloffs at both ends so there is no ring
   where the moved belly meets the unchanged tendon interval. The bony
   attachments and joints never move.

   `applyPose` adds the contracted biceps shape for flexing poses, in rest
   space after the frame edit, before skinning.
   --------------------------------------------------------------------------- */
import { clamp, mix, smooth, select } from "./context.js";

const A = 0.18, B = 0.82;                 // belly start / neutral end, fraction of the humerus
const endFor = (value) => (value < 0.5 ? mix(0.62, B, value * 2) : mix(B, 0.91, (value - 0.5) * 2));

function limb(ctx, side) {
  const b = ctx.bones[`upperarm.${side}`], ax = b.axis;
  // "front" is +Z with the humeral axis component removed
  let fx = -ax[0] * ax[2], fy = -ax[1] * ax[2], fz = 1 - ax[2] * ax[2];
  const l = Math.hypot(fx, fy, fz);
  return { side, sign: side === "L" ? 1 : -1, head: b.head, axis: ax, length: b.length,
    front: [fx / l, fy / l, fz / l], index: b.index };
}

export default {
  id: "arms",
  traits: ["bicepInsertion", "bicepPeak", "tricepsLength"],
  prepare(ctx) {
    return {
      limbs: [limb(ctx, "L"), limb(ctx, "R")],
      verts: select(ctx, (v) => ctx.arm[v] > 0.3),
      flexVerts: select(ctx, (v) => ctx.arm[v] > 0.35),
    };
  },
  apply(ctx, r, s, out) {
    const value = s.bicepInsertion, peak = s.bicepPeak;
    if (value === 0.5 && peak === 0.5) return;
    const end = endFor(value), definition = 1 - s.bodyFat * 0.72;
    const growK = Math.sqrt((B - A) / (end - A)) - 1, peakK = (peak - 0.5) * 1.6;
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
        const growth = (growK * Math.max(0, rr - 3.2) * belly + peakK * (belly ** 4 - 0.35 * belly)) * gate / rr;
        out[o] += ax[0] * along + rx * growth;
        out[o + 1] += ax[1] * along + ry * growth;
        out[o + 2] += ax[2] * along + rz * growth;
      }
    }
  },
  /* rig: { heads, tails } — the frame-edited joints, Vector3 by bone index */
  applyPose(ctx, r, s, pose, out, rig) {
    if (!pose.flex) return;
    const end = endFor(s.bicepInsertion), cover = 1 - s.bodyFat * 0.6;
    const k = pose.flex * 1.2 * Math.sqrt(0.64 / (end - 0.18)) * cover;
    for (const L of r.limbs) {
      const h = rig.heads[L.index], tl = rig.tails[L.index];
      let ax = tl.x - h.x, ay = tl.y - h.y, az = tl.z - h.z;
      const len = Math.hypot(ax, ay, az);
      ax /= len; ay /= len; az /= len;
      let fx = -ax * az, fy = -ay * az, fz = 1 - az * az;
      const fl = Math.hypot(fx, fy, fz);
      fx /= fl; fy /= fl; fz /= fl;
      for (const v of r.flexVerts) {
        const o = v * 3;
        if (out[o] * L.sign <= 2) continue;
        const dx = out[o] - h.x, dy = out[o + 1] - h.y, dz = out[o + 2] - h.z;
        const t = (dx * ax + dy * ay + dz * az) / len;
        const rx = dx - ax * t * len, ry = dy - ay * t * len, rz = dz - az * t * len;
        const rr = Math.max(Math.hypot(rx, ry, rz), 0.01);
        const belly = Math.sin(Math.PI * clamp((t - 0.18) / (end - 0.18)));
        const bulge = k * belly * belly * smooth(0.05, 0.8, (rx * fx + ry * fy + rz * fz) / rr);
        if (!bulge) continue;
        out[o] += fx * bulge; out[o + 1] += fy * bulge; out[o + 2] += fz * bulge;
      }
    }
  },
};
