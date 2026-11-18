/**
 * Site update 15.11 (night).
 *  - site-live.js: over the WebSocket the hero comes as a full `me` (version `mv`) and then as `mep` patches (meApply);
 *    a version gap makes the site ask for a full one ({op:'live'} — its own send). The bridge must keep the same base
 *    (src/bridge/bridge.ts MeMirror / meApply) and emit the full hero as 'sse:me' — or 3D shows stale money, gear, hp, flags.
 *  - city.js mineOpen: the town's own mine when hero.mn[tc].city (tc = 'edge' for the fair), else 'home'
 *    (src/net/site-mine.ts mineDoorOf → mineIdOf / mineIdOfLayout).
 *  - mine.js: the weekly rebuild (st.cr, another week → toast + back to the City; ≤ 1 h before → a warning), looks of the
 *    diggers asked again after LOOK_MS, presence `u` (looks changed), lampOn with known hero items.
 *  - site-chat.js: the guild invite plaque `#cy-ginv` focuses «Принять» — the 3D input undoes that grab.
 * The site's own code (newest local copy `.local/site-*`, not in the repo) runs here in node:vm; skipped without it.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import vm from 'node:vm';
import { siteCopy, fnSource } from './site-quest-fns';
import { meApply, MeMirror } from '../src/bridge/me-patch';
import { mineDoorOf } from '../src/net/site-mine';
import { mineIdOf } from '../src/rooms/mine';
import { mineIdOfLayout } from '../src/features/mine-status';
import { MineModel, WEEK_DONE, weekSoonText, LOOK_MS, type MineView } from '../src/rooms/mine/state';
import { MineClient, type Timers } from '../src/rooms/mine/net';
import { FOCUS_GRAB_SEL } from '../src/engine/input';
import { isGinv, GINV_HINT, GINV_CSS } from '../src/features/guildinvite';
import meJson from './fixtures/me.json';
import contract from '../src/data/site-contract.json';
import enter from './fixtures/mine-enter.json';

const LIVE = siteCopy('site-live.js', "if (n === 'mep')");
const LIVE15 = siteCopy('site-live.js', "if (n === 'me') {\n            let d = null;");   // the 15.11 … 17.11 shape
const CITY = siteCopy('city.js', "tc = TOWN.id === 'fair' ? 'edge' : TOWN.id");
const MINE = siteCopy('mine.js', 'const LOOK_MS = 60000;');
const CHAT = siteCopy('site-chat.js', 'function ginvShow(');
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));

/* ------------------------------------------------------------------ fakes: the bridge needs a socket */
type Fn = (e: any) => void;
class FakeES { url: string; ls = new Map<string, Fn[]>(); readyState = 0; constructor(u: string) { this.url = u; } addEventListener(t: string, f: Fn) { const a = this.ls.get(t) || []; a.push(f); this.ls.set(t, a); } close() { this.readyState = 2; } fire(t: string, data: string) { for (const f of this.ls.get(t) || []) f({ type: t, data }); } }
class FakeWS {
  static CONNECTING = 0; static OPEN = 1; static CLOSING = 2; static CLOSED = 3;
  static all: FakeWS[] = [];
  url: string; readyState = 0; sent: string[] = []; ls = new Map<string, Fn[]>();
  onopen: Fn | null = null; onmessage: Fn | null = null; onclose: Fn | null = null; onerror: Fn | null = null;
  constructor(url: string) { this.url = String(url); FakeWS.all.push(this); }
  addEventListener(t: string, fn: Fn) { const a = this.ls.get(t) || []; a.push(fn); this.ls.set(t, a); }
  send(t: string) { this.sent.push(t); }
  close() { if (this.readyState < 2) this.readyState = 2; }
  private fire(t: string, ev: any) { for (const fn of this.ls.get(t) || []) fn(ev); const h = (this as any)['on' + t]; if (h) h(ev); }
  open() { this.readyState = 1; this.fire('open', { type: 'open' }); }
  msg(data: string) { if (this.readyState === 1) this.fire('message', { type: 'message', data }); }
  shut(code = 1006) { this.readyState = 3; this.fire('close', { type: 'close', code }); }
}
const g = globalThis as any;
beforeAll(async () => {
  g.window = Object.assign(g, { addEventListener() {}, removeEventListener() {} });
  g.EventSource = FakeES;
  g.WebSocket = FakeWS;
  await import('../src/bridge/bridge');
});

