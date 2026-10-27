// Runtime site contract against the real site (read-only): loads the channel page with the extension's bundles
// (dist/bridge.js at document_start, dist/game.js after load — auto-start switched off, so the 3D game never boots)
// and checks src/data/site-contract.json on the LIVE page through the extension's own guard (window.__l3dContract):
//   phase 'page' right after load; with cookies also phase 'city' (City tab opened as a user would) + the current town
//   as the extension detects it (window.__l3dTownNow) and the real keys of window.LGCity.
//   L3D_COOKIES=cookies.txt CHROMIUM=/usr/bin/google-chrome node e2e/contract.mjs [url] [--dist=dir] [--strict]
// Safety: like e2e/live.mjs — every non-GET request except the city presence calls the site's own City client makes
// (/api/city/enter|go|ping|leave|state|in) is aborted. Never prints cookie values.
// Exit: 3 = a 'break' check fails (the extension cannot run on this site), 2 = degrade failures with --strict, 0 = green.
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const args = process.argv.slice(2);
const url = args.find((a) => !a.startsWith('--')) || process.env.L3D_URL || 'https://play.multidonate.ru/c/zakvielchannel/';
const opt = Object.fromEntries(args.filter((a) => a.startsWith('--')).map((a) => { const i = a.indexOf('='); return i < 0 ? [a.slice(2), '1'] : [a.slice(2, i), a.slice(i + 1)]; }));
const dist = opt.dist || 'dist';
const t00 = Date.now();
const ts = () => ((Date.now() - t00) / 1000).toFixed(1).padStart(6);

const b = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined, headless: true,
  args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const c = await b.newContext({ viewport: { width: 1280, height: 720 }, bypassCSP: true });
let logged = false;
if (process.env.L3D_COOKIES) {
  const cookies = readFileSync(process.env.L3D_COOKIES, 'utf8').split('\n').filter((l) => l.trim() && !l.startsWith('#')).map((l) => {
    const [domain, , path, secure, exp, name, value] = l.split('\t');
    return { domain, path, secure: secure === 'TRUE', expires: +exp, name, value: (value || '').trim(), httpOnly: true };
  });
  await c.addCookies(cookies);
  logged = true;
}
const blocked = [];
const ALLOW = /\/api\/city\/(enter|go|ping|leave|state|in)(\?|$)/;
await c.route('**/api/**', (route) => {
  const r = route.request();
  if (r.method() !== 'GET' && !ALLOW.test(r.url())) { blocked.push(r.method() + ' ' + new URL(r.url()).pathname.replace(/^\/c\/[^/]+/, '')); return route.abort(); }
  return route.continue();
});
const p = await c.newPage();
const errors = [];
p.on('pageerror', (e) => errors.push(e.message));
p.on('console', (m) => { if (/legion-3d|\[l3d\]/.test(m.text())) console.log(ts(), `[${m.type()}]`, m.text().slice(0, 300)); });
await p.addInitScript({ content: "try { localStorage.setItem('l3d.auto', '0'); } catch (e) {}" });
await p.addInitScript({ content: readFileSync(dist + '/bridge.js', 'utf8') });
await p.goto(url, { waitUntil: 'load' });
await p.evaluate(readFileSync(dist + '/game.js', 'utf8'));
await p.waitForTimeout(1500);

const report = { url: new URL(url).origin + '/c/…', logged, page: null, city: null, town: null, lgCityKeys: null, signals: null };
report.page = await p.evaluate(() => window.__l3dContract('page'));
console.log(ts(), 'page contract', JSON.stringify(report.page));

if (logged) {
  const me = await p.evaluate(async () => { try { const r = await fetch((window.LG_BASE || '') + '/api/me', { credentials: 'same-origin' }); const j = await r.json(); return { user: !!j.user, hero: !!j.hero, tw: j.hero?.tw ?? null, cp: j.hero?.cp ?? null, hm: j.hero?.hm ?? null }; } catch (e) { return { error: String(e) }; } });
  console.log(ts(), 'me (flags only)', JSON.stringify(me));
  const btn = await p.$('.tabs button[data-tab="city"]:not([hidden])');
  if (btn && me.hero) {
    await btn.click();
    const ok = await p.waitForFunction(() => !!(window.LGCity && window.LGCity.debug && window.LGCity.debug()), null, { timeout: 60000 }).then(() => true, () => false);
    console.log(ts(), 'City open', ok);
    await p.waitForTimeout(1500);
    report.city = await p.evaluate(() => window.__l3dContract('city'));
    report.town = await p.evaluate(() => window.__l3dTownNow());
    report.lgCityKeys = await p.evaluate(() => Object.keys(window.LGCity || {}));
    report.signals = await p.evaluate(() => {
      const cy = document.querySelector('#tab-city .cy');
      let ss = null; try { ss = sessionStorage.getItem('lgCityTown'); } catch {}
      return { cy: !!cy, dataTown: cy ? (cy.dataset.town || '') : null, picker: document.querySelector('#tab-city .cy-tp [aria-current="true"]')?.dataset.town ?? null,
        session: ss, townBtn: document.querySelector('#tab-city .cy-town b')?.textContent ?? null, cam: document.querySelector('#tab-city .cy-cam')?.style.width ?? null,
        campMap: typeof window.LGCampMap, townGen: typeof window.LGTownGen, debugMe: (window.LGCity.debug() || {}).me || null };
    });
  } else console.log(ts(), 'City tab not available');
}

const breaks = [...(report.page?.breaks || []), ...(report.city?.breaks || [])];
const degrades = [...(report.page?.degrades || []), ...(report.city?.degrades || [])];
console.log('\n===== site contract (runtime) =====');
console.log(JSON.stringify({ ...report, blocked, pageErrors: errors.slice(0, 5) }, null, 1));
console.log(`RESULT breaks=${breaks.length} degrades=${degrades.length} town=${report.town ? report.town.id + ' via ' + report.town.via : 'n/a'}`);
await b.close();
process.exit(breaks.length ? 3 : opt.strict && degrades.length ? 2 : 0);
