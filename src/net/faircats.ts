/**
 * The new cats fair («новая Ярмарка», site 04.11) — pure helpers, no DOM, no three.js (test/faircats.test.ts).
 *
 * What the site has (city.js 04.11):
 *  - `fcWant() = !FC_OFF && X.fcOn() && TOWN.id === 'fair' && !TOWN.L`, app.js `fcOn = !!ME.fc` (/api/me top level). With
 *    Pixi (useGL) city.js loads /site/fc-map.js → fc-art.js → fc-city.js and buildCats() replaces the fair:
 *    WD = { W, H, QW: 0, AREA, BUILDINGS, cats: true, LOW: { jail } }, `.cy[data-town="fairc"]`, top 0, camX 0,
 *    /api/city/enter { town: 'fairc' }, position key `lgCityPos:fairc`. A failed load, the SVG renderer or the server's
 *    `town_closed` drop back to the old fair (FC_OFF / no Pixi) — so the City DOM is the authority (src/net/town.ts).
 *  - window.LGFairCats (fc-map.js, UMD): W 5760 × H 3240, the town polygon (level 1), the plateau above the rim polyline
 *    (level 2) with its cliff faces (FACE px under the rim), the mountain with the mine (MRIM, MFACE), three stairs / ramp
 *    (level 3, both levels meet there), streets / plaza / lanes, the pond with a pier, 13 buildings (vis, foot, door; the
 *    gate has a pass), 6 houses, ~220 decor items, the city wall with the gate, the jail cage; make({ jail }) = the walk
 *    grid (16 px cells, levels) with free / nearest / path / clear / levelAt.
 *  - window.LGFairCatsCity (fc-city.js): map({ jail, magic }) = the site map object (BUILDINGS with hit / door and the
 *    old fair's titles from LGCityMap), build() = map + art layers, JAIL, jailWalk, spawn().
 */
import type { Building, CityLayout, JailGeo, Obstacle } from '../contracts';

export const FAIRC = 'fairc';
type P2 = [number, number];
export interface FcBuilding { id: string; title: string; sign: string; lv: number; vis: [number, number, number, number]; foot: [number, number, number, number]; door: { x: number; y: number }; pass?: [number, number, number, number] }
export interface FcHouse { id: string; k: string; vis: [number, number, number, number]; foot: [number, number, number, number]; door: { x: number; y: number }; roof: string }
export interface FcItem { k: string; x: number; y: number; s?: number; [key: string]: unknown }
export interface FcStreet { k: string; id: string; poly?: P2[]; rr?: [number, number, number, number, number] }
export interface FcStair { id: string; k: string; x0: number; x1: number; y0: number; y1: number }
export interface FcJail { c0: number; c1: number; ct: number; back: number; fy: number; seats: P2[]; walk: [number, number, number, number] }
/** Plain copy of the LGFairCats geometry the 3D world is built from (src/world/faircats.ts). */
export interface FairCatsScene {
  W: number; H: number;
  /** Cliff face height under the rim / under the mountain rim (px in the 2D art). */
  face: number; mface: number; rail: number;
  rim: P2[]; mrim: P2[]; town: P2[]; plateau: P2[]; sideW: P2[]; mount: P2[];
  stairs: FcStair[]; streets: FcStreet[]; paths: { id: string; w: number; pts: P2[] }[]; rails: P2[];
  pond: P2[]; pier: { x0: number; x1: number; y0: number; y1: number; end: [number, number, number, number] };
  buildings: FcBuilding[]; houses: FcHouse[]; items: FcItem[];
  wall: { y0: number; y1: number; x0: number; x1: number; gate: [number, number] };
  jail: FcJail;
}

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : NaN);
const pts = (a: unknown): P2[] => (Array.isArray(a) ? a.filter((p) => Array.isArray(p) && p.length >= 2).map((p) => [num(p[0]), num(p[1])] as P2).filter((p) => p.every(Number.isFinite)) : []);
const q4 = (a: unknown): [number, number, number, number] => (Array.isArray(a) && a.length >= 4 ? [num(a[0]), num(a[1]), num(a[2]), num(a[3])] : [NaN, NaN, NaN, NaN]);
const ok4 = (a: number[]) => a.every(Number.isFinite);

