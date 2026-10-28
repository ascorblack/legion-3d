/**
 * Structured event / puzzle data for the 28.10 sets (src/expedition/adapter.ts): goblin reveal `event.res`, the lost ghost's riddle,
 * puzzle items / letter / got / goal — and the HUD text fixes (Russian ingredient names, no doubled title, no hilo note in other games,
 * typed-puzzle instruction without «»).
 */
import { describe, it, expect } from 'vitest';
import { adapt, Roster, revealOf } from '../src/expedition/adapter';
import { mockById } from '../src/debug/questMocks';
import { eventInstructions, ingName } from '../src/quest/model';
import type { QuestPayload } from '../src/quest/model';

const ctx = () => ({ login: 'murka', role: 'archer', roster: new Roster() });
const merge = (a: any, b: any): any => {
  if (!b || typeof b !== 'object' || Array.isArray(b)) return b;
  const o = { ...(a || {}) }; for (const k of Object.keys(b)) o[k] = merge(a ? a[k] : undefined, b[k]); return o;
};
const mock = (id: string, patch: object = {}) => adapt(merge(mockById(id)!.build({ login: 'murka', role: 'archer', now: Date.now() }), patch) as QuestPayload, ctx());

describe('event / puzzle structured fields', () => {
  it('goblin reveal: event.res only in reveal / next, from rv (structured fields first, else the line)', () => {
    expect(mock('gob-shell').event!.res).toBeNull();                                         // guess: no result yet
    expect(mock('gob-shell', { ev: { st: 'reveal', rv: { text: 'Шарик под третьим стаканом' } } }).event!.res).toEqual({ cup: 3, face: '', card2: '' });
    expect(mock('gob-shell', { ev: { st: 'next', rv: { text: 'что-то', cup: 2 } } }).event!.res!.cup).toBe(2);
    expect(mock('gob-coin', { ev: { st: 'reveal', rv: { gk: 'coin', text: 'Выпала решка' } } }).event!.res).toEqual({ cup: 0, face: 't', card2: '' });
    expect(mock('gob-coin', { ev: { st: 'reveal', rv: { gk: 'coin', text: '?', face: 'орёл' } } }).event!.res!.face).toBe('h');
    expect(mock('gob-hilo', { ev: { st: 'reveal', rv: { gk: 'hilo', text: 'Открыта дама — больше' } } }).event!.res!.card2).toBe('Д');
    expect(mock('gob-hilo', { ev: { st: 'reveal', hl: { c2: '10' }, rv: { gk: 'hilo', text: 'итог' } } }).event!.res!.card2).toBe('10');
    expect(mock('hw-trick').event!.res).toBeNull();                                           // not a goblin game
    expect(revealOf('coin', 'Орёл или решка · Выпал орёл').face).toBe('h');
  });
  it('lost ghost: the public riddle and its number', () => {
    expect(mock('hw-lostghost').event).toMatchObject({ q: 'Без рук, а ворота открывает?', qi: 1, qn: 3 });
  });
  it('puzzle: items (every stage), letter / got / goal straight from the view', () => {
    for (const st of ['show', 'answer', 'done']) expect(mock('pz-changed', { pz: { st } }).puzzle!.items, st).toBe(6);
    expect(mock('pz-changed', { pz: { items: undefined } }).puzzle!.items).toBe(4);           // no items: the buttons count
    expect(mock('pz-letter').puzzle).toMatchObject({ letter: 'К', got: 3, goal: 10 });
  });
});

describe('HUD text fixes', () => {
  it('cauldron: Russian ingredient names as the site shows them', () => {
    expect(ingName('pumpkin')).toBe('тыква'); expect(ingName('odd')).toBe('odd');
    const s = mock('hw-cauldron', { ev: { picked: ['pumpkin', 'mushroom'] } });
    expect(s.event!.text).toContain('В котле: тыква, мухомор');
    expect(s.event!.text).not.toMatch(/pumpkin|mushroom/);
  });
  it('the top bar does not repeat the title (event / puzzle status = the stage only)', () => {
    const e = mock('hw-cauldron');
    expect(e.title).toBe('Ведьмин котёл'); expect(e.status).not.toContain('Ведьмин котёл');
    const p = mock('pz-count');
    expect(p.status).not.toContain(p.title);
  });
  it('the hilo card note only for the hilo game', () => {
    const v = mockById('gob-shell')!.build({ login: 'murka', role: 'archer', now: 0 }) as any;
    expect(eventInstructions(v.ev, 'in').text).not.toContain('Карта 7');
    expect(eventInstructions({ ...v.ev, gk: 'hilo' }, 'in').text).toContain('Карта 7');
  });
  it('typed puzzle: the instruction is shown as is, never as a «chat line» (no nested quotes)', () => {
    const c = mock('pz-letter').cmds[0];
    expect(c).toMatchObject({ kind: 'info', text: 'Слово на «К»' });
  });
});
