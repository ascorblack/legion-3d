/**
 * Automatic set dressing of an interior (visual uplift round 2), run by RoomBase.finish at q1+ after the room's own
 * builder: it fills what the builder left empty — the upper walls (high shelves with clutter, banners, sconces with a
 * pool of warm light, racks of tools / plates), the beams (bundles of herbs, garlic, copper pots, chains, crystals) and
 * the wall feet (sacks, buckets, logs, crates, jugs) — themed per room and art style.
 *
 * Placement is occupancy-checked: every piece the builder baked is recorded (RoomKit.occ, world AABBs; the shell's
 * long walls / floor / ceiling are ignored by size), goods and NPC spots are added, and a candidate is placed only where
 * its box (+ margin) is free; the wall-foot clutter also keeps clear of solids, raised floors, the door and the windows.
 * Everything is baked into the room batch (no extra draw calls); floor clutter gets small collision solids.
 * q1: upper walls + beams; q2+: also the wall-foot clutter and more of everything.
 */
import * as THREE from 'three';
import type { RoomKit } from './kit';
import { M, GEO, type MatKey } from '../../world/batch';
import { hanging, sack, books, basket } from './decor';

/* ------------------------------------------------------------------ themes */
type Upper = 'shelf' | 'banner' | 'sconce' | 'tools' | 'plates' | 'pegs' | 'map';
type Shelf = 'jars' | 'pots' | 'books' | 'bottles' | 'ingots' | 'crystals' | 'boxes' | 'scrolls';
type Hang = 'herb' | 'garlic' | 'pepper' | 'sausage' | 'pot' | 'chain' | 'crystal' | 'star' | 'basket' | 'ribbon' | 'lamp';
type Foot = 'sack' | 'bucket' | 'logs' | 'crates' | 'jugs' | 'basket' | 'ingots' | 'books' | 'broom' | 'chest';
interface Theme { upper: Upper[]; shelf: Shelf[]; hang: Hang[]; foot: Foot[]; banner: [string, string, string][]; emblem: 'hammer' | 'star' | 'leaf' | 'sword' | 'coin' | 'key' | 'scroll' | 'crown' }

const T = (upper: Upper[], shelf: Shelf[], hang: Hang[], foot: Foot[], banner: [string, string, string][], emblem: Theme['emblem']): Theme => ({ upper, shelf, hang, foot, banner, emblem });
const THEMES: Record<string, Theme> = {
  forge: T(['banner', 'tools', 'shelf', 'sconce', 'pegs'], ['ingots', 'jars', 'boxes'], ['chain', 'pot', 'chain', 'lamp'], ['logs', 'bucket', 'ingots', 'sack', 'crates'], [['#7a1a2a', '#ffcf4a', '#2a1418'], ['#1e3a5a', '#e8d4a0', '#141c28']], 'hammer'),
  magic: T(['banner', 'shelf', 'sconce', 'map', 'shelf'], ['bottles', 'crystals', 'books', 'scrolls'], ['star', 'crystal', 'herb', 'star', 'lamp'], ['books', 'chest', 'jugs', 'basket'], [['#3a2a6e', '#ffe39a', '#1c1438'], ['#1e3a6e', '#b9a2ff', '#121a38']], 'star'),
  shop: T(['shelf', 'banner', 'plates', 'sconce', 'shelf', 'pegs'], ['jars', 'pots', 'bottles', 'boxes'], ['herb', 'garlic', 'sausage', 'pepper', 'basket', 'pot'], ['sack', 'basket', 'crates', 'jugs', 'bucket'], [['#2e5a2a', '#ffe9b0', '#1a2a18'], ['#8a3a2a', '#ffd27a', '#2a1410']], 'leaf'),
  tent: T(['banner'], ['jars'], ['ribbon', 'lamp', 'ribbon', 'star'], ['sack', 'jugs', 'basket', 'chest'], [['#8a1a3a', '#ffcf4a', '#2a0d14']], 'coin'),
  trainer: T(['banner', 'tools', 'sconce', 'pegs', 'shelf'], ['boxes', 'bottles', 'jars'], ['chain', 'herb', 'lamp'], ['logs', 'bucket', 'crates', 'sack'], [['#7a1a2a', '#ffcf4a', '#2a1418'], ['#2a4a7a', '#ffffff', '#141c28']], 'sword'),
  board: T(['map', 'shelf', 'sconce', 'banner'], ['scrolls', 'books', 'jars'], ['herb', 'lamp', 'garlic'], ['crates', 'books', 'sack', 'broom'], [['#4a6a8a', '#ffe9b0', '#1a2430']], 'scroll'),
  hall: T(['banner', 'sconce', 'map', 'banner', 'shelf'], ['books', 'scrolls', 'boxes'], ['lamp', 'herb'], ['chest', 'crates', 'books'], [['#6a2a3a', '#ffcf4a', '#2a1018'], ['#2a3a6a', '#ffcf4a', '#101828']], 'crown'),
  auction: T(['banner', 'shelf', 'sconce', 'plates', 'map'], ['pots', 'boxes', 'bottles', 'books'], ['lamp', 'garlic', 'herb'], ['chest', 'jugs', 'crates', 'basket'], [['#7a3a5e', '#ffcf4a', '#2a1020']], 'coin'),
  storage: T(['shelf', 'pegs', 'shelf', 'sconce'], ['boxes', 'jars', 'pots'], ['basket', 'garlic', 'sausage', 'lamp'], ['crates', 'sack', 'crates', 'logs', 'basket'], [['#6a4a2a', '#ffe9b0', '#2a1a10']], 'key'),
  gate: T(['banner', 'tools', 'sconce', 'map'], ['boxes', 'bottles'], ['chain', 'lamp'], ['crates', 'sack', 'bucket', 'logs'], [['#2a4a3a', '#ffcf4a', '#101a14'], ['#6a1a1a', '#ffcf4a', '#200a0a']], 'sword'),
  anvil: T(['tools', 'banner', 'sconce', 'pegs', 'shelf'], ['ingots', 'jars'], ['chain', 'pot', 'lamp'], ['logs', 'bucket', 'ingots', 'crates'], [['#7a1a2a', '#ffcf4a', '#2a1418']], 'hammer'),
  plain: T(['shelf', 'banner', 'sconce', 'plates'], ['jars', 'books', 'pots'], ['herb', 'garlic', 'lamp'], ['sack', 'basket', 'jugs', 'crates'], [['#4a6a8a', '#ffe9b0', '#1a2430']], 'leaf'),
};
const CHERTS_BANNER: [string, string, string][] = [['#3a0d14', '#ffc83d', '#1a0608'], ['#2a2028', '#ff5a1a', '#120a0c']];