const frame = (e: string, d: unknown) => `{"op":"ev","e":"${e}","d":${JSON.stringify(d)}}`;
/** A sanitized hero snapshot with a version. */
const base0 = (mv = 7): any => ({ ...clone(meJson), mv, now: 1000 });

/** The site's live link (site-live.js in node:vm) on a fake socket, the bridge tapping it. */
function siteLink() {
  const sb: any = { setTimeout, clearTimeout, Math, Date, JSON, Map, String, Object, Array, console };
  sb.self = sb; sb.WebSocket = g.WebSocket; sb.EventSource = g.EventSource;
  vm.runInNewContext(LIVE!, sb);
  const site: any[] = [], bus: any[] = [], mep: (number | null)[] = [], logs: string[] = [];
  const B = g.__L3D_BUS;
  const offs = [B.on('sse:me', (d: any) => bus.push(d)), B.on('live:mep', (v: any) => mep.push(v))];
  const n0 = FakeWS.all.length;
  const L = sb.LGLiveLink.open({ ws: () => ({ url: 'wss://example.org/ws', ch: 'chan', sm: false }), sse: () => '/api/live',
    setTimeout: () => 0, clearTimeout: () => {}, log: (t: string) => logs.push(t) });
  L.addEventListener('me', (e: any) => site.push(JSON.parse(e.data)));
  const s = FakeWS.all[n0];
  s.open(); s.msg('{"op":"hello","user":"u"}'); s.msg('{"op":"liveok"}');
  return { sb, L, s, site, bus, mep, logs, stop: () => { L.close(); for (const o of offs) o(); } };
}

