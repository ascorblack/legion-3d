import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { eventCity, eventHarness, withRealStatic } from './events-fixture';
import { planHalloween, Grid, clearOfDoors } from '../src/events/halloween/placement';
import { parseHwc, hwcMode, portalSpot, portalBlocks, gateOpening, planHwExtras, HW_OFF } from '../src/events/halloween/hwcity';
import { DeadGrade, DEAD_U, patchDead } from '../src/events/halloween/dead';
import { buildPortal } from '../src/events/halloween/portal';
import { GhostCrowd, type CrowdEntry } from '../src/events/halloween/ghosts';
import halloween, { halloweenOpts } from '../src/events/halloween';
import { npcPlaces, npcWorld } from '../src/events/halloween/hwnpc';
import { toX, toZ, fromX, fromZ } from '../src/world/coords';
import type { Appearance } from '../src/contracts';

const city = eventCity();
const info = (g: THREE.Object3D): any => { let r: any = null; g.traverse((o) => { if (o.userData.halloween) r = o.userData.halloween; }); return r; };
const drawables = (root: THREE.Object3D) => {
  const out: THREE.Object3D[] = [];
  root.traverse((o) => { const m = o as THREE.Mesh; if ((m.isMesh || (o as THREE.Points).isPoints || (o as THREE.LineSegments).isLine) && o.visible && ((m as THREE.InstancedMesh).isInstancedMesh ? (m as THREE.InstancedMesh).count > 0 : true)) out.push(o); });
  return out;
};

describe('hwc: parsing and the mode', () => {
  it('parses hero.hwc flags; anything else is «no night»', () => {
    expect(parseHwc({ look: true, portal: false })).toEqual({ look: true, portal: false, at: 0 });
    expect(parseHwc({ look: 1, portal: 1, at: 1761689000000 })).toEqual({ look: true, portal: true, at: 1761689000000 });
    expect(parseHwc({ portal: true, at: 'x' })).toEqual({ look: false, portal: true, at: 0 });
    for (const v of [null, undefined, 0, 'lp', [], {}, { look: false, portal: false }]) expect(parseHwc(v)).toBeNull();
  });
  it('only the Fair transforms; camp and district towns stay; the setting switches it off', () => {
    const lp = parseHwc({ look: true, portal: true });
    expect(hwcMode(lp, 'fair')).toEqual({ look: true, dead: true, portal: true, ghosts: true });
    expect(hwcMode(parseHwc({ look: true }), 'fair')).toEqual({ look: true, dead: true, portal: false, ghosts: false });
    expect(hwcMode(parseHwc({ portal: true }), 'fair')).toEqual({ look: false, dead: false, portal: true, ghosts: true });
    expect(hwcMode(lp, 'camp')).toBe(HW_OFF);
    expect(hwcMode(lp, 'town3')).toBe(HW_OFF);
    expect(hwcMode(lp, undefined)).toBe(HW_OFF);
    expect(hwcMode(lp, 'fair', false)).toBe(HW_OFF);
    expect(hwcMode(null, 'fair')).toBe(HW_OFF);
  });
});

