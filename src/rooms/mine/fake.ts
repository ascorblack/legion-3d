/**
 * Offline fake of the game's mine endpoints (dev page dev/mine.ts and tests). Starts from a captured, sanitized
 * enter payload (test/fixtures/mine-*.json) and simulates: digging (fast), stones breaking with loot into the hero's
 * ore items, the buyer (mineBuy → result through the 'me' channel), helmet / pickaxe / ore bag purchases, quests,
 * bots walking and digging. NEVER used against the live site.
 */
import type { MinePayload, MineView, MineMe, Bl, CellTuple, CellTuple3 } from './state';
import { N_CELLS, SPEED } from './geo';
import { geomOf } from './geo3';

/** [type, level, resource, a] of cell i in both layouts (classic: by position; «Шахта 3.0»: the listed index); null = fog. */
export function cellTuple(st: MineView, i: number): CellTuple | null {
  const fl = st.fl; if (!fl) return null;
  if (fl.v3) { const c = (fl.c as CellTuple3[]).find((x) => x[0] === i); return c ? [c[1], c[2], c[3], c[4]] : null; }
  return (fl.c as CellTuple[])[i] || null;
}
/** Cell types by index (fog for the cells a big floor does not list). */
function typesOf(st: MineView): string[] {
  const G = geomOf(st), out: string[] = new Array(G.N).fill('fog');
  for (let i = 0; i < G.N; i++) { const c = cellTuple(st, i); if (c) out[i] = c[0]; }
  return out;
}
/** Big floor (fake only): the fog lifts round a dug cell — made-up rock for the newly seen cells (the real server decides). */
function reveal3(st: MineView, i: number): void {
  const fl = st.fl!, G = geomOf(st), R = fl.fog || 2, seen = new Set((fl.c as CellTuple3[]).map((c) => c[0])), gx = i % G.w, gy = Math.floor(i / G.w);
  for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
    const X = gx + dx, Y = gy + dy; if (X < 0 || Y < 0 || X >= G.w || Y >= G.h) continue;
    const j = Y * G.w + X; if (seen.has(j)) continue;
    const h = (j * 2654435761 + st.seed) >>> 0, k = h % 100, lv = st.n + (h >>> 8) % 3;
    const t: CellTuple3 = k < 8 ? [j, 'wall', 0, '', 0] : k < 22 ? [j, 'ore', lv, ['coal', 'iron', 'silver'][(h >>> 4) % 3], 2] : k < 30 ? [j, 'hard', lv + 1, 'limestone', 2] : [j, 'rock', lv, 'limestone', 1];
    (fl.c as CellTuple3[]).push(t);
  }
}

export interface FakeBus { on(type: string, fn: (d: any) => void): () => void; emit(type: string, d: any): void }
export function makeBus(): FakeBus {
  const subs = new Map<string, Set<(d: any) => void>>();
  return {
    on(t, fn) { let s = subs.get(t); if (!s) subs.set(t, (s = new Set())); s.add(fn); return () => { s!.delete(fn); }; },
    emit(t, d) { for (const f of [...(subs.get(t) || [])]) f(d); },
  };
}

export interface FakeHero { login: string; money: number; items: any[]; mn: Record<string, MineMe>; [k: string]: unknown }
export interface FakeOpts {
  login: string; enter: MinePayload; hero: FakeHero; bus: FakeBus;
  /** Seconds a stone takes to dig (fast for demos). */
  digSec?: number; bots?: boolean; log?: (p: string, b: unknown) => void;
  /** Demo states of the site's newer HUD parts (default: read from the page query when there is one, see demoFromQuery). */
  demo?: FakeDemo;
}
/** econ: the stones keep a measured dig rate and diggers (the captured `bl` re-based to now, synthesized for front stones without one), so the estimate sign has real numbers;
 *  (new front stones get one too when a stone breaks); news: «Пока тебя не было» summary; qc: shared weekly quest (prog / ready = done for me and not taken / nomin = done but own share too small / cl = taken); limit: daily cap (low = 40 min left, full = used up). */
