/**
 * Places of the site that the 3D game opens through the site's own buttons (site 07.11):
 *  - «Гильдейский район» (guildhall.js, window.LGGuildHall): the site puts a `.gd-entry` button into its City HUD
 *    (`.cy-hud`, hidden under the 3D) once GET /api/guildhall says the district is open for this hero. The pause-menu
 *    entry appears only while that button exists and presses it: the site's own pick window, then its full-screen district
 *    (`.gd-root`, its own WASD / E / Esc; the City sleeps meanwhile). src/net/site.ts reports `.gd-root` as the overlay
 *    'district' — the 3D game hides and pauses (src/features/overlay.ts) and comes back when the site closes it.
 *  - the tabs «Бой армий» (`war`, warcmd.js, /api/me `cw`) and «Сезоны» (`season`, season.js, `ss`): while the site shows
 *    their tab button, the pause menu offers them; a press switches to the classic site on that tab (actions.openSitePanel).
 * Nothing is sent from here; without the site's buttons nothing is shown.
 */
import { coreFeature } from './types';
import { registerPauseItem } from '../ui/settings-ext';

/** A site element that is in the page and not [hidden] (the City HUD itself is hidden under the 3D: not checked). */
export const present = (doc: Pick<Document, 'querySelector'>, sel: string): HTMLElement | null => {
  const e = doc.querySelector<HTMLElement>(sel);
  return e && !e.hidden ? e : null;
};
export const GUILD_ENTRY = '.cy-hud .gd-entry';
export const SITE_TABS: [id: string, label: string, order: number][] = [['war', '⚔ Бой армий', 23], ['season', '🏆 Сезоны', 24]];

export default coreFeature({
  id: 'site-places',
  order: 235,
  setup(ctx) {
    const offs = [
      registerPauseItem({ id: 'site.guild', label: '🏰 Гильдейский район', order: 26, enabled: () => !!present(document, GUILD_ENTRY),
        run: () => { setTimeout(() => present(document, GUILD_ENTRY)?.click(), 0); } }),
      ...SITE_TABS.map(([id, label, order]) => registerPauseItem({ id: 'site.tab.' + id, label, order,
        enabled: () => !!present(document, `.tabs button[data-tab="${id}"]`),
        run: () => { ctx.actions.openSitePanel(id); } })),
    ];
    return () => { for (const o of offs) o(); };
  },
});
