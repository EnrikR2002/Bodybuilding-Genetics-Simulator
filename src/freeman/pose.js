/* ---------------------------------------------------------------------------
   Posing.

   A pose is evaluated once per edit: start from the rest surface (after the
   shape pipeline), add rest-space pose shapes (finger curl, flexed biceps, lat
   flare), aim the bones, skin every vertex on the CPU with dual quaternions,
   relax the shoulder transition, and recompute real surface normals.
   Interpolated rest normals would otherwise invent creases at a bent joint.

   Directions in poses.js are in the physique's frame (+X outward on the left,
   +Z forward) and resolve against the frame-edited skeleton, so limb lengths
   are always preserved.
   --------------------------------------------------------------------------- */
import { Quaternion, Vector3 } from "three";
import { POSE_BY_ID } from "./poses.js";
import { applyPoseShape } from "./shape/index.js";
import { smooth } from "./shape/context.js";
import { boneDualQuaternions, skinDualQuaternion, computeNormals } from "./geometry.js";

const V = new Vector3(), Q = new Quaternion();

export function preparePose(ctx) {
  if (ctx.__pose) return ctx.__pose;
  const { base, hand, n } = ctx;
  const hands = ["L", "R"].map((side) => {
    const b = ctx.bones[`hand.${side}`];
    const axis = new Vector3().fromArray(b.axis);
    const palm = new Vector3(side === "L" ? -0.5 : 0.5, -0.75, 0.43);
    palm.addScaledVector(axis, -palm.dot(axis)).normalize();
    const across = new Vector3().crossVectors(axis, palm);
    const verts = [];
    for (let v = 0; v < n; v++)
      if (hand[v] >= 0.5 && (base[v * 3] > 0) === (side === "L")) verts.push(v);
    return { index: b.index, axis, palm, across, verts: Uint32Array.from(verts) };
  });
  // The shoulder/axilla transition, where heat weights stretch small sculpt
  // folds into fins under arm elevation.
  const relax = [], weights = [];
  for (let v = 0; v < n; v++) {
    const x = Math.abs(base[v * 3]), y = base[v * 3 + 1];
    const w = smooth(11, 17, x) * (1 - smooth(25, 32, x)) * smooth(123, 132, y) * (1 - smooth(143, 151, y));
    if (w > 0) { relax.push(v); weights.push(w); }
  }
  ctx.__pose = { hands, relax: Uint32Array.from(relax), relaxWeight: Float32Array.from(weights) };
  return ctx.__pose;
}

/* A continuous finger curl that keeps the sculpted fingers and knuckles.
   Rest space, before skinning. */
function curlFingers(fig, prep) {
  const p = fig.positions, hand = fig.ctx.hand, start = 9.5, radius = 3.4;
  const offset = new Vector3();
  for (const h of prep.hands) {
    const head = fig.heads[h.index];
    for (const v of h.verts) {
      V.fromArray(p, v * 3);
      offset.subVectors(V, head);
      const along = offset.dot(h.axis), depth = offset.dot(h.palm) + 0.4;
      if (along <= start) continue;
      const angle = Math.min((along - start) / radius, 3.7);
      const remainder = Math.max(0, along - start - 3.7 * radius);
      const length = start + Math.sin(angle) * (radius - depth) + remainder * Math.cos(angle);
      const inward = radius - Math.cos(angle) * (radius - depth) + remainder * Math.sin(angle);
      const weight = smooth(0.5, 0.95, hand[v]);
      V.addScaledVector(h.axis, (length - along) * weight);
      V.addScaledVector(h.palm, (inward - depth) * weight);
      V.addScaledVector(h.across, -offset.dot(h.across) * 0.32 * smooth(start, 18, along) * weight);
      V.toArray(p, v * 3);
    }
  }
}

