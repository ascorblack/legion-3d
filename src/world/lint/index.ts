/**
 * Geometry lint: pure checks over the built world (Batch pieces, instanced props, door marks, groundAt) that find the
 * «кривые» geometry / texture bugs before a player does. Every class has a tolerance (TOL) and a readable finding
 * (`where`, tag / kind, world xyz, what). Run by test/geom-lint.test.ts over every town, room, mine floor and an
 * expedition stage, by `dist-dev/game.html?lint=1` and the debug toggle (src/features/geomlint.ts: red markers).
 *
 *   float   object / group of touching parts with nothing under or beside it, gap > 0.08 m (contact graph:
 *           AABB contact ≤ 2 cm, a supporting face ≤ 8 cm below, or the ground ≤ 8 cm below)
 *   loose   a float that is a single thin plane (< 3 cm)
 *   sunk    a part > 0.25 m below the ground AND > 30 % of its height (posts dug in are fine); foundations excepted
 *   overlap solid convex parts of different objects inside each other by > 5 cm
 *   door    two door openings (door leaf / open arch marks) < 1 m apart on one facade
 *   stairs  a step under the visible terrain (> 4 cm), a non-monotonic flight, a step top ≠ walk height (> 0.25 m),
 *           cheek walls that do not cover the steps (top < step + 0.1 m) or float above the bank
 *   rails   rails / ramp planks more than 0.1 m off the walk height or buried in the terrain
 *   onramp  a prop / instance standing on a stair or ramp footprint
 *   zfight  src/world/zfight.ts (coplanar overlap ≥ 2 cm²)
 *   uv      texel density outside 0.4–2.5 × the material median, or anisotropy > 3 (box-projected pieces)
 *   plane   a single flat face > 16 m² (leaning > 6 m²) that is not ground / water / terrain
 *   ledge   a box part crossing a round body mid-height with corners > 12 cm outside it
 *   lamp    a lamp head (emissive part) not connected to the post, or a bare emissive box without a frame
 *   outline the door outline region does not match the drawn door (> 15 cm beyond it, < 60 % of it) or has none
 */
import { ZRecorder } from '../zfight';
import type { BatchKey } from '../batch';
import type { LintClass, LintFinding, LintMark, LintOpts, LintPiece, LintSource } from './types';
import { LINT_ALLOW, type AllowEntry } from './allow';
export type { LintClass, LintFinding, LintOpts, LintPiece, LintSource, LintMark } from './types';
export { LintCollector, components } from './collect';
export { LINT_ALLOW } from './allow';

export const TOL = {
  float: 0.08, contact: 0.02, layer: 0.12, sunk: 0.25, sunkFrac: 0.3, overlap: 0.05, doorGap: 1.0, stepCover: 0.04, stepGround: 0.25,
  cheekOver: 0.1, rail: 0.1, plane: 24, wall: 60, leanPlane: 6, uvHi: 2.5, uvLo: 0.4, uvAniso: 3, ledgePoke: 0.12, outline: 0.15, outlineCover: 0.6,
};

export const ALL_CLASSES: LintClass[] = ['float', 'loose', 'sunk', 'overlap', 'door', 'stairs', 'rails', 'onramp', 'zfight', 'uv', 'plane', 'ledge', 'lamp', 'outline'];

/** Terrain / ground tags: they support things and are not checked themselves. */
export const GROUND_TAGS = /^(terrain(?!:(stairs|rails|ramp))(:.*)?|backdrop|sky|ground|mine:(floor|rock|wall)|exp:terrain)$/;
const NOT_SOLID = new Set(['leaf', 'emit', 'glow', 'flat', 'canvas', 'water', 'back', 'sign', 'glass', 'outline']);
const FOUND = new Set(['stone', 'brick', 'rock', 'plaster']);
/** Materials with a texture (the uv class): the others are flat colour. */
const TEXTURED = new Set(['brick', 'plaster', 'wood', 'roof', 'stone', 'paving', 'lowPaving', 'rock', 'metal', 'canvas']);

export const lintKey = (f: LintFinding) => `${f.where} ${f.tag} ${f.kind} role:${f.role ?? ''} ${f.what}`;

/* ------------------------------------------------------------------ piece facts */
interface Fact { area: number; thick: number; flat: boolean; nx: number; ny: number; nz: number; tris: number; ground: boolean; huge: boolean; planes?: Float64Array | null }

function facts(p: LintPiece, groundTags: RegExp): Fact {
  const a = p.pos, b = p.b, nT = a.length / 9;
  let area = 0, nx = 0, ny = 0, nz = 0;
  for (let t = 0; t < nT; t++) {
    const o = t * 9;
    const ux = a[o + 3] - a[o], uy = a[o + 4] - a[o + 1], uz = a[o + 5] - a[o + 2], vx = a[o + 6] - a[o], vy = a[o + 7] - a[o + 1], vz = a[o + 8] - a[o + 2];
    const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx, l = Math.hypot(cx, cy, cz);
    area += l / 2;
    if (l > 1e-7 && !nx && !ny && !nz) { nx = cx / l; ny = cy / l; nz = cz / l; }
  }
  // flat: every vertex within 1 cm of the first face's plane
  let flat = nT > 0 && (nx !== 0 || ny !== 0 || nz !== 0);
  if (flat) { const d = nx * a[0] + ny * a[1] + nz * a[2]; for (let i = 0; i < a.length; i += 3) if (Math.abs(nx * a[i] + ny * a[i + 1] + nz * a[i + 2] - d) > 0.01) { flat = false; break; } }
  const dx = b[3] - b[0], dy = b[4] - b[1], dz = b[5] - b[2];
  return { area, thick: flat ? 0 : Math.min(dx, dy, dz), flat, nx, ny, nz, tris: nT, ground: groundTags.test(p.tag), huge: Math.max(dx, dz) > 30 };
}

/** Face planes of a closed convex piece (n·p ≤ d inside), or null. */
function convexPlanes(p: LintPiece): Float64Array | null {
  const a = p.pos, nT = a.length / 9; if (nT > 240 || nT < 4) return null;
  const pl: number[] = [];
  for (const sg of [1, -1]) {
    pl.length = 0;
    let ok = true;
    for (let t = 0; t < nT && ok; t++) {
      const o = t * 9;
      const ux = a[o + 3] - a[o], uy = a[o + 4] - a[o + 1], uz = a[o + 5] - a[o + 2], vx = a[o + 6] - a[o], vy = a[o + 7] - a[o + 1], vz = a[o + 8] - a[o + 2];
      let cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx; const l = Math.hypot(cx, cy, cz); if (l < 1e-9) continue;
      cx *= sg / l; cy *= sg / l; cz *= sg / l;
      const d = cx * a[o] + cy * a[o + 1] + cz * a[o + 2];
      for (let i = 0; i < a.length; i += 3) if (cx * a[i] + cy * a[i + 1] + cz * a[i + 2] - d > 2e-3) { ok = false; break; }
      if (ok) pl.push(cx, cy, cz, d);
    }
    if (ok && pl.length >= 16) return Float64Array.from(pl);
  }
  return null;
}