describe('hwc: the portal at the gate', () => {
  const L = city.L, gate = L.buildings.find((b) => b.id === 'gate')!;
  const solid = (x: number, y: number) => city.top(x, y);
  it('stands centred in the gate passage, bottom on the gate ground, sized to the arch', () => {
    const s = portalSpot(L, city.place.groundAt, 0.01, solid)!;
    expect(s).toBeTruthy();
    expect(s.x).toBeCloseTo(toX(gate.door.x), 5);
    expect(s.y).toBeCloseTo(city.groundAt(gate.door.x, fromZ(Math.max(s.z, 0))), 5);
    const op = gateOpening(L)!;
    expect(s.w).toBeGreaterThan(op.ow); expect(s.w).toBeLessThan(op.ow + 0.3);
    expect(s.h).toBeGreaterThan(op.oh);
  });
  it('never blocks a walkable cell: its footprint is behind the walk grid or inside the gate solid', () => {
    for (const facade of [-0.3, -0.15, 0.01, 0.2, 0.6]) {
      const s = portalSpot(L, city.place.groundAt, facade, solid)!;
      expect(portalBlocks(L, s.x, s.z + s.depth / 2, s.outerW, s.depth, solid), `facade ${facade}`).toBe(0);
      // and every sampled cell of the footprint really is unwalkable for a cat
      for (let X = s.x - s.outerW; X <= s.x + s.outerW; X += 0.1) for (let Z = s.z - s.depth / 2; Z <= s.z + s.depth / 2; Z += 0.02) {
        const px = fromX(X), py = fromZ(Z);
        expect(!L.free(px, py) || solid(px, py) === Infinity).toBe(true);
      }
    }
    // a frame pushed far out would block: portalBlocks sees it
    const s = portalSpot(L, city.place.groundAt, 0.01, solid)!;
    expect(portalBlocks(L, s.x, 1.5, s.outerW, s.depth, solid)).toBeGreaterThan(0);
  });
  it('3 draw calls, opens / closes, disposes its GPU objects', () => {
    const s = portalSpot(L, city.place.groundAt, 0.01, solid)!;
    const p = buildPortal(s), scene = new THREE.Scene(); scene.add(p.group);
    p.setOpen(0); expect(p.group.visible).toBe(false);
    p.setOpen(1); p.update(1.5); expect(p.group.visible).toBe(true);
    expect(drawables(p.group).length).toBe(3);
    const disposed: string[] = [];
    p.group.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) { m.geometry.addEventListener('dispose', () => disposed.push('g')); (m.material as THREE.Material).addEventListener('dispose', () => disposed.push('m')); } });
    p.dispose();
    expect(scene.children.length).toBe(0);
    expect(disposed.length).toBe(6);
  });
});

describe('hwc: extras (cauldron, candles, witch, bats, cobwebs)', () => {
  const plan = planHalloween(city.place), g = new Grid(city.place);
  const gate = city.L.buildings.find((b) => b.id === 'gate')!;
  const ex = planHwExtras(city.place, plan, { x: toX(gate.door.x), z: toZ(gate.door.y) }, [[10, 14]]);
  it('cauldron by the gate on flat open ground, clear of doors and pumpkins; candles beside pumpkin clusters', () => {
    const c = ex.cauldron!;
    expect(c).toBeTruthy();
    expect(Math.abs(c.x - toX(gate.door.x))).toBeLessThan(7.5);
    expect(g.flat(c.x, c.z, c.r)).toBe(true);
    expect(clearOfDoors(city.place, c.x, c.z, c.r)).toBe(true);
    expect(ex.candles.length).toBeGreaterThanOrEqual(6);
    const items = plan.clusters.flatMap((cl) => cl.items);
    for (const cd of ex.candles) {
      expect(cd.y).toBeCloseTo(city.place.groundAt(cd.x, cd.z), 3);
      for (const it of items) expect(Math.hypot(it.x - cd.x, it.z - cd.z)).toBeGreaterThan(it.r);
    }
    expect(ex.witch.cy).toBeGreaterThan(5);
  });
  it('the Halloween event with the hw dress: ≤ 15 draw calls at q2, more bats and webs, restores on dispose', () => {
    const base = eventHarness(2);
    const d0 = halloween.setup(base.ctx); base.frame(200);
    const plainCalls = drawables(base.ctx.group).length, plainBats = (base.ctx.group.getObjectByName('halloween:bats') as THREE.InstancedMesh).count;
    d0();
    halloweenOpts.hw = true;
    try {
      const h = eventHarness(2);
      const kids = h.scene.children.length;
      const d = halloween.setup(h.ctx); h.frame(200);
      const objs = drawables(h.ctx.group);
      expect(objs.length).toBe(plainCalls + 1);
      expect(objs.length + 3, 'with the portal').toBeLessThanOrEqual(15);
      expect(h.ctx.group.getObjectByName('halloween:hw-extras')).toBeTruthy();
      expect((h.ctx.group.getObjectByName('halloween:bats') as THREE.InstancedMesh).count).toBeGreaterThan(plainBats);
      d();
      expect(h.ctx.group.children.length).toBe(0); expect(h.scene.children.length).toBe(kids); expect(h.hooks).toBe(0);
    } finally { halloweenOpts.hw = false; }
  });
  it('the NPCs (site hwnpc.js) join the extras mesh: +0 draw calls, ≤ 15 with the portal, lanterns follow the pass level, every quality, clean dispose', () => {
    const npcs = npcPlaces({}).map(npcWorld);
    for (const q of [0, 2] as const) {
      halloweenOpts.hw = true;
      const h0 = eventHarness(q); const d0 = halloween.setup(h0.ctx); h0.frame(100);
      const calls0 = drawables(h0.ctx.group).length;
      const ex0 = (h0.ctx.group.getObjectByName('halloween:hw-extras') as THREE.Mesh).geometry.getAttribute('position').count;
      d0();
      halloweenOpts.npcs = npcs; halloweenOpts.npcLv = 7;
      try {
        const h = eventHarness(q);
        const kids = h.scene.children.length;
        const d = halloween.setup(h.ctx); h.frame(100);
        expect(drawables(h.ctx.group).length).toBe(calls0);
        expect(calls0 + 3).toBeLessThanOrEqual(15);
        const mesh = h.ctx.group.getObjectByName('halloween:hw-extras') as THREE.Mesh, g = mesh.geometry;
        expect(g.getAttribute('position').count).toBeGreaterThan(ex0);
        const fly = g.getAttribute('aFly'), lamps = new Set<number>();
        for (let i = 0; i < fly.count; i++) if (fly.getX(i) > 10.5) lamps.add(Math.round(fly.getX(i)));
        expect(lamps.size).toBe(20);
        expect(info(h.ctx.group).npcs).toEqual(['hwshop', 'hwpass']);
        // the lanterns' lit count follows hero.hw.p live
        halloweenOpts.npcLv = 13; h.frame(5);
        expect(info(h.ctx.group).lampLv()).toBe(13);
        d();
        expect(h.ctx.group.children.length).toBe(0); expect(h.scene.children.length).toBe(kids); expect(h.hooks).toBe(0);
      } finally { halloweenOpts.hw = false; halloweenOpts.npcs = null; halloweenOpts.npcLv = 0; }
    }
  });
  it('NPC models stand inside their obstacle ellipses: pumpkins and candles keep clear of them', () => {
    const npcs = npcPlaces({}).map(npcWorld);
    halloweenOpts.hw = true; halloweenOpts.npcs = npcs;
    try {
      const h = eventHarness(2); const d = halloween.setup(h.ctx); h.frame(10);
      const inf = info(h.ctx.group);
      for (const c of inf.plan.clusters) for (const n of npcs) for (const [cx, cz, rx, rz] of n.base)
        expect(((c.x - cx) / (rx + 0.3)) ** 2 + ((c.z - cz) / (rz + 0.3)) ** 2, `cluster at ${c.x.toFixed(1)},${c.z.toFixed(1)}`).toBeGreaterThan(1);
      d();
    } finally { halloweenOpts.hw = false; halloweenOpts.npcs = null; }
  });
});

