/**
 * The start camp «Перепутье» (site: campmap.js layout + campart.js art, city id 'camp'), real 3D from the same layout:
 * grass + dirt trails, a palisade round the walkable area and between the back-row buildings, the common campfire
 * (stone ring, logs, flames, cauldron on a tripod, log benches), nine ridge tents, and the camp props (weapon rack,
 * archery targets, hitching rail, woodpile, water tub, barrels/crates/sacks, flags, washing lines, pots, torches,
 * bedrolls). Everything sits exactly on the site's obstacle footprints, so the walk grid (and LGCity.go points) match.
 * All static: merged into the city Batch (no extra draw calls beyond the per-material chunks), a few glow points,
 * light-pool and point-light candidates for the fire and torches. No three.js objects of its own, no per-frame work.
 */
import type { CityLayout } from '../contracts';
import { campName, type CampScene } from '../net/town';
import { toX, toZ, SX, SZ } from './coords';
import { GEO, GEO2, M } from './batch';
import { type Ctx, box, rbox, cyl, cone, ball, shade, signZ } from './kit';
import type { Placed } from './place';
import * as THREE from 'three';
import { campThemeOf, type CampParts } from './camp-themes';

/** unit disc (diameter 1) facing up, for the water in the tub */
const TUB_WATER = new THREE.CircleGeometry(0.5, 24).rotateX(-Math.PI / 2);

export type CampLayout = CityLayout & { camp?: CampScene; spawn?: [number, number]; campName?: { name: string; sub: string } };
export const campOf = (L: CityLayout): CampScene | null => (L as CampLayout).camp ?? null;

const CANVAS = ['#e8dcc0', '#d6c49a', '#a9b582', '#d98c6a', '#c9b8d8', '#e8dcc0', '#b8a47a', '#9fb07a', '#e3c9a0'];
const TENT_H: Record<string, number> = { big: 1.95, mid: 1.6, small: 1.25 };
const FLAME = ['#ffd34d', '#ff9a2a', '#ff6a1a'];

/** Solid (jump top) + camera collider helpers. */
const solid = (k: Ctx, x0: number, x1: number, z0: number, z1: number, top: number) => (k.solids ||= []).push(Math.min(x0, x1), Math.max(x0, x1), Math.min(z0, z1), Math.max(z0, z1), top);

/** A burning flame: three nested emissive cones + a glow point + a light-pool / point-light candidate. */
function flame(k: Ctx, X: number, Y: number, Z: number, s: number, pool = 0): void {
  // soft teardrop flame: stretched spheres, deep orange outside → yellow → a hot white core; a few small side tongues
  const lay: [string, number, number][] = [['#ff5a14', 0.3, 0.62], ['#ff9a2a', 0.22, 0.5], ['#ffd34d', 0.14, 0.36], ['#fff4c0', 0.075, 0.22]];
  for (const [c, r, h] of lay) k.b.add('emit', GEO.sphere, M(X, Y + h * s * 0.42, Z, r * s, h * s, r * s), c, 1);
  if (s > 1) for (let i = 0; i < 5; i++) {
    const a = i * 1.26 + 0.4, d = 0.13 * s, h = (0.24 + 0.1 * Math.sin(i * 2.1)) * s;
    k.b.add('emit', GEO.sphere, M(X + Math.cos(a) * d, Y + h * 0.45, Z + Math.sin(a) * d * 0.8, 0.1 * s, h, 0.1 * s, Math.sin(a) * 0.3, 0, -Math.cos(a) * 0.3), i % 2 ? '#ff8a24' : '#ffb340', 1);
  }
  k.glows.push(X, Y + 0.3 * s, Z, 1.2 + s * 1.3, 1, 0.66, 0.3);
  if (pool) { (k.pools ||= []).push(X, Y + 0.4 * s, Z, pool, 1, 0.62, 0.3, 1.6); k.lights.push(X, Y + 0.5 * s, Z); }
}

