/* ---------------------------------------------------------------------------
   Turn the dissection's answers into a surface the skin can sit on.

   `project_anatomy_rays.py` reported, for every skin vertex, what the ray hit:
   which structure, how far that structure stands off its own bone, which way
   its surface faces, and how far along its own length the hit landed.

   Two things come out of that here.

   The first is ownership. A vertex belongs to the muscle its ray hit, so the
   borders between muscles are the borders a dissection has, not the edges of a
   typed-out arc. Where the owner changes across an edge of the mesh, that is a
   real intermuscular line.

   The second is relief, and it is the one that matters. Standoff on its own is
   mostly limb thickness, which the production body already has. Subtract a
   blurred copy of it and what is left is the muscle-scale part: bellies stand
   proud, the gaps between them fall away, flat tendons read as flat. That
   field is the difference between a smooth mannequin and a body, and no
   formula produces it — it is measured off real anatomy.

   Output: public/models/anatomy.bin

   Run: node tools/bake-anatomy.mjs
   --------------------------------------------------------------------------- */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readObj, readTarget, readSkeleton } from './mh-parse.mjs';
import { Subdivider } from '../src/body/subdiv.js';
import { readBundle } from './read-bundle.mjs';
import { CHAINS } from './region-table.mjs';
import {
  buildFrames, rigJoints, axisPoint, D2R,
  sub, add, mul, dot, cross, len, norm,
} from './mh-frames.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'assets-src');
const REF = path.join(SRC, 'anatomy-reference');
const BUILD = path.join(REF, 'build');
const OUT = path.join(ROOT, 'public', 'models', 'anatomy.bin');

/* How wide a feature counts as "muscle scale". Anything broader than this is
   the shape of the limb and belongs to the body, not to the relief field.
   Measured in Laplacian passes over a mesh whose edges run about 6 mm, so
   this keeps features up to roughly three and a half centimetres — a head of
   the triceps, the gap between two quadriceps — and discards anything wider,
   which is limb bulk rather than definition. */
const BLUR_PASSES = 45;
/* The other end of the band. Skin does not follow anything finer than about a
   centimetre: fat and fascia bridge the gaps between the slips of the
   pectoralis and the fibre bundles the scan happens to model, and leaving
   those in draws them across the chest as scratches. */
const RELIEF_SMOOTH = 4;
/* The dissection was scanned, and scans are noisy: two neighbouring rays can
   graze a fold or a fibre and come back centimetres apart. A median ignores a
   lone wrong reading completely, where an average spreads it over the
   neighbourhood as a scribble in the skin. */
const MEDIAN_PASSES = 3;
/* How far the skin is allowed to stand off, or sink below, the smooth shape of
   the limb. Nine millimetres of relief on a lean, developed body is already a
   very deep separation; more is a wound. */
const RELIEF_UP = 0.90;
const RELIEF_DOWN = 0.75;

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

/* ======================================================================== */
const meta = JSON.parse(fs.readFileSync(path.join(BUILD, 'anatomy-rays.json'), 'utf8'));
const hitMeta = JSON.parse(fs.readFileSync(path.join(BUILD, 'anatomy-hits.json'), 'utf8'));
const rays = new Float32Array(fs.readFileSync(path.join(BUILD, 'anatomy-rays.bin')).buffer.slice(0));
const hits = new Float32Array(fs.readFileSync(path.join(BUILD, 'anatomy-hits.bin')).buffer.slice(0));
const GROUPS = hitMeta.groups;
const chainOf = Object.fromEntries(Object.entries(meta.chains).map(([k, v]) => [v, k]));

console.log('reading mesh + skeleton');
const obj = readObj(path.join(SRC, '3dobjs', 'base.obj'));
const nAll = obj.pos.length / 3;
const quads = Int32Array.from(obj.groups.get('body').quads);
const P = Float64Array.from(obj.pos);
{
  const t = readTarget(path.join(SRC, 'targets/macrodetails/caucasian-male-young.target'));
  for (let i = 0; i < t.idx.length; i++) {
    const v = t.idx[i] * 3;
    P[v] += t.delta[i * 3]; P[v + 1] += t.delta[i * 3 + 1]; P[v + 2] += t.delta[i * 3 + 2];
  }
}
const skel = readSkeleton(path.join(SRC, 'rigs', 'default.mhskel'));

