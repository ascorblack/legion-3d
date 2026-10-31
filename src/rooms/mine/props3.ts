/**
 * Mine set pieces (visual uplift round 2), baked into the cave's RoomKit batch (no draw calls of their own):
 *  - timberPost: a chamfered mine prop with a cap block, iron bands and a stone footing (q0: the plain post);
 *  - liftCage: the lift in full — platform, frame, a headframe over the cage up into the rock, a sheave wheel with
 *    spokes, plumb hoist ropes, a counterweight on its own guide rails behind the cage, barred walls with a closed gate,
 *    a lantern in the cage (liftPlan says where each part goes);
 *  - crateStack, ropeCoil, oreSacks: clutter for the lift hall and the entrance.
 * Collision is the caller's (the lift and its counterweight column are solids); everything here stays inside the given footprint or hugs it.
 */
import * as THREE from 'three';
import type { RoomKit } from '../common/kit';
import { M } from '../../world/batch';
import { rockGeo } from './art';
import { cobweb, groundHeight, h01, type FloorOpts } from './rockface';
import { chipGeo, fy } from './dress3';

const WOOD = '#6e4626', WOOD_L = '#8a5a32', IRON = '#2a2440', IRON_L = '#4a4458', ROPE = '#c8b890';
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _p = new THREE.Vector3(), _s = new THREE.Vector3();
const CYL = new THREE.CylinderGeometry(0.5, 0.5, 1, 12, 1);
const TORUS = new THREE.TorusGeometry(0.5, 0.06, 6, 20);

/** Chamfered timber post (0.28 m) from the floor to h at (x, z), cap block, two iron bands, a stone footing. */
export function timberPost(K: RoomKit, x: number, z: number, h: number, q: number, col = WOOD, y0 = 0): void {
  if (q <= 0) { K.box('wood', col, x - 0.14, x + 0.14, Math.min(0, y0), h, z - 0.14, z + 0.14); return; }
  K.box('stone', '#5a5260', x - 0.2, x + 0.2, y0 - 0.1, y0 + 0.12, z - 0.2, z + 0.2);
  K.bevel('wood', col, x - 0.14, x + 0.14, y0 + 0.12, h - 0.18, z - 0.14, z + 0.14, 0.035);
  K.bevel('wood', '#7a4e2a', x - 0.19, x + 0.19, h - 0.18, h, z - 0.19, z + 0.19, 0.03);
  for (const y of [0.55, h - 0.6]) K.box('metal', IRON_L, x - 0.152, x + 0.152, y, y + 0.06, z - 0.152, z + 0.152);
}

/** A stack of 2–3 crates (one lid, iron corners) around (x, z), turned by ry. */
export function crateStack(K: RoomKit, x: number, z: number, ry: number, n = 3, seed = 1): void {
  const c = Math.cos(ry), s = Math.sin(ry);
  const put = (lx: number, y: number, lz: number, w: number, rot: number, col: string) => {
    const px = x + c * lx + s * lz, pz = z - s * lx + c * lz;
    K.rbox('wood', col, px, y + w / 2, pz, w, w, w, ry + rot);
    K.rbox('wood', '#5a3a1e', px, y + w / 2, pz, w + 0.02, w * 0.18, w + 0.02, ry + rot);   // the band round the middle
  };
  put(0, 0, 0, 0.62, 0, '#a8754f');
  if (n >= 2) put(0.66, 0, 0.08, 0.52, 0.15, '#c9884a');
  if (n >= 3) put(0.08, 0.62, -0.02, 0.48, -0.2 + (seed % 3) * 0.1, '#b07a4a');
}

/** Coiled rope lying on the floor (three stacked rings). */
export function ropeCoil(K: RoomKit, x: number, z: number, r = 0.32): void {
  for (let k = 0; k < 3; k++) K.geo('canvas', TORUS, _m.compose(_p.set(x, 0.05 + k * 0.07, z), _q.setFromEuler(_e.set(Math.PI / 2, 0, k * 0.7)), _s.set(r * 2 - k * 0.08, r * 2 - k * 0.08, 1.2)), ROPE);
}

