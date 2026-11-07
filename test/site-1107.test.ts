/**
 * Site update 07.11 afternoon (quest.js / app.js): the battle form sent by key, nets / wings / hunters / the wolf's bite on the
 * boss arena, the dungeon summary. Fixture views are built the way the site's code reads them; when a downloaded site copy is
 * around (.local/site-*), the site's own zonesHtml / wingsHtml / bgHtml render the same views and the test compares.
 */
import { describe, it, expect } from 'vitest';
import { QuestFormFill, isQuestPayload } from '../src/quest/model';
import { adapt, Roster } from '../src/expedition/adapter';
import { bossNote } from '../src/quest';
import { siteBoss, siteCopy } from './site-quest-fns';

const SB = siteBoss();
const me = { login: 'player1', role: 'archer' };
const ctx = () => ({ ...me, roster: new Roster() });
// the arena of the fake boss (src/quest/fake.ts): 1↔2,3 · 2↔1,4 · 3↔1,4 · 4↔2,3
const ZN = { a: [[1, [2, 3], [[300, 820], [560, 800], [600, 900], [320, 930]]], [2, [1, 4], [[640, 790], [900, 780], [940, 880], [660, 900]]],
  [3, [1, 4], [[420, 940], [700, 930], [720, 1030], [400, 1040]]], [4, [2, 3], [[760, 920], [1020, 910], [1050, 1010], [780, 1030]]]], gone: [] as number[] };
const boss = (bg: Record<string, unknown>) => ({ on: true, k: 'boss', t: 'Логово', ter: 'Лес', n: 8, party: 'in',
  bg: { name: 'Гнилозуб', title: 'Повелитель трясины', danger: 2, ph: 1, phs: 2, hp: 0.6, st: 'party', in: true, my: 0.8, round: 2, limit: 8, zn: ZN, area: 1, ...bg } });
const sayTexts = (s: ReturnType<typeof adapt>) => s.cmds.map((c) => c.text);

describe('app.js questFormFill (b.fk): the battle form comes only when it changes', () => {
  const view = (b: Record<string, unknown>): any => ({ on: true, k: 'battle', b: { id: 7, round: 1, st: 'party', foes: [], ...b } });
  it('puts the last form of the same key back, [] for an unseen key, keeps views without fk as they are', () => {
    const F = new QuestFormFill();
    const form = [['player1', 'archer', 'R'], ['p2', 'mage', 'L']];
    const a = F.fill(view({ fk: 'k1', form }));
    expect(a.b.form).toBe(form);
    const b = F.fill(view({ fk: 'k1', me: 0 })) as any;
    expect(b.b.form).toBe(form);
    expect(isQuestPayload(b)).toBe(true);
    expect((F.fill(view({ fk: 'k2' })) as any).b.form).toEqual([]);
    const plain = view({ form: [['x', 'mage']] });
    expect(F.fill(plain)).toBe(plain);
    expect((F.fill(view({ fk: 'k2' })) as any).b.form).toEqual([]);
    expect(F.fill(null)).toBeNull();
  });
  it('the 3D roster keeps the heroes across views that carry only the key', () => {
    const F = new QuestFormFill(), c = ctx();
    adapt(F.fill(view({ fk: 'a', form: [['player1', 'archer', 'R'], ['p2', 'mage', 'R']], me: 0, hp: 1 })) as any, c);
    const s = adapt(F.fill(view({ fk: 'a', me: 0, hp: 1 })) as any, c);
    expect(s.party.map((m) => m.login)).toEqual(['player1', 'p2']);
    // without the fill the same view has no heroes at all
    expect(adapt(view({ fk: 'a', me: 0, hp: 1, form: [] }), ctx()).party.length).toBe(0);
  });
  it.skipIf(!siteCopy('app.js', 'questFormFill'))('app.js still fills b.form by b.fk', () => {
    const src = siteCopy('app.js', 'questFormFill')!;
    expect(src).toMatch(/b\.fk/);
    expect(src).toMatch(/questFormFill\(d\)/);
  });
});

