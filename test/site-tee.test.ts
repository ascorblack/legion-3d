import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';

/** replayCityEnter: 3D starts with the City tab already open → the tee missed `enter`; the tab cycle makes the site send it again. */
const clicks: string[] = [];
const btn = (tab: string, o: { hidden?: boolean; disabled?: boolean } = {}) => ({
  hidden: !!o.hidden, dataset: { tab }, getAttribute: (k: string) => (k === 'aria-disabled' && o.disabled ? 'true' : null),
  click: () => { clicks.push(tab); if (tab === 'city') bus.last['city:enter'] = { ok: true }; },
});
let tabs: ReturnType<typeof btn>[] = [];
const bus: { last: Record<string, any> } = { last: {} };
/** What the page shows: the City scene (default), the site's own mine over a sleeping City, or another tab. */
const page = { mine: false, cityScene: true, tab: 'city' };
const W: any = { __L3D_BUS: bus };
let mod: typeof import('../src/net/site');
beforeAll(async () => {
  vi.stubGlobal('window', W);
  vi.stubGlobal('document', {
    querySelector: (sel: string) => {
      if (sel === '#tab-city') return { classList: { contains: (c: string) => c === 'on' && page.tab === 'city' }, querySelector: (q: string) => (q === '.cy' && page.cityScene ? {} : null) };
      if (sel === '.mn') return page.mine ? {} : null;
      if (sel === '.mn-board-w') return null;
      const m = /data-tab="(\w+)"/.exec(sel); return (m && tabs.find((b) => b.dataset.tab === m[1] && !b.hidden)) || null;
    },
    querySelectorAll: (sel: string) => (sel === '.tab.on' ? [{ id: 'tab-' + page.tab }] : tabs.filter((b) => !b.hidden)),
    addEventListener() { /* */ },
  });
  mod = await import('../src/net/site');
});
afterAll(() => { vi.unstubAllGlobals(); });

describe('replayCityEnter', () => {
  it('another tab (hero) then the City tab again; resolves once the answer was teed', async () => {
    clicks.length = 0; bus.last = {};
    tabs = [btn('quest'), btn('hero'), btn('city')];
    await mod.replayCityEnter(tabs[2] as any, bus as any);
    expect(clicks).toEqual(['hero', 'city']);
    expect(bus.last['city:enter']).toBeTruthy();
  });
  it('without a hero tab any other enabled tab will do; disabled / hidden ones never', async () => {
    clicks.length = 0; bus.last = {};
    tabs = [btn('quest', { disabled: true }), btn('hero', { hidden: true }), btn('legion'), btn('city')];
    await mod.replayCityEnter(tabs[3] as any, bus as any);
    expect(clicks).toEqual(['legion', 'city']);
  });
  it('inside the site\'s own mine (0.6.1 bug: the replay woke the City under it — a city enter in the mine) → no click at all', async () => {
    clicks.length = 0; bus.last = {};
    tabs = [btn('hero'), btn('city')];
    page.mine = true; page.cityScene = false; W.LGMine = { on: true };
    await mod.replayCityEnter(tabs[1] as any, bus as any);
    expect(clicks).toEqual([]);
    W.LGMine = { on: false }; page.mine = false;
    await mod.replayCityEnter(tabs[1] as any, bus as any);   // the City still asleep (empty root): not the City scene either
    expect(clicks).toEqual([]);
    page.cityScene = true; page.tab = 'hero';                 // another tab in front
    await mod.replayCityEnter(tabs[1] as any, bus as any);
    expect(clicks).toEqual([]);
    page.tab = 'city'; delete W.LGMine;
  });
  it('no other tab to go to: leaves the page alone', async () => {
    clicks.length = 0; bus.last = {};
    tabs = [btn('city')];
    await mod.replayCityEnter(tabs[0] as any, bus as any);
    expect(clicks).toEqual([]);
  });
});
