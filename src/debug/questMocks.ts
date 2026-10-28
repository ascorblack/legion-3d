/**
 * Expedition scene mocks for the debug panel («Сцены похода»): one fixed SSE `q` view per scene kind, so every 3D
 * expedition scene (src/expedition) can be looked at without a running «поход». A port of the community userscript
 * «Quest Mock & Debug 3.1» (its 25 builders), rewritten to the shapes our model reads (src/quest/model.ts — e.g. vote
 * options are [n, label, '', votes]), with demo cat names only, plus what the userscript did not have: boss mechanics
 * (silence, feint, platforms, words, adds), the dungeon crossroads, every map-puzzle kind and the Halloween scenes.
 *
 * Pure: (login, role, now) in, payload out. The views go ONLY into the debug panel's own ExpeditionView — never to the
 * site's LGQuest, the bus or the server (src/debug/scenes.ts). test/debug-mocks.test.ts adapts every one of them.
 */
import type { QuestPayload, FormEntry, FoeEntry, Side, QuestBossGen, BossMech } from '../quest/model';
import type { SceneKind } from '../expedition/adapter';

export type MockGroup = 'battle' | 'map' | 'trap' | 'event' | 'boss' | 'puzzle' | 'holiday';
export const MOCK_GROUPS: { id: MockGroup; title: string; icon: string }[] = [
  { id: 'battle', title: 'Бой', icon: '⚔️' },
  { id: 'map', title: 'Карта и сбор', icon: '🗺️' },
  { id: 'trap', title: 'Ловушки', icon: '🪤' },
  { id: 'event', title: 'События и лавка', icon: '🎲' },
  { id: 'boss', title: 'Босс', icon: '🐲' },
  { id: 'puzzle', title: 'Головоломки', icon: '🧩' },
  { id: 'holiday', title: 'Праздничное', icon: '🎃' },
];

export interface MockOpts { login: string; role: string; now: number }
export interface QuestMock {
  id: string; group: MockGroup; title: string; icon: string;
  /** The scene kind the adapter must make of it (test/debug-mocks.test.ts). */
  expect: SceneKind;
  build(o: MockOpts): QuestPayload;
}

/* ------------------------------------------------------------------ the demo party */

const CATS: [string, string, string][] = [
  ['demo_barsik', 'Барсик', 'legionary'], ['demo_pushok', 'Пушок', 'paladin'], ['demo_ugolek', 'Уголёк', 'legionary'],
  ['demo_ryzhik', 'Рыжик', 'rogue'], ['demo_snezhok', 'Снежок', 'archer'], ['demo_iriska', 'Ириска', 'mage'],
  ['demo_persik', 'Персик', 'necromancer'], ['demo_tuchka', 'Тучка', 'priest'], ['demo_zefir', 'Зефир', 'archer'],
  ['demo_kotleta', 'Котлета', 'recruit'], ['demo_businka', 'Бусинка', 'priest'],
];
const MY_IDX = 4;

function base(o: MockOpts, extra: Partial<QuestPayload>): QuestPayload {
  return { on: true, k: 'map', t: '', ter: '', dl: 0, at: o.now, now: o.now, n: 12, party: 'in', late: [], cm: false, ...extra };
}
function form(o: MockOpts, fronts: Side[]): FormEntry[] {
  const p = CATS.slice(); p.splice(MY_IDX, 0, [o.login, 'Ты', o.role]);
  return p.map(([l, , r], i) => [l, r, fronts.length > 1 ? fronts[i % fronts.length] : fronts[0] || '', null, r === 'legionary' || r === 'paladin', i % 3]);
}
const low = (): [string, string, number][] => [['demo_pushok', 'Пушок', 0.34], ['demo_tuchka', 'Тучка', 0.61]];

interface BattleIn { st?: string; fronts?: Side[]; foes: FoeEntry[]; title?: string; ter?: string; extra?: Record<string, unknown>; round?: number }
function battle(o: MockOpts, b: BattleIn): QuestPayload {
  const fr = b.fronts || ['R'];
  const f = form(o, fr);
  return base(o, {
    k: 'battle', t: b.title || 'Бой', ter: b.ter || 'Лесная опушка', n: f.length,
    b: {
      id: 'mock-battle', st: (b.st || 'party') as never, title: b.title || 'Бой', round: b.round ?? 2, maxR: 6, until: o.now + 28_000,
      me: MY_IDX, hp: 0.78, form: f, fighters: f.length, foes: b.foes, cr: { fr: fr.slice(), cam: 1 },
      low: low(), sk: [['град', 0, ''], ['прицел', 1, '']], fd: ['⚔ Бой начался', '🗡 Отряд бьёт: раунд 1'], ...(b.extra || {}),
    },
  });
}
const wolves = (): FoeEntry[] => [['R', 'wolf', true, 0.72, 'Вожак стаи'], ['R', 'wolf', false, 0.4, 'Волк'], ['R', 'wolf', false, 1, 'Волк']];
const skeletons = (): FoeEntry[] => [['R', 'skeleton', true, 0.72, 'Скелет-воин'], ['R', 'skeleton', false, 0.4, 'Скелет']];

