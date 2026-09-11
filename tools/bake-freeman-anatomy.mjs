#!/usr/bin/env node
/* ---------------------------------------------------------------------------
   Project the Z-Anatomy dissection onto every vertex of the Freeman sculpt.

   Output: public/models/freeman-anatomy.json + .bin, in the format and
   vocabulary of docs/ARCHITECTURE.md ("Anatomy map"). Method and limits:
   docs/ANATOMY_MAP.md.

     node tools/bake-freeman-anatomy.mjs            (npm run anatomy:freeman)
       --extract   re-read the atlas even if the geometry cache exists
       --shots     render review images to shots/anatomy-map-*.png
       --overlay   also write the warped dissection for overlay renders

   Stages
     1. extract   Blender reads the atlas once and caches the structures
                  (tools/blender/project_freeman_anatomy.py).
     2. register  The cadaver is carried into the Freeman body: a uniform
                  scale to his height, then skeleton-driven skinning with
                  length normalisation per limb bone (the atlas arm hangs,
                  Freeman's is out at 45°), then a smooth displacement field
                  that lays the dissection's own skin onto Freeman's skin and
                  carries everything under it along. A trained body is
                  bigger than a cadaver; after this step the atlas muscles
                  sit just under Freeman's skin wherever his are.
     3. cast      One ray per vertex, inward along the relaxed normal. The
                  first structure it enters owns that skin, subject to a few
                  stated rules (sheets are seen through, a limb structure
                  cannot own trunk skin, and so on).
     4. clean     Majority filter, islands and small holes, left/right by x,
                  borders snapped to the sculpt's own grooves, soft borders.
     5. along     0 at the origin → 1 at the insertion, measured on the atlas
                  muscle between its real attachment patches, then smoothed.
     6. write     Blocks, landmarks, and (optionally) review renders.
   --------------------------------------------------------------------------- */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFreeman } from "./read-freeman.mjs";
import { buildContext } from "../src/freeman/shape/context.js";
import { STRUCTURES, MERGE, TRANSPARENT, SEE_THROUGH, PERSIST, BONE_SEGMENT, skinSegment } from "./freeman-anatomy-table.mjs";
import {
  TriangleBVH, DistanceField, geodesic,
  sub, add, mul, dot, cross, len, norm, clamp, smoothstep,
} from "./freeman-anatomy-geometry.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BUILD = path.join(ROOT, "assets-src", "anatomy-reference", "build");
const MODELS = path.join(ROOT, "public", "models");
const SHOTS = path.join(ROOT, "shots");
const ARGS = new Set(process.argv.slice(2));
const T0 = Date.now();
const stamp = (msg) => console.log(`[${((Date.now() - T0) / 1000).toFixed(1).padStart(6)}s] ${msg}`);

/* ---- tunables (cm) ---- */
const RAY_OUT = 2.5;        // rays start this far outside the skin
const RAY_IN = 7.0;         // and look this deep under it
const SHEET = 0.3;          // thinner than this, with muscle under it: an aponeurosis
const SHEET_GAP = 2.5;      // "under it" means within this depth
const REGION_MIN = 0.25;    // rig weight a region needs before its structures may own skin
const BORDER = 1.2;         // soft border half-width
const MIN_ISLAND = 25;      // vertices; smaller islands of a structure are relabelled
const MAX_HOLE = 220;       // vertices; unlabelled patches up to this size are filled
const FRONT = [0, 0, 1];

/* ======================================================================== *
   1. extract (cached)
 * ======================================================================== */
function mainCheckout() {
  try {
    const common = execFileSync("git", ["rev-parse", "--git-common-dir"], { cwd: ROOT }).toString().trim();
    return path.resolve(ROOT, common, "..");
  } catch {
    return ROOT;
  }
}
const ROOTS = [ROOT, mainCheckout()];
const locate = (rel) => ROOTS.map((r) => path.join(r, rel)).find((p) => fs.existsSync(p));
const BLENDER = process.env.BLENDER_PATH
  || locate(".tools/blender-runtime/blender-4.5.13-windows-x64/blender.exe") || "blender";
const ATLAS_BLEND = process.env.ZANATOMY_BLEND
  || locate(".assets-cache/z-anatomy/extracted/Z-Anatomy/Startup.blend");
const CACHE_JSON = path.join(BUILD, "freeman-anatomy-atlas.json");
const CACHE_BIN = path.join(BUILD, "freeman-anatomy-atlas.bin");

if (ARGS.has("--extract") || !fs.existsSync(CACHE_JSON) || !fs.existsSync(CACHE_BIN)) {
  if (!ATLAS_BLEND) throw new Error("Z-Anatomy Startup.blend not found (set ZANATOMY_BLEND)");
  fs.mkdirSync(BUILD, { recursive: true });
  stamp(`extracting the atlas with ${BLENDER}`);
  execFileSync(BLENDER, ["-b", ATLAS_BLEND, "--python",
    path.join(ROOT, "tools", "blender", "project_freeman_anatomy.py"), "--", "extract", CACHE_JSON, CACHE_BIN],
  { stdio: ["ignore", "inherit", "inherit"] });
}

/* ======================================================================== *
   load both bodies
 * ======================================================================== */
stamp("loading the sculpt and the atlas cache");
const fm = readFreeman();
const ctx = buildContext(fm);
const N = ctx.n;
const P = fm.position;
const NRM = ctx.smoothNormal;
const ADJ = ctx.adjacency();
/* The sculpt is mirror-symmetric (vertex onto vertex within 0.2 mm for 99 %);
   MIR[v] is the vertex at (-x, y, z). The atlas' two sides are two halves of
   one real, slightly asymmetric body; the map pools them so Freeman's left
   and right agree. */
const MIR = new Int32Array(N);
{
  const map = new Map(), key = (x, y, z) => (x + 512) * 1048576 + (y + 512) * 1024 + (z + 512);
  for (let v = 0; v < N; v++) {
    const k = key(Math.floor(P[v * 3]), Math.floor(P[v * 3 + 1]), Math.floor(P[v * 3 + 2]));
    let b = map.get(k);
    if (!b) map.set(k, (b = []));
    b.push(v);
  }
  let worst = 0, inv = 0;
  for (let v = 0; v < N; v++) {
    const x = -P[v * 3], y = P[v * 3 + 1], z = P[v * 3 + 2];
    const cx = Math.floor(x), cy = Math.floor(y), cz = Math.floor(z);
    let best = Infinity, bi = v;
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (let c = -1; c <= 1; c++) {
      const bucket = map.get(key(cx + a, cy + b, cz + c));
      if (!bucket) continue;
      for (const w of bucket) {
        const e = (P[w * 3] - x) ** 2 + (P[w * 3 + 1] - y) ** 2 + (P[w * 3 + 2] - z) ** 2;
        if (e < best) { best = e; bi = w; }
      }
    }
    MIR[v] = bi;
    worst = Math.max(worst, Math.sqrt(best));
  }
  for (let v = 0; v < N; v++) if (MIR[MIR[v]] === v) inv++;
  console.log(`  mirror map: worst ${worst.toFixed(2)} cm, ${(100 * inv / N).toFixed(2)}% of vertices pair up exactly`);
}
const RIG = Object.fromEntries(fm.meta.bones.map((b) => [b.name, b]));
const foot = new Float32Array(N);
for (let v = 0; v < N; v++)
  for (let k = 0; k < 4; k++)
    if (/^foot/.test(fm.meta.bones[fm.skinIndex[v * 4 + k]].name)) foot[v] += fm.skinWeight[v * 4 + k];
let freemanTop = 0;
for (let v = 0; v < N; v++) freemanTop = Math.max(freemanTop, P[v * 3 + 1]);

const cacheMeta = JSON.parse(fs.readFileSync(CACHE_JSON, "utf8"));
const cacheBuf = fs.readFileSync(CACHE_BIN);
const cacheAB = cacheBuf.buffer.slice(cacheBuf.byteOffset, cacheBuf.byteOffset + cacheBuf.byteLength);
const OBJ = cacheMeta.objects.map((o) => ({
  ...o,
  pos: new Float32Array(cacheAB, o.v, o.nv * 3).slice(),
  tri: new Uint32Array(cacheAB, o.t, o.nt * 3),
}));
const SKIN = OBJ.filter((o) => o.kind === "skin" && o.name !== "Regions of human body.g");
let atlasTop = 0;
for (const o of SKIN) for (let i = 1; i < o.pos.length; i += 3) atlasTop = Math.max(atlasTop, o.pos[i]);
const SCALE = freemanTop / atlasTop;
for (const o of OBJ) for (let i = 0; i < o.pos.length; i++) o.pos[i] *= SCALE;
const centroidX = (o) => { let s = 0; for (let i = 0; i < o.pos.length; i += 3) s += o.pos[i]; return s / o.nv; };
for (const o of OBJ) o.sideX = o.side || (centroidX(o) >= 0 ? "L" : "R");
/* BodyParts3D meshes do not agree on winding: about a third face inward. The
   cast tells entry from exit by the facing of the triangle it crosses, so
   every structure is turned to face outward (positive signed volume). */
{
  let flipped = 0, solid = 0;
  for (const o of OBJ) {
    if (o.kind !== "muscle" && o.kind !== "bone") continue;
    solid++;
    if (orientOutward(o.pos, o.tri)) flipped++;
  }
  stamp(`turned ${flipped} of ${solid} inward-facing structures outward`);
}
stamp(`atlas ${atlasTop.toFixed(1)} cm tall -> scale ${SCALE.toFixed(4)}; ${OBJ.length} objects`);

/* ======================================================================== *
   2. register
 * ======================================================================== */
// ---- joints ----
const ATLAS_JOINTS = JSON.parse(fs.readFileSync(path.join(ROOT, "assets-src", "anatomy-reference", "atlas-joints.json"), "utf8")).joints;
const atlasJoint = (name, side) => {
  const j = ATLAS_JOINTS[`${name}.${side}`];
  return [j[0] * 100 * SCALE, j[2] * 100 * SCALE, -j[1] * 100 * SCALE];
};
const SIDES = ["L", "R"];
const sgn = (side) => (side === "L" ? 1 : -1);

/* The leg joints of the Freeman rig are placed for skinning, not anatomy (its
   knee sits 8 cm above the patella). The atlas joints, scaled, already fall
   inside his knees and ankles; they are only re-centred on his limb. */
