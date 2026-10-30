/**
 * Generators of built surfaces with elements (stones, bricks, blocks, boards, tiles, plates, columns): every element is
 * painted on C (tone, shading, speckles), filled on I with its centre id (bevel + AO + per-tile tint, post.ts/surface.ts)
 * and given detail on H. Layout counts per tile are fixed (they set the world scale with batch.ts MAT_UV).
 */
import { type Paint, type Gen, type RGB, css, mix, mul, jit, grey, greyA, wrap, idStyle, rr, poly, blockPts, speckle, crack } from './paint';

/** Paint one element: tone with a top-left light / bottom-right shade, then its id. */
function shadeFill(p: Paint, path: (g: CanvasRenderingContext2D, dx: number, dy: number) => void, x: number, y: number, w: number, h: number, col: RGB, light: RGB, cx: number, cy: number, sh = 0.22): void {
  const { S, C, I } = p;
  wrap(S, x, y, w, h, (dx, dy) => {
    path(C, dx, dy); C.fillStyle = css(col); C.fill();
    const gr = C.createLinearGradient(x + dx, y + dy, x + dx + w * 0.4, y + dy + h);
    gr.addColorStop(0, css(light, 0.35)); gr.addColorStop(0.45, css(light, 0)); gr.addColorStop(0.55, 'rgba(0,0,0,0)'); gr.addColorStop(1, `rgba(0,0,0,${sh})`);
    C.fillStyle = gr; path(C, dx, dy); C.fill();
    I.fillStyle = idStyle(S, cx, cy); path(I, dx, dy); I.fill();
  });
}

/** Stone-surface speckles inside a box (C pits/flecks + H pits). */
function pits(p: Paint, x: number, y: number, w: number, h: number, n: number, dark: RGB, light: RGB, sz: number): void {
  const { C, H, r } = p;
  if (p.lite) return;
  for (let i = 0; i < n; i++) {
    const px = x + r() * w, py = y + r() * h, s = sz * (0.4 + r() * 0.8), d = r() < 0.6;
    C.fillStyle = css(d ? dark : light, 0.18 + r() * 0.2); C.beginPath(); C.arc(px, py, s, 0, 6.283); C.fill();
    if (d) { H.fillStyle = greyA(0.3, 0.6); H.beginPath(); H.arc(px, py, s * 0.9, 0, 6.283); H.fill(); }
  }
}

/** Irregular rounded outline (superellipse with radial jitter) centred on (cx, cy): polygon points. */
function pebblePts(r: () => number, cx: number, cy: number, rx: number, ry: number, n = 12, jag = 0.07): number[] {
  const pts: number[] = [], e = 2 / (2.6 + r() * 1.6), rot = (r() - 0.5) * 0.12;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + rot, c = Math.cos(a), s = Math.sin(a), j = 1 + (r() - 0.5) * 2 * jag;
    pts.push(cx + Math.sign(c) * Math.pow(Math.abs(c), e) * rx * j, cy + Math.sign(s) * Math.pow(Math.abs(s), e) * ry * j);
  }
  return pts;
}

/**
 * Rounded cobbles in staggered rows (16 rows per tile for base ≥ 1024, else 8): irregular outlines, uneven heights and
 * widths, split stones, mortar with sand and pebbles.
 */
