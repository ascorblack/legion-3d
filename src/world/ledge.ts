/**
 * Ledge dressing (fair with a lower street): the site's walk grid keeps a ~1.5 m dead band along the retaining wall
 * (0.4 m on the upper street in front of the coping, 0.8 m at the wall foot below). Without anything there you stopped
 * in thin air («invisible walls»). The band is filled with things that read as obstacles:
 *  - upper street: stone flower troughs between the garland masts and lamps, against the coping;
 *  - lower street: a raised bed (stone kerb + soil + low bushes and flowers) along the wall foot, between the stairs
 *    and the lower-street buildings.
 * Only where the site's grid is blocked; finite solids (you can hop on them, the grid still decides walking).
 * Cheap: batch geometry (no extra draw calls), icosahedron bushes (20 tris), ≈ 5k triangles for a whole fair at q2.
 * test/world-collide.test.ts checks the invisible-wall bands are covered.
 */
import * as THREE from 'three';
import type { CityLayout } from '../contracts';
import { toX, toZ, fromX } from './coords';
import type { GroundSpec } from './ground';
import { M } from './batch';
import { type Ctx, box, shade } from './kit';

const BUSH = new THREE.IcosahedronGeometry(0.5, 0);
const BLOOM = new THREE.TetrahedronGeometry(0.6, 0);

/** Blocked x-runs (m) of the site grid at row y (px), sampled every 10 px; runs shorter than `min` m are dropped. */
function blockedRuns(L: CityLayout, y: number, x0: number, x1: number, min: number): [number, number][] {
  const out: [number, number][] = [];
  let a = -1;
  for (let x = x0; x <= x1; x += 10) {
    const blocked = !L.free(x, y);
    if (blocked && a < 0) a = x;
    if ((!blocked || x + 10 > x1) && a >= 0) { const b = blocked ? x : x - 10; if (toX(b) - toX(a) >= min) out.push([toX(a), toX(b)]); a = -1; }
  }
  return out;
}

/** First blocked row (px) at x scanning y0 → y1 (step px); y1 when none. */
function firstBlocked(L: CityLayout, x: number, y0: number, y1: number, step: number): number {
  for (let y = y0; y <= y1; y += step) if (!L.free(x, y)) return y;
  return y1;
}
/** Last blocked row (px) of the run of blocked rows that starts at y0 (scanning to y1). */
function lastBlocked(L: CityLayout, x: number, y0: number, y1: number, step: number): number {
  let last = y0;
  for (let y = y0; y <= y1; y += step) { if (L.free(x, y)) break; last = y; }
  return last;
}

const cut = (runs: [number, number][], holes: [number, number][]): [number, number][] => {
  let r = runs;
  for (const [h0, h1] of holes) {
    const n: [number, number][] = [];
    for (const [a, b] of r) { if (h1 <= a || h0 >= b) { n.push([a, b]); continue; } if (h0 > a) n.push([a, h0]); if (h1 < b) n.push([h1, b]); }
    r = n;
  }
  return r;
};

