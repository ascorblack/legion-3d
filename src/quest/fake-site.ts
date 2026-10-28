/**
 * A fake of the SITE'S «Поход» tab (quest.js 28.10) for dev pages and tests ONLY — never used against the live site.
 * Markup copied from the site's own templates (qaBtn, hwBtn, qaBattle, qaRune2, pzHtml, hwEvHtml/skeldance, gobHtml, qaEvent,
 * pbHtml, voteHtml, sayMount), so src/quest/siteui.ts reads it exactly like the real tab. FakeSite also emulates the site's delegated
 * handlers (qaBind, pbClick, the dance chain, the pad, the toggles, the command line's form) — each press is logged instead of sent.
 *
 *   const fs = new FakeSite(tab, { stage: 'battle', qa: true });   // tab = <section id="tab-quest">
 *   window.LGQuest = fs.api;                                        // the HUD asks the site to paint: LGQuest.show(true)
 *   fs.log                                                          // [{ via: 'act', p: { k: 'b', a: 'base' } }, { via: 'say', line: 'удар' }…]
 */

export type FakeStage = 'battle' | 'battle-tele' | 'map-vote' | 'rune-door' | 'rune-vote' | 'pz-cups' | 'pz-riddle' | 'skeldance' | 'gob-bet' | 'gob-shell' | 'ev-traveler' | 'ev-dice' | 'gather';
export const FAKE_STAGES: FakeStage[] = ['battle', 'battle-tele', 'map-vote', 'rune-door', 'rune-vote', 'pz-cups', 'pz-riddle', 'skeldance', 'gob-bet', 'gob-shell', 'ev-traveler', 'ev-dice', 'gather'];
/** The demo view (src/debug/questMocks id) shown with each fake tab. */
export const FAKE_MOCK: Record<FakeStage, string> = {
  'battle': 'battle-two', 'battle-tele': 'battle-tele', 'map-vote': 'map-vote', 'rune-door': 'trap-code', 'rune-vote': 'trap-code', 'pz-cups': 'pz-cups', 'pz-riddle': 'pz-riddle',
  'skeldance': 'hw-skeldance-input', 'gob-bet': 'gob-bet', 'gob-shell': 'gob-shell', 'ev-traveler': 'ev-traveler', 'ev-dice': 'ev-dice', 'gather': 'gather',
};
export type FakeAct = { via: 'act'; p: Record<string, unknown> } | { via: 'say'; line: string } | { via: 'vote'; vid: number; n: number } | { via: 'eat'; uid: string };

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
const qaData = (o: object) => esc(JSON.stringify(o));
const HW_STEP: Record<string, [string, string]> = { l: ['влево', 'л'], r: ['вправо', 'п'], j: ['прыг', 'в'], c: ['хлоп', 'х'] };

interface St {
  pend: { label: string; sig: string; at: number } | null; ok: { t: string; at: number } | null; okSig: string; badSig: string;
  sel: { t: string; lead: boolean; s: string }; dig: string; ch: string[]; bet: number; pbArm: string;
  hist: { line: string; st: 'wait' | 'ok' | 'no' | 'note'; msg: string; btn?: boolean }[]; turn: string; my: string;
}

export class FakeSite {
  log: FakeAct[] = [];
  shown = false;
  stage: FakeStage;
  qa: boolean;
  st: St = { pend: null, ok: null, okSig: '', badSig: '', sel: { t: '', lead: false, s: '' }, dig: '', ch: [], bet: 30, pbArm: '', hist: [], turn: '', my: '' };
  /** what window.LGQuest offers the HUD (the site's own API shape) */
  api = { show: (on: boolean) => { this.shown = !!on; this.paint(); } };
  /** the game's answer to a press after `answerMs` (0 = never: stays «отправлено…»); `decline` answers «игра не приняла» */
  answerMs: number;
  decline = false;
  private timers: ReturnType<typeof setTimeout>[] = [];

