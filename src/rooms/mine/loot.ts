/**
 * Own loot in the mine (site mine.js 11.11): what the aimed stone will give me («Получишь: …», expectOf over the site's
 * LGMineShares split — shares.ts), the dig log `me.lg` («Твой журнал в шахте», logLine / lgAll / myLog) and the loot
 * toasts of an own finished stone («Выкопан: …» with «+N руды» rows, dugToast / toastFromLog). Pure: the caller passes
 * the view, `me`, the login and `now`; nothing here talks to the game.
 *
 *   const x = expectOf(model, i, now);                            // { s: { iron: 120 }, exact: true } | null
 *   exText(x)                                                     // «+1 железо и 20 осколков»
 *   const t = dugToast(burst, cell, st.n, now);                   // { toast } | { want } (the game's me.lg tells later)
 */
import { project } from './shares';
import { TX, gotText, resName, blockTitle, type Burst, type Cell, type Floor, type MineMe, type MineView } from './state';

/** One line of the hero's mine log `me.lg` (site 11.11). */
export interface LgEntry {
  at: number;
  /** dug / part (walked away with a share) / rare / prize / sell / buy / lift / drill / claim. */
  k: string;
  /** Floor and cell of a stone. */
  n?: number; i?: number;
  /** Cell type and level of a stone. */
  t?: string; lv?: number;
  /** Loot or ore: resource → shards. */
  s?: Record<string, number>;
  /** Resource (rare vein, drill), prize id, coins. */
  r?: string; p?: string; c?: number;
}
/** Expected own loot of a stone (site expectOf): shards by resource; `exact` = no «≈»; `none` = a stone without ore; `game` = the server's own me.ex. */
export interface Expect { s: Record<string, number>; exact: boolean; none?: boolean; game?: boolean }

export const PRIZE_RU: Record<string, string> = { enchant_star: 'Счастливая звезда', enchant_sphere: 'Сфера сохранения' };
/** «+2 железо и 37 осколков, +40 осколков угля» (largest first; site lootText). */
export const lootText = (s: Record<string, number> | null | undefined): string =>
  Object.entries(s || {}).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).map(([k, v]) => gotText(v, k)).join(', ');
/** Shards → «2 шт. + 37 оск.» (site LGInventory.oreQty). */
export const oreQty = (q0: number): string => { const q = Math.max(0, Math.floor(+q0 || 0)), n = Math.floor(q / 100), p = q % 100; return n && p ? `${n} шт. + ${p} оск.` : n ? `${n} шт.` : `${p} оск.`; };
const oreList = (s: Record<string, number> | undefined) => Object.entries(s || {}).filter(([, v]) => v > 0).map(([k, v]) => `${resName(k)} ${oreQty(v)}`).join(', ');
const isChest = (t: string | undefined) => t === 'chest' || t === 'prize';

/** Text of one log line (site logLine); '' = not shown. */
export function logLine(e: LgEntry): string {
  const L = lootText(e.s), nm = String(TX.b[e.t || ''] || TX.b.rock);
  const b = isChest(e.t) ? 'Сундук' : `${nm[0].toUpperCase() + nm.slice(1)}${e.lv ? ` ${e.lv} ур.` : ''}`;
  switch (e.k) {
    case 'dug': return L ? `${b}: ${L}` : `${b} выкопан - добыча другим по вкладу, тебе оплата за работу`;
    case 'part': return L ? `Ушёл от камня (${e.lv || ''} ур.) с долей: ${L}` : 'Ушёл от камня';
    case 'rare': return `Жила твоя: ${resName(e.r || '')}`;
    case 'prize': return `Приз сундука: ${PRIZE_RU[e.p || ''] || e.p}`;
    case 'sell': return `Скупщик: заработок ${e.c || 0}${oreList(e.s) ? ` · сдано: ${oreList(e.s)}` : ''}`;
    case 'buy': return `Скупщик купил: ${oreList(e.s) || 'руду'}`;
    case 'lift': return `Вклад в лифт: ${e.c || 0}`;
    case 'drill': return `Вклад в буровую${e.r ? ` (${resName(e.r)})` : ''}: ${e.c || 0}`;
    case 'claim': return `Награда за поручения: ${e.c || 0}`;
    default: return '';
  }
}
const sameDug = (a: LgEntry, b: LgEntry) => a && b && a.k === 'dug' && b.k === 'dug' && a.n === b.n && a.i === b.i;
/** The game's log + own lines written at a finished stone that the game has not listed yet, newest first, 12 (site lgAll). */
export function lgAll(me: MineMe | null | undefined, local: readonly LgEntry[]): LgEntry[] {
  const L = me && Array.isArray(me.lg) ? me.lg : [], loc = local.filter((e) => !L.some((x) => sameDug(x, e)));
  return loc.length ? [...loc, ...L].sort((a, b) => (+b.at || 0) - (+a.at || 0)).slice(0, 12) : L;
}
/**
 * «Твой журнал в шахте» lines (site myLog). A game without `me.lg` (before 11.11) still has the shared `st.log`: it is
 * shown then, so an older server keeps the journal it had.
 */
