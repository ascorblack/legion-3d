/**
 * «Шахта 3.0» (site 29.10, flag mine3): the big non-linear floor in 3D — the static parts the scene (scene.ts) bakes into
 * RoomKit batches, and the pure rule of which cell gets which rock.
 *
 * What the player sees mirrors the site's mine3.js: rock is one solid mass, the passages are the open cells (dug, or open
 * by type: lift / void / shaft); diggable stones of the front are boulders at the edge of a passage, deeper rock shows only
 * ore streaks; cells the site does not list (fog: t 'fog') are pitch-dark rock with nothing known about them — the 3D view
 * never reveals what the site hides. Vein sparks glow on the fog edge where the server says a vein continues (veins[k][3]).
 * The lift hall (hallBox) carries the lift cage, the supplier, the buyer and the board (scene.buildEntrance with the big
 * floor's FOOT); special halls (lake / grotto / adit), drill rigs and the lift shaft are drawn on their cells.
 *
 * Only cells next to a passage get a rock instance (the rest is hidden behind them under the ceiling): a 32 × 18 floor
 * with a few dozen dug cells needs ~100 instances in 5 InstancedMesh calls; the static batches add ~15 calls.
 */
import * as THREE from 'three';
import type { RoomKit } from '../common/kit';
import { OPEN3, type MineGeom } from './geo3';
import type { Floor } from './state';
import { rockGeo, crystalGeo, oreCol, type MinePal } from './art';

export type Slot3 = 'stone' | 'mass' | 'wall' | 'fog';
export const CEIL3 = 5.4;

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0);
const rnd = (i: number, k: number) => { const h = Math.sin(i * 127.1 + k * 311.7) * 43758.5453; return h - Math.floor(h); };
function mix(a: string, b: string, k: number): string { return '#' + new THREE.Color(a).lerp(new THREE.Color(b), k).getHexString(); }

/** Cell i is a passage: dug, or open by its (visible) type. */
export function open3(F: Floor, dug: ArrayLike<number>, i: number): boolean {
  return !!dug[i] || (!!F.vis && !!F.vis[i] && OPEN3.has(F.cells[i].t));
}

/**
 * Rock of every cell of a big floor (null = passage or hidden deep inside the mass): 'fog' — not shown by the site (dark,
 * nothing known), 'wall' — a rock face that cannot be dug, 'stone' — a front stone (a boulder that can be dug now), 'mass' —
 * visible rock deeper in (solid, with ore streaks). Only cells touching a passage (8 neighbours) are listed.
 */
export function slots3(G: MineGeom, F: Floor, dug: ArrayLike<number>, front: ReadonlySet<number>): (Slot3 | null)[] {
  const w = G.w, h = G.h, out: (Slot3 | null)[] = new Array(G.N).fill(null);
  const op = new Uint8Array(G.N); for (let i = 0; i < G.N; i++) op[i] = open3(F, dug, i) ? 1 : 0;
  for (let i = 0; i < G.N; i++) {
    if (op[i]) continue;
    const gx = i % w, gy = Math.floor(i / w); let near = false;
    for (let dy = -1; dy <= 1 && !near; dy++) for (let dx = -1; dx <= 1; dx++) { const X = gx + dx, Y = gy + dy; if (X >= 0 && Y >= 0 && X < w && Y < h && op[Y * w + X]) { near = true; break; } }
    if (!near) continue;
    const vis = !!F.vis && !!F.vis[i], t = F.cells[i] ? F.cells[i].t : 'fog';
    out[i] = !vis || t === 'fog' ? 'fog' : t === 'wall' ? 'wall' : front.has(i) ? 'stone' : 'mass';
  }
  return out;
}

/** Room-space centre of cell i (metres). */
const cm = (G: MineGeom, i: number) => { const p = G.cellXY(i); return { x: G.mx(p.cx), z: G.mz(p.cy) }; };

export interface Cave3Out {
  /** Lantern points (x, y, z …) for the real hall lights that follow the player. */
  lanterns: number[];
}

/**
 * The floor-wide static batch: ground, ceiling, the rock ring around the floor (PAD), stalactites, the lift hall's planks,
 * frame and lanterns. Rebuilt only for a new floor.
 */
