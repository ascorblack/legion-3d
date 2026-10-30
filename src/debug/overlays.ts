/**
 * Debug overlays: the performance HUD (fps, frame ms graph, CPU ms, draw calls, triangles, quality level, GPU memory,
 * JS heap) and the collision overlay (the walk grid around the player — walkable / blocked / something to stand on —
 * plus the hit boxes of doors and interactables, the current target in yellow) and the wireframe switch.
 * Each is created on first use and costs nothing while off. Grid: 1 Points + 2 LineSegments draw calls, rebuilt only
 * when the player moved > 1.5 m (no per-frame allocations).
 */
import * as THREE from 'three';
import { fromX, fromZ, toX, toZ } from '../world/coords';
import { setHtml } from '../core/html';

/* ================================================================== perf HUD */
export interface PerfSource {
  stats(): { fps: number; ms: number; calls: number; tris: number; scale?: number };
  debug?(): { cpuMs?: number; level?: number; setting?: unknown; pixelRatio?: number; shadows?: boolean; post?: boolean };
  info?(): { geometries: number; textures: number };
  quality(): number;
}

const N = 150;
export class PerfHud {
  readonly el: HTMLDivElement;
  private canvas: HTMLCanvasElement;
  private g: CanvasRenderingContext2D | null;
  private text: HTMLDivElement;
  private buf = new Float32Array(N);
  private head = 0;
  private acc = 0;
  private worst = 0;
  constructor(parent: HTMLElement | ShadowRoot, private src: PerfSource) {
    this.el = document.createElement('div'); this.el.className = 'perf';
    this.canvas = document.createElement('canvas'); this.canvas.width = 344; this.canvas.height = 70;
    this.g = this.canvas.getContext('2d');
    this.text = document.createElement('div'); this.text.className = 'ptx';
    this.el.append(this.text, this.canvas);
    parent.appendChild(this.el);
  }
  /** Per frame: one sample (no allocation); redraw 5 times a second. */
  frame(dt: number): void {
    const ms = dt * 1000;
    this.buf[this.head] = ms; this.head = (this.head + 1) % N;
    if (ms > this.worst) this.worst = ms;
    this.acc += dt;
    if (this.acc < 0.2) return;
    this.acc = 0;
    this.draw();
  }
  private draw(): void {
    const s = this.src.stats(), d = this.src.debug?.() || {}, inf = this.src.info?.();
    const mem = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
    const lines = [
      `<b>${s.fps.toFixed(0)}</b> fps · ${s.ms.toFixed(1)} мс${d.cpuMs != null ? ` · CPU ${d.cpuMs} мс` : ''}`,
      `вызовов <b>${s.calls}</b> · треуг. <b>${fmtK(s.tris)}</b>`,
      `q${this.src.quality()}${d.setting != null ? ` (${String(d.setting)})` : ''}${s.scale != null ? ` · масштаб ${s.scale}` : ''}${d.pixelRatio != null ? ` · DPR ${d.pixelRatio}` : ''}${d.shadows != null ? ` · тени ${d.shadows ? 'да' : 'нет'}` : ''}${d.post != null ? ` · пост ${d.post ? 'да' : 'нет'}` : ''}`,
      `${inf ? `геом. ${inf.geometries} · текстур ${inf.textures}` : ''}${mem ? ` · JS ${(mem.usedJSHeapSize / 1048576).toFixed(0)} МБ` : ''} · худший ${this.worst.toFixed(0)} мс`,
    ];
    setHtml(this.text, lines.join('<br>'));
    this.worst *= 0.9;
    const g = this.g; if (!g) return;
    const W = this.canvas.width, H = this.canvas.height;
    g.clearRect(0, 0, W, H);
    // 16.7 / 33.3 ms guides
    g.fillStyle = 'rgba(255,255,255,.08)'; g.fillRect(0, H - (16.7 / 50) * H, W, 1); g.fillRect(0, H - (33.3 / 50) * H, W, 1);
    for (let i = 0; i < N; i++) {
      const v = this.buf[(this.head + i) % N];
      const h = Math.min(H, (v / 50) * H);
      g.fillStyle = v > 33.4 ? '#ff6b81' : v > 17.5 ? '#ffcf6a' : '#8fe39a';
      g.fillRect(i * (W / N), H - h, Math.ceil(W / N), h);
    }
  }
  dispose(): void { this.el.remove(); }
}
const fmtK = (n: number) => (n >= 1e6 ? (n / 1e6).toFixed(2) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(0) + 'k' : String(n));

/* ================================================================== collision / walk grid */
export interface GridSource {
  /** 'px' = city (free/solidTop/groundAt in site px), 'm' = a room / debug space in metres. */
  units(): 'px' | 'm';
  free(x: number, y: number): boolean;
  solidTop?(x: number, y: number): number;
  groundAt(x: number, y: number): number;
  /** Player feet (world metres). */
  feet(): { x: number; z: number };
  /** Hit boxes to outline (doors, interactables the world lists), world metres. */
  boxes(): THREE.Box3[];
  /** The current interaction target's box, or null. */
  target(): THREE.Box3 | null;
}

const R_X = 12, R_Z = 9;           // metres around the player
const STEP_X = 0.25, STEP_Z = 0.25;
const COLS = Math.ceil((R_X * 2) / STEP_X) + 1, ROWS = Math.ceil((R_Z * 2) / STEP_Z) + 1;
const C_FREE = new THREE.Color('#3dff8a'), C_BLOCK = new THREE.Color('#ff3050'), C_TOP = new THREE.Color('#ffb020');

