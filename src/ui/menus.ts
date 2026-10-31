/** Full-screen game menu (Character / World tab ribbon), pause menu, settings, help. GAME-DESIGN §4. */
import type { Hero, Item, ApiResult } from '../contracts';
import { type Ctx, h } from './ctx';
import {
  esc, rarOf, SLOT_NAME, WEAR_SLOTS, equipped, deltas, bagCells, catOf, CAT_NAME, CAT_ORDER, hpInfo, xpInfo, stLabel,
  XS_KEYS, XS_LABEL, XPCT, num, ST_HELP, edible, plainCountdown, timeAgo, coinStyle, CLASS_NAME, roleTitle, type Cell,
} from './data';
import { cellHtml, cardHtml } from './card';
import { slotSilhouette, statIcon } from './icons';
import { moneyParts } from './money';
import { coinsHtml } from './hud';
import { saveSetting, type UiSettings } from './settings';
import { settingRows, settingRow, readRow, writeRow, pauseItems as extPauseItems, pauseItem } from './settings-ext';
import type { TabEntry } from './tabs';
import { MapView } from './map';
import { earnedMedals } from '../collect/medals';
import { bossName } from '../quest/model';
import { milestones } from '../collect/milestones';
import type { GameContext } from '../contracts/ext';
import { setHtml } from '../core/html';

export const STANDALONE = ['pause', 'settings', 'help'];
/** Contract/legacy aliases → our ids. */
export const ALIAS: Record<string, string> = { character: '', journal: 'log', equipment: 'gear', inventory: 'bag', rating: 'legion', world: 'map', controls: 'help' };

const JK: Record<string, [string, string]> = {
  fight: ['⚔️', 'Бой'], boss: ['🐉', 'Босс'], dice: ['🎲', 'Кости'], event: ['🎭', 'Событие'], trap: ['🪤', 'Ловушка'], shop: ['🛒', 'Покупка'],
  ench: ['🔨', 'Заточка'], auc: ['⚖️', 'Аукцион'], look: ['🎩', 'Облик'], loot: ['🎁', 'Вещь'], find: ['🔍', 'Находка'], coins: ['🪙', 'Монеты'],
  hero: ['⭐', 'Герой'], award: ['🏅', 'Награда'], store: ['📦', 'Склад'], ach: ['🏆', 'Достижение'], trade: ['🤝', 'Обмен'], bug: ['🐞', 'Репорт'],
};
/** The journal's boss kind is named after the channel's Prologue boss (quest view `bn`, default «Закхуэль»). */
const jkBoss = (q: unknown): [string, string] => ['🐉', bossName(q as { bn?: unknown } | null).n];
const JT: [string, string][] = [['all', 'Все'], ['fight', 'Бой'], ['shop', 'Покупки'], ['find', 'Находки'], ['coins', 'Монеты'], ['ach', 'Достижения']];
const JRK: Record<string, Record<string, string>> = {
  dice: { win: 'Выиграл', lose: 'Проиграл', tie: 'Ничья' }, fight: { win: 'Победа', lose: 'Поражение' }, boss: { win: 'Победа', lose: 'Поражение' },
  trap: { win: 'Справился', lose: 'Пострадал' }, shop: { win: 'Готово', lose: 'Не вышло' }, hero: { win: '', lose: '' }, ach: { win: 'Открыто' }, store: { win: '', lose: '' },
};
const JR: Record<string, string> = { win: 'Победа', lose: 'Неудача', tie: 'Ничья' };
interface JEntry { id: string; at: number; k: string; t: string; r?: string; c?: number; x?: number }

const CLASSIC: Record<string, { spec: string; title: string; text: string; icon: string; alt?: [string, string] }> = {
  skills: { spec: 'hero:skills', title: 'Навыки', icon: 'mag', text: 'Деревья навыков твоего класса: изучение, очки и сброс — в оригинальном окне сайта. Тот же тренер ждёт тебя в городе.' },
  ach: { spec: 'hero:ach', title: 'Достижения', icon: 'crit', text: 'Медали и награды героя — в оригинальном окне сайта.' },
  look: { spec: 'hero:look', title: 'Облик', icon: 'resist', text: 'Форма, цвет, глаза, шапки, аксессуары и ауры. Новое покупается в Шатре на Ярмарке; надевать можно в любой момент, кроме боя.' },
  legion: { spec: 'legion', title: 'Рейтинг Легиона', icon: 'people', text: 'Состав Легиона по классам, самые опытные герои и твоё место.', alt: ['legion:soc', 'Соц. рейтинг'] },
  news: { spec: 'news', title: 'Новости', icon: 'luck', text: 'Новости игры и обновления — те же листки, что на Доске объявлений в городе.' },
};

export class Menus {
  el: HTMLElement;
  private c: Ctx;
  private veil: HTMLElement; private head: HTMLElement; private body: HTMLElement; private foot: HTMLElement; private tip: HTMLElement; private closeBtn: HTMLElement;
  private orbHint: HTMLElement; private orbHintT = 0;
  cur: string | null = null;
  private lastChar = 'gear';
  // page state
  private gSlot = 'weapon'; private gPick: string | null = null;
  private bFilter = 'all'; private bSel: string | null = null; private bIdx = -1;
  private pending: string | null = null;
  private jTab = 'all'; private jList: JEntry[] | null = null; private jErr = false; private jNext: unknown = null; private jLoading = false; private jFor = '';
  private sumCache = new Map<string, { at: number; html: string }>();
  private pauseIdx = 0;
  private hoverUid: string | null = null; private hoverEl: HTMLElement | null = null; private shift = false;
  private px = -1; private py = -1;
  /** Item under the pointer when it was clicked: its card stays hidden until the pointer leaves it. */
  private tipMuted: string | null = null;
  /** After a page switch no card shows until the pointer really moves (the browser re-fires mouseover on new DOM). */
  private moveGate = false;
  private mapView: MapView;
  /** Mounted feature tab (MenuTabDef.render) and its cleanup. */
  private custom: { id: string; def: TabEntry['def']; el: HTMLElement; off: (() => void) | null } | null = null;
  private offs: (() => void)[] = [];

  constructor(c: Ctx) {
    this.c = c;
    try { const v = localStorage.getItem('l3d.menuTab'); if (v && c.tabs.get(v)?.group === 'char') this.lastChar = v; } catch { /* */ }
    this.mapView = new MapView(c, c.map);
    this.el = h('div', 'menu');
    this.setInert(true);
    this.veil = h('div', 'veil'); this.head = h('div', 'head'); this.body = h('div', 'body'); this.foot = h('div', 'foot'); this.tip = h('div', 'tip');
    this.closeBtn = h('button', 'close', '✕'); this.closeBtn.setAttribute('aria-label', 'Закрыть (Esc)'); (this.closeBtn as HTMLButtonElement).type = 'button'; this.closeBtn.dataset.act = 'close';
    // orbit menus: the character stands in the left part of the screen; a hint tells how to turn it (drag/wheel go to the canvas)
    this.orbHint = h('div', 'orbhint', `<i class="mouse" aria-hidden="true"></i><span>Тяни мышью — повернуть</span><i class="dot"></i><span>колесо — приблизить</span>`);
    this.el.append(this.veil, this.orbHint, this.body, this.head, this.foot, this.closeBtn, this.tip);
    this.el.addEventListener('click', (e) => this.onClick(e));
    this.el.addEventListener('dblclick', (e) => this.onDbl(e));
    this.el.addEventListener('mouseover', (e) => this.onOver(e));
    // item cards are hover-only: leaving the item (to anything else, the 3D canvas or out of the window) hides the card
    this.el.addEventListener('mouseout', (e) => {
      const to = e.relatedTarget as Node | null;
      const from = (e.target as HTMLElement).closest?.('.cell[data-uid], .slot[data-uid]');
      if (from && (!to || !from.contains(to))) this.tipMuted = null;
      if (!this.tipOpen) return;
      if (!to || !this.hoverEl || !this.hoverEl.contains(to)) this.hideTip();
    });
    this.el.addEventListener('pointermove', (e) => {
      if (this.moveGate && (Math.abs(e.clientX - this.px) + Math.abs(e.clientY - this.py) > 0 || this.px < 0)) this.moveGate = false;
      this.px = e.clientX; this.py = e.clientY;
      if (!this.tipOpen && !this.moveGate) this.onOver(e);   // entered before the gate opened → show on the first real move
    }, { passive: true });
    // …and never outlive the moment: any click/drag start (orbit), wheel (zoom), Esc, window blur, pointer lock, tab hidden
    // the item under the pointer stays muted until the pointer leaves it (no card coming back on a re-render's mouseover)
    const hide = () => { if (this.tipOpen) { this.tipMuted = this.hoverUid; this.hideTip(); } };
    const down = hide;
    const onKey = (e: KeyboardEvent) => { if (e.code === 'Escape') hide(); };
    const onOut = (e: MouseEvent) => { if (!e.relatedTarget) hide(); };
    const onVis = () => { if (document.hidden) hide(); };
    window.addEventListener('pointerdown', down, true);
    window.addEventListener('wheel', down, { capture: true, passive: true });
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('blur', hide);
    window.addEventListener('mouseout', onOut);
    document.addEventListener('pointerlockchange', hide);
    document.addEventListener('visibilitychange', onVis);
    this.offs.push(() => {
      window.removeEventListener('pointerdown', down, true); window.removeEventListener('wheel', down, { capture: true } as any);
      window.removeEventListener('keydown', onKey, true); window.removeEventListener('blur', hide); window.removeEventListener('mouseout', onOut);
      document.removeEventListener('pointerlockchange', hide); document.removeEventListener('visibilitychange', onVis);
    });
    this.el.addEventListener('input', (e) => this.onInput(e));
    this.el.addEventListener('contextmenu', (e) => { if (this.cur) e.preventDefault(); });
  }

