/**
 * Site update 18.11 (night).
 *  - site-live.js: the hero patch rule moved into meIn / mepIn and now serves BOTH transports — app.js opens the EventSource
 *    as `/api/live…mep=1`, site-live.js adds a `mep` listener beside `me`, and a gap there reconnects the source
 *    (`down('mep')`). The bridge keeps a MeMirror per EventSource too (src/bridge/bridge.ts tapLiveMe).
 *  - citymon.js placeAll: two passes (own tier first, the rest on 1 / 2 / 0), a strong pack's idx counted from the far end,
 *    returning packs fall back to tiers 1 / 2 → src/net/citymon.ts.
 *  - mine.js LGMineDig: the mine record's dig record `dr` moves the numbers on the client at the server clock (every 3 s
 *    and on every take) → src/rooms/mine/dig.ts digView, MineModel.meNow / meTick, MineClient's 3 s tick.
 *  - mine.js WASD: a continuous rAF walk — still nothing while our hidden `.mn-board-w` holds the site's mine.
 *  - app.js GU_WIN (unchanged keys; style icons between it and guTab).
 * The site's own code comes from the local copy `.local/site-1118-*` (not in the repo); those tests are skipped without it.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import vm from 'node:vm';
import { siteCopy, fnSource } from './site-quest-fns';
import { GU_WINDOWS } from '../src/net/gameui';
import { placeAll, type CmWall, type CmPack, type CmElite, type CmSoon } from '../src/net/citymon';
import { digView, dayMin, CAP_EPS } from '../src/rooms/mine/dig';
import { MineModel, type MineView } from '../src/rooms/mine/state';
import { MineClient, type Timers } from '../src/rooms/mine/net';
import { holdSiteMine } from '../src/net/site-mine';
import contract from '../src/data/site-contract.json';
import fc from './fixtures/faircats-map.json';
import meJson from './fixtures/me.json';
import enter from './fixtures/mine-enter.json';

const LIVE = siteCopy('site-live.js', 'function mepIn(data, resync)');
const APP = siteCopy('app.js', "+ 'mep=1'");
const CM = siteCopy('citymon.js', 'own && D.tier === 2 && D.idx != null ? L.length - n + D.idx');
const CM17 = siteCopy('citymon.js', 'const s0 = (D.n || 1) >= L.length');
const MINE = siteCopy('mine.js', 'root.LGMineDig = M');
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));
const rng = (seed: number) => () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };

/* ------------------------------------------------------------------ fakes for the bridge */
type Fn = (e: any) => void;
class FakeES {
  static all: FakeES[] = [];
  url: string; ls = new Map<string, Fn[]>(); readyState = 0; onopen: Fn | null = null; onerror: Fn | null = null;
  constructor(u: string) { this.url = String(u); FakeES.all.push(this); }
  addEventListener(t: string, f: Fn) { const a = this.ls.get(t) || []; a.push(f); this.ls.set(t, a); }
  close() { this.readyState = 2; }
  fire(t: string, data: string) { if (this.readyState === 2) return; for (const f of this.ls.get(t) || []) f({ type: t, data }); }
}
class FakeWS { static CONNECTING = 0; static OPEN = 1; static CLOSING = 2; static CLOSED = 3; constructor() { throw new Error('no socket here'); } }
const g = globalThis as any;
let isLiveWs: (u: string) => boolean;
beforeAll(async () => {
  g.window = Object.assign(g, { addEventListener() {}, removeEventListener() {} });
  g.EventSource = FakeES;
  g.WebSocket = FakeWS;
  isLiveWs = (await import('../src/bridge/bridge')).isLiveWs;
});

