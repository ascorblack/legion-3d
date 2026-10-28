/**
 * Expedition («Поход») HUD: a card on the right side that tells what is happening and what to type in chat.
 * Data: SSE `q` (store.quest), shown with the stream delay like the site does (docs/GAME-DESIGN.md §7).
 * Fair play: never sends anything by itself; reaction words are drawn on a canvas (not copyable).
 * Commands (src/quest/siteui.ts): what the site's own «Поход» tab offers this user is mirrored — PRESSED commands as buttons that click
 * the site's own button, TYPED ones as a line fed into the site's own «Команда в поход»; without the site's flag (`hero.qa`) the
 * card says «пиши в чат стрима» with the commands as copyable chips. No request is ever built here.
 */
import type { Store, Actions, QuestView } from '../contracts';
import type { MountQuestHud, QuestHud } from '../contracts/modules';
import { bossName, emptyParty, EMPTY_PARTY, eventInstructions, mergeOwn, PUZZLE_ST, puzzleMy, puzzleAnsText, puzzleTask, puzzleTyped, type QuestPuzzle, type QuestPayload } from './model';
import { readSite, pressSite, feedSiteSay, primeSite, siteQaOn, chatChips, hotButtons, type SiteControls, type SiteBtn } from './siteui';
export { readSite, pressSite, feedSiteSay, primeSite, siteQaOn, chatChips, hotButtons, findSite, qaSig, siteScope } from './siteui';
export type { SiteControls, SiteBtn, SiteGroup, SiteLine, SiteHist, SiteSay } from './siteui';

const KIND_RU: Record<string, string> = { battle: 'Бой', trap: 'Ловушка', treasure: 'Сокровищница', lair: 'Логово', rest: 'Привал', shop: 'Лавка', event: 'Событие', map: 'Карта', travel: 'В пути', town: 'Город', gather: 'Сбор отряда', boss: 'Босс', dungeon: 'Данж', bossgen: 'Босс', puzzle: 'Головоломка' };
const SIDE_RU: Record<string, string> = { L: 'левое крыло', R: 'правое крыло', F: 'дальнее крыло' };
const SIDE_CMD: Record<string, string> = { L: 'лево', R: 'право', F: 'вдали' };
const ADJ_KEY = 'lgQDelay';

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

export interface Card {
  icon: string; title: string; right: string;   // right: may contain {until:ms} marker → seconds
  until?: number; where?: string; hp?: number | null; urge?: { kind: 'say' | 'word' | 'silent' | 'ok' | 'info'; text: string };
  note?: string; opts?: { n: number; label: string; votes: number; my?: boolean }[]; voteId?: number; inParty: boolean;
  /** join / leave the squad (site quest.js qaSquad / layTop) */
  squad?: Squad | null;
  /** the gather ended with nobody (site 28.10 `v.nb`): no «Поход идёт» wording */
  empty?: boolean;
}

/* ------------------------------------------------------------------ join / leave the squad (site «Поход» tab, quest.js qaSquad ~l.881, layTop ~l.1390) */

export type Squad = { kind: 'join'; label: string; note?: string } | { kind: 'leave'; label: string } | { kind: 'info'; text: string };
/**
 * What the site offers for joining / leaving now (quest.js qaSquad): only at the map stops (no battle in progress — or it ended —,
 * no boss, dungeon room, lair, trap, event, puzzle, loot or shop counter); in → «Покинуть отряд» (not while marching: cm === false);
 * q → in the queue; ghost → after the revival; else «Вступить в поход» (marching: «Встать в очередь в отряд»). `party` = the newest
 * own state (the site shows its own party at once, not with the stream delay).
 */
export function squadOf(v: QuestView | null, party: unknown): Squad | null {
  const q = v as any;
  if (!q || !q.on || q.nb) return null;   // 28.10 (empty-party): the site shows only the «никто не присоединился» card
  if ((q.b && q.b.st !== 'end') || q.bg || q.dgn || q.lair || q.tr || q.ev || q.pz || q.loot || (q.sh && q.sh.items && q.sh.items.length)) return null;
  const p = party === 'in' || party === 'q' || party === 'ghost' ? party : 'out';
  if (p === 'in') return q.cm === false ? null : { kind: 'leave', label: 'Покинуть отряд' };
  if (p === 'ghost') return { kind: 'info', text: 'Твой герой — призрак: в поход — после воскрешения.' };
  if (p === 'q') return { kind: 'info', text: 'Ты в очереди: вступишь, когда отряд остановится.' };
  return q.cm === false ? { kind: 'join', label: 'Встать в очередь в отряд', note: 'отряд в пути — вступишь на остановке' } : { kind: 'join', label: 'Вступить в поход' };
}
/**
 * The site's own join / leave button in its «Поход» tab: `[data-qa]` whose JSON has k:'join' / k:'leave' (qaBtn), or the header's
 * `[data-qleave]` (layTop: needs a second press within 4 s on the site itself). Disabled ones (a request in flight) are skipped.
 */
export function siteSquadButton(doc: ParentNode, k: 'join' | 'leave'): { el: HTMLElement; twoPress: boolean } | null {
  for (const b of Array.from(doc.querySelectorAll<HTMLElement>('[data-qa]'))) {
    let o: any = null; try { o = JSON.parse(b.getAttribute('data-qa') || ''); } catch { /* */ }
    if (o && o.k === k && !(b as HTMLButtonElement).disabled) return { el: b, twoPress: false };
  }
  if (k === 'leave') { const b = doc.querySelector<HTMLElement>('[data-qleave]'); if (b && !(b as HTMLButtonElement).disabled) return { el: b, twoPress: true }; }
  return null;
}
/**
 * Press the site's own button — the site sends its own request and shows its own result. 'clicked' | 'panel' (no button rendered:
 * the site's «Поход» tab is opened instead, nothing is sent). Only ever called from the user's click (leave: after the second press).
 */
export function pressSiteSquad(doc: ParentNode, k: 'join' | 'leave', openPanel: () => void): 'clicked' | 'panel' {
  const f = siteSquadButton(doc, k);
  if (!f) { openPanel(); return 'panel'; }
  f.el.click();
  // layTop's «покинуть отряд?» arms on the first press and repaints: the user already confirmed twice here, so confirm the site's arm
  if (f.twoPress) { const again = doc.querySelector<HTMLElement>('[data-qleave]'); if (again && !(again as HTMLButtonElement).disabled) again.click(); }
  return 'clicked';
}

