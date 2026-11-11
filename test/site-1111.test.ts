/**
 * Site update 11.11 (afternoon): the mine UI rework (mine.js).
 *  - LGMineShares (UMD at the top of mine.js): the ore share split → src/rooms/mine/shares.ts (1:1 port);
 *  - me.ex / me.pw / st.bl [U, P, pd] / st.fl.ch: «Получишь: …» over a stone (expectOf) → loot.ts expectOf, the aimed-stone
 *    sign and prompt (econ.ts withExpect), «Сейчас» in the HUD;
 *  - me.lg: the hero's own log (logLine / lgAll / myLog) and the loot toasts (dugToast / toastFromLog) → loot.ts + MineHud;
 *  - st.dl d[6] = how many got ore (gotOf `any`);
 *  - newsCheck: no «Пока тебя не было» over a player who already acted (S.acted); newsHero: me.news from hero.mn[c];
 *  - pinSet / pickNeed / pinDraw: «Новая кирка: что нужно» pinned on screen → MineHud pickNeed / pinHtml;
 *  - exit(): /api/mine/leave {out: 1, sid} when leaving the mine for the city.
 * When a downloaded site copy is around (.local/site-*), the site's own code runs here (node:vm) against ours on the same
 * inputs; without one those parity cases are skipped and only our own expectations run.
 */
import { describe, it, expect } from 'vitest';
import vm from 'node:vm';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { splitShards, project, projectAll } from '../src/rooms/mine/shares';
import { expectOf, exText, exCoins, lootOfCell, logLine, lgAll, myLog, dugToast, toastFromLog, lootText, LOG_EMPTY, type LgEntry, type ExpectCtx } from '../src/rooms/mine/loot';
import { withExpect, signText, promptEcon, estimateStone } from '../src/rooms/mine/econ';
import { MineModel, NewsGate, TX, resName, gotText, blockTitle, floorOf, NEWS_WINDOW, type MineView, type MineMe, type Cell, type Burst } from '../src/rooms/mine/state';
import { MineClient, type Timers } from '../src/rooms/mine/net';
import { pickNeed, pinHtml, toastHtml, pickPay } from '../src/rooms/mine/hud';
import { siteCopy, fnSource } from './site-quest-fns';
import enter from './fixtures/mine-enter.json';

const MINE = siteCopy('mine.js', 'root.LGMineShares = M');
const INV = siteCopy('inventory.js', 'const oreQty = (q) =>');
const ML = 'player1';
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));

/** The site's LGMineShares module (the UMD head of mine.js) run alone in node:vm. */
function siteShares(): { splitShards: typeof splitShards; project: (o: any) => Record<string, number>; projectAll: (o: any) => Record<string, Record<string, number>> } | null {
  if (!MINE) return null;
  const end = MINE.indexOf('return { splitShards, project, projectAll };');
  if (end < 0) return null;
  const head = MINE.slice(0, MINE.indexOf('});', end) + 3);
  const ctx: any = { Set, Map, Object, Array, Math, String, Number };
  ctx.self = ctx; vm.createContext(ctx); vm.runInContext(head, ctx, { timeout: 5000 });
  return ctx.LGMineShares || null;
}
/** One whole line of the site copy that starts (after indentation) with `head`. */
function lineOf(src: string, head: string): string | null {
  const at = src.indexOf('\n  ' + head); if (at < 0) return null;
  return src.slice(at + 1, src.indexOf('\n', at + 1));
}
/** mulberry32: deterministic random cases. */
const rng = (seed: number) => () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const SH = siteShares();

/* ------------------------------------------------------------------ LGMineShares */

