import { describe, it, expect } from 'vitest';
import { MineClient, type Timers } from '../src/rooms/mine/net';
import { digSpot, centerOf, cellXY, type Pt } from '../src/rooms/mine/geo';
import { FakeMine, makeBus } from '../src/rooms/mine/fake';
import enter from './fixtures/mine-enter.json';

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));
const LOGIN = 'player1';

/**
 * The site's request, copied from mine.js (site build 28.10 14:50, queueRock + bwOf) — the reference our body must equal:
 *   const bwOf = (pt) => ({ k: 1, vh: document.hidden ? 1 : 0, ...(pt ? { pt: [Math.round(pt.x), Math.round(pt.y)] } : {}) });
 *   const cur = ((S.me && S.me.qq) || S.qq || []).filter((x) => x !== i);
 *   const qq = [...cur, i].slice(-2);
 *   const sp = centerOf(digSpot(S.myI) ?? cellOfPt(S.pos.x, S.pos.y));
 *   X.api('/api/mineDig', { i: S.myI, c: C, sid: S.sid, x: sp.x, y: sp.y, q: qq, ...bwOf(pt) })
 */
function siteQueueBody(S: { myI: number; me: { qq?: number[] } | null; qq: number[]; sid: string; dug: number[]; hidden: boolean }, C: string, i: number, pt: Pt | null) {
  const bwOf = (p: Pt | null) => ({ k: 1, vh: S.hidden ? 1 : 0, ...(p ? { pt: [Math.round(p.x), Math.round(p.y)] } : {}) });
  const cur = ((S.me && S.me.qq) || S.qq || []).filter((x) => x !== i);
  const qq = [...cur, i].slice(-2);
  const sp = centerOf(digSpot(S.dug, S.myI)!);
  return { i: S.myI, c: C, sid: S.sid, x: sp.x, y: sp.y, q: qq, ...bwOf(pt) };
}

/** Timers that never fire on their own (advance by hand). */
function clock() {
  let now = 5_000_000; const q: { at: number; fn: () => void; every?: number; id: number }[] = []; let id = 0;
  const T: Timers = {
    setInterval: (fn, ms) => { q.push({ at: now + ms, fn, every: ms, id: ++id }); return id; },
    clearInterval: (h) => { const k = q.findIndex((x) => x.id === h); if (k >= 0) q.splice(k, 1); },
    setTimeout: (fn, ms) => { q.push({ at: now + ms, fn, id: ++id }); return id; },
    clearTimeout: (h) => { const k = q.findIndex((x) => x.id === h); if (k >= 0) q.splice(k, 1); },
  };
  const advance = async (ms: number) => {
    const end = now + ms;
    for (;;) { q.sort((a, b) => a.at - b.at); const t = q[0]; if (!t || t.at > end) break; now = t.at; if (t.every) t.at += t.every; else q.shift(); t.fn(); await Promise.resolve(); await Promise.resolve(); }
    now = end;
  };
  return { T, now: () => now, advance };
}

/** A client in the captured mine, the day not used up; fx.q on/off. Every request is recorded. */
async function setup(fxq: boolean) {
  const calls: { p: string; b: any }[] = [];
  const ent = clone(enter) as any;
  ent.me.day = 0; ent.me.fx = { ...(ent.me.fx || {}), ...(fxq ? { q: 1 } : {}) };
  const api = async (p: string, b?: any) => {
    calls.push({ p, b });
    const path = p.replace(/\?.*$/, '');
    if (path === '/api/mine/enter') return clone(ent);
    if (path === '/api/mine/state') return { ok: true };
    return { ok: true };
  };
  const ck = clock();
  const c = new MineClient({ api, login: LOGIN, c: 'home', timers: ck.T, now: ck.now, hidden: () => false });
  await c.enter({ x: 400, y: 2380 });
  const M = c.model;
  const front = (M.st!.front || []).filter((i) => digSpot(M.dug, i) != null && M.F!.cells[i].t !== 'wall');
  return { c, M, calls, ck, front, ent };
}
const digs = (calls: { p: string; b: any }[]) => calls.filter((x) => x.p === '/api/mineDig');

