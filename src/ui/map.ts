/**
 * Карта: the full-screen city map (Menus 'map' tab) and the optional round HUD minimap.
 *
 * Base picture: the world's own top-down render when the host offers it — host extra
 *   `mapImage?(): Promise<{ url, width, height, x0, z0, x1, z1 }>` (metres; world.mapImage wired by main) —
 * otherwise a vector plan drawn here from store.layout at the true metre aspect (x px × 0.01, depth px × 0.02):
 * walkable streets (from layout.free), building blocks, the ledge with its stairs, the canal with bridges, props.
 * On top: building pins (icon + title, collision-avoiding labels, the rest on hover), «you» with a facing arrow,
 * other players as dots (store.walkers). Drag = pan, wheel = zoom, +/− buttons, double-click a street = walk there.
 * Pin → popover → «Идти сюда» → host extra `walkTo?(x, y)` (px) and the map closes.
 */
import type { CityLayout, Walker } from '../contracts';
import { type Ctx, h, extras } from './ctx';
import { esc } from './data';
import { readFavorites, writeFavorites, toggleFavorite } from '../collect/favorites';
import { toX, toZ, fromX, fromZ } from '../world/coords';
import { mapFeatures, fitView, zoomAt, clampView, placeLabels, faceToDeg, type MapFeatures, type View, type LabelIn } from './mapdata';
import { setHtml } from '../core/html';

export interface MapImageInfo { url: string; width: number; height: number; x0: number; z0: number; x1: number; z1: number }
interface Base { img: CanvasImageSource; x0: number; z0: number; x1: number; z1: number; kind: 'host' | 'vector' }

/* ================================================================== palette (canvas) */
const C = {
  bg: '#120d16', ground: '#1b141f', street: '#6b5662', street2: '#76606c', lower: '#5c4b5b', grid: '#00000014',
  block: '#7a4458', blockTop: '#94566c', blockLine: '#ffcf6a', soon: '#3a3240', ledge: '#2a1f2c', ledgeTop: '#a08088',
  stairs: '#b79c90', water: '#2f68a6', water2: '#86bdf0', bridge: '#94643e', bridge2: '#c08a58',
  lamp: '#ffd27a', bed: '#6aa152', bench: '#a8774c', decor: '#8b7a8f', statue: '#d2c8dc',
};
const PPM = 28;   // vector base resolution, canvas px per metre

/* ================================================================== source */

/** Base picture shared by the map tab and the minimap. Vector at once; the host's render replaces it when it arrives. */
export class MapSource {
  private c: Ctx;
  private base: Base | null = null;
  private feat: MapFeatures | null = null;
  private layout: CityLayout | null = null;
  private hostReq: Promise<void> | null = null;
  private subs = new Set<() => void>();
  constructor(c: Ctx) { this.c = c; }

  features(): MapFeatures | null { this.sync(); return this.feat; }
  get(): Base | null {
    this.sync();
    if (!this.hostReq && this.layout) this.requestHost();
    return this.base;
  }
  onChange(fn: () => void) { this.subs.add(fn); return () => this.subs.delete(fn); }
  /** Layout changed (another town / reconnect). */
  invalidate() { this.layout = null; this.base = null; this.feat = null; this.hostReq = null; this.emit(); }

  private sync() {
    const L = this.c.host.store.layout;
    if (L === this.layout && this.feat) return;
    this.layout = L; this.feat = null; this.base = null; this.hostReq = null;
    if (!L) return;
    try { this.feat = mapFeatures(L); this.base = vectorBase(L, this.feat); }
    catch (e) { console.warn('[legion-3d] map: vector plan failed', e); }
  }
  private requestHost() {
    const fn = extras(this.c.host).mapImage;
    const forL = this.layout;
    if (typeof fn !== 'function') { this.hostReq = Promise.resolve(); return; }
    this.hostReq = (async () => {
      try {
        const r = await fn.call(this.c.host);
        if (!r || !r.url || !(r.x1 > r.x0) || !(r.z1 > r.z0)) return;
        const img = new Image();
        img.decoding = 'async';
        img.src = r.url;
        await img.decode();
        if (forL !== this.layout) return;
        this.base = { img, x0: r.x0, z0: r.z0, x1: r.x1, z1: r.z1, kind: 'host' };
        this.emit();
      } catch (e) { console.warn('[legion-3d] map: host mapImage unavailable, using the vector plan', e); }
    })();
  }
  private emit() { for (const f of this.subs) { try { f(); } catch { /* */ } } }
}

