/**
 * Procedural texture pipeline (tex/): quality-scaled sizes, post-processing (normals, element ids, seamless wrap,
 * mean-preserving AO) and the surface-detail shader patch (chains with the light pools, nothing at q0).
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { stubDom } from './dom-stub';
import * as THREE from 'three';
import { texSize, TEX_KINDS, getTexture } from '../src/world/tex';
import { post, chamfer } from '../src/world/tex/post';
import { macroNoiseData, fbm } from '../src/world/tex/noise';
import { surfaceDetail, configureSurface, setSurfaceQuality } from '../src/world/tex/surface';
import { PoolLights } from '../src/world/lightPools';

const run = <T>(g: Generator<void, T>): T => { for (;;) { const s = g.next(); if (s.done) return s.value; } };

beforeAll(() => stubDom());

describe('tex sizes', () => {
  it('scale with the quality level; only hero kinds reach 2048', () => {
    expect([0, 1, 2, 3].map((q) => texSize('cobble', q, 1024))).toEqual([256, 512, 1024, 2048]);
    expect([0, 1, 2, 3].map((q) => texSize('brick', q))).toEqual([128, 256, 512, 1024]);
    expect(texSize('basalt', 3)).toBe(1024);
    for (const k of TEX_KINDS) for (const q of [0, 1, 2, 3]) {
      const s = texSize(k, q);
      expect(s & (s - 1), k).toBe(0);
      expect(s, k).toBeLessThanOrEqual(2048);
      expect(s, k).toBeGreaterThanOrEqual(64);
    }
  });
  it('every kind builds a map + normal + roughness (lava also an emissive map)', () => {
    for (const k of TEX_KINDS) {
      const t = getTexture(k, { seed: 3 });
      expect(t.map, k).toBeTruthy();
      if (k === 'glow') continue;
      expect(t.normalMap?.colorSpace, k).toBe(THREE.NoColorSpace);
      expect(t.roughnessMap, k).toBeTruthy();
      expect(!!t.emissiveMap, k).toBe(k === 'lava');
    }
  });
});

describe('tex post', () => {
  const N = 64;
  /** Two elements (left / right half, 4-px joints round both); colour mid-grey; detail flat. */
  function scene() {
    const c = new Uint8ClampedArray(N * N * 4).fill(160), h = new Uint8ClampedArray(N * N * 4).fill(128), id = new Uint8ClampedArray(N * N * 4);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const o = (y * N + x) * 4, inY = y >= 4 && y < N - 4, left = x >= 4 && x < 28, right = x >= 36 && x < 60;
      if (inY && (left || right)) { id[o] = left ? 64 : 192; id[o + 1] = 255; id[o + 2] = 128; }
    }
    return { c, h, id };
  }
  it('writes element centres + mask into the roughness map, joints get mask 0', () => {
    const { c, h, id } = scene();
    const o = run(post(N, N, c, h, id, { mode: 'dist', bevel: 0.08, rough: [0.6, 1], normal: 2, ids: true, jointAO: 0.3, elemVar: 0.1 }, 1));
    const at = (x: number, y: number) => ((N - 1 - y) * N + x) * 4;   // rows are flipped (v up)
    expect(o.rough[at(16, 32) + 3]).toBe(255);
    expect(o.rough[at(16, 32)]).toBe(64);
    expect(o.rough[at(48, 32)]).toBe(192);
    expect(o.rough[at(32, 32) + 3]).toBe(0);
    // element tops are smoother than the joints
    expect(o.rough[at(16, 32) + 1]).toBeLessThan(o.rough[at(32, 32) + 1]);
    // flat element top → straight-up normal; bevel → tilted
    expect(o.normal[at(16, 32) + 2]).toBeGreaterThan(250);
    expect(Math.abs(o.normal[at(5, 32)] - 128)).toBeGreaterThan(10);
  });
  it('keeps the albedo mean (AO adds contrast, not darkness) and stays seamless', () => {
    const { c, h, id } = scene();
    const o = run(post(N, N, c, h, id, { mode: 'dist', bevel: 0.08, rough: [0.6, 1], normal: 2, ids: true, jointAO: 0.35, cavity: 0.4, grain: 0 }, 1));
    let m = 0; for (let i = 0; i < N * N; i++) m += o.map[i * 4];
    expect(m / (N * N)).toBeGreaterThan(160 * 0.97);
    // normal map continuous across the wrap: column 0 vs column N-1 differ no more than neighbouring columns do
    let seam = 0, inner = 0;
    for (let y = 0; y < N; y++) { const a = y * N * 4; seam += Math.abs(o.normal[a] - o.normal[a + (N - 1) * 4]); inner += Math.abs(o.normal[a + 4] - o.normal[a]); }
    expect(seam).toBeLessThanOrEqual(inner + N * 8);
  });
  it('macro noise is tileable and spans the range', () => {
    const f = fbm(new Float32Array(64 * 64), 64, 4, 3, 7);
    let seam = 0; for (let y = 0; y < 64; y++) seam = Math.max(seam, Math.abs(f[y * 64] - f[y * 64 + 63]));
    expect(seam).toBeLessThan(0.15);
    const d = macroNoiseData(32);
    expect(Math.max(...d)).toBeGreaterThan(200);
    expect(Math.min(...d)).toBeLessThan(55);
  });
});

