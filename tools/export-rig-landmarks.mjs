/* Export the neutral MakeHuman joint centres used by the runtime. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readObj, readTarget, readSkeleton, jointCentre } from './mh-parse.mjs';
import { ALL_TARGETS } from './assets-manifest.mjs';
import { applyParams } from '../src/body/params.js';
import { DEFAULT } from '../src/data/sliders.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'assets-src');
const obj = readObj(path.join(SRC, '3dobjs', 'base.obj'));
const pos = Float64Array.from(obj.pos);
const targets = {};
for (const rel of ALL_TARGETS) {
  const file = path.join(SRC, rel);
  if (!fs.existsSync(file)) continue;
  targets[rel.replace(/^targets\//, '').replace(/\.target$/, '')] = readTarget(file);
}

function add(target, weight) {
  if (!target || !weight) return;
  for (let i = 0; i < target.idx.length; i++) {
    const v = target.idx[i] * 3;
    pos[v] += target.delta[i * 3] * weight;
    pos[v + 1] += target.delta[i * 3 + 1] * weight;
    pos[v + 2] += target.delta[i * 3 + 2] * weight;
  }
}
add(targets['macrodetails/caucasian-male-young'], 1);
const weights = new Map();
applyParams({
  has: () => false,
  add(name, weight) { weights.set(name, (weights.get(name) || 0) + weight); },
}, { ...DEFAULT, latFlare: 0, chestUp: 0, vacuum: 0, flex: 0.35 });
for (const [name, weight] of weights) add(targets[name], weight);

const skel = readSkeleton(path.join(SRC, 'rigs', 'default.mhskel'));
const joints = {};
for (const [name, verts] of Object.entries(skel.joints)) joints[name] = jointCentre(pos, verts);
const bones = {};
for (const [name, bone] of Object.entries(skel.bones)) {
  bones[name] = {
    head: joints[bone.head],
    tail: joints[bone.tail],
    parent: bone.parent,
  };
}

const out = path.join(SRC, 'studio-base', 'makehuman-neutral-rig.json');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify({ joints, bones }, null, 2));
console.log(`wrote ${path.relative(ROOT, out)} (${Object.keys(joints).length} joints)`);

