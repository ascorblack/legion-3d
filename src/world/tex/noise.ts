/**
 * Tileable value noise (pure, no DOM): fbm fields for the texture generators and the shared world-space macro-noise
 * texture of the surface shader (surface.ts). Everything wraps at the field size, so tiles stay seamless.
 */

/** xorshift32 → [0, 1). */
export function rng(seed: number): () => number {
  let s = (seed >>> 0) || 1;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
}

/** Integer hash → [0, 1). */
export function hash2(x: number, y: number, seed = 0): number {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(seed | 0, 1442695041)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/**
 * Fill `out` (N×N, row-major) with tileable fbm value noise: `cells` lattice cells across at the first octave,
 * `oct` octaves (×2 frequency, ×gain amplitude). Result normalised to 0..1.
 */
export function fbm(out: Float32Array, N: number, cells: number, oct: number, seed: number, gain = 0.5): Float32Array {
  const g = fbmGen(out, N, cells, oct, seed, gain);
  for (;;) { const s = g.next(); if (s.done) return s.value; }
}

/** fbm as a time-sliceable generator (yields every 64 rows). */
export function* fbmGen(out: Float32Array, N: number, cells: number, oct: number, seed: number, gain = 0.5): Generator<void, Float32Array> {
  out.fill(0);
  let amp = 1, total = 0;
  for (let o = 0; o < oct; o++) {
    const c = cells << o;
    if (c > N) break;
    const lat = new Float32Array(c * c);
    for (let i = 0; i < c * c; i++) lat[i] = hash2(i % c, (i / c) | 0, seed * 31 + o * 7919);
    const k = c / N;
    for (let y = 0; y < N; y++) {
      const fy = y * k, y0 = fy | 0, ty = fy - y0, sy = ty * ty * (3 - 2 * ty), r0 = (y0 % c) * c, r1 = ((y0 + 1) % c) * c;
      for (let x = 0; x < N; x++) {
        const fx = x * k, x0 = fx | 0, tx = fx - x0, sx = tx * tx * (3 - 2 * tx), c0 = x0 % c, c1 = (x0 + 1) % c;
        const a = lat[r0 + c0] + (lat[r0 + c1] - lat[r0 + c0]) * sx;
        const b = lat[r1 + c0] + (lat[r1 + c1] - lat[r1 + c0]) * sx;
        out[y * N + x] += (a + (b - a) * sy) * amp;
      }
      if ((y & 63) === 63) yield;
    }
    total += amp; amp *= gain;
  }
  let mn = Infinity, mx = -Infinity;
  for (let i = 0; i < out.length; i++) { const v = out[i] / total; out[i] = v; if (v < mn) mn = v; if (v > mx) mx = v; }
  const d = mx - mn || 1;
  for (let i = 0; i < out.length; i++) out[i] = (out[i] - mn) / d;
  return out;
}

/**
 * RGBA macro-noise for the surface shader, N×N tileable, one fetch = four scales:
 * R = 4 cells (world ≈ 6 m features at the 24 m projection), G = 16 cells (≈ 1.5 m), B = 48 cells (≈ 0.5 m),
 * A = 8 cells, independent seed (anti-tiling selector).
 */
export function macroNoiseData(N = 256): Uint8Array {
  const out = new Uint8Array(N * N * 4), f = new Float32Array(N * N);
  const chans: [number, number, number][] = [[4, 4, 11], [16, 3, 23], [48, 2, 37], [8, 3, 51]];
  chans.forEach(([cells, oct, seed], c) => {
    fbm(f, N, cells, oct, seed);
    for (let i = 0; i < N * N; i++) out[i * 4 + c] = Math.round(f[i] * 255);
  });
  return out;
}
