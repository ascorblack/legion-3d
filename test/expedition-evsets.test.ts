/**
 * The 28.10 event / puzzle sets (src/expedition/sets.ts + art-events.ts): each new set builds from the questrec mocks,
 * animates through every public stage, stays within its own budget (≤ 15 draw calls at q2, fewer at q0) and disposes
 * cleanly; the pure helpers (goblin reveal parsing, puzzle line numbers, dance poses, battle beats) behave.
 * Fake DOM/canvas; nothing is rendered.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import * as THREE from 'three';
import type { QuestPayload } from '../src/quest/model';

beforeAll(() => {
  const ctx = new Proxy({}, {
    get: (_t, k) => {
      if (k === 'measureText') return () => ({ width: 10 });
      if (k === 'createLinearGradient' || k === 'createRadialGradient') return () => ({ addColorStop() {} });
      return () => {};
    },
    set: () => true,
  });
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
  (globalThis as any).document = { createElement: () => new FakeEl(), body: new FakeEl() };
  (globalThis as any).window = Object.assign(globalThis as any, { addEventListener() {}, removeEventListener() {} });
  (globalThis as any).localStorage = { getItem: () => null, setItem() {} };
});

/** Draw calls of a subtree (visible meshes / sprites; instanced meshes with count 0 skipped). */
function calls(root: THREE.Object3D): number {
  let n = 0;
  root.traverseVisible((o: any) => { if ((o.isMesh || o.isSprite || o.isPoints) && !(o.isInstancedMesh && !o.count)) n++; });
  return n;
}
const merge = (a: any, b: any): any => {
  if (!b || typeof b !== 'object' || Array.isArray(b)) return b;
  const o = { ...(a || {}) }; for (const k of Object.keys(b)) o[k] = merge(a ? a[k] : undefined, b[k]); return o;
};

/** mock id → stages to walk (+ the payload patch that puts it there) */
const CASES: [string, string, Record<string, unknown>[]][] = [
  ['pz-riddle', 'riddle', [{ pz: { st: 'show' } }, { pz: { st: 'answer' } }, { pz: { st: 'done', res: { text: 'верно', ans: 'огурец' } } }]],
  ['pz-count', 'count', [{ pz: { st: 'show' } }, { pz: { st: 'answer' } }, { pz: { st: 'done', res: { text: 'было 7', ans: '7' } } }]],
  ['pz-changed', 'changed', [{ pz: { st: 'show' } }, { pz: { st: 'answer' } }, { pz: { st: 'done', res: { text: 'пропал 3', ans: '3' } } }]],
  ['pz-letter', 'letter', [{ pz: { st: 'answer' } }, { pz: { got: 4 } }, { pz: { st: 'done', got: 10 } }]],
  ['hw-trick', 'trick', [{ ev: { st: 'vote', vt: { sweet: 3, trick: 5 } } }, { ev: { st: 'done', vt: { sweet: 3, trick: 5 }, res: { text: 'гадость' } } }, { ev: { st: 'done', vt: { sweet: 9, trick: 1 } } }]],
  ['hw-fortune', 'fortune', [{ ev: { st: 'on' } }, { ev: { st: 'done' } }]],
  ['hw-cauldron', 'cauldron', [{ ev: { st: 'pay', pool: 1200, price: 2500 } }, { ev: { st: 'ingr', picked: ['тыква', 'глаз', 'кость'] } }, { ev: { st: 'brew' } }, { ev: { st: 'done' } }]],
  ['hw-lostghost', 'lostghost', [{ ev: { st: 'riddle' } }, { ev: { st: 'pause' } }, { ev: { st: 'done' } }]],
  ['hw-skeldance-show', 'skeldance', [{ ev: { st: 'show' } }, { ev: { st: 'input', sq: [] } }, { ev: { st: 'done', seq: ['l', 'r', 'j', 'c'] } }]],
  ['gob-shell', 'goblin', [{ ev: { st: 'bet' } }, { ev: { st: 'shuffle' } }, { ev: { st: 'guess' } }, { ev: { st: 'reveal', rv: { text: 'Шарик под третьим стаканом' } } }, { ev: { st: 'done' } }]],
  ['gob-coin', 'goblin', [{ ev: { st: 'bet' } }, { ev: { st: 'guess' } }, { ev: { st: 'reveal', rv: { text: 'Выпал орёл' } } }]],
  ['gob-hilo', 'goblin', [{ ev: { st: 'bet' } }, { ev: { st: 'guess' } }, { ev: { st: 'reveal', rv: { text: 'Открыта 9 — больше' } } }]],
];

