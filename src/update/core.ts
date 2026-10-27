/**
 * "Update available" notice — pure logic shared by the three places that touch it:
 *   background.js (extension worker: the ONLY code that talks to GitHub), notify.js (isolated-world relay),
 *   and src/features/update.ts (the page UI). Nothing here downloads or evaluates code: the worker reads two
 *   strings (tag_name, html_url) from a public JSON document, validates both and passes them on as data.
 */
export const RELEASES_API = 'https://api.github.com/repos/ascorblack/legion-3d/releases/latest';
export const RELEASE_URL_PREFIX = 'https://github.com/ascorblack/legion-3d/releases/';
export const CHECK_INTERVAL_MS = 12 * 3600 * 1000;
export const FETCH_TIMEOUT_MS = 10_000;
export const STATE_KEY = 'l3d.update.state';
/** Page-side setting (localStorage of the game page; notify.js reads the same storage). '0' = off, anything else = on. */
export const CHECK_KEY = 'l3d.update.check';
export const QUERY_TYPE = 'l3d-update-check';

export type Semver = [number, number, number];
export function parseSemver(s: unknown): Semver | null {
  if (typeof s !== 'string' || s.length > 24) return null;
  const m = /^v?(\d{1,6})\.(\d{1,6})\.(\d{1,6})$/.exec(s.trim());
  return m ? [+m[1], +m[2], +m[3]] : null;
}
/** >0 when a is newer than b, <0 when older, 0 equal; null when either is not a plain x.y.z version. */
export function compareSemver(a: unknown, b: unknown): number | null {
  const x = parseSemver(a), y = parseSemver(b);
  if (!x || !y) return null;
  return x[0] - y[0] || x[1] - y[1] || x[2] - y[2];
}
export const isNewer = (latest: unknown, current: unknown): boolean => (compareSemver(latest, current) ?? 0) > 0;
export const cleanVersion = (s: string): string => s.trim().replace(/^v/, '');

export function isReleaseUrl(u: unknown): u is string {
  if (typeof u !== 'string' || u.length > 300 || !u.startsWith(RELEASE_URL_PREFIX) || /[\s<>"'`\\]/.test(u)) return false;
  try { const p = new URL(u); return p.protocol === 'https:' && p.hostname === 'github.com' && !p.username && !p.password && !p.port; } catch { return false; }
}

/** The two fields we read from GET /releases/latest; anything else in the document is ignored. */
export function parseRelease(doc: unknown): { latest: string; url: string } | null {
  if (!doc || typeof doc !== 'object') return null;
  const { tag_name, html_url } = doc as { tag_name?: unknown; html_url?: unknown };
  if (!parseSemver(tag_name) || !isReleaseUrl(html_url)) return null;
  return { latest: cleanVersion(tag_name as string), url: html_url };
}

/** Store builds get `update_url` injected into the installed manifest by Chrome / Edge: they update themselves, never check. */
export function isStoreInstall(manifest: { update_url?: unknown } | null | undefined): boolean {
  return typeof manifest?.update_url === 'string' && manifest.update_url.length > 0;
}

export interface UpdateState { t?: number; latest?: string; url?: string; enabled?: boolean }
/** At most one request per CHECK_INTERVAL_MS; a clock set far back (t in the future) counts as due. */
export function checkDue(state: UpdateState, now: number): boolean {
  const t = state.t;
  if (typeof t !== 'number' || !Number.isFinite(t)) return true;
  return now - t >= CHECK_INTERVAL_MS || t - now > CHECK_INTERVAL_MS;
}

/** notify.js → worker. */
export interface UpdateQuery { type: typeof QUERY_TYPE; enabled: boolean }
/** worker → notify.js → page (as window.postMessage payload, plus `__l3d: 'update'`). */
export interface UpdateInfo { current: string; store: boolean; off?: boolean; latest?: string; url?: string }
export interface PageUpdateMessage extends UpdateInfo { __l3d: 'update' }

/** Strict shape check; returns a sanitised copy (only known fields) or null. Used on both sides of the page boundary. */
export function sanitizeInfo(raw: unknown): UpdateInfo | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (!parseSemver(r.current) || typeof r.store !== 'boolean') return null;
  const out: UpdateInfo = { current: cleanVersion(r.current as string), store: r.store };
  if (r.off === true) out.off = true;
  if (r.latest !== undefined || r.url !== undefined) {
    if (!parseSemver(r.latest) || !isReleaseUrl(r.url)) return null;
    out.latest = cleanVersion(r.latest as string); out.url = r.url;
  }
  return out;
}
export function isAskMessage(data: unknown): boolean {
  return !!data && typeof data === 'object' && (data as { __l3d?: unknown }).__l3d === 'update-ask';
}
/** window 'message' event → sanitised info, only from this very window and origin. */
export function readPageMessage(e: { data: unknown; source: unknown; origin: string }, win: unknown, origin: string): UpdateInfo | null {
  if (e.source !== win || e.origin !== origin) return null;
  const d = e.data as { __l3d?: unknown } | null;
  if (!d || typeof d !== 'object' || d.__l3d !== 'update') return null;
  return sanitizeInfo(d);
}

export function dismissedFor(stored: string | null, latest: string): boolean { return stored === latest; }
