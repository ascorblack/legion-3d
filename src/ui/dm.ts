/**
 * Personal messages (site 29.10, window.LGDm of /lib/site-dm.js) in the 3D chat dock.
 *
 * The site draws the DMs itself: per-nick tabs, history (GET /api/dm?with=), the field (POST /api/dm/say) and the SSE «dm»
 * live in LGDm, and LGDm puts its element into the «Личные» tab of the City chat (`.cy-chat-dmx`) — the chat we dock, in the
 * City AND in the mine (the mine tab of the dock is ours, the City box stays under it). So the «Личные» tab of the dock is
 * the site's own UI and needs nothing here but a few controls:
 *   - outside the chat (no chat box: LGDm shows its small «✉ Личные» window bottom-left) the window gets a z-index above
 *     our UI (src/ui/styles.ts) and Enter / T focuses its field (Chat.focus → DmBridge.focusFloat);
 *   - «Написать» in the nick menu of the mine tab (ours) is LGDm.open(nick), and the mine tab steps back to «Личные»;
 *   - a new incoming DM (the unread counter of LGDm grows) → a small toast in the 3D UI; the badge on «Личные» is the site's.
 * Nothing here sends: LGDm.open / report and LGFriends.menuAct are the site's own code, called on an explicit pick.
 *
 * Pure parts (nickMenuItems, dmToast) are unit tested with a fake LGDm / LGFriends (test/dm.test.ts).
 */
import type { UiItem } from './chat-mod';

/** What we use of window.LGDm (all optional: an old site has none). */
export interface DmApi {
  open(login: string, o?: { name?: string; bg?: boolean; show?: boolean }): boolean;
  on(key: string, fn: ((why: string) => void) | null): void;
  place?(): void;
  /** LGDm.dock(key, chatRoot, dmxBox): the chat the DMs live in (null box = detach). */
  dock?(key: string, sec: Element, box: Element | null): void;
  report?(login: string, reason: string): Promise<boolean> | boolean;
  unread(): number;
  tabs?(): string[];
}
/** What we use of window.LGFriends: menuItems → [key, title, disabled?], menuAct(key, nick) is the site's action. */
export interface FriendsApi {
  open(tab?: string): void;
  menuItems?(nick: string): Array<[string, string, boolean?]>;
  menuAct?(key: string, nick: string): unknown;
}
type W = Window & typeof globalThis & { LGDm?: DmApi; LGFriends?: FriendsApi };

export const dmApi = (w: W = window as W): DmApi | null => {
  const d = w.LGDm;
  return d && typeof d.open === 'function' && typeof d.on === 'function' && typeof d.unread === 'function' ? d : null;
};
export const friendsApi = (w: W = window as W): FriendsApi | null => {
  const f = w.LGFriends;
  return f && typeof f.open === 'function' ? f : null;
};

/* ================================================================ pure */

export interface NickMenuDeps {
  /** My login (no menu for myself). */
  me: string;
  /** Личные are open for this hero (hero.cd). */
  dm: boolean;
  dmApi: DmApi | null;
  friends: FriendsApi | null;
  /** «Ответить»: «@nick » into the field. */
  reply(nick: string): void;
  /** window.prompt of the report reason (null = cancelled). */
  ask(text: string, def: string): string | null;
}

/**
 * The items of the site's nick menu (site-chat.js nickMenu) for a line of OUR mine tab, in the site's order:
 * Ответить · Написать · Пожаловаться · friends (LGFriends.menuItems; every pick is the site's LGFriends.menuAct(key, nick)).
 */
export function nickMenuItems(nick: string, name: string, d: NickMenuDeps): UiItem[] {
  const nk = String(nick || '').toLowerCase().replace(/^@/, '');
  if (!nk || nk === d.me) return [];
  const out: UiItem[] = [{ label: 'Ответить', run: () => d.reply(nk) }];
  if (d.dm && d.dmApi) {
    out.push({ label: '✉ Написать', run: () => { d.dmApi!.open(nk, { name }); } });
    if (d.dmApi.report) {
      out.push({
        label: 'Пожаловаться',
        run: () => {
          const why = d.ask(`Пожаловаться на ${name || nk}? Модераторы канала увидят последние 30 сообщений вашей переписки. Что случилось (можно пусто):`, '');
          if (why !== null) return Promise.resolve(d.dmApi!.report!(nk, why));
        },
      });
    }
  }
  const fr = d.friends;
  if (fr && typeof fr.menuItems === 'function' && typeof fr.menuAct === 'function') {
    let items: Array<[string, string, boolean?]> = [];
    try { items = fr.menuItems(nk) || []; } catch { items = []; }
    for (const [key, label] of items) out.push({ label, bad: key === 'fr-blk', run: () => { fr.menuAct!(key, nk); } });
  }
  return out;
}

