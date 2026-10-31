/**
 * Static city content into a Ctx (Batch + Instancer + glow/light lists): terrain, backdrop, every building, the filler
 * facades between upper buildings and the props. No materials/renderer/DOM needed (tests build the city with a fake
 * sign atlas and run the z-fight detector on the Batch).
 */
import type { Building, CityLayout } from '../contracts';
import { toX, toZ, fromX, fromZ } from './coords';
import type * as THREE from 'three';
import type { BatchKey } from './batch';

const SLAB_MATS = new Set<BatchKey>(['stone', 'wood', 'brick', 'metal', 'plaster', 'rock']);
import { archWallGeo, M } from './batch';
import type { GroundSpec } from './ground';
import { type Ctx, box, shade } from './kit';
import { buildBuilding, house, isUpper, BUILDING_DZ, solidFrontOf } from './buildings';
import { buildTerrain, buildBackdrop } from './terrain';
import { placeProps, type Placed } from './place';
import { campOf, buildCampTerrain, buildCampProps } from './camp';
import { campThemeOf } from './camp-themes';
import { villageOf, depthOf, buildDeepBuilding, buildVillageGround, buildCottages, placeVillageProps, villageBackdrop } from './village';
import { cityWalls } from './terrain';
import { ledgeDressing } from './ledge';
import { JAIL_GEO } from './jail';
import { jailGeoOf } from '../net/jail';

/** A building; on a layout without the lower street (camp, district towns) the lower-street models (storage barn,
 *  mine…) get a virtual retaining wall 3 m behind their front, so they keep their depth instead of collapsing to 0. */
function buildOnFlat(k: Ctx, b: Building, spec: GroundSpec): void {
  if (spec.hasLow || !LOW_MODELS.has(b.id)) { buildBuilding(k, b); return; }
  const wz = k.wallZ;
  k.wallZ = toZ(b.hit[3]) - 3.2;
  try { buildBuilding(k, b); } finally { k.wallZ = wz; }
}
const LOW_MODELS = new Set(['storage', 'mine', 'mineboard', 'jail']);

/** Off the fair, move upper building models back so their solid front stays behind the site's first walkable row in
 *  front of them (every go() point the site accepts must be reachable in 3D). */
function fitFronts(L: CityLayout): void {
  for (const b of L.buildings) {
    if (!isUpper(b) || depthOf(L, b)) continue;
    let yFree = Infinity;
    for (let x = b.hit[0] + 24; x <= b.hit[1] - 24; x += 8) {
      for (let y = Math.max(L.area.y0, 790); y < b.door.y + 40; y += 4) if (L.free(x, y)) { yFree = Math.min(yFree, y); break; }
    }
    if (!isFinite(yFree)) continue;
    const dz = Math.min(0, toZ(yFree - 8) - solidFrontOf(b));
    if (dz < 0) BUILDING_DZ.set(b, dz);
  }
}

/**
 * Low slabs of the building models (door steps, plinths, porches 3–24 cm high) become steps: you stand ON them, not
 * sunk into them (a finite top ≤ the 0.25 m step never blocks walking; test/world-collide.test.ts).
 */
function slabHook(k: Ctx, groundAt: (x: number, y: number) => number): (mat: BatchKey, bb: THREE.Box3) => void {
  const slabs = k.solids ||= [];
  return (mat, bb) => {
    if (!SLAB_MATS.has(mat) || bb.max.x - bb.min.x < 0.3 || bb.max.z - bb.min.z < 0.2) return;
    const g = groundAt(fromX((bb.min.x + bb.max.x) / 2), fromZ((bb.min.z + bb.max.z) / 2)), h = bb.max.y - g;
    if (bb.min.y - g > 0.02 || h < 0.03 || h > 0.24) return;
    slabs.push(bb.min.x, bb.max.x, bb.min.z, bb.max.z, bb.max.y);
  };
}

