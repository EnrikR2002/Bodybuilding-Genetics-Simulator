/* ---------------------------------------------------------------------------
   What the Freeman anatomy map is made of.

   STRUCTURES lists every structure of the vocabulary in docs/ARCHITECTURE.md
   (without the .L / .R side), in id order, with:

     group    colour family for the overlay (the vocabulary heading)
     atlas    Z-Anatomy object names (side suffix and brackets removed) whose
              geometry *is* this structure
     regions  where on the Freeman body it may own skin, by rig region:
              t = trunk, a = arm, l = leg, h = head/neck
     origin / insertion
              how to find its two ends in the dissection, for `along`:
                { patch: [...] }   Z-Anatomy "Muscular insertions" objects
                                   (the .o* / .e* suffix is ignored: the
                                   atlas is not consistent about which end
                                   it calls which, so the ends are named
                                   here instead)
                { toward: [x, y, z] } the structure's own vertices that lie
                                   farthest in this direction (x is flipped
                                   for the right side, so +x = lateral)
              Anatomical convention: origin is the proximal / fixed end
              (rectus abdominis: pubis -> ribs; latissimus: spine and pelvis
              -> humerus; serratus: ribs -> scapula).

   OTHER lists the atlas structures that are real but outside the vocabulary.
   They still stop a ray (they are in the dissection, and the skin shows them),
   but they carry id 0. MERGE maps a few small neighbours into a vocabulary
   structure the way an anatomy atlas for artists groups them.
   --------------------------------------------------------------------------- */

const down = [0, -1, 0], up = [0, 1, 0], lateral = [1, 0, 0], medial = [-1, 0, 0];

