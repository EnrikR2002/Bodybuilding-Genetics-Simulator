/* ---------------------------------------------------------------------------
   Geometry helpers for the Freeman anatomy bake (tools/bake-freeman-anatomy.mjs).

   Nothing here knows about anatomy: a triangle BVH for ray casting, a binary
   heap, multi-source geodesic distance over a mesh graph, and a voxel
   distance field. Plain typed arrays throughout so a 1.5-million-triangle
   dissection and a 154k-vertex sculpt stay fast in node.
   --------------------------------------------------------------------------- */

/* ======================================================================== *
   BVH over triangles
 * ======================================================================== */
export class TriangleBVH {
  /* verts: Float32Array xyz, tris: Uint32Array (3 per triangle) */
  constructor(verts, tris) {
    this.verts = verts;
    this.tris = tris;
    const nt = tris.length / 3;
    const cx = new Float32Array(nt), cy = new Float32Array(nt), cz = new Float32Array(nt);
    const lo = new Float32Array(nt * 3), hi = new Float32Array(nt * 3);
    for (let t = 0; t < nt; t++) {
      let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
      for (let k = 0; k < 3; k++) {
        const o = tris[t * 3 + k] * 3;
        const x = verts[o], y = verts[o + 1], z = verts[o + 2];
        if (x < x0) x0 = x; if (x > x1) x1 = x;
        if (y < y0) y0 = y; if (y > y1) y1 = y;
        if (z < z0) z0 = z; if (z > z1) z1 = z;
      }
      lo[t * 3] = x0; lo[t * 3 + 1] = y0; lo[t * 3 + 2] = z0;
      hi[t * 3] = x1; hi[t * 3 + 1] = y1; hi[t * 3 + 2] = z1;
      cx[t] = (x0 + x1) * 0.5; cy[t] = (y0 + y1) * 0.5; cz[t] = (z0 + z1) * 0.5;
    }
    const order = new Uint32Array(nt);
    for (let t = 0; t < nt; t++) order[t] = t;
    const maxNodes = Math.max(1, 2 * Math.ceil(nt / 2) + 1) * 2;
    const box = new Float32Array(maxNodes * 6);
    const left = new Int32Array(maxNodes);   // >= 0: inner node, first child index; < 0: leaf, -(start+1)
    const count = new Int32Array(maxNodes);  // leaf triangle count
    let nodes = 0;
    const cent = [cx, cy, cz];
    const stack = [[0, nt, nodes++]];
    const LEAF = 4;
    while (stack.length) {
      const [s, e, id] = stack.pop();
      let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
      let a0 = Infinity, b0 = Infinity, c0 = Infinity, a1 = -Infinity, b1 = -Infinity, c1 = -Infinity;
      for (let i = s; i < e; i++) {
        const t = order[i];
        if (lo[t * 3] < x0) x0 = lo[t * 3]; if (hi[t * 3] > x1) x1 = hi[t * 3];
        if (lo[t * 3 + 1] < y0) y0 = lo[t * 3 + 1]; if (hi[t * 3 + 1] > y1) y1 = hi[t * 3 + 1];
        if (lo[t * 3 + 2] < z0) z0 = lo[t * 3 + 2]; if (hi[t * 3 + 2] > z1) z1 = hi[t * 3 + 2];
        if (cx[t] < a0) a0 = cx[t]; if (cx[t] > a1) a1 = cx[t];
        if (cy[t] < b0) b0 = cy[t]; if (cy[t] > b1) b1 = cy[t];
        if (cz[t] < c0) c0 = cz[t]; if (cz[t] > c1) c1 = cz[t];
      }
      box.set([x0, y0, z0, x1, y1, z1], id * 6);
      if (e - s <= LEAF) {
        left[id] = -(s + 1);
        count[id] = e - s;
        continue;
      }
      const ext = [a1 - a0, b1 - b0, c1 - c0];
      const axis = ext[0] > ext[1] ? (ext[0] > ext[2] ? 0 : 2) : (ext[1] > ext[2] ? 1 : 2);
      const c = cent[axis];
      const mid = (s + e) >> 1;
      quickselect(order, s, e - 1, mid, c);
      const l = nodes++, r = nodes++;
      left[id] = l;
      count[id] = 0;
      stack.push([s, mid, l], [mid, e, r]);
    }
    this.box = box.subarray(0, nodes * 6);
    this.left = left.subarray(0, nodes);
    this.count = count.subarray(0, nodes);
    this.order = order;
    this.stack = new Int32Array(256);
  }

