/* ---------------------------------------------------------------------------
   The tape measure.

   Every number is taken off the rest surface (unposed, unflexed), so it does
   not jump when the pose changes. A girth is the convex hull of a slice, the
   way a tape bridges the gap between two muscles; limb girths are sliced
   square to the bone. Weight comes from the closed surface's volume and a
   body density that follows the body-fat estimate.

   measure(fig) → plain numbers in centimetres, kilograms and ratios; see
   docs/MEASUREMENTS.md for definitions and sources.
   --------------------------------------------------------------------------- */
import { bodyFatPercent } from "./traits.js";

const LUNG = 1500;   // cm³ of air in the lungs and gut: envelope, not tissue
const IN = 2.54;

/* Andrew's monotone chain; points are [x, y] pairs in a flat array. */
function hullPerimeter(pts, n) {
  if (n < 3) return 0;
  const idx = Array.from({ length: n }, (_, i) => i);
  idx.sort((a, b) => pts[a * 2] - pts[b * 2] || pts[a * 2 + 1] - pts[b * 2 + 1]);
  const cross = (o, a, b) => (pts[a * 2] - pts[o * 2]) * (pts[b * 2 + 1] - pts[o * 2 + 1])
    - (pts[a * 2 + 1] - pts[o * 2 + 1]) * (pts[b * 2] - pts[o * 2]);
  const hull = [];
  for (const i of idx) {
    while (hull.length >= 2 && cross(hull[hull.length - 2], hull[hull.length - 1], i) <= 0) hull.pop();
    hull.push(i);
  }
  const lower = hull.length + 1;
  for (let k = idx.length - 2; k >= 0; k--) {
    const i = idx[k];
    while (hull.length >= lower && cross(hull[hull.length - 2], hull[hull.length - 1], i) <= 0) hull.pop();
    hull.push(i);
  }
  let p = 0;
  for (let i = 0; i < hull.length - 1; i++) {
    const a = hull[i] * 2, b = hull[i + 1] * 2;
    p += Math.hypot(pts[b] - pts[a], pts[b + 1] - pts[a + 1]);
  }
  return p;
}

/* Vertex lists by body part and by structure, once per sculpt. */
function prepare(ctx) {
  if (ctx.__measure) return ctx.__measure;
  const { arm, leg, head, hand, base, n } = ctx;
  const parts = { trunk: [], armL: [], armR: [], legL: [], legR: [], head: [] };
  for (let v = 0; v < n; v++) {
    if (hand[v] > 0.5) continue;
    const left = base[v * 3] > 0;
    if (arm[v] > 0.5) (left ? parts.armL : parts.armR).push(v);
    else if (leg[v] > 0.5) (left ? parts.legL : parts.legR).push(v);
    else if (head[v] > 0.5) parts.head.push(v);
    else parts.trunk.push(v);
  }
  const P = Object.fromEntries(Object.entries(parts).map(([k, l]) => [k, Uint32Array.from(l)]));
  const a = ctx.anatomy, S = {};
  if (a) {
    const inside = (names) => {
      const ids = new Set(names.map((nm) => a.idOf[nm]).filter(Boolean)), out = [];
      for (let v = 0; v < n; v++) if (ids.has(a.muscle[v]) && a.blend[v] > 204) out.push(v);
      return Uint32Array.from(out);
    };
    Object.assign(S, {
      biceps: inside(["biceps_long.L", "biceps_short.L"]),
      triceps: inside(["triceps_long.L"]),
      gastroc: inside(["gastrocnemius_medial.L", "gastrocnemius_lateral.L"]),
      lat: inside(["latissimus.L"]),
      pecL: inside(["pectoralis_sternal.L"]), pecR: inside(["pectoralis_sternal.R"]),
      trap: inside(["trapezius_upper.L"]),
      delt: inside(["deltoid_lateral.L", "deltoid_lateral.R"]),
      vmo: inside(["vastus_medialis.L"]),
      rectus: inside(["rectus_abdominis.L"]),
    });
  }
  return (ctx.__measure = { P, S, pts: new Float32Array(16384) });
}

