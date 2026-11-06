/**
 * Летние фонарики (Jun 21 – Jul 7, local time): a warm summer evening of paper lanterns.
 *
 *  - paper lanterns floating on the canal, drifting slowly between the bridges (they fade in / out at the bridge
 *    ends), a few more hovering above the water, and small ones hanging from the existing garlands;
 *  - soft glow pools on the water under each lantern (additive streaks that turn towards the viewer — a cheap fake
 *    reflection, no real-time reflection), halos round the lanterns (q ≥ 1), fireflies over the canal banks (q ≥ 1);
 *  - the garland bulbs re-coloured soft summer pastels.
 * No real lights at any quality. q0 and prefers-reduced-motion: everything stands still (halos stay, they are one cheap draw).
 * Draw calls at q2: lanterns, water glow, halos, fireflies, strings = 5. Dispose restores the bulbs.
 */
import * as THREE from 'three';
import type { SeasonalEvent, EventContext } from '../types';
import type { QualityLevel } from '../../contracts';
import { inWindow, windowDistance } from '../calendar';
import { glowPoints } from '../../world/sky';
import { DN_U } from '../../world/dnUniforms';
import { groundSpec, LOW_H, CANAL_WATER } from '../../world/ground';
import { toX, toZ } from '../../world/coords';
import { garland, recolourBulbs, reducedMotion, pointScale, glowTexture, mulberry32 } from '../common';

export const SUMMER_FROM: [number, number] = [6, 21];
export const SUMMER_TO: [number, number] = [7, 7];

export const SUMMER_BUDGET: Record<QualityLevel, { water: number; sky: number; hang: number; halos: boolean; flies: number; animate: boolean }> = {
  0: { water: 16, sky: 6, hang: 24, halos: true, flies: 0, animate: false },
  1: { water: 24, sky: 10, hang: 44, halos: true, flies: 16, animate: true },
  2: { water: 36, sky: 16, hang: 70, halos: true, flies: 36, animate: true },
  3: { water: 48, sky: 22, hang: 96, halos: true, flies: 56, animate: true },
};

const BULBS = [[1.0, 0.72, 0.45], [1.0, 0.9, 0.5], [0.6, 1.0, 0.75], [1.0, 0.62, 0.72], [0.75, 0.75, 1.0]];
/** Lantern paper tints (linear, > 1 = a soft bloom). */
const TINTS = [[1.4, 0.68, 0.3], [1.4, 0.98, 0.4], [1.35, 0.55, 0.6], [1.35, 0.8, 0.42], [1.15, 0.65, 0.95]];

/** A round paper lantern, height 1 (y −0.5 … 0.5), radius 0.5: bulging paper with ribs, dark rims top and bottom. */
export function lanternGeometry(): THREE.BufferGeometry {
  const pts: THREE.Vector2[] = [];
  const N = 12;
  pts.push(new THREE.Vector2(0.0, -0.5), new THREE.Vector2(0.24, -0.5), new THREE.Vector2(0.24, -0.44));
  for (let i = 0; i <= N; i++) { const t = i / N, y = -0.42 + t * 0.84; pts.push(new THREE.Vector2(0.24 + 0.26 * Math.sin(Math.PI * t), y)); }
  pts.push(new THREE.Vector2(0.2, 0.44), new THREE.Vector2(0.2, 0.5), new THREE.Vector2(0.0, 0.5));
  const g = new THREE.LatheGeometry(pts, 16);
  const p = g.getAttribute('position'), c = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i), rim = Math.abs(y) > 0.43;
    const a = Math.atan2(z, x), rib = Math.abs(Math.sin(a * 4)) < 0.2 ? 0.82 : 1;           // eight thin ribs
    const glow = 1 - 0.35 * Math.abs(y) * 2;                                                     // brighter belly
    const k = rim ? 0.18 : rib * glow;
    c[i * 3] = k; c[i * 3 + 1] = k; c[i * 3 + 2] = k;
  }
  g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  g.deleteAttribute('uv');
  g.computeBoundingSphere();
  return g;
}

