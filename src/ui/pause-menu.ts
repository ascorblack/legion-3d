/**
 * The pause menu (Esc): model, markup and keyboard navigation. src/ui/menus.ts owns the page (pPause / key / pauseAct);
 * this file is pure (no DOM state) so the layout rules are testable.
 *
 * Layout: one board — on the left the hero plate (level, name, class, HP / XP, coins) and «Продолжить»; on the right the
 * entries in three groups: «Герой» (big tiles with a line of explanation), «Город и сайт» (places of the City and the
 * site's windows — registered by features, shown only while the site offers them) and «Система» (compact tiles).
 * Every entry has a line icon of src/ui/pause-icons.ts and, when it has one, its key as a keycap.
 * Arrows / WASD move spatially between the tiles (pauseNav: the nearest tile in that direction, across columns and groups).
 */
import type { Hero } from '../contracts';
import { esc, hpInfo, xpInfo, roleTitle, coinStyle } from './data';
import { moneyText } from './money';
import { coinsHtml } from './hud';
import { pauseIcon } from './pause-icons';
import { pauseItems as extPauseItems, pauseGroupOf, type PauseGroup } from './settings-ext';

export interface PauseEntry {
  /** Action id for Menus.pauseAct: 'resume', 'tab:<id>', 'go:<page>', 'classic:<spec>', 'classic-site', 'ext:<id>'. */
  act: string; label: string; key: string; group: PauseGroup | 'resume'; icon: string; order: number; sub?: string; badge?: string;
}
export const PAUSE_GROUPS: readonly [PauseGroup, string][] = [['hero', 'Герой'], ['city', 'Город и сайт'], ['system', 'Система']];

/** A feature's label without a leading emoji (the menu draws one icon set; «🐞 Отладка» → «Отладка»). */
export const plainLabel = (s: string): string => {
  const t = String(s ?? '').replace(/^[\p{Extended_Pictographic}\uFE0F\u200D\u20E3\s]+/u, '').trim();
  return t || String(s ?? '').trim();
};
const badgeOf = (f: (() => unknown) | undefined): string => {
  if (!f) return '';
  try { const v = f(); return v == null || v === 0 || v === false ? '' : String(v).slice(0, 4); } catch { return ''; }
};

export interface PauseModelIn {
  /** Character tab the «Персонаж» entry opens (the last one used). */
  charTab: string;
  /** An expedition is running (the site's «Поход» panel). */
  quest: boolean;
  /** Feature pages of the 'system' tab group (ui.addTab): they open from here. */
  systemTabs: { id: string; name: string; key: string }[];
}
/** Every entry of the pause menu right now, sorted by group order then `order`. */
export function pauseEntries(o: PauseModelIn): PauseEntry[] {
  const out: PauseEntry[] = [
    { act: 'resume', label: 'Продолжить', key: 'Esc', group: 'resume', icon: 'play', order: 0 },
    { act: 'tab:' + o.charTab, label: 'Персонаж', key: 'Tab', group: 'hero', icon: 'cat', order: 1, sub: 'Вещи и сумка' },
    { act: 'tab:map', label: 'Карта', key: 'M', group: 'hero', icon: 'map', order: 2, sub: 'План города' },
  ];
  if (o.quest) out.push({ act: 'classic:quest', label: 'Поход', key: '', group: 'hero', icon: 'flag', order: 3, sub: 'Отряд на сайте' });
  for (const t of o.systemTabs) out.push({ act: 'tab:' + t.id, label: plainLabel(t.name), key: t.key || '', group: 'hero', icon: 'page', order: 50 });
  for (const p of extPauseItems()) {
    let label = '';
    try { label = plainLabel(p.label); } catch { label = p.id; }
    const group = pauseGroupOf(p);
    // the hero group's tiles carry a line of explanation for the built-in journeys
    const sub = p.id === 'travel' ? 'Города и каналы' : undefined;
    out.push({ act: 'ext:' + p.id, label, key: p.key || '', group, icon: p.icon || 'dot', order: p.order ?? 0, badge: badgeOf(p.badge), ...(sub ? { sub } : {}) });
  }
  out.push(
    { act: 'go:settings', label: 'Настройки', key: '', group: 'system', icon: 'gear', order: 1 },
    { act: 'go:help', label: 'Управление', key: 'F1', group: 'system', icon: 'keys', order: 2 },
    { act: 'classic-site', label: 'Классический сайт', key: 'F8', group: 'system', icon: 'window', order: 999 },
  );
  const G: Record<string, number> = { resume: 0, hero: 1, city: 2, system: 3 };
  return out.map((e, i) => [e, i] as const).sort((a, b) => G[a[0].group] - G[b[0].group] || a[0].order - b[0].order || a[1] - b[1]).map(([e]) => e);
}

