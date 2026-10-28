/**
 * Mine AFK comfort (plans/mine-ux.md #27, #25, #5, the AFK render rate): everything here is client-only — it never
 * talks to the game (no MineApi, no fetch); it only reads the MineModel the room already keeps.
 *
 *  - TabSignals: the tab title «⛏ 12 мин · этаж 25» → «✅ Камень выкопан», a 32×32 favicon with a progress ring
 *    (redrawn at most every 30 s), and an optional page Notification (Web Notification API of the page — no
 *    manifest permission; asked only from the settings switch). The original title / icons come back on dispose.
 *  - mineStatus(): the detail of the window event 'l3d:mine-status' (contract in plans/mine-ux.md §4).
 *  - alertOf(): which soft chime an own finished stone gets: mine.done (ore / rock), mine.rare (rare vein, gem),
 *    mine.chest (petrified chest). Played through 'l3d:sfx' with { bg: true } (src/features/sound.ts may wake a
 *    muted hidden tab for it when «Сигнал шахты в фоне» is on).
 *  - StepGuard: after > 2 min without input while digging, the first WASD / arrow press only warns; a second press
 *    or holding the key > 0.4 s walks. ReachRing: a floor ring of the reach radius around the own stone that turns
 *    red at the edge.
 *  - RenderThrottle: the tab is visible but without focus for > 90 s in the mine → ~4 frames a second (engine.pause
 *    toggled by a timer); focus, a key or the mouse over the page restore the full rate at once.
 *
 * Settings (group «Шахта»): l3d.mine.tab, l3d.mine.notify, l3d.mine.bgsig, l3d.mine.guard, l3d.mine.eco.
 */
import * as THREE from 'three';
import type { Unsub } from '../../contracts';
import { registerSettingRow, settingValue } from '../../ui/settings-ext';
import { REACH, K as PX2M } from './geo';
import { stoneProgress, type MineModel, type Burst } from './state';

/* ============================================================ settings */

export const AFK_KEYS = {
  tab: 'l3d.mine.tab', notify: 'l3d.mine.notify', bgsig: 'l3d.mine.bgsig', guard: 'l3d.mine.guard', eco: 'l3d.mine.eco',
} as const;
const ONOFF: [string, string][] = [['off', 'Выкл'], ['on', 'Вкл']];
const DEFS: Record<keyof typeof AFK_KEYS, 'on' | 'off'> = { tab: 'on', notify: 'off', bgsig: 'on', guard: 'on', eco: 'on' };
/** Current value of an AFK switch (defaults when the row is not registered, e.g. on dev pages). */
export const afkOn = (k: keyof typeof AFK_KEYS): boolean => settingValue<string>(AFK_KEYS[k], DEFS[k]) === 'on';

type NotificationLike = { permission: string; requestPermission?: () => Promise<string> | void };
const notifApi = (): NotificationLike | null => (typeof Notification !== 'undefined' ? (Notification as unknown as NotificationLike) : null);
const permText = (): string => {
  const N = notifApi(); if (!N) return 'Этот браузер не умеет уведомления';
  return N.permission === 'granted' ? 'Разрешение дано' : N.permission === 'denied'
    ? 'Браузер запретил уведомления для сайта — разрешите их у значка замка в адресной строке' : 'Разрешение спросим, когда включите';
};

