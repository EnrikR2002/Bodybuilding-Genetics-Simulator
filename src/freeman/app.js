import { CanvasTexture, SRGBColorSpace } from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { Stage } from "../render/stage.js";
import { installVolumeSkinning } from "../render/skinning.js";
import { loadFreeman, Freeman, DEFAULT } from "./model.js";
import { POSES, POSE_BY_ID } from "./poses.js";
installVolumeSkinning();
const $ = (id) => document.getElementById(id);
const state = { ...DEFAULT };
let figure,
  reference,
  data,
  pose = "anatomy",
  surface = "skin",
  tone = 1,
  tab = "genetics",
  azimuth = 0,
  focused = false,
  activeTrait = "bicepInsertion";
const stage = new Stage($("cv"), {
  quality: innerWidth < 700 ? 0 : 1,
  orthographic: true,
});
function backdrop() {
  const c = document.createElement("canvas");
  c.width = 4;
  c.height = 256;
  const x = c.getContext("2d"),
    g = x.createLinearGradient(0, 0, 0, 256);
  g.addColorStop(0, "#253037");
  g.addColorStop(0.48, "#202a30");
  g.addColorStop(1, "#151e24");
  x.fillStyle = g;
  x.fillRect(0, 0, 4, 256);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}
stage.scene.background = backdrop();
stage.renderer.toneMappingExposure = 0.96;
stage.lights.key.color.set(0xf0f6ff);
stage.lights.key.intensity = 2.1;
stage.lights.fill.color.set(0xbed6e4);
stage.lights.fill.intensity = 0.26;
stage.lights.rim.color.set(0xd6e8e1);
stage.lights.rim.intensity = 1.15;
stage.lights.rim2.intensity = 0.45;
stage._rig[0].offset = 0.75;
for (const obj of [...stage.scene.children])
  if (obj.isMesh && obj.material.isMeshBasicMaterial) stage.scene.remove(obj);
Object.assign(stage.key.shadow.camera, { left: -210, right: 210 });
stage.key.shadow.normalBias = 0.35;
const orbit = new OrbitControls(stage.camera, $("cv"));
orbit.enableDamping = true;
orbit.dampingFactor = 0.09;
orbit.minDistance = 105;
orbit.maxDistance = 850;
orbit.maxPolarAngle = Math.PI * 0.65;
orbit.minPolarAngle = Math.PI * 0.25;
orbit.autoRotateSpeed = 0.5;
orbit.minZoom = 0.6;
orbit.maxZoom = 5;
orbit.addEventListener("change", () => {
  azimuth = Math.atan2(
    stage.camera.position.x - orbit.target.x,
    stage.camera.position.z - orbit.target.z,
  );
});
orbit.target.set(0, 90, 0);
new ResizeObserver(() => {
  const r = $("stage").getBoundingClientRect();
  stage.setSize(r.width, r.height);
  if (figure) fit();
}).observe($("stage"));

