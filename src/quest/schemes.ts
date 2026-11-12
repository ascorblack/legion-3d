/**
 * Boss mechanic schemes (site 12.11, quest.js): the site draws a scheme card for many boss moves —
 *  - `window.LGQuestSchemes` = { add, has, ids, of(g, M, id), fig } — a registry other scripts may add to (named bosses as
 *    'named:<boss>/<id>'); `of()` answers { arena: { bad, safe, net?, marks, dark? }, legend, cap } (the arena with red /
 *    green platforms), { svg, cap, label } (a picture with a caption) or { html, cap, label } (the chest barrow's field).
 *    bgHtml: the mechanic's scheme `schemeFor(g, M, M.id)`; with no mechanic on the boss's turn the basic move
 *    `schemeFor(g, null, g.bas)` («Ход охотников» for HVB1, else «Ход босса»); the wolf's bite 'HVB2'.
 *    The 3D (src/expedition/adapter.ts) asks the page's registry (AdaptCtx.scheme) — the site's own pure function.
 *  - «Курган-Сундук» (`g.sk`): a fixed field of ten platforms — 1–4 the left bank, 5–8 the right, 10 the bridge, 9 the
 *    lock plate — with a kind per platform per mechanic (SK_SCHEMES HSK1…HSK13, HSKB the bite), a caption, what to do,
 *    the counters (banks paid / keys turned / coins thrown / the word) and my own lines (stuck in gold, coins picked).
 *    The registry only exposes its HTML, so the numbers are ported here (test/site-1112.test.ts runs the site's own
 *    SK_SCHEMES in node:vm against these). Every command in these schemes is TYPED (the field has no buttons).
 */

export type SkKind = 'bad' | 'coin' | 'gold' | 'safe' | 'chest' | 'pull' | 'bank' | 'lock' | 'none';
/** quest.js SK_POS: the field (360 × 182 viewBox), top-left corner of the platform (centre for 9 / 10). */
export const SK_POS: Record<number, [number, number]> = { 1: [18, 40], 2: [70, 40], 3: [18, 96], 4: [70, 96], 5: [246, 40], 6: [298, 40], 7: [246, 96], 8: [298, 96], 10: [180, 68], 9: [180, 132] };
/** quest.js SK_LOOK: fill, stroke, legend text. */
export const SK_LOOK: Record<SkKind, [string, string, string]> = {
  bad: ['#5a1a1a', '#ff5a4a', 'удар'], coin: ['#4a3a10', '#ffd84a', 'монеты + удар'], gold: ['#4a3a10', '#ffd84a', 'монеты + 2 хода в золоте'],
  safe: ['#173a24', '#5ad08a', 'безопасно'], chest: ['#3a2a14', '#d6aa3e', 'сундучок'], pull: ['#4a2010', '#ff8a3a', 'тянет первыми'],
  bank: ['#1c2a3a', '#7ab8ff', ''], lock: ['#3a3010', '#ffd84a', 'плита-замок'], none: ['#1a1418', '#5a4a52', ''],
};
/** Kinds that hurt whoever stands there (the 3D paints them red; coins / gold / pull hurt too). */
export const SK_DANGER: ReadonlySet<SkKind> = new Set<SkKind>(['bad', 'coin', 'gold', 'pull']);
const ALL = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

/** quest.js skMoney: «1 зол. 2 сер. 3 бр.». */
export function skMoney(n: unknown): string {
  const v = Math.max(0, Math.floor(+(n as number) || 0)), g = Math.floor(v / 1e4), s = Math.floor(v / 100) % 100, b = v % 100, o: string[] = [];
  if (g) o.push(g + ' зол.'); if (s) o.push(s + ' сер.'); if (b || !o.length) o.push(b + ' бр.');
  return o.join(' ');
}
const skAll = (kind: SkKind): Record<number, SkKind> => Object.fromEntries(ALL.map((n) => [n, kind]));
const skZ = (zones: unknown, kind: SkKind) => { const z = skAll('safe'); for (const n of Array.isArray(zones) ? zones : []) z[+n] = kind; return z; };

