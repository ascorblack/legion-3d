/**
 * Hybrid room scenes. Each builder lays out a small interior + NPC and returns the box of the "desk" Interactable
 * that re-opens the site's panel (or null). Layout rule: the site's panel is docked on `side`, so the NPC and the
 * point of interest stand on the other half of the view from the spawn (camera looks to −Z).
 */
import * as THREE from 'three';
import type { RoomBase, RoomEnv } from '../common/base';
import { Frame, counter, COUNTER_TOP, DAIS } from '../shop/furniture';
import { hitPlane } from '../common/kit';
import { bunting, stringLights, wallLamp, potPlant, candle, books, painting, mug, sack, stool, cloth, basket, roundRug, dot, brazier, wallShelf, patternRug } from '../common/decor';
import { M } from '../../world/batch';
import { AnvilFx, hookSiteForge, siteAniOf, siteForgeV3 } from './anvil';
import { faceTo } from '../common/npc';

export interface DeskBox { x: number; y: number; z: number; w: number; h: number; d: number }
export interface HybridSpec {
  side?: 'left' | 'right' | 'full';
  /** Prompt verb for the desk, e.g. «Навыки у тренера». */
  verb?: string;
  autoOpen?: boolean;
  /** Scene-mode framing: focus point (default: the desk box centre) and the hero's distance from it (default 1.8 m). */
  stage?: { focus?: [number, number, number]; dist?: number };
  build(R: RoomBase, env: RoomEnv): DeskBox | null;
}

const npcBox = (x: number, z: number): DeskBox => ({ x, y: 0.8, z, w: 0.9, h: 1.6, d: 0.9 });

/** Banner hanging on the back wall. */
function banner(R: RoomBase, x: number, z: number, col: string, trim = '#ffcf4a', h = 1.5): void {
  const K = R.kit;
  K.box('metal', R.pal.metal, x - 0.45, x + 0.45, 3.0, 3.04, z, z + 0.08);
  K.box('canvas', col, x - 0.38, x + 0.38, 3.0 - h, 3.0, z + 0.04, z + 0.07);
  K.geo('canvas', new THREE.ConeGeometry(0.38, 0.3, 3), new THREE.Matrix4().compose(new THREE.Vector3(x, 3.0 - h - 0.1, z + 0.055), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI), new THREE.Vector3(1, 1, 0.08)), col);
  K.box('canvas', trim, x - 0.38, x + 0.38, 3.0 - 0.18, 3.0 - 0.1, z + 0.07, z + 0.08);
  K.ball('emit', trim, x, 3.0 - h * 0.5, z + 0.08, 0.12, 0.3);
}
function torch(R: RoomBase, x: number, y: number, z: number, side: 'back' | 'left' | 'right'): void {
  const K = R.kit, dx = side === 'left' ? 0.18 : side === 'right' ? -0.18 : 0, dz = side === 'back' ? 0.18 : 0;
  K.box('metal', R.pal.metal, x - 0.03 + (dx < 0 ? dx : 0), x + 0.03 + (dx > 0 ? dx : 0), y - 0.03, y + 0.03, z - 0.03, z + 0.03 + dz);
  K.cone('metal', R.pal.metal, x + dx, y, z + dz, 0.08, 0.16);
  K.ball('emit', '#ffb347', x + dx, y + 0.2, z + dz, 0.07, 1.6);
  K.light(x + dx * 1.5, y + 0.3, z + dz * 1.5, '#ff9a4a', 4, 6, 1.1, 2);
  K.splash(x + dx * 0.2, y + 0.1, z + dz * 0.2, 1.6, 1.9, '#ff9a4a', 0.45, side === 'left' ? Math.PI / 2 : side === 'right' ? -Math.PI / 2 : 0);
}
/** Chandelier: a wooden ring with candles, hanging from the ceiling (+ a real light, prio 2). */
function chandelier(R: RoomBase, x: number, y: number, z: number, ceil: number, r = 0.6): void {
  const K = R.kit;
  K.geo('wood', RING, M(x, y, z, r * 2, 1, r * 2), R.pal.woodD);
  for (const a of [0, Math.PI / 2]) K.rbox('metal', R.pal.metal, x, (y + ceil) / 2 + 0.2, z, 0.015, ceil - y - 0.4, 0.015, a, 0, 0);
  K.box('metal', R.pal.metal, x - 0.012, x + 0.012, y, ceil, z - 0.012, z + 0.012);
  for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4; candle(K, x + Math.cos(a) * r, y + 0.03, z + Math.sin(a) * r, 0.12, i % 2 === 0); }
  K.light(x, y - 0.1, z, '#ffcf8a', 6, 9, 1.6, 2);
  K.splash(x, 0.02, z, 3.6, 3.6, '#ffcf6a', 0.22, 0, -Math.PI / 2);
}
/** Disc facing +Z (targets, shields, clocks). */
const DISCZ = new THREE.CylinderGeometry(0.5, 0.5, 0.05, 20).rotateX(Math.PI / 2);
const RING = new THREE.TorusGeometry(0.5, 0.035, 6, 24).rotateX(Math.PI / 2);
function bookshelf(R: RoomBase, F: Frame, lx: number, w = 1.4): void {
  const P = R.pal;
  F.box(R, 'wood', P.woodD, lx - w / 2, lx + w / 2, 0, 2.2, 0, 0.4);
  for (let l = 0; l < 4; l++) {
    const y = 0.15 + l * 0.52;
    F.box(R, 'wood', P.woodL, lx - w / 2 + 0.05, lx + w / 2 - 0.05, y - 0.03, y, 0.02, 0.42);
    let x = lx - w / 2 + 0.1;
    let k = l * 7;
    while (x < lx + w / 2 - 0.12) { const bw = 0.06 + ((k * 37) % 5) * 0.012, bh = 0.3 + ((k * 13) % 4) * 0.04; F.box(R, 'back', ['#a3122a', '#3a6aa8', '#5a9a4a', '#c9884a', '#6a4a9a'][k % 5], x, x + bw, y, y + bh, 0.08, 0.36); x += bw + 0.01; k++; }
  }
  F.solid(R, lx - w / 2, lx + w / 2, 0, 0.42, Infinity);
}

