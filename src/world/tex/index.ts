/**
 * Procedural tileable textures (generated in the page, cached by key; nothing shipped, nothing downloaded).
 * Every kind returns { map, normalMap, roughnessMap (+ emissiveMap for lava) }: map sRGB, the others linear;
 * power-of-two DataTextures, mipmapped, RepeatWrapping, anisotropic. Colour maps come in the site's warm cartoon
 * palette by default; `neutral: true` gives a light greyscale version meant to be multiplied by vertex colours /
 * material colour (city batches, prop kit, rooms).
 *
 * Pipeline: a generator paints colour / height / element-id canvases (gen-*.ts), post.ts bakes cavity + joint AO, worn
 * edges, per-element tone and grain into the albedo and derives normal + roughness (+ element ids for the per-tile tint
 * of surface.ts). Sizes follow the quality level (setTexQuality): q0 ¼, q1 ½, q2 = the base size, q3 2× (hero kinds up
 * to 2048). Startup stays cheap: a texture bigger than the preview is first generated small (synchronously) and then
 * regenerated at full size in time-sliced background jobs (≤ SLICE_MS per tick) that swap the texture source in place.
 * Texel density targets per family: README.md in this folder.
 */
import * as THREE from 'three';
import { rng } from './noise';
import { post, phase, type PostCfg, type PostOut } from './post';
import { type Gen, type Paint, hex, css, grey, wrap } from './paint';
import * as B from './gen-built';
import * as O from './gen-organic';
import { waterHeight, lava } from './gen-fx';

export { rng } from './noise';

export type TexKind =
  | 'cobble' | 'brick' | 'plaster' | 'wood' | 'roofTiles' | 'slate' | 'stone' | 'canvas' | 'metal'
  | 'grass' | 'soil' | 'water' | 'glow' | 'rock'
  | 'planks' | 'thatch' | 'path' | 'moss' | 'iron' | 'basalt' | 'lava';

export interface TexOpts {
  /** Colours, meaning depends on the kind (see DEFAULTS). Missing entries fall back to defaults. */
  colors?: string[];
  /** Light greyscale version (for tinting with vertex colours). */
  neutral?: boolean;
  seed?: number;
  /** Base canvas size at quality 2 (power of two); scaled with the quality level. */
  size?: number;
  /** Normal map strength multiplier (default 1 = the kind's own). */
  bump?: number;
}

export interface TexSet {
  map: THREE.Texture;
  normalMap?: THREE.Texture;
  roughnessMap?: THREE.Texture;
  /** Lava: glowing cracks (use with emissive white × intensity). */
  emissiveMap?: THREE.Texture;
  kind: TexKind;
  /** roughnessMap carries element centres (R/B) + mask (A): per-element per-tile tint in surface.ts. */
  ids: boolean;
  /** Continuous pattern (no elements): safe for the 2-offset anti-tiling blend in surface.ts. */
  organic: boolean;
  /** Final size (after the background upgrade). */
  size: number;
}

/** Default colours per kind (CATS palette of the site). */
export const DEFAULTS: Record<TexKind, string[]> = {
  cobble: ['#c46a4c', '#b45a40', '#7a3426', '#e08a68'],       // stone, alt stone, mortar, highlight
  brick: ['#b85e48', '#a9503c', '#7a3426', '#d98a6a'],        // brick, alt, joint, highlight
  plaster: ['#f2d4a8', '#e6c08e', '#fff0d0'],                 // base, stain, light
  wood: ['#b07a50', '#8a5a38', '#5e3c24', '#d9a066'],         // plank, alt, gaps/grain, light
  planks: ['#b07a50', '#8a5a38', '#4e3220', '#d9a066'],
  roofTiles: ['#d0603e', '#b84e32', '#6e2a1c', '#f08a5e'],    // terracotta scalloped tiles
  slate: ['#7a4a8a', '#5f3a72', '#2e1d3a', '#a070b0'],        // purple slate shingles
  stone: ['#a59cb0', '#8e8698', '#4e4858', '#c8c0d2'],        // block, alt, joint, light
  canvas: ['#e0605a', '#f5e6d2'],                             // stripe A, stripe B
  metal: ['#3a3450', '#2a2440', '#6a6488'],                   // base, dark, highlight
  iron: ['#4a4458', '#24202e', '#8a84a0', '#8a4a2a'],         // plate, seam, highlight, rust
  grass: ['#5a9a4a', '#3e7436', '#7fbf5a'],
  soil: ['#6e4a2f', '#523522', '#8a6040'],
  path: ['#9a7a58', '#7a5c40', '#b8987a'],
  moss: ['#6a8a3a', '#4a6a2a', '#8aaa4a'],
  thatch: ['#d8b060', '#b88a40', '#5a4020', '#f0d080'],       // straw, alt, shadow, light
  water: ['#3a7bd5', '#2a5aa8', '#9fd8ff'],
  glow: ['#ffffff'],
  rock: ['#8a6a5a', '#a8887a', '#5e4638', '#c4a898'],         // base, light facet, crack/dark, highlight
  basalt: ['#3e3844', '#332d3a', '#16121a', '#6a6274'],       // column, alt, joint, light
  lava: ['#2a1a1c', '#3a2422', '#ff5a1a', '#ffd04a'],         // crust, crust alt, crack, hottest
};