export function buildStatic(k: Ctx, L: CityLayout, spec: GroundSpec, groundAt: (x: number, y: number) => number, lampHead: number): Placed {
  const P = k.pal;
  const camp = campOf(L);
  if (L.id !== 'fair') fitFronts(L);
  for (const b of L.buildings) if (b.id === 'jail') { const J = jailGeoOf(b, L.low); if (J) JAIL_GEO.set(b, J); }   // LOW.jail → the jail builder
  if (camp) {
    // start camp «Перепутье»: grass, trails, palisades, forest; buildings as at the fair; tents, fire and props
    k.b.tag = 'terrain';
    const T = campThemeOf(L.styleId), P0 = k.pal;   // a per-style camp tints the palette while the camp is built
    if (T) k.pal = { ...P0, ...T.pal };
    try {
      buildCampTerrain(k, L, camp);
      k.b.onAdd = slabHook(k, groundAt);
      for (const b of L.buildings) { k.b.tag = b.id; buildOnFlat(k, b, spec); }
      k.b.onAdd = null;
      k.b.tag = 'props';
      return buildCampProps(k, camp, L.styleId);
    } finally { k.b.tag = ''; k.pal = P0; }
  }
  const village = villageOf(L);
  k.b.tag = 'terrain';
  if (village) {
    // hand-made village ★1 (src/world/village.ts): biome ground, the artist's streets, plazas, water, bridges
    buildVillageGround(k, L, village);
    cityWalls(k, toX(L.W), 0, toZ(L.area.y1) + 0.8);
  } else buildTerrain(k, L, spec);
  k.b.tag = 'backdrop';
  if (village) villageBackdrop(k, L);
  buildBackdrop(k, L, toX(L.W) / 2, 6, !village);

  const deep = new Set<Building>();
  k.b.onAdd = slabHook(k, groundAt);
  for (const b of L.buildings) {
    k.b.tag = b.id;
    const d = depthOf(L, b);
    // a building lower down the street (hand village): carried to its own base line, scale and obstacle band
    if (d && buildDeepBuilding(k, L, b, d, (virt) => buildOnFlat(k, virt, spec))) { deep.add(b); continue; }
    buildOnFlat(k, b, spec);
  }
  const upper = L.buildings.filter((b) => isUpper(b) && !deep.has(b)).sort((a, b) => a.hit[0] - b.hit[0]);
  // fillers between upper buildings → a continuous street facade
  let x = 0;
  const W = L.W;
  const fill = (a: number, b: number) => {
    k.b.tag = 'filler@' + Math.round(a);
    if (b - a < 170) {   // narrow gap → a connecting brick wall with an arched passage (no tiny houses)
      const X0 = toX(a), X1 = toX(b), xc = (X0 + X1) / 2, ow = Math.min(0.9, (X1 - X0) * 0.6);
      if (X1 - X0 < 0.3) return;
      const g = archWallGeo(X1 - X0, 2.6, ow, 1.9);
      k.b.add('brick', g, M(xc, 0, -0.9, 1, 1, 0.4), P.brick, 1.2); g.dispose();
      box(k, 'stone', shade(P.stone, 0.15), X0 - 0.05, X1 + 0.05, 2.6, 2.75, -1.17, -0.627, 0.6);
      box(k, 'flat', '#1b1426', xc - ow / 2, xc + ow / 2, 0, 1.9, -1.4, -1.35);
      k.colliders.push(X0, X1, 0, 2.7, -1.1, -0.7);
      (k.solids ||= []).push(X0, X1, -6, -0.62, Infinity);
      return;
    }
    let p = a;
    while (b - p > 45) {
      const w = Math.min(b - p, 160 + k.rnd() * 140);
      const rem = b - p - w;
      const ww = rem < 70 ? b - p : w;
      const X0 = toX(p) + 0.05, X1 = toX(p + ww) - 0.05;
      const r = k.rnd();
      k.colliders.push(X0, X1, 0, 3, -5, -0.3);
      (k.solids ||= []).push(X0, X1, -6, -0.28, Infinity);
      house(k, X0, X1, -0.3 - k.rnd() * 0.4, 4.5, 2.9 + k.rnd() * 1.6, {
        wall: r < 0.45 ? 'brick' : r < 0.8 ? 'plaster' : 'wood', timber: r >= 0.45 && r < 0.8 && k.rnd() < 0.6,
        roofCol: k.rnd() < 0.6 ? P.roof : P.roof2, chimney: k.rnd() < 0.5, lit: 0.55, shutters: k.rnd() < 0.5 ? P.sign : undefined,
        door: X1 - X0 > 1.4,
      });
      p += ww;
    }
  };
  for (const b of upper) { if (b.hit[0] > x) fill(x, b.hit[0]); x = Math.max(x, b.hit[1]); }
  if (x < W) fill(x, W);
  k.b.onAdd = null;
  k.b.tag = 'props';
  if (village) { k.b.tag = 'cottages'; buildCottages(k, L, village); k.b.tag = 'props'; }
  const placed = village ? placeVillageProps(k, L, village, lampHead) : placeProps(k, L, spec, groundAt, lampHead);
  // the walk grid's dead band along the retaining wall: planters / a raised bed instead of thin air (after the masts)
  if (!village) { k.b.tag = 'ledge'; ledgeDressing(k, L, spec); }
  if (!village && !camp) facadeShrubs(k, L);
  if (village) edgeHedges(k, L, spec, groundAt);   // (the fair's side bands are short; its edges belong to the seasonal decorations)
  k.b.tag = '';
  return placed;
}