export function* cobble(p: Paint): Generator<void, void> {
  const { S, C, H, r, k } = p;
  const [stone, alt, mortar, hi] = k;
  C.fillStyle = css(mix(mortar, stone, 0.45)); C.fillRect(0, 0, S, S);
  speckle(C, S, r, S * 2, css(mix(mortar, hi, 0.3)), 0.3, S / 512 * 1.8);
  speckle(H, S, r, S * 3, grey(0.75), 0.5, S / 512 * 2, true);
  const rows = p.base >= 1024 ? 16 : 8, bh = S / rows;
  const one = (cx: number, cy: number, w: number, h: number) => {
    const t = r(), base = t < 0.3 ? alt : t < 0.34 ? mix(stone, hi, 0.35) : t < 0.44 ? mul(stone, 0.85) : stone;
    const col = jit(base, r, 0.1, 0.04);
    const pts = pebblePts(r, cx, cy, w / 2, h / 2, 12, 0.04);
    shadeFill(p, (g, dx, dy) => poly(g, pts, dx, dy), cx - w / 2, cy - h / 2, w, h, col, hi, cx, cy, 0.25);
    wrap(S, cx - w / 2, cy - h / 2, w, h, (dx, dy) => {
      pits(p, cx + dx - w * 0.35, cy + dy - h * 0.3, w * 0.7, h * 0.6, 1 + (r() * 2 | 0), mul(col, 0.8), mix(col, hi, 0.5), S / 512 * 1.6);
      // polished top crescent (feet)
      C.strokeStyle = css(hi, 0.3 + r() * 0.15); C.lineWidth = bh * 0.09; C.lineCap = 'round';
      C.beginPath(); C.moveTo(cx + dx - w * 0.28, cy + dy - h * 0.22); C.quadraticCurveTo(cx + dx - w * 0.05, cy + dy - h * 0.34, cx + dx + w * (0.1 + r() * 0.2), cy + dy - h * 0.26); C.stroke();
    });
    if (r() < 0.03 && !p.lite) crack(p, cx + (r() - 0.5) * w * 0.4, cy - h * 0.3, 3, h * 0.22, 1.57 + (r() - 0.5), mul(col, 0.5), 0.6, S / 512 * 1.2);
  };
  for (let row = 0; row < rows; row++) {
    let x = (row % 2) * bh * 0.55 + r() * bh * 0.3;
    const end = x + S;
    while (x < end - bh * 0.3) {
      const w = Math.min(bh * (0.95 + r() * 0.95), end - x);
      const m = bh * (0.045 + r() * 0.035), yc = row * bh + bh / 2 + (r() - 0.5) * bh * 0.06;
      const ww = w - 2 * m, hh = bh - 2 * m - r() * bh * 0.1;
      if (r() < 0.05 && ww > bh * 1.2) {   // split into two smaller stones side by side
        const a = ww * (0.4 + r() * 0.2) - m * 0.5;
        one(x + m + a / 2, yc, a, hh * (0.85 + r() * 0.15));
        one(x + m + a + m + (ww - a - m) / 2, yc, ww - a - m, hh * (0.85 + r() * 0.15));
      } else one(x + w / 2, yc, ww, hh);
      x += w;
    }
    yield;
  }
}

/** Running-bond bricks: 8 courses × 4 per tile, chipped corners, burnt bricks, recessed sandy mortar. */
export function* brick(p: Paint): Generator<void, void> {
  const { S, C, H, r, k } = p;
  const [bk, alt, joint, hi] = k;
  C.fillStyle = css(joint); C.fillRect(0, 0, S, S);
  speckle(C, S, r, S * 3, css(mul(joint, 1.3)), 0.4, S / 512 * 1.5);
  speckle(H, S, r, S * 3, grey(0.62), 0.5, S / 512 * 1.5);
  const rows = 8, bh = S / rows, cols = 4, bw = S / cols, m = bh * 0.085;
  for (let row = 0; row < rows; row++) {
    const off = (row % 2) * bw / 2 + (r() - 0.5) * bw * 0.04;
    for (let col = 0; col < cols; col++) {
      const x = col * bw + off + m, y = row * bh + m, w = bw - 2 * m + (r() - 0.5) * m, h = bh - 2 * m;
      const v = r(), base = v < 0.28 ? alt : v > 0.95 ? mix(bk, hi, 0.5) : v > 0.84 ? mul(bk, 0.78) : v > 0.78 ? mix(bk, joint, 0.25) : bk;
      const c = jit(base, r, 0.1, 0.04);
      const pts = blockPts(r, x, y, w, h, S / 512 * 0.8, bh * 0.28, 0.3, 2);
      shadeFill(p, (g, dx, dy) => poly(g, pts, dx, dy), x, y, w, h, c, hi, x + w / 2, y + h / 2, 0.2);
      wrap(S, x, y, w, h, (dx, dy) => {
        pits(p, x + dx + 3, y + dy + 3, w - 6, h - 6, 5 + (r() * 6 | 0), mul(c, 0.66), mix(c, hi, 0.5), S / 512 * 1.1);
        // a lighter sand-faced band on top, a sooty bottom edge
        C.fillStyle = css(hi, 0.12); C.fillRect(x + dx + w * 0.06, y + dy + h * 0.08, w * 0.88, h * 0.16);
        C.fillStyle = 'rgba(0,0,0,.12)'; C.fillRect(x + dx + w * 0.04, y + dy + h * 0.8, w * 0.92, h * 0.14);
      });
    }
    yield;
  }
}

