/* ---------------------------------------------------------------------------
   Physique Studio: the interface around the figure.

   One current figure, and optionally a pinned one (A) shown beside it or
   ghosted over it. Every edit is coalesced to one shape update per frame;
   measurements and callouts follow a moment later. The whole setup lives in
   the URL hash, so any physique can be shared as a link.
   --------------------------------------------------------------------------- */
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { Stage, LIGHTING } from "../render/stage.js";
import { installVolumeSkinning } from "../render/skinning.js";
import { loadFreeman, Freeman } from "./model.js";
import { POSES, POSE_BY_ID } from "./poses.js";
import { TRAITS, TRAIT_BY_KEY, GROUPS, DEFAULT, GIVEN, PRESETS, presetState, bodyFatPercent } from "./traits.js";
import { SURFACES, TONES } from "./materials.js";
import { idsFor } from "./anatomy.js";
import { measure } from "./measure.js";
import { renderMetrics, formatLength } from "./ui/metrics.js";
import { Callouts } from "./ui/callouts.js";
import { buildControls, refreshControls, stopOf } from "./ui/controls.js";
import { encode, decode } from "./ui/share.js";

installVolumeSkinning();
const $ = (id) => document.getElementById(id);
const state = { ...DEFAULT };
const ui = {
  pose: POSE_BY_ID.relaxed ? "relaxed" : POSES[0].id, surface: "skin", tone: 1, lighting: "studio",
  azimuth: 0, active: "bicepInsertion", hover: null, focused: false, mode: "side", labels: true,
  tab: "traits", percentiles: null, compare: null,
};
let figure = null, reference = null, data = null, metrics = null, refMetrics = null;

const stage = new Stage($("cv"), { quality: innerWidth < 700 ? 0 : 1, orthographic: true });
const orbit = new OrbitControls(stage.camera, $("cv"));
Object.assign(orbit, {
  enableDamping: true, dampingFactor: 0.09, minPolarAngle: Math.PI * 0.25, maxPolarAngle: Math.PI * 0.65,
  autoRotateSpeed: 0.6, minZoom: 0.6, maxZoom: 6,
});
orbit.addEventListener("change", () => {
  ui.azimuth = Math.atan2(stage.camera.position.x - orbit.target.x, stage.camera.position.z - orbit.target.z);
});
const callouts = new Callouts($("callouts"), stage);
new ResizeObserver(() => {
  const r = $("stage").getBoundingClientRect();
  stage.setSize(r.width, r.height);
  if (figure) fit();
}).observe($("stage"));

/* ---------- framing ---------------------------------------------------- */
function silhouetteRadius(f) {
  const b = f.geometry.boundingBox;
  return Math.hypot(Math.max(Math.abs(b.min.x), Math.abs(b.max.x)), Math.max(Math.abs(b.min.z), Math.abs(b.max.z)));
}
const spacing = () => (!reference || ui.mode === "overlay" ? 0 : Math.max(silhouetteRadius(figure), silhouetteRadius(reference)) + 7);

function frameRegion(center, height) {
  const aspect = stage.camera.aspect || 1, e = height / 2;
  Object.assign(stage.camera, { left: -e * aspect, right: e * aspect, top: e, bottom: -e, zoom: 1 });
  stage.camera.updateProjectionMatrix();
  orbit.target.fromArray(center);
  stage.camera.position.set(center[0] + Math.sin(ui.azimuth) * 450, center[1] + 8, center[2] + Math.cos(ui.azimuth) * 450);
  orbit.update();
  stage.camera.updateMatrixWorld(true);
}

/* The camera region a trait is inspected in: [centre, height in cm]. */
function focusRegion(key) {
  const t = TRAIT_BY_KEY[key], f = figure, chest = f.joint("chest").y;
  const at = (bone, k) => { const p = f.landmark(bone, k); return [p.x - f.root.position.x, p.y, p.z - f.root.position.z]; };
  switch (t.focus) {
    case "arms": return [at("upperarm.L", 0.55), 46];
    case "calves": { const p = at("shin.L", 0.45); return [[0, p[1], p[2]], 50]; }
    case "legs": { const p = at("thigh.L", 0.65); return [[0, p[1], p[2]], 64]; }
    case "chest": return [[0, chest + 7, 4], 40];
    case "abs": return [[0, chest - 12, 4], 42];
    case "torso": return [[0, chest, 0], 72];
    case "back": return [[0, chest + 2, 0], 72];
    default: return null;
  }
}

