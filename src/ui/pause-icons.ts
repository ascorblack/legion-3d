/**
 * Line icons of the pause menu (24×24, stroke = currentColor, round joins, a 2.2 px line at every size): one set for every entry, built-in or
 * registered by a feature (`registerPauseItem({ icon })`). An unknown name draws the neutral `dot`.
 */
const P: Record<string, string> = {
  play: '<path d="M8 5.5v13l10.5-6.5z"/>',
  // a cat's head: the hero of the game
  cat: '<path d="M5 11.5V4.5l4.3 3.3h5.4L19 4.5v7c0 4.6-3.1 8-7 8s-7-3.4-7-8z"/><path d="M9.5 12.5h.01M14.5 12.5h.01"/><path d="m11 15.5 1 .8 1-.8"/>',
  map: '<path d="M3.5 6.5 9 4l6 2.5L20.5 4v13.5L15 20l-6-2.5-5.5 2.5z"/><path d="M9 4v13.5M15 6.5V20"/>',
  // a signpost: «Путешествие» (cities and channels)
  signpost: '<path d="M12 21V3.5"/><path d="M5 6h11.5L19 8.25 16.5 10.5H5z"/><path d="M19 12.5H7.5L5 14.75 7.5 17H19z"/>',
  // a folded map with a small cup: the site's mini-map and its rating
  mapcup: '<path d="M10.5 18 8 17l-4.5 2V6.5L8 4.5l6 2.5 4.5-2V10"/><path d="M8 4.5V17"/><path d="M14 13h6.5v1.2a3.25 3.25 0 0 1-6.5 0zM17.25 17.5V20M15.25 20.5h4"/>',
  compass: '<circle cx="12" cy="12" r="8.5"/><path d="m15.5 8.5-2 5-5 2 2-5z"/>',
  flag: '<path d="M5.5 21V4"/><path d="M5.5 4.5h11l-2.5 4 2.5 4h-11"/>',
  home: '<path d="M4 11 12 4.5l8 6.5"/><path d="M6 9.5V19.5h12V9.5"/><path d="M10 19.5v-5h4v5"/>',
  pick: '<path d="M4.5 8.5C8 4.5 14 3.5 19.5 5.5"/><path d="M12.5 5.2 6 19.5"/>',
  mail: '<rect x="3.5" y="5.5" width="17" height="13" rx="2"/><path d="m4 7 8 6 8-6"/>',
  tasks: '<rect x="5" y="4.5" width="14" height="16" rx="2"/><path d="M9 4.5V3h6v1.5"/><path d="m8.5 10 1.5 1.5L13 8.5M8.5 15.5l1.5 1.5 3-3"/><path d="M15 10.5h1M15 16h1"/>',
  radar: '<circle cx="12" cy="12" r="8.5"/><path d="M12 16.8s-3.2-3-3.2-5.3a3.2 3.2 0 0 1 6.4 0c0 2.3-3.2 5.3-3.2 5.3z"/><circle cx="12" cy="11.4" r=".9"/>',
  swords: '<path d="M5 4.5 17 16.5M19 4.5 7 16.5"/><path d="M14.5 19l5-5M9.5 19l-5-5"/>',
  banner: '<path d="M7 3.5h10v16l-5-3.5-5 3.5z"/><path d="m10 9 2-2 2 2-2 2z"/>',
  trophy: '<path d="M8 4.5h8v5a4 4 0 0 1-8 0z"/><path d="M8 6.5H5.5a2.5 2.5 0 0 0 2.6 3.8M16 6.5h2.5a2.5 2.5 0 0 1-2.6 3.8"/><path d="M12 13.5v3.5M8.5 20h7l-1-3h-5z"/>',
  shield: '<path d="M12 3.5 19 6v5.5c0 4.5-3 7.6-7 9-4-1.4-7-4.5-7-9V6z"/><path d="M12 8v8.5M8.5 11h7"/>',
  castle: '<path d="M4 20.5V9h3v2h2V9h2v2h2V9h2v2h2V9h3v11.5z"/><path d="M10 20.5v-4a2 2 0 0 1 4 0v4"/><path d="M12 9V3.5l3 1.2-3 1.2"/>',
  people: '<circle cx="9" cy="8.5" r="3"/><path d="M3.5 19.5a5.5 5.5 0 0 1 11 0"/><circle cx="16.5" cy="9.5" r="2.4"/><path d="M15.5 14.2a4.6 4.6 0 0 1 5 5.3"/>',
  eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>',
  camera: '<path d="M4 8.5h3.5L9 6h6l1.5 2.5H20v10.5H4z"/><circle cx="12" cy="13.5" r="3.4"/>',
  expand: '<path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5"/>',
  // «Настройки»: sliders (lighter than a cog at 22 px)
  gear: '<path d="M4 7h9M17 7h3M4 12h3M11 12h9M4 17h11M19 17h1"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="17" r="2"/>',
  candy: '<circle cx="12" cy="12" r="4"/><path d="M8.5 10 4 7.5v9L8.5 14M15.5 10 20 7.5v9L15.5 14"/>',
  keys: '<rect x="2.5" y="6.5" width="19" height="11" rx="2"/><path d="M6 10h.01M9.5 10h.01M13 10h.01M16.5 10h1.5M6 13.8h.01M9 13.8h6M18 13.8h.01"/>',
  bug: '<rect x="7.5" y="7.5" width="9" height="12" rx="4.5"/><path d="M12 11v8.5M9.5 7.5a2.5 2.5 0 0 1 5 0M7.5 11.5H4M20 11.5h-3.5M7.5 16H4.5M19.5 16h-3M8.5 8 6 5.5M15.5 8 18 5.5"/>',
  spiral: '<path d="M12 12a1.5 1.5 0 1 1 1.5 1.5A3.5 3.5 0 0 1 10 10a4.5 4.5 0 0 1 4.5-4.5A6.5 6.5 0 0 1 21 12a8 8 0 0 1-8 8 8.5 8.5 0 0 1-8.5-8.5"/>',
  window: '<rect x="3" y="4.5" width="18" height="15" rx="2"/><path d="M3 9h18"/><path d="M6 6.8h.01M8.5 6.8h.01"/>',
  update: '<circle cx="12" cy="12" r="8.5"/><path d="M12 16.5v-8M8.5 11.5 12 8l3.5 3.5"/>',
  page: '<path d="M6.5 3.5h7.5L18 7.5v13H6.5z"/><path d="M13.5 3.5v4.5H18M9.5 12h5.5M9.5 15.5h5.5"/>',
  dot: '<circle cx="12" cy="12" r="3.2"/><circle cx="12" cy="12" r="8.5"/>',
};
/** Names of the icons (for `registerPauseItem({ icon })`). */
export const PAUSE_ICON_NAMES = Object.keys(P);
export const hasPauseIcon = (name: string | undefined): boolean => !!name && Object.prototype.hasOwnProperty.call(P, name);
/** Inline SVG of an icon (decorative: aria-hidden; the button carries the label). */
export function pauseIcon(name: string | undefined, size = 22): string {
  const body = hasPauseIcon(name) ? P[name!] : P.dot;
  // one drawn line weight at every size: 2.2 px on screen (stroke-width is in viewBox units)
  const sw = +(52.8 / size).toFixed(2);
  return `<svg class="pi-ic" viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${body}</svg>`;
}
