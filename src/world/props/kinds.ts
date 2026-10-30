/**
 * Prop geometry factories. Each builds a PB (part builder) → parts merged per material.
 * Conventions: metres, origin = footprint centre on the ground, front = +Z. Chunky, rounded, toy-like proportions
 * for ~1.35 m chibi characters (site's cute night-fair look).
 */
import * as THREE from 'three';
import { BRIDGE_HUMP } from '../ground';
import { flipped } from '../batch';
import { PB, rbox, box, cyl, sph, cone, torus, capsule, lathe, slab, type PropPart } from './build';

const PI = Math.PI;

/** Default colours (CATS palette of the site, slightly lifted for lit 3D). */
export const PC = {
  iron: '#4a4270', ironL: '#7468a0', ironD: '#2e2848',
  wood: '#b98257', woodD: '#7d5034', woodL: '#e0aa70', woodR: '#9a5a3a',
  stone: '#b9aec6', stoneD: '#8f86a0', stoneW: '#e2d4be', stoneR: '#d88a68',
  glass: '#ffd76a', glassW: '#ffe9a8',
  leaf: '#5aa04a', leafD: '#3e7a38', leafL: '#86c45e',
  pink: '#ff8fa3', yellow: '#ffcf4a', plum: '#6a2a5a', plumL: '#9a4a8a', red: '#e0605a', cream: '#f7e8d0',
  teal: '#5fbfa8', blue: '#7fb0e8', lilac: '#b79be0', orange: '#f0903a',
  water: '#6cc0ff', waterD: '#2f5f9a', hay: '#efc75e', hayD: '#c99a3a', gold: '#f5c04a', soil: '#5a3a26',
  roof: '#8a4a8a', burlap: '#d2b07a', marble: '#e6dccd', marbleD: '#c9bdb0',
};

export interface KindOpts { variant?: number; colors?: string[] }
export const AWNINGS: [string, string][] = [
  ['#e0605a', '#f7e8d0'], ['#b79be0', '#f7e8d0'], ['#5fbfa8', '#f7e8d0'], ['#7fb0e8', '#fff3d6'], ['#ff8fa3', '#fff0f4'], ['#ffcf4a', '#8a4a8a'],
];

const col = (o: KindOpts, i: number, d: string) => o.colors?.[i] ?? d;

/* ------------------------------------------------------------------ lighting */

export const LAMP_HEAD = new THREE.Vector3(0, 2.94, 0);

function lamp(): PropPart[] {
  const b = new PB();
  b.add('metal', lathe([[0, 0], [0.27, 0], [0.27, 0.09], [0.21, 0.13], [0.15, 0.24], [0.1, 0.4], [0, 0.4]], 12), PC.iron);
  b.add('metal', cyl(0.062, 0.075, 2.3, 10), PC.iron, { p: [0, 1.5, 0] });
  b.add('metal', torus(0.082, 0.026, 5, 12), PC.ironL, { p: [0, 0.9, 0], r: [PI / 2, 0, 0] });
  b.add('metal', torus(0.078, 0.024, 5, 12), PC.ironL, { p: [0, 2.2, 0], r: [PI / 2, 0, 0] });
  // scroll brackets under the head
  for (const s of [-1, 1]) b.add('metal', torus(0.1, 0.016, 4, 10, PI), PC.iron, { p: [s * 0.1, 2.52, 0], r: [0, 0, s > 0 ? PI / 2 : -PI / 2] });
  b.add('metal', cyl(0.14, 0.075, 0.12, 10), PC.iron, { p: [0, 2.64, 0] });
  b.add('metal', rbox(0.42, 0.06, 0.42, 0.02), PC.iron, { p: [0, 2.72, 0] });
  b.add('glow', rbox(0.32, 0.4, 0.32, 0.05), PC.glass, { p: [0, 2.94, 0] });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.add('metal', rbox(0.055, 0.44, 0.055, 0.015), PC.iron, { p: [sx * 0.17, 2.94, sz * 0.17] });
  b.add('metal', rbox(0.48, 0.06, 0.48, 0.022), PC.iron, { p: [0, 3.16, 0] });
  b.add('metal', cone(0.31, 0.22, 4), PC.iron, { p: [0, 3.3, 0], r: [0, PI / 4, 0] });
  // cat ears on the lantern roof
  for (const s of [-1, 1]) b.add('metal', cone(0.075, 0.17, 4), PC.iron, { p: [s * 0.12, 3.33, 0], r: [0, PI / 4, -s * 0.45] });
  b.add('metal', sph(0.045, 8, 5), PC.gold, { p: [0, 3.43, 0] });
  return b.build();
}

/* ------------------------------------------------------------------ furniture */

function bench(): PropPart[] {
  const b = new PB();
  for (const z of [-0.17, 0.02, 0.21]) b.add('wood', rbox(1.42, 0.08, 0.17, 0.03), z === 0.02 ? PC.woodL : PC.wood, { p: [0, 0.46, z], swap: true });
  for (const y of [0.68, 0.88]) b.add('wood', rbox(1.42, 0.15, 0.06, 0.026), PC.wood, { p: [0, y, -0.29 - (y - 0.68) * 0.18], r: [-0.18, 0, 0], swap: true });
  for (const x of [-0.6, 0.6]) {
    b.add('metal', rbox(0.08, 0.44, 0.08, 0.02), PC.iron, { p: [x, 0.22, 0.22] });
    b.add('metal', rbox(0.08, 0.98, 0.08, 0.02), PC.iron, { p: [x, 0.49, -0.28], r: [-0.12, 0, 0] });
    b.add('metal', rbox(0.08, 0.06, 0.56, 0.022), PC.iron, { p: [x, 0.41, -0.02] });
    // armrest scroll
    b.add('metal', torus(0.09, 0.022, 4, 10, PI * 1.2), PC.iron, { p: [x + Math.sign(x) * 0.07, 0.6, 0.12], r: [0, PI / 2, PI * 0.15] });
    b.add('metal', rbox(0.07, 0.04, 0.42, 0.018), PC.iron, { p: [x + Math.sign(x) * 0.07, 0.69, -0.04] });
    b.add('metal', sph(0.04, 6, 4), PC.gold, { p: [x + Math.sign(x) * 0.07, 0.7, 0.18] });
  }
  return b.build();
}

