/** Pure helpers over the hero JSON: labels, rarity, comparison, consumables. Mirrors site app.js logic (see GAME-DESIGN §4). */
import type { Hero, Item } from '../contracts';
import type { CoinStyle } from './money';

export const RARITY: Record<string, { name: string; color: string; rank: number }> = {
  common: { name: 'Обычное', color: '#c9ccd6', rank: 0 },
  uncommon: { name: 'Необычное', color: '#4cc95a', rank: 1 },
  rare: { name: 'Редкое', color: '#4aa3ff', rank: 2 },
  epic: { name: 'Эпическое', color: '#b06bff', rank: 3 },
  legendary: { name: 'Легендарное', color: '#ffb83d', rank: 4 },
};
export const rarOf = (r: string | undefined) => RARITY[r || 'common'] || RARITY.common;

export const WEAR_SLOTS = ['weapon', 'armor', 'shield', 'helmet', 'trinket'] as const;
export const SLOT_NAME: Record<string, string> = {
  weapon: 'Оружие', armor: 'Доспех', shield: 'Щит', helmet: 'Шлем', trinket: 'Амулет',
  potion: 'Зелье', food: 'Еда', scroll: 'Свиток', relic: 'Особая вещь', material: 'Материал заточки',
};

const ST_FALLBACK: Record<string, string> = { hp: 'Макс. здоровье', atk: 'Физ. урон', mag: 'Магия', def: 'Броня' };
export const XS_LABEL: Record<string, string> = {
  crit: 'Шанс крита', critDmg: 'Сила крита', dodge: 'Уклонение', pierce: 'Пробивание',
  healPow: 'Сила лечения', luck: 'Удача', resist: 'Сопротивление',
};
export const XS_KEYS = ['crit', 'critDmg', 'dodge', 'pierce', 'healPow', 'luck', 'resist'];
export const XPCT: Record<string, 1> = { crit: 1, critDmg: 1, dodge: 1, pierce: 1, healPow: 1 };
const STW: Record<string, number> = { hp: 0.35, atk: 1, mag: 1, def: 1.2 };
const XSTW: Record<string, number> = { crit: 0.8, critDmg: 0.25, dodge: 0.8, pierce: 0.2, healPow: 0.4, luck: 0.2, resist: 0.6 };

export const ST_HELP: Record<string, string> = {
  hp: 'Сколько урона герой выдержит. На нуле герой падает и становится призраком.',
  atk: 'Сила ударов оружием: «удар», «выстрел». Главное для легионеров и лучников.',
  mag: 'Сила заклинаний («магия») и лечения жреца. Главное для магов и жрецов.',
  def: 'Режет физические удары: когти, клинки, стрелы, камни ловушек.',
  crit: 'Как часто удар (и лечение) получается критическим. Основа — 8%, потолок — 50%.',
  critDmg: 'Во сколько раз критический удар сильнее обычного. Основа — ×1,5, потолок — ×3.',
  dodge: 'Шанс полностью избежать физического удара. Потолок — 35%.',
  pierce: 'Сколько брони врага твои удары не замечают. Потолок — 75%.',
  healPow: 'Насколько сильнее твоё лечение. Потолок — +100%.',
  luck: 'Немного больше монет из добычи и шанс, что вещь окажется на ступень лучше.',
  resist: 'Режет магический урон: заклинания, яд, проклятия, огонь, лёд.',
};

/** Classes → group (for chat name colours). */
export const CLASS_GROUP: Record<string, 'phys' | 'mage' | 'heal' | 'recruit'> = {
  legionary: 'phys', archer: 'phys', rogue: 'phys', paladin: 'phys', mage: 'mage', necromancer: 'mage', priest: 'heal', recruit: 'recruit',
};

/** Access to the site's style parts (MDDoodle) — optional at runtime. */
const W = (): any => (typeof window !== 'undefined' ? window : {});
export function stylePart(name: string): any {
  try { const D = W().MDDoodle; return (D && typeof D.part === 'function' && D.part(name)) || null; } catch { return null; }
}
export function coinStyle(): CoinStyle | null { return stylePart('coins'); }

