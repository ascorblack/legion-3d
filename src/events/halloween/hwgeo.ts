/**
 * Geometry for «Ночь Тыквенной Луны» (hwcity): the extra decorations as ONE merged vertex-coloured mesh (cauldron,
 * candle trios, the witch on her broom — the witch's vertices carry aFly = 1 and are flown by the vertex shader), and
 * the portal frame (stone arch: pillars, voussoirs, keystone rune, steps; one merged mesh).
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { HwExtras, PortalSpot } from './hwcity';

const _c = new THREE.Color();
/** Parts.add(…, shade = keepColours): keep the geometry's own vertex colours (a merged sub-assembly). */
export const keepColours = Symbol('keep') as unknown as (x: number, y: number, z: number) => number;

/** Tiny merge helper: every part gets position / normal / color (+ aFly). */
export class Parts {
  private list: THREE.BufferGeometry[] = [];
  add(g: THREE.BufferGeometry, color: string | [number, number, number], m?: THREE.Matrix4, fly = 0, shade?: (x: number, y: number, z: number) => number): this {
    let geo = g.index ? g.toNonIndexed() : g;
    const keep = shade === keepColours ? (geo.getAttribute('color') as THREE.BufferAttribute | undefined)?.clone() : undefined;
    if (keep) shade = undefined;
    for (const n of Object.keys(geo.attributes)) if (n !== 'position' && n !== 'normal') geo.deleteAttribute(n);
    if (!geo.getAttribute('normal')) geo.computeVertexNormals();
    if (m) geo.applyMatrix4(m);
    const p = geo.getAttribute('position'), c = new Float32Array(p.count * 3), f = new Float32Array(p.count);
    if (typeof color === 'string') _c.set(color); else _c.setRGB(color[0], color[1], color[2]);
    for (let i = 0; i < p.count; i++) {
      const k = typeof shade === 'function' ? shade(p.getX(i), p.getY(i), p.getZ(i)) : 1;
      c[i * 3] = _c.r * k; c[i * 3 + 1] = _c.g * k; c[i * 3 + 2] = _c.b * k; f[i] = fly;
    }
    geo.setAttribute('color', keep ?? new THREE.BufferAttribute(c, 3));
    geo.setAttribute('aFly', new THREE.BufferAttribute(f, 1));
    this.list.push(geo);
    if (geo !== g) g.dispose();
    return this;
  }
  get empty(): boolean { return this.list.length === 0; }
  build(): THREE.BufferGeometry {
    const g = this.list.length ? mergeGeometries(this.list, false)! : new THREE.BufferGeometry();
    for (const p of this.list) p.dispose();
    this.list = [];
    g.computeBoundingSphere();
    return g;
  }
}

export const M = (x: number, y: number, z: number, rx = 0, ry = 0, rz = 0, sx = 1, sy = sx, sz = sx) =>
  new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz, 'YXZ')), new THREE.Vector3(sx, sy, sz));

/** The witch on a broom at the origin, flying along local +X, ~1.1 m long. Every vertex aFly = 1. */
function witch(p: Parts): void {
  const F = 1;
  // broom: stick + bristle bundle (tail at −X)
  p.add(new THREE.CylinderGeometry(0.025, 0.03, 1.5, 6), '#7a5232', M(0.05, 0, 0, 0, 0, Math.PI / 2), F);
  p.add(new THREE.ConeGeometry(0.17, 0.5, 8, 1, true), '#c99a4a', M(-0.78, 0, 0, 0, 0, -Math.PI / 2), F, (x) => 0.75 + 0.25 * Math.min(1, Math.max(0, (x + 1.0) / 0.5)));
  p.add(new THREE.TorusGeometry(0.06, 0.02, 4, 10), '#5a2a6a', M(-0.52, 0, 0, 0, Math.PI / 2, 0), F);
  // the cat-witch: robe (cone), cape, head with ears, pointy hat with a brim, a little orange band
  p.add(new THREE.ConeGeometry(0.2, 0.46, 9), '#4a2a78', M(0, 0.2, 0), F, (_x, y) => 0.8 + 0.3 * Math.max(0, y / 0.45));
  p.add(new THREE.PlaneGeometry(0.42, 0.36), '#2a1450', M(-0.22, 0.24, 0, 0, Math.PI / 2, 0.5), F);
  p.add(new THREE.PlaneGeometry(0.42, 0.36), '#2a1450', M(-0.22, 0.24, 0, 0, -Math.PI / 2, 0.5), F);
  p.add(new THREE.SphereGeometry(0.15, 10, 8), '#3a3448', M(0.02, 0.5, 0), F);
  for (const s of [-1, 1]) p.add(new THREE.ConeGeometry(0.05, 0.1, 4), '#3a3448', M(0.02, 0.62, s * 0.08, s * 0.35, 0, 0), F);
  for (const s of [-1, 1]) p.add(new THREE.SphereGeometry(0.03, 6, 4), '#b6ff6a', M(0.15, 0.53, s * 0.055), F);
  p.add(new THREE.CylinderGeometry(0.22, 0.22, 0.02, 14), '#1e1430', M(0.0, 0.62, 0), F);
  p.add(new THREE.ConeGeometry(0.13, 0.4, 10), '#1e1430', M(-0.04, 0.82, 0, 0, 0, 0.25), F);
  p.add(new THREE.CylinderGeometry(0.125, 0.13, 0.04, 12), '#ff8a1f', M(0.0, 0.66, 0), F);
  // paws on the stick, tail
  for (const s of [-1, 1]) p.add(new THREE.SphereGeometry(0.04, 6, 4), '#3a3448', M(0.18, 0.04, s * 0.04), F);
  p.add(new THREE.TorusGeometry(0.12, 0.022, 4, 8, Math.PI), '#3a3448', M(-0.2, 0.08, 0.14, Math.PI / 2, 0, 0), F);
}