describe('hwc: the «dead» city grade', () => {
  it('patches world materials once, greys / chills the lights, dims glows; dispose restores everything', async () => {
    const h = eventHarness(2), f = h.fake;
    await withRealStatic(f);
    const hemi = new THREE.HemisphereLight('#8f9cff', '#4a2c30', 1); const pl = new THREE.PointLight('#ffb062', 1); f.root.add(hemi, pl);
    const glowMat = new THREE.ShaderMaterial({ uniforms: { uInt: { value: 1 } } }); const glows = f.root.getObjectByName('fx:glow') as THREE.Points; glows.material = glowMat;
    const mats = new Set<THREE.Material>(); f.root.traverse((o) => { const m = (o as THREE.Mesh).material as THREE.Material | undefined; if (m && !Array.isArray(m)) mats.add(m); });
    const before = [...mats].map((m) => [m.onBeforeCompile, m.customProgramCacheKey()]);
    const hemiC = hemi.color.getHex(), plC = pl.color.getHex();
    const d = new DeadGrade(f.root);
    expect(d.counts.materials).toBeGreaterThan(5); expect(d.counts.lights).toBe(2); expect(d.counts.glows).toBe(1);
    d.set(1);
    expect(DEAD_U.uL3dDead.value).toBe(1);
    expect(hemi.color.getHex()).not.toBe(hemiC);
    const c = hemi.color; expect(Math.abs(c.r - c.g) + Math.abs(c.g - c.b)).toBeLessThan(0.35);   // grey-cold
    expect(pl.color.r).toBeLessThan(0.1);                                                        // street lamp out
    expect(glowMat.uniforms.uInt.value).toBeLessThan(0.2);
    // the shader tail is installed (a different program key)
    const wall = [...mats].find((m) => m.name === 'city:brick')!;
    expect(wall.customProgramCacheKey()).toContain('l3dDead');
    const sh = { uniforms: {}, fragmentShader: 'void main(){\n#include <dithering_fragment>\n}', vertexShader: '' } as unknown as THREE.WebGLProgramParametersWithUniforms;
    wall.onBeforeCompile(sh, {} as THREE.WebGLRenderer);
    expect(sh.fragmentShader).toContain('uL3dDead'); expect((sh.uniforms as Record<string, unknown>).uL3dDead).toBe(DEAD_U.uL3dDead);
    d.dispose();
    expect(DEAD_U.uL3dDead.value).toBe(0);
    expect(hemi.color.getHex()).toBe(hemiC); expect(pl.color.getHex()).toBe(plC); expect(glowMat.uniforms.uInt.value).toBe(1);
    expect([...mats].map((m) => [m.onBeforeCompile, m.customProgramCacheKey()])).toEqual(before);
    for (const m of mats) expect(m.userData.l3dDead).toBeUndefined();
  });
  it('the lamp pools of src/world/lightPools.ts fade with the grade; patching twice is a no-op', () => {
    const m = new THREE.MeshStandardMaterial();
    m.onBeforeCompile = (sh) => { sh.fragmentShader = sh.fragmentShader.replace('#include <dithering_fragment>', 'acc += uL3dC[i] * (a * nl);\n#include <dithering_fragment>'); };
    const p = patchDead(m)!; expect(p).toBeTruthy(); expect(patchDead(m)).toBeNull();
    const sh = { uniforms: {}, fragmentShader: 'void main(){\n#include <dithering_fragment>\n}' } as unknown as THREE.WebGLProgramParametersWithUniforms;
    m.onBeforeCompile(sh, {} as THREE.WebGLRenderer);
    expect(sh.fragmentShader).toContain('(1.0 - 0.92 * uL3dDead)');
  });
});

