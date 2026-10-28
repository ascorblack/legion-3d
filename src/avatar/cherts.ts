/**
 * «Чертики» (site style 'cherts', channel art since 28.10): mischievous imps with bat wings, horns, a long tail with a tip
 * and hooves. Colour of the character = colour of the skin. Everything here is derived from the site's
 * styles/cherts/characters.js (proportions in its 120×170 doodle units, colours, the per-nick traits from the seed) and
 * rebuilt as 3D parts; nothing of the site's SVG is copied.
 *
 * Per nick (from the seed, never from r()): horn kind (рожки, козлиные, бараньи, бычьи, крохотные, отломанный) and colour,
 * tail shape (S-волна, завиток, петля, крючок, волна, до земли) and tip (стрелка, сердечко, огонёк, кисточка), belly,
 * freckles, goat beard, fangs, brows. Body form = kind of imp with its own wings:
 * bean бесёнок (bat wings) · box громила (huge tattered) · ball пухлик (tiny) · tall франт (grey feathers) ·
 * ghost огненный дух (flame wings, floats) · cone нетопырь (two pairs + big ears) · egg вылупыш (baby wings, sits in a shell).
 * Build time only; no per-frame work.
 */
import * as THREE from 'three';
import { K, Parts, T, sphere, cone, cyl, tube, slab, torus, col, radiusAt, sectionXZ, type BodyDims, type Skin } from './geom';

import { CH_INK, CH_FIRE, CH_GOLD, chDark, chLight, type ChTraits, type HornKind, type TailShape } from './cherts-traits';
export * from './cherts-traits';
const HOOF = '#2a1a22';

/* ------------------------------------------------------------------ body dims per form */
const rb = (t: number, h: number) => { const u = Math.min(1, t / h); return Math.sqrt(Math.max(0, 1 - (1 - u) * (1 - u))); };
const domeF = (t: number, c: number, e = 2) => { const s = (t - c) / (1 - c); return Math.pow(Math.max(0, 1 - Math.pow(Math.max(0, s), e)), 1 / e); };

/**
 * A body outline from the site's drawing: one cubic Bézier side from the ground to the top, given as half-widths
 * (site units, outward from the centre line) and heights above the ground. Sampled once into a table; returns the
 * profile (half-width / the largest half-width, by height fraction t) and that largest half-width.
 */
function bezierSide(hw: [number, number, number, number], hy: [number, number, number, number]): { prof: (t: number) => number; max: number } {
  const n = 48, U: number[] = [], Wd: number[] = [];
  const b = (p: number[], s: number) => { const q = 1 - s; return q * q * q * p[0] + 3 * q * q * s * p[1] + 3 * q * s * s * p[2] + s * s * s * p[3]; };
  for (let i = 0; i <= n; i++) { U.push(b(hy, i / n) / hy[3]); Wd.push(Math.max(0, b(hw, i / n))); }
  const max = Math.max(...Wd);
  const prof = (t: number) => {
    if (t <= U[0]) return Wd[0] / max;
    for (let i = 1; i <= n; i++) if (t <= U[i]) { const k = (t - U[i - 1]) / Math.max(1e-6, U[i] - U[i - 1]); return (Wd[i - 1] + (Wd[i] - Wd[i - 1]) * k) / max; }
    return Wd[n] / max;
  };
  return { prof, max };
}

const CH_H = 0.98, CH_W = 1.03;
const FORM_K: Record<string, [number, number]> = { ball: [1.06, 0.93], cone: [1.08, 1] };
/** Extra per-form data the cherts parts need (site units unless noted). */
export interface ChDims extends BodyDims { kind: 'imp' | 'brute' | 'chubby' | 'dandy' | 'wisp' | 'bat' | 'hatch'; hwU: number; wU: number }

/**
 * Body of the imp for a form. Heights/widths from the site's body functions (widths: the same first r() draw, w01),
 * converted with K and the same chibi factors as the other styles.
 */
