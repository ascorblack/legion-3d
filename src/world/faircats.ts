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
import type { FairCatsScene, FairCatsLayout, FcItem } from '../net/faircats';
import { fairCatsOf, inPoly, rimY } from '../net/faircats';
import { toX, toZ, SX, SZ } from './coords';
import { GEO, M } from './batch';
import { type Ctx, box, rbox, cyl, ball, cone, shade } from './kit';
import { buildBuilding, house, signF, BUILDING_XF } from './buildings';
import { buildAtDepth, VK } from './village';
import { FC_H, FC_MH, FC_PIER, FC_POND, plateauX0 } from './fcground';
import { JAIL_GEO } from './jail';
import { jailGeoOf } from '../net/jail';
import type { Placed } from './place';
import { part } from './instancer';
import { LAMP_HEAD_Y } from './protoProps';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export { fairCatsOf };
type P2 = [number, number];
const LOW_IDS = new Set(['storage', 'mine', 'mineboard', 'jail']);
/** Model heights (px of the 2D art above the base) of the old fair — the street models are tuned to them. */
const OLD_H: Record<string, number> = { hall: 500, auction: 420, trainer: 440, board: 330, anvil: 200, forge: 570, gate: 560, tent: 580, shop: 500, magic: 650 };
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
  const bx = new THREE.BoxGeometry(1, 1, 1), c4 = new THREE.ConeGeometry(0.5, 1, 4);
  const LH = LAMP_HEAD_Y;
  k.inst.registerKind('fc:lamp', [
    { mat: 'metal', castShadow: true, geo: mg([part(cyl6, P.metal, 0, 0.09, 0, 0.34, 0.18, 0.34), part(cyl6, P.metal, 0, LH / 2, 0, 0.09, LH, 0.09),
      part(bx, P.metal, 0, LH - 0.2, 0, 0.3, 0.05, 0.3), part(c4, P.metal, 0, LH + 0.3, 0, 0.42, 0.22, 0.42, 0, Math.PI / 4, 0), part(cyl6, '#ffcf4a', 0, 1.1, 0, 0.14, 0.05, 0.14)]) },
    { mat: 'emit', geo: mg([part(bx, '#ffe2a0', 0, LH, 0, 0.2, 0.32, 0.2)]) },
  ]);
  cone8.dispose(); cyl6.dispose(); ico.dispose(); bx.dispose(); c4.dispose();
}