/* Everything below works on the subdivided mesh the renderer actually draws.
   The cage is too coarse to hold a tendinous inscription; this is not. */
const body = readBundle(path.join(ROOT, 'public', 'models', 'body.bin'));
const LV = body.header.levels[0];
const L0 = {
  nVerts: LV.nVerts, nE: LV.nE, nF: LV.nF, nOut: LV.nOut,
  edgeV: body.byName('L0_edgeV'), edgeF: body.byName('L0_edgeF'),
  vfOff: body.byName('L0_vfOff'), vfIdx: body.byName('L0_vfIdx'),
  veOff: body.byName('L0_veOff'), veIdx: body.byName('L0_veIdx'),
  quads: body.byName('L0_quads'),
};
const nSub = L0.nOut;
const subQuads = body.byName('subQuads');
const subPos = new Subdivider([L0]).run(Float32Array.from(P));
console.log(`  ${nSub} render vertices, ${subQuads.length / 4} quads`);

/* ---- rest normals on the subdivided surface ---- */
const NRM = new Float32Array(nSub * 3);
{
  const nq = subQuads.length / 4;
  for (let f = 0; f < nq; f++) {
    const a = subQuads[f * 4] * 3, b = subQuads[f * 4 + 1] * 3,
          c = subQuads[f * 4 + 2] * 3, d = subQuads[f * 4 + 3] * 3;
    const ux = subPos[c] - subPos[a], uy = subPos[c + 1] - subPos[a + 1], uz = subPos[c + 2] - subPos[a + 2];
    const vx = subPos[d] - subPos[b], vy = subPos[d + 1] - subPos[b + 1], vz = subPos[d + 2] - subPos[b + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    for (const o of [a, b, c, d]) { NRM[o] += nx; NRM[o + 1] += ny; NRM[o + 2] += nz; }
  }
  for (let v = 0; v < nSub; v++) {
    const o = v * 3;
    const l = Math.hypot(NRM[o], NRM[o + 1], NRM[o + 2]) || 1;
    NRM[o] /= l; NRM[o + 1] /= l; NRM[o + 2] /= l;
  }
}

/* ---- surface adjacency, for every blur below ---- */
const ADJ = (() => {
  const set = Array.from({ length: nSub }, () => new Set());
  for (let f = 0; f < subQuads.length / 4; f++)
    for (let k = 0; k < 4; k++) {
      const a = subQuads[f * 4 + k], b = subQuads[f * 4 + (k + 1) % 4];
      set[a].add(b); set[b].add(a);
    }
  const off = new Int32Array(nSub + 1);
  for (let v = 0; v < nSub; v++) off[v + 1] = off[v] + set[v].size;
  const idx = new Int32Array(off[nSub]);
  let o = 0;
  for (let v = 0; v < nSub; v++) for (const n of set[v]) idx[o++] = n;
  return { off, idx };
})();

/* Blur a field over the surface, but only where it exists. Vertices with no
   reading must not drag their neighbours toward zero — the edge of the
   projected area is not a valley. */
function blurWhere(field, mask, passes) {
  let cur = Float32Array.from(field);
  let next = new Float32Array(nSub);
  for (let pass = 0; pass < passes; pass++) {
    next.set(cur);
    for (let v = 0; v < nSub; v++) {
      if (!mask[v]) continue;
      let sum = 0, n = 0;
      for (let i = ADJ.off[v]; i < ADJ.off[v + 1]; i++) {
        const w = ADJ.idx[i];
        if (!mask[w]) continue;
        sum += cur[w]; n++;
      }
      if (!n) continue;
      next[v] = cur[v] * 0.30 + (sum / n) * 0.70;
    }
    const t = cur; cur = next; next = t;
  }
  return cur;
}

/* Replace each reading with the median of itself and its neighbours. Unlike a
   blur this leaves a real edge — the line between two muscles — exactly where
   it is, while a single bad ray simply disappears. */
function despeckle(field, mask, passes) {
  let cur = Float32Array.from(field);
  const next = new Float32Array(nSub);
  const bucket = new Float64Array(16);
  for (let pass = 0; pass < passes; pass++) {
    next.set(cur);
    for (let v = 0; v < nSub; v++) {
      if (!mask[v]) continue;
      let n = 0;
      bucket[n++] = cur[v];
      for (let i = ADJ.off[v]; i < ADJ.off[v + 1] && n < bucket.length; i++) {
        const w = ADJ.idx[i];
        if (mask[w]) bucket[n++] = cur[w];
      }
      if (n < 3) continue;
      const use = Array.prototype.slice.call(bucket, 0, n).sort((a, b) => a - b);
      next[v] = n & 1 ? use[(n - 1) >> 1] : (use[n / 2 - 1] + use[n / 2]) * 0.5;
    }
    cur.set(next);
  }
  return cur;
}

/* ======================================================================== *
   both frame sets again, so an atlas surface normal can be carried back
 * ======================================================================== */
const cageFrames = buildFrames(rigJoints(P, skel), CHAINS);
const atlasJoints = JSON.parse(fs.readFileSync(path.join(REF, 'atlas-joints.json'), 'utf8')).joints;
const ATLAS_CHAINS = {
  upperarm: ['shoulder', 'elbow'], forearm: ['elbow', 'wrist'],
  thigh: ['hip', 'knee'], shank: ['knee', 'ankle'],
};
const S = meta.transform.scale, OY = meta.transform.offsetY, OZ = meta.transform.offsetZ;
const toAtlas = p => [p[0] / S, -(p[2] - OZ) / S, (p[1] - OY) / S];
const atlasChainDef = {};
for (const [name, def] of Object.entries(CHAINS))
  atlasChainDef[name] = { ...def, joints: def.joints.map((_, i) => `${name}:${i}`) };
const atlasFrames = buildFrames((label, side) => {
  const [chain, i] = label.split(':');
  const pair = ATLAS_CHAINS[chain];
  if (!pair) return toAtlas(rigJoints(P, skel)(CHAINS[chain].joints[+i], side));
  return atlasJoints[`${pair[+i]}.${side}`];
}, atlasChainDef, { front: [0, -1, 0], left: [1, 0, 0] });

/* Atlas metres to cage centimetres, per chain. The two bodies are not the
   same size and their limbs are not in the same proportion, so relief has to
   be scaled by the bone it was measured on. */
const chainScale = {};
for (const key of Object.keys(cageFrames))
  chainScale[key] = (cageFrames[key].total / 10) / atlasFrames[key].total * 100;

/* ======================================================================== *
   who owns each patch of skin

   The outermost surface is not always the structure that shapes the skin. A
   dissection contains sheets: the external oblique's aponeurosis lies over the
   whole rectus abdominis, the iliotibial tract runs down the outside of the
   vastus lateralis, the thoracolumbar fascia covers the erectors. Those sheets
   are thin, and what a body shows through them is the belly underneath.

   So the surface height comes from the outermost hit — a sheet drapes over the
   muscle below and already carries its shape — but the name comes from the
   first structure in the stack whose reach is within its own allowance of the
   outside. That is one number per structure, stated here, rather than a rule
   hidden in the projection.
 * ======================================================================== */
const REACH = {
  rectus_abs: 0.030,     /* the sheath it bulges through is a few millimetres */
  serratus: 0.014,       /* its digitations show between the oblique's fibres */
  vastus_lat: 0.016,     /* the iliotibial tract is a band, not a muscle */
  rectus_fem: 0.008,
  glutes: 0.010,
  erectors: 0.008,
  lat: 0.006,
  infraspinatus: 0.005,
  rhomboids: 0.005,
  teres: 0.005,
};

/* How much of a structure's measured relief the skin actually shows.

   The dissection is a dissection: nothing lies on top of it. On a body there
   is a layer of fascia and fat over everything, and it does not drape evenly.
   It hardly softens a muscle belly, and it almost completely fills the hollows
   around a flat bone — which is why a scapula reads as a ridge and an edge on
   a lean back, never as the whole plate the atlas contains.

   One is the honest default. Everything listed here is a structure the skin
   deliberately does not follow all the way down. */
const RELIEF_GAIN = {
  scapula_b: 0.42,
  ribs_b: 0.35,
  sternum_b: 0.62,
  iliac_b: 0.72,
  patella_b: 0.75,
  /* deep muscles: real, but seen through whatever covers them */
  infraspinatus: 0.62,
  rhomboids: 0.60,
  glute_med: 0.65,
  /* a fascial band, not a belly */
  it_band: 0.58,
};

console.log('gathering ray hits');
const RS = meta.stride, HS = hitMeta.stride, STACK = hitMeta.stack;
const reach = GROUPS.map(g => REACH[g] || 0);
const gainOf = GROUPS.map(g => RELIEF_GAIN[g] ?? 1);
const owner = new Int16Array(nSub).fill(-1);
const ownerScore = new Float32Array(nSub);
const along = new Float32Array(nSub);
const alongW = new Float32Array(nSub);
const pushDir = new Float32Array(nSub * 3);
const covered = new Uint8Array(nSub);

/* Relief has to be measured against the limb it sits on. Standoff from the
   spine and standoff from the humerus are different numbers about different
   bones; blurring one into the other at the shoulder produces a trench where
   the deltoid should be. Each chain therefore gets its own pass, and the
   results are mixed afterwards by how much the rig gives that vertex to it. */
const perChain = {};
const claim = key => (perChain[key] ||= {
  standoff: new Float32Array(nSub),
  weight: new Float32Array(nSub),
  along: new Float32Array(nSub),
  cosTh: new Float32Array(nSub),
  sinTh: new Float32Array(nSub),
  mask: new Uint8Array(nSub),
});

for (let i = 0; i < meta.count; i++) {
  const h = i * HS;
  if (hits[h] < 0) continue;
  const r = i * RS;
  const v = rays[r] | 0;
  const key = chainOf[rays[r + 1] | 0];
  const side = rays[r + 2] < 0.5 ? 'L' : 'R';
  const aff = rays[r + 3];
  const u = rays[r + 4];
  const th = rays[r + 5] * D2R;
  const scale = chainScale[key];
  const w = aff * aff;

  /* the outermost surface is the one the skin lies on */
  const outer = hits[h + 1];
  const C = claim(key);
  C.standoff[v] += outer * scale * w;
  C.along[v] += u * w;
  C.cosTh[v] += Math.cos(th) * w;
  C.sinTh[v] += Math.sin(th) * w;
  C.weight[v] += w;
  C.mask[v] = 1;
  covered[v] = 1;

  /* the name, and the surface that goes with it */
  let best = 0, bestScore = -1e9;
  for (let k = 0; k < STACK; k++) {
    const g = hits[h + k * 6];
    if (g < 0) break;
    const score = hits[h + k * 6 + 1] + reach[g | 0];
    if (score > bestScore) { bestScore = score; best = k; }
  }
  const bh = h + best * 6;
  const g = hits[bh] | 0;
  along[v] += hits[bh + 2] * w;
  alongW[v] += w;

  /* Carry the muscle's surface normal home. Both frames describe the same
     place on the same bone, so the normal is decomposed in one and rebuilt in
     the other: out from the bone, round it, and along it. */
  const af = atlasFrames[key], cf = cageFrames[key];
  const { seg: aSeg } = axisPoint(af, u);
  const { seg: cSeg } = axisPoint(cf, u);
  const sideTh = CHAINS[key.split('.')[0]].sided || side === 'L' ? th : -th;
  const aRad = norm(add(mul(aSeg.ref, Math.cos(sideTh)), mul(aSeg.bin, Math.sin(sideTh))));
  const aTan = cross(aSeg.axis, aRad);
  const n = [hits[bh + 3], hits[bh + 4], hits[bh + 5]];
  const cRad = norm(add(mul(cSeg.ref, Math.cos(sideTh)), mul(cSeg.bin, Math.sin(sideTh))));
  const cTan = cross(cSeg.axis, cRad);
  const back = add(add(mul(cRad, dot(n, aRad)), mul(cTan, dot(n, aTan))),
                   mul(cSeg.axis, dot(n, aSeg.axis)));
  pushDir[v * 3] += back[0] * w;
  pushDir[v * 3 + 1] += back[1] * w;
  pushDir[v * 3 + 2] += back[2] * w;

  if (w > ownerScore[v]) { ownerScore[v] = w; owner[v] = g; }
}

const relGain = new Float32Array(nSub).fill(1);
for (let v = 0; v < nSub; v++) if (owner[v] >= 0) relGain[v] = gainOf[owner[v]];

let n = 0;
for (let v = 0; v < nSub; v++) {
  if (!covered[v]) continue;
  if (alongW[v]) along[v] /= alongW[v];
  const l = Math.hypot(pushDir[v * 3], pushDir[v * 3 + 1], pushDir[v * 3 + 2]) || 1;
  for (let k = 0; k < 3; k++) pushDir[v * 3 + k] /= l;
  /* A muscle surface can face away from the skin where the ray grazed it.
     Leaning such a normal back toward the skin keeps a belly growing outward
     instead of tunnelling into the body. */
  const sn = [NRM[v * 3], NRM[v * 3 + 1], NRM[v * 3 + 2]];
  let d = [pushDir[v * 3], pushDir[v * 3 + 1], pushDir[v * 3 + 2]];
  if (dot(d, sn) < 0.30) d = norm(add(mul(d, 0.35), mul(sn, 0.65)));
  for (let k = 0; k < 3; k++) pushDir[v * 3 + k] = d[k];
  n++;
}
console.log(`  ${n} cage vertices carry anatomy`);

/* ======================================================================== *
   relief: standoff minus the broad shape of the limb it was measured on
 * ======================================================================== */
console.log('separating muscle relief from limb thickness');
/* A limb is an offset, tapering cylinder, and neither of those facts is
   muscle definition.

   The taper is obvious: an arm measures eight centimetres across at the
   deltoid and four at the elbow. The offset is less obvious and does more
   damage. A femur does not run down the middle of a thigh — it sits toward
   the back and the outside — and the atlas femur and the production thigh bone
   do not sit at quite the same place inside their legs. Measure height from
   the bone and that mismatch reads as "every muscle on the inside of the leg
   is sunken and every muscle on the outside is swollen", which is exactly the
   wrong answer.

   Both are removed the same way: at each slice along the bone, fit the plain
   shape `centre + offset` to the measured heights and take it off. What
   survives is variation that is local to a muscle, which is the whole point.  */
const BINS = 40;
function removeLimbShape(height, C) {
  /* three weighted normal equations per slice: one for the mean height, two
     for where the bone sits inside the limb */
  const A = Array.from({ length: BINS }, () => new Float64Array(9));
  const B = Array.from({ length: BINS }, () => new Float64Array(3));
  const at = v => 1 / (C.weight[v] || 1);
  const bin = v => clamp(Math.round(C.along[v] * at(v) * (BINS - 1)), 0, BINS - 1);
  for (let v = 0; v < nSub; v++) {
    if (!C.mask[v]) continue;
    const k = at(v), w = C.weight[v];
    const basis = [1, C.cosTh[v] * k, C.sinTh[v] * k];
    const b = bin(v), a = A[b], rhs = B[b];
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) a[i * 3 + j] += basis[i] * basis[j] * w;
      rhs[i] += basis[i] * height[v] * w;
    }
  }
  const coef = Array.from({ length: BINS }, (_, b) => solve3(A[b], B[b]));
  /* a thin slice must not be allowed to make a step, so the fit is smoothed
     along the bone before it is used */
  for (let pass = 0; pass < 4; pass++) {
    const t = coef.map(c => c.slice());
    for (let b = 0; b < BINS; b++)
      for (let i = 0; i < 3; i++)
        coef[b][i] = (t[Math.max(0, b - 1)][i] + t[b][i] * 2 + t[Math.min(BINS - 1, b + 1)][i]) * 0.25;
  }
  const out = new Float32Array(nSub);
  for (let v = 0; v < nSub; v++) {
    if (!C.mask[v]) continue;
    const k = at(v), c = coef[bin(v)];
    out[v] = height[v] - (c[0] + c[1] * C.cosTh[v] * k + c[2] * C.sinTh[v] * k);
  }
  return out;
}

