/**
 * Debug mode controller (src/features/debug-mode.ts creates it only while «Настройки → Отладка → Режим отладки» is on;
 * nothing of this exists otherwise). Owns:
 *   - the panel (src/debug/panel.ts) — F10 / «🐞 Отладка» in the Esc menu;
 *   - «Тестовое измерение» (src/debug/dimension.ts) and the rooms / towns its portals open (src/debug/places.ts);
 *   - «Сцены похода» (src/debug/scenes.ts) with the mocks (src/debug/questMocks.ts);
 *   - overlays (perf HUD, walk grid + hit boxes, wireframe — src/debug/overlays.ts), tools (free camera, demo bots,
 *     event forcing — src/debug/tools.ts), the site contract check, the bus log and the bug report (src/debug/report.ts).
 * Spaces are client-only (src/debug/space.ts): the site's hero stays where it was, no go() while away, and leaving
 * puts the player back exactly where they left. Everything here is local: no requests, nothing sent to the site.
 */
import * as THREE from 'three';
import type { CoreContext } from '../core/context';
import type { RoomScene } from '../contracts/ext';
import type { CityLayout } from '../contracts';
import { setModal } from '../core/modal';
import { driftList } from '../core/drift';
import { runtimeContract, type ContractCheck, type ContractFail } from '../net/contract';
import CONTRACT from '../data/site-contract.json';
import { VERSION } from '../features/whatsnew';
import { settingValue } from '../ui/settings-ext';
import { EVENT_SETTING } from '../events';
import { buildCity } from '../world';
import { campName } from '../net/town';
import { createShopRoom, SHOP_TITLES } from '../rooms/shop';
import { envFromCtx } from '../rooms/common/base';
import { DebugSpace } from './space';
import { TestDimension, type PortalDef, type TotemDef, type CardInfo } from './dimension';
import { ScenePlayer } from './scenes';
import { DebugPanel, type PanelState } from './panel';
import { PerfHud, GridOverlay, Wireframe } from './overlays';
import { FreeCam, Bots, EventForce, type ForcedEvent, type ForcedHwc } from './tools';
import { buildReport, pickSettings, preview, siteScripts } from './report';
import { demoData, demoStock, stubActions, worldRoom, siteCampLayout, siteDistrictLayout, demoRoomCtx, buildingFor } from './places';

declare const __DEV__: boolean;
const isDev = () => typeof __DEV__ !== 'undefined' && __DEV__;

const HYBRID_RU: Record<string, [string, string]> = { trainer: ['Арена тренера', '🥊'], board: ['Доска объявлений', '📜'], hall: ['Ратуша', '🏛️'], auction: ['Аукцион', '🔨'], storage: ['Склад', '📦'], gate: ['Ворота', '⛩️'], anvil: ['Наковальня', '⚒️'] };
const SHOP_ICON: Record<string, string> = { forge: '⚒️', magic: '🔮', shop: '🧺', tent: '🎪' };
const BUS_TYPES = ['sse:me', 'sse:city', 'sse:mine', 'sse:q', 'sse:j', 'sse:sm', 'sse:open', 'sse:error', 'city:enter', 'city:state', 'me', 'hero:act', 'city:ignore'];

interface SubRoom { sc: RoomScene; owned: (() => void)[]; frames: ((dt: number, t: number) => void)[]; back: { x: number; z: number; face: number }; cleanup?: () => void }

export class DebugMode {
  panel: DebugPanel | null = null;
  readonly space: DebugSpace;
  dim: TestDimension | null = null;
  sub: SubRoom | null = null;
  readonly scenes: ScenePlayer;
  perf: PerfHud | null = null;
  grid: GridOverlay | null = null;
  wire: Wireframe | null = null;
  readonly freecam: FreeCam;
  readonly bots: Bots;
  readonly force: EventForce;
  private pauses = new Set<string>();
  private expSaved: { mode: CoreContext['state']['mode']; meVis: boolean; labels: boolean; fov: number } | null = null;
  private busOn = false;
  private busOffs: (() => void)[] = [];
  readonly busLog = new Map<string, { n: number; last: string }>();
  private contract: { phase: string; fails: ContractFail[]; checked: number; ok: string[] } | null = null;
  private reportText = '';
  private dragging: { x: number; y: number } | null = null;
  private canvas: HTMLCanvasElement;

