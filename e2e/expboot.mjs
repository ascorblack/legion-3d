// Expedition-only boot, offline: the real launcher (src/content/main.ts) on dev/expboot.html — the site's «Город» tab is
// locked (aria-disabled, hero in an expedition party) and FakeQuest feeds SSE `q`. Checks: the 3D expedition boots, no
// splash error, no /api/city/* request, window.LGCity never read; the end card; «Вернуться в город» tears the game down
// and starts the normal city boot. Screenshots → OUT (default .local/expboot).
//   npm run build && CHROMIUM=/usr/bin/google-chrome node e2e/expboot.mjs [outDir]
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, join, extname } from 'node:path';

const ROOT = resolve('dist-dev'), OUT = resolve(process.argv[2] || '.local/expboot');
mkdirSync(OUT, { recursive: true });
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.map': 'application/json', '.json': 'application/json' };
const srv = createServer((q, r) => {
  const u = new URL(q.url, 'http://x');
  let f = /^\/c\/[^/]+\/?$/.test(u.pathname) ? join(ROOT, 'expboot.html') : join(ROOT, u.pathname);
  if (!f.startsWith(ROOT) || !existsSync(f)) { r.writeHead(404); r.end(); return; }
  r.writeHead(200, { 'Content-Type': TYPES[extname(f)] || 'application/octet-stream' }); r.end(readFileSync(f));
});
await new Promise((ok) => srv.listen(0, '127.0.0.1', ok));
const PORT = srv.address().port;

const b = await chromium.launch({ executablePath: process.env.CHROMIUM || '/usr/bin/google-chrome', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
const logs = []; p.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`.slice(0, 300))); p.on('pageerror', (e) => logs.push('[pageerror] ' + e.message));
const fails = [];
const check = (name, ok, extra = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`); if (!ok) fails.push(name); };
const shot = async (name) => {
  await p.evaluate(() => window.__l3dGame?.engine.pause(true));
  await p.waitForTimeout(300);
  await p.screenshot({ path: join(OUT, name), timeout: 120000 });
  await p.evaluate(() => window.__l3dGame?.engine.pause(false));
  console.log('shot', join(OUT, name));
};

await p.goto(`http://127.0.0.1:${PORT}/c/test?at=${process.env.AT || 50}`);
await p.waitForFunction(() => !!window.__l3dGame?.ctx?.dev?.expedition?.active, null, { timeout: 90000 });
await p.waitForTimeout(7000);
const st = await p.evaluate(() => {
  const g = window.__l3dGame, sp = document.getElementById('l3d-splash');
  return {
    expOnly: !!g.ctx.state.expeditionOnly, active: !!g.ctx.dev.expedition.active, onAir: !!g.ctx.dev.expedition.onAir,
    kind: g.ctx.dev.expedition.sceneState?.kind, splash: sp ? sp.textContent : null, inRoom: g.ctx.state.inRoom,
    worldKids: g.world.root.children.length, layout: g.store.layout?.id, html: document.documentElement.className,
    card: !document.getElementById('l3d-expcard')?.hidden,
    hint: document.querySelector('.l3d-exp-hud, #l3d-ui *') ? [...document.querySelectorAll('#l3d-ui *')].map((e) => e.shadowRoot?.querySelector('.hint')?.textContent).filter(Boolean)[0] || '' : '',
    compass: (() => { const c = document.querySelector('.l3d-ui')?.shadowRoot?.querySelector('.compass'); return c ? c.style.visibility : 'none'; })(),
    req: window.__fake.req(), lgcity: window.__fake.lgcity(),
  };
});
console.log(JSON.stringify(st));
check('expedition-only game booted', st.expOnly && st.active && st.onAir && st.inRoom);
check('no splash left', !st.splash, String(st.splash || ''));
check('no city world (empty stand-in)', st.worldKids === 0 && st.layout === 'expedition');
check('no /api/city request', !st.req.some((r) => /\/api\/city/.test(r)), st.req.join(', '));
check('LGCity never read', st.lgcity === 0, String(st.lgcity));
check('no card while running', !st.card);
check('controls hint has no «Q — выйти»', !!st.hint && !/выйти/i.test(st.hint), st.hint);
check('street compass hidden', st.compass === 'hidden' || st.compass === 'none', st.compass);
await shot('01-boot-battle.png');

// a later stage (boss)
await p.evaluate(() => window.__fake.seek(200));
await p.waitForTimeout(6000);
console.log('kind', await p.evaluate(() => window.__l3dGame.ctx.dev.expedition.sceneState?.kind));
await shot('02-later-stage.png');

// a menu that does not need the city (character / bag)
await p.keyboard.press('KeyC'); await p.waitForTimeout(1500);
console.log('menu', await p.evaluate(() => window.__l3dGame.ctx.state.menu));
await shot('03-menu.png');
await p.keyboard.press('Escape'); await p.waitForTimeout(800);
await p.keyboard.press('KeyM'); await p.waitForTimeout(1200);
console.log('menu', await p.evaluate(() => window.__l3dGame.ctx.state.menu));
await shot('03b-map.png');
await p.keyboard.press('Escape'); await p.waitForTimeout(800);
// pause menu (Esc)
await p.keyboard.press('Escape'); await p.waitForTimeout(1000);
await shot('04-pause.png');
await p.keyboard.press('Escape'); await p.waitForTimeout(800);

