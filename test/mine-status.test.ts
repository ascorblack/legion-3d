/** Mine status in the city (plans/mine-ux.md #3): the model, the event contract with the mine room, the wiring and «zero requests». */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MineModel } from '../src/rooms/mine/state';
import { mineStatus, MINE_STATUS_EVENT as AFK_EVENT } from '../src/rooms/mine/afk';
import {
  MineStatusModel, startMineStatus, parseStatus, etaText, hmText, bagOre, bagText, mineIdOfLayout,
  MINE_STATUS_EVENT, SETTING_KEY, DONE_TEXT, DONE_TTL_MS, SNAPSHOT_LAG_MS, type StatusDetail,
} from '../src/features/mine-status';
import { registerSettingRow, settingRow, pauseItem } from '../src/ui/settings-ext';
import type { ChipView } from '../src/ui/mine-chip';
import enter from './fixtures/mine-enter.json';

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));
const T0 = 1_800_000_000_000;
const ev = (o: Partial<StatusDetail> = {}): StatusDetail => ({ c: 'home', n: 25, i: 11, eta: 600, at: T0, day: 120, cap: 600, inMine: false, ...o });
const heroOf = (me: Record<string, unknown> | null, c = 'home') => ({ mn: me ? { [c]: me } : {} });

describe('formatting', () => {
  it('ETA text is an estimate (≈) and says «почти готово» at the end', () => {
    expect(etaText(10)).toBe('почти готово');
    expect(etaText(0)).toBe('почти готово');
    expect(etaText(11 * 60 + 5)).toBe('≈ 12 мин');
    expect(etaText(65 * 60)).toBe('≈ 1 ч 05 мин');
  });
  it('minutes of the day', () => {
    expect(hmText(45)).toBe('45 мин'); expect(hmText(200)).toBe('3 ч 20 мин'); expect(hmText(600)).toBe('10 ч'); expect(hmText(-3)).toBe('0 мин');
  });
  it('ore in the bag: pieces + shards, empty bag is silent, junk is ignored', () => {
    expect(bagOre({ r: { iron: 2, coal: 1 }, p: { iron: 37, stone: 5 } })).toEqual({ pieces: 3, shards: 42 });
    expect(bagText({ pieces: 3, shards: 0 })).toBe('в сумке 3 шт.');
    expect(bagText({ pieces: 0, shards: 22 })).toBe('в сумке 22 осколка');
    expect(bagText({ pieces: 2, shards: 37 })).toBe('в сумке 2 шт. + 37 осколков');
    expect(bagText({ pieces: 0, shards: 0 })).toBe('');
    expect(bagOre(null)).toEqual({ pieces: 0, shards: 0 });
    expect(bagOre({ r: { a: 'x' as never, b: -4, c: 2.9 } })).toEqual({ pieces: 2, shards: 0 });
  });
  it('mine id of a layout: fair → home', () => {
    expect(mineIdOfLayout('fair')).toBe('home'); expect(mineIdOfLayout(undefined)).toBe('home'); expect(mineIdOfLayout('d12')).toBe('d12');
  });
});

describe('event contract with the mine room', () => {
  it('the event name is the one src/rooms/mine/afk.ts dispatches', () => { expect(MINE_STATUS_EVENT).toBe(AFK_EVENT); });
  it('parseStatus accepts a real detail and rejects junk', () => {
    expect(parseStatus(ev())).toEqual(ev());
    expect(parseStatus(null)).toBeNull(); expect(parseStatus('x')).toBeNull(); expect(parseStatus({})).toBeNull();
    expect(parseStatus({ c: 'home', i: 'x', at: 1 })).toBeNull();
    expect(parseStatus({ c: '', i: 1, at: 1 })).toBeNull();
    expect(parseStatus({ ...ev(), eta: NaN })?.eta).toBeNull();
    expect(parseStatus({ ...ev(), eta: null })?.eta).toBeNull();
  });
  it('a detail built by the real mine model (afk.mineStatus on the live fixture) drives the chip', () => {
    const M = new MineModel('player43'), st = clone((enter as any).st), me = clone((enter as any).me);
    me.day = 120; me.cap = 600;
    M.take(st, me, null, st.at);
    const d = parseStatus(mineStatus('home', M, st.at, false));
    expect(d).not.toBeNull();
    const m = new MineStatusModel(); m.status(d!);
    const v = m.view(st.at, { canGo: true })!;
    expect(v.kind).toBe('dig'); expect(v.floor).toBe('этаж 25');
    expect(v.head).toBe(etaText(Math.round(152.1 / 14.56 * 60)));   // 627 s → ≈ 11 мин
    expect(v.head).toBe('≈ 11 мин');
  });
});

