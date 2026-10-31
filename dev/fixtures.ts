/**
 * Dev/test fixtures: a CityLayout built from the site's walk grid snapshot (test/fixtures/fair-map.json,
 * produced from LGCityMap.make() of the "cats" style fair city) — no site needed.
 */
import type { CityLayout, Building, Obstacle } from '../src/contracts';
import map from '../test/fixtures/fair-map.json';
import camp from '../test/fixtures/camp-map.json';
import village from '../test/fixtures/village-map.json';
import { campScene, villageScene } from '../src/net/town';

export function fixtureLayout(): CityLayout {
  const m = map as any;
  const { C, cols, rows, G } = m.grid as { C: number; cols: number; rows: number; G: number[] };
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
  return {
    id: 'fair', styleId: 'cats', W: m.W, H: m.H, QW: m.QW, area: m.AREA,
    obstacles: m.OBST as Obstacle[], buildings: m.BUILDINGS as Building[], low: m.LOW,
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
 * The fair with the channel's jail open (site 30.10, citymap.js LOW.jail / JAIL_OBST / lowJail; numbers only, the 3D
 * model is ours): the jail building + cage on the lower street right of the mine, their obstacles in the walk grid, the
 * two benches that stood there moved right. `?jail=1|me` in dist-dev/game.html.
 */
export const JAIL_LOW = {
  x0: 1540, x1: 1800, base: 1342, c0: 1830, c1: 2240, fy: 1352, door: [1985, 2055] as [number, number],
  seats: [[1890, 1262], [1980, 1262], [2070, 1262], [2160, 1262], [1935, 1318], [2025, 1318], [2115, 1318], [2195, 1318]] as [number, number][],
};
export const JAIL_BUILDING = { id: 'jail', title: 'Тюрьма', sub: 'заключённые канала', icon: '⛓', jail: true, hit: [1540, 2240, 1060, 1352], door: { x: 1670, y: 1376 } } as unknown as Building;
export function withJail(L: CityLayout): CityLayout {
  const J = JAIL_LOW, top = L.low?.edge?.[1] ?? 1124;
  const rects: [number, number, number, number][] = [[J.x0, top, J.x1, J.base], [J.c0 - 6, top, J.c1 + 6, J.fy + 4]];
  const MOVE: Record<string, [number, number]> = { '1600,1290': [2330, 1300], '2100,1310': [2560, 1310] };
  const benchAt = (o: Obstacle) => ('b' in o ? MOVE[`${o.b[0] + 80},${o.b[1] + 26}`] : undefined);
  const inR = (x: number, y: number) => rects.some(([a, b, c, d]) => x >= a && x <= c && y >= b && y <= d);
  const moved = L.obstacles.map((o) => { const to = benchAt(o); return to ? { b: [to[0] - 80, to[1] - 26, to[0] + 80, to[1] + 6] } as Obstacle : o; });
  const benches = (L.low?.benches || []).map(([x, y]) => MOVE[`${x},${y}`] ?? [x, y]) as [number, number][];
  const newBench = Object.values(MOVE).map(([bx, by]) => [bx - 80, by - 26, bx + 80, by + 6]);
  const blocked = (x: number, y: number) => inR(x, y) || newBench.some(([a, b, c, d]) => x >= a && x <= c && y >= b && y <= d);
  const free0 = L.free, near0 = L.nearest;
  const free = (x: number, y: number) => free0(x, y) && !blocked(x, y);
  const nearest = (x: number, y: number): [number, number] => {
    if (free(x, y)) return [x, y];
    for (let d = 8; d < 600; d += 8) for (const [dx, dy] of [[0, d], [d, 0], [-d, 0], [0, -d], [d, d], [-d, d]]) if (free(x + dx, y + dy)) return [x + dx, y + dy];
    return near0(x, y);
  };
  return {
    ...L, buildings: [...L.buildings, { ...JAIL_BUILDING, door: { ...JAIL_BUILDING.door } }],
    obstacles: [...moved, ...rects.map((b) => ({ b }) as Obstacle)],
    low: { ...L.low!, benches, jail: { ...J, door: [...J.door] as [number, number], seats: J.seats.map((s) => [...s] as [number, number]) } },
    free, nearest,
  };
}