export const STRUCTURES = [
  // ---- neck ----
  { name: "sternocleidomastoid", group: "neck", regions: "th",
    atlas: ["Sternocleidomastoid muscle"],
    origin: { patch: ["Sternocleidomastoid muscle.o"] }, insertion: { patch: ["Sternocleidomastoid muscle.e"] } },
  // ---- shoulder ----
  { name: "deltoid_anterior", group: "shoulder", regions: "ta",
    atlas: ["Clavicular part of deltoid muscle"],
    origin: { patch: ["Clavicular part of deltoid muscle.o"] }, insertion: { patch: ["Deltoid muscle.e"] } },
  { name: "deltoid_lateral", group: "shoulder", regions: "ta",
    atlas: ["Acromial part of deltoid muscle"],
    origin: { patch: ["Acromial part of deltoid muscle.o"] }, insertion: { patch: ["Deltoid muscle.e"] } },
  { name: "deltoid_posterior", group: "shoulder", regions: "ta",
    atlas: ["Scapular spinal part of deltoid muscle"],
    origin: { patch: ["Scapular spinal part of deltoid muscle.o"] }, insertion: { patch: ["Deltoid muscle.e"] } },
  // ---- chest ----
  { name: "pectoralis_clavicular", group: "chest", regions: "ta",
    atlas: ["Clavicular head of pectoralis major muscle"],
    origin: { patch: ["Pectoralis major muscle.o"] }, insertion: { patch: ["Pectoralis major muscle.e"] } },
  { name: "pectoralis_sternal", group: "chest", regions: "ta",
    atlas: ["Sternocostal head of pectoralis major muscle", "Abdominal part of pectoralis major muscle"],
    origin: { patch: ["Sternocostal head of pectoralis major muscle.e", "Abdominal part of pectoralis major muscle.o"] },
    insertion: { patch: ["Pectoralis major muscle.e"] } },
  { name: "serratus", group: "chest", regions: "ta",
    atlas: ["Serratus anterior muscle"],
    origin: { patch: ["Serratus anterior muscle.e"] }, insertion: { patch: ["Serratus anterior muscle.o"] } },
  // ---- arm ----
  { name: "biceps_long", group: "arm", regions: "ta",
    atlas: ["Long head of biceps brachii"],
    origin: { patch: ["Long head of biceps brachii.o"] }, insertion: { patch: ["Biceps brachii muscle.e"] } },
  { name: "biceps_short", group: "arm", regions: "ta",
    atlas: ["Short head of biceps brachii"],
    origin: { patch: ["Short head of biceps brachii.o"] }, insertion: { patch: ["Biceps brachii muscle.e"] } },
  { name: "biceps_tendon", group: "arm", regions: "a", atlas: [],   // carved from the distal biceps, see bake
    origin: { toward: up }, insertion: { patch: ["Biceps brachii muscle.e"] } },
  { name: "brachialis", group: "arm", regions: "a",
    atlas: ["Brachialis muscle"],
    origin: { patch: ["Brachialis muscle.o"] }, insertion: { patch: ["Brachialis muscle.e"] } },
  { name: "triceps_long", group: "arm", regions: "ta",
    atlas: ["Long head of triceps brachii"],
    origin: { patch: ["Long head of triceps brachii.o"] }, insertion: { patch: ["Triceps brachii muscle.e"] } },
  { name: "triceps_lateral", group: "arm", regions: "ta",
    atlas: ["Lateral head of triceps brachii"],
    origin: { patch: ["Lateral head of triceps brachii.o"] }, insertion: { patch: ["Triceps brachii muscle.e"] } },
  { name: "triceps_medial", group: "arm", regions: "a",
    atlas: ["Medial head of triceps brachii"],
    origin: { patch: ["Medial head of triceps brachii.o"] }, insertion: { patch: ["Triceps brachii muscle.e"] } },
  { name: "brachioradialis", group: "arm", regions: "a",
    atlas: ["Brachioradialis muscle"],
    origin: { patch: ["Brachioradialis muscle.o"] }, insertion: { patch: ["Brachioradialis muscle.e"] } },
  { name: "forearm_flexors", group: "arm", regions: "a",
    atlas: ["Superficial head of pronator teres", "Deep head of pronator teres", "Flexor carpi radialis",
      "Palmaris longus muscle", "Humeral head of flexor carpi ulnaris", "Ulnar head of flexor carpi ulnaris",
      "Humero-ulnar head of flexor digitorum superficialis", "Radial head of flexor digitorum superficialis",
      "Flexor digitorum profundus", "Flexor pollicis longus", "Pronator quadratus"],
    origin: { patch: ["Common flexor tendon.o", "Pronator teres.o"] }, insertion: { toward: down } },
  { name: "forearm_extensors", group: "arm", regions: "a",
    atlas: ["Extensor carpi radialis longus", "Extensor carpi radialis brevis", "Extensor digitorum",
      "Extensor digiti minimi", "Humeral head of extensor carpi ulnaris", "Ulnar head of extensor carpi ulnaris",
      "Abductor pollicis longus", "Extensor pollicis brevis", "Extensor pollicis longus", "Extensor indicis",
      "Anconeus muscle", "Supinator"],
    origin: { patch: ["Common extensor tendon.o", "Extensor carpi radialis longus.o"] }, insertion: { toward: down } },
  // ---- abdomen ----
  { name: "rectus_abdominis", group: "abdomen", regions: "t",
    atlas: ["Rectus abdominis muscle", "Pyramidalis muscle"],
    origin: { toward: down }, insertion: { toward: up } },
  { name: "external_oblique", group: "abdomen", regions: "tl",
    atlas: ["External abdominal oblique muscle"],
    origin: { patch: ["External abdominal oblique muscle.o"] }, insertion: { toward: [-0.3, -1, 0.2] } },
  // ---- back ----
  { name: "trapezius_upper", group: "back", regions: "tha",
    atlas: ["Descending part of trapezius muscle"],
    origin: { toward: up }, insertion: { toward: lateral } },
  { name: "trapezius_middle", group: "back", regions: "ta",
    atlas: ["Transverse part of trapezius muscle"],
    origin: { toward: medial }, insertion: { toward: lateral } },
  { name: "trapezius_lower", group: "back", regions: "t",
    atlas: ["Ascending part of trapezius muscle"],
    origin: { toward: down }, insertion: { toward: [1, 1, 0] } },
  { name: "latissimus", group: "back", regions: "ta",
    atlas: ["Latissimus dorsi muscle"],
    origin: { patch: ["Latissimus dorsi muscle.o", "Latissimus dorsi muscle.e"] }, insertion: { toward: [1, 0.6, 0.3] } },
  { name: "teres_major", group: "back", regions: "ta",
    atlas: ["Teres major muscle"],
    origin: { patch: ["Teres major muscle.o"] }, insertion: { toward: [1, 0.6, 0.3] } },
  { name: "infraspinatus", group: "back", regions: "ta",
    atlas: ["Infraspinatus muscle", "Teres minor muscle"],
    origin: { patch: ["Infraspinatus muscle.o", "Teres minor muscle.o"] },
    insertion: { patch: ["Infraspinatus muscle.e", "Teres minor muscle.e"] } },
  { name: "rhomboid", group: "back", regions: "t",
    atlas: ["Rhomboid major muscle", "Rhomboid minor muscle"],
    origin: { toward: medial }, insertion: { patch: ["Rhomboid major muscle.e", "Rhomboid minor muscle.e"] } },
  { name: "erector_spinae", group: "back", regions: "t",
    atlas: ["Iliocostalis lumborum muscle", "Iliocostalis thoracis muscle", "Longissimus thoracis muscle",
      "Spinalis thoracis muscle", "Multifidus lumborum muscle"],
    origin: { patch: ["Erector spinae.o"] }, insertion: { toward: up } },
  // ---- hip ----
  { name: "gluteus_maximus", group: "hip", regions: "tl",
    atlas: ["Gluteus maximus muscle"],
    origin: { patch: ["Gluteus maximus muscle.o"] }, insertion: { patch: ["Gluteus maximus muscle.e"] } },
  { name: "gluteus_medius", group: "hip", regions: "tl",
    atlas: ["Gluteus medius muscle"],
    origin: { patch: ["Gluteus medius muscle.o"] }, insertion: { patch: ["Gluteus medius muscle.e"] } },
  { name: "tensor_fasciae_latae", group: "hip", regions: "tl",
    atlas: ["Tensor fasciae latae"],
    origin: { patch: ["Tensor fasciae latae.o"] }, insertion: { toward: down } },
  // ---- thigh ----
  { name: "rectus_femoris", group: "thigh", regions: "tl",
    atlas: ["Rectus femoris muscle"],
    origin: { patch: ["Rectus femoris muscle.o"] }, insertion: { patch: ["Quadriceps femoris muscle.e"] } },
  { name: "vastus_lateralis", group: "thigh", regions: "l",
    atlas: ["Vastus lateralis muscle"],
    origin: { patch: ["Vastus lateralis muscle.o"] }, insertion: { patch: ["Quadriceps femoris muscle.e"] } },
  { name: "vastus_medialis", group: "thigh", regions: "l",
    atlas: ["Vastus medialis muscle"],
    origin: { patch: ["Vastus medialis muscle.o"] }, insertion: { patch: ["Quadriceps femoris muscle.e"] } },
  { name: "sartorius", group: "thigh", regions: "tl",
    atlas: ["Sartorius muscle"],
    origin: { patch: ["Sartorius muscle.o"] }, insertion: { patch: ["Sartorius muscle.e"] } },
  { name: "adductors", group: "thigh", regions: "tl",
    atlas: ["Adductor longus", "Adductor magnus", "Adductor brevis", "Adductor minimus", "Pectineus muscle"],
    origin: { patch: ["Adductor longus.o", "Adductor magnus.o", "Pectineus muscle.o"] },
    insertion: { patch: ["Adductor longus.e", "Adductor magnus.e", "Pectineus muscle.e"] } },
  { name: "gracilis", group: "thigh", regions: "tl",
    atlas: ["Gracilis muscle"],
    origin: { patch: ["Gracilis muscle.o"] }, insertion: { patch: ["Gracilis muscle.e"] } },
  { name: "biceps_femoris", group: "thigh", regions: "tl",
    atlas: ["Long head of biceps femoris", "Short head of biceps femoris"],
    origin: { patch: ["Long head of biceps femoris.o"] }, insertion: { patch: ["Biceps femoris muscle.e"] } },
  { name: "semitendinosus", group: "thigh", regions: "tl",
    atlas: ["Semitendinosus muscle"],
    origin: { patch: ["Semitendinosus muscle.o"] }, insertion: { patch: ["Semitendinosus muscle.e"] } },
  { name: "semimembranosus", group: "thigh", regions: "tl",
    atlas: ["Semimembranosus muscle"],
    origin: { patch: ["Semimembranosus muscle.o"] }, insertion: { patch: ["Semimembranosus muscle.e"] } },
  { name: "patellar_tendon", group: "thigh", regions: "l", atlas: [],   // built from its two attachment patches
    origin: { patch: ["Patellar ligament.o"] }, insertion: { patch: ["Patellar ligament.e"] } },
  // ---- lower leg ----
  { name: "gastrocnemius_medial", group: "lower_leg", regions: "l",
    atlas: ["Medial head of gastrocnemius"],
    origin: { patch: ["Medial head of gastrocnemius.o"] }, insertion: { patch: ["Triceps surae muscle.e"] } },
  { name: "gastrocnemius_lateral", group: "lower_leg", regions: "l",
    atlas: ["Lateral head of gastrocnemius"],
    origin: { patch: ["Lateral head of gastrocnemius.o"] }, insertion: { patch: ["Triceps surae muscle.e"] } },
  { name: "soleus", group: "lower_leg", regions: "l",
    atlas: ["Soleus muscle"],
    origin: { patch: ["Soleus muscle.o"] }, insertion: { patch: ["Triceps surae muscle.e"] } },
  { name: "calcaneal_tendon", group: "lower_leg", regions: "l",
    atlas: ["Calcaneal tendon"],
    origin: { toward: up }, insertion: { patch: ["Triceps surae muscle.e"] } },
  { name: "tibialis_anterior", group: "lower_leg", regions: "l",
    atlas: ["Tibialis anterior muscle", "Extensor digitorum longus", "Extensor hallucis longus"],
    origin: { patch: ["Tibialis anterior muscle.o"] }, insertion: { patch: ["Tibialis anterior muscle.e"] } },
  { name: "fibularis", group: "lower_leg", regions: "l",
    atlas: ["Fibularis longus muscle", "Fibularis brevis muscle", "Fibularis tertius muscle"],
    origin: { patch: ["Fibularis longus muscle.o", "Fibularis brevis muscle.o"] },
    insertion: { patch: ["Fibularis brevis muscle.e"] } },
  // ---- bone showing through ----
  { name: "bone_clavicle", group: "bone", regions: "tah", atlas: ["Clavicle"],
    origin: { toward: medial }, insertion: { toward: lateral } },
  { name: "bone_acromion", group: "bone", regions: "ta", atlas: [],   // the acromion end of the scapula, see bake
    origin: { toward: medial }, insertion: { toward: lateral } },
  { name: "bone_sternum", group: "bone", regions: "t",
    atlas: ["Manubrium of sternum", "Body of sternum", "Xiphoid process"],
    origin: { toward: up }, insertion: { toward: down } },
  { name: "bone_iliac", group: "bone", regions: "tl", atlas: ["Hip bone"],
    origin: { toward: [0, 0, -1] }, insertion: { toward: [0, 0, 1] } },
  { name: "bone_patella", group: "bone", regions: "l", atlas: ["Patella"],
    origin: { toward: up }, insertion: { toward: down } },
  { name: "bone_tibia", group: "bone", regions: "l", atlas: ["Tibia"],
    origin: { toward: up }, insertion: { toward: down } },
];