  /* Every triangle crossing the ray within [0, tmax], as (t, tri, u, v, facing)
     pushed into `out` (a plain array, cleared first). facing < 0: the ray
     enters through the triangle's front face. Unsorted. */
  rayAll(ox, oy, oz, dx, dy, dz, tmax, out) {
    out.length = 0;
    const { box, left, count, order, tris, verts } = this;
    const ix = 1 / dx, iy = 1 / dy, iz = 1 / dz;
    const stack = this.stack;
    let sp = 0;
    stack[sp++] = 0;
    while (sp) {
      const id = stack[--sp];
      const b = id * 6;
      let t0 = (box[b] - ox) * ix, t1 = (box[b + 3] - ox) * ix;
      if (t0 > t1) { const q = t0; t0 = t1; t1 = q; }
      let u0 = (box[b + 1] - oy) * iy, u1 = (box[b + 4] - oy) * iy;
      if (u0 > u1) { const q = u0; u0 = u1; u1 = q; }
      if (u0 > t0) t0 = u0; if (u1 < t1) t1 = u1;
      let w0 = (box[b + 2] - oz) * iz, w1 = (box[b + 5] - oz) * iz;
      if (w0 > w1) { const q = w0; w0 = w1; w1 = q; }
      if (w0 > t0) t0 = w0; if (w1 < t1) t1 = w1;
      if (t0 > t1 || t1 < 0 || t0 > tmax) continue;
      const l = left[id];
      if (l >= 0) {
        stack[sp++] = l;
        stack[sp++] = l + 1;
        continue;
      }
      const s = -l - 1, e = s + count[id];
      for (let i = s; i < e; i++) {
        const tri = order[i];
        const a = tris[tri * 3] * 3, bb = tris[tri * 3 + 1] * 3, c = tris[tri * 3 + 2] * 3;
        const e1x = verts[bb] - verts[a], e1y = verts[bb + 1] - verts[a + 1], e1z = verts[bb + 2] - verts[a + 2];
        const e2x = verts[c] - verts[a], e2y = verts[c + 1] - verts[a + 1], e2z = verts[c + 2] - verts[a + 2];
        const px = dy * e2z - dz * e2y, py = dz * e2x - dx * e2z, pz = dx * e2y - dy * e2x;
        const det = e1x * px + e1y * py + e1z * pz;
        if (det > -1e-12 && det < 1e-12) continue;
        const inv = 1 / det;
        const sx = ox - verts[a], sy = oy - verts[a + 1], sz = oz - verts[a + 2];
        const u = (sx * px + sy * py + sz * pz) * inv;
        if (u < 0 || u > 1) continue;
        const qx = sy * e1z - sz * e1y, qy = sz * e1x - sx * e1z, qz = sx * e1y - sy * e1x;
        const v = (dx * qx + dy * qy + dz * qz) * inv;
        if (v < 0 || u + v > 1) continue;
        const t = (e2x * qx + e2y * qy + e2z * qz) * inv;
        if (t < 0 || t > tmax) continue;
        // det > 0 means the ray runs against the geometric normal (e1 x e2).
        out.push({ t, tri, u, v, facing: det > 0 ? -1 : 1 });
      }
    }
    return out;
  }

  /* Closest hit or null. */
  rayFirst(ox, oy, oz, dx, dy, dz, tmax, scratch = []) {
    this.rayAll(ox, oy, oz, dx, dy, dz, tmax, scratch);
    let best = null;
    for (const h of scratch) if (!best || h.t < best.t) best = h;
    return best;
  }

