/* ---------------------------------------------------------------------------
   Clean the baked skin weights.

   Heat weights leak across the midline (the right clavicle pulling the left
   pec) and the bake keeps only the four strongest bones per vertex. Where a
   fifth bone overtakes the fourth, neighbouring vertices keep different sets,
   and when the shoulders roll forward the skin creases along that line.

   1. Left/right pairs are redistributed across the midline with a smooth
      step, so a pair never switches sides abruptly and never reaches across.
   2. Trunk and shoulder weights are smoothed over the surface (Laplacian
      passes; hands, forearms and legs are left alone).
   3. The four strongest bones are kept, sorted, and normalised.

   Only the skin blocks change; the surface blocks are untouched. Runs once per
   bake: freeman.json records `weightsFixed`, and a second run is a no-op.

   node tools/fix-freeman-weights.mjs [--force]
   --------------------------------------------------------------------------- */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PAIRS = [["clavicle", 2.5], ["upperarm_support", 2.5], ["upperarm", 2.5], ["thigh", 1.5]];
const TRUNK = /^(chest|abdomen|neck|clavicle|upperarm_support)/;
const LIMB = /^(forearm|hand|finger|thumb|thigh|shin|foot|toe)/;
const PASSES = 8, RATE = 0.5;
const smoothstep = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

export function fixWeights(meta, bin) {
  const n = meta.vertices, names = meta.bones.map((b) => b.name), nb = names.length;
  const view = (name, T) => { const b = meta.blocks.find((x) => x.name === name); return new T(bin.buffer, bin.byteOffset + b.offset, b.length); };
  const pos = view("position", Float32Array), index = view("index", Uint32Array);
  const si = view("skinIndex", Uint16Array), sw = view("skinWeight", Float32Array);
  const W = new Float32Array(n * nb);
  for (let v = 0; v < n; v++) for (let k = 0; k < 4; k++) W[v * nb + si[v * 4 + k]] += sw[v * 4 + k];
  const changed = new Uint8Array(n);

  // 1. left/right pairs fade across the midline
  for (const [base, h] of PAIRS) {
    const L = names.indexOf(`${base}.L`), R = names.indexOf(`${base}.R`);
    if (L < 0 || R < 0) continue;
    for (let v = 0; v < n; v++) {
      const o = v * nb, t = W[o + L] + W[o + R];
      if (!t) continue;
      const s = smoothstep(-h, h, pos[v * 3]), l = t * s, r = t * (1 - s);
      if (Math.abs(l - W[o + L]) > 1e-6) { W[o + L] = l; W[o + R] = r; changed[v] = 1; }
    }
  }

  // 2. Laplacian smoothing of trunk and shoulder weights
  const trunk = names.map((b) => TRUNK.test(b)), limb = names.map((b) => LIMB.test(b));
  const mask = [];
  for (let v = 0; v < n; v++) {
    let t = 0, l = 0;
    for (let b = 0; b < nb; b++) { if (trunk[b]) t += W[v * nb + b]; if (limb[b]) l += W[v * nb + b]; }
    if (t > 0.05 && l < 0.01) mask.push(v);
  }
  const count = new Uint32Array(n + 1);
  for (let t = 0; t < index.length; t++) count[index[t] + 1] += 2;
  for (let v = 0; v < n; v++) count[v + 1] += count[v];
  const adj = new Uint32Array(count[n]), fill = count.slice(0, n);
  for (let t = 0; t < index.length; t += 3)
    for (let k = 0; k < 3; k++) {
      const a = index[t + k];
      adj[fill[a]++] = index[t + (k + 1) % 3];
      adj[fill[a]++] = index[t + (k + 2) % 3];
    }
  const next = new Float32Array(mask.length * nb);
  for (let pass = 0; pass < PASSES; pass++) {
    mask.forEach((v, i) => {
      const o0 = count[v], o1 = count[v + 1], c = o1 - o0;
      for (let b = 0; b < nb; b++) {
        let s = 0;
        for (let o = o0; o < o1; o++) s += W[adj[o] * nb + b];
        next[i * nb + b] = W[v * nb + b] * (1 - RATE) + (s / c) * RATE;
      }
    });
    mask.forEach((v, i) => { W.set(next.subarray(i * nb, (i + 1) * nb), v * nb); changed[v] = 1; });
  }

  // 3. keep the four strongest, sorted, normalised
  let rewritten = 0;
  const order = new Array(nb);
  for (let v = 0; v < n; v++) {
    if (!changed[v]) continue;
    for (let b = 0; b < nb; b++) order[b] = b;
    order.sort((a, b) => W[v * nb + b] - W[v * nb + a]);
    let total = 0;
    for (let k = 0; k < 4; k++) total += W[v * nb + order[k]];
    for (let k = 0; k < 4; k++) {
      const w = W[v * nb + order[k]];
      si[v * 4 + k] = w > 0 ? order[k] : 0;
      sw[v * 4 + k] = w > 0 ? w / total : 0;
    }
    rewritten++;
  }
  meta.weightsFixed = { version: 1, pairs: PAIRS.map((p) => p[0]), passes: PASSES, smoothed: mask.length };
  return { rewritten, smoothed: mask.length };
}

export function fixFile(dir) {
  const jsonPath = path.join(dir, "freeman.json"), binPath = path.join(dir, "freeman.bin");
  const meta = JSON.parse(fs.readFileSync(jsonPath)), bin = fs.readFileSync(binPath);
  if (meta.weightsFixed && !process.argv.includes("--force")) {
    console.log("Skin weights already cleaned for this bake.");
    return null;
  }
  const result = fixWeights(meta, bin);
  fs.writeFileSync(binPath, bin);
  fs.writeFileSync(jsonPath, JSON.stringify(meta));
  console.log(`Skin weights cleaned: ${result.rewritten} vertices rewritten, ${result.smoothed} smoothed.`);
  return result;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]))
  fixFile(path.resolve(import.meta.dirname, "../public/models"));
