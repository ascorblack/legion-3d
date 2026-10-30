// Offline, real Chromium: the site's own bot-telemetry probe (mine.js tlPi, e2e/site-telemetry.mjs) against dist/bridge.js
// on a page that has the site's <head> fetch wrapper (test/fixtures/site-fetch-wrapper.js). Native fetch here is the real one.
//   CHROMIUM=/usr/bin/google-chrome node e2e/fetch-tee.mjs        (needs `npm run build`; no network, no site)
// Passes when pi stays 0 in 2D (all start modes) and while the tee is off; it is 1 while the tee is on (proves the probe sees it).
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { probeSource } from './site-telemetry.mjs';

const wrapper = readFileSync(new URL('../test/fixtures/site-fetch-wrapper.js', import.meta.url), 'utf8');
const html = `<!doctype html><meta charset="utf-8"><script>${wrapper}</script><body>fake channel page`;
const b = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined, headless: true, args: ['--no-sandbox'] });
const out = [];
for (const start of ['2d', '3d', 'last']) {
  const c = await b.newContext();
  await c.route('https://play.multidonate.ru/**', (r) => (r.request().url().includes('/api/')
    ? r.fulfill({ contentType: 'application/json', body: '{"ok":true}' }) : r.fulfill({ contentType: 'text/html', body: html })));
  const p = await c.newPage();
  await p.addInitScript(`try { localStorage.setItem('l3d.start', '${start}'); } catch (e) {}`);
  await p.addInitScript({ content: readFileSync('dist/bridge.js', 'utf8') });
  await p.goto('https://play.multidonate.ru/c/channel/');
  await p.evaluate(probeSource());
  const q = (js) => p.evaluate(js);
  assert.equal(await q('window.__l3dPi()'), 0, `start=${start}: pi after load`);
  assert.equal(await q('window.fetch === window.LG_FETCH.w && window.LG_FETCH.n'), true);
  assert.equal(await q('window.__L3D_BUS.fetchTee.installed()'), false);
  // 3D on (what main.ts does), then F8 / classic
  await q('window.__L3D_BUS.fetchTee.on()');
  assert.equal(await q('window.__l3dPi() & 1'), 1, 'tee on is visible to the probe (so the check is meaningful)');
  const seen = await q(`new Promise((res) => { window.__L3D_BUS.on('hero:act', (d) => res(d)); fetch('/api/equip', { method: 'POST' }); setTimeout(() => res(null), 2000); })`);
  assert.deepEqual(seen, { ok: true }, 'tee copies the equip answer while on');
  await q('window.__L3D_BUS.fetchTee.off()');
  assert.equal(await q('window.__l3dPi()'), 0, `start=${start}: pi after classic`);
  assert.equal(await q('window.fetch === window.LG_FETCH.w'), true, 'site wrapper restored exactly');
  out.push(`start=${start}: pi 0 in 2D, 1 with the tee on, 0 again after off`);
  await c.close();
}
await b.close();
console.log(out.join('\n'));
