/**
 * «Шахта 3.0» lift / drill rigs / floors (site mine.js 30.10 16:07: ride, liftFund, drillFund, oreAsk, follow3, keyOf) and the
 * mine UX helpers (objective line, cards). Requests must equal the site's and go out ONLY on the player's action.
 */
import { describe, it, expect } from 'vitest';
import { MineClient, MINE_TAB, type Timers } from '../src/rooms/mine/net';
import { FakeMine, makeBus, applyMine3Demo, demoFromQuery } from '../src/rooms/mine/fake';
import {
  baseOf, keyOf, mineKey, followKey, followOnEnter, rideFloor, rideHold, RIDE_MS, RIDE_MIN, fundButtons, liftInfo, liftPrompt, drillOf, drillFundable, drillPrompt,
  OreAsk, ORE_ASK_MIN, ORE_ASK_MS, objective, type ObjectiveIn,
} from '../src/rooms/mine/fund';
import { liftHtml, drillHtml, shaftHtml, honHtml, oreRowsHtml, bagHtml, objHtml, type FundCtx } from '../src/rooms/mine/hud';
import { MineModel, type MineView, type MineMe } from '../src/rooms/mine/state';
import P3 from './fixtures/mine3-enter.json';

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));
const LOGIN = 'player999';

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
    for (;;) { q.sort((a, b) => a.at - b.at); const t = q[0]; if (!t || t.at > end) break; now = t.at; if (t.every) t.at += t.every; else q.shift(); t.fn(); for (let k = 0; k < 6; k++) await Promise.resolve(); }
    now = end;
  };
  return { T, now: () => now, advance };
}

/** A client on the big floor of the fake game (lift collecting, a drill rig, 3 floors open), every request recorded. */
async function setup(c0 = 'home') {
  const bus = makeBus(), hero: any = { login: LOGIN, money: 5000, items: [
    { uid: 'ore_iron', id: 'ore_iron', name: 'Железная руда', qty: true, q: 340, res: 'iron' },
    { uid: 'ore_coal', id: 'ore_coal', name: 'Уголь', qty: true, q: 215, res: 'coal' },
  ], mn: {} };
  const ent = clone(P3) as any; ent.st.dug = ent.st.dug || '';
  const fake = new FakeMine({ login: LOGIN, enter: ent, hero, bus, digSec: 0.2, bots: false, demo: { lift: 'fund', deep: 3, drill: 'work' } });
  const ck = clock(), calls: { p: string; b: any }[] = [];
  const api = async (p: string, b?: any) => { calls.push({ p, b: b === undefined ? undefined : clone(b) }); return fake.api(p, b); };
  const c = new MineClient({ api, login: LOGIN, c: c0, bus, hero: () => hero, timers: ck.T, now: ck.now });
  expect(await c.enter({ x: 2000, y: 1250 })).toBe(true);
  const acts = () => calls.filter((x) => /^\/api\/mine[A-Z]/.test(x.p));
  return { c, fake, calls, acts, ck, hero };
}