/** LGFairCats (or the fixture JSON with the same keys) → plain scene, or null when a needed part is missing. */
export function fairCatsScene(F: any): FairCatsScene | null {
  try {
    if (!F || !Array.isArray(F.RIM) || !Array.isArray(F.TOWN) || !Array.isArray(F.BUILDINGS)) return null;
    const buildings: FcBuilding[] = [];
    for (const b of F.BUILDINGS) {
      if (!b || typeof b.id !== 'string') continue;
      const vis = q4(b.vis), foot = q4(b.foot), door = { x: num(b.door?.x), y: num(b.door?.y) };
      if (!ok4(vis) || !ok4(foot) || !Number.isFinite(door.x) || !Number.isFinite(door.y)) continue;
      buildings.push({ id: b.id, title: String(b.title || b.id), sign: String(b.sign || b.title || ''), lv: +b.lv || 1, vis, foot, door, ...(b.pass ? { pass: q4(b.pass) } : {}) });
    }
    const J = F.JAIL || {};
    const sc: FairCatsScene = {
      W: +F.W || 5760, H: +F.H || 3240, face: +F.FACE || 160, mface: +F.MFACE || 140, rail: +F.RAIL || 18,
      rim: pts(F.RIM), mrim: pts(F.MRIM), town: pts(F.TOWN), plateau: pts(F.PLATEAU), sideW: pts(F.SIDE_W), mount: pts(F.MOUNT),
      stairs: (F.STAIRS || []).map((s: any) => ({ id: String(s.id), k: String(s.k), x0: num(s.x0), x1: num(s.x1), y0: num(s.y0), y1: num(s.y1) })).filter((s: FcStair) => ok4([s.x0, s.x1, s.y0, s.y1])),
      streets: (F.STREETS || []).map((s: any) => ({ k: String(s.k), id: String(s.id), ...(s.poly ? { poly: pts(s.poly) } : {}), ...(s.rr ? { rr: [num(s.rr[0]), num(s.rr[1]), num(s.rr[2]), num(s.rr[3]), num(s.rr[4])] } : {}) })),
      paths: (F.PATHS || []).map((p: any) => ({ id: String(p.id), w: +p.w || 80, pts: pts(p.pts) })),
      rails: pts(F.RAILS), pond: pts(F.POND),
      pier: { x0: num(F.PIER?.x0), x1: num(F.PIER?.x1), y0: num(F.PIER?.y0), y1: num(F.PIER?.y1), end: q4(F.PIER?.end) },
      buildings,
      houses: (F.HOUSES || []).map((h: any) => ({ id: String(h.id), k: String(h.k), vis: q4(h.vis), foot: q4(h.foot), door: { x: num(h.door?.x), y: num(h.door?.y) }, roof: String(h.roof || 'red') })).filter((h: FcHouse) => ok4(h.foot)),
      items: (F.ITEMS || []).filter((it: any) => it && typeof it.k === 'string' && Number.isFinite(+it.x) && Number.isFinite(+it.y)).map((it: any) => ({ ...JSON.parse(JSON.stringify(it)) })),
      wall: { y0: num(F.WALL?.y0), y1: num(F.WALL?.y1), x0: num(F.WALL?.x0), x1: num(F.WALL?.x1), gate: [num(F.WALL?.gate?.[0]), num(F.WALL?.gate?.[1])] },
      jail: { c0: num(J.c0), c1: num(J.c1), ct: num(J.ct), back: num(J.back), fy: num(J.fy), seats: pts(J.seats), walk: q4(J.walk) },
    };
    if (sc.rim.length < 2 || sc.town.length < 3 || !sc.buildings.length) return null;
    return sc;
  } catch { return null; }
}

