/**
 * Site update 08.11 (afternoon): every price is in coins.
 *  - cityshop.js: goods of a hero without coin purchases read «сейчас не купить» with their coin price (no more «N баллов
 *    канала, на стриме»); `can` no longer excludes looks; the purchase may carry a quantity `n`.
 *  - b-tent.js: the booth samples are BOUGHT FOR COINS: buyAsk({ id: 'look-<booth>-<id>', name, coins: booth.price, look, pos }).
 *  - city.js: homeOf honours `hm.none`, fairGone → homeAway, homeBack(), NO_CITY, the old fair is «Рябинень», one channel mine.
 *  - quest.js: hero.q2 — «отступаем» moves to the corner block `.q-pbc`, the reserve line «примерное место на схеме».
 * When a downloaded site copy is around (.local/site-*), the site's own cityshop.js + b-tent.js run here (node:vm, a tiny DOM)
 * and the request their «Да» sends is compared with ours (offline fakes: C.X.act only records, nothing is sent).
 */
import { describe, it, expect } from 'vitest';
import vm from 'node:vm';
import { offerOf, sampleOffer, buyReq, lookItem, shopView, type StockItem, type Booth, type BoothSample, type PriceEnv } from '../src/rooms/common/stock';
import { homeAway, homeBack, homePick, campOpen, detectTown, townPriceOf, townsView, NO_CITY, FAIR_NAME, type HeroTownFlags } from '../src/net/town';
import { placeButtons, q2Of, PB_CORNER, type PlaceButton } from '../src/quest/model';
import { cardOf } from '../src/quest';
import { readSite } from '../src/quest/siteui';
import { siteCopy, fnSource } from './site-quest-fns';
import { MEl, makeDoc } from './minidom';

const esc = (s: unknown) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const text = (h: string) => h.replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();

const SHOP = siteCopy('cityshop.js', "id: 'look-'") || siteCopy('cityshop.js', 'Пока не продаётся');
const TENT = siteCopy('b-tent.js', "'look-' + b.key");
const CITY = siteCopy('city.js', 'const homeBack = ');
const QJ = siteCopy('quest.js', 'q2On = ');

/* ------------------------------------------------------------------ the site's shop in a sandbox */

// dataset for the tiny DOM (b-tent.js reads el.dataset.smp, cityshop.js bt.dataset.q)
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
  // className as a setter too (cityshop.js `q.className = 'cy-buyq'`)
  const d = Object.getOwnPropertyDescriptor(MEl.prototype, 'className');
  if (d && !d.set) Object.defineProperty(MEl.prototype, 'className', { get: d.get, set(this: MEl, v: string) { this.setAttribute('class', String(v)); }, configurable: true });
}

