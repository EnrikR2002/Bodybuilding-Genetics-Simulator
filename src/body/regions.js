/* ---------------------------------------------------------------------------
   Insertion points — the thing this whole app exists to show.

   A muscle belly is not a blob on a bone. It starts somewhere, swells, and
   ends in a tendon somewhere else. Genetics decides where those two somewheres
   are, and nothing you do in a gym moves them.

   Each region arrives from the bake with, per vertex: how strongly the vertex
   belongs to the muscle, how far along the bone it sits, and which way the skin
   faces there. A slider slides the belly along that bone and shortens or
   lengthens its run. Raising the biceps insertion pulls the peak toward the
   shoulder AND empties the arm above the elbow, which is exactly the gap you
   see on a high-inserted arm. Lowering it carries the belly down into the joint.

   The subtraction is the important half. Adding a bulge higher up without
   removing the volume lower down would just make a longer arm.
   --------------------------------------------------------------------------- */

import { AnatomyCorrectives } from './anatomy.js';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const smoothstep = (a, b, x) => { const t = clamp((x - a) / (b - a || 1e-6), 0, 1); return t * t * (3 - 2 * t); };

/* Belly shape along a muscle. m runs 0 at the origin to 1 at the insertion. */
function belly(m, peak, run, end) {
  const d = (m - peak) / run;
  if (d * d > 14) return 0;
  let g = Math.exp(-d * d);
  /* the tendon: past `end` there is no muscle left, only cord */
  g *= 1 - smoothstep(end - 0.16, end + 0.03, m);
  /* and nothing pools behind the origin either */
  g *= smoothstep(-0.16, 0.05, m);
  return g;
}

/* How far each slider can slide a belly, per muscle group.
   Slider 0 = high insertion (short belly, long tendon, visible gap).
   Slider 1 = low  insertion (belly runs into the joint). */
const INS_RANGE = {
  bicep: { peak: [0.32, 0.60], run: [0.29, 0.45], end: [0.60, 0.98] },
  lat:   { peak: [0.30, 0.62], run: [0.26, 0.40], end: [0.54, 1.00] },
  calf:  { peak: [0.20, 0.50], run: [0.22, 0.36], end: [0.52, 0.98] },
  trap:  { peak: [0.22, 0.86], run: [0.30, 0.34], end: [0.95, 1.05] },
};

/* Which muscles a size slider feeds, and how much each one grows.
   Values are centimetres of outward push at full relief. */
const BULK = {
  deltoid_ant: 0.90, deltoid_lat: 1.12, deltoid_post: 0.90,
  biceps_long: 1.00, biceps_short: 0.82, brachialis: 0.58,
  triceps_long: 0.98, triceps_lat: 0.84,
  forearm_flex: 0.66, forearm_ext: 0.61,
  pec_upper: 0.64, pec_lower: 0.36, pec_inner: 0.16, pec_outer: 0.28,
  lat: 1.18, teres: 0.68, axilla: 0.72, trap_upper: 0.94, trap_mid: 0.72,
  rhomboids: 0.60, erectors: 1.00, serratus: 0.45,
  rectus_abs: 0.54, obliques: 0.50,
  glutes: 0.88, rectus_fem: 0.82, vastus_lat: 1.00, vastus_med: 0.80,
  adductors: 0.43, hamstrings: 0.84,
  gastroc_med: 0.78, gastroc_lat: 0.64, soleus: 0.56, tibialis: 0.38,
  /* bone ridges are small — a few millimetres is the difference between a
     collarbone you can see and a shoulder that looks upholstered */
  clavicle_b: 0.62, sternum_b: 0.34, iliac_b: 0.46, scapula_b: 0.40,
  olecranon_b: 0.40, patella_b: 0.55, tibia_b: 0.42, malleolus_b: 0.38,
  achilles_b: 0.44,
};