function sliceCentroid(points, side, y0, half = 1.0) {
  let x = 0, z = 0, c = 0;
  for (let i = 0; i < points.length; i += 3) {
    if (Math.sign(points[i]) !== sgn(side) || Math.abs(points[i + 1] - y0) > half) continue;
    x += points[i]; z += points[i + 2]; c++;
  }
  return c ? [x / c, z / c] : null;
}
const freemanLeg = [];
for (let v = 0; v < N; v++) if (ctx.leg[v] > 0.6) freemanLeg.push(P[v * 3], P[v * 3 + 1], P[v * 3 + 2]);
const atlasLeg = [];
for (const o of SKIN) if (["thigh", "shin", "foot"].includes(skinSegment(o.base))) atlasLeg.push(...o.pos);
const JF = {}, JA = {};
for (const side of SIDES) {
  for (const j of ["shoulder", "elbow", "wrist", "hip", "knee", "ankle"]) JA[`${j}.${side}`] = atlasJoint(j, side);
  JF[`shoulder.${side}`] = RIG[`upperarm.${side}`].head;
  JF[`elbow.${side}`] = RIG[`upperarm.${side}`].tail;
  JF[`wrist.${side}`] = RIG[`forearm.${side}`].tail;
  for (const [j, probe] of [["hip", -12], ["knee", 0], ["ankle", 4]]) {
    const a = JA[`${j}.${side}`], y0 = a[1] + probe;
    const cf = sliceCentroid(freemanLeg, side, y0), ca = sliceCentroid(atlasLeg, side, y0);
    JF[`${j}.${side}`] = [a[0] + cf[0] - ca[0], a[1], a[2] + cf[1] - ca[1]];
  }
}
for (const k of Object.keys(JF)) console.log(`  ${k.padEnd(11)} atlas ${JA[k].map((x) => x.toFixed(1)).join(", ").padEnd(20)} freeman ${JF[k].map((x) => x.toFixed(1)).join(", ")}`);

// ---- per-bone transforms: rotate the bone frame, stretch along the bone ----
function frame(a0, a1) {
  const ax = sub(a1, a0), L = len(ax), a = mul(ax, 1 / L);
  const r = norm(sub(FRONT, mul(a, dot(FRONT, a))));
  return { o: a0, a, r, b: cross(a, r), L };
}
const SEGMENTS = { upperarm: ["shoulder", "elbow"], forearm: ["elbow", "wrist"], thigh: ["hip", "knee"], shin: ["knee", "ankle"] };
const GROUPS = ["trunk"];
const XFORM = [null];
for (const side of SIDES)
  for (const [seg, [j0, j1]] of Object.entries(SEGMENTS)) {
    GROUPS.push(`${seg}.${side}`);
    XFORM.push({ A: frame(JA[`${j0}.${side}`], JA[`${j1}.${side}`]), F: frame(JF[`${j0}.${side}`], JF[`${j1}.${side}`]) });
  }
const G = Object.fromEntries(GROUPS.map((g, i) => [g, i]));
function applyGroup(g, x, y, z, out) {
  if (g === 0) { out[0] = x; out[1] = y; out[2] = z; return; }
  const { A, F } = XFORM[g];
  const dx = x - A.o[0], dy = y - A.o[1], dz = z - A.o[2];
  const t = (dx * A.a[0] + dy * A.a[1] + dz * A.a[2]) / A.L;
  const u = dx * A.r[0] + dy * A.r[1] + dz * A.r[2];
  const w = dx * A.b[0] + dy * A.b[1] + dz * A.b[2];
  for (let k = 0; k < 3; k++) out[k] = F.o[k] + F.a[k] * t * F.L + F.r[k] * u + F.b[k] * w;
}

// ---- skinning weights from distance to each bone group ----
stamp("distance fields to the atlas bones");
const boneGroupOf = (o) => {
  for (const [re, seg] of BONE_SEGMENT) if (re.test(o.base)) return G[`${seg}.${o.sideX}`];
  return 0;
};
const bonePts = GROUPS.map(() => []);
for (const o of OBJ) if (o.kind === "bone") { const g = boneGroupOf(o); for (let i = 0; i < o.pos.length; i++) bonePts[g].push(o.pos[i]); }
const FIELD_LO = [-42, -2, -22], FIELD_HI = [42, 184, 22];
const FIELDS = bonePts.map((pts) => new DistanceField(FIELD_LO, FIELD_HI, 1.0).build(pts));

function allowedGroups(regions, side) {
  const out = [0];
  for (const s of side ? [side] : SIDES) {
    if (regions.includes("a")) out.push(G[`upperarm.${s}`], G[`forearm.${s}`]);
    if (regions.includes("l")) out.push(G[`thigh.${s}`], G[`shin.${s}`]);
  }
  return out;
}
const tmpA = [0, 0, 0];
/* Skin one point by inverse-distance-to-bone weights over `groups`. */
function skinPoint(x, y, z, groups, out) {
  let ws = 0; out[0] = out[1] = out[2] = 0;
  for (const g of groups) {
    const d = FIELDS[g].at(x, y, z);
    const w = 1 / Math.pow(d + 0.5, 4);
    applyGroup(g, x, y, z, tmpA);
    out[0] += tmpA[0] * w; out[1] += tmpA[1] * w; out[2] += tmpA[2] * w;
    ws += w;
  }
  out[0] /= ws; out[1] /= ws; out[2] /= ws;
}
function skinObject(o, regions) {
  const out = new Float32Array(o.pos.length), q = [0, 0, 0];
  const groupsL = allowedGroups(regions, o.side || "L"), groupsR = allowedGroups(regions, o.side || "R");
  for (let i = 0; i < o.pos.length; i += 3) {
    const side = o.side || (o.pos[i] >= 0 ? "L" : "R");
    skinPoint(o.pos[i], o.pos[i + 1], o.pos[i + 2], side === "L" ? groupsL : groupsR, q);
    out[i] = q[0]; out[i + 1] = q[1]; out[i + 2] = q[2];
  }
  return out;
}

// ---- lay the dissection's skin onto Freeman's skin ----
stamp("skinning the atlas skin and matching it to the sculpt");
const skinRegions = (seg) => (["upperarm", "forearm", "hand"].includes(seg) ? "ta" : ["thigh", "shin", "foot"].includes(seg) ? "tl" : "tal");
for (const o of SKIN) { o.seg = skinSegment(o.base); o.lbs = skinObject(o, skinRegions(o.seg)); }

const triClass = new Uint8Array(fm.index.length / 3);   // 0 trunk/head, 1 arm, 2 leg
for (let t = 0; t < triClass.length; t++) {
  let a = 0, l = 0;
  for (let k = 0; k < 3; k++) { const v = fm.index[t * 3 + k]; a += ctx.arm[v]; l += ctx.leg[v]; }
  triClass[t] = a > 1.5 ? 1 : l > 1.5 ? 2 : 0;
}
const freemanBVH = new TriangleBVH(P, fm.index);
const skinPts = [], skinDisp = [], skinOk = [];
{
  const hits = [];
  for (const o of SKIN) {
    if (o.seg === "hand") continue;
    const want = ["upperarm", "forearm"].includes(o.seg) ? 1 : ["thigh", "shin", "foot"].includes(o.seg) ? 2 : -1;
    const nrm = vertexNormals(o.lbs, o.tri);
    for (let i = 0; i < o.nv; i++) {
      const x = o.lbs[i * 3], y = o.lbs[i * 3 + 1], z = o.lbs[i * 3 + 2];
      const nx = nrm[i * 3], ny = nrm[i * 3 + 1], nz = nrm[i * 3 + 2];
      let best = Infinity;
      for (const s of [1, -1]) {
        freemanBVH.rayAll(x, y, z, nx * s, ny * s, nz * s, 8, hits);
        for (const h of hits) if ((want < 0 || triClass[h.tri] === want) && h.t < Math.abs(best)) best = h.t * s;
      }
      skinPts.push(x, y, z);
      if (Number.isFinite(best)) { skinDisp.push(nx * best, ny * best, nz * best); skinOk.push(1); }
      else { skinDisp.push(0, 0, 0); skinOk.push(0); }
    }
  }
}
const skinP = Float32Array.from(skinPts);
let disp = Float32Array.from(skinDisp);
let ok = Uint8Array.from(skinOk);
{
  // regularise: robust neighbourhood average, then fill the gaps
  const hash = new PointHash(skinP, 3);
  for (let pass = 0; pass < 6; pass++) {
    const radius = pass < 2 ? 2.5 : 4;
    const next = new Float32Array(disp.length), nok = new Uint8Array(ok.length);
    for (let i = 0; i < ok.length; i++) {
      let sx = 0, sy = 0, sz = 0, sw = 0;
      hash.near(skinP[i * 3], skinP[i * 3 + 1], skinP[i * 3 + 2], radius, (j, d2) => {
        if (!ok[j]) return;
        const w = Math.exp(-d2 / (radius * radius * 0.5));
        sx += disp[j * 3] * w; sy += disp[j * 3 + 1] * w; sz += disp[j * 3 + 2] * w; sw += w;
      });
      if (sw > 1e-6) { next[i * 3] = sx / sw; next[i * 3 + 1] = sy / sw; next[i * 3 + 2] = sz / sw; nok[i] = 1; }
    }
    disp = next; ok = nok;
  }
  let m = 0, c = 0;
  for (let i = 0; i < ok.length; i++) if (ok[i]) { m += Math.hypot(disp[i * 3], disp[i * 3 + 1], disp[i * 3 + 2]); c++; }
  stamp(`  ${c} of ${ok.length} atlas skin points matched, mean shift ${(m / c).toFixed(2)} cm`);
}
// displacement on a grid, then read back anywhere by trilinear interpolation
stamp("displacement field");
const DG = { lo: [-78, -4, -30], cell: 2, nx: 0, ny: 0, nz: 0, d: null };
DG.nx = Math.ceil(156 / DG.cell) + 1; DG.ny = Math.ceil(190 / DG.cell) + 1; DG.nz = Math.ceil(60 / DG.cell) + 1;
DG.d = new Float32Array(DG.nx * DG.ny * DG.nz * 3);
// the grid only changes when the registration does: cache it by its inputs
const DG_KEY = createHash("sha1").update(new Uint8Array(skinP.buffer)).update(new Uint8Array(disp.buffer))
  .update(new Uint8Array(ok.buffer)).update(JSON.stringify([DG.lo, DG.cell, DG.nx, DG.ny, DG.nz])).digest("hex");
