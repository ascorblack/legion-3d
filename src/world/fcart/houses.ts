/**
 * Asset-faithful houses and decor of the new fair (fc-art.js / tk-art.js: houseB + the ITEM table).
 *
 *   houses  'house:<roof>' (teal / red / blue / mustard / pink / plum) and 'house:tavern' — the site's cottage: a cream /
 *           pastel plaster box on a mauve stone plinth, a chunky HIPPED roof in the roof colour (dark ribs, ridge cap with
 *           round knobs, a dark fascia band), a brick chimney, two lit windows with shutters in the roof colour + flower
 *           boxes (a black cat in the left one on 40 % of the houses), an arched door in the dark roof colour on two
 *           stone steps. The tavern (purple roof) adds the cat-eared sign «ТАВЕРНА» on the eave, a red / cream striped
 *           awning over the door, a hanging beer-mug board on the right corner and a wall lantern.
 *           Batched (k.b), existing world materials only; no draw calls of their own.
 *   items   'i:<kind>' — INSTANCED kinds (k.inst, registerFcItemKinds): round flower beds (3 palettes), the roofed well,
 *           market carts with striped awnings (milk / fish / yarn), garden beds, laundry line, café umbrella table, picnic
 *           blanket, telescope, ore wagons, benches, lamp posts, and ALL signposts + the mine sign as one world-baked kind 'fc:signs' (flat part + text plates in the sign atlas).
 *           Each kind is 1–2 parts (draw calls). `placeFcItem` is the one hook faircats.ts placeItem calls.
 *
 * Scale: 1 px of the site map = 0.01 m (x) / 0.02 m (depth), see coords.ts; the 2D art is drawn bigger than life for a
 * chibi (1.35 m) world, so heights are the established fair heights (lamp head 2.75 m, doors 1.45 m, …).
 */
import * as THREE from 'three';
import { toX, toZ } from '../coords';
import { GEO, GEO2, M } from '../batch';
import { type Ctx, box, rbox, shade, windowZ, doorZ } from '../kit';
import { signF } from '../buildings';
import { part, type Instancer } from '../instancer';
import { LAMP_HEAD_Y, lanternHead } from '../protoProps';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { registerFcModel, fcModel, type FcPlace } from './registry';

/** Fingerprints of the site assets these models were made from (src/data/fcart-fp.json, scripts/fcart-fp.mjs). */
const FP: Record<string, string> = {
  'house:blue': '0d0ab8c9923615',
  'house:mustard': '18725d789e9397',
  'house:pink': '07848b8754ef0f',
  'house:red': '1c8e51b5dad927',
  'house:tavern': '1928923b4c3e70',
  'house:teal': '168a71edcb9854',
  'i:bench': '087622bb9e8c08',
  'i:cart': '16398870579203',
  'i:flowers': '0a08653073bb1e',
  'i:garden': '14b2dd90fb81ae',
  'i:lamp': '11c0c1a606a65f',
  'i:laundry': '11947039ffee46',
  'i:minesign': '0701dcb7f01c90',
  'i:picnic': '10a75bafdaedec',
  'i:signpost': '041c2e8195e87f',
  'i:tables': '1c7f71bdee6cbb',
  'i:telescope': '0967a966b3ba06',
  'i:wagon': '10196aa8e25831',
  'i:well': '0edff05186304f'
};

/* ------------------------------------------------------------------ site palette (tk-art.js P / ROOF / houseB walls) */
const SP = {
  rock: '#b39a8c', rockD: '#8f766b', rockL: '#cdb7a8', wood: '#a8754f', woodD: '#6e4a2f', woodL: '#c8956a', cream: '#fff1d6', pink: '#ff8fa3',
  gold: '#ffcf4a', glass: '#ffd76a', metal: '#3a2e4a', brick: '#b4584a', brickD: '#80392e', leaf: '#5a9a4a', leafD: '#3e7436', leafL: '#8cc46a',
  terra: '#d27b5a', card: '#d9a066', cardL: '#ecc08a',
};
/** [main, dark, light] per roof colour (tk-art.js ROOF). */
export const FC_ROOFS: Record<string, [string, string, string]> = {
  plum: ['#7a4a78', '#5a3458', '#9a6496'], teal: ['#3f8f8a', '#2a6662', '#62b0a8'], red: ['#c8664a', '#8f3f2c', '#e08a68'], blue: ['#4a6fb0', '#2f4c84', '#7a9ad6'],
  mustard: ['#d9a23a', '#a0741e', '#f0c464'], pink: ['#e07a9a', '#b0506e', '#f4a8c0'],
};
/** Wall colour by roof colour (tk-art.js houseB `walls`). */
export const FC_WALLS: Record<string, string> = { teal: '#fff1d6', red: '#ffe0ec', blue: '#fff4e0', mustard: '#e6f0ff', pink: '#f0ffe6', plum: '#f3d3a5' };
const FLORA = [['#ff7f96', '#fff4e0', '#9b86e8'], ['#ff6a4d', '#ffe27a', '#fff4e0'], ['#ffb04a', '#fff4e0', '#6f9ee8'], ['#ffd84a', '#ffa9bf', '#a678d8'], ['#c58ae8', '#fff4e0', '#ff8fa3'], ['#ff8fa3', '#ffe27a', '#7fb8ff']];
const FUR = ['#f2a65a', '#e8914a', '#f3d9b1', '#9aa3ad', '#7d8a99', '#f4f1ec', '#4a4350', '#a8754f', '#ffc6a0', '#c9ccd3'];

/** The site's rng (tk-map.js): mulberry32 — the chimney side / the window cat of a house come from rng(vis[0] + vis[3]). */
function siteRng(seed: number): () => number {
  let a = (seed >>> 0) || 1;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const hash = (x: number, y: number) => { const h = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453; return h - Math.floor(h); };

/* ------------------------------------------------------------------ batched helpers */
const ICO0 = new THREE.IcosahedronGeometry(0.5, 0);
const lump = (k: Ctx, col: string, x: number, y: number, z: number, r: number, sy = 1, sx = 1) =>
  k.b.add('flat', ICO0, M(x, y, z, r * 2 * sx, r * 2 * sy, r * 2, 0, (x * 7.3 + z * 3.1 + y * 5.7) % 6.28, 0), col, 1);

const TET = new THREE.TetrahedronGeometry(0.5);
const soft = (k: Ctx, col: string, x: number, y: number, z: number, r: number, sy = 1) => k.b.add('flat', ICO0, M(x, y, z, r * 2, r * 2 * sy, r * 2), col, 1);
/** Sitting cat facing +z (batched, 'flat'): body, head, two ears, tail curling on the right; `s` = scale (1 ≈ 0.5 m tall). */
function sitCat(k: Ctx, col: string, x: number, y: number, z: number, s = 1, dark = '#2b1d18'): void {
  soft(k, col, x, y + 0.2 * s, z, 0.19 * s, 1.25); soft(k, col, x, y + 0.5 * s, z + 0.03 * s, 0.14 * s);
  for (const e of [-1, 1]) k.b.add('flat', GEO.cone4, M(x + e * 0.085 * s, y + 0.66 * s, z + 0.03 * s, 0.1 * s, 0.14 * s, 0.1 * s), col, 1);
  for (const e of [-1, 1]) k.b.add('flat', GEO.box, M(x + e * 0.05 * s, y + 0.52 * s, z + 0.165 * s, 0.03 * s, 0.03 * s, 0.01 * s), dark, 1);
  [[0.2, 0.03, 0.09], [0.3, 0.13, 0.08], [0.31, 0.25, 0.07]].forEach(([dx, dy, r]) => soft(k, col, x + dx * s, y + dy * s + 0.04 * s, z - 0.02 * s, r * s));
}
/** A thin box along the segment a→b (world points). */
function edge(k: Ctx, mat: 'wood' | 'roof' | 'metal', col: string, a: number[], b: number[], t: number): void {
  const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2], len = Math.hypot(dx, dy, dz);
  rbox(k, mat, col, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2, len, t, t, -Math.atan2(dz, dx), 0, Math.atan2(dy, Math.hypot(dx, dz)), 0.5);
}

/**
 * Hipped roof, local frame: eave rectangle ±ex × ±ez at y = 0, ridge from (−rl, h, 0) to (rl, h, 0). Four planar faces, flat
 * normals, UVs in metres / 0.9 (the roof texture's tile), so the tiles run down every slope.
 */
