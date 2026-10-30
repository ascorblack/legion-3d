/** Shared context passed between the UI parts (HUD, chat, menus). */
import type { UiHost } from '../contracts/modules';
import type { UiSettings } from './settings';
import type { GameContext } from '../contracts/ext';
import type { TabRegistry } from './tabs';
import type { MapSource } from './map';
import { setHtml } from '../core/html';

export interface Ctx {
  host: UiHost;
  shadow: ShadowRoot;
  /** .ui root element inside the shadow root. */
  ui: HTMLElement;
  settings: UiSettings;
  toast(text: string, bad?: boolean): void;
  /** Currently open menu id or null. */
  opened(): string | null;
  open(menu: string | null): void;
  /** Current UI scale (auto × settings.uiScale); DOM rects must be divided by it for positioning inside .ui. */
  scale: number;
  /** Apply settings.uiScale to the root. */
  applyScale(): void;
  /** Is the chat input focused. */
  typing(): boolean;
  /** Menu tab registry (built-in + feature tabs). */
  tabs: TabRegistry;
  /** Map base picture shared by the Карта tab and the minimap. */
  map: MapSource;
  /** GameContext handed to feature tabs' render() (set by main via ui.setGameContext). */
  game(): GameContext | null;
}

export const h = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, html?: string): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html != null) setHtml(e, html);
  return e;
};

/** Extra host methods main.ts provides beyond the contract (optional). */
export interface HostExtras {
  yaw?(): number;
  menuChanged?(id: string | null): void;
  /** Set false to disable "pointer lock lost in play → open Pause menu". */
  pauseOnUnlock?: boolean;
  /** Player position in px (2D city) if `store.me` is not maintained. */
  pos?(): [number, number] | null;
  /** Top-down render of the current city for the map (world.mapImage(renderer)); metres. Absent → vector plan. */
  mapImage?(): Promise<{ url: string; width: number; height: number; x0: number; z0: number; x1: number; z1: number }>;
  /** Auto-walk the player to a city point (px) — player.walkTo. Absent → the map has no «Идти сюда». */
  walkTo?(x: number, y: number): void;
}
export const extras = (host: UiHost) => host as UiHost & HostExtras;
