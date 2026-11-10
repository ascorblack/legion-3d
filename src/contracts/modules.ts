/**
 * Module APIs (who provides what). Types only. Owners implement these exactly; src/content/main.ts wires them.
 * Changing a signature here = tell the leader first.
 */
import type * as THREE from 'three';
import type {
  Appearance, CityLayout, World3D, QualityLevel, CameraMode, Store, Actions, Walker, Unsub, ChatMsg, Hero,
} from './index';

/* ============================================================ engine (src/engine) */

export interface Engine {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  /** Element that holds the canvas (position:fixed full-window). UI overlays are siblings above it. */
  readonly host: HTMLElement;
  readonly quality: QualityLevel;
  setQuality(q: QualityLevel | 'auto'): void;
  onQuality(fn: (q: QualityLevel) => void): Unsub;
  /** Per-frame callbacks, in registration order. dt is clamped to ≤ 0.1 s. */
  onFrame(fn: (dt: number, t: number) => void): Unsub;
  /** Smoothed frame stats for the debug overlay. */
  stats(): { fps: number; ms: number; calls: number; tris: number; scale: number };
  pause(on: boolean): void;      // stop rendering (classic site shown, tab hidden)
  dispose(): void;
}
export type CreateEngine = (opts: { host: HTMLElement; quality?: QualityLevel | 'auto' }) => Engine;

/** Keyboard/mouse. Game keys are ignored while an <input>/<textarea> is focused or a menu captured input. */
export interface Input {
  /** Movement axes in [-1, 1]: x = strafe (D +), y = forward (W +). */
  readonly move: { x: number; y: number };
  readonly run: boolean;
  /** Accumulated mouse delta since last consume (px). */
  consumeLook(): { dx: number; dy: number };
  consumeWheel(): number;
  /** Fires on key press (KeyboardEvent.code, e.g. 'KeyE', 'Tab', 'Escape', 'Enter', 'KeyV'). Return true to swallow. */
  onKey(fn: (code: string, e: KeyboardEvent) => boolean | void): Unsub;
  /** Pointer lock for mouse look. */
  lock(): void; unlock(): void; readonly locked: boolean;
  /** When false (menu open, chat typing) movement/look keys read as zero and onKey only gets 'Escape'/'Enter'. */
  setGameplay(on: boolean): void; readonly gameplay: boolean;
  dispose(): void;
}

export interface CameraRig {
  mode: CameraMode;
  /** Yaw/pitch of the view (radians). Yaw 0 looks to -Z (towards the building facades). */
  yaw: number; pitch: number;
  setMode(m: CameraMode, opts?: { instant?: boolean }): void;
  /** Target to follow: feet position (m) and eye height (m). */
  follow(feet: THREE.Vector3, eye: number): void;
  /** Called each frame after the player moved. Handles smooth transitions, TP collision with world (raycast against `colliders`). */
  update(dt: number): void;
  setColliders(objs: THREE.Object3D[]): void;
  /** Orbit mode: auto-rotate + drag; framing offset so the character stands left/right of the menu panel. */
  setOrbitFraming(opts: { side: 'left' | 'right' | 'center'; distance?: number }): void;
}

/** Local player movement on the walk grid (px space), with collision via layout.free(). */
export interface PlayerController {
  readonly x: number; readonly y: number;   // px
  readonly speed: number;                   // px/s current
  readonly face: number;                    // radians (same convention as Walker.face)
  teleport(x: number, y: number): void;
  /** Integrate input for dt using camera yaw. Returns true if moved. */
  update(dt: number, input: Input, yaw: number): boolean;
  /** Auto-walk to a px point along LGCityMap path (click-to-walk / "go to building"). */
  walkTo(x: number, y: number): void;
}

/* ============================================================ world (src/world) */

/** Raster art for facades, taken from the site's own 2D SVG drawings at runtime (or from dev fixtures). Optional. */
export interface ArtProvider {
  /** Returns a canvas/bitmap of the 2D scene region [x0..x1]×[y0..y1] (px, city coords) at `pxPerUnit` resolution, or null. */
  region(x0: number, y0: number, x1: number, y1: number, pxPerUnit: number): Promise<CanvasImageSource | null>;
}
export type BuildCity = (layout: CityLayout, opts: { quality: QualityLevel; art?: ArtProvider; renderer: THREE.WebGLRenderer }) => Promise<World3D>;

/* ============================================================ avatars (src/avatar) */

