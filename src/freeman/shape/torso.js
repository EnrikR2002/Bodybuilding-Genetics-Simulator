/* ---------------------------------------------------------------------------
   Front torso: sternal gap, ab alignment and ab segment count.

   Each trait moves the sculpted surface inside a mask on the front of the
   torso. Masks are measured on the unedited artist surface, so they do not
   drift as other traits change the figure.
   --------------------------------------------------------------------------- */
import { smooth } from "./context.js";

export default {
  id: "torso",
  traits: ["pecGap", "abStagger", "abCount"],
  prepare(ctx) {
    const { base, normal, arm, n } = ctx, verts = [], pec = [], ab = [];
    for (let v = 0; v < n; v++) {
      const x = base[v * 3], y = base[v * 3 + 1], front = normal[v * 3 + 2], ax = Math.abs(x);
      const torso = (1 - arm[v]) * smooth(99, 110, y) * (1 - smooth(145, 156, y));
      if (!torso) continue;
      const p = torso * smooth(0.2, 0.85, front) * smooth(124, 130, y) * (1 - smooth(141, 146, y))
        * (1 - smooth(3, 11, ax)) * smooth(0.1, 1.8, ax) * Math.sign(x);
      const a = torso * smooth(0.3, 0.9, front) * (1 - smooth(5, 9, ax)) * smooth(100, 106, y)
        * (1 - smooth(122, 129, y)) * Math.sign(x);
      if (p || a) { verts.push(v); pec.push(p); ab.push(a); }
    }
    return { verts: Uint32Array.from(verts), pec: Float32Array.from(pec), ab: Float32Array.from(ab) };
  },
  apply(ctx, r, s, out) {
    const gap = (s.pecGap - 0.5) * 2.5, stagger = (s.abStagger - 0.5) * 2;
    if (!gap && !stagger) return;
    for (let i = 0; i < r.verts.length; i++) {
      const o = r.verts[i] * 3;
      out[o] += gap * r.pec[i];
      out[o + 1] += stagger * r.ab[i];
    }
  },
};
