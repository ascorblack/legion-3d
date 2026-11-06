/**
 * Asset-faithful models of the new fair's shops (fc-art.js window.LGFairCatsArt): the boudoir tent (tentB), the
 * trainer's pagoda house (trainerB), the four market stalls «Рыбные ряды» (shopB), the auction house (auctionB), the
 * cardboard-box forge «Когтекузня» (forgeB), the sharpening smithy «Заточка» (anvilB) and the notice board (boardB).
 *
 * Every model is drawn in the asset's own px coordinates (fc-art.js draws at absolute map px; the reference vis box of
 * each asset is kept below as VIS0) and carried onto the place it is given:
 *   - x: the site's vis box → toX, scaled when the live vis box is wider / narrower than the reference;
 *   - height: VS m per drawing px above the asset's base line (the same 0.01 m/px as x, times 1.35: the site draws its
 *     buildings stocky next to its 0.62-scaled characters); where a doorway / wall would be lower than a character
 *     (trainer, auction) only the wall band is stretched (hy() of the model), the roof keeps the drawing's proportions;
 *   - depth: the site's walk footprint (foot[1] → foot[3]); the front stands on foot[3].
 * No solids (the site's obstacle list is the walk truth, faircats.ts fairCatsSolids); one camera collider per model.
 * The door hit box: fcShopXf(b, p) (BUILDING_XF → the model's entrance plane, foot[3]).
 * Draw calls: every model uses ≤ 6 batch materials (see MATS); q0 drops the small props (goods, cats, notes, tools).
 */
import * as THREE from 'three';
import type { Building } from '../../contracts';
import type { Ctx } from '../kit';
import { box, rbox, shade, markDoor } from '../kit';
import { GEO, M, type BatchKey } from '../batch';
import { toX, toZ } from '../coords';
import { BUILDING_XF } from '../buildings';
import { registerFcModel, type FcPlace } from './registry';

type P2 = [number, number];
type V4 = readonly [number, number, number, number];
/** metres per drawing px, vertical */
const VS = 0.0135;
/** fc-art.js / tk-art.js palette (P, INK, FUR, ROOF) — the colours the models are made of */
const INK = '#2b1d18';
const P = {
  wood: '#a8754f', woodD: '#6e4a2f', woodL: '#c8956a', card: '#d9a066', cardD: '#a8743f', cardL: '#ecc08a', cream: '#fff1d6',
  pink: '#ff8fa3', gold: '#ffcf4a', glass: '#ffd76a', metal: '#3a2e4a', plumD: '#5a3458', brick: '#b4584a', brickD: '#80392e', rockL: '#cdb7a8',
};
const FUR = ['#f2a65a', '#e8914a', '#f3d9b1', '#9aa3ad', '#7d8a99', '#f4f1ec', '#4a4350', '#a8754f', '#ffc6a0', '#c9ccd3'];
const TEAL = ['#3f8f8a', '#2a6662', '#62b0a8'], MUSTARD = ['#f0b840', '#a0741e', '#f0c464'], RED = ['#c8664a', '#8f3f2c', '#e08a68'];
/** Batch materials each model uses (= its draw calls inside one x-chunk). */
export const SHOP_MATS: Record<string, BatchKey[]> = {
  tent: ['flat', 'emit', 'sign', 'wood'],
  trainer: ['wood', 'flat', 'emit', 'sign'],
  shop: ['canvas', 'wood', 'flat', 'sign'],
  auction: ['plaster', 'wood', 'flat', 'emit', 'sign'],
  forge: ['plaster', 'wood', 'flat', 'emit', 'sign', 'brick'],
  anvil: ['wood', 'flat', 'emit', 'brick', 'sign'],
  board: ['wood', 'flat', 'roof', 'sign'],
};
/** The reference vis boxes (fc-map.js 06.11) the asset coordinates belong to. */
const VIS0: Record<string, V4> = {
  tent: [500, 1330, 1100, 1640], trainer: [600, 950, 1040, 1180], shop: [1470, 1360, 2250, 1640], auction: [1480, 1880, 2120, 2150],
  forge: [3610, 1300, 4250, 1640], anvil: [4300, 1400, 4590, 1640], board: [3236, 1540, 3416, 1700],
};

/* ------------------------------------------------------------------ helpers */
interface Fit { s: number; X: (px: number) => number; W: (px: number) => number; zf: number; zb: number; y0: number; det: boolean }
function fit(k: Ctx, p: FcPlace, ref: string): Fit {
  const v0 = VIS0[ref], s = (p.vis[2] - p.vis[0]) / (v0[2] - v0[0]);
  return { s, X: (px) => toX(p.vis[0] + (px - v0[0]) * s), W: (px) => px * 0.01 * s, zf: toZ(p.foot[3]), zb: toZ(p.foot[1]), y0: p.base, det: k.quality >= 1 };
}
const signOf = (p: FcPlace, def: string) => String((p.data?.sign as string | undefined) || def);

/** A polygon (x, y in metres in the XY plane) extruded along +z by `depth`, placed with matrix m. */
function extM(k: Ctx, mat: BatchKey, col: string, pts: P2[], depth: number, m: THREE.Matrix4, holes: P2[][] = [], uv = 1): void {
  const sh = new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y)));
  for (const h of holes) sh.holes.push(new THREE.Path(h.map(([x, y]) => new THREE.Vector2(x, y))));
  const g = new THREE.ExtrudeGeometry(sh, { depth, bevelEnabled: false, curveSegments: 4 });
  k.b.add(mat, g, m, col, uv); g.dispose();
}
/** World-space polygon (x, y) extruded between z0 and z1. */
const ext = (k: Ctx, mat: BatchKey, col: string, pts: P2[], z0: number, z1: number, holes: P2[][] = [], uv = 1) => extM(k, mat, col, pts, z1 - z0, M(0, 0, z0), holes, uv);
/** Arch outline: straight sides from yb to ys, an elliptic top up to yt. */
function archPts(x0: number, x1: number, yb: number, ys: number, yt: number, n = 8): P2[] {
  const cx = (x0 + x1) / 2, rx = (x1 - x0) / 2, out: P2[] = [[x0, yb], [x1, yb]];
  for (let i = 0; i <= n; i++) { const a = Math.PI * i / n; out.push([cx + Math.cos(a) * rx, ys + Math.sin(a) * (yt - ys)]); }
  return out;
}
const ICO = new THREE.IcosahedronGeometry(0.5, 1), ICO0 = new THREE.IcosahedronGeometry(0.5, 0);
const BEADS = ['#ffd76a', '#ff8fa3', '#7fd6e6', '#b9a2ff', '#9fe39a'];
/** One triangle (world points; 'flat' is double-sided). */
function tri(k: Ctx, mat: BatchKey, col: string, a: number[], b: number[], c: number[]): void {
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute([...a, ...b, ...c], 3)); g.computeVertexNormals();
  k.b.add(mat, g, M(0, 0, 0), col, 1); g.dispose();
}
/** Ellipsoid lump (80 tris). */
const lump = (k: Ctx, mat: BatchKey, col: string, x: number, y: number, z: number, rx: number, ry: number, rz: number, ry0 = 0) => k.b.add(mat, ICO, M(x, y, z, rx * 2, ry * 2, rz * 2, 0, ry0, 0), col, 1);
/** Elliptic disc / tube facing +z (axis along z), centre (x, y, z). */
const disc = (k: Ctx, mat: BatchKey, col: string, x: number, y: number, z: number, rx: number, ry: number, depth: number, seg: 8 | 16 = 16) => k.b.add(mat, seg === 8 ? GEO.cyl8 : GEO.cyl16, M(x, y, z, rx * 2, depth, ry * 2, Math.PI / 2, 0, 0), col, 1);
const cylY = (k: Ctx, mat: BatchKey, col: string, x: number, y0: number, z: number, r: number, h: number, seg: 8 | 16 = 8) => k.b.add(mat, seg === 8 ? GEO.cyl8 : GEO.cyl16, M(x, y0 + h / 2, z, r * 2, h, r * 2), col, 1);
const cylX = (k: Ctx, mat: BatchKey, col: string, x0: number, x1: number, y: number, z: number, r: number) => k.b.add(mat, GEO.cyl8, M((x0 + x1) / 2, y, z, r * 2, x1 - x0, r * 2, 0, 0, Math.PI / 2), col, 1);

/** A seated cartoon cat (tk-art.js kitty): body, head, two ears; h = height (m). */
function kitty(k: Ctx, x: number, y: number, z: number, h: number, fur: string): void {
  lump(k, 'flat', fur, x, y + h * 0.3, z, h * 0.3, h * 0.32, h * 0.26);
  lump(k, 'flat', fur, x, y + h * 0.74, z + h * 0.04, h * 0.25, h * 0.21, h * 0.21);
  for (const s of [-1, 1]) k.b.add('flat', GEO.cone4, M(x + s * h * 0.14, y + h * 0.95, z + h * 0.04, h * 0.14, h * 0.18, h * 0.08, 0, 0, -s * 0.25), fur, 1);
  for (const s of [-1, 1]) lump(k, 'flat', INK, x + s * h * 0.08, y + h * 0.77, z + h * 0.24, h * 0.025, h * 0.035, h * 0.02);
}

/**
 * The site's board() plaque (tk-art.js): atlas text on a dark plate, cat ears on top. Centre (x, y, z), width w;
 * lean = tilt back (rad, top towards −z). Returns the plaque height.
 */
