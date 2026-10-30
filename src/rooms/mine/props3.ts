/**
 * Mine set pieces (visual uplift round 2), baked into the cave's RoomKit batch (no draw calls of their own):
 *  - timberPost: a chamfered mine prop with a cap block, iron bands and a stone footing (q0: the plain post);
 *  - liftRig: the lift of the hall in full — a headframe over the cage up into the rock, a pulley wheel with spokes,
 *    hoist ropes, a counterweight on its own rope, barred cage walls with a gate, a lantern on the cage, crates and a
 *    coil of rope round it;
 *  - crateStack, ropeCoil, oreSacks: clutter for the lift hall and the entrance.
 * Collision is the caller's (the lift is one solid already); everything here stays inside the given footprint or hugs it.
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

/**
 * The lift in full: cage over [x0,x1]×[z0,z1] (platform at 0.18 m, frame to 3 m — the caller built posts and the platform),
 * the headframe up to the ceiling, the pulley, ropes, counterweight, cage bars and gate (the open side = `front`: +1 = z1, −1 = z0).
 */
export function liftRig(K: RoomKit, L: { x0: number; x1: number; z0: number; z1: number; cx: number; cz: number }, ceil: number, front: 1 | -1, q: number, cage = true): void {
  if (q <= 0) return;
  const top = 3.02, hy = Math.min(ceil - 0.35, 4.6);
  // headframe: two A-legs from the cage's top frame up to a cross-head under the rock, braced
  for (const x of [L.x0 - 0.05, L.x1 + 0.05]) {
    K.bevel('wood', WOOD, x - 0.1, x + 0.1, top, hy, L.cz - 0.1, L.cz + 0.1, 0.025);
    for (const sz of [-1, 1]) K.rbox('wood', WOOD, x, (top + hy) / 2, L.cz + sz * 0.42, 0.09, hy - top + 0.2, 0.09, 0, sz * -0.42);
  }
  K.bevel('wood', WOOD_L, L.x0 - 0.2, L.x1 + 0.2, hy, hy + 0.24, L.cz - 0.16, L.cz + 0.16, 0.03);
  K.box('wood', WOOD, L.cx - 0.12, L.cx + 0.12, hy + 0.24, ceil + 0.2, L.cz - 0.12, L.cz + 0.12);   // into the rock
  // pulley: a wheel with spokes and a hub on an axle through the cross-head
  const py = hy - 0.42, pr = 0.42;
  _q.setFromEuler(_e.set(0, Math.PI / 2, 0));
  K.geo('metal', TORUS, _m.compose(_p.set(L.cx, py, L.cz), _q, _s.set(pr * 2, pr * 2, 1.4)), IRON_L);
  for (let k = 0; k < 6; k++) { const a = k * Math.PI / 3; K.geo('metal', CYL, _m.compose(_p.set(L.cx, py + Math.sin(a) * pr * 0.5, L.cz + Math.cos(a) * pr * 0.5), _q.setFromEuler(_e.set(a + Math.PI / 2, 0, 0)), _s.set(0.04, pr, 0.04)), IRON); }
  K.geo('metal', CYL, _m.compose(_p.set(L.cx, py, L.cz), _q.setFromEuler(_e.set(0, 0, Math.PI / 2)), _s.set(0.14, 0.5, 0.14)), '#c9a04a');
  for (const sx of [-1, 1]) K.box('metal', IRON, L.cx + sx * 0.2 - 0.03, L.cx + sx * 0.2 + 0.03, py - 0.06, hy, L.cz - 0.06, L.cz + 0.06);
  // hoist ropes from the wheel down to the cage's yoke; the counterweight rope on the far side of the wheel
  K.box('wood', WOOD_L, L.cx - 0.6, L.cx + 0.6, top + 0.02, top + 0.14, L.cz - 0.06, L.cz + 0.06);   // yoke
  for (const dz of [-0.04, 0.04]) K.box('canvas', ROPE, L.cx - 0.016, L.cx + 0.016, top + 0.14, py, L.cz - pr + dz - 0.016, L.cz - pr + dz + 0.016);
  const cwz = L.cz + pr, cwy = 1.4;
  K.box('canvas', ROPE, L.cx - 0.016, L.cx + 0.016, cwy + 0.5, py, cwz - 0.016, cwz + 0.016);
  K.bevel('metal', IRON_L, L.cx - 0.22, L.cx + 0.22, cwy - 0.25, cwy + 0.5, cwz - 0.12, cwz + 0.12, 0.02);
  // cage walls: vertical bars on the three closed sides, a rail, a hinged gate (half open) on the front
  const bars = (ax: number, az: number, bx: number, bz: number) => {
    const len = Math.hypot(bx - ax, bz - az), n = Math.max(2, Math.round(len / 0.32));
    for (let k = 1; k < n; k++) { const t = k / n, x = ax + (bx - ax) * t, z = az + (bz - az) * t; K.box('metal', IRON_L, x - 0.022, x + 0.022, 0.18, 2.2, z - 0.022, z + 0.022); }
    K.rbox('metal', IRON_L, (ax + bx) / 2, 1.1, (az + bz) / 2, Math.abs(bx - ax) + 0.04, 0.04, Math.abs(bz - az) + 0.04);
    K.rbox('metal', IRON_L, (ax + bx) / 2, 2.2, (az + bz) / 2, Math.abs(bx - ax) + 0.04, 0.05, Math.abs(bz - az) + 0.04);
  };
  const back = front > 0 ? L.z0 : L.z1, fz = front > 0 ? L.z1 : L.z0;
  if (cage) { bars(L.x0, back, L.x1, back); bars(L.x0, L.z0, L.x0, L.z1); bars(L.x1, L.z0, L.x1, L.z1); }
  // the gate: a frame of flat iron folded half open on the front, a lantern hanging inside the cage
  const gw = (L.x1 - L.x0) * 0.5, ang = front * 0.9;
  if (cage) for (const [hx, sgn] of [[L.x0, 1], [L.x1, -1]] as const) {
    const cx = hx + sgn * Math.cos(ang) * gw / 2, cz = fz + Math.sin(ang) * gw / 2 * sgn * front;
    K.rbox('metal', IRON_L, cx, 1.0, cz, gw, 0.05, 0.03, -sgn * ang * front);
    K.rbox('metal', IRON_L, cx, 0.35, cz, gw, 0.05, 0.03, -sgn * ang * front);
    K.rbox('metal', IRON_L, cx, 1.65, cz, gw, 0.05, 0.03, -sgn * ang * front);
  }
  const lx = L.cx, lz = back + front * 0.25;
  K.box('metal', IRON, lx - 0.008, lx + 0.008, 2.55, top, lz - 0.008, lz + 0.008);
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