interface SiteEnv { hero: any; foreignK?: number; home?: boolean; town?: string | null; stock?: any }
interface SiteShop {
  /** cityshop.js buyAsk → the dialog; `yes(qn)` presses «+» qn-1 times and «Да»: the C.X.act calls it made. */
  ask(it: StockItem, b: string): { lead: string; note: string; can: boolean; yes(qn?: number): { path: string; body: any; msg: string }[] };
  /** b-tent.js: double-click on a booth sample (its `ask`) → buyAsk / wear. */
  tentDbl(st: { booths: Booth[] }, pos: string): { lead: string; note: string; acts: { path: string; body: any; msg: string }[]; yes(): { path: string; body: any; msg: string }[] };
}
function siteShop(e: SiteEnv): SiteShop | null {
  if (!SHOP || !TENT) return null;
  const doc = makeDoc() as any;
  doc.addEventListener = () => {};
  const room = new MEl('div'); doc.body.append(room);
  const acts: { path: string; body: any; msg: string }[] = [];
  const C: any = {
    esc, ART: {}, still: () => '', scopeIds: () => [], npcAs: () => '', ROOM: {},
    hwDead: () => false, csOn: () => !!(e.hero && e.hero.cs), msOn: () => false, inTown: () => !!e.town, homeHere: () => !!e.home,
    foreignK: () => e.foreignK || 1, streetBg: () => '', bld: (id: string) => BLD[id],
    TOWN: { id: e.town || 'fair', meta: null }, D: () => null, rerender: () => {},
    S: { room, touch: false },
    X: {
      hero: () => e.hero, itemName: () => '', money: (n: number) => `${n} м`, login: () => 'player1', doodle: () => '',
      act: (path: string, body: any, msg: string) => { acts.push({ path, body, msg }); }, api: () => Promise.resolve(e.stock || null), ench: () => null,
    },
  };
  const win: any = { LGSiteUi: { is: () => false }, LGGameData: { rarityNames: () => ({}), slotNames: () => ({}) }, addEventListener: () => {}, LGCityBuildings: {} };
  const ctx: any = { window: win, document: doc, console, Math, String, Number, Object, Array, Set, Map, JSON, Date, setTimeout, clearTimeout, matchMedia: () => ({ matches: false }) };
  win.document = doc;
  vm.createContext(ctx);
  vm.runInContext(SHOP, ctx, { timeout: 5000 });
  vm.runInContext(TENT, ctx, { timeout: 5000 });
  const SH = win.LGCityShop(C);
  const BLD: Record<string, any> = { tent: win.LGCityBuildings.tent(C, SH) };
  const dialog = () => {
    const q = room.querySelector('.cy-buyq');
    return { q, lead: q ? text((q.querySelector('.lead') as MEl).textContent) : '', note: q && q.querySelector('.note') ? text((q.querySelector('.note') as MEl).textContent) : '' };
  };
  const yes = (q: MEl | null, qn = 1) => {
    acts.length = 0;
    if (!q) return [];
    const plus = q.querySelector('[data-q="1"]') as any;
    for (let i = 1; i < qn; i++) plus && plus.onclick && plus.onclick();
    const y = q.querySelector('[data-yes]') as any;
    if (y && y.onclick && !y.hasAttribute('disabled')) y.onclick();
    return acts.slice();
  };
  return {
    ask(it, b) {
      room.childNodes = [];
      SH.buyAsk(it, b, null);
      const d = dialog();
      return { lead: d.lead, note: d.note, can: !!(d.q && d.q.querySelector('[data-yes]')), yes: (qn?: number) => yes(d.q, qn) };
    },
    tentDbl(st, pos) {
      room.childNodes = []; acts.length = 0;
      const inn = new MEl('div'); room.append(inn);
      const P: Record<string, { x: number; y: number }> = {};
      for (const b of st.booths) for (const s of b.samples || []) P[s.pos] = { x: 100, y: 100 };
      BLD.tent.hots(inn, st, P);
      const el = inn.querySelector(`[data-smp="${pos}"]`) as MEl;
      el.dispatchEvent({ type: 'dblclick', bubbles: true });
      const d = dialog(), first = acts.slice();
      return { lead: d.lead, note: d.note, acts: first, yes: () => yes(d.q) };
    },
  };
}
/** Our env for the same situation. */
const ours = (e: SiteEnv): PriceEnv => ({ hero: e.hero, foreignK: e.foreignK || 1, home: !!e.home, town: e.town || null });
const reqOf = (it: StockItem, b: string, e: SiteEnv, qn = 1) => {
  const of = offerOf(it, b, ours(e)), r = buyReq(of, qn, it.name);
  return r ? [{ path: r.path, body: r.body, msg: r.okText }] : [];
};

const sword = { id: 'w_sword', name: 'Меч', slot: 'weapon', rarity: 'rare', coins: 500, price: 400 } as StockItem;
const epic = { id: 'w_epic', name: 'Клинок', slot: 'weapon', rarity: 'epic', coins: 2000, price: 3000 } as StockItem;
const potion = { id: 'p_heal', name: 'Зелье', slot: 'potion', rarity: 'common', coins: 40 } as StockItem;
const nocoin = { id: 'w_old', name: 'Старый меч', slot: 'weapon', rarity: 'common', price: 100 } as StockItem;
const booth: Booth = { key: 'hat', title: 'Шапки', price: 3000, samples: [{ id: '#crown', name: 'Корона', pos: 'h1', n: 1 }, { id: 'cap', name: 'Кепка', pos: 'h2', n: 2 }] } as unknown as Booth;
const blush: Booth = { key: 'blush', title: 'Румянец', price: 800, samples: [{ id: 'blush1', name: 'Румянец', pos: 'b1', n: 1, look: { blush: true } }] } as unknown as Booth;

