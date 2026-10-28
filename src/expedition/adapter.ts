/**
 * Expedition 3D adapter: the delayed `q` view (src/quest/model.ts QuestPayload, as shown on the stream) → a flat,
 * defensive SceneState the 3D scene draws. PURE: no DOM, no three.js, never throws on odd payloads.
 *
 * This is the ONE file to correct after a live capture (docs/QUEST.md «Risks / unknowns»): every field the site view
 * may or may not carry is read here, with a default. Fields marked [guess] in docs/QUEST.md are read defensively:
 *   - `form[i][3]`, `vote.opts[i][2]` are ignored; `foes[i][3]` is clamped to 0..1;
 *   - the party outside battles is the last battle `form` we saw (Roster) padded with generic cats up to `n`;
 *   - `zn` polygons are normalised by their own bounding box (any coordinate space works);
 *   - after the boss: `b.res` (end) and then `loot` = the results scene.
 */
import { bossName, emptyParty, EMPTY_PARTY, stageOf, kindOf, cmdFor, isMulti, SIDE_CMD, SKILLS, camFor, zoneOf, BASE_CMD, puzzleMy, puzzleAnsText, puzzleTask, puzzleTyped, eventInstructions, PUZZLE_ST,
  type QuestPuzzle, type QuestPayload, type QuestBattle, type Side, type Zone, type Role } from '../quest/model';

/* ------------------------------------------------------------------ scene kinds */

export type SceneKind = 'off' | 'gather' | 'vote' | 'travel' | 'battle' | 'boss' | 'trap' | 'treasure' | 'rest' | 'shop' | 'event'
  | 'town' | 'dungeon' | 'lair' | 'loot' | 'puzzle';
export type BiomeId = 'meadow' | 'forest' | 'river' | 'falls' | 'bridge' | 'mound' | 'gorge' | 'mine' | 'cave' | 'dungeon' | 'gate' | 'swamp' | 'snow' | 'desert';

/** Terrain name (`v.ter`, Russian) → biome. Known names from docs/QUEST.md §9; unknown names by word stems, else meadow. */
export function biomeOf(ter: unknown): BiomeId {
  const t = String(ter ?? '').trim().toLowerCase();
  if (!t) return 'meadow';
  const exact: Record<string, BiomeId> = { 'река': 'river', 'брод': 'river', 'водопад': 'falls', 'старый мост': 'bridge', 'курган': 'mound', 'ущелье': 'gorge',
    'шахта': 'mine', 'пещера': 'cave', 'данж': 'dungeon', 'врата башни': 'gate' };
  if (exact[t]) return exact[t];
  if (/мост/.test(t)) return 'bridge';
  if (/водопад/.test(t)) return 'falls';
  if (/рек|брод|озер|берег|ручей/.test(t)) return 'river';
  if (/курган|могил|холм|каменн|менгир|дольмен/.test(t)) return 'mound';   // live 28.10: «Каменный круг», «Холмы»
  if (/ущел|скал|гор|перевал|овраг|расщел/.test(t)) return 'gorge';   // live 28.10: «Овраг»
  if (/шахт|рудн/.test(t)) return 'mine';
  if (/пещер|грот/.test(t)) return 'cave';
  if (/данж|подзем|склеп|катакомб/.test(t)) return 'dungeon';
  if (/врат|башн|крепост|замок/.test(t)) return 'gate';
  if (/болот|топь|трясин/.test(t)) return 'swamp';
  if (/снег|лёд|лед|тайг|мороз/.test(t)) return 'snow';
  if (/пустын|песк|дюн/.test(t)) return 'desert';
  if (/лес|роща|чащ/.test(t)) return 'forest';
  return 'meadow';
}
/** Tight places (crowdcam: cave/mine/dungeon halve the crowd). */
export const isTight = (b: BiomeId) => b === 'cave' || b === 'mine' || b === 'dungeon';

/* ------------------------------------------------------------------ foes */

export type FoeArt = 'wolf' | 'skeleton' | 'bandit' | 'boar' | 'drowner' | 'spider' | 'bat' | 'ghost' | 'slime' | 'pumpkin' | 'golem'
  | 'pumpkinlet' | 'cat' | 'zombie' | 'scarecrow' | 'witch' | 'crow' | 'jack' | 'toad' | 'bones'
  // pack leaders (site questfoes.js o.boss drawings)
  | 'wolfLead' | 'skeletonLead' | 'banditLead' | 'toadLead' | 'ghostLead' | 'batLead' | 'spiderLead' | 'zombieLead' | 'bonesLead'
  | 'witchLead' | 'catLead' | 'scarecrowLead'
  // dungeon packs (questfoes.js dg_* / dgb_*)
  | 'rat' | 'beast' | 'lavaslime' | 'splasher' | 'crab' | 'mushroom' | 'shroom' | 'mummy' | 'imp' | 'icelet' | 'potion' | 'book' | 'blade'
  | 'sandworm' | 'tentacle' | 'automaton' | 'stonegolem' | 'shade' | 'voidling' | 'minerghost' | 'knight' | 'monk' | 'tinnik' | 'frostdead'
  | 'sailor' | 'prisoner' | 'widow' | 'skullguard' | 'squire' | 'smuggler';
export const FOE_ARTS: readonly FoeArt[] = ['wolf', 'skeleton', 'bandit', 'boar', 'drowner', 'spider', 'bat', 'ghost', 'slime', 'pumpkin', 'golem',
  'pumpkinlet', 'cat', 'zombie', 'scarecrow', 'witch', 'crow', 'jack', 'toad', 'bones',
  'wolfLead', 'skeletonLead', 'banditLead', 'toadLead', 'ghostLead', 'batLead', 'spiderLead', 'zombieLead', 'bonesLead', 'witchLead', 'catLead', 'scarecrowLead',
  'rat', 'beast', 'lavaslime', 'splasher', 'crab', 'mushroom', 'shroom', 'mummy', 'imp', 'icelet', 'potion', 'book', 'blade',
  'sandworm', 'tentacle', 'automaton', 'stonegolem', 'shade', 'voidling', 'minerghost', 'knight', 'monk', 'tinnik', 'frostdead', 'sailor', 'prisoner', 'widow', 'skullguard', 'squire', 'smuggler'];
/**
 * Halloween foes (site questfoes.js 'enemies-hollow', 27–28.10): hw_* key → our model. The leader of hw_pumpkin is the
 * Pumpkin Golem («Тыквенный голем», battle.js topBoss: much taller than the rank-and-file) → 'golem' (foeArtOf).
 */
