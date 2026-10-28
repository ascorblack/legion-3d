/**
 * The debug panel (F10 / «🐞 Отладка» in the Esc menu): a Shadow-DOM window styled like the game's menus (src/ui),
 * docked right, with tabs — «Измерение», «Сцены похода», «Мир», «Оверлеи», «Сайт», «Шина». Remembers the last tab
 * (localStorage l3d.debug.tab). Pure view: state comes from PanelApi.state(), clicks go to PanelApi.act().
 * Re-rendered on every action; live numbers (timeline, counters) are patched in place 4× a second.
 */
import type { SectionInfo } from './dimension';
import type { CardInfo } from './dimension';
import { MOCK_GROUPS, QUEST_MOCKS } from './questMocks';
import { SEG_RU } from './scenes';

export interface PanelState {
  dim: { inside: boolean; blocked: string; sections: SectionInfo[]; tod: number; info: string };
  scenes: { playing: string; open: boolean; paused: boolean; speed: number; plan: number; dur: number; segs: [string, number, number][]; kind: string; title: string };
  world: { freecam: boolean; quality: string; level: number; event: string; hwc: string; bots: number; eventMode: string };
  over: { perf: boolean; grid: boolean; wire: boolean };
  site: { version: string; dev: boolean; phase: string; checked: number; fails: { id: string; severity: string; missing: string[] }[]; okIds: string[]; drift: string[]; scripts: string[]; town: string; report: string };
  bus: { on: boolean; present: boolean; rows: [string, number, string][] };
}
export interface PanelApi { state(): PanelState; act(a: string, v?: string): void; close(): void }

export const TABS: [string, string, string][] = [['dim', 'Измерение', '🌀'], ['scenes', 'Поход', '🗺️'], ['world', 'Мир', '🌦️'], ['over', 'Оверлеи', '📊'], ['site', 'Сайт', '🧾'], ['bus', 'Шина', '📡']];
const TAB_KEY = 'l3d.debug.tab';
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const SEG_COL: Record<string, string> = { gather: '#7fd6e6', map: '#b9a2ff', travel: '#8fb6ff', battle: '#ff9a6a', treasure: '#ffcf6a', rest: '#9fe39a', bossgen: '#e0407a', loot: '#fff1a8', off: '#5a5470' };
/** Scene kinds (src/expedition/adapter SceneKind) in Russian. */
export const KIND_LABEL: Record<string, string> = { off: 'нет', gather: 'сбор', vote: 'голосование', travel: 'дорога', battle: 'бой', boss: 'босс', trap: 'ловушка', treasure: 'сокровищница', rest: 'привал', shop: 'лавка', event: 'событие', town: 'город', dungeon: 'данж', lair: 'логово', loot: 'добыча', puzzle: 'головоломка' };
const TOD: [number, string][] = [[0, '🌙 Ночь'], [6, '🌅 Рассвет'], [12, '☀️ День'], [18.5, '🌆 Вечер']];

export class DebugPanel {
  readonly host: HTMLDivElement;
  readonly root: ShadowRoot;
  private win: HTMLDivElement;
  private body: HTMLDivElement;
  private cardEl: HTMLDivElement;
  private cardT = 0;
  tab: string;
  open = false;
  /** Collapsed to the header (to look at a scene). */
  min = false;
  private liveT = 0;
  constructor(parent: HTMLElement, private api: PanelApi) {
    this.host = document.createElement('div'); this.host.id = 'l3d-debug';
    this.host.style.cssText = 'position:fixed;inset:0;z-index:118;pointer-events:none';
    this.root = this.host.attachShadow({ mode: 'open' });
    const st = document.createElement('style'); st.textContent = CSS; this.root.appendChild(st);
    this.win = document.createElement('div'); this.win.className = 'win'; this.win.hidden = true;
    this.win.setAttribute('role', 'dialog'); this.win.setAttribute('aria-label', 'Режим отладки');
    this.body = document.createElement('div'); this.body.className = 'body';
    this.cardEl = document.createElement('div'); this.cardEl.className = 'card'; this.cardEl.hidden = true;
    this.root.append(this.win, this.cardEl);
    let t = 'dim'; try { t = localStorage.getItem(TAB_KEY) || 'dim'; } catch { /* */ }
    this.tab = TABS.some(([id]) => id === t) ? t : 'dim';
    this.win.addEventListener('click', (e) => this.onClick(e));
    this.win.addEventListener('input', (e) => this.onInput(e));
    // keys typed in the panel must not drive the game
    this.win.addEventListener('keydown', (e) => { if (e.code !== 'Escape' && e.code !== 'F10') e.stopPropagation(); });
    this.cardEl.addEventListener('click', (e) => { if ((e.target as HTMLElement).closest('[data-x]')) this.hideCard(); });
    parent.appendChild(this.host);
  }
  /** Where the perf HUD goes (same shadow root, same styles). */
  get overlayRoot(): ShadowRoot { return this.root; }

