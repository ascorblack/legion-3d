/**
 * Renderer + frame loop + adaptive quality.
 *
 * Frame order expected from the integrator (all inside engine.onFrame callbacks, registered in this order):
 *   1. input      — read input.move / input.run, input.consumeLook() / consumeWheel(); write rig.yaw / rig.pitch
 *   2. controller — player.update(dt, input, rig.yaw)
 *   3. avatars    — place avatars at their px positions (incl. "me" from player.x/y/face)
 *   4. camera     — rig.follow(feet, EYE); rig.update(dt)   (AFTER the player moved: no camera/character jitter)
 *   5. labels, world.update(dt, t, camera)
 *   6. render     — done by the engine after all callbacks.
 */
import * as THREE from 'three';
import type { QualityLevel, Unsub } from '../contracts';
import type { CreateEngine, Engine } from '../contracts/modules';
import { PostChain, TONE_EXPOSURE, type PostOptions } from './post';
import { outlineCalls, outlineFrame } from './outline';
import { AutoGovernor, PRESETS, guessLevel, levelCapForGpu, loadSetting, saveSetting, type QualitySetting } from './quality';

/** WebGL 2 could not be created with any context attributes (GPU blocked, driver failure, hardware acceleration off). */
export class NoWebGLError extends Error {
  readonly code = 'no_webgl' as const;
  /** One line per failed attempt: attributes tried and the browser's message. */
  readonly attempts: string[];
  constructor(attempts: string[]) {
    super('WebGL 2 is not available: ' + (attempts[attempts.length - 1] || 'unknown error'));
    this.name = 'NoWebGLError';
    this.attempts = attempts;
  }
}

/**
 * Context attribute fallback chain. Some drivers (ANGLE on Mesa llvmpipe, blocklisted GPUs, a GPU process that just
 * crashed) refuse a high-performance / MSAA context but give a plain one. Every attempt uses a fresh canvas: a canvas
 * whose getContext() failed can stay poisoned. three r186 needs WebGL 2, so there is no WebGL 1 step.
 */
const CONTEXT_CHAIN: (msaa: boolean) => WebGLContextAttributes[] = (msaa) => [
  { antialias: msaa, powerPreference: 'high-performance', alpha: false, stencil: false, preserveDrawingBuffer: false },
  { antialias: false, powerPreference: 'high-performance', alpha: false, stencil: false, preserveDrawingBuffer: false },
  { antialias: false, powerPreference: 'default', alpha: false, stencil: false, depth: true, failIfMajorPerformanceCaveat: false },
  { antialias: false, powerPreference: 'low-power', alpha: true, stencil: false, depth: true, premultipliedAlpha: true, failIfMajorPerformanceCaveat: false },
];

function createRenderer(msaa: boolean): { renderer: THREE.WebGLRenderer; attempt: number } {
  const chain = CONTEXT_CHAIN(msaa);
  const errors: string[] = [];
  for (let i = 0; i < chain.length; i++) {
    const a = chain[i];
    // skip a duplicate of the first step when MSAA was not wanted anyway
    if (i === 1 && !msaa) continue;
    const canvas = document.createElement('canvas');
    let lastMsg = '';
    const onErr = (e: Event) => { lastMsg = (e as WebGLContextEvent).statusMessage || lastMsg; };
    canvas.addEventListener('webglcontextcreationerror', onErr);
    try {
      const r = new THREE.WebGLRenderer({ canvas, ...a });
      canvas.removeEventListener('webglcontextcreationerror', onErr);
      if (i > 0) console.warn('[l3d] WebGL context created with fallback attributes #' + i, a, errors);
      return { renderer: r, attempt: i };
    } catch (e) {
      canvas.removeEventListener('webglcontextcreationerror', onErr);
      const msg = (e as Error)?.message || String(e);
      errors.push('#' + i + ' ' + JSON.stringify(a) + ': ' + (lastMsg ? lastMsg + ' — ' : '') + msg);
    }
  }
  console.error('[l3d] WebGL unavailable', errors);
  throw new NoWebGLError(errors);
}

