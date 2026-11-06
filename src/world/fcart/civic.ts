/**
 * Civic buildings of the new cats fair, built from the site's own assets (fc-art.js hall / magicB / jailB / storageB /
 * gateB, tk-art.js minePortal, fc-city.js cage): shapes, colours and proportions ported into batched 3D.
 *   - x: the asset's px → the place's vis box (0.01 m / px), heights 0.019 m / px (the site's cats are ≈ 80 px tall,
 *     our heroes 1.35 m), depth = the foot band (front on foot[3]; the gate faces the town: its front on foot[1]);
 *   - doors: one `markDoor` per model (leaf + frame / the portal timbers / the gate's voussoirs): worldExt.ts drawnDoor makes
 *     it the hover-outline box. Every door's frame / leaf also lies inside the door hit volume worldExt.ts builds from `civicDoorXf()` (half-width
 *     and height of BUILDING_MODELS[id].door × s, from the entrance plane zE − 0.45 to zE + 0.13): the hover outline
 *     (features/doors.ts → engine/outline.ts fitOutlineProxy, the static triangles fully inside that box) traces exactly
 *     the drawn door / portal timbers, nothing else (walls, steps, signs reach outside the box);
 *   - ≤ 6 batch materials per model; no instanced kinds; colliders stay the site's obstacles except the jail (its
 *     obstacles are skipped by fairCatsSolids: the carrier and the cage push their own, the cage floor finite).
 */
import * as THREE from 'three';
import type { JailGeo } from '../../contracts';
import { toX, toZ, SX } from '../coords';
import { GEO, M, type BatchKey } from '../batch';
import { type Ctx, box, signZ, shade, markDoor } from '../kit';
import { registerFcModel, type FcPlace } from './registry';
import { siteRoof, tileHipRoof, hipRidgeAt, roofPiece, roofBox, roofCol } from './roof';

type V2 = [number, number];
/** Metres per px of the asset's heights. */
export const HY = 0.015;
const INK = '#2b1d18';
/** fc-art.js / tk-art.js palette (P) and roofs used here. */
const P = {
  wood: '#a8754f', woodD: '#6e4a2f', woodL: '#c8956a', card: '#d9a066', cardD: '#a8743f', cardL: '#ecc08a', cream: '#fff1d6', milk: '#f7f3ea',
  pink: '#ff8fa3', gold: '#ffcf4a', glass: '#ffd76a', metal: '#3a2e4a', plum: '#7a4a78', plumD: '#5a3458', plumL: '#9a6496',
  terra: '#d27b5a', terraD: '#a4553c', terraL: '#e89a78', rock: '#b39a8c', rockD: '#8f766b', rockL: '#cdb7a8', mrock: '#a08c88', mrockD: '#7d6a68',
  brick: '#b4584a', brickD: '#80392e', platD: '#7fab57', night: '#3b3480', nightD: '#262060', nightL: '#5a50a8', red: '#c8664a', redD: '#8f3f2c', redL: '#e08a68',
};

/* ------------------------------------------------------------------ frame: asset px → world */
interface Fr {
  /** asset x (px) → world x */ X(ax: number): number;
  /** asset y (px, the asset's own base line B) → world y */ Y(ay: number): number;
  /** asset width (px) → m */ w(a: number): number;
  /** asset height (px) → m */ h(a: number): number;
  zf: number; zb: number; base: number; dx: number;
}
/** `A0…A1`: the asset's own vis x range (fc-map.js), `B`: its base line (px). */
function frame(p: FcPlace, A0: number, A1: number, B: number): Fr {
  const kx = (p.vis[2] - p.vis[0]) / (A1 - A0), X0 = p.vis[0], hy = HY * kx;
  return {
    X: (ax) => toX(X0 + (ax - A0) * kx), w: (a) => a * kx * SX, Y: (ay) => p.base + (B - ay) * hy, h: (a) => a * hy,
    zf: toZ(p.foot[3]), zb: toZ(p.foot[1]), base: p.base, dx: toX(p.door?.x ?? X0 + ((A0 + A1) / 2 - A0) * kx),
  };
}

/* ------------------------------------------------------------------ geometry helpers */
const _e = new THREE.Euler(), _q = new THREE.Quaternion(), _m = new THREE.Matrix4(), _v = new THREE.Vector3(), _s = new THREE.Vector3();
/** Matrix: tilt `rx` first, then turn `ry` (Euler 'YXZ'): a piece leaning back on a round roof facing out at angle ry. */
function MY(x: number, y: number, z: number, sx: number, sy: number, sz: number, ry: number, rx = 0, rz = 0): THREE.Matrix4 {
  _e.set(rx, ry, rz, 'YXZ'); _q.setFromEuler(_e);
  return _m.compose(_v.set(x, y, z), _q, _s.set(sx, sy, sz));
}
/** A polygon in the XY plane (m) extruded from z0 to z1 (holes optional). */
function prism(k: Ctx, mat: BatchKey, col: string, pts: V2[], z0: number, z1: number, uv: number = 1, holes: V2[][] = []): void {
  const sh = new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y)));
  for (const h of holes) sh.holes.push(new THREE.Path(h.map(([x, y]) => new THREE.Vector2(x, y))));
  const g = new THREE.ExtrudeGeometry(sh, { depth: Math.max(0.002, z1 - z0), bevelEnabled: false, curveSegments: 6 });
  g.translate(0, 0, z0);
  k.b.add(mat, g, M(0, 0, 0), col, uv); g.dispose();
}
/** Points of an elliptic arc (centre, radii, angles in radians, counter-clockwise from +x). */
function arc(cx: number, cy: number, rx: number, ry: number, a0: number, a1: number, n: number): V2[] {
  const o: V2[] = [];
  for (let i = 0; i <= n; i++) { const a = a0 + (a1 - a0) * i / n; o.push([cx + Math.cos(a) * rx, cy + Math.sin(a) * ry]); }
  return o;
}
/** An arched opening / panel outline: posts from y0 up to the springing ys, a half-ellipse of height rh on top. */
const archPts = (x0: number, x1: number, y0: number, ys: number, rh: number, n = 10): V2[] =>
  [[x0, y0], [x1, y0], ...arc((x0 + x1) / 2, ys, (x1 - x0) / 2, rh, 0, Math.PI, n)];
/** An outline with an arched opening cut up from its bottom line (a single simple polygon, no hole: earcut fills a hole
 *  that touches the outline). `outer` runs from its bottom-right corner over the top to its bottom-left corner. */
const cutArch = (outer: V2[], x0: number, x1: number, y0: number, ys: number, rh: number, n = 10): V2[] =>
  [...outer, [x0, y0], ...arc((x0 + x1) / 2, ys, (x1 - x0) / 2, rh, Math.PI, 0, n), [x1, y0]];
/** Rounded rectangle (corner radii: bottom-left, bottom-right, top-right, top-left). */
function rrect(x0: number, y0: number, x1: number, y1: number, r: [number, number, number, number]): V2[] {
  const o: V2[] = [];
  const c: [number, number, number, number][] = [[x0 + r[0], y0 + r[0], Math.PI, r[0]], [x1 - r[1], y0 + r[1], Math.PI * 1.5, r[1]], [x1 - r[2], y1 - r[2], 0, r[2]], [x0 + r[3], y1 - r[3], Math.PI * 0.5, r[3]]];
  for (const [cx, cy, a0, rr] of c) { if (rr <= 0) { o.push([cx, cy]); continue; } o.push(...arc(cx, cy, rr, rr, a0, a0 + Math.PI / 2, 4)); }
  return o;
}
/** A lathe (profile [r, y] bottom → top) round x / z. */
function lathe(k: Ctx, mat: BatchKey, col: string, x: number, z: number, prof: V2[], seg = 16, uv: number = 1): void {
  const g = new THREE.LatheGeometry(prof.map(([r, y]) => new THREE.Vector2(Math.max(0.0005, r), y)), seg);
  k.b.add(mat, g, M(x, 0, z), col, uv); g.dispose();
}
/** A loaf cat lying along x (head on the −x end) on a ridge at height y (tk-art.js kitty 'loaf'), flat colour in 'fcroof'. */
function roofCat(k: Ctx, x: number, y: number, z: number, s: number, fur: string): void {
  roofPiece(k, ICO_R, M(x, y + s * 0.17, z, s * 0.9, s * 0.4, s * 0.5), fur);
  roofPiece(k, ICO_R, M(x - s * 0.4, y + s * 0.3, z + s * 0.04, s * 0.38, s * 0.34, s * 0.36), fur);
  for (const e of [-1, 1]) roofPiece(k, GEO.cone4, M(x - s * 0.42, y + s * 0.5, z + s * 0.04 + e * s * 0.1, s * 0.11, s * 0.14, s * 0.09), fur);
  for (const e of [-1, 1]) roofPiece(k, GEO.box, M(x - s * 0.58, y + s * 0.32, z + s * 0.04 + e * s * 0.07, 0.012, s * 0.03, s * 0.05), INK);
  roofPiece(k, ICO_R, M(x + s * 0.48, y + s * 0.1, z + s * 0.16, s * 0.34, s * 0.11, s * 0.12), shade(fur, -0.08));
}
const ICO_R = new THREE.IcosahedronGeometry(0.5, 1);
/** prism() in the roof material, flat colour (the plain strip of the roof texture). */
function roofPrism(k: Ctx, col: string, pts: V2[], z0: number, z1: number): void {
  const g = new THREE.ExtrudeGeometry(new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y))), { depth: Math.max(0.002, z1 - z0), bevelEnabled: false });
  g.translate(0, 0, z0);
  const n = g.attributes.position.count, uv = g.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < n; i++) uv.setXY(i, 0.5, 0.95);
  k.b.add('fcroof', g, M(0, 0, 0), roofCol(col), 'keep'); g.dispose();
}
/** Five-point star (radius 0.5, 0.2 thick, normal +z) — the magic roof's stars. */
const STAR = (() => {
  const pts: THREE.Vector2[] = [];
  for (let i = 0; i < 10; i++) { const a = Math.PI / 2 + i * Math.PI / 5, r = i % 2 ? 0.21 : 0.5; pts.push(new THREE.Vector2(Math.cos(a) * r, Math.sin(a) * r)); }
  const g = new THREE.ExtrudeGeometry(new THREE.Shape(pts), { depth: 0.2, bevelEnabled: false }); g.translate(0, 0, -0.1); return g;
})();
/** A crescent (torus arc in XY, radius 0.5). */
const CRESCENT = new THREE.TorusGeometry(0.5, 0.17, 6, 16, Math.PI * 1.3);
/** Half torus (an arch handle / rail) in XY, radius 0.5. */
const HALF_TORUS = new THREE.TorusGeometry(0.5, 0.09, 6, 16, Math.PI);
const RING = new THREE.TorusGeometry(0.5, 0.03, 4, 32);
const ICO = new THREE.IcosahedronGeometry(0.5, 1);