/** Sacks of ore slumped against each other. */
export function oreSacks(K: RoomKit, x: number, z: number, n: number, ore: string): void {
  for (let k = 0; k < n; k++) {
    const a = k * 2.1, px = x + Math.cos(a) * 0.32 * (k ? 1 : 0), pz = z + Math.sin(a) * 0.32 * (k ? 1 : 0);
    K.ball('canvas', k % 2 ? '#b89a70' : '#a88a62', px, 0.24, pz, 0.26, 0.95);
    K.cyl('canvas', '#8a7050', px, 0.44, pz, 0.08, 0.1, 8);
    K.ball('stone', ore, px + 0.06, 0.52, pz, 0.07, 0.7);
  }
}

/** The lift's footprint (room metres): the cage over [x0,x1]×[z0,z1], its centre. */
export interface LiftRect { x0: number; x1: number; z0: number; z1: number; cx: number; cz: number }

/** Cage frame heights (m): the platform's top, the top frame (posts end at FRAME_TOP − 0.02). */
export const LIFT_FLOOR = 0.18, LIFT_TOP = 3.02;
/** The counterweight hangs this far behind the cage's back wall (outside the cage, on its own guide rails). */
export const CW_BACK = 0.35;

/**
 * Where the lift's parts go (pure; liftCage and the tests use it). `front`: the open side (+1 = z1, −1 = z0). The
 * headframe stands centred over the cage (legs and cross-head at cz); one big sheave (radius `r`, in the YZ plane at
 * x = cx, centre `wz` half way between the cage's centre and the counterweight) hangs from two sheave beams that run
 * from the cross-head back to the counterweight's guide rails; its two tangents drop plumb — at `cz` to the cage's yoke
 * and at `bz` (behind the back wall) to the counterweight.
 */
export function liftPlan(L: LiftRect, ceil: number, front: 1 | -1, cw = true) {
  const back = front > 0 ? L.z0 : L.z1, fz = front > 0 ? L.z1 : L.z0;
  const hy = Math.min(ceil - 0.35, 4.6);        // the cross-head's underside
  // with a counterweight: its line `bz` outside the back wall, the sheave spans cz…bz; without (the classic lift, open
  // on all sides — a weight behind would show through it): a winding drum (r 0.25) whose front tangent is at cz
  const bz = cw ? back - front * CW_BACK : L.cz - front * 0.5;
  const wz = (L.cz + bz) / 2, r = Math.abs(L.cz - bz) / 2;
  const py = hy - 0.12 - r;                     // the wheel's axle (its top just under the cross-head)
  return { back, fz, bz, wz, r, hy, py, top: LIFT_TOP, cw };
}

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _d = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0);
/** A square beam w × w from a to b (a brace): a unit box turned so its Y axis runs along the segment, pivot in the middle. */
function beam(K: RoomKit, mat: 'wood' | 'metal', col: string, ax: number, ay: number, az: number, bx: number, by: number, bz: number, w: number): void {
  _a.set(ax, ay, az); _b.set(bx, by, bz); _d.subVectors(_b, _a);
  const len = _d.length(); if (len < 1e-4) return;
  _q.setFromUnitVectors(_up, _d.multiplyScalar(1 / len));
  K.geo(mat, BOX1, _m.compose(_p.addVectors(_a, _b).multiplyScalar(0.5), _q, _s.set(w, len, w)), col);
}
const BOX1 = new THREE.BoxGeometry(1, 1, 1);

