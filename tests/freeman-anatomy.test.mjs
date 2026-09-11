/* ---------------------------------------------------------------------------
   The projected anatomy map (public/models/freeman-anatomy.*).

   Format checks follow docs/ARCHITECTURE.md ("Anatomy map"); placement checks
   are coarse anatomical facts a wrong registration would break (the biceps
   on the front of the arm, the calf on the back of the leg, and so on).
   Method: docs/ANATOMY_MAP.md. Rebuild with `npm run anatomy:freeman`.
   --------------------------------------------------------------------------- */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { readFreeman } from "../tools/read-freeman.mjs";
import { buildContext } from "../src/freeman/shape/context.js";
import { idsFor } from "../src/freeman/anatomy.js";

const data = readFreeman();
const A = data.anatomy;
const N = data.meta.vertices;
const P = data.position;
const ctx = buildContext(data);
const NRM = ctx.smoothNormal;

const VOCABULARY = [
  "sternocleidomastoid",
  "deltoid_anterior", "deltoid_lateral", "deltoid_posterior",
  "pectoralis_clavicular", "pectoralis_sternal", "serratus",
  "biceps_long", "biceps_short", "biceps_tendon", "brachialis",
  "triceps_long", "triceps_lateral", "triceps_medial", "brachioradialis",
  "forearm_flexors", "forearm_extensors",
  "rectus_abdominis", "external_oblique",
  "trapezius_upper", "trapezius_middle", "trapezius_lower", "latissimus",
  "teres_major", "infraspinatus", "rhomboid", "erector_spinae",
  "gluteus_maximus", "gluteus_medius", "tensor_fasciae_latae",
  "rectus_femoris", "vastus_lateralis", "vastus_medialis", "sartorius",
  "adductors", "gracilis", "biceps_femoris", "semitendinosus",
  "semimembranosus", "patellar_tendon",
  "gastrocnemius_medial", "gastrocnemius_lateral", "soleus",
  "calcaneal_tendon", "tibialis_anterior", "fibularis",
  "bone_clavicle", "bone_acromion", "bone_sternum", "bone_iliac",
  "bone_patella", "bone_tibia",
];
/* Structures a lean trained body shows on the skin; every one must own skin. */
const SKIN_SHAPING = [
  "sternocleidomastoid", "deltoid_anterior", "deltoid_lateral", "deltoid_posterior",
  "pectoralis_clavicular", "pectoralis_sternal", "serratus", "latissimus", "teres_major",
  "infraspinatus", "trapezius_upper", "trapezius_middle", "trapezius_lower",
  "external_oblique", "rectus_abdominis", "biceps_long", "biceps_short", "brachialis",
  "triceps_long", "triceps_lateral", "brachioradialis", "forearm_flexors",
  "forearm_extensors", "gluteus_maximus", "gluteus_medius", "tensor_fasciae_latae",
  "rectus_femoris", "vastus_lateralis", "vastus_medialis", "sartorius", "adductors",
  "biceps_femoris", "semitendinosus", "gastrocnemius_medial", "gastrocnemius_lateral",
  "soleus", "tibialis_anterior", "fibularis", "calcaneal_tendon", "patellar_tendon",
];

const verticesOf = (names, side) => {
  const ids = new Set(names.map((n) => A.idOf[`${n}.${side}`]).filter(Boolean));
  const out = [];
  for (let v = 0; v < N; v++) if (ids.has(A.muscle[v])) out.push(v);
  return out;
};
const bone = (name) => data.meta.bones.find((b) => b.name === name);
/* Position of v along a bone (0 head .. 1 tail) and its offset from the axis. */
function onBone(v, b) {
  const a = b.head, t = b.tail;
  const ax = [t[0] - a[0], t[1] - a[1], t[2] - a[2]];
  const L2 = ax[0] ** 2 + ax[1] ** 2 + ax[2] ** 2;
  const d = [P[v * 3] - a[0], P[v * 3 + 1] - a[1], P[v * 3 + 2] - a[2]];
  const s = (d[0] * ax[0] + d[1] * ax[1] + d[2] * ax[2]) / L2;
  return { s, off: [d[0] - ax[0] * s, d[1] - ax[1] * s, d[2] - ax[2] * s] };
}
function pearson(xs, ys) {
  const n = xs.length, mx = xs.reduce((a, b) => a + b) / n, my = ys.reduce((a, b) => a + b) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) { sxy += (xs[i] - mx) * (ys[i] - my); sxx += (xs[i] - mx) ** 2; syy += (ys[i] - my) ** 2; }
  return sxy / Math.sqrt(sxx * syy);
}
const share = (list, test) => list.filter(test).length / Math.max(1, list.length);