/** The site's live link (site-live.js 18.11 in node:vm) on SSE (no socket offered), the bridge tapping the EventSource. */
function sseLink() {
  const sb: any = { Math, Date, JSON, Map, String, Object, Array, console };
  sb.self = sb; sb.EventSource = g.EventSource; sb.WebSocket = undefined;
  vm.runInNewContext(LIVE!, sb);
  const site: any[] = [], bus: any[] = [], mep: (number | null)[] = [], logs: string[] = [], timers: (() => void)[] = [];
  const B = g.__L3D_BUS;
  const offs = [B.on('sse:me', (d: any) => bus.push(d)), B.on('live:mep', (v: any) => mep.push(v))];
  const n0 = FakeES.all.length;
  const L = sb.LGLiveLink.open({ ws: () => null, sse: () => '/api/live?mep=1', setTimeout: (f: () => void) => { timers.push(f); return timers.length; },
    clearTimeout: () => {}, random: () => 0, log: (t: string) => logs.push(t) });
  L.addEventListener('me', (e: any) => site.push(JSON.parse(e.data)));
  const es = () => FakeES.all[FakeES.all.length - 1];
  return { L, site, bus, mep, logs, timers, es, n0, stop: () => { L.close(); for (const o of offs) o(); } };
}
const base0 = (mv = 7): any => ({ ...clone(meJson), mv, now: 1000 });
const items = (b: any) => ((b.hero && b.hero.items) || []).map((x: any) => x.uid);

/* ------------------------------------------------------------------ 1. hero patches over SSE */
describe.skipIf(!LIVE)('site-live.js 18.11: `me` + `mep` over the EventSource → the same full hero on the bus', () => {
  it('in-order patches: after every event the bus hero is the site\'s base (LGLiveLink.me())', () => {
    const k = sseLink(), s = k.es();
    expect(s.url).toBe('/api/live?mep=1');
    s.fire('me', JSON.stringify(base0(7)));
    s.fire('mep', JSON.stringify({ mv: 8, h: { money: 4321, hp: 9 } }));
    s.fire('mep', JSON.stringify({ mv: 9, hx: ['hp'], it: { d: [items(k.L.me())[0]] }, now: 2000, gnow: 5 }));
    expect(k.site.length).toBe(3);
    expect(k.bus).toEqual(k.site);
    expect(k.bus[2]).toEqual(JSON.parse(JSON.stringify(k.L.me())));
    expect(k.bus[2].mv).toBe(9); expect(k.bus[2].hero.money).toBe(4321); expect('hp' in k.bus[2].hero).toBe(false);
    expect(k.mep).toEqual([8, 9]);
    k.stop();
  });
  it('a gap: the site reconnects the source (down(\'mep\')); we drop patches until the new source\'s full `me`', () => {
    const k = sseLink(), s = k.es();
    s.fire('me', JSON.stringify(base0(3)));
    s.fire('mep', JSON.stringify({ mv: 5, h: { money: 1 } }));          // 4 is missing
    expect(k.logs.some((t) => /прошу полный/.test(t))).toBe(true);
    expect(s.readyState).toBe(2);                                         // the site closed it
    expect(k.mep).toEqual([null]);
    expect(k.bus.length).toBe(1); expect(k.site.length).toBe(1);
    expect(k.timers.length).toBe(1);
    k.timers.shift()!();                                                  // the site's reconnect
    const s2 = k.es(); expect(s2).not.toBe(s); expect(s2.url).toBe('/api/live?mep=1');
    s2.fire('mep', JSON.stringify({ mv: 4, h: { money: 2 } }));         // a patch before any full `me` on the new source
    expect(k.bus.length).toBe(1); expect(k.site.length).toBe(1);
    expect(s2.readyState).toBe(2);                                        // no base yet: that is a gap too → reconnect
    k.timers.shift()!();
    const s3 = k.es(); expect(s3).not.toBe(s2);
    s3.fire('me', JSON.stringify(base0(20)));
    s3.fire('mep', JSON.stringify({ mv: 21, h: { money: 77 } }));
    s2.fire('mep', JSON.stringify({ mv: 22, h: { money: 1 } }));         // the closed source says nothing more
    expect(k.bus).toEqual(k.site);
    expect(k.bus[k.bus.length - 1].hero.money).toBe(77);
    k.stop();
  });
  it('a broken patch / a `me` without mv: both sides wait for the next full one', () => {
    const k = sseLink(), s = k.es();
    s.fire('me', JSON.stringify({ ...base0(1), mv: undefined }));
    s.fire('mep', JSON.stringify({ mv: 2, h: { money: 1 } }));
    expect(k.site.length).toBe(1); expect(k.bus).toEqual(k.site);
    k.timers.shift()!();
    const s2 = k.es();
    s2.fire('me', JSON.stringify(base0(1)));
    s2.fire('mep', '{oops');
    expect(k.site.length).toBe(2); expect(k.bus).toEqual(k.site);
    k.stop();
  });
  it('300 random events (patches, gaps, reconnects): the bus sequence of heroes is the site\'s', () => {
    const k = sseLink(), r = rng(1118);
    let mv = 10, uid = 1000;
    k.es().fire('me', JSON.stringify(base0(mv)));
    for (let n = 0; n < 300; n++) {
      if (k.timers.length) { k.timers.shift()!(); mv += 5; k.es().fire('me', JSON.stringify(base0(mv))); continue; }
      const p: any = { mv: r() < 0.06 ? mv + 2 : mv + 1 };
      if (r() < 0.6) p.h = { money: Math.floor(r() * 1e5), lvl: Math.floor(r() * 50) };
      if (r() < 0.2) p.hx = ['gt'];
      if (r() < 0.4) { const ids = items(k.L.me() || base0()); p.it = { d: r() < 0.5 && ids.length ? [ids[0]] : [], u: [{ uid: 'n' + uid++, kind: 'x' }] }; if (r() < 0.2) p.it.o = [...ids].reverse(); }
      if (r() < 0.2) p.now = n; if (r() < 0.1) p.gnow = n * 2; if (r() < 0.1) p.r = [{ id: 'r' + n }];
      k.es().fire('mep', JSON.stringify(p));
      if (p.mv === mv + 1) mv = p.mv;
    }
    expect(k.site.length).toBeGreaterThan(200);
    expect(JSON.parse(JSON.stringify(k.bus))).toEqual(JSON.parse(JSON.stringify(k.site)));
    k.stop();
  });
  it('without `me` listeners the site adds no `mep` one either; other names are teed as before', () => {
    const src = fnSource(LIVE!, 'sseOn')!;
    expect(src).toMatch(/if \(n === 'mep'\) return;/);
    const B = g.__L3D_BUS, got: any[] = [];
    const off = B.on('sse:city', (d: any) => got.push(d));
    const es: FakeES = new (g.EventSource as any)('/api/live?sm=1&mep=1');
    es.fire('city', '{"a":1}');
    expect(got).toEqual([{ a: 1 }]);
    off();
  });
});

