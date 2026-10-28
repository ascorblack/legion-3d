import { describe, it, expect, beforeAll, vi } from 'vitest';
import type { MineChatSource, MineLine } from '../src/ui/chat';
import { MineClient } from '../src/rooms/mine/net';
import enter from './fixtures/mine-enter.json';

/**
 * Chat moderation parity with the site's chat module (site-chat.js «22.10: модерация»: chatAct / chatPanel / chatCmd).
 * The expected requests are what the site sends for the same action (captured from the site's own module in a page
 * harness, .local/chatmod/parity.mjs): POST <base>/mod<q> with JSON { op, id, login, min } (undefined keys dropped),
 * GET <base>/mod<q> for the window and /mods. base: '/api/city/chat' (City) or '/api/mine/chat' + '?c=<mine>' (mine).
 */
let M: typeof import('../src/ui/chat-mod');
let ui: typeof import('../src/ui/chat');
beforeAll(async () => { (globalThis as any).window = globalThis; M = await import('../src/ui/chat-mod'); ui = await import('../src/ui/chat'); });

const CITY = '/api/city/chat/mod', MINE = '/api/mine/chat/mod?c=home';
/** The site's request for each «⋯» item / window action / command (JSON exactly as fetch would send it). */
const SITE: [string, string][] = [
  ['del', '{"op":"del","id":"a1"}'],
  ['mute 5', '{"op":"mute","login":"kotik_one","min":5}'],
  ['mute 30', '{"op":"mute","login":"kotik_one","min":30}'],
  ['mute 60', '{"op":"mute","login":"kotik_one","min":60}'],
  ['mute 1440', '{"op":"mute","login":"kotik_one","min":1440}'],
  ['mute 10080', '{"op":"mute","login":"kotik_one","min":10080}'],
  ['ban', '{"op":"ban","login":"kotik_one"}'],
  ['mod', '{"op":"mod","login":"kotik_one"}'],
];

function fakeApi(answer: (p: string, b?: any) => any = (p, b) => (b === undefined ? { ok: true, role: 'own', bans: [], mods: ['murka_mod'] } : { ok: true, id: b.id, login: b.login })) {
  const calls: { p: string; body: string | null }[] = [];
  const api = vi.fn(async (p: string, b?: unknown) => { calls.push({ p, body: b === undefined ? null : JSON.stringify(b) }); return answer(p, b); });
  return { api, calls };
}
function feed() {
  return { remove: vi.fn(), setRole: vi.fn(), note: vi.fn(), sys: vi.fn() };
}
const line = { id: 'a1', l: 'kotik_one', n: 'Котик_1' };