/** Lathe pot of radius r centred at (x, y, z) on the ground. */
function cauldron(p: Parts, x: number, y: number, z: number, r: number): void {
  const prof: THREE.Vector2[] = [];
  for (let i = 0; i <= 10; i++) { const t = i / 10, a = -Math.PI * 0.5 + t * Math.PI * 0.86; prof.push(new THREE.Vector2(Math.cos(a) * r * (1 - 0.05 * t), r * 0.85 + Math.sin(a) * r * 0.85)); }
  p.add(new THREE.LatheGeometry(prof, 16), '#2b2838', M(x, y + 0.06, z), 0, (_x, yy) => 0.75 + 0.5 * Math.max(0, (yy - y) / (r * 1.6)));
  const top = y + 0.06 + r * 0.85 + Math.sin(Math.PI * 0.36) * r * 0.85;
  p.add(new THREE.TorusGeometry(r * 0.83, 0.045, 6, 18), '#46425a', M(x, top, z, Math.PI / 2, 0, 0));
  // the brew: bright lime (self-lit through the vertex colour > 1), bubbles
  p.add(new THREE.CircleGeometry(r * 0.8, 18), [0.55 * 2.2, 1.0 * 2.2, 0.3 * 2.2], M(x, top - 0.035, z, -Math.PI / 2, 0, 0));
  for (let i = 0; i < 4; i++) { const a = i * 1.7; p.add(new THREE.SphereGeometry(0.05 + (i % 2) * 0.03, 6, 4), [0.7 * 2, 1.0 * 2, 0.4 * 2], M(x + Math.cos(a) * r * 0.42, top - 0.01, z + Math.sin(a) * r * 0.42, 0, 0, 0, 1, 0.6, 1)); }
  for (let i = 0; i < 3; i++) { const a = i * Math.PI * 2 / 3 + 0.4; p.add(new THREE.CylinderGeometry(0.035, 0.03, 0.16, 5), '#1e1c28', M(x + Math.cos(a) * r * 0.6, y + 0.08, z + Math.sin(a) * r * 0.6)); }
  // a few logs and embers under it
  for (let i = 0; i < 3; i++) p.add(new THREE.CylinderGeometry(0.04, 0.04, r * 1.5, 5), '#4a3020', M(x, y + 0.04, z, 0, i * 1.05, Math.PI / 2));
  p.add(new THREE.CircleGeometry(r * 0.5, 10), [1.6, 0.55, 0.12], M(x, y + 0.012, z, -Math.PI / 2, 0, 0));
}

function candle(p: Parts, x: number, y: number, z: number, h: number): void {
  p.add(new THREE.CylinderGeometry(0.035, 0.04, h, 7), '#efe4cc', M(x, y + h / 2, z), 0, (_x, yy) => 0.78 + 0.3 * Math.min(1, (yy - y) / h));
  p.add(new THREE.CylinderGeometry(0.045, 0.05, 0.02, 7), '#d8c8a8', M(x, y + h * 0.15, z));   // a wax drip ring
  p.add(new THREE.ConeGeometry(0.022, 0.07, 6), [2.2, 1.5, 0.5], M(x, y + h + 0.04, z));
}

/** Cauldron + candles + witch: one geometry. Returns null when there is nothing to draw. */
export function extrasGeometry(e: HwExtras): THREE.BufferGeometry {
  const p = new Parts();
  if (e.cauldron) cauldron(p, e.cauldron.x, e.cauldron.y, e.cauldron.z, e.cauldron.r);
  for (const c of e.candles) candle(p, c.x, c.y, c.z, c.h);
  const w = new Parts(); witch(w);
  p.add(w.build(), '#ffffff', new THREE.Matrix4().makeScale(1.7, 1.7, 1.7), 1, keepColours);
  return p.build();
}

/** Flame / brew glow points (x, y, z, size, r, g, b) for the extras — goes into the halo points. */
export function extrasGlows(e: HwExtras): number[] {
  const out: number[] = [];
  if (e.cauldron) { const c = e.cauldron; out.push(c.x, c.y + c.r * 1.7, c.z, 2.2, 0.45, 1.0, 0.3); }
  for (let i = 0; i < e.candles.length; i += 3) {
    const c = e.candles[i + 1] ?? e.candles[i];
    out.push(c.x, c.y + c.h + 0.06, c.z, 0.9, 1.0, 0.62, 0.2);
  }
  return out;
}