/** Vector plan → canvas (once per layout). */
function vectorBase(L: CityLayout, F: MapFeatures): Base {
  const B = F.bounds, W = Math.ceil((B.x1 - B.x0) * PPM), H = Math.ceil((B.z1 - B.z0) * PPM);
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const g = cv.getContext('2d')!;
  const X = (x: number) => (x - B.x0) * PPM, Z = (z: number) => (z - B.z0) * PPM;
  const R = (r: { x0: number; z0: number; x1: number; z1: number }) => [X(r.x0), Z(r.z0), (r.x1 - r.x0) * PPM, (r.z1 - r.z0) * PPM] as const;
  g.fillStyle = C.ground; g.fillRect(0, 0, W, H);
  // walkable streets from the site's walk grid: horizontal runs of free cells (16 px)
  const A = L.area, step = 16, lowTop = L.low ? L.low.edge[1] : Infinity;
  for (let y = A.y0; y < A.y1; y += step) {
    let run = -1;
    g.fillStyle = y >= lowTop ? C.lower : C.street;
    for (let x = A.x0; x <= A.x1 + step; x += step) {
      const f = x <= A.x1 && safeFree(L, x + step / 2, y + step / 2);
      if (f && run < 0) run = x;
      else if (!f && run >= 0) { g.fillRect(X(toX(run)), Z(toZ(y)), (toX(x) - toX(run)) * PPM + 0.6, step * 0.02 * PPM + 0.6); run = -1; }
    }
  }
  // cobble hint: faint grid every metre
  g.strokeStyle = C.grid; g.lineWidth = 1; g.beginPath();
  for (let x = Math.ceil(B.x0 / 2) * 2; x < B.x1; x += 2) { g.moveTo(X(x), Z(0)); g.lineTo(X(x), Z(B.z1)); }
  for (let z = 0; z < B.z1; z += 2) { g.moveTo(0, Z(z)); g.lineTo(W, Z(z)); }
  g.stroke();
  // canal + bridges
  for (const r of F.water) { g.fillStyle = C.water; g.fillRect(...R(r)); g.fillStyle = C.water2; g.fillRect(X(r.x0), Z(r.z0) + 3, (r.x1 - r.x0) * PPM, 2); g.fillRect(X(r.x0), Z(r.z1) - 5, (r.x1 - r.x0) * PPM, 2); }
  for (const p of F.ponds) { g.fillStyle = C.water; g.beginPath(); g.ellipse(X(p.x), Z(p.z), p.rx * PPM, p.rz * PPM, 0, 0, Math.PI * 2); g.fill(); }
  for (const r of F.bridges) {
    g.fillStyle = C.bridge; g.fillRect(...R(r));
    g.fillStyle = C.bridge2; for (let x = r.x0 + 0.25; x < r.x1; x += 0.5) g.fillRect(X(x), Z(r.z0), 2, (r.z1 - r.z0) * PPM);
    g.fillStyle = '#00000055'; g.fillRect(X(r.x0), Z(r.z0), (r.x1 - r.x0) * PPM, 3); g.fillRect(X(r.x0), Z(r.z1) - 3, (r.x1 - r.x0) * PPM, 3);
  }
  // ledge walls + stairs
  for (const r of F.ledge) {
    const [x, y, w, hh] = R(r);
    const gr = g.createLinearGradient(0, y, 0, y + hh); gr.addColorStop(0, '#3a2c3c'); gr.addColorStop(1, '#140e17');
    g.fillStyle = gr; g.fillRect(x, y, w, hh); g.fillStyle = C.ledgeTop; g.fillRect(x, y, w, 3);
  }
  for (const r of F.stairs) {
    g.fillStyle = C.stairs; g.fillRect(...R(r));
    g.fillStyle = '#00000044'; for (let z = r.z0 + 0.18; z < r.z1; z += 0.22) g.fillRect(X(r.x0), Z(z), (r.x1 - r.x0) * PPM, 2);
  }
  // props
  for (const p of F.props) {
    g.fillStyle = (C as any)[p.kind] || C.decor;
    g.beginPath();
    if (p.kind === 'lamp') g.arc(X(p.x), Z(p.z), 3.2, 0, Math.PI * 2);
    else if (p.kind === 'bench') g.rect(X(p.x - p.rx), Z(p.z - p.rz), p.rx * 2 * PPM, p.rz * 2 * PPM);
    else g.ellipse(X(p.x), Z(p.z), Math.max(2.5, p.rx * PPM), Math.max(2.5, p.rz * PPM), 0, 0, Math.PI * 2);
    g.fill();
    if (p.kind === 'lamp') { g.fillStyle = '#ffd27a22'; g.beginPath(); g.arc(X(p.x), Z(p.z), 14, 0, Math.PI * 2); g.fill(); }
  }
  // building blocks (rounded, with a lighter roof inset and a gold rim)
  for (const b of F.blocks) {
    const [x, y, w, hh] = R(b);
    g.fillStyle = '#00000066'; rr(g, x + 3, y + 5, w, hh, 8); g.fill();
    g.fillStyle = b.soon ? C.soon : C.block; rr(g, x, y, w, hh, 8); g.fill();
    g.fillStyle = b.soon ? '#463b4a' : C.blockTop; rr(g, x + 6, y + 6, Math.max(0, w - 12), Math.max(0, hh - 14), 5); g.fill();
    g.strokeStyle = b.soon ? '#bfaab744' : '#ffcf6a88'; g.lineWidth = 2; rr(g, x + 1, y + 1, w - 2, hh - 2, 7); g.stroke();
  }
  // the back street's facade line
  g.fillStyle = '#ffcf6a33'; g.fillRect(X(B.x0 + 1), Z(0) - 1, (B.x1 - B.x0 - 2) * PPM, 2);
  return { img: cv, x0: B.x0, z0: B.z0, x1: B.x1, z1: B.z1, kind: 'vector' };
}
/** Letter-spaced uppercase map lettering (cached). */
const SPACED = new Map<string, string>();
function spaced(t: string) { let r = SPACED.get(t); if (!r) { r = t.toUpperCase().split('').join('\u200a'); SPACED.set(t, r); } return r; }
function safeFree(L: CityLayout, x: number, y: number) { try { return L.free(x, y); } catch { return false; } }
function rr(g: CanvasRenderingContext2D, x: number, y: number, w: number, hh: number, r: number) {
  g.beginPath(); if (typeof g.roundRect === 'function') g.roundRect(x, y, w, hh, Math.min(r, w / 2, hh / 2)); else g.rect(x, y, w, hh);
}

