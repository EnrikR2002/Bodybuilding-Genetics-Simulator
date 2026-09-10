# Insertion — Physique Studio

An interactive study of how muscle belly length and skeletal proportions change a physique. The current app uses the **Mike Freeman sculpt by Péter Józsa Jr. (PixelPete)**, supplied in the project ZIP and released by its author under CC0.

The old MakeHuman figure has been replaced in the main app by the actual Freeman surface: 154,442 vertices and 308,864 triangles. The chest, abdominal wall, back, quadriceps, calves and forearms come from that sculpt. The neutral lean preset retains its original surface.

## Run

```sh
npm install
npm run dev
```

Open **http://localhost:5188**. The runtime mesh and studio environment are included; no MCP, account, downloaded fonts or Blender installation is needed to run the app.

## Explore

- **Muscles:** short/medium/long biceps and calf bellies, biceps profile, lat sweep, sternal gap, abdominal alignment and trap profile.
- **Frame:** three presets for shoulder spacing, rib cage, pelvis width, torso length, arm length and leg length.
- **Condition:** upper-body, leg and back development, plus lean/moderate/soft definition.
- **Compare extremes:** compare the lowest and highest preset of the selected muscle, frame or condition trait while keeping every other trait the same.
- **Pin current physique:** keep a snapshot while changing the current figure. Both use the same surface, pose, scale and viewing angle.
- **Inspect arms / calves:** focus the camera on the selected region. Drag to orbit, scroll or pinch to zoom, and use **Fit to view** to return to the full physique.
- **Pose:** anatomy stance, flexed arms, front/back double biceps, and front/rear lat spreads. Rear poses open at the back view; orbit to inspect any angle. Pinned comparisons follow the selected pose. **Skin / Neutral sculpt** provides two ways to read the surface.

Biceps *belly length* is distinct from the anatomically named short and long heads. These presets illustrate surface variation; they are not measurements of Arnold Schwarzenegger, Sergio Oliva or another person. See [the model and quality notes](docs/ANATOMY_QUALITY.md) for the approximation boundaries.

## Validate

```sh
npm test
npm run test:browser
npm run build
```

Browser checks require Playwright Chromium (`npx playwright install chromium` if it is not installed). They exercise the real controls on desktop and mobile, check that the canvas actually contains a visible model, and save screenshots under `shots/`. `npm run shots -- --label review --views front,side,back,threeq` captures additional views.

`npm run shots -- --script tests/scripts/freeman-poses.json --w 1200 --h 1000` captures the four bodybuilding poses and a side inspection. See the [pose review](docs/POSE_REVIEW.md) for visual findings and remaining model improvements.

## Rebuild the sculpt

The original archive has been extracted into `assets-src/mike-freeman/source/`. Keep its author licence alongside the Blender file. To regenerate the runtime mesh and rig:

```sh
npm run bake
```

The script uses `BLENDER_PATH`, the local `.tools/blender-runtime/` installation, or `blender` on PATH. The bake evaluates the original multiresolution sculpt at level 2, creates the measured inspection rig and weights, and exports a softened surface target for the definition presets. It does not overwrite the original Blender file.

Current app code lives in `src/freeman/`; the shared renderer lives in `src/render/`. The previous MakeHuman pipeline remains available in the repository for reference and under `npm run bake:legacy` / `npm run test:legacy`. It is not imported by the current app. Its old pose scripts and interaction reviews target the legacy interface.

## Attribution

[Freeman asset and licence](assets-src/mike-freeman/README.md). The original author licence is also distributed as `public/models/freeman-LICENSE.txt`. The studio environment and legacy assets retain their existing source notices.
