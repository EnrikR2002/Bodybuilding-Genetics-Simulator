/* ---------------------------------------------------------------------------
   Screenshot loop.

   Starts (or reuses) the dev server, drives the page through a list of steps,
   and writes PNGs to shots/ so the figure can actually be looked at after every
   change. Nothing here asserts — the point is images to inspect.

   node tests/shots.mjs --label lean --views front,side,back,threeq
   node tests/shots.mjs --script tests/scripts/insertions.json
   --------------------------------------------------------------------------- */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SHOTS = path.join(ROOT, 'shots');
const PORT = 5188;

const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf('--' + k); return i < 0 ? d : argv[i + 1]; };
const has = k => argv.includes('--' + k);

export const VIEW_AZ = { front: 0, side: -90, sideL: 90, back: 180, threeq: -38, threeqL: 38 };

async function ping() {
  try { const r = await fetch(`http://localhost:${PORT}/`); return r.ok; } catch { return false; }
}

export async function withPage(fn, { width = 900, height = 1150, page: entry = '/' } = {}) {
  let server = null;
  if (!(await ping())) {
    server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'],
      { cwd: ROOT, shell: true, stdio: ['ignore', 'pipe', 'pipe'] });
    server.stderr.on('data', d => process.stderr.write('[vite] ' + d));
    const t0 = Date.now();
    while (Date.now() - t0 < 60000) {
      await new Promise(r => setTimeout(r, 250));
      if (await ping()) break;
    }
    if (!(await ping())) { server.kill(); throw new Error('vite did not start'); }
  }

  const browser = await chromium.launch({
    args: ['--use-gl=angle', '--use-angle=default', '--enable-unsafe-swiftshader',
           '--ignore-gpu-blocklist', '--enable-gpu-rasterization'],
  });
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 2 });
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('CONSOLE ' + m.text()); });
  try {
    await page.goto(`http://localhost:${PORT}${entry}`, { waitUntil: 'load' });
    await page.waitForFunction('window.__ready === true', null, { timeout: 60000 });
    await page.waitForTimeout(400);
    await fn(page, errors);
  } catch (e) {
    errors.push('THREW ' + String(e.message || e).split('\n')[0]);
  } finally {
    await browser.close();
    if (server) { try { server.kill(); } catch {} }
  }
  return errors;
}

/* one step: {label, set:{sliders}, pose:'id', view:'front'|deg, el, zoom, target} */
export async function runSteps(page, steps, dir = SHOTS) {
  fs.mkdirSync(dir, { recursive: true });
  const written = [];
  for (const s of steps) {
    if (s.set !== undefined) await page.evaluate(o => (window.__app || window).__set?.(o) ?? window.__app?.set(o), s.set || {});
    if (s.pose) await page.evaluate(a => window.__app?.pose(a[0], a[1]) ?? window.__pose?.(a[0]), [s.pose, s.over || null]);
    if (s.callouts !== undefined) await page.evaluate(v => window.__app?.callouts(v), s.callouts);
    if (s.pin) await page.evaluate(() => window.__app?.pin());
    if (s.bg !== undefined) await page.evaluate(v => window.__app?.bg(v), s.bg);
    if (s.regions !== undefined) await page.evaluate(v => window.__app?.debugRegions(v), s.regions);
    if (s.bench) console.log('BENCH ' + JSON.stringify(await page.evaluate(() => window.__app.bench())));
    if (s.probe) console.log('PROBE ' + JSON.stringify(await page.evaluate(() => window.__app.headProbe())));
    if (s.mat) await page.evaluate(m => window.__mat && window.__mat(m), s.mat);
    if (s.settle) await page.waitForTimeout(s.settle);
    const az = typeof s.view === 'number' ? s.view : (VIEW_AZ[s.view] ?? 0);
    await page.evaluate(a => {
      if (window.__app) window.__app.view(a[0], a[1], a[2], a[3]);
      else window.__setView(a[0], a[1], a[2], a[3]);
    }, [az, s.el ?? 0.05, s.zoom ?? 1, s.target ?? null]);
    await page.waitForTimeout(s.wait ?? 220);
    const f = path.join(dir, s.label + '.png');
    await page.screenshot({ path: f, clip: s.clip });
    written.push(f);
    console.log('wrote ' + path.relative(ROOT, f));
    if (s.report) {
      const m = await page.evaluate(k => {
        const i = window.__app.info();
        return Object.fromEntries(k.map(x => [x, typeof i[x] === 'number' ? +i[x].toFixed(1) : i[x]]));
      }, s.report);
      console.log('  ' + s.label + ' ' + JSON.stringify(m));
    }
  }
  return written;
}

if (process.argv[1].endsWith('shots.mjs')) {
  const W = +arg('w', 900), H = +arg('h', 1150);
  let steps;
  const scriptFile = arg('script', null);
  if (scriptFile) {
    steps = JSON.parse(fs.readFileSync(path.resolve(ROOT, scriptFile), 'utf8'));
  } else {
    const label = arg('label', 'shot');
    steps = arg('views', 'front,side,back,threeq').split(',')
      .map(v => ({ label: `${label}-${v}`, view: v, set: {} }));
  }
  const errors = await withPage(async page => {
    await runSteps(page, steps);
    const info = await page.evaluate(() => window.__app?.info?.() ?? window.__info?.() ?? null);
    if (info) console.log(JSON.stringify(info));
  }, { width: W, height: H, page: arg('page', '/') });
  if (errors.length) { console.log('\n--- page errors ---'); errors.forEach(e => console.log(e)); }
}
