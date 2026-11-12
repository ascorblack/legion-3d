/**
 * Site update 11→12.11 (site-1111-1607 → site-1112-0007).
 *  - guildhall.js: the guild district of 07.11 is gone; LGGuildHall is now an INTERIOR (LGGuildHallMap / LGGuildHallArt),
 *    entered from the cats fair's new building `guild` (city.js goBuilding / openPanel → ghOpen → LGGuildHall.enter) or the
 *    City HUD's `.gh-entry` elsewhere; `.gh-root` over the sleeping City. src/net/guildhall.ts, site.ts soonOf / overlay,
 *    src/features/site-places.ts (pause entry, live «скоро»), src/core/registries.ts guild → 'site'.
 *  - fc-map.js / fc-art.js: «Здание гильдий» (tk-art.js guildHall lv 3) instead of the blue house h3 → src/world/fcart/civic.ts
 *    buildGuild; the houses' roof cats follow the site's index parity (mustard lost it, pink got it).
 *  - quest.js: the boss scheme registry (LGQuestSchemes) and «Курган-Сундук» (g.sk) → src/quest/schemes.ts, adapter.ts.
 *  - site-chat.js / site-ui.js: a mute asks for a reason (LGSiteUi.askReason), `reason` in the request and «. Причина: …».
 *  - app.js: announcements in the «Игра» HUD (me.an, guAnn) → src/features/announce.ts; the journal's «Гильдия» tab / kind.
 * The site's own code runs here (node:vm) when a downloaded copy is around (.local/site-*); skipped otherwise.
 */
import { describe, it, expect, afterEach } from 'vitest';
import vm from 'node:vm';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { ghOn, guildSoon, ghRefusal, GH_SOON, GH_ROOT, GH_ENTRY, GH_MODAL } from '../src/net/guildhall';
import { soonOf, GUILD_HALL } from '../src/net/site';
import feature, { syncGuildSoon, GUILD_ENTRY } from '../src/features/site-places';
import { pauseItems } from '../src/ui/settings-ext';
import { DEFAULT_BUILDINGS } from '../src/core/registries';
import { createRoomManager } from '../src/core/rooms';
import { fcModel } from '../src/world/fcart/registry';
import { BUILDING_XF } from '../src/world/buildings';
import { staticFairCats } from './world-fixture';
import { fairCatsFixtureLayout } from '../dev/fixtures';
import { fairCatsOf } from '../src/net/faircats';
import { skScheme, skMine, SK_IDS, skMoney, pageSchemes } from '../src/quest/schemes';
import { adapt, Roster } from '../src/expedition/adapter';
import { bossNote } from '../src/quest';
import { modBody, planCmd, whyTail, muteWhat, Moderator, ModState } from '../src/ui/chat-mod';
import { readAnns, closeAnn, annKey } from '../src/features/announce';
import { JT, JK, JRK } from '../src/ui/menus';
import { siteCopy, fnSource, siteBoss, schemeBlock } from './site-quest-fns';
import FC from './fixtures/faircats-map.json';

const GH = siteCopy('guildhall.js', "root.className = 'gh-root'");
const CITY = siteCopy('city.js', "b.id === 'guild' ? ghOn()");
const QUEST = siteCopy('quest.js', 'const SK_SCHEMES');
const APP = siteCopy('app.js', 'function guAnn(');
const CHAT = siteCopy('site-chat.js', 'askReason');
const SITE = resolve(__dirname, '../.local/site-1112-0007');
const g = globalThis as any;
afterEach(() => { for (const k of ['document', 'LGGuildHall']) delete g[k]; });

