/**
 * Shared room runtime: RoomEnv (what a scene builder needs — a RoomContext or a dev fake), the RoomBase that owns the kit,
 * NPCs, goods, interactables, buy card, lights/fog, and turns it all into a RoomScene.
 */
import * as THREE from 'three';
import type { Building, Store, Actions, Hero } from '../../contracts';
import type { Interactable, InteractSystem, ItemModelFactory, Registry, RoomContext, RoomScene } from '../../contracts/ext';
import { paletteOf, type Pal } from '../../world/palette';
import { RoomKit, hitBox, hitPlane } from './kit';
import { Npc, type NpcDef } from './npc';
import { BuyCard } from './card';
import { TagAtlas, type TagSpec } from './tags';
import { bakeModels, itemObject, type Placed } from './items';
import { offerOf, topIdsOf, LOCK_T, type CityStock, type PriceEnv, type StockItem } from './stock';
import { separateBoxes } from './hits';
import { moneyText } from '../../ui/money';
import { coinStyle } from '../../ui/data';
import { hideOutline, showOutline } from '../../engine/outline';
import type { Avatar } from '../../contracts/modules';
import type { RoomCombat, RoomFighter, RoomSpace } from '../../combat/room';

/** What a room scene builder needs. Built from a RoomContext (envFromCtx) or by the dev page. */
export interface RoomEnv {
  building: Building;
  styleId: string;
  quality: number;
  store: Store;
  actions: Actions;
  input?: { setGameplay(on: boolean): void; lock?(): void };
  interact?: InteractSystem | null;
  scene?: THREE.Scene | null;
  itemModels?: Registry<ItemModelFactory> | null;
  toast(text: string, bad?: boolean): void;
  exit(): void;
  showSitePanel?(opts?: { side?: 'left' | 'right' | 'full' }): void;
  hideSitePanel?(): void;
  /** Player feet in room space (m). */
  player(): { x: number; z: number };
  /** District town: id and price multiplier (foreign town > 1). */
  town?: { id: string; foreignK: number } | null;
  /** Scene variant override (BuildingDef.scene). */
  variant?: string;
  /** /api/me .ench (material prices); optional. */
  ench?: { coins?: { star?: number; sphere?: number } } | null;
}

export function envFromCtx(ctx: RoomContext): RoomEnv {
  const L = (() => { try { return ctx.layout(); } catch { return null; } })();
  const def = ctx.registries?.buildings?.get(ctx.building.id);
  return {
    building: ctx.building, styleId: (L && L.styleId) || 'cats', quality: ctx.quality(),
    store: ctx.store, actions: ctx.actions, input: ctx.input, interact: ctx.interact, scene: ctx.scene,
    itemModels: ctx.registries?.itemModels || null,
    toast: (t, bad) => ctx.ui.toast(t, bad), exit: () => ctx.exit(),
    showSitePanel: (o) => ctx.showSitePanel(o), hideSitePanel: () => ctx.hideSitePanel(),
    player: () => ({ x: ctx.player.x, z: ctx.player.z }),
    town: L && L.id && L.id !== 'fair' ? { id: L.id, foreignK: +((L as any).foreignK || 1) || 1 } : null,
    variant: def && def.scene ? def.scene : undefined,
  };
}

export interface Good {
  it: StockItem; b: string;
  /** Model bounds and the (non-overlapping) hit volume. */
  box: THREE.Box3; hit: THREE.Box3;
  tag: number;
  /** Vertex range of this good in the merged lit goods geometry (its outline = exactly these vertices). */
  range: { start: number; count: number };
  inter: Interactable;
}

