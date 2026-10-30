import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';

/** replayCityEnter: 3D starts with the City tab already open → the tee missed `enter`; the tab cycle makes the site send it again. */
const clicks: string[] = [];
const btn = (tab: string, o: { hidden?: boolean; disabled?: boolean } = {}) => ({
  hidden: !!o.hidden, dataset: { tab }, getAttribute: (k: string) => (k === 'aria-disabled' && o.disabled ? 'true' : null),
  click: () => { clicks.push(tab); if (tab === 'city') bus.last['city:enter'] = { ok: true }; },
});
let tabs: ReturnType<typeof btn>[] = [];
const bus: { last: Record<string, any> } = { last: {} };
let mod: typeof import('../src/net/site');
beforeAll(async () => {
  vi.stubGlobal('window', { __L3D_BUS: bus });
  vi.stubGlobal('document', {
    querySelector: (sel: string) => { const m = /data-tab="(\w+)"/.exec(sel); return (m && tabs.find((b) => b.dataset.tab === m[1] && !b.hidden)) || null; },
    querySelectorAll: () => tabs.filter((b) => !b.hidden),
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
  it('no other tab to go to: leaves the page alone', async () => {
    clicks.length = 0; bus.last = {};
    tabs = [btn('city')];
    await mod.replayCityEnter(tabs[0] as any, bus as any);
    expect(clicks).toEqual([]);
  });
});
