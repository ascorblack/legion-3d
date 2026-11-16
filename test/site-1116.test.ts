/**
 * Site update 16.11 (the move to legiongame.gg day).
 *  - app.js pause rework: the countdown `.lg-pzw` «Пауза игры через m:ss» (src/features/sitepause.ts pauseWarnText) and the
 *    pause itself as a full-screen `.lg-pz` (aria-modal) that swallows keys on window in the capture phase (pzKey). The 3D
 *    yields to it as a site dialog and the input never gets stuck on a key whose keyup the plaque ate.
 *  - city.js «Только гильдию» (lgCityGl + hero.go, walkers by their tag gt) → src/net/friends-only.ts for the 3D crowd.
 *  - site-ui.js closedCode / withCode («(код X01)» on closed answers) → src/net/site-code.ts in our api().
 *  - tk-art.js Ground `rows`: the trees (pass 7) are chunked by whole rows → fingerprint.ts layerRef keeps them out of 'relief'.
 *  - mine.js clk / srvNow: stone progress / ETA / «Получишь» at the server's time → MineModel.dt / srvNow.
 *  - 21:40 the site again: the game clock (app.js gnow / LGGameNow; hero timestamps are game time) → src/net/game-clock.ts,
 *    `mep` gains `gnow` (test/site-1115.test.ts runs meApply), daily tasks moved into app.js (LGDailies; dailies.js = LGDailiesWin).
 * The site's own code (newest local copy `.local/site-*`, not in the repo) runs here in node:vm; skipped without it.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import vm from 'node:vm';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { siteCopy, fnSource } from './site-quest-fns';
import { pauseWarnText, pauseWarnAt, pzClock, PAUSE_SEL, PAUSE_HINT } from '../src/features/sitepause';
import { FriendsOnly, FR_KEY, GL_KEY, guildOk, guildTagOf, toggleFriendsOnly, toggleGuildOnly } from '../src/net/friends-only';
import { closedCode, withCode, siteWithCode } from '../src/net/site-code';
import { layerRef, artSamples, fingerprints } from '../src/world/fcart/fingerprint';
import { DIALOGS, overlayKind, SITE_PAUSE } from '../src/net/site';
import contract from '../src/data/site-contract.json';
import { MineModel, stoneProgress } from '../src/rooms/mine/state';
import { MineClient, type Timers } from '../src/rooms/mine/net';
import mineEnter from './fixtures/mine-enter.json';
import { gameNow } from '../src/net/game-clock';
import { cdUntil, mmss } from '../src/ui/data';
import { dailiesOn } from '../src/features/site-places';

const APP = siteCopy('app.js', 'const pzKey = (e) =>');
const CITY = siteCopy('city.js', 'const glOn = () =>');
const SUI = siteCopy('site-ui.js', 'function withCode(r)');
const APP_EVE = siteCopy('app.js', 'window.LGGameNow = gnow;');
const TKART_NEEDLE = 'const ROWS = new Set(o.rows || [7]);';

/* ------------------------------------------------------------------ a tiny DOM with real capture / bubble order */
type L = { f: (e: any) => void; cap: boolean };
class Tgt {
  ls = new Map<string, L[]>();
  addEventListener(t: string, f: (e: any) => void, o?: boolean | { capture?: boolean }) { const a = this.ls.get(t) || []; a.push({ f, cap: o === true || !!(o && typeof o === 'object' && o.capture) }); this.ls.set(t, a); }
  removeEventListener(t: string, f: (e: any) => void, o?: boolean | { capture?: boolean }) { const cap = o === true || !!(o && typeof o === 'object' && o.capture); const a = this.ls.get(t) || []; const i = a.findIndex((x) => x.f === f && x.cap === cap); if (i >= 0) a.splice(i, 1); }
}
class El extends Tgt {
  tagName: string; className = ''; attrs: Record<string, string> = {}; children: El[] = []; parent: El | null = null; innerHTML = ''; textContent = ''; title = ''; tabIndex = 0;
  constructor(tag = 'DIV') { super(); this.tagName = tag; }
  setAttribute(k: string, v: string) { this.attrs[k] = String(v); } getAttribute(k: string) { return this.attrs[k] ?? null; }
  appendChild(c: El) { c.parent = this; this.children.push(c); return c; }
  remove() { if (this.parent) { this.parent.children = this.parent.children.filter((x) => x !== this); this.parent = null; } }
  focus() { (globalThis as any).document.activeElement = this; } blur() { (globalThis as any).document.activeElement = (globalThis as any).document.body; }
  get classList() { const s = this; return { add: (c: string) => { if (!s.className.split(' ').includes(c)) s.className = (s.className + ' ' + c).trim(); }, remove: (c: string) => { s.className = s.className.split(' ').filter((x) => x && x !== c).join(' '); }, contains: (c: string) => s.className.split(' ').includes(c) }; }
  querySelector(sel: string): El | null { const c = sel.replace(/^\./, ''); for (const k of this.children) { if (k.classList.contains(c)) return k; const r = k.querySelector(sel); if (r) return r; } return null; }
}
/** Dispatch a key event at `target` (body): window → document → html capture, target, html → document → window bubble. */
function key(type: string, code: string, o: { key?: string; ctrlKey?: boolean } = {}) {
  const D = (globalThis as any).document, W = (globalThis as any).window;
  const target = D.activeElement || D.body;
  const path: Tgt[] = [W, D, D.documentElement];
  if (target !== D.documentElement) path.push(target);
  let stop = false, imm = false;
  const e: any = {
    type, code, key: o.key ?? code.replace(/^Key/, '').toLowerCase(), ctrlKey: !!o.ctrlKey, metaKey: false, altKey: false, shiftKey: false, repeat: false, isComposing: false, keyCode: 0,
    target, defaultPrevented: false, composedPath: () => [...path].reverse(),
    preventDefault() { e.defaultPrevented = true; }, stopPropagation() { stop = true; }, stopImmediatePropagation() { stop = true; imm = true; },
  };
  const run = (n: Tgt, cap: boolean | null) => {
    for (const l of [...(n.ls.get(type) || [])]) { if (cap !== null && l.cap !== cap) continue; l.f(e); if (imm) return; }
  };
  for (const n of path.slice(0, -1)) { run(n, true); if (stop) return e; }
  run(path[path.length - 1], null); if (stop) return e;
  for (const n of path.slice(0, -1).reverse()) { run(n, false); if (stop) return e; }
  return e;
}

