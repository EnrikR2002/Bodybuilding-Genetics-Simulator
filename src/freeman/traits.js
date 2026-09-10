/* ---------------------------------------------------------------------------
   The trait catalogue.

   Every other module reads this list: the shape deformers, the controls, the
   presets, the comparison labels and the tests. A trait is one number from 0
   to 1. `default` is the value at which the artist's sculpt is left exactly as
   it was authored, so the neutral figure is always the real sculpt.

   Direction conventions (0 → 1):
     bicepInsertion  short belly, long distal tendon   → long belly, full to the elbow
     bicepPeak       flat, broad biceps                → tall central peak
     tricepsLength   short long-head, high horseshoe   → long head filling to the elbow
     pecGap          pecs meet at the sternum          → wide sternal gap
     abStagger       even, blocky rows                 → staggered left/right rows
     abCount         four-pack                         → eight-pack (0.5 = the sculpt's six)
     latInsertion    high lats, gap above the waist    → low lats, sweep to the waist
     trapHeight      low, flat traps                   → high traps into the neck
     quadTeardrop    high vastus medialis              → low teardrop hugging the knee
     calfInsertion   high calf, long Achilles          → low calf, full to the ankle
     clavicle        narrow shoulders                  → wide clavicles
     ribcage         shallow chest                     → deep barrel rib cage
     hipWidth        narrow pelvis                     → wide pelvis
     waist           narrow waist                      → wide, blocky waist
     torsoLength     short torso                       → long torso
     armLength       short arms                        → long arms
     legLength       short legs                        → long legs
     boneThickness   fine wrists, knees and ankles     → thick joints
     headSize        small head                        → large head
     mass            lighter upper body                → fuller upper body
     legMass         lighter legs                      → fuller legs
     backThickness   flat back                         → dense back
     bodyFat         contest lean (the sculpt)         → soft off-season coverage
   --------------------------------------------------------------------------- */

export const GROUPS = [
  { id: "insertions", label: "Insertions", given: true,
    blurb: "Where each muscle starts and stops. Fixed at birth; training cannot move a tendon." },
  { id: "frame", label: "Frame", given: true,
    blurb: "The skeleton the muscle hangs on. Width, depth and lever lengths." },
  { id: "development", label: "Development", given: false,
    blurb: "How much muscle has been built on that frame." },
  { id: "condition", label: "Condition", given: false,
    blurb: "How much of that muscle can actually be seen." },
];

/* `muscles` names anatomy structures (without the .L/.R side) that the trait
   is about. The anatomy overlay highlights them and callouts anchor to them.
   `focus` names the camera region used by "inspect", `view` the azimuth in
   degrees (0 front, 180 back, -90 side) and `pose` the pose that shows the
   trait best. */
