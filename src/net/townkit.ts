/**
 * «Town Kit» district towns (site 05.11) — pure helpers, no DOM, no three.js (test/townkit.test.ts).
 *
 * What the site has (city.js 05.11, tk-map.js / tk-art.js / tk-city.js):
 *  - town load (city.js townPrep): an entry of GET /api/city/towns with `nw`, /api/me `tn` (app.js tnOn), Pixi (useGL) and
 *    the kit scripts loaded (kitJs: /site/tk-map.js → tk-art.js → tk-city.js, versions LG_CITYV.km / ka / kc) → the page loads
 *    `/site/towns/<id>.js?v=<LG_CITYV.tk>`, which sets `window.LGTownKitTowns[id]` = the kit input T; TOWN.kit = T
 *    (TOWN.L = LGTownGen's town is still generated: inTown() stays true, buildSay / build timers work as in any town).
 *  - buildKit(): `LGTownKitCity.build(T, { guy, magic, levels, building, owner: meta.oc })` with townMeta(meta) levels /
 *    building; WD = { W, H, QW: 0, AREA, BUILDINGS, cats: true, kit: id }, `.cy[data-town="n-<id>"]`, data-bio = T.biome,
 *    an fx layer (snow / ember / firefly / sand / mote by biome), scale LGTownKitCity.SCALE / HS, speed SPEED (325),
 *    /api/city/enter { town: 'n-<id>' }, position key `lgCityPos:n-<id>`, LGCity.debug().town = 'n-<id>'. The server's
 *    `town_closed` (kitDrop) or a failed load go back to the old LGTownGen town (KIT_OFF) — the City DOM decides.
 *  - window.LGTownKitMap (UMD): layoutOf(T) (W/H = T.W/H or size × 1920×1080; tiers / rocks get faces from their rim),
 *    mapLevels(levels, building, now) (a running construction shows its target level), levelled(T, lv) (plotOf: a building
 *    below level 5 has a narrower / lower plot, SHARE / HSHARE; gate and mine FIXED), townAt(T, lv) (cached make(): 16 px
 *    walk grid, levels 0 blocked / base 1 / tier lv / 3 stairs, obstacles: building foot (or `ob` at level 5, `pass`
 *    gaps), houses, yards, items (itemOb), water, wall with the gate gap, tier faces / sides, rocks; bridges and the
 *    gate pass are `over` rects that stay walkable).
 *  - window.LGTownKitCity: buildings(levelled, building, now) (hit = [x0, x1, y0, y1] of vis, titles from LGCityMap, `build`
 *    { to, until } while a construction runs, lv), wrap(M, BLD, W, H) = the site map object, build(), spawn(T).
 *
 * townKitScene() restates a kit layout as the cats fair's scene (src/net/faircats.ts FairCatsScene: the 3D builder of the
 * new fair is the kit's builder — rims, plateau, stairs, streets, buildings vis / foot / door, items) plus `kit` with
 * the parts the fair has only one of (any number of tiers, rocks, water bodies, bridges) and the biome / levels / builds.
 */
import type { Building } from '../contracts';
import type { FairCatsScene, FcBuilding, FcHouse, FcItem, FcStair, FcStreet } from './faircats';

type P2 = [number, number];
type Q4 = [number, number, number, number];
/** The City DOM marks a kit town as `data-town="n-<id>"` (city.js buildKit). */
export const KIT_PREFIX = 'n-';
/** `n-<id>` → the district id, anything else → null. */
export const kitTownOf = (dom: string | null | undefined): string | null => (typeof dom === 'string' && dom.startsWith(KIT_PREFIX) && dom.length > 2 ? dom.slice(2) : null);

