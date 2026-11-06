/**
 * Cheap "baked-looking" lighting for the city, injected into the standard materials with onBeforeCompile:
 *  - warm light pools from the N nearest light sources (lamps, lit windows, braziers…) — no real lights, one loop;
 *  - fake ambient occlusion at the foot of walls (height above the street level);
 *  - large-scale tint variation (breaks texture tiling) and a cool moonlight rim.
 * One shared uniform set; `PoolLights.update(cameraPos, dt)` re-picks the nearest sources every 0.2 s (no allocations).
 * Day / night (src/world/daynight.ts): `uL3dLit` scales the pools (lamps off by day), `uL3dDimK` the paving's darkening
 * between pools, `uL3dRim` is re-tinted; the defaults (1, 1, moon blue) are the night look — rooms never change them.
 */
import * as THREE from 'three';

export const POOL_N = 16;

export interface PoolOpts {
  /** macro tint variation amount (0..0.4) */
  vary?: number;
  /** fake AO at wall bases (0..1) */
  ao?: number;
  /** pool gain multiplier (peak pool light = candidate gain × this × albedo, soft-capped at ~1.25× albedo) */
  gain?: number;
  /** moon rim amount */
  rim?: number;
  /** ground contact darkening along the facade line (z≈0) and the foot of the retaining wall (0..1) */
  gao?: number;
  /** albedo multiplier for the ambient/moon lighting only (pools keep full albedo) → darker gaps between pools */
  dim?: number;
}

export class PoolLights {
  readonly uniforms = {
    uL3dP: { value: Array.from({ length: POOL_N }, () => new THREE.Vector4(0, -1000, 0, 1)) },
    uL3dC: { value: Array.from({ length: POOL_N }, () => new THREE.Vector3()) },
    uL3dN: { value: POOL_N },
    uL3dWallZ: { value: 1e6 },
    uL3dLowH: { value: 0 },
    uL3dRim: { value: new THREE.Color('#7f95ff') },
    uL3dLit: { value: 1 },
    uL3dDimK: { value: 1 },
  };
  /** candidates: x, y, z, radius, r, g, b, gain */
  private cand: Float32Array;
  private n: number;
  private best = new Int32Array(POOL_N);
  private bestD = new Float32Array(POOL_N);
  private timer = 0;
  private enabledN = POOL_N;

  constructor(cands: number[], wallZ: number, lowH: number) {
    this.cand = Float32Array.from(cands);
    this.n = Math.floor(cands.length / 8);
    this.uniforms.uL3dWallZ.value = wallZ;
    this.uniforms.uL3dLowH.value = lowH;
  }

  setCount(n: number): void { this.enabledN = Math.max(0, Math.min(POOL_N, n)); this.uniforms.uL3dN.value = this.enabledN; this.timer = 0; }

  /** Pick the nearest sources to a point slightly in front of the camera. */
  update(cx: number, cz: number, fx: number, fz: number, dt: number): void {
    this.timer -= dt;
    if (this.timer > 0) return;
    this.timer = 0.2;
    const N = this.enabledN, c = this.cand, best = this.best, bestD = this.bestD;
    const px = cx + fx * 5, pz = cz + fz * 5;
    for (let i = 0; i < N; i++) { best[i] = -1; bestD[i] = 1e12; }
    for (let i = 0; i < this.n; i++) {
      const dx = c[i * 8] - px, dz = c[i * 8 + 2] - pz;
      const d = dx * dx + dz * dz - c[i * 8 + 3] * c[i * 8 + 3] * 0.5;   // big pools win ties
      if (N === 0 || d >= bestD[N - 1]) continue;
      let j = N - 1;
      while (j > 0 && bestD[j - 1] > d) { bestD[j] = bestD[j - 1]; best[j] = best[j - 1]; j--; }
      bestD[j] = d; best[j] = i;
    }
    const P = this.uniforms.uL3dP.value, C = this.uniforms.uL3dC.value;
    for (let i = 0; i < POOL_N; i++) {
      const k = i < N ? best[i] : -1;
      if (k < 0) { P[i].set(0, -1000, 0, 1); C[i].set(0, 0, 0); continue; }
      const o = k * 8, g = c[o + 7];
      P[i].set(c[o], c[o + 1], c[o + 2], c[o + 3]);
      C[i].set(c[o + 4] * g, c[o + 5] * g, c[o + 6] * g);
    }
  }