/* ------------------------------------------------------------------ 1. pause countdown */
describe('pause countdown 16.11 (app.js pauseWarn → src/features/sitepause.ts)', () => {
  it('our words: «Пауза игры через m:ss», seconds rounded up; nothing before / after', () => {
    const now = 5_000_000;
    expect(pzClock(0)).toBe('0:00'); expect(pzClock(61)).toBe('1:01'); expect(pzClock(600)).toBe('10:00');
    expect(pauseWarnText(now + 42_000, now)).toBe('Пауза игры через 0:42');
    expect(pauseWarnText(now + 41_200, now)).toBe('Пауза игры через 0:42');   // ceil like the site
    expect(pauseWarnText(now + 125_000, now)).toBe('Пауза игры через 2:05');
    expect(pauseWarnText(now + 1, now)).toBe('Пауза игры через 0:01');
    expect(pauseWarnText(now, now)).toBe('');
    expect(pauseWarnText(0, now)).toBe('');
    expect(pauseWarnAt({ on: false, warnAt: now + 9 })).toBe(now + 9);
    expect(pauseWarnAt({ on: true, warnAt: now + 9 })).toBe(0);
    expect(PAUSE_HINT).toBe('Короткий рестарт серверов. Ничего не потеряется');
  });
  it.skipIf(!APP)('the site\'s own pauseWarn (node:vm) writes the same number, and its title is our hint', () => {
    const els: El[] = [];
    const D: any = { createElement: (t: string) => { const e = new El(t); els.push(e); return e; }, body: new El('BODY') };
    // the <b> inside the innerHTML: the fake keeps one child for querySelector('b')
    D.createElement = (t: string) => { const e = new El(t); const b = new El('B'); b.className = 'b'; e.appendChild(b); els.push(e); return e; };
    const c: any = { document: D, Date, Math, String, setTimeout: () => 1, clearTimeout: () => {}, SU: {} };
    vm.createContext(c);
    const clock = /const pzClock = \(s\) => [^\n]+/.exec(APP!)![0];
    vm.runInContext('let warnEl = null, warnT = 0, warnAt = 0, warnBg = null;\n' + clock + '\n' + fnSource(APP!, 'pauseWarn')!.replace("querySelector('b')", "querySelector('.b')"), c);
    for (const ms of [42_000, 41_200, 125_000, 600, 59_999]) {
      const at = Date.now() + ms;
      vm.runInContext('pauseWarn', c)(at);
      const el = els[0];
      expect(el.className).toBe('lg-pzw');
      expect(el.getAttribute('role')).toBe('status');
      expect(el.title).toBe(PAUSE_HINT);
      expect(el.innerHTML).toContain('Пауза игры через <b></b>');
      expect('Пауза игры через ' + el.querySelector('.b')!.textContent).toBe(pauseWarnText(at, Date.now()));
    }
    vm.runInContext('pauseWarn', c)(0);
    expect(els[0].parent).toBeNull();   // gone
  });
});

