/**
 * Extensibility contracts (v2). The site updates several times a day, so everything that mirrors site content
 * (buildings, rooms, items, menus, quest phases, mechanics) is a REGISTRY ENTRY or a FEATURE, never a hard-coded
 * branch inside the game loop. Adding a new building / room / item kind / mechanic = one new file + one line in
 * the matching index. Unknown ids coming from the site always get a generic fallback and are reported once
 * (console + `l3d:drift` event + `npm run drift` script).
 */
import type * as THREE from 'three';
import type { Store, Actions, CityLayout, Building, Item, Unsub, QualityLevel, Appearance } from './index';
import type { Engine, Input, SiteSession, CameraRig } from './modules';

/* ============================================================ generic registry */

export interface Registry<T> {
  readonly name: string;
  /** Add or replace an entry. Returns an unregister function. */
  register(id: string, def: T): Unsub;
  get(id: string): T | undefined;
  /** get() or the registered fallback ('*'); reports unknown ids once (drift). */
  resolve(id: string): T;
  has(id: string): boolean;
  ids(): string[];
  /** Subscribe to changes (entries added/replaced/removed). */
  onChange(fn: () => void): Unsub;
}

/* ============================================================ interactables (look-at + E) */

/** Something the player can use: a door, a shelf item, a stone in the mine, an NPC, a chest. */
export interface Interactable {
  id: string;
  /** Prompt label, e.g. «Войти: Кузня», «Купить: Коготок — 4 серебра». */
  label: string;
  icon?: string;
  /** Hit volume for the crosshair raycast (world space). Use a cheap invisible mesh or a Box3. */
  hit: THREE.Object3D | THREE.Box3;
  /** Max use distance (m) from the camera (crosshair) and from the feet (E proximity). Defaults 3.0 / 2.2. */
  reach?: number;
  /** If false the item is only usable by crosshair aim (not by E proximity). Default true. */
  proximity?: boolean;
  /** Called on E (aimed or nearby). Mouse clicks never call it (the 'click' value is kept for compatibility). */
  use(how: 'key' | 'click'): void;
  /** Optional secondary action (F), e.g. «Осмотреть». */
  alt?: { label: string; use(): void };
  enabled?: () => boolean;
  /** Draw your own highlight while targeted (then the generic silhouette outline is skipped). Exactly one target is highlighted at a time. */
  highlight?(on: boolean): void;
  /** Region of the fitted outline proxy for Box3 / invisible hit volumes (e.g. only the doorway). */
  highlightBox?: THREE.Box3;
  /** Meshes to outline instead of the hit object (e.g. the real door leaf cut out of merged city geometry). */
  outline?: THREE.Object3D | THREE.Object3D[] | (() => THREE.Object3D | THREE.Object3D[] | null);
}
export interface InteractSystem {
  add(i: Interactable): Unsub;
  /** Current target (aimed first, else nearest proximity one). Updated each frame. */
  readonly target: Interactable | null;
}

/* ============================================================ rooms (interiors, the mine, other scenes) */

/**
 * A room is a separate 3D scene the player walks in (shop interior, forge, tent, the mine…). The room manager swaps the
 * city world out, keeps the engine/camera/player/avatars, and puts the room's walkable area in place of the city's.
 */
export interface RoomScene {
  readonly root: THREE.Object3D;
  /** Walkable floor in room-local metres: free(x,z) and ground height. The player controller uses these while inside. */
  free(x: number, z: number): boolean;
  groundAt(x: number, z: number): number;
  /** Height of a solid top at (x,z) for jumping / standing on (counters, crates); -Infinity = nothing, Infinity = wall. */
  solidTop?(x: number, z: number): number;
  /** Player spawn (metres, room-local) and facing (radians, Walker.face convention). */
  spawn: { x: number; z: number; face: number };
  /** Camera colliders (walls) for TP. */
  colliders?: THREE.Object3D[];
  update(dt: number, t: number, camera: THREE.Camera): void;
  dispose(): void;
}
export interface RoomContext extends GameContext {
  /** The building the player came from. */
  building: Building;
  /** Leave the room back to the street (door). */
  exit(): void;
  /** Show the site's own panel for this building docked over the 3D room (hybrid rooms). */
  showSitePanel(opts?: { side?: 'left' | 'right' | 'full' }): void;
  hideSitePanel(): void;
}
/** Room kinds: 'shop3d' (walk inside, pick goods), 'hybrid' (3D scene + site panel), 'site' (site's 2D room as before), 'mine3d'. */
export interface RoomDef {
  /** Build the scene (async: may fetch stock). */
  create(ctx: RoomContext): Promise<RoomScene>;
  /** Short title for the loading veil. */
  title?: string;
}
export interface RoomManager {
  readonly current: string | null;   // building id or null on the street
  enter(buildingId: string): Promise<void>;
  exit(): void;
}

