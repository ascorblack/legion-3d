/**
 * Site update 14.11 afternoon.
 *  - cityshop.js / b-forge.js / b-shop.js / app.js: enchant materials (star / sphere) are NOT sold any more — POST
 *    /api/buymat is gone; buyAsk says «X - не продаётся» + where they are found; `can = !!h && csOn() && c > 0`;
 *    b-shop.js dropped its material tiles. Our 3D card must never send a request the site no longer makes.
 *  - app.js: the announcement ticker (hero `ak`, window.LGAnnTick) holds a new announcement's card while it runs;
 *    short maintenance pauses (live event `pz`: a countdown `.lg-pz-warn`, then `.lg-maint`).
 *  - site-chat.js: the player may reorder the chat tabs (tabsApply re-appends the site's [data-tab] buttons);
 *    site-ui.js keepField puts the focus back into the chat field after a send — unless it went somewhere else.
 *  - live link: chat / pz events over the WebSocket still reach window.__L3D_BUS.
 * The site's own code (newest local copy `.local/site-*`, not in the repo) runs here in node:vm; skipped without it.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import vm from 'node:vm';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { offerOf, coinsFor, buyReq, NOSALE_T, MAT_FIND, type StockItem, type PriceEnv } from '../src/rooms/common/stock';
import { readTicker, readAnns } from '../src/features/announce';
import { pauseWarnText, pauseWarnAt } from '../src/features/sitepause';
import { ChatFocusGuard } from '../src/ui/chatfocus';
import { siteCopy, fnSource } from './site-quest-fns';
import { MEl, makeDoc } from './minidom';
// @ts-ignore — plain ESM script
import { ourApi } from '../scripts/drift.mjs';
import meJson from './fixtures/me.json';
import stockJson from './fixtures/stock.json';

const esc = (s: unknown) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const text = (h: string) => h.replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();

const SHOP = siteCopy('cityshop.js', 'Звёзды и сферы находят в походе');
const BSHOP = siteCopy('b-shop.js', 'cy-matfind');
const APP = siteCopy('app.js', 'window.LGAnnTick = ');
const CHAT = siteCopy('site-chat.js', 'function tabsApply(');
const SUI = siteCopy('site-ui.js', 'function keepField(');
const COPY = (() => {
  const base = resolve(__dirname, '../.local');
  if (!existsSync(base)) return null;
  const d = readdirSync(base).filter((x) => /^site-\d{4}-\d{4}$/.test(x) && existsSync(join(base, x, 'site-live.js'))).sort().reverse()[0];
  return d ? join(base, d) : null;
})();
const LIVE = COPY ? readFileSync(join(COPY, 'site-live.js'), 'utf8') : null;

/* ------------------------------------------------------------------ fakes (rooms need a canvas; the bridge a socket) */
type Fn = (e: any) => void;
class FakeES { url: string; ls = new Map<string, Fn[]>(); readyState = 0; constructor(u: string) { this.url = u; } addEventListener(t: string, f: Fn) { const a = this.ls.get(t) || []; a.push(f); this.ls.set(t, a); } close() { this.readyState = 2; } }
class FakeWS {
  static CONNECTING = 0; static OPEN = 1; static CLOSING = 2; static CLOSED = 3;
  static all: FakeWS[] = [];
  url: string; readyState = 0; sent: string[] = []; ls = new Map<string, Fn[]>();
  onopen: Fn | null = null; onmessage: Fn | null = null; onclose: Fn | null = null; onerror: Fn | null = null;
  constructor(url: string) { this.url = String(url); FakeWS.all.push(this); }
  addEventListener(t: string, fn: Fn) { const a = this.ls.get(t) || []; a.push(fn); this.ls.set(t, a); }
  send(t: string) { this.sent.push(t); }
  close() { if (this.readyState < 2) this.readyState = 2; }
  private fire(t: string, ev: any) { for (const fn of this.ls.get(t) || []) fn(ev); const h = (this as any)['on' + t]; if (h) h(ev); }
  open() { this.readyState = 1; this.fire('open', { type: 'open' }); }
  msg(data: string) { if (this.readyState === 1) this.fire('message', { type: 'message', data }); }
}
const g = globalThis as any;
beforeAll(async () => {
  const ctx = new Proxy({}, {
    get: (_t, k) => {
      if (k === 'getImageData' || k === 'createImageData') return (_x: number, _y?: number, w = 4, h = 4) => ({ data: new Uint8ClampedArray((w || 4) * (h || 4) * 4), width: w, height: h });
      if (k === 'createLinearGradient' || k === 'createRadialGradient' || k === 'createPattern') return () => ({ addColorStop() {} });
      if (k === 'measureText') return () => ({ width: 10 });
      return () => {};
    },
    set: () => true,
  });
  class FakeEl {
    style: Record<string, string> = {}; dataset: Record<string, string> = {}; width = 0; height = 0; innerHTML = ''; textContent = ''; className = '';
    classList = { add() {}, remove() {}, toggle() {}, contains: () => false };
    getContext() { return ctx; }
    attachShadow() { return new FakeEl(); }
    appendChild(c: unknown) { return c; }
    remove() {} focus() {} setAttribute() {} addEventListener() {} removeEventListener() {}
    querySelector() { return new FakeEl(); }
    querySelectorAll() { return []; }
    getBoundingClientRect() { return { left: 0, top: 0, width: 100, height: 100, right: 100, bottom: 100 }; }
  }
  g.document = { createElement: () => new FakeEl(), body: new FakeEl(), pointerLockElement: null, exitPointerLock() {} };
  g.window = Object.assign(g, { addEventListener() {}, removeEventListener() {} });
  g.EventSource = FakeES;
  g.WebSocket = FakeWS;
  await import('../src/bridge/bridge');
});