  constructor(public tab: HTMLElement, o: { stage: FakeStage; qa: boolean; answerMs?: number }) {
    this.stage = o.stage; this.qa = o.qa; this.answerMs = o.answerMs ?? 0;
    tab.addEventListener('click', (e) => this.onClick(e));
    tab.addEventListener('submit', (e) => this.onSubmit(e));
  }
  dispose() { for (const t of this.timers) clearTimeout(t); this.timers = []; }
  setStage(stage: FakeStage, qa = this.qa) { this.stage = stage; this.qa = qa; this.st.dig = ''; this.st.ch = []; this.st.pend = null; this.st.ok = null; this.st.my = ''; this.st.turn = ''; this.paint(); }

  /* ------------------------------------------------------------ markup (quest.js templates) */
  private sig(o: Record<string, unknown>) { const { _l, ...x } = o; void _l; return JSON.stringify(x); }
  private busy() { return !!this.st.pend; }
  qaBtn(o: Record<string, unknown>, label: string, cls = '', dis = false) {
    const g = this.sig(o), stc = this.st.pend && this.st.pend.sig === g ? ' wait' : this.st.badSig === g ? ' bad' : this.st.okSig === g ? ' ok' : '';
    return `<button type="button" class="qa-b ${cls}${stc}" data-qa="${qaData(o)}"${dis || this.busy() ? ' disabled' : ''}>${label}</button>`;
  }
  private lineSt(t: string) { for (let i = this.st.hist.length - 1; i >= 0; i--) { const x = this.st.hist[i]; if (x.line !== t) continue; return x.st === 'wait' ? ' wait' : x.st === 'ok' ? ' ok' : x.st === 'no' ? ' bad' : ''; } return ''; }
  hwBtn(label: string, line: string, cls = '', dis = false, pbc = '') { return `<button type="button" class="qa-b ${cls}${this.lineSt(line)}" data-qpb="${esc(line)}" data-qpbc="${pbc}"${dis ? ' disabled' : ''}>${label}</button>`; }
  private pendLine() { return this.st.pend ? `<p class="qa-st wait" role="status"><svg class="qi"></svg> отправлено: ${esc(this.st.pend.label)}…</p>` : ''; }
  private okLine() { return this.st.ok ? `<p class="qa-st ok" role="status"><svg class="qi ok"></svg> принято: ${esc(this.st.ok.t)}</p>` : ''; }
  private card(inner: string) { return `<section class="q-card qa">${inner}</section>`; }