/** How deep (m) the vertices of `a` reach inside the convex piece with planes `pl`. */
function depthInside(a: Float32Array, pl: Float64Array): number {
  let best = 0;
  for (let i = 0; i < a.length; i += 3) {
    let m = Infinity;
    for (let j = 0; j < pl.length; j += 4) { const s = pl[j + 3] - (pl[j] * a[i] + pl[j + 1] * a[i + 1] + pl[j + 2] * a[i + 2]); if (s < m) m = s; if (m <= best) break; }
    if (m > best) best = m;
  }
  return best;
}

/* ------------------------------------------------------------------ spatial helpers */
class Hash2 {
  private cells = new Map<number, number[]>();
  private stamp: Int32Array; private cur = 0;
  constructor(private pieces: LintPiece[], private use: (i: number) => boolean, private cs = 2) {
    this.stamp = new Int32Array(pieces.length);
    for (const p of pieces) if (use(p.i)) this.each(p.b, 0, (k) => { let l = this.cells.get(k); if (!l) this.cells.set(k, (l = [])); l.push(p.i); });
  }
  private each(b: Float64Array, m: number, fn: (k: number) => void): void {
    const cs = this.cs, i0 = Math.floor((b[0] - m) / cs), i1 = Math.floor((b[3] + m) / cs), k0 = Math.floor((b[2] - m) / cs), k1 = Math.floor((b[5] + m) / cs);
    if ((i1 - i0 + 1) * (k1 - k0 + 1) > 4000) return;
    for (let i = i0; i <= i1; i++) for (let k = k0; k <= k1; k++) fn(i * 100003 + k);
  }
  near(b: Float64Array, m: number, fn: (j: number) => void): void {
    this.cur++;
    this.each(b, m, (k) => { const l = this.cells.get(k); if (l) for (const j of l) if (this.stamp[j] !== this.cur) { this.stamp[j] = this.cur; fn(j); } });
  }
}
const boxesTouch = (a: Float64Array, b: Float64Array, m: number) => a[0] <= b[3] + m && b[0] <= a[3] + m && a[1] <= b[4] + m && b[1] <= a[4] + m && a[2] <= b[5] + m && b[2] <= a[5] + m;

/** Up-facing triangles in a 1 m xz grid: the highest surface at (x, z) under a height. */
class TriGrid {
  private cells = new Map<number, number[]>();   // pairs (piece, tri)
  /** triangles too large for the cells (ground sheets, the plateau / mountain tops): checked on every query */
  private big: number[] = [];
  constructor(private pieces: LintPiece[], use: (p: LintPiece) => boolean) {
    for (const p of pieces) {
      if (!use(p)) continue;
      const a = p.pos;
      for (let t = 0; t < a.length / 9; t++) {
        const o = t * 9;
        const ux = a[o + 3] - a[o], uy = a[o + 4] - a[o + 1], uz = a[o + 5] - a[o + 2], vx = a[o + 6] - a[o], vy = a[o + 7] - a[o + 1], vz = a[o + 8] - a[o + 2];
        const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx, l = Math.hypot(cx, cy, cz);
        if (l < 1e-9 || Math.abs(cy / l) < 0.2) continue;   // walls are not surfaces to stand on
        const x0 = Math.min(a[o], a[o + 3], a[o + 6]), x1 = Math.max(a[o], a[o + 3], a[o + 6]), z0 = Math.min(a[o + 2], a[o + 5], a[o + 8]), z1 = Math.max(a[o + 2], a[o + 5], a[o + 8]);
        if ((x1 - x0) * (z1 - z0) > 400) { this.big.push(p.i, t); continue; }
        for (let i = Math.floor(x0); i <= Math.floor(x1); i++) for (let k = Math.floor(z0); k <= Math.floor(z1); k++) {
          const key = i * 100003 + k; let c = this.cells.get(key); if (!c) this.cells.set(key, (c = [])); c.push(p.i, t);
        }
      }
    }
  }
  /** Highest triangle at (x, z) with y ≤ yMax (both faces), skipping pieces `skip` rejects: [y, piece] or null. */
  top(x: number, z: number, yMax: number, skip?: (i: number) => boolean): [number, number] | null {
    const c0 = this.cells.get(Math.floor(x) * 100003 + Math.floor(z));
    let best = -Infinity, bp = -1;
    for (const c of c0 ? [c0, this.big] : [this.big]) for (let q = 0; q < c.length; q += 2) {
      const pi = c[q]; if (skip?.(pi)) continue;
      const y = triY(this.pieces[pi].pos, c[q + 1], x, z);
      if (y !== null && y <= yMax && y > best) { best = y; bp = pi; }
    }
    return bp < 0 ? null : [best, bp];
  }
}
/** y of triangle t of `a` over (x, z), or null when (x, z) is outside it. */
function triY(a: Float32Array, t: number, x: number, z: number): number | null {
  const o = t * 9, ax = a[o], az = a[o + 2], bx = a[o + 3], bz = a[o + 5], cx = a[o + 6], cz = a[o + 8];
  const d = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz); if (Math.abs(d) < 1e-12) return null;
  const l1 = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / d, l2 = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / d, l3 = 1 - l1 - l2;
  if (l1 < -1e-6 || l2 < -1e-6 || l3 < -1e-6) return null;
  return l1 * a[o + 1] + l2 * a[o + 4] + l3 * a[o + 7];
}
/** [min, max] y where the vertical line (x, z) meets the piece, or null. */
export function vspan(p: LintPiece, x: number, z: number): [number, number] | null {
  if (x < p.b[0] || x > p.b[3] || z < p.b[2] || z > p.b[5]) return null;
  let lo = Infinity, hi = -Infinity;
  for (let t = 0; t < p.pos.length / 9; t++) { const y = triY(p.pos, t, x, z); if (y !== null) { if (y < lo) lo = y; if (y > hi) hi = y; } }
  return lo <= hi ? [lo, hi] : null;
}

