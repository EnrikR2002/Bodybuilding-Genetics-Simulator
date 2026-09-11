/* ---------------------------------------------------------------------------
   Posing.

   A pose is evaluated once per edit: start from the rest surface (after the
   shape pipeline), add rest-space pose shapes (flexed biceps, lat flare…),
   solve the skeleton, skin every vertex on the CPU with dual quaternions,
   relax the shoulder transition, carry the eyes with the head, and recompute
   real surface normals.

   The rig has no rest rotations: every bone starts as identity at its head,
   so a local rotation is expressed in the body frame. The solver works in
   world rotations W[i] and posed joint positions P[i], and writes the local
   quaternions into the three.js bones at the end.

   - Torso: Euler rotations per segment (poses.js `body`).
   - Arms: humerus and forearm directions, or two-bone IK to a target placed
     relative to any posed bone. The humerus is aligned so the elbow bends
     about its anatomical hinge (measured from the sculpt's rest bend); the
     forearm is a pure hinge; the palm direction becomes supination carried
     by the forearm twist bone, and the shoulder helper takes part of the
     humeral twist.
   - Legs: the ball of the foot is placed on the floor, the heel pivots about
     it, the toes stay flat, and two-bone IK reaches the ankle. The pelvis
     drops when a stance is too wide for straight legs.
   - Hands: per-finger joint angles from GRIPS, about axes measured from the
     sculpt's own finger chains and palm.

   Everything resolves against the frame-edited skeleton, so limb lengths are
   always preserved.
   --------------------------------------------------------------------------- */
import { Matrix4, Quaternion, Vector3 } from "three";
import { POSE_BY_ID, GRIPS } from "./poses.js";
import { applyPoseShape, frameTransform } from "./shape/index.js";
import { smooth, clamp } from "./shape/context.js";
import { DIGITS, digitBone } from "./bones.js";
import { boneDualQuaternions, skinDualQuaternion, computeNormals } from "./geometry.js";

const DEG = Math.PI / 180;
const SIDES = [["L", 1], ["R", -1]];
const M0 = new Matrix4(), M1 = new Matrix4();
const UP = new Vector3(0, 1, 0);

/* ---------- small vector helpers ---------------------------------------- */
const v3 = (a) => new Vector3(a[0], a[1], a[2]);
const mirror = (a, sign) => new Vector3(sign * a[0], a[1], a[2]);
function euler(deg, sign = 1) {
  // [bend forward (about X), turn (about Y), lean (about Z)]; mirrored for the right side
  if (!deg) return new Quaternion();
  const [x, y, z] = deg;
  const qx = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), x * DEG);
  const qy = new Quaternion().setFromAxisAngle(UP, sign * y * DEG);
  const qz = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), sign * z * DEG);
  return qy.multiply(qx).multiply(qz);
}
const axisAngle = (axis, deg) => new Quaternion().setFromAxisAngle(axis.clone().normalize(), deg * DEG);
/* The rotation taking (a0, b0) to (a1, b1): a exactly, b as closely as it can. */
function alignFrames(a0, b0, a1, b1) {
  const x0 = a0.clone().normalize(), y0 = b0.clone().addScaledVector(x0, -b0.dot(x0)).normalize();
  const x1 = a1.clone().normalize(), y1 = b1.clone().addScaledVector(x1, -b1.dot(x1)).normalize();
  M0.makeBasis(x0, y0, x0.clone().cross(y0)).transpose();
  M1.makeBasis(x1, y1, x1.clone().cross(y1)).multiply(M0);
  return new Quaternion().setFromRotationMatrix(M1);
}
/* Twist of q about a unit axis (swing-twist decomposition, q = swing · twist). */
function twistOf(q, axis) {
  const d = q.x * axis.x + q.y * axis.y + q.z * axis.z;
  const t = new Quaternion(axis.x * d, axis.y * d, axis.z * d, q.w);
  const l = Math.hypot(t.x, t.y, t.z, t.w);
  return l < 1e-9 ? new Quaternion() : t.set(t.x / l, t.y / l, t.z / l, t.w / l);
}
const perpendicular = (v, axis) => v.clone().addScaledVector(axis, -v.dot(axis)).normalize();

