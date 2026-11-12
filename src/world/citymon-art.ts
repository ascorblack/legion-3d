/**
 * «Монстры у стен» in 3D: the site's own monster drawings (citymon.js LGCityMonArt, 12.11 afternoon) as low-poly,
 * vertex-coloured, merged geometries — one per art id and state (alive / dead), instanced by src/features/citymon.ts.
 *
 * The site draws every monster in a 120 × 100 view box, feet on y = 96, the head to the LEFT, from seven families:
 * quad (boar, wolf, bear, goat, hyena, snowwolf, e_boar, e_mammoth), biped (troll, drowner, yeti, fishman, e_leshy, e_giant,
 * e_pharaoh), bird (crow, harpy, gull), blob (toad, iceslime), shroom, bug (spider, scorpion, crab) and worm (leech, sandworm,
 * e_hydra, e_serpent), each with the same parameters (colours c / c2, body / head sizes, ears, snout, tusks, mane, tail, crown…).
 * Here the same parameters are read as a side view: svg x → depth along the body (head to −Z, the avatar convention),
 * svg y → height, and a thickness across. The dark outline (OUT, 2.2 px) is the inverted hull (avatar outline material).
 *   - eyes: the site's `cm-ey` (a light disc in o.glow or #fff8e6 and a dark pupil); dead (`.cmw.dead` / `cm-pose-dead`):
 *     the eyes become `cm-x` crosses — a separate geometry per id (`cityMonGeo(id, true)`), the pose flips the body over;
 *   - scale: the `.cmw` button is 112 × 92 px for the 120 × 100 box (0.93 px a unit) and the site's cats ≈ 80 px are our 1.35 m
 *     heroes: U = 0.0158 m a unit; elites (`.cmw.el`, 180 × 150) are 1.6× (`cityMonScale`).
 * Feet at y = 0, centred on the body (svg x 60). Geometries are cached; `disposeCityMonArt()` frees them.
 */
import * as THREE from 'three';
import { GB } from '../expedition/art';

type V3 = [number, number, number];
/** Metres per svg unit (normal pack member). */
export const CM_U = 0.0158;
/** `.cmw.el` 180 px vs `.cmw` 112 px. */
export const CM_ELITE_K = 180 / 112;
export const cityMonScale = (id: string) => (/^e_/.test(id) ? CM_ELITE_K : 1);
const OUT = '#2a1f1a', PUPIL = '#1b1410', EYE = '#fff8e6';

