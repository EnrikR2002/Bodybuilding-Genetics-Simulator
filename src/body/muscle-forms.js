import { Vector3 } from 'three';
import { BodySkeleton } from './skeleton.js';

const clamp = (x,a=0,b=1) => Math.max(a,Math.min(b,x));
const smooth = (a,b,x) => { const t=clamp((x-a)/(b-a)); return t*t*(3-2*t); };
const lerp = (a,b,t) => a+(b-a)*t;
const W = 33, H = 32, TAU = Math.PI*2;

// Sample the existing anatomical surface in bone coordinates. This transports
// the belly and its measured relief together instead of adding a second bulge.
// Joint centres, muscle origins and the distal bony insertion stay fixed.
class LimbSurface {
  constructor(figure, side, kind, subRest, atlas) {
    this.kind=kind; this.side=side;
    this.key=kind==='biceps'?'bicepInsertion':'calfInsertion';
    this.start=kind==='biceps'?0.18:0.04;
    this.end=kind==='biceps'?0.83:0.62;
    this.range=kind==='biceps'?[0.66,0.96]:[0.43,0.76];
    this.bone=kind==='biceps'?`upperarm01.${side}`:`lowerleg01.${side}`;
    this.tail=kind==='biceps'?`upperarm02.${side}`:`lowerleg02.${side}`;
    const sk=figure.skeleton;
    this.origin=sk.restHead(this.bone);
    this.axis=sk.restTail(this.tail).sub(this.origin);
    this.length=this.axis.length(); this.axis.normalize();
    this.front=new Vector3(0,0,1).addScaledVector(this.axis,-this.axis.z).normalize();
    this.lateral=new Vector3().crossVectors(this.axis,this.front).normalize();
    const part=kind==='biceps'?(side==='L'?2:3):(side==='L'?4:5);
    const mask=new Float32Array(figure.nCage);
    for(let v=0;v<mask.length;v++) mask[v]=figure.regions.bundlePartId[v]===part?1:0;
    const subMask=new Float32Array(figure.nSubVerts); figure.subdivideScalar(mask,subMask);
    const collect=(pos,gate)=>{
      const out=[];
      for(let v=0;v<gate.length;v++) {
        if(gate[v]<0.5) continue;
        const d=new Vector3().fromArray(pos,v*3).sub(this.origin);
        const t=d.dot(this.axis)/this.length;
        if(t<0.01||t>1.05) continue;
        const x=d.dot(this.front),y=d.dot(this.lateral);
        out.push({v,t,a:(Math.atan2(y,x)+TAU)%TAU,r:Math.hypot(x,y)});
      }
      return out;
    };
    this.cage=collect(figure.basePos,mask);
    this.sub=collect(subRest,subMask);
    this.cageStencil=this.stencil(this.cage);
    this.subStencil=this.stencil(this.sub);
    this.radius=new Float32Array(W*H);
    this.relief=new Float32Array(W*H);
    this.border=new Float32Array(W*H);
    this.cover=new Float32Array(W*H);
    const groups=kind==='biceps'?['biceps_long','biceps_short']:['gastroc_med','gastroc_lat'];
    const owners=groups.map(g=>atlas.groups.indexOf(g));
    const membership=Float32Array.from(atlas.owner,v=>owners.includes(v)?1:0);
    this.fill(this.subStencil,atlas.relief,this.relief);
    this.fill(this.subStencil,atlas.border,this.border);
    this.fill(this.subStencil,membership,this.cover);
    // The angular footprint is measured from the atlas. Extend that footprint
    // down the tendon corridor so shortening can actually empty the distal arm.
    this.arc=new Float32Array(H);
    for(let y=0;y<H;y++) for(let x=6;x<24;x++) this.arc[y]=Math.max(this.arc[y],this.cover[y*W+x]);
    for(let pass=0;pass<3;pass++) {
      const a=this.arc.slice();
      for(let y=0;y<H;y++) this.arc[y]=(a[(y+H-1)%H]+2*a[y]+a[(y+1)%H])*0.25;
    }
    this.currentRadius=new Float32Array(figure.nCage);
    this.radial=new Vector3(); this.head=new Vector3(); this.currentAxis=new Vector3();
    this.maxDelta=0;
  }

