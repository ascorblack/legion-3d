/**
 * Chat moderation in the 3D chat dock — parity with the site's chat module (site-chat.js «22.10: модерация»).
 *
 * The site gives a moderator of a chat (C.mod: 'own' = админ чата / 'mod' = модератор; from the chat state of enter,
 * the addressed live `chatMe` and the answer of GET <base>/mod) a «⋯» on other people's messages (delete, mute for
 * MUTES, ban, make / unmake moderator for 'own'), a «⚙» in the header (moderation window: restrict by nick, who is
 * muted / banned with «Снять», the moderators with «×» and an add form for 'own') and the commands /help /mods /mod
 * /unmod /mute /ban /unban typed into the field (never sent to the feed). Every action is ONE request:
 *   POST <base>/mod<q> { op, id, login, min }   (op: del | mute | ban | unban | mod | unmod; undefined keys dropped)
 *   GET  <base>/mod<q>                           (the window and /mods)
 * with base '/api/city/chat' (q = '') for the City and '/api/mine/chat' (q = '?c=<mine id>') for the mine.
 *
 * This file: the pure parts (roles, menu items, request builders, command parser, muted state — unit tested against
 * the site's requests) and ModUi — our menu / window in a Shadow DOM (keyboard, Esc / click outside close, the pointer
 * is released and gameplay paused while open through the input's modal stack). src/ui/chat.ts wires it to the City
 * feed (docked: delegated to the site's own buttons; fallback panel) and to the «⛏ Шахта» tab.
 * Nothing here sends by itself: a request only follows an explicit pick / submit / typed command of a moderator.
 */
import { esc } from './data';
import { setModal, type ModalInput } from '../core/modal';

/* ================================================================ pure (site parity) */

export type ModRole = 'own' | 'mod' | null;
export interface Muted { until?: number }
export type ModOp = 'del' | 'mute' | 'ban' | 'unban' | 'mod' | 'unmod';
export interface ModArgs { id?: string; login?: string; min?: number; n?: string; sure?: boolean }
/** A chat line as moderation needs it: id, author login, shown name, the author's chat role (r) and kind (k: dm is never moderated). */
export interface ModLine { id: string; l: string; n?: string; r?: string; k?: string }

/** site MUTES */
export const MUTES: readonly (readonly [number, string])[] = [[5, '5 мин'], [30, '30 мин'], [60, '1 ч'], [1440, '1 день'], [10080, '7 дней']];
/** site ROLE_ICO */
export const ROLE_ICO: Readonly<Record<string, readonly [string, string]>> = { own: ['👑', 'админ чата'], mod: ['🛡', 'модератор чата'] };
/** site CHAT_ERR */
export const CHAT_ERR: Readonly<Record<string, string>> = { rate_limited: 'не так быстро', forbidden: 'нет прав', city_closed: 'Город закрыт', login_required: 'войди через Twitch' };
/** site CHAT_HELP */
export const CHAT_HELP = '/mute ник [минут] · /ban ник · /unban ник';

/** site leftT(): «N мин» / «N ч» / «N дн», rounded up, at least 1 minute. */
export const leftT = (ms: number): string => { const m = Math.max(1, Math.ceil(ms / 60000)); return m < 60 ? `${m} мин` : m < 1440 ? `${Math.ceil(m / 60)} ч` : `${Math.ceil(m / 1440)} дн`; };
export const roleOf = (v: unknown): ModRole => (v === 'own' || v === 'mod' ? v : null);
export const errText = (r: any, dflt = 'не вышло'): string => (r && (CHAT_ERR[r.error] || r.error)) || dflt;
/** Role icon HTML before a nick (site chatLi `role`). */
export const roleIco = (r: unknown): string => { const ri = ROLE_ICO[String(r || '')]; return ri ? `<i class="l3d-cr" title="${ri[1]}" aria-label="${ri[1]}">${ri[0]}</i>` : ''; };

/** site canMod(): not DMs, not myself; a moderator — not the owner nor other moderators (the server checks too). */
export function canMod(role: ModRole, me: string, m: ModLine): boolean {
  return !!role && m.k !== 'dm' && String(m.l || '').toLowerCase() !== String(me || '').toLowerCase() && (role === 'own' || !m.r);
}

