/* ---------------------------------------------------------------------------
   Trait sliders, grouped by GROUPS with Given / Earned badges.

   buildControls(root, api) creates the rows once; refreshControls(root,
   state, percentiles, active) updates values and readouts without rebuilding,
   so a drag never loses focus. A slider snaps to the trait's default (the
   artist's sculpt) when it passes near it.
   --------------------------------------------------------------------------- */
import { GROUPS, TRAITS, bodyFatPercent } from "../traits.js";

export const stopOf = (t, v) => t.stops[v < 0.34 ? 0 : v > 0.66 ? 2 : 1];
export const readout = (t, v) =>
  t.key === "bodyFat" ? `${bodyFatPercent(v).toFixed(0)} % fat` : `${stopOf(t, v)} · ${Math.round(v * 100)}`;

export function buildControls(root, api) {
  root.replaceChildren();
  for (const g of GROUPS) {
    const sec = document.createElement("section");
    sec.className = "group";
    sec.innerHTML = `<header><h3>${g.label}</h3><span class="badge ${g.given ? "given" : "earned"}">${g.given ? "Given" : "Earned"}</span></header><p class="blurb">${g.blurb}</p>`;
    for (const t of TRAITS.filter((x) => x.group === g.id)) {
      const row = document.createElement("div");
      row.className = "trait";
      row.dataset.key = t.key;
      row.innerHTML = `<div class="trait-head"><label for="t-${t.key}">${t.label}</label><span class="pct" hidden></span><output for="t-${t.key}"></output><button class="xt" type="button" title="Compare ${t.stops[0].toLowerCase()} with ${t.stops[2].toLowerCase()}" aria-label="Compare the extremes of ${t.label}">⇆</button></div>
        <input type="range" id="t-${t.key}" min="0" max="100" step="1" style="--def:${t.default * 100}%">
        <div class="stops" aria-hidden="true"><span>${t.stops[0]}</span><span>${t.stops[1]}</span><span>${t.stops[2]}</span></div>`;
      const input = row.querySelector("input");
      input.value = Math.round(api.state[t.key] * 100);
      input.addEventListener("input", () => {
        let v = input.value / 100;
        if (Math.abs(v - t.default) < 0.025) v = t.default;
        api.onInput(t.key, v);
      });
      input.addEventListener("change", () => api.onCommit(t.key));
      input.addEventListener("dblclick", () => {
        input.value = t.default * 100;
        api.onInput(t.key, t.default);
        api.onCommit(t.key);
      });
      input.addEventListener("pointerdown", () => api.onActivate(t.key));
      input.addEventListener("focus", () => { api.onActivate(t.key); api.onHover(t.key); });
      input.addEventListener("blur", () => api.onHover(null));
      row.addEventListener("pointerenter", () => api.onHover(t.key));
      row.addEventListener("pointerleave", () => api.onHover(null));
      row.querySelector(".xt").onclick = () => api.onCompare(t.key);
      sec.append(row);
    }
    root.append(sec);
  }
}

export function refreshControls(root, state, percentiles, active) {
  for (const t of TRAITS) {
    const row = root.querySelector(`[data-key="${t.key}"]`);
    if (!row) continue;
    const input = row.querySelector("input"), v = state[t.key];
    if (Math.abs(input.value / 100 - v) > 0.006) input.value = Math.round(v * 100);
    const text = readout(t, v);
    row.querySelector("output").textContent = text;
    input.setAttribute("aria-valuetext", text);
    input.style.setProperty("--val", `${v * 100}%`);
    row.classList.toggle("active", t.key === active);
    row.classList.toggle("changed", Math.abs(v - t.default) > 0.004);
    const pct = row.querySelector(".pct"), p = percentiles?.[t.key];
    pct.hidden = p === undefined;
    if (p !== undefined) {
      pct.textContent = `${Math.round(p)}th pct`;
      pct.title = `Rolled at the ${Math.round(p)}th percentile of a bell curve for this trait`;
    }
  }
}
