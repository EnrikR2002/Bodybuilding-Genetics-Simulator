/* Corrective anatomy sculpt.

   Muscle volume and muscle definition are different shapes. The region
   system is good at the first one: it moves a belly and changes its size.
   Definition lives in the negative space between bellies and in the broad,
   nearly-flat tendon planes at joints.

   These authored fields are built once from the baked muscle memberships,
   then blended like corrective shape keys. Lean/full bodies receive the
   sculpt, fat covers it, and an untrained body retains only a quiet trace. */

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const smoothstep = (a, b, x) => {
  const t = clamp((x - a) / (b - a || 1e-6), 0, 1);
  return t * t * (3 - 2 * t);
};
const gaussian = (d, sigma) => Math.exp(-(d * d) / (2 * sigma * sigma));

export class AnatomyCorrectives {
  constructor(regionField, figure) {
    this.n = regionField.nCage;
    this.normal = regionField.restNormal;
    this.adjOff = regionField.adjOff;
    this.adjIdx = regionField.adjIdx;
    this.basePos = figure.basePos;
    this.byKey = regionField.byKey;
    this.cache = new Map();
    this.maps = {
      upper: new Float32Array(this.n),
      back: new Float32Array(this.n),
      legs: new Float32Array(this.n),
      trunk: new Float32Array(this.n),
    };
    this.current = new Float32Array(this.n);
    this._author();
    this._finishMaps();
  }

  /* Expand a sparse region to cage-wide membership and longitudinal maps. */
  _region(key) {
    if (this.cache.has(key)) return this.cache.get(key);
    const r = this.byKey[key];
    if (!r) return null;
    const w = new Float32Array(this.n);
    const m = new Float32Array(this.n).fill(-10);
    const span = (r.u1 - r.u0) || 1;
    const flip = r.base === 'lat' || r.base === 'glutes';
    for (let i = 0; i < r.idx.length; i++) {
      const v = r.idx[i];
      w[v] = Math.max(w[v], r.w[i]);
      let u = (r.u[i] - r.u0) / span;
      if (flip) u = 1 - u;
      m[v] = u;
    }
    const dense = { w, m };
    this.cache.set(key, dense);
    return dense;
  }

  _add(map, v, depthCm, field) {
    if (field <= 0.001) return;
    /* Several structures meet at shoulders and knees. Cap their sum so
       intersecting correctives cannot drill a pinhole. */
    map[v] = Math.min(0.82, map[v] + depthCm * field);
  }

  _raise(map, v, heightCm, field) {
    if (field <= 0.001) return;
    map[v] = Math.max(-0.62, map[v] - heightCm * field);
  }

  /* A valley shared by two named bellies. Feathering supplies the overlap;
     equal membership locates the anatomical hand-over. */
  _boundary(driver, depthCm, aKey, bKey, width = 0.30) {
    const A = this._region(aKey), B = this._region(bKey);
    if (!A || !B) return;
    const map = this.maps[driver];
    const seed = new Float32Array(this.n);
    for (let v = 0; v < this.n; v++) {
      const a = A.w[v], b = B.w[v];
      const common = Math.min(a, b);
      if (common < 0.025) continue;
      const d = a - b;
      let crosses = false, grad = 0;
      for (let i = this.adjOff[v]; i < this.adjOff[v + 1]; i++) {
        const n = this.adjIdx[i];
        const dn = A.w[n] - B.w[n];
        const edge = Math.abs(d - dn);
        grad = Math.max(grad, edge);
        if (d * dn <= 0 && edge > 0.008 && Math.min(A.w[n], B.w[n]) > 0.012) crosses = true;
      }
      /* Equal weights over a whole overlap patch are not a boundary. Require
         the difference field to have a real gradient, then keep only its zero
         crossing (or the immediately adjacent sample). */
      if ((!crosses && Math.abs(d) > grad * (0.52 + width * 0.35)) || grad < 0.008) continue;
      seed[v] = smoothstep(0.025, 0.30, common) * smoothstep(0.008, 0.11, grad);
    }
    for (let v = 0; v < this.n; v++) {
      const f = seed[v];
      if (f <= 0.001) continue;
      this._add(map, v, depthCm, f);
      /* One quiet neighbour ring survives subdivision as a rounded valley
         rather than a knife incision. */
      for (let i = this.adjOff[v]; i < this.adjOff[v + 1]; i++)
        this._add(map, this.adjIdx[i], depthCm, f * 0.24);
    }
  }