export function chDims(shape: string, w01: number): ChDims {
  const s = ['bean', 'box', 'ball', 'tall', 'ghost', 'cone', 'egg'].includes(shape) ? shape : 'bean';
  const fl = (n: number) => Math.floor(w01 * n);
  let wU = 0, HU = 0, eyeU = 0, armU = 0, hwU = 0, n = 2, depth = 0.9, y0 = 0.07, prof: (t: number) => number;
  let kind: ChDims['kind'] = 'imp';
  switch (s) {
    case 'box':   // громила: wide square shoulders, narrower at the hips
      kind = 'brute'; wU = 31 + fl(6); HU = 80; eyeU = 22; armU = 18; hwU = wU - 9; n = 3.4; depth = 0.84;
      prof = (t) => { const k0 = (wU - 9) / wU, u = Math.min(1, t / 0.8); return (k0 + (1 - k0) * Math.pow(u, 0.8)) * (t > 0.8 ? domeF(t, 0.8, 3) : 1) * rb(t, 0.035); };
      break;
    case 'ball': { // пухлик: a fat dome, wider than tall, bulging out low over a narrower foot, a broad flat-ish top
      kind = 'chubby'; const ws = 34 + fl(6); HU = 66; eyeU = 24; armU = 32; hwU = ws * 0.6; depth = 0.93;
      const B = bezierSide([ws - 6, ws + 8, ws + 4, 0], [0, 14, 66, 66]); wU = B.max;
      prof = (t) => B.prof(t) * rb(t, 0.035);
      break;
    }
    case 'tall':  // франт: tall and slim
      kind = 'dandy'; wU = 18 + fl(4); HU = 110; eyeU = 26; armU = 44; hwU = wU * 0.82;
      prof = (t) => (t > 0.64 ? domeF(t, 0.64) : (0.95 + 0.05 * Math.sin((t / 0.64) * Math.PI)) * rb(t, 0.035));
      break;
    case 'ghost': // огненный дух: a flame body that floats (flame tongues on top are parts)
      kind = 'wisp'; wU = 26 + fl(6); HU = 74; eyeU = 30; armU = 42; hwU = wU * 0.66; y0 = 0.12;
      prof = (t) => (t > 0.5 ? domeF(t, 0.5, 2.2) : 1 + 0.08 * Math.pow(1 - t / 0.5, 1.5)) * rb(t, 0.03);
      break;
    case 'cone': { // нетопырь: a tall cone, nearly upright flanks curving in to a sharp point, big bat ears
      kind = 'bat'; const ws = 28 + fl(6); HU = 86; eyeU = 30; armU = 44; hwU = 14;
      const B = bezierSide([ws, ws - 4, ws - 16, 0], [0, 26, 72, 86]); wU = B.max;
      prof = (t) => Math.pow(B.prof(t), t > 0.5 ? 1 + (t - 0.5) * 0.6 : 1) * rb(t, 0.04);
      break;
    }
    case 'egg':   // вылупыш: an egg sitting in its broken shell
      kind = 'hatch'; wU = 26 + fl(5); HU = 90; eyeU = 30; armU = 46; hwU = wU * 0.6; y0 = 0.03;
      prof = (t) => Math.pow(Math.sin(Math.PI * Math.pow(t, 0.8)), 0.6);
      break;
    default:      // бесёнок: a drop with a pointed top
      kind = 'imp'; wU = 25 + fl(8); HU = 91; eyeU = 29; armU = 41; hwU = wU * 0.62;
      prof = (t) => (t < 0.32 ? (0.96 + 0.04 * Math.sin((t / 0.32) * Math.PI / 2)) * rb(t, 0.04) : Math.pow(Math.cos(((t - 0.32) / 0.68) * Math.PI / 2), 1.3));
  }
  // a lighter chibi factor than the other styles: the imps keep the site's tall/narrow differences between forms
  // seen in 3D from a little above, a dome shows its top and reads taller and rounder than the flat drawing, a cone reads
  // as a bell: the пухлик is drawn a touch lower and wider, the нетопырь a touch wider at the foot (FORM_K = [w, h])
  const [fw, fh] = FORM_K[s] || [1, 1];
  const H = HU * K * CH_H * fh, w = wU * K * CH_W * fw, top = y0 + H, narrow = s === 'tall' || s === 'cone';
  const eyeOff = eyeU * K * CH_H, armOff = armU * K * CH_H;
  return {
    shape: s, y0, H, w, depth, n, top, eyeY: top - eyeOff, mouthY: top - eyeOff - 14 * K, armY: top - armOff,
    ex: (narrow ? 8 : 10) * K, narrow, ghost: s === 'ghost', profile: prof, kind, hwU, wU,
  };
}

/**
 * The dims hats are built on: the site seats hats on a head line `hw` wide whatever the top looks like (a pointed bean
 * top, a cone tip), so the 3D hats get a head that is at least that wide just under the top.
 */
export function chHatDims(d: ChDims): BodyDims {
  const hwF = Math.min(1, (d.hwU / d.wU) * 0.92), H = d.H, base = d.profile;
  return { ...d, profile: (t) => Math.max(base(t), hwF * Math.min(1, Math.sqrt(Math.max(0, (1 - t) * H / 0.09)))) };
}

