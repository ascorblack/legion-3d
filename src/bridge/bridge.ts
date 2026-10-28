/**
 * Runs at document_start in the page (MAIN world), before the site's own scripts.
 * Tees the site's live channel (EventSource named events) and a few JSON fetch responses into a tiny bus,
 * so the game can read the same data the site gets without opening a second connection.
 * Must be invisible to the site: no behaviour change, never throws into the page.
 */
export interface Bus {
  on(type: string, fn: (data: any) => void): () => void;
  emit(type: string, data: any): void;
  last: Record<string, any>;
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

  const TEE = new Set(['me', 'city', 'mine', 'q', 'j', 'sm', 'style']);
  /* ---- EventSource: listen ourselves on every source the site opens to /api/live ---- */
  const ES = w.EventSource;
  if (typeof ES === 'function') {
    const Wrapped = function (this: unknown, url: string | URL, init?: EventSourceInit) {
      const es = new ES(url, init);
      try {
        if (/\/api\/live/.test(String(url))) {
          for (const t of TEE) {
            es.addEventListener(t, (e: Event) => {
              const d = (e as MessageEvent).data;
              let v: unknown = d;
              try { v = JSON.parse(d); } catch { /* keep raw */ }
              bus.emit('sse:' + t, v);
            });
          }
          es.addEventListener('open', () => bus.emit('sse:open', Date.now()));
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

  /* ---- fetch: copy JSON of a few endpoints ---- */
  const WATCH: [RegExp, string][] = [
    [/\/api\/city\/enter(\?|$)/, 'city:enter'],
    [/\/api\/city\/state(\?|$)/, 'city:state'],
    [/\/api\/me(\?|$)/, 'me'],
    [/\/api\/(equip|unequip|use|wear)(\?|$)/, 'hero:act'],
    [/\/api\/city\/chat\/ignore(\?|$)/, 'city:ignore'],
  ];
  const f0 = w.fetch;
  if (typeof f0 === 'function') {
    const wrapped = function (this: unknown, input: RequestInfo | URL, init?: RequestInit) {
      const p = f0.call(this === undefined ? w : (this as any), input as any, init);
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
    };
    w.fetch = wrapped as typeof fetch;
  }
})();