const DG_FILE = path.join(BUILD, "displacement.f32");
if (fs.existsSync(DG_FILE + ".key") && fs.readFileSync(DG_FILE + ".key", "utf8") === DG_KEY) {
  const b = fs.readFileSync(DG_FILE);
  DG.d.set(new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)));
  stamp("  displacement field from cache");
} else {
  const okIdx = []; for (let i = 0; i < ok.length; i++) if (ok[i]) okIdx.push(i);
  const pts = new Float32Array(okIdx.length * 3), dsp = new Float32Array(okIdx.length * 3);
  okIdx.forEach((i, k) => { pts.set(skinP.subarray(i * 3, i * 3 + 3), k * 3); dsp.set(disp.subarray(i * 3, i * 3 + 3), k * 3); });
  const hash = new PointHash(pts, 3);
  const K = 16, bestD = new Float64Array(K), bestI = new Int32Array(K);
  for (let z = 0; z < DG.nz; z++) for (let y = 0; y < DG.ny; y++) for (let x = 0; x < DG.nx; x++) {
    const px = DG.lo[0] + x * DG.cell, py = DG.lo[1] + y * DG.cell, pz = DG.lo[2] + z * DG.cell;
    const found = hash.knn(px, py, pz, K, 24, bestD, bestI);
    if (!found) continue;
    let sx = 0, sy = 0, sz = 0, sw = 0;
    for (let k = 0; k < found; k++) {
      const w = 1 / (bestD[k] + 0.25);          // bestD is squared distance
      const j = bestI[k];
      sx += dsp[j * 3] * w; sy += dsp[j * 3 + 1] * w; sz += dsp[j * 3 + 2] * w; sw += w;
    }
    const o = ((z * DG.ny + y) * DG.nx + x) * 3;
    DG.d[o] = sx / sw; DG.d[o + 1] = sy / sw; DG.d[o + 2] = sz / sw;
  }
  fs.writeFileSync(DG_FILE, Buffer.from(DG.d.buffer));
  fs.writeFileSync(DG_FILE + ".key", DG_KEY);
}
function displace(x, y, z, out) {
  let fx = (x - DG.lo[0]) / DG.cell, fy = (y - DG.lo[1]) / DG.cell, fz = (z - DG.lo[2]) / DG.cell;
  fx = clamp(fx, 0, DG.nx - 1.001); fy = clamp(fy, 0, DG.ny - 1.001); fz = clamp(fz, 0, DG.nz - 1.001);
  const ix = Math.floor(fx), iy = Math.floor(fy), iz = Math.floor(fz);
  const tx = fx - ix, ty = fy - iy, tz = fz - iz;
  out[0] = out[1] = out[2] = 0;
  for (let c = 0; c < 8; c++) {
    const dx = c & 1, dy = (c >> 1) & 1, dz = (c >> 2) & 1;
    const w = (dx ? tx : 1 - tx) * (dy ? ty : 1 - ty) * (dz ? tz : 1 - tz);
    const o = (((iz + dz) * DG.ny + (iy + dy)) * DG.nx + (ix + dx)) * 3;
    out[0] += DG.d[o] * w; out[1] += DG.d[o + 1] * w; out[2] += DG.d[o + 2] * w;
  }
}
function warpObject(o, regions) {
  const lbs = skinObject(o, regions), q = [0, 0, 0];
  for (let i = 0; i < lbs.length; i += 3) {
    displace(lbs[i], lbs[i + 1], lbs[i + 2], q);
    lbs[i] += q[0]; lbs[i + 1] += q[1]; lbs[i + 2] += q[2];
  }
  return lbs;
}

/* ======================================================================== *
   structures: which atlas geometry is which vocabulary entry
 * ======================================================================== */
const NS = STRUCTURES.length;
const byAtlasName = new Map();
STRUCTURES.forEach((s, i) => s.atlas.forEach((a) => byAtlasName.set(a, i)));
for (const [a, name] of Object.entries(MERGE)) byAtlasName.set(a, STRUCTURES.findIndex((s) => s.name === name));
const sIndex = (name) => STRUCTURES.findIndex((s) => s.name === name);
const PERSIST_OF = new Float32Array(NS + 2).fill(1);   // by label + 1 (label -1 = nothing, NS = other)
for (const [name, f] of Object.entries(PERSIST)) PERSIST_OF[sIndex(name) + 1] = f;

/* An instance is one sided structure (or one "other" object) in the cast. */
const INST = [];
function instance(key, props) {
  let inst = INST.find((i) => i.key === key);
  if (!inst) { inst = { key, parts: [], ...props }; INST.push(inst); }
  return inst;
}
const PATCHES = OBJ.filter((o) => o.kind === "patch");
const MARKERS = OBJ.filter((o) => o.kind === "marker");

for (const o of OBJ) {
  if (o.kind !== "muscle" && o.kind !== "bone") continue;
  const si = byAtlasName.get(o.base);
  if (o.base === "Scapula") {
    // the acromion is its own structure: the lateral end of the scapular spine
    const m = MARKERS.find((k) => k.name === "Acromion.j");
    const ends = [[m.pos[0], m.pos[1], m.pos[2]], [m.pos[3], m.pos[4], m.pos[5]]].map((p) => (o.sideX === "L" ? [-p[0], p[1], p[2]] : p));
    const onBone = ends.map((e) => nearestDistance(o.pos, e)).reduce((b, d, k) => (d < b.d ? { d, k } : b), { d: Infinity, k: 0 });
    const a = ends[onBone.k];
    const nt = o.tri.length / 3, acro = [], rest = [];
    for (let t = 0; t < nt; t++) {
      let cx = 0, cy = 0, cz = 0;
      for (let k = 0; k < 3; k++) { const v = o.tri[t * 3 + k] * 3; cx += o.pos[v]; cy += o.pos[v + 1]; cz += o.pos[v + 2]; }
      const d = Math.hypot(cx / 3 - a[0], cy / 3 - a[1], cz / 3 - a[2]);
      (d < 3.6 * SCALE ? acro : rest).push(o.tri[t * 3], o.tri[t * 3 + 1], o.tri[t * 3 + 2]);
    }
    instance(`bone_acromion.${o.sideX}`, { s: sIndex("bone_acromion"), side: o.sideX })
      .parts.push({ o, tri: Uint32Array.from(acro) });
    instance(`other:${o.name}`, { s: -1, side: o.sideX, name: o.name, regions: "tal" })
      .parts.push({ o, tri: Uint32Array.from(rest) });
    continue;
  }
  if (si !== undefined) {
    instance(`${STRUCTURES[si].name}.${o.sideX}`, { s: si, side: o.sideX }).parts.push({ o, tri: o.tri });
  } else {
    instance(`other:${o.name}`, {
      s: -1, side: o.side, name: o.name, regions: "tal",
      transparent: TRANSPARENT.includes(o.base),
    }).parts.push({ o, tri: o.tri });
  }
}

/* The patellar ligament is in the atlas only as its two attachment patches.
   Its band is rebuilt between them: as wide as the patella apex, in front of
   the fat pad, a few millimetres thick. */
for (const side of SIDES) {
  const pick = (tag) => PATCHES.filter((p) => p.name.startsWith(`Patellar ligament.${tag}`) && p.sideX === side);
  const cloud = (list) => list.flatMap((p) => Array.from(p.pos));
  const O = cloud(pick("o")), I = cloud(pick("e"));
  if (!O.length || !I.length) { console.warn("  no patellar ligament patches for", side); continue; }
  const mean = (a) => { const c = [0, 0, 0]; for (let i = 0; i < a.length; i += 3) for (let k = 0; k < 3; k++) c[k] += a[i + k]; return c.map((x) => x / (a.length / 3)); };
  const ext = (a, k) => { let lo = Infinity, hi = -Infinity; for (let i = k; i < a.length; i += 3) { lo = Math.min(lo, a[i]); hi = Math.max(hi, a[i]); } return [lo, hi]; };
  const o = mean(O), e = mean(I);
  const front = Math.max(ext(O, 2)[1], ext(I, 2)[1]);
  o[2] = e[2] = front + 0.2;
  const half = Math.max(1.4, (ext(O, 0)[1] - ext(O, 0)[0]) * 0.5);
  const box = boxMesh(o, e, half, 0.35);
  orientOutward(box.pos, box.tri);
  const inst = instance(`patellar_tendon.${side}`, { s: sIndex("patellar_tendon"), side });
  inst.parts.push({ o: { pos: box.pos, nv: box.pos.length / 3, side, sideX: side, base: "patellar ligament band" }, tri: box.tri });
}
stamp(`${INST.filter((i) => i.s >= 0).length} vocabulary instances, ${INST.filter((i) => i.s < 0).length} other structures`);
for (const s of STRUCTURES) for (const side of SIDES)
  if (!INST.some((i) => i.s === sIndex(s.name) && i.side === side) && s.name !== "biceps_tendon")
    console.warn(`  WARNING no atlas geometry for ${s.name}.${side}`);

/* ======================================================================== *
   along, on the atlas muscle between its own two ends
 * ======================================================================== */
stamp("measuring along on the atlas muscles");
function endPoints(spec, inst) {
  const pts = [];
  if (spec.patch) {
    for (const p of PATCHES) {
      if (p.sideX !== inst.side) continue;
      const clean = p.name.replace(/[()]/g, "");
      if (!spec.patch.some((pre) => clean.startsWith(pre))) continue;
      for (let i = 0; i < p.pos.length; i++) pts.push(p.pos[i]);
    }
    if (pts.length) return subsample(pts, 400);
    console.warn(`  WARNING ${inst.key}: no patch ${spec.patch.join(" | ")}; using the structure's extreme`);
  }
  const dir = spec.toward ?? [0, 1, 0];
  const d = [dir[0] * sgn(inst.side), dir[1], dir[2]];
  const all = inst.parts.flatMap((part) => Array.from(part.o.pos));
  const scores = [];
  for (let i = 0; i < all.length; i += 3) scores.push(all[i] * d[0] + all[i + 1] * d[1] + all[i + 2] * d[2]);
  const cut = [...scores].sort((a, b) => b - a)[Math.max(0, Math.floor(scores.length * 0.04) - 1)];
  for (let i = 0; i < scores.length; i++) if (scores[i] >= cut) pts.push(all[i * 3], all[i * 3 + 1], all[i * 3 + 2]);
  return subsample(pts, 400);
}
for (const inst of INST) {
  if (inst.s < 0) continue;
  const spec = STRUCTURES[inst.s];
  const O = endPoints(spec.origin, inst), I = endPoints(spec.insertion, inst);
  inst.originPts = O; inst.insertionPts = I;
  for (const part of inst.parts) {
    const pos = part.o.pos, along = new Float32Array(pos.length / 3);
    for (let v = 0; v < along.length; v++) {
      const x = pos[v * 3], y = pos[v * 3 + 1], z = pos[v * 3 + 2];
      const dO = Math.sqrt(minDist2(O, x, y, z)), dI = Math.sqrt(minDist2(I, x, y, z));
      along[v] = dO / (dO + dI + 1e-6);
    }
    part.along = along;
  }
}