/* ================================================================== players */

function mePos(c: Ctx): { x: number; y: number; face: number } | null {
  const me = c.host.store.me;
  if (me) return { x: me.x, y: me.y, face: me.face };
  const p = extras(c.host).pos?.();
  return p ? { x: p[0], y: p[1], face: extras(c.host).yaw?.() ?? 0 } : null;
}

/* ================================================================== full map */

const PIN_R = 15;
/** Upper-street labels go up into the facade band (keeps the street clear), lower-street ones down. */
const SIDES_UP = ['t', 'b', 'r', 'l'] as const, SIDES_LOW = ['b', 't', 'r', 'l'] as const;

export class MapView {
  readonly el: HTMLElement;
  private c: Ctx; private src: MapSource;
  private cv: HTMLCanvasElement; private g: CanvasRenderingContext2D;
  private pinsEl: HTMLElement; private favEl: HTMLElement; private meEl: HTMLElement; private pop: HTMLElement; private zoomT: HTMLElement;
  private pinEls = new Map<string, HTMLElement>();
  private v: View = { k: 1, tx: 0, ty: 0 }; private fitK = 1; private fitted = false;
  private w = 0; private hh = 0; private dpr = 1;
  private sel: string | null = null;
  private drag: { id: number; x: number; y: number; tx: number; ty: number; moved: boolean } | null = null;
  private dotT = 0; private ro: ResizeObserver | null = null; private dirtyLabels = true;
  private unsub: () => void;
  private dotFn: (w: Walker) => void;

