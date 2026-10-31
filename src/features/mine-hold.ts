/**
 * F8 inside the mine: 2D ⇄ 3D without leaving it.
 *
 *  - 3D starts (or comes back with F8) while the site's own 2D mine is open → the 3D mine opens on the same floor (the
 *    floor key the site's mine polls, src/net/site-mine.ts); the site's mine stays open, hidden under it. One mine enter
 *    (ours) — no City request: the City sleeps under the mine and is not touched.
 *  - F8 out of the 3D mine → the 3D is hidden and paused (classic.ts: no frames) and its client holds (no polls, pings, no
 *    leave); the site's 2D mine is shown and takes the presence back with its own «Копать здесь» (one enter, the site's).
 *    A 3D mine entered from the 3D street (the site's mine not open, the City live): the site's mine is opened the way a
 *    click on it does (LGCity.panel('mine'): the site's city leave + mine enter).
 *  - F8 back → the site's mine is hidden again; our client enters again only if the site's mine entered meanwhile; on
 *    another floor (the site rode the lift) → that floor. The site left its mine meanwhile («В город» in 2D) → the 3D
 *    mine is closed without a request (the site already sent the leave and woke the City) and the 3D street shows.
 *  - Walking out of the 3D mine → the site's own «В город» (src/rooms/mine dispose → exitSiteMine).
 * A site panel asked for from the 3D menus (reason 'panel') keeps the site's mine hidden: the panel is what the player wants.
 */
import type { Unsub } from '../contracts';
import type { CoreContext } from '../core/context';
import { coreFeature } from './types';
import { VIEW_EVENT } from './classic';
import { wantMineKey, type MineHold } from '../rooms/mine';
import { setMineSwitching, siteMineOpen, siteMineKey, holdSiteMine, showSiteMine, openSiteMine, mineReqLog, heldSiteKey, setHeldSiteKey, cityLive } from '../net/site-mine';

export interface MineHoldDeps {
  open(): boolean;
  /** The site's mine floor key from its requests at/after `since` (performance.now() ms). */
  key(since?: number): string | null;
  /** Did the site's mine send an enter at/after `since`? */
  enteredSince(since: number): boolean;
  hide(key?: string | null): void;
  /** Show the site's mine and let it take the presence back; returns the stop function of that watch. */
  show(): () => void;
  /** Open the site's mine from its live City (false: impossible now). */
  openFromCity(key: string): boolean;
  cityLive(): boolean;
  heldKey(): string | null;
  setHeldKey(k: string | null): void;
  now(): number;
  setTimeout(fn: () => void, ms: number): unknown;
}

const DEFAULT_DEPS: MineHoldDeps = {
  open: () => siteMineOpen(),
  key: (since) => siteMineKey(since),
  enteredSince: (since) => mineReqLog().enteredSince(since),
  hide: (key) => holdSiteMine(true, key),
  show: () => showSiteMine(),
  openFromCity: (key) => openSiteMine(key),
  cityLive: () => cityLive(),
  heldKey: () => heldSiteKey(),
  setHeldKey: (k) => setHeldSiteKey(k),
  now: () => performance.now(),
  setTimeout: (fn, ms) => window.setTimeout(fn, ms),
};

/** Tries to open the 3D mine this long while the city layout is still being built (ms). */
export const ENTER_TRY_MS = 15000;

export function startMineHold(ctx: CoreContext, deps: Partial<MineHoldDeps> = {}): Unsub {
  const D: MineHoldDeps = { ...DEFAULT_DEPS, ...deps };
  let disposed = false;
  let heldAt = -Infinity;          // performance.now() when the 3D mine went behind the classic site
  let stopShow: (() => void) | null = null;
  let entering = false;

  const holdOf = (): MineHold | null => {
    if (ctx.rooms.kind !== 'mine3d') return null;
    const h = (ctx.rooms.scene as { hold?: MineHold } | null)?.hold;
    return h && typeof h.suspend === 'function' ? h : null;
  };

  /** Open the 3D mine on `key` over the site's mine (kept open, hidden). */
  const enterMine3d = async (key: string | null) => {
    if (entering || disposed) return;
    entering = true; setMineSwitching(true);
    try {
      D.hide(key);
      const t0 = D.now();
      while (!disposed && !ctx.game.classic && D.open() && ctx.rooms.kind !== 'mine3d') {
        if (ctx.rooms.current) ctx.rooms.exit();
        wantMineKey(key);
        try { await ctx.rooms.enter('mine'); } catch (e) { console.warn('[l3d] mine-hold: enter', e); }
        wantMineKey(null);
        if (ctx.rooms.kind === 'mine3d' || D.now() - t0 > ENTER_TRY_MS) break;
        await new Promise<void>((r) => { D.setTimeout(r, 700); });   // the layout (the mine building) may not be there yet
      }
      if (!disposed && ctx.rooms.kind !== 'mine3d' && D.open() && !ctx.game.classic) {
        // the 3D mine could not open: the site's mine is what the player sees — the classic site, honestly
        console.warn('[l3d] mine-hold: the 3D mine did not open, back to the site\'s mine');
        ctx.game.toClassic();
      }
    } finally { entering = false; setMineSwitching(false); }
  };

  const onView = (e: Event) => {
    if (disposed) return;
    const d = (e as CustomEvent<{ classic?: boolean; reason?: string }>).detail || {};
    const h = holdOf();
    if (d.classic) {
      if (!h) return;
      heldAt = D.now();
      h.suspend();
      if (d.reason === 'panel') return;   // a site panel was asked for: the site's mine (if any) stays hidden
      if (D.open()) { stopShow?.(); stopShow = D.show(); }
      else if (D.cityLive()) D.openFromCity(h.key());
      return;
    }
    // back to 3D
    stopShow?.(); stopShow = null;
    if (D.open()) {
      const siteKey = D.key(heldAt) ?? D.heldKey();
      D.hide(siteKey);
      if (h) h.resume(siteKey, D.enteredSince(heldAt));
      else void enterMine3d(siteKey ?? D.key());   // the site's mine was opened in 2D meanwhile
    } else if (h) {
      // the site's mine is not open: it was (the hold showed / opened it) and left it — the site changed scene
      if (D.key(heldAt) != null || D.enteredSince(heldAt) || D.heldKey() != null) { h.release(); D.setHeldKey(null); ctx.rooms.exit(); }
      else h.resume(null, false);   // nothing happened in 2D (e.g. the City could not open the site's mine): carry on
    }
    heldAt = -Infinity;
  };

  window.addEventListener(VIEW_EVENT, onView);
  // 3D started inside the site's own 2D mine (F8 there): the same floor in 3D
  // (after the remaining features are set up: rooms.onChange listeners must see the room open)
  if (D.open()) D.setTimeout(() => { if (!disposed && D.open() && !ctx.game.classic) void enterMine3d(D.key()); }, 0);
  return () => { disposed = true; stopShow?.(); window.removeEventListener(VIEW_EVENT, onView); };
}

export default coreFeature({
  id: 'mineHold',
  order: 225,
  setup(ctx) { return startMineHold(ctx); },
});
