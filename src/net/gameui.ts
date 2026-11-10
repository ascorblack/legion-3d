/**
 * The site's «Игра» mode and its windows (site 09–10.11, app.js `guOn` = /api/me hero `gu` && hero `cy`, not in jail).
 *
 * With the mode on the City tab is the game screen (its tab button reads «Игра»): app.js draws a HUD of its own over the
 * City (`#gu-hud`, z 5 — under our canvas, never seen in 3D) with the entries «Герой», «Гильдия», «Арена», «Почта», «Поход»,
 * the mini-map, the rating, «Задания дня». The tabs `hero legion season war arena` (app.js GU_WIN) no longer switch the page:
 * `tab(id)` → `guTab(id)` opens the tab's section as a WINDOW over the City (`#tab-<id>.on.gu-win`, role="dialog",
 * aria-modal, z 28, its bar `#gu-wbar` «Закрыть и вернуться в город»), the City tab stays on and keeps running.
 * `window.LGGameUi = { on(), win(id), close(), open() }`.
 *
 * What it means for the 3D game (src/net/site.ts):
 *  - a site window opened by us (actions.openSitePanel) goes through LGGameUi.win: no classic switch — the window is a
 *    site dialog, the 3D yields to it (overlay 'dialog', src/features/overlay.ts) and comes back when it closes;
 *  - replayCityEnter must not use one of those tabs as «the other tab»: the click would open a window and the City would
 *    never leave / enter again (the enter answer the replay waits for would not come).
 * Pure helpers (no DOM of their own): importable in node tests.
 */

/** app.js GU_WIN: the tabs the «Игра» mode opens as windows over the City. */
export const GU_WINDOWS = ['hero', 'legion', 'season', 'war', 'arena'] as const;
export type GuWindow = typeof GU_WINDOWS[number];

type Win = { LGGameUi?: { on?: () => unknown; win?: (id: string) => unknown; open?: () => unknown } } & Record<string, any>;

/** The site's «Игра» mode is on (window.LGGameUi.on()). */
export function gameUiOn(W: Win | null | undefined): boolean {
  try { return !!(W && W.LGGameUi && typeof W.LGGameUi.on === 'function' && W.LGGameUi.on()); } catch { return false; }
}
/** The tab is one the «Игра» mode opens as a window (and the mode is on). */
export const guWindowOf = (W: Win | null | undefined, tab: string): boolean => gameUiOn(W) && (GU_WINDOWS as readonly string[]).includes(tab);

/**
 * Open `tab` as the site's own window of the «Игра» mode (LGGameUi.win). True when it was opened that way; false = not the
 * mode / not one of its windows / the site refused (the caller falls back to the classic tab switch).
 */
export function openGuWindow(W: Win | null | undefined, tab: string): boolean {
  if (!guWindowOf(W, tab)) return false;
  try {
    W!.LGGameUi!.win!(tab);
    const open = typeof W!.LGGameUi!.open === 'function' ? W!.LGGameUi!.open() : tab;
    return open === tab;
  } catch { return false; }
}

/** The tab buttons replayCityEnter may click to leave the City for a moment (in this order), skipping the windows of the
 *  «Игра» mode when it is on: a real tab switch makes the site leave the City and enter it again. */
export function replayTabOrder(guOn: boolean): string[] {
  const all = ['hero', 'news', 'world', 'legion', 'quest', 'streamer'];
  return guOn ? all.filter((t) => !(GU_WINDOWS as readonly string[]).includes(t)) : all;
}

type BtnLike = { getAttribute(n: string): string | null; hidden?: unknown; dataset?: DOMStringMap | Record<string, string | undefined> };
/** Pick «the other tab» for replayCityEnter from the page's tab buttons (not the City, not disabled, not [hidden]). */
export function pickReplayTab<T extends BtnLike>(buttons: readonly T[], cityBtn: T | null, guOn: boolean): T | null {
  const ok = (b: T) => b !== cityBtn && b.hidden !== true && b.getAttribute('aria-disabled') !== 'true' && b.getAttribute('hidden') == null;
  const tabOf = (b: T) => b.dataset?.tab ?? b.getAttribute('data-tab') ?? '';
  for (const t of replayTabOrder(guOn)) { const b = buttons.find((x) => tabOf(x) === t && ok(x)); if (b) return b; }
  const skip = guOn ? (GU_WINDOWS as readonly string[]) : [];
  return buttons.find((b) => ok(b) && tabOf(b) !== 'city' && !skip.includes(tabOf(b))) ?? null;
}
