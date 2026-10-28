/**
 * CoreContext: the GameContext (public contract, src/contracts/ext.ts) plus the game's own services that the
 * built-in features in src/features/* share. Third-party features should only rely on GameContext.
 */
import type * as THREE from 'three';
import type { CameraMode, World3D, Walker, Unsub } from '../contracts';
import type { GameContext, RoomScene } from '../contracts/ext';
import type { Avatar, AvatarKit, UiHost } from '../contracts/modules';
import type { CameraRigEx, PlayerControllerEx } from '../engine';
import type { LabelsEx, ViewModelEx } from '../avatar';
import type { GameUi } from '../ui';
import type { InteractSystemEx } from './interact';
import type { RoomManagerEx } from './rooms';
import type { Registries } from './registries';

/** Mutable game state shared by core and features. */
export interface GameState {
  /** Chosen camera mode (FP/TP); the rig may be in 'orbit' while a menu is open. */
  mode: CameraMode;
  /** Open UI menu id or null. */
  menu: string | null;
  /** The open menu wants the orbit camera (UI 'l3d:menu' detail.orbit). */
  menuOrbit: boolean;
  /** Site overlay kind (site.overlay()) as last seen by the overlay watcher. */
  overlay: string | null;
  /** True when the site overlay is shown OVER our live canvas (hybrid room panel), not instead of it. */
  overlayOver3d: boolean;
  /** Classic site shown (game paused, hidden). */
  classic: boolean;
  /** A 3D room is active (city world, crowd and labels are hidden). */
  inRoom: boolean;
  /** A room tool is in the paws (the mine's pickaxe while digging): the own weapon / shield view-model is hidden. */
  toolInHand?: boolean;
  /** Expedition-only game (hero in an expedition party, the site's City locked): no city world, src/net/expedition-site.ts. */
  expeditionOnly?: boolean;
}

export interface Game {
  classic: boolean; toClassic(): void; resume(): void; classicPanel(): void;
  /** Tear the whole game down (engine, UI, features, site session). Set by startGame. */
  dispose?(): void;
}

export interface CoreContext extends GameContext {
  registries: Registries;
  interact: InteractSystemEx;
  rooms: RoomManagerEx;
  rig: CameraRigEx;
  state: GameState;
  /** Page elements: canvas host and UI root. */
  hostEl: HTMLElement;
  uiRoot: HTMLElement;
  ui: GameContext['ui'];
  uiApi: GameUi;
  uiHost: UiHost & Record<string, unknown>;
  /** The current city world (replaced on layout change, see onWorld). */
  world(): World3D;
  onWorld(fn: (w: World3D) => void): Unsub;
  /** Avatars, labels and the own character. */
  kit: AvatarKit;
  labels: LabelsEx;
  /** Label anchors by login (world metres). The own anchor is set by core; others by the crowd feature. */
  anchors: Map<string, THREE.Vector3>;
  me: Walker;
  meAv: Avatar;
  vm: ViewModelEx;
  /** The active player controller (city or room space). */
  controller(): PlayerControllerEx;
  /** Feet position of the player this frame (world metres). Read-only for features. */
  feet: THREE.Vector3;
  /** Gameplay is live (no menu, no blocking overlay, not classic). Computed by core each frame. */
  gameplay(): boolean;
  /** Re-apply the camera mode (after state.mode / state.menu change). */
  applyCamera(instant?: boolean): void;
  /** Menu changed (from the UI): orbit camera etc. Listeners run after state.menu is updated. */
  onMenu(fn: (id: string | null) => void): Unsub;
  /** Swap the walkable space: a room scene, or null to return to the city at (x, y) px facing `face`. */
  setSpace(scene: RoomScene | null, back?: { x: number; y: number; face: number }): void;
  /** Classic-site toggle (filled by the classic feature). */
  game: Game;
  /** Loading veil over the canvas (null hides). */
  veil(title: string | null): void;
  /** Dev handles merged into window.__l3dGame (dev builds). */
  dev: Record<string, unknown>;
}