/** The channel style the site draws in now (MDDoodle.active), or ''. */
export function activeStyle(): string {
  try { const a = W().MDDoodle?.active; return typeof a === 'string' && /^[\w-]{1,30}$/.test(a) ? a : ''; } catch { return ''; }
}
/** HUD badge rules of a style: cat ears (cats), horns (cherts), plain (every other style); '' = unknown (keep the ears). */
export const badgeRules = (style: string): '' | 'cats' | 'cherts' | 'legion' => (!style ? '' : style === 'cats' || style === 'cherts' ? style : 'legion');
/**
 * The hero's class title in the style the site draws in now: the style's own name (MDDoodle.names[style].roles, site
 * doodle.js addNames), else the hero's `roleName` unless it is another loaded style's title (stale after a live style
 * switch: «Кот-колдун» in «Чертики»), else the plain class name.
 */
export function roleTitle(H: Pick<Hero, 'role' | 'roleName'>, names: any = (() => { try { return W().MDDoodle?.names; } catch { return null; } })(), style = activeStyle()): string {
  const role = String(H.role || ''), rn = String(H.roleName || '');
  try {
    const own = names?.[style]?.roles?.[role];
    if (typeof own === 'string' && own.trim()) return own.trim();
    if (rn && names && typeof names === 'object') {
      for (const k of Object.keys(names)) if (k !== style && names[k]?.roles?.[role] === rn) return CLASS_NAME[role] || rn;
    }
  } catch { /* hostile getter */ }
  return rn || CLASS_NAME[role] || '';
}

/** Style stat label without the leading emoji: «Царапки»; fallback «Физ. урон». */
export function stLabel(k: string): string {
  const h = stylePart('hero'); const l = h && h.stats && h.stats[k] && h.stats[k].label;
  const t = l ? String(l).replace(/^[^\p{L}]+/u, '').trim() : '';
  return t || ST_FALLBACK[k] || XS_LABEL[k] || k;
}
export const stOk = (k: string, h: Hero | null) => !XS_LABEL[k] || !!(h && h.xs);
export const num = (v: number) => String(Math.round(v * 10) / 10).replace('.', ',');
export const stNum = (k: string, v: number) => `${v > 0 ? '+' : ''}${num(v)}${XPCT[k] ? '%' : ''}`;

export const equipped = (h: Hero | null, slot: string): Item | null => (h && h.items.find((x) => x.on && x.slot === slot)) || null;

export interface DeltaRow { k: string; v: number; dv: number }
export interface Deltas { c: Item | null; rows: DeltaRow[]; score: number; better: boolean }
/** Comparison vs the equipped item in the same slot (site deltas()). */
export function deltas(it: Item, h: Hero | null, forceCompare = false): Deltas {
  const c = it.wearable && (!it.on || forceCompare) ? equipped(h, String(it.slot)) : null;
  const cc = c && c.uid !== it.uid ? c : null;
  const own = it.stats || {}, cs = (cc && cc.stats) || {};
  const keys = Array.from(new Set([...Object.keys(own), ...Object.keys(cs)])).filter((k) => stOk(k, h));
  const rows = keys.map((k) => ({ k, v: own[k] || 0, dv: cc ? Math.round(((own[k] || 0) - (cs[k] || 0)) * 10) / 10 : 0 }));
  const score = rows.reduce((a, r) => a + r.dv * (STW[r.k] || XSTW[r.k] || 1), 0);
  return { c: cc, rows, score, better: !!it.wearable && !it.on && (cc ? score > 0.01 : rows.some((r) => r.v > 0)) };
}

