/**
 * Shop stock: types of `GET /api/city/stock`, which goods a building sells, and the site's purchase rules
 * (port of city.js stockOf / goodsOf / coinsFor / lockedHere / buyAsk, 23–25.10; since 31.10 they live in the site's
 * /site/cityshop.js, moved unchanged — site-contract «shop rules» watches them there). Pure module: no DOM, no three.
 *
 * Money: `coins` are bronze (1 silver = 100, 1 gold = 10 000). `price` is in channel points (on stream only).
 * A hero with `cs` buys for coins at any time (POST /api/cityBuy {item, price, town?}); without `cs` the goods are
 * «купить можно на стриме, за баллы канала». Enchant materials (star/sphere) are bought for coins through
 * POST /api/buymat {mat, ack?} when the hero has `ef`. Tent looks (booth samples) are points-only; owned ones are worn
 * with POST /api/wear {field, value}.
 */
import type { Hero, Item } from '../../contracts';

export interface StockItem {
  id: string; name: string; slot: string; rarity: string;
  /** Channel points (stream). */
  price?: number;
  /** Bronze coins (site, when hero.cs). Absent for materials (their price comes from /api/me .ench.coins). */
  coins?: number;
  rank?: string | null; rankMin?: number | null; rankId?: string | null;
  look?: Record<string, unknown> | null;
  stats?: Record<string, number> | null;
  effect?: Record<string, unknown> | null;
  drink?: boolean; role?: string | null; gear?: string | null; desc?: string;
  stand?: string; standName?: string; sale?: boolean; off?: string;
  mat?: 'star' | 'sphere' | string;
  [k: string]: unknown;
}
export interface StockStand { key: string; name?: string; top?: StockItem[]; mid?: StockItem[]; case?: StockItem[] }
export interface ShopStock {
  ok?: boolean; place?: string; title?: string; split?: boolean;
  stands?: StockStand[]; shelf1?: StockItem[]; shelf2?: StockItem[]; case?: StockItem[]; mats?: StockItem[];
  ptsOff?: string;
}
export interface BoothSample { id: string; name: string; look?: Record<string, unknown>; n: number; pos: string }
export interface Booth { key: string; title?: string; icon?: string; price?: number; samples?: BoothSample[] }
export interface TentStock { ok?: boolean; place?: string; amulets?: StockItem[]; booths?: Booth[]; ptsOff?: string }
export interface RowsStock { ok?: boolean; place?: string; potions?: StockItem[]; food?: StockItem[]; ptsOff?: string }
export interface CityStock {
  ok: boolean;
  forge?: ShopStock; forgeM?: ShopStock; magic?: ShopStock;
  tent?: TentStock; tentM?: TentStock; rows?: RowsStock;
  [k: string]: unknown;
}
export type ShopId = 'forge' | 'magic' | 'tent' | 'shop';

/* ------------------------------------------------------------------ loading (cached per city session) */

let CACHE: { at: number; st: CityStock } | null = null;
let INFLIGHT: Promise<CityStock | null> | null = null;
const TTL = 10 * 60 * 1000;

/** GET /api/city/stock once (cached 10 min, like the site's one-per-city-open STOCK). Null on failure. */
export function loadStock(get: <T = any>(path: string) => Promise<T>, force = false): Promise<CityStock | null> {
  if (!force && CACHE && Date.now() - CACHE.at < TTL) return Promise.resolve(CACHE.st);
  if (INFLIGHT) return INFLIGHT;
  INFLIGHT = get<CityStock>('/api/city/stock').then((r) => {
    INFLIGHT = null;
    if (r && r.ok) { CACHE = { at: Date.now(), st: r }; return r; }
    return CACHE ? CACHE.st : null;
  }, () => { INFLIGHT = null; return CACHE ? CACHE.st : null; });
  return INFLIGHT;
}
/** Seed / reset the cache (dev page, tests). */
export function setStockCache(st: CityStock | null): void { CACHE = st ? { at: Date.now(), st } : null; INFLIGHT = null; }

/* ------------------------------------------------------------------ hero flags */

/** Magic shop open for this hero (hero.ms = its name). */
export const msOn = (h: Hero | null | undefined) => !!(h && h.ms);
/** Coin purchases open (hero.cs). */
export const csOn = (h: Hero | null | undefined) => !!(h && h.cs);
/** Thief mark-up (hero.thK > 1). */
export const thK = (h: Hero | null | undefined) => (h && +(h as any).thK > 1 ? +(h as any).thK : 1);
export const thPrice = (h: Hero | null | undefined, base: number) => Math.round((+base || 0) * thK(h));