/* The wrist's anatomical range, relative to the sculpt's rest hand (degrees):
   flexion toward the palm (+) / extension (−), radial (+) / ulnar (−)
   deviation, and the pronation/supination the forearm can carry. A pose that
   asks for more is clamped instead of collapsing the wrist. */
export const WRIST = { flex: [-70, 75], radial: [-35, 20], twist: 140 };
function limitWrist(rel, f0, palm, sign) {
  const q = rel.w < 0 ? new Quaternion(-rel.x, -rel.y, -rel.z, -rel.w) : rel.clone();
  const full = twistOf(q, f0), twist = full.clone();
  const t = 2 * Math.atan2(full.x * f0.x + full.y * f0.y + full.z * f0.z, full.w);
  if (Math.abs(t) > WRIST.twist * DEG) twist.setFromAxisAngle(f0, Math.sign(t) * WRIST.twist * DEG);
  const swing = q.multiply(full.clone().invert());
  if (swing.w < 0) swing.set(-swing.x, -swing.y, -swing.z, -swing.w);
  const s = Math.hypot(swing.x, swing.y, swing.z);
  if (s < 1e-9) return { twist, swing: new Quaternion() };
  const rv = new Vector3(swing.x, swing.y, swing.z).multiplyScalar(2 * Math.atan2(s, swing.w) / s);
  const pT = palm.clone().applyQuaternion(full);                 // the palm after pronation
  const flexAxis = f0.clone().cross(pT).normalize(), devAxis = perpendicular(pT, f0);
  const flex = clamp(rv.dot(flexAxis), WRIST.flex[0] * DEG, WRIST.flex[1] * DEG);
  const radial = clamp(sign * rv.dot(devAxis), WRIST.radial[0] * DEG, WRIST.radial[1] * DEG);
  const out = flexAxis.multiplyScalar(flex).addScaledVector(devAxis, sign * radial);
  const angle = out.length();
  return { twist, swing: angle < 1e-9 ? new Quaternion() : new Quaternion().setFromAxisAngle(out.divideScalar(angle), angle) };
}

/* ---------- once per sculpt -------------------------------------------- */
export function preparePose(ctx) {
  if (ctx.__pose) return ctx.__pose;
  const { base, n } = ctx;
  // The shoulder/axilla transition, where heat weights stretch small sculpt
  // folds into fins under arm elevation. Scaled per side by elevation.
  const relax = [], weights = [];
  for (let v = 0; v < n; v++) {
    const x = Math.abs(base[v * 3]), y = base[v * 3 + 1];
    const w = smooth(11, 17, x) * (1 - smooth(25, 32, x)) * smooth(123, 132, y) * (1 - smooth(143, 151, y));
    if (w > 0) { relax.push(v); weights.push(w * Math.sign(base[v * 3])); }
  }
  const index = {};
  for (const [name, b] of Object.entries(ctx.bones)) index[name] = b.index;
  ctx.__pose = { index, relax: Uint32Array.from(relax), relaxWeight: Float32Array.from(weights),
    // rest heel contact points (sculpt cm) for toes-up pivots; they follow frame edits
    heels: new Float32Array([12.3, 0.8, -8.6, -12.3, 0.8, -8.6]) };
  return ctx.__pose;
}

/* ---------- the solver ---------------------------------------------------- */
class Solver {
  constructor(fig, prep) {
    this.fig = fig;
    this.I = prep.index;
    this.defs = fig.data.meta.bones;
    this.W = this.defs.map(() => new Quaternion());
    this.P = fig.heads.map((h) => h.clone());
    this.done = new Uint8Array(this.defs.length);
    this.hips = new Vector3();
  }
  i(name) {
    const i = this.I[name];
    if (i === undefined) throw new RangeError(`Unknown bone: ${name}`);
    return i;
  }
  head(name) { return this.fig.heads[this.i(name)]; }
  tail(name) { return this.fig.tails[this.i(name)]; }
  axis(name) { return this.tail(name).clone().sub(this.head(name)).normalize(); }
  length(name) { return this.tail(name).distanceTo(this.head(name)); }
  parentW(i) { const p = this.defs[i].parent; return p < 0 ? new Quaternion() : this.W[p]; }
  /* Set a bone's world rotation; its head follows its parent. */
  set(name, q) {
    const i = this.i(name), p = this.defs[i].parent;
    this.W[i].copy(q);
    if (p < 0) this.P[i].copy(this.fig.heads[i]).add(this.hips);
    else this.P[i].copy(this.fig.heads[i]).sub(this.fig.heads[p]).applyQuaternion(this.W[p]).add(this.P[p]);
    this.done[i] = 1;
    return this.W[i];
  }
  /* Posed position of a rest-space point carried by a bone. */
  carry(name, restPoint) {
    const i = this.i(name);
    return restPoint.clone().sub(this.fig.heads[i]).applyQuaternion(this.W[i]).add(this.P[i]);
  }
  /* Posed wrist or ankle = tail of a bone. */
  end(name) { return this.carry(name, this.tail(name)); }
  /* Bones nobody posed follow their parent rigidly. */
  finish() {
    this.defs.forEach((d, i) => { if (!this.done[i]) this.set(d.name, this.parentW(i)); });
  }
}

