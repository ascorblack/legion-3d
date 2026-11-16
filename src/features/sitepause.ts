/**
 * Short maintenance pauses of the site (live event `pz`: `{ on, warnAt?, ver? }`, app.js pauseEvent).
 *
 * 16.11 shape (app.js pauseWarn / pauseShow):
 *  - before a pause the site counts down in a status line on <body> (`.lg-pzw` «Пауза игры через <b>m:ss</b>», title
 *    «Короткий рестарт серверов. Ничего не потеряется»; seconds rounded up, re-drawn on the second boundary). It lies
 *    under our canvas, so the 3D shows the same countdown in its HUD;
 *  - once the pause is on (`on`) the site shows its own full-screen `.lg-pz` (role alertdialog, aria-modal, «Пауза игры,
 *    рестарт серверов» / «Ничего не теряется, игра продолжится сама»): it takes the focus, swallows every pointer event on it
 *    and every key on window in the capture phase except Ctrl / Meta chords and F1–F12 (`pzKey`). An aria-modal element is a
 *    site dialog (src/net/site.ts overlay() checks it first, even over a hybrid room's panel): the overlay watcher hides the 3D and turns gameplay off, which releases the
 *    held keys (their keyups never reach us while the plaque is up) — the input never fights it. F8 still passes. When it
 *    goes (pz `on: false` or /api/me without maintenance) the 3D comes back. (14.11 it was `.lg-pz-warn` + `.lg-maint`;
 *    `.lg-maint` is now only the long «Технические работы» notice.)
 * Read-only: nothing is sent.
 */
import { coreFeature } from './types';
import { SITE_PAUSE } from '../net/site';

export interface PauseEvent { on?: unknown; warnAt?: unknown }
/** app.js pzClock: m:ss. */
export const pzClock = (s: number): string => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
/** The site's countdown words for a warning at `at` (ms), or '' when there is nothing to show (app.js pauseWarn). */
export function pauseWarnText(at: number, now: number): string {
  if (!at || at <= now) return '';
  return `Пауза игры через ${pzClock(Math.max(0, Math.ceil((at - now) / 1000)))}`;
}
/** The site's hint under the countdown (the `.lg-pzw` title). */
export const PAUSE_HINT = 'Короткий рестарт серверов. Ничего не потеряется';
/** The warning moment an event sets: 0 = no warning (the pause is on, or it was called off). */
export const pauseWarnAt = (d: PauseEvent | null | undefined): number => (d && !d.on ? +(d.warnAt as number) || 0 : 0);
/** The site's pause plaque (app.js pauseShow, 16.11): src/net/site.ts overlay() puts it before every other overlay. */
export const PAUSE_SEL = SITE_PAUSE;

type BusLike = { on(ev: string, fn: (d: unknown) => void): () => void; last?: Record<string, unknown> };

export default coreFeature({
  id: 'sitepause',
  order: 237,
  setup(ctx) {
    const ui = ctx.uiRoot?.querySelector?.('.l3d-ui')?.shadowRoot?.querySelector<HTMLElement>('.ui');
    const bus = (window as unknown as { __L3D_BUS?: BusLike }).__L3D_BUS;
    if (!ui || !bus || typeof bus.on !== 'function') return;
    const el = document.createElement('div');
    el.className = 'l3d-pz'; el.setAttribute('role', 'status'); el.hidden = true;
    el.style.cssText = 'position:absolute;top:58px;left:50%;transform:translateX(-50%);z-index:32;max-width:calc(100vw - 24px);padding:7px 16px 8px;border-radius:12px;background:#271d2bf0;box-shadow:0 0 0 1.5px #ffcf6acc,0 8px 22px #0007;color:#f7eadf;font:700 14px/1.3 Nunito,system-ui,sans-serif;text-align:center;pointer-events:none';
    const head = document.createElement('div');
    const hint = document.createElement('div');
    hint.textContent = PAUSE_HINT;
    hint.style.cssText = 'font:600 12px/1.3 Nunito,system-ui,sans-serif;color:#e8d6c4;opacity:.85;margin-top:2px';
    el.append(head, hint);
    ui.append(el);
    let at = 0, timer = 0;
    const paint = () => {
      const t = ctx.state.classic ? '' : pauseWarnText(at, Date.now());   // the classic site shows its own line
      if (head.textContent !== t) head.textContent = t;
      el.hidden = !t;
      if (!t && timer && at <= Date.now()) { clearInterval(timer); timer = 0; }
    };
    const onPz = (d: unknown) => {
      at = pauseWarnAt(d as PauseEvent);
      // m:ss rounded up: re-drawn four times a second so the number turns over with the site's own line
      if (at && !timer) timer = window.setInterval(paint, 250);
      paint();
    };
    const off = bus.on('sse:pz', onPz);
    return () => { off(); if (timer) clearInterval(timer); el.remove(); };
  },
});