describe('boss arena 07.11: nets, wings, hunters, the wolf\'s bite', () => {
  it.skipIf(!siteCopy('quest.js', 'function wingsHtml('))('the site copy\'s quest.js boss code runs here (the comparisons below are not skipped)', () => {
    expect(SB).toBeTruthy();
  });
  it('nets (mech.nets): never the platform to jump to; the site shows it as «под сеть»', () => {
    const v = boss({ mech: { id: 'M30', name: 'Град и сети', fam: 'position', zones: [1], nets: [2], until: 0 } });
    const s = adapt(v as any, ctx());
    const z = Object.fromEntries(s.boss!.zones.map((p) => [p.n, p]));
    expect(z[2].net).toBe(true);
    expect(z[2].danger).toBe(true);
    expect(z[2].goal).toBe(false);
    expect(z[3].goal).toBe(true);   // the only safe neighbour of 1
    expect(sayTexts(s)).toContain('прыжок 3');
    expect(s.cmds.some((c) => /под сетью: 2/.test(c.text))).toBe(true);
    if (SB) {
      const h = SB.zonesHtml((v as any).bg, (v as any).bg.mech);
      expect(h).toContain('class="za net"');
      expect(h).toMatch(/data-qpb="прыжок 2">🕸 под сеть 2/);
      expect(h).toMatch(/class="qa-b " data-qpb="прыжок 3"/);   // the jump we suggest is a plain (not «warn») site button
      expect(h).toContain('сеть - пропустишь ход');
    }
  });
  it('wings (HPG10): my wing, need / got of every wing, my wing\'s platforms are the ones to keep', () => {
    const wings = { z: [[1, 2], [3], [4]], need: [2, 1, 1], got: [1, 1, 0] };
    const v = boss({ area: 3, wings, mech: { id: 'HPG10', name: 'Три крыла', fam: 'wings', how: 'держим', need: 4, got: 2 } });
    const s = adapt(v as any, ctx());
    expect(s.boss!.wings.map((w) => [w.name, w.got, w.need, w.mine])).toEqual([['Левое крыло', 1, 2, false], ['Центр', 1, 1, true], ['Правое крыло', 0, 1, false]]);
    expect(s.boss!.zones.find((p) => p.n === 3)!.wing).toBe(true);
    expect(s.boss!.zones.find((p) => p.n === 3)!.goal).toBe(true);
    expect(s.cmds.some((c) => c.kind === 'ok' && /ты здесь: Центр · 1 из 1/.test(c.text))).toBe(true);
    expect(s.cmds.some((c) => /Левое крыло: 1 из 2/.test(c.text))).toBe(true);
    expect(sayTexts(s)).toContain('держим');
    expect(bossNote((v as any).bg)).toMatch(/ты здесь · Центр 1\/1/);
    if (SB) {
      const h = SB.wingsHtml((v as any).bg);
      expect(h).toMatch(/<b class="urge">ты здесь<\/b> · <b>Центр<\/b> \(площадки 3\): 1 из 1/);
      expect(h).toMatch(/Левое крыло<\/b> \(площадки 1, 2\): 1 из 2/);
      expect(h).toContain('class="za keep me"');
      expect(SB.bgHtml(v)).toContain('Центр');
    }
  });
  it('hunters (adds with count 0): «удар <name>» each with its own health; wolves bite every move', () => {
    const v = boss({ zn: undefined, adds: [['егерь', 0, 0.5], ['ловчий', 0, 0], ['волк', 3, 0.8]] });
    const s = adapt(v as any, ctx());
    expect(s.boss!.hunt.map((h) => h.name)).toEqual(['егерь', 'ловчий']);
    expect(s.boss!.adds.map((a) => a.name)).toEqual(['волк']);
    expect(sayTexts(s)).toContain('удар егерь');
    expect(sayTexts(s)).not.toContain('удар ловчий');   // out: no longer strikes
    expect(s.cmds.find((c) => c.text === 'удар волк 1')!.note).toMatch(/стая кусает/);
    expect(bossNote((v as any).bg)).toMatch(/«удар егерь» 50%/);
    if (SB) {
      const h = SB.bgHtml(v);
      expect(h).toContain('q-hunt');
      expect(h).toMatch(/<b>егерь<\/b> · 50%/);
      expect(h).toMatch(/Приспешники: волк 3/);
      expect(h).toMatch(/стая кусает бойцов/);
    }
  });
  it('the walls of Престольград («ворота» among the targets)', () => {
    const v = boss({ zn: undefined, adds: [['ворота', 0, 0.9], ['катапульты', 0, 0.4]] });
    const s = adapt(v as any, ctx());
    expect(s.cmds.find((c) => c.text === 'удар ворота')!.note).toMatch(/у ворот, катапульт и стрелков/);
    if (SB) expect(SB.bgHtml(v)).toMatch(/Стены Престольграда/);
  });
  it('the wolf\'s bite (g.bite + zn, no mechanic): bitten platforms are red, the prompt says which', () => {
    const v = boss({ bite: [1, 4] });
    const s = adapt(v as any, ctx());
    const z = Object.fromEntries(s.boss!.zones.map((p) => [p.n, p]));
    expect(z[1].danger && z[4].danger).toBe(true);
    expect(z[2].danger).toBe(false);
    expect(s.cmds[0]).toMatchObject({ kind: 'info', text: 'Волк кусает площадки 1 и 4', note: 'твою площадку тоже' });
    if (SB) { const h = SB.bgHtml(v); expect(h).toMatch(/Укус волка/); expect(h).toMatch(/Волк кусает площадки 1 и 4/); expect(h).not.toContain('data-qpb'); }
  });
  it('the party move accepted (g.acted) and the mechanic\'s targets / stream-only notes', () => {
    const acted = adapt(boss({ zn: undefined, acted: true }) as any, ctx());
    expect(acted.cmds[0]).toMatchObject({ kind: 'ok', text: 'ход принят' });
    if (SB) expect(SB.bgHtml(boss({ zn: undefined, acted: true }))).toMatch(/Твой ход принят/);
    const t = adapt(boss({ zn: undefined, mech: { id: 'HV13', name: 'Глаза во тьме', how: 'бей', tgn: ['левый глаз', 'правый глаз'] } }) as any, ctx());
    expect(t.cmds.map((c) => c.text)).toEqual(expect.arrayContaining(['Цели: левый глаз, правый глаз', expect.stringMatching(/видно только на стриме/)]));
    const w = adapt(boss({ zn: undefined, wc: [3, 1], mech: { id: 'HPG1', name: 'Два слова', words: ['щит', 'меч'], need: 5 } }) as any, ctx());
    expect(w.cmds.some((c) => c.text === 'щит 3 из 5 · меч 1 из 5')).toBe(true);
  });
  it('odd shapes of the new fields never throw', () => {
    for (const bg of [{ wings: 'x' }, { wings: { z: 'a' } }, { wings: { z: [[1], 'b'], need: null } }, { bite: null }, { bite: 'x', zn: ZN }, { adds: [[null, 0, 'x']] },
      { mech: { name: 'm', nets: 'q', tgn: 5, fam: 'position' } }, { zn: { a: 'x' } }, { mech: { id: 'HPG10', name: 'w' }, wings: { z: [[9]], need: [1], got: [] } }])
      expect(() => adapt(boss(bg) as any, ctx())).not.toThrow();
  });
});

describe('dungeon summary (quest.js dgHtml g.sum)', () => {
  it('status and the reward line', () => {
    const s = adapt({ on: true, k: 'dungeon', party: 'in', dgn: { name: 'Склеп', fl: 3, sum: { name: 'Склеп', stars: 3, fl: 3, rooms: 7, total: 9, chests: 2, vault: true, xp: 120, coins: 40, items: [['Меч', 'player1']] } } } as any, ctx());
    expect(s.status).toBe('Итог данжа «Склеп» ★★★');
    expect(s.cmds.map((c) => c.text)).toEqual(expect.arrayContaining(['каждому: +120 опыта · +40 бронзы', 'Вещи: Меч — player1']));
    const t = adapt({ on: true, k: 'dungeon', dgn: { name: 'Т', sum: { test: true, stars: 9 } } } as any, ctx());
    expect(t.status).toMatch(/★★★★★$/);
    expect(t.cmds.some((c) => /Тестовый данж/.test(c.text))).toBe(true);
  });
});