/** Body of POST <base>/mod — site chatAct(): `{ op, id: o.id, login: o.login, min: o.min }` (JSON drops the undefined keys). */
export const modBody = (op: ModOp, o: ModArgs) => ({ op, id: o.id, login: o.login, min: o.min });
/** Path of the moderation endpoint (GET = window, POST = action). */
export const modPath = (base: string, q = '') => base + '/mod' + q;

export interface MenuItem { op: ModOp; label: string; mute?: boolean; bad?: boolean; args: ModArgs }
/** The «⋯» menu of a line, in the site's order (chatLi): Удалить · Мут × MUTES · Бан · (own) Сделать / Снять модератора. */
export function modMenu(role: ModRole, m: ModLine): MenuItem[] {
  const nm = m.n || m.l, out: MenuItem[] = [{ op: 'del', label: 'Удалить', args: { id: m.id } }];
  for (const [k, t] of MUTES) out.push({ op: 'mute', label: t, mute: true, args: { login: m.l, n: nm, min: k } });
  out.push({ op: 'ban', label: 'Бан', bad: true, args: { login: m.l, n: nm } });
  if (role === 'own') {
    if (m.r === 'mod') out.push({ op: 'unmod', label: 'Снять модератора', args: { login: m.l, n: nm } });
    else if (!m.r) out.push({ op: 'mod', label: 'Сделать модератором', args: { login: m.l, n: nm } });
  }
  return out;
}

/** Status line after a successful action (site chatAct). */
export function doneText(op: ModOp, o: ModArgs): string {
  const who = o.n || o.login || '';
  const mt = (MUTES.find((x) => x[0] === o.min) || [0, leftT((o.min || 0) * 60000)])[1];
  return ({ del: 'Сообщение удалено', mute: `${who}: мут ${mt}`, ban: `${who}: бан в чате`, unban: `${who}: снова может писать`, mod: `${who} — модератор чата`, unmod: `${who} больше не модератор` } as Record<ModOp, string>)[op] || 'Готово';
}

/** What a typed «/…» line means (site chatCmd, without the side effects). */
export type CmdPlan = { err: string } | { sys: string } | { mods: true } | { act: ModOp; args: ModArgs };
export function planCmd(text: string, role: ModRole): CmdPlan {
  const [cmd0, nick0, arg] = String(text).slice(1).trim().split(/\s+/), cmd = String(cmd0 || '').toLowerCase(), nick = String(nick0 || '').replace(/^@/, '').toLowerCase();
  if (!role) return { err: 'команды — только модераторам чата' };
  const own = role === 'own', bad = !/^[a-z0-9_]{1,25}$/.test(nick), needNick = { err: `укажи ник: /${cmd} ник` };
  if (cmd === 'help' || cmd === 'помощь') return { sys: own ? `Команды: /mod ник · /unmod ник · /mods · ${CHAT_HELP}` : `Команды: ${CHAT_HELP}` };
  if (cmd === 'mods') return own ? { mods: true } : { err: 'список модераторов — у админа чата' };
  if (cmd === 'mod' || cmd === 'unmod') { if (!own) return { err: 'назначать модераторов может только админ чата' }; if (bad) return needNick; return { act: cmd, args: { login: nick, n: nick } }; }
  if (cmd === 'mute') { if (bad) return needNick; const m = arg == null ? 30 : Math.round(+arg); if (!(m >= 1 && m <= 10080)) return { err: 'срок мута — от 1 до 10080 минут (7 дней)' }; return { act: 'mute', args: { login: nick, n: nick, min: m } }; }
  if (cmd === 'ban' || cmd === 'unban') { if (bad) return needNick; return { act: cmd, args: { login: nick, n: nick, sure: cmd === 'ban' } }; }
  return { err: `нет такой команды: /${cmd}. Список — /help` };
}
/** /mods answer line (site). */
export const modsLine = (mods: readonly string[]) => (mods.length ? `Модераторы чата (${mods.length}): ${mods.join(', ')}` : 'Модераторов чата пока нет. Назначить: /mod ник');

