/**
 * Runs at document_start in the page (MAIN world), before the site's own scripts.
 * Tees the site's live channel (EventSource named events, or the WebSocket live link) and a few JSON fetch responses
 * into a tiny bus, so the game can read the same data the site gets without opening a second connection.
 * Must be invisible to the site: no behaviour change, never throws into the page.
 *
 * Live link (site 13.11, /lib/site-live.js LGLiveLink): app.js opens the live channel through LGLiveLink, which tries a
 * WebSocket to `/ws` first (only when the hero has `lw`, not in the cage, not the streamer dock) and falls back to the
 * EventSource `/api/live` (4 sockets that never open → SSE for 10 min; liveerr off / no_channel / forbidden → SSE too).
 * Over the socket an event is one text frame `{"op":"ev","e":"<name>","d":<json>}` — the same names and payloads as
 * the SSE events. Both transports are tapped here by passive listeners added when the site constructs them, so the
 * bus gets the same 'sse:<name>' whichever one LGLiveLink picks; 'live:kind' says which ('ws' | 'sse').
 * Neither EventSource nor WebSocket is checked by the site's bot telemetry (mine.js tlPi checks fetch and rAF only).
 *
 * window.fetch is NOT replaced by default. The site's anti-bot telemetry (mine.js tlPi) compares window.fetch with the
 * native function and with its own wrapper (LG_FETCH), and a foreign wrapper raises the streamer's bot score for an
 * honest player. So the fetch tee exists only while the 3D game is running (`bus.fetchTee.on()`), and `off()` puts back
 * exactly the function that was there before (the site's own wrapper) — in the classic 2D site nothing of ours sits on
 * window.fetch. The page is seen as it is: no toString/native-code tricks, no hiding.
 * Why never at document_start, even for start mode 3D: the site's <head> script wraps whatever window.fetch is at that
 * moment and records whether it was native (LG_FETCH.n). A tee under the site's wrapper could never be taken out and
 * would mark the whole page load, F8 or not. Put on later, on top of the site's wrapper, it comes out exactly.
 */
export interface FetchTee {
  /** Put the tee on window.fetch (idempotent). Returns whether window.fetch is ours now. */
  on(): boolean;
  /** Restore the previous window.fetch; returns true when it is no longer ours. If something else wrapped fetch on top
   *  of us meanwhile the wrapper cannot be taken out: it stays in the chain as a plain pass-through. */
  off(): boolean;
  /** Is our function the page's current window.fetch (then the page runs with a foreign fetch). */
  installed(): boolean;
}
export interface Bus {
  on(type: string, fn: (data: any) => void): () => void;
  emit(type: string, data: any): void;
  last: Record<string, any>;
  fetchTee?: FetchTee;
}

declare global {
  interface Window { __L3D_BUS?: Bus }
}

