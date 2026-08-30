/* ---------------------------------------------------------------------------
   Insertion — a physique genetics plate.

   The figure is a sculpted anatomical mesh (CC0 MakeHuman base body), not
   geometry generated from formulas. The sliders re-shape it three ways:
     * sculpted morph targets for size, frame and body composition
     * a muscle map derived from the rig, for where each belly sits on its bone
     * a skeleton rebuilt from the mesh itself, so bones and skin cannot drift
   Everything then goes through one round of Catmull-Clark subdivision on its
   way to the screen.
   --------------------------------------------------------------------------- */
import { Vector3, Quaternion, BufferAttribute, MeshBasicMaterial, Color } from 'three';
import { loadFigure } from './body/figure.js';
import { loadBundle } from './body/binary.js';
import { Stage } from './render/stage.js';
import { createSkin, createGhost, SKIN_TONES } from './render/skin.js';
import { PoseRig } from './pose/ik.js';
import { Tape } from './body/measure.js';
import { POSES } from './data/poses.js';
import { SLIDERS, DEFAULT, PRESETS, judge } from './data/sliders.js';
import { CALLOUTS, placeAnchors } from './ui/callouts.js';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const inch = cm => `${(cm / 2.54).toFixed(1)}"`;

const stageEl = document.getElementById('stage');
const canvas = document.getElementById('cv');
const loadingEl = document.getElementById('loading');
const loadingBar = document.getElementById('loadingBar');
const loadingText = document.getElementById('loadingText');

/* ======================================================================== *
   state
 * ======================================================================== */
const S = { ...DEFAULT };
let geo = { latFlare: 0.05, chestUp: 0.10, vacuum: 0, flex: 0.25 };
let geoTarget = { ...geo };
let geoBuilt = { latFlare: -9, chestUp: -9, vacuum: -9, flex: -9 };
let currentPose = POSES[0];
let showCallouts = false, spin = false, pinned = null;
let shapeDirty = true, poseDirty = true;
let measurements = null;
let tone = 1;
let debugMat = null;

const QUALITY = Math.min(innerWidth, innerHeight) < 760 ? 0 : 1;
const stage = new Stage(canvas, { hdri: '/env/studio.hdr', quality: QUALITY });

/* ======================================================================== *
   load
 * ======================================================================== */
loadingText.textContent = 'Loading anatomical mesh';
const [figure, regionBundle] = await Promise.all([
  loadFigure('/models/body.bin', p => { loadingBar.style.width = `${p * 84}%`; }),
  loadBundle('/models/regions.bin'),
]);
loadingText.textContent = 'Deriving muscle map';
loadingBar.style.width = '90%';

figure.attachRegions(regionBundle);
const skin = createSkin({ tone, oil: 0.48 });
figure.mesh.material = skin;
figure.bindSkeleton();
stage.scene.add(figure.root);

const rig = new PoseRig(figure.skeleton);
const tape = new Tape(figure);
const anchors = {};


/* ======================================================================== *
   shape
 * ======================================================================== */
function params() { return { ...S, ...geo }; }

let measureKey = '';
const _head = new Vector3(), _headTail = new Vector3();
function applyShape(remeasure = true) {
  figure.update(params());
  rig.refresh();
  /* the shader places the hairline relative to the skull, so it needs to know
     where the skull ended up */
  figure.skeleton.restHead('head', _head);
  figure.skeleton.restTail('head', _headTail);
  _head.lerp(_headTail, 0.52);
  skin.userData.setHead?.(_head);
  skin.userData.setVein?.(figure.lastCtx?.vein ?? 0);
  skin.userData.setStriate?.(figure.lastCtx?.striate ?? 0);
  /* The tape measure only depends on the sliders, not on the pose, so it does
     not need redoing on every frame of a pose transition. */
  const key = SLIDERS.map(sp => S[sp.k].toFixed(3)).join(',');
  if (remeasure && key !== measureKey) { measureKey = key; measureDue = true; }
  placeAnchors(anchors, figure, rig, measurements);
}

/* The tape measure costs about as much again as the mesh rebuild, and nobody
   reads a number while they are still dragging the slider under it. Running it
   a few times a second instead of sixty keeps the drag itself smooth. */
let measureDue = true, lastMeasure = -1e9;
function runMeasure(now, force) {
  if (!measureDue || (!force && now - lastMeasure < 140)) return;
  measureDue = false;
  lastMeasure = now;
  const m = figure.measureCage(S);
  measurements = tape.measure(m.cage, m.skeleton);
  placeAnchors(anchors, figure, rig, measurements);
  syncReadout();
}

