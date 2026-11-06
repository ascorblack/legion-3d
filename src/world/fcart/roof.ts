/**
 * The site's tiled roof (tk-art.js 06.11 16:07: RDROP / roofRidge / roofTiles / roofV) in 3D, shared by the asset models
 * (civic hall / storage, shops auction / board, every house):
 *   - `roofRidge3d` — where the ridge ends and how far the eave drops, from the site's own formula. The site draws the
 *     roof obliquely: its ridge lies at half depth, so the drawn ridge is shifted right by dx / 2. In 3D the depth is
 *     real, so the PLAN ends (`x0`, `x1`: L + a, R − a) are the ridge, and anything the site places relative to the drawn
 *     ends (chimneys, vanes, the roof cat: `sx0`, `sx1`) lands at plan x = drawn x − hx;
 *   - `tileHipRoof` — the hip roof in ONE batch material ('fcroof', a single draw call for the whole town): four planar
 *     slopes, each cut into the site's bands (a dark lower band t 0…0.28, the plain middle, a light ridge band
 *     t 0.7…1, as vertex colours in the roof's own palette) and mapped onto the shared scallop texture so the tile rows
 *     follow the site's progression (row heights × q = 0.86 towards the ridge, the same row count as roofTiles draws);
 *     the ridge cap with its light line and round knobs, the hip ribs and the eave lip come along in the same material
 *     (they sample the plain strip of the texture);
 *   - `fcRoofTexture` — the scallop rows: one DataTexture (no canvas, built once): 30 rows of fish-scale tiles whose
 *     heights shrink geometrically (V_k = (1 − q^k) / (1 − q^30)), half-offset every second row, each tile's lower edge
 *     a dark arc with its shadow below it, a light highlight stroke on some tiles; the top strip is plain. It is grey
 *     (linear), so the vertex colour carries the roof's palette: a roof of N rows maps v = t · V_N, so its rows are the
 *     first N of the texture — exactly the site's geometric series, normalised to the slope.
 */
import * as THREE from 'three';
import { GEO, M } from '../batch';
import type { Ctx } from '../kit';

/** tk-art.js RDROP: the eave of roofV is drawn this many px lower than the eY it is given. */
export const RDROP = 6;
/** roofV's row ratio (roofTiles o.q). */
export const ROOF_Q = 0.86;
/** Rows held by the texture (roofTiles caps its loop at 30). */
export const TEX_ROWS = 30;
/** Scallops across the texture width in the eave row (the texture repeats along the eave every TEX_K0 tiles). */
export const TEX_K0 = 4;
/** Fraction of the texture height holding the scallop rows; the strip above is plain (ridge cap, ribs, plain pieces). */
const SCV = 0.9;
/** Texel value of the plain tile body (linear); vertex colours are divided by it so the plain body shows the palette. */
const TB = 0.8;
const INK = '#2b1d18';

/* ------------------------------------------------------------------ the site's formula */
export interface Ridge3d {
  /** hip inset (px): max(24, min(0.3 · W, 0.62 · h + dx / 4)) unless o.ins */
  a: number;
  /** drawn height eave → ridge (px), the eave already dropped by RDROP */
  h: number;
  /** the oblique half-depth shift (px) = dx / 2 */
  hx: number;
  /** plan ridge ends (px): L + a, R − a — where the 3D ridge is */
  x0: number; x1: number;
  /** the site's drawn ridge ends (roofRidge's return): plan + hx */
  sx0: number; sx1: number;
  /** the eave drop (px) */
  drop: number;
}
/** tk-art.js roofRidge(L, R, eY, rY, dx, o) — the same numbers, plus the plan ends (see the file comment). */
export function roofRidge3d(L: number, R: number, eY: number, rY: number, dx: number, o: { ins?: number } = {}): Ridge3d {
  const h = eY + RDROP - rY, hx = dx / 2, a = o.ins != null ? o.ins : Math.max(24, Math.min((R - L) * 0.3, h * 0.62 + hx * 0.5));
  return { a, h, hx, x0: L + a, x1: R - a, sx0: L + a + hx, sx1: R - a + hx, drop: RDROP };
}
/** roofTiles' row count for a slope of drawn length H (px) and first row height rh0 (px). */
export function roofRows(H: number, rh0: number, q = ROOF_Q): number {
  let s = 0, k = 0;
  for (; s < H - rh0 * 0.35 * Math.pow(q, k) && k < TEX_ROWS; k++) s += rh0 * Math.pow(q, k);
  return Math.max(1, k);
}
/** The numbers of one site roofV call (px): roofV(L, R, eY, rY, dx, dy, pal, seed, sw, sh, o). */
export interface SiteRoofV { L: number; R: number; eY: number; rY: number; dx: number; dy: number; sw?: number; sh?: number; ins?: number }
/** The ridge and the row counts roofV draws: front slope (FL FR RR RL) and the hip (FR SR RR). */
export function siteRoof(s: SiteRoofV): { ridge: Ridge3d; rows: number; sideRows: number; sw: number; sh: number } {
  const sw = s.sw ?? 32, sh = s.sh ?? 19, ridge = roofRidge3d(s.L, s.R, s.eY, s.rY, s.dx, { ins: s.ins });
  const eY = s.eY + RDROP, rxL = ridge.sx0, rxR = ridge.sx1;
  const front = Math.hypot((rxL + rxR) / 2 - (s.L + s.R) / 2, eY - s.rY);
  const side = Math.hypot(s.R + s.dx / 2 - rxR, eY - s.dy / 2 - s.rY);
  return { ridge, rows: roofRows(front, sh), sideRows: roofRows(side, sh), sw, sh };
}

