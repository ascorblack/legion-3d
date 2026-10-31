/**
 * Shared contracts between modules. Types only — no runtime code here.
 * Any change to this file must be announced to every module owner (see AGENTS.md).
 *
 * 2D city space ("px"): x = horizontal, y = depth (bigger y = closer to the viewer of the 2D site).
 * 3D world space ("m"): X right, Y up, Z towards the viewer. Conversion: src/world/coords.ts.
 */
import type * as THREE from 'three';

/* ------------------------------------------------------------------ appearance */

export type Rarity = 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary';
/** Site art style of the channel: decides species details (cats get ears/tail/whiskers, monkeys ears/tail, …). */
export type StyleId = 'legion' | 'cats' | 'monkeys' | 'ugabugi' | string;

/** Cosmetic look (site: hero.wardrobe.cur / hero.look / walker.lk). Every field optional; resolve defaults via MDDoodle.defaultsFor. */
export interface Look {
  shape?: 'bean' | 'box' | 'ball' | 'tall' | 'ghost' | 'cone' | 'egg' | string;
  color?: string;      // '#rrggbb' or 'hsl(...)'
  color2?: string;
  eyes?: 'dots' | 'big' | 'happy' | 'cyclops' | 'stars' | string;
  mouth?: 'open' | 'grin' | 'tongue' | string;
  blush?: boolean;
  hat?: string;        // 'none' | 'tuft' | 'cap' | 'bow' | 'horns' | 'crown' | 'tophat' | 'party' | 'wizard' | 'antenna' | 'legion' | 'laurel' | 'beret' | 'headphones' | 'cowboy' | 'chef' | …
  acc?: string[];      // 'bowtie' | 'tie' | 'scarf' | 'glasses' | 'shades' | 'monocle' | 'mustache' | 'cape' | 'pioneer' | …
  accColor?: string;
  capeColor?: string;
  aura?: string;       // 'gold' | 'sparks' | 'halo' | 'shadow' | 'frost' | …
}

/** Worn gear summary (site: hero.gear / walker.g). */
export interface Gear {
  w?: string; wr?: Rarity;   // weapon kind: sword gladius dagger axe club mace hammer spear pitchfork bow staff crook censer kris skullstaff grimoire holymace
  s?: string; sr?: Rarity;   // shield kind: scutum round buckler barrel
  a?: string; ar?: Rarity;   // armor kind: lorica robe leather shroud plate
  am?: 'heavy' | 'light' | 'cloth';
  h?: string; hr?: Rarity;   // helmet = hat id (class hats too, e.g. 'miner', 'nhood')
  t?: string; tr?: Rarity;   // trinket: aura id or 'plain'
}

/** Everything needed to build a character model. Fully resolved (defaults already applied). */
export interface Appearance {
  login: string;        // lower-case, stable id
  name: string;         // display name
  level?: number;
  styleId: StyleId;
  look: Look;
  gear: Gear;
  ghost?: boolean;      // dead hero: translucent
  role?: string;        // class id (legionary, archer, mage, priest, rogue, necromancer, paladin, recruit…)
  badges?: { icon: string; name: string }[];
}

/* ------------------------------------------------------------------ hero (own character) */

export type Slot = 'weapon' | 'armor' | 'shield' | 'helmet' | 'trinket' | 'potion' | 'food' | 'scroll' | 'relic' | 'material';

export interface Item {
  uid: string; id: string; name: string; baseName?: string;
  slot: Slot | string; rarity: Rarity;
  stats: Record<string, number>; stats0?: Record<string, number>;
  role?: string; gear?: string;
  look?: { weapon?: string; armor?: string; shield?: string; hat?: string; charm?: string } | null;
  effect?: Record<string, unknown> | null;
  on?: boolean; wearable?: boolean; drink?: boolean; relic?: boolean; boss?: boolean;
  en?: number;          // enchant level
  dur?: number; durMax?: number;
  v?: number;           // sell value
  [k: string]: unknown;
}

