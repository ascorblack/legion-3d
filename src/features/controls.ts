/**
 * Controls: E = use the target (aimed or nearby), F = the target's secondary action (alt, «Осмотреть»). Like in games,
 * the mouse NEVER interacts with the world: LMB = swing / attack (src/features/combat.ts), RMB = block. Doors, goods,
 * mine stones, NPCs, benches and signs are used only with E (and F); the aim highlight and the «[E] …» prompt show what
 * E would use. Space (jump) is read by the player controller from input.consumeJump(). The first click on the canvas
 * grabs the pointer — on the street and in rooms without a stage. DOM UI (menus, cards, the site's panels) still
 * works by click: those are not world interactions.
 *
 * Scene mode (rooms.stage, hybrid rooms): the pointer is NEVER grabbed and clicks on the 3D view do nothing; E uses
 * the NPC / desk the hero stands at; RMB drag orbits the shot (src/features/camera.ts).
 */
import { coreFeature } from './types';

export default coreFeature({
  id: 'controls',
  order: 45,
  setup(ctx) {
    const { input, interact, vm, meAv, rooms } = ctx;
    const el = ctx.engine.renderer.domElement;
    const offE = ctx.registries.keys.register('interact.use', {
      code: 'KeyE', label: 'Действие / войти',
      run: () => interact.use('key'),
    });
    const offF = ctx.registries.keys.register('interact.alt', {
      code: 'KeyF', label: 'Второе действие (осмотреть)',
      run: () => { const t = interact.target; if (!t?.alt) return false; try { t.alt.use(); } catch (e) { console.error('[l3d] alt', t.id, e); } return true; },
    });
    const down = (e: MouseEvent) => {
      if (ctx.state.menu) return;
      if (rooms.busy) return;   // loading a room: never grab the pointer for a scene that may be a hybrid one
      if (rooms.stage) return;  // scene mode: the cursor stays free, clicks on the 3D view never use anything (E does)
      if (!input.locked) {
        input.lock();
        return;
      }
      if (!ctx.gameplay()) return;
      // LMB never interacts (no interact.use here): it is a swing even when the crosshair is on a door, a good or a stone
      if (e.button === 0) { vm.swing(); meAv.play('swing'); }
      if (e.button === 2) vm.block(true);
    };
    const up = (e: MouseEvent) => { if (e.button === 2) vm.block(false); };
    const menu = (e: Event) => e.preventDefault();
    el.addEventListener('mousedown', down);
    window.addEventListener('mouseup', up);
    el.addEventListener('contextmenu', menu);
    return () => {
      offE(); offF();
      el.removeEventListener('mousedown', down);
      window.removeEventListener('mouseup', up); el.removeEventListener('contextmenu', menu);
    };
  },
});