describe('cityshop.js 08.11: coins only — the same price, «Купить» exactly when the site can, the same request', () => {
  const heroCs = { money: 100000, cs: 1 }, heroNo = { money: 100000 }, poor = { money: 10, cs: 1 };
  const cases: [string, StockItem, string, SiteEnv, number?][] = [
    ['coins, own city', sword, 'forge', { hero: heroCs }],
    ['coins, a district town (town id sent)', sword, 'forge', { hero: heroCs, town: 'd7', foreignK: 1 }],
    ['foreign town ×1.5', sword, 'forge', { hero: heroCs, town: 'd7', foreignK: 1.5 }],
    ['the squad\'s «край» ×2: dearer, an epic is not locked', epic, 'forge', { hero: heroCs, town: 'd9', foreignK: 2, home: true }],
    ['foreign town: an epic is locked', epic, 'forge', { hero: heroCs, town: 'd7', foreignK: 2 }],
    ['not enough coins → «Да» disabled', sword, 'forge', { hero: poor }],
    ['a ghost → «Да» disabled', sword, 'forge', { hero: { ...heroCs, ghost: true } }],
    ['no coin purchases (no cs) → «сейчас не купить»', sword, 'forge', { hero: heroNo }],
    ['no coin price → «сейчас не купить»', nocoin, 'forge', { hero: heroCs }],
    ['potions ×3 with hero.bq (n: 3)', potion, 'shop', { hero: { ...heroCs, bq: 5 } }, 3],
  ];
  it('our offer (fixtures, no site copy needed)', () => {
    expect(offerOf(sword, 'forge', ours({ hero: heroNo }))).toMatchObject({ kind: 'closed', can: false, list: 500, req: null, note: 'Покупки в «Городе» тебе пока закрыты.' });
    expect(offerOf(nocoin, 'forge', ours({ hero: heroCs }))).toMatchObject({ kind: 'closed', list: 0 });
    expect(reqOf(potion, 'shop', { hero: { ...heroCs, bq: 5 } }, 3)[0].body).toEqual({ item: 'p_heal', price: 40, n: 3 });
    expect(reqOf(potion, 'shop', { hero: { ...heroCs, bq: 5 } }, 9)[0].body).toEqual({ item: 'p_heal', price: 40, n: 5 });   // capped at qmax
    expect(reqOf(sword, 'forge', { hero: heroCs, town: 'd7', foreignK: 1.5 })[0].body).toEqual({ item: 'w_sword', price: 750, town: 'd7' });
    expect(offerOf(epic, 'forge', ours({ hero: heroCs, town: 'd9', foreignK: 2, home: true }))).toMatchObject({ kind: 'coins', coins: 4000, home: true });
  });
  const S0 = siteShop({ hero: null });
  it.skipIf(!S0).each(cases)('the site copy agrees — %s', (_n, it, b, e, qn) => {
    const S = siteShop(e)!, d = S.ask(it, b), of = offerOf(it, b, ours(e));
    // «Купить» offered exactly when the site shows «Да» (enabled or not)
    expect(of.can).toBe(d.can);
    if (of.kind === 'locked') { expect(d.lead).toMatch(/откроется после захвата/); return; }
    if (!of.can) { expect(d.lead).toBe(`«${it.name}» — сейчас не купить`); expect(d.note).toBe(of.note); return; }
    expect(d.lead).toBe(`Купить «${it.name}» за ${of.coins} м?`);
    // the same request (path, body, toast) — nothing when «Да» is disabled
    const site = S.ask(it, b).yes(qn);
    expect(site.length).toBe(of.why ? 0 : 1);
    expect(of.why ? [] : reqOf(it, b, e, qn)).toEqual(site);
  });
});

