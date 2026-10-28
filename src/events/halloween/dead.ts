/**
 * The «dead» city of «Ночь Тыквенной Луны» (site: citygl setDead / cityhw deadPaint — desaturate, cold tint 0x8e9ab8,
 * lights off except pumpkins and candy). Reversible grading of the city world, driven by one 0…1 strength:
 *  - every lit / basic material of the world (static city, props, the sky dome, the moon) gets a tiny fragment tail
 *    (shared uniform, installed once with onBeforeCompile — no per-frame cost): towards a cold grey; emissive window /
 *    glow / sign materials also dim; the fake lamp pools (src/world/lightPools.ts) fade out;
 *  - the world's hemisphere / ambient / moon lights turn cold-grey, the street point lights go dark;
 *  - the world's glow points (lamp heads, windows) and garland bulbs fade out.
 * Our own groups (Halloween pumpkins, the portal, avatars) are not in the world root and keep their colours.
 * dispose() restores every material, light and uniform exactly.
 */
import * as THREE from 'three';

/** Shared uniforms of the patch (one program per material; strength animates without recompiling). */
export const DEAD_U = {
  uL3dDead: { value: 0 },
  /** cold tint (0x8e9ab8 normalised to keep luminance) */
  uL3dTint: { value: new THREE.Vector3(0x8e / 255, 0x9a / 255, 0xb8 / 255).multiplyScalar(1 / 0.606) },
};

const HEAD = 'uniform float uL3dDead; uniform vec3 uL3dTint;\n';
const tail = (dim: number) => `
{ vec3 l3dc = gl_FragColor.rgb; float l3dl = dot(l3dc, vec3(0.2126, 0.7152, 0.0722));
  vec3 l3dg = mix(vec3(l3dl), l3dc, 0.12) * uL3dTint * 0.8;
  gl_FragColor.rgb = mix(l3dc, l3dg, uL3dDead) * (1.0 - ${dim.toFixed(2)} * uL3dDead); }
`;
const ANCHORS = ['#include <dithering_fragment>', '#include <premultiplied_alpha_fragment>', '#include <fog_fragment>', 'gl_FragColor = vec4(c, 1.0);'];
const POOL_LINE = 'acc += uL3dC[i] * (a * nl);';

/** Dimming of emissive city materials (windows, glows, signs) — «lights off». */
const DIM: Record<string, number> = { 'city:emit': 0.72, 'city:glow': 0.72, 'city:sign': 0.45 };

interface Patched { m: THREE.Material; obc: THREE.Material['onBeforeCompile']; key: THREE.Material['customProgramCacheKey']; own: boolean }

/** Patch one material (idempotent). Returns false when the shader has no anchor we know. */
export function patchDead(m: THREE.Material, dim = 0): Patched | null {
  if (m.userData.l3dDead) return null;
  const sm = m as THREE.ShaderMaterial;
  if (sm.isShaderMaterial && !ANCHORS.some((a) => sm.fragmentShader.includes(a))) return null;
  const rec: Patched = { m, obc: m.onBeforeCompile, key: m.customProgramCacheKey, own: Object.prototype.hasOwnProperty.call(m, 'customProgramCacheKey') };
  const prev = m.onBeforeCompile, prevKey = m.customProgramCacheKey;
  m.onBeforeCompile = (sh, r) => {
    prev.call(m, sh, r);
    Object.assign(sh.uniforms, DEAD_U);
    let f = HEAD + sh.fragmentShader;
    const a = ANCHORS.find((x) => f.includes(x));
    if (a) f = f.replace(a, a + tail(dim));
    if (f.includes(POOL_LINE)) f = f.replace(POOL_LINE, 'acc += uL3dC[i] * (a * nl) * (1.0 - 0.92 * uL3dDead);');
    sh.fragmentShader = f;
  };
  m.customProgramCacheKey = () => prevKey.call(m) + '|l3dDead' + dim;
  m.userData.l3dDead = true;
  m.needsUpdate = true;
  return rec;
}
function unpatch(p: Patched): void {
  p.m.onBeforeCompile = p.obc;
  if (p.own) p.m.customProgramCacheKey = p.key; else delete (p.m as { customProgramCacheKey?: unknown }).customProgramCacheKey;
  delete p.m.userData.l3dDead;
  p.m.needsUpdate = true;
}

