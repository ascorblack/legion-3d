/**
 * «Тюрьма и клетка» (site 30.10, citymap.js LOW.jail, art cityart.js lower(…, { jail })): on the lower street right of the
 * mine, against the retaining wall —
 *  - the jail: a stone house with a crenellated parapet, a barred window, an arched iron-bound door with rivets and a brass
 *    lock plate, the «ТЮРЬМА» sign, a torch by the door and a chain on the wall (it cannot be entered: E shows the site's
 *    Jail window, src/features/jail.ts);
 *  - the cage: a stone slab floor from the wall to the bar line `fy`, solid bars on the front and both sides (the streamer:
 *    «клетка закрыта полностью»), a framed door in the front grille shut with a padlock, a riveted top beam and a dark iron
 *    roof plate, straw and a bowl inside. Prisoners sit on LOW.jail.seats (drawn by the crowd, src/net/site.ts syncJail).
 * Colours and proportions follow the site's drawing (stone / iron / brass of cityart.js, sizes from LOW.jail), not its paths.
 * Solids mirror citymap.js JAIL_OBST: the house and the cage are solid from the wall to their base; the cage inside has a
 * finite floor (a prisoner stands on it, nobody gets in through the bars).
 */
import * as THREE from 'three';
import type { Building, JailGeo } from '../contracts';
import { jailGeoOf } from '../net/jail';
import { signF } from './buildings';
import { toX, toZ } from './coords';
import { GEO, M } from './batch';
import { type Ctx, box, rbox, ball, shade } from './kit';

/** Half disc (upper half, axis along z, radius 0.5, depth 1) for arched door heads. */
const HALF_DISC = new THREE.CylinderGeometry(0.5, 0.5, 1, 14, 1, false, -Math.PI / 2, Math.PI).rotateX(-Math.PI / 2);
const TORUS = new THREE.TorusGeometry(0.5, 0.16, 6, 12);
const HALF_TORUS = new THREE.TorusGeometry(0.5, 0.14, 6, 10, Math.PI);

/** The site's jail colours (cityart.js): stone fill per style family, dark mortar, iron, light iron, brass. */
export function jailColors(rock: string): { stone: string; stoneL: string; stoneD: string; iron: string; ironL: string; brass: string; beam: string } {
  // the site: legion '#7d7a8a', cats '#8a7a8e', monkeys '#8a8270' — a cool grey nudged towards the style's own rock tone
  const s = new THREE.Color('#7d7a8a').lerp(new THREE.Color(rock), 0.3);
  const stone = '#' + s.getHexString();
  return { stone, stoneL: shade(stone, 0.2), stoneD: '#4e4b5a', iron: '#2e2b36', ironL: '#8a8e9e', brass: '#c9a33a', beam: '#4a4552' };
}

/** World-space numbers of the jail (m) from LOW.jail (px). */
export function jailWorld(J: JailGeo, lowH: number, wallZ: number) {
  return {
    base: lowH, zw: wallZ,
    hx0: toX(J.x0 + 10), hx1: toX(J.x1 - 10), hz: toZ(J.base) - 0.08,   // house body (the site draws it 10 px inside x0…x1)
    cx0: toX(J.c0), cx1: toX(J.c1), cz: toZ(J.fy),                     // cage: posts at c0 / c1, bars on fy
    dx0: toX(J.door[0]), dx1: toX(J.door[1]),                          // the door in the front grille
    H: 2.15, wallH: 2.7,
  };
}

/** LOW.jail of the layout being built, per building object (src/world/static.ts sets it before the builders run). */
export const JAIL_GEO = new WeakMap<Building, JailGeo>();

/** Street model of the jail (BUILDING_MODELS.jail). */
export function jail(k: Ctx, b: Building): void {
  const J = JAIL_GEO.get(b) ?? jailGeoOf(b);
  if (!J) return;
  const W = jailWorld(J, k.lowH, k.wallZ), C = jailColors(k.pal.rock);
  house(k, b, W, C);
  cage(k, J, W, C);
}

/* ------------------------------------------------------------------ the house */