function barrel(): PropPart[] {
  const b = new PB();
  b.add('wood', lathe([[0, 0.02], [0.27, 0.02], [0.3, 0.06], [0.345, 0.26], [0.36, 0.45], [0.345, 0.64], [0.3, 0.84], [0.27, 0.88], [0.25, 0.86], [0, 0.86]], 14), PC.wood, { uv: [3, 1] });
  for (const [y, r] of [[0.13, 0.318], [0.77, 0.318], [0.33, 0.352], [0.57, 0.352]] as [number, number][]) b.add('metal', torus(r, 0.022, 5, 22), PC.iron, { p: [0, y, 0], r: [PI / 2, 0, 0] });
  b.add('wood', cyl(0.07, 0.07, 0.02, 8), PC.woodD, { p: [0.1, 0.87, 0.05] });
  return b.build();
}

function crate(): PropPart[] {
  const b = new PB();
  b.add('wood', rbox(0.6, 0.6, 0.6, 0.03), PC.woodL, { p: [0, 0.3, 0], uv: 0.6 });
  for (const y of [0.045, 0.555]) b.add('wood', rbox(0.63, 0.08, 0.63, 0.02), PC.woodR, { p: [0, y, 0], uv: 0.6, swap: true });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.add('wood', rbox(0.08, 0.6, 0.08, 0.02), PC.woodR, { p: [sx * 0.28, 0.3, sz * 0.28] });
  for (const s of [-1, 1]) b.add('wood', rbox(0.07, 0.62, 0.025, 0.01), PC.woodR, { p: [0, 0.3, s * 0.31], r: [0, 0, s * PI / 4] });
  for (const s of [-1, 1]) b.add('wood', rbox(0.025, 0.62, 0.07, 0.01), PC.woodR, { p: [s * 0.31, 0.3, 0], r: [s * PI / 4, 0, 0] });
  return b.build();
}

function chest(): PropPart[] {
  const b = new PB();
  b.add('wood', rbox(0.72, 0.4, 0.46, 0.04), PC.woodR, { p: [0, 0.2, 0], swap: true });
  b.add('wood', cyl(0.23, 0.23, 0.72, 12, false, 0, PI), PC.woodR, { p: [0, 0.4, 0], r: [0, 0, PI / 2], uv: 0.7 });
  for (const x of [-0.26, 0.26]) {
    b.add('metal', rbox(0.045, 0.416, 0.475, 0.01), PC.gold, { p: [x, 0.2, 0] });
    b.add('metal', torus(0.232, 0.02, 4, 14, PI), PC.gold, { p: [x, 0.4, 0], r: [0, PI / 2, 0] });
  }
  b.add('metal', rbox(0.74, 0.04, 0.48, 0.015), PC.gold, { p: [0, 0.4, 0] });
  b.add('metal', rbox(0.16, 0.18, 0.05, 0.025), PC.gold, { p: [0, 0.38, 0.24] });
  b.add('metal', cyl(0.025, 0.025, 0.02, 8), PC.ironD, { p: [0, 0.385, 0.268], r: [PI / 2, 0, 0] });
  b.add('metal', box(0.02, 0.05, 0.02), PC.ironD, { p: [0, 0.355, 0.268] });
  return b.build();
}

function planter(): PropPart[] {
  const b = new PB();
  b.add('stone', lathe([[0, 0], [0.3, 0], [0.37, 0.3], [0.43, 0.33], [0.43, 0.41], [0.37, 0.41], [0.35, 0.37], [0, 0.37]], 16), PC.stoneR, { uv: [2, 0.5] });
  b.add('paint', cyl(0.36, 0.36, 0.03, 12), PC.soil, { p: [0, 0.37, 0] });
  const leaves: [number, number, number, number][] = [[0, 0.52, 0, 0.2], [0.2, 0.47, 0.06, 0.15], [-0.18, 0.46, 0.1, 0.15], [0.05, 0.45, -0.2, 0.16], [-0.12, 0.46, -0.14, 0.14], [0.12, 0.44, 0.2, 0.13]];
  leaves.forEach(([x, y, z, r], i) => b.add('paint', sph(r, 9, 6), i % 2 ? PC.leafD : PC.leaf, { p: [x, y, z], s: [1, 0.8, 1] }));
  flowers(b, [[0.02, 0.68, 0.05], [0.24, 0.6, 0.1], [-0.22, 0.6, 0.12], [0.08, 0.6, -0.26], [-0.16, 0.58, -0.16], [0.16, 0.56, 0.3], [-0.05, 0.6, 0.3]]);
  return b.build();
}

function flowers(b: PB, at: [number, number, number][]): void {
  const cs = [PC.pink, PC.yellow, '#ffffff', PC.lilac, PC.pink, '#ff6f7f'];
  at.forEach(([x, y, z], i) => {
    const c = cs[i % cs.length];
    for (let k = 0; k < 5; k++) {
      const a = (k / 5) * PI * 2 + i;
      b.add('paint', sph(0.045, 6, 4), c, { p: [x + Math.cos(a) * 0.05, y, z + Math.sin(a) * 0.05], s: [1, 0.55, 1] });
    }
    b.add('paint', sph(0.032, 6, 4), c === PC.yellow ? PC.orange : PC.yellow, { p: [x, y + 0.02, z] });
  });
}

/* ------------------------------------------------------------------ water & stone */

function fountain(): PropPart[] {
  const b = new PB();
  b.add('stone', lathe([[0, 0], [1.22, 0], [1.27, 0.08], [1.2, 0.13], [1.15, 0.5], [1.27, 0.55], [1.27, 0.64], [1.08, 0.64], [1.05, 0.3], [0, 0.3]], 28), PC.stone, { uv: [8, 1] });
  b.add('water', cyl(1.07, 1.07, 0.04, 28), PC.water, { p: [0, 0.48, 0], uv: 1.2 });
  b.add('stone', lathe([[0, 0.3], [0.26, 0.3], [0.26, 0.4], [0.17, 0.5], [0.12, 0.95], [0.2, 1.05], [0, 1.05]], 14), PC.stone, { uv: [3, 1] });
  b.add('stone', lathe([[0, 1.0], [0.16, 1.0], [0.52, 1.13], [0.58, 1.24], [0.5, 1.26], [0.47, 1.18], [0, 1.15]], 18), PC.stoneW, { uv: [4, 0.5] });
  b.add('water', cyl(0.48, 0.48, 0.03, 18), PC.water, { p: [0, 1.2, 0], uv: 1.2 });
  // little fish spout on top
  b.add('stone', lathe([[0, 1.15], [0.1, 1.15], [0.07, 1.3], [0, 1.3]], 10), PC.stoneW);
  b.add('stone', sph(0.12, 10, 7), PC.blue, { p: [0, 1.42, 0], s: [0.8, 1.1, 0.8] });
  b.add('stone', cone(0.09, 0.14, 6), PC.blue, { p: [0, 1.25, 0.0], r: [PI, 0, 0], s: [1.2, 1, 0.6] });
  for (const s of [-1, 1]) b.add('paint', sph(0.022, 5, 4), '#2b1d18', { p: [s * 0.065, 1.47, 0.06] });
  // water: falling sheet from the upper bowl + top jet
  b.add('waterFx', cyl(0.56, 0.8, 0.72, 20, true), PC.water, { p: [0, 0.86, 0] });
  b.add('waterFx', cone(0.06, 0.3, 8), PC.glassW, { p: [0, 1.66, 0] });
  b.add('waterFx', cyl(0.05, 0.4, 0.1, 12, true), PC.water, { p: [0, 1.55, 0], r: [PI, 0, 0] });
  return b.build();
}

