/**
 * Procedural item icons (inline SVG, 64×64, thick dark outline like the site's doodles). Rarity tints gems/accents.
 * At runtime, if the site's own item art (window.LGInventory.art) is available, `itemArt` prefers it.
 */
import type { Item } from '../contracts';
import { rarOf } from './data';

const O = '#2a2236';             // outline
const SW = 'stroke="' + O + '" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"';
const METAL = '#e3e6f0', METAL2 = '#aab0c4', WOOD = '#b9804c', WOOD2 = '#8a5a32', CLOTH = '#7c5cc4';

type Draw = (acc: string) => string;

const sword: Draw = (a) => `<path d="M44 8 L56 8 L56 20 L28 46 L18 36 Z" fill="${METAL}" ${SW}/><path d="M48 14 L26 38" stroke="${METAL2}" stroke-width="2.5"/>
<path d="M14 32 L32 50" stroke="${O}" stroke-width="9" stroke-linecap="round"/><path d="M14 32 L32 50" stroke="${a}" stroke-width="5" stroke-linecap="round"/>
<path d="M22 42 L10 54" stroke="${O}" stroke-width="8" stroke-linecap="round"/><path d="M22 42 L10 54" stroke="${WOOD}" stroke-width="4" stroke-linecap="round"/><circle cx="9" cy="55" r="4" fill="${a}" ${SW}/>`;
const dagger: Draw = (a) => `<path d="M30 20 Q40 12 50 10 Q48 22 40 32 L34 36 L26 28 Z" fill="${METAL}" ${SW}/><path d="M44 16 L32 30" stroke="${METAL2}" stroke-width="2"/><path d="M20 24 L38 42" stroke="${O}" stroke-width="8" stroke-linecap="round"/><path d="M20 24 L38 42" stroke="${a}" stroke-width="4" stroke-linecap="round"/><path d="M27 37 L16 48" stroke="${O}" stroke-width="9" stroke-linecap="round"/><path d="M27 37 L16 48" stroke="${WOOD}" stroke-width="5" stroke-linecap="round"/><circle cx="13" cy="51" r="5" fill="${a}" ${SW}/>`;
const axe: Draw = (a) => `<path d="M20 52 L44 14" stroke="${O}" stroke-width="8" stroke-linecap="round"/><path d="M20 52 L44 14" stroke="${WOOD}" stroke-width="4" stroke-linecap="round"/><path d="M36 14 Q48 2 58 16 Q50 30 40 26 Z" fill="${METAL}" ${SW}/><circle cx="42" cy="18" r="3" fill="${a}" stroke="${O}" stroke-width="2"/>`;
const mace: Draw = (a) => `<path d="M16 54 L36 26" stroke="${O}" stroke-width="8" stroke-linecap="round"/><path d="M16 54 L36 26" stroke="${WOOD}" stroke-width="4" stroke-linecap="round"/><circle cx="42" cy="18" r="12" fill="${METAL}" ${SW}/><path d="M42 3 L42 7 M57 18 L53 18 M42 33 L42 29 M27 18 L31 18 M52 8 L49 11 M32 8 L35 11 M52 28 L49 25" ${SW}/><circle cx="42" cy="18" r="4" fill="${a}" stroke="${O}" stroke-width="2"/>`;
const spear: Draw = (a) => `<path d="M10 56 L44 22" stroke="${O}" stroke-width="7" stroke-linecap="round"/><path d="M10 56 L44 22" stroke="${WOOD}" stroke-width="3.5" stroke-linecap="round"/><path d="M40 18 L56 6 L48 26 Z" fill="${METAL}" ${SW}/><path d="M38 26 L44 32 L36 30 Z" fill="${a}" ${SW}/>`;
const bow: Draw = (a) => `<path d="M20 6 Q58 32 20 58" fill="none" stroke="${O}" stroke-width="9" stroke-linecap="round"/><path d="M20 6 Q58 32 20 58" fill="none" stroke="${WOOD}" stroke-width="5" stroke-linecap="round"/><path d="M20 6 L20 58" stroke="${O}" stroke-width="2"/><path d="M10 32 L48 32" ${SW}/><path d="M48 32 L42 27 L42 37 Z" fill="${METAL}" ${SW}/><path d="M10 32 L5 28 M10 32 L5 36" stroke="${a}" stroke-width="3" stroke-linecap="round"/><circle cx="37" cy="32" r="3" fill="${a}" stroke="${O}" stroke-width="2"/>`;
const staff: Draw = (a) => `<path d="M14 58 L40 20" stroke="${O}" stroke-width="8" stroke-linecap="round"/><path d="M14 58 L40 20" stroke="${WOOD}" stroke-width="4" stroke-linecap="round"/><path d="M40 20 Q32 6 44 4 Q58 6 52 20 Q46 26 40 20 Z" fill="${WOOD2}" ${SW}/><circle cx="46" cy="13" r="7" fill="${a}" ${SW}/><circle cx="44" cy="11" r="2" fill="#fff" opacity=".8"/>`;
const skullstaff: Draw = (a) => `<path d="M14 58 L38 24" stroke="${O}" stroke-width="8" stroke-linecap="round"/><path d="M14 58 L38 24" stroke="#d8d0c0" stroke-width="4" stroke-linecap="round"/><path d="M32 18 Q32 4 44 4 Q56 4 56 18 Q56 24 50 26 L50 30 L38 30 L38 26 Q32 24 32 18 Z" fill="#f2ead8" ${SW}/><circle cx="40" cy="16" r="3.5" fill="${a}" stroke="${O}" stroke-width="2"/><circle cx="49" cy="16" r="3.5" fill="${a}" stroke="${O}" stroke-width="2"/>`;
const censer: Draw = (a) => `<path d="M32 4 L32 22" ${SW}/><path d="M18 24 L46 24 Q46 46 32 48 Q18 46 18 24 Z" fill="#e0a85a" ${SW}/><path d="M22 32 L42 32" stroke="${O}" stroke-width="2"/><circle cx="32" cy="38" r="4" fill="${a}" stroke="${O}" stroke-width="2"/><path d="M24 56 Q20 50 26 48 M40 56 Q44 50 38 48" stroke="#c8c2d8" stroke-width="3" fill="none" stroke-linecap="round"/>`;
const grimoire: Draw = (a) => `<path d="M10 12 Q10 8 14 8 L50 8 Q54 8 54 12 L54 52 Q54 56 50 56 L14 56 Q10 56 10 52 Z" fill="${CLOTH}" ${SW}/><path d="M18 8 L18 56" stroke="${O}" stroke-width="2.5"/><circle cx="36" cy="30" r="9" fill="${a}" ${SW}/><path d="M36 22 L38 28 L44 30 L38 32 L36 38 L34 32 L28 30 L34 28 Z" fill="#fff" opacity=".85"/>`;
const crook: Draw = (a) => `<path d="M18 58 L30 18" stroke="${O}" stroke-width="8" stroke-linecap="round"/><path d="M18 58 L30 18" stroke="${WOOD}" stroke-width="4" stroke-linecap="round"/><path d="M30 18 Q34 4 46 8 Q54 12 48 20" fill="none" stroke="${O}" stroke-width="8" stroke-linecap="round"/><path d="M30 18 Q34 4 46 8 Q54 12 48 20" fill="none" stroke="${WOOD}" stroke-width="4" stroke-linecap="round"/><ellipse cx="48" cy="26" rx="6" ry="4" fill="#c8c2d8" ${SW}/><circle cx="46" cy="25" r="1.5" fill="${O}"/><path d="M54 27 Q60 30 58 34" stroke="${a}" stroke-width="2.5" fill="none" stroke-linecap="round"/>`;