const NEUTRAL: Partial<Record<TexKind, string[]>> = {
  cobble: ['#f2f2f2', '#dedede', '#8c8c8c', '#ffffff'],
  brick: ['#f0f0f0', '#dcdcdc', '#8a8a8a', '#ffffff'],
  plaster: ['#f4f4f4', '#e2e2e2', '#ffffff'],
  wood: ['#f0f0f0', '#d8d8d8', '#9a9a9a', '#ffffff'],
  planks: ['#f0f0f0', '#d8d8d8', '#8a8a8a', '#ffffff'],
  roofTiles: ['#f0f0f0', '#dadada', '#7a7a7a', '#ffffff'],
  slate: ['#f0f0f0', '#d6d6d6', '#7a7a7a', '#ffffff'],
  stone: ['#f0f0f0', '#dcdcdc', '#8e8e8e', '#ffffff'],
  canvas: ['#ffffff', '#e4e4e4'],
  metal: ['#e8e8e8', '#c8c8c8', '#ffffff'],
  iron: ['#e8e8e8', '#9a9a9a', '#ffffff', '#c0c0c0'],
  grass: ['#eeeeee', '#cfcfcf', '#ffffff'],
  soil: ['#eeeeee', '#cccccc', '#ffffff'],
  path: ['#eeeeee', '#cfcfcf', '#ffffff'],
  moss: ['#e6e6e6', '#cccccc', '#ffffff'],
  thatch: ['#f0f0f0', '#d8d8d8', '#8a8a8a', '#ffffff'],
  water: ['#ffffff', '#dddddd', '#ffffff'],
  rock: ['#e4e4e4', '#f4f4f4', '#8a8a8a', '#ffffff'],
  basalt: ['#d8d8d8', '#c8c8c8', '#7a7a7a', '#f4f4f4'],
};

/** Base size at quality 2 (the caller's `size` overrides it). */
const BASE: Record<TexKind, number> = {
  cobble: 512, brick: 512, plaster: 512, wood: 512, planks: 512, roofTiles: 512, slate: 512, stone: 512, canvas: 512,
  metal: 512, iron: 512, grass: 1024, soil: 512, path: 1024, moss: 512, thatch: 512, water: 512, glow: 128, rock: 512,
  basalt: 1024, lava: 512,
};
/** Kinds allowed 2048 at quality 3 (big, close, everywhere: the paving). */
const HERO = new Set<TexKind>(['cobble', 'grass', 'path']);
const Q_MUL = [0.25, 0.5, 1, 2];

