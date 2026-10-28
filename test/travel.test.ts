import { describe, it, expect, vi, afterEach } from 'vitest';
import { campName, pageCampName, townsView, CAMP_DEFAULT, type TownsInput } from '../src/net/town';
import { FindController, parseChannels, validLogin, channelPath, currentChannel, normQuery, FIND_DEBOUNCE_MS, type FindState } from '../src/net/travel';
import { runtimeContract, describeFails } from '../src/net/contract';
import { layoutName, TRAVEL_CHECKS } from '../src/features/travel';
import contract from '../src/data/site-contract.json';
import { campFixtureLayout } from '../dev/fixtures';
import { groundSpec, makeGroundAt } from '../src/world/ground';
import { paletteOf } from '../src/world/palette';
import { rng } from '../src/world/textures';
import { Batch } from '../src/world/batch';
import { Instancer } from '../src/world/instancer';
import { toZ } from '../src/world/coords';
import { buildStatic } from '../src/world/static';
import type { Ctx } from '../src/world/kit';
import type { SignAtlas } from '../src/world/textures';

describe('the camp is named by the channel style', () => {
  it('«Кошачий привал» for cats, «Перепутье» for every other style', () => {
    expect(campName('cats').name).toBe('Кошачий привал');
    for (const s of ['legion', 'imps', '', undefined, null, 'unknown']) expect(campName(s as string).name).toBe(CAMP_DEFAULT);
    expect(campName('cats').sub).toBe('лагерь новобранцев Легиона');
  });
  it("the style's own names.places.camp (doodle.js addNames) wins, as in city.js campName()", () => {
    const names = { imps: { places: { camp: { name: 'Чёртов привал', sub: 'дым и угли' } } }, cats: { places: { camp: { name: '   ' } } } };
    expect(campName('imps', names)).toEqual({ name: 'Чёртов привал', sub: 'дым и угли' });
    expect(campName('cats', names).name).toBe('Кошачий привал');   // empty site name → table
    expect(campName('imps', { imps: { places: { camp: { name: 'x'.repeat(100) } } } }).name).toHaveLength(40);
  });
  it('survives a hostile page object', () => {
    const win = { MDDoodle: { get active() { throw new Error('no'); } } };
    expect(pageCampName(win).name).toBe(CAMP_DEFAULT);
    expect(pageCampName({ MDDoodle: { active: 'cats', names: { cats: { places: { camp: { name: 'Кошачий привал' } } } } } }).name).toBe('Кошачий привал');
    expect(pageCampName(null).name).toBe(CAMP_DEFAULT);
  });
  it('layoutName: fair / camp by style / district by the list', () => {
    expect(layoutName({ id: 'fair', styleId: 'cats' })).toBe('Ярмарка');
    expect(layoutName({ id: 'camp', styleId: 'cats' })).toBe('Кошачий привал');
    expect(layoutName({ id: 'camp', styleId: 'legion' })).toBe('Перепутье');
    expect(layoutName({ id: 'd7', styleId: 'cats' }, 'Сосновый Брод')).toBe('Сосновый Брод');
    expect(layoutName({ id: 'd7', styleId: 'cats' })).toBe('d7');
  });
});

describe('the camp name board in the 3D world', () => {
  const build = (style: string) => {
    const L = campFixtureLayout(style);
    const spec = groundSpec(L), groundAt = makeGroundAt(spec);
    const texts: { text: string; sub?: string }[] = [];
    const signs = { add: (text: string, o: { sub?: string } = {}) => { texts.push({ text, sub: o.sub }); return { uv: [0, 0, 1, 1] as [number, number, number, number], aspect: 4 }; }, texture: null } as unknown as SignAtlas;
    const k: Ctx = { b: new Batch(14), pal: paletteOf(L.styleId), signs, inst: new Instancer(), glows: [], lights: [], bulbs: [], wires: [], rnd: rng(1234), quality: 2, lowH: spec.lowH, wallZ: spec.hasLow ? toZ(spec.wallY) : 0, colliders: [], pools: [], solids: [] };
    buildStatic(k, L, spec, groundAt, 2.75);
    return texts;
  };
  it('a cat camp has a board «Кошачий привал», another style «Перепутье»; it adds no collider or solid', () => {
    const cats = build('cats'), other = build('legion');
    expect(cats.some((t) => t.text === 'Кошачий привал')).toBe(true);
    expect(other.some((t) => t.text === 'Перепутье')).toBe(true);
    expect(other.some((t) => t.text === 'Кошачий привал')).toBe(false);
  });
});