export interface Avatar {
  readonly root: THREE.Object3D;
  /** Height of the head top in local units (m) — anchor for nameplate/bubble. */
  readonly headTop: number;
  setAppearance(app: Appearance): void;
  /** speed01: 0 idle … 1 walk … 1.6 run. Must not allocate. */
  update(dt: number, t: number, speed01: number): void;
  setAlpha(a: number): void;
  /** 0 full, 1 simplified, 2 impostor/very low. */
  setLod(l: 0 | 1 | 2): void;
  /** Hide head/hat for first person (body stays for shadows) — used for "me" in FP. */
  setFirstPerson(on: boolean): void;
  /** Short emote animation: 'wave' | 'cheer' | 'equip'. */
  play(anim: string): void;
  dispose(): void;
}
export interface ViewModel {
  /** Add to the camera: arms/paws + held weapon/shield in first person. */
  readonly root: THREE.Object3D;
  setAppearance(app: Appearance): void;
  update(dt: number, t: number, speed01: number, lookDelta: { dx: number; dy: number }): void;
  /** Swing/use animation (LMB). */
  swing(): void;
  setVisible(on: boolean): void;
  dispose(): void;
}
export interface AvatarKit {
  create(app: Appearance): Avatar;
  viewModel(app: Appearance): ViewModel;
}

/** Nameplates + chat bubbles over heads (sprites with depth test, one canvas texture per label, cached). */
export interface Labels {
  readonly root: THREE.Object3D;
  /** Create/refresh the plate for a walker. */
  set(login: string, plate: { name: string; level?: number; me?: boolean; color?: string; badge?: string; /** guild tag «[tag]» (site 10.11 `gt`) */ tag?: string }): void;
  /** Show a chat bubble for ms (text is truncated to ~90 chars, word-wrapped). */
  bubble(login: string, text: string, ms: number): void;
  remove(login: string): void;
  /** Position labels at world anchors; hides by distance (> ~25 m plates, > ~40 m bubbles) and scales for readability. */
  update(anchors: ReadonlyMap<string, THREE.Vector3>, camera: THREE.Camera, dt: number): void;
  dispose(): void;
}

/* ============================================================ net + store (src/net, src/store) */

export interface SiteSession {
  readonly store: Store;
  readonly actions: Actions;
  /** Our own position changes (px). Throttled internally, sent through the site's city client. */
  moveTo(x: number, y: number): void;
  /** Stop sending our street position (inside our own 3D rooms). Optional for fakes. */
  pauseMoves?(on: boolean): void;
  /** Art provider backed by the site's SVG art (LGCityArt / MDDoodle). */
  art(): ArtProvider | null;
  /** Hide the site's own 2D city rendering (keep it alive for presence) or show it back (classic mode). */
  setClassic(on: boolean): void;
  /** Advance other walkers along their paths (site-identical motion). Call once per frame. Must not allocate. */
  tick(dt: number): void;
  /** Where the site placed our hero (px) — spawn point. */
  selfPos(): [number, number] | null;
  /** A site overlay is open above the game (building interior, mine, trade window…) → its kind, else null. Cheap (cached ~4 Hz). */
  overlay(): string | null;
  /** Close the open site overlay (building interior) if possible. */
  closeOverlay(): void;
  dispose(): void;
}
export type ConnectSite = () => Promise<SiteSession | { error: 'no_login' | 'no_hero' | 'city_locked' | 'site_changed' | 'quest_running'; loginUrl?: string }>;

/* ============================================================ UI (src/ui, src/quest) */

export interface UiHost {
  store: Store;
  actions: Actions;
  input: Input;
  /** Called by the UI when a fullscreen menu opens/closes, so main can switch the camera to orbit and back. */
  onMenu(fn: (open: string | null) => void): Unsub;
  setCameraMode(m: CameraMode): void;
  getCameraMode(): CameraMode;
  setQuality(q: QualityLevel | 'auto'): void;
  /** Toggle back to the original site. */
  exitToClassic(): void;
  /** Interaction target currently in front of the player (door), or null. */
  focusTarget(): { id: string; title: string; icon?: string } | null;
  stats(): { fps: number; ms: number };
}
export interface Ui {
  /** Top element (position:fixed, pointer-events managed). */
  readonly el: HTMLElement;
  open(menu: string | null): void;   // 'character' | 'bag' | 'stats' | 'skills' | 'ach' | 'journal' | 'legion' | 'news' | 'map' | 'settings' | 'pause' | 'help' | null
  readonly opened: string | null;
  toast(text: string, bad?: boolean): void;
  focusChat(): void;
  update(dt: number): void;   // cheap per-frame tick (compass, prompt)
  dispose(): void;
}
export type MountUi = (root: HTMLElement, host: UiHost) => Ui;

export interface QuestHud {
  readonly el: HTMLElement;
  dispose(): void;
}
export type MountQuestHud = (root: HTMLElement, host: { store: Store; actions: Actions; toast(t: string, bad?: boolean): void }) => QuestHud;

/* ============================================================ misc helpers referenced by several modules */
export type { Walker, ChatMsg, Hero };
