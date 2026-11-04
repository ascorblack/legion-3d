/**
 * Dev/test fixtures: a CityLayout built from the site's walk grid snapshot (test/fixtures/fair-map.json,
 * produced from LGCityMap.make() of the "cats" style fair city) — no site needed.
 */
import type { CityLayout, Building, Obstacle, JailGeo } from '../src/contracts';
import map from '../test/fixtures/fair-map.json';
import jailFx from '../test/fixtures/fair-jail.json';
import camp from '../test/fixtures/camp-map.json';
import village from '../test/fixtures/village-map.json';
import faircats from '../test/fixtures/faircats-map.json';
import { fairCatsScene, fairCatsBuildings, fairCatsLayout, type FairCatsLayout, type FcSiteMap } from '../src/net/faircats';
import { campScene, villageScene } from '../src/net/town';
import { soonOf } from '../src/net/site';

/** free / nearest over a walk grid of the fair fixture (cells C px from AREA.y0, 1 = walkable). */
function fairGrid(G: ArrayLike<number>): Pick<CityLayout, 'free' | 'nearest'> {
  const m = map as any;
  const { C, cols, rows } = m.grid as { C: number; cols: number; rows: number };
  const y0 = m.AREA.y0;
  const cell = (x: number, y: number) => [Math.floor(x / C), Math.floor((y - y0) / C)];
  const free = (x: number, y: number) => {
    if (x < m.AREA.x0 || x > m.AREA.x1 || y < m.AREA.y0 || y > m.AREA.y1) return false;
    const [c, r] = cell(x, y);
    return c >= 0 && r >= 0 && c < cols && r < rows && G[r * cols + c] === 1;
  };
  const nearest = (x: number, y: number): [number, number] => {
    if (free(x, y)) return [x, y];
    const [c0, r0] = cell(x, y);
    for (let d = 1; d < 60; d++) for (let r = r0 - d; r <= r0 + d; r++) for (let c = c0 - d; c <= c0 + d; c++) {
      if (Math.max(Math.abs(c - c0), Math.abs(r - r0)) !== d) continue;
      const px = c * C + C / 2, py = y0 + r * C + C / 2;
      if (free(px, py)) return [px, py];
    }
    return [m.QW + 960, y0 + 120];
  };
  return { free, nearest };
}

export function fixtureLayout(): CityLayout {
  const m = map as any;
  const { free, nearest } = fairGrid(m.grid.G as number[]);
  return {
    id: 'fair', styleId: 'cats', W: m.W, H: m.H, QW: m.QW, area: m.AREA,
    // the Ратуша opens like on the live page (src/net/site.ts soonOf, site 03.11), drawn with its scaffold
    obstacles: m.OBST as Obstacle[], buildings: (m.BUILDINGS as Building[]).map((b) => (b.id === 'hall' ? { ...b, ...soonOf(b, false, false, false) } : b)), low: m.LOW,
    sky: 'linear-gradient(#0f0d2a 0%, #1d1a4a 40%, #3a2f6e 75%, #5a3a7a 100%)',
    free, nearest,
  };
}

/** The camp's magic shop (site campmap.js 30.10, fix/camp-magic-shop): between the Storage and the Forge, `magic: true` — present only for a hero with the shop open. */
export const CAMP_MAGIC = { id: 'magic', title: 'Лавка звездочёта', sub: 'посохи, мантии, амулеты', icon: '🔮', magic: true, hit: [606, 846, 440, 800], door: { x: 722, y: 848 } } as unknown as Building;
/** The start camp «Перепутье» (test/fixtures/camp-map.json, scripts/fixture-camp.mjs): the same CityLayout shape the
 *  extension builds from window.LGCampMap at runtime (src/net/site.ts buildCampLayout) — free/nearest from the grid. */