/* ======================================================================== *
   pose
 * ======================================================================== */
const poseTargets = new Map();     /* bone -> Quaternion */
function applyPose(p, instant) {
  currentPose = p;
  geoTarget = { latFlare: 0, chestUp: 0, vacuum: 0, flex: 0.3, ...(p.geo || {}) };
  if (instant) geo = { ...geoTarget };

  rig.apply(p);
  poseTargets.clear();
  for (const b of figure.skeleton.bones) poseTargets.set(b, b.quaternion.clone());
  if (instant) { /* leave the solved pose in place */ }
  else {
    /* rewind to where we were; the loop slerps toward the solved pose */
    for (const [b, q] of poseTargets) b.quaternion.copy(liveQuat.get(b) || q);
  }
  shapeDirty = true;
}

/* remember what the bones actually look like right now, so a pose change
   eases from the current position rather than snapping */
const liveQuat = new Map();
function rememberLive() {
  for (const b of figure.skeleton.bones) {
    let q = liveQuat.get(b);
    if (!q) { q = new Quaternion(); liveQuat.set(b, q); }
    q.copy(b.quaternion);
  }
}

/* ======================================================================== *
   camera
 * ======================================================================== */
let az = -0.28, el = 0.06, dist = 380;
let azT = az, elT = el, distT = dist;
let userZoom = false;
const camTarget = new Vector3(0, 96, 0);
let lockTarget = false;

function baseDist() {
  const vt = Math.tan(stage.camera.fov * Math.PI / 360);
  return clamp(Math.max((figure.height * 1.18) / (2 * vt),
                        (figure.height * 0.78) / (2 * vt * stage.camera.aspect)), 200, 900);
}

let dragging = false, lastX = 0, lastY = 0, pinchD = 0;
stageEl.addEventListener('pointerdown', e => {
  dragging = true; lastX = e.clientX; lastY = e.clientY;
  setSpin(false);
  stageEl.classList.add('dragging');
  stageEl.setPointerCapture(e.pointerId);
});
stageEl.addEventListener('pointermove', e => {
  if (!dragging) return;
  azT -= (e.clientX - lastX) * 0.0085;
  elT = clamp(elT + (e.clientY - lastY) * 0.0055, -0.45, 0.72);
  lastX = e.clientX; lastY = e.clientY;
});
const endDrag = () => { dragging = false; stageEl.classList.remove('dragging'); };
stageEl.addEventListener('pointerup', endDrag);
stageEl.addEventListener('pointercancel', endDrag);
stageEl.addEventListener('wheel', e => {
  e.preventDefault(); userZoom = true;
  distT = clamp(distT * (1 + Math.sign(e.deltaY) * 0.09), 130, 900);
}, { passive: false });
stageEl.addEventListener('touchstart', e => {
  if (e.touches.length === 2) pinchD = touchDist(e);
}, { passive: true });
stageEl.addEventListener('touchmove', e => {
  if (e.touches.length === 2) {
    e.preventDefault();
    const d = touchDist(e);
    if (pinchD) { userZoom = true; distT = clamp(distT * (pinchD / d), 130, 900); }
    pinchD = d;
  }
}, { passive: false });
function touchDist(e) {
  const a = e.touches[0], b = e.touches[1];
  return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
}

document.querySelectorAll('.viewbtns .btn').forEach(b => {
  b.addEventListener('click', () => {
    let want = parseFloat(b.dataset.az) * Math.PI / 180;
    const rootY = currentPose.joints?.root?.[1] || 0;
    want += rootY;
    const twoPi = Math.PI * 2;
    azT = az + ((((want - az) % twoPi) + twoPi + Math.PI) % twoPi) - Math.PI;
    elT = 0.05;
    setSpin(false);
  });
});

/* ======================================================================== *
   UI
 * ======================================================================== */
function buildSliders() {
  for (const sp of SLIDERS) {
    const wrap = document.createElement('div');
    wrap.className = 'ctrl';
    wrap.innerHTML =
      `<div class="row"><label for="s_${sp.k}">${sp.label}</label><span class="val" id="v_${sp.k}"></span></div>` +
      `<input type="range" id="s_${sp.k}" min="0" max="1" step="0.005" value="${S[sp.k]}">` +
      `<div class="ends"><span>${sp.lo}</span><span>${sp.hi}</span></div>`;
    document.getElementById(sp.g).appendChild(wrap);
    const input = wrap.querySelector('input');
    input.addEventListener('input', () => { S[sp.k] = parseFloat(input.value); shapeDirty = true; });
  }
}

