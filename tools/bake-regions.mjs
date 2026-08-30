/* ---------------------------------------------------------------------------
   Work out, for every vertex, how much of each muscle it belongs to.

   Nothing here is hand-painted. For each bone run the script builds a frame
   that follows the bone, then asks three questions of every vertex:
     how far along the bone is it,
     what angle around the bone is it,
     and does the skinning agree this vertex belongs to that limb at all.
   Those three answers, blended with soft falloffs, give the muscle map.

   The skinning check is what stops the biceps region leaking onto the ribs:
   a vertex is only allowed into an arm muscle if the rig already thinks it is
   part of the arm.

   Output: public/models/regions.bin, plus a debug colour attribute so the map
   can be looked at rather than trusted.

   Run: node tools/bake-regions.mjs
   --------------------------------------------------------------------------- */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readObj, readTarget, readSkeleton, readWeights, jointCentre } from './mh-parse.mjs';
import { CHAINS, REGIONS, INSERTIONS } from './region-table.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'assets-src');
const OUT = path.join(ROOT, 'public', 'models');

const D2R = Math.PI / 180;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const smoothstep = (a, b, x) => { const t = clamp((x - a) / (b - a || 1e-6), 0, 1); return t * t * (3 - 2 * t); };
/* a soft band: full inside [a,b], fading over `s` on each shoulder */
const band = (x, a, b, s) => smoothstep(a - s, a + s * 0.35, x) * (1 - smoothstep(b - s * 0.35, b + s, x));

/* ---- vector helpers on plain arrays ---- */
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = a => Math.hypot(a[0], a[1], a[2]);
const norm = a => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

/* ======================================================================== */
console.log('reading mesh + skeleton');
const obj = readObj(path.join(SRC, '3dobjs', 'base.obj'));
const nAll = obj.pos.length / 3;
const quads = Int32Array.from(obj.groups.get('body').quads);

/* same rest mesh the runtime starts from */
const P = Float64Array.from(obj.pos);
{
  const t = readTarget(path.join(SRC, 'targets/macrodetails/caucasian-male-young.target'));
  for (let i = 0; i < t.idx.length; i++) {
    const v = t.idx[i] * 3;
    P[v] += t.delta[i * 3]; P[v + 1] += t.delta[i * 3 + 1]; P[v + 2] += t.delta[i * 3 + 2];
  }
}
const skel = readSkeleton(path.join(SRC, 'rigs', 'default.mhskel'));
const weights = readWeights(path.join(SRC, 'rigs', 'default_weights.mhw'));

/* which vertices are body surface (not helper cubes) */
const inBody = new Uint8Array(nAll);
for (const v of quads) inBody[v] = 1;

/* ---- vertex normals on the rest cage ---- */
const NRM = new Float32Array(nAll * 3);
for (let f = 0; f < quads.length / 4; f++) {
  const i = [quads[f * 4], quads[f * 4 + 1], quads[f * 4 + 2], quads[f * 4 + 3]];
  let nx = 0, ny = 0, nz = 0;
  for (let k = 0; k < 4; k++) {
    const a = i[k] * 3, b = i[(k + 1) % 4] * 3;
    nx += (P[a + 1] - P[b + 1]) * (P[a + 2] + P[b + 2]);
    ny += (P[a + 2] - P[b + 2]) * (P[a] + P[b]);
    nz += (P[a] - P[b]) * (P[a + 1] + P[b + 1]);
  }
  for (const v of i) { NRM[v * 3] += nx; NRM[v * 3 + 1] += ny; NRM[v * 3 + 2] += nz; }
}
for (let v = 0; v < nAll; v++) {
  const l = Math.hypot(NRM[v * 3], NRM[v * 3 + 1], NRM[v * 3 + 2]) || 1;
  NRM[v * 3] /= l; NRM[v * 3 + 1] /= l; NRM[v * 3 + 2] /= l;
}
/* the mesh is wound so raw face normals point inward; flip once */
{
  let c = [0, 0, 0], n = 0;
  for (let v = 0; v < nAll; v++) if (inBody[v]) { c = add(c, [P[v * 3], P[v * 3 + 1], P[v * 3 + 2]]); n++; }
  c = mul(c, 1 / n);
  let outward = 0;
  for (let v = 0; v < nAll; v++) {
    if (!inBody[v]) continue;
    const r = sub([P[v * 3], P[v * 3 + 1], P[v * 3 + 2]], c);
    outward += Math.sign(dot(r, [NRM[v * 3], NRM[v * 3 + 1], NRM[v * 3 + 2]]));
  }
  if (outward < 0) { for (let i = 0; i < NRM.length; i++) NRM[i] = -NRM[i]; console.log('  flipped normals'); }
}

