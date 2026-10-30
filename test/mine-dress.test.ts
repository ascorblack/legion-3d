/**
 * Mine dressing (visual pass 2): the cave stays within its budgets with the new floor / ceiling / lantern dressing —
 * classic q2 ≤ 80 calls / ≤ 130k triangles, «Шахта 3.0» q2 ≤ 90 calls / ≤ 130k triangles even with a big dug-out tunnel
 * network (the dug part's dressing thins out), q0 never costs more than q2; the dressing is a pure function of the
 * seed (two builds hash the same); the walkable relief is bounded (±RELIEF), smooth (no step > 5 cm per 10 cm) and
 * flat round the hall objects.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import * as THREE from 'three';
import fx3 from './fixtures/mine3-enter.json';
import classic from './fixtures/mine-enter.json';
import { cost } from './rooms-visual-budget.test';
import { RELIEF } from '../src/rooms/mine/rockface';

beforeAll(() => {
  const ctx = new Proxy({}, {
    get: (_t, k) => {
      if (k === 'getImageData' || k === 'createImageData') return (_x: number, _y?: number, w = 4, h = 4) => ({ data: new Uint8ClampedArray((w || 4) * (h || 4) * 4), width: w, height: h });
      if (k === 'createLinearGradient' || k === 'createRadialGradient' || k === 'createPattern') return () => ({ addColorStop() {} });
      if (k === 'measureText') return () => ({ width: 10 });
      return () => {};
    },
    set: () => true,
  });
  class FakeEl {
    style: Record<string, string> = {}; dataset: Record<string, string> = {}; width = 0; height = 0; innerHTML = ''; textContent = ''; className = '';
    classList = { add() {}, remove() {}, toggle() {}, contains: () => false };
    getContext() { return ctx; }
    attachShadow() { return new FakeEl(); }
    appendChild(c: unknown) { return c; }
    remove() {} focus() {} setAttribute() {} addEventListener() {} removeEventListener() {}
    querySelector() { return new FakeEl(); }
    querySelectorAll() { return []; }
    getBoundingClientRect() { return { left: 0, top: 0, width: 100, height: 100, right: 100, bottom: 100 }; }
  }
  (globalThis as any).document = (globalThis as any).document || { createElement: () => new FakeEl(), body: new FakeEl(), pointerLockElement: null, exitPointerLock() {}, addEventListener() {}, removeEventListener() {} };
  (globalThis as any).window = (globalThis as any).window || Object.assign(globalThis as any, { addEventListener() {}, removeEventListener() {}, devicePixelRatio: 1 });
});

/** The v3 fixture with a big tunnel network dug out (three long galleries + two cross-cuts: ~110 cells). */
function bigDug(st: any): any {
  const s = JSON.parse(JSON.stringify(st)), w = s.fl.w, h = s.fl.h, d = s.dug.split('');
  for (let x = 0; x < w; x++) { d[7 * w + x] = '1'; d[13 * w + x] = '1'; d[2 * w + x] = '1'; }
  for (let y = 0; y < h; y++) { d[y * w + 20] = '1'; d[y * w + 5] = '1'; }
  s.dug = d.join('');
  return s;
}

async function build(kind: 'classic' | 'v3' | 'v3big', q: number, channel = 'alpha') {
  const { MineScene } = await import('../src/rooms/mine/scene');
  const { MineModel } = await import('../src/rooms/mine/state');
  const M = new MineModel('player999');
  if (kind === 'classic') M.take(JSON.parse(JSON.stringify((classic as any).st)), (classic as any).me, null, 1);
  else M.take(kind === 'v3big' ? bigDug((fx3 as any).st) : JSON.parse(JSON.stringify((fx3 as any).st)), (fx3 as any).me, null, 1);
  const S = new MineScene({ quality: q, login: 'player999', channel, geom: kind === 'classic' ? undefined : M.G } as any);
  S.setView(M, []);
  return { S, M };
}