  /* Partition a related set of muscles by strongest membership, then trace
     only mesh edges whose owner changes. This is the robust version of an
     intermuscular seam: wide overlapping masks may be equal across a whole
     patch, but their ownership boundary is always a one-edge contour. */
  _groupBoundary(driver, depthCm, keys) {
    const R = keys.map(k => this._region(k));
    if (R.some(x => !x)) return;
    const owner = new Int16Array(this.n).fill(-1);
    const score = new Float32Array(this.n);
    for (let v = 0; v < this.n; v++) {
      for (let k = 0; k < R.length; k++) {
        if (R[k].w[v] > score[v]) { score[v] = R[k].w[v]; owner[v] = k; }
      }
    }
    const seed = new Float32Array(this.n);
    for (let v = 0; v < this.n; v++) {
      if (owner[v] < 0 || score[v] < 0.08) continue;
      for (let i = this.adjOff[v]; i < this.adjOff[v + 1]; i++) {
        const n = this.adjIdx[i];
        if (owner[n] < 0 || owner[n] === owner[v] || score[n] < 0.08) continue;
        seed[v] = Math.max(seed[v], smoothstep(0.08, 0.62, Math.min(score[v], score[n])));
      }
    }
    const map = this.maps[driver];
    for (let v = 0; v < this.n; v++) {
      const f = seed[v];
      if (f < 0.001) continue;
      this._add(map, v, depthCm, f);
      for (let i = this.adjOff[v]; i < this.adjOff[v + 1]; i++)
        this._add(map, this.adjIdx[i], depthCm, f * 0.18);
    }
  }

  /* A transverse tendinous inscription or the termination of a belly. */
  _cross(driver, depthCm, key, centres, sigma = 0.035, supportPower = 0.65) {
    const R = this._region(key);
    if (!R) return;
    const map = this.maps[driver];
    for (let v = 0; v < this.n; v++) {
      if (R.w[v] < 0.015 || R.m[v] < -1) continue;
      let line = 0;
      for (const c of centres) line = Math.max(line, gaussian(R.m[v] - c, sigma));
      const field = Math.pow(clamp(R.w[v], 0, 1), supportPower) * line;
      this._add(map, v, depthCm, field);
    }
  }

  /* A row of deliberately convex bellies between tendinous inscriptions.
     Stored with the opposite sign so the same corrective channel can contain
     both the block and the hollow surrounding it. */
  _blocks(driver, heightCm, key, centres, sigma = 0.085) {
    const R = this._region(key);
    if (!R) return;
    const map = this.maps[driver];
    for (let v = 0; v < this.n; v++) {
      if (R.w[v] < 0.02 || R.m[v] < -1) continue;
      let belly = 0;
      for (const c of centres) belly = Math.max(belly, gaussian(R.m[v] - c, sigma));
      this._raise(map, v, heightCm, Math.pow(R.w[v], 0.72) * belly);
    }
  }

  /* A centre seam such as the linea alba or spinal furrow. */
  _midline(driver, depthCm, keys, width, m0 = -1, m1 = 2) {
    const records = keys.map(k => this._region(k)).filter(Boolean);
    if (!records.length) return;
    const map = this.maps[driver], P = this.basePos;
    for (let v = 0; v < this.n; v++) {
      let support = 0;
      for (const R of records) {
        if (R.m[v] >= m0 && R.m[v] <= m1) support = Math.max(support, R.w[v]);
      }
      if (support < 0.015) continue;
      const centre = gaussian(P[v * 3], width);
      this._add(map, v, depthCm, Math.pow(support, 0.55) * centre);
    }
  }

  /* A broad tendon is a plane rather than a knife-cut. */
  _plane(driver, depthCm, key, centre, halfWidth) {
    const R = this._region(key);
    if (!R) return;
    const map = this.maps[driver];
    for (let v = 0; v < this.n; v++) {
      const d = Math.abs(R.m[v] - centre);
      if (R.w[v] < 0.015 || d > halfWidth * 1.6) continue;
      const band = 1 - smoothstep(halfWidth * 0.65, halfWidth * 1.6, d);
      this._add(map, v, depthCm, Math.pow(R.w[v], 0.72) * band);
    }
  }

