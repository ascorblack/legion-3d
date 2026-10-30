/**
 * Baked ambient occlusion for interiors and the mine: a small 2D occlusion field over the floor plan (one RGBA texture,
 * ~8 cm per texel), sampled by every lit room material in its fragment shader at the surface's world xz pushed a little
 * along its normal. No extra geometry or draw calls, no per-frame work — one texture fetch per fragment.
 *
 *  R — contact shadow of what stands on the floor (counters, crates, rock): dark under / beside it, fading out over
 *      15–60 cm (taller things throw a wider skirt), and fading UP the sides from the floor (a crate's foot is dark, its
 *      lid is not);
 *  G — wall proximity: the floor darkens towards the walls, walls darken into the corners (two walls meet), and the
 *      top of the walls darkens into the ceiling (ceiling height uRaoH).
 *
 * Usage: const ao = new AoField(x0, z0, x1, z1, 0.08); ao.solid(...)… ao.walls(...); ao.bake(); ao.patch(material);
 * Rebake after the solids change (the mine, when a stone is dug) — the patched materials pick it up (same texture).
 */
import * as THREE from 'three';

export interface AoOpts {
  /** overall strength of the contact (R) term (0..1). */
  contact?: number;
  /** strength of the wall / corner (G) term (0..1). */
  wall?: number;
  /** strength of the wall-ceiling junction darkening (0..1). */
  ceil?: number;
}

