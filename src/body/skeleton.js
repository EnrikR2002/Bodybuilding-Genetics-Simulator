/* ---------------------------------------------------------------------------
   The skeleton is derived from the mesh, not stored beside it.

   Each joint in the MakeHuman rig names a small group of helper vertices that
   sit inside the body at that joint. The bone head is the centre of that group.
   Those helper vertices are part of the mesh, so every morph target moves them
   too: widen the pelvis and the hip joints move outward on their own.

   That removes the classic failure of this kind of app — bones and skin drifting
   apart and the mesh tearing at the shoulder. There is nothing to keep in sync,
   because there is only one thing.

   Bones rest with no rotation of their own, so a pose angle means the same
   thing on every body: elbow flex is elbow flex whatever the arm length.
   --------------------------------------------------------------------------- */
import { Bone, Skeleton, Matrix4, Vector3, Quaternion } from 'three';

export class BodySkeleton {
  constructor(bundle) {
    this.defs = bundle.header.bones;
    this.jointVerts = {};
    for (const [name, blockIdx] of Object.entries(bundle.header.joints))
      this.jointVerts[name] = bundle.block(blockIdx);

    this.n = this.defs.length;
    this.head = new Float32Array(this.n * 3);
    this.tail = new Float32Array(this.n * 3);
    this.restLocal = new Float32Array(this.n * 3);

    this.bones = this.defs.map(d => { const b = new Bone(); b.name = d.name; return b; });
    this.byName = {};
    this.defs.forEach((d, i) => {
      this.byName[d.name] = this.bones[i];
      if (d.parent >= 0) this.bones[d.parent].add(this.bones[i]);
    });
    this.roots = this.defs.map((d, i) => d.parent < 0 ? this.bones[i] : null).filter(Boolean);

    this.boneInverses = this.defs.map(() => new Matrix4());
    this.skeleton = new Skeleton(this.bones, this.boneInverses);
    this._m = new Matrix4();
    this._world = new Float32Array(this.n * 3);
  }

  /* Recompute bone rests from the current cage. Called whenever the shape
     changes; it finishes inside one frame so the mesh is never half-updated. */
  rebuild(cagePos, scale = 1) {
    const { defs, head, tail, restLocal, jointVerts } = this;
    for (let i = 0; i < this.n; i++) {
      centre(cagePos, jointVerts[defs[i].head], head, i * 3, scale);
      centre(cagePos, jointVerts[defs[i].tail], tail, i * 3, scale);
    }
    for (let i = 0; i < this.n; i++) {
      const p = defs[i].parent;
      const o = i * 3;
      if (p < 0) {
        restLocal[o] = head[o]; restLocal[o + 1] = head[o + 1]; restLocal[o + 2] = head[o + 2];
      } else {
        restLocal[o] = head[o] - head[p * 3];
        restLocal[o + 1] = head[o + 1] - head[p * 3 + 1];
        restLocal[o + 2] = head[o + 2] - head[p * 3 + 2];
      }
      this.bones[i].position.set(restLocal[o], restLocal[o + 1], restLocal[o + 2]);
    }
    /* bind matrices come from the rest pose, which has no rotations at all,
       so the inverse is a plain negative translation */
    for (let i = 0; i < this.n; i++) {
      this.boneInverses[i].makeTranslation(-head[i * 3], -head[i * 3 + 1], -head[i * 3 + 2]);
    }
    this.skeleton.boneInverses = this.boneInverses;
    return this;
  }

  /* world position of a bone head in the current pose */
  worldHead(name, out = new Vector3()) {
    const b = this.byName[name];
    if (!b) return out.set(0, 0, 0);
    b.updateWorldMatrix(true, false);
    return out.setFromMatrixPosition(b.matrixWorld);
  }

  restHead(name, out = new Vector3()) {
    const i = this.defs.findIndex(d => d.name === name);
    if (i < 0) return out.set(0, 0, 0);
    return out.set(this.head[i * 3], this.head[i * 3 + 1], this.head[i * 3 + 2]);
  }

  restTail(name, out = new Vector3()) {
    const i = this.defs.findIndex(d => d.name === name);
    if (i < 0) return out.set(0, 0, 0);
    return out.set(this.tail[i * 3], this.tail[i * 3 + 1], this.tail[i * 3 + 2]);
  }

  /* length of a bone in the rest pose, in centimetres */
  restLength(name) {
    const i = this.defs.findIndex(d => d.name === name);
    if (i < 0) return 0;
    const o = i * 3;
    return Math.hypot(this.tail[o] - this.head[o], this.tail[o + 1] - this.head[o + 1],
                      this.tail[o + 2] - this.head[o + 2]);
  }

  resetPose() {
    for (const b of this.bones) b.quaternion.identity();
  }
}

function centre(pos, verts, out, o, scale) {
  if (!verts || !verts.length) { out[o] = out[o + 1] = out[o + 2] = 0; return; }
  let x = 0, y = 0, z = 0;
  for (let i = 0; i < verts.length; i++) {
    const v = verts[i] * 3;
    x += pos[v]; y += pos[v + 1]; z += pos[v + 2];
  }
  const n = verts.length;
  out[o] = x / n * scale; out[o + 1] = y / n * scale; out[o + 2] = z / n * scale;
}

export const _tmpQ = new Quaternion();