/* ------------------------------------------------------------------ 1. hero patches over the socket */
describe.skipIf(!LIVE)('site-live.js 15.11: `me` + `mep` patches over the WebSocket → full sse:me on the bus', () => {
  it('a run of in-order patches: the bus hero equals the site\'s hero after every frame (money, hp, items, flags, results)', () => {
    const T = siteLink();
    const b = base0(7);
    T.s.msg(frame('me', b));
    const items = b.hero.items, u0 = items[0].uid, u1 = items[1].uid, u2 = items[2].uid;
    const patches = [
      { mv: 8, h: { money: 12345, hp: 77 } },
      { mv: 9, h: { lw: 1, fc: 1 }, hx: ['ghost'], now: 2000 },
      { mv: 10, it: { d: [u1], u: [{ ...items[0], on: true, name: 'Новое имя' }, { uid: 'n-1', id: 'apple', name: 'Яблоко', slot: 'food', rarity: 'common' }] } },
      { mv: 11, it: { o: ['n-1', u0, u2] }, r: [{ id: 'r1', ok: true, x: { op: 'mineBuy', c: 5 } }], cr: { k: 'x' } },
      { mv: 12, fq: { a: 1 }, synced: 3, h: { money: 0 } },
    ];
    for (const p of patches) T.s.msg(frame('mep', p));
    expect(T.site.length).toBe(1 + patches.length);
    expect(T.bus.length).toBe(T.site.length);
    for (let i = 0; i < T.site.length; i++) expect(T.bus[i]).toEqual(T.site[i]);
    const last = T.bus[T.bus.length - 1];
    expect(last.mv).toBe(12);
    expect(last.hero.money).toBe(0); expect(last.hero.hp).toBe(77); expect(last.hero.lw).toBe(1); expect('ghost' in last.hero).toBe(false);
    expect(last.hero.items.map((x: any) => x.uid)).toEqual(['n-1', u0, u2]);
    expect(last.results).toEqual([{ id: 'r1', ok: true, x: { op: 'mineBuy', c: 5 } }]);
    expect(last.synced).toBe(3); expect(last.now).toBe(2000);
    expect(T.mep).toEqual([8, 9, 10, 11, 12]);
    // the bus copy is the bridge's own: a consumer that changes it does not change the next patch's base
    T.bus[T.bus.length - 1].hero.money = 999;
    T.s.msg(frame('mep', { mv: 13, h: { hp: 1 } }));
    expect(T.bus[T.bus.length - 1]).toEqual(T.site[T.site.length - 1]);
    expect(T.bus[T.bus.length - 1].hero.money).toBe(0);
    expect(T.s.sent.map((x) => JSON.parse(x).op)).toEqual(['live']);   // the site's own handshake only
    T.stop();
  });

  it('a version gap: the site asks for a full one (its own send), nothing reaches either side until the full `me`', () => {
    const T = siteLink();
    T.s.msg(frame('me', base0(20)));
    T.s.msg(frame('mep', { mv: 22, h: { money: 1 } }));   // 21 lost
    T.s.msg(frame('mep', { mv: 23, h: { money: 2 } }));   // still waiting for the full one
    expect(T.site.length).toBe(1); expect(T.bus.length).toBe(1);
    expect(T.mep).toEqual([null, null]);
    expect(T.s.sent.map((x) => JSON.parse(x).op)).toEqual(['live', 'live']);   // the site re-subscribes once; the bridge never sends
    const full = base0(30); full.hero.money = 555;
    T.s.msg(frame('me', full));
    T.s.msg(frame('mep', { mv: 31, h: { money: 556 } }));
    expect(T.bus).toEqual(T.site);
    expect(T.bus[T.bus.length - 1].hero.money).toBe(556);
    T.stop();
  });

  it('a patch before any full `me`, a broken patch, a full `me` without mv: the same as the site (no hero from patches)', () => {
    const T = siteLink();
    T.s.msg(frame('mep', { mv: 1, h: { money: 1 } }));
    expect(T.bus.length).toBe(0); expect(T.site.length).toBe(0);
    const nomv = base0(); delete nomv.mv;
    T.s.msg(frame('me', nomv));
    T.s.msg(frame('mep', { mv: 1, h: { money: 1 } }));   // meV null → gap
    T.s.msg('{"op":"ev","e":"mep","d":{bad json}');
    expect(T.bus).toEqual(T.site);
    expect(T.bus.length).toBe(1);
    T.stop();
  });

  it('L.gap() of the site: it asks for a full one, the bridge keeps applying the in-order patches — same hero after the full `me`', () => {
    const T = siteLink();
    T.s.msg(frame('me', base0(5)));
    T.L.gap();
    T.s.msg(frame('mep', { mv: 6, h: { money: 6 } }));   // the site: gap → asks; the bridge: applies
    expect(T.site.length).toBe(1); expect(T.bus.length).toBe(2);
    expect(T.bus[1].hero.money).toBe(6);
    const full = base0(6); full.hero.money = 6;
    T.s.msg(frame('me', full));
    T.s.msg(frame('mep', { mv: 7, h: { money: 7 } }));
    expect(T.bus[T.bus.length - 1]).toEqual(T.site[T.site.length - 1]);
    T.stop();
  });

  it('a new socket starts from nothing (the site drops meBase on reconnect)', () => {
    const T = siteLink();
    T.s.msg(frame('me', base0(3)));
    T.s.shut(1006);
    const m = new MeMirror(); m.full(JSON.stringify(base0(3))); m.reset();
    expect(m.patch(JSON.stringify({ mv: 4 }))).toBeNull();
    T.stop();
  });

  it('our meApply = the site\'s meApply (LGLiveLink.meApply) on 300 random patches', () => {
    const sb: any = { Math, JSON, Map, Object, Array, String }; sb.self = sb;
    vm.runInNewContext(LIVE!, sb);
    const S = sb.LGLiveLink.meApply as (b: any, p: any) => any;
    let seed = 42; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    let a = base0(1), b = base0(1);
    for (let k = 0; k < 300; k++) {
      const ids = a.hero.items.map((x: any) => x.uid), p: any = { mv: a.mv + 1 };
      if (rnd() < 0.6) p.h = { money: Math.floor(rnd() * 1e5), ['f' + Math.floor(rnd() * 5)]: rnd() < 0.5 ? 1 : null };
      if (rnd() < 0.3) p.hx = ['f' + Math.floor(rnd() * 5)];
      if (rnd() < 0.5) {
        p.it = {};
        if (ids.length && rnd() < 0.5) p.it.d = [ids[Math.floor(rnd() * ids.length)]];
        if (rnd() < 0.7) p.it.u = [{ uid: rnd() < 0.5 && ids.length ? ids[Math.floor(rnd() * ids.length)] : 'u' + k, id: 'x', q: k }];
        if (rnd() < 0.2) p.it.o = [...ids].reverse().concat(['missing']);
      }
      for (const [key, q] of [['cr', 0.1], ['r', 0.2], ['fq', 0.1], ['synced', 0.1], ['now', 0.4]] as const) if (rnd() < q) p[key] = key === 'r' ? [{ id: 'r' + k }] : k;
      const pa = clone(p);
      a = meApply(a, p); b = JSON.parse(JSON.stringify(S(b, pa)));
      expect(JSON.parse(JSON.stringify(a))).toEqual(b);
    }
  });

  // 15.11 … 17.11: SSE had no patches. Since 18.11 the EventSource carries `mep` too (the bridge applies them there as
  // well — test/site-1118.test.ts); this pins the old copy only.
  it.skipIf(!LIVE15)('SSE until 17.11: the site handled `mep` only on the socket (18.11: both transports, see site-1118)', () => {
    expect(LIVE15!.slice(LIVE15!.indexOf('function sseOpen'), LIVE15!.indexOf('connect();', LIVE15!.indexOf('function sseOpen')))).not.toContain('mep');
    expect(LIVE15!).not.toContain('function mepIn(');
  });
});