  stencil(points) {
    const idx=new Int32Array(W*H*4), weight=new Float32Array(idx.length);
    for(let y=0;y<H;y++) for(let x=0;x<W;x++) {
      const t=x/(W-1),a=y/H*TAU;
      const near=[Infinity,Infinity,Infinity,Infinity], ids=[0,0,0,0];
      for(const p of points) {
        const da=Math.min(Math.abs(a-p.a),TAU-Math.abs(a-p.a));
        const d=(t-p.t)**2+(da*0.19)**2;
        for(let k=0;k<4;k++) if(d<near[k]) {
          for(let j=3;j>k;j--) {near[j]=near[j-1];ids[j]=ids[j-1];}
          near[k]=d;ids[k]=p.v;break;
        }
      }
      const o=(y*W+x)*4; let sum=0;
      for(let k=0;k<4;k++) {idx[o+k]=ids[k];weight[o+k]=1/(near[k]+0.000015);sum+=weight[o+k];}
      for(let k=0;k<4;k++) weight[o+k]/=sum;
    }
    return {idx,weight};
  }
  fill(stencil,src,out) {
    for(let i=0;i<out.length;i++) {
      let sum=0;for(let k=0;k<4;k++) sum+=src[stencil.idx[i*4+k]]*stencil.weight[i*4+k];
      out[i]=sum;
    }
  }
  sample(field,t,a) {
    const x=clamp(t)*(W-1), y=((a/TAU)%1+1)%1*H;
    const ix=Math.min(W-2,Math.floor(x)),iy=Math.floor(y)%H;
    const fx=x-ix,fy=y-Math.floor(y),ny=(iy+1)%H;
    return lerp(lerp(field[iy*W+ix],field[iy*W+ix+1],fx),
      lerp(field[ny*W+ix],field[ny*W+ix+1],fx),fy);
  }
  arcAt(a) {
    const y=a/TAU*H,i=Math.floor(y)%H;
    return lerp(this.arc[i],this.arc[(i+1)%H],y-Math.floor(y));
  }
  configure(p,ctx) {
    const value=clamp(p[this.key]??0.5);
    this.targetEnd=value<0.5?lerp(this.range[0],this.end,value*2):lerp(this.end,this.range[1],value*2-1);
    this.stretch=(this.end-this.start)/(this.targetEnd-this.start);
    this.peak=this.kind==='biceps'?clamp(p.bicepPeak??0.5)-0.5:0;
    this.amount=clamp(1.12-ctx.fat*1.65,0.18,1)*(0.3+0.7*(this.kind==='biceps'?ctx.mass:ctx.legMass));
    this.enabled=!ctx.authored[this.key];
  }
  sourceT(t) { return this.start+(t-this.start)*this.stretch; }
  gate(t,a) {
    return this.arcAt(a)*smooth(this.start-0.04,this.start+0.12,t)*(1-smooth(0.90,1.0,t));
  }
  deform(cage,sk,p,ctx) {
    this.configure(p,ctx); if(!this.enabled) return;
    // Read the current morph's bone, not the neutral one's. Length and frame
    // controls must retain their own coordinates at both genetic extremes.
    sk.restHead(this.bone,this.head);
    sk.restTail(this.tail,this.currentAxis).sub(this.head);
    this.currentAxis.normalize();
    for(const pt of this.cage) {
      this.radial.fromArray(cage,pt.v*3).sub(this.head);
      this.radial.addScaledVector(this.currentAxis,-this.radial.dot(this.currentAxis));
      this.currentRadius[pt.v]=this.radial.length();
    }
    this.fill(this.cageStencil,this.currentRadius,this.radius);
    this.maxDelta=0;
    for(const pt of this.cage) {
      const gate=this.gate(pt.t,pt.a); if(gate<0.005) continue;
      const source=this.sourceT(pt.t);
      const floor=this.sample(this.radius,0.97,pt.a);
      const neutral=Math.max(0,this.sample(this.radius,pt.t,pt.a)-floor);
      const moved=Math.max(0,this.sample(this.radius,source,pt.a)-floor);
      // Shorter bellies gain height as their longitudinal extent shrinks.
      // Square-root compensation approximates equal cross-sectional volume.
      let delta=(moved*Math.sqrt(this.stretch)-neutral)*gate*this.amount;
      if (this.kind==='biceps') {
        // Transport a continuous fitted belly. Resampling the elbow's bony
        // prominence as muscle volume created a pointed shoulder-side ridge.
        const exponent=1.25+this.peak*1.3;
        const profile=t=>t<=0||t>=1?0:Math.sin(Math.PI*t)**exponent;
        const shaped=profile((pt.t-this.start)/(this.targetEnd-this.start));
        const amplitude=(0.14+ctx.mass*0.16)*Math.sqrt(exponent/1.25);
        const distal=this.sample(this.radius,0.90,pt.a);
        const foundation=distal*(0.86+0.12*(1-pt.t));
        const target=foundation+amplitude*shaped*Math.sqrt(this.stretch);
        const blend=this.arcAt(pt.a)*smooth(0.18,0.36,pt.t)*(1-smooth(.86,1,pt.t));
        delta=(target-this.currentRadius[pt.v])*blend*this.amount;
      }
      delta=clamp(delta,-0.30,0.30); // cage decimetres, at most 3 cm
      this.maxDelta=Math.max(this.maxDelta,Math.abs(delta)*10);
      this.radial.fromArray(cage,pt.v*3).sub(this.head);
      this.radial.addScaledVector(this.currentAxis,-this.radial.dot(this.currentAxis)).normalize();
      const o=pt.v*3;
      cage[o]+=this.radial.x*delta;cage[o+1]+=this.radial.y*delta;cage[o+2]+=this.radial.z*delta;
    }
  }
  transport(relief,border) {
    if(!this.enabled) return;
    for(const pt of this.sub) {
      const gate=this.gate(pt.t,pt.a)*this.amount;
      if(gate<0.005) continue;
      const t=this.sourceT(pt.t);
      const fade=1-smooth(this.targetEnd,this.targetEnd+0.10,pt.t);
      relief[pt.v]=lerp(relief[pt.v],this.sample(this.relief,t,pt.a)*fade,gate);
      border[pt.v]=lerp(border[pt.v],this.sample(this.border,t,pt.a)*fade,gate);
    }
  }
}

