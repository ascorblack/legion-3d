// Civic models of the new fair (src/world/fcart/civic.ts): each builds standalone into a Ctx — within its place, ≤ 6
// batch materials, a sane triangle count, a door outline (static triangles fully inside the door box) — and the jail
// pushes its own solids (carrier + cage with a finite floor).
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { Batch } from '../src/world/batch';
import { Instancer } from '../src/world/instancer';
import { paletteOf } from '../src/world/palette';
import { rng } from '../src/world/textures';
import type { Ctx } from '../src/world/kit';
import type { SignAtlas } from '../src/world/textures';
import { toX, toZ } from '../src/world/coords';
import { fcModel, type FcPlace } from '../src/world/fcart/registry';
import { civicDoorXf } from '../src/world/fcart/civic';
import FIX from './fixtures/faircats-map.json';
import { ZRecorder } from '../src/world/zfight';

const REFS = ['hall', 'magic', 'jail', 'storage', 'gate', 'mine'];
export function civicCtx(): Ctx {
  const signs = { add: () => ({ uv: [0, 0, 1, 1] as [number, number, number, number], aspect: 4 }), texture: null } as unknown as SignAtlas;
  return { b: new Batch(1000), pal: paletteOf('cats'), signs, inst: new Instancer(), glows: [], lights: [], bulbs: [], wires: [], rnd: rng(1), quality: 2, lowH: 0, wallZ: 0, colliders: [], pools: [], solids: [], blobs: [] };
}
export function civicPlace(ref: string, base = 0): FcPlace {
  const b = (FIX as any).BUILDINGS.find((x: any) => x.id === ref);
  return { vis: b.vis, foot: b.foot, door: b.door, base, data: ref === 'jail' ? { jail: { ...(FIX as any).JAIL, x0: b.foot[0], x1: b.foot[2], base: b.foot[3], door: [4263, 4331], seats: (FIX as any).JAIL.seats } } : {} };
}
/** Build one model: per-material triangle lists (world space). */
export function buildCivic(ref: string, base = 0) {
  const k = civicCtx(), p = civicPlace(ref, base), tris = new Map<string, number[]>();
  k.b.recorder = (mat, g) => {
    const pos = g.attributes.position as THREE.BufferAttribute; let a = tris.get(mat); if (!a) tris.set(mat, (a = []));
    for (let i = 0; i < pos.count; i++) a.push(pos.getX(i), pos.getY(i), pos.getZ(i));
  };
  fcModel(ref)!.build(k, p);
  return { k, p, tris };
}