/** fc-map.js rimY: the rim polyline's y at x (clamped at the ends). */
export function rimY(p: readonly P2[], x: number): number {
  for (let i = 1; i < p.length; i++) {
    const a = p[i - 1], b = p[i];
    if (x <= b[0]) { const t = b[0] === a[0] ? 0 : (x - a[0]) / (b[0] - a[0]); return a[1] + (b[1] - a[1]) * Math.max(0, Math.min(1, t)); }
  }
  return p[p.length - 1][1];
}
/** Even-odd point in polygon (fc-map.js inPoly). */
export function inPoly(P: readonly P2[], x: number, y: number): boolean {
  let c = false;
  for (let i = 0, j = P.length - 1; i < P.length; j = i++) {
    const a = P[i], b = P[j];
    if ((a[1] > y) !== (b[1] > y) && x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]) c = !c;
  }
  return c;
}

/**
 * The jail as JailGeo (src/world/jail.ts, src/features/jail.ts): the house is the jail building's foot, the cage
 * c0…c1 from `back` to the bars `fy` (fc-map.js JAIL), its door in the middle of the front grille, the site's seats and walk.
 */
export function fairCatsJailGeo(sc: FairCatsScene): JailGeo | null {
  const J = sc.jail, b = sc.buildings.find((x) => x.id === 'jail');
  if (!b || !ok4([J.c0, J.c1, J.fy, J.back])) return null;
  const mid = (J.c0 + J.c1) / 2;
  return {
    x0: b.foot[0], x1: b.foot[2], base: b.foot[3], top: b.vis[1],
    c0: J.c0, c1: J.c1, ct: J.ct, back: J.back, fy: J.fy,
    door: [mid - 34, mid + 34], seats: J.seats.map((s) => [s[0], s[1]] as P2),
    ...(ok4(J.walk) ? { walk: [...J.walk] as [number, number, number, number] } : {}),
  };
}

/** Building meta of the old fair (LGCityMap.BUILDINGS: title, sub, icon, soon, magic, mine) — fc-city.js meta(). */
export type FcMeta = (id: string) => { title?: string; sub?: string; icon?: string; soon?: boolean; magic?: boolean; mine?: boolean } | null | undefined;

/**
 * fc-city.js buildings(): the site's building list of the new fair (hit = [x0, x1, y0, y1] from vis, door, the old
 * fair's titles) — the jail only when open, the magic shop only with the hero's shop open (map({ magic })).
 */
export function fairCatsBuildings(sc: FairCatsScene, meta: FcMeta, o: { jail?: boolean; magic?: boolean }): Building[] {
  const out: Building[] = [];
  for (const b of sc.buildings) {
    if (b.id === 'jail' && !o.jail) continue;
    const m = meta(b.id) || {};
    if (m.magic && !o.magic) continue;
    const [x0, y0, x1, y1] = b.vis;
    out.push({
      id: b.id, title: m.title || b.title, sub: m.sub || '', icon: m.icon || '🏠', hit: [x0, x1, y0, y1], door: { x: b.door.x, y: b.door.y },
      ...(m.soon ? { soon: true } : {}), ...(m.magic ? { magic: true } : {}), ...(m.mine ? { mine: true } : {}), ...(b.id === 'jail' ? { jail: true } : {}),
    });
  }
  return out;
}

/** The new fair's layout (CityLayout + the scene): `id` 'fairc', area = the whole map, the walk grid of the site's map. */
export type FairCatsLayout = CityLayout & {
  faircats: FairCatsScene;
  spawn: [number, number];
  /** fc-map.js levelAt (lvFree): 0 blocked, 1 town, 2 plateau, 3 stairs. */
  level?: (x: number, y: number) => number;
  /** fc-map.js clear(a, b): a straight walk that never changes level except over stairs. */
  clear?: (a: P2, b: P2) => boolean;
  /** The site's own obstacle list (fc-map.js OB: r / e / p shapes with tags) — the 3D solids (walk grid parity). */
  siteObst?: any[];
  /** The 3D sign text per building id (the site's art: «РЫБНЫЕ РЯДЫ», «КОГТЕКУЗНЯ», «МУРЧАРОДЕЙНЯ»…). */
  signs: Record<string, string>;
};
export const fairCatsOf = (L: CityLayout | null | undefined): FairCatsScene | null => (L as FairCatsLayout | null | undefined)?.faircats ?? null;
/** Fair semantics (home prices, the home mine, the jail, «Ярмарка»): the old fair and the new one. */
export const isFairId = (id: string | null | undefined): boolean => id === 'fair' || id === FAIRC;

