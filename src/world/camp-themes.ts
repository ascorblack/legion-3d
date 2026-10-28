/**
 * Per-style looks of the start camp (site campart.js THEMES[style]), as data + themed builders the camp (camp.ts) calls
 * instead of its defaults. A style without an entry here keeps the default «Перепутье» look.
 *
 *   'cherts' — «Чёртов привал»: ash ground with fire cracks, volcanoes with lava under a crimson sky, sharp rocks instead
 *   of the forest, tents in black / crimson / ember canvas with horns on the ridge ends and a bat-wing ornament over the
 *   entrance, a green brew in the cauldron, a pitchfork rack, coal heaps instead of the woodpile, green-fire lanterns,
 *   a tar barrel instead of the water tub. Colours derived from the site's theme; the 3D shapes are ours.
 *
 * Everything static, merged into the city Batch like the rest of the camp (no draw calls of its own).
 */
import * as THREE from 'three';
import type { CityLayout } from '../contracts';
import type { CampScene } from '../net/town';
import type { Pal } from './palette';
import { toX, toZ, SZ } from './coords';
import { GEO, GEO2, M } from './batch';
import { type Ctx, box, rbox, cyl, cone, ball, shade } from './kit';

type Tent = CampScene['tents'][number];
type Prop = CampScene['props'][number];
/** The camp's own pieces a theme may reuse (camp.ts passes them in). */
export interface CampParts {
  flame(k: Ctx, X: number, Y: number, Z: number, s: number, pool?: number): void;
  solid(k: Ctx, x0: number, x1: number, z0: number, z1: number, top: number): void;
  tentH: Record<string, number>;
}
export interface CampTheme {
  id: string;
  /** Sky (CSS gradient like the site's), ground ('paving' = grass texture colours) and trails ('lowPaving' = soil). */
  sky: string; grass: [string, string, string]; soil: [string, string, string];
  /** Hemisphere light (sky, ground) and the ambient tint: the scene's mood. */
  hemi: [string, string]; ambient: string;
  /** Palette overrides while the camp is built (palisade wood, stones, flags…). */
  pal: Partial<Pal>;
  /** Washing-line clothes. */
  cloth: string[];
  /** Far backdrop instead of the forest + hills ring (cx, cz = camp centre, fz = fence z). */
  far(k: Ctx, L: CityLayout, c: CampScene, cx: number, cz: number): void;
  campfire(k: Ctx, f: CampScene['fire'], P: CampParts): void;
  tent(k: Ctx, t: Tent, i: number, P: CampParts): void;
  /** A themed prop; false = not handled (the default prop is built). */
  prop(k: Ctx, p: Prop, P: CampParts): boolean;
  /** Extra ground decor (lava cracks…). */
  ground(k: Ctx, c: CampScene): void;
}

/* ------------------------------------------------------------------ «Чёртов привал» */
const INK = '#2a0d14', GOLD = '#ffc83d', BREW = '#8aff6a';
const CH_CANVAS: [string, string][] = [['#3a1a2a', '#c8202a'], ['#5a2030', '#ffc83d'], ['#2a2028', '#ff6a1a'], ['#7a1a2a', '#2a0d14'], ['#4a2a4a', '#8aff6a']];

/** A glowing crack on the ground: a zig-zag of emissive strips with a dark charred rim (px centre, px radius). */
function groundCrack(k: Ctx, x: number, y: number, r: number, seed: number): void {
  let s = seed * 7919 + 13;
  const rnd = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
  const X = toX(x), Z = toZ(y), R = r * 0.028;   // the site's r is screen px of a pseudo-perspective view: ≈ 2 m
  for (let arm = 0; arm < 3; arm++) {
    let a = rnd() * Math.PI * 2, px = X, pz = Z;
    for (let i = 0; i < 3; i++) {
      const len = R * (0.4 + rnd() * 0.3), nx = px + Math.cos(a) * len, nz = pz + Math.sin(a) * len, w = 0.17 - i * 0.04;
      const mx = (px + nx) / 2, mz = (pz + nz) / 2, ry = -a;
      rbox(k, 'flat', '#1a0a0e', mx, 0.02, mz, len + 0.1, 0.004, w + 0.1, ry);   // layers ≥ 4 mm apart (no z-fight)
      rbox(k, 'emit', '#d23a0c', mx, 0.03 + i * 0.0045, mz, len + 0.03, 0.004, w, ry);
      rbox(k, 'emit', '#ffb43a', mx, 0.046 + i * 0.0045, mz, len * 0.8, 0.004, w * 0.3, ry);
      px = nx; pz = nz; a += (rnd() - 0.5) * 1.3;
    }
  }
  k.glows.push(X, 0.12, Z, 1.3, 1, 0.42, 0.15);
}

