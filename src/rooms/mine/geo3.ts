/**
 * Mine geometry as one object (MineGeom) for both floor kinds the site has:
 *  - GEO1 — the classic 7 × 12 floor with the entrance area below it (wraps geo.ts, unchanged);
 *  - mine3Geo(fl) — «Шахта 3.0» (site 29.10, flag mine3): a big non-linear floor of w × h cells of 128 px with a PAD of
 *    solid rock around it and the lift hall (hallBox, in cells) inside the floor. A faithful port of the site's world
 *    library LGWorldLib.mine3 (lib/world.js, same rules as the game server): cellXY / cellAt / walkable (dug cells only;
 *    the hall is dug from the start) / pathTo / digSpot / walkPt (hall: free() around the hall objects; dug cell: as is;
 *    anything else → the hall spawn) / FOOT of the hall objects (lift cage, supplier, buyer, board) / spawn.
 * Room metres for v3: X = (x − hall centre x) · K, Z = (y − hall centre y) · K (K = 2.4 m per cell, as GEO1).
 * Pure TS, no THREE / DOM (test/mine3-geo.test.ts checks parity with the site library on a captured floor).
 */
import * as G1 from './geo';
import { CW, RH, REACH, K, inR, segHit, hashL, type Foot, type Rect, type Pt, type Dug } from './geo';

export interface CellPt { x: number; y: number; cx: number; cy: number }
export interface MineGeom {
  readonly v3: boolean;
  /** Cells of the floor (7·12 or w·h). */
  readonly N: number;
  readonly w: number; readonly h: number;
  readonly CW: number; readonly RH: number;
  /** Max distance (px) from a stone centre at which digging is allowed. */
  readonly REACH: number;
  /** metres per px. */
  readonly K: number;
  /** Objects of the entrance area / lift hall (site FOOT). */
  readonly FOOT: Foot[];
  /** Where one may stand in the entrance area / lift hall (site ZONE). */
  readonly ZONE: Rect;
  /** v3: the hall in px [x, y, w, h] and in cells [gx, gy, w, h]; GEO1: the entrance area. */
  readonly hall: Rect; readonly hallBox: Rect;
  /** World size (px). */
  readonly W: number; readonly H: number;
  /** Width of the solid rock round a big floor (m; 0 on the classic floor). */
  readonly PADM: number;
  cellXY(i: number): CellPt;
  cellAt(x: number, y: number): number;
  cellOfPt(x: number, y: number): number;
  centerOf(i: number): Pt;
  nbrs(i: number): number[];
  walkable(dug: Dug, i: number): boolean;
  pathTo(dug: Dug, from: number, to: number): number[] | null;
  digSpot(dug: Dug, i: number): number | null;
  walkPt(dug: Dug, p: Pt, stop?: boolean, F?: Foot[]): Pt;
  free(x: number, y: number, F?: Foot[], stop?: boolean): Pt;
  route(a: Pt, b: Pt, F?: Foot[]): Pt[];
  /** Cell c is in the entrance area (GEO1: virtual row 12) / the lift hall (v3): walks go around the objects there. */
  inZone(c: number): boolean;
  /** Can a body stand at px point (x, y)? pad = body margin (px) to objects and (v3) to rock. */
  standable(dug: Dug, x: number, y: number, pad?: number, F?: Foot[]): boolean;
  /** Own spawn point (site spawnPt). */
  spawn(login: string): Pt;
  /** Where to walk to use an object (FOOT at). */
  frontOfObj(k: string, login?: string): Pt;
  /** Front stones by the site's rule: not dug, diggable, with a walkable 4-neighbour (types[i] = cell type). */
  frontOf(dug: Dug, types: ArrayLike<string | undefined>): number[];
  mx(x: number): number; mz(y: number): number; px(X: number): number; py(Z: number): number;
}

