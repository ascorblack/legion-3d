/**
 * Sanitized live q views of the 31.10 main-channel expedition (the Halloween map; test/fixtures/quest-live-3.json, made by
 * quest-live-1031-sanitize.mjs from a local read-only capture): every view replays through the guard, the HUD card and the
 * 3D adapter; the new terrains get their own biomes; the loot vote inside the finished boss view, the place buttons (`pb`)
 * and the identities of the fixture are checked.
 */
import { describe, it, expect, vi } from 'vitest';
import live3 from './fixtures/quest-live-3.json';
import { adapt, biomeOf, Roster, type BiomeId } from '../src/expedition/adapter';
import { cardOf } from '../src/quest';
import { isQuestPayload, DelayBuffer, type QuestPayload, type QuestLoot } from '../src/quest/model';

const rec = live3 as unknown as { t: number; data: QuestPayload & Record<string, any> }[];
const me = { login: 'player1', role: 'archer' };
const ctx = () => ({ ...me, roster: new Roster() });
const TER: Record<string, BiomeId> = { 'Тыквенное поле': 'pumpkin', 'Кладбище': 'graveyard', 'Руины': 'ruins', 'Мельница': 'mill', 'Сухое дерево': 'deadtree', 'Заброшенная деревня': 'village' };

describe('sanitized live q views (2026-10-31, main channel)', () => {
  it('replays every view through guard, delay buffer, HUD card and adapter', () => {
    const c = ctx(), buffer = new DelayBuffer(), warn = vi.spyOn(console, 'warn');
    for (const { t, data: q } of rec) {
      expect(isQuestPayload(q)).toBe(true);
      const s = adapt(q, c);
      expect(s.kind === 'off').toBe(!q.on);
      if (q.on) expect(cardOf(q, me, () => 'выстрел')).not.toBeNull();
      if (q.b && !q.loot) { expect(s.battle).not.toBeNull(); expect(s.battle!.foes.length).toBe(q.b.foes.length); }
      if (q.tr) expect(s.trap).not.toBeNull();
      if (q.ev) expect(s.event?.look).toBe(q.ev.look);
      buffer.push(q, t); expect(() => adapt(buffer.pick(t + 4000), c)).not.toThrow();
    }
    expect(warn).not.toHaveBeenCalled(); warn.mockRestore();
  });

  it('every 31.10 terrain has its own biome (no meadow fallback), on every kind of view', () => {
    const seen = new Set<string>();
    for (const { data: q } of rec) if (q.on && TER[q.ter as string]) { expect(adapt(q, ctx()).biome, String(q.ter)).toBe(TER[q.ter as string]); seen.add(q.ter as string); }
    expect([...seen].sort()).toEqual(Object.keys(TER).sort());
    for (const [ter, b] of Object.entries({ 'Врата Полуночи': 'gate', 'Чаща': 'forest', 'Болото': 'swamp', 'Старый мост': 'bridge', 'Пещера': 'cave', 'Курган': 'mound',
      'Мельница пугал': 'mill', 'Деревня без теней': 'village', 'Часовня без колокола': 'graveyard', 'Старое кладбище': 'graveyard', 'Тыквенная грядка': 'pumpkin',
      'Огород пугала': 'pumpkin', 'Руины храма': 'ruins', 'Мёртвое дерево': 'deadtree', 'Хутор': 'village', 'Ферма': 'mill', 'Склеп': 'dungeon' })) expect(biomeOf(ter), ter).toBe(b);
  });

  it('the loot vote inside the finished boss view is the loot scene: rarity, leaders, «случайно», own vote', () => {
    const loot = rec.filter((e) => e.data.loot && e.data.b?.st === 'end').map((e) => e.data as QuestPayload & { loot: QuestLoot & { top: [string, string, number][] } });
    expect(loot.length).toBeGreaterThanOrEqual(3);
    for (const q of loot) {
      const s = adapt(q, ctx());
      expect(s.kind).toBe('loot');
      expect(s.loot!.name).toBe(q.loot.name);
      expect(s.loot!.rarity).toBe('legendary');
      expect(s.loot!.top.length).toBe(Math.min(3, q.loot.top.length));
      if (q.loot.my === '*') expect(s.cmds[0]).toEqual({ kind: 'ok', text: 'твой голос: случайно' });
      else if (q.loot.my) expect(s.cmds[0].text).toMatch(/^твой голос: player\d+$/);
      else expect(s.cmds.some((c) => c.kind === 'say' && c.text === 'случайно')).toBe(true);
    }
  });

  it('place buttons (pb) become chat lines once: flee / buy-off, freeing a vined cat, the clock vote', () => {
    const by = (k: string) => rec.find((e) => e.data.pb?.k?.includes(k))!.data;
    const flee = adapt(by('flee'), ctx()).cmds;
    expect(flee).toEqual(expect.arrayContaining([{ kind: 'say', text: 'бежать' }, { kind: 'say', text: 'откуп', note: 'Откупиться' }]));
    const vines = adapt(by('vines'), ctx()).cmds.filter((c) => /^освободить @player\d+$/.test(c.text));
    expect(vines.length).toBeGreaterThan(0); expect(vines[0].note).toBe('0 из 2');
    const mv = adapt(by('mvote'), ctx()).cmds.filter((c) => c.kind === 'num');
    expect(mv[0]).toEqual({ kind: 'num', text: '1', note: 'кукушка' });
    for (const { data: q } of rec) { const t = adapt(q, ctx()).cmds.map((c) => c.text); expect(new Set(t).size, String(q.k)).toBe(t.length); }
  });

  it('the fixture holds only playerN identities and no feed / low-HP / test fields', () => {
    for (const { data: q } of rec) {
      if (q.roll) expect(q.roll.by).toMatch(/^player\d+$/);
      for (const p of q.b?.form || []) expect(p[0]).toMatch(/^player\d+$/);
      for (const p of q.loot?.top || []) { expect(p[0]).toMatch(/^player\d+$/); expect(p[1]).toMatch(/^player\d+$/); }
      if (q.loot?.my && q.loot.my !== '*') expect(q.loot.my).toMatch(/^player\d+$/);
      expect(q).not.toHaveProperty('test'); expect(q.b || {}).not.toHaveProperty('fd'); expect(q.b || {}).not.toHaveProperty('low');
    }
  });
});