  _both(fn, ...args) {
    for (const side of ['L', 'R']) {
      const sided = v => Array.isArray(v) ? v.map(sided)
        : typeof v === 'string' && v.includes('$') ? v.replace('$', side) : v;
      fn.call(this, ...args.map(sided));
    }
  }

  /* The muscle masks live on the original MakeHuman cage. Their ownership
     edges are necessarily a little stair-stepped, especially around the
     shoulder where only a handful of cage rings describe three delt heads.
     One restrained graph blur turns those steps into a continuous anatomical
     groove while keeping the field narrow enough to survive subdivision. */
  _finishMaps() {
    const tmp = new Float32Array(this.n);
    for (const map of Object.values(this.maps)) {
      for (let pass = 0; pass < 3; pass++) {
        tmp.set(map);
        for (let v = 0; v < this.n; v++) {
          const s = this.adjOff[v], e = this.adjOff[v + 1];
          if (e === s) continue;
          let sum = 0;
          for (let i = s; i < e; i++) sum += map[this.adjIdx[i]];
          tmp[v] = map[v] * 0.64 + (sum / (e - s)) * 0.36;
        }
        map.set(tmp);
      }
    }
  }

  _author() {
    /* Shoulder cap and deltoid/arm notch. Pairing the actual neighbours is
       important here: a five-way ownership partition produced every possible
       border, including diagonal cuts that made the cap look chipped. */
    this._both(this._boundary, 'upper', 0.10, 'deltoid_ant.$', 'deltoid_lat.$');
    this._both(this._boundary, 'upper', 0.11, 'deltoid_lat.$', 'deltoid_post.$');
    this._both(this._boundary, 'upper', 0.24, 'deltoid_lat.$', 'biceps_long.$');
    this._both(this._boundary, 'upper', 0.21, 'deltoid_post.$', 'triceps_lat.$');

    /* Biceps head split, brachialis shelf and triceps horseshoe. These are
       shallow changes of plane, not trenches around every coloured region. */
    this._both(this._boundary, 'upper', 0.10, 'biceps_long.$', 'biceps_short.$');
    this._both(this._boundary, 'upper', 0.15, 'biceps_short.$', 'brachialis.$');
    this._both(this._boundary, 'upper', 0.18, 'biceps_long.$', 'triceps_lat.$');
    this._both(this._boundary, 'upper', 0.13, 'triceps_long.$', 'triceps_lat.$');
    this._both(this._boundary, 'upper', 0.12, 'forearm_flex.$', 'forearm_ext.$');
    this._both(this._plane, 'upper', 0.22, 'biceps_long.$', 0.91, 0.090);
    this._both(this._plane, 'upper', 0.15, 'forearm_flex.$', 0.94, 0.075);

    /* Chest and shoulder girdle. The lower edge is authored rather than left
       as the border of a positive displacement mask. */
    this._both(this._boundary, 'upper', 0.24, 'pec_outer.$', 'deltoid_ant.$');
    this._both(this._boundary, 'upper', 0.09, 'pec_upper.$', 'pec_lower.$');
    this._both(this._cross, 'upper', 0.28, 'pec_lower.$', [0.035], 0.046, 0.48);
    this._midline('upper', 0.34, ['pec_inner.L', 'pec_inner.R'], 0.112, 0.04, 0.96);

    /* Linea alba, semilunaris, four tendinous rows and serratus digitations. */
    this._both(this._blocks, 'trunk', 0.25, 'rectus_abs.$', [0.02, 0.25, 0.49, 0.73, 0.96], 0.060);
    this._midline('trunk', 0.40, ['rectus_abs.L', 'rectus_abs.R'], 0.100, 0.02, 0.98);
    this._both(this._boundary, 'trunk', 0.18, 'rectus_abs.$', 'obliques.$');
    this._both(this._boundary, 'trunk', 0.11, 'obliques.$', 'serratus.$');
    this._both(this._cross, 'trunk', 0.50, 'rectus_abs.$', [0.13, 0.37, 0.61, 0.84], 0.032, 0.58);
    this._both(this._blocks, 'trunk', 0.07, 'serratus.$', [0.29, 0.56, 0.83], 0.058);
    this._both(this._cross, 'trunk', 0.11, 'serratus.$', [0.16, 0.43, 0.70], 0.042, 0.65);

    /* Spinal furrow and planes around the scapula/teres/lat stack. */
    this._midline('back', 0.30, ['erectors.L', 'erectors.R', 'trap_mid.L', 'trap_mid.R'], 0.115, -0.1, 1.1);
    this._both(this._groupBoundary, 'back', 0.16,
      ['trap_mid.$', 'rhomboids.$', 'teres.$', 'lat.$', 'erectors.$']);
    this._both(this._boundary, 'back', 0.13, 'trap_mid.$', 'rhomboids.$');
    this._both(this._boundary, 'back', 0.17, 'rhomboids.$', 'teres.$');
    this._both(this._boundary, 'back', 0.19, 'teres.$', 'lat.$');
    this._both(this._boundary, 'back', 0.15, 'lat.$', 'erectors.$');

    /* Rectus column, lateral sweep, medial teardrop and quad tendon. */
    this._both(this._groupBoundary, 'legs', 0.22,
      ['rectus_fem.$', 'vastus_lat.$', 'vastus_med.$', 'adductors.$', 'hamstrings.$']);
    this._both(this._boundary, 'legs', 0.20, 'rectus_fem.$', 'vastus_lat.$');
    this._both(this._boundary, 'legs', 0.18, 'rectus_fem.$', 'vastus_med.$');
    this._both(this._boundary, 'legs', 0.14, 'vastus_med.$', 'adductors.$');
    this._both(this._boundary, 'legs', 0.13, 'vastus_lat.$', 'hamstrings.$');
    this._both(this._blocks, 'legs', 0.13, 'rectus_fem.$', [0.50], 0.24);
    this._both(this._blocks, 'legs', 0.16, 'vastus_lat.$', [0.52], 0.24);
    this._both(this._blocks, 'legs', 0.18, 'vastus_med.$', [0.65], 0.16);
    this._both(this._plane, 'legs', 0.22, 'rectus_fem.$', 0.94, 0.085);

    /* Gastrocnemius heads, soleus break and Achilles plane. */
    this._both(this._groupBoundary, 'legs', 0.16,
      ['gastroc_med.$', 'gastroc_lat.$', 'soleus.$', 'tibialis.$']);
    this._both(this._boundary, 'legs', 0.18, 'gastroc_med.$', 'gastroc_lat.$');
    this._both(this._boundary, 'legs', 0.13, 'gastroc_med.$', 'soleus.$');
    this._both(this._boundary, 'legs', 0.13, 'gastroc_lat.$', 'soleus.$');
    this._both(this._boundary, 'legs', 0.10, 'soleus.$', 'tibialis.$');
    this._both(this._plane, 'legs', 0.19, 'soleus.$', 0.88, 0.12);
  }