export function campFixtureLayout(styleId = 'cats', magic = false): CityLayout {
  const m = camp as any;
  const { C, cols, rows } = m.grid as { C: number; cols: number; rows: number }, G: string = m.grid.G;
  const y0 = m.AREA.y0;
  const free = (x: number, y: number) => {
    if (x < m.AREA.x0 || x > m.AREA.x1 || y < m.AREA.y0 || y > m.AREA.y1) return false;
    const c = Math.floor(x / C), r = Math.floor((y - y0) / C);
    return c >= 0 && r >= 0 && c < cols && r < rows && G.charCodeAt(r * cols + c) === 49;
  };
  const nearest = (x: number, y: number): [number, number] => {
    if (free(x, y)) return [x, y];
    const c0 = Math.floor(x / C), r0 = Math.floor((y - y0) / C);
    for (let d = 1; d < 80; d++) for (let r = r0 - d; r <= r0 + d; r++) for (let c = c0 - d; c <= c0 + d; c++) {
      if (Math.max(Math.abs(c - c0), Math.abs(r - r0)) !== d) continue;
      const px = c * C + C / 2, py = y0 + r * C + C / 2;
      if (free(px, py)) return [px, py];
    }
    return [m.spawn[0], m.spawn[1]];
  };
  const L = {
    id: 'camp', styleId, W: m.W, H: m.H, QW: 0, area: m.AREA,
    obstacles: m.OBST as Obstacle[], buildings: [...(m.BUILDINGS as Building[]), ...(magic ? [CAMP_MAGIC] : [])].map((b) => ({ ...b, door: { ...b.door } })),
    sky: 'linear-gradient(#0f0d2a 0%, #1d1a4a 40%, #3a2f6e 75%, #5a3a7a 100%)',
    free, nearest, camp: campScene({ ...m, FENCE: m.FENCE }), spawn: [m.spawn[0], m.spawn[1]] as [number, number],
  };
  return L as CityLayout;
}

/**
 * A hand-made village ★1 (test/fixtures/village-map.json: an original test village laid out by the site's own
 * towngen.js buildHand, + its walk grid): lower-street buildings, polyline streets, a pond, a brook with a bridge,
 * cottages. `?town=village` in dist-dev/game.html. BFS path on the grid (bots, click-to-go).
 */
export function villageFixtureLayout(styleId = 'cats'): CityLayout {
  const m = village as any;
  const { C, cols, rows } = m.grid as { C: number; cols: number; rows: number }, G: string = m.grid.G;
  const y0 = m.AREA.y0;
  const ok = (c: number, r: number) => c >= 0 && r >= 0 && c < cols && r < rows && G.charCodeAt(r * cols + c) === 49;
  const free = (x: number, y: number) => {
    if (x < m.AREA.x0 || x > m.AREA.x1 || y < m.AREA.y0 || y > m.AREA.y1) return false;
    return ok(Math.floor(x / C), Math.floor((y - y0) / C));
  };
  const nearest = (x: number, y: number): [number, number] => {
    if (free(x, y)) return [x, y];
    const c0 = Math.floor(x / C), r0 = Math.floor((y - y0) / C);
    for (let d = 1; d < 80; d++) for (let r = r0 - d; r <= r0 + d; r++) for (let c = c0 - d; c <= c0 + d; c++) {
      if (Math.max(Math.abs(c - c0), Math.abs(r - r0)) !== d) continue;
      if (ok(c, r)) return [c * C + C / 2, y0 + r * C + C / 2];
    }
    return [m.spawn[0], m.spawn[1]];
  };
  const path = (a: [number, number], b: [number, number]): [number, number][] => {
    const [ax, ay] = nearest(a[0], a[1]), [bx, by] = nearest(b[0], b[1]);
    const s = Math.floor((ay - y0) / C) * cols + Math.floor(ax / C), t = Math.floor((by - y0) / C) * cols + Math.floor(bx / C);
    const prev = new Int32Array(cols * rows).fill(-1); prev[s] = s;
    const q = [s];
    for (let i = 0; i < q.length && prev[t] < 0; i++) {
      const u = q[i], c = u % cols, r = (u / cols) | 0;
      for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const v = (r + dr) * cols + c + dc; if (ok(c + dc, r + dr) && prev[v] < 0) { prev[v] = u; q.push(v); } }
    }
    if (prev[t] < 0) return [a];
    const out: [number, number][] = [];
    for (let u = t; u !== s; u = prev[u]) out.push([(u % cols) * C + C / 2, y0 + ((u / cols) | 0) * C + C / 2]);
    out.push(a); out.reverse();
    return out.filter((_, i) => i === 0 || i === out.length - 1 || i % 3 === 0);
  };
  const L = {
    id: m.id, styleId, W: m.W, H: m.H, QW: 0, area: m.AREA,
    obstacles: m.OBST as Obstacle[], buildings: (m.BUILDINGS as Building[]).map((b) => ({ ...b, door: { ...b.door } })),
    free, nearest, path, village: villageScene(m), spawn: [m.spawn[0], m.spawn[1]] as [number, number],
  };
  return L as CityLayout;
}