  show(on: boolean): void {
    this.open = on;
    this.win.hidden = !on;
    if (on) this.render();
  }
  setTab(id: string): void { this.tab = id; try { localStorage.setItem(TAB_KEY, id); } catch { /* */ } this.render(); }

  render(): void {
    if (!this.open) return;
    const s = this.api.state();
    const tabs = TABS.map(([id, t, i]) => `<button type="button" role="tab" aria-selected="${id === this.tab}" class="tab${id === this.tab ? ' on' : ''}" data-tab="${id}"><span class="emo">${i}</span>${t}</button>`).join('');
    this.win.innerHTML = `<div class="hd"><div class="ttl"><span class="emo">🐞</span><b>Отладка</b><small>всё только у тебя в браузере · на сайт ничего не уходит</small></div>
      <span class="hbtn"><button type="button" class="x" data-a="min" aria-label="${this.min ? 'Развернуть' : 'Свернуть'}" title="${this.min ? 'Развернуть' : 'Свернуть'}">${this.min ? '▾' : '▴'}</button><button type="button" class="x" data-a="close" aria-label="Закрыть">✕</button></span></div><div class="tabs" role="tablist">${tabs}</div>`;
    this.body.innerHTML = this.tabHtml(s);
    this.win.appendChild(this.body);
    this.win.insertAdjacentHTML('beforeend', `<div class="ft"><span><i class="kc">F10</i> панель</span><span><i class="kc">Esc</i> закрыть</span><span>прицел + <i class="kc">E</i>/<i class="kc">F</i> — карточка</span></div>`);
  }

  /** 4 Hz: patch live values without re-rendering (sliders keep working). */
  tick(dt: number): void {
    if (!this.open) return;
    this.liveT += dt; if (this.liveT < 0.25) return; this.liveT = 0;
    const s = this.api.state();
    if (this.tab === 'scenes' && s.scenes.playing === 'auto') {
      const ph = this.body.querySelector<HTMLElement>('.tl .ph'); if (ph && s.scenes.dur) ph.style.left = (100 * s.scenes.plan / s.scenes.dur).toFixed(2) + '%';
      const sc = this.body.querySelector<HTMLInputElement>('input[data-k="seek"]'); if (sc && !sc.matches(':active')) sc.value = String(Math.round(s.scenes.plan));
      const lb = this.body.querySelector<HTMLElement>('[data-live="plan"]'); if (lb) lb.textContent = `${fmtS(s.scenes.plan)} / ${fmtS(s.scenes.dur)} · ${KIND_LABEL[s.scenes.kind] || s.scenes.kind}${s.scenes.title ? ' — ' + s.scenes.title : ''}`;
    }
    if (this.tab === 'dim') { const i = this.body.querySelector<HTMLElement>('[data-live="dim"]'); if (i) i.textContent = s.dim.info; }
    if (this.tab === 'bus') { const t = this.body.querySelector<HTMLElement>('[data-live="bus"]'); if (t) t.innerHTML = busRows(s.bus.rows); }
    if (this.tab === 'world') { const b = this.body.querySelector<HTMLElement>('[data-live="bots"]'); if (b) b.textContent = String(s.world.bots); }
  }

