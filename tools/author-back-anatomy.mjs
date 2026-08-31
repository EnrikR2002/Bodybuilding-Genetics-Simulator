/* Author a stable back-relief corrective from Z-Anatomy's separated muscles.

   The closest atlas object owns each posterior cage vertex. Ownership changes
   locate real intermuscular borders; distance to that object supplies the
   shallow plane of the muscle between borders. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readObj } from './mh-parse.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OBJ = readObj(path.join(ROOT, 'assets-src', 'authoring', 'neutral-cage.obj'));
const MAP = JSON.parse(fs.readFileSync(path.join(
  ROOT, 'assets-src', 'anatomy-reference', 'back-cage-map.json'), 'utf8'));
const body = OBJ.groups.get('body');
const P = OBJ.pos, n = P.length / 3;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const smooth = (a, b, x) => {
  const t = clamp((x - a) / (b - a || 1e-8), 0, 1);
  return t * t * (3 - 2 * t);
};

const neighbours = Array.from({ length: n }, () => []);
const N = new Float64Array(P.length);
for (let f = 0; f < body.quads.length; f += 4) {
  const q = [body.quads[f], body.quads[f + 1], body.quads[f + 2], body.quads[f + 3]];
  for (let k = 0; k < 4; k++) {
    const a = q[k], b = q[(k + 1) % 4];
    neighbours[a].push(b); neighbours[b].push(a);
  }
  for (const tri of [[0, 1, 2], [0, 2, 3]]) {
    const a = q[tri[0]] * 3, b = q[tri[1]] * 3, c = q[tri[2]] * 3;
    const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2];
    const vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    for (const k of tri) { const o = q[k] * 3; N[o] += nx; N[o + 1] += ny; N[o + 2] += nz; }
  }
}
for (let v = 0; v < n; v++) {
  const o = v * 3, l = Math.hypot(N[o], N[o + 1], N[o + 2]) || 1;
  N[o] /= l; N[o + 1] /= l; N[o + 2] /= l;
  if (P[o + 2] < -0.2 && N[o + 2] > 0) { N[o] *= -1; N[o + 1] *= -1; N[o + 2] *= -1; }
}

const names = MAP.groups;
/* Distance from skin to each atlas muscle is not comparable across muscles:
   broad superficial lats sit millimetres below the skin, while the transverse
   trapezius and rhomboids are deeper. Normalise each object independently so
   the lat sheet cannot win every vertex merely because it is superficial. */
const PROFILE = {
  lat:        { near: 0.004, far: 0.037, height: 0.032, groove: 0.040 },
  trap_upper: { near: 0.012, far: 0.057, height: 0.044, groove: 0.045 },
  trap_mid:   { near: 0.047, far: 0.132, height: 0.038, groove: 0.043 },
  rhomboids:  { near: 0.008, far: 0.064, height: 0.030, groove: 0.041 },
  teres:      { near: 0.005, far: 0.046, height: 0.050, groove: 0.052 },
  erectors:   { near: 0, far: 1, height: 0.047, groove: 0.040 },
};
const field = Object.fromEntries(names.map(name => [name, new Float64Array(n)]));
const surface = Object.fromEntries(names.map(name => [name, new Float64Array(n).fill(NaN)]));

/* These broad zones reject a geometrically-near object on the wrong layer of
   the shoulder stack. They do not draw the muscle; the projected atlas
   distance still supplies its irregular outline inside the zone. */
function zone(name, x, y) {
  const ax = Math.abs(x);
  if (name === 'lat')
    return smooth(0.18, 0.48, ax) * (1 - smooth(5.72, 6.16, y));
  if (name === 'trap_upper')
    return smooth(5.18, 5.58, y) * (1 - smooth(1.45, 1.92, ax));
  if (name === 'trap_mid')
    return smooth(4.98, 5.32, y) * (1 - smooth(6.17, 6.46, y))
         * (1 - smooth(1.78, 2.22, ax));
  if (name === 'rhomboids')
    return smooth(4.60, 4.90, y) * (1 - smooth(5.88, 6.18, y))
         * smooth(0.16, 0.34, ax) * (1 - smooth(1.18, 1.55, ax));
  if (name === 'teres')
    return smooth(4.78, 5.02, y) * (1 - smooth(6.08, 6.34, y))
         * smooth(0.82, 1.05, ax) * (1 - smooth(2.18, 2.52, ax));
  return 1;
}

