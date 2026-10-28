/**
 * 3D models of the «Ночь Тыквенной Луны» NPCs (src/events/halloween/hwnpc.ts), drawn after the site's art (hwnpc.js):
 *  - «Ступа сладостей»: a green-faced cat-witch with orange hair standing in a wooden mortar-barrel (planks, two iron
 *    hoops with rivets) heaped with wrapped candies and two candy jars on the rim; her broom-staff, a sign board on a
 *    pole on the left, a pair of jack-o'-lanterns on the right. The mortar and the witch hover-bob together (aFly = 2).
 *  - «Призрачный Фонарщик»: a wrought arch on two stone pedestals with a plaque and an orange finial, 20 lanterns
 *    hanging along its inner edge (left foot = 1 … right foot = 20; glass vertices carry aFly = 10 + i, the shader
 *    darkens those above the pass level), and a mint ghost in a top hat with a cape, holding a lamplighter's pole with a
 *    flame (aFly = 3: a slower, deeper bob).
 * Everything goes into the Halloween extras mesh (src/events/halloween/hwgeo.ts Parts, ONE draw call with the cauldron,
 * candles and the witch on her broom). Low-poly (≈ 9k triangles both), shared colours, cartoon dark outlines on the big
 * parts only. Coordinates: world metres, the model faces +z (the street / canal side).
 */
import * as THREE from 'three';
import { Parts, M } from './hwgeo';
import type { NpcWorld } from './hwnpc';

/** aFly codes (see index.ts extras shader). */
export const FLY_MORTAR = 2, FLY_GHOST = 3, FLY_LAMP0 = 10;

const INK = '#1c1424';
const C = {
  wood: '#b8783e', woodD: '#6a4022', woodL: '#c88a50', iron: '#4a4458', ironL: '#6e6a7c', skin: '#a8d86a', hair: '#ff5a2a',
  vio: '#6a3fc4', vioD: '#47288a', hat: '#231a33', pump: '#ff7a1a', gold: '#ffc94d', cream: '#f3e6c8', ghost: [1.0, 1.5, 1.22] as [number, number, number],
  candy: ['#ff5aa8', '#ffd34d', '#6dffb0', '#b98aff', '#ff8a1f', '#4ab0ff'],
};
const shadeUp = (y0: number, h: number) => (_x: number, y: number) => 0.78 + 0.32 * Math.min(1, Math.max(0, (y - y0) / h));

/** A wrapped candy (ellipsoid + two twist cones) centred at (x, y, z). */
function candy(p: Parts, x: number, y: number, z: number, col: string, ry: number, fly: number): void {
  p.add(new THREE.SphereGeometry(0.05, 7, 5), col, M(x, y, z, 0, ry, 0, 1.25, 0.9, 0.9), fly);
  for (const s of [-1, 1]) p.add(new THREE.ConeGeometry(0.032, 0.05, 5), col, M(x + Math.cos(ry) * s * 0.075, y, z - Math.sin(ry) * s * 0.075, 0, ry, s * Math.PI / 2), fly);
}

/** Jack-o'-lantern (self-lit face via bright vertex colours). */
function jack(p: Parts, x: number, y: number, z: number, r: number): void {
  p.add(new THREE.SphereGeometry(r, 10, 7), C.pump, M(x, y + r * 0.85, z, 0, 0, 0, 1.12, 0.85, 1.05), 0, shadeUp(y, r * 1.7));
  p.add(new THREE.CylinderGeometry(r * 0.12, r * 0.16, r * 0.4, 5), '#3a7a2a', M(x, y + r * 1.75, z, 0, 0, 0.25));
  const glow: [number, number, number] = [2.4, 1.5, 0.45], f = z + r * 1.0;
  for (const s of [-1, 1]) p.add(new THREE.CircleGeometry(r * 0.2, 3), glow, M(x + s * r * 0.38, y + r * 1.0, f, 0, 0, Math.PI / 2));
  p.add(new THREE.CircleGeometry(r * 0.42, 8, Math.PI, Math.PI), glow, M(x, y + r * 0.66, f));
}

