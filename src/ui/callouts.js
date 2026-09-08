/* Callout anchors sample the same skinned render surface as the visible body. */
import { Object3D, Vector3 } from 'three';

export const CALLOUTS = [
  { k: 'biceps', label: 'Biceps belly',
    get: S => S.bicepInsertion < 0.33 ? 'short belly, longer tendon interval'
           : S.bicepInsertion < 0.66 ? 'intermediate belly length' : 'fuller toward the elbow' },
  { k: 'lat', label: 'Lat insertion',
    get: S => S.latInsertion < 0.35 ? 'sweep starts high'
           : S.latInsertion < 0.7 ? 'mid attachment' : 'sweep starts at the waist' },
  { k: 'calf', label: 'Calf belly',
    get: S => S.calfInsertion < 0.35 ? 'high belly, longer Achilles interval'
           : S.calfInsertion < 0.7 ? 'mid belly' : 'fuller toward the ankle' },
  { k: 'clav', label: 'Shoulder breadth', get: (S, m) => `${m.shoulder.toFixed(0)} cm` },
  { k: 'pec', label: 'Pec attachment',
    get: S => S.pecGap < 0.35 ? 'narrow sternal gap'
           : S.pecGap < 0.7 ? 'slight separation' : 'wide sternal gap' },
  { k: 'waist', label: 'Waist', get: (S, m) => `${m.waist.toFixed(0)} cm` },
];

const SPEC = [
  { k: 'biceps', region: 'biceps_long.L', at: 'peak', limb: 'biceps' },
  { k: 'pec', region: 'pec_lower.L', at: 0.45 },
  { k: 'calf', region: 'gastroc_med.L', at: 'peak', limb: 'calf' },
  { k: 'clav', region: 'deltoid_lat.R', at: 0.05 },
  { k: 'lat', region: 'lat.R', at: 0.72 },
  { k: 'waist', region: 'obliques.R', at: 'peak' },
];

export function placeAnchors(anchors, figure) {
  const regions=figure.regions;
  if(!regions)return anchors;
  if(!figure.subToRender) {
    figure.subToRender=new Int32Array(figure.nSubVerts).fill(-1);
    figure.renderSub.forEach((s,r)=>{figure.subToRender[s]=r;});
  }
  for(const spec of SPEC) {
    let sub=spec.at==='peak'?regions.peakVertex(spec.region):regions.vertexAt(spec.region,spec.at);
    const limb=figure.muscleForms?.limbs.find(l=>l.kind===spec.limb&&l.side==='L');
    if(limb) {
      const t=(limb.start+limb.targetEnd)*.5;
      let angle=0,maxArc=0;
      limb.arc.forEach((w,i)=>{if(w>maxArc){maxArc=w;angle=i/limb.arc.length*Math.PI*2;}});
      let best=Infinity;
      for(const pt of limb.sub) {
        const da=Math.min(Math.abs(pt.a-angle),Math.PI*2-Math.abs(pt.a-angle));
        const score=(pt.t-t)**2+(da*.2)**2;
        if(score<best&&figure.subToRender[pt.v]>=0){best=score;sub=pt.v;}
      }
    }
    const render=figure.subToRender[sub];if(render===undefined||render<0)continue;
    const anchor=anchors[spec.k]??=new Object3D();
    if(anchor.parent!==figure.root)figure.root.add(anchor);
    anchor.userData.renderVertex=render;
  }
  return anchors;
}

const normal=new Vector3();
export function updateAnchors(anchors,figure) {
  for(const anchor of Object.values(anchors)) {
    const r=anchor.userData.renderVertex;
    anchor.position.fromArray(figure.rPos,r*3);
    normal.fromArray(figure.rNrm,r*3);
    anchor.position.addScaledVector(normal,.7);
    figure.mesh.applyBoneTransform(r,anchor.position);
  }
}
