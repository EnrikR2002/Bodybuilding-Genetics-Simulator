/* ---------------------------------------------------------------------------
   The numbers panel: composition, proportions, the tape, genetic ceilings,
   classic targets, insertion readouts and judge's notes.

   renderMetrics(root, metrics, state) — metrics from measure(fig).
   formatLength(cm) — shared with the callouts, follows the cm/in toggle.
   --------------------------------------------------------------------------- */
import "./analysis.css";

let units = (() => { try { return localStorage.getItem("insertion-units") || "cm"; } catch { return "cm"; } })();
let last = null;

export const formatLength = (cm, digits = 1) =>
  units === "in" ? `${(cm / 2.54).toFixed(digits)} in` : `${cm.toFixed(digits)} cm`;
const num = (cm, digits = 1) => (units === "in" ? cm / 2.54 : cm).toFixed(digits);
const weightOf = (kg) => (units === "in" ? `${(kg / 0.45359237).toFixed(0)} lb` : `${kg.toFixed(1)} kg`);
const heightOf = (cm) => {
  if (units !== "in") return `${cm.toFixed(0)} cm`;
  const inch = cm / 2.54;
  return `${Math.floor(inch / 12)}′${Math.round(inch % 12)}″`;
};

function ffmiBand(v) {
  if (v < 18) return ["Untrained", "neutral"];
  if (v < 20) return ["Trained", "neutral"];
  if (v < 22) return ["Advanced", "good"];
  if (v < 25) return ["Elite natural range", "good"];
  if (v < 27) return ["Above the natural ceiling", "warn"];
  return ["Enhanced range", "bad"];
}

const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};

function section(root, title, extra) {
  const s = el("section", "m-section");
  const h = el("div", "m-head");
  h.append(el("h3", "", title));
  if (extra) h.append(extra);
  s.append(h);
  root.append(s);
  return s;
}

/* A bar: value against a target, clamped to [0, max] of the target. */
function bar(parent, label, value, target, { text, max = 1.25, better = "near" } = {}) {
  const row = el("div", "m-bar");
  const pct = Math.max(0, Math.min(max, value / target));
  const tone = better === "near" ? (Math.abs(1 - value / target) < 0.06 ? "good" : "neutral")
    : better === "low" ? (value <= target ? "good" : "warn") : value >= target ? "good" : "neutral";
  row.innerHTML = `<div class="m-bar-top"><span>${label}</span><b>${text}</b></div>
    <div class="m-track"><i class="m-fill ${tone}" style="width:${(pct / max) * 100}%"></i><i class="m-target" style="left:${100 / max}%"></i></div>`;
  parent.append(row);
}

export function notes(m, s) {
  const out = [];
  const vt = s.clavicle - s.hipWidth;
  out.push(["Frame", vt > 0.35
    ? "Wide clavicles over a narrow pelvis: the taper exists before a single rep. Delt and lat mass will read as width."
    : vt > 0.05 ? "A workable frame. The clavicles clear the hips, so shoulder and lat work will pay off as width."
    : "Clavicles and pelvis are close in width. Width has to be built with delts and lats, and the waist will always fight it."]);
  out.push(["Taper", m.ratios.shoulderWaist >= 1.618
    ? `Shoulder-to-waist ratio of ${m.ratios.shoulderWaist.toFixed(2)}: at or past the classical 1.618.`
    : `Shoulder-to-waist ratio of ${m.ratios.shoulderWaist.toFixed(2)}, short of the classical 1.618. A smaller waist moves it faster than bigger delts.`]);
  const gap = m.insertion.bicepsGap;
  if (gap !== undefined) out.push(["Arms", gap > 5.5
    ? `A short biceps belly leaves ${formatLength(gap)} of tendon above the elbow. Expect a high, round peak and a visible gap in a flexed pose.`
    : gap < 3.5 ? `A long biceps belly, ending ${formatLength(gap)} above the elbow. The arm looks full even relaxed; the peak is less dramatic.`
    : `An average biceps belly, ending ${formatLength(gap)} above the elbow.`]);
  if (m.insertion.latReach !== undefined) out.push(["Back", s.latInsertion < 0.35
    ? `High lats: the sweep stops ${formatLength(m.insertion.latReach)} above the waist, so the V has to come from the clavicles.`
    : s.latInsertion > 0.65 ? "Low lats carry the sweep down toward the waist. The taper reads even relaxed."
    : "Mid-length lats: the sweep ends around the bottom of the rib cage."]);
  if (m.insertion.calfBelly !== undefined) out.push(["Calves", s.calfInsertion < 0.35
    ? `High calves: a short belly (${m.insertion.calfBelly.toFixed(0)} % of the shin) over a ${formatLength(m.insertion.achilles)} Achilles tendon. The hardest body part here to make look big.`
    : s.calfInsertion > 0.65 ? "Low calves fill the lower leg almost to the ankle. They look developed with little work."
    : "Average calf insertions: a normal belly with a visible Achilles."]);
  const bf = m.bodyFatPct;
  out.push(["Condition", bf > 14
    ? `At about ${bf.toFixed(0)} % body fat the separations close up. Every insertion here is unchanged; it just cannot be seen.`
    : bf < 7 ? "Stage lean: the abs, serratus and every insertion are on show, for better or worse."
    : `About ${bf.toFixed(0)} % body fat: the major separations read, the fine ones soften.`]);
  out.push(["Given vs earned", "Nineteen of the twenty-three traits on this page were set at birth. Mass, back density, leg mass and body fat are the four that training and diet move."]);
  return out;
}

