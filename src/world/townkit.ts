/**
 * Terrain of a «Town Kit» district town (site 05.11, src/net/townkit.ts) — the new cats fair's builder generalised to the
 * kit's lists (src/world/faircats.ts does buildings, houses, decor items, solids and the streets / lanes / rails / wall):
 *   - the ground with every water polygon cut out (water + soil bank skirt), plank decks on the bridges;
 *   - every tier: its polygon on top at kitTierH(lv); the rim edge gets the rock bank down to rim + face (as the fair's
 *     plateau); the tier's other edges drop as plain rock walls; its `sides` (cliff obstacles) are inside those walls;
 *   - every rock (lv 0, not walkable): a top FC_MH above what it stands on, a rock face along its rim down to rim + face,
 *     plain walls elsewhere, a few crags on top;
 *   - stairs / ramps from the rim of the tier they climb down to their foot, in a cut of the bank (faircats.ts fcFlight:
 *     solid steps / the plank ramp between stone retaining walls).
 * Heights come from fcground.ts townKitGround (the player's ground) so the drawn surfaces and the walk heights agree.
 */
import * as THREE from 'three';
import type { FairCatsScene } from '../net/faircats';
import { rimY, inPoly } from '../net/faircats';
import type { KitInfo } from '../net/townkit';
import { kitTierH } from '../net/townkit';
import { toX, toZ } from './coords';
import { M } from './batch';
import { type Ctx, box, shade } from './kit';
import { FC_H, FC_MH, FC_PIER, FC_POND } from './fcground';
import { polyGeo, stripGeo, hash, ICO1, fcRails, fcStreets, fcWall, fcBank, fcFlight } from './faircats';

type P2 = [number, number];
const zOf = (y: number) => toZ(y);

/** Ground colour tint of the tiers by biome (the lowPaving material carries the grass texture). */
const TIER_TINT: Record<string, string> = { ice: '#f4f8ff', desert: '#fff2dc', ash: '#d8d0cc', blight: '#dcd4e4' };

