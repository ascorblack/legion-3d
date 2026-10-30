import { describe, it, expect } from 'vitest';
import { FakeQuest, fakeTimeline, rebase } from '../src/quest/fake';
import {
  isQuestPayload, isBattle, stageOf, kindOf, normBattle, meIn, cmdFor, secondsLeft, delayS, mergeOwn, DelayBuffer,
  frontsFor, camFor, zoneOf, arenaFormation, arenaFoes, KINDS, type QuestPayload,
} from '../src/quest/model';
import { cardOf } from '../src/quest';

const base = (r: string) => ({ archer: 'выстрел', mage: 'магия', priest: 'лечить', necromancer: 'магия' } as Record<string, string>)[r] || 'удар';
const TL = fakeTimeline({ login: 'murka', role: 'archer', seed: 7 }, 250);
const on = TL.filter((v) => v.on);

describe('fake expedition payloads', () => {
  it('every payload passes the type guard', () => {
    for (const v of TL) expect(isQuestPayload(v), JSON.stringify(v).slice(0, 300)).toBe(true);
  });
  it('is deterministic for a seed', () => {
    const a = new FakeQuest({ seed: 3 }), b = new FakeQuest({ seed: 3 });
    for (const t of [0, 21_000, 60_000, 150_000]) expect(JSON.stringify(a.at(t))).toBe(JSON.stringify(b.at(t)));
  });
  it('runs the full lifecycle in order and ends with {on:false}', () => {
    const seq: string[] = [];
    for (const v of TL) { const s = v.on ? String(v.k) : 'off'; if (seq[seq.length - 1] !== s) seq.push(s); }
    expect(seq).toEqual(['gather', 'map', 'travel', 'battle', 'treasure', 'rest', 'travel', 'battle', 'bossgen', 'map', 'off']);
    expect(TL[TL.length - 1].on).toBe(false);
    for (const v of on) expect(KINDS as readonly string[]).toContain(v.k);
  });
  it('party has ~12 cats, no playerN names, me included', () => {
    const b = on.find((v) => v.b)!.b!;
    expect(b.form.length).toBeGreaterThanOrEqual(12);
    for (const p of b.form) expect(p[0]).not.toMatch(/^player\d/i);
    expect(b.form[b.me!][0]).toBe('murka');
  });
  it('the existing HUD card renders every live payload', () => {
    for (const v of on) expect(cardOf(v as any, { login: 'murka', role: 'archer' }, base)).not.toBeNull();
  });
  it('spectator view: not in party, not on screen', () => {
    for (const v of fakeTimeline({ spectator: true }, 1000).filter((x) => x.on)) {
      expect(v.party).not.toBe('in');
      if (v.b) { expect(v.b.hp).toBeNull(); expect(meIn(v.b).st).toBe('out'); }
    }
  });
});

describe('quest.js-derived invariants on the fake', () => {
  it('battle: foe hp in [0,1], non-increasing within a battle, all dead at the end with a win', () => {
    const last = new Map<string, number[]>();
    for (const v of on) {
      const b = v.b; if (!b || b.gb) continue;
      expect(isBattle(b)).toBe(true);
      const hp = b.foes.map((f) => f[3]);
      for (const h of hp) { expect(h).toBeGreaterThanOrEqual(0); expect(h).toBeLessThanOrEqual(1); }
      const prev = last.get(String(b.id)); if (prev) hp.forEach((h, i) => expect(h).toBeLessThanOrEqual(prev[i] + 1e-9));
      last.set(String(b.id), hp);
      if (b.st === 'end') { expect(hp.every((h) => h === 0)).toBe(true); expect(b.res?.how).toBe('win'); }
    }
    expect(last.size).toBe(2);
  });
  it('timed windows (party / tele / vote / gather / loot) close after the snapshot', () => {
    for (const v of on) {
      if (v.b && (v.b.st === 'party' || v.b.st === 'tele')) expect(v.b.until!).toBeGreaterThan(v.at!);
      if (v.vote && !v.vote.done) expect(v.vote.end).toBeGreaterThan(v.at!);
      if (v.gather) expect(v.gather.until).toBeGreaterThan(v.at!);
      if (v.loot) expect(v.loot.until).toBeGreaterThan(v.at!);
    }
  });
  it('tele carries a word and got ≤ need; own turn only during party', () => {
    for (const v of on) {
      const b = v.b; if (!b) continue;
      if (b.st === 'tele') { expect(b.tele?.word).toBeTruthy(); expect(b.tele!.got!).toBeLessThanOrEqual(b.tele!.need!); }
      if (b.turn) expect(b.st).toBe('party');
    }
  });
  it('surrounded battle: cr.fr from the roll, every foe and hero side is one of the fronts', () => {
    const v = on.find((x) => x.b && x.b.cr && x.b.cr.fr.length > 1)!;
    expect(v.b!.cr!.fr).toEqual(frontsFor(v.roll!.n));
    const s = normBattle(v.b!, 'archer');
    expect(s.multi).toBe(true);
    for (const f of s.foes) expect(s.fronts).toContain(f.side);
    for (const h of s.heroes) expect(s.fronts).toContain(h.side);
    expect(s.cmd).toMatch(/^выстрел (лево|право)$/);
  });
  it('vote: options numbered 1..n, my vote is one of them, winner when done', () => {
    for (const v of on) {
      if (!v.vote) continue;
      expect(v.vote.opts.map((o) => o[0])).toEqual(v.vote.opts.map((_, i) => i + 1));
      if (v.vote.my != null) expect(v.vote.opts.map((o) => o[0])).toContain(v.vote.my);
      if (v.vote.done) expect(v.vote.win).toBeDefined();
    }
  });
  it('generated boss: b.gb together with bg, hp in [0,1], mech has a name and a deadline', () => {
    const boss = on.filter((v) => v.bg);
    expect(boss.length).toBeGreaterThan(10);
    for (const v of boss) {
      expect(v.b?.gb).toBeTruthy();
      expect(v.bg!.hp).toBeGreaterThanOrEqual(0); expect(v.bg!.hp).toBeLessThanOrEqual(1);
      expect(v.bg!.ph).toBeLessThanOrEqual(v.bg!.phs);
      if (v.bg!.mech) { expect(v.bg!.mech.name).toBeTruthy(); expect(v.bg!.mech.until!).toBeGreaterThan(v.at!); }
      expect(stageOf(v)).toEqual({ s: 'battle', boss: true });
    }
    expect(boss.some((v) => v.bg!.mech?.fake)).toBe(true);
    expect(boss.some((v) => v.bg!.mech?.fam === 'position' && v.bg!.zn)).toBe(true);
  });
});

