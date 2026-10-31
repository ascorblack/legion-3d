/** 3D buildings of the city: one builder per site building id + generic filler houses. World metres. */
import * as THREE from 'three';
import type { Building } from '../contracts';
import { toX, toZ } from './coords';
import { GEO, GEO2, M, archWallGeo } from './batch';
import {
  type Ctx, box, rbox, cyl, cone, ball, gableRoof, gableRoofZ, pyramidRoof, windowZ, doorZ, signZ, timberZ, wallLamp, flag,
  stripeColors, awning, shade,
} from './kit';
import { mine as lowMine, mineboard as lowMineboard, storage as lowStorage, lowEntranceZ } from './lowstreet';
import { jail as buildJail } from './jail';

export interface HouseOpts {
  wall?: 'brick' | 'plaster' | 'wood' | 'stone'; wallCol?: string; roofCol?: string; roof?: 'x' | 'z' | 'pyr' | 'flat';
  roofH?: number; floors?: number; door?: boolean; timber?: boolean; chimney?: boolean; lit?: number; shutters?: string;
  base?: number;   // ground height under the house
  /** X ranges (m) kept free of ground-floor windows (a door the builder adds itself). */
  noWin?: [number, number][];
}

/** Deterministic per-house RNG (facade dressing must not shift k.rnd: the town's layout randomness stays as it was). */
function houseRng(a: number, b: number, c: number): () => number {
  let s = (Math.abs(Math.round(a * 1013 + b * 7919 + c * 131)) % 2147483646) + 1;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}
const IVY = new THREE.IcosahedronGeometry(0.5, 0);
const BLOOM = new THREE.TetrahedronGeometry(0.6, 0);
const CURTAINS = ['#c84a5a', '#5a6ac8', '#e0b060', '#7a4a8a', '#4a8a6a', '#d87a4a'];
const FLOWERS = ['#ff7f9a', '#ffd84d', '#d0b0ff', '#ffb070', '#fff2e0', '#ff5a6a'];
/** Warm interior tints of lit windows (not one flat colour along the street). */
const GLASS_TINT = [0, 0.06, -0.06, 0.12];

/** Generic house: body box, plinth, windows per floor, door, roof, optional chimney / timber. Front face at zf, faces +Z. */
export function house(k: Ctx, x0: number, x1: number, zf: number, depth: number, h: number, o: HouseOpts = {}): void {
  const P = k.pal, r = k.rnd, y0 = o.base ?? 0;
  const rd = houseRng(x0, zf, h);
  const wall = o.wall || 'brick';
  // a touch of per-house colour variation (no copy-paste row); explicit colours from the builders are kept
  const wallCol = o.wallCol || shade(wall === 'brick' ? P.brick : wall === 'plaster' ? P.plaster : wall === 'wood' ? P.wood : P.stone, (rd() - 0.5) * 0.14);
  const roofCol = o.roofCol || P.roof;
  const w = x1 - x0, zb = zf - depth;
  box(k, wall === 'wood' ? 'wood' : wall, wallCol, x0, x1, y0, y0 + h, zb, zf, wall === 'brick' ? 1.2 : 1);
  // plinth + cornice
  box(k, 'stone', shade(P.stone, -0.2), x0 - 0.05, x1 + 0.05, y0 - 0.3, y0 + 0.35, zb - 0.05, zf + 0.045, 0.8);   // plinth: behind door leaves (FACADE_LAYERS)
  // bevelled top edge of the plinth (a 45° chamfer strip): the street-level edge reads as cut stone, not a sharp box
  {
    // (cut round the doors: this house's own and the ones its builder puts in the noWin ranges)
    const nW = Math.max(1, Math.floor(w / 1.25)), cuts: [number, number][] = [...(o.noWin ?? [])];
    if (o.door !== false) { const dx = x0 + w * (Math.floor(nW / 2) + 0.5) / nW; cuts.push([dx - 0.62, dx + 0.62]); }
    cuts.sort((a, b) => a[0] - b[0]);
    let a = x0 - 0.04;
    const run = (p: number, q: number) => { if (q - p > 0.08) rbox(k, 'stone', shade(P.stone, -0.05), (p + q) / 2, y0 + 0.335, zf + 0.03, q - p, 0.05, 0.05, 0, Math.PI / 4, 0, 0.8); };
    for (const [c0, c1] of cuts) { run(a, Math.min(c0, x1 + 0.04)); a = Math.max(a, c1); }
    run(a, x1 + 0.04);
  }
  box(k, 'wood', P.woodD, x0 - 0.08, x1 + 0.08, y0 + h - 0.12, y0 + h + 0.02, zb - 0.08, zf + 0.12);
  if (o.timber) timberZ(k, x0 + 0.05, x1 - 0.05, y0 + 0.35, y0 + h - 0.1, zf, Math.max(1, Math.round(w / 1.3)));
  const floors = o.floors ?? Math.max(1, Math.floor((h - 0.4) / 1.8));
  const nWin = Math.max(1, Math.floor(w / 1.25));
  const fh = (h - 0.4) / floors;
  const lit = o.lit ?? 0.5;
  const masonry = wall !== 'wood' && !o.timber;
  const wins: [number, number, number, number][] = [];   // x0 x1 y0 y1 of every opening (ivy keeps off them)
  for (let f = 0; f < floors; f++) {
    for (let i = 0; i < nWin; i++) {
      const wx = x0 + w * (i + 0.5) / nWin;
      if (f === 0 && o.door !== false && i === Math.floor(nWin / 2)) continue;
      const ww = Math.min(0.62, w / nWin * 0.5), wh = Math.min(0.9, fh * 0.5);
      if (f === 0 && o.noWin && o.noWin.some(([a, b]) => wx + ww / 2 + 0.12 > a && wx - ww / 2 - 0.12 < b)) continue;
      const isLit = r() < lit, sh = o.shutters && r() < 0.6 ? o.shutters : undefined, arch = f === floors - 1 && r() < 0.4;
      const wy = y0 + 0.4 + f * fh + fh * 0.3;
      windowZ(k, wx, wy, zf, ww, wh, isLit, { shutters: sh, arch, glass: shade(P.glass, GLASS_TINT[Math.floor(rd() * GLASS_TINT.length)]) });
      wins.push([wx - ww / 2 - (sh ? ww * 0.45 + 0.1 : 0.1), wx + ww / 2 + (sh ? ww * 0.45 + 0.1 : 0.1), wy - 0.35, wy + wh + 0.25]);
      windowDress(k, rd, wx, wy, zf, ww, wh, { lit: isLit, arch, masonry, wall, ground: f === 0, y0, top: y0 + h - 0.16 });
    }
  }
  if (o.door !== false) {
    const dx = x0 + w * (Math.floor(nWin / 2) + 0.5) / nWin;
    const arch = r() < 0.5;
    doorZ(k, dx, y0, zf, 0.8, 1.6, { arch });
    wins.push([dx - 0.75, dx + 0.75, y0, y0 + 2.4]);
    // a little roof over the door on two brackets (+ a wall lantern beside some doors: a warm pool on the cobbles)
    if (h > 2.6 && rd() < 0.6) {
      const cy = y0 + 2.06, cw = 1.25;
      rbox(k, 'roof', shade(roofCol, -0.1), dx, cy, zf + 0.3, cw, 0.06, 0.62, 0, 0.32, 0, 1);
      rbox(k, 'wood', shade(P.woodD, 0.1), dx, cy - 0.055, zf + 0.29, cw - 0.06, 0.03, 0.56, 0, 0.32, 0, 0.5);
      for (const s of [-1, 1]) rbox(k, 'wood', P.woodD, dx + s * (cw / 2 - 0.12), cy - 0.22, zf + 0.2, 0.06, 0.06, 0.48, 0, -0.75, 0, 0.5);
    }
    if (h > 2.6 && rd() < 0.45 && dx + 0.8 < x1 - 0.1) wallLamp(k, dx + 0.78, y0 + 2.0, zf);
  }
  const rich = k.quality >= 2;   // q0–q1: the light version of the facade dressing (no quoins / ivy / flower boxes / curtains)
  if (masonry && rich) quoins(k, rd, x0, x1, zf, y0, h, wall, wallCol);
  // string course between the floors of masonry houses
  if (masonry) for (let f = 1; f < floors; f++) {
    const yy = y0 + 0.4 + f * fh;
    box(k, 'stone', shade(wall === 'brick' ? P.stone : wallCol, wall === 'brick' ? 0.12 : -0.12), x0 + 0.007, x1 - 0.007, yy - 0.05, yy + 0.04, zf - 0.04, zf + 0.042, 0.8);
  }
  const rh = o.roofH ?? Math.min(2.6, Math.max(1.2, w * 0.45));
  const roof = o.roof || (w < depth * 0.8 ? 'z' : 'x');
  if (roof === 'x') gableRoof(k, roofCol, wall === 'wood' ? 'wood' : wall, wallCol, x0, x1, zb, zf, y0 + h, rh);
  else if (roof === 'z') gableRoofZ(k, roofCol, wall === 'wood' ? 'wood' : wall, wallCol, x0, x1, zb, zf, y0 + h, rh);
  else if (roof === 'pyr') pyramidRoof(k, roofCol, (x0 + x1) / 2, (zb + zf) / 2, w + 0.5, depth + 0.5, y0 + h, rh);
  else box(k, 'stone', shade(P.stone, -0.1), x0 - 0.1, x1 + 0.1, y0 + h, y0 + h + 0.3, zb - 0.1, zf + 0.1, 0.6);
  // gutter along the front eave + a downpipe at one corner (ridge along X: the eave faces the street)
  if (roof === 'x' && rd() < 0.55) {
    const gz = zf + 0.31, gy = y0 + h - 0.05, px = rd() < 0.5 ? x0 + 0.1 : x1 - 0.1;
    k.b.add('metal', GEO.cyl8, M((x0 + x1) / 2, gy, gz, 0.1, w + 0.46, 0.1, 0, 0, Math.PI / 2), shade(P.metal, 0.25), 0.5);
    box(k, 'metal', shade(P.metal, 0.2), px - 0.035, px + 0.035, y0 + 0.08, gy - 0.02, zf + 0.06, zf + 0.13, 0.5);
    rbox(k, 'metal', shade(P.metal, 0.2), px, gy - 0.1, zf + 0.2, 0.07, 0.07, 0.26, 0, -0.6, 0, 0.5);
    box(k, 'metal', shade(P.metal, 0.1), px - 0.06, px + 0.06, y0, y0 + 0.08, zf + 0.06, zf + 0.22, 0.5);   // shoe
  }
  if (o.chimney) {
    const cx = x0 + w * (0.2 + r() * 0.6), cz = zb + depth * 0.35;
    box(k, 'brick', shade(P.brick, -0.1), cx - 0.25, cx + 0.25, y0 + h, y0 + h + rh + 0.6, cz - 0.25, cz + 0.25, 1.2);
    box(k, 'stone', shade(P.stone, -0.3), cx - 0.32, cx + 0.32, y0 + h + rh + 0.6, y0 + h + rh + 0.75, cz - 0.32, cz + 0.32, 0.6);
    // chimney pots on the cap (terracotta) — the smoke-stained crown of the stack
    const pots = k.quality < 2 ? 0 : rd() < 0.5 ? 1 : 2;
    for (let i = 0; i < pots; i++) {
      const px = pots === 1 ? cx : cx + (i ? 0.11 : -0.11);
      cyl(k, 'brick', shade('#b8603a', -0.1 * i), px, y0 + h + rh + 0.75, cz, 0.075, 0.24, 8, 0.6);
      cyl(k, 'metal', '#2a2026', px, y0 + h + rh + 0.985, cz, 0.06, 0.02, 8, 0.5);
    }
  }
  if (rich && masonry && h > 2.4 && rd() < 0.24) ivy(k, rd, x0, x1, zf, y0, h, wins);
}