function plaque(k: Ctx, text: string, x: number, y: number, z: number, w: number, o: { bg?: string; fg?: string; ears?: boolean; lean?: number } = {}): number {
  const s = k.signs.add(text, { bg: o.bg ?? P.plumD, fg: o.fg ?? P.gold });
  const h = w / s.aspect, a = o.lean ?? 0, ny = Math.sin(a), nz = Math.cos(a);
  const g = new THREE.PlaneGeometry(1, 1), uv = g.attributes.uv as THREE.BufferAttribute;
  const [u0, v0, u1, v1] = s.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) ? u1 : u0, uv.getY(i) ? v1 : v0);
  k.b.add('sign', g, M(x, y + ny * 0.012, z + nz * 0.012, w, h, 1, -a, 0, 0), '#ffffff', 'keep'); g.dispose();
  rbox(k, 'wood', INK, x - 0, y - ny * 0.02, z - nz * 0.02, w + 0.05, h + 0.05, 0.05, 0, -a, 0, 0.5);
  if (o.ears !== false) {
    const bg = o.bg ?? P.plumD, eh = Math.min(0.3, w * 0.14), up = (h / 2) * Math.cos(a), back = -(h / 2) * Math.sin(a);
    for (const sg of [-1, 1]) {
      const e0 = sg * (w / 2 - w * 0.03), e1 = sg * (w / 2 - w * 0.2), et = sg * (w / 2 - w * 0.07);
      const bx = y + up - 0.02 * Math.cos(a), bz = z + back + 0.02 * Math.sin(a);   // ear base: 2 cm below the plate's top edge
      extM(k, 'flat', bg, [[e0, 0], [et, eh], [e1, 0]], 0.038, M(x, bx - 0.04 * ny, bz - 0.04 * nz, 1, 1, 1, -a, 0, 0));
      extM(k, 'flat', P.pink, [[e0 * 0.85 + e1 * 0.15, 0.025], [et, eh * 0.65], [e0 * 0.3 + e1 * 0.7, 0.025]], 0.004, M(x, bx + 0.011 * ny, bz + 0.011 * nz, 1, 1, 1, -a, 0, 0));
    }
  }
  return h;
}

/**
 * Lofted roof between an eave rectangle [x0,x1]×[z0,z1] at yE and a top rectangle [tx0,tx1]×[tz0,tz1] at yT (a ridge
 * when tz0 = tz1: a hip roof), with concave slopes (sag, m) and upswept corners (lift, m) for the pagoda look.
 */
function loftRoof(k: Ctx, mat: BatchKey, col: string, x0: number, x1: number, z0: number, z1: number, yE: number, tx0: number, tx1: number, tz0: number, tz1: number, yT: number, o: { sag?: number; lift?: number; uv?: number } = {}): void {
  const loop: [number, number, number, number][] = [];   // x, z, u (0..1 along x), v (0..1 along z)
  const nx = 10, nz = 6;
  for (let i = 0; i < nx; i++) loop.push([x0 + (x1 - x0) * i / nx, z1, i / nx, 1]);
  for (let i = 0; i < nz; i++) loop.push([x1, z1 - (z1 - z0) * i / nz, 1, 1 - i / nz]);
  for (let i = 0; i < nx; i++) loop.push([x1 - (x1 - x0) * i / nx, z0, 1 - i / nx, 0]);
  for (let i = 0; i < nz; i++) loop.push([x0, z0 + (z1 - z0) * i / nz, 0, i / nz]);
  const lift = o.lift ?? 0, sag = o.sag ?? 0;
  const E = loop.map(([x, z, u, v]) => { const f = Math.max(Math.abs(2 * u - 1), Math.abs(2 * v - 1)) ** 6; return new THREE.Vector3(x, yE + lift * f, z); });
  const T = loop.map(([, , u, v]) => new THREE.Vector3(tx0 + (tx1 - tx0) * u, yT, tz0 + (tz1 - tz0) * v));
  const Mid = E.map((e, i) => e.clone().lerp(T[i], 0.5).add(new THREE.Vector3(0, -sag, 0)));
  const pos: number[] = [];
  const quad = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3) => { pos.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z, a.x, a.y, a.z, c.x, c.y, c.z, d.x, d.y, d.z); };
  for (let i = 0; i < loop.length; i++) {
    const j = (i + 1) % loop.length;
    quad(E[i], E[j], Mid[j], Mid[i]); quad(Mid[i], Mid[j], T[j], T[i]);
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.computeVertexNormals();
  k.b.add(mat, g, M(0, 0, 0), col, o.uv ?? 1.2); g.dispose();
  if (tz1 - tz0 > 0.01) box(k, mat, col, tx0, tx1, yT - 0.02, yT, tz0, tz1, o.uv ?? 1.2);
}

/** BUILDING_XF for a building drawn by one of these models: the door hit box stands on the model's front (foot[3]). */
export function fcShopXf(b: Building, p: FcPlace): void {
  const z = toZ(p.foot[3]) - 0.03;
  BUILDING_XF.set(b, { virt: { ...b }, z: () => z, s: 1 });
}

/* ------------------------------------------------------------------ tent «Будуар котофея» (tentB) */
function tent(k: Ctx, p: FcPlace): void {
  const F = fit(k, p, 'tent'), s = F.s, y0 = F.y0, VY = VS * s;
  const cx = F.X(800), R = F.W(282), Ht = 234 * VY, C1 = '#c06aa8', C2 = '#ffe0ec';
  const rz = Math.min(2.3, (F.zf - F.zb) / 2 - 0.05), zc = F.zf - rz - 0.05, ez = rz / R;
  // dome profile: the asset's cubic (R,0) (R+8,150) (160,234) (0,234), in (r, h)
  const prof: THREE.Vector2[] = [];
  for (let i = 0; i <= 10; i++) {
    const t = i / 10, a = (1 - t) ** 3, b = 3 * (1 - t) ** 2 * t, c = 3 * (1 - t) * t * t, d = t ** 3;
    prof.push(new THREE.Vector2(Math.max(0.001, (a * 282 + b * 290 + c * 160) * 0.01 * s), (b * 150 + c * 234 + d * 234) * VY));
  }
  const rAt = (h: number) => { for (let i = 0; i + 1 < prof.length; i++) { const p0 = prof[i], p1 = prof[i + 1]; if (h <= p1.y) return p0.x + (p1.x - p0.x) * (h - p0.y) / Math.max(1e-6, p1.y - p0.y); } return 0; };
  // 28 radial stripes (14 across the front, as drawn), pink / white
  const N = 28;
  for (let i = 0; i < N; i++) {
    const g = new THREE.LatheGeometry(prof, 2, (i - 0.5) * 2 * Math.PI / N, 2 * Math.PI / N);
    k.b.add('flat', g, M(cx, y0, zc, 1, 1, ez), i % 2 ? C2 : C1, 1); g.dispose();
  }
  // the pink ruffle round the base
  { const g = new THREE.LatheGeometry([[R + 0.14, -0.02], [R + 0.2, 0.16], [R + 0.12, 0.36], [R - 0.02, 0.4]].map(([a, b]) => new THREE.Vector2(a, b)), 28);
    k.b.add('flat', g, M(cx, y0, zc, 1, 1, (rz + 0.06) / R), '#ffd0e0', 1); g.dispose(); }
  // cat ears on the shoulders (outer purple, inner pink) and the gold knob on top
  for (const sg of [-1, 1]) {
    const pt = (dx: number, dy: number): P2 => [cx + sg * dx * 0.01 * s, y0 + (234 - dy) * VY];
    ext(k, 'flat', C1, sg > 0 ? [pt(190, 74), pt(214, -30), pt(116, 20)] : [pt(190, 74), pt(116, 20), pt(214, -30)], zc + 0.45, zc + 0.75);
    ext(k, 'flat', P.pink, sg > 0 ? [pt(182, 56), pt(196, -6), pt(138, 26)] : [pt(182, 56), pt(138, 26), pt(196, -6)], zc + 0.756, zc + 0.766);
  }
  lump(k, 'emit', P.gold, cx, y0 + Ht + 0.24, zc, 0.3, 0.32, 0.3);
  k.glows.push(cx, y0 + Ht + 0.24, zc, 1.2, 1, 0.85, 0.4);
  // the bead string over the front (garland wires: the town's bulbs ride on them)
  { let prev: number[] | null = null;
    for (let i = 0; i <= 12; i++) {
      const t = i / 12, ph = (t - 0.5) * 2.1, h = (146 + Math.sin(Math.PI * t) * 110) * VY, r = rAt(Math.min(h, Ht - 0.05)) + 0.06;
      const pnt = [cx + Math.sin(ph) * r, y0 + h, zc + Math.cos(ph) * r * ez + 0.05];
      if (prev) k.wires.push(prev[0], prev[1], prev[2], pnt[0], pnt[1], pnt[2]);
      if (F.det) k.b.add('emit', ICO0, M(pnt[0], pnt[1] - 0.04, pnt[2] + 0.03, 0.15, 0.15, 0.15), BEADS[i % 5], 1);
      prev = pnt;
    } }
  // the round entrance: pink hood ring, plum frame, lit boudoir with the dandy's cloak and a mirror, the red rug
  const zF = F.zf, ey = y0 + 108 * VY, yI = ey + 14 * VY;
  disc(k, 'flat', '#ffd0e0', cx, ey, zF - 0.5, F.W(95), 99 * VY, 1.0);
  disc(k, 'flat', '#9a5a84', cx, ey, zF + 0.02, F.W(78), 82 * VY, 0.04);
  markDoor(k, 'arch', cx - F.W(78) - 0.01, cx + F.W(78) + 0.01, ey - 82 * VY - 0.01, ey + 82 * VY + 0.01, zF - 0.005, zF + 0.13);   // the round entrance: plum frame, the lit boudoir
  disc(k, 'emit', '#ffd49a', cx, yI, zF + 0.045, F.W(60), 62 * VY, 0.02);
  { // the boudoir behind: pink drapes at the sides, the red carpet band below (inside the opening's ellipse)
    const rx = F.W(60), ry = 62 * VY, seg = (y0c: number): P2[] => { const a0 = Math.asin(Math.max(-1, Math.min(1, (y0c - yI) / ry))), out: P2[] = []; for (let q = 0; q <= 10; q++) { const a = Math.PI + a0 + (-Math.PI - 2 * a0) * q / 10; out.push([cx + Math.cos(a) * rx, yI + Math.sin(a) * ry]); } return out; };
    ext(k, 'flat', '#c0506a', seg(yI - ry * 0.45), zF + 0.064, zF + 0.068);
    for (const sg of [-1, 1]) ext(k, 'flat', '#e8a0c0', [[cx + sg * rx * 0.62, yI - ry * 0.45], [cx + sg * rx * 0.95, yI - ry * 0.3], [cx + sg * rx * 0.9, yI + ry * 0.4], [cx + sg * rx * 0.62, yI + ry * 0.75]], zF + 0.074, zF + 0.078);
  }
  if (F.det) {
    k.b.add('flat', GEO.cone16, M(cx, yI - 0.2, zF + 0.2, 0.5, 0.62, 0.36), '#a3122a', 1);
    lump(k, 'flat', '#e8d9b8', cx, yI + 0.22, zF + 0.2, 0.12, 0.13, 0.12);
    cylY(k, 'flat', INK, cx, yI + 0.32, zF + 0.2, 0.16, 0.03); cylY(k, 'flat', INK, cx, yI + 0.34, zF + 0.2, 0.1, 0.22);
    box(k, 'wood', P.wood, cx + F.W(30), cx + F.W(54), yI - 0.36, yI + 0.36, zF + 0.085, zF + 0.115);
    disc(k, 'flat', '#bfe6ff', cx + F.W(42), yI + 0.0, zF + 0.123, F.W(8), 0.2, 0.004, 8);
  }
  box(k, 'flat', '#a3122a', cx - F.W(96), cx + F.W(96), y0 + 0.006, y0 + 0.03, zF + 0.25, zF + 0.85);
  for (const dx of [-50, 0, 50]) disc(k, 'flat', P.gold, cx + F.W(dx), y0 + 0.04, zF + 0.55, 0.09, 0.09, 0.01, 8);
  k.glows.push(cx, yI, zF + 0.3, 2.2, 1, 0.8, 0.55); k.lights.push(cx, yI, zF + 0.7);
  // the easel board «БУДУАР / КОТОФЕЯ» (front right)
  const sx = F.X(1030), sz = F.zf + 0.1, bh = 76 * VY, by = y0 + 0.62 + bh / 2, bw = F.W(148);
  for (const [dx, dz] of [[-0.42, 0.05], [0.42, 0.05], [0, -0.35]]) {
    const top: [number, number, number] = [sx + dx * 0.4, by + bh / 2 - 0.05, sz - 0.04], bot: [number, number, number] = [sx + dx, y0, sz + dz];
    const len = Math.hypot(top[0] - bot[0], top[1] - bot[1], top[2] - bot[2]);
    rbox(k, 'wood', P.woodD, (top[0] + bot[0]) / 2, (top[1] + bot[1]) / 2, (top[2] + bot[2]) / 2, 0.06, len, 0.06, 0, Math.atan2(top[2] - bot[2], top[1] - bot[1]), -Math.atan2(top[0] - bot[0], top[1] - bot[1]), 0.5);
  }
  box(k, 'flat', '#5a2a5a', sx - bw / 2, sx + bw / 2, by - bh / 2, by + bh / 2, sz - 0.05, sz);
  const words = signOf(p, 'БУДУАР КОТОФЕЯ').split(/\s+/), l1 = words[0], l2 = words.slice(1).join(' ');
  if (l2) { plaque(k, l1, sx, by + bh * 0.22, sz + 0.03, bw * 0.86, { bg: '#5a2a5a', ears: false }); plaque(k, l2, sx, by - bh * 0.24, sz + 0.03, bw * 0.86, { bg: '#5a2a5a', ears: false }); }
  else plaque(k, l1, sx, by, sz + 0.03, bw * 0.9, { bg: '#5a2a5a', ears: false });
  k.colliders.push(cx - R, cx + R, y0, y0 + Ht + 0.5, zc - rz, zc + rz);
}