describe('floor keys (site keyOf / CB / open)', () => {
  it('the deepest floor is the mine itself, an upper one «id.floor»; actions but digging use the id without the floor', () => {
    expect(keyOf(3, 3, 'home')).toBe('home');
    expect(keyOf(2, 3, 'home')).toBe('home.2');
    expect(keyOf(1, 3, 'home.2')).toBe('home.1');
    expect(keyOf(5, 3, 'north.2')).toBe('north');
    expect(baseOf('home.3')).toBe('home');
    expect(mineKey('home.3')).toBe('home.3');
    expect(mineKey('home.0')).toBe('home');           // site regexp: floors 1-999 only
    expect(mineKey('../x')).toBe('home');
    expect(rideFloor(9, 3)).toBe(3); expect(rideFloor(0, 3)).toBe(1);
    expect(rideHold(1000, 1100)).toBe(RIDE_MIN - 100); expect(rideHold(1000, 1000 + RIDE_MIN + 5)).toBe(0);
  });
  it('follow3: another floor only on a big floor, not the one on show, not within a minute of an own ride', () => {
    const st = { ...clone(P3.st), n: 3, deep: 3 } as unknown as MineView, me = { i: -1, day: 0, cap: 0, at: 2 } as MineMe;
    expect(followKey(st, me, 'home', 0, 1e9)).toBe('home.2');
    expect(followKey(st, { ...me, at: 3 }, 'home', 0, 1e9)).toBeNull();
    expect(followKey(st, me, 'home', 1e9 - 30_000, 1e9)).toBeNull();
    expect(followKey({ ...st, fl: { ...st.fl!, v3: undefined } } as MineView, me, 'home', 0, 1e9)).toBeNull();
  });
  it('site 31.10: entering from the City, the hero\'s own floor opens before the deepest one is ever shown', async () => {
    const deepSt = { ...clone(P3.st), n: 3, deep: 3 } as unknown as MineView;
    const log: string[] = [];
    const mk = (at: number) => {
      const c = {
        model: { st: deepSt as MineView | null, me: { i: -1, day: 0, cap: 0, at } as MineMe | null },
        c: 'home', rideAt: 0,
        async switchTo(key: string, start: { x: number; y: number }) { log.push(`switch ${key} ${start.x},${start.y}`); c.c = key; c.model.st = { ...deepSt, n: 2 } as MineView; return true; },
      };
      return c;
    };
    const a = mk(2);
    expect(await followOnEnter(a, () => ({ x: 7, y: 9 }), 1e9)).toBe('home.2');
    expect(log).toEqual(['switch home.2 7,9']);
    expect(a.rideAt).toBe(1e9);
    expect(a.model.st!.n).toBe(2);
    // the poll that follows sees the hero's own floor: nothing more to follow (and the minute after a ride)
    expect(followKey(a.model.st, { ...a.model.me!, at: 2 }, a.c, a.rideAt, 1e9 + 1000)).toBeNull();
    log.length = 0;
    expect(await followOnEnter(mk(3), () => ({ x: 0, y: 0 }), 1e9)).toBeNull();   // on the deepest floor: nothing
    expect(log).toEqual([]);
    const b = mk(1); b.switchTo = async () => false;
    expect(await followOnEnter(b, () => ({ x: 0, y: 0 }), 1e9)).toBe(false);
  });
});

describe('lift / drill helpers', () => {
  it('coin buttons 100 / 500 / 1000 below what is left, then «Весь остаток»', () => {
    expect(fundButtons(2350, 6000)).toEqual([{ v: 100, all: false }, { v: 500, all: false }, { v: 1000, all: false }, { v: 3650, all: true }]);
    expect(fundButtons(5700, 6000)).toEqual([{ v: 100, all: false }, { v: 300, all: true }]);
    expect(fundButtons(6000, 6000)).toEqual([]);
  });
  it('lift stage and timer (left minus the age of the view), the prompt says what E does', () => {
    const st = clone(P3.st) as unknown as MineView; applyMine3Demo(st, { lift: 'up', deep: 3 }, 1_000_000);
    const I = liftInfo(st, 1_000_000, 1_000_000 + 60_000);
    expect(I.st).toBe('up'); expect(I.leftMs).toBe(13 * 60000);
    expect(liftPrompt(st, 1_000_000, 1_000_000 + 60_000)).toBe('Лифт — этажи 1–3, выход в город · этаж 4 через 13 мин');
    expect(liftPrompt({ ...st, n: 2 } as MineView, 0, 0)).toBe('Лифт — этажи 1–3, выход в город');
    expect(liftPrompt({ ...st, lift: { st: 'dig' } } as MineView, 0, 0)).not.toMatch(/ищем/);   // no placeholder-like words
  });
  it('drill tuple (site [k, ?, cell, stage, lv, c, need, left, out, cap, rate, res, by])', () => {
    const d = drillOf(['d1', 0, 140, 'work', 1, 800, 3000, 0, 4.5, 60, 2.4, 'iron', [['miner7', 500]]]);
    expect(d).toMatchObject({ k: 'd1', cell: 140, stg: 'work', lv: 1, c: 800, need: 3000, rate: 2.4, res: 'iron', by: [['miner7', 500]] });
    expect(drillFundable(d)).toBe(true);
    expect(drillFundable({ ...d, lv: 3 })).toBe(false);
    expect(drillFundable({ ...d, stg: 'build' })).toBe(false);
    expect(drillPrompt(d)).toBe('Буровая · железо — ур. 1, скинуться на ур. 2');
  });
  it('«Отдать» ore: the first press asks, the second (≥ 350 ms, < 8 s) sends; a double click and another heap only ask', () => {
    const a = new OreAsk();
    expect(a.press('u1', 1000)).toBe('ask');
    expect(a.press('u1', 1000 + ORE_ASK_MIN - 1)).toBe('ignore');   // double click
    expect(a.press('u2', 1500)).toBe('ask');                         // the list moved: another heap only asks
    expect(a.press('u2', 1500 + ORE_ASK_MIN)).toBe('send');
    expect(a.press('u2', 3000)).toBe('ask');                         // after a send: asks again
    expect(a.press('u2', 3000 + ORE_ASK_MS)).toBe('ask');            // too late: asks again
  });
});