function aimBones(fig, def) {
  for (const side of ["L", "R"]) {
    const sign = side === "L" ? 1 : -1;
    fig.byName[`clavicle.${side}`].rotation.z = sign * (def.shoulder ?? 0);
    const aim = (name, d) => {
      const i = fig.boneIndex(`${name}.${side}`), bone = fig.bones[i];
      bone.parent.updateWorldMatrix(true, false);
      bone.parent.getWorldQuaternion(Q);
      const target = V.set(sign * d[0], d[1], d[2]).normalize().applyQuaternion(Q.invert());
      bone.quaternion.setFromUnitVectors(fig.tails[i].clone().sub(fig.heads[i]).normalize(), target);
    };
    aim("upperarm", def.upper);
    // The shoulder support must follow elevation; leaving it in the rest
    // stance tethers the deltoid while the elbow moves away.
    fig.byName[`upperarm_support.${side}`].quaternion.copy(fig.byName[`upperarm.${side}`].quaternion);
    aim("forearm", def.fore);
    aim("hand", def.hand);
  }
}

function relaxShoulders(fig, prep) {
  const p = fig.positions, { offsets, list } = fig.ctx.adjacency();
  const { relax, relaxWeight } = prep, tmp = (fig.__relaxTmp ??= new Float32Array(relax.length * 3));
  for (let pass = 0; pass < 8; pass++) {
    for (let i = 0; i < relax.length; i++) {
      const v = relax[i], o0 = offsets[v], o1 = offsets[v + 1];
      let x = 0, y = 0, z = 0;
      for (let o = o0; o < o1; o++) { const n = list[o] * 3; x += p[n]; y += p[n + 1]; z += p[n + 2]; }
      const c = o1 - o0, w = relaxWeight[i] * 0.55, o = v * 3;
      tmp[i * 3] = p[o] + (x / c - p[o]) * w;
      tmp[i * 3 + 1] = p[o + 1] + (y / c - p[o + 1]) * w;
      tmp[i * 3 + 2] = p[o + 2] + (z / c - p[o + 2]) * w;
    }
    for (let i = 0; i < relax.length; i++) {
      const o = relax[i] * 3;
      p[o] = tmp[i * 3]; p[o + 1] = tmp[i * 3 + 1]; p[o + 2] = tmp[i * 3 + 2];
    }
  }
}

export function applyPose(fig, id) {
  const def = POSE_BY_ID[id];
  if (!def) throw new RangeError(`Unknown pose: ${id}`);
  const prep = preparePose(fig.ctx);
  fig.pose = id;
  for (const b of fig.bones) b.quaternion.identity();
  fig.positions.set(fig.restPositions);
  if (def.upper) curlFingers(fig, prep);
  applyPoseShape(fig.ctx, fig.state, def, fig.positions, { heads: fig.heads, tails: fig.tails });
  if (id === "flex")
    for (const side of ["L", "R"]) {
      const i = fig.boneIndex(`forearm.${side}`);
      const bend = new Vector3(side === "L" ? 0.1 : -0.1, 0.93, 0.35).normalize();
      fig.bones[i].quaternion.setFromUnitVectors(fig.tails[i].clone().sub(fig.heads[i]).normalize(), bend);
    }
  if (def.upper) aimBones(fig, def);
  const location = fig.root.position.clone();
  fig.root.position.set(0, 0, 0);
  fig.root.updateMatrixWorld(true);
  fig.skeleton.update();
  if (id !== "anatomy") {
    fig.__dq = boneDualQuaternions(fig.skeleton, fig.__dq);
    skinDualQuaternion(fig.__dq, fig.data.skinIndex, fig.data.skinWeight, fig.positions, fig.positions);
  }
  if (def.upper) relaxShoulders(fig, prep);
  fig.root.position.copy(location);
  fig.root.updateMatrixWorld(true);
  const g = fig.geometry;
  g.attributes.position.needsUpdate = true;
  computeNormals(fig.data.index, fig.positions, g.attributes.normal.array);
  g.attributes.normal.needsUpdate = true;
  g.computeBoundingBox();
  g.computeBoundingSphere();
}
