/**
 * Nameplates and chat bubbles: sprites with canvas textures, re-rendered only when their content changes.
 * Sizes are in world metres at a reference distance and grow slowly with distance so text stays readable.
 */
import * as THREE from 'three';
import type { Labels } from '../contracts/modules';
import type { Mood } from './face';

/** Bubble styles: the chat moods (src/social/mood.ts) plus 'aside' — a small non-chat reaction («ха-ха» of the crowd). */
export type BubbleStyle = Mood | 'aside';
interface StyleDef { fill: string; ink: string; edge: string; icon?: 'spark' | 'heart' | 'bang' | 'drop' | 'anger' | 'q' | 'ha'; burst?: boolean; dashed?: boolean }
export const BUBBLE_STYLES: Record<BubbleStyle, StyleDef> = {
  happy: { fill: '#fff3c4', ink: '#2b1d18', edge: '#c98a12', icon: 'spark' },
  laugh: { fill: '#ffe48a', ink: '#2b1d18', edge: '#b9700c', icon: 'ha' },
  surprised: { fill: '#e6f4ff', ink: '#1d2a4a', edge: '#2b5a8a', icon: 'bang', burst: true },
  puzzled: { fill: '#eef0ff', ink: '#1d2a4a', edge: '#5a5fa8', icon: 'q' },
  sad: { fill: '#dcecff', ink: '#1d2a4a', edge: '#4a72a8', icon: 'drop' },
  love: { fill: '#ffe0ea', ink: '#3a1420', edge: '#d0436c', icon: 'heart' },
  angry: { fill: '#ffe1d6', ink: '#3a1408', edge: '#c8452a', icon: 'anger', burst: true },
  aside: { fill: 'rgba(255,250,240,.88)', ink: '#5a4636', edge: '#8a6a52', dashed: true },
};

const FONT = `"Rubik", "Segoe UI", "Arial", sans-serif`;
const MAX_CHARS = 90;
const PLATE_FAR = 25, BUBBLE_FAR = 40;
const PX_PER_M = 220;   // canvas px per world metre at scale 1
const MAX_CAND = 64, MAX_PLATES = 20;
/** Plate atlas: 2 columns × 24 rows of cells at the plate canvas' own resolution (a box wider than a cell is squeezed). */
const COLS = 2, ROWS = 24, CELLS = COLS * ROWS, CELL_K = 1, CELL_W = 512, CELL_H = 96, ATLAS_W = CELL_W * COLS, ATLAS_H = CELL_H * ROWS;
// plate canvas: 96 px high, the visible box is 64 px high and starts 18 px above the canvas bottom
const PLATE_FH = 64 / 96, PLATE_FY0 = 18 / 96;
const PLATE_H = 64 / PX_PER_M, BUBBLE_H = PLATE_H * 0.9;
/** Does [x0,x1]×[y0,y1] overlap any of the first n rects by more than `tol` of its own area? */
function overlaps(R: Float32Array, n: number, x0: number, y0: number, x1: number, y1: number, tol: number): boolean {
  const area = Math.max(1e-9, (x1 - x0) * (y1 - y0));
  for (let i = 0; i < n; i++) {
    const ox = Math.min(x1, R[i * 4 + 2]) - Math.max(x0, R[i * 4]);
    if (ox <= 0) continue;
    const oy = Math.min(y1, R[i * 4 + 3]) - Math.max(y0, R[i * 4 + 1]);
    if (oy > 0 && ox * oy > area * tol) return true;
  }
  return false;
}

interface Entry {
  login: string;
  /** The plate is drawn into this entry's own canvas, then copied into a cell of the shared atlas (all plates = 1 draw). */
  plateKey: string; plateCanvas: HTMLCanvasElement; cell: number; dirty: boolean; plateBoxW: number; plateOp: number; plateY: number;
  plateW: number; plateH: number;
  bubble: THREE.Sprite | null; bubbleCanvas: HTMLCanvasElement | null; bubbleTex: THREE.CanvasTexture | null; bubbleMat: THREE.SpriteMaterial | null;
  bubbleKey: string; bubbleW: number; bubbleH: number;
  /** Temporary bubble style and until when (performance.now ms); '' = the plain bubble. */
  bubbleStyle: BubbleStyle | ''; styleUntil: number; drawnStyle: BubbleStyle | '';
  bubbleUntil: number; bubbleShown: number;   // ms timestamp; fade 0..1
  fade: number;
  me: boolean;
  plateFW: number; bubbleFW: number; bubbleFH: number;   // visible box fractions of the canvas
  // per-frame scratch (declutter)
  dist: number; depth: number; sx: number; sy: number; vis: number; bVis: number;
  pScale: number; pLift: number; bScale: number; bTop: number; lastScale: number; lastLift: number;
}