const TRAITS = [
  [
    "genetics",
    "bicepInsertion",
    "Biceps belly length",
    ["Short", "Medium", "Long"],
    "The visible belly and the tendon interval above the elbow.",
  ],
  [
    "genetics",
    "bicepPeak",
    "Biceps profile",
    ["Flatter", "Balanced", "Peaked"],
    "Peak shape is independent of belly length.",
  ],
  [
    "genetics",
    "latInsertion",
    "Lat sweep",
    ["High", "Medium", "Low"],
    "Where the lower lat contour meets the waist.",
  ],
  [
    "genetics",
    "pecGap",
    "Sternal gap",
    ["Narrow", "Medium", "Wide"],
    "The space between the inner edges of the pecs.",
  ],
  [
    "genetics",
    "abStagger",
    "Abdominal alignment",
    ["Even", "Subtle", "Staggered"],
    "The offset between the two rows of the abdominal wall.",
  ],
  [
    "genetics",
    "calfInsertion",
    "Calf belly length",
    ["Short", "Medium", "Long"],
    "A higher belly leaves a longer Achilles interval.",
  ],
  [
    "genetics",
    "trapHeight",
    "Trap profile",
    ["Low", "Medium", "High"],
    "The upper contour between the neck and shoulders.",
  ],
  [
    "frame",
    "clavicle",
    "Shoulder frame",
    ["Narrow", "Medium", "Wide"],
    "Shoulder spacing changes the upper-body silhouette.",
  ],
  [
    "frame",
    "ribcage",
    "Rib cage",
    ["Shallow", "Medium", "Deep"],
    "The underlying breadth and depth of the torso.",
  ],
  [
    "frame",
    "hipWidth",
    "Pelvis width",
    ["Narrow", "Medium", "Wide"],
    "The lower frame changes the apparent V-taper.",
  ],
  [
    "frame",
    "torsoLength",
    "Torso length",
    ["Short", "Medium", "Long"],
    "Torso proportion relative to the limbs.",
  ],
  [
    "frame",
    "armLength",
    "Arm length",
    ["Short", "Medium", "Long"],
    "The same muscle form on a different arm span.",
  ],
  [
    "frame",
    "legLength",
    "Leg length",
    ["Short", "Medium", "Long"],
    "Leg length relative to the torso.",
  ],
  [
    "condition",
    "mass",
    "Upper-body development",
    ["Lighter", "Athletic", "Fuller"],
    "Changes overall development while retaining sculpted forms.",
  ],
  [
    "condition",
    "legMass",
    "Leg development",
    ["Lighter", "Athletic", "Fuller"],
    "The volume of the thighs and lower legs.",
  ],
  [
    "condition",
    "backThickness",
    "Back development",
    ["Lighter", "Athletic", "Fuller"],
    "Thickness through the upper and middle back.",
  ],
  [
    "condition",
    "bodyFat",
    "Definition",
    ["Lean", "Moderate", "Soft"],
    "Surface coverage and the visibility of muscle separation.",
  ],
];
const COPY = {
  bicepInsertion: [
    "A compact belly leaves more room above the elbow. Flex the arm to see how the shorter outline changes the peak.",
    "The middle preset balances belly length and the visible tendon interval. Compare the extremes to isolate the difference.",
    "A longer belly carries fullness closer to the elbow. The attachment stays on the same skeleton while the surface changes.",
  ],
  calfInsertion: [
    "The calf belly ends higher, exposing a longer Achilles interval. Inspect the back of the lower leg.",
    "The middle calf preset retains the sculpt's original belly length.",
    "A longer calf belly extends fullness farther down the lower leg.",
  ],
};
function controls() {
  $("controls").replaceChildren();
  for (const [group, key, label, choices, note] of TRAITS.filter(
    (t) => t[0] === tab,
  )) {
    const el = document.createElement("section");
    el.className = "control";
    el.innerHTML = `<div class="control-heading"><label id="label-${key}">${label}</label><span>${choices[Math.round(state[key] * 2)]}</span></div><div class="choices" role="group" aria-labelledby="label-${key}"></div><p>${note}</p>`;
    choices.forEach((name, i) => {
      const b = document.createElement("button");
      b.textContent = name;
      b.dataset.key = key;
      b.dataset.value = i / 2;
      b.setAttribute("aria-pressed", Math.abs(state[key] - i / 2) < 0.15);
      b.onclick = () => choose(key, i / 2);
      el.querySelector(".choices").append(b);
    });
    $("controls").append(el);
  }
}
function study() {
  const t = TRAITS.find((t) => t[1] === activeTrait);
  $("study-title").textContent = t[2];
  $("study-category").textContent =
    t[0] === "frame"
      ? "SKELETAL PROPORTIONS"
      : t[0] === "condition"
        ? "PHYSIQUE CONDITION"
        : "MUSCLE ARCHITECTURE";
  $("study-copy").textContent =
    COPY[activeTrait]?.[Math.round(state[activeTrait] * 2)] ?? t[4];
  $("focus").textContent =
    activeTrait === "calfInsertion"
      ? "Inspect calves ↗"
      : activeTrait.includes("bicep")
        ? "Inspect arms ↗"
        : "Inspect detail ↗";
}
function changed() {
  if (!figure) return;
  const previousHeight = figure.height;
  const previousRadius = silhouetteRadius(figure);
  figure.update(state).setSurface(surface, tone);
  $("height").textContent = Math.round(figure.height);
  $("shoulders").textContent = Math.round(
    figure.heads[6].distanceTo(figure.heads[13]),
  );
  if (previousHeight !== figure.height || silhouetteRadius(figure) > previousRadius + 0.5) fit();
  if (reference)
    $("compare-labels").innerHTML =
      "<span>PINNED <small>Saved physique</small></span><span>CURRENT <small>Edited physique</small></span>";
  controls();
  study();
}
function choose(key, value) {
  state[key] = value;
  activeTrait = key;
  changed();
  document
    .querySelector(`[data-key="${key}"][data-value="${value}"]`)
    ?.focus({ preventScroll: true });
  if (focused) fit();
}
function silhouetteRadius(f) {
  const b = f.geometry.boundingBox;
  return Math.hypot(Math.max(Math.abs(b.min.x), Math.abs(b.max.x)),
    Math.max(Math.abs(b.min.z), Math.abs(b.max.z)));
}
function comparisonSpacing() {
  if (focused && activeTrait === "calfInsertion") return 30;
  return Math.max(silhouetteRadius(figure), reference ? silhouetteRadius(reference) : 0) + 7;
}
function fit() {
  if (!figure) return;
  const h = Math.max(figure.height, reference?.height ?? 0),
    aspect = stage.camera.aspect;
  const bounds = figure.geometry.boundingBox;
  const top = Math.max(h, bounds.max.y, reference?.geometry.boundingBox.max.y ?? 0);
  const radius = Math.max(silhouetteRadius(figure), reference ? silhouetteRadius(reference) : 0);
  let width = reference ? (comparisonSpacing() + radius) * 2 + 12 : radius * 2 + 16,
    height = top * 1.12,
    y = top * 0.51;
  if (focused) {
    width = reference ? 240 : 118;
    height = 95;
    y = h * (reference ? 0.7 : 0.81);
    if (activeTrait === "calfInsertion") {
      width = reference ? 100 : 62;
      height = 90;
      y = h * 0.23;
    }
  }
  const extent = Math.max(height, width / aspect) / 2;
  Object.assign(stage.camera, {
    left: -extent * aspect,
    right: extent * aspect,
    top: extent,
    bottom: -extent,
    zoom: 1,
  });
  stage.camera.updateProjectionMatrix();
  const d = 450;
  orbit.target.set(0, y, 0);
  stage.camera.position.set(
    Math.sin(azimuth) * d,
    y + 8,
    Math.cos(azimuth) * d,
  );
  orbit.update();
  // OrbitControls changes orientation after lookAt updates the world matrix.
  // Keep projection/picking valid immediately, even before the next frame.
  stage.camera.updateMatrixWorld(true);
}
function setPose(p) {
  if (!POSE_BY_ID[p]) throw new RangeError(`Unknown pose: ${p}`);
  pose = p;
  figure?.setPose(p);
  reference?.setPose(p);
  $("poseSelect").value = p;
  setView(POSE_BY_ID[p].view);
}
function setView(a) {
  azimuth = (a * Math.PI) / 180;
  document
    .querySelectorAll("[data-view]")
    .forEach((b) => b.classList.toggle("active", +b.dataset.view === a));
  fit();
}
function clearReference() {
  if (!reference) return;
  stage.scene.remove(reference.root);
  reference.dispose();
  reference = null;
  figure.root.position.set(0, 0, 0);
  $("pin").textContent = "Pin current physique";
  $("compare-labels").hidden = true;
  $("model-label").textContent = "01 / Current physique";
}
function pin(snapshot = state) {
  if (!figure) return;
  clearReference();
  reference = new Freeman(data);
  reference.update(snapshot);
  reference.snapshot = { ...snapshot };
  reference.setPose(pose);
  reference.setSurface(surface, tone);
  reference.root.position.x = -73;
  figure.root.position.x = 73;
  stage.scene.add(reference.root);
  $("pin").textContent = "Clear comparison";
  $("compare-labels").hidden = false;
  $("compare-labels").innerHTML =
    "<span>PINNED <small>Saved physique</small></span><span>CURRENT <small>Edited physique</small></span>";
  $("model-label").textContent = "01 + 02 / Same lighting and pose";
  fit();
}
$("pin").onclick = () => {
  reference ? clearReference() : pin();
  fit();
};
$("compare").onclick = () => {
  if (!figure) return;
  const key = activeTrait;
  const trait = TRAITS.find((t) => t[1] === key);
  const inspectionPose = pose === "anatomy" || pose === "flex";
  if (inspectionPose) setPose(key.includes("bicep") ? "flex" : "anatomy");
  pin({ ...state, [key]: 0 });
  state[key] = 1;
  changed();
  focused = false;
  if (inspectionPose) setView(
    ["calfInsertion", "latInsertion", "backThickness", "trapHeight"].includes(
      key,
    )
      ? 180
      : 0,
  );
  const belly = ["bicepInsertion", "calfInsertion"].includes(key);
  $("compare-labels").innerHTML = [0, 2]
    .map(
      (i) =>
        `<span>${trait[3][i].toUpperCase()}${belly ? " BELLY" : ""}<small>${belly ? "Same frame and condition" : trait[2]}</small></span>`,
    )
    .join("");
};
$("focus").onclick = () => {
  focused = true;
  if (activeTrait.includes("bicep") && (pose === "anatomy" || pose === "flex")) setPose("flex");
  if (activeTrait === "calfInsertion") setView(180);
  else if (
    activeTrait === "latInsertion" ||
    activeTrait === "backThickness" ||
    activeTrait === "trapHeight"
  )
    setView(180);
  else setView(reference ? 0 : -15);
  fit();
};
$("fit").onclick = () => {
  focused = false;
  fit();
};
$("spin").onclick = () => {
  orbit.autoRotate = !orbit.autoRotate;
  $("spin").setAttribute("aria-pressed", orbit.autoRotate);
};
$("reset").onclick = () => {
  Object.assign(state, DEFAULT);
  clearReference();
  setPose("anatomy");
  activeTrait = "bicepInsertion";
  tab = "genetics";
  document
    .querySelectorAll("[data-tab]")
    .forEach((b) => b.setAttribute("aria-selected", b.dataset.tab === tab));
  focused = false;
  changed();
  setView(0);
};
$("surfaceMode").onchange = (e) => {
  surface = e.target.value;
  figure?.setSurface(surface, tone);
  reference?.setSurface(surface, tone);
  $("surface-label").textContent =
    surface === "clay" ? "SCULPT STUDY" : "SKIN STUDY";
};
$("skinTone").onchange = (e) => {
  tone = +e.target.value;
  figure?.setSurface(surface, tone);
  reference?.setSurface(surface, tone);
};
document
  .querySelectorAll("[data-view]")
  .forEach((b) => (b.onclick = () => setView(+b.dataset.view)));