export function hipRoofGeo(ex: number, ez: number, rl: number, h: number): THREE.BufferGeometry {
  const pos: number[] = [], uv: number[] = [], T = 0.9;
  const tri = (a: number[], b: number[], c: number[], ua: number[], ub: number[], uc: number[]) => { pos.push(...a, ...b, ...c); uv.push(...ua, ...ub, ...uc); };
  const sf = Math.hypot(ez, h), ss = Math.hypot(ex - rl, h);
  // front (+z) and back (−z): trapezoids
  const A = [-ex, 0, ez], B = [ex, 0, ez], C = [rl, h, 0], D = [-rl, h, 0];
  tri(A, B, C, [A[0] / T, 0], [B[0] / T, 0], [C[0] / T, sf / T]); tri(A, C, D, [A[0] / T, 0], [C[0] / T, sf / T], [D[0] / T, sf / T]);
  const A2 = [ex, 0, -ez], B2 = [-ex, 0, -ez], C2 = [-rl, h, 0], D2 = [rl, h, 0];
  tri(A2, B2, C2, [-A2[0] / T, 0], [-B2[0] / T, 0], [-C2[0] / T, sf / T]); tri(A2, C2, D2, [-A2[0] / T, 0], [-C2[0] / T, sf / T], [-D2[0] / T, sf / T]);
  // right (+x) and left (−x): triangles
  tri([ex, 0, ez], [ex, 0, -ez], [rl, h, 0], [ez / T, 0], [-ez / T, 0], [0, ss / T]);
  tri([-ex, 0, -ez], [-ex, 0, ez], [-rl, h, 0], [-ez / T, 0], [ez / T, 0], [0, ss / T]);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();
  return g;
}

/** Striped awning in the 'flat' material (so the tavern adds no canvas draw call): sloped slats with a scalloped valance. */
function stripedAwning(k: Ctx, x0: number, x1: number, y: number, zf: number, d: number, a: string, b: string): void {
  const n = Math.max(3, Math.round((x1 - x0) / 0.2)), w = (x1 - x0) / n, drop = d * 0.3, slope = Math.hypot(d, drop), ang = Math.atan2(drop, d);
  for (let i = 0; i < n; i++) {
    const cx = x0 + w * (i + 0.5), col = i % 3 === 1 ? b : a;
    rbox(k, 'flat', col, cx, y - drop / 2, zf + d / 2, w, 0.035, slope, 0, ang, 0);
    k.b.add('flat', ICO0, M(cx, y - drop - 0.02, zf + d, w * 1.1, 0.16, 0.1), col, 1);
  }
  for (const x of [x0, x1]) box(k, 'wood', SP.woodD, x - 0.02, x + 0.02, y - drop - 0.02, y, zf, zf + 0.03, 0.5);
}

/* ------------------------------------------------------------------ houses */
/** FcPlace.data of a house: the site's house record (id, k, roof); `roofCat` overrides the site's every-second-house loaf cat. */
export interface HouseData { id?: string; roof?: string; k?: string; roofCat?: boolean }

function buildHouse(k: Ctx, p: FcPlace, roofKey: string, tav: boolean): void {
  const R = FC_ROOFS[roofKey] ?? FC_ROOFS.red, wallCol = FC_WALLS[roofKey] ?? SP.cream, d = (p.data ?? {}) as HouseData;
  const y0 = p.base;
  const x0 = toX(p.foot[0]) + 0.05, x1 = toX(p.foot[2]) - 0.05, zf = toZ(p.foot[3]) - 0.04;
  const W = x1 - x0, D = Math.max(2.2, toZ(p.foot[3]) - toZ(p.foot[1]) - 0.1), zb = zf - D, cx = (x0 + x1) / 2, zc = (zf + zb) / 2;
  const Hw = tav ? 1.8 : 1.68, rise = tav ? 1.3 : 1.1, ov = 0.28, yT = y0 + Hw;
  const rnd = siteRng((p.vis[0] + p.vis[3]) | 0), chimLeft = rnd() < 0.5, catWin = rnd() < 0.4 || tav;
  const hid = String(d.id ?? ''), roofCat = d.roofCat ?? (hid === 'tavern' || /^h\d*[02468]$/.test(hid));
  const roofCol = R[0], roofTile = new THREE.Color(R[0]).multiplyScalar(1.55), fasCol = R[1], doorX = p.door ? toX(p.door.x) : cx;
  // --- body: mauve stone plinth, pastel plaster walls, a dark fascia band under the roof
  box(k, 'stone', SP.rock, x0 - 0.04, x1 + 0.04, y0 - 0.05, y0 + 0.2, zb - 0.04, zf + 0.04, 0.8);
  box(k, 'plaster', wallCol, x0, x1, y0 + 0.18, yT, zb, zf, 1.2);
  box(k, 'wood', shade(fasCol, 0.05), x0 - 0.12, x1 + 0.12, yT - 0.15, yT + 0.02, zb - 0.12, zf + 0.12, 0.6);
  // corner posts (the darker wall edge the art paints along both sides)
  for (const x of [x0, x1 - 0.07]) box(k, 'plaster', shade(wallCol, -0.1), x, x + 0.07, y0 + 0.2, yT - 0.15, zf, zf + 0.025, 1.2);
  // --- roof
  const ex = W / 2 + ov, ez = D / 2 + ov, rl = ex * 0.8, yB = yT + 0.02;
  { const g = hipRoofGeo(ex, ez, rl, rise); k.b.add('roof', g, M(cx, yB, zc), roofTile, [1, 1]); g.dispose(); }
  box(k, 'wood', shade(fasCol, -0.3), cx - ex, cx + ex, yB - 0.07, yB, zc - ez, zc + ez, 0.5);   // soffit
  const rib = shade(fasCol, -0.05);
  for (const [sx, sz] of [[-1, 1], [1, 1], [-1, -1], [1, -1]]) edge(k, 'roof', rib, [cx + sx * ex, yB, zc + sz * ez], [cx + sx * rl, yB + rise, zc], 0.1);
  box(k, 'roof', shade(fasCol, -0.12), cx - rl - 0.04, cx + rl + 0.04, yB + rise - 0.06, yB + rise + 0.1, zc - 0.09, zc + 0.09, 1);
  for (const s of [-1, 1]) k.b.add('roof', ICO0, M(cx + s * (rl + 0.04), yB + rise + 0.02, zc, 0.24, 0.22, 0.22), shade(fasCol, -0.05), 1);
  // --- chimney: brick stack on the back slope near the ridge, a darker cap, a black flue
  {
    const chx = cx + (chimLeft ? -1 : 1) * rl * 0.7, chz = zc - 0.3, top = yB + rise + 0.3;
    box(k, 'stone', SP.brick, chx - 0.2, chx + 0.2, yT + 0.2, top, chz - 0.2, chz + 0.2, 1.2);
    box(k, 'stone', SP.brickD, chx - 0.27, chx + 0.27, top, top + 0.12, chz - 0.27, chz + 0.27, 0.8);
    box(k, 'flat', '#2b1d18', chx - 0.17, chx + 0.17, top + 0.09, top + 0.14, chz - 0.17, chz + 0.17);
    k.b.role = 'smoke';   // floats by design (the lint's allowlist)
    [[0.3, 0.1], [0.58, 0.15], [0.9, 0.2]].forEach(([dy, r], i) => soft(k, '#f2eff6', chx + 0.08 + i * 0.16, top + 0.2 + dy, chz, r));
    k.b.role = '';
  }
  if (roofCat) sitCat(k, FUR[Math.floor(rnd() * 3)], cx + (rnd() - 0.5) * rl * 0.8, yB + rise + 0.09, zc, 0.8);   // the site's cat on the ridge (every second house)
  // --- windows with shutters in the roof colour and a flower box each; the left one holds a black cat on 40 % of the houses
  const wh = 0.55, ww = 0.4, wy = y0 + 0.78, dw = Math.max(0.42, 0.165 * W), FL = ['#ff8fa3', '#ffe27a', '#fff4e0', '#c9b6ff'];
  [x0 + dw, x1 - dw].forEach((wx, wi) => {
    windowZ(k, wx, wy, zf, ww, wh, true, { shutters: roofCol, glass: SP.glass });
    box(k, 'wood', SP.woodD, wx - ww / 2 - 0.1, wx + ww / 2 + 0.1, wy - 0.34, wy - 0.13, zf + 0.0, zf + 0.22, 0.5);
    box(k, 'flat', SP.leaf, wx - ww / 2 - 0.06, wx + ww / 2 + 0.06, wy - 0.14, wy - 0.07, zf + 0.04, zf + 0.2);
    for (let i = 0; i < 5; i++) k.b.add('flat', TET, M(wx - ww * 0.55 + i * ww * 0.28, wy - 0.045, zf + 0.12 + (i % 2) * 0.04, 0.1, 0.1, 0.1, 0, i * 1.3, 0), FL[(i + wi) % 4], 1);
    if (catWin && wi === 0) {
      sitCat(k, '#2b1d18', wx, wy - 0.16, zf + 0.03, 0.62, '#ffd76a');
    }
  });
  // --- the arched door in the dark roof colour, cream stone surround, steps
  const dh = 1.3, dwid = 0.72;
  box(k, 'stone', '#e8d4c0', doorX - 0.55, doorX + 0.55, y0, y0 + 0.09, zf, zf + 0.5, 0.6);
  box(k, 'stone', '#e8d4c0', doorX - 0.45, doorX + 0.45, y0 + 0.09, y0 + 0.17, zf, zf + 0.34, 0.6);
  doorZ(k, doorX, y0 + 0.18, zf, dwid, dh, { arch: true, color: R[1], frame: '#e8d4c0' });
  // --- the tavern: sign on the eave, striped awning, hanging mug board, wall lantern
  if (tav) {
    const sy = yT + 0.04, sh = signF(k, 'ТАВЕРНА', doorX, sy, zf + ov + 0.06, 1.7, { bg: '#5a3458', fg: SP.gold });
    for (const s of [-1, 1]) {
      { k.b.add('flat', GEO.cone4, M(doorX + s * 0.6, sy + sh + 0.1, zf + ov + 0.1, 0.36, 0.4, 0.08), '#5a3458', 1); k.b.add('flat', GEO.cone4, M(doorX + s * 0.6, sy + sh + 0.1, zf + ov + 0.15, 0.22, 0.26, 0.05), SP.pink, 1); }
      box(k, 'wood', SP.woodD, doorX + s * 0.7 - 0.02, doorX + s * 0.7 + 0.02, sy + 0.05, yT + 0.5 + sh * 0.0, zf + ov + 0.02, zf + ov + 0.06, 0.5);
    }
    stripedAwning(k, doorX - 0.56, doorX + 0.56, y0 + 1.62, zf + 0.02, 0.6, '#c0504a', '#fff1d6');
    // hanging board (purple frame, gold beer mug) on a dark bracket that juts out of the right corner
    const bw = 0.84, bh = 0.74, bx = x1 + 0.2 + bw / 2, by = yT - 0.6 - bh / 2 + 0.42, bz = zf + 0.16;
    box(k, 'metal', SP.metal, x1 - 0.05, bx + bw / 2 + 0.02, by + bh / 2 + 0.17, by + bh / 2 + 0.23, bz - 0.04, bz + 0.04, 0.5);
    edge(k, 'metal', SP.metal, [x1, by + bh / 2 - 0.12, bz], [x1 + 0.22, by + bh / 2 + 0.17, bz], 0.045);
    for (const sx of [-1, 1]) box(k, 'metal', SP.metal, bx + sx * (bw / 2 - 0.08) - 0.012, bx + sx * (bw / 2 - 0.08) + 0.012, by + bh / 2, by + bh / 2 + 0.17, bz - 0.01, bz + 0.01, 0.5);
    box(k, 'wood', '#5a3458', bx - bw / 2, bx + bw / 2, by - bh / 2, by + bh / 2, bz - 0.04, bz + 0.04, 0.5);
    box(k, 'wood', SP.wood, bx - bw / 2 + 0.06, bx + bw / 2 - 0.06, by - bh / 2 + 0.06, by + bh / 2 - 0.06, bz + 0.04, bz + 0.05, 0.5);
    box(k, 'flat', SP.gold, bx - 0.2, bx + 0.12, by - 0.2, by + 0.14, bz + 0.056, bz + 0.07);
    box(k, 'flat', '#fff4e0', bx - 0.21, bx + 0.13, by + 0.12, by + 0.24, bz + 0.064, bz + 0.078);
    box(k, 'flat', '#e0b020', bx + 0.14, bx + 0.25, by - 0.12, by + 0.06, bz + 0.06, bz + 0.067);
    // wall lantern: bracket, glowing yellow glass, a cap
    const lx = x0 + 0.12, ly = y0 + 1.35;
    box(k, 'metal', SP.metal, lx - 0.02, lx + 0.02, ly + 0.25, ly + 0.29, zf, zf + 0.16, 0.5);
    box(k, 'emit', '#ffd76a', lx - 0.075, lx + 0.075, ly, ly + 0.25, zf + 0.06, zf + 0.2, 0.5);
    box(k, 'metal', SP.metal, lx - 0.1, lx + 0.1, ly + 0.25, ly + 0.29, zf + 0.03, zf + 0.23, 0.5);
    box(k, 'metal', SP.metal, lx - 0.09, lx + 0.09, ly - 0.03, ly, zf + 0.04, zf + 0.22, 0.5);
  }
}