type Cfg = PostCfg & { organic?: boolean };
const CFG: Record<Exclude<TexKind, 'glow'>, Cfg> = {
  cobble: { mode: 'dist', bevel: 0.018, profile: 'round', top: [0.7, 1], joint: 0.06, detail: 0.12, cavity: 0.18, jointAO: 0.1, wear: 0.08, grain: 0.02, elemVar: 0.1, rough: [0.78, 1], normal: 2, ids: true },
  brick: { mode: 'dist', bevel: 0.008, profile: 'chamfer', top: [0.8, 1], joint: 0.12, detail: 0.22, cavity: 0.4, jointAO: 0.32, wear: 0.18, grain: 0.04, elemVar: 0.12, rough: [0.82, 1], normal: 3, ids: true },
  stone: { mode: 'dist', bevel: 0.014, profile: 'round', top: [0.75, 1], joint: 0.08, detail: 0.4, cavity: 0.42, jointAO: 0.36, wear: 0.2, grain: 0.04, elemVar: 0.1, rough: [0.78, 1], normal: 2.3, ids: true },
  wood: { mode: 'dist', bevel: 0.01, profile: 'chamfer', top: [0.85, 1], joint: 0.05, detail: 0.38, cavity: 0.3, jointAO: 0.3, wear: 0.12, grain: 0.035, elemVar: 0.07, rough: [0.72, 1], normal: 2.2, ids: true },
  planks: { mode: 'dist', bevel: 0.008, profile: 'chamfer', top: [0.85, 1], joint: 0.05, detail: 0.38, cavity: 0.35, jointAO: 0.38, wear: 0.12, grain: 0.035, elemVar: 0.12, rough: [0.7, 1], normal: 2.2, ids: true },
  roofTiles: { mode: 'paint', smooth: 1, cavity: 0.4, grain: 0.04, elemVar: 0.1, rough: [0.6, 0.95], normal: 2.6, ids: true },
  slate: { mode: 'paint', smooth: 1, cavity: 0.4, grain: 0.04, elemVar: 0.1, rough: [0.55, 0.95], normal: 2.6, ids: true },
  iron: { mode: 'dist', bevel: 0.006, profile: 'chamfer', top: [0.9, 1], joint: 0.2, detail: 0.5, cavity: 0.35, jointAO: 0.3, wear: 0.15, grain: 0.03, elemVar: 0.05, rough: [0.45, 0.8], normal: 2, ids: true },
  basalt: { mode: 'dist', bevel: 0.01, profile: 'chamfer', top: [0.75, 1], joint: 0.05, detail: 0.35, cavity: 0.45, jointAO: 0.4, wear: 0.12, grain: 0.05, elemVar: 0.1, rough: [0.8, 1], normal: 3, ids: true },
  plaster: { mode: 'paint', smooth: 1, cavity: 0.3, grain: 0.03, rough: [0.88, 1], normal: 1.4, organic: true },
  rock: { mode: 'paint', smooth: 2, cavity: 0.45, grain: 0.05, rough: [0.75, 1], normal: 2, organic: true },
  grass: { mode: 'paint', smooth: 1, cavity: 0.5, grain: 0.04, rough: [0.8, 1], normal: 1.1, organic: true },
  soil: { mode: 'paint', smooth: 1, cavity: 0.45, grain: 0.05, rough: [0.85, 1], normal: 2, organic: true },
  path: { mode: 'paint', smooth: 1, cavity: 0.4, grain: 0.05, rough: [0.82, 1], normal: 2, organic: true },
  moss: { mode: 'paint', cavity: 0.5, grain: 0.04, rough: [0.9, 1], normal: 1.8, organic: true },
  thatch: { mode: 'paint', cavity: 0.45, grain: 0.04, rough: [0.85, 1], normal: 2.2 },
  canvas: { mode: 'paint', smooth: 1, cavity: 0.15, grain: 0.02, rough: [0.88, 1], normal: 1.2 },
  metal: { mode: 'paint', smooth: 1, cavity: 0.2, grain: 0.03, rough: [0.4, 0.75], normal: 1.4, organic: true },
  water: { mode: 'paint', cavity: 0, grain: 0, rough: [0.1, 0.2], normal: 2.5, organic: true },
  lava: { mode: 'paint', smooth: 1, cavity: 0.35, grain: 0.03, rough: [0.95, 0.5], normal: 1.6 },
};

const GEN: Partial<Record<TexKind, Gen>> = {
  cobble: B.cobble, brick: B.brick, stone: B.stone, wood: B.wood, planks: B.planks, roofTiles: B.roofTiles, slate: B.slate,
  iron: B.iron, basalt: B.basalt, plaster: O.plaster, rock: O.rock, grass: O.grass, soil: O.soil, path: O.path, moss: O.moss,
  thatch: O.thatch, canvas: O.canvas, metal: O.metal,
};

/** All kinds (for tests/demo). */
export const TEX_KINDS: TexKind[] = ['cobble', 'brick', 'plaster', 'wood', 'roofTiles', 'slate', 'stone', 'canvas', 'metal', 'grass', 'soil', 'water', 'glow', 'rock',
  'planks', 'thatch', 'path', 'moss', 'iron', 'basalt', 'lava'];

/* ------------------------------------------------------------------ quality, anisotropy, stats */

