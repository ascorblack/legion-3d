/** Expedition-only boot (hero in an expedition party, City tab locked): card logic, city-tab reading, the session
 *  (no city requests, quest views from the bus) and the feature whitelist. */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';

type Listener = (d: any) => void;
const makeBus = () => {
  const subs = new Map<string, Set<Listener>>();
  return {
    last: {} as Record<string, any>,
    on(t: string, fn: Listener) { let s = subs.get(t); if (!s) subs.set(t, (s = new Set())); s.add(fn); return () => { s!.delete(fn); }; },
    emit(t: string, d: any) { this.last[t] = d; for (const fn of subs.get(t) || []) fn(d); },
  };
};
const fakeDoc = (attrs: Record<string, string> | null, hidden = false) => {
  const cls = new Set<string>();
  const btn = attrs && { hidden, getAttribute: (k: string) => attrs[k] ?? null };
  return {
    cls,
    querySelector: (sel: string) => (sel.includes('data-tab="city"') ? btn : null),
    createElement: () => ({ remove() { /* */ } }),
    head: { appendChild() { /* */ } },
    documentElement: { classList: { add: (c: string) => cls.add(c), remove: (c: string) => cls.delete(c), toggle: (c: string, on: boolean) => (on ? cls.add(c) : cls.delete(c)), contains: (c: string) => cls.has(c) } },
  };
};

const reqs: string[] = [];
const teeLog: string[] = [];
const bus = Object.assign(makeBus(), { fetchTee: { on: () => { teeLog.push('on'); return true; }, off: () => { teeLog.push('off'); return true; }, installed: () => false } });
// stubs before any module that reads `window` at load time is imported (collection of the describe blocks below)
{
  vi.stubGlobal('window', { __L3D_BUS: bus, addEventListener() { /* */ }, dispatchEvent() { return true; } });
  vi.stubGlobal('document', fakeDoc({ 'aria-disabled': 'true' }));
  vi.stubGlobal('fetch', async (url: string) => {
    reqs.push(String(url));
    const body = /\/api\/me$/.test(url) ? { ok: true, user: { login: 'Player1' }, hero: { login: 'player1', name: 'Player1', level: 6, role: 'archer', look: {}, gear: {}, cy: 1 }, ql: { on: true, k: 'gather', n: 3 } } : { ok: false };
    return { json: async () => body } as Response;
  });
}
let mod: typeof import('../src/net/expedition-site');
beforeAll(async () => { mod = await import('../src/net/expedition-site'); });
afterAll(() => { vi.unstubAllGlobals(); });

describe('expCard', async () => {
  const { expCard } = await import('../src/features/expedition-only');
  it('nothing while the expedition runs and the City is locked', () => { expect(expCard(true, 'locked', true)).toBe('none'); });
  it('waits before the first running view', () => { expect(expCard(false, 'locked', false)).toBe('wait'); });
  it('over when it ended (button only once the City opens)', () => {
    expect(expCard(false, 'locked', true)).toBe('over');
    expect(expCard(false, 'open', true)).toBe('over');
    expect(expCard(false, 'open', false)).toBe('over');
  });
  it('City opened while a view still runs (left the party) → small «open» card', () => { expect(expCard(true, 'open', true)).toBe('open'); });
  it('a hidden tab counts as locked', () => { expect(expCard(true, 'missing', true)).toBe('none'); });
});

describe('cityTab', () => {
  it('reads the site button state', () => {
    expect(mod.cityTab(fakeDoc({ 'aria-disabled': 'true' }) as unknown as Document)).toBe('locked');
    expect(mod.cityTab(fakeDoc({}) as unknown as Document)).toBe('open');
    expect(mod.cityTab(fakeDoc({}, true) as unknown as Document)).toBe('missing');
    expect(mod.cityTab(fakeDoc(null) as unknown as Document)).toBe('missing');
  });
});

describe('connectExpedition', () => {
  it('builds a city-less session fed by the bus; no city requests', async () => {
    const s = await mod.connectExpedition();
    expect(s).not.toBeNull();
    const st = s!.store;
    expect(s!.expeditionOnly).toBe(true);
    expect(st.layout?.id).toBe(mod.EXP_LAYOUT_ID);
    expect(st.layout?.buildings.length).toBe(0);
    expect(st.me?.login).toBe('player1');
    expect((st.quest as any)?.k).toBe('gather');            // /api/me ql
    bus.emit('sse:q', { on: true, k: 'battle' });
    expect((st.quest as any)?.k).toBe('battle');
    bus.emit('q', { on: false });
    expect(st.quest?.on).toBe(false);
    bus.emit('sse:me', { hero: { login: 'player1', name: 'Player1', level: 7, look: {}, gear: {} } });
    expect(st.hero?.level).toBe(7);
    s!.moveTo(10, 10); s!.tick(0.016);
    const say = await s!.actions.say('hi');
    expect(say.ok).toBe(false);
    expect(reqs.every((u) => !/\/api\/city/.test(u))).toBe(true);
    expect(reqs).toEqual(['/api/me']);
    // F8 shows the site again (class off), dispose unsubscribes
    expect((document as any).cls.has('l3d-exp')).toBe(true);
    s!.setClassic(true); expect((document as any).cls.has('l3d-exp')).toBe(false);
    s!.setClassic(false); expect((document as any).cls.has('l3d-exp')).toBe(true);
    s!.dispose(); expect((document as any).cls.has('l3d-exp')).toBe(false);
    // the fetch tee follows the mode: off in the classic site, back on in 3D, off for good at dispose
    expect(teeLog).toEqual(['off', 'on', 'off']);
    bus.emit('sse:q', { on: true, k: 'after-dispose' });
    expect((st.quest as any)?.k).not.toBe('after-dispose');
  });
  it('reuses an /api/me answer it is given', async () => {
    const n = reqs.length;
    const s = await mod.connectExpedition({ user: { login: 'x' }, hero: { login: 'x', name: 'X', look: {}, gear: {} } });
    expect(s?.store.me?.login).toBe('x');
    expect(reqs.length).toBe(n);
    s?.dispose();
  });
});

describe('EXP_ONLY_FEATURES', () => {
  it('names real features (a rename would silently drop it from the expedition-only game)', async () => {
    const [{ FEATURES }, { EXP_ONLY_FEATURES }] = await Promise.all([import('../src/features'), import('../src/features/expedition-only')]);
    const ids = new Set(FEATURES.map((f) => f.id));
    for (const id of EXP_ONLY_FEATURES) expect(ids.has(id), id).toBe(true);
    // never the ones that need the City
    for (const id of ['crowd', 'doors', 'rooms', 'travel', 'hwcity', 'flight', 'mine-status']) expect(EXP_ONLY_FEATURES.has(id)).toBe(false);
  });
});
