/**
 * 3D weapons and shields (vertex-coloured parts). Weapon space: grip at the origin, business end towards +Y.
 * Shield space: face towards −Z, centre at the origin.
 */
import * as THREE from 'three';
import { Parts, T, cyl, cone, sphere, box, torus, slab, tube, star, INK } from './geom';
import { RARITY_COLOR } from './appearance';

export const METAL: Record<string, string> = { common: '#b7bec4', uncommon: '#cdeec4', rare: '#bfe3ff', epic: '#e0c8ff', legendary: '#ffd76a' };
const WOOD = '#8a5a2b', DWOOD = '#5a3a1c', GOLD = '#e8b923', BONE = '#ebe2c9';
const accent = (r?: string) => (r && r !== 'common' ? RARITY_COLOR[r] : null);

/** Add weapon parts (in weapon space transformed by `m`) to `p`. */
/** Bow string ends and centre in WEAPON space (the bow as built by addWeapon), for the drawn-string overlay. */
export const BOW_STRING = { top: [0, 0.08 + Math.sin(1.1) * 0.32, -Math.cos(1.1) * 0.12 + 0.05], bottom: [0, 0.08 - Math.sin(1.1) * 0.32, -Math.cos(1.1) * 0.12 + 0.05], grip: [0, 0.08, -0.07] } as const;

