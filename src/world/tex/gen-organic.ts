/**
 * Generators of organic / continuous surfaces (no elements): plaster, rock, grass, soil, dirt path, moss, thatch,
 * canvas, hammered metal. They paint H as the height itself (post mode 'paint'); the surface shader anti-tiles them.
 */
import { type Paint, type RGB, css, mix, mul, jit, grey, greyA, wrap, speckle, blob, crack, poly } from './paint';

/** Multi-scale tonal blotches (soft, wrapped). */
function blotches(p: Paint, n: number, r0: number, r1: number, cols: RGB[], a: number): void {
  const { S, C, r } = p;
  for (let i = 0; i < n; i++) blob(C, S, r() * S, r() * S, S * (r0 + r() * (r1 - r0)), cols[(r() * cols.length) | 0], a * (0.5 + r() * 0.5));
}
function hblobs(p: Paint, n: number, r0: number, r1: number, lo: number, hi: number): void {
  const { S, H, r } = p;
  for (let i = 0; i < n; i++) { const v = 255 * (lo + r() * (hi - lo)); blob(H, S, r() * S, r() * S, S * (r0 + r() * (r1 - r0)), [v, v, v], 0.5); }
}

/** Soft plaster: blotches, trowel arcs, rain streaks from the top, hairline cracks, chipped patches showing brick. */
export function* plaster(p: Paint): Generator<void, void> {
  const { S, C, H, r, k } = p;
  const [base, stain, light] = k;
  C.fillStyle = css(base); C.fillRect(0, 0, S, S);
  H.fillStyle = grey(0.6); H.fillRect(0, 0, S, S);
  blotches(p, 26, 0.04, 0.16, [stain, light, mul(base, 0.92)], 0.35);
  hblobs(p, 20, 0.03, 0.12, 0.45, 0.75);
  yield;
  // trowel arcs
  for (let i = 0; i < (p.lite ? 0 : 60); i++) {
    const x = r() * S, y = r() * S, rad = S * (0.03 + r() * 0.06), a0 = r() * 6.28;
    wrap(S, x - rad, y - rad, rad * 2, rad * 2, (dx, dy) => {
      C.strokeStyle = css(r() < 0.5 ? light : stain, 0.12); C.lineWidth = S / 512 * (2 + r() * 3);
      C.beginPath(); C.arc(x + dx, y + dy, rad, a0, a0 + 0.8 + r()); C.stroke();
      H.strokeStyle = greyA(r() < 0.5 ? 0.7 : 0.5, 0.35); H.lineWidth = C.lineWidth;
      H.beginPath(); H.arc(x + dx, y + dy, rad, a0, a0 + 0.8 + r()); H.stroke();
    });
  }
  // vertical rain streaks
  for (let i = 0; i < 14; i++) {
    const x = r() * S, w = S * (0.006 + r() * 0.02), y = r() * S, l = S * (0.15 + r() * 0.35);
    wrap(S, x, y, w, l, (dx, dy) => {
      const gr = C.createLinearGradient(0, y + dy, 0, y + dy + l);
      gr.addColorStop(0, css(stain, 0.22)); gr.addColorStop(1, css(stain, 0));
      C.fillStyle = gr; C.fillRect(x + dx, y + dy, w, l);
    });
  }
  yield;
  // chipped patches: recessed, with a few bricks showing
  const nP = p.neutral ? 1 : 2;
  for (let i = 0; i < nP; i++) {
    const cx = S * (0.15 + r() * 0.7), cy = S * (0.15 + r() * 0.7), rw = S * (0.05 + r() * 0.05), rh = rw * (0.5 + r() * 0.4);
    const pts: number[] = [];
    for (let j = 0; j < 12; j++) { const a = (j / 12) * 6.283, f = 0.7 + r() * 0.45; pts.push(cx + Math.cos(a) * rw * f, cy + Math.sin(a) * rh * f); }
    const brickC = p.neutral ? mul(base, 0.75) : mix([170, 85, 60], base, 0.25);
    C.fillStyle = css(mul(brickC, 0.75)); poly(C, pts); C.fill();
    C.save(); poly(C, pts); C.clip();
    const bh = S / 32, bw = bh * 3;
    for (let y = cy - rh - bh; y < cy + rh + bh; y += bh) for (let x = cx - rw - bw + ((y / bh) % 2) * bw / 2; x < cx + rw + bw; x += bw) {
      C.fillStyle = css(jit(brickC, r, 0.1)); C.fillRect(x + 1.5, y + 1.5, bw - 3, bh - 3);
    }
    C.restore();
    H.fillStyle = grey(0.32); poly(H, pts); H.fill();
    C.strokeStyle = css(mul(base, 0.7), 0.6); C.lineWidth = S / 512 * 1.5; poly(C, pts); C.stroke();
  }
  for (let i = 0; i < 4; i++) crack(p, r() * S * 0.8 + S * 0.1, r() * S * 0.8 + S * 0.1, 5, S * 0.025, 1.3 + r() * 0.6, mul(stain, 0.5), 0.35, S / 512 * 1.2);
  speckle(C, S, r, S * 5, '#000', 0.05, S / 512 * 2); speckle(C, S, r, S * 3, '#fff', 0.05, S / 512 * 1.6);
  speckle(H, S, r, S * 6, grey(0.4), 0.3, S / 512 * 2); speckle(H, S, r, S * 4, grey(0.8), 0.3, S / 512 * 1.6);
}

