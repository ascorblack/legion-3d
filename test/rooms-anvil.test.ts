/**
 * The anvil room hooks the site's real enchant run: window.LGCity.forgeStart / forgeFx / forgeCancel are wrapped while
 * the room is open (the site's own function still runs first) and drive the 3D smith (AnvilFx); dispose restores them.
 * Fake LGCity and a fake smith — nothing touches the site.
 */
import { describe, it, expect, beforeAll, vi } from 'vitest';
import * as THREE from 'three';

beforeAll(() => {
  const ctx = new Proxy({}, {
    get: (_t, k) => {
      if (k === 'getImageData' || k === 'createImageData') return (_x: number, _y?: number, w = 4, h = 4) => ({ data: new Uint8ClampedArray((w || 4) * (h || 4) * 4), width: w, height: h });
      if (k === 'createLinearGradient' || k === 'createRadialGradient' || k === 'createPattern') return () => ({ addColorStop() {} });
      if (k === 'measureText') return () => ({ width: 10 });
      return () => {};
    },
    set: () => true,
  });
  (globalThis as any).document = { createElement: () => ({ width: 0, height: 0, style: {}, getContext: () => ctx }) };
});

const fakeSmith = () => ({ av: { play: vi.fn((..._a: unknown[]) => {}) }, say: vi.fn((..._a: unknown[]) => {}), busy: false });

describe('anvil: site forge hook', () => {
  it('wraps forgeStart/forgeFx/forgeCancel, calls the site first, restores the originals', async () => {
    const { hookSiteForge } = await import('../src/rooms/hybrid/anvil');
    const order: string[] = [];
    const site = { forgeStart: vi.fn((..._a: unknown[]) => order.push('site:start')), forgeFx: vi.fn((..._a: unknown[]) => order.push('site:fx')), forgeCancel: vi.fn((..._a: unknown[]) => order.push('site:cancel')), other: 1 };
    const o = { forgeStart: site.forgeStart, forgeFx: site.forgeFx, forgeCancel: site.forgeCancel };
    const win = { LGCity: site };
    const sink = { start: vi.fn((..._a: unknown[]) => order.push('3d:start')), fx: vi.fn((..._a: unknown[]) => order.push('3d:fx')), cancel: vi.fn((..._a: unknown[]) => order.push('3d:cancel')) };
    const off = hookSiteForge(sink, win);
    expect(win.LGCity.forgeStart).not.toBe(o.forgeStart);
    const item = { uid: 'u1', id: 'gladius', slot: 'weapon', name: 'Гладиус' };
    win.LGCity.forgeStart(item, 7);
    win.LGCity.forgeFx({ op: 'enchant', out: 'up', to: 7 });
    win.LGCity.forgeCancel();
    expect(order).toEqual(['site:start', '3d:start', 'site:fx', '3d:fx', 'site:cancel', '3d:cancel']);
    expect(o.forgeStart).toHaveBeenCalledWith(item, 7);
    expect(sink.start).toHaveBeenCalledWith(item, 7);
    expect(sink.fx).toHaveBeenCalledWith({ op: 'enchant', out: 'up', to: 7 });
    // a failing 3D side never breaks the site's call
    sink.fx.mockImplementationOnce(() => { throw new Error('boom'); });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(() => win.LGCity.forgeFx({ out: 'broken' })).not.toThrow();
    warn.mockRestore();
    off();
    expect(win.LGCity.forgeStart).toBe(o.forgeStart);
    expect(win.LGCity.forgeFx).toBe(o.forgeFx);
    expect(win.LGCity.forgeCancel).toBe(o.forgeCancel);
    expect((win.LGCity as any).other).toBe(1);
  });
  it('no LGCity → no-op; missing functions are removed again on restore; foreign re-wraps are left alone', async () => {
    const { hookSiteForge } = await import('../src/rooms/hybrid/anvil');
    const sink = { start: vi.fn(), fx: vi.fn(), cancel: vi.fn() };
    expect(() => hookSiteForge(sink, {})()).not.toThrow();
    const L: any = {};
    const off = hookSiteForge(sink, { LGCity: L });
    L.forgeStart({}, 2); expect(sink.start).toHaveBeenCalled();
    const theirs = () => 0; L.forgeFx = theirs;
    off();
    expect('forgeStart' in L).toBe(false);
    expect(L.forgeFx).toBe(theirs);
  });
});

