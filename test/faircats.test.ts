/**
 * The new cats fair (site 04.11, hero flag me.fc): layout, town detection, walk-grid parity, doors, z-fight, budget.
 * Data: test/fixtures/faircats-map.json (scripts/fixture-faircats.mjs from the site's fc-map.js). When a downloaded
 * copy of the site is in .local/site-* (not committed), the real fc-map.js / fc-city.js are run in node:vm and compared.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import vm from 'node:vm';
import * as THREE from 'three';
import fx from './fixtures/faircats-map.json';
import fairMap from './fixtures/fair-map.json';
import { fairCatsScene, fairCatsBuildings, fairCatsJailGeo, fairCatsOf, rimY, inPoly, isFairId, FAIRC } from '../src/net/faircats';
import { detectTown, readTownSignals } from '../src/net/town';
import { fairCatsFixtureLayout, fairCatsFixtureMap } from '../dev/fixtures';
import { staticFairCats } from './world-fixture';
import { fairCatsGround, FC_H } from '../src/world/fcground';
import { SolidMap, collectSolids, makeSolidTop } from '../src/world/solid';
import { groundSpec } from '../src/world/ground';
import { registerProtoProps } from '../src/world/protoProps';
import { VK } from '../src/world/village';
import { jailGeoOf, jailWalkOf } from '../src/net/jail';
import { mineIdOf } from '../src/rooms/mine';
import { toX, toZ } from '../src/world/coords';

/** The newest downloaded site copy with fc-map.js (dev machines only). */
function siteDir(): string | null {
  const base = resolve(__dirname, '../.local');
  if (!existsSync(base)) return null;
  const dirs = readdirSync(base).filter((d) => /^site-/.test(d) && existsSync(join(base, d, 'fc-map.js'))).sort();
  return dirs.length ? join(base, dirs[dirs.length - 1]) : null;
}
const SITE = siteDir();
function realFc(): any {
  const module = { exports: {} as any };
  vm.runInNewContext(readFileSync(join(SITE!, 'fc-map.js'), 'utf8'), { module, exports: module.exports, Math, JSON, Map, Uint8Array, Uint32Array, Int32Array, Float32Array, Object, Array }, { timeout: 10000 });
  return module.exports;
}

const sc = fairCatsScene(fx)!;

