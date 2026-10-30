/**
 * Water (canal, ponds, village pools) and lava (the cherts quarter) shading on top of the city's water material:
 *  - water: Fresnel reflection of the night sky gradient (zenith ↔ horizon by the reflected direction), a moon glint,
 *    a moving ripple sparkle and a pale foam line along the canal's stone banks;
 *  - lava: a slow crust pattern (dark plates, hot cracks that breathe), brighter along the banks.
 * Patched into the MeshStandardMaterial with onBeforeCompile (no extra pass, no render target, no draw call).
 */
import * as THREE from 'three';

export interface WaterLook {
  zenith: THREE.Color; horizon: THREE.Color; moonDir: THREE.Vector3;
  /** Canal banks (world z of both stone edges; NaN when there is no canal). */
  c0: number; c1: number;
  lava: boolean;
}

export const WATER_T = { value: 0 };

export function patchWater(m: THREE.MeshStandardMaterial, o: WaterLook): void {
  if (m.userData.l3dWater) return;
  m.userData.l3dWater = true;
  const U = {
    uWZen: { value: o.zenith.clone() }, uWHor: { value: o.horizon.clone() }, uWMoon: { value: o.moonDir.clone().normalize() },
    uWBank: { value: new THREE.Vector2(isNaN(o.c0) ? -1e6 : o.c0, isNaN(o.c1) ? -1e6 : o.c1) }, uWT: WATER_T,
  };
  const prev = m.onBeforeCompile;
  m.onBeforeCompile = (sh, r) => {
    prev?.call(m, sh, r);
    Object.assign(sh.uniforms, U);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWW;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvWW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    const head = `#include <common>
varying vec3 vWW;
uniform vec3 uWZen; uniform vec3 uWHor; uniform vec3 uWMoon; uniform vec2 uWBank; uniform float uWT;
float wHash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float wNoise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(wHash(i), wHash(i + vec2(1.0, 0.0)), f.x), mix(wHash(i + vec2(0.0, 1.0)), wHash(i + vec2(1.0, 1.0)), f.x), f.y); }`;
    const bank = `float bd = min(abs(vWW.z - uWBank.x), abs(vWW.z - uWBank.y));`;
    const body = o.lava ? `
{
  ${bank}
  vec2 p = vWW.xz * 1.6 + vec2(uWT * 0.06, uWT * 0.025);
  float n = wNoise(p) * 0.6 + wNoise(p * 2.3 + 7.0) * 0.4;
  float crack = 1.0 - smoothstep(0.02, 0.09, abs(n - 0.5));            // hot seams between the crust plates
  float breathe = 0.7 + 0.3 * sin(uWT * 1.3 + n * 9.0);
  float plate = smoothstep(0.25, 0.75, wNoise(p * 0.5 + 3.0));
  vec3 crust = outgoingLight * vec3(0.2, 0.09, 0.08) * mix(1.0, 0.5, plate);
  vec3 hot = vec3(2.2, 0.75, 0.16) * (crack * breathe * 1.6 + exp(-bd * 4.0) * 0.9 + (1.0 - plate) * 0.18);
  outgoingLight = crust * (1.0 - crack) + hot;
}` : `
{
  ${bank}
  vec3 vd = normalize(vViewPosition);
  vec3 nrm = normalize(normal);
  vec3 rw = inverseTransformDirection(reflect(vd, nrm), viewMatrix);
  float fr = 0.06 + 0.94 * pow(1.0 - clamp(dot(-vd, nrm), 0.0, 1.0), 4.0);
  vec3 sky = mix(uWHor * 0.55, uWZen * 1.15, smoothstep(-0.05, 0.3, rw.y));
  float glint = pow(max(dot(normalize(rw), uWMoon), 0.0), 220.0) * 2.5;
  vec2 q = vWW.xz * 3.0 + vec2(uWT * 0.4, -uWT * 0.3);
  float spark = smoothstep(0.9, 1.0, wNoise(q) * wNoise(q * 1.7 + 3.1) * 1.9) * 0.35;
  outgoingLight = mix(outgoingLight * vec3(0.5, 0.6, 0.75), sky * 1.1, fr * 0.6) + (glint + spark * fr) * vec3(0.85, 0.9, 1.0);
  // foam / wet line along the stone banks (canal)
  float foam = (1.0 - smoothstep(0.01, 0.12, bd)) * (0.55 + 0.45 * wNoise(vec2(vWW.x * 4.0 + uWT * 0.6, uWT * 0.3)));
  outgoingLight = mix(outgoingLight, vec3(0.6, 0.68, 0.82), foam * 0.3);
}`;
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', head)
      .replace('#include <opaque_fragment>', body + '\n#include <opaque_fragment>');
  };
  const pk = m.customProgramCacheKey?.bind(m);
  m.customProgramCacheKey = () => (pk ? pk() : '') + (o.lava ? '|l3dLava' : '|l3dWater');
  m.needsUpdate = true;
}
