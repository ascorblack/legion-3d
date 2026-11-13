/**
 * Site update 13.11 afternoon: the live link (/lib/site-live.js LGLiveLink: WebSocket /ws first, SSE /api/live as the
 * fallback). The bridge (src/bridge/bridge.ts) must put the same 'sse:<name>' on window.__L3D_BUS whichever transport the
 * site picks. The site's own site-live.js is run in node:vm against the bridge's wrapped constructors (skipped without
 * the local site copy); the framing itself is tested without it.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import vm from 'node:vm';
import { resolve } from 'node:path';

const SITE = resolve(__dirname, '../.local/site-1113-1607');
const HAS = existsSync(resolve(SITE, 'site-live.js'));

type Fn = (e: any) => void;
class FakeES {
  static CONNECTING = 0; static OPEN = 1; static CLOSED = 2;
  static all: FakeES[] = [];
  url: string; ls = new Map<string, Fn[]>(); readyState = 0; onopen: Fn | null = null; onerror: Fn | null = null;
  constructor(url: string) { this.url = url; FakeES.all.push(this); }
  addEventListener(t: string, fn: Fn) { const a = this.ls.get(t) || []; a.push(fn); this.ls.set(t, a); }
  fire(t: string, data?: string) {
    const ev = { type: t, data };
    for (const fn of this.ls.get(t) || []) fn(ev);
    if (t === 'open' && this.onopen) this.onopen(ev);
    if (t === 'error' && this.onerror) this.onerror(ev);
  }
  close() { this.readyState = 2; }
}
/** A WebSocket that dispatches like the browser: addEventListener listeners and the on<type> handler. */
class FakeWS {
  static CONNECTING = 0; static OPEN = 1; static CLOSING = 2; static CLOSED = 3;
  static all: FakeWS[] = [];
  url: string; readyState = 0; sent: string[] = []; ls = new Map<string, Fn[]>();
  onopen: Fn | null = null; onmessage: Fn | null = null; onclose: Fn | null = null; onerror: Fn | null = null;
  constructor(url: string) { this.url = String(url); FakeWS.all.push(this); }
  addEventListener(t: string, fn: Fn) { const a = this.ls.get(t) || []; a.push(fn); this.ls.set(t, a); }
  send(t: string) { this.sent.push(t); }
  close() { if (this.readyState < 2) this.readyState = 2; }
  private fire(t: string, ev: any) {
    for (const fn of this.ls.get(t) || []) fn(ev);
    const h = (this as any)['on' + t]; if (h) h(ev);
  }
  open() { this.readyState = 1; this.fire('open', { type: 'open' }); }
  msg(data: string) { if (this.readyState !== 1) return; this.fire('message', { type: 'message', data }); }
  shut(code = 1006) { this.readyState = 3; this.fire('close', { type: 'close', code }); }
}

const g = globalThis as any;
let bridge: typeof import('../src/bridge/bridge');
beforeAll(async () => {
  g.window = g;
  g.EventSource = FakeES;
  g.WebSocket = FakeWS;
  bridge = await import('../src/bridge/bridge');
});
const B = () => g.__L3D_BUS;
const frame = (e: string, d: unknown) => `{"op":"ev","e":"${e}","d":${JSON.stringify(d)}}`;