describe('chat moderation — pure parts', () => {
  it('canMod: like the site — not mine, not DMs; a moderator never touches the owner or other moderators', () => {
    expect(M.canMod(null, 'me', line)).toBe(false);
    expect(M.canMod('own', 'me', { ...line, l: 'ME' })).toBe(false);
    expect(M.canMod('own', 'me', { ...line, k: 'dm' })).toBe(false);
    expect(M.canMod('own', 'me', { ...line, r: 'mod' })).toBe(true);
    expect(M.canMod('mod', 'me', { ...line, r: 'mod' })).toBe(false);
    expect(M.canMod('mod', 'me', { ...line, r: 'own' })).toBe(false);
    expect(M.canMod('mod', 'me', line)).toBe(true);
  });

  it('the «⋯» menu has the site items in the site order (owner: + make / unmake moderator)', () => {
    const lab = (r: 'own' | 'mod', m: any) => M.modMenu(r, m).map((x) => `${x.op}${x.args.min || ''}`);
    expect(lab('mod', line)).toEqual(['del', 'mute5', 'mute30', 'mute60', 'mute1440', 'mute10080', 'ban']);
    expect(lab('own', line)).toEqual(['del', 'mute5', 'mute30', 'mute60', 'mute1440', 'mute10080', 'ban', 'mod']);
    expect(lab('own', { ...line, r: 'mod' }).slice(-1)).toEqual(['unmod']);
    expect(lab('own', { ...line, r: 'own' }).slice(-1)).toEqual(['ban']);
    expect(M.modMenu('own', line).filter((x) => x.mute).map((x) => x.label)).toEqual(['5 мин', '30 мин', '1 ч', '1 день', '7 дней']);
  });

  it('request bodies of every «⋯» item equal the site (undefined keys dropped like JSON.stringify of the site)', () => {
    const items = M.modMenu('own', line);
    const got = items.map((x) => [x.op + (x.mute ? ' ' + x.args.min : ''), JSON.stringify(M.modBody(x.op, x.args))]);
    expect(got).toEqual(SITE);
    expect(M.modPath('/api/city/chat')).toBe(CITY);
    expect(M.modPath('/api/mine/chat', '?c=home')).toBe(MINE);
  });

  it('commands parse like the site chatCmd', () => {
    expect(M.planCmd('/mute x', null)).toEqual({ err: 'команды — только модераторам чата' });
    expect(M.planCmd('/help', 'mod')).toEqual({ sys: 'Команды: /mute ник [минут] · /ban ник · /unban ник' });
    expect(M.planCmd('/помощь', 'own')).toEqual({ sys: 'Команды: /mod ник · /unmod ник · /mods · /mute ник [минут] · /ban ник · /unban ник' });
    expect(M.planCmd('/mods', 'mod')).toEqual({ err: 'список модераторов — у админа чата' });
    expect(M.planCmd('/mods', 'own')).toEqual({ mods: true });
    expect(M.planCmd('/mod bad_cat', 'mod')).toEqual({ err: 'назначать модераторов может только админ чата' });
    expect(M.planCmd('/mute', 'mod')).toEqual({ err: 'укажи ник: /mute ник' });
    expect(M.planCmd('/mute @Bad_Cat', 'mod')).toEqual({ act: 'mute', args: { login: 'bad_cat', n: 'bad_cat', min: 30 } });
    expect(M.planCmd('/MUTE bad_cat 15', 'mod')).toEqual({ act: 'mute', args: { login: 'bad_cat', n: 'bad_cat', min: 15 } });
    expect(M.planCmd('/mute bad_cat 99999', 'mod')).toEqual({ err: 'срок мута — от 1 до 10080 минут (7 дней)' });
    expect(M.planCmd('/ban bad_cat', 'mod')).toEqual({ act: 'ban', args: { login: 'bad_cat', n: 'bad_cat', sure: true } });
    expect(M.planCmd('/unban bad_cat', 'mod')).toEqual({ act: 'unban', args: { login: 'bad_cat', n: 'bad_cat', sure: false } });
    expect(M.planCmd('/kick bad_cat', 'own')).toEqual({ err: 'нет такой команды: /kick. Список — /help' });
  });

  it('ModState: role / mute from enter, chatMe (owner stays owner), the window, expiry and the placeholder', () => {
    const s = new M.ModState(), now = 1_000_000;
    s.enter({ mod: 'mod', muted: null }); expect(s.role).toBe('mod');
    s.enter({ mod: 'bogus' }); expect(s.role).toBeNull();
    expect(s.me({ mod: 'mod' })).toBeNull(); expect(s.role).toBe('mod');
    expect(s.me({ muted: { until: now + 25 * 60000 } }, now)).toBe('Модератор запретил тебе писать на 25 мин');
    expect(s.placeholder(now)).toBe('Мут ещё 25 мин');
    expect(s.placeholder(now + 26 * 60000)).toBeNull();   // expired → cleared
    expect(s.me({ muted: { until: 0 } }, now)).toBe('Модератор запретил тебе писать в чат');
    expect(s.placeholder(now)).toBe('Модератор запретил тебе писать');
    s.enter({ mod: 'own' }); s.me({ mod: null }); expect(s.role).toBe('own');
    s.enter({}); s.panel({ ok: true, role: 'mod' }); expect(s.role).toBe('mod');
    expect(M.leftT(90 * 60000)).toBe('2 ч'); expect(M.leftT(3 * 864e5)).toBe('3 дн');
  });
});

