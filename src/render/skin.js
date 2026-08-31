/* ---------------------------------------------------------------------------
   Skin.

   Four things separate skin from painted plastic, and all four are here:

   1. Light goes *into* skin and comes back out somewhere else, reddened.
      That is why the edge of an arm against a dark background glows and why
      the shadow line on a shoulder is warm rather than grey. Approximated
      with wrap-around diffuse, curvature-driven red bleed and a back-lit
      transmission term.
   2. Skin is never uniformly rough. Oil and sweat pool on the raised parts
      and skip the creases, so the highlight breaks up. A single roughness
      number is the giveaway of a 2000s render.
   3. Pores. Detail at a scale far below the mesh — added as triplanar noise
      so there is no UV seam and no stretching at the armpit.
   4. Cavities go dark and red. That is what makes a muscle separation read
      as a separation rather than a paint line.

   Everything below is layered onto MeshPhysicalMaterial through
   onBeforeCompile, so shadows, the environment map and tone mapping keep
   working normally.
   --------------------------------------------------------------------------- */
import {
  MeshPhysicalMaterial, DataTexture, RepeatWrapping, RGBAFormat,
  LinearMipmapLinearFilter, LinearFilter, Vector2, Vector3, Color, SRGBColorSpace,
  DoubleSide, FrontSide,
} from 'three';

/* ---- tiling value noise, four octaves packed into RGBA ------------------ */
function noiseTexture(size = 256) {
  const data = new Uint8Array(size * size * 4);
  const oct = [6, 17, 43, 97];
  const grids = oct.map((cells, k) => {
    const g = new Float32Array(cells * cells);
    let s = (0x9e3779b9 ^ (k * 2654435761)) >>> 0;
    for (let i = 0; i < g.length; i++) {
      s = (s * 1664525 + 1013904223) >>> 0;
      g[i] = s / 4294967296;
    }
    return { cells, g };
  });
  const sample = ({ cells, g }, u, v) => {
    const fx = u * cells, fy = v * cells;
    const ix = Math.floor(fx), iy = Math.floor(fy);
    const x0 = ((ix % cells) + cells) % cells, y0 = ((iy % cells) + cells) % cells;
    const x1 = (x0 + 1) % cells, y1 = (y0 + 1) % cells;
    let tx = fx - ix, ty = fy - iy;
    tx = tx * tx * (3 - 2 * tx); ty = ty * ty * (3 - 2 * ty);
    const A = g[y0 * cells + x0], B = g[y0 * cells + x1];
    const C = g[y1 * cells + x0], D = g[y1 * cells + x1];
    return (A * (1 - tx) + B * tx) * (1 - ty) + (C * (1 - tx) + D * tx) * ty;
  };
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size, v = y / size, i = (y * size + x) * 4;
      for (let k = 0; k < 4; k++) data[i + k] = sample(grids[k], u, v) * 255;
    }
  }
  const t = new DataTexture(data, size, size, RGBAFormat);
  t.wrapS = t.wrapT = RepeatWrapping;
  t.minFilter = LinearMipmapLinearFilter;
  t.magFilter = LinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = 8;
  t.needsUpdate = true;
  return t;
}

/* Slightly desaturated bases. A fully saturated skin colour plus a warm rim
   plus subsurface bleed stacks up to terracotta; pulling the base back leaves
   room for all three. */
export const SKIN_TONES = [
  { name: 'Light',  base: 0xc4977c, deep: 0x8a4a3c },
  { name: 'Tan',    base: 0xa06b4e, deep: 0x683429 },
  { name: 'Bronze', base: 0x875638, deep: 0x51281f },
  { name: 'Deep',   base: 0x6c4a35, deep: 0x40231b },
];