/* ------------------------------------------------------------------ instanced decor kinds */
const bx = new THREE.BoxGeometry(1, 1, 1), c8 = new THREE.CylinderGeometry(0.5, 0.5, 1, 8), c6 = new THREE.CylinderGeometry(0.5, 0.5, 1, 6);
const cn4 = new THREE.ConeGeometry(0.5, 1, 4), cn8 = new THREE.ConeGeometry(0.5, 1, 8), ico0 = new THREE.IcosahedronGeometry(0.5, 0), ico1 = new THREE.IcosahedronGeometry(0.5, 1);
const c6g = new THREE.CylinderGeometry(0.5, 0.5, 1, 6);
const c12 = new THREE.CylinderGeometry(0.5, 0.5, 1, 12);
const mg = (gs: THREE.BufferGeometry[]) => { const m = mergeGeometries(gs, false)!; gs.forEach((g) => g.dispose()); return m; };

/** Convex polygon (xy, CCW from +z) extruded ±t/2 along z, as a coloured part. */
function prism(pts: [number, number][], t: number, col: string, x = 0, y = 0, z = 0, ry = 0): THREE.BufferGeometry {
  const pos: number[] = [], n = pts.length, h = t / 2;
  for (let i = 1; i + 1 < n; i++) {
    pos.push(pts[0][0], pts[0][1], h, pts[i][0], pts[i][1], h, pts[i + 1][0], pts[i + 1][1], h);
    pos.push(pts[0][0], pts[0][1], -h, pts[i + 1][0], pts[i + 1][1], -h, pts[i][0], pts[i][1], -h);
  }
  for (let i = 0; i < n; i++) {
    const a = pts[i], b = pts[(i + 1) % n];
    pos.push(a[0], a[1], h, b[0], b[1], -h, b[0], b[1], h, a[0], a[1], h, a[0], a[1], -h, b[0], b[1], -h);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.computeVertexNormals();
  const out = part(g, col, x, y, z, 1, 1, 1, 0, ry, 0); g.dispose();
  return out;
}
/** A cone whose faces alternate two colours by angular segment (an umbrella / awning). */
function stripeCone(r: number, h: number, segs: number, a: string, b: string, y: number): THREE.BufferGeometry {
  const g = new THREE.ConeGeometry(0.5, 1, segs, 1, true).toNonIndexed();
  const posA = g.attributes.position as THREE.BufferAttribute, col = new Float32Array(posA.count * 3), ca = new THREE.Color(a), cb = new THREE.Color(b);
  for (let f = 0; f < posA.count; f += 3) {
    let sx = 0, sz = 0; for (let j = 0; j < 3; j++) { sx += posA.getX(f + j); sz += posA.getZ(f + j); }
    const c = Math.floor((Math.atan2(sz, sx) + Math.PI) / (Math.PI * 2) * segs) % 2 ? cb : ca;
    for (let j = 0; j < 3; j++) { col[(f + j) * 3] = c.r; col[(f + j) * 3 + 1] = c.g; col[(f + j) * 3 + 2] = c.b; }
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(0, y, 0), new THREE.Quaternion(), new THREE.Vector3(r * 2, h, r * 2)));
  return g;
}

const B = (c: string, x: number, y: number, z: number, sx: number, sy: number, sz: number, rx = 0, ry = 0, rz = 0) => part(bx, c, x, y, z, sx, sy, sz, rx, ry, rz);
const Cy6 = (c: string, x: number, y: number, z: number, d: number, h: number) => part(c6g, c, x, y, z, d, h, d);
const Oct = new THREE.OctahedronGeometry(0.5);
const Wheel = (c: string, x: number, y: number, z: number, d: number, h: number) => part(c12, c, x, y, z, d, h, d, Math.PI / 2, 0, 0);
const Cy = (c: string, x: number, y: number, z: number, d: number, h: number, rx = 0, ry = 0, rz = 0) => part(c8, c, x, y, z, d, h, d, rx, ry, rz);
const Ico = (c: string, x: number, y: number, z: number, sx: number, sy = sx, sz = sx, rx = 0, ry = 0, rz = 0) => part(ico0, c, x, y, z, sx, sy, sz, rx, ry, rz);
/** Round bed palettes: the site picks one of six from the item's position (floraOf). */
export const floraOf = (it: { x: number; y: number; pal?: number }) => ((it.pal != null ? it.pal : Math.floor(siteRng(Math.round(it.x) * 31 + Math.round(it.y) * 17 + 40)() * FLORA.length)) % FLORA.length + FLORA.length) % FLORA.length;
/** Signpost arrow pattern of a `to` list: R = pointing right (E / S), L = left. */
export const signPattern = (to: readonly (readonly [string, string])[]) => to.slice(0, 3).map((t) => (/E|S/.test(String(t[1])) ? 'R' : 'L')).join('') || 'R';
const BOARD = ['#f0d29c', '#f6dfb4', '#e8c088'];

