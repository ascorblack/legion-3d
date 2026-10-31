import { describe, it, expect } from 'vitest';
import { MineClient, type Timers } from '../src/rooms/mine/net';
import { makeBus } from '../src/rooms/mine/fake';
import { createF8Gate, F8_GAP_MS } from '../src/content/f8';
import enter from './fixtures/mine-enter.json';
import state from './fixtures/mine-state.json';

/** The 3D mine client behind the classic site (F8): what it sends while held and when it comes back. */
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));
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
function client() {
  const calls: string[] = [];
  const api = async (p: string) => {
    calls.push(p.replace(/&.*$/, ''));
    const path = p.replace(/\?.*$/, '');
    if (path === '/api/mine/enter') return clone(enter);
    if (path === '/api/mine/state') return clone(state);
    return { ok: true };
  };
  const ck = clock(), bus = makeBus();
  const c = new MineClient({ api: api as any, login: 'player1', c: 'home.3', bus, timers: ck.T, now: ck.now, hero: () => ({ login: 'player1', items: [] }) as any });
  return { c, calls, ck, bus };
}

describe('MineClient.hold (F8 behind the classic site)', () => {
  it('held: no polls, no pings, no leave, live events ignored — for minutes', async () => {
    const { c, calls, ck, bus } = client();
    await c.enter({ x: 100, y: 100 });
    calls.length = 0;
    c.hold(true);
    let states = 0; c.on((e) => { if (e.type === 'state') states++; });
    bus.emit('sse:mine', { c: 'home.3', st: (state as any).st });
    await ck.advance(5 * 60_000);
    expect(calls).toEqual([]);
    expect(states).toBe(0);
  });
  it('back without a takeover by the site: one state read, no enter', async () => {
    const { c, calls, ck } = client();
    await c.enter({ x: 100, y: 100 });
    c.hold(true); calls.length = 0;
    c.hold(false, false); await ck.advance(10);
    expect(calls.filter((p) => !p.startsWith('/api/mine/state'))).toEqual([]);
    expect(calls.filter((p) => p.startsWith('/api/mine/state')).length).toBe(1);
  });
  it('back after the site\'s mine took the presence («Копать здесь»): exactly one enter, same floor, no leave', async () => {
    const { c, calls, ck } = client();
    await c.enter({ x: 100, y: 100 });
    c.hold(true); calls.length = 0;
    c.hold(false, true); await ck.advance(10);
    expect(calls).toEqual(['/api/mine/enter?c=home.3']);
  });
  it('close(false): the site\'s own mine sends the leave — ours sends nothing; close() leaves as before', async () => {
    const a = client(); await a.c.enter({ x: 1, y: 1 }); a.calls.length = 0;
    a.c.close(false); expect(a.calls).toEqual([]);
    const b = client(); await b.c.enter({ x: 1, y: 1 }); b.calls.length = 0;
    b.c.close(); expect(b.calls).toEqual(['/api/mine/leave?c=home.3']);
  });
});

describe('F8 fires once per press (QA: holding F8 toggled twice)', () => {
  it('auto-repeat ignored, a second press within the gap ignored, busy (boot / mine switch) ignored', () => {
    const ok = createF8Gate();
    expect(ok(false, 1000, false)).toBe(true);
    expect(ok(true, 1500, false)).toBe(false);                  // held key: repeat events
    expect(ok(false, 1000 + F8_GAP_MS - 1, false)).toBe(false);  // bounce
    expect(ok(false, 2000, true)).toBe(false);                  // a switch still in progress
    expect(ok(false, 2001, false)).toBe(true);
  });
});