/* ---- per-vertex chain affinity, straight from the rig ---- */
console.log('deriving chain affinity from skin weights');
const affinity = {};
for (const name of Object.keys(CHAINS)) affinity[name] = new Float32Array(nAll);
const totalW = new Float32Array(nAll);
for (const [bone, list] of Object.entries(weights)) {
  for (const [v, w] of list) totalW[v] += w;
}
for (const [bone, list] of Object.entries(weights)) {
  for (const [name, def] of Object.entries(CHAINS)) {
    if (!def.bones.test(bone)) continue;
    /* left / right chains only claim their own side */
    if (def.sided) {
      const isL = /\.L$/.test(bone), isR = /\.R$/.test(bone);
      if (!isL && !isR) continue;
      const key = name + (isL ? '.L' : '.R');
      affinity[key] ||= new Float32Array(nAll);
      for (const [v, w] of list) affinity[key][v] += w;
    } else {
      for (const [v, w] of list) affinity[name][v] += w;
    }
  }
}
for (const k of Object.keys(affinity)) {
  const a = affinity[k];
  for (let v = 0; v < nAll; v++) if (totalW[v] > 0) a[v] /= totalW[v];
}

/* ---------------------------------------------------------------------------
   Where two limbs meet.

   The armpit and the groin are the places the rig has to blend one chain into
   another, and they are the places skin stretches most when a joint moves. Any
   displacement added there gets folded into a deep pocket the moment the arm
   comes up, and the pocket reads as a hole in the body.

   A vertex sits in a blend zone exactly when two different chains both have a
   real claim on it, so the damper falls straight out of the skin weights.
   --------------------------------------------------------------------------- */
const blendDamp = (() => {
  const d = new Float32Array(nAll).fill(1);
  const pairs = [
    ['upperarm.L', 'torso'], ['upperarm.R', 'torso'],
    ['thigh.L', 'torso'], ['thigh.R', 'torso'],
    ['upperarm.L', 'forearm.L'], ['upperarm.R', 'forearm.R'],
    ['thigh.L', 'shank.L'], ['thigh.R', 'shank.R'],
  ];
  for (let v = 0; v < nAll; v++) {
    if (!inBody[v]) continue;
    let worst = 0;
    for (const [a, b] of pairs) {
      const A = affinity[a], B = affinity[b];
      if (!A || !B) continue;
      worst = Math.max(worst, Math.min(A[v], B[v]));
    }
    d[v] = 1 - smoothstep(0.12, 0.40, worst) * 0.82;
  }
  return d;
})();

/* ======================================================================== *
   bone frames
   A frame is built once per chain per side. The "front" direction is carried
   across each joint by the smallest rotation that lines one segment up with
   the next, so the flexor side of the forearm stays continuous with the
   biceps instead of spinning as the elbow turns.
 * ======================================================================== */
function jointPos(name, side) {
  const n = side === 'R' ? name.replace('.L__', '.R__') : name;
  const verts = skel.joints[n] || skel.joints[name];
  if (!verts) throw new Error('unknown joint ' + n);
  return jointCentre(P, verts);
}

function rotateToward(v, from, to) {
  /* rotate v by the rotation that takes `from` to `to` (Rodrigues) */
  const c = clamp(dot(from, to), -1, 1);
  if (c > 0.999999) return v.slice();
  const ax = norm(cross(from, to));
  const s = Math.sqrt(1 - c * c);
  const k = cross(ax, v);
  const d = dot(ax, v) * (1 - c);
  return [v[0] * c + k[0] * s + ax[0] * d,
          v[1] * c + k[1] * s + ax[1] * d,
          v[2] * c + k[2] * s + ax[2] * d];
}

function buildFrame(name, side) {
  const def = CHAINS[name];
  const pts = def.joints.map(j => jointPos(j, side));
  const segs = [];
  let total = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const d = sub(pts[i + 1], pts[i]);
    const L = len(d);
    segs.push({ a: pts[i], b: pts[i + 1], axis: norm(d), L, start: total });
    total += L;
  }
  for (const s of segs) { s.u0 = s.start / total; s.u1 = (s.start + s.L) / total; }

  /* front reference, transported segment to segment */
  let ref;
  if (def.transportFrom) {
    const prev = FRAMES[def.transportFrom + (def.sided ? '.' + side : '')];
    const last = prev.segs[prev.segs.length - 1];
    ref = rotateToward(last.ref, last.axis, segs[0].axis);
  } else {
    ref = [0, 0, 1];
  }
  for (let i = 0; i < segs.length; i++) {
    if (i > 0) ref = rotateToward(segs[i - 1].ref, segs[i - 1].axis, segs[i].axis);
    /* re-orthogonalise so drift cannot accumulate */
    let r = sub(ref, mul(segs[i].axis, dot(ref, segs[i].axis)));
    if (len(r) < 1e-4) r = sub([0, 0, 1], mul(segs[i].axis, dot([0, 0, 1], segs[i].axis)));
    segs[i].ref = norm(r);
    /* outward-facing binormal, so +90 degrees always means "away from the
       midline" whichever side we are on */
    let bin = norm(cross(segs[i].axis, segs[i].ref));
    const lateral = side === 'R' ? [-1, 0, 0] : [1, 0, 0];
    if (dot(bin, lateral) < 0) bin = mul(bin, -1);
    segs[i].bin = bin;
    ref = segs[i].ref;
  }
  return { segs, total, pts };
}

