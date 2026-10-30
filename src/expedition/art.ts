/**
 * Expedition art: procedural low-poly models as merged, vertex-coloured BufferGeometries (one draw call per model
 * kind, instanced). Everything looks to −Z at rotation 0 with feet at y = 0 (avatar convention). Colours are baked
 * per vertex; `aTint` (0..1) marks the parts the per-instance colour tints (cat fur), the rest keeps its colour.
 * Geometries are cached per key and released by `disposeArt()` (the scene calls it on dispose).
 */
import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { FoeArt } from './adapter';

/* ------------------------------------------------------------------ builder */

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _p = new THREE.Vector3(), _s = new THREE.Vector3();
/** Transform: translate, rotate (XYZ), scale (uniform or per axis). */
export function T(x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, s: number | [number, number, number] = 1): THREE.Matrix4 {
  _e.set(rx, ry, rz); _q.setFromEuler(_e); _p.set(x, y, z);
  if (typeof s === 'number') _s.set(s, s, s); else _s.set(s[0], s[1], s[2]);
  return new THREE.Matrix4().compose(_p, _q, _s);
}
const _c = new THREE.Color();
export class GB {
  private parts: THREE.BufferGeometry[] = [];
  add(g: THREE.BufferGeometry, color: THREE.ColorRepresentation, m?: THREE.Matrix4, tint = 0): this {
    const geo = g.index ? g : g;
    geo.deleteAttribute('uv'); geo.deleteAttribute('uv1');
    if (m) geo.applyMatrix4(m);
    const n = geo.attributes.position.count;
    _c.set(color);
    const col = new Float32Array(n * 3), tt = new Float32Array(n);
    for (let i = 0; i < n; i++) { col[i * 3] = _c.r; col[i * 3 + 1] = _c.g; col[i * 3 + 2] = _c.b; tt[i] = tint; }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setAttribute('aTint', new THREE.BufferAttribute(tt, 1));
    if (!geo.index) { const idx = new Array(n); for (let i = 0; i < n; i++) idx[i] = i; geo.setIndex(idx); }
    this.parts.push(geo);
    return this;
  }
  /** Emissive part: the tint material treats vertex colours above 1 as glow (colour × k). */
  addGlow(g: THREE.BufferGeometry, color: THREE.ColorRepresentation, m?: THREE.Matrix4, k = 2.2): this {
    this.add(g, color, m);
    const col = this.parts[this.parts.length - 1].attributes.color as THREE.BufferAttribute;
    for (let i = 0; i < col.array.length; i++) (col.array as Float32Array)[i] *= k;
    return this;
  }
  /** Part with a vertical colour gradient (c0 at y0 → c1 at y1, measured after the transform `m`). */
  addG(g: THREE.BufferGeometry, c0: THREE.ColorRepresentation, c1: THREE.ColorRepresentation, m: THREE.Matrix4, y0: number, y1: number, tint = 0): this {
    g.deleteAttribute('uv'); g.deleteAttribute('uv1');
    g.applyMatrix4(m);
    const n = g.attributes.position.count, A = new THREE.Color(c0), B = new THREE.Color(c1);
    const col = new Float32Array(n * 3), tt = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const t = Math.max(0, Math.min(1, (g.attributes.position.getY(i) - y0) / (y1 - y0 || 1)));
      _c.copy(A).lerp(B, t); col[i * 3] = _c.r; col[i * 3 + 1] = _c.g; col[i * 3 + 2] = _c.b; tt[i] = tint;
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setAttribute('aTint', new THREE.BufferAttribute(tt, 1));
    if (!g.index) { const idx = new Array(n); for (let i = 0; i < n; i++) idx[i] = i; g.setIndex(idx); }
    this.parts.push(g);
    return this;
  }
  build(): THREE.BufferGeometry {
    const g = mergeGeometries(this.parts, false) || new THREE.BufferGeometry();
    for (const p of this.parts) p.dispose();
    this.parts = [];
    g.computeBoundingSphere();
    return g;
  }
}
/** Foe LOD: inside foeGeo small spheres get fewer segments (keeps every foe ≈ ≤ 1.1k triangles). */
let foeLod = false;
const sph = (r: number, w = 12, h = 9, ps = 0, pl = Math.PI * 2, ts = 0, tl = Math.PI) => {
  if (foeLod) { const k = r < 0.04 ? 0.6 : r < 0.1 ? 0.7 : r < 0.2 ? 0.8 : r < 0.4 ? 0.9 : 1; w = Math.max(4, Math.round(w * k)); h = Math.max(3, Math.round(h * k)); }
  return new THREE.SphereGeometry(r, w, h, ps, pl, ts, tl);
};
const lodSides = (s: number) => (foeLod && s > 8 ? Math.round(s * 0.8) : s);
const cyl = (rt: number, rb: number, h: number, s = 10) => new THREE.CylinderGeometry(rt, rb, h, lodSides(s));
const cone = (r: number, h: number, s = 8) => new THREE.ConeGeometry(r, h, lodSides(s));
const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);
const tor = (r: number, t: number, arc = Math.PI * 2, rs = 6, ts = 16) => new THREE.TorusGeometry(r, t, rs, ts, arc);
const ico = (r: number, d = 0) => new THREE.IcosahedronGeometry(r, d);
const dod = (r: number) => new THREE.DodecahedronGeometry(r, 0);

const cache = new Map<string, THREE.BufferGeometry>();
function cached(key: string, make: () => THREE.BufferGeometry): THREE.BufferGeometry {
  let g = cache.get(key);
  if (!g) { g = make(); g.name = 'exp:' + key; cache.set(key, g); }
  return g;
}
/** Whole model tinted by the instance colour (foes, boss: flash / dead greying). */
function tinted(g: THREE.BufferGeometry): THREE.BufferGeometry { (g.attributes.aTint.array as Float32Array).fill(1); return g; }
/**
 * Outline hull geometry: positions welded and normals averaged, so the inverted hull of faceted parts (boxes, cones,
 * polyhedra) stays closed instead of breaking into dashed slivers at the hard edges.
 */
const hulls = new Map<THREE.BufferGeometry, THREE.BufferGeometry>();
export function hullGeo(g: THREE.BufferGeometry): THREE.BufferGeometry {
  let h = hulls.get(g);
  if (h) return h;
  const p = new THREE.BufferGeometry();
  p.setAttribute('position', g.attributes.position.clone());
  if (g.index) p.setIndex(g.index.clone());
  h = mergeVertices(p, 1e-3);
  p.dispose();
  h.computeVertexNormals();
  h.computeBoundingSphere();
  hulls.set(g, h);
  return h;
}
export function disposeArt(): void { for (const g of cache.values()) g.dispose(); cache.clear(); for (const h of hulls.values()) h.dispose(); hulls.clear(); }
export const artCacheSize = () => cache.size;

/* ------------------------------------------------------------------ the generic party cat */

export type CatVariant = 'shield' | 'melee' | 'bow' | 'staff' | 'priest';
export const CAT_VARIANTS: readonly CatVariant[] = ['shield', 'melee', 'bow', 'staff', 'priest'];
export const catVariant = (role: string): CatVariant =>
  role === 'legionary' || role === 'paladin' ? 'shield' : role === 'archer' ? 'bow' : role === 'mage' || role === 'necromancer' ? 'staff' : role === 'priest' ? 'priest' : 'melee';

/** Chibi cat ~0.95 m: fur parts tinted by the instance colour (per login), face and gear keep their colours. */
export function catGeo(v: CatVariant): THREE.BufferGeometry {
  return cached('cat:' + v, () => {
    const b = new GB();
    const FUR = '#ffffff';
    b.add(sph(0.29, 10, 7), FUR, T(0, 0.36, 0, 0, 0, 0, [1, 1.12, 0.95]), 1);
    b.add(sph(0.19, 6, 4), '#fff4e2', T(0, 0.33, -0.17, 0, 0, 0, [1, 1.1, 0.55]), 0);
    b.add(sph(0.3, 11, 8), FUR, T(0, 0.83, 0, 0, 0, 0, [1.1, 0.94, 0.98]), 1);
    for (const s of [-1, 1]) {
      b.add(cone(0.1, 0.2, 5), FUR, T(s * 0.17, 1.08, 0.02, 0, 0, -s * 0.38), 1);
      b.add(cone(0.055, 0.12, 4), '#ffb3c4', T(s * 0.165, 1.06, -0.035, 0, 0, -s * 0.38), 0);
      b.add(sph(0.058, 6, 4), '#231a2c', T(s * 0.105, 0.85, -0.265, 0, 0, 0, [1, 1.15, 0.6]), 0);
      b.add(sph(0.02, 4, 2), '#ffffff', T(s * 0.09, 0.88, -0.3), 0);
      b.add(sph(0.045, 4, 2), '#ff9db0', T(s * 0.19, 0.77, -0.235, 0, 0, 0, [1, 0.6, 0.4]), 0);
      b.add(sph(0.09, 5, 3), FUR, T(s * 0.13, 0.055, -0.07, 0, 0, 0, [1, 0.7, 1.25]), 1);
      b.add(sph(0.08, 5, 3), FUR, T(s * 0.29, 0.4, -0.06), 1);
    }
    b.add(sph(0.026, 4, 2), '#ff7f9c', T(0, 0.79, -0.295), 0);
    b.add(sph(0.075, 5, 3), FUR, T(0, 0.3, 0.29), 1);
    b.add(sph(0.065, 5, 3), FUR, T(0, 0.48, 0.39), 1);
    b.add(sph(0.058, 5, 3), FUR, T(0.02, 0.66, 0.42), 1);
    switch (v) {
      case 'shield':
        b.add(cyl(0.25, 0.25, 0.05, 14), '#c9a36a', T(-0.3, 0.43, -0.2, Math.PI / 2, 0, 0.25), 0);
        b.add(tor(0.245, 0.025, Math.PI * 2, 5, 16), '#8a5a2a', T(-0.3, 0.43, -0.23, 0, 0.25, 0), 0);
        b.add(sph(0.06, 8, 6), '#e8e2d0', T(-0.31, 0.43, -0.26), 0);
        b.add(sph(0.31, 12, 8, ), '#b8c2cc', T(0, 0.92, 0.02, 0, 0, 0, [1.08, 0.62, 1.0]), 0);
        b.add(box(0.05, 0.16, 0.34), '#d8344a', T(0, 1.18, 0.04), 0);
        b.add(box(0.05, 0.36, 0.035), '#dfe6ee', T(0.33, 0.6, -0.12, 0.3, 0, 0), 0);
        break;
      case 'melee':
        b.add(box(0.055, 0.5, 0.025), '#e4ebf2', T(0.34, 0.66, -0.14, 0.35, 0, 0), 0);
        b.add(box(0.2, 0.04, 0.05), '#c8a04a', T(0.34, 0.43, -0.06, 0.35, 0, 0), 0);
        b.add(cyl(0.025, 0.025, 0.12, 6), '#6a4a30', T(0.34, 0.37, -0.04, 0.35, 0, 0), 0);
        b.add(tor(0.27, 0.035, Math.PI * 2, 5, 16), '#d84a3a', T(0, 0.96, 0, Math.PI / 2, 0, 0, [1.05, 1, 1]), 0);
        break;
      case 'bow':
        b.add(tor(0.3, 0.022, Math.PI * 1.15, 5, 14), '#8a5a2a', T(-0.34, 0.5, -0.12, 0, Math.PI / 2, Math.PI * 0.43), 0);
        b.add(cyl(0.006, 0.006, 0.55, 3), '#f4eedc', T(-0.34, 0.5, -0.05), 0);
        b.add(cyl(0.07, 0.06, 0.4, 8), '#7a5436', T(0.12, 0.52, 0.27, -0.4, 0, -0.3), 0);
        b.add(cone(0.24, 0.3, 10), '#4f8a4a', T(0, 1.07, 0.06, -0.25, 0, 0), 0);
        break;
      case 'staff':
        b.add(cyl(0.022, 0.026, 1.0, 6), '#7a5436', T(0.33, 0.5, -0.1), 0);
        b.add(ico(0.085, 1), '#9fd8ff', T(0.33, 1.05, -0.1), 0);
        b.add(cyl(0.34, 0.34, 0.03, 14), '#3f4fb0', T(0, 1.02, 0), 0);
        b.add(cone(0.22, 0.42, 10), '#3f4fb0', T(0, 1.24, 0.03, -0.18, 0, 0), 0);
        b.add(sph(0.035, 6, 4), '#ffd34d', T(0, 1.2, -0.13), 0);
        break;
      case 'priest':
        b.add(tor(0.17, 0.026, Math.PI * 2, 5, 18), '#ffe27a', T(0, 1.25, 0.02, Math.PI / 2, 0, 0), 0);
        b.add(box(0.2, 0.25, 0.06), '#f4eedc', T(-0.05, 0.43, -0.27, -0.2, 0, 0), 0);
        b.add(box(0.03, 0.12, 0.065), '#e8b84a', T(-0.05, 0.43, -0.275, -0.2, 0, 0), 0);
        b.add(cyl(0.3, 0.36, 0.3, 14), '#f8f4ff', T(0, 0.2, 0), 0);
        break;
    }
    return b.build();
  });
}

/** Far / crowd LOD of the cat (~250 triangles, no outline): body, head, ears, eyes and the class item. */
export function catGeoLow(v: CatVariant): THREE.BufferGeometry {
  return cached('catlow:' + v, () => {
    const b = new GB();
    b.add(sph(0.29, 7, 5), '#ffffff', T(0, 0.36, 0, 0, 0, 0, [1, 1.12, 0.95]), 1);
    b.add(sph(0.3, 8, 6), '#ffffff', T(0, 0.83, 0, 0, 0, 0, [1.1, 0.94, 0.98]), 1);
    for (const s of [-1, 1]) {
      b.add(cone(0.1, 0.2, 4), '#ffffff', T(s * 0.17, 1.08, 0.02, 0, 0, -s * 0.38), 1);
      b.add(sph(0.06, 4, 2), '#231a2c', T(s * 0.105, 0.85, -0.265, 0, 0, 0, [1, 1.15, 0.6]), 0);
    }
    const item: Record<CatVariant, [THREE.BufferGeometry, string, THREE.Matrix4]> = {
      shield: [cyl(0.25, 0.25, 0.05, 8), '#c9a36a', T(-0.3, 0.43, -0.2, Math.PI / 2, 0, 0.25)],
      melee: [box(0.055, 0.5, 0.025), '#e4ebf2', T(0.34, 0.66, -0.14, 0.35, 0, 0)],
      bow: [tor(0.3, 0.025, Math.PI * 1.15, 3, 8), '#8a5a2a', T(-0.34, 0.5, -0.12, 0, Math.PI / 2, Math.PI * 0.43)],
      staff: [cone(0.22, 0.42, 6), '#3f4fb0', T(0, 1.24, 0.03, -0.18, 0, 0)],
      priest: [tor(0.17, 0.03, Math.PI * 2, 3, 10), '#ffe27a', T(0, 1.25, 0.02, Math.PI / 2, 0, 0)],
    };
    const [g, c, m] = item[v];
    b.add(g, c, m, 0);
    return b.build();
  });
}
/** Coarse closed hull for the cat's outline (body, head, ears): ~180 triangles instead of the full model. */
export function catHullGeo(): THREE.BufferGeometry {
  return cached('cathull', () => {
    const b = new GB();
    b.add(sph(0.29, 8, 5), '#000', T(0, 0.36, 0, 0, 0, 0, [1, 1.12, 0.95]));
    b.add(sph(0.3, 9, 6), '#000', T(0, 0.83, 0, 0, 0, 0, [1.1, 0.94, 0.98]));
    for (const s of [-1, 1]) b.add(cone(0.1, 0.2, 4), '#000', T(s * 0.17, 1.08, 0.02, 0, 0, -s * 0.38));
    return b.build();
  });
}

/* ------------------------------------------------------------------ foes */
/*
 * The foes follow the site's own drawings (questfoes.js: «Легион» wolf/skeleton/bandit/toad, the Halloween
 * 'enemies-hollow' set): the same palettes, proportions and signature details, rebuilt as low-poly 3D. The site draws
 * them in profile looking LEFT (feet at 0, ~160 px tall); here front = −Z, so a site x maps to our z and −y to our y.
 */
type V3 = [number, number, number];
const _up = new THREE.Vector3(0, 1, 0), _dir = new THREE.Vector3();
/** Tapered limb from a to c (radius r0 at a, r1 at c). */
function seg(b: GB, a: V3, c: V3, r0: number, r1: number, col: string, s = 6): void {
  _dir.set(c[0] - a[0], c[1] - a[1], c[2] - a[2]);
  const L = _dir.length(); if (L < 1e-5) return;
  _dir.multiplyScalar(1 / L);
  const q = new THREE.Quaternion().setFromUnitVectors(_up, _dir);
  b.add(cyl(r1, r0, L, s), col, new THREE.Matrix4().compose(new THREE.Vector3((a[0] + c[0]) / 2, (a[1] + c[1]) / 2, (a[2] + c[2]) / 2), q, new THREE.Vector3(1, 1, 1)));
}
/** Bent limb through points (radius r0 → r1), joints rounded. */
function limb(b: GB, pts: V3[], r0: number, r1: number, col: string, s = 6): void {
  const n = pts.length - 1;
  for (let i = 0; i < n; i++) {
    const ra = r0 + (r1 - r0) * i / n, rb = r0 + (r1 - r0) * (i + 1) / n;
    seg(b, pts[i], pts[i + 1], ra, rb, col, s);
    if (i > 0) b.add(sph(ra, s, 4), col, T(pts[i][0], pts[i][1], pts[i][2]));
  }
}
/**
 * Flat slab from an outline [u0, v0, u1, v1, …] (metres): 'side' = our ZY plane (u → z, v → y, thickness along X,
 * centred at x = off); 'front' = XY plane (u → x, v → y, thickness along Z, centred at z = off).
 */
function slab(pts: readonly number[], d: number, plane: 'side' | 'front', off = 0): THREE.BufferGeometry {
  const s = new THREE.Shape();
  for (let i = 0; i < pts.length; i += 2) { if (i) s.lineTo(pts[i], pts[i + 1]); else s.moveTo(pts[i], pts[i + 1]); }
  const g = new THREE.ExtrudeGeometry(s, { depth: d, bevelEnabled: false, curveSegments: 2 });
  g.translate(0, 0, -d / 2);
  if (plane === 'side') { g.rotateY(-Math.PI / 2); g.translate(off, 0, 0); } else g.translate(0, 0, off);
  return g;
}
const mirrorU = (pts: readonly number[]) => pts.map((v, i) => (i % 2 ? v : -v));
/** Ragged hem: n downward spikes around a ring (rags, sheets, robes). */
function hem(b: GB, y: number, r: number, n: number, len: number, col: string, z0 = 0, sx = 1): void {
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + 0.3, l = len * (i % 2 ? 0.6 : 1);
    b.add(cone(r * 0.42, l, 4), col, T(Math.sin(a) * r * sx, y - l / 2, z0 + Math.cos(a) * r, Math.PI, 0, 0));
  }
}
/** Jack-o'-lantern head (the site's pumpkinHead): ribbed rotten pumpkin, rot patches, glowing triangle eyes + jagged grin, vine stem. */
function pumpkinHead(b: GB, y: number, r: number, body: string, glow: string, z = 0): void {
  b.add(sph(r, 10, 7), body, T(0, y, z, 0, 0, 0, [1.05, 0.86, 0.98]));
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
    b.add(sph(r * 0.62, 7, 5), i % 2 ? body : HW.pumpD, T(Math.sin(a) * r * 0.46, y, z + Math.cos(a) * r * 0.46, 0, a, 0, [0.7, 0.9, 1]));
  }
  b.add(sph(r * 0.3, 6, 4), HW.rotP, T(r * 0.55, y + r * 0.15, z - r * 0.62, 0, 0, 0, [0.7, 1, 0.5]));
  const f = z - r * 0.84, d = r * 0.36;
  for (const s of [-1, 1]) b.add(slab([-r * 0.2, 0, r * 0.2, 0, s * 0.03 * r, r * 0.38], d, 'front', f), glow, T(s * r * 0.36, y + r * 0.0, 0));
  b.add(slab([-r * 0.62, 0, r * 0.62, 0, r * 0.42, -r * 0.3, r * 0.22, -r * 0.16, 0, -r * 0.34, -r * 0.22, -r * 0.16, -r * 0.42, -r * 0.3], d, 'front', f + r * 0.08), glow, T(0, y - r * 0.2, 0));
  limb(b, [[0, y + r * 0.65, z], [r * 0.02, y + r * 1.12, z + r * 0.08], [-r * 0.2, y + r * 1.36, z + r * 0.02], [-r * 0.42, y + r * 1.3, z - r * 0.06]], r * 0.16, r * 0.08, '#4f5e46', 5);
}
/** Halloween palette (site enemies-hollow C): cold rot, rags, bone; warm light only in pumpkins and lanterns, red only in eyes. */
const HW = {
  rot: '#76857c', rotD: '#55635c', cloth: '#3a4150', clothD: '#272c37', dark: '#21242c', wood: '#3a3530', woodD: '#28241f',
  straw: '#7d7660', strawD: '#5c5748', bone: '#c4beac', boneD: '#9c9686', ghost: '#b4c2d8', ghostD: '#8a98b0', ghostL: '#d6e0ee',
  lilac: '#6a5a8a', lilacL: '#8a7aa8', fur: '#1a1c24', furL: '#2e323e', pump: '#b8561c', pumpD: '#7e3a14', rotP: '#4e3a2c',
  vine: '#3a4436', fire: '#ffb347', fireY: '#ffd34d', eye: '#e0283a', hole: '#0b0c10', metal: '#6a6e78',
};

/** Head height (m, unscaled) — crowns, hp bars and telegraph signs sit above it. */
export const FOE_TOP: Record<FoeArt, number> = {
  wolf: 1.15, skeleton: 1.62, bandit: 1.42, boar: 1.0, drowner: 1.35, spider: 0.95, bat: 1.85, ghost: 1.45, slime: 0.95, pumpkin: 1.32, golem: 1.75,
  pumpkinlet: 0.66, cat: 1.15, zombie: 1.5, scarecrow: 1.76, witch: 1.95, crow: 1.5, jack: 2.3, toad: 1.55, bones: 1.6,
  wolfLead: 1.4, skeletonLead: 1.87, banditLead: 1.42, toadLead: 1.69, ghostLead: 1.8, batLead: 1.85, spiderLead: 1.2, zombieLead: 1.73, bonesLead: 1.75, witchLead: 2.2, catLead: 1.32, scarecrowLead: 1.76, rat: 1.25, beast: 1.0, lavaslime: 0.5, splasher: 1.1, crab: 0.85, mushroom: 1.1, shroom: 1.0, mummy: 1.55, imp: 1.32, icelet: 1.35, potion: 1.03, book: 1.12, blade: 1.68, sandworm: 1.2, tentacle: 1.7, automaton: 1.1, stonegolem: 1.32, shade: 1.73, voidling: 1.35, minerghost: 1.62, knight: 1.46, monk: 1.57, tinnik: 1.3, frostdead: 1.5, sailor: 1.53, prisoner: 1.5, widow: 1.2, skullguard: 1.44, squire: 1.6, smuggler: 1.42,
};
/** Body radius for hits. */
export const FOE_R: Record<FoeArt, number> = {
  wolf: 0.6, skeleton: 0.4, bandit: 0.45, boar: 0.55, drowner: 0.5, spider: 0.7, bat: 0.5, ghost: 0.45, slime: 0.5, pumpkin: 0.42, golem: 0.62,
  pumpkinlet: 0.3, cat: 0.5, zombie: 0.42, scarecrow: 0.5, witch: 0.6, crow: 0.4, jack: 0.45, toad: 0.45, bones: 0.4,
  wolfLead: 0.6, skeletonLead: 0.45, banditLead: 0.45, toadLead: 0.5, ghostLead: 0.55, batLead: 0.6, spiderLead: 0.75, zombieLead: 0.45, bonesLead: 0.45, witchLead: 0.6, catLead: 0.5, scarecrowLead: 0.5, rat: 0.4, beast: 0.6, lavaslime: 0.5, splasher: 0.45, crab: 0.5, mushroom: 0.4, shroom: 0.55, mummy: 0.4, imp: 0.4, icelet: 0.45, potion: 0.35, book: 0.4, blade: 0.3, sandworm: 0.45, tentacle: 0.35, automaton: 0.45, stonegolem: 0.6, shade: 0.5, voidling: 0.42, minerghost: 0.45, knight: 0.4, monk: 0.4, tinnik: 0.4, frostdead: 0.42, sailor: 0.42, prisoner: 0.42, widow: 0.75, skullguard: 0.45, squire: 0.4, smuggler: 0.45,
};
/** Local z of the head (front = −Z): hp bars and crowns sit over the head, not over the body centre. */
export const FOE_HEAD_Z: Partial<Record<FoeArt, number>> = { wolf: -0.75, wolfLead: -0.75, beast: -0.7, boar: -0.5, cat: -0.5, catLead: -0.5, crab: -0.2, rat: -0.12 };
const sizes = new Map<FoeArt, [number, number]>();
/** Footprint of a model: [length along the facing (z), width (x)] in metres (unscaled), from its geometry. */
export function foeSize(a: FoeArt): [number, number] {
  let v = sizes.get(a);
  if (!v) { const g = foeGeo(a); if (!g.boundingBox) g.computeBoundingBox(); const bb = g.boundingBox!; v = [bb.max.z - bb.min.z, bb.max.x - bb.min.x]; sizes.set(a, v); }
  return v;
}
/** Fliers bob in the air (and drop by this much when they die). */
export const FOE_FLY: Record<FoeArt, number> = {
  wolf: 0, skeleton: 0, bandit: 0, boar: 0, drowner: 0, spider: 0, bat: 1.0, ghost: 0.25, slime: 0, pumpkin: 0, golem: 0,
  pumpkinlet: 0, cat: 0, zombie: 0, scarecrow: 0, witch: 0.5, crow: 0.9, jack: 0, toad: 0, bones: 0,
  wolfLead: 0, skeletonLead: 0, banditLead: 0, toadLead: 0, ghostLead: 0.25, batLead: 0.3, spiderLead: 0, zombieLead: 0, bonesLead: 0, witchLead: 0.5, catLead: 0, scarecrowLead: 0, rat: 0, beast: 0, lavaslime: 0, splasher: 0, crab: 0, mushroom: 0, shroom: 0, mummy: 0, imp: 0, icelet: 0, potion: 0, book: 0, blade: 0, sandworm: 0, tentacle: 0, automaton: 0, stonegolem: 0, shade: 0.2, voidling: 0.25, minerghost: 0.25, knight: 0, monk: 0, tinnik: 0, frostdead: 0, sailor: 0, prisoner: 0, widow: 0, skullguard: 0, squire: 0, smuggler: 0,
};

