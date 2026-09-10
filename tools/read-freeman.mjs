import fs from "node:fs";
import { parseAnatomy } from "../src/freeman/anatomy.js";

/* Node reader for the baked sculpt, with the projected anatomy if present. */
export function readFreeman() {
  const meta = JSON.parse(
    fs.readFileSync(new URL("../public/models/freeman.json", import.meta.url)),
  );
  const buffer = fs.readFileSync(
    new URL("../public/models/freeman.bin", import.meta.url),
  );
  const data = { meta, anatomy: readAnatomy() },
    types = { f: Float32Array, H: Uint16Array, I: Uint32Array, B: Uint8Array };
  for (const b of meta.blocks)
    data[b.name] = new types[b.type](
      buffer.buffer,
      buffer.byteOffset + b.offset,
      b.length,
    );
  return data;
}

export function readAnatomy() {
  const head = new URL("../public/models/freeman-anatomy.json", import.meta.url);
  const body = new URL("../public/models/freeman-anatomy.bin", import.meta.url);
  if (!fs.existsSync(head) || !fs.existsSync(body)) return null;
  const buffer = fs.readFileSync(body);
  return parseAnatomy(JSON.parse(fs.readFileSync(head)), buffer.buffer, buffer.byteOffset);
}
