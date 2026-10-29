/**
 * Offline demo of the whole game without the site: a fake SiteSession built from sanitized fixtures.
 * Bots wander the city on the real walk grid and chat now and then. Open dist-dev/game.html.
 */
import type { Actions, ApiResult, ChatMsg, Hero, Walker } from '../src/contracts';
import type { SiteSession } from '../src/contracts/modules';
import { createStore } from '../src/store/store';
import { appearanceFrom } from '../src/avatar';
import { startGame } from '../src/content/game';
import { fixtureLayout, campFixtureLayout, villageFixtureLayout } from './fixtures';
import { SX, SZ } from '../src/world/coords';
import me from '../test/fixtures/me.json';
import session from '../test/fixtures/city-session.json';
import stock from '../test/fixtures/stock.json';
import { FakeMine, makeBus } from '../src/rooms/mine/fake';
import mineEnter from '../test/fixtures/mine-enter.json';
import { FakeQuest } from '../src/quest/fake';
import { npcPlaces, npcBlocks } from '../src/events/halloween/hwnpc';
import { MineClient } from '../src/rooms/mine/net';
import { createMineRoom } from '../src/rooms/mine';
import type { DemoData } from '../src/debug/places';
import { QUEST_MOCKS } from '../src/debug/questMocks';

// ?town=camp: the start camp «Перепутье» (test/fixtures/camp-map.json); ?town=village: a hand-made village ★1
// (test/fixtures/village-map.json); otherwise the fair
const TOWN = new URLSearchParams(location.search).get('town');
const layout = TOWN === 'camp' ? campFixtureLayout() : TOWN === 'village' ? villageFixtureLayout() : fixtureLayout();
// ?sky=dusk: an evening sky for photos (the site's own style sky otherwise)
if (new URLSearchParams(location.search).get('sky') === 'dusk') layout.sky = 'linear-gradient(#1b1640 0%, #3e2f6e 38%, #9a5a86 72%, #f0a070 100%)';
const SPAWN: [number, number] = (layout as any).spawn || [layout.QW + 660, 1010];
const store = createStore();
const hero = structuredClone((me as any).hero) as Hero;
// ?hwc=look|portal|lp: the site's «Ночь Тыквенной Луны» (hero.hwc); live: __demo.hwc('lp' | 'look' | 'portal' | 'off')
const hwcOf = (v: string | null) => (v === 'look' ? { look: true, portal: false } : v === 'portal' ? { look: true, portal: true, at: Date.now() } : v === 'lp' ? { look: true, portal: true, at: Date.now() } : v === 'p' ? { look: false, portal: true } : null);
{ const v = new URLSearchParams(location.search).get('hwc'); if (v) (hero as any).hwc = hwcOf(v); }
// Halloween NPCs (site hwnpc.js): battle-pass level ?hwlv=0…20 (default 7; live __demo.hwlv(n)), candies; the walk grid
// gets their obstacles while the look is on (as src/net/site.ts does with the site's make({ hwObst }))
(hero as any).hw = { c: 42, p: Math.max(0, Math.min(20, +(new URLSearchParams(location.search).get('hwlv') ?? 7) || 0)), x: 0 };
if (layout.id === 'fair') { const free0 = layout.free, NPCS = npcPlaces({}); layout.free = (x, y) => free0(x, y) && !((hero as any).hwc?.look && npcBlocks(NPCS, x, y)); }
store.setHero(hero);
// ?style=cherts|legion|monkeys…: the channel's art style (live: MDDoodle.active) — looks, camp theme, shop interiors
const STYLE = new URLSearchParams(location.search).get('style') || 'cats';
layout.styleId = STYLE;
store.setLayout(layout);
const heroRaw = (h: Hero) => ({ ...h, n: h.name, lv: h.level, lk: (h as any).wardrobe?.cur || h.look, g: h.gear });
store.setMe({ login: hero.login, app: appearanceFrom(hero.login, heroRaw(hero), STYLE), x: SPAWN[0], y: SPAWN[1], face: 0, speed: 0, alpha: 1, me: true });