/** A glowing window (arched or square) on a +z wall at z: frame, glow pane, sill. `mat` of the frame. */
function window3(k: Ctx, fmat: BatchKey, fcol: string, cx: number, y0: number, w: number, h: number, z: number, arch: boolean, glow = P.glass): void {
  const x0 = cx - w / 2, x1 = cx + w / 2, f = 0.06;
  const outer = arch ? archPts(x0 - f, x1 + f, y0 - f, y0 + h - w / 2, w / 2 + f) : rrect(x0 - f, y0 - f, x1 + f, y0 + h + f, [0.03, 0.03, 0.03, 0.03]);
  const inner = arch ? archPts(x0, x1, y0, y0 + h - w / 2, w / 2) : rrect(x0, y0, x1, y0 + h, [0.02, 0.02, 0.02, 0.02]);
  prism(k, fmat, fcol, outer, z, z + 0.05, 1, [inner.slice().reverse()]);
  prism(k, 'emit', glow, inner, z, z + 0.02);
  box(k, fmat, fcol, cx - 0.04 / 2, cx + 0.04 / 2, y0, y0 + h - (arch ? w / 2 : 0), z + 0.02, z + 0.045);
  box(k, fmat, shade(fcol, -0.15), x0 - 0.1, x1 + 0.1, y0 - 0.1, y0 - 0.03, z, z + 0.14);
}
/** Whatever `fn` adds, turned half round about the vertical through (x, z) — a +z piece (signZ) facing −z. */
function turned(k: Ctx, x: number, z: number, fn: () => void): void {
  const add0 = k.b.add, T = new THREE.Matrix4().makeTranslation(x, 0, z).multiply(new THREE.Matrix4().makeRotationY(Math.PI)).multiply(new THREE.Matrix4().makeTranslation(-x, 0, -z));
  const mm = new THREE.Matrix4();
  k.b.add = (mat, g, m, col, uv) => add0.call(k.b, mat, g, mm.multiplyMatrices(T, m), col, uv);
  try { fn(); } finally { k.b.add = add0; }
}
/** A lantern on a wall bracket (x, y = lantern centre, z = wall). */
function lantern(k: Ctx, mat: BatchKey, x: number, y: number, z: number, s = 1): void {
  box(k, mat, P.metal, x - 0.02, x + 0.02, y + 0.12 * s, y + 0.16 * s, z, z + 0.2 * s);
  box(k, mat, P.metal, x - 0.1 * s, x + 0.1 * s, y + 0.1 * s, y + 0.15 * s, z + 0.1 * s, z + 0.3 * s);
  box(k, 'emit', '#ffd77a', x - 0.07 * s, x + 0.07 * s, y - 0.12 * s, y + 0.1 * s, z + 0.13 * s, z + 0.27 * s);
  box(k, mat, P.metal, x - 0.09 * s, x + 0.09 * s, y - 0.16 * s, y - 0.12 * s, z + 0.11 * s, z + 0.29 * s);
  k.glows.push(x, y, z + 0.2 * s, 0.9 * s, 1, 0.78, 0.4);
  k.lights.push(x, y, z + 0.4);
}

/* ------------------------------------------------------------------ door transforms (the hook for faircats.ts) */
/** Door half-width / height of BUILDING_MODELS[id].door (buildings.ts) that worldExt.ts multiplies by s. */
const MODEL_DOOR: Record<string, [number, number]> = { hall: [0.7, 2.3], magic: [0.7, 2.3], gate: [0.7, 2.3], mine: [0.95, 2.3], storage: [0.85, 2.1], jail: [0.5, 2.0] };
const DOOR_S: Record<string, number> = { hall: 1, magic: 1, gate: 1.35, mine: 1.35, storage: 1.25, jail: 1 };
/**
 * Where the door hit volume of a civic model goes: the entrance plane `zE` (world z; the hit box runs zE − 0.45 … zE + 0.3)
 * and the scale `s` of the model's door (hw, h). faircats.ts: `BUILDING_XF.set(b, { virt: { ...b }, z: () => zE, s })`.
 */
export function civicDoorXf(ref: string, p: FcPlace): { zE: number; s: number; hw: number; h: number } | null {
  const d = MODEL_DOOR[ref]; if (!d) return null;
  const s = DOOR_S[ref] ?? 1;
  const zE = ref === 'gate' ? toZ(p.foot[1]) + 0.3 : ref === 'magic' ? toZ(p.foot[3]) - 0.12 : ref === 'mine' ? toZ(p.vis[3]) + 0.3 : toZ(p.foot[3]);
  return { zE, s, hw: d[0] * s, h: d[1] * s };
}
/** The door region (outline box) of a model: x ± hw, y base … base + h, z zE − 0.45 … zE + 0.13. */
const doorBox = (ref: string, p: FcPlace) => { const d = civicDoorXf(ref, p)!; return { ...d, x: toX(p.door?.x ?? (p.vis[0] + p.vis[2]) / 2) }; };
const signText = (p: FcPlace, def: string) => (typeof p.data?.sign === 'string' && p.data.sign ? String(p.data.sign) : def);

/* ================================================================== Ратуша (fc-art.js hall) */
/** Purple hipped roof with two dormers and two chimneys over a cream half-timbered hall, a clock tower with a purple
 *  spire, cat ears and a fish vane in the middle; a pedimented porch on two columns over the double door, «РАТУША». */