/** A point on the body's front surface at (x, y), `off` metres out (superellipse section solved for θ). */
export function onFront(d: BodyDims, x: number, y: number, off: number): [number, number, number] {
  const r = radiusAt(d, y) + off, ax = Math.min(Math.abs(x), r * 0.999), e = d.n / 2;
  const sn = Math.pow(ax / r, e), cs = Math.sqrt(Math.max(0, 1 - sn * sn));
  return [Math.sign(x) * ax, y, -r * d.depth * Math.pow(cs, 2 / d.n)];
}
/** A crisp decal patch on the front of the body: a fan of `rings` × `segs` from (cx, cy) to boundary(φ) (metres). */
export function frontPatch(d: BodyDims, cx: number, cy: number, boundary: (phi: number) => [number, number], off: number, segs = 28, rings = 5): THREE.BufferGeometry {
  const pos: number[] = [], idx: number[] = [];
  pos.push(...onFront(d, cx, cy, off));
  for (let k = 1; k <= rings; k++) for (let i = 0; i < segs; i++) {
    const [bx, by] = boundary((i / segs) * Math.PI * 2), t = k / rings;
    pos.push(...onFront(d, cx + (bx - cx) * t, cy + (by - cy) * t, off));
  }
  for (let i = 0; i < segs; i++) idx.push(0, 1 + i, 1 + ((i + 1) % segs));
  for (let k = 1; k < rings; k++) for (let i = 0; i < segs; i++) {
    const a = 1 + (k - 1) * segs + i, b = 1 + (k - 1) * segs + ((i + 1) % segs), c = a + segs, e = b + segs;
    idx.push(a, c, b, b, c, e);
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
  // face the front (−Z)
  const n = g.attributes.normal; let z = 0; for (let i = 0; i < n.count; i++) z += n.getZ(i);
  if (z > 0) { const ix = idx.slice(); for (let q = 0; q < ix.length; q += 3) { const t = ix[q + 1]; ix[q + 1] = ix[q + 2]; ix[q + 2] = t; } g.setIndex(ix); g.computeVertexNormals(); }
  return g;
}
/** A line drawn on the front surface (dark detail lines): a thin tube through surface points. */
function frontLine(d: BodyDims, pts: V2[], r: number): THREE.BufferGeometry {
  return tube(pts.map(([x, y]) => onFront(d, x, y, 0.002)), r, Math.max(4, pts.length * 3), 4);
}
/** Belly, the fire spirit's core, the brute's chest and the dandy's collar as crisp parts on the body bone. */
export function addBodyMarks(p: Parts, d: ChDims, tr: ChTraits, fill: string, bone: number): void {
  const my = d.mouthY, yb = d.y0 + 0.02;
  if (d.kind === 'wisp') {   // fire core: an orange flame-arch with a yellow heart
    const cy = d.y0 + (d.eyeY - d.y0) * 0.38;
    const arch = (hw: number, top: number, bot: number) => (phi: number): [number, number] => {
      const c = Math.cos(phi), sn = Math.sin(phi);
      return sn >= 0 ? [hw * c * (1 - 0.55 * sn), cy + (top - cy) * Math.pow(sn, 0.8)] : [hw * c, cy + (bot - cy) * -sn];
    };
    p.add(frontPatch(d, 0, cy, arch(d.w * 0.62, d.eyeY - 0.12, yb), 0.003), CH_FIRE[1], undefined, bone);
    p.add(frontPatch(d, 0, cy, arch(d.w * 0.26, d.eyeY - 0.3, yb + 0.01), 0.006, 20, 3), CH_FIRE[0], undefined, bone);
    return;
  }
  if (tr.belly) {
    const cy = (my + d.y0) / 2 - 0.03, ry = (my - d.y0) * 0.38, rx = Math.min(d.w * 0.62, radiusAt(d, cy) * 0.7);
    p.add(frontPatch(d, 0, cy, (phi) => [rx * Math.cos(phi), cy + ry * Math.sin(phi)], 0.003), chLight(fill, 0.45), undefined, bone);
  }
  const dark3 = chDark(fill, 0.3);
  if (d.kind === 'brute') {   // chest arc, a line down the belly, a few abs
    const yp = d.armY - 0.2, hw = d.w * 0.66;
    p.add(frontLine(d, [[-hw, yp + 0.02], [-hw * 0.5, yp - 0.03], [0, yp - 0.045], [hw * 0.5, yp - 0.03], [hw, yp + 0.02]], 0.009), dark3, undefined, bone);
    p.add(frontLine(d, [[0, yp - 0.05], [0, yb + 0.08]], 0.008), dark3, undefined, bone);
    p.add(frontLine(d, [[-0.15, yp - 0.2], [-0.08, yp - 0.23], [0, yp - 0.2], [0.08, yp - 0.23], [0.15, yp - 0.2]], 0.008), dark3, undefined, bone);
  }
  if (d.kind === 'dandy') {   // the sharp little collar under the chin
    const yv = my - 0.13;
    p.add(frontLine(d, [[-0.11, yv], [-0.05, yv - 0.06], [0, yv - 0.11], [0.05, yv - 0.06], [0.11, yv]], 0.011), chDark(fill, 0.4), undefined, bone);
  }
}
/** The colour of the skin at a point of the body shell (belly, wisp fire core, brute chest, dandy collar). */
export function chBodyColor(d: ChDims, _tr: ChTraits, fill: string): (th: number, y: number, t: number, out: THREE.Color) => void {
  const C = col(fill), D = col(chDark(fill, 0.12));
  // flat skin (the site's fills are flat), a touch darker right at the ground so the base reads
  return (_th, y, _t, out) => { out.copy(y < d.y0 + 0.025 ? D : C); };
}

/* ------------------------------------------------------------------ horns */
/** Highest height where the head is at least `r` wide (the horn line). */
function lineAt(d: BodyDims, r: number): number {
  for (let y = d.top - 0.004; y > d.y0 + d.H * 0.4; y -= 0.004) if (radiusAt(d, y) >= r) return y;
  return d.top - 0.05;
}
/** Horn centre lines: [out, up, back] in site units from the base (the side's outward direction is +out). */
const HORN_PATH: Record<Exclude<HornKind, 'broken'> | 'stub', { pts: [number, number, number][]; r: number; taper: number }> = {
  cone: { pts: [[-1, -3, 0], [0.5, 4, 0], [3, 11, 0.5], [7, 17, 1]], r: 4.6, taper: 0.9 },
  goat: { pts: [[-1, -3, 0], [0, 6, 1], [4, 15, 4], [10, 21, 8], [17, 21, 11]], r: 4.6, taper: 0.9 },
  ram: { pts: [[-1, -1, 0], [3, 6, -1], [10, 7, -2], [15, 1, -2], [13, -5, -3], [8, -5, -3.5], [7, -1, -3.5]], r: 4.6, taper: 0.55 },
  bull: { pts: [[-2, 0, 0], [6, 2, 0], [13, 5, 0], [17, 12, -1], [16, 19, -1.5]], r: 4.8, taper: 0.88 },
  nub: { pts: [[-0.5, -2, 0], [0.5, 3, 0], [1, 6.5, 0]], r: 4.2, taper: 0.85 },
  stub: { pts: [[-0.5, -2, 0], [0.6, 3, 0], [1.2, 5.5, 0]], r: 4.6, taper: 0.25 },
};
/** Adds the horns; returns the y of their highest point. */
export function addHorns(p: Parts, d: ChDims, tr: ChTraits, bone: number): number {
  const dxU = Math.max(8, d.hwU * 0.55), dx = dxU * K * CH_W, yb = lineAt(d, dx * 0.92);
  let top = d.top;
  for (const s of [-1, 1]) {
    const kind = tr.horn === 'broken' ? (s > 0 ? 'stub' : 'cone') : tr.horn;
    const H = HORN_PATH[kind];
    const pts = H.pts.map(([o, u, b]) => [s * (dx + o * K), yb + u * K, b * K] as [number, number, number]);
    p.add(tube(pts, H.r * K, kind === 'ram' ? 18 : 10, 8, H.taper), tr.hornCol, undefined, bone);
    const e = pts[pts.length - 1];
    // a rounded tip (the tube is open); the broken one gets a flat, lighter break
    const tipR = H.r * K * (1 - H.taper);
    if (kind === 'stub') p.add(cyl(tipR * 1.02, tipR * 1.02, 0.006, 8), chLight(tr.hornCol === '#2a1a22' ? '#6a5a62' : tr.hornCol, 0.3), T(e[0], e[1], e[2], 0, 0, -s * 0.15), bone);
    else p.add(sphere(Math.max(0.003, tipR), 6, 4), tr.hornCol, T(e[0], e[1], e[2]), bone);
    for (const q of pts) top = Math.max(top, q[1] + H.r * K * 0.5);
  }
  return top;
}

/* ------------------------------------------------------------------ wings */
type V2 = [number, number];
/** Concave scallop between two finger tips (sampled, pulled towards the root). */
function scallop(a: V2, b: V2, root: V2, depth: number, n = 4): V2[] {
  const out: V2[] = [];
  for (let i = 1; i < n; i++) {
    const t = i / n, x = a[0] + (b[0] - a[0]) * t, y = a[1] + (b[1] - a[1]) * t, k = Math.sin(t * Math.PI) * depth;
    out.push([x + (root[0] - x) * k, y + (root[1] - y) * k]);
  }
  return out;
}
/** Bat wing outline (out, up) in site units + its finger tips; tattered = torn teeth instead of smooth scallops. */
function batOutline(tattered: boolean): { poly: V2[]; wrist: V2; tips: V2[] } {
  const root: V2 = [0, -4], wrist: V2 = [6, 14], top: V2 = [24, 25], tip: V2 = [38, 20];
  const f: V2[] = [tip, [31, -3], [20, -10], [7, -10]];
  const poly: V2[] = [[0, 4], wrist, [15, 22], top, tip];
  for (let i = 0; i + 1 < f.length; i++) {
    if (tattered) { const a = f[i], b = f[i + 1]; poly.push([(a[0] * 2 + b[0]) / 3 - 2, (a[1] * 2 + b[1]) / 3 + 5], [(a[0] + b[0] * 2) / 3 + 1, (a[1] + b[1] * 2) / 3 - 1]); }
    else poly.push(...scallop(f[i], f[i + 1], wrist, 0.32));
    poly.push(f[i + 1]);
  }
  poly.push(root);
  return { poly, wrist, tips: f.slice(0, 3) };
}

/** 3D wings read smaller than the flat drawing (they are swept back and seen from above): a little larger. */
const WING_K = 1.18;
/** Wing placement: root on the back, the membrane plane swept back by `sweep`, `s` = side (+1 = model +X). */
function wingMatrix(d: ChDims, s: number, y: number, sc: number, sweep: number, lift = 0): THREE.Matrix4 {
  const r = radiusAt(d, Math.min(d.top - 0.02, Math.max(d.y0 + 0.02, y))), pt = { x: 0, z: 0 };
  sectionXZ(d, r * 0.82, Math.PI - s * 0.75, pt);
  const m = T(pt.x, y, pt.z, 0, -s * sweep, s * lift);
  const k = sc * K * CH_W * WING_K;
  return m.multiply(new THREE.Matrix4().makeScale(s * k, k, 1));
}
const flip = (g: THREE.BufferGeometry, s: number) => {   // a mirrored matrix (s < 0) turns the faces inside out
  if (s > 0) return g;
  const ix = g.index ? Array.from(g.index.array) : null;
  if (ix) { for (let q = 0; q < ix.length; q += 3) { const t = ix[q + 1]; ix[q + 1] = ix[q + 2]; ix[q + 2] = t; } g.setIndex(ix); }
  else { const pos = g.attributes.position; for (let q = 0; q < pos.count; q += 3) for (let c = 0; c < 3; c++) { const t = pos.getComponent(q + 1, c); pos.setComponent(q + 1, c, pos.getComponent(q + 2, c)); pos.setComponent(q + 2, c, t); } }
  return g;
};

/** Adds the wings of the form (bat / tattered / tiny / feathers / flame / baby; the bat-imp has two pairs). */
export function addWings(p: Parts, d: ChDims, fill: string, bone: number, low = false): void {
  const tiny = d.kind === 'chubby' || d.kind === 'hatch';
  const yU = tiny ? 22 : 14, y = Math.min(d.top - 0.06, d.armY + yU * K * 0.94);
  const mem = chDark(fill, 0.38), rib = chDark(fill, 0.62);
  const bat = (s: number, sc: number, yy: number, tattered: boolean) => {
    const o = batOutline(tattered), m = wingMatrix(d, s, yy, sc, 0.26, 0.1);
    p.add(flip(slab(o.poly, 0.012), s), mem, m, bone);
    if (low) return;
    for (const tp of o.tips) {   // ribs from the wrist joint to the finger tips, just proud of the membrane
      const a = new THREE.Vector3(o.wrist[0], o.wrist[1], -0.007).applyMatrix4(m), b = new THREE.Vector3(tp[0], tp[1], -0.007).applyMatrix4(m);
      const a2 = new THREE.Vector3(o.wrist[0], o.wrist[1], 0.007).applyMatrix4(m), b2 = new THREE.Vector3(tp[0], tp[1], 0.007).applyMatrix4(m);
      p.add(tube([[a.x, a.y, a.z], [b.x, b.y, b.z]], 0.0065 * Math.min(1.3, sc), 2, 5), rib, undefined, bone);
      p.add(tube([[a2.x, a2.y, a2.z], [b2.x, b2.y, b2.z]], 0.0065 * Math.min(1.3, sc), 2, 5), rib, undefined, bone);
    }
    const w = new THREE.Vector3(o.wrist[0], o.wrist[1], 0).applyMatrix4(m), top = new THREE.Vector3(24, 25, 0).applyMatrix4(m);
    p.add(tube([[w.x, w.y, w.z], [top.x, top.y, top.z]], 0.008 * Math.min(1.3, sc), 3, 5), rib, undefined, bone);   // leading edge bone
    p.add(sphere(0.014 * Math.min(1.3, sc), 7, 5), rib, T(w.x, w.y, w.z), bone);
    if (tattered) { const h = new THREE.Vector3(17, 8, 0).applyMatrix4(m); p.add(sphere(0.022, 7, 5), CH_INK, T(h.x, h.y, h.z, 0, 0, 0, [1, 1, 0.5]), bone); }
  };
  for (const s of [-1, 1]) {
    switch (d.kind) {
      case 'brute': bat(s, 1.55, y, true); break;
      case 'chubby': bat(s, 0.78, y, false); break;
      case 'bat': bat(s, 1.15, y, false); bat(s, 0.75, y - 16 * K, false); break;
      case 'dandy': {   // grey feathers of a fallen angel, fanned out from the root
        const m = wingMatrix(d, s, y, 1.3, 0.26, 0);
        for (let i = 0; i < (low ? 3 : 6); i++) {
          const ii = low ? i * 2 : i, deg = 66 - ii * 21, a = (deg * Math.PI) / 180, len = 21 - Math.abs(ii - 2) * 2.2;
          const c = new THREE.Vector3(Math.cos(a) * (len * 0.62 + 7) + 3, Math.sin(a) * (len * 0.62 + 7) - 2, 0).applyMatrix4(m);
          const dir = new THREE.Vector3(Math.cos(a), Math.sin(a), 0).transformDirection(m);   // m mirrors per side
          const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(1, 0, 0), dir), e = new THREE.Euler().setFromQuaternion(q);
          p.add(sphere(1, 10, 6), '#5a4a56', T(c.x, c.y, c.z, e.x, e.y, e.z, [len * 0.55 * K * 1.3 * WING_K, 4 * K * 1.3 * WING_K, 0.012]), bone);
          if (!low) p.add(sphere(1, 6, 3), '#9a8a96', T(c.x, c.y, c.z, e.x, e.y, e.z, [len * 0.4 * K * 1.3 * WING_K, 0.5 * K * 1.3 * WING_K, 0.016]), bone);
        }
        break;
      }
      case 'wisp': {    // wings of fire: an orange flame with a yellow heart
        const outer: V2[] = [[0, -7], [9, 5], [19, 27], [22, 14], [28, 21], [31, 7], [40, 13], [37, -1], [43, -8], [30, -8], [25, -15], [15, -8], [0, -12]];
        const inner: V2[] = [[4, -6], [13, 3], [20, 15], [24, 5], [32, 4], [24, -3], [4, -9]];
        const m = wingMatrix(d, s, y, 1, 0.26, 0.1);
        p.add(flip(slab(outer, 0.012), s), CH_FIRE[1], m, bone);
        if (!low) p.add(flip(slab(inner, 0.004), s), CH_FIRE[0], m.clone().multiply(T(0, 0, -0.009)), bone);
        break;
      }
      case 'hatch': {   // baby wings: small rounded nubs in a lighter skin
        const poly: V2[] = [[0, -4], [4, 10], [12, 15], [21, 13], [24, 7], [19, 3], [23, -3], [15, -6], [10, -9], [0, -8]];
        p.add(flip(slab(poly, 0.014), s), chLight(fill, 0.35), wingMatrix(d, s, y, 1.2, 0.26, 0.1), bone);
        break;
      }
      default: bat(s, 1.3, y, false);
    }
  }
}