export interface FakeDemo { /** ?chatmod=own|mod: I moderate the mine chat (mchat.mod; /api/mine/chat/mod answers). */ chatmod?: 'own' | 'mod'; econ?: boolean; news?: boolean; qc?: 'prog' | 'ready' | 'nomin' | 'cl'; limit?: 'low' | 'full'; /** me.fx.q: the stone queue (site testers' flag). */ fxq?: boolean; /** a made-up last week in st.hist («Итоги шахты»). */ hist?: boolean;
  /** «Шахта 3.0»: lift stage (fund = the shaft is found, coins are collected; up = upgrade timer), open floors, a drill rig next to the hall. */
  lift?: 'fund' | 'up'; deep?: number; drill?: 'site' | 'build' | 'work' }
/** ?econ=1 &news=1 &qc=prog|ready|nomin|cl &limit=low|full of the dev page (dev/mine.ts). */
export function demoFromQuery(search: string): FakeDemo {
  const q = new URLSearchParams(search), d: FakeDemo = {};
  if (q.get('econ') === '1') d.econ = true;
  if (q.get('news') === '1') d.news = true;
  if (q.get('fxq') === '1') d.fxq = true;
  if (q.get('hist') === '1') d.hist = true;
  const cm = q.get('chatmod'); if (cm === 'own' || cm === 'mod') d.chatmod = cm;
  const qc = q.get('qc'); if (qc === 'prog' || qc === 'ready' || qc === 'nomin' || qc === 'cl') d.qc = qc;
  const lim = q.get('limit'); if (lim === 'low' || lim === 'full') d.limit = lim;
  const lf = q.get('lift'); if (lf === 'fund' || lf === 'up') d.lift = lf;
  const dp = +(q.get('deep') || 0); if (dp >= 1 && dp <= 99) d.deep = Math.floor(dp);
  const dr = q.get('drill'); if (dr === 'site' || dr === 'build' || dr === 'work') d.drill = dr;
  return d;
}
/** Applies a demo to a «me» record (pure; used by FakeMine and tests). */
export function applyDemo(me: MineMe, d: FakeDemo, now = Date.now()): void {
  if (d.fxq) me.fx = { ...(me.fx || {}), q: 1 };
  if (d.news) me.news = { b: 7, f: 1, c: 14, cx: 14.4, r: { iron: 3, coal: 1 }, p: { iron: 42, limestone: 30 }, at: now - 3 * 3600e3 };
  if (d.qc) {
    const min = 30, g = 6000, nomin = d.qc === 'nomin';
    me.q = me.q || { d: [], w: [] };
    me.q.c = { id: 'c0', t: 'Вместе выкопайте камней: 6000', p: d.qc === 'prog' ? 4210 : g, g, c: 150, min, me: nomin ? 12 : d.qc === 'prog' ? 38 : 44, n: 212, ok: nomin ? 0 : 1, done: d.qc === 'prog' ? 0 : 1, cl: d.qc === 'cl' ? 1 : 0 };
    // the daily and weekly quests of the captured account are all taken: only q.c can light the claim button
    for (const x of [...me.q.d, ...me.q.w]) { x.done = 1; x.cl = 1; }
  }
  if (d.limit && me.cap > 0) me.day = d.limit === 'full' ? me.cap : Math.max(0, me.cap - 40);
}