/* Gauss-Jordan on three unknowns, with a ridge term so an empty or
   single-angle slice cannot divide by zero. */
function solve3(a, b) {
  const m = [
    [a[0] + 1e-6, a[1], a[2], b[0]],
    [a[3], a[4] + 1e-6, a[5], b[1]],
    [a[6], a[7], a[8] + 1e-6, b[2]],
  ];
  for (let i = 0; i < 3; i++) {
    let p = i;
    for (let r = i + 1; r < 3; r++) if (Math.abs(m[r][i]) > Math.abs(m[p][i])) p = r;
    [m[i], m[p]] = [m[p], m[i]];
    const d = m[i][i];
    if (Math.abs(d) < 1e-12) return [0, 0, 0];
    for (let j = i; j < 4; j++) m[i][j] /= d;
    for (let r = 0; r < 3; r++) {
      if (r === i) continue;
      const f = m[r][i];
      for (let j = i; j < 4; j++) m[r][j] -= f * m[i][j];
    }
  }
  return [m[0][3], m[1][3], m[2][3]];
}

const relief = new Float32Array(nSub);
const reliefW = new Float32Array(nSub);
for (const C of Object.values(perChain)) {
  const height = new Float32Array(nSub);
  for (let v = 0; v < nSub; v++) if (C.weight[v]) height[v] = C.standoff[v] / C.weight[v];
  const clean = despeckle(height, C.mask, MEDIAN_PASSES);
  const level = removeLimbShape(clean, C);
  const broad = blurWhere(level, C.mask, BLUR_PASSES);
  for (let v = 0; v < nSub; v++) {
    if (!C.mask[v]) continue;
    relief[v] += (level[v] - broad[v]) * C.weight[v];
    reliefW[v] += C.weight[v];
  }
}
for (let v = 0; v < nSub; v++) if (reliefW[v]) relief[v] /= reliefW[v];

