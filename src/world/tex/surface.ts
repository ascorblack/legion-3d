/**
 * Surface detail for the tiled materials (onBeforeCompile; chains with any earlier patch, e.g. lightPools.ts):
 *  - macro variation: one fetch of a world-space RGBA noise (four scales, 24 m … 0.5 m) modulates brightness and a
 *    warm/cool shift → no two stretches of a wall or street look the same;
 *  - per-element per-tile tint (`ids`): the roughness map carries every stone's / brick's / board's centre; the shader
 *    finds the element's tile instance and gives it its own tone (texelFetch, exact), fading out where the texture is
 *    minified — the repeated tile no longer reads as a repeated pattern;
 *  - anti-tiling (`antiTile`, organic kinds only): two offset fetches of map / normal / roughness blended by noise;
 *  - grime: dirt colour rising from the ground on walls (height above the street level: upper street 0, lower street
 *    `lowH` beyond `wallZ`), broken up by noise; moss / damp on up-facing tops and the wall foot; wet glossy patches
 *    on floors (lower roughness, flatter normal, darker albedo).
 * Quality: q0 nothing (plain material), q1 macro + grime + moss (one extra fetch), q2+ everything.
 * All patched materials share one uniform set (`SURFACE.uniforms`), set per scene by `configureSurface`.
 */
import * as THREE from 'three';
import { macroNoiseData } from './noise';

export interface SurfaceOpts {
  /** Macro brightness variation (0..0.35). */
  macro?: number;
  /** Macro warm/cool shift (0..0.3). */
  hue?: number;
  /** Per-element per-tile brightness variation (needs a roughness map with ids). */
  ids?: number;
  /** 2-offset anti-tiling of map/normal/roughness (organic textures only). */
  antiTile?: boolean;
  /** Grime rising from the ground on side faces (0..1) and its height (m). */
  dirt?: number;
  dirtH?: number;
  /** Moss / damp patches on up-facing tops and the wall foot (0..1). */
  moss?: number;
  /** Wet glossy patches on up-facing surfaces (0..1). */
  wet?: number;
  /** Roughness variation from the noise (0..0.4). */
  roughVar?: number;
  /** Own ground model / colours (rooms, the mine: `surfaceUniforms({ lowH: 0 })`); default = the city's shared set. */
  uniforms?: SurfaceUniforms;
}
export type SurfaceUniforms = typeof SURFACE.uniforms;