/** Lintel / keystone, flower box, curtains and the light pool of a lit ground-floor window. */
function windowDress(k: Ctx, rd: () => number, x: number, y: number, zf: number, w: number, h: number,
  o: { lit: boolean; arch: boolean; masonry: boolean; wall: string; ground: boolean; y0: number; top: number }): void {
  const P = k.pal;
  if (o.masonry && !o.arch && y + h + 0.2 < o.top) {
    const lc = o.wall === 'brick' ? shade(P.stone, 0.18) : shade(P.stone, 0.05);
    box(k, 'stone', lc, x - w / 2 - 0.11, x + w / 2 + 0.11, y + h + 0.076, y + h + 0.17, zf - 0.02, zf + 0.05, 0.8);
    box(k, 'stone', shade(lc, 0.1), x - 0.065, x + 0.065, y + h + 0.06, y + h + 0.205, zf - 0.02, zf + 0.062, 0.8);
  }
  if (k.quality >= 2 && o.lit && !o.arch && rd() < 0.55) {   // curtains drawn to the sides: silhouettes in the warm glass
    const c = CURTAINS[Math.floor(rd() * CURTAINS.length)], cw = w * (0.18 + rd() * 0.1);
    for (const s of [-1, 1]) box(k, 'flat', c, x + s * (w / 2 - 0.03 - cw / 2) - cw / 2, x + s * (w / 2 - 0.03 - cw / 2) + cw / 2, y + 0.03, y + h - 0.03, zf + 0.027, zf + 0.034);
  }
  if (k.quality >= 2 && !o.arch && rd() < 0.26) {   // flower box under the sill
    const bx0 = x - w / 2 - 0.04, bx1 = x + w / 2 + 0.04, by1 = y - 0.106, by0 = by1 - 0.2;
    box(k, 'wood', shade(P.woodL, -0.15), bx0, bx1, by0, by1, zf + 0.004, zf + 0.21, 0.5);
    box(k, 'flat', '#3b2a22', bx0 + 0.03, bx1 - 0.03, by1 - 0.03, by1 + 0.008, zf + 0.03, zf + 0.19);
    const leaf = [P.leaf, P.leafD, shade(P.leaf, 0.18)], n = Math.max(2, Math.round((bx1 - bx0) / 0.22));
    for (let i = 0; i < n; i++) {
      const fx = bx0 + 0.08 + (bx1 - bx0 - 0.16) * (i + 0.5) / n, rr = 0.08 + rd() * 0.04;
      k.b.add('flat', IVY, M(fx, by1 + rr * 0.55, zf + 0.11 + (rd() - 0.5) * 0.06, rr * 1.6, rr * 1.4, rr * 1.3, rd(), rd() * 6, 0), leaf[Math.floor(rd() * 3)], 1);
      // trailing leaves over the front edge
      if (rd() < 0.5) k.b.add('flat', IVY, M(fx + (rd() - 0.5) * 0.08, by1 - 0.06, zf + 0.215 + rd() * 0.02, 0.09, 0.16, 0.06, 0, rd() * 6, 0), leaf[Math.floor(rd() * 3)], 1);
      for (let j = 0; j < 2; j++) k.b.add('flat', BLOOM, M(fx + (rd() - 0.5) * 0.14, by1 + rr * (1.0 + rd() * 0.4), zf + 0.08 + rd() * 0.08, 0.075, 0.075, 0.075, rd(), rd() * 3, 0), FLOWERS[Math.floor(rd() * FLOWERS.length)], 1);
    }
  }
  if (o.lit && o.ground) (k.pools ||= []).push(x, o.y0 + 0.05, zf + 0.85, 2.3, 1, 0.7, 0.38, 0.4);
}