export interface KitTier { lv: number; poly: P2[]; rim: P2[]; face: number; sides: P2[][] }
export interface KitRock { poly: P2[]; rim: P2[]; face: number }
export interface KitWater { id: string; poly: P2[] }
export interface KitBridge { lv: number; rects: Q4[] }
export interface KitBuild { to: number; until: number }
export interface KitInfo {
  id: string; biome: string;
  tiers: KitTier[]; rocks: KitRock[]; water: KitWater[]; bridges: KitBridge[];
  /** Level per building id (levelled lvl, 1…5) and the running constructions (until > now). */
  lvl: Record<string, number>; build: Record<string, KitBuild>;
  /** The building's full-size (level 5) art box: the model height follows vis / vis5. */
  vis5: Record<string, Q4>;
  owner: string;
}

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() !== '' && Number.isFinite(+v) ? +v : NaN);
const pts = (a: unknown): P2[] => (Array.isArray(a) ? a.filter((p) => Array.isArray(p) && p.length >= 2).map((p) => [num(p[0]), num(p[1])] as P2).filter((p) => p.every(Number.isFinite)) : []);
const q4 = (a: unknown): Q4 => (Array.isArray(a) && a.length >= 4 ? [num(a[0]), num(a[1]), num(a[2]), num(a[3])] : [NaN, NaN, NaN, NaN]);
const ok4 = (a: readonly number[]) => a.length === 4 && a.every(Number.isFinite);
const list = (a: unknown): any[] => (Array.isArray(a) ? a.filter((x) => x && typeof x === 'object') : []);
const word = (v: unknown, d: string) => (typeof v === 'string' && /^[\w-]{1,24}$/.test(v) ? v : d);
const NANQ: Q4 = [NaN, NaN, NaN, NaN];

/**
 * A kit layout (LGTownKitMap.layoutOf(T) or the raw T — the fields used are the same) + its levelled buildings
 * (LGTownKitMap.levelled(T, lvMap)) → the scene the 3D builds, or null when the town polygon / buildings are missing.
 */
export function townKitScene(L: any, levelled: readonly any[], o: { building?: Record<string, any>; now?: number; rail?: number; owner?: string; screen?: [number, number] } = {}): FairCatsScene | null {
  try {
    if (!L || typeof L !== 'object') return null;
    const scr = o.screen ?? [1920, 1080], sz = Array.isArray(L.size) ? L.size : [2, 2];
    const W = num(L.W) || scr[0] * (num(sz[0]) || 2), H = num(L.H) || scr[1] * (num(sz[1]) || 2);
    const now = o.now ?? Date.now();
    const town = pts(L.town);
    const tiers: KitTier[] = list(L.tiers).map((t) => ({ lv: Math.max(0, Math.round(num(t.lv) || 2)), poly: pts(t.poly), rim: pts(t.rim), face: num(t.face) || 150, sides: list(t.sides).length ? (t.sides as unknown[]).map(pts).filter((p) => p.length >= 3) : [] })).filter((t) => t.poly.length >= 3);
    const rocks: KitRock[] = list(L.rocks).map((t) => ({ poly: pts(t.poly), rim: pts(t.rim), face: num(t.face) || 140 })).filter((t) => t.poly.length >= 3);
    const water: KitWater[] = list(L.water).map((w, i) => ({ id: word(w.id, 'w' + i), poly: pts(w.poly) })).filter((w) => w.poly.length >= 3);
    const bridges: KitBridge[] = list(L.bridges).map((b) => ({ lv: Math.round(num(b.lv) || 1), rects: (Array.isArray(b.rects) ? b.rects : []).map(q4).filter(ok4) })).filter((b) => b.rects.length);
    const buildings: FcBuilding[] = [], lvl: Record<string, number> = {}, vis5: Record<string, Q4> = {}, build: Record<string, KitBuild> = {};
    for (const b of levelled || []) {
      if (!b || typeof b.id !== 'string') continue;
      const vis = q4(b.vis), foot = q4(b.foot), door = { x: num(b.door?.x), y: num(b.door?.y) };
      if (!ok4(vis) || !ok4(foot) || !Number.isFinite(door.x) || !Number.isFinite(door.y)) continue;
      buildings.push({ id: b.id, title: String(b.title || b.id), sign: String(b.sign || ''), lv: num(b.lv) || 1, vis, foot, door, ...(b.pass ? { pass: q4(b.pass) } : {}) });
      lvl[b.id] = Math.max(1, Math.min(5, Math.round(num(b.lvl) || 5)));
      const v5 = q4(b.vis5); if (ok4(v5)) vis5[b.id] = v5;
      const bt = o.building?.[b.id];
      if (bt && num(bt.until) > now) build[b.id] = { to: num(bt.to) || 0, until: num(bt.until) };
    }
    if (town.length < 3 || !buildings.length) return null;
    const t0 = tiers[0], r0 = rocks[0], w0 = water[0];
    const stairs: FcStair[] = list(L.stairs).map((s, i) => ({ id: String(s.id ?? 's' + i), k: String(s.k || 'stair'), x0: num(s.x0), x1: num(s.x1), y0: num(s.y0), y1: num(s.y1) })).filter((s) => ok4([s.x0, s.x1, s.y0, s.y1]));
    const streets: FcStreet[] = list(L.streets).map((s, i) => ({ k: String(s.k || 'street'), id: String(s.id ?? 'st' + i), ...(s.poly ? { poly: pts(s.poly) } : {}), ...(s.rr ? { rr: [num(s.rr[0]), num(s.rr[1]), num(s.rr[2]), num(s.rr[3]), num(s.rr[4]) || 0] as [number, number, number, number, number] } : {}) }));
    const houses: FcHouse[] = list(L.houses).map((h, i) => ({ id: String(h.id ?? 'h' + i), k: String(h.k || 'house'), vis: q4(h.vis), foot: q4(h.foot), door: { x: num(h.door?.x), y: num(h.door?.y) }, roof: String(h.roof || 'red') })).filter((h) => ok4(h.foot));
    const items: FcItem[] = list(L.items).filter((it) => typeof it.k === 'string' && Number.isFinite(+it.x) && Number.isFinite(+it.y)).map((it) => JSON.parse(JSON.stringify(it)));
    const Wl = L.wall && typeof L.wall === 'object' ? L.wall : null;
    // the pier of the fair = the first bridge over water (the solids cut water there; the deck is drawn per bridge)
    const pierR = bridges[0]?.rects ?? [];
    const sc: FairCatsScene & { kit: KitInfo } = {
      W, H, face: t0?.face ?? 150, mface: r0?.face ?? 140, rail: o.rail ?? 18,
      rim: t0?.rim ?? [], mrim: r0?.rim ?? [], town, plateau: t0?.poly ?? [], sideW: t0?.sides[0] ?? [], mount: r0?.poly ?? [],
      stairs, streets, paths: list(L.paths).map((p, i) => ({ id: String(p.id ?? 'p' + i), w: num(p.w) || 80, pts: pts(p.pts) })).filter((p) => p.pts.length >= 2),
      rails: pts(L.rails), pond: w0?.poly ?? [],
      pier: pierR[0] ? { x0: pierR[0][0], y0: pierR[0][1], x1: pierR[0][2], y1: pierR[0][3], end: pierR[1] ?? NANQ } : { x0: NaN, x1: NaN, y0: NaN, y1: NaN, end: NANQ },
      buildings, houses, items,
      wall: Wl ? { y0: num(Wl.y0), y1: num(Wl.y1), x0: num(Wl.x0), x1: num(Wl.x1), gate: Array.isArray(Wl.gate) ? [num(Wl.gate[0]), num(Wl.gate[1])] : [NaN, NaN] } : { y0: NaN, y1: NaN, x0: NaN, x1: NaN, gate: [NaN, NaN] },
      jail: { c0: NaN, c1: NaN, ct: NaN, back: NaN, fy: NaN, seats: [], walk: NANQ },
      kit: { id: String(L.id || ''), biome: word(L.biome, 'meadow'), tiers, rocks, water, bridges, lvl, build, vis5, owner: String(o.owner || '').slice(0, 40) },
    };
    return sc;
  } catch { return null; }
}
export const kitOf = (sc: FairCatsScene | null | undefined): KitInfo | null => (sc as (FairCatsScene & { kit?: KitInfo }) | null | undefined)?.kit ?? null;

