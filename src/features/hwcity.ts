/**
 * «Ночь Тыквенной Луны» (site 28.10): mirrors the site's `hero.hwc = { look, portal }` (/api/me, SSE `me`) in the 3D
 * Fair city — only the Fair; the camp «Перепутье» and district towns stay as they are (streamer's decision):
 *  - look   → our Halloween decoration is forced on (even outside its dates in «Авто»; «Выкл» still wins) with the
 *             site's extras (cauldron, candles, witch on a broom, more bats and cobwebs), and the city turns «dead»
 *             (src/events/halloween/dead.ts: desaturated, cold, lamps / windows / garland bulbs off, pumpkins lit);
 *  - portal → a portal at the gate (src/events/halloween/portal.ts) and every cat, the own hero too (TP body and FP
 *             paws), drawn as a ghost.
 * Changes live (no reload) with smooth transitions; everything is undone when the night ends, the town changes or the
 * setting «События → Ночь Тыквенной Луны» is off. Dev pages: `?hwc=look|portal|lp|off` (dev/game.ts).
 * Budget: portal 3 draw calls (frame, vortex, street glow), grading 0 (shader tail on existing materials), ghosts 0.
 */
import * as THREE from 'three';
import { registerSettingRow, settingValue } from '../ui/settings-ext';
import { setEventOverride } from './seasonal';
import { halloweenOpts } from '../events/halloween';
import { parseHwc, hwcMode, modeKey, portalSpot, HW_OFF, type HwMode, type PortalSpot } from '../events/halloween/hwcity';
import { DeadGrade } from '../events/halloween/dead';
import { buildPortal, type Portal } from '../events/halloween/portal';
import { GhostCrowd, type CrowdEntry } from '../events/halloween/ghosts';
import { fromX, fromZ, toX } from '../world/coords';
import type { Appearance } from '../contracts';
import type { World3DExt } from '../contracts/ext';
import { coreFeature } from './types';

export const HWCITY_SETTING = 'l3d.hwcity';
const DEAD_SEC = 2.6, PORTAL_SEC = 1.8;

/** Front face (m) of the gatehouse above the arch: a ray from the street at the wall. */
function gateFacadeZ(root: THREE.Object3D, x: number, y: number): number {
  const statics = (root.getObjectByName('world:static')?.children ?? []) as THREE.Mesh[];
  const ray = new THREE.Raycaster(new THREE.Vector3(x, y, 3), new THREE.Vector3(0, 0, -1), 0, 5);
  for (const h of ray.intersectObjects(statics, false)) {
    if (h.object.name === 'city:sign' || h.object.name === 'city:glass') continue;
    if (h.point.z > -1.2 && h.point.z < 0.3) return h.point.z;
  }
  return -0.15;
}

export default coreFeature({
  id: 'hwcity',
  order: 86,
  setup(ctx) {
    const offRow = registerSettingRow({
      key: HWCITY_SETTING, label: 'Ночь Тыквенной Луны', group: 'События', order: 12,
      sub: 'Когда стример включает ночь на сайте: портал у ворот Ярмарки, «мёртвый» город и все котики-призраки (понарошку, только вид)',
      kind: 'seg', options: [['on', 'Вкл'], ['off', 'Выкл']], def: 'on',
    });
    const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    let want: HwMode = HW_OFF;
    let world: unknown = null;
    let dead: DeadGrade | null = null, deadK = 0;
    let portal: Portal | null = null, portalK = 0, spot: PortalSpot | null = null, facadeZ = 0;
    const ghosts = new GhostCrowd(3);
    const group = new THREE.Group(); group.name = 'hwcity'; ctx.scene.add(group);

    const crowd = (): Iterable<CrowdEntry> => ((ctx.dev.avatars as Map<string, CrowdEntry> | undefined)?.values() ?? []);
    const me = () => (ctx.store.me ? { av: ctx.meAv, app: ctx.store.me.app as Appearance } : null);

    const dropWorld = () => {
      if (dead) { dead.dispose(); dead = null; }
      if (portal) { portal.dispose(); portal = null; }
      deadK = 0; portalK = 0; spot = null;
    };

    const evaluate = () => {
      const w = ctx.world();
      if (w !== world) { dropWorld(); world = w; }
      const m = hwcMode(parseHwc(ctx.store.hero?.hwc), ctx.layout()?.id, settingValue<string>(HWCITY_SETTING, 'on') !== 'off');
      const lookChanged = m.look !== want.look;
      want = m;
      if (lookChanged || !m.look) {
        halloweenOpts.hw = m.look;
        setEventOverride(m.look ? 'halloween' : null, m.look ? 'hw' : '', () => ctx.layout()?.id === 'fair');
      }
      if (m.dead && !dead) dead = new DeadGrade(w.root);
      if (m.portal && !portal) {
        const L = ctx.layout();
        const g = L.buildings.find((b) => b.id === 'gate');
        facadeZ = g ? gateFacadeZ(w.root, toX(g.door.x), 3.4) : 0;
        spot = g ? portalSpot(L, (X, Z) => w.groundAt(fromX(X), fromZ(Z)), facadeZ, (w as Partial<World3DExt>).solidTop?.bind(w)) : null;
        if (spot) { portal = buildPortal(spot, reduced); portal.setOpen(0); group.add(portal.group); }
      }
      ghosts.on = m.ghosts;
    };

    const offHero = ctx.store.on('hero', evaluate);
    const offWorld = ctx.onWorld(() => evaluate());
    const onSet = (e: Event) => { const k = (e as CustomEvent).detail?.key; if (!k || k === HWCITY_SETTING) evaluate(); };
    window.addEventListener('l3d:settings', onSet);
    evaluate();

    let ghostT = 0;
    const offFrame = ctx.onFrame((dt, t) => {
      group.visible = !ctx.state.inRoom;
      // dead grading: fade in / out, removed (materials restored) once fully faded out
      if (dead) {
        deadK = Math.max(0, Math.min(1, deadK + (want.dead ? dt : -dt) / (reduced ? 0.4 : DEAD_SEC)));
        dead.set(ctx.state.inRoom ? 0 : deadK * deadK * (3 - 2 * deadK));
        if (!want.dead && deadK <= 0) { dead.dispose(); dead = null; }
      }
      if (portal) {
        portalK = Math.max(0, Math.min(1, portalK + (want.portal ? dt : -dt) / (reduced ? 0.3 : PORTAL_SEC)));
        portal.setOpen(portalK); portal.update(t);
        if (!want.portal && portalK <= 0) { portal.dispose(); portal = null; spot = null; }
      }
      // ghosts: a few avatars per frame while something changes, a cheap check twice a second otherwise
      ghostT -= dt;
      if (ghostT <= 0 && !ctx.state.inRoom) {
        const n = ghosts.sync(crowd(), me(), ctx.vm.root);
        ghostT = n > 0 ? 0 : 0.5;
      }
    });
    const offWalk = ctx.store.on('walkers', () => { ghostT = 0; });

    ctx.dev.hwcity = {
      mode: () => ({ ...want, key: modeKey(want) }),
      state: () => ({ deadK, portalK, spot, facadeZ, dead: dead?.counts ?? null, ghosts: ghosts.count, settled: ghosts.settled(crowd()) }),
      evaluate,
    };
    return () => {
      offFrame(); offHero(); offWorld(); offWalk(); window.removeEventListener('l3d:settings', onSet); offRow();
      ghosts.dispose(crowd(), me(), ctx.vm.root);
      dropWorld(); group.removeFromParent();
      if (halloweenOpts.hw) { halloweenOpts.hw = false; setEventOverride(null); }
    };
  },
});