  constructor(readonly ctx: CoreContext) {
    const site = { pauseMoves: (on: boolean) => this.pause('space', on) };
    this.space = new DebugSpace({ setSpace: (s, b) => ctx.setSpace(s, b), me: ctx.me, rig: ctx.rig, state: ctx.state, rooms: ctx.rooms, site });
    this.scenes = new ScenePlayer({
      uiRoot: ctx.uiRoot, kit: ctx.kit, quality: () => ctx.quality() as number, scene: ctx.scene,
      me: () => ({ login: this.login(), role: String((ctx.store.hero as { role?: string } | null)?.role || 'archer'), app: ctx.store.me?.app ?? null }),
    });
    this.freecam = new FreeCam(ctx, (on) => this.pause('freecam', on));
    this.bots = new Bots(ctx);
    this.force = new EventForce(ctx);
    this.canvas = ctx.engine.renderer.domElement;
    this.canvas.addEventListener('pointerdown', this.onPDown);
    addEventListener('pointerup', this.onPUp);
    addEventListener('pointermove', this.onPMove);
    this.canvas.addEventListener('wheel', this.onWheel, { passive: true });
  }

  /* -------------------------------------------------------------- shared */
  private login(): string { return String(this.ctx.store.me?.login || (this.ctx.store.hero as { login?: string } | null)?.login || 'you').toLowerCase(); }
  private secrets(): string[] {
    const h = this.ctx.store.hero as { login?: string; name?: string } | null, me = this.ctx.store.me;
    return [...new Set([h?.login, h?.name, me?.login, me?.app?.name].filter((x): x is string => !!x && x.length >= 2).flatMap((s) => [s, s.toLowerCase()]))];
  }
  private pause(owner: string, on: boolean): void {
    const before = this.pauses.size > 0;
    if (on) this.pauses.add(owner); else this.pauses.delete(owner);
    const after = this.pauses.size > 0;
    if (before !== after) { try { (this.ctx.site as { pauseMoves?(on: boolean): void }).pauseMoves?.(after); } catch { /* */ } }
  }
  private toast(t: string, bad?: boolean): void { this.ctx.ui.toast(t, bad); }
  private ensurePanel(): DebugPanel {
    if (this.panel) return this.panel;
    this.panel = new DebugPanel(this.ctx.uiRoot, { state: () => this.state(), act: (a, v) => this.act(a, v), close: () => this.showPanel(false) });
    return this.panel;
  }
  card(c: CardInfo): void { this.ensurePanel().card(c); }

  /* -------------------------------------------------------------- panel */
  get panelOpen(): boolean { return !!this.panel?.open; }
  showPanel(on: boolean): void {
    const p = this.ensurePanel();
    if (on === p.open) return;
    if (on && this.ctx.state.menu) this.ctx.ui.open(null);
    p.show(on);
    setModal(this.ctx.input, 'debug-panel', on, () => this.showPanel(false));
  }
  togglePanel(): void { this.showPanel(!this.panelOpen); }

  /* -------------------------------------------------------------- test dimension */
  get inside(): boolean { return this.space.active; }
  enterDimension(): boolean {
    if (this.space.active) { if (this.dim && !this.sub && !this.scenes.active) return true; this.backToDim(); return true; }
    const why = this.space.blocked();
    if (why) { this.toast(why, true); return false; }
    if (this.ctx.state.menu) this.ctx.ui.open(null);
    const d = this.makeDim();
    if (!this.space.enter(d, 'dim')) { d.dispose(); this.dim = null; return false; }
    this.applyDimEnv();
    this.toast('🌀 Тестовое измерение · Esc → «Вернуться в город»');
    return true;
  }
  private makeDim(): TestDimension {
    const ctx = this.ctx;
    this.dim = new TestDimension({
      kit: ctx.kit, itemModels: ctx.registries.itemModels, interact: ctx.interact, quality: () => ctx.quality() as number,
      player: () => ({ x: ctx.feet.x, z: ctx.feet.z }), card: (c) => this.card(c), portals: () => this.portals(), totems: () => this.totems(),
      heroName: () => String(ctx.store.me?.app?.name || 'котик'),
    });
    return this.dim;
  }
  private applyDimEnv(): void {
    const d = this.dim; if (!d) return;
    this.ctx.scene.background = d.fogColor.clone();
    this.ctx.scene.fog = new THREE.Fog(d.fogColor.clone(), d.fogNear, d.fogFar);
  }
  /** Teleport inside the dimension to a section. */
  goSection(id: string): void {
    if (!this.dim || this.sub || this.scenes.active) return;
    const p = this.dim.standAt(id); if (!p) return;
    this.ctx.controller().teleport(p.x, p.z);
    this.ctx.rig.yaw = p.face; this.ctx.rig.pitch = -0.12;
  }
  setTime(h: number, instant = false): void { this.dim?.setTime(h, instant); }