/* Points of `lists` inside a slab, projected into the slab's plane. */
function girth(M, pos, lists, o, ax, half) {
  const up = Math.abs(ax[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  let ex = [up[1] * ax[2] - up[2] * ax[1], up[2] * ax[0] - up[0] * ax[2], up[0] * ax[1] - up[1] * ax[0]];
  const el = Math.hypot(...ex); ex = ex.map((c) => c / el);
  const ey = [ax[1] * ex[2] - ax[2] * ex[1], ax[2] * ex[0] - ax[0] * ex[2], ax[0] * ex[1] - ax[1] * ex[0]];
  const pts = M.pts;
  let m = 0;
  for (const list of lists)
    for (let i = 0; i < list.length && m * 2 + 1 < pts.length; i++) {
      const v = list[i] * 3;
      const dx = pos[v] - o[0], dy = pos[v + 1] - o[1], dz = pos[v + 2] - o[2];
      const d = dx * ax[0] + dy * ax[1] + dz * ax[2];
      if (d < -half || d > half) continue;
      pts[m * 2] = dx * ex[0] + dy * ex[1] + dz * ex[2];
      pts[m * 2 + 1] = dx * ey[0] + dy * ey[1] + dz * ey[2];
      m++;
    }
  return hullPerimeter(pts, m);
}

/* Vertices of `list` whose rest height lies in [y0, y1]. */
function band(pos, list, y0, y1) {
  const out = [];
  for (const v of list) { const y = pos[v * 3 + 1]; if (y >= y0 && y <= y1) out.push(v); }
  return out;
}

function sweepY(M, pos, lists, y0, y1, steps, half, pick) {
  let best = pick === "max" ? 0 : Infinity, at = y0;
  for (let i = 0; i <= steps; i++) {
    const y = y0 + ((y1 - y0) * i) / steps, g = girth(M, pos, lists, [0, y, 0], [0, 1, 0], half);
    if (g > 1 && (pick === "max" ? g > best : g < best)) { best = g; at = y; }
  }
  return { girth: best === Infinity ? 0 : best, y: at };
}

function sweepBone(M, pos, list, head, tail, t0, t1, steps, half, pick) {
  const ax = [tail.x - head.x, tail.y - head.y, tail.z - head.z], len = Math.hypot(...ax);
  const u = ax.map((c) => c / len);
  let best = pick === "max" ? 0 : Infinity, at = t0;
  for (let i = 0; i <= steps; i++) {
    const t = t0 + ((t1 - t0) * i) / steps;
    const o = [head.x + ax[0] * t, head.y + ax[1] * t, head.z + ax[2] * t];
    const g = girth(M, pos, [list], o, u, half);
    if (g > 1 && (pick === "max" ? g > best : g < best)) { best = g; at = t; }
  }
  return { girth: best === Infinity ? 0 : best, t: at };
}

/* Fraction along a bone (0 head … 1 tail) of every vertex in a list. */
function along(pos, list, head, tail) {
  const ax = [tail.x - head.x, tail.y - head.y, tail.z - head.z], l2 = ax[0] ** 2 + ax[1] ** 2 + ax[2] ** 2;
  return Array.from(list, (v) =>
    ((pos[v * 3] - head.x) * ax[0] + (pos[v * 3 + 1] - head.y) * ax[1] + (pos[v * 3 + 2] - head.z) * ax[2]) / l2);
}
const quantile = (values, q) => {
  if (!values.length) return 0;
  const s = Float64Array.from(values).sort();
  return s[Math.min(s.length - 1, Math.round(q * (s.length - 1)))];
};

/* Published proportion estimates (see docs/MEASUREMENTS.md). Inputs in cm. */
export function mccallum(wrist) {
  const chest = 6.5 * wrist;
  return { chest, waist: 0.7 * chest, hips: 0.85 * chest, neck: 0.37 * chest, arm: 0.36 * chest,
    forearm: 0.29 * chest, thigh: 0.53 * chest, calf: 0.34 * chest };
}
export function caseyButt(heightCm, wristCm, ankleCm, bodyFatPct) {
  const H = heightCm / IN, W = wristCm / IN, A = ankleCm / IN;
  const lbmLb = H ** 1.5 * (Math.sqrt(W) / 22.667 + Math.sqrt(A) / 17.0104) * (bodyFatPct / 224 + 1);
  return {
    leanMass: lbmLb * 0.45359237,
    chest: (1.6817 * W + 1.3759 * A + 0.3314 * H) * IN,
    arm: (1.2033 * W + 0.1236 * H) * IN,
    forearm: (0.9626 * W + 0.0989 * H) * IN,
    neck: (1.1424 * W + 0.1236 * H) * IN,
    thigh: (1.3868 * A + 0.1805 * H) * IN,
    calf: (0.9298 * A + 0.121 * H) * IN,
  };
}

export function measure(fig) {
  const M = prepare(fig.ctx), pos = fig.restPositions, { P, S } = M;
  const j = (name) => fig.joint(name), tail = (name) => fig.tails[fig.boneIndex(name)];
  const shoulder = j("upperarm.L"), chestJ = j("chest"), pelvis = j("pelvis"), abdomen = j("abdomen");

  // volume of the closed surface (divergence theorem), then weight by density
  const I = fig.data.index;
  let vol = 0;
  for (let t = 0; t < I.length; t += 3) {
    const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3;
    vol += pos[a] * (pos[b + 1] * pos[c + 2] - pos[b + 2] * pos[c + 1])
      - pos[a + 1] * (pos[b] * pos[c + 2] - pos[b + 2] * pos[c])
      + pos[a + 2] * (pos[b] * pos[c + 1] - pos[b + 1] * pos[c]);
  }
  vol /= 6;
  const bodyFatPct = bodyFatPercent(fig.state.bodyFat);
  const density = 495 / (bodyFatPct + 450);          // Siri's two-compartment model, g/cm³
  const weight = ((vol - LUNG) * density) / 1000;
  const leanMass = weight * (1 - bodyFatPct / 100);
  const hM = fig.height / 100;

  // horizontal tapes
  const trunk = P.trunk;
  const chestBand = band(pos, trunk, chestJ.y + 1, chestJ.y + 13);
  const chest = sweepY(M, pos, [chestBand], chestJ.y + 3, chestJ.y + 11, 8, 0.9, "max");
  const waistBand = band(pos, trunk, abdomen.y - 8, chestJ.y - 4);
  const waist = sweepY(M, pos, [waistBand], abdomen.y - 6, chestJ.y - 6, 14, 0.9, "min");
  const hipLists = [band(pos, trunk, pelvis.y - 16, pelvis.y + 2), band(pos, P.legL, pelvis.y - 16, pelvis.y + 2),
    band(pos, P.legR, pelvis.y - 16, pelvis.y + 2)];
  const hips = sweepY(M, pos, hipLists, pelvis.y - 12, pelvis.y, 8, 0.9, "max");
  const neckY = (j("neck").y + j("head").y) / 2;
  const neck = girth(M, pos, [band(pos, P.head, neckY - 2, neckY + 2), band(pos, trunk, neckY - 2, neckY + 2)],
    [0, neckY, 0], [0, 1, 0], 0.7);
  // shoulders: the tape over both deltoids, arms at the sides
  const deltoidOnly = (list, side) => {
    const h = j(`upperarm.${side}`), tl = tail(`upperarm.${side}`), ts = along(pos, list, h, tl);
    return list.filter((_, i) => ts[i] < 0.3);
  };
  const shoulderLists = [band(pos, trunk, shoulder.y - 12, shoulder.y), deltoidOnly(P.armL, "L"), deltoidOnly(P.armR, "R")];
  const shoulderGirth = sweepY(M, pos, shoulderLists, shoulder.y - 10, shoulder.y - 2, 8, 0.9, "max").girth;
  let shoulders = 0;
  if (S.delt?.length) for (const v of S.delt) shoulders = Math.max(shoulders, Math.abs(pos[v * 3]));
  shoulders = shoulders ? shoulders * 2 : shoulder.distanceTo(j("upperarm.R")) + 14;

  // limb tapes, square to the bone (left side)
  const arm = sweepBone(M, pos, P.armL, j("upperarm.L"), tail("upperarm.L"), 0.3, 0.75, 9, 0.8, "max");
  const forearm = sweepBone(M, pos, P.armL, j("forearm.L"), tail("forearm.L"), 0.1, 0.45, 7, 0.7, "max");
  const wrist = sweepBone(M, pos, P.armL, j("forearm.L"), tail("forearm.L"), 0.88, 0.99, 6, 0.6, "min");
  const thigh = sweepBone(M, pos, P.legL, j("thigh.L"), tail("thigh.L"), 0.12, 0.42, 8, 0.9, "max");
  const calf = sweepBone(M, pos, P.legL, j("shin.L"), tail("shin.L"), 0.1, 0.5, 9, 0.8, "max");
  const ankle = sweepBone(M, pos, P.legL, j("shin.L"), tail("shin.L"), 0.84, 0.97, 6, 0.6, "min");

  const legLength = j("thigh.L").distanceTo(j("shin.L")) + j("shin.L").distanceTo(tail("shin.L"));
  const torsoLength = j("neck").y - pelvis.y;

  // insertion readouts, measured on the edited surface
  const insertion = {}, anchors = {};
  if (S.biceps?.length) {
    const ts = along(pos, S.biceps, j("upperarm.L"), tail("upperarm.L"));
    const end = quantile(ts, 0.97), len = j("upperarm.L").distanceTo(tail("upperarm.L"));
    insertion.bicepsGap = Math.max(0, (0.97 - end) * len);
    insertion.bicepsBelly = (end - quantile(ts, 0.04)) * len;
    anchors.biceps = S.biceps[ts.indexOf(ts.reduce((a, b) => (Math.abs(b - end) < Math.abs(a - end) ? b : a)))];
  }
  if (S.triceps?.length) {
    const ts = along(pos, S.triceps, j("upperarm.L"), tail("upperarm.L"));
    const end = quantile(ts, 0.85), len = j("upperarm.L").distanceTo(tail("upperarm.L"));
    insertion.tricepsReach = end * 100;
    anchors.triceps = S.triceps[ts.findIndex((t) => Math.abs(t - end) < 0.02)] ?? S.triceps[0];
  }
  if (S.gastroc?.length) {
    const ts = along(pos, S.gastroc, j("shin.L"), tail("shin.L")), len = j("shin.L").distanceTo(tail("shin.L"));
    const t0 = quantile(ts, 0.03), t1 = quantile(ts, 0.97);
    insertion.calfBelly = (t1 - t0) * 100;
    insertion.achilles = Math.max(0, (0.93 - t1) * len);
    anchors.calf = S.gastroc[ts.findIndex((t) => Math.abs(t - t1) < 0.02)] ?? S.gastroc[0];
  }
  if (S.lat?.length) {
    const lows = [];
    for (const v of S.lat) if (Math.abs(pos[v * 3]) > 8) lows.push(pos[v * 3 + 1]);
    insertion.latReach = quantile(lows, 0.05) - waist.y;
    anchors.lat = S.lat.find((v) => Math.abs(pos[v * 3]) > 8 && pos[v * 3 + 1] <= quantile(lows, 0.06)) ?? S.lat[0];
  }
  if (S.pecL?.length && S.pecR?.length) {
    const inner = (list) => {
      let m = Infinity;
      for (const v of list) { const y = pos[v * 3 + 1]; if (y > chestJ.y + 2 && y < chestJ.y + 10) m = Math.min(m, Math.abs(pos[v * 3])); }
      return m === Infinity ? 0 : m;
    };
    insertion.sternalGap = inner(S.pecL) + inner(S.pecR);
    anchors.pec = S.pecL.reduce((a, v) => (Math.abs(pos[v * 3]) < Math.abs(pos[a * 3]) && pos[v * 3 + 1] > chestJ.y + 3 ? v : a), S.pecL[0]);
  }
  if (S.trap?.length) {
    const ys = [];
    for (const v of S.trap) { const x = Math.abs(pos[v * 3]); if (x > 5 && x < 9) ys.push(pos[v * 3 + 1]); }
    insertion.trapRise = quantile(ys, 0.95) - shoulder.y;
    anchors.trap = S.trap.find((v) => { const x = Math.abs(pos[v * 3]); return x > 5 && x < 9 && pos[v * 3 + 1] >= quantile(ys, 0.93); }) ?? S.trap[0];
  }
  if (S.vmo?.length) anchors.vmo = S.vmo[Math.floor(S.vmo.length / 2)];
  if (S.rectus?.length) anchors.abs = S.rectus.reduce((a, v) => (Math.abs(pos[v * 3 + 1] - 116) < Math.abs(pos[a * 3 + 1] - 116) ? v : a), S.rectus[0]);
  if (S.delt?.length) anchors.shoulder = S.delt.reduce((a, v) => (pos[v * 3] > pos[a * 3] ? v : a), S.delt[0]);

  const ideal = { mccallum: mccallum(wrist.girth), caseyButt: caseyButt(fig.height, wrist.girth, ankle.girth, bodyFatPct) };
  return {
    height: fig.height, weight, bodyFatPct, leanMass, ffmi: leanMass / hM ** 2,
    ffmiAdjusted: leanMass / hM ** 2 + 6.1 * (1.8 - hM), volume: vol,
    shoulders, shoulderGirth, chest: chest.girth, waist: waist.girth, waistY: waist.y, hips: hips.girth, neck,
    arm: arm.girth, forearm: forearm.girth, wrist: wrist.girth, thigh: thigh.girth, calf: calf.girth, ankle: ankle.girth,
    legLength, torsoLength,
    ratios: {
      shoulderWaist: shoulderGirth / waist.girth, chestWaist: chest.girth / waist.girth,
      waistHeight: waist.girth / fig.height, waistHip: waist.girth / hips.girth,
      armWrist: arm.girth / wrist.girth, legTorso: legLength / torsoLength,
    },
    ideal, insertion, anchors,
  };
}
