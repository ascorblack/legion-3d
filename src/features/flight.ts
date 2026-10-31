/**
 * «Летать за мага» (owner request 2026-10-27): heroes of the magic classes (mage / necromancer / priest, or a staff,
 * crook or tome in the paw) levitate. Space twice (the second press in the air) or Space held through a jump takes
 * off; in the air Space = up, X or Ctrl = down, WASD = fly, Shift = faster; down to the ground or Space twice = soft
 * landing. Max 8 m above what is under you on the street, a 1 m hover in the 3D shops and the mine (ceilings); hybrid
 * rooms, menus, DOM cards, photo mode and the classic site end the flight with a gentle landing. Others get a hint
 * «летают маги».
 *
 * Free 3D flight on the street (owner feedback v0.4.0): a top-down height field of the built city
 * (src/flight/heightfield.ts, one depth render per world, built lazily) is the controller's fly map — you fly over
 * the canal, fences, the mine outcrop and every walk-grid gap, bump into walls only below their tops, and can land on
 * roofs (PlayerControllerEx.setFlyMap, src/engine/player.ts). Limits: the city edges (and the back of the facade row).
 * No landing on water (the hover keeps 0.45 m). The height is never sent; the site gets the nearest walkable point
 * (src/flight/sendpoint.ts via site.moveTo). Setting: Настройки → Забавы → «Полёт магов».
 * Cost: one shared particle draw call (src/combat/funfx.ts) + a one-frame ground ring; bone tweaks on the own avatar;
 * the height field: one off-screen draw of the city when first needed (≈ 550 × 300 cells, 0.66 MB).
 */
import { canFly, FlightLogic, FLY } from '../flight/rules';
import { FlightLook } from '../flight/visual';
import { acquireFunFx } from '../combat/funfx';
import type { CombatAvatar } from '../combat/ragdoll';
import { isTyping, onPageKeys, type InputEx } from '../engine/input';
import { funToggle, reducedMotion, sfx } from '../social/toggle';
import { lsStr, lsSet } from '../core/settings';
import { coreFeature } from './types';
import { gridTop, renderHeightGrid, type HeightGrid } from '../flight/heightfield';
import { walkablePoint } from '../flight/sendpoint';
import { SX, SZ, Y0, toX, toZ } from '../world/coords';
import type { CityLayout } from '../contracts';

const KEY = 'l3d.fun.flight', HINT = 'l3d.fun.flight.hint';
const FLY_ROOMS = new Set(['shop3d', 'mine3d']);

