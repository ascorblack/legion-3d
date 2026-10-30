import { describe, it, expect, beforeAll } from 'vitest';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { buildSync } from 'esbuild';
// @ts-expect-error plain .mjs helper shared with the browser e2e
import { probeSource, fixtureDrift } from '../e2e/site-telemetry.mjs';

/**
 * The site's real anti-bot probe (mine.js tlPi, test/fixtures/site-telemetry.js) against our real bridge bundle, in a
 * page-like vm context: the site's own <head> fetch wrapper runs after the bridge, as on the live page.
 * `pi` (bit 1) must stay 0 in 2D mode — and become 1 while the tee is on, which proves the probe really sees a foreign wrapper.
 */
const bridgeSrc = (() => buildSync({ entryPoints: ['src/bridge/bridge.ts'], bundle: true, write: false, format: 'iife', target: 'es2022' }).outputFiles[0].text)();
const startSrc = (() => buildSync({ entryPoints: ['src/bridge/start.ts'], bundle: true, write: false, format: 'iife', globalName: '__st', target: 'es2022' }).outputFiles[0].text + ';const autoStart3d = __st.autoStart3d;')();
const siteWrapper = readFileSync('test/fixtures/site-fetch-wrapper.js', 'utf8');

/** A stand-in for a browser built-in: toString() says [native code], like window.fetch / requestAnimationFrame. */
const native = (fn: (...a: any[]) => any) => Function.prototype.bind.call(fn, null);

function page(opts: { start?: string; auto?: string; path?: string } = {}) {
  const store = new Map<string, string>(); if (opts.start) store.set('l3d.start', opts.start); if (opts.auto) store.set('l3d.auto', opts.auto);
  const ses = new Map<string, string>();
  const sb: any = {
    console, setTimeout, clearTimeout, Response, URL,
    location: { pathname: opts.path || '/c/channel/' },
    localStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v) },
    sessionStorage: { getItem: (k: string) => ses.get(k) ?? null, setItem: (k: string, v: string) => ses.set(k, v) },
  };
  sb.window = sb;
  sb.fetch = native(async () => new Response('{"ok":true}'));
  sb.requestAnimationFrame = native(() => 1);
  sb.EventSource = native(function (this: any) { /* unused */ });
  vm.createContext(sb);
  const nativeFetch = sb.fetch;
  return {
    sb, nativeFetch,
    run: (src: string) => vm.runInContext(src, sb),
    bridge() { vm.runInContext(bridgeSrc, sb); },
    site() { vm.runInContext(siteWrapper, sb); },
    pi(): number { return vm.runInContext('window.__l3dPi()', sb); },
  };
}
const withProbe = (p: ReturnType<typeof page>) => { p.run(probeSource()); return p; };