/* ------------------------------------------------------------------ occupancy */
/** World AABBs (x0 y0 z0 x1 y1 z1) of placed things. */
export class Occ {
  readonly a: number[] = [];
  add(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): void { this.a.push(Math.min(x0, x1), y0, Math.min(z0, z1), Math.max(x0, x1), y1, Math.max(z0, z1)); }
  hit(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): boolean {
    const A = this.a, ax = Math.min(x0, x1), bx = Math.max(x0, x1), az = Math.min(z0, z1), bz = Math.max(z0, z1);
    for (let i = 0; i < A.length; i += 6) if (A[i] < bx && A[i + 3] > ax && A[i + 1] < y1 && A[i + 4] > y0 && A[i + 2] < bz && A[i + 5] > az) return true;
    return false;
  }
}

/** Wall frame: u along the wall, o out of it into the room. */
class Wall {
  readonly c: number; readonly s: number;
  constructor(readonly ox: number, readonly oz: number, readonly ry: number, readonly u0: number, readonly u1: number) { this.c = Math.round(Math.cos(ry)); this.s = Math.round(Math.sin(ry)); }
  x(u: number, o: number): number { return this.ox + this.c * u + this.s * o; }
  z(u: number, o: number): number { return this.oz - this.s * u + this.c * o; }
  box(K: RoomKit, mat: MatKey, col: THREE.ColorRepresentation, ua: number, ub: number, y0: number, y1: number, oa: number, ob: number, bev = 0): void {
    const xa = this.x(ua, oa), xb = this.x(ub, ob), za = this.z(ua, oa), zb = this.z(ub, ob);
    if (bev > 0) K.bevel(mat, col, Math.min(xa, xb), Math.max(xa, xb), y0, y1, Math.min(za, zb), Math.max(za, zb), bev);
    else K.box(mat, col, Math.min(xa, xb), Math.max(xa, xb), y0, y1, Math.min(za, zb), Math.max(za, zb));
  }
  occ(O: Occ, ua: number, ub: number, y0: number, y1: number, oa: number, ob: number): boolean { return O.hit(this.x(ua, oa), y0, this.z(ua, oa), this.x(ub, ob), y1, this.z(ub, ob)); }
  mark(O: Occ, ua: number, ub: number, y0: number, y1: number, oa: number, ob: number): void { O.add(this.x(ua, oa), y0, this.z(ua, oa), this.x(ub, ob), y1, this.z(ub, ob)); }
}

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _p = new THREE.Vector3(), _s = new THREE.Vector3();
const CYL = new THREE.CylinderGeometry(0.5, 0.5, 1, 10, 1);
/** Swallow-tailed banner cloth, 1 × 1, top edge at y = 0 (hangs down), facing +Z. */
const BANNER = (() => {
  const s = new THREE.Shape();
  s.moveTo(-0.5, 0); s.lineTo(0.5, 0); s.lineTo(0.5, -1); s.lineTo(0, -0.82); s.lineTo(-0.5, -1); s.closePath();
  return new THREE.ShapeGeometry(s);
})();
const STAR = (() => {
  const s = new THREE.Shape();
  for (let i = 0; i < 10; i++) { const a = Math.PI / 2 + i * Math.PI / 5, r = i % 2 ? 0.2 : 0.5; if (i) s.lineTo(Math.cos(a) * r, Math.sin(a) * r); else s.moveTo(Math.cos(a) * r, Math.sin(a) * r); }
  s.closePath();
  return new THREE.ShapeGeometry(s);
})();
/** Box with Euler order YXZ: yaw, then a tilt about the local x (out of the wall), then an in-plane roll. */
function ybox(K: RoomKit, mat: MatKey, col: THREE.ColorRepresentation, cx: number, cy: number, cz: number, sx: number, sy: number, sz: number, ry: number, rx: number, rz: number): void {
  _q.setFromEuler(_e.set(rx, ry, rz, 'YXZ'));
  K.geo(mat, GEO.box, _m.compose(_p.set(cx, cy, cz), _q, _s.set(sx, sy, sz)), col);
}
const rh = (i: number, k: number) => { const s = Math.sin(i * 12.9898 + k * 78.233) * 43758.5453; return s - Math.floor(s); };

/* ------------------------------------------------------------------ the pass */
export interface DressEnv {
  kit: RoomKit; id: string; style: string; quality: number;
  /** goods / NPC / interactive spots to keep clear: x, y, z, r */
  keep: number[];
}

