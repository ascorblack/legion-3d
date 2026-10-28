/**
 * The portal at the gate («Ночь Тыквенной Луны», hwc.portal): a stone arch flush against the gatehouse, a swirling
 * violet-green vortex in the opening (one shader quad that also glows over the frame) and a glow on the street in
 * front. 3 draw calls, no lights, no per-frame allocations. setOpen(k) 0…1 grows the frame and opens the iris.
 */
import * as THREE from 'three';
import type { PortalSpot } from './hwcity';
import { portalFrameGeometry } from './hwgeo';
import { glowTexture } from './tex';
import { selfLit } from '../common';

const VERT = /* glsl */`varying vec2 vP; void main(){ vP = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const FRAG = /* glsl */`
  uniform float uTime; uniform float uOpen; uniform float uR; uniform float uYc; uniform float uH; uniform float uPw; varying vec2 vP;
  void main(){
    vec2 p = vP;
    float d = p.y < uYc ? abs(p.x) - uR : length(p - vec2(0.0, uYc)) - uR;
    d = max(d, -p.y);
    vec2 q = p - vec2(0.0, uH * 0.47);
    float r = length(q), a = atan(q.y, q.x);
    float R = (uR * 1.9 + 0.3) * uOpen;
    float iris = smoothstep(R, R - 0.35, r);
    // a three-armed logarithmic spiral turning into a dark eye with a bright lime ring
    float tw = a * 3.0 + log(r + 0.04) * 5.5 + uTime * 2.2;
    float arm = smoothstep(0.15, 0.55, 0.5 + 0.5 * sin(tw));
    float edge = smoothstep(0.75, 0.98, 0.5 + 0.5 * sin(tw + 0.9));
    vec3 deep = vec3(0.03, 0.006, 0.08), purple = vec3(0.4, 0.09, 0.78), green = vec3(0.45, 1.0, 0.3);
    float fall = smoothstep(1.8, 0.25, r);
    vec3 col = deep + purple * 0.18 * fall;
    col = mix(col, mix(purple, green * 0.85, smoothstep(0.8, 0.3, r)), arm * (0.25 + 0.75 * fall));
    col += vec3(0.75, 1.0, 0.65) * edge * 0.35 * fall;
    float ring = exp(-pow((r - 0.22) / 0.05, 2.0));
    col = mix(col, deep * 0.5, smoothstep(0.2, 0.1, r));
    col += vec3(0.75, 1.0, 0.6) * ring * 1.4 * uOpen;
    col += green * 0.4 * exp(-max(-d, 0.0) * 12.0) * uOpen;   // lime glow at the inner edge
    float inside = smoothstep(0.03, -0.03, d) * iris;
    // glow over the frame and the wall around it (beyond the opening), pulsing
    float g = exp(-max(d, 0.0) * 4.0) * (1.0 - inside) * uOpen * (0.8 + 0.2 * sin(uTime * 2.1));
    vec3 gc = mix(purple * 1.5, green * 1.2, 0.25 + 0.2 * sin(uTime * 0.9 + p.y * 1.5));
    float ga = g * 0.3 * step(0.0, p.y + 0.02);
    vec3 outc = col * inside + gc * ga;
    float alpha = clamp(inside * 0.97 + ga, 0.0, 1.0);
    gl_FragColor = vec4(outc / max(alpha, 1e-3), alpha);
    #include <colorspace_fragment>
  }`;

export interface Portal {
  readonly group: THREE.Group;
  /** 0 = closed (hidden) … 1 = open. */
  setOpen(k: number): void;
  update(t: number): void;
  dispose(): void;
}

export function buildPortal(spot: PortalSpot, reducedMotion = false): Portal {
  const group = new THREE.Group(); group.name = 'hwcity:portal';
  group.position.set(spot.x, spot.y, spot.z);
  const r = spot.w / 2, yc = spot.h - r, pw = spot.outerW - r;

  const frameGeo = portalFrameGeometry(spot);
  const frameMat = selfLit(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92 }), 0.2);
  frameMat.customProgramCacheKey = () => 'l3d-hw-frame';
  const frame = new THREE.Mesh(frameGeo, frameMat); frame.name = 'hwcity:portal-frame';
  const frameRoot = new THREE.Group(); frameRoot.add(frame); group.add(frameRoot);

  const pad = 1.3;
  const vGeo = new THREE.PlaneGeometry(spot.outerW * 2 + pad * 2, spot.outerH + pad, 1, 1);
  vGeo.translate(0, (spot.outerH + pad) / 2 - 0.05, 0);
  const vMat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uOpen: { value: 0 }, uR: { value: r }, uYc: { value: yc }, uH: { value: spot.h }, uPw: { value: pw } },
    vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false, fog: false,
  });
  const vortex = new THREE.Mesh(vGeo, vMat); vortex.name = 'hwcity:portal-vortex';
  vortex.position.z = spot.depth / 2 + 0.008; vortex.renderOrder = 5;
  group.add(vortex);

  const gTex = glowTexture(64, 1.6);
  const gMat = new THREE.MeshBasicMaterial({ map: gTex, color: new THREE.Color(0.5, 0.45, 0.95), transparent: true, opacity: 0, depthWrite: false,
    blending: THREE.AdditiveBlending, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
  const gGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  const ground = new THREE.Mesh(gGeo, gMat); ground.name = 'hwcity:portal-ground';
  ground.scale.set(spot.w * 2.6, 1, 3.2); ground.position.set(0, 0.02, spot.depth / 2 + 1.0); ground.renderOrder = 2;
  group.add(ground);

  for (const o of [frame, vortex, ground]) { o.frustumCulled = false; o.castShadow = false; o.receiveShadow = false; }
  let open = 0;
  const speed = reducedMotion ? 0.2 : 1;
  const ease = (k: number) => { const c = 1.7; const x = k - 1; return 1 + (c + 1) * x * x * x + c * x * x; };   // easeOutBack
  return {
    group,
    setOpen(k) {
      open = Math.max(0, Math.min(1, k));
      group.visible = open > 0.001;
      const s = Math.max(0.001, ease(Math.min(1, open * 1.3)));
      frameRoot.scale.set(s, s, 1);
      vMat.uniforms.uOpen.value = Math.max(0, (open - 0.25) / 0.75);
    },
    update(t) {
      vMat.uniforms.uTime.value = t * speed;
      gMat.opacity = (0.5 + 0.12 * Math.sin(t * 2.1 * speed)) * open;
    },
    dispose() {
      group.removeFromParent();
      frameGeo.dispose(); frameMat.dispose(); vGeo.dispose(); vMat.dispose(); gGeo.dispose(); gMat.dispose(); gTex.dispose();
    },
  };
}