  constructor(c: Ctx, src: MapSource) {
    this.c = c; this.src = src;
    this.el = h('div', 'mapv');
    setHtml(this.el, `<canvas class="mapc"></canvas><div class="mpins"></div><div class="mme" aria-label="Ты"><i></i></div>
      <div class="mpop" hidden></div><div class="mfavs" aria-label="Избранные места"></div>
      <div class="mzoom"><button type="button" data-mz="in" aria-label="Приблизить">+</button><span class="mzt">100%</span><button type="button" data-mz="out" aria-label="Отдалить">−</button><button type="button" data-mz="fit" aria-label="Весь город" title="Весь город">⤢</button><button type="button" data-mz="me" aria-label="Где я" title="Где я">◎</button></div>`);
    this.cv = this.el.querySelector('canvas')!; this.g = this.cv.getContext('2d')!;
    this.pinsEl = this.el.querySelector('.mpins')!; this.favEl = this.el.querySelector('.mfavs')!; this.meEl = this.el.querySelector('.mme')!; this.pop = this.el.querySelector('.mpop')!;
    this.zoomT = this.el.querySelector('.mzt')!;
    this.unsub = src.onChange(() => { this.draw(); });
    const g = this.g;
    this.dotFn = (w: Walker) => {
      if (!(w.alpha > 0.05)) return;
      const sx = toX(w.x) * this.v.k + this.v.tx, sy = toZ(w.y) * this.v.k + this.v.ty;
      if (sx < -4 || sy < -4 || sx > this.w + 4 || sy > this.hh + 4) return;
      g.moveTo(sx + 3.2, sy); g.arc(sx, sy, 3.2, 0, 6.2832);
    };
    this.bind();
  }

  /** Called when the map page is (re)attached to the DOM. */
  attach(slot: HTMLElement) {
    if (this.el.parentElement !== slot) slot.appendChild(this.el);
    if (!this.ro && typeof ResizeObserver !== 'undefined') { this.ro = new ResizeObserver(() => this.resize()); this.ro.observe(this.el); }
    this.resize();
  }
  /** Map closed: forget the selection, keep the view (reopen where you left it, re-centred on you). */
  detach() { this.closePop(); this.drag = null; this.fitted = false; }

  private resize() {
    const k = this.c.scale || 1;
    const r = this.el.getBoundingClientRect();
    const w = Math.round(r.width / k), hh = Math.round(r.height / k);
    if (w < 40 || hh < 40) return;
    const dpr = Math.min(2, (window.devicePixelRatio || 1) * k);
    if (w !== this.w || hh !== this.hh || dpr !== this.dpr) {
      this.w = w; this.hh = hh; this.dpr = dpr;
      this.cv.width = Math.round(w * dpr); this.cv.height = Math.round(hh * dpr);
      this.cv.style.width = w + 'px'; this.cv.style.height = hh + 'px';
    }
    const F = this.src.features(); if (!F) { this.draw(); return; }
    const fv = fitView(F.bounds, w, hh, 18);
    this.fitK = fv.k;
    if (!this.fitted) {
      this.fitted = true; this.v = fv;
      // open the map at a readable zoom around the player when the whole city would be tiny
      const me = mePos(this.c);
      if (me && fv.k < 11) { const k = Math.min(22, fv.k * 1.8); this.v = { k, tx: w / 2 - toX(me.x) * k, ty: hh / 2 - toZ(me.y) * k }; clampView(this.v, F.bounds, w, hh, 160); }
    }
    this.dirtyLabels = true;
    this.draw();
  }

  /** Per frame while the map tab is open: walkers/me at ~6 Hz. */
  tick(dt: number) { this.dotT += dt; if (this.dotT > 0.16) { this.dotT = 0; this.draw(); } }