export function dressRoom(E: DressEnv): void {
  const K = E.kit, q = E.quality;
  if (q < 1 || (!K.shellH && !K.circle)) return;
  const th = THEMES[E.id] || THEMES.plain;
  const banners = E.style === 'cherts' ? CHERTS_BANNER : th.banner;
  const O = new Occ();
  // what the builder made (the shell's long walls, floor, ceiling and beams are not obstacles: ignored by size)
  const R = K.occRaw;
  for (let i = K.occFrom; i < R.length; i += 6) {
    if (R[i + 4] < 0.03) continue;   // rugs, floor decals
    if (K.circle && Math.max(R[i + 3] - R[i], R[i + 5] - R[i + 2]) > 2.2) continue;   // the tent's canvas walls / canopy
    O.add(R[i], R[i + 1], R[i + 2], R[i + 3], R[i + 4], R[i + 5]);
  }
  // the ceiling beams (the shell's, not recorded): nothing hangs into them
  for (const z of K.beams) O.add(K.bounds.x0 - 1, (K.shellH || 3) - 0.27, z - 0.14, K.bounds.x1 + 1, (K.shellH || 3) + 1, z + 0.14);
  for (let i = 0; i < E.keep.length; i += 4) { const [x, y, z, r] = [E.keep[i], E.keep[i + 1], E.keep[i + 2], E.keep[i + 3]]; O.add(x - r, y - r, z - r, x + r, y + r, z + r); }
  const H = K.shellH || 3.2, B = K.bounds, circle = K.circle;
  let seed = E.id.length * 7 + (E.style === 'cherts' ? 3 : 0);
  const rnd = () => rh(seed++, 3.7);

  if (!circle) {
    // walls: back (faces +Z), left (+X), right (−X); u runs left → right as seen from the room
    // the side walls stop 2.2 m short of the entrance: the TP camera lives there (nothing right in front of the lens)
    const walls = [new Wall(0, B.z0, 0, B.x0 + 0.35, B.x1 - 0.35), new Wall(B.x0, 0, Math.PI / 2, -B.z1 + 2.2, -B.z0 - 0.35), new Wall(B.x1, 0, -Math.PI / 2, B.z0 + 0.35, B.z1 - 2.2)];
    // the left wall frame: u = −z … (x(u,o) = x0 + o, z(u,o) = −u)  → u from −z1 to −z0
    let k = 0;
    for (const W of walls) {
      // upper band: try the theme's items in turn, scanning along the wall
      let u = W.u0 + 0.1 + rnd() * 0.4;
      while (u < W.u1 - 0.2) {
        let placed = 0;
        for (let t = 0; t < th.upper.length && !placed; t++) {
          const kind = th.upper[(k + t) % th.upper.length];
          placed = upper(K, O, W, u, kind, H, th, banners, q, rnd, k);
          if (placed) k++;
        }
        u += placed ? placed + 0.35 + rnd() * (q >= 2 ? 0.45 : 1.2) : 0.15;
      }
      // wall feet (q2+)
      if (q >= 2) {
        let v = W.u0 + 0.05 + rnd() * 0.3;
        while (v < W.u1 - 0.1) {
          const kind = th.foot[Math.floor(rnd() * th.foot.length)];
          const w = foot(K, O, W, v, kind, rnd, true);
          v += w ? w + 0.6 + rnd() * 1.4 : 0.2;
        }
      }
    }
  }
  // beams: bundles hanging near the side walls (and along the back wall); tent: from the canopy ring
  const hang = (x: number, z: number, top: number, i: number) => {
    const kind = th.hang[i % th.hang.length];
    const len = kind === 'lamp' ? 0.55 : kind === 'chain' ? 0.7 : 0.5;
    if (O.hit(x - 0.16, top - len - 0.12, z - 0.16, x + 0.16, top - 0.05, z + 0.16)) return;
    hangOne(K, x, top, z, kind, i);
    O.add(x - 0.16, top - len - 0.1, z - 0.16, x + 0.16, top, z + 0.16);
  };
  if (circle) {
    const n = q >= 2 ? 8 : 4;
    for (let i = 0; i < n; i++) { const a = (i + 0.5) / n * Math.PI * 2 + 0.2, r = circle.r - 0.9; hang(circle.x + Math.cos(a) * r, circle.z + Math.sin(a) * r, Math.min(H + 0.4, 3.3), i); }
  } else {
    const top = H - 0.24;
    let i = 0;
    for (const z of K.beams) {
      if (z > B.z1 - 1.8) continue;   // the camera's end of the room
      for (const x of [B.x0 + 0.45, B.x0 + 1.05, B.x1 - 0.45, B.x1 - 1.05]) {
        if (q < 2 && i % 2) { i++; continue; }
        hang(x + (rnd() - 0.5) * 0.2, z + (rnd() > 0.5 ? 0.16 : -0.16), top, i++);
      }
    }
  }
  // tent: the wall feet round the circle
  if (circle && q >= 3) {
    const n = 14;
    for (let i = 0; i < n; i++) {
      const a = (i + 0.3) / n * Math.PI * 2, r = circle.r - 0.45;
      const x = circle.x + Math.cos(a) * r, z = circle.z + Math.sin(a) * r;
      if (z > circle.z + circle.r * 0.55 && Math.abs(x - circle.x) < 1.6) continue;   // the entrance
      const W = new Wall(x, z, Math.atan2(circle.x - x, circle.z - z), -0.3, 0.3);
      foot(K, O, W, 0, th.foot[i % th.foot.length], rnd, false);
    }
  }
}