function fit() {
  if (!figure) return;
  const aspect = stage.camera.aspect || 1;
  const region = ui.focused ? focusRegion(ui.active) : null;
  if (region) {
    let [c, h] = region;
    // side by side: frame the same region on both figures (they sit at ±spacing)
    if (reference && ui.mode === "side") h = Math.max(h * 1.15, (spacing() * 2 + h) / aspect);
    return frameRegion(c, h);
  }
  const top = Math.max(figure.height, figure.geometry.boundingBox.max.y, reference?.geometry.boundingBox.max.y ?? 0);
  const radius = Math.max(silhouetteRadius(figure), reference ? silhouetteRadius(reference) : 0);
  const width = reference && ui.mode === "side" ? (spacing() + radius) * 2 + 12 : radius * 2 + 16;
  // a tall, narrow (phone) canvas: leave room under the look controls for the head
  const tall = aspect < 0.8;
  const h = Math.max(top * (tall ? 1.3 : 1.1), width / aspect);
  frameRegion([0, top * (tall ? 0.57 : 0.5), 0], h);
}

function setView(deg, refit = true) {
  ui.azimuth = (deg * Math.PI) / 180;
  document.querySelectorAll("#views [data-view]").forEach((b) => b.setAttribute("aria-pressed", +b.dataset.view === deg));
  if (refit) fit();
  scheduleHash();
}

/* ---------- figure updates -------------------------------------------- */
let updateQueued = false;
function scheduleUpdate() {
  if (updateQueued) return;
  updateQueued = true;
  requestAnimationFrame(() => { updateQueued = false; applyState(); });
}
function applyState() {
  if (!figure) return;
  const before = [figure.height, silhouetteRadius(figure)];
  figure.update(state);
  if (figure.height !== before[0] || silhouetteRadius(figure) > before[1] + 0.5) fit();
  refreshControls($("traits-panel"), state, ui.percentiles, ui.active);
  study();
  scheduleMetrics();
  scheduleHash();
}

let metricsTimer = 0;
function scheduleMetrics(delay = 120) {
  clearTimeout(metricsTimer);
  metricsTimer = setTimeout(computeMetrics, delay);
}
function computeMetrics() {
  if (!figure) return;
  metrics = measure(figure);
  refMetrics = reference ? (reference.metrics ??= measure(reference)) : null;
  if (ui.tab === "numbers") renderMetrics($("metrics"), metrics, state);
  const both = reference && ui.mode === "side";
  callouts.update(both ? [figure, reference] : [figure], ui.active, both ? [metrics, refMetrics] : [metrics]);
  study();
}

/* ---------- highlight -------------------------------------------------- */
function applyHighlight() {
  const key = ui.hover ?? (ui.surface === "anatomy" ? ui.active : null);
  const focus = key ? idsFor(data?.anatomy, TRAIT_BY_KEY[key].muscles) : [];
  for (const f of [figure, reference]) f?.setOverlay({ mode: focus.length ? "focus" : "off", focus });
}