/** Natural rock: overlapping angular facets, strata, fractures, lichen, grit. */
export function* rock(p: Paint): Generator<void, void> {
  const { S, C, H, r, k } = p;
  const [base, lightC, darkC, hiC] = k;
  C.fillStyle = css(base); C.fillRect(0, 0, S, S);
  H.fillStyle = grey(0.45); H.fillRect(0, 0, S, S);
  const facet = (g: CanvasRenderingContext2D, cx: number, cy: number, rad: number, n: number, rot: number, sq: number[]) => {
    g.beginPath();
    for (let i = 0; i < n; i++) {
      const a = rot + (i / n) * Math.PI * 2, x = cx + Math.cos(a) * rad * sq[i], y = cy + Math.sin(a) * rad * sq[i] * 0.7;
      if (i) g.lineTo(x, y); else g.moveTo(x, y);
    }
    g.closePath();
  };
  for (const [n, rad] of [[26, S * 0.15], [80, S * 0.065], [200, S * 0.028]] as const) {
    for (let i = 0; i < n; i++) {
      const cx = r() * S, cy = r() * S, rot = r() * 6.28, sides = 4 + Math.floor(r() * 3), t = r();
      const sq = Array.from({ length: sides }, () => 0.6 + r() * 0.5);
      const col = t < 0.45 ? lightC : t < 0.7 ? base : darkC, hv = t < 0.45 ? 0.62 + r() * 0.3 : t < 0.7 ? 0.45 : 0.3;
      const a = rad > S * 0.1 ? 0.38 : 0.45;
      wrap(S, cx - rad, cy - rad, rad * 2, rad * 2, (dx, dy) => {
        C.globalAlpha = col === darkC ? a * 0.55 : a; C.fillStyle = css(jit(col, r, 0.05)); facet(C, cx + dx, cy + dy, rad, sides, rot, sq); C.fill();
        H.globalAlpha = 0.7; H.fillStyle = grey(hv); facet(H, cx + dx, cy + dy, rad, sides, rot, sq); H.fill();
        if (col === lightC && rad > S * 0.05) { C.globalAlpha = 0.22; C.strokeStyle = css(hiC); C.lineWidth = S / 512 * 1.5; facet(C, cx + dx, cy + dy, rad * 0.98, sides, rot, sq); C.stroke(); }
      });
      C.globalAlpha = 1; H.globalAlpha = 1;
    }
    yield;
  }
  // strata: faint wavy bands
  for (let i = 0; i < 6; i++) {
    const y0 = r() * S, amp = S * 0.02, ph = r() * 6.28;
    C.strokeStyle = css(darkC, 0.18); C.lineWidth = S / 512 * (2 + r() * 3);
    C.beginPath(); for (let x = 0; x <= S; x += S / 32) { const y = y0 + Math.sin(x / S * 6.283 * 2 + ph) * amp; if (x) C.lineTo(x, y); else C.moveTo(x, y); } C.stroke();
  }
  for (let i = 0; i < (p.lite ? 4 : 16); i++) crack(p, r() * S, r() * S, 4 + (r() * 6 | 0), S * 0.035, r() * 6.28, darkC, 0.6, S / 512 * (1 + r() * 1.3));
  if (!p.neutral) for (let i = 0; i < 10; i++) blob(C, S, r() * S, r() * S, S * (0.01 + r() * 0.025), mix(base, [140, 160, 90], 0.6), 0.35);
  speckle(C, S, r, S * 4, '#000', 0.08, S / 512 * 2); speckle(C, S, r, S * 3, '#fff', 0.07, S / 512 * 1.5);
  speckle(H, S, r, S * 4, grey(0.2), 0.3, S / 512 * 2); speckle(H, S, r, S * 3, grey(0.85), 0.3, S / 512 * 2);
}

