/* ---------------------------------------------------------------------------
   Posing by target, not by angle.

   A pose is written as "put the hand here, point the elbow there", not as a
   list of Euler angles. That matters because the body changes shape while the
   app is open: hand-tuned angles that look right on a short-armed figure put
   the hands through the head on a long-armed one. Solving to a target keeps
   the pose meaning the same on every physique.

   The solver is the closed-form two-bone one — law of cosines for the joint
   angle, a pole vector for which way it points. No iteration, no jitter, and
   the elbow can only bend one way because the pole fixes the plane before the
   angle is applied.

   Every bone rests with no rotation of its own (see skeleton.js), so a bone's
   world rotation is the product of the local rotations above it, and the
   rotation that aims a bone is the shortest one from its rest direction to
   where it should point. All of this happens in skeleton space, which is the
   same space the rest joints were measured in.
   --------------------------------------------------------------------------- */
import { Vector3, Quaternion } from 'three';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const _v1 = new Vector3(), _v2 = new Vector3(), _v3 = new Vector3();
const _q1 = new Quaternion(), _q2 = new Quaternion(), _q3 = new Quaternion();

/* Split a rotation into "where it points" and "how far it rolls about that".
   Used to keep the humerus from twisting into a candy wrapper: the swing is
   whatever the target asks for, the roll is clamped and shared out along the
   twist bones the way a real forearm shares pronation. */
export function swingTwist(q, axis, outSwing, outTwist) {
  const d = axis.x * q.x + axis.y * q.y + axis.z * q.z;
  outTwist.set(axis.x * d, axis.y * d, axis.z * d, q.w);
  if (outTwist.lengthSq() < 1e-9) outTwist.identity(); else outTwist.normalize();
  if (outTwist.w < 0) outTwist.set(-outTwist.x, -outTwist.y, -outTwist.z, -outTwist.w);
  outSwing.copy(q).multiply(_q3.copy(outTwist).invert());
  return outSwing;
}

/* Where the two segments should point so the end lands on the target.
   Uses its own scratch vectors: callers pass in vectors they still need, and
   sharing a temp with the caller quietly zeroes the root. */
const _sRoot = new Vector3(), _sAim = new Vector3(), _sPole = new Vector3();
export function solveTwoBone(root, L1, L2, target, pole, out) {
  _sRoot.copy(root);
  _sPole.copy(pole);
  _sAim.copy(target).sub(_sRoot);
  let d = _sAim.length();
  d = clamp(d, Math.abs(L1 - L2) + L1 * 0.03, (L1 + L2) * 0.995);
  if (_sAim.lengthSq() < 1e-8) _sAim.set(0, -1, 0);
  _sAim.normalize();

  /* the pole, made perpendicular to the target line: this is the plane the
     joint bends in, and it is why the elbow cannot fold backwards */
  _sPole.addScaledVector(_sAim, -_sPole.dot(_sAim));
  if (_sPole.lengthSq() < 1e-8) {
    _sPole.set(0, 1, 0).addScaledVector(_sAim, -_sAim.y);
    if (_sPole.lengthSq() < 1e-8) _sPole.set(1, 0, 0).addScaledVector(_sAim, -_sAim.x);
  }
  _sPole.normalize();

  const cosA = clamp((L1 * L1 + d * d - L2 * L2) / (2 * L1 * d), -1, 1);
  const A = Math.acos(cosA);
  out.dir1.copy(_sAim).multiplyScalar(Math.cos(A)).addScaledVector(_sPole, Math.sin(A)).normalize();
  out.mid.copy(_sRoot).addScaledVector(out.dir1, L1);
  out.end.copy(_sRoot).addScaledVector(_sAim, d);
  out.dir2.copy(out.end).sub(out.mid).normalize();
  return out;
}

/* ---------------------------------------------------------------------------
   The rig: forward walk for positions, then two-bone solves for the limbs.
   --------------------------------------------------------------------------- */
export class PoseRig {
  constructor(skel) {
    this.skel = skel;
    const n = skel.n;
    this.pos = new Float32Array(n * 3);        /* joint head in skeleton space */
    this.quat = new Float32Array(n * 4);       /* accumulated world rotation */
    this.index = {};
    skel.defs.forEach((d, i) => { this.index[d.name] = i; });

    this.limbs = {};
    for (const side of ['L', 'R']) {
      this.limbs['arm' + side] = this._limb(
        `upperarm01.${side}`, `upperarm02.${side}`, `lowerarm01.${side}`, `lowerarm02.${side}`);
      this.limbs['leg' + side] = this._limb(
        `upperleg01.${side}`, `upperleg02.${side}`, `lowerleg01.${side}`, `lowerleg02.${side}`);
    }
    this.solve = { dir1: new Vector3(), dir2: new Vector3(), mid: new Vector3(), end: new Vector3() };
    this._root = new Vector3();
    this._target = new Vector3();
    this._pole = new Vector3();
    this._gripCenter = new Vector3();
    this.armLen = 60; this.legLen = 85;
  }