const hero = { cp: 1, tw: 1 };
const towns = (over: Partial<TownsInput> = {}, resp?: unknown): TownsInput => ({
  resp: resp ?? { ok: true, list: [
    { id: 'd3', town: 'Медовая Падь', biome: 'meadow', danger: 1, kind: 'village', own: true, k: 1, why: 'owned' },
    { id: 'd7', town: 'Сосновый Брод', biome: 'taiga', danger: 2, kind: 'town', own: false, k: 1.5 },
    { id: 'd12', town: 'Ледяная Гавань', biome: 'ice', danger: 3, kind: 'capital', own: false, home: true, k: 2, why: 'party' },
  ] },
  hero, current: 'fair', style: 'cats', ...over,
});

describe('townsView: the site\'s town picker as data', () => {
  it('Ярмарка, the camp by style, then the district towns with icon / size / biome / prices (city.js townPick)', () => {
    const v = townsView(towns());
    expect(v.rows.map((r) => r.id)).toEqual(['fair', 'camp', 'd3', 'd7', 'd12']);
    expect(v.rows[0]).toMatchObject({ name: 'Ярмарка', icon: '🎪', sub: 'всегда открыта', current: true, disabled: false });
    expect(v.rows[1]).toMatchObject({ name: 'Кошачий привал', icon: '⛺', current: false, disabled: false });
    expect(v.rows[2]).toMatchObject({ name: 'Медовая Падь', icon: '🌾', sub: '★ деревня · луга · округ канала' });
    expect(v.rows[3].sub).toBe('★★ посёлок · тайга · цены ×1,5');
    expect(v.rows[4].sub).toBe('★★★ столица · льды · цены ×2 · край отряда · отряд в округе');
    expect(townsView(towns({ style: 'legion' })).rows[1].name).toBe('Перепутье');
  });
  it('marks the current town (camp, district) and nothing else', () => {
    expect(townsView(towns({ current: 'camp' })).rows.filter((r) => r.current).map((r) => r.id)).toEqual(['camp']);
    expect(townsView(towns({ current: 'd7' })).rows.filter((r) => r.current).map((r) => r.id)).toEqual(['d7']);
  });
  it('the camp is listed only to heroes it is open for (cp), or while standing in it', () => {
    expect(townsView(towns({ hero: { tw: 1 } })).rows.map((r) => r.id)).not.toContain('camp');
    expect(townsView(towns({ hero: { tw: 1 }, current: 'camp' })).rows.map((r) => r.id)).toContain('camp');
  });
  it('an expedition (T.quest): Ярмарка and the camp stay but greyed out with the reason, unless the squad is at the fair', () => {
    const v = townsView(towns({}, { ok: true, quest: true, fair: false, list: [{ id: 'd7', town: 'Сосновый Брод', biome: 'taiga', danger: 2, own: false, home: true, k: 1, why: 'party' }] }));
    expect(v.rows[0]).toMatchObject({ id: 'fair', disabled: true }); expect(v.rows[0].reason).toMatch(/В походе/);
    expect(v.rows[1]).toMatchObject({ id: 'camp', disabled: true });
    expect(v.rows[2]).toMatchObject({ id: 'd7', disabled: false });
    const atFair = townsView(towns({}, { ok: true, quest: true, fair: true, list: [] }));
    expect(atFair.rows[0]).toMatchObject({ disabled: false, sub: 'отряд здесь' });
  });
  it("the channel's home district drawn (hm.id, not camp): fair and camp are behind (greyed), the home town is open", () => {
    const v = townsView(towns({ hero: { cp: 1, tw: 1, hm: { id: 'd3' } }, current: 'd3' }));
    expect(v.rows.find((r) => r.id === 'fair')).toMatchObject({ disabled: true, reason: expect.stringMatching(/позади/) });
    expect(v.rows.find((r) => r.id === 'd3')).toMatchObject({ current: true, disabled: false });
    expect(townsView(towns({ hero: { cp: 1, tw: 1, hm: { id: 'd3' } } })).rows.find((r) => r.id === 'camp')).toBeUndefined();   // campOpen() is false once the district is drawn
  });
  it('a failed read is an error, never an empty list; hostile entries are dropped / stripped', () => {
    for (const bad of [null, undefined, { ok: false }, 'x']) expect(townsView({ ...towns(), resp: bad }).error).toMatch(/не загрузился/);
    const v = townsView(towns({}, { ok: true, list: [{ id: '../x', town: 'bad' }, { id: 'd9', town: '<b>Тихий</b> Берег', biome: 'weird', danger: 99 }, null, 5] }));
    expect(v.rows.map((r) => r.id)).toEqual(['fair', 'camp', 'd9']);
    expect(v.rows[2].name).toBe('bТихий/b Берег');   // no angle brackets reach the DOM layer
    expect(v.rows[2].danger).toBe(5);
    expect(v.rows[2].icon).toBe('🏘');
  });
  it('without any access the note says when district towns open', () => {
    const v = townsView(towns({ hero: {} }, { ok: true, list: [] }));
    expect(v.rows.map((r) => r.id)).toEqual(['fair']);
    expect(v.note).toMatch(/откроются/);
  });
});

