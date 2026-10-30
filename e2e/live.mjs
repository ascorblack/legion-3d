// Scenario runner against the real site (live e2e). Same injection as the extension: dist/bridge.js at
// document_start, dist/game.js after load (both MAIN world).
//   L3D_COOKIES=cookies.txt node e2e/live.mjs [url] [--steps=file.json | --steps='[...]'] [--out=e2e/.artifacts/live]
//   --dist=dir: inject the bundles from dir instead of dist/ (a snapshot, if others rebuild meanwhile)
//   without L3D_COOKIES: logged-out run (checks the splash).
// Steps (array of objects, run in order):
//   {"wait":ms} {"press":"KeyE"} {"key":"KeyW","ms":2000} {"eval":"js expr"} (result printed)
//   {"shot":"name"} (pauses the engine while capturing: swiftshader is slow) {"stats":1} {"mem":1}
//   {"watch":ms} sample stats/memory/net every 5 s for ms
// Safety: every POST except the city presence/movement calls (incl. /api/city/in — «entered building», 27.10) the site's own city client makes is ABORTED at the
// network layer and reported, so a test can never buy, equip, chat or otherwise act for the account.
// Never prints cookie values.
//   --allow-mine: additionally allow the mine presence calls (/api/mine/enter|leave|ping|state) for a read-only capture
//   {"eval":"…","save":"file.json"}: also write the eval result to a file (raw captures go to .local/, never committed)
//   --no-go-timing: do not inject the page-side /api/city/go timing wrapper (it is itself a foreign fetch wrapper: the site's
//     telemetry would flag the harness, not the extension). Needed for {"pi":…} checks in 3D.
//   --start=2d: the default start mode of the extension (classic site, 3D by F8 / the button) instead of '3d' (implies
//     --no-go-timing). Nothing waits for the game then:
//     use {"press":"F8"}, {"wait":ms}, {"pi":"label"}. {"pi":"label"} runs the site's own bot-telemetry probe (mine.js tlPi,
//     e2e/site-telemetry.mjs) and prints pi (0 = nothing of ours detected), whether window.fetch is the site's wrapper over a
//     native fetch, and whether our fetch tee is on.
import { chromium } from 'playwright';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { probeSource } from './site-telemetry.mjs';

const args = process.argv.slice(2);
const url = args.find((a) => !a.startsWith('--')) || process.env.L3D_URL || 'https://play.multidonate.ru/c/zakvielchannel/';
const opt = Object.fromEntries(args.filter((a) => a.startsWith('--')).map((a) => { const i = a.indexOf('='); return i < 0 ? [a.slice(2), '1'] : [a.slice(2, i), a.slice(i + 1)]; }));
const out = opt.out || 'e2e/.artifacts/live';
mkdirSync(out, { recursive: true });
const steps = opt.steps ? JSON.parse(existsSync(opt.steps) ? readFileSync(opt.steps, 'utf8') : opt.steps) : [{ wait: 3000 }, { stats: 1 }, { shot: 'boot' }];

const b = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined, headless: true,
  args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-precise-memory-info'] });