/* ------------------------------------------------------------------ helpers */
const zOf = (y: number) => toZ(y);
/** A horizontal polygon (px) at height y as a ShapeGeometry in world metres (holes optional). */
function polyGeo(poly: readonly P2[], y: number, holes: (readonly P2[])[] = []): THREE.BufferGeometry {
  const sh = new THREE.Shape(poly.map(([px, py]) => new THREE.Vector2(toX(px), -toZ(py))));
  for (const h of holes) sh.holes.push(new THREE.Path(h.map(([px, py]) => new THREE.Vector2(toX(px), -toZ(py)))));
  const g = new THREE.ShapeGeometry(sh);
  g.rotateX(-Math.PI / 2); g.translate(0, y, 0);
  return g;
}
/** A strip of quads between two polylines (world points), each [x, y, z]; faces towards `out` (the strip's normal side). */
function stripGeo(top: number[][], bot: number[][]): THREE.BufferGeometry {
  const pos: number[] = [];
  for (let i = 0; i + 1 < top.length; i++) {
    const a = top[i], b = top[i + 1], c = bot[i + 1], d = bot[i];
    pos.push(...a, ...d, ...b, ...b, ...d, ...c);
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.computeVertexNormals();
  return g;
}
/** Low-poly lumps (20 / 80 tris) for small round props and rocks — a UV sphere is 192. */
const ICO0 = new THREE.IcosahedronGeometry(0.5, 0), ICO1 = new THREE.IcosahedronGeometry(0.5, 1);
const lump = (k: Ctx, mat: Parameters<Ctx['b']['add']>[0], col: string, x: number, y: number, z: number, r: number, sy = 1) => k.b.add(mat, ICO0, M(x, y, z, r * 2, r * 2 * sy, r * 2, 0, (x * 7.3 + z * 3.1 + y * 5.7) % 6.28, 0), col, 1);
const hash = (x: number, y: number) => { const h = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453; return h - Math.floor(h); };

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
  { const g = polyGeo([[-FAR, NORTH], [W + FAR, NORTH], [W + FAR, sc.H + 2200], [-FAR, sc.H + 2200]], 0, [sc.pond]); k.b.add('lowPaving', g, M(0, 0, 0), '#ffffff', 2.4); g.dispose(); }
  // ---- plateau top (FC_H)
  k.b.tag = 'terrain:plateau';
  { const poly: P2[] = [[X0, NORTH], [W + FAR, NORTH], ...rimFull.slice().reverse()]; const g = polyGeo(poly, FC_H); k.b.add('lowPaving', g, M(0, 0, 0), '#e6f0dc', 2.4); g.dispose(); }
  // ---- rock bank under the rim: rim (FC_H) → rim + FACE (0), with a bulging middle row
  k.b.tag = 'terrain:bank';
  {
    const top: number[][] = [], mid: number[][] = [], bot: number[][] = [];
    for (let i = 0; i + 1 < rimFull.length; i++) {
      const a = rimFull[i], b = rimFull[i + 1], n = Math.max(1, Math.ceil((b[0] - a[0]) / 70));
      for (let j = i ? 1 : 0; j <= n; j++) {
        const x = a[0] + (b[0] - a[0]) * j / n, r = a[1] + (b[1] - a[1]) * j / n, X = toX(x), jit = hash(x, 1) - 0.5;
        top.push([X, FC_H + 0.02, zOf(r)]);
        mid.push([X, FC_H * (0.5 + jit * 0.12), zOf(r + sc.face * 0.5) + 0.25 + jit * 0.35]);
        bot.push([X, -0.05, zOf(r + sc.face) + 0.05]);
      }
    }
    const g1 = stripGeo(top, mid), g2 = stripGeo(mid, bot);
    k.b.add('rock', g1, M(0, 0, 0), P.rock, 1.6); k.b.add('rock', g2, M(0, 0, 0), shade(P.rock, -0.08), 1.6); g1.dispose(); g2.dispose();
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
    const g = polyGeo([[mx0, NORTH], ...edge.slice(1), [W + FAR, NORTH]].reverse() as P2[], topY); k.b.add('rock', g, M(0, 0, 0), shade(P.rock, 0.05), 2); g.dispose();
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
    const gf = stripGeo(t, b); k.b.add('rock', gf, M(0, 0, 0), P.rock, 1.6); gf.dispose();
    // crags on top (silhouette) and a few far peaks
    for (let i = 0; i < 9; i++) {
      const x = mx0 + 180 + i * 260 + hash(i, 5) * 120, y = Math.min(rimY(sc.mrim, x) - 140, 600) - hash(i, 6) * 350, s = 1.2 + hash(i, 8) * 1.4;
      k.b.add('rock', ICO1, M(toX(x), topY + s * 0.2, zOf(y), s * 2.4, s * 1.5, s * 2.0, hash(i, 1), hash(i, 2) * 3, 0), shade(P.rock, hash(i, 3) * 0.16 - 0.08), 2);
    }
  }
  // ---- stairs and the cart ramp
  k.b.tag = 'terrain:stairs';
  for (const s of sc.stairs) {
    const r = rimY(sc.rim, (s.x0 + s.x1) / 2), x0 = toX(s.x0), x1 = toX(s.x1), rl = toX(sc.rail);
    if (s.k === 'ramp') {
      const z0 = zOf(r), z1 = zOf(Math.min(s.y1, r + sc.face)), len = Math.hypot(z1 - z0, FC_H), ang = Math.atan2(FC_H, z1 - z0);
      rbox(k, 'wood', P.woodL, (x0 + x1) / 2, FC_H / 2 - 0.09, (z0 + z1) / 2, x1 - x0 - 0.1, 0.16, len, 0, ang, 0, 0.6);
      for (const x of [x0 + 0.06, x1 - 0.06]) rbox(k, 'wood', P.woodD, x - 0.002, FC_H / 2 + 0.04, (z0 + z1) / 2, 0.12, 0.3, len + 0.01, 0, ang, 0, 0.6);
      continue;
    }
    const n = Math.max(6, Math.round(FC_H / 0.2)), y1 = Math.min(s.y1, r + sc.face);
    for (let i = 0; i < n; i++) {
      const za = zOf(r + (y1 - r) * i / n), zb = zOf(r + (y1 - r) * (i + 1) / n), top = FC_H * (1 - (i + 0.5) / n);
      box(k, 'stone', P.stone, x0 + rl, x1 - rl, -0.05, top, za, zb, 0.8);
    }
    // cheek walls: one slab per side along the flight (top 0.45 m over the steps), a block at the top
    { const z0 = zOf(r), z1 = zOf(y1), len = Math.hypot(z1 - z0, FC_H), ang = Math.atan2(FC_H, z1 - z0);
      for (const xc of [x0 + rl / 2, x1 - rl / 2]) rbox(k, 'stone', shade(P.stone, -0.18), xc, FC_H / 2 + 0.1, (z0 + z1) / 2, rl, 0.9, len, 0, ang, 0, 0.8); }
    for (const x of [x0 + rl / 2, x1 - rl / 2]) { cyl(k, 'stone', shade(P.stone, -0.25), x, FC_H, zOf(r) + 0.05, 0.13, 0.75, 8, 0.6); ball(k, 'emit', '#ffcf4a', x, FC_H + 0.86, zOf(r) + 0.05, 0.1); k.glows.push(x, FC_H + 0.86, zOf(r) + 0.05, 0.6, 1, 0.75, 0.4); }
  }
  // cart rails from the mine down the ramp
  k.b.tag = 'terrain:rails';
  for (let i = 0; i + 1 < sc.rails.length; i++) {
    const a = sc.rails[i], b = sc.rails[i + 1], n = Math.max(1, Math.ceil(Math.hypot(toX(b[0] - a[0]), zOf(b[1]) - zOf(a[1])) / 0.6));
    for (let j = 0; j < n; j++) {
      const pa: P2 = [a[0] + (b[0] - a[0]) * j / n, a[1] + (b[1] - a[1]) * j / n], pb: P2 = [a[0] + (b[0] - a[0]) * (j + 1) / n, a[1] + (b[1] - a[1]) * (j + 1) / n];
      const ya = groundAt(pa[0], pa[1]), yb = groundAt(pb[0], pb[1]), X = (toX(pa[0]) + toX(pb[0])) / 2, Z = (zOf(pa[1]) + zOf(pb[1])) / 2;
      const dx = toX(pb[0]) - toX(pa[0]), dz = zOf(pb[1]) - zOf(pa[1]), len = Math.hypot(dx, dz, yb - ya), yaw = -Math.atan2(dz, dx), pitch = Math.atan2(yb - ya, Math.hypot(dx, dz));
      for (const o of [-0.22, 0.22]) rbox(k, 'metal', '#8a8e9e', X - Math.sin(yaw) * o * 0 + Math.sin(-yaw) * o, (ya + yb) / 2 + 0.055, Z + Math.cos(yaw) * o, len, 0.05, 0.05, yaw, 0, pitch, 0.5);
      rbox(k, 'wood', P.woodD, X, (ya + yb) / 2 + 0.015, Z, 0.12, 0.04, 0.62, yaw, 0, 0, 0.5);
    }
  }
  // ---- streets, squares, the plaza, lanes (each class its own height: no coplanar overlaps)
  k.b.tag = 'terrain:streets';
  sc.streets.forEach((s, i) => {
    if (s.poly && s.poly.length >= 3) {
      const g = polyGeo(s.poly, 0.012 + i * 0.005); k.b.add('paving', g, M(0, 0, 0), '#ffffff', 1.6); g.dispose();
    } else if (s.rr) {
      const [x0, y0, x1, y1, rr] = s.rr;
      const g = polyGeo(roundRect(x0, y0, x1, y1, rr), 0.05); k.b.add('stone', g, M(0, 0, 0), shade(P.stone, 0.18), 0.9); g.dispose();
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
      rbox(k, 'paving', '#d8c8b8', toX(mx), ga + 0.002, zOf(my), len + w * 0.5, 0.008, w, -Math.atan2(dz, dx), 0, 0, 1.6);
    }
  }
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
  // ---- the city wall along the bottom with towers, open at the gate
  k.b.tag = 'terrain:wall';
  {
    const w = sc.wall, za = zOf(w.y0) + 0.25, zb = zOf(w.y1) - 0.2, hh = 2.5;
    for (const [a, b] of [[w.x0, w.gate[0] + 40], [w.gate[1] - 40, w.x1]] as P2[]) {
      box(k, 'brick', P.brick, toX(a), toX(b), -0.1, hh, za, zb, 1.2);
      box(k, 'stone', shade(P.stone, -0.1), toX(a) - 0.04, toX(b) + 0.04, hh, hh + 0.12, za - 0.06, zb + 0.06, 0.8);
      for (let x = toX(a) + 0.25; x < toX(b) - 0.3; x += 0.9) box(k, 'brick', shade(P.brick, 0.05), x, x + 0.45, hh + 0.12, hh + 0.5, za - 0.02, za + 0.3, 1.2);
      k.colliders.push(toX(a), toX(b), 0, hh + 0.5, za, zb);
    }
    for (const x of [w.x0 + 40, (w.x0 + w.gate[0]) / 2, (w.gate[1] + w.x1) / 2, w.x1 - 40]) {
      cyl(k, 'brick', shade(P.brick, -0.06), toX(x), -0.1, (za + zb) / 2, 1.1, hh + 1.1, 12, 1.2);
      cone(k, 'roof', P.roof, toX(x), hh + 1.0, (za + zb) / 2, 1.3, 1.5, false, 0.8);
      k.colliders.push(toX(x) - 1.1, toX(x) + 1.1, 0, hh + 2.5, (za + zb) / 2 - 1.1, (za + zb) / 2 + 1.1);
    }
  }
  k.b.tag = '';
}

function roundRect(x0: number, y0: number, x1: number, y1: number, r: number): P2[] {
  const out: P2[] = [], c: [number, number, number][] = [[x1 - r, y1 - r, 0], [x0 + r, y1 - r, 0.5], [x0 + r, y0 + r, 1], [x1 - r, y0 + r, 1.5]];
  for (const [cx, cy, a0] of c) for (let j = 0; j <= 5; j++) { const a = (a0 + j / 10) * Math.PI; out.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]); }
  return out;
}

