/**
 * Expedition 3D adapter: FakeQuest payloads (src/quest/fake.ts) → SceneState. Every stage maps to a scene kind, the
 * chat commands are the right ones (class command, fronts, skills, vote numbers, telegraph word, boss mechanics), and
 * odd / partial / garbage payloads never throw.
 */
import { describe, it, expect } from 'vitest';
import { FakeQuest, fakeTimeline } from '../src/quest/fake';
import { adapt, Roster, biomeOf, foeArt, type SceneState } from '../src/expedition/adapter';
import { partySpots, foeSpots, frontLine, circleSpots, columnSpots } from '../src/expedition/layout';
import type { QuestPayload } from '../src/quest/model';

const run = (o: ConstructorParameters<typeof FakeQuest>[0] = {}) => {
  const roster = new Roster();
  const login = o.login || 'murka', role = o.role || 'archer';
  return fakeTimeline({ login, role, ...o }, 500).map((v) => ({ v, s: adapt(v, { login, role, roster }) }));
};
const cmdTexts = (s: SceneState) => s.cmds.map((c) => c.text);

describe('expedition adapter — FakeQuest timeline', () => {
  const tl = run();
  it('maps every stage of the fake to a scene, in order', () => {
    const kinds: string[] = [];
    for (const { s } of tl) if (kinds[kinds.length - 1] !== s.kind) kinds.push(s.kind);
    expect(kinds).toEqual(['gather', 'vote', 'travel', 'battle', 'treasure', 'rest', 'travel', 'battle', 'boss', 'loot', 'off']);
  });
  it('gather: «поход» for whoever is not in the party yet, countdown window', () => {
    const g = tl.find(({ s }) => s.kind === 'gather')!.s;
    expect(cmdTexts(g)).toContain('поход');
    expect(g.until).toBeGreaterThan(0);
    const later = tl.filter(({ s }) => s.kind === 'gather').pop()!.s;
    expect(later.inParty).toBe(true);
    expect(later.cmds[0].kind).toBe('ok');
  });
  it('vote: numbered options with labels and live counts; the winner after done', () => {
    const open = tl.filter(({ s }) => s.kind === 'vote' && !s.vote!.done);
    expect(open.length).toBeGreaterThan(5);
    const s = open[open.length - 1].s;
    expect(s.vote!.opts.map((o) => o.label)).toEqual(['Тёмный лес', 'Старый мост', 'Ущелье']);
    expect(s.cmds.filter((c) => c.kind === 'num').map((c) => c.text)).toEqual(['1', '2', '3']);
    expect(s.vote!.opts[0].votes).toBeGreaterThan(open[0].s.vote!.opts[0].votes);
    const done = tl.find(({ s }) => s.kind === 'vote' && s.vote!.done)!.s;
    expect(done.vote!.win).toBe(1);
  });
  it('travel: biome from ter, the party walks on (roster from the last battle form)', () => {
    const t1 = tl.find(({ s }) => s.kind === 'travel')!.s;
    expect(t1.biome).toBe('mound');
    const t2 = tl.filter(({ s }) => s.kind === 'travel').pop()!.s;
    expect(t2.biome).toBe('bridge');
    // after the first battle the party list carries the real logins and roles
    expect(t2.party.some((m) => m.login === 'barsik' && m.role === 'legionary')).toBe(true);
    expect(t2.party.filter((m) => m.me)).toHaveLength(1);
  });
  it('battle: stage cycle intro → party → hit → tele → tele2 → … → end with the result', () => {
    const b1 = tl.filter(({ s }) => s.kind === 'battle' && s.battle!.id === 'b1').map(({ s }) => s.battle!.stage);
    const seq: string[] = []; for (const st of b1) if (seq[seq.length - 1] !== st) seq.push(st);
    expect(seq).toEqual(['intro', 'party', 'hit', 'tele', 'tele2', 'party', 'hit', 'end']);
    const end = tl.find(({ s }) => s.battle?.stage === 'end')!.s;
    expect(end.battle!.res!.how).toBe('win');
    expect(end.battle!.foes.every((f) => f.dead)).toBe(true);
  });
  it('battle: class command (single front) and skill words', () => {
    const p = tl.find(({ s }) => s.battle?.id === 'b1' && s.battle.stage === 'party')!.s;
    expect(p.cmds[0]).toMatchObject({ kind: 'say', text: 'выстрел', note: 'твоя команда' });
    expect(cmdTexts(p)).toEqual(expect.arrayContaining(['прицел']));
    expect(p.battle!.foes.map((f) => f.art)).toEqual(['wolf', 'wolf', 'wolfLead', 'wolf']);   // the pack leader has its own model
    expect(p.battle!.foes.filter((f) => f.lead)).toHaveLength(1);
    expect(p.party.find((m) => m.me)).toBeTruthy();
  });
  it('battle: two fronts → «выстрел лево / право», my side first', () => {
    const p = tl.find(({ s }) => s.battle?.id === 'b2' && s.battle.stage === 'party')!.s;
    expect(p.battle!.multi).toBe(true);
    expect(p.battle!.fronts).toEqual(['L', 'R']);
    const says = p.cmds.filter((c) => c.kind === 'say').map((c) => c.text);
    expect(says).toEqual(expect.arrayContaining(['выстрел лево', 'выстрел право']));
    expect(p.cmds[0].note).toBe('твоя команда');
    expect(new Set(p.battle!.foes.map((f) => f.art))).toEqual(new Set(['bandit', 'banditLead', 'skeleton']));
  });
  it('battle: the telegraph word is a canvas-only «word» command; the feed is hidden meanwhile', () => {
    const t = tl.find(({ s }) => s.battle?.stage === 'tele')!.s;
    expect(t.cmds.find((c) => c.kind === 'word')!.text).toBe('щит');
    expect(t.battle!.feed).toEqual([]);
    expect(t.battle!.tele!.need).toBe(8);
  });
  it('boss: phases, the word mechanic, platforms with the one to stand on, the feint', () => {
    const boss = tl.filter(({ s }) => s.kind === 'boss').map(({ s }) => s);
    expect(boss.length).toBeGreaterThan(20);
    const word = boss.find((s) => s.boss!.mech?.how)!;
    expect(word.cmds[0]).toMatchObject({ kind: 'word', text: 'прыжок' });
    const pos = boss.find((s) => s.boss!.mech?.fam === 'position')!;
    expect(pos.boss!.zones).toHaveLength(4);
    expect(pos.boss!.zones.filter((z) => z.danger).map((z) => z.n)).toEqual([2, 3]);
    const goal = pos.boss!.zones.find((z) => z.goal)!;
    expect(goal.danger).toBe(false);
    expect(pos.cmds.some((c) => /площадке 1|прыжок/.test(c.text))).toBe(true);
    const feint = boss.find((s) => s.boss!.mech?.fake)!;
    expect(feint.cmds[0].kind).toBe('silent');
    expect(boss.some((s) => s.boss!.ph === 2 && s.boss!.adds.length > 0)).toBe(true);
    expect(boss.some((s) => s.boss!.zones.some((z) => z.gone))).toBe(true);
  });
  it('treasure / loot: rune door with the code command, the loot vote', () => {
    const tr = tl.find(({ s }) => s.kind === 'treasure' && s.trap!.st === 'act')!.s;
    expect(tr.trap!.type).toBe('code');
    expect(tr.cmds.some((c) => c.text.startsWith('код'))).toBe(true);
    expect(tl.some(({ s }) => s.kind === 'treasure' && s.trap!.win === true)).toBe(true);
    const lo = tl.find(({ s }) => s.kind === 'loot')!.s;
    expect(lo.loot!.name).toBe('Клык Гнилозуба');
  });
  it('spectator: no «my» state, generic commands, hp null', () => {
    const sp = run({ spectator: true });
    const b = sp.find(({ s }) => s.battle?.stage === 'party')!.s;
    expect(b.battle!.me.st).toBe('out');
    expect(b.party.some((m) => m.me)).toBe(false);
    expect(b.cmds.some((c) => /не в этом бою/.test(c.text))).toBe(true);
    expect(sp.every(({ s }) => s.kind !== undefined)).toBe(true);
  });
  it('setKey changes only between sets, not inside a battle', () => {
    const keys = tl.filter(({ s }) => s.battle?.id === 'b1').map(({ s }) => s.setKey);
    expect(new Set(keys).size).toBe(1);
  });
});