/* ---- bots ---- */
const LINES = ['привет всем!', 'кто в шахту?', 'продам кирку недорого', 'где тренер?', 'ура, новый уровень!', 'го в поход вечером', 'сколько стоит колпак?', 'всем добрый вечер', 'у кого есть лишняя килька?', 'кузнец опять сломал мне меч :(', 'красивый шатёр', 'мяу'];
interface Bot extends Walker { path: [number, number][] | null; wait: number }
const bots: Bot[] = [];
const raw = (session as any).enter.a as any[];
const N = +(new URLSearchParams(location.search).get('bots') || 24);
for (let i = 0; i < N; i++) {
  const r = raw[i % raw.length];
  const login = `bot${i + 1}`;
  const [x, y] = layout.nearest(layout.QW + 200 + Math.random() * Math.min(2600, layout.W - layout.QW - 400), 850 + Math.random() * Math.min(600, layout.area.y1 - 860));
  const b: Bot = { login, app: appearanceFrom(login, { ...r, l: login, n: `Котик${i + 1}` }, STYLE), x, y, face: Math.random() * 6.28, speed: 0, alpha: 1, path: null, wait: Math.random() * 3 };
  bots.push(b); store.upsertWalker(b);
}
store.setOnline(N + 1);
const pathTo = (b: Bot) => {
  const [tx, ty] = layout.nearest(b.x + (Math.random() - 0.5) * 1400, b.y + (Math.random() - 0.5) * 500);
  b.path = layout.path ? layout.path([b.x, b.y], [tx, ty]).slice(1) : [[tx, ty]];
};
let chatN = 0;
setInterval(() => {
  const b = bots[(Math.random() * bots.length) | 0]; if (!b) return;   // ?bots=0
  const m: ChatMsg = { id: 'c' + ++chatN, login: b.login, name: b.app.name, text: LINES[(Math.random() * LINES.length) | 0], at: Date.now(), kind: 'g' };
  store.pushChat([m]);
  b.bubble = { text: m.text, until: Date.now() + 4000 + m.text.length * 50, id: m.id };
}, 3500);

