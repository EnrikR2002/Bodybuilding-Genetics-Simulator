import fs from "node:fs";
export function readFreeman() {
  const meta = JSON.parse(
    fs.readFileSync(new URL("../public/models/freeman.json", import.meta.url)),
  );
  const buffer = fs.readFileSync(
    new URL("../public/models/freeman.bin", import.meta.url),
  );
  const data = { meta },
    types = { f: Float32Array, H: Uint16Array, I: Uint32Array };
  for (const b of meta.blocks)
    data[b.name] = new types[b.type](
      buffer.buffer,
      buffer.byteOffset + b.offset,
      b.length,
    );
  return data;
}