export function myLog(me: MineMe | null | undefined, local: readonly LgEntry[], st?: MineView | null): { t: string; at: number }[] {
  if (!(me && Array.isArray(me.lg)) && !local.length && st && Array.isArray(st.log)) return st.log.map((e) => ({ t: String(e.t || ''), at: +e.at || 0 })).filter((e) => e.t);
  return lgAll(me, local).map((e) => ({ t: logLine(e || ({} as LgEntry)), at: +(e && e.at) || 0 })).filter((e) => e.t);
}
/** Empty journal text (site logEmpty). */
export const LOG_EMPTY = 'Пока пусто - здесь будут твои камни, добыча, находки и вклады.';

/** Loot a stone holds: ore cell → { res: a·100 }, a chest → st.fl.ch[i] (site lootOfCell). */
export function lootOfCell(st: MineView | null, F: Floor | null, i: number): Record<string, number> {
  const c = F && F.cells[i]; if (!c) return {};
  if (c.r && c.a > 0) return { [c.r]: Math.round(c.a * 100) };
  if (isChest(c.t)) { const ch = st && st.fl && st.fl.ch, m = ch && (ch[i] || ch[String(i)]); return m ? { ...m } : {}; }
  return {};
}
export interface ExpectCtx { st: MineView | null; F: Floor | null; dug: readonly number[]; me: MineMe | null; myI: number; login: string }
/**
 * What stone i gives me (site expectOf): the game's own me.ex for the stone I dig; otherwise the LGMineShares projection
 * of its loot over the work done (U = by those who left, the current diggers by power P, pd = shards already paid out)
 * and the work left (shared by power, me with my pickaxe power pw). null = nothing to say (dug / unknown).
 */