/** `stringBone`: skin the bow string to this bone (the TP body hides it while the drawn string is shown). */
export function addWeapon(p: Parts, kind: string, rar: string | undefined, m: THREE.Matrix4, lowDetail = false, stringBone?: number): void {
  const metal = METAL[rar || 'common'] || METAL.common, acc = accent(rar);
  const M = (x: THREE.Matrix4) => new THREE.Matrix4().multiplyMatrices(m, x);
  const seg = lowDetail ? 6 : 10;
  const grip = (y0: number, y1: number, r = 0.018, c = WOOD) => p.add(cyl(r, r, y1 - y0, seg), c, M(T(0, (y0 + y1) / 2, 0)));
  const gem = (y: number, z = -0.02, r = 0.016) => { if (acc) p.add(new THREE.OctahedronGeometry(r, 0), acc, M(T(0, y, z))); };
  switch (kind) {
    case 'gladius': {
      grip(-0.09, 0.0, 0.017, DWOOD); p.add(sphere(0.025, seg, 6), metal, M(T(0, -0.1, 0)));
      p.add(box(0.12, 0.035, 0.05), '#b8892a', M(T(0, 0.012, 0)));
      p.add(slab([[-0.035, 0], [-0.045, 0.12], [-0.03, 0.24], [0, 0.32], [0.03, 0.24], [0.045, 0.12], [0.035, 0]], 0.018), metal, M(T(0, 0.025, 0)));
      gem(0.012, -0.03); break;
    }
    case 'dagger': {
      grip(-0.07, 0.0, 0.016, DWOOD);
      p.add(box(0.09, 0.03, 0.04), '#6d5a45', M(T(0, 0.01, 0)));
      p.add(slab([[-0.025, 0], [-0.025, 0.14], [0, 0.19], [0.025, 0.14], [0.025, 0]], 0.014), metal, M(T(0, 0.02, 0)));
      gem(0.01, -0.025); break;
    }
    case 'kris': {
      grip(-0.08, 0.0, 0.016, '#3a2a40'); p.add(sphere(0.022, seg, 6), metal, M(T(0, -0.09, 0)));
      const pts: [number, number][] = [];
      for (let i = 0; i <= 8; i++) pts.push([-0.024 + Math.sin(i * 1.3) * 0.012, i * 0.032]);
      pts.push([0, 0.29]);
      for (let i = 8; i >= 0; i--) pts.push([0.024 + Math.sin(i * 1.3) * 0.012, i * 0.032]);
      p.add(slab(pts, 0.014), metal, M(T(0, 0.01, 0)));
      p.add(box(0.1, 0.026, 0.035), '#5a4a6a', M(T(0, 0.0, 0)));
      gem(0.0, -0.02); break;
    }
    case 'axe': {
      grip(-0.12, 0.42, 0.017);
      p.add(slab([[0, 0.03], [0.08, 0.06], [0.15, 0.04], [0.21, -0.04], [0.22, -0.16], [0.15, -0.11], [0.07, -0.1], [0, -0.08]], 0.022, 0.003), metal, M(T(0.01, 0.4, 0)));
      gem(0.37, -0.03); break;
    }
    case 'club': {
      p.add(cyl(0.06, 0.022, 0.45, seg), WOOD, M(T(0, 0.12, 0)));
      p.add(sphere(0.06, seg, 6), WOOD, M(T(0, 0.345, 0)));
      p.add(sphere(0.015, 6, 4), DWOOD, M(T(0.05, 0.25, -0.02)));
      p.add(sphere(0.013, 6, 4), DWOOD, M(T(-0.04, 0.17, -0.02)));
      break;
    }
    case 'mace': {
      grip(-0.1, 0.32, 0.019);
      p.add(sphere(0.07, seg, 8), metal, M(T(0, 0.37, 0)));
      if (!lowDetail) for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; p.add(cyl(0.012, 0.016, 0.05, 5), metal, M(T(Math.sin(a) * 0.085, 0.37 + Math.cos(a) * 0.085, 0, 0, 0, -a))); p.add(sphere(0.016, 6, 4), metal, M(T(Math.sin(a) * 0.11, 0.37 + Math.cos(a) * 0.11, 0))); }
      gem(0.35, -0.07); break;
    }
    case 'hammer': {
      grip(-0.1, 0.34, 0.019);
      p.add(box(0.22, 0.12, 0.1), metal, M(T(0, 0.38, 0)));
      for (const sx of [-1, 1]) p.add(cyl(0.06, 0.06, 0.012, seg), metal, M(T(sx * 0.11, 0.38, 0, 0, 0, Math.PI / 2)));
      gem(0.36, -0.055); break;
    }
    case 'spear': {
      grip(-0.25, 0.55, 0.016);
      p.add(slab([[-0.05, 0], [0.05, 0], [0, 0.2]], 0.024, 0.004), metal, M(T(0, 0.555, 0)));
      p.add(cyl(0.022, 0.022, 0.025, 8), '#e8455c', M(T(0, 0.545, 0)));
      gem(0.545, -0.024, 0.012);
      break;
    }
    case 'pitchfork': {
      grip(-0.25, 0.48, 0.018);
      p.add(box(0.2, 0.026, 0.026), metal, M(T(0, 0.49, 0)));
      for (const x of [-0.09, 0, 0.09]) p.add(cyl(0.011, 0.013, x ? 0.17 : 0.2, 6), metal, M(T(x, x ? 0.575 : 0.59, 0)));
      for (const x of [-0.09, 0, 0.09]) p.add(cone(0.012, 0.03, 6), metal, M(T(x, x ? 0.675 : 0.705, 0)));
      break;
    }
    case 'bow': {
      const arc: [number, number, number][] = [];
      for (let i = 0; i <= 10; i++) { const a = -1.1 + (2.2 * i) / 10; arc.push([0, Math.sin(a) * 0.32 + 0.08, -Math.cos(a) * 0.12 + 0.05]); }
      p.add(tube(arc, 0.017, lowDetail ? 10 : 18, 5), acc ? metal : '#c48a4a', m);   // wood always (pale limbs vanished against the sky); rarity shows in the gem + tips
      if (acc) for (const sy of [-1, 1]) p.add(sphere(0.014, 6, 4), acc, M(T(0, Math.sin(1.1 * sy) * 0.32 + 0.08, -Math.cos(1.1) * 0.12 + 0.05)));
      p.add(cyl(0.004, 0.004, Math.sin(1.1) * 0.64, 4), '#f5f2ff', M(T(0, 0.08, Math.cos(1.1) * -0.12 + 0.05)), stringBone);
      p.add(cyl(0.022, 0.022, 0.08, seg), '#7a4a2a', M(T(0, 0.08, -0.07)));
      gem(0.08, -0.095, 0.014); break;
    }
    case 'staff': {
      grip(-0.3, 0.56, 0.018);
      if (acc) {
        p.add(new THREE.OctahedronGeometry(0.06, 0), acc, M(T(0, 0.64, 0, 0, Math.PI / 4, 0, [0.8, 1.3, 0.8])));
        p.add(sphere(0.012, 6, 4), '#ffffff', M(T(-0.015, 0.67, -0.03)));
      } else p.add(sphere(0.04, seg, 8), WOOD, M(T(0, 0.6, 0)));
      break;
    }
    case 'crook': {
      grip(-0.3, 0.46, 0.018);
      const hook: [number, number, number][] = [];
      for (let i = 0; i <= 12; i++) { const a = Math.PI - (i / 12) * Math.PI * 1.7, r = 0.075 - i * 0.0035; hook.push([0.065 + Math.cos(a) * r, 0.5 + Math.sin(a) * r * 1.1, 0]); }
      p.add(tube([[0, 0.44, 0], [-0.005, 0.48, 0], ...hook], 0.018, lowDetail ? 10 : 18, 5), WOOD, m);
      p.add(slab([[0, 0], [-0.03, 0.015], [-0.06, 0.05], [-0.02, 0.04]], 0.006), '#6fdc6f', M(T(-0.015, 0.4, 0)));
      if (acc) p.add(sphere(0.016, 6, 4), acc, M(T(0, 0.44, -0.02)));
      break;
    }
    case 'censer': {
      // hangs down from the paw (chain towards −Y)
      const bowlC = acc ? metal : '#c58a45';
      p.add(cyl(0.004, 0.004, 0.18, 4), '#e8e4f0', M(T(0, -0.09, 0)));
      p.add(new THREE.SphereGeometry(0.065, seg, 6, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), bowlC, M(T(0, -0.2, 0, 0, 0, 0, [1, 0.85, 1])));
      p.add(torus(0.064, 0.008, 4, 14), acc || '#8a5a2b', M(T(0, -0.2, 0, Math.PI / 2)));
      p.add(cyl(0.05, 0.05, 0.006, seg), '#3a2a20', M(T(0, -0.203, 0)));
      if (!lowDetail) { p.add(sphere(0.024, 6, 4), '#ebebf5', M(T(-0.03, -0.15, -0.01))); p.add(sphere(0.03, 6, 4), '#ebebf5', M(T(0.015, -0.1, -0.01))); p.add(sphere(0.026, 6, 4), '#f2f2f8', M(T(-0.01, -0.05, -0.01))); }
      break;
    }
    case 'skullstaff': {
      grip(-0.3, 0.55, 0.018, '#4a3a2a');
      p.add(sphere(0.07, seg, 8), BONE, M(T(0, 0.64, 0)));
      p.add(box(0.08, 0.05, 0.07), BONE, M(T(0, 0.58, -0.01)));
      p.add(sphere(0.018, 6, 4), acc || INK, M(T(-0.026, 0.645, -0.06)));
      p.add(sphere(0.018, 6, 4), acc || INK, M(T(0.026, 0.645, -0.06)));
      p.add(cyl(0.008, 0.008, 0.08, 4), '#4a3a2a', M(T(-0.05, 0.4, 0, 0, 0, 0.8)));
      break;
    }
    case 'grimoire': {
      const rune = acc || '#9fffd0';
      p.add(box(0.2, 0.25, 0.06), '#4a2a6a', M(T(0, 0.12, 0)));
      p.add(box(0.012, 0.232, 0.05), '#efe6d2', M(T(0.098, 0.12, 0)));
      p.add(box(0.04, 0.256, 0.066), '#2e1a44', M(T(-0.085, 0.12, 0)));
      p.add(box(0.05, 0.045, 0.07), metal, M(T(0.1, 0.13, 0)));
      p.add(torus(0.045, 0.008, 4, 16), rune, M(T(0.015, 0.125, -0.032)));
      for (const sx of [-1, 1]) p.add(sphere(0.011, 6, 4), rune, M(T(0.015 + sx * 0.017, 0.135, -0.034, 0, 0, 0, [1, 1, 0.4])));
      p.add(box(0.03, 0.007, 0.004), rune, M(T(0.015, 0.105, -0.032)));
      break;
    }
    case 'holymace': {
      grip(-0.1, 0.32, 0.019);
      const g = rar === 'legendary' || rar === 'epic' ? '#ffd76a' : metal;
      p.add(cyl(0.03, 0.03, 0.025, seg), g, M(T(0, 0.33, 0)));
      p.add(sphere(0.066, seg, 8), g, M(T(0, 0.42, 0, 0, 0, 0, [1, 1, 0.7])));
      for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; p.add(cyl(0.014, 0.014, 0.05, 5), g, M(T(Math.sin(a) * 0.09, 0.42 + Math.cos(a) * 0.09, 0, 0, 0, -a))); }
      p.add(sphere(0.026, 8, 6), acc || '#ffe9a8', M(T(0, 0.42, -0.04, 0, 0, 0, [1, 1, 0.6])));
      break;
    }
    case 'sword': default: {
      grip(-0.1, 0.0, 0.017, DWOOD); p.add(sphere(0.026, seg, 6), metal, M(T(0, -0.11, 0)));
      p.add(box(0.15, 0.035, 0.045), '#6d5a45', M(T(0, 0.012, 0)));
      p.add(slab([[-0.03, 0], [-0.03, 0.34], [0, 0.4], [0.03, 0.34], [0.03, 0]], 0.016), metal, M(T(0, 0.025, 0)));
      gem(0.012, -0.028); break;
    }
  }
}

