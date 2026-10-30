import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { eventCity, eventHarness } from './events-fixture';
import { planHalloween, Grid, clearOfDoors, DOOR_CLEAR, PUMPKIN_HALF } from '../src/events/halloween/placement';
import { pumpkinGeometry, batGeometry, ghostGeometry } from '../src/events/halloween/geo';
import { jackFaceTexture, fogTexture, webTexture, glowTexture } from '../src/events/halloween/tex';
import halloween, { HALLOWEEN_BUDGET } from '../src/events/halloween';

const city = eventCity();
const plan = planHalloween(city.place);
const boxDist = (x: number, z: number, b: number[]) => Math.hypot(Math.max(b[0] - x, 0, x - b[1]), Math.max(b[2] - z, 0, z - b[3]));

describe('halloween placement', () => {
  it('is deterministic and rich enough', () => {
    const again = planHalloween(city.place);
    expect(JSON.stringify(again)).toBe(JSON.stringify(plan));
    expect(plan.clusters.length).toBeGreaterThanOrEqual(24);
    const items = plan.clusters.flatMap((c) => c.items);
    expect(items.length).toBeGreaterThan(80);
    expect(items.filter((i) => i.kind).length).toBeGreaterThanOrEqual(16);
    expect(plan.fog.length).toBeGreaterThanOrEqual(8);
    expect(plan.ghosts.length).toBeGreaterThanOrEqual(4);
    // all four kinds of spot are used
    expect(new Set(plan.clusters.map((c) => c.tag))).toEqual(new Set(['door', 'stair', 'edge', 'wall']));
  });
  it('every pumpkin stands on flat open ground: never floats, never inside a solid', () => {
    for (const c of plan.clusters) for (const it of c.items) {
      const base = it.y - it.r * PUMPKIN_HALF;   // lowest point
      const stacked = it.y > city.place.groundAt(it.x, it.z) + it.r * (PUMPKIN_HALF + 0.3);
      if (!stacked) {
        expect(Math.abs(base - city.place.groundAt(it.x, it.z)), `ground ${it.x.toFixed(2)},${it.z.toFixed(2)}`).toBeLessThan(0.005);
        for (const [dx, dz] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const X = it.x + dx * it.r, Z = it.z + dz * it.r;
          expect(city.place.top(X, Z), `solid at ${X.toFixed(2)},${Z.toFixed(2)}`).toBe(-Infinity);
          expect(Math.abs(city.place.groundAt(X, Z) - city.place.groundAt(it.x, it.z)), 'flat').toBeLessThan(0.03);
        }
      }
    }
  });
  it('keeps ≥ 0.6 m from every door interactable and 1.8 m from the spawn', () => {
    for (const c of plan.clusters) for (const it of c.items) {
      for (const d of city.place.doors) expect(boxDist(it.x, it.z, d.box) - it.r, `door ${d.x}`).toBeGreaterThanOrEqual(DOOR_CLEAR - 1e-6);
      expect(Math.hypot(it.x - city.spawn.x, it.z - city.spawn.z) - it.r).toBeGreaterThanOrEqual(1.8 - 1e-6);
    }
    expect(clearOfDoors(city.place, city.place.doors[0].x, city.place.doors[0].z, 0.2)).toBe(false);
  });
  it('pumpkins hug walls and props: none in the open middle of the street, none on stairs, none in the water', () => {
    const g = new Grid(city.place);
    for (const c of plan.clusters) {
      const m = c.items[0];
      expect(g.distAt(m.x, m.z), `${c.tag} ${m.x.toFixed(1)},${m.z.toFixed(1)}`).toBeLessThan(0.75);
      for (const [s0, s1] of city.place.stairs) if (m.x > s0 - 0.01 && m.x < s1 + 0.01) expect(Math.abs(m.z - 5.5) > 1.6 || m.z < city.place.ledgeZ - 0.4 || m.z > 6.9, 'on a stair ramp').toBe(true);
    }
  });
  it('fog patches lie on flat ground over their whole disc; ghosts hover above head height off the door lanes', () => {
    const g = new Grid(city.place);
    for (const f of plan.fog) { expect(g.flat(f.x, f.z, f.r * 0.8, 0.03), 'fog flat').toBe(true); expect(f.y).toBeCloseTo(city.place.groundAt(f.x, f.z), 3); }
    for (const gh of plan.ghosts) {
      expect(gh.y - city.place.groundAt(gh.x, gh.z)).toBeGreaterThan(2.2);
      expect(city.place.top(gh.x, gh.z)).toBe(-Infinity);
      for (const d of city.place.doors) expect(Math.abs(gh.x - d.x) < 1.6 && gh.z < d.z + 2.5, 'door lane').toBe(false);
    }
  });
  it('wall lanterns hang beside upper-street doors: ≥ 0.6 m clear of every door box, above head height, in front of a facade', () => {
    expect(plan.lanterns.length).toBeGreaterThanOrEqual(10);
    for (const w of plan.lanterns) {
      for (const d of city.place.doors) expect(boxDist(w.x, w.z, d.box) - 0.17, `door ${d.x.toFixed(1)}`).toBeGreaterThanOrEqual(DOOR_CLEAR - 1e-6);
      expect(w.y - city.place.groundAt(w.x, w.z)).toBeGreaterThan(2.0);
      expect(city.place.top(w.x, w.wallZ - 0.1), 'the bracket starts inside the facade').not.toBe(-Infinity);
      expect(city.place.top(w.x, w.z) === -Infinity || city.place.top(w.x, w.z) < 1.4, 'the lantern itself hangs in open air').toBe(true);
      expect(w.z - w.wallZ).toBeGreaterThan(0.3);
    }
  });
  it('clusters do not overlap each other', () => {
    const items = plan.clusters.flatMap((c) => c.items.filter((i) => i.y < city.place.groundAt(i.x, i.z) + i.r + 0.01));
    for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) {
      const a = items[i], b = items[j];
      expect(Math.hypot(a.x - b.x, a.z - b.z), `${i}/${j}`).toBeGreaterThan((a.r + b.r) * 0.55);
    }
  });
});