/* ------------------------------------------------------------------ 2. the mine door */
describe.skipIf(!CITY)('city.js 15.11 mineOpen: the town\'s own mine when mn[tc].city, else the channel\'s mine', () => {
  function siteDoor(townId: string, mn: Record<string, unknown> | null): { c: string | null; list: string[] | null; said: string } {
    const out: { c: string | null; list: string[] | null; said: string } = { c: null, list: null, said: '' };
    const ctx: any = {
      S: { bmT: 0 }, TOWN: { id: townId }, MINE_FROM: null, hud: () => {}, setTimeout: () => 0, clearTimeout: () => {},
      X: { hero: () => ({ mn }), toast: (m: string) => { out.said = m; }, openMine: (c: string | null, ids?: string[]) => { out.c = c; out.list = ids || null; } },
    };
    vm.createContext(ctx);
    vm.runInContext('var mnOn = () => !!(X && X.hero() && X.hero().mn && Object.keys(X.hero().mn).length);\n' + fnSource(CITY!, 'mineOpen'), ctx);
    vm.runInContext('mineOpen', ctx)();
    return out;
  }
  const MN = {
    homeOnly: { home: { i: -1 } },
    edgeCity: { home: { i: -1 }, edge: { i: -1, city: 1 } },
    edgeNoCity: { home: { i: -1 }, edge: { i: -1 } },
    d04City: { home: { i: -1 }, d04: { city: true } },
    campCity: { home: {}, camp: { city: 1 } },
    v3: { home: {}, 't-v3': {} },
    none: { d04: {} },
  };
  const LAYOUTS: [string, string][] = [['fair', 'fair'], ['fairc', 'fair'], ['camp', 'camp'], ['d04', 'd04'], ['d12', 'd12']];
  it('every layout × mn case opens the same mine as the site', () => {
    for (const [lay, town] of LAYOUTS) for (const [name, mn] of Object.entries(MN)) {
      const s = siteDoor(town, mn), ours = mineDoorOf(lay, mn);
      const siteKey = s.c ?? (s.list ? s.list[0] : null);
      if (siteKey === null) { expect(s.said, `${lay}/${name}`).toMatch(/Шахта канала откроется/); expect((mn as any)[ours], `${lay}/${name}`).toBeUndefined(); continue; }
      expect(ours, `${lay}/${name}`).toBe(siteKey);
      expect(mineIdOf(lay, mn)).toBe(ours); expect(mineIdOfLayout(lay, mn)).toBe(ours);
    }
  });
  it('the fairs open «edge» only when the server marks it city; without the hero the door is the channel\'s mine', () => {
    expect(mineDoorOf('fairc', MN.edgeCity)).toBe('edge');
    expect(mineDoorOf('fair', MN.edgeNoCity)).toBe('home');
    expect(mineDoorOf('fairc', null)).toBe('home');
    expect(mineIdOf('fairc')).toBe('home');
    expect(mineDoorOf('d04', { toString: { city: 1 } } as any)).toBe('home');   // own keys only
  });
});

