import test from "node:test";
import assert from "node:assert/strict";
import { Matrix4, Vector3 } from "three";
import { readFreeman } from "../tools/read-freeman.mjs";
import { Freeman, DEFAULT } from "../src/freeman/model.js";
import { POSES } from "../src/freeman/poses.js";
import { TRAITS, PRESETS, presetState } from "../src/freeman/traits.js";
import { STAGES } from "../src/freeman/shape/index.js";
import { boneDualQuaternions, skinDualQuaternion, computeNormals } from "../src/freeman/geometry.js";
import { applyVolumeBoneTransform } from "../src/render/skinning.js";
const data = readFreeman();
const f = new Freeman(data);
function maxDiff(a, b) {
  let m = 0;
  for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i] - b[i]));
  return m;
}
const restLength = (a, b) => new Vector3().fromArray(data.meta.bones.find((d) => d.name === a).head)
  .distanceTo(new Vector3().fromArray(data.meta.bones.find((d) => d.name === b).head));

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

test("the trait catalogue, stages and presets agree", () => {
  const keys = new Set(TRAITS.map((t) => t.key));
  assert.equal(keys.size, TRAITS.length, "trait keys are unique");
  for (const t of TRAITS) {
    assert.ok(t.default >= 0 && t.default <= 1, t.key);
    assert.equal(t.stops.length, 3, t.key);
  }
  const owned = STAGES.flatMap((s) => s.traits);
  for (const k of keys) assert.ok(owned.includes(k), `${k} has a shape stage`);
  for (const p of PRESETS) for (const k of Object.keys(p.values)) assert.ok(keys.has(k), `${p.id}.${k}`);
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

test("insertion traits are continuous between their stops", () => {
  for (const key of ["bicepInsertion", "calfInsertion"]) {
    const at = (x) => f.update({ ...DEFAULT, [key]: x }).positions.slice();
    const a = at(0.5), b = at(0.625), c = at(0.75);
    const ab = maxDiff(a, b), bc = maxDiff(b, c);
    assert.ok(ab > 0.05 && bc > 0.05, `${key} moves at intermediate values`);
    assert.ok(ab < 3 && bc < 3, `${key} moves smoothly`);
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
  for (const p of PRESETS) {
    f.update(presetState(p.id));
    assert.ok(f.positions.every(Number.isFinite), p.id);
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
  assert.ok(f.joint("hand.L").distanceTo(f.joint("upperarm.L")) > restLength("hand.L", "upperarm.L"));
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
        const u = f.boneIndex(`upperarm.${side}`), fo = f.boneIndex(`forearm.${side}`);
        assert.ok(Math.abs(shoulder.distanceTo(elbow) - f.heads[u].distanceTo(f.tails[u])) < 1e-6);
        assert.ok(Math.abs(elbow.distanceTo(wrist) - f.heads[fo].distanceTo(f.tails[fo])) < 1e-6);
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

test("fast skinning and normals match the reference implementations", () => {
  f.update(DEFAULT).setPose("frontDouble");
  const dq = boneDualQuaternions(f.skeleton);
  const fast = skinDualQuaternion(dq, data.skinIndex, data.skinWeight, f.restPositions,
    new Float32Array(f.restPositions.length));
  const driver = { geometry: f.geometry, skeleton: f.skeleton, bindMatrix: new Matrix4(), bindMatrixInverse: new Matrix4() };
  const V = new Vector3();
  let worst = 0;
  for (let v = 0; v < data.meta.vertices; v += 97) {
    V.fromArray(f.restPositions, v * 3);
    applyVolumeBoneTransform.call(driver, v, V);
    worst = Math.max(worst, V.distanceTo(new Vector3().fromArray(fast, v * 3)));
  }
  assert.ok(worst < 1e-3, `skinning differs by ${worst}`);
  const mine = computeNormals(data.index, f.positions, new Float32Array(f.positions.length));
  f.geometry.computeVertexNormals();
  assert.ok(maxDiff(mine, f.geometry.attributes.normal.array) < 1e-4);
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

test("a full shape edit and re-pose stays fast enough to drag a slider", () => {
  f.update(DEFAULT).setPose("frontDouble");
  const t0 = performance.now();
  for (let i = 0; i < 4; i++) f.update({ ...DEFAULT, mass: 0.5 + i * 0.1, bicepInsertion: 0.3 + i * 0.1 });
  const each = (performance.now() - t0) / 4;
  assert.ok(each < 250, `update + pose took ${each.toFixed(0)} ms`);
});
test.after(() => f.dispose());
