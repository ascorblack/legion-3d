/**
 * Owner bug 31.10 — the party stands in a district town (map stage, q.town) and the site offers «Войти в город «…»»:
 *   - questTown(): the site's own rule (quest.js tabHtml: v.town && hero.cy && hero.tw), on the recorded map views;
 *   - cityTab(): the City panel shown (#tab-city.on, the quest's town entry) counts as open although the tab button still
 *     says aria-disabled (app.js re-runs cityVis only on the next /api/me render) — so F8 boots the town, not the march;
 *   - enterQuestTown(): presses the site's own [data-qtown] button (opening «Поход» first when it is not painted) and
 *     waits for the City — a fake site, nothing is sent;
 *   - the expedition HUD shows/hides the button and swaps the «город закрыт» hint.
 * Also (owner 31.10): filler cats of the crowd (only `n` known) never get an invented name or a nameplate.
 */
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import * as THREE from 'three';
import FIX from './fixtures/quest-map-town.json';
import { questTown, cityTab, cityTownShown, enterQuestTown } from '../src/net/city-tab';
import type { QuestPayload } from '../src/quest/model';

/* ---------- a tiny fake site DOM: tabs, the «Поход» tab (painted only while shown), the City panel ---------- */
interface El { hidden: boolean; attrs: Record<string, string>; dataset: Record<string, string>; click(): void; getAttribute(k: string): string | null }
function fakeSite(opts: { questShown: boolean; locked: boolean; town: { id: string; name: string } | null; cityAfterMs?: number; paintMs?: number }) {
  const st = { questShown: opts.questShown, cityOn: false, cityTown: '', clicks: [] as string[], requests: [] as string[] };
  const mk = (attrs: Record<string, string>, onClick: () => void): El => ({ hidden: false, attrs, dataset: {}, click: onClick, getAttribute: (k) => attrs[k] ?? null });
  const cityBtn = mk(opts.locked ? { 'aria-disabled': 'true' } : {}, () => { st.clicks.push('tab:city'); });
  const questBtn = mk({}, () => { st.clicks.push('tab:quest'); setTimeout(() => { st.questShown = true; }, opts.paintMs ?? 30); });
  // app.js openTown: townEntry, LGCity.town(id), tab('city') — once the City files are there (the aria-disabled stays until cityVis)
  const qtown = mk({}, () => { st.clicks.push('qtown:' + opts.town!.id); setTimeout(() => { st.cityOn = true; st.cityTown = opts.town!.id; }, opts.cityAfterMs ?? 60); });
  const cy = { dataset: {} as Record<string, string> };
  const doc = {
    querySelector(sel: string): unknown {
      if (sel === '.tabs button[data-tab="city"]') return cityBtn;
      if (sel === '.tabs button[data-tab="quest"]:not([hidden])') return questBtn;
      if (sel === '#tab-city.on') return st.cityOn ? {} : null;
      if (sel === '#tab-city .cy') { cy.dataset.town = st.cityTown; return st.cityOn ? cy : null; }
      const m = /^#tab-quest \[data-qtown="([^"]+)"\]$/.exec(sel);
      if (m) return st.questShown && opts.town && opts.town.id === m[1] ? qtown : null;
      return null;
    },
  };
  return { doc: doc as unknown as Document, st };
}

const views = FIX.views as unknown as QuestPayload[];

describe('questTown (quest.js tabHtml rule)', () => {
  it('is shown only at the town stop, for a hero with cy + tw', () => {
    expect(views.map((v) => questTown(v, FIX.hero))).toEqual([null, { id: 'd7', name: 'Рябиново' }, null]);
    expect(questTown(views[1], { cy: 1 })).toBeNull();            // district towns closed for the hero
    expect(questTown(views[1], { tw: 1 })).toBeNull();            // no City at all
    expect(questTown({ ...views[1], on: false }, FIX.hero)).toBeNull();
    expect(questTown({ ...views[1], town: { id: '' } }, FIX.hero)).toBeNull();
    expect(questTown(null, FIX.hero)).toBeNull();
  });
});

describe('cityTab / cityTownShown with the quest town entry', () => {
  it('a shown City panel is open even while the button is still aria-disabled', async () => {
    const s = fakeSite({ questShown: true, locked: true, town: { id: 'd7', name: 'Рябиново' }, cityAfterMs: 0 });
    expect(cityTab(s.doc)).toBe('locked');
    expect(cityTownShown(s.doc)).toBeNull();
    s.st.cityOn = true; s.st.cityTown = 'd7';
    expect(cityTab(s.doc)).toBe('open');                          // F8 / «Играть в 3D» → the normal boot in the town
    expect(cityTownShown(s.doc)).toBe('d7');
  });
});

