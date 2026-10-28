/**
 * Expedition commands mirrored from the site's own «Поход» tab (src/quest/siteui.ts): PRESSED commands become our buttons that click
 * the site's element exactly once, TYPED ones go through the site's own «Команда в поход» form; without the site's flag (hero.qa)
 * there is nothing to press or type on the site → «пиши в чат стрима». Fake site tab: src/quest/fake-site.ts (quest.js markup and
 * handlers, logging instead of sending), fake DOM: test/minidom.ts. No request is ever made by our code.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { readSite, pressSite, feedSiteSay, primeSite, siteQaOn, chatChips, hotButtons, findSite, type SiteControls } from '../src/quest/siteui';
import { FakeSite, FAKE_STAGES, type FakeStage } from '../src/quest/fake-site';
import { cardOf } from '../src/quest';
import { mockById } from '../src/debug/questMocks';
import { FAKE_MOCK } from '../src/quest/fake-site';
import { MEl, makeDoc } from './minidom';

let net = 0;
beforeEach(() => {
  net = 0;
  vi.stubGlobal('fetch', () => { net++; throw new Error('network from the HUD'); });
  vi.stubGlobal('XMLHttpRequest', class { constructor() { net++; throw new Error('network from the HUD'); } });
});
afterEach(() => { vi.unstubAllGlobals(); expect(net).toBe(0); });

function site(stage: FakeStage, qa = true) {
  const doc = makeDoc(), tab = new MEl('section'); tab.setAttribute('id', 'tab-quest'); tab.setAttribute('class', 'tab'); doc.body.append(tab);
  const fs = new FakeSite(tab as unknown as HTMLElement, { stage, qa });
  const W = { LGQuest: fs.api };
  expect(primeSite(W, tab as unknown as Element)).toBe(true);   // the hidden tab is painted on request (quest.js paints only while shown)
  return { tab: tab as unknown as Element, fs, raw: tab };
}
const flat = (c: SiteControls) => c.groups.flatMap((g) => g.btns);
const byLabel = (c: SiteControls, l: string | RegExp) => flat(c).find((b) => (typeof l === 'string' ? b.label === l : l.test(b.label)))!;
/** press and count the clicks the site element got (it may be replaced by the site's repaint right after) */
const press = (tab: Element, key: string) => { const el = findSite(tab, key) as unknown as MEl | null, n0 = el ? el.clicks : 0; const r = pressSite(tab, key); return { r, clicks: el ? el.clicks - n0 : 0 }; };

describe('who gets buttons: the site\'s own flag (quest.js qaOn = X.hero().qa)', () => {
  it('hero.qa → buttons and the command line; no flag → neither', () => {
    expect(siteQaOn({ qa: 1 })).toBe(true);
    expect(siteQaOn({ qa: true })).toBe(true);
    expect(siteQaOn({ login: 'x' })).toBe(false);
    expect(siteQaOn(null)).toBe(false);
  });
  it.each(FAKE_STAGES)('%s without the flag: nothing to press, no command line (→ «пиши в чат стрима»)', (stage) => {
    const { tab } = site(stage, false);
    const c = readSite(tab);
    expect(c.painted).toBe(true);
    expect(c.groups).toEqual([]);
    expect(c.say).toBeNull();
  });
  it('an unpainted tab reads empty; a visible tab (.on) is never re-primed; no LGQuest → no prime', () => {
    const tab = new MEl('section'); tab.setAttribute('id', 'tab-quest');
    expect(readSite(tab as unknown as Element)).toMatchObject({ painted: false, groups: [], say: null });
    let shows = 0; const W = { LGQuest: { show: () => { shows++; } } };
    tab.classList.add('on');
    expect(primeSite(W, tab as unknown as Element)).toBe(false);
    tab.classList.remove('on');
    expect(primeSite({}, tab as unknown as Element)).toBe(false);
    expect(primeSite(W, null)).toBe(false);
    expect(primeSite(W, tab as unknown as Element)).toBe(true); expect(shows).toBe(1);
  });
});

