/**
 * Where the ground foliage grows (foliage.ts draws it): a deterministic spot list for a built town.
 *   fair / district towns / cherts: weeds at the facade feet (in front of the first walkable row, never in a doorway),
 *   rings round lamp / mast / tree / bench feet, the ledge troughs and the lower bed (soil tops + their base line: no
 *   more "pasted on" planters), the foot of the city walls and the stair cheeks, both canal banks, and a sparse sprinkle
 *   in the paving cracks;
 *   hand villages: the biome's grass everywhere off the roads / plazas / water, denser off the walk grid and along the
 *   road edges (the soil strips blend into the grass).
 * Never on water, inside walls (solid top = Infinity) or on steps / counters (a finite solid above the ground).
 */
import * as THREE from 'three';
import type { CityLayout } from '../contracts';
import { toX, toZ, fromX, fromZ, SZ } from './coords';
import type { GroundSpec } from './ground';
import { SpotList, clump } from './foliage';
import type { Ctx } from './kit';
import { villageOf } from './village';

const FLOWERS = ['#ff7f9a', '#ffd84d', '#d0b0ff', '#ffb070', '#fff2e0', '#8fc8ff', '#ff9fd0'].map((c) => new THREE.Color(c));
const EMBERS = ['#ff6a2a', '#ffb040', '#ff8a3a', '#ffd070'].map((c) => new THREE.Color(c));

/** Distance from a point to a polyline (metres, all in world metres). */
function distPoly(x: number, z: number, pts: [number, number][]): number {
  let best = Infinity;
  for (let i = 0; i + 1 < pts.length; i++) {
    const ax = pts[i][0], az = pts[i][1], bx = pts[i + 1][0], bz = pts[i + 1][1];
    const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz;
    const t = l2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2)) : 0;
    const ex = ax + dx * t - x, ez = az + dz * t - z;
    best = Math.min(best, ex * ex + ez * ez);
  }
  return Math.sqrt(best);
}