function syncInputs() {
  for (const sp of SLIDERS) {
    const i = document.getElementById('s_' + sp.k);
    if (i && Math.abs(parseFloat(i.value) - S[sp.k]) > 1e-4) i.value = S[sp.k];
  }
}

function syncReadout() {
  const m = measurements;
  if (!m) return;
  for (const sp of SLIDERS) {
    const el = document.getElementById('v_' + sp.k);
    if (el) el.textContent = sp.unit(S[sp.k], m);
  }
  const taper = m.taper;
  document.getElementById('taper').firstChild.textContent = taper.toFixed(2);
  document.getElementById('taperNote').textContent =
    taper > 1.55 ? 'elite v-taper — chest ÷ waist' :
    taper > 1.40 ? 'strong taper — chest ÷ waist' :
    taper > 1.25 ? 'moderate taper — chest ÷ waist' : 'blocky — chest ÷ waist';

  const feet = Math.floor(m.height / 2.54 / 12);
  const inches = Math.round((m.height / 2.54) % 12);
  const rows = [
    ['Height', `${m.height.toFixed(0)} cm / ${feet}'${inches}"`],
    ['Shoulder span', `${m.shoulder.toFixed(0)} cm`],
    ['Chest', `${m.chest.toFixed(0)} cm / ${inch(m.chest)}`],
    ['Waist', `${m.waist.toFixed(0)} cm / ${inch(m.waist)}`],
    ['Upper arm', `${m.arm.toFixed(0)} cm / ${inch(m.arm)}`],
    ['Thigh', `${m.thigh.toFixed(0)} cm / ${inch(m.thigh)}`],
    ['Calf', `${m.calf.toFixed(0)} cm / ${inch(m.calf)}`],
    ['Neck', `${m.neck.toFixed(0)} cm / ${inch(m.neck)}`],
  ];
  document.getElementById('measBody').innerHTML = rows.map(r =>
    `<tr${r[0] === 'Waist' ? ' class="hi"' : ''}><td>${r[0]}</td><td>${r[1]}</td></tr>`).join('');
  document.getElementById('notes').innerHTML = judge(S).map(n =>
    `<div class="note"><h4>${n[0]}</h4>${n[1]}</div>`).join('');
  syncInputs();
}

function buildPoseStrip() {
  const el = document.getElementById('posestrip');
  POSES.forEach((p, i) => {
    const b = document.createElement('button');
    b.className = 'btn' + (i === 0 ? ' on' : '');
    b.textContent = p.name;
    b.title = p.note;
    b.addEventListener('click', () => {
      rememberLive();
      applyPose(p);
      [...el.children].forEach(c => c.classList.remove('on'));
      b.classList.add('on');
    });
    el.appendChild(b);
  });
}

/* ---- toggles ---- */
const btnC = document.getElementById('btnCallouts');
const btnS = document.getElementById('btnSpin');
const btnP = document.getElementById('btnPin');
btnC.addEventListener('click', () => {
  showCallouts = !showCallouts;
  btnC.classList.toggle('on', showCallouts);
  if (!showCallouts) clearOverlay();
});
function setSpin(v) { spin = v; btnS.classList.toggle('on', spin); }
btnS.addEventListener('click', () => setSpin(!spin));

btnP.addEventListener('click', async () => {
  if (pinned) {
    stage.scene.remove(pinned.root);
    pinned = null;
    figure.root.position.x = 0;
    if (!userZoom) distT = baseDist();
    btnP.classList.remove('on');
    btnP.textContent = 'Pin comparison';
    return;
  }
  btnP.disabled = true;
  const ghost = await loadFigure('/models/body.bin');
  ghost.attachRegions(regionBundle);
  ghost.mesh.material = createGhost();
  if (ghost.eyes) ghost.eyes.material = createGhost();
  ghost.bindSkeleton();
  ghost.update(params());
  const gRig = new PoseRig(ghost.skeleton);
  gRig.refresh();
  gRig.apply(currentPose);
  ghost.pinnedRig = gRig;
  ghost.root.position.x = -figure.height * 0.30;
  figure.root.position.x = figure.height * 0.30;
  stage.scene.add(ghost.root);
  pinned = ghost;
  distT = Math.max(distT, baseDist() * 1.42);
  btnP.classList.add('on');
  btnP.textContent = 'Clear comparison';
  btnP.disabled = false;
});

