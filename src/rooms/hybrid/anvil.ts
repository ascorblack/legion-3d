/**
 * The anvil (enchanting): the smith's hammer is driven by the site's REAL enchant run.
 *
 * The site's hero tab (app.js, forge window) calls, on its own page:
 *   window.LGCity.forgeStart(item, targetLevel)   — /api/enchant accepted: the smith starts striking (2–5 blows)
 *   window.LGCity.forgeFx(x)                      — the result came from the game: x.out = 'up' | 'broken' | 'down' | …
 *   window.LGCity.forgeCancel()                   — the order was cancelled / the result got lost
 * While the anvil room is open, hookSiteForge() wraps those three functions (the site's own 2D animation still runs:
 * the original is always called first) and feeds them to AnvilFx; dispose restores the originals.
 *
 * AnvilFx (3D): the item appears on the anvil, the smith swings once per beat (same rhythm as the site: 2–5 blows by
 * level, 0.62 s apart), every blow throws sparks, flashes the hearth light and makes the item glow brighter; then the
 * result: success → golden burst + rising sparkles + «+N»; broken → grey smoke puff, the item vanishes; failed / saved
 * by a sphere → a blue-grey puff with «Цела» / «−1». Idle: the smith taps the anvil now and then with small sparks.
 * Site 03.11 (b-forge.js v3, hero.av: anvil + «Усилитель» cells): the site no longer strikes while the order is on the way;
 * after the result it plays its own scene (in → boost → heat / rise → hit1…3 → quench → tense → r-<out>, «Пропустить»),
 * exposed as LGCity.anvil.ani() = { on, kind, step }. With that window open AnvilFx waits instead of striking, then
 * follows the site's steps (a blow per hitN — a magic pulse for kind 'magic', the result at r-* or when it is skipped).
 * No allocations per frame (fixed particle pools). Sprites and particle systems stay `visible` (opacity 0 / parked
 * below the floor) so their shaders compile with the room, not with the first blow (no hitch mid-animation).
 */
import * as THREE from 'three';
import { glowTexture } from '../../world/textures';
import type { Npc } from '../common/npc';
import { itemObject } from '../common/items';
import type { StockItem } from '../common/stock';
import type { ItemModelFactory, Registry } from '../../contracts/ext';

/** The enchant result the site passes to forgeFx (results[].x of /api/enchant). */
export interface ForgeResult { op?: string; out?: 'up' | 'broken' | 'down' | string; to?: number; from?: number; target?: number; item?: string; uid?: string }
export interface ForgeSink { start(it: unknown, tg: number): void; fx(x: ForgeResult): void; cancel(): void }

const KEYS = ['forgeStart', 'forgeFx', 'forgeCancel'] as const;

/**
 * Wrap window.LGCity.forgeStart / forgeFx / forgeCancel so the site's real enchant run drives `sink`. The site's own
 * function is called first (its 2D scene keeps working), then the sink; errors in the sink never reach the site.
 * Returns the restore function (puts the originals back unless someone else re-wrapped them meanwhile).
 * No LGCity on the page (dev pages, a site without the city) → no-op.
 */
export function hookSiteForge(sink: ForgeSink, win: any = typeof window !== 'undefined' ? window : null): () => void {
  const L = win && win.LGCity;
  if (!L || typeof L !== 'object') return () => {};
  const had: Record<string, boolean> = {}, orig: Record<string, any> = {};
  for (const k of KEYS) { had[k] = Object.prototype.hasOwnProperty.call(L, k); orig[k] = L[k]; }
  const call = (k: string, self: unknown, args: unknown[]) => { const f = orig[k]; return typeof f === 'function' ? f.apply(self, args) : undefined; };
  const safe = (fn: () => void) => { try { fn(); } catch (e) { console.warn('[l3d anvil]', e); } };
  const w: Record<string, (...a: any[]) => unknown> = {
    forgeStart(this: unknown, ...a: any[]) { const r = call('forgeStart', this, a); safe(() => sink.start(a[0], +a[1] || 1)); return r; },
    forgeFx(this: unknown, ...a: any[]) { const r = call('forgeFx', this, a); safe(() => sink.fx((a[0] || {}) as ForgeResult)); return r; },
    forgeCancel(this: unknown, ...a: any[]) { const r = call('forgeCancel', this, a); safe(() => sink.cancel()); return r; },
  };
  for (const k of KEYS) L[k] = w[k];
  return () => {
    for (const k of KEYS) {
      if (L[k] !== w[k]) continue;   // re-wrapped by someone else: leave theirs
      if (had[k]) L[k] = orig[k]; else delete L[k];
    }
  };
}