function buildHall(k: Ctx, p: FcPlace): void {
  const f = frame(p, 2560, 3200, 1500), { zf, base } = f, d = doorBox('hall', p);
  const L = f.X(2590), R = f.X(3170), cx = f.dx, wt = Math.max(f.Y(1362), base + 2.5);
  // the site draws a long low hall: the body keeps ≤ 0.62 of its width in depth (front on foot[3]), the long ridge along x
  const D = Math.min(zf - f.zb, (R - L) * 0.62), zb = zf - D;
  // foundation (stone, 18 px), walls (cream), timber posts (terra) and the plum fascia
  box(k, 'stone', '#cbbcae', L - f.w(10), R + f.w(10), base - 0.05, base + f.h(18), zb - 0.05, zf + 0.06, 0.8);
  box(k, 'plaster', P.cream, L, R, base, wt, zb, zf, 1.2);
  for (const ax of [2590, 2716, 3026, 3150]) { const x = f.X(ax + 10); box(k, 'wood', P.terra, x - 0.14, x + 0.14, base + f.h(18), wt, zf - 0.01, zf + 0.08, 0.5); box(k, 'wood', P.terraL, x - 0.1, x + 0.1, base + f.h(18) + 0.04, wt - 0.04, zf + 0.08, zf + 0.1, 0.5); }
  for (const x of [L, R - f.w(20)]) box(k, 'wood', P.terraL, x - 0.01, x + f.w(20) + 0.01, base + f.h(18), wt, zb - 0.01, zb + 0.08, 0.5);
  for (const x of [L - 0.025, R - 0.035]) box(k, 'wood', P.terraL, x, x + 0.06, base + f.h(18), wt, zb + 0.09, zf - 0.02, 0.5);   // side corner posts
  // roof: the site's roofV(L − 22, R + 22, wt + 4, 1222, dx 50, dy 34, plum, sw 36, sh 21, ridge 14) — the ridge ends from
  // roofRidge (plan x: drawn − dx / 2), the eave RDROP px lower (the ridge stays), scalloped rows / bands / trims (roof.ts)
  const sr = siteRoof({ L: 2568, R: 3192, eY: 1366, rY: 1222, dx: 50, dy: 34, sw: 36, sh: 21 }), rg = sr.ridge;
  const ov = f.w(22), drop = f.h(rg.drop), ry = wt + f.h(11) - drop, rh = Math.min(1.9, Math.max(1.6, f.h(140))) + drop;
  // the plum fascia band under the eave (inside the roof's hips: it never pokes through them)
  box(k, 'wood', P.plumD, L - ov + 0.1, R + ov - 0.1, wt - 0.04, ry + 0.02, zb - 0.12, zf + 0.12, 0.6);
  // four arched windows with flower boxes, the side window
  for (const ax of [2652, 2776, 2988, 3112]) {
    window3(k, 'wood', P.terra, f.X(ax), base + 0.8, f.w(50), 1.15, zf, true);
    box(k, 'wood', P.terraD, f.X(ax) - f.w(34), f.X(ax) + f.w(34), base + 0.52, base + 0.68, zf, zf + 0.2, 0.5);
    for (let i = 0; i < 4; i++) k.b.add('plaster', ICO, M(f.X(ax) - f.w(24) + i * f.w(16), base + 0.74, zf + 0.1, 0.17, 0.14, 0.15), [P.pink, '#ffd84d', P.pink, '#fff4e0'][i], 1);
  }
  for (const zc of [zb + D * 0.3, zb + D * 0.7]) {   // side windows (the site's one on the right wall), both sides
    for (const [x0, x1] of [[R - 0.01, R + 0.05], [L - 0.05, L + 0.01]]) { box(k, 'wood', '#5a4248', x0, x1, base + 1.0, base + 1.9, zc - 0.3, zc + 0.3, 0.5); box(k, 'emit', P.glass, x0 - 0.01, x1 + 0.01, base + 1.06, base + 1.84, zc - 0.22, zc + 0.22); }
  }
  const roof = { x0: L - ov, x1: R + ov, z0: zb - ov, z1: zf + ov, y0: ry, h: rh, rx0: f.X(rg.x0), rx1: f.X(rg.x1) }, rt = f.w(23);
  tileHipRoof(k, { ...roof, pal: [P.plum, P.plumD, P.plumL], tileW: f.w(sr.sw), rows: sr.rows, sideRows: sr.sideRows, soffit: P.plumD, ridge: rt, rib: 0.12, lip: 0.1 });
  const roofAt = (x: number) => hipRidgeAt(roof, x), capTop = ry + rh + rt * 0.45;
  /** the drawn ridge-relative x (px, as fc-art.js places chimneys / vanes / the cat) → plan → world */
  const atRidge = (sx: number) => f.X(sx - rg.hx);
  // dormers (arched, on the front slope) and chimneys
  const slopeZ = (y: number) => zf + ov - (y - ry) / rh * (D / 2 + ov);
  for (const ax of [2690, 3070]) {
    const x = f.X(ax), yb = wt + f.h(11) + rh * 0.3, z = slopeZ(yb) - 0.05, w = f.w(60);
    prism(k, 'plaster', P.cream, archPts(x - w / 2, x + w / 2, yb - 0.3, yb + 0.25, w / 2), z - 0.9, z + 0.02);
    window3(k, 'wood', P.terra, x, yb - 0.05, w * 0.55, 0.42, z + 0.02, true);
    roofPiece(k, HALF_TORUS, M(x, yb + 0.25, z - 0.3, w * 1.25, w * 1.1, 2.4), P.plumL);
  }
  // chimneys: fc-art.js chimney(rgL + 28, …) / chimney(rgR − 32, …) — near the ridge ends, just behind the ridge
  for (const [sx, up] of [[rg.sx0 + 28, 0.75], [rg.sx1 - 32, 0.65]] as const) { const x = atRidge(sx), z = zb + D * 0.42, top = roofAt(x) + up; box(k, 'stone', P.brick, x - 0.24, x + 0.24, wt + 0.3, top, z - 0.24, z + 0.24, 0.6); box(k, 'stone', P.brickD, x - 0.29, x + 0.29, top, top + 0.12, z - 0.29, z + 0.29, 0.6);
    for (let i = 0; i < 3; i++) k.b.add('plaster', ICO, M(x + i * 0.12, top + 0.3 + i * 0.22, z, 0.3 - i * 0.04, 0.24, 0.26), '#e8e4f0', 1); }
  // gold vanes on the ridge ends (fc-art.js: at rgL + 2 / rgR − 2), through the end knobs
  for (const [sx, s] of [[rg.sx0 + 2, -1], [rg.sx1 - 2, 1]] as const) {
    const x = atRidge(sx), y0 = roofAt(x) - 0.08, zc = zb + D / 2;
    roofBox(k, P.metal, x - 0.025, x + 0.025, y0, y0 + 1.0, zc - 0.025, zc + 0.025);
    roofPrism(k, P.gold, [[x, y0 + 0.62], [x + s * 0.62, y0 + 0.78], [x + s * 0.5, y0 + 0.86], [x + s * 0.62, y0 + 0.94], [x, y0 + 0.98]], zc - 0.015, zc + 0.015);
  }
  // the loaf cat on the ridge (fc-art.js kitty(rgL + 84, 1218, 0.7, FUR[2], 'loaf')), flat-coloured in the roof material
  roofCat(k, atRidge(rg.sx0 + 84) + 0.06, capTop - 0.02, zb + D / 2, 0.75, '#f3d9b1');
  // clock tower: cream, terra corner posts, rising through the roof from the front wall
  const tw0 = f.w(128) * 1.2, tx0 = cx - tw0 / 2, tx1 = cx + tw0 / 2, tz1 = zf + 0.08, tz0 = Math.max(zb + 0.3, tz1 - tw0 * 1.1), tTop = Math.max(f.Y(1138) - 0.3, ry + rh + 1.0);
  box(k, 'plaster', P.cream, tx0, tx1, wt, tTop, tz0, tz1, 1.2);
  for (const x of [tx0, tx1 - f.w(16)]) box(k, 'wood', P.terraL, x - 0.01, x + f.w(16) + 0.01, wt, tTop, tz1 - 0.01, tz1 + 0.05, 0.5);
  box(k, 'wood', P.plumD, tx0 - 0.08, tx1 + 0.08, tTop - 0.02, tTop + 0.12, tz0 - 0.08, tz1 + 0.08, 0.5);
  // bell window and the clock (centre 1238 relative to the top)
  const yBell = tTop - 0.32, rC = Math.min(tw0 * 0.36, 0.55), yClk = tTop - 0.66 - rC;
  prism(k, 'wood', '#3a2a3a', rrect(tx0 + f.w(26), yBell - f.h(17), tx1 - f.w(26), yBell + f.h(17), [0.1, 0.1, 0.1, 0.1]), tz1, tz1 + 0.03);
  k.b.add('emit', GEO.dome, M(cx, yBell - 0.1, tz1 + 0.04, 0.26, 0.22, 0.1), P.gold, 1);
  k.b.add('plaster', GEO.cyl16, M(cx, yClk, tz1 + 0.04, rC * 2, 0.08, rC * 2, Math.PI / 2), P.milk, 1);
  k.b.add('wood', RING, M(cx, yClk, tz1 + 0.085, rC * 1.65, rC * 1.65, 1), P.terra, 1);
  for (let i = 0; i < 12; i++) { const a = i / 12 * Math.PI * 2, r = rC * 0.68, s = i % 3 ? 0.03 : 0.05; box(k, 'wood', INK, cx + Math.cos(a) * r - s, cx + Math.cos(a) * r + s, yClk + Math.sin(a) * r - s, yClk + Math.sin(a) * r + s, tz1 + 0.08, tz1 + 0.1); }
  box(k, 'wood', INK, cx - 0.022, cx + 0.022, yClk, yClk + rC * 0.62, tz1 + 0.1, tz1 + 0.12);
  k.b.add('wood', GEO.box, M(cx + rC * 0.22, yClk - rC * 0.08, tz1 + 0.145, rC * 0.48, 0.04, 0.01, 0, 0, -0.38), INK, 1);
  k.b.add('emit', GEO.cyl8, M(cx, yClk, tz1 + 0.12, 0.08, 0.03, 0.08, Math.PI / 2), P.gold, 1);
  // cat ears on the tower top, the spire (purple pyramid, a lighter edge) and the fish vane
  for (const s of [-1, 1]) {   // cat ears over the clock (terra, pink inside) and whiskers either side of it
    prism(k, 'plaster', P.terraL, [[cx + s * rC * 0.35, yClk + rC * 0.8], [cx + s * rC * 0.95, yClk + rC * 0.45], [cx + s * rC * 1.0, yClk + rC * 1.45]], tz1, tz1 + 0.06);
    prism(k, 'plaster', P.pink, [[cx + s * rC * 0.55, yClk + rC * 0.85], [cx + s * rC * 0.88, yClk + rC * 0.66], [cx + s * rC * 0.92, yClk + rC * 1.22]], tz1 + 0.06, tz1 + 0.075);
    for (const dy of [0, -0.1]) k.b.add('wood', GEO.box, M(cx + s * (rC + 0.16), yClk + dy, tz1 + 0.03, 0.26, 0.025, 0.02, 0, 0, s * dy * 2), INK, 1);
  }
  const sw = (tx1 - tx0) / 2 + f.w(18), sh = Math.max(1.3, f.h(80)), tzc = (tz0 + tz1) / 2;
  roofPiece(k, GEO.cone4, M(cx, tTop + 0.12 + sh / 2, tzc, sw * 2, sh, (tz1 - tz0) / 2 * 2 + f.w(36)), P.plum);
  box(k, 'wood', P.metal, cx - 0.02, cx + 0.02, tTop + sh, tTop + sh + 0.5, tzc - 0.02, tzc + 0.02, 0.4);
  k.b.add('wood', ICO, M(cx + 0.06, tTop + sh + 0.48, tzc, 0.42, 0.16, 0.06), P.gold, 1);
  prism(k, 'wood', P.gold, [[cx + 0.24, tTop + sh + 0.48], [cx + 0.38, tTop + sh + 0.58], [cx + 0.38, tTop + sh + 0.38]], tzc - 0.02, tzc + 0.02);
  // the door: double leaf inside the door box (frame ±0.6, top 2.15), a paw on each leaf
  const dw = Math.min(0.5, d.hw - 0.12), dh = Math.min(2.0, d.h - 0.18);
  prism(k, 'wood', '#f0dfcc', archPts(cx - dw - 0.1, cx + dw + 0.1, base + 0.02, base + dh - dw * 0.5, dw * 0.5 + 0.1), zf, zf + 0.07);
  prism(k, 'wood', P.woodD, archPts(cx - dw, cx + dw, base + 0.02, base + dh - dw * 0.5, dw * 0.5), zf + 0.07, zf + 0.1);
  box(k, 'wood', INK, cx - 0.012, cx + 0.012, base + 0.03, base + dh - 0.05, zf + 0.1, zf + 0.11);
  for (const s of [-1, 1]) box(k, 'wood', P.gold, cx + s * 0.1 - 0.025, cx + s * 0.1 + 0.025, base + 0.95, base + 1.1, zf + 0.1, zf + 0.12);
  markDoor(k, 'door', cx - dw - 0.1, cx + dw + 0.1, base + 0.02, base + dh + 0.1, zf - 0.01, zf + 0.125);   // frame + leaves (the outline)
  // steps (wider than the door: never in the outline), the porch: two columns, the pediment with its roof, РАТУША over it
  box(k, 'stone', '#f0dfcc', cx - 0.95, cx + 0.95, base - 0.04, base + 0.1, zf, zf + 0.75, 0.6);
  box(k, 'stone', '#e4d0bc', cx - 0.8, cx + 0.8, base + 0.1, base + 0.2, zf, zf + 0.42, 0.6);
  const pz0 = zf + 0.14, pz1 = zf + 0.7, py = base + dh + 0.18, px = 0.82;
  for (const s of [-1, 1]) {
    k.b.add('plaster', GEO.cyl12, M(cx + s * 0.68, (base + 0.25 + py) / 2, pz1 - 0.12, 0.17, py - base - 0.25, 0.17), P.milk, 1);
    box(k, 'wood', P.terraL, cx + s * 0.68 - 0.13, cx + s * 0.68 + 0.13, base + 0.2, base + 0.3, pz1 - 0.25, pz1 + 0.01, 0.4);
  }
  box(k, 'wood', P.terra, cx - px - 0.05, cx + px + 0.05, py, py + 0.14, pz0, pz1 + 0.05, 0.5);
  prism(k, 'plaster', P.terraL, [[cx - px, py + 0.14], [cx + px, py + 0.14], [cx, py + 0.14 + 0.62]], pz0, pz1);
  for (const s of [-1, 1]) roofPiece(k, GEO.box, M(cx + s * px / 2, py + 0.14 + 0.33, (pz0 + pz1) / 2 + 0.02, Math.hypot(px, 0.62) + 0.14, 0.07, pz1 - pz0 + 0.14 + (s > 0 ? 0.012 : 0), 0, 0, s * -Math.atan2(0.62, px)), P.plumD);
  const sW = Math.min(2.0, f.w(170) * 1.15), sY = Math.max(py + 0.82, wt - 0.2);
  signZ(k, signText(p, 'РАТУША'), cx, sY, Math.max(zf, tz1), sW, { bg: P.plum, fg: P.gold });
  for (const s of [-1, 1]) lantern(k, 'wood', cx + s * 1.2, base + 1.7, zf, 1.5);
  (k.blobs ||= []).push(cx, base + 0.01, zf + 0.3, (R - L) / 2 + 0.2, 0.45);
}

/* ================================================================== Мурчародейня (fc-art.js magicB) */
/** A round lilac stone tower with a round wooden balcony ring, a star-dotted night-blue cone with the moon (and a cat on
 *  it) on top, a brass telescope out of the roof; a round window, two arched ones; an arched stone porch with the blue
 *  door and round steps; a domed annex on the left, a crystal-ball shop box on the right. Round on round: no boxes cut
 *  the tower; the sign is the site's plate (≈1.7 m), hung on two brackets. */