/**
 * Shrubs at the feet of the upper buildings, in the walk grid's dead band in front of a facade (the strip the site
 * blocks but the 3D model leaves empty): near building corners, never in front of a door, never on a walkable cell.
 */
function facadeShrubs(k: Ctx, L: CityLayout): void {
  const doors = L.buildings.map((b) => toX(b.door.x));
  const taken: number[] = [];
  for (const kind of ['lamp', 'mast', 'tree', 'bush', 'barrel', 'crate', 'cart', 'signpost', 'dummy', 'well', 'fountain', 'statue']) for (const p of k.inst.placed.get(kind) ?? []) taken.push(p.x, p.z);
  const firstFree = (X: number) => { for (let y = Math.max(L.area.y0, 790); y < 1000; y += 2) if (L.free(fromX(X), y)) return y; return -1; };
  let n = 0;
  for (const b of L.buildings) {
    if (!isUpper(b)) continue;
    for (const X of [toX(b.hit[0]) + 0.45, toX(b.hit[1]) - 0.45]) {
      if (doors.some((d) => Math.abs(d - X) < 1.05)) continue;
      const ys = [firstFree(X - 0.38), firstFree(X), firstFree(X + 0.38)];
      if (ys.some((y) => y < 0)) continue;
      const Z = toZ(Math.min(...ys)) - 0.42;
      if (Z < 0.2) continue;   // no room in front of the facade line
      let near = false;
      for (let i = 0; i < taken.length; i += 2) if (Math.hypot(taken[i] - X, taken[i + 1] - Z) < 0.9) { near = true; break; }
      if (near) continue;
      const sc = 0.72 + ((n * 37) % 10) / 40;
      k.inst.add('bush', X, 0, Z, (n * 1.7) % 6.28, sc);
      taken.push(X, Z); n++;
    }
  }
}

/**
 * The walk grid's blocked bands at the left / right ends of the town (≈ 0.5–1 m before the side walls): a hedge of
 * bushes (village alias kind: no extra solid — the grid already blocks it), instead of an invisible wall.
 */
function edgeHedges(k: Ctx, L: CityLayout, s: GroundSpec, groundAt: (x: number, y: number) => number): void {
  const W = L.W;
  for (let y = Math.max(L.area.y0, 800) + 10; y < L.area.y1 - 10; y += 56) {
    let xl = -1, xr = -1;
    for (let x = 0; x < 300; x += 4) if (L.free(x, y)) { xl = x; break; }
    for (let x = W; x > W - 300; x -= 4) if (L.free(x, y)) { xr = x; break; }
    const Z = toZ(y);
    if (s.hasLow && Math.abs(Z - toZ(s.wallY)) < 0.9) continue;
    if (s.canal && y > s.canal[0] - 20 && y < s.canal[1] + 20) continue;
    for (const [xe, dir] of [[xl, -1], [xr, 1]] as const) {
      if (xe < 0) continue;
      const X = toX(xe) + dir * 0.42, band = Math.abs(toX(xe) - (dir < 0 ? 0 : toX(W)));
      if (band < 0.3) continue;
      const sc = Math.min(1.4, 1.1 + band * 0.25);
      k.inst.add('v:bush', X + dir * 0.1, groundAt(xe, y), Z, (y * 0.37) % 6.28, sc);
    }
  }
}