/** Sharpened palisade log (cyl + 4-sided point). */
function stake(k: Ctx, X: number, Z: number, h: number, r: number, col: string): void {
  cyl(k, 'wood', col, X, -0.05, Z, r, h + 0.05, 8, 0.5);
  cone(k, 'wood', shade(col, 0.12), X, h, Z, r * 1.02, r * 2.4, true, 0.5);
}
/** A palisade line along X (z fixed) or along Z (x fixed), from a to b (m), with a rail at 1.1 m on the inner side. */
function palisade(k: Ctx, along: 'x' | 'z', a: number, b: number, at: number, inner: number): void {
  const P = k.pal;
  for (let t = a; t <= b; t += 0.23) {
    const h = 1.85 + ((Math.sin(t * 7.3) + 1) * 0.2), r = 0.1 + ((Math.sin(t * 13.1) + 1) * 0.012);
    const col = shade(P.woodD, ((Math.sin(t * 3.7) + 1) * 0.08) - 0.05);
    if (along === 'x') stake(k, t, at, h, r, col); else stake(k, at, t, h, r, col);
  }
  const off = inner * 0.14;
  if (along === 'x') {
    box(k, 'wood', P.wood, a, b, 1.05, 1.16, at + off - 0.04, at + off + 0.04, 0.5);
    box(k, 'wood', P.wood, a, b, 0.42, 0.52, at + off - 0.04, at + off + 0.04, 0.5);
    k.colliders.push(a, b, 0, 2.4, at - 0.15, at + 0.15);
    solid(k, a, b, at - 0.2, at + 0.2, Infinity);
  } else {
    box(k, 'wood', P.wood, at + off - 0.04, at + off + 0.04, 1.05, 1.16, a, b, 0.5);
    box(k, 'wood', P.wood, at + off - 0.04, at + off + 0.04, 0.42, 0.52, a, b, 0.5);
    k.colliders.push(at - 0.15, at + 0.15, 0, 2.4, a, b);
    solid(k, at - 0.2, at + 0.2, a, b, Infinity);
  }
}

/** Name of the camp as the 3D world writes it: «Кошачий привал» in the cat style, «Перепутье» otherwise (src/net/town.ts campName). */
export const campTitle = (L: Pick<CityLayout, 'styleId'> & { campName?: { name: string; sub: string } }) => L.campName ?? campName(L.styleId);

/** The camp's name board: on the back palisade, facing the clearing, in the widest gap between the buildings (none wide enough: no board). */
function campBoard(k: Ctx, L: CityLayout, gaps: [number, number][]): void {
  const t = campTitle(L as CampLayout);
  let best: [number, number] | null = null;
  for (const g of gaps) if (!best || g[1] - g[0] > best[1] - best[0]) best = g;
  if (!best || best[1] - best[0] < 2.6) return;   // no room: the name stays in the menu and the toast
  const w = Math.min(3.8, best[1] - best[0] - 0.8), cx = (best[0] + best[1]) / 2;
  signZ(k, t.name, cx, 0.95, -0.39, w, { hang: true });   // no subtitle: at this size it would be unreadable
}

