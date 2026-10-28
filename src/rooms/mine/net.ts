/**
 * Our own mine client: mirrors the requests of the site's mine.js EXACTLY (same paths, payloads and cadence) and
 * reads the state from their responses and from the live channel (bus 'sse:mine', teed by src/bridge).
 * Why not drive window.LGMine: it exposes only open/close/onEvent/board/host/result — its state (S) lives in a
 * closure and every action is bound to its own SVG/DOM, so driving it would mean scraping and synthetic clicks
 * (docs/MINE.md «Client decision»). The site's mine must NOT be open at the same time (one presence per tab):
 * the room closes it before entering (LGMine.close()).
 *
 * Cadence (as mine.js): enter once; GET state every 3 s (with a live channel only every 10th tick unless looks are
 * wanted); ping every 60 s while visible; go once per walk (we: throttled ≥ GO_MS while walking, last point on stop);
 * dig / stop / sell / buy / lamp / claim / pick / oreBag only on the player's explicit action; leave on exit.
 */
import { dayLimit } from './state';
import { MineModel, TX, blockTitle, mmss, type MinePayload, type MineMe, type Burst, type ChatLine, type LookRec } from './state';
import { REACH, cellXY, type Pt } from './geo';

export type MineApi = (path: string, body?: unknown) => Promise<any>;
export interface MineBus { on(type: string, fn: (d: any) => void): () => void }
export interface Timers {
  setInterval(fn: () => void, ms: number): any; clearInterval(h: any): void;
  setTimeout(fn: () => void, ms: number): any; clearTimeout(h: any): void;
}
export interface HeroLike { login?: string; money?: number; items?: any[]; mn?: Record<string, MineMe> }
export interface MineClientOpts {
  api: MineApi;
  login: string;
  /** Mine id: 'home' (fair) or a district id. */
  c?: string;
  bus?: MineBus | null;
  hero?: () => HeroLike | null;
  /** Equip an item (the helmet) — core Actions.equip. Optional. */
  equip?: (uid: string) => Promise<any>;
  hidden?: () => boolean;
  timers?: Timers;
  now?: () => number;
}
export type MineEvent =
  | { type: 'state'; newFloor: boolean }
  | { type: 'presence' }
  | { type: 'here' }
  | { type: 'burst'; bursts: Burst[] }
  | { type: 'tip'; text: string; bad?: boolean }
  | { type: 'chat'; lines: ChatLine[] }
  | { type: 'other'; on: boolean }
  | { type: 'busy' }
  | { type: 'error'; text: string };

/** Throttle of own position updates while walking (ms). The site sends one go per click-walk; we walk with WASD. */
export const GO_MS = 800;
/** Minimal move (px) that is worth a go. */
export const GO_MIN = 12;

const realTimers: Timers = {
  setInterval: (f, ms) => setInterval(f, ms), clearInterval: (h) => clearInterval(h),
  setTimeout: (f, ms) => setTimeout(f, ms), clearTimeout: (h) => clearTimeout(h),
};

export class MineClient {
  readonly model: MineModel;
  readonly c: string;
  sid = '';
  /** Our position (mine px) as last sent to the game. */
  sent: Pt | null = null;
  pos: Pt | null = null;
  other = false;
  entered = false;
  closed = false;
  /** Buyer window: waiting for the game's result of /api/mineBuy. */
  buyWait: { at: number; price: number; id?: string } | null = null;
  buySaid: { t: string; c: number; at: number } | null = null;
  /** Supplier: waiting for minePick / mineOreBag. */
  supWait: { at: number; id?: string } | null = null;
  supSay: { t: string; at: number } | null = null;
  lampBought = 0;
  claimed = 0;
  /** Own stone queue as we last sent it (site S.qq); the game's me.qq wins when it has one (see queue()). */
  qq: number[] = [];
  busyOp = false;
  chat: { on: boolean; c: number; lines: ChatLine[] } = { on: false, c: 0, lines: [] };
  private o: MineClientOpts;
  private T: Timers;
  private now: () => number;
  private pollT: any = 0; private pingT: any = 0; private goneT: any = 0; private goT: any = 0;
  private pollN = 0; private lkAt = 0; private full = false; private rejoinAt = 0; private lastSse = 0;
  private lastGoAt = -1e9;
  private unsubs: (() => void)[] = [];
  private subs = new Set<(e: MineEvent) => void>();
  private seenRes = new Set<string>();

