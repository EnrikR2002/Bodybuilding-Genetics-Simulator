/* ---------------------------------------------------------------------------
   The figure: one sculpted mesh, deformed by sliders, skinned to a skeleton
   derived from itself.

   The chain on every shape change is:
       rest cage
         -> sculpted morph targets      (mass, fat, frame, limb lengths)
         -> insertion remap             (where each belly sits along its bone)
         -> fat softening               (blend toward a smoothed copy)
         -> Catmull-Clark subdivision   (13k quads -> 107k triangles)
         -> normals
         -> skeleton rebuilt from the same cage
   All of it lands in the same frame, so bones and skin can never disagree.
   --------------------------------------------------------------------------- */
import {
  BufferGeometry, BufferAttribute, SkinnedMesh, Group, Uint16BufferAttribute,
  Float32BufferAttribute, Box3, Vector3, MeshPhysicalMaterial, Color,
} from 'three';
import { loadBundle } from './binary.js';
import { Subdivider, computeNormals } from './subdiv.js';
import { MorphSet } from './morph.js';
import { BodySkeleton } from './skeleton.js';
import { RegionField } from './regions.js';
import { applyParams } from './params.js';
import { applyVolumeBoneTransform } from '../render/skinning.js';
import { MuscleForms } from './muscle-forms.js';

export const CM = 10;              /* MakeHuman decimetres -> centimetres */
/* Depth in centimetres of the crease the shader draws where one muscle hands
   over to the next. Four millimetres is a fold in skin; more is a cut. */
const ATLAS_CREASE = 0.30;

/* ---------------------------------------------------------------------------
   The abdominal wall.

   Everything else on this figure is measured off scanned anatomy. This one
   feature is not, because the scan does not contain it: BodyParts3D modelled
   the rectus abdominis as a smooth strap and left out the tendinous
   inscriptions that cross it and the linea alba that splits it. Those lines
   are most of what anyone means by abs.

   `t` runs 0 at the ribs to 1 at the pubis, along the muscle's own length.
   Three inscriptions cross the upper two thirds and a fourth sits near the
   navel; below that the muscle runs uninterrupted, which is why the lowest
   pair of blocks is always the long one.
   --------------------------------------------------------------------------- */
const AB_ROWS = [0.20, 0.40, 0.60];
const AB_SEGMENT = 0.18;
function abWall(t, midline) {
  /* nothing above the ribs or below the pubis */
  if (t < -0.05 || t > 1.05) return 0;
  let cut = midline * 0.42;
  for (const c of AB_ROWS) {
    const d = (t - c) / 0.030;
    if (d * d < 12) cut = Math.max(cut, Math.exp(-d * d) * 0.34);
  }
  /* the rows fade out where the muscle disappears under the ribs */
  const ends = Math.min(1, Math.max(0, t / 0.10)) * Math.min(1, Math.max(0, (1.02 - t) / 0.10));
  // Convex rectus segments between the inscriptions, with a quieter, longer
  // lower segment. Geometry carries the read in neutral clay as well as skin.
  let belly = 0;
  for (const c of [0.10, 0.30, 0.50, 0.75])
    belly = Math.max(belly, Math.exp(-(((t-c)/0.09)**2))*0.85);
  return (cut-belly*(1-midline))*ends;
}

export async function loadFigure(url, onProgress) {
  const bundle = await loadBundle(url, onProgress);
  return new Figure(bundle);
}