describe('battle (qaBattle + place buttons)', () => {
  it('class word, skills with cooldown, target / side toggles, flee; food and join are not ours', () => {
    const { tab } = site('battle');
    const c = readSite(tab);
    expect(c.groups.map((g) => [g.kind, g.title || '', g.btns.map((b) => b.label)])).toEqual([
      ['row', 'Уйти из боя', ['🏃 Бежать']],
      ['row', '', ['🏹 выстрел', '🎯 залп', '🏹 меткий выстрел']],
      ['sel', 'Цель', ['рядовые', 'вожак']],
      ['sel', 'Сторона', ['своя (⬅ слева)', '⬅ слева', 'справа ➡']],
    ]);
    expect(byLabel(c, '🎯 залп')).toMatchObject({ sub: 'готово', disabled: false, kind: 'qa' });
    expect(byLabel(c, '🏹 меткий выстрел')).toMatchObject({ sub: 'через 2 хода', disabled: true });
    expect(byLabel(c, '🏹 выстрел').cls).toEqual(expect.arrayContaining(['main', 'big']));
    expect(byLabel(c, 'рядовые').pressed).toBe(true);
    expect(byLabel(c, '🏃 Бежать').tip).toContain('ударить в спину');
    expect(flat(c).some((b) => b.key.includes('"eat"') || b.key.includes('"join"'))).toBe(false);
    expect(c.say).toMatchObject({ label: 'Команда в поход', placeholder: 'Команда в поход: удар, лечить, 2…', busy: false });
    expect(c.say!.hint).toContain('Enter');
    expect(hotButtons(c).map((b) => b.label)).toEqual(['🏃 Бежать', '🏹 выстрел', '🎯 залп']);
  });
  it('the main button: one click on the site element → one X.act; «отправлено…» and disabled buttons mirrored; «принято» after', async () => {
    vi.useFakeTimers();
    try {
      const { tab, fs } = site('battle'); fs.answerMs = 500;
      const main = byLabel(readSite(tab), '🏹 выстрел');
      expect(press(tab, main.key)).toEqual({ r: 'clicked', clicks: 1 });
      expect(fs.log).toEqual([{ via: 'act', p: { k: 'b', a: 'base' } }]);
      let c = readSite(tab);
      expect(c.lines).toContainEqual({ cls: 'wait', text: 'отправлено: выстрел…' });
      expect(flat(c).filter((b) => b.kind === 'qa').every((b) => b.disabled)).toBe(true);
      expect(byLabel(c, '🏹 выстрел').cls).toContain('wait');
      expect(c.hist.at(-1)).toMatchObject({ line: 'выстрел', st: 'wait', btn: true });
      // a second press while the site says «отправлено» finds no enabled button: nothing is clicked
      expect(press(tab, main.key)).toEqual({ r: 'missing', clicks: 0 });
      expect(fs.log).toHaveLength(1);
      vi.advanceTimersByTime(600);
      c = readSite(tab);
      expect(c.lines.map((l) => l.text)).toContain('ход принят: выстрел');
      expect(c.hist.at(-1)).toMatchObject({ st: 'ok', msg: 'принято - ждём хода' });
      expect(byLabel(c, '🏹 выстрел').cls).toContain('ok');
    } finally { vi.useRealTimers(); }
  });
  it('declined by the game: the red state and the answer are mirrored', async () => {
    vi.useFakeTimers();
    try {
      const { tab, fs } = site('battle'); fs.answerMs = 300; fs.decline = true;
      pressSite(tab, byLabel(readSite(tab), '🎯 залп').key);
      vi.advanceTimersByTime(400);
      const c = readSite(tab);
      expect(byLabel(c, '🎯 залп').cls).toContain('bad');
      expect(c.hist.at(-1)).toMatchObject({ st: 'no', msg: 'игра не приняла' });
    } finally { vi.useRealTimers(); }
  });
  it('toggles are the site\'s: side «справа» changes the payload the site sends', () => {
    const { tab, fs } = site('battle');
    expect(press(tab, 'qsel:s|R').clicks).toBe(1);
    expect(press(tab, 'qsel:lead|1').clicks).toBe(1);
    const c = readSite(tab), main = byLabel(c, /выстрел → вожак/);
    expect(main.label).toBe('🏹 выстрел → вожак · справа ➡');
    expect(byLabel(c, 'справа ➡').pressed).toBe(true);
    pressSite(tab, main.key);
    expect(fs.log).toEqual([{ via: 'act', p: { k: 'b', a: 'base', t: 'lead', s: 'R' } }]);
  });
  it('flee is a two-press place button (the site arms first, sends the line on the second)', () => {
    const { tab, fs } = site('battle');
    const flee = byLabel(readSite(tab), '🏃 Бежать');
    pressSite(tab, flee.key);
    expect(fs.log).toEqual([]);
    const c = readSite(tab);
    expect(byLabel(c, '🏃 Бежать')).toMatchObject({ sub: 'ещё раз - точно', cls: expect.arrayContaining(['urge']) });
    expect(c.lines).toContainEqual({ cls: 'warn', text: '⚠ Точно бежать? Враг может ударить в спину - получишь урон' });
    pressSite(tab, flee.key);
    expect(fs.log).toEqual([{ via: 'say', line: 'бежать' }]);
  });
  it('the enemy turn: nothing to press — the word is typed in the site\'s line', () => {
    const { tab, fs } = site('battle-tele');
    const c = readSite(tab);
    expect(c.groups).toEqual([]);
    expect(c.say).not.toBeNull();
    expect(feedSiteSay(tab, 'щит')).toBe('sent');
    expect(fs.log).toEqual([{ via: 'say', line: 'щит' }]);
    const card = cardOf(mockById('battle-tele')!.build({ login: 'me', role: 'archer', now: Date.now() }) as never, { login: 'me', role: 'archer' }, () => 'выстрел');
    expect(card?.urge?.kind).toBe('word');
  });
});

