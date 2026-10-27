/** «Update available» notice: semver, 12 h throttle, store-install skip, message validation, toast once per version, setting off. */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  RELEASES_API, CHECK_INTERVAL_MS, FETCH_TIMEOUT_MS, QUERY_TYPE, parseSemver, compareSemver, isNewer, isReleaseUrl, parseRelease,
  isStoreInstall, checkDue, sanitizeInfo, readPageMessage, isAskMessage, type UpdateState,
} from '../src/update/core';
import { createUpdateWorker } from '../src/update/worker';
import manifest from '../public/manifest.json';

const URL_OK = 'https://github.com/ascorblack/legion-3d/releases/tag/v0.4.2';
const doc = (tag = 'v0.4.2', url = URL_OK) => ({ tag_name: tag, html_url: url, name: 'x', assets: [{ browser_download_url: 'https://evil.example/a.js' }] });

describe('semver', () => {
  it('parses plain x.y.z (optional v) only', () => {
    expect(parseSemver('v0.4.2')).toEqual([0, 4, 2]);
    expect(parseSemver('1.10.0')).toEqual([1, 10, 0]);
    for (const bad of ['0.4', '0.4.2-beta', '1.2.3.4', 'latest', '', '<script>', 5, null, undefined, '9'.repeat(30) + '.0.0']) expect(parseSemver(bad)).toBeNull();
  });
  it('compares numerically, not lexically', () => {
    expect(compareSemver('0.10.0', '0.9.9')).toBeGreaterThan(0);
    expect(compareSemver('0.4.1', '0.4.2')).toBeLessThan(0);
    expect(compareSemver('v0.4.1', '0.4.1')).toBe(0);
    expect(compareSemver('x', '0.4.1')).toBeNull();
    expect(isNewer('0.4.2', '0.4.1')).toBe(true);
    expect(isNewer('0.4.1', '0.4.1')).toBe(false);
    expect(isNewer('0.4.0', '0.4.1')).toBe(false);
    expect(isNewer('junk', '0.4.1')).toBe(false);
  });
});

describe('release document', () => {
  it('reads only tag_name + html_url, and only github.com/ascorblack/legion-3d/releases links', () => {
    expect(parseRelease(doc())).toEqual({ latest: '0.4.2', url: URL_OK });
    expect(parseRelease(doc('0.5.0'))?.latest).toBe('0.5.0');
    expect(parseRelease(doc('nightly'))).toBeNull();
    expect(parseRelease(doc('v1.0.0', 'https://evil.example/ascorblack/legion-3d/releases/x'))).toBeNull();
    expect(parseRelease(doc('v1.0.0', 'javascript:alert(1)'))).toBeNull();
    expect(parseRelease(doc('v1.0.0', 'https://github.com/ascorblack/legion-3d/releases/tag/v1" onclick="x'))).toBeNull();
    expect(parseRelease(doc('v1.0.0', 'https://github.com@evil.example/ascorblack/legion-3d/releases/'))).toBeNull();
    expect(parseRelease(null)).toBeNull();
    expect(parseRelease('str')).toBeNull();
    expect(isReleaseUrl('https://github.com/ascorblack/legion-3d/releases/latest')).toBe(true);
    expect(isReleaseUrl('http://github.com/ascorblack/legion-3d/releases/latest')).toBe(false);
  });
});

describe('manifest', () => {
  it('asks for the narrowest network access and registers the worker + isolated relay', () => {
    expect(manifest.host_permissions).toEqual([RELEASES_API]);
    expect(manifest.permissions).toEqual(['storage']);
    expect(manifest.background.service_worker).toBe('background.js');
    const notify = manifest.content_scripts.find((c) => c.js.includes('notify.js'))!;
    expect(notify.matches).toEqual(['https://play.multidonate.ru/c/*']);
    expect((notify as { world?: string }).world).toBeUndefined();   // isolated
    expect(manifest.content_scripts.filter((c) => (c as { world?: string }).world === 'MAIN').length).toBe(2);
  });
});

describe('store install / throttle helpers', () => {
  it('store installs are the ones whose installed manifest carries update_url', () => {
    expect(isStoreInstall({ update_url: 'https://clients2.google.com/service/update2/crx' })).toBe(true);
    expect(isStoreInstall({})).toBe(false);
    expect(isStoreInstall({ update_url: '' })).toBe(false);
    expect(isStoreInstall(undefined)).toBe(false);
  });
  it('checkDue: 12 h interval, tolerant to a clock set back', () => {
    const now = 1_000_000_000_000;
    expect(checkDue({}, now)).toBe(true);
    expect(checkDue({ t: now - 1000 }, now)).toBe(false);
    expect(checkDue({ t: now - CHECK_INTERVAL_MS + 1 }, now)).toBe(false);
    expect(checkDue({ t: now - CHECK_INTERVAL_MS }, now)).toBe(true);
    expect(checkDue({ t: now + CHECK_INTERVAL_MS * 2 }, now)).toBe(true);
    expect(checkDue({ t: now + 1000 }, now)).toBe(false);
  });
});

