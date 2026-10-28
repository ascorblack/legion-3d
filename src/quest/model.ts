/**
 * Expedition («Поход») data model: types for the SSE `q` payload and pure helpers.
 *
 * Source of truth: the site's own reader `.local/site-new/quest.js` (LGQuest) plus the overlay helpers it loads
 * (`/site/q/battlecrowd.js`, `crowdcam.js`, `shelf.js`, `battle.js`). Every field below is typed from a concrete read in
 * that code — see docs/QUEST.md for the code location of each. Fields we never saw read are absent; fields whose
 * meaning is inferred are marked `[guess]`. Everything is optional except `on`: the server sends a per-viewer view
 * and omits blocks that do not apply. Never trust a field blindly — use the guards and `normBattle()`.
 *
 * Pure module: no DOM, no timers, no allocations in hot paths other than the snapshot objects it returns.
 */

/* ------------------------------------------------------------------ primitives */

export type Side = 'L' | 'R' | 'F';
/** Stage kinds of `q.k` (quest.js KIND_RU). */
export const KINDS = ['battle', 'trap', 'treasure', 'lair', 'rest', 'shop', 'event', 'map', 'travel', 'town', 'gather', 'boss', 'dungeon', 'bossgen'] as const;
export type QuestKind = typeof KINDS[number];
export const KIND_RU: Record<QuestKind, string> = { battle: 'Бой', trap: 'Ловушка', treasure: 'Сокровищница', lair: 'Логово', rest: 'Привал', shop: 'Лавка', event: 'Событие', map: 'Карта', travel: 'В пути', town: 'Город', gather: 'Сбор отряда', boss: 'Босс', dungeon: 'Данж', bossgen: 'Главный враг' };
/** Class ids (game-data.js CLASS_META) + recruit. */
export type Role = 'legionary' | 'archer' | 'mage' | 'priest' | 'rogue' | 'necromancer' | 'paladin' | 'recruit';
/** `q.party`: in party / queued until the next stop / ghost (dead hero) / anything else = not in party. */
export type PartyState = 'in' | 'q' | 'ghost' | string;

/* ------------------------------------------------------------------ battle (v.b) */

/** `b.form[i]` — a hero on the stream frame: [login, role, side?, (unknown) , shield?, rank?]. quest.js squad(): p[0..2], p[4], p[5]. */
export type FormEntry = [login: string, role: string, side?: Side | '' | null, x3?: unknown, shield?: boolean | 0 | 1, rank?: number];
/** `b.foes[i]` — [side, art type, leader/boss flag, hp 0..1, display name]. quest.js squad()/castHtml()/qaBattle(). */
export type FoeEntry = [side: Side, type: string, lead: boolean | 0 | 1, hp: number, name: string];
/** `b.low[i]` — wounded allies (heal targets): [login, display name, hp 0..1]. quest.js qaBattle()/nmOf(). */
export type LowEntry = [login: string, name: string, hp: number];
/** `b.sk[i]` — my class skills: [chat word, cooldown in turns (0 = ready), kind ('heal' | other)]. */
export type SkillEntry = [word: string, cd: number, kind?: string];

/** Battle stages, quest.js battleHtml(): intro → party (we type) → hit (blows) → tele (enemy telegraph: type the word) → … → end. mech/trans: boss-only. */
export type BattleStage = 'intro' | 'party' | 'hit' | 'tele' | 'mech' | 'trans' | 'end';

/** Result of my last action, `b.mine.me` (quest.js lastLine()). */
export interface MineResult {
  /** party-turn result */
  n?: number; m?: number; d?: number; c?: boolean | number; e?: string; k?: 'melee' | 'ranged' | 'magic' | string; sk?: string;
  heal?: number; healed?: number; dead?: boolean;
  /** enemy-turn result */
  hurt?: number; by?: string;
}
export interface BattleMine { k: 'tele' | 'party' | string; r?: number; ok?: boolean; me?: MineResult }
export interface BattleTele { word: string; text?: string; ok?: boolean; got?: number; need?: number }
export interface BattleRes { how: 'win' | 'away' | 'lose' | 'retreat' | string; xp?: number; coins?: number }
export interface Crowd { fr: Side[]; cam?: number; chaos?: boolean }
/** Generated boss embedded in a battle (`b.gb`, quest.js qaBoss()). */
export interface BattleBoss { name: string; title?: string; phase?: number; phases?: number; hp?: number; forbid?: boolean; mech?: { icon?: string; name?: string; text?: string } }