/* ---------- study card ------------------------------------------------- */
function valueSentence(t) {
  const v = state[t.key], ins = metrics?.insertion ?? {}, now = `Now: ${stopOf(t, v).toLowerCase()}.`;
  const m = metrics;
  switch (t.key) {
    case "bicepInsertion": return ins.bicepsGap !== undefined ? `${now} The belly ends ${formatLength(ins.bicepsGap)} above the elbow.` : now;
    case "tricepsLength": return ins.tricepsReach !== undefined ? `${now} The long head reaches ${ins.tricepsReach.toFixed(0)} % of the humerus.` : now;
    case "calfInsertion": return ins.calfBelly !== undefined ? `${now} Belly ${ins.calfBelly.toFixed(0)} % of the shin, Achilles ${formatLength(ins.achilles)}.` : now;
    case "latInsertion": return ins.latReach !== undefined ? `${now} The sweep ends ${formatLength(ins.latReach)} above the waist.` : now;
    case "pecGap": return ins.sternalGap !== undefined ? `${now} Sternal gap ${formatLength(ins.sternalGap)}.` : now;
    case "trapHeight": return ins.trapRise !== undefined ? `${now} The upper traps rise ${formatLength(ins.trapRise)} over the shoulder.` : now;
    case "clavicle": return m ? `${now} Shoulder width ${formatLength(m.shoulders)}.` : now;
    case "waist": return m ? `${now} Waist ${formatLength(m.waist)}.` : now;
    case "bodyFat": return `About ${bodyFatPercent(v).toFixed(0)} % body fat.`;
    case "mass": return m ? `${now} Relaxed arm ${formatLength(m.arm)}, FFMI ${m.ffmi.toFixed(1)}.` : now;
    default: return now;
  }
}
function study() {
  const t = TRAIT_BY_KEY[ui.active], g = GROUPS.find((x) => x.id === t.group);
  $("study-category").textContent = `${g.label} · ${g.given ? "Given" : "Earned"}`.toUpperCase();
  $("study-title").textContent = t.label;
  $("study-copy").textContent = `${t.note} ${valueSentence(t)}`;
  $("compare").textContent = `Compare ${t.stops[0].toLowerCase()} vs ${t.stops[2].toLowerCase()}`;
  $("focus").hidden = t.focus === "full";
}

/* ---------- comparison ------------------------------------------------- */
function compareLabels() {
  const box = $("compare-labels");
  if (!reference) {
    box.hidden = true;
    $("model-label").textContent = "Current physique";
    return;
  }
  let a, b;
  if (ui.compare) {
    const t = TRAIT_BY_KEY[ui.compare];
    a = [`A · ${t.stops[0]}`, t.label];
    b = [`B · ${t.stops[2]}`, t.label];
  } else {
    const diff = TRAITS.filter((t) => Math.abs(state[t.key] - reference.snapshot[t.key]) > 0.01);
    a = ["A · Pinned", `${diff.length} trait${diff.length === 1 ? "" : "s"} differ`];
    b = ["B · Current", diff.slice(0, 2).map((t) => t.label).join(", ") || "identical"];
  }
  box.hidden = false;
  box.className = ui.mode;
  box.innerHTML = `<span class="chip a">${a[0]}<small>${a[1]}</small></span><span class="chip b">${b[0]}<small>${b[1]}</small></span>`;
  $("model-label").textContent = ui.mode === "overlay" ? "A ghosted over B" : "Same light, pose and scale";
}

function pin(snapshot = { ...state }, compareKey = null) {
  if (!figure) return;
  clearReference(false);
  reference = new Freeman(data);
  reference.pose = ui.pose;
  reference.update(snapshot);
  reference.snapshot = { ...snapshot };
  reference.setSurface(ui.mode === "overlay" ? "ghost" : ui.surface, ui.tone);
  stage.scene.add(reference.root);
  ui.compare = compareKey;
  $("pin").textContent = "Clear comparison";
  compareLabels();
  applyHighlight();
  fit();
  scheduleMetrics(0);
}
function clearReference(refit = true) {
  if (!reference) return;
  stage.scene.remove(reference.root);
  reference.dispose();
  reference = refMetrics = null;
  ui.compare = null;
  figure.root.position.set(0, 0, 0);
  $("pin").textContent = "Pin as A";
  compareLabels();
  if (refit) fit();
  scheduleMetrics(0);
}
function compareExtremes(key = ui.active) {
  const t = TRAIT_BY_KEY[key];
  ui.active = key;
  if (POSE_BY_ID[t.pose]) setPose(t.pose, false);
  state[key] = 1;
  pin({ ...state, [key]: 0 }, key);
  applyState();
  ui.focused = t.focus !== "full";
  setView(t.view ?? 0);
}
function setMode(mode) {
  ui.mode = mode;
  document.querySelectorAll("#compare-mode [data-mode]").forEach((b) => b.setAttribute("aria-pressed", b.dataset.mode === mode));
  reference?.setSurface(mode === "overlay" ? "ghost" : ui.surface, ui.tone);
  compareLabels();
  fit();
  scheduleMetrics(0);
}