  card(c: CardInfo): void {
    this.cardEl.innerHTML = `<div class="ch"><span class="emo">${esc(c.icon || '📦')}</span><b>${esc(c.title)}</b><button type="button" class="x" data-x aria-label="Закрыть">✕</button></div>
      <table>${c.rows.map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`).join('')}</table>`;
    this.cardEl.hidden = false;
    clearTimeout(this.cardT);
    this.cardT = window.setTimeout(() => this.hideCard(), 9000);
  }
  hideCard(): void { this.cardEl.hidden = true; clearTimeout(this.cardT); }
  get cardShown(): boolean { return !this.cardEl.hidden; }

  dispose(): void { clearTimeout(this.cardT); this.host.remove(); }

  /* -------------------------------------------------------------- tabs */
  private tabHtml(s: PanelState): string {
    switch (this.tab) {
      case 'scenes': return this.scenesHtml(s);
      case 'world': return this.worldHtml(s);
      case 'over': return this.overHtml(s);
      case 'site': return this.siteHtml(s);
      case 'bus': return this.busHtml(s);
      default: return this.dimHtml(s);
    }
  }
  private dimHtml(s: PanelState): string {
    const d = s.dim;
    const cta = d.inside
      ? `<button type="button" class="btn gold big" data-a="dim-exit"><span class="emo">🏙️</span> Вернуться в город<small>туда же, где ты стоял</small></button>`
      : `<button type="button" class="btn gold big" data-a="dim-enter"${d.blocked ? ' disabled' : ''}><span class="emo">🌀</span> Войти в тестовое измерение<small>${esc(d.blocked || 'отдельный мир: предметы, облики, враги, жители, порталы')}</small></button>`;
    const secs = d.inside ? `<h3>Разделы</h3><div class="grid g3">${d.sections.map((x) => `<button type="button" class="tile" data-a="dim-go" data-v="${esc(x.id)}"><span class="emo">${esc(x.icon)}</span>${esc(x.title)}</button>`).join('')}</div>` : '';
    const tod = `<h3>Время суток <small>в измерении</small></h3><div class="seg">${TOD.map(([h, t]) => `<button type="button" data-a="tod" data-v="${h}" class="${Math.abs(d.tod - h) < 0.6 ? 'on' : ''}">${t}</button>`).join('')}</div>
      <label class="rng"><input type="range" min="0" max="24" step="0.25" value="${d.tod}" data-k="tod"><b data-live="tod">${fmtH(d.tod)}</b></label>`;
    return `<div class="sec">${cta}${secs}${tod}<p class="note" data-live="dim">${esc(d.info)}</p></div>`;
  }
  private scenesHtml(s: PanelState): string {
    const S = s.scenes;
    const auto = S.playing === 'auto';
    const tl = S.dur ? `<div class="tl" title="Таймлайн похода">${S.segs.map(([k, a, b]) => `<i style="left:${(100 * a / S.dur).toFixed(2)}%;width:${(100 * (b - a) / S.dur).toFixed(2)}%;background:${SEG_COL[k] || '#888'}" title="${esc(SEG_RU[k] || k)}"></i>`).join('')}<span class="ph" style="left:${(100 * S.plan / S.dur).toFixed(2)}%"></span></div>
      <div class="legend">${[...new Set(S.segs.map((x) => x[0]))].filter((k) => k !== 'off').map((k) => `<span><i style="background:${SEG_COL[k] || '#888'}"></i>${esc(SEG_RU[k] || k)}</span>`).join('')}</div>
      <label class="rng wide"><input type="range" min="0" max="${Math.floor(S.dur)}" step="1" value="${Math.round(S.plan)}" data-k="seek"></label>` : '';
    const ctl = auto ? `<div class="row">${tl ? '' : ''}<button type="button" class="btn" data-a="sc-pause">${S.paused ? '▶ Дальше' : '⏸ Пауза'}</button>
      <span class="seg sm">${[1, 2, 4].map((v) => `<button type="button" data-a="sc-speed" data-v="${v}" class="${S.speed === v ? 'on' : ''}">×${v}</button>`).join('')}</span></div>` : '';
    const head = `<div class="auto${auto ? ' on' : ''}"><button type="button" class="btn gold big" data-a="sc-auto"><span class="emo">🎬</span> Авто-проигрывание<small>весь поход по порядку: сбор → бой → сокровищница → босс → добыча</small></button>
      ${auto ? tl + `<p class="note" data-live="plan">${fmtS(S.plan)} / ${fmtS(S.dur)} · ${esc(KIND_LABEL[S.kind] || S.kind)}</p>` + ctl : ''}</div>`;
    const close = S.open ? `<div class="row"><button type="button" class="btn" data-a="sc-close">← Закрыть сцену</button><button type="button" class="btn" data-a="min">▴ Свернуть панель</button></div>` : '';
    const groups = MOCK_GROUPS.map((g) => {
      const list = QUEST_MOCKS.filter((m) => m.group === g.id);
      return `<h3><span class="emo">${g.icon}</span> ${esc(g.title)} <small>${list.length}</small></h3><div class="grid g3">${list.map((m) => `<button type="button" class="scard${S.playing === m.id ? ' on' : ''}" data-a="sc-mock" data-v="${esc(m.id)}"><span class="emo big">${esc(m.icon)}</span><span>${esc(m.title)}</span><small>${esc(KIND_LABEL[m.expect] || m.expect)}</small></button>`).join('')}</div>`;
    }).join('');
    return `<div class="sec">${head}${close}${groups}<p class="note">Моки идут только в этот просмотр 3D: не в окно похода сайта и не на сервер.</p></div>`;
  }
  private worldHtml(s: PanelState): string {
    const w = s.world;
    const seg = (a: string, cur: string, opts: [string, string][]) => `<div class="seg">${opts.map(([v, t]) => `<button type="button" data-a="${a}" data-v="${v}" class="${v === cur ? 'on' : ''}">${t}</button>`).join('')}</div>`;
    return `<div class="sec">
      <h3>Камера</h3><div class="row"><button type="button" class="btn${w.freecam ? ' on' : ''}" data-a="freecam">${w.freecam ? '🎥 Свободная камера: вкл' : '🎥 Свободная камера (noclip)'}</button></div>
      <p class="note">WASD + мышь, Пробел / Ctrl — выше / ниже, Shift — быстро. Герой стоит на месте.</p>
      <h3>Качество графики <small>сейчас q${w.level}</small></h3>${seg('quality', w.quality, [['auto', 'Авто'], ['0', 'q0'], ['1', 'q1'], ['2', 'q2'], ['3', 'q3']])}
      <h3>Праздник в городе</h3>${seg('event', w.event, [['', 'Как обычно'], ['halloween', '🎃 Хэллоуин'], ['newyear', '🎄 Новый год'], ['summer', '🏮 Лето'], ['aprilfools', '🤡 1 апреля']])}
      ${w.eventMode === 'off' ? '<p class="note bad">В настройках «Праздничное оформление» выключено — сначала включи «Авто» или «Всегда».</p>' : ''}
      <h3>Ночь Тыквенной Луны <small>только Ярмарка</small></h3>${seg('hwc', w.hwc, [['', 'Как на сайте'], ['look', '🌑 Вид'], ['portal', '🌀 Вид + портал']])}
      <h3>Демо-боты <small>только у тебя</small></h3><div class="row"><span class="pill">в городе: <b data-live="bots">${w.bots}</b></span>
      <button type="button" class="btn" data-a="bots" data-v="5">+5</button><button type="button" class="btn" data-a="bots" data-v="20">+20</button><button type="button" class="btn" data-a="bots" data-v="0">Убрать</button></div>
      </div>`;
  }
  private overHtml(s: PanelState): string {
    const o = s.over;
    const sw = (a: string, on: boolean, t: string, sub: string) => `<button type="button" class="tgl${on ? ' on' : ''}" data-a="${a}" role="switch" aria-checked="${on}"><i></i><span>${t}<small>${sub}</small></span></button>`;
    return `<div class="sec">
      ${sw('perf', o.perf, 'Производительность', 'fps, мс кадра, вызовы, треугольники, качество, память + график')}
      ${sw('grid', o.grid, 'Сетка проходимости и хитбоксы', 'зелёный — можно идти, красный — нельзя, оранжевый — можно встать; голубые рамки — двери и предметы, жёлтая — цель прицела')}
      ${sw('wire', o.wire, 'Каркас (wireframe)', 'вся сцена сеткой')}
      </div>`;
  }
  private siteHtml(s: PanelState): string {
    const x = s.site;
    const fails = x.fails.map((f) => `<li class="${f.severity === 'break' ? 'bad' : 'warn'}"><b>${f.severity === 'break' ? '✗' : '!'}</b> ${esc(f.id)} <small>${esc(f.missing.join(', '))}</small></li>`).join('');
    const ok = x.okIds.map((id) => `<li class="ok"><b>✓</b> ${esc(id)}</li>`).join('');
    return `<div class="sec">
      <div class="row"><span class="pill">Версия <b>${esc(x.version)}</b>${x.dev ? ' · dev' : ''}</span><span class="pill">Город <b>${esc(x.town)}</b></span></div>
      <h3>Контракт сайта <small>${esc(x.phase)} · ${x.checked} проверок</small></h3>
      <ul class="chk">${fails}${ok}</ul><div class="row"><button type="button" class="btn" data-a="contract">↻ Проверить снова</button></div>
      <h3>Не поддерживается (drift) <small>${x.drift.length}</small></h3><p class="note">${x.drift.length ? esc(x.drift.join(', ')) : 'ничего — все id сайта нам знакомы'}</p>
      ${x.scripts.length ? `<h3>Скрипты сайта</h3><p class="note mono">${esc(x.scripts.join(' · '))}</p>` : ''}
      <h3>Отчёт для разработчиков</h3><p class="note">Версии, браузер, видеокарта, настройки и контракт. Без логина, ника и cookies.</p>
      <div class="row"><button type="button" class="btn gold" data-a="report">📋 Скопировать отчёт</button></div>
      ${x.report ? `<textarea readonly class="mono">${esc(x.report)}</textarea>` : ''}
      </div>`;
  }
  private busHtml(s: PanelState): string {
    const b = s.bus;
    return `<div class="sec">${b.present ? '' : '<p class="note bad">Шины нет на этой странице (window.__L3D_BUS).</p>'}
      <div class="row"><button type="button" class="btn${b.on ? ' on' : ''}" data-a="bus">${b.on ? '⏺ Запись идёт' : '⏺ Записывать'}</button><button type="button" class="btn" data-a="bus-clear">Очистить</button></div>
      <p class="note">Что сайт присылает расширению: тип, сколько раз, последнее (ники скрыты).</p>
      <table class="bus"><thead><tr><th>тип</th><th>×</th><th>последнее</th></tr></thead><tbody data-live="bus">${busRows(b.rows)}</tbody></table></div>`;
  }

  /* -------------------------------------------------------------- events */
  private onClick(e: Event): void {
    const el = (e.target as HTMLElement).closest<HTMLElement>('[data-a],[data-tab]');
    if (!el || (el as HTMLButtonElement).disabled) return;
    if (el.dataset.tab) { this.setTab(el.dataset.tab); return; }
    const a = el.dataset.a!;
    if (a === 'close') { this.api.close(); return; }
    if (a === 'min') { this.min = !this.min; this.win.classList.toggle('min', this.min); this.render(); return; }
    this.api.act(a, el.dataset.v);
    this.render();
  }
  private onInput(e: Event): void {
    const el = e.target as HTMLInputElement;
    const k = el.dataset.k; if (!k) return;
    this.api.act(k, el.value);
    if (k === 'tod') { const b = this.body.querySelector<HTMLElement>('[data-live="tod"]'); if (b) b.textContent = fmtH(+el.value); }
  }
}

function busRows(rows: [string, number, string][]): string {
  return rows.length ? rows.map(([t, n, p]) => `<tr><td class="mono">${esc(t)}</td><td>${n}</td><td class="mono pv">${esc(p)}</td></tr>`).join('') : '<tr><td colspan="3" class="note">пока пусто</td></tr>';
}
const fmtS = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const fmtH = (h: number) => `${String(Math.floor(h)).padStart(2, '0')}:${String(Math.round((h % 1) * 60) % 60).padStart(2, '0')}`;

const CSS = String.raw`
:host { all: initial; }
* { box-sizing: border-box; }
.win, .card, .perf {
  --bg: #1d1620; --panel: #2a2030; --panel2: #221a28; --ink: #f7eadf; --mute: #bfaab7; --accent: #ff8fa3; --gold: #ffcf6a; --gold-d: #b8862a;
  --up: #8fe39a; --dn: #ff8f8f; --line: color-mix(in srgb, #ffcf6a 28%, transparent);
  --hd: 'Comfortaa', 'Nunito', 'Trebuchet MS', sans-serif; --tx: 'Nunito', 'Golos Text', 'Segoe UI', sans-serif;
  font: 500 13px/1.35 var(--tx); color: var(--ink); -webkit-font-smoothing: antialiased; pointer-events: auto;
}
.emo { font-family: 'Noto Color Emoji', 'Apple Color Emoji', 'Segoe UI Emoji', sans-serif; font-style: normal; }
button { font: inherit; color: inherit; cursor: pointer; }
button:focus-visible, input:focus-visible { outline: 2px solid var(--gold); outline-offset: 2px; }
.win { position: absolute; right: 14px; top: 92px;   /* below the online pill and the «нет связи / резерв» badge (top 58) */ bottom: 96px; width: min(430px, calc(100vw - 28px)); display: flex; flex-direction: column;
  background: linear-gradient(180deg, rgba(42,32,48,.97), rgba(29,22,32,.97)); border-radius: 20px;
  box-shadow: 0 0 0 2px var(--line), 0 0 0 5px rgba(29,22,32,.8), 0 22px 60px rgba(0,0,0,.55); overflow: hidden; }
