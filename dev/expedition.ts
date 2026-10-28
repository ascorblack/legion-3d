/**
 * Expedition 3D dev page: the 3D expedition (src/expedition) driven by the deterministic FakeQuest (src/quest/fake.ts)
 * through the real DelayBuffer → adapter → scene path. Nothing touches the network.
 *   ?speed=2 (default)  ?dl=4 stream delay the fake reports (s)  ?at=SEC start at plan second SEC  ?spec=1 spectator
 *   ?role=archer|legionary|mage|priest…  ?q=0..3 quality  ?n=50 big party (extra cats)
 * Mouse drag: look around · wheel: zoom.  window.__exp = { view, engine, fake, seek(sec), pause(on), step(n), stats(), shot() }.
 */
import * as THREE from 'three';
import type { Hero } from '../src/contracts';
import { createEngine } from '../src/engine';
import { createAvatarKit, appearanceFrom, RECOMMENDED_NEAR } from '../src/avatar';
import { FakeQuest, rebase } from '../src/quest/fake';
import type { Role, QuestPayload } from '../src/quest/model';
import { ExpeditionView } from '../src/expedition';
import meFx from '../test/fixtures/me.json';

const Q = new URLSearchParams(location.search);
const host = document.getElementById('app') as HTMLElement;
const engine = createEngine({ host, quality: Q.has('q') ? (+Q.get('q')! as 0) : 2 });
const { scene, camera, renderer } = engine;
camera.near = RECOMMENDED_NEAR; camera.far = 400; camera.updateProjectionMatrix();
scene.add(camera);

const hero = structuredClone((meFx as any).hero) as Hero;
const LOGIN = String(hero.login).toLowerCase();
const ROLE = (Q.get('role') || 'archer') as Role;
const meApp = appearanceFrom(LOGIN, { ...hero, n: hero.name, lv: hero.level, lk: (hero as any).wardrobe?.cur || hero.look, g: hero.gear, role: ROLE }, 'cats');
const speed = +(Q.get('speed') || 2);
const fake = new FakeQuest({ login: LOGIN, role: ROLE, speed, dl: +(Q.get('dl') ?? 4), spectator: Q.get('spec') === '1' });
const bigN = +(Q.get('n') || 0);

let clockOff = 0;
const now = () => Date.now() + clockOff;
const view = new ExpeditionView({
  uiRoot: document.body, kit: createAvatarKit(), style: 'cats', quality: () => engine.quality, me: () => ({ login: LOGIN, role: ROLE }),
  appOf: (l) => (l === LOGIN ? meApp : null), now,
  hint: 'мышь (зажать) — осмотреться · колесо — ближе/дальше · dev: FakeQuest',
});
view.open(scene);

