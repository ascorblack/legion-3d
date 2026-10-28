/**
 * Mine status in the city (plans/mine-ux.md #3). The hero keeps digging while you walk the fair, shop or read the map;
 * this feature shows a small chip in the HUD — «⛏ этаж 25 · ≈ 12 мин», with the ore in the bag — and, when the stone is out,
 * a toast «Камень выкопан — выбери следующий» plus a «В шахту» button (U, the pause menu, or the chip itself).
 *
 * ZERO requests: only data that is already here —
 *  - `store.hero.mn[c]` (site SSE `me`): `i` = the own stone (−1 = not digging), `bag` = ore, `day` / `cap` = minutes today / limit;
 *    «готово» comes ONLY from `i` turning −1 here, never from a guess;
 *  - the window event `l3d:mine-status` the mine room dispatches (src/rooms/mine/afk.ts): ETA seconds of the own stone at
 *    `at`, extended locally by the clock. Without that event (the mine was not entered since the page loaded) the chip
 *    just says «копает»; the ETA is an estimate («≈»), other diggers speed a stone up.
 * The chip is hidden inside the mine itself, while nothing is dug and in photo mode. Setting: «Статус шахты в городе».
 * The model (MineStatusModel) is pure; the DOM lives in src/ui/mine-chip.ts.
 */
import type { Unsub } from '../contracts';
import type { CoreContext } from '../core/context';
import { coreFeature } from './types';
import { registerSettingRow, registerPauseItem, settingValue } from '../ui/settings-ext';
import { mountMineChip, type ChipView, type MineChip } from '../ui/mine-chip';

export const MINE_STATUS_EVENT = 'l3d:mine-status';
export const SETTING_KEY = 'l3d.mine.city';
export const DONE_TEXT = 'Камень выкопан — выбери следующий';
/** The «✅» state is dropped after this long (nobody came back for it). */
export const DONE_TTL_MS = 20 * 60_000;
/** A hero snapshot with i = −1 this soon after an event «digging» is the stale one — it does not mean «done». */
export const SNAPSHOT_LAG_MS = 10_000;

/** Detail of the window event 'l3d:mine-status' (structurally the same as MineStatusDetail in src/rooms/mine/afk.ts). */
export interface StatusDetail { c: string; n: number; i: number; eta: number | null; at: number; day: number; cap: number; inMine: boolean }
/** The parts of hero.mn[c] used here (MineMe of the site). */
interface MeMn { i?: unknown; day?: unknown; cap?: unknown; bag?: { r?: Record<string, number>; p?: Record<string, number> } | null }

const num = (v: unknown, d = 0): number => (typeof v === 'number' && Number.isFinite(v) ? v : d);

/* ------------------------------------------------------------------ pure helpers */

/** «≈ 12 мин», «≈ 1 ч 05 мин», «почти готово» (seconds left). */
export function etaText(sec: number): string {
  if (!(sec > 30)) return 'почти готово';
  const m = Math.ceil(sec / 60);
  return '≈ ' + (m < 60 ? `${m} мин` : `${Math.floor(m / 60)} ч ${String(m % 60).padStart(2, '0')} мин`);
}
/** Minutes → «3 ч 20 мин», «45 мин», «10 ч». */
export function hmText(min: number): string {
  const m = Math.max(0, Math.round(min));
  if (m < 60) return `${m} мин`;
  const h = Math.floor(m / 60), r = m % 60;
  return r ? `${h} ч ${r} мин` : `${h} ч`;
}
const oskW = (n: number) => { const a = n % 10, b = n % 100; return a === 1 && b !== 11 ? 'осколок' : a >= 2 && a <= 4 && (b < 12 || b > 14) ? 'осколка' : 'осколков'; };
/** Whole pieces / shards of ore in the mine bag (hero.mn[c].bag: r = pieces, p = shards above them). */
export function bagOre(bag: MeMn['bag']): { pieces: number; shards: number } {
  let pieces = 0, shards = 0;
  if (bag && typeof bag === 'object') {
    for (const v of Object.values(bag.r || {})) pieces += Math.max(0, Math.floor(num(v)));
    for (const v of Object.values(bag.p || {})) shards += Math.max(0, Math.floor(num(v)));
  }
  return { pieces, shards };
}
/** «в сумке 3 шт. + 37 осколков» or '' for an empty bag. */
export function bagText(o: { pieces: number; shards: number }): string {
  if (!o.pieces && !o.shards) return '';
  const body = o.pieces && o.shards ? `${o.pieces} шт. + ${o.shards} ${oskW(o.shards)}` : o.pieces ? `${o.pieces} шт.` : `${o.shards} ${oskW(o.shards)}`;
  return 'в сумке ' + body;
}
/** The mine id of a city layout (fair → home), as src/rooms/mine/index.ts mineIdOf. */
export const mineIdOfLayout = (layoutId: string | undefined): string => (!layoutId || layoutId === 'fair' ? 'home' : layoutId);