/** Settings rows of the mine (registered once with the mine room kind). Turning notifications on asks the browser. */
export function registerMineAfkSettings(): Unsub {
  const g = 'Шахта';
  const offs: Unsub[] = [
    registerSettingRow({ key: AFK_KEYS.tab, label: 'Заголовок вкладки', sub: '«⛏ 12 мин», «✅ Камень выкопан» и кольцо на значке вкладки', kind: 'seg', options: ONOFF, def: DEFS.tab, group: g, order: 10 }),
    registerSettingRow({ key: AFK_KEYS.bgsig, label: 'Сигнал шахты в фоне', sub: 'тихий звон, когда твой камень выкопан, даже в скрытой вкладке', kind: 'seg', options: ONOFF, def: DEFS.bgsig, group: g, order: 20 }),
    registerSettingRow({ key: AFK_KEYS.notify, label: 'Уведомление «Камень выкопан»', sub: 'системное уведомление; разрешение браузер спросит от имени сайта', kind: 'seg', options: ONOFF, def: DEFS.notify, group: g, order: 30 }),
    registerSettingRow({ key: 'l3d.mine.notifyInfo', label: 'Уведомления', kind: 'info', text: permText, group: g, order: 31 }),
    registerSettingRow({ key: AFK_KEYS.guard, label: 'Защита от ухода от камня', sub: 'кольцо досягаемости; после 2 мин простоя первый шаг только предупреждает', kind: 'seg', options: ONOFF, def: DEFS.guard, group: g, order: 40 }),
    registerSettingRow({ key: AFK_KEYS.eco, label: 'Меньше кадров без фокуса', sub: 'окно шахты видно, но не в фокусе 1,5 мин — 4 кадра в секунду', kind: 'seg', options: ONOFF, def: DEFS.eco, group: g, order: 50 }),
    registerSettingRow({ key: 'l3d.mine.econ', label: 'Оценки у камней', sub: '≈ сколько осталось, сколько копают, твоя доля и цена руды (табличка и строка прицела)', kind: 'seg', options: ONOFF, def: 'on', group: g, order: 55 }),
    registerSettingRow({ key: 'l3d.mine.layers', label: 'Пласты глубины', sub: '12 пластов, как на сайте: каждые 5 этажей пещера меняет цвет', kind: 'seg', options: ONOFF, def: 'on', group: g, order: 60 }),
  ];
  // the click on «Вкл» is a user gesture: ask for the page notification permission right inside it
  const onSet = (e: Event) => {
    const d = (e as CustomEvent).detail as { key?: string; value?: unknown } | undefined;
    if (!d || d.key !== AFK_KEYS.notify || d.value !== 'on') return;
    const N = notifApi();
    if (N && N.permission === 'default' && N.requestPermission) { try { void Promise.resolve(N.requestPermission()).catch(() => { /* */ }); } catch { /* */ } }
  };
  window.addEventListener('l3d:settings', onSet);
  offs.push(() => window.removeEventListener('l3d:settings', onSet));
  return () => { for (const u of offs) u(); };
}

/* ============================================================ pure helpers */

/** «12 мин», «1 ч 05 мин», «почти» (seconds left). */
export function fmtEta(sec: number): string {
  if (!(sec > 30)) return 'почти';
  const m = Math.ceil(sec / 60);
  return m < 60 ? `${m} мин` : `${Math.floor(m / 60)} ч ${String(m % 60).padStart(2, '0')} мин`;
}
/** Own stone being dug (−1 = none). */
export const myStone = (M: MineModel): number => (M.myI >= 0 && !M.dug[M.myI] ? M.myI : -1);
/** Seconds left on the own stone at `now`; null = unknown (no bl for it yet). */
export function myEta(M: MineModel, now: number): number | null {
  const i = myStone(M); if (i < 0 || !M.st) return null;
  const pr = stoneProgress(M.st, i, now); return pr ? Math.max(0, Math.round(pr.eta)) : null;
}
/** Progress 0…1 of the own stone (null = not digging / unknown). */
export function myProgress(M: MineModel, now: number): number | null {
  const i = myStone(M); if (i < 0 || !M.st) return null;
  const pr = stoneProgress(M.st, i, now); return pr ? pr.p : null;
}
export const DONE_TITLE = '✅ Камень выкопан';
/** Tab title for the mine state, or null = show the site's own title. */
export function titleFor(M: MineModel, now: number, done: boolean): string | null {
  const n = M.st ? M.st.n : 0;
  if (myStone(M) >= 0) { const e = myEta(M, now); return `⛏ ${e == null ? 'копаю' : fmtEta(e)} · этаж ${n}`; }
  return done ? DONE_TITLE : null;
}

/** Detail of window event 'l3d:mine-status' — the contract of plans/mine-ux.md §4 (consumed by src/features/mine-status.ts). */
export interface MineStatusDetail {
  c: string; n: number; i: number; eta: number | null; at: number; day: number; cap: number; inMine: boolean;
}
export const MINE_STATUS_EVENT = 'l3d:mine-status';
export function mineStatus(c: string, M: MineModel, now: number, inMine: boolean): MineStatusDetail {
  const i = myStone(M), me = M.me;
  return { c, n: M.st ? M.st.n : 0, i, eta: i >= 0 ? myEta(M, now) : null, at: now, day: me ? +me.day || 0 : 0, cap: me ? +me.cap || 0 : 0, inMine };
}