describe('background worker (mocked fetch + storage)', () => {
  let store: UpdateState; let now: number; let fetchMock: ReturnType<typeof vi.fn>; let m: { version: string; update_url?: string };
  const make = () => createUpdateWorker({
    manifest: () => m, load: async () => structuredClone(store), save: async (s) => { store = structuredClone(s); },
    fetch: fetchMock as unknown as typeof fetch, now: () => now,
  });
  const ok = (body: unknown) => async () => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
  beforeEach(() => { store = {}; now = 1_800_000_000_000; m = { version: '0.4.1' }; fetchMock = vi.fn(ok(doc())); });

  it('fetches exactly the releases/latest URL, GET, without credentials, referrer or redirects', async () => {
    const info = await make().query(true);
    expect(info).toEqual({ current: '0.4.1', store: false, latest: '0.4.2', url: URL_OK });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, opts] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(RELEASES_API);
    expect(new URL(url).search).toBe('');
    expect(opts).toMatchObject({ method: 'GET', credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer' });
    expect(opts.body).toBeUndefined();
    expect(Object.keys(opts.headers as object)).toEqual(['Accept']);
  });
  it('at most once per 12 h (also across worker restarts: state lives in storage), then again when due', async () => {
    await make().query(true);
    now += 11 * 3600e3; const second = await make().query(true);    // a fresh worker, same storage
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(second.latest).toBe('0.4.2');                             // served from the cache
    now += 2 * 3600e3; await make().query(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it('concurrent queries share one request', async () => {
    const w = make();
    await Promise.all([w.query(true), w.query(true), w.query(true)]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it('a failed request is silent and still counts against the 12 h budget', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('offline'));
    const w = make();
    expect(await w.query(true)).toEqual({ current: '0.4.1', store: false });
    await w.query(true); now += 3600e3; await make().query(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it('rejects HTTP errors, junk JSON and foreign links without reporting anything', async () => {
    fetchMock.mockImplementationOnce(async () => new Response('{}', { status: 403 }));
    expect((await make().query(true)).latest).toBeUndefined();
    store = {}; fetchMock.mockImplementationOnce(ok({ tag_name: 'v9.9.9', html_url: 'https://evil.example/' }));
    expect((await make().query(true)).latest).toBeUndefined();
    store = {}; fetchMock.mockImplementationOnce(async () => new Response('<html>', { status: 200 }));
    expect((await make().query(true)).latest).toBeUndefined();
  });
  it('aborts a hanging request after 10 s', async () => {
    vi.useFakeTimers();
    try {
      let signal: AbortSignal | undefined;
      fetchMock.mockImplementationOnce((_u: string, opts: RequestInit) => { signal = opts.signal as AbortSignal; return new Promise((_r, rej) => signal!.addEventListener('abort', () => rej(new Error('aborted')))); });
      const p = make().query(true);
      await vi.advanceTimersByTimeAsync(FETCH_TIMEOUT_MS - 1); expect(signal!.aborted).toBe(false);
      await vi.advanceTimersByTimeAsync(2);
      expect(signal!.aborted).toBe(true);
      expect(await p).toEqual({ current: '0.4.1', store: false });
    } finally { vi.useRealTimers(); }
  });
  it('store installs (update_url in the installed manifest) never fetch and never touch storage', async () => {
    m = { version: '0.4.1', update_url: 'https://clients2.google.com/service/update2/crx' };
    const w = make();
    expect(await w.query(true)).toEqual({ current: '0.4.1', store: true });
    await w.startup();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(store).toEqual({});
  });
  it('setting off: no request, and the browser-start check respects it', async () => {
    const w = make();
    expect(await w.query(false)).toEqual({ current: '0.4.1', store: false, off: true });
    expect(fetchMock).not.toHaveBeenCalled();
    await w.startup();
    expect(fetchMock).not.toHaveBeenCalled();
    await w.query(true);                                            // switched back on
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it('browser start: one throttled check when nobody opted out', async () => {
    const w = make();
    await w.startup(); await w.startup();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it('onMessage answers only well-formed queries', async () => {
    const w = make();
    const send = vi.fn();
    expect(w.onMessage({ type: 'other', enabled: true }, send)).toBe(false);
    expect(w.onMessage({ type: QUERY_TYPE, enabled: 'yes' }, send)).toBe(false);
    expect(w.onMessage(null, send)).toBe(false);
    expect(w.onMessage({ type: QUERY_TYPE, enabled: true, url: 'https://evil.example/' }, send)).toBe(true);
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    expect(send.mock.calls[0][0].latest).toBe('0.4.2');
    expect((fetchMock.mock.calls[0] as [string])[0]).toBe(RELEASES_API);   // a page-supplied URL is never used
  });
});

describe('message validation (page boundary)', () => {
  const good = { current: '0.4.1', store: false, latest: '0.4.2', url: URL_OK };
  it('sanitizeInfo keeps known fields only and rejects bad shapes', () => {
    expect(sanitizeInfo({ ...good, extra: '<img onerror=x>', code: 'alert(1)' })).toEqual(good);
    expect(sanitizeInfo({ current: '0.4.1', store: true })).toEqual({ current: '0.4.1', store: true });
    expect(sanitizeInfo({ current: '0.4.1', store: false, off: true })).toEqual({ current: '0.4.1', store: false, off: true });
    expect(sanitizeInfo({ ...good, url: 'https://evil.example/' })).toBeNull();
    expect(sanitizeInfo({ ...good, latest: 'two' })).toBeNull();
    expect(sanitizeInfo({ ...good, latest: undefined })).toBeNull();      // url without version
    expect(sanitizeInfo({ ...good, store: 'no' })).toBeNull();
    expect(sanitizeInfo({ ...good, current: 7 })).toBeNull();
    expect(sanitizeInfo(null)).toBeNull();
    expect(sanitizeInfo('x')).toBeNull();
  });
  it('readPageMessage: same window, same origin, marker, valid shape', () => {
    const win = {}; const o = 'https://play.multidonate.ru';
    const msg = (over: object = {}) => ({ data: { __l3d: 'update', ...good }, source: win, origin: o, ...over });
    expect(readPageMessage(msg(), win, o)).toEqual(good);
    expect(readPageMessage(msg({ source: {} }), win, o)).toBeNull();          // an iframe / other window
    expect(readPageMessage(msg({ origin: 'https://evil.example' }), win, o)).toBeNull();
    expect(readPageMessage(msg({ data: { ...good } }), win, o)).toBeNull();   // no marker
    expect(readPageMessage(msg({ data: { __l3d: 'update', ...good, url: 'javascript:1' } }), win, o)).toBeNull();
    expect(readPageMessage(msg({ data: 'update' }), win, o)).toBeNull();
    expect(isAskMessage({ __l3d: 'update-ask' })).toBe(true);
    expect(isAskMessage({ __l3d: 'update' })).toBe(false);
  });
});

/* ---------------------------------------------------------------- the feature (tiny fake DOM, no jsdom in this repo) */
class FakeEl extends EventTarget {
  style: Record<string, string> = {}; children: FakeEl[] = []; attrs: Record<string, string> = {}; textContent = ''; href = ''; target = ''; rel = ''; type = ''; removed = false;
  constructor(public tag: string) { super(); }
  setAttribute(k: string, v: string) { this.attrs[k] = v; }
  append(...c: FakeEl[]) { this.children.push(...c); }
  remove() { this.removed = true; }
}
describe('feature: toast once per version, pause row, setting', () => {
  const origin = 'https://play.multidonate.ru';
  let ls: Map<string, string>; let win: EventTarget & Record<string, unknown>; let root: FakeEl; let opened: unknown[][];
  const info = { current: '0.4.1', store: false, latest: '0.4.2', url: URL_OK };
  const post = (data: unknown) => { const e = new Event('message') as Event & Record<string, unknown>; Object.assign(e, { data, source: win, origin }); win.dispatchEvent(e); };
  const toasts = () => root.children.filter((c) => !c.removed);
  const boot = async () => {
    const mod = await import('../src/features/update');
    const settings = await import('../src/ui/settings-ext');
    const ctx = { engine: { renderer: { domElement: { getRootNode: () => root } } } };
    const off = await mod.default.setup(ctx as never) as () => void;
    return { off, settings, mod };
  };
  beforeEach(() => {
    vi.resetModules();
    ls = new Map(); root = new FakeEl('root'); opened = [];
    win = Object.assign(new EventTarget(), { setTimeout: (f: () => void, ms: number) => globalThis.setTimeout(f, ms), clearTimeout: (id: number) => globalThis.clearTimeout(id), postMessage: vi.fn(), open: (...a: unknown[]) => { opened.push(a); return null; } }) as never;
    vi.stubGlobal('window', win); vi.stubGlobal('location', { origin });
    vi.stubGlobal('localStorage', { getItem: (k: string) => ls.get(k) ?? null, setItem: (k: string, v: string) => { ls.set(k, v); }, removeItem: (k: string) => { ls.delete(k); } });
    vi.stubGlobal('document', { createElement: (t: string) => new FakeEl(t), body: root });
    vi.stubGlobal('ShadowRoot', class {});
    vi.stubGlobal('CustomEvent', class extends Event { detail: unknown; constructor(t: string, o?: { detail?: unknown }) { super(t); this.detail = o?.detail; } });
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('shows one toast + a pause row for a newer version; ✕ remembers the version; no second toast for it', async () => {
    const { off, settings } = await boot();
    expect(win.postMessage).toHaveBeenCalledWith({ __l3d: 'update-ask' }, origin);
    expect(settings.pauseItems().length).toBe(0);                      // nothing before the worker answers
    post({ __l3d: 'update', ...info });
    post({ __l3d: 'update', ...info });                                // duplicate answer: still one toast
    expect(toasts().length).toBe(1);
    const [a, x] = toasts()[0].children;
    expect(a.textContent).toBe('Вышла версия 0.4.2 — скачать');
    expect(a.href).toBe(URL_OK); expect(a.target).toBe('_blank'); expect(a.rel).toContain('noopener');
    const row = settings.pauseItems().find((p) => p.id === 'update')!;
    expect(row.label).toBe('⬆ Обновление 0.4.2');
    row.run(); await new Promise((r) => setTimeout(r, 5));
    expect(opened[0].slice(0, 2)).toEqual([URL_OK, '_blank']);
    x.dispatchEvent(new Event('click'));
    expect(toasts().length).toBe(0);
    expect(ls.get('l3d.update.dismissed')).toBe('0.4.2');
    post({ __l3d: 'update', ...info });
    expect(toasts().length).toBe(0);                                    // dismissed for this version
    expect(settings.pauseItems().some((p) => p.id === 'update')).toBe(true);   // the pause row stays
    post({ __l3d: 'update', ...info, latest: '0.5.0', url: 'https://github.com/ascorblack/legion-3d/releases/tag/v0.5.0' });
    expect(toasts().length).toBe(1);                                    // a newer version → toast again
    off();
    expect(toasts().length).toBe(0); expect(settings.pauseItems().length).toBe(0);
  });
  it('not newer, forged or foreign messages do nothing', async () => {
    const { settings } = await boot();
    post({ __l3d: 'update', ...info, latest: '0.4.1' });
    post({ __l3d: 'update', ...info, latest: '0.4.0' });
    post({ __l3d: 'update', ...info, url: 'https://evil.example/' });
    post({ ...info });
    const e = new Event('message') as Event & Record<string, unknown>; Object.assign(e, { data: { __l3d: 'update', ...info }, source: {}, origin }); win.dispatchEvent(e);
    expect(toasts().length).toBe(0); expect(settings.pauseItems().length).toBe(0);
  });
  it('store install: setting row turns into a note, nothing is ever shown', async () => {
    const { settings } = await boot();
    expect(settings.settingRow('l3d.update.check')).toBeFalsy();   // no row until notify.js answers (store zips ship without it)
    post({ __l3d: 'update', current: '0.4.1', store: true });
    const r = settings.settingRow('l3d.update.check')!;
    expect(r.kind).toBe('info'); expect(r.label).toBe('Проверять обновления (GitHub)');
    expect((r as { text: () => string }).text()).toBe('обновляется через магазин');
    post({ __l3d: 'update', ...info });
    expect(toasts().length).toBe(0); expect(settings.pauseItems().length).toBe(0);
  });
  it('setting off: hides toast and row, ignores answers, switching on asks the worker again', async () => {
    const { settings } = await boot();
    post({ __l3d: 'update', ...info });
    expect(toasts().length).toBe(1);
    ls.set('l3d.update.check', '0');
    win.dispatchEvent(Object.assign(new Event('l3d:settings'), { detail: { key: 'l3d.update.check', value: '0' } }));
    expect(toasts().length).toBe(0); expect(settings.pauseItems().length).toBe(0);
    post({ __l3d: 'update', ...info });
    expect(toasts().length).toBe(0);
    (win.postMessage as ReturnType<typeof vi.fn>).mockClear();
    ls.set('l3d.update.check', '1');
    win.dispatchEvent(Object.assign(new Event('l3d:settings'), { detail: { key: 'l3d.update.check', value: '1' } }));
    expect(win.postMessage).toHaveBeenCalledWith({ __l3d: 'update-ask' }, origin);
  });
  it('the setting defaults to on and lives in «Прочее»', async () => {
    const { settings } = await boot();
    post({ __l3d: 'update', current: '0.4.1', store: false });
    const r = settings.settingRow('l3d.update.check')!;
    expect(r.group).toBe('Прочее');
    expect(settings.readRow(r)).toBe('1');
  });
});