/* ------------------------------------------------------------------ 2. app.js live link URLs */
describe.skipIf(!APP)('app.js 18.11 LGLiveLink.open: SSE asks for patches (mep=1), the socket URL is unchanged', () => {
  const at = () => APP!.indexOf('window.LGLiveLink.open({');
  it('the sse url builder: mep=1 unless the streamer dock; the bridge\'s tap matches every form', () => {
    const line = /sse: (\(\) => [^\n]+),\n/.exec(APP!.slice(at()))![1];
    const mk = (q: string, DOCK: boolean) => vm.runInNewContext(`(${line})()`, { window: { LG_BASE: '' }, q, DOCK });
    expect(mk('', false)).toBe('/api/live?mep=1');
    expect(mk('?sm=1', false)).toBe('/api/live?sm=1&mep=1');
    expect(mk('?sm=1', true)).toBe('/api/live?sm=1');
    for (const u of [mk('', false), mk('?sm=1', false), mk('', true)]) expect(/\/api\/live/.test(u)).toBe(true);   // bridge.ts EventSource tap
  });
  it('the socket: (wss|ws)://location.host/ws as before — isLiveWs matches it', () => {
    const line = /ws: (\(\) => [^\n]+),\n/.exec(APP!.slice(at()))![1];
    const w = vm.runInNewContext(`(${line})()`, { wsOn: () => true, location: { protocol: 'https:', host: 'localhost' }, window: { LG_CH: { login: 'chan' } }, q: '' });
    expect(w.url).toBe('wss://localhost/ws');
    expect(isLiveWs(w.url)).toBe(true);
  });
});