const GEMS = new Set(['adamant', 'fire_opal', 'emerald', 'sapphire', 'topaz', 'malachite', 'morion', 'aquamarine', 'ruby', 'runestone']);
export type AlertId = 'mine.done' | 'mine.rare' | 'mine.chest';
/** Which chime an own finished stone gets. */
export function alertOf(b: Burst, M: MineModel): AlertId {
  const cell = M.F && M.F.cells[b.i];
  if ((b.got && b.got.loot) || (cell && cell.t === 'chest')) return 'mine.chest';
  if (cell && (cell.t === 'rare' || (cell.r && (GEMS.has(cell.r) || (M.st && M.st.gem && cell.r === M.st.gem))))) return 'mine.rare';
  return 'mine.done';
}
/** The 'l3d:sfx' details of a chime (two soft notes; the second one a step higher). */
export function chimeEvents(id: AlertId | 'mine.cap'): { id: string; bg: true; delay?: number; rate?: number; key?: string }[] {
  if (id === 'mine.cap') return [{ id, bg: true }];
  if (id === 'mine.done') return [{ id, bg: true }, { id, bg: true, delay: 0.22, rate: 1.26, key: 'mine.done:2' }];
  return [{ id, bg: true }, { id: 'mine.done', bg: true, delay: 0.3, rate: 1.26, key: 'mine.done:2' }];
}
/**
 * What the sound feature does with a { bg: true } chime: 'play' (sound is live), 'wake' (hidden tab muted only
 * because «Звук в фоне» is off — wake the context for the chime), 'skip' (classic site, or the signal is off).
 */
export function bgAlertMode(o: { classic: boolean; hidden: boolean; background: boolean; signal: boolean }): 'play' | 'wake' | 'skip' {
  if (o.classic) return 'skip';
  if (!o.hidden || o.background) return 'play';
  return o.signal ? 'wake' : 'skip';
}

/** Reach limit (px from the stone centre, the walk-away rule in index.ts) and the ring radius in metres. */
export const REACH_LIMIT = REACH + 30;
export const RING_R = REACH_LIMIT * PX2M;
/** 0 = at the stone, 1 = at the limit; warn from 0.82. */
export const reachK = (distPx: number): number => Math.max(0, Math.min(1, distPx / REACH_LIMIT));
export const REACH_WARN = 0.82;
export const EDGE_TEXT = 'Ещё шаг — герой отложит кирку';
export const GUARD_TEXT = 'Герой копает. Нажми ещё раз или держи клавишу, чтобы отойти — работа остановится';

/* ============================================================ step guard (#5) */

const MOVE_CODES = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);
export const IDLE_MS = 120_000, HOLD_MS = 400;
/**
 * Keyboard-layout independent (KeyboardEvent.code). keyDown → 'pass' | 'block' (swallow, no move) | 'warn' (swallow
 * and show the warning). Armed only when digging, after IDLE_MS without input.
 */
export class StepGuard {
  private last: number;
  private held: { code: string; t: number } | null = null;
  constructor(now: number) { this.last = now; }
  activity(now: number): void { this.last = now; }
  armed(now: number, digging: boolean): boolean { return digging && now - this.last > IDLE_MS; }
  keyDown(code: string, repeat: boolean, now: number, digging: boolean): 'pass' | 'block' | 'warn' {
    if (!MOVE_CODES.has(code)) { this.last = now; return 'pass'; }
    const h = this.held;
    if (h && h.code === code) {
      if (now - h.t >= HOLD_MS) { this.held = null; this.last = now; return 'pass'; }   // held > 0.4 s: walk
      return repeat ? 'block' : 'pass';                                                // a second press: walk
    }
    if (!repeat && this.armed(now, digging)) { this.held = { code, t: now }; return 'warn'; }
    if (!h) this.last = now;
    return 'pass';
  }
  keyUp(code: string, now: number): void { if (this.held && this.held.code === code) { this.held = null; this.last = now; } }
  /** A warned key is waiting (second press / hold). */
  get pending(): boolean { return !!this.held; }
}

/* ============================================================ tab title, favicon, notification (#27) */