function house(k: Ctx, b: Building, W: ReturnType<typeof jailWorld>, C: ReturnType<typeof jailColors>): void {
  const P = k.pal, { base, zw, hx0, hx1, hz, wallH } = W, top = base + wallH, cx = (hx0 + hx1) / 2;
  // body (ashlar), a darker plinth course a little proud, the cornice band, a flat walkway behind the parapet
  box(k, 'stone', C.stone, hx0, hx1, base - 0.05, top, zw, hz, 0.7);
  box(k, 'stone', shade(C.stone, -0.18), hx0 - 0.04, hx1 + 0.04, base - 0.05, base + 0.32, zw + 0.02, hz + 0.04, 0.6);
  box(k, 'stone', C.stoneL, hx0 - 0.1, hx1 + 0.1, top - 0.02, top + 0.14, zw + 0.01, hz + 0.1, 0.6);
  // merlons along the front (site: 28 px every 68 px) and back along both sides
  const mw = 0.28, mh = 0.34, md = 0.26;
  for (let x = hx0 - 0.06, i = 0; x + mw <= hx1 + 0.1; x += 0.34, i++) if (i % 2 === 0) box(k, 'stone', C.stoneL, x, x + mw, top + 0.14, top + 0.14 + mh, hz + 0.1 - md, hz + 0.1, 0.6);
  for (const sx of [hx0 - 0.1, hx1 + 0.1 - md]) for (let z = hz - 0.58; z > zw + 0.3; z -= 0.68) box(k, 'stone', C.stoneL, sx, sx + md, top + 0.14, top + 0.14 + mh, z - mw, z, 0.6);
  // barred window left of the door: dark opening, a faint glass, three bars + a cross bar, a stone sill
  const wx0 = hx0 + 0.22, wx1 = wx0 + 0.46, wy0 = base + 1.3, wy1 = base + 2.04;
  box(k, 'stone', C.stoneD, wx0 - 0.06, wx1 + 0.06, wy0 - 0.06, wy1 + 0.06, hz, hz + 0.02);
  box(k, 'flat', '#2a2238', wx0, wx1, wy0, wy1, hz + 0.025, hz + 0.032);
  box(k, 'glass', '#3a3460', wx0 + 0.04, wx1 - 0.04, wy1 - 0.3, wy1 - 0.04, hz + 0.037, hz + 0.043);
  for (let i = 1; i <= 3; i++) { const x = wx0 + i * 0.115; box(k, 'metal', '#6a6676', x - 0.022, x + 0.022, wy0, wy1, hz + 0.05, hz + 0.09); }
  box(k, 'metal', '#6a6676', wx0, wx1, (wy0 + wy1) / 2 - 0.022, (wy0 + wy1) / 2 + 0.022, hz + 0.09, hz + 0.12);
  box(k, 'stone', C.stoneL, wx0 - 0.1, wx1 + 0.1, wy0 - 0.12, wy0 - 0.04, hz, hz + 0.14, 0.5);
  // the door: a stone arch frame, the iron-bound leaf with three bands of rivets, a brass lock plate, a step
  const d0 = cx - 0.4, d1 = cx + 0.4, dS = base + 1.5, r = 0.4, fr = 0.08;
  box(k, 'stone', C.stoneD, d0 - fr, d0, base, dS, hz, hz + 0.05);
  box(k, 'stone', C.stoneD, d1, d1 + fr, base, dS, hz, hz + 0.05);
  k.b.add('stone', HALF_DISC, M(cx, dS, hz + 0.025, (r + fr) * 2, (r + fr) * 2, 0.05), C.stoneD, 0.5);
  box(k, 'wood', '#4a4250', d0, d1, base, dS, hz + 0.05, hz + 0.09, 0.5);
  k.b.add('wood', HALF_DISC, M(cx, dS, hz + 0.07, r * 2, r * 2, 0.04), '#4a4250', 0.5);
  for (const yy of [base + 0.22, base + 0.86, base + 1.42]) {
    box(k, 'metal', C.iron, d0 + 0.02, d1 - 0.02, yy - 0.045, yy + 0.045, hz + 0.09, hz + 0.11);
    for (const xx of [d0 + 0.12, cx, d1 - 0.12]) ball(k, 'metal', C.ironL, xx, yy, hz + 0.112, 0.022);
  }
  box(k, 'metal', C.brass, d1 - 0.24, d1 - 0.1, base + 0.98, base + 1.2, hz + 0.09, hz + 0.115);
  ball(k, 'flat', P.line, d1 - 0.17, base + 1.1, hz + 0.118, 0.016);
  box(k, 'stone', shade(C.stone, 0.1), d0 - 0.16, d1 + 0.16, base, base + 0.06, hz, hz + 0.36, 0.6);
  // «ТЮРЬМА» sign over the door (site: 200 × 34 px plaque near the top of the wall)
  signF(k, b.title, cx, top - 0.62, hz, Math.min(1.9, hx1 - hx0 - 0.3));
  // torch right of the door: a bracket, the stick, a flame (low emissive core) — warm pool and a glow
  const tx = d1 + 0.32, ty = base + 1.5, tz = hz + 0.16;
  box(k, 'metal', C.iron, tx - 0.03, tx + 0.03, ty - 0.12, ty - 0.06, hz, tz);
  rbox(k, 'wood', P.woodD, tx, ty, tz, 0.05, 0.42, 0.05, 0, -0.12, 0, 0.5);
  // flame: a soft teardrop (a squashed ball under a slim tip, tilted a little), a bright core in front
  box(k, 'metal', C.iron, tx - 0.045, tx + 0.045, ty + 0.15, ty + 0.2, tz - 0.015, tz + 0.075);   // the cup
  ball(k, 'emit', '#ff9a2e', tx, ty + 0.27, tz + 0.03, 0.065, 1.3);
  k.b.add('emit', GEO.cone16, M(tx + 0.01, ty + 0.38, tz + 0.03, 0.1, 0.2, 0.1, 0, 0, -0.12), '#ffb347', 1);
  ball(k, 'emit', '#ffe7a0', tx, ty + 0.27, tz + 0.06, 0.035, 1.4);
  k.glows.push(tx, ty + 0.3, tz + 0.05, 0.9, 1, 0.68, 0.32);
  (k.pools ||= []).push(tx, ty + 0.2, tz + 0.4, 2.8, 1, 0.66, 0.34, 1.0);
  k.lights.push(tx, ty + 0.3, tz + 0.3);
  // a chain hanging on the wall at the right end (links alternate their plane)
  for (let i = 0; i < 7; i++) {
    const cy = top - 0.9 - i * 0.1;
    k.b.add('metal', TORUS, M(hx1 - 0.2, cy, hz + 0.03, 0.07, 0.11, 0.07, 0, i % 2 ? Math.PI / 2 : 0, 0), C.iron, 1);
  }
  (k.blobs ||= []).push(cx, base + 0.01, hz + 0.25, (hx1 - hx0) / 2 + 0.2, 0.45);
  // solid from the wall to the base (citymap.js JAIL_OBST[0]); camera collider up to the parapet
  (k.solids ||= []).push(hx0 - 0.12, hx1 + 0.12, zw, hz + 0.14, Infinity);
  k.colliders.push(hx0 - 0.1, hx1 + 0.1, base, top + 0.5, zw, hz + 0.1);
}

