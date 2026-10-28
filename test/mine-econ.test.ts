import { describe, expect, it } from 'vitest';
import { estimateStone, contributionShare, minerRate, valueCoins, workAtLevel, yieldOf, ruNum, etaText, shareText, signText } from '../src/rooms/mine/econ';
import { applyEconDemo, demoFromQuery } from '../src/rooms/mine/fake';
import { floorOf, type MineView } from '../src/rooms/mine/state';
import captured from './fixtures/mine-enter.json';

const st = captured.st as unknown as MineView;
const cells = floorOf(st)!.cells;

describe('mine economics (estimates only)', () => {
  it('uses remaining work and observed rate per minute with elapsed snapshot time', () => {
    const e = estimateStone(st, cells[11], st.at, 11);
    expect(e.estimated).toBe(true);
    expect(e.minutes).toBeCloseTo(st.bl!['11'][0] / st.bl!['11'][2]);
    expect(e.share).toBeCloseTo(1 / st.bl!['11'][3]);
    const later = estimateStone(st, cells[11], st.at + 60_000, 11);
    expect(later.minutes).toBeCloseTo(e.minutes! - 1);
  });
  it('never fabricates an estimate if no rates, history or prices exist', () => {
    const empty = { ...st, bl: {}, dl: [], bp: {} };
    const e = estimateStone(empty, cells[11], st.at);
    expect(e.minutes).toBeNull(); expect(e.coins).toBeNull(); expect(e.coinsPerHour).toBeNull();
    expect(workAtLevel(empty, 25)).toBeNull();
  });
  it('computes observed shares and converts shard counts to pieces', () => {
    expect(contributionShare({ alice: 2, bob: 6 }, 'ALICE')).toBeCloseTo(0.25);
    expect(contributionShare({ alice: 0 }, 'alice')).toBeNull();
    expect(yieldOf([[2, 25, 'iron', { alice: 0.5 }, { alice: 50 }]], 'iron')).toEqual({ pieces: 0.5, samples: 1 });
  });
  it('derives buyer value and projected coins per hour only from available observations', () => {
    const e = estimateStone(st, cells[11], st.at, 11);
    expect(e.coins).toBe((e.pieces || 0) * st.bp!.iron);
    expect(e.coinsPerHour).toBeCloseTo(e.coins! * 60 / e.minutes!);
    expect(minerRate(st, 11)).toBeCloseTo(st.bl!['11'][2] / st.bl!['11'][3]);
    expect(valueCoins(undefined, st.bp)).toBe(0);
    expect(valueCoins(0.5, st.bp)).toBe(0);
    expect(valueCoins(20, st.bp)).toBe(3);
  });
  it('formats sign numbers the Russian way and always as estimates', () => {
    expect(ruNum(0.9)).toBe('0,9'); expect(ruNum(12.4)).toBe('12'); expect(ruNum(0.0351)).toBe('0,035'); expect(ruNum(2.25)).toBe('2,3');
    expect(etaText(null)).toBeNull(); expect(etaText(0.4)).toBe('< 1 мин'); expect(etaText(33.2)).toBe('≈ 34 мин'); expect(etaText(80)).toBe('≈ 1 ч 20 мин'); expect(etaText(120)).toBe('≈ 2 ч');
    expect(shareText(0.031)).toBe('≈ 3 %'); expect(shareText(0.007)).toBe('≈ 0,7 %'); expect(shareText(null)).toBeNull();
    const base = { estimated: true as const, minutes: 33.2, diggers: 12, share: 0.031, pieces: 0.06, coins: 0.5, coinsPerHour: 0.9, samples: 5 };
    expect(signText(base, false)).toEqual({ main: '≈ 34 мин · 12 копают', share: 'твоя доля ≈ 3 %', perHour: '≈ 0,9' });
    expect(signText({ ...base, diggers: 1 }, true).main).toBe('≈ 34 мин · копаешь один');
    const none = signText({ ...base, minutes: null, share: null, coinsPerHour: null, diggers: 0 }, false);
    expect(none).toEqual({ main: 'темп ещё не измерен · никто не копает', share: 'твоя доля — мало данных', perHour: null });
  });
  it('econ demo keeps a measured rate and diggers on every front stone', () => {
    expect(demoFromQuery('?econ=1').econ).toBe(true); expect(demoFromQuery('?news=1').econ).toBeUndefined();
    const v = JSON.parse(JSON.stringify(st)) as MineView, now = st.at + 3 * 86400e3;
    v.bl = { '11': [...st.bl!['11']] as any }; v.dg = {};
    applyEconDemo(v, now);
    expect(v.at).toBe(now);
    const fc = floorOf(v)!.cells;
    for (const i of v.front!) {
      const b = v.bl![i]; expect(b[2]).toBeGreaterThan(0); expect(b[3]).toBeGreaterThan(0); expect(b[0]).toBeGreaterThan(0);
      const e = estimateStone(v, fc[i], now);
      expect(e.minutes).toBeGreaterThan(0); expect(e.share).toBeGreaterThan(0); expect(e.diggers).toBe(b[3]);
    }
    expect(v.bl!['11'][2]).toBe(st.bl!['11'][2]);                      // captured rate kept
    expect(v.bl!['11'][0]).toBeGreaterThanOrEqual(st.bl!['11'][1] * 0.35 - 1e-9);
    const again = JSON.parse(JSON.stringify(v)) as MineView; applyEconDemo(again, now + 1000, false);
    expect(again.bl).toEqual(v.bl);                                      // later calls only fill new stones
  });
});
