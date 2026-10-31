/**
 * Chat. Two modes, same API for the UI (el, typing, focus, sync, update):
 *
 * 1. DOCK (live site): the site's own city chat (`#tab-city .cy-chat`, rendered and kept current by the site's
 *    window.LGChat — tabs Общий / Торговля / Достижения / Личные, unread counters, class icons, nick colours, ✉ DMs,
 *    ignore, nick menu, /commands, mute notices, moderation) is shown over our canvas, fixed bottom-left, restyled by
 *    SITE_CHAT_CSS. We only control it: Enter/T/'/' focus its input (gameplay off), Esc/blur gives gameplay back,
 *    a sent message blurs it, it fades when idle and hides while a menu is open or the HUD is off. Every site update
 *    of the chat reaches the player without a change here.
 *    Site 30.10 «chatone» (src/ui/chatone.ts): the hero may have ONE chat window for the page (window.LGChatOne: Город · Торговля ·
 *    Достижения · Шахта · Личные). It is the same kind of box, docked the same way — in the City it stands in the City's slot, in the
 *    mine room it takes our host (`.l3d-co-host`) and opens on «Шахта»; our own mine tab below is then NOT added (attachMineChat hands
 *    the mine's chat to the site's window instead). The window's size (top / right edge handles on a PC, height 280–340 px) is the site's.
 * 2. FALLBACK (offline demo, site chat missing or switched off): our own panel with the site's tab logic ported
 *    (tabOf / chatVis of site-chat.js): Достижения under the trade flag (ct, else in Общий), Личные under cd with
 *    peers, ✉ on nicks, per-tab unread counters, class icons and per-nick colours.
 * Never sends anything by itself.
 */
import type { ChatMsg, Hero } from '../contracts';
import { type Ctx, h } from './ctx';
import { esc } from './data';
import { SITE_CHAT_CSS } from './styles';
import { ModUi, Moderator, canMod, menuItems, roleIco, type ModApi, type ModLine, type UiItem, type ModOp } from './chat-mod';
import type { ModalInput } from '../core/modal';
import { setHtml } from '../core/html';
import { DmBridge, dmApi, dmOneOn, friendsApi, nickMenuItems } from './dm';
import { CO_BOX_SEL, OneMine, chatOneApi, chatOneOn, isQuiet } from './chatone';
import { ChatFocusGuard, evTarget, gameOwnsInput } from './chatfocus';
import { deepActive } from '../engine/input';
export { chatOneOn } from './chatone';

/* ================================================================ pure logic (site-chat.js parity, tested) */

export type ChatTab = 'g' | 'tr' | 'ev' | 'dm';
export const CHAT_TABS: readonly ChatTab[] = ['g', 'tr', 'ev', 'dm'];
export const TAB_NAME: Record<ChatTab, string> = { g: 'Общий', tr: 'Торговля', ev: 'Достижения', dm: 'Личные' };
export interface ChatFlags { on: boolean; tr: boolean; dm: boolean; ev: boolean }

/** Hero chat flags as the site reads them: cc = chat, ct = Торговля (+ Достижения), cd = Личные. */
export function chatFlags(hero: Hero | null | undefined): ChatFlags {
  const x = (hero || {}) as Record<string, unknown>;
  const tr = !!x.ct;
  return { on: !!x.cc, tr, dm: !!x.cd, ev: tr };
}

/** Tab of a message — site: `m.tb || (m.ev ? (C.tr ? 'ev' : 'g') : m.k === 'tr' ? 'tr' : m.k === 'dm' ? 'dm' : 'g')`. */
export function tabOf(m: ChatMsg, f: ChatFlags): ChatTab {
  const k = m.kind || 'g';
  if (k === 'ev') return f.tr ? 'ev' : 'g';
  return k === 'tr' ? 'tr' : k === 'dm' ? 'dm' : 'g';
}

/** Tab available with these flags (else the site falls back to Общий). */
export const tabOk = (t: ChatTab, f: ChatFlags) => t === 'g' || ((t === 'tr' || t === 'ev') && f.tr) || (t === 'dm' && f.dm);

/** Lines of a tab — site chatVis(): own tab, not ignored, in Личные only the chosen peer (system lines always). */
export function chatVis(list: readonly ChatMsg[], tab: ChatTab, f: ChatFlags, peer: string | null, ign: ReadonlySet<string>): ChatMsg[] {
  const out: ChatMsg[] = [];
  for (const m of list) {
    if (tabOf(m, f) !== tab || ign.has(m.login)) continue;
    if (tab === 'dm' && peer && m.kind !== 'sys' && m.login !== peer && m.to !== peer) continue;
    out.push(m);
  }
  return out;
}

/** Recent DM partners (newest first, ≤ 8), the chosen peer always included — site chatTo(). */
export function dmPeers(list: readonly ChatMsg[], me: string, peer: string | null, ign: ReadonlySet<string>): string[] {
  const peers: string[] = [];
  for (let i = list.length - 1; i >= 0 && peers.length < 8; i--) {
    const m = list[i]; if (m.kind !== 'dm') continue;
    const p = m.login === me ? m.to : m.login;
    if (p && !peers.includes(p) && !ign.has(p)) peers.push(p);
  }
  if (peer && !peers.includes(peer)) peers.unshift(peer);
  return peers;
}

/** Class icon before a nick (site CLS_ICO; unknown class → ◆). */
export const CLS_ICO: Record<string, string> = { legionary: '⚔️', archer: '🏹', mage: '🔮', priest: '✨', rogue: '🗡️', necromancer: '💀', paladin: '☀️', recruit: '🌱' };
const NICK_COLORS = ['#ffc94d', '#ff8a80', '#ffab6e', '#f4ff81', '#b9f6ca', '#69f0ae', '#84ffff', '#80d8ff', '#9fa8ff', '#b388ff', '#ea80fc', '#ff80ab', '#ffd180', '#a7ffeb', '#ccff90', '#ffcdd2'];
/** Per-nick colour, same hash (FNV-1a) and palette as the site — a player has one colour on both. */
export function nickColor(l: string): string {
  let x = 2166136261; const t = String(l || '');
  for (let i = 0; i < t.length; i++) { x ^= t.charCodeAt(i); x = Math.imul(x, 16777619); }
  return NICK_COLORS[(x >>> 0) % NICK_COLORS.length];
}

const TAB_EMPTY: Record<ChatTab, string> = {
  g: 'Здесь пока тихо - напиши первым.', tr: 'Здесь объявления: куплю, продам, меняю. Ссылки нельзя.',
  dm: 'Личных пока нет. Нажми «✉» у ника в ленте, чтобы написать лично.', ev: 'Здесь - громкие события игры: заточки +7 и выше, полученные достижения.',
};
const TAB_PH: Record<ChatTab, string> = { g: 'Написать в чат… (Enter)', tr: 'Куплю / продам / меняю…', dm: 'Лично…', ev: '' };

/* ================================================================ local chat commands (never sent) */

/**
 * Local commands typed into any chat field we control (the docked site chat, the fallback panel, the «⛏ Шахта» tab):
 * a matching line is swallowed — the field is cleared, the handler runs, NOTHING reaches the site. Used for easter eggs
 * («!идея бум», src/features/boom.ts): «!идея …» is a real stream-bot command, sending it would spam the streamer.
 */
const COMMANDS: { re: RegExp; run: (text: string) => void }[] = [];
export function registerChatCommand(re: RegExp, run: (text: string) => void): () => void {
  const c = { re, run }; COMMANDS.push(c);
  return () => { const i = COMMANDS.indexOf(c); if (i >= 0) COMMANDS.splice(i, 1); };
}
/** The local command a typed line is, or null. */
export function chatCommand(text: string): ((text: string) => void) | null {
  const t = String(text ?? '').trim();
  if (!t) return null;
  for (const c of COMMANDS) { c.re.lastIndex = 0; if (c.re.test(t)) return c.run; }
  return null;
}
/** Run the local command of `text` if it is one (true = swallowed: the caller must not send it). */
export function runChatCommand(text: string): boolean {
  const fn = chatCommand(text);
  if (!fn) return false;
  try { fn(String(text).trim()); } catch (e) { console.error('[l3d] chat command', e); }
  return true;
}
/** A field with a local command in it: clear it and run the command (true = swallowed). */
function swallowField(inp: HTMLInputElement | null | undefined): boolean {
  if (!inp || !chatCommand(inp.value)) return false;
  const t = inp.value; inp.value = '';
  try { inp.dispatchEvent(new Event('input', { bubbles: true })); } catch { /* */ }
  return runChatCommand(t);
}

/* ================================================================ mine chat tab (⛏ Шахта) */

