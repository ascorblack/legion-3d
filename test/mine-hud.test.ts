import { describe, it, expect } from 'vitest';
import { NewsGate, NEWS_WINDOW, newsKey, canClaimOf, markQcClaimed, qcReady, qcStatus, nextDayReset, dayLimit, spanTxt, weekResetTxt, MSK_MS, type MineMe, type MineNews, type QuestC } from '../src/rooms/mine/state';
import { MineClient } from '../src/rooms/mine/net';
import { applyDemo, demoFromQuery, FakeMine, makeBus } from '../src/rooms/mine/fake';
import { newsHtml, qcRowHtml, qcHudHtml } from '../src/rooms/mine/hud';
import enter from './fixtures/mine-enter.json';

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));
const H = 3600e3;
const NW: MineNews = { b: 7, f: 1, c: 14, cx: 14.4, r: { iron: 3 }, p: { iron: 42 }, at: 1000 };
const mkMe = (news?: MineNews): MineMe => ({ ...(clone(enter.me) as unknown as MineMe), news });

/** A client whose api records every request (the gate only ever calls seen()). */
function recClient() {
  const calls: { p: string; b: unknown }[] = [];
  const c = new MineClient({ api: async (p, b) => { calls.push({ p, b }); return { ok: true }; }, login: 'player1', c: 'home' });
  return { c, calls };
}

describe('«Пока тебя не было» (NewsGate)', () => {
  it('shows within the first 15 s, once; «Понятно» sends exactly one mineSeen', () => {
    const { c, calls } = recClient(), g = new NewsGate(new Map());
    const me = mkMe(NW);
    expect(g.tick(me, 'home', 10_000, () => c.seen())).toBe(NW);
    expect(g.tick(me, 'home', 11_000, () => c.seen())).toBeNull();   // already shown: not again
    expect(calls).toHaveLength(0);                                    // nothing is sent until the player acts
    expect(g.ack(NW, 'home', () => c.seen())).toBe(true);
    expect(g.ack(NW, 'home', () => c.seen())).toBe(false);            // a double click: still one request
    expect(calls).toEqual([{ p: '/api/mineSeen', b: { c: 'home' } }]);
  });
  it('a summary acknowledged on this page does not come back from a late hero snapshot', () => {
    const { c, calls } = recClient(), seen = new Map<string, string>();
    const g = new NewsGate(seen);
    g.tick(mkMe(NW), 'home', 5000, () => c.seen()); g.ack(NW, 'home', () => c.seen());
    const g2 = new NewsGate(seen);   // the room was re-entered; the snapshot still carries the same summary
    expect(g2.tick(mkMe(clone(NW)), 'home', 6000, () => c.seen())).toBeNull();
    expect(calls).toHaveLength(1);
    expect(seen.get('home')).toBe(newsKey(NW));
    // a different summary is a new one
    expect(g2.tick(mkMe({ ...NW, at: 2000 }), 'home', 7000, () => c.seen())).not.toBeNull();
  });
  it('a summary arriving after 15 s is not shown: it is marked read silently (one mineSeen)', () => {
    const { c, calls } = recClient(), g = new NewsGate(new Map());
    expect(g.tick(mkMe(), 'home', 1000, () => c.seen())).toBeNull();           // entered with nothing: at0 = 1000
    expect(g.tick(mkMe(NW), 'home', 1000 + NEWS_WINDOW + 1, () => c.seen())).toBeNull();
    expect(calls).toEqual([{ p: '/api/mineSeen', b: { c: 'home' } }]);
    expect(g.tick(mkMe(NW), 'home', 40_000, () => c.seen())).toBeNull();
    expect(calls).toHaveLength(1);
  });
  it('no me → no clock, no news → nothing', () => {
    const g = new NewsGate(new Map());
    expect(g.tick(null, 'home', 0, () => { throw new Error('no'); })).toBeNull();
    expect(g.tick(mkMe(), 'home', 0, () => { throw new Error('no'); })).toBeNull();
  });
  it('card html carries stones, rare finds, ore and pay; idle / busy hint', () => {
    const h = newsHtml({ ...NW, r: { iron: 3, coal: 1 } }, true, true);
    expect(h).toContain('Пока тебя не было'); expect(h).toContain('Выкопано камней'); expect(h).toContain('редких находок: 1');
    expect(h).toContain('железо'); expect(h).toContain('<br>'); expect(h).toContain('Оплата за работу (уже в кошельке)'); expect(h).toContain('ждёт');
    expect(newsHtml(NW, false, false)).toContain('Заработок (выдаст скупщик)');
    expect(newsHtml(NW, true, false)).toContain('всё ещё копает');
  });
});