function buildMagic(k: Ctx, p: FcPlace): void {
  const f = frame(p, 2186, 2620, 720), { zf, base } = f, d = doorBox('magic', p);
  const cx = f.X(2430), r = f.w(118), zc = zf - 0.3 - r, tt = base + Math.max(4.4, Math.min(f.h(316), r * 2 * 1.9));
  // body: a stone cylinder (its plinth a hair wider), dark wash at the foot; a cornice ring under the balcony
  lathe(k, 'stone', '#b9a2d8', cx, zc, [[r + 0.06, base - 0.05], [r + 0.06, base + 0.28], [r, base + 0.3], [r, tt]], 20, 1.2);
  lathe(k, 'stone', '#8f78b6', cx, zc, [[r + 0.02, tt - 0.25], [r + 0.12, tt - 0.12], [r + 0.12, tt]], 20, 1.2);
  // the balcony: a round wooden deck (br = hw + 32), posts round it, a rail ring
  const br = f.w(150), by = tt + f.h(6);
  lathe(k, 'wood', P.woodD, cx, zc, [[r, by - 0.18], [br, by - 0.12], [br, by]], 24, 0.8);
  lathe(k, 'wood', P.wood, cx, zc, [[br, by], [br - 0.04, by + 0.03], [0.01, by + 0.03]], 24, 0.8);
  for (let i = 0; i < 24; i++) { const a = (i + 0.5) / 24 * Math.PI * 2; box(k, 'wood', P.woodL, cx + Math.sin(a) * (br - 0.08) - 0.045, cx + Math.sin(a) * (br - 0.08) + 0.045, by, by + 0.42, zc + Math.cos(a) * (br - 0.08) - 0.045, zc + Math.cos(a) * (br - 0.08) + 0.045, 0.4); }
  k.b.add('wood', RING, MY(cx, by + 0.44, zc, (br - 0.08) * 2, (br - 0.08) * 2, 3.0, 0, Math.PI / 2), P.woodL, 1);
  // roof: a slightly concave night-blue cone from the eave band to the tip, gold stars on it, the moon with a cat on top
  const R0 = f.w(152) + 0.1, y0 = by + 0.5, tipY = y0 + Math.max(2.5, Math.min(3.0, f.h(166))), Hc = tipY - y0;
  const prof: V2[] = []; for (let i = 0; i <= 8; i++) { const t = i / 8; prof.push([R0 * (1 - t) * (1 - 0.32 * t * (1 - t) * 2), y0 + Hc * t]); }
  lathe(k, 'roof', P.nightD, cx, zc, [[R0 - 0.08, y0 - 0.05], [R0 + 0.04, y0 - 0.02], [R0 + 0.04, y0 + 0.14]], 24, 1);
  lathe(k, 'roof', P.night, cx, zc, [[R0 + 0.04, y0 + 0.14], ...prof.slice(1)], 24, 1);
  const rAt = (y: number) => { const t = (y - y0) / Hc; return R0 * (1 - t) * (1 - 0.32 * t * (1 - t) * 2); };
  const stars: [number, number, number][] = [[-0.5, 0.18, 1], [0.35, 0.3, 0.8], [0.05, 0.12, 0.7], [-0.9, 0.42, 0.6], [0.8, 0.14, 0.9], [-0.15, 0.55, 0.6],
    [1.6, 0.22, 0.8], [2.4, 0.35, 0.7], [-1.7, 0.2, 0.8], [-2.5, 0.3, 0.7], [3.1, 0.18, 0.8], [1.2, 0.5, 0.6], [-1.3, 0.62, 0.5], [2.0, 0.66, 0.5]];
  for (const [a, t, s] of stars) {
    const y = y0 + Hc * t, rr = rAt(y) + 0.02, phi = Math.atan2(R0, Hc) * 0.9;
    k.b.add('metal', STAR, MY(cx + Math.sin(a) * rr, y, zc + Math.cos(a) * rr, 0.42 * s, 0.42 * s, 0.25, a, -phi), P.gold, 1);
  }
  box(k, 'metal', P.metal, cx - 0.025, cx + 0.025, tipY - 0.1, tipY + 0.55, zc - 0.025, zc + 0.025, 0.4);
  k.b.add('metal', CRESCENT, M(cx - 0.05, tipY + 0.8, zc, 0.62, 0.62, 0.6, 0, 0, 2.2), P.gold, 1);
  k.b.add('roof', ICO, M(cx + 0.08, tipY + 1.12, zc, 0.16, 0.2, 0.14), '#2a2440', 1);
  k.b.add('roof', ICO, M(cx + 0.08, tipY + 1.27, zc, 0.12, 0.12, 0.12), '#2a2440', 1);
  for (const s of [-1, 1]) k.b.add('roof', GEO.cone4, M(cx + 0.08 + s * 0.04, tipY + 1.36, zc, 0.05, 0.08, 0.05), '#2a2440', 1);
  // the telescope: out of the cone's right side, up-right (gold tube, darker eyepiece ring)
  { const a = 0.9, y = y0 + 0.35, rr = rAt(y), x = cx + Math.sin(a) * rr, z = zc + Math.cos(a) * rr;
    k.b.add('metal', GEO.cyl12, MY(x + 0.25, y + 0.3, z + 0.1, 0.24, 1.0, 0.24, a, 0, -1.0), P.gold, 1);
    k.b.add('metal', GEO.cyl12, MY(x + 0.66, y + 0.56, z + 0.18, 0.32, 0.22, 0.32, a, 0, -1.0), '#a07a1a', 1); }
  // windows on the round body (each turned to face out): the round one in the middle, two arched lower
  const onBody = (ax: number) => { const dx = f.w(ax - 2430); return { x: cx + dx, z: zc + Math.sqrt(Math.max(0, r * r - dx * dx)), a: Math.asin(Math.max(-1, Math.min(1, dx / r))) }; };
  { const o = onBody(2430), y = tt - 0.48;
    k.b.add('wood', GEO.cyl16, MY(o.x, y, o.z - 0.06, 0.8, 0.2, 0.8, 0, Math.PI / 2), P.wood, 1);
    k.b.add('emit', GEO.cyl16, MY(o.x, y, o.z + 0.02, 0.62, 0.08, 0.62, 0, Math.PI / 2), P.glass, 1);
    k.b.add('emit', CRESCENT, MY(o.x - 0.04, y, o.z + 0.065, 0.36, 0.36, 0.05, 0, 0, 0.6), '#ff9a3a', 1); }
  for (const ax of [2362, 2498]) {
    const o = onBody(ax), w = 0.4, h = 0.66, y = base + 2.98;
    const g1 = new THREE.ExtrudeGeometry(new THREE.Shape(archPts(-w / 2 - 0.06, w / 2 + 0.06, -0.06, h - w / 2, w / 2 + 0.06).map(([x, yy]) => new THREE.Vector2(x, yy))), { depth: 0.22, bevelEnabled: false });
    g1.translate(0, 0, -0.16); k.b.add('wood', g1, MY(o.x, y, o.z, 1, 1, 1, o.a), P.wood, 1); g1.dispose();
    const g2 = new THREE.ExtrudeGeometry(new THREE.Shape(archPts(-w / 2, w / 2, 0, h - w / 2, w / 2).map(([x, yy]) => new THREE.Vector2(x, yy))), { depth: 0.04, bevelEnabled: false });
    g2.translate(0, 0, 0.04); k.b.add('emit', g2, MY(o.x, y, o.z, 1, 1, 1, o.a), P.glass, 1); g2.dispose();
  }
  // the porch: an arched stone frame standing out of the body to the entrance plane, the blue door in it (door box:
  // frame ±0.6, top 2.2), round steps that sit ON the ground (the lower one 0.12 m, the upper 0.24 m), the red mat
  const zE = d.zE, dw = Math.min(0.48, d.hw - 0.12), dh = Math.min(2.0, d.h - 0.2);
  prism(k, 'stone', '#9a84c0', cutArch([[cx + dw + 0.38, base], ...arc(cx, base + dh - dw * 0.5 + 0.05, dw + 0.38, dw * 0.5 + 0.4, 0, Math.PI, 10), [cx - dw - 0.38, base]], cx - dw - 0.1, cx + dw + 0.1, base, base + dh - dw * 0.5, dw * 0.5 + 0.1), zc + r - 0.5, zE - 0.06);
  prism(k, 'stone', '#e4dcef', cutArch([[cx + dw + 0.1, base + 0.24], ...arc(cx, base + dh - dw * 0.5, dw + 0.1, dw * 0.5 + 0.1, 0, Math.PI, 10), [cx - dw - 0.1, base + 0.24]], cx - dw, cx + dw, base + 0.24, base + dh - dw * 0.5, dw * 0.5), zE - 0.06, zE + 0.02);
  prism(k, 'wood', '#4b3bb8', archPts(cx - dw, cx + dw, base + 0.24, base + dh - dw * 0.5, dw * 0.5), zE - 0.1, zE - 0.04);
  for (const s of [-1, 1]) box(k, 'wood', '#3a2d90', cx + s * dw * 0.45 - 0.02, cx + s * dw * 0.45 + 0.02, base + 0.3, base + dh - 0.2, zE - 0.04, zE - 0.02);
  k.b.add('metal', GEO.sphere, M(cx + dw * 0.6, base + 1.15, zE - 0.02, 0.07, 0.07, 0.05), P.gold, 1);
  markDoor(k, 'door', cx - dw - 0.1, cx + dw + 0.1, base + 0.24, base + dh + 0.1, zE - 0.1, zE + 0.03);   // light arch rim + the blue leaf
  k.b.add('stone', GEO.cyl16, M(cx, base + 0.06, zE - 0.1, 2.0, 0.12, 1.4), '#d8cde8', 1);
  k.b.add('stone', GEO.cyl16, M(cx, base + 0.18, zE - 0.25, 1.5, 0.12, 0.9), '#e4dcef', 1);
  box(k, 'wood', '#c0504a', cx - 0.4, cx + 0.4, base + 0.12, base + 0.135, zE + 0.2, zE + 0.5, 0.4);
  // the sign: the site's plate (196 × 30 px → ≤ 1.7 m), on two iron brackets out of the body above the porch
  const sw = Math.min(2.0, f.w(196) * 1.05), sy = base + dh + 0.42, sz = zc + r + 0.05;
  for (const s of [-1, 1]) box(k, 'metal', P.metal, cx + s * (sw / 2 - 0.15) - 0.025, cx + s * (sw / 2 - 0.15) + 0.025, sy + 0.1, sy + 0.16, zc + Math.sqrt(r * r - (sw / 2 - 0.15) ** 2) - 0.05, sz + 0.05, 0.4);
  signZ(k, signText(p, 'МУРЧАРОДЕЙНЯ'), cx, sy, sz, sw, { bg: P.nightD, fg: P.gold });
  // the left annex: lilac walls, a dome-like barrel roof (night blue) with its eave band, an arched window
  { const ax = f.X(2206), aw = f.w(80), z1 = zc + 0.25, z0 = toZ(600), top = f.Y(620);
    box(k, 'stone', '#b9a2d8', ax, ax + aw, base - 0.05, top, z0, z1, 1.2);
    box(k, 'roof', P.nightD, ax - f.w(14), ax + aw + f.w(14), top, top + 0.16, z0 - 0.08, z1 + 0.08, 0.8);
    k.b.add('roof', GEO.dome, M(ax + aw / 2, top + 0.16, (z0 + z1) / 2, aw + f.w(16), Math.max(0.8, f.h(62)) * 2, z1 - z0 + 0.08), P.night, 1);
    window3(k, 'wood', P.wood, ax + aw / 2, base + 0.7, f.w(40), Math.min(1.0, f.h(44) + 0.2), z1, true); }
  // the right shop box: lilac, a sloped night-blue lid, a square window with a crystal ball
  { const x0 = f.X(2550), x1 = f.X(2612), z1 = zc + 0.6, z0 = zc - 0.6, top = f.Y(630);
    box(k, 'stone', '#a48ccc', x0 + 0.02, x1, base - 0.05, top, z0, z1, 1.2);
    k.b.add('roof', GEO.box, M((x0 + x1) / 2 + 0.02, top + 0.1, (z0 + z1) / 2, x1 - x0 + 0.2, 0.12, z1 - z0 + 0.24, 0, 0, -0.18), P.nightL, 1);
    const wx = (x0 + x1) / 2 + 0.05, wy = base + 0.85;
    box(k, 'wood', P.wood, x1 - 0.02, x1 + 0.06, wy - 0.05, wy + 0.85, (z0 + z1) / 2 - 0.45, (z0 + z1) / 2 + 0.45, 0.4);
    box(k, 'emit', P.glass, x1 + 0.02, x1 + 0.065, wy + 0.02, wy + 0.78, (z0 + z1) / 2 - 0.38, (z0 + z1) / 2 + 0.38);
    k.b.add('emit', GEO.sphere, M(x1 + 0.08, wy + 0.4, (z0 + z1) / 2, 0.3, 0.3, 0.12), '#c9a2ff', 1);
    box(k, 'wood', P.wood, wx - 0.3, x1 - 0.02, wy - 0.05, wy + 0.85, z1 - 0.02, z1 + 0.06, 0.4);
    box(k, 'emit', P.glass, wx - 0.24, x1 - 0.08, wy + 0.02, wy + 0.78, z1 + 0.02, z1 + 0.065);
    k.b.add('emit', GEO.sphere, M((wx - 0.24 + x1 - 0.08) / 2, wy + 0.4, z1 + 0.07, 0.36, 0.36, 0.04), '#c9a2ff', 1); }
  k.glows.push(cx, f.Y(486), zc + r + 0.1, 1.0, 1, 0.8, 0.45);
  (k.blobs ||= []).push(cx, base + 0.01, zc, r + 0.4, r + 0.3);
}

