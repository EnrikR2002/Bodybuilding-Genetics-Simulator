/* ---------------------------------------------------------------------------
   Slider -> sculpt.

   Each of the eighteen sliders is turned into weights on the CC0 MakeHuman
   morph targets. The seven insertion sliders are the exception: no sculpted
   target exists for "where the biceps belly sits along the humerus", so those
   are handled in regions.js instead.

   The 0.5 mark on a slider means "leave it alone". Below it pulls the -decr
   sculpt, above it pulls the -incr sculpt.
   --------------------------------------------------------------------------- */
import { triWeights, addPair } from './morph.js';

const LR = ['l', 'r'];
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const bi = v => (clamp(v, 0, 1) - 0.5) * 2;               /* 0..1 -> -1..1 */

/* Prefer a real endpoint sculpt whenever both halves of the artist contract
   are installed.  Requiring the pair prevents one end of a slider from using
   authored anatomy while the other silently falls back to a generated bulge. */
function addAuthoredTrait(M, key, value) {
  const low = `correctives/${key}-0`;
  const high = `correctives/${key}-1`;
  if (!M.has?.(low) || !M.has?.(high)) return false;
  const signed = bi(value);
  if (signed < 0) M.add(low, -signed);
  else if (signed > 0) M.add(high, signed);
  return true;
}