describe('new cats fair — layout data (src/net/faircats.ts)', () => {
  it('reads the scene from LGFairCats / the fixture', () => {
    expect(sc).not.toBeNull();
    expect(sc.W).toBe(5760); expect(sc.H).toBe(3240);
    expect(sc.buildings.map((b) => b.id).sort()).toEqual(['anvil', 'auction', 'board', 'forge', 'gate', 'hall', 'jail', 'magic', 'mine', 'shop', 'storage', 'tent', 'trainer']);
    expect(sc.rim.length).toBeGreaterThan(10); expect(sc.stairs.length).toBe(3); expect(sc.houses.length).toBe(6);
    expect(sc.items.length).toBeGreaterThan(150);
    expect(fairCatsScene(null)).toBeNull(); expect(fairCatsScene({ RIM: [] })).toBeNull();
    // hostile / broken entries are dropped, not thrown
    const bad = fairCatsScene({ ...fx, BUILDINGS: [...(fx as any).BUILDINGS, { id: 'x', vis: [1, 2] }, null], ITEMS: [{ k: 'tree', x: 'a', y: 1 }] })!;
    expect(bad.buildings.length).toBe(13); expect(bad.items.length).toBe(0);
  });
  it('mirrors fc-city.js buildings(): jail only when open, magic only with the shop, the old fair titles', () => {
    const meta = (id: string) => (fairMap as any).BUILDINGS.find((b: any) => b.id === id);
    const off = fairCatsBuildings(sc, meta, {});
    expect(off.some((b) => b.id === 'jail')).toBe(false);
    expect(off.some((b) => b.id === 'magic')).toBe(false);
    const on = fairCatsBuildings(sc, meta, { jail: true, magic: true });
    expect(on.length).toBe(13);
    expect(on.find((b) => b.id === 'shop')!.title).toBe('Лавка');
    expect(on.find((b) => b.id === 'jail')!.jail).toBe(true);
    const h = on.find((b) => b.id === 'hall')!; expect(h.hit).toEqual([2560, 3200, 1060, 1500]); expect(h.door).toEqual({ x: 2880, y: 1522 });
  });
  it.skipIf(!SITE)('equals the real fc-city.js map({ jail, magic }) building list', () => {
    const F = realFc();
    const win: any = { LGFairCats: F, LGFairCatsArt: {}, LGCityMap: { BUILDINGS: (fairMap as any).BUILDINGS } };
    vm.runInNewContext(readFileSync(join(SITE!, 'fc-city.js'), 'utf8'), { window: win, Math, JSON, Map, Uint8Array, Uint32Array, Int32Array, Float32Array, Object, Array }, { timeout: 10000 });
    const C = win.LGFairCatsCity;
    expect(typeof C.map).toBe('function'); expect(typeof C.build).toBe('function');
    const meta = (id: string) => (fairMap as any).BUILDINGS.find((b: any) => b.id === id);
    for (const o of [{ jail: true, magic: true }, { jail: false, magic: false }]) {
      const site = C.map(o).BUILDINGS.map((b: any) => ({ id: b.id, hit: b.hit, door: b.door, title: b.title }));
      const ours = fairCatsBuildings(fairCatsScene(F)!, meta, o).map((b) => ({ id: b.id, hit: b.hit, door: b.door, title: b.title }));
      expect(ours).toEqual(site);
    }
    expect(C.spawn()).toEqual(fairCatsFixtureLayout().spawn);
  });
  it('the jail: house = its foot, the cage and seats from LGFairCats.JAIL, walk inside the cage', () => {
    const J = fairCatsJailGeo(sc)!;
    expect(J.c0).toBe(4184); expect(J.c1).toBe(4410); expect(J.back).toBe(2016); expect(J.fy).toBe(2150);
    expect(J.seats.length).toBe(8);
    const L = fairCatsFixtureLayout({ jail: true });
    const jb = L.buildings.find((b) => b.id === 'jail')!;
    expect(jailGeoOf(jb, L.low)).toEqual(J);   // no lower street: the geometry rides on the building
    const w = jailWalkOf(J);
    for (const s of J.seats) { expect(s[0]).toBeGreaterThanOrEqual(w[0] - 10); expect(s[0]).toBeLessThanOrEqual(w[2] + 40); }
    expect(L.low).toBeUndefined();
  });
  it('is the home fair for mines / names / jail (isFairId)', () => {
    expect(isFairId('fair')).toBe(true); expect(isFairId(FAIRC)).toBe(true); expect(isFairId('camp')).toBe(false);
    expect(mineIdOf('fairc')).toBe('home');
    expect(fairCatsOf(fairCatsFixtureLayout())).not.toBeNull();
  });
});

describe('new cats fair — town detection (src/net/town.ts)', () => {
  it('the City DOM «fairc» wins', () => {
    expect(detectTown({ dom: 'fairc' })).toEqual({ id: 'fairc', via: 'dom' });
    expect(detectTown({ dom: 'fairc', fc: false })).toEqual({ id: 'fairc', via: 'dom' });
    // the old fair drawn (FC_OFF: scripts failed, SVG renderer, town_closed) although the hero has fc
    expect(detectTown({ dom: '', fc: true })).toEqual({ id: 'fair', via: 'dom' });
  });
  it('LGCity.where() says «fair» for both (live 04.11): the DOM decides', () => {
    expect(detectTown({ where: 'fair', dom: 'fairc' })).toEqual({ id: 'fairc', via: 'dom' });
    expect(detectTown({ where: 'fair', dom: '', fc: true })).toEqual({ id: 'fair', via: 'where' });
    expect(detectTown({ where: 'fair', fc: true })).toEqual({ id: 'fairc', via: 'where' });
    expect(detectTown({ where: 'camp', dom: 'camp' })).toEqual({ id: 'camp', via: 'where' });
  });
  it('without a built City: fc + the cats scripts loaded → the new fair; other towns stay', () => {
    expect(detectTown({ fc: true }).id).toBe('fairc');
    expect(detectTown({ fc: false }).id).toBe('fair');
    expect(detectTown({ fc: true, picker: 'camp' }).id).toBe('camp');
    expect(detectTown({ fc: true, hero: { hm: { id: 'd7' } } }).id).toBe('d7');
    expect(detectTown({ fc: true, jailed: true }).id).toBe('fairc');
  });
  it('readTownSignals: fc only counts with window.LGFairCatsCity', () => {
    const doc = { querySelector: () => null } as unknown as Document;
    expect(readTownSignals({}, doc, null, true).fc).toBe(false);
    expect(readTownSignals({ LGFairCatsCity: {} }, doc, null, true).fc).toBe(true);
    expect(readTownSignals({ LGFairCatsCity: {} }, doc, null, false).fc).toBe(false);
  });
});