/** Ashlar blocks: 4 courses per tile, jagged chipped outlines, tool marks, rare cracks. */
export function* stone(p: Paint): Generator<void, void> {
  const { S, C, H, r, k } = p;
  const [st, alt, joint, hi] = k;
  C.fillStyle = css(joint); C.fillRect(0, 0, S, S);
  speckle(C, S, r, S * 2, css(mul(joint, 1.3)), 0.35, S / 512 * 1.6);
  const rows = 4, bh = S / rows, m = bh * 0.035;
  for (let row = 0; row < rows; row++) {
    let x = r() * bh; const end = x + S;
    while (x < end - bh * 0.4) {
      const w = Math.min(bh * (1.05 + r() * 0.95), end - x);
      const xx = x + m, y = row * bh + m, ww = w - 2 * m, hh = bh - 2 * m;
      const c = jit(r() < 0.35 ? alt : st, r, 0.07, 0.025);
      const pts = blockPts(r, xx, y, ww, hh, S / 512 * 1.6, bh * 0.16, 0.45, 4);
      shadeFill(p, (g, dx, dy) => poly(g, pts, dx, dy), xx, y, ww, hh, c, hi, xx + ww / 2, y + hh / 2, 0.22);
      wrap(S, xx, y, ww, hh, (dx, dy) => {
        pits(p, xx + dx + 4, y + dy + 4, ww - 8, hh - 8, 10 + (r() * 10 | 0), mul(c, 0.7), mix(c, hi, 0.5), S / 512 * 1.4);
        // tool marks: short parallel diagonal strokes
        const n = p.lite ? 0 : 4 + (r() * 6 | 0), a = r() < 0.5 ? 0.9 : 2.2;
        C.strokeStyle = css(mul(c, 0.82), 0.25); C.lineWidth = S / 512; H.strokeStyle = greyA(0.4, 0.5); H.lineWidth = S / 512;
        for (let i = 0; i < n; i++) {
          const sx = xx + dx + ww * (0.15 + r() * 0.7), sy = y + dy + hh * (0.2 + r() * 0.6), l = bh * 0.08;
          C.beginPath(); C.moveTo(sx, sy); C.lineTo(sx + Math.cos(a) * l, sy + Math.sin(a) * l); C.stroke();
          H.beginPath(); H.moveTo(sx, sy); H.lineTo(sx + Math.cos(a) * l, sy + Math.sin(a) * l); H.stroke();
        }
      });
      if (r() < 0.25 && !p.lite) crack(p, xx + ww * (0.2 + r() * 0.6), y + 2, 5, hh * 0.16, 1.57 + (r() - 0.5) * 0.6, mul(c, 0.45), 0.55, S / 512 * 1.3);
      x += w;
    }
    yield;
  }
}

/**
 * Boards: `n` boards across the tile, `cuts` end joints per board, grain along the board, knots, nails with rust,
 * worn edges. `vertical` = boards run along v (facade planks), else along u (floorboards).
 */
