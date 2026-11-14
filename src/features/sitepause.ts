/**
 * Short maintenance pauses of the site (14.11, app.js pauseEvent on the live event `pz`: `{ on, warnAt?, ver? }`).
 * Before a pause the site counts down in a status line on <body> (`.lg-pz-warn` «Через N с - короткие технические работы
 * (меньше минуты). Ничего не потеряется.»), which lies under our canvas. The 3D shows the same countdown in its HUD.
 * Once the pause is on (`on`) the site raises its own full-screen notice `.lg-maint` (an aria-modal alertdialog over
 * everything: the 3D already yields to it as a site dialog), so this line goes away. Read-only: nothing is sent.
 */
import { coreFeature } from './types';

export interface PauseEvent { on?: unknown; warnAt?: unknown }
/** The site's countdown text for a warning at `at` (ms), or '' when there is nothing to show (app.js pauseWarn). */
export function pauseWarnText(at: number, now: number): string {
  if (!at || at <= now) return '';
  const left = Math.max(0, Math.round((at - now) / 1000));
  return `Через ${left} с - короткие технические работы (меньше минуты). Ничего не потеряется.`;
}
/** The warning moment an event sets: 0 = no warning (the pause is on, or it was called off). */
export const pauseWarnAt = (d: PauseEvent | null | undefined): number => (d && !d.on ? +(d.warnAt as number) || 0 : 0);

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
    el.style.cssText = 'position:absolute;top:58px;left:50%;transform:translateX(-50%);z-index:32;max-width:calc(100vw - 24px);padding:7px 14px;border-radius:12px;background:#271d2bf0;box-shadow:0 0 0 1.5px #ffcf6acc,0 8px 22px #0007;color:#f7eadf;font:700 13px/1.35 Nunito,system-ui,sans-serif;text-align:center;pointer-events:none';
    ui.append(el);
    let at = 0, timer = 0;
    const paint = () => {
      const t = ctx.state.classic ? '' : pauseWarnText(at, Date.now());   // the classic site shows its own line
      if (el.textContent !== t) el.textContent = t;
      el.hidden = !t;
      if (!t && timer && at <= Date.now()) { clearInterval(timer); timer = 0; }
    };
    const onPz = (d: unknown) => {
      at = pauseWarnAt(d as PauseEvent);
      if (at && !timer) timer = window.setInterval(paint, 1000);
      paint();
    };
    const off = bus.on('sse:pz', onPz);
    return () => { off(); if (timer) clearInterval(timer); el.remove(); };
  },
});