const c = await b.newContext({ viewport: { width: +(opt.w || 1280), height: +(opt.h || 720) }, bypassCSP: true });
if (process.env.L3D_COOKIES) {
  const cookies = readFileSync(process.env.L3D_COOKIES, 'utf8').split('\n').filter((l) => l.trim() && !l.startsWith('#')).map((l) => {
    const [domain, , path, secure, exp, name, value] = l.split('\t');
    return { domain, path, secure: secure === 'TRUE', expires: +exp, name, value: (value || '').trim(), httpOnly: true };
  });
  await c.addCookies(cookies);
}
const t00 = Date.now();
const ts = () => ((Date.now() - t00) / 1000).toFixed(1).padStart(6);
const net = { go: [], posts: {}, blocked: [], slow: [] };
// --allow-mine: also let through the mine PRESENCE calls the site's own mine client makes when the mine opens
// (/api/mine/enter|leave|ping|state) — for read-only state capture. Digging, selling, buying, lamp, chat stay blocked.
const ALLOW_MINE = /\/api\/mine\/(enter|leave|ping|state)(\?|$)/;
const ALLOW = { test: (u) => /\/api\/city\/(enter|go|ping|leave|state|in)(\?|$)/.test(u) || (!!opt['allow-mine'] && ALLOW_MINE.test(u)) };
await c.route('**/api/**', (route) => {
  const r = route.request();
  if (r.method() !== 'GET' && !ALLOW.test(r.url())) { net.blocked.push(r.method() + ' ' + new URL(r.url()).pathname); console.log(ts(), '[BLOCKED]', r.method(), new URL(r.url()).pathname); return route.abort(); }
  return route.continue();
});
const p = await c.newPage();
const errors = [];
p.on('console', (m) => { const t = m.text(); if (m.type() === 'error' || m.type() === 'warning' || /legion-3d|\[l3d\]/.test(t)) { console.log(ts(), `[${m.type()}]`, t.slice(0, 400)); if (m.type() === 'error') errors.push(t); } });
p.on('pageerror', (e) => { console.log(ts(), '[pageerror]', e.message, (e.stack || '').split('\n').slice(1, 4).join(' | ')); errors.push(e.message); });
p.on('request', (r) => {
  if (r.method() !== 'POST') return;
  const path = new URL(r.url()).pathname.replace(/^\/c\/[^/]+/, '');
  net.posts[path] = (net.posts[path] || 0) + 1;
  if (path === '/api/city/go') { net.go.push(Date.now()); if (opt.verbose) console.log(ts(), 'go', r.postData()); }
});
p.on('response', async (r) => {
  if (!/\/api\/city\/go/.test(r.url())) return;
  try { const j = await r.json(); if (!j.ok) { net.slow.push(j.error || JSON.stringify(j)); console.log(ts(), '[go !ok]', JSON.stringify(j).slice(0, 200)); } } catch { /* */ }
});
const START2D = opt.start === '2d';
await p.addInitScript({ content: `try { localStorage.setItem('l3d.start', '${START2D ? '2d' : '3d'}'); } catch (e) {}` });   // 0.5.1: 2D by default
await p.addInitScript({ content: readFileSync((opt.dist || 'dist') + '/bridge.js', 'utf8') });
// page-side timing of /api/city/go calls (Node-side request events clump when the machine is loaded)
if (!START2D && !opt['no-go-timing']) await p.addInitScript({ content: `(() => { const f0 = window.fetch; window.__goT = []; window.fetch = function (u, i) { try { if (/\\/api\\/city\\/go/.test(String(u && u.url || u))) { const t = Math.round(performance.now()); window.__goT.push(t); const r = f0.apply(this, arguments); (window.__goLog = window.__goLog || []).push(t + ' ' + (i && i.body)); r.then((x) => { if (!x.ok) window.__goLog.push(t + ' -> ' + x.status); }, () => {}); return r; } } catch (e) {} return f0.apply(this, arguments); }; })();` });
await p.goto(url, { waitUntil: 'load' });
await p.evaluate(readFileSync((opt.dist || 'dist') + '/game.js', 'utf8'));
const t0 = Date.now();
if (START2D) await p.waitForSelector('#l3d-launch', { timeout: 60000 }).catch(() => {});
else await p.waitForFunction(() => (!!window.__l3dGame && !document.getElementById('l3d-splash')) || !!document.querySelector('#l3d-splash .l3d-sp-x button'), null, { timeout: 120000 }).catch(() => {});
console.log(ts(), 'boot ms', Date.now() - t0);
const splash = await p.evaluate(() => { const s = document.querySelector('#l3d-splash'); return s ? { text: s.querySelector('.l3d-sp-t')?.textContent, buttons: [...s.querySelectorAll('.l3d-sp-x a, .l3d-sp-x button')].map((e) => e.textContent + (e.href ? ' → ' + new URL(e.href).pathname : '')) } : null; });
if (splash) console.log(ts(), 'splash:', JSON.stringify(splash));

const stats = () => p.evaluate(() => {
  const g = window.__l3dGame; if (!g) return null;
  const s = g.engine.stats(); const st = g.store;
  const dbg = (() => { try { return window.LGCity.debug(); } catch { return null; } })();
  return { fps: Math.round(s.fps), ms: +(+s.ms).toFixed(1), calls: s.calls, tris: s.tris, scale: s.scale, q: g.engine.quality,
    walkers: st.walkers.size, online: st.online, chat: st.chat.length, me: st.me && [Math.round(st.me.x), Math.round(st.me.y)],
    siteMe: dbg && dbg.me && dbg.me.map(Math.round), cam: g.rig.mode, overlay: g.site.overlay(),
    host: (document.getElementById('l3d-host').hidden ? 'hidden' : 'shown') + '/' + (document.getElementById('l3d-host').style.display || 'block'),
    heap: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null };
});
const shot = async (name) => {
  // pause only a running game (an overlay / classic mode already paused it: leave that state alone)
  const paused = await p.evaluate(() => {
    const g = window.__l3dGame, h = document.getElementById('l3d-host'); if (!g || !h) return false;
    if (h.style.display === 'none' || h.hidden) return false;
    g.engine.pause(true); return true;
  });
  await p.waitForTimeout(300);
  try { await p.screenshot({ path: `${out}/${name}.png`, timeout: 120000 }); console.log(ts(), 'shot', `${out}/${name}.png`); }
  catch (e) { console.log(ts(), 'shot failed', name, e.message.split('\n')[0]); }
  if (paused) await p.evaluate(() => { const g = window.__l3dGame, h = document.getElementById('l3d-host'); if (g && h.style.display !== 'none' && !h.hidden) g.engine.pause(false); });
};
const pageGo = () => p.evaluate(() => { const t = window.__goT || []; let mg = null; for (let i = 1; i < t.length; i++) mg = mg == null ? t[i] - t[i - 1] : Math.min(mg, t[i] - t[i - 1]); return { n: t.length, minGapMs: mg, gaps: t.slice(1).map((x, i) => x - t[i]).slice(-12) }; }).catch(() => null);
const goRate = () => { const now = Date.now(); const last = net.go.filter((t) => now - t < 10000); let minGap = Infinity; for (let i = 1; i < net.go.length; i++) minGap = Math.min(minGap, net.go[i] - net.go[i - 1]); return { total: net.go.length, last10s: last.length, minGapMs: minGap === Infinity ? null : minGap }; };