function coldOf(c: THREE.Color, out: THREE.Color): THREE.Color {
  const l = c.r * 0.2126 + c.g * 0.7152 + c.b * 0.0722, t = DEAD_U.uL3dTint.value;
  return out.setRGB(l * t.x * 0.9, l * t.y * 0.9, l * t.z * 0.9);
}

export class DeadGrade {
  private patched: Patched[] = [];
  private lights: { l: THREE.Light; c: THREE.Color; cold: THREE.Color; g?: THREE.Color; gcold?: THREE.Color; dark: boolean }[] = [];
  private glows: { u: { value: number }; v: number; off: number }[] = [];
  private k = -1;

  constructor(readonly root: THREE.Object3D) {
    const seen = new Set<THREE.Material>();
    root.traverse((o) => {
      const l = o as THREE.Light;
      if (l.isLight) {
        const hemi = (l as THREE.HemisphereLight).isHemisphereLight ? (l as THREE.HemisphereLight) : null;
        const dark = (l as THREE.PointLight).isPointLight === true;
        this.lights.push({ l, c: l.color.clone(), cold: dark ? new THREE.Color(0, 0, 0) : coldOf(l.color, new THREE.Color()),
          g: hemi ? hemi.groundColor.clone() : undefined, gcold: hemi ? coldOf(hemi.groundColor, new THREE.Color()) : undefined, dark });
        return;
      }
      const pts = o as THREE.Points;
      if (pts.isPoints) {
        const u = (pts.material as THREE.ShaderMaterial).uniforms?.uInt as { value: number } | undefined;
        if (u && (o.name === 'fx:glow' || o.name === 'fx:bulbs')) this.glows.push({ u, v: u.value, off: o.name === 'fx:bulbs' ? 1 : 0.9 });
        return;
      }
      const mesh = o as THREE.Mesh;
      if (!(mesh.isMesh || (o as THREE.Sprite).isSprite)) return;
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const m of mats) {
        if (!m || seen.has(m) || !m.visible) continue;
        seen.add(m);
        if ((m as THREE.ShaderMaterial).isShaderMaterial && o.name !== 'sky:dome') continue;
        const p = patchDead(m, DIM[m.name] ?? 0);
        if (p) this.patched.push(p);
      }
    });
  }

  /** Materials / lights / glows touched (for tests and the debug overlay). */
  get counts() { return { materials: this.patched.length, lights: this.lights.length, glows: this.glows.length }; }

  /** Strength 0…1 (cheap; only does work when it changes). */
  set(k: number): void {
    k = Math.max(0, Math.min(1, k));
    if (k === this.k) return;
    this.k = k;
    DEAD_U.uL3dDead.value = k;
    for (const L of this.lights) {
      L.l.color.copy(L.c).lerp(L.cold, L.dark ? k * 0.95 : k);
      if (L.g && L.gcold) (L.l as THREE.HemisphereLight).groundColor.copy(L.g).lerp(L.gcold, k);
    }
    for (const g of this.glows) g.u.value = g.v * (1 - g.off * k);
  }

  dispose(): void {
    DEAD_U.uL3dDead.value = 0;
    for (const L of this.lights) { L.l.color.copy(L.c); if (L.g) (L.l as THREE.HemisphereLight).groundColor.copy(L.g); }
    for (const g of this.glows) g.u.value = g.v;
    for (const p of this.patched) unpatch(p);
    this.patched = []; this.lights = []; this.glows = []; this.k = -1;
  }
}
