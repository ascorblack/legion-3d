/**
 * «Проверка геометрии» (Settings → Отладка, off by default; dev pages: `game.html?lint=1`): runs the geometry lint
 * (src/world/lint) over the current town — the static city rebuilt in memory with a recorder, so the live world is not
 * touched — logs the findings to the console (grouped by class) and marks each one in the world with a red pin
 * (a sphere on a thin stalk; magenta = door / outline, orange = stairs / rails). Rebuilt when the town changes,
 * removed when switched off. Nothing per frame; costs one city rebuild (~0.3–1 s) per run.
 */
import * as THREE from 'three';
import { registerSettingRow, settingValue } from '../ui/settings-ext';
import { lintWorld, formatFindings, type LintFinding } from '../world/lint';
import { lintTownSource } from '../world/lint/town';
import { coreFeature } from './types';

export const LINT_SETTING = 'l3d.geomlint';
const COLOR: Partial<Record<LintFinding['cls'], string>> = { door: '#ff40ff', outline: '#ff40ff', stairs: '#ff9a20', rails: '#ff9a20', onramp: '#ff9a20' };

/** Red pins over the findings (one merged mesh per colour). */
export function lintMarkers(fs: readonly LintFinding[]): THREE.Group {
  const g = new THREE.Group(); g.name = 'lint:markers';
  const byCol = new Map<string, LintFinding[]>();
  for (const f of fs) { const c = COLOR[f.cls] ?? '#ff2020'; let l = byCol.get(c); if (!l) byCol.set(c, (l = [])); l.push(f); }
  const ball = new THREE.SphereGeometry(0.12, 8, 6), stalk = new THREE.CylinderGeometry(0.015, 0.015, 1, 4);
  for (const [c, l] of byCol) {
    const mat = new THREE.MeshBasicMaterial({ color: c, depthTest: false, transparent: true, opacity: 0.9 });
    const balls = new THREE.InstancedMesh(ball, mat, l.length), stalks = new THREE.InstancedMesh(stalk, mat, l.length);
    const m = new THREE.Matrix4();
    l.forEach((f, i) => {
      const [x, y, z] = f.at;
      balls.setMatrixAt(i, m.makeTranslation(x, y + 1.2, z));
      stalks.setMatrixAt(i, m.makeScale(1, 1.2, 1).setPosition(x, y + 0.6, z));
    });
    balls.renderOrder = stalks.renderOrder = 999;
    balls.name = 'lint:pin'; stalks.name = 'lint:stalk';
    g.add(balls, stalks);
  }
  g.userData.dispose = () => { ball.dispose(); stalk.dispose(); g.traverse((o) => { const im = o as THREE.InstancedMesh; if (im.isInstancedMesh) (im.material as THREE.Material).dispose(); }); };
  return g;
}

export default coreFeature({
  id: 'geomlint',
  order: 135,
  setup(ctx) {
    const offRow = registerSettingRow({
      key: LINT_SETTING, label: 'Проверка геометрии', group: 'Отладка', order: 20,
      sub: 'Ищет кривую геометрию (висящие и утонувшие предметы, двойные двери, лестницы, рельсы, растянутые текстуры): красные метки в городе, список в консоли',
      kind: 'seg', options: [['off', 'Выкл'], ['on', 'Вкл']], def: 'off',
    });
    const forced = typeof location !== 'undefined' && /[?&]lint=1\b/.test(location.search);
    let pins: THREE.Group | null = null;
    const clear = () => { if (!pins) return; pins.removeFromParent(); (pins.userData.dispose as () => void)?.(); pins = null; };
    const run = () => {
      clear();
      if (!forced && settingValue<string>(LINT_SETTING, 'off') !== 'on') return;
      const world = ctx.world(), L = ctx.layout();
      if (!world?.root || !L) return;
      try {
        const src = lintTownSource(L.id, L, 2);
        const r = lintWorld(src);
        (window as unknown as { __l3dLint?: unknown }).__l3dLint = r;
        console.groupCollapsed?.(`[l3d] geometry lint ${L.id}: ${r.findings.length} findings`);
        console.log(formatFindings(r, 400));
        console.groupEnd?.();
        pins = lintMarkers(r.findings);
        world.root.add(pins);
      } catch (e) { console.warn('[l3d] geometry lint failed', e); }
    };
    const onSet = (e: Event) => { if ((e as CustomEvent).detail?.key === LINT_SETTING) run(); };
    window.addEventListener('l3d:settings', onSet);
    const offW = ctx.onWorld(() => setTimeout(run, 0));
    if (forced || settingValue<string>(LINT_SETTING, 'off') === 'on') setTimeout(run, 0);
    return () => { offRow(); offW(); window.removeEventListener('l3d:settings', onSet); clear(); };
  },
});