const scutum: Draw = (a) => `<path d="M14 8 Q32 2 50 8 L50 50 Q32 60 14 50 Z" fill="#c8483c" ${SW}/><path d="M20 14 Q32 10 44 14 L44 46 Q32 52 20 46 Z" fill="none" stroke="#ffd56a" stroke-width="2.5"/><circle cx="32" cy="30" r="7" fill="${a}" ${SW}/>`;
const round: Draw = (a) => `<circle cx="32" cy="32" r="24" fill="${WOOD}" ${SW}/><circle cx="32" cy="32" r="24" fill="none" stroke="${METAL2}" stroke-width="5"/><circle cx="32" cy="32" r="24" fill="none" stroke="${O}" stroke-width="3"/><path d="M32 10 L32 54 M10 32 L54 32" stroke="${WOOD2}" stroke-width="2"/><circle cx="32" cy="32" r="8" fill="${a}" ${SW}/>`;

const lorica: Draw = (a) => `<path d="M18 10 L26 6 Q32 12 38 6 L46 10 L56 18 L50 28 L46 26 L46 54 Q32 58 18 54 L18 26 L14 28 L8 18 Z" fill="${METAL}" ${SW}/><path d="M18 34 Q32 38 46 34 M18 44 Q32 48 46 44" stroke="${METAL2}" stroke-width="2.5" fill="none"/><circle cx="32" cy="22" r="5" fill="${a}" stroke="${O}" stroke-width="2.5"/>`;
const leather: Draw = (a) => `<path d="M18 10 L26 6 Q32 14 38 6 L46 10 L54 20 L48 28 L46 26 L46 54 Q32 58 18 54 L18 26 L16 28 L10 20 Z" fill="#c2884e" ${SW}/><path d="M32 14 L32 54" stroke="${O}" stroke-width="2"/><path d="M28 20 L36 20 M28 28 L36 28 M28 36 L36 36" stroke="${a}" stroke-width="3" stroke-linecap="round"/>`;
const robe: Draw = (a) => `<path d="M24 6 Q32 12 40 6 L48 14 L44 22 L52 58 L12 58 L20 22 L16 14 Z" fill="${CLOTH}" ${SW}/><path d="M24 6 L32 30 L40 6" fill="none" stroke="${O}" stroke-width="2.5"/><path d="M18 50 L46 50" stroke="${a}" stroke-width="4"/><circle cx="32" cy="36" r="3.5" fill="${a}" stroke="${O}" stroke-width="2"/>`;

