/**
 * Site update 08.11 (night): quest.js — the «😫 Отряд ослаб…» line (`v.wk`), the place buttons by role / fight / lair move
 * (pbHtml: GROUPS, PB_ATK, `legion` = legionary, `lair.acted`), the priest's «магия»; battle.js — FOE_TWO slots carry a `side`.
 * When a downloaded site copy is around (.local/site-*), the site's own wkHtml / lwHtml / pbHtml / FOE_TWO run here (node:vm)
 * and our code is compared with what they produce; the fixture checks below run either way.
 */
import { describe, it, expect } from 'vitest';
import vm from 'node:vm';
import { questWarnings, placeButtons, battleFronts, foeSideOf, FOE_TWO_SIDE, PB_GROUPS, normBattle, type PlaceButton } from '../src/quest/model';
import { adapt, Roster } from '../src/expedition/adapter';
import { cardOf } from '../src/quest';
import { readSite } from '../src/quest/siteui';
import { siteCopy, fnSource } from './site-quest-fns';
import { MEl } from './minidom';

const esc = (s: unknown) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const text = (h: string) => h.replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').trim();
/** `const name = …;` — one statement of the site copy (its arrow helpers are one line each). */
const constSrc = (src: string, name: string): string | null => {
  const at = src.indexOf(`const ${name} =`); if (at < 0) return null;
  const end = src.indexOf('\n', at); return src.slice(at, end < 0 ? undefined : end);
};

const QJ = siteCopy('quest.js', 'const PB_ATK');
const BJ = siteCopy('battle.js', "side: 'L'");

/** the site's wkHtml / lwHtml */
function siteWarn(): ((v: unknown) => string[]) | null {
  if (!QJ) return null;
  const wk = constSrc(QJ, 'wkHtml'), lw = constSrc(QJ, 'lwHtml');
  if (!wk || !lw) return null;
  const ctx: Record<string, unknown> = { esc };
  vm.createContext(ctx);
  vm.runInContext(`${wk}\n${lw}\nglobalThis.__f = (v) => [lwHtml(v, 'q-dg'), wkHtml(v, 'q-dg')];`, ctx, { timeout: 5000 });
  const f = ctx.__f as (v: unknown) => string[];
  return (v) => f(v).filter(Boolean).map(text);
}

/** the site's pbHtml with its own meIn / deadIn, the hero's role and qa on */
function sitePb(): ((v: unknown, role: string) => string) | null {
  if (!QJ) return null;
  const parts = ['meIn', 'deadIn', 'pbWarn', 'pbTip', 'pbHtml'].map((n) => fnSource(QJ, n));
  const consts = ['GROUPS', 'PB_ATK'].map((n) => constSrc(QJ, n));
  if (parts.some((p) => !p) || consts.some((c) => !c)) return null;
  // q2On: quest.js 08.11 afternoon (hero.q2 — off here; test/site-1108b.test.ts runs it on)
  const ctx: Record<string, unknown> = { esc, qaOn: () => true, q2On: () => false, lineSt: () => '', PBA: { k: '', at: 0 }, Date, Set, String, Math, X: null };
  vm.createContext(ctx);
  vm.runInContext(`${consts.join('\n')}\n${parts.join('\n')}\nglobalThis.__f = pbHtml;`, ctx, { timeout: 5000 });
  return (v, role) => { ctx.X = { say: () => {}, login: () => 'player1', hero: () => ({ role, money: 100 }), moneyText: (n: number) => `${n} м` }; return (ctx.__f as (v: unknown) => string)(v); };
}
/** the site's markup → what our HUD mirrors (readSite on a fake tab) */
function mirror(html: string) {
  const tab = new MEl('section'); tab.setAttribute('id', 'tab-quest');
  tab.innerHTML = `<div class="q-wrap">${html}</div>`;
  return readSite(tab as unknown as Element);
}

const ROLES_ALL = 'legionary,archer,mage,priest,rogue,necromancer,paladin,recruit';
const PB: PlaceButton[] = [
  { t: 'удар', l: '⚔️ удар', g: 'act', x: { k: 'cls', role: 'legionary,rogue,paladin,recruit' } },
  { t: 'выстрел', l: '🏹 выстрел', g: 'act', x: { k: 'cls', role: 'archer' } },
  { t: 'магия', l: '✨ магия', g: 'act', x: { k: 'cls', role: 'mage,necromancer' } },
  { t: 'лечить', l: '✚ лечить', g: 'act', x: { k: 'cls', role: 'priest' } },
  { t: 'щит', l: '🛡 щит', g: 'act', x: { role: 'legionary,paladin' } },
  { t: 'прикрыть', l: '🤝 прикрыть · Барсик', g: 'tg' },
  { t: 'бежать', l: '🏃 Бежать', c: 'warn', g: 'esc', x: { k: 'flee' } },
  { t: 'откуп', l: '💰 Откуп', c: 'warn', g: 'esc', x: { k: 'pay', pct: 10 } },
  { t: 'хватаю', l: '✋ хватаю', c: 'main', x: { role: ROLES_ALL } },
];
const battle = (b: Record<string, unknown> = {}, extra: Record<string, unknown> = {}): any => ({ on: true, k: 'battle', t: 'Лес', party: 'in', n: 3,
  b: { id: 9, round: 1, maxR: 5, st: 'party', until: 1, hp: 0.9, me: 0, form: [['player1', 'legionary', 'R']], foes: [['R', 'wolf', 0, 1]], ...b }, pb: { b: PB }, ...extra });