/* ---------- pose and look ---------------------------------------------- */
function setPose(id, withView = true) {
  if (!POSE_BY_ID[id]) return;
  ui.pose = id;
  figure?.setPose(id);
  reference?.setPose(id);
  document.querySelectorAll("#poses [data-pose]").forEach((b) => b.setAttribute("aria-pressed", b.dataset.pose === id));
  if (withView) setView(POSE_BY_ID[id].view ?? 0);
  else fit();
  scheduleMetrics();
  scheduleHash();
}
function lookLabel() {
  const l = LIGHTING.find((x) => x.id === ui.lighting)?.label ?? "", s = SURFACES.find((x) => x.id === ui.surface)?.label ?? "";
  $("look-label").textContent = `${l} · ${s}`.toUpperCase();
}
function setLighting(id) {
  ui.lighting = id;
  stage.setLighting(id);
  document.querySelectorAll("#lighting [data-id]").forEach((b) => b.setAttribute("aria-pressed", b.dataset.id === id));
  lookLabel();
  scheduleHash();
}
function setSurface(id) {
  ui.surface = id;
  figure?.setSurface(id, ui.tone);
  reference?.setSurface(ui.mode === "overlay" ? "ghost" : id, ui.tone);
  document.querySelectorAll("#surface [data-id]").forEach((b) => b.setAttribute("aria-pressed", b.dataset.id === id));
  applyHighlight();
  lookLabel();
  scheduleHash();
}
function setTone(i) {
  ui.tone = i;
  figure?.setSurface(ui.surface, i);
  reference?.setSurface(ui.mode === "overlay" ? "ghost" : ui.surface, i);
  document.querySelectorAll("#tone [data-id]").forEach((b) => b.setAttribute("aria-pressed", +b.dataset.id === i));
  scheduleHash();
}
function setLabels(on) {
  ui.labels = on;
  callouts.visible = on;
  $("labels").setAttribute("aria-pressed", on);
}
function setTab(tab) {
  ui.tab = tab;
  document.querySelectorAll("[data-tab]").forEach((b) => b.setAttribute("aria-selected", b.dataset.tab === tab));
  $("traits-panel").hidden = tab !== "traits";
  $("numbers-panel").hidden = tab !== "numbers";
  if (tab === "numbers" && metrics) renderMetrics($("metrics"), metrics, state);
}

/* ---------- presets, genetics lottery, sharing ------------------------- */
function applyPreset(id) {
  Object.assign(state, presetState(id));
  ui.percentiles = null;
  $("preset").value = id;
  applyState();
}
function gaussian() {
  let u = 0, v = 0;
  while (!u) u = Math.random();
  while (!v) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
function phi(z) { // standard normal CDF (Abramowitz–Stegun 7.1.26)
  const t = 1 / (1 + 0.3275911 * Math.abs(z) / Math.SQRT2);
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-(z * z) / 2);
  return 0.5 * (1 + Math.sign(z) * y);
}
function roll() {
  ui.percentiles = {};
  for (const t of TRAITS)
    if (GIVEN.has(t.key)) {
      const z = Math.max(-2.6, Math.min(2.6, gaussian()));
      state[t.key] = Math.round((0.5 + z * 0.18) * 100) / 100;
      ui.percentiles[t.key] = phi(z) * 100;
    }
  $("preset").value = "";
  applyState();
  const ranked = Object.entries(ui.percentiles).sort((a, b) => b[1] - a[1]);
  toast(`New draw. Most extreme: ${TRAIT_BY_KEY[ranked[0][0]].label} (${Math.round(ranked[0][1])}th pct).`);
}
let hashTimer = 0;
function scheduleHash() {
  clearTimeout(hashTimer);
  hashTimer = setTimeout(() => history.replaceState(null, "", `#${encode(state, ui)}`), 400);
}
function restoreHash() {
  const o = decode(location.hash.slice(1));
  if (!o) return;
  Object.assign(state, DEFAULT, o.s);
  if (POSE_BY_ID[o.p]) ui.pose = o.p;
  if (Number.isFinite(o.v)) ui.azimuth = (o.v * Math.PI) / 180;
  if (LIGHTING.some((l) => l.id === o.l)) ui.lighting = o.l;
  if (SURFACES.some((s) => s.id === o.f && s.menu !== false)) ui.surface = o.f;
  if (TONES[o.t]) ui.tone = o.t;
}
async function copyLink() {
  history.replaceState(null, "", `#${encode(state, ui)}`);
  try {
    await navigator.clipboard.writeText(location.href);
    toast("Link copied: it opens this exact physique, pose and look.");
  } catch {
    toast("Copy the address bar to share this physique.");
  }
}
function exportPng() {
  stage.render();
  const a = document.createElement("a");
  a.href = stage.renderer.domElement.toDataURL("image/png");
  a.download = `insertion-${ui.pose}.png`;
  a.click();
  toast("PNG saved.");
}
let toastTimer = 0;
function toast(text) {
  const t = $("toast");
  t.textContent = text;
  t.classList.add("on");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("on"), 3200);
}
function reset() {
  Object.assign(state, DEFAULT);
  ui.percentiles = null;
  ui.focused = false;
  clearReference(false);
  $("preset").value = "sculpt";
  setPose(POSE_BY_ID.relaxed ? "relaxed" : POSES[0].id, false);
  setView(0, false);
  applyState();
  fit();
}

