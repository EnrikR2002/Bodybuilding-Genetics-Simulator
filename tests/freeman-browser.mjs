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
  assert.ok(
    bright > p.width * p.height * 0.025,
    "The canvas must contain a visible physique.",
  );
}
async function framed(page) {
  const outside = await page.evaluate(() => {
    const p = __app.figure.root.position.clone();
    let outside = 0;
    for (const f of [__app.figure, __app.comparison()].filter(Boolean)) {
      f.root.updateMatrixWorld(true);
      for (let v = 0; v < f.positions.length; v += 3) {
        p.fromArray(f.positions, v).applyMatrix4(f.root.matrixWorld).project(__app.stage.camera);
        if (Math.abs(p.x) >= 0.99 || Math.abs(p.y) >= 0.99) outside++;
      }
    }
    return outside;
  });
  assert.equal(outside, 0, "The entire posed surface must fit in the canvas");
}
const errors = await withPage(
  async (page) => {
    const cv = page.locator("#cv");
    const initial = await cv.boundingBox();
    await page.waitForTimeout(300);
    assert.deepEqual(
      await cv.boundingBox(),
      initial,
      "Canvas size must settle, without a resize feedback loop.",
    );
    visible(await cv.screenshot());
    await page.screenshot({ path: "shots/studio-default.png" });
    await page.click('[data-key="bicepInsertion"][data-value="0"]');
    assert.equal(
      await page.getAttribute(
        '[data-key="bicepInsertion"][data-value="0"]',
        "aria-pressed",
      ),
      "true",
    );
    await page.click("#compare");
    assert.deepEqual(
      await page.evaluate(() => [
        __app.comparison().state.bicepInsertion,
        __app.state().bicepInsertion,
      ]),
      [0, 1],
    );
    await page.click("#focus");
    await page.screenshot({ path: "shots/studio-biceps.png" });
    const snapshot = await page.evaluate(() =>
      Array.from(__app.comparison().positions),
    );
    await page.click('[data-key="bicepPeak"][data-value="1"]');
    assert.deepEqual(
      await page.evaluate(() => Array.from(__app.comparison().positions)),
      snapshot,
    );
    await page.selectOption("#surfaceMode", "clay");
    assert.equal(
      await page.evaluate(
        () =>
          __app.figure.mesh.material === __app.figure.clay &&
          __app.comparison().mesh.material === __app.comparison().clay,
      ),
      true,
    );
    await page.click('[data-view="-90"]');
    visible(await cv.screenshot());
    await page.click("#reset");
    assert.deepEqual(
      await page.evaluate(() => __app.figure.root.position.toArray()),
      [0, 0, 0],
      "Clearing an orbited comparison recentres the figure",
    );
    await page.click('[data-key="calfInsertion"][data-value="0"]');
    await page.click("#compare");
    await page.click("#focus");
    await page.screenshot({ path: "shots/studio-calves.png" });
    await page.click("#reset");
    await page.click('[data-tab="frame"]');
    await page.click('[data-key="clavicle"][data-value="1"]');
    assert.equal(await page.evaluate(() => __app.state().clavicle), 1);
    await page.click("#compare");
    assert.deepEqual(
      await page.evaluate(() => [
        __app.comparison().state.clavicle,
        __app.state().clavicle,
      ]),
      [0, 1],
      "Compare the selected frame trait",
    );
    await page.screenshot({ path: "shots/studio-frame.png" });
    await page.click("#reset");
    await page.click('[data-tab="condition"]');
    await page.click('[data-key="bodyFat"][data-value="1"]');
    await page.screenshot({ path: "shots/studio-soft.png" });
    await page.click("#reset");
    await page.selectOption("#surfaceMode", "skin");
    await page.click('[data-view="180"]');
    await page.screenshot({ path: "shots/studio-back.png" });
    await page.click("#reset");
    for (const { id, view } of POSES.filter(p => p.upper)) {
      await page.selectOption("#poseSelect", id);
      assert.equal(await page.evaluate(() => __app.figure.pose), id);
      assert.equal(await page.locator(`[data-view="${view}"]`).getAttribute("class"), "active");
      await page.waitForTimeout(100);
      await framed(page);
      visible(await cv.screenshot());
      await page.screenshot({ path: `shots/studio-pose-${id}.png` });
    }
    await page.selectOption("#poseSelect", "frontDouble");
    await page.click("#compare");
    assert.deepEqual(await page.evaluate(() => [__app.figure.pose, __app.comparison().pose]),
      ["frontDouble", "frontDouble"], "Comparison retains the selected bodybuilding pose");
    for (const view of [0, -90, 180]) {
      await page.click(`[data-view="${view}"]`);
      await page.waitForTimeout(100);
      await framed(page);
    }
    await page.selectOption("#poseSelect", "rearLat");
    await page.selectOption("#surfaceMode", "clay");
    await page.screenshot({ path: "shots/studio-pose-comparison.png" });
    await page.click("#reset");
    await page.evaluate(() => __app.set({ clavicle: 1, armLength: 1, ribcage: 1, mass: 1, backThickness: 1 }));
    await page.selectOption("#poseSelect", "frontDouble");
    await framed(page);
    await page.screenshot({ path: "shots/studio-pose-developed.png" });
    await page.click("#reset");
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(200);
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
      "No horizontal overflow on mobile",
    );
    visible(await cv.screenshot());
    await page.screenshot({ path: "shots/studio-mobile.png", fullPage: true });
    await page.click("#compare");
    visible(await cv.screenshot());
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
    );
    for (const { id } of POSES.filter(p => p.upper)) {
      await page.selectOption("#poseSelect", id);
      await page.waitForTimeout(100);
      await framed(page);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    }
    await page.screenshot({ path: "shots/studio-pose-mobile.png", fullPage: true });
  },
  { width: 1440, height: 1080 },
);
assert.deepEqual(errors, []);
console.log(
  "Desktop, mobile, rendered model, preset controls, comparison isolation, materials and camera checks passed.",
);