/* ============================================================ content registries */

/** How a site building is represented. Unknown ids → registry fallback (generic house + 'site' room). */
export interface BuildingDef {
  /** 3D model builder for the street (world module). Absent → generic facade. */
  model?: string;              // key in world's model builders (usually = id)
  /** Which room kind opens on E. */
  room: 'shop3d' | 'hybrid' | 'site' | 'mine3d' | 'none';
  /** Room scene variant for shop3d/hybrid (e.g. 'forge', 'tent', 'plainHall'). */
  scene?: string;
  /** NPC standing inside (look/gear in site terms). */
  npc?: { name: string; look?: Record<string, unknown>; gear?: Record<string, unknown> };
}

/** 3D model for an item look (weapon/shield/armor/hat/charm/food/potion/scroll/material/relic). */
export type ItemModelFactory = (look: NonNullable<Item['look']> | Record<string, unknown>, opts: { rarity: string; slot: string; id?: string }) => THREE.Object3D;

/* ============================================================ features */

/** Everything a feature can touch. Created once per game. */
export interface GameContext {
  engine: Engine;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  rig: CameraRig;
  input: Input;
  store: Store;
  actions: Actions;
  site: SiteSession;
  layout(): CityLayout;
  quality(): QualityLevel;
  interact: InteractSystem;
  rooms: RoomManager;
  registries: {
    buildings: Registry<BuildingDef>;
    rooms: Registry<RoomDef>;
    itemModels: Registry<ItemModelFactory>;   // key: 'weapon:sword', 'shield:round', 'hat:wizard', 'armor:robe', 'slot:food', '*'
    menus: Registry<MenuTabDef>;
    keys: Registry<KeyBinding>;
  };
  ui: {
    toast(text: string, bad?: boolean): void;
    open(menu: string | null): void;
    /** Prompt line under the crosshair (null = hide). Usually driven by InteractSystem. */
    prompt(text: string | null): void;
  };
  /** Per-frame hook (after the player moved, before render). */
  onFrame(fn: (dt: number, t: number) => void): Unsub;
  /** Player feet (metres, current space: city or room) and appearance. */
  player: { readonly x: number; readonly y: number; readonly z: number; readonly app: Appearance | null };
  /** Report something the site has that we do not support yet (drift). Deduplicated. */
  drift(kind: string, id: string, detail?: unknown): void;
}

export interface Feature {
  id: string;
  /** Lower runs first. */
  order?: number;
  setup(ctx: GameContext): void | Unsub | Promise<void | Unsub>;
}

export interface MenuTabDef {
  title: string;
  group: 'character' | 'world' | 'system';
  hotkey?: string;          // KeyboardEvent.code
  orbit?: boolean;          // camera orbits the hero while open
  order?: number;
  render(el: HTMLElement, ctx: GameContext): void | Unsub;
}
export interface KeyBinding {
  code: string;             // KeyboardEvent.code
  label: string;            // for the help screen
  when?: 'gameplay' | 'always';
  run(ctx: GameContext, e: KeyboardEvent): boolean | void;
}

/* ============================================================ world additions (v2) */

/** Extra World3D capabilities used by jumping and interactions (implemented by src/world). */
export interface World3DExt {
  /**
   * Solid top under a 2D city point (px): the height (m) of what you could stand on there — bench seat, fence top,
   * planter rim, crate — or -Infinity when only ground is there, or Infinity for things you cannot jump over/onto
   * (walls, buildings, lamps, water, the ledge face). Fast analytic lookup (no raycast), no allocations.
   */
  solidTop(x: number, y: number): number;
  /** Interactables the world provides (doors with 3D hit volumes). */
  interactables(): Interactable[];
  /** Top-down map image of the city (orthographic render), generated once and cached. */
  mapImage?(renderer: THREE.WebGLRenderer, opts?: { pxPerMetre?: number }): Promise<{ url: string; width: number; height: number; x0: number; z0: number; x1: number; z1: number }>;
}