const DOOR_OPEN_S = 0.55, DOOR_CLOSE_S = 0.7;
const easeInOut = (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
/** Fade the page to the night colour by `inS` seconds (starting after the door has begun to swing), hold, fade back (the room swap happens under it). */
function fadeFlash(inS: number): void {
  if (typeof document === 'undefined' || !document.body) return;
  const el = document.createElement('div');
  el.setAttribute('aria-hidden', 'true');
  el.style.cssText = `position:fixed;inset:0;z-index:104;pointer-events:none;background:#0d0b22;opacity:0;transition:opacity ${inS * 0.55}s ease-in ${inS * 0.45}s`;   // the door swings first, then the fade
  document.body.appendChild(el);
  requestAnimationFrame(() => { el.style.opacity = '1'; });
  setTimeout(() => { el.style.transition = 'opacity .35s ease-out'; el.style.opacity = '0'; setTimeout(() => el.remove(), 400); }, inS * 1000 + 120);
}
const PICK_RC = new THREE.Raycaster(), PICK_P = new THREE.Vector3(), PICK_HITS: THREE.Intersection[] = [];

export class RoomBase {
  readonly kit: RoomKit;
  readonly pal: Pal;
  readonly npcs: Npc[] = [];
  /**
   * Figures standing in the room — NPCs and mannequins — with their resting facing (Walker.face convention: 0 looks
   * to −Z, forward = (−sin f, −cos f)). Facing audits (test/rooms-facing.test.ts): they must look into the walkable area.
   */
  readonly figures: { name: string; x: number; z: number; face: number }[] = [];
  readonly goods: Good[] = [];
  /** Figures src/combat may knock over (NPCs, tent mannequins): see src/combat/room.ts. */
  readonly fighters: RoomFighter[] = [];
  private afterFns: ((dt: number, t: number) => void)[] = [];
  readonly inters: Interactable[] = [];
  card: BuyCard | null = null;
  tags: TagAtlas | null = null;
  stock: CityStock | null = null;
  spawn = { x: 0, z: 2, face: 0 };
  private unsubs: (() => void)[] = [];
  private updaters: ((dt: number, t: number) => void)[] = [];
  private disposers: (() => void)[] = [];
  private extraTags: { spec: TagSpec; pos: [number, number, number, number, number] }[] = [];
  private pending: Placed[] = [];
  private pendingGoods: { it: StockItem; b: string; tag: [number, number, number, number, number] | null }[] = [];
  /** Invisible carrier of the aimed good's outline: the lit goods geometry with the good's draw range. */
  private highlight: THREE.Mesh | null = null;
  private hiView: THREE.BufferGeometry | null = null;
  /** The good currently highlighted (= the interaction target), or null. */
  hot: Good | null = null;
  private colliders: THREE.Object3D[] = [];
  private fogSave: { fog: THREE.Fog | THREE.FogExp2 | null; bg: THREE.Color | THREE.Texture | null } | null = null;
  bg = '#1a1424';
  fogNear = 16; fogFar = 42;

  constructor(readonly env: RoomEnv, name: string) {
    this.pal = paletteOf(env.styleId);
    this.kit = new RoomKit(this.pal, env.quality, 'room:' + name);
  }

  get root(): THREE.Group { return this.kit.root; }
  heroName = (): string => { const h = this.env.store.hero; return (h && h.name) || 'путник'; };

  /* ------------------------------------------------------------ building blocks */
  /** NPC (behind a counter: pass y = DAIS). */
  npc(def: NpcDef): Npc {
    const n = new Npc(def, this.env.styleId, this.heroName);
    this.npcs.push(n); this.root.add(n.root);
    this.figures.push({ name: def.name, x: def.x, z: def.z, face: def.face });
    this.kit.solid(def.x - 0.35, def.x + 0.35, def.z - 0.3, def.z + 0.3, Infinity, false);
    this.fighters.push({
      id: 'room:npc:' + def.seed + ':' + this.fighters.length, av: n.av, kind: 'npc', home: n.home,
      say: (text, t) => n.say(text, t, 2600), follow: (x, y, z) => n.follow(x, y, z),
    });
    return n;
  }
  /**
   * A standing figure that is not an Npc (tent mannequin) and may be knocked over in a fight: its avatar root must be
   * a direct child of the room root at (x, y, z). It pops back onto this spot after getting up.
   */
  combatFigure(av: Avatar, x: number, y: number, z: number, name = 'figure'): void {
    const home = { x, y, z };
    this.fighters.push({ id: 'room:fig:' + name + ':' + this.fighters.length, av, kind: 'mannequin', home });
  }
  /** Interactable registered with the game's interaction system (removed on dispose). */
  interact(i: Interactable): Interactable {
    this.inters.push(i);
    if (this.env.interact) this.unsubs.push(this.env.interact.add(i));
    if ((i.hit as THREE.Object3D).isObject3D && !(i.hit as THREE.Object3D).parent) this.root.add(i.hit as THREE.Object3D);
    return i;
  }
  /**
   * The interactable whose hit volume a world ray meets first (scene mode: the free cursor's click / hover), or null.
   * Exact mesh raycast for Object3D hits (one-sided planes honour their side), slab test for Box3 hits. No allocations.
   */
  pick(ray: THREE.Ray, far = 30): Interactable | null {
    let best: Interactable | null = null, bestD = far;
    PICK_RC.ray.copy(ray); PICK_RC.near = 0; PICK_RC.far = far;
    for (const i of this.inters) {
      const h = i.hit as THREE.Object3D | THREE.Box3;
      if ((h as THREE.Box3).isBox3) {
        const p = ray.intersectBox(h as THREE.Box3, PICK_P);
        if (p) { const d = p.distanceTo(ray.origin); if (d < bestD) { bestD = d; best = i; } }
        continue;
      }
      PICK_HITS.length = 0;
      (h as THREE.Object3D).raycast(PICK_RC, PICK_HITS);
      for (const x of PICK_HITS) if (x.distance < bestD) { bestD = x.distance; best = i; }
    }
    PICK_HITS.length = 0;
    return best;
  }
  onUpdate(fn: (dt: number, t: number) => void): void { this.updaters.push(fn); }
  onDispose(fn: () => void): void { this.disposers.push(fn); }
  /** A tag that is not a good (tent booth prices). Returns its future atlas index via the callback. */
  addTag(spec: TagSpec, pos: [number, number, number, number, number]): void { this.extraTags.push({ spec, pos }); }
  /** «Выйти на улицу» door: a closed door (kit.exitDoor) that swings open as you leave and closes behind you on entering. */
  exitDoor(x = this.kit.doorGap.x, w = this.kit.doorGap.w, h = this.kit.doorGap.h, o: { style?: 'wood' | 'curtain'; z?: number } = {}): void {
    const c = this.kit.exitDoor(x, w, h, o);
    // one-sided (faces the room): the TP camera behind the cutaway entrance wall looks through it, never «at» it
    this.interact({ id: 'room:exit', label: 'Выйти на улицу', icon: '🚪', hit: hitPlane(c.x, c.y, c.z - 0.12, w, h, Math.PI, 'room:hit:exit'), reach: 3.2, use: () => this.leave() });
    const door = this.kit.door;
    if (!door) return;
    // entering: the door you came through is still swinging shut behind you
    door.set(0.55);
    let closeT = -0.25;
    this.onUpdate((dt) => {
      if (this.leaving >= 0) {
        this.leaving += dt;
        door.set(easeInOut(Math.min(1, this.leaving / DOOR_OPEN_S)));
        if (this.leaving >= DOOR_OPEN_S && !this.left) { this.left = true; this.env.exit(); }
        return;
      }
      if (closeT < DOOR_CLOSE_S) { closeT += dt; door.set(0.55 * (1 - easeInOut(Math.max(0, closeT) / DOOR_CLOSE_S))); }
    });
  }
  private leaving = -1;
  private left = false;
  /**
   * Leave through the door: it swings open into the warm street while the screen fades, then the room manager takes
   * us back outside. Rooms without a kit door (anvil's open shed) leave at once.
   */
  leave(): void {
    if (!this.kit.door) { this.env.exit(); return; }
    if (this.leaving >= 0) return;
    this.leaving = 0;
    fadeFlash(DOOR_OPEN_S);
    // the door creaks open now, while it visibly swings (the sound feature skips its own door.open on this exit)
    try { window.dispatchEvent(new CustomEvent('l3d:sfx', { detail: { id: 'door.open' } })); } catch { /* no sound */ }
    (window as unknown as { __l3dDoorOpened?: number }).__l3dDoorOpened = performance.now();
  }
  /** Queue a good: model placed with its pivot at (x,y,z), fitted to `fit` m; tag at tagPos [x,y,z,ry,rx]. */
  good(it: StockItem, b: string, p: Omit<Placed, 'obj'>, tag: [number, number, number, number, number] | null): void {
    let obj: THREE.Object3D;
    try { obj = itemObject(it, { itemModels: this.env.itemModels }); } catch { obj = new THREE.Object3D(); }
    this.pending.push({ ...p, obj });
    this.pendingGoods.push({ it, b, tag });
  }
  /** Price environment for the current hero. */
  priceEnv = (): PriceEnv => ({
    hero: this.env.store.hero as Hero | null, ench: this.env.ench || null,
    foreignK: this.env.town ? this.env.town.foreignK : 1, town: this.env.town ? this.env.town.id : null,
    topIds: topIdsOf(this.stock),
  });
  /**
   * Prompt label of a good, naming exactly the aimed item: «Купить: Коготок — 32 чешуйки» when it can be bought for
   * coins here; «Осмотреть: Коготок — на стриме, 400 баллов» / «… — 🔒 после захвата» otherwise.
   */
  goodLabel(it: StockItem, b: string): string {
    const of = offerOf(it, b, this.priceEnv());
    if (of.kind === 'coins' || of.kind === 'mat') return `Купить: ${it.name} — ${moneyText(of.coins, of.coins, coinStyle())}`;
    if (of.kind === 'locked') return `Осмотреть: ${it.name} — 🔒 ${LOCK_T.toLowerCase()}`;
    return `Осмотреть: ${it.name} — на стриме${of.points ? `, ${of.points.toLocaleString('ru-RU')} баллов` : ''}`;
  }
  tagSpec(it: StockItem, b: string, hot = false): TagSpec {
    const of = offerOf(it, b, this.priceEnv());
    if (of.kind === 'coins' || of.kind === 'mat') return { name: it.name, rarity: it.rarity, coins: of.coins, poor: of.poor, hot };
    if (of.kind === 'locked') return { name: it.name, rarity: it.rarity, text: '🔒 после захвата', hot };
    return { name: it.name, rarity: it.rarity, text: of.points ? `${of.points.toLocaleString('ru-RU')} б.` : 'на стриме', hot };
  }
  /**
   * Open the card of exactly this good (bound to it: the purchase uses g.it, never the current aim).
   * buy = true (E on a coin good) → the full card with the confirmation «Купить «X» за Y? Да / Нет» shown;
   * otherwise (F «Осмотреть», stream-only goods) → the full card with «Купить…».
   */
  openGood(g: Good, buy: boolean): void {
    if (!this.card) return;
    this.card.openGood(g.it, g.b, this.priceEnv, buy ? 'ask' : 'card');
  }
  ensureCard(): BuyCard {
    if (!this.card) {
      this.card = new BuyCard({
        store: this.env.store, actions: this.env.actions, input: this.env.input, toast: this.env.toast,
        onDone: () => this.refreshTags(),
      });
    }
    return this.card;
  }
  refreshTags(): void {
    if (!this.tags) return;
    for (const g of this.goods) { if (g.tag >= 0) this.tags.draw(g.tag, this.tagSpec(g.it, g.b, g === this.hot)); g.inter.label = this.goodLabel(g.it, g.b); }
  }

  /* ------------------------------------------------------------ finish */
  /** Bake goods + tags, build static meshes, lights, fog; returns the RoomScene. */
  finish(): RoomScene {
    const K = this.kit;
    // tags (goods + extra) in one atlas
    const nTags = this.pendingGoods.filter((g) => g.tag).length + this.extraTags.length;
    this.tags = nTags ? new TagAtlas(nTags) : null;
    for (const e of this.extraTags) { const [x, y, z, ry, rx] = e.pos; const i = this.tags!.place(x, y, z, ry, 0.3, rx); this.tags!.draw(i, e.spec); }
    // goods
    if (this.pending.length) {
      this.ensureCard();
      const { group, boxes, ranges, lit, owned } = bakeModels(this.pending);
      this.root.add(group); K.owned.push(...owned);
      // hit volumes: the model's box + a little margin, then shrunk so that neighbours never overlap
      const hits = boxes.map((bx) => {
        const c = bx.getCenter(new THREE.Vector3()), s = bx.getSize(new THREE.Vector3()).addScalar(0.06).max(new THREE.Vector3(0.18, 0.18, 0.18));
        return new THREE.Box3().setFromCenterAndSize(c, s);
      });
      separateBoxes(hits);
      this.pendingGoods.forEach((pg, i) => {
        let tag = -1;
        if (pg.tag && this.tags) { const [x, y, z, ry, rx] = pg.tag; tag = this.tags.place(x, y, z, ry, 0.28, rx); this.tags.draw(tag, this.tagSpec(pg.it, pg.b)); }
        const hb = hits[i], c = hb.getCenter(new THREE.Vector3()), sz = hb.getSize(new THREE.Vector3());
        const hit = hitBox(c.x, c.y, c.z, sz.x, sz.y, sz.z, 'room:hit:' + pg.it.id);
        const g: Good = { it: pg.it, b: pg.b, box: boxes[i], hit: hb, tag, range: ranges[i], inter: null as unknown as Interactable };
        g.inter = this.interact({
          id: `room:good:${pg.b}:${pg.it.id}:${i}`, label: this.goodLabel(pg.it, pg.b), icon: '🛒', hit, reach: 4.5, proximity: false,
          use: () => { const of = offerOf(g.it, g.b, this.priceEnv()); this.openGood(g, (of.kind === 'coins' || of.kind === 'mat') && !of.why); },
          alt: { label: 'Осмотреть', use: () => this.openGood(g, false) },
          // the room outlines the good itself (setHot: follows the aim, stays on the good of an open card)
          highlight: () => { /* drawn by setHot */ },
        } as Interactable);
        this.goods.push(g);
      });
      this.pending = []; this.pendingGoods = [];
      this.unsubs.push(this.env.store.on('hero', () => this.refreshTags()));
      // outline of the ONE aimed good (src/engine/outline.ts): an invisible carrier mesh over exactly its vertices
      if (lit) {
        const view = new THREE.BufferGeometry();
        for (const k of ['position', 'normal']) view.setAttribute(k, lit.getAttribute(k));
        view.setDrawRange(0, 0);
        const carrier = new THREE.Mesh(view, new THREE.MeshBasicMaterial({ visible: false }));
        carrier.name = 'room:highlight'; carrier.frustumCulled = false; carrier.raycast = () => { /* never hit */ };
        this.highlight = carrier; this.hiView = view;
        this.root.add(carrier); K.owned.push(view, carrier.material as THREE.Material);
      }
    }
    if (this.tags) { const m = this.tags.build(); this.root.add(m); K.owned.push(this.tags); }
    const { colliders } = K.finish();
    this.colliders = colliders;
    // ambient fill (point lights carry the warm light)
    const hemi = new THREE.HemisphereLight('#b6a8ff', '#5a3a30', this.env.quality <= 0 ? 1.6 : 1.1); hemi.name = 'room:hemi';
    this.root.add(hemi);
    const amb = new THREE.AmbientLight('#ffe2c8', 0.35); amb.name = 'room:ambient'; this.root.add(amb);
    return this.asScene();
  }

  /** Switch the highlighted good (no allocations; the tag canvas is redrawn only on change). */
  setHot(g: Good | null): void {
    if (g === this.hot) return;
    const prev = this.hot;
    this.hot = g;
    if (this.tags) {
      if (prev && prev.tag >= 0) this.tags.draw(prev.tag, this.tagSpec(prev.it, prev.b, false));
      if (g && g.tag >= 0) this.tags.draw(g.tag, this.tagSpec(g.it, g.b, true));
    }
    if (this.highlight && this.hiView) {
      if (g && g.range.count > 0) {
        this.hiView.setDrawRange(g.range.start, g.range.count);
        // bounds of this good only (the outline's screen rect), from its model box in room space
        const bb = (this.hiView.boundingBox ||= new THREE.Box3()); bb.copy(g.box);
        const bs = (this.hiView.boundingSphere ||= new THREE.Sphere()); bb.getBoundingSphere(bs);
        showOutline(this, this.highlight);
      } else { this.hiView.setDrawRange(0, 0); hideOutline(this); }
    }
  }

  private setFog(on: boolean): void {
    const S = this.env.scene; if (!S) return;
    if (on) {
      if (!this.fogSave) this.fogSave = { fog: S.fog, bg: S.background as THREE.Color | THREE.Texture | null };
      S.fog = new THREE.Fog(this.bg, this.fogNear, this.fogFar);
      S.background = new THREE.Color(this.bg);
    } else if (this.fogSave) { S.fog = this.fogSave.fog; S.background = this.fogSave.bg; this.fogSave = null; }
  }

  private asScene(): RoomScene {
    const self = this, K = this.kit;
    this.root.userData.l3dRoom = this;   // dev tools / tests
    let fogged = false;
    return {
      root: this.root,
      free: (x, z) => K.free(x, z),
      groundAt: (x, z) => K.groundAt(x, z),
      solidTop: (x, z) => K.solidTop(x, z),
      spawn: this.spawn,
      colliders: this.colliders,
      update(dt: number, t: number) {
        if (!fogged) { fogged = true; self.setFog(true); }
        const p = self.env.player();
        for (const n of self.npcs) n.update(dt, t, p.x, p.z);
        for (const f of self.updaters) f(dt, t);
        // highlight exactly the aimed good (one at a time) + light its tag up
        const tg = self.env.interact ? self.env.interact.target : null;
        let g: Good | null = null;
        if (tg && self.goods.length) for (const x of self.goods) if (x.inter === tg) { g = x; break; }
        if (self.card && self.card.opened && self.card.boundTo) {   // while a card is open, keep its good lit (bound to it)
          const id = self.card.boundTo; for (const x of self.goods) if (x.it === id) { g = x; break; }
        }
        self.setHot(g);
        // fights (src/combat): ragdolls are posed after the room animated its figures
        for (let i = 0; i < self.afterFns.length; i++) self.afterFns[i](dt, t);
      },
      dispose() { self.dispose(); },
      combat: {
        fighters(fn: (f: RoomFighter) => void) { for (let i = 0; i < self.fighters.length; i++) fn(self.fighters[i]); },
        afterUpdate(fn: (dt: number, t: number) => void) {
          self.afterFns.push(fn);
          return () => { const k = self.afterFns.indexOf(fn); if (k >= 0) self.afterFns.splice(k, 1); };
        },
        ceiling: K.shellH || 6,
        space: self.combatSpace(),
      } satisfies RoomCombat,
    } as RoomScene;
  }

  /**
   * The room as fights see it (src/combat/room.ts RoomCombat.space): the kit's floor and walls, minus the solids a
   * fighter stands in (its own NPC block, a mannequin's booth) — a body that starts inside a solid would slide through
   * it and out of the room. Decided lazily (fighters are all registered once the scene is finished).
   */
  private combatSpace(): RoomSpace {
    const K = this.kit;
    let solids: { x0: number; x1: number; z0: number; z1: number; top: number }[] | null = null;
    const list = () => solids || (solids = K.solids.filter((s) => !this.fighters.some((f) => f.home && f.home.x >= s.x0 && f.home.x <= s.x1 && f.home.z >= s.z0 && f.home.z <= s.z1)));
    return {
      free: (x, z) => K.free(x, z),
      groundAt: (x, z) => K.groundAt(x, z),
      solidTop: (x, z) => {
        const B = K.bounds, C = K.circle;
        let inExtra = false;
        for (const e of K.extra) if (x >= e.x0 && x <= e.x1 && z >= e.z0 && z <= e.z1) { inExtra = true; break; }
        if (!inExtra && (C ? (x - C.x) * (x - C.x) + (z - C.z) * (z - C.z) > C.r * C.r : x < B.x0 || x > B.x1 || z < B.z0 || z > B.z1)) return Infinity;
        let top = -Infinity;
        const S = list();
        for (let i = 0; i < S.length; i++) { const s = S[i]; if (x >= s.x0 && x <= s.x1 && z >= s.z0 && z <= s.z1 && s.top > top) top = s.top; }
        return top;
      },
    };
  }

  dispose(): void {
    hideOutline(this);
    this.setFog(false);
    for (const u of this.unsubs) { try { u(); } catch { /* ignore */ } }
    this.unsubs.length = 0;
    if (this.card) { this.card.dispose(); this.card = null; }
    for (const f of this.disposers) { try { f(); } catch { /* ignore */ } }
    this.disposers.length = 0;
    this.afterFns.length = 0;
    for (const n of this.npcs) n.dispose();
    this.kit.dispose();
    this.root.removeFromParent();
  }
}