describe('site bot telemetry vs the bridge (pi, bit 1 = window.fetch not native / not the site wrapper)', () => {
  beforeAll(() => {
    const d = fixtureDrift();   // only when a site dump is present in .local
    if (d) expect(d.missing, `test/fixtures/site-telemetry.js differs from ${d.dump}/mine.js — refresh it`).toEqual([]);
  });

  it('the probe is the real one: a plain page is clean, a foreign fetch wrapper is flagged', () => {
    const p = withProbe(page());
    p.site();
    expect(p.pi()).toBe(0);
    p.run('(function(){ const f = window.fetch; window.fetch = function (u, o) { return f(u, o); }; })()');
    expect(p.pi() & 1).toBe(1);
  });

  it('2D (default start mode): after bridge + site wrapper pi is 0 and window.fetch is the site wrapper', () => {
    const p = withProbe(page());
    p.bridge(); p.site();
    expect(p.run('typeof window.__L3D_BUS.fetchTee.on')).toBe('function');
    expect(p.run('window.__L3D_BUS.fetchTee.installed()')).toBe(false);
    expect(p.run('window.fetch === window.LG_FETCH.w && window.LG_FETCH.n')).toBe(true);
    expect(p.pi()).toBe(0);
  });

  it('the EventSource tee is not part of the check (bridge keeps it in 2D): pi stays 0 with it', () => {
    const p = withProbe(page());
    p.bridge(); p.site();
    expect(p.run('window.EventSource === undefined || !/native code/.test(Function.prototype.toString.call(window.EventSource))')).toBe(true);   // wrapped, honestly
    expect(p.pi()).toBe(0);
  });

  it('3D mode flags it, back to classic (F8) gives the site its own fetch back exactly', () => {
    const p = withProbe(page());
    p.bridge(); p.site();
    const siteFetch = p.sb.fetch;
    expect(p.run('window.__L3D_BUS.fetchTee.on()')).toBe(true);
    expect(p.sb.fetch).not.toBe(siteFetch);
    expect(p.pi() & 1).toBe(1);   // this is why 2D must not carry it
    expect(p.run('window.__L3D_BUS.fetchTee.off()')).toBe(true);
    expect(p.sb.fetch).toBe(siteFetch);
    expect(p.pi()).toBe(0);
    // and again (3D → classic → 3D → classic)
    p.run('window.__L3D_BUS.fetchTee.on()'); expect(p.pi() & 1).toBe(1);
    p.run('window.__L3D_BUS.fetchTee.off()'); expect(p.pi()).toBe(0); expect(p.sb.fetch).toBe(siteFetch);
  });

  it('the bridge never takes window.fetch at document_start, whatever the start mode — a tee under the site wrapper could not come out', () => {
    for (const q of [{}, { start: '2d' }, { start: '3d' }, { start: 'last', auto: '1' }, { start: 'last', auto: '0' }]) {
      const p = withProbe(page(q)); p.bridge(); p.site();
      expect(p.run('window.__L3D_BUS.fetchTee.installed()'), JSON.stringify(q)).toBe(false);
      expect(p.sb.fetch, JSON.stringify(q)).toBe(p.sb.LG_FETCH.w);
      expect(p.pi(), JSON.stringify(q)).toBe(0);
    }
  });

  it('3D started by the launcher (tee on after the site wrapper) and F8 / boot failure → tee off → pi 0', () => {
    const p = withProbe(page({ start: '3d' })); p.bridge(); p.site();
    p.run('window.__L3D_BUS.fetchTee.on()');
    expect(p.pi() & 1).toBe(1);
    p.run('window.__L3D_BUS.fetchTee.off()');
    expect(p.pi()).toBe(0);
  });

  it('autoStart3d: the launcher rule for start modes (src/bridge/start.ts)', () => {
    const run = (q: { start?: string; auto?: string; path?: string; nogl?: boolean }) => {
      const p = page(q); if (q.nogl) p.sb.sessionStorage.setItem('l3d.noWebGL', '1');
      return vm.runInContext(startSrc + ';autoStart3d(window)', p.sb);
    };
    expect(run({})).toBe(false); expect(run({ start: '2d' })).toBe(false); expect(run({ start: '3d' })).toBe(true);
    expect(run({ start: 'last' })).toBe(true); expect(run({ start: 'last', auto: '1' })).toBe(true); expect(run({ start: 'last', auto: '0' })).toBe(false);
    expect(run({ start: '3d', nogl: true })).toBe(false); expect(run({ start: '3d', path: '/c/channel/sub/' })).toBe(false);
  });

  it('someone wrapped fetch over ours: off() cannot take it out — it turns into a pass-through that tees nothing', async () => {
    const p = withProbe(page()); p.bridge(); p.site();
    const got: unknown[] = [];
    p.run('window.__L3D_BUS.fetchTee.on()');
    p.sb.__L3D_BUS.on('me', (d: unknown) => got.push(d));
    p.run('(function(){ const f = window.fetch; window.fetch = function (u, o) { return f(u, o); }; })()');
    expect(p.run('window.__L3D_BUS.fetchTee.off()')).toBe(false);
    await p.sb.fetch('/api/me'); await new Promise((r) => setTimeout(r, 10));
    expect(got).toEqual([]);
    expect(p.run('window.__L3D_BUS.fetchTee.on()')).toBe(false);   // woke the buried wrapper up, did not stack another one
    await p.sb.fetch('/api/me'); await new Promise((r) => setTimeout(r, 10));
    expect(got).toEqual([{ ok: true }]);
  });

  it('the tee still copies the watched answers while on (equip / me / city enter / ignore) and leaves the body to the page', async () => {
    const p = withProbe(page()); p.bridge(); p.site();
    const seen: Record<string, unknown[]> = {};
    for (const t of ['me', 'hero:act', 'city:enter', 'city:ignore', 'city:state']) { seen[t] = []; p.sb.__L3D_BUS.on(t, (d: unknown) => seen[t].push(d)); }
    p.run('window.__L3D_BUS.fetchTee.on()');
    const urls = ['/api/me', '/api/equip', '/api/city/enter', '/api/city/chat/ignore', '/api/city/state?c=3', '/api/other'];
    for (const u of urls) { const r = await p.sb.fetch(u, { method: 'POST' }); expect(await r.json()).toEqual({ ok: true }); }
    await new Promise((r) => setTimeout(r, 20));
    for (const t of Object.keys(seen)) expect(seen[t], t).toEqual([{ ok: true }]);
    // classic: nothing is copied any more
    p.run('window.__L3D_BUS.fetchTee.off()');
    await p.sb.fetch('/api/equip'); await new Promise((r) => setTimeout(r, 20));
    expect(seen['hero:act'].length).toBe(1);
  });
});
