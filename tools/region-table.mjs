/* ---------------------------------------------------------------------------
   Where each muscle sits, written as a bone segment plus a band along it and
   an arc around it.

   `chain`  which bone run the muscle lies on
   `u`      [start, end] along that run — 0 at the proximal joint, 1 at the distal one
   `peak`   where the belly is thickest
   `th`     angle around the bone in degrees: 0 = front, +90 = outside,
            180 = back, -90 = inside (mirrored for the right side)
   `thW`    half-width of that arc
   `ins`    which insertion slider slides the belly along the bone
   `push`   the direction the muscle actually grows, in rest space
            (+x = outward, +y = up, +z = forward; mirrored on the right).
            Without this every muscle grows straight out of the skin, which
            turns the lower edge of the chest into an overhanging shelf.
   `pushMix` how much of `push` to mix in over the surface normal

   These numbers were checked against the debug render, not guessed once —
   see shots/regions-*.png.
   --------------------------------------------------------------------------- */

export const CHAINS = {
  upperarm: { joints: ['upperarm01.L____head', 'upperarm02.L____tail'], sided: true,
              bones: /upperarm|shoulder01|clavicle/ },
  forearm:  { joints: ['lowerarm01.L____head', 'lowerarm02.L____tail'], sided: true,
              bones: /lowerarm|wrist/, transportFrom: 'upperarm' },
  thigh:    { joints: ['upperleg01.L____head', 'upperleg02.L____tail'], sided: true,
              bones: /upperleg|pelvis/ },
  shank:    { joints: ['lowerleg01.L____head', 'lowerleg02.L____tail'], sided: true,
              bones: /lowerleg/, transportFrom: 'thigh' },
  torso:    { joints: ['spine05____head', 'spine04____head', 'spine03____head',
                       'spine02____head', 'spine01____head', 'spine01____tail'],
              sided: false, bones: /spine|breast|clavicle|neck01|pelvis/ },
};

