/**
 * Director runtime (page side). The orchestrator (scripts/video/render.mjs):
 *   1. steps virtual time until window.__l3dGame exists, then calls __director.init(segmentId);
 *   2. keeps stepping until __director.status is 'ready' (or 'skip:…' / 'error:…');
 *   3. steps `preroll` frames (segment pose held at t = 0), calls __director.go(), then steps + captures every frame.
 * Each step the director hook (vt.hooks, before the game's rAF frame) calls segment.frame(G, t) with the
 * segment-local time t = frames since go() / FPS — so motion depends only on the frame number.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { type G, rateAt } from './kit';
import { SEGMENTS as PROMO, type Segment, FPS } from '../shots';
import { GAMEPLAY } from '../gameplay';
import { EDIT } from '../edit';
import { LORE } from '../lore';
import { EXPMOVIE } from '../expmovie';

const SEGMENTS: Segment[] = [...PROMO, ...GAMEPLAY, ...EDIT, ...LORE, ...EXPMOVIE];
import { setupDemo } from './demo';

type Status = 'idle' | 'setup' | 'ready' | string;

interface Director {
  status: Status;
  segments: { id: string; dur: number; xfade: number; title: string; test: boolean; page: string; cut: string; narr: unknown[]; win: [number, number] | null; rate: [number, number][] | null }[];
  /** virtual seconds of the first captured frame's step (audio zero) — set by go() */
  readonly t0: number;
  /** named moments of the current segment: [name, segment time s] */
  readonly marks: [string, number][];
  /** write a mark (segment time now; also into the audio capture log) */
  mark(name: string): void;
  /** the page of the segment has booted */
  booted(page: string): boolean;
  init(id: string): void;
  go(): void;
  /** frames since go() */
  readonly frame: number;
  /** ms of virtual (game) time the NEXT frame advances: 1000/FPS × the segment's rate at that output frame (slow-mo) */
  dt(): number;
  /** game seconds since go() (= output seconds unless the segment has rate keys) */
  readonly simT: number;
  /** skip rendering (resume fast-forward) */
  fast(on: boolean): void;
  info(): any;
}

declare global { interface Window { __director: Director; __l3dGame?: any; __demo?: any } }

