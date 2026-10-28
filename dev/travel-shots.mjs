// «Путешествие» in the offline demo (dist-dev/game.html, fake towns / search / LGCity.town from dev/game.ts):
// screenshots + assertions. CHROMIUM=/usr/bin/google-chrome node dev/travel-shots.mjs [outDir]
import { chromium } from 'playwright';
import { resolve } from 'node:path';
import { mkdirSync } from 'node:fs';

const out = process.argv[2] || '.local/travel-shots';
mkdirSync(out, { recursive: true });
const b = await chromium.launch({ executablePath: process.env.CHROMIUM || '/usr/bin/google-chrome', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const p = await b.newPage({ viewport: { width: +(process.env.W || 1280), height: +(process.env.H || 720) } });
const logs = []; p.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`.slice(0, 300))); p.on('pageerror', (e) => logs.push('[pageerror] ' + e.message));
const reqs = [];   // every /api/ request the page made, with the time since load
const t0 = Date.now();
p.on('request', (r) => { if (/\/api\//.test(r.url())) reqs.push(`${((Date.now() - t0) / 1000).toFixed(1)}s ${r.method()} ${new URL(r.url()).pathname}${new URL(r.url()).search}`); });
await p.addInitScript(() => { localStorage.setItem('l3d.whatsnew.enabled', '0'); localStorage.setItem('l3d.whatsnew.seen', '99.0.0'); });
await p.goto('file://' + resolve('dist-dev/game.html') + '?bots=6&' + (process.env.Q || ''));
await p.waitForFunction(() => !!window.__l3dGame, null, { timeout: 60000 });
await p.waitForTimeout(5000);
// fetch hook: count what the *demo fakes* get asked, the page itself never reaches a server (file://)
await p.evaluate(() => { window.__fetches = []; const f = window.fetch; window.fetch = function (u, i) { window.__fetches.push(String(u?.url || u)); return f.apply(this, arguments); }; });
const checks = [];
const ok = (name, cond, extra = '') => { checks.push([cond ? 'PASS' : 'FAIL', name, extra]); console.log(cond ? 'PASS' : 'FAIL', name, extra); };
const shot = async (name) => {
  await p.evaluate(() => window.__l3dGame.engine.pause(true)); await p.waitForTimeout(250);
  await p.screenshot({ path: `${out}/${name}.png`, timeout: 120000 });
  await p.evaluate(() => window.__l3dGame.engine.pause(false)); console.log('shot', name);
};
const menu = () => p.evaluate(() => window.__l3dGame.ctx.state.menu);
const layoutId = () => p.evaluate(() => window.__l3dGame.store.layout.id);
const fetchCount = () => p.evaluate(() => window.__fetches.length);

// 1. the page opens with L and lists the towns
ok('no site request before the page opens', (await fetchCount()) === 0);
await p.keyboard.press('KeyL'); await p.waitForTimeout(1200);
ok('L opens the page', (await menu()) === 'travel', String(await menu()));
const cards = await p.locator('[data-town]').count();
ok('town cards listed (fair + camp + 3 districts)', cards === 5, 'cards=' + cards);
const campName = await p.locator('[data-town="camp"] b').innerText();
ok('camp is «Кошачий привал» in the cat style', campName === 'Кошачий привал', campName);
await shot('01-towns');

// 2. channels tab: own list, then a search
await p.locator('[data-tab="channels"]').click(); await p.waitForTimeout(600);
ok('own list shown', (await p.locator('[data-mine] .tv-ch').count()) === 3);
await shot('02-channels-list');
await p.locator('[data-q]').click();
const before = (await p.evaluate(() => window.__fetches.filter((u) => /api\/find/.test(u)).length));
await p.keyboard.type('p'); await p.waitForTimeout(700);
ok('1 character: no search request', (await p.evaluate(() => window.__fetches.filter((u) => /api\/find/.test(u)).length)) === before);
await shot('03-channels-short');
await p.keyboard.type('u'); await p.waitForTimeout(150);
ok('debounce: nothing sent after 150 ms', (await p.evaluate(() => window.__fetches.filter((u) => /api\/find/.test(u)).length)) === before);
await p.waitForTimeout(1100);
const n1 = await p.locator('[data-res] .tv-ch').count();
ok('search results listed', n1 === 2, 'rows=' + n1);
ok('exactly one /api/find request', (await p.evaluate(() => window.__fetches.filter((u) => /api\/find/.test(u)).length)) === before + 1);
await shot('04-channels-search');

// 3. pick a channel → confirm (no navigation until «Перейти»)
await p.locator('[data-res] [data-ch]').first().click(); await p.waitForTimeout(300);
ok('confirm shown', (await p.locator('.tv-confirm').count()) === 1);
await shot('05-confirm');
await p.locator('[data-act="no"]').click();
ok('«Остаться» closes the confirm', (await p.locator('.tv-confirm').count()) === 0);

// 4. travel to the camp
await p.locator('[data-tab="towns"]').click(); await p.waitForTimeout(400);
const from = await layoutId();
await p.locator('[data-town="d7"]').click();
await p.waitForTimeout(250);
ok('menu closed, veil «Дорога в …» up', (await menu()) === null && /Дорога в Сосновый Брод/.test(await p.evaluate(() => [...document.querySelectorAll('body > div')].map((d) => d.textContent).join('|'))));
await shot('06-veil');
await p.waitForTimeout(3500);
ok('arrived in the district town', (await layoutId()) === 'd7', `${from} → ${await layoutId()}`);
await p.keyboard.press('KeyL'); await p.waitForTimeout(900);
ok('current town marked after the trip', (await p.locator('[data-town="d7"][aria-current="true"]').count()) === 1);
await p.locator('[data-town="camp"]').click(); await p.waitForTimeout(4500);
ok('arrived in the camp', (await layoutId()) === 'camp');
// look at the camp's name board: stand in the middle, face the back row
await p.evaluate(() => { const g = window.__l3dGame; g.player.teleport(720, 1010); g.ctx.me.x = 720; g.ctx.me.y = 1010; g.rig.yaw = 0; g.rig.pitch = -0.08; });
await p.waitForTimeout(1500);
await shot('07-camp-board');
console.log('town calls:', JSON.stringify(await p.evaluate(() => window.__travelLog)));
console.log('fetches seen by the page:', JSON.stringify(await p.evaluate(() => window.__fetches)));
console.log(logs.filter((l) => /error|warn|pageerror/i.test(l) && !/postMessage|ERR_NETWORK/.test(l)).slice(-15).join('\n'));
await b.close();
console.log(checks.filter((c) => c[0] === 'FAIL').length ? 'SOME CHECKS FAILED' : 'ALL CHECKS PASSED');
process.exit(checks.some((c) => c[0] === 'FAIL') ? 1 : 0);
