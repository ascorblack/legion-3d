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
  build(): THREE.BufferGeometry {
    const g = mergeGeometries(this.parts, false) || new THREE.BufferGeometry();
    for (const p of this.parts) p.dispose();
    this.parts = [];
    g.computeBoundingSphere();
    return g;
  }
}
const sph = (r: number, w = 12, h = 9) => new THREE.SphereGeometry(r, w, h);
const cyl = (rt: number, rb: number, h: number, s = 10) => new THREE.CylinderGeometry(rt, rb, h, s);
const cone = (r: number, h: number, s = 8) => new THREE.ConeGeometry(r, h, s);
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

/** Head height (m, unscaled) — crowns, hp bars and telegraph signs sit above it. */
export const FOE_TOP: Record<FoeArt, number> = { wolf: 1.15, skeleton: 1.5, bandit: 1.4, boar: 1.0, drowner: 1.35, spider: 1.0, bat: 1.75, ghost: 1.55, slime: 0.95, pumpkin: 1.2, golem: 1.75 };
/** Body radius for hits. */
export const FOE_R: Record<FoeArt, number> = { wolf: 0.55, skeleton: 0.4, bandit: 0.45, boar: 0.55, drowner: 0.5, spider: 0.65, bat: 0.45, ghost: 0.45, slime: 0.5, pumpkin: 0.45, golem: 0.62 };
/** Fliers bob in the air. */
export const FOE_FLY: Record<FoeArt, number> = { wolf: 0, skeleton: 0, bandit: 0, boar: 0, drowner: 0, spider: 0, bat: 1.0, ghost: 0.25, slime: 0, pumpkin: 0, golem: 0 };

