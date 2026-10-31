// Read-only recorder of a live expedition («поход»): opens the channel page logged in (cookie file), never writes:
// every non-GET /api request is aborted except the city client's own presence calls. Records every SSE event the
// page receives (bridge tee: window.__L3D_BUS) of the kinds q, sm, me(hero only quest bits), j, city(chat only)
// into e2e/.artifacts/quest/<stamp>/events.jsonl, plus a screenshot of the site's «Поход» tab every 60 s while q.on.
//
//   L3D_COOKIES=cookies.txt CHROMIUM=/usr/bin/google-chrome node e2e/quest-rec.mjs [--minutes=180] [--url=…]
// Stops after --minutes, or 20 min after the expedition ends (q.on true → false). Prints one status line a minute.
// Recorded files are PRIVATE (real nicknames): e2e/.artifacts is git-ignored — never commit or publish them.
import { chromium } from 'playwright';
import { readFileSync, mkdirSync, appendFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const opt = Object.fromEntries(process.argv.slice(2).map((a) => { const m = /^--([^=]+)=(.*)$/.exec(a); return m ? [m[1], m[2]] : [a.replace(/^--/, ''), '1']; }));
const URL0 = opt.url || process.env.L3D_URL || 'https://play.multidonate.ru/c/zakvielchannel/';
const MIN = +(opt.minutes || 180);
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const OUT = resolve(opt.out || join('e2e/.artifacts/quest', stamp));
mkdirSync(OUT, { recursive: true });
const ts = () => new Date().toISOString().slice(11, 19);
if (!process.env.L3D_COOKIES) throw new Error('L3D_COOKIES is required (cookie file path)');

const b = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined, headless: true, args: ['--no-sandbox', '--mute-audio'] });
const c = await b.newContext({ viewport: { width: 1280, height: 800 } });
const cookies = readFileSync(process.env.L3D_COOKIES, 'utf8').split('\n').filter((l) => l.trim() && !l.startsWith('#')).map((l) => {
  const f = l.split('\t'); return { name: f[5], value: f[6], domain: f[0].replace(/^#HttpOnly_/, ''), path: f[2], secure: f[3] === 'TRUE', httpOnly: l.startsWith('#HttpOnly_') };
});
await c.addCookies(cookies);
const ALLOW = /\/api\/city\/(enter|go|ping|leave|state)(\?|$)/;
let blocked = 0;
await c.route('**/api/**', (route) => {
  const r = route.request();
  if (r.method() !== 'GET' && !ALLOW.test(r.url())) { blocked++; console.log(ts(), '[BLOCKED]', r.method(), new URL(r.url()).pathname); return route.abort(); }
  return route.continue();
});
// the 3D extension is NOT loaded: this is the plain site with our SSE tee injected (same code path as bridge.js)
await c.addInitScript({ content: readFileSync(resolve('dist/bridge.js'), 'utf8') });
const p = await c.newPage();
const ev = join(OUT, 'events.jsonl');
let n = 0, lastQ = null, onSince = 0, offAt = 0, shots = 0;
await p.exposeFunction('__qrec', (kind, data) => {
  n++;
  appendFileSync(ev, JSON.stringify({ t: Date.now(), kind, data }) + '\n');
  if (kind === 'q') { const on = !!(data && data.on); if (on && (!onSince || offAt)) { onSince = Date.now(); offAt = 0; console.log(ts(), 'EXPEDITION ON'); } if (!on && onSince && !offAt) { offAt = Date.now(); console.log(ts(), 'EXPEDITION OFF'); } lastQ = data; }
});
await p.addInitScript(() => {
  const hook = () => {
    const bus = window.__L3D_BUS; if (!bus || !bus.on) return setTimeout(hook, 200);
    for (const k of ['sse:q', 'sse:sm', 'sse:j', 'sse:busy']) bus.on(k, (d) => window.__qrec(k.slice(4), d));
    bus.on('sse:me', (d) => { const h = d && d.hero; window.__qrec('me', h ? { q: h.q, qt: h.qt, hp: h.hp, hpMax: h.hpMax, role: h.role, lv: h.lv } : null); });
    bus.on('sse:city', (d) => { if (d && (d.chat || d.c)) window.__qrec('cityChat', { chat: d.chat, c: d.c }); });
  };
  hook();
});
await p.goto(URL0, { waitUntil: 'domcontentloaded', timeout: 120000 });
writeFileSync(join(OUT, 'meta.json'), JSON.stringify({ url: URL0, start: new Date().toISOString(), minutes: MIN }, null, 1));
console.log(ts(), 'recording to', OUT);
const t0 = Date.now();
while (Date.now() - t0 < MIN * 60000) {
  await p.waitForTimeout(60000);
  if (lastQ && lastQ.on) {
    try {
      // the site's own quest tab (read-only: just a screenshot of what the viewer sees)
      await p.screenshot({ path: join(OUT, `q-${String(++shots).padStart(3, '0')}.png`) });
    } catch { /* page busy */ }
  }
  console.log(ts(), `events ${n} · q.on ${!!(lastQ && lastQ.on)} · kind ${lastQ && (lastQ.k || lastQ.kind || '-')} · blocked ${blocked}`);
  if (offAt && Date.now() - offAt > 20 * 60000) { console.log(ts(), 'expedition ended 20 min ago — stopping'); break; }
}
writeFileSync(join(OUT, 'summary.json'), JSON.stringify({ events: n, sawOn: !!onSince, on: onSince ? new Date(onSince).toISOString() : null, off: offAt ? new Date(offAt).toISOString() : null, blocked, shots }, null, 1));
console.log(ts(), 'done', JSON.stringify({ events: n, sawOn: !!onSince, blocked }));
await b.close();
