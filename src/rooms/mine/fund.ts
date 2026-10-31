/**
 * «Шахта 3.0» lift, drill rigs and the player's next step — pure helpers (no DOM, no network, `now` is a parameter).
 * Mirrors the site's mine.js (30.10): ride / liftFund / drillFund / liftHtml / drillHtml / fundBlock / oreAsk / keyOf /
 * follow3 / tmrDraw, plus our own objective line (what to do next) for the HUD.
 *
 *   keyOf(3, 5, 'home') → 'home.3'   (floors above the deepest are their own site mine «id.floor»; the deepest is «id»)
 *   const ask = new OreAsk(); ask.press(uid, now) → 'ask' (first press) | 'send' (second, 350 ms…8 s later) | 'ignore'
 */
import type { MineView, MineMe, Drill3, Lift3 } from './state';
import { resName } from './state';

/** Mine id without the floor (site CB()): chat, «my» data and every action but digging are shared by the floors. */
export const baseOf = (c: string): string => String(c || 'home').split('.')[0];
/** Site keyOf: the deepest open floor is the mine itself, an upper floor is «id.floor». */
export const keyOf = (f: number, deep: number, c: string): string => (f >= deep ? baseOf(c) : `${baseOf(c)}.${f}`);
/** A mine key the site accepts (site open(): /^[a-z0-9_-]{1,24}(\.[1-9][0-9]{0,2})?$/), else 'home'. */
export const mineKey = (c: unknown): string => (/^[a-z0-9_-]{1,24}(\.[1-9][0-9]{0,2})?$/.test(String(c || '')) ? String(c) : 'home');
/** The deepest open floor of a view. */
export const deepOf = (st: MineView | null | undefined): number => (st ? st.deep || st.n : 1);
/** Floor to ride to, clamped to 1…deep (site ride()). */
export const rideFloor = (f: number, deep: number): number => Math.max(1, Math.min(deep, Math.floor(+f) || 1));
/** How long after a successful ride the site re-opens the mine (the upper floor's view comes with the next upload). */
export const rideDelay = (f: number, deep: number): number => (f >= deep ? 300 : 2500);

/**
 * Site follow3: the game says the hero is on another floor (me.at — he dug when a new floor opened): open that floor,
 * at most once a minute and not right after an own ride. Returns the key to open or null.
 */
export function followKey(st: MineView | null, me: MineMe | null, c: string, rideAt: number, now: number): string | null {
  if (!st || !(st.fl && st.fl.v3) || !me || !(+(me.at || 0) >= 1) || me.at === st.n) return null;
  if (rideAt && now - rideAt < 60000) return null;
  const k = keyOf(me.at!, deepOf(st), c);
  return k === c ? null : k;
}

/** The part of a mine client the entry follow needs (src/rooms/mine/net.ts MineClient). */
export interface FollowClient {
  readonly model: { st: MineView | null; me: MineMe | null };
  readonly c: string;
  rideAt: number;
  switchTo(key: string, start: { x: number; y: number }): Promise<boolean>;
}
/**
 * Site 31.10 (mine.js take(): follow3 before the floor is stored and drawn — the streamer's bug «вход из Города: на миг самый
 * глубокий этаж, через секунду — этаж, где вышел»): right after the enter, before anything of the floor is built, a hero who
 * is on another floor (me.at) is taken there. Returns the key switched to, null when nothing to follow, false when the switch
 * failed (the room then shows the floor it entered).
 */
export async function followOnEnter(client: FollowClient, start: () => { x: number; y: number }, now: number): Promise<string | null | false> {
  const k = followKey(client.model.st, client.model.me, client.c, client.rideAt, now);
  if (!k) return null;
  client.rideAt = now;
  return (await client.switchTo(k, start())) ? k : false;
}

/** Duration «1 ч 5 мин» / «12 мин» (site hm). */
export const hmTxt = (ms: number): string => { const m = Math.max(0, Math.round(ms / 60000)); return m >= 60 ? `${Math.floor(m / 60)} ч ${m % 60} мин` : `${m} мин`; };
/** Timer chip «18 мин» (site tmrTxt: rounded up, at least 1). */
export const tmrTxt = (ms: number): string => { const m = Math.max(1, Math.ceil(ms / 60000)); return m < 60 ? `${m} мин` : `${Math.floor(m / 60)} ч ${m % 60} мин`; };