describe('anvil: AnvilFx state machine', () => {
  const run = async (out: string | null, tg: number, answerAtBlow: number | 'after') => {
    const { AnvilFx, blowsFor, BEAT } = await import('../src/rooms/hybrid/anvil');
    const smith = fakeSmith();
    const fx = new AnvilFx({ top: new THREE.Vector3(1, 0.87, -2), smith: smith as any });
    expect(smith.busy).toBe(true);
    let t = 0;
    const step = (s: number) => { for (let i = 0; i < Math.round(s / 0.02); i++) { t += 0.02; fx.update(0.02, t); } };
    step(0.5);
    const swingsIdle = smith.av.play.mock.calls.length;
    fx.start({ id: 'gladius', slot: 'weapon', rarity: 'rare', name: 'Гладиус' }, tg);
    expect(fx.state).toBe('work');
    const n = blowsFor(tg);
    if (answerAtBlow !== 'after' && out) { step(BEAT * answerAtBlow + 0.05); fx.fx({ op: 'enchant', out, to: tg }); expect(fx.state).toBe('work'); }
    step(BEAT * n + 0.3);
    expect(fx.struck).toBe(n);
    expect(smith.av.play.mock.calls.slice(swingsIdle).filter((c) => c[0] === 'swing').length).toBeGreaterThanOrEqual(n);
    if (answerAtBlow === 'after') {
      expect(fx.state).toBe('wait');
      if (out) fx.fx({ op: 'enchant', out, to: tg });
    }
    return { fx, smith, step };
  };
  it('blows by level like the site', async () => {
    const { blowsFor } = await import('../src/rooms/hybrid/anvil');
    expect([1, 3, 4, 6, 7, 10, 11, 15].map(blowsFor)).toEqual([2, 2, 3, 3, 4, 4, 5, 5]);
  });
  it('success: result waits for the blows, then golden burst + «+N», then back to idle', async () => {
    const { fx, smith, step } = await run('up', 5, 1);
    expect(fx.shown).toBe('ok');
    expect(fx.state).toBe('result');
    expect(smith.say).toHaveBeenLastCalledWith(expect.stringContaining('+5'), expect.any(Number), expect.any(Number));
    step(4);
    expect(fx.state).toBe('idle');
    fx.dispose();
    expect(smith.busy).toBe(false);
  });
  it('broken after the blows (late answer) → smoke, item hidden; down → save', async () => {
    const a = await run('broken', 9, 'after');
    expect(a.fx.shown).toBe('bad');
    a.fx.dispose();
    const b = await run('down', 12, 2);
    expect(b.fx.shown).toBe('save');
    b.fx.dispose();
  });
  it('cancel stops the blows', async () => {
    const { AnvilFx } = await import('../src/rooms/hybrid/anvil');
    const smith = fakeSmith();
    const fx = new AnvilFx({ top: new THREE.Vector3(0, 0.9, 0), smith: smith as any });
    let t = 0; const step = (s: number) => { for (let i = 0; i < Math.round(s / 0.02); i++) { t += 0.02; fx.update(0.02, t); } };
    fx.start(null, 14); step(0.7);
    const struck = fx.struck;
    fx.cancel(); step(2);
    expect(fx.state).toBe('idle'); expect(fx.struck).toBe(struck); expect(fx.result).toBe(null);
    fx.dispose();
  });
});

