/**
 * Halloween textures, rasterised on the CPU into DataTextures (no canvas: works in node tests too).
 * Everything is original: signed-distance shapes drawn here.
 */
import * as THREE from 'three';

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (a: number, b: number, v: number) => { const t = clamp01((v - a) / (b - a)); return t * t * (3 - 2 * t); };

function make(w: number, h: number, data: Uint8Array, opts: { repeat?: boolean } = {}): THREE.DataTexture {
  const t = new THREE.DataTexture(data, w, h, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.colorSpace = THREE.SRGBColorSpace;
  t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter; t.generateMipmaps = true;
  t.wrapS = t.wrapT = opts.repeat ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  t.needsUpdate = true;
  return t;
}

/* ---------------------------------------------------------------- signed distances (px) */
function sdTri(px: number, py: number, ax: number, ay: number, bx: number, by: number, cx: number, cy: number): number {
  const e0x = bx - ax, e0y = by - ay, e1x = cx - bx, e1y = cy - by, e2x = ax - cx, e2y = ay - cy;
  const v0x = px - ax, v0y = py - ay, v1x = px - bx, v1y = py - by, v2x = px - cx, v2y = py - cy;
  const seg = (vx: number, vy: number, ex: number, ey: number) => { const t = clamp01((vx * ex + vy * ey) / (ex * ex + ey * ey)); const dx = vx - ex * t, dy = vy - ey * t; return dx * dx + dy * dy; };
  const d = Math.min(seg(v0x, v0y, e0x, e0y), seg(v1x, v1y, e1x, e1y), seg(v2x, v2y, e2x, e2y));
  const s = Math.sign(e0x * e2y - e0y * e2x);
  const c = Math.min(s * (v0x * e0y - v0y * e0x), s * (v1x * e1y - v1y * e1x), s * (v2x * e2y - v2y * e2x));
  return -Math.sqrt(d) * Math.sign(c);   // negative inside
}
function sdSeg(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const vx = px - ax, vy = py - ay, ex = bx - ax, ey = by - ay;
  const t = clamp01((vx * ex + vy * ey) / (ex * ex + ey * ey || 1));
  return Math.hypot(vx - ex * t, vy - ey * t);
}

/* ---------------------------------------------------------------- carved faces */
export const FACE_W = 512, FACE_H = 256;

/**
 * Emission map of the jack-o'-lantern faces for a SphereGeometry(UV): black everywhere except the carved shapes.
 * Face A is centred at u = 0.25 (local +Z): triangle eyes, a little nose and a smile with two teeth.
 * Face B at u = 0.75 (local −Z): happy ^ ^ eyes and a cat "ω" mouth with whiskers. Row 0 is the bottom (v up).
 * rgb = the cut (deep orange walls → yellow core), alpha = the glow through the rind around the cuts (halloween/mats.ts).
 */
export function jackFaceTexture(): THREE.DataTexture {
  const W = FACE_W, H = FACE_H, d = new Uint8Array(W * H * 4);
  const cy = H / 2 + 6;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let cov = 0, depth = 0, near = 99;
    for (let f = 0; f < 2; f++) {
      const cx = f === 0 ? W * 0.25 : W * 0.75;
      const px = x - cx, py = y - cy;   // py > 0 = up
      let sd = 99;
      if (f === 0) {
        sd = Math.min(sd, sdTri(px, py, -40, 8, -12, 8, -26, 34) - 2);                       // left eye
        sd = Math.min(sd, sdTri(px, py, 12, 8, 40, 8, 26, 34) - 2);                          // right eye
        sd = Math.min(sd, sdTri(px, py, -6, -4, 6, -4, 0, 3) - 1.5);                         // nose
        // smile: ring segment under the nose, two teeth left uncut
        const r = Math.hypot(px, py - 6), ang = Math.atan2(-(py - 6), px);                    // ang = π/2 straight down
        let m = Math.max(Math.abs(r - 36) - 5.5, Math.abs(ang - Math.PI / 2) - 1.05) ;
        const tooth = Math.min(Math.hypot(px + 15, py + 27) - 5, Math.hypot(px - 15, py + 27) - 5);
        sd = Math.min(sd, Math.max(m, -(tooth - 2)));
      } else {
        // ^ ^ happy eyes (open arcs) and the cat mouth
        const eye = (ex: number) => { const rr = Math.hypot(px - ex, py - 6); return Math.max(Math.abs(rr - 17) - 4.2, -(py - 6) - 2); };
        sd = Math.min(sd, eye(-30), eye(30));
        sd = Math.min(sd, sdSeg(px, py, 0, -2, 0, -10) - 3);                                 // philtrum
        for (const s of [-1, 1]) {
          const rr = Math.hypot(px - s * 13, py + 12);
          sd = Math.min(sd, Math.max(Math.abs(rr - 13) - 3.6, (py + 12) - 1));              // two lobes of ω
        }
        for (const s of [-1, 1]) for (const k of [-1, 0, 1]) sd = Math.min(sd, sdSeg(px, py, s * 50, k * 9 + 2, s * 74, k * 17 + 4) - 1.7);   // whiskers
      }
      const c = 1 - smooth(-1.1, 1.1, sd);
      if (c > cov) { cov = c; depth = clamp01(-sd / 6); }
      if (sd < near) near = sd;
    }
    const i = (y * W + x) * 4;
    // a cut: the walls of the cut (just inside the edge) are deep orange-red flesh lit from inside, the hole's centre a
    // hot yellow core; alpha = the skin glow around the carving (light through the thin rind), soft, ~22 px wide
    const k = smooth(0.05, 0.75, depth);
    d[i] = Math.round(255 * cov * (0.72 + 0.28 * k));
    d[i + 1] = Math.round(255 * cov * (0.2 + 0.62 * k));
    d[i + 2] = Math.round(255 * cov * (0.03 + 0.3 * k * k));
    d[i + 3] = Math.round(255 * Math.exp(-Math.max(0, near) / 9) * (1 - cov * 0.6));
  }
  const t = make(W, H, d);
  t.wrapS = THREE.RepeatWrapping;
  return t;
}