test("anatomy map exists and follows the documented format", () => {
  assert.ok(A, "public/models/freeman-anatomy.{json,bin} must exist (npm run anatomy:freeman)");
  const meta = A.meta;
  assert.equal(meta.vertices, N);
  assert.equal(meta.muscles[0], "none");
  assert.ok(meta.muscles.length <= 256, "ids must fit a Uint8");
  const names = new Set(meta.muscles.slice(1));
  assert.equal(names.size, meta.muscles.length - 1, "no duplicate names");
  for (const s of VOCABULARY) for (const side of ["L", "R"]) assert.ok(names.has(`${s}.${side}`), `${s}.${side} listed`);
  for (const n of names) assert.ok(VOCABULARY.includes(n.replace(/\.[LR]$/, "")) && /\.[LR]$/.test(n), `${n} is vocabulary`);
  for (const s of VOCABULARY) assert.equal(typeof meta.groups[s], "string", `group of ${s}`);
  const want = ["muscle", "muscle2", "blend", "along"];
  assert.deepEqual(meta.blocks.map((b) => b.name), want);
  const bytes = fs.statSync(new URL("../public/models/freeman-anatomy.bin", import.meta.url)).size;
  for (const b of meta.blocks) {
    assert.equal(b.type, "B");
    assert.equal(b.length, N);
    assert.ok(b.offset + b.length <= bytes);
    assert.equal(A[b.name].length, N);
  }
  const top = meta.muscles.length;
  for (let v = 0; v < N; v++) {
    assert.ok(A.muscle[v] < top && A.muscle2[v] < top, "ids in range");
    if (!A.muscle[v]) assert.equal(A.muscle2[v], 0, "no secondary without a primary");
  }
  assert.deepEqual(idsFor(A, ["biceps_long"]), [A.idOf["biceps_long.L"], A.idOf["biceps_long.R"]]);
});

test("the trunk and limbs are labelled; hands, face, feet and genitals are not", () => {
  let body = 0, lab = 0, handLab = 0, hands = 0, face = 0, faceLab = 0;
  for (let v = 0; v < N; v++) {
    const y = P[v * 3 + 1];
    if (ctx.hand[v] > 0.9) { hands++; if (A.muscle[v]) handLab++; continue; }
    if (ctx.head[v] > 0.9 && y > 160) { face++; if (A.muscle[v]) faceLab++; continue; }
    if (ctx.hand[v] > 0.5 || ctx.head[v] > 0.5 || y < 10) continue;
    body++;
    if (A.muscle[v]) lab++;
  }
  assert.ok(lab / body >= 0.7, `labelled ${(100 * lab / body).toFixed(1)}% of trunk + limb vertices`);
  assert.ok(handLab / hands < 0.02, `hand labelled ${(100 * handLab / hands).toFixed(1)}%`);
  assert.ok(faceLab / face < 0.02, `face labelled ${(100 * faceLab / face).toFixed(1)}%`);
  for (const s of SKIN_SHAPING)
    for (const side of ["L", "R"]) assert.ok(verticesOf([s], side).length >= 60, `${s}.${side} owns skin`);
});

test("left and right structures are balanced and sit on their own side", () => {
  for (const s of VOCABULARY) {
    const l = verticesOf([s], "L"), r = verticesOf([s], "R");
    if (l.length + r.length < 200) continue;
    const ratio = Math.abs(l.length - r.length) / Math.max(l.length, r.length);
    assert.ok(ratio <= 0.15, `${s}: ${l.length} L vs ${r.length} R`);
    assert.ok(l.every((v) => P[v * 3] >= 0), `${s}.L on the figure's left (+x)`);
    assert.ok(r.every((v) => P[v * 3] < 0), `${s}.R on the figure's right (-x)`);
  }
});

test("biceps sits on the front of the left upper arm, along runs shoulder → elbow", () => {
  const arm = bone("upperarm.L");
  const bi = verticesOf(["biceps_long", "biceps_short"], "L");
  assert.ok(bi.length > 500);
  // on the upper arm segment, in front of its axis
  assert.ok(share(bi, (v) => { const q = onBone(v, arm); return q.s > -0.1 && q.s < 1.1; }) > 0.95, "on the upper arm");
  assert.ok(share(bi, (v) => onBone(v, arm).off[2] > 0) > 0.9, "in front of the humerus");
  assert.ok(share(bi, (v) => NRM[v * 3 + 2] > 0) > 0.8, "facing forward");
  const xs = [], ys = [];
  for (const v of bi) {
    const q = onBone(v, arm);
    xs.push(q.s * Math.hypot(...arm.tail.map((t, k) => t - arm.head[k]))); ys.push(A.along[v]);
  }
  const r = pearson(xs, ys);
  assert.ok(r > 0.85, `biceps along vs distance from the shoulder: r = ${r.toFixed(3)}`);
  const lm = A.landmarks["biceps_long.L"];
  assert.ok(onBone(lm.origin, arm).s < onBone(lm.insertion, arm).s, "biceps origin above its insertion");
});

