/* ---------------------------------------------------------------------------
   Fast CPU skinning and normals on typed arrays.

   The surface is posed once per edit (not per frame), so both run on the CPU
   and write straight into the render buffers. Dual-quaternion blending keeps
   the cross-section of a limb under rotation; it matches
   `applyVolumeBoneTransform` in src/render/skinning.js.
   --------------------------------------------------------------------------- */
import { Matrix4, Quaternion } from "three";

const M = new Matrix4(), Q = new Quaternion();

/* Per-bone unit dual quaternions [qx,qy,qz,qw, dx,dy,dz,dw] from the current
   skeleton pose. The rig has no bone scale. */
export function boneDualQuaternions(skeleton, out = new Float32Array(skeleton.bones.length * 8)) {
  skeleton.bones.forEach((bone, i) => {
    M.multiplyMatrices(bone.matrixWorld, skeleton.boneInverses[i]);
    Q.setFromRotationMatrix(M);
    const e = M.elements, tx = e[12], ty = e[13], tz = e[14];
    const qx = Q.x, qy = Q.y, qz = Q.z, qw = Q.w, o = i * 8;
    out[o] = qx; out[o + 1] = qy; out[o + 2] = qz; out[o + 3] = qw;
    // dual = 0.5 * (t, 0) * q
    out[o + 4] = 0.5 * (tx * qw + ty * qz - tz * qy);
    out[o + 5] = 0.5 * (ty * qw + tz * qx - tx * qz);
    out[o + 6] = 0.5 * (tz * qw + tx * qy - ty * qx);
    out[o + 7] = -0.5 * (tx * qx + ty * qy + tz * qz);
  });
  return out;
}

export function skinDualQuaternion(dq, skinIndex, skinWeight, src, dst) {
  const n = src.length / 3;
  for (let v = 0; v < n; v++) {
    let rx = 0, ry = 0, rz = 0, rw = 0, dx = 0, dy = 0, dz = 0, dw = 0;
    const b0 = skinIndex[v * 4] * 8;
    const q0x = dq[b0], q0y = dq[b0 + 1], q0z = dq[b0 + 2], q0w = dq[b0 + 3];
    for (let k = 0; k < 4; k++) {
      let w = skinWeight[v * 4 + k];
      if (!w) continue;
      const b = skinIndex[v * 4 + k] * 8;
      if (q0x * dq[b] + q0y * dq[b + 1] + q0z * dq[b + 2] + q0w * dq[b + 3] < 0) w = -w;
      rx += dq[b] * w; ry += dq[b + 1] * w; rz += dq[b + 2] * w; rw += dq[b + 3] * w;
      dx += dq[b + 4] * w; dy += dq[b + 5] * w; dz += dq[b + 6] * w; dw += dq[b + 7] * w;
    }
    const len = Math.hypot(rx, ry, rz, rw) || 1;
    rx /= len; ry /= len; rz /= len; rw /= len;
    dx /= len; dy /= len; dz /= len; dw /= len;
    // translation = 2 * (dual * conj(real)).xyz
    const tx = 2 * (dx * rw - dw * rx - dy * rz + dz * ry);
    const ty = 2 * (dy * rw - dw * ry - dz * rx + dx * rz);
    const tz = 2 * (dz * rw - dw * rz - dx * ry + dy * rx);
    const o = v * 3, px = src[o], py = src[o + 1], pz = src[o + 2];
    // v + 2 * cross(r, cross(r, v) + w * v)
    const cx = ry * pz - rz * py + rw * px, cy = rz * px - rx * pz + rw * py, cz = rx * py - ry * px + rw * pz;
    dst[o] = px + 2 * (ry * cz - rz * cy) + tx;
    dst[o + 1] = py + 2 * (rz * cx - rx * cz) + ty;
    dst[o + 2] = pz + 2 * (rx * cy - ry * cx) + tz;
  }
  return dst;
}

/* Area-weighted vertex normals, the same result as computeVertexNormals. */
export function computeNormals(index, pos, out) {
  out.fill(0);
  for (let t = 0; t < index.length; t += 3) {
    const a = index[t] * 3, b = index[t + 1] * 3, c = index[t + 2] * 3;
    const e1x = pos[b] - pos[a], e1y = pos[b + 1] - pos[a + 1], e1z = pos[b + 2] - pos[a + 2];
    const e2x = pos[c] - pos[a], e2y = pos[c + 1] - pos[a + 1], e2z = pos[c + 2] - pos[a + 2];
    const nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x;
    out[a] += nx; out[a + 1] += ny; out[a + 2] += nz;
    out[b] += nx; out[b + 1] += ny; out[b + 2] += nz;
    out[c] += nx; out[c + 1] += ny; out[c + 2] += nz;
  }
  for (let o = 0; o < out.length; o += 3) {
    const l = Math.hypot(out[o], out[o + 1], out[o + 2]) || 1;
    out[o] /= l; out[o + 1] /= l; out[o + 2] /= l;
  }
  return out;
}
