/* ---------------------------------------------------------------------------
   Surface materials.

   `SURFACES` lists the finishes the UI offers (`menu: false` ones are used
   internally). Every figure owns its own material instances and its own
   anatomy palette, so a pinned comparison never shares state with the
   current figure. All body finishes keep the posing-trunk mask, painted in
   sculpt space from the `aRest` attribute (the unposed artist surface).

   Anatomy map: when the sculpt has projected anatomy the geometry carries
   `aMuscle`, `aMuscle2` (structure ids), `aBlend` (weight of the primary,
   0.5 on a border) and `aAlong`. The vertex shader looks both ids up in a
   256×1 palette texture (rgb = colour, a = focus) and blends them by aBlend,
   so colours and borders interpolate smoothly across triangles.

   setOverlay(fig, { mode: "off" | "focus" | "all", focus: [ids] }).
   --------------------------------------------------------------------------- */
import {
  MeshPhysicalMaterial, ShaderMaterial, DataTexture, RGBAFormat, UnsignedByteType,
  NearestFilter, Color, AdditiveBlending, FrontSide,
} from "three";

export const SURFACES = [
  { id: "skin", label: "Skin" },
  { id: "tan", label: "Stage tan" },
  { id: "clay", label: "Sculpt clay" },
  { id: "anatomy", label: "Muscle map" },
  { id: "ghost", label: "Ghost", menu: false },
];

export const TONES = [
  { id: 0, label: "Light", color: 0xd3ae97, tan: 0xa06a45 },
  { id: 1, label: "Warm", color: 0xb88f79, tan: 0x87512f },
  { id: 2, label: "Bronze", color: 0x986b4d, tan: 0x6c3d22 },
  { id: 3, label: "Deep", color: 0x6e4838, tan: 0x4c2b1b },
];

/* A categorical palette: neighbouring structures get clearly different hues,
   tendons and bone read ivory, as on an anatomy plate. */
const COLORS = {
  sternocleidomastoid: "#c46a6a",
  deltoid_anterior: "#d9824b", deltoid_lateral: "#e5ad5c", deltoid_posterior: "#c0603b",
  pectoralis_clavicular: "#cf5963", pectoralis_sternal: "#a93541", serratus: "#e09a96",
  biceps_long: "#b24a8c", biceps_short: "#8b3a78", biceps_tendon: "#ebe0cf", brachialis: "#6f5cab",
  triceps_long: "#2f9c9a", triceps_lateral: "#5fc2b8", triceps_medial: "#237270",
  brachioradialis: "#c97d3c", forearm_flexors: "#9c6b50", forearm_extensors: "#bb9068",
  rectus_abdominis: "#d4a64c", external_oblique: "#8aa55b",
  trapezius_upper: "#8aa84e", trapezius_middle: "#6b8c3c", trapezius_lower: "#a9c46e",
  latissimus: "#3d6fa9", teres_major: "#7b65b2", infraspinatus: "#9c7cc6", rhomboid: "#57718b",
  erector_spinae: "#b18b4b",
  gluteus_maximus: "#8f5ba2", gluteus_medius: "#b27cc2", tensor_fasciae_latae: "#d38caa",
  rectus_femoris: "#c24b3b", vastus_lateralis: "#dc8b4f", vastus_medialis: "#e8c24b",
  sartorius: "#7fb06b", adductors: "#5a907b", gracilis: "#9bc68b",
  biceps_femoris: "#6a62bf", semitendinosus: "#8d86d8", semimembranosus: "#4f4a9a", patellar_tendon: "#ebe0cf",
  gastrocnemius_medial: "#b9474f", gastrocnemius_lateral: "#d6746d", soleus: "#8b5b9b",
  calcaneal_tendon: "#ece2d1", tibialis_anterior: "#cba24b", fibularis: "#7b9b5b",
};
const BONE = "#e6dcc6", NONE = "#9b948f";
const colorOf = (name) => {
  const base = name.replace(/\.(L|R)$/, "");
  return base.startsWith("bone_") ? BONE : COLORS[base] ?? NONE;
};

const BRIEFS = /* glsl */ `
  varying vec3 vRest;
  float hashSkin(vec3 p){return fract(sin(dot(p,vec3(127.1,311.7,74.7)))*43758.5453);}
  float skinNoise(vec3 p){vec3 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(mix(hashSkin(i),hashSkin(i+vec3(1,0,0)),f.x),mix(hashSkin(i+vec3(0,1,0)),hashSkin(i+vec3(1,1,0)),f.x),f.y),mix(mix(hashSkin(i+vec3(0,0,1)),hashSkin(i+vec3(1,0,1)),f.x),mix(hashSkin(i+vec3(0,1,1)),hashSkin(i+vec3(1,1,1)),f.x),f.y),f.z);}
  float briefs(){float hem=82.+5.*smoothstep(0.,13.,abs(vRest.x));return smoothstep(hem-.15,hem+.15,vRest.y)*(1.-smoothstep(98.8,99.1,vRest.y));}
  float waistband(){return smoothstep(97.2,97.5,vRest.y)*(1.-smoothstep(98.8,99.1,vRest.y));}
`;

