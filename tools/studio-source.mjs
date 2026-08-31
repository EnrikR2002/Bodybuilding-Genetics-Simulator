/* Build a runtime-compatible body source around Blender Studio's production
   human cage.

   The visible vertices and faces come from the Studio mesh.  MakeHuman's old
   cage is appended without faces as a hidden rig driver: its joint helper
   groups can continue to follow every existing proportion morph while the new
   surface receives interpolated morphs and skin weights.  This deliberately
   separates "what is rendered" from "what locates the joints" and lets the
   topology migration happen without throwing away the simulator's controls.
*/
import path from 'node:path';
import fs from 'node:fs';
import { readObj, readTarget, readWeights } from './mh-parse.mjs';

const CELL = 0.42;
const K = 4;

const key = (x, y, z) => `${x},${y},${z}`;
const cellOf = p => [Math.floor(p[0] / CELL), Math.floor(p[1] / CELL), Math.floor(p[2] / CELL)];

function coarsePart(p) {
  const [x, y] = p;
  if (y > 6.72) return 1;                 // head / neck
  if (y < -7.30) return 5;                // feet
  if (y < 1.28) return 4;                 // legs / pelvis
  if (Math.abs(x) > 1.72) return 3;        // arms / hands
  return 2;                               // torso
}

function buildSurfaceMap(visible, oldPos, oldBodyQuads) {
  const inOldBody = new Uint8Array(oldPos.length / 3);
  for (const v of oldBodyQuads) inOldBody[v] = 1;

  const grid = new Map();
  for (let v = 0; v < inOldBody.length; v++) {
    if (!inOldBody[v]) continue;
    const p = [oldPos[v * 3], oldPos[v * 3 + 1], oldPos[v * 3 + 2]];
    const c = cellOf(p), k = key(c[0], c[1], c[2]);
    let bucket = grid.get(k);
    if (!bucket) grid.set(k, bucket = []);
    bucket.push(v);
  }

  const idx = new Int32Array(visible.length / 3 * K);
  const weight = new Float32Array(visible.length / 3 * K);
  let sumNearest = 0, maxNearest = 0;

  for (let v = 0; v < visible.length / 3; v++) {
    const p = [visible[v * 3], visible[v * 3 + 1], visible[v * 3 + 2]];
    const c = cellOf(p), candidates = [];
    for (let r = 0; r <= 7 && candidates.length < 18; r++) {
      for (let x = -r; x <= r; x++) for (let y = -r; y <= r; y++) for (let z = -r; z <= r; z++) {
        if (r && Math.max(Math.abs(x), Math.abs(y), Math.abs(z)) !== r) continue;
        const bucket = grid.get(key(c[0] + x, c[1] + y, c[2] + z));
        if (bucket) candidates.push(...bucket);
      }
    }
    if (!candidates.length) throw new Error(`no old-surface candidate for Studio vertex ${v}`);

    const part = coarsePart(p);
    const nearest = candidates.map(i => {
      const q = [oldPos[i * 3], oldPos[i * 3 + 1], oldPos[i * 3 + 2]];
      const dx = p[0] - q[0], dy = p[1] - q[1], dz = p[2] - q[2];
      let d2 = dx * dx + dy * dy + dz * dz;
      if (coarsePart(q) !== part) d2 += 0.16;
      if (Math.abs(p[0]) > 0.35 && p[0] * q[0] < 0) d2 += 1.0;
      return [i, d2];
    }).sort((a, b) => a[1] - b[1]).slice(0, K);

    const nearestD = Math.sqrt(nearest[0][1]);
    sumNearest += nearestD;
    maxNearest = Math.max(maxNearest, nearestD);
    let total = 0;
    for (let j = 0; j < K; j++) {
      const pair = nearest[Math.min(j, nearest.length - 1)];
      idx[v * K + j] = pair[0];
      const w = 1 / (pair[1] + 0.0025);
      weight[v * K + j] = w;
      total += w;
    }
    for (let j = 0; j < K; j++) weight[v * K + j] /= total;
  }

  return {
    idx, weight,
    meanNearest: sumNearest / (visible.length / 3),
    maxNearest,
  };
}

function applyTarget(pos, target) {
  for (let i = 0; i < target.idx.length; i++) {
    const o = target.idx[i] * 3, d = i * 3;
    pos[o] += target.delta[d];
    pos[o + 1] += target.delta[d + 1];
    pos[o + 2] += target.delta[d + 2];
  }
}

