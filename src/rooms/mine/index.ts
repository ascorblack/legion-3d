/**
 * Mine room (kind 'mine3d'): a real 3D mine driven by our own mine client (net.ts, mirrors the site's mine.js).
 *
 *   import { registerMine } from './rooms/mine';
 *   registerMine(registries.rooms);              // registers 'mine3d'; buildings registry: mine → { room: 'mine3d' }
 *
 * create(ctx): closes the site's own mine if open (one presence per tab), POST /api/mine/enter, builds the cave,
 * registers interactables (front stones, lift, buyer, supplier, board, way down), mounts the HUD and returns the
 * RoomScene (free/groundAt over the cleared cells + entrance area). Keys: E dig / use, Shift+E queue the stone after the
 * current one (only with the game's fx.q flag; same /api/mineDig {…, q} as the site's Shift+click), L journal,
 * Esc closes a card / the journal. AFK comfort (afk.ts): tab title / favicon / optional notification, a soft chime on
 * the own finished stone (also in a hidden tab), the reach ring and the first-step guard after a long idle, fewer
 * frames while visible without focus, and the window event 'l3d:mine-status' (state, own burst, dispose). Mine chat lines become bubbles over the miners and lines in the «⛏ Шахта» tab of the
 * bottom-left chat dock (src/ui/chat.ts attachMineChat; posts /api/mine/chat/say — only when the player types and sends). Throws (→ room manager falls back to the site's
 * 2D mine) when the hero has no access to this mine or the game refuses the entry. See docs/MINE.md.
 */
import { setModal } from '../../core/modal';
import * as THREE from 'three';
import type { Unsub } from '../../contracts';
import type { Registry, RoomDef, RoomContext, RoomScene, Interactable } from '../../contracts/ext';
import { MineClient, type MineApi, type MineBus } from './net';
import { MineScene, footM } from './scene';
import { MineHud } from './hud';
import { N_CELLS, REACH, mx, mz, px, py, spawnPt, frontOfObj, cellXY, type Pt } from './geo';
import { TX, blockTitle, gotText, type Burst } from './state';
import {
  TabSignals, domTabEnv, ReachRing, StepGuard, RenderThrottle, registerMineAfkSettings, afkOn, mineStatus, alertOf, chimeEvents,
  myStone, reachK, REACH_LIMIT, REACH_WARN, EDGE_TEXT, GUARD_TEXT, MINE_STATUS_EVENT, ECO_FRAME_MS, type TabEnv,
} from './afk';
import { pickaxeGeo } from './art';
import { estimateStone, promptEcon } from './econ';
import { mineSwitch, PREF_ECON } from './prefs';
import { layerBanner } from './layers';
import { walkPlan, AutoWalk, LeaveGuard, ConfirmTwice, type WalkCtl } from './walk';
import { attachMineChat } from '../../ui/chat';
import type { Avatar } from '../../contracts/modules';
import type { RoomCombat, RoomFighter } from '../../combat/room';

export { MineClient } from './net';
export { MineModel } from './state';
export { MineScene } from './scene';

/** Mine id of the current city: district towns have their own mine, the fair (home city) — 'home'. */
export function mineIdOf(layoutId: string | undefined): string { return !layoutId || layoutId === 'fair' ? 'home' : layoutId; }

export interface MineRoomOpts {
  /** Inject a client (dev page / tests with a fake API). */
  client?: MineClient;
  /** Mine id; default from the city layout. */
  c?: string;
  /** Where the HUD goes (default ctx.engine.host). */
  hudHost?: HTMLElement;
  /** Tab title / favicon / notification sink (tests; default: the document). */
  tabEnv?: TabEnv;
}

/** Register the mine room kind. Returns the unregister function. */
export function registerMine(rooms: Registry<RoomDef>): Unsub {
  const off = rooms.register('mine3d', { title: 'Шахта', create: (ctx) => createMineRoom(ctx) });
  const offSet = registerMineAfkSettings();   // settings group «Шахта» (tab title, chime, notifications, guard, eco)
  return () => { off(); offSet(); };
}

const NPC_FAR = 2.5 * 128;   // px: the buyer / supplier card closes when you walk this far away (site NPC_FAR)

