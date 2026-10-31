/**
 * The mine lift (src/rooms/mine/props3.ts liftCage, 0.6.2 rebuild): every part of the cage stays in the cage's
 * footprint, the headframe above it and the counterweight column behind it; bars, rails, posts, gate and frame are
 * axis-aligned (only the headframe's braces and the sheave's spokes / rim / drum are turned, on purpose, and they stay
 * in the headframe); no iron block hangs inside the cage (the counterweight is outside, on its guide rails); the ropes
 * are plumb and end on the wheel's tangent points; the gate is closed, inside the frame.
 */
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { liftCage, liftPlan, LIFT_TOP, type LiftRect } from '../src/rooms/mine/props3';

interface Part { kind: string; mat: string; col: string; box: THREE.Box3; turned: boolean; sx?: number; sy?: number; sz?: number }
const UNIT = new THREE.Box3(new THREE.Vector3(-0.5, -0.5, -0.5), new THREE.Vector3(0.5, 0.5, 0.5));
/** A RoomKit stand-in that records every primitive's world AABB and whether it is turned. */
function recKit() {
  const parts: Part[] = [];
  const aabb = (x0: number, x1: number, y0: number, y1: number, z0: number, z1: number) => new THREE.Box3(new THREE.Vector3(Math.min(x0, x1), Math.min(y0, y1), Math.min(z0, z1)), new THREE.Vector3(Math.max(x0, x1), Math.max(y0, y1), Math.max(z0, z1)));
  const q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3();
  const K: any = {
    box(mat: string, col: string, x0: number, x1: number, y0: number, y1: number, z0: number, z1: number) { parts.push({ kind: 'box', mat, col, box: aabb(x0, x1, y0, y1, z0, z1), turned: false, sx: Math.abs(x1 - x0), sy: Math.abs(y1 - y0), sz: Math.abs(z1 - z0) }); },
    bevel(mat: string, col: string, x0: number, x1: number, y0: number, y1: number, z0: number, z1: number) { K.box(mat, col, x0, x1, y0, y1, z0, z1); parts[parts.length - 1].kind = 'bevel'; },
    rbox(mat: string, col: string, cx: number, cy: number, cz: number, sx: number, sy: number, sz: number, ry = 0, rx = 0, rz = 0) {
      const m = new THREE.Matrix4().compose(new THREE.Vector3(cx, cy, cz), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(sx, sy, sz));
      const turned = [rx, ry, rz].some((a) => Math.abs(Math.sin(a * 2)) > 1e-6);
      parts.push({ kind: 'rbox', mat, col, box: UNIT.clone().applyMatrix4(m), turned });
    },
    geo(mat: string, g: THREE.BufferGeometry, m: THREE.Matrix4, col: string) {
      if (!g.boundingBox) g.computeBoundingBox();
      m.decompose(p, q, s);
      const turned = Math.abs(Math.abs(q.w) - 1) > 1e-6;   // any rotation (the sheave's rim, spokes, axle, braces)
      parts.push({ kind: 'geo', mat, col, box: g.boundingBox!.clone().applyMatrix4(m), turned });
    },
    cyl(mat: string, col: string, x: number, y0: number, z: number, r: number, h: number) { parts.push({ kind: 'cyl', mat, col, box: aabb(x - r, x + r, y0, y0 + h, z - r, z + r), turned: false }); },
    cone(mat: string, col: string, x: number, y0: number, z: number, r: number, h: number) { parts.push({ kind: 'cone', mat, col, box: aabb(x - r, x + r, y0, y0 + h, z - r, z + r), turned: false }); },
    ball(mat: string, col: string, x: number, y: number, z: number, r: number) { parts.push({ kind: 'ball', mat, col, box: aabb(x - r, x + r, y - r, y + r, z - r, z + r), turned: false }); },
    glow() { /* light only */ },
  };
  return { K, parts };
}
const rect = (x0: number, x1: number, z0: number, z1: number): LiftRect => ({ x0, x1, z0, z1, cx: (x0 + x1) / 2, cz: (z0 + z1) / 2 });
// the two real footprints: the big floor's lift hall (front +Z, barred, counterweight) and the classic entrance (front −Z, open)
const CASES: [string, LiftRect, 1 | -1, boolean][] = [
  ['v3 (Шахта 3.0)', rect(-1.125, 1.125, -2.475, -0.45), 1, true],
  ['classic', rect(-9.0375, -4.9875, 7.2, 8.7375), -1, false],
];
const EPS = 1e-6;
const within = (b: THREE.Box3, x0: number, x1: number, y0: number, y1: number, z0: number, z1: number) =>
  b.min.x >= x0 - EPS && b.max.x <= x1 + EPS && b.min.y >= y0 - EPS && b.max.y <= y1 + EPS && b.min.z >= z0 - EPS && b.max.z <= z1 + EPS;