/** A volcano: a truncated cone, meandering lava streaks down the flank facing the camp, a glowing crater, a dark plume. */
function volcano(k: Ctx, x: number, z: number, rb: number, h: number, col: string, face: number): void {
  const g = new THREE.CylinderGeometry(rb * 0.17, rb, h, 14, 1, true);
  k.b.add('back', g, M(x, h / 2 - 2, z), col, 1); g.dispose();
  k.b.add('back', GEO.cyl16, M(x, h - 2 + 0.2, z, rb * 0.34, 0.4, rb * 0.34), shade(col, -0.2), 1);
  k.b.add('emit', GEO.cyl16, M(x, h - 2 + 0.45, z, rb * 0.28, 0.3, rb * 0.28), '#ffb43a', 1);
  // lava streaks (the site's two curved strokes from the crater): tubes that meander down the flank facing the camp,
  // a dark-orange body with a yellow core just proud of it; each tapers as it cools
  const y0 = h - 2, rTop = rb * 0.17;
  for (const [da, len, w, wig] of [[-0.14, 0.7, 3.4, 0.06], [0.1, 0.9, 2.8, -0.08]] as const) {
    const body: THREE.Vector3[] = [], core: THREE.Vector3[] = [];
    for (let q = 0; q <= 8; q++) {
      const t = (q / 8) * len, a = face + da + wig * Math.sin(t * 9 + da * 7) + wig * 0.6 * t, r = rTop + (rb - rTop) * t;
      body.push(new THREE.Vector3(x + Math.cos(a) * (r + w * 0.1), y0 - h * t, z + Math.sin(a) * (r + w * 0.1)));
      core.push(new THREE.Vector3(x + Math.cos(a) * (r + w * 0.62), y0 - h * t, z + Math.sin(a) * (r + w * 0.62)));   // a ridge proud of the body
    }
    for (const [pts, rad, c] of [[body, w * 0.5, '#b8300a'], [core, w * 0.17, '#ffb428']] as const) {
      const tg = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 16, rad, 5, false), p = tg.attributes.position, ring = 6;
      // taper towards the foot (rings of the tube along its length)
      for (let i = 0; i <= 16; i++) {
        const kk = 1 - 0.55 * (i / 16), c0 = new THREE.Vector3();
        for (let jj = 0; jj < ring; jj++) c0.x += p.getX(i * ring + jj) / ring, c0.y += p.getY(i * ring + jj) / ring, c0.z += p.getZ(i * ring + jj) / ring;
        for (let jj = 0; jj < ring; jj++) { const n = i * ring + jj; p.setXYZ(n, c0.x + (p.getX(n) - c0.x) * kk, c0.y + (p.getY(n) - c0.y) * kk, c0.z + (p.getZ(n) - c0.z) * kk); }
      }
      k.b.add('emit', tg, new THREE.Matrix4(), c, 1); tg.dispose();
    }
  }
  // a hot rim round the crater, and a dark plume of smoke drifting off it (the site's smoke stroke)
  // (seen from the camp below: a glowing band round the summit, yellow over orange — the top face never shows)
  const rAt = (dy: number) => 2.1 * (rTop + (rb - rTop) * dy / h);   // the band's diameter: just proud of the flank `dy` under the top
  k.b.add('emit', GEO.cyl16, M(x, y0 - 0.325, z, rAt(0.9), 1.15, rAt(0.9)), '#ffb020', 1);   // y0 − 0.9 … y0 + 0.25
  k.b.add('emit', GEO.cyl16, M(x, y0 - 1.325, z, rAt(1.8), 0.95, rAt(1.8)), '#e8500e', 1);   // y0 − 1.8 … y0 − 0.85
  k.glows.push(x, y0 + 1, z, rb * 0.9, 1, 0.75, 0.3);
  for (let q = 0; q < 4; q++) {
    const sz = rb * (0.12 + q * 0.06), dx = Math.cos(face + Math.PI / 2) * (q + 1) * rb * 0.12;
    k.b.add('back', GEO.sphere, M(x + dx, y0 + rb * 0.5 + q * rb * 0.3, z + Math.sin(face + Math.PI / 2) * (q + 1) * rb * 0.12, sz * 2, sz * 1.5, sz * 2), q % 2 ? '#3a1a24' : '#4a2a32', 1);
  }
  k.glows.push(x, h - 1, z, rb * 1.4, 1, 0.45, 0.15);
}