describe('b-tent.js 08.11: booth samples are bought for coins (look-<booth>-<id>)', () => {
  const heroCs = { money: 100000, cs: 1, wardrobe: { cur: {}, own: {} } };
  it('our good: id without the «#», the booth\'s price, look + pos', () => {
    const s = booth.samples![0] as BoothSample;
    expect(lookItem(booth, s)).toMatchObject({ id: 'look-hat-crown', name: 'Корона', coins: 3000, look: true, pos: 'h1' });
    const of = sampleOffer(heroCs as any, booth, s, ours({ hero: heroCs }));
    expect(of).toMatchObject({ kind: 'coins', coins: 3000, can: true });
    expect(of.req).toEqual({ path: '/api/cityBuy', body: { item: 'look-hat-crown', price: 3000 } });
    expect(sampleOffer({ money: 1 } as any, booth, s).kind).toBe('closed');
    const own = { ...heroCs, wardrobe: { cur: {}, own: { hat: ['#crown'] } } };
    expect(sampleOffer(own as any, booth, s).req).toEqual({ path: '/api/wear', body: { field: 'hat', value: '#crown' } });
  });
  const S0 = siteShop({ hero: null });
  const cases: [string, Booth, string, SiteEnv][] = [
    ['buy a hat (id with #)', booth, 'h1', { hero: heroCs }],
    ['buy a cap', booth, 'h2', { hero: heroCs }],
    ['in a foreign town ×1.5 (town id sent)', booth, 'h2', { hero: heroCs, town: 'd7', foreignK: 1.5 }],
    ['blush', blush, 'b1', { hero: heroCs }],
    ['not enough coins', booth, 'h1', { hero: { ...heroCs, money: 5 } }],
    ['no coin purchases', booth, 'h1', { hero: { money: 100000, wardrobe: { cur: {}, own: {} } } }],
    ['owned → wear', booth, 'h1', { hero: { ...heroCs, wardrobe: { cur: {}, own: { hat: ['#crown'] } } } }],
    ['owned blush → wear true', blush, 'b1', { hero: { ...heroCs, wardrobe: { cur: {}, own: { blush: ['true'] } } } }],
  ];
  it.skipIf(!S0).each(cases)('the site copy sends the same — %s', (_n, b, pos, e) => {
    const S = siteShop(e)!, s = b.samples!.find((x) => x.pos === pos)! as BoothSample;
    const of = sampleOffer(e.hero, b, s, ours(e)), d = S.tentDbl({ booths: [b] }, pos);
    if (of.kind === 'wear') { expect(d.acts).toEqual([{ path: of.req!.path, body: of.req!.body, msg: 'Надето' }]); return; }
    expect(d.acts).toEqual([]);
    if (!of.can) { expect(d.lead).toBe(`«${s.name}» — сейчас не купить`); return; }
    expect(d.lead).toBe(`Купить «${s.name}» за ${of.coins} м?`);
    const r = buyReq(of, 1, s.name)!;
    const sent = d.yes();
    expect(sent.length).toBe(of.why ? 0 : 1);
    expect(sent).toEqual(of.why ? [] : [{ path: r.path, body: r.body, msg: r.okText }]);
  });
});

describe('cityshop.js shopView: a lv3 district town sells by its building levels', () => {
  const st = { stands: [{ key: 'a', top: [sword, epic], mid: [], case: [] }], shelf1: [sword], mats: [{ id: 'mat_star', name: 'Звезда', mat: 'star' } as StockItem] } as any;
  it('filters goods (materials stay), only for a hero with coin purchases', () => {
    const keep = (it: StockItem) => it.rarity !== 'epic';
    const v = shopView(st, 'forge', { cs: 1 } as any, keep);
    expect(v.stands[0].top.map((x: StockItem) => x.id)).toEqual(['w_sword']);
    expect(v.mats.length).toBe(1);
    expect(shopView(st, 'forge', {} as any, keep)).toBe(st);
    expect(shopView(st, 'forge', { cs: 1 } as any, null)).toBe(st);
  });
});

/* ------------------------------------------------------------------ city.js home */

