/**
 * Expedition art for the event / puzzle sets added on 28.10: the talking stone (riddle), meadow critters and burrows
 * (count), the picnic cloth trinkets (changed), the letter block (letter), the Изнанка events (trick door + jack-o'-
 * lantern + candy bowl, Jack's fortune tent with a crystal ball and cards, the witch's cauldron, the lost ghost and its
 * graves, the dancing skeletons) and the goblin fair (goblin, stall, shell cups, the big coin, playing cards).
 *
 * Same conventions as art.ts (front = −Z at rotation 0, feet at y = 0, vertex colours, `aTint` = 1 where the instance
 * colour tints) but its own cache: `disposeEventArt()` releases it (the scene calls it next to disposeArt()).
 * Kept apart from art.ts on purpose (other work edits art.ts / foes.ts).
 */
import * as THREE from 'three';
import { GB, T } from './art';

const sph = (r: number, w = 12, h = 9) => new THREE.SphereGeometry(r, w, h);
const cyl = (rt: number, rb: number, h: number, s = 10) => new THREE.CylinderGeometry(rt, rb, h, s);
const cone = (r: number, h: number, s = 8) => new THREE.ConeGeometry(r, h, s);
const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);
const tor = (r: number, t: number, arc = Math.PI * 2, rs = 6, ts = 16) => new THREE.TorusGeometry(r, t, rs, ts, arc);
const dod = (r: number) => new THREE.DodecahedronGeometry(r, 0);

const cache = new Map<string, THREE.BufferGeometry>();
function cached(key: string, make: () => THREE.BufferGeometry): THREE.BufferGeometry {
  let g = cache.get(key);
  if (!g) { g = make(); g.name = 'expev:' + key; cache.set(key, g); }
  return g;
}
export function disposeEventArt(): void { for (const g of cache.values()) g.dispose(); cache.clear(); }
export const eventArtCacheSize = (): number => cache.size;

type V3 = [number, number, number];
const _up = new THREE.Vector3(0, 1, 0), _d = new THREE.Vector3();
/** Tapered rod from a to c. */
function seg(b: GB, a: V3, c: V3, r0: number, r1: number, col: string, s = 6, tint = 0): void {
  _d.set(c[0] - a[0], c[1] - a[1], c[2] - a[2]);
  const L = _d.length(); if (L < 1e-5) return;
  _d.multiplyScalar(1 / L);
  const q = new THREE.Quaternion().setFromUnitVectors(_up, _d);
  b.add(cyl(r1, r0, L, s), col, new THREE.Matrix4().compose(new THREE.Vector3((a[0] + c[0]) / 2, (a[1] + c[1]) / 2, (a[2] + c[2]) / 2), q, new THREE.Vector3(1, 1, 1)), tint);
}
/** Cute face on a sphere-ish head facing −Z at (0, y, z): eyes with highlights, blush, optional smile. */
function face(b: GB, y: number, z: number, sx: number, eye = '#231a2c', r = 0.06): void {
  for (const s of [-1, 1]) {
    b.add(sph(r, 7, 5), eye, T(s * sx, y, z, 0, 0, 0, [1, 1.2, 0.6]));
    b.add(sph(r * 0.35, 4, 3), '#ffffff', T(s * sx - r * 0.25, y + r * 0.4, z - r * 0.5));
  }
}

/* ================================================================== map puzzles */

/** «Загадка старого камня»: a mossy boulder with a sleepy old face (brows, nose); the mouth is `stoneMouthGeo`. */
export function talkingStoneGeo(): THREE.BufferGeometry {
  return cached('stone', () => {
    const b = new GB();
    const ST = '#8e889c', STD = '#6e687e', MOSS = '#6aa04a', MOSSL = '#8ac05a';
    b.add(dod(1.2), ST, T(0, 1.15, 0, 0.2, 0.4, 0, [1.05, 1.0, 0.85]));
    b.add(dod(0.75), STD, T(0.75, 0.55, 0.2, 0.5, 0.1, 0.3, [1, 0.8, 1]));
    b.add(dod(0.6), STD, T(-0.8, 0.45, 0.1, 0.1, 0.7, 0, [1, 0.8, 1]));
    for (let i = 0; i < 5; i++) { const a = i * 1.3; b.add(sph(0.45 - i * 0.05, 7, 5), i % 2 ? MOSS : MOSSL, T(Math.cos(a) * 0.55, 2.05 - (i % 3) * 0.12, Math.sin(a) * 0.4 + 0.1, 0, 0, 0, [1, 0.4, 1])); }
    // face toward −Z: closed-ish wise eyes (white ovals + dark pupils), heavy brows, nose, beard of moss
    for (const s of [-1, 1]) {
      b.add(sph(0.2, 9, 7), '#f4f0e6', T(s * 0.36, 1.42, -0.95, 0, 0, 0, [1, 0.8, 0.5]));
      b.add(sph(0.1, 7, 5), '#231a2c', T(s * 0.34, 1.4, -1.04, 0, 0, 0, [1, 1, 0.5]));
      b.add(sph(0.035, 4, 3), '#ffffff', T(s * 0.31, 1.44, -1.09));
      b.add(box(0.42, 0.12, 0.16), STD, T(s * 0.36, 1.66, -0.95, 0, 0, -s * 0.22));
    }
    b.add(dod(0.17), STD, T(0, 1.18, -1.04, 0, 0, 0, [1, 1.2, 1]));
    for (let i = 0; i < 5; i++) b.add(cone(0.12, 0.45, 5), i % 2 ? MOSS : MOSSL, T(-0.36 + i * 0.18, 0.55, -0.92 + Math.abs(i - 2) * 0.05, Math.PI + 0.15, 0, 0));
    for (let i = 0; i < 7; i++) { const a = i * 0.9; b.add(cone(0.06, 0.35, 4), MOSSL, T(Math.cos(a) * 1.25, 0.15, Math.sin(a) * 0.95)); }
    return b.build();
  });
}
/** The stone's mouth (a dark oval; the set scales its height while the stone «speaks»). Pivot at its centre. */
export function stoneMouthGeo(): THREE.BufferGeometry {
  return cached('stone-mouth', () => new GB().add(sph(0.22, 10, 6), '#2a1a28', T(0, 0, 0, 0, 0, 0, [1.3, 1, 0.4])).add(sph(0.1, 6, 4), '#d86a7a', T(0, -0.08, -0.04, 0, 0, 0, [1.2, 0.6, 0.4])).build());
}