describe('LGMineShares port (shares.ts)', () => {
  it('splits whole shards: floors, a shard for everyone ok, the rest by the largest remainder', () => {
    expect(splitShards(250, [['a', 3], ['b', 1]])).toEqual({ a: 188, b: 62 });
    expect(splitShards(2, [['a', 10], ['b', 1], ['c', 1]])).toEqual({ a: 2 });            // not enough for everyone: by weight
    expect(splitShards(3, [['a', 10], ['b', 1], ['c', 1]])).toEqual({ a: 1, b: 1, c: 1 });  // enough: one each
    expect(splitShards(3, [['a', 10], ['b', 1], ['c', 1]], new Set(['a']))).toEqual({ a: 3 });
    expect(splitShards(0, [['a', 1]])).toEqual({});
    expect(splitShards(10, [['a', 0]])).toEqual({});
    const r = splitShards(1000, [['x', 1], ['y', 1], ['z', 1]]);
    expect(Object.values(r).reduce((a, v) => a + v, 0)).toBe(1000);
    expect(r).toEqual({ x: 334, y: 333, z: 333 });                                          // tie → login order
  });
  it('project: a fresh stone is all mine; work done by others cuts my part', () => {
    expect(project({ loot: { iron: 300 }, by: {}, left: 1, dig: [], me: ML, pw: 1 })).toEqual({ iron: 300 });
    expect(project({ loot: { iron: 300 }, by: { '~': 1 }, left: 1, dig: [], me: ML, pw: 1 })).toEqual({ iron: 150 });
    expect(project({ loot: { iron: 300 }, paid: { iron: 100 }, by: { '~': 1 }, left: 1, dig: [['~', 1]], me: ML, pw: 1 })).toEqual({ iron: 50 });   // 200 left after pay-outs; me ½ of the work left = ¼ of all
    expect(projectAll({ loot: { iron: 4, coal: 1 }, by: { a: 1, b: 1 } })).toEqual({ a: { iron: 2, coal: 1 }, b: { iron: 2 } });
  });
  it.skipIf(!SH)('equals the site\'s own module on 3000 random splits and projections', () => {
    const R = rng(1111), L = ['~', 'player1', 'ann', 'bob', 'cid'];
    for (let n = 0; n < 1500; n++) {
      const k = 1 + Math.floor(R() * 5), ls: [string, number][] = [];
      for (let j = 0; j < k; j++) ls.push([L[j], R() < 0.15 ? 0 : Math.round(R() * 1000) / 10]);
      const T = Math.floor(R() * 900), ok = R() < 0.3 ? new Set([L[0], L[2]]) : null;
      expect(splitShards(T, ls, ok)).toEqual({ ...SH!.splitShards(T, clone(ls), ok) });
    }
    for (let n = 0; n < 1500; n++) {
      const loot: Record<string, number> = { iron: Math.floor(R() * 600) }; if (R() < 0.4) loot.coal = Math.floor(R() * 300);
      const by: Record<string, number> = R() < 0.5 ? {} : { '~': R() * 50 }; if (R() < 0.3) by[ML] = R() * 20;
      const dig: [string, number][] = R() < 0.5 ? [] : [['~', R() * 3]]; if (R() < 0.3) dig.push([ML, 1.2]);
      const o = { loot, paid: R() < 0.3 ? { iron: Math.floor(R() * 100) } : undefined, by, left: R() * 40, dig, me: ML, pw: R() < 0.5 ? 1 : 1.35, ok: R() < 0.2 ? ['~'] : undefined };
      expect(project(clone(o) as any)).toEqual({ ...SH!.project(clone(o)) });
    }
  });
});

/* ------------------------------------------------------------------ expectOf («Получишь: …») */

/** A small classic floor: our fixture with a few chosen stones. */
function view() {
  const st = clone((enter as any).st) as MineView, me = clone((enter as any).me) as MineMe;
  const F = floorOf(st)!;
  const ore = F.cells.find((c) => c.r && c.a > 0 && (c.t === 'ore' || c.t === 'rare') && !+st.dug[c.i])!;
  // a stone without ore: the fixture's next free stone, its ore taken out ([type, level, resource, a])
  const r0 = F.cells.find((c) => c.i !== ore.i && c.t !== 'wall' && !+st.dug[c.i])!;
  (st.fl!.c as any)[r0.i] = ['rock', r0.lv, '', 0];
  const F2 = floorOf(st)!;
  return { st, me, F: F2, ore: F2.cells[ore.i], rock: F2.cells[r0.i] };
}
const ctxOf = (st: MineView, me: MineMe, myI = -1): ExpectCtx => {
  const F = floorOf(st)!; return { st, F, dug: st.dug.split('').map((c) => (c === '1' ? 1 : 0)), me, myI, login: ML };
};

