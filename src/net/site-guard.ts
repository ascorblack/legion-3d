/**
 * The site's anti-bot guard (site 17.11 evening, `/lib/guard.js`, `window.LGGuard`).
 *
 * How the site does it:
 *  - guard.js is the first script of the page after err.js (a plain <script src> in <head>, before the inline script that
 *    wraps fetch for LG_BASE). Its UMD tail runs `LGGuard.install(window)`: window.fetch becomes `guarded`, a wrapper over
 *    the native fetch (`LGGuard.under(guarded)` = the native one). The inline <head> script then wraps THAT and computes
 *    `LG_FETCH.n` from `LGGuard.under(o) || o`, so the mine telemetry (mine.js tlPi) still sees an honest page:
 *    window.fetch === LG_FETCH.w && LG_FETCH.n. Chain on the live page: LG_FETCH.w (adds LG_BASE) → guarded → native.
 *    No other script calls install(); app.js does not mention LGGuard at all.
 *  - `guarded` looks at the response header `X-Legion-Guard`: `ban…` → shows the ban window and returns the response as
 *    it is; `captcha` (but not `captcha:solved`) → when the request can be sent again (`reusable`: no body, or a string /
 *    FormData / Blob / URLSearchParams / ArrayBuffer body) it HOLDS the request, shows the captcha window and, once it is
 *    solved (a `{lgGuard: 'ok'}` message from its iframe), sends the same request again and resolves with that answer;
 *    a request that cannot be sent again gets the captcha response back. A non-timeout abort of the request's signal
 *    rejects the held promise; a timeout abort retries with a fresh 20 s timeout.
 *  - The window: `<dialog data-lg-guard="captcha|ban">` on <body> (showModal → the top layer, z 2147483647, an <iframe
 *    src="/guard"> «Проверка»); without showModal a `<div role="dialog" aria-modal="true">` that makes every other child
 *    of <body> inert. It eats Escape on window (capture) and pulls focus back into the iframe on every focusin elsewhere.
 *    A ban turns an open captcha window into the ban one. Inside an iframe the page's LGGuard defers to the parent's.
 *
 * What the extension does (see docs/SITE-NOTES.md «Anti-bot guard»):
 *  - every request of ours goes through the page's window.fetch at call time (src/net/site.ts api, src/net/expedition-site.ts
 *    api, the travel search), i.e. through the guard: a captcha holds our request like the site's own and replays it;
 *  - the bridge's fetch tee (src/bridge/bridge.ts) is put on later, ON TOP of the site's wrapper, never under the guard, and
 *    `off()` puts the site's wrapper back exactly; it does not copy a guard-flagged answer;
 *  - a shown guard window is the first overlay (src/net/site.ts overlayKind → 'guard'): the 3D steps aside (pointer lock
 *    released, held keys dropped, canvas hidden, engine paused), so the player sees and solves the captcha / sees the ban;
 *  - a ban answer is never swallowed: our api() returns `{ ok: false, guard: 'ban', error }` with the server's own text
 *    when it sent one (else BAN_TEXT), and the site's ban window stays on screen over the hidden 3D.
 */
export const GUARD_HDR = 'X-Legion-Guard';
/** guard.js show(): the window element carries `data-lg-guard="captcha" | "ban"`. */
export const GUARD_SEL = '[data-lg-guard]';
export type GuardKind = 'ban' | 'captcha';

/** Port of guard.js kind(res): 'ban' | 'captcha' (not yet solved) | null. Never throws. */
export function guardKindOf(res: unknown): GuardKind | null {
  let v = '';
  try {
    const h = (res as { headers?: { get?: (n: string) => unknown } } | null)?.headers;
    v = String((h && typeof h.get === 'function' && h.get(GUARD_HDR)) || '');
  } catch { return null; }
  const p = v.split(':');
  if (p[0] === 'ban') return 'ban';
  if (p[0] === 'captcha' && p[1] !== 'solved') return 'captcha';
  return null;
}

/** The page's LGGuard.kind when the site has it (same rule), else ours. */
export function guardKind(res: unknown, w: unknown = typeof window !== 'undefined' ? window : undefined): GuardKind | null {
  try {
    const g = (w as { LGGuard?: { kind?: (r: unknown) => unknown } } | undefined)?.LGGuard;
    if (g && typeof g.kind === 'function') { const k = g.kind(res); return k === 'ban' || k === 'captcha' ? k : null; }
  } catch { /* fall back to ours */ }
  return guardKindOf(res);
}

export const BAN_TEXT = 'Сайт закрыл доступ этому аккаунту — подробности в окне сайта.';
export const CAPTCHA_TEXT = 'Сайт просит пройти проверку — пройди её в окне сайта и повтори.';

/**
 * The answer our api() returns for a guard-flagged response: the server's own JSON (its `error` / `text` kept) marked
 * `ok: false, guard: kind`, or our text when the body says nothing readable. A ban is never turned into «нет связи».
 */
export function guardAnswer(kind: GuardKind, body: unknown): Record<string, unknown> {
  const o = body && typeof body === 'object' ? { ...(body as Record<string, unknown>) } : {};
  const said = typeof o.error === 'string' && o.error.trim() ? o.error : typeof o.text === 'string' && o.text.trim() ? o.text : '';
  return { ...o, ok: false, guard: kind, error: said || (kind === 'ban' ? BAN_TEXT : CAPTCHA_TEXT) };
}

/** Read a response of the site like our api() does: guard-flagged → guardAnswer, else its JSON (throws when not JSON). */
export async function readSiteAnswer(r: Response, w?: unknown): Promise<any> {
  const k = guardKind(r, w);
  if (!k) return r.json();
  let body: unknown = null;
  try { body = await r.clone().json(); } catch { /* not JSON */ }
  return guardAnswer(k, body);
}

/** Is a guard window in the document (captcha or ban)? Optional `kind` narrows it. */
export function guardShown(doc: Pick<Document, 'querySelector'> | null = typeof document !== 'undefined' ? document : null, kind?: GuardKind): boolean {
  try { return !!doc && !!doc.querySelector(kind ? `[data-lg-guard="${kind}"]` : GUARD_SEL); } catch { return false; }
}