/* ------------------------------------------------------------------ 2. the pause plaque vs our input */
describe.skipIf(!APP)('pause plaque 16.11 (app.js pauseShow / pzKey) vs src/engine/input.ts', () => {
  let site: { show(on: boolean): void; el(): El | null };
  beforeAll(() => {
    const W = new Tgt() as any, D = new Tgt() as any;
    D.documentElement = new El('HTML'); D.body = new El('BODY'); D.activeElement = D.body;
    D.createElement = (t: string) => new El(t);
    D.pointerLockElement = null; D.exitPointerLock = () => {};
    (globalThis as any).window = Object.assign(W, { setTimeout, clearTimeout });
    (globalThis as any).document = D;
    (globalThis as any).Element = El;
    const c: any = { window: W, document: D, console };
    vm.createContext(c);
    const keyFn = /const pzKey = \(e\) => [^\n]+/.exec(APP!)![0];
    vm.runInContext('let pzEl = null;\n' + keyFn + '\n' + fnSource(APP!, 'pauseShow') + '\nthis.__pz = { show: pauseShow, el: () => pzEl };', c);
    site = c.__pz;
  });

  it('the plaque is an aria-modal alertdialog on <body>: a site dialog for the overlay watcher (the 3D yields)', () => {
    site.show(true);
    const el = site.el()!;
    expect(el.className).toBe('lg-pz');
    expect(PAUSE_SEL).toBe('.lg-pz');
    expect(el.getAttribute('role')).toBe('alertdialog');
    expect(el.getAttribute('aria-modal')).toBe('true');
    expect(DIALOGS).toContain('[aria-modal="true"]');
    expect(el.parent).toBe((globalThis as any).document.body);
    expect((globalThis as any).document.activeElement).toBe(el);   // it takes the focus
    site.show(false);
    expect(site.el()).toBeNull();
  });

  it('overlayKind: the plaque wins over every other site screen — also over a hybrid room\'s panel (which keeps the 3D running)', () => {
    const on = (...sels: string[]) => (sel: string) => sels.includes(sel);
    expect(SITE_PAUSE).toBe(PAUSE_SEL);
    expect(overlayKind(on())).toBeNull();
    expect(overlayKind(on('.cy-room'))).toBe('room');
    expect(overlayKind(on('.cy-room', SITE_PAUSE))).toBe('dialog');
    expect(overlayKind(on('.mn', SITE_PAUSE))).toBe('dialog');
    expect(overlayKind(on('.f2', SITE_PAUSE))).toBe('dialog');
    expect(overlayKind(on(SITE_PAUSE))).toBe('dialog');
    expect(overlayKind(on(DIALOGS))).toBe('dialog');
  });

  it('a key held when the plaque comes is released once gameplay goes off; nothing sticks after it; F8 still reaches us', async () => {
    const { createInput, onPageKeys } = await import('../src/engine/input');
    const D = (globalThis as any).document;
    const canvas: any = new El('CANVAS'); canvas.hasAttribute = () => true; canvas.requestPointerLock = () => {};
    D.activeElement = D.body;
    const inp = createInput(canvas);
    const seen: string[] = [];
    const offK = onPageKeys('keydown', (e) => seen.push(e.code));
    key('keydown', 'KeyW');
    expect(inp.move.y).toBe(1);
    // the pause: the site eats every key at window capture — our listeners never see the keyup
    site.show(true);
    const up = key('keyup', 'KeyW');
    expect(up.defaultPrevented).toBe(true);
    expect(inp.move.y).toBe(1);   // the keyup was eaten …
    // … the overlay watcher (src/features/overlay.ts) sees the aria-modal plaque and turns gameplay off: released
    inp.setGameplay(false);
    expect(inp.move.y).toBe(0);
    seen.length = 0;
    const w = key('keydown', 'KeyW'); const f8 = key('keydown', 'F8', { key: 'F8' }); const cc = key('keydown', 'KeyC', { ctrlKey: true });
    expect(w.defaultPrevented).toBe(true);
    expect(f8.defaultPrevented).toBe(false);
    expect(cc.defaultPrevented).toBe(false);
    expect(seen).toEqual(['F8', 'KeyC']);   // F-keys and chords pass the plaque (pzKey), the rest never reach the page
    key('keyup', 'KeyW');
    // the pause ends: gameplay back, no key held
    site.show(false);
    D.activeElement = D.body;
    inp.setGameplay(true);
    expect(inp.move.y).toBe(0);
    // and the keyboard works again
    key('keydown', 'KeyW'); expect(inp.move.y).toBe(1); key('keyup', 'KeyW'); expect(inp.move.y).toBe(0);
    offK(); inp.dispose();
  });

  it('contract: the 16.11 countdown + plaque checks match the newest copy (and the old pz check is gone)', () => {
    const C = (contract as any).checks as any[];
    const ids = C.map((c) => c.id);
    expect(ids).not.toContain('app.js live event pz (maintenance pause countdown)');
    for (const id of ['app.js live event pz (pause countdown «Пауза игры через m:ss», 16.11)', 'app.js pause plaque .lg-pz (aria-modal, eats keys but Ctrl / Meta / F1–F12, 16.11)']) {
      const c = C.find((x) => x.id === id);
      expect(c, id).toBeTruthy();
      expect(new RegExp(c.re).test(APP!), id).toBe(true);
    }
  });
});