/* ---- the fake server: one view per 500 ms of plan time, re-based onto the page clock ---- */
let start = now() - (+(Q.get('at') || 0) * 1000) / speed;
const widen = (v: QuestPayload): QuestPayload => {
  if (!bigN || !v.on || !v.b) return v;
  const form = v.b.form.slice();
  const roles = ['legionary', 'rogue', 'archer', 'mage', 'priest', 'paladin', 'necromancer', 'recruit'];
  for (let i = form.length; i < bigN; i++) form.push([`cat${i}`, roles[i % roles.length], v.b.cr && v.b.cr.fr.length > 1 ? v.b.cr.fr[i % v.b.cr.fr.length] : '', null, false, i % 3]);
  return { ...v, n: bigN, b: { ...v.b, form, fighters: bigN } };
};
/* ---- ?demo=… : a fixed synthetic view for the stages the FakeQuest does not visit (vignettes) ---- */
const DEMO = Q.get('demo');
const demo = (k: string): QuestPayload => {
  const T = now() + 30_000, base: QuestPayload = { on: true, dl: 0, at: now(), n: 12, party: 'in', ter: 'Пещера' };
  const tr = (type: string, extra: Record<string, unknown> = {}) => ({ ...base, k: 'trap', t: 'Ловушка', tr: { name: 'Ловушка', type, st: 'act', until: T, n: 4, word: 'прыгай', ...extra } });
  switch (k) {
    case 'trap-react': return tr('react', { name: 'Маятник', ter: 'Ущелье' });
    case 'trap-gas': return tr('gas', { name: 'Ядовитый газ', gas: true });
    case 'trap-ropes': return tr('ropes', { name: 'Верёвки над ямой' });
    case 'trap-ceiling': return tr('ceiling', { name: 'Падающий потолок' });
    case 'trap-plates': return tr('plates', { name: 'Плиты' });
    case 'shop': return { ...base, k: 'shop', t: 'Лавка бродяги', ter: 'Брод', sh: { name: 'Лавка бродяги', items: [
      { id: 'a', name: 'Зелье лечения', rarity: 'common', price: 30, qty: 3, slot: 'potion' }, { id: 'b', name: 'Меч рыцаря', rarity: 'rare', price: 420, qty: 1, slot: 'weapon' },
      { id: 'c', name: 'Круглый щит', rarity: 'uncommon', price: 160, qty: 1, slot: 'shield' }, { id: 'd', name: 'Пирог', rarity: 'common', price: 12, qty: 5, slot: 'food' },
      { id: 'e', name: 'Шляпа мага', rarity: 'epic', price: 900, qty: 1, slot: 'helmet' }, { id: 'f', name: 'Амулет', rarity: 'legendary', price: 2500, qty: 1, slot: 'relic' }] } };
    case 'ev-traveler': return { ...base, k: 'event', ter: 'Курган', ev: { look: 'traveler', name: 'Путник в беде', st: 'vote', until: T, votes: { help: 4, rob: 2 } } };
    case 'ev-dice': return { ...base, k: 'event', ter: 'Брод', ev: { look: 'dice', name: 'Кости с бродягой', st: 'on', cmds: [['ставка 20', 'играть на 20 монет']] } };
    case 'ev-well': return { ...base, k: 'event', ter: 'Река', ev: { look: 'well', name: 'Колодец желаний', st: 'on', cmds: [['монетка', 'бросить монету']] } };
    case 'ev-priest': return { ...base, k: 'event', ter: 'Курган', ev: { look: 'priest', name: 'Странствующий жрец', st: 'on', cmds: [['лечение', 'за 20 монет']] } };
    // map puzzles (site 28.10, kind puzzle): ?demo=pz-runes | pz-cups | pz-scales | pz-riddle
    case 'pz-runes': return { ...base, k: 'puzzle', t: 'Рунный камень', pz: { id: 1, kind: 'runes', st: 'answer', name: 'Рунный камень', icon: '🪨', how: 'Напиши число', rows: [['R', '+', 'R', '=', '8'], ['R', '+', 'T', '=', '7'], ['T', '×', 'R', '=', '?']], until: T, an: 3, prize: 'coins', coins: 15 } } as QuestPayload;
    case 'pz-cups': return { ...base, k: 'puzzle', t: 'Три кубка', pz: { id: 2, kind: 'cups', st: 'answer', name: 'Три кубка', icon: '🍷', how: 'Выбери кубок без яда', signs: ['Яд не здесь', 'Яд в первом', 'Яд не во втором'], bt: [['Кубок 1', '1'], ['Кубок 2', '2'], ['Кубок 3', '3']], until: T, an: 5, prize: 'buff' } } as QuestPayload;
    case 'pz-scales': return { ...base, k: 'puzzle', t: 'Весы', pz: { id: 3, kind: 'scales', st: 'answer', name: 'Старые весы', icon: '⚖', how: 'Встань на плиту: лево или право', sums: [3, 7, 4, 6], rt: 'тяжелее', bt: [['Левая', 'лево'], ['Правая', 'право']], until: T, an: 10, prize: 'coins', coins: 10 } } as QuestPayload;
    case 'pz-riddle': return { ...base, k: 'puzzle', t: 'Загадка сфинкса', pz: { id: 4, kind: 'riddle', st: 'answer', name: 'Загадка сфинкса', icon: '❓', how: 'Ответ одним словом в чат', q: 'Без окон, без дверей — полна горница людей', until: T, an: 2, prize: 'coins', coins: 20 } } as QuestPayload;
    case 'town': return { ...base, k: 'town', t: 'Ярмарочный посад', town: { id: 't1', name: 'Ярмарочный посад' } };
    case 'dungeon': return { ...base, k: 'dungeon', ter: 'Данж', dgn: { name: 'Склеп', vote: { id: 5, title: 'Куда?', end: T, opts: [[1, 'w', 'Левый проход', '⬅', 4], [2, 'n', 'Прямо', '⬆', 7], [3, 'e', 'Лестница вниз', '⬇', 1]] } } };
    case 'lair': return { ...base, k: 'lair', lair: { hp: 0.8, is: { pick: { until: T, my: 2, cnt: [3, 4, 2, 3] }, gone: [4] } } };
    default: return { ...base, k: 'rest', t: 'Привал', ter: 'Курган' };
  }
};
const tick = () => {
  if (DEMO) { view.push(demo(DEMO), now()); return; }
  const el = now() - start; const v = widen(fake.at(el)); view.push(rebase(v, start - fake.t0), now());
};
tick();
let iv = setInterval(tick, 500);