  constructor(o: MineClientOpts) {
    this.o = o; this.T = o.timers || realTimers; this.now = o.now || (() => Date.now());
    this.c = /^[a-z0-9_-]{1,24}$/.test(String(o.c || '')) ? String(o.c) : 'home';
    this.model = new MineModel(o.login);
    this.model.heroItems = () => { try { const h = o.hero && o.hero(); return (h && h.items) || []; } catch { return []; } };
    if (o.bus) {
      this.unsubs.push(o.bus.on('sse:mine', (d) => { this.lastSse = this.now(); this.onEvent(d); }));
      this.unsubs.push(o.bus.on('sse:me', (d) => this.onMe(d)));
    }
  }
  /** Our login (lower case). */
  get login(): string { return String(this.o.login || '').toLowerCase(); }
  private q(): string { return `?c=${encodeURIComponent(this.c)}`; }
  on(fn: (e: MineEvent) => void): () => void { this.subs.add(fn); return () => { this.subs.delete(fn); }; }
  private emit(e: MineEvent): void { for (const f of [...this.subs]) { try { f(e); } catch (err) { console.error('[l3d] mine listener', err); } } }
  tip(text: string, bad = false): void { this.emit({ type: 'tip', text, bad }); }
  /** A live channel is up when a 'mine' event arrived recently (the server sends views every few seconds). */
  live(): boolean { return this.now() - this.lastSse < 20000; }
  private hidden(): boolean { try { return !!(this.o.hidden && this.o.hidden()); } catch { return false; } }
  private heroMe(): MineMe | null { try { const h = this.o.hero && this.o.hero(); return (h && h.mn && h.mn[this.c]) || null; } catch { return null; } }

