/* ---------------------------------------------------------------------------
   The tape measure.

   Every number in the readout is taken off the actual surface, the way a tape
   is taken off a person: slice the body at the right place, and measure round
   the outside of that slice. A tape cannot dip into the gap between two
   muscles, so the perimeter is the convex hull of the slice, not the raw
   outline — which is why a chest measurement on a lean bodybuilder still comes
   out larger than the sum of his parts.

   Limb girths are sliced square to the bone, not square to the floor, so a
   long femur does not read as a fatter thigh.

   Measurements are taken on an unposed, unflexed copy of the body, so the
   numbers do not jump about when the pose strip is used.
   --------------------------------------------------------------------------- */
import { Vector3 } from 'three';

const PART = { torso: 1, armL: 2, armR: 3, legL: 4, legR: 5, head: 6,
               handL: 7, handR: 8, footL: 9, footR: 10 };

/* Andrew's monotone chain. Points are [x, y] pairs in a flat array. */
function hullPerimeter(pts, n) {
  if (n < 3) return 0;
  const idx = Array.from({ length: n }, (_, i) => i);
  idx.sort((a, b) => (pts[a * 2] - pts[b * 2]) || (pts[a * 2 + 1] - pts[b * 2 + 1]));
  const cross = (o, a, b) =>
    (pts[a * 2] - pts[o * 2]) * (pts[b * 2 + 1] - pts[o * 2 + 1]) -
    (pts[a * 2 + 1] - pts[o * 2 + 1]) * (pts[b * 2] - pts[o * 2]);
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

export class Tape {
  constructor(figure) {
    this.fig = figure;
    this.partId = figure.regions ? figure.regions.bundlePartId : null;
    this._pts = new Float32Array(4096);
    this._v = new Vector3();
    /* A chest measurement slides through eight heights, and each one used to
       walk all nineteen thousand vertices to find the few hundred on the ribs.
       Bucketing by part once turns the whole readout from ten milliseconds
       into well under one. */
    this.buckets = new Map();
    if (this.partId) {
      const counts = new Int32Array(16);
      for (const p of this.partId) counts[p]++;
      const lists = {};
      for (let p = 0; p < 16; p++) if (counts[p]) lists[p] = { a: new Int32Array(counts[p]), n: 0 };
      for (let v = 0; v < this.partId.length; v++) {
        const l = lists[this.partId[v]];
        if (l) l.a[l.n++] = v;
      }
      this._lists = lists;
    }
  }

  /* the vertices belonging to a set of parts, cached per set */
  verts(parts) {
    const key = parts.join(',');
    let out = this.buckets.get(key);
    if (out) return out;
    if (!this._lists) { out = null; }
    else {
      let n = 0;
      for (const p of parts) if (this._lists[p]) n += this._lists[p].n;
      out = new Int32Array(n);
      let o = 0;
      for (const p of parts) {
        const l = this._lists[p];
        if (l) { out.set(l.a.subarray(0, l.n), o); o += l.n; }
      }
    }
    this.buckets.set(key, out);
    return out;
  }

  /* girth of a slice square to `axis`, taken at `origin`, using only vertices
     whose part id is in `parts` */
  girth(cage, parts, origin, axis, halfThickness) {
    const list = this.verts(parts);
    const count = list ? list.length : cage.length / 3;
    /* two axes in the slice plane */
    let up = Math.abs(axis.y) < 0.9 ? new Vector3(0, 1, 0) : new Vector3(1, 0, 0);
    const ex = new Vector3().crossVectors(up, axis).normalize();
    const ey = new Vector3().crossVectors(axis, ex).normalize();
    const pts = this._pts;
    let m = 0;
    for (let i = 0; i < count; i++) {
      const v = list ? list[i] : i;
      const o = v * 3;
      const dx = cage[o] - origin.x, dy = cage[o + 1] - origin.y, dz = cage[o + 2] - origin.z;
      const d = dx * axis.x + dy * axis.y + dz * axis.z;
      if (d < -halfThickness || d > halfThickness) continue;
      if (m * 2 + 1 >= pts.length) break;
      pts[m * 2] = dx * ex.x + dy * ex.y + dz * ex.z;
      pts[m * 2 + 1] = dx * ey.x + dy * ey.y + dz * ey.z;
      m++;
    }
    return hullPerimeter(pts, m);
  }

  /* the widest point across a set of parts, along `axisName` */
  span(cage, parts, yLo, yHi) {
    const list = this.verts(parts);
    const count = list ? list.length : cage.length / 3;
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < count; i++) {
      const v = list ? list[i] : i;
      const o = v * 3;
      const y = cage[o + 1];
      if (y < yLo || y > yHi) continue;
      if (cage[o] < lo) lo = cage[o];
      if (cage[o] > hi) hi = cage[o];
    }
    return hi > lo ? hi - lo : 0;
  }

  extent(cage, parts) {
    const list = this.verts(parts);
    const count = list ? list.length : cage.length / 3;
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < count; i++) {
      const v = list ? list[i] : i;
      const y = cage[v * 3 + 1];
      if (y < lo) lo = y;
      if (y > hi) hi = y;
    }
    return { lo, hi };
  }

  /* the biggest girth found while sliding the slice along a bone */
  maxGirth(cage, parts, a, b, from, to, steps, halfThickness) {
    const axis = new Vector3().subVectors(b, a).normalize();
    const p = new Vector3();
    let best = 0, bestT = from;
    for (let i = 0; i <= steps; i++) {
      const t = from + (to - from) * (i / steps);
      p.copy(a).lerp(b, t);
      const g = this.girth(cage, parts, p, axis, halfThickness);
      if (g > best) { best = g; bestT = t; }
    }
    return { girth: best, t: bestT };
  }

  /* and the smallest, which is how a waist is actually found */
  minGirth(cage, parts, yFrom, yTo, steps, halfThickness) {
    const axis = new Vector3(0, 1, 0);
    const p = new Vector3();
    let best = Infinity, bestY = yFrom;
    for (let i = 0; i <= steps; i++) {
      const y = yFrom + (yTo - yFrom) * (i / steps);
      p.set(0, y, 0);
      const g = this.girth(cage, parts, p, axis, halfThickness);
      if (g > 1 && g < best) { best = g; bestY = y; }
    }
    return { girth: best === Infinity ? 0 : best, y: bestY };
  }

  /* ---------------------------------------------------------------------- */
  measure(cage, skel) {
    const T = [PART.torso], A = [PART.armL], L = [PART.legL];
    /* height is floor to crown, so the feet have to be in the list */
    const all = [PART.torso, PART.armL, PART.armR, PART.legL, PART.legR, PART.head,
                 PART.handL, PART.handR, PART.footL, PART.footR];
    const v = (n, out) => skel.restHead(n, out || new Vector3());
    const vt = (n, out) => skel.restTail(n, out || new Vector3());

    const shoulder = v('upperarm01.L');
    const elbow = v('lowerarm01.L');
    const hip = v('upperleg01.L');
    const knee = v('lowerleg01.L');
    const ankle = vt('lowerleg02.L');
    const neckBase = v('neck01');
    const headTop = vt('head');
    const pelvis = v('spine05');

    const torsoExt = this.extent(cage, T);
    const bodyExt = this.extent(cage, all);

    /* chest: round the widest part of the rib cage, arms excluded */
    const chestY = neckBase.y - (neckBase.y - pelvis.y) * 0.30;
    const chest = this.maxGirth(cage, T,
      new Vector3(0, chestY - 6, 0), new Vector3(0, chestY + 8, 0), 0, 1, 8, 2.2).girth;

    /* waist: the narrowest slice between the bottom rib and the hip bone */
    const waistRes = this.minGirth(cage, T, pelvis.y + 4, chestY - 4, 12, 2.2);

    /* hips: the widest slice across the glutes */
    const hips = this.maxGirth(cage, [PART.torso, PART.legL, PART.legR],
      new Vector3(0, pelvis.y - 4, 0), new Vector3(0, pelvis.y + 6, 0), 0, 1, 6, 2.4).girth;

    const headBase = v('head');
    const neck = this.girth(cage, [PART.head, PART.torso],
      new Vector3(0, neckBase.y + (headBase.y - neckBase.y) * 0.42, 0), new Vector3(0, 1, 0), 1.4);

    const armAxisEnd = vt('lowerarm02.L');
    const arm = this.maxGirth(cage, A, shoulder, elbow, 0.28, 0.72, 8, 1.6);
    const forearm = this.maxGirth(cage, A, elbow, armAxisEnd, 0.10, 0.45, 6, 1.4);
    const wrist = this.girth(cage, A,
      new Vector3().copy(elbow).lerp(armAxisEnd, 0.94),
      new Vector3().subVectors(armAxisEnd, elbow).normalize(), 1.0);

    const thigh = this.maxGirth(cage, L, hip, knee, 0.18, 0.46, 8, 1.8);
    const calf = this.maxGirth(cage, L, knee, ankle, 0.15, 0.50, 8, 1.6);
    const ankleG = this.girth(cage, L,
      new Vector3().copy(knee).lerp(ankle, 0.92),
      new Vector3().subVectors(ankle, knee).normalize(), 1.1);

    const shoulderSpan = this.span(cage, [PART.torso, PART.armL, PART.armR],
      shoulder.y - 6, shoulder.y + 7);
    const ribWidth = this.span(cage, T, chestY - 4, chestY + 4);
    const hipWidth = this.span(cage, [PART.torso], pelvis.y - 2, pelvis.y + 6);

    return {
      height: bodyExt.hi - bodyExt.lo,
      shoulder: shoulderSpan,
      chest, waist: waistRes.girth, waistY: waistRes.y, hips,
      neck, arm: arm.girth, armPeakT: arm.t, forearm: forearm.girth, wrist,
      thigh: thigh.girth, thighPeakT: thigh.t,
      calf: calf.girth, calfPeakT: calf.t, ankle: ankleG,
      ribWidth, hipWidth,
      torso: neckBase.y - pelvis.y,
      armLength: shoulder.distanceTo(elbow) + elbow.distanceTo(armAxisEnd),
      legLength: hip.distanceTo(knee) + knee.distanceTo(ankle),
      taper: waistRes.girth > 1 ? chest / waistRes.girth : 1,
    };
  }
}
