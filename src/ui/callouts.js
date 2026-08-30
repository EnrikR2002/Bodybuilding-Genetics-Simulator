/* ---------------------------------------------------------------------------
   Leader-line callouts.

   Each callout hangs off a real point on the anatomy — the actual vertex where
   that muscle's belly is thickest right now, not a guessed offset from a joint.
   So when a slider moves the biceps peak up the arm, the label's leader line
   follows it there, which is the whole point of pointing at it.

   The anchors are Object3Ds parented to the nearest bone, so they ride along
   with the pose for free.
   --------------------------------------------------------------------------- */
import { Object3D, Vector3 } from 'three';

export const CALLOUTS = [
  { k: 'biceps', label: 'Biceps insertion',
    get: S => S.bicepInsertion < 0.33 ? 'long tendon, big gap'
           : S.bicepInsertion < 0.66 ? 'a finger and a half' : 'belly runs to the elbow' },
  { k: 'lat', label: 'Lat insertion',
    get: S => S.latInsertion < 0.35 ? 'sweep starts high'
           : S.latInsertion < 0.7 ? 'mid attachment' : 'sweep starts at the waist' },
  { k: 'calf', label: 'Calf insertion',
    get: S => S.calfInsertion < 0.35 ? 'diamond, long achilles'
           : S.calfInsertion < 0.7 ? 'mid belly' : 'full down to the ankle' },
  { k: 'clav', label: 'Clavicle', get: (S, m) => `${m.shoulder.toFixed(0)} cm` },
  { k: 'pec', label: 'Pec attachment',
    get: S => S.pecGap < 0.35 ? 'pecs meet at the sternum'
           : S.pecGap < 0.7 ? 'slight separation' : 'wide sternal gap' },
  { k: 'waist', label: 'Waist', get: (S, m) => `${m.waist.toFixed(0)} cm` },
];

/* Which bone each anchor rides, and how to find its point on the mesh.
   Sides alternate so the labels split into two columns instead of piling up
   down one edge of the plate. */
const SPEC = [
  { k: 'biceps', bone: 'upperarm01.L', region: 'biceps_long.L', at: 'peak' },
  { k: 'pec', bone: 'spine01', region: 'pec_lower.L', at: 0.45 },
  { k: 'calf', bone: 'lowerleg01.L', region: 'gastroc_med.L', at: 'peak' },
  { k: 'clav', bone: 'clavicle.R', region: 'deltoid_lat.R', at: 0.05 },
  { k: 'lat', bone: 'spine03', region: 'lat.R', at: 0.72 },
  { k: 'waist', bone: 'spine04', region: 'obliques.R', at: 'peak' },
];

const _v = new Vector3();

export function placeAnchors(anchors, figure, rig, measurements) {
  const R = figure.regions;
  if (!R) return anchors;
  const skel = figure.skeleton;

  for (const s of SPEC) {
    const bone = skel.byName[s.bone];
    if (!bone) continue;
    const vi = s.at === 'peak' ? R.peakVertex(s.region) : R.vertexAt(s.region, s.at);
    if (vi < 0) continue;

    /* the vertex position, in the space the bone's rest head lives in */
    _v.set(figure.cage[vi * 3], figure.cage[vi * 3 + 1], figure.cage[vi * 3 + 2]);
    /* push it a little clear of the skin so the leader dot is not buried */
    const n = R.restNormal;
    _v.x += n[vi * 3] * 1.4;
    _v.y += n[vi * 3 + 1] * 1.4;
    _v.z += n[vi * 3 + 2] * 1.4;
    /* and express it relative to the bone's rest head, which is what the bone
       transform is measured from */
    skel.restHead(s.bone, _tmp);
    _v.sub(_tmp);

    let a = anchors[s.k];
    if (!a) { a = new Object3D(); anchors[s.k] = a; }
    if (a.parent !== bone) bone.add(a);
    a.position.copy(_v);
  }
  return anchors;
}

const _tmp = new Vector3();
