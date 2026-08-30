/* ---------------------------------------------------------------------------
   Catmull-Clark subdivision, run every time the shape changes.

   The adjacency was worked out once at bake time, so this is three flat passes
   over typed arrays. 13,378 quads in, 53,512 out, about 1.5 ms.

   This is the step that decides whether the figure reads as a person or as a
   low-poly mannequin: the control cage carries the anatomy, the limit surface
   carries the smooth skin over it.
   --------------------------------------------------------------------------- */

export class Subdivider {
  constructor(levels) {
    this.levels = levels;
    this.buffers = levels.map(l => new Float32Array(l.nOut * 3));
  }

  /* src: Float32Array of cage positions. Returns the finest level. */
  run(src) {
    let cur = src;
    for (let i = 0; i < this.levels.length; i++) {
      cur = step(this.levels[i], cur, this.buffers[i]);
    }
    return cur;
  }

  get output() { return this.buffers.length ? this.buffers[this.buffers.length - 1] : null; }
}

function step(L, P, out) {
  const { nVerts, nE, nF, edgeV, edgeF, quads, vfOff, vfIdx, veOff, veIdx } = L;
  const fBase = (nVerts + nE) * 3;

  /* ---- face points: the centre of each quad ---- */
  for (let f = 0; f < nF; f++) {
    const a = quads[f * 4] * 3, b = quads[f * 4 + 1] * 3,
          c = quads[f * 4 + 2] * 3, d = quads[f * 4 + 3] * 3;
    const o = fBase + f * 3;
    out[o]     = (P[a]     + P[b]     + P[c]     + P[d])     * 0.25;
    out[o + 1] = (P[a + 1] + P[b + 1] + P[c + 1] + P[d + 1]) * 0.25;
    out[o + 2] = (P[a + 2] + P[b + 2] + P[c + 2] + P[d + 2]) * 0.25;
  }

  /* ---- edge points: midpoint pulled toward the two neighbouring centres ---- */
  for (let e = 0; e < nE; e++) {
    const a = edgeV[e * 2] * 3, b = edgeV[e * 2 + 1] * 3;
    const f0 = edgeF[e * 2], f1 = edgeF[e * 2 + 1];
    const o = (nVerts + e) * 3;
    if (f1 < 0) {                                  /* open edge: plain midpoint */
      out[o]     = (P[a]     + P[b])     * 0.5;
      out[o + 1] = (P[a + 1] + P[b + 1]) * 0.5;
      out[o + 2] = (P[a + 2] + P[b + 2]) * 0.5;
    } else {
      const p = fBase + f0 * 3, q = fBase + f1 * 3;
      out[o]     = (P[a]     + P[b]     + out[p]     + out[q])     * 0.25;
      out[o + 1] = (P[a + 1] + P[b + 1] + out[p + 1] + out[q + 1]) * 0.25;
      out[o + 2] = (P[a + 2] + P[b + 2] + out[p + 2] + out[q + 2]) * 0.25;
    }
  }

  /* ---- original vertices: (F + 2R + (n-3)P) / n ---- */
  for (let v = 0; v < nVerts; v++) {
    const vf0 = vfOff[v], vf1 = vfOff[v + 1];
    const ve0 = veOff[v], ve1 = veOff[v + 1];
    const n = vf1 - vf0;
    const o = v * 3, s = v * 3;
    if (n === 0) {                                 /* helper vertex, no faces */
      out[o] = P[s]; out[o + 1] = P[s + 1]; out[o + 2] = P[s + 2];
      continue;
    }

    /* count open edges: a vertex on a border follows the crease rule instead */
    let openA = -1, openB = -1, nOpen = 0;
    for (let i = ve0; i < ve1; i++) {
      const e = veIdx[i];
      if (edgeF[e * 2 + 1] < 0) { nOpen++; if (openA < 0) openA = e; else openB = e; }
    }
    if (nOpen >= 2) {
      const oa = (edgeV[openA * 2] === v ? edgeV[openA * 2 + 1] : edgeV[openA * 2]) * 3;
      const ob = (edgeV[openB * 2] === v ? edgeV[openB * 2 + 1] : edgeV[openB * 2]) * 3;
      out[o]     = (P[oa]     + 6 * P[s]     + P[ob])     / 8;
      out[o + 1] = (P[oa + 1] + 6 * P[s + 1] + P[ob + 1]) / 8;
      out[o + 2] = (P[oa + 2] + 6 * P[s + 2] + P[ob + 2]) / 8;
      continue;
    }

    let fx = 0, fy = 0, fz = 0;
    for (let i = vf0; i < vf1; i++) {
      const p = fBase + vfIdx[i] * 3;
      fx += out[p]; fy += out[p + 1]; fz += out[p + 2];
    }
    fx /= n; fy /= n; fz /= n;

    let rx = 0, ry = 0, rz = 0, m = 0;
    for (let i = ve0; i < ve1; i++) {
      const e = veIdx[i];
      const a = edgeV[e * 2] * 3, b = edgeV[e * 2 + 1] * 3;
      rx += (P[a] + P[b]) * 0.5; ry += (P[a + 1] + P[b + 1]) * 0.5; rz += (P[a + 2] + P[b + 2]) * 0.5;
      m++;
    }
    rx /= m; ry /= m; rz /= m;

    const k = (n - 3) / n, i2 = 2 / n, i1 = 1 / n;
    out[o]     = fx * i1 + rx * i2 + P[s]     * k;
    out[o + 1] = fy * i1 + ry * i2 + P[s + 1] * k;
    out[o + 2] = fz * i1 + rz * i2 + P[s + 2] * k;
  }
  return out;
}

/* ---------------------------------------------------------------------------
   Smooth normals on the subdivided quad mesh, then gathered onto the render
   vertices. Doing it before the UV split means seams get one shared normal and
   never show as a hard line down the body.
   --------------------------------------------------------------------------- */
export function computeNormals(subQuads, subPos, nSubVerts, out) {
  out.fill(0);
  const n = subQuads.length / 4;
  for (let f = 0; f < n; f++) {
    const a = subQuads[f * 4] * 3, b = subQuads[f * 4 + 1] * 3,
          c = subQuads[f * 4 + 2] * 3, d = subQuads[f * 4 + 3] * 3;
    /* The cross product of a quad's two diagonals is its area vector — exact
       for a flat quad, close enough for the near-flat ones a subdivision
       surface produces, and a sixth of the work of summing four edges. */
    const ux = subPos[c] - subPos[a], uy = subPos[c + 1] - subPos[a + 1], uz = subPos[c + 2] - subPos[a + 2];
    const vx = subPos[d] - subPos[b], vy = subPos[d + 1] - subPos[b + 1], vz = subPos[d + 2] - subPos[b + 2];
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    out[a] += nx; out[a + 1] += ny; out[a + 2] += nz;
    out[b] += nx; out[b + 1] += ny; out[b + 2] += nz;
    out[c] += nx; out[c + 1] += ny; out[c + 2] += nz;
    out[d] += nx; out[d + 1] += ny; out[d + 2] += nz;
  }
  for (let v = 0; v < nSubVerts; v++) {
    const o = v * 3;
    const x = out[o], y = out[o + 1], z = out[o + 2];
    const l = Math.sqrt(x * x + y * y + z * z);
    if (l > 1e-9) { out[o] = x / l; out[o + 1] = y / l; out[o + 2] = z / l; }
    else out[o + 1] = 1;
  }
}
