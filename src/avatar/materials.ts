/**
 * Shared materials for avatars: cel (toon) vertex-coloured material, inverted-hull outline, ghost variants,
 * quantised alpha levels (fade-in) so a crowd never clones materials per character.
 */
import * as THREE from 'three';
import { INK } from './geom';

/** Global animation clock for shader-driven effects (auras). Updated by any avatar's update(). */
export const uTime = { value: 0 };

let gradient: THREE.DataTexture | null = null;
function gradientMap(): THREE.DataTexture {
  if (gradient) return gradient;
  // 4-step ramp: deep shade, shade, lit, highlight — the "cel" look
  const d = new Uint8Array([120, 120, 120, 255, 178, 178, 178, 255, 236, 236, 236, 255, 255, 255, 255, 255]);
  gradient = new THREE.DataTexture(d, 4, 1, THREE.RGBAFormat);
  gradient.minFilter = gradient.magFilter = THREE.NearestFilter;
  gradient.generateMipmaps = false; gradient.needsUpdate = true;
  return gradient;
}

export const ALPHA_LEVELS = 8;
/** Quantise 0..1 → 0..ALPHA_LEVELS (ALPHA_LEVELS = opaque). */
export const alphaLevel = (a: number) => Math.max(0, Math.min(ALPHA_LEVELS, Math.round(a * ALPHA_LEVELS)));

const cache = new Map<string, THREE.Material>();
function cached<T extends THREE.Material>(key: string, make: () => T): T {
  let m = cache.get(key) as T | undefined;
  if (!m) { m = make(); cache.set(key, m); }
  return m;
}

export type Variant = 'n' | 'g' | 'vm';   // normal, ghost, view-model (drawn last, transparent queue)

function applyAlpha(m: THREE.Material, v: Variant, lvl: number, base = 1) {
  const a = (lvl / ALPHA_LEVELS) * base;
  if (v === 'vm') { m.transparent = true; m.depthWrite = true; m.opacity = 1; return; }
  if (a < 0.999) { m.transparent = true; m.opacity = a; m.depthWrite = v !== 'g' && a > 0.7; }
}

/** Cel material with vertex colours (body, limbs, gear — everything of a character in one material). */
export function toonMat(v: Variant = 'n', lvl = ALPHA_LEVELS): THREE.MeshToonMaterial {
  return cached(`toon|${v}|${lvl}`, () => {
    const m = new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: gradientMap() });
    if (v === 'g') { m.color.set('#bcd8ff'); m.emissive.set('#3a5a8a'); m.transparent = true; m.opacity = 0.55 * lvl / ALPHA_LEVELS; m.depthWrite = false; }
    else applyAlpha(m, v, lvl);
    m.name = `avatar-toon-${v}-${lvl}`;
    return m;
  });
}

/** Unlit-ish material for the face decal (texture with alpha). */
export function faceMat(tex: THREE.Texture, key: string, v: Variant = 'n', lvl = ALPHA_LEVELS): THREE.MeshToonMaterial {
  return cached(`face|${key}|${v}|${lvl}`, () => {
    const m = new THREE.MeshToonMaterial({ map: tex, transparent: true, alphaTest: 0.08, gradientMap: gradientMap(), depthWrite: false });
    m.polygonOffset = true; m.polygonOffsetFactor = -2; m.polygonOffsetUnits = -2;
    if (v === 'g') { m.color.set('#cfe2ff'); m.opacity = 0.7 * lvl / ALPHA_LEVELS; }
    else if (v !== 'vm' && lvl < ALPHA_LEVELS) m.opacity = lvl / ALPHA_LEVELS;
    return m;
  });
}

/**
 * Inverted-hull outline: back faces pushed along the (skinned) normal. Works for skinned and plain meshes.
 * Width grows a little with distance so far characters keep a visible contour.
 */
export function outlineMat(v: Variant = 'n', lvl = ALPHA_LEVELS, width = 0.012): THREE.MeshBasicMaterial {
  return cached(`outline|${v}|${lvl}|${width}`, () => {
    const m = new THREE.MeshBasicMaterial({ color: v === 'g' ? '#5b7fb8' : INK, side: THREE.BackSide });
    if (v === 'g') { m.transparent = true; m.opacity = 0.45 * lvl / ALPHA_LEVELS; m.depthWrite = false; }
    else applyAlpha(m, v, lvl);
    m.onBeforeCompile = (sh) => {
      sh.uniforms.uOutline = { value: width };
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uOutline;')
        // MeshBasicMaterial only computes objectNormal with skinning/envmap: compute ours explicitly
        .replace('#include <skinning_vertex>', `#include <skinning_vertex>
          vec3 oN = normal;
          #ifdef USE_SKINNING
            mat4 sM = bindMatrixInverse * ( skinWeight.x * boneMatX + skinWeight.y * boneMatY + skinWeight.z * boneMatZ + skinWeight.w * boneMatW ) * bindMatrix;
            oN = ( sM * vec4( normal, 0.0 ) ).xyz;
          #endif
          vec4 oMv = modelViewMatrix * vec4( transformed, 1.0 );
          float oW = uOutline * clamp( -oMv.z * 0.12, 1.0, 3.0 );
          transformed += normalize( oN ) * oW;`);
    };
    m.customProgramCacheKey = () => 'avatar-outline';
    return m;
  });
}