/* ------------------------------------------------------------------ 3. «Только гильдию» */
describe('«Только гильдию» 16.11 (city.js glGet / glOk / lodPick → src/net/friends-only.ts)', () => {
  const store = (init: Record<string, string> = {}) => { const m = new Map(Object.entries(init)); return { get: (k: string) => m.get(k) ?? null, set: (k: string, v: string | null) => { if (v == null) m.delete(k); else m.set(k, v); }, m }; };
  it('guildTagOf / guildOk: the hero\'s gt, else the own walker\'s; offered only with hero.go', () => {
    expect(guildTagOf({ hero: () => ({ gt: 'SOF' }) })).toBe('SOF');
    expect(guildTagOf({ hero: () => ({}), ownTag: () => 'ABC' })).toBe('ABC');
    expect(guildTagOf({ hero: () => null })).toBe('');
    expect(guildOk({ hero: () => ({ gt: 'SOF' }) })).toBe(false);
    expect(guildOk({ hero: () => ({ gt: 'SOF', go: 1 }) })).toBe(true);
    expect(guildOk({ hero: () => ({ go: true }) })).toBe(false);
  });
  it('the pause-menu toggles keep friends and guild one choice (capPick / froToggle)', () => {
    const s = store({ [GL_KEY]: '1' });
    expect(toggleFriendsOnly(s)).toBe(true);
    expect(s.m.get(FR_KEY)).toBe('1'); expect(s.m.has(GL_KEY)).toBe(false);
    expect(toggleGuildOnly(s)).toBe(true);
    expect(s.m.get(GL_KEY)).toBe('1'); expect(s.m.has(FR_KEY)).toBe(false);
    expect(toggleGuildOnly(s)).toBe(false);
    expect(s.m.has(GL_KEY)).toBe(false);
  });

  it.skipIf(!CITY)('the same walkers as the site\'s own lodPick filter (node:vm), over flags × hero × friends', async () => {
    const src = CITY!;
    const pick = (re: RegExp) => { const m = re.exec(src); if (!m) throw new Error('not in city.js: ' + re); return m[0]; };
    const defs = [
      pick(/const frGet = \(\) => [^\n]+/), pick(/const glGet = \(\) => [^\n]+/),
      pick(/const frOk = \(\) => [^\n]+/), pick(/const frOn = \(\) => [^\n]+/),
      pick(/const glTag = \(\) => [^\n]+/), pick(/const glOk = \(\) => [^\n]+/), pick(/const glOn = \(\) => [^\n]+/),
    ].join('\n');
    expect(src).toMatch(/onlyFr: frGet\(\),[^\n]*onlyGl: !frGet\(\) && glGet\(\),/);
    const branch = pick(/ {4}if \(frOn\(\)\) \{\n[\s\S]*?\n {4}\}\n(?= {4}const vis)/);
    const walkers = [{ l: 'a1', gt: 'SOF' }, { l: 'Fr1', gt: 'XYZ' }, { l: 'b2' }, { l: 'c3', gt: 'sof' }, { l: 'd4', gt: 'SOF' }];
    const friends = ['fr1', 'd4'];
    const flags: Record<string, string>[] = [{}, { [FR_KEY]: '1' }, { [GL_KEY]: '1' }, { [FR_KEY]: '1', [GL_KEY]: '1' }];
    const heroes: any[] = [{}, { gt: 'SOF' }, { gt: 'SOF', go: 1 }, { go: 1 }];
    let n = 0;
    for (const fl of flags) for (const hero of heroes) for (const hasFr of [true, false]) for (const ownGt of ['', 'SOF']) {
      const ls = new Map(Object.entries(fl));
      const win: any = hasFr ? { LGFriends: { friends: () => Promise.resolve(friends) } } : {};
      const c: any = { localStorage: { getItem: (k: string) => ls.get(k) ?? null }, window: win, X: { hero: () => hero }, String, Set, console };
      vm.createContext(c);
      vm.runInContext(defs + '\nvar S = { onlyFr: frGet(), onlyGl: !frGet() && glGet(), frs: new Set(' + JSON.stringify(friends) + '), frAt: 0, me: { v: { gt: ' + JSON.stringify(ownGt) + ' } } };\n'
        + 'function frLoad() {}\nthis.run = (others) => { const t = 0; let list = others.slice(); const set = () => {};\n' + branch + '\n return list.map((w) => w.l); };', c);
      const siteVis: string[] = c.run(walkers.map((w) => ({ l: w.l, v: { gt: w.gt } })));
      const fo = new FriendsOnly({ get: (k) => ls.get(k) ?? null, friends: () => (hasFr ? () => Promise.resolve(friends) : null), hero: () => hero, ownTag: () => ownGt || null });
      fo.tick(1e6);
      await Promise.resolve(); await Promise.resolve();
      const ours = walkers.filter((w) => fo.allows(w.l, w.gt)).map((w) => w.l);
      expect(ours, JSON.stringify({ fl, hero, hasFr, ownGt })).toEqual(siteVis);
      n++;
    }
    expect(n).toBe(64);
  });
});