/** Corner quoins: alternating long / short dressed stones up both front corners, wrapping 2.4 cm round each side. */
function quoins(k: Ctx, rd: () => number, x0: number, x1: number, zf: number, y0: number, h: number, wall: string, wallCol: string): void {
  const P = k.pal, col = wall === 'brick' ? shade(P.stone, 0.15) : wall === 'stone' ? shade(wallCol, 0.18) : shade(P.stone, 0.05);
  if (rd() < 0.5) return;   // not every house has dressed corners
  let i = 0;
  for (let y = y0 + 0.37; y + 0.25 < y0 + h - 0.13; y += 0.31, i++) {
    const L = i % 2 ? 0.125 : 0.195, c = shade(col, (rd() - 0.5) * 0.12);
    box(k, 'stone', c, x0 - 0.027, x0 + L, y, y + 0.27, zf - 0.32, zf + 0.024, 0.8);
    box(k, 'stone', c, x1 - L, x1 + 0.027, y, y + 0.27, zf - 0.32, zf + 0.024, 0.8);
  }
}

/** Ivy climbing a stretch of wall from the plinth: flattened leaf clusters, densest low, thinning upward, off the windows. */
function ivy(k: Ctx, rd: () => number, x0: number, x1: number, zf: number, y0: number, h: number, wins: [number, number, number, number][]): void {
  const P = k.pal, cols = [P.leafD, shade(P.leafD, -0.15), P.leaf, shade(P.leaf, -0.1)];
  const cw = 0.7 + rd() * 0.8, cx = x0 + 0.2 + rd() * Math.max(0.1, x1 - x0 - 0.4 - cw) + cw / 2, top = y0 + 0.5 + (h - 0.8) * (0.55 + rd() * 0.4);
  let n = 0;
  for (let y = y0 + 0.36; y < top && n < 46; y += 0.13) {
    const t = (y - y0) / (top - y0), half = cw / 2 * (1 - t * 0.65) + 0.05;
    for (let x = cx - half; x < cx + half && n < 46; x += 0.16) {
      const px = x + (rd() - 0.5) * 0.1, py = y + (rd() - 0.5) * 0.08;
      if (rd() < 0.25 + t * 0.35) continue;
      if (px < x0 + 0.03 || px > x1 - 0.03) continue;
      if (wins.some(([a, b, c, d]) => px > a - 0.04 && px < b + 0.04 && py > c && py < d)) continue;
      const s = 0.13 + rd() * 0.09;
      k.b.add('flat', IVY, M(px, py, zf + 0.06 + rd() * 0.025, s * 1.3, s, 0.07, rd() * 0.6, rd() * 6, 0), cols[Math.floor(rd() * cols.length)], 1);
      n++;
    }
  }
}

/** Scaffolding + «СКОРО» board for buildings under construction. */
function scaffolding(k: Ctx, x0: number, x1: number, zf: number, h: number): void {
  const P = k.pal, col = shade(P.woodL, -0.1);
  const n = Math.max(2, Math.round((x1 - x0) / 1.4));
  for (let i = 0; i <= n; i++) {
    const x = x0 + (x1 - x0) * i / n;
    box(k, 'wood', col, x - 0.05, x + 0.05, 0, h, zf + 0.55, zf + 0.65);
  }
  for (let y = 1.2; y < h; y += 1.4) {
    box(k, 'wood', col, x0 - 0.1, x1 + 0.1, y, y + 0.08, zf + 0.15, zf + 0.75, 0.5);   // planks
    box(k, 'wood', col, x0, x1, y + 0.7, y + 0.76, zf + 0.62, zf + 0.68);             // rail
  }
  for (let i = 0; i < n; i++) {   // diagonal braces
    const xa = x0 + (x1 - x0) * i / n, xb = x0 + (x1 - x0) * (i + 1) / n;
    const len = Math.hypot(xb - xa, 1.4);
    rbox(k, 'wood', col, (xa + xb) / 2, 0.7 + (i % 2) * 1.4, zf + 0.7, len, 0.06, 0.06, 0, 0, Math.atan2(1.4, xb - xa) * (i % 2 ? -1 : 1));
  }
  // «СКОРО» board leaning on the scaffold
  signF(k, 'СКОРО', (x0 + x1) / 2 + 0.3, 0.9, zf + 0.85, 1.4, { bg: '#d9a066', fg: '#6a2a5a' });
  // nobody walks through the poles / under the 1.2 m deck (the FP eye ended up inside the planks)
  (k.solids ||= []).push(x0 - 0.15, x1 + 0.15, zf, zf + 1.05, Infinity);
  k.colliders.push(x0 - 0.1, x1 + 0.1, 0, h, zf, zf + 0.75);
}

/* ---------------------------------------------------------------- per-id builders */

type BuildFn = (k: Ctx, b: Building, x0: number, x1: number, zf: number, h: number) => void;

/** A street sign with a gilded frame round the face (depth: the frame stands 1.7 cm proud of the face). */
export function signF(k: Ctx, text: string, x: number, y: number, zf: number, w: number, opts: Parameters<typeof signZ>[6] = {}): number {
  const h = signZ(k, text, x, y, zf, w, opts), g = '#c89a48', t = 0.034, z0 = zf + 0.093, z1 = zf + 0.125;
  box(k, 'metal', g, x - w / 2 - 0.02, x + w / 2 + 0.02, y - 0.02, y - 0.02 + t, z0, z1, 0.5);
  box(k, 'metal', g, x - w / 2 - 0.02, x + w / 2 + 0.02, y + h + 0.02 - t, y + h + 0.02, z0, z1, 0.5);
  box(k, 'metal', g, x - w / 2 - 0.02, x - w / 2 - 0.02 + t, y - 0.02 + t + 0.004, y + h + 0.02 - t - 0.004, z0, z1, 0.5);
  box(k, 'metal', g, x + w / 2 + 0.02 - t, x + w / 2 + 0.02, y - 0.02 + t + 0.004, y + h + 0.02 - t - 0.004, z0, z1, 0.5);
  return h;
}

const sign = (k: Ctx, b: Building, x: number, y: number, zf: number, w: number) => signF(k, b.title, x, y, zf, w, { sub: undefined });

const hall: BuildFn = (k, b, x0, x1, zf, h) => {
  const P = k.pal, tw = Math.min(1.5, (x1 - x0) * 0.38);
  const bx0 = x0 + tw - 0.1;
  const dx = toX(b.door.x);
  house(k, bx0, x1, zf, 5, h * 0.62, { wall: 'brick', roof: 'x', roofH: 1.8, door: false, lit: 0.6, floors: 2, noWin: [[dx - 0.65, dx + 0.65]] });
  // tower
  const tx0 = x0, tx1 = x0 + tw, th = h * 1.05;
  box(k, 'brick', shade(P.brick, 0.05), tx0, tx1, 0, th, zf - 4.2, zf + 0.25, 1.2);
  box(k, 'stone', shade(P.stone, -0.2), tx0 - 0.08, tx1 + 0.08, th - 0.2, th + 0.02, zf - 4.3, zf + 0.33, 0.6);   // cap 2 cm above the tower top
  for (let i = 0; i < 4; i++) box(k, 'stone', shade(P.stone, -0.2), tx0 + (tx1 - tx0) * i / 3.4, tx0 + (tx1 - tx0) * i / 3.4 + 0.22, th + 0.02, th + 0.3, zf + 0.05, zf + 0.32);
  pyramidRoof(k, P.roof, (tx0 + tx1) / 2, zf - 2, tw + 0.5, 4.6, th + 0.3, 2.4);
  (k.solids ||= []).push(tx0 - 0.1, tx1 + 0.1, zf - 4.3, zf + 0.45, Infinity);   // the tower stands 25 cm proud of the facade line
  flag(k, (tx0 + tx1) / 2, th + 2.6, zf - 2, 1.2, P.flag);
  // clock
  const cxk = (tx0 + tx1) / 2, cy = th - 1.1;
  k.b.add('stone', GEO.cyl16, M(cxk, cy, zf + 0.3, 1.0, 0.12, 1.0, Math.PI / 2, 0, 0), P.line, 1);
  k.b.add('emit', GEO.cyl16, M(cxk, cy, zf + 0.37, 0.86, 0.04, 0.86, Math.PI / 2, 0, 0), '#d6c49a', 1);   // clock face: lit, not a lamp
  rbox(k, 'metal', P.line, cxk, cy + 0.15, zf + 0.41, 0.05, 0.32, 0.03);
  rbox(k, 'metal', P.line, cxk + 0.1, cy, zf + 0.41, 0.24, 0.05, 0.03);
  windowZ(k, cxk, th * 0.45, zf + 0.25, 0.5, 1.0, true, { arch: true });
  // grand door + steps
  doorZ(k, dx, 0, zf, 1.1, 2.1, { arch: true, color: '#5a3a28' });
  box(k, 'stone', shade(P.stone, 0.1), dx - 1.0, dx + 1.0, 0, 0.12, zf, zf + 0.55, 0.6);
  sign(k, b, (bx0 + x1) / 2, h * 0.62 - 1.0, zf, Math.min(2.6, x1 - bx0 - 0.4));
  flag(k, x1 - 0.3, h * 0.62 + 1.8, zf - 2.5, 0.9, P.flag);
};

