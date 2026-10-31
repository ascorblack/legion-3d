import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import classic, { VIEW_EVENT, TYPING_HOLD } from '../src/features/classic';

/**
 * F8 / «Классический сайт» while in a 3D room (QA 31.10: classic.ts left the room on every F8 — the 3D mine sent its
 * leave and the second F8 came back on the street). The room stays; the 3D is paused (no frames) while hidden.
 */
function setup(room: { current: string | null; kind: string | null }, pos: { site: [number, number] }) {
  const log: string[] = [];
  const ctl = { x: 500, y: 500, teleport: (x: number, y: number) => { log.push(`teleport:${x},${y}`); ctl.x = x; ctl.y = y; } };
  const ctx: any = {
    engine: { pause: (on: boolean) => log.push(`pause:${on}`) },
    input: { unlock: () => {}, setGameplay: (on: boolean) => log.push(`gameplay:${on}`), hold: (id: string, on: boolean) => log.push(`hold:${id}:${on}`) },
    site: { selfPos: () => pos.site, setClassic: (on: boolean) => log.push(`setClassic:${on}`) },
    hostEl: { style: { display: '' } }, uiRoot: { style: { display: '' } },
    state: { classic: false, overlay: null, overlayOver3d: false, menu: null },
    game: { classic: false },
    rooms: { ...room, exit() { log.push('rooms.exit'); this.current = null; this.kind = null; } },
    controller: () => ctl, me: { x: 0, y: 0 },
  };
  classic.setup(ctx);
  return { ctx, log, ctl };
}
let views: unknown[] = [];
beforeEach(() => {
  views = [];
  const w = new EventTarget(); w.addEventListener(VIEW_EVENT, (e) => views.push((e as CustomEvent).detail));
  vi.stubGlobal('window', w);
  vi.stubGlobal('document', { getElementById: () => null });
});
afterEach(() => { vi.unstubAllGlobals(); });

describe('classic toggle in a 3D room', () => {
  it('F8 in the 3D mine: the room is not left, the engine is paused (no rAF), F8 back keeps it — no teleport into room metres', () => {
    const t = setup({ current: 'mine', kind: 'mine3d' }, { site: [3000, 1000] });
    t.ctx.game.toClassic();
    expect(t.log).toEqual(['pause:true', 'gameplay:false', 'setClassic:true']);
    expect(t.ctx.rooms.current).toBe('mine');
    t.ctx.game.resume();
    expect(t.log).not.toContain('rooms.exit');
    expect(t.log.some((l) => l.startsWith('teleport'))).toBe(false);
    expect(t.log.slice(-2)).toEqual(['pause:false', 'gameplay:true']);
    expect(views).toEqual([{ classic: true, reason: undefined }, { classic: false, reason: undefined }]);
  });
  it('a site panel from the 3D menu is reported as reason «panel»', () => {
    const t = setup({ current: 'mine', kind: 'mine3d' }, { site: [0, 0] });
    t.ctx.game.classicPanel();
    expect(views).toEqual([{ classic: true, reason: 'panel' }]);
  });
  it('a 3D shop: kept when the 2D hero stayed, left when he walked away in 2D (the site changed scene)', () => {
    const pos = { site: [1000, 900] as [number, number] };
    const t = setup({ current: 'forge', kind: 'shop3d' }, pos);
    t.ctx.game.toClassic(); t.ctx.game.resume();
    expect(t.ctx.rooms.current).toBe('forge');
    t.ctx.game.toClassic(); pos.site = [1600, 900]; t.ctx.game.resume();
    expect(t.log).toContain('rooms.exit');
    expect(t.log).toContain('teleport:1600,900');
  });
  it('on the street: continues from the 2D position as before', () => {
    const pos = { site: [500, 500] as [number, number] };
    const t = setup({ current: null, kind: null }, pos);
    t.ctx.game.toClassic(); pos.site = [900, 520]; t.ctx.game.resume();
    expect(t.log).toContain('teleport:900,520');
  });
});

describe('F8 back with a text field focused (QA r3: gameplay came back under the focused chat)', () => {
  it('the focused field holds gameplay off until it blurs; nothing held without one', () => {
    const ls: Record<string, () => void> = {};
    const field = { tagName: 'INPUT', isContentEditable: false, shadowRoot: null, addEventListener: (t: string, f: () => void) => { ls[t] = f; } };
    vi.stubGlobal('document', { getElementById: () => null, activeElement: field });
    const t = setup({ current: null, kind: null }, { site: [500, 500] });
    t.ctx.game.toClassic(); t.ctx.game.resume();
    expect(t.log).toContain(`hold:${TYPING_HOLD}:true`);
    ls.blur();
    expect(t.log.slice(-1)).toEqual([`hold:${TYPING_HOLD}:false`]);
    // our chat inside the UI's shadow root counts too
    const host = { tagName: 'DIV', isContentEditable: false, shadowRoot: { activeElement: { ...field, addEventListener: () => {} } } };
    vi.stubGlobal('document', { getElementById: () => null, activeElement: host });
    const u = setup({ current: null, kind: null }, { site: [500, 500] });
    u.ctx.game.toClassic(); u.ctx.game.resume();
    expect(u.log).toContain(`hold:${TYPING_HOLD}:true`);
    vi.stubGlobal('document', { getElementById: () => null, activeElement: { tagName: 'BODY', shadowRoot: null } });
    const v = setup({ current: null, kind: null }, { site: [500, 500] });
    v.ctx.game.toClassic(); v.ctx.game.resume();
    expect(v.log.some((l) => l.startsWith('hold:'))).toBe(false);
  });
});
