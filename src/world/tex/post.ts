/**
 * Pixel post-processing of a painted texture (pure typed arrays, no DOM — runs in node tests too).
 * Inputs: the colour canvas (S×S), a height/detail canvas and an element-id canvas (hs×hs, hs ≤ S).
 * Outputs (rows flipped: row 0 = v 0, ready for a DataTexture with flipY = false):
 *  - map: albedo × baked AO (cavity + joints), worn edge highlights, per-element tone, fine grain;
 *  - normal: tangent-space normal map (Sobel of the final height);
 *  - rough: G = roughness (×material.roughness); with `ids`: R/B = the element's centre (u, v in the tile), A = element mask —
 *    the surface shader turns that into a per-element-per-tile tint (anti-tiling, surface.ts).
 * Element height (`mode: 'dist'`) comes from a toroidal chamfer distance to the joints: rounded or chamfered bevels of
 * any painted shape, with the painted H as detail on top. `mode: 'paint'` uses the painted H as the height itself.
 * Every heavy loop yields every few rows: the generator is time-sliced by the texture scheduler (index.ts).
 */
import { hash2, fbmGen } from './noise';

export interface PostCfg {
  mode: 'dist' | 'paint';
  /** Bevel width as a fraction of the tile (dist mode). */
  bevel?: number;
  profile?: 'round' | 'chamfer';
  /** Element top height range (dist mode, per element). */
  top?: [number, number];
  /** Joint (mortar) height (dist mode). */
  joint?: number;
  /** Amplitude of the painted detail height around 0.5 (dist mode). */
  detail?: number;
  /** Box-blur radius (px at hs = 512) of the height before normals (soft steps of painted shapes). */
  smooth?: number;
  /** Albedo darkening in cavities (blurred height − height). */
  cavity?: number;
  /** Albedo darkening of the joints and the foot of each element's bevel (dist mode). */
  jointAO?: number;
  /** Light worn edges on the bevel shoulders (dist mode). */
  wear?: number;
  /** Per-pixel albedo grain (±). */
  grain?: number;
  /** Per-element albedo brightness variation (±, baked; the shader adds a per-tile one on top). */
  elemVar?: number;
  /** Roughness at the top / in the joints (low height). */
  rough: [number, number];
  roughVar?: number;
  /** Normal strength (calibrated at 512 px; scaled with the resolution so every size looks the same). */
  normal: number;
  /** Write element centres + mask into the roughness map. */
  ids?: boolean;
  /** Final mean albedo per channel (0..255): organic grounds keep the palette's colour whatever the painting did. */
  target?: [number, number, number];
}

export interface PostOut { map: Uint8Array; normal: Uint8Array; rough: Uint8Array; S: number; hs: number }

/** Dev: the section the last step ran (scheduler stats). */
export const phase = { at: '' };
const sat = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const sstep = (a: number, b: number, v: number) => { const t = sat((v - a) / (b - a)); return t * t * (3 - 2 * t); };
const ROWS = 48;

/** Toroidal box blur of a N×N field, in place (`tmp` same size). */
export function* boxBlur(f: Float32Array, tmp: Float32Array, N: number, R: number): Generator<void, void> {
  if (R < 1) return;
  const w = 2 * R + 1, inv = 1 / w;
  for (let y = 0; y < N; y++) {
    const o = y * N; let s = 0;
    for (let k = -R; k <= R; k++) s += f[o + ((k + N) % N)];
    for (let x = 0; x < N; x++) { tmp[o + x] = s * inv; s += f[o + ((x + R + 1) % N)] - f[o + ((x - R + N) % N)]; }
    if (y % (ROWS * 2) === 0) yield;
  }
  for (let x = 0; x < N; x++) {
    let s = 0;
    for (let k = -R; k <= R; k++) s += tmp[((k + N) % N) * N + x];
    for (let y = 0; y < N; y++) { f[y * N + x] = s * inv; s += tmp[((y + R + 1) % N) * N + x] - tmp[((y - R + N) % N) * N + x]; }
    if (x % (ROWS * 2) === 0) yield;
  }
}

/**
 * The pixel loops of the chamfer live in plain functions, NOT in the generator below. With all of them inline in the
 * `function*` frame, Chrome 147's concurrent Maglev compiler dies (the whole renderer process exits with SIGTRAP in a
 * ThreadPool worker, «Target crashed») as soon as the texture pass gets hot — the first room entered after the page
 * had been busy (AudioContext running). `--js-flags=--no-maglev` or `--no-maglev-untagged-phis` cure it; so does
 * moving these loops out. The generator only keeps the yields (test/world-tex.test.ts pins the result).
 */
