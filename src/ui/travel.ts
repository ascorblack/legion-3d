/**
 * «Путешествие» — a menu page (Shadow DOM, the game's own look) with two tabs:
 *   Города   the towns the site's town picker offers (Ярмарка, the camp, district towns) — click = travel there;
 *   Каналы   the own list of channels + a streamer search — pick = «Перейти на канал?» → the channel's page.
 * No requests of its own until it is used: the towns list is read when the page opens (GET /api/city/towns, the same
 * read as the site's picker), the own list when «Каналы» opens (GET /api/mylist), a search request only after typing
 * (≥ 2 characters, debounced, older one aborted — src/net/travel.ts). Everything else goes through `TravelPanelDeps`
 * (src/features/travel.ts), so the page itself never touches the site.
 */
import { townsView, campName, CAMP, FAIR, type TownRow, type TownsView } from '../net/town';
import type { HeroTownFlags } from '../net/town';
import { FindController, parseChannels, FIND_MAX_LEN, type Channel, type FindDeps, type FindState } from '../net/travel';
import { setHtml } from '../core/html';

export interface TravelPanelDeps {
  /** Hotkey label shown in the footer ('L'). */
  hotkey: string;
  /** GET /api/city/towns → the raw answer (`{ ok, list, … }`) or null. */
  towns(force?: boolean): Promise<unknown>;
  /** GET /api/mylist → the raw answer or null. */
  list(): Promise<unknown>;
  fetchFind: FindDeps['fetchFind'];
  hero(): HeroTownFlags | null;
  currentTown(): string;
  style(): string;
  names(): unknown;
  /** Login of the channel of this page. */
  channel(): string;
  /** Why travelling is impossible right now (in a building, the site's switch is missing…), or null. */
  lock(): string | null;
  travel(row: TownRow): void;
  openChannel(c: Channel, viaSearch: boolean): void;
  debounceMs?: number;
}

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
const hue = (login: string) => { let h = 2166136261; for (let i = 0; i < login.length; i++) h = Math.imul(h ^ login.charCodeAt(i), 16777619); return (h >>> 0) % 360; };