/* ------------------------------------------------------------------ tail */
/** Tail centre lines (out = towards the drawing's right side, up), site units from where the tail leaves the body. */
const TAIL: Record<TailShape, V2[]> = {
  scurve: [[0, 0], [15, -3], [29, 9], [28, 30], [32, 52], [44, 70]],
  curl: [[0, 0], [20, -3], [37, 14], [38, 39], [27, 57], [13, 51], [15, 37], [27, 40]],
  loop: [[0, 0], [22, 2], [32, 20], [24, 34], [10, 31], [8, 20], [20, 16], [38, 22], [44, 40], [44, 60]],
  hook: [[0, 0], [18, -2], [32, 13], [34, 32], [40, 53], [54, 60], [62, 47]],
  wave: [[0, 0], [12, -6], [22, 2], [32, -3], [42, 4], [52, 3], [60, -1], [64, 13], [62, 28]],
  ground: [[0, 0], [10, -11], [26, -14], [42, -9], [54, 1], [56, 14], [50, 28]],
};
export interface TailBuild { tail2: THREE.Vector3 }
/**
 * Adds the tail (tube in the skin colour + the tip) leaving the lower back. It sweeps back and to the viewer's right
 * (model −X) so that it shows beside the body from the front, as on the site. Skinned tail1 → tail2.
 * Returns the rest position for tail2 (a point half-way along).
 */