export default coreFeature({
  id: 'flight',
  order: 24,   // after the crowd (20); the own avatar was animated by the core before every feature
  setup(ctx) {
    const { input, rooms, engine } = ctx;
    const inp = input as InputEx;
    const logic = new FlightLogic(), look = new FlightLook();
    const tg = funToggle(KEY, 'Полёт магов', 'Маги, некроманты и жрецы летают: Space дважды — взлететь, Space — выше, X или Ctrl — ниже. Над крышами, речкой и заборами; сайт видит обычную ходьбу', 50, (on) => { if (!on) ctx.controller().setFlyMap(null); });
    const reduced = reducedMotion();
    const fun = acquireFunFx({ scene: ctx.scene, camera: ctx.camera, onFrame: ctx.onFrame, viewHeight: () => engine.renderer.domElement.height || 720 });
    /* ---- the 3D fly map (built lazily per world) ---- */
    let grid: HeightGrid | null = null, gridFor: unknown = null, gridFail = 0;
    let bx0 = 0, bx1 = 0, bz0 = 0, bz1 = 0, water: number[] = [];
    const BACK_Z = -5.6;   // m: how far behind the facade line you may fly (over the roofs of the back row)
    const flyTop = (x: number, y: number): number => {
      const X = x * SX, Z = (y - Y0) * SZ;
      if (!(X >= bx0 && X <= bx1 && Z >= bz0 && Z <= bz1)) return Infinity;
      if (!grid) return Infinity;   // never fly through walls on a missing map (setFlyMap(null) follows)
      const t = gridTop(grid, X, Z);
      if (t > -Infinity) return t;
      const g = ctx.world().groundAt(x, y);
      return Number.isFinite(g) ? g : 0;
    };
    const overWater = (x: number, y: number): boolean => {
      for (let i = 0; i < water.length; i += 4) if (x >= water[i] && x <= water[i + 2] && y >= water[i + 1] && y <= water[i + 3]) return true;
      return false;
    };
    const buildGrid = (): boolean => {
      const w = ctx.world(), L = ctx.store.layout as CityLayout | null;
      if (!L || !w) return false;
      if (grid && gridFor === w) return true;
      if (gridFail > 2) return false;
      try {
        const t0 = performance.now();
        bx0 = toX(L.area.x0) + 0.25; bx1 = toX(L.area.x1) - 0.25; bz0 = BACK_Z; bz1 = toZ(L.area.y1) - 0.15;
        water = [];
        for (const o of L.obstacles) if ('b' in o && o.water) water.push(o.b[0], o.b[1], o.b[2], o.b[3]);
        grid = renderHeightGrid(engine.renderer, w.root, bx0 - 1, bx1 + 1, bz0 - 1.5, bz1 + 1, 10);
        gridFor = w;
        dev.gridMs = Math.round(performance.now() - t0);
        return true;
      } catch (e) {
        gridFail++; grid = null; gridFor = null;
        console.warn('[l3d] flight: no 3D fly map (flying stays on the walk grid)', e);
        return false;
      }
    };
    /** Give the controller the fly map when it is wanted and ready (street, setting on, a mage). */
    const syncMap = () => {
      const ctl = ctx.controller();
      const want = tg.on && mage() && !ctx.state.inRoom;
      if (want && (gridFor === ctx.world() || buildGrid())) ctl.setFlyMap(flyTop);
      else if (!ctl.free3d) ctl.setFlyMap(null);
    };
    // a new world (town switch): the controller was put back on the walk grid (setSpace); rebuild the map later
    const offWorld = ctx.onWorld(() => { grid = null; gridFor = null; gridFail = 0; buildT = 1.5; ctx.controller().setFlyMap(null); });
    let buildT = 2.5;   // s: build the map a moment after the start (not on the first frame), then on world changes

    const dev = { logic, look, force: false, allowed: () => allowed(), mage: () => mage(), fx: fun.fx, gridMs: -1,
      grid: () => grid, flyTop, overWater,
      /** What the site would get for the current position (sendpoint.walkablePoint). */
      sendPoint: () => { const c = ctx.controller(); return walkablePoint(ctx.store.layout, c.x, c.y); } };
    ctx.dev.flight = dev;
    let photo = false, down = false, denyAt = -Infinity, now = 0, wasFlying = false;
    let prevPhase: FlightLogic['phase'] = 'off';

    const mage = () => dev.force || canFly(ctx.store.me?.app);
    const allowed = () => {
      if (!tg.on || photo || !mage()) return false;
      if (!ctx.gameplay() || ctx.state.classic || (inp.modals?.length ?? 0) > 0) return false;
      if (rooms.busy || rooms.stage) return false;
      return !ctx.state.inRoom || FLY_ROOMS.has(rooms.kind || '');
    };
    const maxH = () => (ctx.state.inRoom ? FLY.maxRoom : FLY.maxStreet);
    const keyOk = () => input.gameplay && !isTyping();

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'KeyX') { if (keyOk() && !e.ctrlKey && !e.metaKey && !e.altKey) down = true; return; }
      if (e.code === 'ControlLeft' || e.code === 'ControlRight') return;   // read from input.ctrl (held while flying)
      if (e.code !== 'Space' || e.repeat || !keyOk()) return;
      const ctl = ctx.controller();
      const r = logic.tap(ctl.airborne, allowed(), Math.max(0, ctl.feetY - ctl.ground), maxH());
      if (r === 'deny' && tg.on && now - denyAt > 20 && !ctx.state.inRoom) {
        denyAt = now;
        ctx.ui.toast('Летают маги: маг, некромант или жрец (посох, гримуар…). Ты пока просто прыгаешь 🙂');
      }
    };
    const onKeyUp = (e: KeyboardEvent) => { if (e.code === 'KeyX') down = false; };
    const onBlur = () => { down = false; };
    const onPhoto = (e: Event) => { photo = !!(e as CustomEvent).detail?.on; };
    const offKeys = [onPageKeys('keydown', onKeyDown), onPageKeys('keyup', onKeyUp)];   // before the input's site key shield stops them
    window.addEventListener('blur', onBlur);
    window.addEventListener('l3d:photo', onPhoto);
    // the help screen lists the key; X only does something while flying
    const offKey = ctx.registries.keys.register('flight.down', {
      code: 'KeyX', label: 'Полёт мага: ниже (или Ctrl; Space дважды — взлететь)',
      run: () => logic.phase !== 'off',
    });

    function takeOff() {
      const f = ctx.feet;
      sfx('fly.up', { x: f.x, y: f.y, z: f.z });
      if (lsStr(HINT, '') !== '1') {
        lsSet(HINT, '1');
        ctx.ui.toast('Полёт! Space — выше, X или Ctrl — ниже, Space дважды — приземлиться. Можно сесть на крышу');
      }
      const fx = fun.fx, R = () => fx.rnd();
      for (let i = 0; i < 14; i++) {
        const a = (i / 14) * Math.PI * 2;
        fx.emit(4 /* SH_SPARK */, f.x, f.y + 0.1, f.z, Math.cos(a) * 2.2, 0.6 + R(), Math.sin(a) * 2.2, 0.35, 0.12, 0.03, 0.75, 0.9, 1, 1, -2, 3, true, a);
      }
      fx.ring(f.x, ctx.controller().ground, f.z, 0.2, 1.4, 0.5, '#bfe8ff', 0.9, 0.3);
    }

    const offFrame = ctx.onFrame((dt, t) => {
      now += dt;
      const ctl = ctx.controller();
      if (buildT > 0) { buildT -= dt; if (buildT <= 0) syncMap(); }
      // a room change / teleport ends the flight inside the controller
      if (logic.phase !== 'off' && wasFlying && !ctl.flying) logic.reset();
      const above = Math.max(0, ctl.feetY - ctl.ground);
      const street = !ctx.state.inRoom;
      inp.holdCtrl = logic.phase !== 'off';   // Ctrl = down (a bare Ctrl does not release WASD while flying)
      const floor = street && ctl.free3d && overWater(ctl.x, ctl.y) ? 0.45 : 0;
      const h = logic.update(dt, { up: keyOk() && inp.jump, down: (down || inp.ctrl) && keyOk(), airborne: ctl.airborne, above, allowed: allowed(), max: maxH(), floor });
      if (logic.phase === 'fly' && prevPhase === 'off') { if (street) syncMap(); takeOff(); }
      prevPhase = logic.phase;
      if (h !== null) ctl.setFlight(h);
      else if (ctl.flying) ctl.setFlight(null);
      wasFlying = ctl.flying || h !== null;
      // the look: pose, bob, ground glow, sparkles (also while the pose eases out after landing)
      const av = ctx.meAv as CombatAvatar;
      const on = logic.phase !== 'off';
      if (on || look.k > 0) {
        const bob = look.pose(av.combatRig?.() ?? null, dt, t, on, above, ctl.speed / 230, reduced);
        if (bob) av.root.position.y += bob;
        const app = ctx.store.me?.app;
        look.effects(fun.fx, dt, t, ctx.feet.x, ctx.feet.y + bob, ctx.feet.z, ctl.ground, av.root.rotation.y, String(app?.role || 'mage'), engine.quality, reduced);
      }
    });

    return () => {
      offFrame(); offKey(); offWorld(); tg.dispose(); fun.release();
      inp.holdCtrl = false;
      for (const f of offKeys) f();
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('l3d:photo', onPhoto);
      const ctl = ctx.controller(); if (ctl.flying) ctl.setFlight(null);
      ctl.setFlyMap(null);   // off a roof: back onto the walk grid
      grid = null;
      delete ctx.dev.flight;
    };
  },
});