/* ---- input: drag to look, wheel to zoom ---- */
let drag: { x: number; y: number } | null = null;
renderer.domElement.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY }; });
addEventListener('pointerup', () => { drag = null; });
addEventListener('pointermove', (e) => { if (!drag) return; view.scene?.look(-(e.clientX - drag.x) * 0.005, (e.clientY - drag.y) * 0.004); drag = { x: e.clientX, y: e.clientY }; });
renderer.domElement.addEventListener('wheel', (e) => { view.scene?.zoom(Math.sign(e.deltaY)); e.preventDefault(); }, { passive: false });

const dbg = document.getElementById('dbg') as HTMLElement;
if (Q.get('nodbg') === '1') dbg.style.display = 'none';
let dbgT = 0;
const frame = (dt: number, t: number) => {
  view.frame(dt, t, camera);
  dbgT += dt;
  if (dbgT > 0.4) {
    dbgT = 0;
    const s = engine.stats(), st = view.scene?.stats(), ss = view.sceneState;
    const el = ((now() - start) * speed) / 1000;
    dbg.textContent = `${s.fps.toFixed(0)} fps · calls ${s.calls} · tris ${s.tris} · q${engine.quality}\nплан ${el.toFixed(0)} с · ${ss?.kind || '—'} · ${ss?.battle ? ss.battle.stage + ' r' + ss.battle.round : ''}\nактёров ${st?.actors ?? 0} (детальных ${st?.detailed ?? 0}) · врагов ${st?.foes ?? 0}`;
  }
};
engine.onFrame(frame);

let stepT = 0;
(window as any).__exp = {
  view, engine, fake, camera,
  /** jump to plan second `sec` (the buffer is reset, the scene follows) */
  seek(sec: number) {
    clearInterval(iv);
    start = now() - (sec * 1000) / speed;
    (view.buf as any).raw.length = 0; (view.buf as any).cur = null;
    tick(); iv = setInterval(tick, 500);
  },
  /** plan second now */
  plan: () => ((now() - start) * speed) / 1000,
  /** fast-forward the page clock (ms) — delay buffer and timers follow */
  warp(ms: number) { clockOff += ms; tick(); },
  pause(on: boolean) { engine.pause(on); },
  step(n = 1, dt = 1 / 30) { engine.pause(true); renderer.info.reset(); for (let i = 0; i < n; i++) { stepT += dt; frame(dt, stepT + performance.now() / 1000); } renderer.render(scene, camera); return renderer.info.render; },
  stats: () => ({ ...engine.stats(), ...view.scene?.stats(), kind: view.sceneState?.kind, stage: view.sceneState?.battle?.stage, info: { calls: renderer.info.render.calls, tris: renderer.info.render.triangles } }),
  look(yaw: number, pitch: number, zoom = 1) { const sc = view.scene as any; sc.user.yaw = yaw; sc.user.pitch = pitch; sc.user.zoom = zoom; },
  /** visible draws by name: [name, draws, triangles] */
  breakdown() {
    const out: Record<string, [number, number]> = {};
    scene.traverseVisible((o: any) => {
      if (!o.isMesh && !o.isPoints && !o.isSprite) return;
      const g = o.geometry; if (!g) return;
      const idx = g.index ? g.index.count : g.attributes.position?.count || 0;
      const inst = o.isInstancedMesh ? o.count : 1;
      if (o.isInstancedMesh && !o.count) return;
      let n = o.name || o.parent?.name || o.type; n = n.replace(/\d+$/, '');
      const r = out[n] || (out[n] = [0, 0]); r[0]++; r[1] += Math.round(idx / 3) * inst;
    });
    return Object.entries(out).sort((a, b) => b[1][1] - a[1][1]);
  },
  segs: () => fake.segs.map((s: any) => [s.k, s.from / 1000, s.to / 1000]),
  phases: () => fake.segs.filter((s: any) => s.k === 'battle').map((s: any) => s.b.phases.map((p: any) => [p.st, p.from / 1000, p.round, p.after || ''])),
};
void THREE;