export const REGIONS = [
  /* ---------------- shoulder and upper arm ---------------- */
  { key: 'deltoid_ant',   chain: 'upperarm', u: [-0.16, 0.40], peak: 0.10, th:    2, thW: 46, push: [0.30, 0.16, 1.00], pushMix: 0.45 },
  { key: 'deltoid_lat',   chain: 'upperarm', u: [-0.18, 0.44], peak: 0.13, th:   88, thW: 46, push: [1.00, 0.30, 0.00], pushMix: 0.50 },
  { key: 'deltoid_post',  chain: 'upperarm', u: [-0.14, 0.38], peak: 0.11, th:  176, thW: 48, push: [0.30, 0.16, -1.00], pushMix: 0.45 },

  { key: 'biceps_long',   chain: 'upperarm', u: [0.05, 0.88], peak: 0.46, th:   22, thW: 34, ins: 'bicep' },
  { key: 'biceps_short',  chain: 'upperarm', u: [0.05, 0.88], peak: 0.44, th:  -24, thW: 34, ins: 'bicep' },
  { key: 'brachialis',    chain: 'upperarm', u: [0.46, 0.95], peak: 0.74, th:   54, thW: 30 },
  { key: 'triceps_long',  chain: 'upperarm', u: [-0.02, 0.92], peak: 0.40, th: -152, thW: 40 },
  { key: 'triceps_lat',   chain: 'upperarm', u: [0.10, 0.90], peak: 0.44, th:  140, thW: 36 },

  /* ---------------- forearm ---------------- */
  { key: 'forearm_flex',  chain: 'forearm',  u: [0.00, 0.86], peak: 0.22, th:  -34, thW: 62 },
  { key: 'forearm_ext',   chain: 'forearm',  u: [0.00, 0.86], peak: 0.26, th:  128, thW: 64 },

  /* ---------------- thigh ---------------- */
  { key: 'rectus_fem',    chain: 'thigh',    u: [0.06, 0.94], peak: 0.48, th:    0, thW: 34 },
  { key: 'vastus_lat',    chain: 'thigh',    u: [0.12, 0.90], peak: 0.52, th:   62, thW: 42 },
  { key: 'vastus_med',    chain: 'thigh',    u: [0.52, 0.98], peak: 0.82, th:  -54, thW: 38 },
  { key: 'adductors',     chain: 'thigh',    u: [0.00, 0.82], peak: 0.28, th: -106, thW: 46 },
  { key: 'hamstrings',    chain: 'thigh',    u: [0.04, 0.92], peak: 0.44, th:  180, thW: 62 },

  /* ---------------- calf ---------------- */
  { key: 'gastroc_med',   chain: 'shank',    u: [0.00, 0.64], peak: 0.24, th: -148, thW: 42, ins: 'calf' },
  { key: 'gastroc_lat',   chain: 'shank',    u: [0.00, 0.58], peak: 0.20, th:  148, thW: 40, ins: 'calf' },
  { key: 'soleus',        chain: 'shank',    u: [0.16, 0.88], peak: 0.44, th:  180, thW: 72, ins: 'calf' },
  { key: 'tibialis',      chain: 'shank',    u: [0.04, 0.78], peak: 0.32, th:   42, thW: 40 },

  /* ---------------- torso: front ----------------
     The nipple line sits at u 0.62 and the collarbone at 0.82, so the pec
     lives between them. Pushing it any lower turns the chest into a shelf. */
  { key: 'pec_upper',     chain: 'torso', u: [0.68, 0.88], peak: 0.78, th:  4, thW: 60, side: 1, xr: [0.08, 1.05], push: [0.22, 0.18, 1.00], pushMix: 0.74 },
  { key: 'pec_lower',     chain: 'torso', u: [0.58, 0.74], peak: 0.66, th:  4, thW: 58, side: 1, xr: [0.08, 1.05], push: [0.22, 0.34, 1.00], pushMix: 0.80 },
  { key: 'pec_inner',     chain: 'torso', u: [0.60, 0.86], peak: 0.74, th:  0, thW: 26, side: 1, xr: [0.00, 0.50], push: [0.55, 0.10, 1.00], pushMix: 0.70 },
  { key: 'pec_outer',     chain: 'torso', u: [0.62, 0.86], peak: 0.74, th: 52, thW: 30, side: 1, push: [0.85, 0.14, 0.70], pushMix: 0.62 },
  { key: 'rectus_abs',    chain: 'torso', u: [0.18, 0.58], peak: 0.38, th:  0, thW: 28, side: 1, xr: [0.00, 0.58], feather: 3, push: [0.10, 0.00, 1.00], pushMix: 0.55 },
  { key: 'obliques',      chain: 'torso', u: [0.12, 0.50], peak: 0.30, th: 72, thW: 38, side: 1, push: [1.00, 0.10, 0.35], pushMix: 0.42 },
  { key: 'serratus',      chain: 'torso', u: [0.42, 0.66], peak: 0.54, th: 104, thW: 28, side: 1, feather: 3, push: [1.00, 0.05, 0.25], pushMix: 0.45 },

  /* ---------------- torso: back ---------------- */
  { key: 'lat',           chain: 'torso', u: [0.20, 0.74], peak: 0.52, th: 142, thW: 40, side: 1, ins: 'lat', push: [1.00, -0.10, -0.45], pushMix: 0.55 },
  { key: 'teres',         chain: 'torso', u: [0.60, 0.82], peak: 0.71, th: 146, thW: 30, side: 1, push: [0.80, 0.10, -0.70], pushMix: 0.45 },
  /* The hollow under the arm. On a real back the teres and the top of the lat
     fill it; leave it empty and the arm separates from the torso and the gap
     reads as a hole punched through the body. This one region is exempt from
     the joint-blend damper, because filling here is the whole point. */
  { key: 'axilla',        chain: 'torso', u: [0.66, 0.86], peak: 0.76, th: 112, thW: 36, side: 1, fill: 1, push: [1.00, 0.30, -0.10], pushMix: 0.62, feather: 4 },
  { key: 'trap_upper',    chain: 'torso', u: [0.80, 1.06], peak: 0.94, th: 180, thW: 76, side: 1, ins: 'trap', push: [0.30, 0.80, -0.55], pushMix: 0.50 },
  { key: 'trap_mid',      chain: 'torso', u: [0.58, 0.88], peak: 0.74, th: 180, thW: 48, side: 1, push: [0.20, 0.10, -1.00], pushMix: 0.45 },
  { key: 'rhomboids',     chain: 'torso', u: [0.58, 0.82], peak: 0.70, th: 180, thW: 28, side: 1, push: [0.15, 0.05, -1.00], pushMix: 0.45 },
  { key: 'erectors',      chain: 'torso', u: [0.10, 0.60], peak: 0.34, th: 180, thW: 24, side: 1, push: [0.25, 0.00, -1.00], pushMix: 0.45 },
  { key: 'glutes',        chain: 'torso', u: [-0.16, 0.16], peak: 0.00, th: 180, thW: 66, side: 1, push: [0.22, 0.05, -1.00], pushMix: 0.50 },

  /* ---------------- bone ----------------
     Where the skin lies straight on the skeleton with nothing in between.
     These are narrow ridges, and they are the strongest signal that a body is
     a body: a collarbone, a hip bone, a kneecap, a shin. They appear as the
     fat comes off and disappear as it goes back on, which is exactly what
     happens to a real person, so they are driven by leanness rather than by
     how much muscle there is. */
  { key: 'clavicle_b',    chain: 'torso', u: [0.83, 0.93], peak: 0.88, th:  44, thW: 46, side: 1, bone: 1, push: [0.25, 0.55, 0.80], pushMix: 0.55, feather: 2 },
  { key: 'sternum_b',     chain: 'torso', u: [0.58, 0.86], peak: 0.72, th:   0, thW: 12, side: 1, bone: 1, push: [0.00, 0.10, 1.00], pushMix: 0.70, feather: 2 },
  { key: 'iliac_b',       chain: 'torso', u: [0.13, 0.25], peak: 0.19, th:  62, thW: 26, side: 1, bone: 1, push: [0.85, 0.30, 0.45], pushMix: 0.55, feather: 2 },
  { key: 'scapula_b',     chain: 'torso', u: [0.72, 0.86], peak: 0.79, th: 156, thW: 20, side: 1, bone: 1, push: [0.30, 0.20, -1.00], pushMix: 0.50, feather: 2 },
  { key: 'olecranon_b',   chain: 'upperarm', u: [0.92, 1.06], peak: 0.99, th: 180, thW: 38, bone: 1, feather: 2 },
  { key: 'patella_b',     chain: 'thigh', u: [0.92, 1.04], peak: 0.98, th:   0, thW: 30, bone: 1, feather: 2 },
  { key: 'tibia_b',       chain: 'shank', u: [0.06, 0.88], peak: 0.42, th:  16, thW: 15, bone: 1, feather: 2 },
  { key: 'malleolus_b',   chain: 'shank', u: [0.93, 1.04], peak: 0.99, th:  92, thW: 34, bone: 1, feather: 2 },
  { key: 'achilles_b',    chain: 'shank', u: [0.70, 1.00], peak: 0.88, th: 180, thW: 16, bone: 1, feather: 2 },
];

/* the insertion sliders: how far the belly can slide, and how much its run
   shortens as it moves proximally */
export const INSERTIONS = {
  bicep: { peakLo: 0.60, peakHi: 0.34, runLo: 0.30, runHi: 0.46, endLo: 0.96, endHi: 0.62 },
  lat:   { peakLo: 0.40, peakHi: 0.62, runLo: 0.30, runHi: 0.22, endLo: 0.16, endHi: 0.40 },
  calf:  { peakLo: 0.44, peakHi: 0.16, runLo: 0.32, runHi: 0.20, endLo: 0.88, endHi: 0.50 },
  trap:  { peakLo: 0.78, peakHi: 1.00, runLo: 0.22, runHi: 0.18, endLo: 1.10, endHi: 1.14 },
};