describe('client: lift, drill, ride (site bodies, only on action)', () => {
  it('nothing of the lift / drill / ride goes out by itself (polls, pings, a minute of idling)', async () => {
    const { c, acts, ck } = await setup();
    await ck.advance(120_000);
    expect(acts().map((x) => x.p)).toEqual([]);
    c.close();
  });
  it('enter carries the page tab mark (site 29.10 {…start, tab})', async () => {
    const { c, calls } = await setup();
    expect(calls[0]).toEqual({ p: '/api/mine/enter?c=home', b: { x: 2000, y: 1250, tab: MINE_TAB } });
    c.close();
  });
  it('liftFund: coins → {c: CB, coins}; ore heap → {c: CB, coins: 0, lines: [[uid, shards]]}; the heap is hidden after', async () => {
    const { c, acts, fake } = await setup();
    expect(await c.liftFund(500)).toBe(true);
    expect(await c.liftFund(0, [['ore_iron', 340]])).toBe(true);
    expect(acts()).toEqual([{ p: '/api/mineLift', b: { c: 'home', coins: 500 } }, { p: '/api/mineLift', b: { c: 'home', coins: 0, lines: [['ore_iron', 340]] } }]);
    expect(c.fundOre().map((it) => it.uid)).toEqual(['ore_coal']);
    expect(fake.st.lift!.c).toBe(2350 + 500 + Math.floor(340 * (P3.st.bp as any).iron / 100));
    c.close();
  });
  it('a refused contribution says why and sends nothing more', async () => {
    const { c, acts } = await setup(); const tips: string[] = []; c.on((e) => { if (e.type === 'tip') tips.push(e.text); });
    expect(await c.liftFund(999_999)).toBe(false);
    expect(tips.at(-1)).toBe('Не хватает монет');
    expect(acts()).toHaveLength(1);
    c.close();
  });
  it('drillFund: {c: CB, k, coins[, lines]}', async () => {
    const { c, acts } = await setup('home');
    expect(await c.drillFund('d1', 100)).toBe(true);
    expect(await c.drillFund('d1', 0, [['ore_coal', 215]])).toBe(true);
    expect(acts()).toEqual([{ p: '/api/mineDrill', b: { c: 'home', k: 'd1', coins: 100 } }, { p: '/api/mineDrill', b: { c: 'home', k: 'd1', coins: 0, lines: [['ore_coal', 215]] } }]);
    c.close();
  });
  it('one collection request at a time (site busyOp)', async () => {
    const { c, acts } = await setup();
    const a = c.liftFund(100), b = c.liftFund(100);
    expect(await b).toBe(false); expect(await a).toBe(true);
    expect(acts()).toHaveLength(1);
    c.close();
  });
  it('ride (site 31.10 rideGo): mineRide {c: CB, n}, then enter ?c=home.2 in the same mine — no leave, no chat re-entry', async () => {
    const { c, calls, acts } = await setup();
    const ev: string[] = []; c.on((e) => { if (e.type === 'ride') ev.push(e.phase); });
    const chat0 = c.chat.lines.length, n0 = calls.length;
    const p = c.ride(2, { x: 1500, y: 900 });
    expect(ev).toEqual(['start']);                                      // the ride screen at the press, before the game answers
    expect(await p).toBe('home.2');
    for (let k = 0; k < 20 && ev.length < 2; k++) await new Promise((r) => setTimeout(r, 20));
    expect(calls.slice(n0).map((x) => x.p)).toEqual(['/api/mineRide', '/api/mine/enter?c=home.2']);
    expect(calls[n0]).toEqual({ p: '/api/mineRide', b: { c: 'home', n: 2 } });
    expect(calls[n0 + 1].b).toEqual({ x: 1500, y: 900, tab: MINE_TAB });   // site enter(false): the spawn point
    expect(ev).toEqual(['start', 'arrived']);
    expect(c.riding).toBeNull(); expect(c.model.rideF).toBe(0);
    expect(c.c).toBe('home.2'); expect(c.cb).toBe('home');
    expect(c.model.st!.n).toBe(2);
    expect(c.chat.lines.length).toBe(chat0);                            // the shared mine chat is not entered again
    // from an upper floor: the collections and the ride still name the mine without the floor; the chat too
    expect(await c.liftFund(100)).toBe(true);
    expect(acts().at(-1)).toEqual({ p: '/api/mineLift', b: { c: 'home', coins: 100 } });
    expect(c.chatQ).toBe('?c=home');
    expect(await c.ride(3, { x: 1500, y: 900 })).toBe('home');
    expect(acts().at(-1)).toEqual({ p: '/api/mineRide', b: { c: 'home', n: 3 } });
    c.close();
  });
  it('ride: the screen holds until the chosen floor’s view; other floors’ views and a poll of the previous floor are not applied', async () => {
    const ck = clock(), st3 = clone(P3.st) as unknown as MineView, calls: string[] = [];
    let enterSt: MineView = { ...st3, n: 3, v: 50 }, stateSt: MineView | null = null, slow: ((r: any) => void) | null = null;
    const api = async (p: string, b?: any) => {
      calls.push(p);
      if (p === '/api/mineRide') return { ok: true };
      if (p.startsWith('/api/mine/enter')) return { ok: true, sid: 's1', st: clone(enterSt), mchat: { chat: [{ id: 'x' + calls.length, l: 'a', t: 'hi', s: calls.length }], c: calls.length } };
      if (p.startsWith('/api/mine/state') && p.includes('slow')) return new Promise((r) => { slow = r; });
      if (p.startsWith('/api/mine/state')) return { ok: true, n: 0, st: stateSt ? clone(stateSt) : undefined };
      return { ok: true };
    };
    const c = new MineClient({ api, login: LOGIN, c: 'home', timers: ck.T, now: ck.now });
    expect(await c.enter({ x: 1, y: 1 })).toBe(true);
    const lines0 = c.chat.lines.length;
    const ev: string[] = []; c.on((e) => { if (e.type === 'ride') ev.push(e.phase + (e.wait != null ? ':' + e.wait : '')); });
    // a poll of floor 3 still on its way when the lift goes
    const old = (c as any).q; (c as any).q = function () { return old.call(this) + '&slow'; };
    const late = c.poll(); (c as any).q = old;
    // the game still answers with floor 3's view (shared v, even a newer one): ignored, the screen stays
    enterSt = { ...st3, n: 3, v: 60 };
    expect(await c.ride(1, { x: 5, y: 5 })).toBe('home.1');
    await ck.advance(0);
    expect(c.model.st!.n).toBe(3); expect(c.model.st!.v).toBe(50); expect(ev).toEqual(['start']);
    expect(c.chat.lines.length).toBe(lines0);
    // the late poll of floor 3 comes back after the ride started: not applied
    slow!({ ok: true, n: 0, st: { ...st3, n: 3, v: 70 } }); await ck.advance(0);
    expect(c.model.st!.v).toBe(50); void late;
    // ride polls: every 1.5 s, the whole view (no v= / f=), forced even with a live channel
    stateSt = { ...st3, n: 3, v: 80 };
    await ck.advance(1500);
    const polls = calls.filter((p) => p.startsWith('/api/mine/state') && !p.includes('slow'));
    expect(polls.at(-1)).toMatch(/^\/api\/mine\/state\?c=home\.1&sid=s1(&mc=\d+)?$/);
    expect(c.model.st!.n).toBe(3); expect(ev).toEqual(['start']);
    // floor 1's view — even with a lower v (v is shared by the floors) — is drawn and the ride ends
    stateSt = { ...st3, n: 1, v: 10 };
    await ck.advance(1500);
    expect(c.model.st!.n).toBe(1); expect(ev).toEqual(['start', 'arrived:0']);
    // nothing of the previous floor: no leave was sent at all
    expect(calls.some((p) => p.startsWith('/api/mine/leave'))).toBe(false);
    c.close();
  });
  it('ride: no view of the chosen floor in RIDE_MS — back to the previous floor (enter ?c=<from>), screen off', async () => {
    const ck = clock(), st3 = clone(P3.st) as unknown as MineView, calls: string[] = [];
    const api = async (p: string) => { calls.push(p); if (p.startsWith('/api/mine/enter')) return { ok: true, sid: 's1', st: { ...st3, n: 3 } }; if (p.startsWith('/api/mine/state')) return { ok: true, n: 0, st: { ...st3, n: 3 } }; return { ok: true }; };
    const c = new MineClient({ api, login: LOGIN, c: 'home', timers: ck.T, now: ck.now });
    await c.enter({ x: 1, y: 1 });
    const ev: string[] = []; c.on((e) => { if (e.type === 'ride') ev.push(e.phase); });
    expect(await c.ride(2, { x: 5, y: 5 })).toBe('home.2');
    await ck.advance(RIDE_MS + 10);
    expect(ev).toEqual(['start', 'failed']); expect(c.c).toBe('home'); expect(c.riding).toBeNull();
    expect(calls.filter((p) => p.startsWith('/api/mine/enter'))).toEqual(['/api/mine/enter?c=home', '/api/mine/enter?c=home.2', '/api/mine/enter?c=home']);
    c.close();
  });
  it('ride refused: screen off, nothing entered; no walking is sent while the lift goes', async () => {
    const { c, calls } = await setup();
    const ev: string[] = []; c.on((e) => { if (e.type === 'ride') ev.push(e.phase); });
    expect(await c.ride(9 as number, { x: 1, y: 1 }) === null || ev.includes('start')).toBe(true);
    c.close();
    const ck = clock(), out: string[] = [];
    const api = async (p: string) => { out.push(p); return p === '/api/mineRide' ? { ok: false, error: 'Этаж ещё не открыт' } : { ok: true, sid: 's', st: clone(P3.st) }; };
    const d = new MineClient({ api, login: LOGIN, c: 'home', timers: ck.T, now: ck.now });
    await d.enter({ x: 1, y: 1 });
    const ev2: string[] = []; d.on((e) => { if (e.type === 'ride') ev2.push(e.phase); });
    expect(await d.ride(2, { x: 1, y: 1 })).toBeNull();
    expect(ev2).toEqual(['start', 'refused']); expect(d.c).toBe('home');
    expect(out.filter((p) => p.startsWith('/api/mine/enter'))).toHaveLength(1);
    // while riding the feet do not go out
    const e = new MineClient({ api: async (p: string) => { out.push(p); return p.startsWith('/api/mine/enter') ? { ok: true, sid: 's', st: clone(P3.st) } : { ok: true }; }, login: LOGIN, c: 'home', timers: ck.T, now: ck.now });
    await e.enter({ x: 1, y: 1 });
    expect(await e.ride(1, { x: 1, y: 1 })).toBe("home.1"); out.length = 0;
    e.moveTo(900, 900, true);
    expect(out.filter((p) => p.startsWith('/api/mine/go'))).toEqual([]);
    void calls; d.close(); e.close();
  });
  it('a floor switch accepts the other floor’s view even with a lower version (the model is told it is fresh)', () => {
    const M = new MineModel(LOGIN), st = clone(P3.st) as unknown as MineView;
    M.take({ ...st, v: 900 }, null, null, 0);
    M.reset();
    const r = M.take({ ...st, v: 3, n: 2 }, null, null, 1);
    expect(r.newFloor).toBe(true); expect(M.st!.n).toBe(2);
  });
});