/** Moderation role + own mute of one chat, fed from the same sources the site reads (enter / chatMe / the window). */
export class ModState {
  role: ModRole = null;
  muted: Muted | null = null;
  /** Chat state of enter (city enter, mine `mchat`): site chatEnter. */
  enter(r: any): void { if (!r) return; this.role = roleOf(r.mod); this.muted = r.muted || null; }
  /** Addressed live `chatMe` (site chatApply): returns the notice to show, if any. */
  me(d: any, now = Date.now()): string | null {
    if (!d || typeof d !== 'object') return null;
    let note: string | null = null;
    if ('muted' in d) { this.muted = d.muted || null; if (this.muted) note = this.muted.until ? `Модератор запретил тебе писать на ${leftT(this.muted.until - now)}` : 'Модератор запретил тебе писать в чат'; }
    if ('mod' in d && this.role !== 'own') this.role = roleOf(d.mod);
    return note;
  }
  /** GET <base>/mod answered: the role it reports wins (site chatPanel). */
  panel(r: any): void { if (r && (r.role === 'own' || r.role === 'mod')) this.role = r.role; }
  /** A send was refused with «…запретил…» (site chatSend). */
  refused(): void { this.muted = this.muted || { until: 0 }; }
  /** Still muted (an expired mute clears itself). */
  isMuted(now = Date.now()): boolean { if (this.muted && this.muted.until && this.muted.until <= now) this.muted = null; return !!this.muted; }
  /** Placeholder of the disabled field while muted (site chatRender), or null. */
  placeholder(now = Date.now()): string | null {
    if (!this.isMuted(now)) return null;
    return this.muted!.until ? `Мут ещё ${leftT(this.muted!.until - now)}` : 'Модератор запретил тебе писать';
  }
}

export type ModApi = (path: string, body?: unknown) => Promise<any>;

/** What the feed does with the outcome of an action (site chatAct): remove lines, re-role a login, a status line. */
export interface ModFeed {
  remove(ids: string[]): void;
  setRole(login: string, r: 'mod' | undefined): void;
  note(text: string, ok?: boolean): void;
  sys(text: string): void;
}

/** One chat's moderation: state + requests + commands (no DOM). */
export class Moderator {
  readonly st = new ModState();
  constructor(readonly base: string, readonly q: string, private api: ModApi, private feed: ModFeed) {}
  get role(): ModRole { return this.st.role; }
  /** GET <base>/mod<q> */
  async info(): Promise<any> { const r = await this.api(modPath(this.base, this.q)); if (r && r.ok) this.st.panel(r); return r; }
  /** POST <base>/mod<q> { op, id, login, min } and apply the answer like the site. `sure` = the ban was confirmed. */
  async act(op: ModOp, o: ModArgs): Promise<boolean> {
    const r = await this.api(modPath(this.base, this.q), modBody(op, o));
    if (!r || !r.ok) { this.feed.note(errText(r), false); return false; }
    const gone: string[] = [];
    if (op === 'del' && r.id) gone.push(String(r.id));
    if (Array.isArray(r.gone)) for (const id of r.gone) gone.push(String(id));
    if (gone.length) this.feed.remove(gone);
    if ((op === 'mod' || op === 'unmod') && r.login) this.feed.setRole(String(r.login), op === 'mod' ? 'mod' : undefined);
    this.feed.note(doneText(op, o), true);
    return true;
  }
  /** A typed «/…» line (true = handled successfully, clear the field). Never posts the line to the feed. */
  async cmd(text: string): Promise<boolean> {
    const p = planCmd(text, this.st.role);
    if ('err' in p) { this.feed.note(p.err, false); return false; }
    if ('sys' in p) { this.feed.sys(p.sys); return true; }
    if ('mods' in p) {
      const r = await this.api(modPath(this.base, this.q));
      if (!r || !r.ok) { this.feed.note(errText(r), false); return false; }
      this.feed.sys(modsLine(r.mods || [])); return true;
    }
    return this.act(p.act, p.args);
  }
}

/* ================================================================ UI: menu + window (Shadow DOM) */