/** Lift stage of the view (deepest floor), with the time left of the upgrade (server left minus the view's age). */
export interface LiftInfo { st: 'dig' | 'fund' | 'up'; deep: number; n: number; onDeep: boolean; c: number; need: number; p: number; rest: number; ms: number; leftMs: number; by: [string, number][] }
export function liftInfo(st: MineView, stAt: number, now: number): LiftInfo {
  const L: Lift3 = st.lift || { st: 'dig' }, deep = deepOf(st), need = +(L.need || 0), c = +(L.c || 0);
  const s = L.st === 'fund' ? 'fund' : L.st === 'up' ? 'up' : 'dig';
  const leftMs = L.left != null ? +L.left - (now - (stAt || now)) : +(L.at || 0) - now;
  const by = Array.isArray(L.by) ? (L.by as unknown[]).filter((x): x is [string, number] => Array.isArray(x)).map(([l, v]) => [String(l), +v || 0] as [string, number]) : [];
  return { st: s, deep, n: st.n, onDeep: st.n >= deep, c, need, p: need ? Math.min(100, c / need * 100) : 0, rest: Math.max(0, need - c), ms: +(L.ms || 0), leftMs, by };
}
/** The interact prompt of the lift (short, says what E does). */
export function liftPrompt(st: MineView, stAt: number, now: number): string {
  const I = liftInfo(st, stAt, now);
  const fl = I.deep > 1 ? `этажи 1–${I.deep}` : 'этаж 1';
  const stage = !I.onDeep ? '' : I.st === 'fund' ? ` · сбор на этаж ${I.deep + 1}: ${Math.floor(I.p)}%` : I.st === 'up' && I.leftMs > 0 ? ` · этаж ${I.deep + 1} через ${tmrTxt(I.leftMs)}` : '';
  return `Лифт — ${fl}, выход в город${stage}`;
}
/** Coin buttons of a collection (site fundBlock): 100 / 500 / 1000 below what is left, then «Весь остаток». */
export function fundButtons(c: number, need: number): { v: number; all: boolean }[] {
  const left = Math.max(0, need - c);
  return [...[100, 500, 1000].filter((v) => v < left).map((v) => ({ v, all: false })), ...(left > 0 ? [{ v: left, all: true }] : [])];
}

/** A drill rig of the view (site d tuple [k, ?, cell, stage, lv, c, need, left, out, cap, rate, res, by]). */
export interface DrillInfo { k: string; cell: number; stg: string; lv: number; c: number; need: number; left: number; out: number; cap: number; rate: number; res: string; by: [string, number][] }
export function drillOf(d: Drill3 | unknown[]): DrillInfo {
  const a = d as unknown[];
  const by = Array.isArray(a[12]) ? (a[12] as unknown[]).filter((x): x is [string, number] => Array.isArray(x)).map(([l, v]) => [String(l), +v || 0] as [string, number]) : [];
  return { k: String(a[0]), cell: +(a[2] as number), stg: String(a[3] || ''), lv: +(a[4] as number) || 0, c: +(a[5] as number) || 0, need: +(a[6] as number) || 0, left: +(a[7] as number) || 0, out: +(a[8] as number) || 0, cap: +(a[9] as number) || 0, rate: +(a[10] as number) || 0, res: String(a[11] || ''), by };
}
export const drillsOf = (st: MineView | null | undefined): DrillInfo[] => ((st && st.drills) || []).filter(Array.isArray).map(drillOf);
/** The rig can take a contribution (site: site / work stage below level 3). */
export const drillFundable = (d: DrillInfo): boolean => (d.stg === 'site' || d.stg === 'work') && d.lv < 3;
/** Time left of a rig under construction (server left minus the view's age). */
export const drillLeft = (d: DrillInfo, stAt: number, now: number): number => d.left - (now - (stAt || now));
/** One line about a rig (site drillMenuHtml sub), plain text. */
export function drillLine(d: DrillInfo, stAt: number, now: number): string {
  const v = (x: number) => String(Math.round(x * 10) / 10).replace('.', ',');
  return d.stg === 'site' ? 'Площадка: жила почти выкопана. Буровая добывает 70% в казну, 30% — копавшим за час.'
    : d.stg === 'build' ? `Стройка ур. ${d.lv + 1}: готово через ${hmTxt(drillLeft(d, stAt, now))}.`
    : d.stg === 'dry' ? `Жила иссякла, добыто ${v(d.out)} шт.`
    : `${v(d.rate)} шт./ч. Добыто ${v(d.out)} из ${v(d.cap)}. 70% — в казну, 30% — копавшим.`;
}
/** Prompt of a rig: «Буровая · железо · ур. 2 — вклад» etc. */
export function drillPrompt(d: DrillInfo): string {
  const what = d.stg === 'site' ? 'площадка, скинуться на постройку' : d.stg === 'build' ? `стройка ур. ${d.lv + 1}` : d.stg === 'dry' ? 'жила иссякла' : drillFundable(d) ? `ур. ${d.lv}, скинуться на ур. ${d.lv + 1}` : `ур. ${d.lv}`;
  return `Буровая · ${resName(d.res)} — ${what}`;
}