/**
 * The lift in full, one straight solid piece (0.6.2 rebuild — the 0.6.0 one had its gate leaves turned about the wrong
 * pivot, the sheave's spokes mirrored, braces tilted about the wrong axis and the counterweight hanging INSIDE the cage):
 *  - all qualities: the plank platform, four corner posts up to a top frame, a back rail; with `cage` (the big floor's
 *    lift) the counterweight on its own two guide rails behind the back wall (a solid: the caller makes it one) — the
 *    classic lift is open on all sides, a weight behind it would show through, so it winds its rope on a drum instead;
 *    q0: the ropes go plainly up into the rock;
 *  - q1+: the headframe — two legs over the side frames, braced, a cross-head under the rock and a post into it — with
 *    one sheave wheel (rim, radial spokes, hub on an axle, hangers; classic: the drum) whose ropes drop plumb to the
 *    cage's yoke and to the counterweight; with `cage` barred walls on the three closed sides — evenly spaced
 *    vertical bars from the platform to the top frame, between the posts, with two rails — and a closed two-leaf gate on
 *    the open side, inside the frame; a lantern hanging in the cage.
 * Everything but the braces and the sheave is axis-aligned; everything stays in the cage's footprint, the headframe
 * above it and the counterweight column behind it (test/mine-lift.test.ts).
 */