function hash2(x: number, y: number): number { const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return s - Math.floor(s); }
function vnoise(x: number, y: number): number {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi, u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi), b = hash2(xi + 1, yi), c = hash2(xi, yi + 1), d = hash2(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
const smooth = (a: number, b: number, x: number) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

export class AoField {
  readonly tex: THREE.DataTexture;
  private readonly data: Uint8Array;
  private readonly r: Float32Array;
  private readonly g: Float32Array;
  readonly nx: number; readonly nz: number;
  private rects: number[] = [];
  private wallRect: [number, number, number, number] | null = null;
  private wallCircle: [number, number, number] | null = null;
  private wallK = 0.55;
  readonly uniforms = {
    uRaoMap: { value: null as THREE.Texture | null },
    /** x0, z0, 1/width, 1/depth of the field. */
    uRaoO: { value: new THREE.Vector4() },
    /** ceiling height (≤ 0 = no ceiling term). */
    uRaoH: { value: 0 },
  };

  constructor(readonly x0: number, readonly z0: number, readonly x1: number, readonly z1: number, readonly cell = 0.08) {
    this.nx = Math.max(2, Math.min(512, Math.ceil((x1 - x0) / cell)));
    this.nz = Math.max(2, Math.min(512, Math.ceil((z1 - z0) / cell)));
    this.data = new Uint8Array(this.nx * this.nz * 4);
    this.r = new Float32Array(this.nx * this.nz); this.g = new Float32Array(this.nx * this.nz);
    this.tex = new THREE.DataTexture(this.data, this.nx, this.nz, THREE.RGBAFormat);
    this.tex.magFilter = THREE.LinearFilter; this.tex.minFilter = THREE.LinearFilter;
    this.tex.wrapS = this.tex.wrapT = THREE.ClampToEdgeWrapping;
    this.tex.colorSpace = THREE.NoColorSpace; this.tex.name = 'room:ao';
    this.uniforms.uRaoMap.value = this.tex;
    this.uniforms.uRaoO.value.set(x0, z0, 1 / (x1 - x0), 1 / (z1 - z0));
  }

  /** Something standing on the floor over [x0,x1]×[z0,z1], `top` m high (Infinity = to the ceiling). */
  solid(x0: number, x1: number, z0: number, z1: number, top: number, k = 1): void {
    if (!(top > 0.06)) return;   // rugs, floor decals
    this.rects.push(Math.min(x0, x1), Math.max(x0, x1), Math.min(z0, z1), Math.max(z0, z1), Number.isFinite(top) ? top : 3, k);
  }
  clearSolids(): void { this.rects.length = 0; }
  /** Room walls: a rectangle, or a disc (tent). k = how dark the corners get. */
  walls(rect: [number, number, number, number] | null, circle: [number, number, number] | null = null, k = 0.55): void { this.wallRect = rect; this.wallCircle = circle; this.wallK = k; }
  setCeiling(h: number): void { this.uniforms.uRaoH.value = h; }

  /** Recompute the field and upload it. */
  bake(): void {
    const { nx, nz, cell, r, g } = this, x0 = this.x0, z0 = this.z0, sx = (this.x1 - x0) / nx, sz = (this.z1 - z0) / nz;
    r.fill(1); g.fill(1);
    const R = this.rects;
    for (let k = 0; k < R.length; k += 6) {
      const ax = R[k], bx = R[k + 1], az = R[k + 2], bz = R[k + 3], top = R[k + 4], kk = R[k + 5];
      const rad = Math.min(0.65, 0.16 + 0.3 * Math.min(top, 1.6)), str = Math.min(0.8, 0.38 + 0.42 * Math.min(1, top / 0.9)) * kk;
      const i0 = Math.max(0, Math.floor((ax - rad - x0) / sx)), i1 = Math.min(nx - 1, Math.ceil((bx + rad - x0) / sx));
      const j0 = Math.max(0, Math.floor((az - rad - z0) / sz)), j1 = Math.min(nz - 1, Math.ceil((bz + rad - z0) / sz));
      for (let j = j0; j <= j1; j++) {
        const z = z0 + (j + 0.5) * sz, dz = z < az ? az - z : z > bz ? z - bz : 0;
        for (let i = i0; i <= i1; i++) {
          const x = x0 + (i + 0.5) * sx, dx = x < ax ? ax - x : x > bx ? x - bx : 0;
          const d = Math.hypot(dx, dz); if (d >= rad) continue;
          const f = 1 - smooth(0, rad, d);
          const o = j * nx + i, v = 1 - str * f;
          const lo = Math.min(r[o], v), hi = Math.max(r[o], v);
          r[o] = lo * (0.82 + 0.18 * hi);   // overlapping skirts deepen a little, never to black
        }
      }
    }
    const W = this.wallRect, C = this.wallCircle, wk = this.wallK;
    if (W || C) for (let j = 0; j < nz; j++) {
      const z = z0 + (j + 0.5) * sz;
      for (let i = 0; i < nx; i++) {
        const x = x0 + (i + 0.5) * sx;
        let v = 1;
        if (W) {
          for (const d of [x - W[0], W[1] - x, z - W[2], W[3] - z]) if (d > -0.3) v *= 1 - wk * (1 - smooth(0, 0.85, Math.max(0, d)));
        } else if (C) {
          const d = C[2] - Math.hypot(x - C[0], z - C[1]);
          v *= 1 - wk * (1 - smooth(0, 0.9, Math.max(0, d)));
        }
        g[j * nx + i] = v;
      }
    }
    const D = this.data;
    for (let o = 0; o < nx * nz; o++) { D[o * 4] = Math.round(Math.max(0, Math.min(1, r[o])) * 255); D[o * 4 + 1] = Math.round(Math.max(0, Math.min(1, g[o])) * 255); D[o * 4 + 2] = Math.round(this.grime(o) * 255); D[o * 4 + 3] = 255; }
    this.tex.needsUpdate = true;
    void cell;
  }

  /** Floor grime (0..1 multiplier): value noise at ~0.6 m and ~1.7 m, darker near the walls (G), lighter on the worn path. */
  private grime(o: number): number {
    const i = o % this.nx, j = Math.floor(o / this.nx), x = i * this.cell, z = j * this.cell;
    const n = vnoise(x / 0.6, z / 0.6) * 0.45 + vnoise(x / 1.7 + 7.1, z / 1.7 + 3.3) * 0.55;
    const wallish = 1 - this.g[o];
    return Math.max(0.6, Math.min(1, 1 - this.grimeK * (0.55 * n + 0.6 * wallish)));
  }
  /** Strength of the floor grime (0 = none). */
  grimeK = 0.16;
  /** Occlusion (R, G) at a point (tests / tools). */
  at(x: number, z: number): [number, number] {
    const i = Math.max(0, Math.min(this.nx - 1, Math.floor((x - this.x0) / (this.x1 - this.x0) * this.nx)));
    const j = Math.max(0, Math.min(this.nz - 1, Math.floor((z - this.z0) / (this.z1 - this.z0) * this.nz)));
    const o = j * this.nx + i; return [this.r[o], this.g[o]];
  }

  /** Patch a lit material (MeshStandard / Lambert / Phong with onBeforeCompile) to take the field. */
  patch(m: THREE.Material, o: AoOpts = {}): void {
    const sm = m as THREE.MeshStandardMaterial;
    if (!(sm.isMeshStandardMaterial || (sm as any).isMeshLambertMaterial || (sm as any).isMeshPhongMaterial) || sm.userData.l3dRao) return;
    sm.userData.l3dRao = this;
    const kc = (o.contact ?? 0.9).toFixed(3), kw = (o.wall ?? 0.6).toFixed(3), kh = (o.ceil ?? 0.45).toFixed(3);
    const U = this.uniforms, prev = sm.onBeforeCompile;
    sm.onBeforeCompile = (sh, rr) => {
      prev?.call(sm, sh, rr);
      Object.assign(sh.uniforms, U);
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vRaoW;\nvarying vec3 vRaoN;')
        .replace('#include <project_vertex>', `#include <project_vertex>
{
  vec4 raoW = vec4(transformed, 1.0); vec3 raoN = objectNormal;
  #ifdef USE_INSTANCING
    raoW = instanceMatrix * raoW; raoN = mat3(instanceMatrix) * raoN;
  #endif
  vRaoW = (modelMatrix * raoW).xyz; vRaoN = mat3(modelMatrix) * raoN;
}`);
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>
varying vec3 vRaoW;
varying vec3 vRaoN;
uniform sampler2D uRaoMap;
uniform vec4 uRaoO;
uniform float uRaoH;
float raoTerm() {
  vec3 rn = normalize(vRaoN);
  float up = smoothstep(0.45, 0.85, rn.y), hy = vRaoW.y;
  vec2 ruv = (vRaoW.xz + rn.xz * 0.16 - uRaoO.xy) * uRaoO.zw;
  vec4 ra = texture2D(uRaoMap, ruv);
  // contact: strongest at the floor, fading up the sides of things; raised tops (a counter's lid) are not shaded by themselves
  float hf = (1.0 - smoothstep(0.0, 0.85, hy)) * (1.0 - up * smoothstep(0.03, 0.12, hy));
  float ao = mix(1.0, ra.r, ${kc} * hf);
  // walls into corners (weaker high up), the floor towards the walls
  ao *= mix(1.0, ra.g, ${kw} * (1.0 - 0.45 * smoothstep(0.6, 3.2, hy)) * (1.0 - 0.5 * up));
  // wall-ceiling junction and the ceiling near the walls
  if (uRaoH > 0.0) ao *= 1.0 - ${kh} * smoothstep(uRaoH - 0.85, uRaoH, hy) * (1.0 - ra.g * 0.6) * (1.0 - up);
  // grime: low-frequency blotches on the floor (breaks the texture tiling), more of it towards the walls
  ao *= mix(1.0, ra.b, up * (1.0 - smoothstep(0.02, 0.3, hy)));
  return ao;
}`)
        // on the final light (the light pools add their warmth as emissive: AO must darken that too)
        .replace('#include <opaque_fragment>', 'outgoingLight *= raoTerm();\n#include <opaque_fragment>');
    };
    const pk = sm.customProgramCacheKey?.bind(sm);
    sm.customProgramCacheKey = () => (pk ? pk() : '') + `|rao:${kc}:${kw}:${kh}`;
    sm.needsUpdate = true;
  }

  dispose(): void { this.tex.dispose(); }
}
