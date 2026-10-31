/**
 * «Тюрьма и клетка» of the channel (site 30.10, flag legionary.jailPublic) — pure helpers + the live state hub.
 *
 * What the site has (app.js, city.js, citymap.js LOW.jail):
 *  - `/api/me` top level: `jail` = { reason, until, untilText } when THIS hero is a prisoner (only the City, sits in the cage,
 *    cannot walk or enter buildings, the chat is read-only, a status bar «Ты в тюрьме канала» with the reason and the term),
 *    `jl` = the jail is open for this viewer (app.js jailOn = !!(ME.jail || ME.jl));
 *  - GET `/api/jail` → { ok, list: [{ l, n, lv, lk, g, gh, aw, u }], n, staff?, why? } and the SSE event «jail» with the same
 *    payload: who sits in the cage. Up to 8 sit on LOW.jail.seats (the own hero of a prisoner always first), the rest is «+N».
 * Nothing here sends anything; the GET is the one the site's City makes itself when it opens (city.js jailLoad).
 */
import type { Building, JailGeo, LowerStreet } from '../contracts';

export interface JailEntry { l: string; n?: string; lv?: number; lk?: unknown; g?: unknown; gh?: number; aw?: unknown; u?: number | null }
export interface JailMe { reason?: string; until?: number | null; untilText?: string }
export interface JailState {
  /** The jail is open for this viewer (me.jl or me.jail): the building, the cage and its obstacles are in the City. */
  on: boolean;
  /** This hero is a prisoner (me.jail), else null. */
  me: JailMe | null;
  /** Who sits in the cage (/api/jail, SSE «jail»), and how many in all. */
  list: JailEntry[];
  n: number;
}
export const JAIL_OFF: JailState = Object.freeze({ on: false, me: null, list: [], n: 0 }) as JailState;

const str = (v: unknown, max = 200): string | undefined => (typeof v === 'string' && v ? v.slice(0, max) : undefined);
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() && Number.isFinite(+v) ? +v : undefined);

/** app.js jail() / jailOn() from an /api/me answer. */
export function jailFromMe(me: unknown): { on: boolean; me: JailMe | null } {
  const m = (me && typeof me === 'object' ? me : {}) as Record<string, unknown>;
  const j = m.jail && typeof m.jail === 'object' ? m.jail as Record<string, unknown> : null;
  const mine: JailMe | null = j ? { reason: str(j.reason, 300), until: j.until == null ? null : num(j.until) ?? null, untilText: str(j.untilText, 80) } : null;
  return { on: !!(m.jail || m.jl), me: mine };
}

/** The list of /api/jail or the SSE «jail» payload (sanitised; logins lower-case). */
export function jailList(d: unknown): { list: JailEntry[]; n: number } | null {
  if (!d || typeof d !== 'object') return null;
  const r = d as Record<string, unknown>;
  if (r.ok === false) return null;
  const list: JailEntry[] = [];
  for (const e of Array.isArray(r.list) ? r.list : []) {
    if (!e || typeof e !== 'object') continue;
    const x = e as Record<string, unknown>;
    const l = str(x.l, 40); if (!l) continue;
    list.push({ l: l.toLowerCase(), n: str(x.n, 60), lv: num(x.lv), lk: x.lk, g: x.g, gh: x.gh ? 1 : 0, aw: x.aw, u: x.u == null ? null : num(x.u) ?? null });
  }
  return { list, n: Math.max(list.length, num(r.n) ?? list.length) };
}

/** LOW.jail of the layout, or the same numbers derived from the building's hit box (the site's 30.10 values). */
export function jailGeoOf(b: Pick<Building, 'hit'> | null | undefined, low?: LowerStreet | null): JailGeo | null {
  const J = low?.jail;
  if (J && [J.x0, J.x1, J.base, J.c0, J.c1, J.fy].every((v) => typeof v === 'number' && Number.isFinite(v)) && J.c1 > J.c0 && J.x1 > J.x0
    && Array.isArray(J.door) && Array.isArray(J.seats)) return J;
  if (!b) return null;
  const [h0, h1, , h3] = b.hit;
  const c0 = h0 + 290, fy = h3, door: [number, number] = [c0 + 155, c0 + 225];
  const seats: [number, number][] = [];
  for (let i = 0; i < 8; i++) seats.push(i < 4 ? [c0 + 60 + i * 90, fy - 90] : [c0 + 105 + (i - 4) * 90, fy - 34]);
  return { x0: h0, x1: h0 + 260, base: h3 - 10, c0, c1: h1, fy, door, seats };
}

