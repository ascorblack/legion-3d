/**
 * Expedition («Поход») HUD: a card on the right side that tells what is happening and what to type in chat.
 * Data: SSE `q` (store.quest), shown with the stream delay like the site does (docs/GAME-DESIGN.md §7).
 * Fair play: never sends anything by itself; reaction words are drawn on a canvas (not copyable).
 */
import type { Store, Actions, QuestView } from '../contracts';
import type { MountQuestHud, QuestHud } from '../contracts/modules';

const KIND_RU: Record<string, string> = { battle: 'Бой', trap: 'Ловушка', treasure: 'Сокровищница', lair: 'Логово', rest: 'Привал', shop: 'Лавка', event: 'Событие', map: 'Карта', travel: 'В пути', town: 'Город', gather: 'Сбор отряда', boss: 'Босс', dungeon: 'Данж', bossgen: 'Босс' };
const SIDE_RU: Record<string, string> = { L: 'левое крыло', R: 'правое крыло', F: 'дальнее крыло' };
const SIDE_CMD: Record<string, string> = { L: 'лево', R: 'право', F: 'вдали' };
const ADJ_KEY = 'lgQDelay';

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

export interface Card {
  icon: string; title: string; right: string;   // right: may contain {until:ms} marker → seconds
  until?: number; where?: string; hp?: number | null; urge?: { kind: 'say' | 'word' | 'silent' | 'ok' | 'info'; text: string };
  note?: string; opts?: { n: number; label: string; votes: number; my?: boolean }[]; voteId?: number; inParty: boolean;
}