/**
 * The fair with the channel's jail open — the site's own numbers (test/fixtures/fair-jail.json: citymap.js 31.10
 * make(…, { jail }) of the same cats fair, the 3D model is ours): 31.10 the jail stands beyond the canal by the lower fence
 * (30.10 it stood against the retaining wall right of the mine), building + cage solid from `back` to their base in the
 * walk grid, the barrel that stood in the cage's place moved right of the bridge and the crate at the house's corner moved
 * left (LOW.jail.move.decor; the benches stay). `?jail=1|me` in dist-dev/game.html.
 */
export const JAIL_LOW = (jailFx as any).jail as JailGeo & { move: { benches: [number, number][]; decor: [number, number][] } };
export const JAIL_BUILDING = (jailFx as any).building as Building;
export function withJail(L: CityLayout): CityLayout {
  const fx = jailFx as any, m = map as any;
  // the site's grid with the jail: fair-map.json grid.G patched by [cell, count, value] runs
  const G = (m.grid.G as number[]).slice();
  for (const [i, n, v] of fx.gridPatch as [number, number, number][]) for (let k = 0; k < n; k++) G[i + k] = v;
  const { free, nearest } = fairGrid(G);
  const J = JAIL_LOW;
  return {
    ...L, buildings: [...L.buildings, { ...JAIL_BUILDING, door: { ...JAIL_BUILDING.door } }],
    obstacles: fx.OBST as Obstacle[],
    low: { ...L.low!, benches: fx.benches, decor: fx.decor, jail: { ...J, door: [...J.door] as [number, number], seats: J.seats.map((s) => [...s] as [number, number]), walk: [...J.walk!] as [number, number, number, number] } },
    free, nearest,
  };
}

/**
 * The new cats fair (site 04.11, hero flag me.fc; test/fixtures/faircats-map.json, scripts/fixture-faircats.mjs from the
 * site's fc-map.js): the same layout the extension builds from window.LGFairCats / LGFairCatsCity at runtime
 * (src/net/site.ts buildFairCatsLayout) — the walk grid's levels (0 blocked, 1 town, 2 plateau, 3 stairs), free / nearest /
 * clear / path with the site's level rule (a step changes level only over stairs), the old fair's titles (fc-city.js meta).
 * `?fc=1` in dist-dev/game.html and dist-dev/world.html.
 */