/** The site's v3 enchant scene state (city.js LGCity.anvil.ani(), 03.11). */
export interface SiteAni { on: boolean; kind?: string; step?: string }
/** Reader of LGCity.anvil.ani() resolved on every call (null: no such hook / it threw). */
export function siteAniOf(win: any = typeof window !== 'undefined' ? window : null): () => SiteAni | null {
  return () => {
    try { const A = win && win.LGCity && win.LGCity.anvil; return A && typeof A.ani === 'function' ? (A.ani() as SiteAni) || null : null; } catch { return null; }
  };
}
/** The site's forge window is v3 (b-forge.js `.cyf-wrap.cyf-v3`): it does not strike while waiting for the result. */
export const siteForgeV3 = (doc: any = typeof document !== 'undefined' ? document : null): boolean => {
  try { return !!(doc && doc.querySelector('.cyf-wrap.cyf-v3')); } catch { return false; }
};
/** What the 3D anvil does on a step of the site's scene: a blow, the heat-up, the result (also when it stops / is skipped). */
export function aniBeat(prev: string, step: string, on: boolean): 'hit' | 'heat' | 'show' | null {
  if (!on) return 'show';
  if (step === prev) return null;
  if (/^hit\d$/.test(step)) return 'hit';
  if (step.startsWith('r-')) return 'show';
  if (step === 'heat' || step === 'rise' || step === 'boost') return 'heat';
  return null;
}

/** Blows per run like the site (city.js FX.start): 2 up to +3, 3 up to +6, 4 up to +10, else 5. */
export const blowsFor = (tg: number): number => (tg <= 3 ? 2 : tg <= 6 ? 3 : tg <= 10 ? 4 : 5);
export const BEAT = 0.62;
/** Hammer swing → impact delay (avatar 'swing' emote: wind-up 35 % of 0.45 s, strike at ~50 %). */
const IMPACT = 0.22;
const IDLE_EVERY = 3.2;
const N_SPARK = 72, N_SMOKE = 28;

export type AnvilState = 'idle' | 'work' | 'wait' | 'result';

export interface AnvilFxOpts {
  /** Top centre of the anvil face (room metres). */
  top: THREE.Vector3;
  smith: Npc;
  /** Lights to flash on every blow (hearth). */
  flash?: THREE.PointLight | null;
  itemModels?: Registry<ItemModelFactory> | null;
  reduceMotion?: boolean;
  /** The site's v3 scene (siteAniOf()); absent → the classic rhythm only. */
  siteAni?: (() => SiteAni | null) | null;
  /** The site's forge window is v3 (siteForgeV3): no blows while the order is on the way. */
  siteV3?: (() => boolean) | null;
}

