/* ---------------------------------------------------------------------------
   The Freeman figure: one sculpt, one rig, one set of materials.

   update(state) runs the rest-space shape pipeline (shape/index.js), moves
   the joints and the eyes with the frame edit, then re-poses. setPose(id)
   re-evaluates the pose from the stored rest surface (pose.js).
   --------------------------------------------------------------------------- */
import { Bone, Skeleton, Mesh, Group, BufferGeometry, BufferAttribute, MeshPhysicalMaterial, Vector3 } from "three";
import { buildContext } from "./shape/context.js";
import { applyShape, frameTransform } from "./shape/index.js";
import { applyPose } from "./pose.js";
import { createSurfaces, applySurface, setOverlay, disposeSurfaces } from "./materials.js";
import { loadAnatomy, attachAnatomy } from "./anatomy.js";
import { boneRegion } from "./bones.js";
import { DEFAULT } from "./traits.js";

export { DEFAULT };
export { clamp, smooth } from "./shape/context.js";

const TYPES = { f: Float32Array, H: Uint16Array, I: Uint32Array, B: Uint8Array };

export async function loadFreeman() {
  const [meta, response, anatomy] = await Promise.all([
    fetch("/models/freeman.json").then((r) => {
      if (!r.ok) throw Error("Sculpt metadata could not be loaded");
      return r.json();
    }),
    fetch("/models/freeman.bin"),
    loadAnatomy(),
  ]);
  if (!response.ok) throw Error("Sculpt could not be loaded");
  const bytes = await response.arrayBuffer();
  const data = { meta, anatomy };
  for (const b of meta.blocks) data[b.name] = new TYPES[b.type](bytes, b.offset, b.length);
  return data;
}

const EXTRA_COLORS = { eyebrow: 0x38251e, "Roundcube.003": 0x3d3022 };

export class Freeman {
  constructor(data) {
    this.data = data;
    this.ctx = buildContext(data);
    this.root = new Group();
    this.state = { ...DEFAULT };
    this.pose = "anatomy";
    this.surface = "skin";
    this.height = 180;
    this.original = data.position;
    this.positions = data.position.slice();
    this.restPositions = data.position.slice();
    const g = (this.geometry = new BufferGeometry());
    g.setAttribute("position", new BufferAttribute(this.positions, 3));
    g.setAttribute("normal", new BufferAttribute(data.normal.slice(), 3));
    g.setAttribute("uv", new BufferAttribute(data.uv, 2));
    g.setAttribute("aRest", new BufferAttribute(data.position, 3));
    g.setAttribute("skinIndex", new BufferAttribute(data.skinIndex, 4));
    g.setAttribute("skinWeight", new BufferAttribute(data.skinWeight, 4));
    g.setIndex(new BufferAttribute(data.index, 1));
    this.hasAnatomy = attachAnatomy(g, data.anatomy);
    this.materials = createSurfaces(data.anatomy);
    this.skin = this.materials.skin;
    this.clay = this.materials.clay;

    const defs = data.meta.bones;
    this.bones = defs.map((d) => Object.assign(new Bone(), { name: d.name }));
    this.byName = {};
    this.boneArm = defs.map((d) => (["arm", "hand"].includes(boneRegion(d.name)) ? 1 : 0));
    defs.forEach((d, i) => {
      this.byName[d.name] = this.bones[i];
      (d.parent < 0 ? this.root : this.bones[d.parent]).add(this.bones[i]);
    });
    this.heads = defs.map((d) => new Vector3().fromArray(d.head));
    this.tails = defs.map((d) => new Vector3().fromArray(d.tail));
    this.skeleton = new Skeleton(this.bones);
    this.mesh = new Mesh(g, this.skin);
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.root.add(this.mesh);

    this.extras = [];
    data.meta.extras.forEach(({ name }, i) => {
      if (name === "hair") return;
      const eg = new BufferGeometry();
      eg.setAttribute("position", new BufferAttribute(data["extraPosition" + i].slice(), 3));
      eg.setIndex(new BufferAttribute(data["extraIndex" + i], 1));
      eg.computeVertexNormals();
      const material = new MeshPhysicalMaterial({
        color: EXTRA_COLORS[name] ?? 0xbbb4a8,
        roughness: name === "eyebrow" ? 0.85 : 0.25,
      });
      const e = new Mesh(eg, material);
      e.name = name;
      e.userData.base = data["extraPosition" + i];
      e.userData.material = material;
      this.root.add(e);
      this.extras.push(e);
    });

    // Body-region weights, kept as fields for tests and tools.
    this.arm = this.ctx.arm;
    this.hand = this.ctx.hand;
    this.leg = this.ctx.leg;
    this.update(DEFAULT);
  }

  boneIndex(name) {
    const i = this.ctx.bones[name]?.index;
    if (i === undefined) throw new RangeError(`Unknown bone: ${name}`);
    return i;
  }

  /* Rest-pose joint position after the frame edit (the bone's head). */
  joint(name) {
    return this.heads[this.boneIndex(name)];
  }

  update(next) {
    this.state = { ...DEFAULT, ...next };
    const s = this.state;
    applyShape(this.ctx, s, this.positions);
    this.restPositions.set(this.positions);
    const defs = this.data.meta.bones, tmp = [0, 0, 0];
    defs.forEach((d, i) => {
      for (const [vec, src] of [[this.heads[i], d.head], [this.tails[i], d.tail]]) {
        tmp[0] = src[0]; tmp[1] = src[1]; tmp[2] = src[2];
        frameTransform(this.ctx, s, tmp, this.boneArm[i]);
        vec.fromArray(tmp);
      }
    });
    defs.forEach((d, i) => {
      this.bones[i].quaternion.identity();
      this.bones[i].position.copy(this.heads[i]);
      if (d.parent >= 0) this.bones[i].position.sub(this.heads[d.parent]);
      this.skeleton.boneInverses[i].makeTranslation(-this.heads[i].x, -this.heads[i].y, -this.heads[i].z);
    });
    let top = 0;
    for (let o = 1; o < this.restPositions.length; o += 3) if (this.restPositions[o] > top) top = this.restPositions[o];
    for (const e of this.extras) {
      const ep = e.geometry.attributes.position;
      ep.array.set(e.userData.base);
      frameTransform(this.ctx, s, ep.array, 0);
      for (let o = 1; o < ep.array.length; o += 3) if (ep.array[o] > top) top = ep.array[o];
      ep.needsUpdate = true;
    }
    this.height = top;
    this.setPose(this.pose);
    return this;
  }

  setPose(pose) {
    applyPose(this, pose);
    return this;
  }

  setSurface(mode, tone = 1) {
    applySurface(this, mode, tone);
    return this;
  }

  setOverlay(overlay) {
    setOverlay(this, overlay);
    return this;
  }

  /* A point on a bone in the current pose, in world space. */
  landmark(name, fraction = 0.5) {
    const i = this.boneIndex(name);
    const p = this.heads[i].clone().lerp(this.tails[i], fraction).sub(this.heads[i]);
    return this.bones[i].localToWorld(p);
  }

  dispose() {
    this.geometry.dispose();
    disposeSurfaces(this.materials);
    this.skeleton.dispose();
    for (const e of this.extras) {
      e.geometry.dispose();
      e.userData.material.dispose();
    }
  }
}