describe('cards (HTML) and the objective line', () => {
  const st = clone(P3.st) as unknown as MineView; applyMine3Demo(st, { lift: 'fund', deep: 3, drill: 'work' }, 0);
  const f: FundCtx = { rows: [{ uid: 'u1', name: 'Железная руда', q: 340, price: 180 }], ask: new OreAsk(), now: 10, stAt: 0, busy: false, money: 700, me: 'miner7' };
  it('lift card: «В город», every open floor but the current one rides, coin buttons, ore rows, who chipped in', () => {
    const h = liftHtml(st, f);
    expect(h).toContain('data-a="exit"');
    expect(h.match(/data-a="ride" data-f="\d"/g)).toHaveLength(3);
    expect(h).toMatch(/data-f="3"[^>]*disabled/);       // you are here
    expect(h).not.toMatch(/data-f="1"[^>]*disabled/);
    expect(h).toMatch(/data-a="lfund" data-v="100"(?![^>]*disabled)/);
    expect(h).toMatch(/data-a="lfund" data-v="1000"[^>]*disabled/);   // 700 coins: not enough
    expect(h).toContain('data-a="lore" data-uid="u1" data-q="340"');
    expect(h).toContain('Скинулись');
    expect(h).toMatch(/<b class="me">miner7<\/b>/);
  });
  it('the ore button turns into «Точно отдать …?» after the first press', () => {
    const ask = new OreAsk(); ask.press('u1', 0);
    expect(oreRowsHtml(f.rows, ask, 'lore', 100, false)).toContain('Точно отдать 3,4 шт.?');
    expect(oreRowsHtml(f.rows, new OreAsk(), 'lore', 100, false)).toContain('Отдать ≈');
  });
  it('drill card: stage, output, collection for the next level; shaft card; honour board; bag', () => {
    const d = drillOf(st.drills![0]);
    const h = drillHtml(d, f);
    expect(h).toContain('Буровая · железо · ур. 1'); expect(h).toContain('На ур. 2'); expect(h).toContain('data-a="dfund"'); expect(h).toContain('data-a="dore"');
    expect(drillHtml({ ...d, stg: 'build', left: 25 * 60000 }, f)).toMatch(/Стройка ур\. 2: готово через <b>25 мин<\/b>/);
    expect(drillHtml(null, f)).toContain('Буровой здесь нет');
    expect(shaftHtml({ ...st, n: 2 } as MineView)).toContain('воспользуйся лифтом');
    expect(shaftHtml(st)).toContain('data-a="tolift"');
    const hon = honHtml({ ...st, top: [['a', 9], ['player999', 5]] } as MineView, 5, 'Player999');
    expect(hon).toContain('2-е место'); expect(hon).toContain('player999 (ты)');
    const bag = bagHtml({ rows: f.rows, total: 6, ob: { cap: 20, used: 3 }, lamp: 'bag', lampUid: 'h1', earn: 0.8, buyerOn: true, wait: '' });
    expect(bag).toContain('3 / 20 ячеек'); expect(bag).toContain('data-a="wear" data-uid="h1"'); expect(bag).toContain('data-a="buyer"');
  });
  const base = (o: Partial<ObjectiveIn> = {}): ObjectiveIn => ({ st, me: null, myI: -1, dark: false, lampHave: false, pickOn: true, buyerOn: true, capFull: false, canClaim: false, oreValue: 0, v3: true, other: false, stAt: 0, now: 0, ...o });
  it('objective: the most urgent next step, never a dead end', () => {
    expect(objective(base({ other: true })).k).toBe('tab');
    expect(objective(base({ dark: true })).t).toMatch(/купи «Каску шахтёра» у Снабженца/);
    expect(objective(base({ dark: true, lampHave: true })).act).toBe('wear');
    expect(objective(base({ canClaim: true })).act).toBe('quests');
    expect(objective(base({ capFull: true })).t).toMatch(/05:00/);
    expect(objective(base({ oreValue: 40 })).act).toBe('buyer');
    expect(objective(base()).t).toMatch(/Скинься у лифта на этаж 4/);
    expect(objective(base({ st: { ...st, n: 2 } as MineView })).k).toBe('upper');
    expect(objective(base({ st: { ...st, lift: { st: 'dig' } } as MineView })).k).toBe('shaft');
    expect(objective(base({ v3: false })).t).toMatch(/нажми E/);
    expect(objHtml(objective(base()))).toContain('data-act="lift"');
  });
  it('the dev page demo parameters', () => {
    expect(demoFromQuery('?lift=fund&deep=4&drill=site')).toMatchObject({ lift: 'fund', deep: 4, drill: 'site' });
    expect(demoFromQuery('?lift=x&deep=0')).not.toHaveProperty('lift');
  });
});