describe('streamer search (start.js findInput)', () => {
  afterEach(() => { vi.useRealTimers(); });
  const mk = () => {
    vi.useFakeTimers();
    const states: FindState[] = [], calls: { q: string; signal: AbortSignal | null; done: (r: { status: number; data: unknown }) => void; fail: (e: unknown) => void }[] = [];
    const fc = new FindController({
      fetchFind: (q, signal) => new Promise((ok, no) => { calls.push({ q, signal, done: ok as never, fail: no }); }),
      onState: (s) => states.push(s),
    });
    return { fc, states, calls };
  };
  const ok = (list: unknown[]) => ({ status: 200, data: { ok: true, list } });

  it('nothing is requested until the player types; one character is "short"', () => {
    const { fc, calls } = mk();
    vi.advanceTimersByTime(5000);
    expect(calls).toHaveLength(0); expect(fc.requests).toBe(0);
    fc.input('p'); vi.advanceTimersByTime(5000);
    expect(calls).toHaveLength(0); expect(fc.state.status).toBe('short');
    fc.input('@p'); vi.advanceTimersByTime(5000);
    expect(calls).toHaveLength(0);   // a leading @ doesn't count
    fc.input('   '); expect(fc.state.status).toBe('idle');
  });
  it(`debounces by ${FIND_DEBOUNCE_MS} ms and normalises the query`, () => {
    const { fc, calls } = mk();
    fc.input('Pu'); vi.advanceTimersByTime(FIND_DEBOUNCE_MS - 10);
    expect(calls).toHaveLength(0); expect(fc.state.status).toBe('busy');
    fc.input('Pus'); vi.advanceTimersByTime(FIND_DEBOUNCE_MS - 10);
    expect(calls).toHaveLength(0);   // typing again restarted the timer
    vi.advanceTimersByTime(20);
    expect(calls.map((c) => c.q)).toEqual(['pus']);
    fc.input('@PuS'); expect(normQuery('@PuS')).toBe('pus');
  });
  it('a newer query aborts the older request and its late answer is ignored', async () => {
    const { fc, calls } = mk();
    fc.input('pu'); vi.advanceTimersByTime(FIND_DEBOUNCE_MS + 1);
    expect(calls).toHaveLength(1);
    fc.input('pus'); expect(calls[0].signal!.aborted).toBe(true);
    vi.advanceTimersByTime(FIND_DEBOUNCE_MS + 1);
    calls[0].done(ok([{ login: 'old_one', name: 'Old' }]));
    calls[1].done(ok([{ login: 'new_one', name: 'New', live: true }]));
    await vi.advanceTimersByTimeAsync(0);
    expect(fc.state.list.map((c) => c.login)).toEqual(['new_one']);
    expect(fc.state.status).toBe('ok');
  });
  it('an equal query is answered from memory (no second request)', async () => {
    const { fc, calls } = mk();
    fc.input('pu'); vi.advanceTimersByTime(FIND_DEBOUNCE_MS + 1);
    calls[0].done(ok([{ login: 'pushok', name: 'Пушок' }])); await vi.advanceTimersByTimeAsync(0);
    fc.input('PU'); vi.advanceTimersByTime(5000);
    expect(calls).toHaveLength(1); expect(fc.state.list).toHaveLength(1);
  });
  it('429 / bad answer / network error give a message, not a stuck spinner', async () => {
    const { fc, calls } = mk();
    fc.input('pu'); vi.advanceTimersByTime(FIND_DEBOUNCE_MS + 1);
    calls[0].done({ status: 429, data: { ok: false } }); await vi.advanceTimersByTimeAsync(0);
    expect(fc.state).toMatchObject({ status: 'error', err: expect.stringMatching(/Слишком часто/) });
    fc.input('pux'); vi.advanceTimersByTime(FIND_DEBOUNCE_MS + 1);
    calls[1].fail(new Error('offline')); await vi.advanceTimersByTimeAsync(0);
    expect(fc.state).toMatchObject({ status: 'error', err: expect.stringMatching(/Нет связи/) });
  });
  it('dispose aborts the pending request and drops the timer', () => {
    const { fc, calls } = mk();
    fc.input('pu'); vi.advanceTimersByTime(FIND_DEBOUNCE_MS + 1);
    fc.dispose(); expect(calls[0].signal!.aborted).toBe(true);
    const f2 = mk(); f2.fc.input('pu'); f2.fc.dispose(); vi.advanceTimersByTime(5000);
    expect(f2.calls).toHaveLength(0);
  });
});