export function addTail(p: Parts, d: ChDims, tr: ChTraits, fill: string, t0: THREE.Vector3, back: number, boneA: number, boneB: number, low = false): TailBuild {
  const S = K * CH_W, base = TAIL[tr.tshape] || TAIL.scurve;
  // leaves the body at the back of the viewer's right side, then runs out sideways (and a little back), as drawn
  const side = -0.86, aft = 0.5, pt = { x: 0, z: 0 };
  sectionXZ(d, radiusAt(d, t0.y) * 0.96, -(Math.PI - 0.95), pt);
  const sx = pt.x, sz = pt.z + back;
  const at = (o: number, u: number): [number, number, number] => [sx + side * o * S, t0.y + u * S, sz + aft * o * S];
  const pts: [number, number, number][] = [[0, t0.y + 0.01, t0.z - 0.06], [sx * 0.6, t0.y, (t0.z + sz) / 2], ...base.slice(0).map(([o, u]) => at(o, u))];
  const mid = pts[Math.floor(pts.length / 2)], t2 = new THREE.Vector3(...mid);
  const span = Math.max(0.05, t2.distanceTo(t0));
  const skin: Skin = (x, y, z) => {
    if (z < t0.z - 0.01) return [boneA, boneA, 1];
    const w = Math.min(1, Math.max(0, Math.hypot(x - t0.x, y - t0.y, z - t0.z) / span));
    return [boneA, boneB, 1 - w];
  };
  const tr0 = 0.03;
  p.add(tube(pts, tr0, low ? 8 : 30, low ? 4 : 8, 0.25), fill, undefined, skin);
  if (low) return { tail2: t2 };
  const e = pts[pts.length - 1], q = pts[pts.length - 2];
  // the tip lies in the tail's plane, its point along the last direction
  const dir = new THREE.Vector3(e[0] - q[0], e[1] - q[1], e[2] - q[2]).normalize();
  const plane = new THREE.Vector3(side, 0, aft).normalize();   // tip faces the viewer's side         // the curve runs in the plane of (plane, up)
  const nrm = new THREE.Vector3().crossVectors(plane, new THREE.Vector3(0, 1, 0)).normalize();
  const xax = new THREE.Vector3().crossVectors(dir, nrm).normalize();
  const basis = new THREE.Matrix4().makeBasis(xax, dir, nrm).setPosition(e[0], e[1], e[2]);
  const m = (sc = 1, z = 0) => basis.clone().multiply(T(0, 0, z, 0, 0, 0, [S * sc, S * sc, 1]));
  const tipC = chDark(fill, 0.3);
  p.add(sphere(tr0 * 0.8, 8, 6), fill, T(e[0], e[1], e[2]), skin);
  switch (tr.tip) {
    case 'heart': {
      const h: V2[] = []; for (let i = 0; i <= 16; i++) { const a = (i / 16) * Math.PI * 2, x = 16 * Math.pow(Math.sin(a), 3), y = 13 * Math.cos(a) - 5 * Math.cos(2 * a) - 2 * Math.cos(3 * a) - Math.cos(4 * a); h.push([x * 0.55, (y + 10) * 0.55]); }
      p.add(slab(h, 0.018), tipC, m(1), skin); break;
    }
    case 'flame': {
      const f: V2[] = [[-6, 0], [-8.5, 8], [-2, 18], [0, 11], [3, 13.5], [8.5, 6], [6, 0], [0, -2.5]];
      p.add(slab(f, 0.018), CH_FIRE[1], m(1), skin);
      p.add(slab([[-2.4, 1], [-3.6, 6], [-0.6, 10], [2.4, 5.5], [1.6, 1]], 0.006), CH_FIRE[0], m(1, -0.011), skin);
      break;
    }
    case 'tuft': {
      const c = chDark(fill, 0.45);
      for (const [x, y, r] of [[-4, 4, 4.6], [4, 4, 4.6], [0, 9, 5.2]] as const) { const v = new THREE.Vector3(x, y, 0).applyMatrix4(m(1)); p.add(sphere(r * S, 8, 6), c, T(v.x, v.y, v.z), skin); }
      break;
    }
    default: {   // a rounded arrow / spade point
      const a: V2[] = [[0, 15.5], [5, 10.5], [8, 3.5], [7, -1], [3, 0.5], [0, -3], [-3, 0.5], [-7, -1], [-8, 3.5], [-5, 10.5]];
      p.add(slab(a, 0.02), tipC, m(1), skin);
    }
  }
  return { tail2: t2 };
}