function chamferRow(out: Float32Array, N: number, y: number, fwd: boolean): void {
  const o = y * N, yn = (((fwd ? y - 1 : y + 1) + N) % N) * N;
  for (let i = 0; i < N; i++) {
    const x = fwd ? i : N - 1 - i;
    const d0 = out[o + x]; if (d0 === 0) continue;
    const xm = (x - 1 + N) % N, xp = (x + 1) % N, xa = fwd ? xm : xp, xb = fwd ? xp : xm;
    out[o + x] = Math.min(d0, out[o + xa] + 3, out[yn + x] + 3, out[yn + xa] + 4, out[yn + xb] + 4);
  }
}

const CH_INF = 1e9;
function chamferInit(mask: Uint8Array, N: number, out: Float32Array): void { for (let i = 0; i < N * N; i++) out[i] = mask[i] ? CH_INF : 0; }
function chamferDone(N: number, out: Float32Array): void { for (let i = 0; i < N * N; i++) out[i] = out[i] >= CH_INF ? N : out[i] / 3; }

/** Toroidal chamfer (3-4) distance to the nearest non-mask pixel, in pixels. */
export function* chamfer(mask: Uint8Array, N: number, out: Float32Array): Generator<void, void> {
  chamferInit(mask, N, out);
  for (let round = 0; round < 2; round++) {
    for (let y = 0; y < N; y++) { chamferRow(out, N, y, true); if (y % ROWS === 0) yield; }
    for (let y = N - 1; y >= 0; y--) { chamferRow(out, N, y, false); if (y % ROWS === 0) yield; }
  }
  chamferDone(N, out);
}

/** Height field → RGBA tangent-space normal map (flipped rows), Sobel, wrapped. */
export function* normalMap(h: Float32Array, N: number, strength: number, out: Uint8Array): Generator<void, void> {
  for (let y = 0; y < N; y++) {
    const ym = ((y - 1 + N) % N) * N, y0 = y * N, yp = ((y + 1) % N) * N, orow = (N - 1 - y) * N;
    for (let x = 0; x < N; x++) {
      const xm = (x - 1 + N) % N, xp = (x + 1) % N;
      const dx = (h[ym + xp] + 2 * h[y0 + xp] + h[yp + xp]) - (h[ym + xm] + 2 * h[y0 + xm] + h[yp + xm]);
      const dy = (h[yp + xm] + 2 * h[yp + x] + h[yp + xp]) - (h[ym + xm] + 2 * h[ym + x] + h[ym + xp]);
      let nx = -dx * strength, ny = dy * strength, nz = 1;
      const l = 1 / Math.sqrt(nx * nx + ny * ny + 1); nx *= l; ny *= l; nz *= l;
      const o = (orow + x) * 4;
      out[o] = (nx * 0.5 + 0.5) * 255; out[o + 1] = (ny * 0.5 + 0.5) * 255; out[o + 2] = (nz * 0.5 + 0.5) * 255; out[o + 3] = 255;
    }
    if (y % ROWS === 0) yield;
  }
}

/**
 * The whole pass. `c`: S×S RGBA colour; `hd`: hs×hs RGBA height/detail (R used); `id`: hs×hs RGBA element ids
 * (R = centre u, G = mask, B = centre v) or null.
 */