/* ------------------------------------------------------------------ trainer (trainerB) */
function trainer(k: Ctx, p: FcPlace): void {
  const F = fit(k, p, 'trainer'), s = F.s, y0 = F.y0, X = F.X;
  const L = 620, R = 1020, B = 1180, wt = 1090, ft = 1166, cx = 820, oL = 700, oR = 940;
  // the wall band is stretched to a doorway a character fits (76 px → 1.6 m); plinth and roof keep the drawing's scale
  const hy = (y: number) => y0 + s * (y >= ft ? (B - y) * 0.0143 : y >= wt ? 0.2 + (ft - y) * (1.6 / 76) : 1.8 + (wt - y) * VS);
  const zf = F.zf, zb = F.zb, zw = zf - 0.3, rec = 0.75;
  const WALL = '#b4584a';
  // platform + step
  box(k, 'wood', P.wood, X(L - 6), X(R + 6), y0 - 0.05, hy(ft), zb + 0.25, zw + 0.1, 0.6);
  box(k, 'wood', P.woodL, X(cx - 35), X(cx + 35), y0 - 0.05, y0 + 0.1, zw + 0.1, zw + 0.42, 0.6);
  // body: back block, the two side panels of the open front, the recess (cream back wall, straw floor)
  box(k, 'wood', WALL, X(L), X(R), hy(ft), hy(wt), zb + 0.35, zw - rec, 1);
  for (const [a, b] of [[L, oL], [oR, R]]) {
    box(k, 'wood', WALL, X(a), X(b), hy(ft), hy(wt), zw - rec, zw, 1);
    if (F.det) for (let x = a + 30; x < b - 4; x += 30) box(k, 'flat', shade(WALL, -0.3), X(x) - 0.012, X(x) + 0.012, hy(ft) + 0.04, hy(wt) - 0.04, zw + 0.006, zw + 0.012);
  }
  box(k, 'flat', '#e8cfa4', X(oL) + 0.006, X(oR) - 0.006, hy(ft) + 0.006, hy(wt) - 0.03, zw - rec - 0.02, zw - rec + 0.01);
  box(k, 'flat', '#d9c27a', X(oL) + 0.006, X(oR) - 0.006, hy(ft) + 0.006, hy(ft) + 0.02, zw - rec + 0.016, zw - 0.006);
  box(k, 'flat', shade('#e8cfa4', -0.25), X(oL) + 0.006, X(oR) - 0.006, hy(wt) - 0.026, hy(wt) - 0.006, zw - rec + 0.016, zw - 0.006);   // the recess ceiling
  // shoji screens at both ends of the opening
  for (const x of [oL - 2, oR - 40]) {
    const xa = X(x), xb = X(x + 42), ya = hy(ft), yb = hy(wt + 6);
    box(k, 'wood', P.woodD, xa, xb, ya, yb, zw - 0.04, zw + 0.03, 0.5);
    box(k, 'flat', P.cream, xa + 0.05, xb - 0.05, ya + 0.05, yb - 0.05, zw + 0.036, zw + 0.04);
    for (const f of [0.3, 0.6]) box(k, 'wood', P.woodD, xa + 0.05, xb - 0.05, ya + (yb - ya) * f, ya + (yb - ya) * f + 0.03, zw + 0.046, zw + 0.056, 0.5);
    box(k, 'wood', P.woodD, (xa + xb) / 2 - 0.015, (xa + xb) / 2 + 0.015, ya + 0.05, yb - 0.05, zw + 0.046, zw + 0.064, 0.5);
  }
  markDoor(k, 'arch', X(oL - 2) - 0.005, X(oR + 2) + 0.005, hy(ft) - 0.005, hy(wt + 6) + 0.005, zw - 0.045, zw + 0.07);   // the open front between its shoji screens
  // lit windows on the side panels
  for (const x of [650, 970]) {
    const xa = X(x), xb = X(x + 40), ya = hy(1148), yb = ya + 0.45;
    box(k, 'wood', P.woodD, xa - 0.05, xb + 0.05, ya - 0.05, yb + 0.05, zw, zw + 0.03, 0.5);
    box(k, 'emit', P.glass, xa, xb, ya, yb, zw + 0.036, zw + 0.04);
    box(k, 'wood', P.woodD, (xa + xb) / 2 - 0.015, (xa + xb) / 2 + 0.015, ya, yb, zw + 0.046, zw + 0.06, 0.5);
    k.glows.push((xa + xb) / 2, (ya + yb) / 2, zw + 0.2, 0.9, 1, 0.8, 0.45);
  }
  // inside: the scroll with the red paw, a weapon rack, a mouse dummy and a yarn ball
  const zr = zw - rec + 0.02;
  box(k, 'flat', P.cream, X(cx - 22), X(cx + 22), hy(1134), hy(1100), zr, zr + 0.02);
  for (const y of [1100, 1134]) cylX(k, 'wood', P.woodD, X(cx - 26), X(cx + 26), hy(y), zr + 0.03, 0.025);
  disc(k, 'flat', '#c94a3a', X(cx), (hy(1134) + hy(1100)) / 2, zr + 0.03, 0.07, 0.07, 0.006, 8);
  if (F.det) {
    for (const dx of [56, 66, 76]) box(k, 'wood', P.woodD, X(oL + dx) - 0.015, X(oL + dx) + 0.015, hy(ft), hy(1102), zr + 0.05, zr + 0.08, 0.5);
    box(k, 'wood', P.woodD, X(oL + 50), X(oL + 84), hy(1124), hy(1124) + 0.04, zr + 0.08, zr + 0.11, 0.5);
    lump(k, 'flat', '#9aa3ad', X(oR - 66), hy(ft) + 0.22, zw - 0.4, 0.12, 0.2, 0.1);
    lump(k, 'flat', '#9aa3ad', X(oR - 66), hy(ft) + 0.5, zw - 0.38, 0.1, 0.09, 0.09);
    lump(k, 'flat', P.pink, X(cx + 40), hy(ft) + 0.1, zw - 0.3, 0.1, 0.1, 0.1);
  }
  // rope-wrapped pillars
  for (const x of [712, 916]) {
    cylY(k, 'wood', '#d8b98a', X(x), hy(ft), zw + 0.12, 0.12 * s, hy(wt) - hy(ft) + 0.25, 8);
    if (F.det) for (let i = 1; i < 6; i++) cylY(k, 'flat', '#a07a4a', X(x), hy(ft) + i * (hy(wt) - hy(ft)) / 6, zw + 0.12, 0.128 * s, 0.035, 8);
  }
  // the pagoda roof: a skirt with upswept corners and concave slopes up to the beam (992), the dark eave band, the top
  // tier, the beam, gold fish at the corners
  const yE = hy(wt) - 0.02, yB = hy(992), zE0 = zb + 0.05, zE1 = zf + 0.4, zm = (zE0 + zE1) / 2;
  loftRoof(k, 'flat', TEAL[0], X(L - 50), X(R + 50), zE0, zE1, yE, X(L + 30), X(R - 30), zm - 0.55, zm + 0.55, yB, { sag: 0.18, lift: 0.28 });
  box(k, 'flat', TEAL[1], X(L - 40), X(R + 40), yE - 0.14, yE + 0.01, zE0 + 0.08, zE1 - 0.08);
  loftRoof(k, 'flat', shade(TEAL[0], 0.08), X(L + 34), X(R - 34), zm - 0.6, zm + 0.6, yB - 0.02, X(L + 110), X(R - 110), zm, zm, hy(952), { sag: 0.05, lift: 0.08 });
  cylX(k, 'flat', TEAL[1], X(L + 31), X(R - 31), yB, zm + 0.58, 0.07 * s);
  cylX(k, 'flat', TEAL[1], X(L + 106), X(R - 106), hy(952) + 0.02, zm, 0.06 * s);
  for (const sg of [-1, 1]) {
    const fx = sg < 0 ? X(L + 34) : X(R - 34), fish: P2[] = [[-0.26, 0], [-0.12, 0.12], [0.1, 0.1], [0.2, 0], [0.34, 0.12], [0.31, 0], [0.34, -0.12], [0.2, 0], [0.1, -0.1], [-0.12, -0.12]];
    extM(k, 'flat', P.gold, fish.map(([a, b]) => [a * sg * s, b * s]) as P2[], 0.08, M(fx, yB + 0.16, zm + 0.5, 1, 1, 1, 0, 0, sg * -0.5));
  }
  // the sign on the roof's front slope, lanterns under the eaves
  plaque(k, signOf(p, 'ТРЕНЕР'), X(cx), yE + 0.32, zE1 + 0.06, F.W(150) * 1.15, { lean: 0.45 });
  for (const x of [L + 6, R - 6]) {
    box(k, 'wood', P.woodD, X(x) - 0.015, X(x) + 0.015, yE - 0.3, yE - 0.1, zf + 0.15, zf + 0.18, 0.5);
    box(k, 'emit', '#ffcf6a', X(x) - 0.09, X(x) + 0.09, yE - 0.55, yE - 0.3, zf + 0.08, zf + 0.25);
    k.glows.push(X(x), yE - 0.42, zf + 0.17, 1.2, 1, 0.78, 0.4);
  }
  k.lights.push(X(cx), hy(1110), zw);
  k.colliders.push(X(L - 50), X(R + 50), y0, hy(952) + 0.2, zb, zf + 0.4);
}