export const HW_FOES: Record<string, FoeArt> = {
  hw_pumpkin: 'pumpkin', hw_pumpkinlet: 'pumpkinlet', hw_jack: 'jack', hw_ghost: 'ghost', hw_bat: 'bat', hw_crow: 'crow', hw_witch: 'witch',
  hw_zombie: 'zombie', hw_skeleton: 'bones', hw_spider: 'spider', hw_cat: 'cat', hw_scarecrow: 'scarecrow',
};
/** Dungeon packs (questfoes.js dg_* rank-and-file, dgb_* dungeon bosses) → our model. */
export const DG_FOES: Record<string, FoeArt> = {
  dg_rat: 'rat', dg_lavaslime: 'lavaslime', dg_splasher: 'splasher', dg_crab: 'crab', dg_mushroom: 'mushroom', dg_mummy: 'mummy', dg_imp: 'imp',
  dg_icelet: 'icelet', dg_potion: 'potion', dg_book: 'book', dg_armory: 'blade', dg_sandworm: 'sandworm', dg_rootworm: 'sandworm',
  dg_automaton: 'automaton', dg_astro: 'automaton', dg_clockwork: 'automaton', dg_voidling: 'voidling', dg_minerghost: 'minerghost',
  dg_monk: 'monk', dg_tinnik: 'tinnik', dg_frostdead: 'frostdead', dg_sailor: 'sailor', dg_prisoner: 'prisoner', dg_smuggler: 'smuggler',
  dg_skullguard: 'skullguard', dg_squire: 'squire',
  dgb_light: 'shade', dgb_golem: 'stonegolem', dgb_maze: 'beast', dgb_spider: 'widow', dgb_clock: 'automaton', dgb_shroom: 'shroom',
  dgb_knight: 'knight', dgb_living: 'tentacle',
};
/** Pack leaders with their own drawing (questfoes.js o.boss): base model → leader model. */
export const LEAD_ARTS: Partial<Record<FoeArt, FoeArt>> = {
  wolf: 'wolfLead', skeleton: 'skeletonLead', bandit: 'banditLead', toad: 'toadLead', ghost: 'ghostLead', bat: 'batLead', spider: 'spiderLead',
  zombie: 'zombieLead', bones: 'bonesLead', witch: 'witchLead', cat: 'catLead', scarecrow: 'scarecrowLead', pumpkin: 'golem',
};
/** foeArt + the leader variants (hw_pumpkin leader = the pumpkin golem; others: LEAD_ARTS, dungeon packs keep their art). */
export function foeArtOf(type: unknown, name: unknown, lead: boolean): FoeArt {
  const t = String(type ?? '').toLowerCase();
  if (/голем/i.test(String(name ?? '')) && /тыкв|pump/i.test(t + ' ' + String(name ?? ''))) return 'golem';
  const a = foeArt(type, name);
  if (lead && !t.startsWith('dg')) return LEAD_ARTS[a] ?? a;
  return a;
}
/** Leader models carry their own regalia: no extra crown over them. */
export const hasLeadArt = (a: FoeArt): boolean => a.endsWith('Lead') || a === 'golem';
/**
 * Foe art key (battle.js: wolf skeleton bandit boar drowner spider bat; hw_* Halloween, dg_* dungeon packs) → our model.
 * Unknown keys go by stems (also of the display name), then a slime blob.
 */
export function foeArt(type: unknown, name: unknown = ''): FoeArt {
  const t = String(type ?? '').toLowerCase();
  if (HW_FOES[t]) return HW_FOES[t];
  if (DG_FOES[t]) return DG_FOES[t];
  const base = t.replace(/^(hw|dg|dgb)_/, '');
  if ((FOE_ARTS as readonly string[]).includes(base) && !base.endsWith('lead')) return base as FoeArt;
  const s = base + ' ' + String(name ?? '').toLowerCase();
  if (/wolf|dog|hound|волк|пёс|пес|гончая/.test(s)) return 'wolf';
  if (/(^|[ _])rats?\b|крыс/.test(s)) return 'rat';
  if (/skel|bone|lich|скелет|кост/.test(s)) return 'skeleton';
  if (/zomb|мертв|зомби|умерт/.test(s)) return 'zombie';
  if (/mumm|мумия|мумии/.test(s)) return 'mummy';
  if (/band|thief|rogue|cult|smuggl|разбой|бандит|вор|атаман|культ|контрабанд/.test(s)) return 'bandit';
  if (/boar|pig|кабан|вепрь|свин/.test(s)) return 'boar';
  if (/toad|frog|жаб|лягуш/.test(s)) return 'toad';
  if (/drown|fish|leech|утоп|рыб|пиявк|водян/.test(s)) return 'drowner';
  if (/spid|паук|паучих/.test(s)) return 'spider';
  if (/bat|летуч|мыш|вампир/.test(s)) return 'bat';
  if (/ghost|spirit|wraith|shade|призрак|дух|тень|фантом/.test(s)) return 'ghost';
  if (/pump|тыкв|jack/.test(s)) return 'pumpkin';
  if (/lava|magma|лав|магм/.test(s)) return 'lavaslime';
  if (/mush|shroom|гриб/.test(s)) return 'mushroom';
  if (/crab|краб/.test(s)) return 'crab';
  if (/worm|червь|червяк/.test(s)) return 'sandworm';
  if (/golem|голем/.test(s)) return 'stonegolem';
  if (t.startsWith('hw_')) return 'ghost';
  return 'slime';
}

/* ------------------------------------------------------------------ state */

export interface Member {
  login: string; name: string; role: string; zone: Zone; side: Side; shield: boolean; rank: number; me: boolean;
  /** hp 0..1 when listed as wounded (`b.low`), else −1 */
  low: number;
  /** generic placeholder (we only know the party size) */
  ghost: boolean;
}
export interface FoeState { i: number; art: FoeArt; type: string; side: Side; lead: boolean; hp: number; dead: boolean; name: string }
export interface Cmd {
  /** say: type the text; word: canvas-only word (telegraph); num: numbered choice; silent: do NOT type; ok: done; info */
  kind: 'say' | 'word' | 'num' | 'silent' | 'ok' | 'info';
  text: string;
  /** small caption («твоя команда», «навык, готов», «перезарядка 2») */
  note?: string;
  /** dimmed (skill on cooldown / not my side) */
  dim?: boolean;
}
export interface BattleState {
  id: string; round: number; maxR: number; stage: string; fronts: Side[]; multi: boolean; chaos: boolean; two: boolean;
  ambush?: boolean; more?: number; press?: number; drop?: number;
  foes: FoeState[]; foesAlive: number;
  tele: { word: string; kind: string; text: string; got: number; need: number; ok: boolean } | null;
  res: { how: string; xp: number; coins: number } | null;
  feed: string[];
  /** last result of my own action (b.mine): who hit — 'party' | 'tele' | '' */
  mineK: string; mineText: string;
  /** crowd camera factor (crowdcam camFor): 1 … 0.45 */
  cam: number;
  fighters: number;
  me: { st: 'on' | 'reserve' | 'out' | 'dead' | 'fled'; hp: number | null; side: Side | ''; role: string };
}
export interface Platform { n: number; x: number; z: number; r: number; nb: number[]; gone: boolean; danger: boolean; safe: boolean; mine: boolean; goal: boolean }
export interface BossState {
  name: string; title: string; ph: number; phs: number; hp: number; rage: boolean; st: string; danger: number;
  adds: { name: string; count: number; hp: number; art: FoeArt }[];
  mech: { name: string; icon: string; fam: string; text: string; words: string[]; how: string; fake: boolean; silence: boolean; me: boolean; got: number; need: number; until: number } | null;
  zones: Platform[]; my: number | null; inFight: boolean;
}
export interface VoteState { title: string; done: boolean; end: number; win: number; my: number; opts: { n: number; label: string; votes: number; back: boolean }[] }
export interface SceneState {
  kind: SceneKind;
  /** changes when the 3D set must be rebuilt (kind/biome/battle) */
  setKey: string;
  title: string; sub: string; ter: string; biome: BiomeId;
  /** the Halloween gather at the portal (q.gather.hw, site 28.10): «🎃 Сбор у портала», join word «портал» */
  hw: boolean;
  /** party size and the drawn party (detailed + generic) */
  n: number; party: Member[]; reserve: number;
  inParty: boolean; partyState: string;
  myRole: string;
  /** server ms when the current window closes (0 = none) — count down with the stream delay */
  until: number;
  roll: { by: string; n: number; tier: string } | null;
  late: [number, string, number][];
  placeActions?: NonNullable<QuestPayload['pb']>['b'];
  battle: BattleState | null; boss: BossState | null; vote: VoteState | null;
  trap: { per?: number; rd2?: NonNullable<QuestPayload['tr']>['rd2']; type: string; name: string; icon: string; st: string; word: string; gas: boolean; n: number; len: number; max: number; tre: boolean; win: boolean | null; text: string; acted: boolean; done: boolean } | null;
  shop: { name: string; items: { n: number; name: string; rarity: string; price: number; slot: string }[] } | null;
  event: { look: string; name: string; st: string; text: string; game: string; how: string; steps: string[]; length: number; card: string; picked: string[]; pool: number; price: number; votes: number[];
    /** goblin fair: the public result of the game (only in reveal / next, from `rv`): winning cup 1–3, coin face, the second hilo card */
    res: GoblinRes | null;
    /** lost ghost: the public riddle (quest.js shows `ev.q`), its number of `qn` */
    q: string; qi: number; qn: number } | null;
  /** map puzzle (site 28.10): kind, stage, the task line, scale sums, the poisoned cup after the result;
   *  changed: `items` (every stage); letter: `letter`, words `got` of `goal` */
  puzzle: { kind: string; st: string; name: string; icon: string; line: string; sums: number[]; ans: string; items: number; letter: string; got: number; goal: number } | null;
  loot: { name: string; votes: number } | null;
  town: { id: string; name: string } | null;
  dungeon: { name: string; esc: boolean; opts: { n: number; label: string; icon: string; votes: number; back: boolean }[] } | null;
  lair: { isles: number; gone: number[]; my: number; hp: number | null; phase: number; round: number; stage: string; acted: boolean; rt: number } | null;
  /** what to type in chat now, most important first */
  cmds: Cmd[];
  /** one-line «what is going on» */
  status: string;
  /** the gather ended with nobody (site 28.10, quest.js `v.nb`): a calm, empty gather scene — the squad goes back to town */
  empty?: boolean;
}