export function expectOf(o: ExpectCtx, i: number, now: number): Expect | null {
  const { st, F } = o;
  if (!st || !F || i < 0 || o.dug[i]) return null;
  const loot = lootOfCell(st, F, i);
  if (!Object.keys(loot).length) return { s: {}, exact: true, none: true };
  const me = o.me || ({} as MineMe), ml = o.login, bl = st.bl || {};
  if (me.ex && me.ex[1] === i && (!(st.fl && st.fl.v3) || me.ex[0] === st.n) && o.myI === i) return { s: me.ex[2] || {}, exact: !(bl[i] && bl[i][3] > 1), game: true };
  const b = bl[i], pw = +(me.pw as number) || 1;
  if (!b) return { s: project({ loot, by: {}, left: 1, dig: [], me: ml, pw }), exact: true };
  const [left, , rate, n, U = 0, P = 0, pd = 0] = b, age = Math.max(0, (now - (st.at || now)) / 60000), l2 = Math.max(0, left - rate * age);
  const tot = Object.values(loot).reduce((a, v) => a + v, 0), paid: Record<string, number> = {};
  if (pd > 0 && tot > 0) for (const [k, v] of Object.entries(loot)) paid[k] = Math.round(pd * v / tot);
  const done = Math.max(0, left - l2), mine = o.myI === i;
  const oP = Math.max(0, P - (mine ? pw : 0)), by: Record<string, number> = { '~': U + done * (oP / Math.max(1e-9, P || 1)) }, dig: [string, number][] = oP > 0 ? [['~', oP]] : [];
  if (mine) by[ml] = done * (pw / Math.max(1e-9, P || pw));
  return { s: project({ loot, paid, by, left: l2, dig, me: ml, pw }), exact: !(U > 0) && !(n - (mine ? 1 : 0) > 0) };
}
/** Text after «Получишь:» (site exHtml, plain text). */
export function exText(x: Expect | null): string {
  if (!x) return '';
  if (x.none) return 'без руды - только оплата за работу';
  return Object.keys(x.s).length ? `${x.exact ? '' : '≈ '}${lootText(x.s)}` : 'тебе - только оплата (руда - другим по вкладу)';
}
/** Buyer value of an expectation (coins, buyer prices st.bp per piece); null without prices. */
export function exCoins(x: Expect | null, bp: Record<string, number> | undefined): number | null {
  if (!x || x.none || !bp) return null;
  let c = 0, any = false;
  for (const [k, v] of Object.entries(x.s)) { const p = +bp[k]; if (p > 0 && v > 0) { c += v / 100 * p; any = true; } }
  return any ? c : null;
}

/* ---------------------------------------------------------------- toasts */

/** A loot toast: heading, loot rows (resource → shards, largest first, ≤ 6), a small line under them. */
export interface LootToast { head: string; s: Record<string, number> | null; sub: string }
/** Waiting for the game's me.lg line of this stone (site S.toastWant). */
export interface ToastWant { n: number; i: number; at: number; head: string }
export const TOAST_MS = 4500;
const SUB_BAG = 'Добыча - в сумке';
/** Rows of a toast (site lootToast). */
export const toastRows = (s: Record<string, number> | null | undefined): [string, number][] => Object.entries(s || {}).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).slice(0, 6);
/**
 * Own stone finished (site dugToast): the view's loot (dl) → a toast now (+ a local log line until the game lists it);
 * ore that went to the others → a toast that says so; a stone without ore → «оплата за работу»; otherwise wait for the
 * game's log line (toastFromLog).
 */
export function dugToast(b: Burst, cell: Cell, floor: number, now: number): { toast?: LootToast; want?: ToastWant; local?: LgEntry } {
  const t = blockTitle(cell), head = isChest(cell.t) ? 'Сундук вскрыт!' : `Выкопан: ${t}`, g = b.got;
  const s = g && g.loot ? { ...g.loot } : g && cell.r && g.q > 0 ? { [cell.r]: g.q } : null;
  if (s && Object.keys(s).length) return { toast: { head, s, sub: SUB_BAG }, local: { at: now, k: 'dug', n: floor, i: b.i, t: cell.t, lv: cell.lv || floor, s } };
  if (g && g.any && cell.r) return { toast: { head, s: null, sub: `${resName(cell.r)} досталась другим копавшим по вкладу - тебе оплата за работу` } };
  if (!(cell.r && cell.a > 0) && !isChest(cell.t)) return { toast: { head, s: null, sub: 'Руды в камне не было - оплата за работу' } };
  return { want: { n: floor, i: b.i, at: now, head } };
}
/** The game's log has the awaited stone (site toastFromLog): the toast, or drop the wait after 90 s. */
export function toastFromLog(w: ToastWant | null, lg: readonly LgEntry[] | undefined, now: number): { toast: LootToast | null; done: boolean } {
  if (!w) return { toast: null, done: true };
  if (now - w.at > 90000) return { toast: null, done: true };
  const e = (lg || []).find((x) => x && x.k === 'dug' && x.i === w.i && x.n === w.n && x.at >= w.at - 120000);
  if (!e) return { toast: null, done: false };
  return { toast: { head: w.head, s: e.s || null, sub: Object.keys(e.s || {}).length ? SUB_BAG : 'Добыча - другим по вкладу, тебе оплата за работу' }, done: true };
}
