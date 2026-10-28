/**
 * Seasonal events (src/events): decides which holiday decoration runs — by date window (local time), the
 * «События → Праздничное оформление» setting (Авто / Всегда / Выкл) and, on dev pages only, `?event=<id>` (or
 * `?event=off`) — and sets it up in the city / disposes it again. Re-evaluated when the setting changes, when the
 * city world is rebuilt and once a minute (midnight rolls the window). Decorations live in one group, a sibling of the
 * world root, hidden while the player is inside a room.
 */
import * as THREE from 'three';
import { registerSettingRow, settingValue } from '../ui/settings-ext';
import { fromX, fromZ } from '../world/coords';
import { EVENTS, EVENT_SETTING, EVENT_PICK_SETTING, pickEvent, parseMode, type SeasonalEvent, type EventContext, type EventGame, type EventAvatar } from '../events';
import { isTyping, type InputEx } from '../engine/input';
import type { CoreContext } from '../core/context';
import { coreFeature } from './types';

declare const __DEV__: boolean;

/** Dev override from the URL (`?event=halloween`, `?event=off`); ignored in the shipped extension. */
export function forcedEvent(search: string = typeof location !== 'undefined' ? location.search : ''): string | null {
  if (typeof __DEV__ === 'undefined' || !__DEV__) return null;
  const v = new URLSearchParams(search).get('event');
  return v ? v.toLowerCase() : null;
}

/**
 * Forced event (src/features/hwcity.ts: the site's «Ночь Тыквенной Луны» forces Halloween in the Fair even outside its
 * dates). Honoured in «Авто» and «Всегда», never in «Выкл». `key` = a build variant: a different key rebuilds the event.
 */
let override: { id: string; key: string; when?: () => boolean } | null = null;
let onOverride: (() => void) | null = null;
/** `when`: the override applies only while it returns true (e.g. only in the Fair). */
export function setEventOverride(id: string | null, key = '', when?: () => boolean): void {
  const next = id ? { id, key, when } : null;
  if (override?.id === next?.id && override?.key === next?.key) return;
  override = next;
  onOverride?.();
}
export const eventOverride = () => override;

const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;

/** The game services an interactive event may use (keys, gating, the crowd's avatars, combat knock-back). */
function eventGame(ctx: CoreContext): { game: EventGame; dispose(): void } {
  const { input, interact, rooms } = ctx;
  let photo = false;
  const onPhoto = (e: Event) => { photo = !!(e as CustomEvent).detail?.on; };
  window.addEventListener('l3d:photo', onPhoto);
  const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  type Combat = { hit(id: string, av: unknown, vx: number, vy: number, vz: number, px: number, py: number, pz: number, stop?: number, falloff?: number, spin?: number): boolean };
  const game: EventGame = {
    key: (id, code, label, run) => ctx.registries.keys.register(id, { code, label, when: 'gameplay', run: () => run() }),
    canAct: () => input.locked && ctx.gameplay() && input.gameplay && !ctx.state.menu && !ctx.state.inRoom && !photo && !isTyping()
      && ((input as InputEx).modals?.length ?? 0) === 0 && !rooms.stage && !rooms.busy && !interact.aimed,
    forEachCat(fn) {
      if (ctx.state.inRoom) return;
      const m = ctx.dev.avatars as Map<string, { av: EventAvatar }> | undefined;
      if (m) for (const [id, a] of m) fn(id, a.av);
    },
    me: () => (ctx.meAv ? { av: ctx.meAv as unknown as EventAvatar, visible: !ctx.state.inRoom && ctx.rig.distance >= 0.9 } : null),
    knock(id, av, vx, vy, vz, px, py, pz) {
      if (settingValue('l3d.combat', 'on') !== 'on') return false;
      const c = ctx.dev.combat as Combat | undefined;
      try { return !!c?.hit(id, av, vx, vy, vz, px, py, pz, 0.03, 0.5, 0.6); } catch { return false; }
    },
    swing: () => { ctx.vm.swing(); ctx.meAv.play('swing'); },
    reducedMotion: reduced,
  };
  return { game, dispose: () => window.removeEventListener('l3d:photo', onPhoto) };
}