/** Meadow critter (count puzzle): a round bunny, fur tinted per instance. */
export function critterGeo(): THREE.BufferGeometry {
  return cached('critter', () => {
    const b = new GB();
    const F = '#ffffff';
    b.add(sph(0.22, 9, 7), F, T(0, 0.2, 0.04, 0, 0, 0, [1, 0.9, 1.15]), 1);
    b.add(sph(0.16, 9, 7), F, T(0, 0.38, -0.16), 1);
    for (const s of [-1, 1]) {
      b.add(sph(0.06, 6, 4), F, T(s * 0.07, 0.6, -0.12, 0, 0, s * 0.15, [0.7, 2.4, 0.5]), 1);
      b.add(sph(0.035, 5, 3), '#ffb3c4', T(s * 0.07, 0.6, -0.15, 0, 0, s * 0.15, [0.6, 2.0, 0.4]));
      b.add(sph(0.03, 5, 3), '#231a2c', T(s * 0.07, 0.41, -0.3));
      b.add(sph(0.06, 5, 3), F, T(s * 0.1, 0.05, -0.08, 0, 0, 0, [1, 0.6, 1.4]), 1);
    }
    b.add(sph(0.025, 4, 3), '#ff7f9c', T(0, 0.36, -0.32));
    b.add(sph(0.08, 6, 4), '#fff8f0', T(0, 0.26, 0.28));
    return b.build();
  });
}
/** A burrow mound with a dark hole (critters pop in and out). */
export function burrowGeo(): THREE.BufferGeometry {
  return cached('burrow', () => {
    const b = new GB();
    b.add(sph(0.55, 10, 6, ), '#8a6a42', T(0, 0, 0, 0, 0, 0, [1, 0.45, 1]));
    b.add(cyl(0.26, 0.3, 0.05, 10), '#2a1a18', T(0, 0.22, -0.05, -0.35, 0, 0));
    for (let i = 0; i < 4; i++) { const a = i * 1.6 + 0.4; b.add(cone(0.05, 0.3, 4), '#6aa04a', T(Math.cos(a) * 0.55, 0.12, Math.sin(a) * 0.55)); }
    return b.build();
  });
}
/** A wooden board on two posts (count / letter tallies; the set puts a label on it). */
export function boardGeo(): THREE.BufferGeometry {
  return cached('board', () => {
    const b = new GB();
    for (const s of [-1, 1]) b.add(cyl(0.07, 0.09, 2.4, 6), '#7a5436', T(s * 0.95, 1.2, 0.05));
    b.add(box(2.2, 1.1, 0.1), '#c89a5a', T(0, 1.75, 0));
    b.add(box(2.3, 0.08, 0.14), '#8a5a2a', T(0, 2.3, 0));
    b.add(box(2.3, 0.08, 0.14), '#8a5a2a', T(0, 1.2, 0));
    return b.build();
  });
}

/** Picnic trinkets (changed puzzle), by index: apple, mug, key, candle, book, mushroom, gem, bell, pear, scroll. */
const TRINKETS = 10;
export function trinketGeo(k: number): THREE.BufferGeometry {
  k = ((k % TRINKETS) + TRINKETS) % TRINKETS;
  return cached('trinket:' + k, () => {
    const b = new GB();
    switch (k) {
      case 0: b.add(sph(0.16, 9, 7), '#e8404a', T(0, 0.15, 0)); b.add(cyl(0.015, 0.015, 0.1, 4), '#6a4a30', T(0, 0.33, 0)); b.add(sph(0.05, 5, 3), '#6ac04a', T(0.05, 0.33, 0, 0, 0, 0, [1.4, 0.4, 0.8])); break;
      case 1: b.add(cyl(0.12, 0.11, 0.24, 10), '#5aa8ff', T(0, 0.12, 0)); b.add(tor(0.07, 0.025, Math.PI * 2, 4, 8), '#5aa8ff', T(0.13, 0.13, 0)); b.add(cyl(0.1, 0.1, 0.02, 10), '#fff4d8', T(0, 0.23, 0)); break;
      case 2: b.add(tor(0.07, 0.025, Math.PI * 2, 4, 10), '#ffc94d', T(-0.12, 0.04, 0, Math.PI / 2, 0, 0)); b.add(box(0.26, 0.04, 0.04), '#ffc94d', T(0.06, 0.04, 0)); b.add(box(0.04, 0.04, 0.08), '#ffc94d', T(0.16, 0.04, 0.04)); break;
      case 3: b.add(cyl(0.06, 0.06, 0.3, 8), '#fff4e2', T(0, 0.17, 0)); b.add(cone(0.035, 0.09, 6), '#ffb02a', T(0, 0.37, 0)); b.add(cyl(0.12, 0.12, 0.03, 10), '#c8a04a', T(0, 0.015, 0)); break;
      case 4: b.add(box(0.3, 0.08, 0.22), '#a83a5a', T(0, 0.04, 0)); b.add(box(0.28, 0.06, 0.2), '#fff4e2', T(0.015, 0.05, 0)); b.add(box(0.04, 0.085, 0.22), '#ffc94d', T(-0.13, 0.045, 0)); break;
      case 5: b.add(cyl(0.05, 0.06, 0.16, 6), '#fff4e2', T(0, 0.08, 0)); b.add(sph(0.14, 9, 6, ), '#e8404a', T(0, 0.17, 0, 0, 0, 0, [1, 0.6, 1])); for (let i = 0; i < 4; i++) b.add(sph(0.025, 4, 3), '#ffffff', T(Math.cos(i * 1.6) * 0.08, 0.23, Math.sin(i * 1.6) * 0.08)); break;
      case 6: b.add(new THREE.OctahedronGeometry(0.14, 0), '#c87aff', T(0, 0.17, 0, 0, 0.4, 0, [1, 1.3, 1])); break;
      case 7: b.add(new THREE.SphereGeometry(0.14, 10, 6, 0, Math.PI * 2, 0, Math.PI * 0.6), '#ffc94d', T(0, 0.08, 0)); b.add(cyl(0.16, 0.16, 0.03, 10), '#c8901a', T(0, 0.04, 0)); b.add(sph(0.035, 5, 3), '#c8901a', T(0, 0.24, 0)); break;
      case 8: b.add(sph(0.12, 9, 7), '#b8d84a', T(0, 0.12, 0)); b.add(sph(0.08, 8, 6), '#b8d84a', T(0, 0.25, 0)); b.add(cyl(0.012, 0.012, 0.08, 4), '#6a4a30', T(0, 0.35, 0)); break;
      default: b.add(cyl(0.06, 0.06, 0.3, 8), '#f4e2b8', T(0, 0.06, 0, 0, 0, Math.PI / 2)); b.add(box(0.05, 0.13, 0.13), '#d84a5a', T(0, 0.06, 0)); break;
    }
    return b.build();
  });
}
export const TRINKET_KINDS = TRINKETS;