/** Bat-wing ornament: two flat wings with a scalloped lower edge spreading from (X, Y, Z) along ±x, facing ±x (s). */
function batWings(k: Ctx, X: number, Y: number, Z: number, span: number, col: string): void {
  for (const sd of [-1, 1]) {
    const pts: THREE.Vector2[] = [new THREE.Vector2(0, 0.06), new THREE.Vector2(0.25, 0.32), new THREE.Vector2(0.6, 0.38), new THREE.Vector2(1, 0.24)];
    const tips: [number, number][] = [[1, 0.24], [0.74, -0.06], [0.46, -0.1], [0.18, -0.08], [0, -0.04]];
    for (let i = 0; i + 1 < tips.length; i++) {
      const [ax, ay] = tips[i], [bx, by] = tips[i + 1];
      for (let q = 1; q < 4; q++) { const t = q / 4; pts.push(new THREE.Vector2(ax + (bx - ax) * t, ay + (by - ay) * t + Math.sin(t * Math.PI) * 0.1)); }
      pts.push(new THREE.Vector2(bx, by));
    }
    const g = new THREE.ShapeGeometry(new THREE.Shape(pts));
    // the wing plane is the tent's gable plane (x = const), spreading along ±z
    k.b.add('flat', g, M(X, Y, Z, 1, span, span, 0, sd * Math.PI / 2, 0), col, 1); g.dispose();
  }
}

/** Curved cream horns on top of a ridge pole end (towards ±x). */
function ridgeHorns(k: Ctx, X: number, Y: number, Z: number, s: number, sc: number): void {
  for (const sz of [-1, 1]) {
    const pts = [[0, 0, 0], [s * 0.03, 0.1, sz * 0.06], [s * 0.02, 0.22, sz * 0.13], [-s * 0.04, 0.3, sz * 0.15]].map(([a, b, c]) => new THREE.Vector3(X + a * sc, Y + b * sc, Z + c * sc));
    const g = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 8, 0.035 * sc, 6, false);
    // taper: scale the ring radius along the tube
    const p = g.attributes.position, n = 8 + 1, ring = 7;
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1), c = new THREE.Vector3(); for (let j = 0; j < ring; j++) c.add(new THREE.Vector3().fromBufferAttribute(p, i * ring + j)); c.divideScalar(ring);
      for (let j = 0; j < ring; j++) { const v = new THREE.Vector3().fromBufferAttribute(p, i * ring + j); v.sub(c).multiplyScalar(1 - 0.85 * t).add(c); p.setXYZ(i * ring + j, v.x, v.y, v.z); }
    }
    g.computeVertexNormals();
    k.b.add('flat', g, new THREE.Matrix4(), '#f3e6c8', 1); g.dispose();
  }
}

/** A pitchfork standing upright at (x, z): wooden shaft, iron head with three tines. */
function pitchforkUp(k: Ctx, x: number, z: number, h: number, tilt = 0): void {
  rbox(k, 'wood', '#a86a4a', x, h / 2, z, 0.04, h, 0.04, 0, tilt, 0);
  const tz = z + Math.sin(tilt) * h, hy = Math.cos(tilt) * h;
  box(k, 'metal', '#8a8e9e', x - 0.13, x + 0.13, hy, hy + 0.035, tz - 0.02, tz + 0.02);
  for (const dx of [-0.12, 0, 0.12]) { const th = dx ? 0.2 : 0.26; box(k, 'metal', '#8a8e9e', x + dx - 0.016, x + dx + 0.016, hy, hy + th, tz - 0.016, tz + 0.016); cone(k, 'metal', '#c8ccd4', x + dx, hy + th, tz, 0.025, 0.06, true); }
}