/* ======================================================================== *
   warp every structure into the sculpt and build one BVH
 * ======================================================================== */
stamp("warping the dissection into the sculpt");
let nv = 0, nt = 0;
for (const inst of INST) for (const part of inst.parts) { nv += part.o.pos.length / 3; nt += part.tri.length / 3; }
const WV = new Float32Array(nv * 3), WT = new Uint32Array(nt * 3), WI = new Int32Array(nt), WA = new Float32Array(nv).fill(NaN);
{
  let vo = 0, to = 0;
  const warped = new Map();
  INST.forEach((inst, ii) => {
    const regions = inst.s >= 0 ? STRUCTURES[inst.s].regions : "tal";
    for (const part of inst.parts) {
      let w = warped.get(part.o);
      if (!w) { w = warpObject(part.o, regions); warped.set(part.o, w); }
      const base = vo;
      WV.set(w, vo * 3);
      if (part.along) WA.set(part.along, vo);
      vo += w.length / 3;
      for (let i = 0; i < part.tri.length; i++) WT[to * 3 + i] = part.tri[i] + base;
      WI.fill(ii, to, to + part.tri.length / 3);
      to += part.tri.length / 3;
    }
  });
}
stamp(`  ${nv} vertices, ${nt} triangles; building the BVH`);
const atlasBVH = new TriangleBVH(WV, WT);

/* ======================================================================== *
   3. cast
 * ======================================================================== */
stamp("casting one ray per vertex");
// never labelled: hands, feet below the ankle, genitals
const masked = new Uint8Array(N);
for (let v = 0; v < N; v++) {
  const x = P[v * 3], y = P[v * 3 + 1], z = P[v * 3 + 2];
  if (ctx.hand[v] > 0.5) masked[v] = 1;
  else if (foot[v] > 0.5 && y < 9) masked[v] = 1;
  else if (ctx.leg[v] < 0.5 && ctx.arm[v] < 0.5 && y < 89 && y > 60 && Math.abs(x) < 7.5 && z > 0) masked[v] = 1;
}
const regionWeight = (v, regions) => {
  const a = ctx.arm[v], l = ctx.leg[v], h = ctx.head[v], t = Math.max(0, 1 - a - l - h);
  let s = 0;
  if (regions.includes("t")) s += t;
  if (regions.includes("a")) s += a;
  if (regions.includes("l")) s += l;
  if (regions.includes("h")) s += h;
  return s;
};
const hitInst = new Int32Array(N).fill(-1);
const hitAlong = new Float32Array(N).fill(NaN);
const hitThick = new Float32Array(N);
const hitDepth = new Float32Array(N);
const facingStats = [0, 0];
{
  const hits = [];
  for (let v = 0; v < N; v++) {
    if (masked[v]) continue;
    const nx = NRM[v * 3], ny = NRM[v * 3 + 1], nz = NRM[v * 3 + 2];
    const ox = P[v * 3] + nx * RAY_OUT, oy = P[v * 3 + 1] + ny * RAY_OUT, oz = P[v * 3 + 2] + nz * RAY_OUT;
    atlasBVH.rayAll(ox, oy, oz, -nx, -ny, -nz, RAY_OUT + RAY_IN, hits);
    if (!hits.length) continue;
    hits.sort((a, b) => a.t - b.t);
    // entries per instance, by parity; winding tells whether the ray began inside
    const entries = [];
    const open = new Map();
    for (const h of hits) {
      const ii = WI[h.tri];
      const e = open.get(ii);
      if (e === undefined) {
        const startInside = !entries.some((x) => x.ii === ii) && h.facing > 0;
        facingStats[h.facing < 0 ? 0 : 1]++;
        if (entries.some((x) => x.ii === ii)) continue;   // re-entry: first entry wins
        const entry = { ii, t: startInside ? 0 : h.t, exit: startInside ? h.t : Infinity, h };
        entries.push(entry);
        if (!startInside) open.set(ii, entry);
      } else {
        e.exit = h.t;
        open.delete(ii);
      }
    }
    entries.sort((a, b) => a.t - b.t);
    let owner = null;
    for (let k = 0; k < entries.length; k++) {
      const e = entries[k], inst = INST[e.ii];
      if (inst.transparent) continue;
      if (inst.s >= 0 && regionWeight(v, STRUCTURES[inst.s].regions) < REGION_MIN) continue;
      const thick = e.exit - e.t;
      // a thin sheet is seen through to what lies under it; a vocabulary
      // sheet only to another vocabulary structure, never to unnamed depth
      if (thick < SHEET && entries.some((f, j) => j > k && f.t - e.t < SHEET_GAP && !INST[f.ii].transparent &&
          (inst.s < 0 || INST[f.ii].s >= 0))) continue;
      const see = inst.s >= 0 && SEE_THROUGH[STRUCTURES[inst.s].name];
      if (see && thick < see.thick && entries.some((f, j) => j > k && INST[f.ii].s >= 0 &&
          see.under.includes(STRUCTURES[INST[f.ii].s].name) && f.t - e.exit < see.gap)) continue;
      owner = e;
      break;
    }
    if (!owner) continue;
    hitInst[v] = owner.ii;
    hitThick[v] = owner.exit - owner.t;
    hitDepth[v] = owner.t - RAY_OUT;
    if (INST[owner.ii].s >= 0) {
      const tri = owner.h.tri, u = owner.h.u, w = owner.h.v;
      const a = WA[WT[tri * 3]], b = WA[WT[tri * 3 + 1]], c = WA[WT[tri * 3 + 2]];
      hitAlong[v] = a * (1 - u - w) + b * u + c * w;
    }
  }
}
{
  let hit = 0, voc = 0, open = 0;
  for (let v = 0; v < N; v++) { if (masked[v]) continue; open++; if (hitInst[v] >= 0) { hit++; if (INST[hitInst[v]].s >= 0) voc++; } }
  stamp(`  ${hit} of ${open} unmasked vertices hit anatomy, ${voc} a vocabulary structure; ` +
    `front-facing first hits ${(100 * facingStats[0] / (facingStats[0] + facingStats[1])).toFixed(0)}%`);
}
{
  // who owns the skin, how deep under it the owner starts and how thick it is
  const owners = new Map();
  for (let v = 0; v < N; v++) {
    const ii = hitInst[v];
    if (ii < 0) continue;
    const inst = INST[ii];
    const key = inst.s >= 0 ? STRUCTURES[inst.s].name : inst.name;
    const rec = owners.get(key) || { n: 0, d: 0, t: 0, other: inst.s < 0 };
    rec.n++; rec.d += hitDepth[v]; rec.t += Math.min(hitThick[v], RAY_IN);
    owners.set(key, rec);
  }
  const rows = [...owners.entries()].sort((a, b) => b[1].n - a[1].n);
  const fmt = ([k, r]) => `${k}:${r.n}@${(r.d / r.n).toFixed(1)}/${(r.t / r.n).toFixed(1)}`;
  console.log("  largest owners outside the vocabulary (vertices@depth/thickness cm): " +
    rows.filter(([, r]) => r.other).slice(0, 30).map(fmt).join("  "));
  console.log("  vocabulary owners before cleaning: " + rows.filter(([, r]) => !r.other).map(fmt).join("  "));
}
{
  // where the atlas biceps turns to tendon: skin count and thickness by along
  const bins = Array.from({ length: 10 }, () => ({ n: 0, t: 0 }));
  const bl = sIndex("biceps_long"), bs = sIndex("biceps_short");
  for (let v = 0; v < N; v++) {
    const ii = hitInst[v];
    if (ii < 0 || (INST[ii].s !== bl && INST[ii].s !== bs) || !Number.isFinite(hitAlong[v])) continue;
    const b = bins[Math.min(9, Math.floor(hitAlong[v] * 10))];
    b.n++; b.t += Math.min(hitThick[v], RAY_IN);
  }
  console.log("  biceps skin by along (vertices@thickness cm): " +
    bins.map((b, i) => `${(i / 10).toFixed(1)}:${b.n}@${b.n ? (b.t / b.n).toFixed(2) : "-"}`).join("  "));
}
/* --probe: the whole ray stack at named skin points, for tuning the rules.
   Each probe finds the skin where a line along `dir` through `target` leaves
   the body, then prints what the cast ray from that vertex crosses. */