/* kind: "skin" | "tan" | "clay" | "anatomy" */
function bodyMaterial(kind, shared) {
  const params = {
    skin: { color: 0xb88f79, roughness: 0.58, sheen: 0.35, sheenRoughness: 0.55, sheenColor: 0xffc9b0, envMapIntensity: 0.55 },
    tan: { color: 0x87512f, roughness: 0.4, clearcoat: 0.9, clearcoatRoughness: 0.14, sheen: 0.25, sheenRoughness: 0.4, sheenColor: 0xffb080, envMapIntensity: 0.8 },
    clay: { color: 0xb8bbbb, roughness: 0.62, sheen: 0.25, sheenRoughness: 0.7, sheenColor: 0xffffff, envMapIntensity: 0.6 },
    anatomy: { color: 0xb9b3ad, roughness: 0.55, sheen: 0.2, sheenRoughness: 0.6, sheenColor: 0xffffff, envMapIntensity: 0.55 },
  }[kind];
  const m = new MeshPhysicalMaterial({ metalness: 0, ...params });
  const u = {
    uPalette: shared.palette,
    uMapMix: { value: kind === "anatomy" ? 0.92 : 0 },
    uFocusMix: shared.focusMix,
    uFocusColor: shared.focusColor,
    uDim: shared.dim,
  };
  m.userData.kind = kind;
  m.userData.uniforms = u;
  const anatomy = shared.hasAnatomy;
  m.onBeforeCompile = (s) => {
    Object.assign(s.uniforms, u);
    s.vertexShader = s.vertexShader
      .replace("#include <common>", `#include <common>
        attribute vec3 aRest; varying vec3 vRest;
        #ifdef USE_ANATOMY
          attribute float aMuscle; attribute float aMuscle2; attribute float aBlend;
          uniform sampler2D uPalette;
          varying vec3 vMap; varying float vFocus; varying float vEdge;
        #endif`)
      .replace("#include <begin_vertex>", `#include <begin_vertex>
        vRest = aRest;
        #ifdef USE_ANATOMY
          vec4 p1 = texture2D(uPalette, vec2((aMuscle + .5) / 256., .5));
          vec4 p2 = texture2D(uPalette, vec2((aMuscle2 + .5) / 256., .5));
          float has2 = step(.5, aMuscle2);
          float w = mix(1., smoothstep(.36, .64, aBlend), has2);
          vMap = mix(p2.rgb, p1.rgb, w);
          vFocus = mix(p2.a, p1.a, w);
          vEdge = has2 * (1. - smoothstep(.5, .62, aBlend));
        #endif`);
    s.fragmentShader = s.fragmentShader
      .replace("#include <common>", `#include <common>
        ${BRIEFS}
        uniform float uMapMix; uniform float uFocusMix; uniform vec3 uFocusColor; uniform float uDim;
        #ifdef USE_ANATOMY
          varying vec3 vMap; varying float vFocus; varying float vEdge;
        #endif`)
      .replace("#include <color_fragment>", `#include <color_fragment>
        float fabric = briefs();
        float variation = skinNoise(vRest * .24);
        diffuseColor.rgb *= .96 + .08 * variation;
        ${kind === "skin" || kind === "tan" ? `
        float areola = exp(-pow((abs(vRest.x) - 9.7) / 1.0, 2.) - pow((vRest.y - 133.) / .85, 2.)) * smoothstep(6., 11., vRest.z);
        diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(.58, .39, .35), areola * .5);` : ""}
        #ifdef USE_ANATOMY
          vec3 mapc = vMap * (1. - .38 * vEdge);
          diffuseColor.rgb = mix(diffuseColor.rgb, mapc, uMapMix);
          float lum = dot(diffuseColor.rgb, vec3(.299, .587, .114));
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(lum) * .85, uDim * (1. - vFocus) * .55);
          diffuseColor.rgb = mix(diffuseColor.rgb, uFocusColor, vFocus * uFocusMix * .62);
        #endif
        vec3 cloth = vec3(.018, .022, .027) + vec3(.02) * waistband();
        diffuseColor.rgb = mix(diffuseColor.rgb, cloth, fabric);`)
      .replace("#include <roughnessmap_fragment>", `#include <roughnessmap_fragment>
        roughnessFactor += .035 * (skinNoise(vRest * 3.) - .5);
        roughnessFactor = mix(roughnessFactor, .55 - .2 * waistband(), briefs());`)
      .replace("#include <normal_fragment_maps>", `#include <normal_fragment_maps>
        float h = (skinNoise(vRest * 6.) - .5) * .002 * (1. - briefs());
        vec3 dx = dFdx(-vViewPosition), dy = dFdy(-vViewPosition), r1 = cross(dy, normal), r2 = cross(normal, dx);
        float det = dot(dx, r1); normal = normalize(abs(det) * normal - sign(det) * (dFdx(h) * r1 + dFdy(h) * r2));`)
      .replace("#include <emissivemap_fragment>", `#include <emissivemap_fragment>
        #ifdef USE_ANATOMY
          totalEmissiveRadiance += uFocusColor * vFocus * uFocusMix * .05;
        #endif`);
    // the oil film follows the same micro-relief as the skin under it
    s.fragmentShader = s.fragmentShader.replace("#include <clearcoat_normal_fragment_maps>",
      "#include <clearcoat_normal_fragment_maps>\n #ifdef USE_CLEARCOAT\n clearcoatNormal = normal;\n #endif");
  };
  if (anatomy) m.defines = { ...m.defines, USE_ANATOMY: "" };
  m.customProgramCacheKey = () => `freeman-${kind}-${anatomy ? 1 : 0}`;
  return m;
}