const REDUCED = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/** The popup / notification text of an own finished stone (the site's words). */
function burstLoot(b: Burst, cellR: string | null): string {
  const g = b.got;
  return g && g.loot ? 'Сундук: ' + Object.entries(g.loot).filter(([, v]) => v > 0).map(([k, v]) => gotText(v, k)).join(', ')
    : cellR && g && g.q > 0 ? gotText(g.q, cellR) : TX.broke;
}

export async function createMineRoom(ctx: RoomContext, o: MineRoomOpts = {}): Promise<RoomScene> {
  const W = window as any;
  const store = ctx.store, hero = store.hero as any;
  const login = String((store.me && store.me.login) || (hero && hero.login) || '').toLowerCase();
  let c = o.c;
  if (!c) { try { c = mineIdOf(ctx.layout().id); } catch { c = 'home'; } }
  if (!o.client && hero && hero.mn && !hero.mn[c]) throw new Error('Эта шахта закрыта');
  // one presence per tab: the site's own mine must not run at the same time
  try { if (W.LGMine && W.LGMine.on) W.LGMine.close(); } catch { /* */ }
  const api: MineApi = (p, b) => (b === undefined ? ctx.actions.get(p) : ctx.actions.post(p, b));
  const client = o.client || new MineClient({
    api, login, c, bus: (W.__L3D_BUS as MineBus) || null,
    hero: () => store.hero as any, equip: (uid) => ctx.actions.equip(uid), hidden: () => document.hidden,
  });
  const M = client.model;
  const burstText = (b: Burst) => { const cell = M.F && M.F.cells[b.i]; return burstLoot(b, cell ? cell.r : null); };
  const spawn = spawnPt(login);
  let entryErr = '';
  const offErr = client.on((e) => { if (e.type === 'error') entryErr = e.text; });
  const ok = await client.enter(spawn);
  offErr();
  if (!ok || !M.st) { client.close(); throw new Error(entryErr || 'Шахта не открылась'); }

  const style = (ctx.player.app && ctx.player.app.styleId) || 'cats';
  const scene = new MineScene({ quality: ctx.quality(), style, login });
  scene.setView(M, client.queue());
  let floorN: number | null = M.st ? M.st.n : null;

  // scene fog / background: applied on the first frame (after the room host saved the city's), restored on dispose
  let prevFog: THREE.Scene['fog'] = null, prevBg: THREE.Scene['background'] = null, fogSet = false;
  const applyFog = () => {
    const P = (scene as any).pal; const col = new THREE.Color(P ? P.fog : '#1a1424');
    if (!fogSet) { prevFog = ctx.scene.fog; prevBg = ctx.scene.background; fogSet = true; }
    ctx.scene.fog = new THREE.Fog(col, M.dark ? 3 : 22, M.dark ? 12 : 64); ctx.scene.background = col;
  };
  let fogDark: boolean | null = null;

  /* ---------------------------------------------------------------- HUD */
  const host = o.hudHost || ctx.engine.host;
  let modalOn = false;
  const hud = new MineHud(host, client, {
    stop: () => { void client.stop().then(() => hud.render()); },
    toBuyer: () => goBuyer(),
    exit: () => ctx.exit(),
    // every card / the journal / the chat field is a modal on the input's stack: gameplay off, no pointer grab,
    // no «click to return» hint, Esc closes it (src/core/modal.ts)
    modal: (on) => { modalOn = on; setModal(ctx.input, 'mine:card', on, () => hud.close()); },
    journal: (on) => setModal(ctx.input, 'mine:journal', on, () => hud.journal(null)),
    typing: (on) => setModal(ctx.input, 'mine:chat', on),
  });
  // Esc closes an open card / the journal (before the core's «Esc = leave the building» binding sees it);
  // L opens / closes the journal (hero stats, mine log, mine chat)
  const onEsc = (e: KeyboardEvent) => {
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    if (e.code === 'Escape' && (hud.card || hud.jr)) { if (hud.card) hud.close(); else hud.journal(null); e.preventDefault(); e.stopImmediatePropagation(); }
    else if (e.code === 'KeyL' && !e.repeat && !e.ctrlKey && !e.metaKey && !e.altKey && !hud.card && (ctx.input.gameplay || hud.jr)) { hud.journal('toggle'); e.preventDefault(); e.stopImmediatePropagation(); }
  };
  document.addEventListener('keydown', onEsc, true);
  const offKey = () => document.removeEventListener('keydown', onEsc, true);
  hud.render();

  /* ---------------------------------------------------------------- client events */
  // the mine chat is the «⛏ Шахта» tab of the bottom-left chat dock (removed again on dispose); it posts only when the player sends
  const offChatTab = client.chat.on ? attachMineChat({
    lines: () => client.chat.lines,
    on: (fn) => client.on((e) => { if (e.type === 'chat') fn(e.lines); }),
    say: (t) => client.say(t),
    me: () => login,
  }) : () => { /* no mine chat */ };
  const offEv = client.on((e) => {
    if (e.type === 'state') {
      scene.setView(M, client.queue());
      if (e.newFloor) {
        fogDark = null; refreshBoxes();
        // a new depth layer (every 5 floors, site mine-biome.js): one banner line
        const n = M.st ? M.st.n : null, ban = n != null ? layerBanner(floorN, n) : ''; floorN = n;
        if (ban) hud.tip(ban);
      }
      hud.render();
    }
    else if (e.type === 'presence' || e.type === 'here' || e.type === 'busy' || e.type === 'other') hud.render();
    else if (e.type === 'tip') hud.tip(e.text, e.bad);
    else if (e.type === 'chat') { for (const l of e.lines) { scene.say(String(l.l).toLowerCase(), l.t); } hud.chatIn(e.lines); }
    else if (e.type === 'error') hud.tip(e.text, true);
    else if (e.type === 'burst') {
      for (const b of e.bursts) {
        scene.burst(b.i, M);
        { const c = cellXY(b.i); window.dispatchEvent(new CustomEvent('l3d:sfx', { detail: { id: 'mine.break', x: mx(c.cx), y: 0.6, z: mz(c.cy) } })); }
        if (!b.mine) continue;
        const p = cellXY(b.i), cell = M.F && M.F.cells[b.i], g = b.got;
        const text = burstText(b);
        hud.popup(text, mx(p.cx), scene.stoneHeight(b.i) + 0.4, mz(p.cy));
        if (cell && cell.r && g && !(g.q > 0) && g.any) hud.tip(`${TX.done}. ${cell.r ? 'Руда' : ''} досталась другим копавшим (по вкладу) — тебе монеты за работу.`);
        else hud.tip(TX.done);
      }
    }
  });

  /* ---------------------------------------------------------------- AFK comfort (afk.ts: #27, #25, #5) */
  // nothing here talks to the game: it reads the model and dispatches window events only
  const core0 = ctx as any;
  const afk = { tab: afkOn('tab'), notify: afkOn('notify'), guard: afkOn('guard'), eco: afkOn('eco') };
  const onAfkSet = (e: Event) => {
    const k = String(((e as CustomEvent).detail || {}).key || '');
    if (!k.startsWith('l3d.mine.')) return;
    afk.tab = afkOn('tab'); afk.notify = afkOn('notify'); afk.guard = afkOn('guard'); afk.eco = afkOn('eco');
    refreshTab();
  };
  window.addEventListener('l3d:settings', onAfkSet);
  const tab = new TabSignals(o.tabEnv || domTabEnv());
  const refreshTab = () => tab.update(M, Date.now(), afk.tab);
  const emitStatus = (inMine: boolean) => {
    try { window.dispatchEvent(new CustomEvent(MINE_STATUS_EVENT, { detail: mineStatus(c!, M, Date.now(), inMine) })); } catch { /* */ }
  };
  const sfx = (d: object) => window.dispatchEvent(new CustomEvent('l3d:sfx', { detail: d }));
  const capped = () => !!M.me && +M.me.cap > 0 && +M.me.day >= +M.me.cap;
  let capPrev = capped();
  const offAfkEv = client.on((e) => {
    if (e.type === 'state') {
      refreshTab(); emitStatus(true);
      const cp = capped(); if (cp && !capPrev) for (const d of chimeEvents('mine.cap')) sfx(d);
      capPrev = cp;
    } else if (e.type === 'burst') {
      let own = false;
      for (const b of e.bursts) {
        if (!b.mine) continue;
        own = true;
        for (const d of chimeEvents(alertOf(b, M))) sfx(d);
        tab.finished(burstText(b), afk.notify);
      }
      if (own) { refreshTab(); emitStatus(true); }
    }
  });
  // reach ring (one draw call, on the room root) and the first-step guard after a long idle
  const ring = new ReachRing(); scene.root.add(ring.mesh);
  const guard = new StepGuard(performance.now());
  let edgeWarned = false, ringI = -1, ringX = 0, ringZ = 0;
  const isField = (t: EventTarget | null) => { const el = t as HTMLElement | null; return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable); };
  const onGuardKey = (e: KeyboardEvent) => {
    const now = performance.now();
    throttle.wake();
    if (e.type === 'keyup') { guard.keyUp(e.code, now); return; }
    if (isField(e.target) || e.ctrlKey || e.metaKey || e.altKey) { guard.activity(now); return; }
    const digging = afk.guard && ctx.input.gameplay && !modalOn && myStone(M) >= 0;
    const r = guard.keyDown(e.code, e.repeat, now, digging);
    if (r === 'pass') return;
    // swallowed before the game input (window listener) sees it: the hero does not move
    e.preventDefault(); e.stopImmediatePropagation();
    if (r === 'warn') hud.tip(GUARD_TEXT, true);
  };
  document.addEventListener('keydown', onGuardKey, true);
  document.addEventListener('keyup', onGuardKey, true);
  const onActivity = () => { guard.activity(performance.now()); throttle.wake(); };
  const ACT = ['pointerdown', 'mousemove', 'wheel', 'focus'] as const;
  for (const a of ACT) window.addEventListener(a, onActivity, { passive: true, capture: true });
  // fewer frames while the window is visible but without focus (second monitor AFK); focus / input → full rate
  const throttle = new RenderThrottle({
    pause: (on) => ctx.engine.pause(on),
    hidden: () => document.hidden, focused: () => document.hasFocus(),
    blocked: () => { const s = core0.state; return !!s && (!!s.classic || (!!s.overlay && !s.overlayOver3d)); },
  });
  let afkTick = 0;
  const afkTimer = window.setInterval(() => {
    throttle.tick(performance.now(), afk.eco);
    // the title / favicon also move while the tab is hidden (no frames then)
    if (++afkTick % 4 === 0) refreshTab();
  }, ECO_FRAME_MS);
  const offAfk = () => {
    clearInterval(afkTimer);
    window.removeEventListener('l3d:settings', onAfkSet);
    document.removeEventListener('keydown', onGuardKey, true);
    document.removeEventListener('keyup', onGuardKey, true);
    for (const a of ACT) window.removeEventListener(a, onActivity, { capture: true });
    offAfkEv(); throttle.dispose(); ring.dispose(); tab.dispose();
  };
  refreshTab(); emitStatus(true);

  /* ---------------------------------------------------------------- interactables */
  const unsubs: Unsub[] = [];
  const boxes: THREE.Box3[] = [];
  const feetPx = (): Pt => ({ x: px(ctx.player.x), y: py(ctx.player.z) });
  const refreshBoxes = () => { for (let i = 0; i < N_CELLS; i++) scene.stoneBox(i, boxes[i]); };
  // the prompt line of the aimed stone (#8): title + the econ estimate (econ.ts), re-estimated at most every 2 s or when the
  // view / own stone / queue changes — the getter is read every frame, so the string is cached (no per-frame work)
  const lab = { i: -1, at: 0, snap: -1, my: -2, raw: null as number[] | null, text: '' };
  const stoneLabel = (i: number): string => {
    const cell = M.F && M.F.cells[i]; if (!cell || !M.st) return 'Камень';
    const now = Date.now(), raw = client.rawQueue();   // the queue array is replaced on every change: identity is enough
    if (lab.i === i && lab.snap === M.st.at && lab.my === M.myI && lab.raw === raw && now - lab.at < 2000) return lab.text;
    const on = mineSwitch(PREF_ECON), qList = client.queue(), place = qList.indexOf(i);
    const est = on ? promptEcon(estimateStone(M.st, cell, now, M.myI)) : '';
    const head = M.myI === i ? `${TX.doing}: ${blockTitle(cell)}` : place >= 0 ? `В очереди №${place + 1}: ${blockTitle(cell)}` : `Копать: ${blockTitle(cell)}`;
    const hint = client.queueOn && M.myI >= 0 && M.myI !== i && place < 0 ? ' · Shift+E — в очередь' : '';
    lab.i = i; lab.at = now; lab.snap = M.st.at; lab.my = M.myI; lab.raw = raw;
    lab.text = head + (est ? ` · ${est}` : '') + hint;
    return lab.text;
  };
  // Shift held with E (site: Shift+click / long press = «в очередь»): read from the key event itself, before the game input
  let shiftE = false;
  const onShiftE = (e: KeyboardEvent) => { if (e.code === 'KeyE') shiftE = e.shiftKey; };
  document.addEventListener('keydown', onShiftE, true);
  for (let i = 0; i < N_CELLS; i++) {
    boxes.push(scene.stoneBox(i));
    const it: Interactable = {
      id: 'mine:stone:' + i,
      icon: '⛏',
      get label() { return stoneLabel(i); },
      hit: boxes[i], reach: 3.4,
      enabled: () => !M.dug[i] && M.isFront(i) && !M.dark && !modalOn,
      use: () => { const q = shiftE; shiftE = false; void (q ? queueAt(i) : digAt(i)); },
      // the scene outlines the aimed stone's own shape (scene.update → outlineStone), not the hit box
      highlight: () => { /* drawn by the scene */ },
    } as Interactable;
    unsubs.push(ctx.interact.add(it));
  }
  /** Shift+E: queue stone i after the current one (only with the site's fx.q and while digging), else a normal dig. */
  const queueAt = async (i: number) => {
    const cc = cellXY(i);
    const done = await client.enqueue(i, feetPx(), { x: cc.cx, y: cc.cy });
    if (!done) await digAt(i);
    else { scene.setView(M, client.queue()); hud.render(); }
  };
  const digAt = async (i: number) => {
    const f = feetPx(), cc = cellXY(i);
    if (MineClient.distTo(i, f) > REACH) { hud.tip('Подойди к камню вплотную — встань на расчищенную клетку рядом', true); return; }
    await client.dig(i, f, { x: cc.cx, y: cc.cy });
    hud.render();
  };
  const obj = (id: string, box: THREE.Box3 | undefined, label: () => string, use: () => void, reach = 3.2, proximity = true) => {
    if (!box) return;
    unsubs.push(ctx.interact.add({ id: 'mine:' + id, get label() { return label(); }, hit: box, reach, proximity, enabled: () => !modalOn, use }));
  };
  const openNpc = (kind: 'buy' | 'lamp') => {
    if (M.myI >= 0) client.leaveRock();
    client.flushGo();
    npcAt = frontOfObj(kind === 'buy' ? 'buyer' : 'lamp', login); npcOn = false;
    hud.open(kind);
  };
  let npcAt: Pt | null = null, npcOn = false;
  /* «Скупщик» in the HUD = the site's «К скупщику» (mine.js goNpc('buy')): the window opens at once, the hero puts the
     pickaxe down (leaveRock → mineStop, as the site) and walks to the counter with the normal movement (controller.walkTo,
     mine/go as usual). Selling stays a button in the window. While digging the first press only warns (AFK safety). */
  const walk = new AutoWalk();
  const buyConfirm = new ConfirmTwice(5000);
  const ctlOf = (): (WalkCtl & { stop?(): void }) | null => { const c = core0.controller && core0.controller(); return c && typeof c.walkTo === 'function' ? c : null; };
  const goBuyer = () => {
    if (!buyConfirm.press(M.myI >= 0 && !M.dug[M.myI], performance.now())) {
      hud.tip('Герой отложит кирку и пойдёт к скупщику — нажми «Скупщик» ещё раз', true);
      return;
    }
    const to = frontOfObj('buyer', login), plan = walkPlan(M.dug, feetPx(), to);
    openNpc('buy');
    const f0 = feetPx();
    if (plan && plan.length && Math.hypot(f0.x - to.x, f0.y - to.y) > 40 && ctlOf()) walk.startPx(plan);
  };
  // the lift and the board stand right next to the spawn: aim only (E at the spawn must not leave the mine)
  obj('lift', scene.objBoxes.lift, () => 'В город — подъёмник', () => ctx.exit(), 3.2, false);
  obj('buyer', scene.objBoxes.buyer, () => `${TX.seller} — сдать руду`, () => openNpc('buy'));
  obj('npcBuy', scene.objBoxes.npcBuy, () => `${TX.seller} — сдать руду`, () => openNpc('buy'));
  const supLabel = () => (M.pickOn ? `${TX.sup} — кирки, рудная сумка, каска` : `${TX.lampNpc} — каска шахтёра`);
  obj('lamp', scene.objBoxes.lamp, supLabel, () => openNpc('lamp'));
  obj('npcLamp', scene.objBoxes.npcLamp, supLabel, () => openNpc('lamp'));
  obj('board', scene.objBoxes.board, () => 'Поручения скупщика', () => hud.open('quests'), 3.2, false);
  obj('up', scene.objBoxes.up, () => M.upText() || 'Спуск', () => hud.tip(M.upText()), 4);

  /* ---------------------------------------------------------------- own pickaxe: FP view-model + TP in the paw */
  const pg = pickaxeGeo();
  const fpPick = new THREE.Group(); fpPick.name = 'mine:fpPick';
  const pickMats = [new THREE.MeshStandardMaterial({ color: '#8a5a32', roughness: 0.8 }), new THREE.MeshStandardMaterial({ color: '#b0b6c4', roughness: 0.3, metalness: 0.6, flatShading: true })];
  const fpInner = new THREE.Group(); fpInner.add(new THREE.Mesh(pg.wood, pickMats[0]), new THREE.Mesh(pg.iron, pickMats[1]));
  const paw = new THREE.Mesh(new THREE.SphereGeometry(0.06, 12, 8), new THREE.MeshStandardMaterial({ color: (ctx.player.app && (ctx.player.app.look as any).color) || '#f2e6d8', roughness: 0.9 }));
  paw.position.set(0, 0.02, 0); fpInner.add(paw);
  fpInner.scale.setScalar(0.9);
  fpPick.add(fpInner); fpPick.position.set(0.26, -0.36, -0.5);
  // the swing plane (pick Y-Z) turned towards the crosshair: the striking point (−Z) leads into the target
  fpPick.rotation.y = 0.32; fpPick.visible = false;
  for (const m of fpInner.children) { (m as THREE.Mesh).renderOrder = 10; ((m as THREE.Mesh).material as THREE.Material).depthTest = true; }
  ctx.camera.add(fpPick);
  const tpPick = scene.makePick(); tpPick.visible = false;
  let swingT = 0, digNow = false, vmHidden = false, struck = false;
  const core = ctx as any;

  /* ---------------------------------------------------------------- per frame */
  let lastP: Pt | null = null, stillT = 0, sentStill = false;
  const leave = new LeaveGuard();
  const _proj = new THREE.Vector3();
  const project = (x: number, y: number, z: number): [number, number] | null => {
    _proj.set(x, y, z).project(ctx.camera); if (_proj.z > 1) return null;
    const r = (ctx.engine.renderer.domElement as HTMLCanvasElement).getBoundingClientRect();
    return [(_proj.x * 0.5 + 0.5) * r.width, (-_proj.y * 0.5 + 0.5) * r.height];
  };
  let hudT = 0;
  const feet3 = new THREE.Vector3();
  const offFrame = ctx.onFrame((dt, t) => {
    const f = feetPx();
    feet3.set(ctx.player.x, ctx.player.y, ctx.player.z);
    // position → game (throttled; final point once standing still)
    const moved = !lastP || Math.hypot(f.x - lastP.x, f.y - lastP.y) > 0.5;
    if (moved) { stillT = 0; sentStill = false; client.moveTo(f.x, f.y); } else { stillT += dt; if (stillT > 0.25 && !sentStill) { sentStill = true; client.moveTo(f.x, f.y, true); } }
    lastP = f;
    // walked away from the own stone → the hero puts the pickaxe down (site leaveRock; the game also stops by go)
    // (only after the hero stood at it: a stone given by the queue or dug from the city does not stop by itself — the site
    // walks the hero there instead; here the player walks or just lets him work)
    if (leave.check(M.myI, M.myI >= 0 && !!M.dug[M.myI], M.myI >= 0 ? MineClient.distTo(M.myI, f) : 0)) client.leaveRock();
    // auto-walk to the buyer (HUD button): own movement keys cancel it
    if (walk.active) { const c = ctlOf(); if (c) walk.frame(c, ctx.player.x, ctx.player.z, dt); else walk.cancel(); }
    // reach ring: gold → red towards the limit, «Ещё шаг…» once per approach to the edge
    {
      const my = myStone(M), d = my >= 0 ? MineClient.distTo(my, f) : 0, k = reachK(d);
      const on = afk.guard && my >= 0 && d <= REACH_LIMIT;
      if (on && ringI !== my) { const cc = cellXY(my); ringI = my; ringX = mx(cc.cx); ringZ = mz(cc.cy); }   // once per stone
      if (on) ring.update(true, ringX, ringZ, k, t, !moved || REDUCED); else ring.update(false, 0, 0, 0, t, true);
      if (on && moved && k >= REACH_WARN) { if (!edgeWarned) { edgeWarned = true; hud.tip(EDGE_TEXT, true); } }
      else if (k < REACH_WARN - 0.12) edgeWarned = false;
    }
    throttle.frame();
    // NPC card closes when walking away (site npcFar)
    if ((hud.card === 'buy' || hud.card === 'lamp') && npcAt) {
      const d = Math.hypot(f.x - npcAt.x, f.y - npcAt.y);
      if (d <= NPC_FAR) npcOn = true; else if (npcOn) { hud.close(); npcAt = null; }
    }
    // own digging animation
    digNow = M.myI >= 0 && !M.dug[M.myI] && MineClient.distTo(M.myI, f) <= REACH + 30 && !moved;
    const fp = ctx.rig.mode === 'fp';
    fpPick.visible = digNow && fp;
    // the own weapon / shield step aside while the pickaxe is in the paws: through the shared state (core decides the
    // view-model each frame — a one-off setVisible here was undone by the next menu / overlay / camera change)
    if (core.state) core.state.toolInHand = digNow;
    else if (core.vm && typeof core.vm.setVisible === 'function') { const hide = digNow && fp; if (hide !== vmHidden) { vmHidden = hide; core.vm.setVisible(!hide); } }
    if (digNow) {
      // face the stone while digging (TP shows the hero; FP looks where the camera looks)
      if (!fp && core.controller) { const c = cellXY(M.myI), ctl = core.controller(); if (ctl && ctl.setFace) ctl.setFace(Math.atan2(-(mx(c.cx) - ctx.player.x), -(mz(c.cy) - ctx.player.z))); }
      swingT += dt;
      const T = 1.1, k = (swingT % T) / T;
      // the pick meets the stone at the end of the fast strike (k ≈ 0.66): one hit sound per swing
      if (k < 0.5) struck = false;
      else if (!struck && k >= 0.66) { struck = true; const c = cellXY(M.myI); window.dispatchEvent(new CustomEvent('l3d:sfx', { detail: { id: 'mine.hit', x: mx(c.cx), y: 0.7, z: mz(c.cy) } })); }
      // wind up (0…0.55) then a fast strike (0.55…0.7) and recover
      // raise (head up and back), then a fast strike forward-down, then recover
      const a = k < 0.55 ? 0.15 + k / 0.55 * 0.55 : k < 0.68 ? 0.7 - (k - 0.55) / 0.13 * 1.9 : -1.2 + (k - 0.68) / 0.32 * 1.35;
      fpInner.rotation.set(a, 0, 0.12);
      if (!fp && core.meAv) {
        const bone = MineScene.attachPick(core.meAv.root, tpPick); tpPick.visible = !!bone;
        if (swingT >= T) { swingT -= T; core.meAv.play('swing'); }
      }
      if (fp && swingT >= T) swingT -= T;
    } else { tpPick.visible = false; swingT = 0.4; }
    // HUD: the progress bar and «ещё N мин» move by themselves, re-render twice a second
    hudT += dt; if (hudT > 0.5) { hudT = 0; hud.render(); }
    hud.update(dt, project);
  });

  /* ---------------------------------------------------------------- fights («Драки с котиками», src/combat/room.ts) */
  // other miners are placed by the scene every frame (like the street crowd); the buyer / supplier NPCs stand still,
  // so combat puts them back on their spot. Client-only: nobody else sees it, nothing is sent to the game.
  const peek = scene as unknown as { actors?: Map<string, { av: Avatar }>; npcs?: Avatar[] };
  const miners = new Map<Avatar, RoomFighter>();
  const afterFns: ((dt: number, t: number) => void)[] = [];
  const fighterOf = (av: Avatar, id: string, npc: boolean): RoomFighter => {
    let f = miners.get(av);
    if (!f) {
      f = { id, av, kind: npc ? 'npc' : 'miner', home: npc ? { x: av.root.position.x, y: av.root.position.y, z: av.root.position.z } : null };
      miners.set(av, f);
    }
    return f;
  };
  const combat: RoomCombat = {
    fighters(fn) {
      if (peek.actors) for (const [l, a] of peek.actors) fn(fighterOf(a.av, 'mine:' + l, false));
      if (peek.npcs) for (let i = 0; i < peek.npcs.length; i++) fn(fighterOf(peek.npcs[i], 'mine:npc:' + i, true));
    },
    afterUpdate(fn) { afterFns.push(fn); return () => { const k = afterFns.indexOf(fn); if (k >= 0) afterFns.splice(k, 1); }; },
    // the buyer / supplier stand on cells nobody walks on: around them bodies may lie (else a knocked-over NPC that
    // starts inside rock would slide through it)
    space: {
      free: (x, z) => {
        if (scene.free(M.dug, x, z)) return true;
        const n = peek.npcs;
        if (n) for (let i = 0; i < n.length; i++) { const f = miners.get(n[i]); if (f && f.home && Math.abs(x - f.home.x) < 0.7 && Math.abs(z - f.home.z) < 0.7) return true; }
        return false;
      },
      groundAt: () => 0,
    },
  };
  let sweepT = 0;

  const roomScene: RoomScene & { combat: RoomCombat; afk: object } = {
    combat,
    // dev / screenshot handles (not in the contract)
    afk: { guard, throttle, tab, ring, walk },
    root: scene.root,
    free: (x, z) => scene.free(M.dug, x, z),
    groundAt: () => 0,
    // look towards the hall portal (the cart would fill the first view straight ahead)
    spawn: { x: mx(spawn.x), z: mz(spawn.y), face: (() => { const e = M.F && M.F.entry >= 0 ? M.F.entry : 80, ex = mx(cellXY(e).cx), ez = mz(cellXY(e).cy); return Math.atan2(-(ex - mx(spawn.x)), -(ez - mz(spawn.y))); })() },
    colliders: scene.colliders,
    update(dt, t, camera) {
      if (fogDark !== M.dark) { fogDark = M.dark; applyFog(); }
      const tg = ctx.interact.target; let aim = -1;
      if (tg && tg.id.startsWith('mine:stone:')) aim = +tg.id.slice(11);
      scene.update(dt, t, camera, M, Date.now(), aim, feet3);
      for (let i = 0; i < afterFns.length; i++) afterFns[i](dt, t);
      // forget miners that left (their avatars are disposed by the scene)
      if ((sweepT += dt) > 5) { sweepT = 0; for (const av of miners.keys()) if (!av.root.parent) miners.delete(av); }
    },
    dispose() {
      emitStatus(false); offAfk();
      afterFns.length = 0; miners.clear();
      offFrame(); offEv(); offChatTab(); offKey(); for (const u of unsubs) u();
      document.removeEventListener('keydown', onShiftE, true); walk.cancel();
      client.close(); hud.dispose();
      if (vmHidden && core.vm) core.vm.setVisible(true);
      fpPick.removeFromParent(); tpPick.removeFromParent(); if (core.state) core.state.toolInHand = false;
      for (const m of pickMats) m.dispose(); (paw.material as THREE.Material).dispose(); paw.geometry.dispose();
      scene.dispose();
      if (fogSet) { ctx.scene.fog = prevFog; ctx.scene.background = prevBg; }
    },
  };
  void footM;
  return roomScene;
}