  /** Leave everything debug and return to the city where we left it. */
  exitAll(): void {
    this.closeScene(false);
    this.dropSub();
    const had = this.space.active;
    this.space.leave();
    if (this.dim) { this.dim.dispose(); this.dim = null; }
    if (had) this.toast('Ты снова в городе — там же, где был');
  }
  private dropSub(): void {
    const s = this.sub; if (!s) return;
    this.sub = null;
    for (const u of s.owned) { try { u(); } catch { /* */ } }
    try { s.sc.dispose(); } catch (e) { console.error('[l3d] debug room dispose', e); }
    try { s.cleanup?.(); } catch { /* */ }
  }
  /** Back from a room / town / scene to the dimension (at the portal). */
  backToDim(): void {
    const s = this.sub;
    this.dropSub();
    if (!this.dim) { this.exitAll(); return; }
    if (s) { this.dim.spawn.x = s.back.x; this.dim.spawn.z = s.back.z; this.dim.spawn.face = s.back.face; }
    this.dim.active = true;
    this.space.enter(this.dim, 'dim');
    this.applyDimEnv();
  }

  /** Open a room scene from a portal (client-only RoomContext, stub actions). */
  private async openPlace(title: string, make: (rctx: ReturnType<typeof demoRoomCtx>, sub: SubRoom) => Promise<RoomScene>, buildingId = 'debug', cleanup?: () => void): Promise<void> {
    const ctx = this.ctx;
    if (!this.dim || this.sub) return;
    const p = ctx.player, back = { x: p.x, z: Math.max(-1, p.z - 1.2), face: 0 };
    const sub: SubRoom = { sc: null as unknown as RoomScene, owned: [], frames: [], back, cleanup };
    const actions = stubActions((t) => this.toast(t), demoStock);
    const rctx = demoRoomCtx(ctx, buildingFor(ctx, buildingId, title), { exit: () => this.backToDim(), actions, owned: sub.owned, frames: sub.frames });
    ctx.veil(title);
    try {
      this.dim.active = false;
      sub.sc = await make(rctx, sub);
      if (!this.dim || !this.space.active) { sub.sc.dispose(); for (const u of sub.owned) u(); return; }
      this.sub = sub;
      this.space.enter(sub.sc, 'room');
      this.toast(`${title} · демо, ничего не уходит на сайт · Esc → «Назад в измерение»`);
    } catch (e) {
      console.error('[l3d] debug place', title, e);
      for (const u of sub.owned) { try { u(); } catch { /* */ } }
      try { cleanup?.(); } catch { /* */ }
      if (this.dim) this.dim.active = true;
      this.toast('Не получилось открыть: ' + title, true);
    } finally { ctx.veil(null); }
  }
  private openTown(title: string, L: CityLayout): void {
    void this.openPlace(title, async () => {
      const w = await buildCity(L, { quality: this.ctx.quality(), renderer: this.ctx.engine.renderer });
      return worldRoom(w, L);
    });
  }
  /** The portal list (built when the dimension is made). */
  portals(): PortalDef[] {
    const ctx = this.ctx, demo = demoData(), out: PortalDef[] = [];
    out.push({ id: 'city', title: 'Обратно в город', icon: '🏙️', color: '#ffcf6a', sub: 'туда, где ты стоял', go: () => this.exitAll() });
    for (const id of ['forge', 'magic', 'shop', 'tent']) {
      out.push({ id, title: SHOP_TITLES[id] || id, icon: SHOP_ICON[id] || '🏪', color: '#ff8fa3', sub: '3D-лавка · демо-товары',
        go: () => void this.openPlace(SHOP_TITLES[id] || id, async (rctx) => { const env = envFromCtx(rctx); env.ench = null; return createShopRoom(env, { stock: demoData()?.stock ?? demoStock() }); }, id) });
    }
    const hyb = ctx.registries.rooms.get('hybrid');
    for (const [id, [title, icon]] of Object.entries(HYBRID_RU)) {
      if (ctx.registries.buildings.resolve(id).room !== 'hybrid') continue;
      out.push({ id, title, icon, color: '#b9a2ff', sub: 'интерьер', off: hyb ? undefined : 'нет модуля комнат',
        go: () => void this.openPlace(title, (rctx) => hyb!.create(rctx), id) });
    }
    out.push(demo?.mine
      ? { id: 'mine', title: 'Шахта', icon: '⛏️', color: '#8fe39a', sub: 'оффлайн-шахта (FakeMine)', go: () => void this.openPlace('Шахта', (rctx) => demo.mine!(rctx), 'mine') }
      : { id: 'mine', title: 'Шахта', icon: '⛏️', color: '#8fe39a', off: 'только в dev-сборке', go: () => { /* */ } });
    const camp = siteCampLayout() ? () => siteCampLayout() : demo?.campLayout;
    const campTitle = campName(String(ctx.layout().styleId || 'cats'), (window as any).MDDoodle?.names).name;   // «Кошачий привал» in the cat style
    out.push(camp ? { id: 'camp', title: campTitle, icon: '🏕️', color: '#ffb27a', sub: 'стартовый лагерь', go: () => { const L = camp(); if (L) this.openTown(campTitle, L); else this.toast('Лагерь недоступен', true); } }
      : { id: 'camp', title: campTitle, icon: '🏕️', color: '#ffb27a', off: 'откроется, когда сайт загрузит лагерь', go: () => { /* */ } });
    const town = siteDistrictLayout();
    out.push(town ? { id: 'district', title: 'Город округа', icon: '🏘️', color: '#7fd6e6', sub: 'демо-посад (towngen.js)', go: () => { const L = siteDistrictLayout(); if (L) this.openTown('Демо-посад', L); } }
      : { id: 'district', title: 'Город округа', icon: '🏘️', color: '#7fd6e6', off: 'нужен towngen.js сайта', go: () => { /* */ } });
    let here = ''; try { here = ctx.layout().id; } catch { /* */ }
    if (here === 'fair') out.push({ id: 'fair', title: 'Ярмарка', icon: '🎡', color: '#ffe27a', sub: 'твой город — выход', go: () => this.exitAll() });
    else if (demo?.fairLayout) out.push({ id: 'fair', title: 'Ярмарка', icon: '🎡', color: '#ffe27a', sub: 'демо-копия', go: () => this.openTown('Ярмарка', demo.fairLayout!()) });
    else out.push({ id: 'fair', title: 'Ярмарка', icon: '🎡', color: '#ffe27a', off: 'только в dev-сборке', go: () => { /* */ } });
    return out;
  }
  totems(): TotemDef[] {
    const f = this.force;
    const ev = (id: ForcedEvent, title: string, icon: string, color: string): TotemDef => ({ id, title, icon, color, on: () => f.event === id, toggle: () => this.setEvent(f.event === id ? '' : id) });
    return [
      ev('halloween', 'Хэллоуин', '🎃', '#ff7a1a'), ev('newyear', 'Новый год', '🎄', '#7fd6e6'), ev('summer', 'Лето', '🏮', '#ffe27a'), ev('aprilfools', '1 апреля', '🤡', '#ff8fa3'),
      { id: 'hwc', title: 'Тыквенная Луна', icon: '🌑', color: '#9a6aff', on: () => f.hwc !== '', toggle: () => this.setHwc(f.hwc ? '' : 'portal') },
      { id: 'day', title: 'День / вечер', icon: '☀️', color: '#fff1c2', on: () => !!this.dim && Math.abs(this.dim.todTarget - 12) < 1, toggle: () => this.setTime(this.dim && Math.abs(this.dim.todTarget - 12) < 1 ? 18.5 : 12) },
    ];
  }
  setEvent(id: ForcedEvent): void {
    this.force.setEvent(id);
    if (id && settingValue<string>(EVENT_SETTING, 'auto') === 'off') this.toast('Праздничное оформление выключено в настройках — включи «Авто» или «Всегда»', true);
    else if (id) this.toast(this.inside ? 'Праздник включён — увидишь в городе' : 'Праздник включён');
    this.dim?.syncTotems();
  }
  setHwc(v: ForcedHwc): void {
    this.force.setHwc(v);
    let fair = true; try { fair = this.ctx.layout().id === 'fair'; } catch { /* */ }
    if (v && !fair) this.toast('Ночь Тыквенной Луны видна только на Ярмарке');
    this.dim?.syncTotems();
  }

