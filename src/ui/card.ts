/** Item cell + item card HTML (GAME-DESIGN §4.10). Pure string builders. */
import type { Hero, Item } from '../contracts';
import {
  rarOf, SLOT_NAME, deltas, stLabel, stNum, effText, edible, eatVerb, useCmd, cdUntil, mmss, esc, GEAR_NAME, CLASS_NAME, XS_LABEL, num,
} from './data';
import { itemArt, statIcon } from './icons';
import type { Cell } from './data';

export function cellHtml(c: Cell | null, h: Hero | null, o: { sel?: boolean; act?: string; small?: boolean; idx?: number } = {}): string {
  if (!c) return `<div class="cell empty" aria-hidden="true"></div>`;
  const it = c.it, rc = rarOf(it.rarity).color, d = deltas(it, h), cd = cdUntil(it, h);
  return `<button type="button" class="cell${o.sel ? ' sel' : ''}" data-r="${esc(it.rarity)}" style="--rc:${rc}" data-act="${o.act || 'sel'}" data-uid="${esc(it.uid)}"${o.idx != null ? ` data-idx="${o.idx}"` : ''} aria-label="${esc(it.name)}">`
    + itemArt(it)
    + (it.en ? `<i class="en">+${+it.en}</i>` : '')
    + (c.n > 1 ? `<i class="n">×${c.n}</i>` : '')
    + (it.no != null && !o.small ? `<i class="no" title="Номер в сумке — для команд в чате">${esc(it.no)}</i>` : '')
    + (d.better ? `<i class="up" title="Лучше надетого">▲</i>` : '')
    + (cd ? `<span class="cd">${mmss(cd)}</span>` : '')
    + `</button>`;
}

/** Site 31.10 (feat/candy-tile, app.js candyCell): the Halloween candies as a tile after the items in the bag (filter «Все»).
 *  Not an item: no data-act / data-uid (nothing selects, equips or drags it), it takes no place (the «N / M» count and the
 *  empty cells stay as without it), the hint is its title. The number is the event counter hero.hw.c («9999+» above 9999). */
export const CANDY_MAX = 9999;
export const candyText = (n: number): string => `Конфеты: ${n}. Тратить — в «Ступе сладостей» в Городе; в конце ивента остаток превратится в монеты.`;
export function candyCellHtml(h: Hero | null): string {
  const hw = h && (h as { hw?: { c?: unknown } | null }).hw;
  if (!hw) return '';
  const n = Math.max(0, Math.floor(+(hw.c as number) || 0)), t = candyText(n);
  return `<div class="cell cnd" data-r="common" style="--rc:#9b5cff" role="img" data-candy="${n}" title="${esc(t)}" aria-label="${esc(t)}"><span class="ci" aria-hidden="true">🍬</span><i class="n">${n > CANDY_MAX ? CANDY_MAX + '+' : n}</i></div>`;
}

export interface CardOpts { full?: boolean; n?: number; busyText?: string | null; forceCompare?: boolean; pending?: string | null }