  private draw() {
    const g = this.g, F = this.src.features(), B = this.src.get();
    if (!this.w) return;
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    g.fillStyle = C.bg; g.fillRect(0, 0, this.w, this.hh);
    if (!F) { this.pinsEl.textContent = ''; this.meEl.hidden = true; return; }
    const v = this.v;
    if (B) {
      g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
      g.drawImage(B.img, B.x0 * v.k + v.tx, B.z0 * v.k + v.ty, (B.x1 - B.x0) * v.k, (B.z1 - B.z0) * v.k);
    }
    // district lettering (screen-size, so it reads at any zoom and over the host's render too)
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = `italic 700 ${Math.round(Math.max(11, Math.min(17, v.k * 0.62)))}px Comfortaa, Nunito, sans-serif`;
    g.fillStyle = 'rgba(247,234,223,.4)';
    for (const a of F.areas) { const t = spaced(a.name); g.fillText(t, a.x * v.k + v.tx, a.z * v.k + v.ty); }
    // other players
    g.beginPath(); this.c.host.store.walkers.forEach(this.dotFn);
    g.fillStyle = '#e9d8ff'; g.fill(); g.lineWidth = 1.2; g.strokeStyle = '#1d1620'; g.stroke();
    // me
    const me = mePos(this.c);
    if (me) {
      const sx = toX(me.x) * v.k + v.tx, sy = toZ(me.y) * v.k + v.ty;
      this.meEl.hidden = false;
      this.meEl.style.transform = `translate(${sx.toFixed(1)}px,${sy.toFixed(1)}px) rotate(${faceToDeg(me.face).toFixed(1)}deg)`;
    } else this.meEl.hidden = true;
    this.zoomT.textContent = Math.round(v.k / this.fitK * 100) + '%';
    this.layoutPins(F);
  }

  private layoutPins(F: MapFeatures) {
    const town = this.c.host.store.layout?.id || 'unknown';
    const fav = readFavorites(town, F.pins.map((p) => p.id));
    setHtml(this.favEl, fav.length ? '<b>★ Избранное</b>' + fav.map((id) => {
      const p = F.pins.find((x) => x.id === id)!;
      return '<button type="button" data-favgo="' + esc(id) + '">' + esc(p.icon) + ' ' + esc(p.title) + '</button>';
    }).join('') : '');
    const v = this.v;
    if (this.pinEls.size !== F.pins.length || !F.pins.every((p) => this.pinEls.has(p.id))) {
      this.pinsEl.textContent = ''; this.pinEls.clear();
      for (const p of F.pins) {
        const el = h('button', 'mpin' + (p.soon ? ' soon' : ''), `<span class="ic emo">${esc(p.icon)}</span><span class="lb">${esc(p.title)}</span>`);
        (el as HTMLButtonElement).type = 'button'; el.dataset.pin = p.id; el.setAttribute('aria-label', p.title);
        this.pinsEl.appendChild(el); this.pinEls.set(p.id, el);
      }
      this.dirtyLabels = true;
    }
    for (const p of F.pins) {
      const el = this.pinEls.get(p.id)!;
      el.style.transform = `translate(${(p.x * v.k + v.tx).toFixed(1)}px,${(p.z * v.k + v.ty).toFixed(1)}px)`;
      el.classList.toggle('sel', p.id === this.sel); el.classList.toggle('favorite', fav.includes(p.id));
    }
    if (this.dirtyLabels) {
      this.dirtyLabels = false;
      const items: LabelIn[] = F.pins.map((p) => {
        const lb = this.pinEls.get(p.id)!.querySelector('.lb') as HTMLElement;
        return { sx: p.x * v.k + v.tx, sy: p.z * v.k + v.ty, w: lb.offsetWidth || p.title.length * 7 + 16, h: lb.offsetHeight || 20, prio: (p.soon ? 0 : 10) + (p.id === this.sel ? 100 : 0) + (p.lower ? 1 : 2), pref: p.lower ? SIDES_LOW : SIDES_UP };
      });
      const out = placeLabels(items, PIN_R, this.w, this.hh, 3);
      F.pins.forEach((p, i) => {
        const el = this.pinEls.get(p.id)!, o = out[i], it = items[i];
        const lb = el.querySelector('.lb') as HTMLElement;
        el.classList.toggle('hidlab', !o.side);
        // label box relative to the pin centre (placeLabels may slide it along its side near the edges)
        const x = o.side ? o.x - it.sx : -it.w / 2, y = o.side ? o.y - it.sy : PIN_R + 3;
        lb.style.left = Math.round(x) + 'px'; lb.style.top = Math.round(y) + 'px';
      });
    }
    if (this.sel) this.placePop();
  }