/** Which stock a building shows (with the magic shop open, the forge and tent drop its goods: forgeM / tentM). */
export function stockOf(st: CityStock | null | undefined, id: string, h: Hero | null | undefined): ShopStock | TentStock | RowsStock | null {
  if (!st) return null;
  if (id === 'magic') return st.magic || null;
  if (id === 'forge') return (msOn(h) && st.forgeM) || st.forge || null;
  if (id === 'tent') return (msOn(h) && st.tentM) || st.tent || null;
  if (id === 'shop' || id === 'rows') return st.rows || null;
  return null;
}

/** All goods of a building (flat). */
export function goodsOf(id: string, s: ShopStock | TentStock | RowsStock | null): StockItem[] {
  if (!s) return [];
  if (id === 'tent') return (s as TentStock).amulets || [];
  if (id === 'shop' || id === 'rows') return [...((s as RowsStock).potions || []), ...((s as RowsStock).food || [])];
  const x = s as ShopStock;
  if (x.stands && x.stands.length) return [...x.stands.flatMap((t) => [...(t.top || []), ...(t.mid || []), ...(t.case || [])]), ...(x.mats || [])];
  return [...(x.shelf1 || []), ...(x.shelf2 || []), ...(x.case || []), ...(x.mats || [])];
}

/** Stands of a forge-like shop: the site's `stands`, else one stand from the flat shelves. */
export function standsOf(s: ShopStock | null): StockStand[] {
  if (!s) return [];
  if (s.stands && s.stands.length) return s.stands;
  const top = [...(s.shelf1 || [])], mid = [...(s.shelf2 || [])], cs = [...(s.case || [])];
  return top.length || mid.length || cs.length ? [{ key: 'all', name: '', top, mid, case: cs }] : [];
}

/* ------------------------------------------------------------------ purchase rules */

export interface PriceEnv {
  hero: Hero | null;
  /** /api/me .ench (coins for materials). */
  ench?: { coins?: { star?: number; sphere?: number } } | null;
  /** Foreign district town: price multiplier (>1) and the best deals locked. 1 = own city. */
  foreignK?: number;
  /** District town id (sent as `town` with /api/cityBuy). */
  town?: string | null;
  /** Ids on the top row of any stand (locked in a foreign town). */
  topIds?: Set<string>;
}
export const ENCH_COINS_DEFAULT = { star: 300, sphere: 900 };
export const LOCK_T = 'Откроется после захвата';

export function topIdsOf(st: CityStock | null | undefined): Set<string> {
  const o = new Set<string>();
  if (st) for (const k of ['forge', 'forgeM', 'magic'] as const) for (const x of (st[k] && st[k]!.stands) || []) for (const it of x.top || []) o.add(it.id);
  return o;
}
const matCoins = (it: StockItem, env: PriceEnv) => {
  const c = (env.ench && env.ench.coins) || ENCH_COINS_DEFAULT;
  return it.mat ? +((c as any)[it.mat] ?? (ENCH_COINS_DEFAULT as any)[it.mat]) || 0 : 0;
};
export const lockedHere = (it: StockItem, env: PriceEnv) => (env.foreignK || 1) > 1 && !!it
  && (!!it.mat || it.rarity === 'epic' || it.rarity === 'legendary' || !!(env.topIds && env.topIds.has(it.id)));
/** Coin price for this hero (thief mark-up, foreign town ×k); 0 = not sold for coins. */
export function coinsFor(it: StockItem, env: PriceEnv): number {
  const h = env.hero;
  const b = it.mat ? (h && h.ef ? matCoins(it, env) : 0) : +(it.coins || 0) || 0;
  return b > 0 ? Math.round(thPrice(h, b) * (it.mat ? 1 : (env.foreignK || 1))) : 0;
}

export type OfferKind = 'coins' | 'mat' | 'points' | 'look' | 'locked' | 'wear';
export interface Offer {
  kind: OfferKind;
  /** Coin price (bronze) when kind is coins/mat. */
  coins: number;
  /** Channel points price (stream). */
  points: number;
  /** A purchase/wear request is possible in principle (button shown). */
  can: boolean;
  /** Why the button is disabled (no hero, ghost, not enough coins) — empty = enabled. */
  why: string;
  /** Not enough coins (the card shows «У тебя … · не хватает …»). */
  poor: boolean;
  /** Request to send on «Да». */
  req: { path: string; body: Record<string, unknown> } | null;
  /** Toast on success. */
  okText: string;
  /** Explanation for stream-only / locked goods. */
  note: string;
  /** Rank requirement note (points goods). */
  rank: string;
  /** Thief mark-up and foreign-town multiplier (for the notes). */
  thief: number; foreign: number;
}

const PLACE: Record<string, string> = { tent: 'Шатре', shop: 'Торговых рядах', rows: 'Торговых рядах', forge: 'Кузне' };
export const placeName = (b: string, h: Hero | null) => (b === 'magic' ? (msOn(h) ? String(h!.ms) : 'магической лавке') : PLACE[b] || 'Кузне');
const pts = (n: number) => (+n || 0).toLocaleString('ru-RU');