/* which condition slider drives which muscle */
const DRIVER = {
  deltoid_ant: 'upper', deltoid_lat: 'upper', deltoid_post: 'upper',
  biceps_long: 'upper', biceps_short: 'upper', brachialis: 'upper',
  triceps_long: 'upper', triceps_lat: 'upper',
  forearm_flex: 'upper', forearm_ext: 'upper',
  pec_upper: 'upper', pec_lower: 'upper', pec_inner: 'upper', pec_outer: 'upper',
  lat: 'back', teres: 'back', axilla: 'back', trap_upper: 'back', trap_mid: 'back',
  rhomboids: 'back', erectors: 'back', serratus: 'upper',
  rectus_abs: 'abs', obliques: 'abs',
  glutes: 'legs', rectus_fem: 'legs', vastus_lat: 'legs', vastus_med: 'legs',
  adductors: 'legs', hamstrings: 'legs',
  gastroc_med: 'legs', gastroc_lat: 'legs', soleus: 'legs', tibialis: 'legs',
  clavicle_b: 'bone', sternum_b: 'bone', iliac_b: 'bone', scapula_b: 'bone',
  olecranon_b: 'bone', patella_b: 'bone', tibia_b: 'bone', malleolus_b: 'bone',
  achilles_b: 'bone',
};

export class RegionField {
  constructor(bundle, figure) {
    this.h = bundle.header;
    this.figure = figure;
    this.regions = this.h.regions.map(r => ({
      ...r,
      idx: bundle.block(r.idx),
      w: bundle.block(r.w),
      u: bundle.block(r.u),
      dir: bundle.block(r.dir),
    }));
    this.byKey = {};
    for (const r of this.regions) this.byKey[r.key] = r;
    this.debugColor = bundle.block(this.h.debugColor);
    this.restNormal = bundle.block(this.h.restNormal);
    this.adjOff = bundle.block(this.h.adjOff);
    this.adjIdx = bundle.block(this.h.adjIdx);
    this.inBody = bundle.block(this.h.inBody);
    this.bundlePartId = this.h.partId !== undefined ? bundle.block(this.h.partId) : null;
    this.parts = this.h.parts || [];
    this.nCage = this.h.nCage;
    /* scratch: the displacement field, built then smoothed then applied */
    this.disp = new Float32Array(this.nCage * 3);
    this.disp2 = new Float32Array(this.nCage * 3);
    this.anatomy = new AnatomyCorrectives(this, figure);
    /* anchors the callouts hang off, filled in during deform */
    this.anchors = {};
  }

  /* Smooth the displacement over the mesh itself.

     Region borders are arbitrary lines drawn through anatomy; the skin has no
     idea they exist. Without this the edge of a region shows up as a crease —
     a hard shadow under the pec that no real chest has. Three passes over the
     surface removes it without softening the bellies. */
  _relax(passes) {
    const { adjOff, adjIdx, inBody, nCage } = this;
    let a = this.disp, b = this.disp2;
    for (let pass = 0; pass < passes; pass++) {
      b.set(a);
      for (let v = 0; v < nCage; v++) {
        if (!inBody[v]) continue;
        const s = adjOff[v], e = adjOff[v + 1];
        if (e === s) continue;
        let x = 0, y = 0, z = 0;
        for (let i = s; i < e; i++) {
          const o = adjIdx[i] * 3;
          x += a[o]; y += a[o + 1]; z += a[o + 2];
        }
        const n = e - s, o = v * 3;
        b[o]     = a[o]     * 0.42 + (x / n) * 0.58;
        b[o + 1] = a[o + 1] * 0.42 + (y / n) * 0.58;
        b[o + 2] = a[o + 2] * 0.42 + (z / n) * 0.58;
      }
      const t = a; a = b; b = t;
    }
    this.disp = a; this.disp2 = b;
  }

