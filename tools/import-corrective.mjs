/* ---------------------------------------------------------------------------
   Convert a vertex-matched endpoint OBJ into the sparse target format used by
   the runtime.

   Run:
     node tools/import-corrective.mjs latInsertion 0 path/to/high-lat.obj
     node tools/import-corrective.mjs latInsertion 1 path/to/low-lat.obj
   --------------------------------------------------------------------------- */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TRAIT_CORRECTIVES, correctiveName } from './corrective-contract.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [slider, endpointRaw, sculptRaw] = process.argv.slice(2);
const endpoint = Number(endpointRaw);
if (!TRAIT_CORRECTIVES[slider] || ![0, 1].includes(endpoint) || !sculptRaw) {
  console.error('Usage: node tools/import-corrective.mjs <slider> <0|1> <sculpt.obj>');
  console.error('Sliders: ' + Object.keys(TRAIT_CORRECTIVES).join(', '));
  process.exit(1);
}

const neutralFile = path.join(ROOT, 'assets-src', 'authoring', 'neutral-cage.obj');
if (!fs.existsSync(neutralFile))
  throw new Error('Missing assets-src/authoring/neutral-cage.obj; run npm run sculpt:export first');

function positions(file) {
  const out = [];
  for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    if (!raw.startsWith('v ')) continue;
    const p = raw.trim().split(/\s+/);
    out.push(Number(p[1]), Number(p[2]), Number(p[3]));
  }
  if (out.some(v => !Number.isFinite(v))) throw new Error(`Invalid vertex data in ${file}`);
  return out;
}

const neutral = positions(neutralFile);
const sculptFile = path.resolve(sculptRaw);
const sculpt = positions(sculptFile);
if (sculpt.length !== neutral.length) {
  throw new Error(`Topology mismatch: neutral has ${neutral.length / 3} vertices; sculpt has ${sculpt.length / 3}`);
}

const EPS = 1e-6;       // decimetres: retain movements above 0.0001 mm
const MAX = 0.8;        // 8 cm: catches scale/axis/export mistakes
const lines = [
  `# ${slider} endpoint ${endpoint}: ${TRAIT_CORRECTIVES[slider][endpoint]}`,
  `# source ${path.basename(sculptFile)}`,
];
let moved = 0, maxDelta = 0;
for (let v = 0; v < neutral.length / 3; v++) {
  const o = v * 3;
  const dx = sculpt[o] - neutral[o];
  const dy = sculpt[o + 1] - neutral[o + 1];
  const dz = sculpt[o + 2] - neutral[o + 2];
  const d = Math.hypot(dx, dy, dz);
  maxDelta = Math.max(maxDelta, d);
  if (d <= EPS) continue;
  lines.push(`${v} ${dx.toFixed(8)} ${dy.toFixed(8)} ${dz.toFixed(8)}`);
  moved++;
}
if (maxDelta > MAX)
  throw new Error(`Largest delta is ${(maxDelta * 10).toFixed(2)} cm; check OBJ scale, axes, and vertex order`);
if (!moved) throw new Error('The sculpt is identical to the neutral cage');

const out = path.join(ROOT, 'assets-src', 'targets', `${correctiveName(slider, endpoint)}.target`);
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, lines.join('\n') + '\n');
console.log(`wrote ${path.relative(ROOT, out)} (${moved} moved vertices, max ${(maxDelta * 10).toFixed(2)} cm)`);