export function renderMetrics(root, m, state) {
  last = [root, m, state];
  root.replaceChildren();
  if (!m) return;
  root.classList.add("metrics");

  const toggle = el("div", "m-units");
  for (const u of ["cm", "in"]) {
    const b = el("button", u === units ? "on" : "", u);
    b.type = "button";
    b.setAttribute("aria-pressed", u === units);
    b.onclick = () => {
      units = u;
      try { localStorage.setItem("insertion-units", u); } catch {}
      renderMetrics(...last);
    };
    toggle.append(b);
  }

  // headline numbers
  const hero = el("div", "m-hero");
  const [band, tone] = ffmiBand(m.ffmi);
  for (const [value, label, sub, t] of [
    [heightOf(m.height), "Height", "", ""], [weightOf(m.weight), "Weight", "from volume", ""],
    [`${m.bodyFatPct.toFixed(0)} %`, "Body fat", "estimate", ""], [m.ffmi.toFixed(1), "FFMI", band, tone],
  ]) {
    const c = el("div", `m-stat ${t}`);
    c.append(el("b", "", value), el("span", "", label));
    if (sub) c.append(el("small", "", sub));
    hero.append(c);
  }
  const top = section(root, "Composition", toggle);
  top.append(hero);
  top.append(el("p", "m-foot", `Lean mass ${weightOf(m.leanMass)} · normalised FFMI ${m.ffmiAdjusted.toFixed(1)}`));

  const r = m.ratios, p = section(root, "Proportions");
  bar(p, "Shoulders ÷ waist (Adonis index)", r.shoulderWaist, 1.618, { text: r.shoulderWaist.toFixed(2) });
  bar(p, "Chest ÷ waist", r.chestWaist, 1.43, { text: r.chestWaist.toFixed(2) });
  bar(p, "Waist ÷ height", r.waistHeight, 0.45, { text: r.waistHeight.toFixed(2), better: "low" });
  bar(p, "Legs ÷ torso", r.legTorso, 1.35, { text: r.legTorso.toFixed(2) });

  const t = section(root, "Tape"), grid = el("dl", "m-tape");
  for (const [label, v] of [["Neck", m.neck], ["Shoulders", m.shoulderGirth], ["Chest", m.chest], ["Arm, relaxed", m.arm],
    ["Forearm", m.forearm], ["Wrist", m.wrist], ["Waist", m.waist], ["Hips", m.hips], ["Thigh", m.thigh],
    ["Calf", m.calf], ["Ankle", m.ankle], ["Shoulder width", m.shoulders]]) {
    const d = el("div");
    d.append(el("dt", "", label), el("dd", "", num(v)));
    grid.append(d);
  }
  t.append(grid);

  const cb = m.ideal.caseyButt, c = section(root, "Genetic ceiling");
  c.append(el("p", "m-note", "Casey Butt's published estimates of the natural maximum for this height, wrist and ankle, at this body fat. The arm figure is flexed; ours is relaxed."));
  bar(c, "Lean mass", m.leanMass, cb.leanMass, { text: `${weightOf(m.leanMass)} of ${weightOf(cb.leanMass)}`, better: "high" });
  for (const [label, k] of [["Chest", "chest"], ["Arm", "arm"], ["Forearm", "forearm"], ["Neck", "neck"], ["Thigh", "thigh"], ["Calf", "calf"]])
    bar(c, label, m[k], cb[k], { text: `${num(m[k])} / ${num(cb[k])}`, better: "high" });

  const mc = m.ideal.mccallum, k2 = section(root, "Classic proportions");
  k2.append(el("p", "m-note", `John McCallum's targets from a ${formatLength(m.wrist)} wrist.`));
  for (const [label, k] of [["Chest", "chest"], ["Waist", "waist"], ["Hips", "hips"], ["Arm", "arm"], ["Thigh", "thigh"], ["Calf", "calf"], ["Neck", "neck"]])
    bar(k2, label, m[k], mc[k], { text: `${num(m[k])} / ${num(mc[k])}`, better: k === "waist" ? "low" : "near" });

  const ins = m.insertion;
  if (Object.keys(ins).length) {
    const s = section(root, "Insertions"), grid2 = el("dl", "m-tape wide");
    const rows = [
      ["Biceps belly ends", ins.bicepsGap !== undefined && `${formatLength(ins.bicepsGap)} above the elbow`],
      ["Triceps long head", ins.tricepsReach !== undefined && `reaches ${ins.tricepsReach.toFixed(0)} % of the humerus`],
      ["Calf belly", ins.calfBelly !== undefined && `${ins.calfBelly.toFixed(0)} % of the shin`],
      ["Achilles tendon", ins.achilles !== undefined && formatLength(ins.achilles)],
      ["Lat sweep ends", ins.latReach !== undefined && `${formatLength(ins.latReach)} above the waist`],
      ["Sternal gap", ins.sternalGap !== undefined && formatLength(ins.sternalGap)],
      ["Upper traps rise", ins.trapRise !== undefined && `${formatLength(ins.trapRise)} over the shoulder`],
    ];
    for (const [label, v] of rows) if (v) {
      const d = el("div");
      d.append(el("dt", "", label), el("dd", "", v));
      grid2.append(d);
    }
    s.append(grid2);
  }

  const n = section(root, "Judge's notes"), list = el("div", "m-notes");
  for (const [title, text] of notes(m, state)) {
    const d = el("div", "m-notelet");
    d.append(el("b", "", title), el("p", "", text));
    list.append(d);
  }
  n.append(list);
}