/* ------------------------------------------------------------------ hooves, ears, beard, flames, shell */
/** A cloven hoof at (x, z) on the ground: a dark rounded block with a lighter split at the front. */
export function addHoof(p: Parts, x: number, z: number, bone: number): void {
  p.add(cyl(0.064, 0.078, 0.08, 12), HOOF, T(x, 0.04, z - 0.03, 0, 0, 0, [1, 1, 1.15]), bone);
  p.add(sphere(0.064, 12, 6), HOOF, T(x, 0.08, z - 0.03, 0, 0, 0, [1, 0.5, 1.15]), bone);
  p.add(cyl(0.005, 0.005, 0.075, 4), '#8a7a82', T(x, 0.042, z - 0.12, 0, 0, 0), bone);
}

/** Big bat ears (нетопырь): skin outside, a lighter inside, standing out from the cone top. */
export function addBatEars(p: Parts, d: ChDims, fill: string, bone: number): void {
  // the site's ears: triangles rooted 10–18 units under the apex, 10–18 units off the centre line, the tips 26 units out
  // and 14 units over the apex — so they flank whatever hat sits on the point
  const y = d.top - 14 * K * CH_H, r = radiusAt(d, y), S = K * CH_W;
  for (const s of [-1, 1]) {
    const bx = s * Math.max(r * 0.8, 12 * S), tip = new THREE.Vector3(s * 26 * S, d.top + 14 * K * CH_H, 0);
    const len = Math.hypot(tip.x - bx, tip.y - y), lean = Math.atan2(tip.x - bx, tip.y - y);
    const m = T(bx + (tip.x - bx) / 2, y + (tip.y - y) / 2, 0.01, 0, 0, -lean);
    p.add(cone(0.085, len, 4), fill, m.clone().multiply(T(0, 0, 0, 0, Math.PI / 4, 0, [1, 1, 0.38])), bone);
    p.add(cone(0.058, len * 0.78, 4), chLight(fill, 0.4), m.clone().multiply(T(0, -len * 0.06, -0.026, 0, Math.PI / 4, 0, [1, 1, 0.2])), bone);
  }
}