/** Bounding box of the town polygon, the plateau and the wall (px). */
export function townBox(sc: FairCatsScene): { x0: number; x1: number; y0: number; y1: number } {
  const pts = [...sc.town, ...sc.plateau.filter((p) => p[1] > 0)];
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  return { x0: Math.max(0, Math.min(...xs) - 40), x1: Math.min(sc.W, Math.max(...xs) + 40), y0: Math.max(0, Math.min(...ys) - 40), y1: Math.min(sc.H, Math.max(Math.max(...ys), Number.isFinite(sc.wall.y1) ? sc.wall.y1 : 0) + 20) };
}
/** The site map object (LGFairCatsCity.map(o) or a fixture with the same members) → the layout. */
export interface FcSiteMap {
  W: number; H: number; OBST?: any[]; BUILDINGS: any[];
  free(x: number, y: number): boolean; nearest(x: number, y: number): P2; path?(a: P2, b: P2): P2[];
  clear?(a: P2, b: P2): boolean; levelAt?(x: number, y: number): number;
}
export function fairCatsLayout(sc: FairCatsScene, map: FcSiteMap, buildings: Building[], o: { styleId: string; spawn?: P2; jail?: boolean }): FairCatsLayout {
  const g = sc.buildings.find((b) => b.id === 'gate');
  const spawn: P2 = o.spawn ?? (g ? [g.door.x, g.door.y - 170] : [sc.W / 2, sc.H * 0.8]);
  const J = o.jail ? fairCatsJailGeo(sc) : null;
  if (J) for (const b of buildings) if (b.id === 'jail') b.jailGeo = J;   // no lower street here: the jail carries its numbers
  const signs: Record<string, string> = {};
  for (const b of sc.buildings) if (b.sign) signs[b.id] = b.sign;
  // obstacles for the generic consumers (minimap, solid.ts water): boxes and ellipses of the site's list
  const obstacles: Obstacle[] = [];
  for (const ob of map.OBST || []) {
    if (ob && Array.isArray(ob.r)) obstacles.push({ b: [ob.r[0], ob.r[1], ob.r[2], ob.r[3]] });
    else if (ob && Array.isArray(ob.e)) obstacles.push({ e: [ob.e[0], ob.e[1], ob.e[2], ob.e[3]] });
  }
  return {
    // area: the town's box (the minimap, solidTop's outside, the default spawn); the site's map is 5760 × 3240
    id: FAIRC, styleId: o.styleId, W: sc.W, H: sc.H, QW: 0, area: townBox(sc),
    obstacles, buildings,
    free: (x, y) => map.free(x, y), nearest: (x, y) => map.nearest(x, y),
    ...(map.path ? { path: (a: P2, b: P2) => map.path!(a, b) } : {}),
    ...(map.clear ? { clear: (a: P2, b: P2) => map.clear!(a, b) } : {}),
    ...(map.levelAt ? { level: (x: number, y: number) => map.levelAt!(x, y) } : {}),
    faircats: sc, spawn, signs, siteObst: (map.OBST || []).map((ob: any) => ({ ...(ob.r ? { r: [...ob.r] } : {}), ...(ob.e ? { e: [...ob.e] } : {}), ...(ob.p ? { p: ob.p.map((q: number[]) => [q[0], q[1]]) } : {}), tag: String(ob.tag || '') })),
  };
}