/* Two-bone IK: joint directions reaching `target` from `root`, bending toward `pole`. */
function reach(root, target, a, b, pole) {
  const d = target.clone().sub(root);
  const D = clamp(d.length(), Math.abs(a - b) + 0.5, (a + b) * 0.9995);
  const dir = d.normalize();
  const side = perpendicular(pole, dir);
  const cosA = clamp((a * a + D * D - b * b) / (2 * a * D), -1, 1), sinA = Math.sqrt(1 - cosA * cosA);
  const elbow = root.clone().addScaledVector(dir, a * cosA).addScaledVector(side, a * sinA);
  const wrist = root.clone().addScaledVector(dir, D);
  return { upper: elbow.clone().sub(root).normalize(), lower: wrist.sub(elbow).normalize() };
}

/* Align a proximal bone to `u` so that the joint below bends about the
   anatomical hinge, then the distal bone is a pure hinge to `f`.
   u0/f0: rest directions. Returns world rotations of both. */
function hinge(u0, f0, u, f) {
  const h0 = u0.clone().cross(f0).normalize();
  // the minimal-twist hinge, used when the joint is nearly straight
  const fallback = perpendicular(h0.clone().applyQuaternion(new Quaternion().setFromUnitVectors(u0, u)), u);
  let h = u.clone().cross(f);
  const bend = Math.asin(clamp(h.length(), 0, 1));
  h = h.lengthSq() > 1e-10 ? h.normalize() : fallback.clone();
  const k = smooth(0.12, 0.35, bend);
  h = perpendicular(fallback.multiplyScalar(1 - k).add(h.multiplyScalar(k)), u);
  const Wu = alignFrames(u0, h0, u, h);
  const g = f0.clone().applyQuaternion(Wu);
  const Wf = new Quaternion().setFromUnitVectors(g, f).multiply(Wu);
  return { Wu, Wf };
}

function resolveSide(def, key, side) {
  const shared = def[key], own = def[key + side];
  if (!shared && !own) return null;
  return { ...(shared ?? {}), ...(own ?? {}) };
}

function poseTorso(S, def) {
  const b = def.body ?? {};
  let W = euler(b.pelvis);
  S.set("pelvis", W);
  for (const name of ["abdomen", "chest", "neck", "head"]) W = S.set(name, W.clone().multiply(euler(b[name])));
}

/* The pelvis position: requested offset, lowered when the feet are out of reach. */
function placeHips(S, def, feet) {
  const wanted = def.hips ? v3(def.hips) : new Vector3();
  S.hips.copy(wanted);
  let drop = 0;
  for (const { side, ankle } of feet) {
    const hip = S.fig.heads[S.i(`thigh.${side}`)].clone().sub(S.fig.heads[0]).applyQuaternion(S.W[0])
      .add(S.fig.heads[0]).add(wanted);
    const rest = S.head(`thigh.${side}`).distanceTo(S.head(`foot.${side}`)) * 0.998;
    const horizontal = Math.hypot(hip.x - ankle.x, hip.z - ankle.z);
    const vertical = Math.sqrt(Math.max(rest * rest - horizontal * horizontal, 1));
    drop = Math.min(drop, vertical - (hip.y - ankle.y));
  }
  S.hips.y += drop;
}

