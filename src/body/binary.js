/* Reader for the bundle tools/bake-mesh.mjs writes.
   Every array is a view straight into the downloaded buffer — nothing is
   copied, so a 11 MB file costs 11 MB and no parse time. */

const CTORS = {
  Float32Array, Float64Array, Int32Array, Uint32Array,
  Uint16Array, Int16Array, Uint8Array, Int8Array,
};

export async function loadBundle(url, onProgress) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`cannot load ${url}: ${res.status}`);

  let buf;
  const total = +res.headers.get('content-length') || 0;
  if (onProgress && res.body && total) {
    const reader = res.body.getReader();
    const parts = [];
    let got = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      parts.push(value); got += value.length;
      onProgress(got / total);
    }
    buf = new Uint8Array(got);
    let o = 0;
    for (const p of parts) { buf.set(p, o); o += p.length; }
    buf = buf.buffer;
  } else {
    buf = await res.arrayBuffer();
  }

  const head = new DataView(buf);
  const magic = String.fromCharCode(head.getUint8(0), head.getUint8(1), head.getUint8(2), head.getUint8(3));
  if (magic !== 'IPLB' && magic !== 'IPRG') throw new Error(`not an Insertion bundle: ${url}`);
  const hLen = head.getUint32(4, true);
  const header = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 8, hLen)));
  const dataStart = 8 + hLen + ((4 - ((8 + hLen) % 4)) % 4);

  const view = rec => new CTORS[rec.type](buf, dataStart + rec.offset, rec.length);
  const block = i => view(header.blocks[i]);

  return {
    header,
    block,
    byName: name => {
      const i = header.blocks.findIndex(b => b.name === name);
      return i < 0 ? null : block(i);
    },
  };
}
