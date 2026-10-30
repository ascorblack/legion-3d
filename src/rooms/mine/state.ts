/**
 * Mine data model: types of the site's mine payloads (docs/MINE.md) and the state merge logic of the site's client
 * (mine.js take0 / presence / gotOf), as a pure class without timers, network or DOM. `now` is always a parameter
 * so tests are deterministic. The network client (net.ts) owns one MineModel.
 */
import { GH, N_CELLS, SPEED, type Pt } from './geo';
import { GEO1, OPEN3, geomOf, type MineGeom } from './geo3';

/* ============================================================ payload types (see docs/MINE.md) */

/** Cell tuple of the floor layout: [type, level, resource, a]. */
export type CellTuple = [string, number, string, number];
/** «Шахта 3.0» (st.fl.v3): only the cells the hero may see, [index, type, level, resource, a, vein?, hall?]. */
export type CellTuple3 = [number, string, number, string, number, number?, number?];
/** Vein of a big floor: [id, resource, cell (−1 not seen yet), cells behind the fog edge (sparks)]. */
export type Vein3 = [number, string, number, number[]?];
/** Special hall of a big floor: [id, kind 'lake' | 'grotto' | 'adit', cell]. */
export type Hall3 = [number, string, number, ...unknown[]];
export interface FloorLayout {
  exit?: number; entry?: number; special?: string | null; c: CellTuple[] | CellTuple3[];
  /** 29.10 «Шахта 3.0»: a big non-linear floor of w × h cells (site mine3.js / LGWorldLib.mine3). */
  v3?: number; w?: number; h?: number; sx?: number; sy?: number; lift?: number; hallBox?: number[]; fog?: number; shaft?: number;
  veins?: Vein3[]; halls?: Hall3[];
}
/** Lift of a big floor (st.lift): stage dig (find the lift shaft) → fund (collect coins) → up (upgrade timer). */
export interface Lift3 { st?: string; n?: number; c?: number; need?: number; at?: number; ms?: number; left?: number; by?: unknown[] }
/** Drill rig of a big floor (st.drills): [key, ?, cell, stage 'site' | 'build' | 'work' | 'dry', level, …, resource (11)]. */
export type Drill3 = [string, unknown, number, string, number, ...unknown[]];
/** [left work, total work, rate per minute, diggers] of a stone being dug. */
export type Bl = [number, number, number, number];
/** Loot of a dug stone: [cell, floor, resource, pieces by login, shards by login, loot by login]. */
export type Dl = [number, number, string, Record<string, number>, Record<string, number>?, Record<string, Record<string, number>>?];
export interface MineView {
  v: number; at: number; craft?: string; biome?: string; danger?: number; gem?: string | null; id?: string; name?: string; dist?: string;
  n: number; seed: number; entryX?: number; gen?: number; week?: number; reset?: number; rec?: number;
  dug: string; bl?: Record<string, Bl>; dg?: Record<string, string[]>; front?: number[];
  log?: { t: string; at: number }[]; top?: [string, number][]; fl?: FloorLayout;
  lampFrom?: number; darkFrom?: number; lampPrice?: number; bp?: Record<string, number>; hist?: unknown[];
  working?: number; dl?: Dl[]; town?: string;
  /** «Шахта 3.0»: lift stage, the deepest open floor, drill rigs. */
  lift?: Lift3; deep?: number; drills?: Drill3[];
}
export interface Quest { id: string; t: string; p: number; g: number; c: number; done?: number; cl?: number; h?: string }
/** Shared weekly mine quest (site 28.10, me.q.c): common progress p / g, own contribution me vs threshold min (ok = enough), n participants. */
export interface QuestC { id?: string; t: string; p: number; g: number; c: number; min: number; me: number; n?: number; ok?: number | boolean; done?: number; cl?: number }
/** «Пока тебя не было» (me.news): b stones, f rare finds, c / cx coins, r / p ore pieces / shards, at = when it was written. */
export interface MineNews { b?: number; f?: number; c?: number; cx?: number; r?: Record<string, number>; p?: Record<string, number>; at?: number }
/** Pickaxe ladder step: [name, power, mastery, price, ore needs (shards), discounts {res: [replaces, ratio]}]. */
export type PickStep = [string, number, number, number, Record<string, number>, Record<string, [string, number]>];
export interface MineMe {
  i: number; day: number; cap: number;
  bag?: { c: number; cx?: number; r: Record<string, number>; p?: Record<string, number> };
  mx?: { lv: number; xp: number; need: number }; wk?: number; pw?: number; pk?: number; lamp?: number;
  q?: { d: Quest[]; w: Quest[]; c?: QuestC | null }; nm?: string; dist?: string; bi?: string; dg?: number; gem?: string;
  fx?: Record<string, number>; qq?: number[];
  pkx?: { lv: number; ob: { cap: number; used: number } | 0; obP: number; obL: number; obC: number; t: PickStep[] };
  news?: MineNews | null;
  /** «Шахта 3.0»: the floor the hero is on (at) / digs on (f). */
  at?: number; f?: number;
}
export interface LookRec { n?: string; lv?: number; lk?: Record<string, unknown>; g?: Record<string, unknown>; gh?: number; pk?: number }
export interface PresenceA { l: string; n?: string; lv?: number; lk?: Record<string, unknown>; g?: Record<string, unknown>; gh?: number; x: number; y: number; tx: number; ty: number; dt?: number }
export type PresenceM = [string, number, number, number, number, number?];
export interface MinePayload {
  ok?: boolean; error?: string; other?: boolean;
  me?: MineMe; st?: MineView; lk?: Record<string, LookRec>;
  a?: PresenceA[]; m?: PresenceM[]; g?: string[]; n?: number; max?: number;
  sid?: string; c?: string; here?: number; hw?: number; hm?: number;
  mchat?: { chat?: ChatLine[]; c?: number }; chat?: ChatLine[]; chatRoom?: string;
  crafts?: unknown; open?: string[]; town?: string; same?: number;
}
/** r: the author's chat role ('own' админ / 'mod' модератор — site ROLE_ICO), k: kind. */
export interface ChatLine { id: string; s?: number; l: string; n: string; t: string; at: number; c?: string; cn?: string; r?: string; k?: string }