/* ------------------------------------------------------------------ upper-wall items; return the width used (0 = not placed) */
function upper(K: RoomKit, O: Occ, W: Wall, u: number, kind: Upper, H: number, th: Theme, banners: [string, string, string][], q: number, rnd: () => number, k: number): number {
  const P = K.pal;
  if (kind === 'shelf') {
    if (H < 3.25) return 0;
    const w = 1.0 + Math.round(rnd() * 3) * 0.2, y = Math.min(H - 0.75, 3.35);
    if (u + w > W.u1 || W.occ(O, u - 0.05, u + w + 0.05, y - 0.3, y + 0.5, 0, 0.36)) return 0;
    W.box(K, 'wood', P.woodL, u, u + w, y - 0.045, y, 0.02, 0.28, 0.012);
    for (const b of [u + 0.12, u + w - 0.12]) { W.box(K, 'metal', '#3a3440', b - 0.015, b + 0.015, y - 0.22, y - 0.052, 0.0, 0.035); ybox(K, 'metal', '#3a3440', W.x(b, 0.13), y - 0.135, W.z(b, 0.13), 0.026, 0.27, 0.026, W.ry, 0.9, 0); }
    shelfClutter(K, W, u + 0.06, u + w - 0.06, y, th.shelf[k % th.shelf.length], k);
    W.mark(O, u - 0.05, u + w + 0.05, y - 0.3, y + 0.5, 0, 0.36);
    return w;
  }
  if (kind === 'banner') {
    const w = 0.62, h = Math.min(1.25, H - 2.75), top = H - 0.28;
    if (h < 0.6 || u + w > W.u1 || W.occ(O, u - 0.06, u + w + 0.06, top - h - 0.1, top + 0.06, 0, 0.14)) return 0;
    const [a, b, d] = banners[k % banners.length], cx = u + w / 2;
    // rod with knobs, the cloth (swallow tail), a trim band, the emblem
    K.rbox('metal', '#c9a04a', W.x(cx, 0.08), top, W.z(cx, 0.08), W.c ? w + 0.16 : 0.025, 0.025, W.c ? 0.025 : w + 0.16);
    for (const e of [u - 0.08, u + w + 0.08]) K.ball('metal', '#c9a04a', W.x(e, 0.08), top, W.z(e, 0.08), 0.035);
    for (const e of [u + 0.08, u + w - 0.08]) W.box(K, 'metal', '#3a3440', e - 0.008, e + 0.008, top, top + 0.15, 0.02, 0.035);
    K.geo('canvas', BANNER, M(W.x(cx, 0.06), top - 0.03, W.z(cx, 0.06), w, h, 1, 0, W.ry, 0), a);
    K.geo('canvas', BANNER, M(W.x(cx, 0.066), top - 0.03 - h * 0.08, W.z(cx, 0.066), w * 0.84, h * 0.84, 1, 0, W.ry, 0), d);
    K.geo('canvas', BANNER, M(W.x(cx, 0.072), top - 0.03 - h * 0.12, W.z(cx, 0.072), w * 0.74, h * 0.76, 1, 0, W.ry, 0), a);
    emblem(K, W, cx, top - 0.03 - h * 0.42, 0.078, th.emblem, b, w * 0.5);
    W.mark(O, u - 0.06, u + w + 0.06, top - h - 0.1, top + 0.06, 0, 0.14);
    return w;
  }
  if (kind === 'sconce') {
    const y = 2.15, w = 0.3;
    if (u + w > W.u1 || W.occ(O, u - 0.1, u + w + 0.1, y - 0.25, y + 0.55, 0, 0.32)) return 0;
    const cx = u + w / 2;
    W.box(K, 'metal', '#3a3440', cx - 0.07, cx + 0.07, y - 0.12, y + 0.16, 0.0, 0.025, 0.008);
    W.box(K, 'metal', '#3a3440', cx - 0.015, cx + 0.015, y - 0.02, y + 0.01, 0.02, 0.2);
    K.cyl('metal', '#c9a04a', W.x(cx, 0.2), y + 0.01, W.z(cx, 0.2), 0.055, 0.03, 8);
    K.cyl('back', '#f4ead2', W.x(cx, 0.2), y + 0.04, W.z(cx, 0.2), 0.025, 0.12, 8);
    K.ball('emit', '#ffcf6a', W.x(cx, 0.2), y + 0.2, W.z(cx, 0.2), 0.028, 1.6);
    K.glow(W.x(cx, 0.2), y + 0.21, W.z(cx, 0.2), 0.55, '#ffcf6a', 0.9);
    K.splash(W.x(cx, 0.012), y + 0.15, W.z(cx, 0.012), 1.5, 1.7, '#ffb35c', 0.32, W.ry);
    if (q >= 2) K.light(W.x(cx, 0.3), y + 0.2, W.z(cx, 0.3), '#ffb35c', 1.2, 3.2, 0, 0);
    W.mark(O, u - 0.1, u + w + 0.1, y - 0.25, y + 0.55, 0, 0.32);
    return w;
  }
  if (kind === 'tools' || kind === 'pegs' || kind === 'plates' || kind === 'map') {
    const w = kind === 'map' ? 1.0 : kind === 'plates' ? 0.95 : 0.9, y = kind === 'pegs' ? 2.05 : Math.min(H - 0.95, 2.95), h = kind === 'map' ? 0.7 : 0.6;
    if (u + w > W.u1 || W.occ(O, u - 0.06, u + w + 0.06, y - h / 2 - 0.4, y + h / 2 + 0.06, 0, 0.3)) return 0;
    const cx = u + w / 2;
    if (kind === 'tools') {
      // plaque with two crossed tools (hammers / axes), a small round shield in the middle
      W.box(K, 'wood', P.woodD, u + 0.08, u + w - 0.08, y - h / 2, y + h / 2, 0, 0.035, 0.01);
      for (const sgn of [-1, 1]) {
        const a = sgn * 0.62, L = 0.78;
        ybox(K, 'wood', '#8a5a2b', W.x(cx, 0.06 + (sgn > 0 ? 0.014 : 0)), y, W.z(cx, 0.06 + (sgn > 0 ? 0.014 : 0)), 0.035, L, 0.035, W.ry, 0, a);
        const hu = cx - Math.sin(a) * L * 0.42, hy = y + Math.cos(a) * L * 0.42;
        ybox(K, 'metal', '#9aa2ac', W.x(hu, 0.068 + (sgn > 0 ? 0.014 : 0)), hy, W.z(hu, 0.068 + (sgn > 0 ? 0.014 : 0)), 0.2, 0.09, 0.06, W.ry, 0, a);
      }
      K.geo('metal', CYL, _m.compose(_p.set(W.x(cx, 0.1), y, W.z(cx, 0.1)), _q.setFromEuler(_e.set(Math.PI / 2, W.ry, 0, 'YXZ')), _s.set(0.26, 0.04, 0.26)), '#c9a04a');
      K.geo('metal', CYL, _m.compose(_p.set(W.x(cx, 0.122), y, W.z(cx, 0.122)), _q.setFromEuler(_e.set(Math.PI / 2, W.ry, 0, 'YXZ')), _s.set(0.18, 0.012, 0.18)), '#8a1a2a');
    } else if (kind === 'pegs') {
      // peg rail with hanging cloaks / bags / a coil of rope
      W.box(K, 'wood', P.woodD, u, u + w, y - 0.04, y + 0.04, 0, 0.04, 0.01);
      for (let i = 0; i < 3; i++) {
        const pu = u + 0.15 + i * (w - 0.3) / 2;
        W.box(K, 'wood', P.woodL, pu - 0.015, pu + 0.015, y - 0.015, y + 0.015, 0.04, 0.11);
        const col = ['#6a3a2a', '#3a5a7a', '#5a6a3a', '#7a2a4a'][(i + Math.floor(rnd() * 4)) % 4];
        if (i === 1) { K.geo('canvas', CYL, _m.compose(_p.set(W.x(pu, 0.1), y - 0.1, W.z(pu, 0.1)), _q.setFromEuler(_e.set(Math.PI / 2, W.ry, 0, 'YXZ')), _s.set(0.2, 0.05, 0.2)), '#c8b88a'); }
        else { K.geo('canvas', GEO.cone4, M(W.x(pu, 0.1), y - 0.38, W.z(pu, 0.1), 0.34, 0.74, 0.07, 0, W.ry + Math.PI / 4 * 0, 0), col); K.ball('canvas', col, W.x(pu, 0.1), y - 0.03, W.z(pu, 0.1), 0.05); }
      }
    } else if (kind === 'plates') {
      // plate rack: two rails, painted plates leaning on the back
      W.box(K, 'wood', P.woodD, u + 0.04, u + w - 0.04, y - 0.32, y - 0.28, 0, 0.13, 0.008);
      W.box(K, 'wood', P.woodD, u + 0.04, u + w - 0.04, y - 0.18, y - 0.15, 0.1, 0.13);
      for (const e of [u, u + w - 0.04]) W.box(K, 'wood', P.woodD, e, e + 0.04, y - 0.34, y + 0.12, 0, 0.145);
      for (let i = 0; i < 3; i++) {
        const pu = u + 0.17 + i * (w - 0.34) / 2, c = ['#e8dcc8', '#7fa8d8', '#e8c86a', '#d87a6a'][i % 4];
        _q.setFromEuler(_e.set(Math.PI / 2 - 0.2, W.ry, 0, 'YXZ'));
        K.geo('back', CYL, _m.compose(_p.set(W.x(pu, 0.07), y - 0.12, W.z(pu, 0.07)), _q, _s.set(0.27, 0.02, 0.27)), c);
        K.geo('back', CYL, _m.compose(_p.set(W.x(pu, 0.093), y - 0.118, W.z(pu, 0.093)), _q, _s.set(0.15, 0.01, 0.15)), '#f4ead2');
      }
    } else {
      // pinned map / notice: parchment, a red route, pins
      W.box(K, 'wood', P.woodD, u + 0.04, u + w - 0.04, y - h / 2, y + h / 2, 0, 0.03, 0.008);
      W.box(K, 'back', '#e8d8b0', u + 0.1, u + w - 0.1, y - h / 2 + 0.06, y + h / 2 - 0.06, 0.03, 0.04);
      for (let i = 0; i < 5; i++) { const a = u + 0.2 + i * (w - 0.4) / 4, b = y - 0.15 + Math.sin(i * 2.1) * 0.12; W.box(K, 'back', '#a33a2a', a - 0.05, a + 0.05, b - 0.01, b + 0.01, 0.047, 0.058); }
      for (const [du, dv] of [[0.14, 0.24], [w - 0.14, 0.24], [0.14, -0.24], [w - 0.14, -0.24]]) K.ball('metal', '#c9a04a', W.x(u + du, 0.045), y + dv, W.z(u + du, 0.045), 0.018);
      W.box(K, 'back', '#6a8a5a', u + 0.25, u + 0.45, y + 0.02, y + 0.16, 0.052, 0.064);
      W.box(K, 'back', '#6a8ab0', u + w - 0.4, u + w - 0.22, y - 0.2, y - 0.06, 0.052, 0.064);
    }
    W.mark(O, u - 0.06, u + w + 0.06, y - h / 2 - 0.4, y + h / 2 + 0.06, 0, 0.3);
    return w;
  }
  return 0;
}