/** Toast of an incoming DM: «✉ Мурка: новое личное сообщение», without a known sender «✉ Новое личное сообщение». */
export function dmToast(from: string | null | undefined): string {
  const f = String(from || '').trim().slice(0, 40);
  return f ? `✉ ${f}: новое личное сообщение` : '✉ Новое личное сообщение';
}

/* ================================================================ glue */

export interface DmHooks {
  toast(text: string): void;
  /** The small window outside the chat took / lost the focus (gameplay off / on, like the docked chat). */
  floatFocus(on: boolean): void;
  /** LGDm shows a conversation («Написать» somewhere): the mine tab of the dock steps back so «Личные» is seen. */
  show(): void;
  me(): string;
  /** Site 30.10: the single chat is on for this viewer (app.js oneIsOn: hero.c1 and a City / mine feed, LGChatOne) — then
   *  LGDm never shows its own window, «show» belongs to the single chat, and we must not hold a listener on LGDm (its
   *  open() waits for the single chat only while nobody listens). Default: off. */
  one?(): boolean;
}

/** app.js oneIsOn(): the hero has the single chat (c1) with a feed (cc / mc), and LGChatOne is (being) loaded. */
export function dmOneOn(hero: { c1?: unknown; cc?: unknown; mc?: unknown } | null | undefined, win: W = window as W): boolean {
  const o = (win as unknown as { LGChatOne?: unknown }).LGChatOne;
  return !!(hero && hero.c1 && (hero.cc || hero.mc) && o);
}

export const DM_KEY = 'l3d-3d';
/** The key the site's single chat (LGChatOne) docks LGDm under (site-chatone.js: key 'lgChatOne'). */
export const CO_DM_KEY = 'lgChatOne';
const TOAST_GAP_MS = 2500;
const FROM_FRESH_MS = 4000;

export class DmBridge {
  private lg: DmApi | null = null;
  private last = 0;
  private float: HTMLElement | null = null;
  private fromT = 0;
  private from = '';
  private toastAt = 0;
  private timers = new Set<number>();
  private offBus: (() => void) | null = null;
  /** Our listener is registered on this LGDm (not while the single chat is on). */
  private listening = false;
  private floatOff: (() => void) | null = null;
  floatFocused = false;

  constructor(private h: DmHooks, private win: W = window as W, private doc: Document = document) {
    const B = (this.win as unknown as { __L3D_BUS?: { on?(t: string, f: (d: any) => void): () => void } }).__L3D_BUS;
    // the sender of the newest incoming DM (SSE «dm» { m: { fl, fn, … } }): only for the toast's text
    if (B && typeof B.on === 'function') {
      this.offBus = B.on('sse:dm', (d: any) => {
        const m = d && d.m;
        if (!m || String(m.fl || '').toLowerCase() === this.h.me()) return;
        this.from = String(m.fn || m.fl || ''); this.fromT = Date.now();
      });
    }
  }

  /** Two times a second: pick up LGDm when the site loaded it late, and the small window when LGDm made it. */
  scan() {
    const lg = dmApi(this.win);
    if (lg && lg !== this.lg) {
      this.lg = lg; this.listening = false;
      this.last = lg.unread();
    } else if (!lg && this.lg) { this.lg = null; this.last = 0; this.listening = false; }
    if (this.lg) {
      const one = !!this.h.one?.();
      if (one && this.listening) { try { this.lg.on(DM_KEY, null); } catch { /* */ } this.listening = false; }
      else if (!one && !this.listening) { this.lg.on(DM_KEY, this.onLg); this.listening = true; }
      if (one) this.unreadCheck();   // no events of ours with the single chat: the toast comes from the counter
    }
    const fl = this.doc.querySelector<HTMLElement>('.dm-float');
    if (fl !== this.float) { this.floatOff?.(); this.floatOff = null; this.float = fl; if (fl) this.bindFloat(fl); }
  }

