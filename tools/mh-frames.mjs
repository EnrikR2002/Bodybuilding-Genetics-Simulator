/* ---------------------------------------------------------------------------
   Bone frames: the coordinate system every muscle map is written in.

   A frame is built once per chain per side. The "front" direction is carried
   across each joint by the smallest rotation that lines one segment up with
   the next, so the flexor side of the forearm stays continuous with the
   biceps instead of spinning as the elbow turns.

   Two bakes need the same frames: the bone-derived region map, and the
   anatomy-atlas projection that reads real muscle geometry through them.
   They have to agree exactly, so they share this file.
   --------------------------------------------------------------------------- */
import { jointCentre } from './mh-parse.mjs';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const D2R = Math.PI / 180;

export const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const len = a => Math.hypot(a[0], a[1], a[2]);
export const norm = a => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

/* rotate v by the rotation that takes `from` to `to` (Rodrigues) */
export function rotateToward(v, from, to) {
  const c = clamp(dot(from, to), -1, 1);
  if (c > 0.999999) return v.slice();
  const ax = norm(cross(from, to));
  const s = Math.sqrt(1 - c * c);
  const k = cross(ax, v);
  const d = dot(ax, v) * (1 - c);
  return [v[0] * c + k[0] * s + ax[0] * d,
          v[1] * c + k[1] * s + ax[1] * d,
          v[2] * c + k[2] * s + ax[2] * d];
}

/* Build every chain frame, both sides, in one pass.

   `jointPos(name, side)` supplies the joint centres. The MakeHuman rig and the
   Z-Anatomy skeleton answer it differently, but everything downstream — the
   axis, the transported front reference, the outward binormal — is built the
   same way from the same chain table. That is what makes an angle around the
   arm mean the same thing in both bodies even though the two arms hang at
   different angles. */
export function buildFrames(jointPos, CHAINS, axes = {}) {
  /* Which way the body faces, and which way is its left. MakeHuman is Y up
     and Z forward; the Z-Anatomy atlas is Z up and Y backward. Naming them
     here is the only place the two spaces differ. */
  const front = axes.front || [0, 0, 1];
  const left = axes.left || [1, 0, 0];
  const frames = {};
  const buildFrame = (name, side) => {
    const def = CHAINS[name];
    const pts = def.joints.map(j => jointPos(j, side));
    const segs = [];
    let total = 0;
    for (let i = 0; i < pts.length - 1; i++) {
      const d = sub(pts[i + 1], pts[i]);
      const L = len(d);
      segs.push({ a: pts[i], b: pts[i + 1], axis: norm(d), L, start: total });
      total += L;
    }
    for (const s of segs) { s.u0 = s.start / total; s.u1 = (s.start + s.L) / total; }

    /* front reference, transported segment to segment */
    let ref;
    if (def.transportFrom) {
      const prev = frames[def.transportFrom + (def.sided ? '.' + side : '')];
      const last = prev.segs[prev.segs.length - 1];
      ref = rotateToward(last.ref, last.axis, segs[0].axis);
    } else {
      ref = front.slice();
    }
    for (let i = 0; i < segs.length; i++) {
      if (i > 0) ref = rotateToward(segs[i - 1].ref, segs[i - 1].axis, segs[i].axis);
      /* re-orthogonalise so drift cannot accumulate */
      let r = sub(ref, mul(segs[i].axis, dot(ref, segs[i].axis)));
      if (len(r) < 1e-4) r = sub(front, mul(segs[i].axis, dot(front, segs[i].axis)));
      segs[i].ref = norm(r);
      /* outward-facing binormal, so +90 degrees always means "away from the
         midline" whichever side we are on */
      let bin = norm(cross(segs[i].axis, segs[i].ref));
      const lateral = side === 'R' ? mul(left, -1) : left;
      if (dot(bin, lateral) < 0) bin = mul(bin, -1);
      segs[i].bin = bin;
      ref = segs[i].ref;
    }
    return { segs, total, pts };
  };

  for (const [name, def] of Object.entries(CHAINS)) {
    if (def.sided) for (const s of ['L', 'R']) frames[name + '.' + s] = buildFrame(name, s);
    else frames[name] = buildFrame(name, 'L');
  }
  return frames;
}

/* The MakeHuman rig stores each joint as a small cube of helper vertices. */
export function rigJoints(P, skel) {
  return (name, side) => {
    const n = side === 'R' ? name.replace('.L__', '.R__') : name;
    const verts = skel.joints[n] || skel.joints[name];
    if (!verts) throw new Error('unknown joint ' + n);
    return jointCentre(P, verts);
  };
}

/* project a vertex into a frame: distance along, angle around, radius */
export function project(frame, p) {
  let best = null;
  for (let i = 0; i < frame.segs.length; i++) {
    const s = frame.segs[i];
    const d = sub(p, s.a);
    let t = dot(d, s.axis) / s.L;
    const tc = i === 0 ? Math.min(t, 1) : i === frame.segs.length - 1 ? Math.max(t, 0) : clamp(t, 0, 1);
    const foot = add(s.a, mul(s.axis, tc * s.L));
    const r = sub(p, foot);
    const dist = len(r);
    if (!best || dist < best.dist) {
      /* keep the raw t on the end segments so regions can reach past the joint */
      const uRaw = i === 0 ? t : i === frame.segs.length - 1 ? t : tc;
      best = {
        dist,
        u: (s.start + uRaw * s.L) / frame.total,
        th: Math.atan2(dot(r, s.bin), dot(r, s.ref)) / D2R,
        r: dist,
        seg: i,
      };
    }
  }
  return best;
}

/* The segment a given u falls on, and the point on the bone axis there. */
export function axisPoint(frame, u) {
  const seg = frame.segs.reduce((a, c) => (u >= c.u0 ? c : a), frame.segs[0]);
  const t = clamp((u * frame.total - seg.start) / seg.L, 0, 1);
  return { seg, foot: add(seg.a, mul(seg.axis, t * seg.L)) };
}
