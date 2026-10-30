/**
 * Expedition environment geometry beyond props: faceted rock / stone-block shells (tunnels, caverns, canyon walls, halls),
 * distant ridge rings (hills, peaks, mesas, dunes, pines) and small helpers. Everything is vertex-coloured (the cel
 * material lights it), periodic in x with the terrain period so the road can scroll forever.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export const PERIOD = 48;
const K = (2 * Math.PI) / PERIOD;
const TAU = Math.PI * 2;
const sm = (a: number, b: number, x: number) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const mix = (a: number, b: number, t: number) => a + (b - a) * t;

/** smooth bounded noise ~[-1, 1]: t1 is a phase of a periodic coordinate (integer harmonics), t2 a free one */
export function nz(t1: number, t2: number, s = 0): number {
  return 0.45 * Math.sin(3 * t1 + 2 * t2 + s) + 0.3 * Math.sin(5 * t1 - 3.1 * t2 + 2 * s) + 0.2 * Math.sin(8 * t1 + 5.3 * t2 + 3 * s) + 0.12 * Math.sin(13 * t1 + 7.1 * t2 + s * 0.7);
}
/** small per-cell hash 0..1 */
export function hash2(i: number, j: number, s = 0): number { const v = Math.sin(i * 127.1 + j * 311.7 + s * 74.7) * 43758.5453; return v - Math.floor(v); }