/* Small neighbours folded into a vocabulary structure. */
export const MERGE = {
  "Coracobrachialis muscle": "biceps_short",
};

/* Sheets the skin shows through, never the owner of a patch of skin. */
export const TRANSPARENT = ["Iliotibial tract"];

/* Bones by the limb segment that carries them, for the skeleton-driven
   part of the registration. Everything else belongs to the trunk. */
export const BONE_SEGMENT = [
  [/^Humerus$/, "upperarm"],
  [/^(Radius|Ulna)$/, "forearm"],
  [/(carpal|metacarpal|phalanx of .* of hand|Scaphoid|Lunate|Triquetr|Pisiform|Trapezi|Capitate|Hamate|sesamoid bones of hand)/i, "forearm"],
  [/^(Femur|Patella)$/, "thigh"],
  [/^(Tibia|Fibula|Talus|Calcaneus|Navicular bone|Cuboid bone|.*cuneiform bone|.*metatarsal bone|.*phalanx .* of foot|Sesamoid bones of foot)$/i, "shin"],
];

/* Skin patches ("Regions of human body") by the segment they cover. */
export function skinSegment(base) {
  if (/hand|palm|digits of hand|nail plate$|perionyx$|wrist/i.test(base)) return "hand";
  if (/forearm|foveola|elbow|cubital/i.test(base)) return "forearm";
  if (/region of arm|bicipital|deltoid region/i.test(base)) return "upperarm";
  if (/foot|toe|sole|heel|hallucial|malleol|ankle|arch|metatarsal|nail plate \(foot\)|perionyx \(foot\)|digits of foot/i.test(base)) return "foot";
  if (/region of leg|knee|popliteal/i.test(base)) return "shin";
  if (/thigh|femoral triangle|gluteal fold/i.test(base)) return "thigh";
  return "trunk";
}

/* The anatomical regions on which each rig region's vertices may be owned. */
export const REGION_KEYS = { t: "trunk", a: "arm", l: "leg", h: "head" };