/* ============================================================ derived floor */

/** vein / hall: «Шахта 3.0» ids of the vein and the special hall the cell belongs to. */
export interface Cell { i: number; t: string; lv: number; r: string | null; a: number; k: 0 | 1; vein?: number; hall?: number }
export interface Floor {
  n: number; biome: string; danger: number; gem: string | null; special: string | null; exit: number; entry: number; cells: Cell[];
  /** «Шахта 3.0»: the big floor. vis[i] = 1 — the site shows cell i; every other cell is fog (t 'fog', nothing known). */
  v3?: 1; w?: number; h?: number; vis?: Uint8Array; lift?: number; hallBox?: number[]; fog?: number; shaft?: number;
  veins?: Vein3[]; halls?: Hall3[];
  /** cell → drill rig { key, stage, level, resource }. */
  drills?: Map<number, { k: string; st: string; lv: number; r: string }>;
}

/** A big floor (site mine3.js floorOf): cells only where the view lists them (the site's own visibility), the rest fog. */
function floorOf3(st: MineView): Floor {
  const fl = st.fl!, w = Math.max(1, +fl.w! || 1), h = Math.max(1, +fl.h! || 1), N = w * h, cells: Cell[] = new Array(N), vis = new Uint8Array(N);
  for (let i = 0; i < N; i++) cells[i] = { i, t: 'fog', lv: 0, r: null, a: 0, k: 0 };
  for (const c of fl.c as CellTuple3[]) {
    const [i, t, lv, r, a, vein, hall] = c; if (!(i >= 0 && i < N)) continue;
    cells[i] = { i, t, lv, r: r || null, a, k: OPEN3.has(t) || t === 'wall' ? 0 : 1, ...(vein != null && vein >= 0 ? { vein } : {}), ...(hall != null && hall >= 0 ? { hall } : {}) };
    vis[i] = 1;
  }
  const drills = new Map<number, { k: string; st: string; lv: number; r: string }>();
  for (const d of st.drills || []) if (Array.isArray(d)) drills.set(+d[2], { k: String(d[0]), st: String(d[3] || ''), lv: +d[4] || 0, r: String(d[11] || '') });
  return {
    n: st.n, biome: st.biome || 'mount', danger: st.danger || 1, gem: st.gem || null, special: null, exit: -1, entry: fl.lift ?? -1, cells,
    v3: 1, w, h, vis, lift: fl.lift, hallBox: fl.hallBox, fog: fl.fog || 2, shaft: fl.shaft != null ? fl.shaft : -1, veins: fl.veins || [], halls: fl.halls || [], drills,
  };
}