describe('anvil: site 03.11 forge v3 scene (LGCity.anvil.ani)', () => {
  it('aniBeat maps the site steps', async () => {
    const { aniBeat } = await import('../src/rooms/hybrid/anvil');
    expect(aniBeat('', 'in', true)).toBe(null);
    expect(aniBeat('in', 'heat', true)).toBe('heat');
    expect(aniBeat('heat', 'hit1', true)).toBe('hit');
    expect(aniBeat('hit1', 'hit1', true)).toBe(null);
    expect(aniBeat('hit3', 'quench', true)).toBe(null);
    expect(aniBeat('tense', 'r-up', true)).toBe('show');
    expect(aniBeat('hit2', '', false)).toBe('show');   // «Пропустить» / finished
  });
  it('siteAniOf reads LGCity.anvil.ani lazily and never throws', async () => {
    const { siteAniOf, siteForgeV3 } = await import('../src/rooms/hybrid/anvil');
    const win: any = {};
    const read = siteAniOf(win);
    expect(read()).toBe(null);
    win.LGCity = { anvil: { ani: () => ({ on: true, kind: 'magic', step: 'rise' }) } };
    expect(read()).toEqual({ on: true, kind: 'magic', step: 'rise' });
    win.LGCity.anvil.ani = () => { throw new Error('x'); };
    expect(read()).toBe(null);
    expect(siteForgeV3({ querySelector: () => ({}) })).toBe(true);
    expect(siteForgeV3({ querySelector: () => null })).toBe(false);
  });
  it('v3: no blows while waiting; after the result it follows the site (3 blows, result at r-*)', async () => {
    const { AnvilFx } = await import('../src/rooms/hybrid/anvil');
    const smith = fakeSmith();
    const site = { on: false, kind: 'metal', step: '' };
    const fx = new AnvilFx({ top: new THREE.Vector3(0, 0.9, 0), smith: smith as any, siteAni: () => ({ ...site }), siteV3: () => true });
    let t = 0; const step = (s: number) => { for (let i = 0; i < Math.round(s / 0.02); i++) { t += 0.02; fx.update(0.02, t); } };
    step(0.3);
    fx.start({ id: 'gladius', slot: 'weapon', rarity: 'rare', name: 'Гладиус' }, 5);
    step(2);
    expect(fx.struck).toBe(0);
    expect(fx.state).toBe('wait');
    site.on = true; site.step = 'in';
    fx.fx({ op: 'enchant', out: 'up', to: 5 });
    expect(fx.follow).toBe(true);
    for (const s of ['heat', 'hit1', 'hit2', 'hit3', 'quench']) { site.step = s; step(0.3); }
    expect(fx.struck).toBe(3);
    expect(fx.shown).toBe(null);   // the site is still animating: no spoiler
    site.step = 'r-up'; step(0.2);
    expect(fx.shown).toBe('ok');
    expect(fx.follow).toBe(false);
    fx.dispose();
  });
  it('v3 skipped («Пропустить» or the skip setting): the result shows at once', async () => {
    const { AnvilFx } = await import('../src/rooms/hybrid/anvil');
    const site = { on: true, kind: 'magic', step: 'rise' };
    const fx = new AnvilFx({ top: new THREE.Vector3(0, 0.9, 0), smith: fakeSmith() as any, siteAni: () => ({ ...site }), siteV3: () => true });
    let t = 0; const step = (s: number) => { for (let i = 0; i < Math.round(s / 0.02); i++) { t += 0.02; fx.update(0.02, t); } };
    fx.start(null, 3); step(0.5);
    fx.fx({ out: 'broken' });
    site.step = 'hit1'; step(0.2);
    expect(fx.struck).toBe(1);
    site.on = false; site.step = ''; step(0.2);
    expect(fx.shown).toBe('bad');
    // no scene at all (skip setting): shown right away
    const fx2 = new AnvilFx({ top: new THREE.Vector3(0, 0.9, 0), smith: fakeSmith() as any, siteAni: () => ({ on: false }), siteV3: () => true });
    fx2.start(null, 3); fx2.update(0.02, 1);
    fx2.fx({ out: 'up', to: 3 });
    expect(fx2.shown).toBe('ok');
    fx.dispose(); fx2.dispose();
  });
});