  /* ---------------------------------------------------------------------- *
     Push every region's belly into the cage. Runs on 13k vertices, so it is
     cheap; the subdivision afterwards is what turns these pushes into skin.
   * ---------------------------------------------------------------------- */
  deform(cage, p, ctx) {
    const g = k => (p[k] === undefined ? 0.5 : clamp(p[k], 0, 1));
    const CM = 0.1;                       /* cm -> the decimetres the cage uses */
    const disp = this.disp;
    disp.fill(0);

    const drive = {
      upper: ctx.relief,
      back: ctx.relief * (0.55 + g('backThickness') * 0.75),
      legs: ctx.legRelief,
      abs: clamp(0.30 + ctx.relief * 0.60, 0, 1) * ctx.lean,
      /* bone shows as the cover comes off, and it does not care how much
         muscle is on top of it */
      bone: ctx.bone,
    };

    const insSlider = {
      bicep: g('bicepInsertion'),
      lat: g('latInsertion'),
      calf: g('calfInsertion'),
      trap: g('trapHeight'),
    };
    const peakiness = g('bicepPeak');
    const pecGap = g('pecGap');
    const stagger = g('abStagger');

    for (const R of this.regions) {
      const bulk = BULK[R.base] || 0;
      const amt = (drive[DRIVER[R.base]] ?? ctx.relief) * bulk;
      if (amt <= 0.0005 && !R.ins) continue;

      const span = (R.u1 - R.u0) || 1;
      /* muscles whose tendon end is at the low end of the chain run backwards */
      const flip = R.base === 'lat' || R.base === 'glutes';

      let cur = null, neutral = null;
      if (R.ins) {
        const range = INS_RANGE[R.ins];
        const s = insSlider[R.ins];
        let run = lerp(range.run[0], range.run[1], s);
        let peak = lerp(range.peak[0], range.peak[1], s);
        if (R.base.startsWith('biceps')) run *= lerp(1.22, 0.74, peakiness);
        cur = { peak, run, end: lerp(range.end[0], range.end[1], s) };
        neutral = {
          peak: lerp(range.peak[0], range.peak[1], 0.5),
          run: lerp(range.run[0], range.run[1], 0.5),
          end: lerp(range.end[0], range.end[1], 0.5),
        };
      }

      /* a peaked biceps is a taller, shorter belly; a flat one is longer */
      const peakGain = R.base.startsWith('biceps') ? (peakiness - 0.5) * 0.9 : 0;

      /* pec attachment: a wide sternal gap means the inner edge pulls away
         from the midline and the outer edge picks the volume up */
      let gapGain = 0;
      if (R.base === 'pec_inner') gapGain = -(pecGap - 0.35) * 1.55;
      else if (R.base === 'pec_outer') gapGain = (pecGap - 0.35) * 0.75;

      const { idx, w, u, dir } = R;
      const n = idx.length;
      for (let i = 0; i < n; i++) {
        const wi = w[i];
        let m = (u[i] - R.u0) / span;
        if (flip) m = 1 - m;
        m = clamp(m, -0.2, 1.2);

        let d = 0;
        /* base volume for this muscle at the current size */
        const shape = R.ins ? belly(m, cur.peak, cur.run, cur.end)
                            : bellyStatic(m, (R.peak - R.u0) / span, flip);
        d += amt * shape;

        /* the insertion move itself: add where the belly went, take away
           where it no longer is */
        if (R.ins) {
          const base = belly(m, neutral.peak, neutral.run, neutral.end);
          d += (drive[DRIVER[R.base]] ?? ctx.relief) * bulk * 1.15 * (shape - base);
          d += peakGain * amt * shape;
        }
        if (gapGain) d += gapGain * amt * shape;

        /* ab rows: only ever visible when lean, and the left and right rows
           rarely line up — that offset is the ab-insertion slider */
        if (R.base === 'rectus_abs') {
          const phase = R.side === 'L' ? (stagger - 0.5) * 0.34 : -(stagger - 0.5) * 0.34;
          const rows = Math.cos((m + phase) * Math.PI * 7.0);
          d += rows * 0.64 * drive.abs * smoothstep(0.04, 0.26, m) * (1 - smoothstep(0.74, 0.98, m));
        }

        if (d === 0) continue;
        const s = d * wi * CM;
        const v = idx[i] * 3, o = i * 3;
        disp[v] += dir[o] * s;
        disp[v + 1] += dir[o + 1] * s;
        disp[v + 2] += dir[o + 2] * s;
      }
    }

    this._relax(1);
    const out = this.disp;
    for (let i = 0; i < out.length; i++) cage[i] += out[i];

    this.anatomy.apply(cage, ctx);
    /* Named corrective forms now carry the anatomical definition. Keep the
       global unsharp pass quiet so it does not promote base-mesh noise. */
    this.sharpen(cage, ctx.definition * 0.16);
  }