/* ------------------------------------------------------------------ 3. GU windows */
describe.skipIf(!APP)('app.js 18.11 GU_WIN (style icons added around it)', () => {
  it('src/net/gameui.ts GU_WINDOWS = the keys of the site\'s GU_WIN; guTab unchanged', () => {
    const lit = /const GU_WIN = (\{[^}]*\})/.exec(APP!)![1];
    expect(Object.keys(vm.runInNewContext('(' + lit + ')'))).toEqual([...GU_WINDOWS]);
    expect(fnSource(APP!, 'guTab')).toMatch(/if \(GU_WIN\[id\]\) \{ guWin\(id\); return true; \}/);
  });
});

/* ------------------------------------------------------------------ 4. citymon placeAll */
const gate = (fc as any).BUILDINGS.find((b: any) => b.id === 'gate');
const W: CmWall = { x: gate.door.x, y: gate.door.y, town: 'fair', own: true, glade: (fc as any).GLADE };
function sitePlaceAll(src: string): (...a: any[]) => any {
  const form = /const FORM = \{[^;]*\};/.exec(src)![0];
  const ctx: any = { window: {}, Math, Set, Object, String };
  vm.runInNewContext(form + '\n' + fnSource(src, 'spotsBy') + '\n' + fnSource(src, 'placeAll') + '\nthis.placeAll = placeAll;', ctx);
  return ctx.placeAll;
}
function randomView(r: () => number): { packs: CmPack[]; elites: CmElite[]; soon: CmSoon[]; eSoon: CmSoon[] } {
  const np = 1 + Math.floor(r() * 12), packs: CmPack[] = [];
  for (let i = 0; i < np; i++) {
    const tier = Math.floor(r() * 3), n = 1 + Math.floor(r() * 6);
    packs.push({ pid: 'p' + i, tier, slot: Math.floor(r() * 9), ...(r() < 0.7 ? { idx: Math.floor(r() * n) } : {}), n, lvl: 3, pack: [{ mon: 'wolf' }] });
  }
  const elites: CmElite[] = []; for (let i = 0, ne = Math.floor(r() * 4); i < ne; i++) elites.push({ eid: 'e' + i, epid: 'ep' + i, tier: 2, slot: Math.floor(r() * 5), idx: Math.floor(r() * 3), n: 3 });
  const soon: CmSoon[] = []; for (let i = 0, ns = Math.floor(r() * 4); i < ns; i++) soon.push({ at: i, ...(r() < 0.8 ? { tier: Math.floor(r() * 3) } : {}), slot: Math.floor(r() * 6), ...(r() < 0.5 ? { idx: Math.floor(r() * 3), n: 3 } : {}) });
  const eSoon: CmSoon[] = r() < 0.3 ? [{ at: 9, slot: 1 }] : [];
  return { packs, elites, soon, eSoon };
}
const plan = (P: any) => ({ packs: P.packs.map((x: any) => [x.D.pid, x.k, Math.round(x.p.x), Math.round(x.p.y)]), elites: P.elites.map((x: any) => [x.E.eid, x.k]), soon: P.soon.map((x: any) => [x.D.at, x.k, !!x.D.el]), free: P.free.map((x: any) => x.k) });

