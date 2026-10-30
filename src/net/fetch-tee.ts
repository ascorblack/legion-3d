/**
 * Switch of the bridge's fetch tee (src/bridge/bridge.ts). window.fetch carries our wrapper only while the 3D game runs
 * and the site's own mine screen is not shown; in the classic 2D site (F8, start mode 2D) the page's own fetch is back,
 * so the site's anti-bot check of window.fetch (mine.js tlPi) sees nothing of ours.
 */
import type { Bus } from '../bridge/bridge';

/** Put the tee on / take it off; false when there is no bridge (dev pages) or the wrapper could not be put on / out. */
export function setFetchTee(on: boolean, w: { __L3D_BUS?: Bus } = window as unknown as { __L3D_BUS?: Bus }): boolean {
  try {
    const t = w.__L3D_BUS?.fetchTee; if (!t) return false;
    return on ? t.on() : t.off();
  } catch { return false; }
}
