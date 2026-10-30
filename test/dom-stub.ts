/** Test helper: a minimal DOM / 2D-canvas stub so buildCity, rooms, the mine and the expedition build in node (geometry only). */
export function stubDom(): void {
  const ctx = new Proxy({}, {
    get: (_t, k) => {
      if (k === 'getImageData' || k === 'createImageData') return (_x: number, _y?: number, w = 4, h = 4) => ({ data: new Uint8ClampedArray((w || 4) * (h || 4) * 4), width: w, height: h });
      if (k === 'createLinearGradient' || k === 'createRadialGradient' || k === 'createPattern') return () => ({ addColorStop() {} });
      if (k === 'measureText') return () => ({ width: 10, actualBoundingBoxAscent: 8, actualBoundingBoxDescent: 2 });
      if (k === 'canvas') return { width: 4, height: 4 };
      return () => {};
    },
    set: () => true,
  });
  class FakeEl {
    style: Record<string, string> = {}; dataset: Record<string, string> = {}; width = 0; height = 0; innerHTML = ''; textContent = ''; className = '';
    classList = { add() {}, remove() {}, toggle() {}, contains: () => false };
    children: unknown[] = [];
    getContext() { return ctx; }
    attachShadow() { return new FakeEl(); }
    appendChild(c: unknown) { return c; }
    append() {} prepend() {}
    remove() {} focus() {} setAttribute() {} getAttribute() { return null; } addEventListener() {} removeEventListener() {}
    querySelector() { return new FakeEl(); }
    querySelectorAll() { return []; }
    toDataURL() { return 'data:,'; }
    getBoundingClientRect() { return { left: 0, top: 0, width: 100, height: 100, right: 100, bottom: 100 }; }
  }
  const g = globalThis as any;
  g.document = { createElement: () => new FakeEl(), createElementNS: () => new FakeEl(), body: new FakeEl(), head: new FakeEl(), documentElement: new FakeEl(), pointerLockElement: null, exitPointerLock() {}, addEventListener() {}, removeEventListener() {}, fonts: null };
  g.window = Object.assign(g, { addEventListener() {}, removeEventListener() {}, devicePixelRatio: 1, innerWidth: 1280, innerHeight: 720, matchMedia: () => ({ matches: false, addEventListener() {} }) });
  g.localStorage = g.localStorage || { getItem: () => null, setItem() {}, removeItem() {} };
  g.OffscreenCanvas = undefined;
  g.Image = class { onload: any; src = ''; width = 4; height = 4; };
  g.requestAnimationFrame = () => 0;
}
