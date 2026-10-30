import { describe, it, expect } from 'vitest';
import { MineModel, stoneProgress, gotText, floorOf } from '../src/rooms/mine/state';
import { MineClient, GO_MS, mineFloorKey, type Timers } from '../src/rooms/mine/net';
import { makeBus } from '../src/rooms/mine/fake';
import enter from './fixtures/mine-enter.json';
import state from './fixtures/mine-state.json';
import sse from './fixtures/mine-sse.json';

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));
const LOGIN = 'player1';

/** Manual clock + timers for deterministic client tests. */
function clock() {
  let now = 1_000_000; const q: { at: number; fn: () => void; every?: number; id: number }[] = []; let id = 0;
  const T: Timers = {
    setInterval: (fn, ms) => { q.push({ at: now + ms, fn, every: ms, id: ++id }); return id; },
    clearInterval: (h) => { const k = q.findIndex((x) => x.id === h); if (k >= 0) q.splice(k, 1); },
    setTimeout: (fn, ms) => { q.push({ at: now + ms, fn, id: ++id }); return id; },
    clearTimeout: (h) => { const k = q.findIndex((x) => x.id === h); if (k >= 0) q.splice(k, 1); },
  };
  const advance = async (ms: number) => {
    const end = now + ms;
    for (;;) {
      q.sort((a, b) => a.at - b.at);
      const t = q[0]; if (!t || t.at > end) break;
      now = t.at; if (t.every) t.at += t.every; else q.shift();
      t.fn(); await Promise.resolve(); await Promise.resolve();
    }
    now = end;
  };
  return { T, now: () => now, advance };
}
function fakeApi(over: Record<string, (b: any, p: string) => any> = {}) {
  const calls: { p: string; b: any }[] = [];
  const api = async (p: string, b?: any) => {
    calls.push({ p, b });
    const path = p.replace(/\?.*$/, '');
    if (over[path]) return over[path](b, p);
    if (path === '/api/mine/enter') return clone(enter);
    if (path === '/api/mine/state') return clone(state);
    return { ok: true, id: 'x1' };
  };
  return { api, calls };
}
const hero = () => ({ login: LOGIN, money: 5000, items: [
  { uid: 'o1', qty: true, q: 250, res: 'iron', name: 'Железо' }, { uid: 'o2', qty: true, q: 130, res: 'coal', name: 'Уголь' },
  { uid: 'h1', id: 'miner_helmet', on: true },
] });

describe('mine model', () => {
  it('parses the floor and progress', () => {
    const st = (enter as any).st;
    const F = floorOf(st)!; expect(F.cells.length).toBe(84); expect(F.biome).toBe('meadow');
    const pr = stoneProgress(st, 11, st.at)!;
    expect(pr.p).toBeCloseTo(1 - st.bl[11][0] / st.bl[11][1]); expect(pr.n).toBe(st.bl[11][3]);
    expect(stoneProgress(st, 11, st.at + 10 * 60000)!.p).toBeGreaterThan(pr.p);
  });
  it('rejects late views, keeps the layout for views without fl, detects bursts', () => {
    const M = new MineModel(LOGIN), st = clone((enter as any).st);
    M.take(st, (enter as any).me, null, 0);
    expect(M.F!.cells.length).toBe(84);
    const late = { ...clone(st), v: st.v - 3 }; delete late.fl;
    expect(M.take(late, null, null, 10).changed).toBe(false);
    const next = { ...clone(st), v: st.v + 1 }; delete next.fl;
    const d = next.dug.split(''); const i = st.front[0]; d[i] = '1'; next.dug = d.join('');
    next.dl = [[i, st.n, 'iron', {}, { [LOGIN]: 237 }]];
    next.dg = { ...st.dg }; delete next.dg[i];
    (st.dg[i] = st.dg[i] || []).push(LOGIN);   // I was digging it in the previous view
    M.st!.dg = st.dg;
    const r = M.take(next, null, null, 20);
    expect(r.changed).toBe(true); expect(M.F).not.toBeNull();
    expect(r.bursts).toEqual([{ i, mine: true, got: { r: 'iron', q: 237, any: 1, loot: null } }]);
    expect(gotText(237, 'iron')).toBe('+2 железо и 37 осколков');
  });
  it('own choice wins over late views (want), walking away is kept (left)', () => {
    const M = new MineModel(LOGIN), st = clone((enter as any).st);
    M.take(st, null, null, 0);
    M.want = { i: st.front[1], at: 0 };
    M.take({ ...clone(st), v: st.v + 1 }, null, null, 1000);
    expect(M.myI).toBe(st.front[1]);
    M.take({ ...clone(st), v: st.v + 2 }, null, null, 16000);
    expect(M.myI).toBe(-1);   // 15 s passed, the view never confirmed it
  });
  it('presence: a / m / g, interpolation at the site speed', () => {
    const M = new MineModel(LOGIN);
    M.presence({ a: [{ l: 'p2', x: 100, y: 2300, tx: 360, ty: 2300 }] }, 0, true);
    expect(M.others.size).toBe(1);
    expect(M.posOf(M.others.get('p2')!, 500).x).toBeCloseTo(230);   // 260 px/s
    M.presence({ m: [['p3', 0, 0, 10, 10, 0]] }, 0); expect(M.lkWant.has('p3')).toBe(true);
    M.presence({ g: ['p2'] }, 0); expect(M.others.has('p2')).toBe(false);
  });
});