/* ------------------------------------------------------------------ the lint */
export interface LintReport { where: string; findings: LintFinding[]; counts: Record<string, number>; ms: number; pieces: number }

export function lintWorld(src: LintSource, opts: LintOpts = {}): LintReport {
  const t0 = Date.now();
  const T = { ...TOL, ...(opts.tol as Partial<typeof TOL> | undefined) };
  const on = (c: LintClass) => !opts.only || opts.only.includes(c);
  const P = src.pieces, G = src.groundAt, gt = opts.groundTags ?? GROUND_TAGS;
  const F = P.map((p) => facts(p, gt));
  const out: LintFinding[] = [];
  const W = src.where;
  const r2 = (v: number) => Math.round(v * 100) / 100;
  const at = (x: number, y: number, z: number): [number, number, number] => [r2(x), r2(y), r2(z)];
  const ctr = (b: Float64Array): [number, number, number] => at((b[0] + b[3]) / 2, b[1], (b[2] + b[5]) / 2);
  const push = (cls: LintClass, p: LintPiece | null, a: [number, number, number], what: string, v: number, tag?: string) =>
    out.push({ cls, where: W, tag: tag ?? p?.tag ?? '', kind: p ? p.kind || p.mat : '', at: a, what, v: r2(v * 100) / 100, role: p?.role ?? '' });
  const grid = new TriGrid(P, () => true);
  const hash = new Hash2(P, (i) => !F[i].ground && !F[i].huge);
  const stairy = (p: LintPiece) => /stairs|steps|ramp/.test(p.tag);
  const railish = (p: LintPiece) => /rails?\b|rails?:/.test(p.tag);

  // ---- float / loose: union-find over contacts
  if (on('float') || on('loose') || on('lamp')) {
    const par = Int32Array.from(P.keys());
    const find = (x: number): number => { while (par[x] !== x) { par[x] = par[par[x]]; x = par[x]; } return x; };
    const uni = (a: number, b: number) => { const ra = find(a), rb = find(b); if (ra !== rb) par[ra] = rb; };
    const grounded = new Uint8Array(P.length);
    const gap = new Float64Array(P.length).fill(Infinity);
    for (const p of P) {
      const f = F[p.i];
      if (f.ground || f.huge) { grounded[p.i] = 1; continue; }
      // bottom vertices (≤ 2 cm over the lowest), at most 24 of them
      const a = p.pos, yb = p.b[1];
      let n = 0;
      for (let i = 0; i < a.length && n < 24; i += 3) {
        if (a[i + 1] > yb + 0.02) continue;
        n++;
        const x = a[i], y = a[i + 1], z = a[i + 2];
        const g = G ? y - G(x, z) : Infinity;
        if (g < gap[p.i]) gap[p.i] = g;
        if (g <= T.float) { grounded[p.i] = 1; break; }
        const h = grid.top(x, z, y + 0.02, (j) => j === p.i);
        if (h && y - h[0] <= T.float) { if (F[h[1]].ground || F[h[1]].huge) { grounded[p.i] = 1; break; } uni(p.i, h[1]); }
        // a foot slightly sunk into a terrain surface (a pine on the mountain top) stands on it too
        const s2 = grid.top(x, z, y + T.sunk, (j) => j === p.i || !(F[j].ground || F[j].huge));
        if (s2 && s2[0] >= y - T.float) { grounded[p.i] = 1; break; }
      }
      // facade layers of one object stand up to 12 cm proud of their wall (FACADE_LAYERS: sign plates, sills, glass)
      hash.near(p.b, T.layer, (j) => { if (j !== p.i && boxesTouch(p.b, P[j].b, P[j].obj === p.obj ? T.layer : T.contact)) uni(p.i, j); });
    }
    const comp = new Map<number, number[]>();
    for (const p of P) { if (F[p.i].ground || F[p.i].huge) continue; const r = find(p.i); let l = comp.get(r); if (!l) comp.set(r, (l = [])); l.push(p.i); }
    for (const l of comp.values()) {
      if (l.some((i) => grounded[i])) continue;
      let g = Infinity, lo = l[0], big = l[0];
      for (const i of l) { if (gap[i] < g) { g = gap[i]; lo = i; } if (F[i].area > F[big].area) big = i; }
      if (!(g > T.float) || g > 12) continue;
      const p = P[big], single = l.length === 1 && F[big].thick < 0.03;
      const tags = [...new Set(l.map((i) => P[i].tag))].slice(0, 3).join(', ');
      if (/lamp/.test(p.kind + p.tag) && on('lamp')) push('lamp', p, ctr(P[lo].b), `lamp part (${l.map((i) => P[i].mat).join('+')}) not attached: ${g === Infinity ? 'no ground' : g.toFixed(2) + ' m'} above the ground`, g);
      else if (single && on('loose')) push('loose', p, ctr(p.b), `thin plane ${F[big].area.toFixed(2)} m² touching nothing, ${g.toFixed(2)} m above the ground`, g);
      else if (on('float')) {
        const ub = new Float64Array([Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity]);
        for (const i of l) for (let c = 0; c < 3; c++) { ub[c] = Math.min(ub[c], P[i].b[c]); ub[c + 3] = Math.max(ub[c + 3], P[i].b[c + 3]); }
        push('float', p, ctr(P[lo].b), `${l.length} part(s) [${tags}: ${[...new Set(l.map((i) => P[i].mat))].join('+')} ${(ub[3] - ub[0]).toFixed(2)}×${(ub[4] - ub[1]).toFixed(2)}×${(ub[5] - ub[2]).toFixed(2)} m] float ${g === Infinity ? '(no ground)' : g.toFixed(2) + ' m'} with nothing under or beside them`, g);
      }
    }
  }

  // ---- sunk
  if (on('sunk') && G) {
    for (const p of P) {
      const f = F[p.i]; if (f.ground || f.huge || stairy(p) || railish(p)) continue;
      const h = p.b[4] - p.b[1]; if (h < 0.02) continue;
      if (FOUND.has(p.mat) && Math.max(p.b[3] - p.b[0], p.b[5] - p.b[2]) >= 0.8) continue;   // a wall / plinth: foundation
      const cx = (p.b[0] + p.b[3]) / 2, cz = (p.b[2] + p.b[5]) / 2, g = G(cx, cz);
      if (p.b[4] < g - 0.01) continue;   // wholly buried: invisible
      const d = g - p.b[1];
      if (d > T.sunk && d / h > T.sunkFrac) push('sunk', p, at(cx, p.b[1], cz), `${p.mat} part ${d.toFixed(2)} m below the ground (${Math.round(100 * d / h)} % of its ${h.toFixed(2)} m)`, d);
    }
  }

  // ---- overlap: convex solids of different objects
  if (on('overlap')) {
    const pl = new Map<number, Float64Array | null>();
    const planes = (i: number) => { let v = pl.get(i); if (v === undefined) pl.set(i, (v = convexPlanes(P[i]))); return v; };
    const solid = (i: number) => !F[i].ground && !F[i].huge && !F[i].flat && F[i].thick >= 0.03 && !NOT_SOLID.has(P[i].mat);
    const seen = new Set<string>();
    for (const p of P) {
      if (!solid(p.i)) continue;
      hash.near(p.b, 0, (j) => {
        if (j <= p.i || P[j].obj === p.obj || !solid(j) || !boxesTouch(p.b, P[j].b, -T.overlap)) return;
        const a = planes(p.i), b = planes(j); if (!a || !b) return;
        const d = Math.max(depthInside(P[j].pos, a), depthInside(p.pos, b));
        if (d <= T.overlap) return;
        const key = p.obj + ':' + P[j].obj; if (seen.has(key)) return; seen.add(key);
        const q = P[j];
        push('overlap', p, at((Math.max(p.b[0], q.b[0]) + Math.min(p.b[3], q.b[3])) / 2, Math.max(p.b[1], q.b[1]), (Math.max(p.b[2], q.b[2]) + Math.min(p.b[5], q.b[5])) / 2),
          `${p.tag}/${p.kind || p.mat} and ${q.tag}/${q.kind || q.mat} inside each other by ${d.toFixed(2)} m`, d);
      });
    }
  }

  // ---- overlap inside one prop: a round part (disc, wheel, barrel) sunk ≥ 25 % into a box part of the same object —
  // the grindstone's disc half inside its crate (bug 06.11 #3); architecture is exempt (walls into floors by design)
  if (on('overlap')) {
    const props = P.filter((p) => (p.src === 'inst' || /^prop/.test(p.tag)) && !F[p.i].flat && F[p.i].tris >= 24 && isRoundAny(p));
    for (const c of props) {
      hash.near(c.b, 0, (j) => {
        const q = P[j]; if (q.obj !== c.obj || q.i === c.i || F[j].tris > 12 || F[j].flat || !boxesTouch(c.b, q.b, -0.02)) return;
        const pl = convexPlanes(q); if (!pl) return;
        let inside = 0; const n = c.pos.length / 3;
        for (let i = 0; i < c.pos.length; i += 3) {
          let ins = true;
          for (let k = 0; k < pl.length; k += 4) if (pl[k] * c.pos[i] + pl[k + 1] * c.pos[i + 1] + pl[k + 2] * c.pos[i + 2] - pl[k + 3] > -0.01) { ins = false; break; }
          if (ins) inside++;
        }
        if (inside / n >= 0.25) push('overlap', c, ctr(c.b), `round ${c.mat} part ${Math.round(100 * inside / n)} % inside a box part of the same prop (${q.mat}): it reads as a half disc stuck in the box`, inside / n);
      });
    }
  }

  // ---- doors: two openings < 1 m apart on one facade
  const doors = (src.marks ?? []).filter((m) => m.kind === 'door' || m.kind === 'arch');
  if (on('door')) {
    // one building: two door openings of ONE model (a terrace of filler houses has one door per house)
    for (let i = 0; i < doors.length; i++) for (let j = i + 1; j < doors.length; j++) {
      if (doors[i].tag !== doors[j].tag || /^(filler|houses?$|terrain|props?$)/.test(doors[i].tag)) continue;
      const a = doors[i].box, b = doors[j].box;
      if (Math.abs(a[2] - b[2]) > 0.3 || a[4] > b[5] + 0.3 || b[4] > a[5] + 0.3) continue;   // other level / other facade
      const gx = Math.max(a[0], b[0]) - Math.min(a[1], b[1]), gz = Math.max(a[4], b[4]) - Math.min(a[5], b[5]);
      const g = Math.max(gx, gz);
      if (g < T.doorGap) out.push({ cls: 'door', where: W, tag: doors[i].tag, kind: doors[i].kind + '+' + doors[j].kind, at: at((a[0] + b[1]) / 2, a[2], (a[4] + a[5]) / 2), what: `two door openings ${Math.max(0, g).toFixed(2)} m apart (${doors[i].kind} + ${doors[j].kind}): one door per building door`, v: r2(g) });
    }
  }

  // ---- stairs, ramps, rails
  const flights: Float64Array[] = [];
  if ((on('stairs') || on('rails') || on('onramp')) && G) {
    const st = P.filter((p) => stairy(p) && !F[p.i].flat);
    const terrainTop = (x: number, z: number, y: number, self: (i: number) => boolean) => grid.top(x, z, y, self);
    const notStairs = (i: number) => stairy(P[i]) || railish(P[i]);
    // steps = boxes with a horizontal top, grouped into flights by x overlap and z adjacency
    const steps = st.filter((p) => p.mat !== 'wood' && F[p.i].tris <= 12 && (p.b[3] - p.b[0]) > 0.5 && (p.b[5] - p.b[2]) < 0.8 && (p.b[4] - p.b[1]) < 3);
    const used = new Set<number>();
    for (const s of steps) {
      if (used.has(s.i)) continue;
      const fl = [s]; used.add(s.i);
      for (let grow = true; grow;) {
        grow = false;
        for (const t of steps) if (!used.has(t.i) && fl.some((q) => Math.abs(q.b[0] - t.b[0]) < 0.05 && Math.abs(q.b[3] - t.b[3]) < 0.05 && Math.abs(q.b[2] - t.b[5]) < 0.02 || Math.abs(q.b[5] - t.b[2]) < 0.02 && Math.abs(q.b[0] - t.b[0]) < 0.05)) { fl.push(t); used.add(t.i); grow = true; }
      }
      if (fl.length < 3) continue;
      fl.sort((p, q) => p.b[2] - q.b[2]);
      const fb = new Float64Array([Math.min(...fl.map((q) => q.b[0])), Math.min(...fl.map((q) => q.b[1])), fl[0].b[2], Math.max(...fl.map((q) => q.b[3])), Math.max(...fl.map((q) => q.b[4])), fl[fl.length - 1].b[5]]);
      flights.push(fb);
      if (!on('stairs')) continue;
      const dir = Math.sign(fl[fl.length - 1].b[4] - fl[0].b[4]);
      for (let i = 0; i < fl.length; i++) {
        const p = fl[i], top = p.b[4], cz = (p.b[2] + p.b[5]) / 2;
        if (i && Math.sign(top - fl[i - 1].b[4]) !== dir) push('stairs', p, ctr(p.b), `flight not monotonic at step ${i} (${fl[i - 1].b[4].toFixed(2)} → ${top.toFixed(2)} m)`, Math.abs(top - fl[i - 1].b[4]));
        // the visible terrain over the step (the bank not cut for the stairs)
        let cover = 0;
        for (const fx of [0.2, 0.5, 0.8]) {
          const x = p.b[0] + (p.b[3] - p.b[0]) * fx, h = terrainTop(x, cz, top + 3, notStairs);
          if (h && h[0] > top) cover = Math.max(cover, h[0] - top);
        }
        if (cover > T.stepCover) push('stairs', p, ctr(p.b), `step ${i} buried ${cover.toFixed(2)} m under the terrain (the bank is not cut for the flight)`, cover);
        const g = G((p.b[0] + p.b[3]) / 2, cz);
        if (Math.abs(top - g) > T.stepGround) push('stairs', p, ctr(p.b), `step ${i} top ${top.toFixed(2)} m ≠ walk height ${g.toFixed(2)} m`, Math.abs(top - g));
      }
      // cheek walls: stairs pieces beside the flight (x outside the steps) must cover every step and stand in the bank
      // (only pieces hugging the flight: ≤ 0.5 m off its side in x — another flight's cheek or a plateau wall further on
      // is no side wall of this one)
      const cheeks = st.filter((p) => !fl.includes(p) && p.b[2] < fb[5] && p.b[5] > fb[2] && (p.b[3] <= fb[0] + 0.05 && p.b[3] >= fb[0] - 0.5 || p.b[0] >= fb[3] - 0.05 && p.b[0] <= fb[3] + 0.5) && p.b[5] - p.b[2] > 1);
      for (const c of cheeks) {
        let worst = 0, wf = 0, wi = -1;
        for (let i = 0; i < fl.length; i++) {
          const z = (fl[i].b[2] + fl[i].b[5]) / 2, sp = vspan(c, (c.b[0] + c.b[3]) / 2, z); if (!sp) continue;
          const short = fl[i].b[4] + T.cheekOver - sp[1]; if (short > worst) { worst = short; wi = i; }
          const ground = Math.max(G((c.b[0] + c.b[3]) / 2, z), terrainTop((c.b[0] + c.b[3]) / 2, z, sp[0] + 3, notStairs)?.[0] ?? -Infinity);
          if (sp[0] - ground > wf) wf = sp[0] - ground;
        }
        if (worst > 0.02) push('stairs', c, ctr(c.b), `cheek wall ${worst.toFixed(2)} m short of covering step ${wi} (its top must run ${T.cheekOver} m over the steps)`, worst);
        if (wf > T.float) push('stairs', c, ctr(c.b), `cheek wall floats ${wf.toFixed(2)} m above the bank / ground`, wf);
      }
    }
    // ramps (tilted wood planks in a stairs tag) and rails: their underside follows the walk height
    if (on('rails')) {
      for (const p of P) {
        const ramp = stairy(p) && p.mat === 'wood' && (p.b[4] - p.b[1]) > 0.4;
        if (!(railish(p) && p.mat === 'metal') && !ramp) continue;
        const along = p.b[3] - p.b[0] > p.b[5] - p.b[2];
        let worst = 0, wa: [number, number, number] = ctr(p.b), what = '';
        for (const f of [0.05, 0.5, 0.95]) {
          const x = along ? p.b[0] + (p.b[3] - p.b[0]) * f : (p.b[0] + p.b[3]) / 2, z = along ? (p.b[2] + p.b[5]) / 2 : p.b[2] + (p.b[5] - p.b[2]) * f;
          const sp = vspan(p, x, z); if (!sp) continue;
          const g = G(x, z), off = ramp ? sp[1] - g : sp[0] - g - 0.06;   // a ramp's top = the walk height; a rail sits on a 6 cm sleeper
          const h = terrainTop(x, z, sp[1] + 3, (i) => railish(P[i]) || stairy(P[i]) || !(F[i].ground || F[i].huge));
          const bur = h ? h[0] - sp[1] : 0;
          if (Math.abs(off) > worst) { worst = Math.abs(off); wa = at(x, sp[0], z); what = `${ramp ? 'ramp plank top' : 'rail'} ${off > 0 ? off.toFixed(2) + ' m above' : (-off).toFixed(2) + ' m below'} the walk height`; }
          if (bur > T.rail && bur > worst) { worst = bur; wa = at(x, sp[1], z); what = `${ramp ? 'ramp' : 'rail'} buried ${bur.toFixed(2)} m in ${P[h![1]].tag}`; }
        }
        if (worst > T.rail) push('rails', p, wa, what, worst);
      }
    }
    if (on('onramp')) {
      for (const p of P) if (stairy(p) && p.mat === 'wood' && (p.b[4] - p.b[1]) > 0.4) flights.push(p.b);
      const seen = new Set<number>();
      for (const p of P) {
        if (F[p.i].ground || stairy(p) || railish(p) || seen.has(p.obj) || !(p.src === 'inst' || /^prop/.test(p.tag))) continue;
        for (const fb of flights) {
          const ox = Math.min(p.b[3], fb[3] - 0.05) - Math.max(p.b[0], fb[0] + 0.05), oz = Math.min(p.b[5], fb[5] - 0.05) - Math.max(p.b[2], fb[2] + 0.05);
          if (ox > 0 && oz > 0 && p.b[1] < fb[4] + 0.3 && p.b[4] > fb[1]) { seen.add(p.obj); push('onramp', p, ctr(p.b), `${p.tag} stands on a stair / ramp footprint (${ox.toFixed(2)} × ${oz.toFixed(2)} m)`, ox * oz); break; }
        }
      }
    }
  }

  // ---- z-fight (batch pieces with a look)
  if (on('zfight')) {
    const rec = new ZRecorder();
    for (const p of P) if (p.src === 'batch') {
      const g = { attributes: { position: { array: p.pos, count: p.pos.length / 3 } }, index: null } as never;
      rec.add(p.mat as BatchKey, g, p.tag, p.look);
    }
    for (const h of rec.find(0.004, 2e-4, G)) out.push({ cls: 'zfight', where: W, tag: h.a, kind: h.b, at: h.at, what: `${h.a} × ${h.b} coplanar ${(h.area * 1e4).toFixed(0)} cm²`, v: r2(h.area) });
  }

  // ---- uv: texel density vs the material median, anisotropy
  if (on('uv')) {
    const dens: { p: LintPiece; d: number; an: number; area: number }[] = [];
    for (const p of P) {
      if (!p.uv || F[p.i].area < 0.1 || !TEXTURED.has(p.mat)) continue;
      const a = p.pos, u = p.uv; let wa = 0, ua = 0, anS = 0;
      for (let t = 0; t < a.length / 9; t++) {
        const o = t * 9, q = t * 6;
        const e1x = a[o + 3] - a[o], e1y = a[o + 4] - a[o + 1], e1z = a[o + 5] - a[o + 2], e2x = a[o + 6] - a[o], e2y = a[o + 7] - a[o + 1], e2z = a[o + 8] - a[o + 2];
        const cx = e1y * e2z - e1z * e2y, cy = e1z * e2x - e1x * e2z, cz = e1x * e2y - e1y * e2x, A = Math.hypot(cx, cy, cz) / 2; if (A < 1e-6) continue;
        const du1 = u[q + 2] - u[q], dv1 = u[q + 3] - u[q + 1], du2 = u[q + 4] - u[q], dv2 = u[q + 5] - u[q + 1];
        const UA = Math.abs(du1 * dv2 - du2 * dv1) / 2;
        // anisotropy: singular values of the 2×2 map (local orthonormal frame → uv)
        const l1 = Math.hypot(e1x, e1y, e1z); const ex = e1x / l1, ey = e1y / l1, ez = e1z / l1;
        const nl = 2 * A; const fx = (cy * ez - cz * ey) / nl, fy = (cz * ex - cx * ez) / nl, fz = (cx * ey - cy * ex) / nl;
        const p1 = [l1, 0], p2 = [e2x * ex + e2y * ey + e2z * ez, e2x * fx + e2y * fy + e2z * fz];
        const det = p1[0] * p2[1] - p2[0] * p1[1]; if (Math.abs(det) < 1e-9) continue;
        // J = [du dv] * inv([p1 p2])
        const i00 = p2[1] / det, i01 = -p2[0] / det, i10 = -p1[1] / det, i11 = p1[0] / det;
        const j00 = du1 * i00 + du2 * i10, j01 = du1 * i01 + du2 * i11, j10 = dv1 * i00 + dv2 * i10, j11 = dv1 * i01 + dv2 * i11;
        const s = j00 * j00 + j01 * j01 + j10 * j10 + j11 * j11, dd = Math.abs(j00 * j11 - j01 * j10), r = Math.sqrt(Math.max(0, s * s / 4 - dd * dd));
        const smax = Math.sqrt(s / 2 + r), smin = Math.sqrt(Math.max(1e-12, s / 2 - r));
        wa += A; ua += UA; anS += A * Math.min(20, smax / smin);
      }
      if (wa > 0) dens.push({ p, d: Math.sqrt(ua / wa), an: anS / wa, area: wa });
    }
    const byMat = new Map<string, number[]>();
    for (const d of dens) { let l = byMat.get(d.p.mat); if (!l) byMat.set(d.p.mat, (l = [])); l.push(d.d); }
    const med = new Map<string, number>();
    for (const [m, l] of byMat) { l.sort((a, b) => a - b); med.set(m, l[l.length >> 1]); }
    for (const d of dens) {
      const m = med.get(d.p.mat)!, r = d.d / Math.max(1e-6, m);
      if (r > T.uvHi || r < T.uvLo) push('uv', d.p, ctr(d.p.b), `texel density ${r.toFixed(2)} × the ${d.p.mat} median (${d.area.toFixed(2)} m²)`, r);
      else if (d.an > T.uvAniso && !(d.p.keep && F[d.p.i].tris > 40)) push('uv', d.p, ctr(d.p.b), `texture stretched ${d.an.toFixed(1)}:1 (${d.area.toFixed(2)} m²)`, d.an);
    }
  }

  // ---- huge / leaning planes
  if (on('plane')) {
    for (const p of P) {
      const f = F[p.i]; if (f.ground || /water|lowPaving|paving|back|sign/.test(p.mat)) continue;
      // the largest flat face of the piece: a flat piece itself, or a slab's broad side (box: the two largest dims)
      const dx = p.b[3] - p.b[0], dy = p.b[4] - p.b[1], dz = p.b[5] - p.b[2];
      // (a slab's broad side = the area of its largest planar face; the AABB's two largest dims would take a thin beam
      // laid along a slope or the two gable ends of a roof for a wall slab)
      const face = f.flat ? f.area : f.tris <= 12 ? broadFace(p) : 0;
      if (!face) continue;
      const lean = f.flat ? Math.abs(f.ny) > 0.15 && Math.abs(f.ny) < 0.95 && p.mat !== 'roof' : f.tris <= 12 && slanted(p);
      if (f.flat && face > T.plane) push('plane', p, ctr(p.b), `one flat plane of ${face.toFixed(1)} m² (> ${T.plane}): break it up or dress it`, face);
      else if (!f.flat && !lean && face > T.wall && dy > 2) push('plane', p, ctr(p.b), `one box face of ${face.toFixed(1)} m² (> ${T.wall}): a bare wall that size reads as a flat card`, face);
      else if (lean && face > T.leanPlane) push('plane', p, ctr(p.b), `slanted ${f.flat ? 'plane' : 'wall slab (a parallelogram: vertical sides, inclined top and bottom)'} ${face.toFixed(1)} m² (> ${T.leanPlane})`, face);
    }
  }

  // ---- ledge: a box crossing a round body mid-height
  if (on('ledge')) {
    const round = P.filter((p) => !F[p.i].ground && F[p.i].tris >= 28 && isRound(p));
    for (const c of round) {
      const rx = (c.b[3] - c.b[0]) / 2, rz = (c.b[5] - c.b[2]) / 2, cx = c.b[0] + rx, cz = c.b[2] + rz, r = Math.max(rx, rz);
      if (r < 0.6) continue;
      hash.near(c.b, 0, (j) => {
        const q = P[j]; if (q.obj !== c.obj || F[j].tris > 12 || F[j].ground) return;
        if (q.b[1] <= c.b[1] + 0.05 || q.b[4] >= c.b[4] - 0.05) return;   // a plinth under / a cap over the round body
        if (q.b[4] - q.b[1] > (c.b[4] - c.b[1]) * 0.5) return;
        // it must reach into the body: a board / mat / sign standing wholly in front of the round wall crosses nothing
        const nx = Math.max(q.b[0], Math.min(cx, q.b[3])), nz = Math.max(q.b[2], Math.min(cz, q.b[5]));
        if (Math.hypot(nx - cx, nz - cz) > r - 0.02) return;
        let out = 0, dirs = 0;
        for (const [sx, sz] of [[0, 2], [3, 2], [0, 5], [3, 5]]) {
          const d = Math.hypot(q.b[sx] - cx, q.b[sz] - cz) - r;
          if (d > T.ledgePoke) { dirs++; out = Math.max(out, d); }
        }
        if (dirs >= 2 && Math.min(q.b[3], c.b[3]) - Math.max(q.b[0], c.b[0]) > r * 0.6) push('ledge', q, ctr(q.b), `box ${q.mat} part crosses a round body (r ${r.toFixed(2)} m): ${dirs} corners up to ${out.toFixed(2)} m outside it`, out);
      });
    }
  }

  // ---- lamps (instanced kinds): every head part connected to the post, the light framed
  if (on('lamp')) {
    const byKind = new Map<string, LintPiece[]>();
    for (const p of P) if (p.src === 'inst' && /lamp|lantern/.test(p.kind) && /#0$/.test(p.tag)) { let l = byKind.get(p.kind); if (!l) byKind.set(p.kind, (l = [])); l.push(p); }
    for (const [kind, l] of byKind) {
      for (const e of l.filter((p) => p.mat === 'emit' || p.mat === 'glass' || p.mat === 'glow')) {
        const frame = l.filter((q) => q !== e && q.mat !== 'emit' && q.b[1] < e.b[4] - 0.02 && q.b[4] > e.b[1] + 0.02 && boxesTouch(q.b, e.b, 0.01) && (q.b[3] - q.b[0] < (e.b[3] - e.b[0]) * 0.6 || q.b[5] - q.b[2] < (e.b[5] - e.b[2]) * 0.6));
        const box = F[e.i].tris <= 12 && Math.min(e.b[3] - e.b[0], e.b[5] - e.b[2]) > 0.12;
        if (box && frame.length < 2) push('lamp', e, ctr(e.b), `${kind}: bare emissive box ${(e.b[3] - e.b[0]).toFixed(2)}×${(e.b[4] - e.b[1]).toFixed(2)} m with no frame (reads as a flat cream box)`, frame.length);
      }
    }
  }

  // ---- outline: the hover outline region vs the drawn door
  if (on('outline') && src.doors) {
    for (const d of src.doors) {
      const R = d.outlineBox ?? { min: d.hit.min, max: { x: d.hit.max.x, y: d.hit.max.y, z: d.hit.max.z - 0.17 } };
      const cx = (d.hit.min.x + d.hit.max.x) / 2, cz = (d.hit.min.z + d.hit.max.z) / 2;
      const mk = doors.filter((m) => Math.abs((m.box[0] + m.box[1]) / 2 - cx) < 1.5 && Math.abs((m.box[4] + m.box[5]) / 2 - cz) < 2.6 && Math.abs(m.box[2] - d.hit.min.y) < 0.6)
        .sort((m, n) => Math.abs((m.box[0] + m.box[1]) / 2 - cx) - Math.abs((n.box[0] + n.box[1]) / 2 - cx))[0];
      const tb = outlineTris(P, F, R);
      if (!mk) { push('outline', null, at(cx, d.hit.min.y, cz), `${d.id}: no drawn door mark (markDoor) — the outline cannot follow the door`, 0, d.id); continue; }
      if (!tb) { push('outline', null, at(cx, d.hit.min.y, cz), `${d.id}: the outline region holds no triangles`, 0, d.id); continue; }
      const m = mk.box, beyond = Math.max(m[0] - tb.b[0], tb.b[3] - m[1], m[2] - tb.b[1], tb.b[4] - m[3]);
      const cover = Math.min(1, (Math.min(tb.b[3], m[1]) - Math.max(tb.b[0], m[0])) / (m[1] - m[0])) * Math.min(1, (Math.min(tb.b[4], m[3]) - Math.max(tb.b[1], m[2])) / (m[3] - m[2]));
      if (beyond > T.outline) push('outline', null, at(cx, d.hit.min.y, cz), `${d.id}: outline reaches ${beyond.toFixed(2)} m beyond the drawn door (takes ${tb.tags})`, beyond, d.id);
      else if (cover < T.outlineCover) push('outline', null, at(cx, d.hit.min.y, cz), `${d.id}: outline covers ${Math.round(cover * 100)} % of the drawn door`, cover, d.id);
      else if (tb.ground) push('outline', null, at(cx, d.hit.min.y, cz), `${d.id}: outline takes terrain triangles (${tb.tags})`, 0, d.id);
    }
  }

  const allow = [...LINT_ALLOW, ...(opts.allow ?? [])];
  const findings = out.filter((f) => !allowed(allow, f));
  const counts: Record<string, number> = {};
  for (const c of ALL_CLASSES) if (on(c)) counts[c] = 0;
  for (const f of findings) counts[f.cls] = (counts[f.cls] ?? 0) + 1;
  return { where: W, findings, counts, ms: Date.now() - t0, pieces: P.length };
}

function allowed(allow: readonly AllowEntry[], f: LintFinding): boolean {
  const key = lintKey(f);
  return allow.some((a) => (a.cls === '*' || a.cls === f.cls) && a.match.test(key));
}

/** A round part in any orientation (a disc on its edge, a wheel): ≥ 10 distinct face-normal directions around one axis. */
function isRoundAny(p: LintPiece): boolean {
  const a = p.pos, dirs = new Set<string>();
  for (let t = 0; t < a.length / 9 && dirs.size < 40; t++) {
    const o = t * 9;
    const ux = a[o + 3] - a[o], uy = a[o + 4] - a[o + 1], uz = a[o + 5] - a[o + 2], vx = a[o + 6] - a[o], vy = a[o + 7] - a[o + 1], vz = a[o + 8] - a[o + 2];
    const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx, l = Math.hypot(cx, cy, cz); if (l < 1e-9) continue;
    dirs.add(`${Math.round(cx / l * 4)},${Math.round(cy / l * 4)},${Math.round(cz / l * 4)}`);
  }
  return dirs.size >= 10;
}

/** Is the piece a round body (≥ 8 distinct horizontal side-face directions)? */
function isRound(p: LintPiece): boolean {
  const a = p.pos, dirs = new Set<number>();
  for (let t = 0; t < a.length / 9; t++) {
    const o = t * 9;
    const ux = a[o + 3] - a[o], uy = a[o + 4] - a[o + 1], uz = a[o + 5] - a[o + 2], vx = a[o + 6] - a[o], vy = a[o + 7] - a[o + 1], vz = a[o + 8] - a[o + 2];
    const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx, l = Math.hypot(cx, cy, cz);
    if (l < 1e-9 || Math.abs(cy / l) > 0.08) continue;
    dirs.add(Math.round(Math.atan2(cz, cx) * 6));
  }
  return dirs.size >= 10;
}
/** A box piece whose broad side stands upright but whose long edges are inclined 10–80° (a wall slab tilted along a
 *  slope: the stair cheek walls «running down the slope», the leaning brick wall of bug 06.11 #1). Roofs and ramps
 *  (broad side facing up) are not slanted walls. */
/** Area of the largest planar face of a small piece (≤ 12 tris): the triangles in the plane of its largest one. */
function broadFace(p: LintPiece): number {
  const a = p.pos, nT = a.length / 9, N: number[][] = [];
  let bt = -1, best = 0;
  for (let t = 0; t < nT; t++) {
    const o = t * 9;
    const ux = a[o + 3] - a[o], uy = a[o + 4] - a[o + 1], uz = a[o + 5] - a[o + 2], vx = a[o + 6] - a[o], vy = a[o + 7] - a[o + 1], vz = a[o + 8] - a[o + 2];
    const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx, l = Math.hypot(cx, cy, cz);
    N.push(l > 1e-9 ? [cx / l, cy / l, cz / l, (cx * a[o] + cy * a[o + 1] + cz * a[o + 2]) / l, l / 2] : [0, 0, 0, 0, 0]);
    if (l > best) { best = l; bt = t; }
  }
  if (bt < 0) return 0;
  const [nx, ny, nz, d] = N[bt];
  let area = 0;
  for (const q of N) if (q[0] * nx + q[1] * ny + q[2] * nz > 0.999 && Math.abs(q[3] - d) < 0.01) area += q[4];
  return area;
}

function slanted(p: LintPiece): boolean {
  const a = p.pos; let best = 0, bt = -1;
  for (let t = 0; t < a.length / 9; t++) {
    const o = t * 9;
    const ux = a[o + 3] - a[o], uy = a[o + 4] - a[o + 1], uz = a[o + 5] - a[o + 2], vx = a[o + 6] - a[o], vy = a[o + 7] - a[o + 1], vz = a[o + 8] - a[o + 2];
    const l = Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx); if (l > best) { best = l; bt = t; }
  }
  if (bt < 0) return false;
  const o = bt * 9;
  const ux = a[o + 3] - a[o], uy = a[o + 4] - a[o + 1], uz = a[o + 5] - a[o + 2], vx = a[o + 6] - a[o], vy = a[o + 7] - a[o + 1], vz = a[o + 8] - a[o + 2];
  const ny = Math.abs((uz * vx - ux * vz) / best); if (ny > 0.15) return false;
  // the two legs of the face's largest triangle (the hypotenuse is the face diagonal): a rectangle has one horizontal
  // and one vertical leg, a parallelogram inclined ones
  const e = [[ux, uy, uz], [vx, vy, vz], [vx - ux, vy - uy, vz - uz]].sort((p, q) => Math.hypot(p[0], p[1], p[2]) - Math.hypot(q[0], q[1], q[2])).slice(0, 2);
  let incl = 0;
  for (const [dx, dy, dz] of e) { const s = Math.abs(dy) / Math.hypot(dx, dy, dz); if (s > 0.17 && s < 0.98) incl++; }
  return incl > 0 && Math.max(...e.map((v) => Math.hypot(v[0], v[1], v[2]))) > 1.5;
}