export class AnvilFx {
  readonly root = new THREE.Group();
  state: AnvilState = 'idle';
  /** Blows still to strike in this run / struck so far (tests, debug). */
  left = 0; struck = 0;
  result: ForgeResult | null = null;
  /** What was last shown: 'ok' | 'bad' | 'save' (tests, debug). */
  shown: 'ok' | 'bad' | 'save' | null = null;
  private now = 0;
  private nextBlow = 0; private impactAt = -1; private impactBig = false; private doneAt = 0; private resultUntil = 0;
  private nextIdle = 2;
  /** Following the site's v3 scene (tests, debug). */
  follow = false;
  private aniStep = ''; private aniKind = 'metal'; private pollAt = 0;
  private glowK = 0; private glowTarget = 0; private glowStep = 0;
  private item: THREE.Object3D | null = null;
  private itemY = 0; private bounce = 0;
  private readonly tex: THREE.Texture;
  private readonly halo: THREE.Sprite;
  private readonly burst: THREE.Sprite;
  private burstT = -1; private burstCol = new THREE.Color();
  private readonly light: THREE.PointLight;
  private flashBase = 0;
  private readonly text: { sprite: THREE.Sprite; canvas: HTMLCanvasElement | null; tex: THREE.CanvasTexture | null };
  private textT = -1;
  // particle pools: position, velocity, life, colour
  private readonly sp = { pos: new Float32Array(N_SPARK * 3), vel: new Float32Array(N_SPARK * 3), life: new Float32Array(N_SPARK), col: new Float32Array(N_SPARK * 3), base: new Float32Array(N_SPARK * 3), pts: null as unknown as THREE.Points, next: 0 };
  private readonly sm = { pos: new Float32Array(N_SMOKE * 3), vel: new Float32Array(N_SMOKE * 3), life: new Float32Array(N_SMOKE), col: new Float32Array(N_SMOKE * 4), pts: null as unknown as THREE.Points, next: 0 };