  /* ------------------------------------------------------------ open / close */
  resolve(id: string | null): string | null {
    if (id == null) return null;
    if (id in ALIAS) id = ALIAS[id] || (this.c.tabs.has(this.lastChar) ? this.lastChar : 'gear');
    if (id === 'quest') return 'quest';
    if (this.c.tabs.has(id) || STANDALONE.includes(id)) return id;
    return null;
  }
  /** Ribbon tabs for the current hero (registry order). */
  tabs(): TabEntry[] { return this.c.tabs.ribbon(this.c.host.store.hero); }
  isOrbit(id: string | null) { return !!id && !!this.c.tabs.get(id)?.orbit; }
  /** Per frame while a menu is open: safety net for the hover card + live map. */
  tick(dt: number) {
    if (this.tipOpen && (!this.cur || !this.hoverEl || !this.hoverEl.isConnected || document.pointerLockElement)) this.hideTip();
    if (this.cur === 'map') this.mapView.tick(dt);
  }
  dispose() { this.unmountCustom(); this.mapView.dispose(); for (const f of this.offs) { try { f(); } catch { /* */ } } this.offs.length = 0; }

  show(id: string | null) {
    const prev = this.cur;
    this.cur = id;
    this.hideTip();
    if (id !== prev) { this.moveGate = true; this.tipMuted = null; }
    this.el.classList.toggle('on', !!id);
    this.setInert(!id);
    this.c.ui.classList.toggle('inmenu', !!id);
    const orb = this.isOrbit(id);
    this.c.ui.classList.toggle('inorbit', orb);
    if (orb && !this.isOrbit(prev)) {
      // the hint is bright for a few seconds after entering the character screens, then settles to a faint label
      this.orbHint.classList.remove('dim'); clearTimeout(this.orbHintT);
      this.orbHintT = window.setTimeout(() => this.orbHint.classList.add('dim'), 6000);
    }
    if (prev === 'map' && id !== 'map') this.mapView.detach();
    if (!id) { this.veil.style.pointerEvents = 'none'; this.unmountCustom(); this.body.textContent = ''; return; }
    const tab = this.c.tabs.get(id);
    if (tab && tab.group === 'char' && !tab.def) { this.lastChar = id; try { localStorage.setItem('l3d.menuTab', id); } catch { /* */ } }
    if (id !== prev) { this.gPick = null; if (id === 'log') this.loadJournal(false); if (id === 'stats' && !this.jList) this.loadJournal(false); }
    if (id === 'pause') this.pauseIdx = 0;
    this.render();
  }

  /** A closed menu must not catch a single click, even while its CSS fade is still pending (slow WebGL frames delay transitions). */
  private setInert(on: boolean) {
    const el = this.el;
    if (on) { el.setAttribute('inert', ''); el.setAttribute('aria-hidden', 'true'); el.style.pointerEvents = 'none'; }
    else { el.removeAttribute('inert'); el.removeAttribute('aria-hidden'); el.style.pointerEvents = ''; }
  }

  /** Re-render the current page (hero changed, etc). Keeps scroll positions. */
  render() {
    const id = this.cur; if (!id) return;
    const sc = Array.from(this.body.querySelectorAll('.scroll')).map((e) => e.scrollTop);
    const tab = this.c.tabs.get(id);
    this.el.classList.toggle('side', !!tab?.orbit);
    this.el.classList.toggle('dim', !tab?.orbit);
    this.el.classList.toggle('pause', id === 'pause');
    this.veil.style.pointerEvents = tab?.orbit ? 'none' : 'auto';
    this.head.style.display = tab ? '' : 'none';
    this.foot.style.display = tab ? '' : 'none';
    this.closeBtn.style.display = id === 'pause' ? 'none' : '';
    if (tab) { this.renderHead(id); this.renderFoot(id); }
    if (tab && tab.def) { this.mountCustom(tab); return; }
    this.unmountCustom();
    let html = '';
    switch (id) {
      case 'gear': html = this.pGear(); break;
      case 'bag': html = this.pBag(); break;
      case 'stats': html = this.pStats(); break;
      case 'log': html = this.pLog(); break;
      case 'pause': html = this.pPause(); break;
      case 'settings': html = this.pSettings(); break;
      case 'help': html = this.pHelp(); break;
      case 'map': html = this.pMap(); break;
      default: html = this.pClassic(id);
    }
    const same = this.body.firstElementChild && (this.body.firstElementChild as HTMLElement).dataset.page === id;
    setHtml(this.body, html);
    if (same) { (this.body.firstElementChild as HTMLElement).style.animation = 'none'; this.body.querySelectorAll('.scroll').forEach((e, i) => { e.scrollTop = sc[i] || 0; }); }
    for (const r of this.body.querySelectorAll<HTMLInputElement>('input[type=range]')) this.paintRange(r);
    if (id === 'map') { const slot = this.body.querySelector<HTMLElement>('.mapslot'); if (slot) this.mapView.attach(slot); }
    // the page was rebuilt: keep the hover card only if the pointer is still over the same item
    if (this.hoverUid && this.cur) {
      const u = CSS.escape(this.hoverUid);
      const el = this.body.querySelector<HTMLElement>(`.slot[data-uid="${u}"], .cell[data-uid="${u}"]`);
      if (el && this.hoverUid !== this.tipMuted && this.pointerOver(el)) this.showTip(el); else this.hideTip();
    }
  }
  private pointerOver(el: HTMLElement): boolean {
    if (this.px < 0) return false;
    const t = this.c.shadow.elementFromPoint(this.px, this.py);
    return !!t && el.contains(t);
  }

