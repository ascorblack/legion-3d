import { describe, it, expect } from 'vitest';
import { detectTown, readTownSignals, townLsKey } from '../src/net/town';

const doc = { querySelector: () => null } as unknown as Document;
const store = (o: Record<string, string>) => ({ getItem: (k: string) => (k in o ? o[k] : null) });

describe('site 07.11–08.11: last town per channel (lgCityTown@<channel>)', () => {
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
  it('08.11: sessionStorage uses the per-channel key and wins over localStorage', () => {
    const win = { location: { pathname: '/c/zakvielchannel/' }, sessionStorage: store({ 'lgCityTown@zakvielchannel': 'camp' }), localStorage: store({ 'lgCityTown@zakvielchannel': 'd7' }) };
    expect(readTownSignals(win, doc, null).session).toBe('camp');
  });
  it('the old plain sessionStorage key still counts; other channels are ignored', () => {
    const win = { location: { pathname: '/c/exx1dae/' }, sessionStorage: store({ lgCityTown: 'camp' }), localStorage: store({ 'lgCityTown@zakvielchannel': 'd7' }) };
    expect(readTownSignals(win, doc, null).session).toBe('camp');
    const w2 = { location: { pathname: '/c/exx1dae/' }, sessionStorage: store({}), localStorage: store({ 'lgCityTown@zakvielchannel': 'd7' }) };
    expect(readTownSignals(w2, doc, null).session).toBeNull();
  });
});