export class GridOverlay {
  readonly root = new THREE.Group();
  private pts: THREE.Points;
  private pos = new Float32Array(COLS * ROWS * 3);
  private col = new Float32Array(COLS * ROWS * 3);
  private boxGeo = new THREE.BufferGeometry();
  private boxLines: THREE.LineSegments;
  private tgtLines: THREE.LineSegments;
  private tgtGeo = new THREE.BufferGeometry();
  private last = { x: Infinity, z: Infinity, n: -1 };
  private lastTgt: THREE.Box3 | null = null;
  private mats: THREE.Material[] = [];
  constructor(private src: GridSource) {
    this.root.name = 'debug:grid';
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    const pm = new THREE.PointsMaterial({ size: 0.11, sizeAttenuation: true, vertexColors: true, transparent: true, opacity: 0.95, depthWrite: false, toneMapped: false });
    this.pts = new THREE.Points(g, pm); this.pts.frustumCulled = false; this.pts.renderOrder = 30;
    const lm = new THREE.LineBasicMaterial({ color: '#4ad8ff', transparent: true, opacity: 0.9, depthTest: false });
    const tm = new THREE.LineBasicMaterial({ color: '#ffe14a', depthTest: false });
    this.mats.push(pm, lm, tm);
    this.boxLines = new THREE.LineSegments(this.boxGeo, lm); this.boxLines.frustumCulled = false; this.boxLines.renderOrder = 31;
    this.tgtLines = new THREE.LineSegments(this.tgtGeo, tm); this.tgtLines.frustumCulled = false; this.tgtLines.renderOrder = 32;
    this.root.add(this.pts, this.boxLines, this.tgtLines);
  }
  /** Points used now (tests). */
  count = 0;
  update(force = false): void {
    const f = this.src.feet();
    const moved = Math.hypot(f.x - this.last.x, f.z - this.last.z) > 1.5;
    if (moved || force) { this.last.x = f.x; this.last.z = f.z; this.rebuildGrid(f.x, f.z); this.rebuildBoxes(); }
    const t = this.src.target();
    if (t !== this.lastTgt || (t && force)) { this.lastTgt = t; setBoxes(this.tgtGeo, t ? [t] : []); }
  }
  private rebuildGrid(cx: number, cz: number): void {
    const s = this.src, px = s.units() === 'px';
    let n = 0;
    for (let r = 0; r < ROWS; r++) {
      const z = cz - R_Z + r * STEP_Z;
      for (let c = 0; c < COLS; c++) {
        const x = cx - R_X + c * STEP_X;
        const ax = px ? fromX(x) : x, ay = px ? fromZ(z) : z;
        let free = false, top = -Infinity, gy = 0;
        try { free = s.free(ax, ay); top = s.solidTop ? s.solidTop(ax, ay) : -Infinity; gy = s.groundAt(ax, ay); } catch { /* */ }
        if (!Number.isFinite(gy)) gy = 0;
        // skip far-from-anything blocked void (outside the map) to keep the picture readable
        if (!free && !Number.isFinite(top) && top !== Infinity && (c + r) % 2) continue;
        const C = Number.isFinite(top) ? C_TOP : free ? C_FREE : C_BLOCK;
        const y = (Number.isFinite(top) ? Math.max(gy, top) : gy) + 0.04;
        const i = n * 3;
        this.pos[i] = x; this.pos[i + 1] = y; this.pos[i + 2] = z;
        this.col[i] = C.r; this.col[i + 1] = C.g; this.col[i + 2] = C.b;
        n++;
      }
    }
    this.count = n;
    const g = this.pts.geometry;
    g.setDrawRange(0, n);
    (g.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    (g.getAttribute('color') as THREE.BufferAttribute).needsUpdate = true;
  }
  private rebuildBoxes(): void {
    const f = this.last;
    const near = this.src.boxes().filter((b) => b.min.x < f.x + 30 && b.max.x > f.x - 30);
    setBoxes(this.boxGeo, near.slice(0, 200));
  }
  dispose(): void {
    this.pts.geometry.dispose(); this.boxGeo.dispose(); this.tgtGeo.dispose();
    for (const m of this.mats) m.dispose();
    this.root.removeFromParent();
  }
}
/** Px-space helpers for callers that hold city px boxes. */
export const pxToM = { x: toX, z: toZ };

function setBoxes(g: THREE.BufferGeometry, boxes: THREE.Box3[]): void {
  const a = new Float32Array(boxes.length * 24 * 3);
  let i = 0;
  const v = (x: number, y: number, z: number) => { a[i++] = x; a[i++] = y; a[i++] = z; };
  for (const b of boxes) {
    const { min: m, max: M } = b;
    const c = [[m.x, m.y, m.z], [M.x, m.y, m.z], [M.x, m.y, M.z], [m.x, m.y, M.z], [m.x, M.y, m.z], [M.x, M.y, m.z], [M.x, M.y, M.z], [m.x, M.y, M.z]];
    for (const [p, q] of [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]]) { v(c[p][0], c[p][1], c[p][2]); v(c[q][0], c[q][1], c[q][2]); }
  }
  g.setAttribute('position', new THREE.BufferAttribute(a, 3));
  g.computeBoundingSphere();
}

/* ================================================================== wireframe */
export class Wireframe {
  private mat = new THREE.MeshBasicMaterial({ color: '#8affd8', wireframe: true });
  private prev: THREE.Material | null = null;
  on = false;
  constructor(private scene: THREE.Scene) {}
  set(on: boolean): void {
    if (on === this.on) return;
    this.on = on;
    if (on) { this.prev = this.scene.overrideMaterial; this.scene.overrideMaterial = this.mat; }
    else { this.scene.overrideMaterial = this.prev; this.prev = null; }
  }
  dispose(): void { this.set(false); this.mat.dispose(); }
}
