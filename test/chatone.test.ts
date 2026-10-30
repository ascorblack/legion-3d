import { describe, it, expect, vi } from 'vitest';
import { chatOneApi, chatOneOn, minePayload, OneMine, withoutFocus, isQuiet, type ChatOneApi } from '../src/ui/chatone';
import { mineFloorKey } from '../src/rooms/mine/net';

const win = (o: unknown) => ({ LGChatOne: o }) as never;

describe('site 30.10 «chatone» bridge (src/ui/chatone.ts)', () => {
  it('is on only when window.LGChatOne exists and says on()', () => {
    expect(chatOneApi(win(undefined))).toBeNull();
    expect(chatOneApi(win({ on: () => false, dock() {} }))).toBeNull();
    expect(chatOneApi(win({ on: () => true }))).toBeNull();   // no dock(): not the build we know
    expect(chatOneOn(win({ on: () => true, dock() {} }))).toBe(true);
    expect(chatOneApi(win({ on: () => { throw new Error('x'); }, dock() {} }))).toBeNull();
  });
  it('minePayload = the mine enter `mchat` (lines, counter, mod / muted)', () => {
    const lines = [{ id: '1', l: 'a', t: 'x' }, { id: '2', l: 'b', t: 'y' }];
    expect(minePayload({ lines: () => lines, c: () => 7, state: () => ({ mod: 'own', muted: null }) })).toEqual({ chat: lines, c: 7, mod: 'own' });
    expect(minePayload({ lines: () => [] })).toEqual({ chat: [] });
    const p = minePayload({ lines: () => lines });
    expect(p.chat[0]).not.toBe(lines[0]);   // copies: the window tags them
  });
  it('withoutFocus takes back a focus the site gave to its field, keeps one that was already in the chat', () => {
    const mk = (inChat: boolean) => ({ closest: (s: string) => (inChat && s === '.cy-chat' ? {} : null), blur: vi.fn() });
    const field = mk(true), body = mk(false);
    const doc = { activeElement: body } as unknown as Document;
    withoutFocus(doc, () => { expect(isQuiet()).toBe(true); (doc as { activeElement: unknown }).activeElement = field; });
    expect(field.blur).toHaveBeenCalledTimes(1);
    expect(isQuiet()).toBe(false);
    const typing = mk(true), doc2 = { activeElement: typing } as unknown as Document;
    withoutFocus(doc2, () => { /* stays */ });
    expect(typing.blur).not.toHaveBeenCalled();
  });
  it('OneMine: enterFeed + dock(mine, host) on start, re-dock when the City took the window, dock(mine, null) on stop', () => {
    const calls: string[] = []; let box: { parentNode: unknown } | null = null;
    const api: ChatOneApi = { on: () => true, dock: (k, root) => { calls.push(k + ':' + (root ? 'host' : 'null')); }, enterFeed: (room, r) => { calls.push('feed:' + room + ':' + (r as { chat: unknown[] }).chat.length); } };
    const host = { className: '', dataset: {} as Record<string, string>, remove: vi.fn() };
    const doc = { createElement: () => host, body: { appendChild: vi.fn() }, activeElement: null, querySelector: () => box } as unknown as Document;
    const css = vi.fn();
    const om = new OneMine(api, { lines: () => [{ id: '1' }], c: () => 3 }, doc, css);
    om.start();
    expect(css).toHaveBeenCalled(); expect(host.className).toBe('l3d-co-host'); expect(host.dataset.chatTop).toBe('120');
    expect(calls).toEqual(['feed:mine:1', 'mine:host']);
    box = { parentNode: host }; om.tick(); expect(calls.length).toBe(2);
    box = { parentNode: {} }; om.tick(); expect(calls.at(-1)).toBe('mine:host');   // the City docked again
    om.stop(); expect(calls.at(-1)).toBe('mine:null'); expect(host.remove).toHaveBeenCalled();
    om.start(); expect(calls.at(-1)).toBe('mine:host');
  });
});

describe('mine poll key ?f= (site mine.js floorKey 30.10)', () => {
  it('seed.n for a classic floor, + dug cells for a big (v3) floor', () => {
    expect(mineFloorKey({ seed: 5, n: 12, dug: '0110' })).toBe('5.12');
    expect(mineFloorKey({ seed: 5, n: 12, dug: '0110', fl: {} })).toBe('5.12');
    expect(mineFloorKey({ seed: 5, n: 12, dug: '0110', fl: { v3: 1 } })).toBe('5.12.2');
    expect(mineFloorKey({ seed: 'ab', n: 3, dug: [1, 0, 1, 1], fl: { v3: 1 } })).toBe('ab.3.3');
    expect(mineFloorKey({ seed: 1, n: 1, fl: { v3: 1 } })).toBe('1.1.0');
  });
});

describe('DmBridge.adopt: the single chat window registers its «Личные» box with LGDm once it is on the page', () => {
  it('docks (lgChatOne, box, dmx) once per box, only for a connected chatone box', async () => {
    const { DmBridge, CO_DM_KEY } = await import('../src/ui/dm');
    const dock = vi.fn();
    const lg = { open: () => true, on: () => {}, unread: () => 0, dock };
    const win: any = { LGDm: lg, setTimeout, clearTimeout };
    const doc: any = { querySelector: () => null };
    const br = new DmBridge({ toast() {}, floatFocus() {}, show() {}, me: () => 'me' }, win, doc);
    const dmx = {};
    const box = (o: Partial<{ isConnected: boolean; coBound: string | undefined }>) => ({ isConnected: o.isConnected ?? true, dataset: { coBound: 'coBound' in o ? o.coBound : '1' }, querySelector: () => dmx }) as unknown as HTMLElement;
    br.adopt(box({}));          // LGDm not picked up yet (scan() not run)
    expect(dock).not.toHaveBeenCalled();
    br.scan();
    br.adopt(box({ isConnected: false })); br.adopt(box({ coBound: undefined }));
    expect(dock).not.toHaveBeenCalled();
    const b = box({}); br.adopt(b); br.adopt(b);
    expect(dock).toHaveBeenCalledTimes(1);
    expect(dock).toHaveBeenCalledWith(CO_DM_KEY, b, dmx);
  });
});