/* ---------- building the interface ------------------------------------- */
function segmented(root, items, onPick) {
  root.replaceChildren(...items.map((it) => {
    const b = document.createElement("button");
    b.type = "button";
    b.dataset.id = it.id;
    b.textContent = it.label;
    if (it.title) b.title = it.title;
    b.onclick = () => onPick(it.id);
    return b;
  }));
}
function buildInterface() {
  $("preset").replaceChildren(...PRESETS.map((p) => new Option(p.name, p.id)), new Option("Custom", ""));
  $("preset").value = "sculpt";
  $("preset").title = PRESETS[0].blurb;
  $("preset").onchange = (e) => { if (e.target.value) applyPreset(e.target.value); };
  segmented($("lighting"), LIGHTING.map((l) => ({ id: l.id, label: l.label, title: l.note })), setLighting);
  segmented($("surface"), SURFACES.filter((s) => s.menu !== false), setSurface);
  $("tone").replaceChildren(...TONES.map((t) => {
    const b = document.createElement("button");
    b.type = "button";
    b.dataset.id = t.id;
    b.title = `${t.label} skin tone`;
    b.setAttribute("aria-label", `${t.label} skin tone`);
    b.style.setProperty("--tone", `#${t.color.toString(16).padStart(6, "0")}`);
    b.onclick = () => setTone(t.id);
    return b;
  }));
  $("poses").replaceChildren(...POSES.map((p) => {
    const b = document.createElement("button");
    b.type = "button";
    b.dataset.pose = p.id;
    b.textContent = p.name;
    if (p.note) b.title = p.note;
    b.onclick = () => { ui.focused = false; setPose(p.id); };
    return b;
  }));
  buildControls($("traits-panel"), {
    state,
    onInput: (key, v) => {
      state[key] = v;
      ui.active = key;
      if (ui.percentiles) delete ui.percentiles[key];
      $("preset").value = "";
      scheduleUpdate();
    },
    onCommit: () => scheduleMetrics(0),
    onActivate: (key) => {
      if (ui.active === key) return;
      ui.active = key;
      refreshControls($("traits-panel"), state, ui.percentiles, ui.active);
      study();
      applyHighlight();
      scheduleMetrics(0);
    },
    onHover: (key) => { ui.hover = key; applyHighlight(); },
    onCompare: (key) => compareExtremes(key),
  });
  document.querySelectorAll("#views [data-view]").forEach((b) => (b.onclick = () => setView(+b.dataset.view)));
  document.querySelectorAll("#compare-mode [data-mode]").forEach((b) => (b.onclick = () => setMode(b.dataset.mode)));
  document.querySelectorAll("[data-tab]").forEach((b) => (b.onclick = () => setTab(b.dataset.tab)));
  $("compare").onclick = () => compareExtremes(ui.active);
  $("pin").onclick = () => (reference ? clearReference() : pin());
  $("focus").onclick = () => { ui.focused = true; const t = TRAIT_BY_KEY[ui.active]; if (POSE_BY_ID[t.pose]) setPose(t.pose, false); setView(t.view ?? 0); };
  $("fit").onclick = () => { ui.focused = false; fit(); };
  $("spin").onclick = () => { orbit.autoRotate = !orbit.autoRotate; $("spin").setAttribute("aria-pressed", orbit.autoRotate); };
  $("labels").onclick = () => setLabels(!ui.labels);
  $("roll").onclick = roll;
  $("share").onclick = copyLink;
  $("png").onclick = exportPng;
  $("reset").onclick = reset;
  $("help").onclick = () => ($("help-panel").hidden = false);
  $("help-close").onclick = () => ($("help-panel").hidden = true);
  $("help-panel").onclick = (e) => { if (e.target === $("help-panel")) $("help-panel").hidden = true; };
  addEventListener("keydown", (e) => {
    if (e.target.matches?.("input, select, textarea") || e.metaKey || e.ctrlKey || e.altKey) return;
    const views = { 1: 0, 2: -35, 3: -90, 4: 180 };
    if (views[e.key] !== undefined) setView(views[e.key]);
    else if (e.key === "c") compareExtremes(ui.active);
    else if (e.key === "p") reference ? clearReference() : pin();
    else if (e.key === "o") setMode(ui.mode === "side" ? "overlay" : "side");
    else if (e.key === "t") $("spin").click();
    else if (e.key === "l") setLabels(!ui.labels);
    else if (e.key === "r") reset();
    else if (e.key === "?") $("help-panel").hidden = !$("help-panel").hidden;
    else if (e.key === "Escape") $("help-panel").hidden = true;
  });
}