const helm: Draw = (a) => `<path d="M12 40 Q12 10 32 10 Q52 10 52 40 L52 50 L40 50 L40 36 L24 36 L24 50 L12 50 Z" fill="${METAL}" ${SW}/><path d="M32 10 L32 36" stroke="${METAL2}" stroke-width="3"/><path d="M28 4 Q32 0 36 4 L34 12 L30 12 Z" fill="${a}" ${SW}/>`;
const wizard: Draw = (a) => `<path d="M8 50 Q32 58 56 50 Q50 44 44 44 L36 6 Q34 2 30 6 L20 44 Q12 44 8 50 Z" fill="${CLOTH}" ${SW}/><path d="M20 44 Q32 48 44 44" fill="none" stroke="${a}" stroke-width="4"/><path d="M30 20 L32 26 L38 27 L33 30 L34 36 L30 32 L26 35 L27 29 L23 26 L28 26 Z" fill="#ffe27a" stroke="${O}" stroke-width="1.5"/>`;
const miner: Draw = (a) => `<path d="M10 44 Q10 14 32 14 Q54 14 54 44 Z" fill="#f2c14e" ${SW}/><path d="M6 44 L58 44 L58 50 L6 50 Z" fill="#e0a83a" ${SW}/><rect x="25" y="22" width="14" height="12" rx="4" fill="${METAL2}" ${SW}/><circle cx="32" cy="28" r="4" fill="${a}" stroke="${O}" stroke-width="2"/>`;
const crown: Draw = (a) => `<path d="M8 48 L8 20 L20 32 L32 12 L44 32 L56 20 L56 48 Z" fill="#ffcf4a" ${SW}/><circle cx="32" cy="36" r="5" fill="${a}" stroke="${O}" stroke-width="2.5"/><circle cx="18" cy="40" r="3" fill="#ff6b81" stroke="${O}" stroke-width="2"/><circle cx="46" cy="40" r="3" fill="#4aa3ff" stroke="${O}" stroke-width="2"/>`;
const cap: Draw = (a) => `<path d="M12 42 Q12 16 32 16 Q52 16 52 42 Z" fill="${a}" ${SW}/><path d="M8 42 L60 42 Q60 50 48 50 L8 50 Z" fill="${WOOD2}" ${SW}/><circle cx="32" cy="14" r="5" fill="#fff" ${SW}/>`;

const amulet: Draw = (a) => `<path d="M16 6 Q32 34 48 6" fill="none" stroke="${O}" stroke-width="6" stroke-linecap="round"/><path d="M16 6 Q32 34 48 6" fill="none" stroke="#e8c26a" stroke-width="2.5" stroke-linecap="round"/><path d="M32 26 L46 40 L32 58 L18 40 Z" fill="${a}" ${SW}/><path d="M26 38 L32 32 L36 36" stroke="#fff" stroke-width="2.5" fill="none" opacity=".8" stroke-linecap="round"/>`;
const bell: Draw = (a) => `<path d="M24 8 Q32 2 40 8" fill="none" ${SW}/><path d="M14 44 Q16 14 32 14 Q48 14 50 44 Z" fill="#f2c14e" ${SW}/><path d="M10 44 L54 44 L54 50 L10 50 Z" fill="${a}" ${SW}/><circle cx="32" cy="54" r="5" fill="#e0a83a" ${SW}/><path d="M22 26 Q24 20 30 19" stroke="#fff" stroke-width="3" fill="none" opacity=".7" stroke-linecap="round"/>`;

