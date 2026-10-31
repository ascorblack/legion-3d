/**
 * The site's own 2D mine (mine.js `LGMine`, the full-screen `.mn` screen) seen from the extension — read-only helpers for
 * switching 2D ⇄ 3D inside the mine (F8) without leaving it (src/features/mine-hold.ts, src/rooms/mine).
 *
 * How the site behaves (dump 31.10, app.js openMine / mine.js open, close, enter, otherTab; city.js sleep / wake):
 *  - opening the mine puts the City to sleep (`LGCity.sleep()`: city leave, scene released, `LGCity.debug()` = null); its
 *    «В город» (`LGMine.exit()`) closes the mine (mine leave) and wakes the City (city enter). Clicking the City tab while
 *    the mine is open re-opens the City under the mine (city enter) — so nothing of ours may click tabs then;
 *  - one mine presence per page tab key: whoever entered last owns it, the other client is told «Шахта открыта в другой
 *    вкладке» (`.mn-other`, button «Копать здесь» = enter again);
 *  - the site's mine client polls `/api/mine/state?c=<key>` (key «home», a district id or «id.floor» of «Шахта 3.0»), so
 *    the floor on show is read from the page's resource timing entries — no wrapper, no request of ours.
 *
 * Holding: while the 3D mine is shown the site's 2D mine stays open underneath, hidden (display:none, html.l3d-mnhold); a
 * hidden `.mn-board-w` sentinel makes the site's mine ignore Esc (mine.js key(): «Esc closes the mine» returns early while a
 * board window exists), so the 3D pause menu's Esc cannot close it (that would wake the City: a city enter in the mine).
 */
import { setFetchTee } from './fetch-tee';

type W0 = Window & { LGMine?: { on?: boolean; exit?: () => void; close?: () => void }; LGCity?: { debug?: () => unknown; panel?: (id: string) => unknown; wake?: () => void } };
const win = (): W0 => window as W0;

/** A mine key as the site accepts it (mine.js open(): `id` or `id.floor`). */
export const MINE_KEY_RE = /^[a-z0-9_-]{1,24}(\.[1-9][0-9]{0,2})?$/;
/** Mine id without the floor («home.3» → «home»). */
export const mineBase = (k: string): string => String(k || '').split('.')[0];

/** Is the site's own 2D mine open (shown or held under the 3D mine)? */
export function siteMineOpen(w: W0 = win(), doc: Document = document): boolean {
  try { if (w.LGMine && typeof w.LGMine.on === 'boolean') return w.LGMine.on; } catch { /* */ }
  return !!doc.querySelector('.mn');
}

/** Is the site's City scene live (open and drawn, not asleep under the mine)? */
export function cityLive(w: W0 = win()): boolean {
  try { return !!(w.LGCity && typeof w.LGCity.debug === 'function' && w.LGCity.debug()); } catch { return false; }
}

/**
 * May connectSite() replay the City's enter (another tab, then the City tab: src/net/site.ts replayCityEnter)? Only when the
 * City scene itself is what the page shows: the City tab is on and its scene is there (`.cy` root, not the empty root of
 * a sleeping City), and no site mine, mine chooser, expedition or other tab is in front. Inside the mine the replay would
 * wake the City under it — a city enter while in the mine (0.6.1: the 3D never showed, F8 twice left the mine).
 */
export function cityReplayAllowed(doc: Document = document, w: W0 = win()): boolean {
  if (siteMineOpen(w, doc)) return false;
  if (doc.querySelector('.mn-board-w')) return false;
  const tab = doc.querySelector('#tab-city');
  if (!tab || !tab.classList.contains('on')) return false;
  for (const t of Array.from(doc.querySelectorAll('.tab.on'))) if (t.id !== 'tab-city') return false;
  return !!tab.querySelector('.cy');
}

/* ------------------------------------------------------------------ which floor the site's mine shows */