let Q = 2;
let ANISO = 4;
/** Texture resolution follows this level (0..3); call before the textures of a scene are requested. */
export function setTexQuality(q: number): void { Q = Math.max(0, Math.min(3, q | 0)); }
export function texQuality(): number { return Q; }

const cache = new Map<string, TexSet>();
const all = new Set<THREE.Texture>();
/** Clones that follow their original's background upgrade (cloneTex). */
const clones = new Map<THREE.Texture, THREE.Texture[]>();
const stats = { syncMs: 0, asyncMs: 0, maxSliceMs: 0, maxStepMs: 0, maxStep: '', jobs: 0, upgraded: 0, bytes: 0 };
/** Generation timings (ms) and bytes of texture data held. */
export function texStats(): typeof stats & { pending: number; textures: number } { return { ...stats, pending: queue.length, textures: all.size }; }

/** Set anisotropy for all cached and future textures (pass the renderer max at q ≥ 2). */
export function setTexAnisotropy(a: number): void {
  ANISO = Math.max(1, Math.min(16, a | 0));
  for (const t of all) { if (t.anisotropy !== ANISO) { t.anisotropy = ANISO; t.needsUpdate = true; } }
}

const DOM = typeof HTMLCanvasElement !== 'undefined';
const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
function pow2(n: number, max: number): number { let p = 16; while (p < n && p < max) p *= 2; return p; }

/** Texture size of a kind at a quality level (`req` = the caller's q2 base size). */
export function texSize(kind: TexKind, q: number, req?: number): number {
  const base = req ?? BASE[kind];
  if (kind === 'glow') return pow2(base, 1024);
  const max = q >= 3 && HERO.has(kind) ? 2048 : 1024;
  return pow2(Math.max(64, base * Q_MUL[Math.max(0, Math.min(3, q))]), max);
}
function sizeFor(kind: TexKind, req?: number): { S: number; base: number } {
  const base = req ?? BASE[kind];
  let S = texSize(kind, Q, req);
  if (!DOM && kind !== 'glow') S = Math.min(S, 32);   // node (tests): geometry only, keep it instant
  return { S, base };
}

/* ------------------------------------------------------------------ building one texture */

function canvas(w: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas'); c.width = w; c.height = w;
  return [c, c.getContext('2d', { willReadFrequently: true })!];
}
/**
 * Reused work canvases (creating a read-back canvas costs more than painting a preview): one pool for the synchronous
 * previews, one for the background job (jobs run one at a time, previews run to completion — never interleaved).
 */
const pools: Map<string, [HTMLCanvasElement, CanvasRenderingContext2D]>[] = [new Map(), new Map()];
function work(pool: number, slot: string, w: number): CanvasRenderingContext2D {
  const key = slot + w;
  let e = pools[pool].get(key);
  if (!e) pools[pool].set(key, (e = canvas(w)));
  const g = e[1];
  g.setTransform(1, 0, 0, 1, 0, 0); g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
  return g;
}

interface Bufs extends PostOut { emissive?: Uint8Array }

