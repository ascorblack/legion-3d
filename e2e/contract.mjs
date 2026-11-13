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
// site 13.11 live link (LGLiveLink: WebSocket /ws first, SSE /api/live fallback): count what the bridge tees, by name
await p.addInitScript({ content: `(() => { const B = window.__L3D_BUS; if (!B) return; const n = window.__l3dLiveSeen = {};
  for (const t of ['sse:me', 'sse:city', 'sse:mine', 'sse:q', 'sse:j', 'sse:jail', 'sse:dm', 'sse:open', 'sse:error']) B.on(t, () => { n[t] = (n[t] || 0) + 1; });
  B.on('sse:city', (d) => { if (d && (d.chat || d.chatDel)) n.cityChat = (n.cityChat || 0) + 1; }); })();` });
const wire = { ws: 0, wsEv: 0, sse: 0 };   // transport seen on the wire (counts only; never payloads)
p.on('websocket', (ws) => { if (/\/ws$/.test(new URL(ws.url()).pathname)) { wire.ws++; ws.on('framereceived', (f) => { if (String(f.payload || '').startsWith('{"op":"ev"')) wire.wsEv++; }); } });
p.on('request', (r) => { if (/\/api\/live(\?|$)/.test(r.url())) wire.sse++; });
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
    await p.waitForTimeout(3000);   // citymon.js ticks every 1.5 s and loads its view on the first tick
    report.signals = await p.evaluate(() => {
      const cy = document.querySelector('#tab-city .cy');
      let ss = null; try { ss = sessionStorage.getItem('lgCityTown'); } catch {}
      return { cy: !!cy, dataTown: cy ? (cy.dataset.town || '') : null, picker: document.querySelector('#tab-city .cy-tp [aria-current="true"]')?.dataset.town ?? null,
        session: ss, townBtn: document.querySelector('#tab-city .cy-town b')?.textContent ?? null, cam: document.querySelector('#tab-city .cy-cam')?.style.width ?? null,
        campMap: typeof window.LGCampMap, townGen: typeof window.LGTownGen, debugMe: (window.LGCity.debug() || {}).me || null,
        // site 10.11 (read only): the «Игра» mode, mail, fishing, the HUD entries our pause menu mirrors
        gameUi: (() => { try { return !!window.LGGameUi?.on?.(); } catch { return null; } })(),
        mail: (() => { try { return !!window.LGMail?.on?.(); } catch { return null; } })(),
        fish: (() => { try { return !!window.LGFish2On?.(); } catch { return null; } })(),
        arenaTab: !!document.querySelector('.tabs button[data-tab="arena"]:not([hidden])'),
        guildsEntry: !!document.querySelector('.cy-hud .gl-entry'), miniMap: typeof window.LegionMiniMap?.open,
        // site 12.11 (read only): the guild hall — the site's own cached on() (city.js soonB asks it too), its HUD entry,
        // whether this town has the guild building (LGCity.hasB, pure) and what the 3D layout made of it
        guildHall: (() => { try { const G = window.LGGuildHall; return { on: G && G.on ? G.on() : false, keys: G ? Object.keys(G) : null, entry: !!document.querySelector('.cy-hud .gh-entry'),
          hasB: !!window.LGCity?.hasB?.('guild'), root: !!document.querySelector('.gh-root') }; } catch { return null; } })(),
        // site 12.11 afternoon (read only): monsters at the walls (citymon.js) — counts and keys only, never names
        cityMon: (() => { try {
          const M = window.LGCityMon, A = window.LGCityMonArt, W = window.LGCity?.wall?.(), h = W && W.X && W.X.hero ? W.X.hero() : null, v = M && M.view ? M.view() : null;
          return { mon: M ? Object.keys(M) : null, art: A && A.IDS ? A.IDS.length : null, cm: h ? (h.cm ? Object.keys(h.cm) : false) : null,
            wall: W ? { town: W.town, own: W.own, glade: !!W.glade, spots: W.glade?.spots?.length ?? 0 } : null,
            view: v ? { keys: Object.keys(v), packs: (v.packs || []).map((P) => ({ tier: P.tier, n: (P.pack || []).length, mon: (P.pack || []).map((m) => m.mon) })), elites: (v.elites || []).map((E) => E.eid),
              soon: (v.soon || []).length, eSoon: (v.eSoon || []).length, daily: v.daily || null, biome: v.biome || null } : null,
            layer: document.querySelectorAll('.cm-wall .cmw').length, badge: !!document.querySelector('.cm-badge'),
            // the shapes of the view's records (keys and numbers only) and where the site's own layer put each pack / elite
            shape: v ? { pack: (v.packs || []).map((P) => ({ keys: Object.keys(P), tier: P.tier, slot: P.slot, idx: P.idx, n: P.n, lvl: P.lvl, m: Object.keys((P.pack || [])[0] || {}) })),
              elite: (v.elites || []).map((E) => ({ keys: Object.keys(E), tier: E.tier, slot: E.slot, idx: E.idx, n: E.n, lvl: E.lvl })),
              soon: (v.soon || []).map((x) => ({ keys: Object.keys(x), tier: x.tier, slot: x.slot, idx: x.idx, n: x.n })), hero: v.hero ? Object.keys(v.hero) : null } : null,
            placed: v ? [...document.querySelectorAll('.cm-wall [data-spot]')].map((b) => [b.dataset.cm || 'trail', (v.packs || []).findIndex((P) => P.pid === b.dataset.pid), (v.elites || []).findIndex((E) => (E.epid || E.eid) === b.dataset.eid), +b.dataset.spot, +b.dataset.x || null, +b.dataset.y || null, b.className.baseVal ?? b.className]) : null }; } catch (e) { return String(e); } })() };
    });
  } else console.log(ts(), 'City tab not available');
}
// the live link: the transport the SITE picked (WebSocket only with hero.lw) and what reached window.__L3D_BUS over it
await p.waitForTimeout(logged ? 6000 : 1500);
report.live = await p.evaluate(() => ({ linkLib: typeof window.LGLiveLink, live: window.LGLive ? window.LGLive() : null,
  kind: window.__L3D_BUS ? window.__L3D_BUS.last['live:kind'] ?? null : null, seen: window.__l3dLiveSeen || null }));
report.live.wire = wire;

const breaks = [...(report.page?.breaks || []), ...(report.city?.breaks || [])];
const degrades = [...(report.page?.degrades || []), ...(report.city?.degrades || [])];
console.log('\n===== site contract (runtime) =====');
console.log(JSON.stringify({ ...report, blocked, pageErrors: errors.slice(0, 5) }, null, 1));
const lv = report.live || {}, seen = lv.seen || {};
// a logged-in page whose live link carried nothing to the bus: the bridge does not see the transport the site picked
if (logged && lv.live && !(seen['sse:me'] || seen['sse:city'] || seen['sse:q'])) degrades.push({ id: 'live link teed (bridge sees the site\'s transport)', severity: 'degrade', missing: ['sse:* on __L3D_BUS over ' + (wire.ws ? 'WebSocket' : 'SSE')] });
console.log(`LIVE transport=${lv.kind || 'none'} wire ws=${wire.ws} (ev frames ${wire.wsEv}) sse=${wire.sse} bus me=${seen['sse:me'] || 0} city=${seen['sse:city'] || 0} cityChat=${seen.cityChat || 0} q=${seen['sse:q'] || 0}`);
console.log(`RESULT breaks=${breaks.length} degrades=${degrades.length} town=${report.town ? report.town.id + ' via ' + report.town.via : 'n/a'}`);
await b.close();
process.exit(breaks.length ? 3 : opt.strict && degrades.length ? 2 : 0);