const auction: BuildFn = (k, b, x0, x1, zf, h) => {
  const P = k.pal, bh = h * 0.6;
  const adx = toX(b.door.x);
  house(k, x0 + 0.2, x1 - 0.2, zf - 0.8, 5, bh, { wall: 'plaster', roof: 'z', roofH: 1.5, door: false, lit: 0.5, floors: 1, noWin: [[adx - 0.6, adx + 0.6]] });
  // portico: columns + entablature + pediment
  const n = 4;
  for (let i = 0; i < n; i++) {
    const cx = x0 + 0.5 + (x1 - x0 - 1.0) * i / (n - 1);
    cyl(k, 'plaster', '#efe6d2', cx, 0.15, zf - 0.1, 0.17, bh - 0.35, 12);
    box(k, 'stone', '#e2d6bc', cx - 0.25, cx + 0.25, 0, 0.15, zf - 0.35, zf + 0.15, 0.6);
    box(k, 'stone', '#e2d6bc', cx - 0.25, cx + 0.25, bh - 0.3, bh - 0.2, zf - 0.35, zf + 0.15, 0.6);
  }
  box(k, 'plaster', '#efe6d2', x0 + 0.1, x1 - 0.1, bh - 0.2, bh + 0.25, zf - 0.85, zf + 0.2);
  gableRoofZ(k, P.roof, 'plaster', P.plaster, x0 + 0.1, x1 - 0.1, zf - 0.85, zf + 0.2, bh + 0.25, 1.0, 0.2);   // ridge below the hall's ridge cap
  box(k, 'stone', '#e2d6bc', x0, x1, 0, 0.12, zf - 0.9, zf + 0.35, 0.6);
  doorZ(k, adx, 0.12, zf - 0.8, 0.95, 1.9, { arch: false, color: '#6e3a2a' });
  signF(k, b.title, (x0 + x1) / 2, bh - 0.05, zf + 0.2, 2.0);
  // gavel ornament on the ridge
  rbox(k, 'wood', P.woodD, (x0 + x1) / 2, bh + 1.6, zf - 1.5, 0.08, 0.6, 0.08);
  rbox(k, 'wood', P.wood, (x0 + x1) / 2, bh + 1.95, zf - 1.5, 0.45, 0.2, 0.2);
  if (b.soon) scaffolding(k, x0 + 0.2, x1 - 0.2, zf - 0.8, bh);
};

const trainer: BuildFn = (k, b, x0, x1, zf, h) => {
  const P = k.pal, bh = h * 0.6;
  const dx = toX(b.door.x);
  house(k, x0, x1, zf, 5, bh, { wall: 'plaster', roof: 'x', roofH: 1.8, door: false, lit: 0.5, floors: 1, timber: true, noWin: [[dx - 0.6, dx + 0.6]] });
  doorZ(k, dx, 0, zf, 1.0, 2.0, { arch: true, open: true, glow: '#b8682a' });
  // target boards on the facade
  for (const tx of [x0 + 0.6, x1 - 0.6]) {
    for (let i = 0; i < 3; i++) k.b.add('flat', GEO.cyl16, M(tx, bh * 0.55, zf + 0.12 + i * 0.025, 0.7 - i * 0.22, 0.03, 0.7 - i * 0.22, Math.PI / 2, 0, 0), i % 2 ? '#f5f2e8' : '#d8433a', 1);
  }
  // crossed swords above the ridge
  for (const s of [1, -1]) {
    rbox(k, 'metal', '#c8c8d8', (x0 + x1) / 2, bh + 2.1, zf - 2.2, 0.08, 1.3, 0.04, 0, 0, s * 0.6);
    rbox(k, 'wood', P.woodD, (x0 + x1) / 2 - s * 0.32, bh + 1.6, zf - 2.2, 0.3, 0.07, 0.07, 0, 0, s * 0.6);
  }
  signF(k, b.title, (x0 + x1) / 2, bh - 0.75, zf, 1.9);
};

const board: BuildFn = (k, b, x0, x1, zf, h) => {
  const P = k.pal, cx = (x0 + x1) / 2, w = (x1 - x0) * 0.85, bz = zf + 0.4;
  const top = Math.min(3.4, h * 0.9);
  for (const px of [cx - w / 2, cx + w / 2]) box(k, 'wood', P.woodD, px - 0.1, px + 0.1, 0, top, bz - 0.1, bz + 0.1, 0.6);
  box(k, 'wood', P.wood, cx - w / 2 + 0.1, cx + w / 2 - 0.1, 0.8, top - 0.5, bz - 0.06, bz + 0.02, 0.6);
  box(k, 'wood', P.woodD, cx - w / 2 - 0.01, cx + w / 2 + 0.01, 0.72, 0.82, bz - 0.11, bz + 0.11);
  box(k, 'wood', P.woodD, cx - w / 2 - 0.01, cx + w / 2 + 0.01, top - 0.55, top - 0.45, bz - 0.11, bz + 0.11);
  gableRoof(k, P.roof, 'wood', P.wood, cx - w / 2 - 0.1, cx + w / 2 + 0.1, bz - 0.3, bz + 0.3, top, 0.6, 0.25, true);
  const r = k.rnd;
  for (let i = 0; i < 9; i++) {
    const px = cx - w / 2 + 0.45 + (w - 0.9) * (i % 3 + r() * 0.3) / 2.6, py = 1.05 + (top - 1.9) * (Math.floor(i / 3) + r() * 0.2) / 2.4;
    rbox(k, 'flat', r() < 0.2 ? '#fff2b8' : '#f2e2b4', px, py + 0.2, bz + 0.03 + i * 0.007, 0.45 + r() * 0.12, 0.5 + r() * 0.15, 0.01, 0, 0, (r() - 0.5) * 0.25);
    ball(k, 'flat', '#d8433a', px, py + 0.42, bz + 0.1, 0.03);
  }
  signF(k, b.title, cx, top - 0.42, bz + 0.12, Math.min(2.4, w - 0.4));
  box(k, 'stone', shade(P.stone, -0.1), cx - w / 2 - 0.3, cx + w / 2 + 0.3, 0, 0.1, bz - 0.5, bz + 0.5, 0.6);
  (k.solids ||= []).push(cx - w / 2 - 0.3, cx + w / 2 + 0.3, bz - 0.5, bz + 0.5, 0.1);   // the plinth is a step: feet on it, not in it
  // back houses behind the board
  house(k, x0, x1, zf - 1.2, 4, h * 0.95, { wall: 'brick', roof: 'x', lit: 0.4, door: false });
};