describe.skipIf(!CM)('citymon.js 18.11 placeAll: own tier first, a strong pack\'s idx from the far end', () => {
  it('our port = the site\'s placeAll on 500 random views (the glade of the cats fair) and without a glade', () => {
    const site = sitePlaceAll(CM!), r = rng(18);
    for (let n = 0; n < 500; n++) {
      const v = randomView(r), w = n % 10 === 9 ? { ...W, glade: null } : W;
      expect(plan(placeAll(w, v.packs, v.elites, v.soon, v.eSoon)), String(n)).toEqual(plan(site(w, v.packs, v.elites, v.soon, v.eSoon)));
    }
  });
  it.skipIf(!CM17)('the rule really moved: some views land elsewhere than with the 17.11 placeAll', () => {
    const s18 = sitePlaceAll(CM!), s17 = sitePlaceAll(CM17!), r = rng(7);
    let diff = 0;
    for (let n = 0; n < 200; n++) { const v = randomView(r); if (JSON.stringify(plan(s18(W, v.packs, v.elites, v.soon, v.eSoon))) !== JSON.stringify(plan(s17(W, v.packs, v.elites, v.soon, v.eSoon)))) diff++; }
    expect(diff).toBeGreaterThan(0);
    // a returning pack with no tier now falls back to tier 1 (the old site drew no trail for it)
    const P = placeAll(W, [], [], [{ at: 1, slot: 0 }]);
    expect(P.soon.length).toBe(1);
  });
});

/* ------------------------------------------------------------------ 5. LGMineDig */
function siteDig(src: string): any {
  const a = src.indexOf('const r2 = (x) => Math.round(x * 100) / 100;'), b = src.indexOf('return { view, grow, perMin, dayMin, coins, qpView, CAP_EPS };');
  return vm.runInNewContext('(function () {' + src.slice(a, b) + 'return { view, grow, perMin, dayMin, coins, qpView, CAP_EPS }; })()', { Math, Object, Array, String });
}
function randomMe(r: () => number, now: number): any {
  const t = now - Math.floor(r() * 20) * 60000, cap = r() < 0.7 ? 240 * 60000 : 0;
  const q = (L: string) => [0, 1, 2].map((i) => ({ id: L + i, k: ['min', 'work', 'sh', 'res'][Math.floor(r() * 4)], g: 50 + Math.floor(r() * 200), p: 0, ...(r() < 0.2 ? { done: 1 } : {}) }));
  const me: any = { i: 3, day: 0, cap, bag: { c: 1, cx: 1.2, r: { iron: 2 } }, mx: { lv: 2, xp: 10, need: r() < 0.5 ? 0 : 120 }, wk: 3,
    ...(r() < 0.5 ? { news: { b: 1, c: 2, cx: 2 } } : {}), q: { d: q('d'), w: q('w'), ...(r() < 0.6 ? { c: { id: 'c0', min: 40, me: 1, ok: 1 } } : {}) } };
  if (r() < 0.9) {
    me.dr = { t, e: r() < 0.3 ? t + Math.floor(r() * 30) * 60000 : now + 3600e3, r: r() * 3, s: r() * 2, k: 1 + Math.floor(r() * 3), c: r() * 0.5, x: r() * 2, h: r() * 3,
      w: r() < 0.7 ? 1 : 0, q: r() < 0.7 ? 1 : 0, cp: cap, b: { d: cap ? cap - Math.floor(r() * 30) * 60000 : Math.floor(r() * 1e6), c: r() * 50, m: r() * 100, u: r() * 1000,
        ...(r() < 0.5 ? { n: r() * 5 } : {}), ...(r() < 0.5 ? { cm: r() * 60 } : {}),
        qp: [...me.q.d, ...me.q.w].filter(() => r() < 0.7).map((x: any) => [x.id[0], x.id, x.k, r() * 40]) } };
    if (r() < 0.05) me.dr.b = null;
  }
  return me;
}
describe.skipIf(!MINE)('mine.js 18.11 LGMineDig: the mine record recomputed at the server clock', () => {
  it('digView = the site\'s LGMineDig.view on 400 random records', () => {
    const D = siteDig(MINE!), r = rng(42), now = 1_763_000_000_000;
    for (let n = 0; n < 400; n++) {
      const me = randomMe(r, now), at = now + Math.floor(r() * 600) * 1000;
      expect(JSON.parse(JSON.stringify(digView(me, at))), String(n)).toEqual(JSON.parse(JSON.stringify(D.view(me, at))));
    }
    expect(D.CAP_EPS).toBe(CAP_EPS);
    for (const [u, c] of [[0, 0], [59_999, 0], [14_399_100, 14_400_000], [14_398_000, 14_400_000], [99e6, 14_400_000]]) expect(dayMin(u, c)).toBe(D.dayMin(u, c));
  });
  it('a hand case: coins / XP / minutes / week / quests move with the minutes, capped where the site caps them', () => {
    const t = 1_000_000;
    const me: any = { i: 1, day: 0, cap: 60 * 60000, bag: { c: 0, r: {} }, mx: { lv: 1, xp: 0, need: 100 }, wk: 0,
      q: { d: [{ id: 'a', k: 'min', g: 10, p: 0 }], w: [{ id: 'b', k: 'res', g: 2, p: 0 }], c: { id: 'c', min: 30, me: 0 } },
      dr: { t, e: t + 3600e3, r: 2, s: 1, k: 2, c: 3, x: 5, h: 1, w: 1, q: 1, cp: 60 * 60000, b: { d: 50 * 60000, c: 1, m: 90, u: 10, cm: 25, qp: [['d', 'a', 'min', 4], ['w', 'b', 'sh', 0.5]] } } };
    const v = digView(me, t + 4 * 60000);
    // perMin: u = 2, w0 = 1, coin = 3 / min, xp = 5 / min
    expect(v.bag).toEqual({ c: 13, cx: 13, r: {} });
    expect(v.mx.xp).toBe(100);                 // 90 + 20, capped at need
    expect(v.day).toBe(54);
    expect(v.wk).toBe(18);                     // 10 + 2 × 4
    expect(v.q.d[0].p).toBe(8);                // 4 + 4 min
    expect(v.q.w[0].p).toBe(200);              // 'res': hundredths, min(g = 2, 0.5 + 2 × 1 × 4)
    expect(v.q.c).toEqual({ id: 'c', min: 30, me: 33, ok: 1 });
    expect(digView(me, t + 10 * 60000 - 500).day).toBe(60);   // within CAP_EPS of the cap counts as the cap (59.99 min)
    expect(digView(me, t + 20 * 60000).day).toBe(70);          // past the cap: not clipped (the server stops the dig)
    expect(digView({ ...me, dr: { ...me.dr, e: t + 60000 } }, t + 9 * 60000).bag.c).toBe(4);   // nothing after `e`
    expect(me.bag.c).toBe(0);                  // copies, the record itself is untouched
  });
});