  /* ---------------------------------------------------------------- presence */
  /** POST /api/mine/enter?c= {x, y}: first entry (spawn point) or re-entry from the current position. */
  async enter(start: Pt, again = false): Promise<boolean> {
    if (this.closed) return false;
    const r: MinePayload = await this.o.api('/api/mine/enter' + this.q(), { x: Math.round(start.x), y: Math.round(start.y) });
    if (this.closed) return false;
    if (!r || !r.ok) { this.emit({ type: 'error', text: (r && r.error) || 'Шахта не открылась — попробуй ещё раз.' }); return false; }
    this.sid = r.sid || '';
    if (!again || !this.pos) this.pos = { x: start.x, y: start.y };
    this.sent = { x: Math.round(start.x), y: Math.round(start.y) };
    this.entered = true; this.other = false;
    this.apply(r, true);
    if (r.mchat) { this.chat.on = true; this.chatIn(r.mchat); }
    this.T.clearInterval(this.pollT); this.T.clearInterval(this.pingT); this.T.clearInterval(this.goneT);
    this.pollT = this.T.setInterval(() => { void this.poll(); }, 3000);
    this.pingT = this.T.setInterval(() => { if (!this.hidden()) void this.o.api('/api/mine/ping' + this.q(), {}); }, 60000);
    this.goneT = this.T.setInterval(() => { if (this.model.expire(this.now())) this.emit({ type: 'presence' }); }, 20000);
    return true;
  }
  /** GET /api/mine/state?c=…[&v=&f=][&sid=][&lk=][&mc=] — mine.js poll(). */
  async poll(full = false): Promise<void> {
    if (this.closed || !this.entered || (this.hidden() && !full)) return;
    const M = this.model;
    this.pollN++;
    if (!full && this.live() && this.pollN % 10 && !M.lkWant.size) return;
    const st0 = M.st, have = !full && st0 ? `&v=${encodeURIComponent(st0.v)}&f=${encodeURIComponent(st0.seed + '.' + st0.n)}` : '';
    const lk = [...M.lkWant].slice(0, 60); M.lkWant.clear(); if (lk.length) this.lkAt = this.now();
    const mc = this.chat.on && !this.live() ? `&mc=${this.chat.c || 0}` : '';
    const r: MinePayload = await this.o.api('/api/mine/state' + this.q() + have + (this.sid ? `&sid=${this.sid}` : '') + (lk.length ? `&lk=${encodeURIComponent(lk.join(','))}` : '') + mc);
    if (this.closed || !r || !r.ok) return;
    if (r.mchat && this.chat.on) this.chatIn(r.mchat);
    this.setOther(!!r.other);
    // the server forgot us (tab hidden > 3 min): enter again, it re-sends everyone
    if (r.n == null && !r.other && this.now() - this.rejoinAt > 15000 && this.pos) { this.rejoinAt = this.now(); void this.enter(this.pos, true); }
    this.apply(r, false);
  }
  /** Live channel event 'mine': new view (st) and/or presence (a, m, g), counters, chat. */
  onEvent(d: MinePayload): void {
    if (this.closed || !d) return;
    if (d.chatRoom === 'mine') { if (this.chat.on && d.chat) this.chatIn({ chat: d.chat, c: (d as any).c }); return; }
    if (d.c && d.c !== this.c) return;
    if (d.here != null) { this.model.hereOf(d); this.emit({ type: 'here' }); if (!d.st && !d.a && !d.m && !d.g && d.n == null) return; }
    if (!this.entered) return;
    this.apply(d, false);
  }
  private apply(r: MinePayload, snap: boolean): void {
    const M = this.model, now = this.now();
    M.hereOf(r);
    if (r.here != null) this.emit({ type: 'here' });
    if (M.presence(r, now, snap)) this.emit({ type: 'presence' });
    const res = M.take(r.st, r.me, r.lk, now, r.me ? null : this.heroMe());
    if (res.needFull && !this.full) {
      // new floor without the layout: ask for the whole view
      this.full = true; void this.poll(true).finally(() => { this.full = false; });
    }
    if (M.needStop) { M.needStop = false; void this.o.api('/api/mineStop', { c: this.c, sid: this.sid }); }
    if (res.newFloor) this.qq = [];   // site take(): new floor → S.qq = []
    if (res.changed) this.emit({ type: 'state', newFloor: res.newFloor });
    else if (r.me) this.emit({ type: 'state', newFloor: false });
    if (res.bursts.length) this.emit({ type: 'burst', bursts: res.bursts });
    if (M.lkWant.size && now - this.lkAt > 5000) { this.lkAt = now; this.T.setTimeout(() => { void this.poll(); }, 50); }
  }
  private setOther(on: boolean): void { if (on !== this.other) { this.other = on; if (on) this.model.want = null; this.emit({ type: 'other', on }); } }
  /** «Копать здесь»: the mine is open in another tab — take over (site: enter(true)). */
  takeOver(): void { if (this.pos) void this.enter(this.pos, true); }
  private chatIn(m: { chat?: ChatLine[]; c?: number }): void {
    const lines = (m && m.chat) || []; if (!lines.length && m.c == null) return;
    const known = new Set(this.chat.lines.map((x) => x.id)), fresh = lines.filter((x) => !known.has(x.id));
    if (m.c != null) this.chat.c = Math.max(this.chat.c, +m.c || 0);
    for (const x of fresh) if (x.s != null) this.chat.c = Math.max(this.chat.c, x.s);
    if (!fresh.length) return;
    this.chat.lines = [...this.chat.lines, ...fresh].slice(-60);
    this.emit({ type: 'chat', lines: fresh });
  }
  /** POST /api/mine/chat/say?c= {text} (site chat module, room 'mine'). */
  async say(text: string): Promise<any> { const t = String(text || '').trim(); if (!t) return null; return this.o.api('/api/mine/chat/say' + this.q(), { text: t }); }
  /** Results of mine actions come with the hero snapshot (results[].x.op = mine…). */
  private onMe(d: any): void {
    const list = (d && d.results) || []; if (!Array.isArray(list)) return;
    for (const x of list) { if (!x || !x.id || this.seenRes.has(x.id)) continue; if (x.x && /^mine/.test(x.x.op || '')) { this.seenRes.add(x.id); this.result(x); } }
  }
  /** Game result of an action (mine.js result()). */
  result(x: any): void {
    const r = x && x.x; if (!r) return;
    if (r.op === 'mineBuy') {
      if (this.buyWait && (!this.buyWait.id || this.buyWait.id === x.id)) this.buyWait = null;
      if (x.ok) { if (r.t) this.buySaid = { t: String(r.t), c: r.c || 0, at: this.now() }; this.tip(`Скупщик заплатил ${r.c || 0} — монеты в кошельке, руда ушла в казну Ратуши`); }
      else this.tip(x.error || 'Скупщик не взял', true);
      this.emit({ type: 'busy' }); return;
    }
    if (r.op === 'minePick' || r.op === 'mineOreBag') {
      if (this.supWait && (!this.supWait.id || this.supWait.id === x.id)) this.supWait = null;
      const me = this.model.me;
      if (x.ok) {
        if (r.op === 'minePick') { if (me && me.pkx) me.pkx = { ...me.pkx, lv: r.to }; const nm = (me && me.pkx && me.pkx.t[r.to] && me.pkx.t[r.to][0]) || 'Новая'; this.supSay = { t: `Держи — ${nm.toLowerCase()} кирка. Бей смело!`, at: this.now() }; this.tip(`Кирка улучшена: ${nm}`); }
        else { if (me && me.pkx && !me.pkx.ob) me.pkx = { ...me.pkx, ob: { cap: me.pkx.obC || 10, used: 0 } }; this.supSay = { t: 'Рудная сумка твоя — руда теперь ляжет в неё.', at: this.now() }; this.tip('Рудная сумка куплена'); }
      } else this.tip(x.error || 'Снабженец отказал', true);
      this.emit({ type: 'busy' }); return;
    }
    if (!x.ok) this.tip(x.error || 'Не вышло', true);
  }