/** Grass: tonal patches (lush / dry), soil showing through, dense tapered blades, clover, a few flowers. */
export function* grass(p: Paint): Generator<void, void> {
  const { S, C, H, r, k } = p;
  const [g0, g1, g2] = k;
  const dry = mix(g0, [200, 176, 96], 0.4), lush = mul(g1, 0.85), soil: RGB = p.neutral ? mul(g1, 0.7) : mix(g1, [90, 64, 40], 0.65);
  C.fillStyle = css(g1); C.fillRect(0, 0, S, S);
  H.fillStyle = grey(0.25); H.fillRect(0, 0, S, S);
  blotches(p, 30, 0.05, 0.16, [dry, lush, g0], 0.35);
  for (let i = 0; i < 18; i++) blob(C, S, r() * S, r() * S, S * (0.008 + r() * 0.02), soil, 0.6);
  speckle(C, S, r, S * 2, css(soil), 0.5, S / 512 * 2);
  yield;
  const n = Math.round(S * S / 170), sc = S / 512;
  C.lineCap = H.lineCap = 'round';
  const tones = [g0, g1, g2, lush, dry];
  for (let i = 0; i < n; i++) {
    const x = r() * S, y = r() * S, l = (5 + r() * 9) * sc, a = -Math.PI / 2 + (r() - 0.5) * 1.1, bend = (r() - 0.5) * l * 0.5;
    const t = r(), col = jit(tones[t < 0.35 ? 0 : t < 0.55 ? 1 : t < 0.75 ? 2 : t < 0.9 ? 3 : 4], r, 0.08);
    const ex = x + Math.cos(a) * l, ey = y + Math.sin(a) * l;
    C.strokeStyle = css(col); C.lineWidth = (1.2 + r() * 1.6) * sc;
    H.strokeStyle = grey(0.45 + r() * 0.55); H.lineWidth = 1.4 * sc;
    wrap(S, Math.min(x, ex) - l, Math.min(y, ey) - l, l * 2, l * 2, (dx, dy) => {
      C.beginPath(); C.moveTo(x + dx, y + dy); C.quadraticCurveTo(x + dx + bend, (y + ey) / 2 + dy, ex + dx, ey + dy); C.stroke();
      H.beginPath(); H.moveTo(x + dx, y + dy); H.quadraticCurveTo(x + dx + bend, (y + ey) / 2 + dy, ex + dx, ey + dy); H.stroke();
    });
    if (i % 1500 === 0) yield;
  }
  // clover clusters
  for (let i = 0; i < (p.lite ? 0 : 40); i++) {
    const x = r() * S, y = r() * S, rad = (1.6 + r()) * sc, col = mix(g2, g0, 0.3);
    for (let j = 0; j < 3; j++) { const a = j * 2.09 + r(); C.fillStyle = css(col, 0.9); C.beginPath(); C.arc(x + Math.cos(a) * rad, y + Math.sin(a) * rad, rad, 0, 6.283); C.fill(); H.fillStyle = grey(0.8); H.beginPath(); H.arc(x + Math.cos(a) * rad, y + Math.sin(a) * rad, rad, 0, 6.283); H.fill(); }
  }
  if (p.def) for (let i = 0; i < 16; i++) { C.fillStyle = r() < 0.5 ? '#ffd6e6' : '#fff3a0'; C.beginPath(); C.arc(r() * S, r() * S, 2.2 * sc, 0, 6.283); C.fill(); }
}

