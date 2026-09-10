import test from "node:test";
import assert from "node:assert/strict";
import { readFreeman } from "../tools/read-freeman.mjs";
import { Freeman, DEFAULT } from "../src/freeman/model.js";
import { POSES } from "../src/freeman/poses.js";
const data = readFreeman();
const f = new Freeman(data);
function maxDiff(a, b) {
  let m = 0;
  for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i] - b[i]));
  return m;
}
test("sculpt topology, coverage target and rig weights are complete", () => {
  assert.equal(data.position.length, data.meta.vertices * 3);
  assert.equal(data.smoothPosition.length, data.position.length);
  assert.equal(data.smoothNormal.length, data.position.length);
  assert.ok(data.meta.triangles > 300000);
  assert.ok(data.index.every((i) => i < data.meta.vertices));
  for (let v = 0; v < data.meta.vertices; v++) {
    let sum = 0;
    for (let k = 0; k < 4; k++) {
      const i = v * 4 + k;
      assert.ok(data.skinIndex[i] < data.meta.bones.length);
      assert.ok(data.skinWeight[i] >= 0);
      sum += data.skinWeight[i];
    }
    assert.ok(Math.abs(sum - 1) < 1e-6);
  }
});
test("neutral lean physique retains the artist surface exactly", () => {
  f.setPose("anatomy").update({ ...DEFAULT, bodyFat: 0 });
  assert.equal(maxDiff(f.positions, data.position), 0);
});
test("belly presets change the surface visibly while retaining the same joints", () => {
  for (const key of ["bicepInsertion", "calfInsertion"]) {
    f.setPose("anatomy").update({ ...DEFAULT, [key]: 0 });
    const a = f.positions.slice(),
      joints = f.heads.map((v) => v.toArray());
    f.update({ ...DEFAULT, [key]: 1 });
    assert.ok(maxDiff(a, f.positions) > 2, key);
    assert.deepEqual(
      f.heads.map((v) => v.toArray()),
      joints,
    );
    for (let v = 0; v < data.meta.vertices; v++)
      if (data.position[v * 3 + 1] > 160 || data.position[v * 3 + 1] < 12) {
        for (let k = 0; k < 3; k++)
          assert.equal(a[v * 3 + k], f.positions[v * 3 + k]);
      }
  }
});
test("every preset and combined frame extremes remain finite through all poses", () => {
  for (const key of Object.keys(DEFAULT))
    for (const value of [0, 1]) {
      f.update({ ...DEFAULT, [key]: value });
      for (const { id: pose } of POSES) {
        f.setPose(pose);
        assert.ok(
          f.positions.every(Number.isFinite),
          `${key}/${value}/${pose}`,
        );
        assert.ok(f.geometry.attributes.normal.array.every(Number.isFinite));
        assert.ok(f.geometry.boundingSphere.radius < 170);
      }
    }
  for (const value of [0, 1]) {
    f.update(
      Object.fromEntries(Object.keys(DEFAULT).map((k) => [k, value])),
    );
    for (const { id } of POSES) {
      f.setPose(id);
      assert.ok(f.positions.every(Number.isFinite), `${value}/${id}`);
    }
  }
});
test("pose changes are reversible without accumulating deformation", () => {
  f.setPose("anatomy").update(DEFAULT);
  const a = f.positions.slice();
  f.setPose("flex");
  assert.ok(maxDiff(a, f.positions) > 10);
  f.setPose("anatomy");
  assert.equal(maxDiff(a, f.positions), 0);
  for (const { id } of POSES) {
    f.setPose(id);
    const posed = f.positions.slice();
    f.setPose(id);
    assert.equal(maxDiff(posed, f.positions), 0, `${id} must be idempotent`);
    f.setPose("anatomy");
    assert.equal(maxDiff(a, f.positions), 0, `${id} must restore the artist surface`);
  }
  f.update({ ...DEFAULT, armLength: 1 });
  assert.ok(
    f.heads[8].distanceTo(f.heads[6]) >
      data.meta.bones[8].head.reduce(
        (sum, x, i) => sum + (x - data.meta.bones[6].head[i]) ** 2,
        0,
      ) **
        0.5,
  );
});
test("bodybuilding poses preserve limb lengths and place elbows and wrists intentionally", () => {
  for (const armLength of [0, 1]) {
    f.update({ ...DEFAULT, armLength });
    for (const { id, upper } of POSES.filter(p => p.upper)) {
      f.setPose(id);
      for (const side of ["L", "R"]) {
        const shoulder = f.landmark(`upperarm.${side}`, 0);
        const elbow = f.landmark(`forearm.${side}`, 0);
        const wrist = f.landmark(`hand.${side}`, 0);
        const i = data.meta.bones.findIndex(b => b.name === `upperarm.${side}`);
        assert.ok(Math.abs(shoulder.distanceTo(elbow) - f.heads[i].distanceTo(f.tails[i])) < 1e-6);
        assert.ok(Math.abs(elbow.distanceTo(wrist) - f.heads[i + 1].distanceTo(f.tails[i + 1])) < 1e-6);
        if (upper[1] > 0) {
          assert.ok(elbow.y > shoulder.y && wrist.y > elbow.y + 12);
        } else {
          assert.ok(wrist.y < elbow.y && Math.abs(wrist.x) < Math.abs(elbow.x));
        }
      }
    }
  }
  assert.throws(() => f.setPose("missing"), /Unknown pose/);
});
test("a comparison owns independent positions, rig and material", () => {
  f.update(DEFAULT);
  const other = new Freeman(data),
    saved = other.positions.slice();
  f.update({ ...DEFAULT, mass: 1, bicepInsertion: 0 })
    .setPose("flex")
    .setSurface("skin", 3);
  assert.equal(maxDiff(other.positions, saved), 0);
  assert.notEqual(other.skin, f.skin);
  assert.notEqual(other.skeleton, f.skeleton);
  other.dispose();
});
test("softer coverage reduces abdominal relief and preserves the hands",()=>{
  function relief(){
    const n=f.geometry.attributes.normal.array;let total=0,count=0;
    for(let i=0;i<data.index.length;i+=3){const a=data.index[i],b=data.index[i+1];
      if([a,b].every(v=>Math.abs(data.position[v*3])<7&&data.position[v*3+1]>106&&data.position[v*3+1]<124&&data.position[v*3+2]>5)){
        total+=1-(n[a*3]*n[b*3]+n[a*3+1]*n[b*3+1]+n[a*3+2]*n[b*3+2]);count++;
      }
    }
    assert.ok(count>100);return total/count;
  }
  f.setPose('anatomy').update(DEFAULT);const lean=relief(),original=f.positions.slice();
  f.update({...DEFAULT,bodyFat:1});assert.ok(relief()<lean*.9);
  let checked=0;
  for(let v=0;v<f.hand.length;v++)if(f.hand[v]>.95){for(let k=0;k<3;k++)assert.equal(f.positions[v*3+k],original[v*3+k]);checked++;}
  assert.ok(checked>1000);
});
test.after(() => f.dispose());
