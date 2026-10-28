/** The site's «Город» tab state (app.js cityVis: aria-disabled + «Вы сейчас в походе» while the hero is in an
 *  expedition party). No module-level window access: safe to import from features and tests. */
export type CityTab = 'open' | 'locked' | 'missing';
/** 'open' (enabled), 'locked' (aria-disabled — in a party), 'missing' (no tab / hidden). */
export function cityTab(doc: Document = document): CityTab {
  const b = doc.querySelector<HTMLElement>('.tabs button[data-tab="city"]');
  if (!b || b.hidden) return 'missing';
  return b.getAttribute('aria-disabled') === 'true' ? 'locked' : 'open';
}