export function floorOf(st: MineView): Floor | null {
  if (!st || !st.fl) return null;
  if (st.fl.v3) return floorOf3(st);
  const cells = (st.fl.c as CellTuple[]).map(([t, lv, r, a], i): Cell => ({ i, t, lv, r: r || null, a, k: t === 'entry' || t === 'wall' || t === 'void' ? 0 : 1 }));
  return { n: st.n, biome: st.biome || 'mount', danger: st.danger || 1, gem: st.gem || null, special: st.fl.special ?? null, exit: st.fl.exit ?? -1, entry: st.fl.entry ?? -1, cells };
}
/** Level of cell i in a view (both layouts: the classic one by position, the big floor by the listed index); 0 unknown. */
export function cellLevel(st: MineView, i: number): number {
  const fl = st.fl; if (!fl) return 0;
  if (fl.v3) { for (const c of fl.c as CellTuple3[]) if (c[0] === i) return +c[2] || 0; return 0; }
  const c = (fl.c as CellTuple[])[i]; return c ? +c[1] || 0 : 0;
}
export const dugArr = (st: MineView | null): number[] => (st && st.dug ? st.dug.split('').map((c) => (c === '1' ? 1 : 0)) : []);

/** Progress of stone i at time now: p = 0…1 done, eta in seconds, n diggers. null = nobody digs it. */
export function stoneProgress(st: MineView, i: number, now: number): { p: number; eta: number; n: number } | null {
  const b = st.bl && st.bl[i]; if (!b) return null;
  const [left, w, rate, n] = b; if (!w) return null;
  const age = (now - (st.at || now)) / 60000, l2 = Math.max(0, left - rate * Math.max(0, age));
  return { p: Math.max(0, Math.min(1, 1 - l2 / w)), eta: rate > 0 ? (l2 / rate) * 60 : 0, n: n || 0 };
}

/* ============================================================ texts (site words) */