function trap(o: MockOpts, type: string, extra: Record<string, unknown> = {}): QuestPayload {
  const tre = type === 'treasure';
  const tr: Record<string, unknown> = { name: 'Ловушка', icon: '⚠', st: 'act', until: o.now + 25_000, intro: 'Опасность!', how: 'Действуй', acted: false, actedN: 3, total: 12, type, tre: false };
  switch (type) {
    case 'react': Object.assign(tr, { name: 'Руны на стене', intro: 'На стене вспыхивают руны', how: 'Напечатай слово', word: 'спарта' }); break;
    case 'gas': Object.assign(tr, { name: 'Ядовитый газ', intro: 'Газ заполняет коридор…', how: 'Не пиши в чат', gas: true }); break;
    case 'ceiling': Object.assign(tr, { name: 'Падающий потолок', intro: 'Потолок рушится!', how: 'Пиши «держу»' }); break;
    case 'ropes': Object.assign(tr, { name: 'Верёвки над ямой', intro: 'Над ямой висят верёвки', how: 'Перережь верёвку', n: 4 }); break;
    case 'bait': Object.assign(tr, { name: 'Подозрительный сундук', intro: 'Сундук стоит посреди зала', how: 'Взять или пройти', taker: null }); break;
    case 'greed': Object.assign(tr, { name: 'Гора золота', intro: 'Золото блестит в темноте', how: 'Хватай и беги' }); break;
    case 'share': Object.assign(tr, { name: 'Мешок монет', intro: 'Нашли мешок монет', how: 'Поровну или себе?' }); break;
    case 'code': Object.assign(tr, { name: 'Дверь с рунами', intro: 'Дверь требует код', how: 'Введи цифры', len: 3, max: 6, best: [['132', 'gyr', 'Ириска']] }); break;
    case 'plates': Object.assign(tr, { name: 'Плиты на полу', intro: 'Плиты щёлкают под ногами', how: 'Путь — цифры по порядку' }); break;
    case 'treasure': Object.assign(tr, { name: 'Сокровищница', icon: '💎', tre: true, type: 'code', intro: 'Сундук с сокровищами', how: 'Подбери код', len: 3, max: 6, best: [] }); break;
  }
  Object.assign(tr, extra);
  return base(o, { k: tre ? 'treasure' : 'trap', t: String(tr.name), ter: 'Подземелье', n: 12, tr: tr as never });
}

function event(o: MockOpts, look: string): QuestPayload {
  const ev: Record<string, unknown> = { name: 'Событие', look, st: 'on', until: o.now + 40_000, used: 0, cmds: [] };
  if (look === 'traveler') Object.assign(ev, { name: 'Путник в беде', st: 'vote', votes: { help: 4, rob: 2 } });
  else if (look === 'dice') Object.assign(ev, { name: 'Кости с бродягой', cmds: [['ставка 20', 'играть на 20 монет']], purse: 120, gm: [[5, 3, 'win', 1]] });
  else if (look === 'well') Object.assign(ev, { name: 'Колодец желаний', cmds: [['монетка', 'бросить монету']], thrown: 3, need: 10 });
  else if (look === 'priest') Object.assign(ev, { name: 'Странствующий жрец', cmds: [['лечение', 'за 50 монет'], ['благословение', 'за 80 монет']], prices: { heal: 50, bless: 80, cleanse: 100, revive: 200 }, done: {}, cursed: true, ghosts: [['demo_kotleta', 'Котлета']] });
  return base(o, { k: 'event', t: String(ev.name), ter: look === 'well' ? 'Река' : 'Курган', n: 14, ev: ev as never });
}

function puzzle(o: MockOpts, pz: Record<string, unknown>): QuestPayload {
  return base(o, { k: 'puzzle', t: String(pz.name), ter: 'Курган', pz: { id: 1, st: 'answer', until: o.now + 30_000, an: 3, prize: 'coins', coins: 15, ...pz } as never });
}

