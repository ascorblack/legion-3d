/**
 * «Путешествие», the channel half: the streamer search (GET /api/find?q=) and the own list (GET /api/mylist), exactly the
 * way the site's own start.js does it — nothing is requested until the player types (search) or opens the «Каналы» tab
 * (list), and moving to a channel is a plain navigation to /c/<login>/. Pure logic (no DOM) — test/travel.test.ts.
 */

/** start.js findInput(): ≥ 2 characters (a leading @ doesn't count), the site waits 300 ms, we wait a bit longer. */
export const FIND_MIN = 2;
export const FIND_DEBOUNCE_MS = 450;
export const FIND_CACHE = 50;
export const FIND_MAX_LEN = 25;
const LOGIN_OK = /^[\w.-]{1,40}$/;

export interface Channel {
  login: string;
  name: string;
  live: boolean;
  /** The player has a hero on this channel (own list only). */
  hero: boolean;
  pinned: boolean;
  viewers?: number;
}

/** The query as it goes to the server: trimmed, lower case, no leading @. */
export const normQuery = (v: unknown): string => String(v ?? '').trim().toLowerCase().replace(/^@/, '').slice(0, FIND_MAX_LEN);
export const validLogin = (v: unknown): v is string => typeof v === 'string' && LOGIN_OK.test(v) && !/^\.+$/.test(v);
/** Same URL the site builds (start.js chUrl). */
export const channelPath = (login: string): string => `/c/${encodeURIComponent(String(login).toLowerCase())}/`;
/** Login of the channel this page belongs to ('' outside /c/<login>/). */
export function currentChannel(pathname: string): string {
  const m = /^\/c\/([^/]+)/.exec(String(pathname || ''));
  if (!m) return '';
  try { return decodeURIComponent(m[1]).toLowerCase(); } catch { return ''; }
}
const clip = (v: unknown, n: number) => String(v ?? '').replace(/[\u0000-\u001f<>]/g, '').slice(0, n);
/** `list` of /api/find or /api/mylist → rows (bad entries dropped, strings clipped; the DOM layer escapes on top). */
export function parseChannels(list: unknown, max = 60): Channel[] {
  if (!Array.isArray(list)) return [];
  const out: Channel[] = [];
  for (const c of list) {
    if (!c || typeof c !== 'object') continue;
    const o = c as Record<string, unknown>;
    if (!validLogin(o.login)) continue;
    const v = +(o.viewers ?? o.v ?? NaN);
    out.push({ login: o.login.toLowerCase(), name: clip(o.name || o.login, 40) || o.login, live: !!o.live, hero: !!o.hero, pinned: !!o.pinned, ...(Number.isFinite(v) && v >= 0 ? { viewers: Math.floor(v) } : {}) });
    if (out.length >= max) break;
  }
  return out;
}

export type FindStatus = 'idle' | 'short' | 'busy' | 'ok' | 'error';
export interface FindState { q: string; status: FindStatus; list: Channel[]; err: string }
export interface FindDeps {
  /** One GET /api/find?q=<normalised>; resolves with the HTTP status and the parsed body; rejects on a network error / abort. */
  fetchFind(q: string, signal: AbortSignal | null): Promise<{ status: number; data: any }>;
  onState(s: FindState): void;
  setTimer?(fn: () => void, ms: number): unknown;
  clearTimer?(h: unknown): void;
  debounceMs?: number;
}

/**
 * Debounced, abortable search with a small cache. `input()` is the only thing that can start a request, and only after the
 * debounce and with ≥ 2 characters; a newer query aborts the older one; an equal query is answered from memory.
 */
export class FindController {
  private timer: unknown = null;
  private ctl: AbortController | null = null;
  private cache = new Map<string, Channel[]>();
  private seq = 0;
  /** Requests started (tests, live check). */
  requests = 0;
  state: FindState = { q: '', status: 'idle', list: [], err: '' };
  constructor(private d: FindDeps) {}
  private set(s: Partial<FindState>) { this.state = { ...this.state, ...s }; this.d.onState(this.state); }
  private stop() {
    if (this.timer != null) { (this.d.clearTimer || clearTimeout)(this.timer as never); this.timer = null; }
    if (this.ctl) { try { this.ctl.abort(); } catch { /* */ } this.ctl = null; }
  }
  input(raw: string): void {
    const q = normQuery(raw), seq = ++this.seq;
    this.stop();
    if (!q) { this.set({ q: raw, status: 'idle', list: [], err: '' }); return; }
    if (q.length < FIND_MIN) { this.set({ q: raw, status: 'short', list: [], err: '' }); return; }
    const hit = this.cache.get(q);
    if (hit) { this.set({ q: raw, status: 'ok', list: hit, err: '' }); return; }
    this.set({ q: raw, status: 'busy', err: '' });
    this.timer = (this.d.setTimer || setTimeout)(() => {
      this.timer = null;
      const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
      this.ctl = ctl; this.requests++;
      this.d.fetchFind(q, ctl ? ctl.signal : null).then(({ status, data }) => {
        if (seq !== this.seq) return;
        this.ctl = null;
        if (data && data.ok) {
          const list = parseChannels(data.list);
          this.cache.set(q, list);
          if (this.cache.size > FIND_CACHE) this.cache.delete(this.cache.keys().next().value as string);
          this.set({ status: 'ok', list, err: '' });
        } else this.set({ status: 'error', list: [], err: status === 429 ? 'Слишком часто — подожди пару секунд' : 'Поиск не ответил' });
      }).catch((e) => {
        if (seq !== this.seq || (e && e.name === 'AbortError')) return;
        this.ctl = null;
        this.set({ status: 'error', list: [], err: 'Нет связи с сайтом' });
      });
    }, this.d.debounceMs ?? FIND_DEBOUNCE_MS);
  }
  dispose(): void { this.seq++; this.stop(); }
}

/** Where a pick of a channel in the search results goes through: the site first writes it into the player's list (act 'open'). */
export const MYLIST_OPEN = { act: 'open' } as const;