/**
 * The striking part of a weapon in WEAPON space (as built by addWeapon: grip at the origin, along +Y): [y0, y1] of
 * the blade / head, for the swing trail (src/combat trail.ts). null = nothing to trail (bow, tome, censer).
 */
const BLADE: Record<string, [number, number]> = {
  sword: [0.1, 0.42], gladius: [0.06, 0.34], dagger: [0.04, 0.2], kris: [0.04, 0.3], axe: [0.2, 0.42], club: [0.14, 0.4],
  mace: [0.26, 0.44], hammer: [0.26, 0.42], holymace: [0.3, 0.5], spear: [0.36, 0.72], pitchfork: [0.36, 0.68],
  staff: [0.4, 0.64], crook: [0.36, 0.58], skullstaff: [0.4, 0.7],
};
export function bladeSpan(kind: string): [number, number] | null { return BLADE[kind] ?? (kind === 'bow' || kind === 'grimoire' || kind === 'censer' ? null : BLADE.sword); }

const HOLD_EDGE_FWD = new Set(['sword', 'gladius', 'dagger', 'kris', 'axe', 'hammer', 'spear', 'crook']);
/**
 * Canonical hold of a weapon in HAND space, shared by the third-person body (model.ts) and the first-person
 * view-model (viewmodel.ts), so a held item always "looks" the same way:
 * grip at the origin, +Y along the grip towards the business end, −Z = forward (where the holder faces / strikes),
 * +Z = towards the holder (the camera in FP and in TP from behind), +X = the holder's right.
 * - sword / gladius / dagger / kris: edge forward, flat sideways;  axe / hammer: the striking head forward;
 *   spear: blade edges forward;  crook: the hook forward;  skullstaff: the skull already faces forward (−Z);
 * - bow: limbs up/down in the aim plane (YZ), string towards the holder, the grip (arrow rest) at the origin;
 * - grimoire: cover (star) towards the holder, the spine in the paw;  censer: chain straight down (−Y);
 * - mace / holymace / club / staff / pitchfork: symmetric enough — unchanged.
 * Compose as `handMatrix × weaponHold(kind)` and pass the product to addWeapon.
 */