/** Whole-model scale of some leaders (the site draws them bigger: spider widow ×1.25, the maze beast). */
const FOE_SCALE: Partial<Record<FoeArt, number>> = { spiderLead: 1.2, widow: 1.25, beast: 1.15 };
export function foeGeo(a: FoeArt): THREE.BufferGeometry {
  return cached('foe:' + a, () => {
    foeLod = true;
    try { const g = foeBuild(a); const k = FOE_SCALE[a]; if (k) { g.scale(k, k, k); g.computeBoundingSphere(); } return g; } finally { foeLod = false; }
  });
}
function foeBuild(a: FoeArt): THREE.BufferGeometry {
  {
    const b = new GB();
    const INK = '#15122e';
    switch (a) {
      case 'wolf': case 'wolfLead': {
        // «Легион» wolf v2 (grey coat): long low body, light belly, dark saddle, a light fluffy ruff, the head carried low
        // on a thick neck, tall ears, long snout with a light jaw, amber almond eye, short stubby legs on round paws, a
        // bushy plume tail rising from the rump in an S with a light tip. The pack leader (o.boss): a coal coat, a red eye
        // with a scar, a gold crown of spikes between the ears, a pale collar with a gold ring and the tail raised high
        const lead = a === 'wolfLead';
        const M = lead ? '#4a4458' : '#7a7488', D = lead ? '#2e2a3a' : '#5a5468', L = lead ? '#a4a2b2' : '#a8a2b4', E = lead ? '#ff3b3b' : '#ffd34d';
        const RUFF = lead ? '#d8d4e0' : L;
        b.add(sph(0.36, 9, 6), M, T(0, 0.6, 0.08, 0, 0, 0, [0.8, 0.82, 1.7]));
        b.add(sph(0.3, 8, 5), D, T(0, 0.72, 0.16, 0, 0, 0, [0.7, 0.42, 1.55]));
        b.add(sph(0.26, 8, 5), L, T(0, 0.42, 0.02, 0, 0, 0, [0.72, 0.36, 1.8]));
        for (const s of [-1, 1]) for (const z of [-0.36, 0.5]) {
          const c = s < 0 ? M : D;
          seg(b, [s * 0.14, 0.5, z], [s * 0.14, 0.08, z - 0.03], 0.09, 0.07, c, 6);
          b.add(sph(0.085, 6, 4), c, T(s * 0.14, 0.055, z - 0.07, 0, 0, 0, [1, 0.62, 1.45]));
        }
        // thick neck and the ruff: overlapping light balls at the throat and chest (no loose shards)
        b.add(sph(0.25, 8, 6), M, T(0, 0.68, -0.46, 0.45, 0, 0, [0.88, 1, 1.25]));
        b.add(sph(0.2, 8, 5), RUFF, T(0, 0.52, -0.56, 0, 0, 0, [0.95, 1.1, 0.75]));
        for (const s of [-1, 1]) b.add(sph(0.13, 6, 3), RUFF, T(s * 0.12, 0.64, -0.6, 0, 0, 0, [0.7, 1, 0.8]));
        // head: skull, snout, light jaw, nose, teeth, eyes, ears
        b.add(sph(0.2, 8, 6), M, T(0, 0.66, -0.72, 0, 0, 0, [0.95, 0.92, 1.15]));
        seg(b, [0, 0.64, -0.82], [0, 0.57, -1.2], 0.12, 0.065, M, 7);
        b.add(sph(0.1, 8, 5), L, T(0, 0.52, -1.0, 0, 0, 0, [0.9, 0.5, 2.0]));
        b.add(sph(0.05, 6, 4), INK, T(0, 0.6, -1.22));
        b.add(box(0.13, 0.02, 0.3), INK, T(0, 0.555, -1.02));
        for (const s of [-1, 1]) {
          b.add(cone(0.02, 0.06, 4), '#ffffff', T(s * 0.05, 0.53, -1.08, Math.PI, 0, 0));
          b.add(sph(0.06, 7, 5), E, T(s * 0.13, 0.72, -0.86, 0, 0, s * 0.3, [0.7, 0.55, 1.25]));
          b.add(sph(0.026, 5, 4), INK, T(s * 0.165, 0.72, -0.9));
          b.add(cone(0.085, 0.34, 4), M, T(s * 0.1, 0.96, -0.66, -0.12, 0, -s * 0.14));
          b.add(cone(0.045, 0.2, 4), L, T(s * 0.105, 0.92, -0.7, -0.12, 0, -s * 0.14));
        }
        // tail plume: rooted inside the rump, swelling then tapering to a light tip (S-curve up and back)
        const tp: V3[] = lead ? [[0, 0.62, 0.6], [0, 0.74, 0.84], [0, 0.96, 0.98], [0, 1.16, 0.96], [0, 1.28, 0.84]]
          : [[0, 0.58, 0.6], [0, 0.66, 0.86], [0, 0.82, 1.04], [0, 1.0, 1.12], [0, 1.14, 1.1]];
        const tr = [0.085, 0.12, 0.14, 0.12, 0.085];
        for (let i = 0; i < 4; i++) seg(b, tp[i], tp[i + 1], tr[i], tr[i + 1], M, 6);
        for (let i = 2; i < 4; i++) b.add(sph(tr[i], 6, 4), M, T(...tp[i]));
        b.add(sph(0.1, 7, 5), L, T(tp[4][0], tp[4][1] + 0.02, tp[4][2], 0, 0, 0, [0.9, 1.15, 0.9]));
        if (lead) {
          b.add(tor(0.22, 0.03, Math.PI * 2, 3, 8), '#d8d0c0', T(0, 0.64, -0.5, 0.95, 0, 0, [0.9, 1, 1]));
          b.add(tor(0.04, 0.014, Math.PI * 2, 3, 6), '#e8b13a', T(0, 0.48, -0.68, 0.4, 0, 0));
          b.add(cyl(0.13, 0.15, 0.06, 6), '#e8b13a', T(0, 0.84, -0.7));
          for (let i = -2; i <= 2; i++) b.add(cone(0.045, 0.2 - Math.abs(i) * 0.04, 4), '#e8b13a', T(Math.sin(i * 0.5) * 0.13, 0.95, -0.7 - Math.cos(i * 0.5) * 0.06, 0, 0, -i * 0.15));
          }
        break;
      }
      case 'skeleton': {
        // «Легион» skeleton: ivory bones, yellow-glowing sockets, dented iron helm, rusty iron pauldron, leather belt,
        // tattered brown cloak behind, a notched rusty sword (the Изнанка bone-man shares this model)
        const BONE = '#e2dac2', BONE2 = '#c4b994', IRON = '#8e959c', IRON_D = '#5f666d', RUST = '#9c5a32', CLOAK = '#7a5236', LEATHER = '#5a3a24';
        b.add(slab([-0.12, 1.1, 0.12, 1.1, 0.24, 0.04, 0.16, 0.12, 0.08, 0.02, 0.0, 0.14, -0.08, 0.03, -0.14, 0.13, -0.2, 0.05], 0.34, 'side'), CLOAK, T(0, 0, 0.17));
        for (const s of [-1, 1]) {
          limb(b, [[s * 0.07, 0.58, 0.0], [s * 0.1, 0.3, -0.05], [s * 0.1, 0.06, 0.0]], 0.04, 0.035, BONE, 5);
          b.add(box(0.07, 0.04, 0.16), BONE, T(s * 0.1, 0.03, -0.06));
        }
        b.add(box(0.26, 0.09, 0.13), BONE2, T(0, 0.6, 0));
        b.add(cyl(0.16, 0.16, 0.06, 10), LEATHER, T(0, 0.66, 0));
        b.add(box(0.07, 0.07, 0.03), '#c9a24a', T(0, 0.66, -0.16));
        seg(b, [0, 0.62, 0.02], [0, 1.1, 0.02], 0.03, 0.03, BONE, 5);
        b.add(sph(0.13, 8, 6), '#2a2436', T(0, 0.9, 0.01, 0, 0, 0, [1, 1.5, 0.8]));
        for (let i = 0; i < 4; i++) b.add(tor(0.14 - i * 0.012, 0.028, Math.PI * 1.4, 3, 7), BONE, T(0, 0.78 + i * 0.08, 0.0, Math.PI / 2, 0, -Math.PI * 0.2, [1.1, 0.8, 1]));
        b.add(sph(0.07, 7, 5), BONE, T(-0.19, 1.07, 0));
        b.add(sph(0.11, 8, 6), IRON, T(0.2, 1.08, 0, 0, 0, -0.4, [1.1, 0.7, 1.1]));
        b.add(sph(0.025, 4, 3), RUST, T(0.27, 1.12, -0.06));
        // far arm hangs, near arm holds the sword forward
        limb(b, [[0.2, 1.05, 0.02], [0.24, 0.84, 0.06], [0.22, 0.64, 0.0]], 0.032, 0.028, BONE, 5);
        limb(b, [[-0.2, 1.05, 0.0], [-0.32, 1.22, -0.12], [-0.3, 1.44, -0.16]], 0.034, 0.03, BONE, 5);
        seg(b, [-0.3, 1.38, -0.2], [-0.3, 1.78, 0.1], 0.04, 0.05, BONE, 5);
        for (const o of [-1, 1]) { b.add(sph(0.055, 6, 4), BONE, T(-0.3 + o * 0.035, 1.8, 0.12)); b.add(sph(0.045, 6, 4), BONE2, T(-0.3 + o * 0.03, 1.36, -0.22)); }
        // skull, jaw, sockets with yellow embers, helm
        b.add(sph(0.26, 10, 7), BONE, T(0, 1.36, -0.02, 0, 0, 0, [0.95, 1, 1]));
        b.add(box(0.22, 0.11, 0.18), BONE, T(0, 1.14, -0.08));
        for (let i = 0; i < 4; i++) b.add(box(0.014, 0.06, 0.02), INK, T(-0.066 + i * 0.044, 1.14, -0.175));
        for (const s of [-1, 1]) { b.add(sph(0.085, 7, 5), INK, T(s * 0.095, 1.34, -0.18, 0, 0, 0, [1, 1, 0.7])); b.add(sph(0.035, 5, 4), '#ffd36a', T(s * 0.095, 1.34, -0.235)); }
        b.add(sph(0.23, 12, 5), IRON, T(0, 1.48, 0.03, -0.3, 0, 0, [1.06, 0.6, 1.06]));
        b.add(sph(0.03, 4, 3), RUST, T(0.13, 1.56, -0.08));
        break;
      }
      case 'bones': case 'bonesLead': {
        // Leader («Костяной страж», o.boss): a metal skull-cap with curved horns and a coffin-lid shield with a bone cross
        const lead = a === 'bonesLead';
        // Изнанка bone-man (hw_skeleton): grey bones, a black ribcage with pale ribs, red embers in the sockets and a crack
        // in the skull, a rusty notched sword forward and a scrap of slate cloth as a shield on the far arm
        const bn = HW.bone;
        for (const s of [-1, 1]) {
          limb(b, [[s * 0.1, 0.56, 0.0], [s * 0.12, 0.28, -0.04], [s * 0.12, 0.05, 0.0]], 0.04, 0.035, bn, 5);
          b.add(box(0.07, 0.04, 0.15), bn, T(s * 0.12, 0.03, -0.05));
        }
        b.add(cyl(0.18, 0.15, 0.55, 8), HW.dark, T(0, 0.8, 0));
        for (let i = 0; i < 4; i++) b.add(tor(0.16 - i * 0.008, 0.032, Math.PI, 3, 6), bn, T(0, 0.66 + i * 0.1, -0.03, Math.PI / 2 + 0.15, 0, Math.PI, [1.1, 0.8, 1]));
        seg(b, [0, 0.56, -0.17], [0, 1.08, -0.15], 0.022, 0.022, bn, 5);
        for (const s of [-1, 1]) b.add(sph(0.065, 7, 5), bn, T(s * 0.19, 1.05, 0));
        limb(b, [[-0.19, 1.05, 0], [-0.3, 0.88, -0.14], [-0.32, 0.86, -0.36]], 0.03, 0.026, bn, 5);
        b.add(slab([-0.035, 0, 0.035, 0, 0.03, 0.56, 0, 0.64, -0.03, 0.56], 0.025, 'front', 0), HW.metal, T(-0.32, 0.87, -0.4, -Math.PI / 2 + 0.12, 0, 0));
        b.add(box(0.14, 0.035, 0.035), HW.rotP, T(-0.32, 0.87, -0.38));
        b.add(sph(0.025, 4, 3), HW.rotP, T(-0.32, 0.93, -0.8));
        limb(b, [[0.19, 1.05, 0], [0.3, 0.86, -0.04], [0.33, 0.74, -0.14]], 0.03, 0.026, bn, 5);
        if (lead) {
          b.add(slab([-0.17, 0.2, 0.17, 0.2, 0.15, -0.34, -0.15, -0.34], 0.04, 'side', 0.38), HW.wood, T(0, 0.9, -0.12));
          b.add(box(0.03, 0.36, 0.06), HW.bone, T(0.41, 0.86, -0.12));
          b.add(box(0.03, 0.06, 0.22), HW.bone, T(0.41, 0.96, -0.12));
          b.add(sph(0.27, 10, 5, 0, Math.PI * 2, 0, Math.PI * 0.5), HW.metal, T(0, 1.38, -0.02, -0.1, 0, 0, [1.04, 0.9, 1.04]));
          b.add(cyl(0.265, 0.27, 0.05, 10), '#585c66', T(0, 1.39, -0.02, -0.1, 0, 0));
          for (const s of [-1, 1]) limb(b, [[s * 0.24, 1.46, 0], [s * 0.42, 1.52, 0.02], [s * 0.5, 1.7, 0.04]], 0.06, 0.012, '#8a8e98', 4);
        } else b.add(slab([-0.12, 0.16, 0.12, 0.18, 0.1, -0.12, -0.02, -0.16, -0.12, -0.08], 0.03, 'side', 0.37), HW.cloth, T(0, 0.82, -0.08));
        b.add(sph(0.25, 10, 7), bn, T(0, 1.34, -0.02));
        b.add(box(0.22, 0.11, 0.17), bn, T(0, 1.13, -0.08));
        for (let i = 0; i < 4; i++) b.add(box(0.014, 0.06, 0.02), INK, T(-0.066 + i * 0.044, 1.13, -0.17));
        for (const s of [-1, 1]) { b.add(sph(0.08, 7, 5), HW.hole, T(s * 0.09, 1.32, -0.18, 0, 0, 0, [1, 0.8, 0.6])); b.add(sph(0.032, 5, 4), HW.eye, T(s * 0.09, 1.32, -0.225)); }
        if (!lead) b.add(box(0.02, 0.15, 0.02), INK, T(0.04, 1.5, -0.17, -0.5, 0, 0.3));
        break;
      }
      case 'bandit': case 'banditLead': case 'smuggler': {
        // «Легион» bandit: bell robe in brown, deep plum hood around the face, red cloth band across the eyes, rope belt
        // with a brass buckle, dark legs, a pale knife held forward. The ataman (o.boss): oxblood robe, a gold arc over
        // the hood and the red cloth pulled up over the whole lower face
        // dg_smuggler shares the body: olive coat, a green-grey cap instead of the hood, a black eye mask and a moustache
        const lead = a === 'banditLead', smug = a === 'smuggler';
        const ROBE = lead ? '#4a2a2a' : smug ? '#3e3f30' : '#5a4a3a', HOOD = smug ? '#2e2a26' : '#3a3040', SKIN = '#e8c8a0', BAND = smug ? '#15151a' : '#8a2a2a';
        for (const s of [-1, 1]) seg(b, [s * 0.12, 0.36, 0], [s * 0.12, 0.04, -0.02], 0.065, 0.06, HOOD, 6);
        b.add(cyl(0.21, 0.3, 0.54, 12), ROBE, T(0, 0.56, 0));
        b.add(sph(0.22, 12, 7), ROBE, T(0, 0.8, 0, 0, 0, 0, [1.05, 0.7, 0.95]));
        b.add(cyl(0.265, 0.27, 0.07, 12), '#8a6a3a', T(0, 0.5, 0));
        b.add(box(0.1, 0.1, 0.04), '#c8a04a', T(0, 0.5, -0.27));
        // hood + face opening + red band + eyes
        if (smug) {
          b.add(sph(0.23, 9, 4, 0, Math.PI * 2, 0, Math.PI * 0.5), '#4a5a40', T(0, 1.16, 0.0, 0.15, 0, 0, [1.05, 0.8, 1.1]));
          b.add(cyl(0.2, 0.2, 0.02, 9), '#4a5a40', T(0, 1.17, -0.12, 0.15, 0, 0, [1, 1, 0.9]));
          b.add(box(0.16, 0.03, 0.04), '#5a3a24', T(0, 1.03, -0.29));
        } else {
          b.add(sph(0.27, 10, 7), HOOD, T(0, 1.13, 0.04, 0, 0, 0, [1, 1.12, 1.05]));
          b.add(cone(0.1, 0.18, 6), HOOD, T(0, 1.38, 0.08, -0.35, 0, 0));
        }
        b.add(sph(0.2, 8, 6), SKIN, T(0, 1.08, -0.13, 0, 0, 0, [0.95, 0.9, 0.75]));
        b.add(sph(0.205, 10, 4), BAND, T(0, 1.12, -0.13, 0, 0, 0, [0.98, 0.32, 0.78]));
        for (const s of [-1, 1]) b.add(sph(0.03, 5, 4), INK, T(s * 0.07, 1.13, -0.28));
        if (!smug) b.add(cone(0.035, 0.18, 4), BAND, T(0.05, 1.06, 0.26, 1.2, 0, 0));
        // knife arm
        limb(b, [[-0.23, 0.82, -0.02], [-0.3, 0.66, -0.2], [-0.27, 0.68, -0.36]], 0.06, 0.05, ROBE, 6);
        b.add(sph(0.045, 6, 4), SKIN, T(-0.27, 0.68, -0.38));
        b.add(slab([0, 0, 0.05, 0.035, 0.36, 0.16, 0.05, -0.03], 0.03, 'side', -0.27), '#d8dce8', T(0, 0.69, -0.38, 0, 0, 0));
        b.add(sph(0.08, 7, 5), ROBE, T(0.24, 0.72, 0.02));
        if (lead) {
          b.add(sph(0.2, 8, 4), BAND, T(0, 1.02, -0.135, 0, 0, 0, [0.97, 0.42, 0.76]));
          b.add(tor(0.27, 0.035, Math.PI, 4, 10), '#c8a04a', T(0, 1.2, 0.05, 0, Math.PI / 2, 0, [1, 0.75, 1]));
        }
        break;
      }
      case 'boar': {
        const c0 = '#7a5236', c1 = '#4f3424';
        b.add(sph(0.4, 10, 7), c0, T(0, 0.55, 0.05, 0, 0, 0, [1, 0.88, 1.35]));
        b.add(sph(0.31, 10, 7), c0, T(0, 0.58, -0.5));
        b.add(cyl(0.13, 0.15, 0.16, 10), '#d89a8a', T(0, 0.52, -0.8, Math.PI / 2, 0, 0));
        for (const s of [-1, 1]) {
          b.add(sph(0.025, 5, 4), INK, T(s * 0.05, 0.52, -0.89));
          b.add(cone(0.035, 0.2, 5), '#fff6e0', T(s * 0.13, 0.55, -0.74, -0.3, 0, -s * 0.5));
          b.add(sph(0.045, 6, 4), INK, T(s * 0.14, 0.7, -0.72));
          b.add(cone(0.09, 0.18, 5), c1, T(s * 0.2, 0.86, -0.42, 0.3, 0, -s * 0.6));
          b.add(cyl(0.08, 0.07, 0.36, 6), c1, T(s * 0.2, 0.18, -0.3));
          b.add(cyl(0.08, 0.07, 0.36, 6), c1, T(s * 0.2, 0.18, 0.38));
        }
        for (let i = 0; i < 5; i++) b.add(cone(0.06, 0.18, 4), c1, T(0, 0.9 - Math.abs(i - 1.5) * 0.02, -0.25 + i * 0.15, 0.2, 0, 0));
        b.add(cyl(0.02, 0.01, 0.2, 4), c1, T(0, 0.62, 0.6, -1.0, 0, 0));
        break;
      }
      case 'drowner': {
        const c0 = '#4fa89a', c1 = '#2f7470', c2 = '#a8e0c8';
        b.add(sph(0.38, 12, 10), c0, T(0, 0.55, 0, 0, 0, 0, [1, 1.25, 0.95]));
        b.add(sph(0.26, 8, 6), c2, T(0, 0.5, -0.17, 0, 0, 0, [1, 1.1, 0.6]));
        for (const s of [-1, 1]) {
          b.add(sph(0.12, 8, 6), '#ffffff', T(s * 0.15, 1.02, -0.18));
          b.add(sph(0.06, 6, 5), INK, T(s * 0.15, 1.02, -0.29));
          b.add(cone(0.12, 0.32, 4), c1, T(s * 0.42, 0.68, 0.02, 0, 0, -s * 1.2, [0.4, 1, 1]));
          b.add(sph(0.09, 6, 5), c0, T(s * 0.17, 0.08, -0.06, 0, 0, 0, [1, 0.5, 1.5]));
        }
        b.add(box(0.26, 0.04, 0.04), INK, T(0, 0.72, -0.34));
        for (let i = 0; i < 4; i++) b.add(box(0.05, 0.38, 0.02), '#2f6a3a', T(-0.2 + i * 0.13, 0.85 - (i % 2) * 0.05, 0.05 + (i % 2) * 0.1, 0.2, 0, (i - 1.5) * 0.3));
        b.add(cone(0.1, 0.3, 4), c1, T(0, 1.05, 0.15, -0.5, 0, 0, [0.4, 1, 1]));
        break;
      }
      case 'toad': case 'toadLead': {
        // «Легион» toad (17.10): a frog ronin — wide flat green head with ball eyes on the top corners, light lip, scarf
        // with flying ends, cream shirt with a dark placket, leather belts with brass, baggy dark trousers, webbed
        // feet, a katana raised in the near hand
        // The toad shogun (o.boss): ochre skin, black shirt, red scarf and shoulder plates, a straw kasa hat, red eyes and a
        // long nodachi
        const lead = a === 'toadLead';
        const SK = lead ? '#a0874a' : '#5aa04a', SKD = lead ? '#6e5a2e' : '#3e7a32', SKL = lead ? '#cdb47a' : '#9acb7a', SHIRT = lead ? '#2e2a32' : '#e8dcc0',
          PANTS = lead ? '#5a1216' : '#2a282e', LEATHER = '#6b4228', LEATHER_D = '#4a2c18', BRASS = '#c9a24a', SCARF = lead ? '#8a1e22' : '#5a2a2a';
        for (const s of [-1, 1]) {
          seg(b, [s * 0.13, 0.58, 0], [s * 0.15, 0.14, -0.02], 0.12, 0.09, s < 0 ? PANTS : '#1c1a20', 6);
          b.add(cyl(0.1, 0.1, 0.06, 6), LEATHER_D, T(s * 0.15, 0.13, -0.02));
          b.add(sph(0.12, 8, 5), s < 0 ? SK : SKD, T(s * 0.17, 0.035, -0.1, 0, s * 0.4, 0, [1, 0.3, 1.6]));
        }
        b.add(cyl(0.25, 0.27, 0.42, 12), SHIRT, T(0, 0.8, 0));
        b.add(box(0.1, 0.4, 0.06), PANTS, T(0, 0.82, -0.24));
        b.add(box(0.07, 0.62, 0.04), LEATHER_D, T(0, 0.82, -0.255, 0, 0, 0.8));
        b.add(cyl(0.275, 0.275, 0.07, 12), LEATHER, T(0, 0.64, 0));
        b.add(box(0.08, 0.08, 0.04), BRASS, T(-0.1, 0.64, -0.27));
        b.add(cyl(0.18, 0.27, 0.12, 9), SCARF, T(0, 1.04, 0));
        b.add(slab([0, 0, 0.15, -0.08, 0.32, -0.36, 0.22, -0.3, 0.06, -0.12], 0.05, 'side', 0.12), SCARF, T(0, 1.06, 0.16));
        // arms: far hand on the belt, near hand raises the katana
        limb(b, [[0.27, 0.98, 0], [0.32, 0.8, 0.02], [0.27, 0.66, -0.06]], 0.07, 0.06, SHIRT, 5);
        b.add(sph(0.06, 6, 4), SK, T(0.27, 0.63, -0.08));
        limb(b, [[-0.27, 0.98, 0], [-0.34, 0.82, -0.12], [-0.33, 0.66, -0.3]], 0.07, 0.06, SHIRT, 5);
        b.add(cyl(0.065, 0.065, 0.1, 6), LEATHER_D, T(-0.335, 0.72, -0.24, -1.0, 0, 0));
        b.add(sph(0.06, 6, 4), SK, T(-0.33, 0.64, -0.32));
        b.add(cyl(0.025, 0.025, 0.18, 5), PANTS, T(-0.33, 0.62, -0.32, -0.6, 0, 0));
        b.add(cyl(0.06, 0.06, 0.02, 8), BRASS, T(-0.33, 0.68, -0.37, -0.6, 0, 0));
        if (lead) b.add(box(0.025, 0.95, 0.05), '#d0d6de', T(-0.33, 1.02, -0.66, -0.6, 0, 0));
        else b.add(box(0.025, 0.7, 0.05), '#d0d6de', T(-0.33, 0.95, -0.56, -0.6, 0, 0));
        // head: wide flat dome, light lower lip, mouth line, ball eyes
        b.add(sph(0.36, 10, 6), SK, T(0, 1.25, -0.03, 0, 0, 0, [1.18, 0.64, 0.95]));
        b.add(sph(0.31, 10, 5), SKL, T(0, 1.13, -0.06, 0, 0, 0, [1.1, 0.32, 0.92]));
        b.add(tor(0.31, 0.014, Math.PI * 0.8, 3, 10), SKD, T(0, 1.17, -0.05, Math.PI / 2, 0, Math.PI * 0.6, [1.12, 0.95, 1]));
        for (const s of [-1, 1]) {
          b.add(sph(0.13, 8, 6), SK, T(s * 0.22, 1.42, -0.08));
          b.add(sph(0.095, 8, 6), '#f4f0e0', T(s * 0.22, 1.43, -0.15));
          b.add(sph(0.05, 6, 4), lead ? '#ff3b2a' : '#3a2416', T(s * 0.22, 1.43, -0.23));
          if (lead) b.add(box(0.14, 0.05, 0.2), '#7a1a1e', T(s * 0.31, 1.0, 0, 0, 0, -s * 0.5));
        }
        if (lead) {
          b.add(cone(0.5, 0.17, 8), '#d8b46a', T(0, 1.6, -0.04));
          b.add(box(0.012, 0.09, 0.02), '#e8a0a8', T(-0.3, 1.5, -0.14, 0, 0, 0.6));
        }
        for (const [x, y] of [[-0.18, 0.92], [0.17, 0.95], [-0.2, 0.78], [0.2, 0.8]]) b.add(sph(0.03, 5, 3), SK, T(x, y, -0.22, 0, 0, 0, [1, 0.8, 0.4]));
        break;
      }
      case 'spider': case 'spiderLead': case 'widow': {
        // Изнанка spider: wide and low, coal-grey, broken bent legs, rag stripes on the abdomen, four red eyes, bone fangs.
        // The widow (o.boss, ×1.25 — FOE_SCALE): coal-black with a dirty-lilac hourglass and cobweb strands on the back;
        // dgb_spider: plum body with a crimson diamond
        const lead = a === 'spiderLead', widow = a === 'widow';
        const c = lead ? HW.fur : widow ? '#3b1f44' : HW.furL, legC = widow ? '#1e1424' : c;
        b.add(sph(0.48, 10, 7), c, T(0, 0.54, 0.29, 0, 0, 0, [0.95, 0.85, 1.05]));
        if (lead || widow) {
          // the mark on both flanks (the site draws it on the abdomen in profile): lilac hourglass / crimson diamond
          const m = lead ? HW.lilacL : '#e0305a';
          for (const s of [-1, 1]) {
            if (lead) for (const v of [1, -1]) b.add(slab([-0.08, v * 0.12, 0.08, v * 0.12, 0, 0], 0.03, 'side', s * 0.465), m, T(0, 0.6, 0.3, 0, 0, 0));
            else b.add(new THREE.OctahedronGeometry(0.15, 0), m, T(s * 0.45, 0.6, 0.3, 0, 0, s * 0.2, [0.25, 1.1, 0.8]));
          }
          if (lead) for (let i = 0; i < 3; i++) b.add(box(0.012, 0.012, 0.36), HW.ghostD, T(-0.2 + i * 0.2, 0.86 - Math.abs(i - 1) * 0.1, 0.3, 0.6, (i - 1) * 0.5, 0));
        } else {
          for (let i = 0; i < 2; i++) b.add(tor(0.3 - i * 0.05, 0.022, Math.PI, 3, 8), HW.cloth, T(0, 0.62 - i * 0.12, 0.25 + i * 0.05, 0, Math.PI / 2, Math.PI / 2 + 0.35, [1, 1, 1.15]));
          b.add(sph(0.06, 5, 4), HW.hole, T(0.1, 0.62, 0.62));
        }
        b.add(sph(0.23, 8, 6), c, T(0, 0.4, -0.28));
        for (const s of [-1, 1]) {
          for (let i = 0; i < 4; i++) {
            const z = -0.3 + i * 0.17, kz = z + (i - 1.5) * 0.12, fz = z + (i - 1.5) * 0.3;
            limb(b, [[s * 0.15, 0.42, z], [s * (0.48 + i * 0.03), 0.76 - i * 0.04, kz], [s * (0.86 + i * 0.05), 0.02, fz]], 0.038, 0.024, legC, 4);
          }
          b.add(sph(0.05, 6, 4), HW.eye, T(s * 0.075, 0.48, -0.47));
          b.add(sph(0.036, 5, 4), HW.eye, T(s * 0.12, 0.39, -0.46));
          seg(b, [s * 0.05, 0.3, -0.44], [s * 0.04, 0.17, -0.54], 0.03, 0.014, HW.bone, 4);
        }
        break;
      }
      case 'bat': {
        // Изнанка bat: a black furry ball with ears and red eyes, ragged dark wings spread wide with holes, small fangs
        const Y = 1.55;
        b.add(sph(0.18, 8, 6), HW.fur, T(0, Y, 0, 0, 0, 0, [1, 1.12, 0.9]));
        for (const s of [-1, 1]) {
          b.add(cone(0.06, 0.18, 4), HW.fur, T(s * 0.09, Y + 0.24, 0, 0, 0, -s * 0.25));
          b.add(sph(0.035, 6, 4), HW.eye, T(s * 0.065, Y + 0.03, -0.15));
          b.add(cone(0.014, 0.05, 4), HW.bone, T(s * 0.025, Y - 0.07, -0.15, Math.PI, 0, 0));
          const w = [0.02, 0.04, 0.4, 0.34, 0.71, 0.13, 0.58, 0.06, 0.55, -0.08, 0.4, 0.02, 0.3, -0.11, 0.13, -0.02];
          b.add(slab(s < 0 ? mirrorU(w) : w, 0.025, 'front', 0.03), HW.furL, T(0, Y, 0, 0, -s * 0.25, 0));
          b.add(slab([0, 0, 0.06, 0.01, 0.03, 0.07], 0.03, 'front', 0.03), HW.hole, T(s * 0.47, Y + 0.12, -0.0, 0, -s * 0.25, 0));
        }
        break;
      }
      case 'crow': {
        // the ravens that answer the scarecrow: a plump level teardrop body tapering into the tail, the head merged into
        // it, a small dark straw beak, red eye, broad ragged wings spread low and swept back with a scalloped edge
        const Y = 1.2;
        b.add(sph(0.15, 9, 6), HW.fur, T(0, Y, 0.04, 0.06, 0, 0, [0.85, 0.82, 1.9]));
        b.add(cone(0.11, 0.3, 6), HW.fur, T(0, Y + 0.02, 0.4, Math.PI / 2 - 0.12, 0, 0, [1.25, 1, 0.6]));
        b.add(sph(0.11, 8, 6), HW.fur, T(0, Y + 0.05, -0.22));
        b.add(cone(0.032, 0.11, 4), HW.strawD, T(0, Y + 0.03, -0.36, -Math.PI / 2 - 0.15, 0, 0));
        for (const s of [-1, 1]) {
          b.add(sph(0.022, 4, 3), HW.eye, T(s * 0.07, Y + 0.08, -0.28));
          const w = [0.02, 0.1, 0.24, 0.12, 0.44, 0.04, 0.6, -0.14, 0.5, -0.12, 0.45, -0.21, 0.35, -0.15, 0.28, -0.24, 0.18, -0.15, 0.1, -0.21, 0.02, -0.1];
          const g = slab((s < 0 ? mirrorU(w) : w).map((v, i) => (i % 2 ? v * 1.35 : v)), 0.022, 'front'); g.rotateX(-Math.PI / 2);
          b.add(g, HW.furL, T(s * 0.07, Y + 0.08, 0.04, 0, 0, s * (s < 0 ? 0.95 : 0.7)));
        }
        break;
      }
      case 'ghost': case 'ghostLead': case 'minerghost': {
        // Изнанка ghost: a wispy blue-grey sheet, a bell that flares into a pointed scalloped hem, a darker fold down the
        // back and a light streak on the front, hollow teardrop eyes and a moaning mouth, one thin arm reaching forward.
        // The leader (o.boss, ×1.3): a black hood draped over the head with tear streaks and a candle in the hand.
        // dg_minerghost: aqua, white beard, miner's helmet with a lamp flame and a pickaxe
        const lead = a === 'ghostLead', miner = a === 'minerghost', k = lead ? 1.25 : 1;
        const G = miner ? '#92d8d8' : HW.ghost, GD = miner ? '#6fb0b0' : HW.ghostD, GL = miner ? '#e0f0f4' : HW.ghostL;
        const prof = [[0.52, 0.4], [0.47, 0.52], [0.42, 0.72], [0.4, 0.92], [0.38, 1.12], [0.3, 1.29], [0.17, 1.39], [0, 1.42]].map(([r, y]) => new THREE.Vector2(r * k, y * k));
        b.add(new THREE.LatheGeometry(prof, 12), G, T(0, 0, 0.02));
        for (let i = 0; i < 7; i++) {
          const a2 = (i / 7) * Math.PI * 2 + 0.2, r = 0.44 * k;
          b.add(sph(0.17 * k, 7, 4), G, T(Math.sin(a2) * r, (0.4 - (i % 2) * 0.07) * k, 0.07 + Math.cos(a2) * r, 0, a2, 0, [1.15, 0.75, 1.0]));
        }
        if (!miner && !lead) b.add(slab([0.12, 0.55, 0.46, 0.9, 0.44, 1.3, 0.32, 1.54, 0.12, 1.64, 0.24, 1.46, 0.28, 1.2, 0.16, 0.82].map((v) => v * k), 0.22 * k, 'side'), GD, T(0, 0, 0.0));
        b.add(slab([0, 0, 0.03, -0.25, 0.0, -0.5, -0.03, -0.25].map((v) => v * k), 0.04, 'side', 0), GL, T(-0.3 * k, 1.22 * k, -0.18 * k, 0, 0.6, 0));
        for (const s of [-1, 1]) {
          if (miner) b.add(sph(0.045, 8, 6), HW.hole, T(s * 0.12, 1.1, -0.37));
          else b.add(sph(0.1 * k, 10, 8), HW.hole, T(s * 0.14 * k, 1.1 * k, -0.33 * k, 0, -s * 0.35, s * 0.2, [0.9, 1.45, 0.5]));
          if (!miner) b.add(sph(0.026 * k, 4, 3), GL, T(s * 0.14 * k - 0.02 * k, 1.15 * k, -0.38 * k));
          if (lead) b.add(box(0.024, 0.14, 0.02), GL, T(s * 0.14 * k, 0.94 * k, -0.4 * k));
        }
        b.add(sph(0.08 * k, 6, 4), HW.hole, T(-0.02, 0.84 * k, -0.4 * k, 0, 0, 0, [0.85, 1.6, 0.5]));
        if (lead) limb(b, [[-0.34 * k, 1.0 * k, -0.06 * k], [-0.6 * k, 0.96 * k, -0.2 * k], [-0.8 * k, 1.08 * k, -0.26 * k]], 0.11 * k, 0.03, G, 6);
        else limb(b, [[-0.34 * k, 1.0 * k, -0.06 * k], [-0.62 * k, 0.86 * k, -0.2 * k], [-0.88 * k, 0.6 * k, -0.24 * k]], 0.12 * k, 0.02, G, 6);
        if (lead) {
          // hood: a dark cap over the crown with lappets down the sides
          b.add(sph(0.36 * k, 12, 4, 0, Math.PI * 2, 0, Math.PI * 0.5), HW.fur, T(0, 1.24 * k, 0.04, 0, 0, 0, [1.25, 0.62, 1.2]));
          b.add(cyl(0.45 * k, 0.45 * k, 0.03, 12), HW.fur, T(0, 1.24 * k, 0.04));
          for (const s of [-1, 1]) b.add(slab([-0.12, 0, 0.14, 0, 0.1, -0.36, 0.02, -0.26, -0.08, -0.34], 0.03, 'side', s * 0.42 * k), HW.fur, T(0, 1.26 * k, 0.04));
          // candle on the reaching hand
          b.add(cyl(0.05, 0.055, 0.2, 6), HW.bone, T(-0.8 * k, 1.08 * k + 0.1, -0.26 * k));
          b.add(cone(0.045, 0.14, 5), HW.fire, T(-0.8 * k, 1.08 * k + 0.27, -0.26 * k));
        }
        if (miner) {
          b.add(sph(0.3, 10, 4, 0, Math.PI * 2, 0, Math.PI * 0.5), '#9a8466', T(0, 1.2, 0.02, 0, 0, 0, [1.05, 0.9, 1.05]));
          b.add(cyl(0.34, 0.34, 0.03, 10), '#7e6a50', T(0, 1.22, 0.02));
          b.add(cyl(0.05, 0.06, 0.07, 6), '#d8d4c8', T(0, 1.46, -0.12, -0.3, 0, 0));
          b.add(cone(0.045, 0.13, 5), HW.fireY, T(0, 1.6, -0.13));
          b.add(sph(0.2, 8, 6), GL, T(0, 0.8, -0.33, 0.3, 0, 0, [1.05, 1.1, 0.5]));
          seg(b, [-0.86, 0.3, -0.24], [-0.86, 0.98, -0.24], 0.022, 0.022, '#8a6a4a', 5);
          b.add(tor(0.22, 0.028, Math.PI * 0.8, 3, 7), '#c8ccd4', T(-0.86, 0.8, -0.24, 0, Math.PI / 2, Math.PI * 0.1));
        }
        break;
      }
      case 'skullguard': case 'squire': {
        // dg_skullguard: a big skull with red eyes in orange rings over a boxy beige armoured tunic, grey legs, a stone
        // tablet shield. dg_squire: a small skeleton under a grey cap-helmet, cream ribs, a maroon round shield with a gold
        // boss and a spear
        const BONE = '#e8dcc8';
        if (a === 'skullguard') {
          for (const s of [-1, 1]) seg(b, [s * 0.1, 0.44, 0], [s * 0.11, 0.03, -0.02], 0.06, 0.055, '#8a8a92', 5);
          b.add(box(0.46, 0.46, 0.32), '#a89f90', T(0, 0.66, 0));
          b.add(box(0.48, 0.06, 0.34), '#857c6e', T(0, 0.5, 0));
          b.add(sph(0.3, 10, 7), BONE, T(0, 1.14, -0.02));
          b.add(box(0.26, 0.12, 0.2), BONE, T(0, 0.9, -0.08));
          for (let i = 0; i < 4; i++) b.add(box(0.016, 0.06, 0.02), INK, T(-0.07 + i * 0.047, 0.92, -0.185));
          for (const s of [-1, 1]) { b.add(sph(0.09, 7, 5), INK, T(s * 0.11, 1.12, -0.22, 0, 0, 0, [1, 1, 0.6])); b.add(tor(0.07, 0.016, Math.PI * 2, 3, 8), '#e8902a', T(s * 0.11, 1.12, -0.27)); b.add(sph(0.03, 5, 3), '#ff3b3b', T(s * 0.11, 1.12, -0.27)); }
          b.add(box(0.06, 0.62, 0.42), '#b5afa0', T(-0.32, 0.66, -0.1));
          b.add(box(0.065, 0.5, 0.06), '#8a8478', T(-0.33, 0.66, -0.1));
          limb(b, [[0.24, 0.84, 0], [0.3, 0.66, 0.04], [0.3, 0.5, 0]], 0.05, 0.045, BONE, 5);
        } else {
          for (const s of [-1, 1]) seg(b, [s * 0.08, 0.56, 0], [s * 0.1, 0.05, -0.02], 0.04, 0.035, BONE, 5);
          b.add(box(0.24, 0.08, 0.13), BONE, T(0, 0.6, 0));
          b.add(cyl(0.16, 0.14, 0.42, 8), HW.dark, T(0, 0.86, 0));
          for (let i = 0; i < 4; i++) b.add(tor(0.15 - i * 0.008, 0.026, Math.PI, 3, 6), BONE, T(0, 0.72 + i * 0.09, -0.03, Math.PI / 2 + 0.15, 0, Math.PI, [1.1, 0.8, 1]));
          b.add(sph(0.23, 9, 6), BONE, T(0, 1.3, -0.02));
          b.add(box(0.2, 0.1, 0.16), BONE, T(0, 1.1, -0.08));
          for (const s of [-1, 1]) { b.add(sph(0.07, 6, 4), INK, T(s * 0.085, 1.28, -0.17, 0, 0, 0, [1, 1, 0.6])); b.add(sph(0.025, 4, 3), '#ffd36a', T(s * 0.085, 1.28, -0.215)); }
          b.add(sph(0.245, 9, 4, 0, Math.PI * 2, 0, Math.PI * 0.45), '#8a8f9c', T(0, 1.33, 0));
          b.add(cyl(0.25, 0.25, 0.03, 9), '#6a6e78', T(0, 1.36, 0));
          limb(b, [[-0.18, 1.04, 0], [-0.26, 0.88, -0.1], [-0.28, 0.86, -0.2]], 0.03, 0.026, BONE, 4);
          b.add(cyl(0.26, 0.26, 0.04, 12), '#7a2a3a', T(-0.33, 0.84, -0.14, 0, 0, Math.PI / 2));
          b.add(sph(0.07, 6, 4), '#c9a030', T(-0.36, 0.84, -0.14, 0, 0, 0, [0.6, 1, 1]));
          limb(b, [[0.18, 1.04, 0], [0.26, 0.88, -0.04], [0.26, 0.86, -0.14]], 0.03, 0.026, BONE, 4);
          seg(b, [0.26, 0.06, 0.12], [0.26, 1.6, -0.42], 0.02, 0.02, '#8a6a45', 4);
          seg(b, [0.26, 1.6, -0.42], [0.26, 1.74, -0.47], 0.04, 0.003, '#c8ccd4', 4);
        }
        break;
      }
      case 'skeletonLead': {
        // the skeleton leader (skeletonBoss): a legionary of bone — gold helm with a tall red horsehair crest, cheek guards
        // and neck guard, a snarling skull with red-glowing sockets, gold cuirass and greaves, red pteruges skirt, a red
        // cape behind, a big round gold shield with a lion boss on the near arm and a gold-tipped spear forward
        const BONE = '#e2dac2', GM = '#e8b13a', GD = '#a9741c', GL = '#ffe08a', RM = '#c0182b', RD = '#7a0d18', WOOD = '#5a2a14';
        b.add(slab([-0.16, 1.16, 0.16, 1.16, 0.34, 0.1, 0.2, 0.18, 0.08, 0.06, -0.04, 0.16, -0.14, 0.08], 0.3, 'side'), RD, T(0, 0, 0.2));
        for (const s of [-1, 1]) {
          seg(b, [s * 0.08, 0.58, 0], [s * 0.1, 0.06, -0.02], 0.04, 0.035, BONE, 5);
          b.add(cyl(0.06, 0.052, 0.22, 6), GM, T(s * 0.1, 0.2, -0.03));
          b.add(box(0.08, 0.035, 0.17), WOOD, T(s * 0.1, 0.02, -0.05));
          b.add(sph(0.1, 6, 4), GM, T(s * 0.24, 1.06, 0, 0, 0, -s * 0.4, [1.1, 0.7, 1.1]));
        }
        b.add(cyl(0.2, 0.24, 0.12, 8), RM, T(0, 0.62, 0));
        for (let i = 0; i < 6; i++) { const a2 = (i / 6) * Math.PI * 2 + 0.5; b.add(box(0.075, 0.2, 0.025), i % 2 ? GD : RM, T(Math.sin(a2) * 0.23, 0.5, Math.cos(a2) * 0.23, 0, a2, 0)); }
        b.add(cyl(0.22, 0.19, 0.4, 9), GM, T(0, 0.86, 0));
        b.add(sph(0.22, 9, 4), GM, T(0, 1.04, 0, 0, 0, 0, [1.1, 0.45, 1]));
        for (const s of [-1, 1]) b.add(sph(0.085, 5, 3), GL, T(s * 0.08, 0.94, -0.17, 0, 0, 0, [1, 0.8, 0.45]));
        b.add(cyl(0.225, 0.225, 0.04, 10), GD, T(0, 0.69, 0));
        // far arm: the spear; near arm: the round shield
        limb(b, [[0.24, 1.04, 0], [0.3, 0.86, -0.04], [0.3, 0.84, -0.14]], 0.032, 0.028, BONE, 4);
        seg(b, [0.3, 0.08, 0.16], [0.3, 1.66, -0.5], 0.022, 0.022, WOOD, 5);
        seg(b, [0.3, 1.66, -0.5], [0.3, 1.84, -0.57], 0.045, 0.004, GM, 4);
        limb(b, [[-0.24, 1.04, 0], [-0.3, 0.88, -0.08], [-0.32, 0.86, -0.16]], 0.032, 0.028, BONE, 4);
        b.add(cyl(0.32, 0.32, 0.05, 12), GM, T(-0.38, 0.84, -0.12, 0, 0, Math.PI / 2));
        b.add(tor(0.31, 0.03, Math.PI * 2, 3, 10), WOOD, T(-0.385, 0.84, -0.12, 0, Math.PI / 2, 0));
        b.add(tor(0.12, 0.035, Math.PI * 2, 3, 7), GD, T(-0.41, 0.84, -0.12, 0, Math.PI / 2, 0));
        b.add(sph(0.08, 6, 4), GL, T(-0.42, 0.84, -0.12, 0, 0, 0, [0.6, 1, 1]));
        // skull: snarling open jaw, red sockets
        b.add(sph(0.24, 8, 5), BONE, T(0, 1.34, -0.02));
        b.add(box(0.2, 0.08, 0.16), BONE, T(0, 1.1, -0.1, 0.25, 0, 0));
        for (let i = 0; i < 4; i++) b.add(box(0.014, 0.05, 0.02), INK, T(-0.06 + i * 0.04, 1.16, -0.2));
        for (const s of [-1, 1]) { b.add(sph(0.075, 6, 4), INK, T(s * 0.09, 1.32, -0.18, 0, 0, 0, [1, 0.9, 0.7])); b.add(sph(0.035, 5, 3), '#ff3b3b', T(s * 0.09, 1.32, -0.235)); }
        // helm: dome, brow band, cheek guards, neck guard, crest holder and the red crest front-to-back
        b.add(sph(0.255, 10, 5, 0, Math.PI * 2, 0, Math.PI * 0.5), GM, T(0, 1.4, 0.0, 0, 0, 0, [1.04, 0.9, 1.06]));
        b.add(cyl(0.26, 0.26, 0.05, 10), GD, T(0, 1.41, 0));
        for (const s of [-1, 1]) b.add(box(0.03, 0.17, 0.13), GM, T(s * 0.24, 1.3, -0.05, 0, 0, s * 0.12));
        b.add(box(0.36, 0.1, 0.05), GM, T(0, 1.32, 0.22, -0.4, 0, 0));
        b.add(box(0.05, 0.08, 0.12), GD, T(0, 1.66, 0));
        b.add(slab([-0.26, 1.64, -0.24, 1.74, -0.14, 1.83, 0.02, 1.87, 0.18, 1.82, 0.3, 1.66, 0.26, 1.54, 0.16, 1.64, 0.02, 1.7, -0.12, 1.68], 0.08, 'side'), RM, T(0, 0, 0));
        break;
      }
      case 'batLead': {
        // Вампир (hw_bat leader): standing in a slate cloak with a dark collar, a pale face with a black widow's peak, red
        // eyes and fangs, huge black ragged wings spread behind in a shallow V, a pale hand reaching forward
        const Y = 0.25;
        b.add(cyl(0.14, 0.32, 1.0, 9), HW.furL, T(0, Y + 0.6, 0.02));
        b.add(cyl(0.14, 0.12, 0.08, 9), HW.cloth, T(0, Y + 1.12, 0.02));
        b.add(sph(0.2, 9, 6), HW.ghostL, T(0, Y + 1.38, -0.02, 0, 0, 0, [0.95, 1.08, 0.95]));
        b.add(sph(0.205, 9, 4, 0, Math.PI * 2, 0, Math.PI * 0.42), HW.fur, T(0, Y + 1.4, 0.02, 0.35, 0, 0));
        b.add(cone(0.05, 0.1, 4), HW.fur, T(0, Y + 1.5, -0.18, Math.PI + 0.5, 0, 0));
        for (const s of [-1, 1]) {
          b.add(sph(0.035, 5, 3), HW.eye, T(s * 0.07, Y + 1.38, -0.18));
          b.add(cone(0.014, 0.05, 3), HW.bone, T(s * 0.03, Y + 1.27, -0.18, Math.PI, 0, 0));
          const w = [0.06, 0.06, 0.5, 0.2, 0.9, 0.04, 1.02, -0.32, 0.98, -0.84, 0.72, -0.62, 0.6, -0.94, 0.4, -0.66, 0.22, -1.02, 0.0, -0.74];
          b.add(slab(s < 0 ? mirrorU(w) : w, 0.03, 'front'), HW.fur, T(0, Y + 1.34, 0.16, 0, -s * 0.75, 0));
          b.add(slab([0, 0, 0.1, 0.02, 0.04, 0.12], 0.035, 'front'), HW.hole, T(s * 0.4, Y + 0.95, 0.16 + 0.36, 0, -s * 0.75, 0));
        }
        limb(b, [[-0.13, Y + 1.04, -0.04], [-0.3, Y + 0.96, -0.24], [-0.38, Y + 1.0, -0.44]], 0.035, 0.025, HW.ghostL, 5);
        break;
      }
      case 'rat': case 'beast': {
        // dg_rat: an upright grey rat leaning back — egg body with cream belly crescents, pointed head with a pink nose,
        // a big round pink ear, stubby legs, a long pink tail curling up behind, a thin blade raised forward.
        // dgb_maze (the maze beast): the same family on all fours, long and low, warm brown, red eye, gold collar
        if (a === 'rat') {
          const G = '#8e8e9a', GD = '#6e6e7a', C = '#e8dcc8', P = '#e0a0a0';
          for (const s of [-1, 1]) { seg(b, [s * 0.12, 0.26, 0.02], [s * 0.13, 0.05, -0.02], 0.065, 0.055, GD, 5); b.add(sph(0.07, 6, 4), G, T(s * 0.13, 0.035, -0.08, 0, 0, 0, [1, 0.5, 1.5])); }
          b.add(sph(0.3, 10, 7), G, T(0, 0.52, 0.04, -0.25, 0, 0, [0.95, 1.25, 0.9]));
          b.add(sph(0.22, 8, 5), C, T(0, 0.48, -0.12, -0.25, 0, 0, [0.95, 1.1, 0.55]));
          b.add(sph(0.18, 9, 6), G, T(0, 0.92, -0.12));
          b.add(cone(0.12, 0.28, 7), G, T(0, 0.88, -0.36, -Math.PI / 2 - 0.2, 0, 0));
          b.add(sph(0.035, 5, 3), '#d9908f', T(0, 0.84, -0.5));
          for (const s of [-1, 1]) {
            b.add(sph(0.032, 5, 3), INK, T(s * 0.09, 0.97, -0.24));
            b.add(cyl(0.11, 0.11, 0.025, 9), G, T(s * 0.14, 1.12, -0.02, 0, 0, Math.PI / 2 - s * 0.3));
            b.add(cyl(0.07, 0.07, 0.03, 8), '#d9908f', T(s * 0.145, 1.12, -0.03, 0, 0, Math.PI / 2 - s * 0.3));
          }
          limb(b, [[0, 0.3, 0.3], [0, 0.22, 0.56], [0, 0.42, 0.78], [0, 0.7, 0.8]], 0.03, 0.012, P, 4);
          limb(b, [[-0.24, 0.66, -0.04], [-0.3, 0.6, -0.22], [-0.28, 0.72, -0.34]], 0.045, 0.04, G, 5);
          b.add(slab([0, 0, 0.03, 0.02, 0.36, 0.1, 0.04, -0.02], 0.02, 'side', -0.28), '#b8c4d4', T(0, 0.72, -0.36, -0.9, 0, 0));
        } else {
          const M = '#7a4a2e', D = '#4e2e1c';
          b.add(sph(0.36, 10, 6), M, T(0, 0.52, 0.06, 0, 0, 0, [0.78, 0.66, 1.75]));
          for (const s of [-1, 1]) for (const z of [-0.36, 0.48]) seg(b, [s * 0.14, 0.36, z], [s * 0.14, 0.03, z - 0.04], 0.05, 0.04, D, 5);
          b.add(sph(0.18, 8, 6), M, T(0, 0.56, -0.56));
          b.add(cone(0.13, 0.36, 7), M, T(0, 0.5, -0.84, -Math.PI / 2 - 0.12, 0, 0));
          b.add(sph(0.03, 4, 3), INK, T(0, 0.46, -1.02));
          b.add(tor(0.16, 0.03, Math.PI * 2, 3, 10), '#c9a04a', T(0, 0.54, -0.42, 0.3, 0, 0, [0.85, 1, 1]));
          for (const s of [-1, 1]) { b.add(sph(0.03, 4, 3), '#ff3b3b', T(s * 0.11, 0.62, -0.7)); b.add(cone(0.06, 0.2, 4), D, T(s * 0.08, 0.78, -0.54, -0.25, 0, -s * 0.25)); }
          limb(b, [[0, 0.56, 0.66], [0, 0.46, 0.94], [0, 0.44, 1.16], [0, 0.56, 1.3]], 0.07, 0.03, M, 5);
        }
        break;
      }
      case 'crab': {
        // dg_crab: a hermit crab — a tall tan spiral shell at the back, a low red-orange body, eye stalks, one big claw forward
        const R = '#dd5a3a', RD = '#a83a24';
        b.add(sph(0.36, 10, 7), '#e4c8aa', T(0, 0.48, 0.18, 0, 0, 0, [0.9, 1.05, 1]));
        b.add(tor(0.2, 0.05, Math.PI * 1.6, 3, 10), '#8a6a4a', T(-0.31, 0.5, 0.18, 0, Math.PI / 2, 0));
        b.add(tor(0.09, 0.04, Math.PI * 1.6, 3, 8), '#8a6a4a', T(-0.32, 0.52, 0.2, 0, Math.PI / 2, 0));
        b.add(sph(0.26, 9, 6), R, T(0, 0.2, -0.2, 0, 0, 0, [1.1, 0.6, 1.2]));
        for (const s of [-1, 1]) {
          seg(b, [s * 0.08, 0.3, -0.36], [s * 0.1, 0.52, -0.42], 0.018, 0.014, R, 4);
          b.add(sph(0.04, 5, 4), INK, T(s * 0.1, 0.54, -0.42));
          for (let i = 0; i < 3; i++) limb(b, [[s * 0.2, 0.18, -0.3 + i * 0.14], [s * 0.42, 0.24, -0.34 + i * 0.16], [s * 0.5, 0.02, -0.36 + i * 0.18]], 0.025, 0.018, RD, 4);
        }
        limb(b, [[-0.18, 0.22, -0.36], [-0.28, 0.34, -0.56], [-0.24, 0.36, -0.74]], 0.06, 0.055, R, 5);
        b.add(sph(0.17, 8, 6), R, T(-0.24, 0.38, -0.88, 0, 0, 0, [0.8, 0.75, 1.2]));
        b.add(cone(0.08, 0.26, 5), '#f4e0d0', T(-0.24, 0.46, -1.1, -Math.PI / 2 + 0.25, 0, 0));
        b.add(cone(0.06, 0.2, 5), '#f4e0d0', T(-0.24, 0.3, -1.06, -Math.PI / 2 - 0.3, 0, 0));
        break;
      }
      case 'mushroom': case 'shroom': {
        // dg_mushroom: a cream stalk-body with a sad face under a red cap with cream spots, a spear raised forward.
        // dgb_shroom: a much wider flat purple cap with two lime spots, a short wide stalk, navy legs, a stick hanging down
        const big = a === 'shroom', CAP = big ? '#8e3aaa' : '#d9322e', SPOT = big ? '#d8f090' : '#f5e6d0', ST = '#ede4d6';
        const sr = big ? 0.26 : 0.19, sh = big ? 0.42 : 0.5;
        for (const s of [-1, 1]) seg(b, [s * 0.09, 0.2, 0], [s * 0.1, 0.03, -0.02], 0.055, 0.05, big ? '#1e1e3a' : '#d8ccb8', 5);
        b.add(cyl(sr * 0.9, sr, sh, 10), ST, T(0, 0.2 + sh / 2, 0));
        const cy = 0.2 + sh, cr = big ? 0.62 : 0.44;
        b.add(sph(cr, 12, 6, 0, Math.PI * 2, 0, Math.PI * 0.5), CAP, T(0, cy - 0.02, 0, 0, 0, 0, [1, big ? 0.62 : 0.75, 1]));
        b.add(cyl(cr, cr * 0.7, 0.05, 12), '#d8c0a0', T(0, cy - 0.04, 0));
        const spots = big ? [[0.22, -0.4, 0.16], [-0.3, -0.3, 0.12]] : [[0.2, -0.3, 0.07], [-0.18, -0.28, 0.06], [0, -0.38, 0.05], [0.32, 0.1, 0.06], [-0.3, 0.12, 0.06], [0.05, 0.3, 0.07]];
        for (const [x, z, r] of spots) { const yy = cy - 0.02 + Math.sqrt(Math.max(0, 1 - (x * x + z * z) / (cr * cr))) * cr * (big ? 0.62 : 0.75); b.add(sph(r, 7, 4), SPOT, T(x, yy, z, -z * 1.4, 0, x * 1.4, [1, 0.35, 1])); }
        for (const s of [-1, 1]) b.add(sph(0.03, 5, 3), INK, T(s * 0.07, cy - 0.16, -sr * 0.92));
        if (!big) b.add(tor(0.04, 0.01, Math.PI, 3, 6), INK, T(0, cy - 0.27, -sr * 0.95));
        if (big) seg(b, [-0.24, cy - 0.22, -0.04], [-0.62, cy - 0.34, -0.18], 0.03, 0.025, '#c8b090', 4);
        else {
          limb(b, [[-0.18, 0.5, 0], [-0.28, 0.46, -0.16], [-0.28, 0.56, -0.26]], 0.035, 0.03, '#d8c8a8', 4);
          seg(b, [-0.28, 0.1, 0.08], [-0.28, 1.0, -0.5], 0.018, 0.018, '#8a6a45', 4);
          seg(b, [-0.28, 1.0, -0.5], [-0.28, 1.1, -0.56], 0.04, 0.003, '#d0d0d8', 4);
        }
        break;
      }
      case 'mummy': {
        // dg_mummy: bandaged cream body and head, tan wrap bands, a dark eye slit with cyan eyes, one stiff arm straight
        // forward, a loose bandage tail from the head
        const W = '#e5d5ae', WD = '#b89e74';
        for (const s of [-1, 1]) seg(b, [s * 0.11, 0.56, 0], [s * 0.12, 0.03, -0.02], 0.08, 0.075, W, 5);
        b.add(cyl(0.24, 0.21, 0.56, 9), W, T(0, 0.84, 0));
        for (let i = 0; i < 4; i++) b.add(cyl(0.235 - i * 0.008, 0.235 - i * 0.008, 0.025, 9), WD, T(0, 0.64 + i * 0.13, 0, 0.15 * (i % 2 ? 1 : -1), 0, 0.1));
        b.add(sph(0.22, 9, 6), W, T(0, 1.32, -0.02));
        for (let i = 0; i < 3; i++) b.add(cyl(0.222, 0.222, 0.02, 9), WD, T(0, 1.22 + i * 0.12, -0.02, 0, 0, 0.08 * (i - 1)));
        b.add(box(0.3, 0.07, 0.1), '#3a3040', T(0, 1.32, -0.17));
        for (const s of [-1, 1]) b.add(sph(0.025, 4, 3), '#7ad8ff', T(s * 0.07, 1.32, -0.22));
        limb(b, [[-0.25, 1.04, -0.02], [-0.26, 1.04, -0.36], [-0.26, 1.04, -0.6]], 0.07, 0.065, W, 5);
        for (let i = 0; i < 3; i++) b.add(box(0.15, 0.014, 0.02), WD, T(-0.26, 1.04 + (i - 1) * 0.03, -0.2 - i * 0.14, 0, 0, Math.PI / 2));
        limb(b, [[0.21, 1.04, 0], [0.26, 0.86, 0.04], [0.27, 0.7, 0]], 0.05, 0.045, W, 5);
        limb(b, [[0.14, 1.38, 0.12], [0.26, 1.26, 0.22], [0.3, 1.06, 0.3]], 0.025, 0.02, W, 3);
        break;
      }
      case 'imp': {
        // dg_imp: a big round red head with cream horns and yellow eyes, a short crimson body with a brown apron, a curled
        // tail with an arrow tip, a hammer raised forward
        const R = '#d94a38', RD = '#a8302a';
        for (const s of [-1, 1]) seg(b, [s * 0.09, 0.3, 0], [s * 0.1, 0.03, -0.02], 0.055, 0.05, R, 5);
        b.add(cyl(0.16, 0.22, 0.34, 9), RD, T(0, 0.46, 0));
        b.add(box(0.2, 0.26, 0.04), '#5a3a2e', T(0, 0.44, -0.2, 0.15, 0, 0));
        b.add(sph(0.3, 10, 7), R, T(0, 0.9, -0.02));
        for (const s of [-1, 1]) {
          b.add(cone(0.07, 0.24, 5), '#f0e0c0', T(s * 0.2, 1.18, 0, 0, 0, -s * 0.5));
          b.add(sph(0.06, 6, 4), '#ffc83a', T(s * 0.11, 0.94, -0.26, 0, 0, 0, [1, 1, 0.5]));
          b.add(sph(0.025, 4, 3), INK, T(s * 0.11, 0.94, -0.29));
        }
        b.add(tor(0.06, 0.012, Math.PI, 3, 6), INK, T(0, 0.8, -0.28, 0, 0, Math.PI));
        limb(b, [[0, 0.4, 0.18], [0, 0.32, 0.42], [0, 0.5, 0.58], [0, 0.66, 0.5]], 0.03, 0.02, R, 4);
        b.add(cone(0.05, 0.1, 4), R, T(0, 0.7, 0.46, -0.6, 0, 0));
        limb(b, [[-0.18, 0.58, 0], [-0.3, 0.68, -0.14], [-0.3, 0.86, -0.22]], 0.04, 0.035, R, 4);
        seg(b, [-0.3, 0.7, -0.16], [-0.3, 1.18, -0.34], 0.02, 0.02, '#6a4a30', 4);
        b.add(box(0.12, 0.12, 0.22), '#707078', T(-0.3, 1.2, -0.35, -0.36, 0, 0));
        break;
      }
      case 'icelet': {
        // dg_icelet: an angular ice block — a faceted cyan body wider than the faceted pale head, dark crack lines, angry
        // brows and blue eyes, two dark horn spikes, stubby legs, an ice shard arm
        const I = '#bfe6fa', ID = '#8fcbea';
        for (const s of [-1, 1]) seg(b, [s * 0.12, 0.2, 0], [s * 0.12, 0.03, -0.02], 0.07, 0.065, ID, 5);
        b.add(new THREE.DodecahedronGeometry(0.36, 0), I, T(0, 0.52, 0, 0, 0.3, 0, [1.25, 0.85, 0.85]));
        b.add(new THREE.IcosahedronGeometry(0.26, 0), '#d8f2ff', T(0, 0.98, -0.02, 0.1, 0.2, 0, [1.05, 0.95, 1]));
        for (let i = 0; i < 3; i++) b.add(box(0.012, 0.16, 0.02), '#5a9ac8', T(-0.1 + i * 0.1, 0.5 + (i % 2) * 0.06, -0.31, 0, 0, 0.5 - i * 0.4));
        for (const s of [-1, 1]) {
          b.add(cone(0.02, 0.24, 3), '#3a4a60', T(s * 0.13, 1.26, 0, 0, 0, -s * 0.3));
          b.add(sph(0.04, 5, 3), '#3a7ad8', T(s * 0.09, 1.0, -0.24));
          b.add(box(0.1, 0.022, 0.02), INK, T(s * 0.09, 1.07, -0.24, 0, 0, s * 0.4));
        }
        b.add(box(0.1, 0.018, 0.02), INK, T(0, 0.88, -0.25));
        b.add(cone(0.09, 0.56, 4), ID, T(-0.44, 0.5, -0.28, -1.8, 0, 0.5));
        break;
      }
      case 'potion': {
        // dg_potion: a living flask — round pale-blue glass belly half full of lime liquid with bubbles, narrow neck,
        // brown cork, a face at the liquid line, two little dark legs
        for (const s of [-1, 1]) seg(b, [s * 0.1, 0.14, 0], [s * 0.11, 0.02, -0.02], 0.04, 0.035, '#4a4048', 4);
        b.add(sph(0.3, 10, 4, 0, Math.PI * 2, Math.PI * 0.45, Math.PI * 0.55), '#7df84a', T(0, 0.44, 0));
        b.add(sph(0.31, 10, 4, 0, Math.PI * 2, 0, Math.PI * 0.47), '#d4eefa', T(0, 0.44, 0));
        b.add(cyl(0.09, 0.11, 0.24, 8), '#d4eefa', T(0, 0.82, 0));
        b.add(cyl(0.08, 0.08, 0.09, 8), '#a8703a', T(0, 0.97, 0));
                for (const s of [-1, 1]) b.add(sph(0.045, 7, 5), INK, T(s * 0.1, 0.5, -0.29));
        b.add(tor(0.06, 0.014, Math.PI, 3, 6), INK, T(0, 0.42, -0.3, 0, 0, Math.PI));
        break;
      }
      case 'book': {
        // dg_book: a floating open book — red-brown covers in a shallow V, cream pages with two eyes, a jagged-tooth mouth
        // along the bottom, a gold bookmark ribbon hanging down
        const Y = 0.85;
        for (const s of [-1, 1]) {
          b.add(box(0.4, 0.34, 0.04), '#9b4030', T(s * 0.2, Y + 0.06, 0.04, 0, s * 0.3, s * 0.28));
          b.add(box(0.36, 0.3, 0.04), '#e8ddb8', T(s * 0.19, Y + 0.07, 0.0, 0, s * 0.3, s * 0.28));
          b.add(sph(0.055, 8, 6), INK, T(s * 0.17, Y + 0.14, -0.08));
          b.add(sph(0.016, 4, 3), '#ffffff', T(s * 0.17 - 0.015, Y + 0.16, -0.13));
        }
        b.add(box(0.5, 0.05, 0.04), INK, T(0, Y - 0.04, -0.06));
        for (let i = 0; i < 6; i++) b.add(cone(0.035, 0.09, 3), '#f4eedc', T(-0.2 + i * 0.08, Y - 0.02 + (i % 2) * 0.0, -0.09, 0, 0, i % 2 ? 0 : Math.PI));
        b.add(slab([-0.035, 0, 0.035, 0, 0.035, -0.32, 0, -0.26, -0.035, -0.32], 0.015, 'front', 0.06), '#e8c050', T(0, Y - 0.12, 0));
        break;
      }
      case 'blade': {
        // dg_armory: a haunted sword floating point-down — silver blade with a fuller, gold crossguard with a cyan gem,
        // brown wrapped grip, gold pommel
        b.add(slab([-0.08, 0, 0.08, 0, 0.08, 0.9, -0.08, 0.9], 0.04, 'front'), '#eef2f8', T(0, 0.42, 0));
        b.add(cone(0.08, 0.2, 4), '#eef2f8', T(0, 0.32, 0, Math.PI, Math.PI / 4, 0, [1, 1, 0.3]));
        b.add(box(0.025, 0.7, 0.045), '#c4ccda', T(0, 0.82, 0));
        b.add(box(0.46, 0.06, 0.08), '#c9a04a', T(0, 1.34, 0));
        b.add(sph(0.045, 5, 3), '#4fb3e8', T(0, 1.34, -0.045));
        b.add(cyl(0.035, 0.035, 0.22, 6), '#6b4226', T(0, 1.48, 0));
        b.add(sph(0.06, 6, 4), '#c9a04a', T(0, 1.62, 0));
        break;
      }
      case 'sandworm': case 'tentacle': {
        // dg_sandworm / dg_rootworm: three fat orange-tan segments stepping up out of a sand mound to a head with a dark
        // star mouth and yellow dots. dgb_living: a tall mauve tentacle swaying up out of jagged dark spikes, a red slash
        if (a === 'sandworm') {
          b.add(sph(0.5, 10, 4, 0, Math.PI * 2, 0, Math.PI * 0.5), '#e8c688', T(0, 0, 0.1, 0, 0, 0, [1, 0.28, 1]));
          const P = [[0, 0.24, 0.22, 0.24], [0, 0.5, 0.0, 0.22], [0, 0.78, -0.18, 0.2], [0, 1.0, -0.34, 0.17]];
          P.forEach(([x, y, z, r], i) => { b.add(sph(r, 9, 6), '#d9a05a', T(x, y, z)); if (i < 3) b.add(tor(r * 0.9, 0.012, Math.PI, 3, 8), '#8a5a2a', T(x, y, z - r * 0.4, 0, 0, Math.PI)); });
          b.add(cyl(0.1, 0.1, 0.03, 8), '#222222', T(0, 1.02, -0.5, Math.PI / 2 - 0.3, 0, 0));
          for (let i = 0; i < 6; i++) { const a2 = (i / 6) * Math.PI * 2; b.add(cone(0.03, 0.08, 3), '#222222', T(Math.cos(a2) * 0.11, 1.02 + Math.sin(a2) * 0.11, -0.5, 0, 0, a2 - Math.PI / 2)); }
          b.add(sph(0.035, 4, 3), '#d03a3a', T(0, 1.02, -0.51));
          for (const s of [-1, 1]) b.add(sph(0.03, 4, 3), '#ffd23f', T(s * 0.12, 1.14, -0.42));
        } else {
          for (let i = 0; i < 5; i++) { const a2 = (i / 5) * Math.PI * 2; b.add(cone(0.1, 0.3 - (i % 2) * 0.1, 4), '#3a2e3a', T(Math.cos(a2) * 0.26, 0.12, Math.sin(a2) * 0.26, Math.sin(a2) * 0.4, 0, -Math.cos(a2) * 0.4)); }
          limb(b, [[0, 0, 0], [0, 0.45, -0.1], [0, 0.9, 0.08], [0, 1.3, -0.08], [0, 1.62, -0.24]], 0.2, 0.06, '#7a6a72', 7);
          b.add(sph(0.06, 6, 4), '#7a6a72', T(0, 1.62, -0.24));
          b.add(box(0.03, 0.24, 0.04), '#c03040', T(0, 0.9, -0.08 - 0.15, 0, 0, 0.6));
          for (let i = 0; i < 3; i++) b.add(box(0.1, 0.02, 0.03), '#4a3640', T(0, 0.4 + i * 0.36, -0.12 - (i === 1 ? -0.16 : 0) - 0.08));
        }
        break;
      }
      case 'automaton': {
        // dg_automaton (also the astrolabe, the clockwork bird and the clock beetle): a squat gold clockwork box with
        // rivets and a cream clock face, a gold head with cyan eyes and a T antenna, a hammer arm and a piston arm
        const GO = '#c89b4a', GD = '#8a6a2a';
        for (const s of [-1, 1]) b.add(box(0.12, 0.18, 0.14), '#4a4a55', T(s * 0.13, 0.09, 0));
        b.add(box(0.56, 0.48, 0.44), GO, T(0, 0.42, 0));
        b.add(box(0.57, 0.08, 0.45), GD, T(0, 0.56, 0));
        b.add(cyl(0.15, 0.15, 0.03, 12), '#e8dcc0', T(0, 0.36, -0.225, Math.PI / 2, 0, 0));
        b.add(tor(0.15, 0.014, Math.PI * 2, 3, 12), INK, T(0, 0.36, -0.24));
        b.add(box(0.014, 0.1, 0.02), INK, T(0, 0.4, -0.245)); b.add(box(0.08, 0.014, 0.02), INK, T(0.04, 0.36, -0.245));
        for (const [x, y] of [[-0.24, 0.24], [0.24, 0.24], [-0.24, 0.62], [0.24, 0.62]]) b.add(sph(0.022, 4, 3), GD, T(x, y, -0.225));
        b.add(box(0.36, 0.2, 0.3), GO, T(0, 0.78, 0));
        for (const s of [-1, 1]) b.add(sph(0.045, 6, 4), '#5bc8e8', T(s * 0.08, 0.8, -0.16));
        seg(b, [0, 0.88, 0], [0, 1.08, 0], 0.012, 0.012, '#808090', 4);
        b.add(box(0.14, 0.025, 0.025), '#808090', T(0, 1.08, 0));
        seg(b, [-0.28, 0.5, 0], [-0.42, 0.7, -0.12], 0.025, 0.025, '#7a7a88', 4);
        b.add(box(0.14, 0.1, 0.1), '#5a5a64', T(-0.44, 0.74, -0.14));
        seg(b, [0.28, 0.46, 0], [0.5, 0.46, -0.06], 0.025, 0.025, '#8a8a98', 4);
        b.add(box(0.03, 0.16, 0.06), '#8a8a98', T(0.51, 0.46, -0.06));
        break;
      }
      case 'stonegolem': {
        // dgb_golem: a heavy taupe stone golem — wide trapezoid torso with two lighter plates, a small dome head with
        // glowing mint slit eyes, thick dark legs, one huge arm sweeping forward and down
        const S = '#a8967e', SD = '#6b4a3a', SL = '#d8c8aa';
        for (const s of [-1, 1]) b.add(box(0.2, 0.4, 0.22), SD, T(s * 0.18, 0.2, 0));
        b.add(cyl(0.48, 0.34, 0.74, 7), S, T(0, 0.76, 0, 0, Math.PI / 7, 0, [1, 1, 0.75]));
        b.add(box(0.2, 0.18, 0.04), SL, T(-0.14, 0.86, -0.29, 0, 0, 0.1));
        b.add(box(0.16, 0.14, 0.04), SL, T(0.16, 0.6, -0.25, 0, 0, -0.1));
        b.add(sph(0.24, 9, 5, 0, Math.PI * 2, 0, Math.PI * 0.6), S, T(0, 1.12, -0.04));
        for (const s of [-1, 1]) b.add(box(0.09, 0.04, 0.03), '#40e0d0', T(s * 0.09, 1.22, -0.26));
        limb(b, [[-0.46, 1.04, 0], [-0.66, 0.86, -0.22], [-0.66, 0.5, -0.36]], 0.14, 0.11, S, 6);
        b.add(sph(0.16, 7, 5), S, T(-0.66, 0.42, -0.38));
        limb(b, [[0.46, 1.04, 0], [0.56, 0.76, 0.08], [0.56, 0.5, 0.04]], 0.12, 0.1, S, 6);
        break;
      }
      case 'shade': case 'voidling': {
        // dgb_light: a tall bell of near-black navy with two lighter streaks, red almond eyes with yellow slits and one
        // thin tentacle arm. dg_voidling: the same night-blob, smaller, white star dots and white triangle eyes
        const big = a === 'shade', k = big ? 1.15 : 0.9, C = big ? '#231b45' : '#2a2550';
        const prof = [[0.48, 0.36], [0.46, 0.5], [0.44, 0.8], [0.42, 1.1], [0.34, 1.32], [0.2, 1.46], [0, 1.5]].map(([r, y]) => new THREE.Vector2(r * k, y * k));
        b.add(new THREE.LatheGeometry(prof, 12), C, T(0, 0, 0));
        for (let i = 0; i < 6; i++) { const a2 = (i / 6) * Math.PI * 2; b.add(sph(0.14 * k, 6, 4), C, T(Math.sin(a2) * 0.4 * k, 0.36 * k, Math.cos(a2) * 0.4 * k, 0, 0, 0, [1.1, 0.7, 1.1])); }
        if (big) {
          for (const s of [-1, 1]) { b.add(sph(0.07, 6, 4), '#ff3a2a', T(s * 0.12, 1.24 * k, -0.4 * k, 0, 0, -s * 0.3, [1.3, 0.7, 0.5])); b.add(box(0.015, 0.07, 0.02), '#ffd23f', T(s * 0.12, 1.24 * k, -0.44 * k)); }
          for (const s of [-1, 1]) b.add(box(0.03, 0.5, 0.03), '#4a3a7a', T(s * 0.22, 0.8 * k, -0.43 * k, -0.05, 0, s * 0.1));
        } else {
          for (const s of [-1, 1]) b.add(cone(0.08, 0.15, 3), '#ffffff', T(s * 0.11, 1.08 * k, -0.4 * k, 0, 0, Math.PI + s * 0.3, [1, 1, 0.3]));
          for (const [az, y, r] of [[0.5, 0.8, 0.045], [-0.6, 0.66, 0.035], [1.0, 1.12, 0.03], [-0.15, 0.52, 0.04], [-1.1, 1.0, 0.03]]) b.add(sph(r, 5, 4), '#ffffff', T(Math.sin(az) * 0.45 * k, y * k, -Math.cos(az) * 0.45 * k));
        }
        limb(b, [[-0.36 * k, 0.9 * k, -0.1], [-0.66 * k, 0.86 * k, -0.24 * k], [-0.8 * k, 0.56 * k, -0.3 * k]], 0.08, 0.025, C, 5);
        b.add(cone(0.07, 0.16, 4), C, T(-0.82 * k, 0.48 * k, -0.3 * k, 0, 0, Math.PI - 0.3));
        break;
      }
      case 'knight': {
        // dgb_knight: a small slate knight — round dark helm-head with mint eye dots, a slate trapezoid body narrowing
        // down, thin dark legs, a tall maroon shield with a gold bar on the near arm
        const SL = '#575a78', SLD = '#4a4d68';
        for (const s of [-1, 1]) seg(b, [s * 0.1, 0.42, 0], [s * 0.1, 0.03, -0.02], 0.045, 0.04, '#2e3048', 5);
        b.add(cyl(0.28, 0.16, 0.54, 8), SL, T(0, 0.7, 0));
        b.add(sph(0.26, 10, 7), SLD, T(0, 1.2, 0));
        b.add(box(0.36, 0.05, 0.1), '#3a3c54', T(0, 1.2, -0.22));
        for (const s of [-1, 1]) b.add(sph(0.03, 4, 3), '#7af0c0', T(s * 0.08, 1.2, -0.26));
        b.add(box(0.04, 0.6, 0.4), '#7a3040', T(-0.34, 0.74, -0.12));
        b.add(box(0.045, 0.56, 0.06), '#c9a04a', T(-0.345, 0.74, -0.12));
        limb(b, [[0.28, 0.92, 0], [0.32, 0.74, 0.04], [0.3, 0.58, 0]], 0.045, 0.04, SL, 5);
        break;
      }
      case 'monk': case 'tinnik': {
        // dg_monk: a tall bell robe in brown-taupe with a darker hood, a peach face with a cream cloth over the mouth, a
        // gold rope belt, a tall staff with a gold orb. dg_tinnik: the swamp version — green-grey skin, mossy dark cloak
        // with vine strands, yellow-green eyes, a gold three-prong fork
        const sw = a === 'tinnik';
        const ROBE = sw ? '#46604a' : '#8a7660', HOOD = sw ? '#3e5a3a' : '#6e5a45', SKIN = sw ? '#7f9e92' : '#e8c4a0';
        if (sw) for (const s of [-1, 1]) b.add(box(0.14, 0.2, 0.14), SKIN, T(s * 0.1, 0.1, 0));
        b.add(cyl(0.16, 0.32, sw ? 0.8 : 1.0, 10), ROBE, T(0, sw ? 0.56 : 0.5, 0));
        b.add(cyl(0.22, 0.22, 0.05, 10), sw ? '#4f7a2a' : '#b89a68', T(0, 0.66, 0));
        b.add(sph(0.22, 9, 6), HOOD, T(0, sw ? 1.08 : 1.18, 0.02, 0, 0, 0, [1, 1.08, 1]));
        b.add(sph(0.16, 8, 5), SKIN, T(0, sw ? 1.06 : 1.15, -0.13, 0, 0, 0, [1, 1, 0.75]));
        for (const s of [-1, 1]) b.add(sph(0.025, 4, 3), sw ? '#c8f040' : INK, T(s * 0.06, sw ? 1.09 : 1.19, -0.21, 0, 0, 0, [1, 1.4, 1]));
        if (!sw) b.add(sph(0.11, 7, 4), '#f4eedc', T(0, 1.07, -0.2, 0, 0, 0, [1, 0.55, 0.5]));
        else for (const x of [-0.2, 0.2]) limb(b, [[x, 1.14, -0.06], [x * 1.1, 0.8, -0.2], [x * 1.05, 0.4, -0.26]], 0.022, 0.016, '#4f7a2a', 3);
        limb(b, [[-0.18, 0.9, 0], [-0.36, 0.9, -0.12], [-0.46, 0.96, -0.2]], 0.05, 0.045, sw ? SKIN : ROBE, 5);
        if (sw) {
          seg(b, [-0.46, 0.84, -0.2], [-0.46, 1.16, -0.2], 0.018, 0.018, '#c8aa6a', 4);
          b.add(box(0.025, 0.025, 0.18), '#c8aa6a', T(-0.46, 1.16, -0.2));
          for (const z of [-0.08, 0, 0.08]) b.add(box(0.02, 0.09, 0.02), '#c8aa6a', T(-0.46, 1.2, -0.2 + z));
        } else {
          b.add(sph(0.045, 5, 4), SKIN, T(-0.46, 0.96, -0.2));
          seg(b, [-0.46, 0.02, -0.16], [-0.48, 1.46, -0.24], 0.022, 0.022, '#8a6a45', 4);
          b.add(sph(0.07, 6, 4), '#d4b05a', T(-0.48, 1.5, -0.24));
        }
        break;
      }
      case 'lavaslime': {
        // dg_lavaslime: a low red-orange magma dome with glowing yellow cracks, eyes set in the cracks, orange drips at the rim
        b.add(sph(0.46, 12, 6, 0, Math.PI * 2, 0, Math.PI * 0.55), '#cc3b17', T(0, 0.05, 0, 0, 0, 0, [1.1, 0.95, 1]));
        b.add(cyl(0.52, 0.5, 0.1, 12), '#cc3b17', T(0, 0.05, 0));
        // glowing cracks: zigzag strokes lying on the dome (points on the surface, slightly proud of it)
        const onDome = (az: number, el: number): V3 => [Math.sin(az) * Math.cos(el) * 0.52, 0.05 + Math.sin(el) * 0.45, -Math.cos(az) * Math.cos(el) * 0.47];
        for (const path of [[[-1.1, 0.35], [-0.8, 0.6], [-0.55, 0.42], [-0.3, 0.75]], [[0.25, 0.8], [0.5, 0.5], [0.8, 0.66], [1.15, 0.38]], [[-0.2, 1.1], [0.15, 1.2], [0.3, 1.0]], [[2.4, 0.5], [2.8, 0.8], [3.3, 0.55]]])
          for (let i = 0; i + 1 < path.length; i++) seg(b, onDome(path[i][0], path[i][1]), onDome(path[i + 1][0], path[i + 1][1]), 0.022, 0.022, '#ffd23f', 3);
        for (const s of [-1, 1]) { b.add(sph(0.075, 8, 6), '#ffd23f', T(s * 0.15, 0.3, -0.4, 0, 0, 0, [1.1, 0.9, 0.5])); b.add(sph(0.035, 6, 4), INK, T(s * 0.15, 0.3, -0.44)); }
        for (let i = 0; i < 6; i++) { const a2 = (i / 6) * Math.PI * 2 + 0.3; b.add(sph(0.07, 5, 3), '#f07a20', T(Math.sin(a2) * 0.5, 0.06, Math.cos(a2) * 0.5, 0, 0, 0, [1, 1.4, 1])); }
        break;
      }
      case 'splasher': {
        // dg_splasher: a sky-blue water drop with a rounded point, a smiling face, a light highlight, three splash curls on
        // top and a flat grey-blue puddle
        b.add(cyl(0.48, 0.5, 0.04, 12), '#7ab0c8', T(0, 0.02, 0));
        b.add(new THREE.LatheGeometry([[0, 0.04], [0.3, 0.08], [0.4, 0.26], [0.38, 0.5], [0.26, 0.74], [0.1, 0.94], [0, 1.0]].map(([r, y]) => new THREE.Vector2(r, y)), 12), '#6cc8e8', T(0, 0, 0));
        b.add(sph(0.08, 6, 4), '#a0dcf0', T(0.22, 0.28, -0.32, 0, 0, 0, [0.7, 1, 0.4]));
        for (const s of [-1, 1]) { b.add(sph(0.075, 8, 6), '#ffffff', T(s * 0.13, 0.52, -0.34)); b.add(sph(0.038, 6, 4), INK, T(s * 0.13, 0.52, -0.41)); }
        b.add(tor(0.07, 0.016, Math.PI, 3, 6), INK, T(0, 0.38, -0.4, 0, 0, Math.PI));
        for (let i = -1; i <= 1; i++) b.add(tor(0.1, 0.02, Math.PI * 0.9, 3, 6), '#a8e4f4', T(i * 0.12, 1.06, 0, 0, 0, Math.PI * 0.1 - i * 0.7));
        break;
      }
      case 'slime':
      default: {
        const c0 = '#7ed36a', c1 = '#4fa84a';
        b.add(sph(0.45, 12, 8), c0, T(0, 0.38, 0, 0, 0, 0, [1, 0.78, 1]));
        b.add(sph(0.2, 8, 6), '#c8f4b0', T(-0.14, 0.58, -0.22, 0, 0, 0, [1, 0.5, 0.5]));
        for (const s of [-1, 1]) { b.add(sph(0.08, 8, 6), '#ffffff', T(s * 0.14, 0.52, -0.38)); b.add(sph(0.04, 6, 4), INK, T(s * 0.14, 0.52, -0.44)); }
        b.add(sph(0.1, 8, 6), c1, T(0, 0.78, 0.05));
        break;
      }
      case 'pumpkin': {
        // Тыквоголов: a scarecrow body in slate rags (ragged hem, darker patches), thin dark legs, a reaching arm with
        // straw fingers, a rotten pumpkin head with a warm glowing face and a vine stem
        for (const s of [-1, 1]) seg(b, [s * 0.11, 0.4, 0], [s * 0.13, 0.02, -0.02], 0.05, 0.045, HW.dark, 6);
        b.add(cyl(0.18, 0.23, 0.44, 10), HW.cloth, T(0, 0.58, 0));
        hem(b, 0.38, 0.22, 7, 0.14, HW.cloth);
        b.add(sph(0.18, 10, 6), HW.cloth, T(0, 0.78, 0, 0, 0, 0, [1.1, 0.6, 1]));
        b.add(box(0.12, 0.1, 0.04), HW.clothD, T(-0.06, 0.62, -0.215, 0, 0, 0.3));
        for (const r of [0.7, -0.7]) b.add(box(0.3, 0.03, 0.02), HW.strawD, T(0.0, 0.7, -0.225, 0, 0, r));
        limb(b, [[-0.19, 0.76, 0], [-0.36, 0.68, -0.16], [-0.44, 0.48, -0.26]], 0.05, 0.045, HW.cloth, 6);
        for (let i = 0; i < 3; i++) seg(b, [-0.44, 0.48, -0.26], [-0.44 + (i - 1) * 0.06, 0.32, -0.32], 0.02, 0.012, HW.straw, 4);
        b.add(sph(0.06, 6, 4), HW.cloth, T(0.2, 0.72, 0.02));
        seg(b, [0.2, 0.72, 0.02], [0.25, 0.5, 0.06], 0.045, 0.04, HW.cloth, 6);
        pumpkinHead(b, 1.04, 0.27, HW.pump, HW.fire);
        break;
      }
      case 'pumpkinlet': {
        // Тыквёнок: a round little jack-o'-lantern on stubby vine legs
        for (const s of [-1, 1]) seg(b, [s * 0.09, 0.14, 0], [s * 0.1, 0.02, -0.02], 0.04, 0.035, HW.vine, 6);
        pumpkinHead(b, 0.36, 0.25, HW.pump, HW.fire);
        break;
      }
      case 'golem': {
        // the Pumpkin Golem («Тыквенный голем», hw_pumpkin leader): a hulk of dark rotten pumpkin with rot grooves and
        // patches, thick vine legs and vine arms ending in pumpkin fists, a dark lantern head glowing yellow, a crown of
        // bone shards (site: topBoss 212 vs top 146)
        for (const s of [-1, 1]) seg(b, [s * 0.26, 0.36, 0], [s * 0.28, 0.02, -0.02], 0.14, 0.13, HW.vine, 7);
        b.add(sph(0.52, 12, 8), HW.pumpD, T(0, 0.72, 0, 0, 0, 0, [1.12, 0.76, 0.72]));
        for (let i = 0; i < 6; i++) { const a2 = (i / 6) * Math.PI * 2; b.add(sph(0.3, 8, 6), i % 2 ? HW.pumpD : '#8a4216', T(Math.sin(a2) * 0.3, 0.72, Math.cos(a2) * 0.19, 0, a2, 0, [0.6, 1.0, 1])); }
        for (const x of [-0.26, 0, 0.26]) b.add(box(0.035, 0.5, 0.03), HW.rotP, T(x, 0.72, -0.36 + Math.abs(x) * 0.25, 0, -x * 1.2, 0));
        b.add(sph(0.12, 6, 4), HW.rotP, T(-0.2, 0.8, -0.34, 0, 0, 0, [1, 0.6, 0.4]));
        b.add(sph(0.1, 6, 4), HW.rotP, T(0.18, 0.62, -0.35, 0, 0, 0, [1, 0.6, 0.4]));
        for (const s of [-1, 1]) {
          limb(b, [[s * 0.5, 0.92, 0], [s * 0.82, 1.0, -0.05], [s * 1.02, 0.82, -0.1], [s * 1.08, 0.56, -0.14]], 0.12, 0.1, HW.vine, 6);
          b.add(sph(0.17, 9, 7), HW.pump, T(s * 1.08, 0.44, -0.14, 0, 0, 0, [1, 0.9, 1]));
        }
        pumpkinHead(b, 1.18, 0.37, HW.pumpD, HW.fireY);
        b.add(cyl(0.2, 0.22, 0.06, 8), HW.boneD, T(0, 1.5, 0.02));
        for (let i = 0; i < 5; i++) b.add(cone(0.06, 0.24 - Math.abs(i - 2) * 0.05, 4), HW.boneD, T((i - 2) * 0.09, 1.6 - Math.abs(i - 2) * 0.02, 0.02, 0, 0, (i - 2) * 0.12));
        break;
      }
      case 'cat': case 'catLead': {
        // Leader («Кот-ведьмак», o.boss): a ragged slate witch-hat and cold pale-blue eyes
        const lead = a === 'catLead';
        // Изнанка black cat: mangy, arched back with a ragged belly, thin legs, a long tail rising high with bone
        // rings, a torn ear, yellow eyes with slit pupils, grey whiskers and stitches
        const c = HW.fur;
        for (const [z, s] of [[-0.32, -1], [-0.15, 1], [0.28, -1], [0.42, 1]] as [number, number][]) seg(b, [s * 0.1, 0.48, z], [s * 0.1, 0.03, z - 0.02], 0.045, 0.04, c, 6);
        b.add(sph(0.32, 10, 6), c, T(0, 0.66, 0.06, 0.12, 0, 0, [0.62, 0.58, 1.45]));
        b.add(sph(0.2, 8, 6), c, T(0, 0.82, 0.06, 0, 0, 0, [0.8, 0.5, 1.4]));
        hem(b, 0.5, 0.13, 6, 0.1, c, 0.05, 1);
        limb(b, [[0, 0.7, 0.46], [0, 0.76, 0.66], [0, 0.86, 0.82], [0, 1.0, 0.86], [0, 1.12, 0.8], [0, 1.24, 0.76], [0, 1.36, 0.8], [0, 1.42, 0.9]], 0.065, 0.045, c, 5);
        b.add(tor(0.062, 0.018, Math.PI * 2, 3, 8), HW.bone, T(0, 0.98, 0.86, Math.PI / 2, 0, 0));
        b.add(tor(0.055, 0.018, Math.PI * 2, 3, 8), HW.bone, T(0, 1.2, 0.76, Math.PI / 2, 0, 0));
        b.add(sph(0.23, 10, 7), c, T(0, 0.72, -0.5));
        b.add(cone(0.1, 0.28, 4), c, T(-0.12, 0.97, -0.52, 0, 0, 0.25));
        b.add(cone(0.09, 0.24, 4), c, T(0.13, 0.95, -0.5, 0, 0, -0.35));
        for (const s of [-1, 1]) {
          b.add(sph(0.065, 7, 5), lead ? HW.ghostL : HW.fireY, T(s * 0.09, 0.75, -0.68, 0, 0, 0, [0.9, 1.25, 0.6]));
          b.add(box(0.016, 0.09, 0.02), INK, T(s * 0.09, 0.75, -0.72));
          for (const t of [0, 1]) seg(b, [s * 0.12, 0.66 - t * 0.03, -0.68], [s * 0.34, 0.68 - t * 0.09, -0.64], 0.006, 0.004, '#8a8f9e', 3);
        }
        limb(b, [[-0.1, 0.6, -0.3], [-0.14, 0.4, -0.5], [-0.12, 0.2, -0.58]], 0.045, 0.04, c, 6);
        b.add(box(0.12, 0.012, 0.012), '#5a5f6e', T(0.1, 0.92, 0.1, 0, 0.6, 0));
        if (lead) {
          b.add(cyl(0.3, 0.28, 0.025, 10), HW.cloth, T(0, 0.92, -0.5, -0.15, 0, 0.1));
          limb(b, [[0, 0.92, -0.5], [0.02, 1.12, -0.46], [0.1, 1.3, -0.36]], 0.15, 0.02, HW.cloth, 7);
        }
        break;
      }
      case 'zombie': case 'zombieLead': case 'frostdead': case 'sailor': case 'prisoner': {
        // Изнанка zombie: rotting grey-green skin, slate shirt torn into a jagged hem with holes and bare ribs, dark legs,
        // one arm stretched forward with bone fingertips, a slack jaw full of holes, one big red eye, thin hairs.
        // Leader (o.boss «староста»): a darker shirt, a battered top hat and a rusty shovel. The same body serves the
        // dungeon dead: dg_frostdead (icy skin, slate tunic, cyan eyes, white hood), dg_sailor (red bandana, striped
        // shirt, cutlass), dg_prisoner (tan rags, brown hair, ball and chain)
        const lead = a === 'zombieLead', frost = a === 'frostdead', sailor = a === 'sailor', pris = a === 'prisoner';
        const SKIN = frost ? '#a8b8cc' : sailor ? '#8faf9f' : pris ? '#e0c09a' : HW.rot, SKIND = frost ? '#8494aa' : sailor ? '#6f8f7f' : pris ? '#b8987a' : HW.rotD;
        const CL = lead ? '#33303a' : frost ? '#5a6a7a' : sailor ? '#3f5a9a' : pris ? '#9a8660' : HW.cloth, CLD = frost ? '#46566a' : pris ? '#7a6a48' : HW.clothD;
        const EYE = frost ? '#7af0ff' : pris || sailor ? INK : HW.eye, LEGS = frost ? '#7aa8c8' : sailor ? '#232a44' : pris ? '#6a4a30' : HW.dark;
        for (const s of [-1, 1]) seg(b, [s * 0.11, 0.52, 0], [s * 0.13, 0.03, -0.02], 0.06, 0.055, LEGS, 5);
        b.add(cyl(0.2, 0.23, 0.56, 9), CL, T(0, 0.78, 0));
        hem(b, 0.52, 0.22, 7, 0.14, CL);
        if (sailor) for (let i = 0; i < 4; i++) b.add(cyl(0.224 - i * 0.006, 0.226 - i * 0.006, 0.06, 9), '#f0ece4', T(0, 0.6 + i * 0.12, 0));
        if (!pris) {
          b.add(sph(0.08, 6, 4), CLD, T(0.05, 0.85, -0.25, 0, 0, 0, [1.4, 1.2, 0.4]));
          for (let i = 0; i < 2; i++) b.add(box(0.12, 0.022, 0.02), HW.bone, T(0.05, 0.88 - i * 0.05, -0.27));
        }
        b.add(sph(0.05, 6, 4), CLD, T(-0.1, 0.6, -0.26, 0, 0, 0, [1.2, 1.2, 0.4]));
        b.add(sph(0.26, 8, 6), SKIN, T(0, 1.22, -0.02, 0, 0, 0, [1, 1.08, 1]));
        b.add(box(0.22, 0.1, 0.17), SKIN, T(0, 0.99, -0.08));
        if (pris || sailor) b.add(box(0.1, 0.02, 0.03), INK, T(0, 1.03, -0.16, 0, 0, pris ? 0 : 0.2));
        else {
          b.add(box(0.16, 0.04, 0.03), HW.hole, T(0, 1.01, -0.15));
          for (let i = 0; i < 4; i++) b.add(box(0.014, 0.035, 0.02), HW.bone, T(-0.05 + i * 0.033, 1.02, -0.165));
        }
        if (frost || pris || sailor) for (const s of [-1, 1]) b.add(sph(0.035, 5, 4), EYE, T(s * 0.09, 1.24, -0.235));
        else {
          b.add(sph(0.06, 6, 4), HW.hole, T(-0.09, 1.23, -0.22));
          b.add(sph(0.026, 5, 4), HW.eye, T(-0.09, 1.23, -0.26));
          b.add(sph(lead ? 0.068 : 0.055, 6, 5), HW.eye, T(0.09, 1.25, -0.22));
        }
        if (!lead && !frost && !sailor && !pris) for (let i = 0; i < 3; i++) limb(b, [[-0.06 + i * 0.06, 1.44, -0.02], [-0.08 + i * 0.07, 1.54, 0.0], [-0.14 + i * 0.08, 1.6 - (i % 2) * 0.04, 0.02]], 0.014, 0.008, INK, 3);
        limb(b, [[-0.2, 0.94, -0.03], [-0.26, 0.95, -0.34], [-0.24, 0.98, -0.66]], 0.06, 0.05, SKIN, 5);
        for (let i = 0; i < 3; i++) seg(b, [-0.24, 0.98, -0.66], [-0.27 + i * 0.03, 0.98 + (i - 1) * 0.04, -0.77], 0.018, 0.012, frost ? '#d8f4ff' : pris || sailor ? SKIN : HW.bone, 4);
        limb(b, [[0.22, 0.94, 0], [0.3, 0.74, 0.08], [0.33, 0.56, 0.0]], 0.055, 0.045, SKIND, 5);
        if (lead) {
          b.add(cyl(0.3, 0.3, 0.025, 10), '#1c1e26', T(0, 1.45, 0, 0.08, 0, 0.06));
          b.add(cyl(0.17, 0.19, 0.26, 9), '#1c1e26', T(0, 1.59, 0.01, 0.08, 0, 0.1));
          seg(b, [-0.24, 0.2, -0.7], [-0.24, 1.36, -0.66], 0.025, 0.025, HW.woodD, 5);
          b.add(box(0.03, 0.28, 0.22), HW.metal, T(-0.24, 0.12, -0.7));
        }
        if (frost) {
          b.add(sph(0.29, 9, 5, 0, Math.PI * 2, 0, Math.PI * 0.55), '#eef4fa', T(0, 1.24, 0.03, -0.3, 0, 0));
          for (let i = 0; i < 3; i++) b.add(cone(0.025, 0.1, 4), '#d8f4ff', T(-0.26 + i * 0.03, 0.88, -0.36 - i * 0.12, Math.PI, 0, 0));
        }
        if (sailor) {
          b.add(sph(0.27, 9, 4, 0, Math.PI * 2, 0, Math.PI * 0.45), '#d63a3a', T(0, 1.26, -0.0));
          b.add(cone(0.05, 0.18, 4), '#d63a3a', T(0.06, 1.32, 0.28, 1.2, 0, 0));
          b.add(slab([0.03, 0.06, 0.08, 0.04, 0.0, -0.3, -0.12, -0.56, -0.06, -0.3], 0.03, 'side', -0.3), '#d8dce4', T(0, 0.96, -0.72));
          b.add(box(0.05, 0.03, 0.16), '#c9a04a', T(-0.3, 1.02, -0.68));
        }
        if (pris) {
          b.add(sph(0.27, 9, 4, 0, Math.PI * 2, 0, Math.PI * 0.4), '#7a5a3a', T(0, 1.26, 0.02, 0.3, 0, 0));
          seg(b, [0.13, 0.08, -0.02], [0.3, 0.06, 0.32], 0.012, 0.012, '#555560', 3);
          b.add(sph(0.1, 7, 5), '#2a2a33', T(0.3, 0.1, 0.36));
          b.add(cyl(0.07, 0.07, 0.05, 6), '#555560', T(0.13, 0.1, -0.02));
        }
        break;
      }
      case 'scarecrow': case 'scarecrowLead': {
        // Leader («Пугало-жнец», o.boss): darker rags, a sickle on the near arm and a raven on the far shoulder
        const lead = a === 'scarecrowLead', rag = lead ? '#33303a' : HW.cloth;
        // Изнанка scarecrow: a rotten pole with a crossbar, slate rags with a jagged hem and patches, straw tufts at the
        // ends, a burlap sack head with red ember eyes and a stitched grin, a floppy wooden-brown hat
        seg(b, [0, 0, 0.05], [0, 1.42, 0.05], 0.035, 0.03, HW.woodD, 6);
        seg(b, [-0.58, 0.98, 0.04], [0.58, 0.98, 0.04], 0.032, 0.032, HW.woodD, 6);
        b.add(cyl(0.2, 0.28, 0.7, 10), rag, T(0, 0.68, 0));
        hem(b, 0.34, 0.27, 8, 0.14, rag);
        b.add(box(0.13, 0.13, 0.03), HW.clothD, T(0.07, 0.84, -0.2));
        b.add(box(0.1, 0.07, 0.03), HW.clothD, T(-0.1, 0.62, -0.24));
        for (const s of [-1, 1]) {
          seg(b, [s * 0.18, 0.98, 0.04], [s * 0.52, 0.98, 0.04], 0.06, 0.05, rag, 6);
          for (let i = 0; i < 3; i++) seg(b, [s * 0.54, 0.98, 0.04], [s * (0.62 + i * 0.03), 0.82 + i * 0.03, 0.04 + (i - 1) * 0.05], 0.026, 0.012, '#a89c74', 4);
          for (let i = 0; i < 2; i++) seg(b, [s * 0.18, 0.36, -0.05 + i * 0.1], [s * 0.26, 0.18, -0.08 + i * 0.12], 0.026, 0.012, '#a89c74', 4);
        }
        b.add(sph(0.22, 8, 6), '#8a8268', T(0, 1.28, -0.01, 0, 0, 0, [1, 1.1, 0.95]));
        b.add(cyl(0.1, 0.14, 0.06, 8), HW.strawD, T(0, 1.07, 0));
        b.add(sph(0.045, 5, 4), HW.eye, T(-0.08, 1.34, -0.2));
        b.add(sph(0.04, 5, 4), HW.eye, T(0.08, 1.35, -0.2));
        for (const r of [0.7, -0.7]) b.add(box(0.1, 0.016, 0.02), INK, T(-0.08, 1.34, -0.215, 0, 0, r));
        for (let i = 0; i < 4; i++) b.add(box(0.05, 0.016, 0.02), INK, T(-0.09 + i * 0.06, 1.2 - (i % 2) * 0.016, -0.2, 0, 0, (i % 2 ? 0.5 : -0.5)));
        b.add(cyl(0.36, 0.3, 0.03, 12), HW.wood, T(0, 1.46, 0, 0.18, 0, 0.12));
        limb(b, [[0.0, 1.46, 0.02], [0.03, 1.6, 0.04], [0.12, 1.7, 0.08]], 0.16, 0.06, HW.wood, 8);
        if (lead) {
          seg(b, [-0.5, 0.98, 0.04], [-0.56, 0.42, -0.12], 0.022, 0.022, HW.woodD, 5);
          b.add(tor(0.26, 0.03, Math.PI * 0.9, 3, 8), HW.metal, T(-0.56, 0.62, -0.34, 0, Math.PI / 2, -Math.PI * 0.55, [1, 1, 0.5]));
          b.add(sph(0.09, 7, 5), HW.fur, T(0.2, 1.14, 0.06, 0, 0, 0, [0.8, 0.85, 1.4]));
          b.add(sph(0.06, 6, 4), HW.fur, T(0.2, 1.22, -0.06));
          b.add(cone(0.022, 0.08, 4), HW.strawD, T(0.2, 1.21, -0.14, -Math.PI / 2, 0, 0));
          b.add(sph(0.015, 4, 3), HW.eye, T(0.245, 1.24, -0.08));
          b.add(cone(0.06, 0.14, 4), HW.fur, T(0.2, 1.12, 0.2, Math.PI / 2, 0, 0, [1.3, 1, 0.5]));
        }
        break;
      }
      case 'witch': case 'witchLead': {
        // Leader («Старшая ведьма», o.boss): darker robe and skin, a taller hat and a dark cauldron at the belt
        const lead = a === 'witchLead', robe = lead ? '#4a3e66' : HW.lilac, skin = lead ? '#7f9480' : '#94a892';
        // Изнанка witch on a broom: grey-lilac rags, pale green skin with a long nose, red eyes, a tall black hat with a
        // lilac band, bone-grey hair, dangling dark legs, a lilac potion in the reaching hand
        seg(b, [0, 0.5, -0.66], [0, 0.66, 0.7], 0.03, 0.03, HW.wood, 6);
        b.add(cone(0.16, 0.42, 7), '#a89c74', T(0, 0.68, 0.9, Math.PI / 2 + 0.1, 0, 0));
        b.add(cyl(0.05, 0.05, 0.06, 6), HW.woodD, T(0, 0.67, 0.68, Math.PI / 2 + 0.1, 0, 0));
        b.add(cyl(0.13, 0.27, 0.6, 10), robe, T(0, 0.88, 0.05));
        hem(b, 0.6, 0.25, 7, 0.14, robe, 0.05);
        if (lead) { b.add(sph(0.11, 7, 5), HW.dark, T(0.06, 0.76, -0.27, 0, 0, 0, [1, 0.85, 1])); b.add(tor(0.08, 0.015, Math.PI * 2, 3, 8), HW.metal, T(0.06, 0.84, -0.27, Math.PI / 2, 0, 0)); }
        for (const s of [-1, 1]) seg(b, [s * 0.1, 0.56, -0.04], [s * 0.12, 0.32, -0.12], 0.035, 0.03, HW.dark, 5);
        limb(b, [[-0.16, 1.08, 0], [-0.3, 1.04, -0.22], [-0.36, 1.12, -0.42]], 0.05, 0.04, robe, 6);
        b.add(sph(0.07, 7, 5), HW.lilacL, T(-0.36, 1.15, -0.48));
        b.add(sph(0.14, 8, 6), skin, T(0, 1.32, -0.03));
        b.add(cone(0.035, 0.14, 5), skin, T(0, 1.28, -0.2, -Math.PI / 2 - 0.4, 0, 0));
        for (const s of [-1, 1]) b.add(sph(0.025, 5, 4), HW.eye, T(s * 0.055, 1.35, -0.13));
        limb(b, [[0.08, 1.38, 0.08], [0.12, 1.2, 0.2], [0.09, 1.0, 0.24]], 0.02, 0.014, HW.boneD, 4);
        limb(b, [[-0.06, 1.38, 0.1], [-0.08, 1.2, 0.2], [-0.04, 1.04, 0.22]], 0.02, 0.014, HW.boneD, 4);
        b.add(cyl(0.3, 0.3, 0.03, 12), HW.fur, T(0, 1.44, 0, -0.08, 0, 0));
        b.add(cyl(0.14, 0.15, 0.06, 10), HW.lilacL, T(0, 1.48, 0));
        if (lead) limb(b, [[0, 1.48, 0], [0.0, 1.8, 0.03], [0.0, 2.2, 0.18]], 0.15, 0.02, HW.fur, 8);
        else limb(b, [[0, 1.48, 0], [0.0, 1.72, 0.04], [0.0, 1.95, 0.16]], 0.14, 0.02, HW.fur, 8);
        break;
      }
      case 'jack': {
        // Джек-Фонарщик: tall and thin in a long dark coat with ragged tails, a lantern with a warm flame in the reaching
        // hand, a pumpkin head with a yellow grin, a battered top hat with a lilac band
        for (const s of [-1, 1]) seg(b, [s * 0.13, 0.64, 0], [s * 0.16, 0.03, -0.02], 0.065, 0.055, HW.dark, 6);
        b.add(cyl(0.25, 0.3, 1.0, 10), HW.clothD, T(0, 0.98, 0));
        hem(b, 0.5, 0.3, 8, 0.16, HW.clothD);
        b.add(sph(0.25, 10, 6), HW.clothD, T(0, 1.46, 0, 0, 0, 0, [1.2, 0.5, 1]));
        b.add(box(0.06, 0.6, 0.03), HW.cloth, T(0, 1.15, -0.27));
        limb(b, [[-0.27, 1.42, 0], [-0.52, 1.2, -0.24], [-0.6, 0.94, -0.42]], 0.075, 0.065, HW.clothD, 5);
        seg(b, [-0.6, 0.92, -0.42], [-0.6, 0.76, -0.42], 0.01, 0.01, INK, 3);
        b.add(cyl(0.11, 0.13, 0.05, 6), HW.metal, T(-0.6, 0.76, -0.42));
        b.add(cyl(0.12, 0.12, 0.04, 6), HW.metal, T(-0.6, 0.48, -0.42));
        b.add(sph(0.1, 8, 6), HW.fireY, T(-0.6, 0.62, -0.42, 0, 0, 0, [1.25, 1.2, 1.25]));
        limb(b, [[0.27, 1.42, 0], [0.5, 1.16, 0.1], [0.56, 0.88, 0.06]], 0.075, 0.065, HW.clothD, 5);
        pumpkinHead(b, 1.78, 0.33, HW.pump, HW.fireY);
        b.add(cyl(0.34, 0.34, 0.03, 12), HW.fur, T(0, 2.02, 0));
        b.add(cyl(0.17, 0.18, 0.28, 10), HW.fur, T(0, 2.16, 0, 0, 0, 0.06));
        b.add(cyl(0.185, 0.185, 0.05, 10), HW.lilacL, T(0, 2.06, 0, 0, 0, 0.06));
        break;
      }
    }
    return tinted(b.build());
  }
}