const FRAMES = {};
console.log('building bone frames');
for (const [name, def] of Object.entries(CHAINS)) {
  if (def.sided) for (const s of ['L', 'R']) FRAMES[name + '.' + s] = buildFrame(name, s);
  else FRAMES[name] = buildFrame(name, 'L');
}

/* project a vertex into a frame: distance along, angle around, radius */
function project(frame, p) {
  let best = null;
  for (let i = 0; i < frame.segs.length; i++) {
    const s = frame.segs[i];
    const d = sub(p, s.a);
    let t = dot(d, s.axis) / s.L;
    const tc = i === 0 ? Math.min(t, 1) : i === frame.segs.length - 1 ? Math.max(t, 0) : clamp(t, 0, 1);
    const foot = add(s.a, mul(s.axis, tc * s.L));
    const r = sub(p, foot);
    const dist = len(r);
    if (!best || dist < best.dist) {
      /* keep the raw t on the end segments so regions can reach past the joint */
      const uRaw = i === 0 ? t : i === frame.segs.length - 1 ? t : tc;
      best = {
        dist,
        u: (s.start + uRaw * s.L) / frame.total,
        th: Math.atan2(dot(r, s.bin), dot(r, s.ref)) / D2R,
        r: dist,
      };
    }
  }
  return best;
}

/* ---- mesh adjacency, used to feather region weights along the surface ---- */
const ADJ = (() => {
  const set = Array.from({ length: nAll }, () => new Set());
  for (let f = 0; f < quads.length / 4; f++)
    for (let k = 0; k < 4; k++) {
      const a = quads[f * 4 + k], b = quads[f * 4 + (k + 1) % 4];
      set[a].add(b); set[b].add(a);
    }
  const off = new Int32Array(nAll + 1);
  for (let v = 0; v < nAll; v++) off[v + 1] = off[v] + set[v].size;
  const idx = new Int32Array(off[nAll]);
  let o = 0;
  for (let v = 0; v < nAll; v++) for (const n of set[v]) idx[o++] = n;
  return { off, idx };
})();

/* Feather a per-vertex field across the mesh.

   This is the difference between a muscle map that looks painted on and one
   that looks like anatomy. The raw bands and arcs have hard edges; a few
   smoothing passes over the actual surface turn them into the gradual
   transitions a real muscle has, and stop the region borders showing up as
   creases in the skin. */
function feather(field, passes, comps = 1) {
  const cur = Float32Array.from(field);
  const next = new Float32Array(cur.length);
  for (let pass = 0; pass < passes; pass++) {
    next.set(cur);
    for (let v = 0; v < nAll; v++) {
      if (!inBody[v]) continue;
      const a = ADJ.off[v], b = ADJ.off[v + 1];
      if (b === a) continue;
      for (let c = 0; c < comps; c++) {
        let sum = 0;
        for (let i = a; i < b; i++) sum += cur[ADJ.idx[i] * comps + c];
        next[v * comps + c] = cur[v * comps + c] * 0.34 + (sum / (b - a)) * 0.66;
      }
    }
    cur.set(next);
  }
  return cur;
}

/* ======================================================================== *
   region weights
 * ======================================================================== */
console.log('computing region weights');
const angDiff = (a, b) => { let d = (a - b) % 360; if (d > 180) d -= 360; if (d < -180) d += 360; return d; };

const out = [];        /* {key, idx, w, u, dir} */
/* Which way the muscle fibres run at each vertex, accumulated from the bone
   frames as the regions are built. Striations are the fibres showing through
   the skin, so the shader needs to know which way they lie — otherwise the
   pattern crosses the muscle instead of running along it. */
const fibreDir = new Float32Array(nAll * 3);
const fibreW = new Float32Array(nAll);
const debugColor = new Float32Array(nAll * 3);
let hue = 0;

