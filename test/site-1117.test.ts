/**
 * Site update 17.11 (morning).
 *  - tk-art.js redrawn: building styles per biome (STYLE_OF: forest / taiga / swamp → 'log', desert → 'adobe', ice / mount →
 *    'nordic', ash / blight → 'dark'; meadow and the rest stay 'classic'), peaked rocks with a cave mouth, a flat mine head,
 *    side / ring walls, lava water, new trees (palm, cactus, snowpine, deadtree, willow, birch), `mark` items. Our kit town d04
 *    «Рябиново» is a meadow town: its drawings did not change. The adit layer is wider now (door ± 290 instead of ± 230), so
 *    fingerprint.ts layerRef missed it — that is why «tk:mine» looked gone. tk-map.js lays d04 out exactly as before.
 *  - app.js daily tasks: `dl()` inside a module, a reward scale (hero dl.d / n / of / mk), the window is a card #dlCard
 *    (dailies.js), not a dialog — src/net/site.ts DAILY_CARD, src/features/site-places.ts dailiesOn (dl.d).
 *  - doodle.js capePattern (lk.capePat, the «Премиум+» cape patterns) → src/avatar/model.ts addCapePattern.
 * The site's own code (local copies `.local/site-*`, not in the repo) runs here in node:vm; skipped without them.
 */
import { describe, it, expect } from 'vitest';
import vm from 'node:vm';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { siteCopy, fnSource } from './site-quest-fns';
import { layerRef, artSamples, fingerprints } from '../src/world/fcart/fingerprint';
import { overlayKind, DAILY_CARD, DIALOGS } from '../src/net/site';
import { dailiesOn } from '../src/features/site-places';
import contract from '../src/data/site-contract.json';
import d04 from './fixtures/townkit-d04.json';
import { townKitScene, forestMix } from '../src/net/townkit';
import { kitFixtureLayout } from '../dev/fixtures';
import { lintTownSource } from '../src/world/lint/town';
import { appearanceFrom, capePatOf, CAPE_PATS } from '../src/avatar/appearance';
import { getModel, modelKey } from '../src/avatar/model';

const BASE = resolve(__dirname, '../.local');
const copies = existsSync(BASE) ? readdirSync(BASE).filter((d) => /^site-\d{4}-\d{4}$/.test(d)).sort().reverse().map((d) => join(BASE, d)) : [];
const has = (d: string, f: string, needle: string) => existsSync(join(d, f)) && readFileSync(join(d, f), 'utf8').includes(needle);
/** 17.11 tk-art.js (biome styles) and the newest copy before it. */
const NEW = copies.find((d) => has(d, 'tk-art.js', 'const STYLE_OF = {') && existsSync(join(d, 'tk-map.js'))) ?? null;
const OLD = copies.find((d) => existsSync(join(d, 'tk-art.js')) && existsSync(join(d, 'tk-map.js')) && !has(d, 'tk-art.js', 'const STYLE_OF = {')) ?? null;
const APP = siteCopy('app.js', 'function openWin(at) { if (!dl() || !dl().d || !at) return;');
const DAILIES = siteCopy('dailies.js', "card.id = 'dlCard'");
const DOODLE = siteCopy('doodle.js', 'function capePattern(k, id)');
const mods = async (d: string) => ((await import('../scripts/fcart-fp.mjs' as string)) as any).siteModules(d);
const D = d04 as any;
const o4 = { levels: D.cfg.levels, building: D.cfg.building, now: D.cfg.now };