  _limb(a, aT, b, bT) {
    return {
      root: a, rootTwist: aT, mid: b, midTwist: bT,
      restDir1: new Vector3(), restDir2: new Vector3(), L1: 1, L2: 1,
    };
  }

  /* Re-read rest lengths and directions. Called whenever the body changes
     shape, because the skeleton is derived from the mesh and moves with it. */
  refresh() {
    const s = this.skel;
    for (const key of Object.keys(this.limbs)) {
      const L = this.limbs[key];
      s.restHead(L.root, _v1);
      s.restHead(L.mid, _v2);
      s.restTail(L.midTwist, _v3);
      L.restDir1.copy(_v2).sub(_v1);
      L.L1 = L.restDir1.length() || 1;
      L.restDir1.divideScalar(L.L1);
      L.restDir2.copy(_v3).sub(_v2);
      L.L2 = L.restDir2.length() || 1;
      L.restDir2.divideScalar(L.L2);
    }
    this.armLen = this.limbs.armL.L1 + this.limbs.armL.L2;
    this.legLen = this.limbs.legL.L1 + this.limbs.legL.L2;
    this._refreshHands();
    return this;
  }

  /* Work out which way the fingers bend, from the hand's own geometry rather
     than from a guessed axis: the knuckle line is the hinge, and the palm
     side is whichever side the thumb sits on. */
  _refreshHands() {
    const s = this.skel;
    this.hand = {};
    for (const side of ['L', 'R']) {
      if (!s.byName[`finger3-1.${side}`]) continue;
      s.restHead(`finger3-1.${side}`, _v1);
      s.restTail(`finger3-3.${side}`, _v2);
      const dir = _v2.clone().sub(_v1).normalize();
      s.restHead(`finger2-1.${side}`, _v1);
      s.restHead(`finger5-1.${side}`, _v2);
      const across = _v2.clone().sub(_v1).normalize();
      /* The thumb opposes the fingers, so the part of the thumb that points
         neither along the fingers nor across the knuckles points out of the
         palm. That is the side the fingers curl toward. */
      s.restHead(`finger1-1.${side}`, _v1);
      s.restTail(`finger1-3.${side}`, _v2);
      const thumb = _v2.clone().sub(_v1);
      const palm = thumb.clone()
        .addScaledVector(dir, -thumb.dot(dir))
        .addScaledVector(across, -thumb.dot(across));
      if (palm.lengthSq() < 1e-8) palm.copy(across).cross(dir);
      palm.normalize();
      const axis = across.clone();
      const test = dir.clone().applyAxisAngle(axis, 0.3).sub(dir);
      if (test.dot(palm) < 0) axis.negate();
      /* The thumb closes in the plane of the palm, not around the knuckle
         hinge used by the four fingers. Pick the sign that swings it toward
         the fingertips so a clenched pose does not make a "shaka" silhouette. */
      const thumbAxis = palm.clone();
      const td = thumb.clone().normalize();
      if (td.clone().applyAxisAngle(thumbAxis, -0.3).dot(dir) >
          td.clone().applyAxisAngle(thumbAxis, 0.3).dot(dir)) thumbAxis.negate();
      this.hand[side] = { axis, thumbAxis, dir, palm };
    }
  }

  /* Curl every finger by the same amount. A relaxed hand is never flat. */
  handCurl(amount, side) {
    const h = this.hand && this.hand[side];
    if (!h) return;
    const s = this.skel;
    for (let f = 1; f <= 5; f++) {
      for (let seg = 1; seg <= 3; seg++) {
        const b = s.byName[`finger${f}-${seg}.${side}`];
        if (!b) continue;
        /* the thumb folds less and on a different plane from the fingers */
        /* A half-curled thumb sticks straight out of a fist and dominates the
           silhouette. Fold it across the fingers as the grip closes. */
        const k = f === 1 ? 0.78 : 1;
        const taper = seg === 1 ? 0.85 : seg === 2 ? 1.15 : 0.95;
        b.quaternion.setFromAxisAngle(f === 1 ? h.thumbAxis : h.axis, amount * k * taper);
      }
    }
  }