for (const p of POSES) $("poseSelect").add(new Option(p.name, p.id));
$("poseSelect").onchange = (e) => {
  focused = false;
  setPose(e.target.value);
};
document.querySelectorAll("[data-tab]").forEach(
  (b) =>
    (b.onclick = () => {
      tab = b.dataset.tab;
      activeTrait = TRAITS.find((t) => t[0] === tab)[1];
      document
        .querySelectorAll("[data-tab]")
        .forEach((x) => x.setAttribute("aria-selected", x === b));
      controls();
      study();
    }),
);
controls();
try {
  data = await loadFreeman();
  figure = new Freeman(data);
  figure.setSurface(surface, tone);
  stage.scene.add(figure.root);
  changed();
  fit();
  await stage.envReady;
  $("loading").remove();
  window.__app = {
    figure,
    stage,
    set: (o) => {
      Object.assign(state, DEFAULT, o);
      changed();
    },
    pose: setPose,
    view: (a, e, z, target) => {
      setView(a);
      if (z) {
        stage.camera.zoom = 1 / z;
        stage.camera.updateProjectionMatrix();
      }
      if (target) orbit.target.fromArray(target);
    },
    surface: (m) => {
      $("surfaceMode").value = m;
      $("surfaceMode").dispatchEvent(new Event("change"));
    },
    pin: () => {
      reference ? clearReference() : pin();
      fit();
    },
    comparison: () => reference,
    choose,
    info: () => ({
      height: figure.height,
      vertices: data.meta.vertices,
      triangles: data.meta.triangles,
      source: data.meta.source,
    }),
    state: () => ({ ...state }),
  };
  window.__ready = true;
} catch (e) {
  $("loading").innerHTML =
    "<strong>The sculpt could not be loaded</strong><p>Reload to try again. " +
    e.message +
    "</p>";
  console.error(e);
}
function tick() {
  requestAnimationFrame(tick);
  orbit.update();
  const delta = stage.camera.position.clone().sub(orbit.target),
    a = Math.atan2(delta.x, delta.z);
  if (reference) {
    const spacing = comparisonSpacing();
    reference.root.position.set(
      -spacing * Math.cos(a),
      0,
      spacing * Math.sin(a),
    );
    figure.root.position.set(spacing * Math.cos(a), 0, -spacing * Math.sin(a));
  }
  stage.lookFrom(a);
  stage.render();
}
tick();
