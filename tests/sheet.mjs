/* Build a contact sheet from shots/ so a whole round of changes can be
   reviewed in one look instead of one file at a time.

   node tests/sheet.mjs <prefix> <out.png> <columns>
*/
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SHOTS = path.join(ROOT, 'shots');
const argv = process.argv.slice(2);
const pattern = argv[0] || 'v-';
const out = argv[1] || 'sheet.png';
const cols = +(argv[2] || 5);

const files = fs.readdirSync(SHOTS)
  .filter(f => f.startsWith(pattern) && f.endsWith('.png') && f !== out)
  .sort();
if (!files.length) { console.log('no shots match ' + pattern); process.exit(0); }

const url = f => 'file:///' + path.join(SHOTS, f).split(path.sep).join('/');
const html =
  `<style>body{margin:0;background:#101018;display:grid;` +
  `grid-template-columns:repeat(${cols},1fr);gap:2px}` +
  `figure{margin:0;position:relative}img{width:100%;display:block}` +
  `figcaption{position:absolute;left:0;bottom:0;background:rgba(0,0,0,.7);` +
  `color:#eee;font:11px monospace;padding:2px 4px}</style>` +
  files.map(f =>
    `<figure><img src="${url(f)}"><figcaption>${f.replace('.png', '')}</figcaption></figure>`
  ).join('');

const sheetHtml = path.join(SHOTS, '_sheet.html');
fs.writeFileSync(sheetHtml, html);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1900, height: 1200 }, deviceScaleFactor: 1 });
await page.goto('file:///' + sheetHtml.split(path.sep).join('/'));
await page.waitForTimeout(800);
await page.screenshot({ path: path.join(SHOTS, out), fullPage: true });
await browser.close();
console.log(`wrote shots/${out}  (${files.length} images)`);