for (const s of steps) {
  try {
    if (s.log) console.log(ts(), '---', s.log);
    if (s.eval) { const r = await p.evaluate(s.eval); console.log(ts(), 'eval', (s.label || s.eval).slice(0, 80), '→', JSON.stringify(r)?.slice(0, 1500)); if (s.save) { writeFileSync(s.save, JSON.stringify(r, null, 1)); console.log(ts(), 'saved', s.save); } }
    // hold a key until the player moved `px` (slow software GL: a fixed hold may cover only a frame or two)
    if (s.walk) {
      const p0 = await p.evaluate(() => [window.__l3dGame.player.x, window.__l3dGame.player.y]);
      await p.keyboard.down(s.walk); const tEnd = Date.now() + (s.max || 20000); let d = 0;
      while (Date.now() < tEnd) { await p.waitForTimeout(200); d = await p.evaluate((a) => Math.hypot(window.__l3dGame.player.x - a[0], window.__l3dGame.player.y - a[1]), p0); if (d >= (s.px || 60)) break; }
      await p.keyboard.up(s.walk);
      console.log(ts(), 'walked', s.walk, Math.round(d), 'px');
    }
    if (s.frames) {   // wait until the game rendered N more frames
      await p.evaluate((n) => new Promise((res) => { let k = 0; const off = window.__l3dGame.engine.onFrame(() => { if (++k >= n) { off(); res(1); } }); setTimeout(() => { off(); res(0); }, 30000); }), s.frames);
    }
    if (s.key) { await p.keyboard.down(s.key); await p.waitForTimeout(s.ms || 300); await p.keyboard.up(s.key); }
    if (s.press) await p.keyboard.press(s.press);
    if (s.pi) {
      await p.evaluate(probeSource());
      const r = await p.evaluate(() => { const F = window.LG_FETCH, t = window.__L3D_BUS && window.__L3D_BUS.fetchTee; return { pi: window.__l3dPi(), siteWrapperOverNative: !!(F && window.fetch === F.w && F.n), teeOn: !!(t && t.installed()), game: !!window.__l3dGame, classic: window.__l3dGame ? !!window.__l3dGame.ctx.game.classic : null }; });
      console.log(ts(), 'PI', s.pi, JSON.stringify(r));
    }
    if (s.click) await p.click(s.click, { timeout: 5000 });
    if (s.wait) await p.waitForTimeout(s.wait);
    if (s.shot) await shot(s.shot);
    if (s.stats) console.log(ts(), 'stats', JSON.stringify(await stats()), 'go', JSON.stringify(goRate()));
    if (s.watch) {
      const end = Date.now() + s.watch;
      while (Date.now() < end) { await p.waitForTimeout(Math.min(s.every || 5000, end - Date.now())); console.log(ts(), 'watch', JSON.stringify(await stats()), 'go', JSON.stringify(goRate())); }
    }
  } catch (e) { console.log(ts(), 'step failed', JSON.stringify(s).slice(0, 100), e.message.split('\n')[0]); }
}
console.log(ts(), 'final', JSON.stringify(await stats().catch(() => null)));
console.log(ts(), 'pageGo', JSON.stringify(await pageGo()));
if (opt.golog) console.log(ts(), 'goLog', JSON.stringify(await p.evaluate(() => (window.__goLog || []).slice(0, 30))));
console.log(ts(), 'net', JSON.stringify({ posts: net.posts, go: goRate(), blocked: net.blocked, notOk: net.slow.slice(0, 10) }));
console.log(ts(), 'errors', errors.length);
await b.close();
