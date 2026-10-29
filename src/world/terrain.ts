/** Terrain: upper street, retaining wall with stairs, lower street, canal with bridges, city walls, backdrop. */
import * as THREE from 'three';
import type { CityLayout } from '../contracts';
import { toX, toZ } from './coords';
import { GEO, M } from './batch';
import type { GroundSpec } from './ground';
import { CANAL_WATER, BRIDGE_HUMP } from './ground';
import { type Ctx, box, rbox, cyl, cone, ball, shade, gableRoof, windowZ } from './kit';

export const BACK_Z = -14;   // how far the upper ground extends behind the facades

/** Split [a,b] by excluded ranges → kept ranges. */
function keep(a: number, b: number, ex: [number, number][]): [number, number][] {
  const s = ex.filter((e) => e[1] > a && e[0] < b).sort((p, q) => p[0] - q[0]);
  const out: [number, number][] = []; let x = a;
  for (const [e0, e1] of s) { if (e0 > x) out.push([x, e0]); x = Math.max(x, e1); }
  if (x < b) out.push([x, b]);
  return out;
}

function flatQuad(k: Ctx, mat: 'paving' | 'lowPaving' | 'water' | 'flat' | 'stone', col: string, x0: number, x1: number, z0: number, z1: number, y: number, tile: number): void {
  k.b.add(mat, GEO.plane, M((x0 + x1) / 2, y, (z0 + z1) / 2, x1 - x0, z1 - z0, 1, -Math.PI / 2, 0, 0), col, tile);
}

export interface TerrainOut { waterMeshKeys: string[]; zEnd: number }

