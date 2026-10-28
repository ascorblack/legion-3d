/**
 * Face decal pieces of the «Чертики» style (site styles/cherts/characters.js eyes/mouth): imp eyes (fire-yellow slits,
 * sly squint, white "coal" eyes, a fire cyclops), angled brows, fangs, the crooked grin, the forked tongue, freckles.
 * Proportions in site units (u = px per unit), drawn on the face canvas of face.ts. The per-nick bits (fangs, brows,
 * freckles) come in the face key's iris slot (cherts-traits.ts chFaceBits).
 */
import { CH_FIRE, CH_GOLD } from './cherts-traits';

export const CH_FACE_INK = '#2a0d14';

/** Draws the imp's eyes (inside face.ts' 1.3× eye transform); false = not an imp eye, let face.ts draw it. */
export function chEyes(g: CanvasRenderingContext2D, kind: string, xs: number[], cx: number, ey: number, u: number, ink: string, bits: number): boolean {
  const brows = (bits & 2) !== 0;
  const circle = (x: number, y: number, r: number, fill: string, lw = 0) => {
    g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fillStyle = fill; g.fill();
    if (lw) { g.lineWidth = lw * u; g.strokeStyle = ink; g.stroke(); }
  };
  const ell = (x: number, y: number, rx: number, ry: number, fill: string, lw = 0) => {
    g.beginPath(); g.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); g.fillStyle = fill; g.fill();
    if (lw) { g.lineWidth = lw * u; g.strokeStyle = ink; g.stroke(); }
  };
  const browPair = () => {
    if (!brows) return;
    g.strokeStyle = ink; g.lineWidth = 2.3 * u; g.lineCap = 'round';
    for (const [i, x] of xs.entries()) {
      const d = i === 0 ? -1 : 1;   // outer end higher, slanting down towards the nose: the imp's frown-grin
      g.beginPath(); g.moveTo(x + d * 6 * u, ey - 9.5 * u); g.lineTo(x - d * 2.5 * u, ey - 6.8 * u); g.stroke();
    }
  };
  switch (kind) {
    case 'big':   // white "coal" eyes with dark pupils
      for (const x of xs) { circle(x, ey, 6.6 * u, '#fff', 2.3); circle(x + 0.9 * u, ey + 0.9 * u, 2.9 * u, ink); }
      browPair(); return true;
    case 'cyclops':   // one fire eye with a slit pupil
      circle(cx, ey - 1 * u, 9.4 * u, CH_FIRE[0], 2.5); ell(cx, ey - 1 * u, 2.3 * u, 6.6 * u, ink); return true;
    case 'stars':
      for (const x of xs) {
        g.beginPath();
        for (let i = 0; i < 8; i++) { const a = (i * Math.PI) / 4, r = i % 2 ? 1.9 * u : 6 * u; const px = x + Math.sin(a) * r, py = ey - Math.cos(a) * r; i ? g.lineTo(px, py) : g.moveTo(px, py); }
        g.closePath(); g.fillStyle = CH_GOLD; g.fill(); g.lineWidth = 1.4 * u; g.strokeStyle = ink; g.stroke();
      }
      return true;
    case 'slit':   // yellow eyes, cat-like slit pupils
      for (const x of xs) { ell(x, ey, 5.3 * u, 4.9 * u, CH_FIRE[0], 2.1); ell(x, ey, 1.4 * u, 4.2 * u, ink); }
      browPair(); return true;
    case 'sly': {   // one eye squinted, the other a dot under a raised brow
      g.strokeStyle = ink; g.lineCap = 'round';
      g.lineWidth = 2.9 * u; g.beginPath(); g.moveTo(xs[0] - 5 * u, ey); g.quadraticCurveTo(xs[0], ey - 3 * u, xs[0] + 5 * u, ey); g.stroke();
      circle(xs[1], ey, 3.9 * u, ink);
      g.lineWidth = 2.3 * u;
      g.beginPath(); g.moveTo(xs[0] - 6 * u, ey - 7.5 * u); g.lineTo(xs[0] + 4 * u, ey - 5.6 * u); g.stroke();
      g.beginPath(); g.moveTo(xs[1] - 5 * u, ey - 10.5 * u); g.quadraticCurveTo(xs[1], ey - 13.5 * u, xs[1] + 5 * u, ey - 9.5 * u); g.stroke();
      return true;
    }
    case 'happy':
      g.strokeStyle = ink; g.lineWidth = 2.9 * u; g.lineCap = 'round';
      for (const x of xs) { g.beginPath(); g.moveTo(x - 4 * u, ey + 1 * u); g.quadraticCurveTo(x, ey - 5 * u, x + 4 * u, ey + 1 * u); g.stroke(); }
      return true;
    case 'dots':
      for (const x of xs) { circle(x, ey, 3.9 * u, ink); circle(x - 1.2 * u, ey - 1.4 * u, 1.1 * u, '#fff'); }
      browPair(); return true;
    default: return false;
  }
}