/* ------------------------------------------------------------------ roster: the party across stages */

const GENERIC = ['Котик', 'Мурзик', 'Пушистик', 'Кексик', 'Тигруля', 'Плюшка', 'Ватрушка', 'Пончик', 'Сырник', 'Носок', 'Лапка', 'Хвостик'];
const ROLES_CYCLE: Role[] = ['legionary', 'rogue', 'archer', 'mage', 'priest', 'recruit', 'paladin', 'archer', 'necromancer', 'legionary', 'priest', 'rogue'];

/**
 * The party is only listed inside a battle (`b.form`); elsewhere the view has just `n` (docs/QUEST.md §10). The roster
 * keeps the last form we saw so the same cats walk on to the next stop. Bounded (keeps ≤ 420 like the site's frame).
 */
export class Roster {
  private list: { login: string; role: string; name: string }[] = [];
  private names = new Map<string, string>();
  remember(b: QuestBattle | undefined | null): void {
    if (b && Array.isArray(b.form) && b.form.length) this.take(b);
  }
  private take(b: QuestBattle) {
    this.list = b.form.slice(0, 420).filter((p) => Array.isArray(p) && typeof p[0] === 'string').map((p) => ({ login: String(p[0]), role: String(p[1] || 'recruit'), name: this.names.get(String(p[0])) || '' }));
    if (Array.isArray(b.low)) for (const l of b.low) if (Array.isArray(l) && l[0]) this.names.set(String(l[0]), String(l[1] || l[0]));
  }
  /** Display name learnt from `b.low` (login → name), or ''. */
  nameOf(login: string): string { return this.names.get(login) || ''; }
  get size(): number { return this.list.length; }
  members(n: number, me: { login: string; role: string; in: boolean }, cap = 60): Member[] {
    const want = Math.max(0, Math.min(cap, Math.round(+n || 0)));
    const out: Member[] = [];
    const seen = new Set<string>();
    if (me.in && me.login) { out.push(member(me.login, me.role, 'R', true, false, this.nameOf(me.login))); seen.add(me.login); }
    for (const p of this.list) { if (out.length >= want) break; if (seen.has(p.login)) continue; seen.add(p.login); out.push(member(p.login, p.role, 'R', false, false, p.name || this.nameOf(p.login))); }
    for (let i = 0; out.length < want; i++) {
      const login = `#cat${i}`;
      out.push(member(login, ROLES_CYCLE[i % ROLES_CYCLE.length], 'R', false, true, `${GENERIC[i % GENERIC.length]}${i >= GENERIC.length ? ' ' + (1 + Math.floor(i / GENERIC.length)) : ''}`));
    }
    return out;
  }
}
function member(login: string, role: string, side: Side, me: boolean, ghost: boolean, name = ''): Member {
  return { login, name: name || login, role, zone: zoneOf(role), side, shield: role === 'legionary' || role === 'paladin', rank: 2, me, low: -1, ghost };
}

/* ------------------------------------------------------------------ helpers */

const num = (x: unknown, d = 0) => (typeof x === 'number' && Number.isFinite(x) ? x : d);
const str = (x: unknown, d = '') => (typeof x === 'string' ? x : x == null ? d : String(x));
const arr = <T = unknown>(x: unknown): T[] => (Array.isArray(x) ? (x as T[]) : []);
const clamp01 = (x: unknown) => Math.max(0, Math.min(1, num(x, 0)));
const SIDES = new Set<string>(['L', 'R', 'F']);
const side = (x: unknown, d: Side = 'R'): Side => (SIDES.has(x as string) ? (x as Side) : d);
const baseOf = (role: string) => BASE_CMD[role as Role] || 'удар';
export const ZONE_RU = ['щиты', 'ближний бой', 'стрелки и маги', 'жрецы'] as const;
export const HOW_RU: Record<string, string> = { win: 'Победа!', away: 'Враги сбежали', lose: 'Отряд разбит', retreat: 'Отступление' };

export interface AdaptCtx { login: string; role: string; roster: Roster }

/* ------------------------------------------------------------------ the adapter */

const EMPTY: SceneState = {
  kind: 'off', setKey: 'off', title: '', sub: '', hw: false, ter: '', biome: 'meadow', n: 0, party: [], reserve: 0, inParty: false, partyState: '', myRole: 'recruit',
  until: 0, roll: null, late: [], battle: null, boss: null, vote: null, trap: null, shop: null, event: null, puzzle: null, loot: null, town: null, dungeon: null, lair: null, cmds: [], status: '',
};

/** Delayed view → scene state. Never throws: a broken block is dropped, the rest still shows. */
export function adapt(v: QuestPayload | null | undefined, c: AdaptCtx): SceneState {
  try { return adaptUnsafe(v, c); } catch (e) {
    try { console.warn('[l3d] expedition adapter', e); } catch { /* */ }
    return { ...EMPTY, kind: v && (v as any).on ? 'travel' : 'off', setKey: v && (v as any).on ? 'travel|meadow' : 'off', title: 'Поход', status: 'Поход идёт', cmds: [] };
  }
}