  /* -------------------------------------------------------------- expedition scenes */
  private openSceneSpace(): boolean {
    const ctx = this.ctx;
    if (this.scenes.active) return true;
    if (!this.space.active) { const why = this.space.blocked(); if (why) { this.toast(why, true); return false; } }
    if (this.sub) this.dropSub();
    if (this.dim) this.dim.active = false;
    const sc = this.scenes.open();
    this.expSaved = { mode: ctx.state.mode, meVis: ctx.meAv.root.visible, labels: ctx.labels.root.visible, fov: ctx.camera.fov };
    if (!this.space.enter(sc, 'exp')) { this.scenes.close(); this.expSaved = null; if (this.dim) this.dim.active = true; return false; }
    ctx.state.mode = 'tp'; ctx.applyCamera(true);
    ctx.meAv.root.visible = false; ctx.labels.root.visible = false;
    return true;
  }
  playMock(id: string): void { if (this.openSceneSpace()) this.scenes.playMock(id); }
  playAuto(sec = 0): void { if (this.openSceneSpace()) this.scenes.playAuto(sec); }
  /** Close the scene viewer; back to the dimension when we came from there, else to the city. */
  closeScene(goBack = true): void {
    const ctx = this.ctx;
    if (!this.scenes.view) return;
    this.scenes.close();
    if (this.expSaved) {
      ctx.state.mode = this.expSaved.mode; ctx.applyCamera(true);
      ctx.meAv.root.visible = this.expSaved.meVis; ctx.labels.root.visible = this.expSaved.labels;
      ctx.camera.fov = this.expSaved.fov; ctx.camera.updateProjectionMatrix();
      this.expSaved = null;
    }
    if (!goBack) return;
    if (this.dim) this.backToDim(); else this.space.leave();
  }