/** «Шахта 3.0» demo (pure; FakeMine and tests): lift stage, open floors, a drill rig on the first dug cell next to the hall. */
export function applyMine3Demo(st: MineView, d: FakeDemo, now = Date.now()): void {
  if (!st.fl || !st.fl.v3) return;
  if (d.deep) { st.deep = Math.max(st.n, d.deep); }
  const deep = st.deep || st.n;
  if (d.lift === 'fund') st.lift = { st: 'fund', n: deep, c: 2350, need: 6000, at: 0, ms: 1199880, left: 0, by: [['miner7', 1500], ['miner12', 600], ['miner3', 250]] };
  if (d.lift === 'up') st.lift = { st: 'up', n: deep, c: 6000, need: 6000, at: now + 14 * 60000, ms: 20 * 60000, left: 14 * 60000, by: [['miner7', 4000], ['miner12', 2000]] };
  // the found lift shaft (fund / up): the farthest dug cell from the hall (fake only; the server knows the real one)
  if ((d.lift || d.deep) && st.fl.shaft == null) {
    const fl = st.fl, w = fl.w || 1, hb = fl.hallBox || [0, 0, 0, 0]; let best = -1, bd = -1;
    for (let i = 0; i < st.dug.length; i++) { if (st.dug[i] !== '1') continue; const dx = i % w - hb[0], dy = Math.floor(i / w) - hb[1], dd = dx * dx + dy * dy; if (dd > bd) { bd = dd; best = i; } }
    if (best >= 0) fl.shaft = best;
  }
  if (d.drill) {
    // the first dug cell outside the hall that the hero can see (fake only: the real server places rigs on veins)
    const fl = st.fl, w = fl.w || 1, hb = fl.hallBox || [0, 0, 0, 0];
    let cell = -1;
    for (let i = 0; i < st.dug.length && cell < 0; i++) { if (st.dug[i] !== '1') continue; const x = i % w, y = Math.floor(i / w); if (x >= hb[0] - 1 && x <= hb[0] + hb[2] && y >= hb[1] - 1 && y <= hb[1] + hb[3]) continue; cell = i; }
    if (cell >= 0) {
      const lv = d.drill === 'work' ? 1 : 0;
      st.drills = [['d1', 0, cell, d.drill, lv, d.drill === 'build' ? 3000 : 800, 3000, d.drill === 'build' ? 25 * 60000 : 0, d.drill === 'work' ? 4.5 : 0, d.drill === 'work' ? 60 : 0, d.drill === 'work' ? 2.4 : 0, 'iron', [['miner7', 500], ['miner3', 300]]] as any];
    }
  }
}

/**
 * Econ demo (pure; FakeMine and tests): re-bases the snapshot to `now` and gives every front stone a measured dig
 * state [left, total work, rate/min, diggers]: captured ones keep their rate and diggers (at least 35 % of the work
 * left), the others get a plausible deterministic one (3–15 diggers, 15–55 min). Diggers' logins are made up.
 */
export function applyEconDemo(st: MineView, now = Date.now(), initial = true): void {
  st.at = now;
  const bl = (st.bl = st.bl || {}), dg = (st.dg = st.dg || {});
  for (const i of st.front || []) {
    const c = cellTuple(st, i); if (!c || !(c[1] > 0)) continue;
    const b = bl[i];
    if (b) { if (initial) b[0] = Math.max(b[0], b[1] * 0.35); continue; }
    const h = (i * 2654435761) >>> 0, n = 3 + (h % 13), min = 15 + ((h >>> 8) % 41), w = 0.3 * c[1] * c[1];
    bl[i] = [w * (0.5 + ((h >>> 16) % 40) / 100), w, w / min * (0.6 + ((h >>> 4) % 30) / 100), n] as Bl;
    dg[i] = Array.from({ length: Math.min(4, n) }, (_, k) => `miner${(i * 7 + k) % 97 + 1}`);
  }
}

