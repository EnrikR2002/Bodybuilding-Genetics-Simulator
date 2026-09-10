/* ---------------------------------------------------------------------------
   The shared shape context.

   Built once per loaded sculpt and shared by every Freeman instance (the
   current figure and a pinned comparison read the same arrays). It holds the
   artist surface, the rig, per-vertex body-region weights, a lazily built
   vertex adjacency, and the projected anatomy when it is available.

   Coordinates: centimetres, Y up, +Z forward, +X is the figure's left.
   --------------------------------------------------------------------------- */
import { boneRegion } from "../bones.js";

export const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
export const smooth = (a, b, x) => {
  const t = clamp((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
export const mix = (a, b, t) => a + (b - a) * t;

export function buildContext(data) {
  if (data.__ctx) return data.__ctx;
  const n = data.meta.vertices;
  const defs = data.meta.bones;
  const region = defs.map((b) => boneRegion(b.name));
  const arm = new Float32Array(n), hand = new Float32Array(n), leg = new Float32Array(n),
    head = new Float32Array(n);
  for (let v = 0; v < n; v++)
    for (let k = 0; k < 4; k++) {
      const r = region[data.skinIndex[v * 4 + k]], w = data.skinWeight[v * 4 + k];
      // `arm` includes the hand: it is the whole limb hanging off the clavicle.
      if (r === "arm" || r === "hand") arm[v] += w;
      if (r === "hand") hand[v] += w;
      if (r === "leg") leg[v] += w;
      if (r === "head") head[v] += w;
    }
  const smoothNormal = new Float32Array(n * 3);
  const sn = data.smoothNormal ?? data.normal;
  for (let v = 0; v < n; v++) {
    const x = sn[v * 3], y = sn[v * 3 + 1], z = sn[v * 3 + 2];
    const l = Math.hypot(x, y, z) || 1;
    smoothNormal[v * 3] = x / l; smoothNormal[v * 3 + 1] = y / l; smoothNormal[v * 3 + 2] = z / l;
  }
  const bones = {};
  defs.forEach((b, i) => {
    const axis = b.tail.map((t, k) => t - b.head[k]);
    const length = Math.hypot(...axis);
    bones[b.name] = { index: i, name: b.name, parent: b.parent, head: b.head, tail: b.tail,
      axis: axis.map((a) => a / length), length };
  });
  let adjacency = null;
  const ctx = {
    data, n,
    base: data.position,           // the artist surface, never modified
    normal: data.normal,           // its normals
    smoothPosition: data.smoothPosition ?? null, // the same topology, heavily relaxed
    smoothNormal,                  // unit normals of the relaxed surface
    index: data.index,
    arm, hand, leg, head,          // summed skin weight per body region, 0..1
    bones,                         // rest-pose rig by name, in the sculpt frame
    anatomy: data.anatomy ?? null, // projected dissection, see anatomy.js
    /* Vertex neighbours in compressed rows: the neighbours of v are
       list[offsets[v] .. offsets[v + 1]). Built on first use. */
    adjacency() {
      if (!adjacency) adjacency = buildAdjacency(n, data.index);
      return adjacency;
    },
  };
  data.__ctx = ctx;
  return ctx;
}

function buildAdjacency(n, index) {
  const count = new Uint32Array(n + 1);
  for (let t = 0; t < index.length; t++) count[index[t] + 1] += 2;
  for (let v = 0; v < n; v++) count[v + 1] += count[v];
  const raw = new Uint32Array(count[n]), fill = count.slice(0, n);
  for (let t = 0; t < index.length; t += 3)
    for (let k = 0; k < 3; k++) {
      const a = index[t + k];
      raw[fill[a]++] = index[t + (k + 1) % 3];
      raw[fill[a]++] = index[t + (k + 2) % 3];
    }
  const offsets = new Uint32Array(n + 1), out = [];
  for (let v = 0; v < n; v++) {
    const seen = new Set(raw.subarray(count[v], count[v + 1]));
    offsets[v + 1] = offsets[v] + seen.size;
    for (const s of seen) out.push(s);
  }
  return { offsets, list: Uint32Array.from(out) };
}

/* A scalar field over the surface, smoothed by averaging with neighbours.
   Useful for softening a mask so a deformation has no visible edge. */
export function diffuse(ctx, field, passes = 4, rate = 0.5, only = null) {
  const { offsets, list } = ctx.adjacency();
  let a = field, b = new Float32Array(field.length);
  const verts = only ?? null, total = verts ? verts.length : ctx.n;
  for (let p = 0; p < passes; p++) {
    b.set(a);
    for (let i = 0; i < total; i++) {
      const v = verts ? verts[i] : i;
      let s = 0;
      const o0 = offsets[v], o1 = offsets[v + 1];
      for (let o = o0; o < o1; o++) s += a[list[o]];
      if (o1 > o0) b[v] = a[v] + ((s / (o1 - o0)) - a[v]) * rate;
    }
    [a, b] = [b, a];
  }
  return a;
}

/* Indices of the vertices where `test(v)` is true. */
export function select(ctx, test) {
  const out = [];
  for (let v = 0; v < ctx.n; v++) if (test(v)) out.push(v);
  return Uint32Array.from(out);
}
