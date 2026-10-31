/**
 * The single chat window of the page (site 30.10, flag «chatone», window.LGChatOne of /lib/site-chatone.js) in the 3D game.
 *
 * What the site does: ONE chat window instead of the City's and the mine's — tabs «Город», «Торговля», «Достижения», «Шахта»,
 * «Личные» (LGDm). It lives outside the scenes: a scene hands over its place (`LGChatOne.dock(key, sceneRoot)`) and the window
 * takes the place of that scene's own `.cy-chat`; outside scenes it sits bottom-left (`.co-float`). Its feeds are the site's own:
 * POST /api/chat/watch once a minute while expanded, SSE «city» / «mine» (app.js → onFeed) or /api/chat/feed, /api/chat/count
 * while folded. Sending, moderation, mutes, the nick menu, DMs and friends are the site's code.
 *
 * What we do (everything else is src/ui/chat.ts docking the window like the City chat before):
 *  - the City: the site's City is entered under our 3D and docks the window into its slot (`#tab-city .cy-chat`) — nothing to do;
 *  - the mine: the site's mine is NOT running (our own client, src/rooms/mine), so nobody docks 'mine' — we do: a full-screen
 *    host (`.l3d-co-host`, the site's resize limits are its rect) takes the window while the mine room is up, the window opens on
 *    «Шахта», the mine's chat state of enter goes in through `enterFeed('mine', …)`, and we stop polling `mc=` ourselves
 *    (the window's own feed does it). Leaving the mine un-docks 'mine' again: the window goes back to the City's slot.
 *  - we never send: no /api/chat/say, no /api/mine/chat/say from here.
 * An old site / a hero without the flag has no LGChatOne (or `on()` is false): the old path stays (src/ui/chat.ts mine tab).
 */

/** What we use of window.LGChatOne (all methods optional on an unexpected build: checked before use). */
export interface ChatOneApi {
  on(): boolean;
  dock(key: 'city' | 'mine', root: Element | null): void;
  place?(): void;
  enterFeed?(room: 'city' | 'mine', r: unknown): void;
  state?(): { tab?: string; open?: boolean } | null;
  size?(): void;
}
type W = Window & typeof globalThis & { LGChatOne?: ChatOneApi };

/** window.LGChatOne when the single chat is on for this hero (LGChatOne.on()), else null. */
export const chatOneApi = (w: W = (typeof window !== 'undefined' ? window : ({} as W)) as W): ChatOneApi | null => {
  const o = w.LGChatOne;
  try { return o && typeof o.on === 'function' && typeof o.dock === 'function' && o.on() ? o : null; } catch { return null; }
};
/** The single chat window is on (site flag «chatone» for the hero and the window is running). */
export const chatOneOn = (w?: W): boolean => !!chatOneApi(w);

/** Selector of the single chat's box wherever it stands: in a scene's slot, in our mine host, or the site's own float. */
export const CO_BOX_SEL = '#tab-city .cy-chat, .l3d-co-host .cy-chat, .co-float .cy-chat';
export const CO_HOST_CLASS = 'l3d-co-host';

let quiet = 0;
/** True while we move the single window about: the site focuses its field on a tab switch — that is not the player typing. */
export const isQuiet = (): boolean => quiet > 0;
/**
 * Run `fn` (docking the single window moves it and may switch its tab; the site's tab switch focuses the field): if that put the focus
 * into the chat box and it was not there before, take it away again — gameplay keeps running, the chat dock does not see «typing».
 */
export function withoutFocus<T>(doc: Document, fn: () => T): T {
  const before = doc.activeElement;
  quiet++;
  try { return fn(); } finally {
    quiet--;
    const a = doc.activeElement as HTMLElement | null;
    if (a && a !== before && a.closest?.('.cy-chat') && !before?.closest?.('.cy-chat')) a.blur();
  }
}

/** The mine room's chat as the single window needs it (the shape of `r.mchat` of the mine's enter). */
export interface OneMineSrc {
  lines(): readonly { id: string }[];
  /** Chat counter (`mchat.c`) of the mine's feed. */
  c?(): number;
  /** `mchat.mod` / `mchat.muted` of the enter. */
  state?(): { mod?: unknown; muted?: unknown } | null | undefined;
}

