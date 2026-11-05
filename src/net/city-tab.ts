/** The site's «Город» tab state (app.js cityVis: aria-disabled + «Вы сейчас в походе» while the hero is in an
 *  expedition party). No module-level window access: safe to import from features and tests. */
export type CityTab = 'open' | 'locked' | 'missing';
/** 'open' (enabled), 'locked' (aria-disabled — in a party), 'missing' (no tab / hidden).
 *  The City panel itself shown (#tab-city.on) counts as open even while the button still says aria-disabled: the site's
 *  «Войти в город N» (quest.js data-qtown → app.js openTown: townEntry) opens the district town for a party member and
 *  only re-evaluates the button (cityVis) on the next /api/me render — app.js tab('city') never shows a locked City. */
export function cityTab(doc: Document = document): CityTab {
  const b = doc.querySelector<HTMLElement>('.tabs button[data-tab="city"]');
  if (!b || b.hidden) return 'missing';
  // app.js 04.11: during an expedition the tab is no longer aria-disabled — it opens the stub «Ты в походе - Город
  // откроется после похода» (`#tab-city .city-quest`, cityStub) and keeps the `tab-lock` class
  if (doc.querySelector('#tab-city.on .city-quest')) return 'locked';
  if (doc.querySelector('#tab-city.on')) return 'open';
  return b.getAttribute('aria-disabled') === 'true' || (!!b.classList?.contains?.('tab-lock') && !!doc.querySelector('#tab-city .city-quest')) ? 'locked' : 'open';
}

/** A district town the party stands in (q.town) that the site lets this hero enter: quest.js tabHtml shows
 *  «🏘 Войти в город «name»» when `v.town && hero.cy && hero.tw` (23.10: first stop in a ★1–2 district). */
export interface QuestTown { id: string; name: string }
export function questTown(v: unknown, hero: unknown): QuestTown | null {
  const q = v as { on?: boolean; town?: { id?: unknown; name?: unknown } | null } | null;
  const h = hero as { cy?: unknown; tw?: unknown } | null;
  if (!q || !q.on || !q.town || !h || !h.cy || !h.tw) return null;
  const id = q.town.id;
  if ((typeof id !== 'string' && typeof id !== 'number') || !String(id)) return null;
  return { id: String(id), name: String(q.town.name || id) };
}

/** The site's current City town id when its City panel is open (city.js `.cy[data-town]`), else null. A Town Kit town
 *  (`n-<id>`, city.js buildKit 05.11) is its district id. */
export function cityTownShown(doc: Document = document): string | null {
  if (!doc.querySelector('#tab-city.on')) return null;
  const cy = doc.querySelector<HTMLElement>('#tab-city .cy');
  if (!cy) return null;
  const t = cy.dataset.town || 'fair';
  return t.startsWith('n-') && t.length > 2 ? t.slice(2) : t;
}

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
async function until<T>(f: () => T | null | undefined | false, ms: number, step = 100): Promise<T | null> {
  const t0 = Date.now();
  for (;;) {
    const v = f(); if (v) return v;
    if (Date.now() - t0 >= ms) return null;
    await wait(step);
  }
}

export type EnterTownResult = 'ok' | 'no_button' | 'timeout';
/**
 * Enter the quest's district town exactly as the player does on the site: the «Поход» tab's own button
 * `[data-qtown="<id>"]` (its handler is app.js openTown: townEntry = now, LGCity.town(id), tab('city')). quest.js paints
 * the tab only while it is shown, so the «Поход» tab is opened first when the button is not there yet. Nothing else is
 * sent: the site loads the City files and enters the town itself. Call ONLY from an explicit player click.
 * Resolves once the site's City panel is open (#tab-city.on).
 */
export async function enterQuestTown(id: string, doc: Document = document, timeoutMs = 12000): Promise<EnterTownResult> {
  const sel = `#tab-quest [data-qtown="${cssEsc(id)}"]`;
  let btn = doc.querySelector<HTMLButtonElement>(sel);
  if (!btn) {
    doc.querySelector<HTMLButtonElement>('.tabs button[data-tab="quest"]:not([hidden])')?.click();
    btn = await until(() => doc.querySelector<HTMLButtonElement>(sel), 3000);
  }
  if (!btn) return 'no_button';
  btn.click();
  return (await until(() => doc.querySelector('#tab-city.on'), timeoutMs, 150)) ? 'ok' : 'timeout';
}
const cssEsc = (s: string) => s.replace(/["\\]/g, '\\$&');