function* boards(p: Paint, n: number, cuts: number, vertical: boolean): Generator<void, void> {
  const { S, C, H, I, r, k } = p;
  const [plank, alt, gap, light] = k;
  // board space (a = across, b = along) → canvas
  const X = (a: number, b: number) => (vertical ? a : b), Y = (a: number, b: number) => (vertical ? b : a);
  const rect = (g: CanvasRenderingContext2D, a: number, b: number, wa: number, wb: number) => { if (vertical) g.fillRect(a, b, wa, wb); else g.fillRect(b, a, wb, wa); };
  C.fillStyle = css(gap); C.fillRect(0, 0, S, S);
  const pw = S / n, gw = Math.max(1, pw * 0.035);
  for (let i = 0; i < n; i++) {
    const a0 = i * pw + gw, wa = pw - 2 * gw;
    const cutAt: number[] = [];
    const first = r() * S;
    for (let c = 0; c < cuts; c++) cutAt.push((first + (c / cuts) * S + (r() - 0.5) * S * 0.2 / cuts) % S);
    cutAt.sort((x, y) => x - y);
    // facade planks (vertical): one long board per column, the end joint is only a thin painted butt line
    const hard = !vertical, eg = hard ? gw : 0;
    if (!hard) { I.fillStyle = idStyle(S, X(a0 + wa / 2, S / 2), Y(a0 + wa / 2, S / 2)); rect(I, a0, 0, wa, S); }
    const bc = jit(r() < 0.4 ? alt : plank, r, 0.08, 0.03);
    for (let c = 0; c < cuts; c++) {
      const b0 = cutAt[c] + eg, b1 = (c + 1 < cuts ? cutAt[c + 1] : cutAt[0] + S) - eg;
      const col = hard ? jit(r() < 0.4 ? alt : plank, r, 0.09, 0.03) : jit(bc, r, 0.03, 0.01), len = b1 - b0;
      for (const off of [0, -S]) {
        C.fillStyle = css(col); rect(C, a0, b0 + off, wa, len);
        if (hard) { I.fillStyle = idStyle(S, X(a0 + wa / 2, b0 + len / 2), Y(a0 + wa / 2, b0 + len / 2)); rect(I, a0, b0 + off, wa, len); }
      }
      if (!hard) { C.fillStyle = css(gap, 0.75); rect(C, a0, cutAt[c] - gw * 0.4, wa, gw * 0.8); H.fillStyle = grey(0.25); rect(H, a0, cutAt[c] - gw * 0.4, wa, gw * 0.8); }
      // nails at both ends
      if (!p.lite) for (const nb of [b0 + pw * 0.18, b1 - pw * 0.18]) for (const na of [a0 + wa * 0.22, a0 + wa * 0.78]) {
        const nx = X(na, ((nb % S) + S) % S), ny = Y(na, ((nb % S) + S) % S), rad = pw * 0.035;
        wrap(S, nx - rad * 3, ny - rad * 3, rad * 6, rad * 6, (dx, dy) => {
          const gr = C.createRadialGradient(nx + dx, ny + dy, 0, nx + dx, ny + dy, rad * 3);
          gr.addColorStop(0, 'rgba(90,50,30,.35)'); gr.addColorStop(1, 'rgba(90,50,30,0)');
          C.fillStyle = gr; C.fillRect(nx + dx - rad * 3, ny + dy - rad * 3, rad * 6, rad * 6);
          C.fillStyle = 'rgba(40,30,30,.85)'; C.beginPath(); C.arc(nx + dx, ny + dy, rad, 0, 6.283); C.fill();
          C.fillStyle = 'rgba(255,255,255,.25)'; C.beginPath(); C.arc(nx + dx - rad * 0.3, ny + dy - rad * 0.3, rad * 0.4, 0, 6.283); C.fill();
          H.fillStyle = grey(0.95); H.beginPath(); H.arc(nx + dx, ny + dy, rad, 0, 6.283); H.fill();
        });
      }
    }
    // grain: wavy lines along the board, bending round knots
    const knots: [number, number][] = [];
    const nk = r() < 0.7 ? 1 + (r() < 0.3 ? 1 : 0) : 0;
    for (let j = 0; j < nk; j++) knots.push([a0 + wa * (0.25 + r() * 0.5), r() * S]);
    const lines = p.lite ? 3 : 9 + (r() * 7 | 0);
    for (let j = 0; j < lines; j++) {
      const ga = a0 + wa * ((j + 0.5) / lines) + (r() - 0.5) * wa * 0.05, amp = pw * (0.01 + r() * 0.025), ph = r() * 6.28, fq = 1 + (r() * 3 | 0);
      const dark = r() < 0.75;
      C.strokeStyle = css(dark ? mul(gap, 1.1) : light, dark ? 0.12 + r() * 0.16 : 0.12); C.lineWidth = Math.max(0.6, pw * (0.008 + r() * 0.014));
      H.strokeStyle = greyA(dark ? 0.32 : 0.62, 0.55); H.lineWidth = C.lineWidth;
      C.beginPath(); H.beginPath();
      for (let b = 0; b <= S; b += S / (p.lite ? 16 : 64)) {
        let a = ga + Math.sin((b / S) * Math.PI * 2 * fq + ph) * amp;
        for (const [ka, kb] of knots) { let d = b - kb; d -= Math.round(d / S) * S; const f = Math.exp(-(d * d) / (pw * pw * 0.12)); a += (a > ka ? 1 : -1) * f * pw * 0.12; }
        const x = X(a, b), y = Y(a, b);
        if (b === 0) { C.moveTo(x, y); H.moveTo(x, y); } else { C.lineTo(x, y); H.lineTo(x, y); }
      }
      C.stroke(); H.stroke();
    }
    for (const [ka, kb] of knots) {
      const x = X(ka, kb), y = Y(ka, kb), ra = pw * 0.05, rb = pw * 0.1;
      wrap(S, x - rb, y - rb, rb * 2, rb * 2, (dx, dy) => {
        for (let q = 0; q < 3; q++) {
          C.strokeStyle = css(gap, 0.45 - q * 0.1); C.lineWidth = Math.max(0.8, pw * 0.012);
          C.beginPath(); C.ellipse(x + dx, y + dy, vertical ? ra * (1 + q * 0.7) : rb * (1 + q * 0.6), vertical ? rb * (1 + q * 0.6) : ra * (1 + q * 0.7), 0, 0, 6.283); C.stroke();
        }
        C.fillStyle = css(gap, 0.6); C.beginPath(); C.ellipse(x + dx, y + dy, vertical ? ra * 0.6 : rb * 0.5, vertical ? rb * 0.5 : ra * 0.6, 0, 0, 6.283); C.fill();
        H.fillStyle = greyA(0.3, 0.7); H.beginPath(); H.ellipse(x + dx, y + dy, vertical ? ra : rb * 0.8, vertical ? rb * 0.8 : ra, 0, 0, 6.283); H.fill();
      });
    }
    // worn light edge on one side, darker on the other
    C.fillStyle = css(light, 0.22); rect(C, a0 + wa * 0.02, 0, wa * 0.06, S);
    C.fillStyle = 'rgba(0,0,0,.14)'; rect(C, a0 + wa * 0.9, 0, wa * 0.08, S);
    yield;
  }
  speckle(C, S, r, S * 2, css(mul(gap, 1.0)), 0.12, S / 512 * 1.2);
}