  apply(cage, ctx) {
    const lean = clamp(1.10 - ctx.fat * 3.1, 0, 1);
    const drives = {
      upper: lean * clamp(0.20 + ctx.relief * 0.76, 0, 1.20),
      back: lean * clamp(0.18 + ctx.relief * (0.40 + ctx.back * 0.48), 0, 1.20),
      legs: lean * clamp(0.18 + ctx.legRelief * 0.78, 0, 1.20),
      trunk: ctx.lean * clamp(0.22 + ctx.relief * 0.58, 0, 1.10),
    };
    const N = this.normal;
    const current = this.current;
    current.fill(0);
    for (let v = 0; v < this.n; v++) {
      let cm = 0;
      for (const [name, map] of Object.entries(this.maps)) cm += map[v] * drives[name];
      current[v] = cm;
      if (Math.abs(cm) < 0.002) continue;
      /* A quarter of the sculpt changes the cage and therefore the physical
         cross-section. The remaining detail is applied after subdivision,
         where a narrow tendon line is not averaged back into a smooth tube. */
      const o = v * 3, d = cm * 0.1 * 0.25;
      cage[o] -= N[o] * d;
      cage[o + 1] -= N[o + 1] * d;
      cage[o + 2] -= N[o + 2] * d;
    }
  }
}
