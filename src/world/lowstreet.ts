/**
 * Lower-street buildings set into the retaining wall (site cityart.js «вход в шахту», «Склад», «Итоги шахты»):
 *  - mine: a rocky outcrop of flat-shaded displaced icospheres (rock texture, faces project along their own normals →
 *    no stretching), a timbered adit (posts, cap, knee braces) with a dark gradient tunnel inside, rails running in,
 *    a mine cart with ore at the mouth, a lantern on a bracket, a pickaxe and the «ШАХТА» sign on the cap;
 *  - mineboard: two posts, a plank board with notices, a little shingle roof and the title plaque;
 *  - storage: a plank barn on an ashlar plinth with a double gate (Z-braces, hinges), shuttered windows, a lantern,
 *    the sign, crates and barrels.
 * Everything goes into the static Batch; solids (for jumping) into k.solids.
 */
import * as THREE from 'three';
import type { Building } from '../contracts';
import { signF } from './buildings';
import { toX, toZ } from './coords';
import { GEO, M } from './batch';
import { type Ctx, box, rbox, cone, ball, signZ, shade, windowZ, gableRoof } from './kit';

/* ------------------------------------------------------------------ rocks */

const CART_TUB = new THREE.CylinderGeometry(0.5, 0.4, 1, 4, 1).rotateY(Math.PI / 4);   // square frustum (tub)
const ICO = [new THREE.IcosahedronGeometry(1, 0), new THREE.IcosahedronGeometry(1, 1), new THREE.IcosahedronGeometry(1, 2)];

/** Deterministic smooth-ish 3D value noise in −1..1. */
function hash3(x: number, y: number, z: number): number {
  const h = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453;
  return (h - Math.floor(h)) * 2 - 1;
}
function vnoise(x: number, y: number, z: number): number {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const fx = x - xi, fy = y - yi, fz = z - zi;
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy), w = fz * fz * (3 - 2 * fz);
  let acc = 0;
  for (let c = 0; c < 8; c++) {
    const dx = c & 1, dy = (c >> 1) & 1, dz = (c >> 2) & 1;
    acc += hash3(xi + dx, yi + dy, zi + dz) * (dx ? u : 1 - u) * (dy ? v : 1 - v) * (dz ? w : 1 - w);
  }
  return acc;
}

export interface RockOpts {
  detail?: 0 | 1 | 2;
  /** Displacement amount (fraction of the radius). */
  rough?: number;
  seed?: number;
  /** World-space vertex hook (carving clearances), mutates the vector; gets the rock centre. */
  carve?: (v: THREE.Vector3, cx: number, cy: number, cz: number) => void;
  /** Flatten the underside below this local y (−1..1). */
  flatBelow?: number;
}

const _v = new THREE.Vector3();
const _ca = new THREE.Color(), _cb = new THREE.Color(), _cc = new THREE.Color();

/**
 * One flat-shaded boulder (ellipsoid rx × ry × rz centred at x, y, z) into the 'rock' batch. Faces get light/base/dark
 * tones by their facing (tops lighter, undersides darker) and a per-face jitter.
 */
export function rock(k: Ctx, x: number, y: number, z: number, rx: number, ry: number, rz: number, o: RockOpts = {}): void {
  const P = k.pal, seed = o.seed ?? Math.floor(k.rnd() * 1000), rough = o.rough ?? 0.2, flat = o.flatBelow ?? -0.45;
  const g = ICO[o.detail ?? 1].clone();
  const pos = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    let px = pos.getX(i), py = pos.getY(i), pz = pos.getZ(i);
    const n = vnoise(px * 1.6 + seed, py * 1.6 + seed * 0.37, pz * 1.6) + 0.45 * vnoise(px * 3.7 - seed, py * 3.7, pz * 3.7 + seed * 0.21);
    const s = 1 + rough * n;
    px *= s; py *= s; pz *= s;
    if (py < flat) py = flat + (py - flat) * 0.25;
    _v.set(x + px * rx, y + py * ry, z + pz * rz);
    o.carve?.(_v, x, y, z);
    pos.setXYZ(i, _v.x, _v.y, _v.z);
  }
  addRock(k, g);
}