/** Subset of /api/me .hero that the game uses. Unknown fields are kept (index signature). */
export interface Hero {
  login: string; name: string; level: number;
  xp: number; next: number; prevXp: number; xpInLevel?: number; xpToNext?: number;
  money: number;        // bronze coins (1 silver = 100? see site LGSiteUi.money)
  hpNow: number;
  stats: { hp: number; atk: number; mag: number; def: number; [k: string]: number };
  xs?: Record<string, number>;
  role: string; roleName?: string;
  ghost?: boolean; deadUntil?: number | null;
  items: Item[];
  gear: Gear; look: Look;
  wardrobe?: { cur?: Look; own?: Record<string, unknown> };
  soc?: { score: number; rank: string; rankName: string; icon: string; place: number; total: number; bad?: boolean };
  sk?: unknown; ac?: unknown; mn?: Record<string, unknown>;
  busy?: boolean;
  /** «Ночь Тыквенной Луны» (site 28.10, city.js hwNow): the City's Halloween look / the portal at the gate (src/events/halloween/hwcity.ts). */
  hwc?: { look?: boolean; portal?: boolean; at?: number } | null;
  [k: string]: unknown;
}

/* ------------------------------------------------------------------ city */

export type Obstacle =
  | { e: [number, number, number, number]; water?: boolean }   // ellipse cx, cy, rx, ry
  | { b: [number, number, number, number]; water?: boolean }   // box x0, y0, x1, y1
  | { r: [number, number, number] };                          // x0, x1, y1: from the top of the scene down to y1 (stalls)

export interface Building {
  id: string;           // hall auction trainer board mine mineboard storage anvil forge gate tent shop magic …
  title: string; sub?: string; icon?: string;
  hit: [number, number, number, number];   // x0, x1, y0 (top of the art), y1 (bottom of the art)
  door: { x: number; y: number };          // walkable point in front of the entrance
  soon?: boolean; fair?: boolean; mine?: boolean; magic?: boolean;
  /** «Тюрьма и клетка» (site 30.10, citymap.js BUILDINGS jail): you cannot enter it — E opens the site's Jail window. */
  jail?: boolean;
}

/** The jail on the lower street (site citymap.js LOW.jail, 30.10): building x0…x1 down to `base`, cage c0…c1 from the
 *  retaining wall to the bar line `fy`, the cage door opening `door` (x0, x1) in the bars, 8 seats [x, y] for prisoners. */
export interface JailGeo {
  x0: number; x1: number; base: number;
  c0: number; c1: number; fy: number;
  door: [number, number];
  seats: [number, number][];
}

/** Lower street of the fair city (LGCityMap.LOW). */
export interface LowerStreet {
  top: number; edge: [number, number]; stairs: [number, number][];
  canal: [number, number]; bridges: [number, number][];
  benches?: [number, number][]; beds?: [number, number][]; decor?: [number, number][];
  lamps?: [number, number][]; statue?: [number, number];
  storage?: { x0: number; x1: number; base: number }; mine?: { x0: number; x1: number; base: number };
  jail?: JailGeo;
  [k: string]: unknown;
}

export interface CityLayout {
  id: string;           // 'fair' or district town id
  styleId: StyleId;
  W: number; H: number; QW: number;
  area: { x0: number; x1: number; y0: number; y1: number };
  obstacles: Obstacle[];
  buildings: Building[];
  low?: LowerStreet;
  /** Sky CSS gradient of the style, e.g. 'linear-gradient(#0f0d2a 0%, …)'. */
  sky?: string;
  /** Optional raw SVG art from the site (facade textures). Absent in tests. */
  art?: { quarterSvg?: string; fairSvg?: string; lowerSvg?: string; fairX?: number };
  /** Walkability from the site's walk grid (px). */
  free(x: number, y: number): boolean;
  nearest(x: number, y: number): [number, number];
  /** A* path on the walk grid (site LGCityMap path), first point = a. Optional (absent in some fixtures). */
  path?(a: [number, number], b: [number, number]): [number, number][];
}