/* ------------------------------------------------------------------ 4. «(код X01)» */
describe('closed answers carry a code (site-ui.js closedCode / withCode → src/net/site-code.ts)', () => {
  const cases: any[] = [
    { ok: false, closed: true, code: 'C01', error: 'Город сейчас закрыт' },
    { ok: false, closed: true, code: 'C01', error: 'town_closed' },                 // not human words: untouched
    { ok: false, closed: true, code: 'C1', error: 'Город сейчас закрыт' },          // bad code
    { ok: false, closed: true, code: 'Z99', text: 'Пока закрыто для всех', error: 'Нет доступа здесь' },
    { ok: false, closed: true, code: 'A10', error: 'Уже есть (код A10)' },          // once
    { ok: false, closed: false, code: 'C01', error: 'Город сейчас закрыт' },
    { ok: true, closed: true, code: 'C01', error: 'Город сейчас закрыт' },
    null, 7, 'x',
  ];
  it('ours: « (код X01)» once, on human Russian error / text of a closed answer only', () => {
    expect(withCode({ ok: false, closed: true, code: 'C01', error: 'Город сейчас закрыт' })).toEqual({ ok: false, closed: true, code: 'C01', error: 'Город сейчас закрыт (код C01)' });
    expect(closedCode({ ok: false, closed: true, code: 'c01' })).toBe('');
    expect(siteWithCode({ ok: false, closed: true, code: 'B02', error: 'Нет связи сейчас' }, { LGSiteUi: { withCode: (r: any) => ({ ...r, site: 1 }) } })).toMatchObject({ site: 1 });
    expect(siteWithCode({ ok: false, closed: true, code: 'B02', error: 'Нет связи сейчас' }, { LGSiteUi: { withCode: () => { throw new Error('x'); } } }).error).toBe('Нет связи сейчас (код B02)');
  });
  it.skipIf(!SUI)('the site\'s own withCode (node:vm) gives the same objects', () => {
    const src = SUI!;
    const code = /const CODE_RE = [^\n]+/.exec(src)![0], human = /const human = [^\n]+/.exec(src)![0];
    const c: any = {}; vm.createContext(c);
    vm.runInContext(code + '\n' + fnSource(src, 'closedCode') + '\n' + human + '\n' + fnSource(src, 'withCode') + '\nthis.w = withCode; this.cc = closedCode;', c);
    for (const x of cases) {
      const a = JSON.parse(JSON.stringify(x)), b = JSON.parse(JSON.stringify(x));
      expect(closedCode(a)).toBe(c.cc(b));
      expect(JSON.stringify(withCode(a))).toBe(JSON.stringify(c.w(b)));
    }
  });
});