export class Figure {
  constructor(bundle) {
    const H = bundle.header;
    this.bundle = bundle;
    this.header = H;

    this.basePos = bundle.byName('basePos');
    this.smoothOffset = bundle.byName('smoothOffset');
    this.quads = bundle.byName('quads');
    this.subQuads = bundle.byName('subQuads');
    this.renderSub = bundle.byName('renderSub');
    this.nCage = H.nCage;
    this.nSubVerts = H.nSubVerts;
    this.nRender = H.nRender;

    /* working buffers, reused every update */
    this.cage = new Float32Array(this.nCage * 3);
    this.cageMorphed = new Float32Array(this.nCage * 3);
    this.rigCage = new Float32Array(this.nCage * 3);
    this.subNormals = new Float32Array(this.nSubVerts * 3);

    this.morph = new MorphSet(bundle);
    this.skeleton = new BodySkeleton(bundle);

    /* subdivision levels, rehydrated from the bundle */
    const levels = H.levels.map(l => ({
      nVerts: l.nVerts, nE: l.nE, nF: l.nF, nOut: l.nOut,
      edgeV: bundle.block(l.edgeV), edgeF: bundle.block(l.edgeF),
      quadEdge: bundle.block(l.quadEdge),
      vfOff: bundle.block(l.vfOff), vfIdx: bundle.block(l.vfIdx),
      veOff: bundle.block(l.veOff), veIdx: bundle.block(l.veIdx),
      quads: bundle.block(l.quads),
    }));
    this.subdiv = new Subdivider(levels);
    this.levels = levels;

    this.regions = null;             /* filled by attachRegions() */
    this.geometry = this._buildGeometry(bundle);
    this.mesh = new SkinnedMesh(this.geometry, null);
    this.mesh.applyBoneTransform = applyVolumeBoneTransform;
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;

    this.root = new Group();
    this.root.add(this.skeleton.roots[0]);
    this.root.add(this.mesh);
    this._buildEyes(bundle);

    this.height = 0;
    this._box = new Box3();
    this._v = new Vector3();
  }