function footTargets(S, def, prep) {
  const heels = frameTransform(S.fig.ctx, S.fig.state, prep.heels.slice(), 0);
  return SIDES.map(([side, sign], k) => {
    const leg = resolveSide(def, "leg", side) ?? {};
    const ankle0 = S.head(`foot.${side}`), ball0 = S.head(`toe.${side}`);
    const turn = axisAngle(UP, sign * (leg.turn ?? 0));
    const lateral = new Vector3(1, 0, 0).applyQuaternion(turn);
    const pitch = axisAngle(lateral, leg.heel ?? 0);
    const Wfoot = pitch.clone().multiply(turn);
    const step = new Vector3(sign * (leg.step?.[0] ?? 0), 0, leg.step?.[1] ?? 0);
    // pivot on the ball for a raised heel, on the heel for raised toes
    const pivot0 = (leg.heel ?? 0) >= 0 ? ball0.clone() : new Vector3(heels[k * 3], heels[k * 3 + 1], heels[k * 3 + 2]);
    // the turn is about the ball of the foot, the pitch about the pivot
    const ballAfterTurn = ball0.clone().add(step);
    const pivot = pivot0.clone().sub(ball0).applyQuaternion(turn).add(ballAfterTurn);
    const ankle = ankle0.clone().sub(pivot0).applyQuaternion(Wfoot).add(pivot);
    const knee = leg.knee ? mirror(leg.knee, sign) : new Vector3(0.12 * sign, 0, 1).applyQuaternion(turn);
    return { side, sign, ankle, Wfoot, Wtoe: turn, knee };
  });
}

function poseLegs(S, feet) {
  for (const { side, ankle, Wfoot, Wtoe, knee } of feet) {
    // the posed hip joint (the thigh is not set yet, so carry it with the pelvis)
    const hip = S.carry("pelvis", S.head(`thigh.${side}`));
    const a = S.length(`thigh.${side}`), b = S.length(`shin.${side}`);
    const { upper, lower } = reach(hip, ankle, a, b, knee);
    const { Wu, Wf } = hinge(S.axis(`thigh.${side}`), S.axis(`shin.${side}`), upper, lower, S.W[0]);
    S.set(`thigh.${side}`, Wu);
    S.set(`shin.${side}`, Wf);
    S.set(`foot.${side}`, Wfoot);
    S.set(`toe.${side}`, Wtoe);
  }
}

/* Rest hand frame of one side: palm normal and finger flexion axes. */
function handFrame(S, side) {
  const wrist = S.head(`hand.${side}`);
  const index = S.head(`finger_index.01.${side}`), pinky = S.head(`finger_pinky.01.${side}`);
  const middle = S.head(`finger_middle.01.${side}`);
  const across = pinky.clone().sub(index).normalize();          // radial → ulnar
  const along = middle.clone().sub(wrist).normalize();
  const palm = side === "L" ? across.clone().cross(along) : along.clone().cross(across);
  palm.normalize();                                              // out of the palm
  return { across, along, palm, axis: S.axis(`hand.${side}`) };
}