describe('surface detail shader', () => {
  const compile = (m: THREE.Material) => {
    const sh = { vertexShader: THREE.ShaderLib.physical.vertexShader, fragmentShader: THREE.ShaderLib.physical.fragmentShader, uniforms: {} } as unknown as THREE.WebGLProgramParametersWithUniforms;
    m.onBeforeCompile(sh, null as unknown as THREE.WebGLRenderer);
    return sh;
  };
  const mat = () => {
    const m = new THREE.MeshStandardMaterial({ vertexColors: true });
    m.map = new THREE.Texture(); m.roughnessMap = new THREE.Texture(); m.normalMap = new THREE.Texture();
    return m;
  };
  it('patches at q2 (ids, grime, wet) and chains with the light pools', () => {
    configureSurface({ quality: 2, wallZ: 6, lowH: -1.4 });
    const m = mat();
    surfaceDetail(m, { ids: 0.2, dirt: 0.6, moss: 0.3, wet: 0.4 });
    new PoolLights([], 6, -1.4).patch(m, {});
    const sh = compile(m);
    expect(sh.fragmentShader).toContain('texelFetch(roughnessMap');
    expect(sh.fragmentShader).toContain('uSdDirt');
    expect(sh.fragmentShader).toContain('uL3dP');            // the pools' block is still there
    expect(sh.vertexShader).toContain('vSdW = ');
    expect(sh.vertexShader).toContain('vL3dW = ');
    expect((sh.uniforms as Record<string, unknown>).uSdNoise).toBeTruthy();
    expect(m.customProgramCacheKey()).toContain('sd2');
  });
  it('anti-tiles organic kinds only when asked; q0 leaves the material plain', () => {
    configureSurface({ quality: 2 });
    const a = mat(); surfaceDetail(a, { antiTile: true });
    expect(compile(a).fragmentShader).toContain('SD_AT(map');
    setSurfaceQuality(0);
    const b = mat(); surfaceDetail(b, { ids: 0.2, dirt: 0.5 });
    const sh = compile(b);
    expect(sh.fragmentShader).not.toContain('sdNz');
    expect(b.customProgramCacheKey()).toContain('sd0');
    setSurfaceQuality(2);
  });
});

describe('chamfer distance (post.ts)', () => {
  /** Straight transcription of the 3-4 chamfer, the reference for the restructured (Maglev-safe) loops. */
  const ref = (mask: Uint8Array, N: number): Float32Array => {
    const INF = 1e9, out = new Float32Array(N * N);
    for (let i = 0; i < N * N; i++) out[i] = mask[i] ? INF : 0;
    for (let round = 0; round < 2; round++) {
      for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
        let d = out[y * N + x]; if (d === 0) continue;
        const ym = ((y - 1 + N) % N) * N, xm = (x - 1 + N) % N, xp = (x + 1) % N;
        d = Math.min(d, out[y * N + xm] + 3, out[ym + x] + 3, out[ym + xm] + 4, out[ym + xp] + 4); out[y * N + x] = d;
      }
      for (let y = N - 1; y >= 0; y--) for (let x = N - 1; x >= 0; x--) {
        let d = out[y * N + x]; if (d === 0) continue;
        const yp = ((y + 1) % N) * N, xm = (x - 1 + N) % N, xp = (x + 1) % N;
        d = Math.min(d, out[y * N + xp] + 3, out[yp + x] + 3, out[yp + xp] + 4, out[yp + xm] + 4); out[y * N + x] = d;
      }
    }
    for (let i = 0; i < N * N; i++) out[i] = out[i] >= INF ? N : out[i] / 3;
    return out;
  };
  it('matches the reference on random masks, and an all-element mask gives N', () => {
    for (const N of [16, 64, 130]) {
      const m = new Uint8Array(N * N); let s = 12345 + N;
      for (let i = 0; i < m.length; i++) { s = (s * 1664525 + 1013904223) >>> 0; m[i] = (s >>> 24) < 200 ? 1 : 0; }
      const out = new Float32Array(N * N);
      run(chamfer(m, N, out));
      expect(Array.from(out)).toEqual(Array.from(ref(m, N)));
    }
    const all = new Uint8Array(32 * 32).fill(1), o2 = new Float32Array(32 * 32);
    run(chamfer(all, 32, o2));
    expect(o2.every((v) => v === 32)).toBe(true);
  });
});
