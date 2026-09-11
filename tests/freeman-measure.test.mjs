import test from "node:test";
import assert from "node:assert/strict";
import { readFreeman } from "../tools/read-freeman.mjs";
import { Freeman, DEFAULT } from "../src/freeman/model.js";
import { measure, caseyButt, mccallum } from "../src/freeman/measure.js";

const f = new Freeman(readFreeman());
const at = (o) => measure(f.update({ ...DEFAULT, ...o }));

test("the neutral sculpt measures like a lean, heavily muscled 180 cm man", () => {
  const m = at({});
  assert.ok(m.height > 175 && m.height < 185, `height ${m.height}`);
  assert.ok(m.weight > 80 && m.weight < 105, `weight ${m.weight}`);
  assert.ok(m.ffmi > 22 && m.ffmi < 30, `ffmi ${m.ffmi}`);
  for (const [k, lo, hi] of [["neck", 35, 55], ["chest", 95, 135], ["waist", 65, 95], ["hips", 90, 120],
    ["arm", 32, 50], ["forearm", 26, 40], ["wrist", 15, 23], ["thigh", 55, 80], ["calf", 34, 50], ["ankle", 19, 29]])
    assert.ok(m[k] > lo && m[k] < hi, `${k} ${m[k]}`);
  assert.ok(m.ratios.shoulderWaist > 1.4 && m.ratios.shoulderWaist < 1.9);
  for (const k of ["bicepsGap", "calfBelly", "achilles", "latReach", "sternalGap", "trapRise"])
    assert.ok(Number.isFinite(m.insertion[k]), k);
});

test("each measurement responds to its trait in the right direction", () => {
  const d = (key, field) => field(at({ [key]: 1 })) - field(at({ [key]: 0 }));
  assert.ok(d("clavicle", (m) => m.shoulders) > 1, "wider clavicles, wider shoulders");
  assert.ok(d("mass", (m) => m.arm) > 0.5, "more mass, bigger arms");
  assert.ok(d("bodyFat", (m) => m.waist) > 1, "more fat, bigger waist");
  assert.ok(d("bodyFat", (m) => m.weight) > 1, "more fat, more weight");
  assert.ok(d("bicepInsertion", (m) => m.insertion.bicepsGap) < -1, "longer belly, smaller gap");
  assert.ok(d("calfInsertion", (m) => m.insertion.calfBelly) > 3, "lower calf, longer belly");
  assert.ok(d("latInsertion", (m) => m.insertion.latReach) < 0, "lower lats reach lower");
  assert.ok(d("pecGap", (m) => m.insertion.sternalGap) > 0.5, "wider gap");
  assert.ok(d("trapHeight", (m) => m.insertion.trapRise) > 0.3, "higher traps");
  assert.ok(d("legLength", (m) => m.height) > 3, "longer legs, taller");
});

test("measurements do not depend on the pose", () => {
  f.update(DEFAULT).setPose("anatomy");
  const a = measure(f);
  f.setPose("frontDouble");
  const b = measure(f);
  assert.equal(a.chest, b.chest);
  assert.equal(a.weight, b.weight);
  assert.equal(a.insertion.bicepsGap, b.insertion.bicepsGap);
  f.setPose("anatomy");
});

test("published estimates follow their formulas", () => {
  // 71 in tall, 7 in wrist, 9 in ankle, 10 % body fat
  const c = caseyButt(71 * 2.54, 7 * 2.54, 9 * 2.54, 10);
  assert.ok(Math.abs(c.arm / 2.54 - 17.2) < 0.05, `arm ${c.arm / 2.54}`);
  assert.ok(Math.abs(c.leanMass / 0.45359237 - 183.2) < 0.5, `lbm ${c.leanMass / 0.45359237}`);
  const m = mccallum(18);
  assert.equal(m.chest, 117);
  assert.ok(Math.abs(m.waist - 81.9) < 1e-9);
});

test("a measurement is fast enough to follow a slider", () => {
  measure(f);
  const t = performance.now();
  for (let i = 0; i < 5; i++) measure(f);
  assert.ok((performance.now() - t) / 5 < 80);
});

test.after(() => f.dispose());
