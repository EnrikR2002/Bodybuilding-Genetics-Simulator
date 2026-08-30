/* ---------------------------------------------------------------------------
   Bake the CC0 MakeHuman assets into one binary the browser can load in a
   single fetch.

   What comes out:
     * the base mesh, already nudged to "male, 25" so the neutral figure is a man
     * Catmull-Clark subdivision topology, so the runtime can go from the
       13,378-quad control cage to 107,024 smooth triangles every time a slider
       moves, without re-deriving adjacency
     * the skeleton, stored as vertex groups rather than fixed bone positions —
       morphing the mesh moves the joints with it
     * four skin weights per render vertex
     * every morph target as a sparse index/offset pair
     * a Laplacian-smoothed copy of the cage, which is what body fat lerps toward

   Run: node tools/bake-mesh.mjs
   --------------------------------------------------------------------------- */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readObj, readTarget, readSkeleton, readWeights, MH_TO_CM } from './mh-parse.mjs';
import { ALL_TARGETS } from './assets-manifest.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'assets-src');
const OUT = path.join(ROOT, 'public', 'models');
const SUBDIV = 1;                 // Catmull-Clark levels
const MAX_BONES_PER_VERT = 4;

const t0 = Date.now();
const log = m => console.log(`[${String((Date.now() - t0) / 1000).padStart(5)}s] ${m}`);

/* ======================================================================== *
   1. mesh
 * ======================================================================== */
log('reading base mesh');
const obj = readObj(path.join(SRC, '3dobjs', 'base.obj'));
const nAll = obj.pos.length / 3;
const body = obj.groups.get('body');
const quads = Int32Array.from(body.quads);
/* the base mesh carries eyeball spheres as separate helper groups; without
   them the sockets render as empty slits, which is the one thing on a face
   people notice immediately */
const eyeQuads = Int32Array.from([
  ...(obj.groups.get('helper-l-eye')?.quads || []),
  ...(obj.groups.get('helper-r-eye')?.quads || []),
]);
const quadUV = Int32Array.from(body.quadUV);
const nQuads = quads.length / 4;
log(`  ${nAll} vertices, ${nQuads} body quads`);

/* ======================================================================== *
   2. targets
 * ======================================================================== */