  /* -------------------------------------------------------------- overlays */
  setPerf(on: boolean): void {
    if (on && !this.perf) {
      const e = this.ctx.engine as typeof this.ctx.engine & { debug?: () => object };
      const r = this.ctx.engine.renderer;
      this.perf = new PerfHud(this.ensurePanel().overlayRoot, {
        stats: () => this.ctx.engine.stats(), debug: () => (e.debug ? e.debug() : {}) as never,
        info: () => ({ geometries: r.info.memory.geometries, textures: r.info.memory.textures }), quality: () => this.ctx.quality() as number,
      });
    } else if (!on && this.perf) { this.perf.dispose(); this.perf = null; }
  }
  setGrid(on: boolean): void {
    if (on && !this.grid) {
      const ctx = this.ctx;
      const scene = (): RoomScene | null => (this.space.active ? this.space.scene : ctx.rooms.scene) || null;
      this.grid = new GridOverlay({
        units: () => (ctx.state.inRoom ? 'm' : 'px'),
        free: (x, y) => { const s = scene(); return ctx.state.inRoom ? !!s?.free(x, y) : ctx.layout().free(x, y); },
        solidTop: (x, y) => { const s = scene(); if (ctx.state.inRoom) return s?.solidTop ? s.solidTop(x, y) : -Infinity; const w = ctx.world() as unknown as { solidTop?(x: number, y: number): number }; return w.solidTop ? w.solidTop(x, y) : -Infinity; },
        groundAt: (x, y) => { const s = scene(); return ctx.state.inRoom ? (s ? s.groundAt(x, y) : 0) : ctx.world().groundAt(x, y); },
        feet: () => ({ x: ctx.feet.x, z: ctx.feet.z }),
        boxes: () => {
          if (ctx.state.inRoom) return [];
          const w = ctx.world() as unknown as { interactables?(): { hit: THREE.Box3 | THREE.Object3D }[] };
          const out: THREE.Box3[] = [];
          try { for (const i of w.interactables?.() || []) out.push((i.hit as THREE.Box3).isBox3 ? (i.hit as THREE.Box3) : new THREE.Box3().setFromObject(i.hit as THREE.Object3D)); } catch { /* */ }
          for (const d of ctx.world().doors) out.push(new THREE.Box3().setFromCenterAndSize(d.pos, new THREE.Vector3(1.2, 2.2, 0.6)));
          return out;
        },
        target: () => { const t = ctx.interact.target; if (!t) return null; return (t.hit as THREE.Box3).isBox3 ? (t.hit as THREE.Box3) : (this.tgtBox.setFromObject(t.hit as THREE.Object3D), this.tgtBox); },
      });
      ctx.scene.add(this.grid.root);
      this.grid.update(true);
    } else if (!on && this.grid) { this.grid.dispose(); this.grid = null; }
  }
  private tgtBox = new THREE.Box3();
  setWire(on: boolean): void { if (!this.wire) this.wire = new Wireframe(this.ctx.scene); this.wire.set(on); }