export function buildCave3(kit: RoomKit, G: MineGeom, F: Floor, P: MinePal, addPool: (x: number, y: number, z: number, r: number, c: string, g: number) => number): Cave3Out {
  const lanterns: number[] = [];
  const x0 = G.mx(0), x1 = G.mx(G.W), z0 = G.mz(0), z1 = G.mz(G.H);
  kit.box('lowPaving', P.floor, x0 - 2, x1 + 2, -0.2, 0, z0 - 2, z1 + 2);
  kit.box('stone', P.wall, x0 - 3, x1 + 3, CEIL3, CEIL3 + 0.6, z0 - 3, z1 + 3);
  // rock ring around the floor (the site's PAD of solid rock): pillars on the outside cells next to the grid
  const lump = rockGeo('pillar', 1), w = G.w, h = G.h, cw = G.CW * G.K;
  const gx0 = G.mx(G.cellXY(0).cx), gz0 = G.mz(G.cellXY(0).cy);
  for (let gy = -1; gy <= h; gy++) for (let gx = -1; gx <= w; gx++) {
    if (gx >= 0 && gy >= 0 && gx < w && gy < h) continue;
    const k = (gy + 2) * (w + 4) + gx + 2, x = gx0 + gx * cw, z = gz0 + gy * cw;
    _q.setFromAxisAngle(_up, rnd(k, 4) * 6.28);
    kit.geo('stone', lump.geo, _m.compose(_p.set(x, -0.05, z), _q, _s.set(1.5, CEIL3 + 0.5, 1.5)), mix(P.wall, P.wallL, rnd(k, 5) * 0.5), 1);
  }
  // stalactites over the whole floor (under the ceiling, never in a stone's way)
  const cone = new THREE.ConeGeometry(1, 1, 5).rotateX(Math.PI);
  const nSt = Math.min(260, Math.round(w * h * 0.35));
  for (let k = 0; k < nSt; k++) {
    const x = x0 + rnd(k, 11) * (x1 - x0), z = z0 + rnd(k, 12) * (z1 - z0), hh = 0.35 + rnd(k, 13) * 0.8, r = 0.1 + rnd(k, 14) * 0.14;
    kit.geo('stone', cone, _m.compose(_p.set(x, CEIL3 - hh / 2, z), _q.identity(), _s.set(r, hh, r)), mix(P.wall, P.wallL, 0.5), 1);
  }
  cone.dispose();
  // the lift hall: plank floor, a timber frame round it, four corner lanterns and a light
  const [hx, hy, hw, hh2] = G.hall, ax = G.mx(hx), bx = G.mx(hx + hw), az = G.mz(hy), bz = G.mz(hy + hh2);
  for (let z = az + 0.3; z < bz - 0.2; z += 0.62) kit.box('wood', (Math.round(z * 10) % 2) ? '#8a5a32' : '#7a4e2a', ax + 0.25, bx - 0.25, 0, 0.04, z, z + 0.56);
  for (const [px0, pz0] of [[ax + 0.2, az + 0.2], [bx - 0.2, az + 0.2], [ax + 0.2, bz - 0.2], [bx - 0.2, bz - 0.2]]) {
    kit.box('wood', '#6e4626', px0 - 0.14, px0 + 0.14, 0, 4.3, pz0 - 0.14, pz0 + 0.14);
    const sx = px0 < (ax + bx) / 2 ? 1 : -1, sz = pz0 < (az + bz) / 2 ? 1 : -1, lx = px0 + sx * 0.32, lz = pz0 + sz * 0.32, ly = 2.6;
    kit.box('metal', '#2a2440', px0, lx, 2.98, 3.04, lz - 0.025, lz + 0.025);
    kit.cone('metal', '#2a2440', lx, 2.78, lz, 0.13, 0.1, true);
    kit.box('emit', '#ffd27a', lx - 0.075, lx + 0.075, ly - 0.14, ly + 0.14, lz - 0.075, lz + 0.075);
    kit.glow(lx, ly, lz, 1.9, '#ffb35c', 1.0);
    addPool(lx, ly, lz, 5.2, '#ffad55', 1.3);
    lanterns.push(lx, ly + 0.2, lz);
  }
  kit.box('wood', '#7a4e2a', ax, bx, 4.3, 4.6, az + 0.06, az + 0.34);
  kit.box('wood', '#7a4e2a', ax, bx, 4.3, 4.6, bz - 0.34, bz - 0.06);
  for (const x of [ax + 0.06, bx - 0.34]) kit.box('wood', '#7a4e2a', x, x + 0.28, 4.3, 4.6, az, bz);
  kit.light((ax + bx) / 2, 3.4, (az + bz) / 2 + 0.6, '#ffcf6a', 6, 11, 1.2);
  addPool((ax + bx) / 2, 3.4, (az + bz) / 2, 7, '#ffcf6a', 0.9);
  return { lanterns };
}

/**
 * The part that changes while the floor is dug (rebuilt with the rock layout): lanterns on the tunnel walls, special halls
 * (lake water, grotto crystals, adit timber), drill rigs, the lift shaft, vein sparks on the fog edge.
 */