function adaptUnsafe(v: QuestPayload | null | undefined, c: AdaptCtx): SceneState {
  if (!v || typeof v !== 'object' || !v.on) return { ...EMPTY, cmds: [] };
  const q = v as QuestPayload & Record<string, any>;
  const st = stageOf(q), kind0 = kindOf(q);
  const ter = str(q.ter), biome = biomeOf(ter);
  const inParty = q.party === 'in';
  const myRole = c.role || 'recruit';
  if (q.b && typeof q.b === 'object') c.roster.remember(q.b);
  const n = Math.max(0, Math.round(num(q.n, 0)));
  const s: SceneState = { ...EMPTY, ter, biome, n, inParty, partyState: str(q.party), myRole, title: str(q.t), cmds: [], party: [], hw: !!(q.gather?.hw || q.ev?.hw || ter === 'Изнанка') };
  s.roll = q.roll ? { by: str(q.roll.by), n: num(q.roll.n), tier: str(q.roll.tier) } : null;
  s.late = arr<[number, string, number]>(q.late);
  s.placeActions = arr<NonNullable<QuestPayload['pb']>['b'][number]>(q.pb?.b);
  const me = { login: c.login, role: myRole, in: inParty };
  // 28.10 (empty-party): nobody joined — the site shows only that; we show the empty gather place, nothing to type
  if (emptyParty(q)) {
    s.kind = 'gather'; s.empty = true; s.n = 0; s.party = []; s.reserve = 0; s.inParty = false; s.until = 0; s.roll = null; s.placeActions = [];
    s.status = EMPTY_PARTY.title; s.sub = EMPTY_PARTY.back;
    s.cmds = [{ kind: 'info', text: EMPTY_PARTY.back, note: 'стример объявит новый сбор — пиши «поход»' }];
    s.setKey = `gather|${biome}||empty`;
    return s;
  }

  // which scene
  let kind: SceneKind;
  switch (st.s) {
    case 'battle': kind = st.boss ? 'boss' : 'battle'; break;
    case 'boss': kind = 'boss'; break;
    case 'dungeon': kind = 'dungeon'; break;
    case 'isles': case 'lair': kind = 'lair'; break;
    case 'trap': kind = st.treasure ? 'treasure' : 'trap'; break;
    case 'event': kind = 'event'; break;
    case 'puzzle': kind = 'puzzle'; break;
    case 'vote': kind = 'vote'; break;
    case 'loot': kind = 'loot'; break;
    case 'shop': kind = 'shop'; break;
    default: {
      const k = kind0;
      kind = k === 'gather' ? 'gather' : k === 'rest' ? 'rest' : k === 'town' ? 'town' : k === 'map' ? (q.vote ? 'vote' : 'travel')
        : k === 'shop' ? 'shop' : k === 'boss' || k === 'bossgen' ? 'boss' : 'travel';
    }
  }
  s.kind = kind;

  /* ---- party (outside battles: roster + generic) ---- */
  const capFor = (b: BiomeId) => (isTight(b) ? 30 : 60);
  s.party = c.roster.members(Math.max(n, inParty ? 1 : 0), me, capFor(biome));
  s.reserve = Math.max(0, n - s.party.length);

  /* ---- per kind ---- */
  if ((kind === 'battle' || kind === 'boss') && q.b && typeof q.b === 'object') battleOf(q.b as QuestBattle, s, c);
  if (kind === 'boss') bossOf(q, s, c);
  if (kind === 'vote' && q.vote) voteOf(q, s);
  if (kind === 'gather') {
    s.until = num(q.gather?.until, 0);
    s.status = `${s.hw ? '🎃 Сбор у портала' : 'Сбор отряда'}: ${n} ${plural(n, 'котик', 'котика', 'котиков')}`;
    s.cmds.push(inParty ? { kind: 'ok', text: 'ты в отряде', note: 'ждём остальных' } : q.party === 'ghost' ? { kind: 'info', text: 'твой герой — призрак в этом походе' }
      : { kind: 'say', text: s.hw ? 'портал' : 'поход', note: s.hw ? 'шагнуть в Изнанку с отрядом' : 'вступить в отряд' });
  }
  if (kind === 'travel') { s.status = `В пути${s.title ? ': ' + s.title : ''}`; travelCmds(q, s); }
  if (kind === 'rest') { s.status = 'Привал у костра'; travelCmds(q, s); }
  if (kind === 'town') { s.town = { id: str(q.town?.id), name: str(q.town?.name, s.title || 'Город') }; s.status = `Город: ${s.town.name}`; travelCmds(q, s); }
  if (kind === 'trap' || kind === 'treasure') trapOf(q, s);
  if (kind === 'event') eventOf(q, s);
  if (kind === 'puzzle') puzzleOf(q, s);
  if (kind === 'shop') shopOf(q, s);
  if (kind === 'loot') lootOf(q, s);
  if (kind === 'dungeon') dungeonOf(q, s);
  if (kind === 'lair') lairOf(q, s);
  if (!s.status) s.status = s.title || 'Поход';
  if (s.roll) s.status += ` · бросок ${s.roll.n}${s.roll.tier ? ' (' + s.roll.tier + ')' : ''}`;

  // set key: what forces a rebuild of the 3D set
  const bid = s.battle ? s.battle.id : '';
  s.setKey = `${kind}|${biome}|${bid}|${kind === 'event' ? s.event?.look + ':' + s.event?.game : kind === 'trap' ? s.trap?.type : kind === 'puzzle' ? s.puzzle?.kind : ''}`;
  return s;
}

function travelCmds(q: any, s: SceneState) {
  if (!s.inParty) s.cmds.push(q.party === 'q' ? { kind: 'ok', text: 'ты в очереди', note: 'вступишь на остановке' } : q.party === 'ghost' ? { kind: 'info', text: 'твой герой — призрак в этом походе' } : { kind: 'say', text: 'поход', note: q.cm === false ? 'вступить (на остановке)' : 'вступить в отряд' });
}