export interface QuestBattle {
  id: string | number;
  title?: string;
  round: number;
  maxR?: number;
  st: BattleStage | string;
  /** server ms when the current stage window closes (shown + stream delay) */
  until?: number;
  /** MY hp 0..1; null/undefined = not in this battle; 0 = dead; < 0 = fled (quest.js meIn()) */
  hp?: number | null;
  /** my index in `form`, -1 / absent = not drawn on the stream frame */
  me?: number;
  /** me in formation but past the 420 drawn places: [role, side] */
  mf?: [role: string, side?: Side];
  form: FormEntry[];
  /** all fighters incl. reserve (form is only the drawn part) */
  fighters?: number;
  foes: FoeEntry[];
  low?: LowEntry[];
  sk?: SkillEntry[];
  /** my accepted move this round: 'melee'|'ranged'|'magic'|'heal'|'guard'|'pull'|'auto' or a skill key (SK) */
  turn?: string;
  /** target of my move: [login | 'lead' | '', side] */
  tg?: [string, Side?];
  tele?: BattleTele;
  mine?: BattleMine;
  res?: BattleRes;
  /** battle feed lines (journal); hidden by the site during 'tele' (may contain the word) */
  fd?: string[];
  /** fronts: cr.fr.length > 1 → surrounded; also cam/chaos for the formation (battlecrowd) */
  cr?: Crowd;
  /** two-front gate battle («Врата башни») */
  two?: boolean;
  gb?: BattleBoss;
}

/* ------------------------------------------------------------------ generated boss (v.bg) */

export interface BossMech {
  id?: string; name: string; icon?: string; fam?: 'silence' | 'position' | string;
  text?: string; word?: string; words?: string[]; opts?: string[]; zones?: number[]; any?: boolean;
  how?: string; tip?: string; fake?: boolean; me?: boolean; until?: number; need?: number; got?: number;
}
/** Arena platforms: a = [n, neighbours, polygon points (stream px)], gone = destroyed. */
export interface BossZones { a: [n: number, nb: number[], pts: [number, number][]][]; gone?: number[] }
export interface QuestBossGen {
  name: string; title?: string; danger?: number;
  ph: number; phs: number;
  /** boss hp 0..1 */
  hp: number;
  /** adds: [name, count, hp 0..1] */
  adds?: [string, number, number][];
  st?: 'party' | 'boss' | 'trans' | 'end' | string;
  acted?: boolean; in?: boolean; my?: number;
  limit?: number; round?: number; form?: string; rage?: boolean;
  zn?: BossZones; area?: number;
  mech?: BossMech | null;
}

/* ------------------------------------------------------------------ other stage blocks */