/** Vertical planks with grain (planks run along v). 4 planks per tile, one end joint each. */
export const wood: Gen = (p) => boards(p, 4, 1, true);
/** Floorboards along u: 6 boards per tile, two staggered end joints each. */
export const planks: Gen = (p) => boards(p, 6, 2, false);

/**
 * Scalloped (round) or clipped-corner (slate) shingles. Courses are painted bottom → top so each upper course lies over
 * the tucked top of the one below; the bottom course's wrapped copy is painted last, clipped to the band where it
 * overlaps the top course (the overlap is circular across the tile seam).
 */
function* scales(p: Paint, rows: number, n: number, round: boolean): Generator<void, void> {
  const { S, C, H, I, r, k } = p;
  const [tile, alt, dark, hi] = k;
  C.fillStyle = css(dark); C.fillRect(0, 0, S, S);
  H.fillStyle = grey(0.08); H.fillRect(0, 0, S, S);
  const h = S / rows, w = S / n, lw = Math.max(1, S / 512 * 2.2), hh = h * 1.38;
  interface T { x: number; y: number; ww: number; col: RGB; broken: boolean; hv: number; bx: number }
  const course: T[][] = [];
  for (let row = 0; row < rows; row++) {
    const off = (row % 2) * w / 2, list: T[] = [];
    for (let i = -1; i <= n; i++) {
      const t = r(), base = t < 0.25 ? alt : t < 0.28 ? mix(tile, hi, 0.5) : t < 0.36 ? mul(tile, 0.82) : tile;
      list.push({ x: i * w + off + 1 + (r() - 0.5) * w * 0.05, y: row * h + (r() - 0.5) * h * 0.04, ww: w - 2, col: jit(base, r, 0.07, 0.03), broken: r() < 0.05, hv: 0.85 + r() * 0.1, bx: 0.3 + r() * 0.4 });
    }
    course.push(list);
  }
  const path = (g: CanvasRenderingContext2D, t: T, dy: number, ins: number) => {
    const { x, y, ww } = t;
    g.beginPath();
    if (round) {
      g.moveTo(x + ins, y + dy); g.lineTo(x + ins, y + dy + hh - ww / 2);
      g.arc(x + ww / 2, y + dy + hh - ww / 2, Math.max(1, ww / 2 - ins), Math.PI, 0, true); g.lineTo(x + ww - ins, y + dy);
    } else {
      const c = ww * 0.2;
      g.moveTo(x + ins, y + dy); g.lineTo(x + ins, y + dy + hh - c); g.lineTo(x + c, y + dy + hh - ins);
      g.lineTo(x + ww - c, y + dy + hh - ins); g.lineTo(x + ww - ins, y + dy + hh - c); g.lineTo(x + ww - ins, y + dy);
    }
    g.closePath();
  };
  const draw = (t: T, dy: number) => {
    const { x, y, ww, col } = t;
    C.fillStyle = css(col); path(C, t, dy, 0); C.fill();
    const gr = C.createLinearGradient(0, y + dy, 0, y + dy + hh);
    gr.addColorStop(0, 'rgba(0,0,0,.45)'); gr.addColorStop(0.3, 'rgba(0,0,0,.05)'); gr.addColorStop(0.75, css(hi, 0.12)); gr.addColorStop(1, 'rgba(0,0,0,.1)');
    C.fillStyle = gr; path(C, t, dy, 0); C.fill();
    C.strokeStyle = css(mul(dark, 0.9), 0.9); C.lineWidth = lw; path(C, t, dy, 0); C.stroke();
    C.fillStyle = css(hi, 0.22); C.fillRect(x + ww * 0.12, y + dy + hh * 0.5, ww * 0.1, hh * 0.32);
    I.fillStyle = idStyle(S, x + ww / 2, y + hh * 0.7); path(I, t, dy, lw); I.fill();
    const hg = H.createLinearGradient(0, y + dy, 0, y + dy + hh);
    hg.addColorStop(0, grey(0.2)); hg.addColorStop(0.85, grey(t.hv)); hg.addColorStop(1, grey(0.6));
    H.fillStyle = hg; path(H, t, dy, 0); H.fill();
    H.strokeStyle = grey(0.25); H.lineWidth = lw; path(H, t, dy, 0); H.stroke();
    if (t.broken && !p.lite) {
      C.strokeStyle = css(mul(col, 0.45), 0.8); C.lineWidth = lw * 0.6; H.strokeStyle = grey(0.15); H.lineWidth = lw;
      const sx = x + ww * t.bx;
      for (const g of [C, H]) { g.beginPath(); g.moveTo(sx, y + dy + hh * 0.45); g.lineTo(sx + ww * 0.1, y + dy + hh * 0.7); g.lineTo(sx - ww * 0.05, y + dy + hh); g.stroke(); }
    }
  };
  for (let row = rows - 1; row >= 0; row--) { for (const t of course[row]) draw(t, 0); yield; }
  // the bottom course continues over the top course across the seam
  for (const g of [C, H, I]) { g.save(); g.beginPath(); g.rect(0, 0, S, hh - h + 2); g.clip(); }
  for (const t of course[rows - 1]) draw(t, -S);
  for (const g of [C, H, I]) g.restore();
  speckle(C, S, r, S * 2, '#000', 0.08, S / 512 * 1.5);
  speckle(C, S, r, S, css(hi), 0.06, S / 512 * 1.2);
}
/** Scalloped terracotta tiles (6 rows × 5 per tile). */
export const roofTiles: Gen = (p) => scales(p, 6, 5, true);
/** Slate shingles with clipped corners (7 rows × 6 per tile). */
export const slate: Gen = (p) => scales(p, 7, 6, false);