const potion: Draw = (a) => `<path d="M26 6 L38 6 L38 20 Q52 26 52 40 Q52 58 32 58 Q12 58 12 40 Q12 26 26 20 Z" fill="#eef0ff" ${SW}/><path d="M15 40 Q32 34 49 40 Q49 55 32 55 Q15 55 15 40 Z" fill="${a}"/><path d="M26 6 L38 6 L38 20 Q52 26 52 40 Q52 58 32 58 Q12 58 12 40 Q12 26 26 20 Z" fill="none" ${SW}/><rect x="24" y="2" width="16" height="7" rx="2" fill="${WOOD}" ${SW}/><circle cx="24" cy="44" r="3" fill="#fff" opacity=".7"/>`;
const fish: Draw = (a) => `<path d="M6 32 Q24 10 46 32 Q24 54 6 32 Z" fill="#9fc6e8" ${SW}/><path d="M44 32 L58 20 L58 44 Z" fill="#9fc6e8" ${SW}/><circle cx="16" cy="29" r="3" fill="${O}"/><path d="M26 22 Q30 32 26 42" stroke="${O}" stroke-width="2" fill="none"/><path d="M34 25 Q37 32 34 39" stroke="${a}" stroke-width="2.5" fill="none"/>`;
const cheese: Draw = (a) => `<path d="M6 44 L50 20 L58 30 L58 50 L6 50 Z" fill="#ffd56a" ${SW}/><path d="M6 44 L58 30" stroke="${O}" stroke-width="2.5"/><circle cx="26" cy="46" r="3" fill="#e0a83a"/><circle cx="44" cy="42" r="4" fill="#e0a83a"/><circle cx="48" cy="28" r="2.5" fill="#e0a83a"/><circle cx="38" cy="33" r="2" fill="${a}"/>`;
const apple: Draw = (a) => `<path d="M32 18 Q44 10 52 22 Q58 40 44 54 Q38 58 32 54 Q26 58 20 54 Q6 40 12 22 Q20 10 32 18 Z" fill="#ff6b6b" ${SW}/><path d="M32 18 Q32 8 36 4" ${SW} fill="none"/><path d="M36 10 Q46 4 48 12 Q40 16 36 10 Z" fill="#6fdc7a" stroke="${O}" stroke-width="2"/><circle cx="22" cy="28" r="3" fill="#fff" opacity=".7"/><circle cx="44" cy="44" r="2" fill="${a}"/>`;
const scroll: Draw = (a) => `<path d="M14 12 L46 12 Q54 12 54 20 L54 52 L22 52 Q14 52 14 44 Z" fill="#f6e7c4" ${SW}/><path d="M14 12 Q6 12 6 20 Q6 26 14 26" fill="#e6d2a4" ${SW}/><path d="M22 24 L46 24 M22 32 L46 32 M22 40 L38 40" stroke="${WOOD2}" stroke-width="2.5" stroke-linecap="round"/><circle cx="44" cy="46" r="6" fill="${a}" ${SW}/>`;
const seal: Draw = (a) => `<circle cx="32" cy="32" r="24" fill="${a}" ${SW}/><circle cx="32" cy="32" r="16" fill="none" stroke="${O}" stroke-width="2.5" stroke-dasharray="4 3"/><path d="M32 18 L36 28 L46 30 L38 36 L40 46 L32 40 L24 46 L26 36 L18 30 L28 28 Z" fill="#fff6d0" stroke="${O}" stroke-width="2"/>`;
const star: Draw = (a) => `<path d="M32 4 L40 22 L60 24 L45 37 L50 58 L32 47 L14 58 L19 37 L4 24 L24 22 Z" fill="#ffe27a" ${SW}/><path d="M32 16 L36 26 L46 27" stroke="#fff" stroke-width="2.5" fill="none" opacity=".7" stroke-linecap="round"/><circle cx="32" cy="34" r="4" fill="${a}"/>`;
const sphere: Draw = (a) => `<circle cx="32" cy="32" r="22" fill="${a}" ${SW}/><ellipse cx="32" cy="32" rx="22" ry="8" fill="none" stroke="${O}" stroke-width="2" opacity=".5"/><circle cx="24" cy="24" r="6" fill="#fff" opacity=".6"/>`;
const bag: Draw = (a) => `<path d="M20 18 Q14 12 22 8 L42 8 Q50 12 44 18 Q58 30 54 48 Q50 58 32 58 Q14 58 10 48 Q6 30 20 18 Z" fill="#c2884e" ${SW}/><path d="M20 18 L44 18" stroke="${a}" stroke-width="4"/>`;

