/**
 * Shop furniture laid out along walls: a local frame (origin on the wall, lx along the wall, lz out of the wall,
 * rotation in 90° steps) so the same stand / shelf code works on any wall.
 */
import * as THREE from 'three';
import { GEO, type MatKey } from '../../world/batch';

const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _m = new THREE.Matrix4(), _v = new THREE.Vector3(), _s = new THREE.Vector3();
const _X = new THREE.Vector3(1, 0, 0), _Y = new THREE.Vector3(0, 1, 0);
import { shade } from '../../world/kit';

const shadeOf = (c: string) => shade(c, -0.35);
import type { RoomBase } from '../common/base';
import type { StockItem, StockStand } from '../common/stock';

export class Frame {
  readonly c: number; readonly s: number;
  /** ry: 0 = wall is the back wall (things face +Z); π/2 = left wall (face +X); −π/2 = right wall (face −X). */
  constructor(readonly ox: number, readonly oz: number, readonly ry: number) { this.c = Math.round(Math.cos(ry)); this.s = Math.round(Math.sin(ry)); }
  /** Local (lx along the wall, lz out of it) → room x. */
  x(lx: number, lz: number): number { return this.ox + this.c * lx + this.s * lz; }
  z(lx: number, lz: number): number { return this.oz - this.s * lx + this.c * lz; }
  box(R: RoomBase, mat: MatKey, col: string, lx0: number, lx1: number, y0: number, y1: number, lz0: number, lz1: number): void {
    const xa = this.x(lx0, lz0), xb = this.x(lx1, lz1), za = this.z(lx0, lz0), zb = this.z(lx1, lz1);
    R.kit.box(mat, col, Math.min(xa, xb), Math.max(xa, xb), y0, y1, Math.min(za, zb), Math.max(za, zb));
  }
  solid(R: RoomBase, lx0: number, lx1: number, lz0: number, lz1: number, top: number): void {
    const xa = this.x(lx0, lz0), xb = this.x(lx1, lz1), za = this.z(lx0, lz0), zb = this.z(lx1, lz1);
    R.kit.solid(Math.min(xa, xb), Math.max(xa, xb), Math.min(za, zb), Math.max(za, zb), top);
  }
  /** Yaw for things facing out of the wall. */
  get face(): number { return this.ry; }
}

export interface StandOpts {
  w?: number; board?: string; trim?: string; sign?: { bg?: string; fg?: string }; b: string; lamp?: string; cloth?: string;
  /** Cast iron instead of painted wood (cherts forge): iron board and shelves, a lava line along the shelf fronts, gold rivets. */
  iron?: { lava: string; rivet: string };
}

/**
 * A stand like the site's (Кузня / Лавка звездочёта): title sign, top row of hanging goods (weapons), a shelf for the
 * middle row (shields, hats), and the «case» row on a plinth in front (armour on mannequins, charms on cushions).
 */