  /* Farthest hit or null (the outer envelope seen from inside). */
  rayLast(ox, oy, oz, dx, dy, dz, tmax, scratch = []) {
    this.rayAll(ox, oy, oz, dx, dy, dz, tmax, scratch);
    let best = null;
    for (const h of scratch) if (!best || h.t > best.t) best = h;
    return best;
  }
}

function quickselect(order, lo, hi, k, key) {
  while (hi > lo) {
    const pivot = key[order[(lo + hi) >> 1]];
    let i = lo, j = hi;
    while (i <= j) {
      while (key[order[i]] < pivot) i++;
      while (key[order[j]] > pivot) j--;
      if (i <= j) { const t = order[i]; order[i] = order[j]; order[j] = t; i++; j--; }
    }
    if (k <= j) hi = j;
    else if (k >= i) lo = i;
    else return;
  }
}

/* ======================================================================== *
   binary min-heap of (key, value)
 * ======================================================================== */
export class Heap {
  constructor(capacity = 1024) {
    this.keys = new Float64Array(capacity);
    this.vals = new Int32Array(capacity);
    this.size = 0;
  }
  push(key, val) {
    if (this.size === this.keys.length) {
      const k = new Float64Array(this.size * 2); k.set(this.keys); this.keys = k;
      const v = new Int32Array(this.size * 2); v.set(this.vals); this.vals = v;
    }
    let i = this.size++;
    const { keys, vals } = this;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (keys[p] <= key) break;
      keys[i] = keys[p]; vals[i] = vals[p]; i = p;
    }
    keys[i] = key; vals[i] = val;
  }
  pop() {
    const { keys, vals } = this;
    const topKey = keys[0], topVal = vals[0];
    const key = keys[--this.size], val = vals[this.size];
    let i = 0;
    for (;;) {
      let c = 2 * i + 1;
      if (c >= this.size) break;
      if (c + 1 < this.size && keys[c + 1] < keys[c]) c++;
      if (keys[c] >= key) break;
      keys[i] = keys[c]; vals[i] = vals[c]; i = c;
    }
    keys[i] = key; vals[i] = val;
    this.lastKey = topKey;
    return topVal;
  }
}

/* Multi-source geodesic (graph) distance over mesh edges.
   `seeds` is an iterable of vertex ids; `allow(v)` restricts the walk.
   Returns Float32Array of distances (Infinity where unreached). If `source`
   is given, it receives the seed each vertex was reached from. */
export function geodesic(pos, adj, seeds, allow = null, source = null, maxDist = Infinity) {
  const n = pos.length / 3;
  const dist = new Float32Array(n).fill(Infinity);
  const heap = new Heap(4096);
  for (const s of seeds) {
    if (allow && !allow(s)) continue;
    dist[s] = 0;
    if (source) source[s] = s;
    heap.push(0, s);
  }
  const { offsets, list } = adj;
  while (heap.size) {
    const v = heap.pop();
    const d = heap.lastKey;
    if (d > dist[v]) continue;
    if (d > maxDist) break;
    const vx = pos[v * 3], vy = pos[v * 3 + 1], vz = pos[v * 3 + 2];
    for (let o = offsets[v]; o < offsets[v + 1]; o++) {
      const w = list[o];
      if (allow && !allow(w)) continue;
      const nd = d + Math.hypot(pos[w * 3] - vx, pos[w * 3 + 1] - vy, pos[w * 3 + 2] - vz);
      if (nd < dist[w]) {
        dist[w] = nd;
        if (source) source[w] = source[v];
        heap.push(nd, w);
      }
    }
  }
  return dist;
}

/* ======================================================================== *
   voxel distance field: distance (cm) to the nearest of a set of points
 * ======================================================================== */