  /* Walk the whole skeleton once: position and world rotation for every bone,
     from the local rotations currently on them. Parents come first in the
     bone list, so one pass is enough. */
  forward() {
    const s = this.skel, defs = s.defs, rl = s.restLocal;
    const { pos, quat } = this;
    for (let i = 0; i < defs.length; i++) {
      const p = defs[i].parent;
      const b = s.bones[i];
      const o = i * 3, qo = i * 4;
      if (p < 0) {
        pos[o] = rl[o]; pos[o + 1] = rl[o + 1]; pos[o + 2] = rl[o + 2];
        _q1.copy(b.quaternion);
      } else {
        const po = p * 3, pqo = p * 4;
        _q2.set(quat[pqo], quat[pqo + 1], quat[pqo + 2], quat[pqo + 3]);
        _v1.set(rl[o], rl[o + 1], rl[o + 2]).applyQuaternion(_q2);
        pos[o] = pos[po] + _v1.x;
        pos[o + 1] = pos[po + 1] + _v1.y;
        pos[o + 2] = pos[po + 2] + _v1.z;
        _q1.copy(_q2).multiply(b.quaternion);
      }
      quat[qo] = _q1.x; quat[qo + 1] = _q1.y; quat[qo + 2] = _q1.z; quat[qo + 3] = _q1.w;
    }
    return this;
  }

  jointPos(name, out = new Vector3()) {
    const i = this.index[name];
    return i === undefined ? out.set(0, 0, 0)
      : out.set(this.pos[i * 3], this.pos[i * 3 + 1], this.pos[i * 3 + 2]);
  }

  worldQuat(name, out = new Quaternion()) {
    const i = this.index[name];
    return i === undefined ? out.identity()
      : out.set(this.quat[i * 4], this.quat[i * 4 + 1], this.quat[i * 4 + 2], this.quat[i * 4 + 3]);
  }

  /* ---------------------------------------------------------------------- *
     Aim one limb at a target.
   * ---------------------------------------------------------------------- */
  aimLimb(key, target, pole, roll) {
    const L = this.limbs[key], s = this.skel;
    const rootIdx = this.index[L.root];
    const parentIdx = s.defs[rootIdx].parent;
    const pq = (parentIdx >= 0 ? this.worldQuat(s.defs[parentIdx].name, _q3) : _q3.identity()).clone();

    this.jointPos(L.root, this._root);
    solveTwoBone(this._root, L.L1, L.L2, target, pole, this.solve);

    /* first segment: point it, then take the parent's rotation back out so
       what lands on the bone is a local rotation */
    const world1 = new Quaternion().setFromUnitVectors(L.restDir1, this.solve.dir1);
    s.byName[L.root].quaternion.copy(_q1.copy(pq).invert().multiply(world1));
    if (s.byName[L.rootTwist]) s.byName[L.rootTwist].quaternion.identity();

    /* second segment: the part that changes direction goes on the joint, the
       part that only rolls is shared with the twist bone so the skin winds
       gradually instead of creasing at one ring */
    const world2 = new Quaternion().setFromUnitVectors(L.restDir2, this.solve.dir2);
    /* roll about where the segment ends up pointing, not where it started */
    if (roll) world2.premultiply(_q2.setFromAxisAngle(this.solve.dir2, clamp(roll, -2.2, 2.2)));
    const local2 = _q1.copy(world1).invert().multiply(world2);
    const swing = new Quaternion(), twist = new Quaternion();
    swingTwist(local2, L.restDir2, swing, twist);
    const half = new Quaternion().slerpQuaternions(new Quaternion(), twist, 0.5);
    s.byName[L.mid].quaternion.copy(swing).multiply(half);
    if (s.byName[L.midTwist]) s.byName[L.midTwist].quaternion.copy(half);
    return world1;
  }