/** One line of the mine room's chat (the game's `mchat` format; r = the author's chat role own / mod, sys = a local answer to a command). */
export interface MineLine { id: string; l: string; n?: string; t: string; at?: number; r?: string; k?: string; sys?: boolean }
/** What the mine room hands to the chat dock (no import of rooms/ from ui/). Reading only; say() is called by the dock only when the player sends. */
export interface MineChatSource {
  lines(): readonly MineLine[];
  /** Chat counter of the mine's feed (`mchat.c`): the single chat window (site «chatone») continues from it. */
  c?(): number;
  on(fn: (fresh: MineLine[]) => void): () => void;
  say(text: string): Promise<{ ok?: boolean; error?: string } | null | undefined | unknown>;
  me(): string;
  /** Moderation (site parity, src/ui/chat-mod.ts) — all optional: chat state of the enter (`mchat`: mod, muted), */
  state?(): { mod?: unknown; muted?: unknown } | null;
  /** live deletions / the addressed chatMe, */
  onLive?(fn: (d: { chatDel?: string[]; chatMe?: any }) => void): () => void;
  /** the site API for GET / POST /api/mine/chat/mod and the mine query ('?c=<id>'). */
  api?: ModApi;
  q?: string;
}
const MINE_KEEP = 80;
export const MINE_PH = 'Написать в чат шахты…';
export const MINE_EMPTY = 'В шахте пока тихо — напиши первым.';

/**
 * State of the «Шахта» tab, DOM-free: selection (+ the tab to give back), unread counter, history + live lines without duplicates,
 * sending only on an explicit send(). The dock / fallback panel render from it.
 */
export class MineChatTab {
  selected = false;
  unread = 0;
  /** Tab that was active when the mine tab took over (restored on leave if the player did not choose another meanwhile). */
  prev: string | null = null;
  /** Moderation of the mine chat (null when the source has no API: then nothing changes for the tab). */
  readonly mod: Moderator | null;
  /** A status / error line to show (moderation results, «Модератор запретил…»). */
  onNote: ((text: string, ok: boolean) => void) | null = null;
  /** Lines removed / re-roled, sys line added, role or mute changed: re-render. */
  onChange: (() => void) | null = null;
  private seen = new Set<string>();
  private list: MineLine[] = [];
  constructor(readonly src: MineChatSource) {
    this.take(src.lines());
    this.mod = src.api ? new Moderator('/api/mine/chat', src.q || '', src.api, {
      remove: (ids) => this.remove(ids),
      setRole: (l, r) => { for (const x of this.list) if (x.l === l) x.r = r; this.onChange?.(); },
      note: (t, ok) => this.onNote?.(t, !!ok),
      sys: (t) => this.sys(t),
    }) : null;
    if (this.mod) { try { this.mod.st.enter(src.state?.() || null); } catch { /* */ } }
  }
  /** Lines deleted by a moderator (site chatApply chatDel). */
  remove(ids: readonly string[]) {
    if (!ids.length) return;
    const del = new Set(ids), n = this.list.length;
    this.list = this.list.filter((x) => !del.has(x.id));
    if (this.list.length !== n) this.onChange?.();
  }
  /** A local line (answer to a command): shown, never sent (site chatSys). */
  sys(t: string) {
    const l: MineLine = { id: 'sys' + Date.now() + Math.random().toString(36).slice(2, 6), l: '', t, at: Date.now(), sys: true };
    this.seen.add(l.id); this.list.push(l);
    if (this.list.length > MINE_KEEP) this.list = this.list.slice(-MINE_KEEP);
    this.onChange?.();
  }
  /** Live moderation of the mine chat: deletions and my own mute / role (site chatApply). */
  live(d: { chatDel?: readonly string[]; chatMe?: any }) {
    if (d.chatDel && d.chatDel.length) this.remove(d.chatDel.map(String));
    if (d.chatMe && this.mod) { const note = this.mod.st.me(d.chatMe); if (note) this.onNote?.(note, false); this.onChange?.(); }
  }
  /** Placeholder while I am muted here (the field is disabled), else null. */
  mutedPh(now = Date.now()): string | null { return this.mod ? this.mod.st.placeholder(now) : null; }
  private take(ls: readonly MineLine[]): MineLine[] {
    const fresh: MineLine[] = [];
    for (const l of ls) { if (!l || this.seen.has(l.id)) continue; this.seen.add(l.id); this.list.push(l); fresh.push(l); }
    if (this.list.length > MINE_KEEP) this.list = this.list.slice(-MINE_KEEP);
    if (this.seen.size > 1000) { const keep = new Set(this.list.map((x) => x.id)); for (const id of this.seen) if (!keep.has(id)) this.seen.delete(id); }
    return fresh;
  }
  lines(): readonly MineLine[] { return this.list; }
  /** Live lines: returns the new ones; counts unread (not own) while another tab is shown. */
  incoming(ls: readonly MineLine[]): MineLine[] {
    const fresh = this.take(ls), me = this.src.me();
    if (!this.selected) for (const l of fresh) if (String(l.l).toLowerCase() !== me) this.unread++;
    return fresh;
  }
  /** Mine entered: take the tab, remember the one it replaces. */
  enter(prev: string | null) { this.selected = true; this.unread = 0; this.prev = prev; }
  /** The player picked the tab. */
  choose() { this.selected = true; this.unread = 0; }
  /** The player picked another tab. */
  deselect() { this.selected = false; }
  /** Mine left: the tab to restore (null when the player already chose another one). */
  leave(): string | null { const r = this.selected ? this.prev : null; this.selected = false; return r; }
  /** Send what the player typed (blank → null, nothing posted). «/…» is a moderation command (site chatSend: never posted). */
  async send(text: string): Promise<{ ok: boolean; error?: string; cmd?: boolean } | null> {
    const t = String(text || '').trim(); if (!t) return null;
    if (runChatCommand(t)) return { ok: true };   // a local command: never posted
    if (this.mod && t.startsWith('/')) return { ok: await this.mod.cmd(t), cmd: true };
    const ph = this.mutedPh(); if (ph) return { ok: false, error: ph };
    const r = await this.src.say(t) as { ok?: boolean; error?: string } | null | undefined;
    if (r && r.ok === false) { if (this.mod && /запретил/.test(String(r.error || ''))) { this.mod.st.refused(); this.onChange?.(); } return { ok: false, error: r.error }; }
    return { ok: true };
  }
}

let mineSrc: MineChatSource | null = null;
const mineSubs = new Set<() => void>();
/** The mine room's hold on the site's single chat window (chatone), when the hero has it. */
let oneMine: OneMine | null = null;
/** The 3D mine room calls this on enter and the returned function on exit: the chat dock shows / removes the «⛏ Шахта» tab. */
export function attachMineChat(src: MineChatSource): () => void {
  // site 30.10 «chatone»: the page's single window has the «Шахта» tab — it, not our tab, shows (and sends) the mine's chat
  const one = chatOneApi();
  if (one && typeof document !== 'undefined') {
    const om = new OneMine(one, { lines: () => src.lines(), c: src.c ? () => src.c!() : undefined, state: src.state ? () => src.state!() : undefined }, document, ensureCss);
    oneMine = om; om.start();
    return () => { if (oneMine === om) oneMine = null; om.stop(); };
  }
  mineSrc = src; for (const f of [...mineSubs]) f();
  return () => { if (mineSrc === src) { mineSrc = null; for (const f of [...mineSubs]) f(); } };
}