/* rough half-width of the torso at each height, for the xr gates */
const torsoFrame = FRAMES.torso;
const HALF = (() => {
  const bins = new Float32Array(32);
  for (let v = 0; v < nAll; v++) {
    if (!inBody[v]) continue;
    const pr = project(torsoFrame, [P[v * 3], P[v * 3 + 1], P[v * 3 + 2]]);
    if (pr.u < 0 || pr.u > 1) continue;
    const b = Math.min(31, Math.floor(pr.u * 32));
    bins[b] = Math.max(bins[b], Math.abs(P[v * 3]));
  }
  for (let i = 1; i < 32; i++) if (bins[i] === 0) bins[i] = bins[i - 1];
  return bins;
})();

for (const R of REGIONS) {
  const sides = CHAINS[R.chain].sided || R.side ? ['L', 'R'] : [null];
  for (const side of sides) {
    const frame = CHAINS[R.chain].sided ? FRAMES[R.chain + '.' + side] : FRAMES[R.chain];
    const aff = CHAINS[R.chain].sided ? affinity[R.chain + '.' + side] : affinity[R.chain];
    const key = side ? `${R.key}.${side}` : R.key;
    const rawW = new Float32Array(nAll);
    const rawU = new Float32Array(nAll);
    const rawD = new Float32Array(nAll * 3);

    for (let v = 0; v < nAll; v++) {
      if (!inBody[v]) continue;
      /* a chain only ever claims vertices the rig already gives it */
      const a = aff ? aff[v] : 1;
      const p = [P[v * 3], P[v * 3 + 1], P[v * 3 + 2]];
      const pr = project(frame, p);
      rawU[v] = pr.u;

      /* push direction: mostly straight out of the skin, leaned toward
         "away from the bone" so a belly grows off the bone, not off the air */
      const n = [NRM[v * 3], NRM[v * 3 + 1], NRM[v * 3 + 2]];
      const seg = frame.segs.reduce((s, c) => (pr.u >= c.u0 ? c : s), frame.segs[0]);
      const foot = add(seg.a, mul(seg.axis, clamp((pr.u * frame.total - seg.start) / seg.L, 0, 1) * seg.L));
      let radial = sub(p, foot);
      radial = len(radial) > 1e-5 ? norm(radial) : n;
      /* Limb muscles grow off their bone, so leaning the push toward
         "away from the bone" is right there. The torso has no single bone to
         grow off — a spine-radial push shoves the chest sideways and folds the
         skin under the pec — so there it follows the surface instead. */
      const radialMix = R.chain === 'torso' ? 0.12 : 0.38;
      let d = norm(add(mul(n, 1 - radialMix), mul(radial, radialMix)));
      if (R.push) {
        /* mirror the authored growth direction onto the right side */
        const px = side === 'R' ? -R.push[0] : R.push[0];
        const want = norm([px, R.push[1], R.push[2]]);
        const mix = R.pushMix ?? 0.5;
        d = norm(add(mul(d, 1 - mix), mul(want, mix)));
      }
      if (dot(d, n) < 0.05) d = norm(add(mul(d, 0.4), mul(n, 0.6)));
      if (dot(d, n) < 0) d = n;
      rawD[v * 3] = d[0]; rawD[v * 3 + 1] = d[1]; rawD[v * 3 + 2] = d[2];

      if (a < 0.05) continue;
      const uw = band(pr.u, R.u[0], R.u[1], 0.13);
      if (uw < 0.003) continue;

      /* mirror the authored angle for the right side of the body */
      const th = side === 'R' && !CHAINS[R.chain].sided ? -pr.th : pr.th;
      const dth = Math.abs(angDiff(th, R.th));
      const tw = 1 - smoothstep(R.thW * 0.55, R.thW * 1.30, dth);
      if (tw < 0.003) continue;

      let g = uw * tw * smoothstep(0.05, 0.26, a);
      if (!R.fill) g *= blendDamp[v];
      /* Torso muscles are paired, so each one takes one side. The handover
         at the midline is a ramp, not a cut — a hard cut leaves a seam down
         the sternum that no amount of smoothing afterwards will hide. */
      if (!CHAINS[R.chain].sided && R.side) {
        const x = p[0];
        g *= side === 'L' ? smoothstep(-0.06, 0.06, x) : smoothstep(0.06, -0.06, x);
      }
      if (R.xr) {
        const hw = HALF[Math.min(31, Math.max(0, Math.floor(pr.u * 32)))] || 1;
        const xr = Math.abs(p[0]) / hw;
        g *= band(xr, R.xr[0], R.xr[1], 0.16);
      }
      rawW[v] = g;
    }

    /* feather the membership so region borders never read as creases */
    const smoothW = feather(rawW, R.feather ?? 5);
    const smoothD = feather(rawD, 3, 3);

    const idx = [], w = [], u = [], dir = [];
    for (let v = 0; v < nAll; v++) {
      if (!inBody[v] || smoothW[v] < 0.006) continue;
      const l = Math.hypot(smoothD[v * 3], smoothD[v * 3 + 1], smoothD[v * 3 + 2]) || 1;
      idx.push(v); w.push(smoothW[v]); u.push(rawU[v]);
      dir.push(smoothD[v * 3] / l, smoothD[v * 3 + 1] / l, smoothD[v * 3 + 2] / l);
      if (!R.bone) {
        const seg = frame.segs.reduce((a, c) => (rawU[v] >= c.u0 ? c : a), frame.segs[0]);
        const fw = smoothW[v];
        /* directions are signless for this purpose, so keep them all on the
           same side before adding them up */
        const sgn = seg.axis[1] > 0 ? -1 : 1;
        fibreDir[v * 3] += seg.axis[0] * sgn * fw;
        fibreDir[v * 3 + 1] += seg.axis[1] * sgn * fw;
        fibreDir[v * 3 + 2] += seg.axis[2] * sgn * fw;
        fibreW[v] += fw;
      }
    }

    if (!idx.length) { console.warn('  EMPTY region ' + key); continue; }
    out.push({ key, base: R.key, side, chain: R.chain, ins: R.ins || null, bone: R.bone || 0,
               peak: R.peak, u0: R.u[0], u1: R.u[1],
               idx: Int32Array.from(idx), w: Float32Array.from(w),
               uu: Float32Array.from(u), dir: Float32Array.from(dir) });

    /* debug colour: one hue per muscle, brightness = membership */
    hue = (hue + 0.137) % 1;
    const c = hsv(hue, 0.85, 1);
    for (let i = 0; i < idx.length; i++) {
      const g = w[i];
      const o = idx[i] * 3;
      if (g > debugColor[o + 0] * 0 && g > (debugColor[o] + debugColor[o + 1] + debugColor[o + 2]) / 3) {
        debugColor[o] = c[0] * g; debugColor[o + 1] = c[1] * g; debugColor[o + 2] = c[2] * g;
      }
    }
  }
}
console.log(`  ${out.length} regions, ${out.reduce((s, r) => s + r.idx.length, 0)} vertex memberships`);