/** «Ступа сладостей». gy = ground height (m) at the spot. */
export function stupaGeometry(p: Parts, w: NpcWorld, gy: number): void {
  const [cx, cz] = w.base[0], F = FLY_MORTAR;
  const by = gy + 0.12;   // the mortar hovers a little (green glow under it)
  // glow + shadow on the ground
  p.add(new THREE.CircleGeometry(0.46, 16), [0.2, 0.5, 0.25], M(cx, gy + 0.015, cz, -Math.PI / 2, 0, 0));
  // the barrel: tapered lathe, planks as ridges, a light rim, two iron hoops with rivets
  const H = 0.95, r0 = 0.3, r1 = 0.4, prof: THREE.Vector2[] = [];
  for (let i = 0; i <= 6; i++) { const t = i / 6; prof.push(new THREE.Vector2(r0 + (r1 - r0) * t + 0.025 * Math.sin(t * Math.PI), t * H)); }
  p.add(new THREE.LatheGeometry(prof, 14), C.wood, M(cx, by, cz), F, (x, y, z) => (0.82 + 0.25 * ((y - by) / H)) * (Math.abs(Math.sin(Math.atan2(z - cz, x - cx) * 7)) < 0.2 ? 0.72 : 1));
  p.add(new THREE.TorusGeometry(r1 + 0.02, 0.035, 5, 18), C.woodL, M(cx, by + H, cz, Math.PI / 2, 0, 0), F);
  for (const [t, rr] of [[0.28, r0 + 0.035], [0.75, r0 + 0.08]] as const) {
    p.add(new THREE.CylinderGeometry(rr + 0.012, rr + 0.012, 0.07, 16, 1, true), C.iron, M(cx, by + t * H, cz), F);
    for (let k = 0; k < 5; k++) { const a = -Math.PI / 2 + (k - 2) * 0.5; p.add(new THREE.SphereGeometry(0.018, 5, 3), C.ironL, M(cx + Math.cos(a) * (rr + 0.02), by + t * H, cz - Math.sin(a) * (rr + 0.02)), F); }
  }
  // the witch (standing in the barrel): robe, belt, collar, head, hair, hat; one arm on the rim, one up on the staff
  const wy = by + H - 0.25;
  p.add(new THREE.CylinderGeometry(0.17, 0.25, 0.55, 10), C.vio, M(cx, wy + 0.27, cz), F, shadeUp(wy, 0.6));
  p.add(new THREE.TorusGeometry(0.205, 0.035, 5, 14), C.pump, M(cx, wy + 0.36, cz, Math.PI / 2, 0, 0), F);
  p.add(new THREE.BoxGeometry(0.07, 0.07, 0.03), C.gold, M(cx, wy + 0.36, cz + 0.22), F);
  p.add(new THREE.CylinderGeometry(0.2, 0.15, 0.06, 10), C.pump, M(cx, wy + 0.56, cz), F);
  const hy = wy + 0.76;
  p.add(new THREE.SphereGeometry(0.22, 12, 9), C.skin, M(cx, hy, cz, 0, 0, 0, 1, 0.95, 0.95), F, shadeUp(hy - 0.2, 0.4));
  p.add(new THREE.ConeGeometry(0.045, 0.16, 6), C.skin, M(cx, hy - 0.02, cz + 0.24, Math.PI / 2 + 0.3, 0, 0), F);   // hooked nose
  p.add(new THREE.SphereGeometry(0.02, 5, 4), '#7fb048', M(cx + 0.02, hy - 0.04, cz + 0.27), F);                 // the wart
  for (const s of [-1, 1]) {
    p.add(new THREE.SphereGeometry(0.06, 8, 6), '#ffffff', M(cx + s * 0.085, hy + 0.04, cz + 0.155), F);
    p.add(new THREE.SphereGeometry(0.03, 6, 4), INK, M(cx + s * 0.085, hy + 0.04, cz + 0.205), F);
    p.add(new THREE.SphereGeometry(0.035, 6, 4), '#ff8aa8', M(cx + s * 0.13, hy - 0.07, cz + 0.15), F);           // blush
    p.add(new THREE.SphereGeometry(0.11, 7, 6), C.hair, M(cx + s * 0.17, hy - 0.1, cz - 0.02, 0, 0, s * 0.3, 0.6, 1.3, 0.9), F);   // hair
  }
  p.add(new THREE.SphereGeometry(0.16, 8, 6), C.hair, M(cx, hy + 0.05, cz - 0.08, 0, 0, 0, 1.3, 0.9, 1), F);
  p.add(new THREE.CylinderGeometry(0.34, 0.34, 0.03, 16), C.hat, M(cx, hy + 0.15, cz, 0.08, 0, 0), F);
  p.add(new THREE.ConeGeometry(0.2, 0.58, 12), C.hat, M(cx - 0.02, hy + 0.44, cz - 0.02, 0.08, 0, 0.18), F, shadeUp(hy, 0.8));
  p.add(new THREE.CylinderGeometry(0.205, 0.21, 0.06, 12), C.pump, M(cx, hy + 0.19, cz, 0.08, 0, 0), F);
  p.add(new THREE.BoxGeometry(0.06, 0.05, 0.02), C.gold, M(cx, hy + 0.19, cz + 0.21), F);
  // arms: left hand on the rim, right arm up holding the staff
  p.add(new THREE.CylinderGeometry(0.045, 0.05, 0.36, 6), C.vio, M(cx - 0.22, wy + 0.38, cz + 0.08, 0.3, 0, -0.55), F);
  p.add(new THREE.SphereGeometry(0.055, 6, 5), C.skin, M(cx - 0.32, wy + 0.24, cz + 0.16), F);
  p.add(new THREE.CylinderGeometry(0.045, 0.05, 0.34, 6), C.vio, M(cx + 0.24, wy + 0.6, cz + 0.05, 0, 0, 0.9), F);
  p.add(new THREE.SphereGeometry(0.055, 6, 5), C.skin, M(cx + 0.36, wy + 0.72, cz + 0.06), F);
  p.add(new THREE.CylinderGeometry(0.022, 0.026, 1.7, 6), C.woodD, M(cx + 0.37, by + H + 0.1, cz + 0.06, 0, 0, -0.08), F);
  // candy heap and jars on the rim
  for (let i = 0; i < 9; i++) {
    const a = Math.PI * (0.05 + 0.9 * (i / 8)), rr = r1 - 0.06;
    candy(p, cx + Math.cos(a) * rr, by + H + 0.04 + (i % 2) * 0.03, cz + Math.sin(a) * rr * 0.9, C.candy[i % C.candy.length], a + 1.2, F);
  }
  for (const [s, glass, lid] of [[-1, '#7dffc8', C.vio], [1, '#ff8ac8', C.pump]] as const) {
    const x = cx + s * 0.31, z = cz + 0.12, y = by + H;
    p.add(new THREE.CylinderGeometry(0.075, 0.075, 0.18, 10), glass, M(x, y + 0.09, z), F, shadeUp(y, 0.2));
    p.add(new THREE.CylinderGeometry(0.083, 0.083, 0.04, 10), lid, M(x, y + 0.2, z), F);
    for (let k = 0; k < 3; k++) p.add(new THREE.SphereGeometry(0.03, 5, 4), C.candy[(k + (s > 0 ? 2 : 0)) % 6], M(x + (k - 1) * 0.035, y + 0.06 + (k % 2) * 0.05, z + 0.05), F);
  }
  // left: the sign board on a pole + the broom leaning on it (small obstacle base[1])
  const [sx, sz] = w.base[1] ?? [cx - 1.1, cz];
  p.add(new THREE.CylinderGeometry(0.03, 0.035, 2.0, 6), C.woodD, M(sx, gy + 1.0, sz));
  p.add(new THREE.BoxGeometry(0.95, 0.5, 0.06), INK, M(sx + 0.45, gy + 2.02, sz));
  p.add(new THREE.BoxGeometry(0.88, 0.43, 0.07), '#2a2048', M(sx + 0.45, gy + 2.02, sz));
  p.add(new THREE.BoxGeometry(0.8, 0.035, 0.08), C.gold, M(sx + 0.45, gy + 2.18, sz));
  p.add(new THREE.BoxGeometry(0.8, 0.035, 0.08), C.gold, M(sx + 0.45, gy + 1.86, sz));
  for (let i = 0; i < 6; i++) p.add(new THREE.BoxGeometry(0.075, 0.1, 0.02), [2.0, 1.45, 0.5], M(sx + 0.16 + i * 0.115, gy + 2.06, sz + 0.045));      // «СТУПА» glyph blocks
  for (let i = 0; i < 9; i++) p.add(new THREE.BoxGeometry(0.05, 0.05, 0.02), C.cream, M(sx + 0.12 + i * 0.083, gy + 1.94, sz + 0.045));         // «сладостей»
  p.add(new THREE.CylinderGeometry(0.02, 0.022, 1.3, 5), C.woodL, M(sx + 0.12, gy + 0.68, sz + 0.08, 0, 0, -0.18));
  p.add(new THREE.ConeGeometry(0.13, 0.36, 8, 1, true), '#d8b45a', M(sx + 0.24, gy + 0.12, sz + 0.08, 0, 0, -0.18));
  p.add(new THREE.TorusGeometry(0.05, 0.018, 4, 8), C.vio, M(sx + 0.21, gy + 0.3, sz + 0.08, Math.PI / 2, 0, 0));
  // right: two jack-o'-lanterns (small obstacle base[2])
  const [jx, jz] = w.base[2] ?? [cx + 1.1, cz];
  jack(p, jx - 0.08, gy, jz, 0.17);
  jack(p, jx + 0.2, gy, jz + 0.04, 0.12);
}