export interface ShellOpts {
  U: number; V: number;
  pos: (u: number, v: number, out: THREE.Vector3) => void;
  /** colour of a vertex (u, v, position) */
  col: (u: number, v: number, p: THREE.Vector3, out: THREE.Color) => void;
  /** colour per cell instead of per vertex (blocks) */
  cell?: boolean;
  /** flip the winding */
  flip?: boolean;
}
/** A (U×V) grid surface as flat-shaded triangles with colours + aTint, ready for the cel material. */
export function shell(o: ShellOpts): THREE.BufferGeometry {
  const { U, V } = o;
  const P: THREE.Vector3[] = [];
  const C: THREE.Color[] = [];
  for (let j = 0; j <= V; j++) for (let i = 0; i <= U; i++) {
    const p = new THREE.Vector3(), c = new THREE.Color();
    o.pos(i / U, j / V, p); o.col(i / U, j / V, p, c);
    P.push(p); C.push(c);
  }
  const idx = (i: number, j: number) => j * (U + 1) + i;
  const pos: number[] = [], col: number[] = [];
  const tri = (a: number, b: number, c: number, cc: THREE.Color | null) => {
    const order = o.flip ? [a, c, b] : [a, b, c];
    for (const k of order) { const p = P[k], q = cc || C[k]; pos.push(p.x, p.y, p.z); col.push(q.r, q.g, q.b); }
  };
  const mid = new THREE.Color();
  for (let j = 0; j < V; j++) for (let i = 0; i < U; i++) {
    const a = idx(i, j), b = idx(i + 1, j), c = idx(i, j + 1), d = idx(i + 1, j + 1);
    if (o.cell) {
      const m = new THREE.Vector3().add(P[a]).add(P[d]).multiplyScalar(0.5);
      o.col((i + 0.5) / U, (j + 0.5) / V, m, mid);
      const cc = mid.clone();
      tri(a, b, d, cc); tri(a, d, c, cc);
    } else { tri(a, b, d, null); tri(a, d, c, null); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('aTint', new THREE.Float32BufferAttribute(new Float32Array(pos.length / 3), 1));
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}

/** Rock palette: banded strata with facet noise. */
export function rockColor(out: THREE.Color, p: THREE.Vector3, base: THREE.Color, hi: THREE.Color, band: THREE.Color, o: { strata?: number; dark?: number; seed?: number } = {}): THREE.Color {
  const st = o.strata ?? 1.6, s = o.seed ?? 0;
  const n = nz(p.x * K * 0.5, p.y * 0.6 + p.z * 0.3, s) * 0.5 + 0.5;
  const b = Math.sin(p.y * st + n * 3.0 + p.z * 0.15) * 0.5 + 0.5;
  out.copy(base).lerp(hi, n * 0.65);
  out.lerp(band, sm(0.62, 0.9, b) * 0.55);
  const l = 1 - (o.dark ?? 0) * sm(2, 9, p.y);
  out.multiplyScalar(l * (0.9 + 0.2 * hash2(Math.round(p.x * 2), Math.round(p.y * 2), s)));
  return out;
}

/* ---------------------------------------------------------------- tunnels (travel) and chambers (arenas) */

export type ShellKind = 'cave' | 'mine' | 'dungeon' | 'gorge';
export interface ShellCfg {
  kind: ShellKind;
  base: string; hi: string; band: string; ceil: string;
  W: number; H: number;
  seed: number;
}
const V3 = () => new THREE.Vector3();

/** A tunnel along x (z across): cave / mine rock, dungeon vaulted hall, or a canyon (two open walls). */
export function tunnelGeo(cfg: ShellCfg, span: number, seg: number): THREE.BufferGeometry {
  const base = new THREE.Color(cfg.base), hi = new THREE.Color(cfg.hi), band = new THREE.Color(cfg.band), ceil = new THREE.Color(cfg.ceil);
  const { W, H, seed } = cfg;
  const U = cfg.kind === 'dungeon' ? 24 : cfg.kind === 'gorge' ? 12 : 20;
  const V = Math.round(span / seg);
  const prof = (u: number, x: number, out: THREE.Vector3) => {
    const ph = x * K;
    if (cfg.kind === 'dungeon') {
      // stone hall: vertical walls up to 0.58 H, pointed vault above
      const t = u < 0.5 ? u * 2 : (1 - u) * 2;               // 0 at the floor … 1 at the crown
      const side = u < 0.5 ? -1 : 1;
      const wallT = 0.55, y = t < wallT ? -1.2 + (t / wallT) * (H * 0.62 + 1.2) : H * 0.62 + (t - wallT) / (1 - wallT) * (H * 0.38);
      const z = t < wallT ? W : W * (1 - ((t - wallT) / (1 - wallT)) ** 1.4);
      const bump = t < wallT ? 0.08 * nz(ph, y * 0.7, seed) : 0.05;
      out.set(x, y, side * (z + bump));
      return;
    }
    if (cfg.kind === 'gorge') {
      // u 0..0.5: far wall (z<0) floor→rim ; 0.5..1: near wall
      const side = u < 0.5 ? -1 : 1, t = u < 0.5 ? u * 2 : 1 - (u - 0.5) * 2;   // t: 0 floor … 1 rim
      const ww = side < 0 ? W : W * 1.5;
      const y = -2 + t * (H + 2);
      const lean = 1 - 0.14 * t + 0.3 * sm(0.7, 1, t) * nz(ph, 1.3, seed);
      const z = ww * lean + 2.6 * nz(ph * 1 + t * 0.4, y * 0.35 + side, seed + 2) * (0.4 + t) + (t > 0.9 ? 1.2 * nz(ph, 9, seed) : 0);
      out.set(x, y, side * z);
      return;
    }
    // cave / mine: rounded rock tube
    const phi = u * Math.PI, s = Math.sin(phi), c = Math.cos(phi);
    const w = W + 2.4 * nz(ph, phi * 2.2, seed) + 1.3 * nz(ph * 2, phi * 4, seed + 3);
    const hh = H + 1.6 * nz(ph * 0.5 + phi, 2.0, seed + 5) + 0.9 * nz(ph * 3, phi * 3, seed + 7);
    out.set(x, -2 + (hh + 2) * Math.pow(s, 0.72) + 0.5 * nz(ph, phi * 6, seed + 9), -c * w);
  };
  const g = shell({
    U, V, flip: true,
    pos: (u, v, out) => prof(u, -span / 2 + v * span, out),
    col: (u, v, p, out) => {
      if (cfg.kind === 'dungeon') {
        const bi = Math.floor((p.x + 200) / 1.6), bj = Math.floor((p.y + 3) / 0.9) + (p.z > 0 ? 40 : 0);
        const h = hash2(bi + (bj % 2 ? 0.5 : 0), bj, seed);
        out.copy(base).lerp(hi, h * 0.7);
        if (p.y > H * 0.62) out.lerp(ceil, 0.7);
        out.multiplyScalar(1 - 0.22 * sm(0.5, 0.0, p.y) - 0.1 * sm(H * 0.3, H, p.y));
        return;
      }
      if (cfg.kind === 'gorge') { rockColor(out, p, base, hi, band, { strata: 2.4, seed }); out.multiplyScalar(0.6 + 0.4 * sm(-1.5, 5, p.y)); out.lerp(ceil, 0.35 * sm(7, 14, p.y)); return; }
      rockColor(out, p, base, hi, band, { strata: 2.6, dark: 0.55, seed });
      if (p.y > H * 0.6) out.lerp(ceil, 0.45);
    },
    cell: cfg.kind === 'dungeon',
  });
  return g;
}

/** A round chamber / amphitheatre around the origin (battle arenas): dome (cave, mine), square hall (dungeon) or open canyon wall. */
export function chamberGeo(cfg: ShellCfg, R: number): THREE.BufferGeometry {
  const base = new THREE.Color(cfg.base), hi = new THREE.Color(cfg.hi), band = new THREE.Color(cfg.band), ceil = new THREE.Color(cfg.ceil);
  const { H, seed } = cfg;
  const U = cfg.kind === 'dungeon' ? 48 : 44, V = cfg.kind === 'dungeon' ? 14 : cfg.kind === 'gorge' ? 8 : 12;
  const g = shell({
    U, V, flip: false,
    pos: (u, e, out) => {
      const th = u * TAU;
      let r: number, y: number;
      if (cfg.kind === 'dungeon') {
        // squarish hall (superellipse), flat walls to 0.62 H, then a shallow vault
        const n = 5, sq = 1 / Math.pow(Math.pow(Math.abs(Math.cos(th)), n) + Math.pow(Math.abs(Math.sin(th)), n), 1 / n);
        const wall = 0.62;
        if (e < wall) { y = -1.2 + (e / wall) * (H * 0.62 + 1.2); r = R * sq; }
        else { const t = (e - wall) / (1 - wall); y = H * 0.62 + t * H * 0.38; r = R * sq * (1 - t * t * 0.96); }
        r *= 1 + 0.015 * nz(th, e * 6, seed);
      } else if (cfg.kind === 'gorge') {
        y = -2 + e * (H + 2);
        r = R * (1 + 0.1 * e) + 1.8 * nz(th, y * 0.35, seed) * (0.3 + e) + (e > 0.88 ? 1.4 * nz(th, 9, seed + 3) : 0);
      } else {
        const a = e * Math.PI / 2;
        r = (R + 3.0 * nz(th, e * 4, seed) + 1.4 * nz(th * 2, e * 6, seed + 4)) * Math.pow(Math.cos(a), 0.6);
        y = -2 + (H + 2) * Math.pow(Math.sin(a), 0.85) + 0.7 * nz(th, e * 8, seed + 6) * Math.sin(a);
      }
      out.set(Math.cos(th) * r, y, Math.sin(th) * r * 0.92);
    },
    col: (u, e, p, out) => {
      if (cfg.kind === 'dungeon') {
        const bi = Math.floor(u * 64), bj = Math.floor(e * 18);
        const h = hash2(bi + (bj % 2 ? 0.5 : 0), bj, seed);
        out.copy(base).lerp(hi, h * 0.7);
        if (e > 0.62) out.lerp(ceil, 0.7);
        out.multiplyScalar(1 - 0.22 * sm(0.4, 0.0, e));
        return;
      }
      if (cfg.kind === 'gorge') { rockColor(out, p, base, hi, band, { strata: 2.4, seed }); out.multiplyScalar(0.6 + 0.4 * sm(-1.5, 5, p.y)); out.lerp(ceil, 0.35 * sm(7, 14, p.y)); return; }
      rockColor(out, p, base, hi, band, { strata: 2.6, dark: 0.5, seed });
      if (e > 0.55) out.lerp(ceil, 0.4);
    },
    cell: cfg.kind === 'dungeon',
  });
  return g;
}

/* ---------------------------------------------------------------- distant ridges */

export interface RidgeCfg {
  kind: 'hills' | 'peaks' | 'mesa' | 'dunes' | 'pines';
  r: number; base: number; amp: number; far: string; peak: string; fog: string; haze: number; seed: number; snow?: boolean; segs?: number;
}
/** A closed ring of silhouettes at radius r around the origin; vertical gradient to the fog colour at the foot. */
export function ridgeGeo(o: RidgeCfg): THREE.BufferGeometry {
  const S = o.segs ?? 180;
  const low = new THREE.Color(o.far), peak = new THREE.Color(o.peak), fog = new THREE.Color(o.fog), snow = new THREE.Color('#f4f8ff'), c = new THREE.Color();
  const pos: number[] = [], col: number[] = [], idx: number[] = [];
  const hAt = (th: number): number => {
    const s = o.seed;
    let h: number;
    switch (o.kind) {
      case 'peaks': { const a = Math.abs(Math.sin(3 * th + s)) * 0.5 + Math.abs(Math.sin(7 * th + 2 * s)) * 0.35 + Math.abs(Math.sin(17 * th + s * 3)) * 0.15; h = Math.pow(a, 1.6) * 1.5; break; }
      case 'mesa': { const a = Math.sin(3 * th + s) * 0.5 + Math.sin(7 * th + 2 * s) * 0.3 + Math.sin(2 * th) * 0.3; h = sm(-0.2, 0.15, a) * (0.7 + 0.15 * Math.sin(11 * th + s)) + 0.12 * Math.sin(5 * th + s); break; }
      case 'dunes': h = 0.5 + 0.35 * Math.sin(5 * th + s) + 0.2 * Math.sin(9 * th + 2 * s) + 0.1 * Math.sin(17 * th); break;
      case 'pines': { const a = 0.5 + 0.3 * Math.sin(3 * th + s) + 0.2 * Math.sin(7 * th + 2 * s); const sp = Math.abs(((th * 46 / TAU + hash2(Math.floor(th * 46 / TAU), 1, s) * 0.3) % 1) - 0.5) * 2; h = a * 0.7 + (1 - sp) * 0.35 * (0.6 + 0.4 * Math.sin(13 * th + s)); break; }
      default: h = 0.5 + 0.3 * Math.sin(3 * th + s) + 0.22 * Math.sin(5 * th + 2 * s + 1) + 0.12 * Math.sin(11 * th + s * 3);
    }
    return o.base + o.amp * h;
  };
  const rows = o.kind === 'pines' ? 2 : 3;
  for (let i = 0; i <= S; i++) {
    const th = (i % S) / S * TAU, h = hAt(th);
    const x = Math.cos(th) * o.r, z = Math.sin(th) * o.r;
    const tt = (h - o.base) / (o.amp * 1.5 + 1e-6);
    // foot (fog colour), mid, crest
    pos.push(x, -12, z); c.copy(fog); col.push(c.r, c.g, c.b);
    if (rows === 3) { pos.push(x, h * 0.55, z); c.copy(low).lerp(fog, o.haze * 0.9); col.push(c.r, c.g, c.b); }
    pos.push(x, h, z);
    c.copy(low).lerp(peak, Math.min(1, 0.25 + tt * 0.9)); if (o.snow && tt > 0.5) c.lerp(snow, sm(0.5, 0.8, tt)); c.lerp(fog, o.haze);
    col.push(c.r, c.g, c.b);
  }
  for (let i = 0; i < S; i++) for (let r = 0; r < rows - 1; r++) {
    const a = i * rows + r, b = (i + 1) * rows + r;
    idx.push(a, a + 1, b + 1, a, b + 1, b);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

/** Soft blob shadows in ONE instanced draw (decal shader): items = x, y, z, radiusX, radiusZ, alpha per shadow. */
export function blobShadowMesh(mat: THREE.Material, items: number[], rot = -0.45): THREE.InstancedMesh {
  const n = items.length / 6;
  const g = new THREE.PlaneGeometry(2, 2); g.rotateX(-Math.PI / 2);
  const col = new Float32Array(n * 4), pp = new Float32Array(n * 2);
  const im = new THREE.InstancedMesh(g, mat, n);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rot), p = new THREE.Vector3(), sc = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    const o = i * 6;
    p.set(items[o], items[o + 1], items[o + 2]); sc.set(items[o + 3], 1, items[o + 4]);
    m.compose(p, q, sc); im.setMatrixAt(i, m);
    col[i * 4 + 3] = items[o + 5]; pp[i * 2] = 1;
  }
  g.setAttribute('iCol', new THREE.InstancedBufferAttribute(col, 4)); g.setAttribute('iP', new THREE.InstancedBufferAttribute(pp, 2));
  im.frustumCulled = false; im.renderOrder = 1; im.name = 'exp-blobs';
  return im;
}

export { mergeGeometries, sm as smooth01, mix as lerpN, V3 };