const CSS = `
:host { all: initial; }
.pop { position: fixed; z-index: 1; min-width: 190px; max-width: min(340px, calc(100vw - 16px)); padding: 6px; border-radius: 14px;
  background: #1b1320; box-shadow: 0 0 0 1.5px #ffcf6a66, 0 14px 34px #000a; color: #f7eadf;
  font: 600 13px/1.3 'Nunito', 'Golos Text', 'Segoe UI', sans-serif; text-shadow: none; box-sizing: border-box; }
.pop * { box-sizing: border-box; }
.hd { padding: 4px 8px 6px; color: #ffcf6a; font: 800 12px/1.2 'Nunito', sans-serif; letter-spacing: .02em; overflow-wrap: anywhere; }
.pop button { font: inherit; color: inherit; cursor: pointer; }
.it { display: flex; width: 100%; align-items: center; gap: 6px; min-height: 30px; padding: 0 10px; border: 0; border-radius: 9px; background: transparent; text-align: left; }
.it:hover, .it:focus-visible { background: #ffcf6a26; outline: 0; }
.it:focus-visible { box-shadow: inset 0 0 0 2px #ffcf6a; }
.it.bad { color: #ffb0a6; }
.it.arm { background: #ff5a5a33; color: #ffd0ca; }
.mt { display: flex; flex-wrap: wrap; align-items: center; gap: 4px; padding: 4px 6px 6px 10px; color: #bfaab7; font-size: 12px; }
.mt .it { color: #f7eadf; width: auto; min-height: 26px; padding: 0 8px; border: 1px solid #ffcf6a40; }
.sep { height: 1px; margin: 4px 6px; background: #ffcf6a2a; }
.panel { width: 330px; max-height: min(440px, calc(100vh - 32px)); overflow-y: auto; padding: 10px 12px 12px; overscroll-behavior: contain; }
.panel h4 { margin: 12px 0 5px; color: #bfaab7; font: 800 11px/1.2 'Nunito', sans-serif; letter-spacing: .06em; text-transform: uppercase; }
.panel .ttl { display: flex; align-items: center; gap: 8px; color: #ffcf6a; font: 800 13px/1.2 'Comfortaa', 'Nunito', sans-serif; }
.panel .ttl .x { margin-left: auto; width: 26px; height: 26px; border: 0; border-radius: 8px; background: #ffffff14; }
.panel ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 4px; }
.panel li { display: flex; align-items: center; gap: 6px; min-height: 30px; }
.panel li b { color: #ffcf6a; }
.panel li span { flex: 1; min-width: 0; color: #bfaab7; font-size: 12px; overflow-wrap: anywhere; }
.panel li button, .panel .pb { margin-left: auto; flex: none; min-height: 28px; min-width: 28px; padding: 0 9px; border: 1px solid #ffcf6a55; border-radius: 8px; background: transparent; }
.panel li button:hover, .panel .pb:hover, .panel li button:focus-visible, .panel .pb:focus-visible { background: #ffcf6a26; outline: 0; }
.panel .pl { color: #bfaab7; font-size: 12px; }
.panel form { display: flex; gap: 6px; margin-top: 8px; }
.panel input, .panel select { min-width: 0; height: 32px; padding: 0 9px; border: 0; border-radius: 9px; background: rgba(29,22,32,.94); box-shadow: 0 0 0 1px #ffcf6a47; color: #f7eadf; font: 600 13px/1 'Nunito', sans-serif; }
.panel input { flex: 1; } .panel select { flex: none; } .panel select option { color: #15122e; }
.panel input:focus, .panel select:focus { outline: 0; box-shadow: 0 0 0 2px #ffcf6a; }
.panel form button { flex: none; height: 32px; padding: 0 12px; border: 0; border-radius: 9px; background: #ffcf6a; color: #2a1d18; font-weight: 800; }
.panel form button.arm { background: #ff7b6b; }
.panel .pb { display: block; margin: 12px 0 0; width: 100%; }
.st { min-height: 16px; margin-top: 8px; font-size: 12px; color: #ffb0a6; }
.st.ok { color: #8fe39a; }
@media (prefers-reduced-motion: no-preference) { .pop { animation: pin .14s ease-out; } @keyframes pin { from { opacity: 0; transform: translateY(4px); } } }
`;

export interface UiItem { label: string; bad?: boolean; mute?: boolean; confirm?: string; run(): void | Promise<unknown> }
export interface PanelOpts {
  title: string;
  load(): Promise<any>;
  act(op: ModOp, o: ModArgs): Promise<boolean>;
}

/** One popup at a time (a «⋯» menu or the ⚙ window) in its own Shadow DOM host on <body>. */
export class ModUi {
  /** id of the host element (the dock treats focus inside it as «still in the chat»). */
  static readonly HOST_ID = 'l3d-chatmod';
  private host: HTMLElement | null = null;
  private root: ShadowRoot | null = null;
  private pop: HTMLElement | null = null;
  private from: HTMLElement | null = null;
  private offs: (() => void)[] = [];
  private closedFrom: { el: HTMLElement | null; at: number } = { el: null, at: 0 };
  /** 'menu' | 'panel' | null */
  kind: 'menu' | 'panel' | null = null;
  onChange: ((open: boolean) => void) | null = null;
  constructor(private input: () => ModalInput | null | undefined) {}

