/**
 * Coplanar-overlap detector (dev/test tool, not used at runtime): finds pairs of triangles from DIFFERENT static
 * pieces that lie in the same plane (|Δd| < tol), face the same way (or either way for double-sided materials) and
 * overlap by more than `minArea` — i.e. the surfaces that z-fight (flicker) on screen.
 *   const rec = new ZRecorder(); batch.recorder = rec.add;   // batch.tag names the pieces   … build …   const hits = rec.find();
 */
import type * as THREE from 'three';
import type { BatchKey } from './batch';

export interface ZHit { a: string; b: string; ia: number; ib: number; area: number; normal: [number, number, number]; d: number; at: [number, number, number] }

/** Materials rendered double-sided in the city (their back faces are visible too). */
const DOUBLE = new Set<string>(['flat', 'canvas']);
/** Materials whose surfaces are decals by design (polygonOffset) or invisible. */
const IGNORE = new Set<string>(['back']);

interface Tri { piece: number; nx: number; ny: number; nz: number; d: number; ax: number; ay: number; bx: number; by: number; cx: number; cy: number; x0: number; y0: number; x1: number; y1: number; flip: boolean; cen: [number, number, number] }

export class ZRecorder {
  readonly pieces: { mat: string; tag: string; look: string }[] = [];
  /** Debug: keep each piece's world AABB (x0 x1 y0 y1 z0 z1). */
  keepBoxes = false;
  readonly boxes: number[][] = [];
  /** Closed convex pieces (boxes, cylinders, spheres, roof prisms): AABB + face planes → occluders of buried faces. */
  private convex: { id: number; x0: number; y0: number; z0: number; x1: number; y1: number; z1: number; planes: Float64Array }[] = [];
  private tris = new Map<string, Tri[]>();
  add = (mat: BatchKey, g: THREE.BufferGeometry, tag = '', look = ''): void => {
    if (IGNORE.has(mat)) return;
    const pos = g.attributes.position as THREE.BufferAttribute;
    const id = this.pieces.length;
    this.pieces.push({ mat, tag, look: look || 'u' + id });
    if (this.keepBoxes) { g.computeBoundingBox(); const b = g.boundingBox!; this.boxes[id] = [b.min.x, b.max.x, b.min.y, b.max.y, b.min.z, b.max.z].map((v) => +v.toFixed(3)); }
    const a = pos.array as ArrayLike<number>;
    const idx = g.index ? (g.index.array as ArrayLike<number>) : null;
    const nT = idx ? idx.length / 3 : pos.count / 3;
    if (nT <= 400) this.addConvex(id, a, idx, nT, pos.count);
    for (let t = 0; t < nT; t++) {
      const i0 = idx ? idx[t * 3] : t * 3, i1 = idx ? idx[t * 3 + 1] : t * 3 + 1, i2 = idx ? idx[t * 3 + 2] : t * 3 + 2;
      const px = a[i0 * 3], py = a[i0 * 3 + 1], pz = a[i0 * 3 + 2];
      const ux = a[i1 * 3] - px, uy = a[i1 * 3 + 1] - py, uz = a[i1 * 3 + 2] - pz;
      const vx = a[i2 * 3] - px, vy = a[i2 * 3 + 1] - py, vz = a[i2 * 3 + 2] - pz;
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const l = Math.hypot(nx, ny, nz);
      if (l < 1e-7) continue;   // degenerate (area < 0.05 mm²)
      nx /= l; ny /= l; nz /= l;
      // canonical orientation: first significant component positive
      let flip = false;
      if (nx < -1e-6 || (Math.abs(nx) <= 1e-6 && (ny < -1e-6 || (Math.abs(ny) <= 1e-6 && nz < 0)))) { nx = -nx; ny = -ny; nz = -nz; flip = true; }
      const key = `${Math.round(nx * 200)},${Math.round(ny * 200)},${Math.round(nz * 200)}`;
      const d = nx * px + ny * py + nz * pz;
      // 2D basis in the plane
      const [ex, ey, ez, fx, fy, fz] = basis(nx, ny, nz);
      const P = (x: number, y: number, z: number): [number, number] => [x * ex + y * ey + z * ez, x * fx + y * fy + z * fz];
      const A = P(px, py, pz), B = P(a[i1 * 3], a[i1 * 3 + 1], a[i1 * 3 + 2]), C = P(a[i2 * 3], a[i2 * 3 + 1], a[i2 * 3 + 2]);
      const tri: Tri = {
        piece: id, nx, ny, nz, d, ax: A[0], ay: A[1], bx: B[0], by: B[1], cx: C[0], cy: C[1],
        x0: Math.min(A[0], B[0], C[0]), x1: Math.max(A[0], B[0], C[0]), y0: Math.min(A[1], B[1], C[1]), y1: Math.max(A[1], B[1], C[1]),
        flip, cen: [(px + a[i1 * 3] + a[i2 * 3]) / 3, (py + a[i1 * 3 + 1] + a[i2 * 3 + 1]) / 3, (pz + a[i1 * 3 + 2] + a[i2 * 3 + 2]) / 3],
      };
      let arr = this.tris.get(key); if (!arr) this.tris.set(key, (arr = []));
      arr.push(tri);
    }
  };