/* ------------------------------------------------------------------ classic floor */
export const GEO1: MineGeom = {
  v3: false, N: G1.N_CELLS, w: G1.GW, h: G1.GH, CW, RH, REACH, K,
  FOOT: G1.FOOT, ZONE: G1.ZONE, hall: [G1.SIDE, G1.YB, G1.GW * CW, G1.BOT], hallBox: [0, G1.GH, G1.GW, 1], W: G1.W, H: G1.H, PADM: 0,
  cellXY: G1.cellXY, cellAt: G1.cellAt, cellOfPt: G1.cellOfPt, centerOf: G1.centerOf, nbrs: G1.nbrs,
  walkable: G1.walkable, pathTo: G1.pathTo, digSpot: G1.digSpot, walkPt: G1.walkPt, free: G1.free, route: G1.route,
  inZone: (c) => c >= G1.N_CELLS,
  standable: G1.standable,
  spawn: (login) => G1.spawnPt(login),
  frontOfObj: (k, login = '') => G1.frontOfObj(k, login),
  frontOf: (dug, types) => G1.frontOf(dug, types as ArrayLike<string>),
  mx: G1.mx, mz: G1.mz, px: G1.px, py: G1.py,
};

/* ------------------------------------------------------------------ «Шахта 3.0» */
export interface Floor3Info { w: number; h: number; hallBox?: number[] | null }
/** Cell types that are open by themselves (site mine3.js OPEN). */
export const OPEN3 = new Set(['lift', 'void', 'shaft']);
/** Not diggable (front excludes them). */
const NODIG3 = new Set(['wall', 'void', 'lift', 'shaft', 'entry']);
export const PAD3 = 2;
/** Body margin to rock in the big floor (px): tunnel walls are rock lumps that bulge ~0.25 m into the passage. */
export const ROCK_PAD = 16;