export function loadStudioSource(srcRoot) {
  const oldObj = readObj(path.join(srcRoot, '3dobjs', 'base.obj'));
  const studioObj = readObj(path.join(srcRoot, 'studio-base', 'studio-body.obj'));
  const oldBody = oldObj.groups.get('body');
  const studioBody = studioObj.groups.get('body');
  if (!studioBody) throw new Error('studio-body.obj has no body group');

  const oldNeutral = Float64Array.from(oldObj.pos);
  applyTarget(oldNeutral, readTarget(path.join(
    srcRoot, 'targets/macrodetails/caucasian-male-young.target')));
  const visiblePos = Float64Array.from(studioObj.pos);
  /* studio-body.obj is fitted to the exported authoring cage (DEFAULT slider
     values), not to MakeHuman's bare male rest mesh.  Correspondence must use
     that same shape or a forearm can be several centimeters closer to a hip
     than to its own unconditioned source ring.  Vertex order is preserved by
     the authoring exporter, so these surface positions still index the stock
     weights and morph targets correctly. */
  const correspondencePos = Float64Array.from(oldNeutral);
  const authoringObj = readObj(path.join(srcRoot, 'authoring', 'neutral-cage.obj'));
  correspondencePos.set(authoringObj.pos, 0);
  const map = buildSurfaceMap(visiblePos, correspondencePos, oldBody.quads);
  const visibleCount = visiblePos.length / 3;
  const oldCount = oldNeutral.length / 3;
  const basePos = new Float64Array((visibleCount + oldCount) * 3);
  basePos.set(visiblePos);
  basePos.set(oldNeutral, visiblePos.length);

  const oldEyeQuads = [
    ...(oldObj.groups.get('helper-l-eye')?.quads || []),
    ...(oldObj.groups.get('helper-r-eye')?.quads || []),
  ];
  const eyeQuads = Int32Array.from(oldEyeQuads, v => v + visibleCount);

  const rawWeights = readWeights(path.join(srcRoot, 'rigs', 'default_weights.mhw'));
  const weights = {};
  const push = (bone, v, w) => {
    if (w <= 1e-7) return;
    (weights[bone] ||= []).push([v, w]);
  };

  const studioWeightsPath = path.join(srcRoot, 'studio-base', 'studio-weights.json');
  /* Blender's automatic heat weights were generated against a reduced copy
     of the MakeHuman rig.  They look plausible in the bind pose, but collapse
     the groin/axilla and leave extremities behind in contest poses.  Keep the
     authored file as a diagnostic artefact; the production build uses the
     surface correspondence, which inherits the deformation behaviour already
     proven by the original cage.  Set STUDIO_AUTO_WEIGHTS=1 only when revising
     the Blender weighting pass. */
  const useStudioWeights = process.env.STUDIO_AUTO_WEIGHTS === '1';
  if (useStudioWeights && fs.existsSync(studioWeightsPath)) {
    const authored = JSON.parse(fs.readFileSync(studioWeightsPath, 'utf8'));
    if (authored.vertices !== visibleCount)
      throw new Error(`Studio weight vertex count ${authored.vertices} != ${visibleCount}`);
    for (const [bone, list] of Object.entries(authored.bones))
      for (const [v, w] of list) push(bone, v, w);
  } else {
    const perOld = Array.from({ length: oldCount }, () => []);
    for (const [bone, list] of Object.entries(rawWeights))
      for (const [v, w] of list) if (w > 0) perOld[v].push([bone, w]);
    for (let v = 0; v < visibleCount; v++) {
      const acc = new Map();
      for (let j = 0; j < K; j++) {
        const ov = map.idx[v * K + j], mw = map.weight[v * K + j];
        for (const [bone, w] of perOld[ov]) acc.set(bone, (acc.get(bone) || 0) + w * mw);
      }
      for (const [bone, w] of acc) push(bone, v, w);
    }
  }
  for (const [bone, list] of Object.entries(rawWeights))
    for (const [v, w] of list) push(bone, visibleCount + v, w);

  const visibleTargetScale = name => {
    if (name.startsWith('correctives/')) return 1.0;
    /* Universal MakeHuman targets describe a complete demographic body, not
       a small delta intended for a second male base.  Layering them at full
       strength over the Studio man is what produced the inflated sleeves in
       the first transfer.  The hidden driver still receives the full target. */
    if (name.startsWith('macrodetails/universal-')) return 0.0;
    if (name.includes('-muscle-') || name.endsWith('-muscle-incr') || name.endsWith('-muscle-decr')) return 0.0;
    if (name.startsWith('measure/measure-') && name.includes('-circ-')) return 0.20;
    if (name.includes('-fat-') || name.includes('stomach-pregnant')) return 0.42;
    if (name.startsWith('macrodetails/proportions/')) return 0.28;
    if (name.startsWith('macrodetails/height/')) return 0.58;
    return 0.48;
  };

  const transferTarget = (target, name = '') => {
    const visibleScale = visibleTargetScale(name);
    const dense = new Float32Array(oldCount * 3);
    for (let i = 0; i < target.idx.length; i++) {
      const o = target.idx[i] * 3, d = i * 3;
      dense[o] = target.delta[d]; dense[o + 1] = target.delta[d + 1]; dense[o + 2] = target.delta[d + 2];
    }
    const ti = [], td = [];
    for (let v = 0; v < visibleCount; v++) {
      let x = 0, y = 0, z = 0;
      for (let j = 0; j < K; j++) {
        const ov = map.idx[v * K + j] * 3, w = map.weight[v * K + j];
        x += dense[ov] * w; y += dense[ov + 1] * w; z += dense[ov + 2] * w;
      }
      x *= visibleScale; y *= visibleScale; z *= visibleScale;
      if (x * x + y * y + z * z > 1e-12) { ti.push(v); td.push(x, y, z); }
    }
    for (let i = 0; i < target.idx.length; i++) {
      ti.push(visibleCount + target.idx[i]);
      td.push(target.delta[i * 3], target.delta[i * 3 + 1], target.delta[i * 3 + 2]);
    }
    return { idx: Int32Array.from(ti), delta: Float32Array.from(td) };
  };

  const remapJointVerts = verts => Int32Array.from(verts, v => visibleCount + v);

  return {
    kind: 'studio',
    obj: studioObj,
    basePos,
    quads: Int32Array.from(studioBody.quads),
    quadUV: Int32Array.from(studioBody.quadUV),
    eyeQuads,
    weights,
    transferTarget,
    remapJointVerts,
    visibleCount,
    oldCount,
    mapStats: { meanNearest: map.meanNearest, maxNearest: map.maxNearest },
  };
}
