/* ---------------------------------------------------------------------------
   Readers for the MakeHuman CC0 file formats.
     .obj      quad mesh, separate position and UV index streams
     .mhskel   bone tree; each head/tail names a group of mesh vertices
     .mhw      per-bone sparse skin weights over the mesh vertices
     .target   sparse "vertex index -> xyz offset" morph
   --------------------------------------------------------------------------- */
import fs from 'node:fs';

/* MakeHuman works in decimetres with Y up and Z forward. */
export const MH_TO_CM = 10;

export function readObj(file) {
  const text = fs.readFileSync(file, 'utf8');
  const pos = [], uv = [];
  const groups = new Map();          // group name -> {quads:[], quadUV:[]}
  let cur = null;

  for (const raw of text.split('\n')) {
    if (raw.charCodeAt(0) === 35 /* # */) continue;
    const line = raw.trimEnd();
    if (line.startsWith('v ')) {
      const p = line.split(/\s+/);
      pos.push(+p[1], +p[2], +p[3]);
    } else if (line.startsWith('vt ')) {
      const p = line.split(/\s+/);
      uv.push(+p[1], +p[2]);
    } else if (line.startsWith('g ')) {
      const name = line.slice(2).trim();
      if (!groups.has(name)) groups.set(name, { quads: [], quadUV: [] });
      cur = groups.get(name);
    } else if (line.startsWith('f ') && cur) {
      const p = line.split(/\s+/);
      /* the base mesh is all quads; a stray triangle is fanned to a degenerate
         quad so the subdivision stage can assume four corners everywhere */
      const n = p.length - 1;
      const vi = [], ti = [];
      for (let i = 1; i <= n; i++) {
        const s = p[i].split('/');
        vi.push(+s[0] - 1);
        ti.push(s[1] ? +s[1] - 1 : 0);
      }
      if (n === 3) { vi.push(vi[2]); ti.push(ti[2]); }
      cur.quads.push(vi[0], vi[1], vi[2], vi[3]);
      cur.quadUV.push(ti[0], ti[1], ti[2], ti[3]);
    }
  }
  return { pos: Float64Array.from(pos), uv: Float32Array.from(uv), groups };
}

/* "12345 .008 0 .003" per line, one line per moved vertex */
export function readTarget(file) {
  const text = fs.readFileSync(file, 'utf8');
  const idx = [], d = [];
  for (const raw of text.split('\n')) {
    if (!raw || raw.charCodeAt(0) === 35) continue;
    const p = raw.split(/\s+/);
    if (p.length < 4) continue;
    const i = +p[0];
    if (!Number.isFinite(i)) continue;
    idx.push(i);
    d.push(+p[1], +p[2], +p[3]);
  }
  return { idx: Int32Array.from(idx), delta: Float32Array.from(d) };
}

export function readSkeleton(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
export function readWeights(file) { return JSON.parse(fs.readFileSync(file, 'utf8')).weights; }

/* A joint's position is the centre of the little cube of helper vertices that
   carries its name. Because those cubes are part of the mesh, every morph
   target moves the skeleton with the body — no separate bone rig to keep in
   sync. */
export function jointCentre(pos, verts, out = [0, 0, 0]) {
  let x = 0, y = 0, z = 0;
  for (const v of verts) { x += pos[v * 3]; y += pos[v * 3 + 1]; z += pos[v * 3 + 2]; }
  const n = verts.length || 1;
  out[0] = x / n; out[1] = y / n; out[2] = z / n;
  return out;
}
