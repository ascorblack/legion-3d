/**
 * Solid tops of the city for jumping (World3DExt.solidTop): analytic boxes and discs in world metres, bucketed in a
 * 1 m grid. A query returns the highest top among the shapes containing the point (absolute world Y, metres):
 *   finite  — bench seat, crate, barrel, railing, planter, fountain / well rim, stall counter, hay bale, mine cart;
 *   Infinity — buildings, city walls, rock, lamps, trees, masts, statue, posts, water, outside the walkable area;
 *   -Infinity — nothing on the ground there (incl. the gap along the retaining wall: you can drop to the lower street).
 * The same footprints the props are placed with (place.ts / protoProps.ts / the kit's hero props). No allocations per query.
 */
import type { CityLayout } from '../contracts';
import { toX, toZ } from './coords';
import type { GroundSpec } from './ground';
import type { Instancer } from './instancer';

const BOX = 0, DISC = 1;
const INF = Infinity;

/** Prop footprints at scale 1 (rotY 0): half extents along x / z (or radius) and top above the prop origin; Infinity = can't stand on. */
/** `bar`: an extra box (half extents, centred on the prop, rotated with it) for parts that stick out of the main shape
 *  at body height — the dummy's arms (test/world-collide.test.ts). */
export const PROP_SOLID: Record<string, { hx?: number; hz?: number; r?: number; top: number; inner?: { r: number; top: number }; bar?: { hx: number; hz: number; top: number } }> = {
  lamp: { r: 0.24, top: INF }, mast: { r: 0.12, top: INF },
  bench: { hx: 0.76, hz: 0.25, top: 0.46 },
  crate: { hx: 0.29, hz: 0.29, top: 0.54 }, barrel: { r: 0.28, top: 0.75 }, chest: { hx: 0.4, hz: 0.28, top: 0.55 },
  bed: { hx: 1.0, hz: 0.31, top: 0.42 }, tree: { r: 0.3, top: INF }, bush: { r: 0.42, top: 0.55 },
  fence: { hx: 1.02, hz: 0.06, top: 0.9 },
  fountain: { r: 1.27, top: 0.64, inner: { r: 1.07, top: INF } },
  well: { r: 0.67, top: 0.75, inner: { r: 0.45, top: INF } },
  statue: { r: 0.9, top: INF }, dummy: { r: 0.35, top: INF, bar: { hx: 0.5, hz: 0.1, top: INF } }, signpost: { r: 0.2, top: INF }, cart: { hx: 0.8, hz: 0.6, top: INF },
  noticeBoard: { hx: 0.7, hz: 0.2, top: INF },
};

export class SolidMap {
  private sh: Float64Array;
  private n: number;
  private cellStart: Int32Array;
  private cellIdx: Int32Array;
  private gx0: number; private gz0: number; private gw: number; private gh: number;

  /** shapes: [type, a, b, c, d, top] × n — box: x0 x1 z0 z1; disc: cx cz r (d unused). */
  constructor(shapes: number[]) {
    this.n = Math.floor(shapes.length / 6);
    this.sh = Float64Array.from(shapes);
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    const ext = (i: number, out: number[]) => {
      const o = i * 6, s = this.sh;
      if (s[o] === BOX) { out[0] = s[o + 1]; out[1] = s[o + 2]; out[2] = s[o + 3]; out[3] = s[o + 4]; }
      else { out[0] = s[o + 1] - s[o + 3]; out[1] = s[o + 1] + s[o + 3]; out[2] = s[o + 2] - s[o + 3]; out[3] = s[o + 2] + s[o + 3]; }
    };
    const e = [0, 0, 0, 0];
    for (let i = 0; i < this.n; i++) { ext(i, e); x0 = Math.min(x0, e[0]); x1 = Math.max(x1, e[1]); z0 = Math.min(z0, e[2]); z1 = Math.max(z1, e[3]); }
    if (!this.n) { x0 = z0 = 0; x1 = z1 = 1; }
    this.gx0 = Math.floor(x0); this.gz0 = Math.floor(z0);
    this.gw = Math.max(1, Math.ceil(x1) - this.gx0); this.gh = Math.max(1, Math.ceil(z1) - this.gz0);
    const cells = this.gw * this.gh, count = new Int32Array(cells + 1);
    const each = (i: number, fn: (c: number) => void) => {
      ext(i, e);
      const cx0 = Math.max(0, Math.floor(e[0]) - this.gx0), cx1 = Math.min(this.gw - 1, Math.floor(e[1]) - this.gx0);
      const cz0 = Math.max(0, Math.floor(e[2]) - this.gz0), cz1 = Math.min(this.gh - 1, Math.floor(e[3]) - this.gz0);
      for (let cz = cz0; cz <= cz1; cz++) for (let cx = cx0; cx <= cx1; cx++) fn(cz * this.gw + cx);
    };
    for (let i = 0; i < this.n; i++) each(i, (c) => count[c + 1]++);
    for (let c = 0; c < cells; c++) count[c + 1] += count[c];
    this.cellStart = count;
    this.cellIdx = new Int32Array(count[cells]);
    const fill = count.slice(0, cells);
    for (let i = 0; i < this.n; i++) each(i, (c) => { this.cellIdx[fill[c]++] = i; });
  }