export function fairCatsFixtureMap(o: { jail?: boolean; magic?: boolean } = {}): FcSiteMap & { G: Uint8Array; C: number; cols: number; rows: number } {
  const m = faircats as any;
  const { C, cols, rows } = m.grid as { C: number; cols: number; rows: number };
  const G = new Uint8Array(cols * rows);
  const src: string = m.grid.G;
  for (let i = 0; i < G.length; i++) G[i] = src.charCodeAt(i) - 48;
  if (o.jail) for (const [i, n, v] of m.grid.jailPatch as [number, number, number][]) for (let j = 0; j < n; j++) G[i + j] = v;
  const lv = (x: number, y: number) => { const c = Math.floor(x / C), r = Math.floor(y / C); return c >= 0 && r >= 0 && c < cols && r < rows ? G[r * cols + c] : 0; };
  const compat = (a: number, b: number) => a === b || a === 3 || b === 3;
  const free = (x: number, y: number) => lv(x, y) > 0;
  const clear = (a: [number, number], b: [number, number]) => {
    let lp = lv(a[0], a[1]); if (!lp) return false;
    const d = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.max(1, Math.ceil(d / 4));
    for (let i = 1; i <= n; i++) { const t = i / n, l = lv(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t); if (!l || !compat(lp, l)) return false; lp = l; }
    return true;
  };
  const nearest = (x: number, y: number): [number, number] => {
    if (free(x, y)) return [Math.round(x), Math.round(y)];
    const c0 = Math.floor(x / C), r0 = Math.floor(y / C);
    for (let d = 1; d < 80; d++) for (let r = r0 - d; r <= r0 + d; r++) for (let c = c0 - d; c <= c0 + d; c++) {
      if (Math.max(Math.abs(c - c0), Math.abs(r - r0)) !== d) continue;
      if (c >= 0 && r >= 0 && c < cols && r < rows && G[r * cols + c]) return [c * C + C / 2, r * C + C / 2];
    }
    return [m.home.x, m.home.y];
  };
  const path = (a: [number, number], b: [number, number]): [number, number][] => {
    const A = nearest(a[0], a[1]), B = nearest(b[0], b[1]);
    if (clear(A, B)) return [A, B];
    const s = Math.floor(A[1] / C) * cols + Math.floor(A[0] / C), t = Math.floor(B[1] / C) * cols + Math.floor(B[0] / C);
    const prev = new Int32Array(cols * rows).fill(-1); prev[s] = s;
    const q = [s];
    for (let i = 0; i < q.length && prev[t] < 0; i++) {
      const u = q[i], c = u % cols, r = (u / cols) | 0;
      for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nc = c + dc, nr = r + dr, v = nr * cols + nc;
        if (nc < 0 || nr < 0 || nc >= cols || nr >= rows || !G[v] || prev[v] >= 0 || !compat(G[u], G[v])) continue;
        prev[v] = u; q.push(v);
      }
    }
    if (prev[t] < 0) return [A];
    const out: [number, number][] = [];
    for (let u = t; u !== s; u = prev[u]) out.push([(u % cols) * C + C / 2, ((u / cols) | 0) * C + C / 2]);
    out.push(A); out.reverse();
    const pts = out.filter((_, i) => i === 0 || i === out.length - 1 || i % 3 === 0);
    pts[pts.length - 1] = B;   // ends on the goal itself, not its cell centre
    return pts;
  };
  return { W: m.W, H: m.H, OBST: m.OBST, BUILDINGS: [], free, nearest, clear, path, levelAt: lv, G, C, cols, rows };
}
export function fairCatsFixtureLayout(o: { styleId?: string; jail?: boolean; magic?: boolean } = {}): FairCatsLayout {
  const sc = fairCatsScene(faircats)!;
  const meta = (id: string) => (map as any).BUILDINGS.find((b: any) => b.id === id) || null;
  const blds = fairCatsBuildings(sc, meta, { jail: !!o.jail, magic: !!o.magic }).map((b) => ({ ...b, ...soonOf(b, false, false, false) }));
  const fm = fairCatsFixtureMap(o);
  const L = fairCatsLayout(sc, fm, blds, { styleId: o.styleId ?? 'cats', jail: !!o.jail });
  L.sky = 'linear-gradient(#0f0d2a 0%, #1d1a4a 40%, #3a2f6e 75%, #5a3a7a 100%)';
  return L;
}
