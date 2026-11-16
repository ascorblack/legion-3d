/**
 * The game's clock (site 16.11 evening, app.js `gnow` → `window.LGGameNow`): server time (the Date header / `now` of the live
 * frames) minus the game's offset GDT (response header `x-lg-gdt`, or `now − gnow` of the live `me` / `q` frames; |GDT| ≤ 1 s
 * counts as 0). Hero timestamps — `eatUntil`, `scrollUntil`, `deadUntil`, the `.cd[data-until]` countdowns — are in game time:
 * after a maintenance pause the game's time lags the wall clock, so a countdown at Date.now() would end early. Our countdowns
 * read the site's own function when it is there and the local clock otherwise (offline demo, older site).
 */
export function gameNow(w: unknown = typeof window !== 'undefined' ? window : undefined): number {
  try {
    const f = (w as { LGGameNow?: () => unknown } | undefined)?.LGGameNow;
    if (typeof f === 'function') { const v = +(f() as number); if (Number.isFinite(v) && v > 0) return v; }
  } catch { /* the local clock */ }
  return Date.now();
}
