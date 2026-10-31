/**
 * Debug tools that act on the live game, all client-only:
 *  - FreeCam: noclip camera (WASD + mouse, Space / Ctrl = up / down, Shift = fast); the hero stays where it was
 *    (moves are paused, the controller is held in place);
 *  - Bots: N demo walkers (demo_bot_*) around the player with chat bubbles — only in our local store, re-added when
 *    the site's city refresh clears the walker list; never sent anywhere, no chat lines are added;
 *  - EventForce: force a seasonal decoration (Halloween, New Year, summer, April 1) and the «Ночь Тыквенной Луны»
 *    look / portal (hero.hwc in our local store copy only).
 */
import * as THREE from 'three';
import type { Walker } from '../contracts';
import type { CoreContext } from '../core/context';
import type { StoreWriter } from '../store/store';

const W = (ctx: CoreContext) => ctx.store as unknown as StoreWriter;
import { appearanceFrom } from '../avatar';
import { setEventOverride, eventOverride } from '../features/seasonal';
import { SX, SZ } from '../world/coords';
import { deepActive, isTyping } from '../engine/input';

/* ================================================================== free camera */
const _fwd = new THREE.Vector3(), _right = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0), _e = new THREE.Euler(0, 0, 0, 'YXZ');
export class FreeCam {
  on = false;
  readonly pos = new THREE.Vector3();
  private hold = { x: 0, y: 0 };
  private keys = new Set<string>();
  private vmVis = true;
  /** The shared input policy: no flight keys while a text field has the keyboard or a modal / menu is open (gameplay off). */
  private onDown = (e: KeyboardEvent) => {
    if (!this.on || e.ctrlKey || e.metaKey || e.altKey) return;
    const t = (typeof e.composedPath === 'function' ? e.composedPath()[0] : e.target) as Element | null;
    if (isTyping(t && (t as Element).tagName ? t : null) || isTyping(deepActive()) || !this.ctx.input.gameplay) { this.keys.clear(); return; }
    this.keys.add(e.code);
  };
  private onUp = (e: KeyboardEvent) => { this.keys.delete(e.code); };
  private onBlur = () => { this.keys.clear(); };
  private onVis = () => { if (document.hidden) this.keys.clear(); };
  constructor(private ctx: CoreContext, private pauseMoves: (on: boolean) => void) {}
  set(on: boolean): void {
    if (on === this.on) return;
    this.on = on;
    const ctl = this.ctx.controller();
    if (on) {
      this.pos.copy(this.ctx.camera.position);
      this.hold.x = ctl.x; this.hold.y = ctl.y;
      this.vmVis = this.ctx.vm.root.visible;
      this.pauseMoves(true);
      addEventListener('keydown', this.onDown, true); addEventListener('keyup', this.onUp, true);
      addEventListener('blur', this.onBlur); document.addEventListener('visibilitychange', this.onVis);
    } else {
      removeEventListener('keydown', this.onDown, true); removeEventListener('keyup', this.onUp, true);
      removeEventListener('blur', this.onBlur); document.removeEventListener('visibilitychange', this.onVis);
      this.keys.clear();
      this.ctx.vm.root.visible = this.vmVis;
      this.pauseMoves(false);
    }
  }
  /** After the camera rig (feature hook): hold the hero, fly the camera. */
  frame(dt: number): void {
    if (!this.on) return;
    const ctx = this.ctx, ctl = ctx.controller();
    if (ctl.x !== this.hold.x || ctl.y !== this.hold.y) ctl.teleport(this.hold.x, this.hold.y);
    (ctx.input as unknown as { consumeJump?(): void }).consumeJump?.();
    ctx.vm.root.visible = false;
    _e.set(ctx.rig.pitch, ctx.rig.yaw, 0);
    _fwd.set(0, 0, -1).applyEuler(_e);
    _right.set(1, 0, 0).applyEuler(_e);
    if (!ctx.input.gameplay || isTyping(deepActive())) this.keys.clear();   // a menu / modal / the chat took the keyboard
    const mv = ctx.input.move, fast = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight');
    const sp = (fast ? 18 : 6) * dt;
    this.pos.addScaledVector(_fwd, mv.y * sp).addScaledVector(_right, mv.x * sp);
    if (this.keys.has('Space')) this.pos.addScaledVector(_up, sp);
    if (this.keys.has('ControlLeft') || this.keys.has('KeyC')) this.pos.addScaledVector(_up, -sp);
    ctx.camera.position.copy(this.pos);
    ctx.camera.quaternion.setFromEuler(_e);
  }
  dispose(): void { this.set(false); }
}