describe('expedition adapter — defensive', () => {
  const ctx = () => ({ login: 'me', role: 'priest', roster: new Roster() });
  const odd: unknown[] = [
    null, undefined, 0, 'x', [], { on: false }, { on: true }, { on: true, k: 'nope', n: 'many' },
    { on: true, k: 'battle', b: { id: 1, st: 'party', round: 1, form: 'bad', foes: [['X', 7]] } },
    { on: true, k: 'battle', b: { id: 'b', st: 'tele', round: 1, form: [['a', 'mage', 'Q']], foes: [['R', 'hw_ghoul', 1, 5, null]], tele: { word: 5 } } },
    { on: true, k: 'bossgen', bg: { name: 'X', ph: 1, phs: 2, hp: 2, zn: { a: [[1, 'x', 'y'], [2, [], [[0, 0]]]] }, mech: { name: 'm', fam: 'position', zones: [2] } } },
    { on: true, vote: { id: 1, title: 'Куда?', end: 1, opts: [[1, 'A', '', 'x'], 'bad', [2]] } },
    { on: true, tr: { name: 'T', type: 'ropes', st: 'act', n: 99 } }, { on: true, ev: { look: 'dice', name: 'E' } }, { on: true, sh: { items: [null, { name: 'a' }] } },
    { on: true, dgn: { vote: { opts: [[1, 'k', 'Влево', '', 3]] } } }, { on: true, lair: { is: { pick: { until: 5 }, gone: ['2'] } } },
    { on: true, loot: { name: 'L', until: 'soon' } }, { on: true, gather: {} },
  ];
  it('never throws and always yields a known kind', () => {
    for (const v of odd) {
      const s = adapt(v as QuestPayload, ctx());
      expect(typeof s.kind).toBe('string');
      expect(Array.isArray(s.cmds)).toBe(true);
    }
  });
  it('clamps foe hp, maps unknown art, keeps priests side-less', () => {
    const s = adapt({ on: true, k: 'battle', b: { id: 'b', st: 'party', round: 1, form: [['me', 'priest', 'L']], me: 0, hp: 1, foes: [['R', 'hw_ghoul', 1, 5, 'Гуль'], ['L', 'dg_rat', 0, -1, '']], cr: { fr: ['L', 'R'] } } } as any, ctx());
    expect(s.battle!.foes.map((f) => f.hp)).toEqual([1, 0]);
    expect(s.battle!.foes[0].art).toBe('ghostLead');   // unknown hw_* leader → the ghost leader
    expect(s.battle!.foes[1].art).toBe('rat');
    expect(s.cmds[0].text).toBe('лечить');
  });
  it('biomes and foe arts', () => {
    expect(['Река', 'Брод', 'Водопад', 'Старый мост', 'Курган', 'Ущелье', 'Шахта', 'Пещера', 'Данж', 'Врата башни'].map(biomeOf))
      .toEqual(['river', 'river', 'falls', 'bridge', 'mound', 'gorge', 'mine', 'cave', 'dungeon', 'gate']);
    expect(biomeOf('Тёмный лес')).toBe('forest');
    expect(biomeOf(undefined)).toBe('meadow');
    expect(['wolf', 'hw_wolf', 'dg_spider', 'dgb_skeleton', 'hw_x', 'zzz'].map((t) => foeArt(t))).toEqual(['wolf', 'wolf', 'spider', 'skeleton', 'ghost', 'slime']);
    expect(foeArt('', 'Пиявка')).toBe('drowner');
  });
});