/** Pure: QuestView (+ own login/role) → what to show. Exported for tests. `fresh` = the newest view (the Prologue boss name:
 *  quest.js bn() takes NEW first, then the delayed CUR). */
export function cardOf(v: QuestView | null, me: { login: string; role: string }, baseCmd: (role: string) => string, fresh?: QuestView | null): Card | null {
  if (!v || !v.on) return null;
  const q = v as any, inParty = q.party === 'in';
  // 28.10 (empty-party, quest.js v.nb): the gather ended with nobody — the site shows only this, nothing else of the view
  if (emptyParty(q)) return { icon: '⏳', title: EMPTY_PARTY.title, right: '', urge: { kind: 'info', text: EMPTY_PARTY.back }, note: EMPTY_PARTY.note, inParty: false, empty: true };
  const BN = bossName(fresh as any, q);   // 28.10 (prologue-boss-name): the channel's Prologue boss, default «Закхуэль»
  if (q.b && !(q.b.gb && q.bg)) {
    const b = q.b, m = meIn(b, me), multi = !!(b.cr?.fr?.length > 1) || !!b.two;
    const cmd = (() => { const c = baseCmd(m.role) || 'удар'; return multi && m.side && c !== 'лечить' ? `${c} ${SIDE_CMD[m.side] || ''}`.trim() : c; })();
    const stage = b.st === 'party' ? 'ход отряда' : b.st === 'tele' ? 'ход врага' : b.st === 'end' ? 'бой окончен' : 'удары';
    let urge: Card['urge'];
    const active = m.st === 'on' || m.st === 'reserve';
    if (b.tele && active) urge = b.tele.ok ? { kind: 'ok', text: 'слово принято' } : { kind: 'word', text: String(b.tele.word || '') };
    else if (b.st === 'party' && active) {
      const ready = (b.sk || []).find((x: any) => !x[1]);
      urge = b.turn ? { kind: 'ok', text: `ход сделан: ${b.turn}` } : { kind: 'say', text: ready ? String(ready[0]) : cmd };
    }
    const where = m.st === 'on' ? `ты на экране${multi && m.side ? ' · ' + SIDE_RU[m.side] : ''}` : m.st === 'reserve' ? 'ты в бою, но вне кадра стрима' : m.st === 'dead' ? 'твой герой пал' : m.st === 'fled' ? 'ты сбежал из боя' : 'ты не в этом бою';
    return { icon: '⚔', title: `Бой · ${b.title || q.t || ''} · раунд ${b.round}${b.maxR ? '/' + b.maxR : ''}`, right: stage, until: b.st === 'party' || b.st === 'tele' ? b.until : undefined, where, hp: b.hp, urge, inParty };
  }
  if (q.lair?.is) {
    const I = q.lair.is, my = I.at?.my || I.pick?.my || 0;
    return { icon: '🏝', title: `${BN.n} · острова`, right: I.pick ? 'выбор острова' : I.doom ? 'какой остров уничтожить' : 'острова', until: I.pick?.until || I.doom?.until,
      urge: my ? { kind: 'ok', text: `ты на острове ${my}` } : I.pick ? { kind: 'say', text: '1–4' } : undefined, hp: q.lair.hp, inParty };
  }
  if (q.lair) {
    const L = q.lair, words = L.spell?.words || L.mass?.words;
    const urge: Card['urge'] = L.tele ? { kind: L.tele.ok ? 'ok' : 'word', text: L.tele.ok ? 'слово принято' : L.tele.word }
      : words?.length ? { kind: 'word', text: words.join(' ') } : L.st === 'party' && L.hp > 0 ? { kind: L.acted ? 'ok' : 'say', text: L.acted ? 'ход принят' : baseCmd(me.role) || 'удар' } : { kind: 'info', text: L.st === 'end' ? 'бой окончен' : 'наблюдай за боем' };
    return { icon: '👹', title: `Логово ${BN.g}`, right: 'фаза ' + (L.phase || 1) + ' · раунд ' + (L.round || 0), until: L.spell?.until, hp: L.hp, urge, inParty };
  }
  if (q.bg) {
    const g = q.bg, M = g.mech;
    let urge: Card['urge'];
    if (M) urge = M.fake ? { kind: 'silent', text: 'ФИНТ — не пиши!' } : M.fam === 'silence' ? { kind: 'silent', text: 'Тишина: молчи' } : M.me ? { kind: M.how ? 'word' : 'info', text: M.how || M.tip || 'Цель — ты!' } : M.how || M.word ? { kind: 'word', text: String(M.how || M.word) } : { kind: 'info', text: M.name };
    else if (g.st === 'party') urge = g.acted ? { kind: 'ok', text: 'ход сделан' } : { kind: 'say', text: baseCmd(me.role) || 'удар' };
    return { icon: '👹', title: `${g.name} · фаза ${g.ph} из ${g.phs}`, right: M?.until ? '' : `босс ${Math.round((g.hp || 0) * 100)}%`, until: M?.until, where: g.in ? (g.my > 0 ? 'ты в бою' : 'твой герой пал') : 'ты не в этом бою', hp: g.in ? g.my : null, urge, note: M && M.name ? M.name : undefined, inParty };
  }
  if (q.tr) {
    const T = q.tr, act = T.st === 'act' || T.st === 'wait';
    const urge: Card['urge'] = T.res ? { kind: 'info', text: T.res.text || 'итог ловушки' } : act && T.gas ? (T.acted ? { kind: 'info', text: 'ты написал — вдохнул газ' } : { kind: 'silent', text: 'Не пиши в чат!' })
      : act && T.word ? (T.acted ? { kind: 'ok', text: 'слово принято' } : { kind: 'word', text: String(T.word) }) : act && T.how ? { kind: 'info', text: String(T.how) } : undefined;
    return { icon: T.icon || '🪤', title: String(T.name || (T.tre ? 'Сокровищница' : 'Ловушка')), right: '', until: act ? T.until : undefined, urge, note: T.rd2 ? (T.rd2.ph === 'vote' ? 'забрать / дальше · вторая дверь ×2, попытки общие' : `дверь ${T.rd2.door || 1} · попыток ${T.rd2.left || 0} из ${T.per || 3} · повторы рун разрешены`) : undefined, inParty };
  }
  if (q.pz) {   // 28.10 (map-puzzles, quest.js pzHtml): what to type now, the task, own answer, the result
    const P = q.pz as QuestPuzzle, M = puzzleMy(P), done = P.st === 'done';
    const urge: Card['urge'] = done ? { kind: 'info', text: P.res?.text || 'итог' }
      : P.st === 'show' ? { kind: 'info', text: P.kind === 'count' ? 'Зверьки бегут на стриме — считай!' : 'Смотри на стрим и запоминай!' }
      : M.ans ? { kind: 'ok', text: `твой ответ: ${puzzleAnsText(P, M.ans)}` }
      : P.kind === 'letter' && M.words ? { kind: 'ok', text: `твоих слов: ${M.words} — пиши ещё` }
      // typed answers: `how` is an instruction («Слово на «К»»), not a chat line — shown as is, without «»
      : puzzleTyped(String(P.kind)) ? { kind: 'info', text: String(P.how || 'Ответ — в чат') }
      : { kind: 'say', text: String((P.bt || []).map((b) => b[1]).join(' / ') || P.how || 'ответ в чат') };
    const mine = done && M.st === 'ok' ? `ты ответил верно${M.coins ? ` · +${M.coins}` : ''}` : done && M.st === 'bad' ? `твой ответ — мимо${M.hp ? ` · яд −${M.hp} ❤` : ''}` : '';
    const note = [puzzleTask(P), !done ? `ответили: ${+(P.an || 0)} · награда: ${P.prize === 'buff' ? 'враги следующего боя ослаблены' : `${+(P.coins || 0)} каждому верному`}` : mine].filter(Boolean).join(' · ');
    return { icon: P.icon || '🧩', title: `Головоломка · ${P.name}`, right: PUZZLE_ST[P.st] || '', until: done ? undefined : P.st === 'show' ? P.showUntil : P.until, urge, note: note || undefined,
      where: inParty ? undefined : 'отвечает только отряд', inParty };
  }
  if (q.ev) {
    const E = q.ev, I = eventInstructions(E, q.party), first = I.cmds[0];
    const urge: Card['urge'] = first ? { kind: first.kind, text: first.text } : undefined;
    return { icon: E.icon || '✦', title: String(E.name || 'Событие'), right: I.status, until: E.st === 'done' ? undefined : E.until, urge,
      note: [I.text, ...I.cmds.slice(1).map(c => c.text + (c.note ? ' — ' + c.note : ''))].filter(Boolean).join(' · '), inParty };
  }
  const V = q.dgn?.vote && !q.dgn.vote.done && q.dgn.vote.mode !== 'ring' ? q.dgn.vote : q.vote && !q.vote.done ? q.vote : null;
  if (V) {
    return { icon: '🗳', title: (q.dgn?.vote === V ? 'Данж · ' : '') + V.title, right: '', until: V.end, voteId: V.id,
      opts: (V.opts || []).map((o: any) => ({ n: +o[0], label: String(o[1]), votes: +o[3] || 0, my: V.my === o[0] })),
      urge: V.my ? { kind: 'ok', text: `твой голос: ${V.my}` } : { kind: 'say', text: 'номер варианта' }, inParty };
  }
  if (q.loot) return { icon: '🎁', title: `Делёж: ${q.loot.name}`, right: '', until: q.loot.until, urge: q.loot.my ? { kind: 'ok', text: 'твой голос учтён' } : { kind: 'info', text: 'Голосуй в чате, кому отдать вещь (номер, ник или «случайно»)' }, inParty };
  // 28.10 (quest.js gwName): the Halloween gather at the portal — join with «портал»
  const hwG = !!(q.gather && q.gather.hw);
  const urge: Card['urge'] = q.gather && !inParty ? { kind: 'say', text: hwG ? 'портал' : 'поход' } : undefined;
  return { icon: hwG ? '🎃' : '🗺', title: hwG ? `Сбор у портала${q.t ? ' · ' + q.t : ''}` : `${KIND_RU[q.k] || 'Поход'}${q.t ? ' · ' + q.t : ''}`, right: q.n ? `отряд ${q.n}` : '', until: q.gather?.until, inParty,
    where: inParty ? 'ты в отряде' : q.party === 'ghost' ? 'твой герой — призрак в этом походе' : q.party === 'q' ? 'ты в очереди в отряд' : 'ты не в отряде', urge };
}
function meIn(b: any, me: { login: string; role: string }) {
  const i = b.me, p = i >= 0 && b.form ? b.form[i] : null, f = !p && Array.isArray(b.mf) ? b.mf : null;
  const st = b.hp == null ? 'out' : b.hp === 0 ? 'dead' : b.hp < 0 ? 'fled' : i >= 0 || f ? 'on' : 'reserve';
  return { st, side: p ? p[2] || 'R' : f ? f[1] || 'R' : '', role: p ? p[1] : f ? f[0] : me.role || 'recruit' };
}