/* ------------------------------------------------------------------ markup */
/** Keycap text: a chord's Enter is drawn as ↵ so «Alt+Enter» does not crowd a tile's label (aria-keyshortcuts keeps the name). */
export const capText = (k: string): string => (k.includes('+') ? k.replace(/\+?Enter$/, ' ↵') : k);
/** ↵ drawn as a line glyph (fonts draw U+21B5 tiny or not at all). */
const RET = '<svg class="ret" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M19 5v7H6"/><path d="m10 8-4 4 4 4"/></svg>';
const cap = (k: string): string => `<i class="kc sm dk" aria-hidden="true">${esc(capText(k)).replace(' ↵', RET).replace('↵', RET)}</i>`;
const tile = (e: PauseEntry, cur: string): string => {
  const on = e.act === cur, hero = e.group === 'hero';
  const aria = e.badge ? ` aria-label="${esc(e.label)}, новых: ${esc(e.badge)}"` : '';
  const keys = e.key ? ` aria-keyshortcuts="${esc(e.key)}"` : '';
  const badge = e.badge ? `<em class="pb" aria-hidden="true">${esc(e.badge)}</em>` : '';
  const kc = e.key ? cap(e.key) : '';
  // hero tiles: keycap / badge in the top-right corner; the other tiles: one right-hand slot, empty but kept
  const side = hero ? badge + kc : `<span class="pr">${badge}${kc}</span>`;
  return `<button type="button" role="menuitem" class="pi${on ? ' cur' : ''}" data-act="pause" data-p="${esc(e.act)}" tabindex="${on ? 0 : -1}"${aria}${keys}>`
    + `${pauseIcon(e.icon, hero ? 34 : 24)}<span class="pl"><b>${esc(e.label)}</b>${e.sub ? `<small>${esc(e.sub)}</small>` : ''}</span>${side}</button>`;
};

/** The hero plate: level medal, name, class, HP / XP with numbers, coins (the HUD is hidden while a menu is open). */
export function heroPlate(H: Hero | null): string {
  if (!H) return `<div class="ph empty"><p>Героя пока нет — он появится, когда ты напишешь в чат на стриме.</p></div>`;
  const hp = hpInfo(H), xp = xpInfo(H), dead = !!H.ghost;
  let cls = ''; try { cls = roleTitle(H); } catch { cls = ''; }
  // Halloween candies (hero.hw.c), shown like the HUD's chip only while the site sends them
  const hw = (H as { hw?: { c?: unknown } | null }).hw;
  const candy = hw ? Math.max(0, Math.floor(+(hw.c as number) || 0)) : null;
  let coinTitle = 'Монеты'; try { coinTitle = 'Монеты: ' + moneyText(+H.money || 0, +H.money || 0, coinStyle()); } catch { /* keep the word */ }
  const pct = (v: number) => (Math.max(0, Math.min(1, v)) * 100).toFixed(1) + '%';
  return `<div class="ph">
    <div class="ph-top"><div class="ph-lv" title="Уровень"><span class="ears" aria-hidden="true"></span><b>${esc(H.level)}</b><span>ур.</span></div><div class="ph-id"><b>${esc(H.name)}</b>${cls ? `<span>${esc(cls)}</span>` : ''}</div></div>
    <div class="ph-bars"><div class="ph-st${dead ? ' dead' : ''}"><div class="r"><span>Здоровье</span><b>${dead ? 'призрак' : `${hp.now} / ${hp.max}`}</b></div><div class="ph-bar hp" role="img" aria-label="Здоровье ${hp.now} из ${hp.max}"><i style="width:${pct(dead ? 0 : hp.pct)}"></i></div></div>
    <div class="ph-st"><div class="r"><span>Опыт</span><b>${xp.xneed == null ? 'максимум' : `${xp.xin} / ${xp.xneed}`}</b></div><div class="ph-bar xp" role="img" aria-label="Опыт ${xp.xneed == null ? 'максимум' : `${xp.xin} из ${xp.xneed}`}"><i style="width:${pct(xp.pct)}"></i></div></div></div>
    <div class="ph-coins"><span class="ph-cur" title="${esc(coinTitle)}"><span class="lbl">Монеты</span><span class="val">${coinsHtml(+H.money || 0)}</span></span>${candy == null ? '' : `<span class="ph-cur" title="Конфеты Хэллоуина: ${candy} — не занимают место в сумке"><span class="lbl">Конфеты</span><span class="val"><span class="mp">${pauseIcon('candy', 18)}<b>${candy}</b></span></span></span>`}</div>
  </div>`;
}