export interface LairIsles {
  pick?: { until: number; my?: number; cnt?: number[] };
  doom?: { until: number; opts?: number[]; cnt?: Record<string, number> };
  at?: { my?: number; cnt?: number[] };
  gone?: number[]; nb?: Record<string, number[]>; sil?: { n: number };
}
export interface QuestLair {
  is?: LairIsles; hp?: number | null; st?: string; phase?: number; round?: number; acted?: boolean;
  tele?: BattleTele; spell?: { words: string[]; until?: number }; mass?: { words: string[] }; deal?: boolean | object;
}
export type TrapType = 'react' | 'gas' | 'ropes' | 'ceiling' | 'plates' | 'bait' | 'greed' | 'code' | 'share' | string;
export interface TrapResMe { dmg?: number | 'dead'; gain?: number; xp?: number; it?: string[]; st?: string }
export interface QuestTrap {
  name: string; icon?: string; type?: TrapType; st?: 'intro' | 'act' | 'wait' | 'done' | string;
  until?: number; word?: string; gas?: boolean; how?: string; intro?: string;
  acted?: boolean; actedN?: number; total?: number;
  n?: number; len?: number; max?: number; best?: [guess: string, marks: string | string[], name: string][]; taker?: string | boolean;
  /** treasury instead of trap */
  tre?: boolean;
  res?: { me?: TrapResMe; text?: string; sv?: boolean; win?: boolean };
}
export interface QuestEvent {
  look: 'traveler' | 'dice' | 'well' | 'priest' | string; name: string; icon?: string;
  st?: 'vote' | 'on' | 'done' | string; until?: number; my?: 'help' | 'rob' | string; used?: number; said?: { text: string };
  cmds?: [word: string, desc?: string][]; last?: { name: string; me?: number; him?: number; d?: number };
  res?: { text: string }; votes?: { help: number; rob: number };
  purse?: number; gm?: [me: number, him: number, r: 'win' | 'tie' | 'lose' | string, n: number][];
  thrown?: number; need?: number; filled?: boolean;
  pool?: number; prices?: { heal?: number; cleanse?: number; bless?: number; revive?: number };
  done?: { heal?: boolean; cleanse?: boolean; bless?: boolean }; cursed?: boolean; ghosts?: [login: string, name: string][];
}
/** «Куда идём?»: opts = [n, label, (unknown, '' seen in tests), votes, back?]. quest.js voteHtml()/skRoute(). */
export type VoteOpt = [n: number, label: string, x2: unknown, votes: number, back?: boolean | 0 | 1];
export interface QuestVote { id: number; title: string; end: number; done?: boolean; my?: number; win?: number; opts: VoteOpt[] }
/** Dungeon passage vote: opts = [n, exit key, label, icon, votes, back?]. quest.js dgHtml()/dgMarks(). */
export type DgnOpt = [n: number, key: string, label: string, icon: string, votes: number, back?: boolean | 0 | 1];
export interface QuestDungeon {
  name?: string; at?: number; room?: { floor?: number; seed?: string | number; [k: string]: unknown }; fl?: number; rn?: string; esc?: boolean;
  vote?: { id: number; title: string; end: number; done?: boolean; win?: number; my?: number; mode?: 'ring' | string; opts: DgnOpt[] };
}
export interface QuestLoot { name: string; until: number; n?: number; my?: boolean | number | string }
export interface ShopItem { id: string; name: string; rarity?: string; price: number; qty: number; curio?: boolean; slot?: string; stats?: Record<string, number>; [k: string]: unknown }
export interface QuestShop { name?: string; icon?: string; items: ShopItem[] }
/** Place buttons (the streamer's siteBtns): t = chat line sent as is, g = group ('', 'tg', 'act', 'esc'). */
export interface PlaceButton { t: string; l: string; c?: 'main' | 'warn' | ''; g?: '' | 'tg' | 'act' | 'esc'; x?: { k?: 'flee' | 'pay' | string; pct?: number; role?: string } }

/* ------------------------------------------------------------------ the payload */

export interface QuestPayload {
  on: boolean;
  /** stream delay, seconds (per channel) */
  dl?: number;
  /** server clock (ms) at send — the site syncs its clock with it */
  now?: number;
  /** snapshot time (ms); delay is counted from it (fallback: receive time) */
  at?: number;
  /** my late commands: [server ms, what, seconds late] */
  late?: [number, string, number][];
  k?: QuestKind | string;
  /** place title */
  t?: string;
  /** terrain name («Река», «Пещера», «Шахта», «Данж», «Курган»…) — picks the stream backdrop */
  ter?: string;
  /** party size */
  n?: number;
  /** entry roll: who rolled and the number (1 → surrounded on 3 sides, 2–9 → 2 sides, ≥10 → front only) */
  roll?: { by: string; n: number };
  party?: PartyState;
  /** false → the party is moving: joining = queue until the next stop */
  cm?: boolean;
  /** hw: the Halloween gather at the portal (site 28.10, «🎃 Сбор у портала», join word «портал») */
  gather?: { until: number; hw?: unknown };
  /** danger note (★3+: losses on death) */
  dg?: string;
  /** my worn items at ≤ 30% durability: [name, percent] */
  lw?: [string, number][];
  /** district town at the stop (★1–2) */
  town?: { id: string; name: string };
  b?: QuestBattle;
  bg?: QuestBossGen;
  lair?: QuestLair;
  tr?: QuestTrap;
  ev?: QuestEvent;
  vote?: QuestVote;
  dgn?: QuestDungeon;
  loot?: QuestLoot;
  sh?: QuestShop;
  pb?: { b: PlaceButton[] };
  [k: string]: unknown;
}

/* ------------------------------------------------------------------ guards */

const isObj = (x: unknown): x is Record<string, any> => !!x && typeof x === 'object' && !Array.isArray(x);
const isNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const isStr = (x: unknown): x is string => typeof x === 'string';
const optNum = (x: unknown) => x == null || isNum(x);
const SIDES = new Set(['L', 'R', 'F']);

