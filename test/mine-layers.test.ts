import { describe, it, expect } from 'vitest';
import { LAYERS12, layerIx, layerOf, layerSpan, layerBanner, themeOf, mixHex } from '../src/rooms/mine/layers';
import { minePal } from '../src/rooms/mine/art';
import { estimateStone, promptEcon, type StoneEstimate } from '../src/rooms/mine/econ';
import { floorOf, type MineView } from '../src/rooms/mine/state';
import { helpParts, topHtml, queueHtml, WEEK_REWARDS } from '../src/rooms/mine/hud';
import enter from './fixtures/mine-enter.json';

describe('12 depth layers (site mine-biome.js THEMES)', () => {
  it('every 5 floors a new layer, names and spans as the site', () => {
    expect(LAYERS12).toHaveLength(12);
    expect(layerOf(1).name).toBe('Корневые норы');
    expect(layerOf(5).id).toBe('roots'); expect(layerOf(6).id).toBe('clay');
    expect(layerOf(25).name).toBe('Грибные гроты'); expect(layerOf(26).name).toBe('Пылающая бездна');
    expect(layerOf(60).id).toBe('mirror'); expect(layerOf(61).id).toBe('heart'); expect(layerOf(500).id).toBe('heart');
    expect(layerSpan(layerOf(27))).toBe('26–30'); expect(layerSpan(layerOf(70))).toBe('61 и глубже');
    expect(layerIx(0)).toBe(0);
  });
  it('a banner only when the mine goes down into a new layer', () => {
    expect(layerBanner(null, 6)).toBe('');
    expect(layerBanner(4, 5)).toBe('');
    expect(layerBanner(25, 26)).toBe('Шахта спустилась в Пылающую бездну (этажи 26–30)');
    expect(layerBanner(35, 36)).toBe('Шахта спустилась к Подземному озеру (этажи 36–40)');
    expect(layerBanner(30, 1)).toBe('');   // a new week starts over: no banner
  });
  it('nature tint as the site (mix by k; mount untinted)', () => {
    expect(mixHex('#000000', '#ffffff', 0.5)).toBe('#808080');
    expect(themeOf(3, 'mount').wall).toBe('#5c4330');
    expect(themeOf(3, 'meadow').wall).toBe(mixHex('#5c4330', '#a8b84a', 0.16));
    expect(themeOf(3, 'meadow').floor).toBe(mixHex('#7c6046', '#a8b84a', 0.16 * 0.8));
  });
  it('the 3D palette follows the layer; the old palettes stay behind the switch', () => {
    const a = minePal('mount', 3), b = minePal('mount', 27);
    expect(a.rock).toEqual(themeOf(3, 'mount').rock);
    expect(b.rock).toEqual(themeOf(27, 'mount').rock);
    expect(a.wall).not.toBe(b.wall);
    expect(minePal('meadow', 25, false).floor).toBe('#6a5a40');   // the older per-nature palette
  });
});

describe('crosshair prompt estimate (#8)', () => {
  it('«≈ 34 мин · доля ≈ 3 % · ≈ 0,9 ⦿/ч», parts without data left out', () => {
    const e: StoneEstimate = { estimated: true, minutes: 33.2, diggers: 9, share: 0.031, pieces: 0.4, coins: 0.5, coinsPerHour: 0.9, samples: 4 };
    expect(promptEcon(e)).toBe('≈ 34 мин · доля ≈ 3 % · ≈ 0,9 ⦿/ч');
    expect(promptEcon({ ...e, coinsPerHour: null })).toBe('≈ 34 мин · доля ≈ 3 %');
    expect(promptEcon({ ...e, minutes: null, share: null, coinsPerHour: null })).toBe('');
  });
  it('on the captured mine every front stone gets at least the time', () => {
    const st = (enter as any).st as MineView, F = floorOf(st)!;
    for (const i of st.front || []) expect(promptEcon(estimateStone(st, F.cells[i], st.at))).toMatch(/^(≈ \d+ (мин|ч)|< 1 мин)/);
  });
});

describe('help, weekly results, queue line (display only)', () => {
  it('«Как устроена шахта» follows the site HELP with 3D controls', () => {
    const p = helpParts({ lampFrom: 4, darkFrom: 5, cap: 600, pick: true, q2: true, queue: true, n: 25 });
    const all = p.map(([h, l]) => h + ' ' + l.join(' ')).join(' ');
    expect(p.map(([h]) => h)).toEqual(['Копать', 'Этажи', 'Добыча', 'Скупщик', 'Кирка и рудная сумка', 'Темнота и каска', 'Время']);
    expect(all).toContain('нажми E'); expect(all).toContain('Shift+E'); expect(all).toContain('«Грибные гроты» (этажи 21–25)');
    expect(all).toContain('до 10 ч 0 мин в сутки');
    expect(all).toContain(WEEK_REWARDS.map(([f, c]) => `${f}-й этаж — ${c}`).join(', '));
    const short = helpParts({ lampFrom: 4, darkFrom: 5, cap: 0, pick: false, q2: false, queue: false, n: 1 });
    expect(short.map(([h]) => h)).not.toContain('Кирка и рудная сумка');
    expect(short.flatMap(([, l]) => l).join(' ')).not.toContain('Shift+E');
  });
  it('«Итоги шахты» from the current view, own row marked, last week shown', () => {
    const st = { ...(enter as any).st, hist: [{ floor: 31, players: 520, top: [{ l: 'player19', u: 900 }] }] } as MineView;
    const h = topHtml(st, 'Player37');
    expect(h).toContain('Лучшие копатели недели'); expect(h).toContain('player37 (ты)'); expect(h).toContain('Прошлая неделя — до этажа 31, копателей: 520');
    expect(h).toContain('<b>25</b><span>этаж сейчас</span>');
    expect(topHtml({ ...st, top: [], hist: [] } as MineView, 'x')).toContain('Пока никто не копал');
  });
  it('queue line: places in order, hint when empty, nothing when the flag is off', () => {
    const F = floorOf((enter as any).st)!;
    expect(queueHtml(false, [3], F.cells)).toBe('');
    expect(queueHtml(true, [], F.cells)).toContain('в очередь (до 2)');
    const h = queueHtml(true, [3, 7], F.cells);
    expect(h.indexOf('>1</i>')).toBeLessThan(h.indexOf('>2</i>')); expect(h).toContain('Дальше');
  });
});
