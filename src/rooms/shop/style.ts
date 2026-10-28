/**
 * Per-style looks of the 3D shop rooms (forge, tent/wardrobe, market rows), picked by the channel's art style
 * (RoomEnv.styleId = MDDoodle.active). Default = the fair look the rooms always had; 'cherts' = the site's
 * styles/cherts/fair.js interiors: «Пекельная кузня» (basalt blocks with lava cracks, cast-iron stands with lava lines and
 * gold rivets, a grate over lava, a horned furnace, coal bins), «Гардероб демона-франта» (black velvet and gold, bat-wing valance, red curtains) and «Пекельные ряды»
 * (charred parchment, iron shelves, fire colours). Colours derived from the site's code; geometry is ours.
 * Theme data + the extra cherts decor (static, merged into the room batch: no extra draw calls per piece).
 */
import * as THREE from 'three';
import type { RoomBase } from '../common/base';
import type { Look, Gear } from '../../contracts';

const INK = '#2a0d14', GOLD = '#ffc83d', LAVA = '#ff5a1a', IRON = '#3a3346', IRON_L = '#5a5470', RED = '#c8102e';
const FIRE = ['#ffe27a', '#ff9a2a', '#ff4a1a'];

export interface Keeper { name: string; look: Look; gear?: Gear; hello: string[]; lines: string[] }
export interface ForgeTheme {
  title?: string; bg: string; wall: 'brick' | 'stone' | 'plaster'; wallCol?: string; ceiling?: 'beams' | 'flat'; wainscot?: string; floorCol: string; ceilCol?: string; posts?: string;
  rug: [string, string]; accents: { bg: string; cloth: string; lamp: string }[]; board: string; trim: string;
  counter?: [string, string]; runner: string; hearth: [string, string]; lamp: string; bunting: string[]; lights?: string[]; shields: [string, string];
  keeper?: Keeper; cherts?: boolean;
}
export interface TentTheme {
  title?: string; bg: string; c1: string; c2: string; velvet: string; velvetD: string; gold: string; floor: string; rug: string; base: string;
  sign: { bg: string; fg: string }; dots: string[]; lamps: [string, string]; keeper?: Keeper; cherts?: boolean;
}
export interface RowsTheme {
  title?: string; bg: string; C: { wall: string; wains: string; wainsTop: string; floor: string; beam: string; timber: string; shelf: string; shelfBack: string; lip: string; counter: string; counterTop: string; awn1: string; awn2: string; awn3: string };
  runner: [string, string]; cloth: string; signs: { bg: string; fg: string }; menu: { bg: string; fg: string }; bunting: string[]; keeper?: Keeper; cherts?: boolean; wall: 'plaster' | 'stone';
}

/* ------------------------------------------------------------------ default (the fair) */
const FORGE_DEF: ForgeTheme = {
  bg: '#1a1218', wall: 'brick', floorCol: '#9a8a92', rug: ['#8a3a3a', '#c9884a'],
  accents: [
    { bg: '#7a1a2a', cloth: '#a3122a', lamp: '#ffd27a' }, { bg: '#1e4a7a', cloth: '#3a6aa8', lamp: '#ffe2a0' },
    { bg: '#2e5a2a', cloth: '#4f8a3a', lamp: '#ffd27a' }, { bg: '#6a3a14', cloth: '#c9884a', lamp: '#ffe2a0' },
    { bg: '#4a2a6e', cloth: '#7a4aa8', lamp: '#ffd27a' }, { bg: '#1a5a5a', cloth: '#2a8a8a', lamp: '#ffe2a0' },
  ],
  board: '#6a4a3a', trim: '#d9a066', runner: '#a3122a', hearth: ['#7a6a72', '#6a5a62'], lamp: '#ffcf6a',
  bunting: ['#a3122a', '#ffcf4a', '#3a6aa8', '#ffffff'], shields: ['#a3122a', '#3a6aa8'],
};
const TENT_DEF: TentTheme = {
  bg: '#24122e', c1: '#c06aa8', c2: '#ffe0ec', velvet: '#a3122a', velvetD: '#6e0c1e', gold: '#ffcf4a', floor: '#8a5a48', rug: '#7a2a5a', base: '#5a2a4a',
  sign: { bg: '#5a1a4a', fg: '#ffe39a' }, dots: ['#ffcf6a', '#ff8fa3', '#7fd6e6', '#b9a2ff'], lamps: ['#ffcf6a', '#ff8fa3'],
};
const ROWS_DEF: RowsTheme = {
  bg: '#1c1420', wall: 'plaster',
  C: {
    wall: '#f3dfbd', wains: '#3f8f8a', wainsTop: '#f7ecd2', floor: '#d29a62', beam: '#e8d0aa', timber: '#9a6a48',
    shelf: '#7fcbb5', shelfBack: '#f7e7c8', lip: '#ff8f7a', counter: '#7fb0e8', counterTop: '#f7ecd2',
    awn1: '#e0504a', awn2: '#fff3dc', awn3: '#3f8f8a',
  },
  runner: ['#fff3dc', '#e0504a'], cloth: '#e0504a', signs: { bg: '#3f8f8a', fg: '#fff3dc' }, menu: { bg: '#2a3a2e', fg: '#fff3dc' },
  bunting: ['#e0504a', '#ffcf4a', '#3f8f8a', '#ff8fa3', '#7fb0e8'],
};

