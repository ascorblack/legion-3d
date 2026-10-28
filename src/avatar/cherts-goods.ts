/**
 * «Чертики» goods (site style 'cherts', styles/cherts/goods.js): the hell kitchen — baked, hot, smoked — plus the
 * «зелье жара» potion and the charred-parchment scroll. Same item ids as every other style; only the look changes:
 *
 *   apple «Печёное яблоко» · pear «Жгучий перчик» · pretzel «Угольный крендель» · bread «Горелая корка» ·
 *   kvass «Серная газировка» · cheese «Плавленый сыр» · pie «Пирожок из пекла» · ham «Копчёный окорок» ·
 *   roast «Шашлык на вилах» · honey_cake «Пряник с перцем» · sage_tea «Чай из котла» · spicy_stew «Адская похлёбка»
 *
 * Colours and proportions are derived from the site's drawing code (fills, the dark-crimson outline comes from the
 * item outline pass); the 3D shapes are ours. Built once per kind (items.ts caches the merged geometry), avatar
 * convention: front = −Z, bottom at y = 0, ~0.15–0.25 m before items.ts re-fits them.
 */
import * as THREE from 'three';
import { Parts, T, sphere, cyl, cone, box, torus, slab, tube, capsule } from './geom';
import { flame3 } from './cherts';

const INK = '#2a0d14', GOLD = '#ffc83d', CREAM = '#f3e6c8', IRON = '#3a3346', IRON_L = '#5a5470';
const FIRE = ['#ffe27a', '#ff9a2a', '#ff4a1a'] as const;

/** Model kinds of the cherts kitchen (items.ts food kinds prefixed 'ch_'). */
export const CH_FOOD_KINDS = ['ch_apple', 'ch_pepper', 'ch_pretzel', 'ch_bread', 'ch_soda', 'ch_cheese', 'ch_pie', 'ch_ham', 'ch_skewer', 'ch_ginger', 'ch_tea', 'ch_stew'] as const;
export type ChFoodKind = (typeof CH_FOOD_KINDS)[number];

/** The site's goods.js ids → model (the same legacy ids every style renames). */
export const CH_FOOD_BY_ID: Record<string, ChFoodKind> = {
  apple: 'ch_apple', pear: 'ch_pepper', pretzel: 'ch_pretzel', bread: 'ch_bread', kvass: 'ch_soda', cheese: 'ch_cheese', pie: 'ch_pie',
  ham: 'ch_ham', roast: 'ch_skewer', honey_cake: 'ch_ginger', sage_tea: 'ch_tea', spicy_stew: 'ch_stew', fish: 'ch_ham',
};
/** By the shown name (names.json of the style), specific words first. */
const CH_HINTS: [RegExp, ChFoodKind][] = [
  [/шашлык|вилах|skewer/i, 'ch_skewer'], [/пряник|ginger/i, 'ch_ginger'], [/похл[её]бк|stew|варев/i, 'ch_stew'], [/чай|котл|tea/i, 'ch_tea'],
  [/газиров|сер[нао]|soda|лимонад/i, 'ch_soda'], [/перч|pepper|чили/i, 'ch_pepper'], [/крендел|pretzel|угол|уголь/i, 'ch_pretzel'],
  [/корк|хлеб|bread|горел/i, 'ch_bread'], [/сыр|cheese/i, 'ch_cheese'], [/пирож|пирог|pie/i, 'ch_pie'], [/окорок|ветчин|копч|ham|мяс/i, 'ch_ham'],
  [/яблок|apple/i, 'ch_apple'],
];
/** Generic food kinds (items.ts foodKind) → the closest cherts dish, for goods the style does not name. */
const CH_FROM_GENERIC: Record<string, ChFoodKind> = {
  apple: 'ch_apple', pear: 'ch_pepper', pretzel: 'ch_pretzel', bread: 'ch_bread', cheese: 'ch_cheese', pie: 'ch_pie', meat: 'ch_ham', sausage: 'ch_ham',
  fish: 'ch_ham', smelt: 'ch_ham', salmon: 'ch_skewer', mug: 'ch_soda', saucer: 'ch_soda', milk: 'ch_tea', cup: 'ch_tea', bowl: 'ch_stew', cream: 'ch_stew',
  kibble: 'ch_pretzel', cake: 'ch_ginger', herb: 'ch_pepper',
};
/** Cherts dish for a good: its shown name first, then its site id, then the generic kind; 'ch_bread' when nothing fits. */
export function chFoodKind(id = '', name = '', generic = ''): ChFoodKind {
  if (name) for (const [re, k] of CH_HINTS) if (re.test(name)) return k;
  return CH_FOOD_BY_ID[id] || CH_FROM_GENERIC[generic] || 'ch_bread';
}

