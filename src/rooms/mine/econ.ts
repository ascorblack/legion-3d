import type { Cell, Dl, MineView } from './state';

/** All values here are estimates from the current view, never a promise of loot or wages. */
export interface StoneEstimate {
  estimated: true;
  minutes: number | null;
  diggers: number;
  share: number | null;
  pieces: number | null;
  coins: number | null;
  coinsPerHour: number | null;
  samples: number;
}
const positive = (v: unknown): number | null => typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null;

/** Median observed work/level²; only already active stones have measured total work. */
export function workAtLevel(st: MineView, level: number): number | null {
  const xs: number[] = [];
  for (const [key, b] of Object.entries(st.bl || {})) {
    const lv = st.fl?.c[+key]?.[1], w = positive(b[1]);
    if (lv && w) xs.push(w / (lv * lv));
  }
  if (!xs.length || !positive(level)) return null;
  xs.sort((a, b) => a - b);
  return xs[Math.floor(xs.length / 2)] * level * level;
}

/** Mean whole-piece yield per completed stone of this resource, including shard fractions. */
export function yieldOf(dl: Dl[] | undefined, resource: string): { pieces: number | null; samples: number } {
  let total = 0, samples = 0;
  for (const d of dl || []) {
    if (d[2] !== resource) continue;
    const shares = d[4] || d[3];
    let sum = 0;
    for (const v of Object.values(shares || {})) if (Number.isFinite(v) && v > 0) sum += d[4] ? v / 100 : v;
    if (sum > 0) { total += sum; samples++; }
  }
  return { pieces: samples ? total / samples : null, samples };
}

/** Observed distribution on one completed stone. Values are fractional ore pieces, not percentages. */
export function contributionShare(contributions: Record<string, number>, login: string): number | null {
  const total = Object.values(contributions).reduce((sum, v) => sum + (Number.isFinite(v) && v > 0 ? v : 0), 0);
  const own = contributions[login.toLowerCase()] || contributions[login] || 0;
  return total > 0 && Number.isFinite(own) ? Math.max(0, own) / total : null;
}

/** Approximate one miner's marginal rate from the current stone: rate / current diggers. */
export function minerRate(st: MineView, ownIndex: number): number | null {
  const b = st.bl?.[ownIndex];
  return b ? (positive(b[2]) || 0) / Math.max(1, b[3] || 0) || null : null;
}

export function estimateStone(st: MineView, cell: Cell, now: number, ownIndex = -1): StoneEstimate {
  const b = st.bl?.[cell.i], diggers = Math.max(0, b?.[3] || 0);
  const observedRate = positive(b?.[2]);
  const samples = Object.values(st.bl || {}).map((x) => (positive(x[2]) || 0) / Math.max(1, x[3] || 0)).filter((x) => x > 0).sort((a, b) => a - b);
  const personalRate = minerRate(st, ownIndex) || (observedRate ? observedRate / Math.max(1, diggers) : null) || (samples.length ? samples[Math.floor(samples.length / 2)] : null);
  const work = positive(b?.[1]) || workAtLevel(st, cell.lv);
  const elapsed = Math.max(0, (now - (st.at || now)) / 60000);
  const left = b ? Math.max(0, b[0] - (observedRate || 0) * elapsed) : work;
  const rate = (observedRate || 0) + (ownIndex === cell.i ? 0 : personalRate || 0);
  const minutes = left != null && rate > 0 ? left / rate : null;
  const share = personalRate && rate > 0 ? Math.min(1, personalRate / rate) : null;
  const yieldSample = cell.r ? yieldOf(st.dl, cell.r) : { pieces: null, samples: 0 };
  const pieces = yieldSample.pieces != null && share != null ? yieldSample.pieces * share : null;
  const price = cell.r ? positive(st.bp?.[cell.r]) : null;
  const coins = pieces != null && price != null ? pieces * price : null;
  return { estimated: true, minutes, diggers, share, pieces, coins,
    coinsPerHour: coins != null && minutes != null && minutes > 0 ? coins * 60 / minutes : null,
    samples: yieldSample.samples };
}

/** Relative buyer price bands, never a forecast of guaranteed earnings. */
export function valueCoins(price: number | undefined, prices: Record<string, number> | undefined): 0 | 1 | 2 | 3 {
  const validPrice = positive(price);
  if (validPrice == null) return 0;
  const values = Object.values(prices || {}).filter((v) => positive(v) != null).sort((a, b) => a - b);
  if (!values.length || validPrice <= values[0]) return 0;
  const rank = values.filter((v) => v <= validPrice).length / values.length;
  return rank > 0.8 ? 3 : rank > 0.5 ? 2 : 1;
}

/** Russian decimal: 0.9 → «0,9», 12 → «12», 0.035 → «0,035» (2 significant digits under 1). */
export function ruNum(v: number): string {
  if (!Number.isFinite(v)) return '?';
  const a = Math.abs(v);
  const s = a >= 10 ? String(Math.round(v)) : a >= 1 ? (Math.round(v * 10) / 10).toString() : a > 0 ? (+v.toPrecision(2)).toString() : '0';
  return s.replace('.', ',');
}
/** «≈ 34 мин», «≈ 1 ч 20 мин», «< 1 мин»; null → null. */
export function etaText(minutes: number | null): string | null {
  if (minutes == null || !Number.isFinite(minutes)) return null;
  if (minutes < 1) return '< 1 мин';
  const m = Math.ceil(minutes);
  if (m < 60) return `≈ ${m} мин`;
  const h = Math.floor(m / 60), r = m % 60;
  return r ? `≈ ${h} ч ${r} мин` : `≈ ${h} ч`;
}
/** «3 %», «0,7 %» (fractions 0..1). */
export function shareText(share: number | null): string | null {
  if (share == null || !Number.isFinite(share)) return null;
  const p = share * 100;
  return `≈ ${p >= 1 ? Math.round(p) : ruNum(p)} %`;
}
/** Text of the aimed-stone sign. Every number is marked as an estimate («≈»); `perHour` is shown with a coin glyph. */
export interface SignText { main: string; share: string; perHour: string | null }
export function signText(e: StoneEstimate, mine: boolean): SignText {
  const eta = etaText(e.minutes);
  const who = mine && e.diggers <= 1 ? 'копаешь один' : e.diggers > 0 ? `${e.diggers} ${e.diggers === 1 ? 'копает' : 'копают'}` : 'никто не копает';
  const main = `${eta ?? 'темп ещё не измерен'} · ${who}`;
  const sh = shareText(e.share);
  const share = sh ? `твоя доля ${sh}` : 'твоя доля — мало данных';
  const perHour = e.coinsPerHour != null ? `≈ ${ruNum(e.coinsPerHour)}` : null;
  return { main, share, perHour };
}
/**
 * The aimed stone's estimate for the crosshair prompt line (#8): «≈ 34 мин · доля ≈ 3 % · ≈ 0,9 ⦿/ч». Parts without data
 * are left out; '' when nothing is known. Every number is an estimate («≈», «< 1 мин»).
 */
export function promptEcon(e: StoneEstimate): string {
  const out: string[] = [];
  const eta = etaText(e.minutes); if (eta) out.push(eta);
  const sh = shareText(e.share); if (sh) out.push(`доля ${sh}`);
  if (e.coinsPerHour != null && Number.isFinite(e.coinsPerHour)) out.push(`≈ ${ruNum(e.coinsPerHour)} ⦿/ч`);
  return out.join(' · ');
}
