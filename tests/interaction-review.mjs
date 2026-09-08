import assert from 'node:assert/strict';
import { withPage } from './shots.mjs';

const errors=await withPage(async page=>{
  await page.click('#compareBiceps');
  await page.waitForFunction(()=>document.querySelector('#studyStatus').textContent.startsWith('Left: short'));
  await page.evaluate(()=>__app.callouts(true));
  await page.waitForTimeout(900);
  assert.equal(await page.locator('.callout').count(),6);
  await page.locator('#s_clavicle').evaluate(input=>{
    input.value='0.25';input.dispatchEvent(new Event('input',{bubbles:true}));
  });
  await page.waitForTimeout(500);
  assert.match(await page.locator('#studyStatus').textContent(),/pinned physique/);
  assert.notEqual(await page.evaluate(()=>__app.comparison().snapshotParams.clavicle),.25);
  await page.evaluate(()=>__app.pose('sideChest'));
  await page.waitForTimeout(1000);
  assert.equal(await page.evaluate(()=>[...document.querySelectorAll('.callout')]
    .every(el=>!el.style.top.includes('NaN')&&!el.style.left.includes('NaN'))),true);
  await page.screenshot({path:'shots/comparison-callouts.png'});
  await page.evaluate(()=>{__app.callouts(false);__app.pin();});
  console.log('BENCH',await page.evaluate(()=>__app.bench(10)));
});

const mobileErrors=await withPage(async page=>{
  await page.click('[data-belly="0"]');
  await page.waitForTimeout(800);
  await page.selectOption('#surfaceMode','clay');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.screenshot({path:'shots/mobile-biceps-study.png'});
},{width:430,height:900});
if(errors.length||mobileErrors.length){console.error([...errors,...mobileErrors]);process.exitCode=1;}
else console.log('Callouts, comparison edits and mobile layout passed.');
