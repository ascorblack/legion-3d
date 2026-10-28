import { describe, it, expect, vi } from 'vitest';
import live1 from './fixtures/quest-live-1.json';
import live2 from './fixtures/quest-live-2.json';
import { adapt, Roster } from '../src/expedition/adapter';
import { cardOf } from '../src/quest';
import { isQuestPayload, DelayBuffer, mergeOwn, eventInstructions, type QuestPayload } from '../src/quest/model';
import { QUEST_MOCKS } from '../src/debug/questMocks';

const streams = [live1, live2] as unknown as { t: number; data: QuestPayload }[][];
const me = { login: 'player1', role: 'archer' };
const ctx = () => ({ ...me, roster: new Roster() });
describe('sanitized live q recordings (2026-10-28)', () => {
  for (const [id, recording] of [['spectator', streams[0]], ['queue', streams[1]]] as const) {
    it(`replays every ${id} frame through guard, delay buffer, HUD and adapter without dropping blocks`, () => {
      const c = ctx(), buffer = new DelayBuffer(), warn = vi.spyOn(console, 'warn');
      for (const { t, data } of recording) {
        expect(isQuestPayload(data)).toBe(true);
        const q = data as QuestPayload;
        const s = adapt(q, c);
        expect(s.kind === 'off').toBe(!q.on);
        if (q.b) { expect(s.battle).not.toBeNull(); expect(s.battle!.foes.length).toBe(q.b.foes.length); expect(s.battle!.res?.how).toBe(q.b.res?.how); }
        if (q.tr) { expect(s.trap).not.toBeNull(); expect(s.trap!.st).toBe(q.tr.st); expect(s.kind).toBe('treasure'); }
        if (q.lair) expect(s.lair).not.toBeNull();
        expect(() => cardOf(q, me, () => 'выстрел')).not.toThrow();
        if (q.on) expect(cardOf(q, me, () => 'выстрел')).not.toBeNull();
        buffer.push(q, t); const delayed = buffer.pick(t + 4000);
        expect(() => adapt(delayed, c)).not.toThrow();
      }
      expect(warn).not.toHaveBeenCalled(); warn.mockRestore();
    });
  }
  it('preserves queue membership and real treasure type when the live name is absent', () => {
    for (const {data} of streams[1]) if (data.on) expect(adapt(data as QuestPayload, ctx()).partyState).toBe('q');
    const q = streams[0].find(e => e.data.tr?.st === 'act')!.data as QuestPayload;
    const s = adapt(q, ctx()); expect(s.trap!.len).toBe(4); expect(s.trap!.max).toBe(6);
    expect(s.cmds.some(c => /повтор/.test(c.note || c.text))).toBe(true);
  });
  it('sanitized fixtures contain only playerN identities and no cityChat, test or feed fields', () => {
    for (const recording of streams) for (const {data: q} of recording) {
      if (q.roll) expect(q.roll.by).toMatch(/^player\d+$/);
      for (const p of q.b?.form || []) expect(p[0]).toMatch(/^player\d+$/);
      for (const p of q.tr?.best || []) expect(p[2]).toMatch(/^player\d+$/);
      expect(q).not.toHaveProperty('test'); expect(q.b || {}).not.toHaveProperty('fd');
    }
  });
});

describe('new event and puzzle reader contract', () => {
  it('all new mocks are guarded and have matching HUD/3D instructions', () => {
    for (const m of QUEST_MOCKS.filter(m => /^(hw-(trick|fortune|cauldron|lostghost|skeldance)|gob-|pz-)/.test(m.id))) {
      const q = m.build({ ...me, now: 100_000 }); expect(isQuestPayload(q), m.id).toBe(true);
      const s = adapt(q, ctx()); expect(s.kind, m.id).toBe(m.expect);
      expect(cardOf(q, me, () => 'выстрел'), m.id).not.toBeNull();
      if (q.ev) expect(s.cmds, m.id).toEqual(eventInstructions(q.ev, q.party).cmds);
    }
  });
  it('reveals dance steps at shown timestamp + stream delay, never the input solution', () => {
    const cur: QuestPayload = { on: true, dl: 4, ev: { id: 1, hw: true, look: 'skeldance', name: 'Пляска', st: 'show', sq: [['l', 1000]] } };
    const newest: QuestPayload = { ...cur, ev: { ...cur.ev!, sq: [['l', 1000], ['r', 2000], ['j', 3000]] } };
    expect(mergeOwn(cur, newest, 6000).ev!.sq).toEqual([['l', 1000], ['r', 2000]]);
    const s = adapt({ ...newest, ev: { ...newest.ev!, st: 'input' } }, ctx());
    expect(s.event!.steps).toEqual([]); expect(s.cmds.some(c => c.text === 'влево вправо прыг')).toBe(false);
  });
  it('merges only own goblin vote/bet/answer, keeps delayed payout and different games separate', () => {
    const cur: QuestPayload = { on: true, ev: { id: 1, gob: true, look: 'goblin', name: 'Ярмарка', st: 'guess', g: 1, me: ['', 0, '', '', 0, 0, 0] } };
    const newest: QuestPayload = { ...cur, ev: { ...cur.ev!, st: 'reveal', me: ['да', 20, '2', 'win', 40, 40, 1] } };
    expect(mergeOwn(cur, newest).ev!.me).toEqual(['да', 20, '2', '', 0, 0, 0]);
    newest.ev!.g = 2; expect(mergeOwn(cur, newest).ev!.me).toEqual(['да', 0, '', '', 0, 0, 0]);
  });
  it('cauldron accepts more ingredients after my response; all bt choices remain visible', () => {
    const E = { look: 'cauldron', hw: true, name: 'Котёл', st: 'ingr', my: 'тыква', bt: [['Гриб', 'гриб'], ['Соль', 'соль']] as [string, string][] };
    expect(eventInstructions(E, 'in').cmds.map(c => c.text)).toEqual(['гриб', 'соль']);
  });
});

describe('rune door 2 replay contract', () => {
  const q = (): QuestPayload => ({ on: true, k: 'treasure', party: 'in', tr: { type: 'code', st: 'act', tre: 1, len: 4, max: 6, per: 3, acted: true, rd2: { door: 1, left: 2, my: '' } } });
  it('still permits multiple attempts after acted, stops when left reaches zero, and supports take/next voting', () => {
    const v = q(); expect(adapt(v, ctx()).cmds.some(c => c.text.startsWith('код '))).toBe(true);
    v.tr!.rd2!.left = 0; expect(adapt(v, ctx()).cmds[0].text).toMatch(/попытки кончились/);
    v.tr!.rd2!.ph = 'vote'; expect(adapt(v, ctx()).cmds.map(c => c.text)).toEqual(['забрать', 'дальше']);
  });
  it('merges own attempts/vote but does not jump ahead to the next door or result', () => {
    const cur = q(), newest = q(); newest.tr!.rd2 = { door: 2, left: 1, my: 'next', ph: 'vote' };
    const merged = mergeOwn(cur, newest); expect(merged.tr!.rd2).toEqual({ door: 1, left: 1, my: 'next' });
  });
});