export interface TabEnv {
  getTitle(): string; setTitle(t: string): void;
  /** Replace the page icon with a data URL; null restores the original icons. */
  setIcon(url: string | null): void;
  /** Draw the 32×32 icon (progress 0…1, or 'done'); null when no canvas. */
  drawIcon(p: number | 'done'): string | null;
  notify(title: string, body: string, icon: string | null): void;
  hidden(): boolean; focused(): boolean;
}
export class TabSignals {
  private orig: string;
  private set: string | null = null;
  private done = false;
  private iconAt = -1e12; private iconKey = '';
  constructor(private env: TabEnv) { this.orig = env.getTitle(); }
  /** Own stone finished (burst): «✅» until the next stone starts. */
  finished(body: string, notify: boolean): void {
    this.done = true;
    if (notify && (this.env.hidden() || !this.env.focused())) this.env.notify('Камень выкопан — выбери следующий', body, this.env.drawIcon('done'));
  }
  /** Re-apply the title / icon (call on every state, burst and a timer). */
  update(M: MineModel, now: number, on: boolean): void {
    if (myStone(M) >= 0) this.done = false;
    const cur = this.env.getTitle();
    // the site changed its own title meanwhile: that becomes the title to restore
    if (cur !== this.set && cur !== this.orig) this.orig = cur;
    const t = on ? titleFor(M, now, this.done) : null;
    if (t) { if (cur !== t) this.env.setTitle(t); this.set = t; } else this.restoreTitle();
    // favicon: progress ring while digging, a tick when done (redrawn at most every 30 s, or when the state kind changes)
    const p = on ? myProgress(M, now) : null;
    const key = !on ? '' : p != null ? 'p' : myStone(M) >= 0 ? 'p0' : this.done ? 'done' : '';
    if (!key) { if (this.iconKey) { this.env.setIcon(null); this.iconKey = ''; } return; }
    if (key !== this.iconKey || now - this.iconAt >= 30_000) {
      const url = this.env.drawIcon(key === 'done' ? 'done' : p ?? 0);
      if (url) this.env.setIcon(url);
      this.iconKey = key; this.iconAt = now;
    }
  }
  private restoreTitle(): void { if (this.set != null) { if (this.env.getTitle() === this.set) this.env.setTitle(this.orig); this.set = null; } }
  dispose(): void { this.restoreTitle(); if (this.iconKey) this.env.setIcon(null); this.iconKey = ''; }
  get original(): string { return this.orig; }
}

/** The browser TabEnv: document.title and <link rel=icon> (original links kept and put back). */
export function domTabEnv(): TabEnv {
  let saved: { el: HTMLLinkElement; href: string }[] | null = null, own: HTMLLinkElement | null = null;
  let cv: HTMLCanvasElement | null = null;
  return {
    getTitle: () => document.title, setTitle: (t) => { document.title = t; },
    setIcon(url) {
      if (url == null) {
        if (saved) for (const s of saved) s.el.href = s.href;
        own?.remove(); own = null; saved = null; return;
      }
      if (!saved) {
        saved = [...document.querySelectorAll<HTMLLinkElement>('link[rel~="icon"]')].map((el) => ({ el, href: el.href }));
        if (!saved.length) { own = document.createElement('link'); own.rel = 'icon'; document.head.appendChild(own); }
      }
      for (const s of saved) s.el.href = url;
      if (own) own.href = url;
    },
    drawIcon(p) {
      try {
        cv = cv || document.createElement('canvas'); cv.width = cv.height = 32;
        const g = cv.getContext('2d'); if (!g) return null;
        g.clearRect(0, 0, 32, 32);
        // readable at 16 px: a filled progress wedge (gold) on a dark disc, a white tick on green when done
        if (p === 'done') {
          g.fillStyle = '#3fae5a'; g.beginPath(); g.arc(16, 16, 15, 0, Math.PI * 2); g.fill();
          g.strokeStyle = '#fff'; g.lineCap = 'round'; g.lineJoin = 'round'; g.lineWidth = 4.5;
          g.beginPath(); g.moveTo(8.5, 16.5); g.lineTo(14, 22); g.lineTo(24, 10.5); g.stroke();
        } else {
          g.fillStyle = '#2a2036'; g.beginPath(); g.arc(16, 16, 15, 0, Math.PI * 2); g.fill();
          g.fillStyle = '#6a5f7a'; g.beginPath(); g.arc(16, 16, 12, 0, Math.PI * 2); g.fill();
          const a0 = -Math.PI / 2, a1 = a0 + Math.PI * 2 * Math.max(0.08, Math.min(1, p));
          g.fillStyle = '#ffd23f'; g.beginPath(); g.moveTo(16, 16); g.arc(16, 16, 12, a0, a1); g.closePath(); g.fill();
        }
        return cv.toDataURL('image/png');
      } catch { return null; }
    },
    notify(title, body, icon) {
      const N = notifApi(); if (!N || N.permission !== 'granted') return;
      try {
        const n = new Notification(title, { body, tag: 'l3d-mine', ...(icon ? { icon } : {}) });
        n.onclick = () => { try { window.focus(); } catch { /* */ } n.close(); };
      } catch { /* some browsers allow notifications only from a service worker */ }
    },
    hidden: () => document.hidden, focused: () => document.hasFocus(),
  };
}