export function stand(R: RoomBase, F: Frame, st: StockStand, o: StandOpts): void {
  const P = R.pal, w = o.w ?? 2.5, hw = w / 2;
  const board = o.board || P.woodD, trim = o.trim || P.woodL;
  // back board + posts + crown
  const wm = o.iron ? 'metal' as const : 'wood' as const;
  F.box(R, wm, board, -hw, hw, 0, 2.35, 0, 0.08);
  F.box(R, wm, trim, -hw - 0.08, -hw + 0.04, 0, 2.5, 0, 0.14);
  F.box(R, wm, trim, hw - 0.04, hw + 0.08, 0, 2.5, 0, 0.14);
  F.box(R, wm, trim, -hw - 0.12, hw + 0.12, 2.36, 2.46, 0, 0.18);
  // pegboard rail for the top row + tag rail
  F.box(R, 'metal', P.metal, -hw + 0.1, hw - 0.1, 2.02, 2.05, 0.08, 0.13);
  F.box(R, wm, trim, -hw + 0.05, hw - 0.05, 1.18, 1.24, 0.08, 0.16);
  // middle shelf
  F.box(R, wm, trim, -hw + 0.04, hw - 0.04, 0.9, 0.96, 0.08, 0.46);
  F.box(R, wm, board, -hw + 0.04, -hw + 0.1, 0.5, 0.9, 0.09, 0.45);   // brackets under the shelf (not flush with it)
  F.box(R, wm, board, hw - 0.1, hw - 0.04, 0.5, 0.9, 0.09, 0.45);
  // plinth for the case row
  F.box(R, wm, o.iron ? board : P.woodD, -hw, hw, 0, 0.16, 0.5, 1.15);
  F.box(R, wm, trim, -hw - 0.02, hw + 0.02, 0.16, 0.19, 0.48, 1.17);
  if (o.iron) {   // the site's iron shelf: a glowing lava line along the front edge, gold rivets
    F.box(R, 'emit', o.iron.lava, -hw + 0.08, hw - 0.08, 0.915, 0.935, 0.46, 0.468);
    F.box(R, 'emit', o.iron.lava, -hw + 0.02, hw - 0.02, 0.06, 0.08, 1.15, 1.158);
    for (const lx of [-hw + 0.12, 0, hw - 0.12]) for (const [y, d] of [[2.41, 0.18], [0.93, 0.46]] as const) R.kit.ball('metal', o.iron.rivet, F.x(lx, d + 0.005), y, F.z(lx, d + 0.005), 0.025);
  }
  // lamp over the stand: brass hood + a warm light strip under the crown, a pool of light on the back board and the
  // floor in front (splashes: lit at every quality), and a real light while the quality allows (prio 2)
  const lamp = o.lamp || '#ffcf6a';
  F.box(R, 'metal', P.metal, -0.03, 0.03, 2.46, 2.52, 0.14, 0.55);
  F.box(R, 'metal', '#c9a04a', -hw + 0.1, hw - 0.1, 2.28, 2.34, 0.12, 0.2);
  F.box(R, 'emit', lamp, -hw + 0.14, hw - 0.14, 2.26, 2.28, 0.13, 0.19);
  for (let i = 0; i < 3; i++) { const lx = -hw * 0.6 + i * hw * 0.6; R.kit.glow(F.x(lx, 0.2), 2.24, F.z(lx, 0.2), 0.6, lamp, 0.55); }
  R.kit.box('emit', lamp, Math.min(F.x(-0.12, 0.47), F.x(0.12, 0.53)), Math.max(F.x(-0.12, 0.47), F.x(0.12, 0.53)), 2.38, 2.46, Math.min(F.z(-0.12, 0.47), F.z(0.12, 0.53)), Math.max(F.z(-0.12, 0.47), F.z(0.12, 0.53)));
  R.kit.splash(F.x(0, 0.1), 1.45, F.z(0, 0.1), w * 1.25, 2.2, lamp, 0.42, F.face);
  R.kit.splash(F.x(0, 0.95), 0.02, F.z(0, 0.95), w * 1.1, 1.5, lamp, 0.22, F.face, -Math.PI / 2);
  R.kit.light(F.x(0, 1.0), 2.25, F.z(0, 1.0), '#ffc27a', 3.6, 5, 0.9, 2);
  // a cloth runner on the plinth in the stand's colour
  if (o.cloth) { F.box(R, 'canvas', o.cloth, -hw + 0.05, hw - 0.05, 0.19, 0.2, 0.55, 1.12); F.box(R, 'canvas', o.cloth, -hw + 0.05, hw - 0.05, 0.08, 0.2, 1.12, 1.135); }
  // sign
  if (st.name) R.kit.sign(st.name, F.x(0, 0.2), 2.72, F.z(0, 0.2), Math.min(2.2, w * 0.85), F.face, { bg: o.sign?.bg, fg: o.sign?.fg });
  F.solid(R, -hw - 0.1, hw + 0.1, 0, 0.5, Infinity);
  F.solid(R, -hw, hw, 0.5, 1.17, 0.19);

  const row = (items: StockItem[] | undefined, fn: (it: StockItem, lx: number, i: number, n: number) => void) => {
    const L = (items || []).slice(0, 6), n = L.length;
    L.forEach((it, i) => fn(it, n === 1 ? 0 : -hw + 0.38 + (w - 0.76) * (i / (n - 1)), i, n));
  };
  // top: hanging (weapons grip-down, ~0.7 m)
  row(st.top, (it, lx) => {
    const tall = it.slot === 'weapon';
    R.good(it, o.b, { x: F.x(lx, 0.2), y: tall ? 1.3 : 1.36, z: F.z(lx, 0.2), ry: F.face, fit: tall ? 0.74 : 0.5, fitH: tall }, [F.x(lx, 0.19), 1.11, F.z(lx, 0.19), F.face, -0.15]);
    // a dark plaque behind every hanging good + hook
    F.box(R, 'wood', shadeOf(board), lx - 0.2, lx + 0.2, 1.27, 2.0, 0.08, 0.1);
    F.box(R, 'metal', P.metal, lx - 0.015, lx + 0.015, 2.0, 2.05, 0.1, 0.2);
  });
  // mid: on the shelf
  row(st.mid, (it, lx) => {
    R.good(it, o.b, { x: F.x(lx, 0.27), y: 0.96, z: F.z(lx, 0.27), ry: F.face, fit: it.slot === 'helmet' ? 0.42 : 0.44, fitH: it.slot === 'helmet' }, [F.x(lx, 0.47), 0.86, F.z(lx, 0.47), F.face, -0.35]);
  });
  // case: on the plinth
  row(st.case, (it, lx) => {
    const arm = it.slot === 'armor';
    R.good(it, o.b, { x: F.x(lx, 0.82), y: 0.19, z: F.z(lx, 0.82), ry: F.face, fit: arm ? 1.05 : 0.4, fitH: arm }, [F.x(lx, 1.19), 0.1, F.z(lx, 1.19), F.face, -0.25]);
  });
}

