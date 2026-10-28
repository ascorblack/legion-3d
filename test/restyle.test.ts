/**
 * Live channel-style change (site 28.10 fix/style-live): the walkers' looks are re-resolved in the new style (personal
 * style kept), the feature calls the site session, re-reads the skin, toasts, re-enters a styled room once the new
 * layout is in, and survives repeated / unknown styles. No DOM: document/window are minimal EventTarget stand-ins.
 */
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
vi.hoisted(() => { const g = globalThis as any; if (!g.window) g.window = g; });   // src/net/site.ts reads window at import
import type { Appearance, CityLayout } from '../src/contracts';
import { restyleApps, lookStyle } from '../src/net/site';
import { campName } from '../src/net/town';
import { appearanceFrom } from '../src/avatar';
import { createStore } from '../src/store/store';

beforeAll(() => {
  const g = globalThis as any;
  if (!g.window) g.window = g;
  if (!g.document) { const d = new EventTarget() as any; d.documentElement = { dataset: {}, classList: { add() {}, remove() {} } }; g.document = d; }
  if (!g.addEventListener) { const t = new EventTarget(); g.addEventListener = t.addEventListener.bind(t); g.removeEventListener = t.removeEventListener.bind(t); g.dispatchEvent = t.dispatchEvent.bind(t); }
});
afterEach(() => { vi.useRealTimers(); delete (globalThis as any).MDDoodle; });

const make = (l: string, raw: any, st: string): Appearance => appearanceFrom(l, raw, st);

describe('restyleApps (src/net/site.ts)', () => {
  it('re-resolves looks from the raw record in the new style; a personal style (lk.ps) is kept', () => {
    const a = { login: 'a', raw: { l: 'a', n: 'A', lk: {} }, app: make('a', { l: 'a', n: 'A', lk: {} }, 'legion') };
    const b = { login: 'b', raw: { l: 'b', n: 'B', lk: { ps: 'cats' } }, app: make('b', { l: 'b', n: 'B', lk: { ps: 'cats' } }, 'cats') };
    const n = restyleApps([a, b], make, 'cherts');
    expect(a.app.styleId).toBe('cherts');
    expect(b.app.styleId).toBe('cats');            // Печать Метаморфозы: own style in every channel
    expect(n).toBe(1);
    expect(restyleApps([a, b], make, 'cherts')).toBe(0);   // idempotent
  });
  it('records without raw (fakes) keep their look and only switch the style; unknown styles pass through', () => {
    const app = make('c', { l: 'c' }, 'cats');
    const w = { login: 'c', app };
    restyleApps([w], make, 'veggies');
    expect(w.app.styleId).toBe('veggies');
    expect(w.app.look).toEqual(app.look);
    expect(lookStyle({ ps: '<x>' }, 'legion')).toBe('legion');
  });
  it('camp names: cats / cherts have their own, every other style «Перепутье»; the site names win', () => {
    expect(campName('cherts').name).toBe('Чёртов привал');
    expect(campName('cats').name).toBe('Кошачий привал');
    for (const s of ['legion', 'monkeys', 'veggies', '42brothers', 'ugabugi']) expect(campName(s).name).toBe('Перепутье');
    expect(campName('cherts', { cherts: { places: { camp: { name: 'Пекло', sub: 's' } } } }).name).toBe('Пекло');
  });
});