/** Fake game server. api(path, body) answers like the real one (shapes as in docs/MINE.md). */
export class FakeMine {
  st: MineView; me: MineMe; calls: { p: string; b: unknown }[] = [];
  /** Mine chat moderation (demo chatmod): my role, moderators, mutes / bans. */
  chatMod: { role: 'own' | 'mod' | null; mods: string[]; bans: { l: string; until: number; by: string }[] } = { role: null, mods: [], bans: [] };
  /** The deepest floor's view («home»); an upper floor «home.N» is the same layout with its own n / seed (fake only). */
  private deepSt: MineView;
  /** Mine key of the open floor (enter ?c=). */
  key = 'home';
  private econ = false; private o: FakeOpts; private timers: any[] = []; private resN = 0; private bots: { l: string; x: number; y: number; tx: number; ty: number }[] = [];
  constructor(o: FakeOpts) {
    this.o = o; this.key = String(o.enter.c || 'home');
    this.st = JSON.parse(JSON.stringify(o.enter.st));
    this.me = JSON.parse(JSON.stringify(o.enter.me));
    this.me.fx = { m2: 1, b: 1, pk: 1, sh: 1, ...(this.me.fx || {}) };
    this.me.day = 0;   // a fresh day: the captured account had used its daily cap
    const demo = o.demo ?? (typeof location !== 'undefined' ? demoFromQuery(location.search) : {});
    applyDemo(this.me, demo);
    o.hero.mn = { ...(o.hero.mn || {}), [o.enter.c || 'home']: this.me };
    // the classic floor: the site's front rule; a big floor keeps the captured server front (it knows the fog)
    if (!this.st.fl!.v3) this.st.front = geomOf(this.st).frontOf(this.dugA(), typesOf(this.st));
    if (demo.econ) { this.econ = true; applyEconDemo(this.st); }
    applyMine3Demo(this.st, demo);
    this.deepSt = JSON.parse(JSON.stringify(this.st));
    if (demo.chatmod) this.chatMod = { role: demo.chatmod, mods: ['miner_mod'], bans: [{ l: 'miner_spam', until: Date.now() + 25 * 60000, by: o.login }] };
    if (demo.hist && !(this.st.hist && this.st.hist.length)) this.st.hist = [{ floor: 31, players: 520, top: (this.st.top || []).slice(0, 5).map(([l, u]) => ({ l, u: Math.round(u * 1.2) })) }];
    if (o.bots !== false) this.startBots();
    // the server finishes stones: tick every 500 ms
    this.timers.push(setInterval(() => this.tick(), 500));
  }
  dispose(): void { for (const t of this.timers) { clearInterval(t); clearTimeout(t); } }
  private dugA(): number[] { return this.st.dug.split('').map((c) => (c === '1' ? 1 : 0)); }
  private view(withFl = false): MineView { const v = { ...this.st }; if (!withFl) delete v.fl; return JSON.parse(JSON.stringify(v)); }
  private rebase(): void { const now = Date.now(); for (const x of Object.values(this.st.bl || {})) x[0] = Math.max(0, x[0] - x[2] * (now - this.st.at) / 60000); this.st.at = now; }
  /** Big floor: the layout grows when the fog lifts — a view carries it then (the client keeps the last one otherwise). */
  private flN = -1;
  private push(): void {
    this.rebase(); this.st.v++;
    const n = this.st.fl ? this.st.fl.c.length : 0, withFl = !!(this.st.fl && this.st.fl.v3 && n !== this.flN); this.flN = n;
    this.o.bus.emit('sse:mine', { c: this.key, st: this.view(withFl) });
  }
  private heroSnap(results?: any[]): void { this.o.bus.emit('sse:me', { hero: this.o.hero, results: results || [] }); }