describe('enterQuestTown (the site\'s own button, fake site)', () => {
  afterEach(() => { vi.useRealTimers(); });
  it('presses the painted [data-qtown] button and waits for the City', async () => {
    const s = fakeSite({ questShown: true, locked: true, town: { id: 'd7', name: 'Рябиново' } });
    expect(await enterQuestTown('d7', s.doc, 2000)).toBe('ok');
    expect(s.st.clicks).toEqual(['qtown:d7']);
    expect(cityTab(s.doc)).toBe('open');
    expect(s.st.requests).toEqual([]);
  });
  it('opens «Поход» first when the tab is not painted (quest.js paints only the shown tab)', async () => {
    const s = fakeSite({ questShown: false, locked: true, town: { id: 'd7', name: 'Рябиново' } });
    expect(await enterQuestTown('d7', s.doc, 2000)).toBe('ok');
    expect(s.st.clicks).toEqual(['tab:quest', 'qtown:d7']);
    expect(s.st.clicks).not.toContain('tab:city');                // never the locked City tab itself
  });
  it('no button on the site → no_button, nothing pressed but «Поход»', async () => {
    vi.useFakeTimers();
    const s = fakeSite({ questShown: false, locked: true, town: null });
    const p = enterQuestTown('d7', s.doc, 2000);
    await vi.advanceTimersByTimeAsync(4000);
    expect(await p).toBe('no_button');
    expect(s.st.clicks).toEqual(['tab:quest']);
  });
  it('the City never opens → timeout', async () => {
    vi.useFakeTimers();
    const s = fakeSite({ questShown: true, locked: true, town: { id: 'd7', name: 'Рябиново' }, cityAfterMs: 1e9 });
    const p = enterQuestTown('d7', s.doc, 1000);
    await vi.advanceTimersByTimeAsync(2000);
    expect(await p).toBe('timeout');
  });
});

/* ---------- HUD + crowd (fake DOM/canvas as in expedition-scene.test.ts) ---------- */
class FakeEl {
  style: Record<string, string> = {}; dataset: Record<string, string> = {}; width = 0; height = 0; innerHTML = ''; textContent = ''; className = ''; hidden = false; children: FakeEl[] = [];
  parent: FakeEl | null = null; onclick: ((e: any) => void) | null = null; attrs: Record<string, string> = {};
  private q = new Map<string, FakeEl>();
  classList = { add() {}, remove() {}, toggle() {}, contains: () => false };
  getContext() { return ctx2d; }
  attachShadow() { return new FakeEl(); }
  appendChild(c: FakeEl) { c.parent = this; this.children.push(c); return c; }
  append(...c: FakeEl[]) { for (const x of c) this.appendChild(x); }
  remove() { if (this.parent) { this.parent.children = this.parent.children.filter((x) => x !== this); this.parent = null; } }
  setAttribute(k: string, v: string) { this.attrs[k] = v; } removeAttribute(k: string) { delete this.attrs[k]; } getAttribute(k: string) { return this.attrs[k] ?? null; }
  addEventListener() {} removeEventListener() {}
  querySelector(sel: string) { let e = this.q.get(sel); if (!e) { e = new FakeEl(); this.q.set(sel, e); } return e; }
  querySelectorAll() { return []; }
}
const ctx2d = new Proxy({}, {
  get: (_t, k) => {
    if (k === 'measureText') return () => ({ width: 10 });
    if (k === 'createLinearGradient' || k === 'createRadialGradient') return () => ({ addColorStop() {} });
    return () => {};
  },
  set: () => true,
});
beforeAll(() => {
  (globalThis as any).document = { createElement: () => new FakeEl(), body: new FakeEl() };
  (globalThis as any).window = Object.assign(globalThis as any, { addEventListener() {}, removeEventListener() {} });
  (globalThis as any).localStorage = { getItem: () => null, setItem() {} };
});

