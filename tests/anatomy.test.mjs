import test from 'node:test';
import assert from 'node:assert/strict';
import { Matrix4, Quaternion, Vector3 } from 'three';
import { readBundle } from '../tools/read-bundle.mjs';
import { Figure } from '../src/body/figure.js';
import { PoseRig } from '../src/pose/ik.js';
import { DEFAULT } from '../src/data/sliders.js';
import { POSES } from '../src/data/poses.js';
import { applyVolumeBoneTransform } from '../src/render/skinning.js';
import { placeAnchors, updateAnchors } from '../src/ui/callouts.js';

const body = readBundle('public/models/body.bin');
const regions = readBundle('public/models/regions.bin');
const atlas = readBundle('public/models/anatomy.bin');
const figure = new Figure(body).attachRegions(regions, atlas);
figure.bindSkeleton();
const trained = { ...DEFAULT, mass: .85, legMass: .85, bodyFat: .08, flex: 1 };
const maxDifference = (a, b) => a.reduce((m, x, i) => Math.max(m, Math.abs(x-b[i])), 0);

test('baked skin weights remain normalized and reference retained bones', () => {
  const {skinIndex:indices,skinWeight:weights}=figure.geometry.attributes;
  for(let v=0;v<indices.count;v++) {
    let sum=0;
    for(let k=0;k<4;k++) {
      const i=v*4+k,w=weights.array[i];
      assert.ok(Number.isFinite(w)&&w>=0&&w<=1);
      assert.ok(indices.array[i]<figure.skeleton.n);
      sum+=w;
    }
    assert.ok(Math.abs(sum-1)<1e-5);
  }
});

test('belly callout moves along the arm and survives a flexed pose', () => {
  const anchors={};let previous;
  for(const value of [0,1]) {
    figure.update({...trained,bicepInsertion:value});
    const rig=new PoseRig(figure.skeleton).refresh();
    rig.apply(POSES.find(p=>p.id==='frontDouble'));
    figure.root.updateMatrixWorld(true);
    placeAnchors(anchors,figure);updateAnchors(anchors,figure);
    const r=anchors.biceps.userData.renderVertex;
    const sub=figure.renderSub[r];
    const limb=figure.muscleForms.limbs.find(l=>l.kind==='biceps'&&l.side==='L');
    const t=limb.sub.find(p=>p.v===sub).t;
    if(previous!==undefined)assert.ok(t>previous+.08,'long belly anchor shifts toward elbow');
    previous=t;
    assert.ok(anchors.biceps.position.toArray().every(Number.isFinite));
  }
});

test('belly endpoints change surface while preserving joint locations', () => {
  for (const key of ['bicepInsertion', 'calfInsertion']) {
    figure.update({ ...trained, [key]: 0 });
    const short = figure.rPos.slice(), joints = figure.skeleton.head.slice();
    figure.update({ ...trained, [key]: 1 });
    assert.ok(maxDifference(short, figure.rPos) > 0.8, `${key}: visible centimetre-scale difference`);
    assert.ok(maxDifference(joints, figure.skeleton.head) < 0.0001, `${key}: fixed bony insertion`);
  }
});

test('all genetic sliders interpolate without nonfinite vertices or jumps', () => {
  for (const key of ['bicepInsertion','bicepPeak','calfInsertion','latInsertion','pecGap','abStagger','trapHeight']) {
    let last;
    for (const value of [0,.25,.5,.75,1]) {
      figure.update({ ...trained, [key]: value });
      assert.ok(figure.rPos.every(Number.isFinite), `${key}=${value}: finite positions`);
      assert.ok(figure.rNrm.every(Number.isFinite), `${key}=${value}: finite normals`);
      if (last) assert.ok(maxDifference(last, figure.rPos) < 4, `${key}: continuous surface`);
      last = figure.rPos.slice();
    }
  }
});

test('fat reduces visible insertion differences without moving attachments', () => {
  const extent = fat => {
    figure.update({ ...trained, bodyFat: fat, bicepInsertion: 0 });
    const short = figure.rPos.slice();
    figure.update({ ...trained, bodyFat: fat, bicepInsertion: 1 });
    return maxDifference(short, figure.rPos);
  };
  assert.ok(extent(.9) < extent(.08));
});

test('measuring never mutates the live skeleton or rendered surface', () => {
  figure.update(trained);
  const heads = figure.skeleton.head.slice(), surface = figure.rPos.slice();
  figure.measureCage({ ...trained, armLength: 1, bicepInsertion: 0 });
  assert.deepEqual(figure.skeleton.head, heads);
  assert.deepEqual(figure.rPos, surface);
});

test('principal poses stay finite across extreme frames', () => {
  const rig = new PoseRig(figure.skeleton);
  for (const size of [0,1]) {
    figure.update({ ...trained, armLength: size, clavicle: size, hipWidth: size, legLength: size });
    rig.refresh();
    for (const pose of POSES) {
      rig.apply(pose); figure.root.updateMatrixWorld(true);
      for (const bone of figure.skeleton.bones) {
        assert.ok(bone.quaternion.toArray().every(Number.isFinite), pose.id);
        assert.ok(Math.abs(bone.quaternion.length()-1) < 1e-5, pose.id);
      }
      const point = new Vector3();
      for (let r=0;r<figure.nRender;r+=97) {
        point.fromArray(figure.rPos,r*3);
        applyVolumeBoneTransform.call(figure.mesh,r,point);
        assert.ok(point.toArray().every(Number.isFinite), pose.id);
        assert.ok(point.length() < 300, `${pose.id}: bounded skinning`);
      }
    }
  }
});

test('dual quaternion blend preserves radius through a 180-degree twist', () => {
  const q = new Quaternion().setFromAxisAngle(new Vector3(0,1,0),Math.PI);
  const fake = {
    bindMatrix: new Matrix4(), bindMatrixInverse: new Matrix4(),
    geometry: { attributes: { skinIndex: { array: [0,1,0,0] }, skinWeight: { array: [.5,.5,0,0] } } },
    skeleton: {
      bones: [{ matrixWorld: new Matrix4() },{ matrixWorld: new Matrix4().makeRotationFromQuaternion(q) }],
      boneInverses: [new Matrix4(),new Matrix4()],
    },
  };
  const p = applyVolumeBoneTransform.call(fake,0,new Vector3(2,0,0));
  assert.ok(Math.abs(p.length()-2) < 1e-6);
});