/** What buildCity() returns (src/world). */
export interface World3D {
  root: THREE.Object3D;
  /** Ground height (m) under a 2D point; used for the player and every avatar. */
  groundAt(x: number, y: number): number;
  /** Entrances to show prompts for: 3D position of each door. */
  doors: { id: string; title: string; icon?: string; pos: THREE.Vector3; soon?: boolean }[];
  /** Spawn hint (px). */
  spawn: [number, number];
  /** Per-frame update (animated water, flags, lamp flicker…). Must not allocate. */
  update(dt: number, t: number, camera: THREE.Camera): void;
  setQuality(q: QualityLevel): void;
  dispose(): void;
}

/* ------------------------------------------------------------------ live state */

export interface ChatMsg {
  id: string; login: string; name: string; text: string; at: number;
  kind?: 'g' | 'tr' | 'dm' | 'ev' | 'sys'; role?: string; roleName?: string; to?: string; /** chat role own / mod (site m.r) */ r?: string;
}

/** A character in the world (other players and me). Positions in px (2D city space). */
export interface Walker {
  login: string;
  app: Appearance;
  x: number; y: number;
  /** Facing angle in 3D, radians around +Y (0 = looking towards -Z). */
  face: number;
  /** Current ground speed px/s (0 = idle) — drives walk animation. */
  speed: number;
  /** Last chat line to show over the head. */
  bubble?: { text: string; until: number; id: string };
  /** 0..1 fade-in alpha. */
  alpha: number;
  me?: boolean;
}

export type QualityLevel = 0 | 1 | 2 | 3;   // 0 potato, 1 low, 2 medium, 3 high

export type CameraMode = 'fp' | 'tp' | 'orbit';

export type Unsub = () => void;

/** Game state (src/store). Read synchronously; subscribe for changes. */
export interface Store {
  readonly hero: Hero | null;
  readonly me: Walker | null;
  readonly walkers: ReadonlyMap<string, Walker>;   // others, by login
  readonly chat: readonly ChatMsg[];
  readonly online: number;
  readonly quest: QuestView | null;
  readonly layout: CityLayout | null;
  on(ev: 'hero' | 'walkers' | 'chat' | 'quest' | 'layout' | 'online', fn: () => void): Unsub;
}

/** Raw quest view from the SSE event `q` (site src/site/questlive.ts). Shape is partially known — see src/quest/README. */
export interface QuestView { on: boolean; dl?: number; now?: number; [k: string]: unknown }

/** Actions the UI may call (implemented in src/net). All return the site's JSON ({ ok, error?, hero? }). */
export interface Actions {
  equip(uid: string): Promise<ApiResult>;
  unequip(slot: string): Promise<ApiResult>;
  use(uid: string): Promise<ApiResult>;
  wear(field: string, value: unknown): Promise<ApiResult>;
  say(text: string, opts?: { k?: 'tr'; to?: string }): Promise<ApiResult>;
  get<T = any>(path: string): Promise<T>;   // GET /api/... relative to the channel
  post<T = any>(path: string, body: unknown): Promise<T>;
  /** Open a site building interior (shop, forge, tent, trainer, board, mine…). */
  openBuilding(id: string): void;
  /** Show an original site tab ('hero' | 'legion' | 'news' | 'world' | 'quest') inside the game's "classic panel". */
  openSitePanel(tab: string): void;
}
export interface ApiResult { ok: boolean; error?: string; hero?: Hero; [k: string]: unknown }

/** Game-wide events bus between engine, UI and main. */
export interface GameEvents {
  'menu:open': { id: string };
  'menu:close': { id: string };
  'camera:mode': { mode: CameraMode };
  'chat:focus': {};
  'toast': { text: string; bad?: boolean };
}