describe('expedition event / puzzle sets (28.10)', () => {
  for (const q of [2, 0]) it(`every new set builds, animates all stages, ≤ 15 draw calls (q${q}) and disposes`, async () => {
    const { buildSet } = await import('../src/expedition/sets');
    const { adapt, Roster } = await import('../src/expedition/adapter');
    const { mockById } = await import('../src/debug/questMocks');
    const { ExpMats } = await import('../src/expedition/mats');
    const { eventArtCacheSize, disposeEventArt } = await import('../src/expedition/art-events');
    const mats = new ExpMats();
    let emitted = 0;
    const fx = { emit: () => { emitted++; }, rnd: () => 0.5, ring: () => {} } as any;
    const env = { mats, fx, decals: { add: () => {} } as any, secLeft: () => 5, float: () => {}, q };
    const roster = new Roster();
    const names = new Set<string>();
    const table: string[] = [];
    for (const [id, look, stages] of CASES) {
      const mock = mockById(id);
      expect(mock, id).toBeTruthy();
      const v0 = mock!.build({ login: 'murka', role: 'archer', now: Date.now() }) as QuestPayload;
      const s0 = adapt(v0, { login: 'murka', role: 'archer', roster });
      const set = buildSet(env, s0);
      expect(set.root.name, id).not.toMatch(/exp-set-(event-|puzzle-)/);   // not the generic fallback
      names.add(set.root.name);
      const holder = new THREE.Group(); holder.add(set.root);
      let t = 0, max = 0;
      for (const patch of stages) {
        const s = adapt(merge(v0, patch), { login: 'murka', role: 'archer', roster });
        expect(s.kind === 'event' ? s.event?.look : s.puzzle?.kind, id).toBe(look);
        for (let i = 0; i < 30; i++) { t += 0.1; set.relabel = i % 3 === 0; set.update(0.1, t, s); }
        max = Math.max(max, calls(set.root));
      }
      table.push(`${id}=${max}`);
      expect(max, `${id} draw calls`).toBeLessThanOrEqual(q > 0 ? 15 : 11);
      expect(max, id).toBeGreaterThan(2);
      set.dispose();
      expect(set.root.parent, id).toBeNull();
      expect(holder.children).toHaveLength(0);
    }
    console.log(`[evsets] q${q} draw calls: ${table.join(' ')}`);
    // distinct sets: 4 puzzles + 5 Изнанка events + 3 goblin games
    expect(names.size).toBe(12);
    expect(emitted).toBeGreaterThan(0);
    expect(eventArtCacheSize()).toBeGreaterThan(10);
    disposeEventArt();
    expect(eventArtCacheSize()).toBe(0);
    mats.dispose();
  });

  it('the scene releases the event art on dispose', async () => {
    const { ExpeditionScene } = await import('../src/expedition/scene');
    const { adapt, Roster } = await import('../src/expedition/adapter');
    const { mockById } = await import('../src/debug/questMocks');
    const { eventArtCacheSize } = await import('../src/expedition/art-events');
    const { artCacheSize } = await import('../src/expedition/art');
    const scene = new THREE.Scene(), cam = new THREE.PerspectiveCamera(50, 16 / 9, 0.03, 400);
    const sc = new ExpeditionScene({ kit: null, appOf: () => null, style: 'cats', quality: 2, secLeft: () => 5 });
    scene.add(sc.root); sc.attach(scene);
    const roster = new Roster();
    let t = 0;
    for (const id of ['hw-skeldance-show', 'gob-shell', 'pz-changed', 'hw-cauldron']) {
      sc.setState(adapt(mockById(id)!.build({ login: 'murka', role: 'archer', now: Date.now() }), { login: 'murka', role: 'archer', roster }));
      for (let i = 0; i < 8; i++) { t += 0.1; sc.update(0.1, t, cam); }
    }
    expect(eventArtCacheSize()).toBeGreaterThan(0);
    sc.dispose();
    expect(scene.children).toHaveLength(0);
    expect(eventArtCacheSize()).toBe(0);
    expect(artCacheSize()).toBe(0);
  });

  it('pure helpers: goblin reveal, puzzle line numbers, dance poses, battle beats', async () => {
    const { revealOf, puzzleLineInfo, dancePose } = await import('../src/expedition/sets');
    const { resolveBeat } = await import('../src/expedition/scene');
    expect(revealOf('shell', 'Напёрстки · Шарик под вторым стаканом').cup).toBe(2);
    expect(revealOf('shell', 'шарик в 3').cup).toBe(3);
    expect(revealOf('shell', 'Ставок 6').cup).toBe(0);
    expect(revealOf('coin', 'Орёл или решка · Выпала решка').face).toBe('t');
    expect(revealOf('coin', 'Орёл или решка · Выпал орёл').face).toBe('h');
    expect(revealOf('coin', 'Орёл или решка · Ставок 6').face).toBe('');
    expect(revealOf('hilo', 'Открыта 9 — больше').card).toBe('9');
    expect(revealOf('hilo', 'вторая карта: дама').card).toBe('Д');
    expect(revealOf('hilo', 'Больше или меньше').card).toBe('');
    expect(puzzleLineInfo('Номер пропавшего: от 1 до 8').items).toBe(8);
    expect(puzzleLineInfo('Буква К · слов 3 из 10')).toEqual({ items: 0, letter: 'К', got: 3, goal: 10 });
    const P = { dx: 0, dy: 0, lean: 0, aSide: 0, aFwd: 0, clap: 0 };
    expect(dancePose('j', 0.5, P).dy).toBeGreaterThan(0.5);
    expect(dancePose('l', 0.5, P).dx).toBeGreaterThan(0);
    expect(dancePose('r', 0.5, P).dx).toBeLessThan(0);
    expect(dancePose('c', 0.5, P).clap).toBeCloseTo(1);
    expect(dancePose('l', 1, P).dx).toBeCloseTo(0);
    // live data resolves the enemy telegraph in 'tele2'; old captures in 'hit' after 'tele'
    expect(resolveBeat('tele2', 'tele', '')).toBe('foes');
    expect(resolveBeat('tele2', '', 'party')).toBe('foes');
    expect(resolveBeat('hit', 'tele', '')).toBe('foes');
    expect(resolveBeat('hit', '', 'tele')).toBe('foes');
    expect(resolveBeat('hit', 'party', '')).toBe('party');
    expect(resolveBeat('tele', 'party', '')).toBeNull();
  });
});