/* A see-through silhouette for overlay comparisons: fresnel-weighted edges,
   additive, no depth writes, so it never hides the figure it is laid over. */
function ghostMaterial() {
  return new ShaderMaterial({
    uniforms: { uColor: { value: new Color(0x8fd8ff) } },
    vertexShader: /* glsl */ `
      varying vec3 vN; varying vec3 vV;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.);
        vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor; varying vec3 vN; varying vec3 vV;
      void main() {
        // contour lines only: the interior adds nothing, the turning edge glows
        float f = smoothstep(.55, .93, 1. - abs(dot(normalize(vN), normalize(vV))));
        gl_FragColor = vec4(uColor * f * .9, 1.);
      }`,
    // drawn on top without a depth test: the ghost coincides with the figure
    // under it almost everywhere, and a depth test would make the two fight
    transparent: true, depthWrite: false, depthTest: false, blending: AdditiveBlending, side: FrontSide,
  });
}

/* One set of materials and one palette per figure. */
export function createSurfaces(anatomy = null) {
  const data = new Uint8Array(256 * 4);
  const muscles = anatomy?.muscles ?? ["none"];
  const c = new Color();
  for (let i = 0; i < 256; i++) {
    c.set(i < muscles.length && i > 0 ? colorOf(muscles[i]) : NONE); // Color.set converts sRGB → linear
    data.set([c.r * 255, c.g * 255, c.b * 255, 0], i * 4);
  }
  const palette = new DataTexture(data, 256, 1, RGBAFormat, UnsignedByteType);
  palette.minFilter = palette.magFilter = NearestFilter;
  palette.needsUpdate = true;
  const shared = {
    hasAnatomy: !!anatomy, palette: { value: palette }, paletteData: data,
    focusMix: { value: 0 }, focusColor: { value: new Color(0xff5a2e) }, dim: { value: 0 },
  };
  const m = {
    skin: bodyMaterial("skin", shared), tan: bodyMaterial("tan", shared),
    clay: bodyMaterial("clay", shared), anatomy: bodyMaterial("anatomy", shared),
    ghost: ghostMaterial(),
  };
  Object.defineProperty(m, "shared", { value: shared, enumerable: false });
  return m;
}

export function applySurface(fig, mode, tone = 1) {
  const m = fig.materials;
  if (!m[mode]) mode = "skin";
  fig.surface = mode;
  fig.mesh.material = m[mode];
  fig.mesh.castShadow = mode !== "ghost";
  const t = TONES[tone] ?? TONES[1];
  m.skin.color.set(t.color);
  m.tan.color.set(t.tan);
  for (const e of fig.extras) {
    e.material = mode === "ghost" ? m.ghost : mode === "clay" || mode === "anatomy" ? m.clay : e.userData.material;
    e.visible = true;
  }
  if (fig.overlay) setOverlay(fig, fig.overlay); // dimming depends on the surface
}

/* Highlight structures (focus) or show the whole map (all). */
export function setOverlay(fig, overlay = { mode: "off", focus: [] }) {
  const m = fig.materials, s = m.shared, mode = overlay.mode ?? "off";
  fig.overlay = { mode, focus: [...(overlay.focus ?? [])] };
  const focus = new Set(mode === "focus" ? fig.overlay.focus : []);
  for (let i = 0; i < 256; i++) s.paletteData[i * 4 + 3] = focus.has(i) ? 255 : 0;
  s.palette.value.needsUpdate = true;
  s.focusMix.value = focus.size ? 1 : 0;
  s.dim.value = focus.size && fig.surface === "anatomy" ? 1 : 0;
  const all = mode === "all" ? 0.85 : 0;
  for (const k of ["skin", "tan", "clay"]) m[k].userData.uniforms.uMapMix.value = all;
}

export function disposeSurfaces(m) {
  m.shared?.palette.value.dispose();
  for (const k in m) m[k].dispose?.();
}