describe('quest.js wkHtml (08.11): «😫 Отряд ослаб после неудачного привала»', () => {
  const W = siteWarn();
  const views: any[] = [{ wk: [2, 15] }, { wk: [1, 10] }, { wk: [0, 5] }, { wk: [3, 20], dg: 'Смерть — потеря вещей', lw: [['Меч', 12], ['Щит', 30]] }, {}];
  it('the same words as the site, the plural by the count, nothing for 0 left', () => {
    expect(questWarnings({ wk: [2, 15] })).toEqual(['😫 Отряд ослаб после неудачного привала: урон −15% · ещё 2 локации']);
    expect(questWarnings({ wk: [1, 10] })).toEqual(['😫 Отряд ослаб после неудачного привала: урон −10% · ещё 1 локация']);
    expect(questWarnings({ wk: [0, 5] })).toEqual([]);
    expect(questWarnings(null)).toEqual([]);
  });
  it.skipIf(!W)('the site copy renders the same lines (lw then wk; dg is the plain «⚠ …» line)', () => {
    for (const v of views) expect(questWarnings(v).filter((l) => !l.startsWith('⚠ ' + (v.dg || '\0')))).toEqual(W!(v));
  });
  it('the HUD card shows them under the title of any view (not on the empty-party card)', () => {
    const me = { login: 'player1', role: 'legionary' }, base = () => 'удар';
    expect(cardOf({ on: true, k: 'map', party: 'in', wk: [2, 15] } as any, me, base)!.warn).toEqual(['😫 Отряд ослаб после неудачного привала: урон −15% · ещё 2 локации']);
    expect(cardOf(battle({}, { wk: [1, 10], dg: 'опасно' }), me, base)!.warn).toEqual(['⚠ опасно', '😫 Отряд ослаб после неудачного привала: урон −10% · ещё 1 локация']);
    expect(cardOf({ on: true, k: 'map', party: 'in' } as any, me, base)!.warn).toBeUndefined();
    expect(cardOf({ on: true, k: 'gather', nb: 1, wk: [2, 15] } as any, me, base)!.warn).toBeUndefined();
  });
});

describe('quest.js pbHtml (08.11): the place buttons by role, fight and lair move, in the site\'s groups', () => {
  const P = sitePb();
  const cases: [string, any, string][] = [
    ['legionary in the fight', battle(), 'legionary'],
    ['`legion` counts as legionary', battle(), 'legion'],
    ['priest', battle({ form: [['player1', 'priest', 'R']] }), 'priest'],
    ['archer', battle({ form: [['player1', 'archer', 'R']] }), 'archer'],
    ['a role with no class attack → every class attack comes back', battle(), 'bard'],
    ['no role → recruit', battle(), ''],
    ['not in this fight → no «Помочь своим» / «Уйти из боя»', battle({ hp: null, me: -1 }), 'legionary'],
    ['in reserve → all groups', battle({ me: -1 }), 'legionary'],
    ['fallen → nothing', battle({ hp: 0 }), 'legionary'],
    ['lair, move made → no act group', { on: true, k: 'boss', party: 'in', lair: { acted: true, st: 'party', hp: 0.8 }, pb: { b: PB } }, 'mage'],
    ['lair, no move yet', { on: true, k: 'boss', party: 'in', lair: { acted: false, st: 'party', hp: 0.8 }, pb: { b: PB } }, 'mage'],
  ];
  it('our filter (fixtures)', () => {
    const t = (v: any, r: string) => placeButtons(v, r).map((x) => x.t);
    expect(t(battle(), 'legionary')).toEqual(['хватаю', 'прикрыть', 'удар', 'щит', 'бежать', 'откуп']);
    expect(t(battle(), 'legion')).toEqual(t(battle(), 'legionary'));
    expect(t(battle(), 'priest')).toEqual(['хватаю', 'прикрыть', 'лечить', 'бежать', 'откуп']);
    expect(t(battle(), 'bard')).toEqual(['прикрыть', 'удар', 'выстрел', 'магия', 'лечить', 'бежать', 'откуп']);
    expect(t(battle({ hp: null, me: -1 }), 'legionary')).toEqual(['хватаю', 'удар', 'щит']);
    expect(t(battle({ hp: 0 }), 'legionary')).toEqual([]);
    expect(t({ on: true, lair: { acted: true }, pb: { b: PB } }, 'mage')).toEqual(['хватаю', 'прикрыть', 'бежать', 'откуп']);
    expect(PB_GROUPS.map((g) => g[1])).toEqual(['', 'Помочь своим', '', 'Уйти из боя']);
  });
  it.skipIf(!P).each(cases)('the site copy shows the same buttons in the same groups — %s', (_n, v, role) => {
    const html = P!(v, role), S = mirror(html);
    const ours = placeButtons(v, role);
    // the buttons, in order: the site's data-qpb lines = our list; labels as the site wrote them
    expect(S.groups.flatMap((g) => g.btns.map((b) => b.key))).toEqual(ours.map((x) => 'qpb:' + x.t));
    expect(S.groups.flatMap((g) => g.btns.map((b) => b.label))).toEqual(ours.map((x) => x.l));
    // the groups and their titles: one per non-empty site group, in GROUPS order
    const want = PB_GROUPS.filter(([g]) => ours.some((x) => (x.g || '') === g)).map(([, title]) => title || undefined);
    expect(S.groups.map((g) => g.title)).toEqual(want);
    // warn buttons stay two-press on the site (data-qpbc=warn), our mirror keeps the class
    for (const b of S.groups.flatMap((g) => g.btns)) if (ours.find((x) => 'qpb:' + x.t === b.key)!.c === 'warn') expect(b.cls).toContain('warn');
  });
  it('the 3D strip (typed in chat) lists only those lines — no «лечить» for a legionary, no «бежать» out of the fight', () => {
    const c = { login: 'player1', role: 'legionary', roster: new Roster() };
    const said = (v: any, r = c) => adapt(v, r).cmds.map((x) => x.text);
    const a = said(battle());
    expect(a).not.toContain('лечить'); expect(a).not.toContain('выстрел');
    expect(a).toContain('бежать');
    const out = said(battle({ hp: null, me: -1 }));
    expect(out).not.toContain('бежать'); expect(out).not.toContain('прикрыть');
    const pr = said(battle({ form: [['player1', 'priest', 'R']] }), { ...c, role: 'priest' });
    expect(pr).toContain('лечить'); expect(pr).not.toContain('щит');
  });
});