/* ------------------------------------------------------------------ 3. the mine: weekly rebuild, looks, lamp */
const view = (o: Partial<MineView> = {}): MineView => ({ ...clone(enter.st as unknown as MineView), v: 1, week: 46, reset: 0, dg: {}, ...o });
describe('mine.js 15.11: the weekly rebuild, LOOK_MS, presence `u`, lampOn', () => {
  it('another week with st.cr → weekDone (the site toasts and leaves for the City); the warning once per week ≤ 1 h before', () => {
    const now = 1_700_000_000_000;
    const M = new MineModel('me');
    M.take(view({ week: 46, cr: 1 }), null, null, now);
    let r = M.take(view({ v: 2, week: 46, cr: 1, reset: now + 30 * 60000 }), null, null, now);
    expect(r.weekSoon).toBe(weekSoonText(now + 30 * 60000, now));
    expect(r.weekSoon).toBe('Через 30 мин шахта обновится - кто будет внутри, выйдет в город');
    r = M.take(view({ v: 3, week: 46, cr: 1, reset: now + 29 * 60000 }), null, null, now);
    expect(r.weekSoon).toBeUndefined();   // once per week
    r = M.take(view({ v: 4, week: 47, cr: 1 }), null, null, now);
    expect(r.weekDone).toBe(true); expect(r.changed).toBe(false);
    expect(M.st!.week).toBe(46);
    // without cr (the old mines) a new week is just a new view
    const M2 = new MineModel('me'); M2.take(view({ week: 46 }), null, null, now);
    expect(M2.take(view({ v: 2, week: 47 }), null, null, now).weekDone).toBeUndefined();
  });
  it('MineClient: a live view of the new week emits `week done` (the room toasts and exits) and applies nothing', async () => {
    const now = 1_700_000_000_000; const T: Timers = { setInterval: () => 1, clearInterval: () => {}, setTimeout: () => 1, clearTimeout: () => {} };
    const api = async (p: string) => (p.startsWith('/api/mine/enter') ? (() => { const e = clone(enter as any); e.st.week = 46; e.st.cr = 1; return e; })() : { ok: true });
    const c = new MineClient({ api, login: 'player1', c: 'home', timers: T, now: () => now, hero: () => ({ login: 'player1', items: [], mn: { home: {} } }) as any });
    const ev: any[] = []; c.on((e) => ev.push(e));
    await c.enter({ x: 303, y: 2393 });
    c.onEvent({ c: 'home', st: { ...clone(enter.st as any), v: (enter.st as any).v + 1, week: 46, cr: 1, reset: now + 10 * 60000 } } as any);
    expect(ev.filter((e) => e.type === 'week')).toEqual([{ type: 'week', phase: 'soon', text: weekSoonText(now + 10 * 60000, now) }]);
    const v0 = c.model.st!.v;
    c.onEvent({ c: 'home', st: { ...clone(enter.st as any), v: v0 + 1, week: 47, cr: 1 } } as any);
    expect(ev.filter((e) => e.type === 'week').pop()).toEqual({ type: 'week', phase: 'done', text: WEEK_DONE });
    expect(c.model.st!.week).toBe(46);
    c.close(true, true);
  });
  it.skipIf(!MINE)('the site\'s take0 lines decide the same (toast texts too)', () => {
    const at = MINE!.indexOf('if (st && S.st && st.cr && S.st.week != null');
    const a = MINE!.slice(at, MINE!.indexOf('\n', at)), b0 = MINE!.indexOf('if (st && st.cr && st.reset > Date.now()'), b = MINE!.slice(b0, MINE!.indexOf('\n', b0));
    const now = 1_700_000_000_000;
    const run = (st: any, prev: any, rsWarn: any) => {
      const out: any = { toast: [], exit: 0 };
      const ctx: any = { S: { st: prev, rsWarn }, X: { toast: (t: string, bad: boolean) => out.toast.push([t, bad]) }, exit: () => { out.exit++; }, Date: { now: () => now }, Math };
      vm.createContext(ctx); vm.runInContext(`(function (st) { ${a}\n${b}\n })`, ctx)(st);
      out.rsWarn = ctx.S.rsWarn; return out;
    };
    const s1 = run({ week: 47, cr: 1 }, { week: 46 }, null);
    expect(s1.exit).toBe(1); expect(s1.toast).toEqual([[WEEK_DONE, true]]);
    const s2 = run({ week: 46, cr: 1, reset: now + 30 * 60000 }, { week: 46 }, null);
    expect(s2.exit).toBe(0); expect(s2.toast).toEqual([[weekSoonText(now + 30 * 60000, now), false]]); expect(s2.rsWarn).toBe(46);
    expect(run({ week: 46, cr: 1, reset: now + 30 * 60000 }, { week: 46 }, 46).toast).toEqual([]);
    expect(run({ week: 47 }, { week: 46 }, null).exit).toBe(0);
    expect(MINE!).toContain(`const LOOK_MS = ${LOOK_MS};`);
  });
  it('a digger\'s look is asked again after LOOK_MS; presence `u` updates a walker\'s look', () => {
    const now = 1_700_000_000_000;
    const M = new MineModel('me');
    M.take(view({ dg: { 1: ['kot'] } }), null, { kot: { lk: { a: 1 } } }, now);
    expect(M.lkWant.has('kot')).toBe(false);
    M.take(view({ v: 2, dg: { 1: ['kot'] } }), null, null, now + LOOK_MS + 1);
    expect(M.lkWant.has('kot')).toBe(true);
    M.presence({ a: [{ l: 'pes', n: 'Пёс', lv: 3, lk: { a: 1 }, x: 0, y: 0, tx: 0, ty: 0 }] }, now);
    expect(M.presence({ u: [['pes', { lk: { b: 2 }, g: { w: 1 }, gh: 0 }], ['nobody', { lk: {} }]] }, now)).toBe(true);
    expect(M.lookOf('pes')).toEqual({ n: 'Пёс', lv: 3, lk: { b: 2 }, g: { w: 1 }, gh: 0 });
    expect(M.others.has('nobody')).toBe(false);
  });
  it.skipIf(!MINE)('the site\'s presence() applies `u` the same way (looks)', () => {
    const src = fnSource(MINE!, 'presence')!;
    const ctx: any = { S: { others: new Map(), nOthers: 0 }, SPEED: 100, Date, Math, cnt: () => {}, console };
    vm.createContext(ctx); vm.runInContext(src, ctx);
    const P = vm.runInContext('presence', ctx);
    P({ a: [{ l: 'pes', lk: { a: 1 }, x: 0, y: 0, tx: 0, ty: 0 }] });
    P({ u: [['pes', { lk: { b: 2 }, g: { w: 1 }, gh: 0 }]] });
    const o = ctx.S.others.get('pes');
    expect(o.lk).toEqual({ b: 2 }); expect(o.v).toEqual({ lk: { b: 2 }, g: { w: 1 }, gh: 0 });
  });
  it('lampOn: with the hero\'s items known only the helmet decides (me.lamp no longer overrides a missing helmet)', () => {
    const M = new MineModel('me');
    M.me = { lamp: 1 } as any;
    M.heroItems = () => [];
    expect(M.lampOn()).toBe(true);   // items unknown: me.lamp
    M.heroItems = () => [{ id: 'apple', uid: '1' }];
    expect(M.lampOn()).toBe(false);
    M.heroItems = () => [{ id: 'miner_helmet', uid: '2', on: true }];
    expect(M.lampOn()).toBe(true);
    M.heroItems = () => [{ id: 'miner_helmet', uid: '2', on: false }];
    expect(M.lampOn()).toBe(false);
  });
});

