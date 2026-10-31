import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MEl, makeDoc } from './minidom';
import {
  mineReqOf, MineReqLog, cityReplayAllowed, holdSiteMine, siteMineHeld, showSiteMine, exitSiteMine, openSiteMine, siteMineOpen,
} from '../src/net/site-mine';

/** The site's own mine (mine.js) seen from the extension: floor key from its requests, the City-enter replay guard, holding. */
type Doc = ReturnType<typeof makeDoc> & { head: MEl };
const doc0 = (): Doc => {
  const d = makeDoc() as Doc;
  d.head = new MEl('head'); d.documentElement.childNodes.unshift(d.head); d.head.parentElement = d.documentElement;
  return d;
};
// minidom has no CSSStyleDeclaration and read-only id / className: enough of them for the code under test
for (const k of ['id', 'className'] as const) {
  const a = k === 'id' ? 'id' : 'class';
  Object.defineProperty(MEl.prototype, k, { configurable: true, get() { return (this as MEl).getAttribute(a) || ''; }, set(v: string) { (this as MEl).setAttribute(a, v); } });
}
Object.defineProperty(MEl.prototype, 'style', { configurable: true, get() { const el = this as MEl; return { setProperty: (k: string, v: string) => el.setAttribute('style', `${k}:${v}`) }; } });

const cityPage = (d: Doc, o: { on?: string; cy?: boolean; mine?: boolean; chooser?: boolean } = {}) => {
  d.body.innerHTML = `<nav class="tabs"><button data-tab="hero"></button><button data-tab="city"></button></nav>`
    + `<section class="tab${(o.on ?? 'city') === 'city' ? ' on' : ''}" id="tab-city">${o.cy !== false ? '<div class="cy" data-town="fair"></div>' : ''}</section>`
    + `<section class="tab${o.on === 'hero' ? ' on' : ''}" id="tab-hero"></section>`
    + (o.mine ? '<div class="mn" role="dialog"><div class="mn-other" hidden><button data-mn-here>Копать здесь</button></div></div>' : '')
    + (o.chooser ? '<div class="mn-board-w"><button data-go="home"></button><button data-go="t-v3"></button></div>' : '');
};

describe('mine floor key from the site\'s own requests (resource timing)', () => {
  it('reads op and key, with the channel prefix and other params; rejects foreign / malformed keys', () => {
    expect(mineReqOf('https://x/c/chan/api/mine/state?c=home.3&v=7&f=a')).toEqual({ op: 'state', key: 'home.3' });
    expect(mineReqOf('/api/mine/enter?c=d12')).toEqual({ op: 'enter', key: 'd12' });
    expect(mineReqOf('/api/mine/ping?c=t-v3')).toEqual({ op: 'ping', key: 't-v3' });
    expect(mineReqOf('/api/mine/leave?c=home')).toEqual({ op: 'leave', key: 'home' });
    expect(mineReqOf('/api/mine/chat/say?c=home')).toBeNull();
    expect(mineReqOf('/api/mineDig')).toBeNull();
    expect(mineReqOf('/api/mine/state?c=HOME%3Cx')).toBeNull();
  });
  it('the latest request wins (by start time, entries may come out of order); a leave means «not in the mine»', () => {
    const L = new MineReqLog();
    L.feed('/api/mine/enter?c=home', 100);
    L.feed('/api/mine/state?c=home.3', 300);
    L.feed('/api/mine/state?c=home', 200);   // older, arrives later
    expect(L.keySince()).toBe('home.3');
    expect(L.keySince(301)).toBeNull();      // nothing since the hold started
    expect(L.enteredSince(50)).toBe(true);
    expect(L.enteredSince(150)).toBe(false);
    L.feed('/api/mine/leave?c=home.3', 400);
    expect(L.keySince()).toBeNull();
  });
});

describe('cityReplayAllowed: the City enter is replayed only from the City scene itself', () => {
  let d: Doc;
  beforeEach(() => { d = doc0(); vi.stubGlobal('window', {}); });
  afterEach(() => { vi.unstubAllGlobals(); });
  it('City tab on with its scene → yes', () => { cityPage(d); expect(cityReplayAllowed(d as any, {} as any)).toBe(true); });
  it('the site\'s mine open (LGMine.on or the .mn screen) → never', () => {
    cityPage(d); expect(cityReplayAllowed(d as any, { LGMine: { on: true } } as any)).toBe(false);
    cityPage(d, { mine: true }); expect(cityReplayAllowed(d as any, {} as any)).toBe(false);
  });
  it('the City asleep under the mine (empty root), the mine chooser, another tab → never', () => {
    cityPage(d, { cy: false }); expect(cityReplayAllowed(d as any, {} as any)).toBe(false);
    cityPage(d, { chooser: true }); expect(cityReplayAllowed(d as any, {} as any)).toBe(false);
    cityPage(d, { on: 'hero' }); expect(cityReplayAllowed(d as any, {} as any)).toBe(false);
  });
});