export const HYBRID_SCENES: Record<string, HybridSpec> = {
  /* ---------------------------------------------------------------- trainer: training hall, dummies, weapon racks */
  trainer: {
    side: 'right', verb: 'Навыки — у Тренера',
    build(R) {
      const K = R.kit, P = R.pal, W = 10, D = 8, H = 3.8;
      R.bg = '#1a1420';
      K.shell({ w: W, d: D, h: H, wall: 'brick', wallCol: P.brick, wainscot: P.woodD, floor: 'wood', floorCol: '#a07450', ceiling: 'beams' });
      K.floorDisc('canvas', '#e2c58a', 0.6, -0.6, 2.6);
      K.geo('canvas', new THREE.TorusGeometry(2.6, 0.05, 4, 48).rotateX(Math.PI / 2), new THREE.Matrix4().makeTranslation(0.6, 0.03, -0.6), '#a3122a');
      K.prop('dummy', 1.6, 0, -1.6, -0.3, 1.0); K.prop('dummy', 0.2, 0, -2.4, 0.2, 1.0); K.prop('dummy', 2.4, 0, -0.2, -0.8, 1.0);
      // weapon racks on the right wall
      const F = new Frame(W / 2, -1.0, -Math.PI / 2);
      F.box(R, 'wood', P.woodD, -1.6, 1.6, 0.4, 0.5, 0, 0.3); F.box(R, 'wood', P.woodD, -1.6, 1.6, 1.6, 1.7, 0, 0.3);
      for (let i = 0; i < 7; i++) { const lx = -1.35 + i * 0.45; F.box(R, 'wood', i % 2 ? '#8a5a2b' : '#b7bec4', lx - 0.025, lx + 0.025, 0.45, 2.0 + (i % 3) * 0.12, 0.12, 0.17); }
      F.solid(R, -1.7, 1.7, 0, 0.4, Infinity);
      banner(R, -3.0, -D / 2, '#a3122a'); banner(R, 3.0, -D / 2, '#3a6aa8');
      K.sign('Тренер', 0, 3.0, -D / 2 + 0.05, 2.0);
      K.prop('barrel', -W / 2 + 0.6, 0, -D / 2 + 0.6, 0, 0.9); K.prop('crate', -W / 2 + 0.6, 0, -D / 2 + 1.5, 0.3, 0.8);
      K.prop('bench', -W / 2 + 0.5, 0, 0.8, Math.PI / 2, 1.0);
      K.lantern(-1.5, 3.0, -0.5, H - 0.2); K.lantern(2.0, 3.0, -0.5, H - 0.2);
      K.window('left', -2.4, 1.2, 1.0, 1.2);
      // lived-in: archery target, a punching bag, mats, a bucket and towel, the drills chalkboard, festoons
      K.geo('wood', DISCZ, M(-W / 2 + 0.06, 1.5, 0.6, 1.1, 1.1, 1, 0, Math.PI / 2, 0), '#f2ead8');
      for (const [r, c] of [[0.42, '#a3122a'], [0.3, '#f2ead8'], [0.18, '#a3122a'], [0.07, '#ffcf4a']] as const) K.geo('back', DISCZ, M(-W / 2 + 0.1 + (0.45 - r) * 0.04, 1.5, 0.6, r * 2, r * 2, 0.4, 0, Math.PI / 2, 0), c);
      for (let i = 0; i < 3; i++) K.rbox('wood', '#8a5a2b', -W / 2 + 0.25, 1.45 + i * 0.12, 0.45 + i * 0.12, 0.6, 0.015, 0.015, 0.3, 0, -0.2);
      K.box('back', '#3a2a24', -2.9 - 0.01, -2.9 + 0.01, 2.0, H, 1.6 - 0.01, 1.6 + 0.01);
      K.cyl('canvas', '#a3122a', -2.9, 1.05, 1.6, 0.22, 0.95, 12); K.cyl('canvas', '#ffcf4a', -2.9, 1.95, 1.6, 0.23, 0.06, 12); K.solid(-3.15, -2.65, 1.35, 1.85, Infinity, false);
      K.box('canvas', '#3a6aa8', -4.6, -3.2, 0, 0.03, -2.6, -1.2); K.box('canvas', '#5a9a4a', -4.6, -3.2, 0, 0.03, -1.1, 0.3);
      K.cyl('wood', '#7a5a3a', W / 2 - 0.6, 0, 2.4, 0.2, 0.36, 12); K.cyl('water', '#4a7ab8', W / 2 - 0.6, 0.33, 2.4, 0.17, 0.02, 12); K.solid(W / 2 - 0.85, W / 2 - 0.35, 2.15, 2.65, 0.36);
      K.box('canvas', '#f2ead8', -W / 2 + 0.3, -W / 2 + 0.75, 0.43, 0.46, 0.55, 1.0); K.box('canvas', '#ff8fa3', -W / 2 + 0.3, -W / 2 + 0.75, 0.2, 0.46, 1.0, 1.02);
      K.sign('Приёмы дня', -2.4, 2.05, -D / 2 + 0.05, 1.3, 0, { bg: '#2a3a2e', fg: '#fff3dc', sub: 'удар · блок · ещё удар' });
      stringLights(K, -W / 2 + 0.2, H - 0.3, -D / 2 + 0.4, W / 2 - 0.2, H - 0.3, -D / 2 + 0.4, 14, undefined, 0.35, 0.55);
      bunting(K, -W / 2 + 0.1, H - 0.28, 1.2, W / 2 - 0.1, H - 0.28, 1.2, 14, ['#a3122a', '#ffcf4a', '#3a6aa8', '#ffffff'], 0.35);
      wallLamp(K, -1.2, 2.2, D / 2, Math.PI, { real: 1 }); wallLamp(K, 1.2, 2.2, D / 2, Math.PI);
      wallLamp(K, -W / 2, 2.1, -3.4, Math.PI / 2, { real: 2 });
      potPlant(K, -W / 2 + 0.45, 0, D / 2 - 0.45, 1.1, '#ffcf4a'); K.solid(-W / 2, -W / 2 + 0.7, D / 2 - 0.7, D / 2, 0.6);
      // practice swords in a rack by the front-left wall, shields leaning, a pyramid of sandbags, a pennant row
      K.box('wood', P.woodD, -W / 2 + 0.05, -W / 2 + 0.35, 0.0, 0.9, 1.8, 3.0); K.box('wood', P.woodL, -W / 2 + 0.07, -W / 2 + 0.4, 0.9, 0.975, 1.75, 3.05);
      for (let i = 0; i < 6; i++) K.rbox('wood', i % 2 ? '#c9884a' : '#a8754f', -W / 2 + 0.22, 1.25, 1.95 + i * 0.19, 0.04, 0.9, 0.06, 0, 0, 0.12);
      K.solid(-W / 2, -W / 2 + 0.45, 1.75, 3.05, Infinity);
      for (const [x, z, c] of [[-3.7, -2.95, '#a3122a'], [-3.35, -3.1, '#3a6aa8']] as const) K.geo('wood', DISCZ, M(x, 0.42, z, 0.8, 0.8, 1, -0.25, 0, 0), c);
      for (let i = 0; i < 6; i++) { const r = i < 3 ? 0 : i < 5 ? 1 : 2, k = i < 3 ? i : i < 5 ? i - 3 : 0; sack(K, -2.3 + k * 0.5 + r * 0.25, -3.1, ['#d8c08a', '#c8b07a'][i % 2], 0.75, r * 0.38); }
      K.solid(-2.6, -0.8, -3.4, -2.8, 1.0);
      wallShelf(K, -W / 2, 2.0, -0.9, Math.PI / 2, 1.4, 'boxes');
      painting(K, -W / 2, 2.35, 2.4, Math.PI / 2, 0.8, 0.6, ['#a3122a', '#ffcf4a', '#3a6aa8']);
      roundRug(K, -2.2, 0.3, 0.9, '#ffcf4a', '#a3122a');
      patternRug(K, -1.2, 0.0, 1.9, 3.6, '#a3122a', '#ffcf4a', '#3a6aa8');
      // sparring ring: four corner posts with red-and-white ropes around the circle
      { const cx = 0.6, cz = -0.6, r = 2.2, P4: [number, number][] = [[cx - r, cz - r], [cx + r, cz - r], [cx + r, cz + r], [cx - r, cz + r]];
        for (const [x, z] of P4) { K.cyl('wood', '#ffcf4a', x, 0, z, 0.07, 1.25, 8); K.ball('canvas', '#a3122a', x, 1.3, z, 0.1); K.solid(x - 0.1, x + 0.1, z - 0.1, z + 0.1, Infinity, false); }
        for (let i = 0; i < 4; i++) { const [ax, az] = P4[i], [bx2, bz2] = P4[(i + 1) % 4]; if (i === 2) continue; for (const [y, c] of [[0.7, '#f2ead8'], [1.05, '#a3122a']] as const) K.box('canvas', c, Math.min(ax, bx2) - 0.02, Math.max(ax, bx2) + 0.02, y, y + 0.035, Math.min(az, bz2) - 0.02, Math.max(az, bz2) + 0.02); } }
      R.npc({ seed: 'Тренер', name: 'Тренер', x: -1.6, z: -1.2, face: faceTo(-1.6, -1.2, -0.6, D / 2 - 0.9), look: { hat: 'bandana', shape: 'box', color: '#ff9a6a' }, gear: { w: 'gladius', s: 'round' },
        hello: ['Встань в стойку, {n}! Покажу пару приёмов.', 'Навыки сами себя не выучат!', 'Заходи, разомнём лапы.'], lines: ['Удар, блок, ещё удар!', 'Очки навыков — не копи, учись!'], emote: { anim: 'swing', every: 6 } });
      R.exitDoor();
      R.spawn = { x: -0.6, z: D / 2 - 0.9, face: 0 };
      return npcBox(-1.6, -1.2);
    },
  },
  /* ---------------------------------------------------------------- board: notice board room */
  board: {
    side: 'right', verb: 'Читать объявления',
    build(R) {
      const K = R.kit, P = R.pal, W = 8, D = 7, H = 3.6;
      R.bg = '#161226';
      K.shell({ w: W, d: D, h: H, wall: 'plaster', wallCol: '#efdcbc', wainscot: '#4a6a8a', floor: 'wood', floorCol: '#a07450', ceiling: 'beams', door: { x: 0.6, w: 1.4, h: 2.3 } });
      patternRug(K, -0.2, 1.4, -0.6, 2.8, '#3a6aa8', '#ffcf4a', '#a3122a');
      // the big board on the back wall (left half: panel is on the right)
      const bx = -1.2, bz = -D / 2;
      K.box('wood', P.woodD, bx - 1.6, bx + 1.6, 0.7, 2.75, bz, bz + 0.12);
      K.box('wood', '#c9a46a', bx - 1.45, bx + 1.45, 0.85, 2.6, bz + 0.12, bz + 0.14);
      K.box('wood', P.woodD, bx - 1.75, bx + 1.75, 2.75, 2.9, bz, bz + 0.3);
      for (let i = 0; i < 11; i++) {
        const x = bx - 1.2 + (i % 4) * 0.8 + ((i * 7) % 3) * 0.05, y = 1.05 + Math.floor(i / 4) * 0.55 + ((i * 5) % 3) * 0.04;
        K.rbox('flat', ['#fff8ec', '#ffe9a0', '#ffd2dc', '#d8ecff'][i % 4], x, y + 0.2, bz + 0.16, 0.5, 0.42, 0.01, 0, 0, ((i * 13) % 7 - 3) * 0.03);
        K.ball('back', '#e0504a', x, y + 0.38, bz + 0.17, 0.02);
      }
      K.sign('Доска объявлений', bx, 3.05, bz + 0.05, 2.4);
      K.solid(bx - 1.75, bx + 1.75, bz, bz + 0.35, Infinity);
      K.prop('bench', -1.2, 0, -1.2, 0, 1.0); K.prop('lamp', 1.8, 0, -2.6, 0, 0.9);
      const F = new Frame(-W / 2, 0.5, Math.PI / 2); bookshelf(R, F, -0.6); bookshelf(R, F, 0.9);
      K.lantern(-1.2, 2.9, -1.6, H - 0.2); K.lantern(1.4, 2.9, 0.8, H - 0.2);
      K.window('right', -1.0, 1.1, 1.1, 1.3);
      // lived-in: lamps over the board, posters on the left wall by the door, a reading table, a basket of scrolls
      K.light(bx, 2.6, bz + 1.4, '#ffd9a0', 3.5, 6, 0, 3);
      wallLamp(K, bx - 1.9, 2.5, bz, 0, { pool: 0.9 }); wallLamp(K, bx + 1.9, 2.5, bz, 0, { pool: 0.9 });
      K.splash(bx, 1.75, bz + 0.17, 3.6, 2.4, '#ffe2a0', 0.18);
      for (let i = 0; i < 3; i++) K.rbox('flat', ['#ffe9a0', '#ffd2dc', '#d8ecff'][i], -W / 2 + 0.02, 1.7 + (i % 2) * 0.15, 2.0 + i * 0.55, 0.01, 0.55, 0.42, 0, 0, ((i * 7) % 3 - 1) * 0.05);
      K.sign('Новости', -W / 2 + 0.04, 2.45, 2.55, 1.2, Math.PI / 2, { bg: '#a3122a', fg: '#fff3dc' });
      const tx = -2.3, tz = 1.0;
      roundRug(K, tx, tz, 1.3, '#a3122a', '#ffcf4a');
      K.box('wood', P.woodD, tx - 0.6, tx + 0.6, 0, 0.72, tz - 0.35, tz + 0.35); K.box('wood', P.woodL, tx - 0.65, tx + 0.65, 0.72, 0.78, tz - 0.4, tz + 0.4); K.solid(tx - 0.65, tx + 0.65, tz - 0.4, tz + 0.4, 0.78);
      books(K, tx - 0.5, tx - 0.05, 0.78, tz - 0.2, 0.18, 2); candle(K, tx + 0.3, 0.78, tz + 0.05); mug(K, tx + 0.5, 0.78, tz - 0.2, '#7fb0e8');
      K.rbox('flat', '#fff8ec', tx + 0.05, 0.79, tz + 0.1, 0.35, 0.004, 0.26, 0.2);
      stool(K, tx, tz + 0.75, '#a3122a'); stool(K, tx + 0.95, tz, '#3a6aa8');
      K.light(tx, 1.6, tz, '#ffd9a0', 3, 4, 0, 2);
      wallShelf(K, -W / 2, 2.6, 0.5, Math.PI / 2, 2.6, 'books');
      // a round poster column in the middle of the room (all the news that did not fit on the board)
      { const px = -0.9, pz = 0.4;
        K.cyl('stone', '#4a6a8a', px, 0, pz, 0.42, 0.25, 16); K.cyl('plaster', '#efdcbc', px, 0.25, pz, 0.36, 2.0, 16); K.cone('roof', '#4a6a8a', px, 2.25, pz, 0.46, 0.35); K.ball('metal', '#ffcf4a', px, 2.64, pz, 0.06);
        for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4 + 0.2; K.rbox('flat', ['#fff8ec', '#ffe9a0', '#ffd2dc', '#d8ecff'][i % 4], px + Math.sin(a) * 0.375, 0.75 + (i % 3) * 0.42, pz + Math.cos(a) * 0.375, 0.32, 0.4, 0.01, a, 0, ((i * 5) % 3 - 1) * 0.06); }
        K.solid(px - 0.45, px + 0.45, pz - 0.45, pz + 0.45, Infinity); }
      basket(K, 2.6, 0, 2.4, 0.26, null, 0.4); for (let i = 0; i < 5; i++) K.rbox('back', '#f2ead8', 2.6 + (i % 3 - 1) * 0.08, 0.5, 2.4 + (i % 2) * 0.08, 0.07, 0.35, 0.07, 0, 0.2 * (i % 2 ? 1 : -1), 0.25 * (i - 2) * 0.3);
      K.solid(2.3, 2.9, 2.1, 2.7, 0.6);
      potPlant(K, W / 2 - 0.45, 0, D / 2 - 0.45, 1.1, '#ff8fa3'); K.solid(W / 2 - 0.7, W / 2, D / 2 - 0.7, D / 2, 0.6);
      stringLights(K, -W / 2 + 0.2, H - 0.3, -D / 2 + 0.3, W / 2 - 0.2, H - 0.3, D / 2 - 0.5, 14, undefined, 0.35, 0.55);
      bunting(K, -W / 2 + 0.1, H - 0.25, 0.6, W / 2 - 0.1, H - 0.25, 0.6, 12, ['#ffcf4a', '#a3122a', '#5a9a4a', '#7fb0e8'], 0.3);
      R.npc({ seed: 'Глашатай', name: 'Глашатай', x: -2.5, z: -2.3, face: faceTo(-2.5, -2.3, -0.6, D / 2 - 0.9), look: { hat: 'beret', shape: 'egg', color: '#9fe39a', acc: ['scarf'] },
        hello: ['Свежие новости, {n}! Только что с печи.', 'Читай, читай — всё самое важное здесь.'], lines: ['Слыхал? В шахте нашли самоцвет!'], emote: { anim: 'wave', every: 14 } });
      R.exitDoor();
      R.spawn = { x: -0.6, z: D / 2 - 0.9, face: 0 };
      return { x: bx, y: 1.75, z: bz + 0.3, w: 3.2, h: 2.0, d: 0.6 };
    },
  },
  /* ---------------------------------------------------------------- hall: Ратуша */
  hall: {
    // site 03.11 (b-hall.js hall4): the treasury window — drag ore from the bag to «Пожертвовать» / the hall's store
    side: 'left', verb: 'Казна и склад Ратуши',
    build(R, env) {
      const K = R.kit, P = R.pal, W = 10, D = 9, H = 4.4;
      R.bg = '#18142a';
      K.shell({ w: W, d: D, h: H, wall: 'plaster', wallCol: '#e8d4b0', wainscot: '#6a2a3a', floor: 'lowPaving', floorCol: '#c8b8a8', ceiling: 'flat', ceilCol: '#5a3a5a', door: { x: 0, w: 1.6, h: 2.6 } });
      for (const x of [-3.6, 3.6]) for (const z of [-2.4, 0.4, 2.6]) { K.cyl('stone', '#efe2cc', x, 0, z, 0.22, H, 16); K.box('stone', '#d8c8b0', x - 0.3, x + 0.3, 0, 0.2, z - 0.3, z + 0.3); K.box('stone', '#d8c8b0', x - 0.3, x + 0.3, H - 0.25, H, z - 0.3, z + 0.3); K.solid(x - 0.3, x + 0.3, z - 0.3, z + 0.3, Infinity); }
      K.floorBox('canvas', '#a3122a', -0.8, 0.8, -D / 2, D / 2 - 0.2); K.floorBox('canvas', '#ffcf4a', -0.85, -0.8, -D / 2, D / 2 - 0.2); K.floorBox('canvas', '#ffcf4a', 0.8, 0.85, -D / 2, D / 2 - 0.2);
      // desk on the right of the centre (panel on the left)
      const C = new Frame(1.6, -D / 2, 0);
      counter(R, C, -1.3, 1.3, 1.4, 2.1, '#6a2a3a', P.woodL);
      for (let i = 0; i < 4; i++) K.box('back', ['#a3122a', '#3a6aa8', '#5a9a4a', '#c9884a'][i], 0.7 + i * 0.12, 0.8 + i * 0.12, COUNTER_TOP, COUNTER_TOP + 0.25, -D / 2 + 1.6, -D / 2 + 1.85);
      K.box('flat', '#fff8ec', 1.6, 2.1, COUNTER_TOP + 0.007, COUNTER_TOP + 0.011, -D / 2 + 1.55, -D / 2 + 1.9);
      banner(R, -2.6, -D / 2, '#a3122a', '#ffcf4a', 2.0); banner(R, 2.6, -D / 2, '#a3122a', '#ffcf4a', 2.0);
      K.sign(env.building.title || 'Ратуша', 0, 3.4, -D / 2 + 0.05, 2.6);
      K.box('wood', P.woodD, -0.7, 0.7, 1.4, 2.9, -D / 2, -D / 2 + 0.1); K.ball('emit', '#ffcf4a', 0, 2.2, -D / 2 + 0.1, 0.35, 0.2);
      const F = new Frame(W / 2, 0.8, -Math.PI / 2); bookshelf(R, F, -0.8); bookshelf(R, F, 0.8);
      K.prop('chest', -W / 2 + 0.7, 0, -D / 2 + 0.8, 0.4, 1.0); K.prop('crate', -W / 2 + 0.7, 0, -D / 2 + 1.8, 0.1, 0.9);
      K.lantern(-2.2, 3.4, -0.5, H - 0.1); K.lantern(2.2, 3.4, -0.5, H - 0.1); K.lantern(0, 3.4, 2.4, H - 0.1);
      K.window('left', 0.2, 1.3, 1.1, 1.6); K.window('left', 2.6, 1.3, 1.1, 1.6);
      // lived-in: chandeliers, the town map, flags, plants, a bench, papers and a seal on the desk
      chandelier(R, 0, 3.3, -1.2, H, 0.7); chandelier(R, 0, 3.3, 2.0, H, 0.55);
      painting(K, 4.05, 2.4, -D / 2, 0, 0.8, 0.6, ['#9fe35a', '#7fb0e8', '#e2c58a']);
      painting(K, -4.05, 2.4, -D / 2, 0, 0.8, 0.6, ['#2a2f6e', '#ffcf4a', '#a3122a']);
      potPlant(K, -3.0, 0, -D / 2 + 0.5, 1.3, '#ffcf4a'); potPlant(K, -W / 2 + 0.5, 0, D / 2 - 0.5, 1.2, '#ff8fa3'); potPlant(K, W / 2 - 0.5, 0, D / 2 - 0.5, 1.2, '#b9a2ff');
      K.solid(-3.25, -2.75, -D / 2 + 0.25, -D / 2 + 0.75, 0.6); K.solid(-W / 2, -W / 2 + 0.75, D / 2 - 0.75, D / 2, 0.6); K.solid(W / 2 - 0.75, W / 2, D / 2 - 0.75, D / 2, 0.6);
      K.prop('bench', -2.4, 0, 1.4, Math.PI / 2, 1.0); K.prop('bench', 3.0, 0, 2.7, -Math.PI / 2, 1.0);
      patternRug(K, 1.0, 2.8, 1.5, 3.9, '#6a2a3a', '#ffcf4a', '#3a6aa8');
      painting(K, W / 2, 3.05, 0.0, -Math.PI / 2, 0.55, 0.7, ['#3a6aa8', '#e2c58a', '#e8cfa8']); painting(K, W / 2, 3.05, 1.6, -Math.PI / 2, 0.55, 0.7, ['#5a9a4a', '#e2c58a', '#e8cfa8']);
      K.box('wood', P.woodD, W / 2 - 0.06, W / 2, 1.0, 2.6, 2.4, 3.7); K.box('back', '#e2c58a', W / 2 - 0.08, W / 2 - 0.06, 1.08, 2.52, 2.48, 3.62);
      for (let i = 0; i < 7; i++) K.box('back', ['#9fe35a', '#7fb0e8', '#c9884a'][i % 3], W / 2 - 0.09, W / 2 - 0.08, 1.3 + (i % 3) * 0.35, 1.5 + (i % 3) * 0.35, 2.6 + Math.floor(i / 3) * 0.35, 2.9 + Math.floor(i / 3) * 0.35);
      K.sign('Город', W / 2 - 0.1, 2.85, 3.05, 0.9, -Math.PI / 2, { bg: '#6a2a3a', fg: '#fff3dc' });
      wallLamp(K, W / 2, 3.3, 2.45, -Math.PI / 2, { real: 2, pool: 0.9 });
      for (const z of [-3.0, -1.6]) { K.box('canvas', '#a3122a', W / 2 - 0.04, W / 2 - 0.02, 2.3, 3.9, z - 0.3, z + 0.3); K.box('canvas', '#ffcf4a', W / 2 - 0.05, W / 2 - 0.03, 3.65, 3.75, z - 0.31, z + 0.31); }
      potPlant(K, 2.95, 0, -2.4, 1.0, '#ff8fa3'); potPlant(K, -2.95, 0, 0.4, 1.0, '#ffcf4a');
      // the town model on a big table: little houses with coloured roofs, a fountain, the hall itself
      { const mx = 1.9, mz = 0.6;
        K.box('wood', P.woodD, mx - 0.8, mx + 0.8, 0, 0.75, mz - 0.55, mz + 0.55); K.box('wood', P.woodL, mx - 0.85, mx + 0.85, 0.75, 0.8, mz - 0.6, mz + 0.6); K.box('canvas', '#7aaa4a', mx - 0.78, mx + 0.78, 0.8, 0.81, mz - 0.53, mz + 0.53); // the town map (felt) on the table
        for (let i = 0; i < 12; i++) { const x = mx - 0.65 + (i % 6) * 0.26, z = mz - 0.3 + Math.floor(i / 6) * 0.6, h = 0.08 + (i * 7 % 3) * 0.03; K.box('plaster', '#f3dfbd', x - 0.07, x + 0.07, 0.81, 0.81 + h, z - 0.06, z + 0.06); K.cone('roof', ['#e0504a', '#3a6aa8', '#c9884a', '#5a9a4a'][i % 4], x, 0.81 + h, z, 0.1, 0.07, true); }
        K.box('canvas', '#c8b8a8', mx - 0.78, mx + 0.78, 0.81, 0.818, mz - 0.06, mz + 0.06);
        K.cyl('stone', '#9fd0ff', mx, 0.818, mz, 0.07, 0.03, 12);
        K.solid(mx - 0.85, mx + 0.85, mz - 0.6, mz + 0.6, 0.8);
        K.light(mx, 1.9, mz, '#ffe2b0', 3, 4, 0, 2); }
      K.cyl('back', '#a3122a', 2.35, COUNTER_TOP, -D / 2 + 1.75, 0.06, 0.04, 12); candle(K, 0.55, COUNTER_TOP, -D / 2 + 1.9);
      wallLamp(K, -1.3, 2.4, D / 2, Math.PI, { real: 1 }); wallLamp(K, 1.3, 2.4, D / 2, Math.PI);
      bunting(K, -W / 2 + 0.1, H - 0.2, 0.4, W / 2 - 0.1, H - 0.2, 0.4, 14, ['#a3122a', '#ffcf4a', '#3a6aa8', '#ffffff'], 0.35);
      R.npc({ seed: 'Мастер-строитель', name: 'Мастер-строитель', x: 1.7, z: -D / 2 + 0.95, y: DAIS, face: Math.PI, look: { hat: 'cap', shape: 'box', color: '#c9884a', acc: ['glasses'] },
        hello: ['Добро пожаловать в Ратушу!', 'Всё, что сдают скупщику шахты, — на нашем складе.', 'Руда из шахты? Казна примет — перетащи её из сумки.'], lines: ['Город растёт — и мы с ним.', 'На стройки нужна казна.'], emote: { anim: 'wave', every: 15 } });
      R.exitDoor();
      R.spawn = { x: 0.6, z: D / 2 - 0.9, face: 0 };
      return { x: 1.6, y: 0.9, z: -D / 2 + 1.75, w: 2.8, h: 1.8, d: 1.4 };
    },
  },
  /* ---------------------------------------------------------------- auction */
  auction: {
    side: 'left', verb: 'Торги у Аукциониста',
    build(R, env) {
      const K = R.kit, P = R.pal, W = 10, D = 9, H = 4.2;
      R.bg = '#1a1226';
      K.shell({ w: W, d: D, h: H, wall: 'plaster', wallCol: '#7a3a5e', wainscot: '#3a1a2e', floor: 'wood', floorCol: '#a06a44', ceiling: 'beams', ceilCol: '#3a1a2e', door: { x: 0, w: 1.5, h: 2.5 } });
      K.rug(-0.5, 0.5, -1.4, 3.6, '#a3122a', '#ffcf4a');
      // stage + lectern on the right of centre
      K.box('wood', P.woodD, -0.5, 4.2, 0, 0.35, -D / 2, -D / 2 + 2.2); K.box('wood', '#ffcf4a', -0.51, 4.21, 0.33, 0.37, -D / 2 + 2.15, -D / 2 + 2.22);
      K.floors.push([-0.5, 4.2, -D / 2, -D / 2 + 2.2, 0.35]);
      K.solid(-0.5, 4.2, -D / 2, -D / 2 + 2.2, 0.35);
      K.box('wood', '#6a2a3a', 1.4, 2.2, 0.35, 1.45, -D / 2 + 1.3, -D / 2 + 1.8); K.box('wood', '#ffcf4a', 1.35, 2.25, 1.45, 1.52, -D / 2 + 1.25, -D / 2 + 1.85);
      K.rbox('wood', P.woodD, 1.95, 1.58, -D / 2 + 1.5, 0.08, 0.08, 0.3, 0.3); K.cyl('wood', P.woodD, 1.8, 1.52, -D / 2 + 1.5, 0.07, 0.05, 12);
      // curtains
      for (const x of [-0.4, 4.1]) K.geo('canvas', new THREE.CylinderGeometry(0.3, 0.45, 3.6, 10), new THREE.Matrix4().makeTranslation(x, 2.15, -D / 2 + 0.3), '#a3122a');
      K.box('canvas', '#a3122a', -0.6, 4.3, 3.6, 4.0, -D / 2 + 0.05, -D / 2 + 0.35);
      // lots on pedestals with glass domes
      for (const [x, c] of [[0.5, '#ffcf4a'], [3.2, '#7fd6ff']] as const) { K.cyl('stone', '#d8c8b0', x, 0.35, -D / 2 + 0.8, 0.25, 0.85, 12); K.ball('emit', c, x, 1.36, -D / 2 + 0.8, 0.12); K.ball('glass', '#e8f4ff', x, 1.36, -D / 2 + 0.8, 0.26); K.glow(x, 1.36, -D / 2 + 0.8, 0.9, c, 0.7); }
      // rows of benches
      for (let r = 0; r < 3; r++) for (const x of [-2.6, 1.6]) K.prop('bench', x, 0, -0.6 + r * 1.3, Math.PI, 1.0);
      K.sign(env.building.title || 'Аукцион', 1.8, 3.1, -D / 2 + 0.05, 2.4, 0, { bg: '#3a1a2e' });
      banner(R, -3.4, -D / 2, '#ffcf4a', '#a3122a', 1.8);
      K.lantern(-2.0, 3.3, 0.0, H - 0.2); K.lantern(1.8, 3.3, 1.8, H - 0.2);
      // lived-in: stage footlights, a chandelier, paintings for sale on the left wall, vases, the lot board, festoons
      for (let i = 0; i < 9; i++) { const x = -0.3 + i * 0.55; dot(K, x, 0.4, -D / 2 + 2.15, 0.04, '#ffcf6a'); K.glow(x, 0.45, -D / 2 + 2.1, 0.5, '#ffcf6a', 0.7); }
      K.splash(1.85, 1.6, -D / 2 + 0.36, 4.6, 2.6, '#ffcf6a', 0.32);
      K.light(1.8, 2.6, -D / 2 + 2.6, '#ffd9a0', 6, 7, 0, 3);
      chandelier(R, -1.4, 3.4, 1.0, H, 0.6);
      for (const [z, c] of [[-2.6, ['#7fb0e8', '#9fe35a', '#e2c58a']], [-0.6, ['#2a2f6e', '#b9a2ff', '#fff3c4']], [1.4, ['#ff8fa3', '#ffcf4a', '#a3122a']]] as const) { painting(K, -W / 2, 1.9, z, Math.PI / 2, 1.1, 0.8, [...c]); wallLamp(K, -W / 2, 2.75, z, Math.PI / 2, { pool: 0.8 }); }
      for (const x of [-4.4, 4.5]) { K.cyl('stone', '#d8c8b0', x, 0, D / 2 - 0.5, 0.18, 0.8, 12); K.ball('back', x < 0 ? '#3a6aa8' : '#a3122a', x, 0.98, D / 2 - 0.5, 0.17, 1.15); K.cyl('back', x < 0 ? '#3a6aa8' : '#a3122a', x, 1.1, D / 2 - 0.5, 0.06, 0.16, 8); K.cyl('back', '#ffcf4a', x, 1.24, D / 2 - 0.5, 0.09, 0.03, 8); potPlant(K, x, 1.27, D / 2 - 0.5, 0.6, '#fff3dc'); K.solid(x - 0.25, x + 0.25, D / 2 - 0.75, D / 2 - 0.25, Infinity, false); }
      patternRug(K, 0.9, 3.3, -1.3, 2.9, '#5a2a4a', '#ffcf4a', '#a3122a');
      K.sign('Лоты дня', W / 2 - 0.04, 2.2, 0.2, 1.2, -Math.PI / 2, { bg: '#2a3a2e', fg: '#fff3dc', sub: 'торги идут!' });
      wallLamp(K, W / 2, 2.9, 0.2, -Math.PI / 2, { real: 2, pool: 0.8 });
      painting(K, W / 2, 2.1, 1.9, -Math.PI / 2, 0.9, 0.7, ['#ffcf4a', '#ff8fa3', '#7fb0e8']); painting(K, W / 2, 2.1, -1.5, -Math.PI / 2, 0.9, 0.7, ['#2a4a8a', '#9fe35a', '#e2c58a']);
      wallLamp(K, W / 2, 2.9, 1.9, -Math.PI / 2, { pool: 0.7 });
      // a display case of small lots by the right wall, a vase on a column
      K.box('wood', '#3a1a2e', W / 2 - 0.55, W / 2 - 0.05, 0, 0.9, -0.2, 1.2); K.box('glass', '#e8f4ff', W / 2 - 0.52, W / 2 - 0.08, 0.9, 1.3, -0.17, 1.17);
      for (let i = 0; i < 4; i++) { const z = -0.02 + i * 0.32; K.ball('back', ['#ffcf4a', '#7fd6ff', '#ff8fa3', '#b9a2ff'][i], W / 2 - 0.3, 0.98, z, 0.07); }
      K.solid(W / 2 - 0.6, W / 2, -0.25, 1.25, Infinity, false);
      // velvet rope in front of the stage (brass posts), a gong, crates of lots waiting to go up
      for (let i = 0; i < 5; i++) { const x = -0.2 + i * 1.05; K.cyl('metal', '#ffcf4a', x, 0, -D / 2 + 2.75, 0.04, 0.9, 8); K.ball('metal', '#ffcf4a', x, 0.94, -D / 2 + 2.75, 0.06); K.solid(x - 0.06, x + 0.06, -D / 2 + 2.69, -D / 2 + 2.81, Infinity, false);
        if (i < 4) for (let j = 1; j < 6; j++) { const t2 = j / 6; dot(K, x + 1.05 * t2, 0.86 - Math.sin(t2 * Math.PI) * 0.18, -D / 2 + 2.75, 0.035, '#a3122a'); } }
      K.box('wood', P.woodD, 3.3, 3.36, 0.35, 1.9, -D / 2 + 0.6, -D / 2 + 0.66); K.box('wood', P.woodD, 4.0, 4.06, 0.35, 1.9, -D / 2 + 0.6, -D / 2 + 0.66); K.box('wood', P.woodD, 3.29, 4.07, 1.85, 1.92, -D / 2 + 0.58, -D / 2 + 0.68);
      K.geo('metal', DISCZ, M(3.68, 1.25, -D / 2 + 0.63, 0.6, 0.6, 0.6), '#e8b923');
      K.prop('crate', 3.6, 0, 2.6, 0.2, 0.8); K.prop('crate', 3.6, 0.62, 2.6, -0.2, 0.6, { solid: false }); K.prop('chest', 2.7, 0, 3.4, 0.3, 0.9);
      stringLights(K, -W / 2 + 0.2, H - 0.3, -D / 2 + 0.5, W / 2 - 0.2, H - 0.3, -D / 2 + 0.5, 14, ['#ffcf6a', '#ff8fa3'], 0.35, 0.55);
      bunting(K, -W / 2 + 0.1, H - 0.25, 2.4, W / 2 - 0.1, H - 0.25, 2.4, 14, ['#ffcf4a', '#a3122a', '#5a2a4a'], 0.35);
      wallLamp(K, -1.2, 2.3, D / 2, Math.PI, { real: 1 });
      R.npc({ seed: 'Аукционист', name: 'Аукционист', x: 2.85, z: -D / 2 + 1.25, y: 0.35, face: Math.PI - 0.2, look: { hat: 'tophat', shape: 'tall', color: '#e6e6ee', acc: ['monocle', 'bowtie'] },
        hello: ['Добро пожаловать, {n}! Покупай, продавай — всё честно.', 'Лоты ждут своих хозяев!'], lines: ['Кто больше?', 'Продано!'], emote: { anim: 'cheer', every: 10 } });
      R.exitDoor();
      R.spawn = { x: 0.5, z: D / 2 - 0.9, face: 0 };
      return { x: 1.8, y: 1.2, z: -D / 2 + 1.5, w: 1.8, h: 2.0, d: 1.2 };
    },
  },
  /* ---------------------------------------------------------------- storage */
  storage: {
    side: 'left', verb: 'Склад: положить / забрать',
    build(R, env) {
      const K = R.kit, P = R.pal, W = 10, D = 9, H = 4.4;
      R.bg = '#161220';
      K.shell({ w: W, d: D, h: H, wall: 'wood', wallCol: '#b07a52', wainscot: '#5a7a4a', floor: 'wood', floorCol: '#9a7050', ceiling: 'beams', door: { x: 0, w: 1.6, h: 2.6 } });
      patternRug(K, 0.6, 3.2, 1.8, 3.6, '#5a7a4a', '#ffcf4a', '#a3122a');
      // tall racks along the left wall and the back-left
      for (const [ox, oz, ry] of [[-W / 2, -1.5, Math.PI / 2], [-W / 2, 1.5, Math.PI / 2], [-2.5, -D / 2, 0]] as const) {
        const F = new Frame(ox, oz, ry);
        F.box(R, 'wood', P.woodD, -1.3, -1.2, 0, 3.4, 0, 0.8); F.box(R, 'wood', P.woodD, 1.2, 1.3, 0, 3.4, 0, 0.8);
        for (let l = 0; l < 3; l++) {
          const y = 0.1 + l * 1.1;
          F.box(R, 'wood', P.woodL, -1.25, 1.25, y, y + 0.06, 0.01, 0.79);
          for (let j = 0; j < 3; j++) { const lx = -0.8 + j * 0.8, s = 0.5 + ((l + j) % 3) * 0.08; const col = ['#c9884a', '#a8754f', '#d9a066'][(l * 3 + j) % 3]; F.box(R, 'wood', col, lx - s / 2, lx + s / 2, y + 0.06, y + 0.06 + s * 0.8, 0.4 - s / 2, 0.4 + s / 2); }
        }
        F.solid(R, -1.3, 1.3, 0, 0.8, Infinity);
      }
      // counter on the right with the keeper
      const C = new Frame(2.0, -D / 2, 0);
      counter(R, C, -1.4, 1.4, 1.5, 2.1, P.wood, P.woodL);
      K.prop('chest', 3.8, 0, -D / 2 + 0.7, 0, 1.0); K.prop('barrel', 0.3, 0, -D / 2 + 0.6, 0, 0.9); K.prop('barrel', W / 2 - 0.6, 0, 0.5, 0.4, 0.9); K.prop('crate', W / 2 - 0.6, 0, 1.6, 0.2, 0.9);
      K.box('back', '#ffe9a0', 1.2, 1.6, COUNTER_TOP, COUNTER_TOP + 0.02, -D / 2 + 1.65, -D / 2 + 1.9);
      K.sign(env.building.title || 'Склад', 2.0, 3.3, -D / 2 + 0.05, 2.2);
      K.lantern(-1.5, 3.4, -0.5, H - 0.2); K.lantern(2.0, 3.4, -1.0, H - 0.2); K.lantern(0, 3.4, 2.5, H - 0.2, '#ffcf6a', false);
      // lived-in: rack labels, sacks and a hand cart, a ladder, the tally board, lamps on the racks, festoons
      for (const [x, z, ry, t] of [[-W / 2 + 0.83, -1.5, Math.PI / 2, 'Руда'], [-W / 2 + 0.83, 1.5, Math.PI / 2, 'Снедь'], [-2.5, -D / 2 + 0.83, 0, 'Добыча']] as const) K.sign(t, x, 3.55, z, 0.9, ry, { bg: '#2a3a2e', fg: '#fff3dc' });
      wallLamp(K, -W / 2, 2.9, 0, Math.PI / 2, { real: 2 }); wallLamp(K, -2.5 + 1.5, 2.9, -D / 2, 0, { real: 2 });
      K.splash(-W / 2 + 0.85, 1.7, -1.5, 2.6, 3.0, '#ffcf6a', 0.25, Math.PI / 2); K.splash(-W / 2 + 0.85, 1.7, 1.5, 2.6, 3.0, '#ffcf6a', 0.25, Math.PI / 2); K.splash(-2.5, 1.7, -D / 2 + 0.85, 2.6, 3.0, '#ffcf6a', 0.25);
      sack(K, -2.6, 0.2, '#d8c08a'); sack(K, -2.2, 0.55, '#c8b07a', 0.85); sack(K, -2.55, 0.85, '#e0c89a', 0.75); K.solid(-2.9, -1.95, -0.1, 1.1, 0.6);
      for (const x of [-1.53, -0.47]) K.geo('wood', DISCZ, M(x, 0.25, 2.45, 0.5, 0.5, 1.2, 0, Math.PI / 2, 0), '#5a3a2a');
      K.box('wood', '#c9884a', -1.4, -0.6, 0.35, 0.75, 1.9, 3.0); K.box('wood', '#8a5a2b', -1.5, -0.5, 0.33, 0.37, 1.85, 3.05); K.box('wood', '#8a5a2b', -1.0, -0.96, 0.4, 1.2, 3.0, 3.6);
      basket(K, -1.0, 0.75, 2.2, 0.2, ['#e0504a', '#ffd84a']); K.box('wood', '#a8754f', -1.3, -0.75, 0.75, 1.1, 2.6, 2.95); K.solid(-1.5, -0.5, 1.75, 3.1, 1.1);
      K.sign('Учёт', 4.0, 2.2, -D / 2 + 0.05, 1.0, 0, { bg: '#2a3a2e', fg: '#fff3dc', sub: 'IIII IIII III' });
      potPlant(K, W / 2 - 0.45, 0, D / 2 - 0.45, 1.1, '#ffcf4a'); K.solid(W / 2 - 0.7, W / 2, D / 2 - 0.7, D / 2, 0.6);
      stringLights(K, -W / 2 + 0.2, H - 0.3, 0.0, W / 2 - 0.2, H - 0.3, 0.0, 14, undefined, 0.35, 0.55);
      bunting(K, -W / 2 + 0.1, H - 0.25, 2.6, W / 2 - 0.1, H - 0.25, 2.6, 14, ['#c9884a', '#ffcf4a', '#5a9a4a', '#a3122a'], 0.35);
      K.light(2.0, 2.5, -D / 2 + 2.6, '#ffd9a0', 5, 7, 0, 3);
      wallShelf(K, W / 2, 1.3, -1.0, -Math.PI / 2, 1.8, 'boxes'); wallShelf(K, W / 2, 2.1, -1.0, -Math.PI / 2, 1.8, 'jars');
      wallLamp(K, W / 2, 2.9, -1.0, -Math.PI / 2, { pool: 0.9 });
      // a pallet of goods waiting to be shelved
      K.box('wood', '#a8754f', 1.6, 3.0, 0, 0.14, 0.3, 1.4);
      K.prop('crate', 1.95, 0.14, 0.6, 0.1, 0.8, { solid: false }); K.prop('crate', 2.65, 0.14, 0.65, -0.15, 0.8, { solid: false }); K.prop('crate', 2.3, 0.75, 0.62, 0.3, 0.7, { solid: false });
      sack(K, 2.0, 1.15, '#d8c08a', 0.8, 0.14); sack(K, 2.6, 1.12, '#e0c89a', 0.75, 0.14);
      K.solid(1.6, 3.0, 0.3, 1.4, 1.3);
      K.geo('canvas', new THREE.TorusGeometry(0.22, 0.05, 6, 16).rotateX(Math.PI / 2), M(3.6, 0.05, 2.6), '#c9a46a');
      K.prop('barrel', 3.5, 0, -0.4, 0, 0.85); K.prop('barrel', 4.15, 0, -0.4, 0.5, 0.85, { solid: false }); K.prop('barrel', 3.82, 0.78, -0.4, 0.2, 0.8, { solid: false }); K.solid(3.15, 4.5, -0.75, -0.05, Infinity);
      K.box('wood', '#8a5a2b', 0.3, 1.3, 0.0, 0.5, -0.8, -0.3); for (let i = 0; i < 3; i++) K.box('back', ['#a3122a', '#3a6aa8', '#5a9a4a'][i], 0.4 + i * 0.3, 0.6 + i * 0.3, 0.5, 0.7, -0.7, -0.4); K.solid(0.3, 1.3, -0.8, -0.3, 0.7);
      R.npc({ seed: 'Кладовщик', name: 'Кладовщик', x: 2.0, z: -D / 2 + 1.0, y: DAIS, face: Math.PI, look: { hat: 'cap', shape: 'ball', color: '#a8754f' },
        hello: ['Заходи, {n}! Что положим на полку, что заберём?', 'Всё под замком, всё посчитано.'], lines: ['Сумка полна? Складывай сюда.'], emote: { anim: 'wave', every: 15 } });
      R.exitDoor();
      R.spawn = { x: 0.8, z: D / 2 - 0.9, face: 0 };
      return { x: 2.0, y: 0.9, z: -D / 2 + 1.8, w: 2.8, h: 1.8, d: 1.4 };
    },
  },
  /* ---------------------------------------------------------------- gate: guard room at the city gate */
  gate: {
    side: 'left', verb: 'Поговорить со стражем',
    build(R, env) {
      const K = R.kit, P = R.pal, W = 10, D = 8, H = 4.6;
      R.bg = '#14122a';
      K.shell({ w: W, d: D, h: H, wall: 'stone', wallCol: '#b0a0a0', wainscot: '#7a4a32', floor: 'lowPaving', floorCol: '#a89080', ceiling: 'beams', ceilCol: '#4a3428', door: { x: 0, w: 1.5, h: 2.5 } });
      patternRug(K, 0.2, 1.6, -0.2, 3.4, '#a3122a', '#ffcf4a', '#3a3448');
      K.rug(-3.6, -1.4, -1.0, 2.4, '#a3122a', '#ffcf4a');
      K.prop('dummy', -2.4, 0, 0.6, 0.4, 1.0); K.prop('crate', -0.9, 0, 2.6, 0.3, 0.8); K.prop('crate', -0.9, 0.62, 2.6, 0.0, 0.6, { solid: false });
      // the gate arch with a portcullis on the back wall (right of centre)
      const gx = 1.2, gz = -D / 2;
      K.box('stone', '#6a6276', gx - 1.9, gx + 1.9, 0, 3.6, gz, gz + 0.35);
      K.box('emit', '#1c1a44', gx - 1.3, gx + 1.3, 0, 2.9, gz + 0.36, gz + 0.38);
      K.geo('emit', new THREE.CylinderGeometry(1.3, 1.3, 0.02, 20, 1, false, 0, Math.PI).rotateX(Math.PI / 2).rotateZ(Math.PI / 2), new THREE.Matrix4().makeTranslation(gx, 2.9, gz + 0.37), '#1c1a44');
      for (let i = 0; i < 9; i++) K.box('metal', P.metal, gx - 1.2 + i * 0.3 - 0.03, gx - 1.2 + i * 0.3 + 0.03, 0.3, 3.4, gz + 0.42, gz + 0.48);
      for (let j = 0; j < 6; j++) K.box('metal', P.metal, gx - 1.3, gx + 1.3, 0.5 + j * 0.5, 0.56 + j * 0.5, gz + 0.4, gz + 0.46);
      K.box('stone', '#5a5266', gx - 2.1, gx + 2.1, 3.6, 4.0, gz, gz + 0.5);
      K.solid(gx - 1.9, gx + 1.9, gz, gz + 0.5, Infinity);
      banner(R, -2.6, gz, '#a3122a', '#ffcf4a', 2.0); banner(R, -4.0, gz, '#a3122a', '#ffcf4a', 2.0);
      torch(R, gx - 2.3, 2.0, gz + 0.02, 'back'); torch(R, gx + 2.3, 2.0, gz + 0.02, 'back');
      K.prop('crate', -W / 2 + 0.6, 0, -1.0, 0, 0.9); K.prop('barrel', -W / 2 + 0.6, 0, 0.0, 0, 0.9);
      // spear rack
      const F = new Frame(W / 2, 0.4, -Math.PI / 2);
      F.box(R, 'wood', P.woodD, -1.0, 1.0, 0.3, 0.4, 0, 0.3);
      for (let i = 0; i < 5; i++) { const lx = -0.8 + i * 0.4; F.box(R, 'wood', '#8a5a2b', lx - 0.02, lx + 0.02, 0.4, 2.6, 0.125, 0.155); F.box(R, 'metal', '#c4cad3', lx - 0.04, lx + 0.04, 2.6, 2.85, 0.12, 0.16); }
      F.solid(R, -1.1, 1.1, 0, 0.35, Infinity);
      K.sign(env.building.title || 'Ворота', gx, 4.28, gz + 0.53, 2.2, 0, { bg: '#3a3448' });
      // lived-in: the guards' table (mugs, cards, a candle), a map of the road, a helmet on a stand, lamps, festoons
      { const tx = 2.6, tz = 0.9;
        K.box('wood', P.woodD, tx - 0.8, tx + 0.8, 0, 0.72, tz - 0.45, tz + 0.45); K.box('wood', P.woodL, tx - 0.85, tx + 0.85, 0.72, 0.78, tz - 0.5, tz + 0.5); K.solid(tx - 0.85, tx + 0.85, tz - 0.5, tz + 0.5, 0.78);
        mug(K, tx - 0.5, 0.78, tz - 0.2); mug(K, tx + 0.3, 0.78, tz + 0.2, '#c9884a'); candle(K, tx, 0.78, tz - 0.1);
        for (let i = 0; i < 5; i++) K.rbox('flat', i % 2 ? '#fff8ec' : '#ffd2dc', tx - 0.25 + i * 0.07, 0.788 + i * 0.009, tz + 0.15 + (i % 3) * 0.04, 0.09, 0.003, 0.13, i * 0.4);   // a fanned stack, 9 mm apart
        K.rbox('flat', '#e2c58a', tx + 0.45, 0.786, tz - 0.05, 0.4, 0.003, 0.3, 0.3);
        stool(K, tx - 1.13, tz, '#5a5470'); stool(K, tx + 1.1, tz + 0.1, '#5a5470'); stool(K, tx, tz + 0.85, '#5a5470'); }
      painting(K, -W / 2, 2.2, 0.4, Math.PI / 2, 1.4, 1.0, ['#9fe35a', '#e2c58a', '#7fb0e8']);
      K.sign('Дорога в поход', -W / 2 + 0.04, 2.95, 0.4, 1.3, Math.PI / 2, { bg: '#a3122a', fg: '#fff3dc' });
      // armour stand: post, shoulders, a red tabard, a crested helmet
      K.cyl('wood', P.woodD, 3.9, 0, 2.6, 0.05, 1.55, 8); K.box('wood', P.woodD, 3.62, 4.18, 1.32, 1.4, 2.56, 2.64); K.cyl('wood', P.woodD, 3.9, 0, 2.6, 0.22, 0.06, 12);
      K.box('canvas', '#a3122a', 3.66, 4.14, 0.75, 1.32, 2.5, 2.7); K.box('canvas', '#ffcf4a', 3.65, 4.15, 1.05, 1.1, 2.49, 2.71);
      K.ball('metal', '#c4cad3', 3.9, 1.62, 2.6, 0.2, 0.95); K.box('canvas', '#a3122a', 3.88, 3.92, 1.7, 1.95, 2.42, 2.78);
      K.solid(3.6, 4.2, 2.35, 2.85, Infinity, false);
      wallLamp(K, -1.3, 2.3, D / 2, Math.PI, { real: 1 }); wallLamp(K, 1.3, 2.3, D / 2, Math.PI);
      wallLamp(K, -W / 2, 2.2, -2.4, Math.PI / 2, { real: 2 });
      brazier(K, -0.4, -0.6);
      for (const [z, c] of [[-2.4, '#a3122a'], [-1.6, '#3a6aa8'], [-0.9, '#ffcf4a']] as const) { K.geo('wood', DISCZ, M(W / 2 - 0.04, 2.3, z, 0.6, 0.6, 1, 0, -Math.PI / 2, 0), c); K.geo('metal', DISCZ, M(W / 2 - 0.07, 2.3, z, 0.16, 0.16, 1, 0, -Math.PI / 2, 0), '#c4cad3'); }
      K.window('right', 2.9, 1.2, 1.0, 1.3, '#2a2f6e');
      K.prop('barrel', W / 2 - 0.55, 0, -2.6, 0.3, 0.9); K.prop('crate', W / 2 - 0.6, 0, 2.1, 0.2, 0.8);
      for (let i = 0; i < 3; i++) K.rbox('metal', '#c4cad3', W / 2 - 0.55 + (i - 1) * 0.08, 1.1, -2.6, 0.04, 0.6, 0.012, i, 0, (i - 1) * 0.12);
      roundRug(K, 2.6, 0.9, 1.5, '#4a4458', '#a3122a');
      potPlant(K, -W / 2 + 0.45, 0, D / 2 - 0.45, 1.1, '#ffcf4a'); K.solid(-W / 2, -W / 2 + 0.7, D / 2 - 0.7, D / 2, 0.6);
      stringLights(K, -W / 2 + 0.2, H - 0.4, 1.4, W / 2 - 0.2, H - 0.4, 1.4, 14, ['#ffcf6a', '#ff9a4a'], 0.4, 0.55);
      bunting(K, -W / 2 + 0.1, H - 0.35, 2.6, W / 2 - 0.1, H - 0.35, 2.6, 14, ['#a3122a', '#ffcf4a'], 0.4);
      R.npc({ seed: 'Страж ворот', name: 'Страж ворот', x: gx + 0.6, z: gz + 1.5, face: Math.PI - 0.3, look: { hat: 'legion', shape: 'box', color: '#5a5470' }, gear: { w: 'spear', s: 'scutum' },
        hello: ['В поход отсюда не выйти — отряд собирает стример на стриме.', 'Стой! А, это ты, {n}. Проходи.'], lines: ['Ворота откроются, когда начнётся поход.', 'Заточи оружие, загляни к Тренеру.'] });
      R.exitDoor();
      R.spawn = { x: 0.6, z: D / 2 - 0.9, face: 0 };
      return npcBox(gx + 0.6, gz + 1.5);
    },
  },
  /* ---------------------------------------------------------------- anvil: the open forge shed with the smith */
  anvil: {
    side: 'left', verb: 'К наковальне — заточка',
    // the hero faces the anvil with the smith behind it
    stage: { focus: [0.6, 0.8, -2.1], dist: 1.7 },
    build(R, env) {
      const K = R.kit, P = R.pal, W = 9, D = 8;
      R.bg = '#26265e'; R.fogNear = 12; R.fogFar = 40;
      K.bounds = { x0: -W / 2, x1: W / 2, z0: -D / 2, z1: D / 2 };
      // street ground + backdrop: the open shed under the night sky, a row of lit houses behind
      K.box('paving', P.ground2, -W / 2 - 6, W / 2 + 6, -0.1, 0, -D / 2 - 3, D / 2 + 6);
      K.box('back', '#3e3a7a', -W / 2 - 8, W / 2 + 8, 0, 7, -D / 2 - 3.6, -D / 2 - 3);
      for (let i = 0; i < 9; i++) { const x = -W / 2 - 6 + i * 2.6; K.box('back', ['#4a3a6e', '#3a3a72', '#5a3a5e'][i % 3], x, x + 2.2, 7, 8 + (i % 3) * 0.8, -D / 2 - 3.6, -D / 2 - 3.2); K.box('wood', P.woodD, x + 0.6, x + 1.3, 4.4, 5.3, -D / 2 - 3.0, -D / 2 - 2.97); K.box('emit', i % 2 ? P.glass : '#ffb35c', x + 0.7, x + 1.2, 4.5, 5.2, -D / 2 - 2.97, -D / 2 - 2.96); K.glow(x + 0.95, 4.85, -D / 2 - 2.8, 1.2, '#ffcf6a', 0.6); }
      for (let i = 0; i < 26; i++) dot(K, -W / 2 - 7 + i * 0.95, 8.6 + ((i * 7) % 5) * 0.5, -D / 2 - 3.65, 0.04, '#fff3c4');
      // shed: posts, roof, back wall
      const sx0 = -2.6, sx1 = 3.4, sz0 = -D / 2, sz1 = -0.6, sh = 3.6;
      for (const x of [sx0, sx1]) for (const z of [sz0 + 0.1, sz1]) { K.box('wood', P.timber, x - 0.12, x + 0.12, 0, sh, z - 0.12, z + 0.12); K.solid(x - 0.14, x + 0.14, z - 0.14, z + 0.14, Infinity); }
      K.box('brick', P.brick, sx0, sx1, 0, sh - 0.01, sz0 - 0.2, sz0);
      K.geo('roof', new THREE.BoxGeometry(1, 1, 1), new THREE.Matrix4().compose(new THREE.Vector3((sx0 + sx1) / 2, sh + 0.45, (sz0 + sz1) / 2 + 0.2), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), 0.22), new THREE.Vector3(sx1 - sx0 + 0.8, 0.12, sz1 - sz0 + 1.4)), P.roof);
      K.box('wood', P.timber, sx0 - 0.2, sx1 + 0.2, sh - 0.1, sh + 0.1, sz1 - 0.135, sz1 + 0.135);
      // hearth (the main light, flickers; flashes on every blow)
      K.box('stone', '#7a6a72', sx1 - 1.8, sx1 - 0.2, 0, 0.9, sz0, sz0 + 1.0);
      K.box('emit', '#ff7a2a', sx1 - 1.6, sx1 - 0.4, 0.9, 0.95, sz0 + 0.15, sz0 + 0.85);
      for (let i = 0; i < 6; i++) K.ball('emit', i % 2 ? '#ffb347' : '#ff5a1a', sx1 - 1.5 + i * 0.2, 0.95, sz0 + 0.3 + (i % 3) * 0.2, 0.08, 0.6);
      K.box('stone', '#6a5a62', sx1 - 1.5, sx1 - 0.5, 0.95, sh, sz0, sz0 + 0.5);
      const fire = K.light(sx1 - 1.0, 1.4, sz0 + 1.1, '#ff8a3a', 9, 9, 2.0, 3);
      K.splash(sx1 - 1.0, 1.4, sz0 + 0.02, 3.0, 2.6, '#ff8a3a', 0.45);
      K.splash(sx1 - 1.2, 0.03, sz0 + 1.8, 3.6, 2.8, '#ff8a3a', 0.3, 0, -Math.PI / 2);
      K.solid(sx1 - 1.8, sx1 - 0.2, sz0, sz0 + 1.0, Infinity);
      // the anvil, bellows, quench bucket, coal, a rack of tongs and hammers on the back wall, a grindstone
      K.prop('anvil', 1.0, 0, -2.0, 0.2, 1.1);
      K.rbox('wood', '#8a4a2a', sx1 - 2.2, 0.55, sz0 + 0.55, 0.5, 0.18, 0.7, 0.3); K.rbox('canvas', '#5a3a2a', sx1 - 2.2, 0.45, sz0 + 0.55, 0.42, 0.14, 0.6, 0.3); K.solid(sx1 - 2.5, sx1 - 1.9, sz0 + 0.15, sz0 + 0.95, 0.65);
      K.cyl('wood', '#7a5a3a', 2.1, 0, -1.4, 0.24, 0.42, 12); K.cyl('water', '#3a5a8a', 2.1, 0.38, -1.4, 0.21, 0.02, 12); K.solid(1.85, 2.35, -1.65, -1.15, 0.42);
      sack(K, sx0 + 1.2, sz0 + 0.5, '#3a3440', 0.85);
      for (let i = 0; i < 6; i++) { const x = sx0 + 0.3 + i * 0.3; K.box('metal', '#3a3440', x - 0.012, x + 0.012, 1.55, 2.25, sz0 + 0.02, sz0 + 0.06); K.box(i % 2 ? 'wood' : 'metal', i % 2 ? '#8a5a2b' : '#9aa2ac', x - 0.05, x + 0.05, 1.4, 1.58, sz0 + 0.026, sz0 + 0.08); }
      K.box('wood', P.woodD, sx0 + 0.15, sx0 + 2.0, 2.25, 2.32, sz0, sz0 + 0.12);
      K.geo('stone', DISCZ, M(-1.6, 0.5, -1.2, 0.8, 0.8, 2.4, 0, Math.PI / 2, 0), '#9a929e'); K.box('wood', P.woodD, -1.75, -1.45, 0, 0.3, -1.45, -0.95); K.solid(-1.8, -1.4, -1.5, -0.9, 0.9);
      K.prop('barrel', sx0 + 0.5, 0, sz0 + 0.5, 0, 0.9); K.prop('crate', sx0 + 0.5, 0, sz0 + 1.4, 0.3, 0.8);
      basket(K, sx0 + 0.5, 0.56, sz0 + 1.4, 0.18, ['#c4cad3', '#9aa2ac']);
      wallLamp(K, -0.4, 2.6, sz0, 0, { real: 2 });
      // signs: the shed's board and a price chalkboard
      K.sign('Заточка', 0.4, 2.85, sz1 + 0.12, 1.8, 0, { bg: '#7a1a2a', fg: '#ffe9b0' });
      K.sign('Звезда — к удаче', -3.6, 1.55, -1.0, 1.2, Math.PI / 2 - 0.4, { bg: '#2a3a2e', fg: '#fff3dc', sub: 'сфера — от поломки' });
      K.box('wood', P.woodD, -3.62, -3.52, 0, 1.3, -1.05, -0.95); K.solid(-3.75, -3.4, -1.2, -0.8, Infinity, false);
      // the fair around: festoons from the shed to the lamps, bunting along the eave, a stall and a cart, benches, plants
      stringLights(K, sx0, sh - 0.05, sz1, -3.9, 2.8, 1.6, 10, undefined, 0.35, 0.6);
      stringLights(K, sx1, sh - 0.05, sz1, 4.0, 2.8, 1.6, 10, undefined, 0.35, 0.6);
      stringLights(K, -3.9, 2.8, 1.6, 4.0, 2.8, 1.6, 18, ['#ffcf6a', '#ff8fa3', '#7fd6e6'], 0.5, 0.6);
      bunting(K, sx0 - 0.2, sh - 0.12, sz1 + 0.14, sx1 + 0.2, sh - 0.12, sz1 + 0.14, 16, ['#a3122a', '#ffcf4a', '#3a6aa8', '#ffffff'], 0.25);
      K.prop('stall', -3.4, 0, -3.0, 0.5, 0.9, { variant: 1 });
      K.prop('cart', 3.6, 0, 2.7, -0.6, 0.9);
      K.prop('bench', -3.0, 0, 2.6, 0.4, 1.0);
      potPlant(K, -1.0, 0, 2.9, 1.2, '#ff8fa3'); potPlant(K, 2.0, 0, 3.2, 1.2, '#ffcf4a'); K.solid(-1.25, -0.75, 2.65, 3.15, 0.6); K.solid(1.75, 2.25, 2.95, 3.45, 0.6);
      // street lamps (real light + pools)
      K.prop('lamp', -3.9, 0, -1.4, 0, 1.0); K.prop('lamp', 4.0, 0, 0.2, 0, 1.0);
      K.light(-3.9, 2.9, -1.4, '#ffcf6a', 5, 9, 1.4, 2); K.light(4.0, 2.9, 0.2, '#ffcf6a', 5, 9, 1.4, 1);
      K.splash(-3.9, 0.03, -1.4, 3.4, 3.4, '#ffcf6a', 0.25, 0, -Math.PI / 2); K.splash(4.0, 0.03, 0.2, 3.4, 3.4, '#ffcf6a', 0.25, 0, -Math.PI / 2);
      K.light(0.6, 3.1, -1.8, '#ffd9a0', 4, 7, 0, 2);
      // the smith works the anvil; the site's real enchant run drives the hammer (hookSiteForge → AnvilFx)
      const smith = R.npc({ seed: 'кузнец', name: 'Кузнец', x: 0.2, z: -2.2, face: Math.atan2(-0.72, -0.2), look: { shape: 'box', color: '#c9884a', hat: 'cap', acc: ['mustache'] }, gear: { w: 'hammer' },
        hello: ['Клади на наковальню — подточим!', 'Звезда — к удаче, сфера — от поломки. Что точим?', 'Горн разогрет. Выбирай вещь!'], lines: ['Тук-тук! Ещё немного…'] });
      const fx = new AnvilFx({ top: new THREE.Vector3(0.92, 0.87, -1.98), smith, flash: fire, itemModels: env.itemModels || null, siteAni: siteAniOf(), siteV3: () => siteForgeV3() });
      R.root.add(fx.root);
      { const base = fire.intensity; R.onUpdate((dt, t) => { fx.update(dt, t); fire.intensity += (base * (0.85 + 0.1 * Math.sin(t * 13) * Math.sin(t * 5.3)) - fire.intensity) * Math.min(1, dt * 3); }); }
      const unhook = hookSiteForge(fx);
      R.onDispose(() => { unhook(); fx.dispose(); });
      R.root.userData.l3dAnvil = fx;   // dev tools / tests
      K.camBoxes.push(sx0 - 0.4, sx1 + 0.4, sh, sh + 1, sz0 - 0.4, sz1 + 0.6);
      R.spawn = { x: 0.2, z: 1.8, face: 0 };
      // way back to the street: the whole front edge
      // (a one-sided plane facing the shed: the TP camera behind it looks through, never «at» the exit)
      R.interact({ id: 'room:exit', label: 'Выйти на улицу', icon: '🚪', hit: hitPlane(0, 1.1, D / 2 - 0.3, W, 2.2, Math.PI, 'room:hit:exit'), reach: 3, use: () => R.env.exit() });
      return { x: 1.0, y: 0.6, z: -2.0, w: 1.4, h: 1.2, d: 1.0 };
    },
  },
  /* ---------------------------------------------------------------- generic hall for unknown buildings */
  plain: {
    side: 'left',
    build(R, env) {
      const K = R.kit, P = R.pal, W = 8, D = 7, H = 3.6;
      K.shell({ w: W, d: D, h: H, wall: 'plaster', wallCol: P.plaster, wainscot: P.wood, floor: 'wood', floorCol: '#9a6a48', ceiling: 'beams' });
      patternRug(K, -1.4, 1.4, -1.2, 2.4, '#8a3a4a', '#ffcf4a', '#3a6aa8');
      const C = new Frame(1.2, -D / 2, 0); counter(R, C, -1.1, 1.1, 1.3, 1.9);
      K.sign(env.building.title || 'Здание', 0, 2.9, -D / 2 + 0.05, 2.2);
      K.prop('barrel', -W / 2 + 0.6, 0, -D / 2 + 0.6, 0, 0.9); K.prop('crate', -W / 2 + 0.6, 0, -D / 2 + 1.5, 0.3, 0.8);
      K.lantern(-1.2, 2.9, 0, H - 0.2); K.lantern(1.4, 2.9, 0.5, H - 0.2);
      wallLamp(K, -1.2, 2.2, D / 2, Math.PI, { real: 2 }); potPlant(K, W / 2 - 0.45, 0, D / 2 - 0.45, 1.1, '#ffcf4a'); K.solid(W / 2 - 0.7, W / 2, D / 2 - 0.7, D / 2, 0.6);
      stringLights(K, -W / 2 + 0.2, H - 0.3, 0.0, W / 2 - 0.2, H - 0.3, 0.0, 12, undefined, 0.35, 0.55);
      cloth(K, 0.1, 2.3, -D / 2 + 1.25, -D / 2 + 1.95, COUNTER_TOP + 0.001, '#3a6aa8', 0.12, '#ffcf4a'); candle(K, 0.4, COUNTER_TOP + 0.013, -D / 2 + 1.6);
      wallShelf(K, W / 2, 1.5, -1.6, -Math.PI / 2, 1.6, 'jars'); wallShelf(K, W / 2, 2.2, -1.6, -Math.PI / 2, 1.6, 'books');
      K.window('right', 1.2, 1.1, 1.0, 1.2); painting(K, W / 2, 2.3, -0.2, -Math.PI / 2, 0.6, 0.5, ['#7fb0e8', '#9fe35a', '#ffcf6a']);
      K.cyl('wood', '#b07a4a', 2.4, 0, 1.4, 0.07, 0.7, 8); K.cyl('wood', '#d9a066', 2.4, 0.7, 1.4, 0.45, 0.05, 16); K.solid(2.0, 2.8, 1.0, 1.8, 0.75);
      mug(K, 2.3, 0.75, 1.3); candle(K, 2.55, 0.75, 1.45); stool(K, 1.7, 1.6, '#e0504a'); stool(K, 3.1, 1.2, '#3a6aa8');
      wallLamp(K, W / 2, 2.4, 1.2, -Math.PI / 2, { pool: 0.8 }); potPlant(K, -W / 2 + 0.45, 0, -D / 2 + 0.45, 1.1, '#ff8fa3');
      bunting(K, -W / 2 + 0.1, H - 0.25, 1.6, W / 2 - 0.1, H - 0.25, 1.6, 12, ['#e0504a', '#ffcf4a', '#3f8f8a'], 0.3);
      K.prop('bench', -2.6, 0, 0.6, Math.PI / 2, 1.0); K.prop('crate', -3.4, 0, 2.6, 0.2, 0.8); basket(K, -3.4, 0.58, 2.6, 0.18, ['#e0504a', '#ffd84a']);
      R.npc({ seed: 'хозяин-' + env.building.id, name: 'Хозяин', x: 1.2, z: -D / 2 + 0.85, y: DAIS, face: Math.PI, look: { hat: 'cap' }, hello: ['Заходи, {n}!'] });
      R.exitDoor();
      R.spawn = { x: 0.6, z: D / 2 - 0.9, face: 0 };
      return { x: 1.2, y: 0.9, z: -D / 2 + 1.6, w: 2.2, h: 1.8, d: 1.2 };
    },
  },
};