describe('mine lift: a clean, solid cage', () => {
  for (const [name, L, front, cage] of CASES) for (const q of [0, 1, 2, 3]) {
    it(`${name} q${q}: every part in its zone, the cage axis-aligned, no block inside, plumb ropes on the wheel's tangents`, () => {
      const ceil = 5.4, P = liftPlan(L, ceil, front, cage), { K, parts } = recKit();
      liftCage(K, L, ceil, front, q, cage);
      expect(parts.length).toBeGreaterThan(q > 0 ? 25 : 8);
      const zLo = Math.min(L.z0, P.bz) - 0.2, zHi = Math.max(L.z1, P.bz) + 0.2;
      const cageZone = (b: THREE.Box3) => within(b, L.x0 - 0.1, L.x1 + 0.1, 0, LIFT_TOP + 0.001, L.z0 - 0.1, L.z1 + 0.1);
      const cwZone = (b: THREE.Box3) => cage && within(b, L.cx - 0.4, L.cx + 0.4, 0, q > 0 ? P.hy + 0.01 : ceil, P.bz - 0.15, P.bz + 0.15);
      const headZone = (b: THREE.Box3) => within(b, L.x0 - 0.25, L.x1 + 0.25, LIFT_TOP - 0.001, ceil + 0.25, zLo, zHi);
      for (const pt of parts) {
        const ok = cageZone(pt.box) || cwZone(pt.box) || headZone(pt.box);
        expect(ok, `${pt.kind} ${pt.mat} ${JSON.stringify(pt.box)} outside the lift`).toBe(true);
        // turned parts only in the headframe (braces, sheave, drum)
        if (pt.turned) expect(headZone(pt.box), `turned ${pt.kind} below the headframe ${JSON.stringify(pt.box)}`).toBe(true);
      }
      // nothing below the top frame is turned: bars, rails, posts, gate, platform are all axis-aligned
      expect(parts.filter((p) => p.turned && p.box.min.y < LIFT_TOP - 0.01)).toEqual([]);
      // no iron block hangs in the cage: no metal part over 0.3 m wide and 0.15 m deep inside it between 0.5 and 2.8 m (the
      // counterweight is 0.44 × 0.22; the lantern's hood is 0.22 across)
      const inside = parts.filter((p) => p.mat === 'metal' && p.box.min.y > 0.5 && p.box.max.y < 2.8 && within(p.box, L.x0 + 0.08, L.x1 - 0.08, 0, 3, L.z0 + 0.08, L.z1 - 0.08));
      expect(inside.filter((p) => p.box.max.x - p.box.min.x > 0.3 && p.box.max.z - p.box.min.z > 0.15)).toEqual([]);
      // the counterweight (big floor) is behind the back wall, outside the cage
      if (cage) {
        const cw = parts.filter((p) => p.mat === 'metal' && p.box.max.x - p.box.min.x > 0.4 && p.box.max.y - p.box.min.y > 0.6);
        expect(cw.length).toBe(1);
        expect(cw[0].box.max.z < L.z0 || cw[0].box.min.z > L.z1).toBe(true);
      }
      if (q > 0) {
        // ropes: thin, vertical, ending at the wheel's axle height on its tangent lines (cz for the cage, bz for the weight)
        const ropes = parts.filter((p) => p.col === '#c8b890' && p.kind === 'box' && p.sy! > 0.3);
        expect(ropes.length).toBe(cage ? 2 : 1);
        for (const r of ropes) {
          expect(r.sx! < 0.06 && r.sz! < 0.06).toBe(true);
          expect(r.box.max.y).toBeCloseTo(P.py, 6);
          const z = (r.box.min.z + r.box.max.z) / 2;
          expect(Math.min(Math.abs(z - L.cz), Math.abs(z - P.bz))).toBeLessThan(1e-6);
          expect(Math.abs(z - P.wz)).toBeCloseTo(P.r, 6);   // a tangent of the wheel
        }
        // the wheel's top stays under the cross-head and above the cage's top frame
        expect(P.py + P.r).toBeLessThanOrEqual(P.hy);
        expect(P.py - P.r).toBeGreaterThan(LIFT_TOP);
      }
      if (cage && q > 0) {
        // the gate: closed, inside the frame on the open side (all its parts in one thin slab at the front)
        const fz = front > 0 ? L.z1 : L.z0;
        const gate = parts.filter((p) => p.mat === 'metal' && p.box.max.y <= 2.2 + EPS && p.box.min.y >= 0.18 && Math.abs((p.box.min.z + p.box.max.z) / 2 - (fz - front * 0.04)) < 0.02);
        expect(gate.length).toBeGreaterThan(10);
        const gx0 = Math.min(...gate.map((p) => p.box.min.x)), gx1 = Math.max(...gate.map((p) => p.box.max.x));
        expect(gx0).toBeCloseTo(L.x0 + 0.07, 6); expect(gx1).toBeCloseTo(L.x1 - 0.07, 6);
        // the bars of the walls: evenly spaced, from the platform up to the top frame
        const bars = parts.filter((p) => p.col === '#4a4458' && p.sy! > 2);
        expect(bars.length).toBeGreaterThan(15);
        for (const b of bars) { expect(b.box.min.y).toBeCloseTo(0.18, 6); expect(b.box.max.y).toBeCloseTo(LIFT_TOP - 0.12, 6); }
        const backZ = front > 0 ? L.z0 : L.z1;
        const back = bars.filter((b) => Math.abs((b.box.min.z + b.box.max.z) / 2 - backZ) < 1e-6).map((b) => (b.box.min.x + b.box.max.x) / 2).sort((a, c) => a - c);
        const gaps = back.slice(1).map((x, i) => x - back[i]);
        for (const g of gaps) expect(g).toBeCloseTo(gaps[0], 6);
      }
    });
  }
});