/* ================================================================== Тюрьма (fc-art.js jailB) + Клетка (fc-city.js cage) */
/** The jail's cage numbers: p.data.jail (JailGeo of the layout), else fc-map.js JAIL moved with the jail's place. */
function jailGeo(p: FcPlace): JailGeo {
  const J = p.data?.jail as JailGeo | undefined;
  if (J && [J.c0, J.c1, J.fy].every(Number.isFinite)) return J;
  const ox = p.vis[2] - 4160, oy = p.foot[3] - 2150;
  return { x0: p.foot[0], x1: p.foot[2], base: p.foot[3], c0: 4184 + ox, c1: 4410 + ox, ct: 1966 + oy, back: 2016 + oy, fy: 2150 + oy, door: [4263 + ox, 4331 + ox],
    seats: [], walk: [4214 + ox, 2060 + oy, 4380 + ox, 2134 + oy] };
}
/** A giant blue pet carrier: cream base tray with round rivet holes and latches, the blue lid with rows of vent slots
 *  (front, top, ends), the arched carry handle on top, the grated door with its frame, bars and the latch, a cat in the
 *  dark; «ТЮРЬМА» over the door. Its own solid (the site's 'building:jail' obstacle is skipped by fairCatsSolids). */
function buildJail(k: Ctx, p: FcPlace): void {
  const f = frame(p, 3560, 4160, 2150), { zf, zb, base } = f, D = zf - zb;
  const L = f.X(3580), R = f.X(4140), cx = f.X(3860), sh = f.Y(2022), lt = Math.max(f.Y(1922), sh + 1.6), rc = Math.min((lt - sh) * 0.7, 1.0);
  const zm = (zb + zf) / 2;
  // base tray (cream, rounded bottom edges) and the seam band
  const tray = rrect(L, base, R, sh, [0.22, 0.22, 0, 0]);
  prism(k, 'plaster', '#ece6dc', tray, zb, zf, 1.4);
  box(k, 'plaster', '#7fa6d0', L - 0.04, R + 0.04, sh - 0.12, sh + 0.04, zb - 0.04, zf + 0.04, 0.8);
  box(k, 'plaster', '#4a6c96', L - 0.05, R + 0.05, sh - 0.16, sh - 0.12, zb - 0.05, zf + 0.05, 0.8);
  // the lid (blue, rounded top corners on the front profile) and its light front band
  const lid = rrect(L + f.w(10), sh, R - f.w(10), lt, [0, 0, rc, rc]);
  prism(k, 'plaster', '#7fa6d0', lid, zb + 0.02, zf - 0.02, 1.4);
  box(k, 'plaster', '#9ec0e4', L + f.w(60), R - f.w(60), lt - 0.32, lt - 0.12, zf - 0.03, zf + 0.0, 0.8);
  box(k, 'plaster', '#9ec0e4', L + f.w(70), R - f.w(70), lt - 0.01, lt + 0.02, zb + 0.3, zf - 0.3, 0.8);
  // vent slots: two rows along the lid front (skipping the door column), rows on the top, columns on the ends
  const slot = (x0: number, x1: number, y0: number, y1: number, z: number) => { box(k, 'flat', '#2f4a6e', x0, x1, y0, y1, z - 0.012, z + 0.012); box(k, 'flat', '#1d2e48', x0 + 0.02, x1, y1 - 0.04, y1 - 0.02, z + 0.017, z + 0.024); };
  for (let i = 0; i < 9; i++) {
    const ax = 3650 + i * 52; if (Math.abs(ax + 18 - 3860) < 80) continue;
    slot(f.X(ax), f.X(ax + 36), f.Y(1962), f.Y(1950), zf - 0.02);
    slot(f.X(ax + 6), f.X(ax + 30), f.Y(1992), f.Y(1980), zf - 0.02);
  }
  for (let r = 0; r < 3; r++) for (let i = 0; i < 6; i++) { const x = L + 0.7 + i * (R - L - 1.4) / 5, z = zb + 0.6 + r * (D - 1.2) / 2; box(k, 'flat', '#2f4a6e', x - 0.22, x + 0.22, lt, lt + 0.015, z - 0.07, z + 0.07); }
  for (const x of [L + f.w(10) - 0.005, R - f.w(10) + 0.005]) for (let r = 0; r < 2; r++) for (let i = 0; i < 4; i++) {
    const z = zb + 0.6 + i * (D - 1.2) / 3, y = sh + 0.35 + r * 0.45; box(k, 'flat', '#2f4a6e', x - 0.012, x + 0.012, y - 0.08, y + 0.08, z - 0.2, z + 0.2);
  }
  // round rivet holes on the tray front + ends, side latches
  for (const ax of [3630, 3690, 4030, 4090]) for (const ay of [2060, 2100]) k.b.add('flat', GEO.cyl12, M(f.X(ax), f.Y(ay), zf + 0.005, f.w(18), 0.02, f.w(18), Math.PI / 2), '#5a5048', 1);
  for (const x of [L - 0.005, R + 0.005]) for (let i = 0; i < 3; i++) for (const yy of [base + 0.55, base + 1.15]) k.b.add('flat', GEO.cyl12, M(x, yy, zb + D * (0.3 + i * 0.2), 0.02, 0.22, 0.16, 0, 0, Math.PI / 2), '#5a5048', 1);
  for (const ax of [3600, 4106]) box(k, 'plaster', '#d8d0c4', f.X(ax), f.X(ax + 14), sh - f.h(124), sh + f.h(14) * 0 + 0.1, zf, zf + 0.06, 0.5);
  // the carry handle (blue arch along x on top) on two blocks
  const hw = f.w(92) * 1.25, hh = Math.max(0.95, f.h(64));
  k.b.add('plaster', HALF_TORUS, M(cx, lt + 0.15, zm, hw * 2, hh * 2, 3.2), '#4a6c96', 1);
  for (const s of [-1, 1]) box(k, 'plaster', '#4a6c96', cx + s * hw - f.w(14), cx + s * hw + f.w(14), lt - 0.02, lt + 0.2, zm - 0.22, zm + 0.22, 0.5);
  // the door (the door region: x ± 0.5 is not used — the jail's hit spans the building; keep it in the front layer)
  const d0 = f.X(3786), d1 = f.X(3934), dt = Math.min(f.Y(2034), sh - 0.08);
  prism(k, 'plaster', '#d8d0c4', rrect(d0 - f.w(8), base, d1 + f.w(8), dt + f.w(8), [0, 0, 0.14, 0.14]), zf, zf + 0.06);
  prism(k, 'flat', '#2a1e24', rrect(d0, base + 0.04, d1, dt, [0, 0, 0.1, 0.1]), zf + 0.02, zf + 0.065);
  k.b.add('flat', ICO, M(cx - 0.05, base + 0.42, zf + 0.072, 0.55, 0.8, 0.006), '#45343c', 1);
  k.b.add('flat', ICO, M(cx - 0.05, base + 0.98, zf + 0.077, 0.42, 0.4, 0.006), '#45343c', 1);
  for (const s of [-1, 1]) { k.b.add('flat', GEO.cone4, M(cx - 0.05 + s * 0.13, base + 1.22, zf + 0.082, 0.1, 0.2, 0.006), '#45343c', 1); k.b.add('emit', GEO.sphere, M(cx - 0.05 + s * 0.08, base + 1.0, zf + 0.086, 0.07, 0.07, 0.006), P.glass, 1); }
  for (let i = 0; i < 7; i++) { const x = f.X(3804 + i * 18.6); k.b.add('metal', GEO.cyl8, M(x, (base + 0.06 + dt - 0.04) / 2, zf + 0.085, 0.05, dt - base - 0.1, 0.05), '#c9ccd6', 1); }
  for (const ay of [2080, 2120]) box(k, 'metal', '#c9ccd6', d0 + 0.03, d1 - 0.03, f.Y(ay) - 0.025, f.Y(ay) + 0.025, zf + 0.09, zf + 0.12);
  box(k, 'metal', '#8a8e9e', d1 - 0.03, d1 + 0.04, base + 0.05, dt, zf + 0.06, zf + 0.12);
  box(k, 'metal', '#8a8e9e', f.X(3920), f.X(3942), f.Y(2114), f.Y(2080), zf + 0.12, zf + 0.18);
  markDoor(k, 'door', d0 - f.w(8), Math.max(d1 + f.w(8), f.X(3942)), base, dt + f.w(8), zf - 0.005, zf + 0.185);   // the grated door, its frame and latch
  // «ТЮРЬМА» on the lid front, over the door
  const sw = Math.min(1.8, f.w(140) * 1.25);
  signZ(k, signText(p, 'ТЮРЬМА'), cx, Math.max(dt + 0.12, sh + 0.02), zf - 0.03, sw, { bg: '#4a5068', fg: P.gold });
  (k.blobs ||= []).push(cx, base + 0.01, zm, (R - L) / 2 + 0.2, D / 2 + 0.2);
  (k.solids ||= []).push(L - 0.05, R + 0.05, zb - 0.05, zf + 0.1, Infinity);
  k.colliders.push(L, R, base, lt + 1.0, zb, zf + 0.1);
  cage(k, p, jailGeo(p));
}

/** «Клетка» (fc-city.js cage): a sand floor, steel corner posts, top and bottom rails, light bars in front, darker ones
 *  behind and on the sides, roof bars, the КЛЕТКА plate on the front beam, a red bowl at the back. Solids as the old
 *  street cage (src/world/jail.ts): bars all round (Infinity), the floor inside finite — prisoners walk on it. */