/** One round flower bed: a ring of stones in three tones round a soil bed, leaves and blooms in the palette's colours. Ellipse 1.0 × 0.8 m. */
function bedParts(pal: number): THREE.BufferGeometry {
  const gs: THREE.BufferGeometry[] = [], C = FLORA[pal], rx = 0.5, rz = 0.4, N = 9;
  const tones = [shade(SP.rockL, 0.35), SP.rockL, SP.rock];
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2, w = 2 * Math.PI * 0.45 / N * 1.12;
    gs.push(B(tones[i % 3], Math.cos(a) * rx, 0.08, Math.sin(a) * rz, w, 0.17, 0.13, 0, -Math.atan2(rz * Math.cos(a), -rx * Math.sin(a)), 0));
  }
  gs.push(part(c6g, '#8a5a3c', 0, 0.2, 0, 0.84, 0.1, 0.84 * 0.8));
  const r = siteRng(pal * 977 + 3);
  for (let i = 0; i < 3; i++) { const a = r() * 6.28, d = Math.sqrt(r()) * 0.8; gs.push(Ico(i % 2 ? SP.leaf : SP.leafD, Math.cos(a) * 0.36 * d, 0.3, Math.sin(a) * 0.29 * d, 0.3, 0.14, 0.26)); }
  for (let i = 0; i < 12; i++) { const a = r() * 6.28, d = Math.sqrt(r()); gs.push(part(Oct, C[i % 3], Math.cos(a) * 0.38 * d, 0.33 + r() * 0.1, Math.sin(a) * 0.3 * d, 0.2, 0.2, 0.2, 0, i, 0)); }
  return mg(gs);
}

/** Tiled well, roofed: stone ring, water, two posts, a windlass with a rope and bucket, a red gable roof with pink cat ears. */
function wellParts(): [THREE.BufferGeometry, THREE.BufferGeometry] {
  const st: THREE.BufferGeometry[] = [], rf: THREE.BufferGeometry[] = [], R = FC_ROOFS.red, N = 16, rr = 0.66;
  for (let row = 0; row < 2; row++) for (let i = 0; i < 10; i++) {
    const a = (i + row * 0.5) / 10 * Math.PI * 2;
    st.push(B([SP.rock, SP.rockL, shade(SP.rock, -0.06)][(i + row) % 3], Math.cos(a) * rr, 0.16 + row * 0.3, Math.sin(a) * rr * 0.92, 0.46, 0.31, 0.2, 0, -a - Math.PI / 2, 0));
  }
  st.push(part(c12, shade(SP.rockL, 0.12), 0, 0.64, 0, 1.5, 0.07, 1.38));
  st.push(Cy('#3f9fd0', 0, 0.55, 0, 1.12, 0.04).applyMatrix4(new THREE.Matrix4().makeScale(1, 1, 0.92)));
  const W = '#8a5a3c';   // posts, windlass and bucket go into the roof part (one material) with flat brown colours
  for (const s of [-1, 1]) rf.push(B(W, s * 0.78, 1.02, 0, 0.14, 1.5, 0.14));
  rf.push(Cy(shade(W, 0.15), 0, 1.55, 0, 0.1, 1.7, 0, 0, Math.PI / 2));   // windlass beam
  rf.push(B(shade(W, -0.2), 0.88, 1.55, 0.1, 0.05, 0.05, 0.3));   // crank
  rf.push(B('#e8dcc0', 0, 1.2, 0, 0.02, 0.7, 0.02));   // rope
  rf.push(Cy('#b07a4a', 0, 0.84, 0, 0.26, 0.26)); rf.push(Cy('#6fc4ff', 0, 0.97, 0, 0.22, 0.02));   // bucket
  // roof: gable, ridge along x, 2.2 wide, 1.5 deep, 0.65 high on the posts; pink cat ears on the ridge ends
  rf.push(part(GEO2.gable, R[0], 0, 1.8, 0, 2.2, 0.65, 1.5));
  rf.push(part(GEO2.gableEnds, shade(R[0], -0.1), 0, 1.8, 0, 2.18, 0.65, 1.46));
  rf.push(B(R[1], 0, 2.45, 0, 2.24, 0.1, 0.12));
  for (const s of [-1, 1]) {
    rf.push(part(cn4, R[0], s * 1.06, 2.62, 0, 0.28, 0.42, 0.22, 0, Math.PI / 4, 0));
    rf.push(part(cn4, SP.pink, s * 1.06, 2.58, 0.04, 0.17, 0.28, 0.14, 0, Math.PI / 4, 0));
  }
  return [mg(st), mg(rf)];
}

/** Market cart: plank box on four gold-hub wheels, four poles, a striped canopy with scalloped valance; goods heaped on it. */
function cartParts(goods: string): [THREE.BufferGeometry, THREE.BufferGeometry] {
  const C: Record<string, [string, string]> = { milk: ['#4ab0ff', SP.cream], fish: ['#3a8fd0', '#ffe0ec'], yarn: ['#c06aa8', '#fff4e0'] };
  const col = C[goods] ?? ['#d04a4a', SP.cream], wd: THREE.BufferGeometry[] = [], cv: THREE.BufferGeometry[] = [];
  wd.push(B(SP.wood, 0, 0.45, 0, 1.3, 0.34, 0.8)); wd.push(B(SP.woodD, 0, 0.64, 0, 1.36, 0.08, 0.86));
  for (const sx of [-0.45, 0.45]) for (const sz of [-0.43, 0.43]) wd.push(Cy(SP.woodD, sx, 0.26, sz, 0.52, 0.07, Math.PI / 2));
  for (const sx of [-0.62, 0.62]) for (const sz of [-0.34, 0.34]) wd.push(B(SP.woodD, sx, 1.22, sz, 0.06, 1.1, 0.06));
  const n = 6, w = 1.6 / n;
  for (let i = 0; i < n; i++) {
    const c = i % 2 ? col[1] : col[0], x = -0.8 + w * (i + 0.5);
    cv.push(B(c, x, 1.85, 0, w, 0.05, 1.0, 0.1)); cv.push(B(c, x, 1.72, 0.52, w * 0.98, 0.16, 0.05));
  }
  if (goods === 'milk') {
    for (const x of [-0.4, -0.12, 0.16]) cv.push(Cy6(SP.cream, x, 0.84, 0.05, 0.15, 0.24));
    cv.push(B('#ffd34d', 0.45, 0.76, 0.05, 0.3, 0.14, 0.2));
  } else if (goods === 'fish') {
    cv.push(Ico('#8fb6c8', -0.3, 0.76, 0.08, 0.4, 0.14, 0.18, 0, 0.2, 0)); cv.push(Ico('#ffb36b', 0.18, 0.76, -0.05, 0.36, 0.13, 0.17, 0, -0.3, 0)); cv.push(Ico('#c8d8e0', 0.5, 0.75, 0.12, 0.3, 0.1, 0.14, 0, 0.5, 0));
  } else for (const [i, c] of ['#ff8fa3', '#7fd6e6', SP.gold, '#b9a2ff'].entries()) cv.push(Ico(c, -0.42 + i * 0.28, 0.8, 0.02 + (i % 2) * 0.1, 0.2));
  return [mg(wd), mg(cv)];
}

/** Garden bed 1.5 × 2.2 m (front edge at z = 0, the bed runs to −z): soil in a plank frame, cabbage rows and a carrot row, a sign. */
function gardenParts(): THREE.BufferGeometry {
  const gs: THREE.BufferGeometry[] = [], W = 1.5, D = 2.2;   // 12 plants
  gs.push(B('#7a5038', 0, 0.08, -D / 2, W, 0.16, D));
  for (const z of [0, -D]) gs.push(B(SP.wood, 0, 0.1, z, W + 0.08, 0.2, 0.1));
  for (const x of [-W / 2, W / 2]) gs.push(B(SP.woodD, x, 0.1, -D / 2, 0.08, 0.2, D));
  const rows = [-0.5, -1.1, -1.7];
  rows.forEach((z, ri) => { for (let i = 0; i < 4; i++) { const x = -W / 2 + 0.2 + i * 0.37;
    if (ri === 1) { for (const a of [-0.45, 0, 0.45]) gs.push(part(cn4, SP.leaf, x, 0.34, z, 0.07, 0.34, 0.07, 0, 0, a * 0.8)); gs.push(part(cn4, '#ff9a3a', x, 0.2, z, 0.1, 0.14, 0.1, Math.PI, 0, 0)); }
    else gs.push(Ico(ri === 0 ? (i % 2 ? '#9fe39a' : SP.leafL) : (i % 2 ? SP.leafL : '#9fe39a'), x, 0.3, z, 0.3, 0.24, 0.3)); } });
  gs.push(B(SP.woodD, 0.55, 0.45, -2.4, 0.05, 0.9, 0.05)); gs.push(B('#fff4e0', 0.55, 0.92, -2.4, 0.5, 0.22, 0.04)); gs.push(B('#2b1d18', 0.55, 0.92, -2.37, 0.34, 0.04, 0.01));
  return mg(gs);
}