function siteHome(): ((hero: any) => { homePick: string | null; homeAway: boolean; homeBack: string | null; cpOn: boolean }) | null {
  if (!CITY) return null;
  const line = (re: RegExp) => { const m = re.exec(CITY); return m ? m[0] : null; };
  const parts = [
    line(/const cpOn = [^\n]*/), line(/const homeOf = [^\n]*/), line(/function homePick\(hm\) [^\n]*/), line(/const homeAway = [^\n]*/), line(/const homeBack = [^\n]*/),
  ];
  if (parts.some((p) => !p)) return null;
  const ctx: any = { X: null, CAMP: 'camp' };
  vm.createContext(ctx);
  vm.runInContext(`${parts.join('\n')}\nglobalThis.__f = { homePick, homeAway, homeBack, cpOn };`, ctx, { timeout: 5000 });
  return (hero) => {
    ctx.X = { hero: () => hero };
    const f = ctx.__f; const hp = f.homePick(hero && hero.hm);
    return { homePick: hp ? hp.id : null, homeAway: f.homeAway(), homeBack: f.homeBack(), cpOn: f.cpOn() };
  };
}
describe('city.js 08.11: hm.none, homeAway, homeBack, NO_CITY', () => {
  const heroes: [string, HeroTownFlags & Record<string, unknown>][] = [
    ['no hm', { tw: 1 }],
    ['home district', { tw: 1, hm: { id: 'd3' } }],
    ['home district, but none (no city yet)', { tw: 1, hm: { id: 'd3', none: 1 } }],
    ['camp (Prologue)', { cp: 1, hm: { id: 'camp' } }],
    ['camp flag', { hm: { id: 'fair', camp: 1 } }],
    ['camp, none', { cp: 1, hm: { id: 'camp', none: 1 } }],
    ['fair', { hm: { id: 'fair' } }],
  ];
  it('ours (fixtures)', () => {
    expect(homePick({ hm: { id: 'd3', none: 1 } })).toBeNull();
    expect(homeAway({ hm: { id: 'd3', none: 1 } })).toBe(false);
    expect(homeBack({ hm: { id: 'd3' } })).toBe('d3');
    expect(homeBack({ cp: 1, hm: { id: 'camp' } })).toBe('camp');
    expect(homeBack({ hm: { id: 'd3', none: 1 } })).toBeNull();
    expect(NO_CITY).toMatch(/^У канала пока нет своего города/);
  });
  it('detectTown never builds a town of hm.none (no City DOM → the fair)', () => {
    expect(detectTown({ hero: { tw: 1, hm: { id: 'd3', none: 1 } } }).id).toBe('fair');
    expect(detectTown({ hero: { tw: 1, hm: { id: 'd3' } } }).id).toBe('d3');
    expect(detectTown({ hero: { cp: 1, hm: { id: 'camp', none: 1 } } }).id).toBe('fair');
  });
  const H = siteHome();
  it.skipIf(!H).each(heroes)('the site copy agrees — %s', (_n, h) => {
    expect({ homePick: homePick(h), homeAway: homeAway(h), homeBack: homeBack(h), cpOn: campOpen(h) }).toEqual(H!(h));
  });
  it.skipIf(!CITY)('NO_CITY is the site\'s text', () => {
    expect(CITY!).toContain(`const NO_CITY = '${NO_CITY}'`);
  });
  it('town prices: city.js TOWN.acc → foreignK / homeHere', () => {
    expect(townPriceOf({ own: true, k: 1 })).toEqual({ foreignK: 1, home: false });
    expect(townPriceOf({ own: false, k: 1.5 })).toEqual({ foreignK: 1.5, home: false });
    expect(townPriceOf({ own: false })).toEqual({ foreignK: 2, home: false });
    expect(townPriceOf({ own: true, home: true, k: 2 })).toEqual({ foreignK: 2, home: true });
    expect(townPriceOf(null)).toEqual({ foreignK: 1, home: false });
  });
  it('the town picker: «Рябинень» by T.fair / T.fw, a town being built is listed but closed', () => {
    const v = townsView({ resp: { ok: true, fair: true, fw: 'owned', list: [{ id: 'd5', town: 'Стройка', danger: 2, build: true, home: true }] }, hero: { tw: 1 }, current: 'fair', style: 'cats' });
    expect(v.rows[0]).toMatchObject({ id: 'fair', name: FAIR_NAME, sub: '★ · «Ярмарочный Край» · округ канала', disabled: false });
    expect(v.rows[1]).toMatchObject({ id: 'd5', icon: '🏗', disabled: true, sub: '★★ · ещё строится · город канала' });
    expect(townsView({ resp: { ok: true, fair: false, list: [] }, hero: { tw: 1 }, current: 'fair', style: 'cats' }).rows[0].disabled).toBe(true);
  });
});