log('reading morph targets');
const targets = {};
for (const rel of ALL_TARGETS) {
  const file = path.join(SRC, rel);
  if (!fs.existsSync(file)) { console.warn('  missing ' + rel); continue; }
  const name = rel.replace(/^targets\//, '').replace(/\.target$/, '');
  targets[name] = readTarget(file);
}
log(`  ${Object.keys(targets).length} targets`);

/* Bake the ethnicity/sex/age axis straight into the rest mesh. It is fixed for
   this app — always a 25-year-old man — so there is no reason to pay for it at
   runtime. Everything else stays live. */
const basePos = Float64Array.from(obj.pos);
{
  const t = targets['macrodetails/caucasian-male-young'];
  for (let i = 0; i < t.idx.length; i++) {
    const v = t.idx[i] * 3;
    basePos[v] += t.delta[i * 3];
    basePos[v + 1] += t.delta[i * 3 + 1];
    basePos[v + 2] += t.delta[i * 3 + 2];
  }
  delete targets['macrodetails/caucasian-male-young'];
}

/* ======================================================================== *
   3. subdivision topology
   Positions use real Catmull-Clark. UVs and skin weights use the plain
   averaging rules on their own connectivity: a texture seam must stay a seam,
   and weights have to keep summing to one.
 * ======================================================================== */
function buildLevel(quads, nVerts) {
  const nF = quads.length / 4;
  const edgeKey = new Map();
  const edgeV = [];                 // 2 verts per edge
  const edgeF = [];                 // up to 2 faces per edge, -1 when open
  const quadEdge = new Int32Array(nF * 4);

  for (let f = 0; f < nF; f++) {
    for (let k = 0; k < 4; k++) {
      const a = quads[f * 4 + k], b = quads[f * 4 + (k + 1) % 4];
      const key = a < b ? a * 1e7 + b : b * 1e7 + a;
      let e = edgeKey.get(key);
      if (e === undefined) {
        e = edgeV.length / 2;
        edgeKey.set(key, e);
        edgeV.push(a, b);
        edgeF.push(f, -1);
      } else if (edgeF[e * 2 + 1] === -1) {
        edgeF[e * 2 + 1] = f;
      }
      quadEdge[f * 4 + k] = e;
    }
  }
  const nE = edgeV.length / 2;

  /* CSR: for every vertex, the faces and edges that touch it */
  const vfCount = new Int32Array(nVerts), veCount = new Int32Array(nVerts);
  for (let i = 0; i < quads.length; i++) vfCount[quads[i]]++;
  for (let i = 0; i < edgeV.length; i++) veCount[edgeV[i]]++;
  const vfOff = new Int32Array(nVerts + 1), veOff = new Int32Array(nVerts + 1);
  for (let v = 0; v < nVerts; v++) {
    vfOff[v + 1] = vfOff[v] + vfCount[v];
    veOff[v + 1] = veOff[v] + veCount[v];
  }
  const vfIdx = new Int32Array(vfOff[nVerts]), veIdx = new Int32Array(veOff[nVerts]);
  const vfCur = vfOff.slice(0, nVerts), veCur = veOff.slice(0, nVerts);
  for (let f = 0; f < nF; f++)
    for (let k = 0; k < 4; k++) vfIdx[vfCur[quads[f * 4 + k]]++] = f;
  for (let e = 0; e < nE; e++) {
    veIdx[veCur[edgeV[e * 2]]++] = e;
    veIdx[veCur[edgeV[e * 2 + 1]]++] = e;
  }

  /* new vertex numbering: [original verts | edge points | face points] */
  const outQuads = new Int32Array(nF * 4 * 4);
  const eBase = nVerts, fBase = nVerts + nE;
  for (let f = 0; f < nF; f++) {
    const fp = fBase + f;
    for (let k = 0; k < 4; k++) {
      const v = quads[f * 4 + k];
      const ePrev = eBase + quadEdge[f * 4 + (k + 3) % 4];
      const eNext = eBase + quadEdge[f * 4 + k];
      const o = (f * 4 + k) * 4;
      outQuads[o] = v; outQuads[o + 1] = eNext; outQuads[o + 2] = fp; outQuads[o + 3] = ePrev;
    }
  }
  return {
    nVerts, nE, nF,
    edgeV: Int32Array.from(edgeV), edgeF: Int32Array.from(edgeF),
    quadEdge, vfOff, vfIdx, veOff, veIdx,
    outQuads, nOut: nVerts + nE + nF,
  };
}

log('building subdivision topology (positions)');
const posLevels = [];
{
  let q = quads, n = nAll;
  for (let l = 0; l < SUBDIV; l++) {
    const lv = buildLevel(q, n);
    posLevels.push(lv);
    q = lv.outQuads; n = lv.nOut;
  }
  log(`  cage ${nQuads} quads -> ${q.length / 4} quads / ${n} verts`);
}
const subQuads = SUBDIV ? posLevels[posLevels.length - 1].outQuads : quads;
const nSubVerts = SUBDIV ? posLevels[posLevels.length - 1].nOut : nAll;

log('building subdivision topology (uv)');
const nUV = obj.uv.length / 2;
const uvLevels = [];
{
  let q = quadUV, n = nUV;
  for (let l = 0; l < SUBDIV; l++) {
    const lv = buildLevel(q, n);
    uvLevels.push(lv);
    q = lv.outQuads; n = lv.nOut;
  }
}
const subQuadUV = SUBDIV ? uvLevels[uvLevels.length - 1].outQuads : quadUV;
const nSubUV = SUBDIV ? uvLevels[uvLevels.length - 1].nOut : nUV;

/* subdivided UVs, computed once — UVs never change at runtime */
function subdivideLinear(src, comps, levels, quadsOf) {
  let cur = src;
  for (let l = 0; l < levels.length; l++) {
    const lv = levels[l];
    const q = l === 0 ? quadsOf : levels[l - 1].outQuads;
    const out = new Float32Array(lv.nOut * comps);
    out.set(cur.subarray(0, lv.nVerts * comps));
    for (let e = 0; e < lv.nE; e++) {
      const a = lv.edgeV[e * 2] * comps, b = lv.edgeV[e * 2 + 1] * comps, o = (lv.nVerts + e) * comps;
      for (let c = 0; c < comps; c++) out[o + c] = (cur[a + c] + cur[b + c]) * 0.5;
    }
    for (let f = 0; f < lv.nF; f++) {
      const o = (lv.nVerts + lv.nE + f) * comps;
      for (let c = 0; c < comps; c++) {
        out[o + c] = (cur[q[f * 4] * comps + c] + cur[q[f * 4 + 1] * comps + c] +
                      cur[q[f * 4 + 2] * comps + c] + cur[q[f * 4 + 3] * comps + c]) * 0.25;
      }
    }
    cur = out;
  }
  return cur;
}
const subUV = SUBDIV ? subdivideLinear(obj.uv, 2, uvLevels, quadUV) : obj.uv;

/* ======================================================================== *
   4. render vertices
   One render vertex per distinct (position, uv) pair, so texture seams split
   but nothing else does. Normals are still averaged on the welded positions.
 * ======================================================================== */
log('welding render vertices');
const renderKey = new Map();
const renderSub = [];              // render vertex -> subdivided position index
const renderUV = [];
const tris = [];
const nSubQuads = subQuads.length / 4;
function rv(pi, ui) {
  const key = pi * 4194304 + ui;
  let r = renderKey.get(key);
  if (r === undefined) {
    r = renderSub.length;
    renderKey.set(key, r);
    renderSub.push(pi);
    renderUV.push(subUV[ui * 2], subUV[ui * 2 + 1]);
  }
  return r;
}
for (let f = 0; f < nSubQuads; f++) {
  const a = rv(subQuads[f * 4], subQuadUV[f * 4]);
  const b = rv(subQuads[f * 4 + 1], subQuadUV[f * 4 + 1]);
  const c = rv(subQuads[f * 4 + 2], subQuadUV[f * 4 + 2]);
  const d = rv(subQuads[f * 4 + 3], subQuadUV[f * 4 + 3]);
  tris.push(a, b, c, a, c, d);
}
const nRender = renderSub.length;
log(`  ${nRender} render vertices, ${tris.length / 3} triangles`);

/* ======================================================================== *
   5. skeleton
 * ======================================================================== */
log('reading skeleton');
const skel = readSkeleton(path.join(SRC, 'rigs', 'default.mhskel'));
const rawWeights = readWeights(path.join(SRC, 'rigs', 'default_weights.mhw'));

/* Only bones that actually carry skin weight are worth shipping; the facial
   and finger bones the app never poses are folded into their parents. */
const boneNames = Object.keys(skel.bones);
const KEEP = /^(root|spine0[1-5]|neck0[1-3]|head|clavicle\.[LR]|shoulder01\.[LR]|upperarm0[12]\.[LR]|lowerarm0[12]\.[LR]|wrist\.[LR]|upperleg0[12]\.[LR]|lowerleg0[12]\.[LR]|foot\.[LR]|toe1-1\.[LR]|breast\.[LR]|pelvis\.[LR]|metacarpal[1-4]\.[LR]|finger[1-5]-[1-3]\.[LR])$/;

/* map any bone to the nearest kept ancestor (or itself) */
const parentOf = {};
for (const b of boneNames) parentOf[b] = skel.bones[b].parent;
function keptAncestor(b) {
  let cur = b;
  while (cur && !KEEP.test(cur)) cur = parentOf[cur];
  return cur || 'root';
}
const bones = new Set(boneNames.filter(b => KEEP.test(b)));
/* parents first, so the runtime can walk the array once to build world matrices */
const order = [];
const seen = new Set();
function visit(b) {
  if (seen.has(b)) return;
  seen.add(b);
  const p = skel.bones[b].parent;
  if (p && bones.has(p)) visit(p);
  order.push(b);
}
for (const b of bones) visit(b);
const boneIndex = {}; order.forEach((b, i) => boneIndex[b] = i);
log(`  ${order.length} bones kept of ${boneNames.length}`);

/* head/tail joint vertex groups, so bones follow the morphs */
const jointVerts = {};
const boneDefs = order.map(b => {
  const d = skel.bones[b];
  const parent = d.parent ? keptAncestor(d.parent) : null;
  for (const k of [d.head, d.tail]) if (skel.joints[k]) jointVerts[k] = skel.joints[k];
  return {
    name: b,
    parent: parent && parent !== b && boneIndex[parent] !== undefined ? boneIndex[parent] : -1,
    head: d.head, tail: d.tail,
  };
});

/* ---- skin weights: fold, reduce to four, then subdivide ---- */
log('reducing skin weights');
const wList = Array.from({ length: nAll }, () => []);
for (const [bone, list] of Object.entries(rawWeights)) {
  const bi = boneIndex[keptAncestor(bone)];
  if (bi === undefined) continue;
  for (const [v, w] of list) {
    if (w <= 0) continue;
    const arr = wList[v];
    const hit = arr.find(p => p[0] === bi);
    if (hit) hit[1] += w; else arr.push([bi, w]);
  }
}
function topK(arr, k = MAX_BONES_PER_VERT) {
  arr.sort((a, b) => b[1] - a[1]);
  const out = arr.slice(0, k);
  let s = 0; for (const p of out) s += p[1];
  if (s <= 0) return [[boneIndex.root ?? 0, 1]];
  for (const p of out) p[1] /= s;
  return out;
}
/* cage weights as dense 4-wide arrays */
const cageSI = new Uint16Array(nAll * 4), cageSW = new Float32Array(nAll * 4);
for (let v = 0; v < nAll; v++) {
  const t = topK(wList[v]);
  for (let k = 0; k < t.length; k++) { cageSI[v * 4 + k] = t[k][0]; cageSW[v * 4 + k] = t[k][1]; }
}
/* subdivide by averaging the sparse sets, then re-reduce to four */
function subdivideWeights(si, sw, levels, quads0) {
  let curI = si, curW = sw, q = quads0;
  for (let l = 0; l < levels.length; l++) {
    const lv = levels[l];
    const outI = new Uint16Array(lv.nOut * 4), outW = new Float32Array(lv.nOut * 4);
    outI.set(curI.subarray(0, lv.nVerts * 4));
    outW.set(curW.subarray(0, lv.nVerts * 4));
    const acc = new Map();
    const mix = (dstBase, srcVerts, scale) => {
      acc.clear();
      for (const v of srcVerts)
        for (let k = 0; k < 4; k++) {
          const w = curW[v * 4 + k];
          if (w > 0) acc.set(curI[v * 4 + k], (acc.get(curI[v * 4 + k]) || 0) + w * scale);
        }
      const t = topK([...acc.entries()].map(([a, b]) => [a, b]));
      for (let k = 0; k < 4; k++) {
        outI[dstBase + k] = k < t.length ? t[k][0] : 0;
        outW[dstBase + k] = k < t.length ? t[k][1] : 0;
      }
    };
    for (let e = 0; e < lv.nE; e++)
      mix((lv.nVerts + e) * 4, [lv.edgeV[e * 2], lv.edgeV[e * 2 + 1]], 0.5);
    for (let f = 0; f < lv.nF; f++)
      mix((lv.nVerts + lv.nE + f) * 4, [q[f * 4], q[f * 4 + 1], q[f * 4 + 2], q[f * 4 + 3]], 0.25);
    curI = outI; curW = outW; q = lv.outQuads;
  }
  return { si: curI, sw: curW };
}
const subW = SUBDIV ? subdivideWeights(cageSI, cageSW, posLevels, quads) : { si: cageSI, sw: cageSW };

/* gather onto render vertices */
const rSkinIndex = new Uint16Array(nRender * 4), rSkinWeight = new Float32Array(nRender * 4);
for (let r = 0; r < nRender; r++) {
  const s = renderSub[r] * 4;
  for (let k = 0; k < 4; k++) {
    rSkinIndex[r * 4 + k] = subW.si[s + k];
    rSkinWeight[r * 4 + k] = subW.sw[s + k];
  }
}

/* ======================================================================== *
   6. Laplacian-smoothed cage — what body fat blends toward
   Fat does not just make you wider, it rubs out the edges between muscles.
   Blending toward a smoothed copy is what actually reproduces that.
 * ======================================================================== */
log('smoothing cage for the body-fat blend');
const smoothOffset = (() => {
  const lv = posLevels[0] || buildLevel(quads, nAll);
  const cur = Float64Array.from(basePos);
  const next = new Float64Array(basePos.length);
  const inBody = new Uint8Array(nAll);
  for (const v of quads) inBody[v] = 1;
  for (let pass = 0; pass < 14; pass++) {
    next.set(cur);
    for (let v = 0; v < nAll; v++) {
      if (!inBody[v]) continue;
      let x = 0, y = 0, z = 0, n = 0;
      for (let i = lv.veOff[v]; i < lv.veOff[v + 1]; i++) {
        const e = lv.veIdx[i];
        const o = (lv.edgeV[e * 2] === v ? lv.edgeV[e * 2 + 1] : lv.edgeV[e * 2]) * 3;
        x += cur[o]; y += cur[o + 1]; z += cur[o + 2]; n++;
      }
      if (!n) continue;
      const t = 0.55;
      next[v * 3] = cur[v * 3] * (1 - t) + (x / n) * t;
      next[v * 3 + 1] = cur[v * 3 + 1] * (1 - t) + (y / n) * t;
      next[v * 3 + 2] = cur[v * 3 + 2] * (1 - t) + (z / n) * t;
    }
    cur.set(next);
  }
  const off = new Float32Array(nAll * 3);
  for (let i = 0; i < nAll * 3; i++) off[i] = cur[i] - basePos[i];
  return off;
})();

/* ======================================================================== *
   7. write
 * ======================================================================== */
log('writing');
fs.mkdirSync(OUT, { recursive: true });

const chunks = [];
let offset = 0;
function put(name, arr) {
  const buf = Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength);
  /* four-byte align every block so typed-array views can point straight at it */
  const pad = (4 - (offset % 4)) % 4;
  if (pad) { chunks.push(Buffer.alloc(pad)); offset += pad; }
  chunks.push(buf);
  const rec = { name, type: arr.constructor.name, offset, length: arr.length };
  offset += buf.length;
  return rec;
}