function emblem(K: RoomKit, W: Wall, cx: number, y: number, o: number, e: Theme['emblem'], col: string, s: number): void {
  const at = (du: number, dy: number, sx: number, sy: number, rz = 0) => M(W.x(cx + du, o), y + dy, W.z(cx + du, o), sx, sy, 1, 0, W.ry, rz);
  if (e === 'star') { K.geo('canvas', STAR, at(0, 0, s * 0.8, s * 0.8), col); return; }
  if (e === 'coin' || e === 'crown') {
    K.geo('canvas', CIRCLE, at(0, 0, s * 0.7, s * 0.7), col);
    K.geo('canvas', CIRCLE, M(W.x(cx, o + 0.005), y, W.z(cx, o + 0.005), s * 0.42, s * 0.42, 1, 0, W.ry, 0), shadeHex(col, 0.7));
    return;
  }
  if (e === 'hammer') { K.geo('canvas', SQUARE, at(0, -0.04, s * 0.12, s * 0.8), col); K.geo('canvas', SQUARE, M(W.x(cx, o + 0.005), y + s * 0.32, W.z(cx, o + 0.005), s * 0.55, s * 0.25, 1, 0, W.ry, 0), col); return; }
  if (e === 'sword') { K.geo('canvas', SQUARE, at(0, 0.02, s * 0.1, s * 0.9), col); K.geo('canvas', SQUARE, M(W.x(cx, o + 0.005), y - s * 0.22, W.z(cx, o + 0.005), s * 0.45, s * 0.08, 1, 0, W.ry, 0), col); return; }
  if (e === 'leaf') { K.geo('canvas', DIAMOND, at(0, 0, s * 0.5, s * 0.85), col); return; }
  if (e === 'key') { K.geo('canvas', CIRCLE, at(0, s * 0.25, s * 0.35, s * 0.35), col); K.geo('canvas', SQUARE, M(W.x(cx, o + 0.005), y - s * 0.12, W.z(cx, o + 0.005), s * 0.09, s * 0.55, 1, 0, W.ry, 0), col); return; }
  K.geo('canvas', SQUARE, at(0, 0, s * 0.6, s * 0.75), col);
}
const SQUARE = new THREE.PlaneGeometry(1, 1);
const CIRCLE = new THREE.CircleGeometry(0.5, 16);
const DIAMOND = new THREE.CircleGeometry(0.5, 4);
function shadeHex(c: string, f: number): string { const k = new THREE.Color(c).multiplyScalar(f); return '#' + k.getHexString(); }