  act(): string {
    const S = this.st, qa = this.qa;
    switch (this.stage) {
      case 'battle': {
        if (!qa) return '<div class="q-stage"><b>Твой ход · <span data-until="1">20</span> с</b></div><section class="q-card"><div class="q-ch"><b>Что писать в чат</b><span class="muted">сейчас ход отряда</span></div><ul class="q-cmds"><li><b>выстрел</b> — твой удар</li></ul></section>';
        const side = S.sel.s, lead = S.sel.lead, SIDE: Record<string, string> = { L: '⬅ слева', R: 'справа ➡' };
        const pick = (o: Record<string, unknown>) => ({ ...o, ...(side ? { s: side } : {}) });
        const mainL = `выстрел${lead ? ' → вожак' : ''}${side ? ' · ' + SIDE[side] : ''}`;
        const T = S.turn;
        const rows = [this.qaBtn({ ...pick({ k: 'b', a: 'base', ...(lead ? { t: 'lead' } : {}) }), _l: mainL }, `🏹 ${esc(mainL)}`, `main big${T === 'base' ? ' ok' : ''}`, !!T),
          this.qaBtn({ ...pick({ k: 'b', a: 'sk', w: 'залп' }), _l: 'залп' }, '🎯 залп<small>готово</small>', T === 'залп' ? 'sk ok' : 'sk', !!T),
          this.qaBtn({ ...pick({ k: 'b', a: 'sk', w: 'меткий выстрел' }), _l: 'меткий выстрел' }, '🏹 меткий выстрел<small>через 2 хода</small>', 'cd', true)];
        const pb = `<section class="q-card qa q-pb" aria-label="Действия здесь"><div class="q-pbg g-esc"><span class="muted">Уйти из боя</span><div class="qa-row">${['бежать'].map((t) => { const arm = S.pbArm === t; return `<button type="button" class="qa-b ${arm ? 'urge' : 'warn'}${this.lineSt(t)}" data-qpb="${t}" data-qpbc="warn" data-tip="Сбежать из боя. Враг может ударить в спину - можно получить урон. Нажми дважды">🏃 Бежать${arm ? '<small>ещё раз - точно</small>' : ''}</button>`; }).join('')}</div></div>${S.pbArm ? '<p class="qa-st warn" role="alert">⚠ Точно бежать? Враг может ударить в спину - получишь урон</p>' : ''}</section>`;
        return `<div class="q-stage"><b>Твой ход · <span data-until="1">20</span> с</b><span>раунд 2</span></div>${pb}` + this.card(`<div class="q-ch"><span class="muted">кнопки = команды чата, чат тоже работает</span></div>${this.pendLine()}${T ? `<p class="qa-st ok">ход принят: <b>${esc(T === 'base' ? 'выстрел' : T)}</b></p>` : ''}<div class="qa-row">${rows.join('')}</div>`
          + `<div class="qa-sel" role="group" aria-label="Цель удара"><span>Цель:</span><button type="button" class="qa-c${!lead ? ' on' : ''}" data-qsel="lead|0" aria-pressed="${!lead}">рядовые</button><button type="button" class="qa-c${lead ? ' on' : ''}" data-qsel="lead|1" aria-pressed="${lead}">вожак</button></div>`
          + `<div class="qa-sel" role="group" aria-label="Сторона"><span>Сторона:</span><button type="button" class="qa-c${!side ? ' on' : ''}" data-qsel="s|" aria-pressed="${!side}">своя (⬅ слева)</button>${['L', 'R'].map((s) => `<button type="button" class="qa-c${side === s ? ' on' : ''}" data-qsel="s|${s}" aria-pressed="${side === s}">${SIDE[s]}</button>`).join('')}</div>`);
      }
      case 'battle-tele':
        return '<div class="q-stage"><b>Ход врага · <span data-until="1">12</span> с</b></div>' + this.card(`<p class="q-big">Вожак готовит бросок!</p><p class="muted">2 из 5 нужных</p>${qa ? '<div class="q-ncw"><span>Напечатай в строке внизу:</span><canvas class="q-nc big" data-nc="1" role="img" aria-label="слово с экрана стрима - напечатай его в строке команд"></canvas></div>' : '<p>Пиши в чат: <b class="w">щит</b></p>'}`);
      case 'map-vote': {
        const opts: [number, string, number][] = [[1, 'Северная тропа', 4], [2, 'Пещера', 2], [3, 'К реке', 5]];
        return `<div class="q-stage"><b>Куда идём? · <span data-until="1">40</span> с</b><span>нажми на вариант или пиши номер в чат</span></div><section class="q-card"><ul class="q-vote">${opts.map((o) => `<li class="can"><button type="button" class="q-vb" data-qv="9001:${o[0]}" aria-pressed="false"><div><b>${o[0]} · ${esc(o[1])}</b><span class="v">${o[2]}</span></div></button><i></i></li>`).join('')}</ul></section>`;
      }
      case 'rune-door': {
        const need = 4, d = S.dig;
        return '<div class="q-stage"><b>🚪 Дверь с рунами 2</b></div>' + (!qa ? '<section class="q-card"><p>Пиши в чат код: <b>код 1234</b></p></section>' : this.card(`${this.pendLine()}${this.okLine()}<p class="muted">Руны могут повторяться · твоих попыток: <b>2</b> из 3</p><div class="qa-dig" aria-live="polite"><b>${d ? esc(d) : '…'}</b><span class="muted">${d.length} из ${need} · цифры 1–6</span></div>`
          + `<div class="qa-pad">${Array.from({ length: 6 }, (_, i) => `<button type="button" class="qa-c" data-qdig="${i + 1}"${d.length >= need ? ' disabled' : ''}>${i + 1}</button>`).join('')}<button type="button" class="qa-c" data-qdig="<" aria-label="Стереть">⌫</button></div>`
          + `<div class="qa-row">${this.qaBtn({ k: 'tr', a: 'code', s: '#dig', _l: `код ${d}` }, 'Ввести код', 'main', d.length !== need)}</div><p class="muted">Кнопка = команда в чат, чат тоже работает</p>`));
      }
      case 'rune-vote':
        return '<div class="q-stage"><b>🚪 Дверь открыта</b></div>' + (!qa ? '<section class="q-card"><p>Пиши в чат: <b>забрать</b> или <b>дальше</b></p></section>' : this.card(`${this.pendLine()}${this.okLine()}<div class="qa-row">${this.qaBtn({ k: 'tr', a: 'keep', _l: 'забрать' }, '💰 Забрать', 'main')}${this.qaBtn({ k: 'tr', a: 'next', _l: 'дальше' }, '🚪 Дальше · награда ×2', 'warn')}</div><p class="muted">Забрать: 3 · дальше: 1 · голос можно сменить.</p>`));
      case 'pz-cups':
        return `<div class="q-stage"><b>🍷 Три кубка · <span data-until="1">25</span> с</b><span>ответ</span></div><section class="q-card qa q-hw"><p class="q-big q-hwh">Выбери кубок без яда</p><p class="muted">${qa ? 'Кнопки ниже = команды чата, чат тоже работает' : 'Пиши в чат'}</p><ol class="q-pzc">${['Яд не здесь', 'Яд в первом', 'Яд не во втором'].map((t, i) => `<li><span class="q-pzs">«${t}»</span>${qa ? this.hwBtn(`Кубок ${i + 1}`, String(i + 1), 'main big') : `<b>Кубок ${i + 1}</b>`}</li>`).join('')}</ol></section>`;
      case 'pz-riddle':
        return `<div class="q-stage"><b>❓ Загадка сфинкса · <span data-until="1">25</span> с</b><span>ответ</span></div><section class="q-card qa q-hw"><p class="q-big q-hwh">Ответ одним словом</p><p class="muted">${qa ? 'Напечатай ответ в строке команд внизу - или в чат' : 'Пиши ответ в чат'}</p><p class="q-big q-hwq">«Без окон, без дверей — полна горница людей»</p></section>`;
      case 'skeldance': {
        const L = 4, ch = S.ch, line = ch.map((k) => HW_STEP[k][0]).join(' ');
        let rows = '<p class="q-hwl">Все 4 па по порядку - одним сообщением, через пробел.</p>';
        if (qa) rows += `<div class="q-hwc" aria-live="polite"><span class="muted">Твоя цепочка · ${ch.length} из ${L}</span><div class="q-hwd">${Array.from({ length: L }, (_, i) => `<span class="q-hwx"><i class="q-hws ${ch[i] ? 'on' : ''}"></i><small>${ch[i] ? HW_STEP[ch[i]][0] : '…'}</small></span>`).join('')}</div></div>`
          + `<div class="qa-row q-hwb">${Object.entries(HW_STEP).map(([k, [nm, ab]]) => `<button type="button" class="qa-b big" data-qhw="${k}"${ch.length >= L ? ' disabled' : ''} aria-label="Добавить па: ${nm}"><span class="q-hwi2"><svg></svg></span><small>${nm} · ${ab}</small></button>`).join('')}</div>`
          + `<div class="qa-row"><button type="button" class="qa-b" data-qhw="<"${ch.length ? '' : ' disabled'} aria-label="Стереть последнее па">⌫</button>${line ? this.hwBtn(`Отправить<small>${esc(line)}</small>`, line, 'main big', ch.length !== L) : this.hwBtn('Отправить', '-', 'main big', true)}</div>`;
        return `<div class="q-stage"><b>💀 Повтори последовательность · <span data-until="1">30</span> с</b><span>повтори цепочку</span></div><section class="q-card qa q-hw"><p class="q-big q-hwh">Напиши всю цепочку па</p><p class="muted">${qa ? 'Кнопки ниже = команды чата, чат тоже работает' : 'Пиши в чат'}</p>${rows}</section>`;
      }
      case 'gob-bet':
        return `<div class="q-stage"><b>👺 Ярмарка гоблинов · <span data-until="1">30</span> с</b><span>игра 1 из 3 · ставки</span></div><section class="q-card qa q-hw"><p class="q-big q-hwh">Ставь монеты: напёрстки</p><p class="muted">${qa ? 'Кнопки ниже = команды чата, чат тоже работает' : 'Пиши в чат'}</p><p>Поставили: <b>4</b> · на кону 120</p>`
          + (qa ? `<div class="qa-row q-gfb" role="group" aria-label="Ставка">${[10, 30, 50].map((n) => this.hwBtn(`🪙 ${n}`, `ставка ${n}`, n === 30 ? 'main' : '')).join('')}${this.hwBtn('🪙 100<small>максимум</small>', 'ставка 100')}</div><p class="muted">Другая сумма - строкой: «ставка N» (от 10 до 100)</p>` : '') + '</section>';
      case 'gob-shell':
        return `<div class="q-stage"><b>👺 Ярмарка гоблинов · <span data-until="1">20</span> с</b><span>где шарик?</span></div><section class="q-card qa q-hw"><p class="q-big q-hwh">Где шарик? 1, 2 или 3</p><p class="muted">${qa ? 'Кнопки ниже = команды чата, чат тоже работает' : 'Пиши в чат'}</p>${S.my ? `<p class="qa-st ok">твой ответ: ${esc(S.my)} · ставка 20 - можно передумать, пока идёт время</p>` : ''}`
          + (qa ? `<div class="qa-row q-hwt">${['1', '2', '3'].map((n) => this.hwBtn(n, n, (S.my === n ? 'on ' : '') + 'main big')).join('')}</div>` : '') + '</section>';
      case 'ev-traveler':
        return '<div class="q-stage"><b>🧳 Путник в беде · <span data-until="1">30</span> с</b><span>помочь 4 · обобрать 2</span></div>'
          + (qa ? this.card(`${this.pendLine()}${this.okLine()}<div class="qa-row">${this.qaBtn({ k: 'ev', a: 'help', _l: 'помочь' }, '🤝 Помочь', S.my === 'help' ? 'main on' : 'main', S.my === 'help')}${this.qaBtn({ k: 'ev', a: 'rob', _l: 'обобрать' }, '💰 Обобрать', S.my === 'rob' ? 'warn on' : 'warn', S.my === 'rob')}</div>`)
            : '<section class="q-card"><p class="q-big">Помочь путнику или обобрать?</p><p>Пиши в чат: <b>помочь</b> или <b>обобрать</b></p></section>');
      case 'ev-dice': {
        if (!qa) return '<div class="q-stage"><b>🎲 Кости с бродягой</b></div><section class="q-card"><p>Пиши в чат: <b>ставка 20</b></p></section>';
        const bet = S.bet, chips = [10, 30, 50, 100];
        return '<div class="q-stage"><b>🎲 Кости с бродягой</b><span>у бродяги 300</span></div>' + this.card(`${this.pendLine()}${this.okLine()}<div class="qa-bet"><label class="qa-bl"><span>Ставка</span><input type="range" class="qa-rng" data-qbet min="5" max="200" step="5" value="${bet}"><b data-qbetv>${bet}</b></label>`
          + `<div class="qa-sel" role="group" aria-label="Быстрая ставка">${chips.map((n) => `<button type="button" class="qa-c${n === bet ? ' on' : ''}" data-qsel="bet|${n}" aria-pressed="${n === bet}">${n}</button>`).join('')}</div></div>`
          + `<div class="qa-row">${this.qaBtn({ k: 'ev', a: 'bet', n: bet, _l: 'ставка ' + bet }, `🎲 Играть · <span data-qbetb>${bet}</span>`, 'main big')}</div><p class="muted">Твой d20 против бродяги · игр 0 из 3</p>`);
      }
      case 'gather':
        return '<div class="q-stage"><b>Сбор отряда</b><span>Стример собирает отряд</span></div><p class="q-big">Сбор отряда · <span data-until="1">50</span> с</p><p class="muted ql-hint">Ты не в отряде - нажми «вступить в поход?» вверху</p>';
    }
    return '';
  }
  private hero() {
    return `<section class="q-card ql-hero" aria-label="Мой герой"><div class="q-ch"><b>Герой</b></div><ul class="q-bag"><li><button type="button" class="q-bi" data-qa="${qaData({ k: 'eat', uid: 'u1' })}" aria-label="Съесть: Пирог"></button></li></ul></section>`;
  }
  private top() {
    const join = this.stage === 'gather' || this.stage === 'map-vote';
    return `<header class="ql-top" data-ql="top"><b>Поход</b>${join ? this.qaBtn({ k: 'join', _l: 'вступить в поход' }, 'вступить в поход?', 'main ql-pb') : ''}</header>`;
  }
  private say() {
    if (!this.qa) return '';
    const h = this.st.hist.map((x) => x.st === 'note' ? `<li class="note">${esc(x.msg)}</li>` : `<li class="${x.st}${x.btn ? ' btn' : ''}"><b>${esc(x.line)}</b><span>${x.st === 'wait' ? 'в пути…' : esc(x.msg)}</span></li>`).join('');
    return `<section class="q-say" aria-label="Команда в поход"><div class="q-sayb"><div class="q-sayt"><span>Предыдущие команды</span><button type="button" class="q-sayx">все ▾</button></div><ol class="q-sayh" id="qSayH">${h}</ol></div><p class="q-sayw" role="alert" hidden></p>`
      + `<form class="q-sayf" autocomplete="off"><label class="q-sayl" for="qSayIn">Команда в поход</label><input id="qSayIn" class="q-sayi" type="text" maxlength="100" placeholder="Команда в поход: удар, лечить, 2…">`
      + `<button type="submit" class="qa-b main q-says" aria-label="Отправить"${this.sayPend() ? ' disabled' : ''}></button></form><p class="q-sayn muted">Как сообщение в чат Twitch, только видит его одна игра. Enter - отправить, ↑ - прошлое.</p></section>`;
  }
  private sayPend() { return this.st.hist.some((x) => x.st === 'wait'); }
  /** quest.js paint(): nothing while the tab is not shown */
  paint() {
    if (!this.shown) return;
    const inner = this.qa ? `<div class="q-wrap ql-on"><div class="ql">${this.top()}<section class="q-card ql-act" data-ql="act" aria-live="polite">${this.act()}</section><div class="ql-row ql-r2">${this.hero()}</div></div></div>`
      : `<div class="q-wrap">${this.act()}</div>`;
    this.tab.innerHTML = inner + this.say();
  }