  /* ------------------------------------------------------------ feature tabs (ui.addTab) */
  private mountCustom(tab: TabEntry) {
    const cur = this.custom;
    if (cur && cur.id === tab.id && cur.def === tab.def && cur.el.isConnected) return;   // already mounted: features re-render themselves
    this.unmountCustom();
    setHtml(this.body, `<div class="page p-custom${tab.orbit ? ' p-side' : ''}" data-page="${esc(tab.id)}">${this.pan('', esc(tab.name), '<div class="scroll cbody"></div>')}</div>`);
    const el = this.body.querySelector<HTMLElement>('.cbody')!;
    let off: (() => void) | null = null;
    try { const r = tab.def!.render(el, this.gameCtx()); if (typeof r === 'function') off = r; }
    catch (e) { console.warn('[legion-3d] menu tab render failed', tab.id, e); setHtml(el, '<div class="empty-card"><span><span class="big">🐾</span>Эта вкладка сейчас не открывается.</span></div>'); }
    this.custom = { id: tab.id, def: tab.def, el, off };
  }
  private unmountCustom() {
    const cur = this.custom; if (!cur) return;
    this.custom = null;
    if (cur.off) { try { cur.off(); } catch (e) { console.warn('[legion-3d] menu tab cleanup failed', cur.id, e); } }
  }
  /** GameContext for feature tabs; before main sets one, a minimal stand-in (store, actions, ui). */
  private gameCtx(): GameContext {
    const g = this.c.game(); if (g) return g;
    const c = this.c;
    return { store: c.host.store, actions: c.host.actions, input: c.host.input, ui: { toast: c.toast, open: c.open, prompt: () => {} }, layout: () => c.host.store.layout } as unknown as GameContext;
  }
  /** Tab removed while open → close it. */
  tabRemoved(id: string) { if (this.custom && this.custom.id === id) this.unmountCustom(); }

  private renderHead(id: string) {
    const tabs = this.tabs();
    const g = (grp: string, label: string) => `<div class="grp"><span class="gl">${label}</span>${tabs.filter((t) => t.group === grp).map((t) => `<button type="button" class="tab${t.id === id ? ' on' : ''}" data-act="tab" data-m="${esc(t.id)}">${esc(t.name)}${t.key ? `<span class="hk">${esc(t.key)}</span>` : ''}</button>`).join('')}</div>`;
    setHtml(this.head, `<div class="ribbon"><i class="kc sm qe">Q</i>${g('char', 'Герой')}<span class="sep"></span>${g('world', 'Мир')}<i class="kc sm qe">E</i></div>`);
  }

  private renderFoot(id: string) {
    const H = this.c.host.store.hero;
    const st = H && id !== 'stats' ? ['hp', 'atk', 'mag', 'def'].map((k) => `<span class="st" title="${esc(stLabel(k))}">${statIcon(k)}<b>${k === 'hp' ? `${hpInfo(H).now}/${H.stats.hp}` : H.stats[k]}</b></span>`).join('') : '';
    const money = H ? `<span class="mline">${coinsHtml(H.money)}</span>` : '';
    const extra = id === 'bag' || id === 'gear' ? `<span><i class="kc sm dk">⇧</i>сравнить</span>` : '';
    setHtml(this.foot, `${st}<span class="dv"></span>${money}<span class="dv"></span>${extra}<span><i class="kc sm dk">Q</i><i class="kc sm dk">E</i>вкладки</span><span><i class="kc sm dk">Esc</i>закрыть</span>`);
    for (const s of this.foot.querySelectorAll<SVGElement>('.si')) { s.style.width = '18px'; s.style.height = '18px'; }
  }

  private pan(cls: string, title: string, inner: string, extra = '') {
    return `<div class="pan ${cls}"${extra}><i class="orn tl"></i><i class="orn tr"></i><i class="orn bl"></i><i class="orn br"></i>${title ? `<div class="ptitle">${title}</div>` : ''}${inner}</div>`;
  }

  private lockText(H: Hero | null): string | null {
    if (!H) return 'Герой ещё не загрузился.';
    if (H.ghost) return '👻 Призрак не переодевается — дождись воскрешения.';
    if (H.busy) return '⚔ Идёт бой на стриме — снаряжение менять нельзя. Снять и надеть можно после боя';
    return null;
  }

  /* ------------------------------------------------------------ Снаряжение */
  private pGear(): string {
    const H = this.c.host.store.hero;
    if (!H) return this.pEmpty('gear');
    const pos: Record<string, [number, number]> = { helmet: [50, 11], weapon: [13, 42], shield: [87, 42], armor: [50, 50], trinket: [50, 89] };
    const slots = WEAR_SLOTS.map((s) => {
      const it = equipped(H, s);
      const inner = it ? cellHtml({ it, uids: [it.uid], n: 1 }, H, { act: 'none', small: true }).replace('<button type="button" class="cell', '<span class="cell').replace(/<\/button>$/, '</span>')
        : `<span class="cell empty">${slotSilhouette(s)}</span>`;
      return `<button type="button" class="slot${s === this.gSlot ? ' sel' : ''}" data-act="slot" data-slot="${s}" style="left:${pos[s][0]}%;top:${pos[s][1]}%"${it ? ` data-uid="${esc(it.uid)}"` : ''}>${inner}<span class="sl">${SLOT_NAME[s]}${it && it.en ? ` +${it.en}` : ''}</span></button>`;
    }).join('');
    const medals = earnedMedals(H);
    const medHtml = '<div class="gear-medals" aria-label="Медали">' + (medals.length ? medals.slice(0, 3).map((m, i) => '<span title="' + esc(m.name) + '" style="--i:' + i + ';left:' + (20 + i*30) + '%">' + esc(m.icon) + '</span>').join('') + (medals.length > 3 ? '<span style="left:91%">+' + (medals.length - 3) + '</span>' : '') : '<small>Пока нет медалей</small>') + '</div>';
    const pen = H.gearPen as any;
    const penHtml = pen && pen.pct ? `<p class="note warn pen">⚠ Надеты вещи другого класса — дебафф −${pen.pct}% ${esc(pen.statName || '')}${Array.isArray(pen.parts) ? '<br>' + pen.parts.map((p: any) => `${esc(p.name)} — ${esc(p.gearName || p.gear || '')}`).join('<br>') : ''}</p>` : '';
    const lock = this.lockText(H);
    const eq = equipped(H, this.gSlot);
    const pick = this.gPick ? H.items.find((x) => x.uid === this.gPick && !x.on) || null : null;
    const show = pick || eq;
    const fits = H.items.filter((x) => !x.on && x.wearable && x.slot === this.gSlot)
      .map((it) => ({ it, d: deltas(it, H) })).sort((a, b) => b.d.score - a.d.score);
    const card = show ? cardHtml(show, H, { full: true, busyText: lock, pending: this.pending })
      : `<div class="empty-card"><span><span class="big">${slotSilhouette(this.gSlot).replace('class="art sil"', 'class="art sil" style="width:72px;height:72px;opacity:.25"')}</span>Слот «${SLOT_NAME[this.gSlot]}» пуст.<br>Выбери вещь ниже, чтобы надеть.</span></div>`;
    const back = pick && eq ? `<button type="button" class="btn ghost sm" data-act="unpick" style="align-self:flex-start;margin-bottom:10px">← К надетому: ${esc(eq.name)}</button>` : '';
    const list = fits.length ? `<div class="fits">${fits.map(({ it }) => cellHtml({ it, uids: [it.uid], n: 1 }, H, { act: 'pick', sel: it.uid === this.gPick, small: true })).join('')}</div>`
      : `<p class="mut" style="margin:0;font-weight:700;font-size:12.5px">В сумке нет вещей для этого слота.</p>`;
    const busyIc = H.busy || H.ghost ? ` <span title="${esc(lock || '')}" style="display:inline-block;width:18px;height:18px;vertical-align:-3px">${statIcon(H.ghost ? 'ghost' : 'lock', 'si')}</span>` : '';
    return `<div class="page p-gear" data-page="gear">${this.pan('', 'Снаряжение', `
      <div class="dollc"><div class="who"><b>${esc(H.name)}</b><span class="lvl">Ур. ${H.level}</span>${busyIc}<div class="cls">${esc(roleTitle(H))}${H.soc ? ` · <span class="emo">${esc(H.soc.icon)}</span> ${esc(H.soc.rankName)}` : ''}</div></div>
        <div class="doll"><div class="ring"></div>${medHtml}<svg class="figure" viewBox="0 0 92 120" aria-hidden="true"><path d="M22 34 L28 8 L42 26 Q46 25 50 26 L64 8 L70 34 Q80 46 80 64 L80 92 Q80 114 46 114 Q12 114 12 92 L12 64 Q12 46 22 34 Z" fill="#ffcf6a" opacity=".16"/><circle cx="34" cy="56" r="5" fill="#ffcf6a" opacity=".3"/><circle cx="58" cy="56" r="5" fill="#ffcf6a" opacity=".3"/></svg>${slots}</div>${penHtml}</div>
      <div class="det"><button type="button" class="btn ghost sm" data-gear-snapshot>📸 Снимок</button>${back}<div class="scroll">${card}<div class="h3">Подходит в слот <span class="mut">${fits.length}</span></div>${list}</div></div>`)}</div>`;
  }

