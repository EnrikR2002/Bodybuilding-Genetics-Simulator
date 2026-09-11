/* ---------------------------------------------------------------------------
   Arms: biceps belly length, biceps peak, triceps long head.

   Each belly is found in the anatomy map and its span along the humerus is
   measured on the sculpt. Belly length slides the sculpted belly's distal end
   along the bone — the tendon interval above the elbow stretches or closes —
   and conserves volume: a shorter belly stands taller. Only the muscle and
   the tendon it carries move; neighbours stay, with a soft fade between. The
   joints never move.

   `applyPose` adds the contracted biceps for flexing poses, in rest space
   after the frame edit and before skinning.
   --------------------------------------------------------------------------- */
import { clamp, smooth } from "./context.js";
import { softMask, boneCoords, quantile, pick } from "./muscle.js";

/* A belly on a bone: `own` is the muscle itself, `carry` travels with it. */
function belly(ctx, side, boneName, own, carry, joint, endQ = 0.97) {
  const mine = softMask(ctx, own, { side, passes: 4, rings: 2 });
  const move = softMask(ctx, [...own, ...carry], { side, passes: 8, rings: 5 });
  if (!mine || !move) return null;
  const bone = ctx.bones[`${boneName}.${side}`];
  const c = boneCoords(bone, move.verts, ctx.base);
  const ownW = pick(mine.field, move.verts), ts = [];
  ownW.forEach((w, i) => { if (w > 0.8) ts.push(c.t[i]); });
  return { side, bone, verts: move.verts, move: pick(move.field, move.verts), own: ownW, ...c,
    t0: quantile(ts, 0.04), t1: quantile(ts, endQ), joint };
}

/* Slide the belly's distal end by `shift` (fraction of the bone) and conserve
   its volume; `peak` adds central height. */
function slide(out, B, shift, peak, definition) {
  if (!B) return;
  const { t0, t1, joint } = B, [ax, ay, az] = B.bone.axis, L = B.bone.length;
  const grow = Math.sqrt((t1 - t0) / Math.max(0.05, t1 + shift - t0)) - 1;
  for (let i = 0; i < B.verts.length; i++) {
    const t = B.t[i], o = B.verts[i] * 3;
    const w = smooth(t0, t1, t) * (1 - smooth(t1, joint, t));
    const along = shift * w * L * B.move[i] * definition;
    const u = clamp((t - t0) / (t1 - t0)), bell = u > 0 && u < 1 ? Math.sin(Math.PI * u) : 0;
    const rl = Math.max(B.rl[i], 0.1);
    const radial = (grow * Math.max(0, rl - 3.2) * bell + peak * (bell ** 4 - 0.35 * bell)) * B.own[i] * definition / rl;
    out[o] += ax * along + B.r[i * 3] * radial;
    out[o + 1] += ay * along + B.r[i * 3 + 1] * radial;
    out[o + 2] += az * along + B.r[i * 3 + 2] * radial;
  }
}

/* trait value → shift of the belly end; ends clamp before the joint. */
const shiftFor = (value, B, up, down) =>
  !B ? 0 : value < 0.5 ? (value - 0.5) * 2 * up : (value - 0.5) * 2 * Math.min(down, B.joint - 0.03 - B.t1);

export default {
  id: "arms",
  traits: ["bicepInsertion", "bicepPeak", "tricepsLength"],
  prepare(ctx) {
    if (!ctx.anatomy) return null;
    return ["L", "R"].map((side) => ({
      biceps: belly(ctx, side, "upperarm", ["biceps_long", "biceps_short"], ["biceps_tendon"], 1.0),
      // the map's long head runs on over its tendon plate to the elbow; the
      // fleshy belly ends well above that, near the 85th percentile
      triceps: belly(ctx, side, "upperarm", ["triceps_long"], [], 1.0, 0.85),
    }));
  },
  apply(ctx, sides, s, out) {
    if (!sides || (s.bicepInsertion === 0.5 && s.bicepPeak === 0.5 && s.tricepsLength === 0.5)) return;
    const definition = 1 - s.bodyFat * 0.72;
    for (const S of sides) {
      if (s.bicepInsertion !== 0.5 || s.bicepPeak !== 0.5)
        slide(out, S.biceps, shiftFor(s.bicepInsertion, S.biceps, 0.12, 0.09), (s.bicepPeak - 0.5) * 4, definition);
      if (s.tricepsLength !== 0.5)
        slide(out, S.triceps, shiftFor(s.tricepsLength, S.triceps, 0.13, 0.08), 0, definition);
    }
  },
  /* rig: { heads, tails } — the frame-edited joints, Vector3 by bone index */
  applyPose(ctx, sides, s, pose, out, rig) {
    if (!sides || !pose.flex) return;
    const cover = 1 - s.bodyFat * 0.6;
    for (const { biceps: B } of sides) {
      if (!B) continue;
      const shift = shiftFor(s.bicepInsertion, B, 0.12, 0.09), end = B.t1 + shift;
      const k = pose.flex * 1.15 * Math.min(1.25, Math.sqrt((B.t1 - B.t0) / Math.max(0.05, end - B.t0))) * cover;
      const h = rig.heads[B.bone.index], tl = rig.tails[B.bone.index];
      let ax = tl.x - h.x, ay = tl.y - h.y, az = tl.z - h.z;
      const len = Math.hypot(ax, ay, az);
      ax /= len; ay /= len; az /= len;
      for (let i = 0; i < B.verts.length; i++) {
        const w = B.own[i];
        if (w < 0.02) continue;
        const o = B.verts[i] * 3;
        const dx = out[o] - h.x, dy = out[o + 1] - h.y, dz = out[o + 2] - h.z;
        const t = (dx * ax + dy * ay + dz * az) / len;
        const u = clamp((t - B.t0) / (end - B.t0));
        if (u <= 0 || u >= 1) continue;
        const rx = dx - ax * t * len, ry = dy - ay * t * len, rz = dz - az * t * len;
        const rl = Math.max(Math.hypot(rx, ry, rz), 0.01), bell = Math.sin(Math.PI * u);
        const bulge = k * bell * bell * w / rl;
        out[o] += rx * bulge; out[o + 1] += ry * bulge; out[o + 2] += rz * bulge;
      }
    }
  },
};