function hsv(h, s, v) {
  const i = Math.floor(h * 6), f = h * 6 - i;
  const p = v * (1 - s), q = v * (1 - f * s), t = v * (1 - (1 - f) * s);
  return [[v, t, p], [q, v, p], [p, v, t], [p, q, v], [t, p, v], [v, p, q]][i % 6];
}

/* ======================================================================== *
   which part of the body each vertex belongs to
   The tape measure needs this: a chest measurement taken through a horizontal
   slice would otherwise catch both arms and read thirty centimetres too big.
 * ======================================================================== */
export const PARTS = ['other', 'torso', 'armL', 'armR', 'legL', 'legR',
                      'head', 'handL', 'handR', 'footL', 'footR'];
const PART_RULES = [
  [/^(upperarm|lowerarm|shoulder01)\d*\.L$/, 2], [/^(upperarm|lowerarm|shoulder01)\d*\.R$/, 3],
  [/^(wrist|finger|metacarpal|carpal|thumb)/i, 0],
  [/\.L$/, 0], [/\.R$/, 0],
];
const partOf = (bone) => {
  if (/^(upperarm|lowerarm|shoulder01)\d*\.L$/.test(bone)) return 2;
  if (/^(upperarm|lowerarm|shoulder01)\d*\.R$/.test(bone)) return 3;
  if (/^(wrist|finger|metacarpal)\d*.*\.L$/.test(bone)) return 7;
  if (/^(wrist|finger|metacarpal)\d*.*\.R$/.test(bone)) return 8;
  if (/^(upperleg|lowerleg)\d*\.L$/.test(bone)) return 4;
  if (/^(upperleg|lowerleg)\d*\.R$/.test(bone)) return 5;
  if (/^(foot|toe)\d*.*\.L$/.test(bone)) return 9;
  if (/^(foot|toe)\d*.*\.R$/.test(bone)) return 10;
  if (/^(head|neck|jaw|eye|tongue|orbicularis|levator|risorius|special|temporalis|oris|oculi)/i.test(bone)) return 6;
  if (/^(spine|clavicle|breast|pelvis|root)/.test(bone)) return 1;
  return 0;
};
const partId = (() => {
  const score = Array.from({ length: nAll }, () => new Float32Array(11));
  for (const [bone, list] of Object.entries(weights)) {
    const pid = partOf(bone);
    for (const [v, w] of list) score[v][pid] += w;
  }
  const out = new Uint8Array(nAll);
  for (let v = 0; v < nAll; v++) {
    /* The base file also carries proxy meshes for clothing and hair. They are
       skinned like the body, so without this the tape measure would run round
       the outside of a pair of tights and report a 75 cm calf. */
    if (!inBody[v]) { out[v] = 0; continue; }
    let best = 0, bw = -1;
    for (let k = 1; k < 11; k++) if (score[v][k] > bw) { bw = score[v][k]; best = k; }
    out[v] = bw > 0 ? best : 0;
  }
  return out;
})();