/* ------------------------------------------------------------------ shelf clutter */
function shelfClutter(K: RoomKit, W: Wall, ua: number, ub: number, y: number, kind: Shelf, seed: number): void {
  const o = 0.15;
  if (kind === 'books' || kind === 'scrolls') {
    if (kind === 'books') {
      if (W.c) books(K, ua, Math.min(ub, ua + (ub - ua) * 0.6), y, W.z(0, o), 0.18, seed, 'x');
      else books(K, W.s > 0 ? -Math.min(ub, ua + (ub - ua) * 0.6) : ua, W.s > 0 ? -ua : Math.min(ub, ua + (ub - ua) * 0.6), y, W.x(0, o), 0.18, seed, 'z');
      // a lying stack + a candle on the rest
      const su = ua + (ub - ua) * 0.78;
      for (let i = 0; i < 3; i++) K.rbox('back', ['#6a4a9a', '#a3122a', '#c9884a'][i], W.x(su, o), y + 0.025 + i * 0.045, W.z(su, o), 0.22 - i * 0.02, 0.04, 0.16, W.ry + i * 0.15);
    } else {
      for (let i = 0; i < 5; i++) { const su = ua + 0.12 + i * (ub - ua - 0.24) / 4; K.geo('back', CYL, _m.compose(_p.set(W.x(su, o), y + 0.05, W.z(su, o)), _q.setFromEuler(_e.set(Math.PI / 2, W.ry, 0, 'YXZ')), _s.set(0.09, 0.22, 0.09)), i % 2 ? '#e8d8b0' : '#d8c49a'); K.geo('back', CYL, _m.compose(_p.set(W.x(su, o), y + 0.05, W.z(su, o)), _q, _s.set(0.11, 0.03, 0.11)), '#a33a2a'); }
    }
    return;
  }
  const n = Math.max(3, Math.floor((ub - ua) / 0.17));
  for (let i = 0; i < n; i++) {
    const su = ua + 0.07 + (ub - ua - 0.14) * (n === 1 ? 0.5 : i / (n - 1)), x = W.x(su, o), z = W.z(su, o), r = rh(seed * 13 + i, 2);
    if (kind === 'jars') {
      const c = ['#ff9fb2', '#9fe39a', '#ffe27a', '#7fd6e6', '#d8a86a'][(i + seed) % 5], h = 0.13 + r * 0.08;
      K.cyl('glass', '#e8f4ff', x, y, z, 0.055, h, 8); K.cyl('back', c, x, y + 0.006, z, 0.046, h * 0.65, 8);
      K.cyl('canvas', ['#c84a3a', '#e8dcc8', '#4a7ab0'][i % 3], x, y + h, z, 0.062, 0.025, 8);
    } else if (kind === 'pots') {
      const s = 0.08 + r * 0.05;
      K.ball('back', ['#b4643a', '#c88a5a', '#8a5a3a'][i % 3], x, y + s * 0.85, z, s, 0.9);
      K.cyl('back', '#9a4a2a', x, y + s * 1.55, z, s * 0.55, 0.035, 8);
    } else if (kind === 'bottles') {
      const c = ['#3a7a4a', '#7a3a6a', '#3a5a8a', '#a8742a'][(i + seed) % 4], h = 0.14 + r * 0.1;
      K.cyl('glass', c, x, y, z, 0.04, h, 8); K.cyl('glass', c, x, y + h, z, 0.014, 0.07, 8); K.cyl('wood', '#a8754f', x, y + h + 0.07, z, 0.016, 0.02, 8);
    } else if (kind === 'ingots') {
      for (let l = 0; l < 2; l++) K.rbox('metal', r > 0.5 ? '#c9a04a' : '#9aa2ac', x, y + 0.025 + l * 0.045, z, 0.12, 0.04, 0.07, W.ry + (l ? Math.PI / 2 : 0) * 0.2);
    } else if (kind === 'crystals') {
      for (let l = 0; l < 3; l++) K.cone('emit', l % 2 ? '#b9a2ff' : '#7fd6e6', x + (l - 1) * 0.03, y, z + ((l * 7) % 3 - 1) * 0.02, 0.028, 0.1 + l * 0.04);
      if (i % 2 === 0) K.glow(x, y + 0.12, z, 0.35, '#b9a2ff', 0.6);
    } else {
      const s = 0.12 + r * 0.06;
      K.rbox('wood', ['#c9884a', '#a8754f', '#d9a066'][i % 3], x, y + s / 2, z, s, s, s * 0.9, W.ry + (r - 0.5) * 0.4);
    }
  }
}

