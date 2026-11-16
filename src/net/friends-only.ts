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
 *
 * «Только гильдию» (site 16.11, city.js glGet / glSet, the eye menu's «Гильдию»): localStorage `lgCityGl` = '1'; the City starts
 * it only while «Только друзей» is off (S.onlyGl = !frGet() && glGet()) and it counts only when the hero has a guild tag and the
 * flag `hero.go` (glOk = glTag() && hero.go; glTag = hero.gt, else the own walker's gt). Then only the walkers whose tag `gt`
 * equals that tag are drawn (lodPick: the friends filter first, else the guild one). Tags are 3 latin letters (guilds.js), so
 * our nameplate tag (Appearance.guild, the first 5 chars) is the whole tag.
 */
export const FR_KEY = 'lgCityFr';
export const GL_KEY = 'lgCityGl';
const FLAG_MS = 500, LIST_MS = 60_000;

export interface FriendsOnlyDeps {
  /** localStorage.getItem */
  get(k: string): string | null;
  /** window.LGFriends?.friends — null when the site did not start friends for this login */
  friends(): (() => Promise<unknown>) | null;
  /** the own hero (store.hero): `gt` = the guild tag, `go` = «only the guild» is offered (site 16.11) */
  hero?(): { [k: string]: unknown } | null | undefined;
  /** the own walker's tag (Appearance.guild) when the hero has none */
  ownTag?(): string | null | undefined;
}
/** city.js glTag: the hero's tag, else the own walker's ('' = none). */
export function guildTagOf(d: Pick<FriendsOnlyDeps, 'hero' | 'ownTag'>): string {
  const h = d.hero?.();
  if (h && h.gt) return String(h.gt);
  const o = d.ownTag?.();
  return o ? String(o) : '';
}
/** city.js glOk: a tag and hero.go. */
export const guildOk = (d: Pick<FriendsOnlyDeps, 'hero' | 'ownTag'>): boolean => !!guildTagOf(d) && !!d.hero?.()?.go;
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
  private gl = '';           // «Только гильдию»: the tag shown ('' = off)
  private set: Set<string> | null = null;
  private busy = false;
  /** bumps whenever on / the list changes (callers redo their culling then) */
  version = 0;
  constructor(private d: FriendsOnlyDeps) {}

  /** The filter is on: the site's flag and its friends module (city.js frOn = S.onlyFr && frOk()). */
  get on(): boolean { return this.flag; }
  /** «Только гильдию» is on (city.js glOn): the tag, else ''. */
  get guild(): string { return this.gl; }

  tick(now: number): void {
    if (now - this.flagAt < FLAG_MS) return;
    this.flagAt = now;
    const fn = this.d.friends();
    const fr = this.d.get(FR_KEY) === '1';
    const on = fr && !!fn;
    if (on !== this.flag) { this.flag = on; this.version++; if (on) this.listAt = -Infinity; else this.set = null; }
    const gl = !fr && this.d.get(GL_KEY) === '1' && guildOk(this.d) ? guildTagOf(this.d) : '';
    if (gl !== this.gl) { this.gl = gl; this.version++; }
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

  /** May this walker be drawn? Everybody while off; «Только друзей»: only friends (nobody until the list came);
   *  «Только гильдию»: only the walkers with the hero's guild tag (`tag` = their Appearance.guild). */
  allows(login: string, tag?: string | null): boolean {
    if (this.flag) return !!this.set && this.set.has(login.toLowerCase());
    if (this.gl) return !!tag && String(tag) === this.gl;
    return true;
  }
}

/** Flip «Только друзей» for the 3D crowd — the site's own key (city.js frSet). The site's City reads it again when it opens
 *  (S.onlyFr = frGet()); its `.cy-fro` button is not pressed: under the 3D the site's «others» are hidden (hideOthers), and
 *  the site's toggle would show its 2D crowd again (froToggle → setHidden(false)). Returns the new state. */
export function toggleFriendsOnly(d: Pick<FriendsOnlyDeps, 'get'> & { set(k: string, v: string | null): void }): boolean {
  const on = d.get(FR_KEY) !== '1';
  d.set(FR_KEY, on ? '1' : null);
  if (on) d.set(GL_KEY, null);   // city.js capPick / froToggle: friends and guild are one choice
  return on;
}
/** Flip «Только гильдию» (city.js glSet; turning it on drops «Только друзей» like capPick 'gl'). Returns the new state. */
export function toggleGuildOnly(d: Pick<FriendsOnlyDeps, 'get'> & { set(k: string, v: string | null): void }): boolean {
  const on = !(d.get(GL_KEY) === '1' && d.get(FR_KEY) !== '1');
  d.set(GL_KEY, on ? '1' : null);
  if (on) d.set(FR_KEY, null);
  return on;
}
export const pageFrStore = {
  get: (k: string) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k: string, v: string | null) => { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* private mode */ } },
};