/** A well-formed 'l3d:mine-status' detail, or null. */
export function parseStatus(d: unknown): StatusDetail | null {
  if (!d || typeof d !== 'object') return null;
  const o = d as Record<string, unknown>;
  if (typeof o.c !== 'string' || !o.c || typeof o.i !== 'number' || typeof o.at !== 'number') return null;
  return {
    c: o.c, n: num(o.n), i: o.i, eta: typeof o.eta === 'number' && Number.isFinite(o.eta) ? Math.max(0, o.eta) : null,
    at: o.at, day: num(o.day), cap: num(o.cap), inMine: !!o.inMine,
  };
}

/* ------------------------------------------------------------------ model */

export interface ViewOpts { canGo: boolean }

export class MineStatusModel {
  c: string | null = null;
  /** Floor number (0 = unknown, e.g. the mine was not entered on this page). */
  n = 0;
  /** The own stone (−1 none). */
  i = -1;
  digging = false;
  /** Absolute time (ms) the own stone is expected to finish; null = unknown. */
  finishAt: number | null = null;
  day = 0; cap = 0;
  inMine = false;
  ore = { pieces: 0, shards: 0 };
  /** The stone came out while we were outside the mine (since `at`; capped = the day limit is used up). */
  done: { at: number; capped: boolean } | null = null;

  /** When the last 'digging' event arrived (the hero snapshot may lag a few seconds behind it). */
  private evDigAt = 0;
  /** A «not digging» snapshot was held back by the lag guard: look at the hero again once the guard expires. */
  pending = false;

  setInMine(on: boolean): void { this.inMine = on; if (on) this.done = null; }
  dismiss(): void { this.done = null; }

  /** Apply the event the mine room dispatches (state, own burst, dispose). */
  status(d: StatusDetail): void {
    this.c = d.c;
    if (d.n > 0) this.n = d.n;
    this.day = d.day; this.cap = d.cap;
    this.inMine = d.inMine;
    if (d.i >= 0) {
      this.digging = true; this.i = d.i; this.done = null; this.evDigAt = d.at;
      this.finishAt = d.eta == null ? null : d.at + d.eta * 1000;
    } else {
      // the room itself saw the stone go (or nothing was dug): no toast for what the player watched happen
      this.digging = false; this.i = -1; this.finishAt = null;
    }
    if (d.inMine) this.done = null;
  }