  /* ------------------------------------------------------------ Сумка */
  private bagCellsFiltered(H: Hero | null): Cell[] {
    const all = bagCells(H);
    return this.bFilter === 'all' ? all : all.filter((c) => catOf(c.it) === this.bFilter);
  }
  private pBag(): string {
    const H = this.c.host.store.hero;
    if (!H) return this.pEmpty('bag');
    const all = bagCells(H), cells = this.bagCellsFiltered(H);
    const cats = new Map<string, number>(); for (const c of all) cats.set(catOf(c.it), (cats.get(catOf(c.it)) || 0) + c.n);
    if (this.bFilter !== 'all' && !cats.has(this.bFilter)) this.bFilter = 'all';
    const filters = CAT_ORDER.filter((k) => k === 'all' || cats.has(k)).map((k) => `<button type="button" class="fl${k === this.bFilter ? ' on' : ''}" data-act="filter" data-f="${k}">${CAT_NAME[k]}<i>${k === 'all' ? all.reduce((a, c) => a + c.n, 0) : cats.get(k)}</i></button>`).join('');
    const sg = H.sg as { cap: number; used: number } | undefined;
    const used = sg ? +sg.used : H.items.filter((x) => !x.on).length;
    const cap = sg ? Math.min(60, +sg.cap) : 0;
    if (this.bSel && !cells.some((c) => c.uids.includes(this.bSel!))) this.bSel = null;
    if (!this.bSel && cells.length) this.bSel = cells[0].it.uid;
    this.bIdx = cells.findIndex((c) => c.uids.includes(this.bSel || ''));
    let grid = cells.map((c, i) => cellHtml(c, H, { sel: i === this.bIdx, idx: i })).join('');
    const free = this.bFilter === 'all' ? (cap ? Math.max(0, cap - used) : Math.max(0, 28 - cells.length)) : 0;
    for (let i = 0; i < free; i++) grid += cellHtml(null, H);
    const full = sg && used >= cap ? `<p class="note amber">Сумка полна (${used} / ${cap}) — новые вещи не поместятся. Освободи место или отнеси вещи на Склад.</p>` : '';
    const sortBtn = sg && !H.ghost && !H.busy ? `<button type="button" class="btn ghost sm" data-act="sort">⇅ Разложить</button>` : '';
    const sel = cells[this.bIdx];
    const card = sel ? cardHtml(sel.it, H, { full: true, n: sel.n, busyText: sel.it.wearable ? this.lockText(H) : H.ghost && edible(sel.it) ? 'Призраку еда не поможет.' : null, pending: this.pending, forceCompare: this.shift })
      : `<div class="empty-card"><span><span class="big">🎒</span>Здесь пусто.</span></div>`;
    return `<div class="page p-bag" data-page="bag">
      ${this.pan('gridp', 'Сумка', `<div class="bagh"><span class="cap">${used}${cap ? `<small> / ${cap}</small>` : ' <small>вещей</small>'}</span>${cap ? `<span class="capbar"><i style="width:${Math.min(100, used / cap * 100)}%"></i></span>` : '<span style="flex:1"></span>'}${sortBtn}</div>
        <div class="filters">${filters}</div>${full}<div class="scroll"><div class="grid" role="grid" aria-label="Сумка">${grid}</div></div>`)}
      ${this.pan('cardp', '', `<div class="scroll">${card}</div>`)}</div>`;
  }

  /* ------------------------------------------------------------ Характеристики */
  private pStats(): string {
    const H = this.c.host.store.hero;
    if (!H) return this.pEmpty('stats');
    const hp = hpInfo(H), xp = xpInfo(H), pen = H.gearPen as any;
    const box = (k: string) => {
      const lab = stLabel(k), v = H.stats[k];
      const full = pen && pen.stat === k && pen.full ? `<s title="Без дебаффа: ${pen.full}">${pen.full}</s>` : '';
      return `<div class="sbox" title="${esc(ST_HELP[k] || '')}">${statIcon(k)}<b>${full}${v}</b><span>${esc(lab)}</span></div>`;
    };
    const xs = H.xs ? `<div class="h3">Боевые характеристики</div><div class="xsgrid">${XS_KEYS.map((k) => {
      const v = (H.xs as any)[k] ?? 0;
      const val = k === 'critDmg' && (H.xs as any).critX != null ? '×' + num((H.xs as any).critX) : num(v) + (XPCT[k] ? '%' : '');
      return `<div class="xsi" title="${esc(ST_HELP[k] || '')}">${statIcon(k)}<b>${val}</b><span>${XS_LABEL[k]}</span></div>`;
    }).join('')}</div>` : '';
    const parts = moneyParts(H.money, 0, coinStyle());
    const cs = coinStyle();
    const money = parts.map(([k, v, t]) => `<span class="mp">${cs && cs.svg ? `<i class="coin svg">${cs.svg(k, 18)}</i>` : `<i class="coin ${k}"></i>`}<b>${v}</b> ${esc(t)}</span>`).join(' ');
    const debt = +(H.debt as number) > 0 ? `<div class="mline debt" style="margin-top:8px">Долг: −${esc(moneyParts(+(H.debt as number), 0, cs).map(([, v, t]) => `${v} ${t}`).join(' '))}</div>` : '';
    const ghost = H.ghost ? `<p class="note warn">👻 Пал в Походе${+(H.deadUntil || 0) > Date.now() ? ` · до воскрешения <b>${plainCountdown(+(H.deadUntil || 0))}</b>` : ''}. Раньше — свиток воскрешения.</p>` : '';
    const s = H.soc;
    const last = this.jList ? this.jList.slice(0, 3) : null;
    const jl = last == null ? `<p class="mut" style="margin:0">Загружаю…</p>` : last.length ? `<ul class="jl">${last.map((e) => this.jRow(e)).join('')}</ul>` : `<p class="mut" style="margin:0">Записей пока нет.</p>`;
    return `<div class="page p-stats" data-page="stats">${this.pan('', 'Характеристики', `<div class="scroll">
      <div class="shead"><div class="medal"><span class="ears"></span><span class="lv">${H.level}</span><span class="lvt">Ур.</span></div>
        <div class="nm"><b>${esc(H.name)}</b><div>«${esc(roleTitle(H))}» · Уровень ${H.level}</div></div>
        ${s ? `<div class="soc"><span class="chip click${s.bad ? ' bad' : ''}" data-act="tab" data-m="legion"><span class="emo">${esc(s.icon)}</span>${esc(s.rankName)} · ${s.score}</span><small>место ${s.place} из ${s.total.toLocaleString('ru-RU')}</small></div>` : ''}</div>
      <div class="sbars"><span>Опыт</span><div class="bar xp"><i class="fill" style="width:calc(${(xp.pct * 100).toFixed(1)}% - 4px)"></i><span class="t">${xp.xneed == null ? 'максимум' : `${xp.xin} / ${xp.xneed}`}</span></div>
        <span>Здоровье</span><div class="bar hp${hp.pct < 0.3 ? ' low' : ''}${H.ghost ? ' dead' : ''}"><i class="fill" style="width:calc(${(hp.pct * 100).toFixed(1)}% - 4px)"></i><span class="t">${hp.now} / ${hp.max}</span></div></div>
      ${ghost}
      <div class="sgrid">${['hp', 'atk', 'mag', 'def'].map(box).join('')}</div>
      ${pen && pen.pct ? `<p class="note warn">⚠ Надеты вещи другого класса — ${esc(pen.statName || '')} −${pen.pct}%</p>` : ''}
      ${xs}
      <div class="h3">Монеты</div><div class="mline">${money}</div>${debt}
      <div class="h3">Последнее в журнале <span class="mut">· <a data-act="tab" data-m="log" style="cursor:pointer;color:var(--l3d-gold)">весь журнал (J)</a></span></div>${jl}
    </div>`)}</div>`;
  }