.win[hidden], .card[hidden] { display: none; }
.win.min { bottom: auto; } .win.min .body, .win.min .ft { display: none; }
.win.min .tabs { padding-bottom: 12px; }
.hd { display: flex; align-items: center; justify-content: space-between; padding: 14px 14px 8px 18px; }
.ttl { display: grid; grid-template-columns: auto 1fr; column-gap: 9px; align-items: center; }
.ttl .emo { font-size: 24px; grid-row: span 2; }
.ttl b { font: 800 19px/1.1 var(--hd); color: var(--gold); letter-spacing: .01em; }
.ttl small { color: var(--mute); font-size: 11px; }
.hbtn { display: flex; gap: 6px; }
.x { width: 32px; height: 32px; border-radius: 50%; border: 0; background: rgba(255,255,255,.07); box-shadow: 0 0 0 1.5px var(--line); }
.x:hover { background: rgba(255,143,163,.25); }
.tabs { display: flex; gap: 4px; padding: 4px 12px 10px; flex-wrap: wrap; row-gap: 6px; }
.tab { flex: none; border: 0; padding: 6px 8px; border-radius: 999px; background: rgba(255,255,255,.05); box-shadow: 0 0 0 1.5px rgba(255,207,106,.14); font-weight: 800; font-size: 11.5px; display: inline-flex; gap: 4px; align-items: center; white-space: nowrap; }
.tab.on { background: linear-gradient(#ffe39a, var(--gold)); color: #2a1d18; box-shadow: 0 2px 0 var(--gold-d); }
.body { flex: 1; overflow: auto; padding: 0 16px 12px; scrollbar-width: thin; scrollbar-color: #5a4a66 transparent; }
.ft { display: flex; gap: 14px; justify-content: center; padding: 8px; color: var(--mute); font-size: 11px; border-top: 1px solid rgba(255,207,106,.12); }
.kc { font-style: normal; display: inline-block; padding: 1px 6px; border-radius: 6px; background: #3a2c44; box-shadow: 0 2px 0 #140e18; font-weight: 800; font-size: 10px; color: var(--ink); }
h3 { margin: 16px 0 8px; font: 800 13px/1.2 var(--hd); color: var(--gold); letter-spacing: .02em; display: flex; gap: 6px; align-items: baseline; }
h3 small { color: var(--mute); font: 600 11px var(--tx); }
.note { color: var(--mute); font-size: 12px; margin: 8px 0; }
.note.bad, .bad { color: var(--dn); }
.mono { font-family: ui-monospace, Consolas, monospace; font-size: 11px; }
.row { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; margin: 8px 0; }
.btn { border: 0; padding: 8px 13px; border-radius: 12px; background: #3a2c44; box-shadow: 0 0 0 1.5px var(--line), 0 3px 0 #140e18; font-weight: 800; }
.btn:hover { background: #4a3856; }
.btn:active { transform: translateY(2px); box-shadow: 0 0 0 1.5px var(--line), 0 1px 0 #140e18; }
.btn.on { box-shadow: 0 0 0 2px var(--up), 0 3px 0 #140e18; color: var(--up); }
.btn.warn { box-shadow: 0 0 0 1.5px var(--dn), 0 3px 0 #140e18; color: var(--dn); }
.btn.gold { background: linear-gradient(#ffe39a, var(--gold)); color: #2a1d18; box-shadow: 0 3px 0 var(--gold-d), 0 8px 18px rgba(255,207,106,.18); }
.btn.big { width: 100%; padding: 13px 14px; text-align: left; font-size: 15px; display: grid; grid-template-columns: auto 1fr; column-gap: 10px; align-items: center; margin-top: 4px; }
.btn.big .emo { font-size: 24px; grid-row: span 2; }
.btn.big small { font-weight: 600; font-size: 11.5px; opacity: .78; }
.btn[disabled] { opacity: .45; cursor: not-allowed; }
.grid { display: grid; gap: 7px; }
.g3 { grid-template-columns: repeat(3, 1fr); }
.tile, .scard { border: 0; border-radius: 14px; padding: 9px 6px; background: var(--panel2); box-shadow: 0 0 0 1.5px rgba(255,207,106,.14); display: flex; flex-direction: column; gap: 4px; align-items: center; text-align: center; font-weight: 700; font-size: 12px; min-height: 64px; justify-content: center; }
.tile .emo, .scard .emo { font-size: 20px; }
.scard .emo.big { font-size: 24px; }
.scard small { color: #cdb9c6; font-size: 10.5px; font-weight: 700; }
.tile:hover, .scard:hover { box-shadow: 0 0 0 1.5px var(--gold); background: #2e2236; transform: translateY(-1px); }
.scard.on { box-shadow: 0 0 0 2px var(--accent), 0 0 18px rgba(255,143,163,.25); background: #3a2434; }
.seg { display: inline-flex; flex-wrap: wrap; gap: 3px; padding: 3px; border-radius: 12px; background: var(--panel2); box-shadow: 0 0 0 1.5px rgba(255,207,106,.14); }
.seg button { border: 0; background: none; padding: 6px 10px; border-radius: 9px; font-weight: 800; font-size: 12px; color: var(--mute); }
.seg button.on { background: linear-gradient(#ffe39a, var(--gold)); color: #2a1d18; }
.seg.sm button { padding: 5px 8px; }
.rng { display: flex; align-items: center; gap: 10px; margin: 10px 0; }
.rng input { flex: 1; accent-color: var(--gold); }
.rng b { min-width: 46px; text-align: right; font-variant-numeric: tabular-nums; }
.rng.wide { margin: 4px 0; }
.auto { border-radius: 16px; padding: 2px 0; }
.auto.on { padding: 10px; background: rgba(255,207,106,.06); box-shadow: 0 0 0 1.5px rgba(255,207,106,.2); }
.tl { position: relative; height: 22px; margin: 12px 0 6px; border-radius: 8px; background: #140e18; overflow: hidden; }
.tl i { position: absolute; top: 3px; bottom: 3px; border-radius: 4px; opacity: .85; }
.tl .ph { position: absolute; top: 0; bottom: 0; width: 3px; margin-left: -1px; background: #fff; box-shadow: 0 0 8px #fff; }
.legend { display: flex; flex-wrap: wrap; gap: 4px 10px; font-size: 11px; color: #d6c4cf; }
.legend i { display: inline-block; width: 9px; height: 9px; border-radius: 3px; margin-right: 4px; vertical-align: -1px; }
.tgl { width: 100%; border: 0; display: flex; gap: 12px; align-items: center; text-align: left; padding: 11px 12px; border-radius: 14px; background: var(--panel2); box-shadow: 0 0 0 1.5px rgba(255,207,106,.14); margin: 8px 0; font-weight: 800; }
.tgl i { flex: none; width: 40px; height: 22px; border-radius: 999px; background: #3a2c44; position: relative; transition: background .2s; }
.tgl i::after { content: ''; position: absolute; left: 3px; top: 3px; width: 16px; height: 16px; border-radius: 50%; background: #bfaab7; transition: transform .2s, background .2s; }
.tgl.on i { background: #3f7a4a; } .tgl.on i::after { transform: translateX(18px); background: var(--up); }
.tgl small { display: block; color: var(--mute); font-weight: 600; font-size: 11.5px; }
.pill { padding: 6px 11px; border-radius: 999px; background: var(--panel2); box-shadow: 0 0 0 1.5px rgba(255,207,106,.14); font-size: 12px; }
.chk { list-style: none; padding: 0; margin: 0; max-height: 240px; overflow: auto; }
.chk li { padding: 4px 6px; border-radius: 8px; font-size: 12px; } .chk li small { color: var(--mute); }
.chk li.ok b { color: var(--up); } .chk li.bad { background: rgba(255,107,129,.1); } .chk li.warn { color: var(--gold); }
textarea { width: 100%; height: 150px; resize: vertical; background: #140e18; color: var(--ink); border: 0; border-radius: 12px; padding: 10px; box-shadow: 0 0 0 1.5px rgba(255,207,106,.14); }
table.bus { width: 100%; border-collapse: collapse; font-size: 12px; }
table.bus th { text-align: left; color: var(--mute); font-weight: 700; padding: 4px; }
table.bus td { padding: 4px; border-top: 1px solid rgba(255,255,255,.06); vertical-align: top; }
table.bus td.pv { word-break: break-all; color: var(--mute); }
.card { position: absolute; left: 50%; bottom: 110px; transform: translateX(-50%); min-width: 300px; max-width: min(460px, 90vw); padding: 12px 14px 12px; border-radius: 16px;
  background: rgba(29,22,32,.95); box-shadow: 0 0 0 2px var(--line), 0 14px 40px rgba(0,0,0,.5); }
.ch { display: flex; gap: 8px; align-items: center; margin-bottom: 8px; } .ch b { flex: 1; font: 800 15px var(--hd); color: var(--gold); } .ch .emo { font-size: 20px; }
.card .x { width: 26px; height: 26px; }
.card table { border-collapse: collapse; width: 100%; font-size: 12px; }
.card th { text-align: left; color: var(--mute); font-weight: 700; padding: 3px 10px 3px 0; white-space: nowrap; vertical-align: top; }
.card td { padding: 3px 0; word-break: break-word; font-family: ui-monospace, Consolas, monospace; font-size: 11.5px; }
.perf { position: absolute; left: 12px; bottom: 64px; width: 360px; white-space: nowrap; padding: 8px 8px 6px; border-radius: 12px; background: rgba(13,11,34,.82); box-shadow: 0 0 0 1.5px rgba(143,227,154,.25); pointer-events: none;
  font: 12px/1.4 ui-monospace, Consolas, monospace; color: #d8f5dc; }
.perf b { color: #fff; }
.perf canvas { display: block; width: 344px; height: 70px; margin-top: 5px; border-radius: 6px; background: rgba(0,0,0,.35); }
@media (prefers-reduced-motion: reduce) { .tgl i, .tgl i::after { transition: none; } .tile:hover, .scard:hover { transform: none; } }
`;