/** Riveted iron plates: 2 × 2 plates per tile, rivet rows, rust streaks under rivets. */
export function* iron(p: Paint): Generator<void, void> {
  const { S, C, H, r, k } = p;
  const [base, dark, hi, rust] = k;
  C.fillStyle = css(dark); C.fillRect(0, 0, S, S);
  const n = 2, pw = S / n, m = S * 0.006, rv = S * 0.011;
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    const x = i * pw + m + (j % 2) * pw * 0.5, y = j * pw + m, w = pw - 2 * m, h = pw - 2 * m;
    const col = jit(base, r, 0.06, 0.02);
    shadeFill(p, (g, dx, dy) => rr(g, x + dx, y + dy, w, h, S * 0.008), x, y, w, h, col, hi, x + w / 2, y + h / 2, 0.25);
    wrap(S, x, y, w, h, (dx, dy) => {
      // brushed streaks + dents
      for (let s = 0; s < 40; s++) { C.fillStyle = css(r() < 0.5 ? hi : dark, 0.06); C.fillRect(x + dx, y + dy + r() * h, w, S / 512); }
      for (let s = 0; s < 6; s++) { const px = x + dx + r() * w, py = y + dy + r() * h, rad = S * (0.01 + r() * 0.02); H.fillStyle = greyA(0.35, 0.4); H.beginPath(); H.arc(px, py, rad, 0, 6.283); H.fill(); }
      // rivets round the edge
      const cnt = 6;
      for (let q = 0; q < cnt; q++) {
        const t = (q + 0.5) / cnt;
        for (const [rx, ry] of [[x + dx + w * t, y + dy + rv * 1.6], [x + dx + w * t, y + dy + h - rv * 1.6], [x + dx + rv * 1.6, y + dy + h * t], [x + dx + w - rv * 1.6, y + dy + h * t]]) {
          if (r() < 0.35) { // rust streak running down
            const gr = C.createLinearGradient(0, ry, 0, ry + pw * 0.15);
            gr.addColorStop(0, css(rust, 0.35)); gr.addColorStop(1, css(rust, 0));
            C.fillStyle = gr; C.fillRect(rx - rv * 0.6, ry, rv * 1.2, pw * 0.15);
          }
          C.fillStyle = css(mul(base, 0.6)); C.beginPath(); C.arc(rx, ry, rv, 0, 6.283); C.fill();
          C.fillStyle = css(hi, 0.6); C.beginPath(); C.arc(rx - rv * 0.3, ry - rv * 0.3, rv * 0.4, 0, 6.283); C.fill();
          const hg = H.createRadialGradient(rx, ry, 0, rx, ry, rv); hg.addColorStop(0, grey(1)); hg.addColorStop(1, grey(0.55));
          H.fillStyle = hg; H.beginPath(); H.arc(rx, ry, rv, 0, 6.283); H.fill();
        }
      }
    });
    yield;
  }
}

