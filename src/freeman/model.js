import {
  Bone,
  Skeleton,
  Mesh,
  Group,
  BufferGeometry,
  BufferAttribute,
  MeshPhysicalMaterial,
  Vector3,
  Matrix4,
  Quaternion,
} from "three";
import { applyVolumeBoneTransform } from "../render/skinning.js";
import { POSE_BY_ID } from "./poses.js";

export const DEFAULT = {
  clavicle: 0.5,
  ribcage: 0.5,
  hipWidth: 0.5,
  torsoLength: 0.5,
  armLength: 0.5,
  legLength: 0.5,
  bicepInsertion: 0.5,
  bicepPeak: 0.5,
  latInsertion: 0.5,
  pecGap: 0.5,
  abStagger: 0.5,
  calfInsertion: 0.5,
  trapHeight: 0.5,
  mass: 0.5,
  legMass: 0.5,
  backThickness: 0.5,
  bodyFat: 0,
};
export const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
export const smooth = (a, b, x) => {
  const t = clamp((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const V = new Vector3(),
  N = new Vector3(),
  M = new Vector3();
const types = { f: Float32Array, H: Uint16Array, I: Uint32Array };
export async function loadFreeman() {
  const [meta, response] = await Promise.all([
    fetch("/models/freeman.json").then((r) => {
      if (!r.ok) throw Error("Sculpt metadata could not be loaded");
      return r.json();
    }),
    fetch("/models/freeman.bin"),
  ]);
  if (!response.ok) throw Error("Sculpt could not be loaded");
  const bytes = await response.arrayBuffer();
  const data = { meta };
  for (const b of meta.blocks)
    data[b.name] = new types[b.type](bytes, b.offset, b.length);
  return data;
}
function skinMaterial(neutral = false) {
  const m = new MeshPhysicalMaterial({
    color: neutral ? 0xaebbc0 : 0xb88f79,
    roughness: neutral ? 0.68 : 0.62,
    metalness: 0,
    clearcoat: 0,
    envMapIntensity: 0.55,
  });
  m.onBeforeCompile = (s) => {
    s.vertexShader = s.vertexShader
      .replace(
        "#include <common>",
        "#include <common>\nattribute vec3 aRest;varying vec3 vRest;",
      )
      .replace(
        "#include <begin_vertex>",
        "#include <begin_vertex>\nvRest=aRest;",
      );
    s.fragmentShader = s.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
   varying vec3 vRest;
   float hashSkin(vec3 p){return fract(sin(dot(p,vec3(127.1,311.7,74.7)))*43758.5453);}
   float skinNoise(vec3 p){vec3 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(mix(hashSkin(i),hashSkin(i+vec3(1,0,0)),f.x),mix(hashSkin(i+vec3(0,1,0)),hashSkin(i+vec3(1,1,0)),f.x),f.y),mix(mix(hashSkin(i+vec3(0,0,1)),hashSkin(i+vec3(1,0,1)),f.x),mix(hashSkin(i+vec3(0,1,1)),hashSkin(i+vec3(1,1,1)),f.x),f.y),f.z);}
   float briefs(){float hem=82.+5.*smoothstep(0.,13.,abs(vRest.x));return smoothstep(hem-.15,hem+.15,vRest.y)*(1.-smoothstep(98.8,99.1,vRest.y));}
  `,
      )
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>
   float fabric=briefs();float variation=skinNoise(vRest*.24);
   diffuseColor.rgb*=.96+.08*variation;
   float areola=exp(-pow((abs(vRest.x)-9.7)/1.0,2.)-pow((vRest.y-133.)/.85,2.))*smoothstep(6.,11.,vRest.z);
   diffuseColor.rgb=mix(diffuseColor.rgb,diffuseColor.rgb*vec3(.58,.39,.35),areola*${neutral ? "0." : "0.5"});
   diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.019,.028,.035),fabric);
  `,
      )
      .replace(
        "#include <roughnessmap_fragment>",
        `#include <roughnessmap_fragment>
   roughnessFactor+=.035*(skinNoise(vRest*3.)-.5);
   roughnessFactor=mix(roughnessFactor,.87,briefs());
  `,
      )
      .replace(
        "#include <normal_fragment_maps>",
        `#include <normal_fragment_maps>
   float h=(skinNoise(vRest*6.)-.5)*.002*(1.-briefs());
   vec3 dx=dFdx(-vViewPosition),dy=dFdy(-vViewPosition),r1=cross(dy,normal),r2=cross(normal,dx);
   float det=dot(dx,r1);normal=normalize(abs(det)*normal-sign(det)*(dFdx(h)*r1+dFdy(h)*r2));
  `,
      );
  };
  m.customProgramCacheKey = () => "freeman-skin-2-" + neutral;
  return m;
}

export class Freeman {
  constructor(data) {
    this.data = data;
    this.root = new Group();
    this.state = { ...DEFAULT };
    this.pose = "anatomy";
    this.height = 180;
    this.original = data.position;
    this.positions = data.position.slice();
    const g = (this.geometry = new BufferGeometry());
    g.setAttribute("position", new BufferAttribute(this.positions, 3));
    g.setAttribute("normal", new BufferAttribute(data.normal.slice(), 3));
    g.setAttribute("uv", new BufferAttribute(data.uv, 2));
    g.setAttribute("aRest", new BufferAttribute(data.position, 3));
    g.setAttribute("skinIndex", new BufferAttribute(data.skinIndex, 4));
    g.setAttribute("skinWeight", new BufferAttribute(data.skinWeight, 4));
    g.setIndex(new BufferAttribute(data.index, 1));
    this.skin = skinMaterial();
    this.clay = skinMaterial(true);
    this.bones = data.meta.bones.map((d) => {
      const b = new Bone();
      b.name = d.name;
      return b;
    });
    this.byName = {};
    data.meta.bones.forEach((d, i) => {
      this.byName[d.name] = this.bones[i];
      const p = d.parent < 0 ? this.root : this.bones[d.parent];
      p.add(this.bones[i]);
    });
    this.heads = data.meta.bones.map((d) => new Vector3().fromArray(d.head));
    this.tails = data.meta.bones.map((d) => new Vector3().fromArray(d.tail));
    this.skeleton = new Skeleton(this.bones);
    this.mesh = new Mesh(g, this.skin);
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.root.add(this.mesh);
    this.skinDriver = {
      geometry: g,
      skeleton: this.skeleton,
      bindMatrix: new Matrix4(),
      bindMatrixInverse: new Matrix4(),
    };
    this.extras = [];
    for (let i = 0; i < data.meta.extras.length; i++) {
      const name = data.meta.extras[i].name;
      if (name === "hair") continue;
      const eg = new BufferGeometry();
      eg.setAttribute(
        "position",
        new BufferAttribute(data["extraPosition" + i].slice(), 3),
      );
      eg.setIndex(new BufferAttribute(data["extraIndex" + i], 1));
      eg.computeVertexNormals();
      const material = new MeshPhysicalMaterial({
        color:
          name === "eyebrow"
            ? 0x38251e
            : name === "Roundcube.003"
              ? 0x3d3022
              : 0xbbb4a8,
        roughness: name === "eyebrow" ? 0.85 : 0.25,
      });
      const e = new Mesh(eg, material);
      e.userData.base = data["extraPosition" + i];
      e.userData.material = material;
      this.root.add(e);
      this.extras.push(e);
    }
    this.arm = new Float32Array(data.meta.vertices);
    this.leg = new Float32Array(data.meta.vertices);
    this.hand = new Float32Array(data.meta.vertices);
    for (let v = 0; v < this.arm.length; v++)
      for (let k = 0; k < 4; k++) {
        const name = data.meta.bones[data.skinIndex[v * 4 + k]].name,
          w = data.skinWeight[v * 4 + k];
        if (/upperarm|forearm|hand/.test(name)) this.arm[v] += w;
        if (/hand/.test(name)) this.hand[v] += w;
        if (/thigh|shin|foot/.test(name)) this.leg[v] += w;
      }
    this.limbs = [];
    this.hands = ["L", "R"].map(side => {
      const i = data.meta.bones.findIndex(b => b.name === `hand.${side}`);
      const axis = this.tails[i].clone().sub(this.heads[i]).normalize();
      const palm = new Vector3(side === "L" ? -0.5 : 0.5, -0.75, 0.43);
      palm.addScaledVector(axis, -palm.dot(axis)).normalize();
      return { i, axis, palm };
    });
    // Cache only the shoulder/axilla transition, where heat weights stretch
    // small sculpt folds into fins under arm elevation.
    const neighbors = new Map();
    this.shoulderRelax = [];
    for (let v = 0; v < data.meta.vertices; v++) {
      const x = Math.abs(data.position[v * 3]), y = data.position[v * 3 + 1];
      const weight = smooth(11, 17, x) * (1 - smooth(25, 32, x))
        * smooth(123, 132, y) * (1 - smooth(143, 151, y));
      if (weight > 0) {
        const entry = { v, weight, neighbors: new Set() };
        neighbors.set(v, entry.neighbors);
        this.shoulderRelax.push(entry);
      }
    }
    for (let t = 0; t < data.index.length; t += 3) {
      const tri = [data.index[t], data.index[t + 1], data.index[t + 2]];
      for (let k = 0; k < 3; k++) {
        const list = neighbors.get(tri[k]);
        if (list) { list.add(tri[(k + 1) % 3]); list.add(tri[(k + 2) % 3]); }
      }
    }
    for (const entry of this.shoulderRelax) entry.neighbors = [...entry.neighbors];
    this.relaxPositions = new Float32Array(this.shoulderRelax.length * 3);
    for (const kind of ["biceps", "calf"])
      for (const side of ["L", "R"]) {
        const idx = data.meta.bones.findIndex(
            (d) =>
              d.name === `${kind === "biceps" ? "upperarm" : "shin"}.${side}`,
          ),
          h = new Vector3().fromArray(data.meta.bones[idx].head),
          tail = new Vector3().fromArray(data.meta.bones[idx].tail),
          axis = tail.sub(h),
          length = axis.length();
        axis.normalize();
        this.limbs.push({ kind, side, head: h, axis, length });
      }
    this.update(DEFAULT);
  }
  structure(p, state, arm = 0) {
    const sign = Math.sign(p.x),
      x = p.x,
      y = p.y;
    const clav = (state.clavicle - 0.5) * 2,
      hip = (state.hipWidth - 0.5) * 2;
    p.x +=
      sign *
      clav *
      3.7 *
      Math.max(
        arm,
        smooth(123, 145, y) *
          (1 - smooth(158, 170, y)) *
          smooth(3, 20, Math.abs(x)),
      );
    p.x += x * hip * 0.12 * (1 - smooth(96, 120, y));
    const rib =
      (state.ribcage - 0.5) *
      2 *
      smooth(107, 119, y) *
      (1 - smooth(141, 151, y)) *
      (1 - arm);
    p.x *= 1 + rib * 0.075;
    p.z *= 1 + rib * 0.13;
    if (arm > 0.001) {
      const sh = this.data.meta.bones.find(
        (d) => d.name === `upperarm.${sign > 0 ? "L" : "R"}`,
      ).head;
      const a = (state.armLength - 0.5) * 0.24 * arm;
      p.x += (x - sh[0]) * a;
      p.y += (y - sh[1]) * a;
      p.z += (p.z - sh[2]) * a;
    }
    const leg = (state.legLength - 0.5) * 0.2,
      torso = (state.torsoLength - 0.5) * 0.2;
    p.y += Math.min(p.y, 94) * leg + clamp(p.y - 94, 0, 53) * torso;
    return p;
  }
  insertion(p, limb, state) {
    const key = limb.kind === "biceps" ? "bicepInsertion" : "calfInsertion",
      value = state[key],
      sign = limb.side === "L" ? 1 : -1;
    if (p.x * sign < 2) return;
    const d = p.clone().sub(limb.head),
      t = d.dot(limb.axis) / limb.length;
    if (t < 0.1 || t > 1.03) return;
    const radial = d.clone().addScaledVector(limb.axis, -t * limb.length),
      r = radial.length();
    if (r < 0.1 || r > 15) return;
    const front = new Vector3(0, 0, limb.kind === "biceps" ? 1 : -1)
      .addScaledVector(
        limb.axis,
        limb.kind === "biceps" ? -limb.axis.z : limb.axis.z,
      )
      .normalize();
    const angular = smooth(-0.12, 0.72, radial.dot(front) / r);
    const a = limb.kind === "biceps" ? 0.18 : 0.1,
      b = limb.kind === "biceps" ? 0.82 : 0.66;
    const end =
      value === 0
        ? limb.kind === "biceps"
          ? 0.62
          : 0.52
        : value === 1
          ? limb.kind === "biceps"
            ? 0.91
            : 0.77
          : b;
    // Smooth first derivatives at both ends avoid a ring or flat shelf where
    // the transported belly meets the unchanged tendon interval.
    const target = t + (end - b) * smooth(a, b, t) * (1 - smooth(b, 1, t));
    const gate = angular * smooth(0.1, 0.25, t) * (1 - smooth(0.92, 1.02, t));
    const definition = 1 - state.bodyFat * 0.72;
    p.addScaledVector(
      limb.axis,
      (target - t) * limb.length * gate * definition,
    );
    const belly = Math.sin(Math.PI * clamp((t - a) / (b - a)));
    let growth =
      (Math.sqrt((b - a) / (end - a)) - 1) * Math.max(0, r - 3.2) * belly;
    if (limb.kind === "biceps")
      growth += (state.bicepPeak - 0.5) * 1.6 * (belly ** 4 - 0.35 * belly);
    p.addScaledVector(radial, (growth / r) * gate * definition);
  }
  update(next) {
    this.state = { ...DEFAULT, ...next };
    const s = this.state,
      p = this.positions,
      base = this.original;
    for (let v = 0; v < this.arm.length; v++) {
      V.fromArray(base, v * 3);
      N.fromArray(this.data.normal, v * 3);
      const y = V.y,
        x = V.x,
        front = N.z;
      if (this.data.smoothPosition) {
        const coverage =
          s.bodyFat *
          0.95 *
          smooth(25, 50, y) *
          (1 - smooth(150, 166, y)) *
          (1 - smooth(0.05, 0.65, this.hand[v]));
        for (let k = 0; k < 3; k++)
          V.setComponent(
            k,
            V.getComponent(k) +
              (this.data.smoothPosition[v * 3 + k] - base[v * 3 + k]) *
                coverage,
          );
      }
      if (this.arm[v] > 0.3)
        for (const limb of this.limbs)
          if (limb.kind === "biceps") this.insertion(V, limb, s);
      if (this.leg[v] > 0.4 && y < 60)
        for (const limb of this.limbs)
          if (limb.kind === "calf") this.insertion(V, limb, s);
      const torso =
        (1 - this.arm[v]) * smooth(99, 110, y) * (1 - smooth(145, 156, y));
      const lat =
        torso * smooth(0.15, 0.8, -front) * smooth(4, 13, Math.abs(x));
      V.y +=
        (s.latInsertion - 0.5) *
        -7 *
        lat *
        smooth(103, 119, y) *
        (1 - smooth(129, 143, y));
      const pec =
        torso *
        smooth(0.2, 0.85, front) *
        smooth(124, 130, y) *
        (1 - smooth(141, 146, y)) *
        (1 - smooth(3, 11, Math.abs(x)));
      V.x +=
        Math.sign(x) *
        (s.pecGap - 0.5) *
        2.5 *
        pec *
        smooth(0.1, 1.8, Math.abs(x));
      const ab =
        torso *
        smooth(0.3, 0.9, front) *
        (1 - smooth(5, 9, Math.abs(x))) *
        smooth(100, 106, y) *
        (1 - smooth(122, 129, y));
      V.y += (s.abStagger - 0.5) * Math.sign(x) * 2 * ab;
      const trap =
        smooth(0.1, 0.8, -front) *
        smooth(139, 149, y) *
        (1 - smooth(158, 163, y)) *
        (1 - smooth(11, 21, Math.abs(x)));
      V.y += (s.trapHeight - 0.5) * 2.8 * trap;
      const muscle = smooth(14, 30, y) * (1 - smooth(150, 165, y));
      const mass = y < 98 ? s.legMass : s.mass;
      const bulk =
        (mass - 0.5) * 2.0 * muscle +
        (s.backThickness - 0.5) * 1.5 * torso * smooth(0.1, 0.8, -front);
      const fat =
        s.bodyFat *
        2.4 *
        smooth(13, 40, y) *
        (1 - smooth(149, 168, y)) *
        (0.55 + 0.8 * smooth(93, 105, y) * (1 - smooth(117, 129, y)));
      // Inflate along the low-frequency surface direction. Following every
      // original crease normal creates cuffs and folded ridges at the elbows.
      M.fromArray(
        this.data.smoothNormal ?? this.data.normal,
        v * 3,
      ).normalize();
      V.addScaledVector(
        M,
        (bulk + fat * (1 - this.arm[v] * 0.5)) *
          (1 - smooth(0.05, 0.65, this.hand[v])),
      );
      this.structure(V, s, this.arm[v]);
      V.toArray(p, v * 3);
    }
    this.restPositions = p.slice();
    const defs = this.data.meta.bones;
    defs.forEach((d, i) => {
      const arm = /upperarm|forearm|hand/.test(d.name) ? 1 : 0;
      this.structure(this.heads[i].fromArray(d.head), s, arm);
      this.structure(this.tails[i].fromArray(d.tail), s, arm);
    });
    defs.forEach((d, i) => {
      this.bones[i].quaternion.identity();
      this.bones[i].position.copy(this.heads[i]);
      if (d.parent >= 0) this.bones[i].position.sub(this.heads[d.parent]);
      this.skeleton.boneInverses[i] = new Matrix4().makeTranslation(
        -this.heads[i].x,
        -this.heads[i].y,
        -this.heads[i].z,
      );
    });
    for (const e of this.extras) {
      const ep = e.geometry.attributes.position;
      for (let v = 0; v < ep.count; v++) {
        V.fromArray(e.userData.base, v * 3);
        this.structure(V, s);
        V.toArray(ep.array, v * 3);
      }
      ep.needsUpdate = true;
    }
    this.height =
      180 + 94 * (s.legLength - 0.5) * 0.2 + 53 * (s.torsoLength - 0.5) * 0.2;
    this.setPose(this.pose);
    return this;
  }
  setPose(pose) {
    const definition = POSE_BY_ID[pose];
    if (!definition) throw new RangeError(`Unknown pose: ${pose}`);
    this.pose = pose;
    for (const b of this.bones) b.quaternion.identity();
    this.positions.set(this.restPositions);
    if (definition.upper) {
      // A continuous finger curl retains the source fingers and knuckles.
      // This is a compact grip corrective, not independent finger animation.
      for (let v = 0; v < this.hand.length; v++) {
        if (this.hand[v] < 0.5) continue;
        const h = this.hands[this.original[v * 3] > 0 ? 0 : 1];
        V.fromArray(this.positions, v * 3);
        const offset = V.clone().sub(this.heads[h.i]);
        const along = offset.dot(h.axis), depth = offset.dot(h.palm) + 0.4;
        const start = 9.5, radius = 3.4;
        if (along <= start) continue;
        const angle = Math.min((along - start) / radius, 3.7);
        const remainder = Math.max(0, along - start - 3.7 * radius);
        const length = start + Math.sin(angle) * (radius - depth) + remainder * Math.cos(angle);
        const inward = radius - Math.cos(angle) * (radius - depth) + remainder * Math.sin(angle);
        const weight = smooth(0.5, 0.95, this.hand[v]);
        V.addScaledVector(h.axis, (length - along) * weight);
        V.addScaledVector(h.palm, (inward - depth) * weight);
        const across = new Vector3().crossVectors(h.axis, h.palm);
        V.addScaledVector(across, -offset.dot(across) * 0.32 * smooth(start, 18, along) * weight);
        V.toArray(this.positions, v * 3);
      }
    }
    if (definition.flex)
      for (let v = 0; v < this.arm.length; v++)
        if (this.arm[v] > 0.35) {
          V.fromArray(this.positions, v * 3);
          for (const limb of this.limbs)
            if (
              limb.kind === "biceps" &&
              V.x * (limb.side === "L" ? 1 : -1) > 2
            ) {
              const i = this.data.meta.bones.findIndex(
                  (b) => b.name === `upperarm.${limb.side}`,
                ),
                axis = this.tails[i].clone().sub(this.heads[i]),
                len = axis.length();
              axis.normalize();
              const d = V.clone().sub(this.heads[i]),
                t = d.dot(axis) / len,
                radial = d.clone().addScaledVector(axis, -t * len),
                r = radial.length();
              const end =
                this.state.bicepInsertion === 0
                  ? 0.62
                  : this.state.bicepInsertion === 1
                    ? 0.91
                    : 0.82;
              const belly = Math.sin(
                Math.PI * clamp((t - 0.18) / (end - 0.18)),
              );
              const front = new Vector3(0, 0, 1)
                .addScaledVector(axis, -axis.z)
                .normalize();
              const gate = smooth(
                0.05,
                0.8,
                radial.dot(front) / Math.max(r, 0.01),
              );
              const bulge =
                definition.flex * 1.2 *
                Math.sqrt(0.64 / (end - 0.18)) *
                belly ** 2 *
                gate *
                (1 - this.state.bodyFat * 0.6);
              V.addScaledVector(front, bulge);
            }
          V.toArray(this.positions, v * 3);
        }
    if (pose === "flex")
      for (const side of ["L", "R"]) {
        const sign = side === "L" ? 1 : -1,
          ui = this.data.meta.bones.findIndex(
            (d) => d.name === `upperarm.${side}`,
          ),
          fi = ui + 1;
        const bend = new Vector3(sign * 0.1, 0.93, 0.35).normalize();
        const rest = this.tails[fi].clone().sub(this.heads[fi]).normalize();
        this.bones[fi].quaternion.setFromUnitVectors(rest, bend);
      }
    if (definition.upper) {
      for (const side of ["L", "R"]) {
        const sign = side === "L" ? 1 : -1;
        this.byName[`clavicle.${side}`].rotation.z = sign * definition.shoulder;
        const aim = (name, direction) => {
          const i = this.data.meta.bones.findIndex(b => b.name === `${name}.${side}`);
          const bone = this.bones[i];
          bone.parent.updateWorldMatrix(true, false);
          const parent = bone.parent.getWorldQuaternion(new Quaternion());
          const target = new Vector3(sign * direction[0], direction[1], direction[2])
            .normalize().applyQuaternion(parent.invert());
          bone.quaternion.setFromUnitVectors(
            this.tails[i].clone().sub(this.heads[i]).normalize(), target,
          );
        };
        aim("upperarm", definition.upper);
        // The shoulder support must follow elevation; leaving it in the rest
        // stance tethers the deltoid while the elbow moves away.
        this.byName[`upperarm_support.${side}`].quaternion
          .copy(this.byName[`upperarm.${side}`].quaternion);
        aim("forearm", definition.fore);
        aim("hand", definition.hand);
      }
      for (let v = 0; v < this.arm.length; v++) {
        V.fromArray(this.positions, v * 3);
        const x = this.original[v * 3], y = this.original[v * 3 + 1];
        const lat = (1 - this.arm[v]) * smooth(6, 15, Math.abs(x))
          * smooth(103, 118, y) * (1 - smooth(137, 147, y));
        V.x += Math.sign(x) * definition.spread * 4.2 * lat;
        V.toArray(this.positions, v * 3);
      }
    }
    // Evaluate the pose once per edit, then recompute real surface normals.
    // Interpolated rest normals otherwise create false creases at a bent joint.
    const location = this.root.position.clone();
    this.root.position.set(0, 0, 0);
    this.root.updateMatrixWorld(true);
    this.skeleton.update();
    if (pose !== "anatomy")
      for (let v = 0; v < this.arm.length; v++) {
        V.fromArray(this.positions, v * 3);
        applyVolumeBoneTransform.call(this.skinDriver, v, V);
        V.toArray(this.positions, v * 3);
      }
    if (definition.upper) {
      for (let pass = 0; pass < 8; pass++) {
        this.shoulderRelax.forEach(({ v, weight, neighbors }, i) => {
          V.set(0, 0, 0);
          for (const n of neighbors) V.add(N.fromArray(this.positions, n * 3));
          V.divideScalar(neighbors.length);
          N.fromArray(this.positions, v * 3).lerp(V, weight * 0.55);
          N.toArray(this.relaxPositions, i * 3);
        });
        this.shoulderRelax.forEach(({ v }, i) => {
          V.fromArray(this.relaxPositions, i * 3).toArray(this.positions, v * 3);
        });
      }
    }
    this.root.position.copy(location);
    this.root.updateMatrixWorld(true);
    this.geometry.attributes.position.needsUpdate = true;
    this.geometry.computeVertexNormals();
    this.geometry.computeBoundingBox();
    this.geometry.computeBoundingSphere();
    return this;
  }
  setSurface(mode, tone = 1) {
    this.mesh.material = mode === "clay" ? this.clay : this.skin;
    this.skin.color.set(
      [0xd3ae97, 0xb88f79, 0x986b4d, 0x6e4838][tone] ?? 0xb88f79,
    );
    for (const e of this.extras)
      e.material = mode === "clay" ? this.clay : e.userData.material;
    return this;
  }
  landmark(name, fraction = 0.5) {
    const i = this.data.meta.bones.findIndex((d) => d.name === name);
    const p = this.heads[i]
      .clone()
      .lerp(this.tails[i], fraction)
      .sub(this.heads[i]);
    return this.bones[i].localToWorld(p);
  }
  dispose() {
    this.geometry.dispose();
    this.skin.dispose();
    this.clay.dispose();
    this.skeleton.dispose();
    for (const e of this.extras) {
      e.geometry.dispose();
      e.userData.material.dispose();
    }
  }
}