/* ------------------------------------------------------------------ 4. the guild invite plaque */
describe.skipIf(!CHAT)('site-chat.js 15.11 guild invites: the plaque `#cy-ginv` grabs the focus for «Принять»', () => {
  it('the site focuses its first button on <body>; our focus-grab selector and the feature know the plaque', () => {
    const src = fnSource(CHAT!, 'ginvShow')!;
    expect(src).toContain("el.id = 'cy-ginv'");
    expect(src).toContain('document.body.appendChild(el)');
    expect(src).toMatch(/el\.querySelector\('button'\)\.focus\(/);
    expect(FOCUS_GRAB_SEL).toBe('#cy-ginv');
    expect(isGinv({ nodeType: 1, id: 'cy-ginv' })).toBe(true);
    expect(isGinv({ nodeType: 1, id: 'x' })).toBe(false);
    expect(GINV_HINT).toMatch(/Esc/);
    expect(GINV_CSS).toMatch(/html\.l3d-on:not\(:has\(#l3d-ui\[hidden\]\)\) \.cy-ginv \{ z-index: 166/);   // over our canvas (z 100), not over a site screen
  });
});

/* ------------------------------------------------------------------ 5. the contract checks of this update */
describe.skipIf(!LIVE || !CITY)('site-contract.json 15.11 checks match the 15.11 scripts', () => {
  it('site-live.js frame / hero patches / meApply, the city.js mine door', () => {
    const want = ['site-live.js frame', 'site-live.js hero patches', 'site-live.js meApply', 'city.js mine door'];
    for (const id of want) {
      const c = (contract as any).checks.find((x: any) => x.id.startsWith(id));
      expect(c, id).toBeTruthy();
      expect(new RegExp(c.re).test(c.file === 'city.js' ? CITY! : LIVE!), id).toBe(true);
    }
  });
});
