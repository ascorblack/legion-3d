/**
 * Mine set dressing, pass 2 (visual uplift round 2): the things that make the cave floor and ceiling read as real ground
 * and real rock from eye height — all baked into the cave's RoomKit batches (no draw calls of their own), every position
 * a pure function of the cave seed (channel + floor), so every viewer of the same stream sees the same cave.
 *
 *  - chipGeo / slabGeo: cheap low-poly pebbles (20 facets) and broken flagstones (chamfered polygons);
 *  - floorSlabs / cracks: flat broken slabs set into the walkway, cracks with raised lips and a dark gap (walkable: ≤ 3 cm);
 *  - rubble / outcrop / stalagmite: scree mounds, boulders, rock teeth — only where nobody walks (wall feet, side strips);
 *  - remains: the chips a dug stone leaves (laid inside the stone's footprint: hidden until it is dug), ore crumbs;
 *  - railTrack: sleepers + two rails following the ground; buffer stop at the end;
 *  - pitPlanks: a dark pit with a rubble rim and planks laid across it;
 *  - toolPile: pickaxe / shovel leaning on the rock, a bucket, a sack;
 *  - stalactiteCluster: a ceiling boss with a cluster of drips round it;
 *  - lantern3d: a real lantern — frame, glass, cap, chimney, ring — on an iron wall bracket with a brace, or on a chain.
 * Heights come from FloorOpts.meshY (the built floor mesh) so nothing floats over or sinks into the relief.
 */
import * as THREE from 'three';
import type { RoomKit } from '../common/kit';
import { rockGeo, pickaxeGeo, crystalGeo } from './art';
import { floorHeight, h01, type FloorOpts } from './rockface';

const IRON = '#2a2440', IRON_L = '#4a4458';
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _p = new THREE.Vector3(), _s = new THREE.Vector3();
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _d = new THREE.Vector3(), _c = new THREE.Color(), _c2 = new THREE.Color();
const UP = new THREE.Vector3(0, 1, 0);
const BOX = new THREE.BoxGeometry(1, 1, 1);
const LINK = new THREE.TorusGeometry(0.5, 0.16, 3, 6);
const RING = new THREE.TorusGeometry(0.5, 0.09, 3, 8);
const BARREL = new THREE.CylinderGeometry(0.5, 0.5, 1, 10, 2);
(() => { const p = BARREL.attributes.position as THREE.BufferAttribute; for (let i = 0; i < p.count; i++) { const y = p.getY(i); if (Math.abs(y) < 0.01) { p.setX(i, p.getX(i) * 1.12); p.setZ(i, p.getZ(i) * 1.12); } } BARREL.computeVertexNormals(); })();
const DISC = new THREE.CylinderGeometry(0.5, 0.5, 1, 14, 1);
const DRIP = new THREE.ConeGeometry(1, 1, 6).rotateX(Math.PI);   // tip down, unit height, centred
const TOOTH = new THREE.ConeGeometry(1, 1, 6);                    // tip up
const LOG = new THREE.CylinderGeometry(0.2, 0.24, 1.8, 9, 1);

const hh = (a: number, b: number, c: number) => { const s = Math.sin(a * 127.1 + b * 311.7 + c * 74.7) * 43758.5453; return s - Math.floor(s); };
const cache = new Map<string, THREE.BufferGeometry>();
function memo(k: string, f: () => THREE.BufferGeometry): THREE.BufferGeometry { let g = cache.get(k); if (!g) cache.set(k, (g = f())); return g; }
export const mixc = (a: string, b: string, k: number) => '#' + _c.set(a).lerp(_c2.set(b), Math.max(0, Math.min(1, k))).getHexString();

/** Height of the built floor at (x, z) (the mesh, else the analytic floor). */
export const fy = (F: FloorOpts, x: number, z: number) => (F.meshY ? F.meshY(x, z) : floorHeight(F, x, z));

/* ------------------------------------------------------------------ geometries */

/** Low-poly pebble: a jittered icosahedron (20 flat facets), squat, flat-ish bottom; unit radius. */
export function chipGeo(v: number): THREE.BufferGeometry {
  return memo('chip' + (v % 4), () => {
    const g = new THREE.IcosahedronGeometry(1, 0);
    const p = g.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      const k = 0.72 + hh(Math.round(x * 40) + v * 13, Math.round(y * 40), Math.round(z * 40)) * 0.56;
      p.setXYZ(i, x * k, Math.max(-0.3, y * k * 0.72), z * k);
    }
    g.deleteAttribute('uv'); g.computeVertexNormals();
    return g;
  });
}

/** Non-indexed triangle soup with outward-facing winding (flips a triangle whose normal looks against `out`). */
function soup(): { tri(a: number[], b: number[], c: number[], out: number[]): void; geo(): THREE.BufferGeometry } {
  const pos: number[] = [];
  return {
    tri(a, b, c, out) {
      _a.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]); _b.set(c[0] - a[0], c[1] - a[1], c[2] - a[2]); _d.crossVectors(_a, _b);
      if (_d.x * out[0] + _d.y * out[1] + _d.z * out[2] < 0) pos.push(...a, ...c, ...b); else pos.push(...a, ...b, ...c);
    },
    geo() { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.computeVertexNormals(); return g; },
  };
}

/** Broken flagstone: an irregular 6–8-gon, chamfered top edge; footprint radius ≈ 1, height 1 (bottom open). */
export function slabGeo(v: number): THREE.BufferGeometry {
  return memo('slab' + (v % 5), () => {
    const n = 6 + (v % 3), S = soup();
    const ang = (i: number) => (i / n) * Math.PI * 2 + (hh(i, v, 5) - 0.5) * 0.55;
    const rad = (i: number) => 0.7 + hh(i, v, 3) * 0.3;
    const ring = (y: number, k: number) => Array.from({ length: n }, (_, i) => [Math.cos(ang(i)) * rad(i) * k, y + (k < 1 ? (hh(i, v, 9) - 0.5) * 0.12 : 0), Math.sin(ang(i)) * rad(i) * k]);
    const top = ring(1, 0.8), mid = ring(0.62, 1), bot = ring(0, 1.02);
    const c = [0, 1.02, 0];
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n, o = [Math.cos(ang(i)), 0.3, Math.sin(ang(i))];
      S.tri(c, top[i], top[j], [0, 1, 0]);
      S.tri(top[i], mid[i], mid[j], o); S.tri(top[i], mid[j], top[j], o);
      S.tri(mid[i], bot[i], bot[j], [o[0], 0, o[2]]); S.tri(mid[i], bot[j], mid[j], [o[0], 0, o[2]]);
    }
    return S.geo();
  });
}