const CSS = `
:host{all:initial}
.q{z-index:120}
.q{position:fixed;right:18px;top:120px;width:380px;pointer-events:auto;font-family:'Golos Text','Nunito',sans-serif;color:#f5f2ff;
  background:linear-gradient(180deg,rgba(32,22,66,.92),rgba(18,12,40,.92));border:2px solid rgba(255,201,77,.55);border-radius:14px;
  box-shadow:0 10px 30px rgba(0,0,0,.5),inset 0 0 0 1px rgba(255,255,255,.06);overflow:hidden;transform-origin:top right;transition:transform .25s,opacity .25s}
.q{display:flex;flex-direction:column;max-height:calc(100vh - 136px)}.q .b{overflow-y:auto;min-height:0;flex:0 1 auto}.q .h,.q .sy{flex:none}
.q.hide{opacity:0;transform:scale(.96);pointer-events:none}
.q.min .b{display:none}
.h{display:flex;align-items:center;gap:8px;padding:9px 12px;background:linear-gradient(90deg,rgba(255,201,77,.18),transparent);border-bottom:1px solid rgba(255,201,77,.25);cursor:pointer}
.h i{font-style:normal;font-size:18px}.h b{flex:1;font:400 15px/1.2 'Russo One','Dela Gothic One',sans-serif;letter-spacing:.02em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.h span{font-size:12px;color:#d8d0f5;white-space:nowrap}.h span.hot{color:#ff7b7b;font-weight:800}
.b{padding:10px 12px 12px;display:grid;gap:8px}
.chip{display:inline-flex;gap:6px;align-items:center;font-size:12px;color:#cfc6ef}.chip::before{content:'';width:8px;height:8px;border-radius:50%;background:#888}
.chip.in::before{background:#4cc95a;box-shadow:0 0 8px #4cc95a}
.hp{height:8px;border-radius:4px;background:rgba(255,255,255,.12);overflow:hidden}.hp i{display:block;height:100%;background:linear-gradient(90deg,#e8455c,#ff8a5c)}
.u{border-radius:10px;padding:10px 12px;background:rgba(255,201,77,.1);border:1px solid rgba(255,201,77,.35)}
.u small{display:block;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#ffc94d;margin-bottom:6px}
.u .say{font:800 20px/1.1 'Golos Text',sans-serif;color:#ffe9a8;animation:pulse 1.4s ease-in-out infinite}
.u.silent{background:rgba(232,69,92,.16);border-color:#e8455c}.u.silent .say{color:#ff9aa8}
.u.ok{background:rgba(76,201,90,.12);border-color:rgba(76,201,90,.5)}.u.ok .say{color:#9fe39a;animation:none;font-size:15px}
.u.info .say{font-size:14px;font-weight:600;color:#f5f2ff;animation:none}
canvas.word{display:block;height:32px}
@keyframes pulse{50%{text-shadow:0 0 14px rgba(255,201,77,.8)}}
.opts{display:grid;gap:6px}.opt{position:relative;display:flex;gap:8px;align-items:center;padding:7px 10px;border-radius:8px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.1);
  color:inherit;font:600 13px 'Golos Text',sans-serif;text-align:left;cursor:pointer;overflow:hidden}
.opt b{color:#ffc94d;min-width:18px}.opt em{margin-left:auto;font-style:normal;color:#cfc6ef;font-size:12px}
.opt i{position:absolute;inset:0 auto 0 0;background:rgba(255,201,77,.14);z-index:-1}.opt.my{border-color:#4cc95a}
.opt:hover{background:rgba(255,255,255,.12)}
.note{font-size:12px;color:#e4dafb;line-height:1.45;margin:6px 0;white-space:pre-wrap}
.f{display:flex;justify-content:space-between;align-items:center;font-size:11px;color:#a99fd0}
.f button{all:unset;cursor:pointer;color:#ffe9a8;padding:2px 6px;border-radius:6px;border:1px solid rgba(255,201,77,.35)}
.f button:hover{background:rgba(255,201,77,.15)}
.v3d{all:unset;display:flex;align-items:center;justify-content:center;gap:8px;padding:8px 10px;border-radius:10px;cursor:pointer;font:800 14px 'Golos Text',sans-serif;
  color:#2a1606;background:linear-gradient(180deg,#ffe27a,#ffc94d);box-shadow:0 0 0 2px rgba(58,36,16,.5),0 4px 14px rgba(255,201,77,.35);animation:glow 1.8s ease-in-out infinite}
.v3d.on{background:rgba(255,255,255,.1);color:#ffe9a8;box-shadow:inset 0 0 0 1px rgba(255,201,77,.45);animation:none}
.v3d kbd{font:800 12px 'Golos Text',sans-serif;padding:1px 6px;border-radius:5px;background:rgba(42,22,6,.18)}
@keyframes glow{50%{box-shadow:0 0 0 2px rgba(58,36,16,.5),0 4px 22px rgba(255,201,77,.75)}}
.sq{display:grid;gap:6px}
.sqb{all:unset;display:flex;align-items:center;justify-content:center;gap:6px;padding:8px 10px;border-radius:10px;cursor:pointer;font:800 14px 'Golos Text',sans-serif;
  color:#2a1606;background:linear-gradient(180deg,#9fe39a,#4cc95a);box-shadow:0 0 0 2px rgba(20,60,20,.5)}
.sqb.leave{color:#ffd0d8;background:rgba(232,69,92,.16);box-shadow:inset 0 0 0 1px rgba(232,69,92,.7)}
.sqb.arm{color:#fff;background:linear-gradient(180deg,#ff7b8a,#e8455c);box-shadow:0 0 0 2px rgba(80,10,20,.6);animation:glow 1s ease-in-out infinite}
.sqb[disabled]{opacity:.55;cursor:default;animation:none}
.sqn{font-size:12px;color:#cfc6ef}.sqn.ok{color:#9fe39a}.sqn.wait{color:#ffe9a8}.sqn.bad{color:#ff9aa8}
.cmd{display:grid;gap:6px}
.cmd .gt{font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:#cfc6ef}
.cmd .row{display:flex;flex-wrap:wrap;gap:6px}
.cmd .row.pad{display:grid;grid-template-columns:repeat(5,1fr)}
.sb{all:unset;position:relative;box-sizing:border-box;display:inline-flex;flex-direction:column;align-items:center;justify-content:center;gap:1px;min-height:34px;padding:6px 11px;border-radius:9px;cursor:pointer;
  font:700 13px/1.15 'Golos Text',sans-serif;color:#f5f2ff;background:rgba(255,255,255,.08);box-shadow:inset 0 0 0 1px rgba(255,255,255,.18);text-align:center}
.sb:hover{background:rgba(255,255,255,.16)}.sb:focus-visible{outline:2px solid #ffc94d;outline-offset:2px}
.sb small{font:600 11px 'Golos Text',sans-serif;color:#d8d0f5}
.sb.big{flex:1 1 40%;min-height:40px;font-size:14px}
.sb.main{color:#2a1606;background:linear-gradient(180deg,#ffe27a,#ffc94d);box-shadow:0 0 0 2px rgba(58,36,16,.45)}.sb.main small{color:#5a3a12}
.sb.warn{color:#ffd0d8;background:rgba(232,69,92,.16);box-shadow:inset 0 0 0 1px rgba(232,69,92,.7)}
.sb.urge{color:#fff;background:linear-gradient(180deg,#ff7b8a,#e8455c);animation:glow 1s ease-in-out infinite}
.sb.on,.sb[aria-pressed="true"]{box-shadow:inset 0 0 0 2px #ffc94d;background:rgba(255,201,77,.22);color:#ffe9a8}
.sb.wait{box-shadow:inset 0 0 0 2px #ffe9a8;background:transparent;color:#ffe9a8}
.sb.ok{color:#0f2a10;background:linear-gradient(180deg,#b6f0b0,#4cc95a);box-shadow:none}
.sb.bad{color:#fff;background:#e8455c;box-shadow:none}
.sb[disabled]{opacity:.62;cursor:default;animation:none}.sb.ok[disabled]{opacity:.9}
.sb kbd{position:absolute;top:-6px;left:-6px;min-width:15px;height:15px;border-radius:5px;background:#2a1606;color:#ffe9a8;font:800 10px/15px 'Golos Text',sans-serif;text-align:center;box-shadow:0 0 0 1px rgba(255,201,77,.6)}
.cmd .row.pad .sb{padding:6px 0}
.sst{margin:0;font-size:12.5px;line-height:1.35;padding:5px 9px;border-radius:8px;background:rgba(255,255,255,.06)}
.sst.ok{color:#9fe39a;background:rgba(76,201,90,.12)}.sst.wait{color:#ffe9a8;background:rgba(255,201,77,.1)}.sst.bad{color:#ff9aa8;background:rgba(232,69,92,.14)}.sst.warn{color:#fff;background:rgba(232,69,92,.3)}
.sdp{font:700 14px 'Golos Text',sans-serif;color:#ffe9a8;letter-spacing:.04em}
.shint{font-size:11.5px;color:#a99fd0}
.chips{display:flex;flex-wrap:wrap;gap:6px}
.chipc{all:unset;cursor:copy;padding:4px 10px;border-radius:999px;font:800 17px 'Golos Text',sans-serif;color:#ffe9a8;background:rgba(255,201,77,.14);box-shadow:inset 0 0 0 1px rgba(255,201,77,.5)}
.chipc::after{content:' ⧉';font-size:12px;opacity:.7}
.chipc:hover{background:rgba(255,201,77,.28)}.chipc:focus-visible{outline:2px solid #ffc94d}
.u em{display:block;margin-top:6px;font-style:normal;font-size:12px;color:#d8d0f5}
.sy{padding:0 12px 12px;display:grid;gap:6px}.sy[hidden]{display:none}.q.min .sy{display:none}
.syf{display:flex;gap:6px;align-items:center}
.syl{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}
.syf input{all:unset;flex:1;min-width:0;box-sizing:border-box;padding:8px 10px;border-radius:9px;font:600 14px 'Golos Text',sans-serif;color:#fff;background:rgba(0,0,0,.35);box-shadow:inset 0 0 0 1px rgba(255,201,77,.45)}
.syf input:focus{box-shadow:inset 0 0 0 2px #ffc94d}.syf input::placeholder{color:#9b91c4}
.syf button{all:unset;cursor:pointer;width:36px;height:36px;border-radius:9px;text-align:center;font:800 16px/36px 'Golos Text',sans-serif;color:#2a1606;background:linear-gradient(180deg,#ffe27a,#ffc94d)}
.syf button.busy{opacity:.55}
.syt{font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:#ffc94d}
.syh{list-style:none;margin:0;padding:0;display:grid;gap:3px}
.syh li{display:flex;gap:8px;justify-content:space-between;font-size:12px;color:#cfc6ef}.syh li b{color:#f5f2ff;font-weight:700}
.syh li.ok span{color:#9fe39a}.syh li.no span{color:#ff9aa8}.syh li.wait span{color:#ffe9a8}.syh li.note{color:#ffe9a8}
.syn{margin:0;font-size:11.5px;color:#b9b0de}
.syw{margin:0;font-size:12px;font-weight:700;color:#fff;background:rgba(232,69,92,.35);padding:5px 9px;border-radius:8px}.syw[hidden]{display:none}
.lock{position:fixed;left:50%;top:14px;transform:translateX(-50%);padding:8px 16px;border-radius:999px;background:rgba(18,12,40,.9);border:1px solid rgba(255,201,77,.5);
  font:600 13px 'Golos Text',sans-serif;color:#ffe9a8;pointer-events:none}
`;