const WEAPONS: Record<string, Draw> = {
  sword, gladius: sword, kris: dagger, dagger, axe, club: mace, mace, hammer: mace, holymace: mace,
  spear, pitchfork: spear, bow, staff, crook, skullstaff, censer, grimoire,
};
const SHIELDS: Record<string, Draw> = { scutum, round, buckler: round, barrel: round };
const ARMORS: Record<string, Draw> = { lorica, plate: lorica, leather, robe, shroud: robe,
  hwbarrow: lorica, hwthicket: leather, hwchapel: robe, hwshadow: leather, hwgrave: robe, hwmidnight: lorica };   // Halloween armour (site 31.10)
const HATS: Record<string, Draw> = { wizard, miner, crown, laurel: crown, cap, beret: cap, party: wizard, tophat: helm, legion: helm };

function pick(it: Partial<Item>): Draw {
  const lk = (it.look || {}) as any;
  const slot = String(it.slot || '');
  const id = String(it.id || '');
  if (slot === 'weapon') return WEAPONS[lk.weapon] || (id.includes('bow') ? bow : sword);
  if (slot === 'shield') return SHIELDS[lk.shield] || scutum;
  if (slot === 'armor') return ARMORS[lk.armor] || (String(it.gear) === 'cloth' ? robe : String(it.gear) === 'light' ? leather : lorica);
  if (slot === 'helmet') return HATS[lk.hat] || helm;
  if (slot === 'trinket') return /bell|charm/.test(id) && !/amulet/.test(id) ? bell : amulet;
  if (slot === 'potion') return potion;
  if (slot === 'food') return /cheese/.test(id) ? cheese : /apple|fish/.test(id) ? fish : apple;
  if (slot === 'scroll') return scroll;
  if (slot === 'relic' || it.relic) return seal;
  if (slot === 'material') return (it as any).mat === 'sphere' || /sphere/.test(id) ? sphere : star;
  return bag;
}

/** Our own procedural icon. */
export function iconSvg(it: Partial<Item>, cls = ''): string {
  const acc = rarOf(String(it.rarity || 'common')).color;
  return `<svg class="art ${cls}" viewBox="0 0 64 64" aria-hidden="true">${pick(it)(acc)}</svg>`;
}

/** Silhouette for an empty wear slot. */
export function slotSilhouette(slot: string): string {
  const d = { weapon: sword, armor: lorica, shield: scutum, helmet: helm, trinket: amulet }[slot] || bag;
  return `<svg class="art sil" viewBox="0 0 64 64" aria-hidden="true">${d('#ffffff')}</svg>`;
}

let siteArtBroken = false;
/** Prefer the site's item art when present at runtime (window.LGInventory.art), else procedural. */
export function itemArt(it: Item): string {
  const inv = (typeof window !== 'undefined' ? (window as any).LGInventory : null);
  if (!siteArtBroken && inv && typeof inv.art === 'function') {
    try { const s = inv.art(it); if (s && typeof s === 'string') return s; } catch { siteArtBroken = true; }
  }
  return iconSvg(it);
}