describe('halloween geometry + textures (built on the CPU)', () => {
  it('pumpkin: lowest point matches PUMPKIN_HALF, radius ≈ 1, a few hundred triangles', () => {
    const g = pumpkinGeometry(); g.computeBoundingBox();
    expect(g.boundingBox!.min.y).toBeCloseTo(-PUMPKIN_HALF, 1);
    expect(Math.abs(g.boundingBox!.min.x)).toBeLessThan(1.1);
    expect(g.getAttribute('position').count / 3).toBeLessThan(400);
    expect(g.getAttribute('color')).toBeTruthy(); expect(g.getAttribute('uv')).toBeTruthy();
  });
  it('bat and ghost are small and cheap', () => {
    const b = batGeometry(); b.computeBoundingBox(); const s = b.boundingBox!.getSize(new THREE.Vector3());
    expect(s.x).toBeGreaterThan(0.5); expect(s.x).toBeLessThan(0.8); expect(b.getAttribute('position').count / 3).toBeLessThan(150);
    const g = ghostGeometry(); g.computeBoundingBox(); const gs = g.boundingBox!.getSize(new THREE.Vector3());
    expect(gs.y).toBeGreaterThan(0.55); expect(gs.y).toBeLessThan(0.8); expect(g.getAttribute('position').count / 3).toBeLessThan(1000);
  });
  it('textures: the face map is black outside the carving and lit inside; fog/web/glow have soft alpha', () => {
    const face = jackFaceTexture(), d = face.image.data as Uint8Array, W = face.image.width, H = face.image.height;
    const px = (x: number, y: number) => d[(y * W + x) * 4];
    expect(px(2, 2)).toBe(0); expect(px(W - 3, H - 3)).toBe(0);
    let lit = 0; for (let i = 0; i < W * H; i++) if (d[i * 4] > 200) lit++;
    expect(lit / (W * H)).toBeGreaterThan(0.01); expect(lit / (W * H)).toBeLessThan(0.1);
    for (const t of [fogTexture(64), webTexture(64), glowTexture(32)]) {
      const a = t.image.data as Uint8Array; let mn = 255, mx = 0; for (let i = 3; i < a.length; i += 4) { mn = Math.min(mn, a[i]); mx = Math.max(mx, a[i]); }
      expect(mn).toBe(0); expect(mx).toBeGreaterThan(100);
    }
  });
});