export const BIO_RU: Record<string, string> = { mount: 'горы', ash: 'пепел', forest: 'лес', taiga: 'тайга', ice: 'лёд', meadow: 'луга', swamp: 'болото', blight: 'порча', coast: 'побережье', desert: 'пустыня', ruin: 'руины' };
export const stars = (d: number) => '★'.repeat(Math.max(1, Math.min(5, +d || 1)));
export const TX = {
  to: 'К скупщику', place: 'Шахта', mast: 'Горное дело', seller: 'Скупщик Гром', sup: 'Снабженец Кремень', lampNpc: 'Фонарщик',
  hello: 'Сдавай руду — заплачу за работу, а руду отправлю в казну Ратуши на развитие города.',
  pick: 'Выбери камень, чтобы копать', doing: 'Копаешь', stop: 'Перестать копать', stopTip: 'Герой отложил кирку',
  bagEmpty: 'Рудная сумка пуста — накопай руды.', done: 'Камень выкопан — выбери следующий', broke: 'Камень разбит!',
  rare: 'Ты вскрыл редкую жилу', wall: 'Скалу не разбить — обойди', far: 'К этому камню пока не подойти — сначала расчисти путь',
  sold: 'Скупщик принял руду', today: 'Сегодня в шахте', here: 'В шахте', work: 'копают',
  dark: 'Темно — без каски с фонарём не видно, куда бить. Фонарщик — у входа',
  b: { rock: 'камень', hard: 'твёрдая порода', ore: 'руда', rare: 'редкая жила', chest: 'окаменевший сундук' } as Record<string, string>,
  sp: { vein: 'богатая жила', flood: 'затопленная штольня', den: 'логово крота' } as Record<string, string>,
};
export const RES: Record<string, string> = {
  stone: 'камень', basalt: 'базальт', coal: 'уголь', iron: 'железо', silver: 'серебро', gold: 'золото', crystal: 'кристаллы', sulfur: 'сера', obsidian: 'обсидиан',
  peat: 'торф', bone_dust: 'костяная пыль', salt: 'соль', amber: 'янтарь', relic: 'древности', rubble: 'щебень', clay: 'глина',
  copper: 'медь', frost_stone: 'мёрзлый камень', limestone: 'известняк', sandstone: 'песчаник',
  adamant: 'адамантит', fire_opal: 'огненный опал', emerald: 'изумруд', sapphire: 'сапфир', topaz: 'топаз', malachite: 'малахит', morion: 'морион', aquamarine: 'аквамарин', ruby: 'рубин', runestone: 'рунный камень',
};
export const RESG: Record<string, string> = {
  stone: 'камня', basalt: 'базальта', coal: 'угля', iron: 'железа', silver: 'серебра', gold: 'золота', crystal: 'кристаллов', sulfur: 'серы', obsidian: 'обсидиана',
  peat: 'торфа', bone_dust: 'костяной пыли', salt: 'соли', amber: 'янтаря', relic: 'древностей', rubble: 'щебня', clay: 'глины',
  copper: 'меди', frost_stone: 'мёрзлого камня', limestone: 'известняка', sandstone: 'песчаника',
  adamant: 'адамантита', fire_opal: 'огненного опала', emerald: 'изумруда', sapphire: 'сапфира', topaz: 'топаза', malachite: 'малахита', morion: 'мориона', aquamarine: 'аквамарина', ruby: 'рубина', runestone: 'рунного камня',
};
export const resName = (k: string) => RES[k] || k;
export const oskW = (n: number) => { const a = n % 10, b = n % 100; return a === 1 && b !== 11 ? 'осколок' : a >= 2 && a <= 4 && (b < 12 || b > 14) ? 'осколка' : 'осколков'; };
export const qty = (n: number, p: number) => (n && p ? `${n} шт. + ${p} ${oskW(p)}` : n ? `${n} шт.` : `${p} ${oskW(p)}`);
/** Shards (1 piece = 100) → «+2 железо и 37 осколков» / «+37 осколков железа». */
export const gotText = (v: number, k: string) => { const n = Math.floor(v / 100), p = v % 100; return n ? `+${n} ${resName(k)}${p ? ` и ${p} ${oskW(p)}` : ''}` : `+${p} ${oskW(p)} ${RESG[k] || resName(k)}`; };
export const blockTitle = (c: Cell) => `${TX.b[c.t] || TX.b.rock} ${c.lv} ур.${c.r && (c.t === 'ore' || c.t === 'rare') ? ' · ' + resName(c.r) : ''}`;
export const mmss = (min: number) => { const m = Math.max(0, Math.round(min)); return m >= 60 ? `${Math.floor(m / 60)} ч ${m % 60} мин` : `${m} мин`; };
export const leftTxt = (ms: number) => { const m = Math.ceil(ms / 60000); return ms <= 0 ? 'почти' : m < 60 ? `ещё ${m} мин` : `ещё ${Math.floor(m / 60)} ч ${m % 60} мин`; };
/** Bag: r = whole pieces, p = shards above them → [[res, pieces, shards]]. */
export const resList = (b: MineMe['bag']) => { const r = (b && b.r) || {}, p = (b && b.p) || {}; return [...new Set([...Object.keys(r), ...Object.keys(p)])].map((k) => [k, +r[k] || 0, +p[k] || 0] as [string, number, number]).filter(([, n, x]) => n > 0 || x > 0); };

/* ============================================================ quests: shared quest, claim button */

/** q.c is done for me and not yet taken (site qcReady). */
export const qcReady = (qc: QuestC | null | undefined): boolean => !!(qc && qc.done && qc.ok && !qc.cl);
/**
 * «Забрать награду» is lit when any daily / weekly quest is done and not taken, OR only the shared q.c is ready for me
 * (site canClaim); not within 60 s after a claim (the hero snapshot lags behind).
 */
export function canClaimOf(q: MineMe['q'] | null | undefined, claimedAt: number, now: number): boolean {
  if (!q) return false;
  if (claimedAt && now - claimedAt < 60000) return false;
  return [...(q.d || []), ...(q.w || [])].some((x) => x.done && !x.cl) || qcReady(q.c);
}
/** After a successful claim the site marks the shared quest taken too (only if it was ready for me). */
export function markQcClaimed(q: MineMe['q'] | null | undefined): void { if (q && q.c && q.c.done && q.c.ok) q.c.cl = 1; }
/** Text on the right of a q.c row, as the site: «получено» / «готово» / «выполнено» / «p / g». */
export const qcStatus = (qc: QuestC): string => (qc.cl ? 'получено' : qc.done ? (qc.ok ? 'готово' : 'выполнено') : `${qc.p} / ${qc.g}`);

/* ============================================================ «Пока тебя не было» gate */

