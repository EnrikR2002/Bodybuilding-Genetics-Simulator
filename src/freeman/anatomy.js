/* ---------------------------------------------------------------------------
   Projected anatomy for the Freeman sculpt.

   Files: public/models/freeman-anatomy.json (header) and
   public/models/freeman-anatomy.bin (blocks), produced by
   `npm run anatomy:freeman`. Vertex order matches freeman.bin.

   Header:
     { vertices, muscles: ["none", "sternocleidomastoid.L", ...],  // id → name, id 0 = none
       groups:  { "biceps_long": "arm", ... },   // neck | shoulder | chest | arm | abdomen |
                                                 // back | hip | thigh | lower_leg | bone
       landmarks: { "biceps_long.L": { origin: v, insertion: v, peak: v, centroid: v }, ... },
       blocks: [{ name, type: "B", offset, length }] }
   Ids are 1 + 2 × (vocabulary index) + (0 for .L, 1 for .R); read them from
   `muscles`, never hard-code them.

   Blocks (one value per vertex):
     muscle   Uint8    primary structure id (0 = no structure: hands, face, feet, genitals,
                       the linea alba, bone and fat outside the vocabulary)
     muscle2  Uint8    secondary structure id within ~1.2 cm of a border (0 if none)
     blend    Uint8    weight of the primary, 0..255 (255 inside, 128 on the border itself)
     along    Uint8    0 at the primary's origin → 255 at its insertion, measured on the
                       atlas muscle (a head whose tendon is its own structure, like the
                       biceps, ends near 200)

   Names use the vocabulary of docs/ARCHITECTURE.md with a .L/.R side; the map is
   exactly left/right symmetric. Method and limits: docs/ANATOMY_MAP.md.
   --------------------------------------------------------------------------- */

import { BufferAttribute } from "three";

const TYPES = { B: Uint8Array, H: Uint16Array, f: Float32Array };

export function parseAnatomy(meta, buffer, byteOffset = 0) {
  const a = { meta, muscles: meta.muscles, landmarks: meta.landmarks ?? {} };
  for (const b of meta.blocks) a[b.name] = new TYPES[b.type](buffer, byteOffset + b.offset, b.length);
  a.idOf = Object.fromEntries(meta.muscles.map((name, i) => [name, i]));
  return a;
}

export async function loadAnatomy(base = "/models/") {
  try {
    const head = await fetch(base + "freeman-anatomy.json");
    if (!head.ok) return null;
    const meta = await head.json();
    const body = await fetch(base + "freeman-anatomy.bin");
    if (!body.ok) return null;
    return parseAnatomy(meta, await body.arrayBuffer());
  } catch {
    return null;
  }
}

/* Expose the map to shaders: aMuscle, aMuscle2 (ids as floats), aBlend and
   aAlong (normalised 0..1). Without anatomy the attributes are left unset. */
export function attachAnatomy(geometry, anatomy) {
  if (!anatomy) return false;
  geometry.setAttribute("aMuscle", new BufferAttribute(anatomy.muscle, 1));
  geometry.setAttribute("aMuscle2", new BufferAttribute(anatomy.muscle2, 1));
  geometry.setAttribute("aBlend", new BufferAttribute(anatomy.blend, 1, true));
  geometry.setAttribute("aAlong", new BufferAttribute(anatomy.along, 1, true));
  return true;
}

/* Structure ids for side-less names, both sides: ["biceps_long"] → [3, 4]. */
export function idsFor(anatomy, names) {
  if (!anatomy) return [];
  const out = [];
  for (const name of names)
    for (const side of [".L", ".R", ""]) {
      const id = anatomy.idOf[name + side];
      if (id) out.push(id);
    }
  return out;
}
