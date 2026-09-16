/* ---------------------------------------------------------------------------
   Back: lat insertion and trap height, plus the lat flare used by spreads
   and double-biceps poses.

   Lat insertion works on the lower, outer part of the latissimus as found in
   the anatomy map — the sweep that decides where the V meets the waist. High
   lats lift that border and thin the lower flare; low lats carry it down to
   the waist and fill it. Trap height lifts and fills the upper trapezius
   toward the neck.
   --------------------------------------------------------------------------- */
import { smooth } from "./context.js";
import { softMask, pick, structureWeight, support } from "./muscle.js";
import { diffuse } from "./context.js";

export default {
  id: "back",
  traits: ["latInsertion", "trapHeight"],
  prepare(ctx) {
    if (!ctx.anatomy) return null;
    const { base } = ctx;
    const lat = softMask(ctx, ["latissimus"], { passes: 10, rings: 6 });
    const lower = pick(lat.field, lat.verts).map((w, i) => {
      const v = lat.verts[i], x = Math.abs(base[v * 3]), y = base[v * 3 + 1];
      // the lowest edge stays put, so the moved border never folds into the hip
      return w * smooth(104, 111, y) * (1 - smooth(114, 128, y)) * smooth(5, 12, x);
    });
    // this mesh is dense (edges ~3 mm): a smooth border needs a wide, well-diffused falloff
    const trap = softMask(ctx, ["trapezius_upper"], { passes: 120, rings: 30 });
    // strongest mid-slope, fading out before the neck, so the border never shelves
    const upper = pick(trap.field, trap.verts).map((w, i) => {
      const y = base[trap.verts[i] * 3 + 1];
      return w * smooth(132, 141, y) * (1 - smooth(147, 154, y));
    });
    // The flare: a broad sweep of the outer lat and teres, widest a hand below
    // the armpit and gone by the waist. Shaped first, then diffused wide so the
    // moved skin has no edge against the ribs, the arm or the spine.
    const lats = structureWeight(ctx, ["latissimus", "teres_major"]), shaped = new Float32Array(ctx.n);
    for (let v = 0; v < ctx.n; v++) {
      if (!lats[v]) continue;
      const x = Math.abs(base[v * 3]), y = base[v * 3 + 1];
      shaped[v] = lats[v] * smooth(7, 15, x) * smooth(100, 117, y) * (1 - smooth(127, 139, y)) * (1 - smooth(0.3, 0.8, ctx.arm[v]));
    }
    const flare = support(ctx, shaped, 30), field = diffuse(ctx, shaped, 90, 0.5, flare);
    let peak = 0;
    for (const v of flare) peak = Math.max(peak, field[v]);
    // the middle of the back stays put: only the outer sweep travels
    const spread = Float32Array.from(flare, (v) => (field[v] / peak) * (1 - ctx.arm[v]) * smooth(8, 17, Math.abs(base[v * 3])));
    return { lat: lat.verts, lower, trap: trap.verts, upper, flare, spread };
  },
  apply(ctx, r, s, out) {
    if (!r || (s.latInsertion === 0.5 && s.trapHeight === 0.5)) return;
    const m = ctx.smoothNormal, definition = 1 - s.bodyFat * 0.5;
    // high lats lift the lower border and expose the waist; low lats mostly fill the lower flare
    const v = s.latInsertion;
    const lift = (v < 0.5 ? (0.5 - v) * 2 * 3 : 0) * definition, fill = (v - 0.5) * 2 * 1.1;
    if (lift || fill)
      for (let i = 0; i < r.lat.length; i++) {
        const w = r.lower[i];
        if (!w) continue;
        const o = r.lat[i] * 3;
        out[o] += m[o] * fill * w;
        out[o + 1] += lift * w + m[o + 1] * fill * w;
        out[o + 2] += m[o + 2] * fill * w;
      }
    const up = (s.trapHeight - 0.5) * 2;
    if (up)
      for (let i = 0; i < r.trap.length; i++) {
        const w = r.upper[i] * up;
        if (!w) continue;
        const o = r.trap[i] * 3;
        out[o] += m[o] * 0.8 * w;
        out[o + 1] += 0.9 * w + m[o + 1] * 0.8 * w;
        out[o + 2] += m[o + 2] * 0.8 * w;
      }
  },
  applyPose(ctx, r, s, pose, out) {
    if (!r || !pose.spread) return;
    // straight out to the side: the wings widen without swelling the back
    const k = pose.spread * 5.5;
    for (let i = 0; i < r.flare.length; i++) out[r.flare[i] * 3] += k * r.spread[i] * Math.sign(ctx.base[r.flare[i] * 3]);
  },
};