  get open(): boolean { return !!this.pop; }
  /** The anchor was the one whose popup a click outside just closed (the same click must not reopen it). */
  justClosed(el: HTMLElement): boolean { return this.closedFrom.el === el && performance.now() - this.closedFrom.at < 400; }

  private ensure(): ShadowRoot {
    if (this.root && this.host && this.host.isConnected) return this.root;
    const host = document.createElement('div'); host.id = ModUi.HOST_ID;
    host.style.cssText = 'position:fixed;left:0;top:0;width:0;height:0;z-index:2147483000;';
    const root = host.attachShadow({ mode: 'open' });
    const st = document.createElement('style'); st.textContent = CSS; root.appendChild(st);
    // typing in the window / arrows in the menu never reach the game (its key handlers listen on window)
    for (const t of ['keydown', 'keyup', 'keypress'] as const) host.addEventListener(t, (e) => { if (t === 'keydown') this.onKey(e as KeyboardEvent); e.stopPropagation(); });
    host.addEventListener('wheel', (e) => e.stopPropagation(), { passive: true });
    document.body.appendChild(host);
    this.host = host; this.root = root;
    return root;
  }

  private show(kind: 'menu' | 'panel', pop: HTMLElement, from: HTMLElement | null, at: DOMRect) {
    this.close();
    const root = this.ensure();
    this.kind = kind; this.pop = pop; this.from = from;
    pop.style.visibility = 'hidden';
    root.appendChild(pop);
    this.place(at);
    pop.style.visibility = '';
    setModal(this.input(), 'chat:mod', true, () => this.close(true));
    const out = (e: Event) => {
      const path = typeof e.composedPath === 'function' ? e.composedPath() : [];
      if (this.host && path.includes(this.host)) return;
      this.closedFrom = { el: this.from, at: performance.now() };
      this.close();
    };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape' && this.pop) { e.preventDefault(); e.stopImmediatePropagation(); this.close(true); } };
    const t = setTimeout(() => { if (this.pop === pop) document.addEventListener('pointerdown', out, true); }, 0);
    document.addEventListener('keydown', esc, true);
    const re = () => this.close();
    window.addEventListener('resize', re);
    this.offs.push(() => { clearTimeout(t); document.removeEventListener('pointerdown', out, true); document.removeEventListener('keydown', esc, true); window.removeEventListener('resize', re); });
    this.onChange?.(true);
  }

  /** Place the popup next to `at` (menu: under / above the anchor, right-aligned; window: beside the chat box), inside the viewport. */
  private place(at: DOMRect) {
    const p = this.pop!, w = p.offsetWidth, hgt = p.offsetHeight, vw = window.innerWidth, vh = window.innerHeight;
    let x: number, y: number;
    if (this.kind === 'menu') {
      // beside the «⋯» (the chat sits bottom-left: the lines above stay visible), bottom-aligned with its line;
      // no room on the right → under / above the anchor, right-aligned
      x = at.right + 16; y = at.bottom - hgt + 6;
      if (x + w > vw - 8) { x = at.right - w; y = at.bottom + 4; if (y + hgt > vh - 8) y = at.top - hgt - 4; }
    } else {
      x = at.right + 14; y = at.bottom - hgt;
      if (x + w > vw - 8) { x = at.left; y = at.top - hgt - 10; }
    }
    x = Math.max(8, Math.min(x, vw - w - 8)); y = Math.max(8, Math.min(y, vh - hgt - 8));
    p.style.left = Math.round(x) + 'px'; p.style.top = Math.round(y) + 'px';
  }