/* ------------------------------------------------------------------ helpers */
/** Steam / smoke: two wavy wisps rising from (x, y, z). */
function wisps(p: Parts, x: number, y: number, z: number, c = '#ffd6c4', h = 0.07): void {
  for (const dx of [-0.022, 0.022]) p.add(tube([[x + dx, y, z], [x + dx - 0.012, y + h * 0.5, z], [x + dx + 0.004, y + h, z]], 0.0045, 6, 4), c);
}

/**
 * The parts are authored as the site draws them (+x = the viewer's right); items.ts turns the avatar convention
 * (front −Z) to face +Z, which swaps left and right — so mirror what was added (and fix the winding).
 */
function mirrored(p: Parts, build: () => void): void {
  const from = p.list.length;
  build();
  const m = new THREE.Matrix4().makeScale(-1, 1, 1);
  for (let i = from; i < p.list.length; i++) {
    const g = p.list[i]; g.applyMatrix4(m);
    const ix = g.index!.array as Uint16Array | Uint32Array;
    for (let q = 0; q + 2 < ix.length; q += 3) { const t = ix[q + 1]; ix[q + 1] = ix[q + 2]; ix[q + 2] = t; }
    g.index!.needsUpdate = true;
  }
}

/* ------------------------------------------------------------------ the kitchen */
export function addChertsFood(p: Parts, kind: string): void { mirrored(p, () => food(p, kind)); }
function food(p: Parts, kind: string): void {
  switch (kind as ChFoodKind) {
    case 'ch_apple': {   // dark red, a scorched cap on top, a bent stem, a pink highlight, steam
      p.add(sphere(0.064, 16, 12), '#b8202e', T(0, 0.064, 0, 0, 0, 0, [1, 0.94, 1]));
      p.add(sphere(0.05, 14, 6), '#5a1a1a', T(0, 0.104, 0, 0, 0, 0, [1, 0.32, 1]));
      p.add(tube([[0, 0.112, 0], [0.006, 0.14, 0], [0.026, 0.152, 0]], 0.0065, 6, 5), '#3a2614');
      p.add(sphere(0.016, 8, 6), '#ff8a7a', T(-0.03, 0.07, -0.05, 0, 0, 0, [1, 1, 0.45]));
      wisps(p, 0, 0.16, 0);
      break;
    }
    case 'ch_pepper': {  // a red pod curling down to its tip, a green cap and stem, a little flame at the tip
      const pts: [number, number, number][] = [[-0.085, 0.085, 0], [-0.035, 0.09, 0], [0.02, 0.065, 0], [0.065, 0.03, 0], [0.1, 0.008, 0]];
      p.add(tube(pts, 0.036, 16, 10, 0.85), '#e8202e');
      p.add(sphere(0.036, 10, 8), '#e8202e', T(-0.085, 0.085, 0));
      p.add(tube([[-0.07, 0.1, -0.026], [-0.03, 0.098, -0.028], [0.02, 0.078, -0.022]], 0.006, 8, 4), '#ff8a7a');   // the shine
      p.add(sphere(0.028, 10, 6), '#4caf50', T(-0.105, 0.095, 0, 0, 0, 0.5, [0.7, 1, 1]));
      p.add(tube([[-0.115, 0.1, 0], [-0.13, 0.125, 0], [-0.12, 0.145, 0]], 0.006, 6, 4), '#3a7a2a');
      flame3(p, 0.105, 0.0, 0, 0.3);
      break;
    }
    case 'ch_pretzel': { // a dark coal pretzel with glowing orange grains
      const c = '#4a2a22';
      p.add(torus(0.045, 0.016, 8, 20), c, T(-0.038, 0.085, 0, 0, 0, 0, [1, 1.1, 0.9]));
      p.add(torus(0.045, 0.016, 8, 20), c, T(0.038, 0.085, 0, 0, 0, 0, [1, 1.1, 0.9]));
      p.add(tube([[-0.07, 0.03, 0], [-0.02, 0.05, -0.006], [0.02, 0.05, -0.006], [0.07, 0.03, 0]], 0.016, 10, 8), c);
      for (const [x, y] of [[-0.07, 0.11], [-0.085, 0.06], [0.06, 0.12], [0.085, 0.07], [-0.02, 0.04], [0.03, 0.04], [0, 0.11]] as const) p.add(sphere(0.007, 6, 4), FIRE[1], T(x, y, -0.016));
      break;
    }
    case 'ch_bread': {   // a loaf with a black burnt crust, glowing slits, grey smoke
      p.add(new THREE.SphereGeometry(0.1, 18, 8, 0, Math.PI * 2, 0, Math.PI / 2), '#a0602a', T(0, 0, 0, 0, 0, 0, [1, 0.7, 0.62]));
      p.add(new THREE.SphereGeometry(0.101, 18, 5, 0, Math.PI * 2, 0, Math.PI * 0.3), '#2a1a1a', T(0, 0.003, 0, 0, 0, 0, [1, 0.7, 0.62]));
      for (const x of [-0.04, 0.01]) p.add(box(0.008, 0.032, 0.006), FIRE[1], T(x, 0.052, -0.052, -0.6, 0, -0.65));
      wisps(p, 0, 0.08, 0, '#7a6a6a', 0.06);
      break;
    }
    case 'ch_soda': {    // a yellow-green bottle, red cap, a dark label with a gold stripe, bubbles
      const pts: [number, number][] = [[0, 0], [0.045, 0], [0.047, 0.09], [0.04, 0.11], [0.02, 0.122], [0.02, 0.158], [0, 0.158]];
      p.add(new THREE.LatheGeometry(pts.map(([x, y]) => new THREE.Vector2(x, y)), 16), '#d8e83a');
      p.add(cyl(0.026, 0.026, 0.022, 12), '#c8102e', T(0, 0.168, 0));
      p.add(cyl(0.0485, 0.0485, 0.038, 16, true), INK, T(0, 0.054, 0));
      p.add(box(0.06, 0.007, 0.004), GOLD, T(0, 0.054, -0.049));
      for (const [x, y, r] of [[-0.018, 0.1, 0.007], [0.012, 0.088, 0.0095], [-0.004, 0.125, 0.006]] as const) p.add(sphere(r, 6, 4), '#fffbd0', T(x, y, -0.038, 0, 0, 0, [1, 1, 0.5]));
      break;
    }
    case 'ch_cheese': {  // a wedge, its top melting over the front edge in short drips, big holes
      p.add(slab([[-0.1, 0], [0.1, 0], [0.1, 0.1], [-0.1, 0.045]], 0.09), '#ffc83d');
      p.add(slab([[-0.1, 0.045], [0.1, 0.1], [0.1, 0.075], [-0.1, 0.028]], 0.094), '#ff9a2a', T(0, 0.001, 0));
      for (const [x, h] of [[-0.07, 0.016], [-0.03, 0.026], [0.015, 0.018], [0.055, 0.03]] as const) {
        const top = 0.028 + (x + 0.1) / 0.2 * 0.047;
        p.add(capsule(0.0105, h, 3, 8), '#ff9a2a', T(x, top - h / 2, -0.047));
      }
      for (const [x, y, r] of [[-0.05, 0.016, 0.012], [0.035, 0.022, 0.015], [0.075, 0.05, 0.009]] as const) p.add(sphere(r, 8, 6), '#d48a10', T(x, y, -0.046, 0, 0, 0, [1, 1, 0.3]));
      break;
    }
    case 'ch_pie': {     // a ruddy half-moon pie with a crimped seam, two tongues of fire
      p.add(new THREE.SphereGeometry(0.11, 18, 8, 0, Math.PI * 2, 0, Math.PI / 2), '#d97a2a', T(0, 0, 0, 0, 0, 0, [1, 0.62, 0.62]));
      p.add(tube([[-0.095, 0.03, -0.045], [-0.05, 0.052, -0.058], [0, 0.058, -0.062], [0.05, 0.052, -0.058], [0.095, 0.03, -0.045]], 0.006, 12, 4), '#8a3a10');
      flame3(p, -0.04, 0.055, 0.01, 0.3); flame3(p, 0.035, 0.058, 0.01, 0.38);
      break;
    }
    case 'ch_ham': {     // a dark smoked ham, a lighter cut line, the bone, a wisp of smoke
      p.add(sphere(0.085, 16, 12), '#8a2a1a', T(-0.02, 0.06, 0, 0, 0, 0.35, [1.15, 0.72, 0.8]));
      p.add(torus(0.055, 0.007, 4, 14, Math.PI * 0.9), '#c8523a', T(-0.025, 0.05, -0.064, 0, 0, 0.35));
      p.add(cyl(0.012, 0.012, 0.075, 8), CREAM, T(0.085, 0.085, 0, 0, 0, -0.95));
      for (const s of [-1, 1]) p.add(sphere(0.017, 8, 6), CREAM, T(0.118 + s * 0.008, 0.108 + s * 0.012, 0));
      wisps(p, -0.04, 0.12, 0, '#9a8a8a', 0.06);
      break;
    }
    case 'ch_skewer': {  // meat chunks on a devil's pitchfork, a little flame under them
      const a = 0.3;   // the shaft rises to the right
      const at = (u: number): [number, number, number] => [-0.12 + Math.cos(a) * u, 0.035 + Math.sin(a) * u, 0];
      const [sx, sy] = at(0.13);
      p.add(cyl(0.006, 0.006, 0.26, 6), '#5a4048', T(sx, sy, 0, 0, 0, a - Math.PI / 2));
      const [hx, hy] = at(0.26);
      p.add(box(0.008, 0.06, 0.008), INK, T(hx, hy, 0, 0, 0, a));
      for (const o of [-0.026, 0, 0.026]) { const dx = -Math.sin(a) * o, dy = Math.cos(a) * o; p.add(cyl(0.004, 0.004, 0.04, 5), INK, T(hx + dx + Math.cos(a) * 0.02, hy + dy + Math.sin(a) * 0.02, 0, 0, 0, a - Math.PI / 2)); }
      ([[0.055, '#a0402a'], [0.125, '#c8742a'], [0.195, '#a0402a']] as const).forEach(([u, c]) => { const [x, y] = at(u); p.add(box(0.05, 0.062, 0.05), c, T(x, y, 0, 0, 0, a)); });
      flame3(p, -0.01, 0.0, 0, 0.3);
      break;
    }
    case 'ch_ginger': {  // a gingerbread imp: horned head, iced edge, ink eyes and smile, a red pepper
      const c = '#c8742a', d = 0.026;
      p.add(slab([[-0.075, 0], [0.075, 0], [0.075, 0.1], [0.06, 0.125], [0.045, 0.16], [0.03, 0.128], [-0.03, 0.128], [-0.045, 0.16], [-0.06, 0.125], [-0.075, 0.1]], d, 0.006), c);
      p.add(tube([[-0.062, 0.012, -d / 2 - 0.006], [-0.062, 0.1, -d / 2 - 0.006], [-0.042, 0.118, -d / 2 - 0.006]], 0.004, 8, 4), '#fff3ea');
      p.add(tube([[0.062, 0.012, -d / 2 - 0.006], [0.062, 0.1, -d / 2 - 0.006], [0.042, 0.118, -d / 2 - 0.006]], 0.004, 8, 4), '#fff3ea');
      for (const s of [-1, 1]) p.add(sphere(0.009, 6, 4), INK, T(s * 0.025, 0.088, -d / 2 - 0.006, 0, 0, 0, [1, 1, 0.4]));
      p.add(torus(0.024, 0.004, 3, 10, Math.PI), INK, T(0, 0.064, -d / 2 - 0.006, 0, 0, Math.PI));
      p.add(capsule(0.009, 0.022, 3, 6), '#e8202e', T(0.01, 0.03, -d / 2 - 0.008, 0, 0, 1.2));
      break;
    }
    case 'ch_tea': {     // a little iron cauldron-mug of orange tea, a handle, steam
      p.add(cyl(0.07, 0.058, 0.11, 16), IRON, T(0, 0.055, 0));
      p.add(cyl(0.064, 0.064, 0.01, 16), '#b8702a', T(0, 0.108, 0));
      p.add(torus(0.07, 0.007, 4, 18), IRON_L, T(0, 0.11, 0, Math.PI / 2));
      p.add(torus(0.032, 0.008, 5, 12, Math.PI), IRON, T(0.068, 0.06, 0, 0, 0, -Math.PI / 2));
      for (let i = 0; i < 4; i++) p.add(box(0.012, 0.006, 0.004), FIRE[1], T(-0.03 + i * 0.02, 0.045, -0.066));
      wisps(p, 0, 0.12, 0);
      break;
    }
    case 'ch_stew': {    // a pot on legs, boiling red stew with bubbles and a bone, flames under it
      for (const [x, z] of [[-0.06, -0.03], [0.06, -0.03], [0, 0.06]] as const) p.add(cyl(0.008, 0.006, 0.05, 6), INK, T(x, 0.025, z));
      p.add(new THREE.SphereGeometry(0.1, 18, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), IRON, T(0, 0.13, 0, 0, 0, 0, [1, 0.85, 1]));
      p.add(torus(0.1, 0.009, 4, 22), IRON_L, T(0, 0.13, 0, Math.PI / 2));
      p.add(cyl(0.094, 0.094, 0.01, 18), '#e8402a', T(0, 0.126, 0));
      p.add(sphere(0.014, 6, 4), FIRE[1], T(-0.04, 0.132, -0.02)); p.add(sphere(0.01, 6, 4), FIRE[0], T(0.035, 0.132, -0.035));
      p.add(cyl(0.008, 0.008, 0.07, 6), CREAM, T(0.02, 0.155, 0.01, 0.2, 0, -0.6));
      for (const s of [-1, 1]) p.add(sphere(0.012, 6, 4), CREAM, T(0.02 + 0.03 * Math.sin(0.6) * s, 0.155 + 0.028 * s, 0.01 + 0.006 * s));
      flame3(p, -0.045, 0.0, -0.03, 0.26); flame3(p, 0.045, 0.0, -0.03, 0.26);
      break;
    }
    default: food(p, 'ch_bread');
  }
}