export const mountQuestHud: MountQuestHud = (root, host): QuestHud => {
  const box = document.createElement('div'); box.className = 'l3d-quest'; box.style.cssText = 'position:fixed;inset:0;z-index:140;pointer-events:none;';
  root.appendChild(box);
  const sh = box.attachShadow({ mode: 'open' });
  sh.innerHTML = `<style>${CSS}</style><div class="q hide" role="status" aria-live="polite"><div class="h"><i></i><b></b><span></span></div><div class="b"></div><div class="sy" hidden></div></div><div class="lock" hidden>Вы в походе — следите за ним здесь</div>`;
  const el = sh.querySelector('.q') as HTMLElement, H = sh.querySelector('.h') as HTMLElement, B = sh.querySelector('.b') as HTMLElement, lock = sh.querySelector('.lock') as HTMLElement;
  const SY = sh.querySelector('.sy') as HTMLElement;
  // 3D expedition view (src/features/expedition.ts): «Смотреть в 3D [Q]» while the expedition runs
  // v3dFixed: the expedition-only boot (detail.expOnly) — the 3D view is the whole page, there is nothing to leave to
  let v3d = false, v3dOn = false, v3dFixed = false;
  const onV3d = (e: Event) => { const d = (e as CustomEvent).detail || {}; v3d = !!d.active; v3dOn = !!d.onAir; v3dFixed = !!d.expOnly; key = ''; tick(); };
  window.addEventListener('l3d:expedition', onV3d);
  let min = false; try { min = localStorage.getItem('l3d.qmin') === '1'; } catch { /* */ }
  H.onclick = () => { min = !min; el.classList.toggle('min', min); try { localStorage.setItem('l3d.qmin', min ? '1' : '0'); } catch { /* */ } };
  el.classList.toggle('min', min);

  const W = window as any;

  /* ---- the site's own quest tab: buttons (pressed) and «Команда в поход» (typed), src/quest/siteui.ts ---- */
  const siteTab = () => document.getElementById('tab-quest');
  let site: SiteControls = readSite(null), qa = false, primedAt = 0, hot: SiteBtn[] = [], voteHot: { n: number; vid: number; label: string }[] = [];
  // the site paints its tab only while «shown» (its tab switch): ask it to paint behind the 3D view; a site tab switch resets that
  const ensurePainted = (force = false) => {
    const tab = siteTab(); if (!tab) return;
    if (force || !primedAt || (!site.painted && Date.now() - primedAt > 3000)) { if (primeSite(W, tab)) primedAt = Date.now(); }
  };
  const onSiteTab = (e: Event) => { const t = e.target as Element | null; if (t && t.closest && t.closest('.tabs button')) primedAt = 0; };
  document.addEventListener('click', onSiteTab, true);
  const pressKey = (key: string, label: string) => {
    let r = pressSite(siteTab(), key);
    if (r === 'missing') { ensurePainted(true); r = pressSite(siteTab(), key); }
    if (r === 'missing') { host.actions.openSitePanel('quest'); host.toast(`Открыл вкладку «Поход» сайта — нажми там «${label}»`); }
    key = ''; tick();
  };
  const copyChip = (t: string) => {
    const done = () => host.toast(`Скопировано «${t}» — вставь в чат стрима`);
    try { const p = navigator.clipboard?.writeText(t); if (p) p.then(done, () => host.toast(`Напиши в чат стрима: ${t}`)); else host.toast(`Напиши в чат стрима: ${t}`); }
    catch { host.toast(`Напиши в чат стрима: ${t}`); }
  };
  // the command line: built once (typing and focus survive the card's repaints); fed into the site's own line
  SY.innerHTML = `<div class="syt">Команда в поход</div><p class="syw" role="alert" hidden></p><ol class="syh" aria-live="polite" aria-label="Твои последние строки и нажатия"></ol>`
    + `<form class="syf" autocomplete="off"><label class="syl" for="l3dQSay">Команда в поход</label><input id="l3dQSay" type="text" maxlength="100" enterkeyhint="send" autocapitalize="off" autocorrect="off" spellcheck="false" placeholder="Команда в поход"><button type="submit" aria-label="Отправить">➤</button></form><p class="syn"></p>`;
  const sIn = SY.querySelector('input') as HTMLInputElement, sForm = SY.querySelector('form') as HTMLFormElement, sBtn = SY.querySelector('button') as HTMLButtonElement;
  const recall: string[] = []; let ri = -1, keyS = '';
  // the site's rule (streamer's decision): words are typed by hand — no paste, no drop
  const noPaste = (e: Event) => { e.preventDefault(); host.toast('Вставлять нельзя — напечатай сам', true); };
  sIn.addEventListener('paste', noPaste); sIn.addEventListener('drop', noPaste);
  sIn.addEventListener('beforeinput', (e) => { if (/^insertFrom(Paste|Drop|PasteAsQuotation)$/.test((e as InputEvent).inputType || '')) noPaste(e); });
  const stopKeys = (e: KeyboardEvent) => {
    e.stopPropagation();   // the game must not walk / open menus while typing here (the shadow root hides the input from isTyping)
    if (e.type !== 'keydown') return;
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      if (!recall.length) return; e.preventDefault();
      ri = e.key === 'ArrowUp' ? Math.min(recall.length - 1, ri + 1) : Math.max(-1, ri - 1);
      sIn.value = ri < 0 ? '' : recall[ri];
    } else if (e.key === 'Escape') { sIn.value = ''; ri = -1; sIn.blur(); }
  };
  sIn.addEventListener('keydown', stopKeys); sIn.addEventListener('keyup', stopKeys); sIn.addEventListener('keypress', stopKeys);
  sForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const line = sIn.value.replace(/\s+/g, ' ').trim().slice(0, 100); if (!line) return;
    let r = feedSiteSay(siteTab(), line);
    if (r === 'missing') { ensurePainted(true); r = feedSiteSay(siteTab(), line); }
    if (r === 'sent') { sIn.value = ''; ri = -1; if (recall[0] !== line) { recall.unshift(line); if (recall.length > 8) recall.pop(); } }
    else if (r === 'missing') { host.actions.openSitePanel('quest'); host.toast('Строки команд на сайте сейчас нет — открыл вкладку «Поход»', true); }
    key = ''; keyS = ''; tick();
  });
  const sayPaint = (show: boolean) => {
    const S = site.say;
    const k = show ? JSON.stringify([S, site.hist]) : '-';
    if (k === keyS) return; keyS = k;
    SY.hidden = !show; if (!show) return;
    sIn.placeholder = S?.placeholder || 'Команда в поход: удар, лечить, 2…';
    (SY.querySelector('.syt') as HTMLElement).textContent = S?.label || 'Команда в поход';
    (SY.querySelector('.syn') as HTMLElement).textContent = S?.hint || 'Как сообщение в чат Twitch, только видит его одна игра. Enter — отправить, ↑ — прошлое.';
    const w = SY.querySelector('.syw') as HTMLElement; w.hidden = !S?.warn; w.textContent = S?.warn || '';
    sBtn.classList.toggle('busy', !!S?.busy);
    (SY.querySelector('.syh') as HTMLElement).innerHTML = site.hist.map((x) => x.st === 'note' ? `<li class="note">${esc(x.msg)}</li>` : `<li class="${x.st}"><b>${x.btn ? '▸ ' : ''}${esc(x.line)}</b><span>${esc(x.st === 'wait' ? 'в пути…' : x.msg)}</span></li>`).join('');
  };
  const btnHtml = (b: SiteBtn) => {
    const n = hot.indexOf(b);
    return `<button type="button" class="sb ${b.cls.join(' ')}" data-sk="${esc(b.key)}"${b.pressed != null ? ` aria-pressed="${b.pressed}"` : ''}${b.disabled ? ' disabled' : ''}${b.tip ? ` title="${esc(b.tip)}"` : ''}>${n >= 0 ? `<kbd>${n + 1}</kbd>` : ''}${esc(b.label)}${b.sub ? `<small>${esc(b.sub)}</small>` : ''}</button>`;
  };
  const siteHtml = (S: SiteControls) => {
    if (!S.groups.length && !S.lines.length && !S.displays.length) return '';
    let h = '<div class="cmd" role="group" aria-label="Кнопки похода (как на сайте)">';
    h += S.lines.map((l) => `<p class="sst ${l.cls}" role="status">${esc(l.text)}</p>`).join('');
    h += S.displays.map((d) => `<div class="sdp" aria-live="polite">${esc(d)}</div>`).join('');
    if (S.hint) h += `<div class="shint">${esc(S.hint)}</div>`;   // the site's own words, as it shows them: above the buttons
    for (const g of S.groups) h += `${g.title ? `<div class="gt">${esc(g.title)}</div>` : ''}<div class="row ${g.kind}">${g.btns.map(btnHtml).join('')}</div>`;
    return h + '</div>';
  };
  // number keys 1–4: the first buttons (or the path vote options) — only when not typing and the mouse is free (not aiming)
  const onKey = (e: KeyboardEvent) => {
    if (e.repeat || e.ctrlKey || e.altKey || e.metaKey || e.shiftKey) return;
    const m = /^(?:Digit|Numpad)([1-4])$/.exec(e.code); if (!m) return;
    const t0 = (e.composedPath?.()[0] || e.target) as HTMLElement | null;
    if (t0 && (t0.tagName === 'INPUT' || t0.tagName === 'TEXTAREA' || t0.tagName === 'SELECT' || t0.isContentEditable)) return;
    if (document.pointerLockElement || el.classList.contains('hide') || el.classList.contains('min')) return;
    const i = +m[1] - 1;
    if (hot.length) { const b = hot[i]; if (!b) return; e.preventDefault(); pressKey(b.key, b.label); return; }
    const o = voteHot[i]; if (!o) return; e.preventDefault(); pressKey(`qv:${o.vid}:${o.n}`, `${o.n}. ${o.label}`);
  };
  window.addEventListener('keydown', onKey);

  const baseCmd = (r: string) => { try { return W.LGGameData?.baseCmd?.(r) || 'удар'; } catch { return 'удар'; } };
  const adj = () => { try { return Math.max(-10, Math.min(30, +(localStorage.getItem(ADJ_KEY) || 0) || 0)); } catch { return 0; } };
  // stream-delay buffer: show each view when its time + delay has come
  const buf: { at: number; v: QuestView }[] = [];
  let shown: QuestView | null = null, key = '';
  const onQuest = () => { const v = host.store.quest; if (!v) return; buf.push({ at: Date.now(), v }); if (buf.length > 80) buf.shift(); };
  const unsub = host.store.on('quest', onQuest); onQuest();

  const wordCanvas = (text: string) => {
    const c = document.createElement('canvas'); c.className = 'word';
    const dpr = Math.min(2, devicePixelRatio || 1), ctx = c.getContext('2d')!;
    ctx.font = "800 22px 'Golos Text', sans-serif"; const w = Math.ceil(ctx.measureText(text).width) + 8;
    c.width = w * dpr; c.height = 32 * dpr; c.style.width = w + 'px';
    ctx.scale(dpr, dpr); ctx.font = "800 22px 'Golos Text', sans-serif"; ctx.fillStyle = '#ffe9a8'; ctx.textBaseline = 'middle'; ctx.fillText(text, 4, 17);
    return c;
  };
  // join / leave: the site's own button is pressed (never a request of ours); leave needs a second press within 4 s (as the site)
  let arm = 0, armT = 0;
  let pend: { k: 'join' | 'leave'; at: number } | null = null, done: { text: string; ok: boolean; at: number } | null = null;
  const squadHtml = (sq: Squad | null): string => {
    const line = pend ? `<div class="sqn wait" role="status">отправлено: ${pend.k === 'join' ? 'вступить в поход' : 'покинуть отряд'}…</div>`
      : done ? `<div class="sqn ${done.ok ? 'ok' : 'bad'}" role="status">${esc(done.text)}</div>` : '';
    if (!sq) return line ? `<div class="sq">${line}</div>` : '';
    if (sq.kind === 'info') return `<div class="sq">${line}<div class="sqn">${esc(sq.text)}</div></div>`;
    const armed = sq.kind === 'leave' && arm && Date.now() - arm < 4000;
    const label = armed ? 'Нажми ещё раз, чтобы покинуть отряд' : sq.label;
    return `<div class="sq">${line}<button type="button" class="sqb ${sq.kind}${armed ? ' arm' : ''}" data-sq="${sq.kind}"${pend ? ' disabled' : ''}>${esc(label)}</button>${sq.kind === 'join' && sq.note ? `<div class="sqn">${esc(sq.note)}</div>` : ''}</div>`;
  };
  const squadClick = (k: 'join' | 'leave') => {
    if (pend) return;
    if (k === 'leave' && !(arm && Date.now() - arm < 4000)) {
      arm = Date.now(); clearTimeout(armT); armT = window.setTimeout(() => { arm = 0; key = ''; tick(); }, 4050); key = ''; tick(); return;
    }
    arm = 0; clearTimeout(armT);
    if (!siteSquadButton(document, k)) ensurePainted(true);   // the site paints its tab only while shown
    const r = pressSiteSquad(document, k, () => host.actions.openSitePanel('quest'));
    if (r === 'clicked') { pend = { k, at: Date.now() }; done = null; }
    else host.toast('Открыл вкладку «Поход» сайта — нажми там «' + (k === 'join' ? 'Вступить в поход' : 'Покинуть отряд') + '»');
    key = ''; tick();
  };
  /** the result of the press, from the next own view (party in / q / out), like the site's partyOf */
  const squadState = (party: unknown) => {
    const now = Date.now();
    if (pend) {
      const p = party === 'in' || party === 'q' || party === 'ghost' ? party : 'out';
      if (pend.k === 'join' && (p === 'in' || p === 'q')) { done = { text: p === 'in' ? 'принято: ты в отряде' : 'принято: ты в очереди — вступишь на остановке', ok: true, at: now }; pend = null; }
      else if (pend.k === 'leave' && p === 'out') { done = { text: 'принято: ты покинул отряд', ok: true, at: now }; pend = null; }
      else if (now - pend.at > 30000) { done = { text: 'ответа нет — посмотри вкладку «Поход» сайта', ok: false, at: now }; pend = null; }
    }
    if (done && now - done.at > 8000) done = null;
  };
  const render = (c: Card | null) => {
    el.classList.toggle('hide', !c);
    if (!c) return;
    (H.children[0] as HTMLElement).textContent = c.icon; (H.children[1] as HTMLElement).textContent = c.title;
    let h = '';
    if ((v3dOn || v3d) && !v3dFixed) h += `<button type="button" class="v3d${v3d ? ' on' : ''}" data-v3d>${v3d ? 'Выйти из 3D-похода' : c.empty ? '🎥 Сбор окончен — смотреть в 3D' : '🎥 Поход идёт — смотреть в 3D'} <kbd>Q</kbd></button>`;
    if (c.where) h += `<div class="chip ${c.inParty ? 'in' : ''}">${esc(c.where)}</div>`;
    if (c.hp != null && c.hp >= 0) h += `<div class="hp"><i style="width:${Math.max(2, Math.round(c.hp * 100))}%"></i></div>`;
    // typed commands: with the site's flag — the line below (the site's own «Команда в поход»); without it — the stream chat
    const S = site, btns = qa && (S.groups.length > 0 || !!(c.opts?.length && c.inParty));   // the path vote: its options are buttons
    if (c.urge) {
      const lab = c.urge.kind === 'say' ? (qa ? (btns ? 'Жми кнопку — или напечатай в строке команд' : 'Напечатай в строке команд (или в чат)') : 'Пиши в чат стрима')
        : c.urge.kind === 'word' ? (qa ? 'Напечатай в строке команд слово' : 'Пиши в чат стрима слово') : c.urge.kind === 'silent' ? 'Внимание' : c.urge.kind === 'ok' ? 'Готово' : 'Что происходит';
      const chips = c.urge.kind === 'say' && !qa ? chatChips(c.urge.text) : [];
      const body = chips.length ? `<div class="chips">${chips.map((t) => `<button type="button" class="chipc" data-copy="${esc(t)}" title="Скопировать">${esc(t)}</button>`).join('')}</div><em>нажми — скопируется, вставь в чат стрима (кнопок похода сайт тебе не показывает)</em>`
        : `<div class="say">${c.urge.kind === 'word' ? '' : esc(c.urge.kind === 'say' ? '«' + c.urge.text + '»' : c.urge.text)}</div>`;
      // the site's buttons ARE the commands now: no second «what to type» box (it would repeat or contradict the pressed one)
      if (!(c.urge.kind === 'say' && btns)) h += `<div class="u ${c.urge.kind}"><small>${lab}</small>${body}</div>`;
    }
    if (qa) h += siteHtml(S);
    if (c.opts?.length) {
      const tot = c.opts.reduce((s, o) => s + o.votes, 0) || 1;
      h += `<div class="opts">${c.opts.map((o) => `<button type="button" class="opt${o.my ? ' my' : ''}" data-n="${o.n}"><i style="width:${Math.round(o.votes / tot * 100)}%"></i><b>${o.n}</b>${esc(o.label)}<em>${o.votes}</em></button>`).join('')}</div>`;
      if (!c.inParty) h += `<div class="shint">Голосует отряд: номер — в чат стрима</div>`;
    }
    if (c.note) h += `<div class="note">${esc(c.note)}</div>`;
    h += squadHtml(c.squad || null);
    h += `<div class="f"><span>как на стриме · <b class="dl"></b> с <button data-adj="-1">−</button> <button data-adj="1">+</button></span><button data-full>Поход полностью ↗</button></div>`;
    B.innerHTML = h;
    if (c.urge?.kind === 'word') B.querySelector('.u .say')!.appendChild(wordCanvas(c.urge.text));
    // the path vote: the site's own option button ([data-qv] → its X.vote, the same as the number in chat)
    B.querySelectorAll<HTMLButtonElement>('.opt').forEach((b) => b.onclick = () => {
      if (!c.inParty || c.voteId == null) { host.toast('Голосовать кнопкой можно только в отряде — пиши номер в чат', true); return; }
      pressKey(`qv:${c.voteId}:${+b.dataset.n!}`, `${b.dataset.n}`);
    });
    B.querySelectorAll<HTMLButtonElement>('.sb').forEach((b) => b.onclick = () => { const k = b.dataset.sk!; const sb = hot.find((x) => x.key === k); pressKey(k, sb ? sb.label : (b.textContent || '').trim()); });
    B.querySelectorAll<HTMLButtonElement>('.chipc').forEach((b) => b.onclick = () => copyChip(b.dataset.copy || ''));
    B.querySelectorAll<HTMLButtonElement>('[data-adj]').forEach((b) => b.onclick = () => { try { localStorage.setItem(ADJ_KEY, String(Math.max(-10, Math.min(30, adj() + +b.dataset.adj!)))); } catch { /* */ } });
    (B.querySelector('[data-full]') as HTMLButtonElement).onclick = () => host.actions.openSitePanel('quest');
    const sb = B.querySelector('[data-sq]') as HTMLButtonElement | null;
    if (sb) sb.onclick = () => squadClick(sb.dataset.sq as 'join' | 'leave');
    const vb = B.querySelector('[data-v3d]') as HTMLButtonElement | null;
    if (vb) vb.onclick = () => window.dispatchEvent(new CustomEvent('l3d:expedition-toggle'));
  };
  const tick = () => {
    const dl = Math.max(0, ((buf[buf.length - 1]?.v as any)?.dl || 0) + adj()) * 1000, now = Date.now();
    while (buf.length && buf[0].at + dl <= now) { shown = buf.shift()!.v; }
    const me = { login: String(host.store.me?.login || ''), role: String(host.store.hero?.role || 'recruit') };
    const newest = host.store.quest;
    const merged = shown && newest ? mergeOwn(shown as QuestPayload, newest as QuestPayload, now, adj(), buf.map(r => r.v as QuestPayload)) : shown;
    // own party is not stream-delayed on the site either (quest.js partyOf): the chip, the «поход» hint and the button agree
    const party = (newest as any)?.party ?? (merged as any)?.party;
    const c = cardOf(merged && (merged as any).on ? ({ ...merged, party } as QuestView) : merged, me, baseCmd, newest);
    squadState(party);
    if (c) c.squad = squadOf(merged, party);
    // the site's flag and what its own tab offers now (read back from its DOM, painted behind the 3D view)
    qa = siteQaOn(host.store.hero);
    if (c && !c.empty) { ensurePainted(); site = readSite(siteTab()); } else { site = readSite(null); if (!c) primedAt = 0; }
    hot = qa ? hotButtons(site) : [];
    voteHot = c?.opts && c.inParty && c.voteId != null ? c.opts.slice(0, 4).map((o) => ({ n: o.n, vid: c.voteId!, label: o.label })) : [];
    sayPaint(!!(c && !c.empty && qa));
    const k = JSON.stringify(c) + (qa ? JSON.stringify([site.groups, site.lines, site.displays, site.hint]) : '') + (v3d ? '|3d' : v3dOn ? '|on' : '') + (v3dFixed ? '|fixed' : '') + `|${pend ? pend.k : ''}|${done ? done.text : ''}|${arm ? 1 : 0}`;
    if (k !== key) { key = k; render(c); }
    const sp = H.children[2] as HTMLElement;
    if (c?.until) { const s = Math.max(0, Math.ceil((c.until + dl - now) / 1000)); sp.textContent = `${c.right ? c.right + ' · ' : ''}${s} с`; sp.classList.toggle('hot', s <= 5); }
    else { sp.textContent = c?.right || ''; sp.classList.remove('hot'); }
    const dlEl = B.querySelector('.dl'); if (dlEl) dlEl.textContent = String(Math.round(dl / 1000));
    lock.hidden = v3d || !(shown && (shown as any).on && (shown as any).party === 'in');
  };
  const iv = window.setInterval(tick, 250); tick();
  return { el: box, dispose() { clearInterval(iv); clearTimeout(armT); unsub(); window.removeEventListener('l3d:expedition', onV3d); window.removeEventListener('keydown', onKey); document.removeEventListener('click', onSiteTab, true); box.remove(); } };
};
