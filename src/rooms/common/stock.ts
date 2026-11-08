/**
 * Shop stock: types of `GET /api/city/stock`, which goods a building sells, and the site's purchase rules
 * (port of city.js stockOf / goodsOf / coinsFor / lockedHere / buyAsk, 23–25.10; since 31.10 they live in the site's
 * /site/cityshop.js, moved unchanged — site-contract «shop rules» watches them there). Pure module: no DOM, no three.
 *
 * Money: `coins` are bronze (1 silver = 100, 1 gold = 10 000). `price` is the old channel-points price (08.11: no longer sold for points).
 * A hero with `cs` buys for coins at any time (POST /api/cityBuy {item, price, n?, town?}); without `cs` the goods are
 * «сейчас не купить · Покупки в «Городе» тебе пока закрыты» (08.11; before: «на стриме, за баллы канала»). Enchant
 * materials (star/sphere) are bought for coins through POST /api/buymat {mat, ack?} when the hero has `ef`. Tent looks
 * (booth samples) are bought for coins since 08.11 like any good (item id `look-<booth>-<sample id without #>`, price = the
 * booth's `price`, b-tent.js ask → buyAsk); owned ones are worn with POST /api/wear {field, value}.
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

/** A district town's goods filter (cityshop.js shopView with `TOWN.meta.lv3`: LGTownGen.goodsOk by the building's level). */
export type GoodsKeep = (it: StockItem, building: string) => boolean;
/**
 * cityshop.js shopView(id, st) for a hero with coin purchases (`cs`): in a lv3 district town a building sells only what its
 * level allows — stands, shelves, case, materials and amulets are filtered (materials always stay; potions / food are not
 * touched, like the site). No filter / no `cs` → the stock as it is.
 */