  /* ---------------------------------------------------------------- walking */
  /**
   * Our feet moved (mine px). Sends POST /api/mine/go?c= {x, y, fx, fy} (fx/fy = where the walk started) at most every
   * GO_MS while walking; `stopped` flushes the final point at once. Same payload as mine.js walkTo.
   */
  moveTo(x: number, y: number, stopped = false): void {
    this.pos = { x, y };
    if (!this.entered || this.closed) return;
    const s = this.sent; if (s && Math.hypot(x - s.x, y - s.y) < GO_MIN) return;
    const wait = GO_MS - (this.now() - this.lastGoAt);
    if (stopped || wait <= 0) this.flushGo();
    else if (!this.goT) this.goT = this.T.setTimeout(() => { this.goT = 0; this.flushGo(); }, wait);
  }
  flushGo(): void {
    if (this.goT) { this.T.clearTimeout(this.goT); this.goT = 0; }
    const p = this.pos; if (!p || !this.entered || this.closed) return;
    const s = this.sent; if (s && Math.hypot(p.x - s.x, p.y - s.y) < GO_MIN) return;
    const to = { x: Math.round(p.x), y: Math.round(p.y) }, from = s || to;
    this.sent = to; this.lastGoAt = this.now();
    void this.o.api('/api/mine/go' + this.q(), { x: to.x, y: to.y, fx: from.x, fy: from.y });
  }