  /** Apply the hero snapshot (store.hero). Returns 'done' when the own stone has just come out outside the mine. */
  hero(hero: { mn?: unknown } | null | undefined, now: number): 'done' | null {
    const mn = hero && hero.mn && typeof hero.mn === 'object' ? (hero.mn as Record<string, MeMn>) : null;
    const keys = mn ? Object.keys(mn) : [];
    if (!mn || !keys.length) { this.digging = false; this.i = -1; this.finishAt = null; return null; }
    const c = this.c && mn[this.c] ? this.c : (keys.find((k) => num(mn[k] && mn[k].i, -1) >= 0) || keys[0]);
    const me = mn[c];
    if (!me || typeof me !== 'object') return null;
    if (c !== this.c) { this.c = c; this.n = 0; this.finishAt = null; }
    const i = num(me.i, -1), was = this.digging;
    this.day = num(me.day, this.day); this.cap = num(me.cap, this.cap);
    this.ore = bagOre(me.bag);
    if (i >= 0) {
      this.pending = false;
      if (this.i !== i) this.finishAt = null;   // another stone: the old ETA is not its
      this.digging = true; this.i = i; this.done = null;
      return null;
    }
    if (was && this.evDigAt && now - this.evDigAt < SNAPSHOT_LAG_MS) { this.pending = true; return null; }   // a snapshot older than the room's own event
    this.pending = false;
    this.digging = false; this.i = -1; this.finishAt = null;
    if (was && !this.inMine) {
      this.done = { at: now, capped: this.cap > 0 && this.day >= this.cap };
      return 'done';
    }
    return null;
  }

  /** What the chip shows now, or null (nothing dug, inside the mine). */
  view(now: number, o: ViewOpts): ChipView | null {
    if (this.inMine) return null;
    if (this.done && now - this.done.at > DONE_TTL_MS) this.done = null;
    const bag = bagText(this.ore);
    if (this.digging) {
      const left = this.finishAt == null ? null : (this.finishAt - now) / 1000;
      const floor = this.n > 0 ? `этаж ${this.n}` : '';
      const head = left == null ? 'копает' : etaText(left);
      const parts: string[] = [];
      if (bag) parts.push(bag);
      if (this.cap > 0) {
        if (this.day >= this.cap) parts.push('лимит суток выбран');
        else if (this.cap - this.day <= 60) parts.push(`до лимита ${hmText(this.cap - this.day)}`);
      }
      const title = ['Герой копает в шахте' + (floor ? ` (${floor})` : '') + (left == null ? '' : ` — ${head} до конца камня (оценка)`),
        bag, this.cap > 0 ? `Сегодня ${hmText(this.day)} из ${hmText(this.cap)}` : ''].filter(Boolean).join('. ');
      return { kind: 'dig', floor, head, sub: parts.join(' · '), go: false, title };
    }
    if (this.done) {
      const sub = [bag, this.done.capped ? 'лимит суток выбран' : ''].filter(Boolean).join(' · ') || 'выбери следующий';
      return { kind: 'done', floor: '', head: 'Камень выкопан', sub, go: o.canGo, title: DONE_TEXT + (bag ? '. ' + bag : '') };
    }
    return null;
  }
}

/* ------------------------------------------------------------------ feature wiring */

export interface MineStatusDeps {
  now(): number;
  /** Where the chip goes (the HUD layer of the game UI); null = no UI (logic only). */
  hudParent(ctx: CoreContext): Element | null;
  mount(parent: Element, h: { onGo(): void; onClose(): void }): MineChip;
  tickMs: number;
}
const DEFAULTS: MineStatusDeps = {
  now: () => Date.now(),
  hudParent: (ctx) => ctx.uiRoot.querySelector('.l3d-ui')?.shadowRoot?.querySelector('.ui .hud') ?? null,
  mount: mountMineChip,
  tickMs: 4000,
};

const enabled = (): boolean => settingValue<string>(SETTING_KEY, 'on') === 'on';