const info = (g: THREE.Object3D): any => { let r: any = null; g.traverse((o) => { if (o.userData.halloween) r = o.userData.halloween; }); return r; };
const drawables = (root: THREE.Object3D) => {
  const out: THREE.Object3D[] = [];
  root.traverse((o) => { const m = o as THREE.Mesh; if ((m.isMesh || (o as THREE.Points).isPoints || (o as THREE.LineSegments).isLine) && (o.userData.viewCulled || (o.visible && ((m as THREE.InstancedMesh).isInstancedMesh ? (m as THREE.InstancedMesh).count > 0 : true)))) out.push(o); });   // view-culled meshes count as drawn (upper bound)
  return out;
};
const tris = (os: THREE.Object3D[]) => os.reduce((a, o) => {
  const g = (o as THREE.Mesh).geometry as THREE.BufferGeometry; if (!(o as THREE.Mesh).isMesh) return a;
  const n = (g.index ? g.index.count : g.getAttribute('position').count) / 3; return a + n * ((o as THREE.InstancedMesh).isInstancedMesh ? (o as THREE.InstancedMesh).count : 1);
}, 0);

describe('halloween event lifecycle', () => {
  it('q2 budget: ≤ 15 draw calls, instanced; CPU well under 0.5 ms/frame', () => {
    const h = eventHarness(2);
    const dispose = halloween.setup(h.ctx);
    const per = h.frame(300);
    const objs = drawables(h.ctx.group);
    expect(objs.length).toBeLessThanOrEqual(15);
    expect(objs.length).toBeGreaterThanOrEqual(7);
    expect(h.ctx.group.getObjectByName('halloween:bunting')!.visible).toBe(true);
    expect(tris(objs)).toBeLessThan(60000);
    // node has no GPU: this is pure JS update cost of bats / ghosts / fog / flicker
    expect(per).toBeLessThan(0.5);
    // no real lights added, nothing casts shadows
    h.ctx.group.traverse((o) => { expect((o as THREE.Light).isLight).toBeFalsy(); expect(o.castShadow).toBeFalsy(); });
    dispose();
  });
  it('quality levels scale the content: fewer bats / fog / pumpkins / ghosts at q0–1', () => {
    const counts = ([0, 1, 2, 3] as const).map((q) => {
      const h = eventHarness(q); const dispose = halloween.setup(h.ctx); h.frame(5);
      const get = (n: string) => (h.ctx.group.getObjectByName(n) as THREE.InstancedMesh);
      const c = info(h.ctx.group).counts();
      const r = { calls: drawables(h.ctx.group).length, bats: get('halloween:bats').count, fog: c.fog, ghosts: c.ghosts, pumpkins: c.pumpkins };
      dispose(); return r;
    });
    for (let i = 1; i < 4; i++) for (const k of ['bats', 'fog', 'ghosts', 'pumpkins'] as const) expect(counts[i][k], `${k} q${i}`).toBeGreaterThanOrEqual(counts[i - 1][k]);
    expect(counts[0].fog).toBe(0);
    expect(counts[0].bats).toBeLessThanOrEqual(HALLOWEEN_BUDGET[0].bats);
    expect(counts[2].calls).toBeLessThanOrEqual(15);
    // a live quality change re-applies the budget
    const h = eventHarness(3); const dispose = halloween.setup(h.ctx); h.frame(2);
    const bats = h.ctx.group.getObjectByName('halloween:bats') as THREE.InstancedMesh; const n3 = bats.count;
    h.setQuality(0); expect(bats.count).toBeLessThan(n3);
    h.setQuality(3); expect(bats.count).toBe(n3);
    dispose();
  });
  it('decals: light pools ≥ 6 mm and fog ≥ 10 cm above the ground, webs 12 mm off their wall; the two fog layers never share a height', () => {
    const h = eventHarness(2); const dispose = halloween.setup(h.ctx); h.frame(60);
    const dec = h.ctx.group.getObjectByName('halloween:decals') as THREE.InstancedMesh, m = new THREE.Matrix4(), p = new THREE.Vector3();
    const aA = dec.geometry.getAttribute('aA');
    let pools = 0, blobs = 0;
    for (let i = 0; i < dec.count; i++) {
      dec.getMatrixAt(i, m); p.setFromMatrixPosition(m);
      if (aA.getX(i) < 0) pools++; else blobs++;
      expect(p.y - city.place.groundAt(p.x, p.z), aA.getX(i) < 0 ? 'pool' : 'blob').toBeGreaterThanOrEqual(0.006);
    }
    expect(pools).toBeGreaterThan(10);
    expect(blobs).toBeGreaterThan(40);
    const fw = h.ctx.group.getObjectByName('halloween:fogweb') as THREE.InstancedMesh, aK = fw.geometry.getAttribute('aK');
    const c = info(h.ctx.group).counts();
    expect(fw.count).toBe(c.fog * 2 + c.webs);
    for (let i = 0; i < c.fog * 2; i += 2) {
      expect(aK.getX(i)).toBe(0);
      fw.getMatrixAt(i, m); p.setFromMatrixPosition(m); const g = city.place.groundAt(p.x, p.z);
      const y0 = p.y - g; fw.getMatrixAt(i + 1, m); p.setFromMatrixPosition(m); const y1 = p.y - g;
      expect(y0).toBeGreaterThan(0.1); expect(Math.abs(y1 - y0)).toBeGreaterThan(0.1);
      // lies flat: the quad's normal (local +Z) points up
      const n = new THREE.Vector3(0, 0, 1).transformDirection(m); expect(Math.abs(n.y)).toBeGreaterThan(0.99);
    }
    expect(c.webs).toBeGreaterThan(0);                       // the fake wall at z = 0 is found by the rays
    const corner = new THREE.Vector3();
    for (let i = c.fog * 2; i < fw.count; i++) {
      expect(aK.getX(i)).toBe(1);
      fw.getMatrixAt(i, m);
      corner.set(-0.5, 0.5, 0).applyMatrix4(m);              // the web hangs from its top-left corner, on the wall
      expect(corner.z).toBeCloseTo(0.012, 3);
    }
    dispose();
  });
  it('toggle off restores everything: scene, group, hooks, garland bulbs, sky, moon, fog colour, geometries', () => {
    const h = eventHarness(3), f = h.fake;
    const bulbCol = Array.from((f.bulbs.geometry.getAttribute('color').array as Float32Array));
    const sky = Object.fromEntries(Object.entries((f.dome.material as THREE.ShaderMaterial).uniforms).map(([k, u]) => [k, (u.value as THREE.Color).getHex()]));
    const moonScale = f.moon.scale.toArray(), moonCol = (f.moon.material as THREE.SpriteMaterial).color.getHex();
    const fogCol = (h.scene.fog as THREE.Fog).color.getHex(), bg = (h.scene.background as THREE.Color).getHex();
    const before = { sceneKids: h.scene.children.length, rootKids: f.root.children.length, groupKids: h.ctx.group.children.length };
    const disposed: string[] = [];
    const hookGeo = (g: THREE.BufferGeometry) => g.addEventListener('dispose', () => disposed.push(g.uuid));

    const dispose = halloween.setup(h.ctx);
    h.ctx.group.traverse((o) => { const g = (o as THREE.Mesh).geometry as THREE.BufferGeometry | undefined; if (g) hookGeo(g); });
    h.frame(40);
    // while on: garland bulbs re-coloured, sky tinted, moon bigger, group filled, frame hooks registered
    expect(Array.from(f.bulbs.geometry.getAttribute('color').array as Float32Array)).not.toEqual(bulbCol);
    expect((f.dome.material as THREE.ShaderMaterial).uniforms.c2.value.getHex()).not.toBe(sky.c2);
    expect(f.moon.scale.x).toBeGreaterThan(moonScale[0]);
    expect((h.scene.fog as THREE.Fog).color.getHex()).not.toBe(fogCol);
    expect(h.ctx.group.getObjectByName('event:halloween')!.children.length).toBeGreaterThan(5);
    expect(h.hooks).toBeGreaterThan(0);

    dispose();
    expect(h.ctx.group.children.length).toBe(before.groupKids);
    expect(h.scene.children.length).toBe(before.sceneKids);
    expect(f.root.children.length).toBe(before.rootKids);
    expect(h.hooks, 'frame / quality hooks released').toBe(0);
    expect(Array.from(f.bulbs.geometry.getAttribute('color').array as Float32Array)).toEqual(bulbCol);
    for (const [k, u] of Object.entries((f.dome.material as THREE.ShaderMaterial).uniforms)) expect((u.value as THREE.Color).getHex(), 'sky ' + k).toBe(sky[k]);
    expect(f.moon.scale.toArray()).toEqual(moonScale); expect((f.moon.material as THREE.SpriteMaterial).color.getHex()).toBe(moonCol);
    expect((h.scene.fog as THREE.Fog).color.getHex()).toBe(fogCol); expect((h.scene.background as THREE.Color).getHex()).toBe(bg);
    expect(disposed.length, 'geometries disposed').toBeGreaterThanOrEqual(8);
    // a second on/off cycle works the same (no leftover state)
    const d2 = halloween.setup(h.ctx); h.frame(10); d2();
    expect(h.ctx.group.children.length).toBe(0); expect(Array.from(f.bulbs.geometry.getAttribute('color').array as Float32Array)).toEqual(bulbCol);
  });
});