/* ======================================================================== *
   posing trunks
   A physique plate is about the body, but a nude figure is a distraction and
   an accessibility problem. The trunk line is the standard competition cut:
   high on the hip, a shallow V at the front, straight across the back.
 * ======================================================================== */
const trunkMask = (() => {
  const m = new Float32Array(nAll);
  /* The waistband and hem are placed along the torso axis rather than by raw
     height, so they wrap the pelvis evenly front to back. u = 0 is the base of
     the spine and u = 1 the base of the neck; the navel lands near 0.22. */
  const legAff = new Float32Array(nAll);
  for (let v = 0; v < nAll; v++)
    legAff[v] = Math.max(affinity['thigh.L'][v], affinity['thigh.R'][v]);
  const legSmooth = feather(legAff, 2);

  for (let v = 0; v < nAll; v++) {
    if (!inBody[v]) continue;
    const p = [P[v * 3], P[v * 3 + 1], P[v * 3 + 2]];
    const pr = project(torsoFrame, p);
    if (pr.r > 3.2) continue;                    /* arms and hands are far off-axis */
    const front = smoothstep(-0.8, 0.9, p[2]);
    const waist = 0.22 - front * 0.04;
    const hem = -0.30 + front * 0.06;
    const band2 = smoothstep(waist + 0.03, waist - 0.03, pr.u)
                * smoothstep(hem - 0.05, hem + 0.05, pr.u);
    /* high-cut leg openings: the fabric stops where the leg begins */
    const leg = 1 - smoothstep(0.74, 0.96, legSmooth[v]);
    m[v] = clamp(band2 * leg * (1 - smoothstep(2.4, 3.2, pr.r)), 0, 1);
  }
  /* feathered so the hem line follows the body rather than the cage quads,
     then given its edge back in the shader */
  return feather(m, 4);
})();

/* ======================================================================== *
   hair, eyebrows and skin tone

   A bald, browless head with a uniform skin colour is the single thing that
   makes a figure read as a shop mannequin instead of a man. None of it needs
   extra geometry: a mask over the scalp and the brow ridge is enough for the
   shader to switch that patch from oiled skin to matte keratin, and a per
   vertex tone map gives the skin the variation real skin has — redder hands
   and face, cooler torso, darker knuckles and knees.

   Landmarks measured off the rest mesh, in decimetres:
     crown 9.30, eye centre 8.22 (z 1.30, x +-0.29), head joint 7.83
 * ======================================================================== */
const HEAD_C = [0, 8.62, 0.52];

const hairMask = (() => {
  const m = new Float32Array(nAll);
  for (let v = 0; v < nAll; v++) {
    if (!inBody[v] || partId[v] !== 6) continue;
    const p = [P[v * 3], P[v * 3 + 1], P[v * 3 + 2]];
    const d = norm(sub(p, HEAD_C));
    /* the hairline sits high at the front and drops down the back of the
       skull to the nape, with a shallow recession at the temples */
    const front = clamp(d[2], 0, 1);
    const side = Math.abs(d[0]);
    const temple = smoothstep(0.35, 0.80, side) * front * 0.16;
    const line = 0.06 + front * 0.62 + temple;
    let g = smoothstep(line - 0.06, line + 0.10, d[1]);
    /* never over the face or the ears */
    if (p[2] > 1.28 && p[1] < 9.0) g *= smoothstep(9.0, 9.22, p[1]);
    const ear = 1 - smoothstep(0.42, 0.62, side) * (1 - smoothstep(8.55, 8.85, p[1]));
    m[v] = clamp(g * ear, 0, 1);
  }
  return feather(m, 2);
})();

const browMask = (() => {
  const m = new Float32Array(nAll);
  for (let v = 0; v < nAll; v++) {
    if (!inBody[v] || partId[v] !== 6) continue;
    const x = Math.abs(P[v * 3]), y = P[v * 3 + 1], z = P[v * 3 + 2];
    if (z < 1.10) continue;
    /* the brow arches: higher at the outer end than at the inner, and it stops
       well before the temple */
    const arch = 8.435 + smoothstep(0.10, 0.40, x) * 0.055;
    const g = band(y, arch, arch + 0.075, 0.045) * band(x, 0.09, 0.42, 0.07);
    m[v] = clamp(g, 0, 1);
  }
  return feather(m, 1);
})();