export const TRAITS = [
  // ---- insertions -------------------------------------------------------
  { key: "bicepInsertion", group: "insertions", label: "Biceps belly length",
    stops: ["Short", "Medium", "Long"], default: 0.5,
    note: "How far the biceps belly reaches toward the elbow before it turns to tendon.",
    muscles: ["biceps_long", "biceps_short", "biceps_tendon"], focus: "arms", view: 0, pose: "frontDouble" },
  { key: "bicepPeak", group: "insertions", label: "Biceps peak",
    stops: ["Flat", "Balanced", "Peaked"], default: 0.5,
    note: "Peak height is a separate trait from belly length.",
    muscles: ["biceps_long", "biceps_short"], focus: "arms", view: 0, pose: "frontDouble" },
  { key: "tricepsLength", group: "insertions", label: "Triceps long head",
    stops: ["Short", "Medium", "Long"], default: 0.5,
    note: "A long head fills the back of the arm down to the elbow; a short one leaves a high horseshoe.",
    muscles: ["triceps_long", "triceps_lateral", "triceps_medial"], focus: "arms", view: -90, pose: "sideTriceps" },
  { key: "pecGap", group: "insertions", label: "Sternal gap",
    stops: ["Narrow", "Medium", "Wide"], default: 0.5,
    note: "Where the inner pec attaches along the sternum.",
    muscles: ["pectoralis_sternal", "pectoralis_clavicular"], focus: "chest", view: 0, pose: "frontDouble" },
  { key: "abStagger", group: "insertions", label: "Ab alignment",
    stops: ["Even", "Subtle", "Staggered"], default: 0.5,
    note: "Whether the tendinous rows of the abs line up left to right.",
    muscles: ["rectus_abdominis"], focus: "abs", view: 0, pose: "absThigh" },
  { key: "abCount", group: "insertions", label: "Ab segments",
    stops: ["Four", "Six", "Eight"], default: 0.5,
    note: "The number of visible rows is set by how many tendinous inscriptions you have.",
    muscles: ["rectus_abdominis"], focus: "abs", view: 0, pose: "absThigh" },
  { key: "latInsertion", group: "insertions", label: "Lat insertion",
    stops: ["High", "Mid", "Low"], default: 0.5,
    note: "Low lats carry the sweep down to the waist; high lats leave a gap above it.",
    muscles: ["latissimus"], focus: "back", view: 180, pose: "rearLat" },
  { key: "trapHeight", group: "insertions", label: "Trap height",
    stops: ["Low", "Medium", "High"], default: 0.5,
    note: "How high the upper traps climb the neck.",
    muscles: ["trapezius_upper", "trapezius_middle"], focus: "back", view: 180, pose: "backDouble" },
  { key: "quadTeardrop", group: "insertions", label: "Quad teardrop",
    stops: ["High", "Mid", "Low"], default: 0.5,
    note: "Where the vastus medialis sits above the knee.",
    muscles: ["vastus_medialis"], focus: "legs", view: 0, pose: "absThigh" },
  { key: "calfInsertion", group: "insertions", label: "Calf insertion",
    stops: ["High", "Mid", "Low"], default: 0.5,
    note: "A high calf leaves a long Achilles tendon; a low calf fills the leg to the ankle.",
    muscles: ["gastrocnemius_medial", "gastrocnemius_lateral", "soleus", "calcaneal_tendon"],
    focus: "calves", view: 180, pose: "backDouble" },

  // ---- frame ------------------------------------------------------------
  { key: "clavicle", group: "frame", label: "Clavicle width",
    stops: ["Narrow", "Medium", "Wide"], default: 0.5,
    note: "Shoulder width is set by the collarbones before any delt is built.",
    muscles: ["bone_clavicle", "deltoid_lateral"], focus: "full", view: 0, pose: "latSpread" },
  { key: "ribcage", group: "frame", label: "Rib cage",
    stops: ["Shallow", "Medium", "Barrel"], default: 0.5,
    note: "The breadth and depth of the thorax under the chest and lats.",
    muscles: ["serratus", "pectoralis_sternal"], focus: "torso", view: -90, pose: "sideChest" },
  { key: "hipWidth", group: "frame", label: "Pelvis width",
    stops: ["Narrow", "Medium", "Wide"], default: 0.5,
    note: "The lower half of the V-taper.",
    muscles: ["gluteus_medius", "bone_iliac"], focus: "full", view: 0, pose: "latSpread" },
  { key: "waist", group: "frame", label: "Waist width",
    stops: ["Narrow", "Medium", "Blocky"], default: 0.5,
    note: "The structural width of the midsection, independent of fat.",
    muscles: ["external_oblique", "rectus_abdominis"], focus: "torso", view: 0, pose: "vacuum" },
  { key: "torsoLength", group: "frame", label: "Torso length",
    stops: ["Short", "Medium", "Long"], default: 0.5,
    note: "Torso length against leg length.",
    muscles: [], focus: "full", view: 0, pose: "relaxed" },
  { key: "armLength", group: "frame", label: "Arm length",
    stops: ["Short", "Medium", "Long"], default: 0.5,
    note: "The same muscle on a longer lever looks smaller.",
    muscles: [], focus: "full", view: 0, pose: "relaxed" },
  { key: "legLength", group: "frame", label: "Leg length",
    stops: ["Short", "Medium", "Long"], default: 0.5,
    note: "Femur and shin length against the torso.",
    muscles: [], focus: "full", view: 0, pose: "relaxed" },
  { key: "boneThickness", group: "frame", label: "Joint size",
    stops: ["Fine", "Medium", "Thick"], default: 0.5,
    note: "Small wrists, knees and ankles make the bellies between them look bigger.",
    muscles: [], focus: "arms", view: 0, pose: "relaxed" },
  { key: "headSize", group: "frame", label: "Head size",
    stops: ["Small", "Medium", "Large"], default: 0.5,
    note: "A small head makes the same shoulders read wider.",
    muscles: [], focus: "full", view: 0, pose: "relaxed" },

  // ---- development ------------------------------------------------------
  { key: "mass", group: "development", label: "Upper-body mass",
    stops: ["Lighter", "Athletic", "Fuller"], default: 0.5,
    note: "Muscle added to the chest, shoulders and arms.",
    muscles: ["deltoid_anterior", "deltoid_lateral", "pectoralis_sternal", "biceps_long", "triceps_long"],
    focus: "full", view: 0, pose: "frontDouble" },
  { key: "backThickness", group: "development", label: "Back density",
    stops: ["Flat", "Athletic", "Dense"], default: 0.5,
    note: "Thickness through the traps, mid-back and spinal erectors.",
    muscles: ["trapezius_middle", "latissimus", "erector_spinae", "infraspinatus", "teres_major"],
    focus: "back", view: 180, pose: "backDouble" },
  { key: "legMass", group: "development", label: "Leg mass",
    stops: ["Lighter", "Athletic", "Fuller"], default: 0.5,
    note: "Muscle added to the quads, hamstrings and calves.",
    muscles: ["rectus_femoris", "vastus_lateralis", "vastus_medialis", "biceps_femoris", "gastrocnemius_medial"],
    focus: "legs", view: 0, pose: "absThigh" },

  // ---- condition --------------------------------------------------------
  { key: "bodyFat", group: "condition", label: "Body fat",
    stops: ["Stage", "Lean", "Off-season"], default: 0,
    note: "Fat covers separation without moving a single insertion.",
    muscles: [], focus: "full", view: 0, pose: "relaxed" },
];