/** Tier height (m): the base level is the ground, every level above it one plateau step (FC_H). */
export const kitTierH = (lv: number, step: number): number => (lv >= 2 && lv !== 3 ? (lv - 1) * step : 0);

/**
 * A building under construction (tk-city.js `build` while until > now): closed like a «soon» one — city.js buildSay
 * answers with the timer instead of opening it — and drawn with scaffolding (its level: kit.lvl).
 */
export function kitBuildState(b: { id: string; build?: { until?: unknown } | null }, kit: KitInfo | null, now = Date.now()): { soon?: boolean; scaffold?: boolean } {
  const u = num(b.build?.until ?? kit?.build[b.id]?.until);
  return Number.isFinite(u) && u > now ? { soon: true, scaffold: true } : {};
}

/** The site's building list of a kit town (tk-city.js buildings + the magic filter of build) as Buildings. */
export function kitSiteBuildings(list0: readonly any[]): Building[] {
  const out: Building[] = [];
  for (const b of list0 || []) {
    if (!b || typeof b.id !== 'string' || !Array.isArray(b.hit) || !b.door) continue;
    out.push({ ...b, hit: [+b.hit[0], +b.hit[1], +b.hit[2], +b.hit[3]], door: { x: +b.door.x, y: +b.door.y } });
  }
  return out;
}