/** Laundry line, 1.6 m along +x from the first pole: two posts, a sagging cord, shirts (with a paw), socks and fish on pegs. */
function laundryParts(): THREE.BufferGeometry {
  const gs: THREE.BufferGeometry[] = [], L = 1.6, TOP = 1.85, COL = [SP.pink, '#7fd6e6', SP.gold, '#b9a2ff', '#9fe39a'];
  for (const x of [0, L]) { gs.push(B(SP.wood, x, 0.95, 0, 0.1, 1.9, 0.1)); gs.push(B(SP.woodD, x, 0.02, 0, 0.22, 0.04, 0.22)); }
  const N = 8, sag = (t: number) => TOP - Math.sin(Math.PI * t) * 0.14;
  for (let i = 0; i < N; i++) { const t0 = i / N, t1 = (i + 1) / N, a = [t0 * L, sag(t0)], b = [t1 * L, sag(t1)]; gs.push(B('#d8cbb0', (a[0] + b[0]) / 2, (a[1] + b[1]) / 2, 0, Math.hypot(b[0] - a[0], b[1] - a[1]) + 0.01, 0.02, 0.02, 0, 0, Math.atan2(b[1] - a[1], b[0] - a[0]))); }
  [0.2, 0.45, 0.7, 0.9].forEach((t, i) => {
    const x = t * L, y = sag(t), c = COL[i % COL.length];
    if (i % 3 === 0) { gs.push(B(c, x, y - 0.2, 0, 0.3, 0.36, 0.02)); gs.push(B(c, x - 0.2, y - 0.1, 0, 0.12, 0.1, 0.02, 0, 0, 0.5)); gs.push(B(c, x + 0.2, y - 0.1, 0, 0.12, 0.1, 0.02, 0, 0, -0.5)); gs.push(Ico('#ffffff', x, y - 0.22, 0.015, 0.1, 0.08, 0.02)); }
    else if (i % 3 === 1) { gs.push(B(c, x, y - 0.17, 0, 0.14, 0.3, 0.02)); gs.push(B(c, x + 0.07, y - 0.34, 0, 0.2, 0.1, 0.02)); }
    else { gs.push(Ico(c, x, y - 0.17, 0, 0.1, 0.34, 0.02, 0, 0, 0)); gs.push(part(cn4, c, x, y - 0.38, 0, 0.12, 0.1, 0.02, 0, 0, Math.PI)); }
    gs.push(B(SP.woodD, x - 0.04, y, 0, 0.025, 0.07, 0.04)); gs.push(B(SP.woodD, x + 0.04, y, 0, 0.025, 0.07, 0.04));
  });
  return mg(gs);
}

/** Café: two tables with a bench each side, mugs and a fish, one red / cream striped umbrella on a pole between them. */
function tablesParts(): [THREE.BufferGeometry, THREE.BufferGeometry] {
  const wd: THREE.BufferGeometry[] = [], cv: THREE.BufferGeometry[] = [];
  for (const tx of [-0.95, 0.95]) {
    wd.push(B(SP.woodL, tx, 0.72, 0, 1.1, 0.07, 0.8));
    for (const lx of [-0.44, 0.44]) for (const lz of [-0.3, 0.3]) wd.push(B(SP.woodD, tx + lx, 0.36, lz, 0.07, 0.72, 0.07));
    for (const s of [-1, 1]) { wd.push(B(SP.wood, tx, 0.42, s * 0.56, 1.0, 0.06, 0.22)); for (const lx of [-0.4, 0.4]) wd.push(B(SP.woodD, tx + lx, 0.2, s * 0.56, 0.06, 0.4, 0.06)); }
    wd.push(Cy(SP.gold, tx - 0.25, 0.82, -0.1, 0.16, 0.17)); wd.push(Ico('#8fb6c8', tx + 0.2, 0.78, 0.1, 0.22, 0.07, 0.11));
  }
  wd.push(B(SP.woodD, 0, 0.95, 0, 0.07, 1.9, 0.07));
  cv.push(stripeCone(0.95, 0.42, 12, '#d04a4a', SP.cream, 1.74));
  cv.push(ball2(SP.gold, 0, 1.97, 0, 0.09));
  return [mg(wd), mg(cv)];
}
const ball2 = (c: string, x: number, y: number, z: number, r: number) => part(ico0, c, x, y, z, r * 2, r * 2, r * 2);

/** Picnic blanket 1.7 × 1.0 m: red with cream stripes both ways, a basket with a fish, a milk bottle and a sleeping cat. */
function picnicParts(): THREE.BufferGeometry {
  const gs: THREE.BufferGeometry[] = [], W = 1.7, D = 1.0;
  gs.push(B('#e8455c', 0, 0.01, 0, W, 0.02, D));
  for (let i = 1; i < 6; i++) gs.push(B('#fff4e0', -W / 2 + i * W / 6, 0.026, 0, 0.08, 0.012, D));
  for (let j = 1; j < 3; j++) gs.push(B('#fff4e0', 0, 0.026, -D / 2 + j * D / 3, W, 0.012, 0.08));
  gs.push(B(SP.woodL, -0.5, 0.15, -0.02, 0.44, 0.24, 0.3)); gs.push(B(SP.woodD, -0.5, 0.27, -0.02, 0.46, 0.04, 0.32));
  for (const s of [-1, 1]) gs.push(B(SP.woodD, -0.5 + s * 0.2, 0.4, -0.02, 0.03, 0.26, 0.03, 0, 0, s * 0.35));
  gs.push(B(SP.woodD, -0.5, 0.52, -0.02, 0.3, 0.03, 0.03));
  gs.push(Ico('#8fb6c8', -0.5, 0.33, -0.02, 0.32, 0.1, 0.14, 0, 0.3, 0));
  gs.push(Cy(SP.cream, 0.05, 0.14, 0.2, 0.12, 0.26)); gs.push(Cy('#4ab0ff', 0.05, 0.29, 0.2, 0.07, 0.05));
  const fur = FUR[0];
  gs.push(Ico(fur, 0.52, 0.1, 0.05, 0.34, 0.2, 0.28)); gs.push(Ico(fur, 0.37, 0.1, 0.18, 0.15, 0.13, 0.14));
  for (const s of [0, 0.07]) gs.push(part(cn4, fur, 0.33 + s, 0.2, 0.14, 0.05, 0.08, 0.04));
  return mg(gs);
}

/** Telescope: wooden tripod, a gold tube on a pivot tilted up 34°, a dark-gold eyepiece and end cap. */
function telescopeParts(): THREE.BufferGeometry {
  const gs: THREE.BufferGeometry[] = [], H = 0.95;
  for (let i = 0; i < 3; i++) { const a = i * 2.094 + 0.4, lx = Math.cos(a) * 0.32, lz = Math.sin(a) * 0.32; gs.push(B(SP.woodD, lx / 2, H / 2, lz / 2, 0.05, Math.hypot(H, 0.32), 0.05, -lz / H, 0, lx / H)); }
  gs.push(Cy(SP.woodD, 0, H, 0, 0.14, 0.08));
  const tilt = 0.6;   // 34°
  const T = (c: string, along: number, r: number, len: number) => Cy(c, along * Math.cos(tilt), H + 0.06 + along * Math.sin(tilt), 0, r * 2, len, 0, 0, -(Math.PI / 2 - tilt));
  gs.push(T(SP.gold, 0.28, 0.085, 0.95), T('#a07a1a', 0.9, 0.11, 0.2), T('#a07a1a', 0.5, 0.092, 0.035), T('#a07a1a', 0.7, 0.092, 0.035), T('#a07a1a', -0.28, 0.06, 0.22));
  return mg(gs);
}

