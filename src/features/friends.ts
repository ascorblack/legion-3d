/**
 * Friends of the site (29.10, window.LGFriends of /site/friends.js) inside the 3D game.
 *
 * The site gives the hero a «Друзья» button in its header (hidden under the game) with the number of incoming requests, and
 * a window (Друзья N/100 · Заявки · Блок; the coin of the day) that it appends to <body>. This feature only brings them
 * into the 3D UI — every action in the window is the site's own code:
 *  - the pause-menu entry «Друзья» (and the chip below) call LGFriends.open();
 *  - the window `.fr-back` is lifted above our canvas and UI (CSS, html.l3d-on) and, while it is open, a modal is pushed on
 *    the input: the pointer is released, gameplay is off, Esc closes it (the «×» of the site's window);
 *  - a HUD chip «👥 Заявки в друзья · N» shows while N > 0 (N = the badge of the site's button, `#frBtn .fr-n`, read
 *    from the DOM twice a second; zero requests of our own) and opens the same window.
 * Nothing is sent from here: friends, requests, blocks and the coin are the site's buttons, pressed by the player.
 * Without LGFriends (the server did not open friends for this login) the feature is silent.
 */
import type { Unsub } from '../contracts';
import type { CoreContext } from '../core/context';
import { coreFeature } from './types';
import { registerPauseItem } from '../ui/settings-ext';
import { mountFriendsChip, type FriendsChip } from '../ui/friends-chip';
import { friendsApi, type FriendsApi } from '../ui/dm';
import { setModal, type ModalInput } from '../core/modal';

export const FRIENDS_CSS_ID = 'l3d-friends-css';
/** The site's friends window (z 120) goes above our canvas and UI layer (150), under its own toasts / nick menu (165+). */
export const FRIENDS_CSS = 'html.l3d-on .fr-back{z-index:170!important}';
export const MODAL_ID = 'site:friends';
const POLL_MS = 500;

/** Incoming requests from the badge of the site's button (`<b class="fr-n" hidden>2</b>`): 0 when hidden or not a number. */
export function badgeCount(btn: Element | null): number {
  const b = btn?.querySelector<HTMLElement>('.fr-n');
  if (!b || b.hidden) return 0;
  const t = (b.textContent || '').trim();
  const n = t === '99+' ? 99 : parseInt(t, 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export interface FriendsDeps {
  win: Window & typeof globalThis;
  doc: Document;
  api(): FriendsApi | null;
  hudParent(ctx: CoreContext): Element | null;
  mount(parent: Element, onOpen: () => void): FriendsChip;
  pollMs: number;
}
const resolveDeps = (d: Partial<FriendsDeps>): FriendsDeps => ({
  win: d.win ?? (window as Window & typeof globalThis),
  doc: d.doc ?? document,
  api: d.api ?? (() => friendsApi()),
  hudParent: d.hudParent ?? ((ctx) => ctx.uiRoot.querySelector('.l3d-ui')?.shadowRoot?.querySelector('.ui .hud') ?? null),
  mount: d.mount ?? mountFriendsChip,
  pollMs: d.pollMs ?? POLL_MS,
});

/** Start the feature; returns the dispose function. Exported for tests (fake LGFriends, fake chip). */
export function startFriends(ctx: CoreContext, deps: Partial<FriendsDeps> = {}): Unsub {
  const D = resolveDeps(deps);
  const input = () => ctx.input as unknown as ModalInput;
  const offs: Unsub[] = [];
  let photo = false, disposed = false, modal = false;

  const btn = () => D.doc.getElementById('frBtn');
  /** The site started its friends for this login (LGFriends loaded and its header button made). */
  const avail = (): boolean => !!D.api() && !!btn();
  const win = () => D.doc.querySelector<HTMLElement>('.fr-back');

  const open = (): boolean => {
    if (disposed || !avail()) return false;
    try { D.api()!.open(); } catch (e) { console.warn('[l3d] friends: open failed', e); return false; }
    sync();
    return true;
  };

  /** The site's window appeared / went: the modal on our input (pointer free, gameplay off, Esc closes). */
  function sync(): void {
    if (disposed) return;
    const on = !!win();
    if (on === modal) return;
    modal = on;
    setModal(input(), MODAL_ID, on, () => { D.doc.querySelector<HTMLElement>('.fr-back .fr-x')?.click(); });
  }

  if (!D.doc.getElementById(FRIENDS_CSS_ID)) {
    const st = D.doc.createElement('style'); st.id = FRIENDS_CSS_ID; st.textContent = FRIENDS_CSS; D.doc.head.appendChild(st);
    offs.push(() => st.remove());
  }

  const parent = D.hudParent(ctx);
  const chip = parent ? D.mount(parent, () => { open(); }) : null;
  const refresh = (): void => { if (!disposed) chip?.render(!photo && avail() ? badgeCount(btn()) : 0); };

  // the window is appended to <body> (or to the fullscreen element) by the site's layer(): watch the direct children
  let mo: MutationObserver | null = null;
  const observe = () => {
    mo?.disconnect();
    if (typeof MutationObserver !== 'function') return;
    mo = new MutationObserver(sync);
    mo.observe(D.doc.fullscreenElement || D.doc.body, { childList: true });
  };
  observe();
  D.doc.addEventListener('fullscreenchange', observe);
  const onPhoto = (e: Event) => { photo = !!(e as CustomEvent<{ on?: boolean }>).detail?.on; refresh(); };
  D.win.addEventListener('l3d:photo', onPhoto);
  const timer = D.win.setInterval(() => { refresh(); sync(); }, D.pollMs);
  offs.push(() => { mo?.disconnect(); D.doc.removeEventListener('fullscreenchange', observe); D.win.removeEventListener('l3d:photo', onPhoto); D.win.clearInterval(timer); });
  offs.push(registerPauseItem({ id: 'friends.open', label: 'Друзья', order: 27, enabled: avail, run: () => { open(); } }));
  refresh();

  return () => {
    disposed = true;
    for (const u of offs.reverse()) { try { u(); } catch { /* */ } }
    if (modal) { modal = false; setModal(input(), MODAL_ID, false); }
    chip?.dispose();
  };
}

export default coreFeature({
  id: 'friends',
  order: 230,
  setup(ctx) { return startFriends(ctx); },
});