function poseArm(S, def, side, sign) {
  const arm = resolveSide(def, "arm", side);
  const clav = `clavicle.${side}`, up = `upperarm.${side}`, fo = `forearm.${side}`, ha = `hand.${side}`;
  const Wchest = S.W[S.i("chest")];
  const Wc = S.set(clav, Wchest.clone().multiply(
    axisAngle(UP, -sign * (arm?.reach ?? 0)).multiply(axisAngle(new Vector3(0, 0, 1), sign * (arm?.shrug ?? 0)))));
  const frame = (a) => mirror(a, sign).applyQuaternion(Wchest).normalize();
  const u0 = S.axis(up), f0 = S.axis(fo);
  let u, f;
  if (!arm) { u = u0.clone().applyQuaternion(Wc); f = f0.clone().applyQuaternion(Wc); }
  else if (arm.ik) {
    const ref = arm.ik.from;
    const target = S.P[S.i(ref)].clone().add(mirror(arm.ik.to, sign).applyQuaternion(S.W[S.i(ref)]));
    // from the posed shoulder joint, carried by the clavicle
    ({ upper: u, lower: f } = reach(S.carry(clav, S.head(up)), target, S.length(up), S.length(fo), frame(arm.ik.pole)));
  } else { u = frame(arm.upper); f = frame(arm.fore); }
  const { Wu, Wf } = hinge(u0, f0, u, f, Wc);
  S.set(up, Wu);
  // The shoulder helper keeps the swing but only part of the humeral twist.
  const local = Wc.clone().invert().multiply(Wu), twist = twistOf(local, u0);
  const swing = local.clone().multiply(twist.clone().invert());
  S.set(`upperarm_support.${side}`, Wc.clone().multiply(swing.multiply(new Quaternion().slerp(twist, 0.45))));
  S.set(fo, Wf);
  // Hand orientation from the wanted knuckle and palm directions.
  const H = handFrame(S, side);
  let Wh;
  if (arm?.palm || arm?.hand) {
    const hd = arm.hand ? frame(arm.hand) : f.clone();
    const pn = arm.palm ? frame(arm.palm) : H.palm.clone().applyQuaternion(Wf);
    Wh = alignFrames(H.axis, H.palm, hd, pn);
  } else Wh = Wf.clone();
  // Pronation and supination go to the twist helper; flexion and deviation
  // stay within the wrist's range.
  const wrist = limitWrist(Wf.clone().invert().multiply(Wh), f0, H.palm, sign);
  S.set(`forearm_twist.${side}`, Wf.clone().multiply(wrist.twist));
  Wh = Wf.clone().multiply(wrist.swing).multiply(wrist.twist);
  S.set(ha, Wh);
  poseHand(S, side, Wh, H, arm?.grip);
}

function poseHand(S, side, Wh, H, gripName) {
  const grip = typeof gripName === "string" ? GRIPS[gripName] : gripName;
  if (!grip) return;
  for (const digit of DIGITS) {
    const key = digit === "thumb" ? "thumb" : digit.slice(7);
    const angles = grip[key];
    if (!angles) continue;
    const bones = [1, 2, 3].map((k) => digitBone(digit, k, side));
    const dirs = bones.map((b) => S.axis(b));
    let Wp = Wh, locals;
    if (digit === "thumb") {
      const [across, away, roll, mcp, ip] = angles;
      const d = dirs[0];
      const acrossDir = perpendicular(H.across, d), awayDir = perpendicular(H.palm, d);
      // the thumb's own flexion folds toward the palm and across it
      const fold = perpendicular(H.across.clone().add(H.palm.clone().multiplyScalar(0.8)), dirs[1]);
      locals = [
        axisAngle(d.clone().cross(acrossDir), across).multiply(axisAngle(d.clone().cross(awayDir), away))
          .multiply(axisAngle(d, (side === "L" ? -1 : 1) * roll)),
        axisAngle(dirs[1].clone().cross(fold), mcp),
        axisAngle(dirs[2].clone().cross(perpendicular(fold, dirs[2])), ip),
      ];
    } else {
      const [mcp, pip, dip, spread] = angles;
      const away = key === "index" ? H.across.clone().negate() : H.across.clone();
      const spin = d => (d.clone().cross(H.palm).dot(away) > 0 ? -1 : 1);
      const splay = axisAngle(H.palm, spin(dirs[0]) * spread);
      const d0 = dirs[0].clone().applyQuaternion(splay);
      locals = [
        axisAngle(d0.clone().cross(H.palm), mcp).multiply(splay),
        axisAngle(dirs[1].clone().cross(H.palm), pip),
        axisAngle(dirs[2].clone().cross(H.palm), dip),
      ];
    }
    for (let k = 0; k < 3; k++) Wp = S.set(bones[k], Wp.clone().multiply(locals[k]));
  }
}

/* ---------- writing the rig and the surface ------------------------------- */
function writeBones(fig, S) {
  const { W, defs } = S;
  defs.forEach((d, i) => {
    const bone = fig.bones[i];
    if (d.parent < 0) {
      bone.quaternion.copy(W[i]);
      bone.position.copy(fig.heads[i]).add(S.hips);
    } else bone.quaternion.copy(W[d.parent]).invert().multiply(W[i]);
  });
}