  /* -------------------------------------------------------------- site: contract, report, bus */
  checkContract(): void {
    const checks = (CONTRACT as { checks: ContractCheck[] }).checks;
    const phase: 'page' | 'city' = (window as unknown as { LGCity?: unknown }).LGCity ? 'city' : 'page';
    let fails: ContractFail[] = [];
    try { fails = runtimeContract(checks, window, document, phase); } catch (e) { console.warn('[l3d] debug contract', e); }
    const runtime = checks.filter((c) => !!c.kind);
    const bad = new Set(fails.map((f) => f.id));
    this.contract = { phase: phase === 'city' ? 'город открыт' : 'страница', fails, checked: runtime.length, ok: runtime.filter((c) => !bad.has(c.id)).map((c) => c.id) };
  }
  report(): string {
    const ctx = this.ctx, r = ctx.engine.renderer;
    if (!this.contract) this.checkContract();
    let gpu = 'неизвестно';
    try { const gl = r.getContext(); const ext = gl.getExtension('WEBGL_debug_renderer_info'); gpu = String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)); } catch { /* */ }
    const e = ctx.engine as typeof ctx.engine & { debug?: () => { setting?: unknown; level?: number; scale?: number; pixelRatio?: number; post?: boolean; shadows?: boolean; cpuMs?: number } };
    const d = e.debug?.() || {}, s = ctx.engine.stats();
    const mem = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
    const secrets = this.secrets();
    let town = '?'; try { town = ctx.layout().id; } catch { /* */ }
    const text = buildReport({
      version: VERSION, dev: isDev(), ua: navigator.userAgent, platform: navigator.platform || '', lang: navigator.language,
      screen: `${screen.width}×${screen.height}`, dpr: devicePixelRatio, gpu, webgl2: r.capabilities.isWebGL2,
      quality: { setting: String(d.setting ?? 'auto'), level: ctx.quality() as number, scale: s.scale, pixelRatio: d.pixelRatio, post: d.post, shadows: d.shadows },
      perf: { fps: s.fps, ms: s.ms, calls: s.calls, tris: s.tris, cpuMs: d.cpuMs },
      memory: { geometries: r.info.memory.geometries, textures: r.info.memory.textures, heapMB: mem ? Math.round(mem.usedJSHeapSize / 1048576) : undefined },
      town, space: this.space.active ? 'отладка: ' + this.space.owner : ctx.rooms.current ? 'здание ' + ctx.rooms.current : '',
      settings: (() => { try { return pickSettings(localStorage, secrets); } catch { return {}; } })(),
      contract: { phase: this.contract!.phase, fails: this.contract!.fails, checked: this.contract!.checked },
      drift: driftList().map((x) => ({ kind: x.kind, id: x.id })),
      scripts: siteScripts([...document.scripts].map((x) => x.src).filter(Boolean), location.origin),
      secrets,
    });
    this.reportText = text;
    return text;
  }
  async copyReport(): Promise<boolean> {
    const t = this.report();
    try { await navigator.clipboard.writeText(t); this.toast('Отчёт скопирован — вставь его в сообщение о баге'); return true; }
    catch { this.toast('Не удалось скопировать — выдели текст в поле ниже', true); return false; }
  }
  setBus(on: boolean): void {
    if (on === this.busOn) return;
    this.busOn = on;
    for (const o of this.busOffs) o(); this.busOffs = [];
    const bus = (window as unknown as { __L3D_BUS?: { on(t: string, fn: (d: unknown) => void): () => void } }).__L3D_BUS;
    if (!on || !bus) return;
    const sec = this.secrets();
    for (const t of BUS_TYPES) {
      this.busOffs.push(bus.on(t, (d) => {
        const r = this.busLog.get(t) || { n: 0, last: '' };
        r.n++; r.last = preview(d, sec, 160);
        this.busLog.set(t, r);
      }));
    }
  }

  /* -------------------------------------------------------------- panel model */
  state(): PanelState {
    const ctx = this.ctx, d = this.dim, sc = this.scenes;
    const e = ctx.engine as typeof ctx.engine & { debug?: () => { setting?: unknown } };
    let setting = 'auto'; try { setting = String(e.debug?.().setting ?? 'auto'); } catch { /* */ }
    if (!this.contract) this.checkContract();
    let town = '?'; try { town = ctx.layout().id; } catch { /* */ }
    const st = d?.stats;
    return {
      dim: { inside: this.inside && !!d, blocked: this.space.active ? '' : this.space.blocked(), sections: d ? d.sectionList() : [], tod: d ? d.todTarget : 18.5,
        info: st ? `Разделов построено ${st.built}/${st.sections} · предметов ${st.items} · обликов ${st.looks} · врагов ${st.foes} · порталов ${st.portals} · склейка ${st.bakedFrom}→${st.bakedTo} вызовов · сейчас ${ctx.engine.stats().calls} вызовов` : 'Войди — разделы строятся, когда подходишь к ним.' },
      scenes: { playing: sc.playing, open: sc.active, paused: sc.paused, speed: sc.speed, plan: sc.planSec, dur: sc.duration, segs: sc.segments(), ...sc.status() },
      world: { freecam: this.freecam.on, quality: setting, level: ctx.quality() as number, event: this.force.event, hwc: this.force.hwc, bots: this.bots.count, eventMode: settingValue<string>(EVENT_SETTING, 'auto') },
      over: { perf: !!this.perf, grid: !!this.grid, wire: !!this.wire?.on },
      site: { version: VERSION, dev: isDev(), phase: this.contract!.phase, checked: this.contract!.checked, fails: this.contract!.fails, okIds: this.contract!.ok,
        drift: driftList().map((x) => x.kind + ':' + x.id), scripts: siteScripts([...document.scripts].map((x) => x.src).filter(Boolean), location.origin).slice(0, 16), town, report: this.reportText },
      bus: { on: this.busOn, present: !!(window as unknown as { __L3D_BUS?: unknown }).__L3D_BUS, rows: [...this.busLog.entries()].sort((a, b) => b[1].n - a[1].n).map(([t, r]) => [t, r.n, r.last] as [string, number, string]) },
    };
  }
  act(a: string, v?: string): void {
    switch (a) {
      case 'dim-enter': if (this.enterDimension()) this.showPanel(false); break;
      case 'dim-exit': this.exitAll(); break;
      case 'dim-go': this.goSection(v || ''); this.showPanel(false); break;
      case 'tod': this.setTime(+(v || 12), false); break;
      case 'sc-auto': this.playAuto(0); break;
      case 'sc-mock': this.playMock(v || ''); break;
      case 'sc-close': this.closeScene(true); break;
      case 'sc-pause': this.scenes.paused = !this.scenes.paused; break;
      case 'sc-speed': this.scenes.speed = +(v || 1) || 1; break;
      case 'seek': this.scenes.seek(+(v || 0)); break;
      case 'freecam': this.freecam.set(!this.freecam.on); if (this.freecam.on) this.showPanel(false); break;
      case 'quality': this.ctx.engine.setQuality(v === 'auto' ? 'auto' : (+(v || 2) as 0 | 1 | 2 | 3)); break;
      case 'event': this.setEvent((v || '') as ForcedEvent); break;
      case 'hwc': this.setHwc((v || '') as ForcedHwc); break;
      case 'bots': if (v === '0') this.bots.clear(); else this.bots.spawn(+(v || 5)); break;
      case 'perf': this.setPerf(!this.perf); break;
      case 'grid': this.setGrid(!this.grid); break;
      case 'wire': this.setWire(!this.wire?.on); break;
      case 'contract': this.checkContract(); break;
      case 'report': void this.copyReport().then(() => this.panel?.render()); break;
      case 'bus': this.setBus(!this.busOn); break;
      case 'bus-clear': this.busLog.clear(); break;
    }
  }

  /* -------------------------------------------------------------- per frame (only while debug mode is on) */
  frame(dt: number, t: number): void {
    const ctx = this.ctx;
    if (this.space.active && this.space.lost()) {
      // somebody else (the expedition feature, a room) took the space: let go without touching the city
      if (this.scenes.view) { this.scenes.close(); if (this.expSaved) { ctx.meAv.root.visible = this.expSaved.meVis; ctx.labels.root.visible = this.expSaved.labels; this.expSaved = null; } }
      this.dropSub(); if (this.dim) { this.dim.dispose(); this.dim = null; }
      this.space.drop();
    }
    if (this.space.active) {
      if (this.scenes.active) {
        const sc = this.scenes;
        sc.frame(dt, t, ctx.camera);
      } else if (this.sub) {
        this.sub.sc.update(dt, t, ctx.camera);
        for (let i = 0; i < this.sub.frames.length; i++) this.sub.frames[i](dt, t);
      } else if (this.dim) this.dim.update(dt, t, ctx.camera);
    }
    this.freecam.frame(dt);
    this.bots.frame(dt);
    this.force.frame(dt);
    this.perf?.frame(dt);
    this.grid?.update();
    this.panel?.tick(dt);
  }

  /* -------------------------------------------------------------- mouse in the scene viewer */
  private onPDown = (e: PointerEvent) => { if (this.scenes.active) this.dragging = { x: e.clientX, y: e.clientY }; };
  private onPUp = () => { this.dragging = null; };
  private onPMove = (e: PointerEvent) => {
    if (!this.dragging || !this.scenes.active) return;
    this.scenes.look(-(e.clientX - this.dragging.x) * 0.005, (e.clientY - this.dragging.y) * 0.004);
    this.dragging = { x: e.clientX, y: e.clientY };
  };
  private onWheel = (e: WheelEvent) => { if (this.scenes.active) this.scenes.zoom(Math.sign(e.deltaY)); };

  /** Where the current debug space is, for the Esc menu labels. */
  where(): 'dim' | 'room' | 'exp' | '' { return (this.space.active ? (this.space.owner as 'dim' | 'room' | 'exp') : ''); }

  dispose(): void {
    this.exitAll();
    this.freecam.dispose(); this.bots.dispose(); this.force.dispose();
    this.setBus(false); this.setPerf(false); this.setGrid(false); this.wire?.dispose(); this.wire = null;
    if (this.panel?.open) setModal(this.ctx.input, 'debug-panel', false);
    this.panel?.dispose(); this.panel = null;
    this.canvas.removeEventListener('pointerdown', this.onPDown);
    removeEventListener('pointerup', this.onPUp);
    removeEventListener('pointermove', this.onPMove);
    this.canvas.removeEventListener('wheel', this.onWheel);
    for (const p of [...this.pauses]) this.pause(p, false);
  }
}