/* ------------------------------------------------------------------ «Чертики» */
const FORGE_CH: ForgeTheme = {
  title: 'Пекельная кузня', bg: '#14040a', wall: 'plaster', wallCol: '#0e0306', ceiling: 'flat', wainscot: IRON, floorCol: '#2e262e', ceilCol: '#14060a', posts: IRON,
  rug: ['#4a0a18', GOLD],
  accents: [
    { bg: '#7a0f1d', cloth: RED, lamp: '#ff9a4a' }, { bg: '#2a2a34', cloth: '#5a5470', lamp: '#ffb46a' },
    { bg: '#3a1a0a', cloth: '#7a3a14', lamp: '#ff9a4a' }, { bg: '#4a1a5a', cloth: '#7a3ab3', lamp: '#ffb46a' },
    { bg: '#5a0a14', cloth: '#9a1a3a', lamp: '#ff9a4a' }, { bg: '#2a2028', cloth: '#4a2a32', lamp: '#ffb46a' },
  ],
  board: '#2a2028', trim: IRON_L, counter: [IRON, IRON_L], runner: RED, hearth: ['#4a3a46', '#3a2a34'], lamp: '#ff9a4a',
  bunting: [RED, GOLD, '#2a0d14', LAVA], lights: ['#ff9a4a', '#ffe27a', '#ff5a1a'], shields: [RED, '#2a2028'], cherts: true,
  keeper: {
    name: 'Кузнец пекла', look: { shape: 'box', color: '#c8102e', hat: 'bandana', acc: ['mustache'] } as Look, gear: { w: 'hammer' },
    hello: ['Заходи, бесёнок! Не стой в дверях - сквозняк.', 'О, покупатель! Добро пожаловать в пекло!', 'Входи, входи - горн как раз разогрет!'],
    lines: ['Куй железо, пока пекло горячо!', 'Вилы - не только для грешников!', 'Сковородка: и щит, и завтрак.', 'Цены честные. Почти. Мы же черти.', 'Всё раскалённое - руками не трогать!', 'Чугун - лучший друг рогатого.'],
  },
};
const TENT_CH: TentTheme = {
  title: 'Гардероб демона-франта', bg: '#14040a', c1: '#1a0610', c2: '#4a0c18', velvet: RED, velvetD: '#6a0a14', gold: '#f0a818', floor: '#2a1016', rug: '#4a0a18', base: '#2a2028',
  sign: { bg: '#2a0a14', fg: GOLD }, dots: ['#ff9a4a', GOLD, '#ff5a6a', '#ffe27a'], lamps: ['#ff9a4a', '#ff5a6a'], cherts: true,
  keeper: {
    name: 'Демон-франт', look: { hat: 'tophat', acc: ['monocle', 'bowtie', 'cape'], shape: 'tall', color: '#c8102e' } as Look,
    hello: ['Заходи, рогатик! Примерочные свободны.', 'О, какой хвост! Проходи, подберём что-нибудь дьявольское.', 'Входи! Выбирай кабинку - примерим на манекене.'],
    lines: ['Цилиндр на рога - классика пекла.', 'Мода проходит, а рога - вечны.', 'Не знаешь, что выбрать? Бабочка. Бабочка не подведёт.', 'Плащ: летать не научит, крылья и так есть.'],
  },
};
const ROWS_CH: RowsTheme = {
  title: 'Пекельные ряды', bg: '#14040a', wall: 'stone',
  C: {
    wall: '#3a1018', wains: IRON, wainsTop: '#5a5470', floor: '#3a2a2c', beam: '#2a1418', timber: '#2a2028',
    shelf: IRON_L, shelfBack: '#4a2a22', lip: '#b8340a', counter: '#2a0a14', counterTop: '#e8c890',
    awn1: RED, awn2: '#2a0d14', awn3: '#7a1a2a',
  },
  runner: ['#2a0d14', RED], cloth: RED, signs: { bg: '#2a0d14', fg: '#ffb43a' }, menu: { bg: '#c89a5a', fg: '#2a0d14' },
  bunting: [RED, GOLD, '#2a0d14', LAVA, '#ff9a2a'], cherts: true,
  keeper: {
    name: 'Повар пекла', look: { hat: 'chef', shape: 'ball', color: '#ff5a5a', acc: ['scarf'] } as Look,
    hello: ['Заходи, {n}! Адская кухня открыта.', 'Печёное яблоко? Жгучий перчик? Всё горячее!', 'Проголодался, рогатик? Выбирай!'],
    lines: ['Шашлык на вилах - фирменное блюдо.', 'Зелье жара лечит быстрее.', 'Серная газировка - освежает!'],
  },
};