const hhmm = (at?: number) => { if (!at) return ''; const d = new Date(at); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
/** A mine line in the docked chat: role icon, nick, text, and «⋯» (data-cm) for a moderator — the site's chatLi look. */
const mineLi = (l: MineLine, me: string, mod: Moderator | null) => {
  if (l.sys) return `<li class="cy-chat-sys">${esc(l.t)}</li>`;
  const nm = esc(l.n || l.l), cm = mod && canMod(mod.role, me, l as ModLine) ? `<button type="button" class="cy-chat-m l3d-cm" data-cm="${esc(l.id)}" aria-label="Модерация: ${nm}">⋯</button>` : '';
  return `<li${String(l.l).toLowerCase() === me ? ' class="me"' : l.r ? ' class="md"' : ''} title="${esc(hhmm(l.at))}">${roleIco(l.r)}<b data-nick="${esc(l.l)}" style="color:${nickColor(l.l)}">${nm}</b> <span>${esc(l.t)}</span>${cm}</li>`;
};

/* ================================================================ controller */

const FADE_MS = 10000;     // fallback: an idle line fades after this
const SHOW = 6;            // fallback: lines when idle
const KEEP = 80;           // per tab (site CHAT_N)
const IDLE_MS = 9000;      // dock: no new lines for this long → faded
const DOCK_SEL = CO_BOX_SEL;   // the City's chat, or the single chat window (site «chatone») in the City's slot / our mine host / its own float
const DOC = typeof document !== 'undefined' ? document : null;
/** An IME composition is running (Esc then cancels it; Enter commits it): KeyboardEvent.isComposing, or keyCode 229. */
export const composing = (e: KeyboardEvent): boolean => !!e.isComposing || e.keyCode === 229;

export class Chat {
  /** Fallback panel (inside the HUD). Hidden while the site's chat is docked. */
  el: HTMLElement;
  private c: Ctx;
  // fallback
  private log: HTMLElement; private input: HTMLInputElement; private cnt: HTMLElement; private tabsEl: HTMLElement; private toEl: HTMLElement; private form: HTMLElement;
  private tab: ChatTab = 'g';
  private peer: string | null = null;
  private un: Record<ChatTab, number> = { g: 0, tr: 0, ev: 0, dm: 0 };
  private seen = new Set<string>();
  private rendered = new Map<string, HTMLElement>();
  private focused = false; private sending = false;
  /** Only the player puts the keyboard into the chat (src/ui/chatfocus.ts). */
  private guard = new ChatFocusGuard();
  private fadeT = 0;
  private flagsKey = '';
  // dock
  private box: HTMLElement | null = null;
  private boxOff: (() => void) | null = null;
  private dockFocus = false;
  private lastAct = 0;
  private idle = false;
  private off = false;
  private scanT = 1;
  private sendWatch = 0;
  // mine tab
  private mine: MineChatTab | null = null;
  private mineOff: (() => void) | null = null;
  private mineBtn: HTMLButtonElement | null = null;       // fallback panel tab
  private dBtn: HTMLButtonElement | null = null;           // dock: tab button, list, form
  private dList: HTMLOListElement | null = null;
  private dForm: HTMLFormElement | null = null;
  private dInput: HTMLInputElement | null = null;
  private dTabsMo: MutationObserver | null = null;
  private dTabsEl: HTMLElement | null = null;
  private boxMo: MutationObserver | null = null;
  private mineSending = false;
  private dGear: HTMLButtonElement | null = null;          // dock: our ⚙ for the mine chat (the site's ⚙ is the City's)
  // moderation (src/ui/chat-mod.ts): one popup (menu / window); the City chat's role, mute and local changes (fallback panel)
  private modUi: ModUi;
  private dm: DmBridge;                                   // site DMs (LGDm): toast, small window, «Написать»
  private dmOff = false;
  private city: Moderator;
  private cityGone = new Set<string>();
  private cityRole = new Map<string, string | undefined>();
  private citySys: ChatMsg[] = [];
  private gear: HTMLButtonElement;
  private offs: (() => void)[] = [];
  private noteT = 0;

  constructor(c: Ctx) {
    this.c = c;
    this.el = h('div', 'chat', `<div class="tabs" role="tablist" aria-label="Вкладки чата"></div>
      <div class="log" role="log" aria-live="polite"></div>
      <div class="to" hidden></div>
      <label class="in"><input type="text" maxlength="200" placeholder="${TAB_PH.g}" autocomplete="off" spellcheck="false" aria-label="Сообщение в чат"><span class="cnt"></span><i class="kc sm dk">Enter</i></label>`);
    this.log = this.el.querySelector('.log') as HTMLElement;
    this.input = this.el.querySelector('input') as HTMLInputElement;
    this.cnt = this.el.querySelector('.cnt') as HTMLElement;
    this.tabsEl = this.el.querySelector('.tabs') as HTMLElement;
    this.toEl = this.el.querySelector('.to') as HTMLElement;
    this.form = this.el.querySelector('.in') as HTMLElement;
    for (const t of CHAT_TABS) {
      const b = h('button', '', `${TAB_NAME[t]}<b class="tn" hidden></b>`); b.type = 'button'; b.dataset.t = t; b.setAttribute('role', 'tab');
      this.tabsEl.appendChild(b);
    }
    // keep focus in the input while clicking tabs / peers / nicks
    for (const x of [this.tabsEl, this.toEl, this.log]) x.addEventListener('mousedown', (e) => { if ((e.target as HTMLElement).closest('button,b[data-nick]')) e.preventDefault(); });
    this.tabsEl.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('[data-t]'); if (!b) return;
      this.setTab(b.dataset.t as ChatTab);
      if (!this.focused) this.focus();
    });
    this.toEl.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('[data-peer]'); if (!b) return;
      this.peer = b.dataset.peer || null; this.rerender();
    });
    this.log.addEventListener('click', (e) => {
      const t = e.target as HTMLElement;
      const dm = t.closest<HTMLElement>('[data-dm]');
      if (dm) { this.openPeer(dm.dataset.dm!); return; }
      const n = t.closest<HTMLElement>('b[data-nick]');
      if (n && n.dataset.nick && n.dataset.nick !== this.me()) {
        if (this.tab === 'dm') { this.openPeer(n.dataset.nick); return; }
        const rest = this.input.value.replace(/^@[\w]+\s*/, ''); this.input.value = `@${n.dataset.nick} ${rest}`;
        if (!this.focused) this.focus();
      }
    });
    this.log.addEventListener('wheel', (e) => e.stopPropagation(), { passive: true });
    // open while anything in the panel has focus (the input, or a tab button in read-only Достижения) — when the player put it there
    this.el.addEventListener('focusin', () => { if (!this.focused && !this.refuse()) this.onFocus(true); });
    this.el.addEventListener('focusout', () => setTimeout(() => {
      const a = this.c.shadow.activeElement;
      if (this.focused && !this.modUi.open && !(a && this.el.contains(a))) this.onFocus(false);
    }, 0));
    this.el.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape' || composing(e)) return;   // Esc during IME composition only cancels the composition
      e.preventDefault(); e.stopPropagation();
      (this.c.shadow.activeElement as HTMLElement | null)?.blur?.();
    });
    this.input.addEventListener('input', () => { const n = this.input.value.length; this.cnt.textContent = n > 150 ? `${n}/200` : ''; });
    this.input.addEventListener('keydown', (e) => {
      e.stopPropagation();   // game keys must not fire while typing
      if (e.key === 'Escape') { if (!composing(e)) { e.preventDefault(); this.input.blur(); } }
      else if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); void this.send(); }
    });
    this.input.addEventListener('keyup', (e) => e.stopPropagation());
    this.input.addEventListener('keypress', (e) => e.stopPropagation());
    // moderation: the popup (menu / ⚙ window) and the City chat's moderator (fallback panel; docked, the site's own chat moderates)
    this.modUi = new ModUi(() => this.c.host.input as unknown as ModalInput);
    this.dm = new DmBridge({
      toast: (t) => this.c.toast(t),
      floatFocus: (on) => this.gameplayFor(on, 'dm'),
      show: () => { if (this.mine?.selected) { this.mine.deselect(); this.dockMineView(); } },   // «Написать» in the mine tab → «Личные» is seen
      me: () => this.me(),
      one: () => dmOneOn(this.c.host.store.hero as { c1?: unknown; cc?: unknown; mc?: unknown } | null) || chatOneOn(),
    });
    this.modUi.onChange = (open) => {
      if (open || !this.focused) return;
      setTimeout(() => { const a = this.c.shadow.activeElement; if (this.focused && !this.modUi.open && !(a && this.el.contains(a))) this.onFocus(false); }, 0);
    };
    const api: ModApi = (p, b) => (b === undefined ? this.c.host.actions.get(p) : this.c.host.actions.post(p, b));
    this.city = new Moderator('/api/city/chat', '', api, {
      remove: (ids) => { for (const id of ids) this.cityGone.add(id); if (!this.box) this.rerender(); },
      setRole: (l, r) => { this.cityRole.set(l, r); if (!this.box) this.rerender(); },
      note: (t, ok) => this.note(t, !!ok),
      sys: (t) => { this.citySys.push({ id: 'sys' + Date.now() + Math.random().toString(36).slice(2, 6), login: '', name: '', text: t, at: Date.now(), kind: 'sys' }); if (this.citySys.length > 20) this.citySys.shift(); if (!this.box) this.rerender(); },
    });
    this.gear = h('button', 'gear', '⚙︎'); this.gear.type = 'button'; this.gear.hidden = true;
    this.gear.setAttribute('aria-label', 'Модерация чата'); this.gear.title = 'Модерация чата';
    this.gear.addEventListener('mousedown', (e) => e.preventDefault());
    this.gear.addEventListener('click', () => this.openPanel(this.gear, this.el, this.mineSel));
    this.log.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('[data-cm]'); if (!b) return;
      e.stopPropagation(); this.openMenu(b, b.dataset.cm!, this.mineSel);
    }, true);
    // the City chat's moderation state, from the same answers the site reads: enter (mod, muted), live / polled chatMe
    const B = (typeof window !== 'undefined' ? (window as any).__L3D_BUS : null) as { on?(t: string, f: (d: any) => void): () => void; last?: Record<string, any> } | null;
    if (B && typeof B.on === 'function') {
      const enter = (r: any) => { if (r && r.ok !== false) { this.city.st.enter(r); this.modSync(); } };
      const live = (d: any) => { if (!d || !d.chatMe) return; const n = this.city.st.me(d.chatMe); if (n && !this.box) this.note(n, false); this.modSync(); };
      this.offs.push(B.on('city:enter', enter), B.on('sse:city', live), B.on('city:state', (d) => { if (d && d.ok) live(d); }));
      if (B.last && B.last['city:enter']) enter(B.last['city:enter']);
    }
    // the player's own ways into the chat: a click / tap on it, Tab navigation (window capture: before any handler)
    if (typeof window !== 'undefined') {
      const onPtr = (e: Event) => { if (this.inChatEl(evTarget(e))) this.guard.intent(); };
      const onTab = (e: KeyboardEvent) => { if (e.key === 'Tab') this.guard.intent(); };
      window.addEventListener('pointerdown', onPtr, true); window.addEventListener('mousedown', onPtr, true);
      window.addEventListener('keydown', onTab, true);
      this.offs.push(() => { window.removeEventListener('pointerdown', onPtr, true); window.removeEventListener('mousedown', onPtr, true); window.removeEventListener('keydown', onTab, true); });
    }
    this.renderTabs();
    mineSubs.add(() => this.mineSync());
    this.mineSync();
  }

  /** x is a part of the chat: our panel, the docked site box (or its float / our mine host), its nick menu, our moderation popup. */
  private inChatEl(x: Element | null): boolean {
    if (!x) return false;
    if (this.el.contains(x)) return true;
    const b = this.box;
    return !!((b && b.contains(x)) || x.closest?.('.cy-nm, .co-float, .l3d-co-host') || x.id === ModUi.HOST_ID);
  }

  /**
   * Focus just came into the chat: undo it when the game owns the input and the player did not ask for the chat (the
   * site's tab switch on a re-dock, a site window giving the focus back on close). True = refused (focus is back on the game).
   */
  private refuse(): boolean {
    const inp = this.c.host.input as { gameplay: boolean; focusGame?: () => void };
    if (this.guard.allow(gameOwnsInput(inp, !!this.c.opened(), DOC))) return false;
    const a = deepActive() as HTMLElement | null;
    try { a?.blur?.(); } catch { /* */ }
    try { inp.focusGame?.(); } catch { /* */ }
    return true;
  }

  /* ------------------------------------------------------------ moderation (src/ui/chat-mod.ts) */

  /** Moderator of the chat shown now: the mine tab's or the City's. */
  private get curMod(): Moderator | null { return this.mineSel ? (this.mine?.mod || null) : this.city; }

  /** A status line: docked → the site's own status line of the chat box; fallback → a toast. */
  private note(t: string, ok: boolean) {
    const e = this.box?.querySelector<HTMLElement>('.cy-chat-e');
    if (e) {
      e.textContent = t; e.classList.toggle('ok', ok);
      window.clearTimeout(this.noteT); this.noteT = window.setTimeout(() => { if (e.textContent === t) e.textContent = ''; }, 4000);
    } else this.c.toast(t, !ok);
  }

  /** Role / mute changed: redraw what shows it. */
  private modSync() {
    if (this.box) { this.dockMineView(); return; }
    this.rerender();
  }

  /** «⋯» of a line (mine or City, our own rendering): the menu of the site's items for my role. */
  private openMenu(from: HTMLElement, id: string, mine: boolean) {
    const mod = mine ? this.mine?.mod : this.city; if (!mod || !mod.role) return;
    let line: ModLine | null = null;
    if (mine) { const l = this.mine!.lines().find((x) => x.id === id); if (l) line = l as ModLine; }
    else { const m = this.c.host.store.chat.find((x) => x.id === id); if (m) line = { id: m.id, l: m.login, n: m.name, r: this.roleOf(m), k: m.kind }; }
    if (!line || !canMod(mod.role, this.me(), line)) return;
    this.modUi.menu(from, line.n || line.l, menuItems(mod, line));
  }

  /** ⚙: the moderation window of the chat shown now. */
  private openPanel(from: HTMLElement, anchor: HTMLElement, mine: boolean) {
    const mod = mine ? this.mine?.mod : this.city; if (!mod || !mod.role) return;
    this.modUi.panel(from, anchor, { title: mine ? 'Модерация чата шахты' : 'Модерация чата города', load: () => mod.info(), act: (op, o) => mod.act(op, o) });
  }

  /** The chat role of a City line's author: what the site sent (m.r), or what a mod / unmod of mine changed. */
  private roleOf(m: ChatMsg): string | undefined {
    return this.cityRole.has(m.login) ? this.cityRole.get(m.login) : ((m as unknown as { r?: string }).r || undefined);
  }

  /**
   * Docked City chat: the site's «⋯» (button[data-cmod]) opens OUR menu whose items press the site's own buttons
   * ([data-cact] of the same line, found again at the moment of the press) — the site's chatAct does the request, the
   * status line and the list update, so the City's moderation is the site's own. Ban is confirmed in our menu (a second
   * press) and the site's confirm() is answered for it. A button the site has re-rendered away → the same request by us.
   */
  private siteMenu(btn: HTMLElement) {
    const b = this.box, li = btn.closest('li'), list = b?.querySelector<HTMLElement>('.cy-chat-l:not(.l3d-mine-l)');
    if (!b || !li || !list) return;
    const nick = li.querySelector<HTMLElement>('b[data-nick]');
    const title = (nick?.textContent || '').trim() || nick?.dataset.nick || '';
    const sel = (x: HTMLElement) => {
      const d = x.dataset, q = (k: string, v: string | undefined) => (v == null ? '' : `[data-${k}="${CSS.escape(v)}"]`);
      return `[data-cact="${CSS.escape(d.cact || '')}"]${q('id', d.id)}${q('l', d.l)}${q('min', d.min)}`;
    };
    const items: UiItem[] = [];
    for (const x of li.querySelectorAll<HTMLElement>('.cy-chat-mm [data-cact]')) {
      const op = x.dataset.cact as ModOp, s0 = sel(x), args = { id: x.dataset.id, login: x.dataset.l, n: x.dataset.n, min: +(x.dataset.min || '') || undefined };
      items.push({
        label: (x.textContent || '').trim(), bad: x.classList.contains('bad') || op === 'ban', mute: op === 'mute',
        confirm: op === 'ban' ? `Точно забанить ${args.n || args.login}?` : undefined,
        run: () => {
          const cur = this.box?.querySelector<HTMLElement>(`.cy-chat-l:not(.l3d-mine-l) ${s0}`);
          if (!cur) return this.city.act(op, op === 'ban' ? { ...args, sure: true } : args);
          const w = window as unknown as { confirm: (m?: string) => boolean }, c0 = w.confirm;
          if (op === 'ban') w.confirm = () => true;   // confirmed in our menu already
          try { cur.click(); } finally { if (op === 'ban') w.confirm = c0; }
        },
      });
    }
    if (items.length) this.modUi.menu(btn, title, items);
  }

  dispose() {
    for (const f of this.offs.splice(0)) f();
    this.modUi.dispose();
    this.dm.dispose();
    DOC?.documentElement.classList.remove('l3d-dm-off');
    this.undock();
  }

  /** The site's chat is docked over the game (instead of our panel). */
  get docked() { return !!this.box; }
  get typing() { return (this.box ? this.dockFocus : this.focused) || this.dm.floatFocused || this.modUi.open; }

  focus(prefill?: string) {
    this.guard.intent();   // the player's T / Enter / '/' (or a click on a tab / nick): the focus that follows is theirs
    try { (this.c.host.input as { allowFocus?: () => void }).allowFocus?.(); } catch { /* */ }   // and the input's focus safety net agrees
    try { document.exitPointerLock?.(); } catch { /* ignore */ }
    if (this.box) { this.dockFocusIn(prefill); return; }
    if (!this.flags().on && this.dm.focusFloat()) return;   // no chat: the small DM window of the site
    if (this.tab === 'ev' && !this.mineSel) this.setTab('g');
    if (prefill != null && !this.input.value) this.input.value = prefill;
    if (this.input.disabled) this.tabsEl.querySelector<HTMLElement>(`[data-t="${this.tab}"]`)?.focus();
    else this.input.focus();
  }

  /* ------------------------------------------------------------ fallback panel */

  private me() { return String(this.c.host.store.hero?.login || this.c.host.store.me?.login || '').toLowerCase(); }
  private flags() { return chatFlags(this.c.host.store.hero); }

  private get mineSel() { return !!this.mine && this.mine.selected && !this.box; }

  private setTab(t: ChatTab) {
    if (!tabOk(t, this.flags())) t = 'g';
    this.mine?.deselect();
    this.tab = t; this.un[t] = 0;
    this.rerender();
    if (this.focused) {   // stay in the chat: the field, or the tab itself where there is no field
      if (t === 'ev' || this.input.disabled) this.tabsEl.querySelector<HTMLElement>(`[data-t="${t}"]`)?.focus();
      else this.input.focus();
    }
  }
  private openPeer(nk: string) {
    if (!this.flags().dm || !nk || nk === this.me()) return;
    this.peer = nk; this.setTab('dm');
    if (!this.focused) this.focus();
  }

  private renderTabs() {
    const f = this.flags();
    if (!tabOk(this.tab, f)) this.tab = 'g';
    const ms = this.mineSel, hasMine = !!this.mine && !this.box;
    const cm = this.curMod, gearOn = !!(cm && cm.role);
    const any = f.tr || f.dm || hasMine || gearOn;
    this.tabsEl.hidden = !any;
    for (const b of this.tabsEl.querySelectorAll<HTMLElement>('[data-t]')) {
      const t = b.dataset.t as ChatTab, u = this.un[t] || 0, bn = b.querySelector('.tn') as HTMLElement;
      const sel = t === this.tab && !ms;
      b.hidden = !tabOk(t, f);
      b.classList.toggle('on', sel); b.setAttribute('aria-selected', String(sel));
      bn.hidden = !u || sel; bn.textContent = u > 99 ? '99+' : String(u);
    }
    // «⛏ Шахта» (only in the mine)
    if (hasMine) {
      if (!this.mineBtn) {
        const b = h('button', '', '⛏ Шахта<b class="tn" hidden></b>'); b.type = 'button'; b.setAttribute('role', 'tab'); b.dataset.mine = '1';
        this.mineBtn = b;
        b.addEventListener('click', () => { this.mine?.choose(); this.rerender(); if (!this.focused) this.focus(); });
      }
      if (this.mineBtn.parentElement !== this.tabsEl) this.tabsEl.appendChild(this.mineBtn);
      const u = this.mine!.unread, bn = this.mineBtn.querySelector('.tn') as HTMLElement;
      this.mineBtn.classList.toggle('on', ms); this.mineBtn.setAttribute('aria-selected', String(ms));
      bn.hidden = !u || ms; bn.textContent = u > 99 ? '99+' : String(u);
    } else if (this.mineBtn) { this.mineBtn.remove(); this.mineBtn = null; }
    // «Кому» row in Личные
    const on = this.tab === 'dm' && !ms;
    this.toEl.hidden = !on;
    if (on) {
      const peers = dmPeers(this.c.host.store.chat, this.me(), this.peer, EMPTY_SET);
      setHtml(this.toEl, (peers.length ? `<button type="button" data-peer="" aria-pressed="${!this.peer}">Все</button>` + peers.map((p) => `<button type="button" data-peer="${esc(p)}" aria-pressed="${this.peer === p}" style="color:${nickColor(p)}">${esc(p)}</button>`).join('') : ''))
        + (this.peer ? `<span class="tw">Кому: <b>${esc(this.peer)}</b></span>` : peers.length ? '<span class="tw">Выбери, кому писать</span>' : '');
    }
    // ⚙ (moderators of the chat shown): the moderation window
    this.gear.hidden = !gearOn;
    if (this.gear.parentElement !== this.tabsEl || this.tabsEl.lastElementChild !== this.gear) this.tabsEl.appendChild(this.gear);
    this.form.hidden = this.tab === 'ev' && !ms;   // Достижения: read only
    // muted by a moderator (site chatRender): the field is off, the placeholder says how long
    const mph = cm ? cm.st.placeholder() : null;
    this.input.disabled = !!mph || (this.tab === 'dm' && !this.peer && !ms);
    this.input.placeholder = mph || (ms ? (cm && cm.role ? 'Написать… (/help — команды)' : MINE_PH) : this.tab === 'dm' ? (this.peer ? `Лично для ${this.peer}…` : 'Выбери собеседника: «✉» у ника') : this.tab === 'g' && cm && cm.role ? 'Написать… (/help — команды)' : TAB_PH[this.tab]);
  }

  private onFocus(on: boolean) {
    this.focused = on;
    this.el.classList.toggle('open', on);
    this.gameplayFor(on);
    if (on) { this.fade(true); this.log.scrollTop = this.log.scrollHeight; }
  }

  /**
   * The chat (or the site's DM window: id 'dm') has / gave back the keyboard. With the engine's input this is a HOLD
   * (src/engine/input.ts hold): gameplay is derived there, so nobody else (the overlay poll, classic resume, a closing
   * menu) can switch it on from under a focused chat; old inputs get setGameplay as before.
   */
  private gameplayFor(on: boolean, id = 'chat') {
    const inp = this.c.host.input as typeof this.c.host.input & { focusGame?: () => void; hold?: (id: string, on: boolean) => void };
    if (typeof inp.hold === 'function') inp.hold(id, on);
    else if (on) inp.setGameplay(false);
    else if (!this.c.opened()) inp.setGameplay(true);
    if (!on && !this.c.opened()) {
      // Esc / a sent line / a click elsewhere: the keyboard goes back to the game (the canvas), not to <body> — a field
      // left focused would swallow keys, and a site window closing later would hand the focus back into it
      const a = DOC ? deepActive(DOC) : null;
      if (!a || a === DOC?.body || a === DOC?.documentElement) { try { inp.focusGame?.(); } catch { /* */ } }
    }
    try { window.dispatchEvent(new CustomEvent('l3d:chat', { detail: { focus: on } })); } catch { /* */ }
  }

  private async send() {
    const t = this.input.value.trim();
    if (!t) { this.input.blur(); return; }
    if (this.sending) return;
    if (runChatCommand(t)) { this.input.value = ''; this.cnt.textContent = ''; this.input.blur(); return; }   // local command: never sent
    if (this.mineSel) { await this.mineSend(this.input, () => { this.cnt.textContent = ''; this.input.blur(); }); return; }
    // site chatSend: «/…» in Общий is a moderation command — handled here, never sent to the feed
    if (t.startsWith('/') && this.tab === 'g') {
      this.sending = true;
      try { if (await this.city.cmd(t)) { this.input.value = ''; this.cnt.textContent = ''; } } finally { this.sending = false; }
      return;
    }
    if (this.city.st.isMuted()) { this.renderTabs(); return; }
    if (this.tab === 'dm' && !this.peer) { this.c.toast('Кому? Нажми «✉» у ника в ленте', true); return; }
    this.sending = true;
    try {
      const o = this.tab === 'tr' ? { k: 'tr' as const } : this.tab === 'dm' && this.peer ? { to: this.peer } : undefined;
      const r = await this.c.host.actions.say(t, o);
      if (r && r.ok) { this.input.value = ''; this.cnt.textContent = ''; this.input.blur(); }
      else {
        if (r && /запретил/.test(String(r.error || ''))) { this.city.st.refused(); this.renderTabs(); }
        this.c.toast((r && r.error) || 'Сообщение не отправлено', true);
      }
    } catch {
      this.c.toast('Нет связи с сайтом — сообщение не отправлено', true);
    } finally { this.sending = false; }
  }

  private line(m: ChatMsg): HTMLElement {
    const k = m.kind || 'g', me = this.me(), f = this.flags();
    const el = h('div', 'ln ' + k);
    if (k === 'sys') el.textContent = m.text;
    else if (k === 'ev') el.textContent = '📜 ' + m.text;
    else {
      const ico = m.role ? `<i class="cls emo" title="${esc(m.roleName || m.role)}">${CLS_ICO[m.role] || '◆'}</i>` : '';
      const to = k === 'dm' && m.login === me && m.to ? ` → <b data-nick="${esc(m.to)}" class="n" style="color:${nickColor(m.to)}">${esc(m.to)}</b>` : '';
      const dmB = f.dm && k !== 'dm' && m.login !== me ? `<button type="button" class="dmb" data-dm="${esc(m.login)}" title="Написать лично" aria-label="Написать лично: ${esc(m.name)}">✉</button>` : '';
      const r = this.roleOf(m), cm = canMod(this.city.role, me, { id: m.id, l: m.login, r, k }) ? `<button type="button" class="cm" data-cm="${esc(m.id)}" aria-label="Модерация: ${esc(m.name)}">⋯</button>` : '';
      setHtml(el, `${roleIco(r)}${ico}<b class="n" data-nick="${esc(m.login)}" style="color:${nickColor(m.login)}">${esc(m.name)}</b>${to}${dmB} <span>${esc(m.text)}</span>${cm}`);
      if (m.login === me) el.classList.add('me');
    }
    (el as any)._at = m.at;
    return el;
  }

  private rerender() {
    this.log.textContent = ''; this.rendered.clear();
    this.renderTabs();
    this.syncList(true);
  }

  /** Store chat changed. */
  sync() {
    if (this.box) { this.lastAct = Date.now(); return; }   // the site renders its own chat
    const f = this.flags(), fk = `${f.tr}|${f.dm}`;
    if (fk !== this.flagsKey) { this.flagsKey = fk; this.renderTabs(); }
    // unread per tab (site: own lines and Достижения are not counted)
    const me = this.me(), all = this.c.host.store.chat;
    const first = this.seen.size === 0;
    let cnt = false;
    for (const m of all) {
      if (this.seen.has(m.id)) continue;
      this.seen.add(m.id);
      if (first) continue;
      const tb = tabOf(m, f);
      if (tb === 'ev' || m.login === me || m.kind === 'sys') continue;
      if (tb !== this.tab) { this.un[tb]++; cnt = true; }   // our panel always shows its tab: only the others count
    }
    if (this.seen.size > 2000) { const keep = new Set(all.map((m) => m.id)); for (const id of this.seen) if (!keep.has(id)) this.seen.delete(id); }
    if (cnt || this.tab === 'dm') this.renderTabs();
    this.syncList(false);
  }

  private syncList(toEnd: boolean) {
    if (this.mineSel) { this.syncMineList(toEnd); return; }
    const f = this.flags();
    const all = this.cityGone.size || this.citySys.length
      ? [...this.c.host.store.chat.filter((m) => !this.cityGone.has(m.id)), ...this.citySys].sort((a, b) => a.at - b.at)
      : this.c.host.store.chat;
    let list = chatVis(all, this.tab, f, this.tab === 'dm' ? this.peer : null, EMPTY_SET);
    if (list.length > KEEP) list = list.slice(list.length - KEEP);
    const ids = new Set(list.map((m) => m.id));
    for (const [id, el] of this.rendered) if (!ids.has(id)) { el.remove(); this.rendered.delete(id); }
    const empty = this.log.querySelector('.empty');
    if (list.length) empty?.remove();
    else if (!empty) { const e = h('div', 'ln empty'); e.textContent = TAB_EMPTY[this.tab]; this.log.appendChild(e); }
    for (const m of list) {
      if (this.rendered.has(m.id)) continue;
      const el = this.line(m);
      this.rendered.set(m.id, el);
      this.log.appendChild(el);
    }
    const stick = toEnd || !this.focused || this.log.scrollHeight - this.log.scrollTop - this.log.clientHeight < 40;
    if (stick) this.log.scrollTop = this.log.scrollHeight;
    this.fade(true);
  }

  /** Idle: only the last SHOW lines, each for FADE_MS (relative to arrival). */
  private fade(force = false) {
    const now = Date.now();
    const kids = this.log.children, n = kids.length;
    for (let i = 0; i < n; i++) {
      const el = kids[i] as HTMLElement;
      const at = (el as any)._at as number ?? now;
      const recv = (el as any)._recv ?? ((el as any)._recv = now);
      const hide = n - i > SHOW || now - Math.max(recv, Math.min(at, now)) > FADE_MS;
      if (force || el.classList.contains('fade') !== hide) el.classList.toggle('fade', hide);
      el.style.display = !this.focused && n - i > SHOW ? 'none' : '';
    }
  }

  /* ------------------------------------------------------------ dock (the site's chat) */

  /** The site's chat element, when it is there, bound by LGChat and switched on for this hero. */
  private findBox(): HTMLElement | null {
    if (!DOC || !DOC.documentElement.classList.contains('l3d-on')) return null;
    const b = DOC.querySelector<HTMLElement>(DOCK_SEL);
    if (!b || !b.dataset.bound || b.hidden) return null;
    const fl = b.closest<HTMLElement>('.co-float');   // the single window's own float: only while the site shows it
    return fl && fl.hidden ? null : b;
  }

  private dock(b: HTMLElement) {
    this.undock();
    ensureCss();
    this.box = b;
    this.el.style.display = 'none';
    if (this.focused) this.input.blur();
    const inChat = (x: Element | null) => !!x && (b.contains(x) || !!x.closest?.('.cy-nm') || x.id === ModUi.HOST_ID);
    const onIn = () => {
      if (this.dockFocus || isQuiet() || !DOC!.documentElement.classList.contains('l3d-on')) return;
      if (this.refuse()) return;   // the site focused its field behind the game (tab switch on a re-dock, a window's focus restore)
      this.dockFocus = true; this.gameplayFor(true); this.lastAct = Date.now(); this.setIdle(false);
    };
    const onOut = () => {
      // the site re-renders its list (a focused nick may vanish) and opens the nick menu outside the box: decide later
      setTimeout(() => {
        if (!this.dockFocus || this.box !== b) return;
        if (inChat(document.activeElement)) return;
        this.dockFocus = false; this.lastAct = Date.now(); this.gameplayFor(false);
      }, 0);
    };
    const onKey = (e: KeyboardEvent) => {
      if (!DOC!.documentElement.classList.contains('l3d-on')) return;
      const t = e.target as HTMLElement;
      if (e.key === 'Escape') {
        if (composing(e)) { e.stopPropagation(); return; }   // IME: Esc cancels the composition — the chat stays open (the site must not fold it either)
        // 3D: Esc just leaves the chat (the site would also fold it)
        e.preventDefault(); e.stopPropagation();
        (document.activeElement as HTMLElement | null)?.blur?.();
        return;
      }
      if (e.key === 'Enter' && !e.shiftKey && !e.altKey && !e.ctrlKey && !e.metaKey && !e.isComposing && t.matches?.('.cy-chat-f input, .cy-chat-dmx .dm-f input')) {
        const inp = t as HTMLInputElement;
        if (!inp.value.trim()) { e.preventDefault(); e.stopPropagation(); inp.blur(); return; }
        this.watchSend(inp);   // the site sends; leave the field once it is cleared (sent / command done)
      }
    };
    // local chat commands: window capture runs before any handler of the site's chat (Enter, the send button, submit)
    const fieldOf = (e: Event): HTMLInputElement | null => {
      const t = (typeof e.composedPath === 'function' ? e.composedPath()[0] : e.target) as HTMLElement | null;
      if (!t || !b.contains(t)) return null;
      const f = (t.closest?.('.cy-chat-f') as HTMLElement | null);
      return f ? f.querySelector('input') : null;
    };
    const onCmd = (e: Event) => {
      if (e.type === 'keydown') {
        const k = e as KeyboardEvent;
        if ((k.key !== 'Enter' && k.code !== 'NumpadEnter') || k.isComposing || k.shiftKey) return;
      } else if (e.type === 'click' && !((e.target as HTMLElement | null)?.closest?.('.cy-chat-f button'))) return;
      const inp = fieldOf(e);
      if (!inp || !swallowField(inp)) return;
      e.preventDefault(); e.stopImmediatePropagation();
      inp.blur();
    };
    window.addEventListener('keydown', onCmd, true);
    window.addEventListener('submit', onCmd, true);
    window.addEventListener('click', onCmd, true);
    // the site's «⋯» of a City line: our menu (delegating to the site's own buttons) instead of its inline row
    const onCmod = (e: Event) => {
      const t = e.target as HTMLElement | null, m = t?.closest?.<HTMLElement>('[data-cmod]');
      if (!m || !b.contains(m) || m.closest('.l3d-mine-l')) return;
      e.preventDefault(); e.stopPropagation();
      this.siteMenu(m);
    };
    b.addEventListener('click', onCmod, true);
    const onLeave = () => { if (this.idle) { const l = this.curList(); if (l) l.scrollTop = l.scrollHeight; } };
    const onLock = () => { if (document.pointerLockElement && this.dockFocus) (document.activeElement as HTMLElement | null)?.blur?.(); };
    b.addEventListener('focusin', onIn);
    b.addEventListener('focusout', onOut);
    b.addEventListener('keydown', onKey, true);
    b.addEventListener('mouseleave', onLeave);
    document.addEventListener('pointerlockchange', onLock);
    // a new line in the shown tab (or a tab switch), an error / mute notice wakes it from idle; counters on other tabs do not
    const mo = typeof MutationObserver === 'function' ? new MutationObserver(() => { this.lastAct = Date.now(); if (this.idle) this.setIdle(false); }) : null;
    const lst = b.querySelector('.cy-chat-l'), err = b.querySelector('.cy-chat-e');
    if (lst) mo?.observe(lst, { childList: true });
    if (err) mo?.observe(err, { childList: true, characterData: true, subtree: true });
    DOC!.documentElement.classList.add('l3d-chat-dock');
    this.lastAct = Date.now();
    this.boxOff = () => {
      b.removeEventListener('focusin', onIn); b.removeEventListener('focusout', onOut); b.removeEventListener('keydown', onKey, true); b.removeEventListener('mouseleave', onLeave);
      b.removeEventListener('click', onCmod, true);
      this.modUi.close();
      window.removeEventListener('keydown', onCmd, true); window.removeEventListener('submit', onCmd, true); window.removeEventListener('click', onCmd, true);
      document.removeEventListener('pointerlockchange', onLock);
      mo?.disconnect();
      this.dockMineDetach();
      b.classList.remove('l3d-idle', 'l3d-mine-on');
    };
    if (inChat(document.activeElement)) onIn();
    this.dockMineAttach();
  }

  private undock() {
    if (!this.box) return;
    this.boxOff?.(); this.boxOff = null; this.box = null;
    DOC?.documentElement.classList.remove('l3d-chat-dock', 'l3d-chat-off');
    if (this.dockFocus) { this.dockFocus = false; this.gameplayFor(false); }
    this.idle = false; this.off = false;
    this.el.style.display = '';
    this.rerender();
  }

  private dockFocusIn(prefill?: string) {
    const b = this.box!;
    if (!b.classList.contains('open')) b.querySelector<HTMLButtonElement>('.cy-chat-t')?.click();   // the site opens and focuses its field
    const mineSel = !!this.mine && this.mine.selected && !!this.dForm && this.dForm.isConnected;
    // «Личные» of the site (LGDm): its own field in .cy-chat-dmx (the site's city field is hidden there)
    const dmf = !mineSel ? b.querySelector<HTMLElement>('.cy-chat-dmx:not([hidden]) .dm-f') : null;
    const inp = mineSel ? this.dInput : dmf ? dmf.querySelector<HTMLInputElement>('input') : b.querySelector<HTMLInputElement>('.cy-chat-f:not(.l3d-mine-f) input');
    const form = mineSel ? this.dForm : dmf || b.querySelector<HTMLElement>('.cy-chat-f:not(.l3d-mine-f)');
    if (inp && !inp.disabled && form && !form.hidden) {
      if (prefill != null && !inp.value) inp.value = prefill;
      try { inp.focus({ preventScroll: true }); } catch { inp.focus(); }
      try { inp.setSelectionRange(inp.value.length, inp.value.length); } catch { /* */ }
    } else {
      // read-only tab (Достижения), muted or Личные without a peer: focus the chosen tab — chat mode, the site's
      // own controls work with the mouse and the keyboard
      const t = b.querySelector<HTMLElement>('.cy-chat-tabs [aria-selected="true"]') || b.querySelector<HTMLElement>('.cy-chat-x') || b.querySelector<HTMLElement>('.cy-chat-t');
      try { t?.focus({ preventScroll: true }); } catch { /* */ }
    }
    this.setIdle(false);
  }

  private watchSend(inp: HTMLInputElement) {
    const t0 = performance.now();
    window.clearInterval(this.sendWatch);
    this.sendWatch = window.setInterval(() => {
      const gone = !inp.isConnected || document.activeElement !== inp;
      if (gone || performance.now() - t0 > 6000) { window.clearInterval(this.sendWatch); return; }
      if (!inp.value) { window.clearInterval(this.sendWatch); inp.blur(); }
    }, 120);
  }

  private setIdle(on: boolean) {
    if (on === this.idle || !this.box) return;
    this.idle = on; this.box.classList.toggle('l3d-idle', on);
    if (on) { const l = this.curList(); if (l) l.scrollTop = l.scrollHeight; }   // compact view shows the newest lines
  }

  /* ------------------------------------------------------------ «⛏ Шахта» tab */

  /** The mine room attached / detached its chat source. */
  private mineSync() {
    const src = mineSrc;
    if (src && (!this.mine || this.mine.src !== src)) {
      this.mineTeardown();
      const m = this.mine = new MineChatTab(src);
      m.enter(this.box ? this.siteTabName() : this.tab);   // selected on entering the mine; the previous tab stays as it was and comes back on exit
      m.onNote = (t, ok) => this.note(t, ok);
      m.onChange = () => { if (this.mine !== m) return; if (this.box) this.dockMineView(); else this.rerender(); };
      const offA = src.on((f) => this.mineLines(f)), offB = src.onLive ? src.onLive((d) => m.live(d)) : null;
      this.mineOff = () => { offA(); offB?.(); };
      if (this.box) this.dockMineAttach(); else this.rerender();
    } else if (!src && this.mine) {
      this.mineTeardown();
    }
  }

  private mineTeardown() {
    const m = this.mine; if (!m) return;
    this.mineOff?.(); this.mineOff = null;
    m.onChange = null; m.onNote = null;
    if (this.modUi.open) this.modUi.close();
    const prev = m.leave();
    this.mine = null;
    this.dockMineDetach();
    this.box?.classList.remove('l3d-mine-on');
    if (this.mineBtn) { this.mineBtn.remove(); this.mineBtn = null; }
    if (prev && !this.box && tabOk(prev as ChatTab, this.flags())) this.tab = prev as ChatTab;
    this.rerender();
  }

  private siteTabName(): string {
    return this.box?.querySelector<HTMLElement>('.cy-chat-tabs [aria-selected="true"]:not(.l3d-mine-tab)')?.dataset.tab || 'g';
  }

  private mineLines(fresh: MineLine[]) {
    const m = this.mine; if (!m) return;
    if (!m.incoming(fresh).length) return;
    if (this.box) this.dockMineView(); else if (this.mineSel) this.syncMineList(false); else this.renderTabs();
  }

  private mineLine(l: MineLine): HTMLElement {
    if (l.sys) { const e = h('div', 'ln sys'); e.textContent = l.t; (e as any)._at = l.at; return e; }
    const me = this.mine!.src.me(), mod = this.mine!.mod;
    const el = h('div', 'ln g' + (String(l.l).toLowerCase() === me ? ' me' : ''));
    const cm = mod && canMod(mod.role, me, l as ModLine) ? `<button type="button" class="cm" data-cm="${esc(l.id)}" aria-label="Модерация: ${esc(l.n || l.l)}">⋯</button>` : '';
    setHtml(el, `${roleIco(l.r)}<b class="n" data-nick="${esc(l.l)}" style="color:${nickColor(l.l)}">${esc(l.n || l.l)}</b> <span>${esc(l.t)}</span>${cm}`);
    el.title = hhmm(l.at); (el as any)._at = l.at;
    return el;
  }

  /** Fallback panel: show the mine lines (same as syncList for the city). */
  private syncMineList(toEnd: boolean) {
    const m = this.mine; if (!m) return;
    const list = m.lines(), ids = new Set(list.map((x) => x.id));
    for (const [id, el] of this.rendered) if (!ids.has(id)) { el.remove(); this.rendered.delete(id); }
    const empty = this.log.querySelector('.empty');
    if (list.length) empty?.remove();
    else if (!empty) { const e = h('div', 'ln empty'); e.textContent = MINE_EMPTY; this.log.appendChild(e); }
    for (const l of list) {
      if (this.rendered.has(l.id)) continue;
      const el = this.mineLine(l); this.rendered.set(l.id, el); this.log.appendChild(el);
    }
    const stick = toEnd || !this.focused || this.log.scrollHeight - this.log.scrollTop - this.log.clientHeight < 40;
    if (stick) this.log.scrollTop = this.log.scrollHeight;
    this.fade(true);
  }

  /** The only place where the mine chat posts: the player pressed Enter / the send button. */
  private async mineSend(inp: HTMLInputElement, done: () => void) {
    const m = this.mine; if (!m || this.mineSending) return;
    this.mineSending = true;
    try {
      const r = await m.send(inp.value);
      if (!r) inp.blur();
      else if (r.ok) { inp.value = ''; if (r.cmd) { try { inp.dispatchEvent(new Event('input', { bubbles: true })); } catch { /* */ } } else done(); }
      else if (!r.cmd) this.c.toast(r.error || 'Сообщение не отправлено', true);   // a command shows its own note
    } catch { this.c.toast('Нет связи с сайтом — сообщение не отправлено', true); }
    finally { this.mineSending = false; }
  }

  /** The list currently shown in the docked chat. */
  private curList(): HTMLElement | null {
    const b = this.box; if (!b) return null;
    return this.mine?.selected && this.dList?.isConnected ? this.dList : b.querySelector<HTMLElement>('.cy-chat-l:not(.l3d-mine-l)');
  }

  /** Docked: put our tab, list and field into the site's chat (again after the site rebuilt its DOM). */
  private dockMineAttach() {
    const b = this.box, m = this.mine; if (!b || !m) return;
    const tabs = b.querySelector<HTMLElement>('.cy-chat-tabs'), sl = b.querySelector<HTMLElement>('.cy-chat-l:not(.l3d-mine-l)'), sf = b.querySelector<HTMLElement>('.cy-chat-f:not(.l3d-mine-f)');
    if (!tabs || !sl || !sf) return;
    if (!this.dBtn) {
      const btn = h('button', 'l3d-mine-tab', '⛏ Шахта<b class="cy-chat-tn" hidden></b>'); btn.type = 'button'; btn.setAttribute('role', 'tab');
      btn.addEventListener('click', () => { this.mine?.choose(); this.dockMineView(); });
      const ol = h('ol', 'cy-chat-l l3d-mine-l'); ol.setAttribute('role', 'log'); ol.setAttribute('aria-label', 'Сообщения шахты');
      const form = h('form', 'cy-chat-f l3d-mine-f', `<input type="text" maxlength="200" enterkeyhint="send" placeholder="${MINE_PH}" aria-label="Сообщение в чат шахты" autocomplete="off" spellcheck="false"><button type="submit" aria-label="Отправить">➤</button>`);
      form.autocomplete = 'off';
      const inp = form.querySelector('input') as HTMLInputElement;
      form.addEventListener('submit', (e) => { e.preventDefault(); void this.mineSend(inp, () => { /* the dock blurs once the field is empty */ }); });
      for (const t of ['keydown', 'keyup', 'keypress'] as const) inp.addEventListener(t, (e) => e.stopPropagation());   // game keys never fire while typing
      ol.addEventListener('wheel', (e) => e.stopPropagation(), { passive: true });
      ol.addEventListener('click', (e) => {
        const t = e.target as HTMLElement;
        const cm = t.closest<HTMLElement>('[data-cm]');
        if (cm) { e.stopPropagation(); this.openMenu(cm, cm.dataset.cm!, true); return; }
        // site: a nick → «@ник » in the field (not my own)
        const n = t.closest<HTMLElement>('b[data-nick]'), nk = n?.dataset.nick;
        if (nk && nk.toLowerCase() !== this.mine?.src.me() && !inp.disabled) {
          inp.value = `@${nk} ${inp.value.replace(/^@[\w]+\s*/, '')}`;
          try { inp.focus({ preventScroll: true }); inp.setSelectionRange(inp.value.length, inp.value.length); } catch { /* */ }
        }
      });
      // site 24.10 / 29.10: right button (menu key, long press) on a nick = the nick menu: Ответить · Написать · Пожаловаться · friends
      const nickMenu = (t: HTMLElement, x: number, y: number): boolean => {
        const n = t.closest<HTMLElement>('b[data-nick]'); if (!n) return false;
        const nk = n.dataset.nick || '', name = (n.textContent || '').trim();
        const items = nickMenuItems(nk, name, {
          me: this.mine?.src.me() || this.me(), dm: this.flags().dm, dmApi: dmApi(), friends: friendsApi(),
          reply: (k) => { if (inp.disabled) return; inp.value = `@${k} ${inp.value.replace(/^@[\w]+\s*/, '')}`; try { inp.focus({ preventScroll: true }); inp.setSelectionRange(inp.value.length, inp.value.length); } catch { /* */ } },
          ask: (q, d) => window.prompt(q, d),
        });
        if (!items.length) return false;
        this.modUi.menu(n, name || nk, items, 'Ник');
        void x; void y;
        return true;
      };
      ol.addEventListener('contextmenu', (e) => { if (nickMenu(e.target as HTMLElement, e.clientX, e.clientY)) e.preventDefault(); });
      let lp = 0;
      ol.addEventListener('pointerdown', (e) => {
        if (e.pointerType !== 'touch') return;
        const t = e.target as HTMLElement; clearTimeout(lp);
        lp = window.setTimeout(() => { lp = -1; nickMenu(t, e.clientX, e.clientY); }, 500);
      });
      for (const ev of ['pointerup', 'pointercancel', 'pointermove'] as const) ol.addEventListener(ev, () => { if (lp > 0) clearTimeout(lp); });
      ol.addEventListener('click', (e) => { if (lp === -1) { lp = 0; e.stopPropagation(); e.preventDefault(); } }, true);
      const gear = h('button', 'l3d-mine-sh', '⚙︎'); gear.type = 'button'; gear.hidden = true;
      gear.setAttribute('aria-label', 'Модерация чата шахты'); gear.title = 'Модерация чата шахты';
      gear.addEventListener('click', (e) => { e.stopPropagation(); if (this.box) this.openPanel(gear, this.box.querySelector<HTMLElement>('.cy-chat-b') || this.box, true); });
      this.dGear = gear;
      this.dBtn = btn; this.dList = ol; this.dForm = form; this.dInput = inp;
      if (typeof MutationObserver === 'function') {
        this.boxMo = new MutationObserver(() => { this.lastAct = Date.now(); if (this.idle) this.setIdle(false); });
        this.boxMo.observe(ol, { childList: true });
      }
    }
    if (this.dBtn.parentElement !== tabs) tabs.appendChild(this.dBtn);
    const sh = b.querySelector<HTMLElement>('.cy-chat-h .cy-chat-sh');   // our ⚙ right after the site's (which is the City's)
    if (sh && this.dGear && this.dGear.previousElementSibling !== sh) sh.after(this.dGear);
    if (this.dList!.previousElementSibling !== sl || this.dList!.parentElement !== sl.parentElement) sl.after(this.dList!);
    if (this.dForm!.previousElementSibling !== sf || this.dForm!.parentElement !== sf.parentElement) sf.after(this.dForm!);
    if (this.dTabsEl !== tabs) {
      this.dTabsMo?.disconnect(); this.dTabsEl?.removeEventListener('click', this.onSiteTab);
      this.dTabsEl = tabs; tabs.addEventListener('click', this.onSiteTab);
      if (typeof MutationObserver === 'function') {
        this.dTabsMo = new MutationObserver(() => { if (this.mine && tabs.hidden && b.querySelector<HTMLElement>('.cy-chat-p')?.hidden !== false) tabs.hidden = false; });
        this.dTabsMo.observe(tabs, { attributes: true, attributeFilter: ['hidden'] });
      }
    }
    this.dockMineView();
  }

  /** A site tab was clicked: the site shows its own list again. */
  private onSiteTab = (e: Event) => {
    const t = (e.target as HTMLElement).closest?.('[data-tab]');
    if (t && this.mine?.selected) { this.mine.deselect(); this.dockMineView(); }
  };

  private dockMineView() {
    const b = this.box, m = this.mine, btn = this.dBtn, ol = this.dList; if (!b || !m || !btn || !ol) return;
    const sel = m.selected;
    b.classList.toggle('l3d-mine-on', sel);
    btn.classList.toggle('on', sel); btn.setAttribute('aria-selected', String(sel));
    const bn = btn.querySelector('.cy-chat-tn') as HTMLElement; bn.hidden = !m.unread || sel; bn.textContent = m.unread > 99 ? '99+' : String(m.unread);
    const tabs = this.dTabsEl; if (tabs && tabs.hidden && b.querySelector<HTMLElement>('.cy-chat-p')?.hidden !== false) tabs.hidden = false;
    const stick = ol.scrollHeight - ol.scrollTop - ol.clientHeight < 40;
    // moderation of the mine chat: our ⚙ (shown for a moderator of THIS chat), the field off while I am muted
    if (this.dGear) this.dGear.hidden = !(m.mod && m.mod.role);
    const inp = this.dInput;
    if (inp) { const ph = m.mutedPh(); inp.disabled = !!ph; const sb = this.dForm?.querySelector('button'); if (sb) sb.disabled = !!ph; inp.placeholder = ph || (m.mod && m.mod.role ? 'Написать… (/help — команды)' : MINE_PH); }
    const me = m.src.me(), lines = m.lines();
    const html = lines.length ? lines.map((l) => mineLi(l, me, m.mod)).join('') : `<li class="cy-chat-0">${MINE_EMPTY}</li>`;
    if ((ol as any)._k !== html) { (ol as any)._k = html; setHtml(ol, html); if (stick || sel) ol.scrollTop = ol.scrollHeight; }
  }

  private dockMineDetach() {
    this.dBtn?.remove(); this.dList?.remove(); this.dForm?.remove(); this.dGear?.remove(); this.dGear = null;
    if (this.modUi.open) this.modUi.close();
    // we un-hid the tab row for a lone «Общий»: give it back (the site re-renders it with its own flags anyway)
    const tb = this.dTabsEl;
    if (tb && !tb.hidden && tb.querySelectorAll('button:not([hidden])').length < 2) tb.hidden = true;
    this.dBtn = this.dList = this.dForm = this.dInput = null;
    this.dTabsMo?.disconnect(); this.dTabsMo = null;
    this.dTabsEl?.removeEventListener('click', this.onSiteTab); this.dTabsEl = null;
    this.boxMo?.disconnect(); this.boxMo = null;
    this.box?.classList.remove('l3d-mine-on');
  }

  update(dt: number) {
    // hide the docked chat over our menus and with the HUD off (cheap: two flags per frame)
    const hidden = !!this.c.opened() || this.c.ui.classList.contains('nohud');
    if (this.box) {
      const off = hidden;
      if (off !== this.off) {
        this.off = off; DOC!.documentElement.classList.toggle('l3d-chat-off', off);
        if (off && this.dockFocus) (document.activeElement as HTMLElement | null)?.blur?.();
      }
    }
    // the small DM window of the site (outside the chat) hides with them too; coming back, LGDm may dock into the chat again
    if (hidden !== this.dmOff) {
      this.dmOff = hidden; DOC?.documentElement.classList.toggle('l3d-dm-off', hidden);
      if (hidden && this.dm.floatFocused) (document.activeElement as HTMLElement | null)?.blur?.();
      if (!hidden) this.dm.place();
    }
    this.scanT += dt;
    if (this.scanT > 0.5) {
      this.scanT = 0;
      this.dm.scan();
      oneMine?.tick();
      if (this.box) this.dm.adopt(this.box);   // the single chat window: its «Личные» box (LGDm dock)
      // the site rebuilds its City (re-enter, town change) → a new chat element; classic mode → back to our panel
      if (this.box && (!this.box.isConnected || this.box.hidden || !DOC!.documentElement.classList.contains('l3d-on'))) this.undock();
      if (!this.box) { const b = this.findBox(); if (b) this.dock(b); }
      if (this.box && this.mine) this.dockMineAttach();
      if (this.box) this.setIdle(!this.dockFocus && Date.now() - this.lastAct > IDLE_MS);
      // safety net: «typing» while the focus is no longer in the chat (the site re-rendered the focused field away — no
      // focusout comes then) would keep gameplay off for good: the camera dead under a locked pointer
      const a = DOC ? deepActive(DOC) : null;
      if (this.box && this.dockFocus && !this.inChatEl(a)) { this.dockFocus = false; this.lastAct = Date.now(); this.gameplayFor(false); }
      if (!this.box && this.focused && !this.modUi.open && !(a && this.el.contains(a))) this.onFocus(false);
    }
    if (!this.box) {
      this.fadeT += dt;
      if (this.fadeT > 0.5) { this.fadeT = 0; if (!this.focused) this.fade(); }
    }
  }
}

const EMPTY_SET: ReadonlySet<string> = new Set();

/** Our look for the docked site chat (light DOM, once per page). */
function ensureCss() {
  if (!DOC || DOC.getElementById('l3d-chat-css')) return;
  const s = DOC.createElement('style'); s.id = 'l3d-chat-css'; s.textContent = SITE_CHAT_CSS; DOC.head.appendChild(s);
}