for (const rec of MAP.records) {
  const o = rec.v * 3, x = P[o], y = P[o + 1];
  for (const name of names) {
    if (name === 'erectors') continue;
    const d = rec.distance_m[name];
    if (!Number.isFinite(d)) continue;
    const p = PROFILE[name];
    field[name][rec.v] = (1 - smooth(p.near, p.far, d)) * zone(name, x, y);
    if (Number.isFinite(rec.surface_z_dm?.[name]))
      surface[name][rec.v] = rec.surface_z_dm[name];
  }
  /* The compact atlas stores erector spinae as a non-surface joined object,
     so nearest-face queries cannot recover its outline. The atlas still gives
     its longitudinal location; two narrow lumbar columns complete that part
     of the surface contract without pretending they are lat volume. */
  const ax = Math.abs(x);
  field.erectors[rec.v] = smooth(0.14, 0.27, ax) * (1 - smooth(0.76, 1.02, ax))
                        * smooth(1.56, 1.88, y) * (1 - smooth(4.92, 5.25, y));
}

/* Trace every muscle's own projected outline. This preserves the smaller
   scapular muscles even where a superficial lat overlaps them in 3D. */
const seam = new Float64Array(n);
for (const name of names) {
  const F = field[name], p = PROFILE[name];
  const edge = new Float64Array(n);
  for (let v = 0; v < n; v++) {
    if (F[v] < 0.055) continue;
    for (const u of neighbours[v]) {
      const drop = F[v] - F[u];
      if (drop > 0.035)
        edge[v] = Math.max(edge[v], smooth(0.035, 0.34, drop) * smooth(0.055, 0.42, F[v]));
    }
  }
  for (let v = 0; v < n; v++) {
    if (edge[v] <= 0) continue;
    seam[v] = Math.max(seam[v], edge[v] * p.groove);
    for (const u of neighbours[v]) seam[u] = Math.max(seam[u], edge[v] * p.groove * 0.24);
  }
}

const D = new Float64Array(P.length);
for (let v = 0; v < n; v++) {
  const o = v * 3;
  let relief = 0;
  /* Overlapping muscle layers should change the local plane, not add into a
     tumour-like mound. Use the best-supported layer and fit posterior depth
     toward its real atlas surface, with a thin skin allowance. */
  let bestName = null, bestSupport = 0;
  for (const name of names) if (field[name][v] > bestSupport) {
    bestSupport = field[name][v]; bestName = name;
  }
  if (bestName) {
    const shape = Math.pow(bestSupport, 0.72);
    const authoredPlane = PROFILE[bestName].height * shape;
    let atlasPlane = authoredPlane;
    const sz = surface[bestName][v];
    if (Number.isFinite(sz) && N[o + 2] < -0.28) {
      const desiredZ = sz - 0.025; // about 2.5 mm of skin over the atlas muscle
      atlasPlane = clamp((desiredZ - P[o + 2]) / N[o + 2], -0.045, 0.105) * shape;
    }
    relief = authoredPlane * 0.32 + atlasPlane * 0.68;
  }
  relief -= seam[v];
  /* The spinal furrow remains visible between the paired erector columns. */
  const centre = Math.exp(-(P[o] * P[o]) / (2 * 0.105 * 0.105));
  relief -= 0.034 * centre * smooth(1.35, 2.05, P[o + 1]) * (1 - smooth(5.9, 6.35, P[o + 1]));
  D[o] = N[o] * relief; D[o + 1] = N[o + 1] * relief; D[o + 2] = N[o + 2] * relief;
}

const lines = ['# Z-Anatomy separated superficial back relief'];
let moved = 0, max = 0;
for (let v = 0; v < n; v++) {
  const o = v * 3, d = Math.hypot(D[o], D[o + 1], D[o + 2]);
  if (d < 1e-6) continue;
  moved++; max = Math.max(max, d);
  lines.push(`${v} ${D[o].toFixed(8)} ${D[o + 1].toFixed(8)} ${D[o + 2].toFixed(8)}`);
}
const out = path.join(ROOT, 'assets-src', 'targets', 'correctives', 'anatomy-back.target');
fs.writeFileSync(out, lines.join('\n') + '\n');
console.log(`wrote ${path.relative(ROOT, out)}: ${moved} vertices, max ${(max * 10).toFixed(2)} cm`);