/** AABB of the triangles the door outline would take (doors.ts: wholly inside the region, above the floor lift). */
function outlineTris(P: LintPiece[], F: Fact[], R: { min: { x: number; y: number; z: number }; max: { x: number; y: number; z: number } }): { b: Float64Array; tags: string; ground: boolean } | null {
  const e = 0.02, lift = R.min.y + 0.12;
  const b = new Float64Array([Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity]);
  const tags = new Set<string>(); let ground = false, any = false;
  for (const p of P) {
    if (p.b[3] < R.min.x - e || p.b[0] > R.max.x + e || p.b[4] < R.min.y || p.b[1] > R.max.y + e || p.b[5] < R.min.z - e || p.b[2] > R.max.z + e) continue;
    if (p.mat === 'back' || p.mat === 'glow') continue;
    const a = p.pos;
    for (let t = 0; t < a.length / 9; t++) {
      const o = t * 9; let ok = true, low = true;
      for (let v = 0; v < 3 && ok; v++) {
        const x = a[o + v * 3], y = a[o + v * 3 + 1], z = a[o + v * 3 + 2];
        ok = x >= R.min.x - e && x <= R.max.x + e && y >= R.min.y - 0.012 && y <= R.max.y + e && z >= R.min.z - e && z <= R.max.z + e;
        if (y >= lift) low = false;
      }
      if (!ok || low) continue;
      any = true; tags.add(p.tag); if (F[p.i].ground) ground = true;
      for (let v = 0; v < 3; v++) for (let c = 0; c < 3; c++) { const q = a[o + v * 3 + c]; if (q < b[c]) b[c] = q; if (q > b[c + 3]) b[c + 3] = q; }
    }
  }
  return any ? { b, tags: [...tags].slice(0, 4).join(', '), ground } : null;
}

/** One line per finding, grouped by class (for test logs and the dev page console). */
export function formatFindings(r: LintReport, max = 30): string {
  const lines = [`[lint] ${r.where}: ${r.pieces} pieces, ${r.ms} ms — ` + Object.entries(r.counts).filter(([, n]) => n).map(([c, n]) => `${c} ${n}`).join(', ')];
  for (const f of r.findings.slice(0, max)) lines.push(`  ${f.cls.padEnd(7)} ${f.tag} [${f.kind}] at ${f.at.join(',')}: ${f.what}`);
  if (r.findings.length > max) lines.push(`  … ${r.findings.length - max} more`);
  return lines.join('\n');
}