/* ------------------------------------------------------------------ 5. tk-art.js tree rows vs the 'relief' fingerprint */
const tkCopies = (() => {
  const base = resolve(__dirname, '../.local');
  if (!existsSync(base)) return [] as string[];
  return readdirSync(base).filter((d) => /^site-\d{4}-\d{4}$/.test(d) && existsSync(join(base, d, 'tk-art.js')) && existsSync(join(base, d, 'tk-map.js'))).sort().reverse().map((d) => join(base, d));
})();
const newTk = tkCopies.find((d) => readFileSync(join(d, 'tk-art.js'), 'utf8').includes(TKART_NEEDLE)) ?? null;
const oldTk = tkCopies.find((d) => !readFileSync(join(d, 'tk-art.js'), 'utf8').includes(TKART_NEEDLE)) ?? null;
describe('tk-art.js Ground rows (16.11) and fingerprint.ts layerRef', () => {
  it('row chunks (640 + 2 M high at j·CH − M, any width) are grid, not map layers', () => {
    const map: any = { W: 6000, buildings: [], STREETS: [], STAIRS: [] };
    expect(layerRef({ x: 183, y: -280, w: 5863, h: 1200, svg: '' } as any, map)).toBeNull();
    expect(layerRef({ x: -228, y: 360, w: 6272, h: 1200, svg: '' } as any, map)).toBeNull();
    expect(layerRef({ x: 10, y: 490, w: 3000, h: 940, svg: '' } as any, map)).toBeNull();
    expect(layerRef({ x: 2090, y: 1040, w: 3370, h: 430, svg: '' } as any, map)).toBe('relief');
    expect(layerRef({ x: 2110, y: 1040, w: 3370, h: 290, svg: '' } as any, map)).toBe('relief');
  });
  it.skipIf(!newTk || !oldTk)('the Town Kit fixture town: the same relief / every fingerprint on the 15.11 and 16.11 copies', async () => {
    const { siteModules } = await import('../scripts/fcart-fp.mjs' as string);
    const fx = JSON.parse(readFileSync(resolve(__dirname, 'fixtures/townkit-map.json'), 'utf8'));
    const o = { levels: fx.cfg?.levels, building: fx.cfg?.building, now: fx.cfg?.now };
    const fps = [oldTk!, newTk!].map((d) => {
      const { K, M } = siteModules(d);
      const R = K.drawTown(fx.T, o), map = M.layoutOf(fx.T);
      return { R, map, fp: fingerprints(artSamples(R, map, K, o, 'tk:')) };
    });
    // 16.11 has fewer, wider pass-7 chunks — none of them may count as a map layer
    const rows = fps[1].R.layers.filter((l: any) => l.h === 1200 && l.w !== l.h);
    expect(rows.length).toBeGreaterThan(0);
    for (const l of rows) expect(layerRef(l, fps[1].map)).toBeNull();
    expect(fps[1].fp['tk:relief']).toEqual(fps[0].fp['tk:relief']);
    expect(fps[1].fp).toEqual(fps[0].fp);
  });
});