describe('stone queue (site fx.q, Shift+E)', () => {
  it('sends exactly the site body for the same action', async () => {
    const { c, M, calls, front } = await setup(true);
    const [a, b, d] = front;
    const spot = centerOf(digSpot(M.dug, a)!);
    expect(await c.dig(a, spot, { x: cellXY(a).cx, y: cellXY(a).cy })).toBe(true);
    // 1st Shift+E on stone b, aimed at its centre
    const ptB = { x: cellXY(b).cx, y: cellXY(b).cy };
    const S = { myI: M.myI, me: M.me, qq: [] as number[], sid: c.sid, dug: M.dug, hidden: false };
    const want1 = siteQueueBody(S, 'home', b, ptB);
    expect(await c.enqueue(b, spot, ptB)).toBe(true);
    const got1 = digs(calls).at(-1)!.b;
    expect(got1).toEqual(want1);
    expect(JSON.stringify(got1)).toBe(JSON.stringify(want1));   // same keys in the same order
    // 2nd: stone d goes after b
    const ptD = { x: cellXY(d).cx + 7.4, y: cellXY(d).cy - 3.6 };
    const want2 = siteQueueBody({ ...S, me: M.me, qq: c.qq }, 'home', d, ptD);
    await c.enqueue(d, spot, ptD);
    expect(JSON.stringify(digs(calls).at(-1)!.b)).toBe(JSON.stringify(want2));
    expect(want2.q).toEqual([b, d]);
    expect(c.queue()).toEqual([b, d]);
    // 3rd: Shift+E on b again moves it to the end (site: filter + append + slice(-2))
    const want3 = siteQueueBody({ ...S, me: M.me, qq: c.qq }, 'home', b, ptB);
    await c.enqueue(b, spot, ptB);
    expect(digs(calls).at(-1)!.b).toEqual(want3);
    expect(c.queue()).toEqual([d, b]);
  });

  it('the plain dig body is the site one too (no q)', async () => {
    const { c, M, calls, front } = await setup(true);
    const a = front[0], spot = centerOf(digSpot(M.dug, a)!), pt = { x: cellXY(a).cx, y: cellXY(a).cy };
    await c.dig(a, spot, pt);
    // site clickRock → walkTo(sp) → { i, c: C, sid: S.sid, x: at.x, y: at.y, ...bwOf(pt) } with at = centerOf(sp)
    expect(JSON.stringify(digs(calls).at(-1)!.b)).toBe(JSON.stringify({ i: a, c: 'home', sid: c.sid, x: spot.x, y: spot.y, k: 1, vh: 0, pt: [pt.x, pt.y] }));
  });

  it('without fx.q or while not digging: no queue request (the caller digs as usual)', async () => {
    const off = await setup(false);
    await off.c.dig(off.front[0], centerOf(digSpot(off.M.dug, off.front[0])!));
    const n = off.calls.length;
    expect(await off.c.enqueue(off.front[1], { x: 0, y: 0 })).toBe(false);
    expect(off.calls.length).toBe(n);
    const idle = await setup(true);
    const n2 = idle.calls.length;
    expect(await idle.c.enqueue(idle.front[1], { x: 0, y: 0 })).toBe(false);
    expect(idle.calls.length).toBe(n2);
  });

  it('nothing is sent by itself: timers, views and a queue-given stone never dig / stop / sell', async () => {
    const { c, M, calls, ck, front, ent } = await setup(true);
    const [a, b] = front, spot = centerOf(digSpot(M.dug, a)!);
    await c.dig(a, spot); await c.enqueue(b, spot);
    const n = calls.filter((x) => /mineDig|mineStop|mineBuy|mineSell|mineClaim|minePick|mineOreBag|mineLamp/.test(x.p)).length;
    expect(n).toBe(2);
    // the game finished a and gave b from the queue (view: we dig b now), many poll ticks pass
    const st = clone(ent.st); st.v += 10; st.dug = st.dug.split('').map((ch: string, k: number) => (k === a ? '1' : ch)).join('');
    st.dg = { [b]: [LOGIN] }; st.bl = { [b]: [100, 100, 10, 1] };
    c.onEvent({ c: 'home', st, me: { ...ent.me, day: 0, i: b, qq: [] } } as any);
    expect(M.myI).toBe(b);
    await ck.advance(10 * 60_000);
    const after = calls.filter((x) => /mineDig|mineStop|mineBuy|mineSell|mineClaim|minePick|mineOreBag|mineLamp/.test(x.p)).length;
    expect(after).toBe(n);
  });

  it('stop / a plain dig / a new floor forget the queue (as the site)', async () => {
    const { c, M, front } = await setup(true);
    const [a, b, d] = front, spot = centerOf(digSpot(M.dug, a)!);
    await c.dig(a, spot); await c.enqueue(b, spot);
    expect(c.queue()).toEqual([b]);
    await c.dig(d, centerOf(digSpot(M.dug, d)!));
    expect(c.queue()).toEqual([]);
    await c.enqueue(b, spot);
    await c.stop();
    expect(c.queue()).toEqual([]);
  });

  it('the offline fake takes the next queued stone itself', async () => {
    const bus = makeBus(), hero: any = { login: LOGIN, money: 0, items: [], mn: {} };
    const ent = clone(enter) as any; ent.me.fx = { ...ent.me.fx, q: 1 };
    const fake = new FakeMine({ login: LOGIN, enter: ent, hero, bus, bots: false, digSec: 1, demo: { fxq: true, econ: true } });   // econ: the captured work is re-based to now
    try {
      const front = (fake.st.front || []).slice(0, 2);
      expect((await fake.api('/api/mineDig', { i: front[0], c: 'home', sid: 'x', x: 0, y: 0, k: 1, vh: 0 })).ok).toBe(true);
      expect((await fake.api('/api/mineDig', { i: front[0], c: 'home', sid: 'x', x: 0, y: 0, q: [front[1]], k: 1, vh: 0 })).ok).toBe(true);
      expect(fake.me.qq).toEqual([front[1]]);
      fake.st.bl![front[0]][0] = 0.001;   // the captured stone has hours of work left: finish it now
      await new Promise((r) => setTimeout(r, 700));
      expect(fake.me.i).toBe(front[1]);
      expect(fake.me.qq).toEqual([]);
    } finally { fake.dispose(); }
  });
});