/** Goat beard under the mouth. */
export function addGoatee(p: Parts, d: ChDims, fill: string, bone: number): void {
  const y = d.mouthY - 0.07, z = -radiusAt(d, y) * d.depth;
  p.add(cone(0.04, 0.12, 8), chDark(fill, 0.6), T(0, y - 0.03, z + 0.004, Math.PI - 0.25, 0, 0, [1, 1, 0.6]), bone);
}

/** Flame tongues on top of the fire spirit (the body's top is a flame). */
export function addWispFlames(p: Parts, d: ChDims, fill: string, bone: number): void {
  for (const [x, h, lean] of [[0, 0.2, 0.05], [-0.13, 0.13, 0.35], [0.13, 0.13, -0.35]] as const) {
    const xx = x * (d.w / 0.32), y = d.top - 0.06 - (x ? 0.06 : 0);
    p.add(cone(0.075, h + 0.06, 10), fill, T(xx, y + (h + 0.06) / 2, 0, 0, 0, lean, [1, 1, 0.8]), bone);
  }
}

/** The broken egg shell the hatchling sits in: outer + inner shells with a zig-zag rim, a few speckles. */
export function addShell(p: Parts, d: ChDims, bone: number): number {
  const segs = 28, rings = 9, rimY = d.y0 + d.H * 0.42, pos: number[] = [], posI: number[] = [], idx: number[] = [], pt = { x: 0, z: 0 };
  const rOut = (y: number) => Math.max(0.05, radiusAt(d, Math.max(d.y0 + d.H * 0.12, y)) + 0.03);
  for (let j = 0; j <= rings; j++) for (let i = 0; i < segs; i++) {
    const a = (i / segs) * Math.PI * 2 - Math.PI, t = j / rings;
    const zz = j === rings ? (i % 2 ? 0.045 : -0.035) : 0;   // teeth on the rim
    const y = t * (rimY + zz);
    // rounded bottom: radius grows from a small cap to the rim
    const r = rOut(y) * (0.55 + 0.45 * Math.sqrt(Math.min(1, t * 2.2)));
    sectionXZ(d, r, a, pt); pos.push(pt.x * 1.04, y, pt.z * 1.04);
    sectionXZ(d, r - 0.012, a, pt); posI.push(pt.x * 1.04, Math.max(0.004, y), pt.z * 1.04);
  }
  for (let j = 0; j < rings; j++) for (let i = 0; i < segs; i++) {
    const a = j * segs + i, b = j * segs + ((i + 1) % segs), c = (j + 1) * segs + i, e = (j + 1) * segs + ((i + 1) % segs);
    idx.push(a, c, b, b, c, e);
  }
  const mk = (P: number[], inv: boolean) => {
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
    g.setIndex(inv ? idx.map((_, q) => idx[q - (q % 3) + [0, 2, 1][q % 3]]) : idx); g.computeVertexNormals(); return g;
  };
  p.add(mk(pos, false), '#fbf6ea', undefined, bone);
  p.add(mk(posI, true), '#e8dcc0', undefined, bone);
  // bottom cap
  p.add(new THREE.CircleGeometry(rOut(0) * 0.56, segs), '#fbf6ea', T(0, 0.002, 0, Math.PI / 2, 0, 0, [1.04, d.depth * 1.04, 1]), bone);
  // speckles
  for (const [a, y, r] of [[-0.5, 0.45, 0.024], [0.9, 0.3, 0.03], [0.2, 0.15, 0.02], [2.4, 0.4, 0.026]] as const) {
    const yy = rimY * y; sectionXZ(d, rOut(yy) * (0.55 + 0.45 * Math.sqrt(Math.min(1, y * 2.2))) + 0.001, a, pt);
    p.add(sphere(r, 6, 4), '#e8dcc0', T(pt.x * 1.04, yy, pt.z * 1.04, 0, a, 0, [1, 1, 0.3]), bone);
  }
  return rimY;
}

/* ------------------------------------------------------------------ first-person claws */
/** Three small dark claws at the finger tips of an imp hand (view-model), around the given points. */
export function addClaws(p: Parts, at: [number, number, number][], dir: THREE.Vector3, size = 0.012): void {
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize()), e = new THREE.Euler().setFromQuaternion(q);
  for (const [x, y, z] of at) p.add(cone(size * 0.42, size, 5), CH_INK, T(x, y, z, e.x, e.y, e.z));
}

/* ------------------------------------------------------------------ hats drawn the imps' way */
/** A small 3D flame (orange body, yellow heart, a pointed tip) standing at (x, y, z), `s` ≈ height / 0.2 m. */
export function flame3(p: Parts, x: number, y: number, z: number, s: number, bone?: number): void {
  p.add(sphere(0.055 * s, 10, 8), CH_FIRE[1], T(x, y + 0.06 * s, z, 0, 0, 0, [1, 1.25, 0.8]), bone);
  p.add(cone(0.045 * s, 0.13 * s, 8), CH_FIRE[1], T(x - 0.006 * s, y + 0.15 * s, z, 0, 0, 0.12, [1, 1, 0.8]), bone);
  p.add(sphere(0.03 * s, 8, 6), CH_FIRE[0], T(x, y + 0.055 * s, z - 0.03 * s, 0, 0, 0, [1, 1.3, 0.7]), bone);
}

/**
 * The hats the cherts style draws its own way (styles/cherts hats(k)): fire tuft, the trident, two flames, a fire
 * flower, the black bandana with sparks, the witch hat with an orange band, the dandy top hat with a red band, the
 * party cone with a flame, big golden horns, the crooked halo, the thorn crown. `d` = the hat dims (chHatDims).
 * Returns the height above the top, or null when the shared 3D hat (hats.ts) should be used.
 */