/* ------------------------------------------------------------------ «зелье жара» */
/** Small: a vial with a horned iron cork; big: a round flask; a flame inside (ember liquid; mana = blue). */
export function addChertsPotion(p: Parts, big: boolean, liquid: string): void { mirrored(p, () => potion(p, big, liquid)); }
function potion(p: Parts, big: boolean, liquid: string): void {
  if (big) {
    p.add(sphere(0.085, 18, 12), liquid, T(0, 0.085, 0, 0, 0, 0, [1, 0.95, 1]));
    p.add(cyl(0.024, 0.03, 0.05, 10), liquid, T(0, 0.18, 0));
    p.add(cyl(0.03, 0.03, 0.03, 10), IRON, T(0, 0.215, 0));
    flame3(p, 0, 0.035, -0.06, 0.55);
    for (const s of [-1, 1]) p.add(tube([[s * 0.022, 0.225, 0], [s * 0.04, 0.245, 0], [s * 0.045, 0.27, 0]], 0.008, 6, 5, 0.85), CREAM);
    p.add(sphere(0.02, 8, 6), '#ffffff', T(-0.045, 0.12, -0.065, 0, 0, 0.5, [0.5, 1, 0.3]));
  } else {
    const pts: [number, number][] = [[0, 0], [0.05, 0], [0.05, 0.065], [0.018, 0.1], [0.018, 0.13], [0, 0.13]];
    p.add(new THREE.LatheGeometry(pts.map(([x, y]) => new THREE.Vector2(x, y)), 12), liquid);
    p.add(cyl(0.024, 0.024, 0.026, 10), IRON, T(0, 0.142, 0));
    for (const s of [-1, 1]) p.add(tube([[s * 0.018, 0.152, 0], [s * 0.035, 0.17, 0], [s * 0.038, 0.19, 0]], 0.0065, 6, 5, 0.85), CREAM);
    flame3(p, 0, 0.012, -0.04, 0.33);
    p.add(box(0.008, 0.026, 0.004), '#ffffff', T(-0.032, 0.04, -0.049));
  }
}