describe('bridge: the live link socket (13.11)', () => {
  it('splits frames exactly like site-live.js', () => {
    expect(bridge.liveFrame(frame('city', { a: 1, t: 'x","d":y' }))).toEqual(['city', '{"a":1,"t":"x\\",\\"d\\":y"}']);
    expect(bridge.liveFrame('{"op":"liveok"}')).toBe('liveok');
    expect(bridge.liveFrame('{"op":"hello","user":"x"}')).toBeNull();
    expect(bridge.liveFrame('{"op":"ev","e":"city"}')).toBeNull();
    expect(bridge.liveFrame(new ArrayBuffer(2))).toBeNull();
  });

  it('only the page\'s /ws socket is the live link', () => {
    expect(bridge.isLiveWs('wss://example.org/ws')).toBe(true);
    expect(bridge.isLiveWs('ws://example.org/ws')).toBe(true);
    expect(bridge.isLiveWs('wss://example.org/other')).toBe(false);
    expect(bridge.isLiveWs('https://example.org/ws')).toBe(false);
  });

  it('the page still gets a real socket; city / me / chat frames reach the bus parsed, others are ignored', () => {
    const kinds: string[] = [], city: any[] = [], opens: number[] = [];
    B().on('live:kind', (k: string) => kinds.push(k));
    B().on('sse:city', (d: any) => city.push(d));
    B().on('sse:open', (t: number) => opens.push(t));
    const siteGot: string[] = [];
    const s = new g.WebSocket('wss://example.org/ws');
    expect(s).toBeInstanceOf(FakeWS);
    expect(g.WebSocket.OPEN).toBe(1);
    expect(g.WebSocket.CLOSING).toBe(2);
    s.onmessage = (e: any) => siteGot.push(e.data);   // the site's own handler is set after construction
    s.open();
    s.msg('{"op":"hello","user":"u"}');
    s.msg('{"op":"liveok"}');
    s.msg(frame('city', { chat: [{ id: 'c1', t: 'привет' }] }));
    s.msg(frame('ann', { an: [] }));                     // not teed
    s.msg(frame('me', { hero: { lv: 3 } }));
    expect(city).toEqual([{ chat: [{ id: 'c1', t: 'привет' }] }]);
    expect(B().last['sse:me']).toEqual({ hero: { lv: 3 } });
    expect(B().last['sse:ann']).toBeUndefined();
    expect(kinds).toEqual(['ws']);
    expect(opens.length).toBe(1);
    expect(siteGot.length).toBe(5);                      // the site's handler saw every frame, untouched
    expect(s.sent).toEqual([]);                          // we never send anything
    const errs: number[] = [];
    B().on('sse:error', (t: number) => errs.push(t));
    s.shut();
    expect(errs.length).toBe(1);
  });

  it('other sockets are not tapped', () => {
    const got: any[] = [];
    B().on('sse:q', (d: any) => got.push(d));
    const s = new g.WebSocket('wss://example.org/chat');
    s.open(); s.msg(frame('q', { on: true }));
    expect(got).toEqual([]);
  });

  it('a throwing bus listener does not reach the page', () => {
    const warn = console.warn; console.warn = () => {};
    const off = B().on('sse:j', () => { throw new Error('boom'); });
    const s = new g.WebSocket('wss://example.org/ws');
    s.open();
    expect(() => s.msg(frame('j', { x: 1 }))).not.toThrow();
    off(); console.warn = warn;
  });
});

