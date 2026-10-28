/**
 * «Кузня» / «Лавка звездочёта» interiors: stands per class like the site (stand title, top row = weapons, middle shelf =
 * shields / hats, case = armour / charms), the keeper behind a counter with the enchant materials, hearth or star dome.
 */
import * as THREE from 'three';
import type { RoomBase } from '../common/base';
import { standsOf, type ShopStock } from '../common/stock';
import { Frame, stand, counter, COUNTER_TOP, DAIS } from './furniture';
import { shade } from '../../world/kit';
import { M } from '../../world/batch';
import { basaltWall, coalBin, forgeTheme, lavaCracks, pitchfork, hornedFurnace, goldHorns, lavaGrate } from './style';
import { dot, bunting, stringLights, wallLamp, cloth, candle, basket, potPlant, books, painting, sack, hanging } from '../common/decor';

/** Per-stand accents (sign plate, lamp tint, plinth cloth) so the walls read as different class corners. */
const ACCENT = [
  { bg: '#7a1a2a', cloth: '#a3122a', lamp: '#ffd27a' }, { bg: '#1e4a7a', cloth: '#3a6aa8', lamp: '#ffe2a0' },
  { bg: '#2e5a2a', cloth: '#4f8a3a', lamp: '#ffd27a' }, { bg: '#6a3a14', cloth: '#c9884a', lamp: '#ffe2a0' },
  { bg: '#4a2a6e', cloth: '#7a4aa8', lamp: '#ffd27a' }, { bg: '#1a5a5a', cloth: '#2a8a8a', lamp: '#ffe2a0' },
];

const W = 10.4, D = 8.4, H = 3.9;
/** Round wall shield (disc facing +Z). */
const SHIELD = new THREE.CylinderGeometry(0.3, 0.3, 0.06, 16).rotateX(Math.PI / 2);

/** Wall slots for stands, in fill order: back-left, back-right, left, right, left-front, right-front. */
function slots(): Frame[] {
  return [new Frame(-3.35, -D / 2, 0), new Frame(3.35, -D / 2, 0), new Frame(-W / 2, -0.7, Math.PI / 2), new Frame(W / 2, -0.7, -Math.PI / 2), new Frame(-W / 2, 2.35, Math.PI / 2), new Frame(W / 2, 2.35, -Math.PI / 2)];
}