(function install() {
  const w = window;
  if (w.__L3D_BUS) return;
  const subs = new Map<string, Set<(d: any) => void>>();
  const bus: Bus = {
    last: Object.create(null),
    on(type, fn) {
      let s = subs.get(type); if (!s) subs.set(type, (s = new Set()));
      s.add(fn);
      return () => { s!.delete(fn); };
    },
    emit(type, data) {
      bus.last[type] = data;
      const s = subs.get(type); if (!s) return;
      for (const fn of s) { try { fn(data); } catch (e) { console.warn('[legion-3d] bus listener', type, e); } }
    },
  };
  Object.defineProperty(w, '__L3D_BUS', { value: bus, configurable: false, enumerable: false, writable: false });

  // jail: who sits in the cage (30.10); dm: the sender of the newest direct message (src/ui/dm.ts toast)
  const TEE = new Set(['me', 'city', 'mine', 'q', 'j', 'sm', 'style', 'jail', 'dm']);
  const parse = (d: unknown): unknown => { if (typeof d !== 'string') return d; try { return JSON.parse(d); } catch { return d; } };   // keep raw
  /* ---- EventSource: listen ourselves on every source the site opens to /api/live ---- */
  const ES = w.EventSource;
  if (typeof ES === 'function') {
    const Wrapped = function (this: unknown, url: string | URL, init?: EventSourceInit) {
      const es = new ES(url, init);
      try {
        if (/\/api\/live/.test(String(url))) {
          for (const t of TEE) es.addEventListener(t, (e: Event) => bus.emit('sse:' + t, parse((e as MessageEvent).data)));
          es.addEventListener('open', () => { bus.emit('live:kind', 'sse'); bus.emit('sse:open', Date.now()); });
          es.addEventListener('error', () => bus.emit('sse:error', Date.now()));
        }
      } catch { /* never break the page */ }
      return es;
    } as unknown as typeof EventSource;
    Wrapped.prototype = ES.prototype;
    for (const k of ['CONNECTING', 'OPEN', 'CLOSED'] as const) {
      try { Object.defineProperty(Wrapped, k, { value: (ES as any)[k] }); } catch { /* ignore */ }
    }
    try { Object.setPrototypeOf(Wrapped, ES); } catch { /* ignore */ }
    w.EventSource = Wrapped;
  }

  /* ---- WebSocket: the live link's socket to /ws (LGLiveLink, site 13.11) — same events, other framing ---- */
  const WS = w.WebSocket;
  if (typeof WS === 'function') {
    const WrappedWS = function (this: unknown, url: string | URL, protocols?: string | string[]) {
      const s = protocols === undefined ? new WS(url) : new WS(url, protocols);
      try { if (isLiveWs(url)) tapLiveWs(s, bus, TEE, parse); } catch { /* never break the page */ }
      return s;
    } as unknown as typeof WebSocket;
    WrappedWS.prototype = WS.prototype;
    for (const k of ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED'] as const) {
      try { Object.defineProperty(WrappedWS, k, { value: (WS as any)[k] }); } catch { /* ignore */ }
    }
    try { Object.setPrototypeOf(WrappedWS, WS); } catch { /* ignore */ }
    w.WebSocket = WrappedWS;
  }

  /* ---- fetch: copy JSON of a few endpoints — only while the 3D game runs (see the header) ---- */
  const WATCH: [RegExp, string][] = [
    [/\/api\/city\/enter(\?|$)/, 'city:enter'],     // chat history, moderator role, mute, ignore list of the City chat; the 3D world rebuild
    [/\/api\/city\/state(\?|$)/, 'city:state'],     // the site's poll when its live channel is down
    [/\/api\/me(\?|$)/, 'me'],                       // hero snapshot when the live channel is down
    [/\/api\/(equip|unequip|use|wear)(\?|$)/, 'hero:act'],   // looks changed from the site's own panels
    [/\/api\/city\/chat\/ignore(\?|$)/, 'city:ignore'],     // ignore list (no other source: it is private to the site's chat)
    [/\/api\/jail(\?|$)/, 'jail:list'],              // the cage's list when the City (re)opens (city.js jailLoad, 30.10)
  ];
  let wrapped: typeof fetch | null = null;   // our function while it is somewhere in the window.fetch chain
  let prev: typeof fetch | null = null;      // what window.fetch was when we put it on
  let live = false;                          // false: a wrapper that could not be taken out passes through
  const make = (under: typeof fetch): typeof fetch => function (this: unknown, input: RequestInfo | URL, init?: RequestInit) {
    const p = under.call(this === undefined ? w : (this as any), input as any, init);
    if (!live) return p;
    try {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url;
      const hit = WATCH.find(([re]) => re.test(url));
      if (hit) {
        p.then((r) => {
          if (!r.ok) return;
          r.clone().json().then((j) => bus.emit(hit[1], j), () => {});
        }, () => {});
      }
    } catch { /* ignore */ }
    return p;
  } as typeof fetch;
  const installed = () => !!wrapped && w.fetch === wrapped;
  const fetchTee: FetchTee = {
    on() {
      if (installed()) { live = true; return true; }
      if (wrapped) { live = true; return false; }   // still in the chain under somebody else's wrapper: just wake it up
      const f0 = w.fetch;
      if (typeof f0 !== 'function') return false;
      prev = f0; wrapped = make(f0); live = true;
      w.fetch = wrapped;
      return true;
    },
    off() {
      live = false;
      if (installed()) { w.fetch = prev as typeof fetch; wrapped = null; prev = null; return true; }
      return !wrapped;
    },
    installed,
  };
  Object.defineProperty(bus, 'fetchTee', { value: fetchTee, configurable: false, enumerable: false, writable: false });
  })();

/** The live link's socket: `/ws` on the page's own host (app.js: (wss|ws)://location.host/ws). */
export function isLiveWs(url: string | URL): boolean {
  try {
    const base = typeof location !== 'undefined' ? location.href : 'https://localhost/';
    const u = new URL(String(url), base);
    return /^wss?:$/.test(u.protocol) && /\/ws\/?$/.test(u.pathname) && (typeof location === 'undefined' || u.host === location.host);
  } catch { return false; }
}

/** One text frame of the live link → [event name, payload text] for `{"op":"ev","e":"<name>","d":<json>}`; 'liveok' for
 *  the subscription answer; null otherwise. Same cut as site-live.js (prefix, then the first `","d":`, drop the last `}`). */
export function liveFrame(t: unknown): [string, string] | 'liveok' | null {
  if (typeof t !== 'string') return null;
  const EV = '{"op":"ev","e":"', EVD = '","d":';
  if (t.startsWith(EV)) {
    const q = t.indexOf(EVD, EV.length);
    return q < 0 ? null : [t.slice(EV.length, q), t.slice(q + EVD.length, -1)];
  }
  return t.charCodeAt(0) === 123 && t.length < 200 && /"op"\s*:\s*"liveok"/.test(t) ? 'liveok' : null;
}

/** Passive listeners on the site's own live socket: the site's handlers (s.onmessage …) are untouched. */
function tapLiveWs(s: WebSocket, bus: Bus, tee: ReadonlySet<string>, parse: (d: unknown) => unknown): void {
  let up = false;
  s.addEventListener('message', (e: MessageEvent) => {
    try {
      const f = liveFrame(e.data);
      if (!f) return;
      if (f === 'liveok') { if (!up) { up = true; bus.emit('live:kind', 'ws'); bus.emit('sse:open', Date.now()); } return; }
      if (!up) { up = true; bus.emit('live:kind', 'ws'); }
      if (tee.has(f[0])) bus.emit('sse:' + f[0], parse(f[1]));
    } catch { /* never break the page */ }
  });
  s.addEventListener('close', () => { if (up) { up = false; bus.emit('sse:error', Date.now()); } });
}