/** The site's lootOfCell + expectOf run in node:vm over the same S. */
function siteExpect(): ((c: ExpectCtx, i: number, now: number) => any) | null {
  if (!MINE || !SH) return null;
  const src = [fnSource(MINE, 'lootOfCell'), fnSource(MINE, 'expectOf')];
  if (src.some((s) => !s)) return null;
  return (c, i, now) => {
    const ctx: any = { window: { LGMineShares: SH }, S: { st: c.st, F: c.F, dug: c.dug, me: c.me, myI: c.myI }, X: { login: () => c.login }, Date: { now: () => now }, Object, Math };
    vm.createContext(ctx); vm.runInContext(src.join('\n'), ctx);
    return JSON.parse(JSON.stringify(ctx.expectOf(i)));
  };
}
const SITE_EX = siteExpect();

describe('expectOf (loot.ts) — «Получишь» over a stone', () => {
  it('fresh stone → all its ore is mine, exact; a stone without ore → only pay; dug → null', () => {
    const { st, me, ore, rock } = view(), now = st.at;
    delete st.bl![ore.i];
    const x = expectOf(ctxOf(st, me), ore.i, now)!;
    expect(x).toEqual({ s: { [ore.r!]: Math.round(ore.a * 100) }, exact: true });
    expect(exText(x)).toBe(lootText(x.s));
    expect(exText(expectOf(ctxOf(st, me), rock.i, now))).toBe('без руды - только оплата за работу');
    const d = st.dug.split(''); d[ore.i] = '1'; st.dug = d.join('');
    expect(expectOf(ctxOf(st, me), ore.i, now)).toBeNull();
  });
  it('a stone others work on: the share by work, marked «≈»', () => {
    const { st, me, ore } = view(), now = st.at + 60000;
    st.bl![ore.i] = [40, 100, 2, 2, 30, 2, 0];
    const x = expectOf(ctxOf(st, me), ore.i, now)!;
    expect(x.exact).toBe(false);
    const all = Math.round(ore.a * 100), mine = x.s[ore.r!] || 0;
    expect(mine).toBeGreaterThan(0); expect(mine).toBeLessThan(all);
    expect(exText(x)).toMatch(/^≈ \+/);
  });
  it('my own stone: the game\'s me.ex wins', () => {
    const { st, me, ore } = view();
    st.bl![ore.i] = [40, 100, 2, 1, 0, 1, 0];
    me.ex = [st.n, ore.i, { [ore.r!]: 123 }];
    expect(expectOf(ctxOf(st, me, ore.i), ore.i, st.at)).toEqual({ s: { [ore.r!]: 123 }, exact: true, game: true });
    expect(expectOf(ctxOf(st, me, -1), ore.i, st.at)!.game).toBeUndefined();   // not mine any more → projected
  });
  it('chests read their loot from st.fl.ch', () => {
    const { st, me, F, rock } = view();
    (st.fl!.c as any)[rock.i] = ['chest', rock.lv, '', 0];
    st.fl!.ch = { [rock.i]: { iron: 40, coal: 20 } };
    const F2 = floorOf(st)!; void F;
    expect(lootOfCell(st, F2, rock.i)).toEqual({ iron: 40, coal: 20 });
    expect(expectOf(ctxOf(st, me), rock.i, st.at)!.s).toEqual({ iron: 40, coal: 20 });
  });
  it.skipIf(!SITE_EX)('equals the site\'s own expectOf on random stones (node:vm)', () => {
    const R = rng(77), { st: st0, me: me0, F } = view();
    const stones = F.cells.filter((c) => !+st0.dug[c.i] && c.t !== 'wall');
    for (let n = 0; n < 400; n++) {
      const st = clone(st0), me = clone(me0), c = stones[Math.floor(R() * stones.length)];
      me.pw = R() < 0.5 ? 1 : 1.2;
      const mine = R() < 0.3;
      if (R() < 0.7) { const left = 10 + R() * 90; st.bl![c.i] = [left, 100, R() * 4, 1 + Math.floor(R() * 3), R() < 0.5 ? R() * 40 : 0, R() * 3, R() < 0.3 ? Math.floor(R() * 50) : 0]; }
      else delete st.bl![c.i];
      if (mine && R() < 0.5) me.ex = [st.n, c.i, { [c.r || 'stone']: Math.floor(R() * 300) }];
      const cx = ctxOf(st, me, mine ? c.i : -1), now = st.at + Math.floor(R() * 5 * 60000);
      expect(expectOf(cx, c.i, now), `cell ${c.i}`).toEqual(SITE_EX!(cx, c.i, now));
    }
  });
  it('the sign and the prompt say «получишь» and price it at the buyer', () => {
    const { st, me, ore } = view(), now = st.at;
    delete st.bl![ore.i]; st.bp = { ...(st.bp || {}), [ore.r!]: 10 };
    const x = expectOf(ctxOf(st, me), ore.i, now)!;
    expect(exCoins(x, st.bp)).toBeCloseTo(ore.a * 10, 5);
    const e = withExpect(estimateStone(st, ore as Cell, now), x, st.bp);
    expect(e.get).toBe(lootText(x.s));
    expect(signText(e, false).share).toBe(`получишь: ${lootText(x.s)}`);
    expect(promptEcon(e)).toContain(`получишь: ${lootText(x.s)}`);
    expect(promptEcon(e)).not.toContain('доля');
    expect(withExpect(estimateStone(st, ore as Cell, now), null, st.bp).get).toBeUndefined();   // no projection → as before
  });
});