export const newsKey = (nw: MineNews): string => `${nw.b || 0}:${nw.at || 0}:${nw.f || 0}`;
/** Summaries already acknowledged on this page: mine id → key (as the site's NEWS_SEEN; a late hero snapshot must not bring one back). */
const NEWS_SEEN = new Map<string, string>();
/** The window shows only in the first NEWS_WINDOW ms after entering. */
export const NEWS_WINDOW = 15000;
/**
 * Decides when me.news is shown (site mine.js «Пока тебя не было»): only within 15 s of entering the mine and once per
 * visit; a summary that arrives later is marked read silently (one /api/mineSeen, no window over the game). «Понятно» →
 * ack(): exactly one /api/mineSeen per summary. Pure (the caller passes `now` and the request).
 */
export class NewsGate {
  private at0 = 0; private shown = false; private acked = new Set<string>();
  constructor(private seenMap: Map<string, string> = NEWS_SEEN) {}
  /** Call on every render with the current me. Returns the summary to show now, or null. */
  tick(me: MineMe | null | undefined, c: string, now: number, seen: () => void): MineNews | null {
    if (!me) return null;
    if (!this.at0) this.at0 = now;
    const nw = me.news; if (!nw || this.shown || this.seenMap.get(c) === newsKey(nw)) return null;
    this.shown = true;
    if (now - this.at0 < NEWS_WINDOW) return nw;
    this.seenMap.set(c, newsKey(nw)); this.acked.add(c + '|' + newsKey(nw)); seen();
    return null;
  }
  /** The player pressed «Понятно» (or clicked the backdrop, as on the site): one mineSeen. */
  ack(nw: MineNews, c: string, seen: () => void): boolean {
    const k = c + '|' + newsKey(nw); if (this.acked.has(k)) return false;
    this.acked.add(k); this.seenMap.set(c, newsKey(nw)); seen(); return true;
  }
}

/* ============================================================ day limit and resets (MSK = UTC+3) */

export const MSK_MS = 3 * 3600e3;
/** The game day starts at 05:00 Moscow time (= 02:00 UTC). */
export const DAY_START_H = 5;
/** Next 05:00 MSK strictly after `now` (epoch ms). */
export function nextDayReset(now: number): number {
  const t = now + MSK_MS, day0 = Math.floor(t / 864e5) * 864e5;
  let r = day0 + DAY_START_H * 3600e3; if (r <= t) r += 864e5;
  return r - MSK_MS;
}
/** «3 ч 12 мин» / «42 мин» / «2 д 4 ч» for a duration in ms (rounded up to the minute; days when ≥ 24 h). */
export function spanTxt(ms: number): string {
  const m = Math.max(0, Math.ceil(ms / 60000));
  if (m >= 1440) { const d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60); return `${d} д${h ? ` ${h} ч` : ''}`; }
  return m >= 60 ? `${Math.floor(m / 60)} ч${m % 60 ? ` ${m % 60} мин` : ''}` : `${m} мин`;
}
export const DAY_LOW_MIN = 60;
export interface DayLimit {
  /** off: no cap; ok; low: ≤ 60 min left; full: nothing left. */
  kind: 'off' | 'ok' | 'low' | 'full';
  /** Minutes of work left today (cap − day), 0 when full. */
  left: number;
  /** ms until the next game day (05:00 MSK). */
  resetIn: number;
  /** One line for the HUD, '' when kind is ok / off. */
  text: string;
}
export function dayLimit(me: { day: number; cap: number } | null | undefined, now: number): DayLimit {
  const resetIn = nextDayReset(now) - now;
  if (!me || !(me.cap > 0)) return { kind: 'off', left: 0, resetIn, text: '' };
  const left = Math.max(0, me.cap - me.day);
  if (left <= 0) return { kind: 'full', left: 0, resetIn, text: `На сегодня хватит. Новые сутки в 05:00 (через ${spanTxt(resetIn)})` };
  if (left <= DAY_LOW_MIN) return { kind: 'low', left, resetIn, text: `Осталось ${spanTxt(left * 60000)} · новые сутки в 05:00 МСК` };
  return { kind: 'ok', left, resetIn, text: '' };
}
const WD = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
/** «Новая шахта в сб 18:00 (через 2 д 4 ч)» from st.reset (epoch ms); '' when unknown or passed. */
export function weekResetTxt(reset: number | undefined, now: number): string {
  if (!reset || reset <= now) return '';
  const d = new Date(reset + MSK_MS), hh = String(d.getUTCHours()).padStart(2, '0'), mm = String(d.getUTCMinutes()).padStart(2, '0');
  return `Новая шахта в ${WD[d.getUTCDay()]} ${hh}:${mm} МСК (через ${spanTxt(reset - now)})`;
}

