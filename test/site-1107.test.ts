import { describe, it, expect } from 'vitest';
import { detectTown, readTownSignals, townLsKey } from '../src/net/town';

const doc = { querySelector: () => null } as unknown as Document;
const store = (o: Record<string, string>) => ({ getItem: (k: string) => (k in o ? o[k] : null) });

describe('site 07.11: last town kept in localStorage per channel', () => {
  it('townLsKey mirrors city.js townLs()', () => {
    expect(townLsKey('/c/ZakvielChannel/')).toBe('lgCityTown@zakvielchannel');
    expect(townLsKey('/')).toBe('lgCityTown@-');
  });
  it('a fresh tab (no sessionStorage) falls back to localStorage', () => {
    const win = { location: { pathname: '/c/zakvielchannel/' }, sessionStorage: store({}), localStorage: store({ 'lgCityTown@zakvielchannel': 'd7' }) };
    const s = readTownSignals(win, doc, null);
    expect(s.session).toBe('d7');
    expect(detectTown({ ...s, hero: { tw: 1 } as any }).id).toBe('d7');
  });
  it('sessionStorage still wins; other channels are ignored', () => {
    const win = { location: { pathname: '/c/exx1dae/' }, sessionStorage: store({ lgCityTown: 'camp' }), localStorage: store({ 'lgCityTown@zakvielchannel': 'd7' }) };
    expect(readTownSignals(win, doc, null).session).toBe('camp');
    const w2 = { location: { pathname: '/c/exx1dae/' }, sessionStorage: store({}), localStorage: store({ 'lgCityTown@zakvielchannel': 'd7' }) };
    expect(readTownSignals(w2, doc, null).session).toBeNull();
  });
});
