/**
 * Pixel-synthesised kinds (no shapes): water height field (sum of tileable waves) and lava (Voronoi crust plates with
 * glowing cracks + an emissive map). They return colour + height buffers for post.ts.
 */
import { hash2, fbmGen } from './noise';
import type { RGB } from './paint';

/** Tileable wave height field N×N as RGBA (R = height); separable sines (no per-pixel trig). */
export function* waterHeight(N: number, r: () => number): Generator<void, Uint8ClampedArray> {
  const d = new Uint8ClampedArray(N * N * 4);
  const W = 9, sx = new Float32Array(W * N), cx = new Float32Array(W * N), sy = new Float32Array(W * N), cy = new Float32Array(W * N), amp = new Float32Array(W);
  let tot = 0;
  for (let i = 0; i < W; i++) {
    const fx = 1 + Math.floor(r() * 5), fy = Math.floor(r() * 7) - 3, ph = r() * 6.28; amp[i] = (0.5 + r() * 0.5) / (1 + i * 0.25); tot += amp[i];
    for (let t = 0; t < N; t++) {
      const ax = (fx * t / N) * Math.PI * 2, ay = (fy * t / N) * Math.PI * 2 + ph;
      sx[i * N + t] = Math.sin(ax); cx[i * N + t] = Math.cos(ax); sy[i * N + t] = Math.sin(ay); cy[i * N + t] = Math.cos(ay);
    }
  }
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      let v = 0;
      for (let i = 0; i < W; i++) v += amp[i] * (sx[i * N + x] * cy[i * N + y] + cx[i * N + x] * sy[i * N + y]);   // sin(a + b)
      const g = (v / tot) * 0.5 + 0.5, o = (y * N + x) * 4;
      d[o] = d[o + 1] = d[o + 2] = g * 255; d[o + 3] = 255;
    }
    if (y % 64 === 0) yield;
  }
  return d;
}

export interface LavaBufs { c: Uint8ClampedArray; h: Uint8ClampedArray; e: Uint8Array }

/** Lava: dark crust plates (k0/k1) split by glowing cracks (k2 → k3 at the hottest). Emissive rows flipped like post.ts. */
export function* lava(S: number, k: RGB[], seed: number): Generator<void, LavaBufs> {
  const G = 7, pts = new Float32Array(G * G * 2);
  for (let j = 0; j < G; j++) for (let i = 0; i < G; i++) { pts[(j * G + i) * 2] = (i + 0.15 + hash2(i, j, seed) * 0.7) / G; pts[(j * G + i) * 2 + 1] = (j + 0.15 + hash2(i, j, seed + 1) * 0.7) / G; }
  const n = yield* fbmGen(new Float32Array(S * S), S, 8, 4, seed + 3);
  const c = new Uint8ClampedArray(S * S * 4), h = new Uint8ClampedArray(S * S * 4), e = new Uint8Array(S * S * 4);
  const [c0, c1, c2, c3] = k;
  for (let y = 0; y < S; y++) {
    const v = (y + 0.5) / S, cy = Math.floor(v * G);
    for (let x = 0; x < S; x++) {
      const u = (x + 0.5) / S, cx = Math.floor(u * G);
      let f1 = 9, f2 = 9, id = 0;
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        const ii = (cx + di + G) % G, jj = (cy + dj + G) % G;
        const px = pts[(jj * G + ii) * 2] + Math.floor((cx + di) / G) , py = pts[(jj * G + ii) * 2 + 1] + Math.floor((cy + dj) / G);
        const dx = px - u, dy = py - v, d = dx * dx + dy * dy;
        if (d < f1) { f2 = f1; f1 = d; id = jj * G + ii; } else if (d < f2) f2 = d;
      }
      const i = y * S + x, nv = n[i];
      const edge = Math.sqrt(f2) - Math.sqrt(f1);   // 0 on the crack
      const w = 0.012 + 0.02 * nv;
      const crackT = Math.max(0, 1 - edge / w), heat = Math.min(1, crackT * 1.4) * (0.7 + 0.3 * nv);
      const plate = Math.min(1, edge / 0.06), tone = hash2(id, 3, seed);
      const crust = tone < 0.5 ? c0 : c1, cr = 0.75 + 0.35 * nv;
      const hot: RGB = [c2[0] + (c3[0] - c2[0]) * heat, c2[1] + (c3[1] - c2[1]) * heat, c2[2] + (c3[2] - c2[2]) * heat];
      const o = i * 4;
      for (let q = 0; q < 3; q++) c[o + q] = crust[q] * cr * (1 - crackT) + hot[q] * crackT;
      c[o + 3] = 255;
      const hv = (0.15 + 0.75 * Math.sqrt(plate)) * (1 - crackT) + 0.08 * nv;
      h[o] = h[o + 1] = h[o + 2] = hv * 255; h[o + 3] = 255;
      const fo = ((S - 1 - y) * S + x) * 4, eg = Math.pow(crackT, 1.5) + 0.06 * (1 - plate) * nv;
      for (let q = 0; q < 3; q++) e[fo + q] = Math.min(255, hot[q] * eg); e[fo + 3] = 255;
    }
    if (y % 32 === 0) yield;
  }
  return { c, h, e };
}
