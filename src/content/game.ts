/**
 * The game core: engine bootstrap, the shared GameContext, the feature runner and the frame order.
 * Everything else (camera modes, crowd, labels, doors, rooms, quest HUD, settings, overlays, classic toggle…) is a
 * feature in src/features/* (ordered list in src/features/index.ts).
 *
 * Frame order (one engine.onFrame):
 *   1. look       input.consumeLook → rig yaw/pitch (gameplay only), wheel → zoom
 *   2. player     controller.update (city px space or room metres) → me.x/y, site.moveTo (city only)
 *   3. site       site.tick (other walkers)
 *   4. me         own avatar at the feet, view-model
 *   5. camera     rig.follow(feet) + rig.update
 *   6. features   ctx.onFrame hooks in feature order (crowd → labels → …)
 *   7. world      world.update (city) or rooms.update (active room)
 *   8. interact   crosshair/proximity target → HUD prompt; ui.update
 * Used by the extension (src/content/main.ts) and by the offline demo (dev/game.ts, fake SiteSession).
 *
 * Expedition-only mode (opts.expeditionOnly, src/net/expedition-site.ts): the hero is in an expedition party and the
 * site's City is locked — no city world is built (an empty stand-in World3D), only the features of
 * EXP_ONLY_FEATURES run, and src/features/expedition-only.ts opens the 3D expedition at once. Game.dispose() tears the
 * whole game down so the launcher can boot the city in place afterwards («Вернуться в город»).
 */
import * as THREE from 'three';
import type { World3D, Unsub, Appearance } from '../contracts';
import type { SiteSession, UiHost } from '../contracts/modules';
import type { Interactable, RoomScene, World3DExt } from '../contracts/ext';
import { setAppearanceFn, siteDefaults } from '../net/site';
import { createEngine, createInput, createCameraRig, createPlayerController, layoutColliderBoxes, isTyping, type WalkSpace } from '../engine';
import { buildCity, createSvgArt } from '../world';
import { createAvatarKit, createLabels, appearanceFrom, RECOMMENDED_NEAR, type ViewModelEx } from '../avatar';
import { mountUi } from '../ui';
import { EYE, toX, toZ } from '../world/coords';
import type { CoreContext, Game, GameState } from '../core/context';
import { createRegistries } from '../core/registries';
import { createInteractSystem } from '../core/interact';
import { createRoomManager, type RoomHost } from '../core/rooms';
import { reportDrift } from '../core/drift';
import { SET } from '../core/settings';
import { runFeatures, FEATURES } from '../features';
import { EXP_ONLY_FEATURES } from '../features/expedition-only';

declare const __DEV__: boolean;
const W = window as any;

export type { Game };

export interface StartOpts {
  /** Hero in an expedition party, City locked: no city world, only EXP_ONLY_FEATURES (src/net/expedition-site.ts). */
  expeditionOnly?: boolean;
}