let noiseTex: THREE.DataTexture | null = null;
function noise(): THREE.DataTexture {
  if (noiseTex) return noiseTex;
  const N = 256, t = new THREE.DataTexture(macroNoiseData(N), N, N, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.NoColorSpace;
  t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter; t.needsUpdate = true;
  return (noiseTex = t);
}

/** Shared uniforms of every patched material (one scene at a time). */
export const SURFACE = {
  uniforms: {
    uSdNoise: { value: null as THREE.Texture | null },
    uSdWallZ: { value: 1e6 },
    uSdLowH: { value: 0 },
    uSdDirt: { value: new THREE.Color('#5a4636') },
    uSdMoss: { value: new THREE.Color('#4f6a34') },
  },
  quality: 2,
};

/** A separate uniform set (a room or the mine: floor at y = 0, no lower street). */
export function surfaceUniforms(o: { lowH?: number; wallZ?: number; dirt?: THREE.ColorRepresentation; moss?: THREE.ColorRepresentation } = {}): SurfaceUniforms {
  return {
    uSdNoise: { value: noise() }, uSdWallZ: { value: o.wallZ ?? 1e6 }, uSdLowH: { value: o.lowH ?? 0 },
    uSdDirt: { value: new THREE.Color(o.dirt ?? '#5a4636') }, uSdMoss: { value: new THREE.Color(o.moss ?? '#4f6a34') },
  };
}

/** Scene ground model + grime / moss colours (linear multipliers / tints). */
export function configureSurface(o: { wallZ?: number; lowH?: number; dirt?: THREE.ColorRepresentation; moss?: THREE.ColorRepresentation; quality?: number }): void {
  const U = SURFACE.uniforms;
  U.uSdNoise.value = noise();
  if (o.wallZ !== undefined) U.uSdWallZ.value = o.wallZ;
  if (o.lowH !== undefined) U.uSdLowH.value = o.lowH;
  if (o.dirt !== undefined) U.uSdDirt.value.set(o.dirt);
  if (o.moss !== undefined) U.uSdMoss.value.set(o.moss);
  if (o.quality !== undefined) SURFACE.quality = o.quality;
}

declare const __DEV__: boolean;
// dev pages: inspect / tweak the shared uniforms from the console (window.__l3dSurface)
if (typeof __DEV__ !== 'undefined' && __DEV__ && typeof window !== 'undefined') (window as unknown as { __l3dSurface: typeof SURFACE }).__l3dSurface = SURFACE;

const patched = new Set<THREE.MeshStandardMaterial>();

/** Recompile every patched material for a new quality level. */
export function setSurfaceQuality(q: number): void {
  if (SURFACE.quality === q) return;
  SURFACE.quality = q;
  for (const m of patched) m.needsUpdate = true;
}

const f3 = (v: number) => v.toFixed(3);

/** Patch a MeshStandardMaterial (idempotent). Options are baked into the program (defines). */
export function surfaceDetail(m: THREE.Material, o: SurfaceOpts = {}): void {
  const sm = m as THREE.MeshStandardMaterial;
  if (!sm.isMeshStandardMaterial || sm.userData.l3dSurf) return;
  sm.userData.l3dSurf = true;
  patched.add(sm);
  if (!SURFACE.uniforms.uSdNoise.value) SURFACE.uniforms.uSdNoise.value = noise();
  const prev = sm.onBeforeCompile;
  const prevKey = sm.customProgramCacheKey?.bind(sm);
  const key = () => {
    const q = SURFACE.quality, ids = q >= 2 && (o.ids ?? 0) > 0 && !!sm.roughnessMap, at = q >= 2 && !!o.antiTile && !!sm.map;
    return { q, ids, at, s: `sd${q}|${o.uniforms ? 'own' : ''}|${ids ? 1 : 0}${at ? 1 : 0}|${o.macro}|${o.hue}|${o.ids}|${o.dirt}|${o.dirtH}|${o.moss}|${o.wet}|${o.roughVar}` };
  };
  sm.customProgramCacheKey = () => (prevKey ? prevKey() : '') + key().s;
  sm.onBeforeCompile = (sh, r) => {
    prev?.call(sm, sh, r);
    const { q, ids, at } = key();
    if (q <= 0) return;
    Object.assign(sh.uniforms, o.uniforms ?? SURFACE.uniforms);
    const wet = q >= 2 ? o.wet ?? 0 : 0;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vSdW;\nvarying vec3 vSdN;')
      .replace('#include <project_vertex>', `#include <project_vertex>
{
  vec4 sdw = vec4(transformed, 1.0);
  vec3 sdn = objectNormal;
  #ifdef USE_INSTANCING
    sdw = instanceMatrix * sdw; sdn = mat3(instanceMatrix) * sdn;
  #endif
  vSdW = (modelMatrix * sdw).xyz;
  vSdN = mat3(modelMatrix) * sdn;
}`);
    let frag = sh.fragmentShader.replace('#include <common>', `#include <common>
varying vec3 vSdW;
varying vec3 vSdN;
uniform sampler2D uSdNoise;
uniform float uSdWallZ;
uniform float uSdLowH;
uniform vec3 uSdDirt;
uniform vec3 uSdMoss;
float sdHash(vec2 p) { uvec2 q = uvec2(ivec2(floor(p))) * uvec2(1597334673u, 3812015801u); uint n = (q.x ^ q.y) * 1597334673u; return float(n) * (1.0 / 4294967296.0); }`);
    // noise + anti-tiling selector, before the albedo fetch
    const pre = `
vec3 sdNw = normalize(vSdN);
vec2 sdP = abs(sdNw.y) > 0.6 ? vSdW.xz : (abs(sdNw.x) > abs(sdNw.z) ? vSdW.zy : vSdW.xy);
vec4 sdNz = texture2D(uSdNoise, sdP * (1.0 / 24.0));
float sdHgt = vSdW.y - (vSdW.z > uSdWallZ ? uSdLowH : 0.0);
float sdSide = 1.0 - smoothstep(0.5, 0.8, abs(sdNw.y));
float sdUp = smoothstep(0.65, 0.92, sdNw.y);
float sdWet = ${f3(wet)} * smoothstep(0.63, 0.69, sdNz.r * 0.6 + sdNz.g * 0.4) * sdUp;
${at ? `
float sdK = sdNz.a * 7.0, sdF = fract(sdK), sdI = floor(sdK);
vec2 sdOa = sin(vec2(3.0, 7.0) * sdI), sdOb = sin(vec2(3.0, 7.0) * (sdI + 1.0));
float sdBw = smoothstep(0.4, 0.6, sdF);
#define SD_AT(tex, uv) mix(textureGrad(tex, (uv) + sdOa, dFdx(uv), dFdy(uv)), textureGrad(tex, (uv) + sdOb, dFdx(uv), dFdy(uv)), sdBw)
` : ''}`;
    frag = frag.replace('#include <map_fragment>', pre + (at
      ? `#ifdef USE_MAP
  diffuseColor *= SD_AT(map, vMapUv);
#endif`
      : '#include <map_fragment>'));
    // albedo: per-element tint, macro, grime, moss, wet darkening (after the vertex colours)
    const idsCode = ids ? `
{
  vec2 sdUv = vRoughnessMapUv;
  ivec2 sdSz = textureSize(roughnessMap, 0);
  vec2 sdFr = fract(sdUv);
  vec4 sdId = texelFetch(roughnessMap, min(ivec2(sdFr * vec2(sdSz)), sdSz - 1), 0);
  vec2 sdG = sdUv * vec2(sdSz);
  float sdFade = 1.0 - smoothstep(6.0, 16.0, max(length(dFdx(sdG)), length(dFdy(sdG))));   // an element stays several px wide until here (no sparkle)
  if (sdId.a > 0.9 && sdFade > 0.0) {
    vec2 sdD = sdId.rb - sdFr; sdD -= floor(sdD + 0.5);
    vec2 sdA = floor((sdUv + sdD) * 255.0 + 0.5);
    // half per element, half the 1.5 m noise: neighbouring elements drift together (clusters, not speckle)
    float sdV = (sdHash(sdA) * 2.0 - 1.0) * 0.55 + (sdNz.g - 0.5) * 0.9, sdV2 = sdHash(sdA + 17.0) - 0.5;
    diffuseColor.rgb *= 1.0 + ${f3(o.ids ?? 0)} * sdFade * sdV;
    diffuseColor.rgb *= 1.0 + vec3(0.12, 0.0, -0.12) * sdV2 * sdFade * ${f3((o.ids ?? 0) * 2)};
  }${(o.moss ?? 0) > 0 ? `
  else if (sdId.a < 0.1 && sdFade > 0.0) {   // moss / weeds in the joints, in patches
    float sdJm = ${f3(Math.min(1, (o.moss ?? 0) * 2.2))} * sdFade * smoothstep(0.45, 0.62, sdNz.g * 0.5 + sdNz.b * 0.5) * max(sdUp, sdSide * (1.0 - smoothstep(0.0, 1.2, sdHgt)));
    diffuseColor.rgb = mix(diffuseColor.rgb, uSdMoss * (0.6 + 0.8 * dot(diffuseColor.rgb, vec3(0.3333))), sdJm);
  }` : ''}
}` : '';
    frag = frag.replace('#include <color_fragment>', `#include <color_fragment>
${idsCode}
diffuseColor.rgb *= 1.0 + ${f3(o.macro ?? 0.12)} * ((sdNz.r - 0.5) * 1.3 + (sdNz.g - 0.5) * 0.7);
diffuseColor.rgb *= 1.0 + vec3(0.1, 0.0, -0.1) * ${f3(o.hue ?? 0.1)} * (sdNz.g - 0.5) * 2.0;
{
  float sdD = ${f3(o.dirt ?? 0)} * sdSide * (1.0 - smoothstep(0.0, ${f3(o.dirtH ?? 0.9)} * (0.55 + 0.9 * sdNz.b), sdHgt));
  // grime: towards a muddy, desaturated tone of the same value (reads at night too), slightly darker
  vec3 sdDt = mix(vec3(1.0), uSdDirt / max(1e-3, dot(uSdDirt, vec3(0.3333))), 0.55);
  diffuseColor.rgb = mix(diffuseColor.rgb, dot(diffuseColor.rgb, vec3(0.3333)) * sdDt * 0.8, clamp(sdD, 0.0, 1.0));
  float sdM = ${f3(o.moss ?? 0)} * smoothstep(0.52, 0.72, sdNz.g * 0.55 + sdNz.b * 0.45) * max(sdUp, sdSide * (1.0 - smoothstep(0.0, 0.9, sdHgt)));
  diffuseColor.rgb = mix(diffuseColor.rgb, uSdMoss * (0.45 + 0.9 * dot(diffuseColor.rgb, vec3(0.3333))), clamp(sdM, 0.0, 1.0));
  diffuseColor.rgb *= 1.0 - 0.28 * sdWet;
}`);
    frag = frag.replace('#include <roughnessmap_fragment>', (at
      ? `float roughnessFactor = roughness;
#ifdef USE_ROUGHNESSMAP
  roughnessFactor *= SD_AT(roughnessMap, vRoughnessMapUv).g;
#endif`
      : '#include <roughnessmap_fragment>') + `
roughnessFactor *= 1.0 + ${f3(o.roughVar ?? 0.2)} * (sdNz.b - 0.5) * 2.0;
roughnessFactor = mix(roughnessFactor, 0.16, sdWet);`);
    if (at) frag = frag.replace('vec3 mapN = texture2D( normalMap, vNormalMapUv ).xyz * 2.0 - 1.0;', 'vec3 mapN = SD_AT(normalMap, vNormalMapUv).xyz * 2.0 - 1.0;');
    frag = frag.replace('mapN.xy *= normalScale;', 'mapN.xy *= normalScale * (1.0 - 0.8 * sdWet);');
    sh.fragmentShader = frag;
  };
  sm.needsUpdate = true;
}

/** Forget a disposed material (keeps the quality-recompile list small). */
export function surfaceForget(m: THREE.Material): void { patched.delete(m as THREE.MeshStandardMaterial); }