  /* ---------------------------------------------------------------- interaction */
  private bind() {
    const el = this.el;
    el.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      const t = e.target as HTMLElement;
      if (t.closest('.mpin, .mpop, .mzoom, .mfavs')) return;
      this.drag = { id: e.pointerId, x: e.clientX, y: e.clientY, tx: this.v.tx, ty: this.v.ty, moved: false };
      try { el.setPointerCapture(e.pointerId); } catch { /* */ }
      el.classList.add('grab');
    });
    el.addEventListener('pointermove', (e) => {
      const d = this.drag; if (!d || e.pointerId !== d.id) return;
      const k = this.c.scale || 1, dx = (e.clientX - d.x) / k, dy = (e.clientY - d.y) / k;
      if (!d.moved && Math.abs(dx) + Math.abs(dy) < 4) return;
      d.moved = true;
      this.v.tx = d.tx + dx; this.v.ty = d.ty + dy;
      const F = this.src.features(); if (F) clampView(this.v, F.bounds, this.w, this.hh);
      this.dirtyLabels = true; this.draw();
    });
    const up = (e: PointerEvent) => {
      const d = this.drag; if (!d || e.pointerId !== d.id) return;
      this.drag = null; el.classList.remove('grab');
      if (!d.moved) this.closePop();
    };
    el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
    el.addEventListener('wheel', (e) => {
      e.preventDefault();
      const k = this.c.scale || 1, r = el.getBoundingClientRect();
      const n = (e.deltaMode === 1 ? 33 : e.deltaMode === 2 ? 600 : 1) * e.deltaY / 100;
      this.zoom(Math.exp(-n * 0.18), (e.clientX - r.left) / k, (e.clientY - r.top) / k);
    }, { passive: false });
    el.addEventListener('dblclick', (e) => {
      const t = e.target as HTMLElement;
      if (t.closest('.mpin, .mpop, .mzoom')) return;
      const k = this.c.scale || 1, r = el.getBoundingClientRect();
      const sx = (e.clientX - r.left) / k, sy = (e.clientY - r.top) / k;
      const x = fromX((sx - this.v.tx) / this.v.k), y = fromZ((sy - this.v.ty) / this.v.k);
      const L = this.c.host.store.layout;
      if (!L) return;
      const [nx, ny] = safeFree(L, x, y) ? [x, y] : L.nearest(x, y);
      if (Math.hypot((nx - x) * 0.01, (ny - y) * 0.02) > 1.5) { this.c.toast('Туда не пройти'); return; }
      this.walk(nx, ny, '');
    });
    el.addEventListener('click', (e) => {
      const t = e.target as HTMLElement;
      const z = t.closest<HTMLElement>('[data-mz]');
      if (z) {
        const m = z.dataset.mz!;
        if (m === 'in') this.zoom(1.4, this.w / 2, this.hh / 2);
        else if (m === 'out') this.zoom(1 / 1.4, this.w / 2, this.hh / 2);
        else if (m === 'fit') { const F = this.src.features(); if (F) { this.v = fitView(F.bounds, this.w, this.hh, 18); this.dirtyLabels = true; this.draw(); } }
        else if (m === 'me') this.centerMe();
        return;
      }
      const fg = t.closest<HTMLElement>('[data-favgo]'); if (fg) { this.select(fg.dataset.favgo!); return; }
      const star = t.closest<HTMLElement>('[data-fav]'); if (star) { this.toggleStar(star.dataset.fav!); return; }
      const pin = t.closest<HTMLElement>('.mpin');
      if (pin) { this.select(pin.dataset.pin!); return; }
      const go = t.closest<HTMLElement>('[data-go]');
      if (go && !go.hasAttribute('disabled')) {
        const F = this.src.features(); const p = F?.pins.find((x) => x.id === go.dataset.go);
        if (p) this.walk(p.door.x, p.door.y, p.title);
        return;
      }
      if (t.closest('[data-popx]')) this.closePop();
    });
  }
  private zoom(f: number, sx: number, sy: number) {
    const F = this.src.features(); if (!F) return;
    zoomAt(this.v, f, sx, sy, this.fitK * 0.8, Math.max(this.fitK * 8, 60));
    clampView(this.v, F.bounds, this.w, this.hh);
    this.dirtyLabels = true; this.draw();
  }
  centerMe() {
    const me = mePos(this.c), F = this.src.features(); if (!me || !F) return;
    const k = Math.max(this.v.k, this.fitK * 2.2);
    this.v = { k, tx: this.w / 2 - toX(me.x) * k, ty: this.hh / 2 - toZ(me.y) * k };
    clampView(this.v, F.bounds, this.w, this.hh); this.dirtyLabels = true; this.draw();
  }
  private toggleStar(id: string) {
    const F = this.src.features(), town = this.c.host.store.layout?.id; if (!F || !town) return;
    const ids = readFavorites(town, F.pins.map((p) => p.id));
    const next = toggleFavorite(ids, id);
    if (next.length === ids.length && !ids.includes(id)) { this.c.toast("Не больше пяти избранных мест"); return; }
    writeFavorites(town, next); this.sel = null; this.select(id);
  }
  private select(id: string) {
    this.sel = this.sel === id ? null : id;
    this.dirtyLabels = true;
    if (!this.sel) { this.closePop(); this.draw(); return; }
    const F = this.src.features(); const p = F?.pins.find((x) => x.id === id); if (!p) return;
    const me = mePos(this.c);
    const dist = me ? Math.round(Math.hypot(toX(me.x) - toX(p.door.x), toZ(me.y) - toZ(p.door.y))) : null;
    const town = this.c.host.store.layout?.id || 'unknown';
    const starred = readFavorites(town, F!.pins.map((x) => x.id)).includes(id);
    const canWalk = typeof extras(this.c.host).walkTo === 'function';
    const sub = p.soon ? 'Ещё строится — скоро откроется' : p.sub || (p.lower ? 'Нижняя улица' : 'Ярмарочная улица');
    setHtml(this.pop, `<button type="button" class="px" data-popx aria-label="Закрыть">✕</button><div class="pt"><span class="emo">${esc(p.icon)}</span><b>${esc(p.title)}</b></div>
      <div class="ps">${esc(sub)}${dist != null ? ` · <span class="mut">${dist < 1 ? 'ты здесь' : '~' + dist + ' м'}</span>` : ''}</div>
      <button type="button" class="btn ghost sm" data-fav="${esc(p.id)}" aria-pressed="${starred}">${starred ? "★ В избранном" : "☆ В избранное"}</button>
      ${canWalk ? `<button type="button" class="btn gold sm" data-go="${esc(p.id)}"${dist != null && dist < 1 ? ' disabled' : ''}>Идти сюда</button>` : `<p class="mut ph">Подойди сам — на карте нет автопути.</p>`}`);
    this.pop.hidden = false;
    this.draw();
  }
  private placePop() {
    const F = this.src.features(); const p = F?.pins.find((x) => x.id === this.sel); if (!p) return;
    const sx = p.x * this.v.k + this.v.tx, sy = p.z * this.v.k + this.v.ty;
    const pw = this.pop.offsetWidth || 220, ph = this.pop.offsetHeight || 110;
    let x = sx - pw / 2, y = sy + PIN_R + 30;
    if (y + ph > this.hh - 8) y = sy - PIN_R - 30 - ph;
    x = Math.max(8, Math.min(this.w - pw - 8, x)); y = Math.max(8, Math.min(this.hh - ph - 8, y));
    this.pop.style.transform = `translate(${Math.round(x)}px,${Math.round(y)}px)`;
  }
  private closePop() { if (this.sel) { this.sel = null; this.dirtyLabels = true; } this.pop.hidden = true; }
  private walk(x: number, y: number, title: string) {
    const fn = extras(this.c.host).walkTo;
    if (typeof fn !== 'function') { this.c.toast('Автопуть пока недоступен'); return; }
    try { fn.call(this.c.host, x, y); } catch (e) { console.warn('[legion-3d] walkTo', e); return; }
    this.closePop();
    this.c.open(null);
    this.c.toast(title ? `Идём: ${title}` : 'Идём');
  }
  dispose() { this.unsub(); this.ro?.disconnect(); }
}