  private addConvex(id: number, a: ArrayLike<number>, idx: ArrayLike<number> | null, nT: number, nV: number): void {
    const planes = new Float64Array(nT * 4);
    let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity, np = 0;
    for (let v = 0; v < nV; v++) {
      x0 = Math.min(x0, a[v * 3]); x1 = Math.max(x1, a[v * 3]); y0 = Math.min(y0, a[v * 3 + 1]); y1 = Math.max(y1, a[v * 3 + 1]); z0 = Math.min(z0, a[v * 3 + 2]); z1 = Math.max(z1, a[v * 3 + 2]);
    }
    if (x1 - x0 < 0.02 || y1 - y0 < 0.02 || z1 - z0 < 0.02) return;   // thin slabs never bury anything
    // either winding: a downward-facing shell (a roof's underside layer) bounds the same convex region
    sign: for (const sg of [1, -1]) {
      np = 0;
      for (let t = 0; t < nT; t++) {
        const i0 = idx ? idx[t * 3] : t * 3, i1 = idx ? idx[t * 3 + 1] : t * 3 + 1, i2 = idx ? idx[t * 3 + 2] : t * 3 + 2;
        const px = a[i0 * 3], py = a[i0 * 3 + 1], pz = a[i0 * 3 + 2];
        const ux = a[i1 * 3] - px, uy = a[i1 * 3 + 1] - py, uz = a[i1 * 3 + 2] - pz, vx = a[i2 * 3] - px, vy = a[i2 * 3 + 1] - py, vz = a[i2 * 3 + 2] - pz;
        let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
        const l = Math.hypot(nx, ny, nz); if (l < 1e-9) continue;
        nx *= sg / l; ny *= sg / l; nz *= sg / l;
        const d = nx * px + ny * py + nz * pz;
        for (let v = 0; v < nV; v++) if (nx * a[v * 3] + ny * a[v * 3 + 1] + nz * a[v * 3 + 2] - d > 1e-4) continue sign;   // not convex
        planes[np++] = nx; planes[np++] = ny; planes[np++] = nz; planes[np++] = d;
      }
      this.convex.push({ id, x0, y0, z0, x1, y1, z1, planes: planes.slice(0, np) });
      return;
    }
  }

  /** Is the point inside a convex piece or under the ground? (a/b: the pair — same-facing faces never nudge into them) */
  private buried(x: number, y: number, z: number, a: number, b: number, ground?: (x: number, z: number) => number): boolean {
    if (ground && y < ground(x, z) - 0.002) return true;
    void a; void b;
    for (const c of this.convex) {
      if (x <= c.x0 || x >= c.x1 || y <= c.y0 || y >= c.y1 || z <= c.z0 || z >= c.z1) continue;
      const P = c.planes; let inside = true;
      for (let i = 0; i < P.length; i += 4) if (P[i] * x + P[i + 1] * y + P[i + 2] * z - P[i + 3] > -1e-5) { inside = false; break; }
      if (inside) return true;
    }
    return false;
  }