describe('new cats fair — walk grid parity', () => {
  it.skipIf(!SITE)('every door is walkable on the real fc-map.js grid (exact free)', () => {
    const F = realFc(), m = F.make({ jail: true });
    for (const b of F.BUILDINGS) expect(m.free(b.door.x, b.door.y), b.id).toBe(true);
  });
  it.skipIf(!SITE)('the fixture grid equals the real fc-map.js make() (all cells, jail on and off)', () => {
    const F = realFc();
    for (const jail of [false, true]) {
      const m = F.make({ jail }), f = fairCatsFixtureMap({ jail });
      expect(f.cols).toBe(m.cols); expect(f.rows).toBe(m.rows);
      let diff = 0; for (let i = 0; i < m.G.length; i++) if (m.G[i] !== f.G[i]) diff++;
      expect(diff).toBe(0);
      // sampled points (not cell centres): the cell's level is the site's lvFree at its centre → agree on ≥ 97 %
      let ok = 0, n = 0;
      for (let y = 8; y < 3240; y += 37) for (let x = 8; x < 5760; x += 41) { n++; if ((m.levelAt(x, y) > 0) === f.free(x, y)) ok++; }
      expect(ok / n).toBeGreaterThan(0.97);
    }
  });
  const L = fairCatsFixtureLayout({ jail: true, magic: true });
  const fm = fairCatsFixtureMap({ jail: true });
  const g = fairCatsGround(sc);
  it('ground: town 0, plateau FC_H, stairs ramp continuously, the bank between', () => {
    expect(g(1000, 2000)).toBe(0);
    expect(g(3000, 800)).toBe(FC_H);
    expect(g(2386, rimY(sc.rim, 2386) + 80)).toBeGreaterThan(0.5);
    expect(g(2386, rimY(sc.rim, 2386) + 80)).toBeLessThan(FC_H);
    // every pair of neighbouring walkable cells the site connects (compatible levels) differs by < a step
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
  it('3D solids follow the site grid: walkable cells stay walkable, obstacles are solid (sampled)', () => {
    const { k, spec } = staticFairCats();
    registerProtoProps(k.inst, k.pal);
    for (const [of, as] of Object.entries(VK)) k.inst.alias(as, of);
    const top = makeSolidTop(L, new SolidMap(collectSolids(L, spec, k.solids ?? [], k.inst)));
    const { C, cols, rows, G } = fm;
    let free = 0, bad: string[] = [];
    for (let r = 0; r < rows; r += 1) for (let c = 0; c < cols; c += 1) {
      if (!G[r * cols + c]) continue;
      const x = c * C + C / 2, y = r * C + C / 2; free++;
      // the jail cage floor: walkable for its prisoner only (finite floor)
      const t = top(x, y);
      if (t > g(x, y) + 0.25 && bad.length < 20) bad.push(`${x},${y} top ${t}`);
    }
    expect(free).toBeGreaterThan(20000);
    expect(bad).toEqual([]);
    // inside obstacles: building feet, houses, the pond, the cliff bank, the wall are walls
    for (const b of sc.buildings) {
      if (b.id === 'mine') continue;
      const [x0, y0, x1, y1] = b.foot, cx = (x0 + x1) / 2, cy = b.id === 'gate' ? (y0 + y1) / 2 : (y0 + y1) / 2;
      const px = b.id === 'gate' ? x0 + 40 : cx;
      expect(top(px, cy), b.id).toBe(Infinity);
    }
    for (const h of sc.houses) expect(top((h.foot[0] + h.foot[2]) / 2, (h.foot[1] + h.foot[3]) / 2)).toBe(Infinity);
    expect(top(600, 2300)).toBe(Infinity);   // pond
    expect(top(3000, rimY(sc.rim, 3000) + 80)).toBe(Infinity);   // the bank
    expect(top(1500, 2950)).toBe(Infinity);   // the city wall
    expect(top(700, 2410)).toBeLessThan(1);   // the pier
  });
  it('every building has a reachable door from the spawn (doors keep the site ids)', () => {
    const sp = L.spawn;
    expect(L.free(sp[0], sp[1])).toBe(true);
    for (const b of L.buildings) {
      // the fixture's free() is per 16 px cell (the site's is exact): the door's nearest walkable point
      const want = L.nearest(b.door.x, b.door.y);
      expect(Math.hypot(want[0] - b.door.x, want[1] - b.door.y), b.id).toBeLessThan(33);
      const p = L.path!(sp, [b.door.x, b.door.y]);
      const end = p[p.length - 1];
      expect(Math.hypot(end[0] - want[0], end[1] - want[1]), b.id).toBeLessThan(1);
    }
    // the plateau is reached only over the stairs: a straight line up the bank is not clear
    expect(L.clear!([3000, 1400], [3000, 1000])).toBe(false);
    expect(L.clear!([2386, 1400], [2386, 1100])).toBe(true);
  });
});

describe('new cats fair — 3D (src/world/faircats.ts)', () => {
  it('has no coplanar overlapping surfaces (z-fighting)', () => {
    const { rec, ground } = staticFairCats();
    const hits = rec.find(0.004, 2e-4, ground);
    const by = new Map<string, number>();
    for (const h of hits) by.set(h.a + ' × ' + h.b, (by.get(h.a + ' × ' + h.b) || 0) + 1);
    if (hits.length) console.log([...by].sort((p, q) => q[1] - p[1]).slice(0, 30).map(([kk, n]) => n + '  ' + kk).join('\n'));
    expect(hits.length).toBe(0);
  });
  it('builds every building, the houses and the decor; budget proxy (whole town, before culling)', () => {
    let tris = 0;
    const tags = new Set<string>();
    const { k } = staticFairCats(false, { jail: true, magic: true });
    // rebuild with a counting recorder
    const r = staticFairCatsCount();
    tris = r.tris; for (const t of r.tags) tags.add(t);
    for (const b of sc.buildings) expect(tags.has(b.id), b.id).toBe(true);
    expect(tags.has('houses')).toBe(true);
    registerProtoProps(k.inst, k.pal);
    let itris = 0;
    for (const [kind, list] of k.inst.placed) {
      const parts = (k.inst as any).kinds.get(kind) as { geo: THREE.BufferGeometry }[] | undefined;
      if (!parts) continue;
      for (const p of parts) itris += (p.geo.index ? p.geo.index.count : p.geo.attributes.position.count) / 3 * list.length;
    }
    console.log(`faircats static tris ${Math.round(tris)}, instanced ${Math.round(itris)}, trees ${k.inst.count('fc:pine') + k.inst.count('v:tree') + k.inst.count('fc:blossom')}`);
    expect(tris).toBeLessThan(90000);
    expect(tris + itris).toBeLessThan(160000);   // the whole town; a view shows a part of it (live: engine.stats ≤ 130k at q2)
  });
});

function staticFairCatsCount(): { tris: number; tags: Set<string> } {
  let tris = 0; const tags = new Set<string>();
  // the world-fixture recorder sees every piece; count triangles per piece
  const { rec } = staticFairCats(true);
  for (const p of rec.pieces) tags.add(p.tag);
  for (const t of (rec as any).tris.values()) tris += t.length;
  return { tris, tags };
}
void toX; void toZ; void inPoly; void groundSpec;

describe('app.js 04.11: the City stub during an expedition (src/net/city-tab.ts)', () => {
  it('a shown `.city-quest` stub counts as locked, not as an open City', async () => {
    const { cityTab } = await import('../src/net/city-tab');
    const btn = { hidden: false, getAttribute: () => null, classList: { contains: (c: string) => c === 'tab-lock' } };
    const doc = (sel: Record<string, boolean>) => ({ querySelector: (s: string) => (s === '.tabs button[data-tab="city"]' ? btn : sel[s] ? {} : null) }) as unknown as Document;
    expect(cityTab(doc({ '#tab-city.on .city-quest': true, '#tab-city.on': true, '#tab-city .city-quest': true }))).toBe('locked');
    expect(cityTab(doc({ '#tab-city .city-quest': true }))).toBe('locked');
    expect(cityTab(doc({ '#tab-city.on': true }))).toBe('open');
    expect(cityTab(doc({}))).toBe('open');
  });
});