describe('model helpers', () => {
  it('stage precedence follows the site tab (layAct)', () => {
    expect(stageOf(null)).toEqual({ s: 'off' });
    expect(stageOf({ on: false })).toEqual({ s: 'off' });
    expect(stageOf({ on: true, b: { id: 1, round: 1, st: 'party', form: [], foes: [] }, tr: { name: 'x' } })).toEqual({ s: 'battle', boss: false });
    expect(stageOf({ on: true, tr: { name: 'x', tre: true }, vote: { id: 1, title: 't', end: 1, opts: [] } })).toEqual({ s: 'trap', treasure: true });
    expect(stageOf({ on: true, k: 'rest' })).toEqual({ s: 'place', kind: 'rest' });
    expect(stageOf({ on: true, vote: { id: 1, title: 't', end: 1, done: true, opts: [] }, k: 'map' })).toEqual({ s: 'place', kind: 'map' });
    expect(kindOf({ on: true, gather: { until: 1 } })).toBe('gather');
  });
  it('meIn: hp null/0/<0 → out/dead/fled; index → on with side; mf → on', () => {
    const b = { id: 1, round: 1, st: 'party', form: [['a', 'archer', 'L']] as any, foes: [] };
    expect(meIn({ ...b, hp: null, me: -1 }).st).toBe('out');
    expect(meIn({ ...b, hp: 0, me: 0 }).st).toBe('dead');
    expect(meIn({ ...b, hp: -1, me: 0 }).st).toBe('fled');
    expect(meIn({ ...b, hp: 0.5, me: 0 })).toMatchObject({ st: 'on', side: 'L', role: 'archer' });
    expect(meIn({ ...b, hp: 0.5, me: -1, mf: ['mage', 'R'] })).toMatchObject({ st: 'on', side: 'R', role: 'mage' });
    expect(meIn({ ...b, hp: 0.5, me: -1 }).st).toBe('reserve');
  });
  it('cmdFor: side only on multi fronts and never for healers', () => {
    expect(cmdFor('archer', 'L', true)).toBe('выстрел лево');
    expect(cmdFor('archer', 'L', false)).toBe('выстрел');
    expect(cmdFor('priest', 'F', true)).toBe('лечить');
    expect(cmdFor('paladin', 'F', true)).toBe('удар вдали');
  });
  it('time left counts the stream delay; dl+adj clamps at 0', () => {
    expect(delayS({ dl: 4 }, -10)).toBe(0);
    expect(delayS({ dl: 4 }, 2)).toBe(6);
    expect(secondsLeft(10_000, 4, 10_000)).toBe(4);
    expect(secondsLeft(10_000, 0, 10_001)).toBe(0);
  });
  it('DelayBuffer shows the delayed view but own vote at once', () => {
    const buf = new DelayBuffer();
    const v1: QuestPayload = { on: true, dl: 5, at: 0, vote: { id: 1, title: 'Куда идём?', end: 9e9, opts: [[1, 'A', '', 0], [2, 'B', '', 0]] } };
    const v2: QuestPayload = { on: true, dl: 5, at: 3000, vote: { id: 1, title: 'Куда идём?', end: 9e9, my: 2, opts: [[1, 'A', '', 7], [2, 'B', '', 9]] } };
    buf.push(v1, 0); buf.push(v2, 3000);
    const s = buf.pick(5500)!;
    expect(s.vote!.opts[1][3]).toBe(0);    // counts still delayed
    expect(s.vote!.my).toBe(2);            // own vote at once
    expect(buf.pick(8100)!.vote!.opts[1][3]).toBe(9);
    buf.push({ on: false }, 9000); expect(buf.pick(9000)!.on).toBe(false);
  });
  it('mergeOwn keeps the delayed turn if the round changed', () => {
    const b = (round: number, turn?: string) => ({ id: 'x', round, st: 'party', form: [], foes: [], ...(turn ? { turn } : {}) });
    expect(mergeOwn({ on: true, b: b(1) }, { on: true, b: b(1, 'ranged') }).b!.turn).toBe('ranged');
    expect(mergeOwn({ on: true, b: b(1) }, { on: true, b: b(2, 'ranged') }).b!.turn).toBeUndefined();
  });
  it('crowd rules: fronts by roll, camera by fighters, zones by class', () => {
    expect(frontsFor(1)).toEqual(['L', 'R', 'F']); expect(frontsFor(5)).toEqual(['L', 'R']); expect(frontsFor(12)).toEqual(['R']);
    expect(camFor(40)).toBe(1); expect(camFor(200)).toBeCloseTo(0.6, 1); expect(camFor(1000, 200, 'Пещера')).toBeCloseTo(0.774, 2);
    expect([zoneOf('legionary'), zoneOf('rogue'), zoneOf('mage'), zoneOf('priest')]).toEqual([0, 1, 2, 3]);
  });
  it('arena formation: one slot per hero; shields closer to the enemy than priests', () => {
    const v = on.find((x) => x.b && x.b.cr!.fr.length === 1 && !x.b.gb)!;
    const s = normBattle(v.b!, 'archer'), slots = arenaFormation(s.heroes, s.fronts);
    expect(slots.length).toBe(s.heroes.length);
    const xs = (z: number) => slots.filter((p) => p.zone === z).map((p) => p.x);
    expect(Math.min(...xs(0))).toBeGreaterThan(Math.max(...xs(3)));
    const ring = on.find((x) => x.b && x.b.cr!.fr.length > 1)!, s2 = normBattle(ring.b!, 'archer');
    const r2 = arenaFormation(s2.heroes, s2.fronts);
    expect(r2.every((p) => p && Number.isFinite(p.x) && Number.isFinite(p.z))).toBe(true);
    expect(arenaFoes(s2.foes).every((p) => Number.isFinite(p.x))).toBe(true);
  });
  it('rebase shifts every server timestamp', () => {
    const v = rebase({ on: true, at: 1, now: 1, b: { until: 5, round: 1 }, late: [[2, 'x', 3]] }, 100) as any;
    expect([v.at, v.now, v.b.until, v.late[0][0], v.b.round]).toEqual([101, 101, 105, 102, 1]);
  });
});