/* ------------------------------------------------------------------ quest.js q2 */

const constSrc = (src: string, name: string): string | null => {
  const at = src.indexOf(`const ${name} =`); if (at < 0) return null;
  const end = src.indexOf('\n', at); return src.slice(at, end < 0 ? undefined : end);
};
function sitePb(): ((v: unknown, role: string, q2: boolean) => string) | null {
  if (!QJ) return null;
  const parts = ['meIn', 'deadIn', 'pbWarn', 'pbTip', 'pbHtml'].map((n) => fnSource(QJ, n));
  const consts = ['GROUPS', 'PB_ATK'].map((n) => constSrc(QJ, n));
  if (parts.some((p) => !p) || consts.some((c) => !c)) return null;
  const ctx: Record<string, unknown> = { esc, qaOn: () => true, lineSt: () => '', PBA: { k: '', at: 0 }, Date, Set, String, Math, X: null, q2On: () => false };
  vm.createContext(ctx);
  vm.runInContext(`${consts.join('\n')}\n${parts.join('\n')}\nglobalThis.__f = pbHtml;`, ctx, { timeout: 5000 });
  return (v, role, q2) => { ctx.q2On = () => q2; ctx.X = { say: () => {}, login: () => 'player1', hero: () => ({ role, money: 100, q2 }), moneyText: (n: number) => `${n} м` }; return (ctx.__f as (v: unknown) => string)(v); };
}
const PB: PlaceButton[] = [
  { t: 'удар', l: '⚔ удар', c: 'main', g: 'act', x: { k: 'cls', role: 'legionary' } },
  { t: 'прикрыть', l: '🤝 прикрыть', g: 'tg' },
  { t: 'отступаем', l: '↩ отступаем', c: 'warn', g: 'esc' },
  { t: 'бежать', l: '🏃 Бежать', c: 'warn', g: 'esc', x: { k: 'flee' } },
];
const battle = (b: Record<string, unknown> = {}): any => ({ on: true, k: 'battle', t: 'Лес', party: 'in', n: 3,
  b: { id: 9, round: 1, maxR: 5, st: 'party', until: 1, hp: 0.9, me: 0, form: [['player1', 'legionary', 'R']], foes: [['R', 'wolf', 0, 1]], ...b }, pb: { b: PB } });

describe('quest.js 08.11 (hero.q2): «отступаем» in the corner, the reserve line', () => {
  it('ours: without q2 the groups as before; with q2 «отступаем» last, out of «Уйти из боя»', () => {
    expect(q2Of({ q2: 1 })).toBe(true); expect(q2Of(null)).toBe(false);
    expect(placeButtons(battle(), 'legionary').map((x) => x.t)).toEqual(['прикрыть', 'удар', 'отступаем', 'бежать']);
    expect(placeButtons(battle(), 'legionary', true).map((x) => x.t)).toEqual(['прикрыть', 'удар', 'бежать', PB_CORNER]);
  });
  it('the HUD card: reserve → «примерное место на схеме» with q2', () => {
    const v = battle({ me: -1 });
    const c = cardOf(v, { login: 'player1', role: 'legionary', q2: true }, () => 'удар');
    const c0 = cardOf(v, { login: 'player1', role: 'legionary' }, () => 'удар');
    expect(JSON.stringify(c)).toContain('ты в бою, но вне кадра стрима - примерное место на схеме');
    expect(JSON.stringify(c0)).not.toContain('примерное место');
  });
  const P = sitePb();
  it.skipIf(!P).each([[false], [true]])('the site copy: the same buttons in the same order, the corner as its own group (q2 = %s)', (q2) => {
    const tab = new MEl('section'); tab.setAttribute('id', 'tab-quest');
    tab.innerHTML = `<div class="q-wrap">${P!(battle(), 'legionary', q2)}</div>`;
    const S = readSite(tab as unknown as Element);
    expect(S.groups.flatMap((g) => g.btns.map((b) => b.key))).toEqual(placeButtons(battle(), 'legionary', q2).map((x) => 'qpb:' + x.t));
    if (q2) expect(S.groups[S.groups.length - 1]).toMatchObject({ title: 'Уйти из боя', btns: [{ key: 'qpb:' + PB_CORNER }] });
  });
});
