/**
 * Site 28.10: the empty party (quest.js `v.nb` — «В отряд никто не присоединился :(») and the Prologue boss name
 * (questlive `bn`, default «Закхуэль») in the quest HUD card and the 3D expedition adapter / scene.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import * as THREE from 'three';
import { cardOf, squadOf } from '../src/quest';
import { bossName, emptyParty, BOSS_NAME_DEFAULT } from '../src/quest/model';
import { adapt, Roster } from '../src/expedition/adapter';

const base = () => 'удар';
const me = { login: 'player1', role: 'archer' };
const SAT = { n: 'Сатаниэль', g: 'Сатаниэля', d: 'Сатаниэлю', a: 'Сатаниэля', i: 'Сатаниэлем', p: 'Сатаниэле' };

describe('Prologue boss name (bn)', () => {
  it('defaults to «Закхуэль» in every case; missing cases fall back to the nominative; markup stripped', () => {
    expect(bossName()).toEqual(BOSS_NAME_DEFAULT);
    expect(bossName({ bn: null }, null).g).toBe('Закхуэля');
    expect(bossName({ bn: SAT })).toEqual(SAT);
    expect(bossName({ bn: { n: 'Мор<b>' } })).toEqual({ n: 'Морb', g: 'Морb', d: 'Морb', a: 'Морb', i: 'Морb', p: 'Морb' });
    expect(bossName({ bn: { n: '  ' } }).n).toBe('Закхуэль');
    expect(bossName({}, { bn: SAT }).i).toBe('Сатаниэлем');   // newest first, then the delayed view
  });
  it('lair cards use it (isles and lair); the newest view gives the name like quest.js NEW || CUR', () => {
    const isles = { on: true, lair: { is: { pick: { until: 5 } }, hp: 1 } } as any;
    expect(cardOf(isles, me, base)!.title).toBe('Закхуэль · острова');
    expect(cardOf({ ...isles, bn: SAT }, me, base)!.title).toBe('Сатаниэль · острова');
    const lair = { on: true, lair: { hp: 0.5, phase: 2, round: 3, st: 'party' } } as any;
    expect(cardOf(lair, me, base)!.title).toBe('Логово Закхуэля');
    expect(cardOf(lair, me, base, { on: true, bn: SAT } as any)!.title).toBe('Логово Сатаниэля');
    expect(adapt({ ...lair, bn: SAT }, { login: 'player1', role: 'archer', roster: new Roster() }).title).toBe('Логово Сатаниэля');
    expect(adapt(lair, { login: 'player1', role: 'archer', roster: new Roster() }).title).toBe('Логово Закхуэля');
  });
});

describe('empty party (nb)', () => {
  const nb = { on: true, nb: 1, k: 'gather', t: 'Сбор у ворот', n: 0, party: 'out', gather: { until: 123 } } as any;
  it('the HUD card says only that; no join / leave button', () => {
    expect(emptyParty(nb)).toBe(true);
    expect(emptyParty({ on: false, nb: 1 })).toBe(false);
    const c = cardOf(nb, me, base)!;
    expect(c.title).toBe('В отряд никто не присоединился :(');
    expect(c.urge).toEqual({ kind: 'info', text: 'Отряд возвращается в город…' });
    expect(c.note).toContain('пиши «поход»');
    expect(c.until).toBeUndefined();
    expect(squadOf(nb, 'out')).toBeNull();
    // nb wins over any other block, like the site's banner / tab
    expect(cardOf({ ...nb, b: { id: 1, round: 1, st: 'party', form: [], foes: [] } }, me, base)!.title).toBe('В отряд никто не присоединился :(');
  });
  it('the 3D adapter gives a calm empty gather: nobody, no countdown, nothing to type but the info', () => {
    const s = adapt(nb, { login: 'player1', role: 'archer', roster: new Roster() });
    expect(s.kind).toBe('gather');
    expect(s.empty).toBe(true);
    expect(s.party).toEqual([]);
    expect(s.n).toBe(0);
    expect(s.until).toBe(0);
    expect(s.status).toBe('В отряд никто не присоединился :(');
    expect(s.cmds).toHaveLength(1);
    expect(s.cmds[0].kind).toBe('info');
    expect(s.setKey).toContain('empty');
    // odd payloads do not throw
    expect(() => adapt({ on: true, nb: true } as any, { login: '', role: '', roster: new Roster() })).not.toThrow();
  });
});

describe('empty party in the 3D scene', () => {
  beforeAll(() => {
    const ctx = new Proxy({}, { get: (_t, k) => (k === 'measureText' ? () => ({ width: 10 }) : k === 'createLinearGradient' || k === 'createRadialGradient' ? () => ({ addColorStop() {} }) : () => {}), set: () => true });
    class FakeEl {
      style: Record<string, string> = {}; dataset: Record<string, string> = {}; width = 0; height = 0; innerHTML = ''; textContent = ''; className = ''; hidden = false; children: FakeEl[] = [];
      parent: FakeEl | null = null;
      classList = { add() {}, remove() {}, toggle() {}, contains: () => false };
      getContext() { return ctx; }
      attachShadow() { return new FakeEl(); }
      appendChild(c: FakeEl) { c.parent = this; this.children.push(c); return c; }
      remove() { if (this.parent) { this.parent.children = this.parent.children.filter((x) => x !== this); this.parent = null; } }
      setAttribute() {} addEventListener() {} removeEventListener() {}
      querySelector() { return new FakeEl(); }
      querySelectorAll() { return []; }
    }
    const g = globalThis as any;
    if (!g.document || !g.document.createElement) g.document = { createElement: () => new FakeEl(), body: new FakeEl() };
    g.window = Object.assign(g, { addEventListener() {}, removeEventListener() {} });
    if (!g.localStorage) g.localStorage = { getItem: () => null, setItem() {} };
  });
  it('builds, animates and disposes cleanly (gather → empty → travel)', async () => {
    const { ExpeditionScene } = await import('../src/expedition/scene');
    const scene = new THREE.Scene(), cam = new THREE.PerspectiveCamera(50, 16 / 9, 0.03, 400);
    const sc = new ExpeditionScene({ kit: null, appOf: () => null, style: 'cats', quality: 2, secLeft: () => 0 });
    scene.add(sc.root); sc.attach(scene);
    const roster = new Roster();
    let t = 0;
    for (const v of [{ on: true, k: 'gather', n: 3, party: 'in', gather: { until: Date.now() + 5000 } }, { on: true, nb: 1, k: 'gather', n: 0 }, { on: true, nb: 1 }, { on: true, k: 'travel', n: 0 }]) {
      sc.setState(adapt(v as any, { login: 'p', role: 'archer', roster }));
      for (let i = 0; i < 8; i++) { t += 0.1; sc.update(0.1, t, cam); }
    }
    sc.dispose();
    expect(scene.children).toHaveLength(0);
  });
});
