/**
 * Site 28.10: the Halloween NPCs of «Ночь Тыквенной Луны» (hwnpc.js / cityhw.js npcSpots → src/events/halloween/hwnpc.ts)
 * and the map puzzles (quest kind `puzzle`, q.pz → quest HUD card, expedition adapter, the 3D tablet set).
 */
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { npcPlaces, tablePlace, placeFromGeo, passLevel, npcBlocks, makeOpts, npcWorld } from '../src/events/halloween/hwnpc';
import { stageOf, kindOf, puzzleMy, puzzleTask, KINDS, type QuestPayload } from '../src/quest/model';
import { cardOf } from '../src/quest';
import { adapt, Roster } from '../src/expedition/adapter';

const SITE = '.local/site-1028-1007/hwnpc.js';

describe('Halloween NPCs (site hwnpc.js)', () => {
  it('fallback table = the Fair spots right of the Mine, with the obstacle ellipses', () => {
    const P = npcPlaces({});
    expect(P.map((p) => p.id)).toEqual(['hwshop', 'hwpass']);
    expect(P.every((p) => p.src === 'table')).toBe(true);
    const shop = P[0];
    expect(shop.door).toEqual({ x: 2805, y: 1449.8 });
    expect(shop.obst[0]).toEqual([2805, 1411.3, 79.4, 14.9]);
    expect(npcBlocks(P, 2805, 1411)).toBe(true);
    expect(npcBlocks(P, shop.door.x, shop.door.y)).toBe(false);   // the door point stays walkable
    expect(npcBlocks(P, 2960, 1460)).toBe(false);                 // the street between them
  });
  it('uses the site spots hook ([] = none) and geo() when present; bad geo falls back to the table', () => {
    expect(npcPlaces({ LGCityHW: { npcSpots: () => [] } })).toEqual([]);
    const W = { LGCityHW: { npcSpots: () => [{ id: 'hwpass', x: 3000, y: 1400 }] }, LGHwNpc: { geo: () => ({ building: { title: 'Ф', hit: [1, 2, 3, 4], door: { x: 5, y: 6 } }, obst: [{ e: [7, 8, 9, 10] }] }) } };
    const [p] = npcPlaces(W);
    expect(p).toMatchObject({ id: 'hwpass', src: 'site', title: 'Ф', door: { x: 5, y: 6 }, obst: [[7, 8, 9, 10]] });
    expect(placeFromGeo({ id: 'hwshop', x: 1, y: 2 }, { building: {}, obst: [] })).toBeNull();
    const [q] = npcPlaces({ ...W, LGHwNpc: { geo: () => { throw new Error('x'); } } });
    expect(q.src).toBe('table');
  });
  it.skipIf(!existsSync(SITE))('the fallback table matches the live site script (LGHwNpc.geo)', () => {
    const box: any = {}; box.self = box; runInNewContext(readFileSync(SITE, 'utf8'), box); const N = box.LGHwNpc;
    for (const sp of [{ id: 'hwshop' as const, x: 2805, y: 1420 }, { id: 'hwpass' as const, x: 3125, y: 1414 }]) {
      const site = placeFromGeo(sp, N.geo(sp, { lv: 3 }))!, table = tablePlace(sp);
      expect(table.hit).toEqual(site.hit); expect(table.door).toEqual(site.door); expect(table.obst).toEqual(site.obst);
    }
  });
  it('pass level = hero.hw.p clamped 0…20; make() options; metres', () => {
    expect(passLevel({ hw: { p: 7 } })).toBe(7);
    expect(passLevel({ hw: { p: 99 } })).toBe(20);
    expect(passLevel({ hw: { p: -3 } })).toBe(0);
    expect(passLevel({})).toBe(0);
    expect(passLevel(null)).toBe(0);
    const o = makeOpts(npcPlaces({}));
    expect(o.hwObst).toHaveLength(6);
    expect(o.hwB.map((b) => b.id)).toEqual(['hwshop', 'hwpass']);
    expect(o.hwB.every((b) => b.hw)).toBe(true);
    const w = npcWorld(npcPlaces({})[1]);
    expect(w.x).toBeCloseTo(31.25, 2); expect(w.base).toHaveLength(3); expect(w.h).toBeGreaterThan(2);
  });
});