describe('path vote, join', () => {
  it('the vote is the site\'s option button ([data-qv] → its X.vote); join stays in the squad block', () => {
    const { tab, fs } = site('map-vote');
    expect(readSite(tab).groups).toEqual([]);
    expect(press(tab, 'qv:9001:2')).toEqual({ r: 'clicked', clicks: 1 });
    expect(fs.log).toEqual([{ via: 'vote', vid: 9001, n: 2 }]);
    expect(pressSite(tab, 'qv:9001:7')).toBe('missing');
    expect(fs.log).toHaveLength(1);
  });
  it('the vote is clickable for the party without the flag too (voteHtml can)', () => {
    const { tab, fs } = site('map-vote', false);
    expect(pressSite(tab, 'qv:9001:3')).toBe('clicked');
    expect(fs.log).toEqual([{ via: 'vote', vid: 9001, n: 3 }]);
  });
});

describe('rune door 2 (qaRune2): the pad, the code, the vote', () => {
  it('digits are the site\'s pad; «Ввести код» sends the typed code once', () => {
    const { tab, fs } = site('rune-door');
    let c = readSite(tab);
    const pad = c.groups.find((g) => g.kind === 'pad')!;
    expect(pad.btns.map((b) => b.label)).toEqual(['1', '2', '3', '4', '5', '6', '⌫']);
    expect(byLabel(c, 'Ввести код').disabled).toBe(true);
    expect(hotButtons(c).map((b) => b.label)).toEqual([]);   // the pad is not on 1–4 (digits are its own)
    for (const d of ['3', '1', '4', '1']) expect(press(tab, `qdig:${d}`).clicks).toBe(1);
    c = readSite(tab);
    expect(c.displays).toEqual(['Набрано: 3141 · 4 из 4 · цифры 1–6']);
    expect(c.groups.find((g) => g.kind === 'pad')!.btns.filter((b) => b.disabled).map((b) => b.label)).toEqual(['1', '2', '3', '4', '5', '6']);
    expect(byLabel(c, 'Ввести код').disabled).toBe(false);
    expect(press(tab, byLabel(c, 'Ввести код').key).clicks).toBe(1);
    expect(fs.log).toEqual([{ via: 'act', p: { k: 'tr', a: 'code', s: '3141' } }]);
  });
  it('the vote «забрать / дальше»', () => {
    const { tab, fs } = site('rune-vote');
    const c = readSite(tab);
    expect(flat(c).map((b) => b.label)).toEqual(['💰 Забрать', '🚪 Дальше · награда ×2']);
    pressSite(tab, byLabel(c, '🚪 Дальше · награда ×2').key);
    expect(fs.log).toEqual([{ via: 'act', p: { k: 'tr', a: 'next' } }]);
  });
});