/* ------------------------------------------------------------------ 6. the 3D mine follows it */
describe('the 3D mine: MineModel.meNow / meTick, MineClient every 3 s (site meTick; poll)', () => {
  const view = (o: Partial<MineView> = {}): MineView => ({ ...clone((enter as any).st), ...o });
  const dr = (t: number, b: any = { d: 0, c: 0, m: 0, u: 0 }) => ({ t, e: t + 3600e3, r: 1, s: 1, k: 1, c: 2, x: 1, w: 1, q: 0, cp: 0, b });
  it('take(): the record with a dig record is shown at the server clock (clk), without one as it came', () => {
    const now = 1_763_000_000_000, M = new MineModel('me');
    M.clk({ now: now - 5000 }, now);            // the server is 5 s behind our clock
    M.take(view(), { i: -1, day: 0, cap: 0, bag: { c: 0, r: {} }, dr: dr(now - 5000 - 3 * 60000) } as any, null, now);
    expect(M.me!.bag).toEqual({ c: 6, cx: 6, r: {} });
    expect(M.me!.day).toBe(3);
    M.take(null, { i: -1, day: 7, cap: 0, bag: { c: 5, r: {} } } as any, null, now);
    expect(M.me!.day).toBe(7); expect(M.me!.bag!.c).toBe(5);
  });
  it('meTick(): a newer hero record (dr.t) replaces mine, my stone queue kept; an older one is ignored; no view → nothing', () => {
    const now = 1_763_000_000_000, M = new MineModel('me');
    expect(M.meTick(now, { i: 1, day: 0, cap: 0, dr: dr(now) } as any)).toBe(false);
    M.take(view(), { i: 2, day: 0, cap: 0, qq: [4, 5], bag: { c: 0, r: {} }, dr: dr(now - 60000) } as any, null, now);
    expect(M.me!.bag!.c).toBe(2);
    expect(M.meTick(now + 60000, null)).toBe(true);
    expect(M.me!.bag!.c).toBe(4);
    M.meTick(now + 60000, { i: 9, day: 0, cap: 0, bag: { c: 0, r: {} }, dr: dr(now - 120000) } as any);   // older
    expect(M.me!.i).toBe(2);
    M.meTick(now + 60000, { i: 7, day: 0, cap: 0, bag: { c: 0, r: {} }, dr: dr(now, { d: 0, c: 100, m: 0, u: 0 }) } as any);
    expect(M.me!.i).toBe(7); expect(M.me!.qq).toEqual([4, 5]); expect(M.me!.bag!.c).toBe(102);
  });
  it('MineClient: the 3 s interval runs meTick before the poll; nothing while the tab is hidden', async () => {
    let now = 1_763_000_000_000, hidden = false;
    const ticks: (() => void)[] = [];
    const T: Timers = { setInterval: (f: () => void, ms: number) => { if (ms === 3000) ticks.push(f); return ticks.length; }, clearInterval: () => {}, setTimeout: () => 1, clearTimeout: () => {} };
    const e = clone(enter as any); e.now = now; e.me = { ...(e.me || {}), i: -1, day: 0, cap: 0, bag: { c: 0, r: {} }, dr: dr(now) };
    const api = async (p: string) => (p.startsWith('/api/mine/enter') ? e : { ok: true });
    const c = new MineClient({ api, login: 'player1', c: 'home', timers: T, now: () => now, hidden: () => hidden, hero: () => ({ login: 'player1', items: [], mn: { home: {} } }) as any } as any);
    await c.enter({ x: 303, y: 2393 });
    expect(c.model.me!.bag!.c).toBe(0);
    now += 2 * 60000; hidden = true; ticks[0]();
    expect(c.model.me!.bag!.c).toBe(0);
    hidden = false; ticks[0]();
    expect(c.model.me!.bag!.c).toBe(4);
    c.close(true, true);
  });
});