/* ---- battle ---- */
function battleOf(b: QuestBattle, s: SceneState, c: AdaptCtx) {
  const fronts0 = arr<Side>(b.cr?.fr).filter((x) => SIDES.has(x));
  const fronts: Side[] = fronts0.length ? fronts0 : b.two ? ['L', 'R'] : ['R'];
  const multi = fronts.length > 1 || !!b.two;
  const form = arr<any[]>(b.form).filter((p) => Array.isArray(p) && typeof p[0] === 'string');
  const meI = num(b.me, -1);
  const lowMap = new Map<string, number>();
  for (const l of arr<any[]>(b.low)) if (Array.isArray(l) && l[0] != null) lowMap.set(String(l[0]), clamp01(l[2]));
  const party: Member[] = form.slice(0, 420).map((p, i) => {
    const role = str(p[1], 'recruit');
    const m = member(String(p[0]), role, fronts.includes(p[2]) ? p[2] : fronts[i % fronts.length], i === meI, false, c.roster.nameOf(String(p[0])));
    m.shield = !!p[4] || m.shield; m.rank = num(p[5], 2); m.low = lowMap.has(m.login) ? lowMap.get(m.login)! : -1;
    return m;
  });
  // me past the drawn places (mf) or in reserve: still show me (highlighted) at my wing
  const hp = b.hp == null ? null : num(b.hp, 0);
  const mst = hp == null ? 'out' : hp === 0 ? 'dead' : hp < 0 ? 'fled' : meI >= 0 || Array.isArray(b.mf) ? 'on' : 'reserve';
  const mf = Array.isArray(b.mf) ? b.mf : null;
  const myRole = meI >= 0 && form[meI] ? str(form[meI][1], c.role) : mf ? str(mf[0], c.role) : c.role || 'recruit';
  const mySide: Side | '' = meI >= 0 && form[meI] ? side(form[meI][2], fronts[meI % fronts.length]) : mf ? side(mf[1], fronts[0]) : mst === 'reserve' || mst === 'on' ? fronts[0] : '';
  if (meI < 0 && (mst === 'on' || mst === 'reserve') && c.login && !party.some((m) => m.login === c.login)) {
    const m = member(c.login, myRole, (mySide || fronts[0]) as Side, true, false); party.unshift(m);
  }
  const fighters = Math.max(party.length, num(b.fighters, party.length));
  // cap drawn party (instancing budget); always keep me
  const cap = isTight(s.biome) ? 30 : 60;
  let drawn = party;
  if (party.length > cap) { const mine = party.filter((m) => m.me); drawn = mine.concat(party.filter((m) => !m.me).slice(0, cap - mine.length)); }
  s.party = drawn; s.reserve = Math.max(0, fighters - drawn.length); s.n = Math.max(s.n, fighters);
  s.myRole = myRole;
  const foes: FoeState[] = arr<any[]>(b.foes).filter((f) => Array.isArray(f)).slice(0, 24).map((f, i) => {
    const hp01 = clamp01(f[3]);
    return { i, art: foeArtOf(f[1], f[4], !!f[2]), type: str(f[1], 'unknown'), side: fronts.includes(f[0]) ? f[0] : side(f[0], fronts[i % fronts.length]), lead: !!f[2], hp: hp01, dead: hp01 <= 0, name: str(f[4]) };
  });
  const tele = b.tele && typeof b.tele === 'object' && typeof b.tele.word === 'string'
    ? { word: b.tele.word, kind: str(b.tele.kind), text: str(b.tele.text), got: num(b.tele.got, 0), need: num(b.tele.need, 0), ok: !!b.tele.ok } : null;
  const res = b.res && typeof b.res === 'object' ? { how: str(b.res.how, 'win'), xp: num(b.res.xp, 0), coins: num(b.res.coins, 0) } : null;
  const stage = str(b.st, 'party');
  const mine = b.mine && typeof b.mine === 'object' ? b.mine : null;
  s.battle = {
    id: str(b.id, 'b'), round: num(b.round, 1), maxR: num(b.maxR, 0), stage, fronts, multi, chaos: !!b.cr?.chaos, two: !!b.two,
    ambush: !!b.ambush, more: num(b.more), press: num(b.press), drop: num(b.drop),
    foes, foesAlive: foes.filter((f) => !f.dead).length, tele, res,
    feed: stage === 'tele' ? [] : arr(b.fd).map((x) => str(x)).slice(-6),
    mineK: mine ? str(mine.k) : '', mineText: mineLine(mine),
    cam: camFor(fighters, 200, s.ter), fighters,
    me: { st: mst, hp, side: mySide, role: myRole },
  };
  s.until = b.st === 'party' || b.st === 'tele' ? num(b.until, 0) : 0;
  const title = str(b.title, s.title);
  s.title = title;
  const stRu: Record<string, string> = { intro: 'Бой начинается', party: 'Ход отряда', hit: 'Удары!', tele: 'Ход врага', mech: 'Механика босса', trans: 'Новая фаза', end: 'Бой окончен' };
  s.status = `${stRu[stage] || 'Бой'} · раунд ${s.battle.round}${s.battle.maxR ? ' из ' + s.battle.maxR : ''}`;
  if (res) s.status = HOW_RU[res.how] || 'Бой окончен';

  // commands
  const active = mst === 'on' || mst === 'reserve';
  const cmd = cmdFor(myRole, mySide || undefined, multi);
  if (stage === 'tele' && tele) {
    if (!active) s.cmds.push({ kind: 'info', text: 'Отряд отбивает атаку', note: 'слово пишут бойцы' });
    s.cmds.push({ kind: 'word', text: tele.word, note: (tele.ok ? '✓ твоё слово принято · ' : '') + (tele.need ? `отбить: ${tele.got}/${tele.need}` : 'отбить атаку') });
  } else if (stage === 'party' || stage === 'intro') {
    if (b.turn) s.cmds.push({ kind: 'ok', text: `ход сделан: ${turnRu(b.turn)}` });
    if (active || !s.inParty) {
      s.cmds.push({ kind: 'say', text: cmd, note: active ? 'твоя команда' : `команда ${roleRu(myRole)}` });
      if (multi && baseOf(myRole) !== 'лечить') for (const f of fronts) {
        const t = `${baseOf(myRole)} ${SIDE_CMD[f]}`;
        if (t !== cmd) s.cmds.push({ kind: 'say', text: t, note: 'другой фронт', dim: true });
      }
      for (const sk of arr<any[]>(b.sk)) {
        if (!Array.isArray(sk) || typeof sk[0] !== 'string') continue;
        const cd = num(sk[1], 0), key = Object.keys(SKILLS).find((k) => SKILLS[k].name.toLowerCase() === sk[0].toLowerCase());
        s.cmds.push({ kind: 'say', text: sk[0], note: (key ? SKILLS[key].icon + ' ' : '') + (cd ? `навык · через ${cd}` : sk[2] === 'heal' ? 'навык · на союзника' : 'навык · готов'), dim: cd > 0 });
      }
    }
  } else if (stage === 'end' && res) {
    s.cmds.push({ kind: 'info', text: HOW_RU[res.how] || 'Бой окончен', note: `${res.xp ? '+' + res.xp + ' опыта' : ''}${res.coins ? ' · +' + res.coins + ' монет' : ''}`.replace(/^ · /, '') });
  } else if (stage === 'hit') {
    s.cmds.push({ kind: 'info', text: s.battle.mineText || 'Удары!', note: 'ждём следующий ход' });
  }
  if (!active && stage !== 'end') s.cmds.push({ kind: 'info', text: mst === 'dead' ? 'твой герой пал' : mst === 'fled' ? 'ты сбежал из боя' : 'ты не в этом бою' });
}
function turnRu(t: string): string {
  const m: Record<string, string> = { melee: 'удар', ranged: 'выстрел', magic: 'магия', heal: 'лечение', guard: 'защита', pull: 'рывок', auto: 'авто' };
  return m[t] || SKILLS[t]?.name || t;
}
function roleRu(r: string): string {
  const m: Record<string, string> = { legionary: 'легионера', archer: 'лучника', mage: 'мага', priest: 'жреца', rogue: 'разбойника', necromancer: 'некроманта', paladin: 'паладина', recruit: 'новобранца' };
  return m[r] || 'класса';
}
function mineLine(m: any): string {
  const me = m && m.me && typeof m.me === 'object' ? m.me : null;
  if (!me) return '';
  if (m.k === 'tele') return me.dead ? 'Тебя сразили' : num(me.hurt) ? `Тебя задели: −${num(me.hurt)}${me.by ? ' (' + str(me.by) + ')' : ''}` : m.ok ? 'Отбили атаку!' : '';
  if (me.dead) return 'Ты пал';
  if (num(me.heal)) return `Лечение +${num(me.heal)}`;
  if (num(me.n) && num(me.m) >= num(me.n)) return 'Мимо!';
  if (num(me.d)) return `${me.c ? 'Крит! ' : ''}−${num(me.d)}${me.e ? ' · ' + str(me.e) : ''}`;
  return '';
}