/* ================================================================== minimap (HUD) */

const MINI = 148;          // CSS px
const MINI_M = 26;         // metres across

/** Round minimap in the HUD corner: player-centred, rotates with the camera (up = where you look). ~8 Hz, no allocations. */
export class MiniMap {
  readonly el: HTMLElement;
  private c: Ctx; private src: MapSource;
  private cv: HTMLCanvasElement; private g: CanvasRenderingContext2D; private nEl: HTMLElement;
  private t = 0; private dpr = 1; private on = false;
  private px = 0; private pz = 0; private ca = 1; private sa = 0; private k = MINI / MINI_M;
  private dotFn: (w: Walker) => void;
  constructor(c: Ctx, src: MapSource) {
    this.c = c; this.src = src;
    this.el = h('div', 'mini', `<canvas></canvas><i class="mn">С</i><i class="mme"></i>`);
    this.el.hidden = true;
    this.el.title = 'Карта (M)'; this.el.dataset.act = 'open'; this.el.dataset.m = 'map';
    this.cv = this.el.querySelector('canvas')!; this.g = this.cv.getContext('2d')!; this.nEl = this.el.querySelector('.mn')!;
    const g = this.g;
    this.dotFn = (w: Walker) => {
      if (!(w.alpha > 0.05)) return;
      const dx = (toX(w.x) - this.px) * this.k, dz = (toZ(w.y) - this.pz) * this.k;
      const sx = dx * this.ca - dz * this.sa, sy = dx * this.sa + dz * this.ca;
      if (sx * sx + sy * sy > (MINI / 2 - 4) ** 2) return;
      g.moveTo(MINI / 2 + sx + 2.6, MINI / 2 + sy); g.arc(MINI / 2 + sx, MINI / 2 + sy, 2.6, 0, 6.2832);
    };
  }
  setOn(on: boolean) {
    this.on = on; this.el.hidden = !on;
    if (on) { const d = Math.min(2, (window.devicePixelRatio || 1) * (this.c.scale || 1)); if (d !== this.dpr || !this.cv.width) { this.dpr = d; this.cv.width = this.cv.height = Math.round(MINI * d); } this.t = 1; }
  }
  update(dt: number) {
    if (!this.on) return;
    this.t += dt; if (this.t < 0.12) return; this.t = 0;
    const me = mePos(this.c), B = this.src.get(), g = this.g;
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    g.clearRect(0, 0, MINI, MINI);
    g.save();
    g.beginPath(); g.arc(MINI / 2, MINI / 2, MINI / 2 - 1, 0, 6.2832); g.clip();
    g.fillStyle = C.bg; g.fillRect(0, 0, MINI, MINI);
    if (me && B) {
      const yaw = extras(this.c.host).yaw?.() ?? me.face;
      this.px = toX(me.x); this.pz = toZ(me.y); this.ca = Math.cos(yaw); this.sa = Math.sin(yaw);
      g.translate(MINI / 2, MINI / 2); g.rotate(yaw); g.scale(this.k, this.k); g.translate(-this.px, -this.pz);
      g.drawImage(B.img, B.x0, B.z0, B.x1 - B.x0, B.z1 - B.z0);
      g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      g.beginPath(); this.c.host.store.walkers.forEach(this.dotFn); g.fillStyle = '#e9d8ff'; g.fill();
      // north marker on the rim: world −Z rotated by yaw
      const r = MINI / 2 - 11, ex = this.sa, ey = -this.ca;   // (0, −1) rotated by yaw
      this.nEl.style.transform = `translate(${(MINI / 2 + ex * r - 8).toFixed(1)}px,${(MINI / 2 + ey * r - 8).toFixed(1)}px)`;
    }
    g.restore();
  }
}