/** Letter puzzle: a carved stone cube on a plinth (the letter is a label on its face). */
export function letterBlockGeo(): THREE.BufferGeometry {
  return cached('letter-block', () => {
    const b = new GB();
    b.add(box(2.4, 0.3, 2.0), '#6e687e', T(0, 0.15, 0));
    b.add(box(1.8, 1.8, 1.4), '#8a849c', T(0, 1.2, 0));
    b.add(box(1.9, 0.14, 1.5), '#a8a0b8', T(0, 2.14, 0));
    for (const s of [-1, 1]) b.add(box(0.08, 1.5, 0.04), '#7af0ff', T(s * 0.8, 1.2, -0.71));
    b.add(cyl(0.16, 0.16, 0.04, 10), '#ffc94d', T(0, 2.25, 0));
    return b.build();
  });
}
/** Small glowing word-orb (letter tally). Tinted per instance. */
export function orbGeo(): THREE.BufferGeometry {
  return cached('orb', () => new GB().add(new THREE.IcosahedronGeometry(0.16, 1), '#ffffff', T(0, 0, 0), 1).build());
}

/* ================================================================== Изнанка events (Halloween) */

/** «Сладость или гадость»: a crooked cottage front (wall, roof, step, round window) — the door is `doorGeo`. */
export function cottageGeo(): THREE.BufferGeometry {
  return cached('cottage', () => {
    const b = new GB();
    const W = '#5a4a6a', WD = '#3e3450', ROOF = '#3a2a3a', TRIM = '#8a6a42';
    b.add(box(4.2, 3.2, 0.5), W, T(0, 1.6, 0.25));
    b.add(box(4.6, 0.25, 0.7), WD, T(0, 0.12, 0.2));
    b.add(cone(3.2, 1.8, 4), ROOF, T(0, 4.0, 0.3, 0, Math.PI / 4, 0.06, [1, 1, 0.45]));
    for (const s of [-1, 1]) b.add(box(0.18, 2.3, 0.2), TRIM, T(s * 0.68, 1.27, -0.05));
    b.add(box(1.55, 0.2, 0.22), TRIM, T(0, 2.45, -0.05));
    b.add(box(1.6, 0.2, 0.8), '#6e687e', T(0, 0.1, -0.5));
    // windows glowing warm
    b.add(cyl(0.38, 0.38, 0.06, 12), '#ffb347', T(-1.45, 2.1, -0.02, Math.PI / 2, 0, 0));
    b.add(tor(0.38, 0.06, Math.PI * 2, 4, 12), TRIM, T(-1.45, 2.1, -0.04));
    b.add(box(0.06, 0.76, 0.06), TRIM, T(-1.45, 2.1, -0.06)); b.add(box(0.76, 0.06, 0.06), TRIM, T(-1.45, 2.1, -0.06));
    b.add(box(0.6, 0.7, 0.06), '#ffb347', T(1.45, 1.9, -0.02));
    b.add(box(0.75, 0.08, 0.16), TRIM, T(1.45, 1.52, -0.07));
    // a cobweb corner and a bat silhouette on the roof
    b.add(cone(0.18, 0.12, 3), '#1a1c24', T(1.3, 3.6, -0.3, -Math.PI / 2, 0, 0, [2.2, 1, 0.5]));
    b.add(sph(0.1, 5, 4), '#1a1c24', T(1.3, 3.6, -0.32));
    return b.build();
  });
}
/** The cottage door; pivot on its hinge (left edge), closed toward −X… +X. */
export function doorGeo(): THREE.BufferGeometry {
  return cached('door', () => {
    const b = new GB();
    b.add(box(1.16, 2.2, 0.12), '#7a4a2a', T(0.58, 1.1, 0));
    for (const y of [0.5, 1.7]) b.add(box(1.1, 0.1, 0.14), '#5a3420', T(0.58, y, 0));
    b.add(sph(0.06, 6, 4), '#ffc94d', T(1.0, 1.1, -0.09));
    b.add(cone(0.12, 0.2, 3), '#ffb347', T(0.58, 1.95, -0.07, -Math.PI / 2, 0, Math.PI));   // little carved window
    return b.build();
  });
}
/** Jack-o'-lantern (cute, big): ribbed pumpkin, glowing triangle eyes + grin, curled stem and a leaf. */
export function lanternGeo(): THREE.BufferGeometry {
  return cached('jacklantern', () => {
    const b = new GB();
    const P = '#ff8a2a', PD = '#d8641c', G = '#ffe27a';
    b.add(sph(0.5, 14, 10), P, T(0, 0.45, 0, 0, 0, 0, [1.12, 0.86, 1]));
    for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2 + Math.PI / 6; b.add(sph(0.32, 9, 7), i % 2 ? P : PD, T(Math.sin(a) * 0.27, 0.45, Math.cos(a) * 0.27, 0, a, 0, [0.7, 1.15, 1])); }
    // carved face (flat glowing shapes standing proud of the front ribs)
    for (const s of [-1, 1]) b.add(cone(0.13, 0.2, 3), G, T(s * 0.19, 0.6, -0.56, 0, 0, 0, [1, 1, 0.35]));
    b.add(cone(0.07, 0.1, 3), G, T(0, 0.45, -0.58, 0, 0, Math.PI, [1, 1, 0.35]));
    b.add(box(0.5, 0.1, 0.06), G, T(0, 0.3, -0.55));
    for (const s of [-1, 0, 1]) b.add(box(0.07, 0.07, 0.06), G, T(s * 0.15 + 0.07, 0.36, -0.555, 0, 0, Math.PI / 4));
    seg(b, [0, 0.82, 0], [0.08, 1.0, 0.06], 0.06, 0.04, '#4a6a2a', 5);
    b.add(sph(0.1, 5, 3), '#6aa04a', T(-0.12, 0.84, 0.05, 0, 0, 0.4, [1.4, 0.3, 0.8]));
    return b.build();
  });
}
/** Candy bowl on a stool, piled with sweets. */
export function candyBowlGeo(): THREE.BufferGeometry {
  return cached('candybowl', () => {
    const b = new GB();
    b.add(cyl(0.3, 0.34, 0.06, 10), '#8a5a2a', T(0, 0.55, 0));
    for (let i = 0; i < 3; i++) { const a = i * 2.1; b.add(cyl(0.035, 0.035, 0.55, 5), '#7a4a2a', T(Math.cos(a) * 0.22, 0.27, Math.sin(a) * 0.22)); }
    b.add(new THREE.SphereGeometry(0.42, 12, 6, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), '#8a4ac8', T(0, 1.0, 0));
    b.add(tor(0.42, 0.04, Math.PI * 2, 4, 14), '#c87aff', T(0, 1.0, 0, Math.PI / 2, 0, 0));
    const CS = ['#ff5a8a', '#ffd34d', '#5ad8a8', '#5aa8ff', '#ff8a2a', '#ffffff'];
    for (let i = 0; i < 14; i++) {
      const a = i * 2.4, r = 0.08 + (i % 4) * 0.08, y = 1.0 + (i < 6 ? 0.08 : 0.02);
      if (i % 3 === 0) { b.add(sph(0.07, 6, 4), CS[i % 6], T(Math.cos(a) * r, y, Math.sin(a) * r, 0, a, 0, [1.4, 0.8, 0.8])); for (const s of [-1, 1]) b.add(cone(0.04, 0.06, 4), CS[i % 6], T(Math.cos(a) * r + s * 0.12 * Math.cos(a), y, Math.sin(a) * r + s * 0.12 * Math.sin(a), 0, -a, s * Math.PI / 2)); }
      else b.add(sph(0.065, 6, 4), CS[i % 6], T(Math.cos(a) * r, y + 0.02, Math.sin(a) * r));
    }
    b.add(cyl(0.012, 0.012, 0.3, 4), '#ffffff', T(0.1, 1.2, 0.05, 0.3, 0, 0.2));
    b.add(cyl(0.09, 0.09, 0.03, 10), '#ff5a8a', T(0.14, 1.35, 0.1, Math.PI / 2 + 0.3, 0, 0.2));
    return b.build();
  });
}
/** A wrapped candy (fx confetti / the trick result pile), tinted per instance. */
export function candyGeo(): THREE.BufferGeometry {
  return cached('candy', () => {
    const b = new GB();
    b.add(sph(0.09, 7, 5), '#ffffff', T(0, 0, 0, 0, 0, 0, [1.4, 0.9, 0.9]), 1);
    for (const s of [-1, 1]) b.add(cone(0.06, 0.09, 4), '#ffffff', T(s * 0.15, 0, 0, 0, 0, s * Math.PI / 2), 1);
    return b.build();
  });
}
/** Cute sheet ghost (lost ghost / the trick reward): round head, ragged hem, big eyes, pink blush, two nubby arms. */
export function sheetGhostGeo(): THREE.BufferGeometry {
  return cached('sheetghost', () => {
    const b = new GB();
    const G = '#e4ecff', GD = '#a8b8e8';
    b.add(sph(0.55, 14, 10), G, T(0, 1.3, 0));
    b.add(cyl(0.55, 0.68, 0.8, 14, ), G, T(0, 0.85, 0));
    for (let i = 0; i < 9; i++) { const a = (i / 9) * Math.PI * 2; b.add(cone(0.2, 0.3 + (i % 2) * 0.12, 5), i % 2 ? GD : G, T(Math.sin(a) * 0.55, 0.36, Math.cos(a) * 0.55, Math.PI, 0, 0)); }
    for (const s of [-1, 1]) {
      b.add(sph(0.11, 8, 6), '#231a2c', T(s * 0.2, 1.38, -0.48, 0, 0, 0, [0.9, 1.3, 0.5]));
      b.add(sph(0.035, 4, 3), '#ffffff', T(s * 0.2 - 0.03, 1.45, -0.54));
      b.add(sph(0.07, 5, 3), '#ffb3c8', T(s * 0.34, 1.2, -0.44, 0, 0, 0, [1, 0.6, 0.4]));
      b.add(sph(0.14, 7, 5), G, T(s * 0.62, 0.95, -0.1, 0, 0, -s * 0.6, [0.7, 1.3, 0.7]));
    }
    b.add(sph(0.07, 6, 4), '#231a2c', T(0, 1.16, -0.52, 0, 0, 0, [1, 1.2, 0.5]));
    return b.build();
  });
}
/** Crooked grave stones (lost ghost), pal 0..2. */
export function graveGeo(pal = 0): THREE.BufferGeometry {
  return cached('grave:' + pal, () => {
    const b = new GB();
    const S = ['#8a849c', '#7e7890', '#9a94a8'][pal % 3];
    if (pal % 3 === 1) { b.add(box(0.2, 1.4, 0.2), S, T(0, 0.7, 0)); b.add(box(0.9, 0.2, 0.2), S, T(0, 1.05, 0)); }
    else { b.add(box(0.8, 0.9, 0.22), S, T(0, 0.45, 0)); b.add(new THREE.CylinderGeometry(0.4, 0.4, 0.22, 12, 1, false, 0, Math.PI), S, T(0, 0.9, 0, Math.PI / 2, 0, -Math.PI / 2)); b.add(box(0.36, 0.05, 0.03), '#5e5870', T(0, 0.75, -0.12)); }
    b.add(sph(0.5, 8, 4), '#5a4a3a', T(0, 0, 0.5, 0, 0, 0, [0.8, 0.25, 1.3]));
    b.add(sph(0.12, 5, 3), '#6aa04a', T(0.3, 0.05, -0.1, 0, 0, 0, [1, 0.6, 1]));
    return b.build();
  });
}
/** A hanging lantern on a crooked pole. */
export function lanternPoleGeo(): THREE.BufferGeometry {
  return cached('lanternpole', () => {
    const b = new GB();
    seg(b, [0, 0, 0], [0.1, 2.6, 0], 0.07, 0.05, '#4a3a2a', 6);
    seg(b, [0.1, 2.55, 0], [0.7, 2.7, 0], 0.04, 0.035, '#4a3a2a', 5);
    b.add(cyl(0.012, 0.012, 0.3, 4), '#2a2a2a', T(0.68, 2.5, 0));
    b.add(box(0.24, 0.32, 0.24), '#ffd34d', T(0.68, 2.2, 0));
    b.add(cone(0.2, 0.14, 4), '#2a2a2a', T(0.68, 2.43, 0, 0, Math.PI / 4, 0));
    b.add(box(0.28, 0.04, 0.28), '#2a2a2a', T(0.68, 2.03, 0));
    return b.build();
  });
}