/** Ground (grass), dirt trails and the clearing round the fire, palisades, trees and hills round the camp. */
export function buildCampTerrain(k: Ctx, L: CityLayout, c: CampScene): void {
  const P = k.pal, W = toX(L.W), fz = toZ(c.fence.y), zEnd = fz + 14;
  // grass (material 'paving' is the grass texture in a camp, see index.ts makeMaterials)
  k.b.add('paving', GEO.plane, M(W / 2, 0, (-16 + zEnd) / 2, W + 40, zEnd + 16, 1, -Math.PI / 2, 0, 0), '#ffffff', 2.4);
  // dirt trails ('lowPaving' = soil) 1.2 cm above the grass; joints get a round patch
  const trailW = 1.05;
  for (const seg of c.trail) {
    for (let i = 0; i + 1 < seg.length; i++) {
      const [x0, y0] = seg[i], [x1, y1] = seg[i + 1];
      const X0 = toX(x0), Z0 = toZ(y0), X1 = toX(x1), Z1 = toZ(y1), len = Math.hypot(X1 - X0, Z1 - Z0);
      rbox(k, 'lowPaving', '#ffffff', (X0 + X1) / 2, 0.006, (Z0 + Z1) / 2, len, 0.012, trailW, -Math.atan2(Z1 - Z0, X1 - X0), 0, 0, 1.6);
    }
    for (const [x, y] of seg) cyl(k, 'lowPaving', '#ffffff', toX(x), 0.0005, toZ(y), trailW / 2, 0.0115, 16, 1.6);
  }
  // clearing round the fire
  k.b.add('lowPaving', GEO.cyl16, M(toX(c.fire.x), 0.007, toZ(c.fire.y), toX(c.fire.rx) * 2 + 4.2, 0.012, (c.fire.ry * SZ) * 2 + 3.4), '#ffffff', 1.6);
  // palisade: bottom line, both sides, and the gaps of the back row between buildings
  const x0 = toX(c.fence.x0), x1 = toX(c.fence.x1);
  palisade(k, 'x', x0, x1, fz, -1);
  palisade(k, 'z', -0.4, fz, x0, 1);
  palisade(k, 'z', -0.4, fz, x1, -1);
  const blds = L.buildings.map((b) => [toX(b.hit[0]), toX(b.hit[1])] as [number, number]).sort((a, b) => a[0] - b[0]);
  let x = x0;
  const gaps: [number, number][] = [];   // stretches of the back palisade between the buildings (the camp's name board hangs on the widest)
  for (const [a, b] of blds) { if (a - x > 0.6) { palisade(k, 'x', x + 0.15, a - 0.15, -0.55, 1); gaps.push([x + 0.15, a - 0.15]); } x = Math.max(x, b); }
  if (x1 - x > 0.6) { palisade(k, 'x', x + 0.15, x1, -0.55, 1); gaps.push([x + 0.15, x1]); }
  campBoard(k, L, gaps);
  // a gentle glow over the gate opening is the gate model's; the camp is lit by the fire and the torches
  const T = campThemeOf(L.styleId);   // per-style camp (camp-themes.ts): its own backdrop + ground decor
  if (T) { T.far(k, L, c, W / 2, fz / 2); T.ground(k, c); return; }
  // forest round the camp (instanced placeholder trees) + far dark firs and the hills ring
  let s = 77;
  const rnd = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
  for (let X = -6; X < W + 6; X += 2.2 + rnd() * 1.6) {
    k.inst.add('tree', X, 0, -4.5 - rnd() * 6, rnd() * 6, 1.1 + rnd() * 0.7);
    k.inst.add('tree', X + 0.8, 0, fz + 2.2 + rnd() * 6, rnd() * 6, 1.0 + rnd() * 0.8);
  }
  for (let Z = -2; Z < fz + 2; Z += 2.4 + rnd() * 1.4) {
    k.inst.add('tree', x0 - 2.2 - rnd() * 4, 0, Z, rnd() * 6, 1.0 + rnd() * 0.7);
    k.inst.add('tree', x1 + 2.2 + rnd() * 4, 0, Z, rnd() * 6, 1.0 + rnd() * 0.7);
  }
  const cx = W / 2, cz = fz / 2;
  for (let i = 0; i < 150; i++) {
    const a = (i / 150) * Math.PI * 2 + rnd() * 0.03, R = 45 + rnd() * 50;
    const hx = cx + Math.cos(a) * R * 1.2, hz = cz + Math.sin(a) * R;
    const h = 7 + rnd() * 9;
    k.b.add('back', GEO.cone12, M(hx, h / 2 - 1, hz, 3.2 + rnd() * 2, h, 3.2 + rnd() * 2), shade(P.leafD, -0.45), 1);
  }
  hills(k, cx, cz, P.hill);
}