/* ------------------------------------------------------------------ hanging from the beams */
function hangOne(K: RoomKit, x: number, top: number, z: number, kind: Hang, i: number): void {
  const string = (y0: number) => K.box('back', '#3a2a24', x - 0.006, x + 0.006, y0, top, z - 0.006, z + 0.006);
  switch (kind) {
    case 'herb': hanging(K, x, top - 0.12, z, top, ['#8ab85a', '#c8a85a', '#6a9a4a'][i % 3], 'herb'); break;
    case 'garlic': hanging(K, x, top - 0.1, z, top, '#f2ead8', 'garlic'); break;
    case 'pepper': hanging(K, x, top - 0.1, z, top, '#c8341a', 'pepper'); break;
    case 'sausage': for (let k = 0; k < 3; k++) { K.box('back', '#3a2a24', x - 0.005 + (k - 1) * 0.05, x + 0.005 + (k - 1) * 0.05, top - 0.12, top, z - 0.005, z + 0.005); K.cyl('back', k % 2 ? '#8a3a2a' : '#a84a32', x + (k - 1) * 0.05, top - 0.42 + k * 0.03, z, 0.035, 0.3, 8); } break;
    case 'pot': string(top - 0.12); K.cyl('metal', '#c8743a', x, top - 0.38, z, 0.14, 0.2, 12); K.cyl('metal', '#e09a5a', x, top - 0.185, z, 0.15, 0.025, 12); K.box('metal', '#3a3440', x - 0.012, x + 0.012, top - 0.2, top - 0.12, z - 0.15, z + 0.15); break;
    case 'chain': for (let k = 0; k < 7; k++) K.rbox('metal', '#4a4458', x, top - 0.05 - k * 0.09, z, k % 2 ? 0.012 : 0.05, 0.09, k % 2 ? 0.05 : 0.012); K.geo('metal', CYL, _m.compose(_p.set(x, top - 0.7, z), _q.setFromEuler(_e.set(Math.PI / 2, 0, 0)), _s.set(0.14, 0.025, 0.14)), '#5a5470'); break;
    case 'crystal': string(top - 0.25); K.cone('emit', i % 2 ? '#b9a2ff' : '#7fd6e6', x, top - 0.45, z, 0.06, 0.2, true); K.glow(x, top - 0.38, z, 0.7, '#b9a2ff', 0.8); break;
    case 'star': string(top - 0.3); K.geo('emit', STAR, M(x, top - 0.38, z, 0.22, 0.22, 1, 0, i * 0.7, 0), '#fff3c4'); K.glow(x, top - 0.38, z, 0.6, '#fff3c4', 0.7); break;
    case 'basket': string(top - 0.15); basket(K, x, top - 0.36, z, 0.17, ['#c84a3a', '#e8c86a', '#9fe39a'], 0.14); break;
    case 'ribbon': for (let k = 0; k < 3; k++) K.rbox('canvas', ['#ffcf4a', '#c8102e', '#7fd6e6'][(i + k) % 3], x + (k - 1) * 0.06, top - 0.32, z, 0.04, 0.6, 0.008, 0.3 * k, 0, (k - 1) * 0.08); break;
    case 'lamp': string(top - 0.25); K.box('metal', '#3a3440', x - 0.07, x + 0.07, top - 0.29, top - 0.25, z - 0.07, z + 0.07); K.box('emit', '#ffcf6a', x - 0.055, x + 0.055, top - 0.45, top - 0.29, z - 0.055, z + 0.055); K.box('metal', '#3a3440', x - 0.07, x + 0.07, top - 0.49, top - 0.45, z - 0.07, z + 0.07); K.glow(x, top - 0.37, z, 0.9, '#ffcf6a', 0.85); K.light(x, top - 0.4, z, '#ffb35c', 1.4, 3.5, 0, 0); break;
  }
}

