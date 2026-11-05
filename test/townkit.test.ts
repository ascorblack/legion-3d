/**
 * «Town Kit» district towns (site 05.11: tk-map.js LGTownKitMap, tk-city.js LGTownKitCity, city.js buildKit): layout,
 * town detection (`.cy[data-town="n-<id>"]`), walk-grid parity, doors, levels / constructions, z-fight, q2 budget.
 * Data: test/fixtures/townkit-map.json (scripts/fixture-townkit.mjs from the site's tk-map.js). When a downloaded copy
 * of the site is in .local/site-* (not committed), the real tk-map.js / tk-city.js are run in node:vm and compared.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import vm from 'node:vm';
import * as THREE from 'three';
import fx from './fixtures/townkit-map.json';
import fairMap from './fixtures/fair-map.json';
import { townKitScene, kitOf, kitTownOf, kitBuildState, kitTierH, KIT_PREFIX } from '../src/net/townkit';
import { fairCatsOf, rimY } from '../src/net/faircats';
import { detectTown, readTownSignals } from '../src/net/town';
import { cityTownShown } from '../src/net/city-tab';
import { kitFixtureLayout, gridSiteMap } from '../dev/fixtures';
import { staticCity } from './world-fixture';
import { fairCatsGround, FC_H, FC_POND } from '../src/world/fcground';
import { SolidMap, collectSolids, makeSolidTop } from '../src/world/solid';
import { registerProtoProps } from '../src/world/protoProps';
import { VK } from '../src/world/village';
import { stubDom } from './dom-stub';

const m = fx as any;
function siteDir(): string | null {
  const base = resolve(__dirname, '../.local');
  if (!existsSync(base)) return null;
  const dirs = readdirSync(base).filter((d) => /^site-/.test(d) && existsSync(join(base, d, 'tk-map.js')) && existsSync(join(base, d, 'tk-city.js'))).sort();
  return dirs.length ? join(base, dirs[dirs.length - 1]) : null;
}
const SITE = siteDir();
const G0 = { Math, JSON, Map, Set, Uint8Array, Uint32Array, Int32Array, Float32Array, Object, Array, Number, String, Date, Infinity, NaN };
function realKit(): { K: any; C: any } {
  const module = { exports: {} as any };
  vm.runInNewContext(readFileSync(join(SITE!, 'tk-map.js'), 'utf8'), { ...G0, module, exports: module.exports }, { timeout: 20000 });
  const win: any = { LGTownKitMap: module.exports, LGTownKitArt: {}, LGCityMap: { BUILDINGS: (fairMap as any).BUILDINGS } };
  vm.runInNewContext(readFileSync(join(SITE!, 'tk-city.js'), 'utf8'), { ...G0, window: win }, { timeout: 20000 });
  return { K: module.exports, C: win.LGTownKitCity };
}

const L = kitFixtureLayout({ magic: true });
const sc = fairCatsOf(L)!;
const kit = kitOf(sc)!;
const fm = gridSiteMap(m, null);
const g = fairCatsGround(sc);

describe('town kit — layout data (src/net/townkit.ts)', () => {
  it('restates the kit input as the 3D scene: tiers, rocks, water, bridges, levelled buildings', () => {
    expect(sc).not.toBeNull(); expect(kit).not.toBeNull();
    expect(L.id).toBe(m.T.id);
    expect(sc.W).toBe(m.T.W); expect(sc.H).toBe(m.T.H);
    expect(kit.tiers.length).toBe(m.T.tiers.length); expect(kit.rocks.length).toBe(m.T.rocks.length);
    expect(kit.water.length).toBe(m.T.water.length); expect(kit.bridges.length).toBe(m.T.bridges.length);
    expect(kit.biome).toBe(m.T.biome);
    expect(sc.buildings.map((b) => b.id)).toEqual(m.levelled.map((b: any) => b.id));
    for (const b of m.levelled) expect(kit.lvl[b.id], b.id).toBe(b.lvl);
    // a building below level 5 stands on its smaller plot (tk-map.js plotOf); fixed ones (gate, mine) never shrink
    const hall = m.levelled.find((b: any) => b.id === 'hall'), gate = m.levelled.find((b: any) => b.id === 'gate');
    expect(hall.lvl).toBe(3); expect(hall.vis[2] - hall.vis[0]).toBeLessThan(hall.vis5[2] - hall.vis5[0]);
    expect(gate.vis).toEqual(gate.vis5);
    expect(sc.buildings.find((b) => b.id === 'hall')!.vis).toEqual(hall.vis);
    // hostile / broken input: null or dropped, never thrown
    expect(townKitScene(null, [])).toBeNull(); expect(townKitScene({ town: [[0, 0], [1, 0], [1, 1]] }, [])).toBeNull();
    const bad = townKitScene({ ...m.T, items: [{ k: 'tree', x: 'a', y: 1 }], tiers: [{ poly: 5 }] }, [...m.levelled, { id: 'x', vis: [1] }, null], { now: m.cfg.now })!;
    expect(bad.buildings.length).toBe(m.levelled.length); expect(bad.items.length).toBe(0); expect(kitOf(bad)!.tiers.length).toBe(0);
  });
  it('levels + constructions: a running build shows its target level, is closed and gets scaffolding', () => {
    expect(m.cfg.building.auction.to).toBe(4);
    expect(m.lvMap.auction).toBe(4);   // mapLevels: the plot of the target level while it is built
    const au = L.buildings.find((b) => b.id === 'auction')!;
    expect(au.soon).toBe(true); expect(au.scaffold).toBe(true);
    expect(kit.build.auction).toEqual({ to: 4, until: m.cfg.building.auction.until });
    // finished (until passed) → open, no scaffolding
    expect(kitBuildState({ id: 'auction', build: { until: 1 } }, null, 2)).toEqual({});
    expect(kitBuildState({ id: 'hall' }, kit, m.cfg.now)).toEqual({});
    const hall = L.buildings.find((b) => b.id === 'hall')!; expect(hall.soon).toBeFalsy();
    expect(kitTierH(2, FC_H)).toBe(FC_H); expect(kitTierH(1, FC_H)).toBe(0); expect(kitTierH(3, FC_H)).toBe(0);
  });
  it('the site building list: hit from the plot, the old fair titles, the magic shop only with hero.ms', () => {
    const off = kitFixtureLayout({ magic: false });
    expect(off.buildings.some((b) => b.id === 'magic')).toBe(false);
    expect(L.buildings.some((b) => b.id === 'magic')).toBe(true);
    const hall = m.levelled.find((b: any) => b.id === 'hall'), hb = L.buildings.find((b) => b.id === 'hall')!;
    expect(hb.hit).toEqual([hall.vis[0], hall.vis[2], hall.vis[1], hall.vis[3]]);
    expect(hb.door).toEqual(hall.door);
    expect(L.buildings.find((b) => b.id === 'shop')!.title).toBe('Лавка');
  });
});

describe('town kit — town detection (src/net/town.ts, city-tab.ts)', () => {
  it('`n-<id>` on the City DOM = district town <id> in kit mode', () => {
    expect(kitTownOf('n-d04')).toBe('d04'); expect(kitTownOf('d04')).toBeNull(); expect(kitTownOf('n-')).toBeNull(); expect(kitTownOf(null)).toBeNull();
    expect(KIT_PREFIX).toBe('n-');
    expect(detectTown({ dom: 'n-d04' })).toEqual({ id: 'd04', via: 'dom', kit: true });
    expect(detectTown({ where: 'd04', dom: 'n-d04' })).toEqual({ id: 'd04', via: 'where', kit: true });
    // the old LGTownGen town (KIT_OFF / town_closed): the same id without the kit
    expect(detectTown({ where: 'd04', dom: 'd04' })).toEqual({ id: 'd04', via: 'where' });
    expect(detectTown({ dom: 'd04' })).toEqual({ id: 'd04', via: 'dom' });
    // a stale picker / session never beats the kit DOM; the fair / camp stay as they are
    expect(detectTown({ dom: 'n-d04', picker: 'camp', session: 'd9' })).toEqual({ id: 'd04', via: 'dom', kit: true });
    expect(detectTown({ dom: 'fairc' })).toEqual({ id: 'fairc', via: 'dom' });
    expect(detectTown({ dom: '' }).id).toBe('fair');
    const cy = { dataset: { town: 'n-d04' } };
    const doc = { querySelector: (s: string) => (s === '#tab-city .cy' ? cy : s === '#tab-city.on' ? {} : null) } as unknown as Document;
    expect(readTownSignals({}, doc, null).dom).toBe('n-d04');
    expect(cityTownShown(doc)).toBe('d04');
  });
});

describe('town kit — walk grid parity', () => {
  it.skipIf(!SITE)('the fixture = the real tk-map.js: levelled plots, townAt() grid (all cells), tk-city buildings / spawn', () => {
    const { K, C } = realKit();
    expect(K.SPEED).toBe(m.SPEED); expect(K.SCALE).toBe(m.SCALE); expect(K.RAIL).toBe(m.RAIL); expect(K.STAIR).toBe(3);
    const T = JSON.parse(JSON.stringify(m.T));
    const lv = K.mapLevels(m.cfg.levels, m.cfg.building, m.cfg.now);
    expect(lv).toEqual(m.lvMap);
    expect(JSON.parse(JSON.stringify(K.levelled(T, lv)))).toEqual(m.levelled);
    const M = K.townAt(T, lv);
    expect(M.cols).toBe(fm.cols); expect(M.rows).toBe(fm.rows);
    let diff = 0; for (let i = 0; i < M.G.length; i++) if (M.G[i] !== fm.G[i]) diff++;
    expect(diff).toBe(0);
    // sampled points (not cell centres): agree on ≥ 97 %
    let ok = 0, n = 0;
    for (let y = 8; y < m.T.H; y += 37) for (let x = 8; x < m.T.W; x += 41) { n++; if ((M.levelAt(x, y) > 0) === fm.free(x, y)) ok++; }
    expect(ok / n).toBeGreaterThan(0.97);
    // every door is walkable on the exact grid
    for (const b of K.levelled(T, lv)) expect(M.free(b.door.x, b.door.y), b.id).toBe(true);
    // tk-city.js buildings + wrap = our site building list (the magic filter of build())
    const site = C.buildings(K.levelled(T, lv), m.cfg.building, m.cfg.now).filter((b: any) => !b.magic || true);
    const ours = L.buildings.map((b) => ({ id: b.id, hit: b.hit, door: b.door, title: b.title }));
    expect(ours).toEqual(site.map((b: any) => ({ id: b.id, hit: b.hit, door: b.door, title: b.title })));
    expect(site.find((b: any) => b.id === 'auction').build).toEqual({ to: 4, until: m.cfg.building.auction.until });
    const map = C.wrap(M, site, m.T.W, m.T.H);
    expect(map.W).toBe(m.T.W); expect(map.cats).toBe(M); expect(typeof map.hoverAt).toBe('function');
    expect(C.spawn(T)).toEqual(L.spawn);
    expect(C.SCALE).toBe(K.SCALE); expect(C.SPEED).toBe(K.SPEED);
  });
  it('ground: town 0, tier FC_H, stairs ramp continuously, the bank between, water below', () => {
    const t = kit.tiers[0], s = sc.stairs.find((q) => q.k !== 'ramp')!, xs = (s.x0 + s.x1) / 2;
    expect(g(1000, 2000)).toBe(0);
    expect(g(3000, 800)).toBe(FC_H);
    expect(g(xs, rimY(t.rim, xs) + 80)).toBeGreaterThan(0.5); expect(g(xs, rimY(t.rim, xs) + 80)).toBeLessThan(FC_H);
    expect(g(450, 2300)).toBe(FC_POND);
    const br = kit.bridges[0].rects[0]; expect(g((br[0] + br[2]) / 2, (br[1] + br[3]) / 2)).toBeGreaterThan(0);
    let worst = 0;
    const { C, cols, rows, G } = fm;
    for (let r = 0; r < rows; r++) for (let c = 0; c + 1 < cols; c++) {
      for (const [dc, dr] of [[1, 0], [0, 1]]) {
        const i = r * cols + c, j = (r + dr) * cols + c + dc; if (r + dr >= rows) continue;
        const a = G[i], b = G[j]; if (!a || !b || !(a === b || a === 3 || b === 3)) continue;
        worst = Math.max(worst, Math.abs(g(c * C + C / 2, r * C + C / 2) - g((c + dc) * C + C / 2, (r + dr) * C + C / 2)));
      }
    }
    expect(worst).toBeLessThan(0.25);
  });
  it('3D solids = the site grid: walkable cells stay walkable, obstacles are solid', () => {
    const { k, spec } = staticCity(false, L);
    registerProtoProps(k.inst, k.pal);
    for (const [of, as] of Object.entries(VK)) k.inst.alias(as, of);
    const top = makeSolidTop(L, new SolidMap(collectSolids(L, spec, k.solids ?? [], k.inst)));
    const { C, cols, rows, G } = fm;
    let free = 0; const bad: string[] = [];
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      if (!G[r * cols + c]) continue;
      const x = c * C + C / 2, y = r * C + C / 2; free++;
      const t = top(x, y);
      if (t > g(x, y) + 0.25 && bad.length < 20) bad.push(`${x},${y} top ${t}`);
    }
    expect(free).toBeGreaterThan(20000);
    expect(bad).toEqual([]);
    for (const b of sc.buildings) {
      if (b.id === 'mine') continue;
      const [x0, y0, x1, y1] = b.foot, px = b.id === 'gate' ? x0 + 40 : (x0 + x1) / 2;
      expect(top(px, (y0 + y1) / 2), b.id).toBe(Infinity);
    }
    for (const h of sc.houses) expect(top((h.foot[0] + h.foot[2]) / 2, (h.foot[1] + h.foot[3]) / 2)).toBe(Infinity);
    expect(top(600, 2300)).toBe(Infinity);                            // water
    expect(top(3000, rimY(kit.tiers[0].rim, 3000) + 80)).toBe(Infinity);   // the bank
    const br = kit.bridges[0].rects[0];
    expect(top((br[0] + br[2]) / 2, (br[1] + br[3]) / 2)).toBeLessThan(1);   // the bridge over the water
  });
  it('every door is reachable from the spawn (doors keep the site ids)', () => {
    const sp = L.spawn;
    expect(L.free(sp[0], sp[1])).toBe(true);
    for (const b of L.buildings) {
      const want = L.nearest(b.door.x, b.door.y);
      expect(Math.hypot(want[0] - b.door.x, want[1] - b.door.y), b.id).toBeLessThan(33);
      const p = L.path!(sp, [b.door.x, b.door.y]);
      const end = p[p.length - 1];
      expect(Math.hypot(end[0] - want[0], end[1] - want[1]), b.id).toBeLessThan(1);
    }
  });
});

describe('town kit — 3D (src/world/townkit.ts + faircats.ts)', () => {
  beforeAll(() => stubDom());
  it('has no coplanar overlapping surfaces (z-fighting)', () => {
    const { rec, ground } = staticCity(true, kitFixtureLayout({ magic: true }));
    const hits = rec.find(0.004, 2e-4, ground);
    const by = new Map<string, number>();
    for (const h of hits) by.set(h.a + ' × ' + h.b, (by.get(h.a + ' × ' + h.b) || 0) + 1);
    if (hits.length) console.log([...by].sort((p, q) => q[1] - p[1]).slice(0, 30).map(([kk, n]) => n + '  ' + kk).join('\n'));
    expect(hits.length).toBe(0);
  });
  it('builds every building (scaffolding on the one under construction), houses and decor', () => {
    const { rec } = staticCity(true, kitFixtureLayout({ magic: true }));
    const tags = new Set(rec.pieces.map((p) => p.tag));
    for (const b of sc.buildings) expect(tags.has(b.id), b.id).toBe(true);
    expect(tags.has('houses')).toBe(true); expect(tags.has('terrain:tiers')).toBe(true); expect(tags.has('terrain:rocks')).toBe(true);
    expect(tags.has('terrain:water')).toBe(true); expect(tags.has('terrain:bridges')).toBe(true); expect(tags.has('terrain:stairs')).toBe(true);
    // the auction (under construction) has more wood in front than without the build
    const wood = (Lx: ReturnType<typeof kitFixtureLayout>) => staticCity(true, Lx).rec.pieces.filter((p) => p.tag === 'auction' && p.mat === 'wood').length;
    const done = kitFixtureLayout({ magic: true }); for (const b of done.buildings) if (b.id === 'auction') { b.scaffold = false; b.soon = false; }
    expect(wood(L)).toBeGreaterThan(wood(done));
  });
  it('q2 budget: ≤ 120 draw calls and ≤ 130k triangles in view at the town views', async () => {
    const { buildCity } = await import('../src/world');
    const { toX, toZ } = await import('../src/world/coords');
    const w = await buildCity(kitFixtureLayout({ magic: true }), { quality: 2 } as never);
    const drawables = (root: THREE.Object3D) => {
      const out: THREE.Object3D[] = [];
      root.traverse((o) => {
        const mm = o as THREE.InstancedMesh;
        if (!(mm.isMesh || (o as THREE.Points).isPoints || (o as THREE.Line).isLine)) return;
        let v = true; o.traverseAncestors((a) => { if (!a.visible) v = false; });
        if (v && o.visible && (!mm.isInstancedMesh || mm.count > 0)) out.push(o);
      });
      return out;
    };
    const inView = (cam: THREE.PerspectiveCamera) => {
      const fr = new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse));
      let calls = 0, tris = 0;
      w.root.updateMatrixWorld(true);
      for (const o of drawables(w.root)) {
        const mm = o as THREE.InstancedMesh, gg = mm.geometry as THREE.BufferGeometry;
        if (o.frustumCulled && gg) { if (!gg.boundingSphere) gg.computeBoundingSphere(); const s = gg.boundingSphere!.clone().applyMatrix4(o.matrixWorld); if (!fr.intersectsSphere(s)) continue; }
        calls++;
        if (mm.isMesh) tris += ((gg.index ? gg.index.count : gg.getAttribute('position').count) / 3) * (mm.isInstancedMesh ? mm.count : 1);
      }
      return { calls, tris };
    };
    const cam = new THREE.PerspectiveCamera(75, 16 / 9, 0.05, 400);
    const views: [string, number, number, number, number][] = [
      ['spawn', L.spawn[0], L.spawn[1], 2880, 1500], ['plaza', 2880, 2100, 2880, 1300], ['plateau', 3000, 900, 3800, 700], ['pond', 900, 2300, 2000, 2000],
    ];
    const out: string[] = [];
    for (const [name, x, y, tx, ty] of views) {
      const gy = g(x, y);
      cam.position.set(toX(x), gy + 1.6, toZ(y)); cam.lookAt(toX(tx), g(tx, ty) + 1.2, toZ(ty)); cam.updateMatrixWorld(); cam.updateProjectionMatrix();
      w.update(0.016, 1, cam);
      const r = inView(cam);
      out.push(`${name}: ${r.calls} calls ${Math.round(r.tris)} tris`);
      expect(r.calls, name).toBeLessThanOrEqual(120);
      expect(r.tris, name).toBeLessThan(130000);
    }
    console.log('townkit q2 ' + out.join('; '));
    w.dispose();
  }, 120000);
});
