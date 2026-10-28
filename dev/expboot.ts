/**
 * Expedition-only boot test page: the REAL launcher (src/content/main.ts) on a fake site page whose «Город» tab is
 * locked like the live site does while the hero is in an expedition party (button aria-disabled="true"), with the
 * bridge bus fed by the deterministic FakeQuest (src/quest/fake.ts) as SSE `q`. Nothing touches the network: fetch is
 * answered locally (/api/me only) and every request is logged in window.__req; window.LGCity is a trap that counts reads.
 * Served at /c/test by e2e/expboot.mjs (main.ts only starts on /c/<channel>).
 *   ?q=0  no running view yet (call __fake.startQ())   ?at=SEC   start at plan second SEC      ?speed=2   ?spec=1  spectator (not in the party; the tab stays locked anyway)
 *   window.__fake = { end(), unlock(), lock(), req(), lgcity(), fake }
 */
import '../src/bridge/bridge';   // the real document_start tee: defines window.__L3D_BUS
import { FakeQuest, rebase } from '../src/quest/fake';
import type { QuestPayload } from '../src/quest/model';
import meFx from '../test/fixtures/me.json';

const Q = new URLSearchParams(location.search);
const W = window as any;
const hero = { ...structuredClone((meFx as any).hero), cy: 1, qt: 1 };
const LOGIN = String(hero.login).toLowerCase();
const speed = +(Q.get('speed') || 2);
const fake = new FakeQuest({ login: LOGIN, role: hero.role || 'archer', speed, dl: 2, spectator: Q.get('spec') === '1' });

/* ---- fetch: only /api/me answers; everything is logged ---- */
const req: string[] = [];
W.__req = req;
const realFetch = window.fetch.bind(window);
let start = Date.now() - (+(Q.get('at') || 0) * 1000) / speed;
const viewNow = (): QuestPayload => rebase(fake.at(Date.now() - start), start - fake.t0);
window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input instanceof Request ? input.url : input);
  req.push((init?.method || 'GET') + ' ' + url.replace(location.origin, ''));
  const json = (d: unknown) => new Response(JSON.stringify(d), { headers: { 'Content-Type': 'application/json' } });
  if (/\/api\/me$/.test(url)) return json({ ok: true, user: { login: LOGIN }, hero, ...(stopped ? {} : { ql: viewNow() }) });
  if (/^\/|^http:\/\/(127\.0\.0\.1|localhost)/.test(url) && !/\/api\//.test(url)) return realFetch(input, init);
  return json({ ok: false, error: 'offline test page' });
}) as typeof fetch;

/* ---- LGCity trap: the expedition-only game must never touch the site's City client ---- */
let lgcity = 0;
Object.defineProperty(W, 'LGCity', { configurable: true, get() { lgcity++; return undefined; } });

/* ---- the fake server: one `q` view per 500 ms on the bridge bus ---- */
const bus = W.__L3D_BUS;
let stopped = Q.get('q') === '0';
const tick = () => { if (!stopped) bus.emit('sse:q', viewNow()); };
tick();
setInterval(tick, 500);

const cityBtn = () => document.querySelector<HTMLButtonElement>('.tabs button[data-tab="city"]')!;
const showTab = (id: string) => {
  for (const s of document.querySelectorAll('.tab')) s.classList.toggle('on', s.id === 'tab-' + id);
  for (const b of document.querySelectorAll<HTMLButtonElement>('.tabs button')) b.classList.toggle('on', b.dataset.tab === id);
};
for (const b of document.querySelectorAll<HTMLButtonElement>('.tabs button')) {
  b.onclick = () => { if (b.getAttribute('aria-disabled') === 'true') return; showTab(b.dataset.tab!); };
}
W.__fake = {
  fake,
  /** the expedition ends: {on:false} like the server */
  end() { stopped = true; bus.emit('sse:q', { on: false }); },
  /** the site enables the City tab again (app.js cityVis) */
  unlock() { const b = cityBtn(); b.removeAttribute('aria-disabled'); b.removeAttribute('title'); b.classList.remove('tab-lock'); },
  lock() { const b = cityBtn(); b.setAttribute('aria-disabled', 'true'); b.title = 'Вы сейчас в походе'; b.classList.add('tab-lock'); },
  startQ() { stopped = false; start = Date.now() - (+(Q.get('at') || 0) * 1000) / speed; tick(); },
  seek(sec: number) { start = Date.now() - (sec * 1000) / speed; tick(); },
  req: () => req.slice(),
  lgcity: () => lgcity,
};

// the launcher (auto-starts after 600 ms, like on the live site)
void import('../src/content/main');