export function weaponHold(kind: string): THREE.Matrix4 {
  if (HOLD_EDGE_FWD.has(kind)) return T(0, 0, 0, 0, Math.PI / 2, 0);
  if (kind === 'bow') return T(0, -0.08, 0.07);                       // grip (0, 0.08, −0.07) → origin; string already at +Z
  if (kind === 'grimoire') return T(-0.085, -0.06, 0, 0, Math.PI, 0);   // cover → +Z, spine (x −0.085) → grip
  return new THREE.Matrix4();
}

/** Shield parts (face towards −Z). */
export function addShield(p: Parts, kind: string, rar: string | undefined, m: THREE.Matrix4, lowDetail = false): void {
  const acc = accent(rar), M = (x: THREE.Matrix4) => new THREE.Matrix4().multiplyMatrices(m, x), seg = lowDetail ? 10 : 20;
  const disc = (r: number, h: number, c: string, z = 0) => p.add(cyl(r, r, h, seg), c, M(T(0, 0, z, Math.PI / 2)));
  switch (kind) {
    case 'scutum': {
      // curved rectangle: part of an open cylinder (convex towards −Z)
      const R = 0.32, arc = 0.85, h = 0.42;
      const g = new THREE.CylinderGeometry(R, R, h, 10, 1, true, Math.PI - arc / 2, arc);
      p.add(g, '#c0182b', M(T(0, 0, R - 0.02)));
      // inner (back) side: a slightly smaller arc on the SAME axis, winding reversed by mirroring x (the arc is
      // symmetric about x = 0). It used to be rotated by π as well, which put a dark sheet ~0.6 m behind the
      // shield, sticking out of the character's back (owner's bug #8).
      const TH = 0.014;
      const back = new THREE.CylinderGeometry(R - TH, R - TH, h - 0.004, 10, 1, true, Math.PI - arc / 2, arc);
      back.scale(-1, 1, 1);
      p.add(back, '#a87a4a', M(T(0, 0, R - 0.02)));
      p.add(box(0.03, h * 0.5, 0.025), '#5a3a1c', M(T(0, 0, 0.012 - 0.02 + TH)));
      // rim: close the gap between the two layers along the edges
      const edgeX = Math.sin(arc / 2) * (R - TH / 2), edgeZ = R - 0.02 - Math.cos(arc / 2) * (R - TH / 2);
      for (const sx of [-1, 1]) p.add(box(TH + 0.006, h, TH + 0.004), GOLD, M(T(sx * edgeX, 0, edgeZ, 0, sx * arc / 2, 0)));
      for (const sy of [-1, 1]) {
        const pts: [number, number, number][] = [];
        for (let i = 0; i <= 8; i++) { const a = Math.PI - arc / 2 + (arc * i) / 8; pts.push([Math.sin(a) * (R - TH / 2), sy * h / 2, Math.cos(a) * (R - TH / 2) + R - 0.02]); }
        p.add(tube(pts, TH / 2 + 0.003, 10, 4), GOLD, m);
      }
      p.add(sphere(0.045, 10, 6), acc || GOLD, M(T(0, 0, -0.035, 0, 0, 0, [1, 1, 0.6])));
      p.add(box(0.025, h * 0.9, 0.02), GOLD, M(T(0, 0, -0.012)));
      p.add(box(0.27, 0.022, 0.02), GOLD, M(T(0, 0, -0.012)));
      break;
    }
    case 'buckler': {
      disc(0.11, 0.025, METAL[rar || 'common'] || METAL.common);
      p.add(torus(0.11, 0.012, 5, seg), acc || '#8a8a8a', M(T(0, 0, 0)));
      p.add(sphere(0.035, 10, 6), '#6d5a45', M(T(0, 0, -0.012, 0, 0, 0, [1, 1, 0.6])));
      if (acc) p.add(torus(0.075, 0.006, 4, seg), acc, M(T(0, 0, -0.014)));
      break;
    }
    case 'barrel': {
      disc(0.17, 0.05, '#a0703a');
      for (const y of [-0.06, 0.05]) p.add(box(0.3, 0.008, 0.004), '#6b4423', M(T(0, y, -0.026)));
      p.add(torus(0.14, 0.014, 5, seg), '#4a4a4f', M(T(0, 0, -0.026)));
      if (acc) p.add(torus(0.17, 0.01, 4, seg), acc, M(T(0, 0, -0.01)));
      break;
    }
    case 'round': default: {
      const rim = METAL[rar || 'common'] || METAL.common;
      disc(0.17, 0.035, '#9a6a3a');
      for (const y of [-0.055, 0.055]) p.add(box(0.31, 0.01, 0.004), '#6b4423', M(T(0, y, -0.018)));
      p.add(torus(0.148, 0.013, 5, seg), rim, M(T(0, 0, -0.016)));
      p.add(sphere(0.045, 10, 6), rim, M(T(0, 0, -0.016, 0, 0, 0, [1, 1, 0.6])));
      p.add(torus(0.17, 0.01, 4, seg), acc || '#6b4423', M(T(0, 0, 0)));   // rim (keeps the held-shield footprint)
      break;
    }
  }
}