describe.skipIf(!HAS)('the site\'s own site-live.js (node:vm) over the bridge', () => {
  /** Runs site-live.js with the bridge's wrapped constructors as the page's WebSocket / EventSource. */
  function link() {
    const sb: any = { self: undefined, setTimeout, clearTimeout, Math, Date, JSON, Map, String, console };
    sb.self = sb; sb.WebSocket = g.WebSocket; sb.EventSource = g.EventSource;
    vm.runInNewContext(readFileSync(resolve(SITE, 'site-live.js'), 'utf8'), sb);
    return sb.LGLiveLink;
  }
  it('WebSocket first: hello → live → liveok → events reach the site AND the bus', () => {
    const L = link();
    const timers: [Fn, number][] = [];
    const site: Record<string, any[]> = {};
    const bus: any[] = [];
    const off = B().on('sse:city', (d: any) => bus.push(d));
    FakeWS.all.length = 0; FakeES.all.length = 0;
    const ES = L.open({ ws: () => ({ url: 'wss://example.org/ws', ch: 'chan', sm: false }), sse: () => '/api/live',
      setTimeout: (f: Fn, ms: number) => { timers.push([f, ms]); return timers.length; }, clearTimeout: () => {} });
    for (const n of ['me', 'city', 'q']) ES.addEventListener(n, (e: any) => (site[n] ||= []).push(JSON.parse(e.data)));
    const s = FakeWS.all[0];
    expect(s.url).toBe('wss://example.org/ws');
    expect(ES.kind).toBe('ws');
    s.open();
    s.msg('{"op":"hello","user":"u"}');
    expect(JSON.parse(s.sent[0])).toEqual({ op: 'live', ch: 'chan' });   // the site subscribes, not us
    expect(s.sent.length).toBe(1);
    s.msg('{"op":"liveok"}');
    expect(ES.ok).toBe(true);
    s.msg(frame('city', { a: [[1, 2]], chat: [{ id: 'k', t: 'hi' }] }));
    expect(site.city).toEqual([{ a: [[1, 2]], chat: [{ id: 'k', t: 'hi' }] }]);
    expect(bus).toEqual(site.city);
    expect(FakeES.all.length).toBe(0);
    ES.close(); off();
  });

  it('falls back to SSE after T.wsTries sockets that never open; the bus keeps getting the same events', () => {
    const L = link();
    expect(L.T.wsTries).toBe(4);
    const timers: (() => void)[] = [];
    const bus: any[] = [], kinds: string[] = [];
    const off1 = B().on('sse:city', (d: any) => bus.push(d)), off2 = B().on('live:kind', (k: string) => kinds.push(k));
    FakeWS.all.length = 0; FakeES.all.length = 0;
    const ES = L.open({ ws: () => ({ url: 'wss://example.org/ws', ch: 'chan' }), sse: () => '/api/live',
      setTimeout: (f: () => void) => { timers.push(f); return timers.length; }, clearTimeout: () => {} });
    const siteCity: any[] = [];
    ES.addEventListener('city', (e: any) => siteCity.push(JSON.parse(e.data)));
    for (let i = 0; i < 4; i++) { FakeWS.all[i].shut(1006); timers.shift()!(); }   // never opened → retry
    expect(FakeWS.all.length).toBe(4);
    expect(ES.kind).toBe('sse');
    const es = FakeES.all[0];
    expect(es.url).toBe('/api/live');
    es.fire('open');
    es.fire('city', JSON.stringify({ n: 7 }));
    expect(siteCity).toEqual([{ n: 7 }]);
    expect(bus).toEqual([{ n: 7 }]);
    expect(kinds).toEqual(['sse']);
    ES.close(); off1(); off2();
  });

  it('liveerr off → SSE at once', () => {
    const L = link();
    const timers: (() => void)[] = [];
    FakeWS.all.length = 0; FakeES.all.length = 0;
    const ES = L.open({ ws: () => ({ url: 'wss://example.org/ws', ch: 'chan' }), sse: () => '/api/live',
      setTimeout: (f: () => void) => { timers.push(f); return timers.length; }, clearTimeout: () => {} });
    const s = FakeWS.all[0];
    s.open(); s.msg('{"op":"hello","user":"u"}'); s.msg('{"op":"liveerr","code":"off"}');
    timers.shift()!();
    expect(ES.kind).toBe('sse');
    expect(FakeES.all.length).toBe(1);
    ES.close();
  });
});