export function createSkin({ tone = 1, oil = 0.55 } = {}) {
  const noise = noiseTexture(256);
  const t = SKIN_TONES[tone] || SKIN_TONES[1];

  const mat = new MeshPhysicalMaterial({
    color: new Color(t.base),
    roughness: 0.78,
    metalness: 0.0,
    /* the thin oily film a competitor wears on stage — enough to catch the
       lights along a muscle, not enough to look like a wet mannequin */
    clearcoat: 0.045,
    clearcoatRoughness: 0.62,
    sheen: 0.07,
    sheenRoughness: 0.85,
    sheenColor: new Color(0xff9a7a),
    envMapIntensity: 0.52,
    /* Deep creases — the armpit with the arm up, the back of the knee — fold
       the skin through itself for a few millimetres. With back faces culled
       that fold shows as a hole punched clean through the body against the
       backdrop, which is far worse than the fold itself. */
    side: DoubleSide,
    shadowSide: FrontSide,
  });
  mat.userData.uniforms = null;

  const uniforms = {
    uNoise: { value: noise },
    uOil: { value: oil },
    uDeep: { value: new Color(t.deep) },
    uSSS: { value: 0.42 },
    uPore: { value: 0.16 },
    uCavity: { value: 1.38 },
    uTrunkColor: { value: new Color(0x191b22) },
    uHairColor: { value: new Color(0x241c17) },
    /* head centre in object space, in centimetres — refreshed whenever the
       body changes shape, so the hairline stays put on a taller figure */
    uHead: { value: new Vector3(0, 86, 5) },
    uCrop: { value: 1 },
    uVein: { value: 0.0 },
    uStriate: { value: 0.0 },
    uVeinColor: { value: new Color(0x3f5a6b) },
    uRed: { value: new Color(0xb3543f) },
    /* One noise tile per 46 cm. The body is about 175 cm tall and renders
       maybe 900 pixels high, so a texel lands near 1.5 mm — fine enough to
       read as skin, coarse enough not to alias into gravel. */
    uScale: { value: 1 / 72 },
  };

  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    mat.userData.uniforms = shader.uniforms;

    /* ---------------- vertex ---------------- */
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        attribute float aCavity;
        attribute float aAnatomy;
        attribute vec3 aCover;   /* x trunks, y hair, z eyebrows */
        attribute vec4 aTone;    /* x redness, y darkening, z stubble, w veins */
        attribute vec3 aFibre;   /* which way the muscle fibres run */
        varying float vCavity;
        varying float vAnatomy;
        varying float vTrunk;
        varying float vTrunkRaw;
        varying vec4 vTone;
        varying vec3 vFibre;
        varying vec3 vObjPos;
        varying vec3 vObjNrm;
      `)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vCavity = aCavity;
        vAnatomy = aAnatomy;
        /* fabric and hair have edges; the masks arrive feathered so they can be
           smoothed on the mesh, and the edge is put back here */
        vTrunk = smoothstep(0.36, 0.50, aCover.x);
        vTrunkRaw = aCover.x;
        vTone = aTone;
        vFibre = aFibre;
        vObjPos = transformed;
        vObjNrm = objectNormal;
      `);

    /* ---------------- fragment ---------------- */
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform sampler2D uNoise;
        uniform float uOil, uSSS, uPore, uCavity, uScale;
        uniform vec3 uDeep, uTrunkColor, uHairColor, uRed, uHead;
        uniform float uCrop, uVein, uStriate;
        uniform vec3 uVeinColor;

        /* A cropped head of hair, worked out per pixel from where the point
           sits on the skull rather than from a painted mask. The base mesh
           spends fewer than two hundred vertices on the whole cranium, so any
           mask baked onto it comes out as a torn ragged edge. Doing it here
           costs nothing and the hairline is smooth at any resolution. */
        float scalpHair(vec3 p) {
          vec3 h = p - uHead;
          float ax = abs(h.x);
          /* the line the hair stops at: high across the forehead, dropping
             down the back of the skull toward the nape */
          float cut = -5.6
                    + smoothstep(-2.0, 12.0, h.z) * 10.4
                    - smoothstep(2.0, 9.0, -h.z) * 1.8;
          /* and it recedes a little at the temples */
          cut += smoothstep(4.2, 7.0, ax) * smoothstep(2.0, 8.0, h.z) * 1.3;
          float g = smoothstep(cut - 1.4, cut + 1.4, h.y);
          /* The ear is a hole in the hair, not a rule about the whole side of
             the head — it sits low and forward, so gate on both. */
          float ear = smoothstep(5.6, 7.4, ax)
                    * (1.0 - smoothstep(0.0, 3.0, h.y))
                    * (1.0 - smoothstep(2.0, 6.0, abs(h.z - 1.0)));
          g *= 1.0 - ear;
          /* and it stops at the nape rather than running on down the neck */
          g *= smoothstep(-9.5, -7.0, h.y);
          return clamp(g, 0.0, 1.0) * uCrop;
        }

        /* Eyebrows, for the same reason as the hair: a thin arch painted onto
           a mesh comes out as a row of squares. */
        float browArch(vec3 p) {
          vec3 h = p - uHead;
          float ax = abs(h.x);
          float y0 = -1.95 + smoothstep(1.2, 4.4, ax) * 0.80;
          float g = 1.0 - smoothstep(0.10, 0.66, abs(h.y - y0));
          g *= smoothstep(0.75, 1.55, ax) * (1.0 - smoothstep(4.3, 5.7, ax));
          g *= smoothstep(4.8, 7.0, h.z);
          return clamp(g, 0.0, 1.0);
        }
        varying float vCavity;
        varying float vAnatomy;
        varying float vTrunk;
        varying float vTrunkRaw;
        varying vec4 vTone;
        varying vec3 vFibre;
        varying vec3 vObjPos;
        varying vec3 vObjNrm;
        float vHair;
        float vBrow;

        /* Sample a tiling texture three ways and blend by which way the
           surface faces. No UVs involved, so no seam down the side of the
           body and no smeared pores in the armpit. */
        vec4 triplanar(sampler2D tex, vec3 p, vec3 n, float scale) {
          vec3 b = abs(n);
          b = pow(b, vec3(4.0));
          b /= (b.x + b.y + b.z);
          vec4 cx = texture2D(tex, p.zy * scale);
          vec4 cy = texture2D(tex, p.xz * scale);
          vec4 cz = texture2D(tex, p.xy * scale);
          return cx * b.x + cy * b.y + cz * b.z;
        }

        /* Superficial veins.

           Ridged noise — 1 minus the distance from a midpoint — turns smooth
           blobs into branching lines, which is what a vein network is. The
           sample position is squashed along the limb so the lines run the way
           veins run rather than wrapping round the arm. */
        /* Striations: the individual bundles of a muscle showing through the
           skin. They only appear on a lean, full, contracted muscle, which is
           why they are the thing every competitor is chasing on stage.

           The noise is stretched hard along the fibre direction, so the ridges
           run the length of the muscle instead of crossing it. */
        float striation(vec3 p, vec3 n, vec3 fib) {
          vec3 q = p - fib * dot(p, fib) * 0.90;
          vec4 a = triplanar(uNoise, q, n, 1.0 / 15.0);
          float v = 1.0 - abs(a.z * 2.0 - 1.0);
          return pow(clamp(v, 0.0, 1.0), 1.7);
        }

        float veinField(vec3 p, vec3 n) {
          /* Squashed along the limb so the lines run the way veins run, and
             sampled from the coarsest noise octave so the ridges land four or
             five centimetres apart. Sampling a fine octave gives a dense mesh
             of closed loops, which reads as snakeskin rather than as a vein. */
          vec3 q = p * vec3(1.0, 0.26, 1.0);
          vec4 a = triplanar(uNoise, q, n, 1.0 / 26.0);
          float v = pow(clamp(1.0 - abs(a.x * 2.0 - 1.0), 0.0, 1.0), 9.0);
          /* and they only run in patches, not everywhere at once */
          vec4 g = triplanar(uNoise, p * 0.06 + 3.0, n, 1.0);
          return clamp(v * smoothstep(0.42, 0.66, g.y), 0.0, 1.0);
        }
      `)
      /* the vein field, and the pore-scale bumps that ride on top of it */
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        {
          vec3 op = vObjPos;
          vec3 on = normalize(vObjNrm);
          /* step one texel, so the slope is measured at the texture's own
             resolution instead of across five pores */
          float e = 0.28;
          vec4 n0 = triplanar(uNoise, op, on, uScale);
          vec4 nx = triplanar(uNoise, op + vec3(e, 0.0, 0.0), on, uScale);
          vec4 ny = triplanar(uNoise, op + vec3(0.0, e, 0.0), on, uScale);
          vec4 nz = triplanar(uNoise, op + vec3(0.0, 0.0, e), on, uScale);
          /* three octaves: pores, then flow, then large slack */
          float h0 = n0.w * 0.55 + n0.z * 0.30 + n0.y * 0.15;
          vec3 grad = vec3(
            (nx.w * 0.55 + nx.z * 0.30 + nx.y * 0.15) - h0,
            (ny.w * 0.55 + ny.z * 0.30 + ny.y * 0.15) - h0,
            (nz.w * 0.55 + nz.z * 0.30 + nz.y * 0.15) - h0);
          grad -= on * dot(grad, on);
          float amp = uPore * (1.0 - vTrunk * 0.9) + max(vHair, vBrow) * 1.6;
          normal = normalize(normal - grad * 1.35 * amp);

          /* striations, fine and directional, on top of the pores */
          /* the length of the fibre vector is how much muscle is here: no
             muscle, no striation, which keeps it off the face and hands */
          float sAmt = uStriate * length(vFibre) * (1.0 - vTrunk) * (1.0 - max(vHair, vBrow));
          if (sAmt > 0.002) {
            vec3 fib = normalize(vFibre);
            float e3 = 0.9;
            float s0 = striation(op, on, fib);
            vec3 sg = vec3(striation(op + vec3(e3, 0.0, 0.0), on, fib) - s0,
                           striation(op + vec3(0.0, e3, 0.0), on, fib) - s0,
                           striation(op + vec3(0.0, 0.0, e3), on, fib) - s0);
            sg -= on * dot(sg, on);
            normal = normalize(normal - sg * 0.30 * sAmt);
          }

          /* veins stand proud of the skin, so they get their own bump */
          float vAmt = vTone.w * uVein * (1.0 - vTrunk);
          if (vAmt > 0.002) {
            float e2 = 0.9;
            float v0 = veinField(op, on);
            vec3 vg = vec3(veinField(op + vec3(e2, 0.0, 0.0), on) - v0,
                           veinField(op + vec3(0.0, e2, 0.0), on) - v0,
                           veinField(op + vec3(0.0, 0.0, e2), on) - v0);
            vg -= on * dot(vg, on);
            normal = normalize(normal - vg * 0.85 * vAmt);
          }
        }
      `)
      /* colour: mottling, cavity darkening, hair and the trunks */
      .replace('#include <color_fragment>', `#include <color_fragment>
        vHair = scalpHair(vObjPos);
        vBrow = browArch(vObjPos);
        {
          vec4 nz2 = triplanar(uNoise, vObjPos, normalize(vObjNrm), uScale * 0.34);
          float mott = (nz2.x - 0.5) * 0.07;
          float cav = clamp(vCavity * 9.5, -1.0, 1.0);
          float valley = max(cav, 0.0);
          float authoredValley = smoothstep(0.015, 0.17, vAnatomy);
          float authoredRidge = smoothstep(0.018, 0.18, -vAnatomy);

          /* Skin is never one colour. Hands, face and feet run redder because
             the blood is closer to the surface; knuckles, elbows and knees run
             darker; a shaved jaw runs cooler. Leaving all of that out is what
             makes a figure read as a shop mannequin. */
          diffuseColor.rgb = mix(diffuseColor.rgb, uRed, clamp(vTone.x, 0.0, 1.0) * 0.38);
          diffuseColor.rgb *= 1.0 - vTone.y * 0.24;
          /* thin skin over bone runs cool: the shin, the collarbone, the brow */
          float thin = smoothstep(-0.02, -0.14, vCavity * 9.5);
          diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.94, 0.96, 1.04), thin * 0.30);
          diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.80, 0.83, 0.92), vTone.z * 0.55);

          /* blood pools where the skin folds; ridges read paler */
          diffuseColor.rgb = mix(diffuseColor.rgb, uDeep, valley * 0.24 * uCavity);
          /* Corrective hollows are authored data, not incidental mesh noise.
             Give those valleys the compressed-skin colour they would receive
             from stage light, and keep the intervening tendon/muscle planes
             fractionally paler. */
          diffuseColor.rgb = mix(diffuseColor.rgb, uDeep, authoredValley * 0.42 * uCavity);
          diffuseColor.rgb *= 1.0 + authoredRidge * 0.045;
          diffuseColor.rgb *= 1.0 + mott - valley * 0.13 * uCavity + max(-cav, 0.0) * 0.04;
          /* a broad value drift so the body is not one flat tone from neck to
             ankle: shoulders and back catch the sun, the inner arm does not */
          vec4 lg = triplanar(uNoise, vObjPos, normalize(vObjNrm), uScale * 0.05);
          diffuseColor.rgb *= 0.93 + lg.x * 0.16;

          /* the waistband reads a shade lighter than the panel, the way a
             bound edge does */
          float hem = smoothstep(0.36, 0.46, vTrunkRaw) * (1.0 - smoothstep(0.46, 0.58, vTrunkRaw));
          vec3 fabric = mix(uTrunkColor, uTrunkColor * 2.4 + 0.02, hem);
          diffuseColor.rgb = mix(diffuseColor.rgb, fabric, vTrunk);

          /* veins read cooler than the skin over them */
          float vAmt2 = vTone.w * uVein * (1.0 - vTrunk);
          if (vAmt2 > 0.002) {
            float vv = veinField(vObjPos, normalize(vObjNrm));
            diffuseColor.rgb = mix(diffuseColor.rgb,
              mix(diffuseColor.rgb * 0.92, uVeinColor, 0.16), vv * vAmt2 * 0.22);
          }

          /* hair and eyebrows: not geometry, just a patch of the head that is
             keratin rather than skin */
          float keratin = max(vHair, vBrow);
          vec4 hn = triplanar(uNoise, vObjPos, normalize(vObjNrm), uScale * 4.5);
          vec3 hairCol = uHairColor * (0.62 + hn.w * 0.9 + hn.z * 0.3);
          /* a crop is short enough that the scalp shows through it */
          diffuseColor.rgb = mix(diffuseColor.rgb, hairCol * 0.75, keratin * 0.92);
        }
      `)
      /* roughness: oil on the ridges, matte in the creases and on fabric */
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        {
          vec4 rn = triplanar(uNoise, vObjPos, normalize(vObjNrm), uScale * 0.55);
          vec4 rl = triplanar(uNoise, vObjPos, normalize(vObjNrm), uScale * 0.07);
          /* two scales of break-up: sweat pooling across whole muscle bellies,
             and the fine grain of the skin itself. A single roughness value is
             what makes a render look like painted plastic. */
          float micro = (rn.z - 0.5) * 0.30 + (rn.w - 0.5) * 0.18 + (rl.y - 0.5) * 0.24;
          float cav = vCavity * 9.5;
          float valley = clamp(cav, 0.0, 1.0);
          float ridge = clamp(-cav, 0.0, 1.0);
          float authoredValley = smoothstep(0.015, 0.17, vAnatomy);
          /* oil sits on the high points and skips the creases */
          roughnessFactor = clamp(roughnessFactor + micro + valley * 0.30 + authoredValley * 0.22
                                  - uOil * (0.10 + ridge * 0.34), 0.05, 1.0);
          roughnessFactor = mix(roughnessFactor, 0.94, vTrunk);
          /* hair is matte; leaving it glossy turns a crop into a wet helmet */
          roughnessFactor = mix(roughnessFactor, 0.88, max(vHair, vBrow));
        }
      `)
      .replace('#include <lights_physical_fragment>', `#include <lights_physical_fragment>
        float _cover = max(vTrunk, max(vHair, vBrow));
        material.clearcoat = mix(material.clearcoat * (1.0 - clamp(vCavity * 6.0, 0.0, 0.8)), 0.0, _cover);
        material.sheenColor = mix(material.sheenColor, vec3(0.0), _cover);
        /* hair and fabric barely reflect the room; skin does */
        material.specularF90 = mix(material.specularF90, 0.25, _cover);
      `)
      /* the subsurface pass, on top of the physically-based result */
      .replace('#include <opaque_fragment>', `
        {
          vec3 V = normalize(vViewPosition);
          vec3 N = normal;
          float fres = pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 2.4);
          /* thin, grazing skin glows: ears, the edge of a lat, a forearm */
          vec3 bleed = uDeep * fres * uSSS * (1.0 - max(vTrunk, vHair));
          outgoingLight += bleed * diffuseColor.rgb * 0.85;

          /* warm the terminator: the band where light dies is red in skin,
             grey in plastic */
          float lum = dot(outgoingLight, vec3(0.2126, 0.7152, 0.0722));
          float term = smoothstep(0.42, 0.04, lum) * (1.0 - max(vTrunk, vHair));
          outgoingLight = mix(outgoingLight,
                              outgoingLight * vec3(1.22, 0.90, 0.84), term * 0.42 * uSSS);
          outgoingLight *= mix(vec3(1.0), vec3(1.03, 0.985, 0.965), 0.7);
        }
        #include <opaque_fragment>
      `);
  };

  mat.customProgramCacheKey = () => 'insertion-skin-v1';
  mat.userData.setTone = (i) => {
    const s = SKIN_TONES[i] || SKIN_TONES[1];
    mat.color.set(s.base);
    uniforms.uDeep.value.set(s.deep);
  };
  /* the hairline is placed relative to the head, so it has to be told where
     the head is whenever the body changes shape */
  mat.userData.setHead = (v) => uniforms.uHead.value.copy(v);
  mat.userData.setVein = (v) => { uniforms.uVein.value = v; };
  mat.userData.setStriate = (v) => { uniforms.uStriate.value = v; };
  mat.userData.uniformRefs = uniforms;
  return mat;
}

/* the pinned comparison figure: readable but clearly not the live one */
export function createGhost() {
  const m = new MeshPhysicalMaterial({
    color: new Color(0x8d8a95),
    roughness: 0.62, metalness: 0.0,
    transparent: true, opacity: 0.58, depthWrite: false,
    envMapIntensity: 0.5,
  });
  return m;
}