/* The dissection has cavities the skin never follows: the gap between two
   ribs, the space behind a tendon, the hollow where one muscle passes under
   another. Skin bridges those. Clamping the negative side harder than the
   positive side is what bridging looks like as a number. */
for (let v = 0; v < nSub; v++) {
  const r = relief[v] * relGain[v];
  relief[v] = r >= 0 ? Math.min(r, RELIEF_UP) : Math.max(r * 0.72, -RELIEF_DOWN);
}
relief.set(blurWhere(relief, covered, RELIEF_SMOOTH));

/* Fade the field out at the edge of the projected area — the neck, the wrist,
   the ankle — so it never ends on a step. */
{
  const edge = Float32Array.from(covered);
  const soft = blurWhere(edge, new Uint8Array(nSub).fill(1), 3);
  for (let v = 0; v < nSub; v++) relief[v] *= clamp(soft[v] * 1.35, 0, 1);
}

let lo = 0, hi = 0, sum = 0;
for (let v = 0; v < nSub; v++) {
  if (!covered[v]) continue;
  lo = Math.min(lo, relief[v]); hi = Math.max(hi, relief[v]); sum += Math.abs(relief[v]);
}
console.log(`  relief ${lo.toFixed(2)} .. ${hi.toFixed(2)} cm, mean |r| ${(sum / n).toFixed(3)} cm`);