describe('fcart civic models', () => {
  for (const ref of REFS) it(ref + ': in place, ≤ 6 materials, tris budget, door outline', () => {
    const { k, p, tris } = buildCivic(ref, ref === 'magic' || ref === 'mine' ? 1.4 : 0);
    expect(fcModel(ref)?.fp).toMatch(/^[0-9a-f]{14}$/);
    const mats = [...tris.keys()];
    expect(mats.length).toBeLessThanOrEqual(6);
    let n = 0; const bb = new THREE.Box3();
    for (const a of tris.values()) { n += a.length / 9; for (let i = 0; i < a.length; i += 3) bb.expandByPoint(new THREE.Vector3(a[i], a[i + 1], a[i + 2])); }
    expect(n).toBeGreaterThan(300);
    expect(n).toBeLessThan(9000);
    // x within the drawn box (+ the jail's cage beyond it, the mine's rock collar), the base on its level (never sunk)
    const x0 = toX(p.vis[0]) - (ref === 'mine' ? 1.5 : 0.5), x1 = toX(ref === 'jail' ? 4430 : p.vis[2]) + (ref === 'mine' ? 1.5 : 0.5);
    expect(bb.min.x).toBeGreaterThan(x0); expect(bb.max.x).toBeLessThan(x1);
    expect(bb.min.y).toBeGreaterThan(p.base - 0.15);
    expect(bb.max.y - p.base).toBeGreaterThan(3); expect(bb.max.y - p.base).toBeLessThan(14);
    // the front: nothing big further out than 1.6 m in front of foot[3] (the gate: in front of foot[1] towards the town)
    if (ref !== 'gate') expect(bb.max.z).toBeLessThan(toZ(p.foot[3]) + 1.6);
    else expect(bb.min.z).toBeGreaterThan(toZ(p.foot[1]) - 1.0);
    // door outline: the static triangles fully inside the door region (engine/outline.ts fitOutlineProxy rules)
    const d = civicDoorXf(ref, p)!, dx = toX(p.door!.x);
    const R = ref === 'jail'
      ? new THREE.Box3(new THREE.Vector3(toX(p.vis[0]) + 0.1, p.base, d.zE - 0.45), new THREE.Vector3(toX(p.vis[2]), p.base + 2.3, toZ(p.vis[3]) + 0.13))
      : new THREE.Box3(new THREE.Vector3(dx - d.hw, p.base, d.zE - 0.45), new THREE.Vector3(dx + d.hw, p.base + d.h, d.zE + 0.13));
    const eps = 0.02, inside = (x: number, y: number, z: number) => x >= R.min.x - eps && x <= R.max.x + eps && y >= R.min.y - 0.012 && y <= R.max.y + eps && z >= R.min.z - eps && z <= R.max.z + eps;
    let inTris = 0; const ob = new THREE.Box3();
    for (const a of tris.values()) for (let i = 0; i < a.length; i += 9) {
      const ok = [0, 3, 6].every((o) => inside(a[i + o], a[i + o + 1], a[i + o + 2])) && ![0, 3, 6].every((o) => a[i + o + 1] < R.min.y + 0.05);
      if (ok) { inTris++; for (const o of [0, 3, 6]) ob.expandByPoint(new THREE.Vector3(a[i + o], a[i + o + 1], a[i + o + 2])); }
    }
    expect(inTris).toBeGreaterThan(20);
    // the outline is the door: it spans most of the door box's width and height
    if (ref !== 'jail') { expect(ob.max.x - ob.min.x).toBeGreaterThan(d.hw * 1.4); expect(ob.max.y - p.base).toBeGreaterThan(d.h * 0.7); }
    console.log(`[civic] ${ref}: mats ${mats.length} (${mats.join(',')}) tris ${Math.round(n)} outline ${inTris} tris ${ob.min.x.toFixed(2)}…${ob.max.x.toFixed(2)} × ${(ob.max.y - p.base).toFixed(2)} m`);
    void k;
  });
  for (const ref of REFS) it(ref + ': no coplanar overlaps (z-fighting)', () => {
    const k = civicCtx(), p = civicPlace(ref), rec = new ZRecorder(); rec.keepBoxes = true;
    k.b.tag = ref; k.b.recorder = rec.add;
    fcModel(ref)!.build(k, p);
    const hits = rec.find(0.004, 2e-4, () => p.base);
    if (hits.length) console.log(hits.slice(0, 40).map((h) => `${ref} ${h.a}×${h.b} at ${h.at.map((v) => v.toFixed(2)).join(',')} n ${h.normal.map((v) => v.toFixed(1)).join(',')} A ${h.area.toFixed(4)} ia ${h.ia} ${rec.boxes[h.ia]?.map((v) => v.toFixed(2)).join(' ')} | ib ${h.ib} ${rec.boxes[h.ib]?.map((v) => v.toFixed(2)).join(' ')}`).join('\n'));
    expect(hits.length).toBe(0);
  });
  it('jail: the carrier and the cage push their own solids, the cage floor finite (prisoners stand on it)', () => {
    const { k } = buildCivic('jail');
    const S = k.solids!, fin: number[] = [];
    for (let i = 0; i < S.length; i += 5) if (S[i + 4] !== Infinity) fin.push(S[i + 4]);
    expect(S.length / 5).toBeGreaterThanOrEqual(6);
    expect(fin).toEqual([0.03]);
    const J = (FIX as any).JAIL, walk = J.walk;
    // every walk cell of the cage is on the finite floor, inside the bars
    const onFloor = (x: number, z: number) => { for (let i = 0; i < S.length; i += 5) if (x >= S[i] && x <= S[i + 1] && z >= S[i + 2] && z <= S[i + 3]) return S[i + 4]; return null; };
    for (const [x, y] of [[walk[0], walk[1]], [walk[2], walk[3]], [(walk[0] + walk[2]) / 2, (walk[1] + walk[3]) / 2]]) expect(onFloor(toX(x), toZ(y))).toBe(0.03);
  });
});