export const TRAVEL_CSS = `
[data-page="travel"] .pan { bottom: auto; max-height: calc(100% - 24px); display: flex; flex-direction: column; }
.tv { display: flex; flex-direction: column; gap: 14px; min-height: 0; font: 600 13px/1.4 var(--l3d-tx); color: var(--l3d-ink); }
.tv * { box-sizing: border-box; } .tv [hidden] { display: none !important; }
.tv button { font-family: inherit; }
.tv-body { display: flex; flex-direction: column; gap: 12px; }
.tv-top { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 10px 16px; }
.tv-here { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 10px; color: var(--l3d-mute); }
.tv-here b { color: var(--l3d-gold); font: 700 17px/1.2 var(--l3d-hd); }
.tv-here .ch { color: var(--l3d-ink); }
.tv-lock { padding: 9px 14px; border-radius: 12px; background: #ffcf6a1c; box-shadow: inset 0 0 0 1.5px #ffcf6a55; color: #ffe9a8; }
.tv-err { padding: 12px 14px; border-radius: 12px; background: #ff8f8f18; box-shadow: inset 0 0 0 1.5px #ff8f8f55; color: #ffc9c9; display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.tv-grid { display: grid; grid-auto-rows: 1fr; grid-template-columns: repeat(auto-fill, minmax(250px, 1fr)); gap: 14px; }
.tv-town { position: relative; display: flex; align-items: stretch; gap: 13px; text-align: left; padding: 18px 19px; min-height: 148px; border-radius: 18px; border: 0; cursor: pointer; color: var(--l3d-ink);
  background: linear-gradient(160deg, color-mix(in srgb, var(--l3d-panel) 92%, #fff 8%), var(--l3d-panel-2)); box-shadow: inset 0 0 0 1.5px var(--line), 0 3px 0 #0006; transition: transform .14s var(--ease), box-shadow .14s var(--ease); }
.tv-town:hover:not([disabled]) { transform: translateY(-2px); box-shadow: inset 0 0 0 2px var(--l3d-gold), 0 6px 0 #0006; }
.tv-town:active:not([disabled]) { transform: translateY(1px); }
.tv-town:focus-visible, .tv-ch .btn:focus-visible, .tv-q input:focus-visible, .tv-tabs button:focus-visible { outline: 3px solid var(--l3d-gold); outline-offset: 2px; }
.tv-town .ic { flex: none; align-self: flex-start; width: 62px; height: 62px; border-radius: 20px; display: grid; place-items: center; font-size: 34px; background: #00000038; box-shadow: inset 0 0 0 1px #ffffff14; }
.tv-town .tx { min-width: 0; flex: 1; display: flex; flex-direction: column; gap: 3px; }
.tv-town b { font: 700 17px/1.2 var(--l3d-hd); }
.tv-town small { color: #d9c9d2; font: 600 12.5px/1.4 var(--l3d-tx); }
.tv-town .go { margin-top: auto; padding-top: 5px; align-self: flex-start; }
.tv-town .go i { display: inline-block; font: 800 11px/1 var(--l3d-tx); font-style: normal; letter-spacing: .05em; text-transform: uppercase; padding: 6px 11px; border-radius: 999px; color: #2a1d18; background: linear-gradient(#ffe7a6, var(--l3d-gold)); }
.tv-town.cur { cursor: default; box-shadow: inset 0 0 0 2px var(--l3d-gold), 0 0 22px #ffcf6a30, 0 3px 0 #0006; }
.tv-town.cur .go i { color: var(--l3d-gold); background: #ffcf6a1f; box-shadow: inset 0 0 0 1.5px #ffcf6a77; }
.tv-town.off { cursor: not-allowed; filter: grayscale(.75); opacity: .62; }
.tv-town.off .go i { color: #d9c9d2; background: #ffffff14; }
.tv-town .why { color: #ffc9a0; }
.tv-note { margin-top: 4px; color: #d9c9d2; font: 600 12.5px/1.5 var(--l3d-tx); }
.tv-q { display: flex; gap: 8px; }
.tv-q input { flex: 1; min-width: 0; height: 40px; padding: 0 16px; border: 0; border-radius: 999px; background: #00000040; color: var(--l3d-ink); font: 700 14px/1 var(--l3d-tx); box-shadow: inset 0 0 0 1.5px var(--line); }
.tv-q input::placeholder { color: var(--l3d-mute); font-weight: 600; }
.tv-h { margin: 8px 0 2px; font: 800 12px/1 var(--l3d-tx); letter-spacing: .08em; text-transform: uppercase; color: #dcc9d3; }
.tv-list { display: flex; flex-direction: column; gap: 7px; margin: 0; padding: 0; list-style: none; }
.tv-ch { display: grid; grid-template-columns: 38px 1fr auto; gap: 12px; align-items: center; padding: 8px 10px 8px 8px; border-radius: 16px; background: var(--l3d-panel-2); box-shadow: inset 0 0 0 1.5px var(--line); }
.tv-ch.cur { box-shadow: inset 0 0 0 2px var(--l3d-gold); }
.tv-ch .av { width: 38px; height: 38px; border-radius: 13px; display: grid; place-items: center; font: 700 17px/1 var(--l3d-hd); color: #1d1620; text-transform: uppercase; }
.tv-ch .nm { min-width: 0; display: flex; flex-wrap: wrap; align-items: center; gap: 4px 8px; }
.tv-ch .nm b { font: 700 14px/1.2 var(--l3d-tx); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 100%; }
.tv-tag { font: 800 11.5px/1 var(--l3d-tx); padding: 5px 9px; border-radius: 999px; background: #ffffff1c; color: #e6d6df; }
.tv-tag.live { color: #1d1620; background: var(--l3d-up); }
.tv-tag.hero { color: #10202b; background: #8fd3ff; }
.tv-tag.pin { color: #2a1d18; background: var(--l3d-accent); }
.tv-confirm { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 10px 16px; padding: 14px 18px; border-radius: 16px; color: #2a1d18; font: 700 14px/1.4 var(--l3d-tx); background: linear-gradient(#ffe7a6, var(--l3d-gold)); box-shadow: 0 4px 0 var(--l3d-gold-d), 0 0 26px #ffcf6a40; }
.tv-confirm .btn.gold { color: #fff4e0; background: linear-gradient(#4a3a55, #2a2030); box-shadow: 0 3px 0 #0008, inset 0 0 0 1.5px #fff4e066; }
.tv-confirm .btn.ghost { color: #2a1d18; box-shadow: inset 0 0 0 2px #2a1d1866; }
.tv-confirm > span:first-child { flex: 1 1 260px; }
.tv-confirm .btns { display: flex; gap: 8px; margin-left: auto; }
.tv-ch.sel { box-shadow: inset 0 0 0 2px var(--l3d-gold); background: #ffcf6a1c; }
.tv-tag.sel { color: #2a1d18; background: var(--l3d-gold); }
.tv-q input::-webkit-search-cancel-button { -webkit-appearance: none; display: none; }
.tv-top .rt { display: flex; align-items: center; gap: 10px; }
.tv-foot { margin-top: 4px; padding-top: 12px; border-top: 1.5px dashed #ffcf6a30; color: #cdbac5; font: 600 12px/1.4 var(--l3d-tx); }
.tv-dots::after { content: '…'; }
@media (prefers-reduced-motion: reduce) { .tv-town { transition: none; } .tv-town:hover:not([disabled]) { transform: none; } }
`;

