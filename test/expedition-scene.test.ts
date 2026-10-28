/**
 * Expedition 3D scene offline: every set of the FakeQuest builds, animates and stays within the budget (draw calls,
 * triangles — avatars off, everybody instanced, 50 fighters), and dispose() leaves nothing behind (scene graph empty,
 * art caches released, HUD removed). Fake DOM/canvas; nothing is rendered and nothing is sent.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import * as THREE from 'three';
import { fakeTimeline } from '../src/quest/fake';
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

/** Visible draws and triangles of a scene graph (instanced meshes count instances). */
function budget(root: THREE.Object3D) {
  let calls = 0, tris = 0;
  root.traverseVisible((o: any) => {
    if (!(o.isMesh || o.isPoints || o.isSprite)) return;
    if (o.isInstancedMesh && !o.count) return;
    const g = o.geometry; if (!g) return;
    const n = g.index ? g.index.count / 3 : (g.attributes.position?.count || 0) / 3;
    calls++; tris += Math.round(n) * (o.isInstancedMesh ? o.count : 1);
  });
  return { calls, tris };
}

const widen = (v: QuestPayload, n: number): QuestPayload => {
  if (!v.on || !v.b) return v;
  const form = v.b.form.slice();
  const roles = ['legionary', 'rogue', 'archer', 'mage', 'priest', 'paladin', 'necromancer', 'recruit'];
  for (let i = form.length; i < n; i++) form.push([`cat${i}`, roles[i % roles.length], v.b.cr && v.b.cr.fr.length > 1 ? v.b.cr.fr[i % v.b.cr.fr.length] : '', null, false, i % 3]);
  return { ...v, n, b: { ...v.b, form, fighters: n } };
};

describe('expedition scene', () => {
  it('builds every stage, animates, keeps the budget and disposes cleanly', async () => {
    const { ExpeditionScene } = await import('../src/expedition/scene');
    const { adapt, Roster } = await import('../src/expedition/adapter');
    const { artCacheSize } = await import('../src/expedition/art');
    const scene = new THREE.Scene();
    const cam = new THREE.PerspectiveCamera(50, 16 / 9, 0.03, 400);
    const sc = new ExpeditionScene({ kit: null, appOf: () => null, style: 'cats', quality: 2, secLeft: () => 5 });
    scene.add(sc.root); sc.attach(scene);
    const roster = new Roster();
    const seen = new Map<string, { calls: number; tris: number }>();
    let t = 0;
    for (const v0 of fakeTimeline({ login: 'murka', role: 'archer', speed: 4 }, 500)) {
      const v = widen(v0, 50);
      const s = adapt(v, { login: 'murka', role: 'archer', roster });
      if (s.kind === 'off') continue;
      sc.setState(s);
      for (let i = 0; i < 6; i++) { t += 0.1; sc.update(0.1, t, cam); }   // includes the fade + rebuild
      const key = s.kind + (s.battle ? ':' + s.battle.stage : '');
      const b = budget(sc.root);
      const prev = seen.get(key);
      if (!prev || b.calls > prev.calls || b.tris > prev.tris) seen.set(key, { calls: Math.max(b.calls, prev?.calls || 0), tris: Math.max(b.tris, prev?.tris || 0) });
    }
    for (const k of ['gather', 'vote', 'travel', 'battle:party', 'battle:hit', 'battle:tele', 'battle:end', 'treasure', 'rest', 'boss:mech', 'loot']) expect(seen.has(k), k).toBe(true);
    for (const [k, b] of seen) {
      expect(b.calls, `${k} draw calls`).toBeLessThanOrEqual(120);
      expect(b.tris, `${k} triangles`).toBeLessThanOrEqual(100_000);
    }
    expect(sc.stats().actors).toBeGreaterThan(10);
    sc.dispose();
    expect(scene.children).toHaveLength(0);
    expect(artCacheSize()).toBe(0);
    sc.dispose();                         // twice is fine
    sc.update(0.1, t + 1, cam);           // and a late frame does nothing
    sc.setState(adapt({ on: true, k: 'travel' }, { login: 'murka', role: 'archer', roster }));
    expect(scene.children).toHaveLength(0);
  });

  it('map puzzles (site 28.10): the tablet set builds per kind (runes, cups, scales, riddle), within budget, disposes cleanly', async () => {
    const { ExpeditionScene } = await import('../src/expedition/scene');
    const { adapt, Roster } = await import('../src/expedition/adapter');
    const { artCacheSize } = await import('../src/expedition/art');
    const scene = new THREE.Scene(), cam = new THREE.PerspectiveCamera(50, 16 / 9, 0.03, 400);
    const sc = new ExpeditionScene({ kit: null, appOf: () => null, style: 'cats', quality: 0, secLeft: () => 5 });
    scene.add(sc.root); sc.attach(scene);
    const roster = new Roster();
    let t = 0;
    const pz = (kind: string, extra: Record<string, unknown> = {}) => ({ on: true, k: 'puzzle', party: 'in', n: 6, ter: 'Курган', pz: { id: kind, kind, st: 'answer', name: 'Головоломка ' + kind, how: 'ответ', until: Date.now() + 9000, ...extra } }) as unknown as QuestPayload;
    for (const v of [pz('runes', { rows: [['R', '+', 'T', '=', '5']] }), pz('cups', { signs: ['a', 'b', 'c'] }), pz('cups', { st: 'done', res: { text: 'яд во 2', ans: '2' } }), pz('scales', { sums: [3, 7, 4, 6] }), pz('riddle', { q: 'загадка' })]) {
      const s = adapt(v, { login: 'murka', role: 'archer', roster });
      expect(s.kind).toBe('puzzle');
      sc.setState(s);
      for (let i = 0; i < 8; i++) { t += 0.1; sc.update(0.1, t, cam); }
      const b = budget(sc.root);
      expect(b.calls).toBeGreaterThan(3);
      expect(b.calls).toBeLessThanOrEqual(120);
      expect(b.tris).toBeLessThanOrEqual(100_000);
    }
    sc.dispose();
    expect(scene.children).toHaveLength(0);
    expect(artCacheSize()).toBe(0);
  });

  it('the view feeds the delay buffer, opens and closes the scene + HUD', async () => {
    const { ExpeditionView } = await import('../src/expedition');
    const root = (globalThis as any).document.createElement('div');
    let now = 1_800_000_000_000;
    const view = new ExpeditionView({ uiRoot: root, kit: null, appOf: () => null, style: 'cats', quality: () => 2, me: () => ({ login: 'murka', role: 'archer' }), now: () => now });
    const scene = new THREE.Scene(), cam = new THREE.PerspectiveCamera();
    const tl = fakeTimeline({ login: 'murka', t0: now, dl: 2 }, 1000);
    view.push(tl[0], now);
    expect(view.onAir).toBe(true);
    view.open(scene);
    expect(root.children).toHaveLength(1);
    for (let i = 1; i < 30; i++) { now += 1000; view.push(tl[i], now); view.frame(0.3, i, cam); }
    expect(view.sceneState?.kind).toBe('vote');
    view.push({ on: false }, now);
    expect(view.onAir).toBe(false);
    view.close();
    expect(scene.children).toHaveLength(0);
    expect(root.children).toHaveLength(0);
    expect(view.active).toBe(false);
  });
});