export function scatterFoliage(k: Ctx, L: CityLayout, s: GroundSpec, groundAt: (x: number, y: number) => number, top: (X: number, Z: number) => number): number[] {
  const S = new SpotList(4242), P = k.pal, hell = !!P.hell;
  const flowers = hell ? EMBERS : FLOWERS;
  const fl = () => flowers[Math.floor(S.rnd() * flowers.length)];
  const G = (X: number, Z: number) => groundAt(fromX(X), fromZ(Z));
  /** A spot is fine when nothing stands there (or only ground-level stuff) and it is not water. */
  const ok = (X: number, Z: number, y: number) => { const t = top(X, Z); return !(t > y + 0.03); };
  const tuft = (X: number, Z: number, sc: number, pFlower: number, y?: number) => {
    const yy = y ?? G(X, Z);
    if (y === undefined && !ok(X, Z, yy)) return;
    S.add(X, yy, Z, sc, S.rnd() < pFlower ? fl() : null);
  };
  const W = toX(L.W);
  const V = villageOf(L);
  const doors = L.buildings.map((b) => toX(b.door.x));
  const nearDoor = (X: number) => doors.some((d) => Math.abs(d - X) < 0.85);

  if (V) {
    // ------------------------------------------------ hand village: a meadow off the roads
    const roads = V.roads.map((r) => ({ pts: r.pts.map(([x, y]) => [toX(x), toZ(y)] as [number, number]), hw: r.w * SZ * 0.62 }));
    const plazas = V.plazas.map((p) => ({ X: toX(p.x), Z: toZ(p.y), rx: toX(p.rx) + 0.3, rz: p.ry * SZ + 0.3 }));
    const z0 = toZ(L.area.y0) - 0.6, z1 = toZ(L.area.y1) + 0.5;
    for (let Z = z0; Z < z1; Z += 0.36) for (let X = -1; X < W + 1; X += 0.36) {
      const x = X + (S.rnd() - 0.5) * 0.4, z = Z + (S.rnd() - 0.5) * 0.4;
      let dr = Infinity; for (const r of roads) dr = Math.min(dr, distPoly(x, z, r.pts) - r.hw);
      if (dr < -0.05) continue;                                             // on the road
      if (plazas.some((p) => ((x - p.X) / p.rx) ** 2 + ((z - p.Z) / p.rz) ** 2 < 1)) continue;
      const free = L.free(fromX(x), fromZ(z));
      const edge = dr < 0.35;                                               // the verge of a road: a dense fringe
      const c = clump(x, z);
      const p = edge ? 0.95 : free ? 0.32 + 0.55 * c : 0.6 + 0.4 * c;
      if (S.rnd() > p) continue;
      tuft(x, z, (edge ? 0.7 : 0.65) + S.rnd() * 0.45, free ? 0.06 : 0.14);
    }
    return S.a;
  }

  // ------------------------------------------------ facade feet (upper street): weeds in the corner wall | paving
  const yTop = Math.max(L.area.y0, 790);
  for (let X = 0.2; X < W - 0.2; X += 0.11) {
    if (nearDoor(X)) continue;
    let yf = -1;
    for (let y = yTop; y < yTop + 220; y += 3) if (L.free(fromX(X), y)) { yf = y; break; }
    if (yf < 0) continue;
    const c = clump(X * 1.7, 3.1);
    if (S.rnd() > 0.15 + c * 0.75) continue;
    const Z = toZ(yf) - 0.1 - S.rnd() * 0.3;
    if (Z > (s.hasLow ? toZ(s.wallY) - 1 : 1e9)) continue;
    tuft(X, Z, 0.55 + S.rnd() * 0.55 * c, 0.08 + 0.12 * c);
  }

  // ------------------------------------------------ rings round the feet of props
  const ring = (kind: string, r: number, n: number, sc: number) => {
    for (const p of k.inst.placed.get(kind) ?? []) {
      const m = n + Math.floor(S.rnd() * 3);
      for (let i = 0; i < m; i++) {
        const a = S.rnd() * Math.PI * 2, rr = r * (p.scale || 1) + 0.04 + S.rnd() * 0.12;
        tuft(p.x + Math.cos(a) * rr, p.z + Math.sin(a) * rr, sc * (0.7 + S.rnd() * 0.5), 0.2);
      }
    }
  };
  ring('lamp', 0.26, 4, 0.75); ring('mast', 0.14, 3, 0.7); ring('tree', 0.3, 6, 0.9); ring('bed', 1.0, 6, 0.8);
  ring('bench', 0.8, 2, 0.6); ring('statue', 1.0, 7, 0.9); ring('signpost', 0.22, 3, 0.7); ring('well', 0.75, 6, 0.8);
  ring('fountain', 1.32, 8, 0.8); ring('barrel', 0.3, 2, 0.6); ring('crate', 0.32, 1, 0.55);

  // ------------------------------------------------ sprinkle in the paving cracks (sparse, clumped, small)
  const zA = toZ(L.area.y0), zB = toZ(L.area.y1);
  for (let Z = zA; Z < zB; Z += 0.7) for (let X = 0; X < W; X += 0.7) {
    const x = X + S.rnd() * 0.7, z = Z + S.rnd() * 0.7;
    const c = clump(x * 0.6, z * 0.8);
    if (c < 0.72 || S.rnd() > (c - 0.72) * 2.2) continue;
    if (s.hasLow && s.canal && z > toZ(s.canal[0]) - 0.45 && z < toZ(s.canal[1]) + 0.45) continue;
    if (s.stairs.some(([a, b]) => x > toX(a) - 0.4 && x < toX(b) + 0.4) && s.hasLow && Math.abs(z - toZ(s.wallY)) < 1.6) continue;
    tuft(x, z, 0.4 + S.rnd() * 0.35, 0.04);
  }

  if (s.hasLow) {
    const wallZ = toZ(s.wallY), lowH = s.lowH;
    // ---------------------------------------------- canal banks: a grassy verge along both copings (outside the kerb)
    if (s.canal) {
      const c0 = toZ(s.canal[0]), c1 = toZ(s.canal[1]);
      const br = s.bridges.map(([a, b]) => [toX(a) - 0.3, toX(b) + 0.3]);
      for (let X = -1; X < W + 1; X += 0.16) {
        if (br.some(([a, b]) => X > a && X < b)) continue;
        for (const [zz, dir] of [[c0 - 0.38, -1], [c1 + 0.38, 1]] as const) {
          const c = clump(X * 1.3, zz);
          if (S.rnd() > 0.25 + 0.7 * c) continue;
          tuft(X + (S.rnd() - 0.5) * 0.1, zz + dir * S.rnd() * 0.35 * c, 0.6 + S.rnd() * 0.6, 0.12);
        }
      }
    }
    // ---------------------------------------------- the foot of the retaining wall (lower side) and of the city wall
    for (let X = -1; X < W + 1; X += 0.14) {
      if (s.stairs.some(([a, b]) => X > toX(a) - 0.4 && X < toX(b) + 0.4)) continue;
      const c = clump(X * 1.1, 9.0);
      if (S.rnd() < 0.2 + 0.6 * c) tuft(X, wallZ + 0.03 + S.rnd() * 0.12, 0.55 + S.rnd() * 0.6, 0.1);
    }
    // stair cheeks: weeds where the steps meet the walls
    for (const [a, b] of s.stairs) for (const X of [toX(a) - 0.4, toX(b) + 0.4]) {
      for (let i = 0; i < 6; i++) tuft(X + (S.rnd() - 0.5) * 0.12, wallZ + 0.1 + S.rnd() * 0.5, 0.6 + S.rnd() * 0.4, 0.15, lowH);
    }
  }
  const zEnd = toZ(L.area.y1) + 0.8, yEnd = s.hasLow ? s.lowH : 0;
  for (let X = -1; X < W + 1; X += 0.12) {
    const c = clump(X * 0.9, 21.0);
    if (S.rnd() < 0.3 + 0.65 * c) tuft(X, zEnd + 0.36 - S.rnd() * 0.3 * (0.4 + c), 0.7 + S.rnd() * 0.8 * c, 0.18, yEnd);
  }
  return S.a;
}