type Tab = 'towns' | 'channels';

/** Mount the page into `el`; returns the cleanup (aborts a pending search, drops listeners). */
export function mountTravel(el: HTMLElement, d: TravelPanelDeps, start: Tab = 'towns'): () => void {
  let closed = false, tab: Tab = start;
  let towns: TownsView | null = null, townsBusy = false;
  let mine: Channel[] | null = null, mineErr = '', mineBusy = false;
  let confirm: { c: Channel; viaSearch: boolean } | null = null;
  let findState: FindState = { q: '', status: 'idle', list: [], err: '' };
  const find = new FindController({ fetchFind: d.fetchFind, onState: (s) => { findState = s; paintResults(); }, debounceMs: d.debounceMs });

  setHtml(el, `<style>${TRAVEL_CSS}</style><div class="tv" data-tv>
    <div class="tv-top"><div class="tv-here" data-here></div>
      <span class="rt"><button type="button" class="btn ghost sm" data-act="reload" data-rl title="Спросить сайт ещё раз, какие города открыты">Обновить</button><span class="seg tv-tabs" role="tablist" aria-label="Что показать"><button type="button" role="tab" data-tab="towns">Города</button><button type="button" role="tab" data-tab="channels">Каналы</button></span></span></div>
    <div class="tv-body" data-body></div><div class="tv-foot" data-foot></div></div>`);
  const q = <T extends HTMLElement>(s: string) => el.querySelector<T>(s)!;
  const body = q('[data-body]'), here = q('[data-here]'), foot = q('[data-foot]');

  const townName = (id: string) => towns?.rows.find((r) => r.id === id)?.name || (id === FAIR ? 'Ярмарка' : id === CAMP ? campName(d.style(), d.names()).name : id);
  const paintHere = () => {
    const ch = d.channel();
    setHtml(here, `<span>Путешествие · сейчас:</span><b>${esc(townName(d.currentTown()))}</b>${ch ? `<span class="ch">канал <b style="font:700 13px var(--l3d-tx);color:inherit">${esc(ch)}</b></span>` : ''}`);
  };
  const paintTabs = () => {
    for (const b of el.querySelectorAll<HTMLButtonElement>('[data-tab]')) { const on = b.dataset.tab === tab; b.classList.toggle('on', on); b.setAttribute('aria-selected', String(on)); }
    const rl = el.querySelector<HTMLElement>('[data-rl]'); if (rl) rl.hidden = tab !== 'towns';
    foot.textContent = tab === 'towns'
      ? `Переход откроет выбранный город, как кнопка «Города» на сайте. Горячая клавиша: ${d.hotkey}.`
      : 'Список и поиск — те же, что в окне «Стримеры» на сайте. Переход перезагружает страницу.';
  };

  /* ------------------------------------------------------------ towns */
  const paintTowns = () => {
    if (closed || tab !== 'towns') return;
    paintHere();
    const lock = d.lock();
    let h = lock ? `<div class="tv-lock" role="status">${esc(lock)}</div>` : '';
    if (townsBusy && !towns) h += '<p class="tv-note" role="status">Смотрю, какие города открыты<span class="tv-dots"></span></p>';
    else if (towns?.error) h += `<div class="tv-err" role="alert"><span>${esc(towns.error)}</span><button type="button" class="btn ghost sm" data-act="reload">Ещё раз</button></div>`;
    else if (towns) {
      h += `<div class="tv-grid" role="list">${towns.rows.map((r) => {
        const off = r.disabled || !!lock, cur = r.current;
        return `<button type="button" role="listitem" class="tv-town${cur ? ' cur' : ''}${off && !cur ? ' off' : ''}" data-town="${esc(r.id)}"${off || cur ? ' disabled' : ''}${cur ? ' aria-current="true"' : ''} title="${esc(r.reason || r.sub)}">
          <span class="ic" aria-hidden="true">${esc(r.icon)}</span><span class="tx"><b>${esc(r.name)}</b><small>${esc(r.sub)}</small>
          ${r.reason && !cur ? `<small class="why">${esc(r.reason)}</small>` : ''}<span class="go"><i>${cur ? 'ты здесь' : r.disabled ? 'закрыто' : 'в путь'}</i></span></span></button>`;
      }).join('')}</div><div class="tv-note">${esc(towns.note)}</div>`;
    }
    setHtml(body, h);
  };
  const loadTowns = (force = false) => {
    townsBusy = true; if (force) towns = null; paintTowns();
    d.towns(force).then((resp) => { towns = townsView({ resp, hero: d.hero(), current: d.currentTown(), style: d.style(), names: d.names() }); }, () => { towns = { rows: [], note: '', error: 'Список городов не загрузился — попробуй ещё раз.' }; })
      .then(() => { townsBusy = false; paintTowns(); });
  };

  /* ------------------------------------------------------------ channels */
  const rowHtml = (c: Channel, viaSearch: boolean) => {
    const cur = c.login === d.channel(), sel = !!confirm && confirm.c.login === c.login && confirm.viaSearch === viaSearch;
    return `<li class="tv-ch${cur ? ' cur' : ''}${sel ? ' sel' : ''}"><span class="av" style="background:hsl(${hue(c.login)} 62% 74%)" aria-hidden="true">${esc([...c.name][0] || '?')}</span>
      <span class="nm"><b title="${esc(c.name)}">${esc(c.name)}</b>${c.live ? `<span class="tv-tag live">в эфире${c.viewers != null ? ' · ' + c.viewers : ''}</span>` : ''}${c.hero ? '<span class="tv-tag hero" title="Здесь у тебя есть герой">герой</span>' : ''}${c.pinned ? '<span class="tv-tag pin">закреплён</span>' : ''}${cur ? '<span class="tv-tag">этот канал</span>' : ''}</span>
      ${cur ? '' : sel ? '<span class="tv-tag sel" style="justify-self:end">выбран</span>' : `<button type="button" class="btn gold sm" data-ch="${esc(c.login)}" data-via="${viaSearch ? 's' : 'l'}" aria-label="Выбрать канал ${esc(c.name)}">Перейти</button>`}</li>`;
  };
  const paintConfirm = () => {
    const box = el.querySelector<HTMLElement>('[data-confirm]'); if (!box) return;
    setHtml(box, confirm ? `<div class="tv-confirm" role="alertdialog" aria-label="Перейти на канал"><span>Перейти на канал <b>${esc(confirm.c.name)}</b>? Страница перезагрузится, а герой окажется в городе того канала.</span>
      <span class="btns"><button type="button" class="btn gold sm" data-act="yes">Да, перейти</button><button type="button" class="btn ghost sm" data-act="no">Остаться</button></span></div>` : '');
    if (confirm) box.querySelector<HTMLElement>('[data-act="yes"]')?.focus();
  };
  const paintResults = () => {
    if (closed || tab !== 'channels') return;
    const res = el.querySelector<HTMLElement>('[data-res]'); if (!res) return;
    const s = findState, n = s.q.trim().replace(/^@/, '');
    let h = '';
    if (s.status === 'short') h = '<p class="tv-note">Ещё хотя бы одна буква</p>';
    else if (s.status === 'busy') h = '<p class="tv-note" role="status">Ищем<span class="tv-dots"></span></p>';
    else if (s.status === 'error') h = `<p class="tv-note" role="alert">${esc(s.err)}</p>`;
    else if (s.status === 'ok') h = s.list.length ? `<p class="tv-h">Найдено</p><ul class="tv-list">${s.list.map((c) => rowHtml(c, true)).join('')}</ul>` : `<p class="tv-note">Таких стримеров в игре нет${n ? ` («${esc(n)}»)` : ''}</p>`;
    setHtml(res, h);
  };
  const paintMine = () => {
    if (closed || tab !== 'channels') return;
    const box = el.querySelector<HTMLElement>('[data-mine]'); if (!box) return;
    setHtml(box, mineBusy && !mine ? '<p class="tv-note" role="status">Загружаем твой список<span class="tv-dots"></span></p>'
      : mineErr ? `<p class="tv-note" role="alert">${esc(mineErr)}</p>`
        : mine && !mine.length ? '<p class="tv-note">Твой список пуст: найди стримера по нику — после перехода он появится здесь.</p>'
          : mine ? `<p class="tv-h">Мой список</p><ul class="tv-list">${mine.map((c) => rowHtml(c, false)).join('')}</ul>` : '');
  };
  const loadMine = () => {
    if (mine || mineBusy) { paintMine(); return; }
    mineBusy = true; mineErr = ''; paintMine();
    d.list().then((r: any) => {
      if (r && r.ok) mine = parseChannels(r.list); else mineErr = r && r.error === 'unauth' ? 'Войди через Twitch — здесь будут твои каналы.' : 'Список не загрузился — открой «Каналы» ещё раз.';
    }, () => { mineErr = 'Нет связи с сайтом'; }).then(() => { mineBusy = false; paintMine(); });
  };
  const paintChannels = () => {
    if (closed) return;
    paintHere();
    setHtml(body, `<div class="tv-q"><input type="search" data-q maxlength="${FIND_MAX_LEN}" placeholder="Найти стримера по нику" autocomplete="off" spellcheck="false" enterkeyhint="search" aria-label="Найти стримера по нику"></div>
      <div data-confirm></div><div data-res aria-live="polite"></div><div data-mine></div>`);
    const inp = q<HTMLInputElement>('[data-q]');
    inp.value = findState.q;
    inp.addEventListener('input', () => find.input(inp.value));
    paintResults(); paintConfirm(); loadMine();
  };

  const show = (t: Tab) => {
    tab = t; confirm = null; paintTabs();
    if (t === 'towns') { paintTowns(); if (!towns && !townsBusy) loadTowns(); } else paintChannels();
  };

  const onClick = (e: Event) => {
    const t = e.target as HTMLElement | null; if (!t) return;
    const tabBtn = t.closest<HTMLElement>('[data-tab]');
    if (tabBtn) { show(tabBtn.dataset.tab === 'channels' ? 'channels' : 'towns'); return; }
    const town = t.closest<HTMLButtonElement>('[data-town]');
    if (town && !town.disabled) { const row = towns?.rows.find((r) => r.id === town.dataset.town); if (row && !row.disabled && !row.current) d.travel(row); return; }
    const act = t.closest<HTMLElement>('[data-act]')?.dataset.act;
    if (act === 'reload') { loadTowns(true); return; }
    if (act === 'no') { confirm = null; paintConfirm(); paintResults(); paintMine(); return; }
    if (act === 'yes' && confirm) { const c = confirm; confirm = null; paintConfirm(); d.openChannel(c.c, c.viaSearch); return; }
    const ch = t.closest<HTMLElement>('[data-ch]');
    if (ch) {
      const login = ch.dataset.ch!, viaSearch = ch.dataset.via === 's';
      const c = (viaSearch ? findState.list : mine || []).find((x) => x.login === login);
      if (c) { confirm = { c, viaSearch }; paintConfirm(); paintResults(); paintMine(); }
    }
  };
  const onKey = (e: KeyboardEvent) => {
    // Enter in the search box picks the first result (start.js does the same)
    const t = e.target as HTMLElement | null;
    if (t && t.matches?.('[data-q]')) {
      if (e.key === 'Enter') { const first = findState.status === 'ok' ? findState.list.find((c) => c.login !== d.channel()) : null; if (first) { e.preventDefault(); confirm = { c: first, viaSearch: true }; paintConfirm(); paintResults(); } }
    }
  };
  el.addEventListener('click', onClick);
  el.addEventListener('keydown', onKey as EventListener);

  show(start);
  return () => { closed = true; find.dispose(); el.removeEventListener('click', onClick); el.removeEventListener('keydown', onKey as EventListener); };
}
