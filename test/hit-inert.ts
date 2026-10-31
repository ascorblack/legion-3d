/**
 * Test helper: "a closed overlay is inert". After any menu / panel / card closes, a click anywhere on the screen must land on
 * the 3D canvas (or on an element that was already there before it opened), never on a leftover veil — even while a CSS fade
 * is still pending (slow WebGL frames delay transitions). Works with any Document-like object, so it runs in a real browser
 * (e2e/overlay-inert.mjs ships the same grid in e2e/hit-grid.mjs) and against stubs in vitest.
 */
export interface HitDoc { elementFromPoint(x: number, y: number): HitEl | null }
export interface HitEl { tagName: string; className?: unknown; shadowRoot?: HitDoc | null }

/** Deepest element under the point, piercing open shadow roots (document.elementFromPoint stops at the host). */
export function deepHit(doc: HitDoc, x: number, y: number): HitEl | null {
  let el = doc.elementFromPoint(x, y);
  for (let i = 0; el && el.shadowRoot && i < 8; i++) {
    const inner = el.shadowRoot.elementFromPoint(x, y);
    if (!inner || inner === el) break;
    el = inner;
  }
  return el;
}

export const hitLabel = (el: HitEl | null): string => (el ? `${el.tagName}.${String(el.className ?? '').trim().replace(/\s+/g, '.')}` : 'NONE');

/** 9×5 grid of viewport points → what a click there would hit. */
export function hitGrid(doc: HitDoc, w = 1280, h = 720): { x: number; y: number; el: HitEl | null }[] {
  const out: { x: number; y: number; el: HitEl | null }[] = [];
  for (let j = 0; j < 5; j++) for (let i = 0; i < 9; i++) {
    const x = Math.round(w * (0.06 + 0.88 * i / 8)), y = Math.round(h * (0.08 + 0.84 * j / 4));
    out.push({ x, y, el: deepHit(doc, x, y) });
  }
  return out;
}

/** Points where the hit differs from `before` (a grid taken with everything closed). Empty array = inert. */
export function staleHits(doc: HitDoc, before: ReturnType<typeof hitGrid>, w = 1280, h = 720): string[] {
  const now = hitGrid(doc, w, h);
  return now.flatMap((p, i) => (p.el === before[i].el ? [] : [`(${p.x},${p.y}) ${hitLabel(p.el)} (was ${hitLabel(before[i].el)})`]));
}

/** Assert that the centre of the screen hits the canvas. */
export function centreIsCanvas(doc: HitDoc, canvas: HitEl, w = 1280, h = 720): boolean {
  return deepHit(doc, Math.round(w / 2), Math.round(h / 2)) === canvas;
}