  /** Highest top (world Y, m) at world point (X, Z); -Infinity when nothing is there. */
  top(X: number, Z: number): number {
    const cx = Math.floor(X) - this.gx0, cz = Math.floor(Z) - this.gz0;
    if (cx < 0 || cz < 0 || cx >= this.gw || cz >= this.gh) return -Infinity;
    const c = cz * this.gw + cx, s = this.sh;
    let best = -Infinity;
    for (let j = this.cellStart[c], e = this.cellStart[c + 1]; j < e; j++) {
      const o = this.cellIdx[j] * 6, t = s[o + 5];
      if (t <= best) continue;
      if (s[o] === BOX) { if (X >= s[o + 1] && X <= s[o + 2] && Z >= s[o + 3] && Z <= s[o + 4]) best = t; }
      else { const dx = X - s[o + 1], dz = Z - s[o + 2]; if (dx * dx + dz * dz <= s[o + 3] * s[o + 3]) best = t; }
      if (best === Infinity) return best;
    }
    return best;
  }
}

/**
 * Collect every solid of the built city: builder solids (k.solids: x0 x1 z0 z1 top), placed props (by kind),
 * terrain (coping, stair cheeks, bridge rails), water.
 */
export function collectSolids(L: CityLayout, spec: GroundSpec, builderSolids: number[], inst: Instancer): number[] {
  const out: number[] = [];
  const box = (x0: number, x1: number, z0: number, z1: number, top: number) => out.push(BOX, Math.min(x0, x1), Math.max(x0, x1), Math.min(z0, z1), Math.max(z0, z1), top);
  const disc = (x: number, z: number, r: number, top: number) => out.push(DISC, x, z, r, 0, top);
  for (let i = 0; i + 4 < builderSolids.length; i += 5) box(builderSolids[i], builderSolids[i + 1], builderSolids[i + 2], builderSolids[i + 3], builderSolids[i + 4]);
  // props
  for (const [kind, list] of inst.placed) {
    const d = PROP_SOLID[kind]; if (!d) continue;
    for (const p of list) {
      const s = p.scale || 1, sy = p.sy || s, top = d.top === INF ? INF : p.y + d.top * sy;
      if (d.r !== undefined) disc(p.x, p.z, d.r * s, top);
      else {
        const c = Math.abs(Math.cos(p.rotY)), si = Math.abs(Math.sin(p.rotY));
        const hx = (d.hx! * c + d.hz! * si) * s, hz = (d.hx! * si + d.hz! * c) * s;   // AABB of the rotated footprint
        box(p.x - hx, p.x + hx, p.z - hz, p.z + hz, top);
      }
      if (d.inner) disc(p.x, p.z, d.inner.r * s, d.inner.top === INF ? INF : p.y + d.inner.top * sy);
      if (d.bar) {
        const c = Math.abs(Math.cos(p.rotY)), si = Math.abs(Math.sin(p.rotY)), b = d.bar;
        const hx = (b.hx * c + b.hz * si) * s, hz = (b.hx * si + b.hz * c) * s;
        box(p.x - hx, p.x + hx, p.z - hz, p.z + hz, b.top === INF ? INF : p.y + b.top * sy);
      }
    }
  }
  // terrain: coping along the ledge (a low step), stair cheek walls, bridge rails, canal water
  if (spec.hasLow) {
    const wallZ = toZ(spec.wallY), r0 = toZ(spec.rampY0);
    const W = toX(L.W);
    const stairs = spec.stairs.map((r) => [toX(r[0]), toX(r[1])] as [number, number]).sort((a, b) => a[0] - b[0]);
    let a = -1.5;
    for (const [s0, s1] of stairs) { if (s0 > a) box(a, s0, wallZ - 0.35, wallZ + 0.08, 0.12); a = Math.max(a, s1); }
    if (a < W + 1.5) box(a, W + 1.5, wallZ - 0.35, wallZ + 0.08, 0.12);
    for (const [s0, s1] of stairs) {
      box(s0 - 0.36, s0 + 0.06, r0 - 0.16, wallZ + 0.16, 0.58);
      box(s1 - 0.06, s1 + 0.36, r0 - 0.16, wallZ + 0.16, 0.58);
    }
    if (spec.canal) {
      const c0 = toZ(spec.canal[0]), c1 = toZ(spec.canal[1]);
      for (const [b0, b1] of spec.bridges) {
        const a0 = toX(b0) + 0.1, a1 = toX(b1) - 0.1;
        // rails follow the bridge's hump (one flat top over the whole span left the handrail 5–9 cm above your feet
        // when you stood on it mid-span): 8 pieces, each topped at the rail's highest point over it
        const zb0 = c0 - 0.2, zb1 = c1 + 0.2, hump = 0.18;
        for (const x of [a0 + 0.08, a1 - 0.08]) for (let i = 0; i < 8; i++) {
          const za = zb0 + (zb1 - zb0) * i / 8, zz = zb0 + (zb1 - zb0) * (i + 1) / 8;
          const h = Math.max(Math.sin(Math.PI * i / 8), Math.sin(Math.PI * (i + 1) / 8), i === 3 || i === 4 ? 1 : 0);
          box(x - 0.08, x + 0.08, i === 0 ? c0 - 0.3 : za, i === 7 ? c1 + 0.3 : zz, spec.lowH + 0.88 + hump * h);
        }
      }
    }
  }
  for (const o of L.obstacles) {
    if ('b' in o && o.water) box(toX(o.b[0]), toX(o.b[2]), toZ(o.b[1]), toZ(o.b[3]), INF);
  }
  return out;
}

/** solidTop(x, y) in 2D city px (World3DExt contract): outside the walkable area → Infinity. */
export function makeSolidTop(L: CityLayout, map: SolidMap): (x: number, y: number) => number {
  const A = L.area;
  return (x: number, y: number): number => {
    if (x < A.x0 || x > A.x1 || y < A.y0 || y > A.y1) return Infinity;
    return map.top(toX(x), toZ(y));
  };
}