/* ------------------------------------------------------------------ 7. the WASD walk vs our hold */
const KW = siteCopy('mine.js', 'const kwRun = () =>');
describe.skipIf(!KW)('mine.js 18.11: W A S D walk the 2D mine hero every frame — never while the 3D mine holds it', () => {
  const run = (held: boolean, holdLater = false) => {
    const src = KW!, a = src.indexOf('const KW_D = {'), b = src.indexOf('function kwBind()');
    const block = src.slice(a, b) + fnSource(src, 'kwBind');
    const els: any[] = [], ls = new Map<string, ((e: any) => void)[]>(), raf: ((t: number) => void)[] = [], api: string[] = [];
    const mk = (tag: string) => { const e: any = { tagName: tag, className: '', hidden: false, attrs: {} as Record<string, string>, style: { setProperty() {} }, setAttribute(k: string, v: string) { e.attrs[k] = v; }, remove() { const i = els.indexOf(e); if (i >= 0) els.splice(i, 1); } }; return e; };
    const document: any = {
      hidden: false, documentElement: { classList: { add() {}, remove() {}, contains: () => false } }, head: { appendChild: (e: any) => els.push(e) }, body: { appendChild: (e: any) => els.push(e) },
      getElementById: (id: string) => els.find((e) => e.id === id) ?? null, createElement: mk,
      querySelector: (sel: string) => (/\.mn-board-w/.test(sel) || /data-l3d-mnhold/.test(sel) ? els.find((e) => e.className === 'mn-board-w' || 'data-l3d-mnhold' in e.attrs) ?? null : null),
      addEventListener: (t: string, f: (e: any) => void) => { const x = ls.get(t) || []; x.push(f); ls.set(t, x); },
    };
    if (held) holdSiteMine(true, 'k', document);
    const C = 128;
    const ctx: any = {
      S: { st: {}, pos: { x: 200, y: 200 }, el: { querySelector: () => null }, heroes: { querySelector: () => null }, path: null, sel: 0, z: 1, tx: 0, ty: 0 },
      X: { hero: () => ({ kw: 1 }), api: (p: string) => { api.push(p); return Promise.resolve({ ok: true }); } },
      SPEED: 120, GX: () => ({ CW: C, RH: C }), cellOfPt: (x: number, y: number) => (x < 0 || y < 0 ? -1 : Math.floor(x / C) + Math.floor(y / C) * 100),
      centerOf: (c: number) => ({ x: (c % 100) * C + C / 2, y: Math.floor(c / 100) * C + C / 2 }), walkable: () => true, inZone: () => false, freePt: (p: any) => p,
      leaveRock() {}, heroes() {}, exDraw() {}, meNm() {}, npcFar() {}, place() {}, vSize: () => null, clampY() {}, apply() {}, q: () => '?c=home',
      requestAnimationFrame: (f: (t: number) => void) => { raf.push(f); return raf.length; }, setTimeout: () => 1, clearTimeout() {},
      document, window: { addEventListener() {} }, Math, Map, Set, Date, console,
    };
    vm.runInNewContext(block + '\nkwBind();', ctx);
    for (const f of ls.get('keydown') || []) f({ code: 'KeyW', target: null, preventDefault() {}, repeat: false });
    if (holdLater) holdSiteMine(true, 'k', document);
    let t = 1000; for (let i = 0; i < 5 && raf.length; i++) { const f = raf.shift()!; t += 16; f(t); }
    return { moved: 200 - ctx.S.pos.y, api, frames: raf.length };
  };
  it('without our hold a held W walks the 2D hero (and sends /api/mine/go); with holdSiteMine\'s hidden .mn-board-w nothing happens', () => {
    const free = run(false);
    expect(free.moved).toBeGreaterThan(1);
    expect(free.api.some((p) => p.startsWith('/api/mine/go'))).toBe(true);
    const held = run(true);
    expect(held).toEqual({ moved: 0, api: [], frames: 0 });
  });
  it('a hold that comes after the key was pressed stops the walk on the next frame', () => {
    expect(run(false, true)).toEqual({ moved: 0, api: [], frames: 0 });
  });
});