/* ---------------------------------------------------------------- stat + misc icons (24×24) */
const S2 = 'stroke="' + O + '" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round"';
const STAT: Record<string, string> = {
  hp: `<path d="M12 21 Q3 14 3 8.5 Q3 4 7.5 4 Q10.5 4 12 7 Q13.5 4 16.5 4 Q21 4 21 8.5 Q21 14 12 21 Z" fill="#ff6b81" ${S2}/><circle cx="8" cy="8.5" r="1.6" fill="#fff" opacity=".7"/>`,
  atk: `<ellipse cx="12" cy="15.5" rx="5" ry="4.2" fill="#ffb3c0" ${S2}/><circle cx="5.5" cy="10" r="2.3" fill="#ffb3c0" ${S2}/><circle cx="9.5" cy="6" r="2.3" fill="#ffb3c0" ${S2}/><circle cx="14.5" cy="6" r="2.3" fill="#ffb3c0" ${S2}/><circle cx="18.5" cy="10" r="2.3" fill="#ffb3c0" ${S2}/>`,
  mag: `<path d="M12 2 L14.2 9.8 L22 12 L14.2 14.2 L12 22 L9.8 14.2 L2 12 L9.8 9.8 Z" fill="#b9a0ff" ${S2}/><circle cx="19" cy="5" r="1.6" fill="#ffe27a" ${S2}/>`,
  def: `<circle cx="12" cy="12" r="8.5" fill="#7fc0ff" ${S2}/><path d="M5 9 Q12 13 19 9 M4 13.5 Q12 17 20 13.5 M9 4.5 Q14 12 11 20.5" fill="none" stroke="${O}" stroke-width="1.4"/><path d="M19 17 Q22 20 20 22" fill="none" ${S2}/>`,
  crit: `<path d="M13 2 L5 13 L11 13 L9 22 L19 9 L13 9 Z" fill="#ffd56a" ${S2}/>`,
  critDmg: `<path d="M4 20 L20 4 M15 4 L20 4 L20 9" fill="none" stroke="${O}" stroke-width="4" stroke-linecap="round"/><path d="M4 20 L20 4 M15 4 L20 4 L20 9" fill="none" stroke="#ff9f6a" stroke-width="2" stroke-linecap="round"/>`,
  dodge: `<path d="M3 8 Q12 3 21 8 M3 13 Q12 8 21 13 M3 18 Q12 13 21 18" fill="none" stroke="${O}" stroke-width="3.6" stroke-linecap="round"/><path d="M3 8 Q12 3 21 8 M3 13 Q12 8 21 13 M3 18 Q12 13 21 18" fill="none" stroke="#9fe0ff" stroke-width="1.8" stroke-linecap="round"/>`,
  pierce: `<path d="M3 21 L17 7" stroke="${O}" stroke-width="3.6" stroke-linecap="round"/><path d="M3 21 L17 7" stroke="#e3e6f0" stroke-width="1.8" stroke-linecap="round"/><path d="M14 4 L21 3 L20 10 Z" fill="#e3e6f0" ${S2}/>`,
  healPow: `<path d="M9 3 L15 3 L15 9 L21 9 L21 15 L15 15 L15 21 L9 21 L9 15 L3 15 L3 9 L9 9 Z" fill="#8fe39a" ${S2}/>`,
  luck: `<circle cx="8" cy="8" r="4.2" fill="#6fdc7a" ${S2}/><circle cx="16" cy="8" r="4.2" fill="#6fdc7a" ${S2}/><circle cx="8" cy="16" r="4.2" fill="#6fdc7a" ${S2}/><circle cx="16" cy="16" r="4.2" fill="#6fdc7a" ${S2}/><path d="M12 12 L18 22" ${S2}/>`,
  resist: `<path d="M12 2 L20 5 L20 12 Q20 18 12 22 Q4 18 4 12 L4 5 Z" fill="#c59bff" ${S2}/><path d="M12 7 L12 17 M8 12 L16 12" stroke="#fff" stroke-width="1.8" stroke-linecap="round" opacity=".85"/>`,
  lock: `<rect x="5" y="10" width="14" height="11" rx="3" fill="#ffd56a" ${S2}/><path d="M8 10 V7 Q8 3 12 3 Q16 3 16 7 V10" fill="none" ${S2}/>`,
  ghost: `<path d="M5 21 V10 Q5 3 12 3 Q19 3 19 10 V21 L16.5 19 L14 21 L12 19 L10 21 L7.5 19 Z" fill="#e9e4f4" ${S2}/><circle cx="9.5" cy="10" r="1.4" fill="${O}"/><circle cx="14.5" cy="10" r="1.4" fill="${O}"/>`,
  people: `<circle cx="8" cy="8" r="3.4" fill="#ffd7a8" ${S2}/><circle cx="16.5" cy="9" r="3" fill="#c9b6c2" ${S2}/><path d="M2 20 Q2 13 8 13 Q14 13 14 20 Z" fill="#ffd7a8" ${S2}/><path d="M13 20 Q13.5 14 16.5 14 Q22 14 22 20 Z" fill="#c9b6c2" ${S2}/>`,
  coin: `<circle cx="12" cy="12" r="9" fill="#f2c14e" ${S2}/><circle cx="12" cy="12" r="5.5" fill="none" stroke="#b8862a" stroke-width="1.6"/>`,
};
export function statIcon(k: string, cls = 'si'): string {
  return `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true">${STAT[k] || STAT.coin}</svg>`;
}