describe('map puzzles (quest kind puzzle)', () => {
  const T = Date.now() + 20000;
  const pz = (o: Record<string, unknown>): QuestPayload => ({ on: true, k: 'puzzle', party: 'in', n: 5, t: 'Рунный камень', pz: { id: 1, kind: 'runes', st: 'answer', name: 'Рунный камень', icon: '🪨', how: 'Напиши число', rows: [['R', '+', 'R', '=', '8']], until: T, an: 2, prize: 'coins', coins: 15, ...o } } as QuestPayload);
  it('is a known kind; stage and kind come from q.pz', () => {
    expect(KINDS).toContain('puzzle');
    expect(stageOf(pz({}) as any)).toEqual({ s: 'puzzle', kind: 'runes' });
    expect(kindOf({ on: true, pz: { kind: 'cups', name: 'x', st: 'show' } } as any)).toBe('puzzle');
  });
  it('own answer and result (quest.js pzMy)', () => {
    expect(puzzleMy({ my: 'a:12', st: 'answer' })).toMatchObject({ ans: '12', st: '' });
    expect(puzzleMy({ my: 'ok:15|a:12', st: 'done' })).toMatchObject({ st: 'ok', coins: 15, ans: '12' });
    expect(puzzleMy({ my: 'bad:-3|a:2', st: 'done' })).toMatchObject({ st: 'bad', hp: 3, ans: '2' });
    expect(puzzleMy({ my: 'w:3', st: 'answer' }).words).toBe(3);
    expect(puzzleTask({ kind: 'runes', st: 'answer', name: '', rows: [['R', '+', 'T', '=', '5']] })).toBe('ᚱ + ᚦ = 5');
  });
  it('HUD card: what to type, the task, the answer never shown before the result', () => {
    const me = { login: 'murka', role: 'archer' }, base = () => 'удар';
    const c = cardOf(pz({}) as any, me, base)!;
    expect(c.title).toBe('Головоломка · Рунный камень');
    expect(c.urge).toEqual({ kind: 'say', text: 'Напиши число' });
    expect(c.note).toContain('ᚱ + ᚱ = 8');
    expect(cardOf(pz({ my: 'a:4' }) as any, me, base)!.urge).toEqual({ kind: 'ok', text: 'твой ответ: «4»' });
    expect(cardOf(pz({ st: 'show', showUntil: T }) as any, me, base)!.urge!.kind).toBe('info');
    const done = cardOf(pz({ st: 'done', my: 'ok:15|a:4', res: { text: 'Верно: 4', ans: '4' } }) as any, me, base)!;
    expect(done.urge!.text).toBe('Верно: 4'); expect(done.note).toContain('+15');
  });
  it('expedition adapter: puzzle scene, chat commands (buttons for cups), set key per kind', () => {
    const ctx = { login: 'murka', role: 'archer' as const, roster: new Roster() };
    const s = adapt(pz({}), ctx);
    expect(s.kind).toBe('puzzle');
    expect(s.puzzle).toMatchObject({ kind: 'runes', st: 'answer', name: 'Рунный камень', line: 'ᚱ + ᚱ = 8' });
    expect(s.cmds[0]).toMatchObject({ kind: 'say', text: 'Напиши число' });
    expect(s.setKey).toContain('puzzle');
    const cups = adapt(pz({ kind: 'cups', bt: [['Кубок 1', '1'], ['Кубок 2', '2'], ['Кубок 3', '3']], signs: ['a', 'b', 'c'] }), ctx);
    expect(cups.cmds.map((c) => c.text)).toEqual(['1', '2', '3']);
    expect(cups.setKey).not.toBe(s.setKey);
    const out = adapt({ ...pz({}), party: 'out' } as QuestPayload, ctx);
    expect(out.cmds[0].text).toBe('отвечает только отряд');
  });
});