/* ------------------------------------------------------------------ «Рыбные ряды»: four stalls (shopB) */
function shop(k: Ctx, p: FcPlace): void {
  const F = fit(k, p, 'shop'), y0 = F.y0, X = F.X, s = F.s, B = 1640, w = 180, ct = B - 64;
  const hy = (y: number) => y0 + (B - y) * VS * s;
  const zf = F.zf, zS = zf - 2.5, zc = zf - 0.45;   // stall back wall, counter front
  const ST: { c1: string; fur: string; label: string }[] = [
    { c1: '#9a5ad6', fur: FUR[3], label: 'ВАЛЕРЬЯНКА' }, { c1: '#3a8fd0', fur: FUR[0], label: 'РЫБА' },
    { c1: '#d04a4a', fur: FUR[1], label: 'КОЛБАСА' }, { c1: '#e8a23a', fur: FUR[5], label: 'МОЛОКО' },
  ];
  // one shared plank floor / back
  box(k, 'wood', P.woodD, X(1484) + 0.012, X(2236) - 0.012, y0 - 0.05, y0 + 0.045, zS - 0.1, zf - 0.03, 0.6);
  [1484, 1676, 1868, 2060].forEach((x, i) => {
    const t = ST[i], xa = X(x), xb = X(x + w), xm = (xa + xb) / 2;
    // the booth: dark back wall with warm light, inner side walls, shelves
    box(k, 'flat', '#7a4e3e', X(x + 6), X(x + w - 6), y0, hy(1460), zS - 0.08, zS);
    box(k, 'flat', '#4a2e28', X(x + 6), X(x + 6) + 0.08, y0, hy(1460), zS, zc - 0.05);
    box(k, 'flat', '#3e2622', X(x + w - 6) - 0.08, X(x + w - 6), y0, hy(1460), zS, zc - 0.05);
    box(k, 'flat', shade('#7a4e3e', -0.3), X(x + 6), X(x + w - 6), hy(1460), hy(1460) + 0.05, zS, zc - 0.05);
    for (const [a, b] of [[x + 16, x + 66], [x + w - 66, x + w - 16]]) box(k, 'wood', P.woodL, X(a), X(b), hy(1530) - 0.03, hy(1530) + 0.02, zS, zS + 0.16, 0.5);
    k.glows.push(xm, hy(1500), zS + 0.4, 1.6, 1, 0.72, 0.4);
    // corner posts
    for (const px of [x + 4, x + w - 16]) box(k, 'wood', P.wood, X(px), X(px + 12), y0, hy(1470), zc - 0.12, zc, 0.6);
    // counter: card-coloured planks, a light band, the overhanging top and its dark lip
    box(k, 'wood', P.card, xa, xb, y0, hy(ct), zc, zf - 0.05, 0.6);
    box(k, 'flat', '#e8c088', xa + 0.006, xb - 0.006, hy(ct + 38), hy(ct + 24), zf - 0.044, zf - 0.038);
    disc(k, 'flat', '#3a2a1a', xm, hy(ct + 48), zf - 0.029, 0.12, 0.1, 0.006, 8);
    box(k, 'wood', P.woodL, X(x - 6), X(x + w + 6), hy(ct), hy(ct - 9), zc - 0.15, zf + 0.06, 0.6);
    box(k, 'wood', P.woodD, X(x - 6), X(x + w + 6), hy(ct + 2) - 0.02, hy(ct), zf - 0.02, zf + 0.07, 0.6);
    // the striped awning sloping out over the counter, scalloped valance, ears on top, the label board
    const od = (i % 2) * 0.014, ty = hy(1436) - od, eyy = hy(1490) - od, zA0 = zS + 0.9, zA1 = zf + 0.3 + od * 2.2;   // neighbouring awnings overlap at their fronts (as drawn): odd ones 14 mm lower / further out
    for (let j = 0; j < 7; j++) {
      const a0 = X(x + 6 + (w - 12) * j / 7), a1 = X(x + 6 + (w - 12) * (j + 1) / 7), b0 = X(x - 14 + (w + 28) * j / 7), b1 = X(x - 14 + (w + 28) * (j + 1) / 7);
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute([a0, ty, zA0, b0, eyy, zA1, b1, eyy, zA1, a0, ty, zA0, b1, eyy, zA1, a1, ty, zA0], 3)); g.computeVertexNormals();
      k.b.add('canvas', g, M(0, 0, 0), j % 2 ? P.cream : t.c1, 1); g.dispose();
    }
    box(k, 'canvas', shade(t.c1, -0.3), X(x - 14), X(x + w + 14), eyy - 0.08, eyy + 0.005, zA1 - 0.01, zA1 + 0.01);
    for (let j = 0; j < 7; j++) {
      const c = X(x - 14 + (w + 28) * (j + 0.5) / 7), r = F.W((w + 28) / 14);
      const pts: P2[] = []; for (let q = 0; q <= 6; q++) { const a = Math.PI + Math.PI * q / 6; pts.push([c + Math.cos(a) * r, eyy - 0.06 + Math.sin(a) * 0.26]); }
      ext(k, 'canvas', j % 2 ? P.cream : t.c1, pts, zA1 - 0.003, zA1 + 0.003);
    }
    for (const sg of [-1, 1]) {
      const ex = sg < 0 ? X(x + 14) : X(x + w - 14);
      ext(k, 'canvas', t.c1, [[ex - 0.12, ty - 0.02], [ex + 0.12, ty - 0.02], [ex + sg * 0.05, ty + 0.26]], zA0 + 0.02, zA0 + 0.08);
      ext(k, 'flat', P.pink, [[ex - 0.06, ty + 0.01], [ex + 0.06, ty + 0.01], [ex + sg * 0.035, ty + 0.15]], zA0 + 0.086, zA0 + 0.09);
    }
    plaque(k, t.label, xm, ty + 0.14, zA0 + 0.04, F.W(112) * 1.12, { bg: P.metal, ears: false });
    if (!F.det) return;
    // the vendor cat behind the counter
    box(k, 'wood', P.woodD, xm - 0.2, xm + 0.2, y0, y0 + 0.42, zc - 0.75, zc - 0.35, 0.5);   // the stool
    kitty(k, xm, y0 + 0.42, zc - 0.55, 0.95, t.fur);
    // goods on the counter and on the back wall
    const gy = hy(ct - 9), gz = zc + 0.05, wy = hy(1530) + 0.02, wz = zS + 0.08;
    if (i === 0) {
      ['#e8455c', '#4ab0ff', '#6fdc6f', '#b06bff'].forEach((c, q) => { const bx = X(x + 30 + q * 40); cylY(k, 'flat', c, bx, gy, gz, 0.08, 0.2); cylY(k, 'flat', '#f0e6d0', bx, gy + 0.2, gz, 0.03, 0.08); });
      ['#6fdc6f', '#e8455c', '#4ab0ff'].forEach((c, q) => cylY(k, 'flat', c, X([x + 24, x + 42, x + w - 40][q]), wy, wz, 0.05, 0.13));
      for (const hx of [x + 60, x + w - 60]) k.b.add('flat', GEO.cone4, M(X(hx), hy(1510), wz, 0.16, 0.3, 0.1, Math.PI, 0, 0), '#7fae5a', 1);
    } else if (i === 1) {
      lump(k, 'flat', '#8fb6c8', X(x + 52), gy + 0.07, gz, 0.26, 0.08, 0.12, 0.1); lump(k, 'flat', '#ffb36b', X(x + 120), gy + 0.06, gz, 0.22, 0.07, 0.11, -0.2);
      ['#8fb6c8', '#ffb36b', '#8fb6c8', '#c9b6ff'].forEach((c, q) => lump(k, 'flat', c, X([x + 30, x + 54, x + w - 54, x + w - 30][q]), hy(1530), wz, 0.06, 0.18, 0.04));
    } else if (i === 2) {
      for (const [sx2, a] of [[x + 56, -0.2], [x + 118, 0.25]]) k.b.add('flat', GEO.cyl8, M(X(sx2), gy + 0.06, gz, 0.11, 0.42, 0.11, 0, 0, Math.PI / 2 + a), '#c4574a', 1);
      k.b.add('flat', GEO.cone4, M(X(x + 90), gy + 0.08, gz, 0.26, 0.16, 0.16, 0, Math.PI / 4, 0), '#ffd34d', 1);
      for (const hx of [x + 26, x + 42, x + 58]) cylY(k, 'flat', '#c4574a', X(hx), hy(1530) - 0.1, wz, 0.05, 0.36);
      cylY(k, 'flat', '#ffd34d', X(x + w - 40), wy, wz + 0.05, 0.18, 0.13, 16);
    } else {
      for (const mx of [x + 50, x + 88]) { cylY(k, 'flat', '#f7f3ea', X(mx), gy, gz, 0.08, 0.26); cylY(k, 'flat', '#4a8fd0', X(mx), gy + 0.26, gz, 0.05, 0.05); }
      lump(k, 'flat', P.pink, X(x + 132), gy + 0.13, gz, 0.13, 0.13, 0.13);
      for (const mx of [x + 26, x + 44]) cylY(k, 'flat', '#f7f3ea', X(mx), wy, wz, 0.045, 0.15);
      lump(k, 'flat', '#7fd6e6', X(x + w - 46), wy + 0.08, wz, 0.08, 0.08, 0.08); lump(k, 'flat', P.gold, X(x + w - 28), wy + 0.08, wz, 0.08, 0.08, 0.08);
    }
  });
  markDoor(k, 'arch', X(1676 - 6) - 0.005, X(1868 + w + 6) + 0.005, y0 - 0.005, hy(ct - 9) + 0.005, zc - 0.16, zf + 0.075);   // the two middle counters at the door point
  // the long beam on two tall end posts, bunting, the main sign with the fish and the bone, the cat on the beam
  const zB = zf - 0.12, yB = hy(1396);
  for (const x of [1470, 2230]) box(k, 'wood', P.wood, X(x), X(x + 20), y0, hy(1384), zB - 0.1, zB + 0.1, 0.6);
  cylX(k, 'wood', P.woodD, X(1452), X(2268), yB, zB, 0.09 * s);
  for (const x of [1452, 2268]) lump(k, 'wood', P.woodL, X(x), yB, zB, 0.11, 0.11, 0.11);
  const BC = ['#ffd76a', '#ff8fa3', '#7fd6e6', '#b9a2ff'];
  for (let i = 0; i < 18; i++) {
    const t = (i + 0.5) / 18, x = 1480 + t * 760, y = 1398 + Math.sin(t * Math.PI * 3) ** 2 * 10;
    ext(k, 'canvas', BC[i % 4], [[X(x - 16), hy(y)], [X(x), hy(y + 20)], [X(x + 16), hy(y)]], zB + 0.11, zB + 0.12);
  }
  plaque(k, signOf(p, 'РЫБНЫЕ РЯДЫ'), X(1860), hy(1384), zB + 0.14, F.W(290));
  if (F.det) {
    const fish: P2[] = [[-0.26, 0], [-0.12, 0.13], [0.12, 0.11], [0.2, 0], [0.32, 0.11], [0.3, 0], [0.32, -0.11], [0.2, 0], [0.12, -0.11], [-0.12, -0.13]];
    extM(k, 'flat', '#8fb6c8', fish.map(([a, b]) => [a * 0.6, b * 0.6]) as P2[], 0.04, M(X(1700), yB, zB + 0.09));
    box(k, 'flat', P.cream, X(2000), X(2040), yB - 0.02, yB + 0.02, zB + 0.09, zB + 0.13);
    for (const dx of [-12, -4, 4, 12]) box(k, 'flat', P.cream, X(2020 + dx) - 0.01, X(2020 + dx) + 0.01, yB - 0.08, yB + 0.08, zB + 0.101, zB + 0.124);
    kitty(k, X(2210), yB + 0.08, zB, 0.55, FUR[4]);
  }
  k.colliders.push(X(1470), X(2250), y0, hy(1384) + 0.4, zS - 0.1, zf + 0.3);
}