describe('hwc: ghost cats', () => {
  const app = (n: string): Appearance => ({ login: n, name: n, styleId: 'cats', look: {}, gear: {} });
  const fakeAv = () => { const av = { app: null as Appearance | null, n: 0, setAppearance(a: Appearance) { this.app = a; this.n++; } }; return av; };
  it('toggles every cat and me to the ghost appearance and back, a few per frame, re-applies after a crowd change', () => {
    const crowd: CrowdEntry[] = Array.from({ length: 7 }, (_, i) => { const a = app('c' + i); const av = fakeAv(); av.setAppearance(a); return { av, app: a, key: JSON.stringify(a) }; });
    const meAv = fakeAv(), meApp = app('me'); meAv.setAppearance(meApp);
    const vm = new THREE.Group(); const paw = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshToonMaterial()); paw.name = 'vm-right'; vm.add(paw);
    const origPaw = paw.material;
    const G = new GhostCrowd(3);
    G.on = true;
    expect(G.sync(crowd, { av: meAv, app: meApp }, vm)).toBe(4);   // 3 cats + me
    expect(G.settled(crowd)).toBe(false);
    G.sync(crowd, { av: meAv, app: meApp }, vm); G.sync(crowd, { av: meAv, app: meApp }, vm);
    expect(G.settled(crowd)).toBe(true);
    for (const e of crowd) expect((e.av as ReturnType<typeof fakeAv>).app!.ghost).toBe(true);
    expect(meAv.app!.ghost).toBe(true);
    expect(paw.material).not.toBe(origPaw); expect((paw.material as THREE.Material).transparent).toBe(true); expect((paw.material as THREE.Material).opacity).toBeLessThan(0.7);
    // the crowd re-applies a plain look (key changed) → ghosted again
    const a2 = { ...app('c0'), look: { hat: 'cap' } }; crowd[0].av.setAppearance(a2); crowd[0].app = a2; crowd[0].key = JSON.stringify(a2);
    expect(G.sync(crowd, { av: meAv, app: meApp }, vm)).toBe(1);
    expect((crowd[0].av as ReturnType<typeof fakeAv>).app).toMatchObject({ ghost: true, look: { hat: 'cap' } });
    // nothing to do when settled
    expect(G.sync(crowd, { av: meAv, app: meApp }, vm)).toBe(0);
    G.on = false;
    for (let i = 0; i < 4; i++) G.sync(crowd, { av: meAv, app: meApp }, vm);
    expect(G.settled(crowd)).toBe(true); expect(G.count).toBe(0);
    for (const e of crowd) expect((e.av as ReturnType<typeof fakeAv>).app!.ghost).toBeFalsy();
    expect(meAv.app).toBe(meApp); expect(paw.material).toBe(origPaw);
  });
});
