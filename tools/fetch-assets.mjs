/* ---------------------------------------------------------------------------
   Stage the CC0 MakeHuman source assets into assets-src/.

   Clones the MakeHuman repo (blobless, depth 1) into .assets-cache/ the first
   time, then copies across only the files assets-manifest.mjs asks for.
   Everything copied is CC0 — base mesh, skeleton, skin weights, morph targets.
   --------------------------------------------------------------------------- */
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MH_REPO, MH_DATA, ALL_FILES } from './assets-manifest.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CACHE = path.join(ROOT, '.assets-cache', 'makehuman');
const DEST = path.join(ROOT, 'assets-src');

function sh(cmd, cwd) {
  execSync(cmd, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
}

if (!fs.existsSync(path.join(CACHE, '.git'))) {
  console.log('cloning MakeHuman (CC0 assets) — this takes a minute…');
  fs.mkdirSync(path.dirname(CACHE), { recursive: true });
  sh(`git clone --depth 1 --filter=blob:none --no-checkout "${MH_REPO}" "${CACHE}"`);
  sh('git config core.longpaths true', CACHE);
  sh('git config core.protectNTFS false', CACHE);
  sh(`git checkout master -- ${MH_DATA}`, CACHE);
  console.log('clone done.');
}

let copied = 0, missing = [];
for (const rel of ALL_FILES) {
  const src = path.join(CACHE, MH_DATA, rel);
  const dst = path.join(DEST, rel);
  if (!fs.existsSync(src)) { missing.push(rel); continue; }
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(src, dst);
  copied++;
}

/* keep the licence next to the assets it covers */
for (const lic of ['LICENSE.ASSETS.md', 'LICENSE.md']) {
  const src = path.join(CACHE, lic);
  if (fs.existsSync(src)) fs.copyFileSync(src, path.join(DEST, lic));
}

console.log(`staged ${copied} files into assets-src/`);
if (missing.length) {
  console.warn(`MISSING ${missing.length}:`);
  missing.forEach(m => console.warn('  ' + m));
  process.exitCode = 1;
}
