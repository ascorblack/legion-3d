/**
 * Atmosphere: slow floating motes round the camera — warm dust / sparks in the city, fireflies over grass (camp,
 * villages). One additive Points draw; the field wraps round the camera in the vertex shader (no per-frame CPU work
 * besides two uniforms). Quality: off at q0, 90 at q1, 220 at q2+. Respects prefers-reduced-motion (still, dimmer).
 */
import * as THREE from 'three';

const N = 220;

export interface Motes { points: THREE.Points; update(t: number, cam: THREE.Vector3): void; setQuality(q: number): void; dispose(): void }

export function createMotes(kind: 'dust' | 'fireflies', tex: THREE.Texture, seed = 7): Motes {
  const pos = new Float32Array(N * 3), ph = new Float32Array(N);
  let s = seed;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < N; i++) { pos[i * 3] = rnd() * 28; pos[i * 3 + 1] = rnd(); pos[i * 3 + 2] = rnd() * 28; ph[i] = rnd() * 6.283; }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aPh', new THREE.BufferAttribute(ph, 1));
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);   // the field follows the camera: never culled
  const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const ff = kind === 'fireflies';
  const m = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 }, uCam: { value: new THREE.Vector3() }, uMap: { value: tex },
      uCol: { value: new THREE.Color(ff ? '#d8ff7a' : '#ffd9a0') }, uSize: { value: ff ? 0.14 : 0.085 }, uAmp: { value: reduced ? 0 : 1 },
      uBright: { value: ff ? 2.2 : 0.95 },
    },
    vertexShader: /* glsl */`
      uniform float uTime; uniform vec3 uCam; uniform float uSize; uniform float uAmp;
      attribute float aPh; varying float vA;
      void main() {
        vec3 p = position;
        float t = uTime * uAmp;
        p.x += sin(t * 0.13 + aPh) * 1.6 + t * 0.05; p.z += cos(t * 0.11 + aPh * 1.3) * 1.6;
        float h = ${ff ? '0.35 + p.y * 2.2 + sin(t * 0.7 + aPh) * 0.25' : '0.4 + p.y * 4.5 + sin(t * 0.2 + aPh) * 0.4'};
        vec3 w = vec3(uCam.x + mod(p.x - uCam.x + 14.0, 28.0) - 14.0, uCam.y - 1.6 + h, uCam.z + mod(p.z - uCam.z + 14.0, 28.0) - 14.0);
        vec4 mv = modelViewMatrix * vec4(w, 1.0);
        float d = -mv.z;
        // fade in from the near plane, out towards the wrap edge; ${ff ? 'fireflies blink' : 'dust twinkles softly'}
        vA = smoothstep(0.6, 2.5, d) * (1.0 - smoothstep(9.0, 13.5, length(w.xz - uCam.xz)))
           * ${ff ? 'pow(0.5 + 0.5 * sin(uTime * 1.7 + aPh * 3.0), 3.0)' : '(0.55 + 0.45 * sin(uTime * 0.9 + aPh * 5.0))'};
        gl_PointSize = uSize * projectionMatrix[1][1] * 360.0 / max(d, 0.1);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */`
      uniform sampler2D uMap; uniform vec3 uCol; uniform float uBright; varying float vA;
      void main() {
        float a = texture2D(uMap, gl_PointCoord).a * vA;
        if (a < 0.01) discard;
        gl_FragColor = vec4(uCol * uBright * a, a);
      }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
  });
  const points = new THREE.Points(g, m);
  points.name = 'fx:motes'; points.frustumCulled = false; points.renderOrder = 2;
  return {
    points,
    update(t, cam) { m.uniforms.uTime.value = t; (m.uniforms.uCam.value as THREE.Vector3).copy(cam); },
    setQuality(q) { points.visible = q >= 1; g.setDrawRange(0, q >= 2 ? N : 90); },
    dispose() { g.dispose(); m.dispose(); },
  };
}
