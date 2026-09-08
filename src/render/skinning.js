import { ShaderChunk, Matrix4, Quaternion, Vector3 } from 'three';

// Rigid dual-quaternion skinning preserves the cross-section under humeral
// rotation. Register the same chunks for skin, clay, AO and shadow materials.
// This rig uses translations and rotations; bone scale is baked into the cage.
export function installVolumeSkinning() {
  if (ShaderChunk.skinning_pars_vertex.includes('dqRotation')) return;
  ShaderChunk.skinning_pars_vertex += `
  #ifdef USE_SKINNING
  vec4 dqRotation(mat4 m) {
    float tr = m[0][0] + m[1][1] + m[2][2];
    vec4 q;
    if (tr > 0.0) {
      float s = sqrt(tr + 1.0) * 2.0;
      q = vec4((m[1][2]-m[2][1])/s, (m[2][0]-m[0][2])/s, (m[0][1]-m[1][0])/s, s*0.25);
    } else if (m[0][0] > m[1][1] && m[0][0] > m[2][2]) {
      float s = sqrt(1.0+m[0][0]-m[1][1]-m[2][2])*2.0;
      q = vec4(s*0.25, (m[1][0]+m[0][1])/s, (m[2][0]+m[0][2])/s, (m[1][2]-m[2][1])/s);
    } else if (m[1][1] > m[2][2]) {
      float s = sqrt(1.0+m[1][1]-m[0][0]-m[2][2])*2.0;
      q = vec4((m[1][0]+m[0][1])/s, s*0.25, (m[2][1]+m[1][2])/s, (m[2][0]-m[0][2])/s);
    } else {
      float s = sqrt(1.0+m[2][2]-m[0][0]-m[1][1])*2.0;
      q = vec4((m[2][0]+m[0][2])/s, (m[2][1]+m[1][2])/s, s*0.25, (m[0][1]-m[1][0])/s);
    }
    return normalize(q);
  }
  vec4 dqDual(mat4 m, vec4 q) {
    vec3 t = m[3].xyz;
    return 0.5 * vec4(t*q.w + cross(t,q.xyz), -dot(t,q.xyz));
  }
  vec3 dqRotate(vec4 q, vec3 v) { return v + 2.0*cross(q.xyz, cross(q.xyz,v)+q.w*v); }
  #endif
  `;
  ShaderChunk.skinbase_vertex += `
  #ifdef USE_SKINNING
    vec4 qx = dqRotation(boneMatX), qy = dqRotation(boneMatY);
    vec4 qz = dqRotation(boneMatZ), qw = dqRotation(boneMatW);
    vec4 dw = skinWeight * vec4(1.0, dot(qx,qy)<0.0?-1.0:1.0,
      dot(qx,qz)<0.0?-1.0:1.0, dot(qx,qw)<0.0?-1.0:1.0);
    vec4 realQ = qx*dw.x + qy*dw.y + qz*dw.z + qw*dw.w;
    vec4 dualQ = dqDual(boneMatX,qx)*dw.x + dqDual(boneMatY,qy)*dw.y
      + dqDual(boneMatZ,qz)*dw.z + dqDual(boneMatW,qw)*dw.w;
    float qlen = max(length(realQ), 0.00001);
    realQ /= qlen; dualQ /= qlen;
    vec3 dqTranslation = 2.0*(realQ.w*dualQ.xyz-dualQ.w*realQ.xyz+cross(realQ.xyz,dualQ.xyz));
  #endif
  `;
  ShaderChunk.skinning_vertex = `
  #ifdef USE_SKINNING
    vec3 skinVertex = (bindMatrix * vec4(transformed,1.0)).xyz;
    transformed = (bindMatrixInverse * vec4(dqRotate(realQ,skinVertex)+dqTranslation,1.0)).xyz;
  #endif`;
  ShaderChunk.skinnormal_vertex = `
  #ifdef USE_SKINNING
    objectNormal = mat3(bindMatrixInverse) * dqRotate(realQ,mat3(bindMatrix)*objectNormal);
    #ifdef USE_TANGENT
      objectTangent = mat3(bindMatrixInverse) * dqRotate(realQ,mat3(bindMatrix)*objectTangent);
    #endif
  #endif`;
}

const matrix = new Matrix4(), q = new Quaternion(), reference = new Quaternion();
const real = new Quaternion(), dual = new Quaternion(), tq = new Quaternion();
const translation = new Vector3();

// Match the GPU for callouts and Three.js CPU picking/bounds.
export function applyVolumeBoneTransform(index, target) {
  const si = this.geometry.attributes.skinIndex, sw = this.geometry.attributes.skinWeight;
  real.set(0,0,0,0); dual.set(0,0,0,0);
  target.applyMatrix4(this.bindMatrix);
  for (let k = 0; k < 4; k++) {
    const boneIndex = si.array[index*4+k];
    matrix.multiplyMatrices(this.skeleton.bones[boneIndex].matrixWorld, this.skeleton.boneInverses[boneIndex]);
    q.setFromRotationMatrix(matrix);
    if (k === 0) reference.copy(q);
    const weight = sw.array[index*4+k] * (reference.dot(q) < 0 ? -1 : 1);
    translation.setFromMatrixPosition(matrix);
    tq.set(translation.x, translation.y, translation.z, 0).multiply(q);
    real.x += q.x*weight; real.y += q.y*weight; real.z += q.z*weight; real.w += q.w*weight;
    dual.x += tq.x*weight*0.5; dual.y += tq.y*weight*0.5;
    dual.z += tq.z*weight*0.5; dual.w += tq.w*weight*0.5;
  }
  const length = real.length() || 1;
  real.normalize();
  dual.set(dual.x/length,dual.y/length,dual.z/length,dual.w/length);
  tq.copy(real).conjugate(); dual.multiply(tq);
  target.applyQuaternion(real).add(translation.set(dual.x,dual.y,dual.z).multiplyScalar(2));
  return target.applyMatrix4(this.bindMatrixInverse);
}
