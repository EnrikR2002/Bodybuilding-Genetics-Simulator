/* ---------------------------------------------------------------------------
   Frame: the skeletal traits.

   Local edits in the sculpt's own frame come first — waist width, joint size
   and head size — then one global transform for shoulder, rib cage and
   pelvis width and the bone lengths. The global transform is also applied to
   the rig joints and to the eyes and eyebrows, so the rig always follows the
   surface. It runs last in the rest-space pipeline, after every muscle stage.

   `point(P, arr, o, arm, head)` transforms the point at arr[o..o+2] in place:
   `arm` is the point's arm weight (1 for arm joints), `head` its head weight
   (1 for the eyes and the head bone). Every edit is skipped at its default,
   so the neutral figure stays the sculpt bit for bit.
   --------------------------------------------------------------------------- */
import { clamp, smooth } from "./context.js";

/* Joints thickened by boneThickness: [bone, end, sigma (cm), amplitude, region]. */
const JOINTS = [
  ["forearm", "tail", 4, 0.1, "arm"],   // wrist
  ["forearm", "head", 4, 0.04, "arm"],  // elbow
  ["shin", "tail", 5, 0.1, "leg"],      // ankle
  ["shin", "head", 6, 0.07, "leg"],     // knee
];

export function params(ctx, s) {
  const P = {
    clav: (s.clavicle - 0.5) * 2,
    hip: (s.hipWidth - 0.5) * 2,
    rib: (s.ribcage - 0.5) * 2,
    armA: (s.armLength - 0.5) * 0.24,
    leg: (s.legLength - 0.5) * 0.2,
    torso: (s.torsoLength - 0.5) * 0.2,
    waist: (s.waist - 0.5) * 2,
    bone: (s.boneThickness - 0.5) * 2,
    head: (s.headSize - 0.5) * 2,
    shL: ctx.bones["upperarm.L"].head,
    shR: ctx.bones["upperarm.R"].head,
    headC: ctx.bones.head.head,
    waistZ: ctx.bones.pelvis.head[2],
  };
  P.global = !!(P.clav || P.hip || P.rib || P.armA || P.leg || P.torso);
  P.neutral = !P.global && !P.waist && !P.bone && !P.head;
  return P;
}

export function point(P, arr, o, arm, head = 0) {
  if (head && P.head) {
    const k = P.head * 0.11 * head, c = P.headC;
    arr[o] += (arr[o] - c[0]) * k;
    arr[o + 1] += (arr[o + 1] - c[1]) * k;
    arr[o + 2] += (arr[o + 2] - c[2]) * k;
  }
  if (!P.global) return;
  let px = arr[o], py = arr[o + 1], pz = arr[o + 2];
  const sign = Math.sign(px), x = px, y = py;
  px += sign * P.clav * 3.7 * Math.max(arm, smooth(123, 145, y) * (1 - smooth(158, 170, y)) * smooth(3, 20, Math.abs(x)));
  px += x * P.hip * 0.12 * (1 - smooth(96, 120, y));
  const rib = P.rib * smooth(107, 119, y) * (1 - smooth(141, 151, y)) * (1 - arm);
  px *= 1 + rib * 0.075;
  pz *= 1 + rib * 0.13;
  if (arm > 0.001) {
    const sh = sign > 0 ? P.shL : P.shR, a = P.armA * arm;
    px += (x - sh[0]) * a;
    py += (y - sh[1]) * a;
    pz += (pz - sh[2]) * a;
  }
  py += Math.min(py, 94) * P.leg + clamp(py - 94, 0, 53) * P.torso;
  arr[o] = px; arr[o + 1] = py; arr[o + 2] = pz;
}

export default {
  id: "frame",
  traits: ["clavicle", "ribcage", "hipWidth", "waist", "torsoLength", "armLength", "legLength",
    "boneThickness", "headSize"],
  prepare(ctx) {
    const { base, arm, leg, n } = ctx;
    const waist = new Float32Array(n), head = new Float32Array(n);
    for (let v = 0; v < n; v++) {
      const y = base[v * 3 + 1];
      // between the lower ribs and the iliac crest, trunk only
      waist[v] = (1 - arm[v]) * (1 - leg[v]) * smooth(92, 99, y) * (1 - smooth(112, 122, y));
      // the head above the jaw, fading down into the neck
      head[v] = (1 - arm[v]) * smooth(159, 166, y);
    }
    const joints = [];
    for (const [boneName, end, sigma, amp, region] of JOINTS)
      for (const side of ["L", "R"]) {
        const b = ctx.bones[`${boneName}.${side}`], c = b[end], ax = b.axis, w = ctx[region];
        const verts = [], weight = [], radial = [];
        for (let v = 0; v < n; v++) {
          if (w[v] < 0.3 || (base[v * 3] > 0) !== (side === "L")) continue;
          const dx = base[v * 3] - c[0], dy = base[v * 3 + 1] - c[1], dz = base[v * 3 + 2] - c[2];
          const d = dx * ax[0] + dy * ax[1] + dz * ax[2];
          if (Math.abs(d) > 3 * sigma) continue;
          const rx = dx - ax[0] * d, ry = dy - ax[1] * d, rz = dz - ax[2] * d;
          if (Math.hypot(rx, ry, rz) > 14) continue;
          verts.push(v);
          weight.push(amp * Math.min(1, w[v]) * Math.exp(-((d / sigma) ** 2)));
          radial.push(rx, ry, rz);
        }
        joints.push({ verts: Uint32Array.from(verts), weight: Float32Array.from(weight), radial: Float32Array.from(radial) });
      }
    return { waist, head, joints };
  },
  apply(ctx, r, s, out) {
    const P = params(ctx, s);
    if (P.neutral) return;
    const n = ctx.n;
    if (P.waist)
      for (let v = 0; v < n; v++) {
        const w = r.waist[v];
        if (!w) continue;
        const o = v * 3, k = P.waist * 0.09 * w;
        out[o] += out[o] * k;
        out[o + 2] += (out[o + 2] - P.waistZ) * k * 0.6;
      }
    if (P.bone)
      for (const J of r.joints)
        for (let i = 0; i < J.verts.length; i++) {
          const o = J.verts[i] * 3, k = P.bone * J.weight[i];
          out[o] += J.radial[i * 3] * k;
          out[o + 1] += J.radial[i * 3 + 1] * k;
          out[o + 2] += J.radial[i * 3 + 2] * k;
        }
    if (P.head) {
      const c = P.headC;
      for (let v = 0; v < n; v++) {
        const w = r.head[v];
        if (!w) continue;
        const o = v * 3, k = P.head * 0.11 * w;
        out[o] += (out[o] - c[0]) * k;
        out[o + 1] += (out[o + 1] - c[1]) * k;
        out[o + 2] += (out[o + 2] - c[2]) * k;
      }
    }
    if (P.global) for (let v = 0; v < n; v++) point(P, out, v * 3, ctx.arm[v]);
  },
};