export const forgeTheme = (styleId: string): ForgeTheme => (styleId === 'cherts' ? FORGE_CH : FORGE_DEF);
export const tentTheme = (styleId: string): TentTheme => (styleId === 'cherts' ? TENT_CH : TENT_DEF);
export const rowsTheme = (styleId: string): RowsTheme => (styleId === 'cherts' ? ROWS_CH : ROWS_DEF);

/* ------------------------------------------------------------------ cherts decor */
/** Glowing lava cracks across a wall: emissive strips in zig-zag. Wall frame: along u = (cos f, 0, −sin f), normal
 *  n = (sin f, 0, cos f); the wall plane is at signed distance zw along n (f = 0: the back wall z = zw). */
export function lavaCracks(R: RoomBase, x0: number, x1: number, y0: number, y1: number, zw: number, seed = 1, n = 4, face = 0): void {
  const K = R.kit;
  let s = seed * 9301 + 49297;
  const rnd = () => ((s = (s * 9301 + 49297) % 233280) / 233280);
  for (let c = 0; c < n; c++) {
    let x = x0 + (x1 - x0) * ((c + 0.2 + rnd() * 0.6) / n), y = y1 - rnd() * 0.3;
    for (let k = 0; k < 6 && y > y0; k++) {
      const nx = x + (rnd() - 0.5) * 0.7, ny = Math.max(y0 - 0.1, y - 0.2 - rnd() * 0.3), len = Math.hypot(nx - x, ny - y), a = Math.atan2(ny - y, nx - x);
      const mx = (x + nx) / 2, my = (y + ny) / 2;
      // along the wall: a local frame (face = rotation about Y; 0 = the wall plane z = zw)
      // each segment a little prouder than the last (towards the room): overlapping joints never share a plane
      const zk = zw - Math.sign(zw) * k * 0.018;
      const cx = Math.cos(face) * mx + Math.sin(face) * zk, cz = -Math.sin(face) * mx + Math.cos(face) * zk;
      const wd = 0.075 - k * 0.008;   // the crack narrows as it runs down
      K.rbox('back', '#0a0204', cx, my, cz, len + 0.08, wd + 0.05, 0.01, face, 0, a);    // charred rim
      if (k % 2 === 0) K.glow(cx + 0.06 * Math.sin(face), my, cz + 0.06 * Math.cos(face), 0.7 + len, '#ff5a1a', 0.5 - k * 0.06);
      // the site's crack: a lava stroke (#ff5a1a) with a thin yellow core (#ffe27a); fronts 6 mm apart
      K.rbox('emit', k % 2 ? '#d8400c' : '#c8360a', cx, my, cz, len + 0.04, wd, 0.022, face, 0, a);
      K.rbox('emit', '#ffc84a', cx, my, cz, len, wd * 0.32, 0.034, face, 0, a);
      x = nx; y = ny;
    }
  }
}
/** A pitchfork (shaft + three tines) leaning at angle `tilt` (rad about Z) against a wall plane z = zw. */
export function pitchfork(R: RoomBase, x: number, y: number, z: number, tilt: number, len = 1.7): void {
  const K = R.kit, m = (lx: number, ly: number): [number, number] => [x + Math.cos(tilt) * lx - Math.sin(tilt) * ly, y + Math.sin(tilt) * lx + Math.cos(tilt) * ly];
  const [sx, sy] = m(0, len / 2);
  K.rbox('wood', '#5a2a1a', sx, sy, z, 0.05, len, 0.05, 0, 0, tilt);
  const [bx, by] = m(0, len);
  K.rbox('metal', '#9aa0b4', bx, by, z, 0.34, 0.04, 0.04, 0, 0, tilt);
  for (const lx of [-0.15, 0, 0.15]) { const h = lx ? 0.26 : 0.34, [tx, ty] = m(lx, len + h / 2); K.rbox('metal', '#9aa0b4', tx, ty, z, 0.035, h, 0.024, 0, 0, tilt); const [px, py] = m(lx, len + h + 0.03); K.rbox('metal', '#c8ccd4', px, py, z, 0.06, 0.06, 0.05, 0, 0, tilt + Math.PI / 4); }
}
/** Golden horns on a block's top corners (cases, the furnace). */
export function goldHorns(R: RoomBase, x: number, y: number, z: number, span: number, h = 0.32): void {
  const K = R.kit;
  for (const s of [-1, 1]) {
    const g = new THREE.ConeGeometry(0.07, h, 8);
    K.geo('metal', g, new THREE.Matrix4().compose(new THREE.Vector3(x + s * span, y + h * 0.42, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, -s * 0.5)), new THREE.Vector3(1, 1, 0.8)), GOLD); g.dispose();
  }
}
/** The horned furnace (forge): an iron block with cream horns, a fiery toothed mouth above the counter, two fire eyes. */
export function hornedFurnace(R: RoomBase, x: number, z: number, w: number, h: number): void {
  const K = R.kit, m0 = h * 0.42, m1 = h * 0.76;
  K.box('metal', '#4a3a46', x - w / 2, x + w / 2, 0, h, z, z + 0.55);
  K.box('metal', IRON_L, x - w / 2 - 0.05, x + w / 2 + 0.05, h - 0.12, h + 0.03, z, z + 0.62);
  for (const s of [-1, 1]) for (const yy of [0.3, h * 0.6, h - 0.25]) K.ball('metal', GOLD, x + s * (w / 2 - 0.12), yy, z + 0.56, 0.04);
  K.box('emit', '#ff6a1a', x - w * 0.34, x + w * 0.34, m0, m1, z + 0.55, z + 0.57);
  K.box('emit', FIRE[0], x - w * 0.2, x + w * 0.2, m0 + 0.05, m0 + (m1 - m0) * 0.5, z + 0.57, z + 0.58);
  for (let i = 0; i < 7; i++) {   // teeth along the top of the mouth
    const tx = x - w * 0.3 + (i * w * 0.6) / 6, g = new THREE.ConeGeometry(0.06, 0.16, 4);
    K.geo('plaster', g, new THREE.Matrix4().compose(new THREE.Vector3(tx, m1 - 0.07, z + 0.58), new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI, 0, 0)), new THREE.Vector3(1, 1, 0.4)), '#f3e6c8'); g.dispose();
  }
  for (const s of [-1, 1]) {
    K.ball('back', INK, x + s * w * 0.24, h * 0.88, z + 0.48, 0.17);   // ink rim, the fire eye proud of it, a pupil
    K.ball('emit', FIRE[0], x + s * w * 0.24, h * 0.88, z + 0.6, 0.14);
    K.ball('back', INK, x + s * w * 0.24, h * 0.87, z + 0.74, 0.05);
    K.glow(x + s * w * 0.24, h * 0.88, z + 0.8, 0.6, '#ffb43a', 0.7);
    const g = new THREE.ConeGeometry(0.17, 0.9, 10);
    K.geo('plaster', g, new THREE.Matrix4().compose(new THREE.Vector3(x + s * (w / 2 - 0.02), h + 0.36, z + 0.3), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, -s * 0.55)), new THREE.Vector3(1, 1, 0.8)), '#f3e6c8'); g.dispose();
  }
  K.glow(x, (m0 + m1) / 2, z + 0.7, 1.6, '#ff7a2a', 0.8);
  K.light(x, (m0 + m1) / 2, z + 1.1, '#ff7a2a', 7, 7, 0, 3);
  K.splash(x, 0.02, z + 1.6, 3.0, 2.0, '#ff6a2a', 0.35, 0, -Math.PI / 2);
}
/** Bat-wing valance: scalloped flaps along a circle (tent wall top) or a straight edge, alternating black / red. */
export function batWingRing(R: RoomBase, r: number, y: number, n: number, gap: number, cols: [string, string]): void {
  const K = R.kit;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2; if (Math.abs(Math.atan2(Math.sin(a), Math.cos(a))) < gap) continue;
    // one bat-wing flap: a panel with two scallops cut out of its lower edge, three points hanging down
    const w = (2 * Math.PI * r) / n * 0.55, pts: THREE.Vector2[] = [new THREE.Vector2(-w, 0), new THREE.Vector2(w, 0), new THREE.Vector2(w, -0.42)];
    for (let k = 1; k <= 8; k++) { const t = k / 8; pts.push(new THREE.Vector2(w - t * w, -0.42 + Math.sin(t * Math.PI) * 0.2)); }
    for (let k = 1; k <= 8; k++) { const t = k / 8; pts.push(new THREE.Vector2(-t * w, -0.34 + Math.sin(t * Math.PI) * 0.2 - (k === 8 ? 0.08 : 0))); }
    const g = new THREE.ShapeGeometry(new THREE.Shape(pts));
    K.geo('canvas', g, new THREE.Matrix4().compose(new THREE.Vector3(Math.sin(a) * (r - 0.08), y, Math.cos(a) * (r - 0.08)), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, a + Math.PI, 0)), new THREE.Vector3(1, 1, 1)), cols[i % 2]); g.dispose();
  }
}
/** Iron grate over lava (floor): glowing slots between iron bars, in a rectangle. */
export function lavaGrate(R: RoomBase, x0: number, x1: number, z0: number, z1: number): void {
  const K = R.kit;
  K.floorBox('emit', '#6a1c06', x0, x1, z0, z1);
  for (let i = 0; i < 5; i++) K.glow(x0 + (x1 - x0) * (0.15 + 0.7 * ((i * 0.61) % 1)), 0.05, z0 + (z1 - z0) * ((i + 0.5) / 5), 0.6, '#ff7a2a', 0.4);
  // bars a little past the lava's edges (no shared side faces), the outermost ones overlapping the rim
  for (let x = x0; x <= x1 + 1e-6; x += 0.3) K.box('metal', IRON, x - 0.045, x + 0.045, 0.004, 0.03, z0 - 0.02, z1 + 0.02);
  for (let z = z0; z <= z1 + 1e-6; z += 0.3) K.box('metal', IRON, x0 - 0.02, x1 + 0.02, 0.004, 0.034, z - 0.045, z + 0.045);
}
/**
 * The wardrobe's gold (site: gold rims on the sign, the mirror, the shelves, a gold dashed line along the carpet):
 * gold pinstripes between the velvet panels of the tent wall, gold studs under the bat-wing valance, a gold dashed
 * ring round the carpet. Polished 'metal' so it catches the lamps.
 */