describe('expedition layout', () => {
  const mk = (role: string, i: number) => ({ login: 'c' + i, name: '', role, zone: ({ legionary: 0, paladin: 0, rogue: 1, recruit: 1, archer: 2, mage: 2, necromancer: 2, priest: 3 } as any)[role], side: 'R' as const, shield: role === 'legionary', rank: 2, me: false, low: -1, ghost: false });
  const roles = ['priest', 'archer', 'legionary', 'rogue', 'mage', 'paladin', 'priest', 'recruit'];
  const party = Array.from({ length: 50 }, (_, i) => mk(roles[i % roles.length], i));
  it('single front: shields in front (largest x), priests at the back', () => {
    const sp = partySpots(party, ['R']);
    const meanX = (z: number) => { const xs = party.map((m, i) => (m.zone === z ? sp[i].x : NaN)).filter((x) => !isNaN(x)); return xs.reduce((a, b) => a + b, 0) / xs.length; };
    expect(meanX(0)).toBeGreaterThan(meanX(1)); expect(meanX(1)).toBeGreaterThan(meanX(2)); expect(meanX(2)).toBeGreaterThan(meanX(3));
    const keys = new Set(sp.map((s) => `${s.x.toFixed(2)},${s.z.toFixed(2)}`));
    expect(keys.size).toBe(50);   // nobody stands on somebody else
  });
  it('surrounded: wings face their side, foes beyond the front line', () => {
    const p = party.map((m, i) => ({ ...m, side: (['L', 'R', 'F'] as const)[i % 3] }));
    const sp = partySpots(p, ['L', 'R', 'F']);
    p.forEach((m, i) => { if (m.side === 'L') expect(sp[i].x).toBeLessThan(0); if (m.side === 'R') expect(sp[i].x).toBeGreaterThan(0); if (m.side === 'F') expect(sp[i].z).toBeLessThan(0); });
    const line = frontLine(sp);
    const foes = foeSpots([{ i: 0, art: 'wolf', type: 'wolf', side: 'L', lead: false, hp: 1, dead: false, name: '' }, { i: 1, art: 'wolf', type: 'wolf', side: 'F', lead: true, hp: 1, dead: false, name: '' }], line);
    expect(foes[0].x).toBeLessThan(line.L); expect(foes[1].z).toBeLessThan(line.F);
  });
  it('circle and column spots', () => {
    expect(circleSpots(30)).toHaveLength(30);
    const c = columnSpots(12); expect(c[0].x).toBeCloseTo(0); expect(c[11].x).toBeLessThan(0);
  });
});