describe('restyle feature', () => {
  it('pure helpers: names, skins, rules, room re-entry', async () => {
    const R = await import('../src/features/restyle');
    expect(Object.keys(R.STYLE_NAMES)).toEqual(['legion', 'cats', 'monkeys', 'veggies', '42brothers', 'cherts', 'ugabugi']);
    expect(R.skinOf('cherts')).toBe('inferno');
    expect(R.skinOf('veggies')).toBe('garden');
    expect(R.skinOf('nope')).toBe('forge');
    expect(R.styleName('cherts')).toBe('Чертики');
    expect(R.styleName('cherts', { styles: { cherts: { name: 'Черти <b>' } } })).toBe('Черти b');
    expect(R.styleName('zzz')).toBe('zzz');
    expect(R.styleToast('42brothers')).toBe('Стиль канала: 42 Братухи');
    expect(R.avatarRules('veggies')).toBe('legion');
    expect(R.avatarRules('42brothers')).toBe('legion');
    expect(R.avatarRules('cherts')).toBe('cherts');
    expect(R.reenterRoom('hybrid', 'cats', 'cherts')).toBe(true);
    expect(R.reenterRoom('shop3d', 'cats', 'cherts')).toBe(true);
    expect(R.reenterRoom('mine3d', 'cats', 'cherts')).toBe(false);
    expect(R.reenterRoom('shop3d', 'cats', 'cats')).toBe(false);
    expect(R.reenterRoom(null, 'cats', 'cherts')).toBe(false);
    expect(R.validStyle('42brothers')).toBe(true);
    expect(R.validStyle('a b')).toBe(false);
  });

  const setup = async (o: { site?: boolean; room?: { id: string; kind: string } } = {}) => {
    const { default: F } = await import('../src/features/restyle');
    const store = createStore();
    const layout = { id: 'camp', styleId: 'cats' } as unknown as CityLayout;
    store.setLayout(layout);
    store.setHero({ login: 'me', name: 'Me', level: 3, look: {}, gear: {} } as any);
    store.setMe({ login: 'me', app: make('me', { l: 'me' }, 'cats'), x: 0, y: 0, face: 0, speed: 0, alpha: 1, me: true });
    store.upsertWalker({ login: 'w1', app: make('w1', { l: 'w1' }, 'cats'), x: 0, y: 0, face: 0, speed: 0, alpha: 1 });
    const toasts: string[] = [];
    let cur: string | null = o.room?.id ?? null, kind: string | null = o.room?.kind ?? null;
    const enters: string[] = [];
    const rooms = {
      get current() { return cur; }, get kind() { return kind; },
      exit: vi.fn(() => { cur = null; kind = null; }),
      enter: vi.fn(async (id: string) => { enters.push(id); cur = id; }),
    };
    const restyle = vi.fn(() => { store.setLayout({ ...layout, styleId: (globalThis as any).MDDoodle?.active } as CityLayout); return true; });
    const reskin = vi.fn(() => 'inferno');
    const ctx: any = {
      store, rooms, layout: () => store.layout,
      site: o.site ? { restyle } : {},
      ui: { toast: (t: string) => toasts.push(t) },
      uiApi: { reskin },
    };
    (globalThis as any).MDDoodle = { active: 'cats', styles: { cherts: { name: 'Чертики' } } };
    const off = F.setup(ctx) as () => void;
    return { store, rooms, restyle, reskin, toasts, enters, off };
  };

  it("'lg-style': calls the site session, re-reads the skin, toasts once, tells other modules", async () => {
    const t = await setup({ site: true });
    const seen: any[] = [];
    const onStyle = (e: Event) => seen.push((e as CustomEvent).detail);
    (globalThis as any).addEventListener('l3d:style', onStyle);
    (globalThis as any).MDDoodle.active = 'cherts';
    document.dispatchEvent(new CustomEvent('lg-style', { detail: { style: 'cherts' } }));
    expect(t.restyle).toHaveBeenCalledTimes(1);
    expect(t.reskin).toHaveBeenCalledTimes(1);
    expect(t.toasts).toEqual(['Стиль канала: Чертики']);
    expect(seen).toEqual([{ style: 'cherts', prev: 'cats', skin: 'inferno', rules: 'cherts' }]);
    document.dispatchEvent(new CustomEvent('lg-style', { detail: { style: 'cherts' } }));   // the same again: no second toast
    expect(t.toasts).toHaveLength(1);
    (globalThis as any).removeEventListener('l3d:style', onStyle);
    t.off();
    document.dispatchEvent(new CustomEvent('lg-style', { detail: { style: 'legion' } }));   // disposed: nothing
    expect(t.restyle).toHaveBeenCalledTimes(2);
  });

  it('without a site restyle (dev fakes): walkers, own hero and the layout follow; unknown style → legion rules', async () => {
    const t = await setup();
    (globalThis as any).MDDoodle.active = 'veggies';
    document.dispatchEvent(new CustomEvent('lg-style', { detail: { style: 'veggies' } }));
    expect(t.store.walkers.get('w1')!.app.styleId).toBe('veggies');
    expect(t.store.me!.app.styleId).toBe('veggies');
    expect(t.store.layout!.styleId).toBe('veggies');
    expect(t.toasts).toEqual(['Стиль канала: Овощи']);
    t.off();
  });

  it('a 3D shop / hybrid room is left and re-entered once the new layout is in; the mine is kept', async () => {
    vi.useFakeTimers();
    const t = await setup({ site: true, room: { id: 'forge', kind: 'hybrid' } });
    (globalThis as any).MDDoodle.active = 'cherts';
    document.dispatchEvent(new CustomEvent('lg-style', { detail: { style: 'cherts' } }));
    expect(t.rooms.exit).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(800);
    expect(t.enters).toEqual(['forge']);
    t.off();
    const m = await setup({ site: true, room: { id: 'mine', kind: 'mine3d' } });
    (globalThis as any).MDDoodle.active = 'cherts';
    document.dispatchEvent(new CustomEvent('lg-style', { detail: { style: 'cherts' } }));
    await vi.advanceTimersByTimeAsync(800);
    expect(m.rooms.exit).not.toHaveBeenCalled();
    expect(m.enters).toEqual([]);
    m.off();
  });

  it('safety net: MDDoodle.active changed without the event → picked up by the 3 s check; bad styles are ignored', async () => {
    vi.useFakeTimers();
    const t = await setup({ site: true });
    (globalThis as any).MDDoodle.active = 'monkeys';
    await vi.advanceTimersByTimeAsync(3100);
    expect(t.restyle).toHaveBeenCalledTimes(1);
    expect(t.toasts).toEqual(['Стиль канала: Обезьяны']);
    (globalThis as any).MDDoodle.active = '<bad style>';
    document.dispatchEvent(new CustomEvent('lg-style', { detail: { style: '<bad>' } }));
    await vi.advanceTimersByTimeAsync(3100);
    expect(t.restyle).toHaveBeenCalledTimes(1);
    t.off();
  });
});