export interface SkBar { label: string; got: number; need: number }
export interface SkScheme {
  /** the mechanic id (HSK…, HSKB for the bite without a mechanic) */
  id: string;
  /** «Схема · <cap>» (the site's title), what to do (`say`) */
  cap: string; say: string;
  z: Record<number, SkKind>;
  /** text on a platform instead of its number (Л / П, «9 🗝», «3?») */
  t: Record<number, string>;
  bars: SkBar[];
}
interface SkM { zones?: unknown; word?: unknown; need?: unknown; got?: unknown; tgn?: unknown }
const bar = (got: number, need: number, label: string): SkBar => ({ label, got, need });
function skKey(sk: any, cap: string, win: string): Omit<SkScheme, 'id'> {
  const z = Object.assign(skAll('bank'), { 9: 'lock' as SkKind }), per = +sk.per || 0;
  return { z, t: { 9: '9 🗝' }, cap, say: `Пиши «ключ»: нужно по ${per} с каждого берега (мост - за оба) и хоть один на плите 9. ${win}`,
    bars: [bar(Math.min(+sk.l || 0, per), per, `Левый берег: ${+sk.l || 0} из ${per}`), bar(Math.min(+sk.r || 0, per), per, `Правый берег: ${+sk.r || 0} из ${per}`), bar(Math.min(+sk.k || 0, 1), 1, `На плите-замке 9: ${+sk.k || 0} из 1`)] };
}
const SK: Record<string, (M: SkM, sk: any) => Omit<SkScheme, 'id'>> = {
  HSKB: (M, sk) => { const b = Array.isArray(sk.bite) ? sk.bite : []; return { z: skZ(b, 'bad'), t: {}, bars: [], cap: 'Укус берега', say: `Сундук кусает берег, где больше отряда: площадк${b.length > 1 ? 'и' : 'а'} ${b.join(' и ')}. Не толпитесь на одном берегу` }; },
  HSK1: (M) => ({ z: skZ(M.zones, 'coin'), t: {}, bars: [], cap: 'Жадность', say: 'Золото - на монетах больно, но переживший удар уносит монеты (20 бронзы - 3 серебра). Уйти - пиши номер зелёной площадки' }),
  HSK5: (M) => ({ z: skZ(M.zones, 'coin'), t: {}, bars: [], cap: 'Золотой плевок', say: 'Монеты-приманка: на них больно, но переживший удар уносит монеты. Уйти - пиши номер зелёной площадки' }),
  HSK7: (M, sk) => ({ z: skZ(M.zones, 'coin'), t: {}, bars: [], cap: `Монетная картечь${sk.side ? ` · ${sk.side === 'L' ? 'левый' : 'правый'} берег` : ''}`, say: 'Три залпа по берегу и середине: больно, но переживший соберёт монеты. Уйти - на другой берег' }),
  HSK9: (M) => ({ z: skZ(M.zones, 'coin'), t: {}, bars: [], cap: 'Золотая лавина', say: 'По мосту и плите катится золото: бьёт сильнее всего (×1,5), но и монет больше (50 бронзы - 5 серебра). Уйти - на любой берег' }),
  HSK2: (M) => ({ z: skZ(M.zones, 'gold'), t: {}, bars: [], cap: 'Золотая жила', say: 'Останешься на жиле - монеты, но 2 раунда статуэткой: не бьёшь и не сходишь с места (под следующие удары). Уйти - пиши номер зелёной площадки' }),
  HSK6: (M) => ({ z: skZ(M.zones, 'gold'), t: {}, bars: [], cap: 'Позолота', say: 'Кто в сиянии - монеты, но 2 раунда статуэткой: не бьёшь и не сходишь с места. Уйти - пиши номер зелёной площадки' }),
  HSK3: (M, sk) => ({ z: skAll('none'), t: {}, bars: [], cap: 'Монетный дождь', say: `Кто ловит (пишет в чат) - получает удар, но и монеты (20-100 бронзы); засчитается не больше ${sk.max || 3} сообщений. Не хочешь рисковать - молчи` }),
  HSK4: (M, sk) => skKey(sk, 'Ключ', 'Провернёте - курган ранен, каждому по 2 серебра'),
  HSK13: (M, sk) => skKey(sk, 'Ключ повёрнут', 'Повернёте - пасть захлопнется навсегда (победа)'),
  HSK8: (M) => ({ z: Object.assign(skAll('none'), { 9: 'pull' as SkKind, 10: 'pull' as SkKind }), t: {}, cap: 'Жадный вдох', say: `Пиши слово с экрана${M.word ? ` «${M.word}»` : ''}. Не удержались - первыми затянет мост 10 и плиту 9`,
    bars: M.need != null ? [bar(+(M.got as number) || 0, +(M.need as number), `Слово: ${+(M.got as number) || 0} из ${M.need}`)] : [] }),
  HSK10: (M, sk) => { const z = skAll('none'), t: Record<number, string> = {}; const zs = Array.isArray(M.zones) ? M.zones : []; for (const n of zs) { z[+n] = 'chest'; t[+n] = n + '?'; }
    return { z, t, bars: [], cap: 'Ложные клады', say: `Сундучков ${sk.ch || zs.length}: один из них мимик (укусит), у остальных - монеты. Какой мимик - смотри на стриме. Не уверен - уходи на пустую площадку` }; },
  HSK11: (M) => { const tg = Array.isArray(M.tgn) ? M.tgn : []; return { z: Object.assign(skAll('none'), { 9: 'lock' as SkKind }), t: {}, cap: 'Котик в пасти',
    say: `Скиньтесь монетами из кошелька: «монета» (50 бронзы) или «монета N» (до 3 серебра). Или «пинок» с плиты-замка 9${tg.length ? ` - спасти ${tg[0]}` : ''}. Монеты сундук не вернёт`,
    bars: M.need != null ? [bar(+(M.got as number) || 0, +(M.need as number), `Собрано ${skMoney(M.got || 0)} из ${skMoney(M.need)}`)] : [] }; },
  HSK12: (M, sk) => ({ z: Object.assign(skAll('bank'), { 9: 'none' as SkKind }), t: { 1: 'Л', 2: 'Л', 3: 'Л', 4: 'Л', 5: 'П', 6: 'П', 7: 'П', 8: 'П', 10: 'Л+П' }, cap: 'Выкуп',
    say: 'Пиши «плачу» со своего берега (мост - за оба). Откупился один берег - укусят другой; никто - оба',
    bars: [bar(+sk.pl || 0, +sk.gl || 0, `Левый берег: ${+sk.pl || 0} из ${+sk.gl || 0}`), bar(+sk.pr || 0, +sk.gr || 0, `Правый берег: ${+sk.pr || 0} из ${+sk.gr || 0}`)] }),
};
export const SK_IDS = Object.keys(SK);