  /* ---------------------------------------------------------------- digging */
  /** Why stone i cannot be dug now (site clickRock checks), or null. */
  digBlock(i: number): string | null {
    const M = this.model, st = M.st, F = M.F; if (!st || !F) return 'Шахта ещё грузится';
    const cell = F.cells[i]; if (!cell) return 'Не подойти';
    if (M.dark) return TX.dark;
    if (cell.t === 'wall') return TX.wall;
    if (!M.isFront(i)) return TX.far;
    const me = M.me; if (me) { const lim = dayLimit(me, Date.now()); if (lim.kind === 'full') return lim.text; }
    if (this.other) return 'Шахта открыта в другой вкладке — копать можно только в одной';
    return null;
  }
  /** Distance (px) from p to the centre of stone i. */
  static distTo(i: number, p: Pt): number { const c = cellXY(i); return Math.hypot(p.x - c.cx, p.y - c.cy); }
  /**
   * POST /api/mineDig {i, c, sid, x, y, k: 1, vh, pt} — our feet must be within REACH of the stone (the game checks it).
   * pt = the aimed point on the stone (site: click point). Flushes our position first.
   */
  async dig(i: number, at: Pt, pt?: Pt): Promise<boolean> {
    const why = this.digBlock(i); if (why) { this.tip(why, true); return false; }
    if (MineClient.distTo(i, at) > REACH) { this.tip('Подойди к камню вплотную', true); return false; }
    const M = this.model, cell = M.F!.cells[i];
    if (M.myI === i) { this.tip(`${TX.doing}: ${blockTitle(cell)}`); return true; }
    M.want = { i, at: this.now() }; M.left = null; this.clearQueue();   // site clickRock: a plain dig starts over (S.qq = [])
    this.pos = { x: at.x, y: at.y }; this.flushGo();
    const r = await this.o.api('/api/mineDig', { i, c: this.c, sid: this.sid, x: Math.round(at.x), y: Math.round(at.y), k: 1, vh: this.hidden() ? 1 : 0, ...(pt ? { pt: [Math.round(pt.x), Math.round(pt.y)] } : {}) });
    if (this.closed) return false;
    if (!r || !r.ok) {
      if (M.want && M.want.i === i) M.want = null;
      if (r && r.other) this.setOther(true);
      this.tip((r && r.error) || 'Не получилось', true); M.myI = -1; this.emit({ type: 'state', newFloor: false }); return false;
    }
    M.want = { i, at: this.now() }; M.myI = i;
    this.tip(`${TX.doing}: ${blockTitle(cell)} — герой будет работать, пока не закончит (даже если закроешь сайт)`);
    this.emit({ type: 'state', newFloor: false });
    return true;
  }
  /* ---------------------------------------------------------------- stone queue (site 25.10, testers: me.fx.q) */
  /** The queue feature is on for this hero (site: S.me.fx.q). */
  get queueOn(): boolean { return this.model.fx('q'); }
  /** Raw queue as the site shows it: (S.me && S.me.qq) || S.qq. */
  rawQueue(): number[] { const me = this.model.me; return (me && me.qq) || this.qq; }
  /** Queued stones still worth showing (not dug, not the current one), in order. */
  queue(): number[] { const M = this.model; return this.rawQueue().filter((i) => !M.dug[i] && i !== M.myI); }
  /** Forget the queue locally (the game forgets it on stop / a plain dig / a new floor by itself). */
  clearQueue(): void { this.qq = []; const me = this.model.me; if (me && me.qq && me.qq.length) this.model.me = { ...me, qq: [] }; }
  /**
   * Site queueRock (Shift+click, testers): while digging, put stone i after the current one (at most 2). Same request as
   * mine.js: POST /api/mineDig {i: <current stone>, c, sid, x, y, q: [...queue, i].slice(-2), k: 1, vh, pt} — x, y = where
   * the hero stands (site: the centre of the dig spot), pt = the aimed point on stone i. Only on the player's key press.
   * Returns false when the queue does not apply (feature off / not digging) — the caller digs as usual then.
   */
  async enqueue(i: number, at: Pt, pt?: Pt): Promise<boolean> {
    const M = this.model;
    if (!this.queueOn || M.myI < 0) return false;
    const why = this.digBlock(i); if (why) { this.tip(why, true); return true; }
    if (i === M.myI) return true;
    const cur = this.rawQueue().filter((x) => x !== i), qq = [...cur, i].slice(-2);
    const r = await this.o.api('/api/mineDig', { i: M.myI, c: this.c, sid: this.sid, x: Math.round(at.x), y: Math.round(at.y), q: qq, k: 1, vh: this.hidden() ? 1 : 0, ...(pt ? { pt: [Math.round(pt.x), Math.round(pt.y)] } : {}) });
    if (this.closed) return true;
    if (!r || !r.ok) { if (r && r.other) this.setOther(true); this.tip((r && r.error) || 'Не получилось', true); return true; }
    this.qq = qq; if (M.me) M.me = { ...M.me, qq };
    this.tip(`В очереди камней: ${qq.length} — герой возьмёт их сам, когда докопает этот`);
    this.emit({ type: 'state', newFloor: false });
    return true;
  }

