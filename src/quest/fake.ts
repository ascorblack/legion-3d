/**
 * Deterministic fake expedition: realistic SSE `q` payloads over time, shaped like the real ones as far as the site's
 * reader (quest.js) tells — see docs/QUEST.md. For dev pages and tests ONLY; never used against the live site.
 *
 * Timeline (seconds at speed 1): gather 20 → vote «Куда идём?» 15 → travel 8 → battle (one front) → treasure (rune door)
 * → rest → travel → battle (surrounded, two fronts) → generated boss (phases, mechanics, arena platforms) → loot vote → {on:false}.
 *
 *   const fq = new FakeQuest({ login: 'murka', role: 'archer' });
 *   fq.at(30_000)                      // payload 30 s after start (pure, deterministic)
 *   const stop = fq.run(bus);          // emits 'sse:q' every tick (bus = window.__L3D_BUS or makeBus())
 *
 * Everything is a function of (seed, elapsed ms): the same seed gives byte-identical payloads.
 */
import type { QuestPayload, QuestBattle, FormEntry, FoeEntry, Side, QuestBossGen, QuestVote, BossMech } from './model';
import { BASE_CMD, frontsFor, type Role } from './model';

export interface FakeQuestOpts {
  /** my login (the viewer) — lower case, like the site's X.login() */
  login?: string;
  role?: Role;
  seed?: number;
  /** server epoch (ms) of t = 0 */
  t0?: number;
  /** stream delay the server reports (s) */
  dl?: number;
  /** >1 runs faster (all durations divided) */
  speed?: number;
  /** viewer not in the party (spectator view: hp null, party 'out') */
  spectator?: boolean;
}

/* ------------------------------------------------------------------ the party: 12 cute cats */

const CATS: [login: string, name: string, role: Role][] = [
  ['barsik', 'Барсик', 'legionary'], ['pushok', 'Пушок', 'paladin'], ['ugolek', 'Уголёк', 'legionary'], ['ryzhik', 'Рыжик', 'rogue'],
  ['snezhok', 'Снежок', 'archer'], ['iriska', 'Ириска', 'mage'], ['persik', 'Персик', 'necromancer'], ['tuchka', 'Тучка', 'priest'],
  ['zefir', 'Зефир', 'archer'], ['kotleta', 'Котлета', 'recruit'], ['businka', 'Бусинка', 'priest'],
];

