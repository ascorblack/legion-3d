/**
 * The cave is a pure function of (channel, floor seed, floor n): the same stream gives every viewer an identical cave
 * (geometry hash of the static batches), another channel a different one; the procedural floor follows the walkable
 * relief (swells and hollows, ±RELIEF, what the player stands on) within a couple of cm and only heaps scree where nobody
 * walks.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import * as THREE from 'three';
import fx3 from './fixtures/mine3-enter.json';
import classic from './fixtures/mine-enter.json';
import { floorHeight, groundHeight, channelOfBase, hashStr, RELIEF, type FloorOpts } from '../src/rooms/mine/rockface';

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
  (globalThis as any).document = { createElement: () => new FakeEl(), body: new FakeEl(), pointerLockElement: null, exitPointerLock() {} };
  (globalThis as any).window = Object.assign(globalThis as any, { addEventListener() {}, removeEventListener() {} });
});

/** FNV hash of every static-batch vertex position (rounded to 0.1 mm). */
function geoHash(root: THREE.Object3D): { h: number; n: number } {
  let h = 2166136261, n = 0;
  root.traverse((o) => {
    let p: THREE.Object3D | null = o, stat = false;
    while (p) { if (p.name === 'mine:static') { stat = true; break; } p = p.parent; }
    const m = o as THREE.Mesh;
    if (!stat || !m.isMesh || !m.geometry?.attributes?.position) return;
    const a = m.geometry.attributes.position.array as Float32Array;
    for (let i = 0; i < a.length; i++) { h ^= Math.round(a[i] * 1e4) & 0xffffffff; h = Math.imul(h, 16777619); }
    n += a.length / 3;
  });
  return { h: h >>> 0, n };
}

async function build(kind: 'classic' | 'v3', channel: string) {
  const { MineScene } = await import('../src/rooms/mine/scene');
  const { MineModel } = await import('../src/rooms/mine/state');
  const M = new MineModel('player999');
  const fx = kind === 'v3' ? fx3 : classic;
  M.take(JSON.parse(JSON.stringify((fx as any).st)), (fx as any).me, null, 1);
  const S = new MineScene({ quality: 2, login: 'player999', channel, geom: kind === 'v3' ? M.G : undefined } as any);
  S.setView(M, []);
  return S;
}

describe('mine cave: seeded by channel + floor', () => {
  it('reads the channel from LG_BASE', () => {
    expect(channelOfBase('/c/SomeStreamer')).toBe('somestreamer');
    expect(channelOfBase('https://play.multidonate.ru/c/abc/x')).toBe('abc');
    expect(channelOfBase('')).toBe('');
    expect(hashStr('a')).not.toBe(hashStr('b'));
  });
  for (const kind of ['classic', 'v3'] as const) {
    it(`${kind}: same channel → identical cave, another channel → a different one`, async () => {
      const a1 = await build(kind, 'alpha'), a2 = await build(kind, 'alpha'), b = await build(kind, 'beta');
      const h1 = geoHash(a1.root), h2 = geoHash(a2.root), h3 = geoHash(b.root);
      expect(h1.n).toBeGreaterThan(1000);
      expect(h1.h).toBe(h2.h);
      expect(h1.h).not.toBe(h3.h);
      expect(a1.caveSeed).toBe(a2.caveSeed);
      for (const s of [a1, a2, b]) s.dispose();
    });
  }
  it('walkable ground stays within ±2.5 cm (+3 cm ruts); scree only off the walkway', () => {
    const o: FloorOpts = { x0: -10, x1: 10, z0: -10, z1: 10, cell: 0.5, seed: 321, floor: '#555555', floorL: '#777777', dark: '#222222',
      walk: (x) => Math.abs(x) < 6, worn: () => 0.3, wallDist: (x) => 10 - Math.abs(x), ruts: [0, -5, 0, 5] };
    let maxOff = 0;
    for (let x = -10; x <= 10; x += 0.137) for (let z = -10; z <= 10; z += 0.173) {
      const y = floorHeight(o, x, z);
      if (Math.abs(x) < 6) { expect(y).toBeLessThanOrEqual(0.0101); expect(y).toBeGreaterThanOrEqual(-0.0501); }
      else { expect(y).toBeGreaterThanOrEqual(0); maxOff = Math.max(maxOff, y); }
    }
    expect(maxOff).toBeGreaterThan(0.2);   // scree really heaps up at the walls
    // with walkable relief (swells and hollows, ±RELIEF): the rendered floor stays within (+1 cm, −2 cm − 3 cm rut) of what
    // the player walks on (groundHeight)
    const r: FloorOpts = { ...o, relief: RELIEF, reliefK: (x) => (Math.abs(x) < 1 ? 0 : 1) };
    let dipped = 0, raised = 0;
    for (let x = -5.9; x <= 5.9; x += 0.21) for (let z = -10; z <= 10; z += 0.19) {
      const g = groundHeight(r, x, z), y = floorHeight(r, x, z);
      expect(Math.abs(g)).toBeLessThanOrEqual(RELIEF + 1e-6);
      expect(y - g).toBeLessThanOrEqual(0.0101); expect(y - g).toBeGreaterThanOrEqual(-0.0501);
      if (Math.abs(x) < 1) expect(g).toBe(0);
      if (g < -0.06) dipped++;
      if (g > 0.06) raised++;
    }
    expect(dipped).toBeGreaterThan(50);   // the hollows are really there
    expect(raised).toBeGreaterThan(50);   // and the swells
  });
  it('the scene exposes the walking height: swells and hollows in the open, flat at the hall objects', async () => {
    const S = await build('classic', 'alpha');
    let min = 0, max = 0; for (let x = -7; x <= 7; x += 0.5) for (let z = -25; z <= -3; z += 0.5) { min = Math.min(min, S.groundAt(x, z)); max = Math.max(max, S.groundAt(x, z)); }
    expect(min).toBeLessThan(-0.08); expect(max).toBeGreaterThan(0.08);
    for (const k of ['lift', 'board', 'buyer', 'lamp']) { const f = (S as any).footM(k); expect(S.groundAt(f.cx, f.cz)).toBe(0); }
    S.dispose();
  });
});