/** Height of a counter top (goods stand on it). */
export const COUNTER_TOP = 0.74;
/** Height of the keeper's dais behind a counter. */
export const DAIS = 0.3;

/** A counter (shop desk) along the frame's lx axis, at distance lz from the wall. Top at COUNTER_TOP, with a dais behind it. */
export function counter(R: RoomBase, F: Frame, lx0: number, lx1: number, lz0: number, lz1: number, col?: string, top?: string, mat: 'wood' | 'metal' = 'wood'): void {
  const P = R.pal;
  F.box(R, mat, col || P.wood, lx0, lx1, 0, COUNTER_TOP - 0.06, lz0, lz1);
  F.box(R, mat, top || P.woodL, lx0 - 0.05, lx1 + 0.05, COUNTER_TOP - 0.06, COUNTER_TOP, lz0 - 0.05, lz1 + 0.05);
  // panels
  const n = Math.max(1, Math.round((lx1 - lx0) / 0.8));
  for (let i = 0; i < n; i++) { const a = lx0 + (lx1 - lx0) * (i + 0.15) / n, b = lx0 + (lx1 - lx0) * (i + 0.85) / n; F.box(R, mat, mat === 'metal' ? '#2a2028' : P.woodD, a, b, 0.1, COUNTER_TOP - 0.14, lz1, lz1 + 0.02); }
  F.solid(R, lx0 - 0.05, lx1 + 0.05, lz0 - 0.05, lz1 + 0.05, COUNTER_TOP);
  // keeper's dais behind the counter (so a ~1.35 m chibi shows above it)
  F.box(R, 'wood', P.woodD, lx0 + 0.1, lx1 - 0.1, 0, DAIS, lz0 - 0.9, lz0 - 0.05);
  const xa = F.x(lx0 + 0.1, lz0 - 0.9), xb = F.x(lx1 - 0.1, lz0 - 0.05), za = F.z(lx0 + 0.1, lz0 - 0.9), zb = F.z(lx1 - 0.1, lz0 - 0.05);
  R.kit.floors.push([Math.min(xa, xb), Math.max(xa, xb), Math.min(za, zb), Math.max(za, zb), DAIS]);
}