export function buildTerrain(k: Ctx, L: CityLayout, s: GroundSpec): TerrainOut {
  const P = k.pal, W = toX(L.W), xs0 = -1.5, xs1 = W + 1.5;
  const zEnd = toZ(L.area.y1) + 0.8;
  const stairsM = s.stairs.map((r) => [toX(r[0]), toX(r[1])] as [number, number]);
  if (!s.hasLow) {
    flatQuad(k, 'paving', '#ffffff', xs0, xs1, BACK_Z, zEnd, 0, 2.4);
    cityWalls(k, W, 0, zEnd);
    return { waterMeshKeys: [], zEnd };
  }
  const wallZ = toZ(s.wallY), r0 = toZ(s.rampY0), r1 = toZ(s.rampY1), lowH = s.lowH;
  // ---------------- upper street (y=0) with stair wells cut out
  for (const [a, b] of keep(xs0, xs1, stairsM)) {
    flatQuad(k, 'paving', '#ffffff', a, b, BACK_Z, wallZ, 0, 2.4);
    // retaining wall face (brick) + coping
    k.b.add('brick', GEO.plane, M((a + b) / 2, lowH / 2, wallZ, b - a, -lowH, 1), shade(P.brick, -0.05), 1.6);
    // coping ends 1 cm inside the stair cheek walls (its end faces never share the cheeks' inner planes)
    box(k, 'stone', shade(P.stone, 0.1), a > xs0 ? a + 0.01 : a, b < xs1 ? b - 0.01 : b, -0.06, 0.12, wallZ - 0.35, wallZ + 0.08, 0.8);
    k.colliders.push(a, b, lowH, 0.1, wallZ - 3, wallZ);
    k.colliders.push(a, b, 0, 0.85, wallZ - 0.3, wallZ);   // railing: keeps the TP camera on the street side, not behind the bars
    // railing on top
    // (waist-high for the ~1.35 m chibis: top ≈ 0.77 m, under the 1.0 m jump apex — you can hop over and drop down)
    for (let x = a + 1; x <= b - 0.9; x += 2) k.inst.add('fence', x, 0.12, wallZ - 0.15, 0, 1, 0.72);
  }
  for (const [a, b] of stairsM) {
    flatQuad(k, 'paving', '#ffffff', a, b, BACK_Z, r0, 0, 2.4);
    // riser under the paving edge at the top of the flight (the first tread is 8 cm lower: one could look under the street)
    box(k, 'stone', shade(P.stone, 0.12), a + 0.004, b - 0.004, -0.3, 0, r0, r0 + 0.012, 0.7);
    const n = 9, dz = (r1 - r0) / n, dh = -lowH / n;
    for (let i = 0; i < n; i++) {
      const top = -(i + 0.5) * dh;   // average of ramp across the tread
      box(k, 'stone', i % 2 ? shade(P.stone, 0.12) : shade(P.stone, 0.2), a, b, lowH - 0.05, top, r0 + i * dz, r0 + (i + 1) * dz, 0.7);
      // nosing: 1.5 cm proud of the riser and 1.2 cm above the tread (never in the riser's / tread's plane)
      box(k, 'stone', shade(P.stone, 0.35), a + 0.008, b - 0.008, top - 0.04, top + 0.012, r0 + (i + 1) * dz - 0.06, r0 + (i + 1) * dz + 0.015, 0.7);
    }
    // cheek walls along the stairs (brick), with stone caps
    for (const x of [a, b]) {
      const sx = x === a ? -1 : 1;
      // front 2 cm proud of the coping (wallZ + 0.08) so the coping's face ends inside the cheek, not in its plane
      box(k, 'brick', P.brick, x + (sx < 0 ? -0.3 : 0), x + (sx < 0 ? 0 : 0.3), lowH, 0.45, r0 - 0.1, wallZ + 0.1, 1.6);
      box(k, 'stone', shade(P.stone, 0.1), x + (sx < 0 ? -0.36 : -0.06), x + (sx < 0 ? 0.06 : 0.36), 0.45, 0.58, r0 - 0.16, wallZ + 0.16, 0.8);
      ball(k, 'stone', shade(P.stone, 0.2), x + sx * 0.15, 0.72, r0 - 0.05, 0.15);
      k.colliders.push(x + (sx < 0 ? -0.36 : -0.06), x + (sx < 0 ? 0.06 : 0.36), lowH, 0.58, r0 - 0.16, wallZ + 0.16);   // TP camera stays out of the cheek
    }
  }
  // ---------------- lower street
  const c0 = s.canal ? toZ(s.canal[0]) : zEnd, c1 = s.canal ? toZ(s.canal[1]) : zEnd;
  flatQuad(k, 'lowPaving', '#ffffff', xs0, xs1, wallZ, c0, lowH, 2.4);
  if (s.canal) {
    flatQuad(k, 'lowPaving', '#ffffff', xs0, xs1, c1, zEnd, lowH, 2.4);
    const wy = lowH + CANAL_WATER;
    // canal walls + bottom
    k.b.add('stone', GEO.plane, M(W / 2, lowH - 0.6, c0, xs1 - xs0, 1.2, 1), shade(P.stone, -0.15), 0.8);
    k.b.add('stone', GEO.plane, M(W / 2, lowH - 0.6, c1, xs1 - xs0, 1.2, 1, 0, Math.PI, 0), shade(P.stone, -0.15), 0.8);
    flatQuad(k, 'flat', P.waterD, xs0, xs1, c0, c1, lowH - 1.2, 4);
    k.b.add('water', GEO.plane, M(W / 2, wy, (c0 + c1) / 2, xs1 - xs0, c1 - c0, 1, -Math.PI / 2, 0, 0), '#ffffff', 3);
    // coping stones (skip under bridges)
    const brM = s.bridges.map((r) => [toX(r[0]) + 0.1, toX(r[1]) - 0.1] as [number, number]);
    for (const [a, b] of keep(xs0, xs1, brM)) {
      box(k, 'stone', shade(P.stone, 0.15), a, b, lowH - 0.02, lowH + 0.16, c0 - 0.35, c0 + 0.05, 0.8);
      box(k, 'stone', shade(P.stone, 0.15), a, b, lowH - 0.02, lowH + 0.16, c1 - 0.05, c1 + 0.35, 0.8);
    }
    // bridges: humped plank deck along Z + side rails
    for (const [a, b] of brM) {
      const zb0 = c0 - 0.2, zb1 = c1 + 0.2, n = 8;
      for (let i = 0; i < n; i++) {
        const za = zb0 + (zb1 - zb0) * i / n, zz = zb0 + (zb1 - zb0) * (i + 1) / n, zm = (za + zz) / 2;
        const y = lowH + BRIDGE_HUMP * Math.sin(Math.PI * (zm - zb0) / (zb1 - zb0));
        const slope = BRIDGE_HUMP * Math.PI / (zb1 - zb0) * Math.cos(Math.PI * (zm - zb0) / (zb1 - zb0));
        rbox(k, 'wood', P.woodL, (a + b) / 2, y - 0.06, zm, b - a, 0.14, zz - za + 0.02, 0, -Math.atan(slope), 0, 0.6);
      }
      box(k, 'wood', P.woodD, a, b, lowH - 0.9, lowH - 0.1, (c0 + c1) / 2 - 0.25, (c0 + c1) / 2 + 0.25, 0.6);   // pier
      for (const x of [a + 0.08, b - 0.08]) {
        for (let i = 0; i <= 4; i++) {
          const z = zb0 + (zb1 - zb0) * i / 4, y = lowH + BRIDGE_HUMP * Math.sin(Math.PI * i / 4);
          box(k, 'wood', P.woodD, x - 0.07, x + 0.07, y, y + 0.85, z - 0.07, z + 0.07, 0.6);
          if (i === 0 || i === 4) ball(k, 'metal', '#ffcf4a', x, y + 0.92, z, 0.08);
        }
        for (let i = 0; i < 4; i++) {
          const za = zb0 + (zb1 - zb0) * i / 4, zz = zb0 + (zb1 - zb0) * (i + 1) / 4;
          const ya = lowH + BRIDGE_HUMP * Math.sin(Math.PI * i / 4) + 0.8, yb = lowH + BRIDGE_HUMP * Math.sin(Math.PI * (i + 1) / 4) + 0.8;
          rbox(k, 'wood', P.wood, x, (ya + yb) / 2, (za + zz) / 2, 0.08, 0.1, Math.hypot(zz - za, yb - ya), 0, -Math.atan2(yb - ya, zz - za), 0, 0.6);
        }
      }
    }
  } else flatQuad(k, 'lowPaving', '#ffffff', xs0, xs1, c0, zEnd, lowH, 2.4);
  cityWalls(k, W, lowH, zEnd);
  return { waterMeshKeys: ['water'], zEnd };
}