  private buttons(): HTMLElement[] { return this.pop ? [...this.pop.querySelectorAll<HTMLElement>('button,input,select')].filter((b) => !(b as HTMLButtonElement).disabled) : []; }
  private onKey(e: KeyboardEvent) {
    if (!this.pop) return;
    const bs = this.buttons(), a = this.root!.activeElement as HTMLElement | null, i = a ? bs.indexOf(a) : -1;
    if (e.key === 'Escape') { e.preventDefault(); this.close(true); return; }
    if (this.kind === 'menu' && (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'ArrowRight' || e.key === 'ArrowLeft')) {
      e.preventDefault(); if (!bs.length) return;
      const d = e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : bs.length - 1;
      bs[(i + d + bs.length) % bs.length].focus(); return;
    }
    if (this.kind === 'menu' && (e.key === 'Home' || e.key === 'End')) { e.preventDefault(); bs[e.key === 'Home' ? 0 : bs.length - 1]?.focus(); return; }
    if (e.key === 'Tab') {
      if (this.kind === 'menu') { this.close(true); e.preventDefault(); return; }   // site nick menu: Tab leaves it
      if (!bs.length) return;
      e.preventDefault(); bs[(i + (e.shiftKey ? bs.length - 1 : 1) + bs.length) % bs.length].focus();   // window: focus stays inside
    }
  }

  /** Close the popup (back = return the focus to what opened it). */
  close(back = false) {
    if (!this.pop) return;
    const from = this.from;
    for (const f of this.offs.splice(0)) f();
    this.pop.remove(); this.pop = null; this.from = null; this.kind = null;
    setModal(this.input(), 'chat:mod', false);
    if (back && from && from.isConnected) try { from.focus({ preventScroll: true }); } catch { /* */ }
    this.onChange?.(false);
  }

  dispose() { this.close(); this.host?.remove(); this.host = null; this.root = null; }

