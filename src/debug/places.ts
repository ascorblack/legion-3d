/**
 * Places the test dimension's portals open, all offline / demo and client-only:
 *  - the 3D shops (shop3d) with a small demo stock made from the item catalog (never GET /api/city/stock);
 *  - the hybrid interiors (3D room, the site's panel is NOT opened);
 *  - the mine (mine3d) with the offline FakeMine — only where a dev page supplied the recorded mine data;
 *  - towns as walkable 3D worlds: the camp «Перепутье» (the site's own campmap.js when the page has it, or the dev
 *    fixture), a district town (the site's towngen.js with a demo seed), the Fair (dev fixture).
 * Every room gets a RoomContext whose `actions` are a stub: buying, equipping, chat and any GET/POST answer «демо» and
 * never reach the site. Rooms exit back to the dimension.
 *
 * Dev pages hand recorded data in through window.__l3dDebugDemo (DemoData) — read only in dev builds.
 */
import * as THREE from 'three';
import type { Actions, ApiResult, Building, CityLayout, World3D } from '../contracts';
import type { RoomContext, RoomScene, World3DExt } from '../contracts/ext';
import type { CoreContext } from '../core/context';
import { CATALOG } from '../avatar';
import { ITEM_CHARMS, ITEM_FOODS, ITEM_HATS } from '../avatar/supported';
import type { CityStock, StockItem } from '../rooms/common/stock';
import { campScene, townMeta } from '../net/town';
import { fromX, fromZ, toX, toZ } from '../world/coords';

declare const __DEV__: boolean;

/** What a dev page may supply (dev/game.ts): recorded, sanitized fixtures. */
export interface DemoData {
  stock?: CityStock;
  campLayout?: () => CityLayout;
  fairLayout?: () => CityLayout;
  /** A demo mine: returns the room scene for a RoomContext (FakeMine-backed). */
  mine?: (ctx: RoomContext) => Promise<RoomScene>;
}
export function demoData(): DemoData | null {
  if (typeof __DEV__ === 'undefined' || !__DEV__) return null;
  return ((window as unknown as { __l3dDebugDemo?: DemoData }).__l3dDebugDemo) || null;
}

const DEMO = 'Тестовое измерение: действие не отправляется на сайт';

/** Actions that never reach the site. */
export function stubActions(toast: (t: string) => void, stock: () => CityStock): Actions {
  let said = 0;
  const no = async (): Promise<ApiResult> => { if (Date.now() - said > 3000) { said = Date.now(); toast(DEMO); } return { ok: false, error: DEMO }; };
  return {
    equip: no, unequip: no, use: no, wear: no, say: no,
    get: (async (p: string) => (p.startsWith('/api/city/stock') ? structuredClone(stock()) : { ok: false, error: DEMO })) as Actions['get'],
    post: (async () => no()) as Actions['post'],
    openBuilding: () => { void no(); },
    openSitePanel: () => { void no(); },
  };
}

/* ------------------------------------------------------------------ demo stock from the catalog */
const it = (id: string, name: string, slot: string, rarity: string, look: Record<string, unknown> | null, extra: Partial<StockItem> = {}): StockItem =>
  ({ id, name, slot, rarity, price: 500, coins: 40, look, stats: null, effect: null, desc: 'Демо-товар тестового измерения', sale: false, ...extra });
export function demoStock(): CityStock {
  const R = CATALOG.rarities;
  const weapons = CATALOG.weapons.map((w, i) => it('demo_w_' + w, 'Оружие: ' + w, 'weapon', R[i % R.length], { weapon: w }, { stats: { atk: 2 + i } }));
  const shields = CATALOG.shields.map((s, i) => it('demo_s_' + s, 'Щит: ' + s, 'shield', R[(i + 1) % R.length], { shield: s }, { stats: { def: 2 + i } }));
  const armors = CATALOG.armors.map((a, i) => it('demo_a_' + a, 'Доспех: ' + a, 'armor', R[(i + 2) % R.length], { armor: a }, { stats: { hp: 4 + i } }));
  const hats = ITEM_HATS.slice(0, 12).map((h, i) => it('demo_h_' + h, 'Шапка: ' + h, 'helmet', R[i % R.length], { hat: h }));
  const stand = (key: string, name: string, top: StockItem[], mid: StockItem[], cs: StockItem[]) => ({ key, name, top, mid, case: cs });
  const forge = { ok: true, place: 'forge', split: false, stands: [
    stand('legionary', 'Легионер', weapons.slice(0, 6), shields, armors.slice(0, 2)), stand('archer', 'Лучник', weapons.slice(6, 11), hats.slice(0, 4), armors.slice(2, 3)),
    stand('rogue', 'Разбойник', weapons.slice(11), hats.slice(4, 8), armors.slice(3))] };
  const magic = { ok: true, place: 'magic', title: 'Лавка звездочёта', split: true, stands: [stand('magic', 'Маг · Жрец', weapons.filter((w) => /staff|crook|censer|grimoire|skull/.test(String(w.look?.weapon))), hats.slice(8), armors.filter((a) => a.look?.armor === 'robe'))] };
  const amulets = ITEM_CHARMS.map((c, i) => it('demo_c_' + c, 'Амулет: ' + c, 'trinket', R[i % R.length], ['gold', 'sparks', 'halo', 'shadow', 'frost'].includes(c) ? { aura: c } : { charm: c }));
  const tent = { ok: true, place: 'tent', amulets, booths: [{ key: 'hat', title: 'Шапки', icon: '🎩', price: 3000, samples: ITEM_HATS.slice(0, 6).map((h, n) => ({ id: h, name: h, look: { hat: h }, n: n + 1, pos: 'hat:' + h })) }] };
  const potions = [it('potion_small', 'Малое молочко здоровья', 'potion', 'common', null, { effect: { heal: 10 } }), it('potion_hp', 'Большое молочко здоровья', 'potion', 'uncommon', null, { effect: { heal: 30 } })];
  const food = ITEM_FOODS.map((f, i) => it(f, 'Еда: ' + f, 'food', R[i % 3], null));
  return { ok: true, forge, forgeM: forge, magic, tent, tentM: tent, rows: { ok: true, place: 'rows', potions, food } } as unknown as CityStock;
}