function cage(k: Ctx, p: FcPlace, J: JailGeo): void {
  const base = p.base, cx0 = toX(J.c0), cx1 = toX(J.c1), cz = toZ(J.fy), zw = toZ(J.back ?? J.fy - 134), H = 2.2, top = base + H, fl = base + 0.03;
  const bar = (x: number, z: number, y0: number, y1: number, col: string, r = 0.028) => k.b.add('metal', GEO.cyl8, M(x, (y0 + y1) / 2, z, r * 2, y1 - y0, r * 2), col, 1);
  box(k, 'plaster', '#e8cf98', cx0, cx1, base - 0.05, fl, zw + 0.025, cz + 0.04, 0.9);
  for (let i = 0; i < 6; i++) k.b.add('flat', GEO.box, M(cx0 + 0.3 + i * (cx1 - cx0 - 0.6) / 5, fl + 0.009, zw + 0.4 + (i % 3) * 0.5, 0.25, 0.006, 0.03, 0, 0.5 - (i % 2), 0), '#c99a30', 1);
  for (const x of [cx0, cx1]) for (const z of [cz, zw + 0.07]) box(k, 'metal', '#8a8e9e', x - 0.07, x + 0.07, base, top + 0.1, z - 0.07, z + 0.07, 0.5);
  for (const z of [cz, zw + 0.07]) {
    box(k, 'metal', '#5f6374', cx0 - 0.1, cx1 + 0.1, top - 0.04, top + 0.14, z - 0.08, z + 0.08, 0.5);
    box(k, 'metal', '#5f6374', cx0 - 0.1, cx1 + 0.1, base, fl + 0.12, z - 0.064, z + 0.064, 0.5);
  }
  for (const x of [cx0, cx1]) { box(k, 'metal', '#5f6374', x - 0.05, x + 0.05, top - 0.02, top + 0.1, zw + 0.07, cz, 0.5); box(k, 'metal', '#5f6374', x - 0.05, x + 0.05, base, fl + 0.1, zw + 0.07, cz, 0.5); }
  for (let x = cx0 + 0.24; x < cx1 - 0.08; x += 0.24) { bar(x, cz, fl + 0.1, top - 0.02, '#c9ccd6'); bar(x, zw + 0.07, fl + 0.1, top - 0.02, '#8a8e9e'); }
  for (const x of [cx0, cx1]) for (let z = cz - 0.3; z > zw + 0.2; z -= 0.3) bar(x, z, fl + 0.08, top - 0.02, '#8a8e9e');
  for (let x = cx0 + 0.26; x < cx1 - 0.1; x += 0.26) box(k, 'metal', '#8a8e9e', x - 0.02, x + 0.02, top + 0.15, top + 0.19, zw + 0.07, cz, 0.5);
  k.b.add('flat', GEO.cyl12, M(cx1 - 0.4, fl + 0.04, zw + 0.45, 0.44, 0.08, 0.15), '#c94a3a', 1);
  signZ(k, 'КЛЕТКА', (cx0 + cx1) / 2, top + 0.2, cz + 0.02, Math.min(1.24, cx1 - cx0 - 0.4), { bg: '#4a5068', fg: P.gold });
  (k.blobs ||= []).push((cx0 + cx1) / 2, base + 0.01, (zw + cz) / 2, (cx1 - cx0) / 2 + 0.2, (cz - zw) / 2 + 0.2);
  const S = (k.solids ||= []), zi = zw + 0.16;
  S.push(cx0 - 0.1, cx1 + 0.1, cz - 0.08, cz + 0.1, Infinity);
  S.push(cx0 - 0.1, cx1 + 0.1, zw - 0.04, zi, Infinity);
  S.push(cx0 - 0.1, cx0 + 0.06, zw, cz, Infinity);
  S.push(cx1 - 0.06, cx1 + 0.1, zw, cz, Infinity);
  S.push(cx0 + 0.06, cx1 - 0.06, zi, cz - 0.08, fl);
}

/* ================================================================== Склад (fc-art.js storageB) */
/** A plank barn under a red gable roof with a hayloft dormer and a hoist beam (a crate on its rope); an open front:
 *  the dark plank inside with a shelf of boxes, a ladder, a hanging lamp, hay on the floor; both doors swung open;
 *  two windows; РЫБА / МОЛОКО crates outside, a sack. Back wall closed (free-standing). */
function buildStorage(k: Ctx, p: FcPlace): void {
  const f = frame(p, 4560, 5220, 2400), { zf, zb, base } = f, D = zf - zb, d = doorBox('storage', p);
  const L = f.X(4580), R = f.X(5200), cx = f.dx, wt = Math.max(f.Y(2252), base + 2.6);
  const gw = Math.min(f.w(96), d.hw - 0.1), gT = Math.min(base + d.h - 0.3, Math.max(f.Y(2280), base + 2.15)), t = 0.14;
  // walls: planks round an opening (left, right, over it), the back and the sides
  box(k, 'wood', P.wood, L, cx - gw - 0.08, base - 0.05, wt, zf - t, zf, 0.9);
  box(k, 'wood', P.wood, cx + gw + 0.08, R, base - 0.05, wt, zf - t, zf, 0.9);
  box(k, 'wood', P.wood, cx - gw - 0.08, cx + gw + 0.08, gT + 0.1, wt, zf - t, zf, 0.9);
  box(k, 'wood', shade(P.wood, -0.12), L, R, base - 0.05, wt, zb, zb + t, 0.9);
  for (const x of [L, R - t]) box(k, 'wood', shade(P.wood, -0.18), x, x + t, base - 0.05, wt, zb + t, zf - t, 0.9);
  for (let i = 1; i < 30; i++) { const x = L + (R - L) * i / 30; if (Math.abs(x - cx) < gw + 0.12) continue; box(k, 'wood', P.woodD, x - 0.008, x + 0.008, base + 0.05, wt - 0.05, zf, zf + 0.006); }
  box(k, 'wood', P.brickD, L - f.w(24), R + f.w(24), wt - 0.02, wt + 0.18, zb - 0.1, zf + 0.12, 0.6);   // fascia (inside the roof's hips)
  // inside: dark back planks, floor, a shelf with boxes, a ladder, hay, the lamp (warm glow)
  const zi = zb + t + 0.02;
  box(k, 'wood', '#5e3e2c', L + t, R - t, base - 0.04, wt - 0.05, zi, zi + 0.02, 0.9);
  box(k, 'wood', '#8a6040', L + t, R - t, base - 0.04, base + 0.02, zi + 0.02, zf - t - 0.005, 0.9);
  for (const yy of [base + 0.75, base + 1.35]) box(k, 'wood', P.woodL, cx - gw + 0.05, cx - 0.1, yy - 0.04, yy, zi + 0.02, zi + 0.5, 0.5);
  for (const [x0, w, h, yy, c] of [[0.1, 0.36, 0.3, 0.75, P.cardL], [0.5, 0.32, 0.24, 0.75, P.card], [0.12, 0.3, 0.26, 1.35, P.card], [0.48, 0.26, 0.2, 1.35, P.cardD]] as const)
    box(k, 'wood', c, cx - gw + x0, cx - gw + x0 + w, base + yy, base + yy + h, zi + 0.06, zi + 0.42, 0.4);
  for (const s of [0, 1]) k.b.add('wood', GEO.box, M(cx + gw - 0.55 + s * 0.38, base + 1.1, zi + 0.3, 0.06, 2.2, 0.06, 0, 0, 0.12), P.woodL, 1);
  for (let i = 0; i < 4; i++) box(k, 'wood', P.woodL, cx + gw - 0.58 + i * 0.05, cx + gw - 0.12 + i * 0.05, base + 0.4 + i * 0.5, base + 0.45 + i * 0.5, zi + 0.276, zi + 0.324, 0.4);
  k.b.add('canvas', ICO, M(cx + 0.4, base + 0.15, zf - t - 0.6, 1.2, 0.5, 0.8), '#f0c464', 1);
  box(k, 'wood', P.metal, cx + 0.3 - 0.01, cx + 0.3 + 0.01, gT - 0.4, wt + 0.17, zi + 0.9, zi + 0.92, 0.4);   // the lamp's rod up to the roof (no float)
  box(k, 'emit', '#ffd77a', cx + 0.22, cx + 0.38, gT - 0.62, gT - 0.4, zi + 0.83, zi + 0.99);
  k.glows.push(cx + 0.3, gT - 0.5, zi + 0.9, 1.2, 1, 0.78, 0.42); k.lights.push(cx + 0.3, gT - 0.5, zf - 0.5);
  // the opening's frame (in the door box: x ± 1.06, top 2.6) and the two doors swung out
  for (const s of [-1, 1]) box(k, 'wood', P.woodD, cx + s * gw - 0.05, cx + s * gw + 0.05, base + 0.01, gT + 0.1, zf - 0.02, zf + 0.08, 0.5);
  box(k, 'wood', P.woodD, cx - gw - 0.07, cx + gw + 0.07, gT, gT + 0.115, zf - 0.025, zf + 0.085, 0.5);
  markDoor(k, 'arch', cx - gw - 0.07, cx + gw + 0.07, base, gT + 0.115, zf - 0.03, zf + 0.09);   // the open front's frame
  for (const s of [-1, 1]) {
    const hx = cx + s * (gw + 0.08), dw = Math.min(f.w(96), 0.95), a = s * -1.05;
    const mx = hx + s * Math.cos(1.05) * dw / 2, mz = zf + 0.1 + Math.sin(1.05) * dw / 2;
    k.b.add('wood', GEO.box, M(mx, base + gT / 2 - base / 2 + 0.03, mz, dw, gT - base - 0.06, 0.06, 0, a, 0), P.woodL, 1);
    k.b.add('wood', GEO.box, M(mx + Math.sin(a) * 0.045, base + (gT - base) / 2, mz + Math.cos(a) * 0.045, Math.hypot(dw, gT - base) * 0.92, 0.08, 0.02, 0, a, s * Math.atan2(gT - base, dw)), P.woodD, 1);
  }
  // windows left / right of the opening
  for (const ax of [4667, 5113]) window3(k, 'wood', P.woodD, f.X(ax), base + 0.95, f.w(54), f.h(44) + 0.15, zf, false);
  // roof: red gable, the hayloft dormer with hay, the hoist beam and its crate
  const rh = Math.max(1.9, Math.min(2.4, f.h(186))), ov = f.w(24) + 0.15, ry0 = wt + 0.16;
  const gz = (z0: number, z1: number, y0: number, h: number, x0: number, x1: number, col: string) => {
    prism(k, 'wood', col, [[x0, y0], [x1, y0], [(x0 + x1) / 2, y0 + h]], z0, z1);
  };
  // the hipped red roof of the site's roofV(L − 24, R + 24, wt + 4, 2066, dx 46, dy 32, red, sw 36, sh 21, ridge 14): the
  // ridge ends from roofRidge (plan x), the eave RDROP px lower (the ridge stays), scalloped rows / bands / ridge cap (roof.ts)
  { const sr = siteRoof({ L: 4556, R: 5224, eY: 2256, rY: 2066, dx: 46, dy: 32, sw: 36, sh: 21 }), drop = f.h(sr.ridge.drop);
    tileHipRoof(k, { x0: L - ov, x1: R + ov, z0: zb - ov, z1: zf + ov, y0: ry0 - drop, h: rh + drop, rx0: f.X(sr.ridge.x0), rx1: f.X(sr.ridge.x1),
      pal: [P.red, P.redD, P.redL], tileW: f.w(sr.sw), rows: sr.rows, sideRows: sr.sideRows, soffit: P.redD, ridge: f.w(23), rib: 0.12, lip: 0.1 }); }
  { const w = f.w(120), y0 = ry0 + 0.1, z1 = zf + 0.05, z0 = z1 - 1.4, h = Math.max(1.0, f.h(64));
    box(k, 'wood', P.woodL, cx - w / 2, cx + w / 2, y0, y0 + h, z0, z1, 0.6);
    for (const s of [-1, 1]) roofPiece(k, GEO.box, M(cx + s * w / 4, y0 + h + 0.25, (z0 + z1) / 2, w / 2 / Math.cos(0.75) + 0.15, 0.1, z1 - z0 + 0.2 + (s > 0 ? 0.012 : 0), 0, 0, -s * 0.75), P.redL);
    gz(z1 - 0.02, z1, y0 + h, w / 2 * Math.tan(0.75), cx - w / 2, cx + w / 2, P.woodL);
    box(k, 'wood', '#3a2a30', cx - f.w(32), cx + f.w(32), y0 + 0.12, y0 + h - 0.08, z1, z1 + 0.02, 0.4);
    k.b.add('canvas', ICO, M(cx, y0 + 0.2, z1 - 0.02, f.w(60), 0.35, 0.16), '#f0c464', 1);
    box(k, 'wood', P.woodD, cx - 0.04, cx + 0.04, y0 + h + 0.02, y0 + h + 0.12, z1 - 0.2, z1 + 0.9, 0.4);
    box(k, 'wood', '#d8cbb0', cx - 0.008, cx + 0.008, y0 + h - 0.5, y0 + h + 0.02, z1 + 0.82, z1 + 0.84, 0.3);
    box(k, 'wood', P.card, cx - 0.2, cx + 0.2, y0 + h - 0.85, y0 + h - 0.5, z1 + 0.66, z1 + 1.0, 0.4); }
  // sign over the opening, crates outside (РЫБА / МОЛОКО) with smaller ones on top, a sack
  signZ(k, signText(p, 'СКЛАД'), cx, gT + 0.16, zf, Math.min(1.3, f.w(130)), { bg: P.plum, fg: P.gold });
  const crate = (x0: number, x1: number, y0: number, h: number, z1: number, d: number, c: string, lab?: string) => {
    box(k, 'wood', c, x0, x1, y0, y0 + h, z1 - d, z1, 0.4);
    box(k, 'wood', '#c9b28a', (x0 + x1) / 2 - 0.04, (x0 + x1) / 2 + 0.04, y0 + h + 0.003, y0 + h + 0.012, z1 - d + 0.01, z1 - 0.01, 0.4);
    if (lab) signZ(k, lab, (x0 + x1) / 2, y0 + h * 0.3, z1, (x1 - x0) * 0.8, { bg: c, fg: INK });
  };
  crate(f.X(4596), f.X(4670), base, Math.max(0.8, f.h(56)), zf + 0.75, 0.7, P.card, 'РЫБА');
  crate(f.X(4606), f.X(4662), base + Math.max(0.8, f.h(56)), Math.max(0.6, f.h(44)), zf + 0.68, 0.56, P.cardL);
  crate(f.X(5114), f.X(5180), base, Math.max(0.85, f.h(60)), zf + 0.75, 0.7, P.card, 'МОЛОКО');
  crate(f.X(5126), f.X(5172), base + Math.max(0.85, f.h(60)), Math.max(0.55, f.h(38)), zf + 0.66, 0.5, P.cardD);
  k.b.add('canvas', ICO, M(f.X(5060), base + 0.25, zf + 0.35, 0.5, 0.55, 0.45), '#d8c8a0', 1);
  (k.blobs ||= []).push((L + R) / 2, base + 0.01, zb + D / 2, (R - L) / 2 + 0.2, D / 2 + 0.2);
}