/** Shovel (handle along +Y from the grip at the origin, blade at the bottom end pointing −Y): wood + iron. */
function shovelGeo(): { wood: THREE.BufferGeometry; iron: THREE.BufferGeometry } {
  const w = memo('shovelW', () => { const h = new THREE.CylinderGeometry(0.022, 0.024, 1.0, 6).translate(0, 0.5, 0); const t = new THREE.BoxGeometry(0.16, 0.04, 0.04).translate(0, 1.0, 0); return merge([h, t]); });
  const i = memo('shovelI', () => { const b = new THREE.BoxGeometry(0.22, 0.28, 0.02).translate(0, -0.12, 0); const s = new THREE.CylinderGeometry(0.03, 0.035, 0.1, 6).translate(0, 0.03, 0); return merge([b, s]); });
  return { wood: w, iron: i };
}
function merge(gs: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const pos: number[] = [];
  for (const g of gs) { const n = g.index ? g.toNonIndexed() : g; pos.push(...(n.attributes.position.array as Float32Array)); if (n !== g) n.dispose(); g.dispose(); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.computeVertexNormals(); return g;
}

/* ------------------------------------------------------------------ helpers */

/** A box from point a to point b (cross-section w × h), e.g. a rail, a beam, a brace, an arm. */
export function bar(K: RoomKit, mat: 'metal' | 'wood' | 'stone' | 'canvas' | 'emit', col: string, ax: number, ay: number, az: number, bx: number, by: number, bz: number, w: number, h = w, roll = 0): void {
  _d.set(bx - ax, by - ay, bz - az); const L = _d.length(); if (L < 1e-4) return; _d.multiplyScalar(1 / L);
  _q.setFromUnitVectors(UP, _d);
  if (roll) _q.multiply(new THREE.Quaternion().setFromAxisAngle(UP, roll));
  K.geo(mat, BOX, _m.compose(_p.set((ax + bx) / 2, (ay + by) / 2, (az + bz) / 2), _q, _s.set(w, L, h)), col, 1);
}

/** Lowest / highest built floor over a disc (8 rim samples + the centre). */
function spanY(F: FloorOpts, x: number, z: number, r: number): [number, number] {
  let lo = fy(F, x, z), hi = lo;
  for (let a = 0; a < 8; a++) { const y = fy(F, x + Math.cos(a * 0.785) * r, z + Math.sin(a * 0.785) * r); if (y < lo) lo = y; if (y > hi) hi = y; }
  return [lo, hi];
}
/** Tilt (quaternion) of the ground at (x, z) over a span r, turned by yaw. */
function groundQ(F: FloorOpts, x: number, z: number, r: number, yaw: number, out: THREE.Quaternion): THREE.Quaternion {
  const sx = (fy(F, x + r, z) - fy(F, x - r, z)) / (2 * r), sz = (fy(F, x, z + r) - fy(F, x, z - r)) / (2 * r);
  _d.set(-sx, 1, -sz).normalize();
  out.setFromUnitVectors(UP, _d);
  return out.multiply(_q.setFromAxisAngle(UP, yaw));
}
const _gq = new THREE.Quaternion();

/** Contact shadow on the ground round something standing there (the batch's baked AO field, common/ao.ts). */
function ao(K: RoomKit, x: number, z: number, r: number, top: number): void { K.aoExtra.push(x - r, x + r, z - r, z + r, top); }

/* ------------------------------------------------------------------ floor pieces */

export interface DressCol { rock: string; rockD: string; floorL: string; dark: string }

/** A flagstone set into the ground (top ≤ 3 cm over the highest ground under it; walkable). */
export function slab(K: RoomKit, F: FloorOpts, x: number, z: number, r: number, yaw: number, col: string, v: number, rise = 0.025): void {
  const [lo, hi] = spanY(F, x, z, r * 0.9);
  const h = Math.max(0.05, hi - lo + rise + 0.01);
  groundQ(F, x, z, r * 0.8, yaw, _gq);
  K.geo('stone', slabGeo(v), _m.compose(_p.set(x, hi + rise - h, z), _gq, _s.set(r, h, r * (0.7 + (v % 3) * 0.12))), col, 1);
  if (rise > 0.05) ao(K, x, z, r * 0.8, rise + 0.08);
}

/** Bedrock breaking through the dirt: a few low flat-topped rock shelves with crisp edges (5–11 cm; walked over). */
export function shelf(K: RoomKit, F: FloorOpts, x: number, z: number, seed: number, col: string, colD: string): void {
  const n = 2 + Math.floor(h01(seed, 171, 3) * 3);
  for (let k = 0; k < n; k++) {
    const a = h01(k, 172, seed) * 6.28, t = k ? 0.35 + h01(k, 173, seed) * 0.4 : 0;
    slab(K, F, x + Math.cos(a) * t, z + Math.sin(a) * t, 0.28 + h01(k, 174, seed) * 0.32, h01(k, 175, seed) * 6.28, mixc(col, colD, h01(k, 176, seed) * 0.6), seed + k, 0.05 + h01(k, 177, seed) * 0.06);
  }
}

/** A crack: a wandering dark gap with pale raised lips (and a branch), laid on the ground (≤ 2.5 cm high). */
export function crack(K: RoomKit, F: FloorOpts, x: number, z: number, ang: number, len: number, seed: number, C: DressCol, branch = true, glow: string | null = null): void {
  const pts: number[] = []; let a = ang, px = x, pz = z;
  const n = Math.max(3, Math.round(len / 0.22));
  for (let i = 0; i <= n; i++) { pts.push(px, pz); a += (h01(i, 61, seed) - 0.5) * 0.9; px += Math.cos(a) * len / n; pz += Math.sin(a) * len / n; }
  const pos: number[] = [], col: number[] = [];
  const cD = glow ? _c.set(glow).multiplyScalar(2.2).clone() : _c.set(C.dark).multiplyScalar(0.45).clone(), cL = _c.set(C.floorL).multiplyScalar(1.08).clone(), cE = _c.set(C.floorL).lerp(_c2.set(C.dark), 0.4).clone();
  const W = 0.05 + h01(0, 62, seed) * 0.05;
  const rows: number[][] = [];
  for (let i = 0; i <= n; i++) {
    const x0 = pts[i * 2], z0 = pts[i * 2 + 1], x1 = pts[Math.min(n, i + 1) * 2], z1 = pts[Math.min(n, i + 1) * 2 + 1], xm = pts[Math.max(0, i - 1) * 2], zm = pts[Math.max(0, i - 1) * 2 + 1];
    let tx = x1 - xm, tz = z1 - zm; const tl = Math.hypot(tx, tz) || 1; tx /= tl; tz /= tl;
    const nx = -tz, nz = tx, taper = Math.sin((i / n) * Math.PI) * 0.8 + 0.2, w = W * taper;
    const row: number[] = [];
    for (const [o, dy] of [[-2.2, 0.004], [-1, 0.02], [0, 0.006], [1, 0.02], [2.2, 0.004]] as const) {
      const X = x0 + nx * w * o, Z = z0 + nz * w * o; row.push(X, fy(F, X, Z) + dy + 0.006, Z);
    }
    rows.push(row);
  }
  const cols = [cE, cL, cD, cL, cE];
  for (let i = 0; i < n; i++) for (let k = 0; k < 4; k++) {
    const A = rows[i], B = rows[i + 1];
    const p00 = A.slice(k * 3, k * 3 + 3), p01 = A.slice(k * 3 + 3, k * 3 + 6), p10 = B.slice(k * 3, k * 3 + 3), p11 = B.slice(k * 3 + 3, k * 3 + 6);
    // up-facing winding
    for (const [u, v, w2, cu, cv, cw] of [[p00, p10, p11, k, k, k + 1], [p00, p11, p01, k, k + 1, k + 1]] as const) {
      _a.set(v[0] - u[0], v[1] - u[1], v[2] - u[2]); _b.set(w2[0] - u[0], w2[1] - u[1], w2[2] - u[2]); _d.crossVectors(_a, _b);
      const up = _d.y >= 0, tri = up ? [u, v, w2] : [u, w2, v], tc = up ? [cu, cv, cw] : [cu, cw, cv];
      for (let t = 0; t < 3; t++) { pos.push(...tri[t]); const cc = cols[tc[t]]; col.push(cc.r, cc.g, cc.b); }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  K.geo('lowPaving', g, _m.identity(), null, 1.4); g.dispose();
  // a glowing crack (magma): the gap itself is lit — a thin emissive strip down its middle
  if (glow) for (let i = 0; i < n; i++) { const A = rows[i], B = rows[i + 1]; bar(K, 'emit', glow, A[6], A[7] + 0.004, A[8], B[6], B[7] + 0.004, B[8], W * 0.9, 0.012); }
  if (branch && n > 4) { const b = Math.floor(n * (0.3 + h01(1, 63, seed) * 0.4)); crack(K, F, pts[b * 2], pts[b * 2 + 1], ang + (h01(2, 64, seed) > 0.5 ? 0.9 : -0.9), len * 0.45, seed + 17, C, false, glow); }
}

/** One pebble / chip on the ground at (x, z), radius r, sunk by `sink` of its height. */
export function chip(K: RoomKit, F: FloorOpts, x: number, z: number, r: number, col: string, k: number, sink = 0.3, flat = 0.75): void {
  col = mixc(col, F.floor, 0.25);
  _q.setFromEuler(_e.set((hh(k, 1, 2) - 0.5) * 0.7, hh(k, 2, 3) * 6.28, (hh(k, 3, 4) - 0.5) * 0.7));
  K.geo('stone', chipGeo(k), _m.compose(_p.set(x, fy(F, x, z) + r * flat * (0.3 - sink), z), _q, _s.set(r, r * flat, r * (0.75 + hh(k, 4, 5) * 0.4))), col, 1);
  if (r >= 0.1) ao(K, x, z, r * 0.8, r * 1.2);
}

/** A scree mound: chips piled round (x, z) — bigger and higher in the middle. Off the walkway only. */
export function rubble(K: RoomKit, F: FloorOpts, x: number, z: number, R: number, n: number, seed: number, C: DressCol): void {
  for (let k = 0; k < n; k++) {
    const t = Math.sqrt(h01(k, 71, seed)), a = h01(k, 72, seed) * 6.28, px = x + Math.cos(a) * R * t, pz = z + Math.sin(a) * R * t;
    const r = (0.07 + h01(k, 73, seed) * 0.16) * (1.25 - t * 0.6);
    const y0 = fy(F, px, pz) + (1 - t) * R * 0.18;
    _q.setFromEuler(_e.set((h01(k, 74, seed) - 0.5) * 1.2, h01(k, 75, seed) * 6.28, (h01(k, 76, seed) - 0.5) * 1.2));
    K.geo('stone', chipGeo(k + seed), _m.compose(_p.set(px, y0, pz), _q, _s.set(r, r * 0.8, r)), mixc(C.rock, C.rockD, h01(k, 77, seed)), 1);
  }
  ao(K, x, z, R * 0.75, 0.25 + R * 0.3);
}

/** A boulder / outcrop (detail-1 rock, 80 facets) sunk into the ground. Off the walkway only. */
export function outcrop(K: RoomKit, F: FloorOpts, x: number, z: number, w: number, h: number, seed: number, col: string): void {
  const kind = h01(seed, 81, 3) > 0.5 ? 'hard' : 'slab';
  const g = rockGeo(kind, Math.floor(h01(seed, 82, 3) * 3)).geo;
  const [lo] = spanY(F, x, z, w * 0.7);
  _q.setFromEuler(_e.set((h01(seed, 83, 3) - 0.5) * 0.3, h01(seed, 84, 3) * 6.28, (h01(seed, 85, 3) - 0.5) * 0.3));
  K.geo('stone', g, _m.compose(_p.set(x, lo - h * 0.12, z), _q, _s.set(w, h, w * (0.7 + h01(seed, 86, 3) * 0.5))), col, 1);
  ao(K, x, z, w * 0.75, h);
}

/** A rock tooth growing from the ground (stalagmite), with a stubby twin. Off the walkway only. */
export function stalagmite(K: RoomKit, F: FloorOpts, x: number, z: number, h: number, seed: number, col: string, colD: string): void {
  // a knobbly tooth (angular rock stretched up, a cone tip on it), a stubby twin, scree round the foot
  const y = fy(F, x, z) - 0.08, g = rockGeo('hard', seed % 3).geo;
  K.geo('stone', g, _m.compose(_p.set(x, y, z), _q.setFromEuler(_e.set((h01(seed, 91, 1) - 0.5) * 0.12, h01(seed, 92, 1) * 6, 0)), _s.set(h * 0.26, h * 0.8, h * 0.24)), col, 1);
  K.geo('stone', TOOTH, _m.compose(_p.set(x, y + h * 0.72, z), _q.identity(), _s.set(h * 0.1, h * 0.45, h * 0.1)), col, 1);
  const a = h01(seed, 93, 1) * 6.28, x2 = x + Math.cos(a) * h * 0.26, z2 = z + Math.sin(a) * h * 0.26, h2 = h * (0.35 + h01(seed, 94, 1) * 0.3);
  K.geo('stone', g, _m.compose(_p.set(x2, fy(F, x2, z2) - 0.05, z2), _q.setFromAxisAngle(UP, a), _s.set(h2 * 0.3, h2 * 0.8, h2 * 0.3)), colD, 1);
  for (let k = 0; k < 4; k++) { const b = a + 1.2 + k * 1.3, r = h * 0.22; chip(K, F, x + Math.cos(b) * r, z + Math.sin(b) * r, 0.06 + h01(k, 95, seed) * 0.06, colD, seed + k, 0.3); }
  ao(K, x, z, h * 0.22, h);
}

/** A ceiling boss with a cluster of drips round it (tips down); `ceil` = the rock ceiling plane. */
export function stalactiteCluster(K: RoomKit, x: number, z: number, ceil: number, size: number, seed: number, col: string, colD: string, n = 5): void {
  _q.setFromEuler(_e.set(Math.PI, h01(seed, 101, 5) * 6.28, 0));
  K.geo('stone', rockGeo('slab', 1).geo, _m.compose(_p.set(x, ceil + 0.2, z), _q, _s.set(size * 0.75, size * 0.55 + 0.3, size * 0.65)), colD, 1);
  for (let k = 0; k < n; k++) {
    const t = k === 0 ? 0 : 0.35 + h01(k, 102, seed) * 0.65, a = h01(k, 103, seed) * 6.28, px = x + Math.cos(a) * size * 0.55 * t, pz = z + Math.sin(a) * size * 0.55 * t;
    const L = size * (k === 0 ? 1.5 : 0.5 + h01(k, 104, seed) * 0.8) + 0.3, r = L * (0.12 + h01(k, 105, seed) * 0.06);
    K.geo('stone', DRIP, _m.compose(_p.set(px, ceil + 0.3 - L / 2, pz), _q.setFromEuler(_e.set((h01(k, 106, seed) - 0.5) * 0.12, h01(k, 107, seed) * 6, 0)), _s.set(r, L, r)), mixc(col, colD, h01(k, 108, seed) * 0.7), 1);
  }
}

/** Chips a dug stone left behind, inside its footprint (r ≤ 0.65 m, ≤ 0.14 m high: hidden while the stone stands). */
export function remains(K: RoomKit, F: FloorOpts, x: number, z: number, seed: number, C: DressCol, ore: string | null, q: number): void {
  const n = q >= 2 ? 4 : 2;
  for (let k = 0; k < n; k++) {
    const a = h01(k, 111, seed) * 6.28, t = 0.2 + h01(k, 112, seed) * 0.45, r = 0.05 + h01(k, 113, seed) * 0.08;
    chip(K, F, x + Math.cos(a) * t, z + Math.sin(a) * t, r, mixc(C.rock, C.rockD, h01(k, 114, seed)), k + seed, 0.45);
  }
  if (ore) for (let k = 0; k < (q >= 2 ? 3 : 1); k++) {
    const a = h01(k, 115, seed) * 6.28, t = 0.15 + h01(k, 116, seed) * 0.5;
    chip(K, F, x + Math.cos(a) * t, z + Math.sin(a) * t, 0.035 + h01(k, 117, seed) * 0.03, ore, k + seed * 3, 0.3, 0.9);
  }
}

/** Ore crumbs scattered round a point (r ≤ R): small bright chips in the ore's colour. Flat; walkable. */
export function oreCrumbs(K: RoomKit, F: FloorOpts, x: number, z: number, R: number, n: number, seed: number, ore: string): void {
  for (let k = 0; k < n; k++) {
    const a = h01(k, 121, seed) * 6.28, t = Math.sqrt(h01(k, 122, seed)) * R;
    chip(K, F, x + Math.cos(a) * t, z + Math.sin(a) * t, 0.03 + h01(k, 123, seed) * 0.035, ore, k + seed, 0.25, 0.9);
  }
}

/* ------------------------------------------------------------------ rails */

/**
 * A mine-cart track along the polyline pts (x, z …): sleepers every 0.62 m resting on the highest ground under them, two
 * rails from sleeper to sleeper (so the track rides the relief), a buffer stop at the end when `stop`. Walkable (≤ 14 cm).
 */
export function railTrack(K: RoomKit, F: FloorOpts, pts: number[], o: { gauge?: number; stop?: boolean; seed?: number } = {}): void {
  const g = (o.gauge ?? 0.62) / 2, seed = o.seed ?? 0;
  // resample at the sleeper pitch
  const S: [number, number, number, number][] = [];   // x, z, tx, tz
  let carry = 0;
  for (let i = 0; i + 3 < pts.length; i += 2) {
    const ax = pts[i], az = pts[i + 1], bx = pts[i + 2], bz = pts[i + 3], L = Math.hypot(bx - ax, bz - az); if (L < 1e-3) continue;
    const tx = (bx - ax) / L, tz = (bz - az) / L;
    for (let d = carry; d <= L; d += 0.62) S.push([ax + tx * d, az + tz * d, tx, tz]);
    carry = (0.62 - ((L - carry) % 0.62)) % 0.62;
  }
  if (S.length < 2) return;
  // every sleeper rests on the ground under its two ends (rolled with the cross slope, bedded 2 cm in); the rails ride
  // the sleepers' tops
  const top: number[] = [], roll: number[] = [];
  S.forEach(([x, z, tx, tz], k) => {
    const nx = -tz, nz = tx;
    const yl = fy(F, x - nx * 0.42, z - nz * 0.42), yr = fy(F, x + nx * 0.42, z + nz * 0.42), yc = fy(F, x, z);
    const y = Math.max((yl + yr) / 2, yc - 0.01) - 0.02, sl = (yr - yl) / 0.84;
    const yaw = Math.atan2(-tz, tx);
    const wob = (h01(k, 131, seed) - 0.5) * 0.1;
    _q.setFromEuler(_e.set(0, yaw + Math.PI / 2 + wob, 0));
    _gq.setFromAxisAngle(_d.set(tx, 0, tz), -Math.atan(sl)); _q.premultiply(_gq);
    K.geo('wood', BOX, _m.compose(_p.set(x, y + 0.035, z), _q, _s.set(1.02, 0.07, 0.17)), ['#5a3a1e', '#6a4424', '#4e321a'][k % 3], 1);
    top.push(y + 0.07); roll.push(sl);
  });
  // rail lengths span two sleepers (the second one's height is between its neighbours': the rail rests on it)
  for (let k = 0; k + 1 < S.length; k += 2) {
    const k1 = Math.min(S.length - 1, k + 2);
    const [x0, z0, tx, tz] = S[k], [x1, z1] = S[k1], nx = -tz, nz = tx;
    for (const sd of [-1, 1]) bar(K, 'metal', '#6a6470', x0 + nx * g * sd, top[k] + roll[k] * g * sd + 0.035, z0 + nz * g * sd, x1 + nx * g * sd, top[k1] + roll[k1] * g * sd + 0.035, z1 + nz * g * sd, 0.05, 0.07);
  }
  if (o.stop) {
    const [x, z, tx, tz] = S[S.length - 1], nx = -tz, nz = tx, y = top[top.length - 1];
    for (const sd of [-1, 1]) bar(K, 'wood', '#7a4e2a', x + nx * g * sd, y, z + nz * g * sd, x + nx * g * sd + tx * 0.05, y + 0.55, z + nz * g * sd + tz * 0.05, 0.12);
    bar(K, 'wood', '#8a5a32', x - nx * 0.5 + tx * 0.08, y + 0.45, z - nz * 0.5 + tz * 0.08, x + nx * 0.5 + tx * 0.08, y + 0.45, z + nz * 0.5 + tz * 0.08, 0.16, 0.2);
    bar(K, 'metal', '#c8641e', x - nx * 0.34 + tx * 0.17, y + 0.45, z - nz * 0.34 + tz * 0.17, x + nx * 0.34 + tx * 0.17, y + 0.45, z + nz * 0.34 + tz * 0.17, 0.05, 0.12);
  }
}

/* ------------------------------------------------------------------ pits, tools, crates */

/** A dark pit (w × d, turned by yaw) with a rim of rubble and 3–4 planks laid across it. */
export function pitPlanks(K: RoomKit, F: FloorOpts, x: number, z: number, w: number, d: number, yaw: number, seed: number, C: DressCol): void {
  const [, hi] = spanY(F, x, z, Math.max(w, d) * 0.5);
  K.geo('dark', DISC, _m.compose(_p.set(x, hi + 0.006, z), _q.setFromAxisAngle(UP, yaw), _s.set(w, 0.012, d)), '#0a0810', 1);
  const c = Math.cos(yaw), s = Math.sin(yaw);
  for (let k = 0; k < 14; k++) {
    const a = (k / 14) * 6.28 + h01(k, 141, seed) * 0.3, ex = Math.cos(a) * w * 0.52, ez = Math.sin(a) * d * 0.52;
    const px = x + c * ex + s * ez, pz = z - s * ex + c * ez;
    chip(K, F, px, pz, 0.09 + h01(k, 142, seed) * 0.1, mixc(C.rock, C.rockD, 0.4 + h01(k, 143, seed) * 0.6), k + seed, 0.15);
  }
  const n = 3 + (h01(0, 144, seed) > 0.5 ? 1 : 0), pw = 0.24;
  for (let k = 0; k < n; k++) {
    const off = (k - (n - 1) / 2) * (pw + 0.03) + (h01(k, 145, seed) - 0.5) * 0.05, L = d + 0.7 + h01(k, 146, seed) * 0.3, rot = (h01(k, 147, seed) - 0.5) * 0.1;
    const px = x + c * off, pz = z - s * off;
    K.geo('wood', BOX, _m.compose(_p.set(px, hi + 0.04 + k * 0.002, pz), _q.setFromEuler(_e.set((h01(k, 148, seed) - 0.5) * 0.03, yaw + rot, 0)), _s.set(pw, 0.05, L)), ['#8a5a32', '#7a4e2a', '#6e4626', '#946238'][(k + seed) % 4], 1);
  }
}

/** Tools left at the wall foot: a pickaxe or shovel leaning on the rock (wall normal nx, nz), a bucket, a sack. */
export function toolPile(K: RoomKit, F: FloorOpts, x: number, z: number, nx: number, nz: number, seed: number, ore: string): void {
  const yaw = Math.atan2(nx, nz) + Math.PI / 2, tx = nz, tz = -nx;
  ao(K, x + nx * 0.3, z + nz * 0.3, 0.45, 0.5);
  // a tool stands on the floor 0.45 m out from the wall and leans back onto the rock (~68°), turned a little
  const lean = (geo: { wood: THREE.BufferGeometry; iron: THREE.BufferGeometry }, ox: number, lift: number, k2: number) => {
    const px = x + tx * ox + nx * 0.45, pz = z + tz * ox + nz * 0.45, y = fy(F, px, pz);
    _d.set(-nx * 0.37, 0.93, -nz * 0.37).normalize();
    _q.setFromUnitVectors(UP, _d).multiply(_gq.setFromAxisAngle(UP, yaw + (h01(seed, k2, 7) - 0.5) * 0.8));
    _p.set(px, y, pz).addScaledVector(_d, lift);
    K.geo('wood', geo.wood, _m.compose(_p, _q, _s.set(1, 1, 1)), '#9a6a3a', 1);
    K.geo('metal', geo.iron, _m.compose(_p, _q, _s.set(1, 1, 1)), '#8a909c', 1);
  };
  const k = Math.floor(h01(seed, 151, 7) * 4);
  if (k !== 1) lean(pickaxeGeo(), -0.35, 0.02, 154);
  if (k !== 0) lean(shovelGeo(), 0.25, 0.27, 155);
  // bucket with a handle, or an ore sack
  const bx = x + tx * (h01(seed, 152, 7) > 0.5 ? 0.75 : -0.85) + nx * 0.45, bz = z + tz * (h01(seed, 152, 7) > 0.5 ? 0.75 : -0.85) + nz * 0.45, by = fy(F, bx, bz);
  if (h01(seed, 153, 7) > 0.4) {
    K.geo('metal', DISC, _m.compose(_p.set(bx, by + 0.13, bz), _q.identity(), _s.set(0.3, 0.26, 0.3)), '#6a6270', 1);
    K.geo('metal', RING, _m.compose(_p.set(bx, by + 0.27, bz), _q.setFromEuler(_e.set(0, yaw, 0)), _s.set(0.3, 0.3, 0.5)), IRON_L, 1);
    K.geo('stone', chipGeo(seed), _m.compose(_p.set(bx, by + 0.25, bz), _q.identity(), _s.set(0.12, 0.06, 0.12)), ore, 1);
  } else {
    K.geo('canvas', rockGeo('round', 0).geo, _m.compose(_p.set(bx, by - 0.02, bz), _q.setFromAxisAngle(UP, yaw), _s.set(0.26, 0.42, 0.22)), '#a88a62', 1);
    K.cyl('canvas', '#8a7050', bx, by + 0.38, bz, 0.06, 0.08, 8);
  }
}

/** A slumped ore sack (canvas lump with a tied neck) standing at (x, y, z). */
export function sack(K: RoomKit, x: number, y: number, z: number, yaw: number, s: number, col: string): void {
  K.geo('canvas', rockGeo('round', 0).geo, _m.compose(_p.set(x, y - 0.02, z), _q.setFromAxisAngle(UP, yaw), _s.set(0.27 * s, 0.44 * s, 0.23 * s)), col, 1);
  K.cyl('canvas', '#8a7050', x, y + 0.4 * s, z, 0.06 * s, 0.09 * s, 8);
  K.geo('canvas', BOX, _m.compose(_p.set(x, y + 0.5 * s, z), _q.setFromEuler(_e.set(0.4, yaw, 0.2)), _s.set(0.12 * s, 0.05 * s, 0.1 * s)), '#9a8058', 1);
}

/** A crate or a barrel standing on the ground at (x, z), not solid (callers keep it off the walkway's middle). Low-poly
 *  (≈ 60–150 triangles: the prop kit's models are ten times that). */
export function crateOrBarrel(K: RoomKit, F: FloorOpts, x: number, z: number, seed: number, scale = 0.8): void {
  const [lo] = spanY(F, x, z, 0.35);
  const t = h01(seed, 161, 9), yaw = h01(seed, 162, 9) * 6.28, sc = scale * (0.85 + h01(seed, 163, 9) * 0.25);
  ao(K, x, z, 0.32 * sc, 0.8 * sc);
  if (t > 0.55) {
    const h = 0.95 * sc, r = 0.3 * sc, y = lo - 0.02;
    K.geo('wood', BARREL, _m.compose(_p.set(x, y + h / 2, z), _q.setFromAxisAngle(UP, yaw), _s.set(r * 2, h, r * 2)), ['#7a4e2a', '#8a5a32', '#6a4424'][seed % 3], 1);
    for (const f of [0.18, 0.82]) K.geo('metal', DISC, _m.compose(_p.set(x, y + h * f, z), _q.identity(), _s.set(r * 2 * (f === 0.5 ? 1.12 : 1.06), 0.05, r * 2 * 1.06)), IRON_L, 1);
    K.geo('wood', DISC, _m.compose(_p.set(x, y + h, z), _q.identity(), _s.set(r * 1.9, 0.02, r * 1.9)), '#5a3a1e', 1);
  } else {
    const w = 0.62 * sc, c = Math.cos(yaw), sn = Math.sin(yaw);
    const one = (px: number, py: number, pz: number, ww: number, ry: number, col: string) => {
      _q.setFromAxisAngle(UP, ry);
      K.geo('wood', BOX, _m.compose(_p.set(px, py + ww / 2, pz), _q, _s.set(ww, ww, ww)), col, 1);
      for (const [sx, sz] of [[1.02, 0.12], [0.12, 1.02]]) K.geo('wood', BOX, _m.compose(_p.set(px, py + ww / 2, pz), _q, _s.set(ww * sx, ww * 1.01, ww * sz)), '#5a3a1e', 1);
    };
    one(x, lo - 0.02, z, w, yaw, '#a8754f');
    if (t > 0.3) one(x + c * w * 0.08, lo - 0.02 + w, z - sn * w * 0.08, w * 0.78, yaw + 0.35, '#b07a4a');
    else if (t < 0.12) one(x + c * w * 1.05, lo - 0.02, z - sn * w * 1.05, w * 0.8, yaw - 0.2, '#c9884a');
  }
}

/* ------------------------------------------------------------------ lanterns */

export interface LanternOpts {
  q: number; glass: string;
  /** 'bracket': an iron arm from the wall (wall normal wx, wz points from the wall to the lantern, arm length);
   *  'chain': hanging on a chain from `top`; 'none': standing. */
  mount: 'bracket' | 'chain' | 'none';
  wx?: number; wz?: number; arm?: number; top?: number;
}
/**
 * A lantern centred at (x, y, z): base and top plates, four corner posts round a warm glass, a pyramid cap with a chimney,
 * a hanging ring — on an iron wall bracket (back plate, arm, diagonal brace, hook) or a chain of links. ~250 triangles.
 * The light itself is the caller's (light pool + glow + maybe a real light).
 */
export function lantern3d(K: RoomKit, x: number, y: number, z: number, o: LanternOpts): void {
  if (o.q <= 0) {
    K.box('emit', o.glass, x - 0.075, x + 0.075, y - 0.13, y + 0.13, z - 0.075, z + 0.075);
    K.cone('metal', IRON, x, y + 0.13, z, 0.12, 0.09, true);
    if (o.mount === 'bracket') bar(K, 'metal', IRON, x - (o.wx ?? 0) * (o.arm ?? 0.4), y + 0.3, z - (o.wz ?? 0) * (o.arm ?? 0.4), x, y + 0.3, z, 0.04);
    return;
  }
  const r = 0.085;
  K.box('emit', o.glass, x - 0.068, x + 0.068, y - 0.11, y + 0.11, z - 0.068, z + 0.068);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) K.box('metal', IRON, x + sx * r - 0.013, x + sx * r + 0.013, y - 0.13, y + 0.13, z + sz * r - 0.013, z + sz * r + 0.013);
  K.box('metal', IRON_L, x - 0.11, x + 0.11, y - 0.16, y - 0.12, z - 0.11, z + 0.11);
  K.box('metal', IRON, x - 0.105, x + 0.105, y + 0.12, y + 0.15, z - 0.105, z + 0.105);
  K.cone('metal', IRON, x, y + 0.15, z, 0.115, 0.1, true);
  K.cyl('metal', IRON_L, x, y + 0.23, z, 0.022, 0.05, 8);
  K.geo('metal', RING, _m.compose(_p.set(x, y + 0.3, z), _q.setFromAxisAngle(UP, o.wx !== undefined ? Math.atan2(o.wx, o.wz ?? 1) + Math.PI / 2 : 0), _s.set(0.09, 0.09, 0.14)), IRON_L, 1);
  if (o.mount === 'bracket') {
    const wx = o.wx ?? 0, wz = o.wz ?? 1, arm = o.arm ?? 0.42, ax = x - wx * arm, az = z - wz * arm, ay = y + 0.36;
    // back plate on the wall, the arm out over the lantern, a diagonal brace under it, a curled tip, the hook
    _q.setFromAxisAngle(UP, Math.atan2(wx, wz));
    K.geo('metal', BOX, _m.compose(_p.set(ax, ay - 0.14, az), _q, _s.set(0.11, 0.4, 0.03)), IRON, 1);
    bar(K, 'metal', IRON, ax, ay, az, x + wx * 0.06, ay, z + wz * 0.06, 0.035, 0.035);
    bar(K, 'metal', IRON, ax, ay - 0.3, az, x - wx * arm * 0.45, ay, z - wz * arm * 0.45, 0.025);
    K.geo('metal', RING, _m.compose(_p.set(x + wx * 0.08, ay + 0.03, z + wz * 0.08), _q.setFromAxisAngle(UP, Math.atan2(wx, wz) + Math.PI / 2), _s.set(0.08, 0.08, 0.2)), IRON, 1);
    bar(K, 'metal', IRON, x, ay, z, x, y + 0.33, z, 0.014);
  } else if (o.mount === 'chain') {
    const top = o.top ?? y + 1, L = top - (y + 0.34), n = Math.max(1, Math.round(L / 0.1));
    for (let k = 0; k < n; k++) {
      const ly = y + 0.34 + (k + 0.5) * (L / n);
      K.geo('metal', LINK, _m.compose(_p.set(x, ly, z), _q.setFromEuler(_e.set(0, (k % 2) * Math.PI / 2, Math.PI / 2)), _s.set(0.13, 0.065, 0.06)), IRON_L, 1);
    }
  }
}

/* ------------------------------------------------------------------ depth-layer signatures */

/**
 * A wall-foot piece that says which depth layer this is (layers.ts ids), at (x, z) against the wall whose normal is
 * (nx, nz) (pointing into the cave). Off the walkway; ≤ ~300 triangles. Returns a light (x, y, z, r, colour) for the
 * caller's pools when the piece glows, else null.
 *  roots — a tangle of roots out of the rock; clay — a slumped clay bank, wet and glossy; stone — a cut block with drill
 *  holes; granite — a split boulder; grotto — a cluster of glowing caps on a stump; abyss / heart — a glowing magma
 *  crack; crystal / mirror — a crystal cluster; lake — a seep pool; dwarf — a carved column drum; fossil — a petrified log.
 */
export function layerPiece(K: RoomKit, F: FloorOpts, layer: string, x: number, z: number, nx: number, nz: number, seed: number, C: DressCol & { glow: string; lamp: string }): [number, number, number, number, string] | null {
  const y = fy(F, x, z), yaw = Math.atan2(nx, nz), tx = nz, tz = -nx;
  switch (layer) {
    case 'roots': {
      for (let k = 0; k < 5; k++) {
        const a = (k - 2) * 0.35, L = 0.8 + h01(k, 181, seed) * 0.9;
        bar(K, 'wood', '#5a3a22', x - nx * 0.15 + tx * a * 0.6, y + 1.4 + h01(k, 182, seed) * 0.8, z - nz * 0.15 + tz * a * 0.6, x + nx * L * 0.6 + tx * a, y + 0.02, z + nz * L * 0.6 + tz * a, 0.05 - k * 0.004);
      }
      ao(K, x + nx * 0.4, z + nz * 0.4, 0.5, 0.3);
      return null;
    }
    case 'clay': {
      _q.setFromAxisAngle(UP, yaw);
      K.geo('stone', rockGeo('round', 1).geo, _m.compose(_p.set(x + nx * 0.2, y - 0.1, z + nz * 0.2), _q, _s.set(0.9, 0.42, 0.6)), mixc(C.rock, '#7a4a30', 0.5), 1);
      K.geo('water', DISC, _m.compose(_p.set(x + nx * 0.9, y + 0.012, z + nz * 0.9), _q, _s.set(1.0, 0.006, 0.6)), '#5a4032', 1);
      ao(K, x + nx * 0.2, z + nz * 0.2, 0.7, 0.4);
      return null;
    }
    case 'stone': case 'dwarf': {
      // a dressed block (with drill holes / a carved band) leaning on a drum
      _q.setFromEuler(_e.set(0, yaw + 0.3, 0.12));
      K.geo('stone', BOX, _m.compose(_p.set(x + nx * 0.3, y + 0.25, z + nz * 0.3), _q, _s.set(0.9, 0.5, 0.55)), mixc(C.rock, '#9a9488', 0.3), 1);
      if (layer === 'dwarf') {
        K.cyl('stone', mixc(C.rock, '#b0a48a', 0.4), x + tx * 0.8, y - 0.05, z + tz * 0.8, 0.32, 0.7, 12);
        K.cyl('metal', '#c8a04a', x + tx * 0.8, y + 0.45, z + tz * 0.8, 0.335, 0.06, 12);
      } else for (let k = 0; k < 3; k++) K.cyl('dark', '#0a0810', x + nx * 0.3 + tx * (k - 1) * 0.25, y + 0.5, z + nz * 0.3 + tz * (k - 1) * 0.25, 0.025, 0.012, 8);
      ao(K, x + nx * 0.3, z + nz * 0.3, 0.6, 0.5);
      return null;
    }
    case 'granite': {
      for (const sd of [-1, 1]) { _q.setFromEuler(_e.set(0, yaw, sd * 0.18)); K.geo('stone', rockGeo('slab', 2).geo, _m.compose(_p.set(x + nx * 0.35 + tx * sd * 0.33, y - 0.08, z + nz * 0.35 + tz * sd * 0.33), _q, _s.set(0.42, 0.95, 0.7)), mixc(C.rock, '#8a8898', 0.4 + sd * 0.1), 1); }
      ao(K, x + nx * 0.35, z + nz * 0.35, 0.8, 0.8);
      return null;
    }
    case 'grotto': {
      K.cyl('wood', '#4a3a2a', x + nx * 0.3, y - 0.05, z + nz * 0.3, 0.22, 0.4, 8);
      for (let k = 0; k < 4; k++) {
        const a = k * 1.6 + h01(k, 183, seed), px = x + nx * 0.3 + Math.cos(a) * 0.3, pz = z + nz * 0.3 + Math.sin(a) * 0.3, h = 0.25 + h01(k, 184, seed) * 0.35;
        K.cyl('back', '#e8e0d0', px, y, pz, 0.025, h, 8);
        K.geo('emit', DISC, _m.compose(_p.set(px, y + h, pz), _q.identity(), _s.set(0.2 + h * 0.3, 0.05, 0.2 + h * 0.3)), C.glow, 1);
      }
      return [x + nx * 0.4, y + 0.6, z + nz * 0.4, 2.4, C.glow];
    }
    case 'abyss': case 'heart': {
      crack(K, F, x + nx * 0.5 - tx * 0.6, z + nz * 0.5 - tz * 0.6, Math.atan2(tz, tx), 1.6, seed, C, true, '#ff5a1a');
      return [x + nx * 0.5, y + 0.3, z + nz * 0.5, 2.6, '#ff6a2a'];
    }
    case 'crystal': case 'mirror': {
      const cry = crystalGeo();
      for (let k = 0; k < 4; k++) {
        const s = 0.35 + h01(k, 185, seed) * 0.45, a = (k - 1.5) * 0.45;
        _q.setFromAxisAngle(_d.set(tx * Math.sin(a) + nx * 0.4, 1, tz * Math.sin(a) + nz * 0.4).normalize(), h01(k, 186, seed));
        K.geo('emit', cry, _m.compose(_p.set(x + tx * (k - 1.5) * 0.22, y - 0.05, z + tz * (k - 1.5) * 0.22), _q, _s.set(s, s * 1.6, s)), C.glow, 1);
      }
      return [x + nx * 0.4, y + 0.7, z + nz * 0.4, 2.6, C.glow];
    }
    case 'lake': {
      K.geo('water', DISC, _m.compose(_p.set(x + nx * 0.6, y + 0.015, z + nz * 0.6), _q.setFromAxisAngle(UP, yaw), _s.set(1.4, 0.006, 0.9)), '#2a5a78', 1);
      for (let k = 0; k < 5; k++) chip(K, F, x + nx * 0.6 + Math.cos(k * 1.3) * 0.75, z + nz * 0.6 + Math.sin(k * 1.3) * 0.5, 0.08 + h01(k, 187, seed) * 0.08, C.rockD, seed + k, 0.25);
      return null;
    }
    case 'fossil': {
      _q.setFromEuler(_e.set(0, yaw + Math.PI / 2 + (h01(0, 188, seed) - 0.5) * 0.5, Math.PI / 2));
      K.geo('stone', LOG, _m.compose(_p.set(x + nx * 0.4, y + 0.12, z + nz * 0.4), _q, _s.set(1, 1, 1)), '#6a6450', 1);
      for (const sd of [-1, 1]) K.geo('stone', DISC, _m.compose(_p.set(x + nx * 0.4 + tx * sd * 0.91, y + 0.12, z + nz * 0.4 + tz * sd * 0.91), _q, _s.set(0.42, 0.02, 0.42)), '#8a8268', 1);
      ao(K, x + nx * 0.4, z + nz * 0.4, 0.9, 0.35);
      return null;
    }
  }
  return null;
}
