/**
 * Who may put the keyboard into the chat (0.6.2 focus races).
 *
 * The chat field may get the focus only from the player: T / Enter / '/' (Chat.focus), a click or a tap into the chat,
 * Tab navigation. Everything else that focuses it while the game owns the input (pointer locked, or gameplay on with no
 * menu) is undone at once — the site's code does that a lot behind our 3D:
 *  - its City re-docks the single chat window (heroChanged → chatInit → LGChatOne.dock('city')) after every «me», and
 *    the window's tab switch («Город» / «Шахта») focuses the field (site-chat.js chatTab / chatOpen);
 *  - its windows give the focus back on close to whatever had it when they opened (mine.js shut → from.focus(), news,
 *    start, cityshop, hwnpc…) — often the chat field of a minute ago.
 * Pure state + tiny DOM helpers: the timing is a parameter, so tests drive it.
 */

/** A focus within this long after the player's own action is theirs (the site's open/tab code focuses synchronously). */
export const INTENT_MS = 800;

export class ChatFocusGuard {
  private at = -1e9;
  constructor(private now: () => number = () => (typeof performance !== 'undefined' ? performance.now() : Date.now()), private ms = INTENT_MS) {}
  /** The player asked for the chat (key, click, Tab). */
  intent(): void { this.at = this.now(); }
  /** Was there a player action into the chat just now? */
  fresh(): boolean { return this.now() - this.at <= this.ms; }
  /** Focus arrived in the chat: keep it (true) or undo it (false). `gameOwns`: the game has the mouse / keyboard. */
  allow(gameOwns: boolean): boolean { return !gameOwns || this.fresh(); }
}

/** The game owns the input: the pointer is locked, or gameplay runs with no menu open over it. */
export function gameOwnsInput(input: { gameplay: boolean }, menuOpen: boolean, doc: { pointerLockElement: Element | null } | null): boolean {
  return !!(doc && doc.pointerLockElement) || (input.gameplay && !menuOpen);
}

/** The event's real target (through shadow roots). */
export function evTarget(e: Event): Element | null {
  const p = typeof e.composedPath === 'function' ? e.composedPath() : [];
  const t = (p[0] || e.target) as Element | null;
  return t && typeof (t as Element).closest === 'function' ? t : null;
}