/** Ore wagon on rails: long axis along x, 0.9 × 0.6 m hopper on four dark wheels (rail gauge 0.44 m); `ore` = a heap of coloured lumps. */
function wagonParts(ore: boolean): [THREE.BufferGeometry, THREE.BufferGeometry | null] {   // [hull + wheels, ore heap]
  const mt: THREE.BufferGeometry[] = [], fl: THREE.BufferGeometry[] = [], bodyC = '#9a9eb0', rib = '#6a6e80', rim = '#b0b4c4';
  mt.push(B(rib, 0, 0.32, 0, 0.8, 0.06, 0.5));
  for (const s of [-1, 1]) {
    mt.push(B(bodyC, 0, 0.55, s * 0.3, 1.0, 0.46, 0.05, s * -0.18, 0, 0)); mt.push(B(bodyC, s * 0.5, 0.55, 0, 0.05, 0.46, 0.6, 0, 0, s * 0.18));
    mt.push(B(rim, 0, 0.8, s * 0.33, 1.1, 0.08, 0.08)); mt.push(B(rim, s * 0.55, 0.8, 0, 0.08, 0.08, 0.64));
    mt.push(B(rib, 0, 0.5, s * 0.33, 0.9, 0.025, 0.02)); mt.push(B(rib, 0, 0.64, s * 0.33, 0.9, 0.025, 0.02));
    for (const sx of [-0.3, 0.3]) { mt.push(Wheel('#4a4a5c', sx, 0.19, s * 0.34, 0.34, 0.06)); mt.push(Wheel('#d0d4e0', sx, 0.19, s * 0.375, 0.12, 0.03)); }
  }
  mt.push(B(rib, 0, 0.2, 0, 0.7, 0.04, 0.04));   // axle bar
  if (ore) {
    const OC = ['#8fd8ff', '#5a5a68', '#c9a2ff', '#5a5a68', '#ffe27a', '#8fd8ff', '#c9a2ff'];
    OC.forEach((c, i) => fl.push(Ico(c, -0.34 + i * 0.115, 0.86 + (i % 3) * 0.06, ((i * 37) % 5 - 2) * 0.05, 0.22, 0.16 + (i % 2) * 0.06, 0.2, 0, i, 0)));
  }
  return [mg(mt), ore ? mg(fl) : null];
}

/* ------------------------------------------------------------------ signposts + mine sign (text boards)
 * Every signpost and the mine sign of a town go into ONE instanced kind 'fc:signs' (identity transform, geometry baked in
 * world space): part 1 'flat' (posts, plank slabs, arrow tips, paws, triangle) + part 2 'sign' (the text plates, UVs into the
 * world's sign atlas). Two draw calls for all of them, whatever their number; the kind is built while the items are placed.
 * Site: tk-art.js signpost(): post 12×112 px, boards 24 px high every 30 px from y−104, length max(64, 11·chars+26) px, arrow
 * tip 14 px on the E / S side → right, else left; ITEM.minesign: post, yellow triangle 100×36 over a cream 124×26 plaque «ВАГОНЕТКИ!». */
const INK = '#2b1d18';
const SIGN_BOARD = ['#e8c088', '#f0d0a0', '#dcb07a'];
const SX = 0.0125, SY = 0.0175;   // metres per site px along / across a board (the chibi world is wider than tall)
const SM = 0.014;                  // the mine sign, uniform
const SP_POST = '#c9916a';   // the site's post wood, a touch lighter (it is lit from the side only)

interface SignKit { flat: THREE.BufferGeometry[]; sign: THREE.BufferGeometry[]}
const SIGNS = new WeakMap<Instancer, SignKit>();
const SIGN_CELLS = new WeakMap<object, Map<string, [number, number, number, number]>>();

/** Draws one sign picture in the virtual plate space Vw × Hh (px); `ob` = outline half-width. */
type SignDraw = (g: CanvasRenderingContext2D, Vw: number, Hh: number, ob: number) => void;
const SIGN_FAM = "'Russo One','Dela Gothic One','Arial Black',sans-serif";
/** Outlined shape: fill, then an INK stroke 2·ob wide centred on the path (the outer edge reaches the plate edge). */
function paint(g: CanvasRenderingContext2D, fill: string, ob: number): void { g.fillStyle = fill; g.fill(); g.strokeStyle = INK; g.lineWidth = 2 * ob; g.lineJoin = 'round'; g.stroke(); }
function label(g: CanvasRenderingContext2D, text: string, cx: number, cy: number, fs: number, maxW: number): void {
  g.font = `${fs}px ${SIGN_FAM}`; while (g.measureText(text).width > maxW && fs > 12) { fs -= 2; g.font = `${fs}px ${SIGN_FAM}`; }
  g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = INK; g.fillText(text, cx, cy);
}
/** An arrow board: rounded plank on the far side, pointed tip of `tipV` px on the `tip` side, the label centred on the plank. */
const boardDraw = (text: string, fill: string, tip: 'L' | 'R' | '', tipV: number): SignDraw => (g, Vw, Hh, ob) => {
  const r = Hh * 0.2, x0 = ob, x1 = Vw - ob, y0 = ob, y1 = Hh - ob, ym = Hh / 2;
  g.beginPath();
  if (tip === 'R') { const xt = x1 - tipV; g.moveTo(x0 + r, y0); g.lineTo(xt, y0); g.lineTo(x1, ym); g.lineTo(xt, y1); g.lineTo(x0 + r, y1); g.arcTo(x0, y1, x0, y1 - r, r); g.lineTo(x0, y0 + r); g.arcTo(x0, y0, x0 + r, y0, r); }
  else if (tip === 'L') { const xt = x0 + tipV; g.moveTo(xt, y0); g.lineTo(x1 - r, y0); g.arcTo(x1, y0, x1, y0 + r, r); g.lineTo(x1, y1 - r); g.arcTo(x1, y1, x1 - r, y1, r); g.lineTo(xt, y1); g.lineTo(x0, ym); }
  else { g.moveTo(x0 + r, y0); g.lineTo(x1 - r, y0); g.arcTo(x1, y0, x1, y0 + r, r); g.lineTo(x1, y1 - r); g.arcTo(x1, y1, x1 - r, y1, r); g.lineTo(x0 + r, y1); g.arcTo(x0, y1, x0, y1 - r, r); g.lineTo(x0, y0 + r); g.arcTo(x0, y0, x0 + r, y0, r); }
  g.closePath(); paint(g, shade(fill, 0.1), ob);
  const bx0 = tip === 'L' ? x0 + tipV : x0, bx1 = tip === 'R' ? x1 - tipV : x1;
  label(g, text.toUpperCase(), (bx0 + bx1) / 2, Hh * 0.54, Math.round(Hh * 0.56), bx1 - bx0 - 2 * ob - Hh * 0.3);
};
/** The yellow warning triangle with a «!» (the mine sign). */
const warnDraw: SignDraw = (g, Vw, Hh, ob) => {
  g.beginPath(); g.moveTo(ob, Hh - ob); g.lineTo(Vw - ob, Hh - ob); g.lineTo(Vw / 2, ob); g.closePath(); paint(g, '#ffdd60', ob);
  label(g, '!', Vw / 2, Hh * 0.68, Math.round(Hh * 0.6), Hh);
};

/**
 * A sign picture in the world's sign atlas, drawn over a cell the atlas reserves (SignAtlas.add), so that it looks undistorted
 * on a quad of aspect `a` (width / height): the cell is 4:1, the plate is drawn squeezed by 4/a. Returns the UV rect, 3 px
 * inside the cell (nothing bleeds in from the neighbours). Cached per atlas and `key`. Without a canvas (tests) the atlas's own cell.
 */
function signCell(k: Ctx, key: string, a: number, draw: SignDraw): [number, number, number, number] {
  const atlas = k.signs as unknown as { add(t: string, o: object): { uv: [number, number, number, number] }; canvas?: HTMLCanvasElement; texture?: THREE.Texture };
  let cache = SIGN_CELLS.get(atlas); if (!cache) SIGN_CELLS.set(atlas, (cache = new Map()));
  const ck = `${key}|${a.toFixed(2)}`, hit = cache.get(ck); if (hit) return hit;
  let uv = atlas.add(key, {}).uv;
  const cv = atlas.canvas, g = cv && typeof cv.getContext === 'function' ? cv.getContext('2d') : null;
  if (g && cv) {
    const CW = cv.width, CH = cv.height, x = Math.round(uv[0] * CW), y = Math.round((1 - uv[3]) * CH), W = Math.round((uv[2] - uv[0]) * CW), H = Math.round((uv[3] - uv[1]) * CH), m = 3;
    const Hh = H - 2 * m, Vw = Hh * a, sxc = (W - 2 * m) / Vw;
    g.save(); g.beginPath(); g.rect(x, y, W, H); g.clip(); g.clearRect(x, y, W, H);
    g.translate(x + m, y + m); g.scale(sxc, 1);
    draw(g, Vw, Hh, Hh * 0.055);
    g.restore();
    if (atlas.texture) atlas.texture.needsUpdate = true;
    uv = [(x + m) / CW, 1 - (y + H - m) / CH, (x + W - m) / CW, 1 - (y + m) / CH];
  }
  cache.set(ck, uv); return uv;
}

