/**
 * «Только друзей» — the site's crowd filter (city.js, 29.10 «Показывать: друзей» in the crowd-size menu; 07.11 the eye button
 * `.cy-fro`). The site keeps it in localStorage `lgCityFr` = '1' (frGet / frSet) and, while it is on and the friends of
 * the site are loaded (window.LGFriends.friends — friends.js, cached 60 s: GET /api/friends, the site's own call), draws
 * only the walkers whose lowercase login is in that list (city.js lodPick: everybody else is culled). Until the first list
 * comes the set is empty — the site then shows nobody but the own hero; we do the same.
 *
 * FriendsOnly mirrors that for our 3D crowd: `allows(login)` per walker (cheap: a Set lookup), `tick(now)` at most once per
 * frame (re-reads the flag every 500 ms, refreshes the list every 60 s like city.js frLoad). No request of its own: the list
 * is the site's LGFriends.friends().
 */
export const FR_KEY = 'lgCityFr';
const FLAG_MS = 500, LIST_MS = 60_000;

export interface FriendsOnlyDeps {
  /** localStorage.getItem */
  get(k: string): string | null;
  /** window.LGFriends?.friends — null when the site did not start friends for this login */
  friends(): (() => Promise<unknown>) | null;
}
export const pageFriendsDeps = (): FriendsOnlyDeps => ({
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  friends: () => {
    const F = (window as unknown as { LGFriends?: { friends?: () => Promise<unknown> } }).LGFriends;
    return F && typeof F.friends === 'function' ? () => F.friends!() : null;
  },
});

export class FriendsOnly {
  private flagAt = -Infinity;
  private listAt = -Infinity;
  private flag = false;
  private set: Set<string> | null = null;
  private busy = false;
  /** bumps whenever on / the list changes (callers redo their culling then) */
  version = 0;
  constructor(private d: FriendsOnlyDeps) {}

  /** The filter is on: the site's flag and its friends module (city.js frOn = S.onlyFr && frOk()). */
  get on(): boolean { return this.flag; }

  tick(now: number): void {
    if (now - this.flagAt < FLAG_MS) return;
    this.flagAt = now;
    const fn = this.d.friends();
    const on = this.d.get(FR_KEY) === '1' && !!fn;
    if (on !== this.flag) { this.flag = on; this.version++; if (on) this.listAt = -Infinity; else this.set = null; }
    if (!on || !fn || this.busy || now - this.listAt < LIST_MS) return;
    this.listAt = now; this.busy = true;
    let p: Promise<unknown>;
    try { p = Promise.resolve(fn()); } catch { this.busy = false; return; }
    p.then((ls) => {
      if (!this.flag) return;
      this.set = new Set((Array.isArray(ls) ? ls : []).map((x) => String(x).toLowerCase()));
      this.version++;
    }, () => { /* the site logs it; keep the last list */ }).finally(() => { this.busy = false; });
  }

  /** May this walker be drawn? Everybody while off; while on only friends (nobody until the list came). */
  allows(login: string): boolean {
    if (!this.flag) return true;
    return !!this.set && this.set.has(login.toLowerCase());
  }
}

/** Flip «Только друзей» for the 3D crowd — the site's own key (city.js frSet). The site's City reads it again when it opens
 *  (S.onlyFr = frGet()); its `.cy-fro` button is not pressed: under the 3D the site's «others» are hidden (hideOthers), and
 *  the site's toggle would show its 2D crowd again (froToggle → setHidden(false)). Returns the new state. */
export function toggleFriendsOnly(d: Pick<FriendsOnlyDeps, 'get'> & { set(k: string, v: string | null): void }): boolean {
  const on = d.get(FR_KEY) !== '1';
  d.set(FR_KEY, on ? '1' : null);
  return on;
}
export const pageFrStore = {
  get: (k: string) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k: string, v: string | null) => { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* private mode */ } },
};
