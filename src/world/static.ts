/**
 * Static city content into a Ctx (Batch + Instancer + glow/light lists): terrain, backdrop, every building, the filler
 * facades between upper buildings and the props. No materials/renderer/DOM needed (tests build the city with a fake
 * sign atlas and run the z-fight detector on the Batch).
 */
import type { Building, CityLayout } from '../contracts';
import { toX, toZ } from './coords';
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

/** A building; on a layout without the lower street (camp, district towns) the lower-street models (storage barn,
 *  mine…) get a virtual retaining wall 3 m behind their front, so they keep their depth instead of collapsing to 0. */
function buildOnFlat(k: Ctx, b: Building, spec: GroundSpec): void {
  if (spec.hasLow || !LOW_MODELS.has(b.id)) { buildBuilding(k, b); return; }
  const wz = k.wallZ;
  k.wallZ = toZ(b.hit[3]) - 3.2;
  try { buildBuilding(k, b); } finally { k.wallZ = wz; }
}
const LOW_MODELS = new Set(['storage', 'mine', 'mineboard']);

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

export function buildStatic(k: Ctx, L: CityLayout, spec: GroundSpec, groundAt: (x: number, y: number) => number, lampHead: number): Placed {
  const P = k.pal;
  const camp = campOf(L);
  if (L.id !== 'fair') fitFronts(L);
  if (camp) {
    // start camp «Перепутье»: grass, trails, palisades, forest; buildings as at the fair; tents, fire and props
    k.b.tag = 'terrain';
    const T = campThemeOf(L.styleId), P0 = k.pal;   // a per-style camp tints the palette while the camp is built
    if (T) k.pal = { ...P0, ...T.pal };
    try {
      buildCampTerrain(k, L, camp);
      for (const b of L.buildings) { k.b.tag = b.id; buildOnFlat(k, b, spec); }
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
  k.b.tag = 'props';
  if (village) { k.b.tag = 'cottages'; buildCottages(k, L, village); k.b.tag = 'props'; }
  const placed = village ? placeVillageProps(k, L, village, lampHead) : placeProps(k, L, spec, groundAt, lampHead);
  k.b.tag = '';
  return placed;
}