/* ------------------------------------------------------------------ 6. mine.js server clock (clk / srvNow) */
const MINE = siteCopy('mine.js', 'const srvNow = () =>');
describe('mine.js 16.11: stone timings at the server\'s time (clk / srvNow → MineModel.dt / srvNow)', () => {
  it('MineModel.clk takes the offset from an answer\'s now; bad values keep the last one', () => {
    const M = new MineModel('p');
    expect(M.srvNow(5000)).toBe(5000);
    M.clk({ now: 1000 }, 31_000); expect(M.dt).toBe(30_000); expect(M.srvNow(32_000)).toBe(2000);
    for (const bad of [{}, { now: 0 }, { now: -5 }, { now: 'x' }, null]) { M.clk(bad as any, 99_999); expect(M.dt).toBe(30_000); }
  });
  it.skipIf(!MINE)('the site\'s own clk / srvNow (node:vm) agree', () => {
    const c: any = { S: {}, Number, Date: { now: () => 31_000 } }; vm.createContext(c);
    vm.runInContext(fnSource(MINE!, 'clk') + '\n' + /const srvNow = \(\) => [^\n]+/.exec(MINE!)![0] + '\nthis.srvNow = srvNow;', c);
    vm.runInContext('clk({ now: 1000 })', c);
    c.Date.now = () => 32_000;
    const M = new MineModel('p'); M.clk({ now: 1000 }, 31_000);
    expect(c.srvNow()).toBe(M.srvNow(32_000));
    expect(MINE!).toMatch(/hereOf\(r\); presence\(r\); clk\(r\); take\(r\.st, r\.me, r\.lk\);/);          // poll
    expect(MINE!).toMatch(/if \(d\.st && !document\.hidden\) \{ clk\(d\); take\(d\.st, null\); \}/);       // live
    expect(MINE!).toMatch(/age = Math\.max\(0, \(srvNow\(\) - \(st\.at \|\| srvNow\(\)\)\) \/ 60000\)/);  // expectOf
  });
  it('MineClient: enter / poll / a live view set the offset; progress of a stone follows the server clock', async () => {
    const local = 1_700_000_100_000, server = local - 45_000;   // the player's computer is 45 s ahead
    const T: Timers = { setInterval: () => 1, clearInterval: () => {}, setTimeout: () => 1, clearTimeout: () => {} };
    const st = { ...JSON.parse(JSON.stringify((mineEnter as any).st)), at: server };
    const api = async (p: string) => (p.startsWith('/api/mine/enter') ? { ...JSON.parse(JSON.stringify(mineEnter)), st, now: server } : { ok: true });
    const c = new MineClient({ api, login: 'player1', c: 'home', timers: T, now: () => local, hero: () => ({ login: 'player1', items: [], mn: { home: {} } }) as any });
    await c.enter({ x: 303, y: 2393 });
    expect(c.model.dt).toBe(45_000);
    expect(c.model.srvNow(local)).toBe(server);
    c.onEvent({ c: 'home', st: { ...st, v: st.v + 1, at: server + 1000 }, now: server + 1000 } as any);
    expect(c.model.dt).toBe(45_000 - 1000);
    // a stone dug at 1 / min with 10 left: at the server's «now» nothing has passed yet (the local clock would say 45 s)
    const view = { ...st, at: server, bl: { 3: [10, 10, 1, 1] } } as any;
    const M = new MineModel('p'); M.clk({ now: server }, local);
    expect(stoneProgress(view, 3, M.srvNow(local))!.p).toBe(0);
    expect(stoneProgress(view, 3, local)!.p).toBeCloseTo(0.075, 3);
  });
});