const ZONES: QuestBossGen['zn'] = { a: [
  [1, [2, 3], [[300, 820], [560, 800], [600, 900], [320, 930]]], [2, [1, 4], [[640, 790], [900, 780], [940, 880], [660, 900]]],
  [3, [1, 4], [[420, 940], [700, 930], [720, 1030], [400, 1040]]], [4, [2, 3], [[760, 920], [1020, 910], [1050, 1010], [780, 1030]]]], gone: [] };

function boss(o: MockOpts, mech: BossMech | null, extra: Partial<QuestBossGen> = {}, st = 'party'): QuestPayload {
  const f = form(o, ['R']);
  const bg: QuestBossGen = { name: 'Гнилозуб', title: 'Повелитель трясины', danger: 2, ph: 1, phs: 2, hp: 0.64, adds: [], st, acted: false, in: true, my: 0.8,
    limit: 8, round: 3, rage: false, zn: ZONES, area: 1, mech: mech ? { until: o.now + 12_000, ...mech } : null, ...extra };
  return base(o, {
    k: 'bossgen', t: 'Логово Гнилозуба', ter: 'Курган', dg: 'Опасно: при гибели теряется часть монет', n: f.length, bg,
    b: { id: 'boss1', title: 'Гнилозуб', round: 3, maxR: 8, st: (st === 'party' ? 'party' : st === 'trans' ? 'trans' : 'mech') as never, until: o.now + 12_000, hp: 0.8, me: MY_IDX,
      form: f, fighters: f.length, foes: [], gb: { name: bg.name, title: bg.title, phase: bg.ph, phases: 2, hp: bg.hp, ...(mech ? { mech: { icon: mech.icon, name: mech.name, text: mech.text } } : {}) } },
  });
}

/* ------------------------------------------------------------------ the list */