/** The whole pause page. `cur` = the act of the selected entry. */
export function pausePageHtml(entries: PauseEntry[], H: Hero | null, cur: string): string {
  const resume = entries.find((e) => e.group === 'resume')!;
  const sec = (g: PauseGroup, title: string): string => {
    const list = entries.filter((e) => e.group === g); if (!list.length) return '';
    // «Герой»: up to four big tiles share one row (no tile is ever stretched); more wrap in threes
    const n = g === 'hero' ? ` style="--n:${list.length <= 4 ? list.length : 3}"` : '';
    return `<section class="pg pg-${g}" role="group" aria-labelledby="pg-${g}"><h3 class="pgh" id="pg-${g}">${esc(title)}</h3><div class="pgl"${n}>${list.map((e) => tile(e, cur)).join('')}</div></section>`;
  };
  // «Герой» across the top; «Город и сайт» and «Система» below as two lists side by side (rows of one height, keycaps in one column)
  const [hero, ...rest] = PAUSE_GROUPS.map(([g, title]) => sec(g, title));
  const lists = rest.join('');
  const groups = hero + (lists ? `<div class="pg-lists">${lists}</div>` : '');
  const on = resume.act === cur;
  return `<div class="page p-pause" data-page="pause"><div class="pm">
    <div class="pm-board" role="menu" aria-label="Пауза">
      <div class="pm-side">
        <div class="pm-mark"><b>ЛЕГИОН</b><span>3D-прогулка по городу</span></div>
        <div class="pm-me">${heroPlate(H)}
        <button type="button" role="menuitem" class="pi-resume${on ? ' cur' : ''}" data-act="pause" data-p="resume" tabindex="${on ? 0 : -1}" aria-keyshortcuts="Escape">${pauseIcon('play', 22)}<span class="pl">Продолжить</span>${cap('Esc')}</button></div>
      </div>
      <div class="pm-groups">${groups}</div>
      <div class="pm-foot"><span class="pk"><i class="kc sm dk kk">↑↓←→</i>выбор</span><span class="pk"><i class="kc sm dk">Enter</i>открыть</span><p class="pver">Неофициальное расширение. Игра и правила — на сайте</p></div>
    </div>
  </div></div>`;
}

/* ------------------------------------------------------------------ keyboard */
export type NavDir = 'up' | 'down' | 'left' | 'right';
export interface NavRect { x: number; y: number; w: number; h: number }
/** Arrow / WASD codes → direction (null = not a navigation key). */
export const navDir = (code: string): NavDir | null =>
  code === 'ArrowUp' || code === 'KeyW' ? 'up' : code === 'ArrowDown' || code === 'KeyS' ? 'down'
    : code === 'ArrowLeft' || code === 'KeyA' ? 'left' : code === 'ArrowRight' || code === 'KeyD' ? 'right' : null;
const gap = (a0: number, a1: number, b0: number, b1: number) => Math.max(0, Math.max(a0, b0) - Math.min(a1, b1));
/**
 * Spatial navigation: the tile nearest to `cur` in direction `dir` (on-axis distance + 3 × the off-axis gap, so the same
 * column / row wins over a diagonal). Up / down wrap to the other end of the same column; left / right stop at the edge.
 */
export function pauseNav(R: readonly NavRect[], cur: number, dir: NavDir): number {
  const c = R[cur]; if (!c) return R.length ? 0 : -1;
  const vert = dir === 'up' || dir === 'down', E = 1;
  let best = -1, bs = Infinity;
  for (let i = 0; i < R.length; i++) {
    if (i === cur) continue;
    const r = R[i];
    let along: number;
    if (dir === 'down') along = r.y - (c.y + c.h); else if (dir === 'up') along = c.y - (r.y + r.h);
    else if (dir === 'right') along = r.x - (c.x + c.w); else along = c.x - (r.x + r.w);
    if (along < -E) continue;
    const off = vert ? gap(c.x, c.x + c.w, r.x, r.x + r.w) : gap(c.y, c.y + c.h, r.y, r.y + r.h);
    const centre = vert ? Math.abs((r.x + r.w / 2) - (c.x + c.w / 2)) : Math.abs((r.y + r.h / 2) - (c.y + c.h / 2));
    const s = Math.max(0, along) + off * 3 + centre * 0.05;
    if (s < bs) { bs = s; best = i; }
  }
  if (best >= 0 || !vert) return best >= 0 ? best : cur;
  // wrap: the far end of the same column (tiles overlapping the current one horizontally), else of the whole menu
  let pick = -1, py = dir === 'down' ? Infinity : -Infinity;
  for (const pass of [true, false]) {
    for (let i = 0; i < R.length; i++) {
      if (i === cur) continue;
      const r = R[i];
      if (pass && gap(c.x, c.x + c.w, r.x, r.x + r.w) > 0) continue;
      const y = r.y;
      if (dir === 'down' ? y < py : y > py) { py = y; pick = i; }
    }
    if (pick >= 0) break;
  }
  return pick >= 0 ? pick : cur;
}