const M3C = new Map<string, MineGeom>();
/** Geometry of a big floor (site LGWorldLib.mine3(info)); cached by size and hall. */
export function mine3Geo(info: Floor3Info): MineGeom {
  const w = Math.max(1, +info.w || 1), h = Math.max(1, +info.h || 1), hb = (info.hallBox && info.hallBox.length >= 4 ? info.hallBox.slice(0, 4).map((v) => +v || 0) : [0, 0, 4, 3]) as Rect;
  const key = `${w}x${h}:${hb.join(',')}`;
  const hit = M3C.get(key); if (hit) return hit;
  const PAD = PAD3, N = w * h, WW = (w + PAD * 2) * CW, HH = (h + PAD * 2) * RH, X0 = PAD * CW, Y0 = PAD * RH;
  const cellXY = (i: number): CellPt => { const gx = i % w, gy = Math.floor(i / w); return { x: X0 + gx * CW + CW / 2, y: Y0 + gy * RH + RH * 0.78, cx: X0 + gx * CW + CW / 2, cy: Y0 + gy * RH + RH / 2 }; };
  const cellAt = (x: number, y: number) => { const gx = Math.floor((x - X0) / CW), gy = Math.floor((y - Y0) / RH); return gx < 0 || gy < 0 || gx >= w || gy >= h ? -1 : gy * w + gx; };
  const hx = X0 + hb[0] * CW, hy = Y0 + hb[1] * RH, hw = hb[2] * CW, hh = hb[3] * RH;
  const ZONE: Rect = [hx + 12, hy + 40, hx + hw - 12, hy + hh - 10];
  const inHall = (i: number) => { if (i < 0) return false; const gx = i % w, gy = Math.floor(i / w); return gx >= hb[0] && gx < hb[0] + hb[2] && gy >= hb[1] && gy < hb[1] + hb[3]; };
  // hall objects (from the hall's top-left corner, 512 × 384): lift cage top centre, supplier top left, buyer bottom left, board bottom right
  const FOOT: Foot[] = [
    { k: 'lift', r: [hx + 196, hy + 60, hx + 316, hy + 168], s: [hx + 196, hy, hx + 316, hy + 168], z: hy + 164 },
    { k: 'lamp', lamp: 1, r: [hx + 20, hy + 92, hx + 150, hy + 150], s: [hx + 20, hy + 40, hx + 150, hy + 150], z: hy + 146, at: [hx + 96, hy + 186] },
    { k: 'npcLamp', npc: 'lamp', lamp: 1, r: [hx + 150, hy + 118, hx + 186, hy + 150], s: [hx + 150, hy + 118, hx + 186, hy + 150], z: hy + 146 },
    { k: 'buyer', r: [hx + 20, hy + 280, hx + 176, hy + 344], s: [hx + 20, hy + 220, hx + 176, hy + 344], z: hy + 340, at: [hx + 120, hy + 366] },
    { k: 'npcBuy', npc: 'buy', r: [hx + 176, hy + 312, hx + 212, hy + 344], s: [hx + 176, hy + 312, hx + 212, hy + 344], z: hy + 340 },
    { k: 'board', r: [hx + 356, hy + 300, hx + 492, hy + 350], s: [hx + 356, hy + 230, hx + 492, hy + 350], z: hy + 346, at: [hx + 424, hy + 370] },
  ];
  function free(x: number, y: number, F: Foot[] = FOOT, stop = true): Pt {
    x = +x || 0; y = +y || 0;
    const cl = (a: number, b: number): [number, number] => [Math.round(Math.max(ZONE[0], Math.min(ZONE[2], a))), Math.round(Math.max(ZONE[1], Math.min(ZONE[3], b)))];
    const R = F.map((f) => (stop ? f.s : f.r)), bad = (a: number, b: number) => R.some((r) => inR([r[0] - 3, r[1] - 3, r[2] + 3, r[3] + 3], a, b));
    const [cx, cy] = cl(x, y); if (!bad(cx, cy)) return { x: cx, y: cy };
    let best: Pt | null = null, bd = Infinity;
    const tryP = (a: number, b: number) => { const [qx, qy] = cl(a, b); if (bad(qx, qy)) return; const d = Math.hypot(qx - x, qy - y); if (d < bd) { bd = d; best = { x: qx, y: qy }; } };
    for (const r of R) { tryP(r[0] - 4, cy); tryP(r[2] + 4, cy); tryP(cx, r[1] - 4); tryP(cx, r[3] + 4); }
    for (let d = 16; !best && d < 600; d += 16) for (let a = 0; a < 24; a++) tryP(cx + Math.cos(a / 24 * Math.PI * 2) * d, cy + Math.sin(a / 24 * Math.PI * 2) * d);
    return best || { x: hx + hw / 2, y: hy + hh - 70 };
  }
  function route(a: Pt, b: Pt, F: Foot[] = FOOT): Pt[] {
    const R = F.map((f) => f.r).filter((r) => !inR(r, a.x, a.y) && !inR(r, b.x, b.y)), clear = (p: Pt, q: Pt) => !R.some((r) => segHit(p, q, r));
    if (clear(a, b)) return [b];
    const P: Pt[] = [a, b];
    for (const r of R) for (const [x, y] of [[r[0] - 6, r[1] - 6], [r[2] + 6, r[1] - 6], [r[0] - 6, r[3] + 6], [r[2] + 6, r[3] + 6]]) if (!R.some((q) => inR(q, x, y))) P.push({ x, y });
    const D = P.map(() => Infinity), PR = P.map(() => -1), done = P.map(() => false); D[0] = 0;
    for (;;) {
      let u = -1; for (let k = 0; k < P.length; k++) if (!done[k] && D[k] < Infinity && (u < 0 || D[k] < D[u])) u = k;
      if (u < 0 || u === 1) break; done[u] = true;
      for (let v = 0; v < P.length; v++) { if (done[v]) continue; const d = D[u] + Math.hypot(P[v].x - P[u].x, P[v].y - P[u].y); if (d < D[v] && clear(P[u], P[v])) { D[v] = d; PR[v] = u; } }
    }
    if (PR[1] < 0) return [b];
    const out: Pt[] = []; for (let k = 1; k > 0; k = PR[k]) out.unshift(P[k]); return out;
  }
  const walkable = (dug: Dug, i: number) => i >= 0 && i < N && !!dug[i];
  const centerOf = (i: number): Pt => { const p = cellXY(i); return { x: p.cx, y: p.cy + 34 }; };
  const nbrs = (i: number) => { const gx = i % w, gy = Math.floor(i / w), out: number[] = []; if (gy > 0) out.push(i - w); if (gx > 0) out.push(i - 1); if (gx < w - 1) out.push(i + 1); if (gy < h - 1) out.push(i + w); return out; };
  function pathTo(dug: Dug, from: number, to: number): number[] | null {
    if (from === to) return [to];
    if (from < 0) return null;
    const prev = new Map<number, number>([[from, -1]]), q = [from];
    for (let k = 0; k < q.length; k++) { const i = q[k]; if (i === to) break; for (const j of nbrs(i)) if (!prev.has(j) && walkable(dug, j)) { prev.set(j, i); q.push(j); } }
    if (!prev.has(to)) return null;
    const out: number[] = []; for (let i = to; i !== -1; i = prev.get(i)!) out.unshift(i); return out;
  }
  // where to stand to dig stone i: a dug neighbour — below is best, then the sides, then above
  function digSpot(dug: Dug, i: number): number | null {
    const gx = i % w, gy = Math.floor(i / w);
    const c = [gy < h - 1 ? i + w : -1, gx > 0 ? i - 1 : -1, gx < w - 1 ? i + 1 : -1, gy > 0 ? i - w : -1].filter((j) => j >= 0 && walkable(dug, j));
    return c.length ? c[0] : null;
  }
  const spawnAt = (k: number) => free(hx + 120 + (k % 7) * 40, hy + 210 + (Math.floor(k / 7) % 3) * 24);
  function walkPt(dug: Dug, p: Pt, stop = true, F: Foot[] = FOOT): Pt {
    const c = cellAt(p.x, p.y);
    if (c >= 0 && inHall(c)) return free(p.x, p.y, F, stop);
    if (c >= 0 && dug[c]) return p;
    return spawnAt(0);
  }
  /** A walkable cell or the hall (the hall is dug on the server; a view that lags must not lock the player in). */
  const okCell = (dug: Dug, c: number) => c >= 0 && (inHall(c) || !!dug[c]);
  function standable(dug: Dug, x: number, y: number, pad = 0, F: Foot[] = FOOT): boolean {
    const c = cellAt(x, y); if (!okCell(dug, c)) return false;
    if (inHall(c)) for (const f of F) { const r = f.r; if (x > r[0] - pad && x < r[2] + pad && y > r[1] - pad && y < r[3] + pad) return false; }
    // keep the body off the rock: near an edge (or a corner) of the cell whose neighbour is not walkable
    const p = ROCK_PAD, gx = c % w, gy = Math.floor(c / w), lx = x - (X0 + gx * CW), ly = y - (Y0 + gy * RH);
    const L = lx < p, R = lx > CW - p, T = ly < p, B = ly > RH - p;
    if (!(L || R || T || B)) return true;
    const ok = (dx: number, dy: number) => { const X = gx + dx, Y = gy + dy; return X >= 0 && Y >= 0 && X < w && Y < h && okCell(dug, Y * w + X); };
    if (L && !ok(-1, 0)) return false; if (R && !ok(1, 0)) return false; if (T && !ok(0, -1)) return false; if (B && !ok(0, 1)) return false;
    if (L && T && !ok(-1, -1)) return false; if (R && T && !ok(1, -1)) return false; if (L && B && !ok(-1, 1)) return false; if (R && B && !ok(1, 1)) return false;
    return true;
  }
  const ox = hx + hw / 2, oy = hy + hh / 2;
  const G: MineGeom = {
    v3: true, N, w, h, CW, RH, REACH, K, FOOT, ZONE, hall: [hx, hy, hw, hh], hallBox: hb, W: WW, H: HH, PADM: PAD * CW * K,
    cellXY, cellAt, cellOfPt: cellAt, centerOf, nbrs, walkable, pathTo, digSpot, walkPt, free, route,
    inZone: inHall, standable,
    spawn: (login) => spawnAt(hashL(login) % 21),
    frontOfObj: (k, login = '') => { const f = FOOT.find((x) => x.k === k); return f && f.at ? free(f.at[0], f.at[1]) : spawnAt(hashL(login) % 21); },
    frontOf: (dug, types) => {
      const out: number[] = [];
      for (let i = 0; i < N; i++) { const t = types[i]; if (dug[i] || !t || t === 'fog' || NODIG3.has(t)) continue; if (nbrs(i).some((j) => walkable(dug, j))) out.push(i); }
      return out;
    },
    mx: (x) => (x - ox) * K, mz: (y) => (y - oy) * K, px: (X) => X / K + ox, py: (Z) => Z / K + oy,
  };
  if (M3C.size > 40) M3C.clear();
  M3C.set(key, G); return G;
}

/** Geometry of a mine view: the big floor when st.fl.v3, else the classic one. */
export function geomOf(st: { fl?: { v3?: number; w?: number; h?: number; hallBox?: number[] } | null } | null | undefined): MineGeom {
  const fl = st && st.fl;
  return fl && fl.v3 && fl.w && fl.h ? mine3Geo({ w: fl.w, h: fl.h, hallBox: fl.hallBox }) : GEO1;
}
