/**
 * «Драки с котиками» (src/combat): LMB attacks by class — swings knock cats over (ragdolls), the bow is held to
 * draw and released to shoot, mages throw orbs, necromancers raise zombie cats, priests let out a light wave.
 * CLIENT-SIDE ONLY: nothing is sent to the site, other players never see it, and their real positions are untouched
 * (a knocked-over cat gets up and glides back to where the site has it).
 *
 * LMB is an attack only when: the setting is on, the pointer is locked in gameplay (no menu, modal, photo mode or
 * text field), not in a scene-mode / loading room, on the street, in a 3D shop or in the mine (not in hybrid rooms),
 * wherever the crosshair is (clicks never interact — doors, goods and stones are used with E; a swing never buys). The
 * swing animation itself stays with the controls feature (vm.swing + meAv.play('swing')); this feature adds the hit,
 * the bow draw and the effects.
 *
 * Rooms (src/combat/room.ts): the room scene's `combat` field lists its fighters (shopkeepers, tent mannequins, mine
 * miners / NPCs) and runs our update at the end of the room's own update (rooms animate their figures after the
 * features); bodies, minions and projectiles use the room's floor and solids. Leaving / entering resets everything.
 */
import { CombatSystem, gate, type CombatHost } from '../combat';
import { roomCombatOf, roomEnv, NPC_LINES, NPC_LINE_GAP, type RoomCombat, type RoomFighter } from '../combat/room';
import type { RagdollEnv } from '../combat/physics';
import type { CombatAvatar } from '../combat/ragdoll';
import { isTyping, type InputEx } from '../engine/input';
import { fromX, fromZ } from '../world/coords';
import { registerSettingRow, settingValue } from '../ui/settings-ext';
import { lsStr, lsSet } from '../core/settings';
import type { World3DExt } from '../contracts/ext';
import { coreFeature } from './types';

const KEY = 'l3d.combat', HINT = 'l3d.combat.hint';