  /** «Перестать копать»: POST /api/mineStop {c, sid}. */
  async stop(): Promise<boolean> {
    const M = this.model; if (M.myI < 0) return true;
    const i = M.myI;
    M.left = { i, at: this.now() }; M.want = { i: -1, at: this.now() }; this.clearQueue();   // site «Стоп»: S.qq = []
    const r = await this.o.api('/api/mineStop', { c: this.c, sid: this.sid });
    if (r && r.ok) { M.myI = -1; this.tip(TX.stopTip); this.emit({ type: 'state', newFloor: false }); return true; }
    M.want = null; if (r && r.other) this.setOther(true); this.tip((r && r.error) || 'Не получилось', true); return false;
  }
  /** The hero walked away from his stone (site leaveRock): stop digging, tell the game once. */
  leaveRock(): void {
    const M = this.model; if (M.myI < 0) return;
    M.left = { i: M.myI, at: this.now() }; M.want = { i: -1, at: this.now() }; M.myI = -1; this.clearQueue();   // site leaveRock: S.qq = []
    void this.o.api('/api/mineStop', { c: this.c, sid: this.sid });
    this.tip('Герой отошёл от камня и отложил кирку');
    this.emit({ type: 'state', newFloor: false });
  }

  /* ---------------------------------------------------------------- buyer, supplier, quests */
  /** Hero money (smallest unit). */
  heroMoney(): number { const h = (this.o.hero && this.o.hero()) || {}; return Math.max(0, Math.floor(+((h as HeroLike).money || 0))); }
  /** Ore items in the hero's bags (site oreItems): qty items with q > 0 shards. */
  oreItems(): any[] { const h = (this.o.hero && this.o.hero()) || {}; return ((h as HeroLike).items || []).filter((it: any) => it && it.qty && it.q > 0); }
  /** Coins the buyer pays for lines [[uid, shards]] at view prices st.bp (site priceOf). */
  priceOf(lines: [string, number][]): number {
    const P = (this.model.st && this.model.st.bp) || {}, its = this.oreItems(); let t = 0;
    for (const [uid, q] of lines) { const it = its.find((x) => x.uid === uid); if (it) t += q * (+P[it.res] || 0); }
    return Math.floor(t / 100 + 1e-9);
  }
  /** Everything ore in the bag on the counter. */
  allLines(): [string, number][] { return this.oreItems().map((it) => [it.uid, +it.q] as [string, number]); }
  /**
   * «Сдать скупщику». Buyer window on (me.fx.b): POST /api/mineBuy {c, lines, price} with the whole ore bag on the
   * counter (the game answers with a result later, see result()). Old mines: POST /api/mineSell {c}.
   */
  async sell(lines?: [string, number][]): Promise<boolean> {
    const M = this.model;
    if (!M.buyerOn) {
      const r = await this.o.api('/api/mineSell', { c: this.c });
      if (!r || !r.ok) { this.tip((r && r.error) || 'Не получилось', true); return false; }
      this.tip(`${TX.sold} — монеты придут через пару секунд`);
      if (M.me) M.me = { ...M.me, bag: { c: 0, r: {}, p: {} } };
      this.emit({ type: 'state', newFloor: false }); return true;
    }
    const L = (lines || this.allLines()).filter(([, q]) => q > 0), price = this.priceOf(L);
    if (!L.length) { this.tip('Руды в сумке нет — накопай в шахте или забери со склада.', true); return false; }
    if (!(price > 0)) { this.tip('За это и медяка не дам — добавь ещё.', true); return false; }
    if (this.buyWait) return false;
    this.buyWait = { at: this.now(), price }; this.emit({ type: 'busy' });
    const r = await this.o.api('/api/mineBuy', { c: this.c, lines: L, price });
    if (!r || !r.ok) { this.buyWait = null; this.tip((r && r.error) || 'Не получилось', true); this.emit({ type: 'busy' }); return false; }
    if (this.buyWait) this.buyWait.id = r.id;
    const id = r.id; this.T.setTimeout(() => { if (this.buyWait && this.buyWait.id === id) { this.buyWait = null; this.emit({ type: 'busy' }); } }, 25000);
    return true;
  }
  private async op(path: string, body: unknown, ok: (r: any) => void): Promise<boolean> {
    if (this.busyOp) return false; this.busyOp = true; this.emit({ type: 'busy' });
    const r = await this.o.api(path, body); this.busyOp = false;
    if (r && r.ok) ok(r); else this.tip((r && r.error) || 'Не получилось', true);
    this.emit({ type: 'busy' }); return !!(r && r.ok);
  }
  /** Buy the miner helmet: POST /api/mineLamp {c}. */
  lamp(): Promise<boolean> { return this.op('/api/mineLamp', { c: this.c }, () => { this.lampBought = this.now(); this.tip('«Каска шахтёра» в сумке — сейчас появится, тогда надень её'); }); }
  /** Take quest rewards: POST /api/mineClaim {c}. */
  claim(): Promise<boolean> {
    return this.op('/api/mineClaim', { c: this.c }, () => {
      this.claimed = this.now(); this.tip('Награда за поручения — монеты придут через пару секунд');
      const me = this.model.me; if (me && me.q) for (const x of [...me.q.d, ...me.q.w]) if (x.done) x.cl = 1;
    });
  }
  private async sup(path: string, body: unknown): Promise<boolean> {
    if (this.supWait || this.busyOp) return false;
    this.supWait = { at: this.now() }; this.emit({ type: 'busy' });
    const r = await this.o.api(path, body);
    if (!r || !r.ok) { this.supWait = null; this.tip((r && r.error) || 'Не получилось', true); this.emit({ type: 'busy' }); return false; }
    if (this.supWait) this.supWait.id = r.id;
    const id = r.id; this.T.setTimeout(() => { if (this.supWait && this.supWait.id === id) { this.supWait = null; this.emit({ type: 'busy' }); } }, 25000);
    return true;
  }
  /** Upgrade the pickaxe: POST /api/minePick {c, to, use} (use = discount ores the player agrees to give). */
  pick(to: number, use: string[]): Promise<boolean> { return this.sup('/api/minePick', { c: this.c, to, use }); }
  /** Buy the ore bag: POST /api/mineOreBag {c}. */
  oreBag(): Promise<boolean> { return this.sup('/api/mineOreBag', { c: this.c }); }
  /** Put on an item (the helmet) via core actions. */
  async wear(uid: string): Promise<boolean> {
    if (!this.o.equip) return false;
    const r = await this.o.equip(uid); if (!r || !r.ok) { this.tip((r && r.error) || 'Не получилось', true); return false; }
    this.tip('Надето'); this.emit({ type: 'state', newFloor: false }); return true;
  }
  /** «Пока тебя не было» read: POST /api/mineSeen {c}. */
  seen(): void { void this.o.api('/api/mineSeen', { c: this.c }); }

  /** Looks of diggers we know nothing about (asked with the next poll). */
  lookOf(l: string): LookRec | null { return this.model.lookOf(l); }

  /** Leave the mine: POST /api/mine/leave?c= {} and stop timers/subscriptions. */
  close(): void {
    if (this.closed) return;
    if (this.goT) { this.T.clearTimeout(this.goT); this.goT = 0; }
    this.closed = true;
    this.T.clearInterval(this.pollT); this.T.clearInterval(this.pingT); this.T.clearInterval(this.goneT);
    for (const u of this.unsubs) { try { u(); } catch { /* */ } }
    this.unsubs = []; this.subs.clear();
    if (this.entered) { try { void this.o.api('/api/mine/leave' + this.q(), {}); } catch { /* */ } }
  }
}