/** citymon.js ART: the family and its parameters, verbatim. */
const ART: Record<string, [string, Record<string, any>]> = {
  boar: ['quad', { c: '#8a5a3a', c2: '#5e3a24', tusk: 1, nose: 'pig', mane: '#3e2618', ears: 'point', legH: 14, tail: 'curl', snout: 10, brow: 1 }],
  wolf: ['quad', { c: '#8e8e9a', c2: '#5d5d68', ears: 'point', tail: 'bush', snout: 15, teeth: 1, bh: 17, legW: 6, glow: '#ffe8a0' }],
  crow: ['bird', { c: '#2f2f3d', c2: '#1d1d28', beak: '#5a5a62', glow: '#ff7a5a' }],
  bear: ['quad', { c: '#7a4e30', c2: '#54331d', ears: 'round', bw: 38, bh: 25, by: 54, hr: 15, snout: 9, legW: 9, sw: 90, tail: 0, teeth: 1 }],
  spider: ['bug', { kind: 'spider', c: '#3d3546', c2: '#2a2430', glow: '#ff4d4d' }],
  shroom: ['shroom', { c: '#d63b32' }],
  goat: ['quad', { c: '#d8d0c0', c2: '#a89c86', horns: 'goat', beard: 1, ears: 'point', bh: 17, legW: 6, legH: 22, snout: 12, tail: 1 }],
  troll: ['biped', { c: '#7d8577', c2: '#5c6457', k: 1.1, rock: 1, club: '#7a5a3a', fangs: 1, belly: '#9aa08f' }],
  harpy: ['bird', { c: '#8a6aa8', c2: '#5d4478', hair: '#3a2650', beak: '#d9b25a', glow: '#ffe066' }],
  toad: ['blob', { c: '#6f8f3a', c2: '#4f6a28', frog: 1, warts: '#8aaa4a' }],
  leech: ['worm', { c: '#4e3a4a', c2: '#7a5a6a', w: 14, sucker: 1, rings: 1 }],
  drowner: ['biped', { c: '#5f8a82', c2: '#456860', hair: '#2e4a3a', claw: 1, fangs: 1, glow: '#d8ff9a', mouth: '#203a30' }],
  scorpion: ['bug', { kind: 'scorpion', c: '#c08a3a', c2: '#8a5e22' }],
  sandworm: ['worm', { c: '#d9b06a', c2: '#a8803e', w: 18, teeth: 1, rings: 1, ground: '#e8cf8f' }],
  hyena: ['quad', { c: '#c8a36a', c2: '#8f7040', spots: '#6a4e2a', mane: '#5a4026', ears: 'round', snout: 13, teeth: 1, tail: 1, bh: 17, legW: 6 }],
  snowwolf: ['quad', { c: '#e8eef6', c2: '#aab8c8', ears: 'point', tail: 'bush', snout: 15, teeth: 1, bh: 17, legW: 6, glow: '#9fe0ff' }],
  yeti: ['biped', { c: '#eef2f6', c2: '#c4ccd6', k: 1.1, hair: '#dfe6ee', fangs: 1, claw: 1, belly: '#c4d4e4', mouth: '#5a2a3a' }],
  iceslime: ['blob', { c: '#8fd0f0', c2: '#5ea8d0', alpha: 0.85, shine: 1, ice: 1 }],
  crab: ['bug', { kind: 'crab', c: '#d0563a', c2: '#a43a24' }],
  gull: ['bird', { c: '#f2f2f2', c2: '#a8b0b8', beak: '#f2b33a', crest: '#c0c8d0' }],
  fishman: ['biped', { c: '#4a8aa8', c2: '#356a84', fin: '#2e5a78', belly: '#9ad0d8', glow: '#ffe066', fangs: 1 }],
  e_boar: ['quad', { c: '#5a3a2a', c2: '#3a2418', tusk: 1, bigTusk: 1, nose: 'pig', mane: '#2a1810', ears: 'point', bw: 40, bh: 24, by: 54, hr: 15, legH: 14, legW: 9, sw: 96, tail: 'curl', crown: 1, glow: '#ff8a4a', brow: 1 }],
  e_leshy: ['biped', { c: '#6a5236', c2: '#4a3824', k: 1.25, leaves: '#5f9a3a', hair: '#4f8a2e', horns: 1, glow: '#b8ff6a', crown: 1, claw: 1 }],
  e_giant: ['biped', { c: '#8a8c90', c2: '#66686c', k: 1.3, rock: 1, club: '#5c5e62', glow: '#7ae0ff', crown: 1 }],
  e_hydra: ['worm', { c: '#3f6a3a', c2: '#2c4c28', w: 18, heads: 1, teeth: 1, glow: '#ffe066', fin: '#2f5a2a', crown: 1 }],
  e_pharaoh: ['biped', { c: '#d8c8a0', c2: '#b0a078', k: 1.2, wrap: 1, glow: '#4dffd2', crown: 1, mouth: '#3a2a1a' }],
  e_mammoth: ['quad', { c: '#7a5a46', c2: '#523a2a', fur: 1, trunk: 1, bigTusk: 1, ears: 'round', bw: 42, bh: 26, by: 52, hr: 17, legW: 11, legH: 16, sw: 100, snout: 4, crown: 1, glow: '#9fe0ff' }],
  e_serpent: ['worm', { c: '#2e6a8a', c2: '#1e4a64', w: 20, fin: '#5ab0c8', teeth: 1, glow: '#ffe066', crown: 1 }],
};
/** LGCityMonArt.IDS (28, 12.11). */
export const CITYMON_IDS = Object.freeze(Object.keys(ART));
/** The family of an art id (fig(): an unknown id draws the boar). */
export const cityMonFamily = (id: string): string => (ART[id] || ART.boar)[0];