describe('общее поручение q.c и «Забрать награду»', () => {
  const taken = { d: [{ id: 'a', t: 'x', p: 1, g: 1, c: 5, done: 1, cl: 1 }], w: [{ id: 'b', t: 'y', p: 2, g: 2, c: 5, done: 1, cl: 1 }] };
  const qc = (o: Partial<QuestC> = {}): QuestC => ({ t: 'Вместе выкопайте камней: 6000', p: 6000, g: 6000, c: 150, min: 30, me: 44, n: 212, ok: 1, done: 1, cl: 0, ...o });
  it('lights up when only q.c is ready (the bug)', () => {
    expect(canClaimOf({ ...taken, c: qc() }, 0, 1e6)).toBe(true);
    expect(canClaimOf(taken, 0, 1e6)).toBe(false);
  });
  it('q.c done but own share too small, in progress or already taken: not ready', () => {
    expect(canClaimOf({ ...taken, c: qc({ ok: 0, me: 12 }) }, 0, 1e6)).toBe(false);
    expect(canClaimOf({ ...taken, c: qc({ done: 0, p: 4210 }) }, 0, 1e6)).toBe(false);
    expect(canClaimOf({ ...taken, c: qc({ cl: 1 }) }, 0, 1e6)).toBe(false);
    expect(qcReady(null)).toBe(false);
  });
  it('a daily quest alone still lights it; not within 60 s after a claim', () => {
    const q = { d: [{ id: 'a', t: 'x', p: 1, g: 1, c: 5, done: 1 }], w: [] };
    expect(canClaimOf(q, 0, 1e6)).toBe(true);
    expect(canClaimOf(q, 1e6 - 30_000, 1e6)).toBe(false);
    expect(canClaimOf(q, 1e6 - 61_000, 1e6)).toBe(true);
    expect(canClaimOf(null, 0, 1e6)).toBe(false);
  });
  it('after a claim q.c is marked taken only if it was ready (site rule)', () => {
    const q = { ...clone(taken), c: qc() }; markQcClaimed(q); expect(q.c.cl).toBe(1);
    const q2 = { ...clone(taken), c: qc({ ok: 0 }) }; markQcClaimed(q2); expect(q2.c.cl).toBe(0);
    markQcClaimed(undefined);
  });
  it('status words and markup', () => {
    expect(qcStatus(qc({ done: 0, p: 4210 }))).toBe('4210 / 6000');
    expect(qcStatus(qc())).toBe('готово'); expect(qcStatus(qc({ ok: 0 }))).toBe('выполнено'); expect(qcStatus(qc({ cl: 1 }))).toBe('получено');
    const row = qcRowHtml(qc({ done: 0, p: 3000, me: 12, ok: 0 }));
    expect(row).toContain('Награда +150'); expect(row).toContain('ещё 18'); expect(row).toContain('Участников: 212'); expect(row).toContain('width:50.0%');
    expect(qcHudHtml(qc())).toContain('вклад 44 / 30 ✓');
    expect(qcHudHtml(qc())).toContain('ready');
  });
});