describe('MineStatusModel', () => {
  it('digging with an ETA from the event: counts down by the clock, «почти готово» at the end', () => {
    const m = new MineStatusModel(); m.status(ev({ eta: 600 }));
    expect(m.view(T0, { canGo: true })).toMatchObject({ kind: 'dig', floor: 'этаж 25', head: '≈ 10 мин', go: false });
    expect(m.view(T0 + 5 * 60_000, { canGo: true })!.head).toBe('≈ 5 мин');
    expect(m.view(T0 + 590_000, { canGo: true })!.head).toBe('почти готово');
    expect(m.view(T0 + 900_000, { canGo: true })!.head).toBe('почти готово');   // the hero snapshot has not said «done» yet
  });
  it('digging without any event (page loaded while digging): «копает», no floor, no invented ETA', () => {
    const m = new MineStatusModel();
    expect(m.hero(heroOf({ i: 7, day: 10, cap: 600, bag: { r: { iron: 2 }, p: {} } }), T0)).toBeNull();
    expect(m.view(T0, { canGo: true })).toMatchObject({ kind: 'dig', floor: '', head: 'копает', sub: 'в сумке 2 шт.' });
  });
  it('not digging → nothing', () => {
    const m = new MineStatusModel();
    expect(m.hero(heroOf({ i: -1, day: 0, cap: 600 }), T0)).toBeNull();
    expect(m.view(T0, { canGo: true })).toBeNull();
    expect(m.hero(heroOf(null), T0)).toBeNull(); expect(m.hero(null, T0)).toBeNull(); expect(m.hero({}, T0)).toBeNull();
    expect(m.view(T0, { canGo: true })).toBeNull();
  });
  it('hero.mn[c].i turning −1 outside the mine = the stone is out (once), the ✅ stays until dismissed', () => {
    const m = new MineStatusModel(); m.status(ev());
    expect(m.hero(heroOf({ i: 11, day: 120, cap: 600 }), T0 + 60_000 + SNAPSHOT_LAG_MS)).toBeNull();
    expect(m.hero(heroOf({ i: -1, day: 130, cap: 600, bag: { r: { iron: 3 }, p: { iron: 40 } } }), T0 + 700_000)).toBe('done');
    const v = m.view(T0 + 700_000, { canGo: true })!;
    expect(v).toMatchObject({ kind: 'done', head: 'Камень выкопан', go: true });
    expect(v.sub).toBe('в сумке 3 шт. + 40 осколков');
    expect(m.hero(heroOf({ i: -1, day: 130, cap: 600 }), T0 + 710_000)).toBeNull();   // no second toast
    expect(m.view(T0 + 710_000, { canGo: false })!.go).toBe(false);
    m.dismiss(); expect(m.view(T0 + 720_000, { canGo: true })).toBeNull();
  });
  it('the day limit used up is said in the ✅ line', () => {
    const m = new MineStatusModel(); m.hero(heroOf({ i: 3, day: 590, cap: 600 }), T0);
    expect(m.view(T0, { canGo: true })!.sub).toBe('до лимита 10 мин');
    m.hero(heroOf({ i: -1, day: 600, cap: 600 }), T0 + 1000);
    expect(m.done?.capped).toBe(true);
    expect(m.view(T0 + 1000, { canGo: true })!.sub).toBe('лимит суток выбран');
    const k = new MineStatusModel(); k.hero(heroOf({ i: 3, day: 5, cap: 600 }), T0); k.hero(heroOf({ i: -1, day: 5, cap: 600 }), T0 + 1);
    expect(k.view(T0 + 1, { canGo: true })!.sub).toBe('выбери следующий');   // empty bag
  });
  it('the ✅ expires; digging again replaces it', () => {
    const m = new MineStatusModel(); m.hero(heroOf({ i: 3, day: 1, cap: 600 }), T0); m.hero(heroOf({ i: -1, day: 1, cap: 600 }), T0 + 1);
    expect(m.view(T0 + DONE_TTL_MS - 1000, { canGo: true })).not.toBeNull();
    expect(m.view(T0 + DONE_TTL_MS + 5000, { canGo: true })).toBeNull();
    m.hero(heroOf({ i: -1, day: 1, cap: 600 }), T0); m.hero(heroOf({ i: 4, day: 1, cap: 600 }), T0 + 10);
    expect(m.view(T0 + 10, { canGo: true })!.kind).toBe('dig');
  });
  it('inside the mine: no chip, no toast for a stone the player watched break; the event with i = −1 never means «done»', () => {
    const m = new MineStatusModel(); m.status(ev({ inMine: true }));
    expect(m.view(T0, { canGo: true })).toBeNull();
    m.status(ev({ i: -1, eta: null, inMine: true }));
    expect(m.hero(heroOf({ i: -1, day: 130, cap: 600 }), T0 + 5000)).toBeNull();
    m.status(ev({ i: -1, eta: null, inMine: false }));   // left the mine afterwards
    expect(m.view(T0 + 6000, { canGo: true })).toBeNull();
    // entering the mine clears a waiting ✅
    const k = new MineStatusModel(); k.hero(heroOf({ i: 1, day: 0, cap: 600 }), T0); k.hero(heroOf({ i: -1, day: 0, cap: 600 }), T0 + 1);
    expect(k.view(T0 + 1, { canGo: true })).not.toBeNull(); k.setInMine(true); k.setInMine(false);
    expect(k.view(T0 + 2, { canGo: true })).toBeNull();
  });
  it('a stale hero snapshot (−1) right after the room event «digging» is not «done»', () => {
    const m = new MineStatusModel(); m.status(ev({ at: T0 }));
    expect(m.hero(heroOf({ i: -1, day: 120, cap: 600 }), T0 + 2000)).toBeNull();
    expect(m.view(T0 + 2000, { canGo: true })!.kind).toBe('dig');
    expect(m.pending).toBe(true);
    expect(m.hero(heroOf({ i: -1, day: 120, cap: 600 }), T0 + SNAPSHOT_LAG_MS + 1)).toBe('done');
    expect(m.pending).toBe(false);
  });
  it('another stone discards the old ETA; several mines → the digging one', () => {
    const m = new MineStatusModel(); m.status(ev({ i: 11, eta: 600 }));
    m.hero(heroOf({ i: 12, day: 1, cap: 600 }), T0 + 60_000);
    expect(m.view(T0 + 60_000, { canGo: true })!.head).toBe('копает');
    const k = new MineStatusModel();
    k.hero({ mn: { home: { i: -1, day: 0, cap: 600 }, d7: { i: 5, day: 0, cap: 600 } } }, T0);
    expect(k.c).toBe('d7'); expect(k.view(T0, { canGo: true })!.kind).toBe('dig');
  });
});