/* ============================================================ model */

export interface Other { login: string; v: LookRec | null; x: number; y: number; tx: number; ty: number; t0: number; dt: number; dur: number }
export interface Burst { i: number; mine: boolean; got: { r: string; q: number; any: number; loot: Record<string, number> | null } | null }
export interface TakeResult { changed: boolean; newFloor: boolean; bursts: Burst[]; needFull?: boolean }

/**
 * State of one open mine as the site's client keeps it. Feed it every payload (enter / state / SSE 'mine'), it
 * resolves stale views, the own stone (myI) with the "want"/"left" protections, presence and looks.
 */
export class MineModel {
  st: MineView | null = null;
  F: Floor | null = null;
  /** Geometry of the current floor: the classic 7 × 12 one or a big «Шахта 3.0» floor (geo3.ts). */
  G: MineGeom = GEO1;
  dug: number[] = [];
  me: MineMe | null = null;
  myI = -1;
  /** Own choice that wins over late views for up to 15 s: i ≥ 0 = digging i, i = −1 = walked away. */
  want: { i: number; at: number } | null = null;
  /** Walked away from stone i (confirmed by the game later); stop is re-sent every 30 s while views still say "digging". */
  left: { i: number; at: number; sent?: number } | null = null;
  readonly others = new Map<string, Other>();
  readonly looks = new Map<string, LookRec>();
  readonly lkWant = new Set<string>();
  nOthers = 0;
  here: number | null = null; hw: number | null = null; hm = 0;
  stAt = 0;
  /** Set when a stop must be re-sent (left protection) — the client sends /api/mineStop and clears it. */
  needStop = false;
  constructor(public login: string) { this.login = String(login || '').toLowerCase(); }
  /** The next view is another mine key's (a floor switch): accept it whatever its version and treat it as a new floor. */
  fresh = false;
  /**
   * Another floor key is opened (site open() starts with a fresh S): forget who is here and the own stone; the floor on
   * show stays until the new view arrives (the scene keeps drawing it meanwhile). Looks stay.
   */
  reset(): void {
    this.fresh = true; this.myI = -1; this.want = null; this.left = null;
    this.others.clear(); this.lkWant.clear(); this.nOthers = 0; this.here = null; this.hw = null; this.needStop = false;
  }