function rng(seed: number) { let a = (seed >>> 0) || 1; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

/* ------------------------------------------------------------------ plan */

type Phase = { st: 'intro' | 'party' | 'hit' | 'tele' | 'tele2' | 'end'; from: number; to: number; round: number; after?: 'party' | 'tele' };
interface BattlePlan {
  id: string; title: string; ter: string; roll: number; fronts: Side[]; maxR: number;
  foes: { side: Side; type: string; lead: boolean; name: string }[];
  /** dmg[hitIndex][foe] — fraction of hp removed by the n-th party hit (sums to 1 per foe on the last one) */
  dmg: number[][]; phases: Phase[]; words: string[];
}
interface BossPlan { from: number; to: number; rounds: { from: number; to: number; ph: number; mech: BossMech | null; st: 'party' | 'boss' | 'trans' }[]; end: number }
type Seg =
  | { k: 'gather'; from: number; to: number }
  | { k: 'map'; from: number; to: number; vote: { id: number; opts: [string, string, number][]; win: number } }
  | { k: 'travel'; from: number; to: number; t: string; ter: string }
  | { k: 'battle'; from: number; to: number; b: BattlePlan }
  | { k: 'treasure'; from: number; to: number }
  | { k: 'rest'; from: number; to: number }
  | { k: 'bossgen'; from: number; to: number; boss: BossPlan }
  | { k: 'loot'; from: number; to: number }
  | { k: 'off'; from: number; to: number };

const S = 1000;

export class FakeQuest {
  readonly login: string; readonly role: Role; readonly t0: number; readonly dl: number; readonly speed: number; readonly spectator: boolean;
  readonly segs: Seg[]; readonly duration: number;
  private party: [string, string, Role][];
  private myIdx: number;

  constructor(o: FakeQuestOpts = {}) {
    this.login = (o.login || 'murka').toLowerCase(); this.role = o.role || 'archer';
    this.t0 = o.t0 ?? 1_800_000_000_000; this.dl = o.dl ?? 4; this.speed = Math.max(0.1, o.speed || 1); this.spectator = !!o.spectator;
    const R = rng(o.seed ?? 7);
    this.party = CATS.slice();
    this.myIdx = 4;   // me between the melee and the archers
    if (!this.spectator) this.party.splice(this.myIdx, 0, [this.login, 'Мурка', this.role]);
    const segs: Seg[] = []; let t = 0;
    type SegIn = Seg extends infer X ? (X extends Seg ? Omit<X, 'from' | 'to'> & { len: number } : never) : never;
    const add = (s: SegIn) => { const { len, ...rest } = s; segs.push({ ...rest, from: t, to: t + len } as Seg); t += len; };
    add({ k: 'gather', len: 20 * S });
    add({ k: 'map', len: 15 * S, vote: { id: 101, opts: [['Тёмный лес', 'Курган', 0.9], ['Старый мост', 'Старый мост', 0.6], ['Ущелье', 'Ущелье', 0.3]], win: 1 } });
    add({ k: 'travel', len: 8 * S, t: 'Тёмный лес', ter: 'Курган' });
    const b1 = this.battle(R, 'b1', 'Волчья стая', 'Курган', 14, [['wolf', 'Серый волк', 0], ['wolf', 'Серый волк', 0], ['wolf', 'Матёрый волк', 1], ['wolf', 'Волчонок', 0]], 2, t);
    add({ k: 'battle', len: b1.phases[b1.phases.length - 1].to - t, b: b1 });
    add({ k: 'treasure', len: 16 * S });
    add({ k: 'rest', len: 10 * S });
    add({ k: 'travel', len: 6 * S, t: 'Старый мост', ter: 'Старый мост' });
    const b2 = this.battle(R, 'b2', 'Засада у моста', 'Старый мост', 5, [['bandit', 'Разбойник', 0], ['skeleton', 'Скелет', 0], ['bandit', 'Атаман', 1], ['skeleton', 'Скелет-лучник', 0], ['bandit', 'Разбойник', 0], ['skeleton', 'Скелет', 0]], 3, t);
    add({ k: 'battle', len: b2.phases[b2.phases.length - 1].to - t, b: b2 });
    const boss = this.bossPlan(t);
    add({ k: 'bossgen', len: boss.end - t, boss });
    add({ k: 'loot', len: 12 * S });
    add({ k: 'off', len: 1 });
    this.segs = segs; this.duration = t;
  }

  private battle(R: () => number, id: string, title: string, ter: string, roll: number, foes: [string, string, number][], maxR: number, start: number): BattlePlan {
    const fronts = frontsFor(roll), phases: Phase[] = []; let t = start;
    const ph = (st: Phase['st'], len: number, round: number, after?: Phase['after']) => { phases.push({ st, from: t, to: t + len, round, ...(after ? { after } : {}) }); t += len; };
    ph('intro', 3 * S, 1);
    for (let r = 1; r <= maxR; r++) { ph('party', 10 * S, r); ph('hit', 3 * S, r, 'party'); if (r < maxR) { ph('tele', 6 * S, r); ph('tele2', 2 * S, r, 'tele'); } }
    ph('end', 6 * S, maxR);
    const fs = foes.map(([type, name, lead], i) => ({ side: fronts[i % fronts.length], type, lead: !!lead, name }));
    // damage per party hit: random shares, the last hit finishes everybody
    const raw = Array.from({ length: maxR }, () => fs.map(() => 0.2 + R()));
    const dmg = raw.map((row, h) => row.map((x, f) => { const tot = raw.reduce((a, rr) => a + rr[f], 0); return h === maxR - 1 ? 1 - raw.slice(0, h).reduce((a, rr) => a + rr[f] / tot, 0) : x / tot; }));
    return { id, title, ter, roll, fronts, maxR, foes: fs, dmg, phases, words: ['щит', 'пригнись', 'в сторону', 'держись'] };
  }

  private bossPlan(start: number): BossPlan {
    const rounds: BossPlan['rounds'] = []; let t = start + 4 * S;
    const r = (st: 'party' | 'boss' | 'trans', len: number, ph: number, mech: BossMech | null) => { rounds.push({ from: t, to: t + len, ph, st, mech }); t += len; };
    r('party', 10 * S, 1, null);
    r('boss', 8 * S, 1, { id: 'M10', name: 'Телеграф', icon: '⚡', fam: 'word', text: 'Гнилозуб замахивается хвостом', word: 'ПРЫЖОК', how: 'прыжок', need: 8, got: 0 });
    r('party', 10 * S, 1, null);
    r('trans', 4 * S, 2, null);
    r('boss', 9 * S, 2, { id: 'M21', name: 'Трясина', icon: '🌀', fam: 'position', text: 'Площадки 2 и 3 уходят под воду', zones: [2, 3], tip: 'Перейди на целую площадку' });
    r('party', 10 * S, 2, null);
    r('boss', 7 * S, 2, { id: 'M40', name: 'Финт', icon: '🎭', fam: 'silence', fake: true, text: 'Босс делает вид, что бьёт' });
    r('party', 10 * S, 2, null);
    return { from: start, to: t, rounds, end: t + 8 * S };
  }

  /* -------------------------------------------------------------- payload at time t (ms since start) */

  at(tms: number): QuestPayload {
    const t = Math.max(0, tms * this.speed);   // plan time
    const seg = this.segs.find((s) => t >= s.from && t < s.to) || this.segs[this.segs.length - 1];
    const srv = (pt: number) => Math.round(this.t0 + pt / this.speed);   // plan time → server ms
    if (seg.k === 'off') return { on: false, now: srv(t) };
    const joined = this.spectator ? false : t >= 6 * S;
    const base: QuestPayload = {
      on: true, dl: this.dl, now: srv(t), at: srv(t), n: Math.min(this.party.length, 3 + Math.floor(t / (1.7 * S))),
      party: joined ? 'in' : 'out', cm: seg.k === 'gather' || seg.k === 'rest' || seg.k === 'map',
    };
    if (base.n! < this.party.length && seg.k !== 'gather') base.n = this.party.length;
    const lt = t - seg.from;
    switch (seg.k) {
      case 'gather': return { ...base, k: 'gather', t: 'Сбор у ворот', gather: { until: srv(seg.to) } };
      case 'map': return { ...base, k: 'map', t: 'Перекрёсток', vote: this.vote(seg, lt, srv) };
      case 'travel': return { ...base, k: 'travel', t: seg.t, ter: seg.ter };
      case 'rest': return { ...base, k: 'rest', t: 'Привал у костра', ter: 'Курган' };
      case 'treasure': return { ...base, k: 'treasure', t: 'Сокровищница', ter: 'Курган', tr: this.treasure(seg, lt, srv), ...(lt > 9 * S ? { late: [[srv(seg.from + 8 * S), 'код', 2]] as [number, string, number][] } : {}) };
      case 'battle': return { ...base, k: 'battle', t: seg.b.title, ter: seg.b.ter, roll: { by: 'barsik', n: seg.b.roll, tier: seg.b.roll <= 7 ? 'bad' : seg.b.roll >= 16 ? 'good' : 'mid' }, cm: false, b: this.battleAt(seg.b, t, srv) };
      case 'bossgen': return { ...base, k: 'bossgen', t: 'Логово Гнилозуба', ter: 'Курган', dg: 'Опасно: при гибели теряется часть монет', cm: false, ...this.bossAt(seg.boss, t, srv) };
      case 'loot': return { ...base, k: 'map', t: 'Делёж добычи', loot: { name: 'Клык Гнилозуба', until: srv(seg.to), n: Math.min(9, Math.floor(lt / 900)), ...(!this.spectator && lt > 4 * S ? { my: true } : {}) } };
    }
    return base;
  }

  private vote(seg: Extract<Seg, { k: 'map' }>, lt: number, srv: (n: number) => number): QuestVote {
    const sec = lt / S, done = lt >= seg.to - seg.from - 2 * S;   // last 2 s: result shown («Идём!»)
    const opts = seg.vote.opts.map(([label, , rate], i) => [i + 1, label, '', Math.floor(sec * rate) + (i === seg.vote.win - 1 && !this.spectator && sec > 5 ? 1 : 0), 0] as QuestVote['opts'][number]);
    return { id: seg.vote.id, title: 'Куда идём?', end: srv(seg.to - 2 * S), done, ...(done ? { win: seg.vote.win } : {}), opts, ...(!this.spectator && sec > 5 ? { my: seg.vote.win } : {}) };
  }

  private treasure(seg: Seg, lt: number, srv: (n: number) => number) {
    const act = lt >= 3 * S && lt < 12 * S, res = lt >= 12 * S;
    const best: [string, string, string][] = lt > 6 * S ? [['1321', 'gyrg', 'Ириска'], ['3121', 'yygg', 'Зефир']] : [];
    return {
      name: 'Дверь с рунами', icon: '🔐', type: 'code', tre: true, len: 4, max: 6, per: 3, rd2: { door: 1, dbl: 0, ep: 0, left: this.spectator || lt <= 7 * S ? 3 : 2, my: '', ph: '' }, st: res ? (lt < 14 * S ? 'fire' : 'done') : act ? 'act' : 'intro',
      intro: 'Руны на двери светятся — подбери код', how: 'Код из 4 рун (цифры 1–6, руны могут повторяться): «код 1 2 3 4»',
      ...(act ? { until: srv(seg.from + 12 * S), actedN: Math.floor((lt - 3 * S) / 1000), total: this.party.length, acted: !this.spectator && lt > 7 * S, best } : {}),
      ...(res ? { res: { win: true, text: 'Дверь открылась: сундук с монетами', sv: true, me: this.spectator ? {} : { gain: 120, xp: 15, st: 'ok' } } } : {}),
    };
  }

  /* -------------------------------------------------------------- battle */

  private form(fronts: Side[]): FormEntry[] {
    return this.party.map(([l, , role], i) => [l, role, fronts.length > 1 ? fronts[i % fronts.length] : '', null, role === 'legionary' || role === 'paladin', i % 3]);
  }

  private battleAt(P: BattlePlan, t: number, srv: (n: number) => number): QuestBattle {
    const ph = P.phases.find((p) => t >= p.from && t < p.to) || P.phases[P.phases.length - 1];
    const hitsDone = P.phases.filter((p) => p.st === 'hit' && p.after === 'party' && p.from <= t).length;   // hit applies at its start
    const teleHits = P.phases.filter((p) => p.st === 'tele2' && p.after === 'tele' && p.from <= t).length;
    const foes: FoeEntry[] = P.foes.map((f, i) => {
      let hp = 1; for (let h = 0; h < hitsDone; h++) hp -= P.dmg[h][i];
      return [f.side, f.type, f.lead, Math.max(0, Math.round(hp * 1000) / 1000), f.name];
    });
    const form = this.form(P.fronts), lt = t - ph.from;
    const myHp = this.spectator ? null : Math.max(0.2, 1 - teleHits * 0.09);
    const b: QuestBattle = {
      id: P.id, title: P.title, round: ph.round, maxR: P.maxR, st: ph.st, until: srv(ph.to),
      hp: myHp, me: this.spectator ? -1 : this.myIdx, form, fighters: form.length, foes,
      cr: { fr: P.fronts.slice(), cam: 1, ...(P.roll === 1 ? { chaos: true } : {}) },
      low: this.party.filter((_, i) => i % 4 === 1).map(([l, n], i) => [l, n, Math.max(0.15, 0.9 - (teleHits + i) * 0.15)]),
      sk: this.role === 'archer' ? [['град', Math.max(0, 2 - ph.round + 1) % 3, ''], ['прицел', 0, '']] : this.role === 'priest' ? [['оберег', 0, 'heal']] : [],
      fd: this.feed(P, t),
    };
    if (ph.st === 'party' && !this.spectator && lt > 3 * S) { b.turn = this.role === 'archer' ? 'ranged' : this.role === 'mage' ? 'magic' : this.role === 'priest' ? 'heal' : 'melee'; b.tg = ['', (form[this.myIdx][2] || undefined) as Side | undefined]; }
    if (ph.st === 'tele') {
      const word = P.words[(ph.round - 1) % P.words.length];
      b.tele = { word, kind: 'shield', text: `${P.foes[0].name} готовит бросок!`, got: Math.min(8, Math.floor(lt / 600)), need: 8, ...(!this.spectator && lt > 2.5 * S ? { ok: true } : {}) };
    }
    if ((ph.st === 'hit' || ph.st === 'tele2') && !this.spectator) {
      const foe = P.foes[(ph.round + 1) % P.foes.length];
      b.mine = ph.after === 'party'
        ? { k: 'party', r: ph.round, me: { n: 1, d: 11 + ph.round * 3, e: foe.name, k: this.role === 'archer' ? 'ranged' : this.role === 'mage' ? 'magic' : 'melee', ...(ph.round === 2 ? { c: true } : {}) } }
        : { k: 'tele', r: ph.round, ok: true, me: { hurt: 4, by: P.foes[0].name } };
    }
    if (ph.st === 'end') b.res = { how: 'win', xp: 40 + P.foes.length * 10, coins: 90 + P.foes.length * 25 };
    return b;
  }

  private feed(P: BattlePlan, t: number): string[] {
    const out: string[] = [];
    for (const p of P.phases) {
      if (p.from > t) break;
      if (p.st === 'intro') out.push(`⚔ ${P.title}: ${P.foes.length} врагов`);
      if (p.st === 'hit' && p.after === 'party') out.push(`🗡 Отряд бьёт: раунд ${p.round}`);
      if (p.st === 'hit' && p.after === 'tele') out.push(`🐺 ${P.foes[0].name} атакует — отбили`);
      if (p.st === 'end') out.push('🏆 Победа!');
    }
    return out.slice(-6);
  }

  /* -------------------------------------------------------------- boss */

  private bossAt(B: BossPlan, t: number, srv: (n: number) => number): Pick<QuestPayload, 'b' | 'bg'> {
    const r = B.rounds.find((x) => t >= x.from && t < x.to);
    const partyDone = B.rounds.filter((x) => x.st === 'party' && x.to <= t).length;
    const hp = Math.max(0, 1 - partyDone * 0.25), end = t >= B.to;
    const round = Math.max(1, B.rounds.filter((x) => x.st === 'party' && x.from <= t).length);
    const ph = r ? r.ph : end ? 2 : 1, st = end ? 'end' : r ? r.st : 'party';
    let mech: BossMech | null = null;
    if (r && r.mech) { mech = { ...r.mech, until: srv(r.to) }; if (mech.need != null) mech.got = Math.min(mech.need, Math.floor((t - r.from) / 700)); if (mech.fam === 'position') mech.me = !this.spectator; }
    const zn = { a: [[1, [2, 3], [[300, 820], [560, 800], [600, 900], [320, 930]]], [2, [1, 4], [[640, 790], [900, 780], [940, 880], [660, 900]]], [3, [1, 4], [[420, 940], [700, 930], [720, 1030], [400, 1040]]], [4, [2, 3], [[760, 920], [1020, 910], [1050, 1010], [780, 1030]]]] as [number, number[], [number, number][]][], gone: ph === 2 && t > (B.rounds[4]?.to ?? Infinity) ? [3] : [] };
    const myHp = this.spectator ? 0 : Math.max(0.3, 1 - partyDone * 0.12);
    const bg: QuestBossGen = {
      name: 'Гнилозуб', title: 'Повелитель трясины', danger: 2, ph, phs: 2, hp: end ? 0 : hp,
      adds: ph === 2 && !end ? [['Пиявка', 2, 0.6]] : [], st, acted: !this.spectator && st === 'party' && !!r && t - r.from > 3 * S,
      in: !this.spectator, my: myHp, limit: 8, round, rage: ph === 2, zn, area: this.spectator ? 0 : 1, mech,
    };
    const form = this.form(['R']);
    const b: QuestBattle = {
      id: 'boss1', title: 'Гнилозуб', round, maxR: 8, st: end ? 'end' : st === 'party' ? 'party' : st === 'trans' ? 'trans' : 'mech',
      until: r ? srv(r.to) : srv(B.end), hp: this.spectator ? null : myHp, me: this.spectator ? -1 : this.myIdx, form, fighters: form.length, foes: [],
      gb: { name: bg.name, title: bg.title, phase: ph, phases: 2, hp: bg.hp, ...(mech ? { mech: { icon: mech.icon, name: mech.name, text: mech.text } } : {}) },
      ...(end ? { res: { how: 'win', xp: 220, coins: 600 } } : {}),
    };
    if (bg.acted) b.turn = BASE_CMD[this.role] === 'выстрел' ? 'ranged' : 'melee';
    return { b, bg };
  }

  /* -------------------------------------------------------------- driver */

  /** Emit 'sse:q' to a bus every tickMs from now; returns stop(). `clock` defaults to Date.now. */
  run(bus: { emit(type: string, d: unknown): void }, o: { tickMs?: number; clock?: () => number } = {}): () => void {
    const clock = o.clock || Date.now, start = clock();
    let timer: ReturnType<typeof setInterval> | null = null;
    const tick = () => {
      const el = clock() - start, v = this.at(el);
      // re-base server times onto the real clock so `until` counts down for real
      bus.emit('sse:q', rebase(v, start - this.t0));
      if (!v.on && timer) { clearInterval(timer); timer = null; }
    };
    tick(); timer = setInterval(tick, o.tickMs || 1000);
    return () => { if (timer) clearInterval(timer); timer = null; };
  }
}

const TIME_KEYS = new Set(['until', 'end', 'at', 'now']);
/** Shift every server timestamp field (until/end/at/now and late[i][0]) by dt ms. */
export function rebase<T>(v: T, dt: number): T {
  if (!dt) return v;
  const walk = (x: any, key?: string): any => {
    if (Array.isArray(x)) return key === 'sq' ? x.map(p => [p[0], p[1] + dt]) : key === 'late' ? x.map((l) => [l[0] + dt, ...l.slice(1)]) : x.map((y) => walk(y));
    if (x && typeof x === 'object') { const o: any = {}; for (const k of Object.keys(x)) o[k] = TIME_KEYS.has(k) && typeof x[k] === 'number' ? x[k] + dt : walk(x[k], k); return o; }
    return x;
  };
  return walk(v);
}

/** Every payload of the fake at a fixed step (tests, recordings). */
export function fakeTimeline(o: FakeQuestOpts = {}, stepMs = 500): QuestPayload[] {
  const f = new FakeQuest(o), out: QuestPayload[] = [];
  for (let t = 0; t <= f.duration / f.speed + stepMs; t += stepMs) out.push(f.at(t));
  return out;
}