/* ------------------------------------------------------------------ 8. contract */
const C18 = { 'site-live.js': LIVE, 'app.js': APP, 'citymon.js': CM, 'mine.js': MINE } as Record<string, string | null>;
describe.skipIf(!LIVE || !APP || !CM || !MINE)('site-contract.json 18.11 checks match the 18.11 scripts', () => {
  it('the changed and new checks', () => {
    const want = ['site-live.js hero patches: meIn', 'site-live.js hero patches on both transports', 'app.js live link', 'app.js SSE asks for hero patches',
      'app.js GU_WIN + guTab', 'citymon.js placeAll / spotsBy / FORM', 'mine.js LGMineDig', 'mine.js WASD walk (18.11 rAF)', 'mine.js kwBusy'];
    for (const id of want) {
      const c = (contract as any).checks.find((x: any) => x.id.startsWith(id));
      expect(c, id).toBeTruthy();
      expect(new RegExp(c.re).test(C18[c.file]!), id).toBe(true);
    }
  });
  it.skipIf(!CM17)('the citymon check no longer matches the 17.11 placeAll (a change of the rule is seen)', () => {
    const c = (contract as any).checks.find((x: any) => x.id.startsWith('citymon.js placeAll'));
    expect(new RegExp(c.re).test(CM17!)).toBe(false);
  });
});
