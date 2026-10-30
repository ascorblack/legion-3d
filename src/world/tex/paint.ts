/**
 * Shared painting helpers for the texture generators: colours, wrapped drawing, element ids.
 * Conventions (see post.ts): C = colour canvas (S×S), H = height/detail canvas, I = element-id canvas (both hs×hs but
 * pre-scaled, so generators always draw in S coordinates). H starts mid-grey (0.5 = no detail), I black (= joint).
 */
export type RGB = [number, number, number];

export interface Paint {
  S: number;
  C: CanvasRenderingContext2D;
  H: CanvasRenderingContext2D;
  I: CanvasRenderingContext2D;
  /** Palette of the kind (DEFAULTS / NEUTRAL / caller colours). */
  k: RGB[];
  r: () => number;
  /** The q2 size the caller asked for (layout counts that depended on it stay the same at every quality). */
  base: number;
  /** Greyscale version (multiplied by vertex colours). */
  neutral: boolean;
  /** The kind's own default palette (decorations that only make sense in it, e.g. flowers). */
  def: boolean;
  /** Quick preview (startup): skip fine decorations that a ≤ 256 px tile cannot show anyway. */
  lite: boolean;
}

export type Gen = (p: Paint) => Generator<void, void>;

export function hex(c: string): RGB {
  let s = c.trim();
  if (s.startsWith('rgb')) { const m = s.match(/[\d.]+/g) || ['0', '0', '0']; return [+m[0], +m[1], +m[2]]; }
  s = s.replace('#', '');
  if (s.length === 3) s = s.split('').map((ch) => ch + ch).join('');
  const n = parseInt(s.slice(0, 6), 16) || 0;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
export const css = (c: RGB, a = 1): string => a >= 1
  ? `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})` : `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a.toFixed(3)})`;
export const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
export const mul = (a: RGB, f: number): RGB => [Math.min(255, a[0] * f), Math.min(255, a[1] * f), Math.min(255, a[2] * f)];
/** Random lightness (±amt) and warm/cool (±hue) jitter. */
export function jit(c: RGB, r: () => number, amt: number, hue = 0.02): RGB {
  const v = 1 + (r() - 0.5) * 2 * amt, w = (r() - 0.5) * 2 * hue;
  return [Math.min(255, c[0] * v * (1 + w)), Math.min(255, c[1] * v), Math.min(255, c[2] * v * (1 - w))];
}
export const grey = (v: number): string => { const k = Math.max(0, Math.min(255, Math.round(v * 255))); return `rgb(${k},${k},${k})`; };
export const greyA = (v: number, a: number): string => { const k = Math.max(0, Math.min(255, Math.round(v * 255))); return `rgba(${k},${k},${k},${a})`; };

/** Run `fn(dx, dy)` at every wrapped offset where the box (x, y, w, h) meets the tile. */
export function wrap(S: number, x: number, y: number, w: number, h: number, fn: (dx: number, dy: number) => void): void {
  for (const dx of [0, -S, S]) for (const dy of [0, -S, S]) {
    if (x + dx + w < 0 || x + dx > S || y + dy + h < 0 || y + dy > S) continue;
    fn(dx, dy);
  }
}

/** Element-id fill style: centre (cx, cy) in S px → R = u, G = 255 (mask), B = v (flipped: v up). */
export function idStyle(S: number, cx: number, cy: number): string {
  const u = ((cx / S) % 1 + 1) % 1, v = ((1 - cy / S) % 1 + 1) % 1;
  return `rgb(${Math.round(u * 255) % 256},255,${Math.round(v * 255) % 256})`;
}

export function rr(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}

/** Closed polygon path. */
export function poly(g: CanvasRenderingContext2D, pts: number[], dx = 0, dy = 0): void {
  g.beginPath(); g.moveTo(pts[0] + dx, pts[1] + dy);
  for (let i = 2; i < pts.length; i += 2) g.lineTo(pts[i] + dx, pts[i + 1] + dy);
  g.closePath();
}

/**
 * A block outline (x, y, w, h) with jittered edges and random chipped corners: polygon points.
 * `jag` = edge jitter (px), `chip` = max corner chip (px), `chipP` = chance per corner.
 */
export function blockPts(r: () => number, x: number, y: number, w: number, h: number, jag: number, chip: number, chipP: number, seg = 3): number[] {
  const pts: number[] = [];
  const corner = (cx: number, cy: number, ax: number, ay: number, bx: number, by: number) => {
    if (r() < chipP) { const c1 = chip * (0.4 + r() * 0.6), c2 = chip * (0.4 + r() * 0.6); pts.push(cx + ax * c1, cy + ay * c1, cx + bx * c2, cy + by * c2); }
    else pts.push(cx, cy);
  };
  const edge = (x0: number, y0: number, x1: number, y1: number, nx: number, ny: number) => {
    for (let i = 1; i < seg; i++) { const t = i / seg + (r() - 0.5) * 0.15 / seg, j = (r() - 0.5) * 2 * jag; pts.push(x0 + (x1 - x0) * t + nx * j, y0 + (y1 - y0) * t + ny * j); }
  };
  corner(x, y, 0, 1, 1, 0); edge(x, y, x + w, y, 0, 1);
  corner(x + w, y, -1, 0, 0, 1); edge(x + w, y, x + w, y + h, 1, 0);
  corner(x + w, y + h, 0, -1, -1, 0); edge(x + w, y + h, x, y + h, 0, 1);
  corner(x, y + h, 1, 0, 0, -1); edge(x, y + h, x, y, 1, 0);
  return pts;
}

/** n small squares/dots of colour `col` at alpha `a` (size ≈ sz px, scaled by S/512 when `rel`). */
export function speckle(g: CanvasRenderingContext2D, S: number, r: () => number, n: number, col: string, a: number, sz: number, round = false): void {
  g.fillStyle = col; g.globalAlpha = a;
  for (let i = 0; i < n; i++) {
    const s = sz * (0.5 + r()), x = r() * S, y = r() * S;
    if (round) { g.beginPath(); g.arc(x, y, s / 2, 0, 6.283); g.fill(); } else g.fillRect(x, y, s, s);
  }
  g.globalAlpha = 1;
}

/** Soft radial blob (wrapped). */
export function blob(g: CanvasRenderingContext2D, S: number, x: number, y: number, rad: number, col: RGB, a: number): void {
  wrap(S, x - rad, y - rad, rad * 2, rad * 2, (dx, dy) => {
    const gr = g.createRadialGradient(x + dx, y + dy, 0, x + dx, y + dy, rad);
    gr.addColorStop(0, css(col, a)); gr.addColorStop(1, css(col, 0));
    g.fillStyle = gr; g.fillRect(x + dx - rad, y + dy - rad, rad * 2, rad * 2);
  });
}

/** Wandering crack polyline on C (dark) and H (groove). */
export function crack(p: Paint, x: number, y: number, len: number, step: number, dir: number, col: RGB, a: number, w: number): void {
  const { C, H, r } = p;
  C.strokeStyle = css(col, a); C.lineWidth = w; H.strokeStyle = grey(0.12); H.lineWidth = w * 1.4;
  C.lineCap = H.lineCap = 'round'; C.lineJoin = H.lineJoin = 'round';
  C.beginPath(); H.beginPath(); C.moveTo(x, y); H.moveTo(x, y);
  for (let j = 0; j < len; j++) {
    x += Math.cos(dir + (r() - 0.5) * 1.4) * step; y += Math.sin(dir + (r() - 0.5) * 1.4) * step;
    C.lineTo(x, y); H.lineTo(x, y);
  }
  C.stroke(); H.stroke();
}
