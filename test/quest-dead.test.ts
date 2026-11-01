import { describe, it, expect } from 'vitest';
import { deadIn } from '../src/quest/model';
import { cardOf } from '../src/quest';
import { adapt, Roster } from '../src/expedition/adapter';

const me = { login: 'player1', role: 'archer' };
const battle = (hp: number, extra: Record<string, unknown> = {}) => ({ on: true, k: 'battle', t: 'Бой', ter: 'Лес', n: 10, party: 'in', b: { st: 'party', round: 2, hp, me: 0, form: [['player1', 'archer', 'R']], title: 'Волки', ...extra } });

describe('site 31.10: fallen hero (quest.js deadIn)', () => {
  it('detects death in a battle and in a boss fight', () => {
    expect(deadIn(battle(0))).toEqual({ rev: true });
    expect(deadIn(battle(0, { gb: 1 }))).toEqual({ rev: false });
    expect(deadIn(battle(5))).toBeNull();
    expect(deadIn(battle(0, { st: 'end' }))).toBeNull();
    expect(deadIn({ on: true, bg: { st: 'fight', in: 1, my: 0 } })).toEqual({ rev: false });
    expect(deadIn({ on: true, bg: { st: 'fight', in: 1, my: 30 } })).toBeNull();
  });
  it('card and 3D commands say «Пал в бою» and nothing to type', () => {
    const c = cardOf(battle(0) as any, me, () => 'выстрел');
    expect(c?.urge?.text).toMatch(/Пал в бою/);
    const s = adapt(battle(0) as any, { ...me, roster: new Roster() });
    expect(s.cmds).toHaveLength(1);
    expect(s.cmds[0].text).toMatch(/Пал в бою/);
  });
});