/** Jagged hills ring (same as the city's backdrop band). */
function hills(k: Ctx, cx: number, cz: number, col: string): void {
  const segs = 96, R = 170, pos: number[] = [];
  for (let i = 0; i < segs; i++) {
    const a0 = i / segs * Math.PI * 2, a1 = (i + 1) / segs * Math.PI * 2;
    const h0 = 16 + Math.sin(i * 0.7) * 8 + Math.sin(i * 2.3) * 4, h1 = 16 + Math.sin((i + 1) * 0.7) * 8 + Math.sin((i + 1) * 2.3) * 4;
    const p = (a: number, y: number) => [cx + Math.cos(a) * R, y, cz + Math.sin(a) * R];
    pos.push(...p(a0, -10), ...p(a1, -10), ...p(a1, h1), ...p(a0, -10), ...p(a1, h1), ...p(a0, h0));
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.computeVertexNormals();
  k.b.add('back', g, new THREE.Matrix4(), col, 1);
  g.dispose();
}

/** Ridge tent on the footprint the site blocks ([x − w/2 + 8, x + w/2 − 8] × [y − d, y] px). */
function tent(k: Ctx, t: CampScene['tents'][number], i: number): void {
  const P = k.pal, X = toX(t.x), z0 = toZ(t.y - t.d), z1 = toZ(t.y), Z = (z0 + z1) / 2;
  const hw = toX(t.w / 2 - 8), D = z1 - z0 + 0.1, h = TENT_H[t.k] ?? 1.5, col = CANVAS[i % CANVAS.length];
  const len = hw * 2;
  // canvas slopes (double-sided canvas material) + gable ends
  k.b.add('canvas', GEO2.gable, M(X, 0, Z, len, h, D), col, [len / 1.2, 1]);
  k.b.add('canvas', GEO2.gableEnds, M(X, 0, Z, len, h, D), shade(col, -0.12), 1);
  // seams / stripe on big tents
  if (t.k === 'big') for (const f of [0.33, 0.66]) rbox(k, 'canvas', shade(col, -0.25), X - hw + len * f, h * 0.5, Z, 0.05, 0.02, D * 0.98, 0, 0, 0, 1);
  // ridge pole + end poles (just outside the gable ends)
  box(k, 'wood', P.woodD, X - hw - 0.08, X + hw + 0.08, h - 0.03, h + 0.05, Z - 0.035, Z + 0.035, 0.5);
  for (const s of [-1, 1]) cyl(k, 'wood', P.woodD, X + s * (hw + 0.05), 0, Z, 0.035, h + 0.18, 8, 0.5);
  // entrance on one gable: dark opening + a tied-back flap
  const s = t.flip ? 1 : -1, ex = X + s * (hw + 0.012), oh = h * 0.72, ow = D * 0.5;
  k.b.add('flat', GEO2.gableEnds, M(ex + s * 0.02, 0, Z, 0.04, oh, ow), '#1b1426', 1);
  // warm glow from inside the open tent + a hem stripe along the eaves
  k.glows.push(ex + s * 0.1, oh * 0.35, Z, 0.9, 1, 0.7, 0.4);
  // a small lantern hung on the entrance pole: warm pool on the canvas and the ground in front
  const lx = X + s * (hw + 0.05), ly = Math.min(h, 1.35);
  box(k, 'metal', '#3a3446', lx - 0.06, lx + 0.06, ly - 0.02, ly + 0.02, Z + 0.06, Z + 0.18);
  k.b.add('emit', GEO.cyl8, M(lx, ly - 0.14, Z + 0.12, 0.1, 0.16, 0.1), '#ffcf7a', 1);
  k.glows.push(lx, ly - 0.14, Z + 0.12, 1.0, 1, 0.75, 0.4);
  (k.pools ||= []).push(lx + s * 0.4, ly - 0.2, Z + 0.3, 3.2, 1, 0.68, 0.36, 1.1);
  for (const zz of [z0 - 0.04, z1 + 0.04]) box(k, 'canvas', shade(col, -0.3), X - hw, X + hw, 0.02, 0.1, zz - 0.012, zz + 0.012, 1);
  rbox(k, 'canvas', shade(col, 0.1), ex + s * 0.07, oh * 0.45, Z + ow * 0.42, 0.03, oh * 0.9, ow * 0.32, 0, 0, s * 0.15, 1);
  // guy ropes to pegs at the other end
  for (const zz of [z0 - 0.35, z1 + 0.35]) {
    const ax = X - s * hw, ay = h * 0.85, len2 = Math.hypot(0.4, ay, zz - Z);
    const dir = new THREE.Vector3(-s * 0.4, -ay, zz - Z).normalize();
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir), e = new THREE.Euler().setFromQuaternion(q);
    k.b.add('flat', GEO.box, M(ax - s * 0.2, ay / 2, (Z + zz) / 2, 0.012, len2, 0.012, e.x, e.y, e.z), '#d9c9a0', 1);
    box(k, 'wood', P.woodD, ax - s * 0.4 - 0.025, ax - s * 0.4 + 0.025, 0, 0.12, zz - 0.025, zz + 0.025, 0.5);
  }
  k.colliders.push(X - hw, X + hw, 0, h, z0, z1);
  solid(k, X - hw - 0.05, X + hw + 0.05, z0, z1, Infinity);
}