  /* ------------------------------------------------------------ Журнал */
  async loadJournal(more: boolean) {
    if (this.jLoading) return;
    const tab = this.jTab;
    this.jLoading = true; if (!more) { this.jErr = false; if (this.jFor !== tab) this.jList = null; }
    if (this.cur === 'log') this.render();
    try {
      const q = '/api/journal?tab=' + encodeURIComponent(tab) + (more && this.jNext != null ? '&before=' + encodeURIComponent(String(this.jNext)) : '');
      const r = await this.c.host.actions.get<{ ok: boolean; list?: JEntry[]; next?: unknown }>(q);
      if (tab !== this.jTab) return;
      if (!r || !r.ok) { if (!more) this.jErr = true; }
      else {
        const list = r.list || [];
        if (more && this.jList) { const ids = new Set(this.jList.map((e) => e.id)); this.jList = this.jList.concat(list.filter((e) => !ids.has(e.id))).slice(0, 300); }
        else this.jList = list.slice(0, 300);
        this.jNext = r.next ?? null; this.jFor = tab;
      }
    } catch { if (!more) this.jErr = true; }
    finally { this.jLoading = false; if (this.cur === 'log' || this.cur === 'stats') this.render(); }
  }
  private jRow(e: JEntry): string {
    const [ic] = e.k === 'boss' ? jkBoss(this.c.host.store.quest) : JK[e.k] || ['✦', ''];
    const rk = e.r ? ((JRK[e.k] && JRK[e.k][e.r]) ?? JR[e.r] ?? '') : '';
    const d = new Date(e.at);
    const tm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    const cs = coinStyle();
    const coins = e.c ? `<span class="${e.c > 0 ? 'win' : 'lose'}">${e.c > 0 ? '+' : '−'}${esc(moneyParts(Math.abs(e.c), Math.abs(e.c), cs).map(([, v, t]) => `${v} ${t}`).join(' '))}</span>` : '';
    return `<li class="je" title="${esc(timeAgo(e.at))}"><span class="ji emo">${ic}</span><time>${tm}</time><span>${esc(e.t)}</span><span class="jr">${rk ? `<span class="${e.r}">${rk}</span>` : ''}${coins}${e.x ? `<span class="xp">+${e.x} опыта</span>` : ''}</span></li>`;
  }
  private pLog(): string {
    const tabs = JT.map(([k, n]) => `<button type="button" class="fl${k === this.jTab ? ' on' : ''}" data-act="jtab" data-f="${k}">${n}</button>`).join('');
    let inner: string;
    if (this.jErr) inner = `<div class="empty-card"><span><span class="big">📜</span>Журнал пока не загрузился. Обнови страницу чуть позже.<br><br><button type="button" class="btn ghost sm" data-act="jreload">Попробовать ещё раз</button></span></div>`;
    else if (!this.jList) inner = `<div class="empty-card"><span><span class="big">📜</span>Листаю журнал…</span></div>`;
    else if (!this.jList.length) inner = `<div class="empty-card"><span><span class="big">📜</span>Журнал пуст. Сюда попадут бои, находки, новые вещи, покупки, выигрыши и проигрыши, награды монетами, новые уровни, смерть и воскрешение героя.</span></div>`;
    else {
      const L = this.jList;
      const fight = this.jTab === 'fight';
      const win = L.filter((e) => e.r === 'win').length, lose = L.filter((e) => e.r === 'lose').length;
      const coins = L.reduce((a, e) => a + (+e.c! || 0), 0), xp = L.reduce((a, e) => a + (+e.x! || 0), 0);
      const cs = coinStyle();
      const sum = `<div class="jsum"><span><b>${win}</b> ${fight ? 'побед' : 'удач'}</span><span><b>${lose}</b> ${fight ? 'поражений' : 'неудач'}</span>${coins ? `<span>монеты <b>${coins < 0 ? '−' : '+'}${esc(moneyParts(Math.abs(coins), Math.abs(coins), cs).map(([, v, t]) => `${v} ${t}`).join(' '))}</b></span>` : ''}${xp ? `<span><b>+${xp}</b> опыта</span>` : ''}</div>`;
      let day = '', rows = '';
      const today = new Date().toDateString(), yest = new Date(Date.now() - 864e5).toDateString();
      for (const e of L) {
        const d = new Date(e.at), ds = d.toDateString();
        if (ds !== day) {
          if (day) rows += '</ul>';
          day = ds;
          const label = ds === today ? 'Сегодня' : ds === yest ? 'Вчера' : d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
          rows += `<div class="jday">${label}</div><ul class="jl">`;
        }
        rows += this.jRow(e);
      }
      rows += '</ul>';
      const more = this.jNext != null ? `<div style="text-align:center;margin:14px 0 4px"><button type="button" class="btn ghost sm" data-act="jmore"${this.jLoading ? ' disabled' : ''}>${this.jLoading ? 'Секунду…' : 'Показать ещё'}</button></div>` : '';
      inner = `${sum}<div class="scroll">${rows}${more}</div>`;
    }
    const m = milestones(this.jList || []);
    const timeline = '<section class="milestones"><div class="h3">Вехи <small>среди загруженных записей</small></div>' + (m.length ? m.slice(0, 12).map((x) => '<p>✦ ' + esc(x.label) + ' · ' + esc(new Date(x.at).toLocaleDateString('ru-RU')) + '</p>').join('') : '<p>В загруженных записях пока нет вех.</p>') + '</section>';
    return `<div class="page p-log" data-page="log">${this.pan('', `Журнал${this.jList ? `<small>· ${this.jList.length}</small>` : ''}`, `<div class="filters">${tabs}</div>${timeline}${inner}`)}</div>`;
  }

  /* ------------------------------------------------------------ classic entries */
  private pClassic(id: string): string {
    const d = CLASSIC[id] || { spec: id, title: id, text: '', icon: 'luck' };
    const H = this.c.host.store.hero;
    let summary = '';
    if (id === 'ach') {
      const ac = H && (H.ac as any);
      summary = ac ? `<div class="bigstats"><div class="sbox">${statIcon('crit')}<b>${ac.n ?? (Array.isArray(ac.list) ? ac.list.length : '—')}</b><span>открыто достижений</span></div>${ac.t != null ? `<div class="sbox">${statIcon('luck')}<b>${ac.t}</b><span>всего</span></div>` : ''}</div>` : '<p class="mut">Достижения пока закрыты для этого героя.</p>';
    } else if (id === 'skills') {
      const sk = H && (H.sk as any);
      if (sk && sk.m) {
        summary = `<div class="h3">Мастерство классов</div><ul class="sumlist">${Object.entries(sk.m as Record<string, number[]>).map(([k, v]) => `<li><b>${esc(CLASS_NAME[k] || k)}</b>${k === sk.c ? ' <span class="mut">(текущий)</span>' : ''}<span class="r">ур. ${v[0]} · ${v[1]} / ${v[2]}</span></li>`).join('')}</ul>`
          + (sk.rs != null ? `<p class="note">Сбросов навыков осталось: <b>${sk.rs}</b></p>` : '');
      }
    } else if (id === 'look') {
      const cur = (H && ((H.wardrobe && H.wardrobe.cur) || H.look)) || {};
      const F: Record<string, string> = { shape: 'Форма', color: 'Цвет', color2: 'Второй цвет', eyes: 'Глаза', mouth: 'Рот', hat: 'Шапка', aura: 'Аура', acc: 'Аксессуары' };
      const rows = Object.entries(cur).filter(([k]) => F[k]).map(([k, v]) => `<li><b>${F[k]}</b><span class="r">${esc(Array.isArray(v) ? v.join(', ') : v)}</span></li>`).join('');
      summary = rows ? `<div class="h3">Сейчас надето</div><ul class="sumlist">${rows}</ul>` : '';
    } else if (id === 'legion' || id === 'news') summary = this.remoteSummary(id);
    const alt = d.alt ? `<button type="button" class="btn ghost" data-act="classic" data-spec="${d.alt[0]}">${d.alt[1]}</button>` : '';
    return `<div class="page p-classic${this.isOrbit(id) ? ' p-side' : ''}" data-page="${id}">${this.pan('', d.title, `<div class="scroll">
      <div class="cl-hero"><div class="bigic">${statIcon(d.icon, 'si')}</div><div><h2>${d.title}</h2><p>${d.text}</p>
        <div class="row"><button type="button" class="btn gold" data-act="classic" data-spec="${d.spec}">Открыть в классическом виде</button>${alt}</div></div></div>
      ${summary ? `<div style="margin-top:6px">${summary}</div>` : ''}</div>`)}</div>`;
  }

