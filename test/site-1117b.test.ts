/**
 * Site update 17.11 (evening).
 *  - /lib/guard.js (window.LGGuard): the site's anti-bot guard on window.fetch. A response header `X-Legion-Guard: ban` shows
 *    the ban window, `captcha` (not `captcha:solved`) holds the request, shows a captcha in an iframe and replays the request
 *    once it is solved. Here the site's own guard.js runs in node:vm together with our real bridge bundle, the site's <head>
 *    fetch wrapper (test/fixtures/site-fetch-wrapper.js, 17.11 version) and its bot telemetry probe; our api() (src/net/site.ts
 *    siteApi) calls through that page. src/net/site-guard.ts, src/net/site.ts overlayKind 'guard'.
 *  - tk-art.js ITEM.mailbox redrawn (the flag on its own metal pole) → src/world/fcart/houses.ts mailbox model, fp bumped.
 *  - doodle.js off-hand blades (CATALOG.offhands, game-data.js isOffhand) → src/avatar/gear.ts addOffhand (left hand).
 *  - citymon.js per-town view (GET /api/citymon?town=) → src/net/citymon.ts CmTownGate.
 *  - app.js hpTick (HP regenerates on the page: hp / hpAt / hpMax / hpRegen) → src/ui/data.ts hpRegenNow.
 * The site's own code comes from the local copies `.local/site-*` (not in the repo); those tests are skipped without them.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { buildSync } from 'esbuild';
import * as THREE from 'three';
// @ts-expect-error plain .mjs helper shared with the browser e2e
import { probeSource } from '../e2e/site-telemetry.mjs';
import { siteCopy } from './site-quest-fns';
import { siteApi, overlayKind, SITE_GUARD, SITE_PAUSE, DIALOGS, FISH } from '../src/net/site';
import { guardKindOf, guardAnswer, guardShown, readSiteAnswer, BAN_TEXT, CAPTCHA_TEXT, GUARD_SEL } from '../src/net/site-guard';
import contract from '../src/data/site-contract.json';
import fp from '../src/data/fcart-fp.json';
import { fcModel } from '../src/world/fcart/registry';
import { registerFcItemKinds, placeFcItem, MAILBOX, FC_ITEM_KINDS } from '../src/world/fcart/houses';
import { Batch } from '../src/world/batch';
import { paletteOf } from '../src/world/palette';
import { rng, type SignAtlas } from '../src/world/textures';
import { Instancer } from '../src/world/instancer';
import type { Ctx } from '../src/world/kit';
import { CATALOG } from '../src/avatar/appearance';
import { OFFHAND_WEAPON, isOffhand, addOffhand } from '../src/avatar/gear';
import { Parts, T } from '../src/avatar/geom';
import { getModel, modelKey } from '../src/avatar/model';
import { itemModelKey } from '../src/avatar/items';
import { SUPPORTED_ITEM_MODEL_KEYS } from '../src/avatar/supported';
import { CmTownGate, type CmWall, type CmView } from '../src/net/citymon';
import { hpRegenNow, hpInfo } from '../src/ui/data';

const GUARD = siteCopy('guard.js', "const HDR = 'X-Legion-Guard';");
const TK_ART = siteCopy('tk-art.js', 'h12 v8 h-12 Z');
const DOODLE = siteCopy('doodle.js', "offhands: ['oknife', 'oparry', 'okris', 'ofang']");
const GAME_DATA = siteCopy('game-data.js', 'isOffhand');
const CITYMON = siteCopy('citymon.js', "'/api/citymon' + (t ? '?town=' + encodeURIComponent(t) : '')");
const APP = siteCopy('app.js', 'function hpTick(h) {');

const bridgeSrc = buildSync({ entryPoints: ['src/bridge/bridge.ts'], bundle: true, write: false, format: 'iife', target: 'es2022' }).outputFiles[0].text;
const siteWrapper = readFileSync('test/fixtures/site-fetch-wrapper.js', 'utf8');
const native = (fn: (...a: any[]) => any) => Function.prototype.bind.call(fn, null);

/* ------------------------------------------------------------------ a tiny DOM: just what guard.js show() touches */
class FakeEl {
  nodeType = 1; parentNode: FakeEl | null = null; children: FakeEl[] = []; style: Record<string, string> = { cssText: '' };
  attrs = new Map<string, string>(); open = false; inert = false; offsetWidth = 0; src = ''; title = '';
  contentWindow: object | null; showModal?: () => void; close?: () => void;
  constructor(public tagName: string, private doc: FakeDoc) {
    this.contentWindow = tagName === 'IFRAME' ? { frame: true } : null;
    if (tagName === 'DIALOG') {
      this.showModal = () => { if (!this.isConnected) throw new Error('InvalidStateError'); this.open = true; };
      this.close = () => { this.open = false; };
    }
  }
  get isConnected(): boolean { let e: FakeEl = this; while (e.parentNode) e = e.parentNode; return e === this.doc.documentElement; }
  setAttribute(k: string, v: unknown) { this.attrs.set(k, String(v)); }
  getAttribute(k: string) { return this.attrs.get(k) ?? null; }
  hasAttribute(k: string) { return this.attrs.has(k); }
  appendChild(c: FakeEl) { if (c.parentNode) c.parentNode.removeChild(c); c.parentNode = this; this.children.push(c); return c; }
  removeChild(c: FakeEl) { const i = this.children.indexOf(c); if (i >= 0) this.children.splice(i, 1); c.parentNode = null; return c; }
  addEventListener() { /* the window's own events are enough here */ }
  removeEventListener() { /* */ }
  contains(x: FakeEl | null): boolean { for (let e = x; e; e = e.parentNode) if (e === this) return true; return false; }
  focus() { this.doc.activeElement = this; }
  matches(sel: string): boolean {
    const m = /^([a-z]+)?(?:\[([\w-]+)(?:="([^"]*)")?\])?$/i.exec(sel.trim());
    if (!m) return false;
    if (m[1] && m[1].toUpperCase() !== this.tagName) return false;
    if (m[2] && !this.attrs.has(m[2])) return false;
    if (m[3] != null && this.attrs.get(m[2]) !== m[3]) return false;
    return true;
  }
  querySelector(sel: string): FakeEl | null {
    for (const c of this.children) { if (c.matches(sel)) return c; const d = c.querySelector(sel); if (d) return d; }
    return null;
  }
}
class FakeDoc {
  documentElement: FakeEl; body: FakeEl; activeElement: FakeEl;
  constructor() { this.documentElement = new FakeEl('HTML', this); this.body = this.documentElement.appendChild(new FakeEl('BODY', this)); this.activeElement = this.body; }
  createElement(t: string) { return new FakeEl(t.toUpperCase(), this); }
  querySelector(sel: string) { return this.documentElement.querySelector(sel); }
  addEventListener() { /* */ }
  removeEventListener() { /* */ }
}

type Reply = { status?: number; body: string; guard?: string };
/** A page like the live one: [bridge at document_start] → guard.js → the <head> LG_BASE wrapper; a scripted server under it. */
function page() {
  const replies: Reply[] = [];
  const calls: { url: string; method: string; body: unknown }[] = [];
  const winL = new Map<string, Set<(e: any) => void>>();
  const doc = new FakeDoc();
  const sb: any = {
    console, setTimeout, clearTimeout, Promise, Response, Request, URL, URLSearchParams, Blob, FormData, ArrayBuffer, AbortSignal,
    location: { origin: 'https://legiongame.gg', pathname: '/c/channel/', href: 'https://legiongame.gg/c/channel/' },
    localStorage: { getItem: () => null, setItem() { /* */ } }, sessionStorage: { getItem: () => null, setItem() { /* */ } },
    document: doc, matchMedia: () => ({ matches: false }),
    addEventListener: (t: string, f: (e: any) => void) => { let s = winL.get(t); if (!s) winL.set(t, (s = new Set())); s.add(f); },
    removeEventListener: (t: string, f: (e: any) => void) => { winL.get(t)?.delete(f); },
  };
  sb.window = sb; sb.self = sb;
  sb.fetch = native(async (u: string, init?: RequestInit) => {
    calls.push({ url: String(u), method: (init && init.method) || 'GET', body: init ? init.body : undefined });
    const r = replies.shift() || { body: '{"ok":true}' };
    return new Response(r.body, { status: r.status ?? 200, headers: r.guard ? { 'X-Legion-Guard': r.guard } : {} });
  });
  sb.requestAnimationFrame = native(() => 1);
  vm.createContext(sb);
  const nativeFetch = sb.fetch;
  const run = (src: string) => vm.runInContext(src, sb);
  return {
    sb, doc, nativeFetch, replies, calls,
    run,
    bridge() { run(bridgeSrc); },
    guard() { run(GUARD!); },
    site() { run(siteWrapper); },
    probe() { run(probeSource()); },
    pi(): number { return run('window.__l3dPi()'); },
    /** The captcha's iframe says «solved» (guard.js onMsg: source = its iframe, origin = the page's). */
    solve() {
      const fr = doc.querySelector('iframe');
      for (const f of [...(winL.get('message') || [])]) f({ source: fr && fr.contentWindow, origin: sb.location.origin, data: { lgGuard: 'ok' } });
    },
  };
}
const tick = (ms = 15) => new Promise((r) => setTimeout(r, ms));
/** Our api() calls the page's window.fetch at call time (in the browser it is the global fetch of the MAIN world). */
const viaPage = (p: ReturnType<typeof page>) => vi.stubGlobal('fetch', (u: any, i: any) => p.sb.fetch(u, i));
afterEach(() => { vi.unstubAllGlobals(); });

/* ------------------------------------------------------------------ 1. the guard and our fetch paths */
describe('guard.js 17.11: the site\'s anti-bot guard with our bridge and api()', () => {
  it('our port of kind() and the answer our api() gives', () => {
    const R = (h?: string) => new Response('{}', { headers: h ? { 'X-Legion-Guard': h } : {} });
    expect(guardKindOf(R())).toBe(null); expect(guardKindOf(R('ban'))).toBe('ban'); expect(guardKindOf(R('ban:7d'))).toBe('ban');
    expect(guardKindOf(R('captcha'))).toBe('captcha'); expect(guardKindOf(R('captcha:solved'))).toBe(null); expect(guardKindOf(null)).toBe(null);
    expect(guardAnswer('ban', { ok: false, error: 'Аккаунт заблокирован' })).toMatchObject({ ok: false, guard: 'ban', error: 'Аккаунт заблокирован' });
    expect(guardAnswer('ban', null)).toMatchObject({ ok: false, guard: 'ban', error: BAN_TEXT });
    expect(guardAnswer('captcha', { ok: true })).toMatchObject({ ok: false, guard: 'captcha', error: CAPTCHA_TEXT });
    expect(SITE_GUARD).toBe(GUARD_SEL);
  });

  it.skipIf(!GUARD)('the same verdicts as the site\'s own LGGuard.kind', () => {
    const m = { exports: {} as any };
    vm.runInNewContext(GUARD!, { module: m, exports: m.exports, console, Promise, WeakMap, WeakSet, Set });
    for (const h of [undefined, 'ban', 'ban:x', 'captcha', 'captcha:solved', 'captcha:x', 'ok', '']) {
      const r = new Response('{}', { headers: h != null ? { 'X-Legion-Guard': h } : {} });
      expect(guardKindOf(r), String(h)).toBe(m.exports.kind(r));
    }
  });

  it.skipIf(!GUARD)('page order: bridge → guard.js → <head> wrapper; the page stays honest for the mine telemetry, our tee goes on top and off exactly', () => {
    const p = page();
    p.bridge(); p.guard();
    const guarded = p.sb.fetch;
    expect(guarded).not.toBe(p.nativeFetch);                        // install(window) took window.fetch
    expect(p.sb.LGGuard.under(guarded)).toBe(p.nativeFetch);         // … over the native one
    p.site(); p.probe();
    expect(p.sb.fetch).toBe(p.sb.LG_FETCH.w);
    expect(p.sb.LG_FETCH.n).toBe(true);                              // read through LGGuard.under
    expect(p.pi()).toBe(0);
    expect(p.run('window.__L3D_BUS.fetchTee.installed()')).toBe(false);   // never at document_start
    expect(p.run('window.__L3D_BUS.fetchTee.on()')).toBe(true);
    expect(p.pi() & 1).toBe(1);                                      // 3D only, as before
    expect(p.run('window.__L3D_BUS.fetchTee.off()')).toBe(true);
    expect(p.sb.fetch).toBe(p.sb.LG_FETCH.w);                        // the site's wrapper back, the guard under it untouched
    expect(p.pi()).toBe(0);
  });

  it.skipIf(!GUARD)('why the tee never goes on at document_start: under the guard it would mark the whole page', () => {
    const p = page();
    p.bridge(); p.run('window.__L3D_BUS.fetchTee.on()'); p.guard(); p.site(); p.probe();
    expect(p.sb.LG_FETCH.n).toBe(false);
    expect(p.pi() & 1).toBe(1);
  });

  it.skipIf(!GUARD)('captcha: our GET waits in the guard, the 3D steps aside, the request is replayed after the solve; the tee copies only the replay', async () => {
    const p = page(); p.bridge(); p.guard(); p.site();
    const me: unknown[] = []; p.sb.__L3D_BUS.on('me', (d: unknown) => me.push(d));
    p.run('window.__L3D_BUS.fetchTee.on()');
    viaPage(p);
    p.replies.push({ body: '{"ok":false,"error":"проверка"}', guard: 'captcha' }, { body: '{"ok":true,"hero":{"name":"Кот"}}', guard: 'captcha:solved' });
    let done = false;
    const P = siteApi('/api/me').then((r) => { done = true; return r; });
    await tick();
    expect(done).toBe(false);                                        // held (guard.js: NEVER until solved)
    expect(p.calls.length).toBe(1); expect(p.calls[0].url).toBe('/c/channel/api/me');
    const dlg = p.doc.querySelector('[data-lg-guard="captcha"]');
    expect(dlg && dlg.tagName).toBe('DIALOG'); expect(dlg!.open).toBe(true);
    expect(guardShown(p.doc as any)).toBe(true);
    expect(overlayKind((s) => (s === SITE_GUARD ? guardShown(p.doc as any) : false))).toBe('guard');
    expect(me).toEqual([]);                                          // the captcha answer is not data
    p.solve();
    const r = await P;
    expect(r).toEqual({ ok: true, hero: { name: 'Кот' } });
    expect(p.calls.length).toBe(2); expect(p.calls[1].url).toBe('/c/channel/api/me');
    expect(guardShown(p.doc as any)).toBe(false);
    expect(overlayKind((s) => (s === SITE_GUARD ? guardShown(p.doc as any) : false))).toBe(null);
    await tick();
    expect(me).toEqual([{ ok: true, hero: { name: 'Кот' } }]);
    expect(p.sb.LGGuard.passed()).toBe(1);
  });

  it.skipIf(!GUARD)('captcha on a POST of ours: the JSON body is reusable, the same body is sent again', async () => {
    const p = page(); p.bridge(); p.guard(); p.site();
    viaPage(p);
    p.replies.push({ body: '{}', guard: 'captcha' }, { body: '{"ok":true}' });
    const P = siteApi('/api/equip', { uid: 'u1' });
    await tick();
    expect(p.calls.length).toBe(1);
    p.solve();
    expect(await P).toEqual({ ok: true });
    expect(p.calls.map((c) => [c.method, c.url, c.body])).toEqual([['POST', '/c/channel/api/equip', '{"uid":"u1"}'], ['POST', '/c/channel/api/equip', '{"uid":"u1"}']]);
  });

  it.skipIf(!GUARD)('ban: the site\'s ban window stays, our api() says so (never «нет связи»), the tee copies nothing', async () => {
    const p = page(); p.bridge(); p.guard(); p.site();
    const me: unknown[] = []; p.sb.__L3D_BUS.on('me', (d: unknown) => me.push(d));
    p.run('window.__L3D_BUS.fetchTee.on()');
    viaPage(p);
    p.replies.push({ status: 200, body: '{"ok":false,"error":"Доступ закрыт"}', guard: 'ban' });
    expect(await siteApi('/api/me')).toMatchObject({ ok: false, guard: 'ban', error: 'Доступ закрыт' });
    expect(p.calls.length).toBe(1);                                  // a ban is not replayed
    expect(p.doc.querySelector('[data-lg-guard="ban"]')).toBeTruthy();
    expect(guardShown(p.doc as any, 'ban')).toBe(true);
    await tick();
    expect(me).toEqual([]);
    // a later answer without a JSON body: our text, not a swallowed error
    p.replies.push({ status: 403, body: 'banned', guard: 'ban' });
    expect(await siteApi('/api/me')).toMatchObject({ ok: false, guard: 'ban', error: BAN_TEXT });
  });

  it.skipIf(!GUARD)('a captcha that came while a ban window is up turns into nothing to wait for (guard.js), our api() still answers', async () => {
    const p = page(); p.bridge(); p.guard(); p.site(); viaPage(p);
    p.replies.push({ body: '{}', guard: 'ban' });
    await siteApi('/api/me');
    p.replies.push({ body: '{}', guard: 'captcha' }, { body: '{"ok":true}' });
    expect(await siteApi('/api/me')).toEqual({ ok: true });            // wait() on a ban window returns at once → replayed
  });

  it('readSiteAnswer without a guard header is the plain JSON', async () => {
    expect(await readSiteAnswer(new Response('{"ok":true,"n":1}'))).toEqual({ ok: true, n: 1 });
    await expect(readSiteAnswer(new Response('not json'))).rejects.toBeTruthy();
  });

  it('overlayKind: the guard window goes before every other site screen (also the pause plaque and a hybrid room\'s panel)', () => {
    const on = (...s: string[]) => (sel: string) => s.includes(sel);
    for (const other of ['.cy-room', SITE_PAUSE, '.mn', '.mn-board-w', FISH, DIALOGS]) expect(overlayKind(on(SITE_GUARD, other)), other).toBe('guard');
    expect(overlayKind(on(SITE_GUARD))).toBe('guard');
    expect(overlayKind(on('.cy-room'))).toBe('room');
  });

  it('contract: LGGuard, install over window.fetch, the [data-lg-guard] window', () => {
    const ids = (contract as any).checks.map((c: any) => c.id) as string[];
    for (const id of ['LGGuard (anti-bot guard, guard.js 17.11)', 'guard.js install: window.fetch = guarded over the native fetch (captcha → hold + replay, ban → window)', 'guard.js window [data-lg-guard] (header X-Legion-Guard ban / captcha)']) expect(ids).toContain(id);
    if (!GUARD) return;
    for (const c of (contract as any).checks.filter((x: any) => x.file === 'guard.js' && x.re)) expect(new RegExp(c.re).test(GUARD), c.id).toBe(true);
  });
});

/* ------------------------------------------------------------------ 2. the mailbox */
function ctx(): Ctx {
  const signs = { add: () => ({ uv: [0, 0, 1, 1] as [number, number, number, number], aspect: 4 }), texture: null } as unknown as SignAtlas;
  return { b: new Batch(14), pal: paletteOf('cats'), signs, inst: new Instancer(), glows: [], lights: [], bulbs: [], wires: [], rnd: rng(1), quality: 2, lowH: 0, wallZ: 0, colliders: [], pools: [], solids: [] } as Ctx;
}
describe('tk-art.js 17.11: the mailbox redrawn (flag on its own pole)', () => {
  it('the model is pinned to the new drawing', () => {
    expect((FC_ITEM_KINDS as readonly string[]).includes('mailbox')).toBe(true);
    expect(fcModel('i:mailbox')?.fp).toBe('103cd46c79f667');
    expect((fp as any)['i:mailbox'].fp).toBe('103cd46c79f667');
    expect((fp as any)['tk:i:mailbox'].fp).toBe('103cd46c79f667');
  });
  it.skipIf(!TK_ART)('the numbers come from the site\'s drawing: post 70, fish at − 80, pole x + 6 from − 82 to − 112, flag x + 7 … + 19 at the top', () => {
    const line = TK_ART!.split('\n').find((l) => l.includes('h12 v8 h-12 Z'))!;
    expect(line).toContain('height="70"');
    expect(line).toContain('fish(x, y - 80, 0.75');
    expect(line).toMatch(/M\$\{x \+ 6\} \$\{y - 82\} V\$\{y - 112\}/);
    expect(line).toMatch(/M\$\{x \+ 7\} \$\{y - 112\} h12 v8 h-12 Z/);
    expect([MAILBOX.post, MAILBOX.fishY, MAILBOX.poleX, ...MAILBOX.pole, ...MAILBOX.flag]).toEqual([70, 80, 6, 82, 112, 7, 19, 104, 112]);
  });
  it('one instanced kind, one part: post, fish, the pole up to the flag', () => {
    const k = ctx(); registerFcItemKinds(k);
    expect(placeFcItem(k, { k: 'mailbox', x: 1000, y: 1000 }, 0, 2.75, [])).toBe(true);
    const parts = (k.inst as any).kinds.get('fc:mailbox') as { geo: THREE.BufferGeometry }[];
    expect(parts.length).toBe(1);
    const g = parts[0].geo; g.computeBoundingBox(); const b = g.boundingBox!;
    expect(b.min.y).toBeCloseTo(0, 2);
    expect(b.max.y).toBeCloseTo(112 * MAILBOX.s, 2);                 // the flag's top = the pole's top
    expect(b.min.x).toBeLessThan(-0.24); expect(b.max.x).toBeGreaterThan(0.3);   // fish head … tail fin
    // something stands at the flag's height to the right of the pole (the flag) and nothing floats above the fish without the pole
    const pos = g.attributes.position, hi: number[] = [];
    for (let i = 0; i < pos.count; i++) if (pos.getY(i) > 104 * MAILBOX.s + 0.005) hi.push(pos.getX(i));
    expect(Math.max(...hi)).toBeGreaterThan(18 * MAILBOX.s);
    expect(Math.min(...hi)).toBeLessThan(MAILBOX.poleX * MAILBOX.s);
  });
});

/* ------------------------------------------------------------------ 3. off-hand blades */
describe('doodle.js 17.11: off-hand blades in the shield slot', () => {
  it.skipIf(!DOODLE)('our list is the site\'s CATALOG.offhands and the same base blades as its doll art', () => {
    expect([...CATALOG.offhands]).toEqual(['oknife', 'oparry', 'okris', 'ofang']);
    expect(DOODLE!).toContain("const w = weapon(kind === 'okris' || kind === 'ofang' ? 'kris' : 'dagger', rar)");
    expect(OFFHAND_WEAPON).toEqual({ oknife: 'dagger', oparry: 'dagger', okris: 'kris', ofang: 'kris' });
  });
  it.skipIf(!GAME_DATA)('game-data.js isOffhand = a shield-slot item with a role that is not cloth', () => {
    expect(GAME_DATA!).toContain("const isOffhand = (it) => !!(it && it.slot === 'shield' && it.role && it.gear !== 'cloth');");
  });
  it('the third-person body holds a blade in the left paw instead of a forearm shield', () => {
    expect(isOffhand('oknife')).toBe(true); expect(isOffhand('round')).toBe(false); expect(isOffhand(undefined)).toBe(false);
    const app = (s?: string) => ({ login: 'demo', name: 'Demo', styleId: 'cats', look: { shape: 'bean', color: '#f2a65a' }, gear: s ? { w: 'sword', s, sr: 'rare' } : { w: 'sword' } } as any);
    const tris = (a: any) => getModel(a).geo.attributes.position.count;
    for (const s of CATALOG.offhands) expect(modelKey(app(s))).not.toBe(modelKey(app('round')));
    // an off-hand blade is much smaller than a shield
    const none = tris(app()), knife = tris(app('oknife')), shield = tris(app('round'));
    expect(knife).toBeGreaterThan(none); expect(shield).toBeGreaterThan(knife);
  });
  it('each blade has its own touch; items and the registry know them', () => {
    const n = (k: string) => { const p = new Parts(); addOffhand(p, k, 'common', T(0, 0, 0)); const g = p.build(); g.computeBoundingBox(); return { v: g.attributes.position.count, top: g.boundingBox!.max.y }; };
    expect(new Set(CATALOG.offhands.map((k) => n(k).v)).size).toBeGreaterThan(2);   // not one model for all
    expect(n('ofang').top).toBeGreaterThan(n('okris').top);             // the green tip over the kris
    expect(n('okris').top).toBeGreaterThan(n('oknife').top);            // a kris is longer than a knife
    for (const k of CATALOG.offhands) {
      expect(itemModelKey({ slot: 'shield', look: { shield: k } } as any)).toBe('shield:' + k);
      expect(SUPPORTED_ITEM_MODEL_KEYS).toContain('shield:' + k);
    }
  });
});

/* ------------------------------------------------------------------ 4. citymon per town */
describe('citymon.js 17.11: the view is per town', () => {
  it.skipIf(!CITYMON)('the site asks for the wall\'s town and reloads on a town switch', () => {
    expect(CITYMON!).toContain("if ((!S.view || back || S.vt !== String(W.town || '')");
    expect(CITYMON!).toContain("window.LGCityMon = { tick, attackDlg, eliteDlg, fightDlg, replay, logText, lobbies, openCount, close, view: () => S.view };");
  });
  it('CmTownGate: the previous town\'s view is not drawn at the new town\'s wall; the next view passes', () => {
    const g = new CmTownGate(), W = (town: string): CmWall => ({ x: 1, y: 2, town, own: true });
    const v1 = { packs: [] } as unknown as CmView, v2 = { packs: [] } as unknown as CmView;
    expect(g.pick(W('fairc'), v1)).toBe(v1);
    expect(g.pick(W('fairc'), v1)).toBe(v1);
    expect(g.pick(W('d04'), v1)).toBe(null);       // switched: v1 belongs to the cats fair
    expect(g.pick(W('d04'), v1)).toBe(null);
    expect(g.pick(W('d04'), v2)).toBe(v2);         // the site's reload for d04
    expect(g.pick(W('d04'), v2)).toBe(v2);
    expect(g.pick(null, v2)).toBe(v2);
    expect(g.pick(W('fairc'), null)).toBe(null);
    expect(g.pick(W('fairc'), v1)).toBe(v1);
  });
});

/* ------------------------------------------------------------------ 5. HP regeneration on the page */
describe('app.js 17.11 hpTick: HP regenerates between hero updates', () => {
  it.skipIf(!APP)('the site\'s formula', () => {
    expect(APP!).toContain('const t = gnow(), cur = Math.min(max, Math.floor(+h.hp + Math.max(0, t - (+h.hpAt || t)) / 3600000 * r));');
  });
  it('hpRegenNow / hpInfo count up from hp at hpAt with hpRegen per hour, capped at hpMax; nothing without the fields', () => {
    const t0 = 1_800_000_000_000;
    const h: any = { stats: { hp: 50 }, hpNow: 20, hp: 20, hpAt: t0, hpMax: 60, hpRegen: 12 };
    expect(hpRegenNow(h, t0)).toBe(20);
    expect(hpRegenNow(h, t0 + 30 * 60e3)).toBe(26);           // half an hour × 12 / h
    expect(hpRegenNow(h, t0 + 10 * 36e5)).toBe(60);           // capped
    expect(hpInfo(h, t0 + 30 * 60e3)).toEqual({ now: 26, max: 60, pct: 26 / 60 });
    expect(hpRegenNow({ ...h, ghost: true }, t0 + 36e5)).toBe(null);
    expect(hpRegenNow({ ...h, hpRegen: 0 }, t0 + 36e5)).toBe(null);
    expect(hpInfo({ stats: { hp: 50 }, hpNow: 20 } as any)).toEqual({ now: 20, max: 50, pct: 0.4 });   // old heroes: as before
  });
});