/** Jack's fortune tent: a round striped marquee with an open front, pennant, stars; a draped round table inside. */
export function fortuneTentGeo(): THREE.BufferGeometry {
  return cached('fortunetent', () => {
    const b = new GB();
    const A = '#5a3a8a', B = '#ffc94d', IN = '#2a1a3a';
    // back half-wall (open toward −Z) + inner dark
    const wall = new THREE.CylinderGeometry(2.0, 2.0, 2.4, 16, 1, true, Math.PI + 0.7, Math.PI * 2 - 1.4);   // gap at θ = π (−Z, the front)
    b.add(wall, A, T(0, 1.2, 0));
    b.add(cyl(1.92, 1.92, 0.04, 16), '#3a2a4a', T(0, 0.02, 0));
    for (let i = 0; i < 12; i++) { const a = (i / 12) * Math.PI * 2; if (Math.abs(a - Math.PI) < 0.75) continue; b.add(box(0.12, 2.4, 0.04), B, T(Math.sin(a) * 2.02, 1.2, Math.cos(a) * 2.02, 0, a, 0)); }
    b.add(cone(2.5, 1.7, 16), A, T(0, 3.25, 0));
    for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; b.add(cone(0.22, 0.32, 3), i % 2 ? B : A, T(Math.sin(a) * 2.35, 2.3, Math.cos(a) * 2.35, Math.PI, a, 0)); }
    b.add(cyl(0.03, 0.03, 0.8, 4), '#7a5436', T(0, 4.4, 0));
    b.add(box(0.5, 0.26, 0.02), '#ff5a8a', T(0.26, 4.65, 0));
    b.add(sph(0.12, 6, 4), B, T(0, 4.1, 0));
    // dark interior backdrop + hanging star / moon
    b.add(new THREE.CylinderGeometry(1.85, 1.85, 2.3, 14, 1, true, Math.PI + 0.7, Math.PI * 2 - 1.4), IN, T(0, 1.15, 0, 0, 0, 0, [-1, 1, 1]));   // mirrored: seen from inside
    b.add(new THREE.OctahedronGeometry(0.16, 0), B, T(-0.9, 2.1, 0.9));
    b.add(tor(0.16, 0.05, Math.PI * 1.3, 4, 10), B, T(0.9, 2.2, 0.9, 0, 0, 0.6));
    // draped table
    b.add(cyl(0.75, 0.95, 0.85, 14), '#8a2a5a', T(0, 0.43, -0.2));
    b.add(cyl(0.8, 0.8, 0.06, 14), '#a83a6a', T(0, 0.86, -0.2));
    for (let i = 0; i < 10; i++) { const a = (i / 10) * Math.PI * 2; b.add(sph(0.04, 4, 3), B, T(Math.sin(a) * 0.9, 0.12, -0.2 + Math.cos(a) * 0.9)); }
    // crystal ball stand
    b.add(cyl(0.16, 0.22, 0.14, 8), '#c8901a', T(0, 0.96, -0.2));
    return b.build();
  });
}
/** The crystal ball (drawn with the additive glow material by the set). */
export function crystalBallGeo(): THREE.BufferGeometry {
  return cached('crystalball', () => new GB().add(sph(0.3, 16, 12), '#7ae0ff', T(0, 0, 0)).add(sph(0.16, 10, 8), '#c87aff', T(0.04, 0.03, 0)).build());
}
/** Fortune teller: a hooded robe with glowing eyes in the dark hood, gold trim, hands toward the ball. */
export function tellerGeo(): THREE.BufferGeometry {
  return cached('teller', () => {
    const b = new GB();
    const R = '#3a2a6a', RD = '#2a1e4e', GO = '#ffc94d';
    b.add(cone(0.65, 1.7, 10), R, T(0, 0.85, 0));
    b.add(sph(0.36, 12, 9), R, T(0, 1.75, 0.02, 0, 0, 0, [1, 1.08, 1]));
    b.add(cone(0.36, 0.55, 10), R, T(0, 2.1, 0.12, 0.35, 0, 0));
    b.add(sph(0.26, 10, 8), '#120a1e', T(0, 1.7, -0.14, 0, 0, 0, [1, 1.1, 0.6]));
    for (const s of [-1, 1]) {
      b.add(sph(0.05, 6, 4), '#ffe27a', T(s * 0.1, 1.74, -0.29));
      seg(b, [s * 0.32, 1.35, -0.05], [s * 0.2, 1.05, -0.45], 0.12, 0.1, RD, 7);
      b.add(sph(0.08, 6, 4), '#e8d8c8', T(s * 0.2, 1.02, -0.5));
    }
    b.add(tor(0.62, 0.035, Math.PI * 2, 4, 14), GO, T(0, 0.08, 0, Math.PI / 2, 0, 0));
    b.add(tor(0.3, 0.03, Math.PI, 4, 10), GO, T(0, 1.75, -0.18, 0, 0, Math.PI));
    b.add(new THREE.OctahedronGeometry(0.06, 0), GO, T(0, 1.3, -0.33));
    return b.build();
  });
}
/** A tarot card lying face down (back pattern); the set flips it. Size 0.32 × 0.5. */
export function tarotGeo(): THREE.BufferGeometry {
  return cached('tarot', () => {
    const b = new GB();
    b.add(box(0.32, 0.015, 0.5), '#3a2a6a', T(0, 0, 0));
    b.add(box(0.26, 0.017, 0.44), '#ffc94d', T(0, 0, 0));
    b.add(box(0.22, 0.019, 0.4), '#5a3a8a', T(0, 0, 0));
    b.add(new THREE.OctahedronGeometry(0.06, 0), '#ffe27a', T(0, 0.005, 0, 0, 0, 0, [1, 0.15, 1.3]));
    return b.build();
  });
}