test("gastrocnemius is on the back of the lower leg, along runs knee → heel", () => {
  for (const side of ["L", "R"]) {
    const shin = bone(`shin.${side}`);
    const g = verticesOf(["gastrocnemius_medial", "gastrocnemius_lateral"], side);
    assert.ok(g.length > 500);
    assert.ok(share(g, (v) => onBone(v, shin).off[2] < 0) > 0.9, `gastrocnemius.${side} behind the tibia`);
    assert.ok(share(g, (v) => NRM[v * 3 + 2] < 0.2) > 0.85, `gastrocnemius.${side} faces back`);
    const xs = g.map((v) => -P[v * 3 + 1]), ys = g.map((v) => A.along[v]);
    const r = pearson(xs, ys);
    assert.ok(r > 0.8, `gastrocnemius.${side} along vs depth below the knee: r = ${r.toFixed(3)}`);
  }
  const med = verticesOf(["gastrocnemius_medial"], "L"), lat = verticesOf(["gastrocnemius_lateral"], "L");
  const meanX = (list) => list.reduce((a, v) => a + P[v * 3], 0) / list.length;
  assert.ok(meanX(med) < meanX(lat), "medial head is nearer the midline");
});

test("rectus abdominis is at the front midline, along runs pubis → ribs", () => {
  for (const side of ["L", "R"]) {
    const ra = verticesOf(["rectus_abdominis"], side);
    assert.ok(ra.length > 800);
    assert.ok(share(ra, (v) => Math.abs(P[v * 3]) < 13) > 0.95, "near the midline");
    assert.ok(share(ra, (v) => NRM[v * 3 + 2] > 0.4) > 0.9, "facing forward");
    const xs = ra.map((v) => P[v * 3 + 1]), ys = ra.map((v) => A.along[v]);
    assert.ok(pearson(xs, ys) > 0.85, "along rises with height");
  }
});

test("latissimus is on the back and side of the trunk, along runs spine/pelvis → armpit", () => {
  for (const side of ["L", "R"]) {
    const lat = verticesOf(["latissimus"], side);
    assert.ok(lat.length > 1500);
    assert.ok(share(lat, (v) => NRM[v * 3 + 2] < 0.3) > 0.9, "facing back or out");
    assert.ok(share(lat, (v) => P[v * 3 + 2] < 6) > 0.9, "behind the front of the chest");
    const lm = A.landmarks[`latissimus.${side}`];
    const o = lm.origin * 3, i = lm.insertion * 3;
    assert.ok(Math.abs(P[i]) > Math.abs(P[o]), "insertion lateral of the origin");
    assert.ok(P[i + 1] > P[o + 1], "insertion above the origin");
  }
});

test("front-of-body structures face forward, back-of-body ones backward", () => {
  const front = ["pectoralis_sternal", "rectus_femoris", "tibialis_anterior", "vastus_medialis", "deltoid_anterior"];
  const back = ["gluteus_maximus", "trapezius_middle", "infraspinatus", "biceps_femoris", "semitendinosus", "deltoid_posterior"];
  for (const side of ["L", "R"]) {
    for (const s of front) {
      const list = verticesOf([s], side);
      assert.ok(share(list, (v) => NRM[v * 3 + 2] > 0) > 0.75, `${s}.${side} faces forward`);
    }
    for (const s of back) {
      const list = verticesOf([s], side);
      assert.ok(share(list, (v) => NRM[v * 3 + 2] < 0) > 0.75, `${s}.${side} faces back`);
    }
  }
});

test("every landmark is a vertex of its own structure", () => {
  const top = A.meta.muscles.length;
  let checked = 0;
  for (let id = 1; id < top; id++) {
    const name = A.meta.muscles[id];
    const lm = A.landmarks[name];
    let count = 0;
    for (let v = 0; v < N; v++) if (A.muscle[v] === id) count++;
    if (!count) { assert.equal(lm, undefined, `${name} has no vertices, so no landmarks`); continue; }
    assert.ok(lm, `${name} has landmarks`);
    for (const key of ["origin", "insertion", "peak", "centroid"]) {
      const v = lm[key];
      assert.ok(Number.isInteger(v) && v >= 0 && v < N, `${name}.${key} is a vertex index`);
      assert.equal(A.muscle[v], id, `${name}.${key} lies inside ${name}`);
    }
    assert.ok(A.along[lm.origin] < A.along[lm.insertion], `${name}: along rises from origin to insertion`);
    checked++;
  }
  assert.ok(checked >= 90);
});
