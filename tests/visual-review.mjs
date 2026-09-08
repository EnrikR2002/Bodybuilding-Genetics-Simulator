import assert from 'node:assert/strict';
import fs from 'node:fs';
import { withPage, runSteps } from './shots.mjs';

const errors = await withPage(async page => {
  for (const script of ['relief','torso','range','lat-authored','pose-review','muscle-study']) {
    const steps = JSON.parse(fs.readFileSync(`tests/scripts/${script}.json`,'utf8'));
    await runSteps(page, steps);
  }
  await page.evaluate(() => {
    __app.set({ mass:.8, bodyFat:.1, bicepPeak:.8 });
    __app.studyBiceps(0);
    __app.surface('skin');
  });
  await page.waitForTimeout(1200);
  await page.evaluate(() => __app.pin());
  const comparison = await page.evaluate(() => {
    const f=__app.figure, c=__app.comparison();
    let delta=0;
    for(let i=0;i<f.rPos.length;i++) delta=Math.max(delta,Math.abs(f.rPos[i]-c.rPos[i]));
    return {delta, atlas:!!c.regions.anatomy.atlas, opacity:c.mesh.material.opacity};
  });
  assert.ok(comparison.delta<0.001,'identical states must produce identical comparison geometry');
  assert.equal(comparison.atlas,true);
  assert.equal(comparison.opacity,1);
  await page.evaluate(() => __app.pin());
  await page.click('#compareBiceps');
  await page.waitForFunction(() => !document.querySelector('#btnPin').disabled &&
    document.querySelector('#studyStatus').textContent.startsWith('Left:'));
  await page.waitForTimeout(1200);
  const pair=await page.evaluate(()=>({
    short:__app.comparison().snapshotParams.bicepInsertion,
    long:+document.getElementById('s_bicepInsertion').value,
    x:__app.figure.root.position.x,
  }));
  assert.equal(pair.short,0);assert.equal(pair.long,1);assert.ok(pair.x>0);
  await page.screenshot({path:'shots/biceps-comparison-skin.png'});
  await page.selectOption('#surfaceMode','clay');
  await page.waitForTimeout(350);
  await page.screenshot({path:'shots/biceps-comparison-clay.png'});
  await page.selectOption('#surfaceMode','anatomy');
  await page.waitForTimeout(350);
  await page.screenshot({path:'shots/anatomy-reference-pair.png'});
  await page.evaluate(() => __app.pin());
  await page.selectOption('#surfaceMode','skin');
  await page.selectOption('#skinTone','3');
  await page.waitForTimeout(350);
  await page.screenshot({path:'shots/skin-deep.png'});
  console.log('BENCH',await page.evaluate(()=>__app.bench(10)));
  console.log('Comparison and display assertions passed.');
});
if(errors.length) { console.error(errors.join('\n'));process.exitCode=1; }
