/* ---------------------------------------------------------------------------
   The stage: environment, lights, floor and the post chain.

   A studio HDRI does more for how real a body looks than any number of hand
   placed lights. It gives the skin something to reflect that has shape —
   a soft box above, a darker floor below, warm walls — so the highlight along
   a shoulder is an actual reflection rather than a white dot.

   The three directional lights on top of it are there for shape, not for
   brightness: a key that carves the muscle separations, a cool fill so the
   shadow side does not go dead, and a warm rim that lifts the figure off the
   backdrop.
   --------------------------------------------------------------------------- */
import {
  Scene, PerspectiveCamera, WebGLRenderer, DirectionalLight, Color, Mesh,
  CircleGeometry, ShadowMaterial, PMREMGenerator, ACESFilmicToneMapping,
  SRGBColorSpace, PCFSoftShadowMap, Vector2, MeshBasicMaterial, CanvasTexture,
  EquirectangularReflectionMapping, Fog, DoubleSide,
} from 'three';
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { SMAAPass } from 'three/examples/jsm/postprocessing/SMAAPass.js';

export class Stage {
  constructor(canvas, { hdri = '/env/studio.hdr', quality = 1 } = {}) {
    this.renderer = new WebGLRenderer({
      canvas, antialias: false, alpha: false, powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, quality >= 1 ? 2 : 1.25));
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.84;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = PCFSoftShadowMap;

    this.scene = new Scene();
    this.scene.background = backdrop();
    this.camera = new PerspectiveCamera(30, 1, 4, 3000);

    /* ---- lights ---- */
    /* A harder key and less ambient wash. Filling a body evenly from every
       direction is what flattens it: the shape of a muscle is the shadow it
       casts on the one next to it. */
    const key = new DirectionalLight(0xfff7ee, 2.18);
    key.position.set(165, 245, 120);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    Object.assign(key.shadow.camera, { left: -140, right: 140, top: 250, bottom: -30, near: 60, far: 800 });
    /* normalBias pushes the shadow lookup along the surface normal, which is
       what stops a curved body self-shadowing into stripes */
    key.shadow.bias = -0.0004;
    key.shadow.normalBias = 1.4;
    key.shadow.radius = 3;
    this.scene.add(key);
    this.key = key;

    const fill = new DirectionalLight(0x7f95d4, 0.20);
    fill.position.set(-220, 120, 130);
    this.scene.add(fill);

    const rim = new DirectionalLight(0xffbe93, 0.82);
    rim.position.set(-90, 190, -230);
    this.scene.add(rim);

    const rim2 = new DirectionalLight(0xb9c4ff, 0.42);
    rim2.position.set(225, 150, -160);
    this.scene.add(rim2);

    /* ---- floor: catches the shadow, plus a pool of warm light ---- */
    const floor = new Mesh(new CircleGeometry(320, 64), new ShadowMaterial({ opacity: 0.46 }));
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    this.scene.add(floor);
    this.scene.add(lightPool());

    this.envReady = this._loadEnv(hdri);
    this._buildComposer(quality);
  }

  async _loadEnv(url) {
    const pmrem = new PMREMGenerator(this.renderer);
    pmrem.compileEquirectangularShader();
    try {
      const tex = await new RGBELoader().loadAsync(url);
      tex.mapping = EquirectangularReflectionMapping;
      this.scene.environment = pmrem.fromEquirectangular(tex).texture;
      this.scene.environmentIntensity = 0.56;
      tex.dispose();
    } catch (e) {
      console.warn('HDRI missing, falling back to a painted environment', e);
      const tex = paintedEnv();
      this.scene.environment = pmrem.fromEquirectangular(tex).texture;
      tex.dispose();
    }
    pmrem.dispose();
    return true;
  }

  _buildComposer(quality) {
    const { renderer, scene, camera } = this;
    const composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));

    if (quality >= 1) {
      /* Ground-truth ambient occlusion. This is what puts real darkness in
         the armpit, between the pec and the delt, and under the glute —
         places the light probe alone leaves flat. */
      const gtao = new GTAOPass(scene, camera, 1, 1);
      gtao.output = GTAOPass.OUTPUT.Default;
      gtao.blendIntensity = 1.0;
      /* radius is in world units, and this scene measures in centimetres:
         6 cm is about the width of the gap between a pec and a front delt,
         which is exactly the scale of shadow a physique needs */
      gtao.updateGtaoMaterial({
        radius: 6.0, distanceExponent: 1.6, thickness: 4.0,
        scale: 2.2, samples: 16, distanceFallOff: 0.6, screenSpaceRadius: false,
      });
      gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3.5, radius: 4, rings: 2, samples: 16 });
      composer.addPass(gtao);
      this.gtao = gtao;
    }

    const bloom = new UnrealBloomPass(new Vector2(1, 1), 0.12, 0.72, 0.90);
    composer.addPass(bloom);
    this.bloom = bloom;

    composer.addPass(new OutputPass());
    if (quality >= 1) composer.addPass(new SMAAPass(1, 1));
    this.composer = composer;
  }

  setSize(w, h) {
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.composer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  /* flip the AO pass to show only what it computes — used to check the
     occlusion is really landing in the armpits and not just tinting */
  debugAO(on) {
    if (!this.gtao) return;
    this.gtao.output = on ? GTAOPass.OUTPUT.Denoise : GTAOPass.OUTPUT.Default;
  }

  render() { this.composer.render(); }
}

/* the seamless backdrop the figure stands against */
function backdrop() {
  const c = document.createElement('canvas');
  c.width = 8; c.height = 256;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0.00, '#2b2537');
  grad.addColorStop(0.34, '#221d2c');
  grad.addColorStop(0.72, '#131019');
  grad.addColorStop(1.00, '#0a080d');
  g.fillStyle = grad;
  g.fillRect(0, 0, 8, 256);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}

function lightPool() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const x = c.getContext('2d');
  const g = x.createRadialGradient(128, 128, 8, 128, 128, 126);
  g.addColorStop(0, 'rgba(255,222,186,0.42)');
  g.addColorStop(0.55, 'rgba(255,205,160,0.14)');
  g.addColorStop(1, 'rgba(255,205,160,0)');
  x.fillStyle = g;
  x.fillRect(0, 0, 256, 256);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  const m = new Mesh(new CircleGeometry(230, 64),
    new MeshBasicMaterial({ map: t, transparent: true, depthWrite: false, side: DoubleSide }));
  m.rotation.x = -Math.PI / 2;
  m.position.y = 0.5;
  return m;
}

/* used only if the HDRI cannot be fetched */
function paintedEnv() {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 256;
  const x = c.getContext('2d');
  const g = x.createLinearGradient(0, 0, 0, 256);
  g.addColorStop(0, '#4a4256'); g.addColorStop(0.44, '#6b6178');
  g.addColorStop(0.58, '#241f2b'); g.addColorStop(1, '#0b0910');
  x.fillStyle = g; x.fillRect(0, 0, 512, 256);
  const blob = (cx, cy, r, col) => {
    const rg = x.createRadialGradient(cx, cy, 1, cx, cy, r);
    rg.addColorStop(0, col); rg.addColorStop(1, 'rgba(0,0,0,0)');
    x.fillStyle = rg; x.fillRect(0, 0, 512, 256);
  };
  blob(128, 52, 104, '#fff6e4');
  blob(392, 68, 88, '#ffb277');
  blob(280, 220, 120, '#241d2c');
  const t = new CanvasTexture(c);
  t.mapping = EquirectangularReflectionMapping;
  return t;
}