const anvil: BuildFn = (k, b, x0, x1, zf, h) => {
  // open forge shed: back wall, posts, shed roof, hearth with coals, anvil, sign
  const P = k.pal, zFront = zf + 1.3, zb = zf - 1.8, rh = Math.min(3.0, h * 0.75);
  box(k, 'brick', P.brick, x0, x1, 0, rh + 0.6, zb - 0.3, zb, 1.2);
  box(k, 'brick', P.brick, x0, x0 + 0.25, 0, rh + 0.3, zb, zFront - 0.5, 1.2);
  for (const px of [x0 + 0.15, x1 - 0.15]) box(k, 'wood', P.woodD, px - 0.1, px + 0.1, 0, rh, zFront - 0.1, zFront + 0.1, 0.6);
  // shed roof: high at the back
  const d = zFront - zb + 0.6;
  k.b.add('roof', GEO2.shed, M((x0 + x1) / 2, rh, (zFront + zb) / 2 + 0.15, x1 - x0 + 0.4, 0.7, d), '#d9774f', [3, 2]);
  k.b.add('flat', GEO2.shed, M((x0 + x1) / 2, rh - 0.07, (zFront + zb) / 2 + 0.15, x1 - x0 + 0.4, 0.7, d), '#5a2a1a', 1);
  {   // eave board + rake boards close the 7 cm slot between the slope and its underside (no see-through edge)
    const zc = (zFront + zb) / 2 + 0.15, sw = x1 - x0 + 0.4, ang = Math.atan2(0.7, d), sl = Math.hypot(0.7, d);
    box(k, 'wood', '#5a2a1a', (x0 + x1) / 2 - sw / 2 + 0.006, (x0 + x1) / 2 + sw / 2 - 0.006, rh - 0.083, rh + 0.017, zc + d / 2 - 0.023, zc + d / 2 + 0.023, 0.5);
    for (const s of [-1, 1]) rbox(k, 'wood', '#5a2a1a', (x0 + x1) / 2 + s * (sw / 2 - 0.017), rh + 0.35 - 0.033, zc, 0.046, 0.1, sl - 0.012, 0, ang, 0, 0.5);
  }
  box(k, 'wood', P.woodD, x0, x1, rh - 0.18, rh, zFront - 0.11, zFront + 0.11, 0.6);   // beam 1 cm proud of the posts
  // hearth
  const hx = x0 + 0.9;
  box(k, 'stone', '#6e5a5a', hx - 0.6, hx + 0.6, 0, 0.9, zb, zb + 1.0, 0.6);
  box(k, 'emit', '#ff7a2a', hx - 0.45, hx + 0.45, 0.9, 0.98, zb + 0.15, zb + 0.85);
  box(k, 'brick', shade(P.brick, -0.25), hx - 0.35, hx + 0.35, 0.98, rh + 1.6, zb + 0.1, zb + 0.7, 1.2);
  k.glows.push(hx, 1.2, zb + 0.7, 2.6, 1, 0.45, 0.15);
  k.lights.push(hx, 1.4, zb + 1.2);
  // anvil
  const ax = (x0 + x1) / 2 + 0.3, az = zFront - 0.6;
  box(k, 'wood', P.woodD, ax - 0.2, ax + 0.2, 0, 0.45, az - 0.2, az + 0.2, 0.5);
  box(k, 'metal', '#4a4658', ax - 0.12, ax + 0.12, 0.45, 0.62, az - 0.1, az + 0.1);
  box(k, 'metal', '#5a566a', ax - 0.32, ax + 0.28, 0.62, 0.78, az - 0.14, az + 0.14);
  rbox(k, 'metal', '#5a566a', ax + 0.36, 0.72, az, 0.2, 0.08, 0.1, 0, 0, -0.2);
  // tools on the back wall
  for (let i = 0; i < 3; i++) {
    rbox(k, 'wood', P.woodD, x1 - 0.5 - i * 0.3, 1.6, zb + 0.05, 0.05, 0.6, 0.04);
    rbox(k, 'metal', '#4a4658', x1 - 0.5 - i * 0.3, 1.95, zb + 0.06, 0.2, 0.12, 0.05);
  }
  signF(k, b.title, (x0 + x1) / 2, rh - 0.75, zFront + 0.15, Math.min(1.9, x1 - x0 - 0.3), { hang: false });
};

const forge: BuildFn = (k, b, x0, x1, zf, h) => {
  // small forges (camp «Перепутье»: 4 m wide, low hit box) keep a wall tall enough for the door + sign above it
  const P = k.pal, bh = Math.max(3.25, h * 0.55), w = x1 - x0;
  h = Math.max(h, bh + 1.3);
  box(k, 'wood', P.woodL, x0, x1, 0, bh, zf - 5, zf, 1.0);
  box(k, 'stone', shade(P.stone, -0.25), x0 - 0.05, x1 + 0.05, -0.3, 0.4, zf - 5.05, zf + 0.045, 0.8);
  timberZ(k, x0 + 0.05, x1 - 0.05, 0.4, bh - 0.05, zf, 3, P.woodD);
  // big asymmetric roof (two tones), ridge along Z
  gableRoofZ(k, '#e3b07a', 'wood', P.woodL, x0, x1, zf - 5, zf, bh, h - bh, 0.45);
  // two arched openings: glowing forge mouth + door
  // the forge mouth goes on the side of the door with more room, never overlapping it (narrow camp forge)
  const dx = toX(b.door.x), leftRoom = dx - x0, rightRoom = x1 - dx;
  let mx = x0 + w * 0.3;
  if (Math.abs(mx - dx) < 1.25) mx = leftRoom >= rightRoom ? Math.max(x0 + 0.7, dx - 1.3) : Math.min(x1 - 0.7, dx + 1.3);
  const mouth = Math.abs(mx - dx) >= 1.15;
  if (mouth) doorZ(k, mx, 0, zf, 1.1, 1.9, { arch: true, open: true, glow: '#c84a1a' });
  doorZ(k, dx, 0, zf, 0.9, 1.8, { arch: true, color: '#4a2c1e' });
  if (mouth) k.lights.push(mx, 1.0, zf + 0.8);
  windowZ(k, (x0 + x1) / 2, bh + 0.6, zf + 0.0, 0.7, 0.8, true, { arch: true });
  signF(k, b.title, (x0 + x1) / 2, Math.max(bh - 1.15, 2.35), zf + 0.02, Math.min(3.0, w - 0.5));   // always above the arched door (≈2.3 m)
  // «ХРУПКОЕ» stamp and paw emblem
  rbox(k, 'flat', '#c83a3a', x0 + w * 0.62, bh * 0.82, zf + 0.04, 0.7, 0.24, 0.02, 0, 0, -0.15);
  // chimney with glow
  const cx = x1 - 0.8;
  box(k, 'brick', P.brick, cx - 0.35, cx + 0.35, bh, h + 0.8, zf - 3.2, zf - 2.5, 1.2);
  box(k, 'stone', '#3a2a2a', cx - 0.42, cx + 0.42, h + 0.8, h + 1.0, zf - 3.27, zf - 2.43);
  k.glows.push(cx, h + 1.2, zf - 2.85, 1.6, 1, 0.5, 0.2);
  wallLamp(k, x1 - 0.25, 2.2, zf);
};