const measure = (() => { let c: CanvasRenderingContext2D | null = null; return () => (c ||= document.createElement('canvas').getContext('2d')!); })();

/** Word-wrap text (keeps long words by hard-splitting). */
export function wrapText(text: string, maxW: number, font: string, maxLines = 4): string[] {
  const g = measure(); g.font = font;
  const words = text.split(/\s+/).filter(Boolean), lines: string[] = [];
  let cur = '';
  const push = (s: string) => { lines.push(s); };
  for (let w of words) {
    while (g.measureText(w).width > maxW) {   // hard split very long words
      let i = w.length; while (i > 1 && g.measureText(w.slice(0, i)).width > maxW) i--;
      if (cur) { push(cur); cur = ''; }
      push(w.slice(0, i)); w = w.slice(i);
    }
    const next = cur ? cur + ' ' + w : w;
    if (g.measureText(next).width > maxW && cur) { push(cur); cur = w; } else cur = next;
  }
  if (cur) push(cur);
  if (lines.length > maxLines) { lines.length = maxLines; lines[maxLines - 1] = lines[maxLines - 1].replace(/.{0,2}$/, '') + '…'; }
  return lines;
}

export function clampText(text: string): string {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  return t.length > MAX_CHARS ? t.slice(0, MAX_CHARS - 1).trimEnd() + '…' : t;
}

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}

function newTex(c: HTMLCanvasElement) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true; t.anisotropy = 4;
  return t;
}

class LabelsImpl implements Labels {
  readonly root = new THREE.Group();
  private map = new Map<string, Entry>();
  private tmp = new THREE.Vector3();
  private camPos = new THREE.Vector3();
  private cand: Entry[] = [];
  private rects = new Float32Array(MAX_CAND * 2 * 4);
  private showMe = true;
  private plateFar = PLATE_FAR;
  private maxPlates = MAX_PLATES;
  private tanHalf = Math.tan((75 / 2) * Math.PI / 180);

  // nameplates: one atlas + one instanced billboard quad for all of them (bubbles stay sprites: they change often)
  private atlas: HTMLCanvasElement;
  private atlasTex: THREE.CanvasTexture;
  private plates: THREE.InstancedMesh;
  private aUv: THREE.InstancedBufferAttribute; private aOp: THREE.InstancedBufferAttribute; private aSz: THREE.InstancedBufferAttribute;
  private cells: (Entry | null)[] = new Array(CELLS).fill(null);
  private cellUse = new Float64Array(CELLS);
  private frame = 0;
  private pl: Entry[] = [];
  private m4 = new THREE.Matrix4();