describe('лимит суток и сброс в 05:00 МСК', () => {
  // 05:00 MSK = 02:00 UTC
  const utc = (y: number, m: number, d: number, hh = 0, mm = 0) => Date.UTC(y, m - 1, d, hh, mm);
  it('next reset is the coming 05:00 Moscow time', () => {
    expect(nextDayReset(utc(2026, 10, 28, 1, 59))).toBe(utc(2026, 10, 28, 2, 0));     // 04:59 MSK → 05:00 MSK today
    expect(nextDayReset(utc(2026, 10, 28, 2, 0))).toBe(utc(2026, 10, 29, 2, 0));      // exactly at 05:00 → tomorrow
    expect(nextDayReset(utc(2026, 10, 28, 12, 0))).toBe(utc(2026, 10, 29, 2, 0));     // 15:00 MSK
    expect(nextDayReset(utc(2026, 10, 28, 23, 30))).toBe(utc(2026, 10, 29, 2, 0));    // 02:30 MSK next calendar day, still before 05:00
    expect(nextDayReset(utc(2026, 12, 31, 22, 0))).toBe(utc(2027, 1, 1, 2, 0));       // year border
  });
  it('is independent of the machine time zone (pure UTC arithmetic)', () => {
    const t = utc(2026, 10, 28, 9, 48);   // 12:48 MSK → 05:00 MSK is 16 h 12 min away
    expect(nextDayReset(t) - t).toBe(16 * H + 12 * 60_000);
  });
  it('limit states: off / ok / low / full with the reset text', () => {
    const now = utc(2026, 10, 28, 9, 48);   
    expect(dayLimit({ day: 100, cap: 0 }, now).kind).toBe('off');
    expect(dayLimit(null, now).kind).toBe('off');
    expect(dayLimit({ day: 120, cap: 600 }, now)).toMatchObject({ kind: 'ok', left: 480, text: '' });
    const low = dayLimit({ day: 560, cap: 600 }, now);
    expect(low.kind).toBe('low'); expect(low.left).toBe(40); expect(low.text).toContain('Осталось 40 мин');
    const full = dayLimit({ day: 600, cap: 600 }, utc(2026, 10, 28, 23, 48));   // 02:48 MSK → 2 h 12 min to 05:00
    expect(full.kind).toBe('full'); expect(full.text).toBe('На сегодня хватит. Новые сутки в 05:00 (через 2 ч 12 мин)');
    expect(dayLimit({ day: 700, cap: 600 }, now).kind).toBe('full');
  });
  it('duration words', () => {
    expect(spanTxt(0)).toBe('0 мин'); expect(spanTxt(59_001)).toBe('1 мин'); expect(spanTxt(3 * H + 12 * 60_000)).toBe('3 ч 12 мин');
    expect(spanTxt(2 * H)).toBe('2 ч'); expect(spanTxt(52 * H)).toBe('2 д 4 ч'); expect(spanTxt(48 * H)).toBe('2 д');
  });
  it('weekly reset: weekday and time in Moscow time, «через N»', () => {
    const sat18 = utc(2026, 10, 31, 15, 0);   // Saturday 18:00 MSK
    const now = sat18 - (2 * 24 + 4) * H;
    expect(weekResetTxt(sat18, now)).toBe('Новая шахта в сб 18:00 МСК (через 2 д 4 ч)');
    expect(weekResetTxt(sat18, sat18 + 1)).toBe(''); expect(weekResetTxt(undefined, 0)).toBe('');
    expect(MSK_MS).toBe(3 * H);
  });
});

describe('fake.ts demos (news / q.c / limit)', () => {
  it('query → demo → me', () => {
    expect(demoFromQuery('?news=1&qc=ready&limit=full')).toEqual({ news: true, qc: 'ready', limit: 'full' });
    expect(demoFromQuery('?qc=bogus&limit=x')).toEqual({});
    const me = clone(enter.me) as unknown as MineMe;
    applyDemo(me, { news: true, qc: 'ready', limit: 'low' }, 10 * H);
    expect(me.news!.b).toBe(7); expect(me.day).toBe(me.cap - 40);
    expect(canClaimOf(me.q, 0, 1e6)).toBe(true);   // all daily / weekly taken: only q.c lights the button
    applyDemo(me, { qc: 'nomin' }); expect(canClaimOf(me.q, 0, 1e6)).toBe(false);
  });
  it('the fake answers mineSeen (drops the summary) and mineClaim (takes q.c)', async () => {
    const hero = { login: 'player1', money: 0, items: [], mn: {} } as any;
    const f = new FakeMine({ login: 'player1', enter: clone(enter) as any, hero, bus: makeBus(), bots: false, demo: { news: true, qc: 'ready' } });
    try {
      expect(f.me.news).toBeTruthy();
      await f.api('/api/mineSeen', { c: 'home' }); expect(f.me.news).toBeUndefined();
      expect(f.calls.filter((x) => x.p === '/api/mineSeen')).toHaveLength(1);
      await f.api('/api/mineClaim', { c: 'home' }); expect(f.me.q!.c!.cl).toBe(1);
    } finally { f.dispose(); }
  });
});