/* ------------------------------------------------------------------ me.lg: log lines and toasts */

/** The site's logLine / lgAll / dugToast / toastFromLog in node:vm (tx, resName, gotText, blockTitle are ours — tested elsewhere). */
function siteLog() {
  if (!MINE || !INV) return null;
  const fns = ['logLine', 'lgAll', 'dugToast', 'toastFromLog'].map((n) => fnSource(MINE, n));
  const lines = ['const PRIZE_RU =', 'const lootText =', 'const oreQty =', 'const lgLocal =', 'const sameDug ='].map((h) => lineOf(MINE, h));
  const inv = lineOf(INV, 'const oreQty =');
  if (fns.some((f) => !f) || lines.some((l) => !l) || !inv) return null;
  return (S: any, now: number) => {
    const toasts: any[] = [];
    const ctx: any = {
      S, Date: { now: () => now }, Object, Math, String, Array, console,
      tx: () => TX, resName, gotText, blockTitle, logNow: () => {},
      oskQ: (q: number) => ctx.LGInv(q), lootToast: (s: any, head: string, sub: string) => toasts.push({ s: s ? { ...s } : null, head, sub }),
    };
    vm.createContext(ctx);
    vm.runInContext(`${inv.replace('const oreQty', 'var LGInv')}\n${lines.join('\n')}\n${fns.join('\n')}`, ctx);
    return { ctx, toasts };
  };
}
const SITE_LOG = siteLog();
const LG: LgEntry[] = [
  { at: 9, k: 'dug', n: 3, i: 11, t: 'ore', lv: 3, s: { iron: 237, coal: 40 } },
  { at: 8, k: 'dug', n: 3, i: 12, t: 'rock', lv: 3 },
  { at: 7, k: 'part', lv: 4, s: { coal: 5 } },
  { at: 6, k: 'rare', r: 'ruby' },
  { at: 5, k: 'prize', p: 'enchant_star' },
  { at: 4, k: 'sell', c: 120, s: { iron: 300 } },
  { at: 3, k: 'buy', s: {} },
  { at: 2, k: 'lift', c: 40 },
  { at: 1, k: 'drill', r: 'iron', c: 15 },
  { at: 0, k: 'claim', c: 70 },
  { at: 0, k: 'chest' as any },
  { at: 0, k: 'dug', n: 3, i: 13, t: 'chest', s: { iron: 40 } },
];