export default coreFeature({
  id: 'combat',
  order: 25,   // after the crowd animated the avatars (20), before the labels read their anchors (30)
  setup(ctx) {
    const { input, interact, rooms, engine } = ctx;
    const el = engine.renderer.domElement;
    const offRow = registerSettingRow({
      key: KEY, label: 'Драки с котиками (только у тебя)', group: 'Забавы', order: 10,
      sub: 'ЛКМ — удар своим оружием: котики забавно падают. Видишь только ты, сайту ничего не отправляется',
      kind: 'seg', options: [['on', 'Вкл'], ['off', 'Выкл']], def: 'on',
    });
    let enabled = settingValue(KEY, 'on') === 'on';
    let photo = false;
    const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    const avatars = () => ctx.dev.avatars as Map<string, { av: CombatAvatar }> | undefined;

    /* ---- the walkable space (world metres) ---- */
    const street: RagdollEnv = {
      groundAt: (x, z) => ctx.world().groundAt(fromX(x), fromZ(z)),
      blocked: (x, z) => {
        const px = fromX(x), py = fromZ(z), w = ctx.world() as unknown as Partial<World3DExt>;
        return !ctx.layout().free(px, py) || (typeof w.solidTop === 'function' && w.solidTop(px, py) === Infinity);
      },
    };
    const streetShots: RagdollEnv = {
      groundAt: street.groundAt,
      blocked: (x, z, y) => {
        const px = fromX(x), py = fromZ(z), w = ctx.world() as unknown as Partial<World3DExt>;
        return typeof w.solidTop === 'function' && w.solidTop(px, py) === Infinity && y < ctx.world().groundAt(px, py) + 5;
      },
    };
    // the active room's space (rebuilt on every room change); a room without one: nothing passes
    const nowhere: RagdollEnv = { groundAt: () => 0, blocked: () => true };
    let room: { body: RagdollEnv; shots: RagdollEnv } = { body: nowhere, shots: nowhere };
    let rc: RoomCombat | null = null, offAfter: (() => void) | null = null;
    /** Room fighters by id (filled every room frame; no allocations after the first frames). */
    const fighters = new Map<string, RoomFighter>();
    const down = new Set<string>();
    let lineAt = -Infinity;

    const host: CombatHost = {
      scene: ctx.scene, camera: ctx.camera,
      forEachTarget(fn) {
        if (ctx.state.inRoom) { if (rc) rc.fighters((f) => fn(f.id, f.av)); return; }
        const m = avatars(); if (m) for (const [id, a] of m) fn(id, a.av);
      },
      env: () => (ctx.state.inRoom ? room.body : street),
      shotEnv: () => (ctx.state.inRoom ? room.shots : streetShots),
      me: {
        av: ctx.meAv as CombatAvatar, feet: ctx.feet, vm: ctx.vm,
        fp: () => ctx.rig.distance < 0.9 && !rooms.stage,
        app: () => ctx.store.me?.app ?? null,
      },
      createAvatar: (app) => ctx.kit.create(app),
      viewHeight: () => el.height || 720,
      quality: () => engine.quality,
      anchor(id, x, y, z) {
        if (ctx.state.inRoom) { fighters.get(id)?.follow?.(x, y, z); return; }
        const a = ctx.anchors.get(id); if (a && a.y > -900) a.set(x, y, z);
      },
      reducedMotion: reduced,
    };
    const sys = new CombatSystem(host);
    ctx.dev.combat = sys;

    const why = (ignoreAim = false) => gate({
      enabled, locked: input.locked, gameplay: ctx.gameplay() && input.gameplay,
      menu: !!ctx.state.menu, modals: (input as InputEx).modals?.length ?? 0, photo, typing: isTyping(),
      stage: !!rooms.stage, busy: rooms.busy, room: ctx.state.inRoom ? rooms.kind : null,
      aimed: false,   // clicks never interact: LMB swings even on doors, goods and stones (E / F use them)
    });

    // capture phase on window: runs BEFORE the controls' canvas listener, so the bow draw is set up before
    // controls calls vm.swing() (which a drawing view-model ignores)
    const press = (e: MouseEvent) => {
      if (e.button !== 0 || e.target !== el) return;
      if (why() !== null) return;
      if (sys.press() && lsStr(HINT, '') !== '1') {
        lsSet(HINT, '1');
        ctx.ui.toast('Драки с котиками видишь только ты — сайту ничего не отправляется. Выключить: Настройки → Забавы');
      }
    };
    const up = (e: MouseEvent) => { if (e.button === 0) sys.release(); };
    const onSettings = (e: Event) => {
      const d = (e as CustomEvent).detail;
      if (d?.key !== KEY) return;
      enabled = d.value === 'on';
      if (!enabled) sys.reset();
    };
    const onPhoto = (e: Event) => { photo = !!(e as CustomEvent).detail?.on; if (photo) sys.cancel(); };
    window.addEventListener('mousedown', press, true);
    window.addEventListener('mouseup', up);
    window.addEventListener('l3d:settings', onSettings);
    window.addEventListener('l3d:photo', onPhoto);
    /**
     * One room frame, at the end of the room's own update: figures that stand still are put back on their spot (the
     * ragdoll reads "where it should be" from the root, like the crowd's site position), then combat poses ragdolls.
     * A shopkeeper who was just knocked over may grumble (at most every NPC_LINE_GAP s).
     */
    const roomFrame = (dt: number, t: number) => {
      if (rc) rc.fighters(collect);
      if (sys.drawing && why(true) !== null) sys.cancel();
      if (!enabled && !sys.busy) return;
      if (sys.ragdolls.size > 0) {
        for (const [id, f] of fighters) {
          if (!f.home || !sys.ragdolls.has(id)) continue;
          const r = f.av.root;
          r.position.set(f.home.x, f.home.y, f.home.z);
          r.rotation.x = 0; r.rotation.z = 0;
        }
      }
      sys.update(dt, t);
      for (const [id, f] of fighters) {
        const isDown = sys.ragdolls.has(id);
        if (isDown && !down.has(id)) {
          down.add(id);
          if (f.say && t - lineAt > NPC_LINE_GAP) { lineAt = t; f.say(NPC_LINES[Math.floor(Math.random() * NPC_LINES.length)], t); }
        } else if (!isDown && down.size && down.has(id)) down.delete(id);
      }
    };
    const collect = (f: RoomFighter) => { if (fighters.get(f.id) !== f) fighters.set(f.id, f); };
    // a room change swaps the space (and hides the crowd): everyone stands up, minions and arrows vanish
    const onRoom = () => {
      sys.reset();
      offAfter?.(); offAfter = null;
      fighters.clear(); down.clear(); lineAt = -Infinity;
      const sc = rooms.scene;
      rc = sc && rooms.kind && rooms.kind !== 'hybrid' ? roomCombatOf(sc) : null;
      room = sc ? roomEnv(rc?.space ?? sc, rc?.ceiling) : { body: nowhere, shots: nowhere };
      if (rc) offAfter = rc.afterUpdate(roomFrame);
    };
    const offRooms = rooms.onChange(onRoom);
    onRoom();

    const offFrame = ctx.onFrame((dt, t) => {
      if (ctx.state.inRoom && rc) return;   // rooms with fights run combat from their own update (roomFrame)
      if (sys.drawing && why(true) !== null) sys.cancel();
      if (!enabled && !sys.busy) return;
      sys.update(dt, t);
    });
    return () => {
      offFrame(); offRooms(); offRow(); offAfter?.();
      window.removeEventListener('mousedown', press, true);
      window.removeEventListener('mouseup', up);
      window.removeEventListener('l3d:settings', onSettings);
      window.removeEventListener('l3d:photo', onPhoto);
      sys.dispose();
      delete ctx.dev.combat;
    };
  },
});