if (ARGS.has("--probe")) {
  const PROBES = [
    { name: "rectus abdominis, upper", target: [5, 114, 0], dir: [0, 0, 1] },
    { name: "rectus abdominis, lower", target: [5, 98, 0], dir: [0, 0, 1] },
    { name: "linea alba", target: [0.3, 108, 0], dir: [0, 0, 1] },
    { name: "oblique flank", target: [14, 104, 0], dir: [0.8, 0, 0.6] },
    { name: "serratus", target: [15, 124, 0], dir: [0.6, 0, 0.8] },
    { name: "lumbar erector", target: [4.5, 104, 0], dir: [0, 0, -1] },
    { name: "teres major", target: [15, 131, 0], dir: [0, 0, -1] },
    { name: "infraspinatus", target: [11, 138, 0], dir: [0, 0, -1] },
    { name: "brachialis (lower lateral arm)", target: [32.5, 128.5, -3.2], dir: [0.5, 0.5, 0.707] },
    { name: "mid lateral arm", target: [28, 133, -3.5], dir: [0.6, 0.6, 0.5] },
    { name: "teres major, lateral", target: [18, 136, -4], dir: [0.5, 0, -0.866] },
    { name: "teres major, armpit", target: [20, 138, -4], dir: [0.6, -0.2, -0.77] },
    { name: "patellar tendon", target: [11.5, 43, -3], dir: [0, 0, 1] },
    { name: "patellar tendon, low", target: [11.5, 40, -3], dir: [0, 0, 1] },
    { name: "lower abdomen", target: [10, 92, 0], dir: [0.2, 0, 1] },
    { name: "groin", target: [13, 96, 0], dir: [0.4, 0, 0.9] },
    { name: "distal biceps", target: [35.2, 125.8, -3.1], dir: [0.2, 0.35, 0.9] },
    { name: "lumbar gap, medial", target: [5, 113, 0], dir: [0, 0, -1] },
    { name: "lumbar gap, lateral", target: [9, 109, 0], dir: [0.2, 0, -1] },
  ];
  const hits = [];
  const nm = (ii) => (INST[ii].s >= 0 ? `${STRUCTURES[INST[ii].s].name}.${INST[ii].side}` : INST[ii].name);
  for (const pr of PROBES) {
    const d = norm(pr.dir), o = add(pr.target, mul(d, 60));
    const hit = freemanBVH.rayFirst(o[0], o[1], o[2], -d[0], -d[1], -d[2], 120, hits);
    if (!hit) { console.log(`  probe ${pr.name}: missed the sculpt`); continue; }
    const bw = [1 - hit.u - hit.v, hit.u, hit.v];
    const v = fm.index[hit.tri * 3 + bw.indexOf(Math.max(...bw))];
    const nx = NRM[v * 3], ny = NRM[v * 3 + 1], nz = NRM[v * 3 + 2];
    atlasBVH.rayAll(P[v * 3] + nx * RAY_OUT, P[v * 3 + 1] + ny * RAY_OUT, P[v * 3 + 2] + nz * RAY_OUT, -nx, -ny, -nz, RAY_OUT + RAY_IN, hits);
    hits.sort((a, b) => a.t - b.t);
    const f = (a) => a.map((x) => x.toFixed(1)).join(",");
    console.log(`  probe ${pr.name}: v${v} at ${f([P[v * 3], P[v * 3 + 1], P[v * 3 + 2]])} n ${f([nx, ny, nz])}` +
      ` -> ${hitInst[v] >= 0 ? nm(hitInst[v]) : "nothing"}` + (masked[v] ? " (masked)" : ""));
    console.log("    " + hits.map((h) => `${(h.t - RAY_OUT).toFixed(2)}${h.facing < 0 ? "in" : "out"}:${nm(WI[h.tri])}`).join("  "));
  }
}

/* ======================================================================== *
   4. clean
 * ======================================================================== */
stamp("cleaning the labels");
const OTHER = NS;                          // label for "a real structure outside the vocabulary"
let base = new Int16Array(N).fill(-1);     // -1 nothing, 0..NS-1 structure, NS other
for (let v = 0; v < N; v++) {
  if (hitInst[v] < 0) continue;
  const s = INST[hitInst[v]].s;
  base[v] = s >= 0 ? s : OTHER;
}
// the distal biceps: where the ray measured a thin cord near the elbow
const BT = sIndex("biceps_tendon");
for (let v = 0; v < N; v++) {
  const s = base[v];
  if ((s === sIndex("biceps_long") || s === sIndex("biceps_short")) && hitAlong[v] > 0.78 && hitThick[v] < 1.1) base[v] = BT;
}
const sideOf = (v) => (P[v * 3] >= 0 ? 0 : 1);

function majority(labels, passes) {
  const { offsets, list } = ADJ;
  const tally = new Map();
  for (let p = 0; p < passes; p++) {
    const next = labels.slice();
    for (let v = 0; v < N; v++) {
      if (masked[v]) continue;
      tally.clear();
      tally.set(labels[v], 2);
      let total = 2;
      for (let o = offsets[v]; o < offsets[v + 1]; o++) {
        const w = list[o];
        if (masked[w]) continue;
        tally.set(labels[w], (tally.get(labels[w]) || 0) + 1); total++;
      }
      let best = labels[v], bc = 0;
      for (const [l, c] of tally) if (c > bc) { bc = c; best = l; }
      if (best !== labels[v] && bc * 2 > total) next[v] = best;
    }
    labels.set(next);
  }
}
majority(base, 3);

/* Connected pieces of one label (with the side split at x = 0). */
function components(labels) {
  const comp = new Int32Array(N).fill(-1), sizes = [], labelOf = [];
  const { offsets, list } = ADJ;
  const stack = [];
  for (let v = 0; v < N; v++) {
    if (comp[v] >= 0 || masked[v]) continue;
    const c = sizes.length, l = labels[v], s = sideOf(v);
    comp[v] = c; stack.push(v);
    let size = 0;
    while (stack.length) {
      const u = stack.pop(); size++;
      for (let o = offsets[u]; o < offsets[u + 1]; o++) {
        const w = list[o];
        if (comp[w] >= 0 || masked[w] || labels[w] !== l) continue;
        if (l >= 0 && l < NS && sideOf(w) !== s) continue;
        comp[w] = c; stack.push(w);
      }
    }
    sizes.push(size); labelOf.push(l);
  }
  return { comp, sizes, labelOf };
}
/* Relabel the vertices of the chosen components from their neighbours,
   growing inward from the rim so a filled hole takes its surroundings. */
function absorb(labels, drop) {
  const { offsets, list } = ADJ;
  let pending = [];
  for (let v = 0; v < N; v++) if (drop[v]) pending.push(v);
  for (let round = 0; round < 400 && pending.length; round++) {
    const still = [], set = [];
    for (const v of pending) {
      const tally = new Map();
      for (let o = offsets[v]; o < offsets[v + 1]; o++) {
        const w = list[o];
        if (drop[w] || masked[w]) continue;
        tally.set(labels[w], (tally.get(labels[w]) || 0) + 1);
      }
      if (!tally.size) { still.push(v); continue; }
      let best = -1, bc = 0;
      for (const [l, c] of tally) if (c > bc) { bc = c; best = l; }
      set.push([v, best]);
    }
    for (const [v, l] of set) { labels[v] = l; drop[v] = 0; }
    pending = still;
  }
}
function tidy(labels) {
  const { comp, sizes, labelOf } = components(labels);
  const largest = new Map();
  sizes.forEach((s, c) => {
    const key = labelOf[c] + ":" + (labelOf[c] >= 0 && labelOf[c] < NS ? "s" : "");
    largest.set(key, Math.max(largest.get(key) || 0, s));
  });
  const drop = new Uint8Array(N);
  let dropped = 0;
  for (let v = 0; v < N; v++) {
    if (masked[v]) continue;
    const c = comp[v], l = labelOf[c], s = sizes[c];
    let kill = false;
    if (l < 0 || l === OTHER) kill = s <= MAX_HOLE;                 // small unlabelled / unlisted patch
    else kill = s < MIN_ISLAND || s < 0.03 * largest.get(l + ":s"); // speckle or stray island
    if (kill) { drop[v] = 1; dropped++; }
  }
  absorb(labels, drop);
  return dropped;
}
for (let i = 0; i < 3; i++) stamp(`  tidy pass ${i + 1}: relabelled ${tidy(base)} vertices`);
stamp(`  straightening borders: ${smoothBorders(base, 1.2)} vertices changed (mean edge ${meanEdge.toFixed(2)} cm)`);
tidy(base);

/* ---- snap borders to the sculpt's grooves ----
   Two bellies meet in a valley. Where the projected border runs within a
   couple of centimetres of a concave groove, a marker watershed moves it
   into the groove: each label floods outward from its own interior, lowest
   ground (the most convex) first, and two floods meet at the ridge line of
   concavity, which is the bottom of the valley on the skin. */
if (!ARGS.has("--no-snap")) {
  stamp("snapping borders to grooves");
  snapToGrooves(base, 1.8);
  smoothBorders(base, 0.5);   // the flood leaves ragged edges where there is no groove
  tidy(base);
}

/* ======================================================================== *
   ids, soft borders, along, landmarks
 * ======================================================================== */
const MUSCLES = ["none"];
for (const s of STRUCTURES) MUSCLES.push(`${s.name}.L`, `${s.name}.R`);
const idOf = (s, side) => 1 + s * 2 + side;
const muscle = new Uint8Array(N), muscle2 = new Uint8Array(N), blend = new Uint8Array(N).fill(255), alongOut = new Uint8Array(N);
for (let v = 0; v < N; v++) if (base[v] >= 0 && base[v] < NS && !masked[v]) muscle[v] = idOf(base[v], sideOf(v));

stamp("soft borders");
{
  // distance from each vertex to the nearest border of its own region
  const { offsets, list } = ADJ;
  const seeds = [], other = new Int32Array(N).fill(-1);
  for (let v = 0; v < N; v++) {
    let o2 = -1;
    for (let o = offsets[v]; o < offsets[v + 1]; o++) if (muscle[list[o]] !== muscle[v]) { o2 = muscle[list[o]]; break; }
    if (o2 >= 0) { seeds.push(v); other[v] = o2; }
  }
  const src = new Int32Array(N).fill(-1);
  const dist = geodesic(P, ADJ, seeds, null, src, BORDER * 2);
  // geodesic() lets fronts cross regions; keep it inside one region by
  // restarting per label is costly, so accept a crossing front only if it came
  // from a seed of the same label.
  for (let v = 0; v < N; v++) {
    const s = src[v];
    if (s < 0 || !Number.isFinite(dist[v]) || muscle[s] !== muscle[v]) continue;
    const d = dist[v] + 0.25;               // a border lies half an edge beyond its last vertex
    if (d >= BORDER) continue;
    muscle2[v] = other[s];
    blend[v] = Math.round(255 * (0.5 + 0.5 * smoothstep(0, BORDER, d)));
  }
}

stamp("along");
const along = new Float32Array(N).fill(NaN);
for (let v = 0; v < N; v++) {
  if (!muscle[v]) continue;
  const inst = hitInst[v] >= 0 ? INST[hitInst[v]] : null;
  if (inst && inst.s === base[v] && Number.isFinite(hitAlong[v])) along[v] = hitAlong[v];
}
// the two derived structures are rescaled over their own extent
for (const s of [BT]) {
  for (const side of [0, 1]) {
    let lo = Infinity, hi = -Infinity;
    for (let v = 0; v < N; v++) if (base[v] === s && sideOf(v) === side && Number.isFinite(hitAlong[v])) { lo = Math.min(lo, hitAlong[v]); hi = Math.max(hi, hitAlong[v]); }
    for (let v = 0; v < N; v++) if (base[v] === s && sideOf(v) === side) along[v] = Number.isFinite(hitAlong[v]) ? (hitAlong[v] - lo) / Math.max(hi - lo, 1e-3) : NaN;
  }
}
smoothWithin(along, muscle, 12);
// pool the two sides, as for the labels
for (let v = 0; v < N; v++) {
  const m = MIR[v];
  if (m <= v || !muscle[v] || !muscle[m] || ((muscle[v] - 1) >> 1) !== ((muscle[m] - 1) >> 1)) continue;
  const a = (along[v] + along[m]) / 2;
  along[v] = a; along[m] = a;
}
for (let v = 0; v < N; v++) alongOut[v] = muscle[v] ? Math.round(255 * clamp(Number.isFinite(along[v]) ? along[v] : 0.5)) : 0;

