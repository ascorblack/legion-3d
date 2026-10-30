/**
 * Ground foliage of the city: grass tufts and flowering tufts in the cracks and edges (facade feet, around lamps and
 * planters, the ledge troughs, canal banks, wall feet; whole meadows in the hand villages), plus the shared GPU wind
 * sway for every leafy material (trees, bushes, beds, ivy).
 *
 * Cost: TWO instanced draws (grass, flowers). The spot list of the whole town stays on the CPU; only the spots within
 * a quality-scaled radius of the camera are copied into the instance buffers, and only after the camera has moved
 * a few metres (≈ 0.05 ms per refresh, no per-frame work besides two uniforms). Tufts fade (shrink) towards the
 * radius in the vertex shader — no popping. Quality: q0 off, q1 13 m, q2 18 m, q3 30 m. prefers-reduced-motion → still.
 */
import * as THREE from 'three';

/** Spot stride in the CPU list: x, y, z, rotY, scale, tint r, g, b, flower r, g, b (flower = −1: plain grass). */
export const SPOT = 11;

export interface FoliageOpts {
  /** Blade colours: base (dark) and tip (light). */
  base: string; tip: string;
}

const REDUCED = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Shared wind uniforms (one clock for grass, trees, bushes, ivy). */
export const WIND = { uWindT: { value: 0 }, uWindAmp: { value: REDUCED ? 0 : 1 } };

/**
 * Patch a lit material with GPU wind sway: vertices bend sideways by their height above the piece / instance origin
 * (local y for instanced kinds, world height for static leaf pieces), phase from the world position. `amp` = metres of
 * sway per metre of height (clamped), `from` = height where the bend starts.
 */
export function windPatch(m: THREE.Material, amp = 0.035, from = 0.25): void {
  const sm = m as THREE.MeshStandardMaterial;
  if (sm.userData.l3dWind) return;
  sm.userData.l3dWind = true;
  const prev = sm.onBeforeCompile;
  sm.onBeforeCompile = (sh, r) => {
    prev?.call(sm, sh, r);
    Object.assign(sh.uniforms, WIND);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uWindT;\nuniform float uWindAmp;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
{
  vec3 wo = vec3(0.0);
  #ifdef USE_INSTANCING
    wo = instanceMatrix[3].xyz;
    float wh = transformed.y;
  #else
    float wh = ${from.toFixed(3)} + 0.5;   // static pieces (world space): a gentle uniform shimmer
  #endif
  vec4 wp = modelMatrix * vec4(wo + transformed, 1.0);
  float bend = clamp(wh - ${from.toFixed(3)}, 0.0, 3.0) * ${amp.toFixed(4)} * uWindAmp;
  float ph = wp.x * 0.35 + wp.z * 0.21;
  float s = sin(uWindT * 1.3 + ph) * 0.7 + sin(uWindT * 2.9 + ph * 1.7) * 0.3;
  transformed.x += bend * s;
  transformed.z += bend * 0.45 * sin(uWindT * 1.7 + ph * 1.3);
}`);
  };
  const prevKey = sm.customProgramCacheKey?.bind(sm);
  sm.customProgramCacheKey = () => (prevKey ? prevKey() : '') + `|wind${amp}:${from}`;
  sm.needsUpdate = true;
}

/** One tuft: `n` single-triangle blades fanning out, base dark → tip light; optional flower head on the tallest. */
function tuftGeometry(n: number, flower: boolean, o: FoliageOpts, seed: number): THREE.BufferGeometry {
  let s = seed;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const pos: number[] = [], col: number[] = [], h01: number[] = [], fl: number[] = [];
  const cb = new THREE.Color(o.base), ct = new THREE.Color(o.tip);
  const tip = [0, 0, 0];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + rnd() * 0.8, r = 0.03 + rnd() * 0.05, w = 0.016 + rnd() * 0.012;   // slim blades (wide ones read as shards)
    const h = (flower && i === 0 ? 0.32 : 0.13 + rnd() * 0.13), lean = 0.05 + rnd() * 0.09;
    const cx = Math.cos(a) * r, cz = Math.sin(a) * r, px = -Math.sin(a) * w, pz = Math.cos(a) * w;
    pos.push(cx - px, 0, cz - pz, cx + px, 0, cz + pz, cx + Math.cos(a) * lean, h, cz + Math.sin(a) * lean);
    if (i === 0) { tip[0] = cx + Math.cos(a) * lean; tip[1] = h; tip[2] = cz + Math.sin(a) * lean; }
    for (let k = 0; k < 3; k++) { const c = k < 2 ? cb : ct; col.push(c.r, c.g, c.b); }
    h01.push(0, 0, h / 0.3); fl.push(0, 0, 0);
  }
  if (flower) {
    // a small four-petal head (two crossed diamonds = 4 tris) on the tall stem
    const a0 = rnd() * Math.PI, R = 0.05;
    for (const a of [a0, a0 + Math.PI / 2]) {
      const dx = Math.cos(a) * R, dz = Math.sin(a) * R;
      const c = tip;   // on the tall blade's tip
      pos.push(c[0] - dx, c[1], c[2] - dz, c[0], c[1] + R * 0.9, c[2], c[0] + dx, c[1], c[2] + dz);
      pos.push(c[0] - dx, c[1], c[2] - dz, c[0] + dx, c[1], c[2] + dz, c[0], c[1] - R * 0.6, c[2]);
      for (let k = 0; k < 6; k++) { col.push(1, 1, 1); h01.push(1.2); fl.push(1); }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('aH', new THREE.Float32BufferAttribute(h01, 1));
  g.setAttribute('aF', new THREE.Float32BufferAttribute(fl, 1));
  const nor = new Float32Array(pos.length); for (let i = 1; i < nor.length; i += 3) nor[i] = 1;   // lit like the ground they grow from
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.computeBoundingSphere();
  return g;
}

function tuftMaterial(): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0, side: THREE.DoubleSide });
  m.name = 'city:grass';
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, WIND, { uFolCam: FOL_CAM, uFolR: FOL_R });
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
attribute float aH; attribute float aF; attribute vec3 aTint; attribute vec3 aFlower;
uniform float uWindT; uniform float uWindAmp; uniform vec3 uFolCam; uniform float uFolR;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
{
  vec3 io = instanceMatrix[3].xyz;
  float d = length(io.xz - uFolCam.xz);
  transformed *= smoothstep(uFolR, uFolR * 0.72, d);           // shrink away towards the edge of the near set
  float ph = io.x * 0.43 + io.z * 0.27;
  float s = sin(uWindT * 1.6 + ph) * 0.65 + sin(uWindT * 3.7 + ph * 2.1) * 0.35;
  float b = aH * aH * 0.07 * uWindAmp;
  transformed.x += b * s; transformed.z += b * 0.5 * sin(uWindT * 2.2 + ph * 1.4);
}`)
      .replace('#include <color_vertex>', `#include <color_vertex>
  vColor.rgb = mix(vColor.rgb * aTint, aFlower, aF);`);
  };
  m.customProgramCacheKey = () => 'l3d-grass';
  return m;
}

