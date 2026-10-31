/**
 * F8 fires once per press (src/content/main.ts): not on auto-repeat (a held key), not within `gapMs` of the last accepted
 * press, and not while a boot or the mine's 2D ⇄ 3D switch is still in progress (QA 31.10: holding F8 toggled twice).
 */
export const F8_GAP_MS = 300;

export function createF8Gate(gapMs = F8_GAP_MS): (repeat: boolean, now: number, busy: boolean) => boolean {
  let last = -Infinity;
  return (repeat, now, busy) => {
    if (repeat || busy || now - last < gapMs) return false;
    last = now;
    return true;
  };
}