/* ---- presets ---- */
const presetsEl = document.getElementById('presets');
for (const p of PRESETS) {
  const b = document.createElement('button');
  b.className = 'btn';
  b.style.textAlign = 'center';
  b.textContent = p.n;
  b.addEventListener('click', () => { Object.assign(S, p.v); shapeDirty = true; syncInputs(); });
  presetsEl.appendChild(b);
}
document.getElementById('btnDice').addEventListener('click', () => {
  for (const sp of SLIDERS) S[sp.k] = sp.k === 'bodyFat' ? Math.random() * 0.8 : Math.random();
  shapeDirty = true; syncInputs();
});

/* ---- mobile tabs ---- */
const colLeft = document.getElementById('colLeft');
const colRight = document.getElementById('colRight');
function setTab(t) {
  document.querySelectorAll('.tabs button').forEach(b =>
    b.setAttribute('aria-selected', String(b.dataset.tab === t)));
  colLeft.hidden = t !== 'left';
  colRight.hidden = t !== 'right';
}
document.querySelectorAll('.tabs button').forEach(b =>
  b.addEventListener('click', () => setTab(b.dataset.tab)));
function applyLayout() {
  if (matchMedia('(max-width:1080px)').matches) {
    const sel = document.querySelector('.tabs [aria-selected=true]');
    setTab(sel ? sel.dataset.tab : 'stage');
  } else { colLeft.hidden = false; colRight.hidden = false; }
}
matchMedia('(max-width:1080px)').addEventListener('change', applyLayout);

/* ---- ruler ---- */
function buildRuler() {
  const r = document.getElementById('ruler');
  r.innerHTML = '';
  for (let cm = 0; cm <= 200; cm += 10) {
    const d = document.createElement('div');
    d.className = 'tick' + (cm % 50 === 0 ? ' major' : '');
    d.dataset.cm = cm;
    if (cm % 50 === 0) {
      const s = document.createElement('span');
      s.textContent = cm;
      d.appendChild(s);
    }
    r.appendChild(d);
  }
}
const _rv = new Vector3();
function updateRuler() {
  const h = stageEl.clientHeight;
  document.querySelectorAll('#ruler .tick').forEach(t => {
    _rv.set(figure.root.position.x, parseFloat(t.dataset.cm), 0).project(stage.camera);
    const y = (1 - (_rv.y * 0.5 + 0.5)) * h;
    t.style.top = y + 'px';
    t.style.opacity = (y < 4 || y > h - 4) ? 0 : 1;
  });
}

/* ---- leader-line callouts ---- */
const overlay = document.getElementById('overlay');
const calloutEls = {};
function clearOverlay() {
  overlay.innerHTML = '';
  for (const k in calloutEls) { calloutEls[k].remove(); delete calloutEls[k]; }
}
const _cv = new Vector3();
function updateCallouts() {
  if (!showCallouts) return;
  const W = stageEl.clientWidth, H = stageEl.clientHeight;
  const items = [];
  for (const c of CALLOUTS) {
    const a = anchors[c.k];
    if (!a) continue;
    a.getWorldPosition(_cv);
    _cv.project(stage.camera);
    if (_cv.z >= 1) { if (calloutEls[c.k]) calloutEls[c.k].style.display = 'none'; continue; }
    items.push({ c, x: (_cv.x * 0.5 + 0.5) * W, y: (1 - (_cv.y * 0.5 + 0.5)) * H });
  }
  const cols = { left: [], right: [] };
  for (const it of items) (it.x < W * 0.5 ? cols.left : cols.right).push(it);
  const pad = W < 520 ? 8 : 14;
  let lines = '';
  for (const side of ['left', 'right']) {
    const list = cols[side].sort((a, b) => a.y - b.y);
    const lx = side === 'left' ? pad : W - pad;
    let prev = -1e9;
    for (const it of list) {
      let ly = clamp(it.y, 16, H - 16);
      if (ly - prev < 24) ly = prev + 24;
      prev = ly;
      let el = calloutEls[it.c.k];
      if (!el) { el = document.createElement('div'); el.className = 'callout'; stageEl.appendChild(el); calloutEls[it.c.k] = el; }
      el.innerHTML = `${it.c.label} <b>${it.c.get(S, measurements)}</b>`;
      el.style.display = 'block';
      el.className = 'callout ' + (side === 'left' ? 'l' : 'r');
      el.style.left = lx + 'px';
      el.style.top = ly + 'px';
      const ex = side === 'left' ? lx + el.offsetWidth + 4 : lx - el.offsetWidth - 4;
      lines += `<path d="M ${ex} ${ly} L ${(ex + it.x) / 2} ${it.y} L ${it.x} ${it.y}" fill="none" stroke="rgba(232,226,212,.6)" stroke-width="1.1"/>` +
               `<circle cx="${it.x}" cy="${it.y}" r="2.6" fill="none" stroke="#e0a4ae" stroke-width="1.3"/>`;
    }
  }
  overlay.innerHTML = lines;
}

