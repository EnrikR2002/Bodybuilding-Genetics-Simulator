/* Drives the real interface in Chromium: sliders, presets, the genetics
   lottery, comparisons, looks, poses, the numbers panel, share links and the
   phone layout. Screenshots land in shots/ for review. */
import assert from "node:assert/strict";
import fs from "node:fs";
import { PNG } from "pngjs";
import { withPage } from "./shots.mjs";
import { POSES } from "../src/freeman/poses.js";

fs.mkdirSync("shots", { recursive: true });

function visible(buffer) {
  const p = PNG.sync.read(buffer);
  let bright = 0;
  for (let i = 0; i < p.data.length; i += 4)
    if (p.data[i] > 95 && p.data[i + 1] > 70 && p.data[i + 2] > 50) bright++;
  assert.ok(bright > p.width * p.height * 0.025, "The canvas must contain a visible physique.");
}

async function framed(page) {
  const outside = await page.evaluate(() => {
    const p = __app.figure.root.position.clone();
    let out = 0;
    for (const f of [__app.figure, __app.comparison()].filter(Boolean)) {
      f.root.updateMatrixWorld(true);
      for (let v = 0; v < f.positions.length; v += 3) {
        p.fromArray(f.positions, v).applyMatrix4(f.root.matrixWorld).project(__app.stage.camera);
        if (Math.abs(p.x) >= 0.99 || Math.abs(p.y) >= 0.99) out++;
      }
    }
    return out;
  });
  assert.equal(outside, 0, "The whole posed surface must fit in the canvas");
}

/* A slider's readout updates on the next frame after the shape rebuild. */
const readout = (page, key, pattern) => page.waitForFunction(
  ([k, src]) => new RegExp(src).test(document.querySelector(`[data-key="${k}"] output`)?.textContent ?? ""),
  [key, pattern.source], { timeout: 10000 });
const noOverflow = (page) => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);

const errors = await withPage(async (page) => {
  const cv = page.locator("#cv");
  const initial = await cv.boundingBox();
  await page.waitForTimeout(300);
  assert.deepEqual(await cv.boundingBox(), initial, "Canvas size must settle without a resize loop.");
  visible(await cv.screenshot());
  await page.screenshot({ path: "shots/studio-default.png" });

  // a slider moves its trait continuously and updates its readout
  await page.fill("#t-bicepInsertion", "0");
  await readout(page, "bicepInsertion", /Short · 0/);
  assert.equal(await page.evaluate(() => __app.state().bicepInsertion), 0);
  await page.fill("#t-bicepInsertion", "37");
  await readout(page, "bicepInsertion", /· 37/);
  assert.equal(await page.evaluate(() => __app.state().bicepInsertion), 0.37);

  // compare extremes pins A at 0 and sets B to 1
  await page.click("#compare");
  await page.waitForTimeout(300);
  assert.deepEqual(await page.evaluate(() => [__app.comparison().snapshot.bicepInsertion, __app.state().bicepInsertion]), [0, 1]);
  assert.equal(await page.isVisible("#compare-labels"), true);
  await page.screenshot({ path: "shots/studio-compare.png" });

  // the pinned figure is isolated from further edits
  const saved = await page.evaluate(() => Array.from(__app.comparison().positions.subarray(0, 3000)));
  await page.fill("#t-bicepPeak", "100");
  await page.waitForTimeout(200);
  assert.deepEqual(await page.evaluate(() => Array.from(__app.comparison().positions.subarray(0, 3000))), saved);

  // overlay draws A as a ghost over B
  await page.click('#compare-mode [data-mode="overlay"]');
  assert.equal(await page.evaluate(() => __app.comparison().mesh.material === __app.comparison().materials.ghost), true);
  await page.screenshot({ path: "shots/studio-overlay.png" });
  await page.click('#compare-mode [data-mode="side"]');

  // looks
  await page.click('#surface [data-id="clay"]');
  assert.equal(await page.evaluate(() => __app.figure.mesh.material === __app.figure.clay), true);
  await page.click('#lighting [data-id="stage"]');
  assert.equal(await page.evaluate(() => __app.stage.lighting), "stage");
  await page.click("#pin");
  assert.equal(await page.evaluate(() => __app.comparison()), null, "Clear comparison removes A");

  // presets and the genetics lottery
  await page.selectOption("#preset", "mass");
  assert.equal(await page.evaluate(() => __app.state().mass), 1);
  await page.click("#roll");
  await page.waitForTimeout(200);
  assert.ok((await page.locator(".pct:not([hidden])").count()) > 10, "Rolled traits show their percentile");

  // every pose, framed
  await page.click("#fit");
  for (const { id } of POSES) {
    await page.click(`#poses [data-pose="${id}"]`);
    await page.waitForTimeout(120);
    assert.equal(await page.evaluate(() => __app.figure.pose), id);
    await framed(page);
    visible(await cv.screenshot());
  }

  // numbers
  await page.click('[data-tab="numbers"]');
  await page.waitForTimeout(300);
  const numbers = await page.textContent("#metrics");
  for (const word of ["FFMI", "Adonis", "Tape", "Genetic ceiling", "Biceps belly ends"]) assert.ok(numbers.includes(word), word);
  await page.screenshot({ path: "shots/studio-numbers.png" });
  await page.click('[data-tab="traits"]');

  // the link restores the physique
  await page.click("#reset");
  await page.evaluate(() => __app.set({ bicepInsertion: 0.2, latInsertion: 0.9 }));
  await page.waitForTimeout(600);
  const url = page.url();
  assert.ok(url.includes("#"), "State is written to the URL hash");
  await page.goto("about:blank");
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForFunction("window.__ready === true", null, { timeout: 120000 });
  assert.deepEqual(await page.evaluate(() => [__app.state().bicepInsertion, __app.state().latInsertion]), [0.2, 0.9]);

  // phone layout
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(300);
  assert.equal(await noOverflow(page), true, "No horizontal overflow on a phone");
  visible(await cv.screenshot());
  await page.screenshot({ path: "shots/studio-mobile.png", fullPage: true });
  await page.click("#compare");
  await page.waitForTimeout(300);
  assert.equal(await noOverflow(page), true);
}, { width: 1440, height: 1000 });

assert.deepEqual(errors, []);
console.log("Sliders, presets, lottery, comparisons, looks, poses, numbers, share link and phone layout checks passed.");