const gate: BuildFn = (k, b, x0, x1, zf, h) => {
  // City gate (the exit to expeditions): a red-brick gatehouse with an arched passage glowing pink-violet inside,
  // a steep purple gable roof facing the street, two buttress turrets with cone roofs and pennants.
  const P = k.pal, w = x1 - x0, cx = (x0 + x1) / 2;
  const bx0 = x0 + 0.35, bx1 = x1 - 0.35, bw = bx1 - bx0, bh = Math.min(4.2, h * 0.62), depth = 3.2;
  const ow = Math.min(1.8, bw * 0.48), oh = 2.7;
  // front + back walls with the arched hole, side walls, passage walls/ceiling
  const wall = archWallGeo(bw, bh, ow, oh);
  k.b.add('brick', wall, M(cx, 0, zf - 0.2, 1, 1, 0.4), P.brick, 1.2);
  k.b.add('brick', wall, M(cx, 0, zf - depth + 0.2, 1, 1, 0.4), shade(P.brick, -0.1), 1.2);
  wall.dispose();
  box(k, 'brick', P.brick, bx0 + 0.01, bx0 + 0.4, 0, bh - 0.01, zf - depth + 0.01, zf - 0.01, 1.2);   // inset 1 cm: hidden in the arch walls
  box(k, 'brick', P.brick, bx1 - 0.4, bx1 - 0.01, 0, bh - 0.01, zf - depth + 0.01, zf - 0.01, 1.2);
  box(k, 'brick', shade(P.brick, -0.35), bx0 + 0.4, cx - ow / 2, 0, bh, zf - depth + 0.4, zf - 0.4, 1.2);
  box(k, 'brick', shade(P.brick, -0.35), cx + ow / 2, bx1 - 0.4, 0, bh, zf - depth + 0.4, zf - 0.4, 1.2);
  box(k, 'stone', shade(P.stone, -0.4), cx - ow / 2, cx + ow / 2, oh, bh, zf - depth + 0.4, zf - 0.4, 0.7);
  // stone arch voussoirs around the opening (ring of small boxes)
  const R = ow / 2 + 0.12, ycen = oh - ow / 2;
  for (let i = 0; i <= 8; i++) {
    const a = Math.PI * i / 8;
    rbox(k, 'stone', i === 4 ? '#ffcf4a' : shade(P.stone, 0.35), cx + Math.cos(a) * R, ycen + Math.sin(a) * R, zf + 0.03, 0.3, 0.22, 0.12, 0, 0, a - Math.PI / 2, 0.6);
  }
  for (const s of [-1, 1]) box(k, 'stone', shade(P.stone, 0.35), cx + s * (ow / 2 + 0.12) - 0.13, cx + s * (ow / 2 + 0.12) + 0.13, 0, ycen, zf - 0.05, zf + 0.07, 0.6);
  // the portal inside: dim violet-pink veil at the back + floor glow
  k.b.add('emit', GEO2.arch, M(cx, 0, zf - depth + 0.45, ow, oh, 0.02), '#6a2a8a', 1);
  box(k, 'emit', '#4a2266', cx - ow / 2, cx + ow / 2, 0.005, 0.02, zf - depth + 0.45, zf - 0.4);
  k.glows.push(cx, oh * 0.45, zf - depth + 0.9, ow * 1.6, 0.45, 0.2, 0.55);
  k.lights.push(cx, 1.4, zf + 0.6);
  // plinth, cornice, steep gable roof facing the street
  box(k, 'stone', shade(P.stone, -0.2), bx0 - 0.05, bx1 + 0.05, -0.3, 0.35, zf - depth - 0.05, zf + 0.06, 0.8);
  box(k, 'wood', P.woodD, bx0 - 0.1, bx1 + 0.1, bh - 0.14, bh + 0.02, zf - depth - 0.1, zf + 0.12);
  gableRoofZ(k, P.roof, 'brick', P.brick, bx0, bx1, zf - depth, zf, bh, Math.max(2.2, h - bh - 0.3), 0.35);
  windowZ(k, cx, bh + 0.35, zf + 0.0, 0.5, 0.8, true, { arch: true });
  // buttress turrets
  for (const tx of [x0 + 0.3, x1 - 0.3]) {
    cyl(k, 'brick', shade(P.brick, 0.08), tx, 0, zf - 0.3, 0.42, bh + 0.6, 12, 1.2);
    box(k, 'stone', shade(P.stone, 0.1), tx - 0.5, tx + 0.5, bh + 0.6, bh + 0.75, zf - 0.8, zf + 0.2, 0.6);
    cone(k, 'roof', P.roof2, tx, bh + 0.75, zf - 0.3, 0.6, 1.5);
    flag(k, tx, bh + 2.2, zf - 0.3, 0.8, P.flag);
    windowZ(k, tx, bh - 1.1, zf + 0.11, 0.22, 0.5, true, { arch: true });
  }
  signF(k, b.title, cx, oh + 0.25, zf + 0.06, Math.min(1.9, bw - 0.6));
  for (const s of [-1, 1]) wallLamp(k, cx + s * (ow / 2 + 0.55), 2.3, zf);
  void w;
};

const tent: BuildFn = (k, b, x0, x1, zf, h) => {
  const P = k.pal, cx = (x0 + x1) / 2, R = Math.min(2.7, (x1 - x0) / 2 - 0.1), cz = zf - R + 0.6;
  const wallH = h * 0.32, roofH = h * 0.62;
  const segs = 16;
  const wall = stripeColors(new THREE.CylinderGeometry(R, R * 1.03, wallH, 32, 1, true), P.tent, P.tent2, segs);
  k.b.add('canvas', wall, M(cx, wallH / 2, cz), null, [10, 2]);
  const roof = stripeColors(new THREE.ConeGeometry(R * 1.12, roofH, 32, 3, true), P.tent, P.tent2, segs);
  k.b.add('canvas', roof, M(cx, wallH + roofH / 2, cz), null, [10, 4]);
  wall.dispose(); roof.dispose();
  // scalloped rim
  for (let i = 0; i < 24; i++) {
    const a = i / 24 * Math.PI * 2;
    k.b.add('canvas', GEO.sphere, M(cx + Math.cos(a) * R * 1.1, wallH - 0.05, cz + Math.sin(a) * R * 1.1, 0.5, 0.3, 0.12, 0, -a + Math.PI / 2, 0), i % 2 ? P.tent : P.tent2, 1);
  }
  // cat ears on the roof
  for (const s of [-1, 1]) {
    const a = Math.PI / 2 - s * 0.75, rr = R * 1.12 * 0.62;   // on the cone surface, front-left / front-right
    k.b.add('canvas', GEO.cone16, M(cx + Math.cos(a) * rr, wallH + roofH * 0.42, cz + Math.sin(a) * rr, 0.9, 1.2, 0.5, 0.25, -s * 0.75 * 0 + (Math.PI / 2 - a), -s * 0.45), P.tent, 1);
    k.b.add('flat', GEO.cone16, M(cx + Math.cos(a) * (rr + 0.12), wallH + roofH * 0.42 - 0.05, cz + Math.sin(a) * (rr + 0.12), 0.5, 0.75, 0.2, 0.25, (Math.PI / 2 - a), -s * 0.45), '#ffb0c8', 1);
  }
  ball(k, 'metal', '#ffcf4a', cx, wallH + roofH + 0.1, cz, 0.18);
  flag(k, cx, wallH + roofH + 0.2, cz, 1.0, P.flag);
  // entrance vestibule with drapes
  const ez = cz + R, ew = 1.4;
  box(k, 'canvas', P.tent2, cx - ew / 2 - 0.1, cx + ew / 2 + 0.1, 0, 2.3, ez - 0.3, ez + 0.6);
  box(k, 'emit', '#b8603a', cx - ew / 2 + 0.15, cx + ew / 2 - 0.15, 0, 1.75, ez + 0.6, ez + 0.62);
  k.b.add('canvas', GEO2.gable, M(cx, 2.3, ez + 0.15, ew + 0.6, 0.7, 1.2, 0, Math.PI / 2, 0), P.tent, 1);
  for (const s of [-1, 1]) rbox(k, 'canvas', P.tent, cx + s * (ew / 2 - 0.05), 1.1, ez + 0.68, 0.35, 2.2, 0.06, 0, 0, s * 0.12);
  cyl(k, 'wood', '#6a3a4a', cx, 0, cz, R * 1.05, 0.16, 16, 0.6);
  k.glows.push(cx, 1.0, ez + 0.9, 1.5, 0.8, 0.5, 0.3);
  k.lights.push(cx, 1.5, ez + 1.2);
  signF(k, b.title, cx, 1.85, ez + 0.66, 1.3);
  // pennant strings from the top to the ground poles
  for (const s of [-1, 1]) {
    const px = cx + s * (R + 0.6), pz = cz + R * 0.3;
    cyl(k, 'wood', P.woodD, px, 0, pz, 0.06, 2.6, 8);
    k.wires.push(cx, wallH + roofH * 0.9, cz, px, 2.6, pz);
  }
};