export function foeGeo(a: FoeArt): THREE.BufferGeometry {
  return cached('foe:' + a, () => {
    const b = new GB();
    const INK = '#231a2c';
    switch (a) {
      case 'wolf': {
        const c0 = '#9a9aa6', c1 = '#62626e', c2 = '#e4e0d8';
        b.add(sph(0.36, 12, 9), c0, T(0, 0.58, 0.05, 0, 0, 0, [0.95, 0.85, 1.45]));
        b.add(sph(0.26, 10, 7), c2, T(0, 0.5, -0.1, 0, 0, 0, [0.8, 0.7, 1.2]));
        b.add(sph(0.29, 12, 9), c0, T(0, 0.86, -0.5));
        b.add(cone(0.15, 0.32, 8), c0, T(0, 0.8, -0.78, -Math.PI / 2, 0, 0, [1, 1, 0.8]));
        b.add(sph(0.05, 6, 4), INK, T(0, 0.83, -0.94));
        for (const s of [-1, 1]) {
          b.add(cone(0.1, 0.24, 5), c1, T(s * 0.15, 1.12, -0.45, 0, 0, -s * 0.25));
          b.add(sph(0.05, 6, 5), '#ffd34d', T(s * 0.11, 0.93, -0.74));
          b.add(sph(0.024, 5, 4), INK, T(s * 0.11, 0.93, -0.785));
          b.add(cone(0.025, 0.07, 4), '#ffffff', T(s * 0.05, 0.7, -0.86, Math.PI, 0, 0));
          b.add(cyl(0.075, 0.06, 0.46, 6), c1, T(s * 0.18, 0.23, -0.32));
          b.add(cyl(0.075, 0.06, 0.46, 6), c1, T(s * 0.18, 0.23, 0.38));
        }
        b.add(cone(0.12, 0.5, 7), c1, T(0, 0.78, 0.62, -0.9, 0, 0));
        b.add(cone(0.14, 0.12, 8), c1, T(0, 0.86, -0.04, 0, 0, 0, [2.2, 1, 1.3]));
        break;
      }
      case 'skeleton': {
        const bone = '#f1ead6', dark = '#3a3046';
        for (const s of [-1, 1]) {
          b.add(cyl(0.04, 0.035, 0.55, 6), bone, T(s * 0.1, 0.28, 0));
          b.add(sph(0.06, 6, 4), bone, T(s * 0.1, 0.03, -0.04, 0, 0, 0, [1, 0.6, 1.4]));
          b.add(cyl(0.035, 0.03, 0.42, 6), bone, T(s * 0.25, 0.82, -0.06, -0.3, 0, s * 0.35));
        }
        b.add(box(0.28, 0.1, 0.14), bone, T(0, 0.58, 0));
        b.add(cyl(0.035, 0.035, 0.45, 6), bone, T(0, 0.8, 0.02));
        for (let i = 0; i < 3; i++) b.add(tor(0.14 - i * 0.015, 0.028, Math.PI * 2, 4, 12), bone, T(0, 0.74 + i * 0.1, 0, Math.PI / 2, 0, 0, [1.15, 0.85, 1]));
        b.add(sph(0.26, 12, 9), bone, T(0, 1.22, -0.02, 0, 0, 0, [1, 0.95, 0.95]));
        b.add(box(0.2, 0.1, 0.14), bone, T(0, 1.03, -0.07));
        for (const s of [-1, 1]) { b.add(sph(0.07, 7, 5), INK, T(s * 0.09, 1.22, -0.22)); b.add(sph(0.03, 5, 4), '#7affb0', T(s * 0.09, 1.22, -0.27)); }
        b.add(box(0.05, 0.42, 0.02), '#a8a29a', T(0.4, 1.0, -0.2, 0.5, 0, 0));
        b.add(box(0.14, 0.03, 0.04), '#7a5232', T(0.4, 0.83, -0.1, 0.5, 0, 0));
        b.add(cyl(0.2, 0.2, 0.05, 10), '#6a4a30', T(-0.36, 0.8, -0.12, Math.PI / 2, 0, 0.3));
        b.add(sph(0.05, 6, 4), dark, T(-0.37, 0.8, -0.16));
        break;
      }
      case 'bandit': {
        const cloak = '#5a4636', hood = '#3a3040', skin = '#e8c8a0';
        b.add(cyl(0.2, 0.36, 0.78, 12), cloak, T(0, 0.44, 0));
        for (const s of [-1, 1]) b.add(cyl(0.07, 0.07, 0.2, 6), '#2a2230', T(s * 0.1, 0.08, 0));
        b.add(box(0.5, 0.06, 0.42), '#8a6a3a', T(0, 0.55, 0, 0, 0, 0, [0.9, 1, 0.9]));
        b.add(box(0.08, 0.08, 0.04), '#e8c04a', T(0, 0.55, -0.2));
        b.add(sph(0.24, 12, 9), skin, T(0, 1.0, -0.02));
        b.add(sph(0.28, 12, 9), hood, T(0, 1.06, 0.06, 0, 0, 0, [1, 1.05, 1]));
        b.add(cone(0.12, 0.25, 6), hood, T(0, 1.32, 0.2, -0.9, 0, 0));
        b.add(box(0.36, 0.08, 0.1), '#b8323a', T(0, 0.98, -0.2));
        for (const s of [-1, 1]) b.add(sph(0.03, 5, 4), INK, T(s * 0.08, 1.04, -0.23));
        for (const s of [-1, 1]) b.add(sph(0.08, 7, 5), cloak, T(s * 0.3, 0.62, -0.05));
        b.add(cone(0.04, 0.3, 4), '#dfe4ee', T(0.32, 0.78, -0.12, 0.2, 0, 0));
        b.add(cone(0.08, 0.04, 6), '#c8a04a', T(0.32, 0.62, -0.1));
        break;
      }
      case 'boar': {
        const c0 = '#7a5236', c1 = '#4f3424';
        b.add(sph(0.4, 12, 9), c0, T(0, 0.55, 0.05, 0, 0, 0, [1, 0.88, 1.35]));
        b.add(sph(0.31, 12, 9), c0, T(0, 0.58, -0.5));
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
        b.add(sph(0.26, 10, 8), c2, T(0, 0.5, -0.17, 0, 0, 0, [1, 1.1, 0.6]));
        for (const s of [-1, 1]) {
          b.add(sph(0.12, 10, 8), '#ffffff', T(s * 0.15, 1.02, -0.18));
          b.add(sph(0.06, 6, 5), INK, T(s * 0.15, 1.02, -0.29));
          b.add(cone(0.12, 0.32, 4), c1, T(s * 0.42, 0.68, 0.02, 0, 0, -s * 1.2, [0.4, 1, 1]));
          b.add(sph(0.09, 6, 5), c0, T(s * 0.17, 0.08, -0.06, 0, 0, 0, [1, 0.5, 1.5]));
        }
        b.add(box(0.26, 0.04, 0.04), INK, T(0, 0.72, -0.34));
        for (let i = 0; i < 4; i++) b.add(box(0.05, 0.38, 0.02), '#2f6a3a', T(-0.2 + i * 0.13, 0.85 - (i % 2) * 0.05, 0.05 + (i % 2) * 0.1, 0.2, 0, (i - 1.5) * 0.3));
        b.add(cone(0.1, 0.3, 4), c1, T(0, 1.05, 0.15, -0.5, 0, 0, [0.4, 1, 1]));
        break;
      }
      case 'spider': {
        const c0 = '#3e2f56', c1 = '#2a1f3a';
        b.add(sph(0.42, 12, 9), c0, T(0, 0.6, 0.38, 0, 0, 0, [1, 0.85, 1.1]));
        b.add(sph(0.12, 8, 6), '#ff9a3a', T(0, 0.92, 0.36, 0, 0, 0, [1, 0.4, 1]));
        b.add(sph(0.26, 10, 8), c0, T(0, 0.5, -0.15));
        for (const s of [-1, 1]) {
          b.add(sph(0.05, 6, 4), '#ff3a4a', T(s * 0.08, 0.6, -0.38));
          b.add(sph(0.03, 5, 4), '#ff3a4a', T(s * 0.15, 0.66, -0.33));
          for (let i = 0; i < 4; i++) {
            const z = -0.3 + i * 0.2, ang = -0.6 + i * 0.4;
            b.add(cyl(0.035, 0.03, 0.5, 5), c1, T(s * 0.38, 0.62, z + Math.sin(ang) * 0.1, 0, 0, s * 1.0));
            b.add(cyl(0.03, 0.02, 0.6, 5), c1, T(s * 0.72, 0.32, z + Math.sin(ang) * 0.2, 0, 0, -s * 0.35));
          }
          b.add(cone(0.035, 0.12, 4), '#f4eedc', T(s * 0.06, 0.34, -0.36, Math.PI, 0, 0));
        }
        break;
      }
      case 'bat': {
        const c0 = '#4a3a5e', c1 = '#2e2240', w = '#6a4a7e';
        b.add(sph(0.22, 10, 8), c0, T(0, 1.55, 0, 0, 0, 0, [1, 1.1, 0.9]));
        b.add(sph(0.18, 10, 8), c0, T(0, 1.82, -0.05));
        for (const s of [-1, 1]) {
          b.add(cone(0.07, 0.2, 4), c0, T(s * 0.1, 2.02, -0.03, 0, 0, -s * 0.3));
          b.add(sph(0.045, 6, 4), '#ff4a5a', T(s * 0.07, 1.84, -0.2));
          const wing = new THREE.BufferGeometry();
          wing.setAttribute('position', new THREE.Float32BufferAttribute([0, 0.12, 0, s * 0.8, 0.28, 0.05, s * 0.55, -0.12, 0.05, 0, 0.12, 0, s * 0.55, -0.12, 0.05, s * 0.22, -0.18, 0.02,
            0, 0.12, 0, s * 0.55, -0.12, 0.05, s * 0.8, 0.28, 0.05, 0, 0.12, 0, s * 0.22, -0.18, 0.02, s * 0.55, -0.12, 0.05], 3));
          wing.computeVertexNormals();
          b.add(wing, w, T(s * 0.12, 1.55, 0.02));
          b.add(cone(0.02, 0.06, 4), '#ffffff', T(s * 0.04, 1.73, -0.17, Math.PI, 0, 0));
        }
        b.add(cyl(0.015, 0.015, 0.2, 4), c1, T(0, 1.3, 0));
        break;
      }
      case 'ghost': {
        const c0 = '#e8f0ff';
        b.add(sph(0.36, 14, 10), c0, T(0, 1.05, 0));
        b.add(cyl(0.36, 0.48, 0.7, 14), c0, T(0, 0.68, 0));
        for (let i = 0; i < 6; i++) { const a2 = (i / 6) * Math.PI * 2; b.add(cone(0.12, 0.2, 5), c0, T(Math.cos(a2) * 0.38, 0.26, Math.sin(a2) * 0.38, Math.PI, 0, 0)); }
        for (const s of [-1, 1]) b.add(sph(0.07, 7, 5), INK, T(s * 0.12, 1.1, -0.32, 0, 0, 0, [1, 1.4, 0.5]));
        b.add(sph(0.07, 7, 5), INK, T(0, 0.92, -0.34, 0, 0, 0, [1, 1.3, 0.5]));
        for (const s of [-1, 1]) b.add(sph(0.1, 7, 5), c0, T(s * 0.42, 0.85, -0.05, 0, 0, s * 0.6, [1, 1.6, 1]));
        break;
      }
      case 'pumpkin': {
        const o = '#ff8a2a';
        for (let i = 0; i < 6; i++) { const a2 = (i / 6) * Math.PI * 2; b.add(sph(0.26, 10, 8), o, T(Math.cos(a2) * 0.16, 0.62, Math.sin(a2) * 0.16, 0, 0, 0, [0.8, 1, 0.8])); }
        b.add(cyl(0.04, 0.05, 0.18, 6), '#4f7a2a', T(0, 1.0, 0, 0.2, 0, 0.2));
        for (const s of [-1, 1]) { b.add(cone(0.08, 0.1, 3), '#2a1206', T(s * 0.12, 0.72, -0.36, -Math.PI / 2, 0, 0)); b.add(cyl(0.05, 0.05, 0.3, 5), '#3a5a2a', T(s * 0.12, 0.15, 0)); }
        b.add(box(0.28, 0.06, 0.05), '#2a1206', T(0, 0.52, -0.38));
        b.add(sph(0.06, 6, 4), '#ffd34d', T(0, 0.62, -0.3));
        break;
      }
      case 'golem': {
        // the Pumpkin Golem (hw_pumpkin leader, «Тыквенный голем»): a hulk of rotten pumpkins on vine legs, vine arms
        // with pumpkin fists, a glowing jack-o'-lantern head and a crown of bone shards (site: topBoss 212 vs top 146)
        const o = '#b8561c', od = '#7e3a14', vine = '#3a4436', bone = '#c4beac';
        for (const s of [-1, 1]) b.add(cyl(0.09, 0.12, 0.42, 6), vine, T(s * 0.2, 0.21, 0));
        for (let i = 0; i < 7; i++) { const a2 = (i / 7) * Math.PI * 2; b.add(sph(0.3, 10, 8), i % 2 ? o : od, T(Math.cos(a2) * 0.2, 0.78, Math.sin(a2) * 0.2, 0, 0, 0, [0.85, 1.05, 0.85])); }
        b.add(sph(0.27, 10, 8), od, T(0, 1.02, 0.02, 0, 0, 0, [1.1, 0.8, 1]));
        for (const s of [-1, 1]) {
          b.add(cyl(0.06, 0.07, 0.62, 6), vine, T(s * 0.5, 0.85, -0.05, 0.3, 0, s * 0.55));
          b.add(sph(0.16, 9, 7), o, T(s * 0.66, 0.55, -0.15));
        }
        b.add(sph(0.3, 12, 9), o, T(0, 1.38, 0, 0, 0, 0, [1, 0.85, 1]));
        for (const s of [-1, 1]) b.add(cone(0.07, 0.09, 3), '#ffd34d', T(s * 0.11, 1.45, -0.27, -Math.PI / 2, 0, 0));
        b.add(box(0.26, 0.06, 0.05), '#ffd34d', T(0, 1.3, -0.28));
        for (let i = 0; i < 5; i++) b.add(cone(0.035, 0.15, 4), bone, T((i - 2) * 0.08, 1.66, 0, 0, 0, (i - 2) * 0.12));
        break;
      }
      case 'slime':
      default: {
        const c0 = '#7ed36a', c1 = '#4fa84a';
        b.add(sph(0.45, 14, 10), c0, T(0, 0.38, 0, 0, 0, 0, [1, 0.78, 1]));
        b.add(sph(0.2, 10, 8), '#c8f4b0', T(-0.14, 0.58, -0.22, 0, 0, 0, [1, 0.5, 0.5]));
        for (const s of [-1, 1]) { b.add(sph(0.08, 8, 6), '#ffffff', T(s * 0.14, 0.52, -0.38)); b.add(sph(0.04, 6, 4), INK, T(s * 0.14, 0.52, -0.44)); }
        b.add(sph(0.1, 8, 6), c1, T(0, 0.78, 0.05));
        break;
      }
    }
    return tinted(b.build());
  });
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
  | 'stone' | 'mound' | 'cliff' | 'snowpine' | 'cactus' | 'support' | 'lily' | 'fence';
export function propGeo(k: PropKind, pal = 0): THREE.BufferGeometry {
  return cached(`prop:${k}:${pal}`, () => {
    const b = new GB();
    switch (k) {
      case 'tree': {
        const leaf = ['#5fb85a', '#7ac86a', '#e8a04a', '#4fa86a'][pal % 4];
        b.add(cyl(0.12, 0.18, 1.4, 7), '#7a5436', T(0, 0.7, 0));
        b.add(ico(0.85, 1), leaf, T(0, 1.9, 0, 0, 0, 0, [1, 0.9, 1]));
        b.add(ico(0.6, 0), leaf, T(0.45, 1.55, 0.2));
        b.add(ico(0.55, 0), leaf, T(-0.4, 1.6, -0.15));
        b.add(sph(0.08, 6, 4), '#ff5a6a', T(0.5, 1.9, -0.55));
        b.add(sph(0.08, 6, 4), '#ff5a6a', T(-0.3, 2.3, -0.6));
        break;
      }
      case 'pine': case 'snowpine': {
        const leaf = k === 'snowpine' ? '#3f7a6a' : '#3f8a5a';
        b.add(cyl(0.1, 0.15, 0.8, 6), '#6a4a30', T(0, 0.4, 0));
        for (let i = 0; i < 3; i++) {
          b.add(cone(1.0 - i * 0.24, 1.1, 8), leaf, T(0, 1.1 + i * 0.62, 0));
          if (k === 'snowpine') b.add(cone(0.55 - i * 0.14, 0.45, 8), '#f4f8ff', T(0, 1.5 + i * 0.62, 0));
        }
        break;
      }
      case 'dead':
        b.add(cyl(0.08, 0.16, 1.8, 6), '#5a4a42', T(0, 0.9, 0, 0, 0, 0.06));
        b.add(cyl(0.04, 0.07, 0.8, 5), '#5a4a42', T(0.3, 1.4, 0, 0, 0, -0.9));
        b.add(cyl(0.03, 0.06, 0.7, 5), '#5a4a42', T(-0.25, 1.65, 0.05, 0, 0, 0.8));
        break;
      case 'bush': {
        const c = ['#5aa85a', '#4f9a6a', '#8ab84a', '#6a7a5a'][pal % 4];
        b.add(ico(0.5, 1), c, T(0, 0.35, 0, 0, 0, 0, [1.2, 0.8, 1]));
        b.add(ico(0.35, 0), c, T(0.4, 0.3, 0.1));
        b.add(ico(0.32, 0), c, T(-0.35, 0.28, -0.1));
        if (pal % 2 === 0) for (let i = 0; i < 3; i++) b.add(sph(0.06, 5, 4), ['#ff8ab0', '#ffffff', '#ffd34d'][i], T(-0.3 + i * 0.3, 0.6, -0.35));
        break;
      }
      case 'rock': {
        const c = ['#9a94a8', '#8a8070', '#6a6478', '#b8b0a0'][pal % 4];
        b.add(dod(0.55), c, T(0, 0.25, 0, 0.3, 0.5, 0.1, [1.2, 0.7, 1]));
        b.add(dod(0.3), c, T(0.55, 0.12, 0.2, 0.4, 0.2, 0.3, [1, 0.7, 1]));
        break;
      }
      case 'grass': {
        const c = ['#6ac85a', '#8ad86a', '#c8b86a', '#5aa86a'][pal % 4];
        for (let i = 0; i < 5; i++) { const a = (i / 5) * Math.PI * 2; b.add(cone(0.05, 0.38, 3), c, T(Math.cos(a) * 0.08, 0.18, Math.sin(a) * 0.08, Math.sin(a) * 0.3, 0, Math.cos(a) * 0.3)); }
        break;
      }
      case 'flower': {
        const c = ['#ff8ab0', '#ffd34d', '#9ab8ff', '#ffffff'][pal % 4];
        b.add(cyl(0.012, 0.012, 0.3, 3), '#4f9a4a', T(0, 0.15, 0));
        for (let i = 0; i < 5; i++) { const a = (i / 5) * Math.PI * 2; b.add(sph(0.045, 4, 2), c, T(Math.cos(a) * 0.05, 0.31, Math.sin(a) * 0.05)); }
        b.add(sph(0.03, 5, 4), '#ffb02a', T(0, 0.32, 0));
        break;
      }
      case 'reed':
        for (let i = 0; i < 4; i++) { b.add(cyl(0.015, 0.02, 1.1, 3), '#6a8a4a', T(i * 0.07 - 0.1, 0.55, (i % 2) * 0.06, 0, 0, (i - 1.5) * 0.08)); if (i % 2) b.add(cyl(0.035, 0.035, 0.2, 5), '#6a4a2a', T(i * 0.07 - 0.1 + (i - 1.5) * -0.04, 1.05, (i % 2) * 0.06)); }
        break;
      case 'lily':
        b.add(cyl(0.3, 0.3, 0.02, 10), '#4fa85a', T(0, 0.01, 0));
        if (pal % 2) b.add(sph(0.07, 6, 4), '#ffc8e0', T(0.05, 0.06, 0));
        break;
      case 'mushroom': {
        const cap = ['#e84a4a', '#c88a4a', '#9a6ad8', '#4ad8c8'][pal % 4];
        b.add(cyl(0.06, 0.08, 0.25, 6), '#f4eedc', T(0, 0.12, 0));
        b.add(sph(0.18, 8, 4), cap, T(0, 0.26, 0, 0, 0, 0, [1, 0.6, 1]));
        for (let i = 0; i < 3; i++) b.add(sph(0.03, 4, 2), '#ffffff', T(Math.cos(i * 2) * 0.1, 0.34, Math.sin(i * 2) * 0.1));
        break;
      }
      case 'stalag': {
        const c = pal % 2 ? '#5a4e6a' : '#6a5a52';
        b.add(cone(0.35, 1.6, 6), c, T(0, 0.8, 0));
        b.add(cone(0.2, 0.9, 6), c, T(0.35, 0.45, 0.1));
        break;
      }
      case 'crystal': {
        const c = ['#7af0ff', '#ff7af0', '#9aff7a', '#ffd37a'][pal % 4];
        b.add(new THREE.OctahedronGeometry(0.25, 0), c, T(0, 0.45, 0, 0, 0, 0, [0.6, 1.8, 0.6]));
        b.add(new THREE.OctahedronGeometry(0.16, 0), c, T(0.2, 0.25, 0.05, 0, 0, 0.5, [0.6, 1.6, 0.6]));
        b.add(new THREE.OctahedronGeometry(0.14, 0), c, T(-0.18, 0.2, -0.05, 0, 0, -0.5, [0.6, 1.6, 0.6]));
        break;
      }
      case 'pillar':
        b.add(cyl(0.32, 0.36, 3.2, 8), '#8a8498', T(0, 1.6, 0));
        b.add(box(0.9, 0.25, 0.9), '#6e687e', T(0, 3.25, 0));
        b.add(box(0.9, 0.25, 0.9), '#6e687e', T(0, 0.12, 0));
        break;
      case 'torch':
        b.add(cyl(0.05, 0.06, 1.4, 6), '#6a4a30', T(0, 0.7, 0));
        b.add(cyl(0.11, 0.07, 0.18, 8), '#4a3a32', T(0, 1.45, 0));
        b.add(cone(0.12, 0.32, 7), '#ffb02a', T(0, 1.68, 0));
        b.add(cone(0.06, 0.2, 6), '#fff2a8', T(0, 1.64, 0));
        break;
      case 'stone':
        b.add(box(0.7, 2.0, 0.4), '#8a8a92', T(0, 1.0, 0, 0, 0, 0.05));
        b.add(box(0.35, 0.3, 0.42), '#6aa86a', T(0.1, 0.08, 0));
        break;
      case 'mound':
        b.add(new THREE.SphereGeometry(2.6, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), '#6aa85a', T(0, -0.2, 0, 0, 0, 0, [1.4, 0.75, 1]));
        b.add(box(0.8, 1.0, 0.25), '#7a7480', T(0, 0.2, -3.4, 0, 0, 0));
        break;
      case 'cliff': {
        const c = ['#9a8a7a', '#7a6e66', '#a8a0b8', '#c8a878'][pal % 4];
        b.add(dod(2.0), c, T(0, 1.6, 0, 0.2, 0.4, 0.1, [1.3, 1.5, 1]));
        b.add(dod(1.4), c, T(1.6, 0.9, 0.5, 0.5, 0.1, 0.3, [1, 1.3, 1]));
        b.add(dod(1.2), '#6aa85a', T(0.3, 3.4, 0, 0.1, 0.3, 0, [1.5, 0.35, 1.2]));
        break;
      }
      case 'cactus':
        b.add(cyl(0.18, 0.2, 1.5, 8), '#5a9a4a', T(0, 0.75, 0));
        b.add(cyl(0.1, 0.1, 0.5, 6), '#5a9a4a', T(0.3, 0.9, 0, 0, 0, -1.2));
        b.add(cyl(0.09, 0.09, 0.4, 6), '#5a9a4a', T(0.45, 1.15, 0));
        b.add(sph(0.08, 6, 4), '#ff8ab0', T(0, 1.55, 0));
        break;
      case 'support':
        b.add(box(0.22, 3.0, 0.22), '#8a6a42', T(-1.6, 1.5, 0));
        b.add(box(0.22, 3.0, 0.22), '#8a6a42', T(1.6, 1.5, 0));
        b.add(box(3.6, 0.25, 0.3), '#7a5a36', T(0, 3.05, 0));
        b.add(sph(0.14, 8, 6), '#ffd37a', T(0, 2.75, -0.15));
        break;
      case 'fence':
        for (let i = 0; i < 3; i++) b.add(box(0.1, 0.8, 0.1), '#8a6a42', T(-0.8 + i * 0.8, 0.4, 0));
        b.add(box(1.8, 0.08, 0.06), '#9a7a52', T(0, 0.6, 0));
        b.add(box(1.8, 0.08, 0.06), '#9a7a52', T(0, 0.3, 0));
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
    b.add(new THREE.CylinderGeometry(0.33, 0.33, 1.0, 10, 1, false, 0, Math.PI), '#a8743e', T(0, 0, 0.33, 0, 0, Math.PI / 2));
    for (const x of [-0.42, 0, 0.42]) b.add(new THREE.CylinderGeometry(0.345, 0.345, 0.08, 10, 1, false, 0, Math.PI), '#e8c04a', T(x, 0, 0.33, 0, 0, Math.PI / 2));
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
    b.add(cyl(1, 0.92, 0.35, 6), '#8a8498', T(0, -0.17, 0));
    b.add(cyl(0.98, 0.98, 0.06, 6), '#a8a0b8', T(0, 0.02, 0));
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
