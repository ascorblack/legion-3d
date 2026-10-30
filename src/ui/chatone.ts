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

/** The mine room's hold on the single chat window: host, enter feed, docking (re-asserted when the site docks the City again). */
export class OneMine {
  private host: HTMLElement | null = null;
  constructor(private api: ChatOneApi, private src: OneMineSrc, private doc: Document, private css: () => void) {}

  start(): void {
    if (this.host) return;
    this.css();
    const host = this.host = this.doc.createElement('div');
    host.className = CO_HOST_CLASS;
    // the window can be dragged up to this far from the top (the site's resize limit: data-chat-top): the HUD's top-left corner stays free
    host.dataset.chatTop = '120';
    this.doc.body.appendChild(host);
    try { this.api.enterFeed?.('mine', minePayload(this.src)); } catch (e) { console.warn('[legion-3d] chatone enterFeed', e); }
    withoutFocus(this.doc, () => this.api.dock('mine', host));
  }

  /** Twice a second (Chat.update): the City docked again (the site re-entered it) → the window must stay in the mine's host. */
  tick(): void {
    const host = this.host; if (!host || !this.api.on()) return;
    const box = this.doc.querySelector<HTMLElement>('.cy-chat[data-co-bound]');
    if (box && box.parentNode !== host) withoutFocus(this.doc, () => this.api.dock('mine', host));
  }

  stop(): void {
    const host = this.host; if (!host) return;
    this.host = null;
    try { withoutFocus(this.doc, () => this.api.dock('mine', null)); } catch (e) { console.warn('[legion-3d] chatone undock', e); }
    // the window moved back (City slot / float) in dock(null); anything the site left in the host goes with it
    host.remove();
  }
}