/** Shared ground painter: soil / dirt path. */
function* earth(p: Paint, clods: number, gravel: number, pebbles: number, cracks: number): Generator<void, void> {
  const { S, C, H, r, k } = p;
  const [base, dark, light] = k;
  const sc = S / 512;
  C.fillStyle = css(base); C.fillRect(0, 0, S, S);
  H.fillStyle = grey(0.4); H.fillRect(0, 0, S, S);
  blotches(p, 30, 0.04, 0.14, [dark, light, base], 0.35);
  hblobs(p, 24, 0.03, 0.1, 0.3, 0.55);
  yield;
  // clods: irregular lumps with a lit top and shaded bottom
  for (let i = 0; i < clods; i++) {
    const x = r() * S, y = r() * S, rad = (2 + r() * 5) * sc, c = jit(r() < 0.5 ? light : base, r, 0.08);
    wrap(S, x - rad, y - rad, rad * 2, rad * 2, (dx, dy) => {
      C.fillStyle = css(mul(dark, 0.8), 0.5); C.beginPath(); C.ellipse(x + dx + rad * 0.2, y + dy + rad * 0.3, rad, rad * 0.75, 0, 0, 6.283); C.fill();
      C.fillStyle = css(c); C.beginPath(); C.ellipse(x + dx, y + dy, rad, rad * 0.7, r(), 0, 6.283); C.fill();
      const hg = H.createRadialGradient(x + dx, y + dy, 0, x + dx, y + dy, rad); hg.addColorStop(0, grey(0.85)); hg.addColorStop(1, grey(0.45));
      H.fillStyle = hg; H.beginPath(); H.ellipse(x + dx, y + dy, rad, rad * 0.7, 0, 0, 6.283); H.fill();
    });
  }
  speckle(C, S, r, gravel, css(light), 0.55, 1.6 * sc); speckle(C, S, r, gravel, css(mul(dark, 0.8)), 0.55, 1.4 * sc);
  speckle(H, S, r, gravel, grey(0.75), 0.6, 1.6 * sc);
  yield;
  // pebbles with shadow + highlight
  for (let i = 0; i < pebbles; i++) {
    const x = r() * S, y = r() * S, rad = (2 + r() * 4) * sc, c: RGB = p.neutral ? jit(light, r, 0.1) : jit(mix(light, [170, 165, 160], 0.6), r, 0.12);
    wrap(S, x - rad * 2, y - rad * 2, rad * 4, rad * 4, (dx, dy) => {
      C.fillStyle = 'rgba(0,0,0,.3)'; C.beginPath(); C.ellipse(x + dx + rad * 0.3, y + dy + rad * 0.35, rad * 1.2, rad * 0.9, 0, 0, 6.283); C.fill();
      C.fillStyle = css(c); C.beginPath(); C.ellipse(x + dx, y + dy, rad * 1.2, rad * 0.85, 0, 0, 6.283); C.fill();
      C.fillStyle = 'rgba(255,255,255,.3)'; C.beginPath(); C.ellipse(x + dx - rad * 0.35, y + dy - rad * 0.3, rad * 0.45, rad * 0.25, -0.4, 0, 6.283); C.fill();
      const hg = H.createRadialGradient(x + dx, y + dy, 0, x + dx, y + dy, rad * 1.2); hg.addColorStop(0, grey(1)); hg.addColorStop(1, grey(0.5));
      H.fillStyle = hg; H.beginPath(); H.ellipse(x + dx, y + dy, rad * 1.2, rad * 0.85, 0, 0, 6.283); H.fill();
    });
  }
  for (let i = 0; i < cracks; i++) crack(p, r() * S, r() * S, 4 + (r() * 5 | 0), S * 0.03, r() * 6.28, mul(dark, 0.7), 0.4, sc * 1.2);
  // twigs
  for (let i = 0; i < 6; i++) { const x = r() * S, y = r() * S, a = r() * 6.28, l = (8 + r() * 14) * sc; C.strokeStyle = css(mix(dark, [120, 80, 40], 0.4), 0.7); C.lineWidth = 1.4 * sc; C.beginPath(); C.moveTo(x, y); C.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); C.stroke(); }
}
/** Soil: clods, pebbles, twigs. */
export const soil = (p: Paint) => earth(p, Math.round(p.S * 0.35), p.S * 3, Math.round(p.S * 0.04), 2);
/** Trodden dirt path: fine gravel, few clods, more pebbles and dry cracks. */
export const path = (p: Paint) => earth(p, Math.round(p.S * 0.08), p.S * 7, Math.round(p.S * 0.07), 8);