export function isFoe(x: unknown): x is FoeEntry {
  return Array.isArray(x) && x.length >= 4 && SIDES.has(x[0]) && isStr(x[1]) && isNum(x[3]) && x[3] >= 0 && x[3] <= 1;
}
export function isForm(x: unknown): x is FormEntry {
  return Array.isArray(x) && x.length >= 2 && isStr(x[0]) && isStr(x[1]) && (x[2] == null || x[2] === '' || SIDES.has(x[2]));
}
export function isBattle(x: unknown): x is QuestBattle {
  if (!isObj(x)) return false;
  if (!(isStr(x.id) || isNum(x.id)) || !isNum(x.round) || !isStr(x.st)) return false;
  if (!Array.isArray(x.form) || !x.form.every(isForm)) return false;
  if (!Array.isArray(x.foes) || !x.foes.every(isFoe)) return false;
  if (!optNum(x.until) || !optNum(x.maxR)) return false;
  if (x.hp != null && !isNum(x.hp)) return false;
  if (x.me != null && (!isNum(x.me) || x.me >= x.form.length)) return false;
  if (x.sk != null && !(Array.isArray(x.sk) && x.sk.every((s: unknown) => Array.isArray(s) && isStr(s[0]) && isNum(s[1])))) return false;
  if (x.tele != null && !(isObj(x.tele) && isStr(x.tele.word))) return false;
  if (x.cr != null && !(isObj(x.cr) && Array.isArray(x.cr.fr) && x.cr.fr.every((s: unknown) => SIDES.has(s as string)))) return false;
  return true;
}
export function isBossGen(x: unknown): x is QuestBossGen {
  return isObj(x) && isStr(x.name) && isNum(x.ph) && isNum(x.phs) && isNum(x.hp) && (x.mech == null || (isObj(x.mech) && isStr(x.mech.name)));
}
export function isVote(x: unknown): x is QuestVote {
  return isObj(x) && isNum(x.id) && isStr(x.title) && isNum(x.end) && Array.isArray(x.opts)
    && x.opts.every((o: unknown) => Array.isArray(o) && isNum(o[0]) && isStr(o[1]) && isNum(o[3]));
}
/** Top-level guard: `on` boolean, known blocks well-formed. Unknown extra fields are allowed (the server adds them freely). */
export function isQuestPayload(x: unknown): x is QuestPayload {
  if (!isObj(x) || typeof x.on !== 'boolean') return false;
  if (!x.on) return true;
  if (!optNum(x.dl) || !optNum(x.at) || !optNum(x.now) || !optNum(x.n)) return false;
  if (x.k != null && !isStr(x.k)) return false;
  if (x.gather != null && !(isObj(x.gather) && isNum(x.gather.until))) return false;
  if (x.late != null && !(Array.isArray(x.late) && x.late.every((l: unknown) => Array.isArray(l) && isNum(l[0])))) return false;
  if (x.b != null && !isBattle(x.b)) return false;
  if (x.bg != null && !isBossGen(x.bg)) return false;
  if (x.vote != null && !isVote(x.vote)) return false;
  if (x.tr != null && !(isObj(x.tr) && isStr(x.tr.name))) return false;
  if (x.ev != null && !(isObj(x.ev) && isStr(x.ev.look) && isStr(x.ev.name))) return false;
  if (x.loot != null && !(isObj(x.loot) && isStr(x.loot.name) && isNum(x.loot.until))) return false;
  if (x.sh != null && !(isObj(x.sh) && Array.isArray(x.sh.items))) return false;
  if (x.roll != null && !(isObj(x.roll) && isNum(x.roll.n))) return false;
  return true;
}

/* ------------------------------------------------------------------ stage (what scene to show) */

/**
 * What the 3D scene should show — the same precedence as the site tab (quest.js layAct()):
 * battle (incl. generated boss inside a battle) → boss → dungeon → isles → lair → trap → event → vote → loot → shop → place kind.
 * NOTE: the site's top banner (bannerHtml) uses a slightly different order (lair.is before bg; dgn only with an open vote).
 */
export type Stage =
  | { s: 'off' }
  | { s: 'battle'; boss: boolean }
  | { s: 'boss' }
  | { s: 'dungeon' }
  | { s: 'isles' }
  | { s: 'lair' }
  | { s: 'trap'; treasure: boolean }
  | { s: 'event'; look: string }
  | { s: 'vote' }
  | { s: 'loot' }
  | { s: 'shop' }
  | { s: 'place'; kind: QuestKind | 'unknown' };