export function crownGeo(): THREE.BufferGeometry {
  return cached('crown', () => {
    const b = new GB();
    b.add(cyl(0.16, 0.16, 0.08, 12), '#ffc94d', T(0, 0.04, 0));
    for (let i = 0; i < 5; i++) { const a = (i / 5) * Math.PI * 2; b.add(cone(0.04, 0.12, 4), '#ffc94d', T(Math.cos(a) * 0.14, 0.13, Math.sin(a) * 0.14)); b.add(sph(0.025, 5, 4), '#ff4a5a', T(Math.cos(a) * 0.16, 0.05, Math.sin(a) * 0.16)); }
    return b.build();
  });
}

/* ------------------------------------------------------------------ the boss */

export const BOSS_PAL = [
  { body: '#5e7a4a', belly: '#b8c890', horn: '#f1ead6', eye: '#ffd34d', spike: '#3e5a32' },   // swamp
  { body: '#8a3a3a', belly: '#e8a070', horn: '#2a1a1a', eye: '#ffe27a', spike: '#5a1f1f' },   // fire
  { body: '#4a6a9a', belly: '#c8e0ff', horn: '#e8f4ff', eye: '#7af0ff', spike: '#2e4a7a' },   // frost
  { body: '#5a3a7a', belly: '#c8a8e8', horn: '#f1ead6', eye: '#ff7af0', spike: '#3a1f5a' },   // shadow
];
/** Big horned beast ~1.9 m unscaled (the scene scales it ×2–3). */
export function bossGeo(pal: number): THREE.BufferGeometry {
  const P = BOSS_PAL[((pal % BOSS_PAL.length) + BOSS_PAL.length) % BOSS_PAL.length];
  return cached('boss:' + pal, () => {
    const b = new GB();
    const INK = '#231a2c';
    b.add(sph(0.62, 16, 12), P.body, T(0, 0.85, 0.05, 0, 0, 0, [1.1, 1, 1]));
    b.add(sph(0.44, 14, 10), P.belly, T(0, 0.78, -0.3, 0, 0, 0, [1, 1.05, 0.6]));
    b.add(sph(0.46, 16, 12), P.body, T(0, 1.55, -0.18, 0, 0, 0, [1.1, 0.95, 1]));
    b.add(sph(0.3, 12, 9), P.belly, T(0, 1.4, -0.48, 0, 0, 0, [1.2, 0.7, 0.7]));
    for (let i = 0; i < 5; i++) b.add(cone(0.05, 0.13, 4), '#ffffff', T(-0.2 + i * 0.1, 1.3, -0.62, Math.PI, 0, 0));
    for (const s of [-1, 1]) {
      b.add(sph(0.11, 10, 8), P.eye, T(s * 0.19, 1.66, -0.5));
      b.add(sph(0.05, 6, 5), INK, T(s * 0.19, 1.66, -0.6, 0, 0, 0, [0.6, 1.3, 0.6]));
      b.add(cone(0.11, 0.55, 8), P.horn, T(s * 0.36, 2.03, -0.12, -0.25, 0, -s * 0.55));
      b.add(cone(0.06, 0.2, 6), P.horn, T(s * 0.6, 2.3, -0.2, -0.4, 0, -s * 1.1));
      b.add(cyl(0.17, 0.13, 0.75, 10), P.body, T(s * 0.72, 0.95, -0.25, -0.7, 0, s * 0.45));
      b.add(sph(0.2, 10, 8), P.body, T(s * 0.86, 0.68, -0.6));
      for (let k = 0; k < 3; k++) b.add(cone(0.05, 0.16, 4), P.horn, T(s * (0.8 + k * 0.07), 0.62, -0.8, -Math.PI / 2, 0, 0));
      b.add(cyl(0.2, 0.22, 0.45, 10), P.body, T(s * 0.32, 0.22, 0.05));
      b.add(sph(0.24, 10, 8), P.spike, T(s * 0.33, 0.06, -0.1, 0, 0, 0, [1, 0.5, 1.3]));
    }
    for (let i = 0; i < 5; i++) b.add(cone(0.12, 0.34, 5), P.spike, T(0, 1.45 - i * 0.18 + 0.2, 0.42 + i * 0.03, 0.6 + i * 0.15, 0, 0));
    b.add(cone(0.16, 0.8, 7), P.body, T(0, 0.5, 0.75, 1.2, 0, 0));
    return tinted(b.build());
  });
}