  constructor() {
    this.root.name = 'labels';
    this.atlas = document.createElement('canvas'); this.atlas.width = ATLAS_W; this.atlas.height = ATLAS_H;
    this.atlasTex = newTex(this.atlas);
    const geo = new THREE.PlaneGeometry(1, 1); geo.translate(0, 0.5, 0);   // bottom-centre anchored, like the sprites were
    this.aUv = new THREE.InstancedBufferAttribute(new Float32Array(CELLS * 4), 4);
    this.aOp = new THREE.InstancedBufferAttribute(new Float32Array(CELLS), 1);
    this.aSz = new THREE.InstancedBufferAttribute(new Float32Array(CELLS * 2), 2);
    geo.setAttribute('aUv', this.aUv); geo.setAttribute('aOp', this.aOp); geo.setAttribute('aSz', this.aSz);
    const mat = new THREE.ShaderMaterial({
      uniforms: { map: { value: this.atlasTex } },
      vertexShader: /* glsl */`attribute vec4 aUv; attribute float aOp; attribute vec2 aSz; varying vec2 vUv; varying float vOp;
        void main() {
          vec4 mv = modelViewMatrix * vec4( instanceMatrix[3].xyz, 1.0 );
          mv.xy += position.xy * aSz;
          gl_Position = projectionMatrix * mv;
          vUv = aUv.xy + uv * aUv.zw; vOp = aOp;
        }`,
      fragmentShader: /* glsl */`uniform sampler2D map; varying vec2 vUv; varying float vOp;
        void main() {
          vec4 c = texture2D( map, vUv );
          gl_FragColor = vec4( c.rgb, c.a * vOp );
          if ( gl_FragColor.a < 0.004 ) discard;
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
      transparent: true, depthWrite: false, depthTest: true,
    });
    mat.name = 'labels-plates';
    this.plates = new THREE.InstancedMesh(geo, mat, CELLS);
    this.plates.name = 'labels:plates'; this.plates.count = 0; this.plates.frustumCulled = false; this.plates.renderOrder = 10;
    this.root.add(this.plates);
    for (let i = 0; i < MAX_CAND; i++) this.pl.push(null as unknown as Entry);
  }

  private entry(login: string): Entry {
    let e = this.map.get(login);
    if (e) return e;
    const plateCanvas = document.createElement('canvas'); plateCanvas.width = 512; plateCanvas.height = 96;
    e = { login, plateKey: '', plateCanvas, cell: -1, dirty: true, plateBoxW: 512, plateOp: 0, plateY: 0, plateW: 1, plateH: 0.2,
      bubble: null, bubbleCanvas: null, bubbleTex: null, bubbleMat: null, bubbleKey: '', bubbleW: 1, bubbleH: 0.3, bubbleStyle: '', styleUntil: 0, drawnStyle: '', bubbleUntil: 0, bubbleShown: 0, fade: 0,
      me: false, plateFW: 1, bubbleFW: 1, bubbleFH: 1,
      dist: 1e9, depth: 1, sx: 0, sy: 0, vis: 0, bVis: 0, pScale: 1, pLift: 0, bScale: 1, bTop: 0, lastScale: 1, lastLift: 0 };
    this.map.set(login, e);
    return e;
  }

  set(login: string, p: { name: string; level?: number; me?: boolean; color?: string; badge?: string }): void {
    const e = this.entry(login);
    const key = `${p.name}|${p.level ?? ''}|${p.me ? 1 : 0}|${p.color ?? ''}|${p.badge ?? ''}`;
    if (key === e.plateKey) return;
    e.plateKey = key;
    e.me = !!p.me;
    const c = e.plateCanvas, g = c.getContext('2d')!;
    const name = String(p.name || login).slice(0, 24), lv = p.level ? String(p.level) : '';
    const fN = `700 40px ${FONT}`, fL = `800 28px ${FONT}`, fB = `30px ${FONT}`;
    g.font = fN; const nw = g.measureText(name).width;
    g.font = fL; const lw = lv ? g.measureText(lv).width + 24 : 0;
    g.font = fB; const bw = p.badge ? g.measureText(p.badge).width + 8 : 0;
    const W = Math.min(1024, Math.ceil(nw + lw + bw + 40 + (lv ? 10 : 0))), H = 64;
    if (c.width < W) c.width = Math.min(1024, Math.max(W, c.width * 2));   // grows only
    g.clearRect(0, 0, c.width, c.height);
    const x0 = Math.round((c.width - W) / 2), y0 = 14;
    // pill: soft drop shadow, vertical gradient, a thin light rim on top (reads as a small enamel badge, not a flat box)
    g.save();
    g.shadowColor = 'rgba(6,4,18,.55)'; g.shadowBlur = 10; g.shadowOffsetY = 3;
    roundRect(g, x0, y0, W, H, 22);
    const bg = g.createLinearGradient(0, y0, 0, y0 + H);
    if (p.me) { bg.addColorStop(0, 'rgba(92,52,14,.86)'); bg.addColorStop(1, 'rgba(48,24,6,.86)'); }
    else { bg.addColorStop(0, 'rgba(44,36,92,.8)'); bg.addColorStop(1, 'rgba(18,14,42,.8)'); }
    g.fillStyle = bg; g.fill();
    g.restore();
    g.lineWidth = 2.5; g.strokeStyle = p.me ? 'rgba(255,205,96,.95)' : 'rgba(196,178,255,.42)'; roundRect(g, x0, y0, W, H, 22); g.stroke();
    g.lineWidth = 2; g.strokeStyle = 'rgba(255,255,255,.16)'; g.beginPath(); g.moveTo(x0 + 22, y0 + 4); g.lineTo(x0 + W - 22, y0 + 4); g.stroke();
    let x = x0 + 20;
    if (p.badge) { g.font = fB; g.textBaseline = 'middle'; g.fillStyle = '#fff'; g.fillText(p.badge, x, y0 + H / 2 + 1); x += bw; }
    g.font = fN; g.textBaseline = 'middle';
    g.lineWidth = 6; g.strokeStyle = 'rgba(10,8,24,.9)'; g.lineJoin = 'round'; g.strokeText(name, x, y0 + H / 2 + 1);
    g.fillStyle = p.color || (p.me ? '#ffd76a' : '#ffffff'); g.fillText(name, x, y0 + H / 2 + 1);
    x += nw + 10;
    if (lv) {
      g.font = fL;
      const lg = g.createLinearGradient(0, y0 + 14, 0, y0 + H - 14);
      if (p.me) { lg.addColorStop(0, '#ffe08a'); lg.addColorStop(1, '#f0a92a'); } else { lg.addColorStop(0, '#b9d2ff'); lg.addColorStop(1, '#7b9ef0'); }
      roundRect(g, x, y0 + 13, lw, H - 26, 13); g.fillStyle = lg; g.fill();
      g.lineWidth = 2; g.strokeStyle = 'rgba(15,12,40,.55)'; g.stroke();
      g.fillStyle = '#15122e'; g.textAlign = 'center'; g.fillText(lv, x + lw / 2, y0 + H / 2 + 1); g.textAlign = 'left';
    }
    e.dirty = true; e.plateBoxW = W;
    // world size: canvas px → metres (the plate quad maps the box's columns, the canvas' full height)
    e.plateW = c.width / PX_PER_M; e.plateH = c.height / PX_PER_M; e.plateFW = W / c.width;
  }

  bubble(login: string, text: string, ms: number): void {
    const e = this.entry(login);
    const t = clampText(text);
    if (!t) return;
    const now = performance.now();
    e.bubbleUntil = now + Math.max(1000, ms);
    const style = e.bubbleStyle && now < e.styleUntil ? e.bubbleStyle : '';
    if (t === e.bubbleKey && e.bubble && style === e.drawnStyle) return;
    e.bubbleKey = t;
    if (!e.bubble) {
      e.bubbleCanvas = document.createElement('canvas'); e.bubbleCanvas.width = 512; e.bubbleCanvas.height = 256;
      e.bubbleTex = newTex(e.bubbleCanvas);
      e.bubbleMat = new THREE.SpriteMaterial({ map: e.bubbleTex, transparent: true, depthWrite: false, depthTest: true, opacity: 0 });
      e.bubble = new THREE.Sprite(e.bubbleMat);
      e.bubble.center.set(0.5, 0); e.bubble.renderOrder = 11; e.bubble.visible = false;
      this.root.add(e.bubble);
      e.bubbleShown = 0;
    }
    this.drawBubble(e, style);
  }

  /**
   * Give the bubble of `login` a temporary style for `ms` (the next bubble() within that time is drawn with it too).
   * Re-renders the canvas twice (now and when it ends) — never per frame.
   */
  bubbleStyle(login: string, style: BubbleStyle, ms: number): void {
    const e = this.entry(login);
    e.bubbleStyle = style; e.styleUntil = performance.now() + Math.max(200, ms);
    if (e.bubble && e.bubbleKey && e.drawnStyle !== style) this.drawBubble(e, style);
  }

  private drawBubble(e: Entry, style: BubbleStyle | '') {
    e.drawnStyle = style;
    const sd = style ? BUBBLE_STYLES[style] : null;
    const c = e.bubbleCanvas!, g = c.getContext('2d')!;
    const aside = style === 'aside';
    const font = `${aside ? 'italic 600 30px' : '600 34px'} ${FONT}`, lh = aside ? 36 : 42, pad = aside ? 18 : 22, maxW = 400;
    const lines = wrapText(e.bubbleKey, maxW, font, 4);
    g.font = font;
    let tw = 0; for (const l of lines) tw = Math.max(tw, g.measureText(l).width);
    const W = Math.ceil(Math.max(90, tw + pad * 2)), Hb = lines.length * lh + pad * 1.4, tail = aside ? 14 : 22;
    g.clearRect(0, 0, c.width, c.height);
    const x0 = Math.round((c.width - W) / 2), y0 = Math.round(c.height - tail - Hb - 6);
    g.lineJoin = 'round';
    if (sd?.burst) {
      // a spiky «shout» outline around the box; the tail is drawn first and covered by the burst's fill
      const cx = c.width / 2, cy = y0 + Hb / 2, rx = W / 2 + 4, ry = Hb / 2 + 4, n = 22;
      g.beginPath(); g.moveTo(cx + 16, y0 + Hb - 6); g.lineTo(cx - 4, y0 + Hb + tail); g.lineTo(cx - 10, y0 + Hb - 6); g.closePath();
      g.fillStyle = sd.fill; g.fill(); g.lineWidth = 5; g.strokeStyle = sd.edge; g.stroke();
      g.beginPath();
      for (let i = 0; i < n * 2; i++) {
        const a = (i / (n * 2)) * Math.PI * 2, out = i % 2 === 1;
        const px = cx + Math.cos(a) * rx * (out ? 1.08 : 0.97), py = cy + Math.sin(a) * ry * (out ? 1.22 : 0.98);
        i ? g.lineTo(px, py) : g.moveTo(px, py);
      }
      g.closePath();
    } else {
      g.beginPath();
      const r = aside ? 30 : 26;
      g.moveTo(x0 + r, y0); g.arcTo(x0 + W, y0, x0 + W, y0 + Hb, r); g.arcTo(x0 + W, y0 + Hb, x0, y0 + Hb, r);
      g.lineTo(c.width / 2 + 16, y0 + Hb); g.lineTo(c.width / 2 - 4, y0 + Hb + tail); g.lineTo(c.width / 2 - 6, y0 + Hb);
      g.arcTo(x0, y0 + Hb, x0, y0, r); g.arcTo(x0, y0, x0 + W, y0, r); g.closePath();
    }
    g.fillStyle = sd?.fill ?? '#fffaf0'; g.fill();
    g.lineWidth = aside ? 3 : 5; g.strokeStyle = sd?.edge ?? '#2b1d18';
    if (sd?.dashed) g.setLineDash([10, 8]);
    g.stroke(); g.setLineDash([]);
    g.fillStyle = sd?.ink ?? '#2b1d18'; g.textBaseline = 'middle'; g.textAlign = 'center';
    lines.forEach((l, i) => g.fillText(l, c.width / 2, y0 + pad * 0.7 + lh * (i + 0.5)));
    g.textAlign = 'left';
    if (sd?.icon) drawIcon(g, sd.icon, Math.min(c.width - 28, x0 + W - 6), Math.max(28, y0 + 4), sd.edge);
    e.bubbleTex!.needsUpdate = true;
    e.bubbleW = c.width / PX_PER_M; e.bubbleH = c.height / PX_PER_M; e.bubbleFW = W / c.width; e.bubbleFH = (c.height - Math.max(0, y0 - (sd?.icon ? 20 : 0))) / c.height;
  }

  remove(login: string): void {
    const e = this.map.get(login);
    if (!e) return;
    if (e.cell >= 0) this.cells[e.cell] = null;
    if (e.bubble) { this.root.remove(e.bubble); e.bubbleTex!.dispose(); e.bubbleMat!.dispose(); }
    this.map.delete(login);
  }

  /**
   * Options: `showMe` — draw our own plate in third person (never in first person); `range` — plate distance
   * ('near' ≈ 10 m, 'all' ≈ 25 m); `max` — at most this many plates (nearest first).
   */
  configure(o: { showMe?: boolean; range?: 'all' | 'near'; max?: number }): void {
    if (o.showMe !== undefined) this.showMe = o.showMe;
    if (o.range) this.plateFar = o.range === 'near' ? 10 : PLATE_FAR;
    if (o.max) this.maxPlates = Math.max(1, Math.min(MAX_CAND, o.max | 0));
  }

  update(anchors: ReadonlyMap<string, THREE.Vector3>, camera: THREE.Camera, dt: number): void {
    const now = performance.now();
    camera.updateMatrixWorld();
    camera.getWorldPosition(this.camPos);
    const V = camera.matrixWorldInverse.elements, P = (camera as THREE.PerspectiveCamera).projectionMatrix.elements;
    const px = P[0], py = P[5];
    this.tanHalf = 1 / py;
    // pass 0: project every anchor, collect candidates (no allocations: entries carry their own scratch fields)
    let n = 0;
    const cand = this.cand;
    for (const e of this.map.values()) {
      e.vis = 0; e.bVis = 0;
      const a = anchors.get(e.login);
      if (!a || a.y < -100 || n >= MAX_CAND) { e.dist = 1e9; continue; }
      const dx = a.x - this.camPos.x, dy = a.y - this.camPos.y, dz = a.z - this.camPos.z;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      e.dist = dist;
      // view-space depth (camera looks down −Z)
      const vz = V[2] * a.x + V[6] * a.y + V[10] * a.z + V[14];
      if (vz > -0.2) continue;                               // behind / at the camera
      if (e.me && dist < 1.2) continue;                      // own labels: never in first person
      const vx = V[0] * a.x + V[4] * a.y + V[8] * a.z + V[12], vy = V[1] * a.x + V[5] * a.y + V[9] * a.z + V[13];
      e.sx = (px * vx) / -vz; e.sy = (py * vy) / -vz; e.depth = -vz;
      if (e.sx < -1.3 || e.sx > 1.3 || e.sy < -1.3 || e.sy > 1.4) continue;
      cand[n++] = e;
    }
    // nearest first (insertion sort: n ≤ ~40, no allocations); our own plate yields to everybody else
    for (let i = 1; i < n; i++) {
      const e = cand[i], k = e.me ? 1e6 + e.dist : e.dist;
      let j = i - 1;
      while (j >= 0 && (cand[j].me ? 1e6 + cand[j].dist : cand[j].dist) > k) { cand[j + 1] = cand[j]; j--; }
      cand[j + 1] = e;
    }
    // pass 1: bubbles (they win over plates), nearest first; a bubble hidden behind a nearer one waits
    const R = this.rects; let nr = 0;
    for (let i = 0; i < n; i++) {
      const e = cand[i];
      if (!e.bubble || now >= e.bubbleUntil || e.dist >= BUBBLE_FAR) continue;
      const s = this.scaleFor(e.depth, BUBBLE_H);
      const hw = (e.bubbleW * e.bubbleFW * s * px) / e.depth / 2, h = (e.bubbleH * e.bubbleFH * s * py) / e.depth;
      const x0 = e.sx - hw, x1 = e.sx + hw, y0 = e.sy, y1 = e.sy + h;
      if (overlaps(R, nr, x0, y0, x1, y1, 0.5)) continue;
      R[nr * 4] = x0; R[nr * 4 + 1] = y0; R[nr * 4 + 2] = x1; R[nr * 4 + 3] = y1; nr++;
      e.bVis = 1; e.bScale = s; e.bTop = e.bubbleH * e.bubbleFH * s;
    }
    // pass 2: plates, nearest first, skipped where they would cover a nearer label; at most maxPlates
    let shown = 0;
    for (let i = 0; i < n && shown < this.maxPlates; i++) {
      const e = cand[i];
      if (e.dist >= this.plateFar || (e.me && !this.showMe)) continue;
      const s = this.scaleFor(e.depth, PLATE_H) * (e.me ? 0.85 : 1);
      const lift = e.bVis ? e.bTop * 0.96 : 0;
      const hw = (e.plateW * e.plateFW * s * px) / e.depth / 2, h0 = (lift * py) / e.depth, h = (e.plateH * PLATE_FH * s * py) / e.depth;
      const y0 = e.sy + h0 + (e.plateH * PLATE_FY0 * s * py) / e.depth;
      const x0 = e.sx - hw, x1 = e.sx + hw, y1 = y0 + h;
      if (overlaps(R, nr, x0, y0, x1, y1, 0.12)) continue;
      if (nr < MAX_CAND * 2) { R[nr * 4] = x0; R[nr * 4 + 1] = y0; R[nr * 4 + 2] = x1; R[nr * 4 + 3] = y1; nr++; }
      e.vis = 1; e.pScale = s; e.pLift = lift; shown++;
    }
    // pass 3: apply (fade in/out smoothly; hidden plates fade out instead of popping)
    const kIn = Math.min(1, dt * 10), kOut = Math.min(1, dt * 7);
    const pl = this.pl; let np = 0;
    this.frame++;
    for (const e of this.map.values()) {
      const a = anchors.get(e.login);
      const far = this.plateFar;
      const df = e.dist < far - 6 ? 1 : Math.max(0, (far - e.dist) / 6);
      e.fade += ((e.vis ? 1 : 0) - e.fade) * (e.vis ? kIn : kOut);
      if (e.fade < 0.02 || !a) { e.plateOp = 0; e.fade = e.vis ? e.fade : 0; }
      else {
        if (e.vis) { e.lastScale = e.pScale; e.lastLift = e.pLift; }
        e.plateOp = e.fade * df * (e.me ? 0.85 : 1);
        e.plateY = a.y + e.lastLift;
        if (np < MAX_CAND) pl[np++] = e;
      }
      if (e.bubble) {
        const live = now < e.bubbleUntil;
        if (e.drawnStyle && now >= e.styleUntil) { e.bubbleStyle = ''; if (live) this.drawBubble(e, ''); else e.drawnStyle = ''; }
        e.bubbleShown += ((live && e.bVis ? 1 : 0) - e.bubbleShown) * Math.min(1, dt * (live && e.bVis ? 9 : 6));
        if ((e.bubbleShown < 0.02 && !(live && e.bVis)) || !a) { e.bubble.visible = false; continue; }
        const s = e.bVis ? e.bScale : e.bubble.scale.y / Math.max(1e-6, e.bubbleH);
        e.bubble.visible = true;
        e.bubble.scale.set(e.bubbleW * s, e.bubbleH * s, 1);
        e.bubble.position.set(a.x, a.y, a.z);
        e.bubbleMat!.opacity = e.bubbleShown * (e.dist > BUBBLE_FAR - 5 ? Math.max(0, (BUBBLE_FAR - e.dist) / 5) : 1);
        e.bubble.renderOrder = 60 + Math.max(0, 40 - Math.round(e.dist));
      }
    }
    this.writePlates(pl, np, anchors);
  }

  /** All shown plates → the instanced quad, far to near (blending order); cells assigned / redrawn on demand. */
  private writePlates(pl: Entry[], np: number, anchors: ReadonlyMap<string, THREE.Vector3>): void {
    for (let i = 1; i < np; i++) { const e = pl[i]; let j = i - 1; while (j >= 0 && pl[j].dist < e.dist) { pl[j + 1] = pl[j]; j--; } pl[j + 1] = e; }
    const m = this.plates, uvA = this.aUv, opA = this.aOp, szA = this.aSz;
    let n = 0, upload = false;
    for (let i = 0; i < np && n < CELLS; i++) {
      const e = pl[i], a = anchors.get(e.login)!;
      if (e.cell < 0 && !this.claim(e)) continue;
      this.cellUse[e.cell] = this.frame;
      if (e.dirty) { this.blit(e); upload = true; }
      const cw = Math.min(CELL_W, e.plateBoxW * CELL_K), cx = (e.cell % COLS) * CELL_W, cy = Math.floor(e.cell / COLS) * CELL_H;
      uvA.setXYZW(n, cx / ATLAS_W, 1 - (cy + CELL_H) / ATLAS_H, cw / ATLAS_W, CELL_H / ATLAS_H);
      opA.setX(n, e.plateOp);
      szA.setXY(n, (e.plateBoxW / PX_PER_M) * e.lastScale, e.plateH * e.lastScale);
      this.m4.makeTranslation(a.x, e.plateY, a.z); m.setMatrixAt(n, this.m4);
      n++;
    }
    m.count = n; m.visible = n > 0;
    if (n) { m.instanceMatrix.needsUpdate = true; uvA.needsUpdate = true; opA.needsUpdate = true; szA.needsUpdate = true; }
    if (upload) this.atlasTex.needsUpdate = true;
  }

  /** A free atlas cell for `e`, else the one used longest ago by a plate not shown this frame. */
  private claim(e: Entry): boolean {
    let best = -1, bestUse = Infinity;
    for (let i = 0; i < CELLS; i++) {
      const o = this.cells[i];
      if (!o) { best = i; break; }
      if (this.cellUse[i] < this.frame && this.cellUse[i] < bestUse) { best = i; bestUse = this.cellUse[i]; }
    }
    if (best < 0) return false;
    const o = this.cells[best]; if (o) { o.cell = -1; o.dirty = true; }
    this.cells[best] = e; e.cell = best; e.dirty = true;
    return true;
  }

  private blit(e: Entry): void {
    const g = this.atlas.getContext('2d')!, c = e.plateCanvas;
    const cx = (e.cell % COLS) * CELL_W, cy = Math.floor(e.cell / COLS) * CELL_H, bw = e.plateBoxW;
    const sx = Math.round((c.width - bw) / 2);   // the plate box (drawn centred in its canvas)
    g.clearRect(cx, cy, CELL_W, CELL_H);
    g.drawImage(c, sx, 0, bw, c.height, cx, cy, Math.min(CELL_W, bw * CELL_K), CELL_H);
    e.dirty = false;
  }

  /** World scale for a label so its on-screen height shrinks gently with distance (≈ d^-0.35) and stays legible. */
  private scaleFor(depth: number, refH: number): number {
    // target height as a fraction of the screen height (NDC units are 2 per screen)
    const frac = Math.max(0.022, Math.min(0.044, 0.042 * Math.pow(3 / Math.max(0.5, depth), 0.35)));
    // NDC height of 1 m at this depth = py / depth (py = 1/tan(fov/2)); keep the plate box at `frac`
    return (frac * 2 * depth * this.tanHalf) / refH;
  }

  dispose(): void {
    for (const k of [...this.map.keys()]) this.remove(k);
    this.plates.geometry.dispose(); (this.plates.material as THREE.Material).dispose(); this.plates.dispose(); this.atlasTex.dispose();
    this.root.removeFromParent();
  }
}

/** A tiny icon at the bubble's top-right corner (vector, no emoji fonts). */
function drawIcon(g: CanvasRenderingContext2D, kind: NonNullable<StyleDef['icon']>, x: number, y: number, col: string) {
  g.save(); g.translate(x, y); g.scale(1.3, 1.3); g.lineJoin = 'round'; g.lineCap = 'round';
  // badge disc
  g.beginPath(); g.arc(0, 0, 19, 0, Math.PI * 2); g.fillStyle = '#fff'; g.fill(); g.lineWidth = 3.5; g.strokeStyle = col; g.stroke();
  g.fillStyle = col; g.strokeStyle = col;
  switch (kind) {
    case 'heart':
      g.fillStyle = '#ff4f7b';
      g.beginPath(); g.moveTo(0, 10); g.bezierCurveTo(-17, -1, -8, -15, 0, -5); g.bezierCurveTo(8, -15, 17, -1, 0, 10); g.fill();
      break;
    case 'spark':
      g.fillStyle = '#ffb81c'; g.beginPath();
      for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2 - Math.PI / 2, r = i % 2 ? 5 : 13; i ? g.lineTo(Math.cos(a) * r, Math.sin(a) * r) : g.moveTo(Math.cos(a) * r, Math.sin(a) * r); }
      g.closePath(); g.fill();
      break;
    case 'bang': g.lineWidth = 5; g.beginPath(); g.moveTo(0, -11); g.lineTo(0, 3); g.stroke(); g.beginPath(); g.arc(0, 10, 3, 0, Math.PI * 2); g.fill(); break;
    case 'q':
      g.lineWidth = 4.5; g.beginPath(); g.arc(0, -4, 7, Math.PI * 1.1, Math.PI * 2.35); g.quadraticCurveTo(0, 0, 0, 4); g.stroke();
      g.beginPath(); g.arc(0, 11, 2.8, 0, Math.PI * 2); g.fill();
      break;
    case 'drop':
      g.fillStyle = '#5fb2ff'; g.beginPath(); g.moveTo(0, -12); g.quadraticCurveTo(11, 4, 0, 11); g.quadraticCurveTo(-11, 4, 0, -12); g.fill();
      break;
    case 'anger':
      g.strokeStyle = '#e0402a'; g.lineWidth = 4;
      for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) { g.beginPath(); g.moveTo(sx * 3, sy * 11); g.quadraticCurveTo(sx * 3, sy * 3, sx * 11, sy * 3); g.stroke(); }
      break;
    case 'ha':
      g.font = `900 19px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('ха', 0, 1);
      break;
  }
  g.restore();
}

/** Labels with the optional extras the integrator may use (configure, temporary bubble styles). */
export type LabelsEx = Labels & {
  configure(o: { showMe?: boolean; range?: 'all' | 'near'; max?: number }): void;
  bubbleStyle(login: string, style: BubbleStyle, ms: number): void;
};
export function createLabels(): LabelsEx { return new LabelsImpl(); }