function well(): PropPart[] {
  const b = new PB();
  b.add('stone', lathe([[0.44, 0.1], [0.44, 0.75], [0.67, 0.75], [0.67, 0.67], [0.62, 0.62], [0.62, 0], [0.44, 0]].reverse() as [number, number][], 18), PC.stone, { uv: [6, 1] });
  b.add('water', cyl(0.45, 0.45, 0.03, 16), PC.waterD, { p: [0, 0.45, 0] });
  // posts stand on the rim and the crank grip points along z: nothing at body height sticks out of the rim's walk
  // solid (test/world-collide.test.ts — you no longer walk through the posts / the crank)
  for (const s of [-1, 1]) b.add('wood', rbox(0.11, 1.75, 0.11, 0.02), PC.woodD, { p: [s * 0.58, 0.87, 0] });
  b.add('wood', cyl(0.045, 0.045, 1.3, 8), PC.wood, { p: [0, 1.32, 0], r: [0, 0, PI / 2] });
  b.add('wood', cyl(0.08, 0.08, 0.3, 8), PC.woodL, { p: [0, 1.32, 0], r: [0, 0, PI / 2] });
  b.add('metal', rbox(0.04, 0.22, 0.04, 0.01), PC.iron, { p: [0.68, 1.24, 0] });
  b.add('metal', rbox(0.04, 0.04, 0.18, 0.01), PC.iron, { p: [0.68, 1.14, 0.09] });
  b.add('paint', cyl(0.016, 0.016, 0.3, 5), PC.hayD, { p: [0, 1.15, 0] });
  b.add('wood', lathe([[0, 0.78], [0.12, 0.78], [0.15, 0.98], [0.13, 0.98], [0, 0.96]], 12), PC.woodR, { uv: [2, 0.5] });
  for (const y of [0.83, 0.95]) b.add('metal', torus(0.135 + (y - 0.83) * 0.12, 0.012, 4, 12), PC.iron, { p: [0, y, 0], r: [PI / 2, 0, 0] });
  b.add('metal', torus(0.13, 0.008, 3, 10, PI), PC.iron, { p: [0, 0.98, 0] });
  // roof: two tiled slopes + ridge
  for (const s of [-1, 1]) b.add('roof', rbox(1.85, 0.07, 0.78, 0.03), PC.roof, { p: [0, 1.88, s * 0.3], r: [s * 0.72, 0, 0], uv: 0.6 });
  b.add('wood', rbox(1.95, 0.09, 0.09, 0.03), PC.woodD, { p: [0, 2.13, 0] });
  for (const s of [-1, 1]) b.add('wood', rbox(0.08, 0.5, 0.08, 0.02), PC.woodD, { p: [s * 0.58, 1.95, 0] });
  // potted sprout on the ridge
  b.add('stone', cyl(0.07, 0.05, 0.1, 8), PC.stoneR, { p: [0.45, 2.22, 0] });
  b.add('paint', sph(0.05, 6, 4), PC.leaf, { p: [0.42, 2.31, 0], s: [1, 0.6, 0.5] });
  b.add('paint', sph(0.05, 6, 4), PC.leafL, { p: [0.49, 2.33, 0], s: [1, 0.6, 0.5] });
  return b.build();
}

