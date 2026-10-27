import { describe, it, expect } from 'vitest';
import { detectTown, readTownSignals, townMeta, campScene, campOpen, fairGone } from '../src/net/town';
import { runtimeContract, describeFails } from '../src/net/contract';
import contract from '../src/data/site-contract.json';
import camp from './fixtures/camp-map.json';

describe('current town detection (LGCity.where is gone since 26.10)', () => {
  it('LGCity.where(), if the site exposes it again, wins', () => {
    expect(detectTown({ where: 'd7', dom: '' })).toEqual({ id: 'd7', via: 'where' });
  });
  it('the City DOM: .cy[data-town] = camp / district, no data-town = fair', () => {
    expect(detectTown({ dom: 'camp', session: 'd3', hero: { cp: 1 } })).toEqual({ id: 'camp', via: 'dom' });
    expect(detectTown({ dom: 'd12' })).toEqual({ id: 'd12', via: 'dom' });
    expect(detectTown({ dom: '', session: 'camp', hero: { cp: 1 } })).toEqual({ id: 'fair', via: 'dom' });
  });
  it('while the town is being prepared (no .cy): picker → sessionStorage → hero flags, like city.js open()', () => {
    expect(detectTown({ picker: 'd4', session: 'camp', hero: { cp: 1 } }).id).toBe('d4');
    expect(detectTown({ session: 'camp', hero: { cp: 1 } })).toEqual({ id: 'camp', via: 'session' });
    expect(detectTown({ session: 'camp', hero: { cp: 0 } }).id).toBe('fair');   // camp closed for this hero
    expect(detectTown({ session: 'd2', hero: { tw: 1 } }).id).toBe('d2');
    expect(detectTown({ session: 'd2', hero: {} }).id).toBe('fair');           // no district access
    expect(detectTown({ hero: { hm: { id: 'x', camp: 1 } } })).toEqual({ id: 'camp', via: 'hero' });   // Prologue: camp
    expect(detectTown({ session: 'camp', hero: { hm: { id: 'd9' } } })).toEqual({ id: 'd9', via: 'hero' });   // drawn home district
    expect(detectTown({ hero: { cp: 1, hm: null } })).toEqual({ id: 'fair', via: 'default' });   // test account today
  });
  it('fairGone / campOpen mirror city.js', () => {
    expect(fairGone({ hm: { id: 'd1' } })).toBe(true);
    expect(fairGone({ hm: { id: 'd1', camp: 1 } })).toBe(false);
    expect(campOpen({ cp: 1 })).toBe(true);
    expect(campOpen({ cp: 1, hm: { id: 'd1' } })).toBe(false);
  });
  it('reads the signals from a page', () => {
    const doc = {
      querySelector: (sel: string) => sel === '#tab-city .cy' ? { dataset: { town: 'camp' } } : null,
    } as unknown as Document;
    const win = { LGCity: { go() {} }, sessionStorage: { getItem: () => 'camp' } };
    expect(readTownSignals(win, doc, { cp: 1 })).toEqual({ where: null, dom: 'camp', picker: null, session: 'camp', hero: { cp: 1 } });
    const doc2 = { querySelector: () => null } as unknown as Document;
    expect(detectTown(readTownSignals({}, doc2, null))).toEqual({ id: 'fair', via: 'default' });
  });
  it('townMeta: finished constructions become levels (city.js townMeta)', () => {
    const t = { id: 'd1', levels: { forge: 1 }, building: { forge: { to: 2, until: 100 }, hall: { to: 3, until: 5000 } } };
    expect(townMeta(t, 1000)).toMatchObject({ levels: { forge: 2 }, building: { hall: { to: 3, until: 5000 } } });
  });
  it('campScene copies the camp layout fields', () => {
    const c = campScene(camp)!;
    expect(c.tents).toHaveLength(9);
    expect(c.spawn).toEqual(camp.spawn);
    expect(c.fence.y).toBe(camp.FENCE.y);
    expect(campScene({})).toBeNull();
  });
});

describe('runtime site contract (boot guard)', () => {
  const page = (cityKeys: string[], dom: string[] = []) => ({
    win: {
      LGCity: Object.fromEntries(cityKeys.map((k) => [k, () => 0])),
      LGCityMap: { make() {}, makeFrom() {}, follow() {}, stepAlong() {}, QW: 1800, LOW: {}, BUILDINGS: [] },
      LGCityArt: { quarter() {}, lower() {} }, MDDoodle: { defaultsFor() {}, location() {}, active: 'cats' },
      LGGameData: { baseCmd() {} }, LGInventory: { art() {} },
    },
    doc: { querySelector: (s: string) => (dom.includes(s) ? {} : null) },
  });
  const ALL_DOM = (contract.checks as any[]).filter((c) => c.kind === 'dom').map((c) => c.sel);
  const LIVE_KEYS = 'board,open,close,sleep,wake,onEvent,heroChanged,forgeStart,forgeFx,forgeCancel,storeRes,anvil,debug,peek,hideOthers,awb,tradeMenu,quality,town,questChanged,go,goBuilding,center,panel'.split(',');
  it('the live LGCity of 27.10 (no where/towns) passes', () => {
    const p = page(LIVE_KEYS, ALL_DOM);
    expect(runtimeContract(contract.checks as any, p.win, p.doc as any, 'city')).toEqual([]);
  });
  it('a missing core method breaks, a missing extra degrades; lazy scripts are skipped until loaded', () => {
    const p = page(LIVE_KEYS.filter((k) => k !== 'go' && k !== 'quality'), ALL_DOM);
    const f = runtimeContract(contract.checks as any, p.win, p.doc as any, 'city');
    expect(describeFails(f)).toEqual(['BREAK LGCity (core): LGCity.go', 'degrade LGCity (extras): LGCity.quality']);
    (p.win as any).LGCampMap = { get() {} };
    expect(runtimeContract(contract.checks as any, p.win, p.doc as any, 'city').map((x) => x.id)).toContain('LGCampMap');
  });
  it("phase 'page' does not ask for the City yet", () => {
    const p = page([], ['#tab-city', '.tabs button[data-tab="city"]']);
    delete (p.win as any).LGCity;
    expect(runtimeContract(contract.checks as any, p.win, p.doc as any, 'page')).toEqual([]);
  });
});