export const CHERTS_CAMP: CampTheme = {
  id: 'cherts',
  sky: 'linear-gradient(#14040a 0%, #3a0a14 45%, #7a1a1a 100%)',
  grass: ['#3e2a2c', '#342226', '#6a3a32'], soil: ['#5a3a34', '#3a2224', '#7a4a3e'],
  hemi: ['#ff8a7a', '#3a1414'], ambient: '#7a3a4a',
  pal: { wood: '#7a4a3a', woodD: '#4a2a22', woodL: '#a86a4a', stone: '#5a4a52', metal: '#2a2028', flag: '#c8202a', hill: '#2a0a12', leafD: '#3a1018', glass: '#ffe27a' },
  cloth: ['#c8202a', '#2a0d14', '#ffc83d', '#e8455c', '#5a2030'],

  far(k, L, c, cx, cz) {
    const W = toX(L.W), fz = toZ(c.fence.y);
    let s = 77;
    const rnd = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
    // sharp black rocks round the camp where the forest stands elsewhere
    const spire = (x: number, z: number, sc: number) => {
      k.b.add('back', GEO.cone4, M(x, sc * 1.1, z, sc * 0.9, sc * 2.2, sc * 0.8, 0, rnd() * 3, (rnd() - 0.5) * 0.25), shade('#3a1018', (rnd() - 0.5) * 0.2), 1);
      if (rnd() < 0.5) k.b.add('back', GEO.cone4, M(x + sc * 0.5, sc * 0.6, z + 0.3, sc * 0.5, sc * 1.2, sc * 0.5, 0, rnd() * 3, 0.2), '#2a0a12', 1);
    };
    for (let X = -6; X < W + 6; X += 2.6 + rnd() * 2.2) { spire(X, -4.5 - rnd() * 6, 0.8 + rnd() * 0.9); spire(X + 0.8, fz + 2.5 + rnd() * 6, 0.7 + rnd() * 0.9); }
    for (let Z = -2; Z < fz + 2; Z += 2.8 + rnd() * 1.8) { spire(toX(c.fence.x0) - 2.4 - rnd() * 4, Z, 0.8 + rnd() * 0.8); spire(toX(c.fence.x1) + 2.4 + rnd() * 4, Z, 0.8 + rnd() * 0.8); }
    // a ring of jagged dark crags
    for (let i = 0; i < 120; i++) {
      const a = (i / 120) * Math.PI * 2 + rnd() * 0.03, R = 38 + rnd() * 16, h = 3 + rnd() * 5;
      k.b.add('back', GEO.cone4, M(cx + Math.cos(a) * R * 1.2, h / 2 - 1, cz + Math.sin(a) * R, 3 + rnd() * 3, h, 3 + rnd() * 3, 0, rnd() * 3, 0), shade('#2a0a12', (rnd() - 0.5) * 0.3), 1);
    }
    // volcanoes: two big ones behind the camp, one each side, one smaller in front
    // (inside the fog's near half: the far ones would fade into the horizon glow)
    for (const [a, R, rb, h, col] of [[-1.95, 62, 30, 52, '#22060c'], [-1.3, 70, 34, 62, '#22060c'], [-2.6, 58, 22, 36, '#2a0a10'], [-0.6, 64, 24, 40, '#2a0a10'], [0.3, 66, 18, 26, '#22060c'], [2.9, 62, 18, 24, '#2a0a10'], [1.6, 70, 16, 22, '#22060c']] as const) {
      const x = cx + Math.cos(a) * R * 1.15, z = cz + Math.sin(a) * R;
      volcano(k, x, z, rb, h, col, Math.atan2(cz - z, cx - x));
    }
    // the hills ring as a low dark band (same place as the default one)
    const segs = 96, RR = 170, pos: number[] = [];
    for (let i = 0; i < segs; i++) {
      const a0 = i / segs * Math.PI * 2, a1 = (i + 1) / segs * Math.PI * 2;
      const h0 = 12 + Math.abs(Math.sin(i * 1.7)) * 9, h1 = 12 + Math.abs(Math.sin((i + 1) * 1.7)) * 9;
      const p = (a: number, y: number) => [cx + Math.cos(a) * RR, y, cz + Math.sin(a) * RR];
      pos.push(...p(a0, -10), ...p(a1, -10), ...p(a1, h1), ...p(a0, -10), ...p(a1, h1), ...p(a0, h0));
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.computeVertexNormals();
    k.b.add('back', g, new THREE.Matrix4(), '#3a1018', 1); g.dispose();
  },

  campfire(k, f, P) {
    const X = toX(f.x), Z = toZ(f.y), rx = toX(f.rx), rz = f.ry * SZ, pal = k.pal;
    // a ring of dark basalt stones, an ember bed, coals, flames
    for (let i = 0; i < 14; i++) { const a = i / 14 * Math.PI * 2; ball(k, 'stone', shade('#3a3038', (i % 3) * 0.08 - 0.05), X + Math.cos(a) * rx * 0.62, 0.06, Z + Math.sin(a) * rz * 0.75, 0.13 + (i % 2) * 0.03, 0.6); }
    k.b.add('flat', GEO.cyl16, M(X, 0.02, Z, rx * 1.1, 0.03, rz * 1.3), '#1a0e10', 1);
    k.b.add('emit', GEO.cyl16, M(X, 0.04, Z, rx * 0.6, 0.02, rz * 0.75), '#c2401a', 1);
    for (let i = 0; i < 9; i++) { const a = i * 2.4; k.b.add('emit', GEO.sphere, M(X + Math.cos(a) * rx * 0.22, 0.06, Z + Math.sin(a) * rz * 0.3, 0.09, 0.05, 0.07), i % 2 ? '#ff6a1a' : '#ffb347', 1); }
    for (let i = 0; i < 5; i++) { const a = i / 5 * Math.PI * 2 + 0.3; rbox(k, 'wood', '#2a1a1a', X + Math.cos(a) * 0.17, 0.24, Z + Math.sin(a) * 0.17, 0.09, 0.55, 0.09, -a, 0, 0.55, 0.5); }
    P.flame(k, X, 0.06, Z, 1.3, 9);
    // iron tripod + the cauldron of green brew, bubbling
    const tz = Z - 0.05;
    for (let i = 0; i < 3; i++) {
      const a = i / 3 * Math.PI * 2 + 0.5, lx = X + Math.cos(a) * rx * 0.7, lz = tz + Math.sin(a) * rz * 0.85;
      const dx = X - lx, dz = tz - lz, hh = 1.55, L = Math.hypot(dx, hh, dz);
      const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(dx, hh, dz).normalize()), e = new THREE.Euler().setFromQuaternion(q);
      k.b.add('metal', GEO.cyl8, M((X + lx) / 2, hh / 2, (tz + lz) / 2, 0.04, L, 0.04, e.x, e.y, e.z), '#3a3346', 0.5);
    }
    box(k, 'metal', '#3a3446', X - 0.008, X + 0.008, 0.95, 1.5, tz - 0.008, tz + 0.008);
    k.b.add('metal', GEO.sphere, M(X, 0.82, tz, 0.52, 0.4, 0.52), '#2a2028', 1);
    k.b.add('metal', GEO.cyl16, M(X, 0.98, tz, 0.46, 0.05, 0.46), '#5a5470', 1);
    k.b.add('emit', GEO.cyl16, M(X, 1.012, tz, 0.38, 0.02, 0.38), '#4ac83a', 1);
    for (const [dx, dz, r] of [[-0.08, 0.04, 0.05], [0.07, -0.05, 0.04], [0.02, 0.08, 0.03]] as const) k.b.add('emit', GEO.sphere, M(X + dx, 1.03, tz + dz, r * 2, r * 1.4, r * 2), BREW, 1);
    k.glows.push(X, 1.15, tz, 1.4, 0.55, 1, 0.42);
    // benches: charred logs
    for (const lg of f.logs) {
      const [x, y, lrx, lry, deg] = lg;
      const r = Math.min(0.2, (lry || 14) * SZ * 0.55), L = toX(lrx * 2) - 0.1;
      k.b.add('wood', GEO.cyl12, M(toX(x), r, toZ(y), r * 2, L, r * 2, 0, (deg || 0) * Math.PI / 180, Math.PI / 2), shade(pal.wood, -0.25), 0.6);
      const hx = L / 2 + 0.05, hz = r + 0.05;
      P.solid(k, toX(x) - hx, toX(x) + hx, toZ(y) - hz, toZ(y) + hz, r * 2);
    }
    k.colliders.push(X - rx * 0.7, X + rx * 0.7, 0, 1.2, Z - rz, Z + rz);
    P.solid(k, X - rx * 0.7, X + rx * 0.7, Z - rz * 0.9, Z + rz * 0.9, Infinity);
  },

  tent(k, t, i, P) {
    const X = toX(t.x), z0 = toZ(t.y - t.d), z1 = toZ(t.y), Z = (z0 + z1) / 2;
    const hw = toX(t.w / 2 - 8), D = z1 - z0 + 0.1, h = P.tentH[t.k] ?? 1.5, [col, trim] = CH_CANVAS[i % CH_CANVAS.length], len = hw * 2;
    k.b.add('canvas', GEO2.gable, M(X, 0, Z, len, h, D), col, [len / 1.2, 1]);
    k.b.add('canvas', GEO2.gableEnds, M(X, 0, Z, len, h, D), shade(col, -0.12), 1);
    // a stripe down each slope in the trim colour
    for (const sz of [-1, 1]) { const zz = Z + sz * D * 0.25; rbox(k, 'canvas', trim, X, h * 0.5 + 0.005, zz, len * 0.98, 0.02, 0.08, 0, sz * Math.atan2(D / 2, h), 0); }
    // iron ridge pole, end poles; horns on both ridge ends
    box(k, 'metal', '#2a2028', X - hw - 0.08, X + hw + 0.08, h - 0.03, h + 0.05, Z - 0.035, Z + 0.035, 0.5);
    for (const s of [-1, 1]) { cyl(k, 'wood', '#4a2a22', X + s * (hw + 0.05), 0, Z, 0.035, h + 0.18, 8, 0.5); ridgeHorns(k, X + s * (hw + 0.05), h + 0.12, Z, s, t.k === 'big' ? 1.4 : 1.1); }
    // entrance (dark opening, ember glow), a bat-wing ornament over it
    const s = t.flip ? 1 : -1, ex = X + s * (hw + 0.012), oh = h * 0.72, ow = D * 0.5;
    k.b.add('flat', GEO2.gableEnds, M(ex + s * 0.02, 0, Z, 0.04, oh, ow), '#14040a', 1);
    k.glows.push(ex + s * 0.1, oh * 0.35, Z, 0.9, 1, 0.45, 0.2);
    batWings(k, ex + s * 0.03, h * 0.78, Z, Math.min(1.1, D * 0.55), '#2a1420');
    // a green-fire lantern on the entrance pole
    const lx = X + s * (hw + 0.05), ly = Math.min(h, 1.35);
    box(k, 'metal', '#2a2028', lx - 0.06, lx + 0.06, ly - 0.02, ly + 0.02, Z + 0.06, Z + 0.18);
    k.b.add('emit', GEO.cyl8, M(lx, ly - 0.14, Z + 0.12, 0.1, 0.16, 0.1), BREW, 1);
    k.glows.push(lx, ly - 0.14, Z + 0.12, 1.0, 0.55, 1, 0.42);
    (k.pools ||= []).push(lx + s * 0.4, ly - 0.2, Z + 0.3, 3.2, 0.5, 1, 0.4, 1.0);
    // scalloped hem along the eaves (bat-wing edge)
    for (const zz of [z0 - 0.04, z1 + 0.04]) for (let q = 0; q < Math.max(3, Math.round(len / 0.32)); q++) {
      const n = Math.max(3, Math.round(len / 0.32)), x = X - hw + (q + 0.5) * len / n;
      k.b.add('canvas', GEO.cone4, M(x, 0.1, zz, len / n * 0.9, 0.16, 0.02, Math.PI, 0, 0), trim, 1);
    }
    rbox(k, 'canvas', shade(col, 0.1), ex + s * 0.07, oh * 0.45, Z + ow * 0.42, 0.03, oh * 0.9, ow * 0.32, 0, 0, s * 0.15, 1);
    k.colliders.push(X - hw, X + hw, 0, h, z0, z1);
    P.solid(k, X - hw - 0.05, X + hw + 0.05, z0, z1, Infinity);
  },

  prop(k, p, P) {
    const X = toX(p.x), Z = toZ(p.y - (p.e ? p.e[1] * 0.4 : 0)), ex = p.e ? toX(p.e[0]) : 0.2, ez = p.e ? p.e[1] * SZ : 0.1;
    switch (p.k) {
      case 'rack': {   // pitchfork rack: an iron frame, five pitchforks standing in it
        for (const s of [-1, 1]) cyl(k, 'wood', '#4a2a22', X + s * (ex - 0.06), 0, Z, 0.05, 1.05, 8, 0.5);
        for (const y of [0.3, 0.95]) box(k, 'metal', '#2a2028', X - ex, X + ex, y, y + 0.06, Z - 0.04, Z + 0.04, 0.5);
        for (let i = 0; i < 5; i++) pitchforkUp(k, X - ex + 0.3 + i * (ex * 2 - 0.6) / 4, Z + 0.07, 1.55, -0.08);
        k.colliders.push(X - ex, X + ex, 0, 1.3, Z - ez, Z + ez);
        P.solid(k, X - ex * 0.85, X + ex * 0.85, Z - ez * 0.7, Z + ez * 0.7, Infinity); return true;
      }
      case 'woodpile': {   // a heap of coal: a dark mound, coal lumps with glowing hearts
        k.b.add('back', GEO.dome, M(X, 0, Z, ex * 2, 0.75, ez * 2 + 0.3), '#2a2028', 1);
        for (const [dx, dy] of [[-0.55, 0.22], [-0.15, 0.48], [0.28, 0.32], [0.55, 0.14], [-0.25, 0.12], [0.05, 0.62]] as const) {
          const x = X + dx * ex, y = dy * 0.75;
          k.b.add('stone', GEO.cone4, M(x, y, Z - ez * 0.3, 0.2, 0.16, 0.18, 0.4, dx * 3, 0.3), '#3a3038', 1);
          k.b.add('emit', GEO.sphere, M(x, y + 0.02, Z - ez * 0.3 - 0.09, 0.06, 0.06, 0.03), '#ff6a1a', 1);
        }
        k.glows.push(X, 0.4, Z - ez * 0.4, 1.2, 1, 0.42, 0.15);
        P.solid(k, X - ex, X + ex, Z - ez, Z + ez, 0.55); return true;
      }
      case 'torch': {   // green-fire lantern on a pole
        cyl(k, 'wood', '#4a2a22', X, 0, Z, 0.045, 1.25, 8, 0.5);
        box(k, 'metal', '#2a2028', X - 0.1, X + 0.1, 1.25, 1.29, Z - 0.1, Z + 0.1);
        k.b.add('emit', GEO.box, M(X, 1.45, Z, 0.13, 0.32, 0.13), BREW, 1);
        for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) box(k, 'metal', '#2a2028', X + dx * 0.085 - 0.015, X + dx * 0.085 + 0.015, 1.29, 1.62, Z + dz * 0.085 - 0.015, Z + dz * 0.085 + 0.015);
        k.b.add('metal', GEO.cone4, M(X, 1.68, Z, 0.26, 0.14, 0.26), '#2a2028', 1);
        k.glows.push(X, 1.45, Z, 2.0, 0.55, 1, 0.42);
        (k.pools ||= []).push(X, 1.4, Z, 5, 0.5, 1, 0.4, 1.4); k.lights.push(X, 1.5, Z);
        return true;
      }
      case 'well': {   // a tar barrel («СМОЛА»): dark staves, iron hoops, black glossy tar
        k.b.add('wood', GEO.cyl16, M(X, 0.33, Z, ex * 2, 0.66, ez * 2), '#3a2a28', 0.7);
        for (const y of [0.12, 0.52]) k.b.add('metal', GEO.cyl16, M(X, y, Z, ex * 2 + 0.03, 0.05, ez * 2 + 0.03), '#2a2028', 1);
        k.b.add('metal', GEO.cyl16, M(X, 0.61, Z, ex * 1.8, 0.02, ez * 1.8), '#140a0e', 1);
        for (const [dx, r] of [[-0.12, 0.05], [0.1, 0.035]] as const) k.b.add('metal', GEO.sphere, M(X + dx, 0.62, Z, r * 2, r, r * 2), '#2a2028', 1);
        k.colliders.push(X - ex, X + ex, 0, 0.7, Z - ez, Z + ez);
        P.solid(k, X - ex, X + ex, Z - ez, Z + ez, Infinity); return true;
      }
      case 'pot': {   // a small pot of green brew on embers
        for (let i = 0; i < 3; i++) { const a = i * 2.1; rbox(k, 'metal', '#3a3346', X + Math.cos(a) * 0.14, 0.35, Z + Math.sin(a) * 0.1, 0.03, 0.75, 0.03, -a, 0, 0.35); }
        k.b.add('metal', GEO.sphere, M(X, 0.35, Z, 0.32, 0.25, 0.32), '#2a2028', 1);
        k.b.add('emit', GEO.cyl12, M(X, 0.48, Z, 0.22, 0.02, 0.22), '#4ac83a', 1);
        k.b.add('emit', GEO.sphere, M(X, 0.04, Z, 0.25, 0.06, 0.2), '#ff6a1a', 1);
        k.glows.push(X, 0.5, Z, 0.8, 0.55, 1, 0.42);
        P.solid(k, X - 0.2, X + 0.2, Z - 0.15, Z + 0.15, Infinity); return true;
      }
      case 'bedroll': {
        const beds = ['#c8202a', '#ffc83d', '#8aff6a', '#b06aff'];
        k.b.add('canvas', GEO.cyl12, M(X, 0.1, Z, 0.2, 1.2, 0.2, 0, 0, Math.PI / 2), beds[Math.abs(Math.round(p.x)) % 4], 1);
        box(k, 'canvas', '#2a1420', X - 0.55, X + 0.45, 0, 0.03, Z + 0.1, Z + 0.75, 1);
        return true;
      }
      case 'sacks':
        for (let i = 0; i < 3; i++) ball(k, 'canvas', shade('#5a3a34', i * 0.05), X - 0.3 + i * 0.3, 0.2, Z + (i % 2) * 0.12, 0.24, 1.2);
        P.solid(k, X - ex, X + ex, Z - ez, Z + ez, 0.45); return true;
      case 'flag': {
        cyl(k, 'metal', '#2a2028', X, 0, Z, 0.04, 2.6, 8, 0.5);
        ball(k, 'metal', GOLD, X, 2.64, Z, 0.06);
        k.b.add('canvas', GEO.cone4, M(X + 0.32, 2.3, Z, 0.6, 0.05, 0.4, 0, 0, -Math.PI / 2), (p.x | 0) % 2 ? '#c8202a' : INK, 1);
        return true;
      }
      default: return false;
    }
  },

  ground(k, c) {
    // fire cracks in the ash (site positions) + two by the campfire
    for (const [x, y, r, sd] of [[420, 1300, 70, 1], [1050, 1320, 60, 2], [2330, 1320, 80, 3], [2960, 1310, 70, 4], [140, 1150, 40, 5], [3280, 1170, 40, 6], [860, 960, 50, 7], [2580, 1000, 50, 8], [1460, 1180, 40, 9], [1980, 1200, 40, 10]] as const) groundCrack(k, x, y, r, sd);
    const F = c.fire;
    groundCrack(k, F.x - 130, F.y + 54, 50, 3); groundCrack(k, F.x + 90, F.y + 60, 50, 9);
  },
};

const THEMES: Record<string, CampTheme> = { cherts: CHERTS_CAMP };
/** The camp theme of an art style (MDDoodle.active), or null = the default camp. */
export const campThemeOf = (styleId: string | null | undefined): CampTheme | null => THEMES[String(styleId || '')] ?? null;