/** Arch curve: a pointed parabola from the left foot (t = 0) over the apex (t = 0.5) to the right foot (t = 1). */
function archPoint(xL: number, xR: number, y0: number, legH: number, top: number, t: number, out: THREE.Vector3, z: number): THREE.Vector3 {
  const xm = (xL + xR) / 2, hw = (xR - xL) / 2;
  // legs straight up to legH, then a curve to the apex (u ∈ [0, 1] per side)
  const side = t < 0.5 ? -1 : 1, u = t < 0.5 ? t * 2 : (1 - t) * 2;   // 0 at a foot, 1 at the apex
  const legU = 0.32;
  if (u <= legU) return out.set(xm + side * hw, y0 + legH * (u / legU), z);
  const k = (u - legU) / (1 - legU);   // 0 at the springing, 1 at the apex
  const ang = k * Math.PI / 2;
  return out.set(xm + side * hw * Math.cos(ang) ** 0.9, y0 + legH + (top - legH) * Math.sin(ang) ** 1.15, z);
}

/** Lantern hang points (20, left foot → right foot) — also used for the halos. Writes x, y, z (lantern centre). */
export function lanternPoints(w: NpcWorld, gy: number): THREE.Vector3[] {
  const L = archFrame(w, gy), out: THREE.Vector3[] = [];
  const tmp = new THREE.Vector3(), c = new THREE.Vector3((L.xL + L.xR) / 2, 0, 0);
  for (let i = 0; i < 20; i++) {
    const t = 0.05 + 0.9 * (i / 19);
    archPoint(L.xL, L.xR, L.y0, L.legH, L.top, t, tmp, L.z);
    // hang inward from the arch: towards the middle and down
    const dx = c.x - tmp.x, inward = Math.sign(dx) * Math.min(0.17, Math.abs(dx));
    out.push(new THREE.Vector3(tmp.x + inward, tmp.y - 0.2, L.z + 0.02));
  }
  return out;
}