export const QUEST_MOCKS: QuestMock[] = [
  // Бой
  { id: 'battle', group: 'battle', title: 'Бой: ход отряда', icon: '⚔️', expect: 'battle', build: (o) => battle(o, { foes: skeletons(), title: 'Скелет-воин', ter: 'Пещера' }) },
  { id: 'battle-tele', group: 'battle', title: 'Бой: слово защиты', icon: '🛡️', expect: 'battle',
    build: (o) => battle(o, { st: 'tele', foes: wolves(), title: 'Стая волков', extra: { tele: { word: 'щит', text: 'Вожак готовит бросок!', ok: false, got: 2, need: 5 }, until: o.now + 15_000 } }) },
  { id: 'battle-hit', group: 'battle', title: 'Бой: удары', icon: '💥', expect: 'battle',
    build: (o) => battle(o, { st: 'hit', foes: wolves(), title: 'Стая волков', extra: { mine: { k: 'party', r: 2, me: { n: 1, d: 17, e: 'Вожак стаи', k: 'ranged', c: true } } } }) },
  { id: 'battle-two', group: 'battle', title: 'Бой: окружили', icon: '🌀', expect: 'battle',
    build: (o) => battle(o, { fronts: ['L', 'R'], foes: [['L', 'bandit', true, 0.9, 'Атаман'], ['L', 'bandit', false, 1, 'Разбойник'], ['R', 'boar', false, 0.5, 'Кабан'], ['R', 'spider', false, 1, 'Паук']], title: 'Засада', ter: 'Ущелье' }) },
  { id: 'battle-end', group: 'battle', title: 'Бой: победа', icon: '🏆', expect: 'battle',
    build: (o) => battle(o, { st: 'end', foes: [['R', 'drowner', true, 0, 'Утопец'], ['R', 'slime', false, 0, 'Слизень']], title: 'Утопцы', ter: 'Река', extra: { res: { how: 'win', xp: 60, coins: 140 } } }) },
  // Карта и сбор
  { id: 'gather', group: 'map', title: 'Сбор отряда', icon: '🏕️', expect: 'gather', build: (o) => base(o, { k: 'gather', t: 'Сбор у ворот', n: 6, party: 'q', cm: true, gather: { until: o.now + 60_000 } }) },
  { id: 'map', group: 'map', title: 'Карта: в очереди', icon: '🗺️', expect: 'travel', build: (o) => base(o, { k: 'map', ter: 'Ярмарочный Край', dl: 4, n: 50, party: 'q' }) },
  { id: 'map-vote', group: 'map', title: 'Перекрёсток: голосование', icon: '🧭', expect: 'vote',
    build: (o) => base(o, { k: 'map', t: 'Перекрёсток', ter: 'Развилка', n: 18, vote: { id: 9001, title: 'Куда идём?', end: o.now + 45_000, done: false, opts: [[1, 'Северная тропа', '', 4], [2, 'Пещера', '', 2], [3, 'К реке', '', 5]] } }) },
  { id: 'travel', group: 'map', title: 'В пути', icon: '🥾', expect: 'travel', build: (o) => base(o, { k: 'travel', t: 'В пути', ter: 'Лес', n: 10 }) },
  { id: 'rest', group: 'map', title: 'Привал', icon: '🔥', expect: 'rest', build: (o) => base(o, { k: 'rest', t: 'Привал', ter: 'Поляна', n: 10, cm: true }) },
  { id: 'town', group: 'map', title: 'Город округа', icon: '🏘️', expect: 'town', build: (o) => base(o, { k: 'town', t: 'Ярмарочный посад', ter: 'Округ', n: 10, town: { id: 't1', name: 'Ярмарочный посад' } }) },
  { id: 'dungeon', group: 'map', title: 'Данж: куда идти', icon: '🏚️', expect: 'dungeon',
    build: (o) => base(o, { k: 'dungeon', t: 'Склеп', ter: 'Данж', dgn: { name: 'Склеп', vote: { id: 5, title: 'Куда?', end: o.now + 30_000, opts: [[1, 'w', 'Левый проход', '⬅', 4], [2, 'n', 'Прямо', '⬆', 7], [3, 'e', 'Лестница вниз', '⬇', 1]] } } }) },
  { id: 'loot', group: 'map', title: 'Делёж добычи', icon: '💰', expect: 'loot', build: (o) => base(o, { k: 'map', t: 'Делёж', n: 10, loot: { name: 'Клык барса', until: o.now + 30_000, n: 4, my: false } }) },
  // Ловушки
  { id: 'trap-word', group: 'trap', title: 'Руны: успей написать', icon: '🔤', expect: 'trap', build: (o) => trap(o, 'react') },
  { id: 'trap-gas', group: 'trap', title: 'Ядовитый газ', icon: '☁️', expect: 'trap', build: (o) => trap(o, 'gas') },
  { id: 'trap-ceiling', group: 'trap', title: 'Падающий потолок', icon: '🧱', expect: 'trap', build: (o) => trap(o, 'ceiling') },
  { id: 'trap-ropes', group: 'trap', title: 'Верёвки над ямой', icon: '🪢', expect: 'trap', build: (o) => trap(o, 'ropes') },
  { id: 'trap-bait', group: 'trap', title: 'Сундук-приманка', icon: '🎁', expect: 'trap', build: (o) => trap(o, 'bait') },
  { id: 'trap-greed', group: 'trap', title: 'Жадность', icon: '🪙', expect: 'trap', build: (o) => trap(o, 'greed') },
  { id: 'trap-share', group: 'trap', title: 'Мешок монет', icon: '👝', expect: 'trap', build: (o) => trap(o, 'share') },
  { id: 'trap-code', group: 'trap', title: 'Кодовый замок', icon: '🔐', expect: 'trap', build: (o) => trap(o, 'code') },
  { id: 'trap-plates', group: 'trap', title: 'Плиты на полу', icon: '🔢', expect: 'trap', build: (o) => trap(o, 'plates') },
  { id: 'treasure', group: 'trap', title: 'Сокровищница', icon: '💎', expect: 'treasure', build: (o) => trap(o, 'treasure') },
  { id: 'trap-result', group: 'trap', title: 'Ловушка: итог', icon: '✅', expect: 'trap',
    build: (o) => trap(o, 'react', { st: 'wait', res: { win: true, text: 'Отряд прошёл дальше', me: { st: 'ok', dmg: 4, gain: 12, xp: 6, it: ['Осколок руны'] }, sv: false } }) },
  // События и лавка
  { id: 'ev-traveler', group: 'event', title: 'Путник в беде', icon: '🧳', expect: 'event', build: (o) => event(o, 'traveler') },
  { id: 'ev-dice', group: 'event', title: 'Кости', icon: '🎲', expect: 'event', build: (o) => event(o, 'dice') },
  { id: 'ev-well', group: 'event', title: 'Колодец желаний', icon: '⛲', expect: 'event', build: (o) => event(o, 'well') },
  { id: 'ev-priest', group: 'event', title: 'Жрец у алтаря', icon: '⛪', expect: 'event', build: (o) => event(o, 'priest') },
  { id: 'shop', group: 'event', title: 'Лавка бродяги', icon: '🛒', expect: 'shop',
    build: (o) => base(o, { k: 'shop', t: 'Лавка бродяги', ter: 'Брод', n: 8, sh: { name: 'Лавка бродяги', icon: '🛒', items: [
      { id: 'a', name: 'Зелье здоровья', rarity: 'common', price: 30, qty: 3, slot: 'potion' }, { id: 'b', name: 'Меч рыцаря', rarity: 'rare', price: 420, qty: 1, slot: 'weapon' },
      { id: 'c', name: 'Круглый щит', rarity: 'uncommon', price: 160, qty: 1, slot: 'shield' }, { id: 'd', name: 'Пирог', rarity: 'common', price: 12, qty: 5, slot: 'food' },
      { id: 'e', name: 'Шляпа мага', rarity: 'epic', price: 900, qty: 1, slot: 'helmet' }, { id: 'f', name: 'Амулет', rarity: 'legendary', price: 2500, qty: 1, slot: 'relic' }] } }) },
  // Босс
  { id: 'boss', group: 'boss', title: 'Босс: ход отряда', icon: '🐲', expect: 'boss', build: (o) => boss(o, null) },
  { id: 'boss-silence', group: 'boss', title: 'Босс: тишина', icon: '🤫', expect: 'boss', build: (o) => boss(o, { name: 'Рёв трясины', icon: '🤫', fam: 'silence', text: 'Кто напишет — получит удар', silence: true } as BossMech, {}, 'boss') },
  { id: 'boss-feint', group: 'boss', title: 'Босс: финт', icon: '🎭', expect: 'boss', build: (o) => boss(o, { name: 'Обманный замах', icon: '🎭', fake: true, text: 'Не поддавайся!' }, {}, 'boss') },
  { id: 'boss-zones', group: 'boss', title: 'Босс: площадки', icon: '🟫', expect: 'boss', build: (o) => boss(o, { name: 'Обвал', icon: '🪨', fam: 'position', zones: [2], text: 'Площадка 3 рушится' }, { zn: { ...ZONES!, gone: [3] } }, 'boss') },
  { id: 'boss-words', group: 'boss', title: 'Босс: слова', icon: '📜', expect: 'boss', build: (o) => boss(o, { name: 'Заклятье', icon: '📜', words: ['свет', 'огонь', 'щит'], need: 8, got: 3, text: 'Перебей заклятье словами' }, {}, 'boss') },
  { id: 'boss-adds', group: 'boss', title: 'Босс: прислужники, ярость', icon: '🐸', expect: 'boss', build: (o) => boss(o, null, { ph: 2, hp: 0.3, rage: true, adds: [['Пиявка', 3, 0.6]] }) },
  { id: 'lair', group: 'boss', title: 'Логово: острова', icon: '🏝️', expect: 'lair', build: (o) => base(o, { k: 'lair', t: 'Логово', n: 20, lair: { hp: 0.8, is: { pick: { until: o.now + 30_000, my: 2, cnt: [3, 4, 2, 3] }, gone: [4] } } }) },
  // Головоломки
  { id: 'pz-runes', group: 'puzzle', title: 'Рунный камень', icon: '🪨', expect: 'puzzle', build: (o) => puzzle(o, { kind: 'runes', name: 'Рунный камень', icon: '🪨', how: 'Напиши число', rows: [['R', '+', 'R', '=', '8'], ['R', '+', 'T', '=', '7'], ['T', '×', 'R', '=', '?']] }) },
  { id: 'pz-cups', group: 'puzzle', title: 'Три кубка', icon: '🍷', expect: 'puzzle', build: (o) => puzzle(o, { kind: 'cups', name: 'Три кубка', icon: '🍷', how: 'Выбери кубок без яда', signs: ['Яд не здесь', 'Яд в первом', 'Яд не во втором'], bt: [['Кубок 1', '1'], ['Кубок 2', '2'], ['Кубок 3', '3']], prize: 'buff' }) },
  { id: 'pz-scales', group: 'puzzle', title: 'Весы', icon: '⚖️', expect: 'puzzle', build: (o) => puzzle(o, { kind: 'scales', name: 'Старые весы', icon: '⚖', how: 'Встань на плиту: лево или право', sums: [3, 7, 4, 6], rt: 'тяжелее', bt: [['Левая', 'лево'], ['Правая', 'право']] }) },
  { id: 'pz-riddle', group: 'puzzle', title: 'Загадка сфинкса', icon: '❓', expect: 'puzzle', build: (o) => puzzle(o, { kind: 'riddle', name: 'Загадка сфинкса', icon: '❓', how: 'Ответ одним словом в чат', q: 'Без окон, без дверей — полна горница людей' }) },
  { id: 'pz-count', group: 'puzzle', title: 'Посчитай зверьков', icon: '🐭', expect: 'puzzle', build: (o) => puzzle(o, { kind: 'count', name: 'Мышиная поляна', icon: '🐭', st: 'show', showUntil: o.now + 10_000, q: 'Сколько мышек пробежало?', how: 'Напиши число' }) },
  { id: 'pz-changed', group: 'puzzle', title: 'Что изменилось', icon: '🔍', expect: 'puzzle', build: (o) => puzzle(o, { kind: 'changed', name: 'Полка со всякой всячиной', icon: '🔍', items: 6, how: 'Номер предмета', bt: [['1', '1'], ['2', '2'], ['3', '3'], ['4', '4']] }) },
  { id: 'pz-letter', group: 'puzzle', title: 'Слова на букву', icon: '🔠', expect: 'puzzle', build: (o) => puzzle(o, { kind: 'letter', name: 'Слова на букву', icon: '🔠', letter: 'К', got: 3, goal: 10, words: ['кот', 'кит', 'кекс'], how: 'Слово на «К»' }) },
  { id: 'pz-done', group: 'puzzle', title: 'Головоломка: итог', icon: '🎉', expect: 'puzzle', build: (o) => puzzle(o, { kind: 'riddle', name: 'Загадка сфинкса', icon: '❓', st: 'done', q: 'Без окон, без дверей — полна горница людей', res: { text: 'Отгадали: огурец', ok: true, ans: 'огурец' }, my: 'ok:coins:|a:огурец' }) },

  // Exact public Halloween/event envelopes from quest.js hwEvHtml and gobHtml (read-only display).
  { id: 'hw-trick', group: 'holiday', title: 'Сладость или гадость', icon: '🎃', expect: 'event', build: o => base(o, { k: 'event', ter: 'Изнанка', ev: { id: 1028, hw: true, look: 'trick', name: 'Сладость или гадость', st: 'vote', until: o.now + 45000, intro: 'Джек предлагает выбрать', how: 'Напиши сладость или гадость', vt: { sweet: 4, trick: 3 }, bt: [['Сладость', 'сладость'], ['Гадость', 'гадость']] } }) },
  { id: 'hw-fortune', group: 'holiday', title: 'Гадалка Джека', icon: '🎃', expect: 'event', build: o => base(o, { k: 'event', ter: 'Изнанка', ev: { id: 1028, hw: true, look: 'fortune', name: 'Гадалка Джека', st: 'on', until: o.now + 45000, intro: 'Загляни в шатёр', price: 120, bn: 3, how: 'Напиши гадание', bt: [['Гадать', 'гадание']] } }) },
  { id: 'hw-cauldron', group: 'holiday', title: 'Ведьмин котёл', icon: '🎃', expect: 'event', build: o => base(o, { k: 'event', ter: 'Изнанка', ev: { id: 1028, hw: true, look: 'cauldron', name: 'Ведьмин котёл', st: 'ingr', until: o.now + 45000, intro: 'Ведьма ждёт ингредиенты', price: 2500, pool: 2500, picked: ['pumpkin'], ing: { pumpkin: 3 }, how: 'Напиши ингредиент', bt: [['Мухомор', 'мухомор'], ['Тыква', 'тыква']] } }) },
  { id: 'hw-lostghost', group: 'holiday', title: 'Загадка призрака', icon: '🎃', expect: 'event', build: o => base(o, { k: 'event', ter: 'Изнанка', ev: { id: 1028, hw: true, look: 'lostghost', name: 'Загадка призрака', st: 'riddle', until: o.now + 45000, q: 'Без рук, а ворота открывает?', qi: 1, qn: 3, how: 'Напиши ответ словами' } }) },
  { id: 'hw-skeldance-show', group: 'holiday', title: 'Пляска скелетов', icon: '🎃', expect: 'event', build: o => base(o, { k: 'event', ter: 'Изнанка', ev: { id: 1028, hw: true, look: 'skeldance', name: 'Пляска скелетов', st: 'show', until: o.now + 45000, len: 4, sq: [['l', o.now - 3000], ['r', o.now - 2000], ['j', o.now - 1000]], how: 'Смотри на па — потом повтори цепочку' } }) },
  { id: 'hw-skeldance-input', group: 'holiday', title: 'Повтори последовательность', icon: '🎃', expect: 'event', build: o => base(o, { k: 'event', ter: 'Изнанка', ev: { id: 1028, hw: true, look: 'skeldance', name: 'Повтори последовательность', st: 'input', until: o.now + 45000, len: 4, sq: [], how: 'Напиши всю цепочку па через пробел', bt: [['Влево', 'влево'], ['Вправо', 'вправо'], ['Прыг', 'прыг'], ['Хлоп', 'хлоп']], okN: 2, badN: 1 } }) },
  { id: 'gob-shell', group: 'event', title: 'Ярмарка гоблинов: Напёрстки', icon: '🃏', expect: 'event', build: o => base(o, { k: 'event', ev: { id: 82, gob: true, look: 'goblin', name: 'Ярмарка гоблинов', st: 'guess', g: 1, gk: 'shell', min: 10, cap: 100, until: o.now + 30000, me: ['', 20, '', '', 0, 0, 0], bt: [['1', '1'], ['2', '2'], ['3', '3']], hl: { c1: '7', hp: 1.8, lp: 2.2 }, round: { n: 6, pot: 120 } } }) },
  { id: 'gob-coin', group: 'event', title: 'Ярмарка гоблинов: Орёл или решка', icon: '🃏', expect: 'event', build: o => base(o, { k: 'event', ev: { id: 82, gob: true, look: 'goblin', name: 'Ярмарка гоблинов', st: 'guess', g: 1, gk: 'coin', min: 10, cap: 100, until: o.now + 30000, me: ['', 20, '', '', 0, 0, 0], bt: [['Орёл', 'орёл'], ['Решка', 'решка']], hl: { c1: '7', hp: 1.8, lp: 2.2 }, round: { n: 6, pot: 120 } } }) },
  { id: 'gob-hilo', group: 'event', title: 'Ярмарка гоблинов: Больше или меньше', icon: '🃏', expect: 'event', build: o => base(o, { k: 'event', ev: { id: 82, gob: true, look: 'goblin', name: 'Ярмарка гоблинов', st: 'guess', g: 1, gk: 'hilo', min: 10, cap: 100, until: o.now + 30000, me: ['', 20, '', '', 0, 0, 0], bt: [['Больше', 'больше'], ['Меньше', 'меньше']], hl: { c1: '7', hp: 1.8, lp: 2.2 }, round: { n: 6, pot: 120 } } }) },
  { id: 'gob-ask', group: 'event', title: 'Ярмарка: ask', icon: '🃏', expect: 'event', build: o => base(o, { k: 'event', ev: { id: 82, gob: true, look: 'goblin', name: 'Ярмарка гоблинов', st: 'ask', g: 1, gk: 'shell', min: 10, cap: 100, until: o.now + 30000, bt: [['Да', 'да'], ['Нет', 'нет']], rv: { text: 'Шарик под вторым стаканом', cheat: false }, games: [['shell', 'Напёрстки'], ['coin', 'Орёл или решка'], ['hilo', 'Больше или меньше']], me: ['', 0, '', '', 0, 20, 1] } }) },
  { id: 'gob-bet', group: 'event', title: 'Ярмарка: bet', icon: '🃏', expect: 'event', build: o => base(o, { k: 'event', ev: { id: 82, gob: true, look: 'goblin', name: 'Ярмарка гоблинов', st: 'bet', g: 1, gk: 'shell', min: 10, cap: 100, until: o.now + 30000, bt: [['Да', 'да'], ['Нет', 'нет']], rv: { text: 'Шарик под вторым стаканом', cheat: false }, games: [['shell', 'Напёрстки'], ['coin', 'Орёл или решка'], ['hilo', 'Больше или меньше']], me: ['', 0, '', '', 0, 20, 1] } }) },
  { id: 'gob-shuffle', group: 'event', title: 'Ярмарка: shuffle', icon: '🃏', expect: 'event', build: o => base(o, { k: 'event', ev: { id: 82, gob: true, look: 'goblin', name: 'Ярмарка гоблинов', st: 'shuffle', g: 1, gk: 'shell', min: 10, cap: 100, until: o.now + 30000, bt: [['Да', 'да'], ['Нет', 'нет']], rv: { text: 'Шарик под вторым стаканом', cheat: false }, games: [['shell', 'Напёрстки'], ['coin', 'Орёл или решка'], ['hilo', 'Больше или меньше']], me: ['', 0, '', '', 0, 20, 1] } }) },
  { id: 'gob-reveal', group: 'event', title: 'Ярмарка: reveal', icon: '🃏', expect: 'event', build: o => base(o, { k: 'event', ev: { id: 82, gob: true, look: 'goblin', name: 'Ярмарка гоблинов', st: 'reveal', g: 1, gk: 'shell', min: 10, cap: 100, until: o.now + 30000, bt: [['Да', 'да'], ['Нет', 'нет']], rv: { text: 'Шарик под вторым стаканом', cheat: false }, games: [['shell', 'Напёрстки'], ['coin', 'Орёл или решка'], ['hilo', 'Больше или меньше']], me: ['', 0, '', '', 0, 20, 1] } }) },
  { id: 'gob-next', group: 'event', title: 'Ярмарка: next', icon: '🃏', expect: 'event', build: o => base(o, { k: 'event', ev: { id: 82, gob: true, look: 'goblin', name: 'Ярмарка гоблинов', st: 'next', g: 1, gk: 'shell', min: 10, cap: 100, until: o.now + 30000, bt: [['Да', 'да'], ['Нет', 'нет']], rv: { text: 'Шарик под вторым стаканом', cheat: false }, games: [['shell', 'Напёрстки'], ['coin', 'Орёл или решка'], ['hilo', 'Больше или меньше']], me: ['', 0, '', '', 0, 20, 1] } }) },
  { id: 'gob-done', group: 'event', title: 'Ярмарка: done', icon: '🃏', expect: 'event', build: o => base(o, { k: 'event', ev: { id: 82, gob: true, look: 'goblin', name: 'Ярмарка гоблинов', st: 'done', g: 1, gk: 'shell', min: 10, cap: 100, until: o.now + 30000, bt: [['Да', 'да'], ['Нет', 'нет']], rv: { text: 'Шарик под вторым стаканом', cheat: false }, games: [['shell', 'Напёрстки'], ['coin', 'Орёл или решка'], ['hilo', 'Больше или меньше']], me: ['', 0, '', '', 0, 20, 1] } }) },
  // Праздничное
  { id: 'gather-hw', group: 'holiday', title: 'Сбор у портала (Хэллоуин)', icon: '🌀', expect: 'gather', build: (o) => base(o, { k: 'gather', t: 'Сбор у портала', n: 6, party: 'q', cm: true, gather: { until: o.now + 60_000, hw: true } }) },
  { id: 'hw-golem', group: 'holiday', title: 'Тыквенный голем', icon: '🎃', expect: 'battle',
    build: (o) => { const v = battle(o, { foes: [['R', 'hw_pumpkin', true, 0.9, 'Тыквенный голем'], ['R', 'hw_pumpkinlet', false, 0.6, 'Тыквёнок'], ['R', 'hw_crow', false, 1, 'Ворон']], title: 'Тыквенный голем', ter: 'Изнанка' }); v.gather = { until: 0, hw: true }; return v; } },
  { id: 'hw-ghosts', group: 'holiday', title: 'Призраки Изнанки', icon: '👻', expect: 'battle',
    build: (o) => { const v = battle(o, { st: 'tele', fronts: ['L', 'R'], foes: [['L', 'hw_ghost', true, 0.8, 'Призрак'], ['L', 'hw_bat', false, 1, 'Летучая мышь'], ['R', 'hw_witch', false, 0.7, 'Ведьма'], ['R', 'hw_skeleton', false, 1, 'Скелет']], title: 'Призраки', ter: 'Изнанка', extra: { tele: { word: 'свет', text: 'Призрак воет!', got: 1, need: 6 } } }); v.gather = { until: 0, hw: true }; return v; } },
];

export const mockById = (id: string): QuestMock | undefined => QUEST_MOCKS.find((m) => m.id === id);
/** The 25 builders of the userscript 3.1, by its names (all present here, some renamed) — kept for the test. */
export const USERSCRIPT_IDS = ['battle', 'battle-tele', 'map', 'map-vote', 'gather', 'gather-hw', 'rest', 'travel', 'town', 'trap-word', 'trap-gas',
  'trap-ceiling', 'trap-bait', 'trap-share', 'trap-code', 'trap-plates', 'treasure', 'trap-result', 'ev-traveler', 'ev-dice', 'ev-well', 'ev-priest',
  'shop', 'loot', 'lair'] as const;
