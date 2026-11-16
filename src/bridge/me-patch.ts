/**
 * Hero patches of the live link (site 15.11, /lib/site-live.js): over the WebSocket the hero comes as a full `me` with a
 * version `mv`, then as `mep` patches. A line-by-line port of the site's base keeping (meBase / meV / meWant) and of its
 * meApply, for the bridge (src/bridge/bridge.ts tapLiveWs). No DOM, no globals: importable by tests.
 */
/**
 * The hero base of one live socket, kept exactly like site-live.js (15.11):
 *  - `me` (full): base = the object (or null), v = its `mv` when a number, else null; want = false;
 *  - `mep`: ignored while want; a bad patch, no base, v null or `p.mv !== v + 1` → want = true (the site asks for a
 *    full one); else base = meApply(base, p), v = p.mv → the new full text.
 * `L.gap()` of the site (meV = -1e9) is not seen here: then the site asks for a full `me` while we go on applying the
 * same in-order patches, which gives the same base; the full `me` resets both.
 */
export class MeMirror {
  base: any = null;
  v: number | null = null;
  want = false;
  reset(): void { this.base = null; this.v = null; this.want = false; }
  full(text: string): void {
    let d: any = null;
    try { d = JSON.parse(text); } catch { d = null; }
    this.base = d && typeof d === 'object' ? d : null;
    this.v = this.base && typeof this.base.mv === 'number' ? this.base.mv : null;
    this.want = false;
  }
  /** The new full `me` text after a patch, or null (gap / waiting for a full one / bad patch). */
  patch(text: string): string | null {
    if (this.want) return null;
    let p: any = null;
    try { p = JSON.parse(text); } catch { p = null; }
    if (!p || !this.base || this.v === null || p.mv !== this.v + 1) { this.want = true; return null; }
    this.base = meApply(this.base, p); this.v = p.mv;
    return JSON.stringify(this.base);
  }
}

/** site-live.js meApply (15.11), the same steps: hero fields `h` merged, `hx` deleted; items by uid — `it.d` removed,
 *  `it.u` upserted (new ones at the end), `it.o` = the whole order; `cr` → creating, `r` → results, `fq`, `synced`, `now`, `gnow`
 *  (16.11 evening: the game clock, app.js gclock);
 *  `mv` set. Shallow copies: the old base is not changed. */
export function meApply(base: any, p: any): any {
  const key = (x: any) => String(x && x.uid != null ? x.uid : '');
  const out = Object.assign({}, base), hero = Object.assign({}, base.hero);
  out.hero = hero;
  if (p.h) Object.assign(hero, p.h);
  for (const k of p.hx || []) delete hero[k];
  if (p.it) {
    const by = new Map<string, any>();
    for (const x of base.hero.items || []) by.set(key(x), x);
    for (const k of p.it.d || []) by.delete(k);
    let order: string[] = (base.hero.items || []).map(key).filter((k: string) => by.has(k));
    for (const x of p.it.u || []) { const k = key(x); if (!by.has(k)) order.push(k); by.set(k, x); }
    if (p.it.o) order = p.it.o;
    hero.items = order.map((k) => by.get(k)).filter(Boolean);
  }
  if ('cr' in p) out.creating = p.cr;
  if ('r' in p) out.results = p.r;
  if ('fq' in p) out.fq = p.fq;
  if ('synced' in p) out.synced = p.synced;
  if ('now' in p) out.now = p.now;
  if ('gnow' in p) out.gnow = p.gnow;
  out.mv = p.mv;
  return out;
}