  private onLg = (why: string) => {
    if (!this.lg) return;
    if (why === 'show') this.h.show();
    this.unreadCheck();
  };

  /** The unread counter of LGDm grew → one toast (named when the SSE «dm» told us the sender a moment ago). */
  private unreadCheck() {
    const lg = this.lg; if (!lg) return;
    let u = 0; try { u = lg.unread(); } catch { return; }
    const grew = u > this.last;
    this.last = u;
    if (!grew) return;
    // LGDm.onEvent may run before or after our bus listener: let both finish, then name the sender
    const t = this.win.setTimeout(() => {
      this.timers.delete(t);
      const now = Date.now();
      if (now - this.toastAt < TOAST_GAP_MS) return;
      this.toastAt = now;
      this.h.toast(dmToast(now - this.fromT < FROM_FRESH_MS ? this.from : null));
    }, 60);
    this.timers.add(t);
  }

  /**
   * The single chat window (site 30.10 «chatone») registers its «Личные» box with LGDm while it is still detached (its holder is
   * never in the page), and LGDm drops a dock that is not connected — the DMs would stay in their small floating window over the
   * chat. Once the window is on the page we register it again (LGDm.dock is idempotent, the site's own call).
   */
  adopt(box: HTMLElement) {
    const lg = this.lg; if (!lg || typeof lg.dock !== 'function' || !box.isConnected || !box.dataset.coBound) return;
    const dmx = box.querySelector('.cy-chat-dmx');
    if (!dmx || this.adopted.get(lg) === box) return;
    this.adopted.set(lg, box);
    try { lg.dock(CO_DM_KEY, box, dmx); } catch { /* */ }
  }
  private adopted = new WeakMap<object, HTMLElement>();

  /** LGDm.place(): back into the chat after it was hidden (menu closed, HUD back). */
  place() { try { this.lg?.place?.(); } catch { /* */ } }

  /* ---- the small window outside the chat ---- */

  private bindFloat(fl: HTMLElement) {
    const onIn = () => { if (!this.floatFocused) { this.floatFocused = true; this.h.floatFocus(true); } };
    const onOut = () => setTimeout(() => {
      if (!this.floatFocused || this.float !== fl) return;
      if (fl.contains(this.doc.activeElement)) return;
      this.floatFocused = false; this.h.floatFocus(false);
    }, 0);
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault(); e.stopPropagation();   // Esc leaves the field (it would open the pause menu)
      (this.doc.activeElement as HTMLElement | null)?.blur?.();
    };
    fl.addEventListener('focusin', onIn); fl.addEventListener('focusout', onOut); fl.addEventListener('keydown', onKey, true);
    this.floatOff = () => {
      fl.removeEventListener('focusin', onIn); fl.removeEventListener('focusout', onOut); fl.removeEventListener('keydown', onKey, true);
      if (this.floatFocused) { this.floatFocused = false; this.h.floatFocus(false); }
    };
  }

  /** The small window is on screen (not folded to its pill, not hidden). */
  floatShown(): boolean {
    const fl = this.float;
    return !!(fl && fl.isConnected && !fl.hidden && fl.getClientRects().length);
  }

  /** Enter / T with no chat box: the field of the small window (unfolds it first). True = it took the focus. */
  focusFloat(): boolean {
    const fl = this.float;
    if (!this.floatShown() || !fl) return false;
    if (fl.classList.contains('fold')) fl.querySelector<HTMLElement>('.dm-ft')?.click();
    const inp = fl.querySelector<HTMLInputElement>('.dm-f input');
    if (!inp || inp.disabled || !inp.getClientRects().length) return false;
    try { inp.focus({ preventScroll: true }); } catch { inp.focus(); }
    return this.doc.activeElement === inp;
  }

  dispose() {
    if (this.listening) this.lg?.on(DM_KEY, null);
    this.lg = null; this.listening = false;
    this.offBus?.(); this.offBus = null;
    this.floatOff?.(); this.floatOff = null; this.float = null;
    for (const t of this.timers) this.win.clearTimeout(t);
    this.timers.clear();
  }
}