export function shopView<T extends ShopStock | TentStock | RowsStock | null>(st: T, id: string, h: Hero | null | undefined, keep?: GoodsKeep | null): T {
  if (!st || !keep || !csOn(h)) return st;
  const ok = (it: StockItem) => !it || !!it.mat || keep(it, id);
  const L2 = (a?: StockItem[]) => (a || []).filter(ok);
  const x = st as ShopStock & TentStock;
  return { ...st, stands: (x.stands || []).map((t) => ({ ...t, top: L2(t.top), mid: L2(t.mid), case: L2(t.case) })), shelf1: L2(x.shelf1), shelf2: L2(x.shelf2), case: L2(x.case), mats: L2(x.mats), amulets: L2(x.amulets) } as T;
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
  ench?: { coins?: { star?: number; sphere?: number }; out?: boolean } | null;
  /** District town price multiplier (city.js foreignK(): a foreign town, or the squad's own «край» before its boss). 1 = no mark-up. */
  foreignK?: number;
  /** The town is the squad's «край» (city.js TOWN.acc.home, homeHere()): dearer, but nothing is locked. */
  home?: boolean;
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
/** cityshop.js lockedHere (08.11: not in the squad's own «край», `!homeHere()`). */
export const lockedHere = (it: StockItem, env: PriceEnv) => (env.foreignK || 1) > 1 && !env.home && !!it
  && (!!it.mat || it.rarity === 'epic' || it.rarity === 'legendary' || !!(env.topIds && env.topIds.has(it.id)));
/** Coin price for this hero (thief mark-up, foreign town ×k); 0 = not sold for coins. */
export function coinsFor(it: StockItem, env: PriceEnv): number {
  const h = env.hero;
  const b = it.mat ? (h && h.ef ? matCoins(it, env) : 0) : +(it.coins || 0) || 0;
  return b > 0 ? Math.round(thPrice(h, b) * (it.mat ? 1 : (env.foreignK || 1))) : 0;
}

/** 08.11: «кабинка» samples of the tent are bought for coins like goods (b-tent.js ask → buyAsk). The good the site builds. */
export function lookItem(b: Booth, s: BoothSample): StockItem {
  return { id: 'look-' + b.key + '-' + String(s.id).replace(/^#/, ''), name: s.name, coins: +(b.price || 0) || 0, look: true, pos: s.pos } as unknown as StockItem;
}

/** 'closed': coin purchases are not open for this hero (no `cs`, a material without `ef`) — the site's «сейчас не купить». */
export type OfferKind = 'coins' | 'mat' | 'closed' | 'locked' | 'wear';
export interface Offer {
  kind: OfferKind;
  /** Coin price (bronze) when kind is coins/mat. */
  coins: number;
  /** The good's own coin price shown while purchases are closed (cityshop.js cardHtml / popHtml `+it.coins`); 0 = «Пока не продаётся». */
  list: number;
  /** A purchase/wear request is possible in principle (button shown). */
  can: boolean;
  /** Why the button is disabled (no hero, ghost, not enough coins) — empty = enabled. */
  why: string;
  /** Not enough coins (the card shows «У тебя … · не хватает …»). */
  poor: boolean;
  /** Request to send on «Да» (one piece; more with buyReq). */
  req: { path: string; body: Record<string, unknown> } | null;
  /** Toast on success. */
  okText: string;
  /** Explanation for closed / locked goods. */
  note: string;
  /** Rank requirement note. */
  rank: string;
  /** Thief mark-up and district-town multiplier (for the notes); `home` = the multiplier is the squad's «край». */
  thief: number; foreign: number; home: boolean;
  /** How many pieces the site lets you buy at once (cityshop.js qmax: hero.bq, shop / food / potion). 1 = no quantity. */
  qmax: number;
}

const PLACE: Record<string, string> = { tent: 'Шатре', shop: 'Торговых рядах', rows: 'Торговых рядах', forge: 'Кузне' };
export const placeName = (b: string, h: Hero | null) => (b === 'magic' ? (msOn(h) ? String(h!.ms) : 'магической лавке') : PLACE[b] || 'Кузне');

/** Everything the buy card needs for one good (mirror of the site's buyAsk + cardHtml / popHtml price block, 08.11). */
export function offerOf(it: StockItem, b: string, env: PriceEnv): Offer {
  const h = env.hero, name = it.name, k = thK(h), fk = env.foreignK || 1;
  const base: Offer = { kind: 'closed', coins: 0, list: +(it.coins || 0) > 0 ? +(it.coins || 0) : 0, can: false, why: '', poor: false, req: null, okText: '', note: '', rank: it.rank ? String(it.rank) : '', thief: k, foreign: fk, home: !!env.home, qmax: 1 };
  // site buyAsk / popHtml (re-checked 03.11): the foreign-town lock comes first, then «закончились»
  if (lockedHere(it, env)) {
    return { ...base, kind: 'locked', note: 'Этот округ не принадлежит каналу: лучшие вещи торговец бережёт для своих. Захватите округ на стриме — откроется всё и по обычной цене.' };
  }
  // site 02.11 (cityshop.js buyAsk): enchant materials can run out (item.out or /api/me .ench.out) — «закончились», no buy
  if (it.mat && ((it as any).out || (env.ench && env.ench.out))) {
    return { ...base, kind: 'mat', note: `«${name}» — закончились. Скоро завезут. Звёзды и сферы сейчас можно найти в походе, в шахте и в наградах.`, why: 'Закончились' };
  }
  const c = coinsFor(it, env);
  // 08.11: `can` no longer excludes looks (`it.look`) — the tent's samples are bought for coins too
  const can = !!h && (it.mat ? !!(h.ef && c) : csOn(h) && c > 0);
  if (can) {
    const poor = !h!.ghost && (+h!.money || 0) < c;
    const why = h!.ghost ? 'Призраку не продают.' : poor ? 'Не хватает монет' : '';
    const qmax = !it.mat && +(h as any).bq > 1 && c > 0 && (b === 'shop' || it.slot === 'food' || it.slot === 'potion')
      ? Math.max(1, Math.min(+(h as any).bq, Math.floor((+h!.money || 0) / c))) : 1;
    const req = it.mat
      ? { path: '/api/buymat', body: { mat: it.mat, ...(k > 1 ? { ack: 1 } : {}) } }
      : { path: '/api/cityBuy', body: { item: it.id, price: c, ...(env.town ? { town: env.town } : {}) } };
    return {
      ...base, kind: it.mat ? 'mat' : 'coins', coins: c, can: true, why, poor, req, qmax,
      okText: it.mat ? `Заказано: «${name}» — принесут через пару секунд` : `Куплено: «${name}» — сейчас будет в сумке`,
    };
  }
  const why = !h ? 'Героя пока нет — он появится, когда ты напишешь в чат на стриме.' : '';
  // 08.11 (cityshop.js buyAsk): no more «на стриме, за баллы канала» — «сейчас не купить»
  const note = it.mat ? 'За монеты - когда откроется заточка.' : 'Покупки в «Городе» тебе пока закрыты.';
  return { ...base, why, note };
}

/**
 * The request for `qn` pieces (cityshop.js buyAsk «Да»: `{ item, price, n?, town? }` — `price` is one piece, `n` only above 1)
 * and its toast. Null when the offer has no request.
 */
export function buyReq(of: Offer, qn = 1, name = ''): { path: string; body: Record<string, unknown>; okText: string } | null {
  if (!of.req) return null;
  const n = Math.max(1, Math.min(of.qmax || 1, Math.round(+qn || 1)));
  if (of.req.path !== '/api/cityBuy' || n <= 1) return { ...of.req, okText: of.okText };
  const { item, price, town } = of.req.body as { item: unknown; price: unknown; town?: unknown };
  return { path: of.req.path, body: { item, price, n, ...(town !== undefined ? { town } : {}) }, okText: `Куплено: «${name}» ×${n} — сейчас будет в сумке` };
}

/** Tent booth sample: owned → wear it; else bought for coins (08.11, b-tent.js ask → buyAsk with lookItem). */
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
export function sampleOffer(h: Hero | null, b: Booth, s: BoothSample, env?: PriceEnv): Offer {
  if (h && sampleOwned(h, b, s)) {
    const worn = sampleWorn(h, b, s);
    const base: Offer = { kind: 'wear', coins: 0, list: 0, can: !worn, why: worn ? 'Уже надето.' : h.busy ? 'Герой занят.' : '', poor: false, req: { path: '/api/wear', body: { field: b.key, value: sampleValue(b, s) } }, okText: 'Надето', note: '', rank: '', thief: 1, foreign: 1, home: false, qmax: 1 };
    return base;
  }
  return offerOf(lookItem(b, s), 'tent', env ? { ...env, hero: h } : { hero: h });
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