/* ------------------------------------------------------------------ 1. the Town Kit art */
describe('tk-art.js 17.11: the mine layer, d04 unchanged, biome styles', () => {
  it('layerRef names the 17.11 adit layer (door ± 290) «mine», the old one (± 230) still', () => {
    const map: any = { W: 5760, buildings: [{ id: 'mine', door: { x: 1050, y: 900 } }], STREETS: [], STAIRS: [] };
    expect(layerRef({ x: 760, y: 565, w: 580, h: 380, svg: '' } as any, map)).toBe('mine');
    expect(layerRef({ x: 820, y: 625, w: 460, h: 320, svg: '' } as any, map)).toBe('mine');
    expect(layerRef({ x: 700, y: 565, w: 580, h: 380, svg: '' } as any, map)).not.toBe('mine');
  });
  it.skipIf(!NEW || !OLD)('d04 «Рябиново» (meadow → classic): every building / house / item drawing is the same; the mine, wall and towers only got a bigger box', async () => {
    const out = await Promise.all([OLD!, NEW!].map(async (d) => {
      const { K, M } = await mods(d);
      const S = artSamples(K.drawTown(D.T, o4), M.layoutOf(D.T), K, o4, 'tk:');
      return { S, fp: fingerprints(S) };
    }));
    expect(out[1].fp['tk:mine']).toBeTruthy();   // named again (it fell into 'relief' with the old rule)
    for (const ref of Object.keys(out[0].fp)) {
      if (/^tk:(terrain|fog|relief|forest|mine|wall|tower)$/.test(ref)) continue;
      if (ref === 'tk:i:mailbox') continue;   // redrawn in the evening of 17.11 (a pole for the flag): test/site-1117b.test.ts
      expect(out[1].fp[ref], ref).toEqual(out[0].fp[ref]);
    }
    // the three refs whose fingerprint moved: the very same SVG drawn into a taller / wider box
    for (const ref of ['tk:mine', 'tk:wall', 'tk:tower']) {
      const a = out[0].S.filter((s: any) => s.ref === ref).map((s: any) => s.raw).sort(), b = out[1].S.filter((s: any) => s.ref === ref).map((s: any) => s.raw).sort();
      expect(b, ref).toEqual(a);
    }
  }, 30000);
  it.skipIf(!NEW || !OLD)('tk-map.js 17.11 lays d04 out as before: plots, obstacles, walk grid, the mine', async () => {
    const [a, b] = await Promise.all([OLD!, NEW!].map(async (d) => {
      const { M } = await mods(d);
      const lv = M.mapLevels(D.cfg.levels, D.cfg.building, D.cfg.now), t = M.townAt(D.T, lv);
      return { lev: JSON.stringify(M.levelled(D.T, lv)), ob: JSON.stringify(t.OB.map(({ box, ...q }: any) => q)), G: Array.from(t.G).join(''), ring: typeof M.ringPieces === 'function' ? M.ringPieces(M.layoutOf(D.T)).length : 0 };
    }));
    expect(b.lev).toBe(a.lev); expect(b.ob).toBe(a.ob); expect(b.G).toBe(a.G);
    expect(b.ring).toBe(0);   // d04 has no ring wall
    expect(b.G).toBe(D.grid.G);   // = the regenerated fixture
  }, 30000);
  it.skipIf(!NEW || !OLD)('the kit buildings change only with a biome style: a meadow town draws the same, a forest one in logs', async () => {
    const fx = JSON.parse(readFileSync(resolve(__dirname, 'fixtures/townkit-map.json'), 'utf8'));
    const o = { levels: fx.cfg.levels, building: fx.cfg.building, now: fx.cfg.now };
    const draw = async (d: string, biome: string) => { const { K, M } = await mods(d); const T = { ...fx.T, biome }; return fingerprints(artSamples(K.drawTown(T, o), M.layoutOf(T), K, o, 'tk:')); };
    const { K } = await mods(NEW!);
    expect(K.STYLE_OF.forest).toBe('log');
    expect(K.STYLE_OF.meadow).toBeUndefined();
    const [m0, m1, f0, f1] = await Promise.all([draw(OLD!, 'meadow'), draw(NEW!, 'meadow'), draw(OLD!, 'forest'), draw(NEW!, 'forest')]);
    for (const ref of ['tk:hall', 'tk:shop', 'tk:forge', 'tk:house:red', 'tk:house:tavern']) {
      expect(m1[ref].fp, 'meadow ' + ref).toBe(m0[ref].fp);
      expect(f1[ref].fp, 'forest ' + ref).not.toBe(f0[ref].fp);
    }
  }, 60000);
});