export function* post(S: number, hs: number, c: Uint8ClampedArray, hd: Uint8ClampedArray, id: Uint8ClampedArray | null, cfg: PostCfg, seed: number): Generator<void, PostOut> {
  phase.at = 'post:init'; const N = hs * hs, sc = hs / 512;
  const h = new Float32Array(N), tmp = new Float32Array(N);
  for (let i = 0; i < N; i++) h[i] = hd[i * 4] / 255;
  const mask = new Uint8Array(N);
  if (id) for (let i = 0; i < N; i++) mask[i] = id[i * 4 + 1] > 200 ? 1 : 0;
  else mask.fill(1);
  const elemH = (i: number, s: number) => (id ? hash2(id[i * 4], id[i * 4 + 2], seed + s) : 0.5);
  const prof = new Float32Array(N);   // 0 in joints → 1 on element tops
  yield;
  if (cfg.mode === 'dist') {
    const dist = new Float32Array(N);
    phase.at = 'chamfer'; yield* chamfer(mask, hs, dist); phase.at = 'profile';
    const bw = Math.max(1, (cfg.bevel ?? 0.02) * hs), j = cfg.joint ?? 0.05, det = cfg.detail ?? 0.2, [t0, t1] = cfg.top ?? [0.8, 1];
    const round = cfg.profile !== 'chamfer';
    for (let i = 0; i < N; i++) {
      const t = Math.min(1, dist[i] / bw);
      const p = round ? Math.sqrt(1 - (1 - t) * (1 - t)) : sstep(0, 1, t);
      prof[i] = mask[i] ? p : 0;
      const top = t0 + (t1 - t0) * elemH(i, 1);
      h[i] = (mask[i] ? j + (top - j) * p : j) + (h[i] - 0.5) * det * (mask[i] ? 1 : 0.5);
      if ((i & 0xffff) === 0) yield;
    }
  } else {
    for (let i = 0; i < N; i++) prof[i] = h[i];
  }
  if (cfg.smooth) yield* boxBlur(h, tmp, hs, Math.max(1, Math.round(cfg.smooth * sc)));
  // cavity: blurred − sharp height (concave → positive)
  phase.at = 'blur'; const b = Float32Array.from(h);
  const R = Math.max(2, Math.round(hs / 64));
  yield* boxBlur(b, tmp, hs, R);
  yield* boxBlur(b, tmp, hs, R);
  const wearN = cfg.wear ? yield* fbmGen(new Float32Array(N), hs, Math.max(4, hs >> 4), 2, seed + 5) : null;
  phase.at = 'ao'; const ao = new Float32Array(N), wear = new Float32Array(N), ef = new Float32Array(N);
  const cav = cfg.cavity ?? 0.3, jao = cfg.jointAO ?? 0, wr = cfg.wear ?? 0, ev = cfg.elemVar ?? 0;
  for (let i = 0; i < N; i++) {
    let a = 1 - cav * sat((b[i] - h[i]) * 5);
    if (cfg.mode === 'dist') a *= mask[i] ? 1 - jao * (1 - sstep(0, 0.75, prof[i])) : 1 - jao;
    ao[i] = a;
    if (wearN && mask[i]) { const p = prof[i]; wear[i] = wr * sstep(0.25, 0.6, p) * (1 - sstep(0.75, 1, p)) * sstep(0.45, 0.75, wearN[i]); }
    ef[i] = mask[i] && ev ? 1 + ev * (elemH(i, 2) - 0.5) * 2 : 1;
    if ((i & 0x7fff) === 0) yield;
  }
  // normal + roughness (hs)
  phase.at = 'normal'; const normal = new Uint8Array(N * 4);
  yield* normalMap(h, hs, cfg.normal * sc, normal);
  phase.at = 'rough'; const rough = new Uint8Array(N * 4);
  const [r0, r1] = cfg.rough, rv = cfg.roughVar ?? 0.03;
  for (let y = 0; y < hs; y++) {
    const orow = (hs - 1 - y) * hs;
    for (let x = 0; x < hs; x++) {
      const i = y * hs + x, o = (orow + x) * 4;
      const p = cfg.mode === 'dist' ? prof[i] : h[i];
      let g = r0 + (r1 - r0) * (1 - sat(p)) + rv * ((wearN ? wearN[i] : hash2(x >> 2, y >> 2, seed + 9)) - 0.5) * 2;
      if (id && mask[i]) g += (elemH(i, 3) - 0.5) * 0.12;
      g = sat(g) * 255;
      if (cfg.ids && id) { rough[o] = id[i * 4]; rough[o + 1] = g; rough[o + 2] = id[i * 4 + 2]; rough[o + 3] = mask[i] ? 255 : 0; }
      else { rough[o] = rough[o + 1] = rough[o + 2] = g; rough[o + 3] = 255; }
    }
    if (y % ROWS === 0) yield;
  }
  // albedo (S)
  phase.at = 'map'; const map = new Uint8Array(S * S * 4), k = hs / S, gr = cfg.grain ?? 0.03;
  // mean-preserving: the baked AO adds contrast, not darkness (the palette's overall value is art-directed)
  let mOut = 0;
  for (let i = 0; i < N; i++) { mOut += ao[i] * ef[i]; }
  mOut /= N;
  const lift = Math.min(1.3, Math.max(1, 1 / Math.max(0.5, mOut)));
  for (let y = 0; y < S; y++) {
    const hy = ((y * k) | 0) * hs, orow = (S - 1 - y) * S;
    for (let x = 0; x < S; x++) {
      const j = hy + ((x * k) | 0), s = (y * S + x) * 4, o = (orow + x) * 4;
      const f = lift * ao[j] * ef[j] * (1 + gr * (hash2(x, y, seed) - 0.5) * 2), w = wear[j];
      for (let q = 0; q < 3; q++) { const v = Math.min(255, c[s + q] * f); map[o + q] = v + (255 - v) * w; }
      map[o + 3] = 255;
    }
    if (y % (ROWS / 2) === 0) yield;
  }
  if (cfg.target) {
    const m = [0, 0, 0], n = S * S;
    for (let i = 0; i < n; i++) { m[0] += map[i * 4]; m[1] += map[i * 4 + 1]; m[2] += map[i * 4 + 2]; }
    const f = m.map((v, q) => Math.min(1.6, Math.max(0.7, cfg.target![q] / Math.max(1, v / n))));
    yield;
    for (let i = 0; i < n; i++) for (let q = 0; q < 3; q++) map[i * 4 + q] = Math.min(255, map[i * 4 + q] * f[q]);
  }
  return { map, normal, rough, S, hs };
}