  async api(p: string, b?: any): Promise<any> {
    this.calls.push({ p, b }); if (this.o.log) this.o.log(p, b);
    await new Promise((r) => setTimeout(r, 30));
    const path = p.replace(/\?.*$/, ''), L = this.o.login;
    switch (path) {
      case '/api/mine/enter': {
        const key = decodeURIComponent((/[?&]c=([^&]+)/.exec(p) || [])[1] || 'home');
        if (key !== this.key) this.openKey(key);
        const r: any = { ...this.o.enter, ok: true, sid: 'fake-sid', me: this.me, st: this.view(true), a: this.presenceA() };
        if (this.chatMod.role && r.mchat) {   // demo: I moderate this chat; one line of a moderator
          const chat = (r.mchat.chat || []).map((x: any, k: number) => (k === 1 ? { ...x, r: 'mod' } : x));
          r.mchat = { ...r.mchat, chat, mod: this.chatMod.role };
        }
        return r;
      }
      case '/api/mine/chat/mod': {   // site chatAct / chatPanel (moderators only)
        const M = this.chatMod; if (!M.role) return { ok: false, error: 'forbidden' };
        if (!b) return { ok: true, role: M.role, bans: M.bans, mods: M.role === 'own' ? M.mods : undefined };
        const login = String(b.login || '');
        switch (b.op) {
          case 'del': this.o.bus.emit('sse:mine', { chatRoom: 'mine', chatDel: [b.id] }); return { ok: true, id: b.id };
          case 'mute': M.bans = [...M.bans.filter((x) => x.l !== login), { l: login, until: Date.now() + (+b.min || 30) * 60000, by: L }]; return { ok: true, login };
          case 'ban': M.bans = [...M.bans.filter((x) => x.l !== login), { l: login, until: 0, by: L }]; return { ok: true, login, gone: [] };
          case 'unban': M.bans = M.bans.filter((x) => x.l !== login); return { ok: true, login };
          case 'mod': if (M.role !== 'own') return { ok: false, error: 'forbidden' }; if (!M.mods.includes(login)) M.mods.push(login); return { ok: true, login };
          case 'unmod': if (M.role !== 'own') return { ok: false, error: 'forbidden' }; M.mods = M.mods.filter((x) => x !== login); return { ok: true, login };
        }
        return { ok: false, error: 'bad op' };
      }
      case '/api/mine/state': {
        const v = /[?&]v=(\d+)/.exec(p);
        const r: MinePayload = { ok: true, n: this.bots.length, c: this.key, here: 40 + this.bots.length, hw: Object.keys(this.st.dg || {}).length * 2, hm: 30, me: this.me };
        if (!v || +v[1] !== this.st.v) r.st = this.view(!/[?&]f=/.test(p));
        const lk = /[?&]lk=([^&]+)/.exec(p);
        if (lk) r.lk = Object.fromEntries(decodeURIComponent(lk[1]).split(',').map((l, k) => [l, { n: l, lv: 3 + (k % 5), lk: { color: ['#f2c14e', '#b9a2ff', '#7fd35f', '#ff8fa3', '#8ac8e8'][k % 5] }, g: { h: 'miner' } }]));
        return r;
      }
      case '/api/mine/go': case '/api/mine/ping': case '/api/mine/leave': return { ok: true };
      case '/api/mineSeen': delete this.me.news; return { ok: true };
      case '/api/mineDig': {
        const i = +b.i; if (!(this.st.front || []).includes(i)) return { ok: false, error: 'К этому камню пока не подойти' };
        // queue (site queueRock): the same stone with q → only the queue changes
        if (Array.isArray(b.q)) {
          if (!this.me.fx || !this.me.fx.q || this.me.i !== i) return { ok: false, error: 'Очередь недоступна' };
          this.me.qq = b.q.map(Number).filter((x: number) => x !== i).slice(-2); return { ok: true };
        }
        this.me.qq = [];
        this.rebase(); this.unDig(L);
        const dg = (this.st.dg = this.st.dg || {}), bl = (this.st.bl = this.st.bl || {});
        dg[i] = [L, ...(dg[i] || []).filter((x) => x !== L)].slice(0, 4);
        // work w is done in digSec by one digger: rate (per minute) = w / (digSec / 60); others add to the rate
        const sec = this.o.digSec ?? 8, w = sec * 10, old = bl[i];
        const leftNow = old ? Math.max(1, old[0]) : w;
        // a captured stone nobody digs has rate 0 (big floor views): it starts over at the demo pace
        bl[i] = (old && old[2] > 0 ? [leftNow, old[1], old[2] * (1 + 1 / Math.max(1, old[3])), old[3] + 1] : [w, w, w / (sec / 60), (old ? old[3] : 0) + 1]) as Bl;
        this.me.i = i; this.push(); return { ok: true };
      }
      case '/api/mineStop': this.unDig(L); this.me.i = -1; this.me.qq = []; this.push(); return { ok: true };
      case '/api/mineBuy': {
        const id = 'r' + ++this.resN, lines: [string, number][] = b.lines || [];
        this.timers.push(setTimeout(() => {
          for (const [uid, q] of lines) { const it = this.o.hero.items.find((x) => x.uid === uid); if (it) { it.q -= q; if (it.q <= 0) this.o.hero.items.splice(this.o.hero.items.indexOf(it), 1); } }
          this.o.hero.money += b.price;
          this.heroSnap([{ id, ok: true, x: { op: 'mineBuy', c: b.price, t: 'Хорошая руда! Держи {coins}.' } }]);
        }, 900));
        return { ok: true, id };
      }
      case '/api/mineSell': this.me.bag = { c: 0, r: {}, p: {} }; return { ok: true };
      case '/api/mineRide': {   // site ride: the hero gets off his stone and is on floor n (me.at)
        const deep = this.deepSt.deep || this.deepSt.n, n = Math.floor(+b.n);
        if (!(n >= 1 && n <= deep)) return { ok: false, error: 'Этаж ещё не открыт' };
        this.unDig(L); this.me.i = -1; this.me.at = n; return { ok: true };
      }
      case '/api/mineLift': {   // coins / ore into the lift's collection (only while it collects)
        const S = this.st.lift || {}; if (S.st !== 'fund') return { ok: false, error: 'Сбор на лифт сейчас не идёт' };
        const got = this.payIn(b); if (got < 0) return { ok: false, error: 'Не хватает монет' };
        S.c = Math.min(S.need || 0, (S.c || 0) + got);
        const by = (S.by = (S.by || []) as [string, number][]), me = by.find((x) => x[0] === L); if (me) me[1] += got; else by.unshift([L, got]);
        if ((S.c || 0) >= (S.need || 0)) { S.st = 'up'; S.at = Date.now() + (S.ms || 60000); S.left = S.ms || 60000; }
        this.push(); return { ok: true };
      }
      case '/api/mineDrill': {
        const d = (this.st.drills || []).find((x) => x[0] === b.k) as any[] | undefined; if (!d) return { ok: false, error: 'Буровой нет' };
        if (!(d[3] === 'site' || d[3] === 'work') || d[4] >= 3) return { ok: false, error: 'Сбор на буровую сейчас не идёт' };
        const got = this.payIn(b); if (got < 0) return { ok: false, error: 'Не хватает монет' };
        d[5] = Math.min(d[6], d[5] + got);
        const by = (d[12] = d[12] || []) as [string, number][], me = by.find((x) => x[0] === L); if (me) me[1] += got; else by.unshift([L, got]);
        if (d[5] >= d[6]) { d[3] = 'build'; d[7] = 30 * 60000; d[5] = 0; }
        this.push(); return { ok: true };
      }
      case '/api/mineLamp': this.timers.push(setTimeout(() => { this.o.hero.items.push({ uid: 'ihelm' + this.resN++, id: 'miner_helmet', name: 'Каска шахтёра', slot: 'helmet', on: false, wearable: true }); this.heroSnap(); }, 600)); return { ok: true };
      case '/api/mineClaim': { for (const x of [...(this.me.q?.d || []), ...(this.me.q?.w || [])]) if (x.done) x.cl = 1; const qc = this.me.q?.c; if (qc && qc.done && qc.ok) qc.cl = 1; return { ok: true }; }
      case '/api/minePick': { const id = 'r' + ++this.resN; this.timers.push(setTimeout(() => { if (this.me.pkx) this.me.pkx.lv = b.to; this.heroSnap([{ id, ok: true, x: { op: 'minePick', to: b.to } }]); }, 700)); return { ok: true, id }; }
      case '/api/mineOreBag': { const id = 'r' + ++this.resN; this.timers.push(setTimeout(() => { if (this.me.pkx) this.me.pkx.ob = { cap: this.me.pkx.obC, used: 0 }; this.heroSnap([{ id, ok: true, x: { op: 'mineOreBag' } }]); }, 700)); return { ok: true, id }; }
      case '/api/mine/chat/say': this.o.bus.emit('sse:mine', { chatRoom: 'mine', chat: [{ id: 'c' + Date.now(), l: L, n: L, t: b.text, at: Date.now() }] }); return { ok: true };
      case '/api/equip': { const it = this.o.hero.items.find((x) => x.uid === b.uid); if (it) { for (const o of this.o.hero.items) if (o.slot === it.slot) o.on = false; it.on = true; } this.heroSnap(); return { ok: true }; }
    }
    return { ok: false, error: 'fake: ' + path };
  }
  /** Coins + ore lines of a collection, in coins (ore at the buyer's price); −1 = not enough coins. Takes them from the hero. */
  private payIn(b: any): number {
    const coins = Math.max(0, Math.floor(+b.coins || 0)), H = this.o.hero, P = this.st.bp || {};
    if (coins > (+H.money || 0)) return -1;
    H.money = (+H.money || 0) - coins; let got = coins;
    for (const [uid, q] of (Array.isArray(b.lines) ? b.lines : []) as [string, number][]) {
      const it = H.items.find((x) => x.uid === uid); if (!it) continue;
      const n = Math.min(+it.q || 0, +q || 0); got += Math.floor(n * (+P[it.res] || 0) / 100);
      it.q -= n; if (it.q <= 0) H.items.splice(H.items.indexOf(it), 1);
    }
    this.timers.push(setTimeout(() => this.heroSnap(), 400));
    return got;
  }
  /** Open another floor key (fake): «home» = the deepest floor; «home.N» = floor N (same layout, own n / seed). */
  private openKey(key: string): void {
    this.key = key;
    const m = /\.(\d+)$/.exec(key), deep = this.deepSt.deep || this.deepSt.n, n = m ? Math.min(deep, +m[1]) : deep;
    if (n === deep) { this.st = JSON.parse(JSON.stringify(this.deepSt)); }
    else { this.st = JSON.parse(JSON.stringify(this.deepSt)); this.st.n = n; this.st.seed = this.deepSt.seed + n; this.st.v = 1; this.st.bl = {}; this.st.dg = {}; this.st.drills = []; }
    this.me.at = n; this.flN = -1;
  }
  private nextQueued = false;
  private takeQueued(): void {
    const L = this.o.login, q = (this.me.qq || []).slice();
    while (q.length) {
      const i = q.shift()!;
      if (this.st.dug[i] === '1' || !(this.st.front || []).includes(i)) continue;
      const dg = (this.st.dg = this.st.dg || {}), bl = (this.st.bl = this.st.bl || {}), sec = this.o.digSec ?? 8, w = sec * 10, old = bl[i];
      dg[i] = [L, ...(dg[i] || []).filter((x) => x !== L)].slice(0, 4);
      bl[i] = (old ? [Math.max(1, old[0]), old[1], old[2] * (1 + 1 / Math.max(1, old[3])), old[3] + 1] : [w, w, w / (sec / 60), 1]) as Bl;
      this.me.i = i; break;
    }
    this.me.qq = q;
    this.heroSnap();
  }
  private unDig(L: string): void {
    for (const [k, ls] of Object.entries(this.st.dg || {})) {
      if (!ls.includes(L)) continue;
      const left = ls.filter((x) => x !== L); if (left.length) this.st.dg![k] = left; else { delete this.st.dg![k]; delete this.st.bl![k]; }
    }
  }
  private tick(): void {
    const now = Date.now(); let ch = false;
    for (const [k, b] of Object.entries(this.st.bl || {})) {
      const left = b[0] - b[2] * (now - this.st.at) / 60000;
      if (left > 0) continue;
      const i = +k, cell = cellTuple(this.st, i) || ['rock', 1, 'stone', 1], ls = (this.st.dg || {})[k] || [];
      const d = this.st.dug.split(''); d[i] = '1'; this.st.dug = d.join('');
      if (this.st.fl!.v3) reveal3(this.st, i);
      delete this.st.bl![k]; delete this.st.dg![k];
      const r = cell[2] || 'stone', got: Record<string, number> = {};
      for (const l of ls) got[l] = cell[0] === 'ore' || cell[0] === 'rare' ? 120 + Math.floor(Math.random() * 150) : 30 + Math.floor(Math.random() * 40);
      this.st.dl = [[i, this.st.n, r, {}, got], ...(this.st.dl || [])].slice(0, 16) as any;
      if (ls.includes(this.o.login)) {
        const q = got[this.o.login]; const it = this.o.hero.items.find((x) => x.qty && x.res === r);
        if (it) it.q += q; else this.o.hero.items.push({ uid: 'ore_' + r, id: 'ore_' + r, name: r, slot: 'material', mat: 'ore', qty: true, q, res: r });
        const qc = this.me.q?.c; if (qc && !qc.done) { qc.p++; qc.me++; qc.ok = qc.me >= qc.min ? 1 : 0; if (qc.p >= qc.g) qc.done = 1; }
        this.me.i = -1; this.me.bag = { ...(this.me.bag || { c: 0, r: {} }), cx: +((this.me.bag?.cx || 0) + 0.4).toFixed(2) };
        this.nextQueued = true;
        this.heroSnap();
      }
      this.st.log = [{ t: `${ls[0] || 'кто-то'} выкопал камень ${cell[1]} ур.`, at: now }, ...(this.st.log || [])].slice(0, 12);
      ch = true;
    }
    if (ch) {
      this.st.front = geomOf(this.st).frontOf(this.dugA(), typesOf(this.st)); if (this.econ) { this.rebase(); applyEconDemo(this.st, this.st.at, false); }
      // the game takes the next queued stone by itself (site: «герой возьмёт их сам»)
      if (this.nextQueued) { this.nextQueued = false; this.takeQueued(); }
      this.push();
    }
  }
  private presenceA() { return this.bots.map((b) => ({ l: b.l, n: b.l, lv: 4, lk: { color: '#b9a2ff' }, g: { h: 'miner' }, x: b.x, y: b.y, tx: b.tx, ty: b.ty, dt: 0 })); }
  private startBots(): void {
    const G = geomOf(this.st);
    for (let k = 0; k < 5; k++) { const p = G.spawn('bot' + k); this.bots.push({ l: 'bot' + (k + 1), x: p.x, y: p.y, tx: p.x, ty: p.y }); }
    this.timers.push(setInterval(() => {
      const b = this.bots[Math.floor(Math.random() * this.bots.length)];
      const dug = this.dugA(); const cells = dug.map((d, i) => (d ? i : -1)).filter((i) => i >= 0);
      let t = { x: 0, y: 0 };
      if (Math.random() < 0.5 && cells.length) { const i = cells[Math.floor(Math.random() * cells.length)], c = G.cellXY(i); t = { x: c.cx, y: c.cy + 34 }; }
      else if (G.v3) { const [hx, hy, hw, hh] = G.hall; t = G.free(hx + Math.random() * hw, hy + Math.random() * hh); }
      else t = G.free(100 + Math.random() * 820, 2000 + Math.random() * 400);
      const p = { x: b.tx, y: b.ty }; b.x = p.x; b.y = p.y; b.tx = t.x; b.ty = t.y;
      this.o.bus.emit('sse:mine', { c: this.key, m: [[b.l, b.x, b.y, b.tx, b.ty, 0]], n: this.bots.length });
    }, 1500));
    // bots talk in the mine chat now and then (made-up lines)
    const LINES = ['кто копает у входа?', 'го на нижний ряд', 'ура, железо!', 'тут жила, помогите', 'скупщик сегодня щедрый', 'у кого каска лишняя?', 'ещё пару камней и спуск', 'мяу, кирка тупая'];
    let cn = 0;
    this.timers.push(setInterval(() => {
      const b = this.bots[Math.floor(Math.random() * this.bots.length)]; if (!b) return;
      this.o.bus.emit('sse:mine', { chatRoom: 'mine', chat: [{ id: 'fk' + Date.now() + (cn++), s: 90000 + cn, l: b.l, n: b.l, t: LINES[Math.floor(Math.random() * LINES.length)], at: Date.now(), c: 'archer', cn: 'Лучник' }] });
    }, 7000));
    void SPEED; void N_CELLS;
  }
}
