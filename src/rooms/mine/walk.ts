/**
 * Walking the hero to a mine object the way the site does (mine.js walkTo: cells of the hall by BFS, then around the
 * entrance objects): a plan of waypoints in mine px, and a small driver that feeds them one by one to the normal player
 * controller (controller.walkTo — the same movement as WASD, so position updates go out as usual, mine/go).
 * Any own movement key cancels the walk (the controller drops its path; the driver notices and stops).
 * Pure TS, no THREE / DOM (test/mine-walk.test.ts).
 */
import { N_CELLS, YB, REACH, FOOT, cellOfPt, centerOf, pathTo, route, standable, segHit, inR, mx, mz, type Dug, type Foot, type Pt } from './geo';
import type { MineGeom } from './geo3';

/** A body is wider than the site's point hero: plan around the objects grown by this much (px; body ≈ 8 px + slack). */
export const BODY_PAD = 14;
const grow = (k: number): Foot[] => FOOT.map((f) => ({ ...f, r: [f.r[0] - k, f.r[1] - k, f.r[2] + k, f.r[3] + k] }));
/** Wide margins first; narrow passages (the spawn by the cart) fall back to thinner ones, the site's own last. */
const GROWN: Foot[][] = [grow(BODY_PAD), grow(8), grow(3)];
/** Route a → b in the entrance area around the grown objects, or null when the straight fallback would cut through one. */
function bodyRoute(dug: Dug, a: Pt, b: Pt, F: Foot[]): Pt[] | null {
  const pts = route(a, b, F);
  const R = F.map((f) => f.r).filter((r) => !inR(r, a.x, a.y) && !inR(r, b.x, b.y));
  let p = a;
  for (const q of pts) { if (R.some((r) => segHit(p, q, r)) || !standable(dug, q.x, q.y, 0)) return null; p = q; }
  return pts;
}
/**
 * Where a body can really stand and walk to, closest to `to` (the site's «front of the object» points are for a point
 * hero: the buyer's one sits in a pocket between the stall, the buyer and the wall). Rings of 12 px around it.
 */
export function standNear(dug: Dug, from: Pt, to: Pt, pad = BODY_PAD): { at: Pt; path: Pt[] } | null {
  for (const F of GROWN) {
    for (let d = 0; d <= 360; d += 12) for (let a = 0; a < (d ? 32 : 1); a++) {
      const x = Math.round(to.x + Math.cos(a / 32 * Math.PI * 2) * d), y = Math.round(to.y + Math.sin(a / 32 * Math.PI * 2) * d);
      if (y < YB || !standable(dug, x, y, pad)) continue;
      const path = bodyRoute(dug, from, { x, y }, F);
      if (path) return { at: { x, y }, path };
    }
  }
  return null;
}

/**
 * «Шахта 3.0» (big floor): through dug cells by BFS (the hall cells count as dug — the server digs them at the start), cell
 * centres in the tunnels, around the hall objects (grown by the body) once in the lift hall (site way(): in the hall around
 * the objects, in the tunnels by cell centres). Waypoints in px, start excluded; null = no way.
 */
export function walkPlan3(G: MineGeom, dug: Dug, from: Pt, to: Pt): Pt[] | null {
  const a = G.cellAt(from.x, from.y), b = G.cellAt(to.x, to.y);
  if (a < 0 || b < 0) return null;
  const ok = (i: number) => G.inZone(i) || !!dug[i];
  const prev = new Map<number, number>([[a, -1]]), q = [a];
  for (let k = 0; k < q.length && !prev.has(b); k++) for (const j of G.nbrs(q[k])) if (!prev.has(j) && ok(j)) { prev.set(j, q[k]); q.push(j); }
  if (!prev.has(b)) return null;
  const cells: number[] = []; for (let i = b; i !== -1; i = prev.get(i)!) cells.unshift(i);
  const pts: Pt[] = []; let at = from;
  const grown = G.FOOT.map((f) => ({ ...f, r: [f.r[0] - BODY_PAD, f.r[1] - BODY_PAD, f.r[2] + BODY_PAD, f.r[3] + BODY_PAD] as Foot['r'] }));
  for (let k = 1; k < cells.length; k++) {
    if (G.inZone(cells[k])) break;   // the rest of the way is inside the hall: around the objects below
    const c = G.centerOf(cells[k]); const p = { x: c.x, y: c.y - 34 }; pts.push(p); at = p;
  }
  if (G.inZone(b)) {
    // inside the hall: around the objects (the site's route over their grown rectangles), then the exact target
    const end = G.free(to.x, to.y, grown, false);
    for (const p of G.route(at, end, grown)) pts.push(p);
  } else if (!pts.length || pts[pts.length - 1].x !== to.x || pts[pts.length - 1].y !== to.y) pts.push(to);
  return pts;
}