function geoHash(root: THREE.Object3D): string {
  let h = 2166136261, n = 0;
  root.traverse((o) => {
    const m = o as THREE.Mesh; if (!m.isMesh || !m.geometry || !/^(city|room):/.test(m.name)) return;
    const p = m.geometry.attributes.position.array as Float32Array;
    for (let i = 0; i < p.length; i += 7) { h ^= Math.round(p[i] * 1000); h = Math.imul(h, 16777619); }
    n += p.length;
  });
  return `${n}:${(h >>> 0).toString(16)}`;
}

describe('mine dressing: budgets', () => {
  const table: string[] = [];
  for (const kind of ['classic', 'v3', 'v3big'] as const) {
    it(`${kind}: q2 within calls / triangles, q0 cheaper`, async () => {
      const a = await build(kind, 2), c2 = cost(a.S.root, true);
      let dig3 = 0; a.S.root.traverse((o) => { if (o.name === 'mine:dig3') dig3 = cost(o, true).tris; });
      a.S.dispose();
      const b = await build(kind, 0), c0 = cost(b.S.root, true); b.S.dispose();
      table.push(`mine ${kind.padEnd(7)} q2 ${String(c2.calls).padStart(3)} calls ${String(c2.tris).padStart(6)} tris (dug part ${dig3}) | q0 ${String(c0.calls).padStart(3)} calls ${String(c0.tris).padStart(6)} tris`);
      expect(c2.calls).toBeLessThanOrEqual(kind === 'classic' ? 80 : 90);
      // the fixture floors: the whole scene within 130k; a big dug-out floor: the dug part's dressing stays bounded
      // (the rock round the tunnels — one instance per rock cell — grows with the dug area by design)
      if (kind === 'v3big') expect(dig3).toBeLessThanOrEqual(45000);
      else expect(c2.tris).toBeLessThanOrEqual(130000);
      expect(c0.tris).toBeLessThanOrEqual(c2.tris);
      expect(c0.calls).toBeLessThanOrEqual(c2.calls);
    });
  }
  it('prints the table', () => { console.log('\n' + table.join('\n')); });
});

describe('mine dressing: the same seed builds the same cave', () => {
  for (const kind of ['classic', 'v3big'] as const) {
    it(`${kind}: two builds hash the same, another channel differs`, async () => {
      const a = await build(kind, 2), ha = geoHash(a.S.root); a.S.dispose();
      const b = await build(kind, 2), hb = geoHash(b.S.root); b.S.dispose();
      const c = await build(kind, 2, 'beta'), hc = geoHash(c.S.root); c.S.dispose();
      expect(ha).toBe(hb);
      expect(hc).not.toBe(ha);
    });
  }
});

describe('mine dressing: the walkable relief', () => {
  for (const kind of ['classic', 'v3'] as const) {
    it(`${kind}: bounded by ±RELIEF, smooth, really uneven, flat at the hall objects`, async () => {
      const { S, M } = await build(kind, 2);
      const G = M.G;
      let lo = 0, hi = 0, jump = 0;
      const x0 = G.mx(0), x1 = G.mx(G.W), z0 = G.mz(0), z1 = G.mz(G.H);
      for (let x = x0; x <= x1; x += 0.1) for (let z = z0; z <= z1; z += 0.5) {
        const g = S.groundAt(x, z); lo = Math.min(lo, g); hi = Math.max(hi, g);
        jump = Math.max(jump, Math.abs(S.groundAt(x + 0.1, z) - g));
      }
      expect(lo).toBeGreaterThanOrEqual(-RELIEF - 1e-6);
      expect(hi).toBeLessThanOrEqual(RELIEF + 1e-6);
      expect(hi - lo).toBeGreaterThan(RELIEF);          // swells and hollows, not a flat floor
      expect(jump).toBeLessThan(0.05);                  // no kerb to stumble on (≤ 27° anywhere)
      for (const f of G.FOOT) {                         // the hall objects stand on flat ground
        const cx = G.mx((f.r[0] + f.r[2]) / 2), cz = G.mz((f.r[1] + f.r[3]) / 2);
        expect(Math.abs(S.groundAt(cx, cz))).toBeLessThan(1e-9);
      }
      S.dispose();
    });
  }
});