const shop: BuildFn = (k, b, x0, x1, zf, h) => {
  // Market rows: back house row + a long beam with the sign + N striped stalls protruding to the street.
  const P = k.pal, w = x1 - x0;
  const zStall = zf + 2.2;
  // back row of houses
  let x = x0;
  while (x < x1 - 0.5) {
    const hw = Math.min(x1 - x, 2.2 + k.rnd() * 1.4);
    house(k, x + 0.05, x + hw - 0.05, zf - 1.2, 4, 3.6 + k.rnd() * 1.6, { wall: k.rnd() < 0.5 ? 'brick' : 'plaster', lit: 0.5, door: false, roofCol: k.rnd() < 0.5 ? P.roof : P.roof2 });
    x += hw;
  }
  // stalls
  const n = Math.max(1, Math.floor(w / 3.4));
  const sw = w / n;
  const names = ['Валерьянка', 'Молоко', 'Рыба', 'Колбаса', 'Сыр', 'Зелья', 'Травы', 'Мёд'];
  for (let i = 0; i < n; i++) {
    const s0 = x0 + i * sw + 0.25, s1 = x0 + (i + 1) * sw - 0.25, sc = (s0 + s1) / 2;
    const col = P.awnings[i % P.awnings.length];
    // counter
    box(k, 'wood', P.woodL, s0, s1, 0, 0.95, zStall - 0.7, zStall, 0.6);
    box(k, 'wood', P.woodD, s0 - 0.05, s1 + 0.05, 0.95, 1.05, zStall - 0.75, zStall + 0.08);
    (k.solids ||= []).push(s0 - 0.05, s1 + 0.05, zStall - 0.75, zStall + 0.08, 1.05);   // counter top: jump onto it
    // posts
    for (const px of [s0, s1]) for (const pz of [zStall - 1.6, zStall]) {
      box(k, 'wood', P.woodD, px - 0.07, px + 0.07, 0, 2.5, pz - 0.07, pz + 0.07, 0.5);
      (k.solids ||= []).push(px - 0.08, px + 0.08, pz - 0.08, pz + 0.08, Infinity);
    }
    awning(k, s0 - 0.15, s1 + 0.15, 2.75, zStall - 1.7, 1.95, col, '#f5ead2');
    // goods: little jars/boxes/fish on the counter
    for (let j = 0; j < 5; j++) {
      const gx = s0 + 0.3 + (s1 - s0 - 0.6) * j / 4;
      if (j % 2) ball(k, 'flat', ['#7fc8ff', '#ffcf4a', '#ff8fa3', '#9be07a'][(i + j) % 4], gx, 1.13, zStall - 0.3, 0.09);
      else box(k, 'flat', ['#f5ead2', '#c8664a', '#7fb0e8'][(i + j) % 3], gx - 0.1, gx + 0.1, 1.05, 1.28, zStall - 0.4, zStall - 0.2);
    }
    signF(k, names[i % names.length], sc, 1.95, zStall - 1.62, Math.min(1.7, s1 - s0 - 0.2));
    // a low display footboard along the counter front with baskets of goods: the site's grid keeps a strip in front
    // of the stalls blocked — now something stands there (no invisible wall)
    box(k, 'wood', shade(P.woodD, 0.08), s0 - 0.02, s1 + 0.02, 0, 0.14, zStall + 0.085, zStall + 0.66, 0.5);
    box(k, 'wood', shade(P.woodD, -0.2), s0 - 0.03, s1 + 0.03, 0, 0.05, zStall + 0.66, zStall + 0.7, 0.5);   // kick board
    for (let j = 0; j < 2; j++) {
      const bx = s0 + 0.35 + (s1 - s0 - 0.7) * j, gc = ['#e8c45a', '#d8433a', '#9be07a', '#ffb070'][(i + j) % 4];
      cyl(k, 'wood', shade(P.woodL, -0.2), bx, 0.14, zStall + 0.42, 0.13, 0.13, 8, 0.4);
      for (let q = 0; q < 3; q++) k.b.add('flat', IVY, M(bx + (q - 1) * 0.065, 0.3, zStall + 0.42 + (q % 2 ? 0.04 : -0.03), 0.11, 0.11, 0.11, q, q * 2, 0), gc, 1);
    }
    k.lights.push(sc, 2.2, zStall + 0.3);
    k.glows.push(sc, 2.25, zStall - 0.2, 1.4, 1, 0.8, 0.45);
    box(k, 'emit', '#ffcf6a', sc - 0.08, sc + 0.08, 2.15, 2.35, zStall - 0.28, zStall - 0.12);
  }
  // big beam with the main sign
  const by = 4.4;
  for (const px of [x0 + 0.15, x1 - 0.15]) box(k, 'wood', P.wood, px - 0.12, px + 0.12, 0, by + 0.4, zStall - 2.0, zStall - 1.76, 0.6);
  box(k, 'wood', P.woodD, x0, x1, by, by + 0.22, zStall - 1.98, zStall - 1.78, 0.6);
  signF(k, b.title, (x0 + x1) / 2, by + 0.25, zStall - 1.95, 3.6, { bg: '#2a4a8a' });
  for (let i = 0; i < 6; i++) {   // garland under the beam
    const gx0 = x0 + w * i / 6, gx1 = x0 + w * (i + 1) / 6;
    k.wires.push(gx0, by, zStall - 1.85, gx1, by, zStall - 1.85);
  }
};

const magic: BuildFn = (k, b, x0, x1, zf, h) => {
  // Stargazer tower: stone base, wooden octagonal body on struts, tall purple cone roof, telescope, star
  const P = k.pal, cx = (x0 + x1) / 2, cz = zf - 1.3, R = Math.min(1.2, (x1 - x0) / 2 - 0.05);
  cyl(k, 'stone', '#8b7f8f', cx, 0, cz, R, 2.4, 12, 0.7);
  box(k, 'stone', '#6e6272', cx - R - 0.1, cx + R + 0.1, 2.3, 2.5, cz - R - 0.1, cz + R + 0.1, 0.7);
  doorZ(k, toX(b.door.x), 0, cz + R - 0.1, 0.8, 1.7, { arch: true, color: '#3a2a5a' });
  cyl(k, 'wood', P.wood, cx, 2.5, cz, R * 0.9, h * 0.42, 8, 0.6);
  for (let i = 0; i < 3; i++) {
    const a = (i - 1) * 0.6;
    const wx = cx + Math.sin(a) * R * 0.92, wz = cz + Math.cos(a) * R * 0.92;
    k.b.add('emit', GEO2.arch, M(wx, 2.5 + h * 0.15, wz, 0.32, 0.6, 0.06, 0, a, 0), '#c8a8ff', 1);
    k.glows.push(wx, 2.5 + h * 0.2, wz + 0.2, 1.0, 0.75, 0.6, 1);
  }
  const ry = 2.5 + h * 0.42;
  box(k, 'wood', P.woodD, cx - R - 0.2, cx + R + 0.2, ry, ry + 0.15, cz - R - 0.2, cz + R + 0.2, 0.5);
  cone(k, 'roof', '#594057', cx, ry + 0.15, cz, R * 1.25, h * 0.45, false);
  k.b.add('emit', GEO.sphere, M(cx, ry + 0.15 + h * 0.45 + 0.2, cz, 0.35, 0.35, 0.12), '#ffe39a', 1);
  k.glows.push(cx, ry + 0.15 + h * 0.45 + 0.2, cz, 1.6, 1, 0.9, 0.6);
  // telescope poking out
  rbox(k, 'metal', '#b08a3a', cx + R * 0.6, ry - 0.4, cz + 0.4, 0.18, 1.2, 0.18, 0, 0, -0.9);
  rbox(k, 'metal', '#5a4a7a', cx + R * 0.6 + 0.4, ry - 0.1, cz + 0.4, 0.24, 0.3, 0.24, 0, 0, -0.9);
  signF(k, b.title, cx, 2.6, cz + R + 0.02, Math.min(2.6, (x1 - x0) + 0.4));
  // little stars hanging
  for (let i = 0; i < 4; i++) k.glows.push(cx - R + i * R * 0.66, 2.3, cz + R + 0.4, 0.5, 0.8, 0.7, 1);
};