/* ============================================================ reach ring (#5) */

const C_OK = new THREE.Color('#ffd23f'), C_BAD = new THREE.Color('#ff3b30');
/** One flat ring (one draw call) around the own stone; add `mesh` to scene.root. */
export class ReachRing {
  readonly mesh: THREE.Mesh;
  private mat: THREE.MeshBasicMaterial;
  constructor() {
    const geo = new THREE.RingGeometry(RING_R - 0.16, RING_R, 96, 1);
    geo.rotateX(-Math.PI / 2);
    this.mat = new THREE.MeshBasicMaterial({ color: C_OK, transparent: true, opacity: 0.55, depthWrite: false, side: THREE.DoubleSide, fog: false, toneMapped: false });
    this.mesh = new THREE.Mesh(geo, this.mat);
    this.mesh.name = 'mine:reachRing'; this.mesh.visible = false; this.mesh.renderOrder = 2; this.mesh.frustumCulled = false;
  }
  /** k = reachK(dist); visible only while digging. No allocations. */
  update(on: boolean, x: number, z: number, k: number, t: number, still: boolean): void {
    this.mesh.visible = on; if (!on) return;
    this.mesh.position.set(x, 0.035, z);
    const e = Math.max(0, (k - 0.75) / 0.25);   // gold at the dig spot (k ≈ 0.7), red at the limit
    this.mat.color.copy(C_OK).lerp(C_BAD, e);
    const pulse = k >= REACH_WARN && !still ? 0.15 * (0.5 + 0.5 * Math.sin(t * 9)) : 0;
    this.mat.opacity = Math.min(1, 0.55 + e * 0.35 + pulse);
  }
  dispose(): void { this.mesh.removeFromParent(); this.mesh.geometry.dispose(); this.mat.dispose(); }
}

/* ============================================================ render rate without focus */

export interface ThrottleEnv {
  pause(on: boolean): void;
  hidden(): boolean; focused(): boolean;
  /** Someone else holds the engine paused (classic site, a blocking site overlay): hands off. */
  blocked(): boolean;
}
export const ECO_AFTER_MS = 90_000, ECO_FRAME_MS = 250;
/**
 * tick(now) every ~250 ms: after ECO_AFTER_MS visible-without-focus it pauses the engine and lets one frame through
 * per tick (frame() re-pauses inside that frame). wake() restores the full rate at once.
 */
export class RenderThrottle {
  private since: number | null = null;
  private active = false;
  constructor(private env: ThrottleEnv) {}
  get on(): boolean { return this.active; }
  tick(now: number, enabled: boolean): void {
    const idle = enabled && !this.env.hidden() && !this.env.focused();
    if (!idle) { this.since = null; if (this.active) this.wake(); return; }
    if (this.since == null) this.since = now;
    if (this.env.blocked()) { this.active = false; return; }
    if (!this.active && now - this.since >= ECO_AFTER_MS) this.active = true;
    if (this.active) this.env.pause(false);   // one frame; frame() pauses again
  }
  /** Called inside a rendered frame: in eco mode, hold the engine after this frame. */
  frame(): void { if (this.active && !this.env.blocked()) this.env.pause(true); }
  /** Focus / input: full rate now. */
  wake(): void {
    this.since = null;
    if (!this.active) return;
    this.active = false;
    if (!this.env.blocked()) this.env.pause(false);
  }
  dispose(): void { this.wake(); }
}