/** A quad (facing +z, centred at x, y, z) with the atlas UV rect `uv` and white vertex colours. */
function plateQuad(w: number, h: number, uv: [number, number, number, number], x: number, y: number, z: number): THREE.BufferGeometry {
  const g = new THREE.PlaneGeometry(w, h).toNonIndexed(), a = g.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < a.count; i++) a.setXY(i, a.getX(i) ? uv[2] : uv[0], a.getY(i) ? uv[3] : uv[1]);
  g.translate(x, y, z);
  g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 3).fill(1), 3));
  return g;
}

/** One arrow board centred at (cx, cy) (plank w × h; the tip extends `tipLen` further on its side): a dark slab through the post, a plain back, the picture plate on the front. */
function signBoard(L: GeoOut, text: string, col: string, right: boolean, cx: number, cy: number, w: number, h: number, tipLen: number, k: Ctx): void {
  const z0 = 0.07, z1 = 0.13, zc = (z0 + z1) / 2, sgn = right ? 1 : -1;
  L.flat.push(B(INK, cx, cy, zc, w - 0.08, h - 0.08, z1 - z0), B(col, cx, cy, z0 - 0.002, w - 0.1, h - 0.1, 0.01));
  const qw = w + tipLen, qx = cx + sgn * tipLen / 2, tipV = tipLen / qw;   // tip share of the quad (× virtual width below)
  const tip: 'L' | 'R' | '' = tipLen > 0 ? (right ? 'R' : 'L') : '';
  const a = qw / h, Vw = 122 * a;   // the virtual plate is Hh = 128 − 6 high (signCell)
  L.sign.push(plateQuad(qw, h, signCell(k, text + '|' + col + '|' + tip + '|' + tipV.toFixed(3), a, boardDraw(text, col, tip, tipV * Vw)), qx, cy, z1 + 0.006));
}
interface GeoOut { flat: THREE.BufferGeometry[]; sign: THREE.BufferGeometry[] }

/** A post with the site's dark outline: an INK core a little wider than the wood face in front of it. */
function postBox(L: GeoOut, h: number, w: number): void {
  L.flat.push(B(INK, 0, h / 2 + 0.015, 0, w + 0.05, h + 0.03, w), B(SP_POST, 0, h / 2, 0.012, w - 0.01, h - 0.02, w + 0.01));
}
/** The pink paw on top of a post (site paw(x, y−118, .9)): a round pad and four toes, flat discs facing +z. */
function pawTop(L: GeoOut, top: number): void {
  const D = (c: string, x: number, y: number, rx: number, ry: number, z: number) => { L.flat.push(part(DISC, c, x, y, z, rx * 2, ry * 2, 1), part(DISC, c, x, y, -z, rx * 2, ry * 2, 1, 0, Math.PI, 0)); };
  D(INK, 0, top + 0.1, 0.12, 0.105, 0.008); D(SP.pink, 0, top + 0.1, 0.105, 0.09, 0.012);
  for (const [dx, dy] of [[-0.14, 0.18], [-0.05, 0.25], [0.05, 0.25], [0.14, 0.18]]) { D(INK, dx, top + dy, 0.052, 0.052, 0.008); D(SP.pink, dx, top + dy, 0.04, 0.04, 0.012); }
}
const DISC = new THREE.CircleGeometry(0.5, 9);

/** A signpost in its local frame (+z = the readable side): post with a pink paw, one board per `to` entry. */
function signpostLocal(k: Ctx, to: readonly (readonly [string, string])[]): GeoOut {
  const L: GeoOut = { flat: [], sign: [] };
  postBox(L, 2.0, 0.15);
  to.slice(0, 3).forEach(([label, dir], i) => {
    const px = Math.max(64, String(label).length * 11 + 26), right = /E|S/.test(String(dir)), w = px * SX, h = 24 * SY;
    const cx = (right ? -10 * SX : 10 * SX) + (right ? w / 2 : -w / 2), cy = (104 - 30 * i - 12) * SY;
    signBoard(L, String(label), SIGN_BOARD[i % 3], right, cx, cy, w, h, 14 * SX, k);
  });
  pawTop(L, 2.0);
  return L;
}

/** The mine sign in its local frame: post, yellow warning triangle with «!», a cream plaque «ВАГОНЕТКИ!». */
function mineSignLocal(k: Ctx): GeoOut {
  const L: GeoOut = { flat: [], sign: [] }, zc = 0.1;
  postBox(L, 1.6, 0.14);   // the post runs up behind the triangle
  const tb = 99.5 * SM, pw = 124 * SM, ph = 26 * SM, pcy = 87 * SM;
  // triangle (100 × 36 px): a dark prism for the thickness, the outlined yellow picture on its face
  L.flat.push(prism([[-0.58, 0.07], [0.58, 0.07], [0, 0.4]], 0.05, INK, 0, tb, zc));
  { const tw = 100 * SM + 0.06, th = 36 * SM + 0.06; L.sign.push(plateQuad(tw, th, signCell(k, 'warn', tw / th, warnDraw), 0, tb + 0.03 + th / 2 - 0.03, zc + 0.031)); }
  signBoard(L, 'ВАГОНЕТКИ!', '#fff4e0', true, 0, pcy, pw, ph, 0, k);
  return L;
}

/** Bakes `local` at the world position and adds it to the town's 'fc:signs' kind (registered / re-merged as items arrive). */
function addSignItem(k: Ctx, local: GeoOut, X: number, Y: number, Z: number, rotY: number): void {
  const I = k.inst;
  let kit = SIGNS.get(I); if (!kit) SIGNS.set(I, (kit = { flat: [], sign: [] }));
  const m = new THREE.Matrix4().compose(new THREE.Vector3(X, Y, Z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rotY), new THREE.Vector3(1, 1, 1));
  for (const g of local.flat) { g.applyMatrix4(m); kit.flat.push(g); }
  for (const g of local.sign) { g.applyMatrix4(m); kit.sign.push(g); }
  const old = I.partsOf('fc:signs');
  I.registerKind('fc:signs', [{ mat: 'flat', castShadow: true, geo: mergeGeometries(kit.flat, false)! }, { mat: 'sign', geo: mergeGeometries(kit.sign, false)! }]);
  old?.forEach((p) => p.geo.dispose());
  if (!I.count('fc:signs')) I.add('fc:signs', 0, 0, 0, 0, 1);
}

/** Park bench 1.1 × 0.45 m: backrest and seat planks, black iron legs and back supports. */
function benchParts(): THREE.BufferGeometry {
  const gs: THREE.BufferGeometry[] = [];
  gs.push(B(SP.wood, 0, 0.8, -0.2, 1.1, 0.14, 0.05, -0.12)); gs.push(B(SP.wood, 0, 0.62, -0.2, 1.1, 0.1, 0.05, -0.12));
  gs.push(B(SP.woodL, 0, 0.46, 0, 1.16, 0.06, 0.34));
  for (const s of [-1, 1]) {
    gs.push(B(SP.metal, s * 0.46, 0.22, 0.12, 0.06, 0.44, 0.06)); gs.push(B(SP.metal, s * 0.46, 0.26, -0.15, 0.06, 0.52, 0.06, -0.12));
    gs.push(B(SP.metal, s * 0.46, 0.5, 0, 0.05, 0.05, 0.42)); gs.push(B(SP.metal, s * 0.46, 0.7, -0.2, 0.05, 0.3, 0.05, -0.12));
  }
  return mg(gs);
}

/** Lamp post (same head height as the established fair lamp, so the light pools stay): wide foot, post, a lit lantern with a cap, a cat on top. */
function lampParts(): [THREE.BufferGeometry, THREE.BufferGeometry] {
  const LH = LAMP_HEAD_Y, M0 = SP.metal, mt: THREE.BufferGeometry[] = [], em: THREE.BufferGeometry[] = [];
  // the framed lantern of the street lamps (protoProps lanternHead: base plate, 4 corner rods, ring, cap, finial — all
  // touching; a bare emissive box read as a flat cream slab, operator bug 06.11 #1); the post ends under its base plate
  const [lf, lc] = lanternHead(M0, '#ffe2a0'); lf.translate(0, LH, 0); lc.translate(0, LH, 0);
  mt.push(Cy6(M0, 0, 0.09, 0, 0.42, 0.18)); mt.push(Cy6(M0, 0, (LH - 0.2) / 2, 0, 0.1, LH - 0.2)); mt.push(lf);
  em.push(lc);
  const cy = LH + 0.47;   // a cat silhouette sitting on the cap's finial
  mt.push(Ico(M0, 0, cy + 0.1, 0, 0.24, 0.3, 0.2)); mt.push(Ico(M0, 0.01, cy + 0.3, 0.02, 0.17, 0.16, 0.15));
  for (const s of [-1, 1]) mt.push(part(cn4, M0, s * 0.055 + 0.01, cy + 0.42, 0.02, 0.06, 0.1, 0.05));
  mt.push(B(M0, 0.17, cy + 0.08, 0, 0.2, 0.04, 0.04, 0, 0, 0.9));
  return [mg(mt), mg(em)];
}