export function buildDig3(kit: RoomKit, G: MineGeom, F: Floor, dug: ArrayLike<number>, slot: readonly (Slot3 | null)[], P: MinePal,
  addPool: (x: number, y: number, z: number, r: number, c: string, g: number) => number, lanterns: number[]): { sparks: number[] } {
  const w = G.w, half = G.CW * G.K / 2;
  const isRock = (j: number) => slot[j] != null;
  // tunnel lanterns: on every few dug cells, on the wall side (never in the lift hall: it has its own)
  for (let i = 0; i < G.N; i++) {
    if (!dug[i] || G.inZone(i)) continue;
    const gx = i % w, gy = Math.floor(i / w); if ((gx * 7 + gy * 13) % 5 !== 0) continue;
    const dirs: [number, number, number][] = [[0, -1, i - w], [1, 0, gx < w - 1 ? i + 1 : -1], [-1, 0, gx > 0 ? i - 1 : -1], [0, 1, i + w]];
    const d = dirs.find(([, , j]) => j >= 0 && j < G.N && isRock(j)); if (!d) continue;
    const c = cm(G, i), lx = c.x + d[0] * (half - 0.55), lz = c.z + d[1] * (half - 0.55), ly = 2.5;
    kit.box('wood', '#6e4626', lx - 0.06 + d[0] * 0.25, lx + 0.06 + d[0] * 0.25, 0, 3.0, lz - 0.06 + d[1] * 0.25, lz + 0.06 + d[1] * 0.25);
    kit.box('emit', '#ffd27a', lx - 0.07, lx + 0.07, ly - 0.13, ly + 0.13, lz - 0.07, lz + 0.07);
    kit.cone('metal', '#2a2440', lx, ly + 0.14, lz, 0.12, 0.09, true);
    kit.glow(lx, ly, lz, 1.6, '#ffb35c', 0.9);
    addPool(lx, ly, lz, 4.6, '#ffad55', 1.2);
    lanterns.push(lx - d[0] * 0.5, ly + 0.2, lz - d[1] * 0.5);
  }
  // special halls (site 29.10 рисунки): lake — water; grotto — crystal clusters; adit — old timber frames
  const hallKind = new Map<number, string>(); for (const hl of F.halls || []) hallKind.set(+hl[0], String(hl[1]));
  const cry = crystalGeo();
  for (let i = 0; i < G.N; i++) {
    const c = F.cells[i]; if (!F.vis || !F.vis[i] || c.hall == null || c.t === 'prize') continue;
    const k = hallKind.get(c.hall), p = cm(G, i);
    if (k === 'lake') { kit.box('water', '#2f6f9e', p.x - half, p.x + half, 0, 0.05, p.z - half, p.z + half); addPool(p.x, 0.6, p.z, 3.2, '#5fb4e8', 0.5); }
    else if (k === 'grotto') for (let q = 0; q < 3; q++) {
      const s = 0.35 + rnd(i, q + 30) * 0.4;
      _q.setFromAxisAngle(new THREE.Vector3(rnd(i, q + 31) - 0.5, 1, rnd(i, q + 32) - 0.5).normalize(), rnd(i, q + 33) * 0.5);
      kit.geo('emit', cry, _m.compose(_p.set(p.x + (rnd(i, q) - 0.5) * 1.6, 0, p.z + (rnd(i, q + 9) - 0.5) * 1.6), _q, _s.set(s, s * 1.8, s)), '#8fe3ff', 1);
      addPool(p.x, 1, p.z, 3.4, '#8fe3ff', 0.7);
    } else if (k === 'adit' && (i % w) % 2 === 0) {
      for (const sx of [-1, 1]) kit.box('wood', '#9a6a3a', p.x + sx * (half - 0.3) - 0.12, p.x + sx * (half - 0.3) + 0.12, 0, 3.4, p.z - 0.12, p.z + 0.12);
      kit.box('wood', '#9a6a3a', p.x - half + 0.15, p.x + half - 0.15, 3.3, 3.55, p.z - 0.14, p.z + 0.14);
    }
  }
  // drill rigs (site drillArt): site / build — stakes and scaffolding; lv 1 wooden derrick, 2 iron with a wheel, 3 big with a lamp; dry — grey
  for (const [i, d] of F.drills || []) {
    if (i < 0 || i >= G.N) continue;
    const p = cm(G, i), wood = d.st === 'dry' ? '#8d8a86' : d.lv <= 1 ? '#a87a4a' : '#7d8ba0';
    if (d.st === 'site' || (d.st === 'build' && !d.lv)) {
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) kit.box('wood', '#c49a62', p.x + sx * 0.8 - 0.05, p.x + sx * 0.8 + 0.05, 0, 0.7, p.z + sz * 0.8 - 0.05, p.z + sz * 0.8 + 0.05);
      if (d.st === 'build') { for (const y of [1.2, 2.4]) kit.box('wood', '#c49a62', p.x - 0.8, p.x + 0.8, y, y + 0.08, p.z - 0.05, p.z + 0.05); }
      continue;
    }
    const lv = Math.max(1, d.lv), H = 2.4 + lv * 0.55;
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) kit.rbox('wood', wood, p.x + sx * 0.5, H / 2, p.z + sz * 0.5, 0.14, H, 0.14, 0, sz * 0.12, -sx * 0.12);
    for (const y of [0.9, 1.8]) kit.box('wood', wood, p.x - 0.62, p.x + 0.62, y, y + 0.1, p.z - 0.62, p.z + 0.62);
    kit.box('metal', '#4a4a52', p.x - 0.06, p.x + 0.06, 0, H - 0.2, p.z - 0.06, p.z + 0.06);
    if (lv >= 2) kit.cyl('metal', '#a9b6c8', p.x + 0.75, 0.4, p.z, 0.4, 0.12, 12);
    if (lv >= 3) { kit.ball('emit', '#ffd27a', p.x, H + 0.2, p.z, 0.22); addPool(p.x, H, p.z, 4, '#ffd27a', 0.9); }
    if (d.r && d.st !== 'dry') kit.ball('flat', oreCol(d.r)[0], p.x - 0.9, 0.25, p.z + 0.6, 0.22, 0.8);
    kit.sign(d.st === 'dry' ? 'иссякла' : 'ур. ' + lv, p.x, H + 0.6, p.z + 0.1, 1.0, 0, { bg: '#3a2a5e', fg: d.st === 'dry' ? '#cfcac2' : '#ffe08a' });
  }
  // the lift shaft (site: «ШАХТА ЛИФТА» — the way to the next floor, far from the lift, under the fog)
  const sh = F.shaft ?? -1;
  if (sh >= 0 && sh < G.N && F.vis && F.vis[sh]) {
    const p = cm(G, sh);
    kit.floorDisc('flat', '#0a0810', p.x, p.z, 1.15, 0.02);
    for (const sx of [-1, 1]) kit.box('wood', '#6b4423', p.x + sx * 0.85 - 0.1, p.x + sx * 0.85 + 0.1, 0, 2.4, p.z - 0.1, p.z + 0.1);
    kit.box('wood', '#6b4423', p.x - 1.05, p.x + 1.05, 2.4, 2.6, p.z - 0.12, p.z + 0.12);
    kit.sign('ШАХТА ЛИФТА', p.x, 3.0, p.z + 0.14, 1.9, 0, { bg: '#3a2a5e', fg: '#ffd27a' });
    addPool(p.x, 2, p.z, 4, '#ff9a3c', 0.9);
  }
  const spark: number[] = [];
  // vein sparks: the server names the cells where a vein goes on behind the fog (veins[k][3]); those cells are always
  // behind visible rock, so the sparks sit on the rock face of the nearest passage that looks their way («копай сюда»)
  for (const v of F.veins || []) {
    const col = oreCol(String(v[1]))[0];
    for (const i of v[3] || []) {
      if (i < 0 || i >= G.N || (F.vis && F.vis[i])) continue;
      const gx = i % w, gy = Math.floor(i / w);
      let best = -1, bd = 1e9;
      for (let dy = -6; dy <= 6; dy++) for (let dx = -6; dx <= 6; dx++) {
        const X = gx + dx, Y = gy + dy; if (X < 0 || Y < 0 || X >= w || Y >= G.h) continue;
        const o = Y * w + X; if (!open3(F, dug, o)) continue;
        const d = Math.abs(dx) + Math.abs(dy); if (d < bd) { bd = d; best = o; }
      }
      if (best < 0) continue;
      const ox = best % w, oy = Math.floor(best / w), ddx = gx - ox, ddy = gy - oy;
      const sx = Math.abs(ddx) >= Math.abs(ddy) ? Math.sign(ddx) : 0, sz = sx ? 0 : Math.sign(ddy);
      const q = (oy + sz) * w + ox + sx; if (q < 0 || q >= G.N || !slot[q]) continue;
      const p = cm(G, best);
      const y = 1.2 + rnd(i, 3) * 1.1, x = p.x + sx * 0.9, z = p.z + sz * 0.9;
      kit.glow(x, y, z, 0.8, col, 2.6);
      kit.ball('emit', col, x, y, z, 0.11);
      spark.push(x, y, z);
    }
  }
  return { sparks: spark };
}
