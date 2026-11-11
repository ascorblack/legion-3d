/**
 * Ore share split of a dug stone: a 1:1 port of the site's `LGMineShares` (mine.js 11.11, UMD module at the top of the
 * file; the server splits the loot with the same code). Shards (100 = 1 piece) of every resource are split by weight
 * (work put in), whole shards only: floors first, everyone who is "ok" gets at least one when there are enough, the
 * remainder goes by the largest fractional part, ties by weight then login.
 *
 *   splitShards(250, [['a', 3], ['b', 1]])            → { a: 188, b: 62 }
 *   project({ loot: { iron: 300 }, by: {}, left: 1, dig: [], me: 'a', pw: 1 }) → { iron: 300 }
 *
 * test/site-1111.test.ts runs the site's own module (node:vm) against this port on random inputs.
 */

export type ShareList = [string, number][];
export interface ProjectIn {
  /** Loot of the stone: resource → shards. */
  loot: Record<string, number>;
  /** Shards already paid out (diggers who left with their part): resource → shards. */
  paid?: Record<string, number>;
  /** Work already put in, by login ('~' = everyone else together). */
  by?: Record<string, number>;
  /** Work left; it is shared by the current diggers in proportion to their power. */
  left?: number;
  /** Current diggers and their power [login, power]. */
  dig?: ShareList;
  /** Only these logins are guaranteed a shard (null = everybody). */
  ok?: Set<string> | string[] | null;
}

/** Split T shards by weights (site splitShards). */
export function splitShards(T: number, ls0: ShareList, ok?: Set<string> | null): Record<string, number> {
  const ls = ls0.filter(([, w]) => w > 0), n = ls.length, out: Record<string, number> = {};
  if (!n || !(T > 0)) return out;
  const W = ls.reduce((a, x) => a + x[1], 0), q = ls.map(([, w]) => T * w / W), a = q.map((x) => Math.floor(x + 1e-9));
  const gu = (k: number) => !ok || ok.has(ls[k][0]);
  let need = 0; for (let k = 0; k < n; k++) if (gu(k) || a[k] >= 1) need++;
  if (T >= need) for (let k = 0; k < n; k++) if (a[k] < 1 && gu(k)) a[k] = 1;
  let A = a.reduce((s, x) => s + x, 0);
  const tie = (x: number, y: number) => ls[y][1] - ls[x][1] || (ls[x][0] < ls[y][0] ? -1 : ls[x][0] > ls[y][0] ? 1 : 0);
  if (A < T) {
    const ord = ls.map((_, k) => k).sort((x, y) => (q[y] - a[y]) - (q[x] - a[x]) || tie(x, y));
    for (let j = 0; A < T; j = (j + 1) % n) { a[ord[j]]++; A++; }
  }
  while (A > T) {
    let best = -1;
    for (let k = 0; k < n; k++) {
      if (a[k] > 1 && (best < 0 || (a[k] - q[k]) - (a[best] - q[best]) > 1e-12
        || (Math.abs((a[k] - q[k]) - (a[best] - q[best])) <= 1e-12 && tie(best, k) < 0))) best = k;
    }
    if (best < 0) break;
    a[best]--; A--;
  }
  for (let k = 0; k < n; k++) if (a[k] > 0) out[ls[k][0]] = a[k];
  return out;
}

/** Everybody's projected loot: login → resource → shards (site projectAll). */
export function projectAll(o: ProjectIn): Record<string, Record<string, number>> {
  const by: Record<string, number> = { ...(o.by || {}) }, left = Math.max(0, +(o.left as number) || 0), dig = (o.dig || []).filter(([, p]) => p > 0);
  const sum = dig.reduce((a, x) => a + x[1], 0);
  if (sum > 0) for (const [l, p] of dig) by[l] = (by[l] || 0) + left * p / sum;
  const ls = Object.entries(by).filter(([, w]) => w > 0), out: Record<string, Record<string, number>> = {};
  const ok = o.ok ? (o.ok instanceof Set ? o.ok : new Set(o.ok)) : null;
  for (const [k, T] of Object.entries(o.loot || {})) {
    const rest = Math.max(0, (+T || 0) - (+((o.paid || {})[k]) || 0)); if (!(rest > 0)) continue;
    for (const [l, v] of Object.entries(splitShards(rest, ls, ok))) if (v > 0) (out[l] || (out[l] = {}))[k] = v;
  }
  return out;
}

/** My projected loot (site project): I am counted as a digger with power `pw` when the list does not have me yet. */
export function project(o: ProjectIn & { me: string; pw?: number }): Record<string, number> {
  const me = String(o.me || ''), dig = (o.dig || []).filter(([, p]) => p > 0);
  if (me && !dig.some(([l]) => l === me) && (o.pw as number) > 0) dig.push([me, +(o.pw as number)]);
  const ok = o.ok ? new Set([...(o.ok instanceof Set ? o.ok : o.ok), me]) : null;
  return projectAll({ ...o, dig, ok })[me] || {};
}
