/* ---------------------------------------------------------------------------
   Author the first production genetics pair: high and low lat insertions.

   This is intentionally a signed surface sculpt, not the old positive-only
   muscle field.  It changes the outer sweep, flattens the exposed lumbar
   interval on the high endpoint, and cuts the inferior musculofascial border
   at a different height for each endpoint.

   Run: node tools/author-lat-correctives.mjs
   --------------------------------------------------------------------------- */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readObj } from './mh-parse.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const neutralFile = path.join(ROOT, 'assets-src', 'authoring', 'neutral-cage.obj');
const referenceFile = path.join(ROOT, 'assets-src', 'anatomy-reference', 'lat-cage-map.json');
const obj = readObj(neutralFile);
const body = obj.groups.get('body');
if (!body) throw new Error('neutral cage has no body group');
const P = obj.pos;
const n = P.length / 3;
if (!fs.existsSync(referenceFile))
  throw new Error('Missing lat-cage-map.json; run the Z-Anatomy projection first');
const reference = JSON.parse(fs.readFileSync(referenceFile, 'utf8'));
const refWeight = new Float64Array(n);
for (const rec of reference.records) if (rec.v < n) refWeight[rec.v] = rec.weight;

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const smooth = (a, b, x) => {
  const t = clamp((x - a) / (b - a || 1e-8), 0, 1);
  return t * t * (3 - 2 * t);
};
const gauss = (x, sigma) => Math.exp(-(x * x) / (2 * sigma * sigma));

/* Area-weighted cage normals. */
const N = new Float64Array(P.length);
for (let f = 0; f < body.quads.length; f += 4) {
  const ids = [body.quads[f], body.quads[f + 1], body.quads[f + 2], body.quads[f + 3]];
  for (const tri of [[0, 1, 2], [0, 2, 3]]) {
    const a = ids[tri[0]] * 3, b = ids[tri[1]] * 3, c = ids[tri[2]] * 3;
    const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2];
    const vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    for (const k of tri) {
      const o = ids[k] * 3;
      N[o] += nx; N[o + 1] += ny; N[o + 2] += nz;
    }
  }
}
for (let v = 0; v < n; v++) {
  const o = v * 3;
  const len = Math.hypot(N[o], N[o + 1], N[o + 2]) || 1;
  N[o] /= len; N[o + 1] /= len; N[o + 2] /= len;
  /* OBJ winding differs between source revisions. On the posterior torso the
     outward normal must point toward negative Z. */
  if (P[o + 2] < -0.2 && N[o + 2] > 0) {
    N[o] *= -1; N[o + 1] *= -1; N[o + 2] *= -1;
  }
}

/* Boundary strength from the atlas-projected membership. The inferior contour
   is where membership changes across a cage edge, not an arbitrary horizontal
   band. */
const neighbours = Array.from({ length: n }, () => []);
for (let f = 0; f < body.quads.length; f += 4) {
  const q = [body.quads[f], body.quads[f + 1], body.quads[f + 2], body.quads[f + 3]];
  for (let k = 0; k < 4; k++) {
    const a = q[k], b = q[(k + 1) % 4];
    neighbours[a].push(b); neighbours[b].push(a);
  }
}
const refBoundary = new Float64Array(n);
for (let v = 0; v < n; v++) {
  let grad = 0;
  for (const u of neighbours[v]) grad = Math.max(grad, Math.abs(refWeight[v] - refWeight[u]));
  refBoundary[v] = smooth(0.06, 0.48, grad);
}

function field(v) {
  const o = v * 3;
  const y = P[o + 1];
  const vertical = smooth(1.35, 1.88, y) * (1 - smooth(5.88, 6.32, y));
  return Math.pow(refWeight[v], 0.72) * vertical;
}

function endpoint(kind) {
  const D = new Float64Array(P.length);
  for (let v = 0; v < n; v++) {
    const o = v * 3, x = P[o], y = P[o + 1], ax = Math.abs(x);
    const support = field(v);
    if (support < 1e-5) continue;

    const side = x < 0 ? -1 : 1;
    let normalPush = 0, lateralPush = 0;
    let border, groove;
    if (kind === 'low') {
      /* The low belly remains a broad sheet into the waist. Its lowest third
         grows laterally as well as posteriorly, which changes the silhouette. */
      const lower = smooth(1.55, 2.05, y) * (1 - smooth(4.35, 5.75, y));
      const sheet = smooth(1.48, 2.20, y) * (1 - smooth(5.72, 6.22, y));
      /* The silhouette change has to survive skin, subdivision and stage
         lighting.  A low lat is not merely a larger copy of a high one: its
         inferior fibres continue as a visible muscular sheet beside the
         lumbar fascia.  Carry that sheet both backward and outward. */
      normalPush = 0.205 * support * (0.50 + lower * 0.86) * sheet;
      lateralPush = 0.192 * support * lower * smooth(0.62, 1.36, ax);
      border = 1.62 + clamp((ax - 0.8) * 0.13, 0, 0.24);
      /* The low border comes directly from the real lat mesh contour. The
         coordinate band only keeps upper/medial reference edges out. */
      groove = refBoundary[v] * support * (1 - smooth(2.35, 3.05, y));
      normalPush -= 0.105 * groove;
    } else {
      /* A high insertion terminates below the lower ribs. Pulling the lumbar
         patch inward is as important as adding the compact upper belly. */
      const upper = smooth(3.12, 3.82, y) * (1 - smooth(5.72, 6.18, y));
      const lumbar = smooth(1.55, 1.95, y) * (1 - smooth(2.96, 3.58, y));
      /* High insertion exposes a real lumbar interval.  Flattening and
         narrowing that interval is what distinguishes an insertion from a
         generic size morph; the compact upper belly keeps its own volume. */
      normalPush = 0.145 * support * upper - 0.225 * support * lumbar;
      lateralPush = 0.055 * support * upper * smooth(0.68, 1.55, ax)
                  - 0.176 * support * lumbar * smooth(0.62, 1.40, ax);
      border = 3.18 + clamp((ax - 0.72) * 0.16, 0, 0.34);
      groove = gauss(y - border, 0.22) * support;
      normalPush -= 0.082 * groove;
    }

    D[o] += N[o] * normalPush + side * lateralPush;
    D[o + 1] += N[o + 1] * normalPush;
    D[o + 2] += N[o + 2] * normalPush;
  }
  return D;
}

function writeTarget(sliderEndpoint, label, delta) {
  const lines = [`# latInsertion endpoint ${sliderEndpoint}: ${label}`];
  let moved = 0, max = 0;
  for (let v = 0; v < n; v++) {
    const o = v * 3;
    const d = Math.hypot(delta[o], delta[o + 1], delta[o + 2]);
    if (d < 1e-6) continue;
    max = Math.max(max, d); moved++;
    lines.push(`${v} ${delta[o].toFixed(8)} ${delta[o + 1].toFixed(8)} ${delta[o + 2].toFixed(8)}`);
  }
  const out = path.join(ROOT, 'assets-src', 'targets', 'correctives', `latInsertion-${sliderEndpoint}.target`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, lines.join('\n') + '\n');
  console.log(`wrote ${path.relative(ROOT, out)}: ${moved} vertices, max ${(max * 10).toFixed(2)} cm`);
}

writeTarget(0, 'high inferior border / exposed lumbar fascia', endpoint('high'));
writeTarget(1, 'low sweep into the waist', endpoint('low'));