  /** Patch a MeshStandardMaterial (or Physical) in place. */
  patch(m: THREE.Material, o: PoolOpts = {}): void {
    const sm = m as THREE.MeshStandardMaterial;
    if (!sm.isMeshStandardMaterial || sm.userData.l3dPool) return;
    sm.userData.l3dPool = true;
    const vary = (o.vary ?? 0.12).toFixed(3), ao = (o.ao ?? 0.45).toFixed(3), gain = (o.gain ?? 0.45).toFixed(3), rim = (o.rim ?? 0.22).toFixed(3), gao = (o.gao ?? 0).toFixed(3), dim = (o.dim ?? 1).toFixed(3);
    const U = this.uniforms;
    const prev = sm.onBeforeCompile;
    sm.onBeforeCompile = (sh, r) => {
      prev?.call(sm, sh, r);
      Object.assign(sh.uniforms, U);
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vL3dW;\nvarying vec3 vL3dNw;')
        .replace('#include <project_vertex>', `#include <project_vertex>
{
  vec4 l3dw = vec4(transformed, 1.0);
  vec3 l3dn = objectNormal;
  #ifdef USE_INSTANCING
    l3dw = instanceMatrix * l3dw; l3dn = mat3(instanceMatrix) * l3dn;
  #endif
  vL3dW = (modelMatrix * l3dw).xyz;
  vL3dNw = mat3(modelMatrix) * l3dn;
}`);
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>
varying vec3 vL3dW;
varying vec3 vL3dNw;
uniform vec4 uL3dP[${POOL_N}];
uniform vec3 uL3dC[${POOL_N}];
uniform int uL3dN;
uniform float uL3dWallZ;
uniform float uL3dLowH;
uniform vec3 uL3dRim;
uniform float uL3dLit;
uniform float uL3dDimK;`)
        .replace('#include <color_fragment>', `#include <color_fragment>
{
  vec3 nw = normalize(vL3dNw);
  float side = 1.0 - smoothstep(0.55, 0.85, abs(nw.y));
  // macro variation (two warped sines, ~6-12 m features) → breaks the tiling of every texture
  float mv = sin(vL3dW.x * 0.37 + sin(vL3dW.z * 0.21) * 2.3) + sin(vL3dW.z * 0.29 + sin(vL3dW.x * 0.17) * 2.1 + vL3dW.y * 0.3);
  float mv2 = sin(vL3dW.x * 1.31 + sin(vL3dW.z * 0.93) * 1.7) * sin(vL3dW.z * 1.17 + sin(vL3dW.x * 0.71) * 1.9);
  diffuseColor.rgb *= (1.0 + ${vary} * 0.5 * mv) * (1.0 + ${vary} * 0.6 * mv2 * (1.0 - side * 0.7));
  // fake AO: walls darken towards the street they stand on
  float gy = vL3dW.z > uL3dWallZ ? uL3dLowH : 0.0;
  float hh = vL3dW.y - gy;
  diffuseColor.rgb *= 1.0 - ${ao} * side * (1.0 - smoothstep(-0.1, 1.4, hh));
  float ga = vL3dW.z > uL3dWallZ ? smoothstep(uL3dWallZ, uL3dWallZ + 1.5, vL3dW.z) : smoothstep(-1.0, 1.1, vL3dW.z);
  diffuseColor.rgb *= 1.0 - ${gao} * (1.0 - ga);
}`)
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
{
  vec3 nw = normalize(vL3dNw);
  vec3 acc = vec3(0.0);
  for (int i = 0; i < ${POOL_N}; i++) {
    if (i >= uL3dN) break;
    vec4 p = uL3dP[i];
    vec3 d = p.xyz - vL3dW;
    float dd = dot(d, d);
    float a = max(0.0, 1.0 - dd / (p.w * p.w));
    a = a * a * (0.4 + 0.6 * a);   // windowed falloff, peak 1, brighter core (the old boost peaked at 2.2 → blown-out pools)
    float nl = clamp(dot(nw, d) * inversesqrt(dd + 1e-3) * 0.75 + 0.25, 0.0, 1.0);
    acc += uL3dC[i] * (a * nl);
  }
  // soft cap: overlapping pools never light a surface past ~1.25× its albedo (knee at 0.8)
  vec3 e = acc * (${gain} * uL3dLit);
  vec3 over = max(e - 0.8, 0.0);
  e = min(e, vec3(0.8)) + over / (1.0 + over / 0.45);
  totalEmissiveRadiance += diffuseColor.rgb * e;
  diffuseColor.rgb *= mix(1.0, ${dim}, uL3dDimK);
  // cool moon rim on silhouettes (view space)
  float fr = 1.0 - clamp(dot(normalize(normal), normalize(vViewPosition)), 0.0, 1.0);
  totalEmissiveRadiance += uL3dRim * (fr * fr * fr * ${rim}) * (0.35 + 0.65 * clamp(nw.y * 0.5 + 0.6, 0.0, 1.0));
}`);
    };
    const key = `l3dpool:${vary}:${ao}:${gain}:${rim}:${gao}:${dim}`;
    const prevKey = sm.customProgramCacheKey?.bind(sm);
    sm.customProgramCacheKey = () => (prevKey ? prevKey() : '') + key;
    sm.needsUpdate = true;
  }
}