/** Moss: dense clumps in three greens with lit tops. */
export function* moss(p: Paint): Generator<void, void> {
  const { S, C, H, r, k } = p;
  const [m0, m1, m2] = k, sc = S / 512;
  C.fillStyle = css(m1); C.fillRect(0, 0, S, S);
  H.fillStyle = grey(0.3); H.fillRect(0, 0, S, S);
  blotches(p, 20, 0.04, 0.12, [m0, m2, mul(m1, 0.8)], 0.4);
  for (let i = 0; i < S * 3; i++) {
    const x = r() * S, y = r() * S, rad = (1.5 + r() * 3.5) * sc, c = jit([m0, m1, m2][(r() * 3) | 0], r, 0.1);
    C.fillStyle = css(c); C.beginPath(); C.arc(x, y, rad, 0, 6.283); C.fill();
    C.fillStyle = css(mix(c, [255, 255, 220], 0.3), 0.5); C.beginPath(); C.arc(x - rad * 0.3, y - rad * 0.3, rad * 0.45, 0, 6.283); C.fill();
    const hg = H.createRadialGradient(x, y, 0, x, y, rad); hg.addColorStop(0, grey(0.9)); hg.addColorStop(1, grey(0.35));
    H.fillStyle = hg; H.beginPath(); H.arc(x, y, rad, 0, 6.283); H.fill();
    if (i % 600 === 0) yield;
  }
}

/** Thatch: 5 courses of straw bundles per tile, each course's lower edge shading the one below. */
export function* thatch(p: Paint): Generator<void, void> {
  const { S, C, H, r, k } = p;
  const [s0, s1, dark, hi] = k, sc = S / 512;
  C.fillStyle = css(dark); C.fillRect(0, 0, S, S);
  H.fillStyle = grey(0.2); H.fillRect(0, 0, S, S);
  const rows = 5, h = S / rows;
  for (let row = 0; row <= rows; row++) {
    const y0 = row * h - h * 0.15;
    for (let i = 0; i < S * 0.9; i++) {
      const x = r() * S, l = h * (0.9 + r() * 0.4), a = Math.PI / 2 + (r() - 0.5) * 0.18, y = y0 + r() * h * 0.2;
      const c = jit(r() < 0.5 ? s0 : r() < 0.7 ? s1 : hi, r, 0.12);
      const ex = x + Math.cos(a) * l, ey = y + Math.sin(a) * l;
      C.strokeStyle = css(c, 0.85); C.lineWidth = (1 + r() * 1.4) * sc;
      wrap(S, Math.min(x, ex) - 2, y - 2, Math.abs(ex - x) + 4, l + 4, (dx, dy) => { C.beginPath(); C.moveTo(x + dx, y + dy); C.lineTo(ex + dx, ey + dy); C.stroke(); });
      const hg = 0.35 + 0.6 * ((y - y0) / h);
      H.strokeStyle = greyA(Math.min(1, hg + r() * 0.15), 0.7); H.lineWidth = C.lineWidth;
      wrap(S, Math.min(x, ex) - 2, y - 2, Math.abs(ex - x) + 4, l + 4, (dx, dy) => { H.beginPath(); H.moveTo(x + dx, y + dy); H.lineTo(ex + dx, ey + dy); H.stroke(); });
    }
    // the course's binding shadow
    const gy = (row + 1) * h - h * 0.15;
    const gr = C.createLinearGradient(0, gy - h * 0.25, 0, gy + h * 0.05);
    gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(1, 'rgba(0,0,0,.35)');
    C.fillStyle = gr; C.fillRect(0, gy - h * 0.25, S, h * 0.3);
    yield;
  }
}