/** Wall shelves: n levels of planks with goods in a grid. Painted (col = back, side = posts/planks, lip = front edge). */
export function shelves(R: RoomBase, F: Frame, items: StockItem[], b: string, o: { w: number; levels: number[]; depth?: number; fit?: number; col?: string; side?: string; lip?: string; mat?: 'wood' | 'plaster'; iron?: boolean }): void {
  // iron: cast-iron sides and boards, the lip glows like lava (cherts)
  const fm = o.iron ? 'metal' as const : 'wood' as const;
  const P = R.pal, hw = o.w / 2, d = o.depth ?? 0.4, per = Math.ceil(items.length / o.levels.length);
  const top = o.levels[o.levels.length - 1] + 0.5;
  const side = o.side || P.woodL;
  F.box(R, o.mat || 'wood', o.col || P.woodD, -hw, hw, 0, top, 0, 0.075);   // proud of the wainscot cap (6 cm)
  F.box(R, fm, side, -hw - 0.06, -hw, 0, top, 0, d + 0.02);
  F.box(R, fm, side, hw, hw + 0.06, 0, top, 0, d + 0.02);
  F.box(R, fm, side, -hw - 0.1, hw + 0.1, top, top + 0.08, 0, d + 0.08);
  F.solid(R, -hw - 0.06, hw + 0.06, 0, d + 0.05, Infinity);
  o.levels.forEach((y, li) => {
    F.box(R, fm, side, -hw, hw, y - 0.05, y, 0.06, d + 0.02);
    if (o.lip) F.box(R, o.iron ? 'emit' : 'wood', o.lip, -hw, hw, y - 0.07, y + (o.iron ? -0.04 : 0.015), d, d + 0.035);
    const L = items.slice(li * per, li * per + per), n = L.length;
    L.forEach((it, i) => {
      const lx = n === 1 ? 0 : -hw + 0.3 + (o.w - 0.6) * (i / (n - 1));
      R.good(it, b, { x: F.x(lx, d * 0.5), y, z: F.z(lx, d * 0.5), ry: F.face, fit: o.fit ?? 0.26 }, [F.x(lx, d + 0.05), y - 0.08, F.z(lx, d + 0.05), F.face, -0.2]);
    });
  });
}

/** Striped scalloped awning along the frame's lx axis at height y, sticking out `out` m from the wall. */
export function awning(R: RoomBase, F: Frame, lx0: number, lx1: number, y: number, out: number, c1: string, c2: string): void {
  const n = Math.max(2, Math.round((lx1 - lx0) / 0.3)), sw = (lx1 - lx0) / n;
  for (let i = 0; i < n; i++) {
    const a = lx0 + i * sw, col = i % 2 ? c2 : c1;
    const cx = F.x(a + sw / 2, out / 2), cz = F.z(a + sw / 2, out / 2);
    _q.setFromAxisAngle(_Y, F.face).multiply(_q2.setFromAxisAngle(_X, 0.36));
    R.kit.geo('canvas', GEO.box, _m.compose(_v.set(cx, y - out * 0.18, cz), _q, _s.set(sw, 0.03, out * 1.03)), col);   // butt-joined strips (an overlap would share the top plane)
    R.kit.ball('canvas', col, F.x(a + sw / 2, out), y - out * 0.38, F.z(a + sw / 2, out), sw * 0.5, 0.45);
  }
}