/* ------------------------------------------------------------------ wiring (fake context, fake chip, no DOM) */

class FakeWin extends EventTarget {}
function setup(over: { layoutId?: string; mine?: boolean; hero?: unknown } = {}) {
  const win = new FakeWin();
  const store: Record<string, unknown> = { local: {} as Record<string, string> };
  (globalThis as any).window = win;
  (globalThis as any).localStorage = { getItem: (k: string) => (store.local as any)[k] ?? null, setItem: (k: string, v: string) => { (store.local as any)[k] = v; } };
  let hero: unknown = over.hero ?? heroOf({ i: 11, day: 120, cap: 600 });
  const heroSubs = new Set<() => void>(), roomSubs = new Set<(c: string | null) => void>();
  const rooms = { current: null as string | null, kind: null as string | null, busy: false, enter: vi.fn(async (_id: string) => { /* */ }), onChange: (f: (c: string | null) => void) => { roomSubs.add(f); return () => roomSubs.delete(f); } };
  const keys = new Map<string, any>();
  const toast = vi.fn();
  const get = vi.fn(), post = vi.fn(), fetchSpy = vi.fn();
  (globalThis as any).fetch = fetchSpy;
  const ctx: any = {
    store: { get hero() { return hero; }, on: (_e: string, f: () => void) => { heroSubs.add(f); return () => heroSubs.delete(f); } },
    rooms, ui: { toast }, state: { classic: false },
    layout: () => ({ id: over.layoutId ?? 'fair', buildings: over.mine === false ? [{ id: 'hall' }] : [{ id: 'hall' }, { id: 'mine' }] }),
    registries: { keys: { register: (id: string, def: any) => { keys.set(id, def); return () => keys.delete(id); } } },
    actions: { get, post },
    uiRoot: null,
  };
  const views: (ChipView | null)[] = [];
  let chipDisposed = false, handlers: { onGo(): void; onClose(): void } | null = null;
  let now = T0;
  const off = startMineStatus(ctx, {
    now: () => now, tickMs: 1000,
    hudParent: () => ({}) as Element,
    mount: (_p, h) => { handlers = h; return { render: (v) => { views.push(v); }, dispose: () => { chipDisposed = true; } }; },
  });
  return {
    win, ctx, rooms, keys, toast, views, get, post, fetchSpy, off,
    last: () => views[views.length - 1] ?? null,
    setHero: (h: unknown) => { hero = h; for (const f of [...heroSubs]) f(); },
    dispatch: (d: unknown) => win.dispatchEvent(new CustomEvent(MINE_STATUS_EVENT, { detail: d })),
    setRoom: (cur: string | null, kind: string | null) => { rooms.current = cur; rooms.kind = kind; for (const f of [...roomSubs]) f(cur); },
    tick: (ms: number) => { now += ms; vi.advanceTimersByTime(ms); },
    handlers: () => handlers!, chipDisposed: () => chipDisposed, heroSubs, roomSubs,
  };
}

