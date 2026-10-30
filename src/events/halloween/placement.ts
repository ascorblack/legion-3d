/**
 * Where the Halloween things go. Pure functions of a sampled city (no three.js): the city is rasterised once into a
 * 0.125 m grid (open ground / flat / walk grid) and everything is placed against that grid:
 *  - pumpkin clusters HUG walls, rails, stair cheeks and props (never the middle of the street), prefer door sides,
 *    stair ends and the dead strips that the walk grid does not use (the ledge strip), keep ≥ 0.6 m from every door
 *    interactable and from the spawn, and stand only on flat open ground (no stairs, no ledge edge, no water);
 *  - fog patches lie on flat ground only (a plane never floats over a ramp);
 *  - ghosts hover over open air away from walls, at 2.3–3 m (above heads, never in a door lane).
 * Deterministic for a seed. Heights come from the city's own ground function.
 */

export interface PlaceCity {
  /** Ground height at a point (m). */
  groundAt(X: number, Z: number): number;
  /** Top of what stands at the point (World3DExt.solidTop in metres): -Infinity = open ground. */
  top(X: number, Z: number): number;
  /** Walk grid. */
  free(X: number, Z: number): boolean;
  /** Walkable area, metres. */
  area: { x0: number; x1: number; z0: number; z1: number };
  /** Door interactables: footprint boxes in metres (x0, x1, z0, z1) and the door point. */
  doors: { x: number; z: number; box: [number, number, number, number] }[];
  /** Stair x-ranges (m) and the depth where the ramp starts (m). */
  stairs: [number, number][];
  ledgeZ: number;
  spawn: { x: number; z: number };
  /** Spots no pumpkin may stand on even off the walk grid (the hw NPCs' bases): edge clusters use non-walkable cells. */
  keepOut?(X: number, Z: number): boolean;
}

export interface PumpkinSpec {
  x: number; y: number; z: number;
  /** radius (m) of the unit pumpkin scaled to this */
  r: number;
  yaw: number;
  /** 0 plain, 1 jack-o'-lantern face A, 2 face B */
  kind: 0 | 1 | 2;
  /** warm tint index (0 orange, 1 deep orange, 2 golden, 3 pale) */
  tint: number;
}
export interface Cluster { tag: 'door' | 'stair' | 'edge' | 'wall'; x: number; z: number; items: PumpkinSpec[] }
export interface FogSpec { x: number; y: number; z: number; r: number; rot: number; rot2: number }
export interface GhostSpec { x: number; y: number; z: number; phase: number; r: number }
/** A jack-o'-lantern hanging from a short bracket on a facade, beside a door (out of the door's way and above head height). */
export interface WallLantern { x: number; y: number; z: number; wallZ: number; yaw: number }
export interface Plan { clusters: Cluster[]; fog: FogSpec[]; ghosts: GhostSpec[]; lanterns: WallLantern[] }

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

const CELL = 0.125;
/** Half-height of a unit pumpkin from its centre to its lowest point / to its flat top (test/events-halloween checks it against the geometry). */
export const PUMPKIN_HALF = 0.7;
/** Clearance a door interactable keeps free around it (m), measured to the edge of a decoration. */
export const DOOR_CLEAR = 0.6;
const SPAWN_CLEAR = 1.8;

