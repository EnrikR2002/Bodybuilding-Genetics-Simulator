/* ---------------------------------------------------------------------------
   Ask the anatomy atlas what is under every square centimetre of skin.

   The production body is a smooth MakeHuman surface. Everything that made it
   look like a shop mannequin comes from the same cause: its muscle map was a
   set of arcs and bands typed out by hand around each bone. Arcs cannot know
   that the lateral head of the triceps ends in a flat tendon plane, that the
   vastus medialis drops below its neighbours, or where the serratus fingers
   interleave with the obliques. Real muscles know, because a real dissection
   was scanned to make them.

   So this script does not describe muscles. It writes down, for every skin
   vertex, the exact question to ask the atlas: a ray fired inward at the skin
   from outside the body, in the frame of the bone that vertex belongs to.
   Blender answers the questions; `bake-anatomy.mjs` turns the answers into a
   muscle map.

   Bone space is what makes this legal. The two bodies stand differently — the
   atlas arm hangs almost straight down and the MakeHuman arm is out at forty
   degrees — but "sixty percent of the way down the upper arm, forty degrees
   round from the front" means the same thing in both.

   Run: node tools/export-anatomy-rays.mjs
   --------------------------------------------------------------------------- */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readObj, readTarget, readSkeleton, readWeights } from './mh-parse.mjs';
import { Subdivider } from '../src/body/subdiv.js';
import { readBundle } from './read-bundle.mjs';
import { CHAINS } from './region-table.mjs';
import {
  buildFrames, rigJoints, project, axisPoint, D2R,
  add, mul, norm,
} from './mh-frames.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'assets-src');
const REF = path.join(SRC, 'anatomy-reference');
const BUILD = path.join(REF, 'build');
const OUT = path.join(BUILD, 'anatomy-rays.bin');

/* The atlas-to-cage transform proven by the earlier posterior projection:
   a uniform scale and two offsets, no rotation. MakeHuman works in
   decimetres with Y up and Z forward; the atlas works in metres with Z up
   and Y pointing backwards. */
const SCALE = 10.57;
const OFFSET_Y = -8.045;
const OFFSET_Z = 0.15;
const toAtlas = p => [p[0] / SCALE, -(p[2] - OFFSET_Z) / SCALE, (p[1] - OFFSET_Y) / SCALE];

/* Which joint pair each chain runs between, on the atlas side. */
const ATLAS_CHAINS = {
  upperarm: ['shoulder', 'elbow'],
  forearm: ['elbow', 'wrist'],
  thigh: ['hip', 'knee'],
  shank: ['knee', 'ankle'],
};

/* A ray has to start outside every muscle it might cross. Half a metre clears
   the widest part of the atlas — the shoulders — with room to spare. */
const STANDOFF = 0.60;
/* Below this the rig does not really consider the vertex part of the chain,
   and its bone frame stops meaning anything. */
const MIN_AFFINITY = 0.05;

/* ======================================================================== */
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
const weights = readWeights(path.join(SRC, 'rigs', 'default_weights.mhw'));

const inBody = new Uint8Array(nAll);
for (const v of quads) inBody[v] = 1;

/* ---- how much of each vertex belongs to each bone chain ----
   Same rule the region bake uses: a chain only ever claims vertices the rig
   already gives it, which is what stops an arm muscle leaking onto the ribs. */
console.log('deriving chain affinity from skin weights');
const affinity = {};
const totalW = new Float32Array(nAll);
for (const list of Object.values(weights)) for (const [v, w] of list) totalW[v] += w;
for (const [bone, list] of Object.entries(weights)) {
  for (const [name, def] of Object.entries(CHAINS)) {
    if (!def.bones.test(bone)) continue;
    if (def.sided) {
      const isL = /\.L$/.test(bone), isR = /\.R$/.test(bone);
      if (!isL && !isR) continue;
      const key = name + (isL ? '.L' : '.R');
      affinity[key] ||= new Float32Array(nAll);
      for (const [v, w] of list) affinity[key][v] += w;
    } else {
      affinity[name] ||= new Float32Array(nAll);
      for (const [v, w] of list) affinity[name][v] += w;
    }
  }
}
for (const a of Object.values(affinity)) {
  for (let v = 0; v < nAll; v++) if (totalW[v] > 0) a[v] /= totalW[v];
}

/* ======================================================================== *
   the two frame sets
 * ======================================================================== */
console.log('building bone frames for both bodies');
const cageFrames = buildFrames(rigJoints(P, skel), CHAINS);

const atlasJoints = JSON.parse(fs.readFileSync(path.join(REF, 'atlas-joints.json'), 'utf8')).joints;
/* The torso is the one chain the atlas skeleton cannot supply directly: its
   spine is a stack of twenty-four separate objects. It does not need to. The
   scale-and-offset transform above already lines the two trunks up, so the
   production spine points can simply be carried across. */
const atlasChainDef = {};
for (const [name, def] of Object.entries(CHAINS)) {
  atlasChainDef[name] = { ...def, joints: def.joints.map((_, i) => `${name}:${i}`) };
}
const atlasJointFor = (label, side) => {
  const [chain, i] = label.split(':');
  const pair = ATLAS_CHAINS[chain];
  if (!pair) {
    /* torso: carry the production spine polyline into atlas space */
    return toAtlas(rigJoints(P, skel)(CHAINS[chain].joints[+i], side));
  }
  const j = atlasJoints[`${pair[+i]}.${side}`];
  if (!j) throw new Error('unknown atlas joint ' + pair[+i]);
  return j;
};
const atlasFrames = buildFrames(atlasJointFor, atlasChainDef,
  { front: [0, -1, 0], left: [1, 0, 0] });