  constructor(private readonly o: AnvilFxOpts) {
    this.root.name = 'room:anvilfx';
    o.smith.busy = true;   // the smith works at the anvil: faces it, no idle emotes (AnvilFx drives the hammer)
    this.tex = glowTexture();
    const T = o.top;
    this.halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.tex, color: '#ffb347', transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0 }));
    this.halo.position.set(T.x, T.y + 0.12, T.z); this.halo.scale.setScalar(0.9); this.halo.name = 'room:anvilfx:halo';
    this.burst = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.tex, color: '#ffd76a', transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0 }));
    this.burst.position.set(T.x, T.y + 0.3, T.z); this.burst.name = 'room:anvilfx:burst';
    this.light = new THREE.PointLight('#ffb347', 0, 5, 2); this.light.position.set(T.x, T.y + 0.5, T.z); this.light.name = 'room:anvilfx:light';
    if (o.flash) this.flashBase = o.flash.intensity;
    this.root.add(this.halo, this.burst, this.light);
    // particles
    const mk = (pos: Float32Array, col: Float32Array, cs: 3 | 4, mat: THREE.PointsMaterial) => {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
      g.setAttribute('color', new THREE.BufferAttribute(col, cs).setUsage(THREE.DynamicDrawUsage));
      g.boundingSphere = new THREE.Sphere(T.clone(), 4);
      const p = new THREE.Points(g, mat); p.frustumCulled = false; this.root.add(p); return p;
    };
    this.sp.pts = mk(this.sp.pos, this.sp.col, 3, new THREE.PointsMaterial({ map: this.tex, size: 0.18, vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true }));
    this.sm.pts = mk(this.sm.pos, this.sm.col, 4, new THREE.PointsMaterial({ map: this.tex, size: 0.7, vertexColors: true, transparent: true, depthWrite: false, sizeAttenuation: true }));
    this.sp.pts.name = 'room:anvilfx:sparks'; this.sm.pts.name = 'room:anvilfx:smoke';
    for (let i = 0; i < N_SPARK; i++) this.sp.pos[i * 3 + 1] = -50;
    for (let i = 0; i < N_SMOKE; i++) this.sm.pos[i * 3 + 1] = -50;
    // floating result text (canvas sprite; redrawn only when a result is shown)
    let canvas: HTMLCanvasElement | null = null, ctex: THREE.CanvasTexture | null = null;
    try { canvas = document.createElement('canvas'); canvas.width = 256; canvas.height = 96; ctex = new THREE.CanvasTexture(canvas); ctex.colorSpace = THREE.SRGBColorSpace; } catch { canvas = null; }
    const ts = new THREE.Sprite(new THREE.SpriteMaterial({ map: ctex, transparent: true, depthWrite: false, depthTest: false, opacity: 0 }));
    ts.scale.set(0.9, 0.34, 1); ts.position.set(T.x, T.y + 0.7, T.z); ts.renderOrder = 8; ts.name = 'room:anvilfx:text';
    this.text = { sprite: ts, canvas, tex: ctex };
    this.root.add(ts);
  }

  /* ------------------------------------------------------------ site events */
  /** forgeStart(item, target level): put the item on the anvil and start the blows. */
  start(it: unknown, tg: number): void {
    this.setItem(it);
    this.follow = false;
    // v3 window: the site waits silently for the result and animates after it (fx → follow)
    this.left = this.o.siteV3 && this.o.siteV3() ? 0 : blowsFor(tg); this.struck = 0;
    this.state = 'work'; this.result = null; this.shown = null;
    this.nextBlow = this.now + 0.1; this.impactAt = -1;
    this.glowK = this.glowTarget = Math.min(1, 0.15 + (tg - 1) / 15 * 0.85) * 0.6;
    this.glowStep = 0.5 / Math.max(1, this.left);
    this.doneAt = this.now;
    this.o.smith.say(['Тук-тук! Держись, железо…', 'Звезду на удачу — и бьём!', 'Сейчас посмотрим, выдержит ли.'][Math.floor(Math.random() * 3)], this.now, 3500);
  }
  /** forgeFx(x): the result; shown after the blows (or at once when they are over). */
  fx(x: ForgeResult): void {
    this.result = x;
    const a = this.o.siteAni ? this.o.siteAni() : null;
    if (a && a.on) {   // the site's v3 scene runs: follow its steps (no own blows any more)
      this.follow = true; this.aniStep = ''; this.aniKind = a.kind || 'metal'; this.pollAt = this.now;
      this.left = 0; this.impactAt = -1; this.state = 'wait';
      return;
    }
    if (this.state !== 'work') this.show(x);
  }
  /** forgeCancel(): stop striking, the item stays on the anvil. */
  cancel(): void {
    this.state = 'idle'; this.left = 0; this.result = null; this.impactAt = -1; this.follow = false;
    this.glowTarget = 0;
    this.nextIdle = this.now + IDLE_EVERY;
  }

  /* ------------------------------------------------------------ per frame */
  update(dt: number, t: number): void {
    this.now = t;
    const S = this.o.smith;
    if (this.follow && t >= this.pollAt) this.followStep(t);
    if (this.state === 'work') {
      if (this.left > 0 && t >= this.nextBlow) {
        S.av.play('swing'); this.impactAt = t + IMPACT; this.impactBig = true;
        this.left--; this.struck++; this.nextBlow = t + BEAT;
        if (this.left === 0) this.doneAt = t + BEAT * 0.6;
      }
      if (this.left === 0 && t >= this.doneAt && this.impactAt < 0) {
        if (this.result) this.show(this.result); else this.state = 'wait';
      }
    } else if (this.state === 'idle') {
      if (t >= this.nextIdle) { S.av.play('swing'); this.impactAt = t + IMPACT; this.impactBig = false; this.nextIdle = t + IDLE_EVERY; }
    } else if (this.state === 'result' && t >= this.resultUntil) {
      this.state = 'idle'; this.nextIdle = t + IDLE_EVERY * 1.5; this.glowTarget = 0;
    }
    if (this.impactAt >= 0 && t >= this.impactAt) { this.impactAt = -1; this.impact(this.impactBig); }
    // glow of the item (rises with each blow, pulses while waiting)
    const wantGlow = this.state === 'wait' ? this.glowTarget * (0.8 + 0.2 * Math.sin(t * 5)) : this.glowTarget;
    this.glowK += (wantGlow - this.glowK) * Math.min(1, dt * 6);
    const hm = this.halo.material as THREE.SpriteMaterial;
    hm.opacity = Math.min(1, this.glowK * 1.3);
    this.halo.scale.setScalar(0.8 + this.glowK * 1.1);
    // light: blow flashes decay
    this.light.intensity = Math.max(0, this.light.intensity - dt * 30);
    if (this.o.flash) this.o.flash.intensity += (this.flashBase - this.o.flash.intensity) * Math.min(1, dt * 8);
    // item bounce
    if (this.item) { this.bounce = Math.max(0, this.bounce - dt * 0.6); this.item.position.y = this.itemY + Math.sin(this.bounce * 40) * this.bounce * 0.5; }
    // result burst + text
    if (this.burstT >= 0) {
      this.burstT += dt;
      const k = this.burstT / 1.2, bm = this.burst.material as THREE.SpriteMaterial;
      if (k >= 1) { this.burstT = -1; bm.opacity = 0; }
      else { bm.color.copy(this.burstCol); bm.opacity = Math.min(1, (1 - k) * 1.4) * (k < 0.08 ? k / 0.08 : 1); this.burst.scale.setScalar(0.6 + k * 3.4); }
    }
    if (this.textT >= 0) {
      this.textT += dt;
      const tm = this.text.sprite.material as THREE.SpriteMaterial, k = this.textT / 2.6;
      if (k >= 1) { this.textT = -1; tm.opacity = 0; }
      else { tm.opacity = k < 0.1 ? k * 10 : k > 0.75 ? (1 - k) * 4 : 1; this.text.sprite.position.y = this.o.top.y + 0.7 + k * 0.45; }
    }
    this.stepParticles(dt);
  }

  /** Poll the site's scene (10 Hz — ani() returns a fresh object) and mirror its step. */
  private followStep(t: number): void {
    this.pollAt = t + 0.1;
    const a = this.o.siteAni ? this.o.siteAni() : null, on = !!(a && a.on), step = on ? String(a!.step || '') : '';
    if (a && a.kind) this.aniKind = a.kind;
    const b = aniBeat(this.aniStep, step, on);
    this.aniStep = step;
    if (b === 'hit') {
      this.struck++;
      if (this.aniKind === 'magic') {   // the site raises magic things with runes: a pulse, no hammer
        const T = this.o.top;
        this.emitSparks(16, T.x, T.y + 0.12, T.z, 1.8, '#c9b3ff', true);
        this.light.intensity = 4; this.glowTarget = Math.min(1.4, this.glowTarget + 0.15); this.bounce = 0.04;
      } else { this.o.smith.av.play('swing'); this.impactAt = t + IMPACT; this.impactBig = true; }
    } else if (b === 'heat') this.glowTarget = Math.max(this.glowTarget, 0.55);
    else if (b === 'show') { this.follow = false; if (this.result) this.show(this.result); else this.state = 'idle'; }
  }

  /* ------------------------------------------------------------ effects */
  private impact(big: boolean): void {
    const T = this.o.top;
    this.emitSparks(big ? 30 : 8, T.x, T.y + 0.08, T.z, big ? 3.6 : 2.2, big ? '#ffd27a' : '#ffb347');
    if (big) { this.burstCol.set('#ffcf6a'); this.burstT = 0.75; }
    this.light.intensity = big ? 7 : 2.5;
    if (this.o.flash) this.o.flash.intensity = this.flashBase * (big ? 1.7 : 1.2);
    if (big) { this.glowTarget = Math.min(1.4, this.glowTarget + this.glowStep); this.bounce = 0.06; }
  }
  private show(x: ForgeResult): void {
    const T = this.o.top, S = this.o.smith;
    this.follow = false;
    this.state = 'result'; this.resultUntil = this.now + 3.2;
    const out = x.out;
    if (out === 'up') {
      this.shown = 'ok';
      this.burstCol.set('#ffd76a'); this.burstT = 0;
      this.emitSparks(40, T.x, T.y + 0.1, T.z, 2.6, '#ffe9a0', true);
      this.glowTarget = Math.min(1.4, 0.6 + (+(x.to || 0)) / 15);
      this.label(`+${x.to ?? ''}`, '#ffcf4a');
      S.av.play('cheer'); S.say(`Удалась! Теперь +${x.to ?? '?'}`, this.now, 4000);
    } else if (out === 'broken') {
      this.shown = 'bad';
      this.puff(T.x, T.y + 0.1, T.z, 0.42, 0.4, 0.44, 22);
      this.emitSparks(10, T.x, T.y + 0.08, T.z, 1.6, '#ff7a3a');
      if (this.item) this.item.visible = false;
      this.glowTarget = 0;
      this.label('Сломалось', '#ff6a6a');
      S.say('Эх… не выдержала заточки.', this.now, 4000);
    } else {
      this.shown = 'save';
      this.puff(T.x, T.y + 0.1, T.z, 0.55, 0.62, 0.78, 14);
      this.burstCol.set('#7fb6ff'); this.burstT = 0.3;
      this.glowTarget = 0.2;
      this.label(out === 'down' ? '−1' : 'Цела', '#9fd0ff');
      S.say(out === 'down' ? 'Не вышло — сфера сберегла, −1.' : 'Не вышло, но вещь цела.', this.now, 4000);
    }
  }
  private label(text: string, col: string): void {
    const c = this.text.canvas; if (!c || !this.text.tex) return;
    const g = c.getContext('2d'); if (!g) return;
    g.clearRect(0, 0, c.width, c.height);
    g.font = "900 64px 'Nunito','Comfortaa','Trebuchet MS',sans-serif"; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.lineWidth = 10; g.strokeStyle = '#2b1d18'; g.strokeText(text, c.width / 2, c.height / 2 + 4);
    g.fillStyle = col; g.fillText(text, c.width / 2, c.height / 2 + 4);
    this.text.tex.needsUpdate = true;
    const w = Math.min(1.6, 0.3 + text.length * 0.17);
    this.text.sprite.scale.set(w, w * 96 / 256, 1);
    this.textT = 0;
  }
  private setItem(it: unknown): void {
    if (this.item) { this.root.remove(this.item); disposeObj(this.item); this.item = null; }
    if (!it || typeof it !== 'object') return;
    let obj: THREE.Object3D;
    try { obj = itemObject(it as StockItem, { itemModels: this.o.itemModels || null }); } catch { return; }
    const bx = new THREE.Box3().setFromObject(obj), sz = bx.getSize(new THREE.Vector3());
    if (bx.isEmpty()) { disposeObj(obj); return; }
    const g = new THREE.Group(); g.name = 'room:anvilfx:item';
    const inner = new THREE.Group(); inner.add(obj); g.add(inner);
    // long things (weapons) lie across the anvil
    if (sz.y > Math.max(sz.x, sz.z) * 1.3) inner.rotation.z = Math.PI / 2;
    inner.updateMatrixWorld(true);
    const b2 = new THREE.Box3().setFromObject(inner), s2 = b2.getSize(new THREE.Vector3()), c2 = b2.getCenter(new THREE.Vector3());
    const k = 0.5 / Math.max(s2.x, s2.y, s2.z, 1e-3);
    inner.scale.setScalar(k); inner.position.set(-c2.x * k, -b2.min.y * k, -c2.z * k);
    const T = this.o.top;
    g.position.set(T.x, T.y, T.z); g.rotation.y = 0.2;
    this.itemY = T.y; this.item = g; this.root.add(g);
  }
  private emitSparks(n: number, x: number, y: number, z: number, speed: number, col: string, up = false): void {
    const P = this.sp, c = _c.set(col);
    for (let k = 0; k < n; k++) {
      const i = P.next; P.next = (P.next + 1) % N_SPARK;
      const a = Math.random() * Math.PI * 2, e = up ? 1.1 + Math.random() * 0.4 : 0.25 + Math.random() * 0.9, v = speed * (0.5 + Math.random() * 0.6);
      P.pos[i * 3] = x; P.pos[i * 3 + 1] = y; P.pos[i * 3 + 2] = z;
      P.vel[i * 3] = Math.cos(a) * Math.cos(e) * v; P.vel[i * 3 + 1] = Math.sin(e) * v * (up ? 0.6 : 1); P.vel[i * 3 + 2] = Math.sin(a) * Math.cos(e) * v;
      P.life[i] = up ? 1.4 + Math.random() * 0.6 : 0.5 + Math.random() * 0.4;
      P.base[i * 3] = c.r; P.base[i * 3 + 1] = c.g; P.base[i * 3 + 2] = c.b;
    }
  }
  private puff(x: number, y: number, z: number, r: number, g: number, b: number, n: number): void {
    const P = this.sm;
    for (let k = 0; k < n; k++) {
      const i = P.next; P.next = (P.next + 1) % N_SMOKE;
      const a = Math.random() * Math.PI * 2, v = 0.3 + Math.random() * 0.5;
      P.pos[i * 3] = x + Math.cos(a) * 0.1; P.pos[i * 3 + 1] = y; P.pos[i * 3 + 2] = z + Math.sin(a) * 0.1;
      P.vel[i * 3] = Math.cos(a) * v; P.vel[i * 3 + 1] = 0.5 + Math.random() * 0.6; P.vel[i * 3 + 2] = Math.sin(a) * v;
      P.life[i] = 1.6 + Math.random() * 0.8;
      P.col[i * 4] = r; P.col[i * 4 + 1] = g; P.col[i * 4 + 2] = b; P.col[i * 4 + 3] = 0;
    }
  }
  private stepParticles(dt: number): void {
    const P = this.sp;
    let any = false;
    for (let i = 0; i < N_SPARK; i++) {
      if (P.life[i] <= 0) continue;
      any = true;
      P.life[i] -= dt;
      if (P.life[i] <= 0) { P.pos[i * 3 + 1] = -50; P.col[i * 3] = P.col[i * 3 + 1] = P.col[i * 3 + 2] = 0; continue; }
      P.vel[i * 3 + 1] -= 7 * dt;
      P.pos[i * 3] += P.vel[i * 3] * dt; P.pos[i * 3 + 1] += P.vel[i * 3 + 1] * dt; P.pos[i * 3 + 2] += P.vel[i * 3 + 2] * dt;
      if (P.pos[i * 3 + 1] < 0.02) { P.pos[i * 3 + 1] = 0.02; P.vel[i * 3 + 1] *= -0.3; P.vel[i * 3] *= 0.5; P.vel[i * 3 + 2] *= 0.5; }
      const f = Math.min(1, P.life[i] * 2.2);
      P.col[i * 3] = P.base[i * 3] * f * 1.6; P.col[i * 3 + 1] = P.base[i * 3 + 1] * f * 1.6; P.col[i * 3 + 2] = P.base[i * 3 + 2] * f * 1.6;
    }
    if (any) { (P.pts.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true; (P.pts.geometry.attributes.color as THREE.BufferAttribute).needsUpdate = true; }
    const S = this.sm;
    any = false;
    for (let i = 0; i < N_SMOKE; i++) {
      if (S.life[i] <= 0) continue;
      any = true;
      S.life[i] -= dt;
      if (S.life[i] <= 0) { S.pos[i * 3 + 1] = -50; S.col[i * 4 + 3] = 0; continue; }
      S.vel[i * 3] *= 1 - dt * 1.5; S.vel[i * 3 + 2] *= 1 - dt * 1.5; S.vel[i * 3 + 1] *= 1 - dt * 0.6;
      S.pos[i * 3] += S.vel[i * 3] * dt; S.pos[i * 3 + 1] += S.vel[i * 3 + 1] * dt; S.pos[i * 3 + 2] += S.vel[i * 3 + 2] * dt;
      S.col[i * 4 + 3] = Math.min(0.75, S.life[i] * 0.5) * Math.min(1, (2.4 - S.life[i]) * 4 + 0.2);
    }
    if (any) { (S.pts.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true; (S.pts.geometry.attributes.color as THREE.BufferAttribute).needsUpdate = true; }
  }

  dispose(): void {
    if (this.item) disposeObj(this.item);
    this.tex.dispose(); this.text.tex?.dispose();
    for (const o of [this.halo, this.burst, this.text.sprite]) (o.material as THREE.Material).dispose();
    for (const p of [this.sp.pts, this.sm.pts]) { p.geometry.dispose(); (p.material as THREE.Material).dispose(); }
    this.light.dispose();
    this.o.smith.busy = false;
    this.root.removeFromParent();
  }
}

const _c = new THREE.Color();
function disposeObj(o: THREE.Object3D): void {
  o.traverse((x) => { const m = x as THREE.Mesh; if (m.isMesh && x.userData.l3dOwnGeo) m.geometry.dispose(); });
}