/* ------------------------------------------------------------------ portal frame */

/**
 * Stone arch around the portal opening (w × h, round top), built in the portal's local space: origin at the bottom
 * centre of the opening, the opening in the plane z = 0, the street towards +z. Pillars, 13 voussoirs with a glowing
 * keystone rune, a step, small spikes on top; mossy violet stone, the rune and cracks lime-green.
 */
export function portalFrameGeometry(s: Pick<PortalSpot, 'w' | 'h' | 'depth' | 'outerW'>): THREE.BufferGeometry {
  const p = new Parts();
  const w = s.w, h = s.h, d = s.depth, r = w / 2, yc = h - r, pw = s.outerW - r;
  const stone = '#5a5474', stoneL = '#6e6890', stoneD = '#2c2840', INK = '#120f22', LIME: [number, number, number] = [0.55 * 2.4, 1.0 * 2.4, 0.3 * 2.4];
  const sh = (_x: number, y: number) => 0.8 + 0.3 * Math.min(1, y / (h + 0.4));
  const O = 0.05;   // cartoon outline: a dark copy of every block, a bit bigger and just behind the front faces
  for (const sx of [-1, 1]) {
    const cx = sx * (r + pw / 2);
    p.add(new THREE.BoxGeometry(pw + O * 2, yc + 0.02 + O, d - 0.02), INK, M(cx, (yc + 0.02 + O) / 2, -0.012));
    p.add(new THREE.BoxGeometry(pw, yc + 0.02, d), stone, M(cx, (yc + 0.02) / 2, 0), 0, sh);
    for (let k = 1; k < 4; k++) p.add(new THREE.BoxGeometry(pw - 0.04, 0.035, 0.012), stoneD, M(cx, k * yc / 4, d / 2 + 0.004));   // mortar courses (relief)
    p.add(new THREE.BoxGeometry(pw + 0.14, 0.18, d + 0.08), stoneD, M(cx, 0.09, 0));                                                    // plinth
    p.add(new THREE.BoxGeometry(pw + 0.1, 0.1, d + 0.06), stoneL, M(cx, yc + 0.02, 0));                                               // impost
    p.add(new THREE.BoxGeometry(0.03, yc * 0.5, 0.012), LIME, M(cx, yc * 0.42, d / 2 + 0.006));                                          // rune line
    for (const yy of [yc * 0.2, yc * 0.64]) p.add(new THREE.CircleGeometry(0.05, 8), LIME, M(cx, yy, d / 2 + 0.007));
  }
  const N = 11, R0 = r, R1 = r + pw;
  for (let i = 0; i < N; i++) {
    const a0 = Math.PI * i / N, a1 = Math.PI * (i + 1) / N, am = (a0 + a1) / 2, rm = (R0 + R1) / 2;
    const key = i === (N - 1) / 2, len = (R1 - R0) * (key ? 1.22 : 1), wid = 2 * rm * Math.sin((a1 - a0) / 2) - 0.025, off = key ? 0.05 : 0;
    const m = (ex: number, z: number) => M(Math.cos(am) * (rm + off), yc + Math.sin(am) * (rm + off), z, 0, 0, am - Math.PI / 2, 1, 1, 1).multiply(new THREE.Matrix4().makeScale(1 + ex / wid, 1 + ex / len, 1));
    p.add(new THREE.BoxGeometry(wid, len, d - 0.02), INK, m(O * 2, -0.012));
    p.add(new THREE.BoxGeometry(wid, len, d + (key ? 0.05 : 0)), key ? stoneL : i % 2 ? stone : stoneL, m(0, 0), 0, sh);
    if (key) p.add(new THREE.CircleGeometry(0.075, 10), LIME, M(0, yc + rm + off + 0.02, d / 2 + 0.03));
  }
  // lime rim along the opening (inner edge): a half torus over two posts
  p.add(new THREE.TorusGeometry(r + 0.005, 0.022, 5, 24, Math.PI), LIME, M(0, yc, d / 2 + 0.004));
  for (const sx of [-1, 1]) p.add(new THREE.CylinderGeometry(0.022, 0.022, yc, 5), LIME, M(sx * (r + 0.005), yc / 2, d / 2 + 0.004));
  // spikes on the arch
  for (const a of [0.3, 0.78, 2.36, 2.84]) p.add(new THREE.ConeGeometry(0.06, 0.26, 4), stoneD, M(Math.cos(a) * (R1 + 0.1), yc + Math.sin(a) * (R1 + 0.1), 0, 0, 0, a - Math.PI / 2));
  // the step in front of the opening
  p.add(new THREE.BoxGeometry(w + 0.1, 0.06, d), stoneD, M(0, 0.03, 0));
  return p.build();
}