stamp("landmarks");
const landmarks = {};
{
  const prominence = new Float32Array(N);
  const SP = fm.smoothPosition;
  for (let v = 0; v < N; v++) {
    prominence[v] = (P[v * 3] - SP[v * 3]) * NRM[v * 3] + (P[v * 3 + 1] - SP[v * 3 + 1]) * NRM[v * 3 + 1] + (P[v * 3 + 2] - SP[v * 3 + 2]) * NRM[v * 3 + 2];
  }
  const prom = smoothWithin(prominence, muscle, 6, true);
  for (let id = 1; id < MUSCLES.length; id++) {
    const verts = [];
    for (let v = 0; v < N; v++) if (muscle[v] === id) verts.push(v);
    if (verts.length < 10) continue;
    const core = verts.filter((v) => blend[v] >= 200);
    const pool = core.length > 20 ? core : verts;
    const byAlong = [...pool].sort((a, b) => along[a] - along[b]);
    const k = Math.max(3, Math.round(byAlong.length * 0.02));
    const nearestTo = (set, c) => set.reduce((b, v) => {
      const d = (P[v * 3] - c[0]) ** 2 + (P[v * 3 + 1] - c[1]) ** 2 + (P[v * 3 + 2] - c[2]) ** 2;
      return d < b.d ? { v, d } : b;
    }, { v: set[0], d: Infinity }).v;
    const mean = (set) => { const c = [0, 0, 0]; for (const v of set) for (let j = 0; j < 3; j++) c[j] += P[v * 3 + j]; return c.map((x) => x / set.length); };
    const lowEnd = byAlong.slice(0, k), highEnd = byAlong.slice(-k);
    let peak = pool[0];
    for (const v of pool) if (prom[v] > prom[peak]) peak = v;
    landmarks[MUSCLES[id]] = {
      origin: nearestTo(lowEnd, mean(lowEnd)),
      insertion: nearestTo(highEnd, mean(highEnd)),
      peak,
      centroid: nearestTo(verts, mean(verts)),
    };
  }
  // the right side is the mirror image of the left wherever the map is
  for (const name of Object.keys(landmarks)) {
    if (!name.endsWith(".L")) continue;
    const right = name.slice(0, -2) + ".R", idR = MUSCLES.indexOf(right);
    const mirrored = Object.fromEntries(Object.entries(landmarks[name]).map(([k, v]) => [k, MIR[v]]));
    if (Object.values(mirrored).every((v) => muscle[v] === idR)) landmarks[right] = mirrored;
  }
}

/* ======================================================================== *
   6. write
 * ======================================================================== */
const groups = Object.fromEntries(STRUCTURES.map((s) => [s.name, s.group]));
const blocks = [
  { name: "muscle", type: "B", offset: 0, length: N },
  { name: "muscle2", type: "B", offset: N, length: N },
  { name: "blend", type: "B", offset: 2 * N, length: N },
  { name: "along", type: "B", offset: 3 * N, length: N },
];
const header = {
  vertices: N,
  source: "Z-Anatomy / BodyParts3D, projected onto the Mike Freeman sculpt",
  license: "CC BY-SA 4.0 / CC BY-SA 2.1 Japan (atlas); the sculpt is CC0",
  muscles: MUSCLES, groups, landmarks, blocks,
};
fs.writeFileSync(path.join(MODELS, "freeman-anatomy.json"), JSON.stringify(header));
fs.writeFileSync(path.join(MODELS, "freeman-anatomy.bin"), Buffer.concat([muscle, muscle2, blend, alongOut].map((a) => Buffer.from(a.buffer))));
stamp("wrote public/models/freeman-anatomy.{json,bin}");

// ---- report ----
{
  let body = 0, lab = 0;
  for (let v = 0; v < N; v++) {
    if (masked[v] || ctx.head[v] > 0.5) continue;
    body++; if (muscle[v]) lab++;
  }
  console.log(`  trunk + limb vertices labelled: ${(100 * lab / body).toFixed(1)}%`);
  const counts = new Map();
  for (let v = 0; v < N; v++) if (muscle[v]) counts.set(muscle[v], (counts.get(muscle[v]) || 0) + 1);
  const rows = [];
  for (let s = 0; s < NS; s++) {
    const l = counts.get(idOf(s, 0)) || 0, r = counts.get(idOf(s, 1)) || 0;
    rows.push(`${STRUCTURES[s].name}:${l}/${r}`);
  }
  console.log("  L/R vertex counts: " + rows.join("  "));
}

// ---- review renders ----
if (["--shots", "--overlay", "--atlas", "--focus"].some((a) => ARGS.has(a))) review();

/* ======================================================================== *
   helpers
 * ======================================================================== */
/* Flip a mesh's triangles in place if its signed volume is negative
   (normals facing inward). Returns true if it flipped. */
function orientOutward(p, t) {
  let cx = 0, cy = 0, cz = 0;
  const nv = p.length / 3;
  for (let i = 0; i < p.length; i += 3) { cx += p[i]; cy += p[i + 1]; cz += p[i + 2]; }
  cx /= nv; cy /= nv; cz /= nv;
  let vol = 0;
  for (let k = 0; k < t.length; k += 3) {
    const a = t[k] * 3, b = t[k + 1] * 3, c = t[k + 2] * 3;
    const ax = p[a] - cx, ay = p[a + 1] - cy, az = p[a + 2] - cz;
    const bx = p[b] - cx, by = p[b + 1] - cy, bz = p[b + 2] - cz;
    const qx = p[c] - cx, qy = p[c + 1] - cy, qz = p[c + 2] - cz;
    vol += ax * (by * qz - bz * qy) + ay * (bz * qx - bx * qz) + az * (bx * qy - by * qx);
  }
  if (vol >= 0) return false;
  for (let k = 0; k < t.length; k += 3) { const s = t[k + 1]; t[k + 1] = t[k + 2]; t[k + 2] = s; }
  return true;
}

function vertexNormals(pos, tri) {
  const n = new Float32Array(pos.length);
  for (let t = 0; t < tri.length; t += 3) {
    const a = tri[t] * 3, b = tri[t + 1] * 3, c = tri[t + 2] * 3;
    const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2];
    const vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    for (const o of [a, b, c]) { n[o] += nx; n[o + 1] += ny; n[o + 2] += nz; }
  }
  for (let i = 0; i < n.length; i += 3) {
    const l = Math.hypot(n[i], n[i + 1], n[i + 2]) || 1;
    n[i] /= l; n[i + 1] /= l; n[i + 2] /= l;
  }
  return n;
}

function PointHash(pts, cell) {
  const map = new Map();
  const key = (x, y, z) => (x + 512) * 1048576 + (y + 512) * 1024 + (z + 512);
  for (let i = 0; i < pts.length / 3; i++) {
    const k = key(Math.floor(pts[i * 3] / cell), Math.floor(pts[i * 3 + 1] / cell), Math.floor(pts[i * 3 + 2] / cell));
    let b = map.get(k);
    if (!b) map.set(k, (b = []));
    b.push(i);
  }
  this.near = (x, y, z, r, cb) => {
    const r2 = r * r;
    const x0 = Math.floor((x - r) / cell), x1 = Math.floor((x + r) / cell);
    const y0 = Math.floor((y - r) / cell), y1 = Math.floor((y + r) / cell);
    const z0 = Math.floor((z - r) / cell), z1 = Math.floor((z + r) / cell);
    for (let a = x0; a <= x1; a++) for (let b = y0; b <= y1; b++) for (let c = z0; c <= z1; c++) {
      const bucket = map.get(key(a, b, c));
      if (!bucket) continue;
      for (const i of bucket) {
        const d2 = (pts[i * 3] - x) ** 2 + (pts[i * 3 + 1] - y) ** 2 + (pts[i * 3 + 2] - z) ** 2;
        if (d2 <= r2) cb(i, d2);
      }
    }
  };
  /* k nearest within maxR; fills squared distances and indices, returns count */
  this.knn = (x, y, z, k, maxR, outD, outI) => {
    let found = 0;
    for (let r = cell; r <= maxR + cell; r += cell) {
      found = 0;
      let worst = 0;
      outD.fill(Infinity);
      this.near(x, y, z, r, (i, d2) => {
        if (found < k) { outD[found] = d2; outI[found] = i; found++; if (d2 > outD[worst] || found === 1) worst = outD.indexOf(Math.max(...outD.subarray(0, found))); return; }
        if (d2 < outD[worst]) {
          outD[worst] = d2; outI[worst] = i;
          let w = 0; for (let j = 1; j < k; j++) if (outD[j] > outD[w]) w = j; worst = w;
        }
      });
      if (found >= k) return found;
    }
    return found;
  };
}

function nearestDistance(pos, p) {
  let best = Infinity;
  for (let i = 0; i < pos.length; i += 3) best = Math.min(best, (pos[i] - p[0]) ** 2 + (pos[i + 1] - p[1]) ** 2 + (pos[i + 2] - p[2]) ** 2);
  return Math.sqrt(best);
}
function minDist2(pts, x, y, z) {
  let best = Infinity;
  for (let i = 0; i < pts.length; i += 3) {
    const d = (pts[i] - x) ** 2 + (pts[i + 1] - y) ** 2 + (pts[i + 2] - z) ** 2;
    if (d < best) best = d;
  }
  return best;
}
function subsample(pts, max) {
  const n = pts.length / 3;
  if (n <= max) return Float32Array.from(pts);
  const out = new Float32Array(max * 3), step = n / max;
  for (let i = 0; i < max; i++) { const j = Math.floor(i * step); out.set(pts.slice(j * 3, j * 3 + 3), i * 3); }
  return out;
}

/* A closed box from o to e, `half` wide in x, `thick` deep in z (either side). */
function boxMesh(o, e, half, thick) {
  const ax = norm(sub(e, o)), side = norm(cross(ax, [0, 0, 1])), up = cross(side, ax);
  const pad = mul(ax, 0.4);
  const a0 = sub(o, pad), a1 = add(e, pad);
  const pos = [];
  for (const end of [a0, a1]) for (const s of [-half, half]) for (const u of [-thick, thick]) pos.push(...add(add(end, mul(side, s)), mul(up, u)));
  const q = [[0, 1, 3, 2], [4, 6, 7, 5], [0, 4, 5, 1], [2, 3, 7, 6], [0, 2, 6, 4], [1, 5, 7, 3]];
  const tri = [];
  for (const f of q) tri.push(f[0], f[1], f[2], f[0], f[2], f[3]);
  return { pos: Float32Array.from(pos), tri: Uint32Array.from(tri) };
}