/* ======================================================================== *
   loop
 * ======================================================================== */
function resize() {
  const w = stageEl.clientWidth, h = stageEl.clientHeight;
  if (!w || !h) return;
  stage.setSize(w, h);
  if (!userZoom) distT = baseDist();
}
new ResizeObserver(resize).observe(stageEl);

let last = performance.now();
function tick(now) {
  requestAnimationFrame(tick);
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  const k = 1 - Math.pow(0.0012, dt);   /* frame-rate independent easing */

  /* pose easing */
  let posing = false;
  for (const [b, q] of poseTargets) {
    if (b.quaternion.angleTo(q) > 0.0009) { b.quaternion.slerp(q, k); posing = true; }
    else b.quaternion.copy(q);
  }
  /* Pose-driven shape changes ease over about a second. Rebuilding the whole
     mesh on every one of those frames costs more than it shows, so it is
     rebuilt only once the shape has drifted far enough to be visible. */
  for (const key in geoTarget) {
    const d = geoTarget[key] - geo[key];
    if (Math.abs(d) > 0.0015) geo[key] += d * k;
    else geo[key] = geoTarget[key];
    if (Math.abs(geo[key] - geoBuilt[key]) > 0.012) shapeDirty = true;
  }

  if (shapeDirty) { applyShape(); geoBuilt = { ...geo }; shapeDirty = false; }
  runMeasure(now, false);
  if (pinned) {
    for (const b of figure.skeleton.bones) {
      const g = pinned.skeleton.byName[b.name];
      if (g) g.quaternion.copy(b.quaternion);
    }
  }

  if (spin) azT -= dt * 0.30;
  az = lerp(az, azT, k); el = lerp(el, elT, k); dist = lerp(dist, distT, k);
  const ry = Math.cos(el) * dist;
  if (!lockTarget) {
    camTarget.y = lerp(camTarget.y, figure.height * 0.53, k);
    camTarget.x = lerp(camTarget.x, figure.root.position.x, k);
  }
  stage.camera.position.set(camTarget.x + Math.sin(az) * ry,
                            camTarget.y + Math.sin(el) * dist,
                            camTarget.z + Math.cos(az) * ry);
  stage.camera.lookAt(camTarget);

  stage.render();
  updateRuler();
  updateCallouts();
}

buildSliders();
buildPoseStrip();
buildRuler();
applyLayout();
resize();

applyShape();
runMeasure(performance.now(), true);
applyPose(POSES[0], true);
rememberLive();
syncReadout();
requestAnimationFrame(tick);

loadingText.textContent = 'Prefiltering environment';
loadingBar.style.width = '96%';
await stage.envReady;
loadingBar.style.width = '100%';
loadingEl.classList.add('done');
setTimeout(() => loadingEl.remove(), 700);