describe('Moderator: the exact requests for the City and the mine', () => {
  for (const [base, q, url] of [['/api/city/chat', '', CITY], ['/api/mine/chat', '?c=home', MINE]] as const) {
    it(`${base}: every «⋯» item → one POST ${url} with the site body`, async () => {
      for (const it of M.modMenu('own', line)) {
        const { api, calls } = fakeApi(), mod = new M.Moderator(base, q, api, feed());
        mod.st.enter({ mod: 'own' });
        await mod.act(it.op, it.args);
        expect(calls).toEqual([{ p: url, body: JSON.stringify(M.modBody(it.op, it.args)) }]);
      }
      // the window: GET; the unmod «×» and unban «Снять» of the window
      const { api, calls } = fakeApi(), mod = new M.Moderator(base, q, api, feed());
      await mod.info(); await mod.act('unban', { login: 'spammer_x', n: 'spammer_x' }); await mod.act('unmod', { login: 'murka_mod', n: 'murka_mod' });
      expect(calls).toEqual([{ p: url, body: null }, { p: url, body: '{"op":"unban","login":"spammer_x"}' }, { p: url, body: '{"op":"unmod","login":"murka_mod"}' }]);
    });
  }

  it('applies the answer like the site: del removes r.id (+ r.gone), mod / unmod re-role, status lines', async () => {
    const f = feed(), { api } = fakeApi((_p, b) => ({ ok: true, id: b.id, login: b.login, gone: b.op === 'ban' ? ['x1', 'x2'] : undefined }));
    const mod = new M.Moderator('/api/city/chat', '', api, f);
    await mod.act('del', { id: 'a1' });
    expect(f.remove).toHaveBeenCalledWith(['a1']); expect(f.note).toHaveBeenLastCalledWith('Сообщение удалено', true);
    await mod.act('ban', { login: 'kotik_one', n: 'Котик_1', sure: true });
    expect(f.remove).toHaveBeenLastCalledWith(['x1', 'x2']); expect(f.note).toHaveBeenLastCalledWith('Котик_1: бан в чате', true);
    await mod.act('mute', { login: 'kotik_one', n: 'Котик_1', min: 1440 }); expect(f.note).toHaveBeenLastCalledWith('Котик_1: мут 1 день', true);
    await mod.act('mute', { login: 'kotik_one', n: 'Котик_1', min: 15 }); expect(f.note).toHaveBeenLastCalledWith('Котик_1: мут 15 мин', true);
    await mod.act('mod', { login: 'kotik_one', n: 'kotik_one' }); expect(f.setRole).toHaveBeenLastCalledWith('kotik_one', 'mod');
    await mod.act('unmod', { login: 'kotik_one', n: 'kotik_one' }); expect(f.setRole).toHaveBeenLastCalledWith('kotik_one', undefined);
  });

  it('errors: the site texts (CHAT_ERR / error / «не вышло»), nothing applied', async () => {
    const f = feed();
    for (const [ans, txt] of [[{ ok: false, error: 'forbidden' }, 'нет прав'], [{ ok: false, error: 'Нельзя модератора' }, 'Нельзя модератора'], [null, 'не вышло']] as const) {
      const mod = new M.Moderator('/api/city/chat', '', async () => ans, f);
      expect(await mod.act('del', { id: 'a1' })).toBe(false);
      expect(f.note).toHaveBeenLastCalledWith(txt, false);
    }
    expect(f.remove).not.toHaveBeenCalled();
  });

  it('commands: requests like the site; /help and /mods are local lines; non-moderators get an error and NOTHING is sent', async () => {
    const f = feed(), { api, calls } = fakeApi(), mod = new M.Moderator('/api/mine/chat', '?c=home', api, f);
    expect(await mod.cmd('/mute bad_cat')).toBe(false);
    expect(calls).toEqual([]); expect(f.note).toHaveBeenLastCalledWith('команды — только модераторам чата', false);
    mod.st.enter({ mod: 'own' });
    expect(await mod.cmd('/help')).toBe(true); expect(f.sys).toHaveBeenLastCalledWith(expect.stringContaining('/mods'));
    expect(await mod.cmd('/mods')).toBe(true); expect(f.sys).toHaveBeenLastCalledWith('Модераторы чата (1): murka_mod');
    for (const t of ['/mute bad_cat', '/mute @Bad_Cat 15', '/ban bad_cat', '/unban bad_cat', '/mod bad_cat', '/unmod bad_cat']) expect(await mod.cmd(t)).toBe(true);
    expect(calls).toEqual([
      { p: MINE, body: null },
      { p: MINE, body: '{"op":"mute","login":"bad_cat","min":30}' },
      { p: MINE, body: '{"op":"mute","login":"bad_cat","min":15}' },
      { p: MINE, body: '{"op":"ban","login":"bad_cat"}' },
      { p: MINE, body: '{"op":"unban","login":"bad_cat"}' },
      { p: MINE, body: '{"op":"mod","login":"bad_cat"}' },
      { p: MINE, body: '{"op":"unmod","login":"bad_cat"}' },
    ]);
  });
});