/* ======================================================================== *
   what the scan does not contain

   The dissection's rectus abdominis is a smooth strap. Real ones are crossed
   by three or four tendinous inscriptions and split down the middle by the
   linea alba, and those lines are most of what people mean by "abs". They are
   missing here because BodyParts3D modelled the muscle, not its fascia.

   The lines themselves are drawn at run time — one of them is a genetic
   slider, so their spacing has to stay adjustable — but the two things that
   locate them are geometry and belong in the bake: which side of the body a
   vertex is on, and how far it is from the midline.
 * ======================================================================== */
const side = new Int8Array(nSub);
const midline = new Float32Array(nSub);
{
  let halfWidth = 0;
  for (let v = 0; v < nSub; v++)
    if (covered[v]) halfWidth = Math.max(halfWidth, Math.abs(subPos[v * 3]));
  for (let v = 0; v < nSub; v++) {
    if (!covered[v]) continue;
    const x = subPos[v * 3] * 10;            /* decimetres -> centimetres */
    side[v] = x >= 0 ? 1 : -1;
    /* about a centimetre each way, which is the width of a real linea alba */
    midline[v] = Math.exp(-(x * x) / (2 * 1.15 * 1.15));
  }
}

/* ======================================================================== *
   intermuscular lines: where the owner changes across an edge
 * ======================================================================== */
