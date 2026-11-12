/**
 * The site's guild hall (guildhall.js, site 12.11): `window.LGGuildHall` — an INTERIOR of its own (LGGuildHallMap,
 * W 3840 × H 3240: wall, dais and steps, carpet, columns, OBJ items desk / chest / run gate / board / trophies …),
 * drawn by LGGuildHallArt over the Town Kit + citygl.js and opened over the sleeping City. It replaced the guild
 * district of 07.11 (a Town Kit town `.gd-root`, LGGuildDistrict / LGGuildDistrictArt, `.gd-entry`, LGGuildHall.pick).
 *
 * How the site enters it:
 *  - a town with the building `guild` («Здание гильдий», the cats fair since 12.11): a click / E on the building →
 *    city.js goBuilding('guild') walks to its door → ghOpen() → LGGuildHall.enter(); LGCity.panel('guild') → openPanel →
 *    ghOpen() too. city.js soonB: the building is «скоро» while `ghOn() === false` (no LGGuildHall, or its cached
 *    GET /api/guildhall is not ok: 409 «Здания гильдий нет в этом сезоне» {unavailable}).
 *  - any other town: guildhall.js entryTick puts `.gh-entry` («🏰 Здание гильдии») into the City HUD `.cy-hud` once
 *    index() is ok and the town has no `guild` building (LGCity.hasB); its click = enter().
 *  enter(): index(true) (the same GET, forced) → not ok: a toast «Здание гильдий скоро откроется» (closed / unavailable)
 *  or the error; ok without `guild`: the modal `.gh-modal.gh-noguild` (role dialog, aria-modal: «Вступи в гильдию»,
 *  button → LGGuilds.pick()); else open(r): `.gh-root` (fixed, z 900) on <body> / the fullscreen element,
 *  html.gh-full, LGCity.sleep(); its own WASD / E (nearest OBJ) / Esc (close → LGCity.wake()).
 * LGGuildHall now: { on, enter, close, index, open (= enter), debug, obj, act, screen, cam, place, stats, busy }.
 *
 * The 3D (src/features/site-places.ts, src/net/site.ts): E on the 3D guild building → LGCity.panel('guild') (the site's
 * own path); «скоро» mirrors soonB with the site's own text; `.gh-root` is the overlay 'guildhall' (the 3D hides and
 * pauses), `.gh-modal` a dialog; the pause entry presses `.gh-entry` where the site shows it. Never a request of ours:
 * on() / index() are the site's cached reads it makes itself (soonB, entryTick).
 */

/** guildhall.js open(): the hall's full-screen root. */
export const GH_ROOT = '.gh-root';
/** guildhall.js entryTick(): «🏰 Здание гильдии» in the City HUD (towns without the `guild` building). */
export const GH_ENTRY = '.cy-hud .gh-entry';
/** guildhall.js modal(): «Вступи в гильдию» and the hall's own windows (role dialog, aria-modal). */
export const GH_MODAL = '.gh-modal';
/** guildhall.js enter() for a closed / unavailable hall; city.js ghOpen() without LGGuildHall. */
export const GH_SOON = 'Здание гильдий скоро откроется';
/** The building id (fc-map.js BUILDINGS, city.js IDS.guild). */
export const GUILD_ID = 'guild';

/** city.js ghOn(): LGGuildHall.on() — true (the hall is open), false (not: soon), null (its first GET is under way). */
export function ghOn(w: any): boolean | null {
  const G = w && w.LGGuildHall;
  try { return G && typeof G.on === 'function' ? (G.on() ?? null) : false; } catch { return false; }
}
/** city.js soonB for `guild`: «скоро» exactly while ghOn() === false. */
export const guildSoon = (on: boolean | null): boolean => on === false;
/** guildhall.js enter(): the toast for a refused index answer (null = no refusal). */
export function ghRefusal(r: any): { text: string; bad: boolean } | null {
  if (r && r.ok) return null;
  const soft = !!(r && (r.closed || r.unavailable));
  return { text: soft ? GH_SOON : (r && r.error) || 'Здание гильдии сейчас недоступно', bad: !soft };
}