/* ---------------------------------------------------------------- the «⛏ Шахта» tab */

const ml = (id: string, l = 'bot1', r?: string): MineLine => ({ id, l, n: l, t: 'привет', at: 1000, r });
function source(o: { mod?: string | null; muted?: any; api?: boolean } = {}) {
  const live = new Set<(d: any) => void>();
  const say = vi.fn(async (_t: string) => ({ ok: true }));
  const { api, calls } = fakeApi();
  const src: MineChatSource = {
    lines: () => [ml('a'), ml('b', 'bot2', 'mod'), ml('c', 'player1')], on: () => () => {}, say, me: () => 'player1',
    ...(o.api === false ? {} : { state: () => ({ mod: o.mod ?? null, muted: o.muted }), onLive: (fn) => { live.add(fn); return () => live.delete(fn); }, api, q: '?c=home' }),
  };
  return { src, say, calls, live: (d: any) => { for (const f of live) f(d); } };
}

describe('mine tab moderation', () => {
  it('role from the mine enter; a non-moderator sees no role and the source API is never called by itself', () => {
    const a = source({ mod: 'own' }), t = new ui.MineChatTab(a.src);
    expect(t.mod?.role).toBe('own');
    const b = source(), u = new ui.MineChatTab(b.src);
    expect(u.mod?.role).toBeNull();
    expect(a.calls).toEqual([]); expect(b.calls).toEqual([]);
  });

  it('«/…» is a command, never said in the feed (also for non-moderators — the site does the same)', async () => {
    const s = source({ mod: 'own' }), t = new ui.MineChatTab(s.src); const notes: string[] = []; t.onNote = (x) => notes.push(x);
    expect(await t.send('/mods')).toEqual({ ok: true, cmd: true });
    expect(t.lines().at(-1)).toMatchObject({ sys: true, t: 'Модераторы чата (1): murka_mod' });
    expect(await t.send('/mute bot1 5')).toEqual({ ok: true, cmd: true });
    expect(s.calls).toEqual([{ p: MINE, body: null }, { p: MINE, body: '{"op":"mute","login":"bot1","min":5}' }]);
    const n = source(), u = new ui.MineChatTab(n.src); u.onNote = (x) => notes.push(x);
    expect(await u.send('/mute bot1')).toEqual({ ok: false, cmd: true });
    expect(notes.at(-1)).toBe('команды — только модераторам чата');
    expect(s.say).not.toHaveBeenCalled(); expect(n.say).not.toHaveBeenCalled(); expect(n.calls).toEqual([]);
  });

  it('muted: nothing is said, the placeholder tells how long; a refused send («запретил») mutes too', async () => {
    const s = source({ muted: { until: Date.now() + 10 * 60000 } }), t = new ui.MineChatTab(s.src);
    expect(t.mutedPh()).toBe('Мут ещё 10 мин');
    expect((await t.send('привет'))!.ok).toBe(false);
    expect(s.say).not.toHaveBeenCalled();
    const r = source(), u = new ui.MineChatTab(r.src);
    r.say.mockResolvedValueOnce({ ok: false, error: 'Модератор запретил тебе писать' } as any);
    expect(await u.send('привет')).toEqual({ ok: false, error: 'Модератор запретил тебе писать' });
    expect(u.mutedPh()).toBe('Модератор запретил тебе писать');
  });

  it('live: chatDel removes lines, chatMe mutes with the site notice', () => {
    const s = source(), t = new ui.MineChatTab(s.src), notes: string[] = [], ch = vi.fn();
    t.onNote = (x) => notes.push(x); t.onChange = ch;
    s.src.onLive!((d) => t.live(d));   // the dock wires the source's live events to the tab (Chat.mineSync)
    s.live({ chatDel: ['a'] });
    expect(t.lines().map((x) => x.id)).toEqual(['b', 'c']);
    s.live({ chatMe: { muted: { until: 0 } } });
    expect(notes).toEqual(['Модератор запретил тебе писать в чат']); expect(t.mutedPh()).toBe('Модератор запретил тебе писать');
    s.live({ chatMe: { mod: 'mod' } }); expect(t.mod?.role).toBe('mod');
    expect(ch).toHaveBeenCalled();
  });

  it('a delete of mine removes the line at once; make moderator re-roles the author\'s lines', async () => {
    const s = source({ mod: 'own' }), t = new ui.MineChatTab(s.src);
    await t.mod!.act('del', { id: 'a' });
    expect(t.lines().map((x) => x.id)).toEqual(['b', 'c']);
    await t.mod!.act('mod', { login: 'player1', n: 'player1' });
    expect(t.lines().find((x) => x.id === 'c')!.r).toBe('mod');
  });

  it('a source without the moderation API behaves as before (plain send)', async () => {
    const s = source({ api: false }), t = new ui.MineChatTab(s.src);
    expect(t.mod).toBeNull();
    expect(await t.send('/mute x')).toEqual({ ok: true });
    expect(s.say).toHaveBeenCalledWith('/mute x');
  });
});