export function liftCage(K: RoomKit, L: LiftRect, ceil: number, front: 1 | -1, q: number, cage = true): void {
  const P = liftPlan(L, ceil, front, cage), top = P.top;
  // platform, corner posts, top frame (the classic lift stands by the spawn: slim, no bars — thick posts to the ceiling
  // framed the third-person view like a doorway)
  K.box('wood', WOOD_L, L.x0, L.x1, 0, LIFT_FLOOR, L.z0, L.z1);
  for (const [x, z] of [[L.x0, L.z0], [L.x1, L.z0], [L.x0, L.z1], [L.x1, L.z1]]) K.box('wood', WOOD, x - 0.07, x + 0.07, 0, top - 0.02, z - 0.07, z + 0.07);
  for (const z of [L.z0, L.z1]) K.box('wood', WOOD, L.x0 + 0.07, L.x1 - 0.07, top - 0.12, top, z - 0.07, z + 0.07);
  for (const x of [L.x0, L.x1]) K.box('wood', WOOD, x - 0.07, x + 0.07, top - 0.12, top, L.z0 + 0.07, L.z1 - 0.07);
  // the back rail (waist high, between the back posts) — the barred cage only: on the open classic lift it read as a stray pole
  if (cage) K.box('metal', '#3a3448', L.x0 + 0.07, L.x1 - 0.07, 1.0, 1.06, P.back - 0.04, P.back + 0.04);
  const bz = P.bz, gx = 0.27, cwy = 1.9, cw = cage;
  if (cw) {
    // the counterweight column behind the back wall: two guide rails from a footing up to the cross-head, the weight between
    K.box('stone', '#5a5260', L.cx - gx - 0.1, L.cx + gx + 0.1, 0, 0.1, bz - 0.12, bz + 0.12);
    for (const sx of [-1, 1]) K.box('metal', IRON, L.cx + sx * gx - 0.025, L.cx + sx * gx + 0.025, 0.1, P.hy, bz - 0.03, bz + 0.03);
    K.box('metal', IRON_L, L.cx - 0.22, L.cx + 0.22, cwy - 0.35, cwy + 0.35, bz - 0.11, bz + 0.11);
    K.box('metal', IRON, L.cx - gx - 0.02, L.cx + gx + 0.02, cwy + 0.35, cwy + 0.4, bz - 0.05, bz + 0.05);   // the shoe on the rails
  }
  if (q <= 0) {
    // the cheap lift: the hoist rope (and the counterweight's) straight up into the rock
    K.box('metal', ROPE, L.cx - 0.015, L.cx + 0.015, top, ceil, L.cz - 0.015, L.cz + 0.015);
    if (cw) K.box('metal', ROPE, L.cx - 0.015, L.cx + 0.015, cwy + 0.4, ceil, bz - 0.015, bz + 0.015);
    return;
  }
  const hy = P.hy, wz = P.wz, r = P.r, py = P.py, cz = L.cz;
  // headframe: a leg up from the middle of each side frame, an A of two braces from the frame's corners, the cross-head,
  // a post into the rock
  for (const x of [L.x0, L.x1]) {
    K.bevel('wood', WOOD, x - 0.1, x + 0.1, top, hy, cz - 0.1, cz + 0.1, 0.025);
    for (const z of [L.z0 + 0.12, L.z1 - 0.12]) beam(K, 'wood', WOOD, x, top + 0.03, z, x, hy - 0.3, cz + Math.sign(z - cz) * 0.1, 0.09);
  }
  K.bevel('wood', WOOD_L, L.x0 - 0.2, L.x1 + 0.2, hy, hy + 0.24, cz - 0.16, cz + 0.16, 0.03);
  K.box('wood', WOOD, L.cx - 0.12, L.cx + 0.12, hy + 0.24, ceil + 0.2, cz - 0.12, cz + 0.12);
  // two wheel beams from the cross-head back over the wheel (with a counterweight: on to its guide rails, tied across there)
  const far = cw ? bz : wz - front * (r + 0.08);
  const z0b = Math.min(cz - 0.16, far - 0.05), z1b = Math.max(cz + 0.16, far + 0.05);
  for (const sx of [-1, 1]) K.box('wood', WOOD_L, L.cx + sx * 0.2 - 0.06, L.cx + sx * 0.2 + 0.06, hy, hy + 0.16, z0b, z1b);
  if (cw) K.box('metal', IRON, L.cx - gx - 0.03, L.cx + gx + 0.03, hy - 0.08, hy, bz - 0.05, bz + 0.05);
  if (cw) {
    // the sheave: rim (TORUS, ring in the YZ plane), six radial spokes, a hub on an axle along X
    _q.setFromEuler(_e.set(0, Math.PI / 2, 0));
    K.geo('metal', TORUS, _m.compose(_p.set(L.cx, py, wz), _q, _s.set(r * 2, r * 2, 1.4)), IRON_L);
    for (let k = 0; k < 6; k++) {
      const a = k * Math.PI / 3;   // spoke direction (0, sin a, cos a): CYL's Y axis turned about X by π/2 − a
      K.geo('metal', CYL, _m.compose(_p.set(L.cx, py + Math.sin(a) * r * 0.5, wz + Math.cos(a) * r * 0.5), _q.setFromEuler(_e.set(Math.PI / 2 - a, 0, 0)), _s.set(0.04, r, 0.04)), IRON);
    }
  } else {
    // the winding drum: a barrel of rope along X with two iron flanges
    _q.setFromEuler(_e.set(0, 0, Math.PI / 2));
    K.geo('canvas', CYL, _m.compose(_p.set(L.cx, py, wz), _q, _s.set(r * 2, 0.26, r * 2)), ROPE);
    for (const sx of [-1, 1]) K.geo('metal', CYL, _m.compose(_p.set(L.cx + sx * 0.14, py, wz), _q, _s.set(r * 2 + 0.12, 0.03, r * 2 + 0.12)), IRON);
  }
  K.geo('metal', CYL, _m.compose(_p.set(L.cx, py, wz), _q.setFromEuler(_e.set(0, 0, Math.PI / 2)), _s.set(0.1, 0.34, 0.1)), '#c9a04a');   // axle
  for (const sx of [-1, 1]) K.box('metal', IRON, L.cx + sx * 0.17 - 0.03, L.cx + sx * 0.17 + 0.03, py - 0.06, hy, wz - 0.05, wz + 0.05);   // hangers
  // the yoke on the cage's top frame and the plumb ropes off the wheel's tangents (cage: cz, counterweight: bz)
  K.box('wood', WOOD_L, L.cx - 0.6, L.cx + 0.6, top, top + 0.12, L.cz - 0.06, L.cz + 0.06);
  K.box('metal', IRON, L.cx - 0.05, L.cx + 0.05, top + 0.12, top + 0.22, L.cz - 0.05, L.cz + 0.05);
  K.box('canvas', ROPE, L.cx - 0.025, L.cx + 0.025, top + 0.22, py, L.cz - 0.025, L.cz + 0.025);
  if (cw) K.box('canvas', ROPE, L.cx - 0.025, L.cx + 0.025, cwy + 0.4, py, bz - 0.025, bz + 0.025);
  if (!cage) return;
  // barred walls on the three closed sides: vertical bars in the frame's plane, evenly spaced between the posts, from the
  // platform to the top frame; a kick rail and a mid rail
  const BAR = 0.022, y0 = LIFT_FLOOR, y1 = top - 0.12;
  const wall = (ax: number, az: number, bx: number, bz2: number) => {
    const alongX = Math.abs(bx - ax) > Math.abs(bz2 - az);
    const a = (alongX ? Math.min(ax, bx) : Math.min(az, bz2)) + 0.07, b = (alongX ? Math.max(ax, bx) : Math.max(az, bz2)) - 0.07;
    const n = Math.max(2, Math.round((b - a) / 0.24));
    for (let k = 1; k < n; k++) {
      const t = a + (b - a) * k / n;
      if (alongX) K.box('metal', IRON_L, t - BAR, t + BAR, y0, y1, az - BAR, az + BAR);
      else K.box('metal', IRON_L, ax - BAR, ax + BAR, y0, y1, t - BAR, t + BAR);
    }
    for (const [ry0, ry1] of [[0.3, 0.36], [1.25, 1.31]]) {
      if (alongX) K.box('metal', IRON, a, b, ry0, ry1, az - 0.035, az + 0.035);
      else K.box('metal', IRON, ax - 0.035, ax + 0.035, ry0, ry1, a, b);
    }
  };
  wall(L.x0, P.back, L.x1, P.back); wall(L.x0, L.z0, L.x0, L.z1); wall(L.x1, L.z0, L.x1, L.z1);
  // the gate: two closed leaves inside the frame on the open side, each a flat-iron frame with vertical bars, meeting in
  // the middle (a latch there); 2.2 m high like a real cage gate
  const gz = P.fz - front * 0.04, gy0 = LIFT_FLOOR + 0.02, gy1 = 2.2, xa = L.x0 + 0.07, xb = L.x1 - 0.07, xm = (xa + xb) / 2;
  for (const [l0, l1] of [[xa, xm - 0.01], [xm + 0.01, xb]]) {
    for (const x of [l0, l1]) K.box('metal', IRON, x === l0 ? l0 : l1 - 0.05, x === l0 ? l0 + 0.05 : l1, gy0, gy1, gz - 0.02, gz + 0.02);
    for (const y of [gy0, 1.15, gy1 - 0.05]) K.box('metal', IRON, l0 + 0.05, l1 - 0.05, y, y + 0.05, gz - 0.02, gz + 0.02);
    const n = Math.max(2, Math.round((l1 - l0) / 0.2));
    for (let k = 1; k < n; k++) { const x = l0 + (l1 - l0) * k / n; K.box('metal', IRON_L, x - 0.015, x + 0.015, gy0 + 0.05, gy1 - 0.05, gz - 0.012, gz + 0.012); }
  }
  K.box('metal', '#c9a04a', xm - 0.05, xm + 0.05, 1.08, 1.24, gz - front * 0.01 - 0.025, gz - front * 0.01 + 0.025);   // latch
  // a lantern hanging in the cage, by the back wall
  const lx = L.cx, lz = P.back + front * 0.25;
  K.box('metal', IRON, lx - 0.008, lx + 0.008, 2.55, top - 0.12, lz - 0.008, lz + 0.008);
  K.box('emit', '#ffd27a', lx - 0.07, lx + 0.07, 2.3, 2.55, lz - 0.07, lz + 0.07);
  K.cone('metal', IRON, lx, 2.55, lz, 0.11, 0.08, true);
  K.glow(lx, 2.42, lz, 1.0, '#ffb35c', 0.8);
  void M;
}