export function stageOf(v: QuestPayload | null | undefined): Stage {
  if (!v || !v.on) return { s: 'off' };
  if (v.b) return { s: 'battle', boss: !!(v.b.gb || v.bg) };
  if (v.bg) return { s: 'boss' };
  if (v.dgn) return { s: 'dungeon' };
  if (v.lair?.is) return { s: 'isles' };
  if (v.lair) return { s: 'lair' };
  if (v.tr) return { s: 'trap', treasure: !!v.tr.tre || v.k === 'treasure' };
  if (v.ev) return { s: 'event', look: v.ev.look };
  if (v.vote && !v.vote.done) return { s: 'vote' };
  if (v.loot) return { s: 'loot' };
  if (v.sh?.items?.length) return { s: 'shop' };
  return { s: 'place', kind: kindOf(v) };
}
/** Normalised place kind: `k` when known; else inferred from present blocks. */
export function kindOf(v: QuestPayload): QuestKind | 'unknown' {
  const k = v.k as QuestKind;
  if (k && (KINDS as readonly string[]).includes(k)) return k;
  if (v.gather) return 'gather';
  if (v.b?.gb || v.bg) return 'bossgen';
  if (v.b) return 'battle';
  if (v.lair) return 'lair';
  if (v.dgn) return 'dungeon';
  if (v.tr) return v.tr.tre ? 'treasure' : 'trap';
  if (v.ev) return 'event';
  if (v.sh) return 'shop';
  if (v.vote) return 'map';
  return 'unknown';
}

/* ------------------------------------------------------------------ delay & time */

export const ADJ_KEY = 'lgQDelay';
export const clampAdj = (a: number) => Math.max(-10, Math.min(30, Math.round(+a || 0)));
/** Delay in seconds the viewer sees the stream behind: max(0, dl + adj). quest.js delayS(). */
export const delayS = (v: { dl?: number } | null | undefined, adj = 0) => Math.max(0, ((v && v.dl) || 0) + adj);
/** Whole seconds left of a server-time window as the viewer sees it on the stream. quest.js sec(). */
export const secondsLeft = (until: number | undefined, dlS: number, now: number) => Math.max(0, Math.ceil(((+(until || 0)) + dlS * 1000 - now) / 1000));
/** 0..1 progress of a window [from, until] in stream time. */
export const windowProgress = (from: number, until: number, dlS: number, now: number) => (until <= from ? 1 : Math.max(0, Math.min(1, (now - dlS * 1000 - from) / (until - from))));

/**
 * Own state is shown at once (it is already visible in chat), everything else with the stream delay.
 * Pure port of quest.js view(): merge "my" fields of the newest view into the delayed one.
 */
export function mergeOwn(cur: QuestPayload, newest: QuestPayload): QuestPayload {
  if (!cur.on || !newest.on) return cur;
  const v: QuestPayload = { ...cur };
  const c = cur, n = newest;
  if (c.b && n.b && c.b.id === n.b.id) {
    v.b = { ...c.b };
    if (n.b.round === c.b.round) { v.b.turn = n.b.turn; v.b.tg = n.b.tg; }
    if (c.b.tele && n.b.tele && c.b.tele.word === n.b.tele.word) v.b.tele = { ...c.b.tele, ok: n.b.tele.ok };
  }
  if (c.tr && n.tr && c.tr.name === n.tr.name && !c.tr.res) v.tr = { ...c.tr, acted: n.tr.acted };
  if (c.bg && n.bg && c.bg.round === n.bg.round) v.bg = { ...c.bg, acted: n.bg.acted };
  if (c.lair?.is && n.lair?.is) {
    const is = { ...c.lair.is };
    if (c.lair.is.pick && n.lair.is.pick) is.pick = { ...c.lair.is.pick, my: n.lair.is.pick.my };
    if (c.lair.is.at && n.lair.is.at) is.at = { ...c.lair.is.at, my: n.lair.is.at.my };
    v.lair = { ...c.lair, is };
  }
  if (c.vote && n.vote && c.vote.id === n.vote.id) v.vote = { ...c.vote, my: n.vote.my };
  if (c.dgn?.vote && n.dgn?.vote && c.dgn.vote.id === n.dgn.vote.id) v.dgn = { ...c.dgn, vote: { ...c.dgn.vote, my: n.dgn.vote.my } };
  if (c.loot && n.loot && c.loot.name === n.loot.name) v.loot = { ...c.loot, my: n.loot.my };
  if (c.ev && n.ev && c.ev.look === n.ev.look) v.ev = { ...c.ev, my: n.ev.my, used: n.ev.used, said: n.ev.said };
  return v;
}