  /* ------------------------------------------------------------ the site's handlers (qaBind, pbClick, sayMount), logging instead of sending */
  private later(fn: () => void) { if (!this.answerMs) return; this.timers.push(setTimeout(() => { fn(); this.paint(); }, this.answerMs)); }
  private sayLine(line: string, btn = false) {
    if (this.sayPend()) { this.st.hist.push({ line: '', st: 'note', msg: 'подожди - прошлая строка ещё в пути' }); this.paint(); return false; }
    const it = { line, st: 'wait' as const, msg: '', ...(btn ? { btn: true } : {}) };
    this.st.hist.push(it); if (this.st.hist.length > 8) this.st.hist.shift();
    this.log.push({ via: 'say', line });
    this.later(() => { const x = it as { st: string; msg: string }; x.st = this.decline ? 'no' : 'ok'; x.msg = this.decline ? 'игра не поняла' : 'принято'; if (this.stage === 'gob-shell' && /^[123]$/.test(line)) this.st.my = line; });
    return true;
  }
  private onClick(e: Event) {
    const t = e.target as Element | null; if (!t || !t.closest) return;
    const b = t.closest('[data-qa], [data-qsel], [data-qdig], [data-qpb], [data-qhw], [data-qv]') as HTMLButtonElement | null;
    if (!b || b.disabled) return;
    const a = (k: string) => b.getAttribute(k);
    if (a('data-qv') != null) { const [vid, n] = String(a('data-qv')).split(':').map(Number); this.log.push({ via: 'vote', vid, n }); return; }
    if (a('data-qhw') != null) { const k = a('data-qhw')!; if (k === '<') this.st.ch.pop(); else if (HW_STEP[k] && this.st.ch.length < 4) this.st.ch.push(k); this.paint(); return; }
    if (a('data-qpb') != null) {
      const line = a('data-qpb')!;
      if (a('data-qpbc') === 'warn' && this.st.pbArm !== line) { this.st.pbArm = line; this.paint(); return; }
      this.st.pbArm = ''; this.sayLine(line, true); if (this.stage === 'skeldance') this.st.ch = []; this.paint(); return;
    }
    if (a('data-qsel') != null) { const [k, v] = a('data-qsel')!.split('|'); if (k === 'lead') this.st.sel.lead = !this.st.sel.lead; else if (k === 's') this.st.sel.s = this.st.sel.s === v ? '' : v; else if (k === 'bet') this.st.bet = +v; this.paint(); return; }
    if (a('data-qdig') != null) { const d = a('data-qdig')!; if (d === '<') this.st.dig = this.st.dig.slice(0, -1); else if (this.st.dig.length < 14) this.st.dig += d; this.paint(); return; }
    let o: Record<string, unknown>; try { o = JSON.parse(a('data-qa') || ''); } catch { return; }
    const label = String(o._l || 'действие'); delete o._l;
    if (o.k === 'eat') { this.log.push({ via: 'eat', uid: String(o.uid) }); return; }
    if (o.s === '#dig') { o.s = this.st.dig; this.st.dig = ''; }
    if (this.st.pend) return;
    const sig = JSON.stringify(o);
    this.st.pend = { label, sig, at: Date.now() }; this.st.ok = null;
    this.st.hist.push({ line: label, st: 'wait', msg: '', btn: true });
    this.log.push({ via: 'act', p: o });
    this.paint();
    this.later(() => {
      const h = [...this.st.hist].reverse().find((x) => x.btn && x.st === 'wait');
      this.st.pend = null;
      if (this.decline) { this.st.badSig = sig; if (h) { h.st = 'no'; h.msg = 'игра не приняла'; } return; }
      if (o.k === 'b') this.st.turn = o.a === 'base' ? 'base' : String(o.w || o.a);
      else { this.st.ok = { t: label, at: Date.now() }; this.st.okSig = sig; if (o.k === 'ev') this.st.my = String(o.a); }
      if (h) { h.st = 'ok'; h.msg = o.k === 'b' ? 'принято - ждём хода' : 'принято'; }
    });
  }
  private onSubmit(e: Event) {
    e.preventDefault();
    const inp = this.tab.querySelector('.q-say input') as HTMLInputElement | null; if (!inp) return;
    const line = String(inp.value || '').replace(/\s+/g, ' ').trim().slice(0, 100); if (!line) return;
    if (this.sayLine(line)) inp.value = '';
    this.paint();
  }
}