/** «Ведьмин котёл»: the iron pot on three legs over a log fire (the brew surface is `brewGeo`, tinted by stage). */
export function cauldronGeo(): THREE.BufferGeometry {
  return cached('cauldron', () => {
    const b = new GB();
    const IR = '#2e2a38', IRL = '#4a4458';
    b.add(new THREE.SphereGeometry(1.0, 16, 10, 0, Math.PI * 2, Math.PI * 0.32, Math.PI * 0.68), IR, T(0, 1.15, 0, 0, 0, 0, [1, 0.85, 1]));
    b.add(tor(0.86, 0.1, Math.PI * 2, 6, 18), IRL, T(0, 1.55, 0, Math.PI / 2, 0, 0));
    for (const s of [-1, 1]) b.add(tor(0.18, 0.05, Math.PI * 2, 4, 8), IRL, T(s * 1.0, 1.3, 0, 0, Math.PI / 2, 0));
    for (let i = 0; i < 3; i++) { const a = i * 2.09 + 0.5; seg(b, [Math.cos(a) * 0.6, 0.55, Math.sin(a) * 0.6], [Math.cos(a) * 0.85, 0, Math.sin(a) * 0.85], 0.08, 0.06, IR, 5); }
    for (let i = 0; i < 4; i++) { const a = (i / 4) * Math.PI * 2 + 0.4; b.add(cyl(0.09, 0.09, 1.2, 6), '#6a4a30', T(Math.cos(a) * 0.15, 0.12, Math.sin(a) * 0.15, 0, -a, Math.PI / 2 - 0.25)); }
    for (let i = 0; i < 7; i++) { const a = (i / 7) * Math.PI * 2; b.add(dod(0.16), '#6e687e', T(Math.cos(a) * 1.15, 0.08, Math.sin(a) * 1.15, a, a, 0, [1, 0.6, 1])); }
    return b.build();
  });
}
/** The brew surface: a disc with a few bubbles, all tinted by the instance colour. */
export function brewGeo(): THREE.BufferGeometry {
  return cached('brew', () => {
    const b = new GB();
    b.add(cyl(0.84, 0.84, 0.06, 18), '#ffffff', T(0, 0, 0), 1);
    for (let i = 0; i < 5; i++) { const a = i * 1.7, r = 0.2 + (i % 3) * 0.18; b.add(sph(0.1 + (i % 2) * 0.05, 7, 5), '#ffffff', T(Math.cos(a) * r, 0.04, Math.sin(a) * r, 0, 0, 0, [1, 0.6, 1]), 1); }
    return b.build();
  });
}
/** Stirring ladle (pivot at the pot centre; the set spins it). */
export function ladleGeo(): THREE.BufferGeometry {
  return cached('ladle', () => {
    const b = new GB();
    seg(b, [0.3, -0.2, 0], [0.55, 1.2, 0.1], 0.045, 0.04, '#8a5a2a', 5);
    b.add(sph(0.12, 6, 4), '#8a5a2a', T(0.29, -0.24, 0, 0, 0, 0, [1, 0.5, 1]));
    return b.build();
  });
}
/** Little witch (cauldron): pointed hat, green face, purple dress, broom-arm stirring. */
export function witchGeo(): THREE.BufferGeometry {
  return cached('witch', () => {
    const b = new GB();
    const D = '#4a2a6a', SK = '#9ad87a', H = '#1e1a2a';
    b.add(cone(0.55, 1.2, 10), D, T(0, 0.6, 0));
    b.add(sph(0.36, 12, 9), SK, T(0, 1.42, 0));
    b.add(cyl(0.68, 0.68, 0.05, 14), H, T(0, 1.68, 0.02));
    b.add(cone(0.36, 1.0, 10), H, T(0.08, 2.2, 0.05, 0, 0, -0.2));
    b.add(cyl(0.37, 0.37, 0.1, 12), '#c87aff', T(0, 1.75, 0.02));
    face(b, 1.46, -0.3, 0.13);
    b.add(cone(0.06, 0.2, 5), SK, T(0, 1.36, -0.38, -Math.PI / 2, 0, 0));
    for (const s of [-1, 1]) b.add(sph(0.05, 5, 3), '#ff9db0', T(s * 0.22, 1.33, -0.27, 0, 0, 0, [1, 0.6, 0.4]));
    for (let i = 0; i < 6; i++) { const a = i * 0.5 - 1.2; b.add(cone(0.08, 0.5, 4), '#e8603a', T(Math.sin(a) * 0.33, 1.25, 0.1 + Math.cos(a) * 0.25, 0.3, 0, a * 0.3)); }
    for (const s of [-1, 1]) seg(b, [s * 0.3, 1.0, 0], [s * 0.42, 0.85, -0.35], 0.1, 0.08, D, 6);
    return b.build();
  });
}
/** Ingredient bits (thrown in): tinted. */
export function bitGeo(): THREE.BufferGeometry {
  return cached('bit', () => new GB().add(dod(0.12), '#ffffff', T(0, 0, 0), 1).build());
}