const blocks = [];
blocks.push(put('basePos', Float32Array.from(basePos)));
blocks.push(put('smoothOffset', smoothOffset));
blocks.push(put('quads', quads));
blocks.push(put('renderSub', Int32Array.from(renderSub)));
blocks.push(put('renderUV', Float32Array.from(renderUV)));
blocks.push(put('index', (nRender > 65535 ? Uint32Array : Uint16Array).from(tris)));
blocks.push(put('skinIndex', rSkinIndex));
blocks.push(put('skinWeight', rSkinWeight));
blocks.push(put('subQuads', subQuads));
blocks.push(put('eyeQuads', eyeQuads));

/* subdivision levels */
const levelMeta = posLevels.map((lv, i) => ({
  nVerts: lv.nVerts, nE: lv.nE, nF: lv.nF, nOut: lv.nOut,
  edgeV: blocks.push(put(`L${i}_edgeV`, lv.edgeV)) - 1,
  edgeF: blocks.push(put(`L${i}_edgeF`, lv.edgeF)) - 1,
  quadEdge: blocks.push(put(`L${i}_quadEdge`, lv.quadEdge)) - 1,
  vfOff: blocks.push(put(`L${i}_vfOff`, lv.vfOff)) - 1,
  vfIdx: blocks.push(put(`L${i}_vfIdx`, lv.vfIdx)) - 1,
  veOff: blocks.push(put(`L${i}_veOff`, lv.veOff)) - 1,
  veIdx: blocks.push(put(`L${i}_veIdx`, lv.veIdx)) - 1,
  quads: blocks.push(put(`L${i}_quads`, i === 0 ? quads : posLevels[i - 1].outQuads)) - 1,
}));