export function chertsTentGold(R: RoomBase, rad: number, wall: number, gap: number, gold: string): void {
  const K = R.kit, skip = (a: number) => Math.abs(Math.atan2(Math.sin(a), Math.cos(a))) < gap + 0.04;
  for (let i = 0; i < 24; i++) {   // the stripe seams of the wall (24 stripes)
    const a = (i / 24) * Math.PI * 2 + Math.PI; if (skip(a)) continue;
    K.rbox('metal', gold, Math.sin(a) * (rad - 0.035), wall * 0.42, Math.cos(a) * (rad - 0.035), 0.035, wall * 0.78, 0.012, a);
  }
  for (let i = 0; i < 28; i++) {   // studs just under the valance's gold ring
    const a = (i / 28) * Math.PI * 2 + 0.11; if (skip(a)) continue;
    K.ball('emit', '#ffc83d', Math.sin(a) * (rad - 0.09), wall - 0.5, Math.cos(a) * (rad - 0.09), 0.035);
  }
  for (let i = 0; i < 40; i++) {   // gold dashes round the carpet
    const a = (i / 40) * Math.PI * 2, r = 3.06;
    K.rbox('emit', '#c88a18', Math.sin(a) * r, 0.032, Math.cos(a) * r, 0.24, 0.006, 0.05, a + Math.PI / 2);
  }
}
/** An iron-bound bin of glowing coals (cherts forge, instead of the fair's crates). */
export function coalBin(R: RoomBase, x: number, z: number): void {
  const K = R.kit;
  K.box('metal', IRON, x - 0.32, x + 0.32, 0, 0.5, z - 0.28, z + 0.28);
  for (const y of [0.08, 0.42]) K.box('metal', IRON_L, x - 0.335, x + 0.335, y, y + 0.05, z - 0.295, z + 0.295);
  for (let i = 0; i < 7; i++) K.ball(i % 3 ? 'stone' : 'emit', i % 3 ? '#1a1418' : (i % 2 ? '#ff5a1a' : '#ffb347'), x - 0.2 + (i % 4) * 0.13, 0.52, z - 0.12 + (i >> 2) * 0.2, 0.09, 0.7);
  K.glow(x, 0.62, z, 0.8, '#ff7a2a', 0.6);
  K.solid(x - 0.34, x + 0.34, z - 0.3, z + 0.3, 0.55);
}
/**
 * Basalt blocks over a wall (the site's wall: big dark blocks in running bond, a gradient from #3a1218 at the top to
 * #140407 at the floor): thin slabs a few mm proud of a near-black wall, the gaps between them read as the joints.
 * Same wall frame as lavaCracks (face = rotation about Y, zw = the wall's own plane). Cracks go on top (≥ 2.5 cm out).
 */