/** Dance floor of the skeletons: a cracked crypt platform with two torches and a bony arch. */
export function cryptStageGeo(): THREE.BufferGeometry {
  return cached('cryptstage', () => {
    const b = new GB();
    b.add(cyl(3.3, 3.5, 0.35, 8), '#5e5870', T(0, 0.17, 0));
    b.add(cyl(3.2, 3.2, 0.05, 8), '#7e7890', T(0, 0.37, 0));
    for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2 + Math.PI / 8; b.add(box(0.06, 0.02, 1.4), '#4a4458', T(Math.cos(a) * 1.6, 0.4, Math.sin(a) * 1.6, 0, -a, 0)); }
    for (const s of [-1, 1]) {
      b.add(box(0.5, 3.2, 0.5), '#6e687e', T(s * 2.9, 1.6, 1.5));
      b.add(sph(0.3, 8, 6), '#e8e0c8', T(s * 2.9, 3.45, 1.5));
      for (const e of [-1, 1]) b.add(sph(0.07, 5, 4), '#1a1c24', T(s * 2.9 + e * 0.1, 3.48, 1.24));
    }
    b.add(tor(2.9, 0.18, Math.PI, 5, 16), '#6e687e', T(0, 3.2, 1.5));
    for (let i = 0; i < 7; i++) { const a = (i / 6) * Math.PI; b.add(sph(0.14, 6, 4), '#e8e0c8', T(Math.cos(a) * 2.9, 3.2 + Math.sin(a) * 2.9, 1.3)); }
    return b.build();
  });
}
/** Dancing skeleton without its arms (legs, pelvis, ribs, skull with a bow / top hat by pal). */
export function skelBodyGeo(): THREE.BufferGeometry {
  return cached('skelbody', () => {
    const b = new GB();
    const BO = '#f0e8d4', BD = '#c8bea4';
    for (const s of [-1, 1]) {
      seg(b, [s * 0.1, 0.62, 0], [s * 0.12, 0.32, -0.02], 0.05, 0.045, BO, 6);
      seg(b, [s * 0.12, 0.32, -0.02], [s * 0.12, 0.06, 0], 0.045, 0.04, BO, 6);
      b.add(sph(0.05, 5, 4), BO, T(s * 0.12, 0.32, -0.02));
      b.add(sph(0.07, 6, 4), BO, T(s * 0.12, 0.04, -0.06, 0, 0, 0, [1, 0.6, 1.6]));
    }
    b.add(box(0.3, 0.1, 0.14), BD, T(0, 0.64, 0));
    seg(b, [0, 0.66, 0.02], [0, 1.15, 0.02], 0.035, 0.035, BO, 6);
    for (let i = 0; i < 4; i++) b.add(tor(0.15 - i * 0.012, 0.026, Math.PI * 1.5, 4, 10), BO, T(0, 0.82 + i * 0.08, 0, Math.PI / 2, 0, Math.PI * 0.25, [1, 0.8, 1]));
    b.add(box(0.44, 0.06, 0.1), BD, T(0, 1.13, 0));
    b.add(sph(0.26, 12, 9), BO, T(0, 1.42, 0, 0, 0, 0, [1, 0.95, 1]));
    b.add(box(0.26, 0.1, 0.18), BO, T(0, 1.24, -0.08));
    for (const s of [-1, 1]) { b.add(sph(0.075, 7, 5), '#1a1c24', T(s * 0.1, 1.45, -0.21, 0, 0, 0, [1, 1.1, 0.6])); b.add(sph(0.025, 4, 3), '#ffe27a', T(s * 0.1, 1.45, -0.26)); }
    b.add(cone(0.035, 0.06, 3), '#1a1c24', T(0, 1.35, -0.25, -Math.PI / 2, 0, Math.PI));
    for (let i = -2; i <= 2; i++) b.add(box(0.03, 0.04, 0.02), '#1a1c24', T(i * 0.04, 1.26, -0.17));
    // party bow tie (tinted per skeleton)
    for (const s of [-1, 1]) b.add(cone(0.07, 0.1, 3), '#ffffff', T(s * 0.06, 1.1, -0.1, 0, 0, s * Math.PI / 2), 1);
    b.add(sph(0.03, 4, 3), '#ffffff', T(0, 1.1, -0.11), 1);
    return b.build();
  });
}
/** One skeleton arm hanging down from the shoulder pivot (symmetric: used for both sides). */
export function skelArmGeo(): THREE.BufferGeometry {
  return cached('skelarm', () => {
    const b = new GB();
    seg(b, [0, 0, 0], [0, -0.28, 0], 0.035, 0.03, '#f0e8d4', 6);
    seg(b, [0, -0.28, 0], [0, -0.52, 0], 0.03, 0.028, '#f0e8d4', 6);
    b.add(sph(0.06, 6, 4), '#f0e8d4', T(0, -0.56, 0, 0, 0, 0, [1, 1, 0.6]));
    return b.build();
  });
}