export class Grid {
  readonly nx: number; readonly nz: number;
  readonly open: Uint8Array;       // 1 = open ground (nothing solid)
  readonly gnd: Float32Array;
  readonly walk: Uint8Array;
  /** distance (m) to the nearest blocked cell (non-open, or next to a ground drop/ramp) */
  readonly dist: Float32Array;
  readonly x0: number; readonly z0: number;
  constructor(readonly c: PlaceCity) {
    this.x0 = Math.floor(c.area.x0); this.z0 = Math.floor(c.area.z0);
    this.nx = Math.ceil((c.area.x1 - this.x0) / CELL); this.nz = Math.ceil((c.area.z1 - this.z0) / CELL);
    const n = this.nx * this.nz;
    this.open = new Uint8Array(n); this.gnd = new Float32Array(n); this.walk = new Uint8Array(n); this.dist = new Float32Array(n);
    for (let j = 0; j < this.nz; j++) for (let i = 0; i < this.nx; i++) {
      const X = this.x0 + (i + 0.5) * CELL, Z = this.z0 + (j + 0.5) * CELL, k = j * this.nx + i;
      const inside = X >= c.area.x0 && X <= c.area.x1 && Z >= c.area.z0 && Z <= c.area.z1;
      this.open[k] = inside && c.top(X, Z) === -Infinity ? 1 : 0;
      this.gnd[k] = c.groundAt(X, Z);
      this.walk[k] = c.free(X, Z) ? 1 : 0;
    }
    // blocked = solid, or a cell whose neighbour differs in height by > 0.12 (ledge edge, stairs, canal bank)
    const blocked = new Uint8Array(n);
    for (let j = 0; j < this.nz; j++) for (let i = 0; i < this.nx; i++) {
      const k = j * this.nx + i; let b = this.open[k] ? 0 : 1;
      if (!b) for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const ii = i + di, jj = j + dj; if (ii < 0 || jj < 0 || ii >= this.nx || jj >= this.nz) { b = 1; break; }
        if (Math.abs(this.gnd[jj * this.nx + ii] - this.gnd[k]) > 0.12) { b = 1; break; }
      }
      blocked[k] = b;
    }
    // chamfer distance transform (3-4)
    const D = this.dist, INF = 1e9; for (let k = 0; k < n; k++) D[k] = blocked[k] ? 0 : INF;
    const nx = this.nx, nz = this.nz, a = 1, b = 1.4142;
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
      const k = j * nx + i; let v = D[k]; if (v === 0) continue;
      if (i > 0) v = Math.min(v, D[k - 1] + a);
      if (j > 0) { v = Math.min(v, D[k - nx] + a); if (i > 0) v = Math.min(v, D[k - nx - 1] + b); if (i < nx - 1) v = Math.min(v, D[k - nx + 1] + b); }
      D[k] = v;
    }
    for (let j = nz - 1; j >= 0; j--) for (let i = nx - 1; i >= 0; i--) {
      const k = j * nx + i; let v = D[k]; if (v === 0) continue;
      if (i < nx - 1) v = Math.min(v, D[k + 1] + a);
      if (j < nz - 1) { v = Math.min(v, D[k + nx] + a); if (i < nx - 1) v = Math.min(v, D[k + nx + 1] + b); if (i > 0) v = Math.min(v, D[k + nx - 1] + b); }
      D[k] = v;
    }
    for (let k = 0; k < n; k++) D[k] = Math.min(D[k] * CELL, 99);
  }
  ix(X: number): number { return Math.floor((X - this.x0) / CELL); }
  iz(Z: number): number { return Math.floor((Z - this.z0) / CELL); }
  in(i: number, j: number): boolean { return i >= 0 && j >= 0 && i < this.nx && j < this.nz; }
  at(X: number, Z: number): number { const i = this.ix(X), j = this.iz(Z); return this.in(i, j) ? j * this.nx + i : -1; }
  distAt(X: number, Z: number): number { const k = this.at(X, Z); return k < 0 ? 0 : this.dist[k]; }
  /** Open ground and flat (±tol) over a disc of radius r around (X,Z)? */
  flat(X: number, Z: number, r: number, tol = 0.025): boolean {
    const k0 = this.at(X, Z); if (k0 < 0 || !this.open[k0]) return false;
    const g0 = this.gnd[k0], steps = Math.max(1, Math.ceil(r / CELL));
    for (let dj = -steps; dj <= steps; dj++) for (let di = -steps; di <= steps; di++) {
      if (di * di + dj * dj > steps * steps) continue;
      const i = this.ix(X) + di, j = this.iz(Z) + dj; if (!this.in(i, j)) return false;
      const k = j * this.nx + i; if (!this.open[k] || Math.abs(this.gnd[k] - g0) > tol) return false;
    }
    return true;
  }
  /** Unit vector pointing away from the nearest blocked cell (towards open space); null in the middle of nowhere. */
  away(X: number, Z: number): [number, number] | null {
    let bx = 0, bz = 0, bd = 1e9;
    const R = Math.ceil(1.3 / CELL), i0 = this.ix(X), j0 = this.iz(Z);
    for (let dj = -R; dj <= R; dj++) for (let di = -R; di <= R; di++) {
      const i = i0 + di, j = j0 + dj; if (!this.in(i, j)) continue;
      if (this.dist[j * this.nx + i] > 0) continue;
      const d = di * di + dj * dj; if (d < bd) { bd = d; bx = di; bz = dj; }
    }
    if (bd > 1e8) return null;
    const l = Math.hypot(bx, bz) || 1; return [-bx / l, -bz / l];
  }
}