export class MuscleForms {
  constructor(figure,atlas) {
    const rest=figure.subdiv.run(figure.basePos).slice();
    figure.skeleton.rebuild(figure.basePos);
    this.limbs=[];
    for(const kind of ['biceps','calf']) for(const side of ['L','R'])
      this.limbs.push(new LimbSurface(figure,side,kind,rest,atlas));
    this.relief=atlas.relief.slice();this.border=atlas.border.slice();this.atlas=atlas;
    this.skeleton = new BodySkeleton(figure.bundle);
    this.envelope = this.buildEnvelope(figure, rest, atlas);
    this.rest = rest;
    this.scratch = new Float32Array(atlas.nSub);
  }
  buildEnvelope(figure, rest, atlas) {
    // Geodesic distance to the measured muscle border gives every structure
    // its own growth footprint. Neighbouring muscles cannot accumulate their
    // volume into the same dome, and tendon/bone territories receive no bulk.
    const adjacency=Array.from({length:atlas.nSub},()=>new Set());
    const q=figure.subQuads;
    for(let i=0;i<q.length;i+=4) for(let k=0;k<4;k++) {
      const a=q[i+k],b=q[i+(k+1)%4];adjacency[a].add(b);adjacency[b].add(a);
    }
    this.adjOff=new Uint32Array(atlas.nSub+1);
    for(let v=0;v<atlas.nSub;v++)this.adjOff[v+1]=this.adjOff[v]+adjacency[v].size;
    this.adjIdx=new Uint32Array(this.adjOff[atlas.nSub]);
    for(let v=0;v<atlas.nSub;v++)this.adjIdx.set([...adjacency[v]],this.adjOff[v]);
    const dist=new Float32Array(atlas.nSub).fill(100);
    const muscle=atlas.groups.map(g=>!g.endsWith('_b')&&!['it_band','sternomastoid'].includes(g));
    for(let v=0;v<dist.length;v++) {
      const owner=atlas.owner[v];
      if(owner<0||!muscle[owner]) {dist[v]=0;continue;}
      for(const w of adjacency[v]) if(atlas.owner[w]!==owner) {dist[v]=0;break;}
    }
    for(let pass=0;pass<18;pass++) {
      const old=dist.slice();
      for(let v=0;v<dist.length;v++) {
        if(!dist[v]||atlas.owner[v]<0) continue;
        for(const w of adjacency[v]) {
          if(atlas.owner[w]!==atlas.owner[v]) continue;
          const d=Math.hypot(rest[v*3]-rest[w*3],rest[v*3+1]-rest[w*3+1],rest[v*3+2]-rest[w*3+2])*10;
          dist[v]=Math.min(dist[v],old[w]+d);
        }
      }
    }
    const max=new Float32Array(atlas.groups.length);
    for(let v=0;v<dist.length;v++) if(atlas.owner[v]>=0&&dist[v]<99)
      max[atlas.owner[v]]=Math.max(max[atlas.owner[v]],dist[v]);
    const envelope=new Float32Array(atlas.nSub);
    const size={lat:0.50,pec_upper:0.55,pec_lower:0.45,deltoid_ant:0.85,deltoid_lat:1.05,
      deltoid_post:0.8,biceps_long:0.25,biceps_short:0.22,rectus_abs:0,
      serratus:0.5,obliques:0.35,vastus_med:2.5,vastus_lat:2.6,rectus_fem:2.8,
      gastroc_med:0.3,gastroc_lat:0.25};
    for(let v=0;v<dist.length;v++) {
      const owner=atlas.owner[v];if(owner<0||!muscle[owner]||dist[v]>=99)continue;
      envelope[v]=smooth(0,Math.max(0.5,Math.min(3,max[owner]*0.85)),dist[v])*(size[atlas.groups[owner]]??0.62);
    }
    for(let pass=0;pass<6;pass++) {
      const old=envelope.slice();
      for(let v=0;v<dist.length;v++) {
        if(!atlas.covered[v])continue;
        let sum=old[v]*2,n=2;for(const w of adjacency[v]){sum+=old[w];n++;}
        envelope[v]=sum/n;
      }
    }
    return envelope;
  }
  smoothSurface(field) {
    // A continuous skin layer bridges discrete atlas labels. Smooth only the
    // displacement, preserving the original face, fingers and body topology.
    for(let pass=0;pass<4;pass++) {
      this.scratch.set(field);
      for(let v=0;v<field.length;v++) {
        const start=this.adjOff[v],end=this.adjOff[v+1];if(start===end)continue;
        let sum=0;for(let i=start;i<end;i++)sum+=this.scratch[this.adjIdx[i]];
        field[v]=this.scratch[v]*0.45+sum/(end-start)*0.55;
      }
    }
  }
  deform(cage,figure,p,ctx) {
    this.skeleton.rebuild(cage);
    for(const limb of this.limbs) limb.deform(cage,this.skeleton,p,ctx);
    this.relief.set(this.atlas.relief);this.border.set(this.atlas.border);
    for(const limb of this.limbs) limb.transport(this.relief,this.border);
  }
}