export function addChertsHat(p: Parts, id: string, d: BodyDims, c2: string): number | null {
  const top = d.top, flat = d.shape === 'box', hr = radiusAt(d, top - (flat ? 0.02 : 0.09)), hy = top - (flat ? 0 : 0.035);
  const BLACK = '#2a1a22';
  switch (id) {
    case 'tuft': flame3(p, 0, top - 0.04, 0, 1.15); return 0.2;
    case 'sprout':
      p.add(cyl(0.01, 0.012, 0.17, 6), '#3a7a2a', T(0, top + 0.05, 0));
      flame3(p, 0, top + 0.13, 0, 0.7); return 0.28;
    case 'antenna': {   // the little trident
      p.add(cyl(0.011, 0.011, 0.2, 6), CH_INK, T(0, top + 0.08, 0));
      p.add(cyl(0.01, 0.01, 0.16, 6), CH_INK, T(0, top + 0.18, 0, 0, 0, Math.PI / 2));
      for (const [x, h] of [[-0.08, 0.09], [0, 0.12], [0.08, 0.09]] as const) {
        p.add(cyl(0.01, 0.01, h, 6), CH_INK, T(x, top + 0.18 + h / 2, 0));
        p.add(cone(0.024, 0.05, 4), CH_INK, T(x, top + 0.18 + h + 0.02, 0, 0, Math.PI / 4, 0, [1, 1, 0.5]));
      }
      return 0.34;
    }
    case 'antenna2':
      for (const s of [-1, 1]) {
        p.add(tube([[s * 0.06, top - 0.02, 0], [s * 0.1, top + 0.1, 0], [s * 0.15, top + 0.2, 0]], 0.012, 6, 5), CH_INK);
        flame3(p, s * 0.155, top + 0.19, 0, 0.55);
      }
      return 0.32;
    case 'party':
      p.add(cone(hr * 0.62, 0.3, 14), c2, T(0, hy + 0.14, 0));
      flame3(p, 0, hy + 0.27, 0, 0.5); return 0.38;
    case 'tophat':
      p.add(cyl(hr * 1.2, hr * 1.2, 0.02, 18), BLACK, T(0, hy, 0, 0, 0, 0, [1, 1, d.depth]));
      p.add(cyl(hr * 0.66, hr * 0.66, 0.3, 16), BLACK, T(0, hy + 0.15, 0));
      p.add(cyl(hr * 0.675, hr * 0.675, 0.05, 16, true), CH_FIRE[2], T(0, hy + 0.06, 0));
      return 0.31;
    case 'wizard': {   // the witch hat: black, a bent tip, an orange band
      p.add(cyl(hr * 1.4, hr * 1.4, 0.02, 20), BLACK, T(0, hy, 0, 0, 0, 0, [1, 1, d.depth]));
      p.add(tube([[0, hy, 0], [0.01, hy + 0.2, 0], [0.04, hy + 0.4, 0.01], [0.1, hy + 0.47, 0.02]], hr * 0.66, 14, 12, 0.96), BLACK);
      p.add(cyl(hr * 0.68, hr * 0.68, 0.035, 16, true), CH_FIRE[1], T(0, hy + 0.035, 0));
      return 0.42;
    }
    case 'bandana': {  // a black kerchief over the top, the knot at the side, orange spark dots
      p.add(sphere(1, 18, 10), BLACK, T(0, hy - 0.02, 0, 0, 0, 0, [hr * 1.12, 0.09, hr * 1.12 * d.depth]));
      for (const s of [1]) { p.add(cone(0.04, 0.1, 5), BLACK, T(s * hr * 1.1, hy - 0.04, 0.03, 0, 0, s * -1.9, [1, 1, 0.5])); p.add(cone(0.035, 0.08, 5), BLACK, T(s * hr * 1.05, hy - 0.08, 0.05, 0, 0, s * -2.6, [1, 1, 0.5])); }
      for (const [x, y] of [[-0.06, 0.03], [0.05, 0.05], [0, -0.005]] as const) p.add(sphere(0.017, 6, 4), CH_FIRE[1], T(x, hy + y, -Math.sqrt(Math.max(0, 1 - (x / hr) ** 2)) * hr * 1.12 * d.depth * Math.sqrt(Math.max(0, 1 - ((y + 0.02) / 0.09) ** 2)) - 0.004));
      return 0.08;
    }
    case 'horns':   // big golden horns
      for (const s of [-1, 1]) p.add(tube([[s * hr * 0.35, hy - 0.03, 0], [s * 0.26, hy + 0.01, 0], [s * 0.36, hy + 0.18, 0.02], [s * 0.27, hy + 0.42, 0.03]], 0.042, 16, 8, 0.9), CH_GOLD);
      return 0.44;
    case 'halo':   // a crooked, cracked halo
      p.add(torus(0.17, 0.018, 5, 22, Math.PI * 1.7), '#ffe27a', T(0, top + 0.16, 0, Math.PI / 2 - 0.55, 0.24, 0.3));   // tipped towards the viewer: reads as a ring
      return 0.2;
    case 'laurel': {   // the thorn crown
      const r = hr * 0.95;
      p.add(torus(r, 0.016, 4, 20), '#3a2a2a', T(0, hy, 0, Math.PI / 2, 0, 0, [1, d.depth, 1]));
      for (let i = 0; i < 9; i++) { const a = (i / 9) * Math.PI * 2; p.add(cone(0.02, 0.07, 4), '#3a2a2a', T(Math.sin(a) * r, hy + 0.03, -Math.cos(a) * r * d.depth, 0, 0, 0)); }
      return 0.08;
    }
    default: return null;
  }
}