/* Laplacian smoothing of a field inside each label; NaN entries are filled
   from their neighbours, known ones keep part of their measured value. */
function smoothWithin(field, labels, passes, keepAll = false) {
  const { offsets, list } = ADJ;
  let cur = Float32Array.from(field);
  const known = new Uint8Array(N);
  for (let v = 0; v < N; v++) known[v] = Number.isFinite(cur[v]) ? 1 : 0;
  for (let p = 0; p < passes + 40; p++) {
    const next = cur.slice();
    let changed = 0;
    for (let v = 0; v < N; v++) {
      if (!labels[v] && !keepAll) continue;
      let s = 0, c = 0;
      for (let o = offsets[v]; o < offsets[v + 1]; o++) {
        const w = list[o];
        if (labels[w] !== labels[v] || !Number.isFinite(cur[w])) continue;
        s += cur[w]; c++;
      }
      if (!c) continue;
      if (!Number.isFinite(cur[v])) { next[v] = s / c; changed++; }
      else if (p < passes) next[v] = known[v] ? cur[v] * 0.5 + (s / c) * 0.5 : cur[v] * 0.3 + (s / c) * 0.7;
    }
    cur = next;
    if (p >= passes && !changed) break;
  }
  field.set(cur);
  return field;
}

/* Marker watershed on concavity inside a band around every border. */
function snapToGrooves(labels, band) {
  const { offsets, list } = ADJ;
  // mean-curvature-like concavity: how far the vertex sits below its neighbours' mean, along the normal
  const conc = new Float32Array(N);
  for (let v = 0; v < N; v++) {
    let x = 0, y = 0, z = 0, c = 0;
    for (let o = offsets[v]; o < offsets[v + 1]; o++) { const w = list[o]; x += P[w * 3]; y += P[w * 3 + 1]; z += P[w * 3 + 2]; c++; }
    if (!c) continue;
    x = x / c - P[v * 3]; y = y / c - P[v * 3 + 1]; z = z / c - P[v * 3 + 2];
    conc[v] = x * ctx.normal[v * 3] + y * ctx.normal[v * 3 + 1] + z * ctx.normal[v * 3 + 2];
  }
  // a groove is a few millimetres wide: measure it at that scale, not per edge
  const all = new Uint8Array(N).fill(1);
  smoothWithin(conc, all, 6, true);
  // the band: vertices within `band` cm of a border between two labelled regions
  const seeds = [];
  for (let v = 0; v < N; v++) {
    if (labels[v] < 0 || labels[v] >= NS || masked[v]) continue;
    for (let o = offsets[v]; o < offsets[v + 1]; o++) {
      const w = list[o];
      if (labels[w] !== labels[v] && labels[w] >= 0 && labels[w] < NS) { seeds.push(v); break; }
    }
  }
  const dist = geodesic(P, ADJ, seeds, (v) => !masked[v] && labels[v] >= 0 && labels[v] < NS, null, band);
  const inBand = new Uint8Array(N);
  let count = 0;
  for (let v = 0; v < N; v++) if (dist[v] <= band) { inBand[v] = 1; count++; }
  // flood from the band's rim (the markers), lowest concavity first; a small
  // penalty for leaving one's own original ground keeps a border where it is
  // unless there really is a groove to move to
  const orig = labels.slice();
  const heap = [];
  const push = (key, v, l) => { heap.push([key, v, l]); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
  const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let i = 0; for (;;) { let c = 2 * i + 1; if (c >= heap.length) break; if (c + 1 < heap.length && heap[c + 1][0] < heap[c][0]) c++; if (heap[c][0] >= heap[i][0]) break; [heap[c], heap[i]] = [heap[i], heap[c]]; i = c; } } return top; };
  const done = new Uint8Array(N);
  for (let v = 0; v < N; v++) {
    if (!inBand[v]) continue;
    labels[v] = -2;  // undecided
  }
  for (let v = 0; v < N; v++) {
    if (inBand[v] || labels[v] < 0 || labels[v] >= NS) continue;
    for (let o = offsets[v]; o < offsets[v + 1]; o++) if (inBand[list[o]]) { push(conc[list[o]], list[o], labels[v]); }
  }
  const PENALTY = 0.03;   // cm of concavity it costs to cross onto the other label's ground
  while (heap.length) {
    const [, v, l] = pop();
    if (done[v]) continue;
    done[v] = 1;
    labels[v] = l;
    for (let o = offsets[v]; o < offsets[v + 1]; o++) {
      const w = list[o];
      if (!inBand[w] || done[w]) continue;
      push(conc[w] + (orig[w] !== l ? PENALTY : 0), w, l);
    }
  }
  for (let v = 0; v < N; v++) if (labels[v] === -2) labels[v] = orig[v];
  let moved = 0;
  for (let v = 0; v < N; v++) if (labels[v] !== orig[v]) moved++;
  stamp(`  ${count} vertices in the border band, ${moved} moved into grooves`);
}

/* Straighten borders: every label's indicator is diffused over the mesh (a
   Gaussian about `sigma` cm wide) and each vertex takes the strongest. Saw
   teeth from the ray grid and the atlas triangulation straighten out and
   specks shrink away; a sparse top-4 list per vertex keeps it cheap.
   Returns the number of vertices that changed label. */
var meanEdge;   // var: hoisted, the main code above calls smoothBorders first
function smoothBorders(labels, sigma) {
  const { offsets, list } = ADJ;
  if (!meanEdge) {
    let s = 0, c = 0;
    for (let v = 0; v < N; v += 5) {
      if (masked[v]) continue;
      for (let o = offsets[v]; o < offsets[v + 1]; o++) {
        const w = list[o];
        s += Math.hypot(P[w * 3] - P[v * 3], P[w * 3 + 1] - P[v * 3 + 1], P[w * 3 + 2] - P[v * 3 + 2]);
        c++;
      }
    }
    meanEdge = s / c;
  }
  const passes = Math.max(1, Math.round(2 * (sigma / meanEdge) ** 2));
  const K = 4, EMPTY = -32768;
  let L = new Int16Array(N * K).fill(EMPTY), W = new Float32Array(N * K);
  let L2 = new Int16Array(N * K), W2 = new Float32Array(N * K);
  // start from both sides' evidence: a vertex and its mirror share one list,
  // always built in the same order, so a mirror pair can never split a tie
  for (let v = 0; v < N; v++) {
    if (masked[v]) continue;
    const m = MIR[v], pair = !masked[m];
    const a = pair ? Math.min(v, m) : v, b = pair ? Math.max(v, m) : v;
    L[v * K] = labels[a]; W[v * K] = 1;
    if (labels[b] !== labels[a]) { W[v * K] = 0.5; L[v * K + 1] = labels[b]; W[v * K + 1] = 0.5; }
  }
  const tl = new Int16Array(512), tw = new Float32Array(512);
  let n = 0;
  const gather = (u, wgt) => {
    for (let k = 0; k < K; k++) {
      const l = L[u * K + k];
      if (l === EMPTY) break;
      let j = 0;
      while (j < n && tl[j] !== l) j++;
      if (j === n) { tl[n] = l; tw[n] = 0; n++; }
      tw[j] += W[u * K + k] * wgt;
    }
  };
  const around = (u, share) => {   // u and its unmasked ring, `share` of the new state
    let deg = 0;
    for (let o = offsets[u]; o < offsets[u + 1]; o++) if (!masked[list[o]]) deg++;
    gather(u, deg ? share * 0.5 : share);
    for (let o = offsets[u]; o < offsets[u + 1]; o++) if (!masked[list[o]]) gather(list[o], (share * 0.5) / deg);
  };
  for (let p = 0; p < passes; p++) {
    L2.fill(EMPTY); W2.fill(0);
    for (let v = 0; v < N; v++) {
      if (masked[v]) continue;
      const m = MIR[v], pair = m !== v && !masked[m];
      if (pair && m < v && MIR[m] === v) {   // the mirror already computed this very state
        for (let k = 0; k < K; k++) { L2[v * K + k] = L2[m * K + k]; W2[v * K + k] = W2[m * K + k]; }
        continue;
      }
      n = 0;
      if (pair) { around(Math.min(v, m), 0.5); around(Math.max(v, m), 0.5); } else around(v, 1);
      let sum = 0;
      const top = Math.min(K, n);
      for (let k = 0; k < top; k++) {
        let b = k;
        for (let j = k + 1; j < n; j++) if (tw[j] > tw[b]) b = j;
        const ql = tl[k], qw = tw[k];
        tl[k] = tl[b]; tw[k] = tw[b]; tl[b] = ql; tw[b] = qw;
        sum += tw[k];
      }
      for (let k = 0; k < top; k++) { L2[v * K + k] = tl[k]; W2[v * K + k] = tw[k] / sum; }
    }
    [L, L2] = [L2, L];
    [W, W2] = [W2, W];
  }
  let changed = 0;
  for (let v = 0; v < N; v++) {
    if (masked[v]) continue;
    let best = L[v * K], bw = -1;
    for (let k = 0; k < K; k++) {
      const l = L[v * K + k];
      if (l === EMPTY) break;
      const w = W[v * K + k] * PERSIST_OF[l + 1];
      if (w > bw) { bw = w; best = l; }
    }
    if (best !== labels[v]) { labels[v] = best; changed++; }
  }
  return changed;
}

function palette(i) {
  const h = (i * 0.61803398875) % 1, s = 0.55 + 0.35 * ((i * 7) % 3) / 2, val = i % 2 ? 0.78 : 0.97;
  const k = Math.floor(h * 6), f = h * 6 - k, p = val * (1 - s), q = val * (1 - f * s), t = val * (1 - (1 - f) * s);
  const rgb = [[val, t, p], [q, val, p], [p, val, t], [p, q, val], [t, p, val], [val, p, q]][k % 6];
  return rgb.map((c) => Math.round(c * 255));
}

