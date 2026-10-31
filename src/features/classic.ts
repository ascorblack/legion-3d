/**
 * Classic toggle: back to the original site (F8 / menu) and resume the 3D game from where the 2D hero walked.
 *
 * A 3D room is NOT left on F8 (0.6.1 left it: F8 in the 3D mine sent the mine leave and the second F8 came back on the
 * street). The 3D is hidden and paused — engine.pause(true): no requestAnimationFrame, no render, no room frame hooks —
 * and comes back in the same room. On resume a room is left only when the site changed scene meanwhile: the 2D hero
 * walked away from it (shops, hybrid rooms; a hybrid panel closed in 2D is left by the overlay watcher); the 3D mine is
 * handed to / taken back from the site's own 2D mine by src/features/mine-hold.ts, told by the window event VIEW_EVENT.
 */
import { coreFeature } from './types';

/** Window event after every switch: detail {classic: boolean, reason?: 'panel'} ('panel' = a site panel was asked for). */
export const VIEW_EVENT = 'l3d:view';
/** The 2D hero moved this far (px) while the classic site was shown: he walked away from the room he stood in. */
export const WALKED_PX = 40;
/** Input hold id while a text field keeps the keyboard over F8 back (released on its blur). */
export const TYPING_HOLD = 'classic:typing';

export default coreFeature({
  id: 'classic',
  order: 70,
  setup(ctx) {
    const { engine, input, site, hostEl, uiRoot, state } = ctx;
    const G = ctx.game;
    let spAt: [number, number] | null = null;   // the site's hero position when 3D was hidden
    const emit = (classic: boolean, reason?: string) => {
      try { window.dispatchEvent(new CustomEvent(VIEW_EVENT, { detail: { classic, reason } })); } catch (e) { console.warn('[l3d] view event', e); }
    };
    G.toClassic = (reason?: string) => {
      if (G.classic) return;
      G.classic = true; state.classic = true;
      engine.pause(true); input.unlock(); input.setGameplay(false);
      hostEl.style.display = 'none'; uiRoot.style.display = 'none';
      spAt = site.selfPos();
      site.setClassic(true);
      document.getElementById('l3d-launch')?.classList.remove('hide');
      emit(true, reason);
    };
    G.resume = () => {
      if (!G.classic) return;
      G.classic = false; state.classic = false;
      site.setClassic(false);
      // the hero may have walked in the 2D city: continue from the site's position (site.setClassic synced store.me)
      const sp = site.selfPos();
      const far = (a: readonly number[] | null, b: readonly number[] | null) => !!a && !!b && Math.hypot(a[0] - b[0], a[1] - b[1]) > WALKED_PX;
      if (ctx.rooms.current && ctx.rooms.kind !== 'mine3d' && far(sp, spAt)) ctx.rooms.exit();   // walked away from the shop / room in 2D
      if (!ctx.rooms.current) {   // inside a room the controller walks room metres: never teleport it to a street position
        const ctl = ctx.controller();
        if (sp && far(sp, [ctl.x, ctl.y])) { ctl.teleport(sp[0], sp[1]); ctx.me.x = sp[0]; ctx.me.y = sp[1]; }
      }
      spAt = null;
      hostEl.style.display = ''; uiRoot.style.display = '';
      const blocking = !!state.overlay && !state.overlayOver3d;
      // setGameplay is the WISH (src/engine/input.ts derives effective gameplay: no modal, no hold, no text focus). A text
      // field that kept the keyboard over the switch (the site's chat input, our chat in the UI's shadow root) additionally
      // holds gameplay off until it loses focus — F8 back never hands WASD to the game from under a focused chat (QA r3)
      holdWhileTyping();
      engine.pause(blocking); input.setGameplay(!state.menu && !blocking);
      document.getElementById('l3d-launch')?.classList.add('hide');
      emit(false);
    };
    G.classicPanel = () => G.toClassic('panel');
    /** The focused text field (through open shadow roots), or null. */
    const typingEl = (): HTMLElement | null => {
      let el = (typeof document !== 'undefined' ? document.activeElement : null) as HTMLElement | null;
      while (el && el.shadowRoot && el.shadowRoot.activeElement) el = el.shadowRoot.activeElement as HTMLElement;
      return el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable) ? el : null;
    };
    const holdWhileTyping = () => {
      const el = typingEl(), inp = input as typeof input & { hold?(id: string, on: boolean): void };
      if (!el || typeof inp.hold !== 'function') return;
      inp.hold(TYPING_HOLD, true);
      el.addEventListener('blur', () => inp.hold!(TYPING_HOLD, false), { once: true });
    };
  },
});