  /** Apply a view (st) and/or my record (me) and looks (lk). Mirrors mine.js take0. */
  take(st: MineView | null | undefined, me: MineMe | null | undefined, lk: Record<string, LookRec> | null | undefined, now: number, heroMe?: MineMe | null): TakeResult {
    const res: TakeResult = { changed: false, newFloor: false, bursts: [] };
    if (me) this.me = me; else if (heroMe) this.me = heroMe;
    if (lk) for (const [l, v] of Object.entries(lk)) this.looks.set(l, v);
    // late view (poll and SSE interleave) — never roll back
    if (st && this.st && !this.fresh && st.v < this.st.v && st.v > this.st.v - 500 && st.week === this.st.week) st = null;
    if (!st) return res;
    if (!st.fl) {
      if (this.st && this.st.fl && !this.fresh && this.st.seed === st.seed && this.st.n === st.n) st = { ...st, fl: this.st.fl };
      else { res.needFull = true; return res; }   // a new floor without layout: the client asks for the full view
    }
    const newFloor = !this.st || this.fresh || this.st.n !== st.n || this.st.seed !== st.seed;
    this.fresh = false;
    const prevDug = this.dug, prevDg = (this.st && this.st.dg) || {}, prevMy = this.myI;
    this.st = st; this.F = floorOf(st); this.G = geomOf(st); this.dug = dugArr(st); this.stAt = now;
    const me_ = this.login;
    const gotOf = (i: number): Burst['got'] => {
      const d = (st!.dl || []).find((x) => x[0] === i && x[1] === st!.n); if (!d) return null;
      const m = d[4] || d[3] || {}, v = m[me_] || 0;
      return { r: d[2], q: d[4] ? v : Math.round(v * 100), any: Object.keys(m).length, loot: (d[5] || {})[me_] || null };
    };
    if (!newFloor && prevDug.length) {
      res.bursts = this.dug.map((d, i) => (d && !prevDug[i] ? i : -1)).filter((i) => i >= 0)
        .map((i) => ({ i, mine: i === prevMy || (prevDg[i] || []).includes(me_), got: gotOf(i) }));
    }
    // own stone: from the view (who digs where) — up to 4 listed per stone; trust me.i only when more dig than listed
    const mine = Object.entries(st.dg || {}).find(([, ls]) => ls.includes(me_));
    // site 29.10: on a big floor the hero may dig on another floor (me.f) — then me.i is not a stone of this one
    const mb = this.me && this.me.i >= 0 && !(st.fl && st.fl.v3 && this.me.f && this.me.f !== st.n) ? (st.bl || {})[this.me.i] : null;
    this.myI = mine ? +mine[0] : (mb && st.dug[this.me!.i] !== '1' && (mb[3] || 0) > ((st.dg || {})[this.me!.i] || []).length ? this.me!.i : -1);
    if (this.left) {
      if (this.myI >= 0 && this.myI === this.left.i) {
        this.myI = -1;
        if (now - (this.left.sent || this.left.at) > 30000 && now - this.left.at < 30 * 60000) { this.left.sent = now; this.needStop = true; }
      } else if (this.myI >= 0 || now - this.left.at > 3000) this.left = null;
    }
    if (this.want) {
      const w = this.want, old = now - w.at > 15000 || newFloor;
      if (old || (w.i >= 0 ? this.myI === w.i || st.dug[w.i] === '1' : this.myI < 0)) this.want = null;
      else this.myI = w.i;
    }
    for (const ls of Object.values(st.dg || {})) for (const l of ls.filter((x) => x !== me_).slice(0, 4)) if (!this.looks.has(l) && !this.others.has(l)) this.lkWant.add(l);
    if (newFloor) { this.want = null; this.left = null; }
    res.changed = true; res.newFloor = newFloor;
    return res;
  }

  /** Presence: a (full records), m (moves), g (gone), n (count). snap = entry (server re-sent everyone). */
  presence(d: MinePayload, now: number, snap = false): boolean {
    if (!d) return false;
    let ch = false;
    if (snap) { this.others.clear(); ch = true; }
    for (const a of d.a || []) {
      const l = String(a.l).toLowerCase(); if (l === this.login) continue;
      this.others.set(l, { login: l, v: { n: a.n, lv: a.lv, lk: a.lk, g: a.g, gh: a.gh }, x: a.x, y: a.y, tx: a.tx, ty: a.ty, t0: now, dt: a.dt || 0, dur: Math.hypot(a.tx - a.x, a.ty - a.y) / SPEED * 1000 });
      ch = true;
    }
    for (const [l0, x, y, tx, ty, dt] of d.m || []) {
      const l = String(l0).toLowerCase(); if (l === this.login) continue;
      const o = this.others.get(l);
      this.others.set(l, { login: l, v: o ? o.v : this.looks.get(l) || null, x, y, tx, ty, t0: now, dt: dt || 0, dur: Math.hypot(tx - x, ty - y) / SPEED * 1000 });
      if (!o && !this.looks.has(l)) this.lkWant.add(l);
      ch = true;
    }
    for (const l of d.g || []) { if (this.others.delete(String(l).toLowerCase())) ch = true; }
    if (d.n != null) this.nOthers = d.n;
    return ch;
  }
  hereOf(d: MinePayload): void { if (!d || d.here == null) return; this.here = +d.here || 0; this.hw = d.hw != null ? +d.hw || 0 : null; if (d.hm) this.hm = +d.hm || 0; }
  /** Drop walkers silent for longer than the server's idle (site GONE_MS = 165 s). */
  expire(now: number, goneMs = 165000): number { let n = 0; for (const [l, o] of this.others) if (o.t0 - o.dt < now - goneMs) { this.others.delete(l); n++; } return n; }

  /** Interpolated position of a walker (site posOf, straight line at SPEED). */
  posOf(o: Other, now: number, out: Pt = { x: 0, y: 0 }): Pt {
    const t = Math.min(1, (now - o.t0 + (o.dt || 0)) / Math.max(1, o.dur));
    out.x = o.x + (o.tx - o.x) * t; out.y = o.y + (o.ty - o.y) * t; return out;
  }
  /** Look record of a login: presence first, then looks fetched with &lk=. */
  lookOf(l: string): LookRec | null { const o = this.others.get(l); return (o && o.v) || this.looks.get(l) || null; }

