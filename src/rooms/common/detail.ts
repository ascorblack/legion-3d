/**
 * Shell detail of an interior (visual uplift round 2), baked into the room batch — no extra draw calls:
 *  - plank floors: one board per texture plank (0.25 m, aligned with the wood texture's own seams), each a shade of its
 *    own, hairline dark gaps between them, a lighter worn path from the door into the room;
 *  - ceilings: chamfered main beams, joists across them, knee braces where the beams meet the side walls, a cornice
 *    along the walls (the wall-ceiling joint stops reading as two flat planes meeting);
 *  - chamferBox(): a box with 45° chamfered edges (catches a highlight on every edge: counters, shelves, beams).
 * Quality: q0 keeps the plain shell (none of this), q1+ gets everything (a few thousand triangles per room).
 */
import * as THREE from 'three';
import { ConvexGeometry } from 'three/examples/jsm/geometries/ConvexGeometry.js';
import type { MatKey } from '../../world/batch';
import type { RoomKit } from './kit';

const _id = new THREE.Matrix4();
const _pts: THREE.Vector3[] = Array.from({ length: 24 }, () => new THREE.Vector3());
/**
 * Box [x0,x1]×[y0,y1]×[z0,z1] with every edge chamfered by c (clamped to a third of the smallest side). World-space
 * geometry (caller disposes); flat normals, no UVs (the batch box-projects them).
 */
export function chamferBox(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, c: number): THREE.BufferGeometry {
  const sx = x1 - x0, sy = y1 - y0, sz = z1 - z0;
  c = Math.max(0.002, Math.min(c, sx / 3, sy / 3, sz / 3));
  let k = 0;
  for (const X of [x0, x1]) for (const Y of [y0, y1]) for (const Z of [z0, z1]) {
    const ix = X === x0 ? c : -c, iy = Y === y0 ? c : -c, iz = Z === z0 ? c : -c;
    _pts[k++].set(X + ix, Y, Z + iz); _pts[k++].set(X, Y + iy, Z + iz); _pts[k++].set(X + ix, Y + iy, Z);
  }
  const g = new ConvexGeometry(_pts);
  return g;
}

/** Hex colour shaded by f (multiplies the value) and warmed by w (−1..1). */
function tone(col: string, f: number, w = 0): string {
  const c = new THREE.Color(col);
  c.setRGB(Math.min(1, c.r * f * (1 + w * 0.06)), Math.min(1, c.g * f), Math.min(1, c.b * f * (1 - w * 0.08)));
  return '#' + c.getHexString();
}
const h1 = (i: number, k: number) => { const s = Math.sin(i * 91.7 + k * 47.3) * 43758.5453; return s - Math.floor(s); };

/**
 * Plank floor over [x0,x1]×[z0,z1] (boards run along Z), top at y = 0, on a dark base (the gaps). `wornX` = centre of the
 * worn walkway (door axis), null = none.
 */
export function plankFloor(K: RoomKit, x0: number, x1: number, z0: number, z1: number, col: string, wornX: number | null): void {
  const B = 0.25, gap = 0.006;
  K.box('wood', tone(col, 0.55), x0 - 0.02, x1 + 0.02, -0.1, -0.005, z0 - 0.02, z1 + 0.02, 1);   // the dark under-floor seen through the gaps (wider: no shared end faces)
  const i0 = Math.floor(x0 / B), i1 = Math.ceil(x1 / B);
  for (let i = i0; i < i1; i++) {
    const a = Math.max(x0, i * B + gap), b = Math.min(x1, (i + 1) * B - gap);
    if (b - a < 0.02) continue;
    const r = h1(i, 1), r2 = h1(i, 2);
    let f = 0.95 + r * 0.09, w = (r2 - 0.5) * 1.0;
    if (r2 > 0.88) f *= 0.9;          // the odd dark, older board
    if (wornX != null) { const d = Math.abs((a + b) / 2 - wornX); if (d < 0.9) { f *= 1 + 0.1 * (1 - d / 0.9); w -= 0.5 * (1 - d / 0.9); } }
    const top = 0;
    K.box('wood', tone(col, f, w), a, b, -0.03, top, z0, z1, 1);
  }
}

/** Ceiling dressing: chamfered beams across X (replacing plain ones), joists along Z, knee braces, a cornice on 3 walls. */
export function ceilingDetail(K: RoomKit, x0: number, x1: number, z0: number, z1: number, h: number, beamZ: number[], timber: string, ceil: string, o: { joists?: boolean; braces?: boolean; cornice?: string | null } = {}): void {
  // beams: chamfered timber (the plain boxes stay out: shell() calls this instead)
  for (const z of beamZ) bevel(K, 'wood', timber, x0, x1, h - 0.24, h, z - 0.11, z + 0.11, 0.032);
  if (o.joists !== false) {
    const n = Math.max(3, Math.round((x1 - x0) / 1.3));
    for (let i = 1; i < n; i++) {
      const x = x0 + (x1 - x0) * i / n;
      K.box('wood', tone(timber, 0.92, 0.3), x - 0.045, x + 0.045, h - 0.11, h, z0 + 0.05, z1, 1);
    }
  }
  if (o.braces !== false) for (const z of beamZ) for (const [x, s] of [[x0, 1], [x1, -1]] as const) {
    // knee brace from the wall up into the beam (45°), and a little corbel block under the beam end
    K.rbox('wood', tone(timber, 0.85), x + s * 0.26, h - 0.48, z, 0.09, 0.62, 0.11, 0, 0, s * Math.PI / 4);
    K.box('wood', tone(timber, 0.8), s > 0 ? x : x - 0.16, s > 0 ? x + 0.16 : x, h - 0.4, h - 0.24, z - 0.12, z + 0.12, 1);
  }
  if (o.cornice) {
    const c = o.cornice, d = 0.1, t = 0.12;
    bevel(K, 'wood', c, x0, x1, h - t, h, z0, z0 + d, 0.012);
    bevel(K, 'wood', c, x0, x0 + d, h - t, h, z0 + d + 0.002, z1, 0.012);
    bevel(K, 'wood', c, x1 - d, x1, h - t, h, z0 + d + 0.002, z1, 0.012);
  }
  void ceil;
}

/** Chamfered box into the kit's batch (q0: a plain box). */
export function bevel(K: RoomKit, mat: MatKey, col: THREE.ColorRepresentation, x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, c = 0.02): void {
  if (K.quality <= 0) { K.box(mat, col, x0, x1, y0, y1, z0, z1); return; }
  const g = chamferBox(Math.min(x0, x1), Math.max(x0, x1), Math.min(y0, y1), Math.max(y0, y1), Math.min(z0, z1), Math.max(z0, z1), c);
  K.geo(mat === 'canvas' ? 'rock' : mat, g, _id, col, 1);
  g.dispose();
}