interface Lantern { kind: 0 | 1 | 2; x: number; y: number; z: number; x0: number; x1: number; s: number; ph: number; v: number; tint: number }

/** The canal's open water spans (between bridges) in metres, the water height and the canal's depth range. */
export function canalSpans(ctx: Pick<EventContext, 'layout'>): { spans: [number, number][]; y: number; z0: number; z1: number } | null {
  const s = groundSpec(ctx.layout);
  if (!s.canal) return null;
  const x0 = toX(ctx.layout.area.x0), x1 = toX(ctx.layout.area.x1);
  const br = s.bridges.map((b) => [toX(b[0]), toX(b[1])] as [number, number]).sort((a, b) => a[0] - b[0]);
  const spans: [number, number][] = [];
  let at = x0;
  for (const [a, b] of br) { if (a - at > 2) spans.push([at + 0.5, a - 0.5]); at = Math.max(at, b); }
  if (x1 - at > 2) spans.push([at + 0.5, x1 - 0.5]);
  return { spans, y: LOW_H + CANAL_WATER, z0: toZ(s.canal[0]), z1: toZ(s.canal[1]) };
}

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3(), _e = new THREE.Euler(), _c = new THREE.Color();

function setup(ctx: EventContext): () => void {
  const undo: (() => void)[] = [recolourBulbs(garland(ctx).bulbs, BULBS)];
  const group = new THREE.Group(); group.name = 'event:summer';
  const own: { dispose(): void }[] = [];
  const offs: (() => void)[] = [];
  const reduced = ctx.game?.reducedMotion ?? reducedMotion();
  const rnd = mulberry32(621);
  const canal = canalSpans(ctx);

  /* ---- plan: lanterns on / over the water, hanging from the garlands */
  const L: Lantern[] = [];
  const B3 = SUMMER_BUDGET[3];
  if (canal && canal.spans.length) {
    const total = canal.spans.reduce((a, [x0, x1]) => a + (x1 - x0), 0);
    for (let k = 0; k < B3.water + B3.sky; k++) {
      // spread along the canal proportionally to the span lengths; sky lanterns interleaved
      let u = (k + rnd() * 0.8) / (B3.water + B3.sky) * total, si = 0;
      while (si < canal.spans.length - 1 && u > canal.spans[si][1] - canal.spans[si][0]) { u -= canal.spans[si][1] - canal.spans[si][0]; si++; }
      const [x0, x1] = canal.spans[si], sky = k % 3 === 2 && L.filter((l) => l.kind === 1).length < B3.sky;
      const z = canal.z0 + 0.35 + rnd() * (canal.z1 - canal.z0 - 0.7);
      L.push({ kind: sky ? 1 : 0, x: x0 + Math.min(u, x1 - x0), y: sky ? canal.y + 2.6 + rnd() * 2.2 : canal.y - 0.02, z, x0, x1, s: sky ? 0.58 + rnd() * 0.16 : 0.36 + rnd() * 0.1, ph: rnd() * 6.28, v: (0.08 + rnd() * 0.07) * (sky ? 0.5 : 1), tint: Math.floor(rnd() * TINTS.length) });
    }
  }
  // shuffled, so a low-quality prefix still spreads along the whole canal
  for (let i = L.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [L[i], L[j]] = [L[j], L[i]]; }
  const water = L.filter((l) => l.kind === 0), skyL = L.filter((l) => l.kind === 1);
  // hanging: a festoon of small lanterns along the garland cables (every ~1.15 m, above head height), shuffled so a
  // low-quality prefix still spreads over the whole street
  const hang: Lantern[] = [];
  const cable = garland(ctx).cable;
  if (cable) {
    const cp = cable.geometry.getAttribute('position');
    let carry = 0.4;
    for (let i = 0; i + 1 < cp.count; i += 2) {
      const ax = cp.getX(i), ay = cp.getY(i), az = cp.getZ(i), bx = cp.getX(i + 1), by = cp.getY(i + 1), bz = cp.getZ(i + 1);
      const len = Math.hypot(bx - ax, by - ay, bz - az); if (len < 1e-4) continue;
      let t = carry;
      for (; t < len; t += 1.15) {
        const u = t / len, x = ax + (bx - ax) * u, y = ay + (by - ay) * u, z = az + (bz - az) * u;
        if (y < 2.4 || hang.length >= B3.hang) continue;
        hang.push({ kind: 2, x, y: y - 0.3, z, x0: y, x1: x, s: 0.26 + rnd() * 0.06, ph: rnd() * 6.28, v: 0, tint: Math.floor(rnd() * TINTS.length) });
      }
      carry = t - len;
    }
    for (let i = hang.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [hang[i], hang[j]] = [hang[j], hang[i]]; }
  }
  const all = [...water, ...skyL, ...hang];
  const MAX = Math.max(1, all.length);

  /* ---- lanterns (1 draw) */
  const geo = lanternGeometry(); own.push(geo);
  const mat = new THREE.MeshBasicMaterial({ vertexColors: true }); own.push(mat);
  const lanterns = new THREE.InstancedMesh(geo, mat, MAX); lanterns.name = 'summer:lanterns'; lanterns.frustumCulled = false; lanterns.count = 0;
  for (let i = 0; i < MAX; i++) lanterns.setColorAt(i, _c.setRGB(1, 1, 1));
  group.add(lanterns);

  /* ---- water glow (1 draw): additive streaks on the water surface */
  const glowTex = glowTexture(64, 2.2); own.push(glowTex);
  const qGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2); own.push(qGeo);
  const wMat = new THREE.MeshBasicMaterial({ map: glowTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.55 }); own.push(wMat);
  const wglow = new THREE.InstancedMesh(qGeo, wMat, Math.max(1, water.length + skyL.length)); wglow.name = 'summer:waterglow'; wglow.frustumCulled = false; wglow.renderOrder = 3; wglow.count = 0;
  for (let i = 0; i < water.length + skyL.length; i++) wglow.setColorAt(i, _c.setRGB(1, 1, 1));
  group.add(wglow);

  /* ---- halos (1 draw) */
  const halos = glowPoints(new Array(MAX * 7).fill(0), 7, glowTex, { flicker: 0.08, intensity: 0.55, lit: DN_U.lit, litMin: 0.3 }); halos.name = 'summer:halos'; halos.frustumCulled = false;
  own.push(halos.geometry, halos.material as THREE.Material); group.add(halos);
  const hPos = halos.geometry.getAttribute('position') as THREE.BufferAttribute, hSize = halos.geometry.getAttribute('size') as THREE.BufferAttribute, hCol = halos.geometry.getAttribute('color') as THREE.BufferAttribute;

  /* ---- strings of the hanging lanterns (1 draw) */
  const sGeo = new THREE.BufferGeometry(); own.push(sGeo);
  const sArr = new Float32Array(Math.max(1, hang.length) * 6);
  hang.forEach((h, i) => sArr.set([h.x, h.x0, h.z, h.x, h.y + h.s * 0.5, h.z], i * 6));   // x0 = the cable height
  sGeo.setAttribute('position', new THREE.BufferAttribute(sArr, 3));
  const sMat = new THREE.LineBasicMaterial({ color: '#3a2a22' }); own.push(sMat);
  const strings = new THREE.LineSegments(sGeo, sMat); strings.name = 'summer:strings'; strings.frustumCulled = false; group.add(strings);

  /* ---- fireflies (1 draw): wander + blink in the vertex shader */
  const NF = B3.flies, fPos = new Float32Array(Math.max(1, NF) * 3), fSeed = new Float32Array(Math.max(1, NF));
  if (canal) for (let i = 0; i < NF; i++) {
    const [x0, x1] = canal.spans[i % canal.spans.length], side = i % 2;
    fPos[i * 3] = x0 + rnd() * (x1 - x0); fPos[i * 3 + 2] = side ? canal.z0 - 0.3 - rnd() * 0.9 : canal.z1 + 0.3 + rnd() * 0.9;
    fPos[i * 3 + 1] = LOW_H + 0.4 + rnd() * 1.1; fSeed[i] = rnd();
  }
  const fGeo = new THREE.BufferGeometry(); own.push(fGeo);
  fGeo.setAttribute('position', new THREE.BufferAttribute(fPos, 3)); fGeo.setAttribute('aSeed', new THREE.BufferAttribute(fSeed, 1));
  fGeo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
  const fMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
    uniforms: { uTime: { value: 0 }, uScale: { value: 400 } },
    vertexShader: `attribute float aSeed; uniform float uTime; uniform float uScale; varying float vB;
      void main(){ float t = uTime * (0.35 + aSeed * 0.3) + aSeed * 50.0;
        vec3 p = position + vec3(sin(t) * 0.6 + sin(t * 2.3) * 0.15, sin(t * 1.7) * 0.25, cos(t * 0.8) * 0.35);
        vec4 mv = modelViewMatrix * vec4(p, 1.0); gl_Position = projectionMatrix * mv;
        vB = pow(max(0.0, sin(uTime * (1.1 + aSeed) + aSeed * 31.0)), 3.0) * clamp(1.4 - (-mv.z) / 40.0, 0.0, 1.0);
        gl_PointSize = 0.16 * uScale / max(-mv.z, 0.1); }`,
    fragmentShader: `varying float vB; void main(){ vec2 q = gl_PointCoord * 2. - 1.; float r = dot(q,q); if (r > 1.) discard; gl_FragColor = vec4(vec3(0.85, 1.0, 0.45) * vB * (1. - r) * (1. - r), 1.0); }`,
  }); own.push(fMat);
  const flies = new THREE.Points(fGeo, fMat); flies.name = 'summer:fireflies'; flies.frustumCulled = false; group.add(flies);

  /* ---- quality + per-frame placement */
  let q = ctx.quality(), nW = 0, nS = 0, nH = 0, animate = false, halosOn = false;
  const cam = ctx.camera.position;
  let n = 0, h = 0, w = 0;
  const put = (l: Lantern, x: number, y: number, z: number, s: number, rotY: number, tilt: number) => {
      _e.set(tilt, rotY, tilt * 0.6); _q.setFromEuler(_e); _p.set(x, y, z); _s.set(s, s * 1.15, s); _m.compose(_p, _q, _s); lanterns.setMatrixAt(n++, _m);
      if (halosOn) { const T = TINTS[l.tint]; hPos.setXYZ(h, x, y, z); hSize.setX(h, s * (l.kind === 2 ? 4.6 : 5.6)); hCol.setXYZ(h, T[0] * 0.8, T[1] * 0.7, T[2] * 0.6); h++; }
  };
  const glow = (x: number, z: number, k: number) => {
      // streak from the lantern towards the viewer, lying on the water
      const dx = cam.x - x, dz = cam.z - z, yaw = Math.atan2(dx, dz);
      _e.set(0, yaw, 0); _q.setFromEuler(_e);
      _p.set(x + Math.sin(yaw) * 0.35 * k, canal!.y + 0.015, z + Math.cos(yaw) * 0.35 * k); _s.set(0.55 * k, 1, 1.9 * k); _m.compose(_p, _q, _s); wglow.setMatrixAt(w++, _m);
  };
  const place = (t: number) => {
    n = 0; h = 0; w = 0;
    for (let i = 0; i < nW; i++) {
      const l = water[i], span = l.x1 - l.x0;
      const x = animate ? l.x0 + ((((l.x - l.x0) + l.v * t) % span) + span) % span : l.x;
      const edge = Math.min(1, (x - l.x0) / 0.8, (l.x1 - x) / 0.8);                 // shrink in / out at the bridges
      const s = l.s * Math.max(0.05, edge), bob = animate ? 0.015 * Math.sin(t * 1.3 + l.ph) : 0;
      put(l, x, l.y + s * 0.55 + bob, l.z, s, l.ph + (animate ? t * 0.1 : 0), animate ? 0.05 * Math.sin(t * 0.9 + l.ph) : 0);
      glow(x, l.z, Math.max(0.05, edge));
    }
    for (let i = 0; i < nS; i++) {
      const l = skyL[i], span = l.x1 - l.x0;
      const x = animate ? l.x0 + ((((l.x - l.x0) + l.v * t) % span) + span) % span : l.x;
      const edge = Math.min(1, (x - l.x0) / 1.2, (l.x1 - x) / 1.2), s = l.s * Math.max(0.05, edge);
      const y = l.y + (animate ? 0.18 * Math.sin(t * 0.45 + l.ph) : 0);
      put(l, x, y, l.z + (animate ? 0.2 * Math.sin(t * 0.3 + l.ph) : 0), s, l.ph, animate ? 0.04 * Math.sin(t * 0.7 + l.ph) : 0);
      glow(x, l.z, 0.6 * Math.max(0.05, edge));
    }
    for (let i = 0; i < nH; i++) { const l = hang[i]; put(l, l.x, l.y, l.z, l.s, l.ph + (animate ? 0.3 * Math.sin(t * 0.8 + l.ph) : 0), animate ? 0.06 * Math.sin(t * 1.1 + l.ph) : 0); }
    lanterns.count = n; lanterns.instanceMatrix.needsUpdate = true;
    wglow.count = w; wglow.instanceMatrix.needsUpdate = true;
    if (halosOn) { halos.geometry.setDrawRange(0, h); hPos.needsUpdate = hSize.needsUpdate = hCol.needsUpdate = true; }
  };
  const apply = () => {
    const B = SUMMER_BUDGET[q];
    nW = Math.min(B.water, water.length); nS = Math.min(B.sky, skyL.length); nH = Math.min(B.hang, hang.length);
    animate = B.animate && !reduced; halosOn = B.halos; halos.visible = halosOn;
    flies.visible = B.flies > 0 && !reduced && !!canal; fGeo.setDrawRange(0, B.flies);
    strings.visible = nH > 0; sGeo.setDrawRange(0, nH * 2);
    // instance colours in placement order: water, sky, hanging
    let k = 0;
    for (const list of [water.slice(0, nW), skyL.slice(0, nS), hang.slice(0, nH)]) for (const l of list) { const T = TINTS[l.tint]; lanterns.setColorAt(k++, _c.setRGB(T[0], T[1], T[2])); }
    k = 0; for (const l of [...water.slice(0, nW), ...skyL.slice(0, nS)]) { const T = TINTS[l.tint]; wglow.setColorAt(k++, _c.setRGB(T[0] * 0.7, T[1] * 0.55, T[2] * 0.4)); }
    if (lanterns.instanceColor) lanterns.instanceColor.needsUpdate = true;
    if (wglow.instanceColor) wglow.instanceColor.needsUpdate = true;
    place(0);
  };
  apply();
  offs.push(ctx.onQuality((nq) => { q = nq; apply(); }));

  const hu = (halos.material as THREE.ShaderMaterial).uniforms;
  let last = -1;
  offs.push(ctx.onFrame((_dt, t) => {
    const sc = pointScale(ctx);
    hu.uScale.value = sc; hu.uTime.value = animate ? t : 0; fMat.uniforms.uScale.value = sc; fMat.uniforms.uTime.value = t;
    // static at q0 / reduced motion: the streaks still turn to the viewer, a few times a second is plenty
    if (animate || t - last > 0.25) { last = t; place(t); }
  }));

  ctx.group.add(group);
  group.userData.summer = { lanterns: all.length, water: water.length, sky: skyL.length, hang: hang.length };
  return () => {
    for (const u of offs.reverse()) u();
    group.removeFromParent();
    lanterns.dispose(); wglow.dispose();
    for (const o of own) o.dispose();
    for (const u of undo.reverse()) u();
  };
}

const summer: SeasonalEvent = {
  id: 'summer',
  title: 'Летние фонарики',
  short: 'Фонарики',
  greeting: '🏮 Летний вечер: над каналом плывут бумажные фонарики. Отключить: Настройки → События',
  active: (d) => inWindow(d, SUMMER_FROM, SUMMER_TO),
  distance: (d) => windowDistance(d, SUMMER_FROM, SUMMER_TO),
  setup,
};
export default summer;
export { setup as setupSummer };
