/**
 * shop3d rooms — walk inside a shop and pick goods from the shelves (owner's wish #10).
 *
 *   registerShopRooms(registries.rooms)       // registers room kind 'shop3d'
 *   BuildingDef { room: 'shop3d', scene?: 'forge' | 'magic' | 'shop' | 'tent' }   // scene defaults to the building id
 *
 * Scene variants live in SHOP_SCENES (add one = one builder function). Unknown ids get the generic market hall with
 * whatever goods the stock has for them (drift is reported by the registry, not here).
 */
import type { Unsub } from '../../contracts';
import type { Registry, RoomDef, RoomContext, RoomScene } from '../../contracts/ext';
import { RoomBase, envFromCtx, type RoomEnv } from '../common/base';
import { loadStock, stockOf, shopView, type CityStock, type ShopStock, type TentStock, type RowsStock } from '../common/stock';
import { buildForge } from './forge';
import { buildRows } from './rows';
import { buildTent } from './tent';

export type ShopSceneBuilder = (R: RoomBase, stock: CityStock | null, env: RoomEnv) => void | Promise<void>;

/** The stock a building shows: stockOf + the district town's level filter (cityshop.js shopView). */
const viewOf = (st: CityStock | null, id: string, env: RoomEnv) => shopView(stockOf(st, id, env.store.hero), id, env.store.hero, env.goodsKeep);
export const SHOP_SCENES: Record<string, ShopSceneBuilder> = {
  forge: (R, st, env) => buildForge(R, viewOf(st, 'forge', env) as ShopStock | null, 'forge'),
  magic: (R, st, env) => buildForge(R, viewOf(st, 'magic', env) as ShopStock | null, 'magic'),
  shop: (R, st, env) => buildRows(R, viewOf(st, 'shop', env) as RowsStock | null, env),
  rows: (R, st, env) => buildRows(R, viewOf(st, 'shop', env) as RowsStock | null, env),
  tent: (R, st, env) => buildTent(R, viewOf(st, 'tent', env) as TentStock | null),
};
export const SHOP_TITLES: Record<string, string> = { forge: 'Кузня', magic: 'Лавка звездочёта', shop: 'Лавка', rows: 'Торговые ряды', tent: 'Шатёр' };

let ENCH: { at: number; v: { coins?: { star?: number; sphere?: number } } | null } | null = null;
/** Material prices come with /api/me (.ench); fetched once per 10 min, only when the hero can buy materials. */
async function enchOf(env: RoomEnv): Promise<{ coins?: { star?: number; sphere?: number } } | null> {
  const h = env.store.hero;
  if (!h || !h.ef) return null;
  if (ENCH && Date.now() - ENCH.at < 600_000) return ENCH.v;
  try {
    const r = await Promise.race([env.actions.get<any>('/api/me'), new Promise((res) => setTimeout(() => res(null), 2500))]) as any;
    ENCH = { at: Date.now(), v: r && r.ench ? r.ench : null };
  } catch { ENCH = { at: Date.now(), v: null }; }
  return ENCH.v;
}

/** Build a shop room for a RoomEnv (used by the registered RoomDef and by dev/rooms.ts). */
export async function createShopRoom(env: RoomEnv, o: { stock?: CityStock | null } = {}): Promise<RoomScene> {
  const id = env.variant || env.building.id;
  const [stock, ench] = await Promise.all([o.stock !== undefined ? Promise.resolve(o.stock) : loadStock(env.actions.get), env.ench !== undefined ? Promise.resolve(env.ench) : enchOf(env)]);
  if (ench) env.ench = ench;
  const R = new RoomBase(env, 'shop:' + id);
  R.stock = stock;
  try {
    await (SHOP_SCENES[id] || SHOP_SCENES.rows)(R, stock, env);
    return R.finish();
  } catch (e) { R.dispose(); throw e; }
}

export const shop3dRoom: RoomDef = {
  title: 'Лавка',
  create: (ctx: RoomContext) => createShopRoom(envFromCtx(ctx)),
};

/** Register room kind 'shop3d' (variant by BuildingDef.scene or the building id). */
export function registerShopRooms(rooms: Registry<RoomDef>): Unsub {
  return rooms.register('shop3d', shop3dRoom);
}