/* ------------------------------------------------------------------ builder: svg side view → 3D */
const _q = new THREE.Quaternion(), _up = new THREE.Vector3(0, 1, 0), _d = new THREE.Vector3();
class Fig {
  readonly g = new GB();
  constructor(readonly U: number) {}
  /** svg (x, y) + lateral offset (svg units, + = the right side of the beast) → metres. */
  P(x: number, y: number, lat = 0): V3 { const U = this.U; return [lat * U, (96 - y) * U, (x - 60) * U]; }
  /** Ellipsoid: centre (svg), radii along the body (rx), up (ry) and across (rz), in svg units. */
  ell(x: number, y: number, rx: number, ry: number, rz: number, col: string, lat = 0, seg: 's' | 'm' | 'l' = 'm', tilt = 0): void {
    const [w, h] = seg === 'l' ? [9, 6] : seg === 'm' ? [7, 5] : [5, 4];
    const U = this.U, p = this.P(x, y, lat), m = new THREE.Matrix4().compose(new THREE.Vector3(...p), new THREE.Quaternion().setFromEuler(new THREE.Euler(tilt, 0, 0)), new THREE.Vector3(rz * U, ry * U, rx * U));
    this.g.add(new THREE.SphereGeometry(1, w, h), col, m);
  }
  /** Half ellipsoid (dome) standing on svg y `base`. */
  dome(x: number, base: number, rx: number, ry: number, rz: number, col: string, lat = 0): void {
    const U = this.U, p = this.P(x, base, lat), m = new THREE.Matrix4().compose(new THREE.Vector3(...p), new THREE.Quaternion(), new THREE.Vector3(rz * U, ry * U, rx * U));
    this.g.add(new THREE.SphereGeometry(1, 9, 4, 0, Math.PI * 2, 0, Math.PI / 2), col, m);
  }
  /** A limb / stroke from a to b (3D metres), radii r0 → r1 (svg units). */
  seg(a: V3, b: V3, r0: number, r1: number, col: string, sides = 6): void {
    const U = this.U; _d.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    const L = _d.length() || 1e-4; _q.setFromUnitVectors(_up, _d.clone().normalize());
    const m = new THREE.Matrix4().compose(new THREE.Vector3((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2), _q, new THREE.Vector3(1, 1, 1));
    this.g.add(new THREE.CylinderGeometry(r1 * U, r0 * U, L, sides, 1), col, m);
  }
  /** Cone from base centre a to tip b, base radius r (svg). */
  cone(a: V3, b: V3, r: number, col: string, sides = 5): void {
    const U = this.U; _d.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    const L = _d.length() || 1e-4; _q.setFromUnitVectors(_up, _d.clone().normalize());
    const m = new THREE.Matrix4().compose(new THREE.Vector3((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2), _q, new THREE.Vector3(1, 1, 1));
    this.g.add(new THREE.ConeGeometry(r * U, L, sides, 1), col, m);
  }
  /** A tube along svg points (lateral 0), radius r(t) (svg). */
  tube(pts: [number, number][], r: number, col: string, r1 = r): void {
    for (let i = 0; i + 1 < pts.length; i++) {
      const t0 = i / (pts.length - 1), t1 = (i + 1) / (pts.length - 1);
      this.seg(this.P(pts[i][0], pts[i][1]), this.P(pts[i + 1][0], pts[i + 1][1]), r + (r1 - r) * t0, r + (r1 - r) * t1, col, 7);
      if (i) this.ell(pts[i][0], pts[i][1], r + (r1 - r) * t0, r + (r1 - r) * t0, r + (r1 - r) * t0, col, 0, 's');
    }
  }
  /** citymon.js eyes(): a light disc + dark pupil on both sides of the head (dead: the `cm-x` crosses). `face` = svg x of the
   *  head's front, eyes sit on its surface at ±lat. */
  eyes(pts: [number, number][], r: number, glow: string | undefined, lat: number, dead: boolean): void {
    for (const [x, y] of pts) for (const s of lat ? [-1, 1] : [0]) {
      const p = this.P(x, y, s * lat);
      if (dead) {
        for (const a of [Math.PI / 4, -Math.PI / 4]) {
          const m = new THREE.Matrix4().compose(new THREE.Vector3(p[0] + s * 0.4 * this.U, p[1], p[2]), new THREE.Quaternion().setFromEuler(new THREE.Euler(a, 0, 0)), new THREE.Vector3(1.2 * this.U, 7.5 * this.U, 1.6 * this.U));
          this.g.add(new THREE.BoxGeometry(1, 1, 1), PUPIL, m);
        }
      } else {
        this.g.add(new THREE.SphereGeometry(1, 6, 4), glow || EYE, new THREE.Matrix4().compose(new THREE.Vector3(...p), new THREE.Quaternion(), new THREE.Vector3((r + 1.4) * this.U * 0.6, (r + 1.4) * this.U, (r + 1.4) * this.U)));
        this.g.add(new THREE.SphereGeometry(1, 6, 4), PUPIL, new THREE.Matrix4().compose(new THREE.Vector3(p[0] + s * 1.2 * this.U, p[1], p[2] - 0.8 * this.U), new THREE.Quaternion(), new THREE.Vector3(r * this.U * 0.6, r * this.U, r * this.U)));
      }
    }
  }
  /** citymon.js crown(): gold band with five points, a red gem in front, blue side gems. */
  crown(x: number, y: number, s: number): void {
    const U = this.U, p = this.P(x, y);
    // the site's crown spans y + 4 (band) … y − 8 (points): the band sits on the head
    this.g.add(new THREE.CylinderGeometry(9 * s * U, 10 * s * U, 6 * s * U, 8, 1), '#ffd34d', new THREE.Matrix4().makeTranslation(p[0], p[1] - 1 * s * U, p[2]));
    for (let i = 0; i < 5; i++) {
      const a = i / 5 * Math.PI * 2;
      this.cone([p[0] + Math.sin(a) * 8.6 * s * U, p[1] + 2 * s * U, p[2] + Math.cos(a) * 8.6 * s * U], [p[0] + Math.sin(a) * 9.4 * s * U, p[1] + 9 * s * U, p[2] + Math.cos(a) * 9.4 * s * U], 3 * s, '#ffd34d', 4);
    }
    this.ell(x - 9.8 * s, y + 1 * s, 1.4 * s, 2 * s, 2 * s, '#e5484d', 0, 's');
    for (const sd of [-1, 1]) this.ell(x, y + 1 * s, 1.4 * s, 1.4 * s, 1.4 * s, '#4d9de5', sd * 9.8 * s, 's');
  }
}

/* ------------------------------------------------------------------ the seven families */
function quad(F: Fig, o: Record<string, any>, dead: boolean): void {
  const c = o.c, c2 = o.c2 || c, by = o.by || 58, bw = o.bw || 34, bh = o.bh || 20, hx = o.hx || 28, hy = o.hy || by - 8, hr = o.hr || 13;
  const lw = (o.legW || 7) * 0.62, top = by + bh * 0.4, half = bh * 0.78;
  // legs: the site's four in a row = the front pair and the hind pair, near and far side
  for (const lx of [60 - bw * 0.52, 60 + bw * 0.42]) for (const s of [-1, 1]) F.seg(F.P(lx, top, s * half * 0.5), F.P(lx, 95, s * half * 0.5), lw * 1.05, lw * 0.95, c2, 6);
  // tail (bush / curl / a stroke)
  if (o.tail === 'bush') F.ell(60 + bw + 6, by - 6, 11, 6, 6, c, 0, 's', -0.5);
  else if (o.tail === 'curl') { F.seg(F.P(60 + bw - 2, by - 4), F.P(60 + bw + 6, by - 9), 1.6, 1.4, OUT, 5); F.seg(F.P(60 + bw + 6, by - 9), F.P(60 + bw + 5, by - 2), 1.4, 1.2, OUT, 5); }
  else if (o.tail) F.seg(F.P(60 + bw - 3, by - 4), F.P(60 + bw + 9, by - 10), 1.6, 1, OUT, 5);
  // body + the lighter belly (c2 at .55 over c)
  F.ell(60, by, bw, bh, half, c, 0, 'l');
  F.ell(60, by + bh * 0.45, bw * 0.7, bh * 0.4, half * 0.85, mix(c, c2, 0.55), 0, 'm');
  if (o.mane) for (let i = 0; i < 6; i++) { const x = hx + 10 + i * (60 + bw * 0.3 - hx - 10) / 5, y = by - bh + 2 + (i ? 0 : 4); F.cone(F.P(x, y + 4), F.P(x + 3, y - 6), 3.2, o.mane, 4); }
  if (o.spots) for (const [x, y] of [[50, by - 6], [66, by - 10], [74, by + 2], [58, by + 4]]) for (const s of [-1, 1]) F.ell(x, y, 3.2, 3.2, 1, o.spots, s * half * 0.93, 's');
  if (o.fur) for (let i = 0; i < 7; i++) { const x = 60 - bw + 8 + i * bw * 0.27; F.cone(F.P(x, by + bh - 6), F.P(x, by + bh + 1), 2.6, c2, 4); }
  // head: ears, the round head, the snout (upper jaw c, lower c2), nose, tusks, trunk, horns, beard, eyes, brow, crown
  const hcx = hx + 4, side = hr * 0.72;
  if (o.ears === 'point') for (const s of [-1, 1]) F.cone(F.P(hx + 6, hy - hr + 5, s * hr * 0.45), F.P(hx + 7, hy - hr - 8, s * hr * 0.5), 3.8, c, 4);
  if (o.ears === 'round') for (const s of [-1, 1]) F.ell(hx + 7, hy - hr + 2, 5, 5, 2.5, c, s * hr * 0.6, 's');
  F.ell(hcx, hy, hr, hr, side, c, 0, 'm');
  const sx = hx - hr * 0.6, sl = o.snout || 12;
  F.seg(F.P(sx + 6, hy), F.P(sx - sl, hy + 1), 5.2, 3.6, c, 6);
  F.seg(F.P(sx + 4, hy + 5), F.P(sx - sl + 2, hy + 6), 3.4, 2.4, c2, 6);
  if (o.teeth) for (const s of [-1, 1]) F.cone(F.P(sx - sl + 6, hy + 4, s * 2), F.P(sx - sl + 6, hy + 8, s * 2), 1.2, '#ffffff', 3);
  if (o.nose === 'pig') F.ell(sx - sl - 0.5, hy + 1.5, 1.6, 4, 3.6, '#d98a8a', 0, 's');
  else F.ell(sx - sl - 0.5, hy, 2.4, 2.6, 2.6, OUT, 0, 's');
  if (o.tusk) for (const s of [-1, 1]) F.cone(F.P(sx - sl * 0.4, hy + 4, s * 4), F.P(sx - sl * 0.4 - 5, hy - 6, s * 4.5), 2, '#fff6dc', 4);
  if (o.trunk) F.tube([[sx - 2, hy], [sx - 10, hy + 8], [sx - 12, hy + 20], [sx - 9, hy + 30]], 4.5, c, 3);
  if (o.bigTusk) for (const s of [-1, 1]) { F.seg(F.P(sx + 2, hy + 8, s * 5), F.P(sx - 14, hy + 12, s * 6), 2.6, 2.2, '#fff6dc', 5); F.cone(F.P(sx - 14, hy + 12, s * 6), F.P(sx - 24, hy - 2, s * 6.5), 2.2, '#fff6dc', 5); }
  if (o.horns === 'goat') for (const s of [-1, 1]) { F.seg(F.P(hx + 8, hy - hr + 3, s * 4), F.P(hx + 18, hy - hr - 10, s * 5), 2.6, 2, '#d9cbb0', 5); F.cone(F.P(hx + 18, hy - hr - 10, s * 5), F.P(hx + 26, hy - hr - 2, s * 5.5), 2, '#d9cbb0', 4); }
  if (o.beard) F.cone(F.P(sx + 2, hy + 7), F.P(sx + 1, hy + 18), 3, c2, 4);
  F.eyes([[hx + 1, hy - 4]], 2.6, o.glow, side * 0.78, dead);
  if (o.brow) for (const s of [-1, 1]) F.seg(F.P(hx - 4, hy - 9, s * side * 0.8), F.P(hx + 5, hy - 6, s * side * 0.8), 1.1, 1.1, OUT, 4);
  if (o.crown) F.crown(hx + 6, hy - hr - 4, 1.1);
}
function biped(F: Fig, o: Record<string, any>, dead: boolean): void {
  const c = o.c, c2 = o.c2 || c, k = o.k || 1, top = 96 - 70 * k, hy = top + 10 * k, th = 13 * k;
  for (const [s, x] of [[-1, 60 - 7.5 * k], [1, 60 + 7.5 * k]] as const) F.seg(F.P(x, 96 - 26 * k, s * 6 * k), F.P(x, 95, s * 6 * k), 4.5 * k, 4 * k, c2, 6);
  // body (the rounded rect 36k × 38k) + belly
  F.ell(60, top + 35 * k, 18 * k, 20 * k, th, c, 0, 'l');
  if (o.belly) F.ell(56, top + 40 * k, 9 * k, 11 * k, th * 0.8, o.belly, 0, 'm');
  if (o.wrap) for (let i = 0; i < 5; i++) { const y = top + (22 + i * 7) * k; F.g.add(new THREE.TorusGeometry(1, 0.08, 3, 10), '#bfae8a', new THREE.Matrix4().compose(new THREE.Vector3(...F.P(60, y)), new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2 + (i % 2 ? -0.12 : 0.12), 0, 0)), new THREE.Vector3(th * F.U * 1.0, 18 * k * F.U * 0.98, 1))); }
  if (o.rock) for (const [x, y, s] of [[52, top + 28 * k, -1], [66, top + 38 * k, 1]] as const) F.ell(x, y, 4 * k, 3 * k, 2, mix(c, OUT, 0.35), s * th * 0.92, 's');
  if (o.leaves) for (const s of [-1, 1]) F.ell(60 - 14 * k, top + 12 * k, 7, 3, 4, o.leaves, s * th * 0.8, 's', -0.6);
  if (o.fin) F.cone(F.P(60 + 14 * k, top + 20 * k), F.P(60 + 26 * k, top + 10 * k), 6, o.fin, 4);
  // arms: the back arm hangs, the front arm reaches forward (club / claws in its hand)
  for (const s of [-1, 1]) {
    const back = s > 0;
    const a = F.P(back ? 60 + 12 * k : 60 - 10 * k, top + 24 * k, s * th * 0.95), b = F.P(back ? 60 + 18 * k : 60 - 26 * k, top + 48 * k, s * th * 1.05);
    F.seg(a, b, 4 * k, 3.6 * k, c, 6);
    if (!back && o.club) F.seg(F.P(60 - 28 * k, top + 48 * k, s * th * 1.05), F.P(60 - 32 * k, top + 22 * k, s * th * 1.05), 3 * k, 5.5 * k, o.club, 6);
    if (!back && o.claw) for (const d of [-2, 0, 2]) F.cone(F.P(60 - 27 * k, top + 48 * k, s * th * 1.05 + d), F.P(60 - 31 * k, top + 53 * k, s * th * 1.05 + d), 1.1, OUT, 3);
  }
  // head
  const hxc = 60 - 4 * k, hyc = hy + 6 * k, hr = 13 * k;
  F.ell(hxc, hyc, hr, hr, hr * 0.9, c, 0, 'm');
  if (o.hair) F.dome(hxc + 3 * k, hyc - hr * 0.35, hr * 0.95, hr * 0.85, hr * 0.92, o.hair);
  if (o.horns) for (const s of [-1, 1]) F.cone(F.P(60 - 6 * k, hy - 2 * k, s * hr * 0.5), F.P(60 - 8 * k, hy - 14 * k, s * hr * 0.6), 2.6, '#e8dcc0', 4);
  F.ell(60 - 13 * k, hy + 12 * k, 2.2, 2.4 * k, 5 * k, o.mouth || '#5a1e1e', 0, 's');
  if (o.fangs) for (const s of [-1, 1]) F.cone(F.P(60 - 14 * k, hy + 10.5 * k, s * 2.5 * k), F.P(60 - 14.5 * k, hy + 14 * k, s * 2.5 * k), 1, '#ffffff', 3);
  F.eyes([[60 - 14 * k, hy + 3.5 * k]], 2.2 * Math.min(1.2, k), o.glow, hr * 0.42, dead);
  if (o.crown) F.crown(60 - 4 * k, hy - 12 * k, 1.1 * k);
}
function bird(F: Fig, o: Record<string, any>, dead: boolean): void {
  const c = o.c, c2 = o.c2 || c;
  for (const s of [-1, 1]) { F.seg(F.P(61, 74, s * 4), F.P(61, 95, s * 4), 1.3, 1.2, '#c98a2a', 4); F.seg(F.P(61, 95, s * 4), F.P(55, 95, s * 4), 1.2, 1.2, '#c98a2a', 4); }
  // tail fan, body, wings on both sides
  F.cone(F.P(84, 56), F.P(104, 50), 7, c2, 4);
  F.ell(62, 60, 24, 17, 15, c, 0, 'l');
  for (const s of [-1, 1]) F.ell(80, 48, 15, 6, 3, c2, s * 15, 's', 0.6);
  // head, beak (two halves), crest / hair, eyes
  F.ell(42, 42, 12, 12, 11, c, 0, 'm');
  if (o.hair) F.dome(48, 36, 11, 10, 11, o.hair);
  if (o.crest) F.cone(F.P(46, 31), F.P(46, 21), 3, o.crest, 4);
  F.cone(F.P(33, 41), F.P(19, 44), 3.4, o.beak || '#e3a33a', 5);
  F.cone(F.P(33, 46), F.P(22, 48), 2.4, o.beak || '#e3a33a', 5);
  F.eyes([[37, 39]], 2.4, o.glow, 6.5, dead);
}
function blob(F: Fig, o: Record<string, any>, dead: boolean): void {
  const c = o.c, c2 = o.c2 || c;
  if (o.frog) for (const s of [-1, 1]) { F.ell(38, 90, 8, 4, 5, c2, s * 18, 's'); F.ell(84, 88, 10, 6, 6, c2, s * 18, 's'); }
  F.dome(60, 94, 38, 44, 32, c);
  if (o.warts) for (const [x, y] of [[70, 62], [80, 74], [58, 58]]) for (const s of [-1, 1]) F.ell(x, y, 3, 3, 3, o.warts, s * 22, 's');
  if (o.ice) for (const [x, h] of [[52, 12], [68, 13], [82, 9]]) F.cone(F.P(x, 54), F.P(x + 2, 54 - h), 4, '#e6f6ff', 4);
  if (o.shine) F.ell(40, 62, 3, 7, 2, '#ffffff', -24, 's', 0.6);
  F.ell(30, 77, 2.6, 4, 10, '#6b2030', 0, 's');
  if (o.frog) for (const [x, y] of [[34, 52], [50, 50]]) F.ell(x, y + 1, 7, 7, 7, c, 0, 's');
  F.eyes(o.frog ? [[30, 50], [46, 48]] : [[28, 64], [44, 62]], 3, o.glow, o.frog ? 0 : 0, dead);
}
function shroom(F: Fig, o: Record<string, any>, dead: boolean): void {
  for (const s of [-1, 1]) F.seg(F.P(57, 82, s * 6), F.P(57, 95, s * 6), 3.5, 3.2, '#f2e6cc', 6);
  F.ell(60, 68, 14, 16, 13, '#f2e6cc', 0, 'm');
  F.dome(60, 56, 34, 36, 32, o.c);
  for (const [x, y, l] of [[40, 40, -16], [58, 28, 0], [74, 40, 16], [50, 50, -24], [84, 50, 22]]) F.ell(x, y - 2, 4, 4, 4, '#fff6e6', l, 's');
  F.ell(47, 73, 1.6, 2, 4, '#5a1e1e', 0, 's');
  F.eyes([[47, 64]], 2.2, undefined, 5, dead);
}
function bug(F: Fig, o: Record<string, any>, dead: boolean): void {
  const c = o.c, c2 = o.c2 || c, kind = o.kind;
  // legs: three a side, bent
  for (const s of [-1, 1]) for (const x of kind === 'crab' ? [44, 60, 76] : [40, 56, 72]) {
    const a = F.P(x, 72, s * 8), b = F.P(x - 2, 64, s * 20), e = F.P(x - 4, 95, s * 26);
    F.seg(a, b, 1.8, 1.6, c2, 4); F.seg(b, e, 1.6, 1.2, c2, 4);
  }
  if (kind === 'scorpion') {
    F.tube([[78, 70], [96, 62], [104, 44], [98, 28], [90, 24]], 6, c, 4);
    F.cone(F.P(90, 24), F.P(82, 18), 3, '#e8e0d0', 4);
  }
  if (kind === 'spider') { F.ell(80, 64, 20, 17, 17, c, 0, 'l'); F.ell(80, 49, 6, 3, 5, '#c2342e', 0, 's'); }
  if (kind === 'crab') F.dome(60, 80, 30, 34, 22, c);
  else F.ell(56, 72, 20, 13, 13, c, 0, 'm');
  if (kind !== 'spider') for (const s of [-1, 1]) { F.ell(24, 62, 10, 6, 4, c2, s * 12, 's'); F.cone(F.P(16, 62, s * 12), F.P(9, 60, s * 13), 3, c2, 4); }
  else { for (const s of [-1, 1]) F.seg(F.P(36, 72, s * 3), F.P(32, 80, s * 3), 1.2, 1, OUT, 3); F.ell(42, 66, 11, 11, 10, c, 0, 'm'); }
  if (kind === 'crab') for (const s of [-1, 1]) { F.seg(F.P(52, 48, s * 6), F.P(50, 36, s * 7), 1.4, 1.4, OUT, 4); }
  const ey: [number, number][] = kind === 'spider' ? [[35, 62], [39, 60]] : kind === 'crab' ? [[50, 34]] : [[40, 66]];
  F.eyes(ey, kind === 'spider' ? 1.8 : 2.4, o.glow, kind === 'spider' ? 4 : kind === 'crab' ? 7 : 5, dead);
}
function worm(F: Fig, o: Record<string, any>, dead: boolean): void {
  const c = o.c, c2 = o.c2 || c, w = o.w;
  if (o.ground) F.dome(84, 96, 22, 7, 20, o.ground);
  const path: [number, number][] = [[100, 92], [96, 72], [80, 66], [62, 56], [58, 42], [44, 32]];
  F.tube(path, w / 2, c, w * 0.42);
  // the lighter stripe on the belly side
  F.tube([[98, 86], [86, 72], [66, 64], [60, 50]], w * 0.2, c2, w * 0.16);
  if (o.rings) for (const [x, y] of [[90, 69], [74, 63], [61, 50]]) F.g.add(new THREE.TorusGeometry(1, 0.1, 3, 10), OUT, new THREE.Matrix4().compose(new THREE.Vector3(...F.P(x, y)), new THREE.Quaternion().setFromEuler(new THREE.Euler(0.9, 0, 0)), new THREE.Vector3(w * 0.52 * F.U, w * 0.52 * F.U, w * 0.52 * F.U)));
  if (o.heads) for (const [x, y, s] of [[74, 34, -1], [86, 44, 1]] as const) {
    F.seg(F.P(x + 10, 70, s * 7), F.P(x, y, s * 7), w * 0.35, w * 0.3, c, 6);
    F.ell(x, y, w * 0.55, w * 0.5, w * 0.5, c, s * 7, 's');
    for (const e of [-1, 1]) F.ell(x - w * 0.4, y - 2, 1.6, 1.6, 1.6, o.glow || '#ffe066', s * 7 + e * w * 0.3, 's');
  }
  if (o.fin) for (let i = 0; i < 3; i++) F.cone(F.P(62 + i * 7, 48 - i * 2), F.P(64 + i * 7, 34 - i * 2), 4, o.fin, 4);
  const hr = w * 0.75;
  F.ell(34, 30, hr, hr, hr * 0.9, c, 0, 'm');
  if (o.sucker) { F.ell(22, 32, 2.4, 6, 6, '#7a2a3a', 0, 's'); F.ell(20.5, 32, 1, 2.4, 2.4, '#2a0a10', 0, 's'); }
  else {
    F.seg(F.P(30, 35), F.P(17, 38), 3, 2, '#6b2030', 5);
    if (o.teeth) for (const s of [-1, 1]) F.cone(F.P(20, 35, s * 2), F.P(20, 39, s * 2), 1, '#ffffff', 3);
  }
  F.eyes([[30, 25]], 2.4, o.glow, hr * 0.55, dead);
  if (o.crown) F.crown(36, 15, 1.1);
}
const FAM: Record<string, (F: Fig, o: Record<string, any>, dead: boolean) => void> = { quad, biped, bird, blob, shroom, bug, worm };

function mix(a: string, b: string, t: number): string { return '#' + new THREE.Color(a).lerp(new THREE.Color(b), t).getHexString(); }

/* ------------------------------------------------------------------ cache */
const cache = new Map<string, THREE.BufferGeometry>();
/**
 * Geometry of art `id` (unknown → boar, like fig()) in its state, feet at y 0, the head to −Z, in metres for a normal pack
 * member (an elite's instance scales by `cityMonScale(id)`).
 */
export function cityMonGeo(id: string, dead = false): THREE.BufferGeometry {
  const key = (ART[id] ? id : 'boar') + (dead ? ':dead' : '');
  let g = cache.get(key);
  if (!g) {
    const [fam, o] = ART[id] || ART.boar, F = new Fig(CM_U);
    FAM[fam](F, o, dead);
    g = F.g.build();
    g.computeBoundingBox();
    g.name = 'citymon:' + key;
    cache.set(key, g);
  }
  return g;
}
/** Height of the art (m, normal scale): label anchors, the dead pose's resting height, hit boxes. */
export function cityMonTop(id: string): number { const g = cityMonGeo(id); return g.boundingBox!.max.y; }
export function disposeCityMonArt(): void { for (const g of cache.values()) g.dispose(); cache.clear(); }