/** Low front wall with battlements at the end of the lower street, side walls, gate towers in the corners. */
export function cityWalls(k: Ctx, W: number, lowH: number, zEnd: number): void {
  const st = '#8b7f8f', P = k.pal;
  const zf = zEnd + 0.4, h = 2.4;
  box(k, 'stone', st, -2, W + 2, lowH - 0.2, lowH + h, zf, zf + 1.2, 0.8);
  k.colliders.push(-2, W + 2, lowH - 0.2, lowH + h, zf, zf + 1.2, -2.2, -1, lowH - 0.2, 6, BACK_Z, zf + 1.2, W + 1, W + 2.2, lowH - 0.2, 6, BACK_Z, zf + 1.2);
  for (let x = -1.6; x < W + 2; x += 1.1) box(k, 'stone', st, x, x + 0.55, lowH + h, lowH + h + 0.45, zf, zf + 0.35, 0.8);
  // bushes along the foot of the wall
  for (let x = 0.5; x < W; x += 2.3 + k.rnd() * 1.5) k.inst.add('bush', x, lowH, zf - 0.5, k.rnd() * 6, 0.8 + k.rnd() * 0.5);
  // side walls (tall), with towers at the corners
  for (const x of [-1.6, W + 1.6]) {
    box(k, 'stone', st, x - 0.6, x + 0.6, lowH - 0.2, 6, BACK_Z, zf + 1.2, 0.8);
    for (const z of [zf + 0.6, 6.0, BACK_Z + 1]) {
      cyl(k, 'stone', shade(st, 0.05), x, lowH - 0.2, z, 1.4, 8.5 - lowH, 12, 0.8);
      cone(k, 'roof', P.roof, x, 8.3, z, 1.75, 2.6);
      k.colliders.push(x - 1.3, x + 1.3, lowH - 0.2, 8.3, z - 1.3, z + 1.3);   // the TP camera stays out of the tower
      windowZ(k, x, 5.6, z + 1.38, 0.3, 0.6, true, { arch: true });
    }
  }
}