/* ================================================================== goblin fair */

/** Goblin trickster (no hands: those are `goblinHandGeo`): big ears, long nose, crooked hat, vest, grin. */
export function goblinGeo(): THREE.BufferGeometry {
  return cached('goblin', () => {
    const b = new GB();
    const SK = '#7ac85a', SKD = '#5aa83e', V = '#a83a3a', SH = '#e8d8a8', H = '#4a3a8a';
    b.add(sph(0.42, 12, 9), SH, T(0, 0.75, 0, 0, 0, 0, [1, 1.1, 0.9]));
    b.add(cyl(0.4, 0.44, 0.6, 12, ), V, T(0, 0.8, 0.02));
    for (const s of [-1, 1]) { b.add(sph(0.035, 4, 3), '#ffc94d', T(s * 0.08, 0.78 + s * 0.0, -0.4)); b.add(sph(0.035, 4, 3), '#ffc94d', T(s * 0.08, 0.95, -0.38)); }
    b.add(sph(0.42, 14, 10), SK, T(0, 1.42, 0, 0, 0, 0, [1.08, 0.95, 1]));
    for (const s of [-1, 1]) {
      b.add(cone(0.16, 0.62, 5), SK, T(s * 0.55, 1.5, 0.05, 0, 0, -s * 1.25, [1, 1, 0.45]));
      b.add(cone(0.09, 0.42, 5), '#e8909a', T(s * 0.52, 1.5, 0.03, 0, 0, -s * 1.25, [1, 1, 0.3]));
      b.add(sph(0.11, 8, 6), '#ffffff', T(s * 0.15, 1.52, -0.34, 0, 0, 0, [1, 1, 0.6]));
      b.add(sph(0.06, 6, 4), '#231a2c', T(s * 0.14, 1.52, -0.41, 0, 0, 0, [1, 1, 0.5]));
      b.add(sph(0.022, 4, 3), '#ffffff', T(s * 0.12, 1.55, -0.45));
      b.add(box(0.16, 0.04, 0.05), SKD, T(s * 0.16, 1.66, -0.36, 0, 0, s * 0.3));
    }
    b.add(cone(0.08, 0.36, 6), SKD, T(0, 1.38, -0.5, -Math.PI / 2 - 0.25, 0, 0));
    b.add(box(0.3, 0.05, 0.04), '#3a1a28', T(0, 1.22, -0.37, 0, 0, 0));
    for (const s of [-1, 1]) b.add(cone(0.025, 0.06, 3), '#ffffff', T(s * 0.08, 1.2, -0.39, Math.PI, 0, 0));
    b.add(cyl(0.5, 0.5, 0.05, 12), H, T(0, 1.76, 0.02, -0.1, 0, 0.1));
    b.add(cone(0.32, 0.75, 10), H, T(0.06, 2.12, 0.08, -0.1, 0, 0.28));
    b.add(cyl(0.33, 0.33, 0.08, 10), '#ffc94d', T(0.02, 1.83, 0.02, -0.1, 0, 0.1));
    b.add(sph(0.07, 6, 4), '#ffc94d', T(0.3, 2.45, 0.12));
    return b.build();
  });
}
/** Goblin hand (mitten + sleeve stub). */
export function goblinHandGeo(): THREE.BufferGeometry {
  return cached('goblinhand', () => {
    const b = new GB();
    b.add(sph(0.11, 8, 6), '#7ac85a', T(0, 0, 0, 0, 0, 0, [1, 0.8, 1.1]));
    b.add(sph(0.045, 5, 3), '#7ac85a', T(0.1, 0.02, -0.05));
    b.add(cyl(0.09, 0.11, 0.25, 8), '#a83a3a', T(0, 0.02, 0.2, Math.PI / 2, 0, 0));
    return b.build();
  });
}
/** Fair stall: a long table with a striped cloth, a striped awning on posts and pennants; the goblin stands behind (+Z). */
export function fairStallGeo(): THREE.BufferGeometry {
  return cached('fairstall', () => {
    const b = new GB();
    b.add(box(3.2, 0.1, 1.2), '#9a6a3a', T(0, 0.9, 0));
    b.add(box(3.24, 0.82, 0.04), '#2a6a4a', T(0, 0.46, -0.6));
    for (let i = 0; i < 8; i++) b.add(box(0.2, 0.82, 0.05), '#ffc94d', T(-1.4 + i * 0.4, 0.46, -0.61));
    for (const s of [-1, 1]) b.add(box(0.06, 0.82, 1.16), '#2a6a4a', T(s * 1.61, 0.46, 0));
    for (const x of [-1.7, 1.7]) for (const z of [-0.7, 1.2]) b.add(cyl(0.06, 0.06, 3.2, 6), '#7a5436', T(x, 1.6, z));
    for (let i = 0; i < 9; i++) b.add(box(0.4, 0.06, 2.3), i % 2 ? '#fff4e2' : '#2a8a5a', T(-1.6 + i * 0.4, 3.18 + (i % 2) * 0.01, 0.25, -0.22, 0, 0));
    for (let i = 0; i < 9; i++) b.add(cone(0.2, 0.3, 3), i % 2 ? '#fff4e2' : '#2a8a5a', T(-1.6 + i * 0.4, 2.85, -0.85, Math.PI, 0, 0, [1, 1, 0.3]));
    return b.build();
  });
}
/** Shell game cup (upside down; the ball is `ballGeo`). */
export function shellCupGeo(): THREE.BufferGeometry {
  return cached('shellcup', () => {
    const b = new GB();
    b.add(cyl(0.16, 0.24, 0.42, 12), '#c84a3a', T(0, 0.21, 0));
    b.add(tor(0.235, 0.03, Math.PI * 2, 4, 12), '#ffc94d', T(0, 0.03, 0, Math.PI / 2, 0, 0));
    b.add(cyl(0.12, 0.16, 0.06, 12), '#e8604a', T(0, 0.44, 0));
    b.add(tor(0.17, 0.02, Math.PI * 2, 4, 12), '#ffc94d', T(0, 0.3, 0, Math.PI / 2, 0, 0));
    return b.build();
  });
}
export function ballGeo(): THREE.BufferGeometry {
  return cached('ball', () => new GB().add(sph(0.09, 10, 8), '#fff4e2', T(0, 0.09, 0)).build());
}
/**
 * The big coin (stands on its edge facing −Z at rotation 0): «орёл» side (−Z) a raised crown,
 * «решка» side (+Z) a raised big «1» and a laurel ring. Radius 0.6.
 */