/* ------------------------------------------------------------------ deterministic cave dressing (seeded) */

/**
 * Scree pebbles, puddles, hanging rocks, roots and cobwebs over an area — every position a pure function of `seed`
 * (channel + floor), so every viewer of the same stream sees the same cave. Pebbles only where nobody walks; puddles sit
 * in the floor's low spots (their surface just over the highest ground under them); ceiling things hang above 3.6 m.
 */
export function dressCave(K: RoomKit, o: { F: FloorOpts; seed: number; ceil: number; q: number; rock: string; rockD: string; pud?: string; roots: boolean; gravel?: number; webs: [number, number, number, number, number, number, number][] }): void {
  if (o.q <= 0) return;
  const F = o.F, W = F.x1 - F.x0, D = F.z1 - F.z0, area = W * D, s = o.seed;
  const lump = rockGeo('slab', 1).geo;
  // scree: pebbles and small rocks at the wall feet (never on walkable ground) — 20-facet chips
  const nP = Math.min(o.q >= 2 ? 700 : 220, Math.round(area * (o.q >= 2 ? 0.2 : 0.06)));
  for (let k = 0; k < nP; k++) {
    const x = F.x0 + h01(k, 1, s) * W, z = F.z0 + h01(k, 2, s) * D;
    if (F.walk(x, z) || F.wallDist(x, z) > 1.8) continue;
    const r = 0.07 + Math.pow(h01(k, 3, s), 1.5) * 0.26, y = fy(F, x, z);
    _q.setFromEuler(_e.set(h01(k, 4, s) * 0.6, h01(k, 5, s) * 6.28, 0));
    K.geo('stone', chipGeo(k), _m.compose(_p.set(x, y - r * 0.2, z), _q, _s.set(r, r * 0.8, r)), mixc(o.rock, o.rockD, h01(k, 6, s)), 1);
  }
  // gravel and fist-sized stones on the open walkable floor (sunk into it: they read as ground, never trip the eye as
  // floating), in drifts (denser where a noise says), kept off the flattened zones round the hall objects
  const nG = Math.round(Math.min(o.q >= 2 ? 900 : 200, Math.round(area * (o.q >= 2 ? 0.75 : 0.16))) * (o.gravel ?? 1));
  for (let k = 0; k < nG; k++) {
    const x = F.x0 + h01(k, 41, s) * W, z = F.z0 + h01(k, 42, s) * D;
    if (!F.walk(x, z) || (F.clear && F.clear(x, z))) continue;
    if (h01(k, 47, s) > 0.25 + Math.max(0, Math.sin(x * 0.7 + s) * Math.sin(z * 0.53 + s * 0.3)) * 1.2 + (1 - F.worn(x, z)) * 0.2) continue;
    const r = 0.04 + Math.pow(h01(k, 43, s), 2.6) * 0.2, y = fy(F, x, z);
    _q.setFromEuler(_e.set(h01(k, 44, s) * 0.8, h01(k, 45, s) * 6.28, 0));
    K.geo('stone', chipGeo(k + 1), _m.compose(_p.set(x, y - r * 0.3, z), _q, _s.set(r, r * 0.7, r * 0.9)), mixc(o.rock, o.rockD, 0.3 + h01(k, 46, s) * 0.6), 1);
  }
  // puddles in the walkable floor's low spots (seep water in every cave; the nature's own colour where it has one)
  for (let k = 0, made = 0; k < 60 && made < Math.max(3, Math.round(area / (o.pud ? 120 : 220))); k++) {
    const x = F.x0 + 2 + h01(k, 11, s) * (W - 4), z = F.z0 + 2 + h01(k, 12, s) * (D - 4), r = 0.4 + h01(k, 13, s) * 0.5;
    if (!F.walk(x, z) || (F.clear && F.clear(x, z)) || groundHeight(F, x, z) > -0.04) continue;
    puddle(K, F, x, z, r, r * (0.6 + h01(k, 14, s) * 0.3), o.pud || DAMP, h01(k, 15, s) * 3);
    made++;
  }
  // hanging rocks (big lumps upside down) and roots from the ceiling
  const nH = Math.min(o.q >= 2 ? 40 : 18, Math.round(area * (o.q >= 2 ? 0.02 : 0.01)));
  for (let k = 0; k < nH; k++) {
    const x = F.x0 + h01(k, 21, s) * W, z = F.z0 + h01(k, 22, s) * D, w = 0.5 + h01(k, 23, s) * 0.8, h = 0.35 + h01(k, 24, s) * 0.5;
    _q.setFromEuler(_e.set(Math.PI, h01(k, 25, s) * 6.28, 0));
    K.geo('stone', lump, _m.compose(_p.set(x, o.ceil + 0.15, z), _q, _s.set(w, h + 0.15, w * 0.9)), mixc(o.rockD, o.rock, 0.3 + h01(k, 26, s) * 0.3), 1);
  }
  if (o.roots) for (let k = 0; k < Math.round(area * 0.012); k++) {
    const x = F.x0 + h01(k, 31, s) * W, z = F.z0 + h01(k, 32, s) * D, L = 0.5 + h01(k, 33, s) * 0.9;
    for (let t = 0; t < 3; t++) {
      const a = h01(k, 34 + t, s) * 6.28, tilt = 0.15 + h01(k, 37 + t, s) * 0.35, len = L * (1 - t * 0.25);
      _q.setFromEuler(_e.set(Math.cos(a) * tilt, 0, Math.sin(a) * tilt));
      K.geo('wood', CYL, _m.compose(_p.set(x + Math.sin(a) * tilt * len * 0.5, o.ceil - len / 2 + 0.05, z - Math.cos(a) * tilt * len * 0.5), _q, _s.set(0.035 - t * 0.008, len, 0.035 - t * 0.008)), '#4a3020');
    }
  }
  // cobwebs in the given corners (x, y, z, ax dir x/z, ay up/down, r): thin pale threads
  for (const [x, y, z, axx, axz, ayy, r] of o.webs) {
    cobweb((cx, cy, cz, sx, sy, sz, rx, ry, rz) => K.geo('back', GEO_BOX, M(cx, cy, cz, sx, sy, sz, rx, ry, rz), '#d8d4cc', 1), x, y, z, new THREE.Vector3(axx, 0, axz), new THREE.Vector3(0, ayy, 0), r);
  }
}
const DISC = new THREE.CylinderGeometry(0.5, 0.5, 1, 16, 1);
/** Seep water colour where the nature has none of its own. */
export const DAMP = '#3c4c54';
/**
 * A puddle: flat water a hair over the highest ground under its oval (the water material mirrors the lantern pools,
 * scene.ts), a darker wet rim round it.
 */
export function puddle(K: RoomKit, F: FloorOpts, x: number, z: number, rx: number, rz: number, col: string, yaw = 0): void {
  let top = fy(F, x, z);
  for (let a = 0; a < 10; a++) top = Math.max(top, fy(F, x + Math.cos(a * 0.628) * rx * 0.5, z + Math.sin(a * 0.628) * rz * 0.5));
  _q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
  K.geo('water', DISC, _m.compose(_p.set(x, top + 0.008, z), _q, _s.set(rx * 2, 0.006, rz * 2)), col, 1);
}
const GEO_BOX = new THREE.BoxGeometry(1, 1, 1);
const mixc = (a: string, b: string, k: number) => '#' + new THREE.Color(a).lerp(new THREE.Color(b), k).getHexString();