describe('mergeOwn: lair words that reached the stream (site 30.10 anti-bot, quest.js view())', () => {
  const lair = (o: object) => ({ on: true, lair: { phase: 1, round: 2, ...o } }) as never;
  it('takes the telegraph word / spell phrase from the freshest view of the same event, clears hid', () => {
    const cur = lair({ tele: { id: 7, hid: 1, got: 1, need: 8 }, spell: { id: 3, hid: 1, until: 5 }, mass: { id: 9, hid: 1 } });
    const fresh = lair({ tele: { id: 7, word: 'щит', ok: false }, spell: { id: 3, words: ['раз', 'два'], until: 5 }, mass: { id: 9, words: ['все'] } });
    const v = mergeOwn(cur, fresh).lair!;
    expect(v.tele).toMatchObject({ id: 7, word: 'щит', got: 1, hid: 0 });
    expect(v.spell).toMatchObject({ words: ['раз', 'два'], until: 5, hid: 0 });
    expect(v.mass).toMatchObject({ words: ['все'], hid: 0 });
  });
  it('another event (id differs) or a still hidden fresh view changes nothing', () => {
    const cur = lair({ tele: { id: 7, hid: 1 } });
    expect(mergeOwn(cur, lair({ tele: { id: 8, word: 'x' } })).lair!.tele).toEqual({ id: 7, hid: 1 });
    expect(mergeOwn(cur, lair({ tele: { id: 7, hid: 1 } })).lair!.tele).toEqual({ id: 7, hid: 1 });
  });
});
