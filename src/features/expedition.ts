/**
 * Expedition in 3D (src/expedition): while a «поход» runs (SSE `q`, store.quest), Q opens a spectator 3D view of it —
 * the camp at the gate, the crossroads vote, the road through the biome, battles, the boss, vignettes and the loot —
 * driven ONLY by the delayed views (stream delay, like the site), with the «what to type in chat» strip on top.
 * Q again (or the end of the expedition) returns to the city where you stood. F8 (classic site) keeps working.
 * Nothing is ever sent to the site from here.
 *
 * How it sits in the game: the scene is a RoomScene swapped in with ctx.setSpace (city hidden, the walk space is empty,
 * the own avatar hidden); this feature's frame hook runs after the camera rig and places the camera itself (cinematic
 * orbit; mouse look = the rig's yaw/pitch deltas, wheel = zoom). Also registers the room kind 'expedition'.
 * The quest HUD card (src/quest) shows «Смотреть в 3D [Q]»: it talks to us through window events
 * 'l3d:expedition' (detail {active, onAir}) and 'l3d:expedition-toggle'.
 *
 * Expedition-only game (ctx.state.expeditionOnly — the hero is in the party, the site's City is locked; see
 * src/features/expedition-only.ts): there is no city to return to, so the view opens by itself as soon as a running
 * view is known, stays on after the end (the last picture, the «Вернуться в город» card is shown over it) and Q does
 * not close it.
 */
import type { RoomScene } from '../contracts/ext';
import { ExpeditionView } from '../expedition';
import { coreFeature } from './types';
import { emptyParty } from '../quest/model';

export default coreFeature({
  id: 'expedition',
  order: 82,   // after the quest HUD (80): its card listens to our events
  setup(ctx) {
    const W = window as any;
    const { store } = ctx;
    const expOnly = !!ctx.state.expeditionOnly;
    const login = () => String(store.me?.login || (store.hero as any)?.login || '').toLowerCase();
    const view = new ExpeditionView({
      uiRoot: ctx.uiRoot,
      kit: ctx.kit,
      style: String(ctx.player.app?.styleId || 'cats'),
      quality: () => ctx.quality() as number,
      me: () => ({ login: login(), role: String((store.hero as any)?.role || 'recruit') }),
      hintBottom: 58,
      // expedition-only game: Q does not leave (no city to go back to)
      ...(ctx.state.expeditionOnly ? { hint: 'мышь — осмотреться · колесо — ближе/дальше · город закрыт до конца похода · <b>F8</b> — сайт' } : {}),
      appOf: (l) => (l === login() ? store.me?.app ?? null : store.walkers.get(l)?.app ?? null),
    });
    ctx.dev.expedition = view;

    let active = false, prompted = false, wasOn = false, wasLive = false;
    let saved: { mode: typeof ctx.state.mode; meVis: boolean; labels: boolean; fov: number } | null = null;
    let lastYaw = 0, lastPitch = 0;
    const emit = () => { try { W.dispatchEvent(new CustomEvent('l3d:expedition', { detail: { active, onAir: view.onAir, expOnly } })); } catch { /* */ } };

    const onQuest = () => {
      const v = store.quest;
      if (!v) return;
      view.push(v);
      const on = view.onAir;
      if (expOnly) { if (on && !active) enter(); }
      // the toast once per running expedition; not for the empty party (v.nb: nobody joined — nothing «идёт»)
      const live = on && !emptyParty(v);
      if (!expOnly && live && !wasLive && !prompted && !active) { prompted = true; ctx.ui.toast('Поход идёт — смотреть в 3D [Q]'); }
      if (!live) prompted = false;
      wasLive = live;
      if (on !== wasOn) { wasOn = on; emit(); }
    };
    const offQ = store.on('quest', onQuest);

    const enter = () => {
      if (active || !view.onAir) return;
      try {
        if (ctx.rooms.current) ctx.rooms.exit();
        if (ctx.state.menu) ctx.ui.open(null);
        const sc = view.open(ctx.scene);
        saved = { mode: ctx.state.mode, meVis: ctx.meAv.root.visible, labels: ctx.labels.root.visible, fov: ctx.camera.fov };
        ctx.setSpace(sc as unknown as RoomScene);
        ctx.state.mode = 'tp'; ctx.applyCamera(true);
        ctx.meAv.root.visible = false; ctx.labels.root.visible = false;
        lastYaw = ctx.rig.yaw; lastPitch = ctx.rig.pitch;
        active = true;
        emit();
      } catch (e) {
        console.error('[l3d] expedition 3D failed', e);
        leave(false);
        ctx.ui.toast('Не получилось открыть поход в 3D', true);
      }
    };
    const leave = (toast: boolean) => {
      const was = active;
      active = false;
      view.close();
      if (saved) {
        try { ctx.setSpace(null); } catch (e) { console.error('[l3d] expedition leave', e); }
        ctx.state.mode = saved.mode; ctx.applyCamera(true);
        ctx.meAv.root.visible = saved.meVis; ctx.labels.root.visible = saved.labels;
        ctx.camera.fov = saved.fov; ctx.camera.updateProjectionMatrix();
        saved = null;
      }
      if (was) { emit(); if (toast) ctx.ui.toast('Поход окончен — ты снова в городе'); }
    };
    const toggle = () => {
      if (expOnly) { if (!active && view.onAir) enter(); else if (active) ctx.ui.toast('Город закрыт, пока ты в походе · F8 — классический сайт'); return; }
      if (active) leave(false); else if (view.onAir) enter(); else ctx.ui.toast('Сейчас поход не идёт'); };
    const onToggle = () => toggle();
    W.addEventListener('l3d:expedition-toggle', onToggle);

    const offKey = ctx.registries.keys.register('expedition.toggle', {
      code: 'KeyQ', label: 'Поход в 3D (пока идёт поход)', when: 'gameplay',
      run: () => { if (!active && !view.onAir) return false; toggle(); return true; },
    });

    // wheel = zoom of the cinematic camera
    const canvas = ctx.engine.renderer.domElement;
    const onWheel = (e: WheelEvent) => { if (active) view.scene?.zoom(Math.sign(e.deltaY)); };
    canvas.addEventListener('wheel', onWheel, { passive: true });

    // expedition-only: the view opened during setup, before later features (compass, …) listened — say it once more
    let announced = !expOnly;
    const offFrame = ctx.onFrame((dt, t) => {
      if (!announced) { announced = true; emit(); }
      if (!active) return;
      if (!view.onAir && !expOnly) { leave(true); return; }
      // somebody else swapped the space (a room was entered): give up quietly
      if (ctx.rooms.current) { leave(false); return; }
      const sc = view.scene;
      if (!sc) return;
      const dy = ctx.rig.yaw - lastYaw, dp = ctx.rig.pitch - lastPitch;
      lastYaw = ctx.rig.yaw; lastPitch = ctx.rig.pitch;
      if (dy || dp) sc.look(dy, -dp);
      view.frame(dt, t, ctx.camera);
    });

    const offRoom = ctx.registries.rooms.register('expedition', {
      title: 'Поход',
      // the room kind for completeness (no building opens it): the same scene, fed from the store
      create: async () => { const sc = view.open(ctx.scene); return sc as unknown as RoomScene; },
    });

    onQuest();   // after `enter` / `leave` exist (expedition-only: opens the view at once)

    return () => {
      leave(false);
      offQ(); offKey(); offFrame(); offRoom();
      W.removeEventListener('l3d:expedition-toggle', onToggle);
      canvas.removeEventListener('wheel', onWheel);
      delete ctx.dev.expedition;
    };
  },
});