export async function startGame(site: SiteSession, status: (s: string) => void, opts: StartOpts = {}): Promise<Game> {
  const store = site.store;
  const expOnly = !!opts.expeditionOnly;
  setAppearanceFn((login, raw, styleId) => appearanceFrom(login, raw, styleId, (l: string) => siteDefaults(l) as any));
  // re-resolve looks for walkers created before the hook
  for (const w of store.walkers.values()) w.app = appearanceFrom(w.login, (w as any).raw || {}, w.app.styleId, (l: string) => siteDefaults(l) as any);
  if (store.me && store.hero) {
    const h = store.hero as any;
    store.me.app = appearanceFrom(store.me.login, { ...h, n: h.name, lv: h.level, lk: h.wardrobe?.cur && Object.keys(h.wardrobe.cur).length ? h.wardrobe.cur : h.look, g: h.gear, gh: h.ghost ? 1 : 0 }, store.me.app.styleId, (l: string) => siteDefaults(l) as any);
  }

  const hostEl = document.createElement('div'); hostEl.id = 'l3d-host';
  document.body.appendChild(hostEl);
  const uiRoot = document.createElement('div'); uiRoot.id = 'l3d-ui'; document.body.appendChild(uiRoot);
  const cleanupDom = () => { hostEl.remove(); uiRoot.remove(); };

  let engine: ReturnType<typeof createEngine>;
  try { engine = createEngine({ host: hostEl, quality: 'auto' }); } catch (e) { cleanupDom(); throw e; }
  try {
    return await boot();
  } catch (e) {
    try { engine.dispose(); } catch { /* */ }
    cleanupDom();
    throw e;
  }

  async function boot(): Promise<Game> {
    const input = createInput(engine.renderer.domElement);
    engine.camera.near = RECOMMENDED_NEAR; engine.camera.updateProjectionMatrix();
    const rig = createCameraRig(engine.camera);
    const layout = store.layout!;

    status(expOnly ? 'Собираем поход…' : 'Строим улицы…');
    let world: World3D = expOnly ? emptyWorld()
      : await buildCity(layout, { quality: engine.quality, renderer: engine.renderer, art: createSvgArt(layout) ?? undefined });
    engine.scene.add(world.root);
    engine.onQuality((q) => world.setQuality(q));
    const worldFns = new Set<(w: World3D) => void>();

    const kit = createAvatarKit();
    const labels = createLabels();
    engine.scene.add(labels.root);

    /* ---- me + controller ---- */
    const me = store.me!;
    const start = site.selfPos() || world.spawn;
    const citySpace = (w: World3D, L = store.layout!): WalkSpace => {
      const x = w as World3D & Partial<World3DExt>;
      return {
        free: (px, py) => L.free(px, py),
        groundAt: (px, py) => w.groundAt(px, py),
        solidTop: typeof x.solidTop === 'function' ? (px, py) => x.solidTop!(px, py) : undefined,
        path: L.path ? (a, b) => L.path!(a, b) : undefined,
      };
    };
    const ctl = createPlayerController(citySpace(world), undefined, { runMult: 1.35 });
    ctl.teleport(start[0], start[1]);
    const meAv = kit.create(me.app);
    engine.scene.add(meAv.root);
    // jumping: camera dip on landing; avatar animations (Avatar.play falls back for names it does not know)
    ctl.onJump(() => meAv.play('jump'));
    ctl.onLand((impact) => { rig.landed(impact); if (impact > 3) meAv.play('land'); });
    const vm = kit.viewModel(me.app) as ViewModelEx;
    engine.camera.add(vm.root);
    if (!engine.camera.parent) engine.scene.add(engine.camera);

    const cityColliders = () => { const out: THREE.Object3D[] = []; world.root.traverse((o) => { if (o.userData?.cameraCollider) out.push(o); }); return out; };
    const cityCamera = () => {
      rig.setColliders(cityColliders());
      rig.setColliderBoxes(layoutColliderBoxes(store.layout!, world.groundAt));
      rig.setGround(world.groundAt);
    };
    cityCamera();
    rig.setDragElement(engine.renderer.domElement);
    rig.yaw = 0; rig.pitch = -0.05;

    const state: GameState = { mode: 'fp', menu: null, menuOrbit: false, overlay: null, overlayOver3d: false, classic: false, inRoom: false, expeditionOnly: expOnly };
    const registries = createRegistries();
    const interact = createInteractSystem({ scene: engine.scene });
    const frameFns: ((dt: number, t: number) => void)[] = [];
    const menuFns = new Set<(id: string | null) => void>();
    const feet = new THREE.Vector3();

    /* ---- room space swap ---- */
    let room: RoomScene | null = null;
    let savedBg: THREE.Scene['background'] = null, savedFog: THREE.Scene['fog'] = null;
    const setSpace = (sc: RoomScene | null, back?: { x: number; y: number; face: number }) => {
      if (sc) {
        if (!room) { savedBg = engine.scene.background; savedFog = engine.scene.fog; }
        else engine.scene.remove(room.root);
        room = sc; state.inRoom = true;
        world.root.visible = false;
        engine.scene.add(sc.root);
        ctl.setSpace({ free: (x, z) => sc.free(x, z), groundAt: (x, z) => sc.groundAt(x, z), solidTop: sc.solidTop ? (x, z) => sc.solidTop!(x, z) : undefined }, 'm',
          { x: sc.spawn.x, y: sc.spawn.z, face: sc.spawn.face });
        rig.yaw = sc.spawn.face; rig.pitch = -0.05;
        rig.setColliders(sc.colliders ?? []);
        rig.setColliderBoxes([]);
        rig.setGround((px, py) => sc.groundAt(toX(px), toZ(py)));
      } else {
        if (!room) return;
        engine.scene.remove(room.root);
        room = null; state.inRoom = false;
        engine.scene.background = savedBg; engine.scene.fog = savedFog;
        world.root.visible = true;
        const L = store.layout!;
        const p = back ? L.nearest(back.x, back.y) : [me.x, me.y];
        ctl.setSpace(citySpace(world), 'px', { x: p[0], y: p[1], face: back?.face ?? ctl.face });
        me.x = ctl.x; me.y = ctl.y;
        if (back) { rig.yaw = back.face; rig.pitch = -0.05; }
        cityCamera();
        site.moveTo(ctl.x, ctl.y);
      }
    };

    /* ---- veil (loading a room) ---- */
    const veilEl = document.createElement('div');
    veilEl.style.cssText = 'position:fixed;inset:0;z-index:105;display:grid;place-items:center;background:rgba(13,11,34,.82);color:#ffe9a8;'
      + "font:800 22px/1.2 'Golos Text','Nunito',sans-serif;letter-spacing:.02em;opacity:0;pointer-events:none;transition:opacity .2s";
    veilEl.setAttribute('role', 'status');
    document.body.appendChild(veilEl);
    const veil = (title: string | null) => { if (title) veilEl.textContent = title + '…'; veilEl.style.opacity = title ? '1' : '0'; };

    /* ---- UI ---- */
    // scene mode (a room with a stage, src/core/rooms.ts): the cursor is free on purpose — the UI must not ask to
    // «click to return», nor show the crosshair or pause when the lock goes
    let sceneMode = () => false;
    const uiInput = Object.create(input, { locked: { get: () => input.locked || sceneMode() } }) as typeof input;
    const uiHost: UiHost & Record<string, unknown> = {
      store, actions: site.actions, input: uiInput,
      onMenu: (fn) => { menuFns.add(fn); return () => menuFns.delete(fn); },
      setCameraMode: () => { /* camera feature */ },
      getCameraMode: () => (sceneMode() ? 'tp' : state.mode),
      setQuality: (q) => engine.setQuality(q),
      exitToClassic: () => ctx.game.toClassic(),
      focusTarget: () => interact.focus(),
      stats: () => engine.stats(),
      yaw: () => rig.yaw,
      menuChanged: (id: string | null) => onMenuChanged(id),
      // the map menu: top-down render of the city and «Идти сюда» (street only; ignored inside rooms)
      mapImage: () => {
        const w = world as World3D & Partial<World3DExt>;
        return typeof w.mapImage === 'function' ? w.mapImage(engine.renderer) : Promise.reject(new Error('no map image'));
      },
      walkTo: (x: number, y: number) => { if (!state.inRoom) ctl.walkTo(x, y); },
      get pauseOnUnlock() { return !state.overlayOver3d && !sceneMode(); },
    };
    let promptOverride: string | null = null;

    // key bindings run BEFORE the UI's own handler (registered first), so e.g. Esc inside a room exits the room
    input.onKey((code, e) => {
      // a text field (also inside the UI's shadow root: the chat) owns its keys, Esc included (it blurs the field)
      const src = typeof e.composedPath === 'function' ? e.composedPath()[0] : e.target;
      if (isTyping(src instanceof Element ? src : null)) return false;
      // Esc closes the topmost DOM card / window first (input modal stack: mine cards, shop card…)
      if (code === 'Escape' && input.closeTopModal()) return true;
      for (const id of registries.keys.ids()) {
        const b = registries.keys.get(id)!;
        if (b.code !== code) continue;
        if ((b.when ?? 'gameplay') === 'gameplay' && (state.menu || !input.gameplay)) continue;
        try { if (b.run(ctx, e) === true) return true; } catch (err) { console.error('[l3d] key', id, err); }
      }
      return false;
    });
    const ui = mountUi(uiRoot, uiHost) as CoreContext['uiApi'];

    // the UI reports menu changes twice (host.menuChanged, then the 'l3d:menu' event that also says whether the camera
    // should orbit); listeners run when the id or the orbit flag changes
    const onMenuChanged = (id: string | null, orbit?: boolean) => {
      const o = id ? (orbit ?? (id === state.menu ? state.menuOrbit : ORBIT_GUESS.has(id))) : false;
      if (id === state.menu && o === state.menuOrbit) return;
      state.menu = id; state.menuOrbit = o;
      for (const f of [...menuFns]) { try { f(id); } catch (e) { console.error('[l3d] menu listener', e); } }
    };
    const onMenuEv = (e: CustomEvent) => onMenuChanged(e.detail?.open ?? null, typeof e.detail?.orbit === 'boolean' ? e.detail.orbit : undefined);
    W.addEventListener('l3d:menu', onMenuEv);

    /* ---- rooms ---- */
    const roomHost: RoomHost = {
      ctx: null as unknown as CoreContext,
      registries,
      building: (id) => store.layout?.buildings.find((b) => b.id === id),
      setSpace,
      openSite: (id) => {
        const d = world.doors.find((x) => x.id === id);
        if (d?.soon) { ui.toast('Здание ещё строится — скоро откроется'); return; }
        input.unlock();
        site.actions.openBuilding(id);
      },
      showPanel: (id) => {
        state.overlayOver3d = true;
        document.documentElement.classList.add('l3d-room3d');
        input.unlock();
        site.actions.openBuilding(id);
      },
      hidePanel: () => {
        if (site.overlay() === 'room') site.closeOverlay();
        // the site animates its room out: keep the transparent-room mode until the panel is really gone (≤ 2 s)
        const t0 = performance.now();
        const done = () => {
          if (rooms.panel) return;   // re-entered meanwhile
          if (site.overlay() === 'room' && performance.now() - t0 < 2000) { setTimeout(done, 120); return; }
          state.overlayOver3d = false; document.documentElement.classList.remove('l3d-room3d');
        };
        setTimeout(done, 120);
      },
      veil,
      toast: (t, bad) => ui.toast(t, bad),
    };
    const rooms = createRoomManager(roomHost);
    sceneMode = () => !!rooms.stage;

    /* ---- context ---- */
    const ctx: CoreContext = {
      engine, scene: engine.scene, camera: engine.camera, rig, input, store, actions: site.actions, site,
      layout: () => store.layout!,
      quality: () => engine.quality,
      interact, rooms, registries, state,
      hostEl, uiRoot, uiApi: ui, uiHost,
      ui: {
        toast: (t, bad) => ui.toast(t, bad),
        open: (m) => ui.open(m),
        prompt: (text) => { promptOverride = text || null; },
      },
      onFrame(fn): Unsub { frameFns.push(fn); return () => { const k = frameFns.indexOf(fn); if (k >= 0) frameFns.splice(k, 1); }; },
      player: {
        get x() { return feet.x; }, get y() { return feet.y; }, get z() { return feet.z; },
        get app(): Appearance | null { return store.me?.app ?? null; },
      },
      drift: (kind, id, detail) => reportDrift(kind, id, detail),
      world: () => world,
      onWorld(fn) { worldFns.add(fn); return () => { worldFns.delete(fn); }; },
      kit, labels, anchors: new Map(), me, meAv, vm,
      controller: () => ctl,
      feet,
      gameplay: () => !state.classic && !state.menu && (!state.overlay || state.overlayOver3d),
      applyCamera: () => { /* camera feature */ },
      onMenu(fn) { menuFns.add(fn); return () => { menuFns.delete(fn); }; },
      setSpace,
      game: { classic: false, toClassic() { /* classic feature */ }, resume() { /* */ }, classicPanel() { /* */ } },
      veil,
      dev: {},
    };
    roomHost.ctx = ctx;
    ui.setGameContext(ctx);
    ctx.anchors.set(me.login, new THREE.Vector3());

    // layout changes (town switch, buildings opened) → rebuild the city world
    store.on('layout', async () => {
      const L = store.layout; if (!L || expOnly) return;
      const nw = await buildCity(L, { quality: engine.quality, renderer: engine.renderer, art: createSvgArt(L) ?? undefined });
      engine.scene.remove(world.root); world.dispose(); world = nw; engine.scene.add(world.root);
      world.root.visible = !state.inRoom;
      if (!state.inRoom) { ctl.setSpace(citySpace(world, L), 'px', { x: ctl.x, y: ctl.y }); cityCamera(); }
      for (const f of [...worldFns]) { try { f(world); } catch (e) { console.error('[l3d] world listener', e); } }
    });

    /* ---- features ---- */
    status('Готовим мир…');
    const offFeatures = await runFeatures(ctx, expOnly ? FEATURES.filter((f) => EXP_ONLY_FEATURES.has(f.id)) : FEATURES);

    /* ---- crosshair prompt: «[E] Войти: Кузня», «[E] Купить: … · [F] Осмотреть», «!… — скоро откроется» (muted) ---- */
    let pTarget: Interactable | null = null, pLabel = '', pOverride: string | null = null;
    const promptText = (): string | null => {
      if (promptOverride != null) return promptOverride;
      const t = interact.target as (Interactable & { soon?: boolean }) | null;
      if (!t) return null;
      if (t.soon) return '!' + t.label;
      return `[E] ${t.label}` + (t.alt ? ` · [F] ${t.alt.label}` : '');
    };

    /* ---- frame ---- */
    let sentAt = 0, fpShown: boolean | null = null, vmShown: boolean | null = null;
    // rooms may toggle the view-model / own head themselves (the mine): re-apply ours after every room change
    rooms.onChange(() => { fpShown = null; vmShown = null; });
    engine.onFrame((dt, t) => {
      const gameplay = ctx.gameplay();
      if (!gameplay && vm.blocking) vm.block(false);
      // 1. look (the camera is final only after the player moved; look first so movement uses this frame's yaw)
      const l = input.consumeLook();
      if (gameplay) {
        const sens = SET.sens;
        rig.yaw -= l.dx * 0.0022 * sens; rig.pitch = Math.max(-1.45, Math.min(1.45, rig.pitch - (SET.inv ? -l.dy : l.dy) * 0.0022 * sens));
        const wh = input.consumeWheel(); if (wh) rig.zoom(wh);
      } else { const wh = input.consumeWheel(); if (wh && state.menu) rig.zoom(wh); }
      // 2. player
      if (!gameplay) input.consumeJump();   // no buffered jump after closing a menu
      const moved = ctl.update(dt, gameplay ? input : NO_INPUT as any, rig.yaw);
      if (!state.inRoom) {
        me.x = ctl.x; me.y = ctl.y;
        if (moved && t - sentAt > 0.1) { site.moveTo(ctl.x, ctl.y); sentAt = t; }
      }
      me.speed = ctl.speed;
      me.face = state.mode === 'fp' && !state.menu && !rooms.stage ? rig.yaw : ctl.face;
      // 3. others
      site.tick(dt);
      // 4. me
      ctl.feet(feet);
      meAv.root.position.copy(feet);
      meAv.root.rotation.y = me.face;
      meAv.update(dt, t, ctl.speed / 230);
      ctx.anchors.get(me.login)!.set(feet.x, feet.y + meAv.headTop + 0.15, feet.z);
      // 5. camera
      rig.face = meAv.root.rotation.y;
      rig.follow(feet, EYE, ctl.airborne);
      if (gameplay) vm.update(dt, t, ctl.speed / 230, l);
      rig.update(dt);
      const fpNow = rig.distance < 0.9 && !rooms.stage;   // scene mode: the hero is always shown
      if (fpNow !== fpShown) { fpShown = fpNow; meAv.setFirstPerson(fpNow); }
      const vmOn = fpNow && !state.menu && !state.toolInHand && (!state.overlay || state.overlayOver3d);
      if (vmOn !== vmShown) { vmShown = vmOn; vm.setVisible(vmOn); }
      // 6. features
      for (let i = 0; i < frameFns.length; i++) frameFns[i](dt, t);
      // 7. world / room
      if (room) rooms.update(dt, t, engine.camera); else world.update(dt, t, engine.camera);
      // 8. interaction target + HUD
      interact.setEnabled(gameplay && !rooms.busy);
      interact.update(engine.camera, feet, Math.max(0, rig.distance - 0.2));
      const tgt = interact.target;
      if (tgt !== pTarget || (tgt && tgt.label !== pLabel) || promptOverride !== pOverride) {
        pTarget = tgt; pLabel = tgt?.label ?? ''; pOverride = promptOverride;
        ui.prompt(promptText());
      }
      ui.update(dt);
    });

    // full teardown (the expedition-only game before the city boots in place; safe to call once)
    let disposed = false;
    ctx.game.dispose = () => {
      if (disposed) return; disposed = true;
      try { offFeatures(); } catch (e) { console.error('[l3d] dispose features', e); }
      W.removeEventListener('l3d:menu', onMenuEv);
      try { (ui as { dispose?: () => void }).dispose?.(); } catch (e) { console.error('[l3d] dispose ui', e); }
      try { input.dispose(); } catch { /* */ }
      try { world.dispose(); } catch { /* */ }
      try { engine.dispose(); } catch { /* */ }
      veilEl.remove(); cleanupDom();
      try { site.dispose(); } catch (e) { console.error('[l3d] dispose site', e); }
      if (__DEV__ && W.__l3dGame?.ctx === ctx) delete W.__l3dGame;
    };

    document.getElementById('l3d-launch')?.classList.add('hide');
    if (__DEV__) {
      W.__l3dGame = {
        engine, store, rig, site, ui, meAv, vm, labels, ctx, interact, rooms, registries,
        get world() { return world; }, get player() { return ctl; },
      };
      Object.assign(W.__l3dGame, ctx.dev);
    }
    return ctx.game;
  }
}

/** The stand-in world of the expedition-only mode: nothing to draw, flat ground, no doors. */
function emptyWorld(): World3D {
  return {
    root: new THREE.Group(), groundAt: () => 0, doors: [], spawn: [200, 200],
    update: () => { /* */ }, setQuality: () => { /* */ }, dispose: () => { /* */ },
  };
}

/** Menus that orbit the camera when the UI does not say (older UI without detail.orbit). */
const ORBIT_GUESS = new Set(['gear', 'bag', 'look', 'character']);
const NO_INPUT = { move: { x: 0, y: 0 }, run: false, consumeLook: () => ({ dx: 0, dy: 0 }), consumeWheel: () => 0 };