const toneMap = (() => {
  /* r = how red, g = how dark, b = stubble */
  const t = new Float32Array(nAll * 3);
  const elbowL = jointCentre(P, skel.joints['lowerarm01.L____head']);
  const elbowR = jointCentre(P, skel.joints['lowerarm01.R____head']);
  const kneeL = jointCentre(P, skel.joints['lowerleg01.L____head']);
  const kneeR = jointCentre(P, skel.joints['lowerleg01.R____head']);
  const near = (p, j, r) => 1 - smoothstep(r * 0.5, r, Math.hypot(p[0] - j[0], p[1] - j[1], p[2] - j[2]));

  for (let v = 0; v < nAll; v++) {
    if (!inBody[v]) continue;
    const p = [P[v * 3], P[v * 3 + 1], P[v * 3 + 2]];
    const part = partId[v];
    /* blood sits closer to the surface at the ends of you */
    let red = part === 7 || part === 8 ? 0.85
            : part === 9 || part === 10 ? 0.55
            : part === 6 ? 0.60 : 0.12;
    red += 0.45 * Math.max(near(p, elbowL, 1.1), near(p, elbowR, 1.1));
    red += 0.35 * Math.max(near(p, kneeL, 1.3), near(p, kneeR, 1.3));
    /* the nose, ears and cheeks catch more than the forehead */
    if (part === 6) {
      red += 0.35 * smoothstep(1.25, 1.55, p[2]) * (1 - smoothstep(8.9, 9.1, p[1]));
      red += 0.30 * smoothstep(0.40, 0.60, Math.abs(p[0])) * band(p[1], 8.2, 8.7, 0.2);
    }
    t[v * 3] = clamp(red, 0, 1.4);
    /* hands and feet sit a shade darker than the trunk */
    t[v * 3 + 1] = clamp((part === 7 || part === 8 ? 0.30 : part === 9 || part === 10 ? 0.22 : 0)
                         + 0.30 * Math.max(near(p, elbowL, 0.9), near(p, elbowR, 0.9))
                         + 0.26 * Math.max(near(p, kneeL, 1.0), near(p, kneeR, 1.0)), 0, 1);
    /* shaved beard: jaw, chin and upper lip */
    if (part === 6) {
      const x = Math.abs(p[0]), y = p[1], z = p[2];
      const jaw = band(y, 7.62, 8.28, 0.14) * smoothstep(0.55, 0.95, z) * (1 - smoothstep(0.52, 0.72, x));
      const lip = band(y, 8.02, 8.16, 0.05) * smoothstep(1.20, 1.42, z) * (1 - smoothstep(0.16, 0.30, x));
      t[v * 3 + 2] = clamp(Math.max(jaw, lip * 0.8), 0, 1);
    }
  }
  const r = feather(t, 2, 3);
  return r;
})();

/* pec and lat fibres fan out toward the arm rather than following the spine,
   so those two override the frame-derived direction */
for (const R of out) {
  if (!/^(pec_|lat|serratus|trap_)/.test(R.base)) continue;
  const sgn = R.side === 'R' ? -1 : 1;
  const want = R.base.startsWith('pec_') ? [1.0 * sgn, 0.16, 0.10]
             : R.base === 'lat' ? [0.62 * sgn, 0.78, 0.0]
             : R.base === 'serratus' ? [0.55 * sgn, 0.55, 0.30]
             : [0.85 * sgn, 0.42, 0.0];
  const n = norm(want);
  for (let i = 0; i < R.idx.length; i++) {
    const v = R.idx[i], fw = R.w[i] * 1.6;
    fibreDir[v * 3] += n[0] * fw;
    fibreDir[v * 3 + 1] += n[1] * fw;
    fibreDir[v * 3 + 2] += n[2] * fw;
    fibreW[v] += fw;
  }
}
{
  /* The vector is stored with its length carrying how much muscle is at that
     vertex, so the shader gets the direction and the mask from one attribute.
     The face, neck and hands end up at zero length and never striate. */
  const sm = feather(fibreDir, 2, 3);
  const mw = feather(fibreW, 2);
  for (let v = 0; v < nAll; v++) {
    const l = Math.hypot(sm[v * 3], sm[v * 3 + 1], sm[v * 3 + 2]);
    const m = clamp((mw[v] - 0.10) * 1.5, 0, 1);
    if (l > 1e-5 && m > 0) {
      fibreDir[v * 3] = sm[v * 3] / l * m;
      fibreDir[v * 3 + 1] = sm[v * 3 + 1] / l * m;
      fibreDir[v * 3 + 2] = sm[v * 3 + 2] / l * m;
    } else { fibreDir[v * 3] = 0; fibreDir[v * 3 + 1] = 0; fibreDir[v * 3 + 2] = 0; }
  }
}