/* morph targets */
const targetMeta = {};
for (const [name, t] of Object.entries(targets)) {
  targetMeta[name] = {
    idx: blocks.push(put(`T_${name}_i`, t.idx)) - 1,
    delta: blocks.push(put(`T_${name}_d`, t.delta)) - 1,
    count: t.idx.length,
  };
}

/* joint vertex groups */
const jointMeta = {};
for (const [name, verts] of Object.entries(jointVerts))
  jointMeta[name] = blocks.push(put(`J_${name}`, Int32Array.from(verts))) - 1;

const header = {
  version: 3,
  units: 'decimetres', scale: MH_TO_CM,
  subdiv: SUBDIV,
  nCage: nAll, nQuads, nSubVerts, nRender, nTris: tris.length / 3,
  nEyeQuads: eyeQuads.length / 4,
  blocks, levels: levelMeta, targets: targetMeta,
  bones: boneDefs, joints: jointMeta,
};

const headerBuf = Buffer.from(JSON.stringify(header), 'utf8');
const lead = Buffer.alloc(8);
lead.write('IPLB', 0, 'ascii');
lead.writeUInt32LE(headerBuf.length, 4);
const headerPad = Buffer.alloc((4 - ((8 + headerBuf.length) % 4)) % 4);
const out = Buffer.concat([lead, headerBuf, headerPad, ...chunks]);
fs.writeFileSync(path.join(OUT, 'body.bin'), out);
log(`  public/models/body.bin  ${(out.length / 1048576).toFixed(2)} MB`);
log('done');
