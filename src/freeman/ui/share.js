/* The whole physique — traits, pose, view and look — in the URL hash. Only
   traits away from their defaults are written, so links stay short. */
import { TRAITS } from "../traits.js";

export function encode(state, ui) {
  const s = {};
  for (const t of TRAITS) if (Math.abs(state[t.key] - t.default) > 0.004) s[t.key] = +state[t.key].toFixed(3);
  const o = { s, p: ui.pose, v: Math.round((ui.azimuth * 180) / Math.PI), l: ui.lighting, f: ui.surface, t: ui.tone };
  return btoa(JSON.stringify(o)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function decode(code) {
  if (!code) return null;
  try {
    const o = JSON.parse(atob(code.replace(/-/g, "+").replace(/_/g, "/")));
    const s = {};
    for (const t of TRAITS) {
      const v = Number(o.s?.[t.key]);
      if (Number.isFinite(v)) s[t.key] = Math.max(0, Math.min(1, v));
    }
    return { ...o, s };
  } catch {
    return null;
  }
}
