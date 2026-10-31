/**
 * «Эмоции — полноценный круг» (owner request 2026-10-27): hold Z → a wheel of 8 emotes (помахать, танец, смех, мур,
 * сесть, плакать, фыр, поклон); move the mouse towards one and let Z go → the own cat plays it with the matching face
 * (src/avatar/face.ts moods), a small emoji bubble, a cute sound and a few particles. In first person the camera
 * swings out to third person for the emote and back. Releasing Z in the centre, Esc, a menu or a modal cancels.
 *
 * LOCAL ONLY: nothing is sent to the site, other players do not see it (a relay may come later, see
 * plans/server-proposal.md). Setting: Настройки → Забавы → «Круг эмоций».
 * Cost: one DOM node (hidden), bone tweaks on the own avatar, particles in the shared fun Fx.
 */
import type { Avatar } from '../contracts/modules';
import type { AvatarSocial } from '../avatar/avatar';
import type { CombatAvatar } from '../combat/ragdoll';
import { EMOTES, WHEEL, wheelIndex, clampToRim, type EmoteDef, type EmoteId } from '../emotes/defs';
import { poseEmote, EmoteFx } from '../emotes/anims';
import { EmoteWheel } from '../emotes/wheel';
import { TpPeek } from '../emotes/tp';
import { acquireFunFx } from '../combat/funfx';
import { isTyping, onPageKeys, type InputEx } from '../engine/input';
import { funToggle, reducedMotion, sfx } from '../social/toggle';
import { coreFeature } from './types';

const KEY = 'l3d.fun.emotes';
export const EMOTE_KEY = 'KeyZ';

type MeAv = Avatar & Partial<AvatarSocial> & CombatAvatar;

export default coreFeature({
  id: 'emotes',
  order: 27,   // after combat (25) and cheer (26): our bone overrides are the last word on the own avatar
  setup(ctx) {
    const { input, rooms, engine } = ctx;
    const inp = input as InputEx;
    const tg = funToggle(KEY, 'Круг эмоций (Z)', 'Держи Z, веди мышью к эмоции и отпусти: котик машет, танцует, мурчит… Видишь только ты', 60, (on) => { if (!on) { close(false); stop(); } });
    const reduced = reducedMotion();
    const wheel = new EmoteWheel(ctx.uiRoot);
    const fun = acquireFunFx({ scene: ctx.scene, camera: ctx.camera, onFrame: ctx.onFrame, viewHeight: () => engine.renderer.domElement.height || 720 });
    const efx = new EmoteFx();
    const peek = new TpPeek(ctx);
    const ptr = { x: 0, y: 0 };
    let photo = false;
    let cur: { def: EmoteDef; t: number } | null = null;

    const canOpen = () => tg.on && !photo && ctx.gameplay() && input.gameplay && !isTyping() && !rooms.stage && (inp.modals?.length ?? 0) === 0;

    function openWheel() {
      if (wheel.open || !canOpen()) return false;
      ptr.x = 0; ptr.y = 0;
      wheel.show(true);
      return true;
    }
    function close(pick: boolean) {
      if (!wheel.open) return;
      const i = wheelIndex(ptr.x, ptr.y);
      wheel.show(false);
      if (pick && i >= 0 && canOpen()) play(EMOTES[i].id);
    }

    function stop() {
      if (!cur) return;
      const av = ctx.meAv as MeAv;
      if (cur.def.id === 'sit') av.setSit?.(false);
      av.setMood?.(null);
      cur = null;
      peek.end();
    }
    function play(id: EmoteId) {
      const def = EMOTES.find((e) => e.id === id); if (!def) return;
      stop();
      const av = ctx.meAv as MeAv;
      cur = { def, t: 0 };
      efx.reset();
      if (def.play) av.play(def.play);
      if (def.id === 'sit') av.setSit?.(true);
      av.setMood?.(def.mood, def.len);
      ctx.labels.bubble(ctx.me.login, def.emoji, 1700);
      const f = ctx.feet;
      if (def.sfx) sfx(def.sfx, { x: f.x, y: f.y + 0.8, z: f.z });
      peek.start(Math.min(def.len, 4) + 0.5);
      // turn to the camera so the face shows (only when standing; walking keeps its heading)
      const ctl = ctx.controller();
      if (ctx.state.mode === 'tp' && ctl.speed < 25 && !ctx.state.menu) { ctl.setFace(ctx.rig.yaw + Math.PI); ctx.me.face = ctl.face; }
    }

    const offKey = ctx.registries.keys.register('emotes.wheel', {
      code: EMOTE_KEY, label: 'Эмоции (держи и веди мышью)',
      run: (_c, e) => { if (e.repeat) return true; return openWheel(); },
    });
    const onKeyUp = (e: KeyboardEvent) => { if (e.code === EMOTE_KEY) close(true); };
    const onKeyDown = (e: KeyboardEvent) => { if (wheel.open && e.code === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); close(false); } };
    // while the wheel is open the mouse steers its pointer, not the camera (window capture runs before the input's
    // document listener)
    const onMove = (e: MouseEvent) => {
      if (!wheel.open) return;
      if (document.pointerLockElement) { ptr.x += e.movementX; ptr.y += e.movementY; }
      else { ptr.x = e.clientX - window.innerWidth / 2; ptr.y = e.clientY - window.innerHeight / 2; }
      clampToRim(ptr, WHEEL.rim);
      wheel.highlight(wheelIndex(ptr.x, ptr.y), ptr.x, ptr.y);
      e.stopImmediatePropagation();
    };
    const onBlur = () => close(false);
    const onPhoto = (e: Event) => { photo = !!(e as CustomEvent).detail?.on; if (photo) { close(false); stop(); } };
    const offUp = onPageKeys('keyup', onKeyUp);   // before the input's site key shield stops it
    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('mousemove', onMove, true);
    window.addEventListener('blur', onBlur);
    window.addEventListener('l3d:photo', onPhoto);

    const offFrame = ctx.onFrame((dt, t) => {
      if (wheel.open && !canOpen()) close(false);
      peek.update(dt);
      if (!cur) return;
      cur.t += dt;
      const def = cur.def, k = cur.t / def.len, ctl = ctx.controller();
      // walking off ends the still emotes (after a short grace so a key held while choosing does not cancel it)
      if (k >= 1 || (def.still && cur.t > 0.3 && (ctl.speed > 25 || (ctl.airborne && !ctl.flying))) || ctx.state.classic) { stop(); return; }
      const av = ctx.meAv as MeAv, rig = av.combatRig?.() ?? null;
      if (rig) {
        poseEmote(def.id, rig, k, cur.t, reduced);
        if (def.id === 'sit') av.root.position.y -= (av.sitDrop ?? 0.1) * Math.min(1, cur.t * 6, (1 - k) * 12);
      }
      efx.emit(fun.fx, def.id, dt, k, av.root, rig, engine.quality, reduced);
      void t;
    });

    ctx.dev.emotes = {
      wheel, ptr, play, stop,
      open: () => { const r = openWheel() || (wheel.show(true), true); return r; },
      point: (x: number, y: number) => { ptr.x = x; ptr.y = y; clampToRim(ptr); wheel.highlight(wheelIndex(ptr.x, ptr.y), ptr.x, ptr.y); },
      release: () => close(true),
      get current() { return cur?.def.id ?? null; },
    };

    return () => {
      offFrame(); offKey(); tg.dispose(); stop(); peek.end();
      offUp();
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('mousemove', onMove, true);
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('l3d:photo', onPhoto);
      wheel.dispose(); fun.release();
      delete ctx.dev.emotes;
    };
  },
});