/* ------------------------------------------------------------------ the cage */

function cage(k: Ctx, J: JailGeo, W: ReturnType<typeof jailWorld>, C: ReturnType<typeof jailColors>): void {
  const { base, zw, cx0, cx1, cz, dx0, dx1, H } = W, top = base + H, fl = base + 0.03;
  const bar = (x: number, z: number, y0: number, y1: number, r = 0.026, col = C.iron) =>
    k.b.add('metal', GEO.cyl8, M(x, (y0 + y1) / 2, z, r * 2, y1 - y0, r * 2), col, 1);
  // floor: stone slabs from the wall to the bar line, with the seams (flat strips 3 mm above)
  box(k, 'stone', C.stone, cx0, cx1, base - 0.05, fl, zw, cz + 0.06, 0.8);
  for (let i = 1; i < 4; i++) { const z = zw + (cz - zw) * i / 4; box(k, 'flat', C.stoneD, cx0 + 0.04, cx1 - 0.04, fl - 0.006, fl + 0.005, z - 0.012, z + 0.012); }
  for (let i = 1; i < 6; i++) { const x = cx0 + (cx1 - cx0) * i / 6; box(k, 'flat', shade(C.stoneD, 0.1), x - 0.01, x + 0.01, fl - 0.012, fl + 0.011, zw + 0.05, cz - 0.05); }
  // corner posts (front: thick, back: at the wall), bottom rails, the riveted top beam
  for (const x of [cx0, cx1]) {
    box(k, 'metal', C.beam, x - 0.07, x + 0.07, base, top + 0.08, cz - 0.07, cz + 0.07);
    box(k, 'metal', C.beam, x - 0.05, x + 0.05, base, top, zw + 0.02, zw + 0.12);
  }
  box(k, 'metal', C.beam, cx0, cx1, base, fl + 0.07, cz - 0.045, cz + 0.045);
  box(k, 'metal', C.beam, cx0 - 0.04, cx1 + 0.04, top - 0.03, top + 0.09, cz - 0.06, cz + 0.06);
  for (let x = cx0 + 0.18; x < cx1 - 0.05; x += 0.48) ball(k, 'metal', C.ironL, x, top + 0.03, cz + 0.062, 0.02);
  for (const x of [cx0, cx1]) {
    box(k, 'metal', C.beam, x - 0.035, x + 0.035, top - 0.03, top + 0.06, zw + 0.05, cz - 0.06);
    box(k, 'metal', C.beam, x - 0.03, x + 0.03, base, fl + 0.06, zw + 0.05, cz - 0.06);
  }
  box(k, 'metal', C.beam, cx0, cx1, top - 0.04, top + 0.04, zw + 0.02, zw + 0.12);
  // dark back panel against the wall + its bars
  box(k, 'flat', '#25212e', cx0 + 0.06, cx1 - 0.06, fl + 0.006, top - 0.05, zw + 0.035, zw + 0.045);
  for (let x = cx0 + 0.14; x < cx1 - 0.06; x += 0.22) bar(x, zw + 0.07, fl, top - 0.04, 0.02, '#3e3a48');
  // front bars: solid from the floor rail to the beam (site: every 24 px), the door is part of the grille
  for (let x = cx0 + 0.06 + 0.18; x <= cx1 - 0.06; x += 0.24) bar(x, cz, fl + 0.06, top - 0.03);
  // side bars (every ~0.3 m in depth)
  for (const x of [cx0, cx1]) for (let z = cz - 0.32; z > zw + 0.15; z -= 0.3) bar(x, z, fl + 0.05, top - 0.03);
  // the door in the grille: a frame over the bars, a cross bar, hinges on the left, the bolt and a padlock on the right
  const dy0 = fl + 0.14, dy1 = top - 0.16, my = (dy0 + dy1) / 2, fz = cz + 0.045;
  const DF = '#8e8698';   // the door's frame reads lighter than the bars around it (site: the door outlined in the grille)
  for (const [a, c, y0, y1] of [[dx0 - 0.04, dx0 + 0.04, dy0, dy1], [dx1 - 0.04, dx1 + 0.04, dy0, dy1], [dx0, dx1, dy0 - 0.04, dy0 + 0.04], [dx0, dx1, dy1 - 0.04, dy1 + 0.04], [dx0, dx1, my - 0.035, my + 0.035]] as const)
    box(k, 'metal', DF, a, c, y0, y1, fz - 0.025, fz + 0.025);
  // hinges on the left: straps from the frame over the next bar, with a vertical pin
  for (const yy of [dy1 - 0.2, dy0 + 0.24]) {
    box(k, 'metal', C.ironL, dx0 - 0.17, dx0 + 0.09, yy - 0.04, yy + 0.04, fz + 0.025, fz + 0.045, 0.4);
    k.b.add('metal', GEO.cyl8, M(dx0 - 0.04, yy, fz + 0.05, 0.05, 0.13, 0.05), C.ironL, 1);
  }
  // the bolt: a bar from the door to the next bar on the right, a staple on that bar; the padlock's shackle goes through it
  box(k, 'metal', C.ironL, dx1 - 0.12, dx1 + 0.16, my - 0.025, my + 0.025, fz + 0.03, fz + 0.05);
  const lx = dx1 + 0.11, lz = fz + 0.085;
  k.b.add('metal', TORUS, M(lx, my, fz + 0.06, 0.09, 0.09, 0.09, 0, Math.PI / 2, 0), C.ironL, 1);   // staple (a loop off the bolt, across the shackle)
  // padlock: a brass body (bevelled top, darker sides), a steel shackle hooked through the staple, a keyhole
  const by1 = my - 0.07, by0 = by1 - 0.16;
  box(k, 'metal', C.brass, lx - 0.1, lx + 0.1, by0, by1, lz - 0.04, lz + 0.04);
  box(k, 'metal', shade(C.brass, 0.25), lx - 0.09, lx + 0.09, by1, by1 + 0.015, lz - 0.035, lz + 0.035);
  k.b.add('metal', GEO.cyl12, M(lx, by0, lz, 0.2, 0.07, 0.06, Math.PI / 2, 0, 0), shade(C.brass, -0.2), 1);   // rounded bottom
  for (const s0 of [-1, 1]) box(k, 'metal', '#c9ccd6', lx + s0 * 0.055 - 0.012, lx + s0 * 0.055 + 0.012, by1, my - 0.016, fz + 0.08 - 0.012, fz + 0.08 + 0.012);
  k.b.add('metal', HALF_TORUS, M(lx, my - 0.01, fz + 0.08, 0.11, 0.11, 0.11), '#c9ccd6', 1);
  ball(k, 'flat', '#1b1426', lx, by0 + 0.1, lz + 0.042, 0.017);
  box(k, 'flat', '#1b1426', lx - 0.007, lx + 0.007, by0 + 0.04, by0 + 0.1, lz + 0.03, lz + 0.046);
  // roof: the cage is closed from above too — iron bars from the wall to the front beam on two cross straps (see-through:
  // the camera of a prisoner inside looks down through them)
  for (const t of [0.33, 0.66]) { const x = cx0 + (cx1 - cx0) * t; box(k, 'metal', C.beam, x - 0.04, x + 0.04, top + 0.03, top + 0.08, zw, cz + 0.06); }
  for (let x = cx0 + 0.2; x < cx1 - 0.08; x += 0.26) box(k, 'metal', C.iron, x - 0.018, x + 0.018, top + 0.08, top + 0.115, zw + 0.02, cz + 0.04);
  // straw piles and a bowl inside
  const sx = (px: number) => toX(px), sz = (py: number) => toZ(py);
  // straw: low mounds of a few lumps each with loose stalks on top (in the corners, clear of the seats)
  const STRAW = ['#d9b768', '#c9a24e', '#e6c77e'];
  for (const [px, pz, w] of [[J.c0 + 50, zw + 0.5, 0.9], [J.c1 - 60, zw + 0.55, 1.0], [J.c0 + 45, cz - 0.45, 0.6]] as const) {
    const x = sx(px);
    for (let i = 0; i < 5; i++) {
      const dx = (i - 2) * w * 0.18, dz = ((i * 37) % 5 - 2) * 0.06, hh = 0.1 + (i % 3) * 0.04;
      k.b.add('wood', GEO.sphere, M(x + dx, fl, pz + dz, w * 0.42, hh * 2, 0.5), STRAW[i % 3], 1);
    }
    for (let i = 0; i < 7; i++) {
      const a = i * 0.9, dx = Math.cos(a) * w * 0.3;
      rbox(k, 'wood', STRAW[(i + 1) % 3], x + dx, fl + 0.13 + (i % 2) * 0.03, pz + Math.sin(a) * 0.15, 0.32, 0.012, 0.012, a, 0, 0.18 * ((i % 3) - 1));
    }
  }
  // a tin bowl and a jug by the right side
  const bx = sx(J.c1 - 60), bz = cz - 0.55;
  k.b.add('metal', GEO.cyl12, M(bx, fl + 0.04, bz, 0.3, 0.08, 0.3), C.ironL, 1);
  k.b.add('flat', GEO.cyl12, M(bx, fl + 0.087, bz, 0.24, 0.004, 0.24), '#3a3e4e', 1);
  k.b.add('stone', GEO.sphere, M(bx + 0.05, fl + 0.13, bz - 0.4, 0.22, 0.26, 0.22), '#a8643c', 1);
  k.b.add('stone', GEO.cyl8, M(bx + 0.05, fl + 0.29, bz - 0.4, 0.09, 0.1, 0.09), '#a8643c', 1);
  (k.blobs ||= []).push((cx0 + cx1) / 2, base + 0.01, cz + 0.3, (cx1 - cx0) / 2 + 0.25, 0.4);
  // solids (citymap.js JAIL_OBST[1]: c0 − 6 … c1 + 6 from the wall to fy + 4): bars all round, a floor inside
  const S = (k.solids ||= []);
  S.push(cx0 - 0.1, cx1 + 0.1, cz - 0.08, cz + 0.1, Infinity);    // front grille + posts
  S.push(cx0 - 0.1, cx0 + 0.06, zw, cz, Infinity);                 // left side
  S.push(cx1 - 0.06, cx1 + 0.1, zw, cz, Infinity);                 // right side
  S.push(cx0 + 0.06, cx1 - 0.06, zw, cz - 0.08, fl);               // the floor inside (the prisoner stands on it)
  // no camera colliders: bars are see-through (the TP camera of a prisoner stays outside and looks in)
}