/** `{op, key}` of a mine presence request URL (`/api/mine/enter|state|ping|leave?c=<key>`), else null. */
export function mineReqOf(url: string): { op: 'enter' | 'state' | 'ping' | 'leave'; key: string } | null {
  const m = /\/api\/mine\/(enter|state|ping|leave)\?(?:[^#]*?&)?c=([^&#]+)/.exec(String(url || ''));
  if (!m) return null;
  let key = m[2];
  try { key = decodeURIComponent(key); } catch { return null; }
  return MINE_KEY_RE.test(key) ? { op: m[1] as 'enter', key } : null;
}

/** The latest mine presence requests of the page (by start time). Fed by a PerformanceObserver (no buffer limit). */
export class MineReqLog {
  last: { op: string; key: string; at: number } | null = null;
  lastEnter: { key: string; at: number } | null = null;
  feed(url: string, at: number): void {
    const r = mineReqOf(url); if (!r) return;
    if (!this.last || at >= this.last.at) this.last = { op: r.op, key: r.key, at };
    if (r.op === 'enter' && (!this.lastEnter || at >= this.lastEnter.at)) this.lastEnter = { key: r.key, at };
  }
  /** Key of the latest request at or after `since` (performance.now() ms); null after a leave or with none. */
  keySince(since = -Infinity): string | null { const l = this.last; return l && l.at >= since && l.op !== 'leave' ? l.key : null; }
  /** Did anybody send a mine enter at or after `since`? */
  enteredSince(since: number): boolean { return !!this.lastEnter && this.lastEnter.at >= since; }
}

let LOG: MineReqLog | null = null;
let OBS: PerformanceObserver | null = null;
const feedEntries = (L: MineReqLog, list: PerformanceEntryList) => { for (const e of list) if (e.name.includes('/api/mine/')) L.feed(e.name, e.startTime); };
/** The page-wide log (started once, by src/content/main.ts at load; also lazily). */
export function mineReqLog(): MineReqLog {
  if (LOG) return LOG;
  const L = LOG = new MineReqLog();
  try {
    if (typeof PerformanceObserver === 'function') {
      OBS = new PerformanceObserver((l) => feedEntries(L, l.getEntries()));
      OBS.observe({ type: 'resource', buffered: true });
    }
  } catch { OBS = null; }
  return L;
}
/** The floor key the site's mine works on (its requests since `since`), with the resource buffer as a fallback. */
export function siteMineKey(since = -Infinity): string | null {
  const L = mineReqLog();
  try { if (!OBS && typeof performance !== 'undefined' && performance.getEntriesByType) feedEntries(L, performance.getEntriesByType('resource')); } catch { /* */ }
  return L.keySince(since);
}

/* ------------------------------------------------------------------ holding the site's mine under the 3D one */

/** A 2D ⇄ 3D switch of the mine is still in progress (the 3D mine opening over the site's): F8 waits for it. */
let SWITCHING = false;
export const mineSwitching = (): boolean => SWITCHING;
export const setMineSwitching = (on: boolean): void => { SWITCHING = on; };

export const HOLD_CLASS = 'l3d-mnhold';
const HOLD_CSS = `html.${HOLD_CLASS} .mn{display:none!important}`;
let heldKey: string | null = null;

/** Hide (on) / show (off) the site's 2D mine under the 3D mine. Idempotent. `key`: the floor it works on (default: read now). */
export function holdSiteMine(on: boolean, key?: string | null, doc: Document = document): void {
  const root = doc.documentElement;
  if (on) {
    if (!doc.getElementById('l3d-mnhold-css')) { const st = doc.createElement('style'); st.id = 'l3d-mnhold-css'; st.textContent = HOLD_CSS; doc.head.appendChild(st); }
    if (!doc.querySelector('[data-l3d-mnhold]')) {
      const s = doc.createElement('div'); s.className = 'mn-board-w'; s.hidden = true;
      s.setAttribute('data-l3d-mnhold', ''); s.setAttribute('aria-hidden', 'true'); s.style.setProperty('display', 'none', 'important');
      doc.body.appendChild(s);
    }
    root.classList.add(HOLD_CLASS);
    heldKey = key !== undefined ? key : siteMineKey();
  } else {
    root.classList.remove(HOLD_CLASS);
    doc.querySelector('[data-l3d-mnhold]')?.remove();
  }
}
/** Is the site's mine held (hidden) under the 3D mine now? */
export const siteMineHeld = (doc: Document = document): boolean => doc.documentElement.classList.contains(HOLD_CLASS);
/** The floor the held site mine works on (as seen when it was hidden / last shown). */
export const heldSiteKey = (): string | null => heldKey;
export const setHeldSiteKey = (k: string | null): void => { heldKey = k; };

/**
 * The 3D mine closes for good (walked out of it) while the site's mine is held: the site's own «В город» — LGMine.exit()
 * sends its mine leave and wakes the City (city enter). The fetch tee goes on first (the mine screen is gone the same
 * moment), so the City's enter answer (players, chat, ignore list) reaches the 3D street.
 */
export function exitSiteMine(w: W0 = win(), doc: Document = document): boolean {
  holdSiteMine(false, null, doc);
  if (!siteMineOpen(w, doc)) return false;
  setFetchTee(true);
  try { if (w.LGMine?.exit) { w.LGMine.exit(); return true; } } catch (e) { console.warn('[legion-3d] site mine exit', e); }
  return false;
}

/**
 * Show the site's 2D mine for the classic view (F8 out of the 3D mine) and give it the presence back: when it says
 * «Шахта открыта в другой вкладке» (our 3D client entered after it) press its own «Копать здесь» — once, within `ms`.
 * Returns the stop function.
 */
export function showSiteMine(doc: Document = document, ms = 40000): () => void {
  holdSiteMine(false, null, doc);
  let done = false, t = 0, iv = 0;
  const stop = () => { done = true; if (iv) clearInterval(iv); if (t) clearTimeout(t); iv = t = 0; };
  const look = () => {
    if (done) return;
    const o = doc.querySelector<HTMLElement>('.mn .mn-other');
    const b = o && !o.hidden ? o.querySelector<HTMLButtonElement>('[data-mn-here]') : null;
    if (b) { b.click(); stop(); }
  };
  look();
  if (!done) { iv = window.setInterval(look, 400); t = window.setTimeout(stop, ms); }
  return stop;
}

/**
 * F8 out of a 3D mine entered from the 3D street (the site's mine is not open, its City is live): open the site's mine the
 * way a click on the mine does (LGCity.panel('mine') → the site: city sleep + mine enter). In the Fair with the testers'
 * mine the site asks which one: pick `key`'s mine. Returns false when the City cannot do it.
 */
export function openSiteMine(key: string, w: W0 = win(), doc: Document = document): boolean {
  if (siteMineOpen(w, doc) || !cityLive(w)) return false;
  try { w.LGCity!.panel!('mine'); } catch { return false; }
  const base = mineBase(key);
  if (!MINE_KEY_RE.test(base)) return true;
  let n = 0;
  const pick = () => {
    const b = doc.querySelector<HTMLButtonElement>(`.mn-board-w [data-go="${base}"]`);
    if (b) { b.click(); return; }
    if (!siteMineOpen(w, doc) && ++n < 10) window.setTimeout(pick, 300);
  };
  window.setTimeout(pick, 300);
  return true;
}