/** quest.js skHtml(g, M): the chest barrow's scheme for this view, or null (no `g.sk`, or a move without a scheme). */
export function skScheme(g: any, M: any): SkScheme | null {
  const sk = g && g.sk && typeof g.sk === 'object' ? g.sk : null; if (!sk) return null;
  const id = M && M.id ? String(M.id) : sk.bite ? 'HSKB' : '', f = SK[id];
  if (!f) return null;
  try { return { id, ...f(M || {}, sk) }; } catch { return null; }
}
/** quest.js skHtml «mine»: stuck in gold for N rounds, the coins I picked up in this fight. */
export function skMine(g: any): string[] {
  const sk = g && g.sk && typeof g.sk === 'object' ? g.sk : null; if (!sk) return [];
  const out: string[] = [];
  if (sk.myStuck) out.push(`Ты в золоте ещё ${sk.myStuck} ${sk.myStuck === 1 ? 'раунд' : 'раунда'} - не бьёшь и не сходишь с места`);
  if (sk.myCoins) out.push(`Ты подобрал за бой: ${skMoney(sk.myCoins)}`);
  return out;
}

/** The page's scheme registry (quest.js window.LGQuestSchemes.of), or undefined — never throws. */
export type SchemeOf = (g: unknown, M: unknown, id: string) => any;
export function pageSchemes(w: any): SchemeOf | undefined {
  const S = w && w.LGQuestSchemes;
  if (!S || typeof S.of !== 'function') return undefined;
  return (g, M, id) => { try { return S.of(g, M, id) || null; } catch { return null; } };
}
