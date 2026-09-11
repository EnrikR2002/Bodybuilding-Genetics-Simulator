/* ---------------------------------------------------------------------------
   Leader-line callouts anchored to the posed surface.

   update(figures, traitKey, metricsList) picks anchors for the active trait
   (vertex indices measured by measure()); frame() projects them every
   rendered frame, hides anchors facing away from the camera, and stacks the
   labels on the outside of each figure so they never overlap.
   --------------------------------------------------------------------------- */
import { Vector3 } from "three";
import { formatLength } from "./metrics.js";

const SPECS = {
  bicepInsertion: [["biceps", "Biceps belly ends", (m) => `${formatLength(m.insertion.bicepsGap)} above the elbow`]],
  bicepPeak: [["biceps", "Biceps belly", (m) => `${formatLength(m.insertion.bicepsBelly)} long`]],
  tricepsLength: [["triceps", "Triceps long head", (m) => `reaches ${m.insertion.tricepsReach.toFixed(0)} % of the humerus`]],
  calfInsertion: [["calf", "Calf belly", (m) => `${m.insertion.calfBelly.toFixed(0)} % of the shin · Achilles ${formatLength(m.insertion.achilles)}`]],
  latInsertion: [["lat", "Lat sweep ends", (m) => `${formatLength(m.insertion.latReach)} above the waist`]],
  pecGap: [["pec", "Sternal gap", (m) => formatLength(m.insertion.sternalGap)]],
  abStagger: [["abs", "Rectus abdominis", (m, s) => (s.abStagger > 0.6 ? "rows staggered" : s.abStagger < 0.4 ? "rows even" : "rows slightly offset")]],
  abCount: [["abs", "Ab segments", (m, s) => (s.abCount < 0.3 ? "four" : s.abCount > 0.7 ? "eight" : "six")]],
  trapHeight: [["trap", "Upper traps", (m) => `rise ${formatLength(m.insertion.trapRise)} over the shoulder`]],
  quadTeardrop: [["vmo", "Teardrop (VMO)", (m, s) => (s.quadTeardrop > 0.6 ? "low, hugging the knee" : s.quadTeardrop < 0.4 ? "high above the knee" : "mid")]],
  clavicle: [["shoulder", "Shoulder width", (m) => formatLength(m.shoulders)]],
  waist: [["abs", "Waist", (m) => formatLength(m.waist)]],
  ribcage: [["pec", "Chest", (m) => formatLength(m.chest)]],
  hipWidth: [["abs", "Hips", (m) => formatLength(m.hips)]],
  mass: [["biceps", "Arm, relaxed", (m) => formatLength(m.arm)]],
  legMass: [["vmo", "Thigh", (m) => formatLength(m.thigh)]],
  backThickness: [["lat", "Back", (m) => `shoulders ${formatLength(m.shoulderGirth)}`]],
  bodyFat: [["abs", "Waist", (m) => `${formatLength(m.waist)} · ${m.bodyFatPct.toFixed(0)} % fat`]],
};

const P = new Vector3(), N = new Vector3(), D = new Vector3();

export class Callouts {
  constructor(layer, stage) {
    this.layer = layer;
    this.stage = stage;
    this.items = [];
    this._visible = true;
    layer.classList.add("callouts");
    this.svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    layer.append(this.svg);
  }
  set visible(v) {
    this._visible = v;
    this.layer.hidden = !v;
  }
  get visible() { return this._visible; }

  update(figures, traitKey, metricsList = [], state = {}) {
    for (const it of this.items) it.label.remove();
    this.items = [];
    const specs = SPECS[traitKey] ?? [];
    figures.forEach((fig, i) => {
      const m = metricsList[i];
      if (!fig || !m) return;
      for (const [anchor, title, text] of specs) {
        const v = m.anchors?.[anchor];
        if (v === undefined) continue;
        let value;
        try { value = text(m, fig.state ?? state); } catch { continue; }
        const label = document.createElement("div");
        label.className = `callout${i ? " b-side" : ""}`;
        label.innerHTML = `<b>${title}</b><span>${value}</span>`;
        this.layer.append(label);
        this.items.push({ fig, v, label, index: i });
      }
    });
    this.frame();
  }

  frame() {
    if (!this._visible || !this.items.length) { this.svg.replaceChildren(); return; }
    const cam = this.stage.camera, canvas = this.stage.renderer.domElement;
    const w = canvas.clientWidth, h = canvas.clientHeight;
    cam.getWorldDirection(D);
    const placed = [];
    for (const it of this.items) {
      const { fig, v } = it, p = fig.positions, n = fig.geometry.attributes.normal.array;
      P.set(p[v * 3], p[v * 3 + 1], p[v * 3 + 2]).add(fig.root.position);
      N.set(n[v * 3], n[v * 3 + 1], n[v * 3 + 2]);
      const facing = N.dot(D) < 0.15;
      P.project(cam);
      const x = (P.x + 1) / 2 * w, y = (1 - P.y) / 2 * h;
      const centre = new Vector3().copy(fig.root.position).project(cam);
      const cx = (centre.x + 1) / 2 * w;
      it.screen = { x, y, side: x < cx ? -1 : 1, visible: facing && P.z < 1 && x > 0 && x < w && y > 0 && y < h };
      placed.push(it);
    }
    // stack labels per side so they never overlap
    const lines = [];
    for (const side of [-1, 1]) {
      const col = placed.filter((it) => it.screen.visible && it.screen.side === side).sort((a, b) => a.screen.y - b.screen.y);
      let floor = -Infinity;
      for (const it of col) {
        const lh = it.label.offsetHeight || 34, lw = it.label.offsetWidth || 120;
        const ly = Math.max(it.screen.y, floor + lh / 2 + 6);
        floor = ly + lh / 2;
        const gap = Math.min(150, w * 0.16);
        const lx = side < 0 ? Math.max(4, it.screen.x - gap - lw) : Math.min(w - lw - 4, it.screen.x + gap);
        it.label.style.left = `${lx}px`;
        it.label.style.top = `${ly}px`;
        it.label.style.visibility = "visible";
        const ex = side < 0 ? lx + lw : lx;
        lines.push(`<circle cx="${it.screen.x}" cy="${it.screen.y}" r="2.5"/><polyline points="${it.screen.x},${it.screen.y} ${(it.screen.x + ex) / 2},${ly} ${ex},${ly}"/>`);
      }
    }
    for (const it of placed) if (!it.screen.visible) it.label.style.visibility = "hidden";
    this.svg.innerHTML = lines.join("");
  }
}