/** Pure: QuestView (+ own login/role) → what to show. Exported for tests. */
export function cardOf(v: QuestView | null, me: { login: string; role: string }, baseCmd: (role: string) => string): Card | null {
  if (!v || !v.on) return null;
  const q = v as any, inParty = q.party === 'in';
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
    return { icon: '🏝', title: 'Закхуэль · острова', right: I.pick ? 'выбор острова' : I.doom ? 'какой остров уничтожить' : 'острова', until: I.pick?.until || I.doom?.until,
      urge: my ? { kind: 'ok', text: `ты на острове ${my}` } : I.pick ? { kind: 'say', text: '1–4' } : undefined, hp: q.lair.hp, inParty };
  }
  if (q.bg) {
    const g = q.bg, M = g.mech;
    let urge: Card['urge'];
    if (M) urge = M.fake ? { kind: 'silent', text: 'ФИНТ — не пиши!' } : M.fam === 'silence' ? { kind: 'silent', text: 'Тишина: молчи' } : M.me ? { kind: M.how ? 'word' : 'info', text: M.how || M.tip || 'Цель — ты!' } : M.how || M.word ? { kind: 'word', text: String(M.how || M.word) } : { kind: 'info', text: M.name };
    else if (g.st === 'party') urge = g.acted ? { kind: 'ok', text: 'ход сделан' } : { kind: 'say', text: baseCmd(me.role) || 'удар' };
    return { icon: '👹', title: `${g.name} · фаза ${g.ph} из ${g.phs}`, right: M?.until ? '' : `босс ${Math.round((g.hp || 0) * 100)}%`, until: M?.until, where: g.in ? (g.my > 0 ? 'ты в бою' : 'твой герой пал') : 'ты не в этом бою', hp: g.in ? g.my : null, urge, note: M && M.name ? M.name : undefined, inParty };
  }
  if (q.tr) {
    const T = q.tr, act = T.st === 'act';
    const urge: Card['urge'] = T.res ? { kind: 'info', text: T.res.text || 'итог ловушки' } : act && T.gas ? (T.acted ? { kind: 'info', text: 'ты написал — вдохнул газ' } : { kind: 'silent', text: 'Не пиши в чат!' })
      : act && T.word ? (T.acted ? { kind: 'ok', text: 'слово принято' } : { kind: 'word', text: String(T.word) }) : act && T.how ? { kind: 'info', text: String(T.how) } : undefined;
    return { icon: T.icon || '🪤', title: String(T.name || 'Ловушка'), right: '', until: act ? T.until : undefined, urge, inParty };
  }
  if (q.ev) {
    const E = q.ev, vote = E.look === 'traveler' && E.st === 'vote';
    const urge: Card['urge'] = E.res && E.st === 'done' ? { kind: 'info', text: E.res.text } : vote ? (E.my ? { kind: 'ok', text: `твой выбор: ${E.my === 'rob' ? 'обобрать' : 'помочь'}` } : { kind: 'say', text: 'помочь / обобрать' }) : E.cmds?.[0] ? { kind: 'say', text: String(E.cmds[0][0]) } : undefined;
    return { icon: E.icon || '✦', title: String(E.name || 'Событие'), right: '', until: vote ? E.until : undefined, urge, inParty };
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
.f{display:flex;justify-content:space-between;align-items:center;font-size:11px;color:#a99fd0}
.f button{all:unset;cursor:pointer;color:#ffe9a8;padding:2px 6px;border-radius:6px;border:1px solid rgba(255,201,77,.35)}
.f button:hover{background:rgba(255,201,77,.15)}
.v3d{all:unset;display:flex;align-items:center;justify-content:center;gap:8px;padding:8px 10px;border-radius:10px;cursor:pointer;font:800 14px 'Golos Text',sans-serif;
  color:#2a1606;background:linear-gradient(180deg,#ffe27a,#ffc94d);box-shadow:0 0 0 2px rgba(58,36,16,.5),0 4px 14px rgba(255,201,77,.35);animation:glow 1.8s ease-in-out infinite}
.v3d.on{background:rgba(255,255,255,.1);color:#ffe9a8;box-shadow:inset 0 0 0 1px rgba(255,201,77,.45);animation:none}
.v3d kbd{font:800 12px 'Golos Text',sans-serif;padding:1px 6px;border-radius:5px;background:rgba(42,22,6,.18)}
@keyframes glow{50%{box-shadow:0 0 0 2px rgba(58,36,16,.5),0 4px 22px rgba(255,201,77,.75)}}
.lock{position:fixed;left:50%;top:14px;transform:translateX(-50%);padding:8px 16px;border-radius:999px;background:rgba(18,12,40,.9);border:1px solid rgba(255,201,77,.5);
  font:600 13px 'Golos Text',sans-serif;color:#ffe9a8;pointer-events:none}
`;

export const mountQuestHud: MountQuestHud = (root, host): QuestHud => {
  const box = document.createElement('div'); box.className = 'l3d-quest'; box.style.cssText = 'position:fixed;inset:0;z-index:140;pointer-events:none;';
  root.appendChild(box);
  const sh = box.attachShadow({ mode: 'open' });
  sh.innerHTML = `<style>${CSS}</style><div class="q hide" role="status" aria-live="polite"><div class="h"><i></i><b></b><span></span></div><div class="b"></div></div><div class="lock" hidden>Вы в походе — следите за ним здесь</div>`;
  const el = sh.querySelector('.q') as HTMLElement, H = sh.querySelector('.h') as HTMLElement, B = sh.querySelector('.b') as HTMLElement, lock = sh.querySelector('.lock') as HTMLElement;
  // 3D expedition view (src/features/expedition.ts): «Смотреть в 3D [Q]» while the expedition runs
  let v3d = false, v3dOn = false;
  const onV3d = (e: Event) => { const d = (e as CustomEvent).detail || {}; v3d = !!d.active; v3dOn = !!d.onAir; key = ''; tick(); };
  window.addEventListener('l3d:expedition', onV3d);
  let min = false; try { min = localStorage.getItem('l3d.qmin') === '1'; } catch { /* */ }
  H.onclick = () => { min = !min; el.classList.toggle('min', min); try { localStorage.setItem('l3d.qmin', min ? '1' : '0'); } catch { /* */ } };
  el.classList.toggle('min', min);

  const W = window as any;
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
  const render = (c: Card | null) => {
    el.classList.toggle('hide', !c);
    if (!c) return;
    (H.children[0] as HTMLElement).textContent = c.icon; (H.children[1] as HTMLElement).textContent = c.title;
    let h = '';
    if (v3dOn || v3d) h += `<button type="button" class="v3d${v3d ? ' on' : ''}" data-v3d>${v3d ? 'Выйти из 3D-похода' : '🎥 Поход идёт — смотреть в 3D'} <kbd>Q</kbd></button>`;
    if (c.where) h += `<div class="chip ${c.inParty ? 'in' : ''}">${esc(c.where)}</div>`;
    if (c.hp != null && c.hp >= 0) h += `<div class="hp"><i style="width:${Math.max(2, Math.round(c.hp * 100))}%"></i></div>`;
    if (c.urge) {
      const lab = c.urge.kind === 'say' ? 'Пиши в чат стрима' : c.urge.kind === 'word' ? 'Пиши в чат слово' : c.urge.kind === 'silent' ? 'Внимание' : c.urge.kind === 'ok' ? 'Готово' : 'Что происходит';
      h += `<div class="u ${c.urge.kind}"><small>${lab}</small><div class="say">${c.urge.kind === 'word' ? '' : esc(c.urge.kind === 'say' ? '«' + c.urge.text + '»' : c.urge.text)}</div></div>`;
    }
    if (c.opts?.length) {
      const tot = c.opts.reduce((s, o) => s + o.votes, 0) || 1;
      h += `<div class="opts">${c.opts.map((o) => `<button type="button" class="opt${o.my ? ' my' : ''}" data-n="${o.n}"><i style="width:${Math.round(o.votes / tot * 100)}%"></i><b>${o.n}</b>${esc(o.label)}<em>${o.votes}</em></button>`).join('')}</div>`;
    }
    h += `<div class="f"><span>как на стриме · <b class="dl"></b> с <button data-adj="-1">−</button> <button data-adj="1">+</button></span><button data-full>Поход полностью ↗</button></div>`;
    B.innerHTML = h;
    if (c.urge?.kind === 'word') B.querySelector('.u .say')!.appendChild(wordCanvas(c.urge.text));
    B.querySelectorAll<HTMLButtonElement>('.opt').forEach((b) => b.onclick = async () => {
      if (!c.inParty || c.voteId == null) { host.toast('Голосовать кнопкой можно только в отряде — пиши номер в чат', true); return; }
      const r = await host.actions.post('/api/qvote', { vid: c.voteId, n: +b.dataset.n! });
      host.toast(r && r.ok ? 'Голос принят' : (r && r.error) || 'Не получилось', !(r && r.ok));
    });
    B.querySelectorAll<HTMLButtonElement>('[data-adj]').forEach((b) => b.onclick = () => { try { localStorage.setItem(ADJ_KEY, String(Math.max(-10, Math.min(30, adj() + +b.dataset.adj!)))); } catch { /* */ } });
    (B.querySelector('[data-full]') as HTMLButtonElement).onclick = () => host.actions.openSitePanel('quest');
    const vb = B.querySelector('[data-v3d]') as HTMLButtonElement | null;
    if (vb) vb.onclick = () => window.dispatchEvent(new CustomEvent('l3d:expedition-toggle'));
  };
  const tick = () => {
    const dl = Math.max(0, ((buf[buf.length - 1]?.v as any)?.dl || 0) + adj()) * 1000, now = Date.now();
    while (buf.length && buf[0].at + dl <= now) { shown = buf.shift()!.v; }
    const me = { login: String(host.store.me?.login || ''), role: String(host.store.hero?.role || 'recruit') };
    const c = cardOf(shown, me, baseCmd);
    const k = JSON.stringify(c) + (v3d ? '|3d' : v3dOn ? '|on' : '');
    if (k !== key) { key = k; render(c); }
    const sp = H.children[2] as HTMLElement;
    if (c?.until) { const s = Math.max(0, Math.ceil((c.until + dl - now) / 1000)); sp.textContent = `${c.right ? c.right + ' · ' : ''}${s} с`; sp.classList.toggle('hot', s <= 5); }
    else { sp.textContent = c?.right || ''; sp.classList.remove('hot'); }
    const dlEl = B.querySelector('.dl'); if (dlEl) dlEl.textContent = String(Math.round(dl / 1000));
    lock.hidden = v3d || !(shown && (shown as any).on && (shown as any).party === 'in');
  };
  const iv = window.setInterval(tick, 250); tick();
  return { el: box, dispose() { clearInterval(iv); unsub(); window.removeEventListener('l3d:expedition', onV3d); box.remove(); } };
};