/* ------------------------------------------------------------------ «Аукцион» (auctionB) */
function auction(k: Ctx, p: FcPlace): void {
  const F = fit(k, p, 'auction'), s = F.s, y0 = F.y0, X = F.X;
  const L = 1500, R = 2100, B = 2150, wt = 2034, cx = 1800, ab = 2134;
  // the wall band (ab → wt, 100 px) is stretched to 2.2 m: the arches / door a character fits; plinth and roof as drawn
  const hy = (y: number) => y0 + s * (y >= ab ? (B - y) * 0.0138 : y >= wt ? 0.22 + (ab - y) * 0.022 : 2.42 + (wt - y) * VS);
  const zf = F.zf, zb = F.zb, zw = zf - 0.12, zr = zw - 0.95, WALL = '#f3d3a5', TRIM = '#e0b47a';
  const A1: P2 = [1536, 1716], A2: P2 = [1884, 2064], D: P2 = [cx - 50, cx + 50];
  const yb = hy(ab), yt = hy(wt);
  const archOf = (a: number, b: number) => archPts(X(a), X(b), yb + 0.006, hy(2080), hy(2050));
  const doorPts = archPts(X(D[0]), X(D[1]), yb + 0.006, hy(2092), hy(2066));
  // plinth, steps
  box(k, 'plaster', '#c9b8a8', X(L - 8), X(R + 8), y0 - 0.05, yb, zb + 0.2, zw + 0.12, 1);
  box(k, 'plaster', '#e8d4c0', X(cx - 43), X(cx + 43), y0 - 0.05, y0 + 0.1, zw + 0.12, zw + 0.42, 1);
  // front wall with the two arched windows and the door cut out, body behind, recesses
  ext(k, 'flat', WALL, [[X(L), yb - 0.03], [X(R), yb - 0.03], [X(R), yt], [X(L), yt]], zw - 0.2, zw, [archOf(...A1).reverse(), archOf(...A2).reverse(), doorPts.slice().reverse()]);
  box(k, 'flat', WALL, X(L), X(R), yb - 0.03, yt, zb + 0.3, zr, 1);
  for (const [a, b] of [[L, A1[0]], [A1[1], D[0]], [D[1], A2[0]], [A2[1], R]] as P2[]) box(k, 'flat', WALL, X(a), X(b), yb - 0.03, yt, zr, zw - 0.21, 1);
  for (const [a, b] of [A1, A2, D]) box(k, 'flat', WALL, X(a), X(b), hy(a === D[0] ? 2066 : 2050) - 0.04, yt, zr, zw - 0.21, 1);
  // arch trims and keystones
  for (const [a, b] of [A1, A2]) {
    const out = archPts(X(a - 9), X(b + 9), yb + 0.006, hy(2080), hy(2050) + 0.2);
    ext(k, 'flat', TRIM, out, zw + 0.006, zw + 0.04, [archOf(a, b).reverse()]);
    box(k, 'flat', TRIM, X((a + b) / 2 - 12), X((a + b) / 2 + 12), hy(2050) + 0.08, hy(2050) + 0.3, zw + 0.046, zw + 0.076, 1);
  }
  // the two lots rooms: red striped back wall, wooden floor, warm light
  for (const [a, b] of [A1, A2]) {
    box(k, 'flat', '#9a3a4a', X(a) + 0.006, X(b) - 0.006, yb + 0.006, hy(2050), zr - 0.02, zr + 0.01);
    for (let x = a + 12; x < b; x += 24) box(k, 'flat', '#c9894a', X(x) - 0.012, X(x) + 0.012, yb + 0.5, hy(2050) - 0.01, zr + 0.016, zr + 0.02);
    box(k, 'flat', '#c08a52', X(a) + 0.006, X(b) - 0.006, yb + 0.006, yb + 0.026, zr + 0.016, zw - 0.206);
    k.glows.push(X((a + b) / 2), hy(2080), zw - 0.4, 2.0, 1, 0.75, 0.42);
  }
  // the door: two leaves, gold knobs
  box(k, 'flat', '#2a1418', X(D[0]) + 0.006, X(D[1]) - 0.006, yb + 0.006, hy(2066), zr - 0.02, zr + 0.01);
  for (const sg of [-1, 1]) {
    ext(k, 'wood', '#7a3a2a', archPts(X(D[0]) + 0.006, X(D[1]) - 0.006, yb + 0.012, hy(2092) - 0.02, hy(2066) - 0.03).map(([x, y]) => [Math.min(Math.max(x, sg < 0 ? X(D[0]) + 0.006 : X(cx) + 0.01), sg < 0 ? X(cx) - 0.01 : X(D[1]) - 0.006), y] as P2), zw - 0.17, zw - 0.12);
    lump(k, 'flat', P.gold, X(cx) + sg * 0.1, hy(2110), zw - 0.1, 0.035, 0.035, 0.035);
  }
  markDoor(k, 'door', X(D[0]) - 0.005, X(D[1]) + 0.005, yb, hy(2066) + 0.01, zw - 0.18, zw - 0.06);   // the double door's leaves
  if (F.det) {
    const zi = zr + 0.35;
    // A1: picture, the auctioneer cat with its gavel at a podium
    box(k, 'flat', P.gold, X(1572), X(1610), hy(2086), hy(2058), zr + 0.01, zr + 0.04); box(k, 'flat', '#7fd6e6', X(1578), X(1604), hy(2080), hy(2064), zr + 0.046, zr + 0.052);
    kitty(k, X(1659), yb, zi - 0.1, 0.85, FUR[7]);
    box(k, 'wood', '#7a3a2a', X(1626), X(1692), yb + 0.03, yb + 0.55, zi + 0.1, zi + 0.36, 0.5); box(k, 'wood', '#a85a40', X(1620), X(1698), yb + 0.55, yb + 0.6, zi + 0.08, zi + 0.38, 0.5);
    rbox(k, 'wood', P.woodD, X(1690), yb + 0.95, zi + 0.1, 0.2, 0.1, 0.1, 0, 0, -0.6, 0.5);
    // A2: two lots on pedestals (yarn, gold fish) and three bidder cats
    for (const [x, lot] of [[1912, 1], [1980, 2]]) {
      box(k, 'flat', P.cream, X(x), X(x + 34), yb, yb + 0.5, zi - 0.1, zi + 0.2); cylY(k, 'flat', '#a3122a', X(x + 17), yb + 0.5, zi + 0.05, 0.18, 0.05);
      if (lot === 1) lump(k, 'flat', P.pink, X(x + 17), yb + 0.66, zi + 0.05, 0.11, 0.11, 0.11);
      else lump(k, 'flat', P.gold, X(x + 17), yb + 0.66, zi + 0.05, 0.16, 0.07, 0.06, 0.3);
    }
    kitty(k, X(1924), yb, zw - 0.45, 0.6, '#4a4350'); kitty(k, X(1976), yb, zw - 0.45, 0.6, FUR[0]); kitty(k, X(2030), yb, zw - 0.45, 0.56, FUR[3]);
  }
  // lanterns by the door
  for (const sg of [-1, 1]) {
    const lx = X(cx + sg * 64);
    box(k, 'wood', P.woodD, lx - 0.02, lx + 0.02, hy(2070) + 0.05, hy(2070) + 0.15, zw + 0.006, zw + 0.2, 0.5);
    box(k, 'emit', '#ffcf6a', lx - 0.08, lx + 0.08, hy(2070) - 0.18, hy(2070) + 0.05, zw + 0.1, zw + 0.26);
    k.glows.push(lx, hy(2070) - 0.06, zw + 0.2, 1.1, 1, 0.78, 0.4);
  }
  k.lights.push(X(cx), hy(2070), zw + 0.6);
  // the mustard hip roof, its fascia, the ridge beam with knobs, the cross gable with the gavel medallion
  const yE = hy(wt + 4), zE0 = zb + 0.05, zE1 = zf + 0.38, zm = (zE0 + zE1) / 2, yR = hy(1906);
  loftRoof(k, 'flat', MUSTARD[0], X(L - 22), X(R + 22), zE0, zE1, yE, X(L + 60), X(R - 60), zm, zm, yR, { sag: 0.05 });
  box(k, 'wood', MUSTARD[1], X(L - 18), X(R + 18), yE - 0.16, yE + 0.01, zE0 + 0.05, zE1 - 0.04, 0.6);
  cylX(k, 'wood', MUSTARD[1], X(L + 50), X(R - 50), yR + 0.03, zm, 0.08 * s);
  for (const x of [L + 50, R - 50]) lump(k, 'wood', MUSTARD[2], X(x), yR + 0.03, zm, 0.12, 0.12, 0.12);
  const gA = hy(1880), gz0 = zm - 0.3, gz1 = zE1 - 0.05;
  ext(k, 'flat', WALL, [[X(cx - 130), yE - 0.02], [X(cx + 130), yE - 0.02], [X(cx), gA]], gz0, gz1);
  { const dx = X(cx + 146) - X(cx), dy = hy(1866) - (yE - 0.08), len = Math.hypot(dx, dy), a = Math.atan2(dy, dx);
    for (const sg of [-1, 1]) {
      rbox(k, 'flat', shade(MUSTARD[0], -0.12), X(cx) + sg * dx / 2, yE - 0.08 + dy / 2 + 0.06, (gz0 + gz1 + 0.15) / 2, len + 0.1, 0.1, gz1 + 0.15 - gz0, 0, 0, sg * -a, 1.2);
      rbox(k, 'wood', MUSTARD[1], X(cx) + sg * dx / 2, yE - 0.08 + dy / 2 + 0.05, gz1 + 0.17 + (sg > 0 ? 0.012 : 0), len + 0.14, 0.14, 0.1, 0, 0, sg * -a, 0.6);
    } }
  disc(k, 'flat', P.glass, X(cx), hy(1962), gz1 + 0.03, 0.36 * s, 0.4 * s, 0.05);
  rbox(k, 'wood', P.woodD, X(cx) - 0.04, hy(1962) + 0.06, gz1 + 0.08, 0.36, 0.2, 0.08, 0, 0, 0.52, 0.5);
  rbox(k, 'wood', P.wood, X(cx) + 0.08, hy(1962) - 0.09, gz1 + 0.08, 0.08, 0.32, 0.06, 0, 0, 0.52, 0.5);
  plaque(k, signOf(p, 'АУКЦИОН'), X(cx), yE + 0.02, zE1 + 0.12, F.W(170) * 1.15);
  if (F.det) kitty(k, X(1660), yR - 0.25, zm + 0.45, 0.6, FUR[7]);
  k.colliders.push(X(L - 22), X(R + 22), y0, gA + 0.2, zb, zf + 0.38);
}

