/**
 * Debug mode, «Сцены похода»: every expedition mock (src/debug/questMocks.ts) is a valid view the 3D adapter turns into
 * the scene it is meant to show; the 25 builders of the community userscript are all there; demo names only.
 */
import { describe, it, expect } from 'vitest';
import { QUEST_MOCKS, USERSCRIPT_IDS, MOCK_GROUPS, mockById } from '../src/debug/questMocks';
import { adapt, Roster } from '../src/expedition/adapter';
import { isQuestPayload, stageOf } from '../src/quest/model';

const O = { login: 'tester', role: 'archer', now: 1_900_000_000_000 };

describe('debug quest mocks', () => {
  it('has every userscript builder and more (≥ 40 scenes), unique ids, known groups', () => {
    for (const id of USERSCRIPT_IDS) expect(mockById(id), id).toBeTruthy();
    expect(QUEST_MOCKS.length).toBeGreaterThanOrEqual(40);
    expect(new Set(QUEST_MOCKS.map((m) => m.id)).size).toBe(QUEST_MOCKS.length);
    const groups = new Set(MOCK_GROUPS.map((g) => g.id));
    for (const m of QUEST_MOCKS) expect(groups.has(m.group), m.id).toBe(true);
    for (const g of MOCK_GROUPS) expect(QUEST_MOCKS.some((m) => m.group === g.id), g.id).toBe(true);
  });
  for (const m of QUEST_MOCKS) {
    it(`${m.id} → ${m.expect}`, () => {
      const v = m.build(O);
      expect(isQuestPayload(v)).toBe(true);
      expect(stageOf(v).s).not.toBe('off');
      const s = adapt(v, { login: O.login, role: O.role, roster: new Roster() });
      expect(s.kind).toBe(m.expect);
      if (!['travel', 'rest', 'town'].includes(m.expect)) expect(s.cmds.length).toBeGreaterThan(0);   // places: nothing to type
      if (m.id.startsWith('hw-') || m.id === 'gather-hw') expect(s.hw).toBe(true);
    });
  }
  it('the Halloween battles show the golem and hw foes', () => {
    const s = adapt(mockById('hw-golem')!.build(O), { login: O.login, role: O.role, roster: new Roster() });
    expect(s.battle!.foes.map((f) => f.art)).toContain('golem');
  });
  it('demo names only: no login but the viewer\'s own, all party logins are demo_*', () => {
    for (const m of QUEST_MOCKS) {
      const v = m.build(O) as any;
      for (const f of v.b?.form || []) expect(f[0] === O.login || String(f[0]).startsWith('demo_'), m.id + ' ' + f[0]).toBe(true);
    }
  });
});
