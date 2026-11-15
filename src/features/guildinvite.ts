/**
 * Guild invitations (site 15.11, site-chat.js): a guild member may invite a player from the chat's nick menu; the invitee
 * gets the live guild-chat event `{ k: 'inv', g, tag, name, by }` and the site pops the plaque `#cy-ginv` on <body>
 * (role alertdialog, «Гильдия [TAG] Name приглашает тебя» + «Принять» / «Отклонить» / ×) and focuses «Принять».
 * In 3D: the plaque (site z 70, under our canvas z 100) is lifted over it below the compass (GINV_CSS, light DOM), its focus grab is undone while the game owns the input
 * (src/engine/input.ts FOCUS_GRAB_SEL: Enter / Space would accept it), and under a locked pointer this toast says how to
 * answer it with the mouse. Read-only: the answer is the player's own click on the site's buttons.
 */
import { coreFeature } from './types';

/** The toast when the plaque appears while the pointer is locked. */
export const GINV_HINT = 'Приглашение в гильдию — нажми Esc и ответь мышью на плашке вверху';
/** Our lift for the site's plaque: over the 3D (z 166, like the site's name menu), below the compass; not in the classic
 *  site (no html.l3d-on) nor while a site screen hides the game (#l3d-ui[hidden]) — then the site's own place is right. */
export const GINV_CSS = 'html.l3d-on:not(:has(#l3d-ui[hidden])) .cy-ginv { z-index: 166 !important; top: 64px !important; }';
/** Is this node the site's guild invite plaque? */
export const isGinv = (n: unknown): boolean => !!n && (n as Element).nodeType === 1 && (n as Element).id === 'cy-ginv';

export default coreFeature({
  id: 'guildinvite',
  order: 238,
  setup(ctx) {
    if (typeof MutationObserver !== 'function' || !document.body) return;
    const css = document.createElement('style'); css.id = 'l3d-ginv-css'; css.textContent = GINV_CSS; document.head.appendChild(css);
    const mo = new MutationObserver((recs) => {
      for (const r of recs) for (const n of Array.from(r.addedNodes)) {
        if (!isGinv(n) || ctx.state.classic) continue;
        if (document.pointerLockElement) ctx.ui.toast(GINV_HINT);
        return;
      }
    });
    mo.observe(document.body, { childList: true });   // the site appends it to <body> itself (not the subtree)
    return () => { mo.disconnect(); css.remove(); };
  },
});
