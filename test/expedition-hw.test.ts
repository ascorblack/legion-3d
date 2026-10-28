import { describe, it, expect } from 'vitest';
import { adapt, Roster, foeArt, foeArtOf, FOE_ARTS, HW_FOES } from '../src/expedition/adapter';
import { foeGeo, FOE_TOP } from '../src/expedition/art';
import { cardOf } from '../src/quest';
import { isQuestPayload, type QuestPayload } from '../src/quest/model';

const ctx = () => ({ login: 'me', role: 'archer', roster: new Roster() });
const me = { login: 'me', role: 'archer' };

describe('Halloween gather at the portal (q.gather.hw, site 28.10)', () => {
  const v = { on: true, k: 'gather', t: 'Изнанка', n: 3, party: 'out', gather: { until: 1e15, hw: 1 } } as unknown as QuestPayload;
  it('the payload is accepted; HUD card and the 3D gather say «Сбор у портала» and the join word «портал»', () => {
    expect(isQuestPayload(v)).toBe(true);
    const c = cardOf(v as never, me, () => 'атака')!;
    expect(c.title).toContain('Сбор у портала'); expect(c.icon).toBe('🎃'); expect(c.urge).toEqual({ kind: 'say', text: 'портал' });
    const s = adapt(v, ctx());
    expect(s.kind).toBe('gather'); expect(s.hw).toBe(true);
    expect(s.status).toContain('🎃 Сбор у портала');
    expect(s.cmds[0]).toMatchObject({ kind: 'say', text: 'портал' });
  });
  it('a plain gather is unchanged; party ghost says «Твой герой — призрак»', () => {
    const p = { on: true, k: 'gather', n: 2, party: 'out', gather: { until: 1e15 } } as unknown as QuestPayload;
    expect(cardOf(p as never, me, () => 'атака')!.urge).toEqual({ kind: 'say', text: 'поход' });
    expect(adapt(p, ctx()).status).toContain('Сбор отряда');
    const g = { ...v, party: 'ghost' } as unknown as QuestPayload;
    expect(adapt(g, ctx()).cmds[0]).toMatchObject({ kind: 'info', text: 'твой герой — призрак в этом походе' });
    expect(cardOf({ on: true, k: 'map', party: 'ghost' } as never, me, () => 'атака')!.where).toContain('призрак');
  });
});

describe('hw_* foes and the Pumpkin Golem', () => {
  it('every hw_* key maps to a model; the hw_pumpkin leader is the golem, taller than a pumpkin', () => {
    for (const [k, a] of Object.entries(HW_FOES)) { expect(foeArt(k)).toBe(a); expect(FOE_ARTS).toContain(a); }
    expect(foeArtOf('hw_pumpkin', 'Тыквоголов', false)).toBe('pumpkin');
    expect(foeArtOf('hw_pumpkin', 'Тыквенный голем', true)).toBe('golem');
    expect(FOE_TOP.golem).toBeGreaterThan(FOE_TOP.pumpkin * 1.3);
    const g = foeGeo('golem'); g.computeBoundingBox();
    expect(g.boundingBox!.max.y).toBeLessThanOrEqual(FOE_TOP.golem + 0.02);   // the hp bar sits above the head
    expect(g.boundingBox!.max.y).toBeGreaterThan(FOE_TOP.golem - 0.15);
  });
  it('a battle with the golem leader', () => {
    const s = adapt({ on: true, k: 'battle', b: { id: 'b', st: 'party', round: 1, form: [], foes: [['R', 'hw_pumpkin', 1, 9, 'Тыквенный голем'], ['R', 'hw_pumpkinlet', 0, 3, 'Тыквёнок'], ['R', 'hw_crow', 0, 2, 'Ворон']], cr: { fr: ['R'] } } } as never, ctx());
    expect(s.battle!.foes.map((f) => f.art)).toEqual(['golem', 'pumpkinlet', 'crow']);
  });
});