/* ------------------------------------------------------------------ nature props */

export type PropKind = 'tree' | 'pine' | 'dead' | 'bush' | 'rock' | 'grass' | 'flower' | 'reed' | 'mushroom' | 'stalag' | 'crystal' | 'pillar' | 'torch'
  | 'stone' | 'mound' | 'cliff' | 'snowpine' | 'cactus' | 'support' | 'lily' | 'fence'
  | 'birch' | 'willow' | 'fern' | 'boulder' | 'stump' | 'fallen' | 'tomb' | 'ruin' | 'bones' | 'barrel' | 'crate' | 'drift' | 'ice' | 'agave' | 'hang'
  | 'pebbles' | 'dry' | 'snowtuft' | 'menhir' | 'dolmen' | 'brazier' | 'moss' | 'spire' | 'tumble' | 'cattail' | 'berry'
  | 'sandrock' | 'scree' | 'shrub' | 'ribs' | 'arch' | 'slab';
/** Vertical-gradient colour of a part (AO-like: dark at the bottom, light on top) — baked per vertex. */
const grad = (b: GB, g: THREE.BufferGeometry, c0: string, c1: string, m: THREE.Matrix4, y0: number, y1: number, tint = 0) => b.addG(g, c0, c1, m, y0, y1, tint);
/** tiny hash for deterministic variety inside geometry builders */
const hh = (i: number) => { const s = Math.sin(i * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };
export function propGeo(k: PropKind, pal = 0): THREE.BufferGeometry {
  return cached(`prop:${k}:${pal}`, () => {
    const b = new GB();
    switch (k) {
      case 'tree': {
        const L = [['#3f8a4a', '#8ad060'], ['#58a85a', '#b4e070'], ['#d0782e', '#ffc860'], ['#2f8a6a', '#7ae0a8']][pal % 4];
        grad(b, cyl(0.1, 0.2, 1.7, 7), '#4a3022', '#7a5436', T(0, 0.85, 0), 0, 1.7);
        b.add(cyl(0.2, 0.32, 0.22, 6), '#4a3022', T(0, 0.1, 0));
        for (const a of [0.6, 3.4]) b.add(cyl(0.04, 0.09, 0.5, 3), '#5a3e28', T(Math.cos(a) * 0.2, 1.5, Math.sin(a) * 0.2, Math.sin(a) * 0.9, 0, -Math.cos(a) * 0.9));
        grad(b, ico(0.95, 1), L[0], L[1], T(0, 2.15, 0, 0, 0, 0, [1, 0.9, 1]), 1.3, 3.0);
        grad(b, ico(0.62, 0), L[0], L[1], T(0.66, 1.72, 0.25), 1.1, 2.4);
        grad(b, ico(0.6, 0), L[0], L[1], T(-0.62, 1.78, -0.2), 1.1, 2.4);
        grad(b, ico(0.55, 0), L[0], L[1], T(0.1, 2.75, -0.1), 1.8, 3.3);
        grad(b, ico(0.5, 0), L[0], L[1], T(-0.2, 2.1, 0.62), 1.3, 2.8);
        if (pal % 4 === 0) { b.add(sph(0.08, 4, 3), '#ff5a6a', T(0.5, 1.9, -0.7)); b.add(sph(0.08, 4, 3), '#ff5a6a', T(-0.3, 2.4, -0.78)); }
        break;
      }
      case 'birch': {
        const L = pal % 2 ? ['#8aa84a', '#e0e070'] : ['#5aa860', '#b8e878'];
        grad(b, cyl(0.07, 0.12, 2.6, 6), '#d8d4c8', '#f4f0e4', T(0, 1.3, 0), 0, 2.6);
        for (let i = 0; i < 5; i++) b.add(box(0.15, 0.05, 0.14), '#3a3430', T(0, 0.4 + i * 0.42, 0, 0, i * 1.7, 0));
        grad(b, ico(0.7, 1), L[0], L[1], T(0, 2.9, 0, 0, 0, 0, [0.9, 1.15, 0.9]), 2.0, 3.8);
        grad(b, ico(0.48, 0), L[0], L[1], T(0.42, 2.3, 0.1), 1.8, 3.0);
        grad(b, ico(0.44, 0), L[0], L[1], T(-0.38, 2.4, -0.12), 1.8, 3.0);
        break;
      }
      case 'willow': {
        grad(b, cyl(0.14, 0.26, 1.8, 7), '#4a3a2a', '#6a5238', T(0, 0.9, 0, 0, 0, 0.08), 0, 1.8);
        grad(b, ico(1.05, 1), '#3f7a52', '#8ac078', T(0, 2.1, 0, 0, 0, 0, [1.25, 0.7, 1.25]), 1.5, 2.8);
        for (let i = 0; i < 12; i++) { const a = i / 12 * Math.PI * 2, r = 0.95 + hh(i) * 0.3, len = 1.1 + hh(i + 9) * 0.8; grad(b, cone(0.1, len, 3), '#4a8a58', '#a8d884', T(Math.cos(a) * r, 2.0 - len / 2 + 0.2, Math.sin(a) * r, 0, 0, 0, [1, -1, 1]), 2.1 - len, 2.1, 0); }
        break;
      }
      case 'pine': case 'snowpine': {
        const snow = k === 'snowpine';
        const L = snow ? ['#2f5f68', '#5a9a98'] : pal % 2 ? ['#2f6a4a', '#6ab070'] : ['#2a6a42', '#58a860'];
        grad(b, cyl(0.1, 0.18, 0.9, 6), '#4a3022', '#6a4a30', T(0, 0.45, 0), 0, 0.9);
        for (let i = 0; i < 4; i++) {
          const r = 1.05 - i * 0.2, y = 0.85 + i * 0.58;
          grad(b, cone(r, 1.15, 7), L[0], L[1], T(0, y + 0.45, 0, 0, i * 0.4, 0), y - 0.1, y + 1.0);
          if (snow) grad(b, cone(r * 0.78, 0.5, 7), '#dce8f4', '#ffffff', T(0, y + 0.82, 0, 0, i * 0.4, 0), y + 0.5, y + 1.1);
        }
        if (snow) b.add(sph(0.12, 5, 3), '#ffffff', T(0, 3.35, 0));
        break;
      }
      case 'dead':
        grad(b, cyl(0.07, 0.17, 2.0, 6), '#4a3c38', '#7a6a5e', T(0, 1.0, 0, 0, 0, 0.06), 0, 2.0);
        b.add(cyl(0.2, 0.3, 0.2, 6), '#4a3c38', T(0, 0.08, 0));
        b.add(cyl(0.035, 0.07, 0.9, 5), '#6a5a50', T(0.32, 1.45, 0, 0, 0, -0.95));
        b.add(cyl(0.03, 0.06, 0.8, 5), '#6a5a50', T(-0.28, 1.7, 0.05, 0, 0, 0.85));
        b.add(cyl(0.025, 0.05, 0.6, 5), '#6a5a50', T(0.05, 1.95, 0.25, 0.9, 0, 0.1));
        b.add(cyl(0.02, 0.04, 0.5, 4), '#6a5a50', T(0.55, 1.9, 0, 0, 0, -0.5));
        break;
      case 'bush': {
        const L = [['#3f8a4a', '#8ad060'], ['#2f7a5a', '#6ac888'], ['#6a9a2a', '#c8e060'], ['#5a6a4a', '#a0b078']][pal % 4];
        grad(b, ico(0.52, 1), L[0], L[1], T(0, 0.38, 0, 0, 0, 0, [1.25, 0.8, 1.05]), 0, 0.85);
        grad(b, ico(0.36, 0), L[0], L[1], T(0.45, 0.3, 0.12), 0, 0.7);
        grad(b, ico(0.33, 0), L[0], L[1], T(-0.4, 0.28, -0.12), 0, 0.65);
        grad(b, ico(0.3, 0), L[0], L[1], T(0.05, 0.3, 0.42), 0, 0.6);
        if (pal % 2 === 0) for (let i = 0; i < 4; i++) b.add(sph(0.06, 4, 3), ['#ff8ab0', '#ffffff', '#ffd34d', '#ff6a6a'][i], T(-0.35 + i * 0.24, 0.62 + hh(i) * 0.1, -0.38));
        break;
      }
      case 'berry': {
        grad(b, ico(0.45, 1), '#2f7a4a', '#6ab060', T(0, 0.35, 0, 0, 0, 0, [1.2, 0.8, 1]), 0, 0.8);
        for (let i = 0; i < 6; i++) b.add(sph(0.06, 4, 3), '#d83a5a', T(Math.cos(i * 1.1) * 0.42, 0.35 + hh(i) * 0.25, Math.sin(i * 1.1) * 0.4));
        break;
      }
      case 'rock': {
        const c = [['#6a6478', '#b4aec4'], ['#6a6050', '#b4a890'], ['#4a4658', '#8a869c'], ['#8a8274', '#d0c8b8']][pal % 4];
        grad(b, dod(0.58), c[0], c[1], T(0, 0.25, 0, 0.3, 0.5, 0.1, [1.2, 0.7, 1]), 0, 0.6);
        grad(b, dod(0.32), c[0], c[1], T(0.6, 0.12, 0.22, 0.4, 0.2, 0.3, [1, 0.7, 1]), 0, 0.4);
        if (pal === 0 || pal === 1) grad(b, dod(0.34), '#4a8a3a', '#7ac050', T(-0.05, 0.42, 0, 0.2, 0.4, 0.1, [1.1, 0.35, 0.9]), 0.3, 0.55);
        break;
      }
      case 'boulder': {
        const c = [['#5a566a', '#a8a2b8'], ['#6a5e50', '#b8a888'], ['#4a4658', '#8a869c'], ['#8a7a68', '#d8c8a8']][pal % 4];
        grad(b, dod(1.0), c[0], c[1], T(0, 0.6, 0, 0.3, 0.7, 0.1, [1.25, 0.85, 1.05]), 0, 1.5);
        grad(b, dod(0.6), c[0], c[1], T(1.0, 0.3, 0.4, 0.5, 0.2, 0.3, [1, 0.8, 1]), 0, 0.9);
        grad(b, dod(0.45), c[0], c[1], T(-0.8, 0.25, -0.5, 0.2, 0.9, 0.3, [1, 0.8, 1]), 0, 0.7);
        if (pal < 2) grad(b, dod(0.7), '#3f8a3a', '#78c050', T(0.05, 1.05, 0, 0.2, 0.4, 0.1, [1.2, 0.3, 1]), 0.9, 1.2);
        break;
      }
      case 'pebbles': {
        const c = [['#6a6478', '#b4aec4'], ['#7a6a52', '#c4b498'], ['#8a7a68', '#dccdb0'], ['#5a5668', '#9a96ac']][pal % 4];
        grad(b, new THREE.IcosahedronGeometry(0.16, 0), c[0], c[1], T(0, 0.07, 0, 0.3, 0.5, 0, [1.3, 0.7, 1]), 0, 0.2);
        grad(b, new THREE.IcosahedronGeometry(0.11, 0), c[0], c[1], T(0.26, 0.05, 0.12, 0.2, 1, 0, [1.2, 0.7, 1]), 0, 0.15);
        grad(b, new THREE.IcosahedronGeometry(0.08, 0), c[0], c[1], T(-0.2, 0.04, 0.18, 0.5, 0.2, 0, [1.2, 0.7, 1]), 0, 0.12);
        break;
      }
      case 'dry': {
        const c = pal % 2 ? ['#7a6a3a', '#cdb26a'] : ['#8a7a42', '#e0cc82'];
        for (let i = 0; i < 4; i++) { const a = (i / 4) * Math.PI * 2 + hh(i) * 0.6, lean = 0.45 + hh(i + 4) * 0.3; grad(b, new THREE.ConeGeometry(0.07, 0.55 + hh(i + 2) * 0.2, 3, 1, true), c[0], c[1], T(Math.cos(a) * 0.08, 0.26, Math.sin(a) * 0.08, Math.sin(a) * lean, 0, -Math.cos(a) * lean), 0, 0.6); }
        break;
      }
      case 'snowtuft': {
        grad(b, ico(0.2, 0), '#c0d2ea', '#ffffff', T(0, 0.08, 0, 0, 0, 0, [1.5, 0.6, 1.2]), 0, 0.3);
        for (let i = 0; i < 3; i++) b.add(new THREE.ConeGeometry(0.04, 0.28 + hh(i) * 0.1, 3), '#6a8a6a', T(Math.cos(i * 2.1) * 0.12, 0.2, Math.sin(i * 2.1) * 0.12, Math.sin(i * 2.1) * 0.3, 0, -Math.cos(i * 2.1) * 0.3));
        break;
      }
      case 'grass': {
        const c = [['#3f8a3a', '#9ae070'], ['#58a848', '#c8f080'], ['#8a8a3a', '#e0d078'], ['#2f7a4a', '#78d098']][pal % 4];
        for (let i = 0; i < 4; i++) { const a = (i / 4) * Math.PI * 2 + hh(i) * 0.6, lean = 0.3 + hh(i + 4) * 0.25; grad(b, new THREE.ConeGeometry(0.1, 0.5 + hh(i + 2) * 0.2, 3, 1, true), c[0], c[1], T(Math.cos(a) * 0.06, 0.2, Math.sin(a) * 0.06, Math.sin(a) * lean, 0, -Math.cos(a) * lean), 0, 0.5); }
        break;
      }
      case 'flower': {
        const c = ['#ff8ab0', '#ffd34d', '#9ab8ff', '#ffffff'][pal % 4];
        b.add(cyl(0.012, 0.012, 0.3, 3), '#4f9a4a', T(0, 0.15, 0));
        b.add(new THREE.ConeGeometry(0.11, 0.08, 5), c, T(0, 0.32, 0, Math.PI, 0, 0));
        b.add(sph(0.04, 4, 2), '#ffb02a', T(0, 0.35, 0));
        break;
      }
      case 'fern': {
        const c = pal % 2 ? ['#2f7a4a', '#80d080'] : ['#3a8a3a', '#a8e068'];
        for (let i = 0; i < 7; i++) { const a = i / 7 * Math.PI * 2, lean = 0.9 + hh(i) * 0.2; grad(b, new THREE.ConeGeometry(0.11, 0.85, 3, 1, true), c[0], c[1], T(Math.cos(a) * 0.28, 0.3, Math.sin(a) * 0.28, Math.sin(a) * lean, 0, -Math.cos(a) * lean), 0, 0.65); }
        break;
      }
      case 'cattail':
        for (let i = 0; i < 3; i++) { const x = (i - 1) * 0.1, h = 1.0 + hh(i) * 0.5; b.add(cyl(0.015, 0.022, h, 3), '#6a8a4a', T(x, h / 2, (i % 2) * 0.06, 0, 0, (i - 1) * 0.08)); b.add(cyl(0.04, 0.04, 0.22, 4), '#6a4228', T(x + (i - 1) * 0.08 * h * 0.45, h * 0.85, (i % 2) * 0.06)); }
        grad(b, new THREE.ConeGeometry(0.06, 0.8, 3, 1, true), '#4a7a3a', '#9ac060', T(0.12, 0.35, 0.1, 0.4, 0, -0.45), 0, 0.8);
        break;
      case 'reed':
        for (let i = 0; i < 5; i++) { const h = 0.9 + hh(i + 3) * 0.5; grad(b, cyl(0.012, 0.02, h, 3), '#4a6a3a', '#a8c870', T(i * 0.06 - 0.12, h / 2, (i % 2) * 0.06, 0, 0, (i - 2) * 0.09), 0, h); }
        break;
      case 'lily':
        b.add(cyl(0.3, 0.3, 0.02, 7), '#3f9a58', T(0, 0.01, 0));
        b.add(cyl(0.18, 0.18, 0.025, 6), '#58b86a', T(0.2, 0.012, 0.15));
        if (pal % 2) b.add(new THREE.ConeGeometry(0.1, 0.1, 5), '#ff9ac0', T(0.05, 0.05, 0));
        break;
      case 'mushroom': {
        const cap = ['#e84a4a', '#c88a4a', '#9a6ad8', '#4ad8c8'][pal % 4];
        b.add(cyl(0.06, 0.08, 0.28, 5), '#f4eedc', T(0, 0.13, 0));
        b.add(sph(0.2, 7, 3, 0, Math.PI * 2, 0, Math.PI / 2), cap, T(0, 0.26, 0, 0, 0, 0, [1, 0.8, 1]));
        b.add(sph(0.03, 4, 2), '#ffffff', T(0.07, 0.36, 0.05)); b.add(sph(0.03, 4, 2), '#ffffff', T(-0.08, 0.35, -0.02));
        b.add(cyl(0.035, 0.05, 0.15, 4), '#f4eedc', T(0.2, 0.07, 0.1));
        b.add(sph(0.1, 5, 2, 0, Math.PI * 2, 0, Math.PI / 2), cap, T(0.2, 0.14, 0.1, 0, 0, 0, [1, 0.8, 1]));
        break;
      }
      case 'moss': {
        grad(b, dod(0.5), '#3a6a3a', '#7ab050', T(0, 0.15, 0, 0, 0.4, 0, [1.4, 0.45, 1.2]), 0, 0.35);
        grad(b, dod(0.3), '#3a6a3a', '#8ac058', T(0.4, 0.1, 0.2, 0, 0, 0, [1.2, 0.5, 1]), 0, 0.3);
        break;
      }
      case 'stalag': {
        const c = pal % 2 ? ['#3a3048', '#7a6a90'] : ['#4a3c38', '#8a7a6e'];
        grad(b, cone(0.38, 1.7, 6), c[0], c[1], T(0, 0.85, 0), 0, 1.7);
        grad(b, cone(0.22, 1.0, 6), c[0], c[1], T(0.38, 0.5, 0.12), 0, 1.0);
        grad(b, cone(0.15, 0.6, 5), c[0], c[1], T(-0.3, 0.3, -0.2), 0, 0.6);
        break;
      }
      case 'hang': {
        const c = pal % 2 ? ['#7a6a90', '#3a3048'] : ['#8a7a6e', '#4a3c38'];
        grad(b, cone(0.34, 1.5, 6), c[0], c[1], T(0, -0.75, 0, 0, 0, Math.PI), -1.5, 0);
        grad(b, cone(0.2, 0.9, 6), c[0], c[1], T(0.35, -0.45, 0.1, 0, 0, Math.PI), -0.9, 0);
        grad(b, cone(0.14, 0.6, 5), c[0], c[1], T(-0.3, -0.3, -0.12, 0, 0, Math.PI), -0.6, 0);
        break;
      }
      case 'crystal': {
        const c = ['#7af0ff', '#ff7af0', '#9aff7a', '#ffd37a'][pal % 4];
        const o = (r: number) => new THREE.OctahedronGeometry(r, 0);
        b.add(o(0.28), c, T(0, 0.5, 0, 0, 0.3, 0, [0.6, 2.0, 0.6]));
        b.add(o(0.18), c, T(0.24, 0.28, 0.06, 0, 0.6, 0.5, [0.6, 1.7, 0.6]));
        b.add(o(0.16), c, T(-0.2, 0.22, -0.05, 0, 0.2, -0.5, [0.6, 1.7, 0.6]));
        b.add(o(0.12), c, T(0.05, 0.14, 0.24, 0.5, 0, 0.1, [0.6, 1.5, 0.6]));
        grad(b, dod(0.3), '#3a3448', '#6a6480', T(0, 0.05, 0, 0, 0, 0, [1.5, 0.4, 1.3]), 0, 0.2);
        break;
      }
      case 'ice': {
        const o = (r: number) => new THREE.OctahedronGeometry(r, 0);
        grad(b, o(0.35), '#7ab8e0', '#e8faff', T(0, 0.6, 0, 0, 0.3, 0, [0.7, 2.2, 0.7]), 0, 1.4);
        grad(b, o(0.22), '#7ab8e0', '#e8faff', T(0.3, 0.35, 0.1, 0, 0.6, 0.4, [0.7, 2.0, 0.7]), 0, 0.9);
        grad(b, o(0.2), '#7ab8e0', '#e8faff', T(-0.25, 0.3, -0.05, 0, 0.2, -0.4, [0.7, 2.0, 0.7]), 0, 0.8);
        break;
      }
      case 'drift': {
        grad(b, ico(0.8, 1), '#b8cce8', '#ffffff', T(0, 0.05, 0, 0, 0, 0, [1.8, 0.45, 1.2]), 0, 0.5);
        grad(b, ico(0.5, 0), '#b8cce8', '#ffffff', T(0.9, 0.0, 0.3, 0, 0, 0, [1.5, 0.45, 1]), 0, 0.3);
        break;
      }
      case 'pillar':
        grad(b, cyl(0.32, 0.36, 3.2, 8), '#6a6478', '#a8a2b8', T(0, 1.6, 0), 0, 3.2);
        b.add(box(0.95, 0.26, 0.95), '#7e788e', T(0, 3.25, 0));
        b.add(box(1.05, 0.28, 1.05), '#6e687e', T(0, 0.14, 0));
        b.add(box(0.5, 0.1, 0.5), '#8e889e', T(0, 3.43, 0));
        if (pal % 2) b.add(cyl(0.34, 0.34, 0.05, 8), '#5a5468', T(0, 1.2, 0));
        break;
      case 'torch':
        b.add(cyl(0.05, 0.06, 1.4, 6), '#6a4a30', T(0, 0.7, 0));
        b.add(cyl(0.12, 0.07, 0.18, 8), '#3a2c28', T(0, 1.45, 0));
        b.add(cone(0.12, 0.34, 7), '#ff8a1a', T(0, 1.7, 0));
        b.add(cone(0.07, 0.24, 6), '#fff0a0', T(0, 1.66, 0));
        break;
      case 'brazier':
        b.add(cyl(0.05, 0.05, 0.9, 5), '#3a3038', T(0, 0.45, 0));
        b.add(cyl(0.35, 0.18, 0.28, 8), '#4a3c42', T(0, 1.0, 0));
        b.add(cone(0.25, 0.55, 7), '#ff8a1a', T(0, 1.4, 0));
        b.add(cone(0.14, 0.4, 6), '#fff0a0', T(0, 1.36, 0));
        for (let i = 0; i < 3; i++) b.add(cyl(0.04, 0.04, 0.6, 4), '#3a3038', T(Math.cos(i * 2.1) * 0.18, 0.28, Math.sin(i * 2.1) * 0.18, Math.sin(i * 2.1) * 0.3, 0, -Math.cos(i * 2.1) * 0.3));
        break;
      case 'stone':
        grad(b, box(0.7, 2.0, 0.4), '#6a6a74', '#a8a8b0', T(0, 1.0, 0, 0, 0, 0.05), 0, 2.0);
        b.add(box(0.35, 0.3, 0.42), '#5a9a5a', T(0.1, 0.08, 0));
        break;
      case 'menhir': {
        const c = pal % 2 ? ['#5a5a66', '#a0a0aa'] : ['#6a6a74', '#b4b4bc'];
        grad(b, dod(0.7), c[0], c[1], T(0, 1.3, 0, 0, 0.5, 0.06, [0.62, 1.9, 0.5]), 0, 2.6);
        grad(b, dod(0.4), '#3f7a3a', '#78b050', T(0, 0.12, 0, 0, 0, 0, [1.6, 0.4, 1.4]), 0, 0.3);
        b.add(box(0.12, 0.5, 0.04), '#5ad0c8', T(0.0, 1.5, -0.3));
        break;
      }
      case 'dolmen': {
        b.add(box(0.55, 1.7, 0.5), '#7a7a84', T(-0.9, 0.85, 0, 0, 0.1, 0.04));
        b.add(box(0.55, 1.7, 0.5), '#7a7a84', T(0.9, 0.85, 0, 0, -0.1, -0.03));
        grad(b, box(2.8, 0.5, 1.0), '#7a7a84', '#b0b0b8', T(0, 1.85, 0, 0, 0.05, 0.03), 1.6, 2.1);
        b.add(box(0.4, 0.3, 0.4), '#5a9a5a', T(0.1, 2.15, 0));
        break;
      }
      case 'tomb':
        grad(b, box(0.7, 0.95, 0.16), '#6a6a74', '#a8a8b0', T(0, 0.47, 0, 0, 0, 0.08 * (pal % 2 ? 1 : -1)), 0, 0.95);
        b.add(cyl(0.35, 0.35, 0.16, 8, ), '#a8a8b0', T(0, 0.95, 0, Math.PI / 2, 0, 0.08 * (pal % 2 ? 1 : -1)));
        b.add(box(0.08, 0.5, 0.03), '#4a4a54', T(0, 0.55, -0.09)); b.add(box(0.3, 0.08, 0.03), '#4a4a54', T(0, 0.65, -0.09));
        b.add(box(0.7, 0.15, 0.9), '#5a8a4a', T(0, 0.05, 0.4));
        break;
      case 'ruin': {
        const c = pal % 2 ? ['#6a6070', '#a8a0b0'] : ['#7a7060', '#b8b098'];
        grad(b, box(0.9, 3.0, 0.9), c[0], c[1], T(-1.5, 1.5, 0), 0, 3.0);
        grad(b, box(0.9, 2.0, 0.9), c[0], c[1], T(1.5, 1.0, 0, 0, 0, 0.04), 0, 2.0);
        grad(b, box(3.9, 0.8, 0.9), c[0], c[1], T(-0.2, 2.9, 0, 0, 0, 0.1), 2.5, 3.3);
        b.add(box(0.7, 0.5, 0.7), '#5a5260', T(0.8, 0.25, 1.0, 0, 0.5, 0)); b.add(box(0.5, 0.4, 0.5), '#6a6070', T(-0.4, 0.2, 1.3, 0, 0.2, 0.2));
        b.add(box(1.0, 0.1, 1.0), '#4f8a4a', T(-1.5, 3.02, 0));
        break;
      }
      case 'bones': {
        b.add(sph(0.2, 6, 5), '#f0e8d8', T(0, 0.18, 0, 0, 0, 0, [1, 0.9, 1.1]));
        b.add(box(0.2, 0.12, 0.14), '#f0e8d8', T(0, 0.08, -0.17));
        b.add(sph(0.05, 4, 3), '#2a2230', T(-0.08, 0.2, -0.17)); b.add(sph(0.05, 4, 3), '#2a2230', T(0.08, 0.2, -0.17));
        for (let i = 0; i < 4; i++) b.add(cyl(0.03, 0.03, 0.7, 4), '#e8e0d0', T(0.5 + i * 0.12, 0.05, 0.3 - i * 0.25, Math.PI / 2, i * 1.4, 0.1));
        break;
      }
      case 'barrel':
        grad(b, cyl(0.34, 0.3, 0.8, 9), '#7a5030', '#a87848', T(0, 0.4, 0), 0, 0.8);
        for (const y of [0.2, 0.6]) b.add(cyl(0.355, 0.355, 0.05, 9), '#3a3038', T(0, y, 0));
        break;
      case 'crate':
        grad(b, box(0.8, 0.8, 0.8), '#7a5a38', '#b08850', T(0, 0.4, 0, 0, 0.3, 0), 0, 0.8);
        b.add(box(0.84, 0.08, 0.84), '#5a4028', T(0, 0.04, 0, 0, 0.3, 0)); b.add(box(0.84, 0.08, 0.84), '#5a4028', T(0, 0.76, 0, 0, 0.3, 0));
        break;
      case 'stump':
        grad(b, cyl(0.32, 0.4, 0.5, 8), '#4a3022', '#7a5436', T(0, 0.25, 0), 0, 0.5);
        b.add(cyl(0.3, 0.3, 0.03, 8), '#d8b078', T(0, 0.51, 0));
        b.add(cyl(0.18, 0.18, 0.035, 8), '#b88c58', T(0, 0.515, 0));
        b.add(sph(0.08, 4, 3), '#e84a4a', T(0.34, 0.12, 0.2));
        break;
      case 'fallen':
        grad(b, cyl(0.2, 0.24, 2.6, 8), '#4a3022', '#7a5436', T(0, 0.22, 0, 0, 0, Math.PI / 2), 0, 0.5);
        b.add(cyl(0.2, 0.2, 0.03, 8), '#d8b078', T(1.3, 0.22, 0, 0, 0, Math.PI / 2));
        b.add(cyl(0.05, 0.08, 0.6, 5), '#5a3e28', T(0.4, 0.5, 0.1, 0, 0, -0.7));
        grad(b, dod(0.25), '#3a6a3a', '#78b050', T(-0.4, 0.38, 0, 0, 0, 0, [2, 0.4, 0.9]), 0.3, 0.5);
        break;
      case 'mound': {
        const m = new THREE.SphereGeometry(1, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2);
        grad(b, m, '#4f8a3a', '#9ad870', T(0, -0.2, 0, 0, 0, 0, [4.2, 2.2, 3.8]), -0.2, 2.0);
        b.add(box(1.0, 1.4, 0.35), '#6a6878', T(-0.8, 0.5, -3.55)); b.add(box(1.0, 1.4, 0.35), '#6a6878', T(0.8, 0.5, -3.55));
        b.add(box(2.8, 0.5, 0.45), '#7a7888', T(0, 1.4, -3.55));
        b.add(box(1.4, 1.3, 0.2), '#14101c', T(0, 0.55, -3.5));
        break;
      }
      case 'cliff': {
        const c = [['#6a5a50', '#b0a090'], ['#5a5058', '#a09aa8'], ['#7a7488', '#c0bace'], ['#a0804e', '#e0c088']][pal % 4];
        grad(b, dod(2.0), c[0], c[1], T(0, 1.6, 0, 0.2, 0.4, 0.1, [1.3, 1.5, 1]), -1, 4.5);
        grad(b, dod(1.4), c[0], c[1], T(1.6, 0.9, 0.5, 0.5, 0.1, 0.3, [1, 1.3, 1]), -1, 3.0);
        grad(b, dod(1.2), '#4f9a3a', '#88d058', T(0.3, 3.4, 0, 0.1, 0.3, 0, [1.5, 0.35, 1.2]), 3.0, 3.8);
        break;
      }
      case 'spire': {
        const c = pal % 2 ? ['#9a5a3c', '#d89860'] : ['#7a5a4c', '#b89a78'];
        grad(b, cone(1.1, 4.5, 6), c[0], c[1], T(0, 2.2, 0, 0, 0.3, 0.04), 0, 4.4);
        grad(b, cone(0.7, 3.0, 5), c[0], c[1], T(1.1, 1.4, 0.3, 0, 0.5, -0.06), 0, 2.9);
        b.add(box(2.6, 0.18, 2.6), '#c8a070', T(0, 1.2, 0, 0, 0.2, 0)); b.add(box(1.8, 0.15, 1.8), '#b08858', T(0, 2.4, 0, 0, 0.1, 0));
        break;
      }
      case 'sandrock': {
        // stratified sandstone: stacked, slightly skewed slabs in banded reds / ochres (pal 0 red, 1 ochre, 2 grey-violet)
        const P = [['#7a3a2c', '#c8643c', '#e0a068'], ['#7a4e30', '#b8803e', '#d8aa68'], ['#5a4658', '#8a6a78', '#c0a0a0']][pal % 3];
        grad(b, box(1.5, 0.42, 1.2), P[0], P[1], T(0, 0.2, 0, 0, 0.3, 0.02), 0, 0.42);
        grad(b, box(1.25, 0.34, 1.0), P[1], P[2], T(0.05, 0.57, 0.02, 0, 0.45, -0.03), 0.4, 0.74);
        grad(b, box(0.95, 0.3, 0.8), P[0], P[2], T(0.1, 0.87, 0, 0, 0.7, 0.03), 0.72, 1.02);
        b.add(box(1.0, 0.07, 0.8), P[2], T(0.1, 1.04, 0, 0, 0.7, 0.03));
        grad(b, dod(0.3), P[0], P[1], T(0.95, 0.15, 0.4, 0.4, 0.3, 0, [1.2, 0.6, 1]), 0, 0.35);
        grad(b, dod(0.22), P[0], P[1], T(-0.9, 0.1, 0.5, 0.2, 0.9, 0, [1.3, 0.6, 1]), 0, 0.25);
        break;
      }
      case 'scree': {
        const c = [['#7a3a2c', '#d07848'], ['#6a5a50', '#b8a490'], ['#5a4a50', '#a08890']][pal % 3];
        for (let i = 0; i < 7; i++) {
          const a = i * 2.4, r = 0.12 + hh(i) * 0.7, sc = 0.07 + hh(i + 9) * 0.13;
          grad(b, ico(1, 0), c[0], c[1], T(Math.cos(a) * r, sc * 0.35, Math.sin(a) * r, hh(i + 3) * 3, hh(i + 5) * 3, 0, [sc * 1.5, sc * 0.7, sc * 1.1]), 0, sc * 1.1);
        }
        break;
      }
      case 'shrub': {
        const c = pal % 2 ? ['#4a4a2a', '#9a9a56'] : ['#5a4a2a', '#a8884a'];
        for (let i = 0; i < 7; i++) { const a = i / 7 * Math.PI * 2 + hh(i) * 0.5, lean = 0.5 + hh(i + 4) * 0.4; grad(b, new THREE.ConeGeometry(0.06, 0.62 + hh(i + 2) * 0.25, 3, 1, true), c[0], c[1], T(Math.cos(a) * 0.07, 0.28, Math.sin(a) * 0.07, Math.sin(a) * lean, 0, -Math.cos(a) * lean), 0, 0.7); }
        grad(b, ico(0.2, 0), c[0], c[1], T(0, 0.28, 0, 0, 0, 0, [1.4, 0.8, 1.2]), 0.1, 0.45);
        break;
      }
      case 'ribs': {
        // bleached ribcage half-buried in the sand: spine, arched ribs, skull
        const iv = ['#c8bca4', '#f6eedc'];
        b.add(box(0.07, 0.07, 1.7), '#d8ccb4', T(0, 0.63, 0, 0, 0.0, 0));
        for (let i = 0; i < 5; i++) {
          const z = -0.55 + i * 0.3, sc = 1 - Math.abs(i - 2) * 0.1;
          for (const sd of [-1, 1]) grad(b, tor(0.34 * sc, 0.032, Math.PI * 0.7, 3, 7), iv[0], iv[1], T(0, 0.3 + 0.0, z, 0, 0.1, sd > 0 ? -0.2 * Math.PI : 0.5 * Math.PI), 0.0, 0.64);
        }
        grad(b, sph(0.2, 6, 5), iv[0], iv[1], T(0.1, 0.2, -1.05, 0, 0, 0, [1, 0.8, 1.2]), 0.05, 0.4);
        b.add(sph(0.05, 4, 3), '#2a2230', T(0.02, 0.25, -1.24)); b.add(sph(0.05, 4, 3), '#2a2230', T(0.2, 0.25, -1.24));
        for (let i = 0; i < 2; i++) b.add(cyl(0.035, 0.035, 0.8, 4), '#e8e0d0', T(0.7 + i * 0.12, 0.05, 0.5 - i * 0.3, Math.PI / 2, i * 1.4 + 0.5, 0.1));
        break;
      }
      case 'slab': {
        // leaning canyon slabs (gorge floor): flat shards propped against each other
        const P = [['#6a3438', '#b86a58'], ['#7a4a3a', '#d08a68']][pal % 2];
        grad(b, box(1.2, 1.3, 0.26), P[0], P[1], T(0, 0.55, 0, 0.0, 0.3, 0.38), 0, 1.2);
        grad(b, box(0.9, 0.9, 0.22), P[0], P[1], T(0.75, 0.38, 0.35, 0.1, 0.8, -0.5), 0, 0.8);
        grad(b, box(0.8, 0.5, 0.5), P[0], P[1], T(-0.5, 0.22, 0.5, 0, 0.2, 0.1), 0, 0.5);
        break;
      }
      case 'arch': {
        // wind-carved sandstone arch (~5.5 m): two tapered legs, a thick stratified span, ledges
        const P = pal % 2 ? ['#7a4a34', '#d89460', '#f0c890'] : ['#7a3a2c', '#cc6a40', '#eaa874'];
        grad(b, cyl(0.95, 1.5, 3.4, 7), P[0], P[1], T(-2.1, 1.7, 0, 0, 0.2, 0.05, [1, 1, 0.9]), 0, 3.4);
        grad(b, cyl(0.8, 1.35, 3.1, 7), P[0], P[1], T(2.1, 1.55, 0, 0, 0.8, -0.05, [1, 1, 0.9]), 0, 3.1);
        const span = new THREE.TorusGeometry(2.1, 0.8, 5, 12, Math.PI);
        grad(b, span, P[1], P[2], T(0, 3.1, 0, 0, 0, 0, [1, 0.85, 1.1]), 3.0, 5.0);
        for (let i = 0; i < 3; i++) b.add(box(2.4 - i * 0.45, 0.07, 1.9 - i * 0.25), P[0], T(-2.1 + (i % 2) * 0.05, 0.55 + i * 0.85, 0, 0, i * 0.4, 0));
        grad(b, dod(0.6), P[0], P[1], T(-3.2, 0.3, 0.8, 0.4, 0.2, 0, [1.3, 0.6, 1]), 0, 0.7);
        grad(b, dod(0.5), P[0], P[1], T(3.1, 0.25, 0.6, 0.2, 0.8, 0, [1.3, 0.6, 1]), 0, 0.6);
        break;
      }
      case 'cactus': {
        grad(b, cyl(0.2, 0.24, 1.7, 8), '#3a7a3a', '#78c060', T(0, 0.85, 0), 0, 1.7);
        b.add(sph(0.2, 8, 5, 0, Math.PI * 2, 0, Math.PI / 2), '#78c060', T(0, 1.7, 0));
        grad(b, cyl(0.1, 0.1, 0.55, 6), '#3a7a3a', '#78c060', T(0.32, 0.88, 0, 0, 0, -1.3), 0.6, 1.2);
        grad(b, cyl(0.09, 0.09, 0.5, 6), '#3a7a3a', '#78c060', T(0.54, 1.2, 0), 0.95, 1.5);
        b.add(sph(0.09, 5, 4, 0, Math.PI * 2, 0, Math.PI / 2), '#78c060', T(0.54, 1.45, 0));
        grad(b, cyl(0.09, 0.09, 0.45, 6), '#3a7a3a', '#78c060', T(-0.3, 0.7, 0, 0, 0, 1.3), 0.5, 1.0);
        grad(b, cyl(0.08, 0.08, 0.4, 6), '#3a7a3a', '#78c060', T(-0.5, 0.98, 0), 0.8, 1.2);
        b.add(sph(0.1, 5, 3), '#ff8ab0', T(0, 1.85, 0));
        break;
      }
      case 'agave': {
        for (let i = 0; i < 9; i++) { const a = i / 9 * Math.PI * 2, lean = 0.55 + hh(i) * 0.3; grad(b, new THREE.ConeGeometry(0.12, 0.9, 4, 1, true), '#3a7a5a', '#9ad0a0', T(Math.cos(a) * 0.2, 0.38, Math.sin(a) * 0.2, Math.sin(a) * lean, 0, -Math.cos(a) * lean), 0, 0.8); }
        break;
      }
      case 'tumble':
        b.add(new THREE.IcosahedronGeometry(0.35, 0), '#a88858', T(0, 0.3, 0)); b.add(new THREE.IcosahedronGeometry(0.28, 0), '#8a6a44', T(0.1, 0.32, 0.05, 0.5, 0.4, 0, 1));
        break;
      case 'support':
        b.add(box(0.24, 3.0, 0.24), '#8a6a42', T(-1.6, 1.5, 0));
        b.add(box(0.24, 3.0, 0.24), '#8a6a42', T(1.6, 1.5, 0));
        b.add(box(3.8, 0.28, 0.32), '#7a5a36', T(0, 3.05, 0));
        b.add(box(0.12, 0.12, 0.9), '#6a4a2c', T(-1.6, 3.22, 0)); b.add(box(0.12, 0.12, 0.9), '#6a4a2c', T(1.6, 3.22, 0));
        b.add(box(0.1, 0.9, 0.1), '#6a4a2c', T(-1.1, 2.55, 0, 0, 0, 0.7)); b.add(box(0.1, 0.9, 0.1), '#6a4a2c', T(1.1, 2.55, 0, 0, 0, -0.7));
        b.add(cyl(0.005, 0.005, 0.3, 3), '#2a2020', T(0, 2.8, -0.15)); b.add(sph(0.15, 8, 6), '#ffd37a', T(0, 2.62, -0.15));
        break;
      case 'fence':
        for (let i = 0; i < 3; i++) grad(b, box(0.1, 0.85, 0.1), '#6a4a2c', '#9a7a52', T(-0.8 + i * 0.8, 0.42, 0), 0, 0.85);
        b.add(box(1.8, 0.08, 0.06), '#9a7a52', T(0, 0.65, 0.01));
        b.add(box(1.8, 0.08, 0.06), '#9a7a52', T(0, 0.32, 0.01));
        break;
    }
    return b.build();
  });
}

/* ------------------------------------------------------------------ set pieces (built per set, few instances) */

export function campfireGeo(): THREE.BufferGeometry {
  return cached('campfire', () => {
    const b = new GB();
    for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; b.add(dod(0.16), '#8a8498', T(Math.cos(a) * 0.55, 0.08, Math.sin(a) * 0.55, a, a, 0, [1, 0.7, 1])); }
    for (let i = 0; i < 4; i++) { const a = (i / 4) * Math.PI * 2 + 0.4; b.add(cyl(0.07, 0.07, 0.8, 6), '#6a4a30', T(Math.cos(a) * 0.1, 0.15, Math.sin(a) * 0.1, 0, -a, Math.PI / 2 - 0.35)); }
    return b.build();
  });
}
export function flameGeo(): THREE.BufferGeometry {
  return cached('flame', () => {
    const b = new GB();
    b.add(cone(0.32, 0.8, 8), '#ff8a2a', T(0, 0.45, 0));
    b.add(cone(0.2, 0.6, 7), '#ffd34d', T(0.05, 0.38, 0.02));
    b.add(cone(0.1, 0.35, 6), '#fff6c8', T(0, 0.28, 0));
    return b.build();
  });
}
export function signpostGeo(): THREE.BufferGeometry {
  return cached('signpost', () => {
    const b = new GB();
    b.add(cyl(0.07, 0.09, 2.6, 7), '#7a5436', T(0, 1.3, 0));
    b.add(box(1.5, 0.5, 0.08), '#c89a5a', T(0.55, 2.1, 0));
    b.add(cone(0.3, 0.3, 3), '#c89a5a', T(1.42, 2.1, 0, 0, 0, -Math.PI / 2, [1.4, 1, 0.27]));
    b.add(box(1.56, 0.06, 0.1), '#8a5a2a', T(0.55, 2.36, 0));
    b.add(box(1.56, 0.06, 0.1), '#8a5a2a', T(0.55, 1.84, 0));
    b.add(dod(0.25), '#8a8498', T(0, 0.08, 0, 0, 0, 0, [1.2, 0.5, 1.2]));
    return b.build();
  });
}
export function flagGeo(): THREE.BufferGeometry {
  return cached('flag', () => {
    const b = new GB();
    b.add(box(0.6, 0.38, 0.03), '#ffffff', T(0.32, 0, 0), 1);
    return b.build();
  });
}
export function gateGeo(): THREE.BufferGeometry {
  return cached('gate', () => {
    const b = new GB();
    const st = '#c8bca8', dk = '#a89c8a', roof = '#c84a4a';
    for (const s of [-1, 1]) {
      b.add(cyl(1.5, 1.6, 6.5, 12), st, T(0, 3.25, s * 3.6));
      b.add(cone(1.9, 2.2, 12), roof, T(0, 7.6, s * 3.6));
      for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; b.add(box(0.45, 0.5, 0.45), dk, T(Math.cos(a) * 1.45, 6.6, s * 3.6 + Math.sin(a) * 1.45)); }
      b.add(box(1.4, 5.0, 9), st, T(0.3, 2.5, s * 9.6));
      b.add(box(0.12, 0.7, 0.5), '#3a2f4a', T(-1.55, 4.4, s * 3.6));
    }
    b.add(box(1.6, 2.0, 5.6), st, T(0, 5.4, 0));
    b.add(box(1.7, 0.4, 5.8), dk, T(0, 6.5, 0));
    for (let i = 0; i < 6; i++) b.add(box(0.5, 0.5, 0.5), dk, T(0, 6.95, -2.5 + i));
    // arch + doors (open)
    b.add(tor(1.8, 0.25, Math.PI, 5, 12), dk, T(-0.85, 2.8, 0, 0, Math.PI / 2, 0));
    for (const s of [-1, 1]) b.add(box(0.3, 4.4, 0.5), '#8a8070', T(-0.5, 2.2, s * 1.9));
    b.add(box(0.2, 0.25, 3.4), '#c84a4a', T(-0.95, 4.9, 0));
    b.add(box(1.2, 0.1, 3.2), '#8a8070', T(-0.4, 0.05, 0));
    return b.build();
  });
}
export function bannerGeo(): THREE.BufferGeometry {
  return cached('banner', () => {
    const b = new GB();
    b.add(cyl(0.06, 0.08, 3.4, 7), '#7a5436', T(0, 1.7, 0));
    b.add(sph(0.12, 8, 6), '#ffc94d', T(0, 3.45, 0));
    b.add(cyl(0.03, 0.03, 1.7, 5), '#7a5436', T(0, 3.2, 0, 0, 0, Math.PI / 2));
    return b.build();
  });
}
export function tentGeo(pal = 0): THREE.BufferGeometry {
  return cached('tent:' + pal, () => {
    const b = new GB();
    const c = ['#e8c87a', '#c86a5a', '#7a9ac8'][pal % 3];
    b.add(cone(1.4, 1.7, 4), c, T(0, 0.85, 0, 0, Math.PI / 4, 0));
    b.add(cone(0.5, 1.0, 3), '#3a2f4a', T(0, 0.5, -0.9, 0, Math.PI, 0, [1, 1, 0.3]));
    b.add(cyl(0.03, 0.03, 0.5, 4), '#7a5436', T(0, 1.9, 0));
    b.add(box(0.3, 0.18, 0.02), '#ff5a6a', T(0.16, 2.05, 0));
    return b.build();
  });
}
export function chestGeo(): THREE.BufferGeometry {
  return cached('chest', () => {
    const b = new GB();
    b.add(box(1.0, 0.55, 0.65), '#9a6a3a', T(0, 0.28, 0));
    for (const x of [-0.42, 0, 0.42]) b.add(box(0.08, 0.57, 0.67), '#e8c04a', T(x, 0.28, 0));
    b.add(box(0.16, 0.2, 0.06), '#ffd34d', T(0, 0.42, -0.35));
    return b.build();
  });
}
export function lidGeo(): THREE.BufferGeometry {
  return cached('lid', () => {
    const b = new GB();
    // pivot = the hinge on the BACK top edge (chest +z); the lid reaches forward to the lock side (−z)
    b.add(new THREE.CylinderGeometry(0.33, 0.33, 1.0, 10, 1, false, 0, Math.PI), '#a8743e', T(0, 0, -0.33, 0, 0, Math.PI / 2));
    for (const x of [-0.42, 0, 0.42]) b.add(new THREE.CylinderGeometry(0.345, 0.345, 0.08, 10, 1, false, 0, Math.PI), '#e8c04a', T(x, 0, -0.33, 0, 0, Math.PI / 2));
    return b.build();
  });
}
export function runeDoorGeo(): THREE.BufferGeometry {
  return cached('runedoor', () => {
    const b = new GB();
    const st = '#8a8498', dk = '#6e687e';
    b.add(box(1.0, 4.4, 1.2), st, T(0, 2.2, -1.9));
    b.add(box(1.0, 4.4, 1.2), st, T(0, 2.2, 1.9));
    b.add(box(1.2, 1.0, 5.0), dk, T(0, 4.7, 0));
    b.add(cone(0.5, 0.6, 4), '#7af0ff', T(-0.6, 4.7, 0, 0, 0, Math.PI / 2, [1, 1, 0.4]));
    for (let i = 0; i < 6; i++) b.add(dod(0.6), '#7a7488', T(0.4, 0.3, -4 + i * 1.6 + (i > 2 ? 0 : 0), i, i, 0, [1, 0.6, 1]));
    return b.build();
  });
}
export function doorSlabGeo(): THREE.BufferGeometry {
  return cached('doorslab', () => {
    const b = new GB();
    b.add(box(0.3, 4.1, 2.45), '#5e5870', T(0, 2.05, 0));
    b.add(tor(0.6, 0.06, Math.PI * 2, 4, 16), '#7af0ff', T(-0.16, 2.3, 0, 0, Math.PI / 2, 0));
    return b.build();
  });
}
export function platformGeo(): THREE.BufferGeometry {
  return cached('platform', () => {
    const b = new GB();
    const rnd = (i: number, k: number) => { const v = Math.sin(i * 127.1 + k * 311.7) * 43758.5453; return v - Math.floor(v); };
    // packed-earth berm blending the slab into the ground (stone grey at the rim → dirt at the foot)
    b.addG(new THREE.CylinderGeometry(0.97, 1.32, 0.12, 12, 1, true), '#6e6678', '#5a4a3a', T(0, 0.0, 0, 0, Math.PI / 12, 0), 0.06, -0.06);
    // plinth + core, darker and chipped toward the foot
    b.addG(cyl(0.94, 0.78, 0.55, 6), '#7c7690', '#403a54', T(0, -0.245, 0), 0.03, -0.5);
    // masonry: one block per side, each its own height / tone (no coplanar tops), dark caps read as mortar lines
    const tones = ['#9a94ac', '#8c869e', '#a8a2b8', '#908aa2', '#a0a0b6', '#8a849c'];
    for (let k = 0; k < 6; k++) {
      const ph = Math.PI / 6 + k * Math.PI / 3, rho = 0.76, h = 0.3 + 0.026 * k;
      b.add(box(0.98, h, 0.3), tones[k], T(Math.sin(ph) * rho, 0.075 - h / 2 + 0.004 * k, Math.cos(ph) * rho, 0, ph, 0));
      b.add(box(0.46, 0.012, 0.31), '#5a546c', T(Math.sin(ph) * rho + Math.cos(ph) * 0.0, 0.0825 + 0.004 * k, Math.cos(ph) * rho, 0, ph, 0));
      // block seams on the outer face
      for (const sd of [-1, 1]) b.add(box(0.012, h * 0.9, 0.012), '#3e3850', T(Math.sin(ph) * (rho + 0.152) + Math.cos(ph) * sd * 0.24, 0.075 - h / 2 + 0.004 * k, Math.cos(ph) * (rho + 0.152) - Math.sin(ph) * sd * 0.24, 0, ph, 0));
      // pylon at the vertex: dark stone post with a glowing crystal cap — it is what makes the hexagon read from afar
      const pv = k * Math.PI / 3;
      b.addG(box(0.24, 0.62 + 0.02 * k, 0.24), '#5e5874', '#8a849e', T(Math.sin(pv) * 0.96, 0.0, Math.cos(pv) * 0.96, 0, pv + 0.25, 0), -0.3, 0.3);
      b.addGlow(ico(0.11, 0), k % 2 ? '#c8a0ff' : '#8affea', T(Math.sin(pv) * 0.96, 0.45 + 0.02 * k, Math.cos(pv) * 0.96, 0.3, pv, 0, [1, 1.9, 1]), 2.6);
    }
    // the floor: lighter slab, a darker inner dais
    b.add(cyl(0.8, 0.82, 0.06, 6), '#aaa4bc', T(0, 0.02, 0));
    b.add(cyl(0.54, 0.56, 0.02, 6), '#76708a', T(0, 0.062, 0, 0, Math.PI / 6, 0));
    // glowing rune circle + a glyph on every side + a lamp line along the inside of each block
    b.addGlow(tor(0.44, 0.028, Math.PI * 2, 3, 24), '#7af0ff', T(0, 0.08, 0, Math.PI / 2, 0, 0), 2.4);
    for (let k = 0; k < 6; k++) {
      const ph = Math.PI / 6 + k * Math.PI / 3, c = Math.sin(ph), d = Math.cos(ph);
      const at = (rr: number, tt: number) => [c * rr + d * tt, d * rr - c * tt] as const;
      const col = k % 2 ? '#c8a0ff' : '#8affea';
      const glyph = (rr: number, tt: number, w: number, l: number, rot: number) => { const [x, z] = at(rr, tt); b.addGlow(box(w, 0.016, l), col, T(x, 0.06, z, 0, ph + rot, 0), 2.4); };
      b.addGlow(box(0.82, 0.014, 0.05), '#6ab0ff', T(c * 0.58, 0.058, d * 0.58, 0, ph, 0), 2.2);
      // a rune ᛉ: stem + two arms + a dot
      glyph(0.66, 0, 0.07, 0.34, Math.PI / 2);
      glyph(0.68, 0.1, 0.06, 0.24, Math.PI / 2 + 0.6);
      glyph(0.68, -0.1, 0.06, 0.24, Math.PI / 2 - 0.6);
      glyph(0.68, 0.28, 0.07, 0.07, 0); glyph(0.68, -0.28, 0.07, 0.07, 0);
    }
    // cracks: dark zig-zag fissures from the rim
    for (let k = 0; k < 3; k++) {
      let x = Math.sin(k * 2.2 + 0.4) * 0.74, z = Math.cos(k * 2.2 + 0.4) * 0.74, a = k * 2.2 + 0.4 + Math.PI;
      for (let i = 0; i < 4; i++) {
        a += (rnd(k, i) - 0.5) * 1.5; const l = 0.13 + 0.07 * rnd(i, k);
        b.add(box(0.05, 0.008, l), '#1e1a2c', T(x + Math.sin(a) * l / 2, 0.056, z + Math.cos(a) * l / 2, 0, a, 0));
        x += Math.sin(a) * l; z += Math.cos(a) * l;
      }
    }
    // rubble round the foot (earthier than the slab, so it reads as debris and not as part of it)
    for (let i = 0; i < 7; i++) {
      const a = i * 0.9 + rnd(i, 3) * 0.5, r = 1.06 + rnd(i, 5) * 0.26, sc = 0.06 + rnd(i, 7) * 0.07;
      b.addG(dod(1), i % 3 ? '#6a6274' : '#4a4252', i % 2 ? '#8a8294' : '#7a6e68', T(Math.sin(a) * r, 0.02 + sc * 0.3, Math.cos(a) * r, rnd(i, 1) * 3, rnd(i, 2) * 3, 0, [sc * 1.3, sc * 0.8, sc]), 0, sc * 1.1);
    }
    return b.build();
  });
}
export function arrowGeo(): THREE.BufferGeometry {
  return cached('arrow', () => {
    const b = new GB();
    b.add(cyl(0.012, 0.012, 0.6, 4), '#8a5a2a', T(0, 0, 0, Math.PI / 2, 0, 0));
    b.add(cone(0.035, 0.1, 4), '#dfe4ee', T(0, 0, -0.33, -Math.PI / 2, 0, 0));
    b.add(box(0.06, 0.005, 0.12), '#ffffff', T(0, 0, 0.27));
    return b.build();
  });
}
export function markerGeo(): THREE.BufferGeometry {
  return cached('marker', () => {
    const b = new GB();
    b.add(cone(0.16, 0.3, 4), '#ffd34d', T(0, 0, 0, Math.PI, 0, 0));
    return b.build();
  });
}
export function stallGeo(): THREE.BufferGeometry {
  return cached('stall', () => {
    const b = new GB();
    for (const x of [-2.2, 2.2]) for (const z of [-0.2, 1.4]) b.add(cyl(0.07, 0.07, 3.0, 6), '#7a5436', T(x, 1.5, z));
    for (let i = 0; i < 8; i++) b.add(box(0.6, 0.08, 2.2), i % 2 ? '#ffffff' : '#d84a5a', T(-2.1 + i * 0.6, 3.05 + (i % 2) * 0.01, 0.6, 0.25, 0, 0));
    for (let r = 0; r < 3; r++) b.add(box(4.2, 0.08, 0.5), '#a8743e', T(0, 0.65 + r * 0.75, 0.6 - r * 0.0));
    b.add(box(4.4, 2.2, 0.08), '#7a5436', T(0, 1.6, 1.0));
    return b.build();
  });
}
export function wellGeo(): THREE.BufferGeometry {
  return cached('well', () => {
    const b = new GB();
    b.add(cyl(0.9, 0.95, 0.8, 14), '#9a94a8', T(0, 0.4, 0));
    b.add(cyl(0.72, 0.72, 0.05, 14), '#3a5aa8', T(0, 0.72, 0));
    for (const s of [-1, 1]) b.add(box(0.12, 2.0, 0.12), '#7a5436', T(s * 0.85, 1.2, 0));
    b.add(cone(1.3, 0.8, 4), '#c84a4a', T(0, 2.45, 0, 0, Math.PI / 4, 0, [1, 1, 0.8]));
    b.add(cyl(0.08, 0.08, 1.6, 6), '#8a6a42', T(0, 1.75, 0, 0, 0, Math.PI / 2));
    b.add(cyl(0.12, 0.1, 0.18, 8), '#8a6a42', T(0, 1.25, 0));
    return b.build();
  });
}
export function altarGeo(): THREE.BufferGeometry {
  return cached('altar', () => {
    const b = new GB();
    b.add(box(1.8, 0.9, 0.9), '#e8e2d0', T(0, 0.45, 0));
    b.add(box(2.0, 0.12, 1.0), '#c8a04a', T(0, 0.95, 0));
    b.add(cyl(0.3, 0.18, 0.2, 12), '#ffc94d', T(0, 1.1, 0));
    for (const s of [-1, 1]) { b.add(cyl(0.06, 0.06, 0.4, 6), '#fff8e8', T(s * 0.7, 1.2, 0)); b.add(cone(0.05, 0.12, 6), '#ffb02a', T(s * 0.7, 1.46, 0)); }
    return b.build();
  });
}
export function tableGeo(): THREE.BufferGeometry {
  return cached('table', () => {
    const b = new GB();
    b.add(cyl(0.9, 0.9, 0.1, 14), '#9a6a3a', T(0, 0.8, 0));
    b.add(cyl(0.12, 0.2, 0.8, 8), '#7a5436', T(0, 0.4, 0));
    b.add(cyl(0.8, 0.8, 0.02, 14), '#3a7a4a', T(0, 0.86, 0));
    return b.build();
  });
}
/** Map puzzle (site 28.10, kind `puzzle`): a standing stone tablet with a round top and carved lines (glowing rune
 *  inlays), on a two-step plinth. */