/* ---------- start ------------------------------------------------------ */
buildInterface();
restoreHash();
refreshControls($("traits-panel"), state, null, ui.active);
study();
try {
  data = await loadFreeman();
  figure = new Freeman(data);
  figure.pose = ui.pose;
  figure.update(state);
  stage.scene.add(figure.root);
  setLighting(ui.lighting);
  setSurface(ui.surface);
  setTone(ui.tone);
  setPose(ui.pose, false);
  setView(Math.round((ui.azimuth * 180) / Math.PI));
  setLabels(true);
  computeMetrics();
  await stage.envReady;
  $("loading").remove();
  window.__app = {
    get figure() { return figure; },
    stage,
    set: (o) => { Object.assign(state, DEFAULT, o); ui.percentiles = null; applyState(); },
    pose: (id) => setPose(id),
    view: (a, e, z, target) => {
      setView(a, false);
      if (target) frameRegion(target, 180 * (z || 1));
      else { fit(); if (z) { stage.camera.zoom = 1 / z; stage.camera.updateProjectionMatrix(); } }
    },
    surface: (m) => setSurface(m),
    lighting: (id) => setLighting(id),
    overlay: (key) => { ui.hover = key; applyHighlight(); },
    callouts: (v) => setLabels(!!v),
    pin: () => (reference ? clearReference() : pin()),
    comparison: () => reference,
    compare: (key) => compareExtremes(key),
    compareMode: (m) => setMode(m),
    preset: (id) => applyPreset(id),
    roll: () => roll(),
    tab: (t) => setTab(t),
    choose: (key, value) => { state[key] = value; ui.active = key; applyState(); },
    metrics: () => (figure ? measure(figure) : null),
    hash: () => encode(state, ui),
    info: () => ({ height: figure.height, vertices: data.meta.vertices, triangles: data.meta.triangles, source: data.meta.source }),
    state: () => ({ ...state }),
  };
  window.__ready = true;
} catch (e) {
  $("loading").innerHTML = `<strong>The sculpt could not be loaded</strong><p>Reload to try again. ${e.message}</p>`;
  console.error(e);
}
function tick() {
  requestAnimationFrame(tick);
  orbit.update();
  const a = Math.atan2(stage.camera.position.x - orbit.target.x, stage.camera.position.z - orbit.target.z);
  if (reference) {
    const s = spacing();
    reference.root.position.set(-s * Math.cos(a), 0, s * Math.sin(a));
    figure.root.position.set(s * Math.cos(a), 0, -s * Math.sin(a));
  }
  stage.lookFrom(a);
  stage.render();
  callouts.frame();
}
tick();