/* ------------------------------------------------------------------ charred parchment */
/** A sheet with burnt ragged edges between two dark rollers, three lines of text, a red seal with a gold trident. */
export function addChertsScroll(p: Parts): void { mirrored(p, () => scroll(p)); }
function scroll(p: Parts): void {
  const rag: [number, number][] = [[-0.1, 0.16], [0.1, 0.16], [0.092, 0.137], [0.104, 0.112], [0.092, 0.08], [0.104, 0.048], [0.092, 0.024], [-0.1, 0.024], [-0.088, 0.048], [-0.104, 0.08], [-0.088, 0.112], [-0.104, 0.137]];
  p.add(slab(rag, 0.006), '#e8c890', T(0, 0, 0.004));
  // the charred rim: a slightly larger dark sheet just behind
  p.add(slab(rag.map(([x, y]) => [x * 1.05, 0.092 + (y - 0.092) * 1.07]), 0.004), '#5a2a10', T(0, 0, 0.008));
  for (const [y, w] of [[0.128, 0.11], [0.1, 0.09], [0.072, 0.1]] as const) p.add(box(w, 0.008, 0.003), '#7a3a1a', T(-0.012 - (0.11 - w) / 2, y, -0.0005));
  for (const s of [-1, 1]) {
    p.add(capsule(0.02, 0.15, 4, 10), '#3a2a22', T(s * 0.118, 0.095, 0));
  }
  p.add(cyl(0.032, 0.032, 0.008, 16), '#c8102e', T(0.045, 0.05, -0.006, Math.PI / 2, 0, 0));
  p.add(box(0.005, 0.034, 0.003), GOLD, T(0.045, 0.048, -0.011));
  for (const s of [-1, 1]) p.add(box(0.004, 0.016, 0.003), GOLD, T(0.045 + s * 0.013, 0.058, -0.011));
  p.add(box(0.03, 0.004, 0.003), GOLD, T(0.045, 0.05, -0.011));
}