  /** «⋯» menu: a header (the nick), the items; a `confirm` item needs a second press (ban). */
  /** `kind` names the menu for screen readers: «Модерация» (the «⋯» of a line) or «Ник» (the nick menu of the mine tab). */
  menu(from: HTMLElement, title: string, items: UiItem[], kind = 'Модерация') {
    if (this.justClosed(from)) return;
    const pop = document.createElement('div'); pop.className = 'pop'; pop.setAttribute('role', 'menu'); pop.setAttribute('aria-label', `${kind}: ${title}`);
    pop.innerHTML = `<div class="hd">${esc(title)}</div>`;
    let mt: HTMLElement | null = null;
    for (const it of items) {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'it' + (it.bad ? ' bad' : ''); b.setAttribute('role', 'menuitem'); b.textContent = it.label;
      if (it.mute) {
        if (!mt) { mt = document.createElement('div'); mt.className = 'mt'; mt.setAttribute('role', 'group'); mt.setAttribute('aria-label', 'Мут'); mt.textContent = 'Мут:'; pop.appendChild(mt); }
        b.setAttribute('aria-label', `Мут ${it.label}`); mt.appendChild(b);
      } else { if (mt) { mt = null; } pop.appendChild(b); }
      let armed = 0;
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        if (it.confirm && (!armed || performance.now() - armed > 4000)) { armed = performance.now(); b.textContent = it.confirm; b.classList.add('arm'); return; }
        this.close(true);
        void Promise.resolve().then(() => it.run()).catch((err) => console.error('[l3d] chat mod', err));
      });
    }
    this.show('menu', pop, from, from.getBoundingClientRect());
    try { pop.querySelector<HTMLElement>('.it')?.focus({ preventScroll: true }); } catch { /* */ }
  }

  /** ⚙ window: GET the state, render the site's sections; actions reload it (site chatPanel). */
  panel(from: HTMLElement | null, anchor: HTMLElement, o: PanelOpts) {
    if (from && this.justClosed(from)) return;
    if (this.kind === 'panel') { this.close(true); return; }
    const pop = document.createElement('div'); pop.className = 'pop panel'; pop.setAttribute('role', 'dialog'); pop.setAttribute('aria-label', o.title);
    this.show('panel', pop, from, anchor.getBoundingClientRect());
    const head = `<div class="ttl"><span>⚙︎ ${esc(o.title)}</span><button type="button" class="x" data-close aria-label="Закрыть">✕</button></div>`;
    const status = (t: string, ok = false) => { const s = pop.querySelector('.st'); if (s) { s.textContent = t; s.classList.toggle('ok', ok); } };
    const render = async (note?: [string, boolean]) => {
      if (this.pop !== pop) return;
      if (!pop.childElementCount) { pop.innerHTML = head + '<p class="pl">Загружаю…</p>'; this.place(anchor.getBoundingClientRect()); }
      const r = await o.load();
      if (this.pop !== pop) return;
      if (!r || !r.ok) { pop.innerHTML = head + `<p class="pl">${esc(errText(r, 'не загрузилось'))}</p><button type="button" class="pb" data-close>← К чату</button>`; this.place(anchor.getBoundingClientRect()); return; }
      const hm = (t: number) => { const d = new Date(t); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
      const now = Date.now();
      const bans = (r.bans || []).map((x: any) => `<li><b>${esc(x.l)}</b> <span>${x.until ? `мут до ${esc(hm(x.until))}${x.until - now > 864e5 ? ` (${leftT(x.until - now)})` : ''}` : 'бан'}${x.by ? ` · ${esc(x.by)}` : ''}</span><button type="button" data-op="unban" data-l="${esc(x.l)}">Снять</button></li>`).join('');
      const mods = r.role === 'own' ? `<h4>Модераторы чата</h4><ul>${(r.mods || []).map((x: string) => `<li><b>${esc(x)}</b><span></span><button type="button" data-op="unmod" data-l="${esc(x)}" aria-label="Снять модератора ${esc(x)}">×</button></li>`).join('') || '<li class="pl">Пока никого. Модераторы канала на платформе — тоже модераторы чата.</li>'}</ul>
        <form data-pmod><input type="text" maxlength="26" placeholder="ник модератора" aria-label="Ник нового модератора" autocomplete="off" spellcheck="false"><button type="submit">Добавить</button></form>` : '';
      pop.innerHTML = head + `<form data-pban><input type="text" maxlength="26" placeholder="ник" aria-label="Ник, кого ограничить" autocomplete="off" spellcheck="false"><select aria-label="Срок">${MUTES.map(([k, t]) => `<option value="${k}">мут ${t}</option>`).join('')}<option value="ban">бан</option></select><button type="submit">Ок</button></form>
        <h4>Мут и бан</h4><ul>${bans || '<li class="pl">Никто не ограничен.</li>'}</ul>${mods}<p class="st" role="status"></p>
        <button type="button" class="pb" data-close>← К чату</button>`;
      if (note) status(note[0], note[1]);
      this.place(anchor.getBoundingClientRect());
    };
    const run = async (op: ModOp, a: ModArgs) => {
      const ok = await o.act(op, a);
      if (this.pop === pop) await render(ok ? [doneText(op, a), true] : undefined);
      return ok;
    };
    pop.addEventListener('click', (e) => {
      const t = e.target as HTMLElement;
      if (t.closest('[data-close]')) { this.close(true); return; }
      const b = t.closest<HTMLElement>('[data-op]');
      if (b) void run(b.dataset.op as ModOp, { login: b.dataset.l, n: b.dataset.l });
    });
    let armed = 0;
    pop.addEventListener('submit', (e) => {
      e.preventDefault();
      const fm = e.target as HTMLFormElement, inp = fm.querySelector('input') as HTMLInputElement;
      const nick = (inp.value || '').trim().replace(/^@/, '').toLowerCase(); if (!nick) return;
      if (fm.hasAttribute('data-pmod')) { void run('mod', { login: nick, n: nick }); return; }
      const v = (fm.querySelector('select') as HTMLSelectElement).value, btn = fm.querySelector('button') as HTMLButtonElement;
      if (v === 'ban' && (!armed || performance.now() - armed > 4000)) { armed = performance.now(); btn.textContent = 'Точно?'; btn.classList.add('arm'); return; }   // site: confirm()
      void run(v === 'ban' ? 'ban' : 'mute', { login: nick, n: nick, min: +v || undefined, sure: v === 'ban' });
    });
    pop.addEventListener('change', (e) => { const s = e.target as HTMLElement; if (s.tagName === 'SELECT') { armed = 0; const btn = s.parentElement?.querySelector('button'); if (btn) { btn.textContent = 'Ок'; btn.classList.remove('arm'); } } });
    void render().then(() => { if (this.pop === pop) try { pop.querySelector<HTMLElement>('input')?.focus({ preventScroll: true }); } catch { /* */ } });
  }
}

/** Items of the «⋯» menu for a line, wired to a Moderator (ban: a second press confirms — site confirm()). */
export function menuItems(mod: Moderator, m: ModLine): UiItem[] {
  return modMenu(mod.role, m).map((it) => ({
    label: it.label, bad: it.bad, mute: it.mute,
    confirm: it.op === 'ban' ? `Точно забанить ${it.args.n || it.args.login}?` : undefined,
    run: () => mod.act(it.op, it.op === 'ban' ? { ...it.args, sure: true } : it.args),
  }));
}
