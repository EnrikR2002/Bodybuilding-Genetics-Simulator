/* ---------------------------------------------------------------------------
   Front torso: sternal gap, ab alignment and ab segment count.

   The sternal gap moves the medial border of both pecs, as found in the
   anatomy map, away from or toward the sternum. Ab alignment slides the left
   and right rectus abdominis in opposite directions, so the sculpted
   tendinous rows stop lining up.

   Ab segments works with the sculpt's own inscriptions, measured at about
   112.5, 119 and 125 cm above the navel (which sits near 109 cm). "Four"
   fills the lowest one. "Eight" adds the inscription real eight-packs have
   below the navel, with the depth and width measured on the sculpted ones —
   like the abdominal wall of the earlier app, the one authored form, because
   the dissection has no tendinous inscriptions to measure.
   --------------------------------------------------------------------------- */
import { smooth } from "./context.js";
import { softMask, pick } from "./muscle.js";

const LOWEST = 112.5;   // lowest sculpted inscription (cm)
const BELOW = 103.4;    // where an eighth-pack inscription sits, below the navel
const DEPTH = 0.32;     // measured relief of the sculpted inscriptions (cm)

export default {
  id: "torso",
  traits: ["pecGap", "abStagger", "abCount"],
  prepare(ctx) {
    if (!ctx.anatomy) return null;
    const { base } = ctx;
    const pec = softMask(ctx, ["pectoralis_sternal", "pectoralis_clavicular"], { passes: 8, rings: 5 });
    const medial = pick(pec.field, pec.verts).map((w, i) => {
      const x = Math.abs(base[pec.verts[i] * 3]);
      return w * (1 - smooth(1.5, 8, x)) * smooth(0.15, 1.4, x);
    });
    const rect = softMask(ctx, ["rectus_abdominis"], { passes: 6, rings: 4 });
    const rv = rect.verts, rw = pick(rect.field, rv);
    const band = new Float32Array(rv.length), fill = new Float32Array(rv.length), groove = new Float32Array(rv.length);
    for (let i = 0; i < rv.length; i++) {
      const x = base[rv[i] * 3], y = base[rv[i] * 3 + 1], ax = Math.abs(x), w = rw[i];
      band[i] = w * smooth(101, 106, y) * (1 - smooth(126, 130, y)) * Math.sign(x);
      fill[i] = w * Math.exp(-(((y - LOWEST) / 1.6) ** 2));
      // straight across each rectus half, fading at the linea alba and the lateral border
      groove[i] = w * Math.exp(-(((y - BELOW - 0.1 * ax) / 0.6) ** 2)) * smooth(0.9, 2.2, ax) * (1 - smooth(7, 9.5, ax));
    }
    // the vacuum: the abdominal wall drawn in under the ribs
    const wall = softMask(ctx, ["rectus_abdominis", "external_oblique"], { passes: 12, rings: 6 });
    const vac = pick(wall.field, wall.verts).map((w, i) => {
      const y = base[wall.verts[i] * 3 + 1];
      return w * smooth(95, 102, y) * (1 - smooth(113, 121, y));
    });
    return { pec: pec.verts, medial, rect: rv, band, fill, groove, wall: wall.verts, vac };
  },
  applyPose(ctx, r, s, pose, out) {
    if (!r || !pose.vacuum) return;
    const m = ctx.smoothNormal, k = pose.vacuum * 1.8 * (1 - s.bodyFat * 0.4);
    for (let i = 0; i < r.wall.length; i++) {
      const w = r.vac[i] * k;
      if (!w) continue;
      const o = r.wall[i] * 3;
      out[o] -= m[o] * w; out[o + 1] -= m[o + 1] * w; out[o + 2] -= m[o + 2] * w;
    }
  },
  apply(ctx, r, s, out) {
    if (!r || (s.pecGap === 0.5 && s.abStagger === 0.5 && s.abCount === 0.5)) return;
    const { base, smoothPosition: sp, normal: n } = ctx, definition = 1 - s.bodyFat * 0.6;
    const gap = (s.pecGap - 0.5) * 2;
    if (gap)
      for (let i = 0; i < r.pec.length; i++) {
        const o = r.pec[i] * 3, w = r.medial[i];
        if (!w) continue;
        out[o] += Math.sign(base[o]) * 1.4 * gap * w;
        out[o + 2] -= 0.35 * gap * w;
      }
    const st = (s.abStagger - 0.5) * 2 * 0.9 * definition;
    const four = Math.max(0, (0.5 - s.abCount) * 2), eight = Math.max(0, (s.abCount - 0.5) * 2) * definition;
    if (st || four || eight)
      for (let i = 0; i < r.rect.length; i++) {
        const o = r.rect[i] * 3;
        out[o + 1] += st * r.band[i];
        const f = four * r.fill[i];
        if (f) for (let k = 0; k < 3; k++) out[o + k] += (sp[o + k] - base[o + k]) * f;
        const g = -DEPTH * eight * r.groove[i];
        if (g) for (let k = 0; k < 3; k++) out[o + k] += n[o + k] * g;
      }
  },
};