export default coreFeature({
  id: 'seasonal',
  order: 85,
  setup(ctx) {
    const offRow = registerSettingRow({
      key: EVENT_SETTING, label: 'Праздничное оформление',
      sub: 'Хэллоуин 24.10–3.11, Новый год 20.12–10.01, летние фонарики 21.06–7.07, шляпы 1 апреля. «Авто» — только в дни праздника',
      kind: 'seg', options: [['auto', 'Авто'], ['on', 'Всегда'], ['off', 'Выкл']], def: 'auto', group: 'События', order: 10,
    });
    const offPick = registerSettingRow({
      key: EVENT_PICK_SETTING, label: 'Какое событие («Всегда»)', sub: '«Ближайший» — тот, чьи дни ближе всего',
      kind: 'seg', options: [['near', 'Ближайший'], ...EVENTS.map((e) => [e.id, e.short ?? e.title] as [string, string])], def: 'near', group: 'События', order: 11,
    });
    const eg = eventGame(ctx);
    const group = new THREE.Group(); group.name = 'events'; ctx.scene.add(group);
    let cur: { ev: SeasonalEvent; world: unknown; key: string; stop: () => void } | null = null;

    const choose = (): SeasonalEvent | null => {
      const forced = forcedEvent();
      if (forced === 'off') return null;
      const mode = parseMode(settingValue(EVENT_SETTING, 'auto'));
      if (override && mode !== 'off' && !forced && override.when?.() !== false) { const ev = EVENTS.find((e) => e.id === override!.id); if (ev) return ev; }
      return pickEvent(EVENTS, new Date(), parseMode(settingValue(EVENT_SETTING, 'auto')), forced, settingValue(EVENT_PICK_SETTING, 'near'));
    };
    const stop = () => { if (!cur) return; const c = cur; cur = null; try { c.stop(); } catch (e) { console.warn('[l3d] event dispose', e); } };
    const refresh = () => {
      const world = ctx.world(), ev = choose(), key = override && ev && override.id === ev.id && override.when?.() !== false ? override.key : '';
      if (cur && cur.ev === ev && cur.world === world && cur.key === key) return;
      stop();
      if (!ev) return;
      const sub = new Set<() => void>();
      const ec: EventContext = {
        group, scene: ctx.scene, world: world as EventContext['world'], layout: ctx.layout(),
        groundAt: (X, Z) => world.groundAt(fromX(X), fromZ(Z)),
        onFrame: (fn) => { const u = ctx.onFrame(fn); sub.add(u); return () => { sub.delete(u); u(); }; },
        quality: () => ctx.quality(),
        onQuality: (fn) => { const u = ctx.engine.onQuality(fn); sub.add(u); return () => { sub.delete(u); u(); }; },
        renderer: ctx.engine.renderer, camera: ctx.camera, toast: (t) => ctx.ui.toast(t), game: eg.game,
      };
      try {
        const dispose = ev.setup(ec);
        cur = { ev, world, key, stop: () => { try { dispose(); } finally { for (const u of sub) u(); sub.clear(); } } };
        const k = 'l3d.event.seen.' + ev.id, today = dayKey(new Date());
        let seen: string | null = null; try { seen = localStorage.getItem(k); } catch { /* private mode */ }
        if (seen !== today && !forcedEvent() && !key && parseMode(settingValue(EVENT_SETTING, 'auto')) === 'auto') {
          try { localStorage.setItem(k, today); } catch { /* */ }
          ctx.ui.toast(ev.greeting ?? `${ev.title}: город украшен — отключить можно в настройках («События»).`);
        }
      } catch (e) {
        console.error(`[l3d] event "${ev.id}" failed`, e);
        for (const u of sub) u(); sub.clear();
      }
    };

    onOverride = refresh;
    refresh();
    const onSet = (e: Event) => { const k = (e as CustomEvent).detail?.key; if (!k || k === EVENT_SETTING || k === EVENT_PICK_SETTING) refresh(); };
    window.addEventListener('l3d:settings', onSet);
    const offW = ctx.onWorld(() => refresh());
    let acc = 0;
    const offF = ctx.onFrame((dt) => {
      group.visible = !ctx.state.inRoom;
      acc += dt; if (acc > 60) { acc = 0; refresh(); }
    });
    ctx.dev.seasonal = { refresh, active: () => cur?.ev.id ?? null, group };
    return () => { onOverride = null; offF(); offW(); window.removeEventListener('l3d:settings', onSet); stop(); group.removeFromParent(); offRow(); offPick(); eg.dispose(); };
  },
});
