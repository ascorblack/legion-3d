/**
 * Site overlay watcher. The site's own full-screen screens (building interiors .cy-room, the mine .mn, trade,
 * dialogs) sit above or below our canvas. While one is open the game hides and pauses itself and comes back after —
 * EXCEPT the building panel of a hybrid room, which is shown over our live 3D room (state.overlayOver3d): then the
 * canvas stays, and when that panel goes away (the site's «Выйти») the room is left too.
 * Esc closes the site's building interior (the site has no Esc handler there), or leaves our 3D room.
 * Scene mode (rooms.stage): a «Выйти на улицу» button in the corner of the free part of the screen (above the site's
 * transparent room layer) leaves the room as well.
 */
import { coreFeature } from './types';

export default coreFeature({
  id: 'overlay',
  order: 60,
  setup(ctx) {
    const { site, input, state, hostEl, uiRoot, engine, rooms } = ctx;
    let shownOver = false;   // the hybrid panel was seen open (it takes a moment to appear)
    let blocking = false;
    const tick = () => {
      const showBtn = !!rooms.stage && !state.menu && !state.classic;
      if (btn.hidden === showBtn) btn.hidden = !showBtn;
      if (state.classic) return;
      const ov = site.overlay();
      if (rooms.panel) {
        if (ov === 'room') shownOver = true;
        else if (shownOver && !ov) { shownOver = false; rooms.panelClosedBySite(); }
      } else shownOver = false;
      state.overlay = ov;
      const nb = !!ov && !(state.overlayOver3d && ov === 'room');
      if (nb === blocking) return;
      blocking = nb;
      if (nb) {
        input.unlock(); input.setGameplay(false);
        hostEl.hidden = true; uiRoot.hidden = true;   // [hidden], not visibility: the UI's shadow :host{all:initial} would undo an inherited visibility
        engine.pause(true);
      } else {
        hostEl.hidden = false; uiRoot.hidden = false;
        engine.pause(false); input.setGameplay(!state.menu);
      }
    };
    const timer = window.setInterval(tick, 250);
    const offK = ctx.registries.keys.register('overlay.close', {
      code: 'Escape', label: 'Выйти из здания (без интерьера)', when: 'always',
      run: () => {
        if (state.menu) return false;
        // Esc leaves only scene-mode rooms (a panel over a fixed shot: no door to walk to). In walkable 3D rooms (the
        // mine, 3D shops) Esc is the pause menu like on the street — a few Esc presses used to throw you out of the
        // mine; you leave those through the door (E).
        if (rooms.current) { if (!rooms.stage) return false; rooms.exit(); return true; }
        if (state.overlay === 'room') { site.closeOverlay(); return true; }
        return false;
      },
    });
    // «Выйти на улицу» in scene mode
    const btn = document.createElement('button');
    btn.type = 'button'; btn.id = 'l3d-scene-exit'; btn.textContent = '🚪 Выйти на улицу'; btn.hidden = true;
    btn.title = 'Вернуться на улицу (Esc)';
    btn.style.cssText = 'position:fixed;top:78px;z-index:201;padding:9px 16px;border:1.5px solid #ffcf6a;border-radius:999px;'
      + "background:rgba(13,11,34,.82);color:#ffe9a8;font:800 14px/1.2 'Golos Text','Nunito',sans-serif;cursor:pointer;"
      + 'box-shadow:0 6px 18px rgba(0,0,0,.35)';
    btn.addEventListener('click', (e) => { e.preventDefault(); rooms.exit(); });
    document.body.appendChild(btn);
    const offRooms = rooms.onChange(() => {
      const st = rooms.stage;
      btn.hidden = !st || !!state.menu;
      if (st) { const right = st.side !== 'right'; btn.style.right = right ? '18px' : ''; btn.style.left = right ? '' : '18px'; }
    });
    return () => { window.clearInterval(timer); offK(); offRooms(); btn.remove(); };
  },
});