/* ------------------------------------------------------------------ colours */
const _c = new THREE.Color(), _d = new THREE.Color();
/** sRGB mix of two hex colours (the site's opacity fills), as a hex string. */
export function mixHex(a: string, b: string, t: number): string {
  const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16), ch = (s: number) => Math.round(((pa >> s) & 255) * (1 - t) + ((pb >> s) & 255) * t);
  return '#' + ((ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).padStart(6, '0');
}
/** Saturation / value of the roof colours against the renderer's AgX tone mapping, which greys and lightens a lit
 *  slope: with them the tile body reads as the site's flat palette colour under the fair's day light (shots vs ref PNGs). */
const SAT = 1.25, VAL = 0.92;
/** A palette colour for the 'fcroof' material: divided by the plain texel, so the plain strip / tile body show it. */
export function roofCol(hex: string): THREE.Color {
  const c = new THREE.Color(hex), l = 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b, k = VAL / TB;
  return c.setRGB(Math.max(0, l + (c.r - l) * SAT) * k, Math.max(0, l + (c.g - l) * SAT) * k, Math.max(0, l + (c.b - l) * SAT) * k);
}

/* ------------------------------------------------------------------ plain-strip pieces */
const PLAIN_UV: [number, number] = [0.5, (SCV + 1) / 2];
const plainCache = new Map<THREE.BufferGeometry, THREE.BufferGeometry>();
/** A copy of a shared geometry whose UVs all sample the plain strip (flat colour in the 'fcroof' material). */
export function plainGeo(g: THREE.BufferGeometry): THREE.BufferGeometry {
  let p = plainCache.get(g);
  if (!p) {
    p = g.clone();
    const n = p.attributes.position.count, uv = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) { uv[i * 2] = PLAIN_UV[0]; uv[i * 2 + 1] = PLAIN_UV[1]; }
    p.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    plainCache.set(g, p);
  }
  return p;
}
const KNOB = new THREE.DodecahedronGeometry(0.5, 0);
/** A flat-coloured piece in the roof material (any shared geometry, matrix m). */
export function roofPiece(k: Ctx, g: THREE.BufferGeometry, m: THREE.Matrix4, col: string): void {
  k.b.add('fcroof', plainGeo(g), m, roofCol(col), 'keep');
}
/** Axis-aligned plain box in the roof material. */
export function roofBox(k: Ctx, col: string, x0: number, x1: number, y0: number, y1: number, z0: number, z1: number): void {
  roofPiece(k, GEO.box, M((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2, Math.abs(x1 - x0), Math.abs(y1 - y0), Math.abs(z1 - z0)), col);
}
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _m = new THREE.Matrix4(), _X = new THREE.Vector3(1, 0, 0);
/** A square bar a → b (world points), t thick, in the roof material. */
export function roofBar(k: Ctx, col: string, a: readonly number[], b: readonly number[], t: number): void {
  _a.set(a[0], a[1], a[2]); _b.set(b[0], b[1], b[2]).sub(_a);
  const len = _b.length(); if (len < 1e-4) return;
  _q.setFromUnitVectors(_X, _b.clone().divideScalar(len));
  _m.compose(_a.addScaledVector(_b, 0.5), _q, _s.set(len, t, t));
  roofPiece(k, GEO.box, _m, col);
}

/* ------------------------------------------------------------------ the hip roof */
export interface HipRoof3d {
  /** eave rectangle (m) at height y0; the ridge runs along x at (z0 + z1) / 2, y0 + h, from rx0 to rx1 */
  x0: number; x1: number; z0: number; z1: number; y0: number; h: number; rx0: number; rx1: number;
  /** the site palette [main, dark, light] (tk-art.js ROOF) */
  pal: readonly [string, string, string];
  /** scallop width in the eave row (m): the site's sw px on the model's x scale */
  tileW: number;
  /** tile rows on the front / back slopes and on the hips (roofTiles' counts: siteRoof) */
  rows: number; sideRows?: number;
  /** close the bottom (soffit colour) — false when the model has its own soffit board */
  soffit?: string | false;
  /** ridge cap thickness (m; the site's o.ridge + 2 px), 0 = none; ribs / lip thickness (m) */
  ridge?: number; rib?: number; lip?: number;
  /** lower / ridge band strength (roofTiles lowA / topA) */
  lowA?: number; topA?: number;
}
const BANDS = [0, 0.28, 0.7, 1];
/** Texture v of the slope fraction t on a roof of n rows (its rows are the texture's first n). */
export const rowV = (t: number, n: number): number => t * SCV * (1 - Math.pow(ROOF_Q, Math.min(n, TEX_ROWS))) / (1 - Math.pow(ROOF_Q, TEX_ROWS));

/** The tiled hip roof of the site's roofV (+ its ridge cap, knobs, hip ribs and eave lip), all in 'fcroof'. */
export function tileHipRoof(k: Ctx, r: HipRoof3d): void {
  const { x0, x1, z0, z1, y0, h, pal } = r, zc = (z0 + z1) / 2, y1 = y0 + h;
  let rx0 = Math.max(x0, Math.min(r.rx0, r.rx1)), rx1 = Math.min(x1, Math.max(r.rx0, r.rx1));
  if (rx1 - rx0 < 0.01) { const m = (rx0 + rx1) / 2; rx0 = rx1 = m; }
  const lowA = r.lowA ?? 0.12, topA = r.topA ?? 0.1;
  const cols = [roofCol(mixHex(pal[0], INK, lowA)), roofCol(pal[0]), roofCol(mixHex(pal[0], '#ffffff', topA))];
  const per = 1 / (TEX_K0 * Math.max(0.05, r.tileW));
  const pos: number[] = [], nor: number[] = [], uv: number[] = [], col: number[] = [];
  const nv = new THREE.Vector3(), e1 = new THREE.Vector3(), e2 = new THREE.Vector3();
  /** One slope: eave P0 → P1 (left → right seen from outside), ridge P3 (over P0) → P2 (over P1); u along `ue` (unit). */
  const face = (P0: number[], P1: number[], P2: number[], P3: number[], ue: [number, number, number], n: number) => {
    const at = (t: number, u: number) => { const a = P0.map((v, i) => v + (P3[i] - v) * t), b = P1.map((v, i) => v + (P2[i] - v) * t); return a.map((v, i) => v + (b[i] - v) * u); };
    e1.set(P1[0] - P0[0], P1[1] - P0[1], P1[2] - P0[2]); e2.set(P3[0] - P0[0], P3[1] - P0[1], P3[2] - P0[2]);
    if (e2.lengthSq() < 1e-8) e2.set(P2[0] - P0[0], P2[1] - P0[1], P2[2] - P0[2]);
    nv.crossVectors(e1, e2).normalize();
    const put = (p: number[], t: number, c: THREE.Color) => {
      pos.push(p[0], p[1], p[2]); nor.push(nv.x, nv.y, nv.z);
      uv.push((p[0] * ue[0] + p[1] * ue[1] + p[2] * ue[2]) * per, rowV(t, n)); col.push(c.r, c.g, c.b);
    };
    for (let b = 0; b < 3; b++) {
      const ta = BANDS[b], tb = BANDS[b + 1], c = cols[b];
      const A = at(ta, 0), B = at(ta, 1), C = at(tb, 1), D = at(tb, 0);
      put(A, ta, c); put(B, ta, c); put(C, tb, c);
      if (Math.hypot(C[0] - D[0], C[1] - D[1], C[2] - D[2]) > 1e-4) { put(A, ta, c); put(C, tb, c); put(D, tb, c); }
    }
  };
  const nF = r.rows, nS = r.sideRows ?? r.rows;
  face([x0, y0, z1], [x1, y0, z1], [rx1, y1, zc], [rx0, y1, zc], [1, 0, 0], nF);       // front (+z)
  face([x1, y0, z0], [x0, y0, z0], [rx0, y1, zc], [rx1, y1, zc], [-1, 0, 0], nF);      // back (−z)
  face([x1, y0, z1], [x1, y0, z0], [rx1, y1, zc], [rx1, y1, zc], [0, 0, -1], nS);      // right hip (+x)
  face([x0, y0, z0], [x0, y0, z1], [rx0, y1, zc], [rx0, y1, zc], [0, 0, 1], nS);       // left hip (−x)
  if (r.soffit) {
    const s = roofCol(r.soffit), q = [[x0, z1], [x1, z0], [x1, z1], [x0, z1], [x0, z0], [x1, z0]];
    for (const [x, z] of q) { pos.push(x, y0, z); nor.push(0, -1, 0); uv.push(PLAIN_UV[0], PLAIN_UV[1]); col.push(s.r, s.g, s.b); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  k.b.add('fcroof', g, M(0, 0, 0), null, 'keep'); g.dispose();
  // trims: hip ribs (light on the front-left, dark elsewhere), the eave lip, the ridge cap with its light line + knobs
  // the site inks every stroke (INK outline): trims are the palette colour pulled towards INK
  const rib = r.rib ?? 0.1, lip = r.lip ?? 0.08, t = r.ridge ?? 0.2, ribD = mixHex(pal[1], INK, 0.25), lift = rib * 0.3;
  if (rib > 0) {
    roofBar(k, pal[2], [x0, y0 + lift, z1], [rx0, y1 + lift, zc], rib); roofBar(k, ribD, [x1, y0 + lift, z1], [rx1, y1 + lift, zc], rib);
    roofBar(k, ribD, [x0, y0 + lift, z0], [rx0, y1 + lift, zc], rib); roofBar(k, ribD, [x1, y0 + lift, z0], [rx1, y1 + lift, zc], rib);
  }
  if (lip > 0) {
    const lc = mixHex(pal[1], INK, 0.55), ld = mixHex(pal[1], INK, 0.65);
    roofBox(k, lc, x0 - lip / 2, x1 + lip / 2, y0 - lip / 2, y0 + lip / 2, z1 - lip / 2, z1 + lip / 2);
    roofBox(k, ld, x0 - lip / 2, x1 + lip / 2, y0 - lip / 2, y0 + lip / 2 - 0.006, z0 - lip / 2, z0 + lip / 2);
    for (const x of [x0, x1]) roofBox(k, ld, x - lip / 2 + 0.003, x + lip / 2 - 0.003, y0 - lip / 2 + 0.003, y0 + lip / 2 - 0.003, z0 + lip / 2, z1 - lip / 2);
  }
  if (t > 0) {
    if (rx1 - rx0 > 0.02) {
      roofBox(k, pal[1], rx0, rx1, y1 - t * 0.55, y1 + t * 0.45, zc - t * 0.5, zc + t * 0.5);
      roofBox(k, pal[2], rx0 + 0.03, rx1 - 0.03, y1 + t * 0.12, y1 + t * 0.45 + 0.012, zc - t * 0.1, zc + t * 0.5 + 0.012);   // the light line along its top
    }
    for (const x of rx1 - rx0 > 0.02 ? [rx0, rx1] : [rx0]) roofPiece(k, KNOB, M(x, y1 + t * 0.2, zc, t * 1.3, t * 1.3, t * 1.3), mixHex(pal[1], INK, 0.12));
  }
}
/** Height of the roof's top surface along the ridge line (z = centre) at x (eave height outside the eave). */
export function hipRidgeAt(r: Pick<HipRoof3d, 'x0' | 'x1' | 'y0' | 'h' | 'rx0' | 'rx1'>, x: number): number {
  const fl = r.rx0 > r.x0 ? (x - r.x0) / (r.rx0 - r.x0) : 1, fr = r.x1 > r.rx1 ? (r.x1 - x) / (r.x1 - r.rx1) : 1;
  return r.y0 + r.h * Math.max(0, Math.min(1, fl, fr));
}

/* ------------------------------------------------------------------ the scallop texture */
let TEX: THREE.DataTexture | null = null;
/** Rows: bottom v (0…1 of the scallop region) of row k. */
const Vk = (k: number) => (1 - Math.pow(ROOF_Q, k)) / (1 - Math.pow(ROOF_Q, TEX_ROWS));
/** Scallops across the texture in row k (roofTiles: w = sw · (0.6 + 0.4 · q^k)). */
export const rowCount = (k: number): number => Math.max(1, Math.round(TEX_K0 / (0.6 + 0.4 * Math.pow(ROOF_Q, k))));
const hash2 = (a: number, b: number) => { const h = Math.sin(a * 127.1 + b * 311.7) * 43758.5453; return h - Math.floor(h); };

/** The scallop rows (W × H texels, linear grey): plain body TB, dark arcs, their shadow, highlight strokes. */
export function roofTexels(W = 512, H = 1024): Uint8Array {
  const data = new Uint8Array(W * H * 4), RH = H * SCV;
  // stroke sizes (texels): the site's 2.6 px edge, 6 px shadow 3.5 px below at .45, 3 px highlight at .8, scaled as the
  // site's eave row (sh ≈ 18 px) to the texture's (≈ 130 texels): ≈ 7 texels / px
  const WC = 18, WS = 40, OFF = 23, WH = 20;
  const D = TB * 0.3, S = TB * (1 - 0.5 * 0.68), L = Math.min(1, TB * 1.32);
  const yb = new Float64Array(TEX_ROWS + 1); for (let k = 0; k <= TEX_ROWS; k++) yb[k] = Vk(k) * RH;
  const cnt = new Int32Array(TEX_ROWS); for (let k = 0; k < TEX_ROWS; k++) cnt[k] = rowCount(k);
  for (let j = 0; j < H; j++) {
    const y = j + 0.5;
    if (y >= RH) { for (let i = 0; i < W; i++) { const o = (j * W + i) * 4; data[o] = data[o + 1] = data[o + 2] = Math.round(TB * 255); data[o + 3] = 255; } continue; }
    let k = 0; while (k < TEX_ROWS - 1 && yb[k + 1] <= y) k++;
    for (let i = 0; i < W; i++) {
      const x = i + 0.5;
      let core = 0, sh = 0, hi = 0;
      for (let m = Math.max(0, k - 1); m <= Math.min(TEX_ROWS - 1, k + 6); m++) {
        if (yb[m] - y > OFF + WS / 2 + 2) break;
        const rh = yb[m + 1] - yb[m], c = cnt[m], sw = W / c, fx = x / sw + (m % 2 ? 0.5 : 0), fi = Math.floor(fx), f = fx - fi;
        const arc = yb[m] + 2 * (f - 0.5) * (f - 0.5) * rh, slope = 4 * (f - 0.5) * rh / sw, d = (y - arc) / Math.sqrt(1 + slope * slope);
        core = Math.max(core, Math.min(1, Math.max(0, WC / 2 + 0.5 - Math.abs(d))));
        sh = Math.max(sh, Math.min(1, Math.max(0, WS / 2 + 0.5 - Math.abs(d + OFF))) * (d < WC / 2 ? 1 : 0));
        if (m === k || m === k - 1) {
          const idx = ((fi % c) + c) % c;
          if (hash2(m, idx) < 0.3) {
            const x0 = (fi - (m % 2 ? 0.5 : 0)) * sw;
            const ax = x0 + 0.22 * sw, ay = yb[m] + 0.55 * rh, bx = x0 + 0.55 * sw, by = yb[m] + 0.62 * rh;
            const vx = bx - ax, vy = by - ay, tt = Math.max(0, Math.min(1, ((x - ax) * vx + (y - ay) * vy) / (vx * vx + vy * vy)));
            const dd = Math.hypot(x - ax - vx * tt, y - ay - vy * tt), wh = Math.min(WH, rh * 0.18);
            hi = Math.max(hi, Math.min(1, Math.max(0, wh / 2 + 0.5 - dd)));
          }
        }
      }
      let v = TB;
      v = v + (S - v) * sh;
      v = v + (D - v) * core;
      v = v + (L - v) * hi * 0.8;
      const o = (j * W + i) * 4;
      data[o] = data[o + 1] = data[o + 2] = Math.round(Math.max(0, Math.min(1, v)) * 255); data[o + 3] = 255;
    }
  }
  return data;
}
/** The shared scallop texture (built once; RepeatWrapping along the eave). */
export function fcRoofTexture(): THREE.DataTexture {
  if (TEX) return TEX;
  const W = 512, H = 1024;
  const t = new THREE.DataTexture(roofTexels(W, H), W, H, THREE.RGBAFormat);
  t.wrapS = THREE.RepeatWrapping; t.wrapT = THREE.ClampToEdgeWrapping;
  t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true; t.anisotropy = 8;
  t.colorSpace = THREE.NoColorSpace; t.name = 'fcroof'; t.needsUpdate = true;
  return (TEX = t);
}
/** The 'fcroof' batch material: vertex colours × the scallop texture. */
export function fcRoofMaterial(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ vertexColors: true, map: fcRoofTexture(), roughness: 0.82, metalness: 0, name: 'city:fcroof' });
}