// F8: classic site and back
await p.keyboard.press('F8'); await p.waitForTimeout(800);
const cl = await p.evaluate(() => ({ classic: window.__l3dGame.ctx.state.classic, host: getComputedStyle(document.getElementById('l3d-host')).display, html: document.documentElement.className }));
check('F8 → classic site', cl.classic && cl.host === 'none' && !/l3d-exp/.test(cl.html), JSON.stringify(cl));
await p.screenshot({ path: join(OUT, '05-classic.png') }); console.log('shot', join(OUT, '05-classic.png'));
await p.keyboard.press('F8'); await p.waitForTimeout(1500);
check('F8 → back to the 3D expedition', await p.evaluate(() => !window.__l3dGame.ctx.state.classic && !!window.__l3dGame.ctx.dev.expedition.active));

// the expedition ends; the city stays locked for a moment
await p.evaluate(() => window.__fake.end()); await p.waitForTimeout(2500);
const over = await p.evaluate(() => ({ card: !document.getElementById('l3d-expcard').hidden, h: document.querySelector('#l3d-expcard h2').textContent, btn: !document.querySelector('#l3d-expcard [data-a="city"]').hidden, active: !!window.__l3dGame.ctx.dev.expedition.active }));
check('end card, no return button while locked, view kept', over.card && over.h === 'Поход окончен' && !over.btn && over.active, JSON.stringify(over));
await shot('06-over-locked.png');

// the site unlocks the City tab → «Вернуться в город»
await p.evaluate(() => window.__fake.unlock()); await p.waitForTimeout(1800);
const open = await p.evaluate(() => ({ btn: !document.querySelector('#l3d-expcard [data-a="city"]').hidden, focus: document.activeElement?.dataset?.a }));
check('«Вернуться в город» offered', open.btn, JSON.stringify(open));
await shot('07-return-offer.png');

const nMe = (await p.evaluate(() => window.__fake.req())).filter((r) => /\/api\/me$/.test(r)).length;
await p.click('#l3d-expcard [data-a="city"]');
await p.waitForTimeout(1500);
const back = await p.evaluate(() => ({
  host: !!document.getElementById('l3d-host'), ui: !!document.getElementById('l3d-ui'), card: !!document.getElementById('l3d-expcard'),
  splash: document.querySelector('#l3d-splash .l3d-sp-t')?.textContent || null, cityOn: document.getElementById('tab-city').classList.contains('on'),
  me: window.__fake.req().filter((r) => /\/api\/me$/.test(r)).length, html: document.documentElement.className, game: !!window.__l3dGame,
}));
console.log(JSON.stringify(back));
check('expedition game torn down', !back.card && !back.game && !/l3d-exp/.test(back.html), JSON.stringify(back));
check('normal city boot started in place (new /api/me, City tab clicked)', back.me > nMe && back.cityOn && !!back.splash, JSON.stringify(back));
await p.screenshot({ path: join(OUT, '08-city-boot.png') }); console.log('shot', join(OUT, '08-city-boot.png'));

// waiting: the City is locked but no running view has arrived yet → «Ждём…» card, then the view opens by itself
await p.goto(`http://127.0.0.1:${PORT}/c/test?q=0&at=20`);
await p.waitForFunction(() => !!window.__l3dGame?.ctx?.state?.expeditionOnly, null, { timeout: 90000 });
await p.waitForTimeout(3000);
const wait = await p.evaluate(() => ({ card: !document.getElementById('l3d-expcard')?.hidden, h: document.querySelector('#l3d-expcard h2')?.textContent, active: !!window.__l3dGame.ctx.dev.expedition.active, splash: !!document.getElementById('l3d-splash'),
  compass: (() => { const c = document.querySelector('.l3d-ui')?.shadowRoot?.querySelector('.compass'); return c ? getComputedStyle(c).display : 'none'; })() }));
check('waiting card before the first view (no compass)', wait.card && wait.h === 'Ты в отряде похода' && !wait.active && !wait.splash && wait.compass === 'none', JSON.stringify(wait));
await shot('09-waiting.png');
await p.evaluate(() => window.__fake.startQ()); await p.waitForTimeout(5000);
const go = await p.evaluate(() => ({ card: !document.getElementById('l3d-expcard')?.hidden, active: !!window.__l3dGame.ctx.dev.expedition.active, req: window.__fake.req(), lgcity: window.__fake.lgcity() }));
check('view opens by itself when the expedition shows up', !go.card && go.active && !go.req.some((r) => /\/api\/city/.test(r)) && go.lgcity === 0, JSON.stringify(go));
await shot('10-started.png');

const errs = logs.filter((l) => /pageerror|\[error\]/i.test(l));
console.log(errs.length ? 'page errors:\n' + errs.slice(-15).join('\n') : 'no page errors');
console.log(fails.length ? `\nFAILED ${fails.length}: ${fails.join('; ')}` : '\nALL OK');
await b.close(); srv.close();
process.exit(fails.length ? 1 : 0);