for (const key of Object.keys(cageFrames)) {
  const a = atlasFrames[key], c = cageFrames[key];
  console.log(`  ${key.padEnd(12)} cage ${(c.total / 10).toFixed(3)} m   atlas ${a.total.toFixed(3)} m`);
}

/* ======================================================================== *
   one ray per vertex per chain
 * ======================================================================== */
/* Chain names travel as numbers so the binary stays flat. */
const CHAIN_ID = {};
{
  let n = 0;
  for (const [name, def] of Object.entries(CHAINS)) {
    if (def.sided) { CHAIN_ID[name + '.L'] = n++; CHAIN_ID[name + '.R'] = n++; }
    else CHAIN_ID[name] = n++;
  }
}

/* ---- ask the questions at render resolution, not cage resolution ----

   The control cage spends most of its thirteen thousand vertices on a face and
   two hands. The whole trunk gets about two thousand, which is one reading
   every centimetre and a half — too coarse to hold a tendinous inscription, a
   serratus finger, or the line between two heads of the triceps. Those are the
   details that decide whether a torso reads as a body or as a bag.

   The renderer already subdivides the cage to sixty thousand vertices before
   it draws anything. Asking the dissection at that level instead costs four
   times as many rays, which is twenty seconds, and it is where the answers can
   actually be used. */
console.log('subdividing the rest cage to render resolution');
const body = readBundle(path.join(ROOT, 'public', 'models', 'body.bin'));
const L0 = {
  nVerts: body.header.levels[0].nVerts, nE: body.header.levels[0].nE,
  nF: body.header.levels[0].nF, nOut: body.header.levels[0].nOut,
  edgeV: body.byName('L0_edgeV'), edgeF: body.byName('L0_edgeF'),
  vfOff: body.byName('L0_vfOff'), vfIdx: body.byName('L0_vfIdx'),
  veOff: body.byName('L0_veOff'), veIdx: body.byName('L0_veIdx'),
  quads: body.byName('L0_quads'),
};
const nSub = L0.nOut;
const subPos = new Subdivider([L0]).run(Float32Array.from(P));

/* Carry a per-cage value up the same way the renderer does, so index for
   index the two agree. */
function lift(src) {
  const out = new Float32Array(nSub);
  out.set(src.subarray(0, L0.nVerts));
  for (let e = 0; e < L0.nE; e++)
    out[L0.nVerts + e] = (src[L0.edgeV[e * 2]] + src[L0.edgeV[e * 2 + 1]]) * 0.5;
  const q = L0.quads;
  for (let f = 0; f < L0.nF; f++)
    out[L0.nVerts + L0.nE + f] =
      (src[q[f * 4]] + src[q[f * 4 + 1]] + src[q[f * 4 + 2]] + src[q[f * 4 + 3]]) * 0.25;
  return out;
}
const subInBody = lift(Float32Array.from(inBody));
const subAff = Object.fromEntries(Object.entries(affinity).map(([k, a]) => [k, lift(a)]));

console.log('writing query rays');
const rows = [];
for (let v = 0; v < nSub; v++) {
  if (subInBody[v] < 0.5) continue;
  const p = [subPos[v * 3], subPos[v * 3 + 1], subPos[v * 3 + 2]];
  for (const [key, aff] of Object.entries(subAff)) {
    if (aff[v] < MIN_AFFINITY) continue;
    const chain = key.split('.')[0];
    const side = CHAINS[chain].sided ? key.split('.')[1] : (p[0] >= 0 ? 'L' : 'R');
    const cf = cageFrames[key], af = atlasFrames[key];
    const pr = project(cf, p);
    /* A muscle map only has to describe the length of the bone it lies on.
       Reaching far past either joint lands the ray inside the next limb. */
    if (pr.u < -0.30 || pr.u > 1.30) continue;

    /* The torso frame is not sided, so its angle has to be read on the side
       the vertex is actually on before it is carried across. */
    const th = (CHAINS[chain].sided ? pr.th : (side === 'R' ? -pr.th : pr.th)) * D2R;
    const { seg, foot } = axisPoint(af, pr.u);
    const dir = norm(add(mul(seg.ref, Math.cos(th)), mul(seg.bin, Math.sin(th))));
    const start = add(foot, mul(dir, STANDOFF));
    rows.push([v, CHAIN_ID[key], side === 'L' ? 0 : 1, aff[v], pr.u, pr.th,
               start[0], start[1], start[2], -dir[0], -dir[1], -dir[2]]);
  }
}

fs.mkdirSync(BUILD, { recursive: true });
const STRIDE = 12;
const data = new Float32Array(rows.length * STRIDE);
for (let i = 0; i < rows.length; i++) data.set(rows[i], i * STRIDE);
fs.writeFileSync(OUT, Buffer.from(data.buffer));
fs.writeFileSync(path.join(BUILD, 'anatomy-rays.json'), JSON.stringify({
  count: rows.length, stride: STRIDE, standoff: STANDOFF, nSub,
  fields: ['vertex', 'chain', 'side', 'affinity', 'u', 'theta',
           'sx', 'sy', 'sz', 'dx', 'dy', 'dz'],
  chains: CHAIN_ID,
  transform: { scale: SCALE, offsetY: OFFSET_Y, offsetZ: OFFSET_Z },
}, null, 1));
console.log(`  ${rows.length} rays -> ${path.relative(ROOT, OUT)}`);
