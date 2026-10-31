/**
 * Fair "microscope" (idea #7): short built-in Russian texts per landmark (BuildingDef id) and the helpers for the card:
 * the neighbouring landmark and the direction to it relative to where the player is looking. Pure (no DOM, no three.js).
 */
export interface LandmarkText { icon: string; what: string; tip: string }

export const LANDMARK_TEXTS: Record<string, LandmarkText> = {
  forge: { icon: '🔨', what: 'Кузня. Здесь куют и чинят оружие и броню, а у горна всегда тепло — даже ночью.', tip: 'Загляните: купить клинок, щит или отремонтировать снаряжение.' },
  tent: { icon: '🎪', what: 'Шатёр облика. Полосатый купол ярмарки, а под ним — костюмы, шляпки и всё, что делает кота заметным.', tip: 'Здесь меняют внешний вид персонажа.' },
  hall: { icon: '🏛', what: 'Ратуша. Сердце города: казна, оборона и важные решения жителей.', tip: 'Если вывеска «строится», двери откроются позже.' },
  gate: { icon: '🚪', what: 'Городские ворота. Отсюда уходят в поход — но только когда стример собирает отряд.', tip: 'Во время похода ворота показывают его ход.' },
  magic: { icon: '🔮', what: 'Башня звездочёта. В окнах горят звёздные карты, а на полках — посохи, мантии и амулеты.', tip: 'Магические вещи продаются здесь.' },
  mine: { icon: '⛏', what: 'Шахта. Тёмный штрек с рельсами и вагонеткой: руду добывают всем городом.', tip: 'Вход в нижнем ярусе, у стены.' },
  mineboard: { icon: '📋', what: 'Итоги шахты. Доска с недавними находками и рекордами старателей.', tip: 'Подойдите ближе — тут видно, кто добыл больше всех.' },
  storage: { icon: '📦', what: 'Склад. Сундуки, бочки и ящики: вещи ждут хозяев, не занимая места в сумке.', tip: 'Сюда прячут то, что жалко выбросить.' },
  auction: { icon: '⚖', what: 'Аукцион. Здесь жители торгуются между собой: кто больше даст, тот и унесёт.', tip: 'Выставляйте свои вещи или ищите чужие.' },
  board: { icon: '📌', what: 'Доска объявлений. Новости города, слухи и записки, приколотые чьей-то лапкой.', tip: 'Читайте — иногда там пишут про события.' },
  trainer: { icon: '🥋', what: 'Тренер. Площадка с мишенями и мудрый наставник, у которого можно выучить новые приёмы.', tip: 'Здесь растёт дерево навыков.' },
  shop: { icon: '🛒', what: 'Лавка. Торговые ряды: еда, зелья и материалы под гирляндами.', tip: 'Заходите внутрь и смотрите товары прямо на прилавках.' },
  anvil: { icon: '🪨', what: 'Заточка. Наковальня у кузни: вещи можно сделать сильнее — если повезёт.', tip: 'Искры летят во все стороны, отойдите на шаг.' },
  jail: { icon: '⛓', what: 'Тюрьма канала. Каменный дом с зубцами и клетка рядом: в ней сидят те, кого забанили на канале.', tip: 'Внутрь не войти — нажмите E, чтобы узнать, кто сидит и когда выйдет.' },
  statue: { icon: '🗿', what: 'Статуя героя. Каменный кот стоит здесь дольше, чем помнят самые старые жители.', tip: 'Говорят, на удачу надо погладить ему лапу.' },
};
export const GENERIC_LANDMARK: LandmarkText = { icon: '🏠', what: 'Одно из ярмарочных зданий. Вывеска светится — значит, кто-то здесь живёт или торгует.', tip: 'Загляните внутрь, если дверь открыта.' };

export const landmarkText = (id: string): LandmarkText => LANDMARK_TEXTS[id] ?? GENERIC_LANDMARK;

export interface LandmarkPos { id: string; title: string; x: number; z: number }

/** Nearest other landmark to `from` (by horizontal distance, metres), with that distance. */
export function neighbour(list: LandmarkPos[], from: LandmarkPos): { lm: LandmarkPos; dist: number } | null {
  let best: LandmarkPos | null = null, bd = Infinity;
  for (const l of list) {
    if (l.id === from.id) continue;
    const d = Math.hypot(l.x - from.x, l.z - from.z);
    if (d < bd) { bd = d; best = l; }
  }
  return best ? { lm: best, dist: bd } : null;
}

/** Direction of (dx,dz) relative to the facing (fx,fz) on the XZ plane (y up, camera looks along −z when yaw = 0). */
export function relDir(fx: number, fz: number, dx: number, dz: number): { arrow: string; word: string } {
  const cross = fx * dz - fz * dx, dot = fx * dx + fz * dz;
  const a = Math.atan2(cross, dot) * 180 / Math.PI;   // + = to the right
  if (Math.abs(a) < 35) return { arrow: '↑', word: 'впереди' };
  if (Math.abs(a) > 145) return { arrow: '↓', word: 'позади' };
  if (a > 0) return a < 70 ? { arrow: '↗', word: 'впереди справа' } : a < 110 ? { arrow: '→', word: 'справа' } : { arrow: '↘', word: 'позади справа' };
  return a > -70 ? { arrow: '↖', word: 'впереди слева' } : a > -110 ? { arrow: '←', word: 'слева' } : { arrow: '↙', word: 'позади слева' };
}

/**
 * "← Кузня — 18 м, слева": the neighbour of `from` (distance measured between the landmarks), the direction measured from
 * the player (px, pz) looking along (fx, fz).
 */
export function hintLine(list: LandmarkPos[], from: LandmarkPos, px: number, pz: number, fx: number, fz: number): string {
  const n = neighbour(list, from);
  if (!n) return '';
  const r = relDir(fx, fz, n.lm.x - px, n.lm.z - pz);
  return `${r.arrow} ${n.lm.title} — ${Math.round(n.dist)} м, ${r.word}`;
}