/* handles for the screenshot harness */
window.__app = {
  set(o) { Object.assign(S, DEFAULT, o); shapeDirty = true; syncInputs(); },
  pose(id, over) {
    const p = POSES.find(x => x.id === id);
    if (!p) return;
    rememberLive();
    applyPose(over ? { ...p, ...over, arm: { ...(p.arm || {}), ...(over.arm || {}) } } : p, true);
    const strip = document.getElementById('posestrip');
    [...strip.children].forEach((c, i) => c.classList.toggle('on', POSES[i] === p));
  },
  view(a, e, z, t) {
    /* "front" means the figure's front, so a pose that turns the body turns
       the camera with it — the same rule the view buttons follow */
    azT = az = a * Math.PI / 180 + (currentPose.joints?.root?.[1] || 0);
    elT = el = e ?? 0.05;
    if (z) { userZoom = true; distT = dist = baseDist() * z; }
    if (t) { camTarget.set(t[0], t[1], t[2]); this._lockTarget = true; }
    else this._lockTarget = false;
    lockTarget = this._lockTarget;
  },
  callouts(v) { showCallouts = v; btnC.classList.toggle('on', v); if (!v) clearOverlay(); },
  info: () => { runMeasure(performance.now(), true); return { height: +figure.height.toFixed(1), ...measurements }; },
  /* how long a full shape rebuild takes — the cost of dragging a slider */
  bench(n = 20) {
    const t = {};
    const time = (k, fn) => { const a = performance.now(); fn(); t[k] = (t[k] || 0) + performance.now() - a; };
    for (let i = 0; i < n; i++) {
      S.mass = 0.4 + (i % 10) * 0.06;
      time('shape', () => figure.update(params()));
      time('rig', () => rig.refresh());
      /* the readout runs on its own slower clock, so it is timed separately
         rather than counted against the drag */
      if (i % 8 === 0) {
        time('measureCage', () => { window.__mc = figure.measureCage(S); });
        time('tape', () => tape.measure(window.__mc.cage, window.__mc.skeleton));
        time('readout', () => syncReadout());
      }
    }
    for (const k in t) t[k] = +(t[k] / n).toFixed(2);
    S.mass = DEFAULT.mass; applyShape();
    return { ...t, total: +Object.values(t).reduce((a, b) => a + b, 0).toFixed(2),
             tris: figure.header.nTris };
  },
  pin() { btnP.click(); },
  /* flat bright backdrop, used to tell a hole in the mesh from a very dark
     crevice: a hole goes the colour of the backdrop, a crevice stays dark */
  bg(on) {
    if (on) { this._bg = stage.scene.background; stage.scene.background = new Color(0x33ff66); }
    else if (this._bg) stage.scene.background = this._bg;
  },
  headProbe() {
    const g = figure.geometry.attributes.position.array;
    const part = figure.regions.bundlePartId;
    /* render vertex -> cage vertex, via the subdivision numbering: the first
       nCage entries of a level are the original vertices */
    let lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9];
    for (let r = 0; r < figure.nRender; r++) {
      const sv = figure.renderSub[r];
      if (sv >= figure.nCage || part[sv] !== 6) continue;
      for (let k = 0; k < 3; k++) {
        const v = g[r * 3 + k];
        if (v < lo[k]) lo[k] = v;
        if (v > hi[k]) hi[k] = v;
      }
    }
    return { head: _head.toArray().map(x => +x.toFixed(1)),
             lo: lo.map(x => +x.toFixed(1)), hi: hi.map(x => +x.toFixed(1)) };
  },
  /* Colour the mesh by muscle instead of by skin. This is how the muscle map
     gets checked — you look at it and confirm the biceps region is on the
     biceps, rather than trusting the numbers. */
  debugRegions(on) {
    if (!on) { figure.mesh.material = skin; return; }
    if (!debugMat) {
      const cage = regionBundle.block(regionBundle.header.debugColor);
      const sub = new Float32Array(figure.nSubVerts * 3);
      const L = figure.levels[0];
      sub.set(cage.subarray(0, L.nVerts * 3));
      for (let e = 0; e < L.nE; e++) {
        const a = L.edgeV[e * 2] * 3, b = L.edgeV[e * 2 + 1] * 3, o = (L.nVerts + e) * 3;
        for (let c = 0; c < 3; c++) sub[o + c] = (cage[a + c] + cage[b + c]) * 0.5;
      }
      const q = L.quads;
      for (let f = 0; f < L.nF; f++) {
        const o = (L.nVerts + L.nE + f) * 3;
        for (let c = 0; c < 3; c++)
          sub[o + c] = (cage[q[f * 4] * 3 + c] + cage[q[f * 4 + 1] * 3 + c] +
                        cage[q[f * 4 + 2] * 3 + c] + cage[q[f * 4 + 3] * 3 + c]) * 0.25;
      }
      const rc = new Float32Array(figure.nRender * 3);
      for (let r = 0; r < figure.nRender; r++) {
        const s2 = figure.renderSub[r] * 3, o = r * 3;
        rc[o] = sub[s2]; rc[o + 1] = sub[s2 + 1]; rc[o + 2] = sub[s2 + 2];
      }
      figure.geometry.setAttribute('color', new BufferAttribute(rc, 3));
      debugMat = new MeshBasicMaterial({ vertexColors: true });
    }
    figure.mesh.material = debugMat;
  },
  figure, stage, rig,
};
window.__ready = true;