/** Start the feature; returns the dispose function. Exported for tests (fake context, fake chip). */
export function startMineStatus(ctx: CoreContext, deps: Partial<MineStatusDeps> = {}): Unsub {
  const D = { ...DEFAULTS, ...deps };
  const model = new MineStatusModel();
  const offs: Unsub[] = [];
  let photo = false, disposed = false, lastGo = false;

  const canGo = (): boolean => {
    try {
      const r = ctx.rooms;
      if (r.current !== null || r.busy || ctx.state.classic) return false;
      const lay = ctx.layout();
      if (!lay || !lay.buildings.some((b) => b.id === 'mine')) return false;
      return model.c == null || mineIdOfLayout(lay.id) === model.c;
    } catch { return false; }
  };
  const go = () => {
    if (disposed || !lastGo) return false;
    model.dismiss();
    try { void Promise.resolve(ctx.rooms.enter('mine')).catch((e) => console.warn('[l3d] mine-status: enter failed', e)); } catch (e) { console.warn('[l3d] mine-status: enter failed', e); }
    refresh();
    return true;
  };

  const parent = D.hudParent(ctx);
  const chip = parent ? D.mount(parent, { onGo: () => { go(); }, onClose: () => { model.dismiss(); refresh(); } }) : null;

  function refresh(): void {
    if (disposed) return;
    const v = enabled() && !photo ? model.view(D.now(), { canGo: canGo() }) : null;
    lastGo = !!(v && v.go);
    chip?.render(v);
  }
  const syncRoom = () => { model.setInMine(ctx.rooms.kind === 'mine3d'); refresh(); };
  const onHero = () => {
    const r = model.hero(ctx.store.hero as { mn?: unknown } | null, D.now());
    if (r === 'done' && enabled()) {
      try { ctx.ui.toast(model.done?.capped ? DONE_TEXT + ' · лимит суток выбран' : DONE_TEXT); } catch { /* */ }
    }
    refresh();
  };
  const onStatus = (e: Event) => {
    const d = parseStatus((e as CustomEvent).detail);
    if (!d) return;
    model.status(d);
    refresh();
  };
  const onSettings = (e: Event) => { const k = (e as CustomEvent<{ key?: string }>).detail?.key; if (!k || k === SETTING_KEY) refresh(); };
  const onPhoto = (e: Event) => { photo = !!(e as CustomEvent<{ on?: boolean }>).detail?.on; refresh(); };

  window.addEventListener(MINE_STATUS_EVENT, onStatus);
  window.addEventListener('l3d:settings', onSettings);
  window.addEventListener('l3d:photo', onPhoto);
  offs.push(() => { window.removeEventListener(MINE_STATUS_EVENT, onStatus); window.removeEventListener('l3d:settings', onSettings); window.removeEventListener('l3d:photo', onPhoto); });
  offs.push(ctx.store.on('hero', onHero));
  offs.push(ctx.rooms.onChange(syncRoom));
  offs.push(ctx.registries.keys.register('mine-status.go', {
    code: 'KeyU', label: 'В шахту (когда виден значок «Камень выкопан»)', when: 'gameplay',
    run: () => { refresh(); return go(); },
  }));
  offs.push(registerPauseItem({ id: 'mine-status.go', label: 'В шахту', key: 'U', order: 25, enabled: () => lastGo, run: () => { go(); } }));
  const timer = setInterval(() => { if (model.pending) onHero(); else refresh(); }, D.tickMs);
  offs.push(() => clearInterval(timer));

  model.setInMine(ctx.rooms.kind === 'mine3d');
  model.hero(ctx.store.hero as { mn?: unknown } | null, D.now());   // already digging when the page loaded: «копает»
  refresh();
  return () => { disposed = true; for (const u of offs.reverse()) { try { u(); } catch { /* */ } } chip?.dispose(); };
}

export default coreFeature({
  id: 'mineStatus',
  order: 220,
  setup(ctx) {
    const offRow = registerSettingRow({
      key: SETTING_KEY, label: 'Статус шахты в городе', sub: 'значок «⛏ этаж 25 · ≈ 12 мин» и сообщение, когда камень выкопан, пока ты гуляешь по городу',
      kind: 'seg', options: [['off', 'Выкл'], ['on', 'Вкл']], def: 'on', group: 'Шахта', order: 60,
    });
    const off = startMineStatus(ctx);
    return () => { off(); offRow(); };
  },
});
