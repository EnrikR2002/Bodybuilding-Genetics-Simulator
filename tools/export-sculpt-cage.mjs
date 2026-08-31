/* ---------------------------------------------------------------------------
   Export the exact neutral control cage an anatomy artist should sculpt.

   The output contains the 13,380 contiguous body vertices in their runtime
   order and the original quad topology.  Import/export with vertex order
   preserved, do not add or remove vertices, and do not apply subdivision.

   Run: node tools/export-sculpt-cage.mjs [output.obj]
   --------------------------------------------------------------------------- */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readObj, readTarget } from './mh-parse.mjs';
import { ALL_TARGETS } from './assets-manifest.mjs';
import { applyParams } from '../src/body/params.js';
import { DEFAULT } from '../src/data/sliders.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'assets-src');
const output = path.resolve(process.argv[2] || path.join(SRC, 'authoring', 'neutral-cage.obj'));
const obj = readObj(path.join(SRC, '3dobjs', 'base.obj'));
const body = obj.groups.get('body');
if (!body) throw new Error('MakeHuman body group is missing');

const bodyVerts = new Set(body.quads);
const nBody = bodyVerts.size;
if (Math.min(...bodyVerts) !== 0 || Math.max(...bodyVerts) !== nBody - 1)
  throw new Error('The sculpt exporter requires contiguous body vertex indices');

const targets = {};
for (const rel of ALL_TARGETS) {
  const file = path.join(SRC, rel);
  if (!fs.existsSync(file)) continue;
  const name = rel.replace(/^targets[\\/]/, '').replace(/\.target$/, '').replaceAll('\\', '/');
  targets[name] = readTarget(file);
}

/* Match bake-mesh.mjs: sex/age/ethnicity is baked into the rest cage. */
const pos = Float64Array.from(obj.pos);
const identity = targets['macrodetails/caucasian-male-young'];
if (!identity) throw new Error('Missing caucasian-male-young base target');
for (let i = 0; i < identity.idx.length; i++) {
  const v = identity.idx[i] * 3;
  pos[v] += identity.delta[i * 3];
  pos[v + 1] += identity.delta[i * 3 + 1];
  pos[v + 2] += identity.delta[i * 3 + 2];
}

const weights = new Map();
const morph = {
  has: name => !!targets[name],
  add(name, weight) { weights.set(name, (weights.get(name) || 0) + weight); },
};
applyParams(morph, { ...DEFAULT, latFlare: 0, chestUp: 0, vacuum: 0, flex: 0.35 });
for (const [name, weight] of weights) {
  const target = targets[name];
  if (!target) throw new Error(`Neutral cage requested missing target: ${name}`);
  for (let i = 0; i < target.idx.length; i++) {
    const v = target.idx[i] * 3;
    pos[v] += target.delta[i * 3] * weight;
    pos[v + 1] += target.delta[i * 3 + 1] * weight;
    pos[v + 2] += target.delta[i * 3 + 2] * weight;
  }
}

const lines = [
  '# Insertion authoring-neutral cage',
  '# Units: MakeHuman decimetres; Y up, Z forward',
  '# Preserve vertex order and topology. Do not subdivide this export.',
  'o insertion_authoring_cage',
];
for (let v = 0; v < nBody; v++) {
  const o = v * 3;
  lines.push(`v ${pos[o].toFixed(8)} ${pos[o + 1].toFixed(8)} ${pos[o + 2].toFixed(8)}`);
}
lines.push('g body');
for (let i = 0; i < body.quads.length; i += 4)
  lines.push(`f ${body.quads[i] + 1} ${body.quads[i + 1] + 1} ${body.quads[i + 2] + 1} ${body.quads[i + 3] + 1}`);

fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, lines.join('\n') + '\n');
console.log(`wrote ${path.relative(ROOT, output)} (${nBody} vertices, ${body.quads.length / 4} quads)`);