/* ================================================================== demo bots */
const LINES = ['привет всем!', 'кто в шахту?', 'мяу', 'где тренер?', 'ура, новый уровень!', 'го в поход', 'красивый шатёр', 'тестирую расширение', 'всем добрый вечер', 'кто видел кузнеца?'];
const NAMES = ['Барсик', 'Пушок', 'Уголёк', 'Рыжик', 'Снежок', 'Ириска', 'Персик', 'Тучка', 'Зефир', 'Котлета', 'Бусинка', 'Мурка'];
interface Bot extends Walker { path: [number, number][] | null; wait: number; say: number }
export class Bots {
  readonly list: Bot[] = [];
  private t = 0;
  constructor(private ctx: CoreContext) {}
  get count(): number { return this.list.length; }
  spawn(n: number): void {
    const L = this.ctx.layout(), me = this.ctx.me, base = this.list.length;
    for (let i = 0; i < n && this.list.length < 200; i++) {
      const k = base + i, login = 'demo_bot_' + (k + 1);
      const [x, y] = L.nearest(me.x + (Math.random() - 0.5) * 900, me.y + (Math.random() - 0.5) * 300);
      const app = appearanceFrom(login, { l: login, n: NAMES[k % NAMES.length] + ' ' + (k + 1), lv: 1 + (k % 20), lk: { color: ['#ff9fb2', '#ffb27a', '#ffe27a', '#9fe39a', '#7fd6e6', '#b9a2ff'][k % 6], hat: ['cap', 'bow', 'crown', 'wizard', 'party', 'cat'][k % 6] } }, 'cats');
      const b: Bot = { login, app, x, y, face: Math.random() * 6.28, speed: 0, alpha: 1, path: null, wait: Math.random() * 3, say: 2 + Math.random() * 8 };
      this.list.push(b); W(this.ctx).upsertWalker(b);
    }
  }
  clear(): void { for (const b of this.list) W(this.ctx).removeWalker(b.login); this.list.length = 0; }
  /** After the site tick: walk the bots on the walk grid, bubbles now and then; re-add the ones a city refresh dropped. */
  frame(dt: number): void {
    if (!this.list.length) return;
    const st = W(this.ctx), L = this.ctx.layout(), now = Date.now();
    this.t += dt;
    const check = this.t > 1; if (check) this.t = 0;
    for (const b of this.list) {
      if (check && st.walkers.get(b.login) !== b) st.upsertWalker(b);
      if (b.bubble && b.bubble.until < now) b.bubble = undefined;
      b.say -= dt;
      if (b.say <= 0) { b.say = 6 + Math.random() * 14; const text = LINES[(Math.random() * LINES.length) | 0]; b.bubble = { text, until: now + 4000 + text.length * 50, id: 'demo' + now + b.login }; }
      if (!b.path || !b.path.length) {
        b.speed = 0; b.wait -= dt;
        if (b.wait <= 0) {
          const [tx, ty] = L.nearest(b.x + (Math.random() - 0.5) * 1200, b.y + (Math.random() - 0.5) * 400);
          try { b.path = L.path ? L.path([b.x, b.y], [tx, ty]).slice(1) : [[tx, ty]]; } catch { b.path = [[tx, ty]]; }
          b.wait = 2 + Math.random() * 5;
        }
        continue;
      }
      const [tx, ty] = b.path[0], dx = tx - b.x, dy = ty - b.y;
      const dm = Math.hypot(dx * SX, dy * SZ), step = 2.2 * dt;
      if (dm <= step) { b.x = tx; b.y = ty; b.path.shift(); }
      else { b.x += (dx * SX / dm * step) / SX; b.y += (dy * SZ / dm * step) / SZ; }
      b.face = Math.atan2(-(dx * SX), -(dy * SZ)); b.speed = 230;
    }
  }
  dispose(): void { this.clear(); }
}

/* ================================================================== event forcing */
export type ForcedEvent = '' | 'halloween' | 'newyear' | 'summer' | 'aprilfools';
export type ForcedHwc = '' | 'look' | 'portal';
export class EventForce {
  event: ForcedEvent = '';
  hwc: ForcedHwc = '';
  private t = 0;
  private offHero: (() => void) | null = null;
  private hwcBefore: unknown = undefined;
  constructor(private ctx: CoreContext) {}
  setEvent(id: ForcedEvent): void {
    this.event = id;
    setEventOverride(id || null, id ? 'debug' : '');
  }
  setHwc(v: ForcedHwc): void {
    const st = W(this.ctx);
    if (v && !this.hwc) {
      this.hwcBefore = (st.hero as { hwc?: unknown } | null)?.hwc;
      this.offHero = st.on('hero', () => this.applyHwc());
    }
    this.hwc = v;
    if (!v) {
      this.offHero?.(); this.offHero = null;
      const h = st.hero as Record<string, unknown> | null;
      if (h) st.setHero({ ...h, hwc: this.hwcBefore } as never);
      return;
    }
    this.applyHwc();
  }
  private want(): { look: boolean; portal: boolean; at?: number } | null {
    return this.hwc === 'look' ? { look: true, portal: false } : this.hwc === 'portal' ? { look: true, portal: true, at: Date.now() } : null;
  }
  private applyHwc(): void {
    const st = W(this.ctx), h = st.hero as Record<string, unknown> | null, w = this.want();
    if (!h || !w) return;
    const cur = h.hwc as { look?: boolean; portal?: boolean } | undefined;
    if (cur && !!cur.look === w.look && !!cur.portal === w.portal) return;
    st.setHero({ ...h, hwc: w } as never);
  }
  /** Keep a forced decoration on (other code resets the single override slot on hero updates). */
  frame(dt: number): void {
    if (!this.event) return;
    this.t += dt; if (this.t < 1) return; this.t = 0;
    const o = eventOverride();
    if (!o || o.id !== this.event) setEventOverride(this.event, 'debug');
  }
  dispose(): void { if (this.event) { this.event = ''; setEventOverride(null); } if (this.hwc) this.setHwc(''); }
}
