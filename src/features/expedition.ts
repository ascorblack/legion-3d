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
 *
 * District town at the stop (owner bug 31.10): while the party stands in a ★1–2 district town the site's «Поход» tab
 * shows «🏘 Войти в город «name»» (quest.js tabHtml: q.town && hero.cy && hero.tw → app.js openTown: townEntry,
 * LGCity.town(id), tab('city'); no request of its own). The HUD shows the same button (src/net/city-tab.ts questTown)
 * and the hint says the town is open. Click, expedition-only game: enterQuestTown presses the site's own button, then
 * 'l3d:return-city' reboots the normal city game in that town. Click, city game: LGCity.town(id) like travel. Back to
 * the expedition: Q (the site: its «Поход» banner / tab, which ends townEntry).
 */
import type { RoomScene } from '../contracts/ext';
import { ExpeditionView } from '../expedition';
import { coreFeature } from './types';
import { emptyParty, q2Of } from '../quest/model';
import { questTown, cityTownShown, enterQuestTown, type QuestTown } from '../net/city-tab';
import { RETURN_EVENT } from './expedition-only';

const HINT_LOCKED = 'мышь — осмотреться · колесо — ближе/дальше · город закрыт до конца похода · <b>F8</b> — сайт';
const escH = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
/** The hint while the party stands in a district town the hero may enter. */
export const hintTown = (name: string) => `мышь — осмотреться · колесо — ближе/дальше · отряд в городе «${escH(name)}» — можно войти · <b>F8</b> — сайт`;

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
      me: () => ({ login: login(), role: String((store.hero as any)?.role || 'recruit'), q2: q2Of(store.hero) }),
      hintBottom: 58,
      // expedition-only game: Q does not leave (no city to go back to)
      ...(ctx.state.expeditionOnly ? { hint: HINT_LOCKED } : {}),
      appOf: (l) => (l === login() ? store.me?.app ?? null : store.walkers.get(l)?.app ?? null),
    });
    ctx.dev.expedition = view;

    let active = false, prompted = false, wasOn = false, wasLive = false;
    let saved: { mode: typeof ctx.state.mode; meVis: boolean; labels: boolean; fov: number } | null = null;
    let lastYaw = 0, lastPitch = 0;
    const emit = () => { try { W.dispatchEvent(new CustomEvent('l3d:expedition', { detail: { active, onAir: view.onAir, expOnly } })); } catch { /* */ } };

    /* ---- district town at the stop (owner bug 31.10): the site's «Войти в город «…»» in 3D ----
       quest.js shows it when q.town && hero.cy && hero.tw; app.js openTown lets a party member into the locked City.
       Expedition-only game: the click presses the site's own button (enterQuestTown), then the game reboots as the
       normal city game in that town ('l3d:return-city'). City game (City not locked): LGCity.town(id), like travel. */
    let townKey = '', entering = false, hereTown = '';
    const goTown = async (t: QuestTown) => {
      if (entering) return;
      entering = true; view.hud?.setTownBusy(true);
      try {
        if (expOnly) {
          ctx.veil(`Входим в город «${t.name}»`);
          const r = await enterQuestTown(t.id);
          ctx.veil(null);
          if (r === 'ok') { W.dispatchEvent(new CustomEvent(RETURN_EVENT)); return; }
          ctx.ui.toast(r === 'no_button' ? 'Сайт не показал кнопку входа в город — открой «Поход» на сайте (F8)' : 'Город не открылся — сайт не ответил. Попробуй ещё раз или F8', true);
        } else {
          if (typeof W.LGCity?.town !== 'function') { ctx.ui.toast('Сайт изменился: войти в город можно на классическом сайте (F8)', true); return; }
          leave(false);
          if (ctx.layout()?.id === t.id) return;
          ctx.veil(`Дорога в ${t.name}`);
          let timer = 0;
          const off = ctx.onWorld(() => { if (ctx.layout()?.id !== t.id) return; clearTimeout(timer); off(); ctx.veil(null); ctx.ui.toast(`Ты в городе «${t.name}» · Q — смотреть поход`); });
          timer = window.setTimeout(() => { off(); ctx.veil(null); ctx.ui.toast('Не получилось войти в город: сайт не ответил.', true); }, 12000);
          try { W.LGCity.town(t.id); } catch (e) { console.warn('[l3d] expedition: LGCity.town failed', e); clearTimeout(timer); off(); ctx.veil(null); }
        }
      } finally { entering = false; view.hud?.setTownBusy(false); }
    };
    const syncTown = () => {
      const t = questTown(store.quest, store.hero);
      // city game already standing in that town: no button (Q leaves the view); remember it for the «leaving» toast
      const here = !!t && !expOnly && (ctx.layout()?.id === t.id || cityTownShown() === t.id);
      if (here) hereTown = t!.name;
      else if (!t && hereTown) { if (store.quest?.on) ctx.ui.toast(`Отряд уходит из «${hereTown}» · Q — смотреть поход`); hereTown = ''; }
      const show = t && !here ? t : null;
      const key = show ? `${show.id}|${show.name}` : '';
      if (key !== townKey) { townKey = key; view.setTown(show ? { name: show.name, go: () => { void goTown(show); } } : null); }
      if (expOnly) view.setHint(t ? hintTown(t.name) : HINT_LOCKED);
    };
    const offHero = store.on('hero', syncTown);

    const onQuest = () => {
      const v = store.quest;
      if (!v) return;
      view.push(v);
      syncTown();
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
      offQ(); offHero(); offKey(); offFrame(); offRoom();
      W.removeEventListener('l3d:expedition-toggle', onToggle);
      canvas.removeEventListener('wheel', onWheel);
      delete ctx.dev.expedition;
    };
  },
});
