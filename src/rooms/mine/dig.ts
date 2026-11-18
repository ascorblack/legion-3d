/**
 * Site 18.11 (mine.js, a second UMD module `window.LGMineDig`): the hero's mine record may carry a dig record `dr`
 * { t, e, r, s, k, c, x, h, w, q, cp, b: { d, c, m, u, n?, cm?, qp? } } — a base `b` at server time `t` plus per-minute rates,
 * valid until `e`. The site no longer waits for the server to move the numbers: every 3 s (meTick) and on every take0 it
 * recomputes the record at the server clock (`view(me, srvNow())`): minutes used today (`day`, capped by `cp`), bag coins,
 * mine XP, the week's work (`wk`), the «Пока тебя не было» coins, the daily / weekly quest progress and the shared quest.
 * meTick also adopts the hero's own `mn[c]` record when its `dr.t` is newer (keeping the local stone queue `qq`).
 * A line-by-line port (no DOM, no globals) for src/rooms/mine/state.ts MineModel.meNow / meTick.
 */
const r2 = (x: number) => Math.round(x * 100) / 100;
export const CAP_EPS = 1000;

/** Whole minutes of `u` ms; within CAP_EPS of the cap counts as the cap. */
export function dayMin(u: number, cap: unknown): number { const c = Math.max(0, +(cap as number) || 0); return Math.floor((c > 0 && u >= c - CAP_EPS ? Math.max(u, c) : u) / 60000 + 1e-9); }

export const coins = (x: number): { c: number; cx: number } => ({ c: Math.floor(x), cx: r2(x) });

/** Quest progress as shown: 'res' quests count hundredths. */
export const qpView = (k: unknown, p: number): number => (k === 'res' ? Math.floor(p * 100 + 1e-6) : Math.floor(p));

export interface DigRec {
  t?: number; e?: number; r?: number; s?: number; k?: number; c?: number; x?: number; h?: number; w?: unknown; q?: unknown; cp?: number;
  b?: { d?: number; c?: number; m?: number; u?: number; n?: number | null; cm?: number | null; qp?: [string, string, string, number][] } | null;
}

export function perMin(dg: DigRec): { u: number; w0: number; coin: number; xp: number } {
  const u = Math.max(0, +(dg.r as number) || 0) * Math.max(0, +(dg.s as number) || 0), w0 = u / (+(dg.k as number) || 1);
  return { u, w0, coin: w0 * (+(dg.c as number) || 0), xp: Math.max(w0, 1) * (+(dg.x as number) || 0) };
}

const minOf = (dg: DigRec, now: number) => Math.max(0, Math.min(+now || 0, +(dg.e as number) || 0) - (+(dg.t as number) || 0)) / 60000;

export interface DigGrow { d: number; c: number; m: number; u: number; n?: number; cm?: number; qp: Record<string, number> }
export function grow(dg: DigRec, now: number): DigGrow {
  const b: NonNullable<DigRec['b']> = dg.b || {}, dt = minOf(dg, now), R = perMin(dg);
  const out: DigGrow = { d: (+(b.d as number) || 0) + dt * 60000, c: (+(b.c as number) || 0) + R.coin * dt, m: (+(b.m as number) || 0) + R.xp * dt, u: (+(b.u as number) || 0) + (dg.w ? R.u * dt : 0), qp: {} };
  if (b.n != null) out.n = +b.n + R.coin * dt;
  if (b.cm != null) out.cm = +b.cm + (dg.q ? R.u * dt : 0);
  for (const [L, id, k, p] of b.qp || []) out.qp[L + ':' + id] = +p + (dg.q ? (k === 'min' ? dt : k === 'work' ? R.u * dt : k === 'sh' ? R.u * (+(dg.h as number) || 0) * dt : 0) : 0);
  return out;
}

/** LGMineDig.view: the record as of `now` (server time); unchanged without a `dr` with a base. Shallow copies only. */
export function digView<T>(me: T, now: number): T {
  const m = me as any, dg = m && m.dr; if (!dg || typeof dg !== 'object' || !dg.b) return me;
  const g = grow(dg, now), o = { ...m };
  o.day = dayMin(g.d, dg.cp);
  if (m.bag) o.bag = { ...m.bag, ...coins(g.c) };
  if (m.mx) { const need = +m.mx.need || 0; o.mx = { ...m.mx, xp: Math.floor(need > 0 ? Math.min(need, g.m) : g.m) }; }
  if (dg.w) o.wk = Math.round(g.u);
  if (m.news && g.n != null) o.news = { ...m.news, ...coins(g.n) };
  if (m.q) {
    const q = { ...m.q }, it = (L: string) => (x: any) => { const v = x && !x.done ? g.qp[L + ':' + x.id] : undefined; return v != null ? { ...x, p: qpView(x.k, Math.min(+x.g || 0, v)) } : x; };
    if (Array.isArray(m.q.d)) q.d = m.q.d.map(it('d'));
    if (Array.isArray(m.q.w)) q.w = m.q.w.map(it('w'));
    if (m.q.c && g.cm != null) { const mm = Math.floor(g.cm); q.c = { ...m.q.c, me: mm }; if (mm >= (+m.q.c.min || 0)) q.c.ok = 1; else delete q.c.ok; }
    o.q = q;
  }
  return o as T;
}