/** Flat facets (non-indexed geometry), light/base/dark tone per face by its facing + a per-face jitter, into 'rock'. */
function addRock(k: Ctx, g: THREE.BufferGeometry): void {
  const P = k.pal;
  const pos = g.attributes.position as THREE.BufferAttribute;
  g.computeVertexNormals();   // non-indexed → flat facets
  const nor = g.attributes.normal as THREE.BufferAttribute;
  const col = new Float32Array(pos.count * 3);
  _ca.set(P.rockL); _cb.set(P.rock); _cc.set(P.rockD);
  for (let f = 0; f < pos.count; f += 3) {
    const ny = (nor.getY(f) + nor.getY(f + 1) + nor.getY(f + 2)) / 3;
    const j = hash3(pos.getX(f) * 3.1, pos.getY(f) * 2.3, pos.getZ(f) * 1.7) * 0.5 + 0.5;
    const t = ny * 0.6 + (j - 0.5) * 0.7;   // up-facing / lucky faces lighter
    const c = t > 0.25 ? _ca : t > -0.3 ? _cb : _cc;
    const v = 0.9 + j * 0.18;
    for (let q = 0; q < 3; q++) { col[(f + q) * 3] = c.r * v; col[(f + q) * 3 + 1] = c.g * v; col[(f + q) * 3 + 2] = c.b * v; }
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  k.b.add('rock', g, new THREE.Matrix4(), null, 1.6);
  g.dispose();
}

export interface ShellOpts {
  /** Foot of the mass along x (it reaches the ground there). */
  x0: number; x1: number;
  /** Plateau x-range: full height H(z) here, falling to the ground towards x0 / x1. */
  core: [number, number];
  /** Retaining-wall face (z) and the front plane (z) of the mass. */
  zw: number; zf: number;
  /** Ground under the mass (world y) and the plateau height along z (world y). */
  ground: number; H: (z: number) => number;
  /** Opening in the front plane (the adit mouth): x-range and top (y); bottom = the ground. */
  notch: [number, number, number];
  seed: number;
}

/**
 * Closed rock mass set into the retaining wall (owner bug: the mine could be seen INTO from the ledge / the sides):
 * a displaced heightfield over [x0,x1]×[zw−0.3, zf] (plateau over the adit, falling to the ground at both feet, its back
 * row buried under the coping/upper paving) plus the front cliff plane at zf with the adit opening cut out exactly.
 * Every vertex only moves outward (up / forward / sideways jitter that keeps the clearance), seam vertices are shared by
 * position (the displacement is a function of the undisplaced point), so the mass has no gaps from any angle.
 */
export function rockShell(k: Ctx, o: ShellOpts): void {
  const { x0, x1, zw, zf, ground, notch } = o;
  const g0 = ground - 0.05, [ca, cb] = o.core, [nx0, nx1, ny1] = notch;
  // columns (~0.3 m) with the notch edges as exact column lines
  const xs: number[] = [];
  const nC = Math.max(4, Math.ceil((x1 - x0) / 0.3));
  for (let i = 0; i <= nC; i++) { const x = x0 + (x1 - x0) * i / nC; if (Math.abs(x - nx0) > 0.1 && Math.abs(x - nx1) > 0.1) xs.push(x); }
  xs.push(nx0, nx1); xs.sort((a, b) => a - b);
  // rows: buried back row, just in front of the wall, then ~0.35 m to the front plane
  const zs = [zw - 0.3, zw + 0.08];
  const nR = Math.max(3, Math.ceil((zf - zw - 0.08) / 0.35));
  for (let j = 1; j <= nR; j++) zs.push(zw + 0.08 + (zf - zw - 0.08) * j / nR);
  const prof = (x: number, z: number) => {
    const H = o.H(z);
    if (x >= ca && x <= cb) return H;
    const t = x < ca ? (ca - x) / (ca - x0) : (x - cb) / (x1 - cb);
    return t >= 1 ? g0 : g0 + (H - g0) * Math.pow(1 - t * t, 0.6);
  };
  const hy = (i: number, j: number) => j === 0 ? Math.min(-0.03, prof(xs[i], zs[1])) : prof(xs[i], zs[j]);
  // outward-only displacement as a function of the undisplaced point
  const sd = o.seed;
  const D = (x: number, y: number, z: number, out: THREE.Vector3): THREE.Vector3 => {
    const ddx = Math.max(nx0 - x, 0, x - nx1), ddy = Math.max(y - ny1, 0);
    const fade = Math.min(1, Math.max(0, (Math.hypot(ddx, ddy) - 0.04) / 0.35));
    const foot = Math.min(1, Math.max(0, (y - (g0 + 0.04)) / 0.4)), back = Math.min(1, Math.max(0, (z - (zw + 0.02)) / 0.3));
    const f = fade * foot * back;
    if (f <= 0) return out.set(x, y, z);
    const n1 = vnoise(x * 1.9 + sd, y * 1.9, z * 1.9), n2 = vnoise(x * 1.7, y * 1.7 + sd, z * 1.7 + 3.1), n3 = vnoise(x * 2.3 + 7.7, y * 2.3, z * 2.3 + sd);
    return out.set(x + f * 0.1 * n3, y + f * 0.3 * (0.5 + 0.5 * n1), z + f * 0.24 * (0.5 + 0.5 * n2));
  };
  const pos: number[] = [];
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), d = new THREE.Vector3(), e1 = new THREE.Vector3(), e2 = new THREE.Vector3();
  const tri = (p: THREE.Vector3, q: THREE.Vector3, r: THREE.Vector3) => {
    if (e1.subVectors(q, p).cross(e2.subVectors(r, p)).lengthSq() < 1e-10) return;   // collapsed rows → skip slivers
    pos.push(p.x, p.y, p.z, q.x, q.y, q.z, r.x, r.y, r.z);
  };
  // heightfield (faces up): quad (i,j)-(i+1,j)-(i+1,j+1)-(i,j+1), z grows to the street
  for (let j = 0; j + 1 < zs.length; j++) for (let i = 0; i + 1 < xs.length; i++) {
    D(xs[i], hy(i, j), zs[j], a); D(xs[i + 1], hy(i + 1, j), zs[j], b);
    D(xs[i + 1], hy(i + 1, j + 1), zs[j + 1], c); D(xs[i], hy(i, j + 1), zs[j + 1], d);
    tri(a, d, c); tri(a, c, b);
  }
  // front cliff (faces +z): rows at fixed heights (the notch top is one of them), clipped to the heightfield's front row
  const last = zs.length - 1;
  let top = g0; for (let i = 0; i < xs.length; i++) top = Math.max(top, hy(i, last));
  const ys = [g0];
  const nY = Math.max(2, Math.ceil((top - g0) / 0.3));
  for (let r = 1; r <= nY; r++) { const y = g0 + (top - g0) * r / nY; if (Math.abs(y - ny1) > 0.08) ys.push(y); }
  ys.push(ny1); ys.sort((p, q) => p - q);
  for (let r = 0; r + 1 < ys.length; r++) for (let i = 0; i + 1 < xs.length; i++) {
    if (xs[i] >= nx0 - 1e-6 && xs[i + 1] <= nx1 + 1e-6 && ys[r + 1] <= ny1 + 1e-6) continue;   // the adit mouth
    const ha = hy(i, last), hb = hy(i + 1, last);
    D(xs[i], Math.min(ys[r], ha), zf, a); D(xs[i + 1], Math.min(ys[r], hb), zf, b);
    D(xs[i + 1], Math.min(ys[r + 1], hb), zf, c); D(xs[i], Math.min(ys[r + 1], ha), zf, d);
    tri(a, b, c); tri(a, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  addRock(k, g);
}

type Side = 'x0' | 'x1' | 'y1' | 'z0';
/** Push a point out of an axis-aligned box through one side (the same side for a whole rock → no faces across the box). */
function pushOut(v: THREE.Vector3, x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, side: Side, off: number): void {
  if (v.x <= x0 || v.x >= x1 || v.y <= y0 || v.y >= y1 || v.z <= z0 || v.z >= z1) return;
  // `off`: per-rock offset of the cut plane, so two rocks cut by the same side never share a plane
  if (side === 'x0') v.x = x0 - off; else if (side === 'x1') v.x = x1 + off; else if (side === 'y1') v.y = y1 + off; else v.z = z0 - off;
}

/** Entrance plane (world Z) of a lower-street model: mine frame front, board face, barn gate. */
export function lowEntranceZ(b: Building): number {
  const zFront = toZ(b.hit[3]);
  return b.id === 'mine' ? zFront - 0.55 + 0.23 : b.id === 'mineboard' ? zFront - 0.55 + 0.1 : zFront - 0.35 + 0.1;
}

/* ------------------------------------------------------------------ mine portal */

/** Gradient tunnel (unlit 'emit'): floor, walls, ceiling from the mouth (z0) back to z1, dark → black, black back cap. */
function tunnel(k: Ctx, cx: number, base: number, z0: number, z1: number, hw: number, h: number): void {
  const N = 6, pos: number[] = [], col: number[] = [];
  const mouth = new THREE.Color('#7a5c48'), deep = new THREE.Color('#000000'), c = new THREE.Color();
  const shadeAt = (t: number, side: number) => c.copy(mouth).lerp(deep, Math.min(1, Math.pow(t, 0.9) * 1.0)).multiplyScalar(side);
  // quads: [ax, ay, bx, by] cross-section edge (a→b) swept along z; inside faces face the tunnel axis
  const edges: [number, number, number, number, number][] = [
    [cx - hw, base + 0.012, cx + hw, base + 0.012, 0.8],   // floor (1.2 cm above the street: never in its plane)
    [cx + hw, base, cx + hw, base + h, 0.75],             // right wall
    [cx + hw, base + h, cx - hw, base + h, 0.55],         // ceiling
    [cx - hw, base + h, cx - hw, base, 0.75],             // left wall
  ];
  for (const [ax, ay, bx, by, sd] of edges) {
    for (let i = 0; i < N; i++) {
      const ta = i / N, tb = (i + 1) / N, za = z0 + (z1 - z0) * ta, zb = z0 + (z1 - z0) * tb;
      const ca = shadeAt(ta, sd).clone(), cb = shadeAt(tb, sd).clone();
      // two triangles, winding so the normal points inside (towards the axis)
      pos.push(ax, ay, za, bx, by, za, bx, by, zb, ax, ay, za, bx, by, zb, ax, ay, zb);
      for (const cc of [ca, ca, cb, ca, cb, cb]) col.push(cc.r, cc.g, cc.b);
    }
  }
  // back cap (black), facing +z
  pos.push(cx - hw, base, z1, cx + hw, base, z1, cx + hw, base + h, z1, cx - hw, base, z1, cx + hw, base + h, z1, cx - hw, base + h, z1);
  for (let i = 0; i < 6; i++) col.push(0, 0, 0);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  k.b.add('emit', g, new THREE.Matrix4(), null, 1);
  g.dispose();
}

/** Timber set (two battered posts + cap) at depth z, framing an opening of half-width hw and height h. */
function timberSet(k: Ctx, cx: number, base: number, z: number, hw: number, h: number, col: string, t = 0.2, braces = false): void {
  for (const s of [-1, 1]) {
    rbox(k, 'wood', shade(col, s * 0.04), cx + s * (hw + t / 2 - 0.02), base + h / 2, z, t, h, t, 0, 0, -s * 0.035, 0.6);
    if (braces) rbox(k, 'wood', shade(col, -0.1), cx + s * (hw - 0.18), base + h - 0.2, z + 0.012, 0.1, 0.55, 0.12, 0, 0, s * 0.75, 0.6);
  }
  box(k, 'wood', shade(col, 0.06), cx - hw - t - 0.25, cx + hw + t + 0.25, base + h, base + h + 0.26, z - t / 2 - 0.02, z + t / 2 + 0.02, 0.6);
}

/**
 * The adit of the street mine portal (world metres): centre x, half-width, height, frame plane zP, the mouth plane zf
 * (front of the rock shell = tunnel entrance) and the tunnel's back zBack; base = the lower street. Tests check that
 * the tunnel can only be seen through the mouth (test/world-enclosure.test.ts).
 */
export function mineAdit(b: Building, lowH: number): { cx: number; hw: number; th: number; base: number; zP: number; zf: number; zBack: number } {
  const zP = toZ(b.hit[3]) - 0.55, depth = 2.4;
  return { cx: (toX(b.hit[0]) + toX(b.hit[1])) / 2, hw: 0.72, th: 2.05, base: lowH, zP, zf: zP - 0.02, zBack: zP - depth };
}

export function mine(k: Ctx, b: Building, x0: number, x1: number): void {
  const P = k.pal, base = k.lowH, zw = k.wallZ, cx = (x0 + x1) / 2;
  const zFront = toZ(b.hit[3]);              // front of the footprint (the walk grid blocks up to here)
  // adit half-width, height; tunnel mouth / frame plane zP; tunnel back
  const { hw, th, zP, zBack } = mineAdit(b, base);
  // clearance box of the adit (+ frame) that no rock may enter; rocks above the upper street stay out of it
  const rockIdx = new Map<number, number>();
  const bx0 = cx - hw - 0.12, bx1 = cx + hw + 0.12, by1 = base + th + 0.32, bz0 = zBack - 0.05;
  const carve = (v: THREE.Vector3, rx: number, ry: number, rz: number) => {
    const side: Side = rz < bz0 ? 'z0' : ry > by1 - 0.5 && rx > bx0 - 0.3 && rx < bx1 + 0.3 ? 'y1' : rx < cx ? 'x0' : 'x1';
    const key = rx * 1e4 + ry * 100 + rz;
    let n = rockIdx.get(key); if (n === undefined) rockIdx.set(key, (n = rockIdx.size));
    const off = 0.01 * n;
    pushOut(v, bx0, bx1, base - 1, by1, bz0, zP + 0.4, side, off);
    if (v.y > -0.15 && v.z < zw + 0.1) v.z = zw + 0.1;    // never through the upper street / coping
    if (v.y < base - 0.3) v.y = base - 0.3;
    if (v.x < x0 + 0.02 && v.z > zP - 0.9 && v.y < base + 2.15) v.x = x0 + 0.02;   // leave room for the results board on the left
  };
  const R = (x: number, y: number, z: number, rx: number, ry: number, rz: number, detail: 0 | 1 | 2 = 1, rough = 0.2) =>
    rock(k, x, base + y, z, rx, ry, rz, { detail, rough, carve, seed: Math.floor(x * 13 + z * 7 + y * 3) });
  // the mass itself: a closed shell from the ledge to the portal plane, the adit mouth cut out of its front exactly
  // (nothing of the tunnel can be seen except through the mouth); boulders below are dressing on top of it
  const w = x1 - x0, zf = mineAdit(b, base).zf, topY = base + th + 0.36;
  rockShell(k, {
    x0: x0 - 0.05, x1: x1 + 0.45, core: [cx - hw - 0.32, cx + hw + 0.32], zw, zf, ground: base,
    H: (z) => z < zBack - 0.25 ? 0.16 + (topY - 0.16) * Math.pow(Math.max(0, (z - zw) / (zBack - 0.25 - zw)), 0.8) : topY + 0.12 * (z - zBack + 0.25) / (zf - zBack + 0.25),
    notch: [cx - hw, cx + hw, base + th - 0.012], seed: 3.7,
  });
  // the outcrop dressing: side jambs, the lintel crag, a crown, rubble at the foot
  R(x0 + 0.42, 1.05, zP - 0.85, 0.62, 1.2, 1.05, 2, 0.18);          // left jamb
  R(x1 - 0.38, 1.0, zP - 0.8, 0.66, 1.15, 1.05, 2, 0.18);           // right jamb
  R(cx - 0.15, th + 0.62, zP - 0.75, 1.35, 0.58, 0.95, 2, 0.2);     // lintel crag over the cap
  R(cx + 0.55, th + 0.95, zP - 1.65, 0.95, 0.55, 0.9, 1, 0.22);     // crown
  R(x0 + 0.25, 0.32, zP + 0.05, 0.42, 0.4, 0.4, 1, 0.25);           // foot boulders
  R(x1 - 0.18, 0.28, zP + 0.12, 0.46, 0.36, 0.42, 1, 0.25);
  R(x1 + 0.05, 0.55, zP - 1.2, 0.38, 0.7, 0.7, 1, 0.25);            // right flank spills past the footprint
  R(x1 + 0.45, 0.9, zw + 1.0, 0.75, 1.05, 0.75, 2, 0.22);           // the cliff runs on along the wall
  R(x1 + 1.1, 0.45, zw + 0.6, 0.6, 0.7, 0.55, 1, 0.24);
  R(cx - 0.2, 2.05, zw + 0.75, w * 0.45, 0.62, 0.8, 2, 0.2);         // crest over the ledge
  for (const [dx, dz, r] of [[-1.05, 0.62, 0.16], [-0.98, 0.95, 0.1], [1.12, 0.7, 0.14], [1.25, 0.42, 0.1], [0.98, 1.02, 0.08]] as const) {
    R(cx + dx, r * 0.55, zP + dz, r * 1.2, r, r, 0, 0.3);
  }
  // the adit: dark gradient tunnel, timber sets inside, the portal frame with knee braces
  tunnel(k, cx, base, zf, zBack, hw, th - 0.012);   // ceiling 1.2 cm under the cap's underside
  for (const dz of [0.75, 1.5]) timberSet(k, cx, base, zP - dz, hw - 0.17, th - 0.12, shade(P.woodD, -0.25), 0.14);
  timberSet(k, cx, base, zP + 0.1, hw, th, P.woodD, 0.26, true);
  // planks across the cap ends (lagging) peeking out under the lintel crag
  for (let i = 0; i < 5; i++) rbox(k, 'wood', shade(P.woodD, -0.15 + (i % 2) * 0.08), cx - hw + 0.15 + i * (2 * hw - 0.3) / 4, base + th + 0.3, zP - 0.12, 0.2, 0.05, 0.62, 0, 0.04 * (i - 2), 0, 0.6);
  // rails: from the back of the tunnel out past the door, on sleepers
  const zEnd = toZ(b.door.y) + 0.5;
  for (const s of [-0.29, 0.29]) {
    box(k, 'metal', '#8a8a9a', cx + s - 0.03, cx + s + 0.03, base + 0.07, base + 0.115, zBack + 0.05, zEnd);
    box(k, 'metal', '#4a4658', cx + s - 0.045, cx + s + 0.045, base + 0.06, base + 0.07, zBack + 0.05, zEnd + 0.004);
  }
  for (let z = zBack + 0.2; z < zEnd - 0.1; z += 0.42) box(k, 'wood', shade(P.woodD, (Math.sin(z * 7) * 0.08)), cx - 0.45, cx + 0.45, base + 0.004, base + 0.06, z, z + 0.15, 0.5);
  // mine cart at the mouth, loaded with ore (copper, coal, gold, crystal)
  const cz = zP - 1.12, cy = base + 0.14;   // between the inner timber sets: the mouth stays open
  k.b.add('metal', CART_TUB, M(cx, cy + 0.3, cz, 0.86, 0.52, 1.1), '#7a7a8a', 0.5);
  for (const dz of [-0.38, 0.38]) box(k, 'wood', P.woodD, cx - 0.44, cx + 0.44, cy + 0.44, cy + 0.52, cz + dz - 0.045, cz + dz + 0.045, 0.5);
  for (const s of [-1, 1]) for (const dz of [-0.28, 0.28]) {
    k.b.add('metal', GEO.cyl12, M(cx + s * 0.3, base + 0.13, cz + dz, 0.22, 0.05, 0.22, 0, 0, Math.PI / 2), '#2e2a36', 1);
    ball(k, 'metal', '#9a9aa6', cx + s * 0.335, base + 0.13, cz + dz, 0.03);
  }
  const ORE = ['#c8643a', '#24232a', '#ffcf3a', '#eef3fa', '#c8643a', '#24232a'];
  for (let i = 0; i < 7; i++) {
    const a = i * 2.4, rr = 0.1 + (i % 3) * 0.02;
    k.b.add(i === 3 ? 'emit' : 'stone', GEO.sphere, M(cx + Math.cos(a) * 0.18, cy + 0.6 + (i % 2) * 0.05, cz + Math.sin(a) * 0.26, rr * 2, rr * 1.6, rr * 2, a, a * 0.7, 0), i === 3 ? '#9fdcff' : ORE[i % ORE.length], 0.6);
  }
  // lantern on a bracket off the right post (low emissive glass; a small warm pool at the mouth)
  const lx = cx + hw + 0.42, ly = base + 1.82, lz = zP + 0.22;
  box(k, 'metal', P.metal, cx + hw + 0.2, lx + 0.03, ly + 0.2, ly + 0.24, lz - 0.02, lz + 0.02);
  box(k, 'metal', P.metal, lx - 0.008, lx + 0.008, ly + 0.08, ly + 0.2, lz - 0.008, lz + 0.008);
  cone(k, 'metal', P.metal, lx, ly + 0.03, lz, 0.11, 0.08, true);
  box(k, 'emit', '#d8964a', lx - 0.055, lx + 0.055, ly - 0.16, ly + 0.03, lz - 0.055, lz + 0.055);   // ≈ 0.95 linear: just under the bloom knee
  for (const [dx, dz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) box(k, 'metal', P.metal, lx + dx * 0.065 - 0.012, lx + dx * 0.065 + 0.012, ly - 0.17, ly + 0.035, lz + dz * 0.065 - 0.012, lz + dz * 0.065 + 0.012);
  box(k, 'metal', P.metal, lx - 0.08, lx + 0.08, ly - 0.2, ly - 0.17, lz - 0.08, lz + 0.08);
  k.glows.push(lx, ly - 0.06, lz, 0.9, 1, 0.72, 0.38);
  (k.pools ||= []).push(lx, ly - 0.06, lz + 0.2, 3.0, 1, 0.7, 0.4, 1.0);
  k.lights.push(lx, ly - 0.06, lz + 0.3);
  // pickaxe leaning on the left post
  rbox(k, 'wood', P.woodL, cx - hw - 0.42, base + 0.42, zP + 0.32, 0.05, 0.88, 0.05, 0, 0.0, 0.24, 0.5);
  rbox(k, 'metal', '#9a9aa6', cx - hw - 0.32, base + 0.85, zP + 0.345, 0.46, 0.06, 0.08, 0, 0, 0.24 + 0.25, 0.5);
  // «ШАХТА» on the cap beam
  signF(k, b.title, cx, base + th + 0.005, zP + 0.1 + 0.13, 1.25);
  // solids: the whole outcrop is a wall for jumping; the cart can be stood on
  (k.solids ||= []).push(cx - 0.44, cx + 0.44, cz - 0.55, cz + 0.55, cy + 0.56);
  (k.solids ||= []).push(x0 - 0.22, x1 + 0.6, zw, zP - 0.6, Infinity);
  (k.solids ||= []).push(x0 - 0.22, cx - hw - 0.05, zP - 0.6, zFront + 0.05, Infinity);
  (k.solids ||= []).push(cx + hw + 0.05, x1 + 0.6, zP - 0.6, zFront + 0.05, Infinity);
  (k.solids ||= []).push(x1 + 0.6, x1 + 1.75, zw, zw + 1.8, Infinity);   // the cliff along the wall right of the mass
  k.colliders.push(x1 + 0.55, x1 + 1.75, base, base + 2.4, zw, zw + 1.6);
  k.colliders.push(x0 - 0.05, x1 + 0.55, base, topY + 0.45, zw, zFront - 0.2);
}

/* ------------------------------------------------------------------ mine results board */

export function mineboard(k: Ctx, b: Building, x0: number, x1: number): void {
  const P = k.pal, base = k.lowH, cx = (x0 + x1) / 2, z = toZ(b.hit[3]) - 0.55, w = Math.min(0.92, x1 - x0 + 0.06);
  const top = 1.62;
  for (const s of [-1, 1]) box(k, 'wood', P.woodD, cx + s * (w / 2 - 0.07) - 0.05, cx + s * (w / 2 - 0.07) + 0.05, base, base + top + 0.42, z - 0.05, z + 0.05, 0.6);
  // plank board + frame (frame 8 mm proud of the board, notices in front of both)
  box(k, 'wood', P.wood, cx - w / 2 + 0.03, cx + w / 2 - 0.03, base + 0.82, base + top, z + 0.05, z + 0.09, 0.6);
  box(k, 'wood', P.woodD, cx - w / 2, cx + w / 2, base + 0.76, base + 0.84, z + 0.04, z + 0.098, 0.6);
  box(k, 'wood', P.woodD, cx - w / 2, cx + w / 2, base + top - 0.02, base + top + 0.06, z + 0.04, z + 0.098, 0.6);
  const notes = ['#f3efd8', '#fff2b8', '#f3efd8'];
  for (let i = 0; i < 3; i++) {
    const nz = z + 0.104 + i * 0.012;   // each notice 12 mm in front of the previous one; its lines 12 mm in front of it
    rbox(k, 'flat', notes[i], cx - 0.24 + i * 0.24, base + 1.17 + (i % 2) * 0.06, nz, 0.2, 0.28, 0.006, 0, 0, (i - 1) * 0.08);
    ball(k, 'flat', '#d8433a', cx - 0.24 + i * 0.24, base + 1.3 + (i % 2) * 0.06, z + 0.16, 0.018);
    for (let l = 0; l < 3; l++) rbox(k, 'flat', '#8a7a6a', cx - 0.25 + i * 0.24, base + 1.2 + (i % 2) * 0.06 - l * 0.05, nz + 0.012, 0.12, 0.012, 0.004, 0, 0, (i - 1) * 0.08);
  }
  // gold «1st place» medal on the middle notice
  k.b.add('metal', GEO.cyl12, M(cx, base + 0.98, z + 0.16, 0.08, 0.02, 0.08, Math.PI / 2, 0, 0), '#ffcf4a', 1);
  // little shingle roof and the title plaque under it
  gableRoof(k, P.roof, 'wood', P.wood, cx - w / 2 - 0.08, cx + w / 2 + 0.08, z - 0.16, z + 0.2, base + top + 0.42, 0.26, 0.08, true);
  signF(k, b.title, cx, base + top + 0.08, z + 0.098, Math.min(1.0, w + 0.1));
  (k.solids ||= []).push(cx - w / 2, cx + w / 2, z - 0.1, z + 0.15, Infinity);
}

/* ------------------------------------------------------------------ storage barn */

export function storage(k: Ctx, b: Building, x0: number, x1: number): void {
  const P = k.pal, base = k.lowH, zw = k.wallZ, zFront = toZ(b.hit[3]) - 0.35;
  const hx0 = x0 + 0.25, hx1 = x1 - 0.55, cx = (hx0 + hx1) / 2, wallH = 2.5;
  const plank = shade(P.wood, -0.08);
  // plank walls on an ashlar plinth; corner posts; eaves beam
  const gx = toX(b.door.x), gw = 1.5, gh = 1.95;
  box(k, 'wood', plank, hx0, hx1, base + 0.38, base + wallH, zw, zFront, 0.9);
  // plinth course, cut at the gate (the leaves reach the ground)
  box(k, 'stone', shade(P.stone, -0.15), hx0 - 0.06, gx - gw / 2 - 0.12, base - 0.1, base + 0.4, zw, zFront + 0.06, 0.6);
  box(k, 'stone', shade(P.stone, -0.15), gx + gw / 2 + 0.12, hx1 + 0.06, base - 0.1, base + 0.4, zw, zFront + 0.06, 0.6);
  box(k, 'stone', shade(P.stone, -0.15), gx - gw / 2 - 0.12, gx + gw / 2 + 0.12, base - 0.1, base + 0.38, zw, zFront - 0.05, 0.6);
  for (const px of [hx0, hx1]) box(k, 'wood', P.woodD, px - 0.09, px + 0.09, base + 0.4, base + wallH + 0.02, zFront - 0.12, zFront + 0.06, 0.6);
  // vertical battens over the plank joints (front face)
  // windows in the free wall spans either side of the gate (shutters only where they fit)
  const spans = [[hx0 + 0.1, gx - gw / 2 - 0.12], [gx + gw / 2 + 0.12, hx1 - 0.1]].filter(([a, c]) => c - a >= 0.72);
  const open = (x: number) => Math.abs(x - gx) < gw / 2 + 0.2 || spans.some(([a, c]) => Math.abs(x - (a + c) / 2) < 0.48);
  for (let x = hx0 + 0.45; x < hx1 - 0.3; x += 0.45) if (!open(x)) box(k, 'wood', shade(plank, -0.18), x - 0.025, x + 0.025, base + 0.4, base + wallH - 0.14, zFront, zFront + 0.022, 0.6);
  box(k, 'wood', P.woodD, hx0 - 0.1, hx1 + 0.1, base + wallH - 0.14, base + wallH + 0.04, zw + 0.012, zFront + 0.1, 0.6);
  // roof: ridge along X, slopes to the street and to the wall, overhanging eaves
  gableRoof(k, P.roof, 'wood', plank, hx0, hx1, zw + 0.32, zFront, base + wallH + 0.04, 1.35, 0.32);   // back eave meets the wall
  // big double gate at the door: Z-braced leaves, frame, hinges, a cross-bar latch
  box(k, 'flat', '#1b1426', gx - gw / 2, gx + gw / 2, base + 0.4, base + gh, zFront - 0.05, zFront + 0.008);
  for (const s of [-1, 1]) {
    const lx0 = s < 0 ? gx - gw / 2 + 0.02 : gx + 0.012, lx1 = s < 0 ? gx - 0.012 : gx + gw / 2 - 0.02, lc = (lx0 + lx1) / 2, lw = lx1 - lx0;
    box(k, 'wood', '#9a6440', lx0, lx1, base + 0.06, base + gh - 0.02, zFront - 0.02, zFront + 0.04, 0.5);
    for (const yy of [0.25, gh - 0.3]) box(k, 'wood', '#6e4428', lx0 + 0.02, lx1 - 0.02, base + yy, base + yy + 0.12, zFront + 0.04, zFront + 0.066, 0.5);
    rbox(k, 'wood', '#6e4428', lc, base + gh / 2 - 0.02, zFront + 0.046, 0.1, Math.hypot(lw - 0.08, gh - 0.62), 0.024, 0, 0, s * Math.atan2(lw - 0.08, gh - 0.62), 0.5);
    for (const yy of [0.3, gh - 0.25]) box(k, 'metal', P.metal, s < 0 ? lx0 - 0.01 : lx1 - 0.22, s < 0 ? lx0 + 0.22 : lx1 + 0.01, base + yy - 0.02, base + yy + 0.05, zFront + 0.066, zFront + 0.082);
  }
  box(k, 'wood', P.woodD, gx - gw / 2 - 0.12, gx - gw / 2, base + 0.06, base + gh + 0.12, zFront - 0.04, zFront + 0.1, 0.6);
  box(k, 'wood', P.woodD, gx + gw / 2, gx + gw / 2 + 0.12, base + 0.06, base + gh + 0.12, zFront - 0.04, zFront + 0.1, 0.6);
  box(k, 'wood', P.woodD, gx - gw / 2 - 0.16, gx + gw / 2 + 0.16, base + gh, base + gh + 0.14, zFront - 0.04, zFront + 0.11, 0.6);
  box(k, 'metal', '#5a566a', gx - 0.3, gx + 0.3, base + 1.0, base + 1.07, zFront + 0.09, zFront + 0.12);
  box(k, 'stone', shade(P.stone, 0.1), gx - gw / 2 - 0.2, gx + gw / 2 + 0.2, base, base + 0.06, zFront - 0.02, zFront + 0.42, 0.6);
  // windows with shutters either side, sign over the gate, lantern
  spans.forEach(([a, c], i) => (b.soon && i === 0) || windowZ(k, (a + c) / 2, base + 1.05, zFront, 0.5, 0.58, i === 0, { shutters: c - a >= 1.3 ? P.sign : undefined }));
  signF(k, b.title, gx, base + gh + 0.2, zFront + 0.012, 1.3);
  const lx = gx + gw / 2 + 0.38, ly = base + 2.0, lz = zFront;
  box(k, 'metal', P.metal, lx - 0.02, lx + 0.02, ly + 0.08, ly + 0.12, lz, lz + 0.26);
  box(k, 'emit', '#d8964a', lx - 0.05, lx + 0.05, ly - 0.12, ly + 0.06, lz + 0.17, lz + 0.27);
  cone(k, 'metal', P.metal, lx, ly + 0.06, lz + 0.22, 0.1, 0.07, true);
  k.glows.push(lx, ly - 0.03, lz + 0.22, 0.8, 1, 0.72, 0.38);
  (k.pools ||= []).push(lx, ly - 0.03, lz + 0.5, 2.6, 1, 0.7, 0.4, 0.9);
  // hay bale by the left corner (by the right one while the scaffold stands on the left), crates and barrels on the right
  const hb0 = b.soon ? gx + gw / 2 + 0.3 : hx0 - 0.15, hb1 = hb0 + 0.75;
  box(k, 'flat', '#d9b45a', hb0, hb1, base, base + 0.4, zFront + 0.2, zFront + 0.65);
  for (const yy of [0.12, 0.28]) box(k, 'flat', '#b08a3a', hb0 - 0.008, hb1 + 0.008, base + yy, base + yy + 0.025, zFront + 0.192, zFront + 0.658);
  k.inst.add('crate', hx1 + 0.3, base, zFront + 0.25, 0.2, 1);
  k.inst.add('crate', hx1 + 0.32, base + 0.55, zFront + 0.25, -0.1, 0.9);
  k.inst.add('barrel', hx1 + 0.25, base, zFront - 0.45, 0, 1);
  k.inst.add('barrel', hx1 + 0.55, base, zFront - 1.05, 0, 1);
  if (b.soon) {
    // scaffold in the left wall span, clear of the corner post and the gate frame; the «СКОРО» board is nailed onto
    // the closed gate leaves (above the latch) — nothing stands in front of the gate, from any side
    scaffoldLow(k, hx0 + 0.2, Math.max(hx0 + 0.75, gx - gw / 2 - 0.32), zFront, base, 2.3);
    const bw = Math.min(1.0, gw - 0.3);
    signF(k, 'СКОРО', gx, base + 1.16, zFront + 0.03, bw, { bg: '#d9a066', fg: '#6a2a5a' });
    for (const s2 of [-1, 1]) box(k, 'metal', P.metal, gx + s2 * (bw / 2 - 0.06) - 0.018, gx + s2 * (bw / 2 - 0.06) + 0.018, base + 1.3, base + 1.336, zFront + 0.13, zFront + 0.145);
  }
  (k.solids ||= []).push(hx0 - 0.1, hx1 + 0.1, zw, zFront + 0.1, Infinity);
  (k.solids ||= []).push(hb0, hb1, zFront + 0.1, zFront + 0.65, base + 0.4);   // hay bale
  k.colliders.push(hx0, hx1, base, base + wallH + 1.2, zw, zFront);
}

/** Light scaffold for a 'soon' lower-street building beside its gate: poles close to the wall, a plank deck, a rail, a brace. */
function scaffoldLow(k: Ctx, x0: number, x1: number, zf: number, base: number, h: number): void {
  const col = shade(k.pal.woodL, -0.1);
  const n = Math.max(1, Math.round((x1 - x0) / 1.2));
  for (let i = 0; i <= n; i++) { const x = x0 + (x1 - x0) * i / n; box(k, 'wood', col, x - 0.045, x + 0.045, base, base + h, zf + 0.42, zf + 0.51); }
  box(k, 'wood', col, x0 - 0.06, x1 + 0.06, base + 1.3, base + 1.37, zf + 0.16, zf + 0.56, 0.5);
  box(k, 'wood', col, x0, x1, base + 2.0, base + 2.05, zf + 0.48, zf + 0.54);
  rbox(k, 'wood', col, (x0 + x1) / 2, base + 0.68, zf + 0.468, 0.06, Math.hypot(x1 - x0, 1.25), 0.05, 0, 0, Math.atan2(x1 - x0, 1.25), 0.5);
  (k.solids ||= []).push(x0 - 0.1, x1 + 0.1, zf + 0.1, zf + 0.6, Infinity);
}