/* ---------------------------------------------------------------- soft round glow */
/** White soft radial falloff (halo / light pool). Straight alpha, rgb white. */
export function glowTexture(size = 64, power = 2): THREE.DataTexture {
  const d = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const dx = (x + 0.5) / size * 2 - 1, dy = (y + 0.5) / size * 2 - 1;
    const a = Math.pow(1 - smooth(0, 1, Math.hypot(dx, dy)), power);
    const i = (y * size + x) * 4; d[i] = d[i + 1] = d[i + 2] = 255; d[i + 3] = Math.round(255 * a);
  }
  return make(size, size, d);
}

/**
 * Halo sprite: a tight warm core with a long faint tail (gaussian + exponential), so an additive halo reads as light
 * round a lantern, not as a flat disc. rgb white, alpha carries the shape; exactly 0 at the rim.
 */
export function haloTexture(size = 64): THREE.DataTexture {
  const d = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const dx = (x + 0.5) / size * 2 - 1, dy = (y + 0.5) / size * 2 - 1, r = Math.hypot(dx, dy);
    const a = (0.62 * Math.exp(-r * r * 16) + 0.38 * Math.exp(-r * 4.2)) * (1 - smooth(0.7, 1, r));
    const i = (y * size + x) * 4; d[i] = d[i + 1] = d[i + 2] = 255; d[i + 3] = Math.round(255 * a);
  }
  return make(size, size, d);
}

/* ---------------------------------------------------------------- ground fog */
function hash2(x: number, y: number, s: number): number { let h = (x * 374761393 + y * 668265263 + s * 2147483647) | 0; h = (h ^ (h >>> 13)) * 1274126177 | 0; return ((h ^ (h >>> 16)) >>> 0) / 4294967295; }
function vnoise(x: number, y: number, s: number): number {
  const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi;
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
  const a = hash2(xi, yi, s), b = hash2(xi + 1, yi, s), c = hash2(xi, yi + 1, s), e = hash2(xi + 1, yi + 1, s);
  return a + (b - a) * u + (c - a) * v + (a - b - c + e) * u * v;
}
/** Soft wispy blob: radial falloff times 3-octave noise; rgb white, alpha carries the shape. */
export function fogTexture(size = 128): THREE.DataTexture {
  const d = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = (x + 0.5) / size, v = (y + 0.5) / size, dx = u * 2 - 1, dy = v * 2 - 1;
    const n = 0.55 * vnoise(u * 4, v * 4, 3) + 0.3 * vnoise(u * 8, v * 8, 7) + 0.15 * vnoise(u * 16, v * 16, 11);
    const r = 1 - smooth(0.15, 1, Math.hypot(dx, dy));
    const a = clamp01(r * (0.35 + 1.1 * n) );
    const i = (y * size + x) * 4; d[i] = d[i + 1] = d[i + 2] = 255; d[i + 3] = Math.round(255 * Math.min(1, a * a * 1.3));
  }
  return make(size, size, d);
}

/* ---------------------------------------------------------------- cobweb */
/** A corner web: spokes from the corner (0,0) at the bottom-left of the quad and sagging arcs between them. */
export function webTexture(size = 128): THREE.DataTexture {
  const d = new Uint8Array(size * size * 4), N = 5, R = [0.22, 0.4, 0.58, 0.78, 0.97];
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const px = (x + 0.5) / size, py = (y + 0.5) / size;     // corner at (0,1) (top-left of the quad): web hangs from the top-left
    const cx = px, cy = 1 - py, r = Math.hypot(cx, cy), a = Math.atan2(cy, cx);   // a ∈ [0, π/2] inside the quarter
    let line = 99;
    if (r < 1 && cx >= 0 && cy >= 0) {
      const k = (a / (Math.PI / 2)) * N, kn = Math.round(k);
      line = Math.min(line, Math.abs(k - kn) * (Math.PI / 2 / N) * r);                       // spokes
      for (const rr of R) {
        // arcs bow slightly towards the corner between two spokes
        const t = Math.abs(((k % 1) + 1) % 1 - 0.5) * 2;                                      // 1 at a spoke, 0 mid-way
        const bow = rr * (1 - 0.07 * (1 - t));
        line = Math.min(line, Math.abs(r - bow));
      }
    }
    const aa = r >= 1 ? 0 : 1 - smooth(0.0035, 0.011, line);
    const fade = 0.55 + 0.45 * (1 - r);
    const i = (y * size + x) * 4; d[i] = 238; d[i + 1] = 232; d[i + 2] = 255; d[i + 3] = Math.round(255 * aa * fade);
  }
  return make(size, size, d);
}

/** Fog (left half) and cobweb (right half) in one texture: both drawn by one instanced mesh (aK picks the half). */
export function fogWebAtlas(size = 128): THREE.DataTexture {
  const f = fogTexture(size), w = webTexture(size), d = new Uint8Array(size * 2 * size * 4);
  const fd = f.image.data as Uint8Array, wd = w.image.data as Uint8Array;
  for (let y = 0; y < size; y++) {
    d.set(fd.subarray(y * size * 4, (y + 1) * size * 4), y * size * 8);
    d.set(wd.subarray(y * size * 4, (y + 1) * size * 4), y * size * 8 + size * 4);
  }
  f.dispose(); w.dispose();
  return make(size * 2, size, d);
}