export function basaltWall(R: RoomBase, x0: number, x1: number, y0: number, y1: number, zw: number, face = 0, seed = 1, skip?: [number, number, number, number]): void {
  const K = R.kit, bw = 0.92, bh = 0.44, gap = 0.035, top = new THREE.Color('#34101a'), bot = new THREE.Color('#16050a'), c = new THREE.Color();
  let s = seed * 7919 + 17;
  const rnd = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
  const zc = zw - Math.sign(zw || 1) * 0.003;   // 1–5 mm off the wall plane `zw`
  for (let row = 0, y = y0; y < y1 - 0.05; row++, y += bh) {
    const ya = y + gap / 2, yb = Math.min(y1, y + bh) - gap / 2, off = row % 2 ? bw / 2 : 0;
    for (let x = x0 - off - 0.0113; x < x1; x += bw) {   // joints off the round numbers other pieces' edges sit on
      const xa = Math.max(x0, x) + gap / 2, xb = Math.min(x1, x + bw) - gap / 2;
      if (xb - xa < 0.08) continue;
      if (skip && xb > skip[0] && xa < skip[1] && yb > skip[2] && ya < skip[3]) continue;   // behind a big piece (the furnace)
      c.copy(bot).lerp(top, Math.min(1, (ya + yb) / 2 / 3.9)).multiplyScalar(0.88 + rnd() * 0.24);
      const mx = (xa + xb) / 2, cx = Math.cos(face) * mx + Math.sin(face) * zc, cz = -Math.sin(face) * mx + Math.cos(face) * zc;
      K.rbox('plaster', c.getHex(), cx, (ya + yb) / 2, cz, xb - xa, yb - ya, 0.004, face);
    }
  }
}