/* ---- fake actions: equip/unequip locally ---- */
const ok = (h?: Hero): ApiResult => ({ ok: true, hero: h });
const refreshMe = () => { const m = store.me!; m.app = appearanceFrom(hero.login, heroRaw(hero), STYLE); store.setHero(structuredClone(hero)); store.emit('walkers'); };
const gearOf = () => {
  const on = (s: string) => hero.items.find((x) => x.on && x.slot === s);
  const g: any = {}; const w = on('weapon'), s = on('shield'), a = on('armor'), h = on('helmet'), t = on('trinket');
  if (w?.look?.weapon) { g.w = w.look.weapon; g.wr = w.rarity; }
  if (s?.look?.shield) { g.s = s.look.shield; g.sr = s.rarity; }
  if (a) { g.a = a.look?.armor || 'lorica'; g.ar = a.rarity; g.am = a.gear || 'light'; }
  if (h?.look?.hat) { g.h = h.look.hat; g.hr = h.rarity; }
  if (t) { g.t = 'plain'; g.tr = t.rarity; }
  hero.gear = g;
};
const actions: Actions = {
  async equip(uid) { const it = hero.items.find((x) => x.uid === uid); if (!it) return { ok: false, error: 'нет вещи' }; for (const x of hero.items) if (x.slot === it.slot) x.on = false; it.on = true; gearOf(); await sleep(250); refreshMe(); return ok(hero); },
  async unequip(slot) { for (const x of hero.items) if (x.slot === slot) x.on = false; gearOf(); await sleep(250); refreshMe(); return ok(hero); },
  async use(uid) { hero.items = hero.items.filter((x) => x.uid !== uid); await sleep(200); refreshMe(); return ok(hero); },
  async wear() { return { ok: false, error: 'в демо облик не меняется' }; },
  async say(text) { const m: ChatMsg = { id: 'me' + ++chatN, login: hero.login, name: hero.name, text, at: Date.now(), kind: 'g' }; store.pushChat([m]); store.me!.bubble = { text, until: Date.now() + 6000, id: m.id }; return { ok: true }; },
  async get(p: string) { if (p.startsWith('/api/city/stock')) return structuredClone(stock) as any; if (p.startsWith('/api/journal')) return { ok: true, list: [{ id: '1', at: Date.now() - 6e5, k: 'coins', t: 'Шахта: сдал руду скупщику', c: 12, r: 'win' }] } as any; return { ok: false, error: 'демо' } as any; },
  async post() { return { ok: false, error: 'демо' } as any; },
  openBuilding(id) { toastDemo(`Здесь откроется здание сайта: ${id}`); },
  openSitePanel(t) { toastDemo(`Здесь откроется раздел сайта: ${t}`); },
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/* ---- the 3D mine: an offline fake of the game's mine endpoints (src/rooms/mine/fake.ts), started on first use ---- */
const mineBus = makeBus();
(window as any).__L3D_BUS = mineBus;   // the mine client listens to 'sse:mine' / 'sse:me' (live: src/bridge)
mineBus.on('sse:me', () => { store.setHero(structuredClone(hero)); });
let fakeMine: FakeMine | null = null;
const mine = () => fakeMine || (fakeMine = new FakeMine({ login: String(hero.login).toLowerCase(), enter: structuredClone(mineEnter) as any, hero: hero as any, bus: mineBus, digSec: 8 }));
const isMine = (p: string) => /^\/api\/(mine\/|mine[A-Z])/.test(p);
actions.get = ((g) => (p: string) => (isMine(p) ? mine().api(p) : g(p)))(actions.get) as Actions['get'];
actions.post = ((g) => (p: string, b?: unknown) => (isMine(p) ? mine().api(p, b) : g(p, b)))(actions.post) as Actions['post'];
let toastDemo = (t: string) => console.log(t);

/* ---- «Путешествие» (L): offline stand-ins for the site's town picker and streamer search ---- */
// /api/city/towns, /api/mylist, /api/find and LGCity.town(id) — enough for the travel page and a real world swap (camp ⇄ fair ⇄ a town)
{
  (hero as any).cp ??= 1; (hero as any).tw ??= 1;
  const TOWNS = { ok: true, quest: false, list: [
    { id: 'd3', town: 'Медовая Падь', biome: 'meadow', danger: 1, kind: 'village', own: true, k: 1, why: 'owned' },
    { id: 'd7', town: 'Сосновый Брод', biome: 'taiga', danger: 2, kind: 'town', own: false, k: 1.5 },
    { id: 'd12', town: 'Ледяная Гавань', biome: 'ice', danger: 3, kind: 'capital', own: false, home: true, k: 2, why: 'party' },
  ] };
  const MY = { ok: true, list: [
    { login: 'mur_cat', name: 'Мур_Кот', live: true, pinned: true, hero: true },
    { login: 'rybka_tv', name: 'Рыбка ТВ', live: false, pinned: false, hero: true },
    { login: 'seryi_hvost', name: 'Серый Хвост', live: false, pinned: false, hero: false },
  ] };
  const FIND = [{ login: 'pushok_live', name: 'Пушок', live: true }, { login: 'pushistaya_gavan', name: 'Пушистая Гавань', live: false }, { login: 'tikhiy_kot', name: 'Тихий кот', live: true }, { login: 'mur_cat', name: 'Мур_Кот', live: true }];
  const q0 = actions.get;
  actions.get = ((p: string) => (p === '/api/city/towns' ? Promise.resolve(structuredClone(TOWNS)) : p === '/api/mylist' ? Promise.resolve(structuredClone(MY)) : q0(p))) as Actions['get'];
  const f0 = window.fetch.bind(window);
  window.fetch = ((u: any, i?: any) => {
    const m = /\/api\/find\?q=(.*)$/.exec(String(u?.url || u));
    if (!m) return f0(u, i);
    const q = decodeURIComponent(m[1]).toLowerCase();
    return new Promise((ok) => setTimeout(() => ok(new Response(JSON.stringify({ ok: true, list: FIND.filter((c) => c.login.includes(q) || c.name.toLowerCase().includes(q)) }), { status: 200 })), 250));
  }) as typeof fetch;
  (window as any).__travelLog = [] as string[];
  (window as any).LGCity = {
    debug: () => ({}),
    town: (id: string) => {   // the site rebuilds the City asynchronously; the 3D world follows the new layout
      (window as any).__travelLog.push('town:' + id);
      setTimeout(() => {
        const L = id === 'camp' ? campFixtureLayout() : { ...fixtureLayout(), id };
        store.setLayout(L as any);
      }, 700);
    },
  };
}

/* ---- expedition (dev toggle): ?quest=1 feeds the offline FakeQuest into store.quest (?quest=2 = double speed); Q opens it in 3D ---- */
const QS = new URLSearchParams(location.search).get('quest'); if (QS) new FakeQuest({ login: String(hero.login).toLowerCase(), role: ((hero as any).role || 'archer'), speed: +QS || 1 }).run({ emit: (_t: string, d: unknown) => store.setQuest(d as any) });

/* ---- debug mode (Settings → Отладка): ?debug=1 switches it on; recorded data for the test dimension's demo places ---- */
if (new URLSearchParams(location.search).get('debug') === '1') { try { localStorage.setItem('l3d.debug', 'on'); } catch { /* */ } }
(window as any).__l3dDebugDemo = {
  stock: structuredClone(stock) as any,
  campLayout: () => campFixtureLayout(),
  fairLayout: () => fixtureLayout(),
  mine: async (rctx) => {
    const bus = makeBus(), fh = structuredClone(hero) as any, login = String(hero.login).toLowerCase();
    const fm = new FakeMine({ login, enter: structuredClone(mineEnter) as any, hero: fh, bus, digSec: 8 });
    const client = new MineClient({ api: (p, b) => fm.api(p, b), login, c: 'home', bus, hero: () => fh, hidden: () => document.hidden });
    const sc = await createMineRoom(rctx, { client });
    const d = sc.dispose.bind(sc); sc.dispose = () => { d(); fm.dispose(); };
    return sc;
  },
} satisfies DemoData;
(window as any).__l3dDebugMocks = { QUEST_MOCKS };   // dev/debug-check.mjs

const site: SiteSession = {
  store, actions,
  moveTo() { /* offline */ },
  art: () => null,
  setClassic() { /* offline */ },
  selfPos: () => [store.me!.x, store.me!.y],
  overlay: () => null,
  closeOverlay() { /* */ },
  tick(dt) {
    for (const b of bots) {
      if (b.bubble && b.bubble.until < Date.now()) b.bubble = undefined;
      if (!b.path || !b.path.length) { b.speed = 0; b.wait -= dt; if (b.wait <= 0) { pathTo(b); b.wait = 2 + Math.random() * 5; } continue; }
      const [tx, ty] = b.path[0], dx = tx - b.x, dy = ty - b.y;
      const dm = Math.hypot(dx * SX, dy * SZ), step = 2.3 * dt;
      if (dm <= step) { b.x = tx; b.y = ty; b.path.shift(); }
      else { b.x += (dx * SX / dm * step) / SX; b.y += (dy * SZ / dm * step) / SZ; }
      b.face = Math.atan2(-(dx * SX), -(dy * SZ)); b.speed = 230;
    }
  },
  dispose() { /* */ },
};

startGame(site, (s) => console.log('[demo]', s)).then((g) => {
  const ui = (window as any).__l3dGame?.ui;
  if (ui) toastDemo = (t) => ui.toast(t);
  (window as any).__demo = { g, store, bots, hero, hwc: (v: string) => { (hero as any).hwc = hwcOf(v); store.setHero(structuredClone(hero)); },
    hwlv: (n: number) => { (hero as any).hw = { ...(hero as any).hw, p: n }; store.setHero(structuredClone(hero)); } };
}).catch((e) => { console.error('demo failed', e); document.body.insertAdjacentHTML('beforeend', `<pre style="color:#f88;position:fixed;top:0;left:0;z-index:999">${String(e?.stack || e)}</pre>`); });