/* ------------------------------------------------------------------ «Когтекузня»: the cardboard-box forge (forgeB) */
function forge(k: Ctx, p: FcPlace): void {
  const F = fit(k, p, 'forge'), s = F.s, y0 = F.y0, X = F.X;
  const L = 3630, R = 4230, B = 1640, tf = 1484, cx = 3930, oL = 3668, oR = 4104, oT = 1514, oB = 1628;
  const hy = (y: number) => y0 + (B - y) * VS * s;
  const zf = F.zf, zb = F.zb, T = 0.1, H = hy(tf), zp = zf - 1.8, zcB = (zf + zb) / 2;
  // the box: front with the rounded opening, back, sides, floor; the workshop partition behind the opening
  const op: P2[] = [];
  { const x0 = X(oL), x1 = X(oR), ya = hy(oB), yb2 = hy(oT), r = 0.16;
    op.push([x0, ya], [x1, ya]);
    for (let q = 0; q <= 3; q++) { const a = Math.PI / 2 * q / 3; op.push([x1 - r + Math.cos(a) * r, yb2 - r + Math.sin(a) * r]); }
    for (let q = 0; q <= 3; q++) { const a = Math.PI / 2 + Math.PI / 2 * q / 3; op.push([x0 + r + Math.cos(a) * r, yb2 - r + Math.sin(a) * r]); } }
  ext(k, 'plaster', P.card, [[X(L), y0], [X(R), y0], [X(R), H], [X(L), H]], zf - T, zf, [op.slice().reverse()], 1.4);
  box(k, 'plaster', P.cardD, X(L), X(R), y0, H, zb, zb + T, 1.4);
  box(k, 'plaster', P.card, X(L), X(L) + T, y0, H, zb + T, zf - T, 1.4);
  box(k, 'plaster', P.cardD, X(R) - T, X(R), y0, H, zb + T, zf - T, 1.4);
  box(k, 'flat', '#6e4430', X(L) + T, X(R) - T, y0, hy(oB), zb + T, zf - T);
  box(k, 'wood', '#9a6444', X(L) + T, X(R) - T, hy(oB), H - 0.02, zp - 0.08, zp, 0.6);
  // the flaps: back one standing up, the two side ones folded out, the front lip folded down over the opening
  rbox(k, 'plaster', P.cardL, (X(L) + X(R)) / 2, H + 0.66, zb - 0.06, X(R) - X(L) - 0.5, 1.4, 0.05, 0, -0.18, 0, 1.4);
  for (const sg of [-1, 1]) rbox(k, 'plaster', sg < 0 ? P.card : P.cardD, (sg < 0 ? X(L) : X(R)) + sg * 0.28 * Math.cos(0.9), H + 0.28 * Math.sin(0.9), zcB, 0.56, 0.05, zf - zb - 0.4, 0, 0, sg * 0.9, 1.4);
  box(k, 'plaster', P.cardD, X(L) - 0.04, X(R) + 0.04, hy(tf + 26), H + 0.02, zf, zf + 0.05, 1.4);
  markDoor(k, 'arch', X(oL) - 0.01, X(oR) + 0.01, hy(oB) - 0.01, hy(oT) + 0.01, zf - T - 0.01, zf + 0.01);   // the rounded opening (its cut faces)
  // the ramp flap in front of the opening, with a red paw
  { const zA = zf, zB2 = zf + 0.3, ya = hy(oB), len = Math.hypot(zB2 - zA, ya - y0);
    rbox(k, 'plaster', P.cardL, X(3880), (ya + y0) / 2 + 0.01, (zA + zB2) / 2, F.W(120), 0.04, len, 0, Math.atan2(ya - y0, zB2 - zA), 0, 1.4);
    disc(k, 'flat', '#c0504a', X(3880), (ya + y0) / 2 + 0.04, (zA + zB2) / 2, 0.1, 0.08, 0.01, 8); }
  // furnace (brick, arched mouth with fire) and the can-stack chimney over it, smoke
  const fx0 = X(3992), fx1 = X(4150), fz1 = zf - 0.75;
  box(k, 'brick', P.brick, fx0, fx1, hy(oB), hy(oT) + 0.05, zp, fz1, 1);
  ext(k, 'flat', '#2a1418', archPts(X(4016), X(4080), hy(oB), hy(1572), hy(1556)), fz1, fz1 + 0.02);
  k.b.add('emit', GEO.cone16, M(X(4048), hy(oB) + 0.22, fz1 + 0.03, 0.5, 0.46, 0.2), '#ffb13d', 1);
  disc(k, 'emit', '#c94a3a', X(4048), hy(oB) + 0.04, fz1 + 0.03, 0.3, 0.07, 0.04);
  markDoor(k, 'hearth', X(4016), X(4080), hy(oB), hy(1556), fz1, fz1 + 0.13);   // the furnace mouth: never a second door
  box(k, 'flat', P.rockL, fx0 - 0.06, fx1 + 0.06, hy(oB) - 0.0, hy(1586), fz1, fz1 + 0.12);
  k.glows.push(X(4048), hy(1580), fz1 + 0.3, 2.4, 1, 0.55, 0.2); k.lights.push(X(4048), hy(1570), fz1 + 0.8);
  const CANS = ['#e6e8ee', '#4cc95a', '#4aa3ff', '#b06bff', '#ffb83d'], cz = (zp + fz1) / 2, ch = 30 * VS * s;
  for (let i = 0; i < 5; i++) {
    const yb2 = hy(oT) + 0.05 + i * ch;
    cylY(k, 'flat', '#c9ccd6', X(4123), yb2, cz, 0.23 * s, ch - 0.01, 16);
    cylY(k, 'flat', CANS[i], X(4123), yb2 + ch * 0.26, cz, 0.242 * s, ch * 0.48, 16);
  }
  k.b.role = 'smoke';
  if (F.det) for (let i = 0; i < 3; i++) lump(k, 'flat', '#e8e0f0', X(4128 + i * 14), hy(oT) + 0.05 + 5 * ch + 0.35 + i * 0.4, cz, 0.18 + i * 0.07, 0.15 + i * 0.06, 0.18 + i * 0.07);
  k.b.role = '';
  // workshop: shelf with jars, tools on the wall, the bench, the anvil on its stump, the water bucket, the lantern
  const zt = zp + 0.02;
  box(k, 'wood', P.woodD, X(oL + 18), X(oL + 114), hy(1552) - 0.05, hy(1552), zt, zt + 0.25, 0.5);
  if (F.det) {
    ['#4cc95a', '#4aa3ff', '#ffb83d'].forEach((c, i) => { cylY(k, 'flat', '#c9ccd6', X(oL + 35 + i * 28), hy(1552), zt + 0.12, 0.09, 0.2); cylY(k, 'flat', c, X(oL + 35 + i * 28), hy(1552) + 0.06, zt + 0.12, 0.1, 0.07); });
    for (const [x, len] of [[3806, 0.5], [3834, 0.45], [3868, 0.5], [3906, 0.55]] as P2[]) {
      box(k, 'wood', P.woodL, X(x) - 0.02, X(x) + 0.02, hy(1528) - len, hy(1528), zt, zt + 0.04, 0.5);
      box(k, 'flat', '#8a8e9e', X(x) - 0.07, X(x) + 0.07, hy(1528) - len - 0.1, hy(1528) - len + 0.02, zt + 0.006, zt + 0.05);
    }
    rbox(k, 'flat', '#dfe3ea', X(3950), hy(1590), zt + 0.03, 0.06, 0.55, 0.03, 0, 0, -0.2);
    const bz = zf - 0.75;
    box(k, 'wood', P.woodL, X(oL + 16), X(oL + 140), hy(1600), hy(1590), bz - 0.3, bz + 0.1, 0.5);
    for (const x of [oL + 24, oL + 124]) box(k, 'wood', P.woodD, X(x) - 0.03, X(x) + 0.03, hy(oB), hy(1600), bz - 0.1, bz - 0.04, 0.5);
    rbox(k, 'flat', '#8a8e9e', X(oL + 50), hy(1590) + 0.04, bz - 0.1, 0.25, 0.06, 0.08, 0.5);
    const ax = X(3884), az = zf - 1.1, ay = hy(oB);
    cylY(k, 'wood', P.wood, ax, ay, az, 0.24, 0.36, 8);
    box(k, 'flat', '#5f6374', ax - 0.22, ax + 0.24, ay + 0.36, ay + 0.46, az - 0.14, az + 0.14);
    box(k, 'flat', '#6f7384', ax - 0.08, ax + 0.1, ay + 0.46, ay + 0.62, az - 0.1, az + 0.1);
    box(k, 'flat', '#8a8e9e', ax - 0.3, ax + 0.36, ay + 0.62, ay + 0.76, az - 0.13, az + 0.13);
    k.b.add('flat', GEO.cone4, M(ax - 0.42, ay + 0.71, az, 0.14, 0.26, 0.16, 0, 0, Math.PI / 2), '#8a8e9e', 1);
    cylY(k, 'flat', '#8a8e9e', X(4077), ay + 0.004, zf - 0.5, 0.16, 0.326, 8); cylY(k, 'flat', '#4ab0ff', X(4077), ay + 0.338, zf - 0.5, 0.15, 0.006, 8);
    kitty(k, X(R) - 0.06, H, zf - 1.0, 0.7, FUR[6]);
  }
  // the workshop lantern: on an iron bracket out of the partition (it used to hang in the air in front of it)
  box(k, 'wood', P.metal, X(3788) - 0.015, X(3788) + 0.015, hy(1510) - 0.005, hy(1510) + 0.025, zp, zp + 0.08, 0.4);
  box(k, 'emit', '#ffcf6a', X(3780), X(3796), hy(1530), hy(1510), zp + 0.02, zp + 0.1);
  k.glows.push(X(3788), hy(1520), zp + 0.06, 1.2, 1, 0.8, 0.45);
  // signs: «КОГТЕКУЗНЯ» on the lip, the «ХРУПКОЕ» stamp
  plaque(k, signOf(p, 'КОГТЕКУЗНЯ'), X(cx), hy(tf + 12), zf + 0.06, F.W(236) * 1.05);
  plaque(k, 'ХРУПКОЕ', X(4168), hy(1558), zf + 0.005, 1.0 * s, { bg: P.card, fg: '#c94a3a', ears: false });
  k.colliders.push(X(L), X(R), y0, H + 0.9, zb, zf);
}