/** The campfire: stone ring, ash, teepee logs, flames, cauldron on a tripod, log benches. */
function campfire(k: Ctx, f: CampScene['fire']): void {
  const P = k.pal, X = toX(f.x), Z = toZ(f.y), rx = toX(f.rx), rz = f.ry * SZ;
  // stones on an ellipse
  const n = 14;
  for (let i = 0; i < n; i++) {
    const a = i / n * Math.PI * 2;
    ball(k, 'stone', shade(P.stone, (i % 3) * 0.08 - 0.1), X + Math.cos(a) * rx * 0.62, 0.06, Z + Math.sin(a) * rz * 0.75, 0.13 + (i % 2) * 0.03, 0.6);
  }
  k.b.add('flat', GEO.cyl16, M(X, 0.02, Z, rx * 1.1, 0.03, rz * 1.3), '#2a2020', 1);
  k.b.add('emit', GEO.cyl16, M(X, 0.04, Z, rx * 0.6, 0.02, rz * 0.75), '#c2401a', 1);   // ember bed
  for (let i = 0; i < 9; i++) { const a = i * 2.4; k.b.add('emit', GEO.sphere, M(X + Math.cos(a) * rx * 0.22, 0.06, Z + Math.sin(a) * rz * 0.3, 0.09, 0.05, 0.07), i % 2 ? '#ff8a2a' : '#ffb347', 1); }
  // teepee of logs
  for (let i = 0; i < 5; i++) {
    const a = i / 5 * Math.PI * 2 + 0.3;
    rbox(k, 'wood', shade(P.woodD, -0.1), X + Math.cos(a) * 0.17, 0.24, Z + Math.sin(a) * 0.17, 0.09, 0.55, 0.09, -a, 0, 0.55, 0.5);
  }
  flame(k, X, 0.06, Z, 1.3, 9);
  // tripod + cauldron hanging over the fire (to the back so the flames stay visible)
  const tz = Z - 0.05;
  for (let i = 0; i < 3; i++) {
    const a = i / 3 * Math.PI * 2 + 0.5, lx = X + Math.cos(a) * rx * 0.7, lz = tz + Math.sin(a) * rz * 0.85;
    const dx = X - lx, dz = tz - lz, hh = 1.55, L = Math.hypot(dx, hh, dz);
    const dir = new THREE.Vector3(dx, hh, dz).normalize(), q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir), e = new THREE.Euler().setFromQuaternion(q);
    k.b.add('wood', GEO.cyl8, M((X + lx) / 2, hh / 2, (tz + lz) / 2, 0.045, L, 0.045, e.x, e.y, e.z), P.woodD, 0.5);
  }
  box(k, 'metal', '#3a3446', X - 0.008, X + 0.008, 0.95, 1.5, tz - 0.008, tz + 0.008);
  k.b.add('metal', GEO.sphere, M(X, 0.82, tz, 0.5, 0.38, 0.5), '#3a3442', 1);
  k.b.add('metal', GEO.cyl16, M(X, 0.98, tz, 0.44, 0.05, 0.44), '#8a7a6a', 1);
  k.b.add('emit', GEO.cyl16, M(X, 0.985, tz, 0.34, 0.03, 0.34), '#7a9a4a', 1);   // soup
  // log benches round the fire: [x, y, rx, ry, deg]
  for (const lg of f.logs) {
    const [x, y, lrx, lry, deg] = lg;
    const r = Math.min(0.2, (lry || 14) * SZ * 0.55), L = toX(lrx * 2) - 0.1;
    k.b.add('wood', GEO.cyl12, M(toX(x), r, toZ(y), r * 2, L, r * 2, 0, (deg || 0) * Math.PI / 180, Math.PI / 2), shade(P.wood, -0.1), 0.6);
    const hx = L / 2 + 0.05, hz = r + 0.05;
    solid(k, toX(x) - hx, toX(x) + hx, toZ(y) - hz, toZ(y) + hz, r * 2);
  }
  k.colliders.push(X - rx * 0.7, X + rx * 0.7, 0, 1.2, Z - rz, Z + rz);
  solid(k, X - rx * 0.7, X + rx * 0.7, Z - rz * 0.9, Z + rz * 0.9, Infinity);   // never stand in the fire
}