/* ------------------------------------------------------------------ the site's shop in a sandbox */
if (!Object.getOwnPropertyDescriptor(MEl.prototype, 'dataset')) {
  Object.defineProperty(MEl.prototype, 'dataset', {
    get(this: MEl) {
      const o: Record<string, string> = {};
      for (const [k, v] of this.attrs) if (k.startsWith('data-')) o[k.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = v;
      return o;
    },
  });
}
{
  const d = Object.getOwnPropertyDescriptor(MEl.prototype, 'className');
  if (d && !d.set) Object.defineProperty(MEl.prototype, 'className', { get: d.get, set(this: MEl, v: string) { this.setAttribute('class', String(v)); }, configurable: true });
}
interface SiteEnv { hero: any; foreignK?: number; home?: boolean; town?: string | null }
function siteShop(e: SiteEnv) {
  if (!SHOP) return null;
  const doc = makeDoc() as any; doc.addEventListener = () => {};
  const room = new MEl('div'); doc.body.append(room);
  const acts: { path: string; body: any; msg: string }[] = [];
  const C: any = {
    esc, ART: {}, still: () => '', scopeIds: () => [], npcAs: () => '', ROOM: {}, hwDead: () => false,
    csOn: () => !!(e.hero && e.hero.cs), msOn: () => false, inTown: () => !!e.town, homeHere: () => !!e.home, foreignK: () => e.foreignK || 1,
    streetBg: () => '', bld: () => null, TOWN: { id: e.town || 'fair', meta: null }, D: () => null, rerender: () => {}, S: { room, touch: false },
    X: { hero: () => e.hero, itemName: () => '', money: (n: number) => `${n} м`, login: () => 'player1', doodle: () => '', act: (path: string, body: any, msg: string) => { acts.push({ path, body, msg }); }, api: () => Promise.resolve(null), ench: () => ({ coins: { star: 300, sphere: 900 } }) },
  };
  // the thief mark-up module of the site (LGThief: k / price) as our stock.ts reads it (thK > 1 → ×thK, rounded)
  const k = (h: any) => (h && +h.thK > 1 ? +h.thK : 1);
  const LGThief = { k, price: (h: any, b: number) => Math.round((+b || 0) * k(h)), note: () => '', arm: () => true };
  const win: any = { LGSiteUi: { is: () => false }, LGGameData: { rarityNames: () => ({}), slotNames: () => ({}) }, addEventListener: () => {}, LGCityBuildings: {}, LGThief };
  const ctx: any = { window: win, document: doc, console, Math, String, Number, Object, Array, Set, Map, JSON, Date, setTimeout, clearTimeout, matchMedia: () => ({ matches: false }) };
  win.document = doc;
  vm.createContext(ctx);
  vm.runInContext(SHOP, ctx, { timeout: 5000 });
  const SH = win.LGCityShop(C);
  return {
    SH,
    ask(it: StockItem, b: string) {
      room.childNodes = []; acts.length = 0;
      SH.buyAsk(it, b, null);
      const q = room.querySelector('.cy-buyq');
      const lead = q ? text((q.querySelector('.lead') as MEl).textContent) : '', note = q && q.querySelector('.note') ? text((q.querySelector('.note') as MEl).textContent) : '';
      const yes = (qn = 1) => {
        acts.length = 0; if (!q) return [];
        const plus = q.querySelector('[data-q="1"]') as any;
        for (let i = 1; i < qn; i++) plus && plus.onclick && plus.onclick();
        const y = q.querySelector('[data-yes]') as any; if (y && y.onclick && !y.hasAttribute('disabled')) y.onclick();
        return acts.slice();
      };
      return { lead, note, can: !!(q && q.querySelector('[data-yes]')), sentNow: acts.slice(), yes };
    },
  };
}
const ours = (e: SiteEnv): PriceEnv => ({ hero: e.hero, foreignK: e.foreignK || 1, home: !!e.home, town: e.town || null });
const star = { id: 'enchant_star', name: 'Счастливая звезда', slot: 'material', rarity: 'uncommon', mat: 'star' } as StockItem;
const sphere = { id: 'enchant_sphere', name: 'Сфера сохранения', slot: 'material', rarity: 'rare', mat: 'sphere', out: true } as StockItem;
const sword = { id: 'w_sword', name: 'Меч', slot: 'weapon', rarity: 'rare', coins: 500 } as StockItem;
const potion = { id: 'p_heal', name: 'Зелье', slot: 'potion', rarity: 'common', coins: 40 } as StockItem;

describe('cityshop.js 14.11: enchant materials are not sold, `can = h && cs && c > 0`', () => {
  const rich = { money: 100000, cs: 1, ef: 1 }, thief = { ...rich, thK: 2 }, noCs = { money: 100000, ef: 1 };
  const cases: [string, StockItem, string, SiteEnv, number?][] = [
    ['a star for a hero with cs + ef (was /api/buymat)', star, 'forge', { hero: rich }],
    ['a star for a thief (was /api/buymat {ack: 1})', star, 'forge', { hero: thief }],
    ['a sphere marked out (was «закончились»)', sphere, 'forge', { hero: rich }],
    ['a star without cs (was «за монеты - когда откроется заточка»)', star, 'forge', { hero: noCs }],
    ['a star in a foreign town → the lock comes first', star, 'forge', { hero: rich, town: 'd7', foreignK: 1.5 }],
    ['a star in the squad\'s «край» → not locked, not sold', star, 'forge', { hero: rich, town: 'd9', foreignK: 2, home: true }],
    ['a sword for coins', sword, 'forge', { hero: rich }],
    ['a sword for a thief, foreign town (town id sent)', sword, 'forge', { hero: thief, town: 'd7', foreignK: 1.5 }],
    ['a sword without cs → «сейчас не купить»', sword, 'forge', { hero: noCs }],
    ['no hero → «сейчас не купить»', sword, 'forge', { hero: null }],
    ['potions ×3 with bq', potion, 'shop', { hero: { ...rich, bq: 5 } }, 3],
  ];
  it('our offer: a material is «nosale» with the site\'s words and no request, for every hero', () => {
    for (const h of [rich, thief, noCs, null]) {
      for (const it of [star, sphere]) {
        const o = offerOf(it, 'forge', ours({ hero: h }));
        expect(o).toMatchObject({ kind: 'nosale', can: false, req: null, coins: 0, list: 0, note: MAT_FIND });
        expect(buyReq(o)).toBeNull();
        expect(coinsFor(it, ours({ hero: h }))).toBe(0);
      }
    }
    expect(NOSALE_T).toBe('Не продаётся');
  });
  const S0 = siteShop({ hero: null });
  it.skipIf(!S0).each(cases)('the site copy agrees — %s', (_n, it, b, e, qn) => {
    const S = siteShop(e)!, d = S.ask(it, b), of = offerOf(it, b, ours(e));
    expect(d.sentNow).toEqual([]);           // opening the dialog sends nothing
    expect(of.can).toBe(d.can);
    expect(S.SH.coinsFor(it, e.hero)).toBe(coinsFor(it, ours(e)));
    if (of.kind === 'locked') { expect(d.lead).toMatch(/откроется после захвата/); return; }
    if (of.kind === 'nosale') {
      expect(d.lead).toBe(`«${it.name}» - не продаётся`);
      expect(d.note).toBe(of.note);
      expect(d.yes()).toEqual([]);             // only «Понятно»: nothing is ever sent
      return;
    }
    if (!of.can) { expect(d.lead).toBe(`«${it.name}» — сейчас не купить`); expect(d.note).toBe(of.note); return; }
    expect(d.lead).toBe(`Купить «${it.name}» за ${of.coins} м?`);
    const r = buyReq(of, qn, it.name)!, site = S.ask(it, b).yes(qn);
    expect(site).toEqual(of.why ? [] : [{ path: r.path, body: r.body, msg: r.okText }]);
  });
  it.skipIf(!S0)('shopView: a material\'s price tag is «Не продаётся» (our 3D tag says the same)', () => {
    const S = siteShop({ hero: { money: 1, cs: 1, ef: 1 } })!;
    const v = S.SH.shopView('forge', { stands: [], shelf1: [], shelf2: [], case: [], mats: [star] });
    expect(v.mats[0].priceText).toBe(NOSALE_T);
  });
  it.skipIf(!SHOP || !COPY)('nobody on the site posts /api/buymat any more, and neither do we', () => {
    for (const f of readdirSync(COPY!).filter((x) => x.endsWith('.js'))) expect(readFileSync(join(COPY!, f), 'utf8')).not.toContain('/api/buymat');
    expect([...ourApi()]).not.toContain('/api/buymat');
  });
  it.skipIf(!BSHOP)('b-shop.js 14.11: the shop has no material tiles and no data-buymat buttons', () => {
    expect(BSHOP!).not.toMatch(/data-buymat/);
    expect(BSHOP!).not.toMatch(/enchant_star/);
  });
});

describe('3D shop rooms 14.11: materials are shown «не продаётся» in the forge, gone from the rows; nothing is posted', () => {
  async function build(id: string, hero: any) {
    const { createShopRoom } = await import('../src/rooms/shop');
    const inters: any[] = [], posts: any[] = [], gets: string[] = [];
    const store: any = { hero, me: null, walkers: new Map(), chat: [], online: 1, quest: null, layout: null, on: () => () => {} };
    const actions: any = { get: async (p: string) => { gets.push(p); return null; }, post: async (path: string, body: any) => { posts.push({ path, body }); return { ok: true }; } };
    const env: any = {
      building: { id, title: id, hit: [0, 0, 0, 0], door: { x: 0, y: 0 } }, styleId: 'cats', quality: 1, store, actions,
      input: { setGameplay() {} }, interact: { add: (i: any) => { inters.push(i); return () => {}; }, target: null },
      scene: null, itemModels: null, toast() {}, exit() {}, showSitePanel() {}, hideSitePanel() {}, player: () => ({ x: 0, z: 3 }),
    };
    const room = await createShopRoom(env, { stock: stockJson as any });
    return { room, inters, posts, gets };
  }
  const hero = { ...JSON.parse(JSON.stringify((meJson as any).hero)), money: 100000, ms: null };   // ef + cs, no magic shop
  it('forge: the star / sphere on the counter read «не продаётся», E opens the card only (no /api/me read, no post)', async () => {
    const { room, inters, posts, gets } = await build('forge', hero);
    expect(gets).toEqual([]);   // 13.11 read /api/me (.ench prices) for a hero with ef — gone
    const mats = inters.filter((i) => /^room:good:forge:enchant_/.test(i.id));
    expect(mats.length).toBe(2);
    for (const m of mats) { expect(m.label).toMatch(/^Осмотреть: .+ — не продаётся$/); m.use(); m.alt?.use?.(); }
    expect(posts).toEqual([]);
    room.dispose();
  });
  it('rows: no materials on the counter any more (b-shop.js dropped them), potions stay', async () => {
    const { room, inters } = await build('shop', hero);
    const goods = inters.filter((i) => /^room:good:/.test(i.id)).map((i) => i.id);
    expect(goods.some((x) => /enchant_/.test(x))).toBe(false);
    expect(goods.some((x) => /potion|p_/.test(x))).toBe(true);
    room.dispose();
  });
});

/* ------------------------------------------------------------------ app.js: the announcement ticker, maintenance pauses */
class El {
  className = ''; dataset: Record<string, string> = {}; hidden = false; children: El[] = []; textContent = ''; innerHTML = ''; attrs: Record<string, string> = {};
  style: Record<string, string> = {}; isConnected = true; clientWidth = 400; scrollWidth = 300; fns: (() => void)[] = []; type = ''; title = '';
  get classList() { return { contains: (c: string) => this.className.split(/\s+/).includes(c), toggle: (_c: string, _on?: boolean) => {} }; }
  setAttribute(k: string, v: string) { this.attrs[k] = v; } getAttribute(k: string) { return this.attrs[k] ?? null; }
  append(...c: El[]) { this.children.push(...c); }
  remove() { this.isConnected = false; }
  addEventListener(_t: string, f: () => void) { this.fns.push(f); } click() { for (const f of this.fns) f(); }
  all(): El[] { return this.children.flatMap((c) => [c, ...c.all()]); }
  querySelectorAll(sel: string) { const c = sel.replace(/^\./, ''); return this.all().filter((e) => e.classList.contains(c)); }
  querySelector(sel: string) { return this.querySelectorAll(sel)[0] ?? null; }
  anims: any[] = [];
  animate() { const a: any = { onfinish: null, cancel() {} }; this.anims.push(a); return a; }
  getAnimations() { return []; }
}
function siteAnn(me: any) {
  const box = new El(); box.className = 'gu-an'; box.hidden = true;
  Object.defineProperty(box, 'textContent', { set(v) { if (v === '') this.children = []; }, get() { return ''; } });
  const hud = new El(); hud.append(box);
  const body = new El(), store: Record<string, string> = {};
  const win: any = {};
  const c: any = {
    window: win, GU: { el: hud }, ME: me, guAnnCity: () => true, innerHeight: 800, matchMedia: () => ({ matches: false }),
    localStorage: { getItem: (k: string) => store[k] ?? null, setItem: (k: string, v: string) => { store[k] = v; } },
    document: { createElement: () => new El(), body, querySelector: () => null, hidden: false }, JSON, Array, Set, String, Math, console,
  };
  vm.createContext(c);
  const a = APP!.indexOf('const ANT = {'), b = APP!.indexOf('\n', APP!.indexOf('window.LGAnnTick = '));
  vm.runInContext(["const ANN_LS = 'lgAnnX';", /const annClosed = \(\) => [^\n]*/.exec(APP!)![0], fnSource(APP!, 'annClose'), APP!.slice(a, b), fnSource(APP!, 'guAnn')].join('\n'), c);
  return { win, hud, body, ann: (d: any) => vm.runInContext('annEvent', c)(d), stop: () => { const tk = body.children[0]; for (const x of tk ? tk.all() : []) for (const an of x.anims) an.onfinish?.(); for (const an of tk ? tk.anims : []) an.onfinish?.(); } };
}
describe.skipIf(!APP)('app.js 14.11: the announcement ticker (hero ak) holds the card while it runs — the 3D shows the line', () => {
  it('a new announcement: the site holds its card, LGAnnTick.now() has it; readTicker words it like the ticker', () => {
    const an = [{ id: 7, p: 'p7', t: 'Стрим\nв 20:00' }, { id: 8, p: 'p8', t: 'Старое объявление' }];
    const me: any = { hero: { ak: 1 }, an: [] };
    const S = siteAnn(me);
    S.ann({ an, nw: ['p7'] });
    // the site's HUD shows only the old card; the new one runs in the ticker
    expect(readAnns(S.hud as any).map((a) => a.id)).toEqual(['8']);
    expect(S.win.LGAnnTick.now()).toMatchObject({ p: 'p7', t: 'Стрим\nв 20:00', g: false });
    const tk = readTicker(S.win)!;
    expect(tk).toEqual({ id: 'tk:p7', head: 'Объявление', text: 'Стрим · в 20:00', game: false, tick: true });
    // the ticker on the page says the same words
    const el = S.body.children[0];
    expect(el.className).toBe('ann-tk');
    expect(el.querySelector('.ann-tkh')!.textContent).toBe(tk.head);
    expect(el.querySelector('.ann-tkt')!.textContent).toBe(tk.text);
    // the run ends (animation finished, then the fade): the card comes, the ticker line goes
    S.stop(); S.stop();
    expect(S.win.LGAnnTick.now()).toBeNull();
    expect(readTicker(S.win)).toBeNull();
    expect(readAnns(S.hud as any).map((a) => a.id)).toEqual(['7', '8']);
  });
  it('without hero.ak nothing ticks: the cards come at once', () => {
    const S = siteAnn({ hero: {}, an: [] });
    S.ann({ an: [{ id: 7, p: 'p7', t: 'x', g: true }], nw: ['p7'] });
    expect(readTicker(S.win)).toBeNull();
    expect(readAnns(S.hud as any).map((a) => a.id)).toEqual(['7']);
  });
  it('readTicker survives anything odd', () => {
    expect(readTicker(null)).toBeNull();
    expect(readTicker({ LGAnnTick: { now: () => { throw new Error('x'); } } })).toBeNull();
    expect(readTicker({ LGAnnTick: { now: () => ({ p: 'a', t: '' }) } })).toBeNull();
    expect(readTicker({ LGAnnTick: { now: () => ({ p: 1, t: 'y', g: 1 }) } })).toMatchObject({ head: 'Объявление игры', game: true });
  });
});

describe('maintenance pause 14.11 (live event `pz`)', () => {
  it('our countdown is the site\'s pauseWarn text, gone at warnAt and once the pause is on', () => {
    const now = 1_000_000;
    expect(pauseWarnAt({ on: false, warnAt: now + 30_000 })).toBe(now + 30_000);
    expect(pauseWarnAt({ on: true, warnAt: now + 30_000 })).toBe(0);
    expect(pauseWarnAt(null)).toBe(0);
    expect(pauseWarnText(now + 30_000, now)).toBe('Через 30 с - короткие технические работы (меньше минуты). Ничего не потеряется.');
    expect(pauseWarnText(now - 1, now)).toBe('');
    expect(pauseWarnText(0, now)).toBe('');
  });
  it.skipIf(!APP)('the site copy writes the same line (app.js pauseWarn in node:vm)', () => {
    const els: El[] = [];
    const c: any = { document: { createElement: () => { const e = new El(); els.push(e); return e; }, body: { appendChild: () => {} } }, Date, Math, setTimeout: () => 0 };
    vm.createContext(c);
    vm.runInContext('let warnEl = null;\n' + fnSource(APP!, 'pauseWarn'), c);
    const at = Date.now() + 42_000;
    vm.runInContext('pauseWarn', c)(at);
    expect(els[0].className).toBe('lg-pz-warn');
    expect(els[0].textContent).toBe(pauseWarnText(at, Date.now()));
    expect(APP!).toMatch(/ES\.addEventListener\('pz', \(e\) => \{ try \{ pauseEvent\(JSON\.parse\(e\.data\)\)/);
    // the pause itself is the site's full-screen alertdialog (the 3D yields to it as a site dialog)
    expect(APP!).toMatch(/mtEl\.className = 'lg-maint'; mtEl\.setAttribute\('role', 'alertdialog'\); mtEl\.setAttribute\('aria-modal', 'true'\);/);
  });
});

/* ------------------------------------------------------------------ live link: chat + pz over the WebSocket */
const frame = (e: string, d: unknown) => `{"op":"ev","e":"${e}","d":${JSON.stringify(d)}}`;
describe.skipIf(!LIVE)('the site\'s own site-live.js (newest copy) over the bridge: chat and pz reach __L3D_BUS', () => {
  it('ws: city chat lines and the pause warning reach the bus; the site gets them too; nothing is sent by us', () => {
    const sb: any = { setTimeout, clearTimeout, Math, Date, JSON, Map, String, console };
    sb.self = sb; sb.WebSocket = g.WebSocket; sb.EventSource = g.EventSource;
    vm.runInNewContext(LIVE!, sb);
    const site: Record<string, any[]> = {}, bus: Record<string, any[]> = {};
    const B = g.__L3D_BUS;
    const offs = ['city', 'pz'].map((n) => B.on('sse:' + n, (d: any) => (bus[n] = bus[n] || []).push(d)));
    const n0 = FakeWS.all.length;
    const L = sb.LGLiveLink.open({ ws: () => ({ url: 'wss://example.org/ws', ch: 'chan', sm: false }), sse: () => '/api/live',
      setTimeout: () => 0, clearTimeout: () => {} });
    for (const n of ['city', 'pz']) L.addEventListener(n, (e: any) => (site[n] = site[n] || []).push(JSON.parse(e.data)));
    const s = FakeWS.all[n0];
    expect(s.url).toBe('wss://example.org/ws');
    s.open();
    s.msg('{"op":"hello","user":"u"}');
    s.msg('{"op":"liveok"}');
    s.msg(frame('city', { chat: [{ id: 'c1', l: 'kot', t: 'мяу' }] }));
    s.msg(frame('pz', { on: false, warnAt: 123 }));
    expect(site.city).toEqual([{ chat: [{ id: 'c1', l: 'kot', t: 'мяу' }] }]);
    expect(bus.city).toEqual(site.city);
    expect(site.pz).toEqual([{ on: false, warnAt: 123 }]);
    expect(bus.pz).toEqual(site.pz);
    expect(s.sent.map((x) => JSON.parse(x).op)).toEqual(['live']);   // the site's own handshake only
    L.close(); for (const o of offs) o();
  });
});

/* ------------------------------------------------------------------ site-chat.js tab order, site-ui.js keepField */
describe.skipIf(!CHAT)('site-chat.js 14.11: reorderable tabs — our «⛏ Шахта» stays last', () => {
  it('tabsApply re-appends only the site\'s [data-tab] buttons (pinned «Общий» first); ours is put back at the end', () => {
    const doc = makeDoc();
    const box = new MEl('div'), bar = new MEl('div'); bar.setAttribute('class', 'cy-chat-tabs'); box.append(bar);
    for (const t of ['g', 'tr', 'mn', 'gl', 'dm']) { const b = new MEl('button'); b.setAttribute('data-tab', t); bar.append(b); }
    const mine = new MEl('button'); mine.setAttribute('class', 'l3d-mine-tab'); bar.append(mine);
    // MEl.appendChild moves (removes from the old parent first) like the DOM
    const ap = bar.appendChild.bind(bar);
    bar.appendChild = ((n: MEl) => { const p = n.parentElement; if (p) p.childNodes = p.childNodes.filter((x) => x !== n); return ap(n); }) as any;
    const c: any = { PIN: 'g' }; vm.createContext(c);
    vm.runInContext("const PIN = 'g';\n" + fnSource(CHAT!, 'tabsApply'), c);
    vm.runInContext('tabsApply', c)(box, ['dm', 'tr']);
    const order = () => bar.children.map((b) => b.getAttribute('data-tab') || 'mine');
    expect(order()).toEqual(['mine', 'g', 'dm', 'tr', 'mn', 'gl']);   // the site's reorder leaves ours in front
    // what our dock's tabs observer does (src/ui/chat.ts dockMineAttach)
    if ((bar as any).lastElementChild === undefined) Object.defineProperty(bar, 'lastElementChild', { get: () => bar.children[bar.children.length - 1] });
    if (mine.parentElement === bar && (bar as any).lastElementChild !== mine) bar.appendChild(mine);
    expect(order()).toEqual(['g', 'dm', 'tr', 'mn', 'gl', 'mine']);
    void doc;
  });
});
describe.skipIf(!SUI)('site-ui.js 14.11 keepField: the field gets the focus back after a send only from <body>', () => {
  function keep(active: () => any) {
    const focused: string[] = [];
    const form: any = { querySelector: () => null, contains: (x: any) => x === inp };
    const inp: any = { isConnected: true, disabled: false, focus: () => focused.push('inp') };
    const D: any = { get activeElement() { return active(); }, body: { id: 'body' }, documentElement: { id: 'html' } };
    const c: any = { root: { document: D } }; vm.createContext(c);
    vm.runInContext('const is = () => false;\n' + fnSource(SUI!, 'keepField'), c);
    return { back: vm.runInContext('keepField', c)(form, inp), focused, D, inp };
  }
  it('focus on the game canvas (our chat hands it there after a sent line) → the site leaves it', () => {
    const canvas = { id: 'l3d-host' };
    const k = keep(() => canvas); k.back(true);
    expect(k.focused).toEqual([]);
  });
  it('focus on <body> → the site refocuses the field; the 3D guard undoes that when the game owns the input', () => {
    const k = keep(() => k.D.body); k.back(true);
    expect(k.focused).toEqual(['inp']);
    let t = 0; const guard = new ChatFocusGuard(() => t);
    guard.intent(); t = 5000;                       // the player opened the chat long before the reply came back
    expect(guard.allow(true)).toBe(false);          // src/ui/chat.ts refuse(): blur + focusGame
  });
});
