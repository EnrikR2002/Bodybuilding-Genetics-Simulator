import test from "node:test";
import assert from "node:assert/strict";
import { readFreeman } from "../tools/read-freeman.mjs";
import { Freeman, DEFAULT } from "../src/freeman/model.js";
import { measure } from "../src/freeman/measure.js";

const f = new Freeman(readFreeman());
const at = (o) => measure(f.update({ ...DEFAULT, ...o }));

test("waist width changes the waist, not the chest", () => {
  const a = at({ waist: 0 }), b = at({ waist: 1 });
  assert.ok(b.waist - a.waist > 4, `waist ${a.waist} → ${b.waist}`);
  assert.ok(Math.abs(b.chest - a.chest) < 2, `chest ${a.chest} → ${b.chest}`);
});

test("joint size changes wrists and ankles, not the bellies between them", () => {
  const a = at({ boneThickness: 0 }), b = at({ boneThickness: 1 });
  assert.ok(b.wrist - a.wrist > 1.5, `wrist ${a.wrist} → ${b.wrist}`);
  assert.ok(b.ankle - a.ankle > 1.5, `ankle ${a.ankle} → ${b.ankle}`);
  assert.ok(Math.abs(b.forearm - a.forearm) < 1.2, `forearm ${a.forearm} → ${b.forearm}`);
  assert.ok(Math.abs(b.calf - a.calf) < 1.2, `calf ${a.calf} → ${b.calf}`);
});

test("head size scales the head and carries the eyes with it", () => {
  f.update({ ...DEFAULT, headSize: 0 });
  const h0 = f.height, eye0 = Array.from(f.extras[0].geometry.attributes.position.array.subarray(0, 3));
  f.update({ ...DEFAULT, headSize: 1 });
  assert.ok(f.height - h0 > 1.5, `height ${h0} → ${f.height}`);
  assert.notDeepEqual(Array.from(f.extras[0].geometry.attributes.position.array.subarray(0, 3)), eye0);
  f.update(DEFAULT);
  assert.equal(f.joint("head").y, f.data.meta.bones.find((b) => b.name === "head").head[1], "the neck joint stays put");
});

test("more mass grows muscle more than joints", () => {
  const a = at({ mass: 0.5 }), b = at({ mass: 1 });
  const arm = b.arm - a.arm, wrist = b.wrist - a.wrist;
  assert.ok(arm > 0.5 && arm > wrist * 1.5, `arm +${arm.toFixed(2)}, wrist +${wrist.toFixed(2)}`);
});

test.after(() => f.dispose());