function* build(kind: TexKind, S: number, k: string[], seed: number, base: number, neutral: boolean, def: boolean, bump: number, lite = false, bg = false): Generator<void, Bufs> {
  const cfg: PostCfg = { ...CFG[kind as Exclude<TexKind, 'glow'>] };
  cfg.normal *= bump;
  // grounds and plaster keep the palette's mean colour (the art direction), the painting only adds structure
  const tk = hex(k[0]), tk1 = hex(k[1] ?? k[0]);
  if (kind === 'grass' || kind === 'moss') cfg.target = [(tk[0] + tk1[0]) / 2, (tk[1] + tk1[1]) / 2, (tk[2] + tk1[2]) / 2];
  else if (kind === 'soil' || kind === 'path' || kind === 'plaster') cfg.target = tk;
  else if (kind === 'cobble') { const m = hex(k[3] ?? k[0]); cfg.target = [tk[0] * 0.88 + m[0] * 0.12, tk[1] * 0.88 + m[1] * 0.12, tk[2] * 0.88 + m[2] * 0.12]; }
  const hs = S >= 1024 ? S / 2 : S;   // normal / roughness / ids at half resolution for the big tiles (memory; visually the same)
  const r = rng(seed * 7919 + kind.length * 131 + 17);
  const pal = k.map(hex);
  if (kind === 'lava') {
    const lv = yield* lava(S, pal, seed);
    const out: Bufs = yield* post(S, S, lv.c, lv.h, null, cfg, seed);
    out.emissive = lv.e;
    return out;
  }
  const pool = bg ? 1 : 0;
  phase.at = 'canvas'; const C = work(pool, 'c', S);
  yield;
  phase.at = 'paint';
  if (kind === 'water') {
    const gr = C.createLinearGradient(0, 0, S, S); gr.addColorStop(0, css(pal[0])); gr.addColorStop(0.5, css(pal[1])); gr.addColorStop(1, css(pal[0]));
    C.fillStyle = gr; C.fillRect(0, 0, S, S);
    C.strokeStyle = css(pal[2]); C.lineCap = 'round';
    const sc = S / 256;
    for (let i = 0; i < 26; i++) {
      const x = r() * S, y = r() * S, w = (16 + r() * 34) * sc;
      C.globalAlpha = 0.25 + r() * 0.3; C.lineWidth = (1.5 + r() * 2) * sc;
      wrap(S, x, y - 10 * sc, w, 20 * sc, (dx, dy) => { C.beginPath(); C.moveTo(x + dx, y + dy); C.quadraticCurveTo(x + dx + w / 2, y + dy - 7 * sc, x + dx + w, y + dy); C.stroke(); });
    }
    C.globalAlpha = 1;
    if (bg) C.getImageData(0, 0, 1, 1);
    yield; phase.at = 'read';
    const cd = yield* read(C, S);
    const wh = yield* waterHeight(hs, r);
    return yield* post(S, hs, cd, wh, null, cfg, seed);
  }
  const H = work(pool, 'h', hs), I = work(pool, 'i', hs);
  if (hs !== S) { H.scale(hs / S, hs / S); I.scale(hs / S, hs / S); }
  H.fillStyle = grey(0.5); H.fillRect(0, 0, S, S);
  I.fillStyle = '#000'; I.fillRect(0, 0, S, S);
  const p: Paint = { S, C, H, I, k: pal, r, base, neutral, def, lite };
  phase.at = 'paint';
  // canvas 2D defers drawing until a read: a 1-px read after every chunk keeps the rasterisation inside the slices
  const flush = bg && DOM;
  for (const g = GEN[kind]!(p); !g.next().done;) { if (flush) { C.getImageData(0, 0, 1, 1); H.getImageData(0, 0, 1, 1); I.getImageData(0, 0, 1, 1); } yield; }
  phase.at = 'read';
  const cd = yield* read(C, S), hd = yield* read(H, hs);
  const id = cfg.ids ? yield* read(I, hs) : null;
  yield;
  return yield* post(S, hs, cd, hd, id, cfg, seed);
}

/** Read a canvas back in row strips (a 1024² read is one long stall otherwise). */
function* read(g: CanvasRenderingContext2D, w: number): Generator<void, Uint8ClampedArray> {
  if (w <= 256) return g.getImageData(0, 0, w, w).data;
  const out = new Uint8ClampedArray(w * w * 4), strip = Math.max(32, (1 << 17) / w);
  for (let y = 0; y < w; y += strip) { out.set(g.getImageData(0, y, w, strip).data, y * w * 4); yield; }
  return out;
}

function run<T>(g: Generator<void, T>): T { for (;;) { const s = g.next(); if (s.done) return s.value; } }

function dataTex(data: Uint8Array, size: number, srgb: boolean): THREE.DataTexture {
  const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter;
  t.anisotropy = ANISO; t.needsUpdate = true;
  all.add(t);
  return t;
}

/** Swap a texture (and its tracked clones) to new pixel data of any size. */
function swap(t: THREE.Texture | undefined, data: Uint8Array | undefined, size: number): void {
  if (!t || !data) return;
  for (const x of [t, ...(clones.get(t) ?? [])]) {
    x.dispose();   // the GPU texture of the old size goes; the next render allocates the new one
    x.source = new THREE.TextureSource({ data, width: size, height: size });
    x.needsUpdate = true;
  }
}

/* ------------------------------------------------------------------ background scheduler */

const SLICE_MS = 6;
const PREVIEW_MAX = 256;
let epoch = 0;
interface Job { it: Generator<void, Bufs>; done: (b: Bufs) => void; epoch: number; label: string }
const queue: Job[] = [];
let pumping = false;
let waiters: (() => void)[] = [];