/** Woven canvas: stripes A/B (4 per tile), fine weave, stitched seams, stains, soft folds (height). */
export function* canvas(p: Paint): Generator<void, void> {
  const { S, C, H, r, k } = p;
  const n = 4, w = S / n, sc = S / 512;
  for (let i = 0; i < n; i++) { C.fillStyle = css(k[i % 2]); C.fillRect(i * w, 0, w, S); }
  // soft folds: long sine sag in H + matching shading
  const img = H.createLinearGradient(0, 0, S, 0);
  const folds = 2 + (r() * 2 | 0);
  for (let i = 0; i <= folds * 4; i++) { const t = i / (folds * 4), v = 0.5 + 0.22 * Math.sin(t * Math.PI * 2 * folds + r() * 0.3); img.addColorStop(t, grey(v)); }
  H.fillStyle = img; H.fillRect(0, 0, S, S);
  const sh = C.createLinearGradient(0, 0, S, 0);
  for (let i = 0; i <= folds * 4; i++) { const t = i / (folds * 4), v = Math.sin(t * Math.PI * 2 * folds); sh.addColorStop(t, v > 0 ? `rgba(255,255,255,${0.05 * v})` : `rgba(0,0,0,${-0.1 * v})`); }
  C.fillStyle = sh; C.fillRect(0, 0, S, S);
  yield;
  const step = Math.max(2, Math.round(2 * sc));
  for (let y = 0; y < S; y += step) { C.fillStyle = (y / step) % 2 ? 'rgba(0,0,0,.06)' : 'rgba(255,255,255,.05)'; C.fillRect(0, y, S, step / 2); H.fillStyle = greyA((y / step) % 2 ? 0.35 : 0.6, 0.35); H.fillRect(0, y, S, step / 2); }
  for (let x = 0; x < S; x += step) { C.fillStyle = 'rgba(0,0,0,.05)'; C.fillRect(x, 0, step / 2, S); H.fillStyle = greyA(0.4, 0.25); H.fillRect(x, 0, step / 2, S); }
  // seams with stitches
  for (let i = 0; i < n; i++) {
    const x = i * w;
    C.fillStyle = 'rgba(0,0,0,.18)'; C.fillRect(x - sc, 0, 2.5 * sc, S);
    H.fillStyle = grey(0.25); H.fillRect(x - sc, 0, 2 * sc, S);
    C.fillStyle = 'rgba(255,255,255,.35)';
    for (let y = 0; y < S; y += 8 * sc) C.fillRect(x + 3 * sc, y, 1.2 * sc, 4 * sc);
  }
  for (let i = 0; i < 5; i++) blob(C, S, r() * S, r() * S, S * (0.03 + r() * 0.06), [60, 50, 40], 0.08);
  // weathered bottom (dirt splash band) is done by the shader near the ground
}

/** Hammered / brushed iron: streaks, dents, scratches, rust blooms. */
export function* metal(p: Paint): Generator<void, void> {
  const { S, C, H, r, k } = p;
  const [base, dark, hi] = k, rust: RGB = p.neutral ? mul(base, 0.8) : [120, 70, 46], sc = S / 512;
  C.fillStyle = css(base); C.fillRect(0, 0, S, S);
  H.fillStyle = grey(0.5); H.fillRect(0, 0, S, S);
  for (let y = 0; y < S; y += sc) { C.fillStyle = css(r() < 0.5 ? dark : hi, 0.04 + r() * 0.05); C.fillRect(0, y, S, sc); }
  blotches(p, 14, 0.06, 0.2, [hi, dark], 0.22);
  yield;
  for (let i = 0; i < (p.lite ? 8 : 40); i++) {   // hammer dents
    const x = r() * S, y = r() * S, rad = S * (0.015 + r() * 0.03);
    blob(H, S, x, y, rad, [70, 70, 70], 0.5);
    blob(C, S, x - rad * 0.3, y - rad * 0.3, rad * 0.7, hi, 0.1);
    blob(C, S, x + rad * 0.3, y + rad * 0.3, rad * 0.7, dark, 0.12);
  }
  for (let i = 0; i < 10; i++) blob(C, S, r() * S, r() * S, S * (0.02 + r() * 0.05), rust, 0.25);
  for (let i = 0; i < (p.lite ? 0 : 80); i++) {   // scratches
    const x = r() * S, y = r() * S, a = r() * 6.28, l = S * (0.02 + r() * 0.06);
    C.strokeStyle = css(hi, 0.35 + r() * 0.25); C.lineWidth = (0.7 + r() * 0.8) * sc; C.beginPath(); C.moveTo(x, y); C.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); C.stroke();
    H.strokeStyle = greyA(0.35, 0.6); H.lineWidth = sc; H.beginPath(); H.moveTo(x, y); H.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); H.stroke();
  }
  speckle(H, S, r, S * 3, grey(0.35), 0.3, 1.5 * sc);
}