/**
 * Registers the instanced decor kinds (call once after registerFairCatsKinds, which defines a plainer 'fc:lamp' this one
 * replaces). Parts per kind: bed ×3 1 · well 2 · cart ×4 2 · garden 1 · laundry 1 · tables 2 · picnic 1 · telescope 2 ·
 * wagon 1 / ore 2 · bench 1 · lamp 2 (the signs register themselves while placed: 'fc:signs', 2 parts for the whole town).
 */
export function registerFcItemKinds(k: Ctx): void {
  const I = k.inst;
  for (let p = 0; p < FLORA.length; p++) I.registerKind('fc:bed' + p, [{ mat: 'flat', geo: bedParts(p) }]);
  { const [st, wd] = wellParts(); I.registerKind('fc:well', [{ mat: 'stone', castShadow: true, geo: st }, { mat: 'roof', castShadow: true, geo: wd }]); }
  for (const g of ['milk', 'fish', 'yarn', 'x']) { const [wd, cv] = cartParts(g); I.registerKind('fc:cart:' + g, [{ mat: 'wood', castShadow: true, geo: wd }, { mat: 'canvas', geo: cv }]); }
  I.registerKind('fc:garden', [{ mat: 'flat', geo: gardenParts() }]);
  I.registerKind('fc:laundry', [{ mat: 'flat', geo: laundryParts() }]);
  { const [wd, cv] = tablesParts(); I.registerKind('fc:tables', [{ mat: 'wood', castShadow: true, geo: wd }, { mat: 'canvas', castShadow: true, geo: cv }]); }
  I.registerKind('fc:picnic', [{ mat: 'flat', geo: picnicParts() }]);
  I.registerKind('fc:telescope', [{ mat: 'flat', geo: telescopeParts() }]);
  for (const ore of [false, true]) { const [mt, fl] = wagonParts(ore); I.registerKind(ore ? 'fc:wagon:ore' : 'fc:wagon', [{ mat: 'flat', castShadow: true, geo: fl ? mg([mt, fl]) : mt }]); }
  I.registerKind('fc:bench', [{ mat: 'wood', castShadow: true, geo: benchParts() }]);
  { const [mt, em] = lampParts(); I.registerKind('fc:lamp', [{ mat: 'metal', castShadow: true, geo: mt }, { mat: 'emit', geo: em }]); }
}

/* ------------------------------------------------------------------ item placement (same anchors as faircats.ts placeItem) */
type Item = Record<string, any> & { k: string; x: number; y: number };
/** Extra fields the lamp model reads from FcPlace.data. */
export interface LampData { lampHead?: number; lampHeads?: number[] }

function placeItemModel(k: Ctx, it: Item, g: number): void {
  const x = it.x, y = it.y, X = toX(x), Z = toZ(y), I = k.inst, s = typeof it.s === 'number' ? it.s : 1;
  switch (it.k) {
    case 'flowers': I.add('fc:bed' + floraOf(it), X, g, toZ(y - 14), 0, (+it.w || 90) / 90); break;
    case 'well': I.add('fc:well', X, g, toZ(y - 34), 0, 1); break;
    case 'bench': I.add('fc:bench', X, g, toZ(y - 11), 0, 1); break;
    case 'cart': I.add('fc:cart:' + (['milk', 'fish', 'yarn'].includes(it.goods) ? it.goods : 'x'), X, g, toZ(y - 26), 0, 1); break;
    case 'garden': I.add('fc:garden', X, g, Z, 0, (+it.w || 150) / 150); break;
    case 'laundry': {
      const X2 = toX(+it.x2), Z2 = toZ(+it.y2), len = Math.hypot(X2 - X, Z2 - Z);
      I.add('fc:laundry', X, g, Z, -Math.atan2(Z2 - Z, X2 - X), len / 1.6); break;
    }
    case 'tables': I.add('fc:tables', X, g, toZ(y - 20), 0, 1); break;
    case 'picnic': I.add('fc:picnic', X, g, toZ(y - 23), 0, 1); break;
    case 'telescope': I.add('fc:telescope', X, g, toZ(y - 10), -0.3, 1); break;
    case 'wagon': {
      const a = (+it.a || 0) * Math.PI / 180;   // the site rotates the picture by a (px space: depth is twice as long per px)
      I.add(it.ore ? 'fc:wagon:ore' : 'fc:wagon', X, g, toZ(y - 14), -Math.atan(2 * Math.tan(a)), 1); break;
    }
    case 'signpost': addSignItem(k, signpostLocal(k, Array.isArray(it.to) ? it.to : [['', 'E']]), X, g, toZ(y - 3), -0.15 + hash(x, 1) * 0.3); break;
    case 'minesign': addSignItem(k, mineSignLocal(k), X, g, toZ(y - 3), -0.15 + hash(x, 1) * 0.3); break;
    case 'lamp': I.add('fc:lamp', X, g, toZ(y - 3), 0, 1); break;
    default: void s; break;
  }
}

/** Item kinds this module models (site item `k`). */
export const FC_ITEM_KINDS = ['flowers', 'well', 'bench', 'cart', 'garden', 'laundry', 'tables', 'picnic', 'telescope', 'wagon', 'signpost', 'minesign', 'lamp'] as const;
const NOTE: Record<string, string> = {
  flowers: 'round bed: ring of grey-mauve stones round brown soil, a cluster of blooms (6 palettes)', well: 'plaza well: stone ring, water, two posts, windlass + bucket, red tiled gable roof with pink cat ears',
  bench: 'park bench: backrest + seat planks on black iron legs', cart: 'market cart: plank box on gold-hub wheels, striped canopy, goods (milk / fish / yarn)', garden: 'garden bed: planks round brown soil, cabbages + carrots, a little sign',
  laundry: 'two posts and a cord with shirts / socks / fish on pegs', tables: 'café: two tables with benches and one red-cream umbrella', picnic: 'red blanket with cream stripes, basket, bottle, sleeping cat',
  telescope: 'wooden tripod, gold tube tilted up', wagon: 'ore wagon on rails: steel hopper on four dark wheels (+ coloured ore)', signpost: 'post with plank arrows + a pink paw on top', minesign: 'yellow warning triangle over a «ВАГОНЕТКИ!» board',
  lamp: 'dark post, lit glass lantern with a cap, a cat silhouette on top',
};
for (const kind of FC_ITEM_KINDS) {
  registerFcModel({
    ref: 'i:' + kind, fp: FP['i:' + kind] ?? 'TODO', note: NOTE[kind],
    build(k, p) {
      const it = (p.data ?? {}) as Item & LampData;
      placeItemModel(k, { ...it, k: kind }, p.base);
      if (kind === 'lamp' && it.lampHeads) it.lampHeads.push(toX(it.x), p.base + (it.lampHead ?? LAMP_HEAD_Y), toZ(it.y - 3));
    },
  });
}

/**
 * The hook for faircats.ts placeItem: places the item through its model when this module has one. `true` = placed (the
 * caller returns), `false` = not mine (the old code runs). Needs registerFcItemKinds(k) to have run.
 */
export function placeFcItem(k: Ctx, it: Item, g: number, lampHead: number, lampHeads: number[]): boolean {
  const m = fcModel('i:' + it.k);
  if (!m || !(FC_ITEM_KINDS as readonly string[]).includes(it.k)) return false;
  m.build(k, { vis: [it.x, it.y, it.x, it.y], foot: [it.x, it.y, it.x, it.y], base: g, data: { ...it, lampHead, lampHeads } });
  return true;
}

/* ------------------------------------------------------------------ house models */
for (const roof of ['teal', 'red', 'blue', 'mustard', 'pink']) {
  registerFcModel({ ref: 'house:' + roof, fp: FP['house:' + roof] ?? 'TODO', note: `cottage, ${roof} scale roof, ${FC_WALLS[roof]} walls, brick chimney, shuttered windows with flower boxes, arched ${roof} door, stone steps`, build: (k, p) => buildHouse(k, p, roof, false) });
}
registerFcModel({ ref: 'house:tavern', fp: FP['house:tavern'] ?? 'TODO', note: 'tavern: purple roof, cat-eared ТАВЕРНА sign on the eave, red-cream awning over the door, hanging mug board, wall lantern', build: (k, p) => buildHouse(k, p, 'plum', true) });