function archFrame(w: NpcWorld, gy: number) {
  const a = w.base[0], b = w.base[1];
  const xL = a ? a[0] : w.x0 + 0.2, xR = b ? b[0] : w.x1 - 0.2, z = a ? a[1] : w.z;
  return { xL, xR, z, y0: gy + 0.3, legH: 0.95, top: Math.max(2.4, w.h - 0.3) };
}

function ghostFrame(w: NpcWorld, gy: number) {
  const L = archFrame(w, gy), ax = (L.xL + L.xR) / 2;
  const g = w.base[2] ?? [ax - 0.3, L.z, 0.26, 0.15], gx = g[0], gz = g[1] + 0.05, y0 = gy + 0.12;
  return { gx, gz, y0, px1: gx - 0.25, py1: y0 + 2.0 };
}
/** The flame at the tip of the lamplighter's pole (a halo point, always lit). */
export function poleFlame(w: NpcWorld, gy: number): THREE.Vector3 { const f = ghostFrame(w, gy); return new THREE.Vector3(f.px1, f.py1 + 0.1, f.gz + 0.2); }

/** «Призрачный Фонарщик». */
export function passGeometry(p: Parts, w: NpcWorld, gy: number): void {
  const L = archFrame(w, gy);
  // pedestals
  for (const x of [L.xL, L.xR]) {
    p.add(new THREE.BoxGeometry(0.3, 0.3, 0.27), '#6a6680', M(x, gy + 0.15, L.z), 0, shadeUp(gy, 0.3));
    p.add(new THREE.BoxGeometry(0.34, 0.05, 0.3), '#827c98', M(x, gy + 0.31, L.z));
  }
  // the wrought arch: a tube along the curve + an inner thinner tube + little scrolls
  const pts: THREE.Vector3[] = [], inner: THREE.Vector3[] = [];
  for (let i = 0; i <= 40; i++) {
    pts.push(archPoint(L.xL, L.xR, L.y0, L.legH, L.top, i / 40, new THREE.Vector3(), L.z));
    const q = archPoint(L.xL, L.xR, L.y0, L.legH, L.top, i / 40, new THREE.Vector3(), L.z);
    const cx = (L.xL + L.xR) / 2; q.x += Math.sign(cx - q.x) * 0.1; q.y -= 0.08 * Math.min(1, (q.y - L.y0) / 0.6); inner.push(q);
  }
  const curve = new THREE.CatmullRomCurve3(pts), curveI = new THREE.CatmullRomCurve3(inner);
  p.add(new THREE.TubeGeometry(curve, 48, 0.055, 6), '#6a6484', undefined, 0, shadeUp(gy, 3));
  p.add(new THREE.TubeGeometry(curveI, 40, 0.022, 5), '#433d56');
  for (let i = 1; i < 10; i++) {   // ties between the two rails
    const t = i / 10, a = curve.getPoint(t), b = curveI.getPoint(t), d = new THREE.Vector3().subVectors(b, a), len = d.length();
    const m = new THREE.Matrix4().makeRotationFromQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize()));
    m.setPosition((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
    p.add(new THREE.CylinderGeometry(0.015, 0.015, len, 4), '#433d56', m);
  }
  // finial + plaque on top
  const ax = (L.xL + L.xR) / 2, ay = L.top;
  p.add(new THREE.ConeGeometry(0.09, 0.22, 4), INK, M(ax, ay + 0.15, L.z));
  p.add(new THREE.OctahedronGeometry(0.07), [2.2, 1.2, 0.35], M(ax, ay + 0.3, L.z));
  p.add(new THREE.BoxGeometry(1.0, 0.36, 0.06), '#8a5a2a', M(ax, ay + 0.55, L.z));
  p.add(new THREE.BoxGeometry(0.92, 0.29, 0.07), '#211a3a', M(ax, ay + 0.55, L.z));
  for (let i = 0; i < 8; i++) p.add(new THREE.BoxGeometry(0.07, 0.09, 0.02), [2.0, 1.1, 0.4], M(ax - 0.33 + i * 0.094, ay + 0.6, L.z + 0.045));   // «ФОНАРЩИК»
  p.add(new THREE.BoxGeometry(0.64, 0.025, 0.02), '#d8d0f0', M(ax, ay + 0.48, L.z + 0.045));
  // 20 lanterns: hook string, iron cap, glass (aFly = 10 + i), bottom
  const lamps = lanternPoints(w, gy);
  lamps.forEach((q, i) => {
    const top = archPoint(L.xL, L.xR, L.y0, L.legH, L.top, 0.05 + 0.9 * (i / 19), new THREE.Vector3(), L.z);
    const d = new THREE.Vector3(q.x - top.x, q.y + 0.08 - top.y, 0), len = d.length();
    const m = new THREE.Matrix4().makeRotationFromQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize()));
    m.setPosition((q.x + top.x) / 2, (q.y + 0.08 + top.y) / 2, L.z + 0.02);
    p.add(new THREE.CylinderGeometry(0.006, 0.006, len, 3), INK, m);
    p.add(new THREE.ConeGeometry(0.06, 0.05, 6), C.iron, M(q.x, q.y + 0.08, q.z));
    p.add(new THREE.CylinderGeometry(0.048, 0.048, 0.11, 6), [2.4, 1.45, 0.5], M(q.x, q.y, q.z), FLY_LAMP0 + i + 1);
    p.add(new THREE.CylinderGeometry(0.055, 0.04, 0.03, 6), C.iron, M(q.x, q.y - 0.065, q.z));
  });
  // the ghost: lathe body with a scalloped hem, cape, top hat, eyes, moustache, pole with a flame (aFly = 3)
  const { gx, gz, y0, px1, py1 } = ghostFrame(w, gy), F = FLY_GHOST;
  const prof: THREE.Vector2[] = [];
  for (let i = 0; i <= 10; i++) { const t = i / 10; prof.push(new THREE.Vector2(Math.max(0.001, 0.26 * Math.sin(Math.PI * (0.5 + 0.5 * t)) ** 0.6 + 0.04 * (1 - t)), t * 1.15)); }
  prof.push(new THREE.Vector2(0.001, 1.16));
  p.add(new THREE.LatheGeometry(prof, 14), C.ghost, M(gx, y0, gz), F, (x, y, z) => (0.85 + 0.3 * Math.min(1, (y - y0) / 1.1)) * (x - gx > 0.1 ? 1.12 : 1) + 0 * z);
  for (let k = 0; k < 7; k++) { const a = (k / 7) * Math.PI * 2; p.add(new THREE.SphereGeometry(0.07, 6, 4), C.ghost, M(gx + Math.cos(a) * 0.25, y0 + 0.01, gz + Math.sin(a) * 0.25, 0, 0, 0, 1, 0.7, 1), F); }
  p.add(new THREE.CylinderGeometry(0.2, 0.3, 0.42, 12, 1, true), C.vioD, M(gx, y0 + 0.42, gz), F);
  p.add(new THREE.TorusGeometry(0.21, 0.03, 4, 12), C.gold, M(gx, y0 + 0.6, gz, Math.PI / 2, 0, 0), F);
  p.add(new THREE.SphereGeometry(0.04, 6, 4), C.gold, M(gx, y0 + 0.5, gz + 0.24), F);
  const hy = y0 + 1.12;
  for (const s of [-1, 1]) {
    p.add(new THREE.SphereGeometry(0.068, 8, 6), INK, M(gx + s * 0.09, y0 + 0.93, gz + 0.19, 0, 0, 0, 0.85, 1.2, 0.6), F);
    p.add(new THREE.SphereGeometry(0.022, 5, 4), '#ffffff', M(gx + s * 0.09 - 0.015, y0 + 0.97, gz + 0.23), F);
    p.add(new THREE.CapsuleGeometry(0.018, 0.08, 2, 4), '#3a2f4a', M(gx + s * 0.05, y0 + 0.84, gz + 0.225, 0, 0, s * (Math.PI / 2 - 0.35)), F);
  }
  p.add(new THREE.CylinderGeometry(0.3, 0.3, 0.025, 14), C.hat, M(gx, hy, gz), F);
  p.add(new THREE.CylinderGeometry(0.16, 0.17, 0.36, 12), C.hat, M(gx, hy + 0.19, gz), F, shadeUp(hy, 0.4));
  p.add(new THREE.CylinderGeometry(0.172, 0.172, 0.06, 12), C.pump, M(gx, hy + 0.06, gz), F);
  // arm + pole (up-left, the flame by the first unlit lanterns)
  p.add(new THREE.CapsuleGeometry(0.05, 0.3, 2, 6), C.ghost, M(gx + 0.28, y0 + 0.7, gz + 0.08, 0, 0, 0.5), F);
  const px0 = gx + 0.36, py0 = y0 + 0.5;
  const pd = new THREE.Vector3(px1 - px0, py1 - py0, 0), pl = pd.length();
  const pm = new THREE.Matrix4().makeRotationFromQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), pd.normalize()));
  pm.setPosition((px0 + px1) / 2, (py0 + py1) / 2, gz + 0.14);
  p.add(new THREE.CylinderGeometry(0.018, 0.022, pl, 5), '#c8a070', pm, F);
  p.add(new THREE.CylinderGeometry(0.06, 0.05, 0.08, 6), C.iron, M(px1, py1 - 0.01, gz + 0.16), F);
  p.add(new THREE.SphereGeometry(0.09, 8, 6), [3.0, 1.5, 0.35], M(px1, py1 + 0.1, gz + 0.16, 0, 0, 0, 1, 1.35, 1), F);
  p.add(new THREE.ConeGeometry(0.035, 0.1, 5), [3.2, 2.8, 1.2], M(px1, py1 + 0.08, gz + 0.2), F);
}