console.log('tracing intermuscular borders');
const border = new Float32Array(nSub);
for (let v = 0; v < nSub; v++) {
  if (owner[v] < 0) continue;
  for (let i = ADJ.off[v]; i < ADJ.off[v + 1]; i++) {
    const w = ADJ.idx[i];
    if (owner[w] >= 0 && owner[w] !== owner[v]) { border[v] = 1; break; }
  }
}
const borderSoft = blurWhere(border, covered, 2);

/* ======================================================================== *
   debug colour: one hue per structure, so the map can be looked at
 * ======================================================================== */
const debugColor = new Float32Array(nSub * 3);
const hsv = (h, s, v) => {
  const i = Math.floor(h * 6), f = h * 6 - i;
  const p = v * (1 - s), q = v * (1 - f * s), t = v * (1 - (1 - f) * s);
  return [[v, t, p], [q, v, p], [p, v, t], [p, q, v], [t, p, v], [v, p, q]][((i % 6) + 6) % 6];
};
const hues = GROUPS.map((_, i) => hsv((i * 0.137) % 1, 0.82, 1));
for (let v = 0; v < nSub; v++) {
  if (owner[v] < 0) continue;
  const c = hues[owner[v]];
  const k = 1 - borderSoft[v] * 0.85;
  for (let j = 0; j < 3; j++) debugColor[v * 3 + j] = c[j] * k;
}