describe('mine client mirrors mine.js requests', () => {
  it('enter → poll (with v, f, sid) → go throttle → leave', async () => {
    const C = clock(), { api, calls } = fakeApi();
    const c = new MineClient({ api, login: LOGIN, c: 'home', timers: C.T, now: C.now, hero });
    expect(await c.enter({ x: 303, y: 2393 })).toBe(true);
    expect(calls[0]).toEqual({ p: '/api/mine/enter?c=home', b: { x: 303, y: 2393, tab: expect.stringMatching(/^[0-9a-f]{16}$/) } });   // site 29.10: the page's tab mark
    expect(c.sid).toBe((enter as any).sid);
    await C.advance(3000);
    const poll = calls.find((x) => x.p.startsWith('/api/mine/state'))!;
    const st = (enter as any).st;
    expect(poll.p).toContain(`?c=home&v=${st.v}&f=${encodeURIComponent(st.seed + '.' + st.n)}&sid=${(enter as any).sid}`);
    expect(poll.b).toBeUndefined();   // GET
    // walking: at most one go per GO_MS, payload {x, y, fx, fy}
    const n0 = calls.length;
    for (let k = 1; k <= 20; k++) { c.moveTo(303 + k * 10, 2393); await C.advance(50); }
    c.moveTo(520, 2393, true);
    const gos = calls.slice(n0).filter((x) => x.p.startsWith('/api/mine/go'));
    expect(gos.length).toBeLessThanOrEqual(Math.ceil(1000 / GO_MS) + 2);
    expect(gos[0].p).toBe('/api/mine/go?c=home');
    expect(Object.keys(gos[0].b).sort()).toEqual(['fx', 'fy', 'x', 'y']);
    expect(gos[gos.length - 1].b).toMatchObject({ x: 520, y: 2393 });
    await C.advance(60000);
    expect(calls.some((x) => x.p === '/api/mine/ping?c=home')).toBe(true);
    c.close();
    expect(calls[calls.length - 1]).toEqual({ p: '/api/mine/leave?c=home', b: {} });
    const allowed = /^\/api\/mine\/(enter|state|go|ping|leave)\?c=home/;
    expect(calls.every((x) => allowed.test(x.p))).toBe(true);   // presence only: nothing was dug, sold or bought
  });
  it('with a live channel polls only every 10th tick', async () => {
    const C = clock(), { api, calls } = fakeApi(), bus = makeBus();
    const c = new MineClient({ api, login: LOGIN, c: 'home', timers: C.T, now: C.now, bus });
    await c.enter({ x: 303, y: 2393 });
    c.model.lkWant.clear();
    for (let k = 0; k < 9; k++) { bus.emit('sse:mine', { c: 'home', here: 5 }); await C.advance(3000); }
    expect(calls.filter((x) => x.p.startsWith('/api/mine/state')).length).toBeLessThanOrEqual(1);
    c.close();
  });
  it('polls with mc= (no live channel), not once the single chat window feeds the mine tab (chat.poll = false); f= is the site floor key', async () => {
    for (const poll of [true, false]) {
      const C = clock(), { api, calls } = fakeApi(), c = new MineClient({ api, login: LOGIN, c: 'home', timers: C.T, now: C.now });
      await c.enter({ x: 303, y: 2393 });
      expect(c.chat.on).toBe(true); c.chat.poll = poll;
      await C.advance(3000);
      const q = calls.filter((x) => x.p.startsWith('/api/mine/state')).map((x) => x.p);
      expect(q.length).toBeGreaterThan(0);
      expect(q.every((p) => /mc=/.test(p) === poll)).toBe(true);
      expect(q.every((p) => new URLSearchParams(p.split('?')[1]).get('f') === mineFloorKey(c.model.st!))).toBe(true);
      c.close();
    }
  });
  it('dig: checks front/reach, sends {i,c,sid,x,y,pt} (site 30.10: no k / vh); stop sends {c,sid}', async () => {
    const C = clock(), { api, calls } = fakeApi();
    const c = new MineClient({ api, login: LOGIN, c: 'home', timers: C.T, now: C.now, hero });
    await c.enter({ x: 303, y: 2393 });
    c.model.me!.day = 0;
    const st = (enter as any).st, i = st.front[0];
    expect(await c.dig(i, { x: 300, y: 2400 })).toBe(false);   // too far
    expect(calls.some((x) => x.p === '/api/mineDig')).toBe(false);
    const nonFront = st.fl.c.findIndex((x: any, j: number) => x[0] === 'rock' && st.dug[j] === '0' && !st.front.includes(j));
    expect(await c.dig(nonFront, { x: 0, y: 0 })).toBe(false);
    const sp = { x: 64 + (i % 7) * 128 + 64, y: 420 + Math.floor(i / 7) * 128 + 64 + 128 + 34 };
    expect(await c.dig(i, sp, { x: 500, y: 600 })).toBe(true);
    const d = calls.find((x) => x.p === '/api/mineDig')!;
    expect(d.b).toEqual({ i, c: 'home', sid: c.sid, x: sp.x, y: sp.y, pt: [500, 600] });
    expect(c.model.myI).toBe(i);
    await c.stop();
    expect(calls[calls.length - 1]).toEqual({ p: '/api/mineStop', b: { c: 'home', sid: c.sid } });
    expect(c.model.myI).toBe(-1);
    c.close();
  });
  it('daily cap blocks digging like the site', async () => {
    const C = clock(), { api } = fakeApi();
    const c = new MineClient({ api, login: LOGIN, timers: C.T, now: C.now, hero });
    await c.enter({ x: 303, y: 2393 });
    expect(c.digBlock((enter as any).st.front[0])).toMatch(/На сегодня хватит/);
    c.close();
  });
  it('sell: buyer window → /api/mineBuy {c, lines, price}, result through the hero channel', async () => {
    const C = clock(), { api, calls } = fakeApi(), bus = makeBus();
    const c = new MineClient({ api, login: LOGIN, c: 'home', timers: C.T, now: C.now, hero, bus });
    await c.enter({ x: 303, y: 2393 });
    c.model.me!.fx = { m2: 1, b: 1 };
    expect(await c.sell()).toBe(true);
    const b = calls.find((x) => x.p === '/api/mineBuy')!.b;
    const bp = (enter as any).st.bp;
    expect(b).toEqual({ c: 'home', lines: [['o1', 250], ['o2', 130]], price: Math.floor((250 * bp.iron + 130 * bp.coal) / 100 + 1e-9) });
    expect(c.buyWait).not.toBeNull();
    const tips: string[] = []; c.on((e) => { if (e.type === 'tip') tips.push(e.text); });
    bus.emit('sse:me', { results: [{ id: 'x1', ok: true, x: { op: 'mineBuy', c: 6 } }] });
    expect(c.buyWait).toBeNull(); expect(tips[0]).toMatch(/Скупщик заплатил 6/);
    c.close();
  });
  it('old mines (no buyer window) sell with /api/mineSell {c}', async () => {
    const C = clock(), { api, calls } = fakeApi();
    const c = new MineClient({ api, login: LOGIN, c: 'edge', timers: C.T, now: C.now, hero });
    await c.enter({ x: 303, y: 2393 });
    c.model.me!.fx = { m2: 1 };
    await c.sell();
    expect(calls[calls.length - 1]).toEqual({ p: '/api/mineSell', b: { c: 'edge' } });
    c.close();
  });
  it('supplier and helmet payloads', async () => {
    const C = clock(), { api, calls } = fakeApi();
    const c = new MineClient({ api, login: LOGIN, c: 'home', timers: C.T, now: C.now, hero });
    await c.enter({ x: 303, y: 2393 });
    await c.pick(1, ['copper']); c.supWait = null;
    await c.oreBag(); await c.lamp(); await c.claim();
    expect(calls.slice(-4)).toEqual([
      { p: '/api/minePick', b: { c: 'home', to: 1, use: ['copper'] } }, { p: '/api/mineOreBag', b: { c: 'home' } },
      { p: '/api/mineLamp', b: { c: 'home' } }, { p: '/api/mineClaim', b: { c: 'home' } },
    ]);
    c.close();
  });
  it('applies captured SSE mine events (views and moves)', async () => {
    const C = clock(), { api } = fakeApi(), bus = makeBus();
    const c = new MineClient({ api, login: LOGIN, c: 'home', timers: C.T, now: C.now, bus });
    await c.enter({ x: 303, y: 2393 });
    const v0 = c.model.st!.v; let moves = 0;
    c.on((e) => { if (e.type === 'presence') moves++; });
    for (const d of sse as any[]) bus.emit('sse:mine', d);
    expect(c.model.st!.v).toBeGreaterThan(v0);
    expect(c.model.F!.cells.length).toBe(84);   // views without fl keep the layout
    expect(moves).toBeGreaterThan(0);
    c.close();
  });
});
