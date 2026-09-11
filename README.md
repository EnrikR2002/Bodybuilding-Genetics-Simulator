# Insertion — Physique Studio

A studio tool for seeing how genetics shape a physique: where each muscle
starts and stops, and the skeleton it hangs on. Change one trait and see
exactly what it changes, measured off a real anatomical sculpt.

The figure is the **Mike Freeman sculpt by Péter Józsa Jr. (PixelPete)**, CC0:
154,442 vertices of hand-sculpted anatomy. A muscle map projected from the
**Z-Anatomy** dissection tells every trait which muscle each point of the skin
belongs to, so an insertion trait moves the sculpted belly the artist made,
not a generic bump.

## Run

```sh
npm install
npm run dev
```

Open **http://localhost:5188**. Everything the app needs is in the repository.

## What you can do

- **23 traits on continuous sliders**, grouped as *given* (set at birth) and
  *earned* (training and diet):
  - Insertions: biceps belly length and peak, triceps long head, sternal gap,
    ab alignment, ab segments (four / six / eight), lat insertion, trap height,
    quad teardrop, calf insertion.
  - Frame: clavicle width, rib cage, pelvis width, waist width, torso, arm and
    leg length, joint size, head size.
  - Development and condition: upper-body mass, back density, leg mass, body fat.
  Each slider has a notch at the sculpt's own value; double-click to return.
- **Twelve poses**, including all the mandatory bodybuilding poses, with real
  fists and flexed biceps.
- **Compare**: pin a physique as A and keep editing B, side by side or with A
  drawn as a contour ghost over B. *Compare extremes* shows one trait at both
  ends in the pose and view that show it best.
- **Looks**: studio, competition stage, dramatic and clinical lighting; skin,
  stage tan with oil, sculpt clay and a colour-coded muscle map. Hovering a
  trait highlights the muscles it is about.
- **Numbers**: height, weight from the body's volume, body fat, FFMI, the Adonis
  index and other ratios, a tape measure taken off the real surface, Casey
  Butt's and John McCallum's published targets, insertion readouts (for example
  how far above the elbow the biceps belly ends) and judge's notes. Labels on
  the body show the active trait's measurement.
- **Archetypes** and a **Roll genetics** button that draws every given trait
  from a bell curve and shows its percentile.
- **Share**: the address bar always holds the full physique, pose and look;
  *Copy link* shares it, *Export PNG* saves the view. Press **?** for shortcuts.

The presets are archetypes, not measurements of any real person, and the
numbers describe this sculpt, not a prediction of anyone's potential. See
[the measurement notes](docs/MEASUREMENTS.md) for every formula and its source.

## Check it

```sh
npm test               # model, anatomy map, measurements, poses, frame
npm run test:browser   # drives the real interface on desktop and a phone
npm run build
```

`npm run test:browser` needs Playwright's Chromium
(`npx playwright install chromium`). Screenshots go to `shots/`; for example
`npm run shots -- --script tests/scripts/insertions.json --w 1400 --h 1000`
renders every insertion trait at both ends.

## Rebuild the data

- `npm run bake` re-bakes the rig and skin weights from the sculpt in Blender
  (`BLENDER_PATH` or `.tools/blender-runtime/`). The surface and vertex order
  are checked byte for byte against the previous bake.
- `npm run anatomy:freeman` re-projects the Z-Anatomy atlas onto the sculpt;
  it needs the atlas in `.assets-cache/`. See [the anatomy map notes](docs/ANATOMY_MAP.md).

How the code is organised, and the rules every change keeps, are in
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Credits

- Sculpt: Péter Józsa Jr., CC0 ([licence](public/models/freeman-LICENSE.txt), [notes](assets-src/mike-freeman/README.md)).
- Muscle map: derived from Z-Anatomy (CC BY-SA 4.0) and BodyParts3D, DBCLS
  (CC BY-SA 2.1 Japan); see [its licence](public/models/freeman-anatomy-LICENSE.txt).