/* ------------------------------------------------------------------ 2. d04 in 3D: the fixture, the mine */
describe('d04 in 3D after 17.11: the fixture, the mine entrance builds and is reachable', () => {
  it('the regenerated fixture carries the town file\'s new tsar box (king of the hill spot), nothing else moved', () => {
    expect(D.T.tsar).toEqual({ x0: 3616, y0: 32, x1: 4176, y1: 320 });
    const mine = D.levelled.find((b: any) => b.id === 'mine');
    expect(mine.door).toBeTruthy();
  });
  it('the 3D town builds the mine building and the walk grid reaches its door from the spawn', () => {
    const L = kitFixtureLayout({ id: 'd04' });
    const mine = L.buildings.find((b) => b.id === 'mine')!;
    expect(mine && mine.mine).toBe(true);
    const src = lintTownSource('d04', L);
    expect(src.pieces.filter((p) => p.tag === 'mine').length).toBeGreaterThan(5);
    // flood fill over our walk rule (L.free, 16 px) from the spawn: some cell within 64 px of the mine door
    const C = 16, cols = Math.ceil(L.W / C), rows = Math.ceil(L.H / C), seen = new Uint8Array(cols * rows);
    const sx = Math.floor(L.spawn![0] / C), sy = Math.floor(L.spawn![1] / C);
    expect(L.free(L.spawn![0], L.spawn![1])).toBe(true);
    const q = [sy * cols + sx]; seen[q[0]] = 1;
    let near = false;
    while (q.length && !near) {
      const i = q.pop()!, x = i % cols, y = (i - x) / cols, px = x * C + C / 2, py = y * C + C / 2;
      if (Math.hypot(px - mine.door.x, py - mine.door.y) < 64) near = true;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy, j = ny * cols + nx;
        if (nx < 0 || ny < 0 || nx >= cols || ny >= rows || seen[j]) continue;
        seen[j] = 1;
        if (L.free(nx * C + C / 2, ny * C + C / 2)) q.push(j);
      }
    }
    expect(near).toBe(true);
  }, 60000);
  it('a kit town with a side wall (E / W) leaves the wall out of the 3D, «stakes» is a palisade; snowpine / cactus count as pines', () => {
    const T = { ...D.T, wall: { ...D.T.wall, side: 'E', x0: 5300, x1: 5340, y0: 600, y1: 2900, gate: [1500, 1650] } };
    expect(townKitScene(T, D.levelled, o4)!.wall.x0).toBeNaN();
    expect(townKitScene({ ...D.T, wall: { ...D.T.wall, k: 'stakes' } }, D.levelled, o4)!.wall.k).toBe('palisade');
    expect(townKitScene({ ...D.T, wall: { ...D.T.wall, k: 'stone' } }, D.levelled, o4)!.wall.k).toBeUndefined();
    expect(forestMix({ biome: 'ice', nature: { snowpine: 3, birch: 1 } })).toEqual({ pine: 0.75, rowan: 0 });
  });
  it('the new tree items stand in 3D (as a pine / the leafy tree), not as invisible trunks', () => {
    const count = (extra: any[]) => {
      const L = kitFixtureLayout({ id: 'd04' });
      (L as any).faircats.items.push(...extra);
      const k = lintTownSource('d04', L).k, out: Record<string, number> = {};
      for (const [kind, a] of k.inst.placed) out[kind] = a.length;
      return out;
    };
    const [x, y] = [2600, 2300];
    const a = count([]), b = count([{ k: 'palm', x, y }, { k: 'snowpine', x: x + 300, y }, { k: 'birch', x: x + 600, y }, { k: 'mark', x: x + 900, y, w: 100 }]);
    const diff = Object.keys(b).filter((kind) => (b[kind] || 0) !== (a[kind] || 0)).map((kind) => [kind, b[kind] - (a[kind] || 0)]);
    expect(diff.find(([kind]) => kind === 'fc:pine')?.[1]).toBe(1);                       // snowpine
    expect(diff.reduce((s, [, d]) => s + (d as number), 0)).toBe(3);                    // + palm, birch as the tree; mark: nothing
  }, 60000);
});

