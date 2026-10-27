/**
 * Extension-side update checker (runs in background.js). Testable: every browser dependency is injected.
 * Requests ONLY RELEASES_API: GET, no cookies/credentials, no referrer, no query string, no redirects followed,
 * 10 s timeout, at most once per 12 h (timestamp is persisted before the request, so a crash cannot cause a retry storm).
 * Failures are silent. Store installs (manifest.update_url present) never fetch.
 */
import {
  RELEASES_API, CHECK_INTERVAL_MS, FETCH_TIMEOUT_MS, STATE_KEY, QUERY_TYPE,
  checkDue, isStoreInstall, parseRelease, parseSemver, cleanVersion, type UpdateInfo, type UpdateState,
} from './core';

export interface WorkerDeps {
  manifest: () => { version: string; update_url?: unknown };
  load: () => Promise<UpdateState>;
  save: (s: UpdateState) => Promise<void>;
  fetch: typeof fetch;
  now: () => number;
}

export function createUpdateWorker(d: WorkerDeps) {
  let inflight: Promise<UpdateState> | null = null;

  async function refresh(state: UpdateState): Promise<UpdateState> {
    const now = d.now();
    if (!checkDue(state, now)) return state;
    const next: UpdateState = { ...state, t: now };
    try { await d.save(next); } catch { return state; }
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS);
    try {
      const res = await d.fetch(RELEASES_API, {
        method: 'GET', credentials: 'omit', cache: 'no-store', redirect: 'error', referrerPolicy: 'no-referrer',
        headers: { Accept: 'application/vnd.github+json' }, signal: ctl.signal,
      });
      if (!res.ok) return next;
      const rel = parseRelease(await res.json());
      if (!rel) return next;
      next.latest = rel.latest; next.url = rel.url;
      await d.save(next);
    } catch { /* offline, rate limited, timeout: stay silent, try again after the interval */ }
    finally { clearTimeout(timer); }
    return next;
  }
  function check(state: UpdateState): Promise<UpdateState> {
    return (inflight ??= refresh(state).finally(() => { inflight = null; }));
  }

  async function query(enabled: boolean): Promise<UpdateInfo> {
    const m = d.manifest();
    const current = cleanVersion(m.version);
    if (isStoreInstall(m)) return { current, store: true };
    let state: UpdateState = {};
    try { state = (await d.load()) || {}; } catch { /* storage unavailable */ }
    if (state.enabled !== enabled) { state = { ...state, enabled }; try { await d.save(state); } catch { /* */ } }
    if (!enabled) return { current, store: false, off: true };
    state = await check(state);
    const info: UpdateInfo = { current, store: false };
    if (parseSemver(state.latest) && state.url) { info.latest = state.latest; info.url = state.url; }
    return info;
  }

  /** Browser start: one check unless the install is a store one or the player switched checks off. */
  async function startup(): Promise<void> {
    if (isStoreInstall(d.manifest())) return;
    let state: UpdateState = {};
    try { state = (await d.load()) || {}; } catch { return; }
    if (state.enabled === false) return;
    await check(state);
  }

  /** runtime.onMessage body: validates the message, answers via sendResponse; returns true when it answers asynchronously. */
  function onMessage(msg: unknown, sendResponse: (r: UpdateInfo | null) => void): boolean {
    const m = msg as { type?: unknown; enabled?: unknown } | null;
    if (!m || typeof m !== 'object' || m.type !== QUERY_TYPE || typeof m.enabled !== 'boolean') return false;
    query(m.enabled).then(sendResponse, () => sendResponse(null));
    return true;
  }
  return { query, startup, onMessage, interval: CHECK_INTERVAL_MS };
}