const boxDist = (x: number, z: number, b: [number, number, number, number]) => Math.hypot(Math.max(b[0] - x, 0, x - b[1]), Math.max(b[2] - z, 0, z - b[3]));

/** Is a decoration of radius r at (X,Z) at least DOOR_CLEAR away from every door interactable and from the spawn? */
export function clearOfDoors(c: PlaceCity, X: number, Z: number, r: number): boolean {
  for (const d of c.doors) if (boxDist(X, Z, d.box) < r + DOOR_CLEAR) return false;
  return Math.hypot(X - c.spawn.x, Z - c.spawn.z) >= r + SPAWN_CLEAR;
}

export function planHalloween(c: PlaceCity, seed = 31): Plan {
  const rnd = mulberry32(seed), g = new Grid(c);
  const pick = <T>(a: T[]) => a[Math.floor(rnd() * a.length)];

  /* ---------------------------------------------------------------- pumpkin clusters */
  interface Cand { x: number; z: number; score: number; tag: Cluster['tag'] }
  const cands: Cand[] = [];
  for (let j = 0; j < g.nz; j++) for (let i = 0; i < g.nx; i++) {
    const k = j * g.nx + i; if (!g.open[k]) continue;
    const d = g.dist[k]; if (d < 0.36 || d > 0.7) continue;
    if (((i * 7 + j * 13) & 1) === 1) continue;               // thin the field
    const X = g.x0 + (i + 0.5) * CELL, Z = g.z0 + (j + 0.5) * CELL;
    if (!g.flat(X, Z, 0.34)) continue;
    if (!clearOfDoors(c, X, Z, 0.36)) continue;
    if (c.keepOut?.(X, Z)) continue;
    let near = 99, tag: Cluster['tag'] = 'wall', score = rnd() * 1.2 + (d - 0.36) * 4;   // roomier spots first: bigger pumpkins fit
    for (const dd of c.doors) { const dx = Math.abs(X - dd.x), dz = Math.abs(Z - dd.z); if (dz < 1.7) near = Math.min(near, dx); }
    if (near < 3.6) { tag = 'door'; score += 5 - near * 0.3; }
    for (const [s0, s1] of c.stairs) {
      const dx = X < s0 ? s0 - X : X > s1 ? X - s1 : 0;
      if (dx < 1.6 && Math.abs(Z - c.ledgeZ) < 3.2 && !(X > s0 && X < s1)) { tag = 'stair'; score += 3.4 - dx; }
    }
    if (tag === 'wall' && !g.walk[k]) { tag = 'edge'; score += 2.2; }       // dead strip the walk grid never uses
    else if (!g.walk[k]) score += 1.5;
    // near the spawn first: with a small budget (q0–1) the decorations are where everyone starts and looks
    score += Math.max(0, 3 - Math.hypot(X - c.spawn.x, Z - c.spawn.z) / 6);
    cands.push({ x: X, z: Z, score, tag });
  }
  cands.sort((a, b) => b.score - a.score);
  const chosen: Cand[] = [], MIN = 1.7, perTag: Record<string, number> = {};
  const CAP: Record<string, number> = { door: 30, stair: 18, edge: 12, wall: 22 };
  for (const cd of cands) {
    if ((perTag[cd.tag] ?? 0) >= CAP[cd.tag]) continue;
    if (chosen.some((o) => Math.hypot(o.x - cd.x, o.z - cd.z) < (o.tag === cd.tag ? MIN : MIN * 0.85))) continue;
    chosen.push(cd); perTag[cd.tag] = (perTag[cd.tag] ?? 0) + 1;
  }
  // interleave tags so that a quality cut (prefix) keeps a mix: doors, stairs, edges, walls round-robin
  const byTag = new Map<string, Cand[]>(); for (const cd of chosen) (byTag.get(cd.tag) ?? byTag.set(cd.tag, []).get(cd.tag)!).push(cd);
  const order: Cand[] = [];
  for (let n = 0; order.length < chosen.length; n++) for (const t of ['door', 'stair', 'edge', 'wall', 'door']) { const a = byTag.get(t); if (a && a[n]) order.push(a[n]); if (order.length >= chosen.length) break; }
  const clusters: Cluster[] = [];
  const seen = new Set<Cand>(); const uniq = order.filter((o) => (seen.has(o) ? false : (seen.add(o), true)));
  uniq.forEach((cd, n) => {
    const aw = g.away(cd.x, cd.z) ?? [0, 1];
    const tx = -aw[1], tz = aw[0], flip = rnd() < 0.5 ? 1 : -1;
    const items: PumpkinSpec[] = [];
    const jackMain = cd.tag === 'door' || cd.tag === 'stair' ? rnd() < 0.95 : rnd() < 0.7;
    const add = (x: number, z: number, r: number, kind: 0 | 1 | 2, stackedOn?: PumpkinSpec) => {
      if (!stackedOn) {
        if (!g.flat(x, z, r + 0.03) || g.distAt(x, z) < r + 0.02 || !clearOfDoors(c, x, z, r) || c.keepOut?.(x, z)) return false;
      }
      const gy = c.groundAt(x, z);
      const y = stackedOn ? stackedOn.y + stackedOn.r * (PUMPKIN_HALF - 0.04) + r * (PUMPKIN_HALF - 0.04) : gy + r * PUMPKIN_HALF;
      const faceYaw = Math.atan2(aw[0], aw[1]) + (rnd() - 0.5) * 0.7;
      items.push({ x: stackedOn ? stackedOn.x + (rnd() - 0.5) * 0.04 : x, y, z: stackedOn ? stackedOn.z + (rnd() - 0.5) * 0.04 : z, r,
        yaw: kind === 2 ? faceYaw + Math.PI : kind === 1 ? faceYaw : rnd() * 6.283, kind, tint: Math.floor(rnd() * 4) });
      return true;
    };
    const rMain = Math.min((cd.tag === 'door' || cd.tag === 'stair' ? 0.43 : 0.33) + rnd() * 0.12, g.distAt(cd.x, cd.z) - 0.03);
    const mainKind = (jackMain ? (rnd() < 0.5 ? 1 : 2) : 0) as 0 | 1 | 2;
    const main = add(cd.x, cd.z, rMain, mainKind) ? items[items.length - 1] : null;
    if (!main) return;
    const r2 = 0.22 + rnd() * 0.07;
    add(cd.x + tx * flip * (rMain + r2 * 0.8), cd.z + tz * flip * (rMain + r2 * 0.8), r2, (rnd() < 0.3 ? 1 : 0) as 0 | 1);
    const r3 = 0.15 + rnd() * 0.06;
    add(cd.x - tx * flip * (rMain + r3 * 0.9) + aw[0] * 0.18, cd.z - tz * flip * (rMain + r3 * 0.9) + aw[1] * 0.18, r3, 0);
    if (rnd() < 0.55) add(0, 0, 0.11 + rnd() * 0.04, 0, main);
    if (rnd() < 0.5) add(cd.x + aw[0] * (rMain + 0.2), cd.z + aw[1] * (rMain + 0.2), 0.12, 0);
    clusters.push({ tag: cd.tag, x: cd.x, z: cd.z, items });
    void n; void pick;
  });

  /* ---------------------------------------------------------------- fog patches (flat ground only) */
  const fog: FogSpec[] = [];
  const fcands: [number, number][] = [];
  for (let j = 0; j < g.nz; j += 4) for (let i = 0; i < g.nx; i += 4) {
    const X = g.x0 + (i + 0.5) * CELL, Z = g.z0 + (j + 0.5) * CELL;
    if (g.dist[j * g.nx + i] < 0.7) continue;
    fcands.push([X, Z]);
  }
  for (let n = fcands.length - 1; n > 0; n--) { const m = Math.floor(rnd() * (n + 1)); [fcands[n], fcands[m]] = [fcands[m], fcands[n]]; }
  for (const [X, Z] of fcands) {
    if (fog.length >= 16) break;
    const r = 2.0 + rnd() * 1.5;
    if (fog.some((f) => Math.hypot(f.x - X, f.z - Z) < (f.r + r) * 0.85)) continue;
    // the whole plane (radius r) must lie over flat open ground: no ramps, no ledge, no water, no wall poking through
    if (!g.flat(X, Z, r * 0.8, 0.03)) continue;
    fog.push({ x: X, y: c.groundAt(X, Z), z: Z, r, rot: rnd() * 6.283, rot2: rnd() * 6.283 });
  }

  /* ---------------------------------------------------------------- ghost cats: over open air, off the door lanes */
  const ghosts: GhostSpec[] = [];
  const anchors = [14, 27, 36, 47, 21, 42, 8, 51];
  for (const ax of anchors) {
    let best: [number, number] | null = null, bs = -1;
    for (let dz = 1.2; dz <= 4.6; dz += 0.4) for (let dx = -3; dx <= 3; dx += 0.5) {
      const X = ax + dx, Z = dz;
      if (g.distAt(X, Z) < 1.0 || !g.flat(X, Z, 0.5)) continue;
      if (c.doors.some((d) => Math.abs(X - d.x) < 1.6 && Z < d.z + 2.5)) continue;       // not over a door lane
      if (Math.hypot(X - c.spawn.x, Z - c.spawn.z) < 2.5) continue;
      const s = g.distAt(X, Z) + rnd() * 0.6; if (s > bs) { bs = s; best = [X, Z]; }
    }
    if (best) ghosts.push({ x: best[0], y: c.groundAt(best[0], best[1]) + 2.35 + rnd() * 0.55, z: best[1], phase: rnd() * 6.283, r: 0.5 + rnd() * 0.5 });
  }

  /* ---------------------------------------------------------------- wall lanterns beside doors */
  const lanterns: WallLantern[] = [];
  for (const d of c.doors) {
    if (d.z > 3.5 || d.z < -1) continue;                                            // upper-street facades only
    for (const side of [-1, 1]) {
      const x = d.x + side * (Math.max(d.box[1] - d.box[0], 1.4) / 2 + 0.95);       // ≥ 0.6 m clear of the door box (lantern radius .19 + .16 spare)
      let z = d.z; while (z > -1 && c.top(x, z - 0.1) === -Infinity) z -= 0.1;       // march to the facade
      if (z < -0.5 || z > 2.5) continue;
      const wz = z - 0.1;                                                           // first solid cell
      if (c.top(x, wz) === -Infinity) continue;
      if (c.doors.some((o) => o !== d && Math.abs(o.x - x) < 1.0)) continue;        // would sit in front of another door
      const lz = z - 0.02 + 0.42, airy = (X: number, Z: number) => { const t = c.top(X, Z); return t === -Infinity || (Number.isFinite(t) && t < 1.4); };
      if (![[0, 0], [0.2, 0], [-0.2, 0], [0, 0.2], [0, -0.2]].every(([dx, dz]) => airy(x + dx, lz + dz))) continue;   // a lamp, post or stall in the way
      lanterns.push({ x, y: c.groundAt(x, z) + 2.15, z: z - 0.02 + 0.42, wallZ: z - 0.02, yaw: rnd() * 0.5 - 0.25 });
    }
  }
  return { clusters, fog, ghosts, lanterns };
}
