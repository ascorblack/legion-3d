/**
 * «Шахта 3.0» lift / drill rigs / floors (site mine.js 30.10 16:07: ride, liftFund, drillFund, oreAsk, follow3, keyOf) and the
 * mine UX helpers (objective line, cards). Requests must equal the site's and go out ONLY on the player's action.
 */
import { describe, it, expect } from 'vitest';
import { MineClient, MINE_TAB, type Timers } from '../src/rooms/mine/net';
import { FakeMine, makeBus, applyMine3Demo, demoFromQuery } from '../src/rooms/mine/fake';
import {
  baseOf, keyOf, mineKey, followKey, rideFloor, rideDelay, fundButtons, liftInfo, liftPrompt, drillOf, drillFundable, drillPrompt,
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
    expect(rideDelay(3, 3)).toBe(300); expect(rideDelay(2, 3)).toBe(2500);
  });
  it('follow3: another floor only on a big floor, not the one on show, not within a minute of an own ride', () => {
    const st = { ...clone(P3.st), n: 3, deep: 3 } as unknown as MineView, me = { i: -1, day: 0, cap: 0, at: 2 } as MineMe;
    expect(followKey(st, me, 'home', 0, 1e9)).toBe('home.2');
    expect(followKey(st, { ...me, at: 3 }, 'home', 0, 1e9)).toBeNull();
    expect(followKey(st, me, 'home', 1e9 - 30_000, 1e9)).toBeNull();
    expect(followKey({ ...st, fl: { ...st.fl!, v3: undefined } } as MineView, me, 'home', 0, 1e9)).toBeNull();
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
  it('ride: {c: CB, n}, then the mine re-opens on that floor (leave, enter ?c=home.2) — as the site open()', async () => {
    const { c, calls, acts } = await setup();
    const r = await c.ride(2);
    expect(r).toEqual({ key: 'home.2', delay: 2500, f: 2 });
    expect(acts()).toEqual([{ p: '/api/mineRide', b: { c: 'home', n: 2 } }]);
    const n0 = calls.length;
    expect(await c.switchTo(r!.key, { x: 2000, y: 1250 })).toBe(true);
    expect(calls.slice(n0).map((x) => x.p)).toEqual(['/api/mine/leave?c=home', '/api/mine/enter?c=home.2']);
    expect(c.c).toBe('home.2'); expect(c.cb).toBe('home');
    expect(c.model.st!.n).toBe(2);
    // from an upper floor: the collections and the ride still name the mine without the floor; the chat too
    expect(await c.liftFund(100)).toBe(true);
    expect(acts().at(-1)).toEqual({ p: '/api/mineLift', b: { c: 'home', coins: 100 } });
    expect(c.chatQ).toBe('?c=home');
    const back = await c.ride(3);
    expect(back).toEqual({ key: 'home', delay: 300, f: 3 });
    expect(acts().at(-1)).toEqual({ p: '/api/mineRide', b: { c: 'home', n: 3 } });
    c.close();
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