/**
 * Soil-top plantings of the ledge troughs / lower bed (ledge.ts gives their soil rectangles): dense tufts + flowers on
 * the soil and a fringe along the trough foot. rects: x0 x1 z0 z1 ySoil yFoot zFringe (the street side of the foot).
 */
export function plantRects(rects: number[], seed = 99): number[] {
  const S = new SpotList(seed);
  for (let i = 0; i + 6 < rects.length; i += 7) {
    const [x0, x1, z0, z1, ys, yf, zf] = rects.slice(i, i + 7), dir = zf < z0 ? -1 : 1;
    for (let x = x0 + 0.06; x < x1 - 0.04; x += 0.12) for (let z = z0 + 0.05; z < z1 - 0.03; z += 0.14) {
      if (S.rnd() < 0.45) continue;
      S.add(x + (S.rnd() - 0.5) * 0.08, ys, z + (S.rnd() - 0.5) * 0.08, 0.7 + S.rnd() * 0.6, S.rnd() < 0.3 ? FLOWERS[Math.floor(S.rnd() * FLOWERS.length)] : null);
    }
    // a fringe on the street side of the trough foot (grounds it)
    for (let x = x0 + 0.05; x < x1; x += 0.13) if (S.rnd() < 0.55) S.add(x, yf, zf + dir * (0.02 + S.rnd() * 0.08), 0.5 + S.rnd() * 0.45, null);
  }
  return S.a;
}