function statue(): PropPart[] {
  const b = new PB();
  b.add('stone', rbox(1.1, 0.25, 1.1, 0.05), PC.stoneD, { p: [0, 0.125, 0] });
  b.add('stone', rbox(0.84, 0.75, 0.84, 0.06), PC.stone, { p: [0, 0.62, 0] });
  b.add('stone', rbox(1.0, 0.12, 1.0, 0.04), PC.stoneD, { p: [0, 1.04, 0] });
  b.add('metal', rbox(0.5, 0.16, 0.02, 0.02), PC.gold, { p: [0, 0.68, 0.425] });
  const M = PC.marble, y0 = 1.1;
  // legs / feet
  for (const s of [-1, 1]) b.add('stone', capsule(0.1, 0.18, 2, 8), M, { p: [s * 0.13, y0 + 0.17, 0.02] });
  for (const s of [-1, 1]) b.add('stone', sph(0.11, 7, 4), M, { p: [s * 0.14, y0 + 0.05, 0.08], s: [1, 0.6, 1.3] });
  // body + cape
  b.add('stone', capsule(0.24, 0.3, 3, 10), M, { p: [0, y0 + 0.62, 0], s: [1, 1, 0.85] });
  b.add('stone', cyl(0.22, 0.42, 0.75, 8, true, PI * 0.6, PI * 0.8), PC.marbleD, { p: [0, y0 + 0.5, -0.02] });
  // its inner side (an open shell: seen from behind/below the statue it was see-through)
  b.add('stone', flipped(cyl(0.205, 0.405, 0.75, 8, true, PI * 0.6, PI * 0.8)), PC.marbleD, { p: [0, y0 + 0.5, -0.02] });
  b.add('stone', torus(0.22, 0.04, 5, 14), PC.marbleD, { p: [0, y0 + 0.86, 0], r: [PI / 2, 0, 0], s: [1, 0.85, 1] });
  // head
  b.add('stone', sph(0.38, 14, 9), M, { p: [0, y0 + 1.25, 0], s: [1.1, 0.92, 1] });
  for (const s of [-1, 1]) {
    b.add('stone', cone(0.15, 0.27, 8), M, { p: [s * 0.24, y0 + 1.58, -0.02], r: [0, 0, -s * 0.38] });
    b.add('stone', cone(0.08, 0.15, 6), PC.marbleD, { p: [s * 0.235, y0 + 1.56, 0.04], r: [0, 0, -s * 0.38] });
    b.add('paint', sph(0.065, 8, 6), '#3a3050', { p: [s * 0.15, y0 + 1.29, 0.335], s: [0.8, 1.1, 0.6] });
    b.add('paint', sph(0.02, 5, 4), '#ffffff', { p: [s * 0.15 + 0.02, y0 + 1.32, 0.37] });
    // whiskers
    for (const k of [-1, 1]) b.add('paint', cyl(0.008, 0.008, 0.2, 3), '#3a3050', { p: [s * 0.2, y0 + 1.14 + k * 0.035, 0.34], r: [0, -s * 0.5, PI / 2 + s * k * 0.15] });
  }
  b.add('stone', sph(0.13, 10, 7), PC.marbleD, { p: [0, y0 + 1.13, 0.3], s: [1.3, 0.75, 0.75] });
  b.add('paint', sph(0.04, 6, 4), PC.pink, { p: [0, y0 + 1.18, 0.395], s: [1.3, 0.8, 0.8] });
  // raised sword arm (right) + shield arm (left)
  b.add('stone', capsule(0.07, 0.3, 3, 8), M, { p: [0.3, y0 + 0.95, 0.05], r: [0, 0, -0.6] });
  b.add('stone', sph(0.08, 8, 5), M, { p: [0.42, y0 + 1.12, 0.05] });
  b.add('metal', rbox(0.07, 0.8, 0.025, 0.012), PC.gold, { p: [0.48, y0 + 1.55, 0.05], r: [0, 0, -0.18] });
  b.add('metal', rbox(0.26, 0.05, 0.06, 0.02), PC.gold, { p: [0.43, y0 + 1.15, 0.05], r: [0, 0, -0.18] });
  b.add('stone', capsule(0.07, 0.25, 3, 8), M, { p: [-0.3, y0 + 0.65, 0.08], r: [0.3, 0, 0.4] });
  b.add('stone', cyl(0.2, 0.2, 0.05, 14), PC.marbleD, { p: [-0.36, y0 + 0.6, 0.18], r: [PI / 2 - 0.2, 0, 0.3] });
  b.add('metal', sph(0.06, 8, 5), PC.gold, { p: [-0.37, y0 + 0.6, 0.21] });
  // tail curling up behind
  b.add('stone', torus(0.22, 0.05, 5, 10, PI * 1.2), M, { p: [0.05, y0 + 0.45, -0.3], r: [0, PI / 2, PI * 0.1] });
  return b.build();
}

/* ------------------------------------------------------------------ forge / training */

function anvil(): PropPart[] {
  const b = new PB();
  b.add('wood', cyl(0.28, 0.31, 0.45, 12), PC.woodD, { p: [0, 0.225, 0], uv: 0.45 });
  b.add('wood', cyl(0.27, 0.27, 0.02, 12), PC.woodL, { p: [0, 0.455, 0] });
  const s = new THREE.Shape();
  s.moveTo(-0.2, 0); s.lineTo(0.22, 0); s.lineTo(0.16, 0.07); s.lineTo(0.09, 0.1); s.lineTo(0.09, 0.2);
  s.lineTo(0.3, 0.22); s.lineTo(0.3, 0.33); s.lineTo(-0.18, 0.33);
  s.quadraticCurveTo(-0.4, 0.32, -0.5, 0.27); s.quadraticCurveTo(-0.32, 0.22, -0.11, 0.2);
  s.lineTo(-0.11, 0.1); s.lineTo(-0.16, 0.07); s.closePath();
  b.add('metal', slab(s, 0.2, 0.012), PC.iron, { p: [0, 0.46, 0], uv: 0.4 });
  // hammer resting on top
  b.add('wood', cyl(0.018, 0.018, 0.38, 6), PC.wood, { p: [0.02, 0.81, 0.07], r: [0, 0.4, PI / 2] });
  b.add('metal', rbox(0.08, 0.08, 0.15, 0.015), PC.ironL, { p: [0.19, 0.83, 0.0], r: [0, 0.4, 0] });
  return b.build();
}

function dummy(): PropPart[] {
  const b = new PB();
  b.add('wood', rbox(0.7, 0.08, 0.12, 0.02), PC.woodD, { p: [0, 0.04, 0] });
  b.add('wood', rbox(0.12, 0.08, 0.7, 0.02), PC.woodD, { p: [0, 0.04, 0] });
  b.add('wood', cyl(0.05, 0.06, 1.0, 8), PC.wood, { p: [0, 0.55, 0] });
  b.add('cloth', capsule(0.22, 0.32, 4, 10), PC.burlap, { p: [0, 1.08, 0], s: [1, 1, 0.85] });
  b.add('wood', cyl(0.09, 0.11, 0.08, 10), PC.woodD, { p: [0, 0.76, 0] });
  b.add('wood', cyl(0.04, 0.04, 0.95, 6), PC.wood, { p: [0, 1.22, 0], r: [0, 0, PI / 2] });
  for (const s of [-1, 1]) b.add('cloth', sph(0.08, 7, 5), PC.burlap, { p: [s * 0.48, 1.22, 0] });
  for (const y of [0.9, 1.3]) b.add('paint', torus(0.205, 0.018, 4, 14), PC.hayD, { p: [0, y, 0], r: [PI / 2, 0, 0], s: [1, 0.85, 1] });
  b.add('cloth', sph(0.18, 10, 7), PC.burlap, { p: [0, 1.62, 0] });
  b.add('paint', torus(0.08, 0.014, 4, 10), PC.hayD, { p: [0, 1.5, 0], r: [PI / 2, 0, 0] });
  for (const s of [-1, 1]) b.add('cloth', cone(0.07, 0.13, 5), PC.burlap, { p: [s * 0.11, 1.78, 0], r: [0, 0, -s * 0.45] });
  b.add('paint', torus(0.035, 0.008, 3, 8, PI), '#2b1d18', { p: [0, 1.58, 0.17], r: [0, 0, PI] });
  for (let i = 0; i < 5; i++) b.add('paint', cone(0.03, 0.14, 4), PC.hay, { p: [Math.cos(i * 1.3) * 0.06, 1.81, Math.sin(i * 1.3) * 0.06], r: [Math.sin(i) * 0.5, 0, Math.cos(i) * 0.5] });
  // target painted on the chest
  // (rings ≥ 1 cm proud of each other: their fronts never share a depth-buffer plane — no flicker at a distance)
  b.add('paint', cyl(0.13, 0.13, 0.02, 14), PC.cream, { p: [0, 1.1, 0.195], r: [PI / 2, 0, 0] });
  b.add('paint', cyl(0.09, 0.09, 0.025, 14), PC.red, { p: [0, 1.1, 0.207], r: [PI / 2, 0, 0] });
  b.add('paint', cyl(0.04, 0.04, 0.03, 10), PC.cream, { p: [0, 1.1, 0.219], r: [PI / 2, 0, 0] });
  // button eyes
  for (const s of [-1, 1]) b.add('paint', sph(0.025, 6, 4), '#2b1d18', { p: [s * 0.06, 1.65, 0.16] });
  return b.build();
}