/**
 * Stream-delay buffer (quest.js data()/tick()): keep the last 80 views, show the newest whose (at || rx) + delay ≤ now;
 * a page opened mid-expedition shows the first one at once. `{on:false}` clears it immediately.
 */
export class DelayBuffer {
  private raw: { v: QuestPayload; rx: number }[] = [];
  private cur: QuestPayload | null = null;
  private newest: QuestPayload | null = null;
  push(v: QuestPayload, rx: number): void {
    this.newest = v;
    if (!v.on) { this.raw.length = 0; this.cur = v; return; }
    this.raw.push({ v, rx });
    if (this.raw.length > 80) this.raw.splice(0, this.raw.length - 80);
  }
  /** Current view as seen on the stream (own fields merged from the newest). */
  pick(now: number, adj = 0): QuestPayload | null {
    let pick = -1;
    for (let i = 0; i < this.raw.length; i++) { const r = this.raw[i]; if ((r.v.at || r.rx) + delayS(r.v, adj) * 1000 <= now) pick = i; }
    if (pick >= 0) { this.cur = this.raw[pick].v; if (pick > 0) this.raw.splice(0, pick); }
    else if (!this.cur || !this.cur.on) this.cur = this.raw[0]?.v || this.newest;
    return this.cur && this.newest ? mergeOwn(this.cur, this.newest) : this.cur;
  }
  get size(): number { return this.raw.length; }
}

/* ------------------------------------------------------------------ commands */

/** Class base command (game-data.js KIND_WORD by CLASS_META.kind). */
export const BASE_CMD: Record<Role, string> = { legionary: 'удар', archer: 'выстрел', mage: 'магия', priest: 'лечить', rogue: 'удар', necromancer: 'магия', paladin: 'удар', recruit: 'удар' };
export const SIDE_CMD: Record<Side, string> = { L: 'лево', R: 'право', F: 'вдали' };
export const SIDE_RU: Record<Side, string> = { L: 'левое крыло', R: 'правое крыло', F: 'дальнее крыло' };
/** Skill keys → icon and chat word (battlecrowd.js SK). */
export const SKILLS: Record<string, { icon: string; name: string }> = {
  grad: { icon: '🏹', name: 'Град' }, pricel: { icon: '🎯', name: 'Прицел' }, vspyshka: { icon: '✨', name: 'Вспышка' }, oznob: { icon: '❄️', name: 'Озноб' },
  natisk: { icon: '⚔️', name: 'Натиск' }, stoyka: { icon: '🛡', name: 'Стойка' }, svet: { icon: '☀️', name: 'Свет' }, aura: { icon: '💛', name: 'Аура' },
  dlan: { icon: '🤲', name: 'Длань' }, dlan_light: { icon: '☀️', name: 'Свет длани' }, siyanie: { icon: '🌟', name: 'Сияние' }, obereg: { icon: '🔰', name: 'Оберег' },
  yad: { icon: '🧪', name: 'Яд' }, vspinu: { icon: '🗡', name: 'Вспину' }, proklyat: { icon: '💀', name: 'Проклясть' }, vytyanut: { icon: '🩸', name: 'Вытянуть' },
  podnyat: { icon: '🦴', name: 'Поднять' }, obchistit: { icon: '💰', name: 'Обчистить' }, skel: { icon: '☠️', name: 'Скелеты' },
};
export const isMulti = (b: QuestBattle) => !!(b.cr && b.cr.fr && b.cr.fr.length > 1) || !!b.two;
/** What I type in a party turn: «удар» / «выстрел право» … (quest.js cmdFor()). Healers never add a side. */
export function cmdFor(role: string, side: Side | '' | undefined, multi: boolean): string {
  const base = BASE_CMD[role as Role] || 'удар';
  return multi && side && base !== 'лечить' ? `${base} ${SIDE_CMD[side]}` : base;
}

/* ------------------------------------------------------------------ battle snapshot */