(() => {
  let seg: Segment | null = null;
  let G: G | null = null;
  let started = -1;      // vt frame at go()
  let status: Status = 'idle';
  let fastOn = false, wrapped = false;
  let t0 = 0, simT = 0;
  const marks: [string, number][] = [];
  // Rendering may use Math.random (post noise, particles…). Give it its own stream, seeded per frame, so the
  // simulation's random sequence is the same whether frames are rendered or fast-forwarded (resume / --chunk).
  const wrapRender = () => {
    const r = (window.__l3dGame || (window as any).__showcase || (window as any).__exp)?.engine?.renderer; if (!r || wrapped) return;
    wrapped = true;
    const real = r.render.bind(r);
    let rs = 1, rf = -1;
    const rrnd = () => { rs = (rs + 0x6d2b79f5) >>> 0; let x = rs; x = Math.imul(x ^ (x >>> 15), x | 1); x ^= x + Math.imul(x ^ (x >>> 7), x | 61); return ((x ^ (x >>> 14)) >>> 0) / 4294967296; };
    r.render = (scene: unknown, camera: unknown) => {
      if (fastOn) return;
      if (rf !== vt.frame) { rf = vt.frame; rs = (vt.frame * 2654435761) >>> 0; }
      const sim = Math.random; Math.random = rrnd;
      try { real(scene, camera); } finally { Math.random = sim; }
    };
  };
  const vt = window.__vt;

  const d: Director = {
    get status() { return status; },
    set status(s) { status = s; },
    segments: SEGMENTS.map((s) => ({ id: s.id, dur: s.dur, xfade: s.xfade ?? 0, title: s.title, test: !!s.test, page: s.page || 'game', cut: s.cut || 'promo', narr: s.narr || [], win: s.win || null, rate: s.rate || null })),
    get t0() { return t0; },
    marks,
    mark(name) {
      const t = started < 0 ? -1 : (vt.frame - started - 1) / FPS;
      marks.push([name, +t.toFixed(4)]);
      const log = (window as any).__VT_AUDIO_LOG; if (Array.isArray(log)) log.push({ k: 'mark', t: +(vt.now / 1000).toFixed(4), name });
    },
    get frame() { return started < 0 ? -1 : vt.frame - started; },
    // slow-mo: the frame about to be stepped is output frame (vt.frame − started); before go() the rate is 1
    dt() { return started < 0 || !seg?.rate ? 1000 / FPS : (1000 / FPS) * rateAt(seg.rate, (vt.frame - started) / FPS); },
    get simT() { return simT; },
    init(id) {
      seg = SEGMENTS.find((s) => s.id === id) || null;
      if (!seg) { status = 'error:no segment ' + id; return; }
      const g = window.__l3dGame;
      G = g ? { g, ctx: g.ctx, rig: g.rig, ctl: g.player, input: g.ctx.input, store: g.store, ui: g.ui, demo: window.__demo, sc: null }
        : { g: null, ctx: null, rig: null, ctl: null, input: null, store: null, ui: null, demo: null, sc: (window as any).__showcase || (window as any).__exp };
      status = 'setup';
      // the boot took a machine-dependent number of frames: restart randomness and interval phases from here
      vt.seed(0x5eed + id.length); vt.realign();
      (async () => {
        try {
          if (g) setupDemo(G!);
          const why = seg!.requires ? seg!.requires(G!) : null;
          if (why) { status = 'skip:' + why; return; }
          await seg!.setup(G!);
          wrapRender();
          vt.seed(0xc0ffee + id.length); vt.realign();   // setup took a machine-dependent number of frames too
          resetSound(g);
          status = 'ready';
        } catch (e: any) { status = 'error:' + (e?.stack || e); }
      })();
    },
    go() { started = vt.frame; t0 = (vt.now + d.dt()) / 1000; simT = 0; },
    booted(page) {
      if (page === 'showcase') return !!(window as any).__showcase?.ready && document.fonts.status === 'loaded';
      if (page.startsWith('expedition')) return !!(window as any).__exp?.view && document.fonts.status === 'loaded';
      return !!(window.__l3dGame && window.__demo && document.fonts.status === 'loaded');
    },
    fast(on) { wrapRender(); fastOn = on; },
    info() {
      const g = window.__l3dGame; if (!g) return { st: status, f: d.frame };
      return { st: status, f: d.frame, me: [Math.round(g.player.x), Math.round(g.player.y)], units: g.player.units, mode: g.rig.mode,
        yaw: +g.rig.yaw.toFixed(3), q: g.engine.quality, stats: g.engine.stats(), room: g.rooms?.current ?? null, menu: g.ctx.state.menu };
    },
  };
  window.__director = d;

  /** The game's sound engine (if it started) gets the same RNG state and ambience timers on every run. */
  function resetSound(g: any): void {
    const e = g?.ctx?.dev?.sound; if (!e) return;
    try { e.rng.s = 0x51ed; e.gustT = 0; e.creakT = 30; e.meowT = 120; e.cds?.clear?.(); e.picker?.last?.clear?.(); } catch { /* */ }
  }

  vt.hooks.push(() => {
    if (!seg || !G || (status !== 'ready')) return;
    const f = started < 0 ? 0 : vt.frame - started - 1;   // first captured frame = t 0
    // with rate keys the choreography runs on game time (simT: the sum of the frames' scaled steps), else output time
    if (seg.rate && started >= 0) { if (f > 0) simT += rateAt(seg.rate, f / FPS) / FPS; } else simT = f / FPS;
    try { seg.frame(G, simT); } catch (e) { console.error('[director]', e); }
  });
})();