function noticeBoard(): PropPart[] {
  const b = new PB();
  for (const s of [-1, 1]) b.add('wood', rbox(0.09, 1.75, 0.09, 0.02), PC.woodD, { p: [s * 0.66, 0.875, 0] });
  b.add('wood', rbox(1.3, 0.9, 0.06, 0.03), PC.wood, { p: [0, 1.12, 0], uv: 0.8 });
  b.add('wood', rbox(1.4, 0.07, 0.09, 0.02), PC.woodD, { p: [0, 1.6, 0] });
  b.add('wood', rbox(1.4, 0.07, 0.09, 0.02), PC.woodD, { p: [0, 0.64, 0] });
  for (const s of [-1, 1]) b.add('roof', rbox(1.6, 0.04, 0.3, 0.015), PC.roof, { p: [0, 1.75, s * 0.1], r: [s * 0.55, 0, 0], uv: 0.5 });
  const papers: [number, number, number, number, number, string][] = [
    [-0.4, 1.3, 0.26, 0.32, 0.08, PC.cream], [-0.08, 1.22, 0.28, 0.36, -0.05, '#fff6e2'], [0.3, 1.3, 0.34, 0.26, 0.04, '#e9d2a8'],
    [-0.38, 0.92, 0.24, 0.26, -0.1, '#fff6e2'], [0.08, 0.9, 0.22, 0.24, 0.12, PC.cream], [0.4, 0.94, 0.22, 0.3, -0.04, '#ffd6e0'],
  ];
  for (const [x, y, w, h, rz, c] of papers) {
    b.add('paint', box(w, h, 0.006), c, { p: [x, y, 0.034], r: [0, 0, rz] });
    for (let l = 0; l < 3; l++) b.add('paint', box(w * 0.6, 0.012, 0.004), '#8a7060', { p: [x - Math.sin(rz) * (0.06 - l * 0.05), y + 0.06 - l * 0.05, 0.039], r: [0, 0, rz] });
    b.add('paint', sph(0.016, 5, 3), PC.red, { p: [x - Math.sin(rz) * h * 0.42, y + h * 0.42, 0.04] });
  }
  return b.build();
}

/* ------------------------------------------------------------------ market */

function stall(o: KindOpts): PropPart[] {
  const v = o.variant ?? 0;
  const [cA, cB] = [col(o, 0, AWNINGS[v % AWNINGS.length][0]), col(o, 1, AWNINGS[v % AWNINGS.length][1])];
  const b = new PB();
  // counter
  b.add('wood', rbox(2.2, 0.82, 0.62, 0.04), PC.wood, { p: [0, 0.41, 0.32] });
  b.add('wood', rbox(2.36, 0.07, 0.8, 0.03), PC.woodL, { p: [0, 0.855, 0.32], swap: true });
  b.add('paint', rbox(1.0, 0.3, 0.03, 0.03), cA, { p: [0, 0.5, 0.64] });
  b.add('paint', rbox(0.8, 0.06, 0.035, 0.02), cB, { p: [0, 0.5, 0.645] });
  // posts
  for (const s of [-1, 1]) {
    b.add('wood', rbox(0.1, 2.1, 0.1, 0.025), PC.woodD, { p: [s * 1.12, 1.05, 0.66] });
    b.add('wood', rbox(0.1, 2.45, 0.1, 0.025), PC.woodD, { p: [s * 1.12, 1.225, -0.62] });
  }
  // back wall with shelf and jars
  b.add('wood', rbox(2.2, 1.0, 0.05, 0.02), PC.woodR, { p: [0, 1.32, -0.64] });
  b.add('wood', rbox(2.2, 0.82, 0.05, 0.02), PC.woodD, { p: [0, 0.41, -0.64] });
  b.add('wood', rbox(2.1, 0.05, 0.28, 0.02), PC.woodL, { p: [0, 1.45, -0.5] });
  const jarC = [PC.pink, PC.teal, PC.yellow, PC.lilac, PC.orange, PC.blue];
  for (let i = 0; i < 7; i++) {
    const x = -0.9 + i * 0.3, h = 0.16 + (i % 3) * 0.04;
    b.add('paint', cyl(0.07, 0.07, h, 8), jarC[i % jarC.length], { p: [x, 1.475 + h / 2, -0.5] });
    b.add('wood', cyl(0.05, 0.05, 0.04, 8), PC.woodD, { p: [x, 1.475 + h + 0.02, -0.5] });
  }
  // awning: striped slope (front lower), scalloped valance
  const n = 8, W = 2.5, sw = W / n, ang = 0.24, len = 1.62;
  for (let i = 0; i < n; i++) {
    const x = -W / 2 + sw * (i + 0.5);
    b.add('cloth', box(sw + 0.002, 0.035, len), i % 2 ? cB : cA, { p: [x, 2.24, 0.04], r: [ang, 0, 0], uv: 'keep' });
    b.add('cloth', cyl(sw / 2, sw / 2, 0.03, 8, false, -PI / 2, PI), i % 2 ? cA : cB, { p: [x, 2.05, 0.83], r: [PI / 2 - ang * 0, 0, 0], uv: 'keep' });
  }
  b.add('wood', cyl(0.04, 0.04, 2.6, 8), PC.woodD, { p: [0, 2.05, 0.82], r: [0, 0, PI / 2] });
  // hanging lantern
  b.add('paint', cyl(0.006, 0.006, 0.2, 4), PC.ironD, { p: [0, 1.95, 0.75] });
  b.add('glow', sph(0.1, 10, 7), PC.glass, { p: [0, 1.78, 0.75], s: [1, 1.2, 1] });
  b.add('metal', cyl(0.05, 0.08, 0.05, 8), PC.iron, { p: [0, 1.9, 0.75] });
  // goods on the counter
  const goods = v % 3;
  if (goods === 0) {          // fruit crates
    for (const x of [-0.7, 0.05]) {
      b.add('wood', rbox(0.55, 0.16, 0.42, 0.02), PC.woodR, { p: [x, 0.97, 0.32] });
      for (let i = 0; i < 6; i++) b.add('paint', sph(0.075, 8, 5), x < 0 ? PC.red : PC.orange, { p: [x - 0.17 + (i % 3) * 0.17, 1.09, 0.22 + Math.floor(i / 3) * 0.18] });
    }
    for (let i = 0; i < 3; i++) b.add('paint', sph(0.13, 10, 6), PC.orange, { p: [0.62 + (i % 2) * 0.24, 1.0 + (i === 2 ? 0.18 : 0), 0.3 - (i === 2 ? 0 : 0.05)], s: [1.15, 0.85, 1.15] });
  } else if (goods === 1) {   // fish
    for (let i = 0; i < 5; i++) {
      const x = -0.85 + i * 0.4;
      b.add('paint', sph(0.08, 8, 5), i % 2 ? PC.blue : PC.pink, { p: [x, 0.95, 0.3], s: [2.0, 0.7, 0.9] });
      b.add('paint', cone(0.07, 0.1, 4), i % 2 ? PC.blue : PC.pink, { p: [x + 0.2, 0.95, 0.3], r: [0, 0, PI / 2], s: [1, 1, 0.3] });
    }
    b.add('wood', cyl(0.18, 0.15, 0.14, 12), PC.woodR, { p: [0.75, 0.96, 0.4] });
  } else {                    // potions & sacks
    for (let i = 0; i < 6; i++) {
      const x = -0.9 + i * 0.32;
      b.add('paint', sph(0.08, 8, 6), jarC[(i + 2) % jarC.length], { p: [x, 0.97, 0.36] });
      b.add('paint', cyl(0.025, 0.03, 0.08, 6), PC.cream, { p: [x, 1.07, 0.36] });
    }
    b.add('cloth', sph(0.2, 9, 6), PC.burlap, { p: [0.9, 1.05, 0.25], s: [1, 1.1, 1] });
  }
  return b.build();
}