describe('battle.js FOE_TWO (08.11 side): the ambush puts the foes on both sides', () => {
  it.skipIf(!BJ)('our slot sides = the site copy\'s FOE_TWO sides', () => {
    const s = constSrc(BJ!, 'FOE_TWO')!;
    const ctx: Record<string, unknown> = {}; vm.createContext(ctx);
    vm.runInContext(`${s.replace(/,\s*wing\s*=.*$/, ';')}\nglobalThis.__f = FOE_TWO;`, ctx, { timeout: 5000 });
    const T = ctx.__f as { side: string; flip?: boolean }[];
    expect(T.map((p) => p.side)).toEqual([...FOE_TWO_SIDE]);
    for (const p of T) expect(!!p.flip).toBe(p.side === 'L');   // L slots face right (flipped) on the site
  });
  it('fronts: `two` → L + R even when cr.fr names one side; cr.fr with 2+ wins', () => {
    expect(battleFronts({ two: true, cr: { fr: ['R'] } })).toEqual(['L', 'R']);
    expect(battleFronts({ two: true })).toEqual(['L', 'R']);
    expect(battleFronts({ two: true, cr: { fr: ['L', 'R', 'F'] } })).toEqual(['L', 'R', 'F']);
    expect(battleFronts({ cr: { fr: ['R'] } })).toEqual(['R']);
    expect(battleFronts({})).toEqual(['R']);
  });
  it('foe side: the server\'s f[0] when it is a front, else the stream\'s slot (two: R, L, R, L…, others: R, L, F in turn)', () => {
    const two = { two: true }, fr = battleFronts(two);
    expect([0, 1, 2, 3, 4, 5, 6, 7].map((i) => foeSideOf(two, '', i, fr))).toEqual(['R', 'L', 'R', 'L', 'R', 'L', 'R', 'R']);
    expect(foeSideOf(two, 'L', 0, fr)).toBe('L');
    const ring = { cr: { fr: ['L', 'R', 'F'] } }, f3 = battleFronts(ring);
    expect([0, 1, 2, 3].map((i) => foeSideOf(ring, undefined, i, f3))).toEqual(['R', 'L', 'F', 'R']);
    expect(foeSideOf({}, 'L', 0, ['R'])).toBe('R');
  });
  it('the 3D battle state: an ambush with one-sided cr.fr and foes without a side stands on both sides', () => {
    const v = battle({ two: true, cr: { fr: ['R'] }, form: [['player1', 'legionary', 'L'], ['p2', 'archer', 'R']], foes: [['', 'wolf', 0, 1], ['', 'wolf', 0, 1], ['', 'boar', 0, 1], [null, 'boar', 0, 1]] });
    const s = adapt(v, { login: 'player1', role: 'legionary', roster: new Roster() });
    expect(s.battle!.fronts).toEqual(['L', 'R']);
    expect(s.battle!.multi).toBe(true);
    expect(s.battle!.foes.map((f) => f.side)).toEqual(['R', 'L', 'R', 'L']);
    expect(s.party.map((m) => m.side)).toEqual(['L', 'R']);
    expect(s.cmds.map((c) => c.text)).toContain('удар лево');
    expect(normBattle(v.b, 'legionary').foes.map((f) => f.side)).toEqual(['R', 'L', 'R', 'L']);
  });
});
