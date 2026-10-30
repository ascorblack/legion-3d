/**
 * Fair microscope (idea #7): aim at a building SIGN (or the statue) and press F (or E) for a small local card «что здесь» —
 * a few built-in Russian lines per building id plus a hint to the neighbouring landmark. Registered through the interact
 * system as proximity-free hit boxes over each sign; they are DISABLED whenever another interactable is near (shop goods,
 * doors, mine stones), so they never steal F «Осмотреть» or E «Войти». Pure texts/maths: src/explore/landmarks.ts.
 */
import * as THREE from 'three';
import type { Interactable } from '../contracts/ext';
import { registerSettingRow, settingValue } from '../ui/settings-ext';
import { toX, toZ, fromX, fromZ } from '../world/coords';
import { entranceZ } from '../world/buildings';
import { landmarkText, hintLine, type LandmarkPos } from '../explore/landmarks';
import { coreFeature } from './types';
import { setHtml } from '../core/html';

export const LANDMARKS_KEY = 'l3d.world.landmarks';
const SHOW_MS = 9000;

export default coreFeature({
  id: 'landmarks',
  order: 92,
  setup(ctx) {
    const offRow = registerSettingRow({ key: LANDMARKS_KEY, label: 'Ярмарочный микроскоп', sub: 'Посмотрите на вывеску и нажмите F — карточка «что здесь»', group: 'Мир', order: 30, kind: 'seg', options: [['1', 'Вкл'], ['0', 'Выкл']], def: '1' });
    const card = document.createElement('div');
    card.setAttribute('role', 'status');
    card.style.cssText = 'position:fixed;left:3%;top:30%;transform:translate(0,8px);z-index:62;width:min(300px,56vw);pointer-events:none;opacity:0;transition:opacity .25s ease,transform .25s ease;'
      + 'padding:10px 14px 11px;border-radius:14px;background:rgba(13,11,34,.86);border:1px solid rgba(255,214,140,.35);box-shadow:0 6px 24px rgba(0,0,0,.4);'
      + 'color:#e9e2ff;font:13px/1.45 system-ui,sans-serif';
    ctx.uiRoot.appendChild(card);
    let hideT = 0, shownId = '';
    const hide = () => { card.style.opacity = '0'; card.style.transform = 'translate(0,8px)'; shownId = ''; clearTimeout(hideT); };

    const list: LandmarkPos[] = [];
    let offs: (() => void)[] = [];
    let nearOther = false;     // another interactable is near (previous frame): the signs step aside
    const on = () => settingValue<string>(LANDMARKS_KEY, '1') !== '0';
    const _d = new THREE.Vector3();
    const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));

    const show = (lm: LandmarkPos) => {
      if (shownId === lm.id && card.style.opacity === '1') { hide(); return; }
      const t = landmarkText(lm.id);
      ctx.camera.getWorldDirection(_d);
      const f = ctx.feet;
      const hint = hintLine(list, lm, f.x, f.z, _d.x, _d.z);
      setHtml(card, `<div style="font-weight:700;font-size:14px;color:#fbe9b8">${t.icon} ${esc(lm.title)}</div>`
        + `<div style="margin-top:3px">${esc(t.what)}</div><div style="margin-top:4px;color:#b9b0e6">${esc(t.tip)}</div>`
        + (hint ? `<div style="margin-top:6px;padding-top:5px;border-top:1px solid rgba(255,255,255,.12);color:#ffd9a0">Рядом: ${esc(hint)}</div>` : ''));
      shownId = lm.id; card.style.opacity = '1'; card.style.transform = 'translate(0,0)';
      clearTimeout(hideT); hideT = window.setTimeout(hide, SHOW_MS);
    };

    const build = () => {
      for (const u of offs) u(); offs = []; list.length = 0; hide();
      const w = ctx.world(), L = ctx.layout();
      const items: { lm: LandmarkPos; box: THREE.Box3 }[] = [];
      for (const b of L.buildings) {
        const cx = toX((b.hit[0] + b.hit[1]) / 2), half = Math.min(1.7, toX(b.hit[1] - b.hit[0]) / 2);
        const ez = entranceZ(b), g = w.groundAt(b.door.x, b.door.y);
        const lm = { id: b.id, title: b.title, x: cx, z: toZ(b.door.y) };
        list.push(lm);
        // the sign zone: above the door leaf's hit box (which ends at 0.3 m before the entrance plane) so the door always wins the ray
        items.push({ lm, box: new THREE.Box3(new THREE.Vector3(cx - half, g + 1.7, ez - 2.4), new THREE.Vector3(cx + half, g + 4.8, ez + 0.2)) });
      }
      const st = L.low?.statue as [number, number] | undefined;
      if (st) {
        const x = toX(st[0]), z = toZ(st[1]), g = w.groundAt(st[0], st[1]);
        const lm = { id: 'statue', title: 'Статуя героя', x, z }; list.push(lm);
        items.push({ lm, box: new THREE.Box3(new THREE.Vector3(x - 0.8, g, z - 0.8), new THREE.Vector3(x + 0.8, g + 2.6, z + 0.8)) });
      }
      for (const { lm, box } of items) {
        const it: Interactable = {
          id: 'landmark:' + lm.id, label: `Осмотреть: ${lm.title}`, icon: landmarkText(lm.id).icon, hit: box,
          reach: 14, proximity: false,
          enabled: () => on() && !nearOther && !ctx.state.inRoom && ctx.gameplay(),
          use: () => show(lm), alt: { label: 'Что здесь?', use: () => show(lm) },
          highlight: () => { /* no silhouette: the prompt is enough, the box covers wall and sign */ },
        };
        offs.push(ctx.interact.add(it));
      }
    };
    build();
    const offW = ctx.onWorld(() => build());
    const offF = ctx.onFrame(() => {
      const n = ctx.interact.near;
      nearOther = !!n && !n.id.startsWith('landmark:');
      if (shownId && (ctx.state.inRoom || !ctx.gameplay())) hide();
    });
    ctx.dev.landmarks = { list, show, hide, ids: () => list.map((l) => l.id), fromX, fromZ };
    return () => { offF(); offW(); for (const u of offs) u(); hide(); card.remove(); offRow(); };
  },
});