function cart(): PropPart[] {
  const b = new PB();
  b.add('wood', rbox(1.4, 0.12, 0.84, 0.03), PC.woodD, { p: [0, 0.52, 0] });
  for (const s of [-1, 1]) b.add('wood', rbox(1.4, 0.3, 0.06, 0.02), PC.wood, { p: [0, 0.72, s * 0.42], swap: true });
  for (const s of [-1, 1]) b.add('wood', rbox(0.06, 0.3, 0.84, 0.02), PC.wood, { p: [s * 0.69, 0.72, 0] });
  for (const s of [-1, 1]) {
    // wheel
    b.add('wood', torus(0.34, 0.045, 5, 16), PC.woodD, { p: [0.1, 0.38, s * 0.52] });
    for (let k = 0; k < 3; k++) b.add('wood', box(0.035, 0.66, 0.03), PC.wood, { p: [0.1, 0.38, s * 0.52], r: [0, 0, (k * PI) / 3] });
    b.add('metal', cyl(0.07, 0.07, 0.1, 8), PC.iron, { p: [0.1, 0.38, s * 0.52], r: [PI / 2, 0, 0] });
    // handles
    b.add('wood', cyl(0.03, 0.03, 0.9, 6), PC.woodD, { p: [-1.05, 0.48, s * 0.32], r: [0, 0, PI / 2 - 0.12] });
  }
  b.add('wood', cyl(0.025, 0.025, 0.66, 6), PC.woodD, { p: [-1.45, 0.43, 0], r: [PI / 2, 0, 0] });
  b.add('wood', rbox(0.06, 0.48, 0.06, 0.015), PC.woodD, { p: [-0.6, 0.24, 0] });
  // hay pile
  const hay: [number, number, number, number][] = [[-0.3, 0.82, 0, 0.36], [0.25, 0.84, 0.05, 0.38], [0, 1.02, -0.05, 0.32], [0.45, 0.8, -0.15, 0.25], [-0.5, 0.78, 0.15, 0.24]];
  hay.forEach(([x, y, z, r], i) => b.add('paint', sph(r, 10, 6), i % 2 ? PC.hayD : PC.hay, { p: [x, y, z], s: [1.15, 0.7, 1] }));
  for (let i = 0; i < 8; i++) b.add('paint', cyl(0.008, 0.008, 0.3, 3), PC.hay, { p: [-0.5 + i * 0.14, 1.0 + (i % 3) * 0.06, (i % 2 ? 0.2 : -0.2)], r: [i * 0.7, 0, 1.2 + i * 0.3] });
  return b.build();
}

function banner(o: KindOpts): PropPart[] {
  const cA = col(o, 0, PC.plum), cB = col(o, 1, PC.yellow);
  const b = new PB();
  b.add('metal', lathe([[0, 0], [0.12, 0], [0.12, 0.06], [0.06, 0.12], [0, 0.12]], 10), PC.iron);
  b.add('metal', cyl(0.05, 0.06, 3.1, 8), PC.iron, { p: [0, 1.6, 0] });
  b.add('metal', sph(0.07, 8, 6), PC.gold, { p: [0, 3.2, 0] });
  b.add('metal', cyl(0.028, 0.028, 1.0, 6), PC.iron, { p: [0.5, 2.92, 0], r: [0, 0, PI / 2] });
  b.add('metal', sph(0.045, 6, 4), PC.gold, { p: [1.0, 2.92, 0] });
  // swallow-tail banner
  const W = 0.8, H = 1.3, s = new THREE.Shape();
  s.moveTo(-W / 2, 0); s.lineTo(W / 2, 0); s.lineTo(W / 2, -H); s.lineTo(0, -H + 0.2); s.lineTo(-W / 2, -H); s.closePath();
  const g = slab(s, 0.02);
  const pos = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) pos.setZ(i, pos.getZ(i) + Math.sin(pos.getY(i) * 3.2) * 0.035 * (-pos.getY(i)));
  g.computeVertexNormals();
  b.add('cloth', g, cA, { p: [0.52, 2.88, 0], uv: 0.6 });
  // trim + paw emblem (both faces)
  for (const z of [-1, 1]) {
    const zz = z * 0.016;
    const wave = (y: number) => Math.sin(y * 3.2) * 0.035 * (-y);
    b.add('paint', box(W - 0.06, 0.05, 0.01), cB, { p: [0.52, 2.88 - 0.12, zz + wave(-0.12)] });
    b.add('paint', cyl(0.11, 0.11, 0.012, 12), cB, { p: [0.52, 2.88 - 0.62, zz + wave(-0.62) * 1.0], r: [PI / 2, 0, 0], s: [1, 1, 0.85] });
    for (const [dx, dy] of [[-0.13, 0.12], [-0.05, 0.19], [0.05, 0.19], [0.13, 0.12]]) {
      b.add('paint', cyl(0.042, 0.042, 0.012, 8), cB, { p: [0.52 + dx, 2.88 - 0.62 + dy, zz + wave(-0.62 + dy)], r: [PI / 2, 0, 0] });
    }
  }
  return b.build();
}