  /* The base mesh ships eyeball spheres as their own groups. They are not part
     of the skin surface, so they get their own small mesh — rigid, welded to
     the head bone, no subdivision needed at 70 quads each. */
  _buildEyes(bundle) {
    const eq = bundle.byName('eyeQuads');
    if (!eq || !eq.length) return;
    const map = new Map();
    const verts = [];
    const tris = [];
    const idx = v => {
      let i = map.get(v);
      if (i === undefined) { i = verts.length; map.set(v, i); verts.push(v); }
      return i;
    };
    for (let f = 0; f < eq.length / 4; f++) {
      const a = idx(eq[f * 4]), b = idx(eq[f * 4 + 1]), c = idx(eq[f * 4 + 2]), d = idx(eq[f * 4 + 3]);
      tris.push(a, b, c, a, c, d);
    }
    this.eyeVerts = Int32Array.from(verts);
    const n = verts.length;
    this.eyePos = new Float32Array(n * 3);
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(this.eyePos, 3));
    g.setAttribute('normal', new BufferAttribute(new Float32Array(n * 3), 3));
    const head = this.skeleton.defs.findIndex(d => d.name === 'head');
    const si = new Uint16Array(n * 4), sw = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) { si[i * 4] = Math.max(0, head); sw[i * 4] = 1; }
    g.setAttribute('skinIndex', new Uint16BufferAttribute(si, 4));
    g.setAttribute('skinWeight', new Float32BufferAttribute(sw, 4));
    g.setIndex(new BufferAttribute(Uint16Array.from(tris), 1));
    /* Iris and pupil painted into vertex colours, dark and large. The eye
       is the first thing anyone looks at, and a bright sphere behind a narrow
       eyelid reads as a corpse — which is exactly what a mirror-finish
       eyeball under a studio light does. */
    // Each eye has its own centre. Averaging both eyes placed the old iris
    // calculation halfway between them and produced blank, metallic sockets.
    const centres = [new Vector3(), new Vector3()], counts = [0, 0];
    for (const v of verts) {
      const side = this.basePos[v * 3] > 0 ? 1 : 0;
      centres[side].add(new Vector3().fromArray(this.basePos, v * 3)); counts[side]++;
    }
    centres.forEach((c, i) => c.divideScalar(counts[i] || 1));
    const eyeLocal = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const v = verts[i], side = this.basePos[v * 3] > 0 ? 1 : 0;
      const local = new Vector3().fromArray(this.basePos, v * 3).sub(centres[side]).normalize();
      local.toArray(eyeLocal, i * 3);
    }
    g.setAttribute('aEyeLocal', new BufferAttribute(eyeLocal, 3));

    this.eyeGeometry = g;
    /* A real eye catches one small hard highlight. Give it a broad soft one —
       which is what a rough surface under a studio dome does — and it reads as
       a blank white marble behind the lid. */
    this.eyes = new SkinnedMesh(g, new MeshPhysicalMaterial({
      color: 0xc7bcb0, roughness: 0.22, metalness: 0,
      clearcoat: 0, envMapIntensity: 0.10,
    }));
    this.eyes.material.onBeforeCompile = shader => {
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nattribute vec3 aEyeLocal; varying vec3 vEyeLocal;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvEyeLocal = aEyeLocal;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vEyeLocal;')
        .replace('#include <color_fragment>', `#include <color_fragment>
          vec3 eye = normalize(vEyeLocal);
          float r = length(eye.xy);
          float iris = (1.0-smoothstep(0.57,0.64,r))*step(0.0,eye.z);
          float pupil = 1.0-smoothstep(0.23,0.27,r);
          float fibres = 0.5+0.5*sin(atan(eye.y,eye.x)*64.0+r*18.0);
          vec3 irisColor = mix(vec3(0.045,0.027,0.014),vec3(0.14,0.084,0.035),fibres);
          irisColor = mix(irisColor,vec3(0.003),pupil);
          diffuseColor.rgb = mix(diffuseColor.rgb,irisColor,iris);
        `);
    };
    this.eyes.applyBoneTransform = applyVolumeBoneTransform;
    this.eyes.frustumCulled = false;
    this.root.add(this.eyes);
  }

  _updateEyes() {
    if (!this.eyes) return;
    const v = this.eyeVerts, p = this.eyePos, c = this.cage;
    for (let i = 0; i < v.length; i++) {
      const s = v[i] * 3, o = i * 3;
      p[o] = c[s]; p[o + 1] = c[s + 1]; p[o + 2] = c[s + 2];
    }
    this.eyeGeometry.attributes.position.needsUpdate = true;
    this.eyeGeometry.computeVertexNormals();
  }

  _buildGeometry(bundle) {
    const g = new BufferGeometry();
    const n = this.nRender;
    this.rPos = new Float32Array(n * 3);
    this.rNrm = new Float32Array(n * 3);
    g.setAttribute('position', new BufferAttribute(this.rPos, 3));
    g.setAttribute('normal', new BufferAttribute(this.rNrm, 3));
    g.setAttribute('uv', new BufferAttribute(bundle.byName('renderUV'), 2));
    g.setAttribute('skinIndex', new Uint16BufferAttribute(bundle.byName('skinIndex'), 4));
    g.setAttribute('skinWeight', new Float32BufferAttribute(bundle.byName('skinWeight'), 4));
    g.setIndex(new BufferAttribute(bundle.byName('index'), 1));
    return g;
  }

  attachRegions(regionBundle, anatomyBundle) {
    this.regions = new RegionField(regionBundle, this, anatomyBundle);

    /* Two extra per-vertex channels the skin shader needs.

       `aCavity` is how concave the surface is at that point, recomputed every
       time the shape changes. It is what darkens the split between two
       muscles, reddens a crease, and keeps the oiled highlight off the
       valleys. A baked ambient-occlusion map cannot do that on a body that
       changes shape while you drag a slider.

       `aTrunk` marks the posing trunks so the shader can switch that patch
       from oiled skin to matte fabric. */
    this.cageCurv = new Float32Array(this.nCage);
    this._restEdge = new Float32Array(this.nCage);
    this.subCurv = new Float32Array(this.nSubVerts);
    this.subAnatomy = new Float32Array(this.nSubVerts);
    this.subDisplace = new Float32Array(this.nSubVerts);
    this.rCavity = new Float32Array(this.nRender);
    this.geometry.setAttribute('aCavity', new BufferAttribute(this.rCavity, 1));
    this.rAnatomy = new Float32Array(this.nRender);
    this.geometry.setAttribute('aAnatomy', new BufferAttribute(this.rAnatomy, 1));

    /* masks and tone, carried up from the cage once — none of them change
       while the app is running */
    const H = regionBundle.header;
    const scratch = new Float32Array(this.nSubVerts);
    const carry = (block, comps = 1) => {
      const src = regionBundle.block(block);
      const out = new Float32Array(this.nRender * comps);
      for (let c = 0; c < comps; c++) {
        const one = comps === 1 ? src : Float32Array.from(
          { length: this.nCage }, (_, i) => src[i * comps + c]);
        this.subdivideScalar(one, scratch);
        for (let r = 0; r < this.nRender; r++) out[r * comps + c] = scratch[this.renderSub[r]];
      }
      return out;
    };
    /* trunks, hair and eyebrows share one attribute: three masks, three
       channels, one extra buffer instead of three */
    const trunk = carry(H.trunkMask);
    const hair = carry(H.hairMask);
    const brow = carry(H.browMask);
    const cover = new Float32Array(this.nRender * 3);
    for (let r = 0; r < this.nRender; r++) {
      cover[r * 3] = trunk[r]; cover[r * 3 + 1] = hair[r]; cover[r * 3 + 2] = brow[r];
    }
    this.geometry.setAttribute('aCover', new BufferAttribute(cover, 3));
    const tone = carry(H.toneMap, 3);
    const vein = carry(H.veinMask);
    /* tone has three channels and the vein map is a fourth; they travel
       together rather than as two attributes */
    const tv = new Float32Array(this.nRender * 4);
    for (let r = 0; r < this.nRender; r++) {
      tv[r * 4] = tone[r * 3]; tv[r * 4 + 1] = tone[r * 3 + 1];
      tv[r * 4 + 2] = tone[r * 3 + 2]; tv[r * 4 + 3] = vein[r];
    }
    this.geometry.setAttribute('aTone', new BufferAttribute(tv, 4));
    this.geometry.setAttribute('aFibre', new BufferAttribute(carry(H.fibreDir, 3), 3));
    if (this.regions.anatomy.atlas) this.muscleForms = new MuscleForms(this, this.regions.anatomy.atlas);
    return this;
  }

  /* Carry a per-cage-vertex value up to the subdivided mesh by plain
     averaging — the same rule the UVs use, so it lines up exactly. */
  subdivideScalar(src, out) {
    const L = this.levels[0];
    if (!L) { out.set(src.subarray(0, out.length)); return out; }
    out.set(src.subarray(0, L.nVerts));
    for (let e = 0; e < L.nE; e++)
      out[L.nVerts + e] = (src[L.edgeV[e * 2]] + src[L.edgeV[e * 2 + 1]]) * 0.5;
    const q = L.quads;
    for (let f = 0; f < L.nF; f++)
      out[L.nVerts + L.nE + f] =
        (src[q[f * 4]] + src[q[f * 4 + 1]] + src[q[f * 4 + 2]] + src[q[f * 4 + 3]]) * 0.25;
    return out;
  }

  /* How much the surface curves in or out at each vertex, measured against
     the neighbours the region bake already gave us. */
  _computeCavity() {
    const R = this.regions;
    if (!R) return;
    const { adjOff, adjIdx, inBody } = R;
    const c = this.cage, curv = this.cageCurv;
    const nrm = R.restNormal;
    for (let v = 0; v < this.nCage; v++) {
      const s = adjOff[v], e = adjOff[v + 1];
      if (!inBody[v] || e === s) { curv[v] = 0; continue; }
      let x = 0, y = 0, z = 0;
      const o = v * 3;
      for (let i = s; i < e; i++) {
        const n = adjIdx[i] * 3;
        x += c[n] - c[o]; y += c[n + 1] - c[o + 1]; z += c[n + 2] - c[o + 2];
      }
      const k = e - s;
      x /= k; y /= k; z /= k;
      let avg = this._restEdge[v];
      if (avg === 0) {
        let len = 0;
        for (let i = s; i < e; i++) {
          const n = adjIdx[i] * 3;
          len += Math.hypot(c[n] - c[o], c[n + 1] - c[o + 1], c[n + 2] - c[o + 2]);
        }
        avg = this._restEdge[v] = (len / k) || 1;
      }
      /* project the offset-to-neighbours onto the normal: positive means the
         surface dips away here, which is a valley */
      curv[v] = (x * nrm[o] + y * nrm[o + 1] + z * nrm[o + 2]) / avg;
    }
    this.subdivideScalar(curv, this.subCurv);
    const { renderSub, rCavity } = this;
    for (let r = 0; r < this.nRender; r++) {
      const s = renderSub[r];
      /* Fine correctives are applied after cage curvature is measured. Feed
         their depth into the valley channel so grooves lose oily highlights
         and receive the subtle colour of compressed skin. */
      rCavity[r] = this.subCurv[s] + (this.subAnatomy?.[s] || 0) * 0.32;
    }
    this.geometry.attributes.aCavity.needsUpdate = true;
  }

  bindSkeleton() {
    this.mesh.bind(this.skeleton.skeleton, this.mesh.matrixWorld);
    if (this.eyes) this.eyes.bind(this.skeleton.skeleton, this.eyes.matrixWorld);
    return this;
  }

  /* ---------------------------------------------------------------------- *
     One full shape rebuild. Everything here runs to completion before the
     next render, which is why the mesh never tears while a slider is moving.
   * ---------------------------------------------------------------------- */
  update(params) {
    /* 1 — sculpted targets */
    this.morph.clear();
    const ctx = applyParams(this.morph, params);
    this.lastCtx = ctx;
    this.morph.apply(this.basePos, this.cageMorphed);
    // Some twist-bone centres are averages of surface vertices. Derive bones
    // before muscle reshaping so belly length cannot move the underlying rig.
    this.rigCage.set(this.cageMorphed);
    this._correctProportions(this.rigCage);

    /* 2 — insertion remap and fat softening, on the control cage */
    if (this.regions) this.regions.deform(this.cageMorphed, params, ctx);
    this.muscleForms?.deform(this.cageMorphed, this, params, ctx);
    this._softenForFat(params, ctx);
    this._correctProportions();

    /* 3 — units: MakeHuman works in decimetres, everything above this in cm */
    const c = this.cage;
    for (let i = 0; i < c.length; i++) c[i] = this.cageMorphed[i] * CM;

    /* 4 — skeleton, from the same cage, same frame */
    this.skeleton.rebuild(this.rigCage, CM);

    /* 5 — subdivide and gather */
    const sub = this.subdiv.run(c);
    computeNormals(this.subQuads, sub, this.nSubVerts, this.subNormals);
    /* Preserve authored intermuscular valleys at render resolution. Applying
       the fine share after Catmull-Clark keeps abs, delt splits and tendon
       planes from being averaged back into the inflated base surface. */
    const anatomy = this.regions?.anatomy?.current;
    if (anatomy) {
      this.subdivideScalar(anatomy, this.subDisplace);
      this.subdivideScalar(this.regions.anatomy.line, this.subAnatomy);
      /* The measured surface, added here rather than on the control cage.
         Render resolution is the only place a tendinous inscription or the
         split between two heads of a muscle exists at all: averaged down to
         the cage it comes back as one smooth slab, which is exactly what the
         figure used to look like. */
      const atlas = this.regions.anatomy.atlas;
      if (atlas) {
        const gain = this.regions.anatomy.atlasGain;
        const rowGain = this.regions.anatomy.rowGain;
        /* The two rows rarely line up left to right, and how far out of step
           they sit is decided before anyone trains. Half a segment either way
           covers the range real people show. */
        const shift = this.regions.anatomy.rowStagger * AB_SEGMENT * 0.5;
        for (let v = 0; v < this.nSubVerts; v++) {
          if (!atlas.covered[v]) continue;
          const g = gain[atlas.drive[v]];
          if (g <= 0.001) continue;
          const relief = this.muscleForms?.relief || atlas.relief;
          const borders = this.muscleForms?.border || atlas.border;
          let d = relief[v] * g;
          d += (this.muscleForms?.envelope[v] || 0) * g;
          d -= borders[v] * 0.20 * g;
          let crease = borders[v] * ATLAS_CREASE * g;
          if (atlas.owner[v] === atlas.rectus && rowGain > 0.001) {
            // The atlas torso is longer than the surface template. Register
            // inscriptions below the pec fold, rather than across the nipple.
            const restY=this.muscleForms?.rest[v*3+1];
            const along=restY===undefined?atlas.along[v]:(4.15-restY)/3.45;
            const cut = abWall(along + shift * atlas.side[v],
                               atlas.midline[v]) * rowGain;
            d -= cut;
            crease += Math.max(0,cut);
          }
          this.subDisplace[v] -= d;
          this.subAnatomy[v] += crease;
        }
      }
      this.muscleForms?.smoothSurface(this.subDisplace);
      for (let v = 0; v < this.nSubVerts; v++) {
        /* AnatomyCorrectives stores centimetres. A groove deeper than about
           four millimetres reads as a cut in skin, so keep the render-scale
           share close to physical size instead of amplifying the coarse mask. */
        const o = v * 3, d = this.subDisplace[v] * 1.05;
        sub[o] -= this.subNormals[o] * d;
        sub[o + 1] -= this.subNormals[o + 1] * d;
        sub[o + 2] -= this.subNormals[o + 2] * d;
      }
      computeNormals(this.subQuads, sub, this.nSubVerts, this.subNormals);
    }
    const { renderSub, rPos, rNrm } = this;
    for (let r = 0; r < this.nRender; r++) {
      const s = renderSub[r] * 3, o = r * 3;
      rPos[o] = sub[s]; rPos[o + 1] = sub[s + 1]; rPos[o + 2] = sub[s + 2];
      rNrm[o] = this.subNormals[s]; rNrm[o + 1] = this.subNormals[s + 1]; rNrm[o + 2] = this.subNormals[s + 2];
      this.rAnatomy[r] = this.subAnatomy[renderSub[r]];
    }
    this.geometry.attributes.position.needsUpdate = true;
    this.geometry.attributes.normal.needsUpdate = true;
    this.geometry.attributes.aAnatomy.needsUpdate = true;

    this.subPos = sub;
    this._updateEyes();
    this._computeCavity();
    this._measureHeight();
    return this;
  }

  /* An unposed, unflexed copy of the body, in centimetres, for the tape
     measure. Taking the numbers off the live figure would make them jump every
     time the pose changed, which is not what a tape measure does. */
  measureCage(params) {
    if (!this._mCage) {
      this._mCage = new Float32Array(this.nCage * 3);
      this._mOut = new Float32Array(this.nCage * 3);
      this._mRigCage = new Float32Array(this.nCage * 3);
    }
    const neutral = { ...params, latFlare: 0, chestUp: 0, vacuum: 0, flex: 0.35 };
    this.morph.clear();
    const ctx = applyParams(this.morph, neutral);
    this.morph.apply(this.basePos, this._mCage);
    this._mRigCage.set(this._mCage);
    this._correctProportions(this._mRigCage);
    if (this.regions) this.regions.deform(this._mCage, neutral, ctx);
    this.muscleForms?.deform(this._mCage, this, neutral, ctx);
    const t = ctx.soften, s = this.smoothOffset, c = this._mCage;
    if (t > 0.001) for (let i = 0; i < c.length; i++) c[i] += s[i] * t;
    this._correctProportions(c);
    const out = this._mOut;
    for (let i = 0; i < c.length; i++) out[i] = c[i] * CM;
    this._measureSkel = this._measureSkel || new BodySkeleton(this.bundle);
    this._measureSkel.rebuild(this._mRigCage, CM);
    return { cage: out, skeleton: this._measureSkel };
  }

  _softenForFat(params, ctx) {
    /* Fat does two things: it adds volume, and it rubs out the line between
       one muscle and the next. The sculpted weight targets cover the volume.
       This covers the second half — a blend toward a Laplacian-smoothed copy
       of the same mesh, which is exactly "the edges got softer". */
    const t = ctx.soften;
    if (t <= 0.001) return;
    const c = this.cageMorphed, s = this.smoothOffset;
    for (let i = 0; i < c.length; i++) c[i] += s[i] * t;
  }

  /* The average MakeHuman cranium reads undersized once the shoulder and
     torso targets reach bodybuilding proportions. This topology-preserving
     corrective includes the eyes and internal joint helpers, so the rig and
     the visible surface remain in the same frame. */
  _correctProportions(c = this.cageMorphed) {
    const base = this.basePos;
    const px = 0, py = 7.54, pz = 0.52;
    const sx = 1.055, sy = 1.045, sz = 1.045;
    for (let v = 0; v < this.nCage; v++) {
      const o = v * 3;
      const y = base[o + 1];
      /* Rest-space gating keeps hands out and eases through the upper neck. */
      if (y < 7.42 || Math.abs(base[o]) > 1.22) continue;
      const t = Math.min(1, Math.max(0, (y - 7.42) / 0.42));
      c[o] += (c[o] - px) * (sx - 1) * t;
      c[o + 1] += (c[o + 1] - py) * (sy - 1) * t;
      c[o + 2] += (c[o + 2] - pz) * (sz - 1) * t;
    }
  }

  _measureHeight() {
    let lo = Infinity, hi = -Infinity;
    const q = this.quads, c = this.cage;
    for (let i = 0; i < q.length; i++) {
      const y = c[q[i] * 3 + 1];
      if (y < lo) lo = y;
      if (y > hi) hi = y;
    }
    this.floorY = lo;
    this.height = hi - lo;
    this.root.position.y = -lo;
  }
}
