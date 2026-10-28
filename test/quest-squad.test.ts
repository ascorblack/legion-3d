/**
 * Join / leave the squad from the quest HUD (src/quest/index.ts): when the site offers it (quest.js qaSquad), and that a press only
 * ever clicks the site's OWN button (data-qa {k:'join'|'leave'} or the header's data-qleave), else opens the site's «Поход» tab.
 * Fake DOM: no request is sent by us in any path.
 */
import { describe, it, expect } from 'vitest';
import { squadOf, siteSquadButton, pressSiteSquad } from '../src/quest';

class El {
  disabled = false; clicks = 0;
  constructor(public attrs: Record<string, string>, private onClick?: () => void) {}
  getAttribute(k: string) { return k in this.attrs ? this.attrs[k] : null; }
  click() { this.clicks++; this.onClick?.(); }
}
class Doc {
  constructor(public els: El[]) {}
  querySelectorAll(sel: string) { const a = sel.replace(/^\[|\]$/g, ''); return this.els.filter((e) => a in e.attrs); }
  querySelector(sel: string) { return this.querySelectorAll(sel)[0] || null; }
}
const qa = (o: object) => JSON.stringify(o);

describe('quest HUD: join / leave the squad', () => {
  it('offers what the site offers (qaSquad)', () => {
    const map = { on: true, k: 'map', n: 6 } as any;
    expect(squadOf(map, 'out')).toEqual({ kind: 'join', label: 'Вступить в поход' });
    expect(squadOf({ ...map, cm: false }, 'out')).toMatchObject({ kind: 'join', label: 'Встать в очередь в отряд' });
    expect(squadOf(map, 'in')).toEqual({ kind: 'leave', label: 'Покинуть отряд' });
    expect(squadOf({ ...map, cm: false }, 'in')).toBeNull();          // marching: no «leave»
    expect(squadOf(map, 'q')).toMatchObject({ kind: 'info', text: expect.stringContaining('в очереди') });
    expect(squadOf(map, 'ghost')).toMatchObject({ kind: 'info', text: expect.stringContaining('призрак') });
    expect(squadOf({ ...map, vote: { id: 1, opts: [] } }, 'out')?.kind).toBe('join');
    // not in a running battle, trap, event, puzzle, boss, dungeon, lair, loot or shop
    expect(squadOf({ ...map, b: { st: 'party' } }, 'out')).toBeNull();
    expect(squadOf({ ...map, b: { st: 'end' } }, 'out')?.kind).toBe('join');
    for (const k of ['tr', 'ev', 'pz', 'bg', 'dgn', 'lair', 'loot']) expect(squadOf({ ...map, [k]: {} }, 'out'), k).toBeNull();
    expect(squadOf({ ...map, sh: { items: [{}] } }, 'out')).toBeNull();
    expect(squadOf(null, 'out')).toBeNull();
    expect(squadOf({ on: false } as any, 'out')).toBeNull();
  });

  it('finds the site\'s own button; skips disabled ones and other actions', () => {
    const vote = new El({ 'data-qa': qa({ k: 'vote', n: 1 }) }), busy = new El({ 'data-qa': qa({ k: 'join' }) }); busy.disabled = true;
    const join = new El({ 'data-qa': qa({ k: 'join', _l: 'вступить в поход' }) });
    expect(siteSquadButton(new Doc([vote, busy]) as any, 'join')).toBeNull();
    expect(siteSquadButton(new Doc([vote, busy, join]) as any, 'join')?.el).toBe(join);
    expect(siteSquadButton(new Doc([join]) as any, 'leave')).toBeNull();
    expect(siteSquadButton(new Doc([new El({ 'data-qa': '{bad json' })]) as any, 'join')).toBeNull();
  });

  it('a press clicks exactly the site button (once); without one it only opens the «Поход» tab', () => {
    const join = new El({ 'data-qa': qa({ k: 'join' }) }), other = new El({ 'data-qa': qa({ k: 'vote' }) });
    let panel = 0;
    expect(pressSiteSquad(new Doc([other, join]) as any, 'join', () => panel++)).toBe('clicked');
    expect(join.clicks).toBe(1); expect(other.clicks).toBe(0); expect(panel).toBe(0);
    expect(pressSiteSquad(new Doc([other]) as any, 'join', () => panel++)).toBe('panel');
    expect(panel).toBe(1); expect(other.clicks).toBe(0);
  });

  it('leave: the qaSquad button directly; the header «покинуть отряд?» gets its own second press (the site repaints in between)', () => {
    const lv = new El({ 'data-qa': qa({ k: 'leave' }) });
    pressSiteSquad(new Doc([lv]) as any, 'leave', () => { throw new Error('no panel'); });
    expect(lv.clicks).toBe(1);
    // layTop: the first press arms and repaints (a new element), the second confirms
    const doc = new Doc([]);
    const second = new El({ 'data-qleave': '' });
    const first = new El({ 'data-qleave': '' }, () => { doc.els = [second]; });
    doc.els = [first];
    expect(pressSiteSquad(doc as any, 'leave', () => { throw new Error('no panel'); })).toBe('clicked');
    expect(first.clicks).toBe(1); expect(second.clicks).toBe(1);
  });
});