describe('MineClient: the mine chat state for moderation (site mchat / chatApply)', () => {
  it('keeps mchat.mod / muted of the enter; live chatDel / chatMe update lines and state and are emitted', async () => {
    const e = JSON.parse(JSON.stringify(enter)); e.mchat.mod = 'mod'; e.mchat.muted = null;
    const api = async (p: string) => (p.startsWith('/api/mine/enter') ? e : { ok: true });
    const T = { setInterval: () => 0, clearInterval: () => {}, setTimeout: () => 0, clearTimeout: () => {} };
    const c = new MineClient({ api, login: 'player1', c: 'home', timers: T });
    const evs: any[] = []; c.on((x) => { if (x.type === 'chatLive') evs.push(x); });
    await c.enter({ x: 300, y: 2300 });
    expect(c.chat.st).toEqual({ mod: 'mod', muted: null });
    expect(c.chatQ).toBe('?c=home');
    const id0 = c.chat.lines[0].id, n0 = c.chat.lines.length;
    c.onEvent({ chatRoom: 'mine', chatDel: [id0], chatMe: { muted: { until: 5 } } } as any);
    expect(c.chat.lines.length).toBe(n0 - 1);
    expect(c.chat.st!.muted).toEqual({ until: 5 });
    expect(evs).toEqual([{ type: 'chatLive', del: [id0], me: { muted: { until: 5 } } }]);
  });
});