describe('puzzles (pzHtml): buttons for cups, the line for riddles', () => {
  it('cups: three answer buttons → the site\'s line «2»', () => {
    const { tab, fs } = site('pz-cups');
    const c = readSite(tab);
    expect(flat(c).map((b) => [b.kind, b.label])).toEqual([['qpb', 'Кубок 1'], ['qpb', 'Кубок 2'], ['qpb', 'Кубок 3']]);
    expect(c.hint).toBe('Кнопки ниже = команды чата, чат тоже работает');
    pressSite(tab, 'qpb:2');
    expect(fs.log).toEqual([{ via: 'say', line: '2' }]);
    expect(readSite(tab).hist.at(-1)).toMatchObject({ line: '2', st: 'wait', btn: true });
  });
  it('riddle: typed — the site\'s hint, the line goes through the site\'s form; a second line while one is in flight is held by the site', () => {
    const { tab, fs } = site('pz-riddle');
    const c = readSite(tab);
    expect(c.groups).toEqual([]);
    expect(c.hint).toBe('Напечатай ответ в строке команд внизу - или в чат');
    expect(feedSiteSay(tab, '  огурец ')).toBe('sent');
    expect(fs.log).toEqual([{ via: 'say', line: 'огурец' }]);
    expect(readSite(tab).say!.busy).toBe(true);
    expect(feedSiteSay(tab, 'дом')).toBe('held');
    expect(fs.log).toHaveLength(1);
    expect(readSite(tab).hist.at(-1)).toMatchObject({ st: 'note', msg: 'подожди - прошлая строка ещё в пути' });
  });
  it('no command line on the site → «missing», nothing sent', () => {
    const { tab, fs } = site('pz-riddle', false);
    expect(feedSiteSay(tab, 'огурец')).toBe('missing');
    expect(fs.log).toEqual([]);
  });
});

describe('Halloween: the skeleton dance chain', () => {
  it('step buttons build the chain on the site; «Отправить» sends it as one line, once', () => {
    const { tab, fs } = site('skeldance');
    let c = readSite(tab);
    expect(flat(c).map((b) => [b.label, b.disabled])).toEqual([['влево · л', false], ['вправо · п', false], ['прыг · в', false], ['хлоп · х', false], ['⌫', true], ['Отправить', true]]);
    expect(hotButtons(c).map((b) => b.key)).toEqual(['qhw:l', 'qhw:r', 'qhw:j', 'qhw:c']);
    for (const k of ['l', 'c', 'c', 'j', 'r']) pressSite(tab, `qhw:${k}`);   // the 5th is refused by the site (chain of 4)
    pressSite(tab, 'qhw:<'); pressSite(tab, 'qhw:r');
    c = readSite(tab);
    expect(c.displays).toEqual(['Твоя цепочка · 4 из 4: влево → хлоп → хлоп → вправо']);
    const send = byLabel(c, 'Отправить');
    expect(send).toMatchObject({ disabled: false, sub: 'влево хлоп хлоп вправо', kind: 'qpb' });
    expect(fs.log).toEqual([]);
    expect(press(tab, send.key).clicks).toBe(1);
    expect(fs.log).toEqual([{ via: 'say', line: 'влево хлоп хлоп вправо' }]);
  });
});

