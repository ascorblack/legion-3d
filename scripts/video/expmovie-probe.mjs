// Camera probe for the expmovie sources: ONE page per source (SwiftShader), many camera variants on it.
//   node scripts/video/expmovie-probe.mjs --seg=x-b-desert --at=2 --cams='[{"fit":true,"d":[[0,1]]},…]' [--w=640 --h=360]
// → video/expmovie/probe/<seg>-c<i>.jpg (+ a contact sheet <seg>-cams.jpg). The variant is set as window.__xmCam
// (read by expmovie.ts pose()), held from t = at.
import { chromium } from 'playwright-core';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url)), ROOT = resolve(here, '../..');
const opt = Object.fromEntries(process.argv.slice(2).map((a) => { const m = /^--([^=]+)=(.*)$/s.exec(a); return m ? [m[1], m[2]] : [a.replace(/^--/, ''), '1']; }));
const OUT = resolve(ROOT, 'video/expmovie'), W = +(opt.w || 640), H = +(opt.h || 360);
const segs = JSON.parse(readFileSync(join(OUT, 'segments.json'), 'utf8'));
const cams = JSON.parse(opt.cams || '[{}]');
const bundle = readFileSync(join(OUT, 'bundle', 'director.js'), 'utf8');
const INIT = `window.__VT_CFG=${JSON.stringify({ seed: 20261026 })};\n` + bundle;
const b = await chromium.launch({ executablePath: process.env.CHROMIUM || '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
mkdirSync(join(OUT, 'probe'), { recursive: true });
const step = (p, n) => p.evaluate(async (n) => { const mc = new MessageChannel(); const turn = () => new Promise((r) => { mc.port1.onmessage = () => r(); mc.port2.postMessage(0); }); for (let i = 0; i < n; i++) { if (i) await turn(); window.__vt.step(1000 / 60); } }, n);
await Promise.all(String(opt.seg).split(',').map(async (id) => {
  const seg = segs.find((s) => s.id === id); if (!seg) throw new Error('no segment ' + id);
  const ctx = await b.newContext({ viewport: { width: W, height: H } });
  await ctx.addInitScript({ content: INIT });
  const p = await ctx.newPage();
  const [pg, q] = seg.page.split('?');
  await p.goto(pathToFileURL(resolve(ROOT, `dist-dev/${pg}.html`)).href + '?bots=20&' + q);
  for (let i = 0; i < 2000 && !(await p.evaluate((pg) => { window.__vt.step(1000 / 60); return window.__director.booted(pg); }, pg)); i++);
  await p.evaluate((id) => window.__director.init(id), id);
  await p.evaluate(() => window.__director.fast(true));
  for (let i = 0; i < 3000; i++) { const st = await p.evaluate(() => { window.__vt.step(1000 / 60); return window.__director.status; }); if (st === 'ready') break; if (/^(skip|error)/.test(st)) { console.log(id, st); return; } }
  await step(p, 40); await p.evaluate(() => window.__director.go());
  await step(p, Math.round(+(opt.at || 2) * 60));
  await p.evaluate(() => window.__director.fast(false));
  const files = [];
  for (let i = 0; i < cams.length; i++) {
    await p.evaluate((c) => { window.__xmCam = c; }, cams[i]);
    await step(p, 2);
    const f = join(OUT, 'probe', `${id}-c${i}.jpg`); await p.screenshot({ path: f, type: 'jpeg', quality: 85 }); files.push(f);
  }
  const sheet = join(OUT, 'probe', `${id}-cams.jpg`);
  spawnSync('montage', ['-label', '%t', ...files, '-tile', `${Math.min(3, files.length)}x`, '-geometry', `${W}x${H}+3+3`, sheet]);
  console.log(id, '→', sheet);
  await ctx.close();
}));
await b.close();