/** Card body. full = detail pane (with actions + chat hint); else tooltip. */
export function cardHtml(it: Item, h: Hero | null, o: CardOpts = {}): string {
  const r = rarOf(it.rarity), d = deltas(it, h, o.forceCompare), eff = effText(it);
  const head = `<div class="ch">${o.full ? cellHtml({ it, uids: [it.uid], n: o.n || 1 }, h, { act: 'none', small: true }) : ''}<div>
    <div class="nm">${esc(it.name)}${it.en ? ` +${+it.en}` : ''}${(o.n || 1) > 1 ? ` <span class="mut">×${o.n}</span>` : ''}</div>
    <div class="sub"><span class="rar">${r.name}</span><span>${esc(SLOT_NAME[String(it.slot)] || '')}</span>${it.on ? '<span class="ok">✓ надето</span>' : ''}</div></div></div>`;
  const rows = d.rows.length ? `<ul class="sts">${d.rows.map((x) => `<li${XS_LABEL[x.k] ? ' class="xr"' : ''}>${statIcon(x.k)}<span>${esc(stLabel(x.k))}</span><b>${stNum(x.k, x.v)}</b>`
    + (d.c ? (x.dv ? `<em class="${x.dv > 0 ? 'up' : 'dn'}">${x.dv > 0 ? '▲ +' : '▼ −'}${num(Math.abs(x.dv))}</em>` : '<em class="eq">=</em>') : '<em></em>') + `</li>`).join('')}</ul>` : '';
  const verdict = d.c ? `<p class="verdict">Сравнение с надетым: <b>${esc(d.c.name)}</b> — в целом ${d.score > 0.01 ? '<b class="up">лучше</b>' : d.score < -0.01 ? '<b class="dn">слабее</b>' : '<b>так же</b>'}</p>` : '';
  const aura = (it as any).aura && typeof (it as any).aura === 'object' ? `<p class="eff">${esc((it as any).aura.icon || '✦')} ${esc((it as any).aura.name || 'Аура')}: ${esc((it as any).aura.text || '')}<br><span class="mut">Аура на весь отряд в бою, пока владелец жив</span></p>` : '';
  const mq: string[] = [];
  if ((it as any).desc) mq.push(`<p>${esc((it as any).desc)}</p>`);
  if (it.slot === 'weapon' && it.role && h && it.role !== h.role) mq.push(`<p>С этим оружием станешь: <b>${esc(CLASS_NAME[it.role] || it.role)}</b></p>`);
  if (it.gear && GEAR_NAME[it.gear]) mq.push(`<p>Тип: ${GEAR_NAME[it.gear]}</p>`);
  if (it.en) mq.push(`<p>Заточка +${+it.en}${it.stats0 ? ': было ' + Object.entries(it.stats0).map(([k, v]) => `${esc(stLabel(k).toLowerCase())} ${num(+v)}`).join(', ') : ''}</p>`);
  if (it.dur != null) mq.push(`<p${+it.dur <= 30 ? ' style="color:var(--l3d-dn)"' : ''}>${+it.dur <= 30 ? '⚠ ' : ''}Прочность ${+it.dur}% — почини у кузнеца</p>`);
  if ((it as any).pts) mq.push('<p>Куплено за баллы канала</p>');
  if (it.relic) mq.push('<p>✦ Использовать пока нельзя — печать хранится в сумке.</p>');
  if (it.slot === 'material') mq.push('<p>Материал заточки — пригодится у наковальни возле Кузни.</p>');
  let acts = '';
  if (o.full) {
    const lock = o.busyText;
    const dis = lock || o.pending ? ' disabled' : '';
    const label = (t: string) => (o.pending === it.uid ? 'Секунду…' : t);
    const b: string[] = [];
    if (it.wearable) {
      if (it.on) b.push(`<button type="button" class="btn ghost" data-act="unequip" data-slot="${esc(it.slot)}"${dis}>${label('Снять')}</button>`);
      else b.push(`<button type="button" class="btn" data-act="equip" data-uid="${esc(it.uid)}"${dis}>${label(d.c ? 'Заменить' : 'Надеть')}</button>`);
    } else if (edible(it)) {
      const cd = cdUntil(it, h);
      b.push(`<button type="button" class="btn gold" data-act="use" data-uid="${esc(it.uid)}"${dis || (cd ? ' disabled' : '')}>${label(eatVerb(it))}${cd ? ' · ' + mmss(cd) : ''}</button>`);
    }
    acts = (b.length ? `<div class="acts">${b.join('')}</div>` : '')
      + (lock ? `<p class="note warn">${lock}</p>` : '')
      + (useCmd(it) ? `<p class="note">${edible(it) ? 'Или на стриме' : 'На стриме напиши в чат'}: <b class="cmd">${esc(useCmd(it))}</b></p>` : '');
  }
  return `<div class="card" style="--rc:${r.color}">${head}${rows}${eff ? `<p class="eff">${esc(eff[0].toUpperCase() + eff.slice(1))}</p>` : ''}${aura}${verdict}${mq.length ? `<div class="mq">${mq.join('')}</div>` : ''}${acts}</div>`;
}