export type MeState = 'on' | 'reserve' | 'out' | 'dead' | 'fled';
export interface HeroSlot { login: string; role: string; side: Side; shield: boolean; rank: number; zone: Zone; me: boolean }
export interface FoeSlot { i: number; side: Side; type: string; lead: boolean; hp: number; dead: boolean; name: string }
export interface BattleSnapshot {
  id: string; round: number; maxR: number; stage: BattleStage | 'unknown'; until: number;
  fronts: Side[]; multi: boolean; chaos: boolean;
  me: { st: MeState; side: Side | ''; role: string; index: number; hp: number | null };
  heroes: HeroSlot[]; foes: FoeSlot[]; reserve: number; foesAlive: number; foeHp: number;
  tele: BattleTele | null; skills: { word: string; cd: number; heal: boolean }[]; turn: string; res: BattleRes | null;
  boss: BattleBoss | null; cmd: string;
}
const STAGES = new Set(['intro', 'party', 'hit', 'tele', 'mech', 'trans', 'end']);

/** Formation zones (battlecrowd.js ZONE): 0 shields → 1 melee → 2 ranged/casters → 3 priests (front to back). */
export type Zone = 0 | 1 | 2 | 3;
export const ZONE: Record<string, Zone> = { legionary: 0, paladin: 0, rogue: 1, recruit: 1, archer: 2, mage: 2, necromancer: 2, priest: 3 };
export const zoneOf = (role: string): Zone => ZONE[role] ?? 2;
/** Fronts by entry roll (crowdcam.js frontsFor): 1 → L,R,F; 2–9 → L,R; else R. */
export const frontsFor = (roll: number): Side[] => (+roll === 1 ? ['L', 'R', 'F'] : +roll >= 2 && +roll <= 9 ? ['L', 'R'] : ['R']);
/** Camera pull-back by fighter count (crowdcam.js camFor; cap 200, cave/mine/dungeon halve it). */
export function camFor(fighters: number, max = 200, terrain = ''): number {
  const tight = terrain === 'Пещера' || terrain === 'Шахта' || terrain === 'Данж';
  const cap = Math.max(50, Math.round((+max || 200) * (tight ? 0.5 : 1)));
  const n = Math.max(1, Math.min(+fighters || 0, cap));
  return n <= 50 ? 1 : Math.max(0.45, +Math.pow(50 / n, 0.37).toFixed(3));
}

/** Who am I in this battle (quest.js meIn()). */
export function meIn(b: QuestBattle, fallbackRole = 'recruit'): BattleSnapshot['me'] {
  const i = b.me ?? -1, p = i >= 0 ? b.form[i] : null, f = !p && Array.isArray(b.mf) ? b.mf : null;
  const st: MeState = b.hp == null ? 'out' : b.hp === 0 ? 'dead' : b.hp < 0 ? 'fled' : i >= 0 || f ? 'on' : 'reserve';
  const side = (p ? (p[2] || 'R') : f ? (f[1] || 'R') : '') as Side | '';
  return { st, side, role: p ? p[1] : f ? f[0] : fallbackRole, index: i, hp: b.hp ?? null };
}

/** Normalise a raw battle into a scene-friendly snapshot (sides resolved, foes typed, defaults filled). */
export function normBattle(b: QuestBattle, myRole = 'recruit'): BattleSnapshot {
  const fronts: Side[] = b.cr?.fr?.length ? b.cr.fr.slice() : b.two ? ['L', 'R'] : ['R'];
  const multi = fronts.length > 1;
  const me = meIn(b, myRole);
  const heroes: HeroSlot[] = b.form.map((p, i) => ({
    login: p[0], role: p[1], side: (fronts.includes(p[2] as Side) ? p[2] : fronts[i % fronts.length]) as Side,
    shield: !!p[4], rank: +(p[5] ?? 2) || 0, zone: zoneOf(p[1]), me: i === me.index,
  }));
  let alive = 0, sum = 0;
  const foes: FoeSlot[] = b.foes.map((f, i) => {
    const hp = Math.max(0, Math.min(1, +f[3] || 0)); if (hp > 0) alive++; sum += hp;
    return { i, side: (SIDES.has(f[0]) ? f[0] : 'R') as Side, type: String(f[1] || 'unknown'), lead: !!f[2], hp, dead: hp <= 0, name: String(f[4] ?? '') };
  });
  return {
    id: String(b.id), round: b.round, maxR: b.maxR || 0, stage: STAGES.has(b.st) ? (b.st as BattleStage) : 'unknown', until: b.until || 0,
    fronts, multi, chaos: !!b.cr?.chaos, me, heroes, foes,
    reserve: Math.max(0, (b.fighters || b.form.length) - b.form.length), foesAlive: alive, foeHp: foes.length ? sum / foes.length : 0,
    tele: b.tele || null, skills: (b.sk || []).map((s) => ({ word: s[0], cd: +s[1] || 0, heal: s[2] === 'heal' })), turn: b.turn || '', res: b.res || null,
    boss: b.gb || null, cmd: cmdFor(me.role, me.side, multi),
  };
}