describe('me.lg — «Твой журнал в шахте» and loot toasts', () => {
  it('log lines read like the site', () => {
    expect(logLine(LG[0])).toBe('Руда 3 ур.: +2 железо и 37 осколков, +40 осколков угля');
    expect(logLine(LG[1])).toBe('Камень 3 ур. выкопан - добыча другим по вкладу, тебе оплата за работу');
    expect(logLine(LG[3])).toBe(`Жила твоя: ${resName('ruby')}`);
    expect(logLine(LG[4])).toBe('Приз сундука: Счастливая звезда');
    expect(logLine(LG[5])).toBe('Скупщик: заработок 120 · сдано: железо 3 шт.');
    expect(logLine(LG[10])).toBe('');
    expect(logLine(LG[11])).toBe('Сундук: +40 осколков железа');
  });
  it('lgAll: own lines until the game lists the stone, newest first; myLog falls back to st.log on an older game', () => {
    const local: LgEntry[] = [{ at: 20, k: 'dug', n: 3, i: 11, s: { iron: 1 } }, { at: 21, k: 'dug', n: 3, i: 99, s: { iron: 1 } }];
    const me = { lg: LG } as MineMe;
    const all = lgAll(me, local);
    expect(all[0]).toBe(local[1]); expect(all.filter((e) => e.i === 11)).toEqual([LG[0]]);
    expect(myLog({} as MineMe, [], { log: [{ t: 'старый журнал', at: 1 }] } as MineView)).toEqual([{ t: 'старый журнал', at: 1 }]);
    expect(myLog({ lg: [] } as any, [], { log: [{ t: 'x', at: 1 }] } as MineView)).toEqual([]);
    expect(LOG_EMPTY).toMatch(/^Пока пусто/);
  });
  it.skipIf(!SITE_LOG)('logLine / lgAll equal the site\'s (node:vm)', () => {
    const local: LgEntry[] = [{ at: 20, k: 'dug', n: 3, i: 11, s: { iron: 1 } }, { at: 21, k: 'dug', n: 3, i: 99, s: { iron: 1 } }];
    const { ctx } = SITE_LOG!({ me: { lg: LG }, lgLocal: local }, 0);
    for (const e of LG) expect(logLine(e)).toBe(ctx.logLine(e));
    expect(lgAll({ lg: LG } as MineMe, local)).toEqual(ctx.lgAll());
  });
  const cellOf = (t: string, r: string | null, a: number): Cell => ({ i: 11, t, lv: 3, r, a, k: 1 });
  const cases: [string, Burst, Cell][] = [
    ['loot in the view', { i: 11, mine: true, got: { r: 'iron', q: 237, any: 2, loot: null } }, cellOf('ore', 'iron', 3)],
    ['chest loot', { i: 11, mine: true, got: { r: 'stone', q: 0, any: 1, loot: { iron: 40, coal: 5 } } }, cellOf('chest', null, 0)],
    ['ore to the others', { i: 11, mine: true, got: { r: 'iron', q: 0, any: 2, loot: null } }, cellOf('ore', 'iron', 3)],
    ['no ore in the stone', { i: 11, mine: true, got: null }, cellOf('rock', null, 0)],
    ['wait for me.lg', { i: 11, mine: true, got: null }, cellOf('ore', 'iron', 3)],
  ];
  it('dugToast: a toast now, or a wait that me.lg ends', () => {
    const t = dugToast(cases[0][1], cases[0][2], 3, 1000);
    expect(t.toast).toEqual({ head: 'Выкопан: руда 3 ур. · железо', s: { iron: 237 }, sub: 'Добыча - в сумке' });
    expect(t.local).toMatchObject({ k: 'dug', n: 3, i: 11, s: { iron: 237 } });
    expect(dugToast(cases[2][1], cases[2][2], 3, 1000).toast!.sub).toMatch(/досталась другим/);
    const w = dugToast(cases[4][1], cases[4][2], 3, 1000).want!;
    expect(toastFromLog(w, [], 2000)).toEqual({ toast: null, done: false });
    expect(toastFromLog(w, [{ at: 1500, k: 'dug', n: 3, i: 11, s: { iron: 50 } }], 2000).toast).toEqual({ head: w.head, s: { iron: 50 }, sub: 'Добыча - в сумке' });
    expect(toastFromLog(w, [], 1000 + 90001)).toEqual({ toast: null, done: true });
    expect(toastHtml({ head: 'Выкопан', s: { iron: 237, coal: 5 }, sub: 'Добыча - в сумке' })).toMatch(/\+2 железо и 37 осколков<\/span><\/li><li>.*\+5 осколков угля/);
  });
  it.skipIf(!SITE_LOG)('dugToast / toastFromLog equal the site\'s (node:vm)', () => {
    for (const [name, b, cell] of cases) {
      const S: any = { st: { n: 3 }, me: { lg: [] } };
      const { ctx, toasts } = SITE_LOG!(S, 1000);
      ctx.dugToast(b, cell, b.got);
      const ours = dugToast(b, cell, 3, 1000);
      expect(ours.toast ? [ours.toast] : [], name).toEqual(toasts);
      expect(ours.want || null, name).toEqual(S.toastWant || null);
      expect(ours.local ? [ours.local] : [], name).toEqual(S.lgLocal || []);
      if (S.toastWant) {
        S.me.lg = [{ at: 1200, k: 'dug', n: 3, i: 11, s: {} }];
        const { ctx: c2, toasts: t2 } = SITE_LOG!(S, 1500); c2.toastFromLog();
        expect([toastFromLog(ours.want!, S.me.lg, 1500).toast]).toEqual(t2);
      }
    }
  });
});