describe('halloween against the real paving mesh', () => {
  it('rays straight down hit the paving exactly where the pumpkin base is: no hovering, no sinking', async () => {
    const { staticCity } = await import('./world-fixture');
    const { k } = staticCity();
    const mats: Record<string, THREE.Material> = {};
    for (const key of ['brick', 'plaster', 'wood', 'roof', 'stone', 'rock', 'metal', 'canvas', 'paving', 'lowPaving', 'leaf', 'flat', 'dark', 'glass', 'back', 'emit', 'glow', 'sign', 'water']) mats[key] = new THREE.MeshBasicMaterial();
    const meshes = k.b.build(mats as never, { castShadow: () => false, receiveShadow: () => false });
    const rc = new THREE.Raycaster(); let n = 0;
    for (const c of plan.clusters) for (const it of c.items) {
      if (it.y > city.place.groundAt(it.x, it.z) + it.r * 1.9) continue;      // stacked on another pumpkin
      rc.set(new THREE.Vector3(it.x, 3, it.z), new THREE.Vector3(0, -1, 0)); rc.far = 6;
      const hit = rc.intersectObjects(meshes, false).find((h) => h.object.name !== 'city:back');
      expect(hit, `paving under ${it.x.toFixed(2)},${it.z.toFixed(2)}`).toBeTruthy();
      expect(Math.abs(hit!.point.y - (it.y - it.r * PUMPKIN_HALF)), `base on the paving at ${it.x.toFixed(2)},${it.z.toFixed(2)} r ${it.r.toFixed(2)} hit ${hit!.object.name} y ${hit!.point.y.toFixed(3)}`).toBeLessThan(0.012);
      n++;
    }
    expect(n).toBeGreaterThan(80);
  });
});