/* ------------------------------------------------------------------ wall-foot clutter; returns the width used */
function foot(K: RoomKit, O: Occ, W: Wall, u: number, kind: Foot, rnd: () => number, check: boolean): number {
  const w = kind === 'logs' ? 0.8 : kind === 'crates' ? 0.7 : kind === 'broom' ? 0.3 : kind === 'chest' ? 0.75 : 0.5;
  const h = kind === 'broom' ? 1.2 : kind === 'crates' ? 0.75 : 0.6, d = kind === 'chest' ? 0.5 : 0.5;
  const oa = 0.08, ob = oa + d;
  if (check) {
    if (u + w > W.u1) return 0;
    if (W.occ(O, u - 0.08, u + w + 0.08, 0, h + 0.1, 0, ob + 0.1)) return 0;
    const xa = Math.min(W.x(u, oa), W.x(u + w, ob)), xb = Math.max(W.x(u, oa), W.x(u + w, ob)), za = Math.min(W.z(u, oa), W.z(u + w, ob)), zb = Math.max(W.z(u, oa), W.z(u + w, ob));
    for (const s of K.solids) if (s.x0 < xb + 0.15 && s.x1 > xa - 0.15 && s.z0 < zb + 0.15 && s.z1 > za - 0.15) return 0;
    for (const f of K.floors) if (f[0] < xb + 0.1 && f[1] > xa - 0.1 && f[2] < zb + 0.1 && f[3] > za - 0.1) return 0;
  }
  const cx = u + w / 2, co = oa + d / 2, x = W.x(cx, co), z = W.z(cx, co), P = K.pal, r = rnd();
  switch (kind) {
    case 'sack': sack(K, W.x(cx - 0.1, co), W.z(cx - 0.1, co), ['#d8c08a', '#c8a870', '#b8a888'][Math.floor(r * 3)], 0.75); sack(K, W.x(cx + 0.14, co + 0.05), W.z(cx + 0.14, co + 0.05), '#c8b088', 0.55); break;
    case 'bucket': K.cyl('wood', '#8a6a4a', x, 0, z, 0.17, 0.32, 12); K.cyl('metal', '#4a4458', x, 0.05, z, 0.176, 0.03, 12); K.cyl('metal', '#4a4458', x, 0.24, z, 0.176, 0.03, 12); K.cyl('water', '#3a5a8a', x, 0.27, z, 0.15, 0.02, 12); break;
    case 'logs': for (let k = 0; k < 5; k++) { const top = k >= 3, l = top ? k - 3 + 0.5 : k, y = top ? 0.27 : 0.1, lu = u + 0.15 + l * 0.21, lo = co + (top ? 0.04 : (k % 2) * 0.03); K.geo('wood', CYL, _m.compose(_p.set(W.x(lu, lo), y, W.z(lu, lo)), _q.setFromEuler(_e.set(Math.PI / 2, W.ry, 0, 'YXZ')), _s.set(0.2, top ? 0.4 : 0.46, 0.2)), k % 2 ? '#8a5a38' : '#7a4e30'); } break;
    case 'crates': K.rbox('wood', '#a8754f', W.x(cx - 0.08, co), 0.2, W.z(cx - 0.08, co), 0.46, 0.4, 0.42, W.ry + (r - 0.5) * 0.2); K.rbox('wood', '#c9884a', W.x(cx + 0.02, co), 0.57, W.z(cx + 0.02, co), 0.34, 0.33, 0.32, W.ry + 0.3); break;
    case 'jugs': for (let k = 0; k < 3; k++) { const px = W.x(u + 0.12 + k * 0.14, co + (k % 2) * 0.08), pz = W.z(u + 0.12 + k * 0.14, co + (k % 2) * 0.08), s = 0.09 + (k % 2) * 0.03; K.ball('back', ['#b4643a', '#c8a26a', '#8a5a3a'][k], px, s, pz, s, 1.15); K.cyl('back', '#9a4a2a', px, s * 1.9, pz, s * 0.4, 0.08, 8); } break;
    case 'basket': basket(K, x, 0, z, 0.22, ['#c84a3a', '#e8c86a', '#9fe39a', '#ff9fb2'], 0.2); break;
    case 'ingots': for (let k = 0; k < 5; k++) { const top = k >= 3, l = top ? k - 3 + 0.5 : k, y = top ? 0.075 : 0.025; K.rbox('metal', k % 2 ? '#9aa2ac' : '#c9a04a', W.x(u + 0.13 + l * 0.12, co + (top ? 0.013 : 0)), y, W.z(u + 0.13 + l * 0.12, co + (top ? 0.013 : 0)), 0.1, 0.045, 0.2, W.ry); } break;
    case 'books': for (let k = 0; k < 4; k++) K.rbox('back', ['#6a4a9a', '#a3122a', '#3a6aa8', '#c9884a'][k], x, 0.03 + k * 0.06, z, 0.3 - k * 0.03, 0.055, 0.22, W.ry + k * 0.2); break;
    case 'broom': { _q.setFromEuler(_e.set(0, W.ry, 0)); const tilt = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(W.c, 0, -W.s), -0.18); K.geo('wood', CYL, _m.compose(_p.set(W.x(cx, 0.2), 0.62, W.z(cx, 0.2)), tilt, _s.set(0.03, 1.2, 0.03)), '#a8754f'); K.cone('canvas', '#c8a85a', W.x(cx, 0.31), 0, W.z(cx, 0.31), 0.11, 0.28); break; }
    case 'chest': K.prop('chest', x, 0, z, W.ry, 0.75, { solid: false }); break;
  }
  void P;
  if (check) W.mark(O, u - 0.08, u + w + 0.08, 0, h + 0.1, 0, ob + 0.1);
  const xa = Math.min(W.x(u, oa), W.x(u + w, ob)), xb = Math.max(W.x(u, oa), W.x(u + w, ob)), za = Math.min(W.z(u, oa), W.z(u + w, ob)), zb = Math.max(W.z(u, oa), W.z(u + w, ob));
  if (kind !== 'broom') K.solid(xa, xb, za, zb, kind === 'crates' ? 0.75 : kind === 'chest' ? 0.5 : 0.35, false);
  return w;
}