/* ------------------------------------------------------------------ formation for a 3D arena */

export interface ArenaSlot { x: number; z: number; zone: Zone; wing: Side; face: number }
/**
 * Formation in arena metres, after battlecrowd.js rules (re-implemented, simplified): single front — enemies at +x, the party
 * in columns going −x by zone (shields first, priests last); surrounded — the party in the centre, each wing faces its side,
 * shields on the outer ring, priests inside. Deterministic, no allocations beyond the result. `face` = yaw (rad) toward the enemy.
 */
export function arenaFormation(heroes: readonly HeroSlot[], fronts: readonly Side[], spacing = 1.1): ArenaSlot[] {
  const out: ArenaSlot[] = new Array(heroes.length);
  if (fronts.length <= 1) {
    const rows = Math.max(3, Math.min(12, Math.ceil(Math.sqrt(heroes.length * 0.8))));
    const order = heroes.map((h, i) => i).sort((a, b) => heroes[a].zone - heroes[b].zone || +heroes[b].shield - +heroes[a].shield || heroes[b].rank - heroes[a].rank || (heroes[a].login < heroes[b].login ? -1 : 1));
    let col = 0, prevZone = -1, inZone = 0;
    for (const i of order) {
      const h = heroes[i];
      if (h.zone !== prevZone) { if (prevZone >= 0) col += Math.ceil(inZone / rows) + 0.7; prevZone = h.zone; inZone = 0; }
      const c = col + Math.floor(inZone / rows), r = inZone % rows;
      const zr = (r % 2 ? 1 : -1) * Math.ceil(r / 2);   // fill depth from the middle out
      out[i] = { x: -c * spacing, z: zr * spacing * 0.9, zone: h.zone, wing: 'R', face: 0 };
      inZone++;
    }
    return out;
  }
  const dir: Record<Side, [number, number]> = { R: [1, 0], L: [-1, 0], F: [0, -1] };
  const byWing = new Map<Side, number[]>();
  heroes.forEach((h, i) => { const w = fronts.includes(h.side) ? h.side : fronts[i % fronts.length]; (byWing.get(w) || byWing.set(w, []).get(w)!).push(i); });
  for (const [w, idx] of byWing) {
    idx.sort((a, b) => heroes[a].zone - heroes[b].zone || heroes[b].rank - heroes[a].rank);
    const [dx, dz] = dir[w], per = Math.max(3, Math.ceil(Math.sqrt(idx.length * 1.5)));
    idx.forEach((i, k) => {
      const ring = Math.floor(k / per), lane = (k % per) - (per - 1) / 2, out0 = (3 - Math.min(3, ring)) * spacing + spacing;   // outer ring first
      out[i] = { x: dx * out0 + (dz ? lane * spacing : 0), z: dz * out0 + (dx ? lane * spacing : 0), zone: heroes[i].zone, wing: w, face: Math.atan2(-dz, dx) };
    });
  }
  return out;
}

/** Foe positions per side in arena metres, mirroring battlecrowd foeLayout/foeRing (right front, mirrored left, far = −z). */
export function arenaFoes(foes: readonly FoeSlot[], spacing = 1.6): { x: number; z: number; face: number }[] {
  const n: Record<Side, number> = { L: 0, R: 0, F: 0 };
  return foes.map((f) => {
    const k = n[f.side]++, col = Math.floor(k / 3), lane = (k % 3) - 1;
    const d = 5 + col * spacing + (f.lead ? 0 : 0.6);
    if (f.side === 'L') return { x: -d, z: lane * spacing, face: 0 };
    if (f.side === 'F') return { x: lane * spacing + col * 0.5, z: -d, face: Math.PI / 2 };
    return { x: d, z: lane * spacing, face: Math.PI };
  });
}