  /* ---------------------------------------------------------------------- *
     Definition.

     Body fat blurs a physique; being lean and full sharpens it. Those are the
     same axis in opposite directions, so they are the same operation with the
     sign flipped: blend toward a smoothed copy of yourself, or away from it.

     Blending away is what puts a real trench between a pec and a front delt,
     a line down the middle of a quad, and the split between the two heads of
     a calf. Nothing is added — the shape was already in the sculpt; this only
     decides how much of it survives the layer on top.
   * ---------------------------------------------------------------------- */
  sharpen(cage, amount) {
    if (!amount || amount < 0.01) return;
    const { adjOff, adjIdx, inBody, nCage } = this;
    const sm = this.disp2;
    sm.set(cage);
    /* two light passes: enough to separate muscle-scale detail from the
       overall body shape, not enough to eat the shape itself */
    for (let pass = 0; pass < 2; pass++) {
      const src = pass === 0 ? cage : sm;
      for (let v = 0; v < nCage; v++) {
        const s = adjOff[v], e = adjOff[v + 1];
        if (!inBody[v] || e === s) continue;
        let x = 0, y = 0, z = 0;
        for (let i = s; i < e; i++) {
          const o = adjIdx[i] * 3;
          x += src[o]; y += src[o + 1]; z += src[o + 2];
        }
        const n = e - s, o = v * 3;
        sm[o] = x / n; sm[o + 1] = y / n; sm[o + 2] = z / n;
      }
    }
    for (let v = 0; v < nCage; v++) {
      if (!inBody[v]) continue;
      const o = v * 3;
      cage[o]     += (cage[o]     - sm[o])     * amount;
      cage[o + 1] += (cage[o + 1] - sm[o + 1]) * amount;
      cage[o + 2] += (cage[o + 2] - sm[o + 2]) * amount;
    }
  }

  /* Where a muscle's thickest point currently sits, in cage space — used to
     hang the leader-line callouts off the right bit of anatomy. */
  peakVertex(key) {
    const R = this.byKey[key];
    if (!R) return -1;
    let best = -1, bw = -1;
    for (let i = 0; i < R.idx.length; i++) if (R.w[i] > bw) { bw = R.w[i]; best = R.idx[i]; }
    return best;
  }

  /* the vertex nearest a given position along a muscle, 0 = origin */
  vertexAt(key, m) {
    const R = this.byKey[key];
    if (!R) return -1;
    const span = (R.u1 - R.u0) || 1;
    const flip = R.base === 'lat' || R.base === 'glutes';
    let best = -1, bd = 1e9;
    for (let i = 0; i < R.idx.length; i++) {
      let mm = (R.u[i] - R.u0) / span;
      if (flip) mm = 1 - mm;
      const d = Math.abs(mm - m) - R.w[i] * 0.25;
      if (d < bd) { bd = d; best = R.idx[i]; }
    }
    return best;
  }
}

/* muscles with no insertion slider still need a belly shape so that adding
   size fills the middle of the muscle rather than smearing it evenly */
function bellyStatic(m, peak, flip) {
  const p = flip ? 1 - clamp(peak, 0, 1) : clamp(peak, 0, 1);
  const d = (m - p) / 0.44;
  if (d * d > 14) return 0;
  return Math.exp(-d * d) * smoothstep(-0.18, 0.06, m) * (1 - smoothstep(0.90, 1.14, m));
}
