/* ---------------------------------------------------------------------------
   Helpers for stages that act on the projected anatomy.

   A trait finds its muscle in the map (ctx.anatomy), not in a hand-typed box:
   the weight of a structure at a vertex comes from the map's primary and
   secondary labels, then is softened over the surface so the deformation
   fades out with no visible edge. Belly spans are measured on the sculpt
   itself, so a trait moves the belly the artist actually sculpted.
   --------------------------------------------------------------------------- */
import { diffuse } from "./context.js";

/* Per-vertex weight (0..1) of a set of side-less structure names. `side`
   limits it to ".L" or ".R". Null without anatomy. */
export function structureWeight(ctx, names, side = null) {
  const a = ctx.anatomy;
  if (!a) return null;
  const ids = new Set(), suffix = side && (side.startsWith(".") ? side : "." + side);
  for (const name of names)
    for (const s of suffix ? [suffix] : [".L", ".R"]) {
      const id = a.idOf[name + s];
      if (id) ids.add(id);
    }
  const w = new Float32Array(ctx.n);
  for (let v = 0; v < ctx.n; v++) {
    const b = a.blend[v] / 255;
    if (ids.has(a.muscle[v])) w[v] += b;
    if (a.muscle2[v] && ids.has(a.muscle2[v])) w[v] += 1 - b;
  }
  return w;
}

/* Vertices where the field is non-zero, grown by `rings` rings of neighbours. */
export function support(ctx, field, rings = 0) {
  const { offsets, list } = ctx.adjacency();
  let mark = new Uint8Array(ctx.n);
  for (let v = 0; v < ctx.n; v++) if (field[v] > 0) mark[v] = 1;
  for (let r = 0; r < rings; r++) {
    const next = mark.slice();
    for (let v = 0; v < ctx.n; v++)
      if (mark[v]) for (let o = offsets[v]; o < offsets[v + 1]; o++) next[list[o]] = 1;
    mark = next;
  }
  const out = [];
  for (let v = 0; v < ctx.n; v++) if (mark[v]) out.push(v);
  return Uint32Array.from(out);
}

/* A structure's weight softened over the surface: { verts, field } where
   field is a full-length array and verts the vertices it can be non-zero on. */
export function softMask(ctx, names, { side = null, passes = 6, rings = 4, rate = 0.5 } = {}) {
  const w = structureWeight(ctx, names, side);
  if (!w) return null;
  const verts = support(ctx, w, rings);
  return { verts, field: passes ? diffuse(ctx, w, passes, rate, verts) : w };
}

/* Position of listed vertices along a rig bone: t (0 at the head, 1 at the
   tail), the radial offset from the axis and its length. */
export function boneCoords(bone, verts, pos) {
  const t = new Float32Array(verts.length), r = new Float32Array(verts.length * 3),
    rl = new Float32Array(verts.length);
  const [hx, hy, hz] = bone.head, [ax, ay, az] = bone.axis, L = bone.length;
  verts.forEach((v, i) => {
    const dx = pos[v * 3] - hx, dy = pos[v * 3 + 1] - hy, dz = pos[v * 3 + 2] - hz;
    const d = dx * ax + dy * ay + dz * az;
    t[i] = d / L;
    const rx = dx - ax * d, ry = dy - ay * d, rz = dz - az * d;
    r[i * 3] = rx; r[i * 3 + 1] = ry; r[i * 3 + 2] = rz;
    rl[i] = Math.hypot(rx, ry, rz);
  });
  return { t, r, rl };
}

export function quantile(values, q) {
  if (!values.length) return 0;
  const s = Float32Array.from(values).sort();
  return s[Math.min(s.length - 1, Math.max(0, Math.round(q * (s.length - 1))))];
}

/* Values of a full-length field at listed vertices. */
export const pick = (field, verts) => Float32Array.from(verts, (v) => field[v]);