/* ------------------------------------------------------------------ 3. daily tasks: the card */
type Ls = Map<string, ((e: any) => void)[]>;
class El {
  tagName: string; id = ''; className = ''; hidden = false; innerHTML = ''; attrs: Record<string, string> = {}; style: Record<string, string> = {};
  children: El[] = []; ls: Ls = new Map(); isConnected = true;
  constructor(t: string) { this.tagName = t.toUpperCase(); }
  setAttribute(k: string, v: string) { this.attrs[k] = String(v); } getAttribute(k: string) { return this.attrs[k] ?? null; }
  addEventListener(t: string, f: (e: any) => void) { const a = this.ls.get(t) || []; a.push(f); this.ls.set(t, a); }
  appendChild(c: El) { this.children.push(c); return c; }
  querySelector(_s: string) { return new El('div'); }
  contains(x: unknown) { return x === this; }
  get classList() { const s = this; return { toggle: (c: string, on?: boolean) => { const has = s.className.split(' ').includes(c); const want = on ?? !has; s.className = want ? (has ? s.className : (s.className + ' ' + c).trim()) : s.className.split(' ').filter((x) => x !== c).join(' '); }, add() {}, remove() {}, contains: (c: string) => s.className.split(' ').includes(c) }; }
  getBoundingClientRect() { return { left: 10, top: 40, bottom: 80, right: 400, width: 390, height: 40 }; }
  focus() {}
}
describe('daily tasks 17.11: app.js dl() / openWin (dl.d), the card #dlCard the 3D yields to', () => {
  it('dailiesOn needs dl.d now (app.js openWin), and LGDailies.open', () => {
    const w = { LGDailies: { open() {}, sync() {} } };
    expect(dailiesOn({ dl: { d: 1, n: 2, of: 6, mk: [[50, 0, 0]] } }, w)).toBe(true);
    expect(dailiesOn({ dl: { n: 2, of: 6 } }, w)).toBe(false);
    expect(dailiesOn({ dl: { d: 1 } }, {})).toBe(false);
  });
  it('overlayKind: a shown #dlCard is a dialog (the 3D hides and pauses), a hidden one nothing', () => {
    expect(DIALOGS.includes(DAILY_CARD)).toBe(false);   // it is not a dialog for the site either: its own rule
    expect(overlayKind((s) => s === DAILY_CARD)).toBe('dialog');
    expect(overlayKind(() => false)).toBeNull();
  });
  it.skipIf(!APP)('the contract checks match the 17.11 app.js / dailies.js', () => {
    for (const [id, src] of [['app.js dl (hero dl.d)', APP], ['dailies.js card #dlCard', DAILIES]] as [string, string | null][]) {
      const c = (contract as any).checks.find((x: any) => x.id === id);
      expect(c, id).toBeTruthy();
      if (src) expect(new RegExp(c.re).test(src), id).toBe(true);
    }
    expect((contract as any).checks.some((x: any) => x.id === 'app.js dlOf (hero dl)')).toBe(false);
    expect(APP!).toMatch(/open: \(at\) => openWin\(at && at\.nodeType === 1 \? at : bar\)/);   // our open() → the bar
  });
  it.skipIf(!DAILIES)('the site\'s dailies.js: toggle() shows a role="region" div #dlCard on <body>, toggling again hides it', async () => {
    const body = new El('body'), docLs: Ls = new Map();
    const document = { body, documentElement: { clientWidth: 1280 }, createElement: (t: string) => new El(t), querySelector: () => null,
      addEventListener: (t: string, f: (e: any) => void) => { const a = docLs.get(t) || []; a.push(f); docLs.set(t, a); } };
    const window: any = { addEventListener() {}, scrollX: 0, scrollY: 0 };
    vm.runInNewContext(DAILIES!, { window, document, fetch: () => Promise.reject(new Error('offline')), console, setTimeout, clearTimeout, Promise, JSON, Math, String, Number, Array, Object, Date });
    const bar = new El('section'); bar.id = 'dl-bar';
    const H = { bar: () => bar, redraw() {}, data: () => null, take() {}, ico: {}, money: (n: number) => String(n), toast() {} };
    window.LGDailiesWin.toggle(H, bar);
    const card = body.children.find((c) => c.id === 'dlCard')!;
    expect(card).toBeTruthy();
    expect(card.tagName).toBe('DIV');
    expect(card.attrs.role).toBe('region');
    expect(card.hidden).toBe(false);
    const shown = (s: string) => s === DAILY_CARD && !card.hidden;
    expect(overlayKind(shown)).toBe('dialog');
    await new Promise((r) => setTimeout(r, 0));
    window.LGDailiesWin.toggle(H, bar);
    expect(card.hidden).toBe(true);
    expect(overlayKind(shown)).toBeNull();
    // Esc closes it too (the site's own keydown on document)
    window.LGDailiesWin.toggle(H, bar);
    for (const f of docLs.get('keydown') || []) f({ key: 'Escape' });
    expect(card.hidden).toBe(true);
  });
});