/** Basalt: columnar joints (5–7 columns per tile), horizontal fractures, vesicles, granular grit. */
export function* basalt(p: Paint): Generator<void, void> {
  const { S, C, H, r, k } = p;
  const [bs, alt, joint, hi] = k;
  C.fillStyle = css(joint); C.fillRect(0, 0, S, S);
  const n = 5 + (r() * 3 | 0);
  const edges: number[] = [];
  for (let i = 0; i < n; i++) edges.push((i + (r() - 0.5) * 0.35) / n * S);
  for (let i = 0; i < n; i++) {
    const x0 = edges[i], x1 = i + 1 < n ? edges[i + 1] : edges[0] + S, m = S * 0.006;
    let y = r() * S; const yEnd = y + S;
    while (y < yEnd - S * 0.05) {
      const h = Math.min(S * (0.18 + r() * 0.4), yEnd - y);
      const sl = (r() - 0.5) * S * 0.03;   // slanted column faces
      const pts = [x0 + m + sl, y + m, x1 - m + sl, y + m + (r() - 0.5) * S * 0.02, x1 - m - sl, y + h - m, x0 + m - sl, y + h - m + (r() - 0.5) * S * 0.02];
      const col = jit(r() < 0.4 ? alt : bs, r, 0.08, 0.02);
      shadeFill(p, (g, dx, dy) => poly(g, pts, dx, dy), x0, y, x1 - x0, h, col, hi, (x0 + x1) / 2, y + h / 2, 0.3);
      wrap(S, x0, y, x1 - x0, h, (dx, dy) => {
        C.fillStyle = css(hi, 0.18); C.fillRect(x0 + dx + m * 2, y + dy, (x1 - x0) * 0.08, h);   // lit column edge
        pits(p, x0 + dx + m * 2, y + dy + m * 2, x1 - x0 - m * 4, h - m * 4, 14, mul(col, 0.55), mix(col, hi, 0.6), S / 512 * 1.2);
      });
      y += h;
    }
    yield;
  }
  speckle(C, S, r, S * 6, css(hi), 0.08, S / 512 * 1.1);
  speckle(H, S, r, S * 6, grey(0.7), 0.4, S / 512 * 1.4);
}

/** Tiny helper for neutral palettes: per-kind greys. */
export const greyPal = (vals: number[]): RGB[] => vals.map((v) => [v, v, v] as RGB);
