// Page-side helper (string, evaluated in the page): window.__hitGrid() → hit signature of a 9×5 grid of viewport points.
// "CANVAS" = the 3D canvas is what a click would land on; anything else is one of our (or the page's) elements, piercing shadow roots.
export const hitGridSource = `(() => {
  const deep = (root, x, y) => {
    let el = root.elementFromPoint(x, y);
    while (el && el.shadowRoot) { const inner = el.shadowRoot.elementFromPoint(x, y); if (!inner || inner === el) break; el = inner; }
    return el;
  };
  const sig = (el) => {
    if (!el) return 'NONE';
    if (el.tagName === 'CANVAS') return 'CANVAS';
    const root = el.getRootNode();
    return el.tagName + '.' + String(el.className && el.className.baseVal !== undefined ? el.className.baseVal : el.className || '').trim().replace(/\\s+/g, '.') + '@' + (root.host ? root.host.className || root.host.tagName : 'doc');
  };
  window.__hitGrid = () => {
    const out = [], W = innerWidth, H = innerHeight;
    for (let j = 0; j < 5; j++) for (let i = 0; i < 9; i++) {
      const x = Math.round(W * (0.06 + 0.88 * i / 8)), y = Math.round(H * (0.08 + 0.84 * j / 4));
      out.push({ x, y, sig: sig(deep(document, x, y)) });
    }
    return out;
  };
})()`;