/**
 * «Отдать» ore into a collection in two presses (site 30.10 oreAsk, report #2177): the first press only asks
 * «Точно отдать …?» for THIS heap (uid); the second, not sooner than 350 ms and not later than 8 s, sends.
 * A double click is not a confirmation; a press on another heap asks again.
 */
export const ORE_ASK_MS = 8000, ORE_ASK_MIN = 350;
export class OreAsk {
  uid: string | null = null; at = 0;
  asked(uid: string, now: number): boolean { return this.uid === uid && now - this.at < ORE_ASK_MS; }
  press(uid: string, now: number): 'ask' | 'send' | 'ignore' {
    const dt = this.uid === uid ? now - this.at : -1;
    if (dt >= ORE_ASK_MIN && dt < ORE_ASK_MS) { this.uid = null; return 'send'; }
    if (dt >= 0 && dt < ORE_ASK_MIN) return 'ignore';
    this.uid = uid; this.at = now; return 'ask';
  }
  clear(): void { this.uid = null; }
}

/** Heaps given away into a collection are hidden for a minute (site oreGone: the hero snapshot catches up in 10–20 s). */
export class OreGone {
  private m = new Map<string, number>();
  add(uid: string, now: number): void { this.m.set(uid, now); }
  has(uid: string, now: number): boolean { const t = this.m.get(uid); return !!t && now - t < 60000; }
}

/* ============================================================ the next step (objective line of the HUD) */
export interface ObjectiveIn {
  st: MineView; me: MineMe | null; myI: number; dark: boolean; lampHave: boolean; pickOn: boolean; buyerOn: boolean;
  capFull: boolean; canClaim: boolean; oreValue: number; v3: boolean; other: boolean; stAt: number; now: number;
}
export interface Objective { t: string; k: 'tab' | 'lamp' | 'wear' | 'cap' | 'dig' | 'claim' | 'sell' | 'lift' | 'shaft' | 'upper' | 'pick'; act?: 'wear' | 'buyer' | 'quests' | 'lift' }
/** What to do next, one short line (most urgent first). */
export function objective(o: ObjectiveIn): Objective {
  const st = o.st;
  if (o.other) return { k: 'tab', t: 'Шахта открыта в другой вкладке — нажми «Копать здесь»' };
  if (o.dark) return o.lampHave ? { k: 'wear', t: 'Темно: надень «Каску шахтёра» из сумки', act: 'wear' } : { k: 'lamp', t: `Темно: купи «Каску шахтёра» у ${o.pickOn ? 'Снабженца' : 'Фонарщика'} в зале` };
  if (o.canClaim) return { k: 'claim', t: 'Поручение выполнено — забери награду у доски', act: 'quests' };
  if (o.capFull) return { k: 'cap', t: 'На сегодня хватит — новые сутки в 05:00 МСК. Можно сдать руду и сходить в город' };
  if (o.myI >= 0) {
    if (o.v3 && st.n >= deepOf(st) && (st.lift || {}).st === 'fund') return { k: 'lift', t: 'Герой копает. Шахта лифта найдена — можно скинуться на новый этаж у лифта', act: 'lift' };
    return { k: 'dig', t: 'Герой копает сам — можно отойти по делам или выбрать следующий камень' };
  }
  if (o.buyerOn && o.oreValue >= 20) return { k: 'sell', t: `В сумке руды на ≈${Math.floor(o.oreValue)} — продай Скупщику Грому`, act: 'buyer' };
  if (o.v3) {
    const deep = deepOf(st), L = st.lift || {};
    if (st.n < deep) return { k: 'upper', t: `Этаж ${st.n} из ${deep}: копай здесь или спустись лифтом на ${deep}-й`, act: 'lift' };
    if (L.st === 'fund') return { k: 'lift', t: `Шахта лифта найдена! Скинься у лифта на этаж ${deep + 1}`, act: 'lift' };
    if (L.st === 'up') return { k: 'dig', t: `Лифт улучшается — этаж ${deep + 1} скоро. Пока копай камни с жёлтым кругом` };
    return { k: 'shaft', t: 'Копай проходы в туман — ищи жилы и шахту лифта (карта этажа слева)' };
  }
  return { k: 'dig', t: 'Подойди к камню с жёлтым кругом и нажми E' };
}