/* lower-street buildings set into the retaining wall: lowstreet.ts */
const mine: BuildFn = (k, b, x0, x1) => lowMine(k, b, x0, x1);
const mineboard: BuildFn = (k, b, x0, x1) => lowMineboard(k, b, x0, x1);
const storage: BuildFn = (k, b, x0, x1) => lowStorage(k, b, x0, x1);

/** Generic fallback for unknown ids: a house with the site title on a sign (new site buildings appear automatically). */
const generic: BuildFn = (k, b, x0, x1, zf, h) => {
  const dx = toX(b.door.x);
  house(k, x0, x1, zf, 4.5, Math.max(2.6, h * 0.6), { wall: 'plaster', lit: 0.6, door: false, noWin: [[dx - 0.55, dx + 0.55]] });
  doorZ(k, dx, 0, zf, 0.9, 1.8, { arch: true });
  signF(k, b.title, (x0 + x1) / 2, Math.max(2.6, h * 0.6) - 0.9, zf, Math.min(2.2, x1 - x0 - 0.3));
};

export interface BuildingModel {
  build: BuildFn;
  /** Front of the camera collider / solid footprint, metres in front of the facade line zf (upper street). */
  front?: number;
  /** Front of the Infinity solid footprint if it differs (the builder adds finite solids in front, e.g. counters). */
  solidFront?: number;
  /** Door hit volume (interactables): half-width and height (m) of the opening. */
  door?: { hw?: number; h?: number };
}

/**
 * Street models by site building id. Add a building = one builder + one line here (and `npm run drift` stops
 * reporting it). Unknown ids fall back to `generic` (upper street) or the lower-street barn (`storage`) with the
 * site's title on the sign. The list of ids is mirrored in supported.ts (checked by test/world-models.test.ts).
 */
export const BUILDING_MODELS: Record<string, BuildingModel> = {
  hall: { build: hall }, auction: { build: auction }, trainer: { build: trainer }, board: { build: board, front: 0.5 },
  anvil: { build: anvil, front: 1.4 }, forge: { build: forge }, gate: { build: gate }, tent: { build: tent, front: 1.2 },
  shop: { build: shop, front: 2.4, solidFront: 1.45, door: { hw: 1.3, h: 2.6 } }, magic: { build: magic },
  mine: { build: mine, door: { hw: 0.95, h: 2.3 } }, mineboard: { build: mineboard, door: { hw: 0.5, h: 2.1 } },
  storage: { build: storage, door: { hw: 0.85, h: 2.1 } },
  jail: { build: (k, b) => buildJail(k, b), door: { hw: 0.5, h: 2.0 } },
};
const GENERIC: BuildingModel = { build: generic };
const GENERIC_LOW: BuildingModel = { build: storage };

/** The model used for a building (by id; generic fallbacks). */
export function modelOf(b: Building): BuildingModel {
  return BUILDING_MODELS[b.id] ?? (isUpper(b) ? GENERIC : GENERIC_LOW);
}

/** Depth offset (m, ≤ 0) of a building's street model: on layouts other than the fair (camp, district towns) the site's
 *  walk grid may allow walking right in front of a facade where the fair model projects (tent, shop, anvil), so the
 *  model is moved back until its solid front clears the first walkable row (src/world/static.ts fitFronts). */
export const BUILDING_DZ = new WeakMap<Building, number>();
/** A building built away from the back row (hand villages, src/world/village.ts buildDeepBuilding): its virtual back-row
 *  twin, the depth map of the model (source z → world z) and the scale — door hit boxes follow (entranceZ, worldExt.ts). */
export const BUILDING_XF = new WeakMap<Building, { virt: Building; z: (z: number) => number; s: number }>();
/** Estimated solid front (m) of a building's model at dz = 0 (attachments up to +0.3 m). */
export function solidFrontOf(b: Building): number {
  const m = modelOf(b), f = -0.15 + (m.solidFront ?? m.front ?? 0) + 0.3;
  // a «soon» hall has the scaffolding in front (its solid reaches 1.05 m out, scaffolding())
  return b.soon && b.id === 'hall' ? Math.max(f, -0.15 + 1.05) : f;
}

export function buildBuilding(k: Ctx, b: Building): void {
  const x0 = toX(b.hit[0]), x1 = toX(b.hit[1]);
  const h = Math.max(2.5, (800 - b.hit[2]) * 0.01);
  const zf = -0.15 + (BUILDING_DZ.get(b) ?? 0);
  const model = modelOf(b);
  // how far the facade's attachments (signs, sills, turrets, lamps) stand out at body height: the Infinity solid must
  // cover them, or the FP eye (near plane 5 cm) walks into a sign / turret and sees its inside (audit: eye clearance)
  let reach = -Infinity;
  const rec = k.b.recorder, upper = isUpper(b);
  if (upper && model.solidFront === undefined) k.b.recorder = (mat, g, tag, look) => {
    rec?.(mat, g, tag, look);
    g.computeBoundingBox(); const bb = g.boundingBox!;
    if (bb.min.y < 2.0 && bb.max.y > 0.35 && bb.max.x > x0 && bb.min.x < x1) reach = Math.max(reach, bb.max.z);
  };
  model.build(k, b, x0, x1, zf, h);
  k.b.recorder = rec;
  // coarse camera colliders + solids (lower-street builders push their own)
  if (upper) {
    const front = zf + (model.front ?? 0), solid0 = zf + (model.solidFront ?? model.front ?? 0);
    const solid = Math.max(solid0, Math.min(reach + 0.05, solid0 + 0.3));
    // camera collider up to the roof (the high TP camera never enters a roof) and out to the attachments
    k.colliders.push(x0, x1, 0, h + 2.5, zf - 5, Math.max(front, solid));
    (k.solids ||= []).push(x0, x1, zf - 6, solid, Infinity);
  }
  if (b.soon && (b.id === 'hall')) scaffolding(k, x0 + 1.2, x1, zf, Math.min(h * 0.62, 4));
}

/**
 * Entrance plane (world Z, m) of a building's street model: the facade line (+ model front) on the upper street, the
 * adit frame / board / gate front on the lower street. Used for the door hit volumes.
 */
export function entranceZ(b: Building): number {
  const xf = BUILDING_XF.get(b); if (xf) return xf.z(entranceZ(xf.virt));
  if (isUpper(b)) return -0.15 + (BUILDING_DZ.get(b) ?? 0) + (modelOf(b).front ?? 0);
  return lowEntranceZ(b);
}

/** Upper-street buildings (those standing behind the street, not in the retaining wall). */
export function isUpper(b: Building): boolean { return b.hit[3] <= 1000 && !b.mine; }