export interface JailSeat {
  /** Login of the prisoner on the seat ('' = the own hero). */
  login: string;
  self: boolean;
  entry: JailEntry | null;
  x: number; y: number;
  /** The site's 2D facing on the seat: 1 / −1 (city.js: odd seats look the other way). */
  flip: 1 | -1;
}
/** city.js jailDraw(): the own hero of a prisoner first, then the list without me, up to the number of seats. */
export function jailSeats(st: JailState, J: JailGeo, myLogin: string): JailSeat[] {
  const me = myLogin.toLowerCase(), out: JailSeat[] = [];
  const seat = (i: number) => J.seats[i] || J.seats[J.seats.length - 1];
  if (st.me) { const [x, y] = seat(0); out.push({ login: '', self: true, entry: null, x, y, flip: 1 }); }
  for (const e of st.list) {
    if (out.length >= J.seats.length) break;
    if (e.l === me) continue;
    const i = out.length, [x, y] = seat(i);
    out.push({ login: e.l, self: false, entry: e, x, y, flip: i % 2 ? -1 : 1 });
  }
  return out;
}
/** «+N» over the cage (city.js): everyone (+ me when the list does not have me yet) minus the ones on seats. */
export function jailMore(st: JailState, shown: number, myLogin: string): number {
  const me = myLogin.toLowerCase();
  const total = st.n + (st.me && !st.list.some((e) => e.l === me) ? 1 : 0);
  return Math.max(0, total - shown);
}

/** city.js jailDay(u): when a prisoner gets out (Moscow time) or «бессрочно». */
export function jailDay(u: number | null | undefined): string {
  if (u == null) return 'бессрочно';
  try {
    const d = new Date(u);
    return 'выйдет ' + d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', timeZone: 'Europe/Moscow' }) + ', '
      + d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Moscow' });
  } catch { return ''; }
}

/** app.js jailUi(): the prisoner's bar — «Ты в тюрьме канала», «Причина: …», «Выйдешь: …» / «Срок: бессрочно». */
export function jailBar(me: JailMe): { title: string; reason: string | null; term: string } {
  return {
    title: 'Ты в тюрьме канала',
    reason: me.reason ? 'Причина: ' + me.reason : null,
    term: me.until ? 'Выйдешь: ' + String(me.untilText || '').replace(/^до /, '') : 'Срок: бессрочно',
  };
}

/** The live jail state of a session (site adapter, dev fakes): get / set / subscribe. */
export interface JailHub {
  get(): JailState;
  setMe(v: { on: boolean; me: JailMe | null }): void;
  setList(v: { list: JailEntry[]; n: number }): void;
  on(fn: (st: JailState) => void): () => void;
}
export function createJailHub(init: Partial<JailState> = {}): JailHub {
  let st: JailState = { ...JAIL_OFF, list: [], ...init };
  const subs = new Set<(s: JailState) => void>();
  const emit = () => { for (const f of [...subs]) { try { f(st); } catch (e) { console.warn('[legion-3d] jail listener', e); } } };
  const key = (s: JailState) => JSON.stringify([s.on, s.me, s.n, s.list.map((e) => [e.l, e.n, e.lv, e.lk, e.g, e.gh, e.aw, e.u])]);
  const set = (next: JailState) => { if (key(next) === key(st)) return; st = next; emit(); };
  return {
    get: () => st,
    setMe: (v) => set({ ...st, on: v.on, me: v.me }),
    setList: (v) => set({ ...st, list: v.list, n: v.n }),
    on(fn) { subs.add(fn); return () => { subs.delete(fn); }; },
  };
}