  /** All overlapping coplanar pairs, merged per piece pair (largest overlap first). */
  find(tol = 0.004, minArea = 2e-4, ground?: (x: number, z: number) => number): ZHit[] {
    this.convex.sort((p, q) => p.x0 - q.x0);
    const pairs = new Map<string, ZHit>();
    for (const [key, arr] of this.tris) {
      arr.sort((p, q) => p.d - q.d);
      for (let i = 0; i < arr.length; i++) {
        const t = arr[i];
        for (let j = i + 1; j < arr.length && arr[j].d - t.d < tol; j++) {
          const u = arr[j];
          if (u.piece === t.piece) continue;
          const ma = this.pieces[t.piece].mat, mb = this.pieces[u.piece].mat;
          if (t.flip !== u.flip && !DOUBLE.has(ma) && !DOUBLE.has(mb)) continue;   // back to back: one is culled
          if (t.flip === u.flip && this.pieces[t.piece].look === this.pieces[u.piece].look) continue;   // identical shading
          if (u.x0 >= t.x1 || u.x1 <= t.x0 || u.y0 >= t.y1 || u.y1 <= t.y0) continue;
          const ov = overlap(t, u);
          const area = ov[0];
          if (area < 1e-6) continue;
          // the overlap's centre in 3D, nudged off the surface on the visible side(s): buried → no flicker on screen
          const c3 = unproject(t, ov[1], ov[2]);
          // only the sides BOTH faces are drawn on can flicker: a single-sided face on its front side, a double-sided one on
          // both (a double-sided sheet under a closed object: seen from below, the object's bottom face is culled)
          const sgn = t.flip ? -1 : 1, e = 0.006;
          const dt = DOUBLE.has(ma), du = DOUBLE.has(mb), same = t.flip === u.flip;
          const sideT = du || same, sideB = dt && (du || !same);   // t's facing side · the opposite side
          const front = sideT && !this.buried(c3[0] + t.nx * e * sgn, c3[1] + t.ny * e * sgn, c3[2] + t.nz * e * sgn, t.piece, u.piece, ground);
          const back = sideB && !this.buried(c3[0] - t.nx * e * sgn, c3[1] - t.ny * e * sgn, c3[2] - t.nz * e * sgn, t.piece, u.piece, ground);
          if (!front && !back) continue;
          const pk = t.piece < u.piece ? t.piece + ':' + u.piece : u.piece + ':' + t.piece;
          const h = pairs.get(pk);
          if (h) h.area += area;
          else {
            const n = key.split(',').map((s) => +s / 200) as [number, number, number];
            pairs.set(pk, { a: label(this.pieces[t.piece]), b: label(this.pieces[u.piece]), ia: t.piece, ib: u.piece, area, normal: n, d: t.d, at: t.cen.map((v) => +v.toFixed(2)) as [number, number, number] });
          }
        }
      }
    }
    return [...pairs.values()].filter((h) => h.area >= minArea).sort((p, q) => q.area - p.area);
  }
}

const label = (p: { mat: string; tag: string; look: string }) => `${p.mat}${p.tag ? '@' + p.tag : ''}`;

function basis(nx: number, ny: number, nz: number): number[] {
  let ex: number, ey: number, ez: number;
  if (Math.abs(nx) < 0.9) { ex = 0; ey = nz; ez = -ny; } else { ex = -nz; ey = 0; ez = nx; }
  const el = Math.hypot(ex, ey, ez); ex /= el; ey /= el; ez /= el;
  return [ex, ey, ez, ny * ez - nz * ey, nz * ex - nx * ez, nx * ey - ny * ex];
}
function unproject(t: Tri, u: number, v: number): [number, number, number] {
  const b = basis(t.nx, t.ny, t.nz);
  return [u * b[0] + v * b[3] + t.d * t.nx, u * b[1] + v * b[4] + t.d * t.ny, u * b[2] + v * b[5] + t.d * t.nz];
}

/** Overlap of two 2D triangles (convex clip): [area, centroid u, centroid v]. */
function overlap(t: Tri, u: Tri): [number, number, number] {
  let poly: number[] = [t.ax, t.ay, t.bx, t.by, t.cx, t.cy];
  if (cross(t.bx - t.ax, t.by - t.ay, t.cx - t.ax, t.cy - t.ay) < 0) poly = [t.ax, t.ay, t.cx, t.cy, t.bx, t.by];
  let clip = [u.ax, u.ay, u.bx, u.by, u.cx, u.cy];
  if (cross(u.bx - u.ax, u.by - u.ay, u.cx - u.ax, u.cy - u.ay) < 0) clip = [u.ax, u.ay, u.cx, u.cy, u.bx, u.by];
  for (let e = 0; e < 3 && poly.length >= 6; e++) {
    const x0 = clip[e * 2], y0 = clip[e * 2 + 1], x1 = clip[((e + 1) % 3) * 2], y1 = clip[((e + 1) % 3) * 2 + 1];
    const out: number[] = [];
    const n = poly.length / 2;
    for (let i = 0; i < n; i++) {
      const px = poly[i * 2], py = poly[i * 2 + 1], qx = poly[((i + 1) % n) * 2], qy = poly[((i + 1) % n) * 2 + 1];
      const sp = cross(x1 - x0, y1 - y0, px - x0, py - y0), sq = cross(x1 - x0, y1 - y0, qx - x0, qy - y0);
      if (sp >= 0) out.push(px, py);
      if ((sp >= 0) !== (sq >= 0)) { const k = sp / (sp - sq); out.push(px + (qx - px) * k, py + (qy - py) * k); }
    }
    poly = out;
  }
  let a = 0, cx = 0, cy = 0; const n = poly.length / 2;
  for (let i = 0; i < n; i++) { cx += poly[i * 2]; cy += poly[i * 2 + 1]; a += poly[i * 2] * poly[((i + 1) % n) * 2 + 1] - poly[((i + 1) % n) * 2] * poly[i * 2 + 1]; }
  return n ? [Math.abs(a) / 2, cx / n, cy / n] : [0, 0, 0];
}
const cross = (ax: number, ay: number, bx: number, by: number) => ax * by - ay * bx;