export const createEngine: CreateEngine = (opts) => {
  const host = opts.host;
  const setting0: QualitySetting = loadSetting(opts.quality ?? 'auto');
  const level0: QualityLevel = setting0 === 'auto' ? guessLevel() : setting0;

  const msaa = setting0 === 3 || (setting0 === 'auto' && level0 >= 3 && (window.devicePixelRatio || 1) < 1.75);
  const created = createRenderer(msaa);
  const renderer = created.renderer;
  const msaaOn = msaa && created.attempt === 0;   // post-processing MSAA only when the preferred context was granted
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.AgXToneMapping;
  renderer.toneMappingExposure = TONE_EXPOSURE;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.info.autoReset = false;   // reset once per frame: stats then cover every pass (shadows, post)

  const canvas = renderer.domElement;
  canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block;outline:none;touch-action:none';
  canvas.tabIndex = 0;
  canvas.setAttribute('aria-label', '3D-сцена');
  const hs = getComputedStyle(host);
  if (hs.position === 'static') host.style.position = 'fixed';
  if (!host.style.inset && host.style.position === 'fixed') { host.style.inset = '0'; }
  host.style.overflow = 'hidden';
  host.appendChild(canvas);

  /* ---------------------------------------------------------------- context loss */
  // three already calls preventDefault() on 'webglcontextlost' (so the browser may restore it) and re-initialises its
  // state on restore. We stop the loop meanwhile, rebuild the post chain afterwards and tell the UI.
  let lost = false;
  const lostFns: ((lost: boolean) => void)[] = [];
  const notifyLost = (on: boolean) => {
    for (const f of lostFns.slice()) { try { f(on); } catch (e) { console.error('[l3d] context-loss callback', e); } }
    try { window.dispatchEvent(new CustomEvent(on ? 'l3d:contextlost' : 'l3d:contextrestored')); } catch { /* */ }
  };
  const onLost = (e: Event) => {
    e.preventDefault();
    if (lost) return;
    lost = true;
    console.warn('[l3d] WebGL context lost');
    stop();
    notifyLost(true);
  };
  const onRestored = () => {
    if (!lost) return;
    lost = false;
    console.warn('[l3d] WebGL context restored');
    if (post) { try { post.dispose(); } catch { /* */ } post = null; }
    renderer.shadowMap.needsUpdate = true;
    applyLevel(level);
    start();
    notifyLost(false);
  };
  canvas.addEventListener('webglcontextlost', onLost, false);
  canvas.addEventListener('webglcontextrestored', onRestored, false);

  // GPU ceiling for auto
  let gpuCap: QualityLevel = 3;
  try {
    const gl = renderer.getContext();
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const s = ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : String(gl.getParameter(gl.RENDERER));
    gpuCap = levelCapForGpu(s);
  } catch { /* keep 3 */ }

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(75, 1, 0.05, 400);
  camera.rotation.order = 'YXZ';
  scene.add(camera);   // so camera children (view-model) render

  /* ---------------------------------------------------------------- quality */
  let setting: QualitySetting = setting0;
  const gov = new AutoGovernor(Math.min(level0, setting0 === 'auto' ? gpuCap : 3) as QualityLevel, gpuCap);
  let level: QualityLevel = setting === 'auto' ? gov.level : setting;
  // fixed level: the governor only scales the resolution (never changes the level the user picked)
  if (setting !== 'auto') { gov.locked = true; gov.level = level; }
  let scale = 1;
  const qualityFns: ((q: QualityLevel) => void)[] = [];

  /* ---------------------------------------------------------------- post-processing (q ≥ 2, lazy) */
  let post: PostChain | null = null;
  let postWanted = (() => { try { return localStorage.getItem('l3d.post') !== '0'; } catch { return true; } })();
  let postOpts: PostOptions = {};
  const postOn = () => postWanted && PRESETS[level].post;
  function syncPost(): void {
    if (postOn()) {
      if (!post) {
        try { post = new PostChain(renderer, scene, camera, msaaOn ? 4 : 0, postOpts); }
        catch (e) { console.warn('[l3d] post-processing unavailable', e); postWanted = false; post = null; return; }
      }
      post.setSize(w, h, renderer.getPixelRatio());
      post.setOptions({ ao: postOpts.ao ?? PRESETS[level].ao });   // contact AO at the top level (q3)
    }
  }

  let w = 1, h = 1;
  let sizeKey = '';
  /** Deferred resize work, applied at the start of the next frame (see frame()). */
  let pendingRes: 'scale' | 'level' | null = null;
  let pendingSize = false;
  function applySize(): void {
    w = Math.max(1, host.clientWidth || window.innerWidth);
    h = Math.max(1, host.clientHeight || window.innerHeight);
    const dpr = Math.min(window.devicePixelRatio || 1, PRESETS[level].pixelRatioCap);
    const pr = Math.max(0.25, dpr * scale);
    // setting canvas.width/height clears the drawing buffer even to the same value: skip no-op resizes (no blink)
    const key = w + 'x' + h + '@' + pr.toFixed(4) + (post && postOn() ? 'p' : '');
    if (key === sizeKey) return;
    sizeKey = key;
    renderer.setPixelRatio(pr);
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    if (post && postOn()) post.setSize(w, h, renderer.getPixelRatio());
  }
  /** Clamp shadow-map sizes of every casting light to the level's ceiling (lights are added by other modules). */
  let shadowSeen = -1;
  function clampShadows(): void {
    const cap = PRESETS[level].shadowMapSize;
    scene.traverse((o) => {
      const l = o as THREE.DirectionalLight;
      if (!l.isLight || !l.shadow || !l.shadow.mapSize) return;
      const ms = l.shadow.mapSize, u = l.userData;
      // the owner's requested size: whatever is there unless it is what we set last time
      if (u.l3dShadowSet !== ms.x || !u.l3dShadowWant) u.l3dShadowWant = Math.max(ms.x, ms.y);
      const s = Math.min(cap, u.l3dShadowWant as number);
      if (ms.x !== s || ms.y !== s) {
        ms.set(s, s);
        if (l.shadow.map) { l.shadow.map.dispose(); (l.shadow as { map: unknown }).map = null; }
      }
      u.l3dShadowSet = s;
    });
  }
  function applyLevel(prev: QualityLevel | -1): void {
    const sh = PRESETS[level].shadows;
    clampShadows(); shadowSeen = scene.children.length;
    if (renderer.shadowMap.enabled !== sh) {
      renderer.shadowMap.enabled = sh;
      renderer.shadowMap.needsUpdate = true;
      // materials must recompile to add/remove shadow sampling
      scene.traverse((o) => {
        const m = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(m)) for (const x of m) x.needsUpdate = true; else if (m) m.needsUpdate = true;
      });
    }
    applySize();
    syncPost();
    if (prev !== level) for (const f of qualityFns.slice()) f(level);
  }
  applyLevel(-1);

  /* ---------------------------------------------------------------- resize */
  // resizes are applied at the start of the next frame, before its render (never between render and paint)
  const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => { pendingSize = true; }) : null;
  ro?.observe(host);
  const onResize = () => { pendingSize = true; };
  window.addEventListener('resize', onResize);

  /* ---------------------------------------------------------------- loop */
  const frameFns: ((dt: number, t: number) => void)[] = [];
  let raf = 0;
  let paused = false;
  let hidden = typeof document !== 'undefined' && document.hidden;
  let last = 0;
  let t = 0;
  let fpsS = 60, msS = 16.7, cpuS = 0;
  let calls = 0, tris = 0;
  let cbS = 0, rdS = 0;   // EMA ms: frame callbacks (game logic) / renderer.render (CPU submit)
  let disposed = false;

  function frame(now: number): void {
    raf = 0;
    if (disposed || paused || hidden || lost) return;
    raf = requestAnimationFrame(frame);
    const nowS = now / 1000;
    let rawMs = last ? now - last : 16.7;
    last = now;
    if (rawMs < 0) rawMs = 0;
    const dt = Math.min(rawMs / 1000, 0.1);
    t += dt;
    // smoothed stats (EMA ~0.5 s)
    if (rawMs > 0 && rawMs < 250) {
      const k = 1 - Math.exp(-rawMs / 500);
      msS += (rawMs - msS) * k;
      fpsS = 1000 / msS;
    }
    if (pendingSize) { pendingSize = false; applySize(); }
    if (pendingRes) applyPendingRes();
    const c0 = performance.now();
    for (let i = 0; i < frameFns.length; i++) {
      try { frameFns[i](dt, t); } catch (e) { console.error('[l3d] frame callback failed', e); }
    }
    // new top-level objects (world rebuilt, lights added) → re-check shadow-map ceilings; O(1) otherwise
    if (shadowSeen !== scene.children.length) { shadowSeen = scene.children.length; if (renderer.shadowMap.enabled) clampShadows(); }
    const c1 = performance.now();
    renderer.info.reset();
    const usePost = !!post && postOn();
    outlineFrame(renderer, scene, camera, t, usePost);   // target outline: mask pass (post) or hull meshes (q0–1)
    if (usePost) post!.render(dt); else renderer.render(scene, camera);
    const c2 = performance.now();
    cpuS += (c2 - c0 - cpuS) * 0.1;
    cbS += (c1 - c0 - cbS) * 0.1;
    rdS += (c2 - c1 - rdS) * 0.1;
    calls = renderer.info.render.calls;
    tris = renderer.info.render.triangles;

    // dynamic resolution in every mode; level steps only in 'auto' (gov.locked otherwise)
    // Resizing the drawing buffer clears it: doing it here, after this frame's render, would let the browser show the
    // cleared (black) canvas for one frame — the "blink every 5–10 s". Apply on the next frame, before its render.
    const r = gov.sample(rawMs, nowS);
    if (r === 'level' || (r === 'scale' && pendingRes !== 'level')) pendingRes = r;
  }
  function applyPendingRes(): void {
    const r = pendingRes; pendingRes = null;
    if (r === 'scale') { if (Math.abs(gov.scale - scale) > 1e-3) { scale = gov.scale; applySize(); } }
    else if (r === 'level') { const p = level; level = gov.level; scale = gov.scale; applyLevel(p); }
  }
  function start(): void {
    if (raf || disposed || paused || hidden || lost) return;
    last = 0;
    gov.reset(performance.now() / 1000);
    raf = requestAnimationFrame(frame);
  }
  function stop(): void { if (raf) cancelAnimationFrame(raf); raf = 0; }
  const onVis = () => { hidden = document.hidden; if (hidden) stop(); else start(); };
  document.addEventListener('visibilitychange', onVis);
  start();

  const engine: Engine = {
    renderer, scene, camera, host,
    get quality() { return level; },
    setQuality(q) {
      setting = q;
      saveSetting(q);
      const prev = level;
      gov.scale = scale = 1;
      gov.reset(performance.now() / 1000);
      if (q === 'auto') {
        gov.locked = false;
        gov.level = Math.min(prev, gpuCap) as QualityLevel;
        level = gov.level;
      } else {
        gov.locked = true;
        gov.level = level = q;
      }
      applyLevel(prev);
    },
    onQuality(fn): Unsub {
      qualityFns.push(fn);
      return () => { const i = qualityFns.indexOf(fn); if (i >= 0) qualityFns.splice(i, 1); };
    },
    onFrame(fn): Unsub {
      frameFns.push(fn);
      return () => { const i = frameFns.indexOf(fn); if (i >= 0) frameFns.splice(i, 1); };
    },
    stats() {
      return { fps: Math.round(fpsS * 10) / 10, ms: Math.round(msS * 10) / 10, calls, tris, scale: Math.round(scale * 100) / 100 };
    },
    pause(on) { paused = on; if (on) stop(); else start(); },
    dispose() {
      disposed = true;
      stop();
      ro?.disconnect();
      window.removeEventListener('resize', onResize);
      document.removeEventListener('visibilitychange', onVis);
      canvas.removeEventListener('webglcontextlost', onLost);
      canvas.removeEventListener('webglcontextrestored', onRestored);
      frameFns.length = 0; qualityFns.length = 0; lostFns.length = 0;
      post?.dispose(); post = null;
      renderer.dispose();
      try { renderer.forceContextLoss(); } catch { /* */ }
      canvas.remove();
    },
  };
  // extras (not in the contract): post-processing switch / tuning; persisted on/off in localStorage 'l3d.post'
  (engine as Engine & { setPost?: (on: boolean | PostOptions) => void }).setPost = (on) => {
    if (typeof on === 'object') { postOpts = { ...postOpts, ...on }; post?.setOptions(on); postWanted = true; }
    else { postWanted = on; try { localStorage.setItem('l3d.post', on ? '1' : '0'); } catch { /* */ } }
    syncPost();
  };
  // extras (not in the contract): context loss notifications (also window events 'l3d:contextlost' / 'l3d:contextrestored')
  const ex = engine as Engine & { onContextLost?: (fn: (lost: boolean) => void) => Unsub; readonly contextLost?: boolean };
  ex.onContextLost = (fn) => { lostFns.push(fn); return () => { const i = lostFns.indexOf(fn); if (i >= 0) lostFns.splice(i, 1); }; };
  Object.defineProperty(engine, 'contextLost', { get: () => lost, enumerable: true });
  // extras for the debug overlay (not in the contract)
  (engine as Engine & { debug?: () => object }).debug = () => ({ setting, level, scale, pixelRatio: renderer.getPixelRatio(), gpuCap, cpuMs: Math.round(cpuS * 100) / 100, logicMs: Math.round(cbS * 100) / 100, submitMs: Math.round(rdS * 100) / 100, shadows: renderer.shadowMap.enabled, post: !!(post && postOn()), outlineCalls: outlineCalls() });
  return engine;
};