export function bigCoinGeo(): THREE.BufferGeometry {
  return cached('bigcoin', () => {
    const b = new GB();
    const G = '#ffc94d', GD = '#d89a1a', GL = '#9a5a10';
    b.add(cyl(0.6, 0.6, 0.1, 22), G, T(0, 0, 0, Math.PI / 2, 0, 0));
    b.add(tor(0.56, 0.035, Math.PI * 2, 4, 22), GD, T(0, 0, -0.05));
    b.add(tor(0.56, 0.035, Math.PI * 2, 4, 22), GD, T(0, 0, 0.05));
    // heads (−Z): crown
    b.add(box(0.5, 0.14, 0.05), GL, T(0, -0.12, -0.06));
    for (let i = -2; i <= 2; i++) b.add(cone(0.07, 0.22, 4), GL, T(i * 0.11, 0.06 + (i === 0 ? 0.05 : Math.abs(i) === 1 ? 0 : -0.02), -0.06, 0, Math.PI / 4, 0, [1, 1, 0.5]));
    for (let i = -2; i <= 2; i += 2) b.add(sph(0.035, 5, 3), '#ff5a6a', T(i * 0.11, -0.12, -0.09));
    // tails (+Z): «1» and a ring of dots
    b.add(box(0.09, 0.42, 0.05), GL, T(0.02, 0, 0.06));
    b.add(box(0.15, 0.06, 0.05), GL, T(-0.03, 0.16, 0.06, 0, 0, 0.6));
    b.add(box(0.24, 0.06, 0.05), GL, T(0.02, -0.2, 0.06));
    for (let i = 0; i < 12; i++) { const a = (i / 12) * Math.PI * 2; b.add(sph(0.025, 4, 3), GL, T(Math.cos(a) * 0.42, Math.sin(a) * 0.42, 0.07)); }
    return b.build();
  });
}
/** A playing card standing up (face −Z white with a red border — the value is a label; back +Z blue pattern). 0.6 × 0.9. */
export function playCardGeo(): THREE.BufferGeometry {
  return cached('playcard', () => {
    const b = new GB();
    b.add(box(0.62, 0.92, 0.02), '#d84a5a', T(0, 0.46, 0));
    b.add(box(0.54, 0.84, 0.024), '#fff8ec', T(0, 0.46, -0.002));
    b.add(box(0.5, 0.8, 0.024), '#3a5aa8', T(0, 0.46, 0.004));
    for (let i = 0; i < 4; i++) b.add(new THREE.OctahedronGeometry(0.06, 0), '#ffc94d', T(0, 0.22 + i * 0.16, 0.02, 0, 0, 0, [1, 1, 0.2]));
    b.add(box(0.06, 0.4, 0.1), '#7a5436', T(0, 0.2, 0.12, -0.5, 0, 0));    // little stand behind
    return b.build();
  });
}

/* ================================================================== extras */

/** Changed puzzle: a two-tier wooden shelf of odds and ends (the trinkets sit on it; a curtain hides it while answering). */
export function shelfGeo(): THREE.BufferGeometry {
  return cached('shelf', () => {
    const b = new GB();
    const W = '#9a6a3a', WD = '#7a5436';
    for (const s of [-1, 1]) b.add(box(0.14, 2.2, 0.6), WD, T(s * 1.75, 1.1, 0));
    for (const y of [0.25, 1.1, 1.95]) b.add(box(3.6, 0.1, 0.62), W, T(0, y, 0));
    b.add(box(3.5, 2.2, 0.05), '#6a4a30', T(0, 1.1, 0.3));
    b.add(box(3.8, 0.14, 0.7), WD, T(0, 2.25, 0));
    for (const s of [-1, 1]) b.add(sph(0.08, 6, 4), '#ffc94d', T(s * 1.75, 2.38, 0));
    // curtain rail
    b.add(cyl(0.03, 0.03, 3.8, 5), '#c8901a', T(0, 2.45, -0.38, 0, 0, Math.PI / 2));
    return b.build();
  });
}
/** Curtain (pivot at its top; the set scales its height to lower it). Tinted dark purple. */
export function curtainGeo(): THREE.BufferGeometry {
  return cached('curtain', () => {
    const b = new GB();
    for (let i = 0; i < 9; i++) b.add(cyl(0.22, 0.22, 1, 6), i % 2 ? '#7a2a5a' : '#8a3a6a', T(-1.6 + i * 0.4, -0.5, 0, 0, 0, 0, [1, 1, 0.35]));
    b.add(box(3.6, 0.08, 0.12), '#ffc94d', T(0, -0.98, 0));
    return b.build();
  });
}
/** A lumpy burlap sack with a scary stitched face (the «гадость» side). */
export function sackGeo(): THREE.BufferGeometry {
  return cached('sack', () => {
    const b = new GB();
    const S = '#c8a868', SD = '#8a6a3e';
    b.add(sph(0.48, 10, 8), S, T(0, 0.42, 0, 0, 0, 0, [1, 0.9, 0.9]));
    b.add(cone(0.22, 0.35, 8), S, T(0, 0.92, 0));
    b.add(tor(0.13, 0.04, Math.PI * 2, 4, 10), SD, T(0, 0.82, 0, Math.PI / 2, 0, 0));
    for (const s of [-1, 1]) { b.add(box(0.2, 0.05, 0.04), '#231a2c', T(s * 0.17, 0.56, -0.43, 0, 0, s * 0.7)); b.add(box(0.2, 0.05, 0.04), '#231a2c', T(s * 0.17, 0.56, -0.43, 0, 0, -s * 0.7)); }
    b.add(box(0.36, 0.03, 0.03), '#231a2c', T(0, 0.36, -0.44));
    for (let i = -2; i <= 2; i++) b.add(box(0.025, 0.09, 0.03), '#231a2c', T(i * 0.07, 0.36, -0.445));
    return b.build();
  });
}
/** Witch's coin bowl (cauldron «pay» stage): a wooden bowl; coins are `coinGeo` instances. */
export function coinBowlGeo(): THREE.BufferGeometry {
  return cached('coinbowl', () => {
    const b = new GB();
    b.add(cyl(0.3, 0.32, 0.6, 8), '#7a5436', T(0, 0.3, 0));
    b.add(new THREE.SphereGeometry(0.5, 12, 6, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), '#9a6a3a', T(0, 0.95, 0));
    b.add(tor(0.5, 0.04, Math.PI * 2, 4, 14), '#c8901a', T(0, 0.95, 0, Math.PI / 2, 0, 0));
    return b.build();
  });
}
export function coinGeo(): THREE.BufferGeometry {
  return cached('coin', () => new GB().add(cyl(0.1, 0.1, 0.03, 10), '#ffc94d', T(0, 0, 0)).add(cyl(0.07, 0.07, 0.035, 8), '#ffe27a', T(0, 0, 0)).build());
}