/* ======================================================================== *
   write
 * ======================================================================== */
const chunks = [];
let offset = 0;
function put(name, arr) {
  const pad = (4 - (offset % 4)) % 4;
  if (pad) { chunks.push(Buffer.alloc(pad)); offset += pad; }
  chunks.push(Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength));
  const rec = { name, type: arr.constructor.name, offset, length: arr.length };
  offset += arr.byteLength;
  return rec;
}
const blocks = [];
const idxOf = (name, arr) => blocks.push(put(name, arr)) - 1;
const header = {
  version: 1,
  source: 'z-anatomy',
  license: 'CC BY-SA 4.0 / CC BY-SA 2.1 Japan',
  nCage: nAll,
  nSub,
  groups: GROUPS,
  blurPasses: BLUR_PASSES,
  relief: idxOf('relief', relief),
  owner: idxOf('owner', owner),
  border: idxOf('border', borderSoft),
  along: idxOf('along', along),
  side: idxOf('side', side),
  midline: idxOf('midline', midline),
  rectusGroup: GROUPS.indexOf('rectus_abs'),
  pushDir: idxOf('pushDir', pushDir),
  covered: idxOf('covered', covered),
  debugColor: idxOf('debugColor', debugColor),
  blocks,
};
const hb = Buffer.from(JSON.stringify(header), 'utf8');
const lead = Buffer.alloc(8);
lead.write('IPRG', 0, 'ascii');
lead.writeUInt32LE(hb.length, 4);
const pad = Buffer.alloc((4 - ((8 + hb.length) % 4)) % 4);
fs.mkdirSync(path.dirname(OUT), { recursive: true });
const buf = Buffer.concat([lead, hb, pad, ...chunks]);
fs.writeFileSync(OUT, buf);
console.log(`  ${path.relative(ROOT, OUT).split(path.sep).join('/')}  ${(buf.length / 1048576).toFixed(2)} MB`);