/** One camp prop at its footprint (site campmap.js PROPS kinds). */
function prop(k: Ctx, p: CampScene['props'][number], poles: [number, number][]): void {
  const P = k.pal, X = toX(p.x), Z = toZ(p.y - (p.e ? p.e[1] * 0.4 : 0)), ex = p.e ? toX(p.e[0]) : 0.2, ez = p.e ? p.e[1] * SZ : 0.1;
  switch (p.k) {
    case 'sign': k.inst.add('signpost', X, 0, Z, -0.4, 1); break;
    case 'rack': {   // weapon rack: posts, two bars, swords and spears leaning on it
      for (const s of [-1, 1]) cyl(k, 'wood', P.woodD, X + s * (ex - 0.06), 0, Z, 0.05, 1.25, 8, 0.5);
      for (const y of [0.5, 1.1]) box(k, 'wood', P.wood, X - ex, X + ex, y, y + 0.07, Z - 0.04, Z + 0.04, 0.5);
      for (let i = 0; i < 6; i++) {
        const x = X - ex + 0.25 + i * (ex * 2 - 0.5) / 5;
        if (i % 2) { box(k, 'metal', '#c8ccd3', x - 0.025, x + 0.025, 0.25, 1.05, Z + 0.06, Z + 0.075); box(k, 'wood', P.woodD, x - 0.08, x + 0.08, 0.9, 0.94, Z + 0.05, Z + 0.09); }
        else { rbox(k, 'wood', P.woodL, x, 0.85, Z + 0.08, 0.035, 1.7, 0.035, 0, 0.12, 0); cone(k, 'metal', '#c8ccd3', x, 1.68, Z + 0.18, 0.05, 0.16, true); }
      }
      k.colliders.push(X - ex, X + ex, 0, 1.3, Z - ez, Z + ez);
      solid(k, X - ex * 0.85, X + ex * 0.85, Z - ez * 0.7, Z + ez * 0.7, Infinity); break;   // inside the site's ellipse
    }
    case 'target': {   // archery target on an easel, facing the fire side (−z)
      for (const s of [-1, 1]) rbox(k, 'wood', P.woodD, X + s * 0.22, 0.6, Z + 0.05, 0.05, 1.25, 0.05, 0, 0, s * 0.18);
      rbox(k, 'wood', P.woodD, X, 0.55, Z + 0.3, 0.05, 1.15, 0.05, 0, -0.45, 0);
      const cols = ['#efe6d0', '#c0182b', '#efe6d0', '#c0182b', '#ffd34d'];
      cols.forEach((c, i) => k.b.add(i ? 'flat' : 'canvas', GEO.cyl16, M(X, 0.9, Z - 0.02 - i * 0.012, 0.8 - i * 0.15, 0.06, 0.8 - i * 0.15, Math.PI / 2, 0, 0), c, 1));
      rbox(k, 'wood', P.woodL, X + 0.12, 0.98, Z - 0.2, 0.02, 0.02, 0.45, 0.3, 0.2, 0);   // an arrow in it
      solid(k, X - 0.24, X + 0.24, Z - 0.12, Z + 0.12, Infinity); break;   // inside the site's ellipse (legs are thin)
    }
    case 'hitch': {   // hitching rail + hay + bucket
      for (const s of [-1, 0, 1]) cyl(k, 'wood', P.woodD, X + s * (ex - 0.12), 0, Z, 0.07, 1.05, 8, 0.5);
      box(k, 'wood', P.wood, X - ex, X + ex, 0.9, 1.0, Z - 0.05, Z + 0.05, 0.5);
      box(k, 'flat', '#d9b45a', X + 0.3, X + 1.0, 0, 0.32, Z + 0.25, Z + 0.6);
      cyl(k, 'wood', P.woodL, X - 0.5, 0, Z + 0.3, 0.14, 0.24, 12, 0.5);
      k.colliders.push(X - ex, X + ex, 0, 1.05, Z - 0.1, Z + 0.1);
      solid(k, X - ex, X + ex, Z - ez, Z + ez, 1.0); break;
    }
    case 'woodpile': {
      for (let row = 0; row < 3; row++) for (let i = 0; i < 6 - row; i++) {
        const x = X - ex + 0.2 + (i + row * 0.5) * ((ex * 2 - 0.4) / 5);
        k.b.add('wood', GEO.cyl8, M(x, 0.1 + row * 0.17, Z, 0.19, ez * 2 + 0.1, 0.19, Math.PI / 2, 0, 0), shade(P.wood, (i % 3) * 0.06 - 0.06), 0.5);
      }
      for (const s of [-1, 1]) cyl(k, 'wood', P.woodD, X + s * ex, 0, Z, 0.04, 0.65, 8, 0.5);
      solid(k, X - ex, X + ex, Z - ez, Z + ez, 0.55); break;
    }
    case 'well': {   // big wooden water tub (oval): staves + hoops + water
      k.b.add('wood', GEO.cyl16, M(X, 0.33, Z, ex * 2, 0.66, ez * 2), shade(P.wood, -0.05), 0.7);
      for (const y of [0.12, 0.52]) k.b.add('metal', GEO.cyl16, M(X, y, Z, ex * 2 + 0.03, 0.05, ez * 2 + 0.03), '#4a4456', 1);
      // water: an oval disc just above the tub's top cap, inside the staves (a square plane poked its corners out)
      k.b.add('water', TUB_WATER, M(X, 0.665, Z, ex * 1.84, 1, ez * 1.84), '#ffffff', 1);
      k.colliders.push(X - ex, X + ex, 0, 0.7, Z - ez, Z + ez);
      solid(k, X - ex, X + ex, Z - ez, Z + ez, Infinity); break;
    }
    case 'barrel': k.inst.add('barrel', X, 0, Z, p.x * 0.01, 1); break;
    case 'crate': k.inst.add('crate', X, 0, Z, p.x * 0.013, 1); break;
    case 'crates':
      k.inst.add('crate', X - 0.25, 0, Z, 0.2, 1); k.inst.add('crate', X + 0.3, 0, Z + 0.05, -0.15, 0.85); k.inst.add('crate', X - 0.2, 0.55, Z, 0.5, 0.75); break;
    case 'sacks':
      for (let i = 0; i < 3; i++) ball(k, 'canvas', shade('#cdb68a', i * 0.05), X - 0.3 + i * 0.3, 0.2, Z + (i % 2) * 0.12, 0.24, 1.2);
      solid(k, X - ex, X + ex, Z - ez, Z + ez, 0.45); break;
    case 'flag': {
      cyl(k, 'wood', P.woodD, X, 0, Z, 0.04, 2.6, 8, 0.5);
      ball(k, 'metal', '#ffcf4a', X, 2.64, Z, 0.06);
      k.b.add('canvas', GEO.cone4, M(X + 0.32, 2.3, Z, 0.6, 0.05, 0.4, 0, 0, -Math.PI / 2), P.flag, 1);
      break;
    }
    case 'pole': cyl(k, 'wood', P.woodD, X, 0, Z, 0.045, 1.95, 8, 0.5); poles.push([X, Z]); break;
    case 'pot': {   // small pot on a tripod over embers
      for (let i = 0; i < 3; i++) { const a = i * 2.1; rbox(k, 'wood', P.woodD, X + Math.cos(a) * 0.14, 0.35, Z + Math.sin(a) * 0.1, 0.035, 0.75, 0.035, -a, 0, 0.35); }
      k.b.add('metal', GEO.sphere, M(X, 0.35, Z, 0.32, 0.25, 0.32), '#2a2632', 1);
      k.b.add('emit', GEO.sphere, M(X, 0.04, Z, 0.25, 0.06, 0.2), '#ff7a1a', 1);
      k.glows.push(X, 0.1, Z, 0.7, 1, 0.5, 0.2);
      solid(k, X - 0.2, X + 0.2, Z - 0.15, Z + 0.15, Infinity); break;
    }
    case 'torch': {
      cyl(k, 'wood', P.woodD, X, 0, Z, 0.045, 1.6, 8, 0.5);
      k.b.add('metal', GEO.cone12, M(X, 1.66, Z, 0.2, 0.16, 0.2, Math.PI, 0, 0), '#3a3446', 1);
      flame(k, X, 1.72, Z, 0.75, 5);
      break;
    }
    case 'bedroll': {
      k.b.add('canvas', GEO.cyl12, M(X, 0.1, Z, 0.2, 1.2, 0.2, 0, 0, Math.PI / 2), shade('#8a5a8e', ((p.x % 3) - 1) * 0.12), 1);
      box(k, 'canvas', '#5a6a8a', X - 0.55, X + 0.45, 0, 0.03, Z + 0.1, Z + 0.75, 1);
      break;
    }
    default:   // unknown kind: a barrel on its footprint (drift: campmap.js got a new prop)
      if (p.e) k.inst.add('barrel', X, 0, Z, 0, 1);
  }
}