export function applyParams(M, p) {
  const g = k => (p[k] === undefined ? 0.5 : clamp(p[k], 0, 1));
  const authored = {};
  for (const key of ['bicepInsertion', 'bicepPeak', 'latInsertion', 'pecGap',
                     'abStagger', 'calfInsertion', 'trapHeight'])
    authored[key] = addAuthoredTrait(M, key, g(key));

  /* ---- body composition: the nine-way muscle x weight sculpt blend ----- */
  /* MakeHuman's max-muscle-max-weight sculpt is a strongman: a barrel with no
     waist. Capping both axes short of the top keeps the sculpt athletic and
     leaves the last of the size to the muscle map, which shapes rather than
     inflates. */
  const muscleAxis = clamp(g('mass') * 0.52 + g('legMass') * 0.20 + g('backThickness') * 0.06, 0, 0.78);
  const weightAxis = clamp(0.26 + g('bodyFat') * 0.60, 0, 0.86);
  const mw = triWeights(muscleAxis), ww = triWeights(weightAxis);
  const MN = ['minmuscle', 'averagemuscle', 'maxmuscle'];
  const WN = ['minweight', 'averageweight', 'maxweight'];
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++) {
      const w = mw[i] * ww[j];
      if (w > 1e-4) M.add(`macrodetails/universal-male-young-${MN[i]}-${WN[j]}`, w);
    }

  /* Overall height rides on the limb and torso sliders, so a long-limbed
     figure is genuinely taller rather than just differently proportioned. */
  /* The limb-length targets already change height on their own, so the macro
     only nudges it. Without this restraint the extremes reach four foot eight
     and seven foot one, which is a different app. */
  const heightAxis = clamp(0.5 + (g('legLength') - 0.5) * 0.16 + (g('torsoLength') - 0.5) * 0.08, 0, 1);
  const hh = bi(heightAxis);
  if (hh > 0) M.add('macrodetails/height/male-young-averagemuscle-averageweight-maxheight', hh);
  else if (hh < 0) M.add('macrodetails/height/male-young-averagemuscle-averageweight-minheight', -hh);

  /* a touch of "ideal proportions" keeps the neutral figure looking like a
     trained athlete rather than an average scan */
  M.add('macrodetails/proportions/male-young-averagemuscle-averageweight-idealproportions', 0.45);

  /* ================= SKELETON — given ================= */
  const clav = bi(g('clavicle'));
  addPair(M, 'measure/measure-shoulder-dist', clav, 1.15);
  addPair(M, 'measure/measure-frontchest-dist', clav, 0.55);
  for (const s of LR) addPair(M, `armslegs/${s}-upperarm-shoulder-muscle`, clav, 0.20);

  const rib = bi(g('ribcage'));
  addPair(M, 'measure/measure-bust-circ', rib, 0.85);
  addPair(M, 'measure/measure-underbust-circ', rib, 0.80);
  addPair(M, 'torso/torso-scale-depth', rib, 0.34);

  const hip = bi(g('hipWidth'));
  addPair(M, 'measure/measure-hips-circ', hip, 0.90);
  addPair(M, 'hip/hip-scale-horiz', hip, 0.70);

  const torso = bi(g('torsoLength'));
  addPair(M, 'measure/measure-napetowaist-dist', torso, 0.46);
  addPair(M, 'measure/measure-waisttohip-dist', torso, 0.26);
  addPair(M, 'torso/torso-scale-vert', torso, 0.18);

  const arm = bi(g('armLength'));
  addPair(M, 'measure/measure-upperarm-length', arm, 1.0);
  addPair(M, 'measure/measure-lowerarm-length', arm, 1.0);
  for (const s of LR) {
    addPair(M, `armslegs/${s}-upperarm-scale-vert`, arm, 0.35);
    addPair(M, `armslegs/${s}-lowerarm-scale-vert`, arm, 0.35);
  }

  const leg = bi(g('legLength'));
  addPair(M, 'measure/measure-upperleg-height', leg, 0.34);
  addPair(M, 'measure/measure-lowerleg-height', leg, 0.34);
  for (const s of LR) {
    addPair(M, `armslegs/${s}-upperleg-scale-vert`, leg, 0.13);
    addPair(M, `armslegs/${s}-lowerleg-scale-vert`, leg, 0.13);
  }

  /* Joints are the one place a physique cannot fake anything: wrist and ankle
     girth is pure skeleton and it sets how thick everything above it reads. */
  const bone = bi(g('boneThickness'));
  addPair(M, 'measure/measure-wrist-circ', bone, 1.0);
  addPair(M, 'measure/measure-ankle-circ', bone, 1.0);
  addPair(M, 'measure/measure-knee-circ', bone, 0.55);
  for (const s of LR) {
    addPair(M, `armslegs/${s}-hand-scale`, bone, 0.45);
    addPair(M, `armslegs/${s}-foot-scale`, bone, 0.40);
  }

  /* ================= CONDITION — earned ================= */
  const mass = g('mass');
  const massS = (mass - 0.35) * 1.55;                 /* untrained sits below zero */
  for (const s of LR) {
    addPair(M, `armslegs/${s}-upperarm-muscle`, massS, 1.0);
    addPair(M, `armslegs/${s}-lowerarm-muscle`, massS, 0.85);
    addPair(M, `armslegs/${s}-upperarm-shoulder-muscle`, massS, 1.0);
  }
  addPair(M, 'measure/measure-upperarm-circ', massS, 0.70);
  addPair(M, 'torso/torso-muscle-pectoral', massS, 0.35);
  /* Traps grow with mass; the neck itself should not expand at the same rate. */
  addPair(M, 'measure/measure-neck-circ', massS, 0.18);
  addPair(M, 'pelvis/pelvis-tone', massS, 0.35);

  const legMass = g('legMass');
  const legS = (legMass - 0.35) * 1.55;
  for (const s of LR) {
    addPair(M, `armslegs/${s}-upperleg-muscle`, legS, 1.0);
    addPair(M, `armslegs/${s}-lowerleg-muscle`, legS, 0.72);
  }
  addPair(M, 'measure/measure-thigh-circ', legS, 0.40);
  addPair(M, 'measure/measure-calf-circ', legS, 0.36);
  addPair(M, 'buttocks/buttocks-volume', legS, 0.55);

  const back = g('backThickness');
  const backS = (back - 0.35) * 1.55;
  addPair(M, 'torso/torso-muscle-dorsi', backS, 1.0);
  addPair(M, 'torso/torso-scale-depth', backS, 0.20);

  /* ---- body fat ---- */
  const fat = g('bodyFat');
  /* A topology-compatible relief authored from the separated Z-Anatomy back
     muscles. It describes actual atlas borders rather than guessing a row of
     generic ellipsoids. Fat softens those borders; muscularity and back
     development make the underlying planes readable. */
  if (M.has?.('correctives/anatomy-back')) {
    const atlasBack = clamp(1.08 - fat * 2.8, 0, 1)
                    * clamp(0.20 + mass * 0.90, 0, 1)
                    * clamp(0.40 + back * 0.70, 0, 1);
    M.add('correctives/anatomy-back', atlasBack);
  }
  const fatS = (fat - 0.18) * 1.35;
  for (const s of LR) {
    addPair(M, `armslegs/${s}-upperarm-fat`, fatS, 0.85);
    addPair(M, `armslegs/${s}-lowerarm-fat`, fatS, 0.55);
    addPair(M, `armslegs/${s}-upperleg-fat`, fatS, 0.95);
    addPair(M, `armslegs/${s}-lowerleg-fat`, fatS, 0.45);
  }
  /* the waist carries fat first and loses it last */
  addPair(M, 'measure/measure-waist-circ', fatS, 1.25);
  addPair(M, 'stomach/stomach-pregnant', Math.max(0, fatS), 0.72);
  addPair(M, 'stomach/stomach-tone', -fatS, 0.55);
  addPair(M, 'neck/neck-scale-depth', Math.max(0, fatS), 0.35);

  /* abs are only ever visible when the cover comes off */
  const lean = clamp(1 - fat * 2.4, 0, 1);
  addPair(M, 'stomach/stomach-tone', lean * 0.55, 1.0);

  /* ---- keep the taper ----
     Rib cage, back thickness and upper-body mass all widen the chest, and the
     macro sculpts drag the waist along with them. Left alone, every slider at
     the top turns the torso into a rectangle. Taking the waist back down by a
     share of whatever widened the chest means the figure gets bigger without
     ever losing its shape. */
  const widened = Math.max(0, rib) * 0.80 + Math.max(0, backS) * 0.45
                + Math.max(0, massS) * 0.40 + muscleAxis * 0.22;
  addPair(M, 'measure/measure-waist-circ', -widened, 0.62);
  addPair(M, 'measure/measure-underbust-circ', widened, 0.16);

  /* ================= POSE-DRIVEN SHAPE ================= */
  /* Poses do not only rotate bones. A lat spread genuinely widens the back,
     a vacuum genuinely empties the waist. Those go through the same sculpts. */
  const flare = clamp(p.latFlare || 0, 0, 1);
  const chestUp = clamp(p.chestUp || 0, 0, 1);
  const vacuum = clamp(p.vacuum || 0, 0, 1);
  const flex = clamp(p.flex === undefined ? 0.3 : p.flex, 0, 1);

  /* The stock dorsi target expands the whole lower back. It is useful as a
     fallback flare, but would refill the exposed lumbar interval sculpted for
     a high insertion. Authored endpoints keep a restrained contraction dose. */
  const genericFlare = authored.latInsertion ? 0.24 : 1;
  M.add('torso/torso-muscle-dorsi-incr', flare * (0.35 + back * 0.45) * genericFlare);
  M.add('measure/measure-underbust-circ-incr', flare * 0.30 * (authored.latInsertion ? 0.45 : 1));
  M.add('torso/torso-muscle-pectoral-incr', chestUp * (0.12 + mass * 0.16));
  M.add('measure/measure-bust-circ-incr', chestUp * 0.22);
  M.add('measure/measure-frontchest-dist-incr', chestUp * 0.14);
  M.add('torso/torso-scale-depth-incr', chestUp * 0.10 - vacuum * 0.10);
  M.add('measure/measure-waist-circ-decr', vacuum * 0.70);
  M.add('stomach/stomach-tone-incr', vacuum * 0.55);
  M.add('measure/measure-underbust-circ-incr', vacuum * 0.22);

  /* flexing bunches every belly up a little */
  /* The stock MakeHuman muscle target mostly adds circumference. Using a large
     dose of it as a flex corrective made every pose visibly inflate. The
     region bellies and definition fields now carry the contraction read. */
  const fl = flex * (0.11 + mass * 0.22);
  for (const s of LR) {
    M.add(`armslegs/${s}-upperarm-muscle-incr`, fl);
    M.add(`armslegs/${s}-lowerarm-muscle-incr`, fl * 0.7);
    M.add(`armslegs/${s}-upperleg-muscle-incr`, flex * (0.08 + legMass * 0.18));
    M.add(`armslegs/${s}-lowerleg-muscle-incr`, flex * (0.05 + legMass * 0.11));
  }

  /* what regions.js still needs to know */
  return {
    mass, legMass, back, fat, flex, flare, chestUp, vacuum, lean,
    authored,
    /* how far to blend toward the smoothed mesh: definition disappearing */
    soften: clamp((fat - 0.12) * 1.55, 0, 1) * 0.55 * (1 - flex * 0.25),
    /* and how far to blend away from it: definition arriving. Lean and full
       reads sharp; the same physique in October reads smooth. */
    definition: clamp(1.15 - fat * 3.6, 0, 1) * clamp(0.30 + mass * 0.85, 0, 1)
                * (0.70 + flex * 0.45) * 1.55,
    /* how far the skeleton shows through: pure leanness, plus a little for
       fine joints, and nothing at all to do with muscle */
    bone: clamp(1.25 - fat * 3.4, 0, 1) * clamp(0.55 + (1 - g('boneThickness')) * 0.55, 0, 1.1),
    /* veins: only on a lean arm with something in it */
    vein: clamp(1.15 - fat * 3.8, 0, 1) * clamp(mass * 1.25 - 0.25, 0, 1) * 0.55,
    /* striations need all three at once: lean, full, and contracted */
    striate: clamp(1.05 - fat * 4.6, 0, 1) * clamp(mass * 1.35 - 0.40, 0, 1)
             * (0.35 + flex * 0.65) * 0.14,
    /* How hard the muscle shaping reads. Three things gate it: how much tissue
       there is, how much fat is covering it, and whether it is contracted.
       An elite physique at 20% body fat shows less shape than a moderate one
       at 5% — which is the whole argument of the page. */
    relief: clamp(mass * 1.45 - 0.22, 0, 1.30) * clamp(1.06 - (fat - 0.10) * 1.35, 0.20, 1)
            * (0.62 + flex * 0.50),
    legRelief: clamp(legMass * 1.45 - 0.22, 0, 1.30) * clamp(1.06 - (fat - 0.10) * 1.35, 0.20, 1)
            * (0.62 + flex * 0.50),
  };
}