/* ------------------------------------------------------------------ «Заточка» (anvilB) */
function anvil(k: Ctx, p: FcPlace): void {
  const F = fit(k, p, 'anvil'), s = F.s, y0 = F.y0, X = F.X;
  const L = 4306, R = 4584, B = 1640, cx = 4445, ft = 1626;
  const hy = (y: number) => y0 + (B - y) * VS * s;
  const zf = F.zf, zb = F.zb, fl = hy(ft);
  // the plank floor and its front band, the dark back wall with tools and a shelf
  box(k, 'wood', P.woodL, X(L + 2), X(R - 4), y0 - 0.05, fl, zb, zf - 0.04, 0.6);
  box(k, 'wood', P.wood, X(L + 2) + 0.008, X(R - 4) - 0.008, y0 - 0.05, fl - 0.02, zf - 0.06, zf, 0.6);
  box(k, 'wood', P.woodD, X(L + 10), X(R - 10), fl, hy(1370) - 0.08, zb, zb + 0.12, 0.6);
  // posts: front pair (as drawn) under the low eave, back pair carrying the high end
  const yEf = hy(1518), zE1 = zf + 0.25, zE0 = zb + 0.1, yEb = hy(1370);
  for (const x of [L, R - 18]) {
    box(k, 'wood', P.wood, X(x), X(x + 18), fl, yEf, zf - 0.3, zf - 0.12, 0.6);
    box(k, 'wood', P.wood, X(x), X(x + 18), fl, yEb - 0.05, zb + 0.12, zb + 0.3, 0.6);
  }
  // the shed roof (card-coloured planks with a red band), its lit front fascia
  { const len = Math.hypot(zE1 - zE0, yEb - yEf), a = Math.atan2(yEb - yEf, zE1 - zE0), zc = (zE0 + zE1) / 2, yc = (yEf + yEb) / 2;
    rbox(k, 'wood', P.card, (X(L - 16) + X(R + 16)) / 2, yc + 0.06, zc, X(R + 16) - X(L - 16), 0.12, len, 0, a, 0, 0.6);
    const tB = 0.72, yb2 = yEf + (yEb - yEf) * tB, zb2 = zE1 - (zE1 - zE0) * tB;
    rbox(k, 'flat', '#c94a3a', (X(L - 10) + X(R + 10)) / 2, yb2 + 0.06 + 0.065 / Math.cos(a), zb2, X(R + 10) - X(L - 10), 0.01, 0.16, 0, a, 0);
    box(k, 'wood', P.cardL, X(L - 16), X(R + 16), yEf - 0.12, yEf + 0.02, zE1 - 0.02, zE1 + 0.03, 0.6);
    // «ЗАТОЧКА» on the slope
    const t = (hy(1474) - yEf) / (yEb - yEf);
    plaque(k, signOf(p, 'ЗАТОЧКА'), X(cx), yEf + (yEb - yEf) * t + 0.06 + 0.1 / Math.cos(a), zE1 - (zE1 - zE0) * t, F.W(140) * 1.6, { ears: false, lean: Math.PI / 2 - a });
  }
  // furnace with the fire, the chimney through the roof, smoke
  const zfu = zb + 0.12, fz1 = zb + 0.95;
  box(k, 'brick', P.brick, X(L + 24), X(L + 98), fl, hy(1500), zfu, fz1, 1);
  ext(k, 'flat', '#2a1418', archPts(X(L + 40), X(L + 82), fl + 0.006, hy(1576), hy(1560)), fz1 + 0.006, fz1 + 0.026);
  k.b.add('emit', GEO.cone16, M(X(L + 61), fl + 0.17, fz1 - 0.05, 0.32, 0.34, 0.22), '#ffb13d', 1);
  k.glows.push(X(L + 61), fl + 0.3, fz1 + 0.3, 2.0, 1, 0.55, 0.2); k.lights.push(X(L + 61), fl + 0.4, fz1 + 0.7);
  box(k, 'flat', '#6f7384', X(L + 46), X(L + 72), hy(1500), hy(1330), zfu + 0.25, zfu + 0.5);
  box(k, 'flat', '#5f6374', X(L + 42), X(L + 76), hy(1330), hy(1330) + 0.12, zfu + 0.22, zfu + 0.53);
  k.b.role = 'smoke';
  if (F.det) for (let i = 0; i < 2; i++) lump(k, 'flat', '#e8e0f0', X(L + 66 + i * 12), hy(1330) + 0.4 + i * 0.35, zfu + 0.37, 0.14 + i * 0.05, 0.12 + i * 0.04, 0.14 + i * 0.05);
  k.b.role = '';
  markDoor(k, 'hearth', X(L + 40), X(L + 82), fl, hy(1560), fz1 - 0.16, fz1 + 0.03);   // the furnace mouth
  // the water tub (front left), the anvil on its stump, the smith, the grindstone (back right)
  { const tz = zf - 0.55, tx = X(L + 66);
    k.b.add('flat', GEO.dome, M(tx, fl, tz, 0.52, 0.42, 0.45), '#4ab0ff', 1);
    disc(k, 'flat', '#9fdcff', tx, fl + 0.2, tz, 0.22, 0.18, 0.01, 16);
    k.b.add('flat', GEO.cyl16, M(tx, fl + 0.205, tz, 0.44, 0.01, 0.36), '#9fdcff', 1); }
  const ax = X(cx + 16), az = zf - 0.95;
  cylY(k, 'wood', P.wood, ax, fl, az, 0.26, 0.34, 8);
  box(k, 'flat', '#5f6374', ax - 0.28, ax + 0.28, fl + 0.34, fl + 0.44, az - 0.15, az + 0.15);
  box(k, 'flat', '#6f7384', ax - 0.11, ax + 0.11, fl + 0.44, fl + 0.6, az - 0.11, az + 0.11);
  box(k, 'flat', '#8a8e9e', ax - 0.32, ax + 0.38, fl + 0.6, fl + 0.78, az - 0.14, az + 0.14);
  k.b.add('flat', GEO.cone4, M(ax - 0.46, fl + 0.72, az, 0.16, 0.3, 0.18, 0, 0, Math.PI / 2), '#8a8e9e', 1);
  markDoor(k, 'arch', ax - 0.62, ax + 0.4, fl - 0.005, fl + 0.84, az - 0.27, az + 0.27);   // what you use: the anvil on its block
  if (F.det) {
    rbox(k, 'flat', '#c9ccd6', ax - 0.2, fl + 0.8, az + 0.05, 0.8, 0.03, 0.08, 0, 0, 0.02);
    kitty(k, X(cx + 64), fl, az - 0.5, 1.0, '#f2a65a');
    k.b.add('flat', GEO.dome, M(X(cx + 64), fl + 0.93, az - 0.46, 0.4, 0.14, 0.36), '#c94a3a', 1);
    for (const [x, c] of [[L + 150, '#8a8e9e'], [L + 176, '#8a8e9e'], [L + 206, '#c9ccd6']] as [number, string][]) {
      box(k, 'wood', P.woodL, X(x) - 0.02, X(x) + 0.02, hy(1516) - 0.35, hy(1516), zb + 0.12, zb + 0.15, 0.5);
      box(k, 'flat', c, X(x) - 0.07, X(x) + 0.07, hy(1516) - 0.45, hy(1516) - 0.33, zb + 0.12, zb + 0.16);
    }
    box(k, 'wood', P.wood, X(R - 92), X(R - 22), hy(1538) - 0.05, hy(1538), zb + 0.12, zb + 0.32, 0.5);
    box(k, 'flat', '#8a8e9e', X(R - 86), X(R - 60), hy(1538), hy(1538) + 0.13, zb + 0.15, zb + 0.28);
  }
  { const gx = X(R - 34), gz = (zb + zf) / 2 - 0.1, gy = fl + 0.7;
    for (const sg of [-1, 1]) rbox(k, 'wood', P.woodD, gx + sg * 0.16, fl + 0.35, gz, 0.06, 0.75, 0.06, 0, 0, sg * 0.25, 0.5);
    k.b.add('flat', GEO.cyl16, M(gx, gy, gz, 0.66, 0.13, 0.66, 0, 0, Math.PI / 2), '#a0a4b2', 1);
    cylX(k, 'flat', INK, gx - 0.12, gx + 0.3, gy, gz, 0.03);
    box(k, 'wood', P.woodD, gx + 0.27, gx + 0.31, gy - 0.18, gy, gz - 0.02, gz + 0.02, 0.5); }
  k.colliders.push(X(L - 16), X(R + 16), y0, hy(1384) + 0.5, zb, zf + 0.25);
}

