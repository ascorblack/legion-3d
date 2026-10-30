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