export class DistanceField {
  constructor(lo, hi, cell) {
    this.lo = lo;
    this.cell = cell;
    this.nx = Math.ceil((hi[0] - lo[0]) / cell) + 1;
    this.ny = Math.ceil((hi[1] - lo[1]) / cell) + 1;
    this.nz = Math.ceil((hi[2] - lo[2]) / cell) + 1;
    this.d = new Float32Array(this.nx * this.ny * this.nz).fill(1e9);
  }
  /* Exact distances from the points to their own voxel centres, then an
     8-pass chamfer sweep carries them everywhere (good to a few mm). */
  build(points) {
    const { nx, ny, nz, d, lo, cell } = this;
    for (let i = 0; i < points.length; i += 3) {
      const fx = (points[i] - lo[0]) / cell, fy = (points[i + 1] - lo[1]) / cell, fz = (points[i + 2] - lo[2]) / cell;
      const x = Math.round(fx), y = Math.round(fy), z = Math.round(fz);
      if (x < 0 || y < 0 || z < 0 || x >= nx || y >= ny || z >= nz) continue;
      const k = (z * ny + y) * nx + x;
      const e = Math.hypot(fx - x, fy - y, fz - z) * cell;
      if (e < d[k]) d[k] = e;
    }
    const a = cell, b = cell * Math.SQRT2, c = cell * Math.sqrt(3);
    const offs = [];
    for (let dz = -1; dz <= 1; dz++) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const m = Math.abs(dx) + Math.abs(dy) + Math.abs(dz);
      if (!m) continue;
      offs.push([dx, dy, dz, m === 1 ? a : m === 2 ? b : c]);
    }
    const fwd = offs.filter(([dx, dy, dz]) => dz < 0 || (dz === 0 && (dy < 0 || (dy === 0 && dx < 0))));
    const bwd = offs.filter((o) => !fwd.includes(o));
    for (let pass = 0; pass < 2; pass++) {
      for (let z = 0; z < nz; z++) for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
        const k = (z * ny + y) * nx + x;
        let best = d[k];
        for (const [dx, dy, dz, w] of fwd) {
          const X = x + dx, Y = y + dy, Z = z + dz;
          if (X < 0 || Y < 0 || Z < 0 || X >= nx || Y >= ny || Z >= nz) continue;
          const v = d[(Z * ny + Y) * nx + X] + w;
          if (v < best) best = v;
        }
        d[k] = best;
      }
      for (let z = nz - 1; z >= 0; z--) for (let y = ny - 1; y >= 0; y--) for (let x = nx - 1; x >= 0; x--) {
        const k = (z * ny + y) * nx + x;
        let best = d[k];
        for (const [dx, dy, dz, w] of bwd) {
          const X = x + dx, Y = y + dy, Z = z + dz;
          if (X < 0 || Y < 0 || Z < 0 || X >= nx || Y >= ny || Z >= nz) continue;
          const v = d[(Z * ny + Y) * nx + X] + w;
          if (v < best) best = v;
        }
        d[k] = best;
      }
    }
    return this;
  }
  /* trilinear lookup */
  at(px, py, pz) {
    const { nx, ny, nz, d, lo, cell } = this;
    let fx = (px - lo[0]) / cell, fy = (py - lo[1]) / cell, fz = (pz - lo[2]) / cell;
    fx = Math.min(Math.max(fx, 0), nx - 1.001);
    fy = Math.min(Math.max(fy, 0), ny - 1.001);
    fz = Math.min(Math.max(fz, 0), nz - 1.001);
    const x = Math.floor(fx), y = Math.floor(fy), z = Math.floor(fz);
    const tx = fx - x, ty = fy - y, tz = fz - z;
    const k = (z * ny + y) * nx + x, sy = nx, sz = nx * ny;
    const c00 = d[k] * (1 - tx) + d[k + 1] * tx;
    const c10 = d[k + sy] * (1 - tx) + d[k + sy + 1] * tx;
    const c01 = d[k + sz] * (1 - tx) + d[k + sz + 1] * tx;
    const c11 = d[k + sz + sy] * (1 - tx) + d[k + sz + sy + 1] * tx;
    return (c00 * (1 - ty) + c10 * ty) * (1 - tz) + (c01 * (1 - ty) + c11 * ty) * tz;
  }
}

/* small vector helpers */
export const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const len = (a) => Math.hypot(a[0], a[1], a[2]);
export const norm = (a) => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
export const clamp = (x, a = 0, b = 1) => (x < a ? a : x > b ? b : x);
export const smoothstep = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };
