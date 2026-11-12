/**
 * The new cats fair («новая Ярмарка», site 04.11, hero flag me.fc): real 3D from the geometry the site walks on
 * (src/net/faircats.ts scene from window.LGFairCats / fc-map.js; ground heights in fcground.ts).
 *   - terrain: meadow ground with the pond cut out (water + a soil bank + the pier), the plateau above the rim polyline
 *     (FC_H) with its rock bank down to rim + FACE, the plateau's west cliff, the mountain (FC_MH above the plateau) with
 *     its rock face along MRIM and boulders on top, two flights of stone stairs and the plank cart ramp (+ rails), cobbled
 *     streets / squares, the flagstone plaza, the lanes (on either level, following the ground), the city wall along the
 *     bottom with towers and the gate gap, a pine belt round the town;
 *   - buildings: every site building by id with the established street models (buildings.ts BUILDING_MODELS), built as
 *     their back-row twin and carried onto their foot band (village.ts buildAtDepth: front edge on the foot's front, body
 *     fitted into the foot's depth, lifted onto the plateau for level-2 ones); the gate faces the town (turned half round);
 *     the lower-street models (storage barn, mine portal, jail with its cage) stand on their own hit / LOW numbers with
 *     the base on their level. Doors keep the site's ids, so E, rooms, shops and the hall work as at the old fair;
 *   - the six houses (tavern + cottages) with the site's roof colours, not enterable;
 *   - decor items by kind on the site's own positions (colours / proportions only: trees, blossoms, pines, bushes,
 *     lamps, the well, benches, carts, flower beds, crates, barrels, fences, laundry lines, dummies, targets, the sand pit,
 *     coal, woodpiles, the grindstone, hay, sacks, gardens, mailboxes, tavern tables, reeds, picnic, telescope, rocks,
 *     ore wagons and the ore pile, picks, signposts);
 *   - solids = the site's own obstacle list (walk grid parity: test/faircats.test.ts) — rects as they are, ellipses as
 *     their inscribed box, polygons (pond, cliff faces, the mountain) rasterised in 0.2 m rows; finite tops where you can
 *     stand on a thing (benches, crates, barrels, beds, hay…), Infinity elsewhere. Repeated props use alias kinds
 *     (village.ts VK, no PROP_SOLID of their own).
 */
import * as THREE from 'three';
import type { Building, CityLayout } from '../contracts';
import type { FairCatsScene, FairCatsLayout, FcItem, FcStair } from '../net/faircats';
import { fairCatsOf, inPoly, rimY, inGlade, type FcGlade } from '../net/faircats';
import { kitOf } from '../net/townkit';
import { toX, toZ, SX, SZ, fromX, fromZ } from './coords';
import { GEO, M } from './batch';
import { type Ctx, box, rbox, cyl, ball, cone, shade } from './kit';
import { buildBuilding, house, signF, BUILDING_XF } from './buildings';
import { buildAtDepth, VK } from './village';
import { FC_H, FC_MH, FC_PIER, FC_POND, plateauX0 } from './fcground';
import { JAIL_GEO } from './jail';
import { jailGeoOf } from '../net/jail';
import type { Placed } from './place';
import { part } from './instancer';
import { LAMP_HEAD_Y, lanternHead } from './protoProps';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Batch } from './batch';
import { Instancer } from './instancer';
import { fcModel, type FcModel, type FcPlace } from './fcart/index';
import * as FC_CIVIC from './fcart/civic';
import * as FC_HOUSES from './fcart/houses';
import { noteFcModel, clearFcModels, scheduleFcArtCheck } from './fcart/live';
import FCART_FP from '../data/fcart-fp.json';

export { fairCatsOf };
type P2 = [number, number];
const LOW_IDS = new Set(['storage', 'mine', 'mineboard', 'jail']);
/** Model heights (px of the 2D art above the base) of the old fair — the street models are tuned to them. */
const OLD_H: Record<string, number> = { hall: 500, auction: 420, trainer: 440, board: 330, anvil: 200, forge: 570, gate: 560, tent: 580, shop: 500, magic: 650 };
/** The site's map palette (fc-art.js / tk-art.js P): meadow, forest floor, paving, plaza, rock, wall, the wall towers' plum. */
export const FC_GRASS = ['#83ad5c', '#6c9a4c', '#9cc56e'] as const;
/** The DAY key of the day / night cycle (src/world/daynight.ts, wired in src/world/index.ts) for every outdoor town: the
 *  site's map is a bright, saturated daytime picture — blue sky to a pale horizon, warm sun, bright sky light. Tuned
 *  against the site's look of the cats fair; the night key is each place's own old night. */
export const FC_MOOD = {
  sky: 'linear-gradient(#3f78d0 0%, #6aa2ea 45%, #a8d0f4 80%, #dcecf4 100%)',
  hemi: ['#f0f4ff', '#9a8a5a'] as [string, string], hemiI: 2.1, ambient: '#b8b0d0', ambI: 0.75, sun: '#fff0d0', sunI: 2.8,
};
/** The meadow / plateau grass a little over white (vertex colours are floats): the site's bright lawn under the night light. */
const MEADOW = new THREE.Color(1.22, 1.32, 1.02), PLAT = new THREE.Color(1.15, 1.28, 1.0);
const FCP = { forestFloor: '#4f7a4a', plat: '#f0ffe0', pave: '#ffe2c0', plaza: '#efd2a4', plaza2: '#e6c08f', mortar: '#a87650',
  terra: '#d27b5a', terraD: '#a4553c', terraL: '#e89a78', rock: '#b39a8c', rockD: '#8f766b', rockL: '#cdb7a8', mrock: '#a08c88', mrockD: '#7d6a68',
  plum: '#7a4a78', plumD: '#5a3458', pink: '#ff8fa3', gold: '#ffcf4a' };
const ROOF: Record<string, string> = { plum: '#8a4a7e', teal: '#2f8a8a', red: '#b8403a', blue: '#3e5aa8', mustard: '#c8962e', pink: '#d0708e' };

/** Extra instanced kinds of the new fair: a conifer and a blossom tree (2 + 2 draw calls). */
export function registerFairCatsKinds(k: Ctx): void {
  const P = k.pal, cone8 = new THREE.ConeGeometry(0.5, 1, 7), cyl6 = new THREE.CylinderGeometry(0.5, 0.5, 1, 6), ico = new THREE.IcosahedronGeometry(0.5, 1);
  const mg = (gs: THREE.BufferGeometry[]) => { const m = mergeGeometries(gs, false)!; gs.forEach((g) => g.dispose()); return m; };
  const dark = new THREE.Color(P.leafD).multiplyScalar(0.8).getStyle();
  k.inst.registerKind('fc:pine', [
    { mat: 'wood', geo: mg([part(cyl6, P.woodD, 0, 0.35, 0, 0.18, 0.7, 0.18)]) },
    { mat: 'leaf', castShadow: true, geo: mg([part(cone8, dark, 0, 1.15, 0, 1.5, 1.3, 1.5), part(cone8, P.leafD, 0, 1.85, 0, 1.15, 1.15, 1.15, 0, 0.5, 0), part(cone8, P.leaf, 0, 2.5, 0, 0.75, 1.0, 0.75, 0, 1.1, 0)]) },
  ]);
  k.inst.registerKind('fc:blossom', [
    { mat: 'wood', geo: mg([part(cyl6, P.woodD, 0, 0.6, 0, 0.16, 1.2, 0.16), part(cyl6, P.woodD, 0.18, 1.25, 0, 0.07, 0.6, 0.07, 0, 0, -0.6)]) },
    { mat: 'leaf', castShadow: true, geo: mg([part(ico, '#e88aaa', 0, 1.75, 0, 1.3, 1.0, 1.25), part(ico, '#f4b0c8', 0.3, 2.05, 0.1, 0.8, 0.7, 0.8, 0.3, 0.2, 0), part(ico, '#c86a90', -0.35, 1.6, -0.1, 0.8, 0.6, 0.8)]) },
  ]);
  // a light street lamp (≈ 90 tris; the town has 41 of them): stepped foot, post, lantern with a lit core, cap
  const LH = LAMP_HEAD_Y;
  // the framed lantern (protoProps lanternHead: every part touches; a bare emissive box read as a cream slab, bug 06.11 #1)
  const [lf, lc] = lanternHead(P.metal); lf.translate(0, LH, 0); lc.translate(0, LH, 0);
  k.inst.registerKind('fc:lamp', [
    { mat: 'metal', castShadow: true, geo: mg([part(cyl6, P.metal, 0, 0.09, 0, 0.34, 0.18, 0.34), part(cyl6, P.metal, 0, (LH - 0.2) / 2, 0, 0.09, LH - 0.2, 0.09),
      part(cyl6, '#ffcf4a', 0, 1.1, 0, 0.14, 0.05, 0.14), lf]) },
    { mat: 'emit', geo: lc },
  ]);
  // the forest round the clearing (fc-art.js forest(): dark broadleaf + 30 % dark pines), as cheap as a tree can be:
  // open trunks / cones, no shadows (2 kinds × 2 parts = 4 draw calls for the whole ring, ≈ 30 / 50 tris a tree)
  { const tr = new THREE.CylinderGeometry(0.5, 0.6, 1, 5, 1, true), cn = new THREE.ConeGeometry(0.5, 1, 7, 1, true), ic = new THREE.IcosahedronGeometry(0.5, 0);
    k.inst.registerKind('fc:fpine', [
      { mat: 'wood', geo: mg([part(tr, '#5a3c28', 0, 0.45, 0, 0.26, 0.9, 0.26)]) },
      { mat: 'leaf', geo: mg([part(cn, '#244a2c', 0, 1.25, 0, 2.0, 1.6, 2.0), part(cn, '#2f5e38', 0, 2.05, 0, 1.5, 1.4, 1.5, 0, 0.45, 0), part(cn, '#3f7448', 0, 2.8, 0, 0.95, 1.2, 0.95, 0, 0.9, 0)]) },
    ]);
    k.inst.registerKind('fc:foak', [
      { mat: 'wood', geo: mg([part(tr, '#5a3c28', 0, 0.55, 0, 0.3, 1.1, 0.3)]) },
      { mat: 'leaf', geo: mg([part(ic, '#2c5532', 0, 1.85, 0, 2.5, 2.0, 2.4, 0.3, 0.2, 0), part(ic, '#4f8752', 0.35, 2.45, 0.25, 1.5, 1.2, 1.5, 0, 0.7, 0.2)]) },
    ]);
    tr.dispose(); cn.dispose(); ic.dispose(); }
  cone8.dispose(); cyl6.dispose(); ico.dispose();
  // the asset models' own instanced kinds (src/world/fcart/houses.ts: beds, well, carts, lamps …; optional hook)
  const reg = (FC_HOUSES as Record<string, unknown>).registerFcItemKinds;
  if (typeof reg === 'function') { try { (reg as (k: Ctx) => void)(k); } catch (e) { try { console.warn('[l3d] fcart kinds failed', e); } catch { /* none */ } } }
}

/* ------------------------------------------------------------------ helpers */
const zOf = (y: number) => toZ(y);
/** A horizontal polygon (px) at height y as a ShapeGeometry in world metres (holes optional). */
export function polyGeo(poly: readonly P2[], y: number, holes: (readonly P2[])[] = []): THREE.BufferGeometry {
  const sh = new THREE.Shape(poly.map(([px, py]) => new THREE.Vector2(toX(px), -toZ(py))));
  for (const h of holes) sh.holes.push(new THREE.Path(h.map(([px, py]) => new THREE.Vector2(toX(px), -toZ(py)))));
  const g = new THREE.ShapeGeometry(sh);
  g.rotateX(-Math.PI / 2); g.translate(0, y, 0);
  return g;
}
/** A strip of quads between two polylines (world points), each [x, y, z]; faces towards `out` (the strip's normal side). */
export function stripGeo(top: number[][], bot: number[][]): THREE.BufferGeometry {
  const pos: number[] = [];
  for (let i = 0; i + 1 < top.length; i++) {
    const a = top[i], b = top[i + 1], c = bot[i + 1], d = bot[i];
    pos.push(...a, ...d, ...b, ...b, ...d, ...c);
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.computeVertexNormals();
  return g;
}
/** Low-poly lumps (20 / 80 tris) for small round props and rocks — a UV sphere is 192. */
export const ICO0 = new THREE.IcosahedronGeometry(0.5, 0), ICO1 = new THREE.IcosahedronGeometry(0.5, 1);
const lump = (k: Ctx, mat: Parameters<Ctx['b']['add']>[0], col: string, x: number, y: number, z: number, r: number, sy = 1) => k.b.add(mat, ICO0, M(x, y, z, r * 2, r * 2 * sy, r * 2, 0, (x * 7.3 + z * 3.1 + y * 5.7) % 6.28, 0), col, 1);
export const hash = (x: number, y: number) => { const h = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453; return h - Math.floor(h); };

/** Is a point (px) on a street / square / plaza / lane (no grass there)? */
export function onPaving(sc: FairCatsScene, x: number, y: number, margin = 0): boolean {
  for (const s of sc.streets) {
    if (s.poly && s.poly.length >= 4) {
      const xs = s.poly.map((p) => p[0]), ys = s.poly.map((p) => p[1]);
      if (x >= Math.min(...xs) - margin && x <= Math.max(...xs) + margin && y >= Math.min(...ys) - margin && y <= Math.max(...ys) + margin) return true;
    } else if (s.rr && x >= s.rr[0] - margin && x <= s.rr[2] + margin && y >= s.rr[1] - margin && y <= s.rr[3] + margin) return true;
  }
  for (const p of sc.paths) for (let i = 0; i + 1 < p.pts.length; i++) {
    const a = p.pts[i], b = p.pts[i + 1], dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy;
    const t = l2 ? Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / l2)) : 0;
    if (Math.hypot(x - a[0] - dx * t, (y - a[1] - dy * t)) < p.w / 2 + margin) return true;
  }
  return false;
}

/* ------------------------------------------------------------------ terrain */
export function buildFairCatsTerrain(k: Ctx, L: CityLayout, sc: FairCatsScene, groundAt: (x: number, y: number) => number): void {
  const P = k.pal, X0 = plateauX0(sc), W = sc.W, FAR = 3200, NORTH = -900;
  const rimFull: P2[] = [...sc.rim, [W + FAR, sc.rim[sc.rim.length - 1][1]]];
  // ---- meadow (lowPaving = grass in the new fair) with the pond cut out
  k.b.tag = 'terrain:ground';
  // the meadow is the town polygon (fc-art.js terrain(): P.grass); outside it the dark forest floor (P.forest)
  { const g = polyGeo(sc.town, 0, [sc.pond]); k.b.add('lowPaving', g, M(0, 0, 0), MEADOW, 2.4); g.dispose();
    const f = polyGeo([[-FAR, NORTH], [W + FAR, NORTH], [W + FAR, sc.H + 2200], [-FAR, sc.H + 2200]], 0, [sc.town]); k.b.add('lowPaving', f, M(0, 0, 0), FCP.forestFloor, 2.4); f.dispose(); }
  // ---- the forest glade below the gate and the monster spots' clearings (site 12.11 afternoon, fc-art.js gladeGround)
  if (sc.glade) { k.b.tag = 'terrain:glade'; fcGlade(k, sc.glade); }
  // ---- plateau top (FC_H)
  k.b.tag = 'terrain:plateau';
  { const yT = Math.min(...sc.plateau.map((p) => p[1])), xE = Math.max(...sc.plateau.map((p) => p[0])), rE = rimY(sc.rim, xE);
    const inner: P2[] = [[X0, yT], [xE, yT], ...rimFull.filter((p) => p[0] <= xE).slice().reverse().filter((p, i, a) => i === 0 || p[0] !== a[i - 1][0])];
    if (inner[2][0] !== xE) inner.splice(2, 0, [xE, rE]);
    const g = polyGeo(inner, FC_H); k.b.add('lowPaving', g, M(0, 0, 0), PLAT, 2.4); g.dispose();
    const back = polyGeo([[X0, NORTH], [W + FAR, NORTH], [W + FAR, yT], [X0, yT]], FC_H); k.b.add('lowPaving', back, M(0, 0, 0), FCP.forestFloor, 2.4); back.dispose();
    const east: P2[] = [[xE, yT], [W + FAR, yT], ...rimFull.filter((p) => p[0] > xE).slice().reverse(), [xE, rE]];
    if (east.length >= 4) { const e = polyGeo(east, FC_H); k.b.add('lowPaving', e, M(0, 0, 0), FCP.forestFloor, 2.4); e.dispose(); } }
  // ---- rock bank under the rim: rim (FC_H) → rim + FACE (0), with a bulging middle row
  k.b.tag = 'terrain:bank';
  {
    fcBank(k, rimFull, sc.face, FC_H, 0, sc.stairs);
    // the west end of the bank and the plateau's west cliff (x = X0, north of the rim)
    const r0 = sc.rim[0][1];
    const side = new THREE.BufferGeometry();
    side.setAttribute('position', new THREE.Float32BufferAttribute([
      toX(X0), FC_H, zOf(r0), toX(X0), -0.05, zOf(r0), toX(X0) - 0.02, -0.05, zOf(r0 + sc.face),
    ], 3)); side.computeVertexNormals();
    k.b.add('rock', side, M(0, 0, 0), shade(P.rock, -0.15), 1.6); side.dispose();
    const wt: number[][] = [], wb: number[][] = [];
    for (let y = r0; y >= NORTH; y -= 60) { const jit = hash(y, 3) - 0.5; wt.push([toX(X0), FC_H + 0.02, zOf(y)]); wb.push([toX(X0) - 0.32 + jit * 0.2, -0.05, zOf(y)]); }
    const gw = stripGeo(wb, wt); k.b.add('rock', gw, M(0, 0, 0), shade(P.rock, -0.1), 1.6); gw.dispose();
    // boulders at the bank's foot (in the face's obstacle band; never on stairs / in a building's foot)
    const busy = (x: number) => sc.stairs.some((s) => x > s.x0 - 60 && x < s.x1 + 60) || sc.buildings.some((b) => x > b.foot[0] - 30 && x < b.foot[2] + 30 && b.foot[1] < rimY(sc.rim, x) + sc.face + 10);
    for (let x = X0 + 60; x < W - 40; x += 150 + hash(x, 7) * 120) {
      if (busy(x)) continue;
      const r = rimY(sc.rim, x), s = 0.35 + hash(x, 9) * 0.3;
      k.b.add('rock', ICO1, M(toX(x), 0.08, zOf(r + sc.face) - 0.35, s * 2.2, s * 1.4, s * 1.6, 0, hash(x, 2) * 3, 0), shade(P.rock, hash(x, 4) * 0.2 - 0.1), 1.6);
    }
  }
  // ---- mountain: top at FC_H + FC_MH, rock face along [west corner, …MRIM] down to the plateau
  k.b.tag = 'terrain:mountain';
  if (sc.mount.length >= 3 && sc.mrim.length >= 2) {
    const mx0 = Math.min(...sc.mount.map((p) => p[0]));
    const corner = sc.mount.find((p) => p[0] === mx0 && p[1] > 250) ?? [mx0, sc.mrim[0][1] - 90];
    const edge: P2[] = [[mx0, NORTH], corner as P2, ...sc.mrim, [W + FAR, sc.mrim[sc.mrim.length - 1][1]]];
    const topY = FC_H + FC_MH;
    const g = polyGeo([[mx0, NORTH], ...edge.slice(1), [W + FAR, NORTH]].reverse() as P2[], topY); k.b.add('rock', g, M(0, 0, 0), FCP.mrock, 2); g.dispose();
    const t: number[][] = [], b: number[][] = [];
    for (let i = 0; i + 1 < edge.length; i++) {
      const a = edge[i], c = edge[i + 1], n = Math.max(1, Math.ceil(Math.hypot(c[0] - a[0], (c[1] - a[1]) * 2) / 70));
      for (let j = i ? 1 : 0; j <= n; j++) {
        const x = a[0] + (c[0] - a[0]) * j / n, y = a[1] + (c[1] - a[1]) * j / n, jit = hash(x, y) - 0.5;
        t.push([toX(x), topY + jit * 0.3, zOf(y)]);
        // the west side stands nearly upright (x − 50 px), the south face slopes down to MRIM + MFACE
        b.push(i === 0 ? [toX(x - 50), FC_H - 0.05, zOf(y)] : [toX(x) + jit * 0.2, FC_H - 0.05, zOf(y + sc.mface) - 0.05]);
      }
    }
    const gf = stripGeo(t, b); k.b.add('rock', gf, M(0, 0, 0), FCP.mrockD, 1.6); gf.dispose();
    // crags on top (silhouette) and a few far peaks
    for (let i = 0; i < 9; i++) {
      const x = mx0 + 180 + i * 260 + hash(i, 5) * 120, y = Math.min(rimY(sc.mrim, x) - 140, 600) - hash(i, 6) * 350, s = 1.2 + hash(i, 8) * 1.4;
      k.b.add('rock', ICO1, M(toX(x), topY + s * 0.2, zOf(y), s * 2.4, s * 1.5, s * 2.0, hash(i, 1), hash(i, 2) * 3, 0), shade(P.rock, hash(i, 3) * 0.16 - 0.08), 2);
    }
  }
  // ---- stairs and the cart ramp
  fcStairs(k, sc, sc.rim, FC_H);
  fcRails(k, sc, groundAt);
  fcStreets(k, sc, groundAt);
  // ---- pond: water, a soil bank skirt, the pier
  k.b.tag = 'terrain:pond';
  if (sc.pond.length >= 3) {
    const g = polyGeo(sc.pond, FC_POND); k.b.add('water', g, M(0, 0, 0), '#ffffff', 3); g.dispose();
    const t: number[][] = [], b: number[][] = [];
    for (const [x, y] of [...sc.pond, sc.pond[0]]) { t.push([toX(x), 0.0, zOf(y)]); b.push([toX(x), FC_POND - 0.25, zOf(y)]); }
    const gs = stripGeo(t, b); k.b.add('rock', gs, M(0, 0, 0), shade(P.rock, -0.2), 1.2); gs.dispose();
    const pr = sc.pier;
    if ([pr.x0, pr.x1, pr.y0, pr.y1].every(Number.isFinite)) {
      const deck = (x0: number, x1: number, y0: number, y1: number) => {
        const n = Math.max(2, Math.round(toX(x1 - x0) / 0.22));
        for (let i = 0; i < n; i++) box(k, 'wood', i % 2 ? P.woodL : shade(P.woodL, -0.08), toX(x0 + (x1 - x0) * i / n) + 0.01, toX(x0 + (x1 - x0) * (i + 1) / n) - 0.01, FC_PIER - 0.06, FC_PIER, zOf(y0), zOf(y1), 0.6);
        for (const [x, y] of [[x0, y0], [x1, y0], [x0, y1], [x1, y1]]) box(k, 'wood', P.woodD, toX(x) - 0.06, toX(x) + 0.06, FC_POND - 0.3, FC_PIER - 0.061, zOf(y) - 0.06, zOf(y) + 0.06, 0.5);
      };
      const endOk = pr.end.every(Number.isFinite);
      deck(endOk ? Math.max(pr.x0, pr.end[2]) : pr.x0, pr.x1, pr.y0, pr.y1);
      if (endOk) deck(pr.end[0], pr.end[2], pr.end[1], pr.end[3]);
    }
  }
  fcWall(k, sc);
  k.b.tag = '';
}

/** Stairs / ramps that go down this rim (their x centre on its span, their y range across it). */
export function stairsOn(stairs: readonly FcStair[], rim: readonly P2[], face: number): FcStair[] {
  if (rim.length < 2) return [];
  const x0 = rim[0][0], x1 = rim[rim.length - 1][0];
  return stairs.filter((s) => { const xc = (s.x0 + s.x1) / 2; return xc >= x0 && xc <= x1 && Math.abs(rimY(rim, xc) - (s.y0 + s.y1) / 2) < (s.y1 - s.y0) / 2 + face; });
}
/**
 * The rock bank under a rim: rim (top) → rim + face (base), with a bulging middle row — CUT where a flight of stairs /
 * a ramp goes down it (its retaining walls close the cut, the flight is in it). Near a cut the bank has no bulge, so
 * the walls' tops (0.45 m over the flight) stay above it. Shared with the Town Kit (src/world/townkit.ts).
 */
export function fcBank(k: Ctx, rim: readonly P2[], face: number, top: number, base: number, stairs: readonly FcStair[]): void {
  if (rim.length < 2) return;
  const P = k.pal, cuts = stairsOn(stairs, rim, face), xs: number[] = [];
  for (let i = 0; i + 1 < rim.length; i++) {
    const a = rim[i], b = rim[i + 1], n = Math.max(1, Math.ceil(Math.abs(b[0] - a[0]) / 70));
    for (let j = i ? 1 : 0; j <= n; j++) xs.push(a[0] + (b[0] - a[0]) * j / n);
  }
  for (const s of cuts) xs.push(s.x0, s.x1);
  xs.sort((p, q) => p - q);
  const inCut = (x: number) => cuts.some((s) => x > s.x0 + 0.5 && x < s.x1 - 0.5);
  const nearCut = (x: number) => Math.min(1, cuts.reduce((d, s) => Math.min(d, Math.max(0, s.x0 - x, x - s.x1)), Infinity) / 120);
  const runs: number[][] = [];
  let cur: number[] = [];
  for (let i = 0; i < xs.length; i++) {
    if (i && xs[i] - xs[i - 1] < 0.5) continue;
    if (cur.length && inCut((cur[cur.length - 1] + xs[i]) / 2)) { if (cur.length > 1) runs.push(cur); cur = []; }
    cur.push(xs[i]);
  }
  if (cur.length > 1) runs.push(cur);
  for (const run of runs) {
    const T: number[][] = [], Mi: number[][] = [], B: number[][] = [];
    for (const x of run) {
      const r = rimY(rim, x), X = toX(x), f = nearCut(x), jit = (hash(x, 1) - 0.5) * f;
      T.push([X, top + 0.02, zOf(r)]);
      Mi.push([X, base + (top - base) * (0.5 + jit * 0.12), zOf(r + face * 0.5) + (0.25 + jit * 0.35) * f]);
      B.push([X, base - 0.05, zOf(r + face) + 0.05]);
    }
    const g1 = stripGeo(T, Mi), g2 = stripGeo(Mi, B);
    k.b.add('rock', g1, M(0, 0, 0), FCP.rock, 1.6); k.b.add('rock', g2, M(0, 0, 0), FCP.rockD, 1.6); g1.dispose(); g2.dispose();
  }
}
/** A vertical-sided prism over a (z, y) profile polygon (convex, counter-clockwise seen from +x), x from x0 to x1. */
export function prismX(profile: readonly [number, number][], x0: number, x1: number): THREE.BufferGeometry {
  const pos: number[] = [], n = profile.length;
  for (let i = 1; i + 1 < n; i++) {
    const a = profile[0], b = profile[i], c = profile[i + 1];
    pos.push(x1, a[1], a[0], x1, c[1], c[0], x1, b[1], b[0]);   // +x cap
    pos.push(x0, a[1], a[0], x0, b[1], b[0], x0, c[1], c[0]);   // -x cap
  }
  for (let i = 0; i < n; i++) {
    const a = profile[i], b = profile[(i + 1) % n];
    pos.push(x0, a[1], a[0], x1, a[1], a[0], x1, b[1], b[0], x0, a[1], a[0], x1, b[1], b[0], x0, b[1], b[0]);
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();   // non-indexed: flat normals, outward for a CCW profile (z right, y up)
  return g;
}
/** The site's step colours (tk-art.js stair(): cream treads, a grey-pink stone rail on either side with end blocks). */
const STEP_C = ['#f0dfcc', '#e8d4c0'], RAIL_C = '#cdb7a8', RAIL_D = '#b39a8c';
/**
 * One flight of stairs (or the plank cart ramp) down a bank, from the rim (`top` m) to the bank's foot (`base`): solid
 * step blocks standing on the ground of the cut, a stone retaining wall on either side standing on the ground with
 * its top 0.45 m over the flight (vertical ends, no slanted slabs), end blocks at the top and the foot. The ramp: a
 * plank deck whose top is the walk height, cross planks, the same stone walls. Lint marks 'stair' / 'ramp'.
 * Shared with the Town Kit (src/world/townkit.ts).
 */
export function fcFlight(k: Ctx, s: FcStair, r: number, face: number, top: number, base: number, rail: number): void {
  const P = k.pal, x0 = toX(s.x0), x1 = toX(s.x1), rl = Math.max(0.14, toX(rail)), y1 = Math.min(s.y1, r + face);
  const z0 = zOf(r), z1 = zOf(y1), H = top - base;
  const tag = k.b.tag;
  k.b.tag = s.k === 'ramp' ? 'terrain:ramp' : 'terrain:stairs';
  // retaining walls: the profile (z, y) = top end on the plateau edge, the slope line + 0.45 m, the foot, the ground
  const zt = z0 - 0.14, zf = z1 + 0.12, over = 0.45;
  const prof: [number, number][] = [[zt, base - 0.05], [zf, base - 0.05], [zf, base + over], [z0, top + over], [zt, top + over]];
  for (const [a, b] of [[x0, x0 + rl], [x1 - rl, x1]]) {
    const g = prismX(prof, a, b); k.b.add('stone', g, M(0, 0, 0), RAIL_C, 0.8); g.dispose();
    // end blocks (the site's rounded caps): on the plateau edge and at the foot
    box(k, 'stone', RAIL_D, a - 0.04, b + 0.04, top + over, top + over + 0.12, zt - 0.02, zt + 0.24, 0.8);
    box(k, 'stone', RAIL_D, a - 0.04, b + 0.04, base - 0.05, base + over + 0.14, zf - 0.26, zf + 0.02, 0.8);
  }
  const ix0 = x0 + rl, ix1 = x1 - rl;
  if (s.k === 'ramp') {
    // the deck: a plank slab whose top is the walk height (rim → foot), cross planks a little proud of it
    const len = Math.hypot(z1 - z0, H), ang = Math.atan2(H, z1 - z0), cy = (top + base) / 2, cz = (z0 + z1) / 2;
    const nx = Math.sin(ang), ny = Math.cos(ang);   // the deck's up normal in (z, y)
    rbox(k, 'wood', P.woodL, (ix0 + ix1) / 2, cy - ny * 0.08, cz - nx * 0.08, ix1 - ix0 - 0.02, 0.16, len, 0, ang, 0, 0.6);
    const n = Math.max(3, Math.floor(len / 0.42));
    for (let i = 1; i < n; i++) {
      const t = i / n, yy = top - H * t, zz = z0 + (z1 - z0) * t;
      rbox(k, 'wood', P.woodD, (ix0 + ix1) / 2, yy + ny * 0.012, zz + nx * 0.012, ix1 - ix0 - 0.1, 0.024, 0.06, 0, ang, 0, 0.6);
    }
    (k.marks ||= []).push({ kind: 'ramp', box: [ix0, ix1, base, top, z0, z1], tag: k.b.tag });
  } else {
    const n = Math.max(6, Math.round(H / 0.2));
    for (let i = 0; i < n; i++) {
      const za = z0 + (z1 - z0) * i / n, zb = z0 + (z1 - z0) * (i + 1) / n, h = base + H * (1 - (i + 0.5) / n);
      box(k, 'stone', STEP_C[i % 2], ix0, ix1, base - 0.05, h, za, zb, 0.8);
    }
    (k.marks ||= []).push({ kind: 'stair', box: [ix0, ix1, base, top, z0, z1], tag: k.b.tag });
  }
  k.b.tag = tag;
}
/** Every flight of a rim (fair plateau / a kit tier). */
export function fcStairs(k: Ctx, sc: FairCatsScene, rim: readonly P2[], top: number, face = sc.face, base = 0): void {
  for (const s of stairsOn(sc.stairs, rim, face)) fcFlight(k, s, rimY(rim, (s.x0 + s.x1) / 2), face, top, base, sc.rail);
}

/** Cart rails along sc.rails, following the ground (shared with the Town Kit, src/world/townkit.ts). */
export function fcRails(k: Ctx, sc: FairCatsScene, groundAt: (x: number, y: number) => number): void {
  const P = k.pal;
  // cart rails from the mine down the ramp
  k.b.tag = 'terrain:rails';
  const kit = kitOf(sc);
  const faces: { poly: readonly P2[]; rim: readonly P2[]; face: number }[] = kit ? kit.rocks.map((r) => ({ poly: r.poly, rim: r.rim, face: r.face })) : [{ poly: sc.mount, rim: sc.mrim, face: sc.mface }];
  const mine = sc.buildings.find((b) => b.id === 'mine');   // the portal model lays its own rails into the adit
  const inRock = (x: number, y: number) => (!!mine && x > mine.vis[0] && x < mine.vis[2] && y > mine.vis[1] && y < mine.vis[3] + 30) || faces.some((f) => inPoly(f.poly, x, y) || (f.rim.length >= 2 && x >= f.rim[0][0] && x <= f.rim[f.rim.length - 1][0] && y < rimY(f.rim, x) + f.face + 6 && y > rimY(f.rim, x) - 400));
  for (let i = 0; i + 1 < sc.rails.length; i++) {
    const a = sc.rails[i], b = sc.rails[i + 1], n = Math.max(1, Math.ceil(Math.hypot(toX(b[0] - a[0]), zOf(b[1]) - zOf(a[1])) / 0.6));
    for (let j = 0; j < n; j++) {
      const pa: P2 = [a[0] + (b[0] - a[0]) * j / n, a[1] + (b[1] - a[1]) * j / n], pb: P2 = [a[0] + (b[0] - a[0]) * (j + 1) / n, a[1] + (b[1] - a[1]) * (j + 1) / n];
      if (inRock(pa[0], pa[1]) || inRock(pb[0], pb[1])) continue;   // the rails come out of the adit, not out of the rock face
      const ya = groundAt(pa[0], pa[1]), yb = groundAt(pb[0], pb[1]), X = (toX(pa[0]) + toX(pb[0])) / 2, Z = (zOf(pa[1]) + zOf(pb[1])) / 2;
      const dx = toX(pb[0]) - toX(pa[0]), dz = zOf(pb[1]) - zOf(pa[1]), len = Math.hypot(dx, dz, yb - ya), yaw = -Math.atan2(dz, dx), pitch = Math.atan2(yb - ya, Math.hypot(dx, dz));
      for (const o of [-0.22, 0.22]) rbox(k, 'metal', '#8a8e9e', X - Math.sin(yaw) * o * 0 + Math.sin(-yaw) * o, (ya + yb) / 2 + 0.055, Z + Math.cos(yaw) * o, len, 0.05, 0.05, yaw, 0, pitch, 0.5);
      rbox(k, 'wood', P.woodD, X, (ya + yb) / 2 + 0.015, Z, 0.12, 0.04, 0.62, yaw, 0, 0, 0.5);
    }
  }
}
/** Streets, squares, the plaza, lanes of a scene (shared with the Town Kit). */
export function fcStreets(k: Ctx, sc: FairCatsScene, groundAt: (x: number, y: number) => number): void {
  const P = k.pal;
  // ---- streets, squares, the plaza, lanes (each class its own height: no coplanar overlaps)
  k.b.tag = 'terrain:streets';
  sc.streets.forEach((s, i) => {
    if (s.poly && s.poly.length >= 3) {
      const g = polyGeo(s.poly, 0.012 + i * 0.005); k.b.add('paving', g, M(0, 0, 0), FCP.pave, 1.6); g.dispose();
    } else if (s.rr) {
      const [x0, y0, x1, y1, rr] = s.rr;
      const g = polyGeo(roundRect(x0, y0, x1, y1, rr), 0.05); k.b.add('stone', g, M(0, 0, 0), FCP.plaza, 0.9); g.dispose();
      if (!kitOf(sc)) fcPlazaRound(k, (x0 + x1) / 2, Math.min(y1 - 60, Math.max(y0 + 60, 1780)), 0.05);
    }
  });
  k.b.tag = 'terrain:lanes';
  for (const p of sc.paths) for (let i = 0; i + 1 < p.pts.length; i++) {
    const a = p.pts[i], b = p.pts[i + 1], n = Math.max(1, Math.ceil(Math.hypot(toX(b[0] - a[0]), zOf(b[1]) - zOf(a[1])) / 0.9));
    for (let j = 0; j < n; j++) {
      const pa: P2 = [a[0] + (b[0] - a[0]) * j / n, a[1] + (b[1] - a[1]) * j / n], pb: P2 = [a[0] + (b[0] - a[0]) * (j + 1) / n, a[1] + (b[1] - a[1]) * (j + 1) / n];
      const mx = (pa[0] + pb[0]) / 2, my = (pa[1] + pb[1]) / 2;
      if (sc.stairs.some((s) => mx >= s.x0 - 10 && mx <= s.x1 + 10 && my >= s.y0 && my <= s.y1)) continue;   // the steps are the lane there
      const ga = groundAt(pa[0], pa[1]), gb = groundAt(pb[0], pb[1]);
      if (Math.abs(ga - gb) > 0.05) continue;   // over the bank / a ramp
      const dx = toX(pb[0] - pa[0]), dz = zOf(pb[1]) - zOf(pa[1]), len = Math.hypot(dx, dz);
      if (len < 1e-3) continue;
      const ux = Math.abs(dx / len), uz = Math.abs(dz / len), w = p.w * (SX * uz + SZ * ux) * 0.9;
      rbox(k, 'paving', '#e8b878', toX(mx), ga + 0.002, zOf(my), len + w * 0.5, 0.008, w, -Math.atan2(dz, dx), 0, 0, 1.6);
    }
  }
}
/** The city wall along the bottom with towers, open at the gate (shared with the Town Kit; none without numbers). */
export function fcWall(k: Ctx, sc: FairCatsScene): void {
  if (![sc.wall.x0, sc.wall.x1, sc.wall.y0, sc.wall.y1, sc.wall.gate[0], sc.wall.gate[1]].every(Number.isFinite)) return;
  // ---- fc-art.js wallPiece / wallTower: a grey stone wall (rockD body, rockL coping, merlons) along the bottom, open at
  // the gate, with round stone towers under PURPLE conical roofs (cat ears, a gold / pink pennant)
  k.b.tag = 'terrain:wall';
  const w = sc.wall, za = zOf(w.y0) + 0.25, zb = zOf(w.y1) - 0.2, hh = 2.5;
  for (const [a, b] of [[w.x0, w.gate[0] + 40], [w.gate[1] - 40, w.x1]] as P2[]) {
    box(k, 'stone', FCP.rockD, toX(a), toX(b), -0.1, hh, za, zb, 1.2);
    box(k, 'stone', FCP.rockL, toX(a) - 0.05, toX(b) + 0.05, hh, hh + 0.16, za - 0.06, zb + 0.06, 0.8);
    for (let x = toX(a) + 0.2; x < toX(b) - 0.4; x += 0.8) box(k, 'stone', FCP.rockL, x, x + 0.4, hh + 0.16, hh + 0.56, zb - 0.32, zb + 0.04, 0.8);
    k.colliders.push(toX(a), toX(b), 0, hh + 0.5, za, zb);
  }
  const zc = (za + zb) / 2, xs = [w.x0 + 30, 1100, 1900, 3860, 4660, w.x1 - 30].filter((x) => x >= w.x0 && x <= w.x1 && (x < w.gate[0] - 60 || x > w.gate[1] + 60));
  xs.forEach((x, i) => {
    const X = toX(x), R = 1.05, top = hh + 1.15;
    cyl(k, 'stone', FCP.rock, X, -0.1, zc, R, top + 0.1, 16, 1.2);
    cyl(k, 'stone', FCP.rockL, X, top, zc, R + 0.1, 0.16, 16, 0.8);          // the eave ring the roof sits on
    cone(k, 'roof', FCP.plum, X, top + 0.16, zc, R + 0.22, 1.9, false, 0.8);
    for (const sx of [-1, 1]) cone(k, 'roof', FCP.plumD, X + sx * 0.5, top + 0.95, zc + 0.42, 0.2, 0.45, false, 0.6);   // cat ears
    const yT = top + 0.16 + 1.9;
    cyl(k, 'metal', '#3a2e4a', X, yT - 0.1, zc, 0.03, 0.6, 8, 0.5);
    rbox(k, 'canvas', i % 2 ? FCP.pink : FCP.gold, X + 0.26, yT + 0.32, zc, 0.5, 0.22, 0.02, 0, 0, 0, 1);
    k.colliders.push(X - R, X + R, 0, top + 2, zc - R, zc + R);
  });
}

export function fcPlazaRound(k: Ctx, cx: number, cy: number, y: number): void {
  const ring = (R: number, r: number, h: number, col: string) => {
    const el = (q: number) => { const o: P2[] = []; for (let i = 0; i < 40; i++) { const t = -i / 40 * Math.PI * 2; o.push([cx + Math.cos(t) * q, cy + Math.sin(t) * q / 1.6]); } return o; };
    const g = polyGeo(el(R), y + h, r > 0 ? [el(r).reverse()] : []); k.b.add('stone', g, M(0, 0, 0), col, 0.9); g.dispose();
  };
  ring(300, 270, 0.006, FCP.terraD); ring(270, 200, 0.006, FCP.terra); ring(200, 130, 0.006, FCP.terraL); ring(130, 0, 0.006, FCP.plaza);
  // the brick joints of the middle ring
  for (let i = 0; i < 36; i++) {
    const t = i / 36 * Math.PI * 2, a: P2 = [cx + Math.cos(t) * 204, cy + Math.sin(t) * 204 / 1.6], b: P2 = [cx + Math.cos(t) * 266, cy + Math.sin(t) * 266 / 1.6];
    const X = toX((a[0] + b[0]) / 2), Z = zOf((a[1] + b[1]) / 2), dx = toX(b[0] - a[0]), dz = zOf(b[1]) - zOf(a[1]);
    rbox(k, 'stone', FCP.terraD, X, y + 0.014, Z, Math.hypot(dx, dz), 0.006, 0.05, -Math.atan2(dz, dx), 0, 0, 0.9);
  }
}

export function roundRect(x0: number, y0: number, x1: number, y1: number, r: number): P2[] {
  const out: P2[] = [], c: [number, number, number][] = [[x1 - r, y1 - r, 0], [x0 + r, y1 - r, 0.5], [x0 + r, y0 + r, 1], [x1 - r, y0 + r, 1.5]];
  for (const [cx, cy, a0] of c) for (let j = 0; j <= 5; j++) { const a = (a0 + j / 10) * Math.PI; out.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]); }
  return out;
}

/* ------------------------------------------------------------------ asset models (src/world/fcart) */
/**
 * The asset-faithful model of a site ref (src/world/fcart/registry.ts), or undefined → the generic code builds it.
 * A Town Kit town asks 'tk:<ref>' first; its buildings are other drawings than the fair's (tk-art.js building()), so
 * only the shared assets (houses, decor items: the same tk-art.js functions) fall back to the fair's model.
 */
export function fcModelFor(ref: string, kit: boolean): FcModel | undefined {
  if (!kit) return fcModel(ref);
  return fcModel('tk:' + ref) ?? (ref.startsWith('house:') || ref.startsWith('i:') ? fcModel(ref) : undefined);
}
/** Build a model (its errors fall back to the generic code: false). Notes it for the runtime asset check (fcart/live.ts). */
function buildModel(k: Ctx, m: FcModel, p: FcPlace): boolean {
  const nb = k.b.tag;
  try { m.build(k, p); } catch (e) { try { console.warn('[l3d] fcart model failed', m.ref, e); } catch { /* none */ } return false; } finally { k.b.tag = nb; }
  noteFcModel(m.ref, m.fp);
  return true;
}
/** Run a builder for its solids / colliders only (the geometry goes to a throw-away batch): the jail cage and the mine
 *  adit keep their walk truth (fairCatsSolids skips their site obstacles) when a new model draws them. */
function solidsOnly(k: Ctx, fn: (k2: Ctx) => void): void {
  const k2: Ctx = { ...k, b: new Batch(), inst: new Instancer(), glows: [], lights: [], bulbs: [], wires: [], pools: [], blobs: [], plant: [], marks: [] };
  try { fn(k2); } catch { /* the solids pushed so far stay */ }
  k.solids = k2.solids; k.colliders = k2.colliders;
}
/** Item point → its drawn box (px) from the asset table (fcart-fp.json box [w, h]: bottom-centred on the item point). */
function itemVis(ref: string, x: number, y: number, kit: boolean): [number, number, number, number] {
  const T = FCART_FP as unknown as Record<string, { box: [number, number] }>, e = (kit && T['tk:' + ref]) || T[ref];
  const [w, h] = e?.box ?? [80, 80];
  return [x - w / 2, y - h + 8, x + w / 2, y + 8];
}

/* ------------------------------------------------------------------ buildings + houses */
/** Every site building on its foot band (see the header). */
export function buildFairCatsBuildings(k: Ctx, L: FairCatsLayout, groundAt: (x: number, y: number) => number): void {
  const sc = L.faircats, kit = kitOf(sc);
  clearFcModels();
  // the boxes of the building pieces: placeFairCatsProps keeps the lamp heads and the small decor out of them (a site
  // lamp point under a model's deeper roof put the lantern inside it — Town Kit board / forge; the storage model's own
  // crates stand where the site puts its box and barrel)
  const high: number[] = []; HIGH.set(k, high);
  const prev = k.b.onAdd;
  k.b.onAdd = (mat, bx) => { prev?.(mat, bx); if (k.b.tag && k.b.tag !== 'houses' && mat !== 'emit' && mat !== 'sign') high.push(bx.min.x, bx.min.y, bx.min.z, bx.max.x, bx.max.y, bx.max.z); };
  const inst0 = new Map<string, number>(); for (const [kind, a] of k.inst.placed) inst0.set(kind, a.length);
  try { buildFcBuildings(k, L, sc, kit, groundAt); } finally { k.b.onAdd = prev; }
  // the buildings' own crates / barrels (old builders: lowstreet.ts storage) count as building pieces too
  for (const [kind, a] of k.inst.placed) if (/crate|barrel/.test(kind)) for (let i = inst0.get(kind) ?? 0; i < a.length; i++) {
    const q = a[i], r = 0.34 * q.scale;
    high.push(q.x - r, q.y, q.z - r, q.x + r, q.y + 0.8 * q.sy, q.z + r);
  }
}
/** Building piece boxes per Ctx (buildFairCatsBuildings → placeFairCatsProps). */
const HIGH = new WeakMap<Ctx, number[]>();
/** A lamp item moved clear of the building pieces over its head (±0.4 / 0.8 m along x, then 0.4 m forward), or null. */
function lampClear(k: Ctx, it: FcItem, G: (x: number, y: number) => number, lampHead: number): FcItem | null {
  const H = HIGH.get(k); if (!H?.length) return it;
  const hits = (x: number, y: number) => {
    const X = toX(x), Z = toZ(y - 3), g = G(x, y), y0 = g + lampHead - 0.35, y1 = g + lampHead + 0.75;
    for (let i = 0; i < H.length; i += 6) if (X + 0.3 > H[i] && X - 0.3 < H[i + 3] && Z + 0.3 > H[i + 2] && Z - 0.3 < H[i + 5] && y1 > H[i + 1] && y0 < H[i + 4]) return true;
    return false;
  };
  for (const [dx, dy] of [[0, 0], [-40, 0], [40, 0], [-80, 0], [80, 0], [0, 20], [-40, 20], [40, 20]]) if (!hits(it.x + dx, it.y + dy)) return dx || dy ? { ...it, x: it.x + dx, y: it.y + dy } : it;
  return null;
}
/** Small decor the site places right where a building model drew its own (box / barrel / crate / sack inside a piece). */
const DECOR = new Set(['box', 'barrel', 'crate', 'sack', 'pot', 'bucket']);
function decorInBuilding(k: Ctx, it: FcItem, G: (x: number, y: number) => number): boolean {
  const H = HIGH.get(k); if (!H?.length || !DECOR.has(it.k)) return false;
  const X = toX(it.x), Z = toZ(it.y - 15), g = G(it.x, it.y), hw = it.k === 'crate' ? (Math.min(3, Math.max(1, +(it.n as number) || 1)) - 1) * 0.31 + 0.25 : 0.22;
  for (let i = 0; i < H.length; i += 6) if (X + hw > H[i] && X - hw < H[i + 3] && Z + 0.26 > H[i + 2] && Z - 0.26 < H[i + 5] && g + 0.5 > H[i + 1] && g + 0.1 < H[i + 4]) return true;
  return false;
}
function buildFcBuildings(k: Ctx, L: FairCatsLayout, sc: FairCatsScene, kit: ReturnType<typeof kitOf>, groundAt: (x: number, y: number) => number): void {
  for (const b of L.buildings) {
    const fb = sc.buildings.find((x) => x.id === b.id);
    k.b.tag = b.id;
    const base = groundAt(b.door.x, b.door.y);
    // an asset model (src/world/fcart): drawn on the site's own rects; doors / signs / labels keep working through
    // BUILDING_XF (entrance plane = the model's front on foot[3]); colliders stay the site's obstacles
    const am = fcModelFor(b.id, !!kit);
    if (am) {
      const foot = fb?.foot ?? [b.hit[0], b.hit[2], b.hit[1], b.hit[3]], vis = fb?.vis ?? foot;
      const J = b.id === 'jail' ? jailGeoOf(b, L.low) : null;
      if (J) JAIL_GEO.set(b, J);
      const nSol = (k.solids ||= []).length;
      const place: FcPlace = { vis, foot, door: { x: b.door.x, y: b.door.y }, base, data: {
        id: b.id, title: b.title, sign: L.signs[b.id] ? signText(L.signs[b.id]) : b.title, level: kit?.lvl[b.id] ?? 5, build: kit?.build[b.id] ?? null,
        soon: !!b.soon, scaffold: !!b.scaffold, low: LOW_IDS.has(b.id) || !!b.mine, kit: kit ? kit.id : null, biome: kit?.biome ?? 'meadow', vis5: kit?.vis5[b.id] ?? null,
        ...(J ? { jail: J } : {}) } };
      if (buildModel(k, am, place)) {
        // the jail and the mine models push their own walk solids (cage bars / floor, the portal posts: the site's obstacle
        // list skips them, fairCatsSolids); every other model keeps only its finite tops (the site's obstacles are the walls)
        const OWN = b.id === 'jail' || b.id === 'mine';
        if (!OWN) { const S = k.solids!; for (let i = S.length - 5; i >= nSol; i -= 5) if (S[i + 4] === Infinity) S.splice(i, 5); }
        if (!OWN && b.mine) {   // another adit drawn by a model: the old builder's walk truth
          const lh = k.lowH, wz = k.wallZ;
          k.lowH = base; k.wallZ = toZ(b.hit[3]) - 3.2;
          try { solidsOnly(k, (k2) => buildBuilding(k2, b)); } finally { k.lowH = lh; k.wallZ = wz; }
        }
        // the model's door (civic.ts civicDoorXf: entrance plane + door scale), else its front on foot[3]
        const dx = (FC_CIVIC as Record<string, unknown>).civicDoorXf as ((ref: string, p: FcPlace) => { zE: number; s: number } | null) | undefined;
        const d = typeof dx === 'function' ? dx(b.id, place) : null;
        const E = d ? d.zE : toZ(Math.min(foot[3], b.door.y - 22)) - 0.03;
        BUILDING_XF.set(b, { virt: { ...b }, z: () => E, s: d ? d.s : 1 });
        continue;
      }
      k.solids!.length = Math.min(k.solids!.length, nSol);   // a failed model: its solids go, the generic code builds
    }
    if (LOW_IDS.has(b.id) || b.mine) {
      if (b.id === 'jail') { const J = jailGeoOf(b, L.low); if (J) JAIL_GEO.set(b, J); }
      const lh = k.lowH, wz = k.wallZ, inst0 = new Map<string, number>();
      for (const [kind, a] of k.inst.placed) inst0.set(kind, a.length);
      k.lowH = base; k.wallZ = fb ? toZ(fb.foot[1]) : toZ(b.hit[3]) - 3.2;
      if (b.id === 'mine') k.wallZ = toZ(b.hit[3]) - 3.2;
      try { buildBuilding(k, b); } finally { k.lowH = lh; k.wallZ = wz; }
      // its barrels / crates as village aliases: the site's obstacle list is the walk truth (no PROP_SOLID of their own)
      for (const [of, as] of Object.entries(VK)) {
        const a = k.inst.placed.get(of), i0 = inst0.get(of) ?? 0;
        if (!a || a.length <= i0) continue;
        for (const p of a.splice(i0)) k.inst.add(as, p.x, p.y, p.z, p.rotY, p.scale, p.sy);
      }
      // the barn was made to stand against the old fair's retaining wall: a stone back wall closes it (free-standing here)
      if (b.id === 'storage' && fb) box(k, 'stone', shade(k.pal.stone, -0.2), toX(b.hit[0]) + 0.1, toX(b.hit[1]) - 0.1, base - 0.05, base + 2.4, toZ(fb.foot[1]) - 0.3, toZ(fb.foot[1]), 0.8);
      continue;
    }
    const foot = fb?.foot ?? [b.hit[0], b.hit[2], b.hit[1], b.hit[3]];
    const vis = fb?.vis ?? [b.hit[0], b.hit[2], b.hit[1], b.hit[3]];
    // a Town Kit building below level 5 has a smaller plot (tk-map.js plotOf): the model shrinks in height with it
    const v5 = kit?.vis5[b.id], shr = v5 ? Math.max(0.4, Math.min(1, (vis[3] - vis[1]) / Math.max(1, v5[3] - v5[1]))) : 1;
    const hgt = Math.max(vis[3] - vis[1], (OLD_H[b.id] ?? 0) * shr);
    const cx = (vis[0] + vis[2]) / 2, flip = b.id === 'gate';
    const virt: Building = { ...b, title: L.signs[b.id] ? signText(L.signs[b.id]) : b.title, hit: [vis[0], vis[2], 800 - hgt, 800], door: { x: b.door.x, y: 822 } };
    let zb = toZ(foot[1]) + 0.03, zf = toZ(foot[3]) - 0.03;
    const thin = zf - zb < 2.0;   // a notice board's foot is a plank: the model keeps its own depth (its notes stay apart)
    const nSol = (k.solids ||= []).length;
    const f = buildAtDepth(k, { cx: toX(cx), sx: 1, sy: 1, zb, zf, zFace: -0.15, flip, dy: base, shift: thin, clampX: [toX(vis[0]), toX(vis[2])] }, () => buildBuilding(k, virt));
    BUILDING_XF.set(b, { virt, z: f, s: 1 });
    // the model's own solids cover its whole band; the site's obstacle (an ellipse for the tent / magic shop, the gate's
    // pass) is the walk truth: fairCatsSolids adds it — the model keeps only its finite tops (steps, counters)
    const S = k.solids!; for (let i = S.length - 5; i >= nSol; i -= 5) if (S[i + 4] === Infinity) S.splice(i, 5);
  }
  // houses: the tavern and cottages, facing the street below them
  k.b.tag = 'houses';
  sc.houses.forEach((h, i) => {
    const X0 = toX(h.foot[0]) + 0.05, X1 = toX(h.foot[2]) - 0.05, zf = toZ(h.foot[3]) - 0.04, d = Math.max(2.2, toZ(h.foot[3]) - toZ(h.foot[1]) - 0.1);
    const tav = h.k === 'tavern', r = hash(h.foot[0], h.foot[1]);
    const am = fcModelFor(tav ? 'house:tavern' : 'house:' + (h.roof || 'red'), !!kit);
    if (am && buildModel(k, am, { vis: h.vis, foot: h.foot, door: { x: h.door.x, y: h.door.y }, base: groundAt(h.door.x, h.door.y),
      data: { id: h.id, k: h.k, roof: h.roof, roofCol: ROOF[h.roof] ?? k.pal.roof, roofCat: i % 2 === 0, sign: tav ? 'ТРАКТИР' : null, kit: kit ? kit.id : null, biome: kit?.biome ?? 'meadow' } })) {
      k.b.tag = 'houses';
      k.colliders.push(X0, X1, 0, 4.5, zf - d, zf);
      return;
    }
    house(k, X0, X1, zf, d, tav ? 3.6 : 2.5 + r * 0.4, {
      wall: tav ? 'wood' : r < 0.4 ? 'plaster' : r < 0.75 ? 'wood' : 'brick', timber: tav || (r >= 0.4 && r < 0.75), roofCol: ROOF[h.roof] ?? k.pal.roof,
      chimney: r > 0.3, lit: 0.65, shutters: r < 0.5 ? k.pal.sign : undefined, roof: 'x', ...(tav ? { floors: 2 } : {}),
    });
    if (tav) signF(k, 'ТРАКТИР', (X0 + X1) / 2, 2.25, zf, 1.8);
    k.colliders.push(X0, X1, 0, 4.5, zf - d, zf);
  });
  k.b.tag = '';
}
/** «РЫБНЫЕ РЯДЫ» → «Рыбные ряды» (sign atlas case). */
const signText = (s: string) => s.charAt(0) + s.slice(1).toLowerCase();

/* ------------------------------------------------------------------ props */
/** Standing height (m) on a site obstacle by its tag; Infinity = not climbable. */
const TOP: Record<string, number> = { bench: 0.46, flowers: 0.35, box: 0.45, pot: 0.42, crate: 0.54, barrel: 0.75, sack: 0.45, garden: 0.28, table: 0.72, picnic: 0.12, bush: 0.5, woodpile: 0.75, hay: 0.85, coal: 0.45, ore: 0.55, board: 0.6, reeds: 0.5, grind: 0.6, bucket: 0.35 };

/** The site's obstacles → solids (walk grid parity): rect as is, ellipse → inscribed box, polygon → 0.2 m rows. */
export function fairCatsSolids(k: Ctx, sc: FairCatsScene, obst: readonly any[], groundAt: (x: number, y: number) => number): void {
  const S = (k.solids ||= []);
  const pier = sc.pier;
  const BR = kitOf(sc)?.bridges.flatMap((b) => b.rects) ?? [];   // a Town Kit town: every bridge crosses its water
  const onPier = (x: number, y: number) => (x >= pier.x0 && x <= pier.x1 && y >= pier.y0 && y <= pier.y1) || (x >= pier.end[0] && x <= pier.end[2] && y >= pier.end[1] && y <= pier.end[3])
    || BR.some((q) => x >= q[0] && x <= q[2] && y >= q[1] && y <= q[3]);
  for (const o of obst) {
    const tag = String(o.tag || '');
    if (tag === 'jail' || tag === 'building:jail' || tag === 'building:mine') continue;   // the jail builder's own (cage floor)
    const tp = TOP[tag], top = (x: number, y: number) => (tp === undefined ? Infinity : groundAt(x, y) + tp);
    if (Array.isArray(o.r)) { const [x0, y0, x1, y1] = o.r; S.push(toX(x0), toX(x1), toZ(y0), toZ(y1), top((x0 + x1) / 2, y1)); continue; }
    if (Array.isArray(o.e)) { const [cx, cy, rx, ry] = o.e, a = 0.7; S.push(toX(cx - rx * a), toX(cx + rx * a), toZ(cy - ry * a), toZ(cy + ry * a), top(cx, cy)); continue; }
    if (Array.isArray(o.p)) {
      const P = o.p as P2[], ys = P.map((p) => p[1]);
      for (let y = Math.min(...ys) + 2; y < Math.max(...ys) - 2; y += 10) {
        const xs: number[] = [], yc = y + 5;
        for (let i = 0, j = P.length - 1; i < P.length; j = i++) {
          const a = P[i], b = P[j];
          if ((a[1] > yc) !== (b[1] > yc)) xs.push(a[0] + (yc - a[1]) * (b[0] - a[0]) / (b[1] - a[1]));
        }
        xs.sort((p, q) => p - q);
        for (let i = 0; i + 1 < xs.length; i += 2) {
          if (tag === 'water') {   // the pier crosses the pond: not water there
            let x = xs[i] + 2;
            for (let xx = x; xx <= xs[i + 1] - 2; xx += 4) { if (onPier(xx, yc) || BR.some((q) => xx >= q[0] && xx <= q[2] && y + 10 >= q[1] && y <= q[3])) { if (xx - 4 > x) S.push(toX(x), toX(xx - 4), toZ(y), toZ(y + 10), Infinity); x = xx + 4; } }
            if (xs[i + 1] - 2 > x) S.push(toX(x), toX(xs[i + 1] - 2), toZ(y), toZ(y + 10), Infinity);
          } else {
            // the stairs / ramp cross the cliff faces: their walkable part (between the rails) is cut out
            let a = xs[i] + 2;
            const b = xs[i + 1] - 2;
            for (const st of sc.stairs) {
              if (yc < st.y0 || yc > st.y1 || st.x1 - sc.rail < a || st.x0 + sc.rail > b) continue;
              if (st.x0 + sc.rail - 2 > a) S.push(toX(a), toX(st.x0 + sc.rail - 2), toZ(y), toZ(y + 10), Infinity);
              a = st.x1 - sc.rail + 2;
            }
            if (b > a) S.push(toX(a), toX(b), toZ(y), toZ(y + 10), Infinity);
          }
        }
      }
    }
  }
}

export function placeFairCatsProps(k: Ctx, L: FairCatsLayout, groundAt: (x: number, y: number) => number, lampHead: number): Placed {
  const sc = L.faircats, P = k.pal, lampHeads: number[] = [];
  const G = (x: number, y: number) => groundAt(x, y);
  const posts = new Set<string>();
  // trees next to a flight / the cart ramp stay smaller: their crowns never hang over the steps (the trunk stays on the
  // site's obstacle, so they are not moved)
  const TREEK = new Set(['tree', 'pine', 'blossom', 'bush']);
  const nearFlight = (x: number, y: number) => sc.stairs.some((s) => x > s.x0 - 150 && x < s.x1 + 150 && y > s.y0 - 90 && y < s.y1 + 90);
  for (const it1 of [...sc.items, ...gladeItems(sc.glade)]) {
    const it0 = it1.k === 'lamp' ? lampClear(k, it1, G, lampHead) : it1;
    if (!it0 || decorInBuilding(k, it0, G)) continue;   // no room for the lantern beside the roof over it / the model drew it
    const it = TREEK.has(it0.k) && nearFlight(it0.x, it0.y) ? { ...it0, s: (typeof it0.s === 'number' ? it0.s : 1) * 0.7 } : it0;
    const am = fcModelFor('i:' + it.k, !!kitOf(sc));
    if (am) {
      k.b.tag = 'prop:' + it.k;
      const vis = itemVis('i:' + it.k, it.x, it.y, !!kitOf(sc));
      const ok = buildModel(k, am, { vis, foot: vis, door: { x: it.x, y: it.y }, base: G(it.x, it.y), data: { ...it } });
      k.b.tag = '';
      if (ok) { if (it.k === 'lamp') lampHeads.push(toX(it.x), G(it.x, it.y) + lampHead, toZ(it.y - 3)); continue; }
    }
    placeItem(k, sc, it, G, lampHead, lampHeads, posts);
  }
  fcForest(k, L, groundAt);
  const kit = kitOf(sc);
  void P;
  k.b.tag = '';
  // the asset models built in this town are compared with the page's live art once, idle (fcart/live.ts)
  scheduleFcArtCheck(kit ? { kind: 'tk', id: kit.id, levels: kit.lvl, building: kit.build as Record<string, unknown> } : { kind: 'fc' });
  // wires the building builders collected (tent pennants, shop beams) → garland spans
  const garlands: THREE.Vector3[][] = [];
  for (let j = 0; j + 5 < k.wires.length; j += 6) garlands.push([new THREE.Vector3(k.wires[j], k.wires[j + 1], k.wires[j + 2]), new THREE.Vector3(k.wires[j + 3], k.wires[j + 4], k.wires[j + 5])]);
  return { garlands, lampHeads };
}

/* ------------------------------------------------------------------ the glade below the gate (site 12.11 afternoon) */
/** fc-map.js GLADE colours (tk-art.js P): grass, grassD, the forest's dark rim (forestD at .55 over the forest floor), path. */
const GLC = { grass: MEADOW, grassD: new THREE.Color(1.0, 1.12, 0.86), rim: '#3c6440', path: '#d9b383' };
/** Chaikin corner cutting (the site's smooth() of a wobbled outline, without the random wobble). */
function chaikin(p: readonly P2[], n = 2): P2[] {
  let a = p.slice() as P2[];
  for (let r = 0; r < n; r++) {
    const o: P2[] = [];
    for (let i = 0; i < a.length; i++) { const u = a[i], v = a[(i + 1) % a.length]; o.push([u[0] * 0.75 + v[0] * 0.25, u[1] * 0.75 + v[1] * 0.25], [u[0] * 0.25 + v[0] * 0.75, u[1] * 0.25 + v[1] * 0.75]); }
    a = o;
  }
  return a;
}
/** The outline pushed out by `d` px along the averaged vertex normals (the stroke's outer half). */
function grow(p: readonly P2[], d: number): P2[] {
  let area = 0; for (let i = 0; i < p.length; i++) { const a = p[i], b = p[(i + 1) % p.length]; area += a[0] * b[1] - b[0] * a[1]; }
  const sg = area > 0 ? 1 : -1;
  return p.map((c, i) => {
    const a = p[(i + p.length - 1) % p.length], b = p[(i + 1) % p.length], tx = b[0] - a[0], ty = b[1] - a[1], l = Math.hypot(tx, ty) || 1;
    return [c[0] + sg * ty / l * d, c[1] - sg * tx / l * d] as P2;
  });
}
const ellipse = (cx: number, cy: number, rx: number, ry: number, n = 20): P2[] => Array.from({ length: n }, (_, i) => [cx + Math.cos(i / n * Math.PI * 2) * rx, cy + Math.sin(i / n * Math.PI * 2) * ry] as P2);
/**
 * fc-art.js gladeGround: the glade outside the wall (dark forest rim 70 px, grassD, the inner grass scaled 0.94 / 0.9 from
 * (cx, 3010), a path-coloured patch in front of the gate) and each forest spot's own clearing (rim 56 px, grassD, grass ×0.86 /
 * 0.84, a patch where the pack stands). Flat on the forest floor (0 m), each layer 4 mm over the last. Not walkable.
 */
export function fcGlade(k: Ctx, g: FcGlade): void {
  const flat = (poly: P2[], y: number, mat: Parameters<Ctx['b']['add']>[0], col: THREE.ColorRepresentation, uv: number) => { const geo = polyGeo(poly, y); k.b.add(mat, geo, M(0, 0, 0), col, uv); geo.dispose(); };
  const patch = (cx: number, cy: number, rx: number, ry: number, y: number, a: number) => flat(chaikin(ellipse(cx, cy, rx * 0.92, ry * 0.92, 14), 1), y, 'flat', mixHexW(GLC.path, '#83ad5c', 1 - a), 1);
  // layers 5 mm apart from 12 mm (over the lanes' 6 mm top); neighbouring clearings overlap, so every other spot (by x) and
  // the patches inside the glade sit one band (26 mm) higher — no two overlapping surfaces closer than the z-fight tolerance
  const yOf = (i: number, band = 0) => 0.012 + 0.005 * i + 0.026 * band;
  const edge = chaikin(g.poly, 2);
  flat(grow(edge, 35), yOf(0), 'lowPaving', GLC.rim, 2.4);
  flat(edge, yOf(1), 'lowPaving', GLC.grassD, 2.4);
  flat(chaikin(g.poly.map(([x, y]) => [g.cx + (x - g.cx) * 0.94, 3010 + (y - 3010) * 0.9] as P2), 2), yOf(2), 'lowPaving', GLC.grass, 2.4);
  patch(2880, 3046, 250, 46, yOf(3), 0.7);
  const order = g.spots.map((p, i) => [p.x, i] as const).sort((a, b) => a[0] - b[0]), band = new Map(order.map(([, i], j) => [i, 1 + (j % 2)]));
  g.spots.forEach((p, i) => {
    const bd = p.poly && p.poly.length > 2 ? band.get(i)! : 2;
    if (p.poly && p.poly.length > 2) {
      const e = chaikin(p.poly, 2), mid = p.poly.map(([x, y]) => [p.x + (x - p.x) * 0.86, p.y + 10 + (y - p.y - 10) * 0.84] as P2);
      flat(grow(e, 28), yOf(0, bd), 'lowPaving', GLC.rim, 2.4);
      flat(e, yOf(1, bd), 'lowPaving', GLC.grassD, 2.4);
      flat(chaikin(mid, 2), yOf(2, bd), 'lowPaving', GLC.grass, 2.4);
    }
    patch(p.x, p.y - 18, p.t === 'e' ? 120 : 150, 46, yOf(3, bd), 0.5);
    patch(p.x + 6, p.y - 14, 80, 22, yOf(4, bd), 0.32);
  });
}
/** Hex mix (a · (1 − t) + b · t). */
function mixHexW(a: string, b: string, t: number): string { return '#' + new THREE.Color(a).lerp(new THREE.Color(b), t).getHexString(); }
/** The glade's signpost «В ПОХОД» (fc-art.js south list) and its front trees (GLADE.front) as decor items. */
export function gladeItems(g: FcGlade | undefined): FcItem[] {
  if (!g) return [];
  return [{ k: 'signpost', x: g.sign[0], y: g.sign[1], to: [['В ПОХОД', 'S']] }, ...g.front.map(([kd, x, y, s]) => ({ k: kd, x, y, s }))];
}

/* ------------------------------------------------------------------ the forest round the clearing */
/**
 * The town is a clearing in a dense forest (fc-art.js forest(): every free cell of the map outside the town polygon, the
 * mountain and the plateau is a dark tree, 30 % pines): a jittered 2 × 2 m grid outside the town polygon, dense at the
 * edge (the trees you see), thinning out to ≈ 26 m; the city wall's band, the gate road and the walk area stay free.
 * Two instanced kinds (fc:foak / fc:fpine, 4 draw calls). Pines on the mountain top (fc-art.js mountain()). Town Kit
 * towns: the biome's mix (none in the desert, pines in the north).
 */
export function fcForest(k: Ctx, L: FairCatsLayout, groundAt: (x: number, y: number) => number): number {
  const sc = L.faircats, kit = kitOf(sc), town = sc.town;
  if (town.length < 3) return 0;
  const biome = kit?.biome ?? 'meadow';
  if (biome === 'desert') return 0;
  const pineShare = ['ice', 'tundra', 'north', 'snow', 'mountain'].includes(biome) ? 0.8 : biome === 'ash' || biome === 'blight' ? 0.5 : 0.3;
  k.b.tag = 'forest';
  let seed = 977;
  const rnd = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
  const rocks = kit ? kit.rocks.map((r) => r.poly) : [sc.mount];
  const water = kit ? kit.water.map((w) => w.poly) : [sc.pond];
  const edges: [number, number, number, number][] = [];
  for (let i = 0, j = town.length - 1; i < town.length; j = i++) edges.push([toX(town[j][0]), toZ(town[j][1]), toX(town[i][0]), toZ(town[i][1])]);
  const distTown = (X: number, Z: number) => {
    let d = Infinity;
    for (const [ax, az, bx, bz] of edges) {
      const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz, t = l2 ? Math.max(0, Math.min(1, ((X - ax) * dx + (Z - az) * dz) / l2)) : 0;
      d = Math.min(d, Math.hypot(X - ax - dx * t, Z - az - dz * t));
    }
    return d;
  };
  const W = sc.wall, wallOk = [W.x0, W.x1, W.y0, W.y1].every(Number.isFinite), gx = wallOk ? (W.gate[0] + W.gate[1]) / 2 : NaN;
  const xs = town.map((p) => p[0]), ys = town.map((p) => p[1]);
  const x0 = Math.min(...xs) - 2600, x1 = Math.max(...xs) + 2600, y0 = Math.min(...ys) - 1300, y1 = Math.max(...ys) + 1250;
  let n = 0;
  for (let y = y0, row = 0; y < y1; y += 100, row++) for (let x = x0 + (row % 2) * 100; x < x1; x += 200) {
    const px = x + (rnd() - 0.5) * 120, py = y + (rnd() - 0.5) * 60, r1 = rnd(), r2 = rnd(), r3 = rnd();
    if (inPoly(town, px, py) || rocks.some((r) => inPoly(r, px, py)) || water.some((w) => w.length > 2 && inPoly(w, px, py))) continue;
    if (inGlade(sc.glade, px, py)) continue;   // fc-art.js forest(): no tree in the glade / a monster spot's clearing (12.11)
    const X = toX(px), Z = toZ(py), d = distTown(X, Z);
    if (d > 26 || r1 > (d < 5 ? 1 : d < 11 ? 0.5 : d < 18 ? 0.28 : 0.16)) continue;
    if (wallOk && py > W.y0 - 80 && py < W.y1 + 150 && px > W.x0 - 80 && px < W.x1 + 80) continue;   // the wall's band
    if (wallOk && Math.abs(px - gx) < 190 && py > W.y0 - 40) continue;                              // the gate road out
    if (L.free(px, py) || L.free(px + 40, py) || L.free(px - 40, py) || L.free(px, py + 30) || L.free(px, py - 30)) continue;
    if (sc.stairs.some((st) => px > st.x0 - 150 && px < st.x1 + 150 && py > st.y0 - 60 && py < st.y1 + 60)) continue;   // crowns off the flights / the cart ramp
    const pine = r2 < pineShare, s = (pine ? 1.15 : 1.0) * (0.85 + r3 * 0.55) * (d > 12 ? 1.25 : 1);
    k.inst.add(pine ? 'fc:fpine' : 'fc:foak', X, groundAt(px, py) - 0.05, Z, r1 * 40, s, s * (0.9 + r2 * 0.25));
    n++;
  }
  // pines on the mountain top (fc-art.js mountain(): its trees stand on the top, away from the face)
  if (!kit && sc.mount.length >= 3 && sc.mrim.length >= 2) {
    const topY = FC_H + FC_MH, mx0 = Math.min(...sc.mount.map((p) => p[0])), placed: number[] = [];
    for (let i = 0; i < 46; i++) {
      const px = mx0 + 60 + rnd() * (sc.W - mx0 - 100), py = 180 + rnd() * 560;
      if (!inPoly(sc.mount, px, py) || py > rimY(sc.mrim, px) - 60 || (Math.abs(px - 4925) < 220 && py > rimY(sc.mrim, px) - 160)) continue;
      const s = 0.8 + rnd() * 0.5, rot = rnd() * 6.28, X = toX(px), Z = toZ(py);
      let near = false;   // crowns (r 1.0 × s) apart: two pines never stand in each other
      for (let j = 0; j < placed.length; j += 3) if (Math.hypot(X - placed[j], Z - placed[j + 1]) < (s + placed[j + 2]) * 0.9) { near = true; break; }
      if (near) continue;
      placed.push(X, Z, s);
      k.inst.add('fc:fpine', X, topY - 0.05, Z, rot, s, s);
      n++;
    }
  }
  k.b.tag = '';
  return n;
}

function placeItem(k: Ctx, sc: FairCatsScene, it: FcItem, G: (x: number, y: number) => number, lampHead: number, lampHeads: number[], posts: Set<string>): void {
  const P = k.pal, x = it.x, y = it.y, X = toX(x), Z = toZ(y), g = G(x, y), s = typeof it.s === 'number' ? it.s : 1, rot = hash(x, y) * 6.28;
  k.b.tag = 'prop:' + it.k;
  switch (it.k) {
    case 'tree': k.inst.add(VK.tree, X, g, toZ(y - 4), rot, 1.15 * s); break;
    case 'blossom': k.inst.add('fc:blossom', X, g, toZ(y - 4), rot, 1.1 * s); break;
    case 'pine': k.inst.add('fc:pine', X, g, toZ(y - 4), rot, 1.05 * s); break;
    case 'bush': k.inst.add(VK.bush, X, g, toZ(y - 10), rot, 0.9); break;
    case 'lamp': k.inst.add('fc:lamp', X, g, toZ(y - 3), 0, 1); lampHeads.push(X, g + lampHead, toZ(y - 3)); break;
    case 'well': k.inst.add('well', X, g, toZ(y - 34), 0, 1.15); break;
    case 'bench': k.inst.add('bench', X, g, toZ(y - 11), 0, 0.72); break;
    case 'wagon': case 'haycart': {
      // a plain plank wagon (batched, ≈ 150 tris): the prop kit's cart is kept for the three market carts on the plaza
      const zc = toZ(y - (it.k === 'haycart' ? 30 : 26)), hl = it.k === 'haycart' ? 0.85 : 0.6, hd = 0.42;
      box(k, 'wood', P.wood, X - hl, X + hl, g + 0.32, g + 0.62, zc - hd, zc + hd, 0.5);
      box(k, 'wood', P.woodD, X - hl - 0.02, X + hl + 0.02, g + 0.58, g + 0.66, zc - hd - 0.02, zc + hd + 0.02, 0.5);
      for (const [wx, wz] of [[-hl * 0.6, -hd - 0.04], [hl * 0.6, -hd - 0.04], [-hl * 0.6, hd + 0.04], [hl * 0.6, hd + 0.04]]) k.b.add('wood', GEO.cyl8, M(X + wx, g + 0.26, zc + wz, 0.52, 0.06, 0.52, Math.PI / 2, 0, 0), P.woodD, 0.5);
      if (it.k === 'haycart') k.b.add('canvas', ICO1, M(X, g + 0.82, zc, 1.5, 0.55, 0.75), '#e8c45a', 1);
      if (it.ore) for (let i = 0; i < 5; i++) lump(k, 'rock', i % 2 ? '#c8a050' : P.rockD, X - 0.3 + i * 0.15, g + 0.7, zc + (i % 2) * 0.12 - 0.06, 0.13);
      break;
    }
    case 'cart': {
      // a market cart (batched, ≈ 250 tris): a plank box on two wheels, the goods heaped on it, a striped canopy on poles
      const zc = toZ(y - 26), hl = 0.62, hd = 0.4, goods = String(it.goods || ''), GC: Record<string, string[]> = { milk: ['#f4f0e6', '#d8e0f0'], fish: ['#8ab0c8', '#c8d8e0'], yarn: ['#e86a8a', '#7fb0e8', '#ffd84d'] };
      const gc = GC[goods] ?? ['#d8a050', '#c86a3a'];
      box(k, 'wood', P.woodL, X - hl, X + hl, g + 0.36, g + 0.7, zc - hd, zc + hd, 0.5);
      box(k, 'wood', P.woodD, X - hl - 0.02, X + hl + 0.02, g + 0.66, g + 0.74, zc - hd - 0.02, zc + hd + 0.02, 0.5);
      for (const wz of [-hd - 0.05, hd + 0.05]) k.b.add('wood', GEO.cyl8, M(X, g + 0.32, zc + wz, 0.64, 0.06, 0.64, Math.PI / 2, 0, 0), P.woodD, 0.5);
      for (let i = 0; i < 6; i++) lump(k, 'flat', gc[i % gc.length], X - 0.42 + (i % 3) * 0.42, g + 0.84 + (i >= 3 ? 0.08 : 0), zc + (i >= 3 ? 0.12 : -0.12), 0.15);
      for (const [px, pz] of [[-hl + 0.05, -hd + 0.05], [hl - 0.05, -hd + 0.05], [-hl + 0.05, hd - 0.05], [hl - 0.05, hd - 0.05]]) box(k, 'wood', P.woodD, X + px - 0.03, X + px + 0.03, g + 0.74, g + 1.75, zc + pz - 0.03, zc + pz + 0.03, 0.5);
      rbox(k, 'canvas', goods === 'fish' ? '#5a8ac8' : goods === 'yarn' ? '#c84a6a' : '#e8c45a', X, g + 1.85, zc, hl * 2 + 0.25, 0.06, hd * 2 + 0.3, 0, 0.12, 0, 1);
      break;
    }
    case 'flowers': {
      // a flower bed: low soil ellipse + leafy lumps + blossoms (batched, ≈ 200 tris)
      const w = toX(+(it.w as number) || 90), zc = toZ(y - 10), FL = ['#ff8fa3', '#ffd84d', '#c8a8ff', '#fff2e0', '#ff7f9a'];
      k.b.add('wood', GEO.cyl8, M(X, g + 0.06, zc, w, 0.12, 0.6, 0, 0, 0), P.woodD, 0.5);
      for (let i = 0; i < 4; i++) lump(k, 'leaf', i % 2 ? P.leaf : P.leafD, X - w * 0.36 + i * w * 0.24, g + 0.18, zc + (i % 2 ? 0.06 : -0.06), 0.16, 0.8);
      for (let i = 0; i < 5; i++) lump(k, 'flat', FL[(i + Math.round(x)) % FL.length], X - w * 0.4 + i * w * 0.2, g + 0.32, zc + ((i * 37) % 3 - 1) * 0.08, 0.06);
      break;
    }
    case 'signpost': case 'minesign': k.inst.add('signpost', X, g, toZ(y - 3), -0.4 + hash(x, 1) * 0.8, it.k === 'minesign' ? 0.85 : 1); break;
    case 'box': {
      box(k, 'wood', '#c8a070', X - 0.3, X + 0.3, g, g + 0.42, toZ(y - 34), toZ(y) - 0.02, 0.5);
      box(k, 'flat', '#3a2a22', X - 0.24, X + 0.24, g + 0.426, g + 0.43, toZ(y - 30), toZ(y) - 0.06);
      lump(k, 'plaster', it.cat === 'sleep' ? '#f0a050' : '#5a5a6a', X, g + 0.45, toZ(y - 17), 0.17, 0.6);   // a cat curled in the box
      break;
    }
    case 'pot': cyl(k, 'brick', '#c06a40', X, g, toZ(y - 8), 0.22, 0.38, 12, 0.5); k.inst.add(VK.bush, X, g + 0.3, toZ(y - 8), rot, 0.5); break;
    case 'crate': {
      const n = Math.max(1, +(it.n as number) || 1);
      // 0.62 m apart, turned ≤ ±0.1 rad: the 0.55 m crates never cut into each other (they stood 0.3 m apart)
      for (let i = 0; i < n; i++) k.inst.add(VK.crate, X + (i % 3) * 0.62 - (Math.min(n, 3) - 1) * 0.31, g + (i >= 3 ? 0.54 : 0), toZ(y - 18) + (i % 2) * 0.04, ((i * 0.37) % 0.6 - 0.3) / 3, 0.9);
      break;
    }
    case 'barrel': k.inst.add(VK.barrel, X, g, toZ(y - 10), rot, it.water ? 1.05 : 0.95); break;
    case 'laundry': {
      const X2 = toX(+(it.x2 as number)), Z2 = toZ(+(it.y2 as number)), g2 = G(+(it.x2 as number), +(it.y2 as number));
      for (const [px, pz, pg] of [[X, Z, g], [X2, Z2, g2]]) cyl(k, 'wood', P.woodD, px, pg, pz, 0.05, 1.9, 8, 0.5);
      const n = Math.max(2, Math.floor(Math.hypot(X2 - X, Z2 - Z) / 0.45)), cols = ['#f0e6d0', '#ff8fa3', '#7fb0e8', '#ffd84d', '#9fe39a'];
      for (let i = 1; i < n; i++) {
        const t = i / n, px = X + (X2 - X) * t, pz = Z + (Z2 - Z) * t, py = g + 1.82 - Math.sin(Math.PI * t) * 0.18;
        rbox(k, 'flat', cols[i % cols.length], px, py - 0.22, pz, 0.3, 0.4, 0.015, -Math.atan2(Z2 - Z, X2 - X));
      }
      rbox(k, 'metal', '#ddd', (X + X2) / 2, g + 1.8, (Z + Z2) / 2, Math.hypot(X2 - X, Z2 - Z), 0.012, 0.012, -Math.atan2(Z2 - Z, X2 - X));
      break;
    }
    case 'fence': {
      const x2 = +(it.x2 as number), y2 = +(it.y2 as number), X2 = toX(x2), Z2 = toZ(y2), len = Math.hypot(X2 - X, Z2 - Z), n = Math.max(1, Math.round(len / 0.7));
      for (let i = 0; i <= n; i++) { const t = i / n, key = `${Math.round((X + (X2 - X) * t) * 50)},${Math.round((Z + (Z2 - Z) * t) * 50)}`; if (posts.has(key)) continue; posts.add(key); box(k, 'wood', P.woodD, X + (X2 - X) * t - 0.05, X + (X2 - X) * t + 0.05, g, g + 0.8, Z + (Z2 - Z) * t - 0.05, Z + (Z2 - Z) * t + 0.05, 0.5); }
      const hj = hash(x, y) * 0.04;   // fences meeting at a corner: their rails at slightly different heights (no coplanar tops)
      for (const h of [0.35, 0.65]) rbox(k, 'wood', P.wood, (X + X2) / 2, g + h + hj, (Z + Z2) / 2, len, 0.07, 0.04, -Math.atan2(Z2 - Z, X2 - X), 0, 0, 0.5);
      break;
    }
    case 'dummy': k.inst.add(VK.dummy, X, g, toZ(y - 6), 0, 0.9); break;   // the site's ellipse (OBST) is its solid
    case 'target': {
      cyl(k, 'wood', P.woodD, X - 0.25, g, Z, 0.04, 1.0, 8, 0.5); cyl(k, 'wood', P.woodD, X + 0.25, g, Z, 0.04, 1.0, 8, 0.5);
      for (const [r, c, dz] of [[0.42, '#f0e6d0', 0], [0.3, '#c8402a', 0.012], [0.16, '#f0e6d0', 0.024], [0.07, '#c8402a', 0.036]] as [number, string, number][])
        k.b.add('flat', GEO.cyl16, M(X, g + 0.95, Z + 0.06 + dz, r * 2, 0.004, r * 2, Math.PI / 2, 0, 0), c, 1);
      break;
    }
    case 'post': cyl(k, 'wood', P.woodD, X, g, toZ(y - 6), 0.1, 1.1, 8, 0.5); if (it.c) lump(k, 'flat', '#c8402a', X, g + 1.15, toZ(y - 6), 0.08); break;
    case 'sandpit': { const rx = toX(+(it.rx as number) || 100), rz = (+(it.ry as number) || 30) * SZ; k.b.add('flat', GEO.cyl16, M(X, g + 0.012, Z, rx * 2, 0.008, rz * 2), '#d8b878', 1); break; }
    case 'coal': for (let i = 0; i < 6; i++) lump(k, 'rock', '#2a2630', X - 0.4 + (i % 3) * 0.4, g + 0.12 + (i >= 3 ? 0.18 : 0), toZ(y - 18) + (i % 2) * 0.1, 0.22); break;
    case 'woodpile': for (let r = 0; r < 3; r++) for (let i = 0; i < 6 - r; i++) k.b.add('wood', GEO.cyl8, M(X - 0.6 + (i + r * 0.5) * 0.24, g + 0.12 + r * 0.22, toZ(y - 20), 0.22, 1.1, 0.22, Math.PI / 2, 0, 0), i % 2 ? P.wood : P.woodD, 0.5); break;
    case 'grind': {   // the stone on an axle between two posts (it used to sit 26 % deep in a crate: a half disc)
      const zg = toZ(y - 10), ya = g + 0.3 + 0.375 + 0.02;
      for (const s2 of [-1, 1]) box(k, 'wood', P.woodD, X + s2 * 0.2 - 0.04, X + s2 * 0.2 + 0.04, g, ya + 0.05, zg - 0.06, zg + 0.06, 0.5);
      k.b.add('metal', GEO.cyl8, M(X, ya, zg, 0.05, 0.31, 0.05, 0, 0, Math.PI / 2), '#5a5e6a', 0.5);
      k.b.add('stone', GEO.cyl16, M(X, ya, zg, 0.75, 0.16, 0.75, 0, 0, Math.PI / 2), '#8a8a96', 0.6);
      break;
    }
    case 'bucket': cyl(k, 'wood', P.wood, X, g, toZ(y - 6), 0.13, 0.26, 8, 0.4); break;
    case 'haystack': k.b.add('canvas', GEO.dome, M(X, g, toZ(y - 24), 1.4, 1.0, 1.2), '#e8c45a', 1); break;
    case 'sack': { const n = Math.max(1, +(it.n as number) || 1); for (let i = 0; i < n; i++) lump(k, 'canvas', it.ore ? '#a08868' : '#d8c8a0', X - 0.15 + i * 0.25, g + 0.2, toZ(y - 15), 0.22, 1.1); break; }
    case 'lotboard': box(k, 'wood', P.woodL, X - 0.55, X + 0.55, g + 0.3, g + 0.6, toZ(y - 8), toZ(y - 4), 0.5); for (const d of [-0.45, 0.45]) box(k, 'wood', P.woodD, X + d - 0.04, X + d + 0.04, g, g + 0.58, toZ(y - 8) + 0.01, toZ(y - 4) - 0.01, 0.5); break;
    case 'jailyard': k.inst.add('bench', toX(x - 195), g, toZ(y + 10), 0, 0.7); break;
    case 'garden': {
      const w = toX(+(it.w as number) || 150), d = (+(it.h as number) || 100) * SZ;
      box(k, 'wood', P.woodD, X - w / 2, X + w / 2, g - 0.05, g + 0.12, toZ(y) - d, toZ(y), 0.5);
      for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) lump(k, 'leaf', r % 2 ? P.leaf : '#7aa84a', X - w / 2 + w * (c + 0.5) / 4, g + 0.2, toZ(y) - d + d * (r + 0.5) / 4, 0.13, 0.8);
      break;
    }
    case 'mailbox': cyl(k, 'wood', P.woodD, X, g, toZ(y - 3), 0.04, 0.9, 8, 0.5); box(k, 'metal', '#3e5aa8', X - 0.14, X + 0.14, g + 0.9, g + 1.1, toZ(y - 3) - 0.1, toZ(y - 3) + 0.1, 0.5); break;
    case 'tables': for (const dx of [-95, 95]) { const tx = toX(x + dx); box(k, 'wood', P.woodL, tx - 0.5, tx + 0.5, g + 0.68, g + 0.74, toZ(y - 40), toZ(y), 0.5); for (const [ax, az] of [[-0.42, 0.1], [0.42, 0.1], [-0.42, 0.7], [0.42, 0.7]]) box(k, 'wood', P.woodD, tx + ax - 0.04, tx + ax + 0.04, g, g + 0.68, toZ(y - 40) + az - 0.04, toZ(y - 40) + az + 0.04, 0.5); } break;
    case 'reeds': for (let i = 0; i < 7; i++) { const a = i * 0.9 + x, r = 0.1 + (i % 3) * 0.08; cone(k, 'leaf', i % 2 ? P.leaf : '#7a9a4a', X + Math.cos(a) * r, g - 0.1, toZ(y - 8) + Math.sin(a) * r * 0.6, 0.04, 0.8 + (i % 3) * 0.2); } break;
    case 'picnic': k.b.add('flat', GEO.plane, M(X, g + 0.01, toZ(y - 23), 1.5, 0.9, 1, -Math.PI / 2, 0, 0), '#d85a6a', 1); cyl(k, 'wood', '#c8a070', X + 0.4, g, toZ(y - 23), 0.16, 0.22, 8, 0.4); break;
    case 'telescope': for (let i = 0; i < 3; i++) rbox(k, 'wood', P.woodD, X + Math.cos(i * 2.1) * 0.15, g + 0.4, toZ(y - 10) + Math.sin(i * 2.1) * 0.15, 0.04, 0.85, 0.04, 0, Math.cos(i * 2.1) * 0.25, Math.sin(i * 2.1) * 0.25); rbox(k, 'metal', '#c9a33a', X, g + 0.95, toZ(y - 10), 0.12, 0.12, 0.8, 0.4, -0.6, 0, 0.5); break;
    case 'rock': k.b.add('rock', ICO1, M(X, g + 0.05, toZ(y - 12), 1.0 * s, 0.6 * s, 0.85 * s, 0, rot, 0), shade(P.rock, hash(x, y) * 0.2 - 0.1), 1.2); break;
    case 'orepile': for (let i = 0; i < 7; i++) lump(k, 'rock', i % 3 ? P.rockD : '#c8a050', X - 0.45 + (i % 4) * 0.3, g + 0.15 + (i >= 4 ? 0.2 : 0), toZ(y - 20) + (i % 2) * 0.15, 0.24); break;
    case 'picks': for (const a of [-0.5, 0.5]) { rbox(k, 'wood', P.woodD, X, g + 0.4, toZ(y - 8) + a * 0.03, 0.05, 0.9, 0.05, 0, 0, a); } rbox(k, 'metal', '#8a8e9e', X, g + 0.82, toZ(y - 8), 0.5, 0.06, 0.06); break;
    default: break;
  }
  k.b.tag = '';
}