/* ------------------------------------------------------------------ 4. citymon.js: elite chain fights, placement unchanged */
const CM = siteCopy('citymon.js', 'function chainDlg(F, hpX');
const CM12 = existsSync(join(BASE, 'site-1112-1439', 'citymon.js')) ? readFileSync(join(BASE, 'site-1112-1439', 'citymon.js'), 'utf8') : null;
describe('citymon.js 17.11: an elite fight is a chain of duels in the site\'s dialog; placement / FORM as our port', () => {
  it.skipIf(!CM || !CM12)('placeAll and FORM are the 12.11 text our port (src/net/citymon.ts, test/site-1112b) was checked against', () => {
    expect(fnSource(CM!, 'placeAll')).toBe(fnSource(CM12!, 'placeAll'));
    const form = (s: string) => /const FORM = \{[^;]*\};/.exec(s)?.[0];
    expect(form(CM!)).toBe(form(CM12!));
    // the chain is drawn inside the same `dialog(...)` the 3D already yields to (overlay 'dialog')
    expect(fnSource(CM!, 'chainDlg')).toMatch(/d = dialog\(`<h3>/);
  });
});

/* ------------------------------------------------------------------ 5. cape patterns */
describe('doodle.js 17.11 capePattern (lk.capePat) on the 3D cape', () => {
  it('only the site\'s ids are kept; they are part of the model key', () => {
    expect(capePatOf('stars')).toBe('stars');
    expect(capePatOf('plaid')).toBeNull();
    const a = appearanceFrom('cp1', { lk: { shape: 'bean', acc: ['cape'], capePat: 'runes' } }, 'cats', null);
    expect(a.look.capePat).toBe('runes');
    expect(appearanceFrom('cp1', { lk: { shape: 'bean', acc: ['cape'], capePat: 'zzz' } }, 'cats', null).look.capePat).toBeUndefined();
    const b = appearanceFrom('cp1', { lk: { shape: 'bean', acc: ['cape'] } }, 'cats', null);
    expect(modelKey(a)).not.toBe(modelKey(b));
  });
  it('every pattern adds geometry to a real cape; none without the cape acc (vampire / pioneer capes stay plain)', () => {
    const n = (lk: any) => getModel(appearanceFrom('cpx', { lk: { shape: 'bean', ...lk } }, 'cats', null)).geo.attributes.position.count;
    const plain = n({ acc: ['cape'] });
    for (const p of CAPE_PATS) expect(n({ acc: ['cape'], capePat: p }), p).toBeGreaterThan(plain);
    expect(n({ acc: ['pioneer'], capePat: 'stars' })).toBe(n({ acc: ['pioneer'] }));
    expect(n({ acc: ['vampcape'], capePat: 'stars' })).toBe(n({ acc: ['vampcape'] }));
  });
  it.skipIf(!DOODLE)('the site draws exactly these ids (any other draws nothing)', () => {
    const src = fnSource(DOODLE!, 'capePattern')!;
    const fn = vm.runInNewContext(`(${src.replace(/^function capePattern/, 'function')})`, {});
    const k = { L: 30, R: 70 };
    for (const p of CAPE_PATS) expect(fn(k, p).length, p).toBeGreaterThan(20);
    for (const p of ['', 'plaid', 'none']) expect(fn(k, p)).toBe('');
    expect(DOODLE!).toMatch(/if \(capeCol && !extra\.cape && lk && lk\.capePat && !\(k\.b && k\.b\.G\)\)/);
    expect(DOODLE!).toMatch(/const capeCol = extra\.cape \|\| \(acc\.has\('cape'\) \?/);
  });
});

/* ------------------------------------------------------------------ 6. 17.11 ~10:45: WASD in the site's mine vs our hold */
import { holdSiteMine } from '../src/net/site-mine';
const MINE = siteCopy('mine.js', 'function kwBind()');
describe('mine.js 17.11 ~10:45: W A S D walk the site\'s 2D mine hero (hero kw) — never while the 3D mine holds it', () => {
  /** The site's kw block (KW_FAR … kwBind) run on stubs: a keydown either walks the 2D hero (walkTo → POST /api/mine/go) or not. */
  const run = (held: boolean) => {
    const src = MINE!, a = src.indexOf('const KW_FAR = 260'), b = src.indexOf('}', src.indexOf("window.addEventListener('blur'", a)) + 1;
    const block = src.slice(a, src.indexOf('}', b) + 1);
    const els: any[] = [], ls = new Map<string, ((e: any) => void)[]>();
    const mk = (tag: string) => { const e: any = { tagName: tag, className: '', hidden: false, attrs: {} as Record<string, string>, style: { setProperty() {} }, setAttribute(k: string, v: string) { e.attrs[k] = v; }, remove() { const i = els.indexOf(e); if (i >= 0) els.splice(i, 1); } }; return e; };
    const document: any = {
      documentElement: { classList: { add() {}, remove() {}, contains: () => false } }, head: { appendChild: (e: any) => els.push(e) }, body: { appendChild: (e: any) => els.push(e) },
      getElementById: (id: string) => els.find((e) => e.id === id) ?? null, createElement: mk,
      querySelector: (sel: string) => (/\.mn-board-w/.test(sel) || /data-l3d-mnhold/.test(sel) ? els.find((e) => e.className === 'mn-board-w' || 'data-l3d-mnhold' in e.attrs) ?? null : null),
      addEventListener: (t: string, f: (e: any) => void) => { const x = ls.get(t) || []; x.push(f); ls.set(t, x); },
    };
    if (held) holdSiteMine(true, 'k', document);
    const walks: number[] = [];
    const ctx: any = {
      S: { st: {}, pos: { x: 100, y: 100 }, el: { querySelector: () => null }, path: null, sel: 0 }, X: { hero: () => ({ kw: 1 }) },
      cellOfPt: (x: number, y: number) => Math.floor(x / 20) + Math.floor(y / 20) * 100, walkable: () => true, inZone: () => false, freePt: (p: any) => p,
      leaveRock() {}, walkTo: (c: number) => { walks.push(c); return true; }, document, window: { addEventListener() {} }, Math, Set,
    };
    vm.runInNewContext(block + '\nkwBind();', ctx);
    for (const f of ls.get('keydown') || []) f({ code: 'KeyW', target: null, preventDefault() {}, repeat: false });
    return walks.length;
  };
  it.skipIf(!MINE)('without our hold a W walks the 2D hero; with holdSiteMine\'s hidden .mn-board-w it does not', () => {
    expect(run(false)).toBe(1);
    expect(run(true)).toBe(0);
    const c = (contract as any).checks.find((x: any) => x.id === 'mine.js kwBusy (WASD in the mine)');
    expect(new RegExp(c.re).test(MINE!)).toBe(true);
  });
});