/* ================================================================== guild hall */
describe('guild hall (guildhall.js 12.11)', () => {
  it('ghOn / soonOf: «скоро» exactly while the site says ghOn() === false, with the site\'s words', () => {
    expect(ghOn({})).toBe(false);   // no LGGuildHall: city.js ghOn → false → soon
    expect(ghOn({ LGGuildHall: { on: () => null } })).toBe(null);
    expect(ghOn({ LGGuildHall: { on: () => true } })).toBe(true);
    expect(ghOn({ LGGuildHall: { on: () => { throw new Error('x'); } } })).toBe(false);
    expect(soonOf({ id: 'guild' }, false, false, false, false)).toEqual({ soon: true, soonText: GH_SOON });
    expect(soonOf({ id: 'guild' }, false, false, false, null)).toEqual({ soon: false });
    expect(soonOf({ id: 'guild', soon: true }, false, false, false, true)).toEqual({ soon: false });
    expect(soonOf({ id: 'forge', soon: true }, false, false, false, false)).toEqual({ soon: true });
    expect(ghRefusal({ ok: true })).toBeNull();
    expect(ghRefusal({ ok: false, unavailable: true, error: 'Здания гильдий нет в этом сезоне' })).toEqual({ text: GH_SOON, bad: false });
    expect(ghRefusal({ ok: false, error: 'нет связи' })).toEqual({ text: 'нет связи', bad: true });
    expect(ghRefusal(null)).toEqual({ text: 'Здание гильдии сейчас недоступно', bad: true });
    expect(GUILD_HALL).toBe(GH_ROOT); expect(GUILD_ENTRY).toBe(GH_ENTRY);
    expect(DEFAULT_BUILDINGS.guild).toEqual({ model: 'guild', room: 'site' });
  });
  it.skipIf(!CITY)('city.js: our soonOf(guild) is its soonB for every ghOn answer; the building opens through ghOpen → LGGuildHall.enter', () => {
    const line = (re: RegExp) => { const m = re.exec(CITY!); expect(m, String(re)).toBeTruthy(); return m![0]; };
    const ghOnSrc = line(/const ghOn = \(\) => \{[^\n]*\};/), soonSrc = line(/const soonB = \(b\) => [^\n]*;/);
    for (const on of [true, false, null, 'throw', 'none'] as const) {
      const win: any = on === 'none' ? {} : { LGGuildHall: { on: () => { if (on === 'throw') throw new Error('x'); return on; } } };
      const ctx: any = { window: win, auOpen: () => false, stOpen: () => false, mnOn: () => false };
      vm.createContext(ctx);
      const site = vm.runInContext(`${ghOnSrc}\n${soonSrc}\nsoonB({ id: 'guild' })`, ctx);
      expect(soonOf({ id: 'guild' }, false, false, false, ghOn(win)).soon, String(on)).toBe(site);
    }
    expect(CITY!).toMatch(/if \(id === 'guild'\) \{ const end = walkTo\(S\.me, B\.door\.x, B\.door\.y\);[^\n]*ghOpen/);   // goBuilding: walk, then open
    expect(CITY!).toMatch(/if \(id === 'guild'\) \{ ghOpen\(\); return; \}/);                                        // LGCity.panel('guild')
    expect(fnSource(CITY!, 'ghOpen')).toMatch(/G\.enter\(\)[\s\S]*Здание гильдий скоро откроется/);
    expect(CITY!).toMatch(/hasB: \(id\) =>/);
  });
  it.skipIf(!GH)('guildhall.js: LGGuildHall keys, enter() refusals = ghRefusal, the HUD entry and the root we watch', async () => {
    const lit = /window\.LGGuildHall = \{([\s\S]*?)\n  \};/.exec(GH!)![1];
    for (const k of ['on', 'enter', 'close', 'index', 'open']) expect(lit).toMatch(new RegExp(`(^|[\\s,])${k}[,:]`));
    expect(lit).not.toMatch(/\bpick\b/);   // 07.11's district pick window is gone (the live contract's degrade)
    // enter(): run the site's own function on the answers it can get
    const src = fnSource(GH!, 'enter')!;
    for (const r of [{ ok: false, unavailable: true }, { ok: false, closed: true }, { ok: false, error: 'слишком часто - подожди немного' }, { ok: true }, { ok: true, guild: { id: 1 } }]) {
      const out: any = { toast: null, noGuild: 0, open: 0 };
      const ctx: any = { OPEN: false, index: async () => r, toast: (t: string, bad: boolean) => { out.toast = { text: t, bad: !!bad }; }, noGuild: () => { out.noGuild++; }, open: () => { out.open++; } };
      vm.createContext(ctx);
      await vm.runInContext(`(async ${src.replace(/^function enter/, 'function')})()`, ctx);
      expect(out.toast, JSON.stringify(r)).toEqual(ghRefusal(r));
      expect(out.noGuild).toBe(r.ok && !(r as any).guild ? 1 : 0);
      expect(out.open).toBe((r as any).guild ? 1 : 0);
    }
    expect(GH!).toMatch(/b\.className = 'gh-entry'/);
    expect(GH!).toMatch(/hasB\('guild'\)/);
    expect(GH!).toMatch(new RegExp(`w\\.className = '${GH_MODAL.slice(1)} ' \\+ cls`));
    expect(GH!).toMatch(/role="dialog" aria-modal="true"/);   // the 3D yields to it as a dialog
    expect(GH!).toMatch(/LGCity\.sleep\(\)/);
    expect(GH!).not.toMatch(/gd-root|gd-entry|LGGuildDistrict/);
  });
  it('site-places: the pause entry presses .gh-entry; the 3D guild building follows ghOn live', async () => {
    const entry = { hidden: false, clicks: 0, click() { this.clicks++; } };
    g.document = { querySelector: (s: string) => (s === GH_ENTRY ? entry : null) };
    const off = (feature as any).setup({ actions: { openSitePanel: () => {} }, layout: () => null, state: {}, ui: { toast: () => {} } });
    const it = pauseItems().find((p) => p.id === 'site.guild')!;
    expect(it.label).toBe('Здание гильдии');
    it.run(); await new Promise((r) => setTimeout(r, 5));
    expect(entry.clicks).toBe(1);
    off();
    const B: any[] = [{ id: 'guild', title: 'Здание гильдий' }, { id: 'hall', title: 'Ратуша' }];
    expect(syncGuildSoon(B, { LGGuildHall: { on: () => null } })).toBe(false);
    expect(B[0].soon).toBeFalsy();
    expect(syncGuildSoon(B, { LGGuildHall: { on: () => false } })).toBe(true);
    expect(B[0]).toMatchObject({ soon: true, soonText: GH_SOON });
    expect(syncGuildSoon(B, { LGGuildHall: { on: () => true } })).toBe(true);
    expect(B[0].soon).toBe(false); expect(B[0].soonText).toBeUndefined();
    expect(syncGuildSoon([{ id: 'hall' }] as any, {})).toBe(false);
  });
  it('E at a «скоро» guild says the site\'s words; an open one goes to the site (LGCity.panel through openSite)', async () => {
    const toasts: string[] = [], opened: string[] = [];
    const b: any = { id: 'guild', title: 'Здание гильдий', soon: true, soonText: GH_SOON, hit: [0, 1, 0, 1], door: { x: 0, y: 0 } };
    const regs: any = { buildings: { resolve: (id: string) => DEFAULT_BUILDINGS[id] ?? { room: 'site' } }, rooms: { get: () => undefined } };
    const mgr = createRoomManager({ ctx: {} as any, registries: regs, building: () => b, openSite: (id: string) => opened.push(id), toast: (t: string) => toasts.push(t), showPanel: () => {}, hidePanel: () => {} } as any);
    await mgr.enter('guild');
    expect(toasts).toEqual([GH_SOON]); expect(opened).toEqual([]);
    b.soon = false; delete b.soonText;
    await mgr.enter('guild');
    expect(opened).toEqual(['guild']);
  });
});

/* ================================================================== the 3D guild building */
describe('cats fair: «Здание гильдий» instead of the blue house h3', () => {
  it('fixture (fc-map.js 12.11): the building, the path, h3 gone; the model is registered with the site asset fp', () => {
    const gb = (FC as any).BUILDINGS.find((b: any) => b.id === 'guild');
    expect(gb).toMatchObject({ title: 'Здание гильдий', sign: 'ГИЛЬДИИ', roof: 'plum', vis: [3290, 2220, 3840, 2540], foot: [3300, 2380, 3830, 2540], door: { x: 3565, y: 2562 } });
    expect((FC as any).HOUSES.map((h: any) => h.id)).toEqual(['tavern', 'h1', 'h2', 'h4', 'h5']);
    expect(fcModel('guild')?.fp).toBe('1409348aa9362c');
  });
  it('builds the asset model: one door mark on the facade, the door volume from civicDoorXf, the sign', () => {
    const { k, rec, L } = staticFairCats(true);
    const b = L.buildings.find((x) => x.id === 'guild')!;
    expect(b).toBeTruthy();
    const marks = (k.marks || []).filter((m) => m.tag === 'guild');
    expect(marks.length).toBe(1);
    const [x0, x1, y0, y1] = marks[0].box;
    expect((x0 + x1) / 2).toBeCloseTo(35.65, 1); expect(x1 - x0).toBeGreaterThan(0.8); expect(y1 - y0).toBeGreaterThan(1.4);
    expect(BUILDING_XF.get(b)?.s).toBe(0.8);
    expect(rec.pieces.filter((q) => q.tag === 'guild').length).toBeGreaterThan(40);
    expect(rec.pieces.some((q) => q.tag === 'guild' && q.mat === 'fcroof')).toBe(true);
    expect(new Set(rec.pieces.filter((q) => q.tag === 'guild').map((q) => q.mat)).size).toBeLessThanOrEqual(6);
  });
  it.skipIf(!existsSync(resolve(SITE, 'fc-art.js')))('the houses\' roof cats: fc-art.js gives every second house (by index) the cat — the 3D list is the site\'s list', async () => {
    const { siteModules } = (await import('../scripts/fcart-fp.mjs' as string)) as any;
    const { F } = siteModules(SITE);
    expect(F.HOUSES.map((h: any) => h.id)).toEqual(fairCatsOf(fairCatsFixtureLayout({}))!.houses.map((h) => h.id));
    const cats = F.HOUSES.filter((_h: any, i: number) => i % 2 === 0).map((h: any) => h.roof);
    expect(cats).toEqual(['plum', 'red', 'pink']);   // tavern, h2, h5: mustard (h4) lost it with h3 gone, pink got it
    expect(siteCopy('fc-art.js', 'roofCat: i % 2 === 0')).toBeTruthy();
  });
});

/* ================================================================== quest.js boss schemes */
const SB = siteBoss();
const ZN = { a: [[1, [2, 3], [[300, 820], [560, 800], [600, 900], [320, 930]]], [2, [1, 4], [[640, 790], [900, 780], [940, 880], [660, 900]]],
  [3, [1, 4], [[420, 940], [700, 930], [720, 1030], [400, 1040]]], [4, [2, 3], [[760, 920], [1020, 910], [1050, 1010], [780, 1030]]]], gone: [] as number[] };
const view = (bg: Record<string, unknown>) => ({ on: true, k: 'boss', t: 'Курган', ter: 'Курган', n: 6, party: 'in',
  bg: { name: 'Курган-Сундук', title: 'Хранитель кладов', danger: 3, ph: 1, phs: 2, hp: 0.7, st: 'tele', in: true, my: 0.9, round: 3, limit: 9, area: 2, ...bg } });
const ctx = (scheme?: any) => ({ login: 'player1', role: 'archer', roster: new Roster(), scheme });
describe.skipIf(!QUEST || !SB?.schemeFor)('quest.js (12.11) boss schemes against the site\'s own code', () => {
  const runSK = () => {
    const c: any = { esc: (s: unknown) => String(s ?? ''), svgI: () => '', window: {}, SKW: 400, SKH: 230, SKG: 196, skFig: () => '', skParty: () => '', skGround: () => '', skT: () => '', Math, JSON, Set, Map, Object, Array, String, Number };
    vm.createContext(c);
    vm.runInContext(schemeBlock(QUEST!)! + '\n;globalThis.__SK = SK_SCHEMES;', c);
    return c.__SK as Record<string, (g: any, M: any, sk: any) => any>;
  };
  it('SK_SCHEMES: our port gives the same field kinds, texts, captions and counters for every move', () => {
    const SK = runSK();
    expect(Object.keys(SK).sort()).toEqual([...SK_IDS].sort());
    const sk = { bite: [1, 3], side: 'L', max: 4, ch: 3, per: 2, l: 1, r: 3, k: 1, pl: 120, gl: 300, pr: 300, gr: 300, myStuck: 1, myCoins: 12345 };
    const M = { zones: [2, 5, 9], word: 'ЖАДИНА', need: 500, got: 150, tgn: ['Мурка'] };
    for (const id of SK_IDS) {
      const site = SK[id]({ sk }, M, sk), ours = skScheme({ sk, area: 2 }, id === 'HSKB' ? null : { ...M, id })!;
      expect(ours.id).toBe(id);
      expect(ours.cap, id).toBe(site.cap); expect(ours.say, id).toBe(site.say);
      expect(ours.z, id).toEqual(Object.fromEntries(Object.entries(site.z).map(([n, k]) => [+n, k])));
      expect(ours.t, id).toEqual(Object.fromEntries(Object.entries(site.t || {}).map(([n, t]) => [+n, t])));
      for (const b of ours.bars) expect(String(site.extra || ''), id).toContain(b.label);
      expect((String(site.extra || '').match(/q-skc/g) || []).length, id).toBe(ours.bars.length);
    }
    expect(skMine({ sk })).toEqual(['Ты в золоте ещё 1 раунд - не бьёшь и не сходишь с места', 'Ты подобрал за бой: 1 зол. 23 сер. 45 бр.']);
    expect(skMoney(0)).toBe('0 бр.'); expect(skMoney(250)).toBe('2 сер. 50 бр.');
    expect(skScheme({}, null)).toBeNull(); expect(skScheme({ sk: {} }, { id: 'M1' })).toBeNull();
    expect(SB!.skHtml!({ sk, area: 2 }, { ...M, id: 'HSK1' })).toContain('Схема · Жадность');
  });
  it('the chest barrow in 3D: its field as the arena, red = hurts, green = safe, «2» typed to leave; the HUD note', () => {
    const v = view({ sk: { myCoins: 300 }, mech: { id: 'HSK1', name: 'Жадность', fam: 'position', zones: [2, 5], text: 'Монеты!' } });
    const s = adapt(v as any, ctx(SB!.schemeFor));
    const z = (n: number) => s.boss!.zones.find((q) => q.n === n)!;
    expect(s.boss!.zones.map((q) => q.n)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(z(2)).toMatchObject({ danger: true, safe: false, mine: true });
    expect(z(5).danger).toBe(true); expect(z(1).safe).toBe(true);
    expect(z(1).x).toBeLessThan(z(10).x); expect(z(10).x).toBeLessThan(z(6).x);   // left bank, bridge, right bank
    const goal = s.boss!.zones.find((q) => q.goal)!;
    expect(goal.safe).toBe(true);
    expect(s.cmds).toContainEqual(expect.objectContaining({ kind: 'say', text: String(goal.n) }));
    expect(s.cmds).toContainEqual(expect.objectContaining({ kind: 'info', text: 'Схема · Жадность' }));
    expect(s.cmds.map((c) => c.text)).toContain('Ты подобрал за бой: 3 сер.');
    expect(bossNote(v.bg)).toMatch(/Схема · Жадность: Золото - на монетах больно/);
    // the bite without a mechanic (HSKB)
    const b = adapt(view({ st: 'boss', sk: { bite: [5, 6] } }) as any, ctx(SB!.schemeFor));
    expect(b.boss!.zones.filter((q) => q.danger).map((q) => q.n)).toEqual([5, 6]);
    expect(b.cmds[0].text).toBe('Схема · Укус берега');
  });
  it('an arena scheme (HV2 «Болты бьют по ряду»): red / green platforms of the site\'s scheme, «прыжок N» typed, its caption', () => {
    const M = { id: 'HV2', name: 'Болты по ряду', fam: 'strike', zones: [1, 2], text: 'Болты!' };
    const g = { zn: ZN, area: 1, mech: M };
    const site = SB!.schemeFor!(g, M, 'HV2');
    expect(site.arena.bad).toEqual([1, 2]); expect(site.arena.safe).toEqual([3, 4]);
    const s = adapt(view({ name: 'Волк', st: 'tele', zn: ZN, area: 1, mech: M }) as any, ctx(SB!.schemeFor));
    const P = Object.fromEntries(s.boss!.zones.map((q) => [q.n, q]));
    expect([P[1].danger, P[2].danger, P[3].safe, P[4].safe]).toEqual([true, true, true, true]);
    expect(P[3].goal).toBe(true);   // my neighbour that is safe
    expect(s.cmds).toContainEqual(expect.objectContaining({ kind: 'say', text: 'прыжок 3' }));
    expect(s.cmds).toContainEqual(expect.objectContaining({ kind: 'info', text: site.cap }));
    // without the page's registry: the 07.11 behaviour (a strike mechanic paints nothing)
    const plain = adapt(view({ name: 'Волк', st: 'tele', zn: ZN, area: 1, mech: M }) as any, ctx());
    expect(plain.boss!.zones.some((q) => q.danger || q.safe)).toBe(false);
  });
  it('the hunters\' volley on the boss turn (g.bas HVB1): no answer, the caption in the HUD', () => {
    const v = view({ name: 'Егерь', st: 'boss', bas: 'HVB1', mech: null });
    const site = SB!.schemeFor!(v.bg, null, 'HVB1');
    const s = adapt(v as any, ctx(SB!.schemeFor));
    expect(s.boss!.basic).toEqual({ title: 'Ход охотников', cap: site.cap });
    expect(s.cmds).toContainEqual({ kind: 'info', text: `Ход охотников: ${site.cap}` });
    expect(bossNote(v.bg, SB!.schemeFor!)).toContain('Ход охотников: ' + site.cap);
    expect(pageSchemes({ LGQuestSchemes: SB!.LGQuestSchemes })!(v.bg, null, 'HVB1').cap).toBe(site.cap);
    expect(pageSchemes({})).toBeUndefined();
  });
});

/* ================================================================== chat: mute reason */
describe('chat moderation 12.11: a mute carries a reason', () => {
  it('request body, typed /mute reason, the site\'s reason dialog first, «. Причина: …»', async () => {
    expect(modBody('mute', { login: 'x', min: 30, reason: 'спам' })).toEqual({ op: 'mute', id: undefined, login: 'x', min: 30, reason: 'спам' });
    expect(modBody('mute', { login: 'x', min: 30, reason: '' })).toEqual({ op: 'mute', id: undefined, login: 'x', min: 30 });
    expect(modBody('ban', { login: 'x', reason: 'спам' } as any)).toEqual({ op: 'ban', id: undefined, login: 'x', min: undefined });
    expect(planCmd('/mute bad_cat 60 флуд и реклама', 'mod')).toEqual({ act: 'mute', args: { login: 'bad_cat', n: 'bad_cat', min: 60, reason: 'флуд и реклама' } });
    expect(muteWhat(30)).toBe('мут 30 мин'); expect(muteWhat(360)).toBe('мут 6 ч'); expect(muteWhat(7)).toBe('мут 7 мин');
    expect(whyTail({ until: 1, reason: 'спам' })).toBe('. Причина: спам'); expect(whyTail(null)).toBe('');
    const calls: any[] = [], asked: any[] = [];
    let answer: string | null = 'оскорбления';
    const mod = new Moderator('/api/city/chat', '', async (p, b) => { calls.push(b); return { ok: true }; }, { remove() {}, setRole() {}, note() {}, sys() {} }, async (o) => { asked.push(o); return answer; });
    await mod.act('mute', { login: 'kot', n: 'Кот', min: 30 });
    expect(asked.length).toBe(1); expect(calls.pop()).toEqual({ op: 'mute', login: 'kot', min: 30, reason: 'оскорбления' });
    answer = null;
    expect(await mod.act('mute', { login: 'kot', n: 'Кот', min: 30 })).toBe(false);   // cancelled: nothing sent
    expect(calls.length).toBe(0);
    await mod.act('mute', { login: 'kot', n: 'Кот', min: 5, reason: '' });             // a typed one never asks
    expect(asked.length).toBe(2); expect(calls.pop()).toEqual({ op: 'mute', login: 'kot', min: 5 });
    const st = new ModState();
    expect(st.me({ muted: { until: 0, reason: 'спам' } })).toBe('Модератор запретил тебе писать в чат. Причина: спам');
  });
  it.skipIf(!CHAT)('site-chat.js: chatAct asks LGSiteUi.askReason for a mute and sends `reason` only when given', () => {
    expect(CHAT!).toMatch(/if \(op === 'mute' && o\.reason === undefined\) \{ const w = await askWhy\(o\); if \(w === null\) return false;/);
    expect(CHAT!).toMatch(/\.\.\.\(op === 'mute' && o\.reason \? \{ reason: o\.reason \} : \{\}\)/);
    expect(CHAT!).toMatch(/const whyTail = \(m\) => \(m && m\.reason \? `\. Причина: \$\{m\.reason\}` : ''\)/);
    expect(CHAT!).toMatch(/slice\(3\)\.join\(' '\)\.slice\(0, 200\); return chatAct\('mute', \{ login: nick, n: nick, min: m, reason: why \}\)/);
  });
});

/* ================================================================== app.js: announcements, journal */
class El {
  className = ''; dataset: Record<string, string> = {}; hidden = false; children: El[] = []; textContent = ''; innerHTML = ''; attrs: Record<string, string> = {}; fns: (() => void)[] = [];
  get classList() { return { contains: (c: string) => this.className.split(/\s+/).includes(c) }; }
  setAttribute(k: string, v: string) { this.attrs[k] = v; } getAttribute(k: string) { return this.attrs[k] ?? null; }
  append(...c: El[]) { this.children.push(...c); }
  addEventListener(_t: string, f: () => void) { this.fns.push(f); } click() { for (const f of this.fns) f(); }
  all(): El[] { return this.children.flatMap((c) => [c, ...c.all()]); }
  querySelectorAll(sel: string) { const c = sel.replace(/^\./, ''); return this.all().filter((e) => e.classList.contains(c)); }
  querySelector(sel: string) { return this.querySelectorAll(sel)[0] ?? null; }
  set text(t: string) { this.textContent = t; }
}
describe('announcements (app.js guAnn, 12.11)', () => {
  it.skipIf(!APP)('the site\'s own guAnn renders the cards; readAnns reads them, closeAnn presses its × (localStorage only)', () => {
    const box = new El(); box.className = 'gu-an'; box.hidden = true;
    const hud = new El(); hud.append(box);
    // textContent = '' on the box clears its children (as the DOM does)
    Object.defineProperty(box, 'textContent', { set(v) { if (v === '') this.children = []; }, get() { return ''; } });
    const store: Record<string, string> = {};
    const c: any = {
      GU: { el: hud }, ME: { an: [{ id: 7, t: 'Стрим в 20:00 — приходите!' }, { id: 'g1', t: 'Новый сезон', g: true }, { id: 9, t: 'третье' }] },
      guAnnCity: () => true, localStorage: { getItem: (k: string) => store[k] ?? null, setItem: (k: string, v: string) => { store[k] = v; } },
      document: { createElement: () => new El() }, JSON, Array, Set, String, console,
    };
    vm.createContext(c);
    vm.runInContext(["const ANN_LS = 'lgAnnX';", /const annClosed = \(\) => [^\n]*/.exec(APP!)![0], fnSource(APP!, 'annClose'), fnSource(APP!, 'guAnn'), 'guAnn();'].join('\n'), c);
    const A = readAnns(hud as any);
    expect(A).toEqual([{ id: '7', head: 'Объявление канала', text: 'Стрим в 20:00 — приходите!', game: false }, { id: 'g1', head: 'Объявление игры', text: 'Новый сезон', game: true }]);
    expect(annKey(A)).not.toBe(annKey(A.slice(1)));
    expect(closeAnn(hud as any, '7')).toBe(true);
    expect(JSON.parse(store.lgAnnX)).toEqual(['7']);
    expect(readAnns(hud as any).map((a) => a.id)).toEqual(['g1', '9']);   // the site repainted: the next one moved up
    expect(closeAnn(hud as any, 'nope')).toBe(false);
    box.hidden = true; expect(readAnns(hud as any)).toEqual([]);           // the site hides its box: nothing in 3D either
    expect(APP!).toMatch(/window\.LGGameUi = \{[^\n]*ann: \(\) => guAnn\(\)/);
    expect(APP!).toMatch(/ES\.addEventListener\('ann'/);
  });
  it.skipIf(!APP)('journal: the «Гильдия» tab and kind are the site\'s', () => {
    const jt = /const JT = (\[[^\n]*\]);[ \t]*\n/.exec(APP!);
    expect(jt).toBeTruthy();
    const siteJT = vm.runInNewContext(jt![1]) as [string, string][];
    expect(JT.map((t) => t[0])).toEqual(siteJT.map((t) => t[0]));
    expect(JT.map((t) => t[1])).toEqual(siteJT.map((t) => t[1]));
    expect(JK.guild[1]).toBe('Гильдия');
    expect(APP!).toMatch(/guild: \{ win: 'Победа', lose: 'Поражение', tie: 'Ничья' \}/);
    expect(JRK.guild).toEqual({ win: 'Победа', lose: 'Поражение', tie: 'Ничья' });
  });
});