/** Everything the buy card needs for one good (mirror of the site's buyAsk + cardHtml price block). */
export function offerOf(it: StockItem, b: string, env: PriceEnv): Offer {
  const h = env.hero, name = it.name, k = thK(h), fk = env.foreignK || 1;
  const base: Offer = { kind: 'points', coins: 0, points: +(it.price || 0) || 0, can: false, why: '', poor: false, req: null, okText: '', note: '', rank: it.rank ? String(it.rank) : '', thief: k, foreign: fk };
  if (lockedHere(it, env)) {
    return { ...base, kind: 'locked', note: 'Этот округ не принадлежит каналу: лучшие вещи торговец бережёт для своих. Захватите округ на стриме — откроется всё и по обычной цене.' };
  }
  const c = coinsFor(it, env);
  const can = !!h && (it.mat ? !!(h.ef && c) : csOn(h) && c > 0);
  if (can) {
    const poor = !h!.ghost && (+h!.money || 0) < c;
    const why = h!.ghost ? 'Призраку не продают.' : poor ? 'Не хватает монет' : '';
    const req = it.mat
      ? { path: '/api/buymat', body: { mat: it.mat, ...(k > 1 ? { ack: 1 } : {}) } }
      : { path: '/api/cityBuy', body: { item: it.id, price: c, ...(env.town ? { town: env.town } : {}) } };
    return {
      ...base, kind: it.mat ? 'mat' : 'coins', coins: c, can: true, why, poor, req,
      okText: it.mat ? `Заказано: «${name}» — принесут через пару секунд` : `Куплено: «${name}» — сейчас будет в сумке`,
    };
  }
  const why = !h ? 'Героя пока нет — он появится, когда ты напишешь в чат на стриме.' : '';
  const note = it.price && !it.mat ? `В ${placeName(b, h)} на Ярмарке за ${pts(it.price)} баллов канала.`
    : it.mat ? 'На стриме — за баллы канала; за монеты — когда откроется заточка.' : 'На Ярмарке во время стрима.';
  return { ...base, why, note };
}

/** Tent booth sample: owned → wear it; else points on stream. */
export function sampleValue(b: Booth, s: BoothSample): string { return b.key === 'blush' ? String(!!(s.look && (s.look as any).blush)) : s.id; }
export function sampleOwned(h: Hero | null, b: Booth, s: BoothSample): boolean {
  const own = (h && h.wardrobe && (h.wardrobe.own as any) && (h.wardrobe.own as any)[b.key]) || [];
  const v = sampleValue(b, s).toLowerCase();
  return Array.isArray(own) && own.some((x: unknown) => String(x).toLowerCase() === v);
}
export function sampleWorn(h: Hero | null, b: Booth, s: BoothSample): boolean {
  const cur: any = (h && h.wardrobe && h.wardrobe.cur) || (h && h.look) || {};
  if (b.key === 'acc') return Array.isArray(cur.acc) && cur.acc.includes(s.id);
  if (b.key === 'blush') return String(!!cur.blush) === sampleValue(b, s);
  return String(cur[b.key] ?? '').toLowerCase() === String(s.id).toLowerCase();
}
export function sampleOffer(h: Hero | null, b: Booth, s: BoothSample): Offer {
  const base: Offer = { kind: 'look', coins: 0, points: +(b.price || 0) || 0, can: false, why: '', poor: false, req: null, okText: '', note: '', rank: '', thief: 1, foreign: 1 };
  if (h && sampleOwned(h, b, s)) {
    const worn = sampleWorn(h, b, s);
    return { ...base, kind: 'wear', can: !worn, why: worn ? 'Уже надето.' : h.busy ? 'Герой занят.' : '', req: { path: '/api/wear', body: { field: b.key, value: sampleValue(b, s) } }, okText: 'Надето' };
  }
  return { ...base, note: `Облик — только за баллы канала: на стриме, в Шатре, кабинка «${b.title || ''}», образец №${s.n} — ${pts(b.price || 0)} баллов.` };
}

/** Item shape the UI card builders expect (src/ui/card.ts cardHtml). */
export function tipItem(it: StockItem): Item {
  const WEARS = ['weapon', 'armor', 'shield', 'helmet', 'trinket'];
  return {
    ...(it as any), uid: '', id: it.id, name: it.name, slot: it.slot, rarity: (it.rarity || 'common') as Item['rarity'],
    stats: (it.stats || {}) as Record<string, number>, role: it.role || undefined, gear: it.gear || undefined,
    look: (it.look || null) as Item['look'], effect: it.effect || null, wearable: WEARS.includes(it.slot), on: false,
  };
}