/* ------------------------------------------------------------------ nature */

function tree(o: KindOpts): PropPart[] {
  const v = o.variant ?? 0;
  const b = new PB();
  b.add('wood', lathe([[0, 0], [0.34, 0], [0.24, 0.1], [0.18, 0.4], [0.16, 1.0], [0.2, 1.5], [0, 1.6]], 10), PC.woodD, { uv: [2, 2] });
  b.add('wood', cyl(0.05, 0.07, 0.6, 6), PC.woodD, { p: [0.2, 1.35, 0.05], r: [0, 0, -0.8] });
  const lc = v % 2 ? [PC.leafD, '#4a8c44', PC.leaf] : [PC.leaf, PC.leafD, PC.leafL];
  const blobs: [number, number, number, number][] = [[0, 2.15, 0, 0.85], [0.55, 1.85, 0.2, 0.55], [-0.5, 1.9, 0.15, 0.58], [0.1, 1.85, -0.5, 0.58], [0.05, 2.75, 0.05, 0.55], [-0.15, 1.8, 0.5, 0.5]];
  blobs.forEach(([x, y, z, r], i) => b.add('paint', sph(r, 12, 8), lc[i % 3], { p: [x, y, z] }));
  if (v % 3 === 2) for (let i = 0; i < 9; i++) {
    const a = i * 2.4, y = 1.9 + (i % 3) * 0.3, r = 0.82 - Math.abs(y - 2.15) * 0.3;
    b.add('paint', sph(0.06, 6, 4), PC.pink, { p: [Math.cos(a) * r, y, Math.sin(a) * r] });
  }
  return b.build();
}

function bush(): PropPart[] {
  const b = new PB();
  const blobs: [number, number, number, number][] = [[0, 0.32, 0, 0.42], [0.38, 0.24, 0.05, 0.3], [-0.36, 0.25, 0.08, 0.32], [0.05, 0.22, 0.3, 0.28]];
  blobs.forEach(([x, y, z, r], i) => b.add('paint', sph(r, 10, 7), i % 2 ? PC.leafD : PC.leaf, { p: [x, y, z], s: [1, 0.85, 1] }));
  flowers(b, [[0.1, 0.65, 0.18], [-0.32, 0.47, 0.22], [0.4, 0.44, 0.16], [-0.12, 0.6, -0.22]]);
  return b.build();
}

/* ------------------------------------------------------------------ structure */

/** Iron railing segment, 2 m along X (like the site's canal railing). */
function fence(): PropPart[] {
  const b = new PB();
  for (const s of [-1, 1]) {
    b.add('metal', rbox(0.08, 0.95, 0.08, 0.015), PC.iron, { p: [s * 1, 0.475, 0] });
    b.add('metal', sph(0.06, 8, 5), PC.ironL, { p: [s * 1, 1.0, 0] });
  }
  b.add('metal', rbox(2, 0.05, 0.06, 0.015), PC.iron, { p: [0, 0.88, 0] });
  b.add('metal', rbox(2, 0.04, 0.05, 0.012), PC.iron, { p: [0, 0.15, 0] });
  for (let i = 1; i < 10; i++) {
    const x = -1 + i * 0.2;
    b.add('metal', cyl(0.014, 0.014, 0.73, 5), PC.iron, { p: [x, 0.515, 0] });
    b.add('metal', sph(0.026, 6, 4), PC.ironL, { p: [x, 0.5, 0] });
  }
  return b.build();
}

/** Wooden picket fence segment, 2 m along X. */
function fenceWood(): PropPart[] {
  const b = new PB();
  for (const s of [-1, 1]) b.add('wood', rbox(0.1, 0.9, 0.1, 0.02), PC.woodD, { p: [s * 1, 0.45, 0] });
  for (const y of [0.25, 0.6]) b.add('wood', rbox(2, 0.07, 0.04, 0.015), PC.woodD, { p: [0, y, -0.04], swap: true });
  for (let i = 0; i < 9; i++) {
    const x = -0.88 + i * 0.22;
    b.add('wood', rbox(0.12, 0.7, 0.03, 0.012), PC.woodL, { p: [x, 0.4, 0] });
    b.add('wood', cone(0.085, 0.1, 4), PC.woodL, { p: [x, 0.8, 0], r: [0, PI / 4, 0], s: [1, 1, 0.25] });
  }
  return b.build();
}

function signpost(): PropPart[] {
  const b = new PB();
  b.add('stone', cyl(0.18, 0.22, 0.14, 10), PC.stoneD, { p: [0, 0.07, 0] });
  b.add('wood', rbox(0.11, 2.08, 0.11, 0.025), PC.woodD, { p: [0, 1.06, 0] });
  for (const s of [-1, 1]) b.add('wood', cone(0.05, 0.12, 4), PC.woodD, { p: [s * 0.035, 2.14, 0], r: [0, PI / 4, -s * 0.4] });
  const arrow = (w: number) => {
    const sh = new THREE.Shape(), h = 0.2;
    sh.moveTo(0, -h / 2); sh.lineTo(w - 0.12, -h / 2); sh.lineTo(w, 0); sh.lineTo(w - 0.12, h / 2); sh.lineTo(0, h / 2); sh.closePath();
    return slab(sh, 0.045, 0.012);
  };
  // the lowest board clears a chibi's head (≥ 1.3 m): nothing sticks out of the post's walk solid at body height
  const boards: [number, number, string, number][] = [[1.9, 0.0, PC.woodL, 0.72], [1.64, PI * 0.85, PC.wood, 0.64], [1.4, -0.6, PC.woodL, 0.6]];
  for (const [y, ry, c, w] of boards) {
    b.add('wood', arrow(w), c, { p: [0, y, 0], r: [0, ry, 0], uv: 0.5 });
    // paw dot on each board
    const cx = Math.cos(ry), cz = -Math.sin(ry);
    b.add('paint', cyl(0.045, 0.045, 0.08, 10), PC.plum, { p: [cx * (w * 0.42), y, cz * (w * 0.42)], r: [PI / 2, ry, 0] });
    for (let i = 0; i < 4; i++) {
      const a = (i - 1.5) * 0.5, d = w * 0.42 + Math.sin(a) * 0.055;
      b.add('paint', cyl(0.016, 0.016, 0.082, 6), PC.plum, { p: [cx * d - (-Math.sin(ry)) * 0 , y + Math.cos(a) * 0.06 + 0.005, cz * d], r: [PI / 2, ry, 0] });
    }
    b.add('metal', cyl(0.018, 0.018, 0.092, 6), PC.ironD, { p: [cx * 0.1, y, cz * 0.1], r: [PI / 2, ry, 0] });
  }
  return b.build();
}

