/* The same bundle reader the browser uses, for the tools that have to read a
   baked artefact back — the anatomy projection needs the exact subdivision
   the renderer will use, and the only place that is written down is
   public/models/body.bin. */
import fs from 'node:fs';

const CTORS = {
  Float32Array, Float64Array, Int32Array, Uint32Array,
  Uint16Array, Int16Array, Uint8Array, Int8Array,
};

export function readBundle(file) {
  const buf = fs.readFileSync(file);
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  const head = new DataView(ab);
  const hLen = head.getUint32(4, true);
  const header = JSON.parse(new TextDecoder().decode(new Uint8Array(ab, 8, hLen)));
  const start = 8 + hLen + ((4 - ((8 + hLen) % 4)) % 4);
  const view = rec => new CTORS[rec.type](ab, start + rec.offset, rec.length);
  return {
    header,
    block: i => view(header.blocks[i]),
    byName: name => {
      const rec = header.blocks.find(b => b.name === name);
      return rec ? view(rec) : null;
    },
  };
}