export function buildForge(R: RoomBase, st: ShopStock | null, b: 'forge' | 'magic'): void {
  const K = R.kit, P = R.pal, magic = b === 'magic';
  // the forge's look per art style (cherts: «Пекельная кузня»); the star shop keeps its own
  const Th = forgeTheme(magic ? '' : R.env.styleId), ch = !!Th.cherts;
  R.bg = magic ? '#171230' : Th.bg;
  const wallCol = magic ? '#4a3a78' : Th.wallCol || P.brick;
  K.shell({ w: W, d: D, h: H, wall: magic ? 'plaster' : Th.wall, wallCol, wainscot: magic ? '#3a2a5e' : Th.wainscot || P.woodD, floor: magic ? 'wood' : 'lowPaving', floorCol: magic ? '#6e4a3a' : Th.floorCol, ceiling: magic ? 'beams' : Th.ceiling || 'beams', ceilCol: magic ? '#2a2048' : Th.ceilCol || P.woodD });
  // timber posts at corners
  K.posts([-W / 2 + 0.1, W / 2 - 0.1], -D / 2 + 0.1, H, magic ? '#2a2048' : Th.posts || P.timber, 0.2);
  // rug (cherts: an iron grate over glowing lava instead)
  if (ch) lavaGrate(R, -1.1, 1.1, -0.9, 2.6);
  else K.rug(-1.1, 1.1, -0.9, 2.6, magic ? '#5a3a8a' : Th.rug[0], magic ? '#ffcf4a' : Th.rug[1]);

  // stands from the stock
  const S = standsOf(st), F = slots();
  S.slice(0, F.length).forEach((s, i) => {
    const A = (ch ? Th.accents : ACCENT)[i % ACCENT.length];
    stand(R, F[i], s, { b, w: 2.5, board: magic ? '#3a2e66' : Th.board, trim: magic ? '#9a7ad8' : Th.trim, sign: magic ? { bg: '#3a2a6e', fg: '#ffe39a' } : { bg: A.bg, fg: '#ffe9b0' }, lamp: magic ? '#d8c8ff' : A.lamp, cloth: magic ? ['#5a3a8a', '#2a4a8a', '#7a2a6a'][i % 3] : A.cloth, iron: ch ? { lava: '#c83a0c', rivet: '#ffc83d' } : undefined });
  });
  const used = Math.min(S.length, F.length);

  // keeper area: hearth (forge) or crystal alcove (magic) at the back centre, counter in front
  if (ch) {
    // «Пекельная кузня»: the horned furnace mouth at the back, lava cracks in the basalt, pitchforks on the walls
    hornedFurnace(R, 0, -D / 2, 3.0, 2.75);
    K.box('metal', '#3a3346', -0.45, 0.45, 2.75, H, -D / 2, -D / 2 + 0.5); K.box('metal', '#ffc83d', -0.47, 0.47, 2.9, 2.96, -D / 2, -D / 2 + 0.52);
    // basalt blocks on the walls (the near-black wall shows as the joints), lava cracks where the walls show
    basaltWall(R, -W / 2, W / 2, 0.96, H, -D / 2, 0, 1, [-1.6, 1.6, 0, 2.85]);
    basaltWall(R, -D / 2 + 0.05, D / 2, 0.96, H, -W / 2, Math.PI / 2, 2); basaltWall(R, -D / 2, D / 2 - 0.05, 0.96, H, -W / 2, -Math.PI / 2, 3);
    // lava cracks where the walls show: above the stands (back and side walls)
    lavaCracks(R, -W / 2 + 0.3, W / 2 - 0.3, 2.7, H - 0.05, -D / 2 + 0.04, 3, 8);
    lavaCracks(R, -2.6, 3.8, 2.7, H - 0.05, -W / 2 + 0.025, 5, 4, Math.PI / 2); lavaCracks(R, -3.8, 2.6, 2.7, H - 0.05, -(W / 2 - 0.025), 6, 4, -Math.PI / 2);
    for (const [x, t] of [[-1.8, -0.02], [1.8, 0.02]] as const) pitchfork(R, x, 0, -D / 2 + 0.12, t, 1.9);
    K.solid(-1.55, 1.55, -D / 2, -D / 2 + 0.65, Infinity);
    K.prop('anvil', 1.9, 0, -2.75, -0.5, 0.95);
    // a cauldron of coals instead of the quench barrel
    K.cyl('metal', '#2a2028', -1.75, 0, -3.45, 0.32, 0.5, 16); for (let i = 0; i < 6; i++) K.ball('emit', i % 2 ? '#ff5a1a' : '#ffb347', -1.75 + Math.cos(i) * 0.15, 0.5, -3.45 + Math.sin(i) * 0.15, 0.09, 0.6);
    K.glow(-1.75, 0.65, -3.45, 0.9, '#ff7a2a', 0.8); K.solid(-2.1, -1.4, -3.8, -3.1, 0.5);
  } else if (!magic) {
    // hearth: stone block, fire pit, hood, chimney
    K.box('stone', '#7a6a72', -1.15, 1.15, 0, 0.95, -D / 2, -D / 2 + 1.0);
    K.box('emit', '#ff7a2a', -0.8, 0.8, 0.95, 1.0, -D / 2 + 0.15, -D / 2 + 0.85);
    for (let i = 0; i < 7; i++) K.ball('emit', i % 2 ? '#ffb347' : '#ff5a1a', -0.6 + i * 0.2, 1.0, -D / 2 + 0.3 + (i % 3) * 0.2, 0.09, 0.6);
    K.box('stone', '#6a5a62', -1.25, 1.25, 1.7, 1.95, -D / 2, -D / 2 + 1.1);
    K.geo('stone', new THREE.CylinderGeometry(0.5, 1.15, 1.0, 4, 1).rotateY(Math.PI / 4), new THREE.Matrix4().compose(new THREE.Vector3(0, 2.45, -D / 2 + 0.55), new THREE.Quaternion(), new THREE.Vector3(1.4, 1, 0.75)), '#6a5a62');
    K.box('stone', '#6a5a62', -0.4, 0.4, 2.9, H, -D / 2, -D / 2 + 0.75);
    K.box('wood', P.woodD, -1.2, 1.2, 0.95, 1.7, -D / 2, -D / 2 + 0.07);
    const fire = K.light(0, 1.35, -D / 2 + 0.9, '#ff8a3a', 9, 8, 2.2, 3);
    K.splash(0, 1.3, -D / 2 + 1.02, 3.2, 2.2, '#ff8a3a', 0.35);
    K.splash(0, 0.02, -D / 2 + 1.9, 3.4, 2.2, '#ff8a3a', 0.3, 0, -Math.PI / 2);
    { const base = fire.intensity; R.onUpdate((_dt, t) => { fire.intensity = base * (0.85 + 0.1 * Math.sin(t * 13) * Math.sin(t * 5.3) + 0.05 * Math.sin(t * 31)); }); }
    // tools hanging on the hood: tongs, hammers, a horseshoe garland
    for (let i = 0; i < 5; i++) { const x = -0.95 + i * 0.47; K.box('metal', '#3a3440', x - 0.012, x + 0.012, 1.25, 1.62, -D / 2 + 0.07, -D / 2 + 0.1); K.box(i % 2 ? 'wood' : 'metal', i % 2 ? '#8a5a2b' : '#9aa2ac', x - 0.05, x + 0.05, 1.1, 1.3, -D / 2 + 0.076, -D / 2 + 0.12); }
    // bellows by the hearth, quench bucket, coal sack, grindstone
    K.rbox('wood', '#8a4a2a', 1.55, 0.55, -D / 2 + 0.6, 0.5, 0.18, 0.7, 0.3); K.rbox('canvas', '#5a3a2a', 1.55, 0.45, -D / 2 + 0.6, 0.42, 0.14, 0.6, 0.3);
    K.cyl('wood', '#7a5a3a', -1.55, 0, -D / 2 + 1.5, 0.24, 0.42, 12); K.cyl('water', '#3a5a8a', -1.55, 0.38, -D / 2 + 1.5, 0.21, 0.02, 12); K.solid(-1.8, -1.3, -D / 2 + 1.25, -D / 2 + 1.75, 0.42);
    sack(K, 1.5, -D / 2 + 1.45, '#3a3440', 0.8);
    K.cyl('stone', '#9a929e', W / 2 - 0.9, 0.45, D / 2 - 1.6, 0.32, 0.12, 16);

    K.solid(-1.25, 1.25, -D / 2, -D / 2 + 1.1, Infinity);
    // anvil + tools
    K.prop('anvil', 1.9, 0, -2.75, -0.5, 0.95);
    K.prop('barrel', -1.75, 0, -3.45, 0, 0.9);
    K.box('metal', P.metal, -1.95, -1.55, 0.86, 0.9, -3.6, -3.3);
  } else {
    // star alcove: dark arch with a crystal ball on a pedestal, starry ceiling glows
    K.box('plaster', '#2a2048', -1.3, 1.3, 0, 2.8, -D / 2, -D / 2 + 0.3);
    K.box('emit', '#1c1a44', -1.0, 1.0, 0.4, 2.5, -D / 2 + 0.3, -D / 2 + 0.32);
    for (let i = 0; i < 14; i++) { const a = i * 2.4; K.ball('emit', i % 3 ? '#fff3c4' : '#b9a2ff', Math.cos(a) * 0.8 * ((i % 5) / 5 + 0.2), 1.0 + (i * 0.37 % 1.4), -D / 2 + 0.33, 0.025); }
    K.cyl('stone', '#5a4a7a', 0, 0, -D / 2 + 0.9, 0.22, 0.85, 12);
    K.ball('emit', '#9fb6ff', 0, 1.08, -D / 2 + 0.9, 0.22);
    K.glow(0, 1.08, -D / 2 + 0.9, 1.6, '#9fb6ff', 1);
    K.light(0, 1.4, -D / 2 + 1.0, '#a08aff', 6, 7, 0, 3);
    K.splash(0, 1.4, -D / 2 + 0.36, 2.8, 2.4, '#9f8aff', 0.45);
    // starry ceiling + crescent moon, crystal clusters, potion shelf, books
    for (let i = 0; i < 46; i++) { const a = (i * 137.5) * Math.PI / 180, r = Math.sqrt(i / 46); dot(K, Math.cos(a) * r * (W / 2 - 0.4), H - 0.03, Math.sin(a) * r * (D / 2 - 0.4), 0.025 + (i % 3) * 0.01, i % 4 ? '#fff3c4' : '#b9a2ff'); }
    K.ball('emit', '#fff3c4', 2.6, H - 0.15, 1.6, 0.26); K.ball('plaster', '#2a2048', 2.72, H - 0.13, 1.66, 0.24);
    for (const [cx, cz] of [[-W / 2 + 0.45, D / 2 - 1.3], [W / 2 - 0.45, D / 2 - 1.4]] as const) for (let i = 0; i < 5; i++) { const a = i * 1.26; K.cone('emit', i % 2 ? '#9fb6ff' : '#d89aff', cx + Math.cos(a) * 0.12, 0, cz + Math.sin(a) * 0.12, 0.07, 0.35 + (i % 3) * 0.15); }
    K.glow(-W / 2 + 0.45, 0.4, D / 2 - 1.3, 1.0, '#b9a2ff', 0.7); K.glow(W / 2 - 0.45, 0.4, D / 2 - 1.4, 1.0, '#9fb6ff', 0.7);

    K.solid(-1.3, 1.3, -D / 2, -D / 2 + 1.15, Infinity);
    // floating candles
    for (let i = 0; i < 8; i++) {
      const x = -3.5 + i, z = -0.5 + (i % 2) * 1.6, y = 2.7 + (i % 3) * 0.2;
      K.cyl('back', '#f7ead0', x, y, z, 0.035, 0.18, 8); K.ball('emit', '#ffcf6a', x, y + 0.23, z, 0.03, 1.5); K.glow(x, y + 0.24, z, 0.5, '#ffcf6a', 0.8);
    }
  }
  // counter with the enchant materials
  const C = new Frame(0, -D / 2, 0);
  counter(R, C, -1.5, 1.5, 1.85, 2.4, magic ? '#3a2a6e' : Th.counter ? Th.counter[0] : P.wood, magic ? '#8a6ac8' : Th.counter ? Th.counter[1] : P.woodL, ch ? 'metal' : 'wood');
  if (ch) {   // the iron counter: golden horns on its corners, a lava slot along the front, gold rivets
    goldHorns(R, C.x(0, 2.12), COUNTER_TOP, C.z(0, 2.12), 1.45, 0.26);
    K.box('emit', '#c8340a', -1.45, 1.45, COUNTER_TOP * 0.55 - 0.025, COUNTER_TOP * 0.55 + 0.025, -D / 2 + 2.4, -D / 2 + 2.415);
    for (const x of [-1.3, 0, 1.3]) for (const y of [0.25, COUNTER_TOP - 0.15]) K.ball('metal', '#ffc83d', x, y, -D / 2 + 2.41, 0.03);
  }
  const mats = (st && st.mats) || [];
  mats.slice(0, 4).forEach((it, i) => {
    const lx = -0.9 + i * 0.6;
    R.good(it, b, { x: C.x(lx, 2.1), y: COUNTER_TOP, z: C.z(lx, 2.1), fit: 0.32 }, [C.x(lx, 2.47), COUNTER_TOP - 0.1, C.z(lx, 2.47), 0, -0.3]);
  });
  // runner, ledger, candle, coin pile, scales on the counter
  cloth(K, -1.5, 1.5, -D / 2 + 1.85, -D / 2 + 2.4, COUNTER_TOP + 0.001, magic ? '#5a3a8a' : Th.runner, 0.12, '#ffcf4a');
  K.box('back', magic ? '#2a4a8a' : '#3a6aa8', 1.0, 1.35, COUNTER_TOP + 0.013, COUNTER_TOP + 0.06, -D / 2 + 1.95, -D / 2 + 2.2);
  candle(K, -1.3, COUNTER_TOP + 0.013, -D / 2 + 2.1);
  for (let i = 0; i < 6; i++) K.cyl('metal', '#ffcf4a', 1.25 + (i % 2) * 0.04, COUNTER_TOP + 0.013 + i * 0.012, -D / 2 + 2.3, 0.035, 0.011, 8);

  // keeper
  const kz = -D / 2 + 1.45;
  if (Th.keeper) R.npc({ seed: 'кузнец', name: Th.keeper.name, x: 0.2, z: kz, y: DAIS, scale: 1.1, face: Math.PI, look: Th.keeper.look, gear: Th.keeper.gear, hello: Th.keeper.hello, lines: Th.keeper.lines, emote: { anim: 'swing', every: 7 } });
  else if (!magic) R.npc({ seed: 'кузнец', name: 'Кузнец', x: 0.2, z: kz, y: DAIS, scale: 1.1, face: Math.PI, look: { shape: 'box', color: '#c9884a', hat: 'cap', acc: ['mustache'] }, gear: { w: 'hammer' },
    hello: ['Заходи, не стой на пороге — железо стынет!', 'О, покупатель! Добро пожаловать в Кузню!', 'Оружие — на стойках, доспехи — на манекенах.'],
    lines: ['Звезда к удаче, сфера — от поломки.', 'Точить — у наковальни на улице.', 'Хороший клинок сам себя не продаст!'], emote: { anim: 'swing', every: 7 } });
  else R.npc({ seed: 'звездочёт', name: 'Звездочёт', x: 0.25, z: kz, y: DAIS, scale: 1.1, face: Math.PI, look: { hat: 'wizard', acc: ['glasses'], shape: 'ball', color: '#b9a2ff' },
    hello: ['Звёзды сказали, что ты придёшь.', 'Заходи! Только не урони хрустальный шар.', `Добро пожаловать в ${R.env.building.title || 'Лавку звездочёта'}!`],
    lines: ['Посох выбирает мага.', 'Амулет на удачу — проверено.', 'Сфера бережёт вещь. А я берегу сферы.'], emote: { anim: 'cheer', every: 11 } });

  // decor: free wall slots get barrels / crates / a window
  for (let i = used; i < F.length; i++) {
    const f = F[i];
    if (i >= 4) { K.window(f.ry > 0 ? 'left' : 'right', f.oz, 1.1, 1.2, 1.3, magic ? '#2a2a6e' : '#2a2f6e'); continue; }
    if (ch) coalBin(R, f.x(-0.5, 0.45), f.z(-0.5, 0.45)); else K.prop(magic ? 'chest' : 'crate', f.x(-0.5, 0.45), 0, f.z(-0.5, 0.45), f.ry, 0.9);
    K.prop('barrel', f.x(0.6, 0.45), 0, f.z(0.6, 0.45), 0, 0.85);
  }
  // corners near the door: a barrel of swords / a chest of scrolls, a crate with a basket, a plant
  K.prop(magic ? 'chest' : 'barrel', -W / 2 + 0.55, 0, D / 2 - 0.6, 0.3, 0.85);
  if (!magic) for (let i = 0; i < 4; i++) { const a = i * 1.6; K.rbox('metal', '#c4cad3', -W / 2 + 0.55 + Math.cos(a) * 0.1, 1.0, D / 2 - 0.6 + Math.sin(a) * 0.1, 0.05, 0.7, 0.012, a, 0, 0.12 * (i % 2 ? 1 : -1)); K.box('wood', '#8a5a2b', -W / 2 + 0.53 + Math.cos(a) * 0.1, -W / 2 + 0.57 + Math.cos(a) * 0.1, 1.35, 1.5, D / 2 - 0.62 + Math.sin(a) * 0.1, D / 2 - 0.58 + Math.sin(a) * 0.1); }
  else { books(K, -W / 2 + 0.3, -W / 2 + 0.85, 0.6, D / 2 - 0.6, 0.2, 3); candle(K, -W / 2 + 0.85, 0.6, D / 2 - 0.45); }
  if (ch) coalBin(R, W / 2 - 0.6, D / 2 - 0.6);
  else { K.prop('crate', W / 2 - 0.6, 0, D / 2 - 0.6, 0.2, 0.85); basket(K, W / 2 - 0.6, 0.58, D / 2 - 0.6, 0.2, magic ? ['#b9a2ff', '#7fd6e6'] : ['#c4cad3', '#9aa2ac']); }
  if (ch) { K.cyl('metal', '#2a2028', -W / 2 + 0.45, 0, -D / 2 + 0.45, 0.22, 0.4, 12); for (let i = 0; i < 4; i++) K.ball('stone', '#1a1418', -W / 2 + 0.38 + (i % 2) * 0.14, 0.42 + (i >> 1) * 0.08, -D / 2 + 0.42 + (i % 2) * 0.05, 0.09); }   // a bucket of coals
  else potPlant(K, -W / 2 + 0.45, 0, -D / 2 + 0.45, 1.1, magic ? '#b9a2ff' : '#ffcf4a');
  // wall lamps beside the door + paintings / shields above the side stands
  wallLamp(K, -1.4, 2.2, D / 2, Math.PI, { color: '#ffcf6a' });
  wallLamp(K, 1.4, 2.2, D / 2, Math.PI, { color: '#ffcf6a' });
  if (ch) for (const [x, y, t] of [[-W / 2 + 0.35, 0, 0.1], [W / 2 - 0.35, 0, -0.1]] as const) pitchfork(R, x, y, D / 2 - 0.25, t, 1.6);
  if (!magic && !ch) for (const [x, c] of [[-1.75, Th.shields[0]], [1.75, Th.shields[1]]] as const) { K.geo('wood', SHIELD, M(x, 3.3, -D / 2 + 0.06), c); K.box('metal', '#ffcf4a', x - 0.04, x + 0.04, 3.0, 3.6, -D / 2 + 0.1, -D / 2 + 0.12); }
  else if (magic) { painting(K, -1.75, 3.3, -D / 2, 0, 0.7, 0.5, ['#1c1a44', '#3a2f6e', '#6a4a9a']); painting(K, 1.75, 3.3, -D / 2, 0, 0.7, 0.5, ['#2a4a8a', '#7fd6e6', '#fff3c4']); }
  // the fair inside: a festoon and bunting under the beams
  stringLights(K, -W / 2 + 0.2, H - 0.35, -D / 2 + 0.3, W / 2 - 0.2, H - 0.35, D / 2 - 0.4, 16, magic ? ['#d8c8ff', '#7fd6e6', '#ffcf6a'] : Th.lights, 0.45, 0.55);
  stringLights(K, W / 2 - 0.2, H - 0.35, -D / 2 + 0.3, -W / 2 + 0.2, H - 0.35, D / 2 - 0.4, 16, magic ? ['#ffcf6a', '#d8c8ff'] : Th.lights, 0.45, 0.55);
  if (!magic) bunting(K, -W / 2 + 0.1, H - 0.3, 1.0, W / 2 - 0.1, H - 0.3, 1.0, 14, Th.bunting, 0.35);
  // lanterns
  K.lantern(-2.6, 3.0, -0.2, H - 0.2, magic ? '#ffcf6a' : Th.lamp);
  K.lantern(2.6, 3.0, -0.2, H - 0.2, magic ? '#ffcf6a' : Th.lamp);
  K.lantern(0, 3.0, 2.2, H - 0.2, magic ? '#b9a2ff' : Th.lamp);
  void hanging;
  // the building's own sign over the counter area
  // forge: the chimney stands at the back centre (x ±0.4, up to z −D/2+0.75), so the sign hangs ON its front face,
  // not on the wall behind it (it was hidden by the stack)
  if (magic) K.sign(R.env.building.title || 'Лавка звездочёта', 0, 3.25, -D / 2 + 0.3, 2.4, 0, { bg: '#3a2a6e', fg: '#ffe39a' });
  else if (ch) K.sign(R.env.building.title && R.env.building.title !== 'Кузня' ? R.env.building.title : Th.title!, 0, 3.15, -D / 2 + 0.52, 2.1, 0, { bg: '#3a3346', fg: '#ffe27a', rim: '#ffc83d' });
  else K.sign(R.env.building.title || 'Кузня', 0, 3.3, -D / 2 + 0.8, 1.9, 0, {});
  R.exitDoor(0, 1.4, 2.3);
  R.spawn = { x: 0, z: D / 2 - 0.9, face: 0 };
  void shade;
}