function review() {
  fs.mkdirSync(SHOTS, { recursive: true });
  const grey = [200, 196, 188];
  const colS = new Uint8Array(N * 4), colA = new Uint8Array(N * 4);
  const ramp = (t) => {
    const stops = [[0.0, [40, 60, 200]], [0.35, [40, 190, 220]], [0.6, [120, 210, 80]], [0.8, [245, 200, 40]], [1.0, [220, 40, 30]]];
    for (let i = 1; i < stops.length; i++) if (t <= stops[i][0]) {
      const [t0, a] = stops[i - 1], [t1, b] = stops[i], f = (t - t0) / (t1 - t0);
      return a.map((x, k) => Math.round(x + (b[k] - x) * f));
    }
    return stops[stops.length - 1][1];
  };
  for (let v = 0; v < N; v++) {
    const id = muscle[v];
    let c = id ? palette((id - 1) >> 1) : grey;
    const shade = id ? 0.5 + 0.5 * smoothstep(0.5, 1.0, blend[v] / 255) : 1;
    c = c.map((x) => Math.round(x * shade));
    colS.set([...c, 255], v * 4);
    colA.set([...(id ? ramp(alongOut[v] / 255) : grey), 255], v * 4);
  }
  fs.writeFileSync(path.join(BUILD, "review-structure.rgba"), colS);
  fs.writeFileSync(path.join(BUILD, "review-along.rgba"), colA);
  const views = [
    { name: "front", az: 0, el: 0 }, { name: "back", az: 180, el: 0 },
    { name: "side", az: 90, el: 0 }, { name: "threequarter", az: 38, el: 8 },
    { name: "back-threequarter", az: 218, el: 8 },
  ].map((v) => ({ ...v, target: [0, 92, 0], scale: 188 }));
  const overlays = [];
  if (ARGS.has("--overlay")) {
    const pick = INST.filter((i) => i.s >= 0 && STRUCTURES[i.s].group !== "bone");
    const verts = [], tris = [];
    const warped = new Map();
    for (const inst of pick) for (const part of inst.parts) {
      let w = warped.get(part.o);
      if (!w) { w = warpObject(part.o, STRUCTURES[inst.s].regions); warped.set(part.o, w); }
      const b = verts.length / 3;
      for (const x of w) verts.push(x);
      for (const t of part.tri) tris.push(t + b);
    }
    fs.writeFileSync(path.join(BUILD, "review-atlas.f32"), Buffer.from(Float32Array.from(verts).buffer));
    fs.writeFileSync(path.join(BUILD, "review-atlas.u32"), Buffer.from(Uint32Array.from(tris).buffer));
    overlays.push({ verts: path.join(BUILD, "review-atlas.f32"), tris: path.join(BUILD, "review-atlas.u32"), color: [200, 60, 60] });
  }
  const run = (name, colors, extra = {}) => {
    const cfg = {
      freeman: { json: path.join(MODELS, "freeman.json"), bin: path.join(MODELS, "freeman.bin") },
      colors, size: [900, 1300], views, out: path.join(SHOTS, name), ...extra,
    };
    const file = path.join(BUILD, `${name}.render.json`);
    fs.writeFileSync(file, JSON.stringify(cfg));
    execFileSync(BLENDER, ["-b", "--factory-startup", "--python",
      path.join(ROOT, "tools", "blender", "render_freeman_anatomy.py"), "--", file], { stdio: "ignore" });
  };
  if (ARGS.has("--shots")) {
    stamp("rendering review shots");
    run("anatomy-map", path.join(BUILD, "review-structure.rgba"));
    run("anatomy-map-along", path.join(BUILD, "review-along.rgba"));
  }
  if (ARGS.has("--overlay")) run("anatomy-overlay", null, { overlays, xray: 0.45 });
  if (ARGS.has("--focus")) {
    // A few structures at a time in fixed colours (red, orange, yellow, blue,
    // magenta, green, cyan, purple, white, brown, in list order); the rest of
    // the map light grey, unlabelled skin darker.
    stamp("rendering focus sets");
    const FOCUS = {
      back: ["trapezius_upper", "trapezius_middle", "trapezius_lower", "latissimus", "teres_major",
        "infraspinatus", "erector_spinae", "deltoid_posterior", "rhomboid", "gluteus_medius"],
      torso: ["pectoralis_clavicular", "pectoralis_sternal", "serratus", "rectus_abdominis", "deltoid_anterior",
        "external_oblique", "bone_sternum", "sternocleidomastoid", "bone_clavicle", "latissimus"],
      arm: ["biceps_long", "biceps_short", "brachialis", "triceps_long", "triceps_lateral",
        "brachioradialis", "triceps_medial", "forearm_flexors", "forearm_extensors", "deltoid_lateral"],
      thigh: ["rectus_femoris", "vastus_lateralis", "vastus_medialis", "adductors", "tensor_fasciae_latae",
        "sartorius", "gracilis", "biceps_femoris", "semitendinosus", "semimembranosus"],
      calf: ["gastrocnemius_medial", "gastrocnemius_lateral", "soleus", "tibialis_anterior", "patellar_tendon",
        "fibularis", "bone_tibia", "bone_patella", "calcaneal_tendon", "gluteus_maximus"],
    };
    const COLORS = [[230, 40, 40], [245, 140, 20], [240, 220, 30], [40, 90, 230], [220, 40, 200],
      [40, 180, 60], [40, 210, 220], [130, 60, 200], [250, 250, 250], [140, 80, 40]];
    const whole = (list) => list.map((v) => ({ ...v, target: [0, 92, 0], scale: 188 }));
    const VIEWS = {
      back: whole([{ name: "back", az: 180, el: 0 }, { name: "back-threequarter", az: 218, el: 8 }, { name: "side", az: 90, el: 0 }]),
      torso: whole([{ name: "front", az: 0, el: 0 }, { name: "threequarter", az: 38, el: 8 }, { name: "side", az: 90, el: 0 }]),
      arm: [{ name: "front", az: 0, el: 0 }, { name: "back", az: 180, el: 0 }, { name: "top", az: 90, el: 45 }, { name: "under", az: 20, el: -35 }]
        .map((v) => ({ ...v, target: [31, 127, 0], scale: 60 })),
      thigh: whole([{ name: "front", az: 0, el: 0 }, { name: "back", az: 180, el: 0 }, { name: "side", az: 90, el: 0 }, { name: "medial", az: -60, el: 0 }]),
      calf: whole([{ name: "front", az: 0, el: 0 }, { name: "back", az: 180, el: 0 }, { name: "side", az: 90, el: 0 }]),
    };
    let atlasFiles = null;
    for (const [set, names] of Object.entries(FOCUS)) {
      const col = new Uint8Array(N * 4);
      for (let v = 0; v < N; v++) {
        const id = muscle[v];
        const k = id ? names.indexOf(STRUCTURES[(id - 1) >> 1].name) : -1;
        let c = k >= 0 ? COLORS[k] : id ? grey : [150, 146, 140];
        if (k >= 0) { const shade = 0.55 + 0.45 * smoothstep(0.5, 1.0, blend[v] / 255); c = c.map((x) => Math.round(x * shade)); }
        col.set([...c, 255], v * 4);
      }
      const file = path.join(BUILD, `review-focus-${set}.rgba`);
      fs.writeFileSync(file, col);
      run(`anatomy-focus-${set}`, file, { views: VIEWS[set] });
      if (ARGS.has("--atlas")) {
        // the same colours on the warped dissection, to tell registration from casting
        if (!atlasFiles) {
          const keep = [];
          for (let t = 0; t < WI.length; t++) if (!INST[WI[t]].transparent) keep.push(t);
          const tris = new Uint32Array(keep.length * 3);
          keep.forEach((t, i) => { tris[i * 3] = WT[t * 3]; tris[i * 3 + 1] = WT[t * 3 + 1]; tris[i * 3 + 2] = WT[t * 3 + 2]; });
          atlasFiles = ["f32", "u32"].map((ext) => path.join(BUILD, `review-focus-atlas.${ext}`));
          fs.writeFileSync(atlasFiles[0], Buffer.from(WV.buffer, WV.byteOffset, WV.byteLength));
          fs.writeFileSync(atlasFiles[1], Buffer.from(tris.buffer));
        }
        const acol = new Uint8Array((WV.length / 3) * 4).fill(255);
        for (let t = 0; t < WI.length; t++) {
          const inst = INST[WI[t]];
          const k = inst.s >= 0 ? names.indexOf(STRUCTURES[inst.s].name) : -1;
          const c = k >= 0 ? COLORS[k] : [110, 108, 104];
          for (let j = 0; j < 3; j++) { const o = WT[t * 3 + j] * 4; acol[o] = c[0]; acol[o + 1] = c[1]; acol[o + 2] = c[2]; }
        }
        const af = path.join(BUILD, `review-focus-atlas-${set}.rgba`);
        fs.writeFileSync(af, acol);
        run(`anatomy-atlas-focus-${set}`, null,
          { overlays: [{ verts: atlasFiles[0], tris: atlasFiles[1], colors: af }], hide_freeman: true, views: VIEWS[set] });
      }
    }
  }
  if (ARGS.has("--atlas")) {
    // The warped dissection itself, coloured like the map, without the sculpt:
    // where it disagrees with the map, the casting rules are at fault; where
    // it is itself wrong, the registration is.
    stamp("rendering the warped dissection");
    const keep = [];
    for (let t = 0; t < WI.length; t++) if (!INST[WI[t]].transparent) keep.push(t);
    const tris = new Uint32Array(keep.length * 3);
    keep.forEach((t, i) => { tris[i * 3] = WT[t * 3]; tris[i * 3 + 1] = WT[t * 3 + 1]; tris[i * 3 + 2] = WT[t * 3 + 2]; });
    const col = new Uint8Array((WV.length / 3) * 4).fill(255);
    for (let t = 0; t < WI.length; t++) {
      const inst = INST[WI[t]];
      const c = inst.s >= 0 ? palette(inst.s) : [110, 108, 104];
      for (let k = 0; k < 3; k++) { const o = WT[t * 3 + k] * 4; col[o] = c[0]; col[o + 1] = c[1]; col[o + 2] = c[2]; }
    }
    const files = ["f32", "u32", "rgba"].map((ext) => path.join(BUILD, `review-atlas-all.${ext}`));
    fs.writeFileSync(files[0], Buffer.from(WV.buffer, WV.byteOffset, WV.byteLength));
    fs.writeFileSync(files[1], Buffer.from(tris.buffer));
    fs.writeFileSync(files[2], Buffer.from(col.buffer));
    run("anatomy-atlas", null, { overlays: [{ verts: files[0], tris: files[1], colors: files[2] }], hide_freeman: true });
  }
  stamp("review images in shots/");
}
