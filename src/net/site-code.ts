/**
 * Support codes on «closed» answers (site 16.11, site-ui.js `closedCode` / `withCode`): an answer `{ ok: false, closed: true,
 * code: 'X01', error | text }` gets « (код X01)» appended to its Russian error / text, so a player can quote it to the
 * streamer. The site's own fetch wrappers (app.js api, citymon.js, dailies.js, guilds.js, news.js…) run every answer through
 * `LGSiteUi.withCode`; ours (src/net/site.ts api, src/net/expedition-site.ts api) do the same, with the page's function when it
 * is there and this port otherwise — our toasts then say what the site's say.
 */
const CODE_RE = /^[A-Z]\d{2}$/;
/** site-ui.js closedCode: « (код X01)» or ''. */
export function closedCode(r: unknown): string {
  const o = r as { ok?: unknown; closed?: unknown; code?: unknown } | null;
  return o && o.ok === false && o.closed === true && typeof o.code === 'string' && CODE_RE.test(o.code) ? ` (код ${o.code})` : '';
}
const human = (t: unknown): t is string => typeof t === 'string' && /[а-яё]/i.test(t) && /\s/.test(t);
/** site-ui.js withCode: appends the code to the human-readable `error` / `text` (once). Returns the same object. */
export function withCode<T>(r: T): T {
  const c = closedCode(r);
  if (!c) return r;
  const o = r as unknown as Record<string, unknown>;
  for (const k of ['error', 'text']) { const v = o[k]; if (human(v) && v.indexOf('(код ') < 0) o[k] = v + c; }
  return r;
}
/** The page's LGSiteUi.withCode when the site has it (same result), else ours. Never throws. */
export function siteWithCode<T>(r: T, w: unknown = typeof window !== 'undefined' ? window : undefined): T {
  try {
    const su = (w as { LGSiteUi?: { withCode?: (x: T) => T } } | undefined)?.LGSiteUi;
    if (su && typeof su.withCode === 'function') return su.withCode(r);
  } catch { /* fall back to ours */ }
  try { return withCode(r); } catch { return r; }
}