  /* ---------------------------------------------------------------------- *
     Apply a whole pose.

     Spine, neck and clavicle angles are set directly — they are small, and a
     number for "lean back four degrees" is clearer than inventing a target
     for it. Arms and legs are solved to targets given as fractions of their
     own length, measured from the joint they hang off, so a pose survives a
     change of limb length.
   * ---------------------------------------------------------------------- */
  apply(pose) {
    const s = this.skel;
    s.resetPose();
    for (const [name, e] of Object.entries(pose.joints || {})) {
      const b = s.byName[name];
      if (b) b.rotation.set(e[0] || 0, e[1] || 0, e[2] || 0);
    }
    this.forward();

    /* Targets are written in the body's own frame, not the world's. Turn the
       figure ninety degrees for a side chest and the hands still land on the
       chest rather than swinging out into the room. */
    const bodyQ = this.worldQuat('root').clone();
    const shoulderQ = this.worldQuat('spine01').clone();
    this.jointPos('upperarm01.L', this._gripCenter);
    this.jointPos('upperarm01.R', _v2);
    this._gripCenter.add(_v2).multiplyScalar(0.5);

    for (const side of ['L', 'R']) {
      const m = side === 'L' ? 1 : -1;

      const a = (side === 'L' ? pose.armL : pose.armR) || pose.arm || {};
      const hand = a.hand || [0.34, -0.86, 0.16];
      const pole = a.pole || [0.72, -0.30, -0.62];
      const aimArm = () => {
        this.jointPos('upperarm01.' + side, _v1);
        const grip = a.grip || pose.grip;
        if (grip) {
          /* Clasped poses need a shared world-space destination. Two separate
             shoulder-relative guesses can look close on one physique and end
             up a full forearm apart after clavicle or arm-length changes. */
          this._target.set(grip[0], grip[1], grip[2]).applyQuaternion(shoulderQ)
            .multiplyScalar(this.armLen).add(this._gripCenter);
        } else {
          this._target.set(hand[0] * m, hand[1], hand[2]).applyQuaternion(shoulderQ)
            .multiplyScalar(this.armLen).add(_v1);
        }
        this._pole.set(pole[0] * m, pole[1], pole[2]).applyQuaternion(shoulderQ).normalize();
        return this.aimLimb('arm' + side, this._target, this._pole, (a.roll || 0) * m);
      };
      aimArm();

      /* Scapulohumeral rhythm.

         A shoulder does not raise an arm with the humerus alone — the shoulder
         blade rotates with it, roughly one degree for every two. Leaving the
         whole rotation on one joint is also what tears the armpit: linear blend
         skinning collapses the vertices split between the arm and the torso,
         the triangles there go to zero area, and you can see the backdrop
         through the gap. Sharing the rotation out fixes the anatomy and the
         artefact at the same time. */
      {
        const share = a.girdle === undefined ? 0.34 : a.girdle;
        const L = this.limbs['arm' + side];
        /* the humerus swing, as a world-space rotation */
        const swing = _q1.setFromUnitVectors(L.restDir1, this.solve.dir1).clone();
        const part = new Quaternion().slerp(swing, share);
        const clav = s.byName[`clavicle.${side}`];
        if (clav) {
          const p = s.defs[this.index[`clavicle.${side}`]].parent;
          const pq = (p >= 0 ? this.worldQuat(s.defs[p].name, _q2) : _q2.identity()).clone();
          /* Turn the world-space share into a rotation in this bone's own frame
             and lay it on top of whatever the pose already put there. Assigning
             a world rotation straight onto a local quaternion would throw away
             everything the root and spine had done — which, on a pose that
             turns the body round, swings the arms into the ribs. */
          const local = pq.clone().invert().multiply(part).multiply(pq);
          clav.quaternion.multiply(local);
        }
        this.forward();
        aimArm();          /* the shoulder joint has moved, so aim again */
      }

      const g = (side === 'L' ? pose.legL : pose.legR) || pose.leg || {};
      const foot = g.foot || [0.10, -0.99, 0.03];
      const kpole = g.pole || [0.22, 0.06, 1.0];
      this.jointPos('upperleg01.' + side, _v1);
      this._target.set(foot[0] * m, foot[1], foot[2]).applyQuaternion(bodyQ)
        .multiplyScalar(this.legLen).add(_v1);
      this._pole.set(kpole[0] * m, kpole[1], kpole[2]).applyQuaternion(bodyQ).normalize();
      this.aimLimb('leg' + side, this._target, this._pole, (g.roll || 0) * m);
    }

    /* hands and feet: undo the limb rotation so they sit naturally, then add
       whatever the pose asks for on top */
    this.forward();
    for (const side of ['L', 'R']) {
      const m = side === 'L' ? 1 : -1;
      const g = (side === 'L' ? pose.legL : pose.legR) || pose.leg || {};
      const a = (side === 'L' ? pose.armL : pose.armR) || pose.arm || {};
      const foot = s.byName['foot.' + side];
      if (foot) {
        /* the foot ends up flat on the floor, pointing where the body points,
           whatever the shin had to do to get there */
        this.worldQuat('lowerleg02.' + side, _q1);
        _q2.copy(bodyQ);
        _q2.multiply(_q3.setFromAxisAngle(_v1.set(0, 1, 0), (g.toeOut === undefined ? 0.20 : g.toeOut) * m));
        _q2.multiply(_q3.setFromAxisAngle(_v1.set(1, 0, 0), g.ankle || 0));
        foot.quaternion.copy(_q1.invert().multiply(_q2));
      }
      this.handCurl(a.curl === undefined ? 0.42 : a.curl, side);
      /* The hand follows the forearm — a pose only nudges it. Forcing the hand
         to a fixed world orientation detaches it from the arm and reads as a
         broken wrist. */
      const wrist = s.byName['wrist.' + side];
      if (wrist) wrist.rotation.set(a.wristX || 0, (a.wristY || 0) * m, (a.wristZ || 0) * m);
    }
    this.forward();
    return this;
  }
}