/* ------------------------------------------------------------------ buildings + houses */
/** Every site building on its foot band (see the header). */
export function buildFairCatsBuildings(k: Ctx, L: FairCatsLayout, groundAt: (x: number, y: number) => number): void {
  const sc = L.faircats;
  for (const b of L.buildings) {
    const fb = sc.buildings.find((x) => x.id === b.id);
    k.b.tag = b.id;
    const base = groundAt(b.door.x, b.door.y);
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
    const hgt = Math.max(vis[3] - vis[1], OLD_H[b.id] ?? 0);
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
  for (const h of sc.houses) {
    const X0 = toX(h.foot[0]) + 0.05, X1 = toX(h.foot[2]) - 0.05, zf = toZ(h.foot[3]) - 0.04, d = Math.max(2.2, toZ(h.foot[3]) - toZ(h.foot[1]) - 0.1);
    const tav = h.k === 'tavern', r = hash(h.foot[0], h.foot[1]);
    house(k, X0, X1, zf, d, tav ? 3.6 : 2.5 + r * 0.4, {
      wall: tav ? 'wood' : r < 0.4 ? 'plaster' : r < 0.75 ? 'wood' : 'brick', timber: tav || (r >= 0.4 && r < 0.75), roofCol: ROOF[h.roof] ?? k.pal.roof,
      chimney: r > 0.3, lit: 0.65, shutters: r < 0.5 ? k.pal.sign : undefined, roof: 'x', ...(tav ? { floors: 2 } : {}),
    });
    if (tav) signF(k, 'ТРАКТИР', (X0 + X1) / 2, 2.25, zf, 1.8);
    k.colliders.push(X0, X1, 0, 4.5, zf - d, zf);
  }
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
  const onPier = (x: number, y: number) => (x >= pier.x0 && x <= pier.x1 && y >= pier.y0 && y <= pier.y1) || (x >= pier.end[0] && x <= pier.end[2] && y >= pier.end[1] && y <= pier.end[3]);
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
            for (let xx = x; xx <= xs[i + 1] - 2; xx += 4) { if (onPier(xx, yc)) { if (xx - 4 > x) S.push(toX(x), toX(xx - 4), toZ(y), toZ(y + 10), Infinity); x = xx + 4; } }
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
  for (const it of sc.items) placeItem(k, sc, it, G, lampHead, lampHeads, posts);
  // a pine belt round the town (outside the walk area) + the far forest edge
  k.b.tag = 'forest';
  let s = 77;
  const rnd = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
  const town = sc.town, X0 = plateauX0(sc);
  const tryTree = (x: number, y: number, sc0: number) => {
    if (inPoly(town, x, y) || L.free(x, y) || inPoly(sc.mount, x, y)) return;
    for (let d = 0; d < 60; d += 20) if (L.free(x + d, y) || L.free(x - d, y) || L.free(x, y + d) || L.free(x, y - d)) return;
    if (y > sc.wall.y0 - 60 && y < sc.wall.y1 + 120 && x > sc.wall.x0 - 60 && x < sc.wall.x1 + 60) return;
    k.inst.add('fc:pine', toX(x), groundAt(x, y), toZ(y), rnd() * 6.28, sc0);
  };
  // ≈ 150 pines (≈ 66 tris each): a belt on the west / east edges, north of the low west quarter, beyond the wall, and on
  // the plateau's back; the hills ring of the backdrop does the rest
  for (let y = 1000; y < sc.H + 500; y += 280 + rnd() * 110) {
    for (let x = -600; x < 300; x += 300 + rnd() * 140) tryTree(x, y, 1.3 + rnd() * 0.6);
    for (let x = 5520; x < sc.W + 600; x += 300 + rnd() * 140) tryTree(x, y, 1.3 + rnd() * 0.6);
  }
  for (let x = -500; x < X0 - 40; x += 230 + rnd() * 100) for (let y = 300; y < 880; y += 240 + rnd() * 90) tryTree(x, y, 1.3 + rnd() * 0.6);
  for (let x = 0; x < sc.W; x += 330 + rnd() * 160) for (let y = sc.wall.y1 + 180; y < sc.H + 400; y += 300 + rnd() * 100) tryTree(x, y, 1.3 + rnd() * 0.7);
  for (let x = X0 + 100; x < 4200; x += 300 + rnd() * 150) for (let y = -300; y < 180; y += 260 + rnd() * 100) tryTree(x, y, 1.4 + rnd() * 0.7);
  void P;
  k.b.tag = '';
  // wires the building builders collected (tent pennants, shop beams) → garland spans
  const garlands: THREE.Vector3[][] = [];
  for (let j = 0; j + 5 < k.wires.length; j += 6) garlands.push([new THREE.Vector3(k.wires[j], k.wires[j + 1], k.wires[j + 2]), new THREE.Vector3(k.wires[j + 3], k.wires[j + 4], k.wires[j + 5])]);
  return { garlands, lampHeads };
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
      for (let i = 0; i < n; i++) k.inst.add(VK.crate, X + (i % 3) * 0.3 - (n > 2 ? 0 : 0), g + (i >= 3 ? 0.54 : 0), toZ(y - 18) + (i % 2) * 0.04, (i * 0.37) % 0.6 - 0.3, 0.9);
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
    case 'grind': k.b.add('stone', GEO.cyl16, M(X, g + 0.45, toZ(y - 10), 0.75, 0.16, 0.75, Math.PI / 2, 0, 0), '#8a8a96', 0.6); box(k, 'wood', P.woodD, X - 0.32, X + 0.32, g, g + 0.3, toZ(y - 10) - 0.12, toZ(y - 10) + 0.12, 0.5); break;
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