/* ---- boss ---- */
function bossOf(q: any, s: SceneState, c: AdaptCtx) {
  const g = q.bg && typeof q.bg === 'object' ? q.bg : null;
  const gb = q.b?.gb && typeof q.b.gb === 'object' ? q.b.gb : null;
  if (!g && !gb) return;
  const src = g || {};
  const M = src.mech && typeof src.mech === 'object' ? src.mech : null;
  const gbM = !M && gb?.mech && typeof gb.mech === 'object' ? gb.mech : null;
  const mech = M || gbM;
  const words = mech ? [...(typeof mech.word === 'string' && mech.word ? [mech.word] : []), ...arr<string>(mech.words).filter((w) => typeof w === 'string')] : [];
  const fam = mech ? str(mech.fam) : '';
  const silence = fam === 'silence' && !['M94', 'M55'].includes(str(mech?.id));
  const adds = arr<any[]>(src.adds).filter((a) => Array.isArray(a)).slice(0, 4).map((a) => ({ name: str(a[0], 'Прислужник'), count: Math.max(0, Math.round(num(a[1], 1))), hp: clamp01(a[2]), art: foeArt('', a[0]) }));
  s.boss = {
    name: str(src.name, str(gb?.name, 'Босс')), title: str(src.title, str(gb?.title)), ph: num(src.ph, num(gb?.phase, 1)), phs: num(src.phs, num(gb?.phases, 1)),
    hp: clamp01(src.hp ?? gb?.hp), rage: !!src.rage, st: str(src.st, str(q.b?.st, 'party')), danger: num(src.danger, 0),
    adds,
    mech: mech ? { name: str(mech.name), icon: str(mech.icon, '⚡'), fam, text: str(mech.text), words, how: str(mech.how), fake: !!mech.fake, silence, me: !!mech.me,
      got: num(mech.got, 0), need: num(mech.need, 0), until: num(mech.until, 0) } : null,
    zones: [], my: g && g.in ? num(g.my, 0) : null, inFight: !!(g && g.in) || (q.b ? q.b.hp != null : false),
  };
  // platforms (zn): polygons in stream px [guess] → centroids normalised into an arena box in front of the boss
  const zn = src.zn && typeof src.zn === 'object' ? src.zn : null;
  if (zn && Array.isArray(zn.a) && zn.a.length) {
    const gone = new Set(arr<number>(zn.gone).map(Number));
    const listed = new Set((mech ? arr<number>(mech.zones) : []).map(Number));
    const inv = str(mech?.id) === 'M32';
    const pts = zn.a.filter((z: any) => Array.isArray(z)).slice(0, 12).map((z: any) => {
      const poly = arr<number[]>(z[2]).filter((p) => Array.isArray(p) && p.length >= 2);
      let cx = 0, cy = 0; for (const p of poly) { cx += num(p[0]); cy += num(p[1]); }
      const k = poly.length || 1;
      return { n: Math.round(num(z[0], 0)), nb: arr<number>(z[1]).map(Number).filter(Number.isFinite), cx: cx / k, cy: cy / k };
    });
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const p of pts) { x0 = Math.min(x0, p.cx); x1 = Math.max(x1, p.cx); y0 = Math.min(y0, p.cy); y1 = Math.max(y1, p.cy); }
    const W = Math.max(1e-6, x1 - x0), H = Math.max(1e-6, y1 - y0);
    const area = num(src.area, 0);
    const posMech = fam === 'position';
    const zones: Platform[] = pts.map((p: { cx: number; cy: number; n: number; nb: number[] }) => {
      const danger = posMech && listed.size ? (inv ? !listed.has(p.n) : listed.has(p.n)) : false;
      return { n: p.n, x: -1 + ((p.cx - x0) / W - 0.5) * 7, z: ((p.cy - y0) / H - 0.5) * 6, r: 1.25, nb: p.nb, gone: gone.has(p.n), danger, safe: posMech && !danger && !gone.has(p.n), mine: p.n === area, goal: false };
    });
    // the one to stand on: my platform if safe, else the first safe neighbour (any safe one when mech.any or I am nowhere)
    const mineP = zones.find((z) => z.mine);
    if (posMech) {
      let goal = mineP && mineP.safe ? mineP : undefined;
      if (!goal) goal = zones.find((z) => z.safe && (!mineP || mech?.any || mineP.nb.includes(z.n)));
      if (!goal) goal = zones.find((z) => z.safe);
      if (goal) goal.goal = true;
    }
    s.boss.zones = zones;
  }
  // status + commands (boss overrides the plain battle commands while a mechanic runs)
  const B = s.boss;
  s.title = B.name + (B.title ? ' · ' + B.title : '');
  s.status = `Босс · фаза ${B.ph} из ${B.phs} · ${Math.round(B.hp * 100)}%`;
  if (B.mech) {
    if (B.mech.until) s.until = B.mech.until;
    const keep = s.cmds.filter((x) => x.kind === 'info' && /не в этом|пал|сбежал/.test(x.text));
    s.cmds = [];
    if (B.mech.fake) s.cmds.push({ kind: 'silent', text: 'ФИНТ — НЕ ПИШИ!', note: (B.mech.name ? B.mech.name + ': ' : '') + 'обманный замах, ничего не пиши' });
    else if (B.mech.silence) s.cmds.push({ kind: 'silent', text: 'ТИШИНА — МОЛЧИ!', note: B.mech.name });
    else if (B.mech.fam === 'position') {
      const goal = B.zones.find((z) => z.goal), mineP = B.zones.find((z) => z.mine);
      if (goal && mineP && goal.n === mineP.n) s.cmds.push({ kind: 'ok', text: `стой на площадке ${goal.n}`, note: 'она уцелеет' });
      else if (goal) s.cmds.push({ kind: 'say', text: `прыжок ${goal.n}`, note: 'перейди на целую площадку' });
      else s.cmds.push({ kind: 'info', text: B.mech.text || B.mech.name });
    } else if (B.mech.how) s.cmds.push({ kind: 'word', text: B.mech.how.toLowerCase(), note: B.mech.need ? `${B.mech.name} · ${B.mech.got}/${B.mech.need}` : B.mech.name });
    else for (const w of B.mech.words.slice(0, 3)) s.cmds.push({ kind: 'word', text: w.toLowerCase(), note: B.mech.name });
    if (B.mech.me) s.cmds.unshift({ kind: 'info', text: 'Цель — ты!', note: B.mech.text });
    s.cmds.push(...keep);
  } else if (B.st === 'party' || (!s.battle && !B.mech)) {
    if (!s.cmds.length) s.cmds.push({ kind: 'say', text: baseOf(s.myRole), note: 'бей босса' });
  }
  for (const a of B.adds) if (a.count > 0 && a.hp > 0) s.cmds.push({ kind: 'say', text: `удар ${a.name.toLowerCase()} 1`, note: `прислужники ×${a.count}: пока живы, урон по боссу вдвое меньше`, dim: true });
  if (q.b?.gb?.forbid) s.cmds.push({ kind: 'info', text: 'Босс запретил прямые слова — пиши синонимом' });
}

/* ---- vote ---- */
function voteOf(q: any, s: SceneState) {
  const V = q.vote;
  const opts = arr<any[]>(V.opts).filter((o) => Array.isArray(o)).slice(0, 6).map((o) => ({ n: Math.round(num(o[0], 0)), label: str(o[1], '?'), votes: Math.max(0, num(o[3], 0)), back: !!o[4] }));
  const done = !!V.done;
  let win = num(V.win, 0);
  if (done && !win && opts.length) win = opts.reduce((a, b) => (b.votes > a.votes ? b : a)).n;
  s.vote = { title: str(V.title, 'Куда идём?'), done, end: num(V.end, 0), win, my: num(V.my, 0), opts };
  s.until = done ? 0 : s.vote.end;
  s.title = s.title || 'Перекрёсток';
  s.status = done ? `Идём: ${opts.find((o) => o.n === win)?.label || '…'}` : s.vote.title;
  if (done) s.cmds.push({ kind: 'ok', text: `идём: ${opts.find((o) => o.n === win)?.label || win}` });
  else if (s.vote.my) s.cmds.push({ kind: 'ok', text: `твой голос: ${s.vote.my}` });
  if (!done) for (const o of opts) s.cmds.push({ kind: 'num', text: String(o.n), note: o.label + (o.back ? ' (назад)' : ''), dim: !!s.vote.my && s.vote.my !== o.n });
}

