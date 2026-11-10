/**
 * Places of the site that the 3D game opens through the site's own buttons (site 07.11):
 *  - «Гильдейский район» (guildhall.js, window.LGGuildHall): the site puts a `.gd-entry` button into its City HUD
 *    (`.cy-hud`, hidden under the 3D) once GET /api/guildhall says the district is open for this hero. The pause-menu
 *    entry appears only while that button exists and presses it: the site's own pick window, then its full-screen district
 *    (`.gd-root`, its own WASD / E / Esc; the City sleeps meanwhile). src/net/site.ts reports `.gd-root` as the overlay
 *    'district' — the 3D game hides and pauses (src/features/overlay.ts) and comes back when the site closes it.
 *  - the tabs «Бой армий» (`war`, warcmd.js, /api/me `cw`), «Сезоны» (`season`, season.js, `ss`) and «Арена» (`arena`,
 *    arena.js, /api/me `ar`, site 10.11): while the site shows their tab button, the pause menu offers them; a press opens
 *    them through actions.openSitePanel — in the site's «Игра» mode as its window over the City (the 3D yields to the
 *    dialog), otherwise the classic site on that tab.
 * Site 10.11 (the «Игра» HUD `#gu-hud` lives under our canvas, so its entries are mirrored here):
 *  - «Почта» (mail.js, window.LGMail: `on()` = GET /api/mail/count said it is on, `unread()`, `open()` → the `.ml-win`
 *    dialog); the label carries the unread count, a new letter is announced once with a toast;
 *  - «Гильдии» (guilds.js, window.LGGuilds): the site's `.cy-hud .gl-entry` button exists once GET /api/guilds is ok — pressed;
 *  - «Задания дня» (dailies.js, window.LGDailies, hero `dl`): its `<dialog>` (showModal: the top layer, over everything);
 *  - «Мини-карта и рейтинг» (minimap.js through app.js window.LegionMiniMap, only in the «Игра» mode like the site's HUD):
 *    the `.lmm` dialog (z 900, over our canvas).
 * Every window is the site's own dialog: the 3D yields while it is shown and comes back after (overlay 'dialog').
 * Nothing is sent from here; without the site's buttons / globals nothing is shown.
 */
import { coreFeature } from './types';
import { registerPauseItem } from '../ui/settings-ext';
import { gameUiOn } from '../net/gameui';

/** A site element that is in the page and not [hidden] (the City HUD itself is hidden under the 3D: not checked). */
export const present = (doc: Pick<Document, 'querySelector'>, sel: string): HTMLElement | null => {
  const e = doc.querySelector<HTMLElement>(sel);
  return e && !e.hidden ? e : null;
};
export const GUILD_ENTRY = '.cy-hud .gd-entry';
/** guilds.js entryTick(): «🛡 Гильдия / Гильдии» in the City HUD, before the district's button. */
export const GUILDS_ENTRY = '.cy-hud .gl-entry';
export const SITE_TABS: [id: string, label: string, order: number, icon: string][] = [['war', 'Бой армий', 23, 'banner'], ['season', 'Сезоны', 24, 'trophy'], ['arena', 'Арена 5×5', 24.5, 'swords']];

const W = (typeof window !== 'undefined' ? window : globalThis) as any;
const call = (fn: () => unknown) => { try { fn(); } catch (e) { console.warn('[legion-3d] site window', e); } };

/** The site's mail is on for this hero (app.js window.LGMail.on(): /api/mail/count did not say `off`). */
export const mailOn = (w: any = W): boolean => { try { return !!(w.LGMail && typeof w.LGMail.on === 'function' && w.LGMail.on()); } catch { return false; } };
export const mailUnread = (w: any = W): number => { try { return Math.max(0, Math.floor(+w.LGMail.unread() || 0)); } catch { return 0; } };
/** Pause-menu badge of the mail: the unread count like the site's badge («99+»), '' when nothing is new. */
export const mailBadge = (n: number): string => (n > 0 ? (n > 99 ? '99+' : String(n)) : '');
/** Daily tasks are on (app.js dlSync: hero `dl`, dailies.js loaded). */
export const dailiesOn = (hero: any, w: any = W): boolean => !!(hero && hero.dl && w.LGDailies && typeof w.LGDailies.open === 'function');
/** The mini-map window (app.js window.LegionMiniMap) — the site offers it only in the «Игра» HUD. */
export const miniMapOn = (w: any = W): boolean => gameUiOn(w) && !!(w.LegionMiniMap && typeof w.LegionMiniMap.open === 'function');

export default coreFeature({
  id: 'site-places',
  order: 235,
  setup(ctx) {
    const offs = [
      registerPauseItem({ id: 'site.guild', label: 'Гильдейский район', order: 26, group: 'city', icon: 'castle', enabled: () => !!present(document, GUILD_ENTRY),
        run: () => { setTimeout(() => present(document, GUILD_ENTRY)?.click(), 0); } }),
      registerPauseItem({ id: 'site.guilds', label: 'Гильдии', order: 25.5, group: 'city', icon: 'shield', enabled: () => !!present(document, GUILDS_ENTRY),
        run: () => { setTimeout(() => present(document, GUILDS_ENTRY)?.click(), 0); } }),
      ...SITE_TABS.map(([id, label, order, icon]) => registerPauseItem({ id: 'site.tab.' + id, label, order, group: 'city', icon,
        enabled: () => !!present(document, `.tabs button[data-tab="${id}"]`),
        run: () => { ctx.actions.openSitePanel(id); } })),
      registerPauseItem({ id: 'site.mail', label: 'Почта', badge: () => mailBadge(mailUnread()), order: 21, group: 'city', icon: 'mail', enabled: () => mailOn(),
        run: () => { setTimeout(() => call(() => W.LGMail.open()), 0); } }),
      registerPauseItem({ id: 'site.dailies', label: 'Задания дня', order: 21.5, group: 'city', icon: 'tasks', enabled: () => dailiesOn(ctx.store?.hero),
        run: () => { setTimeout(() => call(() => W.LGDailies.open()), 0); } }),
      registerPauseItem({ id: 'site.minimap', label: 'Мини-карта и рейтинг', order: 26.5, group: 'city', icon: 'mapcup', enabled: () => miniMapOn(),
        run: () => { setTimeout(() => call(() => W.LegionMiniMap.open({ tab: 'map' })), 0); } }),
    ];
    // a new letter (app.js 'lgmail' {unread, wait, off}, also from SSE `mail`): one toast while the 3D is on screen
    let seen = mailOn() ? mailUnread() : 0;
    const onMail = (e: Event) => {
      const d = (e as CustomEvent).detail || {};
      const n = d.off ? 0 : Math.max(0, Math.floor(+d.unread || 0));
      if (n > seen && !ctx.state.classic && !ctx.state.overlay) ctx.ui.toast(`✉ Новое письмо на почте — Esc → «Почта»`);
      seen = n;
    };
    if (typeof window !== 'undefined' && window.addEventListener) window.addEventListener('lgmail', onMail);
    return () => { for (const o of offs) o(); if (typeof window !== 'undefined' && window.removeEventListener) window.removeEventListener('lgmail', onMail); };
  },
});