/* ------------------------------------------------------------------ 7. the second update of 16.11 (21:40): the game clock */
describe('app.js game clock 16.11 evening (gnow / LGGameNow → src/net/game-clock.ts)', () => {
  it('gameNow: the page\'s LGGameNow when it answers a number, else the local clock', () => {
    expect(gameNow({ LGGameNow: () => 1234 })).toBe(1234);
    const t0 = Date.now();
    for (const w of [{}, { LGGameNow: () => NaN }, { LGGameNow: () => { throw new Error('x'); } }, { LGGameNow: 5 }, undefined]) expect(gameNow(w)).toBeGreaterThanOrEqual(t0);
  });
  it('the food / scroll cooldown and its m:ss follow the game clock (app.js cdUntil / mmss)', () => {
    const gn = 1_000_000;   // the game lags the wall clock after a pause: eatUntil is still ahead in game time
    const h: any = { eatUntil: gn + 90_000, scrollUntil: gn - 1 };
    expect(cdUntil({ slot: 'food' } as any, h, gn)).toBe(gn + 90_000);
    expect(cdUntil({ slot: 'potion' } as any, h, gn + 90_000)).toBe(0);
    expect(cdUntil({ slot: 'scroll', effect: { revive: 1 } } as any, h, gn)).toBe(0);
    expect(mmss(gn + 90_000, gn)).toBe('1:30');
  });
  it.skipIf(!APP_EVE)('the site\'s own gnow / cdUntil / mmss (node:vm) = ours at the same game time', () => {
    const src = APP_EVE!;
    const pick = (re: RegExp) => { const m = re.exec(src); if (!m) throw new Error(String(re)); return m[0]; };
    const c: any = { Date: { now: () => 5_000_000 }, Number, Math, String, window: {} }; vm.createContext(c);
    vm.runInContext([
      'let OFF = 0;', pick(/const now = \(\) => Date\.now\(\) \+ OFF;/), pick(/const clock = \(t\) => [^\n]+/),
      'let GDT = 0;', pick(/const gnow = \(\) => now\(\) - GDT;/), pick(/const gdtSet = \(d\) => [^\n]+/), pick(/const gclock = \(n, g\) => [^\n]+/),
      pick(/const mmss = \(t\) => [^\n]+/), pick(/const cdUntil = \(it, h\) => [^\n]+/),
      'this.api = { clock, gclock, gnow, mmss, cdUntil };',
    ].join('\n'), c);
    const A = c.api;
    A.clock(5_002_000); A.gclock(5_002_000, 4_900_000);   // server 2 s ahead, the game 102 s behind the server
    const gn = A.gnow();
    expect(gn).toBe(4_900_000);
    const h: any = { eatUntil: gn + 75_000, scrollUntil: gn + 5_000 };
    for (const it of [{ slot: 'food' }, { slot: 'potion' }, { slot: 'scroll', effect: { revive: 1 } }, { slot: 'weapon' }] as any[]) expect(cdUntil(it, h, gameNow({ LGGameNow: A.gnow }))).toBe(A.cdUntil(it, h));
    expect(mmss(h.eatUntil, gameNow({ LGGameNow: A.gnow }))).toBe(A.mmss(h.eatUntil));
    A.gclock(5_002_000, 5_001_500);   // |GDT| ≤ 1 s counts as none
    expect(A.gnow()).toBe(5_002_000);
  });
  it.skipIf(!APP_EVE)('daily tasks: LGDailies (open / sync) is app.js\'s own now, and still only with hero dl', () => {
    expect(APP_EVE!).toMatch(/if \(!window\.LGDailies\) window\.LGDailies = \{[\s\S]{0,200}sync\(\) \{[\s\S]{0,100}open\(\) \{ if \(!dlOf\(\)\) return;/);
    expect(APP_EVE!).toMatch(/const dlOf = \(\) => \(ME && ME\.user && ME\.hero && ME\.hero\.dl\) \|\| null;/);
    const w = { LGDailies: { open() {}, sync() {} } };
    expect(dailiesOn({ dl: { n: 1, of: 3 } }, w)).toBe(true);
    expect(dailiesOn({}, w)).toBe(false);
  });
});
