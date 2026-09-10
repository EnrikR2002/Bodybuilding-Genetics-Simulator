/* ---------------------------------------------------------------------------
   Development and condition: mass, leg mass, back density and body fat.

   Two stages. `coverage` runs first, before any insertion deformer: body fat
   blends the surface toward a relaxed copy of the same topology, so a softer
   physique loses its separations instead of keeping them at a larger radius.
   `volume` runs after the insertion deformers and adds mass and fat along the
   relaxed surface normal, which never follows a crease into a fold.
   --------------------------------------------------------------------------- */
import { smooth } from "./context.js";

export const coverage = {
  id: "coverage",
  traits: ["bodyFat"],
  prepare(ctx) {
    if (!ctx.smoothPosition) return null;
    const { base, hand, n } = ctx, mask = new Float32Array(n);
    for (let v = 0; v < n; v++) {
      const y = base[v * 3 + 1];
      mask[v] = 0.95 * smooth(25, 50, y) * (1 - smooth(150, 166, y)) * (1 - smooth(0.05, 0.65, hand[v]));
    }
    return { mask };
  },
  apply(ctx, region, s, out) {
    if (!region || !s.bodyFat) return;
    const { base, smoothPosition: sp } = ctx, mask = region.mask, f = s.bodyFat;
    for (let v = 0; v < ctx.n; v++) {
      const k = mask[v] * f;
      if (!k) continue;
      const o = v * 3;
      out[o] += (sp[o] - base[o]) * k;
      out[o + 1] += (sp[o + 1] - base[o + 1]) * k;
      out[o + 2] += (sp[o + 2] - base[o + 2]) * k;
    }
  },
};

export const volume = {
  id: "volume",
  traits: ["mass", "legMass", "backThickness", "bodyFat"],
  prepare(ctx) {
    const { base, normal, arm, hand, n } = ctx;
    const muscle = new Float32Array(n), back = new Float32Array(n), fat = new Float32Array(n),
      legs = new Uint8Array(n);
    for (let v = 0; v < n; v++) {
      const y = base[v * 3 + 1], front = normal[v * 3 + 2];
      const handK = 1 - smooth(0.05, 0.65, hand[v]);
      const torso = (1 - arm[v]) * smooth(99, 110, y) * (1 - smooth(145, 156, y));
      muscle[v] = 2 * smooth(14, 30, y) * (1 - smooth(150, 165, y)) * handK;
      back[v] = 1.5 * torso * smooth(0.1, 0.8, -front) * handK;
      fat[v] = 2.4 * smooth(13, 40, y) * (1 - smooth(149, 168, y))
        * (0.55 + 0.8 * smooth(93, 105, y) * (1 - smooth(117, 129, y)))
        * (1 - arm[v] * 0.5) * handK;
      legs[v] = y < 98 ? 1 : 0;
    }
    return { muscle, back, fat, legs };
  },
  apply(ctx, r, s, out) {
    const up = s.mass - 0.5, lo = s.legMass - 0.5, bk = s.backThickness - 0.5, bf = s.bodyFat;
    if (!up && !lo && !bk && !bf) return;
    const m = ctx.smoothNormal;
    for (let v = 0; v < ctx.n; v++) {
      const d = (r.legs[v] ? lo : up) * r.muscle[v] + bk * r.back[v] + bf * r.fat[v];
      if (!d) continue;
      const o = v * 3;
      out[o] += m[o] * d;
      out[o + 1] += m[o + 1] * d;
      out[o + 2] += m[o + 2] * d;
    }
  },
};