const FOL_CAM = { value: new THREE.Vector3(0, 0, 0) };
const FOL_R = { value: 24 };
const RADIUS = [0, 13, 18, 30];
const CAP = [0, 1000, 2200, 5200];

export interface Foliage {
  group: THREE.Group;
  /** Materials to light like the city (lightPools patch). */
  materials: THREE.Material[];
  update(t: number, cam: THREE.Vector3): void;
  setQuality(q: number): void;
  /** Spots in the town (grass, flowers). */
  readonly total: [number, number];
  dispose(): void;
}

/** spots: SPOT floats per tuft (flower r < 0 → grass). */
export function createFoliage(spots: number[], o: FoliageOpts): Foliage {
  const all = Float32Array.from(spots), n = Math.floor(all.length / SPOT);
  let nG = 0; for (let i = 0; i < n; i++) if (all[i * SPOT + 8] < 0) nG++;
  const nF = n - nG;
  const grass = new Float32Array(nG * SPOT), flow = new Float32Array(nF * SPOT);
  for (let i = 0, a = 0, b = 0; i < n; i++) {
    const src = all.subarray(i * SPOT, i * SPOT + SPOT);
    if (all[i * SPOT + 8] < 0) grass.set(src, (a++) * SPOT); else flow.set(src, (b++) * SPOT);
  }
  const mat = tuftMaterial();
  const mk = (geo: THREE.BufferGeometry, cap: number, name: string) => {
    const im = new THREE.InstancedMesh(geo, mat, Math.max(1, cap));
    im.name = name; im.count = 0; im.frustumCulled = false; im.castShadow = false; im.receiveShadow = true;
    im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aTint', new THREE.InstancedBufferAttribute(new Float32Array(Math.max(1, cap) * 3), 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aFlower', new THREE.InstancedBufferAttribute(new Float32Array(Math.max(1, cap) * 3), 3).setUsage(THREE.DynamicDrawUsage));
    return im;
  };
  const capG = Math.min(nG, CAP[3]), capF = Math.min(nF, Math.ceil(CAP[3] * 0.3));
  const gm = mk(tuftGeometry(4, false, o, 11), capG, 'fx:grass');
  const fm = mk(tuftGeometry(2, true, o, 23), capF, 'fx:flowers');
  const group = new THREE.Group(); group.name = 'world:foliage';
  group.add(gm, fm);
  let q = 2, lx = 1e9, lz = 1e9;
  const fill = (im: THREE.InstancedMesh, src: Float32Array, cnt: number, cap: number, cx: number, cz: number, R: number) => {
    const e = im.instanceMatrix.array as Float32Array;
    const tint = (im.geometry.attributes.aTint as THREE.InstancedBufferAttribute).array as Float32Array;
    const fc = (im.geometry.attributes.aFlower as THREE.InstancedBufferAttribute).array as Float32Array;
    const R2 = R * R;
    let k = 0;
    for (let i = 0; i < cnt && k < cap; i++) {
      const o2 = i * SPOT, x = src[o2], z = src[o2 + 2], dx = x - cx, dz = z - cz;
      if (dx * dx + dz * dz > R2) continue;
      const c = Math.cos(src[o2 + 3]), s = Math.sin(src[o2 + 3]), sc = src[o2 + 4], m = k * 16;
      e[m] = c * sc; e[m + 1] = 0; e[m + 2] = -s * sc; e[m + 3] = 0;
      e[m + 4] = 0; e[m + 5] = sc; e[m + 6] = 0; e[m + 7] = 0;
      e[m + 8] = s * sc; e[m + 9] = 0; e[m + 10] = c * sc; e[m + 11] = 0;
      e[m + 12] = x; e[m + 13] = src[o2 + 1]; e[m + 14] = z; e[m + 15] = 1;
      tint[k * 3] = src[o2 + 5]; tint[k * 3 + 1] = src[o2 + 6]; tint[k * 3 + 2] = src[o2 + 7];
      fc[k * 3] = src[o2 + 8]; fc[k * 3 + 1] = src[o2 + 9]; fc[k * 3 + 2] = src[o2 + 10];
      k++;
    }
    im.count = k;
    im.instanceMatrix.needsUpdate = true;
    (im.geometry.attributes.aTint as THREE.InstancedBufferAttribute).needsUpdate = true;
    (im.geometry.attributes.aFlower as THREE.InstancedBufferAttribute).needsUpdate = true;
  };
  const refresh = (cx: number, cz: number) => {
    lx = cx; lz = cz;
    const R = RADIUS[q] + 2;
    fill(gm, grass, nG, Math.min(capG, CAP[q]), cx, cz, R);
    fill(fm, flow, nF, Math.min(capF, Math.ceil(CAP[q] * 0.3)), cx, cz, R);
  };
  return {
    group, materials: [mat], total: [nG, nF],
    update(t, cam) {
      WIND.uWindT.value = t;
      FOL_CAM.value.copy(cam);
      if (q === 0) return;
      const dx = cam.x - lx, dz = cam.z - lz;
      if (dx * dx + dz * dz > 9) refresh(cam.x, cam.z);   // every 3 m of travel
    },
    setQuality(nq) {
      q = Math.max(0, Math.min(3, nq));
      FOL_R.value = RADIUS[q];
      group.visible = q > 0;
      if (q > 0) refresh(lx === 1e9 ? 0 : lx, lz === 1e9 ? 0 : lz);
    },
    dispose() { gm.geometry.dispose(); fm.geometry.dispose(); mat.dispose(); gm.dispose(); fm.dispose(); },
  };
}

/* ------------------------------------------------------------------ spot scattering helpers */

export class SpotList {
  readonly a: number[] = [];
  private s: number;
  constructor(seed = 77) { this.s = seed; }
  rnd(): number { return (this.s = (this.s * 16807) % 2147483647) / 2147483647; }
  /** A grass tuft (tint jitter ±) or a flowering tuft (`flower` colour). */
  add(x: number, y: number, z: number, scale: number, flower?: THREE.Color | null, tint = 1): void {
    const r = this.rnd, v = 0.82 + r.call(this) * 0.36;
    const warm = r.call(this) * 0.16;
    this.a.push(x, y, z, r.call(this) * 6.283, scale, v * tint * (1 + warm), v * tint, v * tint * (1 - warm * 0.6),
      flower ? flower.r : -1, flower ? flower.g : -1, flower ? flower.b : -1);
  }
  get count(): number { return this.a.length / SPOT; }
}

/** Cheap 2D value-noise-ish field (0..1) for clumping. */
export function clump(x: number, z: number): number {
  const v = Math.sin(x * 0.9 + Math.sin(z * 0.7) * 1.7) * Math.sin(z * 1.1 + Math.sin(x * 0.5) * 2.1);
  return v * 0.5 + 0.5;
}
