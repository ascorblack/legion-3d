/**
 * Geometry lint (src/world/lint) over every town the dev fixtures build: the old fair, the new cats fair, the camp,
 * the hand villages (cats + the cherts quarter), a Town Kit town — plus every room, both mine floors (geo1 / geo3)
 * and an expedition stage (test/geom-lint-scenes.test.ts).
 *
 * Hard classes fail on any finding (allowlist: src/world/lint/allow.ts, each entry with a reason). Classes that still
 * find existing issues are report-only with a ratchet: the per-town count must not grow above
 * test/fixtures/lint-baseline.json (lower it as fixes land: `LINT_WRITE=1 npx vitest run test/geom-lint --no-file-parallelism` rewrites it
 * with the current counts — only ever commit a lower one).
 */
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { lintWorld, LINT_ALLOW, LintCollector } from '../src/world/lint';
import { Instancer, part } from '../src/world/instancer';
import { lanternHead } from '../src/world/protoProps';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { lintTown, TOWNS, ratchet } from './geom-lint-fixture';

describe('geometry lint: towns', () => {
  it('every allowlist entry has a reason', () => {
    expect(LINT_ALLOW.filter((a) => !a.why || a.why.trim().length < 8)).toEqual([]);
  });
  it('the lamp class: lanternHead() passes, a bare emissive box and a cap off the post do not', () => {
    const lamp = (head: 'kit' | 'box' | 'gap') => {
      const inst = new Instancer(), box = new THREE.BoxGeometry(1, 1, 1), cyl = new THREE.CylinderGeometry(0.5, 0.5, 1, 6), cone = new THREE.ConeGeometry(0.5, 1, 4), H = 2.6;
      const post = [part(cyl, '#444', 0, 0.09, 0, 0.34, 0.18, 0.34), part(cyl, '#444', 0, (H - 0.2) / 2, 0, 0.09, H - 0.2, 0.09)];
      if (head === 'kit') { const [f, c] = lanternHead('#444'); f.translate(0, H, 0); c.translate(0, H, 0); inst.registerKind('t:lamp', [{ mat: 'metal', geo: mergeGeometries([...post, f], false)! }, { mat: 'emit', geo: c }]); }
      else inst.registerKind('t:lamp', [{ mat: 'metal', geo: mergeGeometries([...post, part(box, '#444', 0, H - 0.2, 0, 0.3, 0.05, 0.3), part(cone, '#444', 0, H + (head === 'gap' ? 0.4 : 0.27), 0, 0.42, 0.22, 0.42)], false)! }, { mat: 'emit', geo: part(box, '#fe9', 0, H, 0, 0.2, 0.32, 0.2) }]);
      inst.add('t:lamp', 0, 0, 0);
      const col = new LintCollector(); col.addInstances(inst);
      return lintWorld({ where: 'unit', pieces: col.pieces, groundAt: () => 0 }, { only: ['lamp', 'float'] }).findings.map((f) => f.cls);
    };
    expect(lamp('kit')).toEqual([]);
    expect(lamp('box')).toContain('lamp');
    expect(lamp('gap')).toContain('lamp');
  });

  it('ledge / plane: a box through a round tower and a real slanted slab are found; a board in front of the tower, a gable pair, a beam along a slope are not', () => {
    const run = (fn: (add: (g: THREE.BufferGeometry, m: THREE.Matrix4) => void) => void, only: 'ledge' | 'plane') => {
      const col = new LintCollector(() => 1);
      fn((g, m) => { const h = g.clone().applyMatrix4(m); col.add('stone', h.index ? h.toNonIndexed() : h, 'unit', 'stone|1'); });
      return lintWorld({ where: 'unit', pieces: col.pieces, groundAt: () => 0 }, { only: [only] }).findings.length;
    };
    const tower = new THREE.CylinderGeometry(1.2, 1.2, 6, 20), box = new THREE.BoxGeometry(1, 1, 1), M = (x: number, y: number, z: number, sx: number, sy: number, sz: number) => new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion(), new THREE.Vector3(sx, sy, sz));
    // a 3 m ledge through the tower at mid-height: found; the same board 0.05 m in front of its wall: not
    expect(run((add) => { add(tower, M(0, 3, 0, 1, 1, 1)); add(box, M(0, 3, 0.6, 3, 0.2, 0.6)); }, 'ledge')).toBe(1);
    expect(run((add) => { add(tower, M(0, 3, 0, 1, 1, 1)); add(box, M(0, 3, 1.3, 1.8, 0.4, 0.06)); }, 'ledge')).toBe(0);
    // a parallelogram slab 4 × 2.5 m (vertical sides, inclined top / bottom): found
    const para = new THREE.BoxGeometry(4, 2.5, 0.2); para.applyMatrix4(new THREE.Matrix4().makeShear(0, 0, 0.35, 0, 0, 0));
    expect(run((add) => add(para, M(0, 2, 0, 1, 1, 1)), 'plane')).toBe(1);
    // two gable ends of one roof (one piece, 3.3 m apart) and a 3.8 m beam laid along a 30° slope: not
    const gable = new THREE.BufferGeometry(), tri = (x: number) => [x, 0, -1.5, x, 0, 1.5, x, 1.6, 0];
    gable.setAttribute('position', new THREE.Float32BufferAttribute([...tri(-1.65), ...tri(1.65)], 3));
    expect(run((add) => add(gable, M(0, 2.5, 0, 1, 1, 1)), 'plane')).toBe(0);
    const beam = new THREE.BoxGeometry(3.8, 0.1, 0.1); beam.rotateZ(0.52);
    expect(run((add) => add(beam, M(0, 3, 0, 1, 1, 1)), 'plane')).toBe(0);
  });

  for (const [where, mk] of TOWNS) {
    it(where, () => {
      const src = lintTown(where, mk());
      const r = lintWorld(src);
      ratchet(r);
    }, 60000);
  }
});