function relaxShoulders(fig, prep, strength) {
  if (strength[0] <= 0 && strength[1] <= 0) return;
  const p = fig.positions, { offsets, list } = fig.ctx.adjacency();
  const { relax, relaxWeight } = prep, tmp = (fig.__relaxTmp ??= new Float32Array(relax.length * 3));
  for (let pass = 0; pass < 8; pass++) {
    for (let i = 0; i < relax.length; i++) {
      const v = relax[i], o0 = offsets[v], o1 = offsets[v + 1];
      let x = 0, y = 0, z = 0;
      for (let o = o0; o < o1; o++) { const n = list[o] * 3; x += p[n]; y += p[n + 1]; z += p[n + 2]; }
      const rw = relaxWeight[i], c = o1 - o0, w = Math.abs(rw) * 0.55 * strength[rw > 0 ? 0 : 1], o = v * 3;
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

/* Eyes and eyebrows are rigid to the head. */
function poseExtras(fig, Whead, headRest, headPosed) {
  for (const e of fig.extras) {
    const pos = e.geometry.attributes.position, nor = e.geometry.attributes.normal;
    const restNormal = (e.userData.restNormal ??= nor.array.slice());
    pos.array.set(e.userData.base);
    frameTransform(fig.ctx, fig.state, pos.array, 0, 1); // the eyes belong to the head: head size carries them
    nor.array.set(restNormal);
    if (Whead) {
      const V = new Vector3();
      for (let o = 0; o < pos.array.length; o += 3) {
        V.fromArray(pos.array, o).sub(headRest).applyQuaternion(Whead).add(headPosed).toArray(pos.array, o);
        V.fromArray(nor.array, o).applyQuaternion(Whead).toArray(nor.array, o);
      }
    }
    pos.needsUpdate = true;
    nor.needsUpdate = true;
    e.geometry.computeBoundingSphere();
  }
}

export function applyPose(fig, id) {
  const def = POSE_BY_ID[id];
  if (!def) throw new RangeError(`Unknown pose: ${id}`);
  const prep = preparePose(fig.ctx);
  fig.pose = id;
  fig.positions.set(fig.restPositions);
  applyPoseShape(fig.ctx, fig.state, def, fig.positions, { heads: fig.heads, tails: fig.tails });
  const location = fig.root.position.clone();
  fig.root.position.set(0, 0, 0);
  const g = fig.geometry;
  if (def.rest) {
    fig.bones.forEach((b, i) => {
      b.quaternion.identity();
      b.position.copy(fig.heads[i]);
      const p = fig.data.meta.bones[i].parent;
      if (p >= 0) b.position.sub(fig.heads[p]);
    });
    fig.root.updateMatrixWorld(true);
    fig.skeleton.update();
    poseExtras(fig, null);
  } else {
    const S = new Solver(fig, prep);
    poseTorso(S, def);
    const feet = footTargets(S, def, prep);
    placeHips(S, def, feet);
    poseTorso(S, def); // again, now that the pelvis has its final height
    poseLegs(S, feet);
    // an arm that holds the other hand is solved second
    const order = SIDES.slice().sort(([a], [b]) =>
      (resolveSide(def, "arm", a)?.ik?.from?.endsWith(`.${b}`) ? 1 : 0) - (resolveSide(def, "arm", b)?.ik?.from?.endsWith(`.${a}`) ? 1 : 0));
    for (const [side, sign] of order) poseArm(S, def, side, sign);
    S.finish();
    writeBones(fig, S);
    fig.root.updateMatrixWorld(true);
    fig.skeleton.update();
    fig.__dq = boneDualQuaternions(fig.skeleton, fig.__dq);
    skinDualQuaternion(fig.__dq, fig.data.skinIndex, fig.data.skinWeight, fig.positions, fig.positions);
    // shoulder relax scaled by how far each humerus is raised
    const lift = SIDES.map(([side]) => smooth(-0.75, 0.2, UP.dot(S.axis(`upperarm.${side}`).applyQuaternion(S.W[S.i(`upperarm.${side}`)]))));
    relaxShoulders(fig, prep, lift);
    const h = S.i("head");
    poseExtras(fig, S.W[h], fig.heads[h], S.P[h]);
  }
  fig.root.position.copy(location);
  fig.root.updateMatrixWorld(true);
  g.attributes.position.needsUpdate = true;
  computeNormals(fig.data.index, fig.positions, g.attributes.normal.array);
  g.attributes.normal.needsUpdate = true;
  g.computeBoundingBox();
  g.computeBoundingSphere();
}