  /** Diggers shown at stones: up to 4 per stone (site OFF offsets around the dig spot), excluding me. */
  diggers(): { login: string; i: number; x: number; y: number; k: number }[] {
    const out: { login: string; i: number; x: number; y: number; k: number }[] = [];
    if (!this.st) return out;
    const OFF = [[-24, 0], [24, 4], [-8, 22], [14, -16]];
    for (const [k, ls] of Object.entries(this.st.dg || {})) {
      const G = this.G, i = +k, sp = G.digSpot(this.dug, i); if (sp == null) continue;
      const c = G.centerOf(sp), r = G.cellXY(i), dx = r.x - c.x;
      ls.forEach((l, j) => { if (l === this.login || j > 3) return; const [ox, oy] = OFF[j % 4]; out.push({ login: l, i, x: c.x + ox + (dx ? Math.sign(dx) * 18 : 0), y: c.y + oy - 10, k: j }); });
    }
    return out;
  }
  /** Where a walker should be drawn (in a stone → snapped to the entrance like the site walkPt). */
  standPt(p: Pt): Pt { return this.G.walkPt(this.dug, p); }

  get dark(): boolean { return !!this.st && this.st.n >= (this.st.darkFrom || 5) && !this.lampOn(); }
  /** Own items (hero.items) are needed for the helmet; the client sets this hook. */
  heroItems: () => { id: string; on?: boolean; uid: string; qty?: boolean; q?: number; res?: string; name?: string }[] = () => [];
  lampOn(): boolean { const it = this.heroItems(); return it.some((x) => x.id === 'miner_helmet' && x.on) || !!(this.me && this.me.lamp && !it.some((x) => x.id === 'miner_helmet' && !x.on)); }
  lampHave() { return this.heroItems().find((x) => x.id === 'miner_helmet') || null; }
  fx(k: string): boolean { return !!(this.me && this.me.fx && this.me.fx[k]); }
  /** Feature flags (me.fx): m2 = mine 2.0, b = buyer window, pk = supplier (pickaxe). */
  get buyerOn(): boolean { return this.fx('b') && this.fx('m2'); }
  get pickOn(): boolean { return this.fx('pk') && this.buyerOn; }
  isFront(i: number): boolean { return !!this.st && (this.st.front || []).includes(i); }
  /** Stones left on the floor (not dug, not wall) — the way down opens at 0. */
  stonesLeft(): number { if (!this.F || this.F.v3) return 0; let n = 0; for (let i = 0; i < N_CELLS; i++) if (!this.dug[i] && this.F.cells[i] && this.F.cells[i].t !== 'wall') n++; return n; }
  /** «Шахта 3.0»: what the lift is doing (site draw3 chip over the cage). */
  liftChip(): string {
    const L = (this.st && this.st.lift) || { st: 'dig' };
    // site 30.10: the lift's stage is about the deepest floor — on an upper floor the chip only lists the floors
    if (this.st && this.st.n < (this.st.deep || this.st.n)) return `этажи 1–${this.st.deep}`;
    return L.st === 'fund' ? `сбор ${Math.floor(L.need ? Math.min(100, (L.c || 0) / L.need * 100) : 0)}%` : L.st === 'up' ? 'лифт улучшается' : 'ищем шахту лифта';
  }
  upText(): string {
    if (!this.st || !this.F) return '';
    if (this.F.v3) {
      const st = this.st, L = st.lift || { st: 'dig' }, deep = st.deep || st.n;
      return L.st === 'dig' ? `Этаж ${deep + 1}: сначала докопайтесь до шахты лифта на этаже ${deep} — она далеко от лифта, под туманом`
        : L.st === 'fund' ? `Лифт: сбор на этаж ${deep + 1} — ${this.liftChip()}` : `Лифт улучшается — скоро этаж ${deep + 1}`;
    }
    const n = this.st.n, left = this.stonesLeft();
    const from = n > 1 ? `Отсюда спустились с этажа ${n - 1}. ` : '';
    return left ? `${from}Спуск на этаж ${n + 1} откроется, когда выкопают все камни этажа (осталось ${left})` : `${from}Этаж расчищен — спуск на этаж ${n + 1} начнётся сам`;
  }
}

export { GH, N_CELLS };