/* ================================================================== Ворота (fc-art.js gateB) */
/** The gate faces the town (its face on foot[1], −z; the outer face the same): a stone wall block with an arched
 *  passage, a light voussoir ring, the portcullis up in the arch, merlons on a light coping; two round stone towers
 *  with purple cones, cat ears and flags (gold left, pink right), slit windows; «ВОРОТА» over the arch; lanterns. */
function buildGate(k: Ctx, p: FcPlace): void {
  const f = frame(p, 2620, 3140, 3010), base = p.base, d = doorBox('gate', p);
  const zN = toZ(p.foot[1]), zS = toZ(p.foot[3]), zm = (zN + zS) / 2, cx = f.dx;
  const W0 = f.X(2770), W1 = f.X(2990), wt = f.Y(2870), aw = Math.min(f.w(52), d.hw - f.w(22) - 0.03), ar = Math.min(f.h(50), aw), as = Math.min(f.Y(2924), base + d.h - ar - f.h(22) - 0.04);
  // the wall block with the passage (one extrusion through the whole depth)
  prism(k, 'stone', P.rock, cutArch([[W1, base - 0.05], [W1, wt], [W0, wt], [W0, base - 0.05]], cx - aw, cx + aw, base - 0.05, as, ar, 12), zN + 0.02, zS - 0.02, 1.2);
  box(k, 'stone', P.rockL, W0 - 0.05, W1 + 0.05, wt, wt + f.h(16), zN - 0.03, zS + 0.03, 0.8);
  for (let i = 0; i < 6; i++) { const x = f.X(2780 + i * 36); for (const [z0, z1] of [[zN - 0.03, zN + 0.4], [zS - 0.4, zS + 0.03]]) box(k, 'stone', P.rockL, x, x + f.w(24), wt + f.h(16), wt + f.h(16) + f.h(26), z0, z1, 0.8); }
  // on both faces: the voussoir ring (8 stones), the dark recess band, the portcullis on the town side
  const vr = f.w(22);
  for (const [zFace, dir] of [[zN, -1], [zS, 1]] as const) {
    for (let i = 0; i < 8; i++) {
      const a0 = Math.PI - i * Math.PI / 8 - 0.02, a1 = a0 - Math.PI / 8 * 0.92;
      const pts: V2[] = [[cx + Math.cos(a0) * aw, as + Math.sin(a0) * ar], [cx + Math.cos(a0) * (aw + vr), as + Math.sin(a0) * (ar + vr)], [cx + Math.cos(a1) * (aw + vr), as + Math.sin(a1) * (ar + vr)], [cx + Math.cos(a1) * aw, as + Math.sin(a1) * ar]];
      prism(k, 'stone', i % 2 ? P.rockL : shade(P.rockL, -0.06), pts, dir < 0 ? zFace - 0.07 : zFace - 0.02, dir < 0 ? zFace + 0.02 : zFace + 0.07, 0.8);
    }
    for (const s of [-1, 1]) box(k, 'stone', P.rockD, cx + s * (aw + vr / 2) - vr / 2, cx + s * (aw + vr / 2) + vr / 2, base, as, dir < 0 ? zFace - 0.06 : zFace - 0.02, dir < 0 ? zFace + 0.02 : zFace + 0.06, 0.8);
  }
  markDoor(k, 'arch', cx - aw - vr - 0.005, cx + aw + vr + 0.005, base, as + ar + vr + 0.01, zN - 0.075, zN + 0.025);   // the town face's voussoir ring + jambs
  // the portcullis up in the arch (iron bars with points, a cross bar), 10 cm inside the town face
  const pz = zN + 0.12, py0 = as + ar * 0.1 - 0.5;
  for (let i = 0; i < 6; i++) { const x = cx - aw * 0.8 + i * aw * 1.6 / 5; box(k, 'metal', P.metal, x - 0.035, x + 0.035, py0, as + ar * Math.sqrt(Math.max(0, 1 - ((x - cx) / aw) ** 2)) - 0.02, pz - 0.035, pz + 0.035); k.b.add('metal', GEO.cone4, M(x, py0 - 0.07, pz, 0.08, 0.14, 0.08, Math.PI), P.metal, 1); }
  box(k, 'metal', P.metal, cx - aw + 0.02, cx + aw - 0.02, py0 + 0.22, py0 + 0.3, pz - 0.04, pz + 0.04);
  // towers: stone cylinders, a darker plinth, the eave ring, purple cone, cat ears, flag; a slit window each
  const tr = f.w(78), tTop = f.Y(2790);
  for (const [ax, fc] of [[2700, P.gold], [3060, P.pink]] as const) {
    const x = f.X(ax);
    lathe(k, 'stone', P.rock, x, zm, [[tr + 0.06, base - 0.05], [tr + 0.06, base + 0.35], [tr, base + 0.38], [tr, tTop]], 16, 1.2);
    lathe(k, 'stone', P.rockL, x, zm, [[tr - 0.02, tTop - 0.02], [f.w(92), tTop], [f.w(92), tTop + 0.14], [tr * 0.6, tTop + 0.14]], 16, 0.8);
    const R0 = f.w(100), y0 = tTop + 0.1, h = Math.max(1.6, f.h(84));
    lathe(k, 'roof', P.plumD, x, zm, [[R0 - 0.1, y0 - 0.06], [R0 + 0.02, y0], [R0 + 0.02, y0 + 0.12]], 16, 1);
    lathe(k, 'roof', P.plum, x, zm, [[R0 + 0.02, y0 + 0.12], [R0 * 0.6, y0 + h * 0.3], [R0 * 0.28, y0 + h * 0.65], [0.02, y0 + h]], 16, 1);
    for (const s of [-1, 1]) {   // ears on the town side, leaning out
      const ex = x + s * R0 * 0.45, ey = y0 + h * 0.32, ez = zm - R0 * 0.52;
      k.b.add('roof', GEO.cone4, M(ex, ey + 0.22, ez, 0.36, 0.5, 0.12, -0.3, 0, -s * 0.35), P.plum, 1);
      k.b.add('roof', GEO.cone4, M(ex, ey + 0.2, ez - 0.07, 0.2, 0.32, 0.04, -0.3, 0, -s * 0.35), P.pink, 1);
    }
    box(k, 'metal', P.metal, x - 0.025, x + 0.025, y0 + h - 0.05, y0 + h + 0.8, zm - 0.025, zm + 0.025, 0.4);
    prism(k, 'roof', fc, [[x, y0 + h + 0.45], [x + 0.55, y0 + h + 0.55], [x + 0.48, y0 + h + 0.64], [x + 0.55, y0 + h + 0.74], [x, y0 + h + 0.78]], zm - 0.015, zm + 0.015);
    for (const dz of [-1, 1]) {
      const z = zm + dz * (tr - 0.02), wy = f.Y(2886);
      prism(k, 'emit', '#5a4a40', archPts(x - f.w(9) - 0.05, x + f.w(9) + 0.05, wy, wy + f.h(22), f.w(9) + 0.05), dz < 0 ? z - 0.05 : z, dz < 0 ? z : z + 0.05);
    }
  }
  // the sign over the arch on both faces, lanterns either side of the arch (town side)
  const sy = Math.max(as + ar + vr + 0.08, wt - 0.75), sw = Math.min(1.5, f.w(150));
  signZ(k, signText(p, 'ВОРОТА'), cx, sy, zS + 0.02, sw, { bg: P.plum, fg: P.gold });
  turned(k, cx, zN, () => signZ(k, signText(p, 'ВОРОТА'), cx, sy, zN - 0.02, sw, { bg: P.plum, fg: P.gold }));
  for (const s of [-1, 1]) for (const [zz, dir] of [[zN, -1], [zS, 1]] as const) {
    const x = cx + s * f.w(86), y = base + 1.9;
    box(k, 'metal', P.metal, x - 0.02, x + 0.02, y + 0.12, y + 0.16, Math.min(zz, zz + dir * 0.2), Math.max(zz, zz + dir * 0.2));
    box(k, 'emit', '#ffd77a', x - 0.07, x + 0.07, y - 0.12, y + 0.1, zz + dir * 0.13 - 0.07, zz + dir * 0.13 + 0.07);
    box(k, 'metal', P.metal, x - 0.1, x + 0.1, y + 0.1, y + 0.15, zz + dir * 0.13 - 0.1, zz + dir * 0.13 + 0.1);
    k.glows.push(x, y, zz + dir * 0.2, 0.9, 1, 0.78, 0.4);
  }
  (k.blobs ||= []).push(cx, base + 0.01, zm, (f.X(3140) - f.X(2620)) / 2, (zS - zN) / 2 + 0.2);
}

/* ================================================================== Шахта (tk-art.js minePortal) */
/** The timber portal in the rock face: two posts with braces under a lintel, a shingled lean-to roof with moss on it,
 *  the plum «ШАХТА» plate with a gold rim and crossed picks; the dark adit (unlit gradient walls) with rails going in
 *  and a lamp deep inside; a rock collar round it; lanterns on brackets either side; a pick leaning on the left, a crate
 *  with a grey cat and a miner's lamp on the right. The posts, braces and the inner lintel are exactly the door box
 *  (x ± 1.28, ≤ 3.1 m, zE − 0.45 … zE + 0.13): the hover outline follows the timbers. */