/** `r.mchat` of the mine's enter, as LGChatOne.enterFeed('mine', …) takes it (the window tags the lines itself: id «m:…», rm 'mine'). */
export function minePayload(src: OneMineSrc): { chat: unknown[]; c?: number; mod?: unknown; muted?: unknown } {
  const st = (src.state && src.state()) || null;
  const c = src.c ? +src.c() : NaN;
  return {
    chat: src.lines().map((l) => ({ ...l })),
    ...(Number.isFinite(c) && c > 0 ? { c } : {}),
    ...(st && st.mod != null ? { mod: st.mod } : {}), ...(st && st.muted != null ? { muted: st.muted } : {}),
  };
}

type DockFn = ChatOneApi['dock'];
/**
 * Run the site's dock('city', root) without letting the City take the window: its place() keeps the LAST docked scene
 * whose root is shown, and switches the tab when that scene changes («Шахта» → «Город», focusing the field). The City's
 * root is hidden for that one synchronous call (no layout, no paint in between) so place() still picks our mine host,
 * then the mine is docked again so it is the last one for every later place() of the site.
 */
export function dockCityUnder(orig: DockFn, api: ChatOneApi, root: Element, host: Element): void {
  const el = root as HTMLElement, st = el.style;
  const prev = st ? st.getPropertyValue('display') : '', pri = st ? st.getPropertyPriority('display') : '';
  try { st?.setProperty('display', 'none', 'important'); orig.call(api, 'city', root); }
  finally { if (st) { if (prev) st.setProperty('display', prev, pri); else st.removeProperty('display'); } }
  orig.call(api, 'mine', host);
}

/**
 * The mine room's hold on the single chat window: host, enter feed, docking. While it holds, the site's own
 * dock('city', …) calls (its City runs under our 3D and re-docks after every «me»: heroChanged → chatInit) are routed
 * through dockCityUnder — one owner of the tab (the 3D scene, on a real scene change only), no «Город» ⇄ «Шахта» fight
 * and no focus thrown into the chat field. A tab the player picked stays.
 */
export class OneMine {
  private host: HTMLElement | null = null;
  private orig: DockFn | null = null;
  private wrapped: DockFn | null = null;
  constructor(private api: ChatOneApi, private src: OneMineSrc, private doc: Document, private css: () => void) {}

  /** The site's dock, unwrapped. */
  private dock(k: 'city' | 'mine', root: Element | null): void { (this.orig || this.api.dock).call(this.api, k, root); }

  private hook(): void {
    if (this.wrapped) return;
    const api = this.api, orig = api.dock;
    const w: DockFn = (k, root) => {
      const host = this.host;
      if (host && k === 'city' && root) { withoutFocus(this.doc, () => dockCityUnder(orig, api, root, host)); return; }
      orig.call(api, k, root);
    };
    try { api.dock = w; this.orig = orig; this.wrapped = w; } catch { /* a frozen object: the tick re-docks as before */ }
  }
  private unhook(): void {
    if (this.wrapped && this.api.dock === this.wrapped && this.orig) { try { this.api.dock = this.orig; } catch { /* */ } }
    this.wrapped = null; this.orig = null;
  }

  start(): void {
    if (this.host) return;
    this.css();
    const host = this.host = this.doc.createElement('div');
    host.className = CO_HOST_CLASS;
    // the window can be dragged up to this far from the top (the site's resize limit: data-chat-top): the HUD's top-left corner stays free
    host.dataset.chatTop = '120';
    this.doc.body.appendChild(host);
    try { this.api.enterFeed?.('mine', minePayload(this.src)); } catch (e) { console.warn('[legion-3d] chatone enterFeed', e); }
    this.hook();
    withoutFocus(this.doc, () => this.dock('mine', host));
  }

  /** Twice a second (Chat.update): the City docked again (the site re-entered it) → the window must stay in the mine's host. */
  tick(): void {
    const host = this.host; if (!host || !this.api.on()) return;
    const box = this.doc.querySelector<HTMLElement>('.cy-chat[data-co-bound]');
    if (box && box.parentNode !== host) withoutFocus(this.doc, () => this.dock('mine', host));
  }

  stop(): void {
    const host = this.host; if (!host) return;
    this.host = null;
    const orig = this.orig;
    this.unhook();
    try { withoutFocus(this.doc, () => (orig || this.api.dock).call(this.api, 'mine', null)); } catch (e) { console.warn('[legion-3d] chatone undock', e); }
    // the window moved back (City slot / float) in dock(null); anything the site left in the host goes with it
    host.remove();
  }
}