function pump(): void {
  const t0 = now();
  while (queue.length && now() - t0 < SLICE_MS) {
    const j = queue[0];
    if (j.epoch !== epoch) { queue.shift(); continue; }
    const a = now(), s = j.it.next(), d = now() - a;
    if (d > stats.maxStepMs) { stats.maxStepMs = d; stats.maxStep = j.label + ':' + phase.at; }
    if (s.done) { queue.shift(); j.done(s.value); stats.upgraded++; }
  }
  const dt = now() - t0;
  stats.asyncMs += dt; stats.maxSliceMs = Math.max(stats.maxSliceMs, dt);
  if (queue.length) setTimeout(pump, 0);
  else { pumping = false; const w = waiters; waiters = []; for (const f of w) f(); }
}
function enqueue(j: Job): void {
  queue.push(j);
  if (!pumping) { pumping = true; setTimeout(pump, 0); }
}
/** Resolves when every background upgrade has finished (shots, tests). */
export function whenTexturesReady(): Promise<void> {
  return queue.length ? new Promise((res) => waiters.push(res)) : Promise.resolve();
}

/* ------------------------------------------------------------------ public */

function glow(S: number): THREE.CanvasTexture {
  const [c, g] = canvas(S);
  const gr = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.15, 'rgba(255,255,255,.8)');
  gr.addColorStop(0.4, 'rgba(255,255,255,.22)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, S, S);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter;
  all.add(t);
  return t;
}

/** Cached procedural texture set. Key = kind + options + the size of the current quality level. */
export function getTexture(kind: TexKind, opts: TexOpts = {}): TexSet {
  const { S, base } = sizeFor(kind, opts.size);
  const defK = opts.neutral ? (NEUTRAL[kind] ?? DEFAULTS[kind]) : DEFAULTS[kind];
  const k = defK.map((c, i) => opts.colors?.[i] ?? c);
  const seed = opts.seed ?? 1, bump = opts.bump ?? 1;
  const key = `${kind}|${k.join(',')}|${seed}|${S}|${bump}|${base}`;
  const hit = cache.get(key); if (hit) return hit;
  const t0 = now();
  let set: TexSet;
  if (kind === 'glow') set = { map: glow(S), kind, ids: false, organic: false, size: S };
  else {
    const cfg = CFG[kind];
    const def = !opts.neutral && !opts.colors;
    const pre = DOM && S > PREVIEW_MAX ? Math.max(64, Math.min(PREVIEW_MAX, S / 4)) : S;
    const b = run(build(kind, pre, k, seed, base, !!opts.neutral, def, bump, pre < S));
    set = {
      map: dataTex(b.map, b.S, true), normalMap: dataTex(b.normal, b.hs, false), roughnessMap: dataTex(b.rough, b.hs, false),
      kind, ids: !!cfg.ids, organic: !!cfg.organic, size: S,
    };
    if (b.emissive) set.emissiveMap = dataTex(b.emissive, b.S, true);
    stats.bytes += b.map.length + b.normal.length + b.rough.length + (b.emissive?.length ?? 0);
    if (pre < S) {
      stats.jobs++;
      const s = set;
      enqueue({
        it: build(kind, S, k, seed, base, !!opts.neutral, def, bump, false, true), epoch, label: `${kind}@${S}`,
        done: (f) => {
          stats.bytes += f.map.length + f.normal.length + f.rough.length - b.map.length - b.normal.length - b.rough.length;
          swap(s.map, f.map, f.S); swap(s.normalMap, f.normal, f.hs); swap(s.roughnessMap, f.rough, f.hs); swap(s.emissiveMap, f.emissive, f.S);
        },
      });
    }
  }
  stats.syncMs += now() - t0;
  cache.set(key, set);
  return set;
}

/** A clone (own offset / repeat) that follows the original through its background upgrade. */
export function cloneTex<T extends THREE.Texture>(t: T): T {
  const c = t.clone() as T; c.needsUpdate = true;
  let a = clones.get(t); if (!a) clones.set(t, (a = []));
  a.push(c); all.add(c);
  return c;
}

/** Dispose every cached texture and drop pending upgrades. */
export function disposeTextures(): void {
  epoch++; queue.length = 0; pools[0].clear(); pools[1].clear();
  for (const t of all) t.dispose();
  all.clear(); cache.clear(); clones.clear();
  stats.bytes = 0;
  const w = waiters; waiters = []; for (const f of w) f();
}