/** Additive soft particle material for auras (shared per kind). Positions animated in the shader from uTime. */
export function auraPointsMat(kind: string, color: string, size: number, rise: number): THREE.ShaderMaterial {
  // 'bats' (Halloween, doodle.js hwAura): dark bat silhouettes with a pale rim, flapping, circling over the head
  // (normal blending); 'jackglow': little orange pumpkins rising; everything else: additive sparkles rising
  const bats = kind === 'bats', jack = kind === 'jackglow';
  return cached(`aura|${kind}`, () => new THREE.ShaderMaterial({
    uniforms: { uTime, uColor: { value: new THREE.Color(color) }, uSize: { value: size }, uRise: { value: rise }, uOpacity: { value: 1 } },
    vertexShader: `
      attribute vec4 seed; uniform float uTime; uniform float uSize; uniform float uRise; varying float vA; varying float vFlap;
      void main() {
        vec3 p = position;
        ${bats ? `
        float a = uTime * (0.9 + seed.y * 0.6) * (seed.z > 0.5 ? 1.0 : -1.0) + seed.z * 6.2832;
        float r = length(position.xz);
        p = vec3(cos(a) * r, uRise + position.y * 0.5 + sin(uTime * 3.0 + seed.z * 9.0) * 0.06, sin(a) * r);
        vA = 1.0; vFlap = abs(sin(uTime * 14.0 + seed.z * 30.0));` : `
        float ph = fract(uTime / (1.6 + seed.w) + seed.z);
        p.y += ph * uRise;
        p.x += sin(uTime * 2.0 + seed.z * 20.0) * 0.04;
        vA = smoothstep(0.0, 0.2, ph) * (1.0 - smoothstep(0.65, 1.0, ph)); vFlap = 0.0;`}
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = uSize * (0.6 + seed.x) * 300.0 / max(0.5, -mv.z);
      }`,
    fragmentShader: `
      uniform vec3 uColor; uniform float uOpacity; varying float vA; varying float vFlap;
      void main() {
        vec2 d = gl_PointCoord - 0.5; d.y = -d.y;
        ${bats ? `
        // body ellipse + two scalloped wings whose tips go up/down with the flap
        float body = length(vec2(d.x * 3.2, (d.y - 0.02) * 2.2));
        float ax = abs(d.x), wy = (0.06 + 0.22 * vFlap) * ax * 2.0 - 0.02;
        float scal = 0.05 * abs(sin(ax * 28.0));
        float wing = step(ax, 0.46) * step(d.y, wy + 0.08) * step(wy - 0.1 + scal, d.y);
        float ear = step(abs(ax - 0.05), 0.02) * step(0.1, d.y) * step(d.y, 0.17);
        float inside = max(max(step(body, 0.25), wing), ear);
        if (inside < 0.5) discard;
        float rim = step(0.2, body) * step(body, 0.25);
        gl_FragColor = vec4(mix(uColor, vec3(0.94, 0.9, 1.0), rim * 0.8 + step(abs(d.y - wy - 0.07), 0.012) * wing * 0.6), uOpacity);` : jack ? `
        float r = length(vec2(d.x * 1.15, d.y));
        float a = (1.0 - smoothstep(0.2, 0.26, r)) * vA * uOpacity;
        float stem = step(abs(d.x), 0.03) * step(0.2, d.y) * step(d.y, 0.32);
        a = max(a, stem * vA * uOpacity);
        if (a < 0.01) discard;
        float rib = 0.75 + 0.25 * cos(d.x * 30.0);
        gl_FragColor = vec4(mix(uColor * rib, vec3(0.3, 0.5, 0.18), stem), a);` : `
        float r = length(d);
        float star = max(0.0, 1.0 - r * 2.0);
        float cross = max(0.0, 1.0 - abs(d.x) * 9.0) * max(0.0, 1.0 - abs(d.y) * 2.2) + max(0.0, 1.0 - abs(d.y) * 9.0) * max(0.0, 1.0 - abs(d.x) * 2.2);
        float a = (star * star + cross * 0.6) * vA * uOpacity;
        if (a < 0.01) discard;
        gl_FragColor = vec4(uColor * (0.8 + star), a);`}
      }`,
    transparent: !bats, depthWrite: bats, blending: bats || jack ? THREE.NormalBlending : THREE.AdditiveBlending,
  }));
}

/** Soft ground/back glow disc (additive, radial gradient texture). */
let glowTex: THREE.CanvasTexture | null = null;
export function glowMat(color: string, opacity: number, additive = true): THREE.MeshBasicMaterial {
  return cached(`glow|${color}|${opacity}|${additive}`, () => {
    if (!glowTex) {
      const c = document.createElement('canvas'); c.width = c.height = 64;
      const g = c.getContext('2d')!, gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
      gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.4, 'rgba(255,255,255,.55)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
      glowTex = new THREE.CanvasTexture(c); glowTex.colorSpace = THREE.SRGBColorSpace;
    }
    return new THREE.MeshBasicMaterial({ map: glowTex, color, transparent: true, opacity, depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending, side: THREE.DoubleSide });
  });
}

/** Simple emissive-ish material (halo rings, gems). */
export function glowSolidMat(color: string): THREE.MeshBasicMaterial {
  return cached(`solid|${color}`, () => new THREE.MeshBasicMaterial({ color }));
}

export function disposeMaterials() {
  for (const m of cache.values()) m.dispose();
  cache.clear();
}