/** Rock walls straight down along the polygon edges that are not on the rim (rim edges get the bank). */
function sideWalls(k: Ctx, poly: readonly P2[], rim: readonly P2[], top: number, base: number, col: string): void {
  const onRim = (a: P2, b: P2) => rim.length >= 2 && rim.some((p) => p[0] === a[0] && p[1] === a[1]) && rim.some((p) => p[0] === b[0] && p[1] === b[1]);
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    if (onRim(a, b) || Math.hypot(b[0] - a[0], b[1] - a[1]) < 2) continue;
    const n = Math.max(1, Math.ceil(Math.hypot(toX(b[0] - a[0]), zOf(b[1]) - zOf(a[1])) / 1.2));
    const t: number[][] = [], d: number[][] = [];
    for (let j = 0; j <= n; j++) {
      const x = a[0] + (b[0] - a[0]) * j / n, y = a[1] + (b[1] - a[1]) * j / n, jit = hash(x, y) - 0.5;
      t.push([toX(x), top + 0.02, zOf(y)]); d.push([toX(x) + jit * 0.15, base - 0.05, zOf(y) + jit * 0.15]);
    }
    // both windings: the wall is seen from either side (a tier in the middle of the town)
    const g1 = stripGeo(t, d), g2 = stripGeo(d, t);
    k.b.add('rock', g1, M(0, 0, 0), col, 1.6); k.b.add('rock', g2, M(0, 0, 0), col, 1.6); g1.dispose(); g2.dispose();
  }
}
export function buildKitTerrain(k: Ctx, sc: FairCatsScene, kit: KitInfo, groundAt: (x: number, y: number) => number): void {
  const P = k.pal, W = sc.W, H = sc.H, FAR = 3200;
  // ---- ground (lowPaving = grass) with the water cut out
  k.b.tag = 'terrain:ground';
  // the meadow is the town polygon; outside it the darker forest floor (tk-art.js drawTown: P.grass / P.forest)
  const big: P2[] = [[-FAR, -FAR], [W + FAR, -FAR], [W + FAR, H + FAR], [-FAR, H + FAR]];
  const inside = kit.water.every((w) => w.poly.every(([x, y]) => inPoly(sc.town, x, y)));
  if (sc.town.length >= 3 && inside && kit.biome !== 'desert') {
    const g = polyGeo(sc.town, 0, kit.water.map((w) => w.poly)); k.b.add('lowPaving', g, M(0, 0, 0), '#ffffff', 2.4); g.dispose();
    const f = polyGeo(big, 0, [sc.town]); k.b.add('lowPaving', f, M(0, 0, 0), shade(TIER_TINT[kit.biome] ?? '#ffffff', -0.38), 2.4); f.dispose();
  } else { const g = polyGeo(big, 0, kit.water.map((w) => w.poly)); k.b.add('lowPaving', g, M(0, 0, 0), '#ffffff', 2.4); g.dispose(); }
  // ---- tiers
  k.b.tag = 'terrain:tiers';
  const tint = TIER_TINT[kit.biome] ?? '#e6f0dc';
  kit.tiers.forEach((t) => {
    const h = kitTierH(t.lv, FC_H); if (h <= 0) return;
    const g = polyGeo(t.poly, h); k.b.add('lowPaving', g, M(0, 0, 0), tint, 2.4); g.dispose();
    fcBank(k, t.rim, t.face, h, 0, sc.stairs);
    sideWalls(k, t.poly, t.rim, h, 0, shade(P.rock, -0.1));
    // boulders at the bank's foot (in the face's obstacle band; never on stairs / in a building's foot)
    if (t.rim.length >= 2) {
      const x0 = t.rim[0][0], x1 = t.rim[t.rim.length - 1][0];
      const busy = (x: number) => sc.stairs.some((s) => x > s.x0 - 60 && x < s.x1 + 60) || sc.buildings.some((b) => x > b.foot[0] - 30 && x < b.foot[2] + 30 && b.foot[1] < rimY(t.rim, x) + t.face + 10);
      for (let x = x0 + 60; x < x1 - 40; x += 150 + hash(x, 7) * 120) {
        if (busy(x)) continue;
        const r = rimY(t.rim, x), s = 0.35 + hash(x, 9) * 0.3;
        k.b.add('rock', ICO1, M(toX(x), 0.08, zOf(r + t.face) - 0.35, s * 2.2, s * 1.4, s * 1.6, 0, hash(x, 2) * 3, 0), shade(P.rock, hash(x, 4) * 0.2 - 0.1), 1.6);
      }
    }
  });
  // ---- rocks (mountains): on the ground under their rim face
  k.b.tag = 'terrain:rocks';
  for (const r of kit.rocks) {
    const xs = r.poly.map((p) => p[0]), ys = r.poly.map((p) => p[1]);
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
    const base = r.rim.length >= 2 ? groundAt(cx, rimY(r.rim, cx) + r.face + 12) : groundAt(cx, Math.max(...ys) + 12);
    const top = base + FC_MH;
    const g = polyGeo(r.poly, top); k.b.add('rock', g, M(0, 0, 0), shade(P.rock, 0.05), 2); g.dispose();
    fcBank(k, r.rim, r.face, top, base, []);
    sideWalls(k, r.poly, r.rim, top, base, shade(P.rock, -0.05));
    const n = Math.max(2, Math.round((Math.max(...xs) - Math.min(...xs)) / 300));
    for (let i = 0; i < n; i++) {
      const x = Math.min(...xs) + 120 + i * (Math.max(...xs) - Math.min(...xs) - 240) / Math.max(1, n - 1), y = (r.rim.length >= 2 ? rimY(r.rim, x) : Math.max(...ys)) - 140 - hash(i, 6) * 200, s = 1.0 + hash(i, 8) * 1.2;
      if (y < Math.min(...ys) + 40) continue;
      k.b.add('rock', ICO1, M(toX(x), top + s * 0.2, zOf(y), s * 2.4, s * 1.5, s * 2.0, hash(i, 1), hash(i, 2) * 3, 0), shade(P.rock, hash(i, 3) * 0.16 - 0.08), 2);
    }
  }
  // ---- stairs and ramps (the tier whose rim they cross): flights in a cut of the bank (faircats.ts fcFlight)
  for (const s of sc.stairs) {
    const xc = (s.x0 + s.x1) / 2;
    const t = kit.tiers.find((q) => q.rim.length >= 2 && xc >= q.rim[0][0] && xc <= q.rim[q.rim.length - 1][0]);
    if (!t) continue;
    fcFlight(k, s, rimY(t.rim, xc), t.face, kitTierH(t.lv, FC_H), 0, sc.rail);
  }
  fcRails(k, sc, groundAt);
  fcStreets(k, sc, groundAt);
  // ---- water: surface, soil bank skirt
  k.b.tag = 'terrain:water';
  const waterCol = kit.biome === 'ash' ? '#ffb080' : '#ffffff';
  for (const w of kit.water) {
    const g = polyGeo(w.poly, FC_POND); k.b.add('water', g, M(0, 0, 0), waterCol, 3); g.dispose();
    const t: number[][] = [], b: number[][] = [];
    for (const [x, y] of [...w.poly, w.poly[0]]) { t.push([toX(x), 0.0, zOf(y)]); b.push([toX(x), FC_POND - 0.25, zOf(y)]); }
    const gs = stripGeo(t, b); k.b.add('rock', gs, M(0, 0, 0), shade(P.rock, -0.2), 1.2); gs.dispose();
  }
  // ---- bridges / piers: plank decks with posts (the site's over rects)
  k.b.tag = 'terrain:bridges';
  let nb = 0;
  for (const br of kit.bridges) for (const [x0, y0, x1, y1] of br.rects) {
    const lift = groundAt((x0 + x1) / 2, (y0 + y1) / 2);
    // overlapping rects (a pier and its head) step up a few mm each: no coplanar decks
    const top = Math.max(FC_PIER, lift) + 0.015 * nb++, along = toX(x1 - x0) >= zOf(y1) - zOf(y0);
    const n = Math.max(2, Math.round((along ? toX(x1 - x0) : zOf(y1) - zOf(y0)) / 0.22));
    const ins = 0.007 * (nb - 1);   // and a few mm narrower: their plank ends never share a plane either
    const X0 = toX(x0) + ins, X1 = toX(x1) - ins, Z0 = zOf(y0) + ins, Z1 = zOf(y1) - ins;
    for (let i = 0; i < n; i++) {
      const c = i % 2 ? P.woodL : shade(P.woodL, -0.08);
      if (along) box(k, 'wood', c, X0 + (X1 - X0) * i / n + 0.01, X0 + (X1 - X0) * (i + 1) / n - 0.01, top - 0.06, top, Z0, Z1, 0.6);
      else box(k, 'wood', c, X0, X1, top - 0.06, top, Z0 + (Z1 - Z0) * i / n + 0.01, Z0 + (Z1 - Z0) * (i + 1) / n - 0.01, 0.6);
    }
    for (const [x, y] of [[x0, y0], [x1, y0], [x0, y1], [x1, y1]]) box(k, 'wood', P.woodD, toX(x) - 0.06, toX(x) + 0.06, FC_POND - 0.3, top - 0.061, zOf(y) - 0.06, zOf(y) + 0.06, 0.5);
  }
  fcWall(k, sc);
  k.b.tag = '';
}
void THREE;