/* ======================================================================== *
   veins

   On a lean, muscular arm the superficial veins are the single most
   recognisable thing about it — more than any muscle shape. They run over the
   forearm, the biceps and the front delt, they thin out on the chest and abs,
   and they vanish under even a little body fat. This is only the map of where
   they are allowed to appear; the pattern itself is worked out per pixel.
 * ======================================================================== */
const veinMask = (() => {
  const m = new Float32Array(nAll);
  const w = (k, scale) => {
    const R = out.find(r => r.key === k);
    if (!R) return;
    for (let i = 0; i < R.idx.length; i++)
      m[R.idx[i]] = Math.max(m[R.idx[i]], R.w[i] * scale);
  };
  /* strongest on the forearm, where they always show first; nothing on the
     trunk, where a procedural pattern reads as camouflage rather than veins */
  const STRENGTH = {
    forearm_flex: 1.0, forearm_ext: 1.0,
    biceps_long: 0.62, biceps_short: 0.55, brachialis: 0.62, triceps_lat: 0.45,
    deltoid_ant: 0.42, deltoid_lat: 0.38,
    gastroc_med: 0.50, gastroc_lat: 0.45, tibialis: 0.40,
  };
  for (const side of ['L', 'R'])
    for (const [k, v] of Object.entries(STRENGTH)) w(`${k}.${side}`, v);
  for (let v = 0; v < nAll; v++) {
    if (!inBody[v]) continue;
    const hand = partId[v] === 7 || partId[v] === 8 ? 0.75 : 0;
    m[v] = clamp(Math.max(m[v], hand), 0, 1);
  }
  return feather(m, 3);
})();

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
const meta = out.map(r => ({
  key: r.key, base: r.base, side: r.side, chain: r.chain, ins: r.ins, bone: r.bone,
  peak: r.peak, u0: r.u0, u1: r.u1, count: r.idx.length,
  idx: blocks.push(put(r.key + '_i', r.idx)) - 1,
  w: blocks.push(put(r.key + '_w', r.w)) - 1,
  u: blocks.push(put(r.key + '_u', r.uu)) - 1,
  dir: blocks.push(put(r.key + '_d', r.dir)) - 1,
}));
blocks.push(put('debugColor', debugColor));
const debugIdx = blocks.length - 1;
blocks.push(put('restNormal', NRM));
const restNormalIdx = blocks.length - 1;
/* the runtime smooths its own displacement field over this graph, which is
   what keeps a region border from ever showing up as a crease in the skin */
blocks.push(put('adjOff', ADJ.off));
const adjOffIdx = blocks.length - 1;
blocks.push(put('adjIdx', ADJ.idx));
const adjIdxIdx = blocks.length - 1;
blocks.push(put('inBody', inBody));
const inBodyIdx = blocks.length - 1;
blocks.push(put('trunkMask', trunkMask));
const trunkIdx = blocks.length - 1;
blocks.push(put('partId', partId));
const partIdx = blocks.length - 1;
blocks.push(put('hairMask', hairMask));
const hairIdx = blocks.length - 1;
blocks.push(put('browMask', browMask));
const browIdx = blocks.length - 1;
blocks.push(put('toneMap', toneMap));
const toneIdx = blocks.length - 1;
blocks.push(put('veinMask', veinMask));
const veinIdx = blocks.length - 1;
blocks.push(put('fibreDir', fibreDir));
const fibreIdx = blocks.length - 1;

const header = { version: 7, nCage: nAll, regions: meta, insertions: INSERTIONS,
                 debugColor: debugIdx, restNormal: restNormalIdx,
                 adjOff: adjOffIdx, adjIdx: adjIdxIdx, inBody: inBodyIdx,
                 trunkMask: trunkIdx, partId: partIdx, parts: PARTS,
                 hairMask: hairIdx, browMask: browIdx, toneMap: toneIdx,
                 veinMask: veinIdx, fibreDir: fibreIdx, blocks };
const hb = Buffer.from(JSON.stringify(header), 'utf8');
const lead = Buffer.alloc(8);
lead.write('IPRG', 0, 'ascii');
lead.writeUInt32LE(hb.length, 4);
const pad = Buffer.alloc((4 - ((8 + hb.length) % 4)) % 4);
fs.mkdirSync(OUT, { recursive: true });
const buf = Buffer.concat([lead, hb, pad, ...chunks]);
fs.writeFileSync(path.join(OUT, 'regions.bin'), buf);
console.log(`  public/models/regions.bin  ${(buf.length / 1048576).toFixed(2)} MB`);
