/* ---------------------------------------------------------------------------
   Surface materials.

   `SURFACES` lists the finishes the UI offers. Every figure owns its own
   material instances, so a pinned comparison never shares state with the
   current figure. All finishes keep the posing-brief mask, which is painted
   in sculpt space from the `aRest` attribute (the unposed artist surface).

   Overlay contract (anatomy map): when the sculpt has projected anatomy the
   geometry carries `aMuscle` (primary structure id, float), `aMuscle2`
   (secondary id), `aBlend` (weight of the primary, 0..1) and `aAlong`
   (0 at the muscle's origin → 1 at its insertion). `setOverlay(fig, {mode,
   focus})` shows the map: mode "off" | "all" | "focus"; focus is a list of
   structure ids to highlight.
   --------------------------------------------------------------------------- */
import { MeshPhysicalMaterial } from "three";

export const SURFACES = [
  { id: "skin", label: "Skin" },
  { id: "clay", label: "Sculpt clay" },
];

export const TONES = [
  { id: 0, label: "Light", color: 0xd3ae97 },
  { id: 1, label: "Warm", color: 0xb88f79 },
  { id: 2, label: "Bronze", color: 0x986b4d },
  { id: 3, label: "Deep", color: 0x6e4838 },
];

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
      .replace("#include <common>", "#include <common>\nattribute vec3 aRest;varying vec3 vRest;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvRest=aRest;");
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

/* One set of materials per figure. */
export function createSurfaces() {
  return { skin: skinMaterial(false), clay: skinMaterial(true) };
}

export function applySurface(fig, mode, tone = 1) {
  const m = fig.materials;
  fig.surface = mode;
  fig.mesh.material = mode === "clay" ? m.clay : m.skin;
  m.skin.color.set(TONES[tone]?.color ?? TONES[1].color);
  for (const e of fig.extras) e.material = mode === "clay" ? m.clay : e.userData.material;
}

/* Anatomy overlay. A no-op until the overlay shader lands. */
export function setOverlay(fig, overlay = { mode: "off", focus: [] }) {
  fig.overlay = overlay;
}

export function disposeSurfaces(m) {
  for (const k in m) m[k].dispose?.();
}