/* ------------------------------------------------------------------ a city world as a room */
/** Wrap a built World3D (city px space) as a RoomScene (metres) for setSpace. */
export function worldRoom(w: World3D, L: CityLayout): RoomScene {
  const ext = w as World3D & Partial<World3DExt>;
  const sp = ((L as CityLayout & { spawn?: [number, number] }).spawn) || w.spawn;
  const [sx, sy] = L.nearest(sp[0], sp[1]);
  const colliders: THREE.Object3D[] = [];
  w.root.traverse((o) => { if (o.userData?.cameraCollider) colliders.push(o); });
  return {
    root: w.root,
    free: (x, z) => L.free(fromX(x), fromZ(z)),
    groundAt: (x, z) => w.groundAt(fromX(x), fromZ(z)),
    solidTop: ext.solidTop ? (x, z) => ext.solidTop!(fromX(x), fromZ(z)) : undefined,
    spawn: { x: toX(sx), z: toZ(sy), face: Math.PI },
    colliders,
    update: (dt, t, cam) => w.update(dt, t, cam),
    dispose: () => { w.root.removeFromParent(); w.dispose(); },
  };
}

/** The camp layout from the site's own campmap.js (pure computation, no request), like src/net/site.ts does. */
export function siteCampLayout(): CityLayout | null {
  try {
    const CM = (window as any).LGCampMap; if (!CM || typeof CM.get !== 'function' || typeof CM.map !== 'function') return null;
    const TL = CM.get(), map = CM.map(TL), camp = campScene(TL); if (!camp) return null;
    return { id: 'camp', styleId: 'cats', W: TL.W, H: TL.H, QW: 0, area: TL.AREA, obstacles: TL.OBST || [], buildings: (TL.BUILDINGS || []).map((b: Building) => ({ ...b, door: { ...b.door } })),
      free: (x: number, y: number) => map.free(x, y), nearest: (x: number, y: number) => map.nearest(x, y), path: (a: [number, number], b: [number, number]) => map.path(a, b),
      camp, spawn: camp.spawn } as unknown as CityLayout;
  } catch (e) { console.warn('[l3d] debug camp', e); return null; }
}
/** A district town from the site's towngen.js with a demo seed (deterministic, no request). */
export function siteDistrictLayout(): CityLayout | null {
  try {
    const TG = (window as any).LGTownGen; if (!TG || typeof TG.generate !== 'function') return null;
    const TL = TG.generate(townMeta({ id: 'demo', name: 'Демо-посад', seed: 1234, kind: 'town', lv: 3 })), map = TG.map(TL, { magic: false });
    return { id: 'demo-town', styleId: 'cats', W: TL.W, H: TL.H, QW: 0, area: TL.AREA, obstacles: map.OBST || TL.OBST || [], buildings: (TL.BUILDINGS || []).map((b: Building) => ({ ...b, door: { ...b.door }, soon: false })),
      free: (x: number, y: number) => map.free(x, y), nearest: (x: number, y: number) => map.nearest(x, y), path: (a: [number, number], b: [number, number]) => map.path(a, b),
      ...(Array.isArray(TL.spawn) ? { spawn: [+TL.spawn[0], +TL.spawn[1]] } : {}) } as unknown as CityLayout;
  } catch (e) { console.warn('[l3d] debug district', e); return null; }
}

/* ------------------------------------------------------------------ room contexts */
/** A RoomContext over the game context: own interactables / frame hooks (removed on exit), stub actions, no site panel. */
export function demoRoomCtx(ctx: CoreContext, b: Building, o: { exit(): void; actions: Actions; owned: (() => void)[]; frames: ((dt: number, t: number) => void)[] }): RoomContext {
  const interact = {
    add(i: Parameters<CoreContext['interact']['add']>[0]) { const u = ctx.interact.add(i); o.owned.push(u); return u; },
    get target() { return ctx.interact.target; },
  };
  const extra = {
    building: b, interact, actions: o.actions,
    onFrame(fn: (dt: number, t: number) => void) { o.frames.push(fn); const u = () => { const k = o.frames.indexOf(fn); if (k >= 0) o.frames.splice(k, 1); }; o.owned.push(u); return u; },
    exit: () => o.exit(),
    showSitePanel: () => ctx.ui.toast('В тестовом измерении окно сайта не открывается'),
    hideSitePanel: () => { /* never shown */ },
  };
  return Object.assign(Object.create(ctx) as RoomContext, extra) as RoomContext;
}

/** The building record for a portal: the layout's own, or a synthetic one (rooms only read id/title/door). */
export function buildingFor(ctx: CoreContext, id: string, title: string): Building {
  let b: Building | undefined;
  try { b = ctx.layout()?.buildings.find((x) => x.id === id); } catch { /* */ }
  return b ? { ...b, soon: false } : { id, title, hit: [0, 0, 0, 0], door: { x: 0, y: 0 } };
}