/** Stairs going down along +Z from y=0 to y=-height; width along X. */
export function stairsParts(width = 1.6, height = 0.8, depth = 1.6): PropPart[] {
  const b = new PB();
  const n = Math.max(2, Math.round(height / 0.16)), sh = height / n, sd = depth / n;
  for (let i = 0; i < n; i++) {
    const top = -i * sh, z = sd * (i + 0.5);
    b.add('stone', rbox(width, height - i * sh + 0.02, sd + 0.02, 0.025), i % 2 ? PC.stone : PC.stoneW, { p: [0, top - (height - i * sh) / 2 - 0.01 + 0.0, z] });
  }
  // cheek walls
  for (const s of [-1, 1]) {
    const sh2 = new THREE.Shape();
    sh2.moveTo(0, 0.12); sh2.lineTo(depth, -height + 0.12); sh2.lineTo(depth, -height); sh2.lineTo(0, -height); sh2.closePath();
    b.add('stone', slab(sh2, 0.16, 0.02), PC.stoneD, { p: [s * (width / 2 + 0.08), 0, 0], r: [0, -PI / 2, 0] });
  }
  return b.build();
}

/** Arched bridge spanning along Z (length), width along X, deck ends at y=0 and the hump top at y=hump. */
export function bridgeParts(length = 4, width = 2, hump = BRIDGE_HUMP): PropPart[] {
  const b = new PB();
  const L = length, yAt = (z: number) => hump * Math.cos((PI * z) / L);
  // planks
  const n = Math.max(6, Math.round(L / 0.22));
  for (let i = 0; i < n; i++) {
    const z = -L / 2 + (L / n) * (i + 0.5), slope = -hump * (PI / L) * Math.sin((PI * z) / L);
    b.add('wood', rbox(width, 0.07, L / n - 0.015, 0.012), i % 3 === 1 ? PC.woodL : PC.wood, { p: [0, yAt(z) - 0.035, z], r: [-Math.atan(slope), 0, 0], swap: true });
  }
  // stone side arches
  for (const s of [-1, 1]) {
    const sh = new THREE.Shape(), ext = 0.3, bot = -1.1, a = L / 2 - 0.35, bb = hump - 0.3 - bot;
    sh.moveTo(-L / 2 - ext, bot); sh.lineTo(-L / 2 - ext, 0);
    for (let i = 0; i <= 16; i++) { const z = -L / 2 + (L * i) / 16; sh.lineTo(z, yAt(z) - 0.04); }
    sh.lineTo(L / 2 + ext, 0); sh.lineTo(L / 2 + ext, bot);
    for (let i = 0; i <= 14; i++) { const t = (i / 14) * PI; sh.lineTo(a * Math.cos(t), bot + bb * Math.sin(t)); }
    sh.closePath();
    b.add('stone', slab(sh, 0.24, 0.02), PC.stone, { p: [s * (width / 2 + 0.1), 0, 0], r: [0, -PI / 2, 0], uv: 0.8 });
    // railing: posts + curved rail
    const posts = Math.max(3, Math.round(L / 0.8) + 1);
    for (let i = 0; i < posts; i++) {
      const z = -L / 2 + (L * i) / (posts - 1), y = yAt(z);
      const end = i === 0 || i === posts - 1;
      b.add('stone', rbox(end ? 0.26 : 0.16, end ? 0.85 : 0.72, end ? 0.26 : 0.16, 0.04), PC.stoneW, { p: [s * (width / 2 + 0.1), y + (end ? 0.425 : 0.36), z] });
      if (end) b.add('stone', sph(0.12, 8, 6), PC.stoneW, { p: [s * (width / 2 + 0.1), y + 0.92, z] });
    }
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= 12; i++) { const z = -L / 2 + (L * i) / 12; pts.push(new THREE.Vector3(s * (width / 2 + 0.1), yAt(z) + 0.7, z)); }
    b.add('wood', new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 16, 0.045, 5, false), PC.woodD);
    for (let i = 1; i < 2 * (posts - 1); i++) {
      if (i % 2 === 0) continue;
      const z = -L / 2 + (L * i) / (2 * (posts - 1));
      b.add('wood', cyl(0.025, 0.025, 0.6, 5), PC.woodD, { p: [s * (width / 2 + 0.1), yAt(z) + 0.4, z] });
    }
  }
  return b.build();
}

/* ------------------------------------------------------------------ registry */

export const BUILDERS = {
  lamp: () => lamp(),
  bench: () => bench(),
  barrel: () => barrel(),
  crate: () => crate(),
  chest: () => chest(),
  planter: () => planter(),
  fountain: () => fountain(),
  well: () => well(),
  statue: () => statue(),
  anvil: () => anvil(),
  dummy: () => dummy(),
  noticeBoard: () => noticeBoard(),
  stall: (o: KindOpts) => stall(o),
  cart: () => cart(),
  banner: (o: KindOpts) => banner(o),
  tree: (o: KindOpts) => tree(o),
  bush: () => bush(),
  fence: () => fence(),
  fenceWood: () => fenceWood(),
  signpost: () => signpost(),
  stairs: () => stairsParts(),
  bridge: () => bridgeParts(),
} satisfies Record<string, (o: KindOpts) => PropPart[]>;

export type PropKind = keyof typeof BUILDERS;
export const PROP_KINDS = Object.keys(BUILDERS) as PropKind[];