describe('channel helpers', () => {
  it('parseChannels keeps well-formed rows only and clips text', () => {
    const rows = parseChannels([{ login: 'Mur_Cat', name: 'Мур', live: 1, hero: true, pinned: 1, viewers: 12.7 }, { login: 'a/b' }, { login: '' }, null, 3, { login: 'ok_one', name: '<i>x</i>'.repeat(30) }]);
    expect(rows[0]).toEqual({ login: 'mur_cat', name: 'Мур', live: true, hero: true, pinned: true, viewers: 12 });
    expect(rows).toHaveLength(2);
    expect(rows[1].name.length).toBeLessThanOrEqual(40); expect(rows[1].name).not.toMatch(/[<>]/);
    expect(parseChannels('nope')).toEqual([]);
    expect(parseChannels(Array.from({ length: 200 }, (_, i) => ({ login: 'c' + i })), 60)).toHaveLength(60);
  });
  it('logins that could escape the /c/<login>/ URL are refused', () => {
    for (const bad of ['a/b', '../x', 'a b', 'a?b', 'a#b', '', '..', 'x'.repeat(41), 5, null]) expect(validLogin(bad)).toBe(false);
    for (const good of ['mur_cat', 'A1', 'a.b-c']) expect(validLogin(good)).toBe(true);
    expect(channelPath('Mur_Cat')).toBe('/c/mur_cat/');
  });
  it('currentChannel reads /c/<login>/', () => {
    expect(currentChannel('/c/zakvielchannel/')).toBe('zakvielchannel');
    expect(currentChannel('/c/Some%5FOne/x')).toBe('some_one');
    expect(currentChannel('/')).toBe(''); expect(currentChannel('/c/%E0%A4%A/')).toBe('');
  });
});

describe('contract checks of the travel page', () => {
  const LIVE_KEYS = 'board,open,close,sleep,wake,onEvent,heroChanged,forgeStart,forgeFx,forgeCancel,storeRes,anvil,debug,peek,hideOthers,awb,tradeMenu,quality,town,questChanged,go,goBuilding,center,panel'.split(',');
  const mine = (contract.checks as any[]).filter((c) => TRAVEL_CHECKS.includes(c.id));
  const win = (keys: string[]) => ({ LGCity: Object.fromEntries(keys.map((k) => [k, () => 0])) });
  const doc = (sels: string[]) => ({ querySelector: (s: string) => (sels.includes(s) ? {} : null) });
  it('all three runtime checks exist, degrade only, and the static ones are in the contract', () => {
    expect(mine.map((c) => c.id).sort()).toEqual([...TRAVEL_CHECKS].sort());
    expect(mine.every((c) => c.severity === 'degrade')).toBe(true);
    const ids = (contract.checks as any[]).map((c) => c.id);
    expect(ids).toContain('/api/find'); expect(ids).toContain('/api/mylist');
    expect((contract.checks as any[]).find((c) => c.id === '/api/find').file).toBe('start.js');
  });
  it('the live page passes; losing LGCity.town / the picker DOM degrades (not breaks)', () => {
    const sels = mine.filter((c) => c.sel).map((c) => c.sel);
    expect(runtimeContract(mine, win(LIVE_KEYS), doc(sels) as any, 'city')).toEqual([]);
    const f = runtimeContract(mine, win(LIVE_KEYS.filter((k) => k !== 'town')), doc(sels.slice(1)) as any, 'city');
    expect(describeFails(f)).toEqual(['degrade LGCity (extras): LGCity.town'.replace('LGCity (extras)', 'LGCity.town (travel)'), `degrade DOM .cy-town (town picker button): ${sels[0]}`]);
    expect(f.every((x) => x.severity === 'degrade')).toBe(true);
  });
});