describe('goblin fair (gobHtml) and events (qaEvent)', () => {
  it('bets are ready lines «ставка N»', () => {
    const { tab, fs } = site('gob-bet');
    const c = readSite(tab);
    expect(flat(c).map((b) => b.key)).toEqual(['qpb:ставка 10', 'qpb:ставка 30', 'qpb:ставка 50', 'qpb:ставка 100']);
    expect(byLabel(c, '🪙 100').sub).toBe('максимум');
    pressSite(tab, 'qpb:ставка 50');
    expect(fs.log).toEqual([{ via: 'say', line: 'ставка 50' }]);
  });
  it('shell game guesses', () => {
    const { tab, fs } = site('gob-shell');
    expect(flat(readSite(tab)).map((b) => b.label)).toEqual(['1', '2', '3']);
    pressSite(tab, 'qpb:3');
    expect(fs.log).toEqual([{ via: 'say', line: '3' }]);
  });
  it('traveler: help / rob → X.act; the choice is shown as the site shows it', async () => {
    vi.useFakeTimers();
    try {
      const { tab, fs } = site('ev-traveler'); fs.answerMs = 100;
      pressSite(tab, byLabel(readSite(tab), '🤝 Помочь').key);
      expect(fs.log).toEqual([{ via: 'act', p: { k: 'ev', a: 'help' } }]);
      vi.advanceTimersByTime(200);
      const c = readSite(tab);
      expect(c.lines).toContainEqual({ cls: 'ok', text: 'принято: помочь' });
      expect(byLabel(c, '🤝 Помочь')).toMatchObject({ disabled: true, cls: expect.arrayContaining(['on']) });
    } finally { vi.useRealTimers(); }
  });
  it('dice: the bet chips are the site\'s toggles; «Играть» sends the chosen bet', () => {
    const { tab, fs } = site('ev-dice');
    let c = readSite(tab);
    expect(c.groups.map((g) => [g.kind, g.title || ''])).toEqual([['sel', 'Быстрая ставка'], ['row', '']]);
    pressSite(tab, 'qsel:bet|50');
    c = readSite(tab);
    expect(byLabel(c, '50').pressed).toBe(true);
    pressSite(tab, byLabel(c, /Играть/).key);
    expect(fs.log).toEqual([{ via: 'act', p: { k: 'ev', a: 'bet', n: 50 } }]);
  });
});

describe('helpers', () => {
  it('chat chips', () => {
    expect(chatChips('удар')).toEqual(['удар']);
    expect(chatChips('Кубок 1 / Кубок 2 / Кубок 3')).toEqual(['Кубок 1', 'Кубок 2', 'Кубок 3']);
    expect(chatChips('1–4')).toEqual(['1', '2', '3', '4']);
    expect(chatChips('  ')).toEqual([]);
  });
  it('a missing / disabled element is never clicked; the bag and the header are not searched', () => {
    const { tab } = site('battle');
    expect(press(tab, 'qa:{"k":"eat","uid":"u1"}')).toEqual({ r: 'missing', clicks: 0 });
    expect(press(tab, 'qa:{"k":"join"}')).toEqual({ r: 'missing', clicks: 0 });
    expect(findSite(tab, 'qa:{"k":"b","a":"sk","w":"меткий выстрел"}')).toBeNull();
    expect(findSite(null, 'qpb:2')).toBeNull();
  });
  it('every fake stage pairs with a demo view of the 3D card', () => {
    for (const s of FAKE_STAGES) expect(mockById(FAKE_MOCK[s]), s).toBeTruthy();
  });
  it('our code builds no request: no fetch / api paths in the HUD and the mirror', () => {
    for (const f of ['src/quest/siteui.ts', 'src/quest/index.ts']) {
      const src = readFileSync(f, 'utf8');
      expect(src, f).not.toMatch(/fetch\(|XMLHttpRequest|\/api\/|actions\.post|actions\.get|actions\.say/);
    }
  });
});