export const TRAIT_BY_KEY = Object.fromEntries(TRAITS.map((t) => [t.key, t]));
export const DEFAULT = Object.fromEntries(TRAITS.map((t) => [t.key, t.default]));
export const GIVEN = new Set(TRAITS.filter((t) => GROUPS.find((g) => g.id === t.group).given).map((t) => t.key));

/* Body fat is shown as an estimate. The sculpt is contest lean at 0. */
export const bodyFatPercent = (v) => 5 + v * 17;

/* Archetypes. Values not listed stay at DEFAULT. These are illustrative
   combinations, not measurements of any real athlete. */
export const PRESETS = [
  { id: "sculpt", name: "Artist sculpt", blurb: "The untouched reference sculpt.", values: {} },
  { id: "classic", name: "Golden-era classic",
    blurb: "Wide clavicles, a small waist and full, round muscle bellies.",
    values: { clavicle: 0.85, ribcage: 0.6, hipWidth: 0.2, waist: 0.2, torsoLength: 0.45, legLength: 0.55,
      boneThickness: 0.3, headSize: 0.4, bicepInsertion: 0.65, bicepPeak: 0.8, tricepsLength: 0.6,
      pecGap: 0.35, abStagger: 0.2, latInsertion: 0.8, trapHeight: 0.35, quadTeardrop: 0.7,
      calfInsertion: 0.7, mass: 0.6, legMass: 0.55, backThickness: 0.6, bodyFat: 0.03 } },
  { id: "mass", name: "Mass monster",
    blurb: "A barrel rib cage and thick joints carrying maximum size.",
    values: { clavicle: 0.7, ribcage: 1, hipWidth: 0.7, waist: 0.9, torsoLength: 0.6, armLength: 0.35,
      legLength: 0.35, boneThickness: 0.85, headSize: 0.6, bicepInsertion: 0.7, bicepPeak: 0.45,
      tricepsLength: 0.7, pecGap: 0.6, abStagger: 0.6, abCount: 0.3, latInsertion: 0.6, trapHeight: 1,
      quadTeardrop: 0.6, calfInsertion: 0.6, mass: 1, legMass: 1, backThickness: 1, bodyFat: 0.12 } },
  { id: "aesthetic", name: "Aesthetic",
    blurb: "Moderate size on an ideal frame. The taper does the work.",
    values: { clavicle: 0.75, ribcage: 0.45, hipWidth: 0.25, waist: 0.25, torsoLength: 0.4, legLength: 0.6,
      boneThickness: 0.3, headSize: 0.35, bicepInsertion: 0.55, bicepPeak: 0.7, pecGap: 0.3,
      abStagger: 0.1, latInsertion: 0.7, trapHeight: 0.3, mass: 0.35, legMass: 0.3, backThickness: 0.4,
      bodyFat: 0.08 } },
  { id: "powerlifter", name: "Powerlifter",
    blurb: "Short levers, thick joints and a wide waist. Built to move weight.",
    values: { clavicle: 0.6, ribcage: 0.9, hipWidth: 0.75, waist: 0.85, torsoLength: 0.65, armLength: 0.3,
      legLength: 0.3, boneThickness: 0.9, headSize: 0.55, tricepsLength: 0.6, pecGap: 0.6, abCount: 0.4,
      trapHeight: 0.9, mass: 0.85, legMass: 0.9, backThickness: 0.85, bodyFat: 0.45 } },
  { id: "levers", name: "Long levers",
    blurb: "Long limbs and high insertions. Every muscle has farther to fill.",
    values: { clavicle: 0.55, ribcage: 0.35, hipWidth: 0.35, waist: 0.4, torsoLength: 0.35, armLength: 0.95,
      legLength: 0.95, boneThickness: 0.2, bicepInsertion: 0.15, bicepPeak: 0.75, tricepsLength: 0.3,
      pecGap: 0.75, latInsertion: 0.3, trapHeight: 0.6, quadTeardrop: 0.3, calfInsertion: 0.1,
      mass: 0.45, legMass: 0.35, backThickness: 0.4, bodyFat: 0.15 } },
  { id: "highInsertions", name: "High insertions",
    blurb: "Short bellies everywhere. The same mass, less of it on show.",
    values: { bicepInsertion: 0, tricepsLength: 0, pecGap: 1, abStagger: 1, latInsertion: 0,
      trapHeight: 0.8, quadTeardrop: 0, calfInsertion: 0 } },
  { id: "lowInsertions", name: "Low insertions",
    blurb: "Long bellies everywhere. Full from joint to joint.",
    values: { bicepInsertion: 1, tricepsLength: 1, pecGap: 0, abStagger: 0, latInsertion: 1,
      trapHeight: 0.4, quadTeardrop: 1, calfInsertion: 1 } },
];

export const presetState = (id) => ({ ...DEFAULT, ...(PRESETS.find((p) => p.id === id)?.values ?? {}) });