/** Freckles under the eyes (outside the eye transform). */
export function chFreckles(g: CanvasRenderingContext2D, cx: number, ex: number, ey: number, u: number): void {
  g.fillStyle = 'rgba(42,6,14,.38)';
  for (const s of [-1, 1]) for (const [dx, dy, r] of [[6, 8, 1.25], [2, 10, 1.2], [8.5, 11, 1.1]] as const) {
    g.beginPath(); g.arc(cx + s * (ex + dx * u), ey + dy * u, r * u * 1.15, 0, Math.PI * 2); g.fill();
  }
}

/** Draws the imp's mouth; false = not an imp mouth (moods), let face.ts draw it. */
export function chMouth(g: CanvasRenderingContext2D, kind: string, cx: number, my: number, u: number, ink: string, bits: number): boolean {
  const fangs = (bits & 1) !== 0;
  g.lineJoin = 'round'; g.lineCap = 'round'; g.strokeStyle = ink;
  const fang = (x: number, y: number, h = 4.8) => {
    g.beginPath(); g.moveTo(x - 2 * u, y); g.lineTo(x, y + h * u); g.lineTo(x + 2 * u, y); g.closePath();
    g.fillStyle = '#fff'; g.fill(); g.lineWidth = 1 * u; g.stroke();
  };
  switch (kind) {
    case 'open':   // "Хо-хо!": a deep half-moon, fangs at the corners
      g.beginPath(); g.moveTo(cx - 10 * u, my - 2 * u); g.quadraticCurveTo(cx, my + 12.5 * u, cx + 10 * u, my - 2 * u); g.closePath();
      g.fillStyle = '#5a0a14'; g.fill(); g.lineWidth = 2.5 * u; g.stroke();
      if (fangs) { fang(cx - 6 * u, my - 1.6 * u); fang(cx + 6 * u, my - 1.6 * u); }
      return true;
    case 'grin': {   // the crooked imp grin: wide, higher on one side, teeth showing
      g.beginPath(); g.moveTo(cx - 12 * u, my - 3 * u); g.quadraticCurveTo(cx, my + 1.5 * u, cx + 12 * u, my - 5.5 * u);
      g.quadraticCurveTo(cx + 6 * u, my + 9 * u, cx - 2 * u, my + 7 * u); g.quadraticCurveTo(cx - 9 * u, my + 6 * u, cx - 12 * u, my - 3 * u); g.closePath();
      g.fillStyle = '#fff'; g.fill(); g.lineWidth = 2.5 * u; g.stroke();
      if (fangs) {
        g.lineWidth = 1.2 * u;
        for (const x of [cx - 6 * u, cx + 3 * u]) { g.beginPath(); g.moveTo(x, my + 0.6 * u); g.lineTo(x + 2 * u, my + 4.4 * u); g.lineTo(x + 4 * u, my + 0.2 * u); g.stroke(); }
      }
      return true;
    }
    case 'tongue':   // a smile and a forked tongue hanging out
      g.beginPath(); g.moveTo(cx - 3 * u, my + 2 * u); g.quadraticCurveTo(cx - 0.5 * u, my + 10 * u, cx - 2 * u, my + 13.5 * u);
      g.lineTo(cx, my + 11 * u); g.lineTo(cx + 2.5 * u, my + 13.5 * u); g.quadraticCurveTo(cx + 1 * u, my + 10 * u, cx + 3 * u, my + 2 * u); g.closePath();
      g.fillStyle = '#ff4a6a'; g.fill(); g.lineWidth = 1.2 * u; g.stroke();
      g.lineWidth = 2.8 * u; g.beginPath(); g.moveTo(cx - 10 * u, my - 2 * u); g.quadraticCurveTo(cx, my + 8 * u, cx + 10 * u, my - 2 * u); g.stroke();
      return true;
    default: return false;
  }
}