/** Every camp prop + washing lines + fire + tents. Returns the Placed of the camp (garlands only from building wires). */
export function buildCampProps(k: Ctx, c: CampScene, styleId = ''): Placed {
  const garlands: Placed['garlands'] = [];
  const T = campThemeOf(styleId), CP: CampParts = { flame, solid, tentH: TENT_H };
  if (T) T.campfire(k, c.fire, CP); else campfire(k, c.fire);
  c.tents.forEach((t, i) => (T ? T.tent(k, t, i, CP) : tent(k, t, i)));
  const poles: [number, number][] = [];
  for (const p of c.props) if (!(T && T.prop(k, p, CP))) prop(k, p, poles);
  // washing lines between pole pairs (indices among the poles), with a few hanging clothes
  const CLOTH = T ? T.cloth : ['#e8e0f0', '#7fb0e8', '#ff9fb2', '#ffe27a', '#9fe39a'];
  for (const [i, j] of c.lines) {
    const a = poles[i], b = poles[j]; if (!a || !b) continue;
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]), ang = -Math.atan2(b[1] - a[1], b[0] - a[0]);
    rbox(k, 'flat', '#d9c9a0', (a[0] + b[0]) / 2, 1.82, (a[1] + b[1]) / 2, L, 0.015, 0.015, ang);
    const n = Math.max(2, Math.floor(L / 0.7));
    for (let q = 1; q < n; q++) {
      const t = q / n, x = a[0] + (b[0] - a[0]) * t, z = a[1] + (b[1] - a[1]) * t, h = 0.35 + (q % 2) * 0.15;
      rbox(k, 'canvas', CLOTH[(q + i) % CLOTH.length], x, 1.8 - h / 2, z, 0.38, h, 0.02, ang);
    }
  }
  // string lights (festive, cozy): only between things the site already places (flags, torches, tent ridges) — no new
  // obstacles in the walkable area. Torches/flags in order along x; spans shorter than 7 m.
  const tops: [number, number, number][] = [];
  for (const p of c.props) if (p.k === 'flag' || p.k === 'torch') tops.push([toX(p.x), p.k === 'flag' ? 2.45 : 1.62, toZ(p.y)]);
  for (const t of c.tents) for (const sx of [-1, 1]) tops.push([toX(t.x) + sx * (toX(t.w / 2 - 8) + 0.05), (TENT_H[t.k] ?? 1.5) + 0.12, (toZ(t.y - t.d) + toZ(t.y)) / 2]);
  const used = new Set<number>();
  for (let i = 0; i < tops.length; i++) {
    let best = -1, bd = 7;
    for (let j = 0; j < tops.length; j++) {
      if (j === i || used.has(i * 1000 + j) || used.has(j * 1000 + i)) continue;
      const d = Math.hypot(tops[j][0] - tops[i][0], tops[j][1] - tops[i][1], tops[j][2] - tops[i][2]);
      // the sag (12 % of the span, buildGarlands) must stay above head height (1.45 m)
      if (d > 1.5 && d < bd && Math.min(tops[i][1], tops[j][1]) - 0.12 * d >= 1.45) { bd = d; best = j; }
    }
    if (best < 0) continue;
    used.add(i * 1000 + best);
    garlands.push([new THREE.Vector3(...tops[i]), new THREE.Vector3(...tops[best])]);
  }
  for (let j = 0; j + 5 < k.wires.length; j += 6) {
    garlands.push([new THREE.Vector3(k.wires[j], k.wires[j + 1], k.wires[j + 2]), new THREE.Vector3(k.wires[j + 3], k.wires[j + 4], k.wires[j + 5])]);
  }
  return { garlands, lampHeads: [] };
}

/** Units for tests: metres per px. */
export const CAMP_SCALE = { SX, SZ };