describe('expedition HUD: «Войти в город «…»»', () => {
  it('shows the button with the town name, fires only on click, hides it again; the hint is replaced', async () => {
    const { ExpeditionView } = await import('../src/expedition');
    const { hintTown } = await import('../src/features/expedition');
    const root = new FakeEl();
    const view = new ExpeditionView({ uiRoot: root as unknown as HTMLElement, kit: null, appOf: () => null, style: 'cats', quality: () => 0, me: () => ({ login: 'me', role: 'archer' }), hint: 'город закрыт до конца похода' });
    let went = 0;
    view.setTown({ name: 'Рябиново', go: () => { went++; } });    // before open: kept for the HUD
    view.setHint(hintTown('Рябиново'));
    view.open(new THREE.Scene());
    const b = view.hud!.townBtn as unknown as FakeEl;
    expect(b.hidden).toBe(false);
    expect(b.textContent).toBe('🏘 Войти в город «Рябиново»');
    expect(went).toBe(0);                                          // nothing on its own
    b.onclick!({ stopPropagation() {} });
    expect(went).toBe(1);
    const sh = (view.hud as any).sh as FakeEl, hint = (view.hud as any).hint as FakeEl;
    expect(sh.innerHTML).toContain('отряд в городе «Рябиново»');     // the HUD was built with the town hint
    expect(sh.innerHTML).not.toContain('закрыт');
    view.setTown(null);
    expect(b.hidden).toBe(true);
    expect(b.onclick).toBeNull();
    view.setHint(undefined);
    expect(hint.innerHTML).toContain('город закрыт');
    view.close();
  });
});

describe('expedition crowd: no invented names', () => {
  it('filler cats (only n known) have no name and no nameplate; me and battle names keep theirs', async () => {
    const { ExpeditionScene } = await import('../src/expedition/scene');
    const { adapt, Roster } = await import('../src/expedition/adapter');
    const { Label } = await import('../src/expedition/text');
    const texts: string[] = [];
    const spy = vi.spyOn(Label.prototype, 'set').mockImplementation(function (this: any, t: string) { texts.push(t); return this; });
    const roster = new Roster();
    // gather/map: the site sends only n
    const ms = roster.members(30, { login: 'me', role: 'archer', in: true });
    expect(ms).toHaveLength(30);
    expect(ms[0]).toMatchObject({ me: true, ghost: false });
    for (const m of ms.slice(1)) { expect(m.ghost).toBe(true); expect(m.name).toBe(''); }

    const scene = new THREE.Scene();
    const cam = new THREE.PerspectiveCamera(50, 16 / 9, 0.03, 400);
    const sc = new ExpeditionScene({ kit: null, appOf: () => null, style: 'cats', quality: 2, secLeft: () => 5 });
    scene.add(sc.root); sc.attach(scene);
    const crowd = sc.crowd;
    const plates = () => crowd.actors.filter((a) => a.label).map((a) => a.m.login);
    sc.setState(adapt(views[0], { login: 'me', role: 'archer', roster }));
    for (let i = 0; i < 6; i++) sc.update(0.1, i * 0.1, cam);
    expect(crowd.actors.length).toBeGreaterThan(10);
    expect(plates()).toEqual(['me']);                              // only «ТЫ · me»
    expect(texts.filter((t) => /Мурзик|Пончик|Носок|Котик|Плюшка|Хвостик|#cat/.test(t))).toEqual([]);
    expect(texts).toContain('ТЫ · me');

    // a battle names its fighters (b.form): they keep their plates afterwards (roster), the fillers still have none
    roster.remember({ form: [['me', 'archer'], ['alpha', 'mage'], ['beta', 'priest']], low: [['beta', 'Бета']] } as any);
    const ms2 = roster.members(12, { login: 'me', role: 'archer', in: true });
    expect(ms2.slice(0, 3).map((m) => [m.login, m.name, m.ghost])).toEqual([['me', 'me', false], ['alpha', 'alpha', false], ['beta', 'Бета', false]]);
    expect(ms2.slice(3).every((m) => m.ghost && !m.name)).toBe(true);
    sc.setState(adapt({ ...views[0], k: 'travel', at: (views[0].at ?? 0) + 1 } as QuestPayload, { login: 'me', role: 'archer', roster }));
    for (let i = 0; i < 8; i++) sc.update(0.1, 1 + i * 0.1, cam);
    expect(plates().sort()).toEqual(['alpha', 'beta', 'me']);
    // the declutter still runs over the remaining plates (does not throw, keeps mine)
    cam.position.set(0, 4, 10); cam.lookAt(0, 0, 0); cam.updateMatrixWorld(); cam.updateProjectionMatrix();
    crowd.declutter(cam);
    expect(crowd.actors.find((a) => a.m.me)!.label!.obj.visible).toBe(true);
    spy.mockRestore();
    sc.dispose();
  });
});