export function ledgeDressing(k: Ctx, L: CityLayout, s: GroundSpec): void {
  if (!s.hasLow) return;
  const P = k.pal, rnd = k.rnd, wallZ = toZ(s.wallY), lowH = s.lowH;
  const stairs = s.stairs.map((r) => [toX(r[0]) - 0.45, toX(r[1]) + 0.45] as [number, number]);
  const leaf = [P.leaf, P.leafD, shade(P.leaf, 0.18)], bloom = ['#ff7f9a', '#ffd84d', '#d0b0ff', '#ffb070', '#fff2e0'];
  const solids = (k.solids ||= []);
  const bushes = (x0: number, x1: number, z0: number, z1: number, y: number, h: number, step: number) => {
    for (let x = x0 + step / 2; x < x1 - 0.1; x += step * (0.75 + rnd() * 0.5)) {
      const z = (z0 + z1) / 2 + (rnd() - 0.5) * (z1 - z0) * 0.3, r = Math.min(z1 - z0, step) * (0.45 + rnd() * 0.2);
      // two overlapping lumps per bush (different size / tint / turn): a soft clump, not a row of gems
      k.b.add('flat', BUSH, M(x, y + r * h * 0.45, z, r * 1.3, r * h, r * 1.1, rnd(), rnd() * 6, 0), leaf[Math.floor(rnd() * 3)], 1);
      const r2 = r * (0.55 + rnd() * 0.25);
      if (k.quality >= 2 && rnd() < 0.55) k.b.add('flat', BUSH, M(x + (rnd() < 0.5 ? -1 : 1) * r * 0.55, y + r2 * h * 0.5, z + (rnd() - 0.5) * r * 0.3, r2 * 1.2, r2 * h, r2, rnd(), rnd() * 6, 0), leaf[Math.floor(rnd() * 3)], 1);
      const nb = 1 + Math.floor(rnd() * 2);
      for (let i = 0; i < nb; i++) k.b.add('flat', BLOOM, M(x + (rnd() - 0.5) * r * 1.4, y + r * h * (0.7 + rnd() * 0.3), z + (rnd() - 0.5) * r * 0.8, 0.1, 0.1, 0.1, 0, rnd() * 3, 0), bloom[Math.floor(rnd() * bloom.length)], 1);
    }
  };
  // ---------------- upper street: troughs in the dead strip in front of the coping (from the grid's first blocked row)
  const zB = wallZ - 0.37;                        // the coping starts at wallZ − 0.35
  {
    // keep clear of the masts / lamps on the ledge (they stand in the same strip)
    const posts: [number, number][] = [];
    for (const kind of ['mast', 'lamp']) for (const p of k.inst.placed.get(kind) ?? []) if (Math.abs(p.z - zB) < 1.2) posts.push([p.x - 0.42, p.x + 0.42]);
    const runs = cut(cut(blockedRuns(L, s.edge[0] + 2, L.area.x0, L.area.x1, 0.8), stairs), posts);
    for (const [a0, b0] of runs) {
      const yb = firstBlocked(L, fromX((a0 + b0) / 2), s.edge[0] - 30, s.edge[0] + 2, 2);
      const zA = Math.max(toZ(yb) + 0.02, wallZ - 0.9);
      if (zB - zA < 0.2) continue;
      // troughs ≤ 2.4 m with 0.3 m gaps (a row of planters, not one long wall)
      const n = Math.max(1, Math.ceil((b0 - a0 - 0.3) / 2.7)), w = (b0 - a0 - 0.3 * (n + 1)) / n;
      if (w < 0.6) continue;
      for (let i = 0; i < n; i++) {
        const a = a0 + 0.3 + i * (w + 0.3), b = a + w, h = 0.3, t = 0.06, cap = shade(P.stone, 0.18);
        box(k, 'stone', shade(P.stone, 0.05), a, b, 0, h, zA, zB, 0.8);
        // rim: four 6 cm walls round the soil (their tops 5 cm over the body)
        box(k, 'stone', cap, a - 0.015, b + 0.015, h, h + 0.05, zA - 0.015, zA + t, 0.8);
        box(k, 'stone', cap, a - 0.015, b + 0.015, h, h + 0.05, zB - t, zB + 0.012, 0.8);
        box(k, 'stone', cap, a - 0.015, a + t, h, h + 0.05, zA + t + 0.004, zB - t - 0.004, 0.8);
        box(k, 'stone', cap, b - t, b + 0.015, h, h + 0.05, zA + t + 0.004, zB - t - 0.004, 0.8);
        box(k, 'flat', '#3b2a22', a + t + 0.01, b - t - 0.01, h + 0.01, h + 0.03, zA + t + 0.01, zB - t - 0.01);   // soil (heaped 3 cm)
        // a darker foot course 2 cm proud of the body: the trough sits ON the paving, not pasted onto it
        box(k, 'stone', shade(P.stone, -0.28), a - 0.02, b + 0.02, 0, 0.06, zA - 0.02, zB - 0.03, 0.8);
        bushes(a + 0.08, b - 0.08, zA + 0.08, zB - 0.08, h + 0.01, 1.1, 0.5);
        solids.push(a - 0.015, b + 0.015, zA - 0.015, zB + 0.012, h + 0.05);
        (k.plant ||= []).push(a + t, b - t, zA + t, zB - t, h + 0.03, 0, zA - 0.02);
        for (let x = a + 0.35; x < b - 0.2; x += 0.7) (k.blobs ||= []).push(x, 0, (zA + zB) / 2 - 0.08, 0.62, 0.42);
      }
    }
  }

  // ---------------- lower street: a raised bed along the wall foot (to the grid's last blocked row of the band)
  const zw = wallZ + 0.012;
  {
    // (buildings against the wall only: the 31.10 jail stands free beyond the canal — its LOW.jail.back is not the wall)
    const atWall = (b: (typeof L.buildings)[number]) => !((b.jail || b.id === 'jail') && typeof L.low?.jail?.back === 'number' && L.low.jail.back > s.edge[1] + 40);
    const lowB: [number, number][] = L.buildings.filter((b) => (b.hit[3] > 1000 || b.mine) && atWall(b)).map((b) => [toX(b.hit[0]) - 0.35, toX(b.hit[1]) + 0.35]);
    const runs = cut(cut(blockedRuns(L, Math.round((s.wallY + s.edge[1]) / 2), L.area.x0, L.area.x1, 1.2), stairs), lowB);
    for (const [a, b] of runs) {
      if (b - a < 1.2) continue;
      const yl = lastBlocked(L, fromX((a + b) / 2), s.wallY, s.edge[1] + 40, 2);
      const zf = Math.min(toZ(yl) - 0.03, wallZ + 1.0);
      if (zf - zw < 0.25) continue;
      const h = 0.34, y = lowH;
      box(k, 'stone', shade(P.stone, -0.04), a, b, y, y + h, zw, zf, 0.8);                                     // kerb body
      box(k, 'stone', shade(P.stone, 0.16), a - 0.02, b + 0.02, y + h, y + h + 0.05, zf - 0.12, zf + 0.02, 0.8);   // front cap
      box(k, 'flat', '#33251d', a + 0.04, b - 0.04, y + h + 0.01, y + h + 0.03, zw + 0.02, zf - 0.13);         // soil (heaped)
      box(k, 'stone', shade(P.stone, -0.3), a - 0.02, b + 0.02, y, y + 0.06, zw + 0.03, zf + 0.025, 0.8);             // foot course
      bushes(a + 0.05, b - 0.05, zw + 0.05, zf - 0.15, y + h, 1.05, 0.62);
      solids.push(a - 0.02, b + 0.02, zw, zf + 0.02, y + h + 0.05);
      (k.plant ||= []).push(a + 0.05, b - 0.05, zw + 0.03, zf - 0.14, y + h + 0.03, y, zf + 0.025);
      for (let x = a + 0.4; x < b - 0.2; x += 0.8) (k.blobs ||= []).push(x, y, zf - 0.1, 0.7, 0.45);
    }
  }
}