function buildMine(k: Ctx, p: FcPlace): void {
  const base = p.base, d = doorBox('mine', p), cx = d.x, zE = d.zE, kx = (p.vis[2] - p.vis[0]) / 370;
  const w = (a: number) => a * kx * SX, h = (a: number) => a * HY * kx;
  const ow = Math.min(w(104), d.hw - w(18) - 0.02), pw = w(22), T = Math.min(base + Math.max(h(148), 2.4), base + d.h - 0.12);
  const zp0 = zE - 0.34, zp1 = zE - 0.02;   // the portal's timber layer
  // rock collar (a block with the adit cut through), the adit inside
  const ro = ow + pw + 0.55, rt = T + 0.55;   // rock collar round the portal (in front of the face, back into it)
  prism(k, 'rock', P.mrock, cutArch([[cx + ro, base - 0.1], [cx + ro * 0.8, rt], [cx, rt + 0.4], [cx - ro * 0.8, rt], [cx - ro, base - 0.1]], cx - ow, cx + ow, base - 0.1, T - 0.45, 0.45, 8), zE - 2.0, zp0 - 0.01, 1.2);
  for (const [dx, dy, s] of [[-ro, 0.5, 0.9], [ro, 0.42, 0.8]] as const)
    k.b.add('rock', ICO, M(cx + dx, base + dy, zp0 - 0.5, s * 1.6, s * 1.1, s * 1.2, 0, dx, 0), shade(P.mrock, (dx > 0 ? -0.08 : 0.05)), 1.2);
  // the adit mouth: the mountain face rises right behind the portal (its foot is the portal's base line), so the dark
  // is a shallow layered recess in front of it (as the site draws it): two dark arch rings, a black back, the floor, rails
  const zk = zp0 - 0.08, zz = zk;
  box(k, 'emit', '#0d0709', cx - ow - 0.02, cx + ow + 0.02, base + 0.012, T - 0.1, zk - 0.03, zk);
  for (const [z0, c, inset, top] of [[zk + 0.005, '#3e2a24', 0.32, T - 0.12], [zk + 0.03, '#6a4a38', 0.16, T - 0.15]] as const)
    prism(k, 'emit', c, cutArch([[cx + ow - 0.005, base + 0.016], [cx + ow - 0.005, top], [cx - ow + 0.005, top], [cx - ow + 0.005, base + 0.016]], cx - ow + inset, cx + ow - inset, base + 0.016, T - 0.5 - inset, 0.42, 8), z0, z0 + 0.022);
  box(k, 'emit', '#7a5a44', cx - ow, cx + ow, base - 0.04, base + 0.012, zk - 0.03, zE + 0.02);
  // (the rails into the mouth are the terrain's: faircats.ts fcRails along the site's RAILS)
  // the lamp stand at the back of the mouth (a tripod, the lit lamp on it)
  for (const s of [-1, 0, 1]) k.b.add('wood', GEO.box, M(cx + 0.08 + s * 0.12, base + 0.45, zk + 0.06 + (s ? 0 : 0.08), 0.03, 0.92, 0.03, s ? 0 : -0.15, 0, s * 0.2), '#4a3426', 1);
  box(k, 'emit', '#ffd76a', cx + 0.03, cx + 0.13, base + 0.9, base + 1.04, zk + 0.06, zk + 0.16);
  k.glows.push(cx + 0.08, base + 0.97, zk + 0.12, 0.7, 1, 0.8, 0.4);
  // the portal: posts, braces, the inner lintel (all in the door box), then the outer beam, the roof, the plate
  for (const s of [-1, 1]) {
    const x0 = cx + s * ow, x1 = cx + s * (ow + pw);
    box(k, 'wood', P.wood, Math.min(x0, x1), Math.max(x0, x1), base - 0.005, T - 0.08, zp0, zp1, 0.5);
    box(k, 'wood', P.woodL, Math.min(x0, x1) + 0.04, Math.min(x0, x1) + 0.07, base + 0.1, T - 0.2, zp1, zp1 + 0.01, 0.5);
    const bx0 = cx + s * (ow - 0.02), by0 = T - 0.62, bx1 = cx + s * (ow - 0.42), by1 = T - 0.1;
    k.b.add('wood', GEO.box, M((bx0 + bx1) / 2, (by0 + by1) / 2, (zp0 + zp1) / 2 + 0.03, 0.14, Math.hypot(bx1 - bx0, by1 - by0), 0.22, 0, 0, Math.atan2(bx1 - bx0, by1 - by0) * -1), P.woodL, 1);
  }
  box(k, 'wood', P.wood, cx - ow, cx + ow, T - 0.2, T - 0.08, zp0, zp1, 0.5);
  markDoor(k, 'arch', cx - ow - pw, cx + ow + pw, base - 0.005, T - 0.08, zp0 - 0.005, zp1 + 0.015);   // the timbers: posts, braces, inner lintel
  const bw = ow + w(40), bT = T + Math.max(0.5, h(28));
  box(k, 'wood', P.wood, cx - bw, cx + bw, T - 0.08, bT, zp0 - 0.02, zp1 + 0.04, 0.5);
  for (const s of [-1, 1]) k.b.add('wood', GEO.cyl12, M(cx + s * (bw - 0.12), (T - 0.08 + bT) / 2, zp1 + 0.05, 0.2, 0.04, 0.2, Math.PI / 2), P.woodL, 1);
  const rw = ow + w(56) + 0.25, rD = 1.2, rY = bT, rH = Math.max(0.55, h(38));
  k.b.add('wood', GEO.box, M(cx, rY + rH / 2, zp1 - rD / 2 + 0.1, rw * 2, 0.12, Math.hypot(rD, rH), Math.atan2(rH, rD)), P.woodD, 1);
  box(k, 'wood', shade(P.woodD, -0.25), cx - rw - 0.03, cx + rw + 0.03, rY - 0.06, rY + 0.06, zp1 + 0.045, zp1 + 0.165, 0.5);
  for (let i = 0; i < 9; i++) { const x = cx - rw + 0.15 + i * (rw * 2 - 0.3) / 8; k.b.add('wood', GEO.box, M(x, rY + rH / 2 + 0.07, zp1 - rD / 2 + 0.1, 0.02, 0.012, Math.hypot(rD, rH), Math.atan2(rH, rD)), INK, 1); }
  for (let i = 0; i < 5; i++) k.b.add('leaf', ICO, M(cx - rw * 0.8 + i * rw * 0.4, rY + rH + 0.02, zp1 - rD + 0.25, 0.7, 0.22, 0.45), i % 2 ? P.platD : '#99c26a', 1);
  const pw2 = Math.min(1.8, w(180));
  signZ(k, signText(p, 'ШАХТА'), cx + 0.1, T - 0.1, zp1 + 0.06, pw2 * 0.8, { bg: P.plumD, fg: P.gold });
  // lanterns either side, a pick on the left, a crate with a grey cat and a miner's lamp on the right
  for (const s of [-1, 1]) {   // on iron arms out of the posts' outer faces (the lantern's bracket starts on the arm)
    const lx = cx + s * (ow + pw + 0.36), ly = T - 0.6, lz = (zp0 + zp1) / 2 - 0.02, xp = cx + s * (ow + pw);
    box(k, 'metal', P.metal, Math.min(xp, lx), Math.max(xp, lx), ly + 0.125 * 1.6, ly + 0.155 * 1.6, lz - 0.015, lz + 0.015, 0.4);
    lantern(k, 'metal', lx, ly, lz, 1.6);
  }
  { const x = cx - ow - pw - 0.3; k.b.add('wood', GEO.box, M(x + 0.12, base + 0.34, zE + 0.1, 0.06, 0.72, 0.06, 0, 0, -0.33), P.woodL, 1);
    k.b.add('metal', GEO.box, M(x + 0.22, base + 0.7, zE + 0.1, 0.42, 0.06, 0.075, 0, 0, 0.35), '#c9ccd6', 1); }
  { const x = cx + ow + pw + 0.35, y1 = base + Math.max(0.45, h(40));
    box(k, 'wood', P.wood, x - w(26), x + w(26) + 0.1, base, y1, zE - 0.2, zE + 0.3, 0.5);
    box(k, 'wood', P.woodD, x - w(26) - 0.005, x + w(26) + 0.105, (base + y1) / 2 - 0.02, (base + y1) / 2 + 0.02, zE - 0.205, zE + 0.305, 0.5);
    k.b.add('leaf', ICO, M(x + 0.05, y1 + 0.2, zE + 0.05, 0.36, 0.42, 0.3), '#9aa3ad', 1);
    k.b.add('leaf', ICO, M(x + 0.05, y1 + 0.5, zE + 0.08, 0.26, 0.24, 0.24), '#9aa3ad', 1);
    for (const s of [-1, 1]) { k.b.add('leaf', GEO.cone4, M(x + 0.05 + s * 0.08, y1 + 0.66, zE + 0.08, 0.12, 0.18, 0.06), '#9aa3ad', 1); k.b.add('leaf', GEO.cone4, M(x + 0.05 + s * 0.08, y1 + 0.645, zE + 0.115, 0.06, 0.1, 0.01), P.pink, 1); }
    k.b.add('leaf', GEO.cyl8, M(x + 0.3, y1 + 0.18, zE + 0.05, 0.07, 0.4, 0.07, 0, 0, -0.9), '#9aa3ad', 1);
    box(k, 'emit', '#ffd76a', x - 0.22, x - 0.1, y1, y1 + 0.16, zE + 0.0, zE + 0.12); }
  k.glows.push(cx, T - 0.9, zz + 0.2, 0.5, 1, 0.8, 0.4);
  // the posts stand in the walkable strip in front of the face (no site obstacle there): their own solids
  for (const s of [-1, 1]) (k.solids ||= []).push(Math.min(cx + s * ow, cx + s * (ow + pw)) - 0.03, Math.max(cx + s * ow, cx + s * (ow + pw)) + 0.03, zp0 - 0.03, zp1 + 0.03, Infinity);
}

/* ================================================================== registration */
// fp = src/data/fcart-fp.json at the time each model was made (06.11, site-1106-0007)
registerFcModel({ ref: 'hall', fp: '03fd9e716aaa12', note: 'cream half-timbered hall, purple hipped roof, 2 dormers, clock tower with purple spire + cat ears, columned porch', build: buildHall });
registerFcModel({ ref: 'magic', fp: '1324c4d672646a', note: 'round lilac wizard tower, wooden balcony ring, star-dotted night-blue cone, moon + cat, telescope, two annexes', build: buildMagic });
registerFcModel({ ref: 'jail', fp: '106537d538e0f2', note: 'giant blue pet carrier (cream tray, blue vented lid, handle, grated door) + the barred cage КЛЕТКА', build: buildJail });
registerFcModel({ ref: 'storage', fp: '1b3ceb17e5739d', note: 'plank barn, red gable roof, hayloft + hoist, open front with shelves / hay, РЫБА / МОЛОКО crates', build: buildStorage });
registerFcModel({ ref: 'gate', fp: '1e34776ffe04fe', note: 'stone gate with arched passage + portcullis, two round towers with purple cones, cat ears, flags; faces the town', build: buildGate });
registerFcModel({ ref: 'mine', fp: '1fc45c03742c4b', note: 'timber portal in a rock collar, lean-to roof with moss, ШАХТА plate, lanterns, dark adit with rails', build: buildMine });