describe('startMineStatus wiring', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); delete (globalThis as any).window; delete (globalThis as any).localStorage; delete (globalThis as any).fetch; });

  it('already digging at load: «копает» chip, no toast', () => {
    const s = setup();
    expect(s.last()).toMatchObject({ kind: 'dig', head: 'копает' });
    expect(s.toast).not.toHaveBeenCalled();
    s.off();
  });

  it('event → ETA chip; hero i → −1 outside the mine → one toast and a «В шахту» chip; click enters the mine', () => {
    const s = setup();
    s.dispatch(ev({ eta: 600, at: T0 }));
    expect(s.last()).toMatchObject({ kind: 'dig', floor: 'этаж 25', head: '≈ 10 мин' });
    s.tick(60_000);
    expect(s.last()!.head).toBe('≈ 9 мин');
    s.tick(SNAPSHOT_LAG_MS);
    s.setHero(heroOf({ i: -1, day: 140, cap: 600, bag: { r: { iron: 1 }, p: {} } }));
    expect(s.toast).toHaveBeenCalledTimes(1); expect(s.toast).toHaveBeenCalledWith(DONE_TEXT);
    expect(s.last()).toMatchObject({ kind: 'done', go: true });
    s.setHero(heroOf({ i: -1, day: 140, cap: 600 }));
    expect(s.toast).toHaveBeenCalledTimes(1);
    s.handlers().onGo();
    expect(s.rooms.enter).toHaveBeenCalledWith('mine');
    expect(s.last()).toBeNull();   // the ✅ is consumed
    s.off();
  });

  it('a «done» snapshot held back by the lag guard is applied by the timer, with no new snapshot needed', () => {
    const s = setup({ hero: heroOf({ i: 11, day: 120, cap: 600 }) });
    s.dispatch(ev({ eta: 5, at: T0 }));
    s.setHero(heroOf({ i: -1, day: 125, cap: 600 }));
    expect(s.toast).not.toHaveBeenCalled(); expect(s.last()!.kind).toBe('dig');
    s.tick(SNAPSHOT_LAG_MS + 2000);
    expect(s.toast).toHaveBeenCalledTimes(1); expect(s.last()!.kind).toBe('done');
    s.off();
  });

  it('key U and the pause-menu item enter the mine only while the button is shown', () => {
    const s = setup({ hero: heroOf({ i: -1, day: 0, cap: 600 }) });
    const key = s.keys.get('mine-status.go');
    expect(key.code).toBe('KeyU');
    expect(key.run()).toBe(false); expect(s.rooms.enter).not.toHaveBeenCalled();
    expect(pauseItem('mine-status.go')!.enabled!()).toBe(false);
    s.setHero(heroOf({ i: 2, day: 0, cap: 600 }));
    expect(key.run()).toBe(false);   // still digging: nothing to go back for
    s.setHero(heroOf({ i: -1, day: 0, cap: 600 })); s.tick(SNAPSHOT_LAG_MS * 2);
    expect(pauseItem('mine-status.go')!.enabled!()).toBe(true);
    expect(key.run()).toBe(true); expect(s.rooms.enter).toHaveBeenCalledWith('mine');
    s.off();
    expect(s.keys.has('mine-status.go')).toBe(false); expect(pauseItem('mine-status.go')).toBeUndefined();
  });

  it('hidden inside the mine; no toast for a stone broken there; back in the city nothing stale', () => {
    const s = setup();
    s.setRoom('mine', 'mine3d');
    expect(s.last()).toBeNull();
    s.dispatch(ev({ inMine: true }));
    s.dispatch(ev({ i: -1, eta: null, inMine: true }));
    s.setHero(heroOf({ i: -1, day: 150, cap: 600 }));
    expect(s.toast).not.toHaveBeenCalled();
    s.dispatch(ev({ i: -1, eta: null, inMine: false })); s.setRoom(null, null);
    expect(s.last()).toBeNull();
    s.off();
  });

  it('digging when leaving the mine → the chip appears with the ETA from the dispose event', () => {
    const s = setup({ hero: heroOf({ i: 11, day: 120, cap: 600 }) });
    s.setRoom('mine', 'mine3d'); expect(s.last()).toBeNull();
    s.dispatch(ev({ eta: 300, at: T0, inMine: false })); s.setRoom(null, null);
    expect(s.last()).toMatchObject({ kind: 'dig', head: '≈ 5 мин', floor: 'этаж 25' });
    s.off();
  });

  it('without a mine building in this layout, or in a shop, there is no button (the status still shows)', () => {
    const a = setup({ mine: false, hero: heroOf({ i: 4, day: 0, cap: 600 }) });
    a.setHero(heroOf({ i: -1, day: 0, cap: 600 })); a.tick(SNAPSHOT_LAG_MS * 2);
    expect(a.last()).toMatchObject({ kind: 'done', go: false });
    a.keys.get('mine-status.go').run(); expect(a.rooms.enter).not.toHaveBeenCalled();
    a.off();
    const b = setup({ hero: heroOf({ i: 4, day: 0, cap: 600 }) });
    b.setRoom('forge', 'hybrid');
    b.setHero(heroOf({ i: -1, day: 0, cap: 600 }));
    expect(b.last()).toMatchObject({ kind: 'done', go: false });
    b.off();
  });

  it('digging in the mine of another town: no «В шахту» button here', () => {
    const s = setup({ layoutId: 'd7', hero: { mn: { home: { i: 3, day: 0, cap: 600 } } } });
    s.setHero({ mn: { home: { i: -1, day: 0, cap: 600 } } });
    expect(s.last()).toMatchObject({ kind: 'done', go: false });
    s.off();
  });

  it('the setting switches the chip and the toast off and on', () => {
    const off = registerSettingRow({ key: SETTING_KEY, label: 'x', kind: 'seg', options: [['off', 'Выкл'], ['on', 'Вкл']], def: 'on', group: 'Шахта' });
    const s = setup();
    expect(s.last()).not.toBeNull();
    (globalThis as any).localStorage.setItem(SETTING_KEY, 'off');
    s.win.dispatchEvent(new CustomEvent('l3d:settings', { detail: { key: SETTING_KEY, value: 'off' } }));
    expect(s.last()).toBeNull();
    s.setHero(heroOf({ i: -1, day: 0, cap: 600 }));
    expect(s.toast).not.toHaveBeenCalled();
    (globalThis as any).localStorage.setItem(SETTING_KEY, 'on');
    s.win.dispatchEvent(new CustomEvent('l3d:settings', { detail: { key: SETTING_KEY, value: 'on' } }));
    expect(s.last()).toMatchObject({ kind: 'done' });   // the ✅ was kept while hidden
    s.off(); off();
  });

  it('photo mode hides the chip', () => {
    const s = setup();
    s.win.dispatchEvent(new CustomEvent('l3d:photo', { detail: { on: true } })); expect(s.last()).toBeNull();
    s.win.dispatchEvent(new CustomEvent('l3d:photo', { detail: { on: false } })); expect(s.last()).not.toBeNull();
    s.off();
  });

  it('ZERO requests: no api get/post, no fetch — only the room enter on a click', () => {
    const s = setup();
    s.dispatch(ev()); s.tick(120_000);
    s.setHero(heroOf({ i: -1, day: 1, cap: 600 })); s.tick(60_000);
    s.keys.get('mine-status.go').run(); s.handlers().onClose();
    expect(s.get).not.toHaveBeenCalled(); expect(s.post).not.toHaveBeenCalled(); expect(s.fetchSpy).not.toHaveBeenCalled();
    s.off();
  });

  it('junk events are ignored; dispose removes every listener, timer, key and the chip', () => {
    const s = setup();
    const n = s.views.length;
    s.dispatch(null); s.dispatch({ c: 1 }); s.dispatch('x');
    expect(s.views.length).toBe(n);
    s.off();
    expect(s.chipDisposed()).toBe(true); expect(s.heroSubs.size).toBe(0); expect(s.roomSubs.size).toBe(0);
    const m = s.views.length;
    s.dispatch(ev()); s.tick(10_000); s.setHero(heroOf({ i: -1, day: 0, cap: 600 }));
    expect(s.views.length).toBe(m);
    expect(s.toast).not.toHaveBeenCalled();
  });

  it('the feature registers the setting row «Статус шахты в городе» (group «Шахта»)', async () => {
    const mod = await import('../src/features/mine-status');
    const f = mod.default as { id: string; setup(ctx: unknown): unknown };
    expect(f.id).toBe('mineStatus');
    const s = setup();
    s.off();
    const un = f.setup({ ...s.ctx, uiRoot: { querySelector: () => null } }) as () => void;
    const row = settingRow(SETTING_KEY)!;
    expect(row).toMatchObject({ label: 'Статус шахты в городе', group: 'Шахта', kind: 'seg', def: 'on' });
    un();
    expect(settingRow(SETTING_KEY)).toBeUndefined();
  });
});