/** Second row of houses behind the street + far silhouettes (cheap, flat-shaded) + hills ring. */
export function buildBackdrop(k: Ctx, L: CityLayout, cx: number, cz: number, row = true): void {
  const P = k.pal, W = toX(L.W), r = k.rnd;
  // second row of houses (real geometry, few windows) — a village has its tree belt there instead (village.ts)
  let x = row ? -1 : W + 1;
  while (x < W + 1) {
    const w = 2.4 + r() * 2.6, h = 3.6 + r() * 3.2, z0 = -7.5 - r() * 2.5;
    const col = r() < 0.5 ? P.brick : r() < 0.5 ? P.plaster : shade(P.wall, 0.25);
    const mat = col === P.plaster ? 'plaster' : 'brick';
    box(k, mat, shade(col, -0.25), x, x + w, 0, h, z0 - 4, z0, 1.6);
    const rh = 1.2 + r() * 1.4;
    gableRoof(k, r() < 0.6 ? P.roof : P.roof2, mat, shade(col, -0.25), x, x + w, z0 - 4, z0, h, rh, 0.2);
    for (let wy = 2.2; wy < h - 0.8; wy += 1.8) for (let wx = x + 0.7; wx < x + w - 0.5; wx += 1.3) {
      if (r() < 0.4) box(k, 'emit', P.glass, wx - 0.22, wx + 0.22, wy, wy + 0.5, z0 + 0.01, z0 + 0.03);
      else box(k, 'flat', '#2a2246', wx - 0.22, wx + 0.22, wy, wy + 0.5, z0 + 0.01, z0 + 0.03);
    }
    if (r() < 0.35) box(k, 'brick', shade(P.brick, -0.3), x + w * 0.7, x + w * 0.7 + 0.45, h, h + Math.max(2, rh + 0.45), z0 - 2.2, z0 - 1.7, 1.6);
    x += w + r() * 0.3;
  }
  // far silhouettes: rings of house blocks (back material = flat colour, fogged)
  const back = P.backHouse, roof = P.backRoof, hell = P.back === 'cliffs';
  for (let i = 0; i < 160; i++) {
    const a = (i / 160) * Math.PI * 2 + r() * 0.02, R = hell ? 40 + r() * 12 : 70 + r() * 35;   // cherts: the quarter ends at the cliffs
    const hx = cx + Math.cos(a) * R * 1.25, hz = cz + Math.sin(a) * R;
    if (hz > -18 && hz < 34 && hx > -10 && hx < W + 10) continue;
    const w = 4 + r() * 6, h = hell ? 4 + r() * 7 : 4 + r() * 12;
    const ry = -a + Math.PI / 2;
    k.b.add('back', GEO.box, M(hx, h / 2 - 2, hz, w, h, 5, 0, ry, 0), back, 1);
    k.b.add('back', GEO.cone4, M(hx, h - 2 + 1.5, hz, w * 1.05, 3, 5.2, 0, ry, 0), roof, 1);
    if (r() < 0.5) { // a lit window facing the city
      const wx = hx - Math.cos(a) * 2.6, wz = hz - Math.sin(a) * 2.6;
      k.b.add('emit', GEO.box, M(wx, h * 0.6 - 2, wz, 0.7, 0.9, 0.1, 0, ry, 0), P.glass, 1);
    }
    if (r() < 0.15) { // tower
      k.b.add('back', GEO.cyl8, M(hx + 2, h + 2, hz, 2.4, h + 8, 2.4), back, 1);
      k.b.add('back', GEO.cone12, M(hx + 2, h + 7.5, hz, 3.2, 4, 3.2), roof, 1);
    }
  }
  if (P.back === 'cliffs') { hellCliffs(k, cx, cz, W); return; }
  // hills ring (jagged band)
  const segs = 96, R = 190;
  const pos: number[] = [];
  for (let i = 0; i < segs; i++) {
    const a0 = i / segs * Math.PI * 2, a1 = (i + 1) / segs * Math.PI * 2;
    const h0 = 18 + Math.sin(i * 0.7) * 8 + Math.sin(i * 2.3) * 4, h1 = 18 + Math.sin((i + 1) * 0.7) * 8 + Math.sin((i + 1) * 2.3) * 4;
    const p = (a: number, y: number) => [cx + Math.cos(a) * R, y, cz + Math.sin(a) * R];
    pos.push(...p(a0, -10), ...p(a1, -10), ...p(a1, h1), ...p(a0, -10), ...p(a1, h1), ...p(a0, h0));
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.computeVertexNormals();
  k.b.add('back', g, new THREE.Matrix4(), P.hill, 1);
  g.dispose();
}

/**
 * «Котельный квартал» backdrop (site cityart.js K.back === 'cliffs', cherts): basalt cliffs in two planes round the city
 * instead of the hills, lavafalls pouring down their inner face (emissive ribbons + glow at the foot) and boiler chimneys
 * with a glowing mouth rising between the far houses. All in the static batch ('back' / 'emit'), fogged like the hills.
 */
export function hellCliffs(k: Ctx, cx: number, cz: number, W: number): void {
  const P = k.pal;
  const band = (R: number, base: number, amp: number, seed: number, col: string) => {
    const segs = 120, pos: number[] = [];
    const hAt = (i: number) => base + amp * (0.55 + 0.45 * Math.sin(i * 0.9 + seed) * Math.sin(i * 0.37 + seed * 2)) + (i % 3 === 0 ? amp * 0.35 : 0);
    for (let i = 0; i < segs; i++) {
      const a0 = i / segs * Math.PI * 2, a1 = (i + 1) / segs * Math.PI * 2, h0 = hAt(i), h1 = hAt(i + 1);
      const p = (a: number, y: number) => [cx + Math.cos(a) * R * 1.15, y, cz + Math.sin(a) * R];
      pos.push(...p(a0, -10), ...p(a1, -10), ...p(a1, h1), ...p(a0, -10), ...p(a1, h1), ...p(a0, h0));
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.computeVertexNormals();
    k.b.add('back', g, new THREE.Matrix4(), col, 1); g.dispose();
    return hAt;
  };
  // close enough to read through the fog at every quality (fog far 120 m at q0)
  // tall enough to stand over the far houses (≤ 12 m) seen from the street
  const far = band(84, 40, 22, 1.3, shade(P.hill, -0.25));
  const near = band(60, 24, 14, 4.1, P.hill);
  // lavafalls on the inner face of the near band (the ones facing the city), with a glowing pool at the foot
  for (let i = 0; i < 9; i++) {
    const seg = 120, idx = Math.round((0.62 + i * 0.035 + (i % 2) * 0.012) * seg) % seg;   // the far side behind the facades (−Z)
    const a = idx / seg * Math.PI * 2, R = 59.3, top = near(idx) - 0.5;
    const x = cx + Math.cos(a) * R * 1.15, z = cz + Math.sin(a) * R, ry = -a - Math.PI / 2;
    const w = 3.2 + (i % 3) * 1.2;
    k.b.add('emit', GEO.plane, M(x, top / 2 - 4, z, w, top + 8, 1, 0, ry, 0), '#ff6a12', 1);
    k.b.add('emit', GEO.plane, M(x - Math.cos(a) * 0.05, top / 2 - 4, z - Math.sin(a) * 0.05, w * 0.4, top + 8, 1, 0, ry, 0), '#ffd23a', 1);
    k.glows.push(x - Math.cos(a) * 2, 1.5, z - Math.sin(a) * 2, 9, 1, 0.42, 0.12);
    for (const t of [0.35, 0.7, 0.95]) k.glows.push(x - Math.cos(a) * 1, top * t, z - Math.sin(a) * 1, 7, 1, 0.5, 0.15);
  }
  void far;
  // boiler chimneys between the far houses: dark iron stacks with bands, a glowing mouth
  for (let i = 0; i < 14; i++) {
    const a = Math.PI * (1.08 + i * 0.06) + (i % 2) * 0.02, R = 44 + (i % 4) * 4;
    const x = cx + Math.cos(a) * R * 1.25, z = cz + Math.sin(a) * R, h = 13 + (i % 5) * 3;
    if (z > -18 && x > -10 && x < W + 10) continue;
    k.b.add('back', GEO.cyl8, M(x, h / 2 - 2, z, 1.8, h, 1.8), '#3a3346', 1);
    for (const t of [0.35, 0.7]) k.b.add('back', GEO.cyl8, M(x, h * t - 2, z, 2.5, 0.5, 2.5), '#5a5470', 1);
    k.b.add('emit', GEO.cyl8, M(x, h - 1.9, z, 2.0, 0.3, 2.0), '#ff7a1a', 1);
    k.glows.push(x, h - 1.2, z, 7, 1, 0.45, 0.14);
  }
}