describe('holding the site\'s mine under the 3D mine', () => {
  let d: Doc; let calls: string[];
  beforeEach(() => {
    d = doc0(); calls = [];
    vi.stubGlobal('window', {
      setInterval: (f: () => void, ms: number) => setInterval(f, ms), clearInterval: (h: any) => clearInterval(h),
      setTimeout: (f: () => void, ms: number) => setTimeout(f, ms),
      __L3D_BUS: { fetchTee: { on: () => { calls.push('tee:on'); return true; }, off: () => { calls.push('tee:off'); return true; }, installed: () => false } },
    });
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

  it('hide: html class + the CSS + one hidden .mn-board-w sentinel (the site\'s Esc then never closes its mine); show removes both', () => {
    cityPage(d, { mine: true, cy: false });
    holdSiteMine(true, 'home.3', d as any); holdSiteMine(true, 'home.3', d as any);
    expect(siteMineHeld(d as any)).toBe(true);
    expect(d.querySelectorAll('[data-l3d-mnhold]').length).toBe(1);
    const s = d.querySelector('[data-l3d-mnhold]')!;
    expect(s.classList.contains('mn-board-w') && s.hidden).toBe(true);
    expect(d.getElementById('l3d-mnhold-css')).toBeTruthy();
    holdSiteMine(false, null, d as any);
    expect(siteMineHeld(d as any)).toBe(false);
    expect(d.querySelector('[data-l3d-mnhold]')).toBeNull();
  });

  it('show: presses the site\'s own «Копать здесь» once it says «open in another tab» (and only then)', () => {
    vi.useFakeTimers();
    cityPage(d, { mine: true, cy: false });
    const here = d.querySelector('[data-mn-here]')!;
    holdSiteMine(true, 'home', d as any);
    const stop = showSiteMine(d as any, 5000);
    expect(siteMineHeld(d as any)).toBe(false);
    vi.advanceTimersByTime(1200);
    expect(here.clicks).toBe(0);                      // not «other»: nothing to take back
    d.querySelector('.mn-other')!.hidden = false;     // the site's poll noticed our 3D client
    vi.advanceTimersByTime(500);
    expect(here.clicks).toBe(1);
    vi.advanceTimersByTime(5000);
    expect(here.clicks).toBe(1);
    stop();
  });

  it('exit for good: fetch tee on first, then the site\'s own «В город» (LGMine.exit)', () => {
    cityPage(d, { mine: true, cy: false });
    const LGMine = { on: true, exit: () => { calls.push('LGMine.exit'); LGMine.on = false; } };
    holdSiteMine(true, 'home', d as any);
    expect(exitSiteMine({ LGMine } as any, d as any)).toBe(true);
    expect(calls).toEqual(['tee:on', 'LGMine.exit']);
    expect(siteMineHeld(d as any)).toBe(false);
    expect(exitSiteMine({ LGMine } as any, d as any)).toBe(false);   // already closed: nothing
  });

  it('open from the live City: LGCity.panel(mine), the chooser answered with the mine of the key', () => {
    vi.useFakeTimers();
    cityPage(d);
    const panel: string[] = [];
    const w = { LGMine: { on: false }, LGCity: { debug: () => ({}), panel: (id: string) => { panel.push(id); cityPage(d, { chooser: true }); } } };
    expect(openSiteMine('t-v3.2', w as any, d as any)).toBe(true);
    expect(panel).toEqual(['mine']);
    vi.advanceTimersByTime(400);
    expect(d.querySelector('[data-go="t-v3"]')!.clicks).toBe(1);
    expect(d.querySelector('[data-go="home"]')!.clicks).toBe(0);
    // a sleeping City (inside the mine) cannot: no panel, no wake
    expect(openSiteMine('home', { LGMine: { on: false }, LGCity: { debug: () => null, panel: () => panel.push('x') } } as any, d as any)).toBe(false);
    expect(panel).toEqual(['mine']);
  });

  it('siteMineOpen: LGMine.on wins, the .mn screen is the fallback', () => {
    cityPage(d);
    expect(siteMineOpen({ LGMine: { on: true } } as any, d as any)).toBe(true);
    expect(siteMineOpen({ LGMine: { on: false } } as any, d as any)).toBe(false);
    cityPage(d, { mine: true });
    expect(siteMineOpen({} as any, d as any)).toBe(true);
  });
});