export function effText(it: Item): string {
  const e = it.effect as any; if (!e) return '';
  const p: string[] = [];
  if (e.heal) p.push(`лечит ${e.heal} здоровья`);
  if (e.revive) p.push('воскрешает павшего героя');
  if (e.buff) p.push(`${stLabel(e.buff.stat).toLowerCase()} +${e.buff.add} на ${e.buff.min || 60} мин`);
  return p.join(', ');
}
export const edible = (it: Item) => (it.slot === 'food' || it.slot === 'potion') && !!it.effect && !(it.effect as any).revive;
export const eatVerb = (it: Item) => (it.slot === 'potion' || it.drink ? 'Выпить' : 'Съесть');
export function useCmd(it: Item): string {
  const k = it.no ? ' ' + it.no : ''; const e = (it.effect || {}) as any;
  if (e.revive) return 'свиток (или свиток @ник)';
  if (it.slot === 'potion' || it.drink) return 'выпить' + k;
  if (it.slot === 'food') return 'съесть' + k;
  return '';
}
export function cdUntil(it: Item, h: Hero | null, now = Date.now()): number {
  if (!h) return 0;
  const eat = +(h.eatUntil as number) || 0, scr = +(h.scrollUntil as number) || 0;
  if ((it.slot === 'food' || it.slot === 'potion') && eat > now) return eat;
  if (it.effect && (it.effect as any).revive && scr > now) return scr;
  return 0;
}
export const mmss = (t: number, now = Date.now()) => { const s = Math.max(0, Math.ceil((t - now) / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

/** Bag category (site catOf). */
export function catOf(it: Item): string {
  if (it.wearable) return String(it.slot);
  if (it.slot === 'material') return 'material';
  if (it.relic || it.slot === 'relic') return 'relic';
  return 'use';
}
export const CAT_NAME: Record<string, string> = { all: 'Всё', ...SLOT_NAME, material: 'Материалы', relic: 'Особое', use: 'Расходники' };
export const CAT_ORDER = ['all', 'weapon', 'armor', 'shield', 'helmet', 'trinket', 'use', 'material', 'relic'];

/** A bag cell: identical non-wearables stack (same id). */
export interface Cell { it: Item; uids: string[]; n: number }
export function bagCells(h: Hero | null): Cell[] {
  if (!h) return [];
  const out: Cell[] = []; const st = new Map<string, Cell>();
  for (const it of h.items) {
    if (it.on) continue;
    if (!it.wearable) {
      const key = it.id + '|' + it.rarity; const c = st.get(key);
      if (c) { c.uids.push(it.uid); c.n++; continue; }
      const nc = { it, uids: [it.uid], n: 1 }; st.set(key, nc); out.push(nc);
    } else out.push({ it, uids: [it.uid], n: 1 });
  }
  return out;
}

export function xpInfo(h: Hero): { xin: number; xneed: number | null; pct: number } {
  let xin: number, xneed: number | null;
  if (h.xpInLevel != null) { xin = +h.xpInLevel; xneed = h.xpToNext == null ? null : +h.xpToNext; }
  else { xin = h.xp - h.prevXp; xneed = h.next - h.prevXp; }
  const pct = xneed == null ? 1 : xneed > 0 ? Math.max(0, Math.min(1, xin / xneed)) : 0;
  return { xin, xneed, pct };
}
export function hpInfo(h: Hero): { now: number; max: number; pct: number } {
  const max = Math.max(1, +h.stats.hp || 1), now = Math.max(0, h.hpNow == null ? max : +h.hpNow);
  return { now, max, pct: Math.max(0, Math.min(1, now / max)) };
}

export function plainCountdown(until: number, now = Date.now()): string {
  let s = Math.max(0, Math.floor((until - now) / 1000));
  const d = Math.floor(s / 86400); s -= d * 86400;
  const hh = Math.floor(s / 3600), mm = Math.floor((s % 3600) / 60), ss = s % 60;
  const p2 = (v: number) => String(v).padStart(2, '0');
  return (d ? d + 'д ' : '') + `${p2(hh)}:${p2(mm)}:${p2(ss)}`;
}

export function timeAgo(ts: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - Number(ts)) / 1000));
  if (!Number.isFinite(s)) return '';
  if (s < 45) return 'только что';
  const m = Math.round(s / 60); if (m < 60) return `${m} мин назад`;
  const h = Math.round(m / 60); if (h < 24) return `${h} ч назад`;
  const d = Math.round(h / 24); if (d === 1) return 'вчера';
  return `${d} дн назад`;
}

export const esc = (s: unknown) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

/** Gear class names (heavy/light/cloth). */
export const GEAR_NAME: Record<string, string> = { heavy: 'тяжёлое (легионер, паладин)', light: 'лёгкое (лучник, разбойник)', cloth: 'ткань (маг, жрец, некромант)' };
export const CLASS_NAME: Record<string, string> = {
  legionary: 'Легионер', archer: 'Лучник', mage: 'Маг', priest: 'Жрец', rogue: 'Разбойник', necromancer: 'Некромант', paladin: 'Паладин', recruit: 'Новобранец',
};