/* ------------------------------------------------------------------ the notice board (boardB) */
function board(k: Ctx, p: FcPlace): void {
  const F = fit(k, p, 'board'), s = F.s, y0 = F.y0, X = F.X;
  const x0 = 3246, x1 = 3406, B = 1700, cx = (x0 + x1) / 2, V = 0.015 * s;
  const hy = (y: number) => y0 + (B - y) * V;
  const zf = F.zf, zp = zf - 0.36;   // board plane
  for (const x of [x0 + 12, x1 - 24]) box(k, 'wood', P.woodD, X(x), X(x + 12), y0, hy(1566), zp - 0.12, zp - 0.02, 0.5);
  box(k, 'wood', P.wood, X(x0), X(x1), hy(1670), hy(1584), zp - 0.02, zp + 0.06, 0.6);
  box(k, 'flat', '#c8956a', X(x0 + 8), X(x1 - 8), hy(1662), hy(1592), zp + 0.066, zp + 0.072);
  if (F.det) {
    const notes: [number, number, string, number][] = [[x0 + 14, 1598, '#fff4e0', -4], [x0 + 52, 1596, '#ffd0dc', 3], [x0 + 94, 1600, '#e0f0ff', -2], [x0 + 124, 1606, '#fff4a8', 5], [x0 + 30, 1630, '#e8ffd8', 2], [x0 + 76, 1628, '#fff4e0', -5]];
    notes.forEach(([x, y, c, a], i) => {
      const nx = X(x + 16), ny = hy(y + 14), dz = 0.08 + i * 0.014;
      rbox(k, 'flat', c, nx, ny, zp + dz, F.W(32), 28 * V, 0.002, 0, 0, -a * Math.PI / 180);
      for (const ly of [-0.06, 0, 0.06]) rbox(k, 'flat', '#8a7a6a', nx, ny + ly - 0.02, zp + dz + 0.0065, F.W(20), 0.012, 0.001, 0, 0, -a * Math.PI / 180);
      lump(k, 'flat', '#e8455c', nx, ny + 28 * V * 0.4, zp + dz + 0.02, 0.03, 0.03, 0.03);
    });
    disc(k, 'flat', '#c0504a', X(x1 - 22), hy(1652), zp + 0.0785, 0.06, 0.06, 0.001, 8);
  }
  markDoor(k, 'arch', X(x0) - 0.005, X(x1) + 0.005, hy(1670) - 0.005, hy(1584) + 0.005, zp - 0.025, zp + 0.21);   // the board and its notes
  // the little red gable roof with the ridge beam and its round caps
  const yE = hy(1590), yR = hy(1556), half = 0.5, rx0 = X(x0 - 16), rx1 = X(x1 + 16);
  { const len = Math.hypot(half, yR - yE), a = Math.atan2(yR - yE, half);
    for (const sg of [-1, 1]) rbox(k, 'roof', sg > 0 ? RED[0] : shade(RED[0], -0.15), (rx0 + rx1) / 2 + (sg > 0 ? 0.008 : 0), (yE + yR) / 2 + 0.04, zp + sg * half / 2, rx1 - rx0, 0.08, len + 0.04, 0, sg * a, 0, 0.8);
    for (const x of [rx0 + 0.03, rx1 - 0.03]) tri(k, 'flat', RED[1], [x, yE, zp - half + 0.02], [x, yE, zp + half - 0.02], [x, yR + 0.02, zp]);
    box(k, 'wood', RED[1], rx0 + 0.016, rx1 - 0.016, yE - 0.06, yE + 0.02, zp + half - 0.03, zp + half + 0.03, 0.5);
    cylX(k, 'wood', P.woodD, rx0 + 0.05, rx1 - 0.05, yR + 0.06, zp, 0.06 * s);
    for (const x of [rx0 + 0.05, rx1 - 0.05]) lump(k, 'wood', P.woodL, x, yR + 0.06, zp, 0.08, 0.08, 0.08);
  }
  plaque(k, signOf(p, 'ДОСКА'), X(cx), hy(1676), zp + 0.1, F.W(96) * 1.05, { bg: P.woodD, ears: false });
  k.colliders.push(X(x0), X(x1), y0, yR + 0.2, zp - 0.5, zp + 0.5);
}

/* ------------------------------------------------------------------ registration */
registerFcModel({ ref: 'tent', fp: '133a590e0dfb37', note: 'pink/white striped circus dome with cat ears and a gold knob, round lit entrance with the dandy, bead string, easel sign', build: tent });
registerFcModel({ ref: 'trainer', fp: '0a910a402c4323', note: 'teal two-tier pagoda roof with gold fish, red plank walls, open front with shoji screens and rope pillars', build: trainer });
registerFcModel({ ref: 'shop', fp: '18b9fd24a970de', note: 'four stalls with purple/blue/red/yellow striped awnings and labels, goods, vendor cats, beam with bunting and the main sign', build: shop });
registerFcModel({ ref: 'auction', fp: '17db95d0707666', note: 'mustard hip roof, cream walls with two arched lots rooms and a double door, cross gable with the gavel medallion', build: auction });
registerFcModel({ ref: 'forge', fp: '0989128d1c2a65', note: 'open cardboard box workshop: flaps, rounded opening, brick furnace with a can-stack chimney, anvil, tools, «ХРУПКОЕ»', build: forge });
registerFcModel({ ref: 'anvil', fp: '1cd472a67702c7', note: 'small open smithy: shed roof with the sign, brick furnace and chimney, water tub, anvil, smith cat, grindstone', build: anvil });
registerFcModel({ ref: 'board', fp: '0de69022cfc50d', note: 'notice board on two legs with six pinned notes under a little red gable roof, «ДОСКА» plaque', build: board });