export function puzzleTabletGeo(): THREE.BufferGeometry {
  return cached('pz-tablet', () => {
    const b = new GB();
    b.add(box(2.4, 0.25, 1.2), '#6e687e', T(0, 0.125, 0));
    b.add(box(2.0, 0.22, 0.95), '#7e7890', T(0, 0.36, 0));
    b.add(box(1.6, 2.1, 0.32), '#8a849c', T(0, 1.52, 0));
    b.add(new THREE.CylinderGeometry(0.8, 0.8, 0.32, 18, 1, false, 0, Math.PI), '#8a849c', T(0, 2.57, 0, Math.PI / 2, 0, -Math.PI / 2));
    for (let i = 0; i < 4; i++) b.add(box(1.1 - (i === 3 ? 0.35 : 0), 0.06, 0.02), '#7af0ff', T(0, 1.2 + i * 0.32, 0.17));
    b.add(cyl(0.12, 0.12, 0.03, 10), '#ffc94d', T(0, 2.62, 0.17, Math.PI / 2, 0, 0));
    return b.build();
  });
}
/** A rune stone (one of the equation's glyph stones): a rough slab with a glowing glyph. */
export function runeStoneGeo(): THREE.BufferGeometry {
  return cached('pz-rune', () => {
    const b = new GB();
    b.add(dod(0.42), '#6e687e', T(0, 0.38, 0, 0, 0, 0, [0.9, 1.1, 0.55]));
    b.add(box(0.05, 0.36, 0.02), '#9ff4ff', T(-0.04, 0.42, 0.23));
    b.add(box(0.2, 0.05, 0.02), '#9ff4ff', T(0.03, 0.5, 0.23, 0, 0, -0.6));
    return b.build();
  });
}
/** Cup (the poisoned-cups puzzle). */
export function cupGeo(): THREE.BufferGeometry {
  return cached('pz-cup', () => {
    const b = new GB();
    b.add(cyl(0.22, 0.08, 0.32, 12), '#ffc94d', T(0, 0.66, 0));
    b.add(cyl(0.04, 0.04, 0.3, 6), '#c8901a', T(0, 0.36, 0));
    b.add(cyl(0.18, 0.2, 0.05, 12), '#c8901a', T(0, 0.22, 0));
    return b.build();
  });
}
/** Scales (balance puzzle): post, beam and two plates — the beam tilts as a whole in the set. */
export function scalesPostGeo(): THREE.BufferGeometry {
  return cached('pz-scales', () => {
    const b = new GB();
    b.add(cyl(0.12, 0.2, 2.2, 8), '#8a6a42', T(0, 1.1, 0));
    b.add(box(0.8, 0.2, 0.8), '#6e687e', T(0, 0.1, 0));
    return b.build();
  });
}
export function scalesBeamGeo(): THREE.BufferGeometry {
  return cached('pz-beam', () => {
    const b = new GB();
    b.add(box(2.5, 0.12, 0.14), '#c8901a', T(0, 0, 0));
    b.add(sph(0.12, 8, 6), '#ffc94d', T(0, 0, 0));
    for (const s of [-1, 1]) { for (const d of [-1, 1]) b.add(cyl(0.015, 0.015, 0.85, 4), '#c8ccd8', T(s * 1.15 + d * 0.2, -0.4, 0, 0, 0, -d * 0.24)); b.add(cyl(0.45, 0.38, 0.08, 14), '#e8e2d0', T(s * 1.15, -0.82, 0)); }
    return b.build();
  });
}
export function d20Geo(): THREE.BufferGeometry { return cached('d20', () => new GB().add(ico(0.22, 0), '#f4eedc').build()); }
export function cartGeo(): THREE.BufferGeometry {
  return cached('cart', () => {
    const b = new GB();
    b.add(box(2.0, 0.6, 1.2), '#9a6a3a', T(0, 0.9, 0));
    for (const x of [-0.6, 0.6]) for (const z of [-0.65, 0.65]) b.add(cyl(0.4, 0.4, 0.1, 10), '#6a4a30', T(x, 0.4, z, Math.PI / 2, 0, 0));
    b.add(new THREE.CylinderGeometry(0.75, 0.75, 2.0, 10, 1, true, 0, Math.PI), '#f4eedc', T(0, 1.2, 0, 0, 0, Math.PI / 2));
    b.add(box(0.5, 0.4, 0.5), '#c8a04a', T(0.3, 1.4, 0.1));
    return b.build();
  });
}
export function ropeGeo(): THREE.BufferGeometry { return cached('rope', () => new GB().add(cyl(0.035, 0.035, 1, 5), '#c8a878', T(0, 0.5, 0)).build()); }
export function logGeo(): THREE.BufferGeometry {
  return cached('log', () => {
    const b = new GB();
    b.add(cyl(0.35, 0.35, 2.4, 10), '#8a5a2a', T(0, 0, 0, 0, 0, Math.PI / 2));
    for (const s of [-1, 1]) b.add(cyl(0.3, 0.3, 0.02, 10), '#e8c08a', T(s * 1.21, 0, 0, 0, 0, Math.PI / 2));
    for (let i = 0; i < 5; i++) b.add(cone(0.08, 0.3, 4), '#c8ccd8', T(-0.9 + i * 0.45, -0.4, 0, Math.PI, 0, 0));
    return b.build();
  });
}
export function spikeSlabGeo(): THREE.BufferGeometry {
  return cached('spikeslab', () => {
    const b = new GB();
    b.add(box(9, 0.6, 7), '#6e687e', T(0, 0.3, 0));
    for (let i = 0; i < 6; i++) for (let j = 0; j < 5; j++) b.add(cone(0.18, 0.6, 4), '#c8ccd8', T(-3.75 + i * 1.5, -0.3, -2.8 + j * 1.4, Math.PI, 0, 0));
    return b.build();
  });
}
export function pedestalGeo(): THREE.BufferGeometry {
  return cached('pedestal', () => {
    const b = new GB();
    b.add(cyl(0.55, 0.7, 0.9, 10), '#e8e2d0', T(0, 0.45, 0));
    b.add(cyl(0.7, 0.7, 0.12, 10), '#c8a04a', T(0, 0.95, 0));
    return b.build();
  });
}
/** Loot / shop item: a simple readable shape by slot. */
export function itemGeo(slot: string): THREE.BufferGeometry {
  const k = /tooth|клык|зуб|fang/.test(slot) ? 't' : /weap|sword|axe|меч/.test(slot) ? 'w' : /shield|щит/.test(slot) ? 's' : /potion|зель/.test(slot) ? 'p' : /armor|helmet|hat/.test(slot) ? 'h' : /food|еда/.test(slot) ? 'f' : 'g';
  return cached('item:' + k, () => {
    const b = new GB();
    if (k === 'w') { b.add(box(0.08, 0.7, 0.03), '#ffffff', T(0, 0.5, 0), 1); b.add(box(0.3, 0.05, 0.06), '#c8a04a', T(0, 0.14, 0)); b.add(cyl(0.03, 0.03, 0.18, 6), '#6a4a30', T(0, 0.03, 0)); }
    else if (k === 's') { b.add(cyl(0.3, 0.3, 0.06, 14), '#ffffff', T(0, 0.3, 0, Math.PI / 2, 0, 0), 1); b.add(sph(0.07, 8, 6), '#e8e2d0', T(0, 0.3, -0.05)); }
    else if (k === 'p') { b.add(sph(0.18, 12, 9), '#ffffff', T(0, 0.2, 0), 1); b.add(cyl(0.05, 0.06, 0.15, 8), '#e8f4ff', T(0, 0.42, 0)); b.add(cyl(0.06, 0.06, 0.05, 8), '#8a5a2a', T(0, 0.52, 0)); }
    else if (k === 'h') { b.add(new THREE.SphereGeometry(0.26, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), '#ffffff', T(0, 0.1, 0), 1); b.add(cyl(0.3, 0.3, 0.04, 14), '#c8a04a', T(0, 0.1, 0)); }
    else if (k === 'f') { b.add(sph(0.2, 10, 8), '#ffffff', T(0, 0.2, 0, 0, 0, 0, [1, 0.8, 1]), 1); b.add(cyl(0.015, 0.015, 0.1, 4), '#6a4a30', T(0, 0.4, 0)); }
    else if (k === 't') {
      for (let i = 0; i < 5; i++) b.add(cyl(0.11 - i * 0.02, 0.13 - i * 0.02, 0.16, 8), '#fff8e8', T(Math.sin(i * 0.35) * 0.12, 0.1 + i * 0.14, 0, 0, 0, -i * 0.18), 0);
      b.add(cone(0.05, 0.14, 8), '#fff8e8', T(0.2, 0.82, 0, 0, 0, -0.9), 0);
      b.add(tor(0.13, 0.03, Math.PI * 2, 5, 12), '#ffffff', T(0, 0.04, 0, Math.PI / 2, 0, 0), 1);
    }
    else { b.add(new THREE.OctahedronGeometry(0.22, 0), '#ffffff', T(0, 0.3, 0, 0, 0, 0, [0.8, 1.3, 0.8]), 1); }
    return b.build();
  });
}
export const RARITY_COL: Record<string, string> = { common: '#d8d4e0', uncommon: '#7ad86a', rare: '#5aa8ff', epic: '#c87aff', legendary: '#ffc94d' };