/* ---- trap / treasure ---- */
function trapOf(q: any, s: SceneState) {
  const T = q.tr && typeof q.tr === 'object' ? q.tr : {};
  const type = str(T.type, s.kind === 'treasure' ? 'code' : 'react');
  const res = T.res && typeof T.res === 'object' ? T.res : null;
  s.trap = { type, name: str(T.name, s.kind === 'treasure' ? 'Сокровищница' : 'Ловушка'), icon: str(T.icon, '🪤'), st: str(T.st, 'intro'), word: str(T.word), gas: !!T.gas || type === 'gas',
    n: Math.max(0, Math.round(num(T.n, 3))), len: Math.max(1, Math.round(num(T.len, 3))), max: Math.max(1, Math.round(num(T.max, 6))), tre: !!T.tre || s.kind === 'treasure',
    win: res ? (res.win == null ? null : !!res.win) : null, text: res ? str(res.text) : str(T.intro), acted: !!T.acted, done: !!res };
  s.trap.per = num(T.per, 3); s.trap.rd2 = T.rd2;
  s.title = s.trap.name;
  s.status = res ? (str(res.text) || 'Итог') : str(T.intro, s.trap.name);
  const act = s.trap.st === 'act' || s.trap.st === 'wait';
  if (act) s.until = num(T.until, 0);
  if (res) { s.cmds.push({ kind: 'info', text: str(res.text, 'итог'), note: res.me?.gain ? `+${num(res.me.gain)} монет` : undefined }); return; }
  if (!act) { s.cmds.push({ kind: 'info', text: str(T.intro, 'Приготовься…') }); return; }
  if (s.trap.gas) { s.cmds.push(T.acted ? { kind: 'info', text: 'ты написал — вдохнул газ' } : { kind: 'silent', text: 'Не пиши в чат!', note: 'газ: кто пишет — вдыхает' }); return; }
  if (T.acted && !(type === 'code' && T.rd2)) { s.cmds.push({ kind: 'ok', text: 'ход принят' }); return; }
  const how = str(T.how);
  switch (type) {
    case 'react': s.cmds.push(s.trap.word ? { kind: 'word', text: s.trap.word, note: 'успей написать' } : { kind: 'info', text: how || 'Реагируй!' }); break;
    case 'ropes': s.cmds.push({ kind: 'say', text: `резать 1…${s.trap.n}`, note: how || 'перережь верёвку' }); break;
    case 'ceiling': s.cmds.push({ kind: 'say', text: 'держу', note: how || 'держи потолок' }); break;
    case 'bait': s.cmds.push({ kind: 'say', text: 'взять', note: how || 'кто-то один берёт' }); break;
    case 'greed': s.cmds.push({ kind: 'say', text: 'взять', note: how || 'хватай и беги' }); break;
    case 'share': s.cmds.push({ kind: 'say', text: 'поровну', note: 'или «себе»' }); break;
    case 'code':
      if (T.rd2?.ph === 'vote') {
        s.cmds.push({ kind: 'say', text: 'забрать', note: 'забрать награду' }, { kind: 'say', text: 'дальше', note: 'риск: вторая дверь ×2, попытки общие' });
        break;
      }
      if (T.rd2 && T.rd2.left <= 0) { s.cmds.push({ kind: 'info', text: 'попытки кончились — смотри на отряд' }); break; }
      s.cmds.push({ kind: 'say', text: `код ${digits(s.trap.len)}`, note: [how || `${s.trap.len} рун 1–${s.trap.max}; повторы разрешены`, T.rd2 ? `попыток ${T.rd2.left} из ${num(T.per, 3)} · дверь ${num(T.rd2.door, 1)}` : ''].filter(Boolean).join(' · ') }); break;
    case 'plates': s.cmds.push({ kind: 'say', text: 'путь 123', note: how || 'цифры плит 1–9' }); break;
    default: s.cmds.push(s.trap.word ? { kind: 'word', text: s.trap.word } : { kind: 'info', text: how || s.trap.name });
  }
}
const digits = (n: number) => '123456789'.slice(0, Math.max(1, Math.min(9, n)));

/* ---- event ---- */
export interface GoblinRes { cup: number; face: '' | 'h' | 't'; card2: string }
const CARD_RU: Record<string, string> = { валет: 'В', дама: 'Д', король: 'К', туз: 'Т', j: 'В', q: 'Д', k: 'К', a: 'Т' };
const cardOf = (x: unknown): string => { const c = str(x).trim(); return CARD_RU[c.toLowerCase()] || (/^(10|[2-9]|[ВДКТ])$/i.test(c) ? c.toUpperCase() : ''); };
/**
 * Goblin game result from the public reveal (quest.js gobHtml shows only `rv.text`, «угадали N · мимо M»): the winning cup,
 * the coin face, the second hilo card. Structured fields win when a capture carries them (rv.cup / rv.face / rv.c2 / hl.c2 [guess]);
 * else the reveal line is read. Pure; 0 / '' when the line does not say.
 */
export function revealOf(game: string, text: string): { cup: number; face: '' | 'h' | 't'; card: string } {
  const out: { cup: number; face: '' | 'h' | 't'; card: string } = { cup: 0, face: '', card: '' };
  const t = String(text || '');
  if (game === 'shell') {
    const m = /(?:под|в)\s+(перв|втор|трет|[123])/i.exec(t);
    if (m) { const k = m[1].toLowerCase(); out.cup = k.startsWith('перв') || k === '1' ? 1 : k.startsWith('втор') || k === '2' ? 2 : 3; }
  } else if (game === 'coin') {
    const u = t.replace(/орёл или решка/gi, ' ');
    const h = u.search(/орёл|орел/i), r = u.search(/решк/i);
    out.face = h >= 0 && (r < 0 || h < r) ? 'h' : r >= 0 ? 't' : '';
  } else if (game === 'hilo') {
    const m = /(?:открыл[аи]?|открыта|вторая карта|выпал[аио]?|карта)\s*[:—–-]?\s*(10|[2-9]|валет|дама|король|туз|[ВДКТJQKA])(?![а-яё\w])/i.exec(t);
    if (m) out.card = cardOf(m[1]);
  }
  return out;
}
function goblinRes(E: any, game: string): GoblinRes | null {
  const rv = E.rv && typeof E.rv === 'object' ? E.rv : null;
  if (!rv || (E.st !== 'reveal' && E.st !== 'next')) return null;
  const g = str(rv.gk, game) || game, R = revealOf(g, str(rv.text));
  const cup = Math.round(num(rv.cup, num(rv.ball, 0)));
  const f = str(rv.face ?? rv.side).toLowerCase();
  return {
    cup: g === 'shell' ? (cup >= 1 && cup <= 3 ? cup : R.cup) : 0,
    face: g === 'coin' ? (f === 'h' || f.startsWith('ор') ? 'h' : f === 't' || f.startsWith('реш') ? 't' : R.face) : '',
    card2: g === 'hilo' ? cardOf(rv.c2 ?? E.hl?.c2) || R.card : '',
  };
}
function eventOf(q: any, s: SceneState) {
  const E = q.ev && typeof q.ev === 'object' ? q.ev : {};
  const look = str(E.look, 'traveler');
  const I = eventInstructions(E, q.party);
  const game = str(E.gk);
  s.event = { look, name: str(E.name, 'Событие'), st: str(E.st, 'on'), text: I.text, game, how: str(E.how),
    steps: E.st === 'show' ? arr<any[]>(E.sq).map(p => str(p[0])) : E.st === 'done' ? arr<string>(E.seq) : [],
    length: num(E.len), card: E.st === 'guess' ? str(E.hl?.c1) : '', picked: arr<string>(E.picked), pool: num(E.pool), price: num(E.price), votes: [num(E.vt?.sweet), num(E.vt?.trick)],
    res: E.gob ? goblinRes(E, game) : null, q: str(E.q), qi: Math.max(0, Math.round(num(E.qi))), qn: Math.max(0, Math.round(num(E.qn))) };
  // the top bar shows «title · status»: the stage only (the name is the title already)
  s.title = s.event.name; s.status = I.status; s.until = E.st === 'done' ? 0 : num(E.until);
  s.cmds.push(...I.cmds);
}