  private remoteSummary(id: string): string {
    const c = this.sumCache.get(id);
    if (!c || Date.now() - c.at > 60000) {
      if (!c || c.html !== 'loading') {
        this.sumCache.set(id, { at: Date.now(), html: c ? c.html : 'loading' });
        void this.fetchSummary(id);
      }
    }
    const html = this.sumCache.get(id)!.html;
    return html === 'loading' ? '<p class="mut">Загружаю…</p>' : html;
  }
  private async fetchSummary(id: string) {
    let html = '';
    try {
      if (id === 'legion') {
        const r = await this.c.host.actions.get<any>('/api/legion');
        if (r && r.ok) {
          const T = r.total || {};
          const top = (r.top || r.roster || []).slice(0, 8);
          html = `<div class="bigstats"><div class="sbox">${statIcon('people')}<b>${T.heroes ?? '—'}</b><span>героев в Легионе</span></div><div class="sbox">${statIcon('atk')}<b>${T.avgLevel ?? '—'}</b><span>средний уровень</span></div><div class="sbox">${statIcon('ghost')}<b>${T.ghosts ?? '—'}</b><span>призраков</span></div></div>`
            + (Array.isArray(r.groups) && r.groups.length ? `<div class="h3">Состав</div><ul class="sumlist">${r.groups.map((g: any) => `<li><b>${esc(g.name)}</b><span class="r">${g.n}</span></li>`).join('')}</ul>` : '')
            + (top.length ? `<div class="h3">Самые опытные</div><ul class="sumlist">${top.map((v: any, i: number) => `<li><span class="mut">${i + 1}</span><b>${esc(v.name)}</b><span class="r">ур. ${esc(v.level)}${v.role ? ' · ' + esc(CLASS_NAME[v.role] || v.role) : ''}</span></li>`).join('')}</ul>` : '');
        } else html = '<p class="mut">Не удалось загрузить Легион. Обнови страницу чуть позже.</p>';
      } else if (id === 'news') {
        const r = await this.c.host.actions.get<any>('/api/news');
        const list = (r && r.list) || [];
        html = list.length ? `<div class="h3">Свежее</div><ul class="sumlist">${list.slice(0, 8).map((p: any) => `<li><time>${p.at ? new Date(p.at).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' }) : ''}</time><b>${esc(p.title)}</b></li>`).join('')}</ul>` : '<p class="mut">На доске пока пусто.</p>';
      }
    } catch { html = '<p class="mut">Нет связи с сайтом.</p>'; }
    this.sumCache.set(id, { at: Date.now(), html });
    if (this.cur === id) this.render();
  }

  /* ------------------------------------------------------------ Карта */
  private pMap(): string {
    const L = this.c.host.store.layout;
    const name = !L ? 'Город' : L.id === 'fair' ? 'Ярмарка' : 'Город';
    const size = L ? `${Math.round((L.area.x1 - L.area.x0) * 0.01)} × ${Math.round((L.area.y1 - L.area.y0) * 0.02)} м` : '';
    const n = this.c.host.store.walkers.size;
    const legend = `<span><i class="lg me"></i>Ты</span><span><i class="lg pl"></i>Игроки</span><span><i class="lg bd"></i>Здания</span><span><i class="lg st"></i>Лестницы</span><span><i class="lg wa"></i>Канал</span>`;
    const body = L ? `<div class="mapslot"></div>` : `<div class="empty-card"><span><span class="big">🗺️</span>План города ещё загружается.</span></div>`;
    return `<div class="page p-map" data-page="map">${this.pan('', 'Карта', `
      <div class="mhead"><div class="mt"><b>${name}</b><span class="mut">${size}${size ? ' · ' : ''}${n + 1} ${n + 1 === 1 ? 'герой' : 'в городе'}</span></div>
        <div class="legend">${legend}</div>
        <button type="button" class="btn ghost sm" data-act="classic" data-spec="world" title="Карта мира и Похода — в оригинальном окне сайта">Карта мира</button><button type="button" class="btn ghost sm" data-act="tab" data-m="travel" title="Другие города и каналы (L)">Путешествие</button></div>
      ${body}
      <div class="mfoot"><span><b>Тяни</b> — двигать</span><span><b>Колесо</b> — масштаб</span><span><b>Клик по зданию</b> — «Идти сюда»</span><span><b>Двойной клик</b> по улице — идти туда</span></div>`)}</div>`;
  }

  /* ------------------------------------------------------------ pause / settings / help */
  private pauseItems(): [string, string, string][] {
    const q = this.c.host.store.quest;
    const items: [string, string, string][] = [['resume', 'Продолжить', 'Esc'], ['tab:' + this.lastChar, 'Персонаж', 'Tab'], ['tab:map', 'Карта', 'M']];
    if (q && q.on) items.push(['classic:quest', 'Поход', '']);
    for (const t of this.c.tabs.system()) items.push(['tab:' + t.id, t.name, t.key]);
    for (const p of extPauseItems()) items.push(['ext:' + p.id, p.label, p.key || '']);
    items.push(['go:settings', 'Настройки', ''], ['go:help', 'Управление', 'F1'], ['classic-site', 'Классический сайт', 'F8']);
    return items;
  }
  private pPause(): string {
    const items = this.pauseItems();
    return `<div class="page p-pause" data-page="pause"><div class="pausebox"><div class="logo"><b>ЛЕГИОН</b><span>3D · прогулка по городу</span><div class="paws"><i></i><i></i><i></i></div></div>
      <div class="plist">${items.map(([a, t, k], i) => `<button type="button" class="pbtn${i === 0 ? ' first' : ''}${i === this.pauseIdx ? ' focus' : ''}" data-act="pause" data-p="${a}" data-i="${i}">${t}${k ? `<i class="kc sm dk">${k}</i>` : ''}</button>`).join('')}</div>
      <div class="pver">Неофициальное расширение · игра и все правила — на сайте</div></div></div>`;
  }
  private pSettings(): string {
    const s = this.c.settings, cam = this.c.host.getCameraMode();
    const seg = (key: string, cur: unknown, opts: [unknown, string][]) => `<span class="seg">${opts.map(([v, t]) => `<button type="button" data-act="set" data-k="${key}" data-v="${String(v)}" class="${String(v) === String(cur) ? 'on' : ''}">${t}</button>`).join('')}</span>`;
    const rng = (key: string, v: number, min: number, max: number, step: number, fmt: (v: number) => string) => `<span class="rng"><input type="range" data-k="${key}" min="${min}" max="${max}" step="${step}" value="${v}"><b>${fmt(v)}</b></span>`;
    const row = (t: string, sub: string, ctl: string) => `<div class="setrow"><div>${t}${sub ? `<small>${sub}</small>` : ''}</div>${ctl}</div>`;
    return `<div class="page p-set" data-page="settings">${this.pan('', 'Настройки', `<div class="scroll">
      ${row('Камера', 'V — переключить на ходу', seg('cam', cam === 'fp' ? 'fp' : cam === 'tp' ? 'tp' : s.cam, [['fp', '1-е лицо'], ['tp', '3-е лицо']]))}
      ${row('Качество графики', 'Авто подстраивается под частоту кадров', seg('quality', s.quality, [['auto', 'Авто'], [0, 'Картошка'], [1, 'Низкое'], [2, 'Среднее'], [3, 'Высокое']]))}
      ${row('Чувствительность мыши', '', rng('sens', s.sens, 0.2, 3, 0.05, (v) => '×' + num(v)))}
      ${row('Инвертировать Y', '', seg('invertY', s.invertY ? 1 : 0, [[0, 'Нет'], [1, 'Да']]))}
      ${row('Поле зрения', 'Градусы по вертикали', rng('fov', s.fov, 60, 90, 1, (v) => v + '°'))}
      ${row('Имена над головами', '', seg('names', s.names, [['all', 'Все'], ['near', 'Рядом'], ['off', 'Выкл']]))}
      ${row('Пузыри чата', 'Сообщения над головами', seg('bubbles', s.bubbles ? 1 : 0, [[1, 'Вкл'], [0, 'Выкл']]))}
      ${row('Миникарта', 'Круглая карта в углу экрана', seg('minimap', s.minimap ? 1 : 0, [[1, 'Вкл'], [0, 'Выкл']]))}
      ${row('Размер интерфейса', '', rng('uiScale', s.uiScale, 0.9, 1.25, 0.05, (v) => Math.round(v * 100) + '%'))}
      ${this.extRows(row)}
      </div><div class="row" style="justify-content:center;margin-top:16px"><button type="button" class="btn gold" data-act="pause" data-p="go:pause">← Назад</button></div>`)}</div>`;
  }
  /** Rows registered by features (src/ui/settings-ext.ts), grouped under small headings. */
  private extRows(row: (t: string, sub: string, ctl: string) => string): string {
    let out = '', g: string | undefined;
    for (const r of settingRows()) {
      if (r.group && r.group !== g) { g = r.group; out += `<div class="setgroup">${esc(g)}</div>`; }
      const v = readRow(r);
      if (r.kind === 'info') { let t = ''; try { t = r.text(); } catch { t = ''; } out += `<div class="setinfo">${r.label ? `<b>${esc(r.label)}</b> ` : ''}${esc(t)}</div>`; continue; }
      const ctl = r.kind === 'range'
        ? `<span class="rng"><input type="range" data-xk="${esc(r.key)}" min="${r.min}" max="${r.max}" step="${r.step}" value="${v}"><b>${esc(r.fmt ? r.fmt(+v) : String(v))}</b></span>`
        : `<span class="seg">${r.options.map(([ov, t]) => `<button type="button" data-act="xset" data-xk="${esc(r.key)}" data-v="${esc(ov)}" class="${ov === v ? 'on' : ''}">${esc(t)}</button>`).join('')}</span>`;
      out += row(esc(r.label), r.sub ? esc(r.sub) : '', ctl);
    }
    return out;
  }
  private pHelp(): string {
    const K: [string[], string][] = [
      [['W', 'A', 'S', 'D'], 'Идти / шагать вбок'], [['Мышь'], 'Осмотреться'], [['Shift'], 'Бежать'], [['Space'], 'Подпрыгнуть'],
      [['V'], 'Камера: 1-е ⇄ 3-е лицо'], [['Колесо'], 'Приблизить / отдалить'], [['E'], 'Войти / взаимодействовать'],
      [['Tab'], 'Персонаж'], [['C'], 'Снаряжение'], [['I', 'B'], 'Сумка'], [['P'], 'Характеристики'], [['K'], 'Навыки'], [['Y'], 'Достижения'],
      [['J'], 'Журнал'], [['O'], 'Облик'], [['M'], 'Карта'], [['R'], 'Рейтинг Легиона'], [['N'], 'Новости'], [['Q'], 'Поход (во время похода)'],
      [['Enter', 'T'], 'Чат'], [['/'], 'Команда в чат'], [['F1', 'H'], 'Эта подсказка'], [['F2'], 'Спрятать интерфейс'], [['F3'], 'Счётчик кадров'],
      [['F8'], 'Классический сайт'], [['F9'], 'Фоторежим'], [['G'], 'Снежок (в новогодние дни)'], [['Esc'], 'Закрыть / пауза'], [['Q', 'E'], 'В меню: соседние вкладки'], [['⇧'], 'В сумке: сравнить с надетым'],
    ];
    for (const t of this.c.tabs.all()) if (t.def && t.key) K.push([[t.key], t.name]);
    return `<div class="page p-help" data-page="help">${this.pan('', 'Управление', `<div class="scroll"><div class="keys">${K.map(([ks, t]) => `<div><span class="kk">${ks.map((k) => `<i class="kc sm dk">${esc(k)}</i>`).join('')}</span><span>${t}</span></div>`).join('')}</div></div>
      <div class="row" style="justify-content:center;margin-top:16px"><button type="button" class="btn gold" data-act="pause" data-p="resume">Понятно</button></div>`)}</div>`;
  }
  private pEmpty(id: string) {
    return `<div class="page p-stats" data-page="${id}">${this.pan('', 'Герой', '<div class="empty-card"><span><span class="big">🐾</span>Героя пока нет — он появится, когда ты напишешь в чат на стриме.</span></div>')}</div>`;
  }

  /* ------------------------------------------------------------ events */
  private onClick(e: MouseEvent) {
    const t = (e.target as HTMLElement).closest<HTMLElement>('[data-act]');
    if (!t || t.hasAttribute('disabled')) return;
    const a = t.dataset.act!;
    switch (a) {
      case 'close': this.c.open(null); break;
      case 'tab': this.c.open(t.dataset.m!); break;
      case 'slot': this.gSlot = t.dataset.slot!; this.gPick = null; this.render(); break;
      case 'pick': this.gPick = t.dataset.uid!; this.render(); break;
      case 'unpick': this.gPick = null; this.render(); break;
      case 'sel': this.bSel = t.dataset.uid!; this.render(); break;
      case 'filter': this.bFilter = t.dataset.f!; this.bSel = null; this.render(); break;
      case 'equip': void this.act(t.dataset.uid!, () => this.c.host.actions.equip(t.dataset.uid!), 'equip'); break;
      case 'unequip': void this.act(t.dataset.slot!, () => this.c.host.actions.unequip(t.dataset.slot!), 'unequip'); break;
      case 'use': void this.act(t.dataset.uid!, () => this.c.host.actions.use(t.dataset.uid!), 'use'); break;
      case 'sort': void this.act('sort', () => this.c.host.actions.post<ApiResult>('/api/stSort', { box: 'b' }), 'sort'); break;
      case 'jtab': this.jTab = t.dataset.f!; this.jNext = null; void this.loadJournal(false); break;
      case 'jmore': void this.loadJournal(true); break;
      case 'jreload': void this.loadJournal(false); break;
      case 'classic': this.c.open(null); this.c.host.actions.openSitePanel(t.dataset.spec!); break;
      case 'pause': this.pauseAct(t.dataset.p!); break;
      case 'set': this.setFrom(t.dataset.k!, t.dataset.v!); break;
      case 'xset': { const r = settingRow(t.dataset.xk!); if (r) { writeRow(r, t.dataset.v!); this.render(); } break; }
    }
  }
  private onDbl(e: MouseEvent) {
    const t = (e.target as HTMLElement).closest<HTMLElement>('.cell[data-uid], .slot[data-uid]');
    if (!t) return;
    if (t.classList.contains('slot')) { const s = t.dataset.slot!; void this.act(s, () => this.c.host.actions.unequip(s), 'unequip'); return; }
    this.primary(t.dataset.uid!);
  }
  private onOver(e: MouseEvent) {
    const t = (e.target as HTMLElement).closest<HTMLElement>('.cell[data-uid], .slot[data-uid]');
    if (!t || t.closest('.card')) return;
    if (t.dataset.uid === this.tipMuted || this.moveGate) return;
    this.showTip(t);
  }
  private showTip(el: HTMLElement) {
    const H = this.c.host.store.hero; if (!H) return;
    const uid = el.dataset.uid!; const it = H.items.find((x) => x.uid === uid); if (!it) return;
    this.hoverUid = uid; this.hoverEl = el;
    const n = bagCells(H).find((c) => c.uids.includes(uid))?.n || 1;
    setHtml(this.tip, cardHtml(it, H, { n, forceCompare: this.shift }));
    this.tip.style.setProperty('--rc', rarOf(it.rarity).color);
    const k = this.c.scale || 1, r0 = el.getBoundingClientRect(), R0 = this.c.ui.getBoundingClientRect();
    const r = { left: (r0.left - R0.left) / k, right: (r0.right - R0.left) / k, top: (r0.top - R0.top) / k }, W = R0.width / k, Hh = R0.height / k;
    const tw = 300, th = this.tip.offsetHeight || 260;
    let x = r.right + 12; if (x + tw > W - 8) x = r.left - tw - 12;
    // bag grid / gear list: show the tooltip beside the panel (over the 3D view) so it never hides other cells
    const pan = el.closest('.pan');
    if (pan) { const p0 = pan.getBoundingClientRect(); const pl = (p0.left - R0.left) / k; if (pl - tw - 22 > 8) x = pl - tw - 22; }
    let y = r.top - 8; if (y + th > Hh - 8) y = Hh - th - 8; if (y < 8) y = 8;
    this.tip.style.left = x + 'px'; this.tip.style.top = y + 'px';
    this.tip.classList.add('on');
  }
  hideTip() { this.hoverUid = null; this.hoverEl = null; this.tip.classList.remove('on'); }
  get tipOpen() { return this.tip.classList.contains('on'); }
  setShift(on: boolean) {
    if (on === this.shift) return; this.shift = on;
    if (this.hoverEl && this.hoverEl.isConnected) this.showTip(this.hoverEl);
    if (this.cur === 'bag') this.render();
  }
  private onInput(e: Event) {
    const r = e.target as HTMLInputElement; if (r.type !== 'range') return;
    if (r.dataset.xk) {
      const x = settingRow(r.dataset.xk); if (!x || x.kind !== 'range') return;
      const xv = parseFloat(r.value); writeRow(x, xv);
      r.parentElement!.querySelector('b')!.textContent = x.fmt ? x.fmt(xv) : String(xv);
      this.paintRange(r); return;
    }
    const k = r.dataset.k as keyof UiSettings, v = parseFloat(r.value);
    saveSetting(this.c.settings, k, v as never);
    const b = r.parentElement!.querySelector('b')!;
    b.textContent = k === 'fov' ? v + '°' : k === 'uiScale' ? Math.round(v * 100) + '%' : '×' + num(v);
    this.paintRange(r);
    if (k === 'uiScale') this.c.applyScale();
  }
  private paintRange(r: HTMLInputElement) { const p = (parseFloat(r.value) - +r.min) / (+r.max - +r.min) * 100; r.style.setProperty('--p', p + '%'); }
  private setFrom(k: string, v: string) {
    const S = this.c.settings, host = this.c.host;
    if (k === 'cam') { saveSetting(S, 'cam', v as 'fp' | 'tp'); host.setCameraMode(v as 'fp' | 'tp'); }
    else if (k === 'quality') { const q = v === 'auto' ? 'auto' : (+v as 0 | 1 | 2 | 3); saveSetting(S, 'quality', q); host.setQuality(q); }
    else if (k === 'invertY') saveSetting(S, 'invertY', v === '1');
    else if (k === 'bubbles') saveSetting(S, 'bubbles', v === '1');
    else if (k === 'minimap') saveSetting(S, 'minimap', v === '1');
    else if (k === 'names') saveSetting(S, 'names', v as UiSettings['names']);
    this.render();
  }
  pauseAct(p: string) {
    if (p === 'resume') this.c.open(null);
    else if (p.startsWith('tab:') || p.startsWith('go:')) this.c.open(p.split(':')[1]);
    else if (p.startsWith('classic:')) { this.c.open(null); this.c.host.actions.openSitePanel(p.slice(8)); }
    else if (p === 'classic-site') { this.c.open(null); this.c.host.exitToClassic(); }
    else if (p.startsWith('ext:')) { const it = pauseItem(p.slice(4)); this.c.open(null); if (it) setTimeout(() => { try { it.run(); } catch (e) { console.warn('[l3d ui] pause item', e); } }, 0); }
  }

  /** Primary action for an item (Enter / double-click). */
  primary(uid: string) {
    const H = this.c.host.store.hero; if (!H) return;
    const it = H.items.find((x) => x.uid === uid); if (!it) return;
    if (it.wearable) {
      if (this.lockText(H)) { this.c.toast(this.lockText(H)!, true); return; }
      if (it.on) void this.act(String(it.slot), () => this.c.host.actions.unequip(String(it.slot)), 'unequip');
      else void this.act(uid, () => this.c.host.actions.equip(uid), 'equip');
    } else if (edible(it)) void this.act(uid, () => this.c.host.actions.use(uid), 'use');
  }

  private async act(key: string, fn: () => Promise<ApiResult>, kind: string) {
    if (this.pending) return;
    const H = this.c.host.store.hero;
    if ((kind === 'equip' || kind === 'unequip' || kind === 'sort') && this.lockText(H)) { this.c.toast(this.lockText(H)!, true); return; }
    this.pending = key; this.render();
    let it: Item | undefined;
    if (kind === 'equip') it = H?.items.find((x) => x.uid === key);
    try {
      const r = await fn();
      if (!r || !r.ok) this.c.toast((r && r.error) || 'Не получилось — попробуй ещё раз', true);
      else {
        if (kind === 'equip' && it) { this.gSlot = String(it.slot); this.gPick = null; this.popSlot = String(it.slot); }
        if (kind === 'unequip') this.popSlot = key;
        if (kind === 'use' && it == null) { /* toast handled by the site / store */ }
        if (+(r as any).pending > 0 || (r.hero && +(r.hero.pending as number) > 0)) setTimeout(() => this.c.toast('Сохранено — применится, когда игра стримера будет в сети'), 6000);
      }
    } catch { this.c.toast('Нет связи с сайтом', true); }
    finally { this.pending = null; this.render(); this.applyPop(); }
  }
  private popSlot: string | null = null;
  private applyPop() {
    if (!this.popSlot) return;
    const el = this.body.querySelector(`.slot[data-slot="${this.popSlot}"] .cell`); this.popSlot = null;
    if (el) { el.classList.remove('pop'); void (el as HTMLElement).offsetWidth; el.classList.add('pop'); }
  }

  /* ------------------------------------------------------------ keyboard inside menus */
  /** Returns true if handled. */
  key(code: string, e: KeyboardEvent): boolean {
    const id = this.cur!;
    if (id === 'pause') {
      const items = this.pauseItems();
      if (code === 'ArrowDown' || code === 'KeyS') { this.pauseIdx = (this.pauseIdx + 1) % items.length; this.render(); return true; }
      if (code === 'ArrowUp' || code === 'KeyW') { this.pauseIdx = (this.pauseIdx + items.length - 1) % items.length; this.render(); return true; }
      if (code === 'Enter' || code === 'Space') { this.pauseAct(items[this.pauseIdx][0]); return true; }
      return false;
    }
    if (id === 'bag' && /^Arrow/.test(code)) {
      const H = this.c.host.store.hero; const cells = this.bagCellsFiltered(H); if (!cells.length) return true;
      const grid = this.body.querySelector('.grid') as HTMLElement | null;
      const cols = grid ? Math.max(1, getComputedStyle(grid).gridTemplateColumns.split(' ').length) : 5;
      let i = Math.max(0, this.bIdx);
      i += code === 'ArrowRight' ? 1 : code === 'ArrowLeft' ? -1 : code === 'ArrowDown' ? cols : -cols;
      i = Math.max(0, Math.min(cells.length - 1, i));
      this.bSel = cells[i].it.uid; this.render();
      const el = this.body.querySelector('.cell.sel') as HTMLElement | null; el?.scrollIntoView({ block: 'nearest' });
      return true;
    }
    if (id === 'gear' && /^Arrow/.test(code)) {
      const order = ['helmet', 'weapon', 'armor', 'shield', 'trinket'];
      const i = order.indexOf(this.gSlot);
      this.gSlot = order[(i + (code === 'ArrowRight' || code === 'ArrowDown' ? 1 : order.length - 1)) % order.length]; this.gPick = null; this.render();
      return true;
    }
    if (code === 'Enter') {
      if (id === 'bag' && this.bSel) { this.primary(this.bSel); return true; }
      if (id === 'gear') { const H = this.c.host.store.hero; const uid = this.gPick || equipped(H, this.gSlot)?.uid; if (uid) this.primary(uid); return true; }
    }
    void e;
    return false;
  }
}