describe.skipIf(!HAS)('app.js 13.11 uses the live link', () => {
  const app = HAS ? readFileSync(resolve(SITE, 'app.js'), 'utf8') : '';
  it('ws only with hero.lw (outside the cage, not the dock), SSE /api/live otherwise; the same event names', () => {
    expect(app).toMatch(/wsOn = \(\) => !DOCK && !wsNoAuth && !!\(ME && ME\.hero && ME\.hero\.lw\) && !inJail\(\)/);
    expect(app).toMatch(/ES = window\.LGLiveLink\.open\(\{\s*sse: \(\) => \(window\.LG_BASE \|\| ''\) \+ '\/api\/live' \+ q,/);
    for (const n of ['me', 'city', 'mine', 'q', 'j', 'jail', 'style', 'sm', 'dm']) expect(app).toContain(`ES.addEventListener('${n}'`);
  });
});

/* ------------------------------------------------------------------ the rest of 13.11 */
import d04 from './fixtures/townkit-d04.json';
import { townKitScene, kitOf, kitGlade, natureOf, forestMix } from '../src/net/townkit';
import { cityMonWall } from '../src/net/citymon';
import { layerRef } from '../src/world/fcart/fingerprint';
import { kitFixtureLayout } from '../dev/fixtures';
import { lintTownSource } from '../src/world/lint/town';
import contract from '../src/data/site-contract.json';

describe('LGCity.wall() 13.11: own = own | home | why home / camp — read as the site computes it', () => {
  const ownOf = (acc: any) => (acc ? !!(acc.own || acc.home || acc.why === 'home' || acc.why === 'camp') : true);   // city.js 13.11 wall()
  const wall = (own: boolean, glade: unknown = null) => ({ LGCityMon: {}, LGCity: { wall: () => ({ x: 2000, y: 2900, town: 'n-d04', own, glade, X: { hero: () => ({ cm: { n: 1, of: 10, nx: 0 } }) } }) } });
  it('a home / camp town counts as own now; cityMonWall follows W.own', () => {
    for (const acc of [{ own: 1 }, { home: 1 }, { why: 'home' }, { why: 'camp' }, null]) expect(ownOf(acc)).toBe(true);
    expect(ownOf({ why: 'visit' })).toBe(false);
    expect(cityMonWall(wall(ownOf({ why: 'camp' })))!.own).toBe(true);
    expect(cityMonWall(wall(ownOf({ why: 'visit' })))).toBeNull();
  });
  it('a Town Kit town passes its glade through wall() (S.cats = the tk-city.js result)', () => {
    const g = kitGlade((d04 as any).T.glade)!;
    const w = cityMonWall(wall(true, { ...(d04 as any).T.glade, spots: g.spots }))!;
    expect(w.glade?.spots?.length).toBe(13);
  });
  it.skipIf(!HAS)('the contract regex matches the 13.11 city.js', () => {
    const c = (contract as any).checks.find((x: any) => x.id.startsWith('city.js LGCity.wall()'));
    expect(new RegExp(c.re).test(readFileSync(resolve(SITE, 'city.js'), 'utf8'))).toBe(true);
  });
  it.skipIf(!HAS)('the live-link contract checks match the 13.11 scripts', () => {
    for (const [id, f] of [['site-live.js frame', 'site-live.js'], ['app.js live link', 'app.js']]) {
      const c = (contract as any).checks.find((x: any) => x.id.startsWith(id));
      expect(new RegExp(c.re).test(readFileSync(resolve(SITE, f), 'utf8')), id).toBe(true);
    }
  });
});

describe('Town Kit 13.11: the kit town «Рябиново» (d04): palisade, glade, rowans, hives, racks, nature', () => {
  const m = d04 as any;
  const sc = townKitScene(m.T, m.levelled, { building: m.cfg.building, now: m.cfg.now, rail: m.RAIL })!;
  it('the scene carries the palisade with its watchtowers, the glade with 13 spots, the forest mix', () => {
    expect(sc.wall).toMatchObject({ k: 'palisade', towers: [950, 3050, 4450], roof: 'red', gate: [1928, 2072] });
    expect(sc.glade!.spots.length).toBe(13);
    expect(sc.glade!.spots.filter((p) => p.gate).length).toBe(2);
    expect(sc.glade!.spots.filter((p) => !p.gate).every((p) => p.poly?.length === 18)).toBe(true);
    expect(kitOf(sc)!.nature).toEqual({ dark: 5, pine: 3, rowan: 1 });
    expect(forestMix(kitOf(sc))).toEqual({ pine: 3 / 9, rowan: 1 / 9 });
    expect(forestMix({ biome: 'ice', nature: null }).pine).toBe(0.8);
    expect(natureOf({ dark: 2, bad: -1, 'x y': 3 })).toEqual({ dark: 2 });
    expect(['rowan', 'hives', 'racks'].every((k) => sc.items.some((it) => it.k === k))).toBe(true);
  });
  it.skipIf(!HAS)('the glade spots\' clearings are the site\'s own (tk-art.js gladeOf / spotPoly)', async () => {
    const { siteModules } = (await import('../scripts/fcart-fp.mjs' as string)) as any;
    const { K } = siteModules(SITE);
    const site = K.gladeOf(m.T);
    expect(kitGlade(m.T.glade)!.spots.map((p) => p.poly ?? null)).toEqual(site.spots.map((p: any) => p.poly ?? null));
  });
  it('the 3D town builds them: palisade + towers, glade, rowan / hives / racks props; the old fixture keeps the stone wall', () => {
    const src = lintTownSource('d04', kitFixtureLayout({ id: 'd04' }));
    const tags = new Map<string, number>();
    for (const p of src.pieces) tags.set(p.tag, (tags.get(p.tag) || 0) + 1);
    expect(tags.get('terrain:wall')!).toBeGreaterThan(400);    // ≈ 210 stakes × (stake + point) + rails + 3 towers
    expect(tags.get('terrain:glade')!).toBeGreaterThan(20);
    for (const t of ['prop:rowan', 'prop:hives', 'prop:racks']) expect(tags.get(t) || 0, t).toBeGreaterThan(0);
    const old = lintTownSource('kit', kitFixtureLayout({}));
    expect(old.pieces.some((p) => p.tag === 'prop:rowan')).toBe(false);
    expect(old.pieces.filter((p) => p.tag === 'terrain:wall').length).toBeLessThan(120);   // stone wall + round towers
  }, 60000);
});

describe('asset fingerprints 13.11: the ground reaches EDGE.art beyond the map, a fog layer on top', () => {
  it('layerRef names the extended ground «terrain» and the fog «fog»; the old box still works', () => {
    const map = { W: 5760, H: 3240 };
    expect(layerRef({ x: -40, y: -40, w: 5840, h: 3320, svg: '<rect/>' }, map)).toBe('terrain');
    expect(layerRef({ x: -552, y: -552, w: 6864, h: 4344, svg: '<rect fill="#2f4a33"/>' }, map)).toBe('terrain');
    expect(layerRef({ x: -552, y: -552, w: 6864, h: 4344, svg: '<linearGradient id="fcFogW"/>' }, map)).toBe('fog');
    expect(layerRef({ x: -552, y: -552, w: 6864, h: 4344, svg: '<linearGradient id="tkFogN"/>' }, map)).toBe('fog');
    expect(layerRef({ x: 940, y: 940, w: 940, h: 940, svg: '' }, map)).toBeNull();
  });
});

import { cardOf, lootCard, LOOT_RAR } from '../src/quest/index';
describe('quest.js 13.11: the loot vote (rarity, own vote by login, on top of a running battle)', () => {
  const loot = { name: 'Клык', until: 1e13, n: 3, rar: 'legendary', my: 'u2', nl: [['u1', 'Первый'], ['u2', 'Второй']], top: [['u2', 'Второй', 2]] as [string, string, number][] } as any;
  it('headline by rarity and own vote by name; «*» = random; old boolean my still reads', () => {
    expect(lootCard(loot, true)).toMatchObject({ icon: '🌟', title: 'Легендарная добыча: Клык', urge: { kind: 'ok', text: 'твой голос: Второй' } });
    expect(lootCard({ ...loot, rar: 'epic', my: '*' }, true)).toMatchObject({ icon: '🎁', title: 'Эпическая добыча: Клык', urge: { text: 'твой голос: случайному' } });
    expect(lootCard({ ...loot, rar: undefined, my: true }, true)).toMatchObject({ title: 'Делёж вещи: Клык', urge: { text: 'твой голос учтён' } });
    expect(lootCard({ ...loot, my: undefined }, false).urge!.kind).toBe('info');
    expect(Object.keys(LOOT_RAR)).toEqual(['legendary', 'epic']);
  });
  it('a loot vote during a battle is the card (the site puts it above the battle)', () => {
    const v = { on: true, party: 'in', loot, b: { st: 'fight', a: [], e: [] } } as any;
    expect(cardOf(v, { login: 'u2', role: 'mage' }, () => '!атака')!.title).toBe('Легендарная добыча: Клык');
  });
  it.skipIf(!HAS)('the site\'s LT_RAR and lootHtml are what lootCard mirrors', () => {
    const q = readFileSync(resolve(SITE, 'quest.js'), 'utf8');
    expect(q).toContain("const LT_RAR = { legendary: ['🌟', 'Легендарная добыча'], epic: ['🎁', 'Эпическая добыча'] };");
    expect(q).toContain("const myN = L.my === '*' ? 'случайному' : L.my ? ((nl.find((c) => c[0] === L.my) || (L.top || []).find((c) => c[0] === L.my) || [L.my, L.my])[1]) : '';");
    expect(q).toMatch(/if \(v\.loot && \(v\.b \|\| v\.bg \|\| v\.lair\)\)/);
  });
});

import { MineClient, minePollWait, MINE_POLL_STEPS } from '../src/rooms/mine/net';
describe('mine.js 13.11 poll cadence: hold, POLL_STEPS backoff while the live link is down, every 10th tick otherwise', () => {
  const mk = (o: { ok?: boolean; pollOk?: boolean; held?: number }) => {
    let t = 1_000_000; const calls: number[] = [];
    const c = new MineClient({ login: 'me', api: async (p: string) => { if (p.startsWith('/api/mine/state')) calls.push(t); return { ok: o.ok ?? true }; },
      now: () => t, rnd: () => 0, pollOk: () => o.pollOk ?? true, held: () => o.held ?? 0, hidden: () => false,
      timers: { setInterval: () => 0, clearInterval: () => {}, setTimeout: () => 0, clearTimeout: () => {} } });
    c.entered = true;
    const run = async (ms: number) => { for (let e = 0; e < ms; e += 3000) { await c.poll(); t += 3000; } };
    return { c, calls, run };
  };
  it('the site\'s POLL_STEPS', () => {
    expect([...MINE_POLL_STEPS]).toEqual([1e4, 15e3, 3e4, 6e4]);
    expect(minePollWait(0, 1)).toBe(15000);
    expect(minePollWait(9, 0)).toBe(60000);
  });
  it.skipIf(!HAS)('the numbers are the site\'s (site-ui.js)', () => {
    expect(readFileSync(resolve(SITE, 'site-ui.js'), 'utf8')).toContain('const POLL_STEPS = [10000, 15000, 30000, 60000];');
  });
  it('live link down for good: one state poll per 10 s (was every 3 s), slower on failures', async () => {
    const a = mk({}); await a.run(60000);
    expect(a.calls.length).toBeGreaterThanOrEqual(5); expect(a.calls.length).toBeLessThanOrEqual(6);
    const b = mk({ ok: false }); await b.run(120000);
    expect(b.calls.length).toBeLessThanOrEqual(6);           // 10 → 15 → 30 → 60 s
  });
  it('the live link reconnecting (pollOk false): every 10th tick; the site holding after a 503: nothing', async () => {
    const a = mk({ pollOk: false }); await a.run(90000);
    expect(a.calls.length).toBe(3);
    const h = mk({ held: 5000 }); await h.run(60000);
    expect(h.calls.length).toBe(0);
    await h.c.poll(true);                                      // a full poll (floor change, rejoin) still goes out
    expect(h.calls.length).toBe(1);
  });
});