/* ------------------------------------------------------------------ dl d[6], news, pin, leave */

describe('state parsing and client', () => {
  it('gotOf `any` reads dl d[6] (how many got ore) when present', () => {
    const M = new MineModel(ML), st = clone((enter as any).st), me = clone((enter as any).me);
    M.take(st, me, null, st.at);
    const F = floorOf(st)!, c = F.cells.find((x) => !+st.dug[x.i] && x.t !== 'wall')!;
    const st2 = clone(st); st2.v++; const d = st2.dug.split(''); d[c.i] = '1'; st2.dug = d.join('');
    st2.dl = [[c.i, st2.n, 'iron', {}, { ann: 120 }, undefined, 3]];
    st2.dg = { ...(st2.dg || {}), [c.i]: [ML] };
    const prev = clone(st); prev.dg = { ...(prev.dg || {}), [c.i]: [ML] };
    const M2 = new MineModel(ML); M2.take(prev, me, null, st.at);
    const r = M2.take(st2, me, null, st.at + 1000);
    const b = r.bursts.find((x) => x.i === c.i)!;
    expect(b.mine).toBe(true); expect(b.got).toMatchObject({ q: 0, any: 3 });
  });
  it('NewsGate: no window over a player who acted; it is marked read silently after the 15 s', () => {
    const nw = { b: 3, at: 5 }, seen: number[] = [];
    const g = new NewsGate(new Map());
    expect(g.tick({ news: nw } as any, 'home', 1000, () => seen.push(1))).toBe(nw);
    const g2 = new NewsGate(new Map());
    g2.tick({} as any, 'home', 1000, () => {});
    g2.act();
    expect(g2.tick({ news: nw } as any, 'home', 2000, () => seen.push(2))).toBeNull();
    expect(seen).toEqual([]);
    expect(g2.tick({ news: nw } as any, 'home', 1000 + NEWS_WINDOW + 1, () => seen.push(2))).toBeNull();
    expect(seen).toEqual([2]);
  });
  it('newsHero: me without news takes hero.mn[c].news; leave to the city sends {out: 1, sid}', async () => {
    let now = 1_000_000; const T: Timers = { setInterval: () => 1, clearInterval: () => {}, setTimeout: () => 1, clearTimeout: () => {} };
    const calls: { p: string; b: any }[] = [];
    const api = async (p: string, b?: any) => { calls.push({ p, b }); return p.startsWith('/api/mine/enter') ? (() => { const e = clone(enter as any); delete e.me.news; return e; })() : { ok: true }; };
    const nw = { b: 4, at: 7 };
    const c = new MineClient({ api, login: ML, c: 'home', timers: T, now: () => now, hero: () => ({ login: ML, items: [], mn: { home: { news: nw } } }) as any });
    await c.enter({ x: 303, y: 2393 });
    expect(c.model.me!.news).toEqual(nw);
    expect(c.newsHero()).toBe(false);   // already there
    c.close(true, true);
    expect(calls[calls.length - 1]).toEqual({ p: '/api/mine/leave?c=home', b: { out: 1, sid: (enter as any).sid } });
    now++;
  });
  it('pickNeed: the next pickaxe\'s rows (site pickNeed), pinned card markup', () => {
    const pkx = { lv: 0, t: [['Кирка', 1, 1, 0, {}, {}], ['Медная', 1.1, 2, 100, { copper: 300 }, { iron: ['copper', 2] }], ['Железная', 1.2, 5, 400, { iron: 500 }, {}]] as any };
    const P = pickNeed(pkx, 1, 150, { copper: 120, iron: 100 }, new Set())!;
    expect(P.name).toBe('Медная'); expect(P.ok).toBe(false);
    // iron goes instead of copper (1 for 2): 100 iron cover 200 copper shards, 100 copper shards are left to pay
    expect(P.rows.map((r) => r.slice(0, 4))).toEqual([['Горное дело', 'ур. 1', 'ур. 2', false], ['Монеты', '150', '100', true], ['Медь', '1,2', '1', true], ['Железо', '1', '1', true]]);
    expect(pickPay({ copper: 300 }, { iron: ['copper', 2] }, { copper: 120, iron: 100 }, ['iron']).s).toEqual({ copper: 100, iron: 100 });
    expect(pickNeed({ lv: 2, t: pkx.t }, 9, 0, {}, new Set())).toEqual({ name: '', max: true, rows: [], ok: true });
    expect(pinHtml(P)).toContain('Медная кирка'); expect(pinHtml(P)).not.toContain('к Снабженцу');
    const ok = pickNeed(pkx, 3, 500, { copper: 300, iron: 0 }, new Set())!;
    expect(ok.ok).toBe(true); expect(pinHtml(ok)).toContain('data-a="tosup"');
    expect(pickNeed(null, 1, 0, {}, new Set())).toBeNull();
  });
  it.skipIf(!MINE)('pickNeed equals the site\'s (node:vm)', () => {
    const fns = ['pickNeed', 'pickPay'].map((n) => fnSource(MINE!, n)), pcs = lineOf(MINE!, 'const pcs ='), pkT = lineOf(MINE!, 'const pkT =');
    expect(fns.every(Boolean) && pcs && pkT).toBeTruthy();
    const R = rng(5);
    const T = [['Кирка', 1, 1, 0, {}, {}], ['Медная', 1.1, 2, 100, { copper: 300 }, { iron: ['copper', 2] }], ['Железная', 1.2, 5, 400, { iron: 500, copper: 200 }, { coal: ['iron', 3] }], ['Стальная', 1.35, 9, 900, { iron: 900 }, {}]];
    for (let n = 0; n < 200; n++) {
      const pkx = { lv: Math.floor(R() * 4), t: T }, mx = { lv: 1 + Math.floor(R() * 9) }, money = Math.floor(R() * 1000);
      const hv: Record<string, number> = {}; for (const r of ['copper', 'iron', 'coal']) if (R() < 0.7) hv[r] = Math.floor(R() * 1200);
      const no = new Set(R() < 0.3 ? ['iron'] : []);
      const ctx: any = { S: { me: { pkx, mx } }, X: { hero: () => ({ money }), money: (v: number) => String(v) }, PK: { no }, oreHave: () => hv, resName, qPlain: (v: number) => String(v), Object, Math, String, Number };
      vm.createContext(ctx); vm.runInContext(`${pkT}\n${pcs}\n${fns.join('\n')}`, ctx);
      const site = JSON.parse(JSON.stringify(ctx.pickNeed())), ours = pickNeed(pkx as any, mx.lv, money, hv, no)!;
      expect({ ...ours, rows: ours.rows.map((r) => r.slice(0, 4)) }).toEqual({ max: false, ...site });
    }
  });
});
