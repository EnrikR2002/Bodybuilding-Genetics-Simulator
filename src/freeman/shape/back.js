/* ---------------------------------------------------------------------------
   Back: lat insertion and trap height, plus the lat flare used by spread and
   double-biceps poses.
   --------------------------------------------------------------------------- */
import { smooth } from "./context.js";

export default {
  id: "back",
  traits: ["latInsertion", "trapHeight"],
  prepare(ctx) {
    const { base, normal, arm, n } = ctx, verts = [], lat = [], trap = [], spreadV = [], spread = [];
    for (let v = 0; v < n; v++) {
      const x = base[v * 3], y = base[v * 3 + 1], front = normal[v * 3 + 2], ax = Math.abs(x);
      const torso = (1 - arm[v]) * smooth(99, 110, y) * (1 - smooth(145, 156, y));
      const l = torso * smooth(0.15, 0.8, -front) * smooth(4, 13, ax) * smooth(103, 119, y)
        * (1 - smooth(129, 143, y));
      const t = smooth(0.1, 0.8, -front) * smooth(139, 149, y) * (1 - smooth(158, 163, y))
        * (1 - smooth(11, 21, ax));
      if (l || t) { verts.push(v); lat.push(l); trap.push(t); }
      const f = (1 - arm[v]) * smooth(6, 15, ax) * smooth(103, 118, y) * (1 - smooth(137, 147, y));
      if (f) { spreadV.push(v); spread.push(f * Math.sign(x)); }
    }
    return { verts: Uint32Array.from(verts), lat: Float32Array.from(lat), trap: Float32Array.from(trap),
      spreadVerts: Uint32Array.from(spreadV), spread: Float32Array.from(spread) };
  },
  apply(ctx, r, s, out) {
    const lat = (s.latInsertion - 0.5) * -7, trap = (s.trapHeight - 0.5) * 2.8;
    if (!lat && !trap) return;
    for (let i = 0; i < r.verts.length; i++) out[r.verts[i] * 3 + 1] += lat * r.lat[i] + trap * r.trap[i];
  },
  applyPose(ctx, r, s, pose, out) {
    if (!pose.spread) return;
    const k = pose.spread * 4.2;
    for (let i = 0; i < r.spreadVerts.length; i++) out[r.spreadVerts[i] * 3] += k * r.spread[i];
  },
};