/** Waypoints (mine px, start excluded) from `from` to the standable spot nearest `to0` in the entrance area; null = no way. */
export function walkPlan(dug: Dug, from: Pt, to: Pt, G?: MineGeom): Pt[] | null {
  if (G && G.v3) return walkPlan3(G, dug, from, to);
  const a = cellOfPt(from.x, from.y), b = cellOfPt(to.x, to.y);
  if (a < 0 || b < 0) return null;
  const pts: Pt[] = [];
  let at: Pt = from;
  if (a < N_CELLS) {
    // in the hall: cleared cells down to the entrance row (site pathTo), then into the entrance area
    const path = pathTo(dug, a, b);
    if (!path) return null;
    for (let k = 1; k < path.length; k++) {
      const c = centerOf(path[k]); pts.push(c); at = c;
      if (path[k] >= N_CELLS) break;
    }
  }
  if (to.y >= YB) { const s = standNear(dug, at, to); if (!s) return null; for (const p of s.path) pts.push(p); }
  else if (!pts.length || pts[pts.length - 1].x !== to.x || pts[pts.length - 1].y !== to.y) pts.push(to);
  return pts;
}

/** Controller surface the driver needs (src/engine/player.ts PlayerControllerEx). Room units: metres (x, z). */
export interface WalkCtl { walkTo(x: number, z: number): void; readonly walking: boolean; stop?(): void }
export type WalkState = 'idle' | 'walking' | 'done' | 'cancelled';

/** Feeds waypoints (room metres) to the controller; one per call of walkTo, next when the previous is reached. */
export class AutoWalk {
  private q: { x: number; z: number }[] = [];
  private k = 0; private issued = false; private t = 0; private limit = 0;
  /** Arrival tolerance (m). */
  static EPS = 0.6;
  get active(): boolean { return this.k < this.q.length; }
  /** Start a walk along px waypoints (converted to room metres). */
  startPx(pts: Pt[], G?: MineGeom): void { const X = G ? G.mx : mx, Z = G ? G.mz : mz; this.q = pts.map((p) => ({ x: X(p.x), z: Z(p.y) })); this.k = 0; this.issued = false; }
  cancel(): void { this.q = []; this.k = 0; this.issued = false; }
  /** Call every frame with the feet (room metres). */
  frame(ctl: WalkCtl, x: number, z: number, dt: number): WalkState {
    if (!this.active) return 'idle';
    const w = this.q[this.k];
    if (!this.issued) {
      ctl.walkTo(w.x, w.z); this.issued = true; this.t = 0;
      this.limit = Math.hypot(w.x - x, w.z - z) / 1.2 + 2.5;   // stuck on something → give up (≥ walking speed 1.2 m/s)
      return 'walking';
    }
    this.t += dt;
    // close to a corner with more to go: take the next point already (no stop-and-go at every cell)
    if (this.k + 1 < this.q.length && Math.hypot(w.x - x, w.z - z) <= AutoWalk.EPS) { this.k++; this.issued = false; return this.frame(ctl, x, z, 0); }
    if (ctl.walking && this.t < this.limit) return 'walking';
    if (Math.hypot(w.x - x, w.z - z) <= AutoWalk.EPS) {
      this.k++; this.issued = false;
      if (!this.active) { this.cancel(); return 'done'; }
      return this.frame(ctl, x, z, 0);
    }
    if (ctl.walking && ctl.stop) ctl.stop();
    this.cancel(); return 'cancelled';
  }
}

/**
 * «Walked away from the own stone» (site leaveRock on a step, 25.10) — but only after the hero stood at it: a stone the
 * game gave by itself (the queue's next one, or one dug while the site was closed) must not be stopped just because the
 * 3D hero stands elsewhere (the site walks the hero there; here the player walks or lets him work).
 */
export class LeaveGuard {
  private i = -2; private armed = false;
  /** d = feet → stone centre (px). True = the player walked away: put the pickaxe down (mineStop). */
  check(myI: number, dug: boolean, d: number): boolean {
    if (myI !== this.i) { this.i = myI; this.armed = false; }
    if (myI < 0 || dug) return false;
    if (d <= REACH) { this.armed = true; return false; }
    return this.armed && d > REACH + 30;
  }
}
/** HUD «Скупщик» while digging: the first press only warns, a second one within `ms` goes (AFK safety). */
export class ConfirmTwice {
  private at = -1e12;
  constructor(private ms = 5000) {}
  /** True = go now; false = this press only armed the confirmation. */
  press(needConfirm: boolean, now: number): boolean {
    if (!needConfirm) { this.at = -1e12; return true; }
    if (now - this.at <= this.ms) { this.at = -1e12; return true; }
    this.at = now; return false;
  }
}