/* ---- map puzzle (site 28.10, quest.js pzHtml) ---- */
function puzzleOf(q: any, s: SceneState) {
  const P = q.pz && typeof q.pz === 'object' ? (q.pz as QuestPuzzle) : null;
  if (!P) return;
  const M = puzzleMy(P), st = str(P.st, 'answer'), kind = str(P.kind, 'riddle');
  // quest.js pzHtml reads P.items (changed), P.letter / P.got / P.goal (letter) straight from the view, in every stage
  const items = Math.max(0, Math.round(num(P.items, kind === 'changed' ? arr(P.bt).length : 0)));
  s.puzzle = { kind, st, name: str(P.name, 'Головоломка'), icon: str(P.icon, '🧩'), line: puzzleTask(P), sums: arr<number>(P.sums).map((x) => num(x, 0)), ans: st === 'done' ? str(P.res?.ans) : '',
    items, letter: str(P.letter).trim().toUpperCase(), got: Math.max(0, Math.round(num(P.got))), goal: Math.max(0, Math.round(num(P.goal))) };
  s.title = s.puzzle.name; s.status = `Головоломка · ${PUZZLE_ST[st] || st}`;
  s.until = st === 'done' ? 0 : num(st === 'show' ? P.showUntil : P.until, 0);
  if (st === 'done') {
    s.cmds.push({ kind: 'info', text: str(P.res?.text, 'итог') });
    if (M.st === 'ok') s.cmds.push({ kind: 'ok', text: 'ты ответил верно', note: M.coins ? `+${M.coins}` : undefined });
    else if (M.st === 'bad') s.cmds.push({ kind: 'info', text: 'твой ответ — мимо', note: M.hp ? `яд −${M.hp} ❤` : undefined });
    return;
  }
  if (!s.inParty) { s.cmds.push({ kind: 'info', text: 'отвечает только отряд' }); return; }
  if (st === 'show') { s.cmds.push({ kind: 'info', text: kind === 'count' ? 'считай зверьков на стриме' : 'смотри на стрим и запоминай' }); return; }
  if (M.ans && kind !== 'scales' && kind !== 'cups') { s.cmds.push({ kind: 'ok', text: `твой ответ: ${puzzleAnsText(P, M.ans)}`, note: kind === 'riddle' ? 'верный или нет — в итоге' : undefined }); return; }
  const bt = arr<any[]>(P.bt).filter((b) => Array.isArray(b) && typeof b[1] === 'string');
  if (!puzzleTyped(kind) && bt.length) for (const b of bt) s.cmds.push({ kind: 'say', text: b[1], note: str(b[0]) || undefined });
  // typed answers: `how` is an instruction («Слово на «К»», «Напиши число»), not a chat line — no «» around it (site: q-big + «Пиши ответ в чат»)
  else s.cmds.push({ kind: 'info', text: str(P.how, 'Ответ — в чат'), note: ['пиши ответ в чат стрима', s.puzzle.line].filter(Boolean).join(' · ') });
}

/* ---- shop ---- */
function shopOf(q: any, s: SceneState) {
  const S = q.sh && typeof q.sh === 'object' ? q.sh : {};
  s.shop = { name: str(S.name, 'Лавка'), items: arr<any>(S.items).filter((i) => i && typeof i === 'object').slice(0, 9).map((i, k) => ({ n: k + 1, name: str(i.name, '?'), rarity: str(i.rarity, 'common'), price: num(i.price, 0), slot: str(i.slot) })) };
  s.title = s.shop.name; s.status = s.shop.name;
  if (s.shop.items.length) s.cmds.push({ kind: 'say', text: 'купить 1', note: `номер товара 1–${s.shop.items.length}` });
  s.cmds.push({ kind: 'say', text: 'продать 1', note: 'номер вещи в сумке', dim: true });
  s.cmds.push({ kind: 'say', text: 'украсть 1', note: 'рискованно', dim: true });
}

/* ---- loot ---- */
function lootOf(q: any, s: SceneState) {
  const L = q.loot;
  s.loot = { name: str(L.name, 'Добыча'), votes: num(L.n, 0) };
  s.until = num(L.until, 0);
  s.title = s.title || 'Делёж добычи'; s.status = `Делёж: ${s.loot.name}`;
  s.cmds.push(L.my ? { kind: 'ok', text: 'твой голос учтён' } : { kind: 'say', text: 'случайно', note: 'или номер / ник — кому отдать' });
}

/* ---- dungeon ---- */
function dungeonOf(q: any, s: SceneState) {
  const D = q.dgn && typeof q.dgn === 'object' ? q.dgn : {};
  const V = D.vote && typeof D.vote === 'object' ? D.vote : null;
  s.dungeon = { name: str(D.name, 'Данж'), esc: !!D.esc, opts: V ? arr<any[]>(V.opts).filter((o) => Array.isArray(o)).slice(0, 5).map((o) => ({ n: Math.round(num(o[0])), label: str(o[2], '?'), icon: str(o[3]), votes: num(o[4]), back: !!o[5] })) : [] };
  s.title = s.dungeon.name; s.status = D.esc ? 'Своды рушатся!' : s.dungeon.name;
  if (V) s.until = num(V.end, 0);
  if (D.esc) s.cmds.push({ kind: 'say', text: 'бежать', note: 'своды рушатся' });
  if (V && !V.done && V.mode !== 'ring') for (const o of s.dungeon.opts) s.cmds.push({ kind: 'num', text: String(o.n), note: o.label, dim: !!V.my && V.my !== o.n });
}

/* ---- lair (islands) ---- */
function lairOf(q: any, s: SceneState) {
  const L = q.lair && typeof q.lair === 'object' ? q.lair : {};
  const I = L.is && typeof L.is === 'object' ? L.is : null;
  const my = num(I?.at?.my, num(I?.pick?.my, 0));
  s.lair = { isles: 4, gone: arr<number>(I?.gone).map(Number), my, hp: L.hp == null ? null : num(L.hp, 0), phase: num(L.phase, 1), round: num(L.round), stage: str(L.st), acted: !!L.acted, rt: num(L.rt) };
  s.title = `Логово ${bossName(q).g}`; s.status = I ? (I.pick ? 'Выбор острова' : I.doom ? 'Какой остров уничтожить?' : 'Острова') : `Логово · фаза ${num(L.phase, 1)} · раунд ${num(L.round)} · ${str(L.st)}`;
  s.until = num(I?.pick?.until, num(I?.doom?.until, num(L.spell?.until, 0)));
  if (I?.pick) s.cmds.push(my ? { kind: 'ok', text: `ты на острове ${my}` } : { kind: 'num', text: '1–4', note: 'номер острова' });
  if (I?.doom) s.cmds.push({ kind: 'num', text: arr<number>(I.doom.opts).join(' / ') || '1–4', note: 'какой остров уничтожить' });
  if (my && !I?.pick) s.cmds.push({ kind: 'say', text: 'прыгнуть 2', note: 'на соседний остров', dim: true });
  if (L.tele?.word) s.cmds.push(L.tele.ok ? { kind: 'ok', text: 'слово принято' } : { kind: 'word', text: str(L.tele.word) });
  const phrase = arr<string>(L.spell?.words || L.mass?.words);
  if (phrase.length) s.cmds.push({ kind: 'word', text: phrase.join(' '), note: 'повтори фразу целиком' });
  if (L.st === 'party' && L.hp > 0) s.cmds.push(L.acted ? { kind: 'ok', text: 'ход принят' } : { kind: 'say', text: baseOf(s.myRole), note: 'твой ход' });
  if (!s.cmds.length) s.cmds.push({ kind: 'info', text: L.st === 'end' ? 'бой окончен' : 'наблюдай за боем' });
  if (L.deal) s.cmds.push({ kind: 'say', text: 'сделка', note: 'полжизни за монеты', dim: true });
}

export function plural(n: number, one: string, few: string, many: string): string {
  const a = Math.abs(n) % 100, b = a % 10;
  return a > 10 && a < 20 ? many : b === 1 ? one : b >= 2 && b <= 4 ? few : many;
}
