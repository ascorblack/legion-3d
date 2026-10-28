/**
 * Goods gallery: every consumable model of the item-model registry (src/avatar/items.ts) in a grid, per art style —
 * the per-style kitchens (styles/<id>/goods.js) side by side with the site's drawings.
 * ?style=cherts|cats|…  ?bg=#hex   window.__goods = { tris }
 */
import * as THREE from 'three';
import { createRegistries } from '../src/core/registries';
import { registerItemModels, buildItemModel } from '../src/avatar/items';
import { ITEM_FOODS } from '../src/avatar/supported';

const q = new URLSearchParams(location.search), style = q.get('style') || 'cats';
const reg = createRegistries();
registerItemModels(reg.itemModels, () => style);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(1); renderer.setSize(innerWidth, innerHeight);
document.getElementById('app')!.appendChild(renderer.domElement);
const scene = new THREE.Scene(); scene.background = new THREE.Color(q.get('bg') || '#2a1018');
scene.add(new THREE.HemisphereLight('#fff4e8', '#4a3040', 1.6));
const sun = new THREE.DirectionalLight('#ffffff', 2.2); sun.position.set(2, 4, 5); scene.add(sun);
const items: { slot: string; id: string; name: string; effect?: Record<string, unknown> }[] = [
  ...ITEM_FOODS.filter((f) => f !== 'fish').map((id) => ({ slot: 'food', id, name: '' })),
  { slot: 'potion', id: 'potion_small', name: 'Малое зелье', effect: { heal: 10 } }, { slot: 'potion', id: 'potion_hp', name: 'Большое зелье', effect: { heal: 40 } },
  { slot: 'scroll', id: 'scroll_revive', name: 'Свиток', effect: { revive: true } },
];
const cols = 5, S = 1.0, camera = new THREE.PerspectiveCamera(30, innerWidth / innerHeight, 0.1, 50);
const rows = Math.ceil(items.length / cols);
camera.position.set(0, 1.6, 9.2); camera.lookAt(0, 0.05, 0); camera.updateMatrixWorld();
let tris = 0;
items.forEach((it, i) => {
  const o = buildItemModel(reg.itemModels, { ...it, rarity: 'common' } as any);
  const box = new THREE.Box3().setFromObject(o), sz = box.getSize(new THREE.Vector3()), k = 0.7 / Math.max(sz.x, sz.y, sz.z);
  o.scale.setScalar(k);
  const x = ((i % cols) - (cols - 1) / 2) * S * 1.25, y = ((rows - 1) / 2 - Math.floor(i / cols)) * S * 1.05 - 0.3;
  o.position.set(x, y, 0); o.rotation.y = -0.25; scene.add(o);
  const m = o.getObjectByName('item-model') as THREE.Mesh; tris += (m.geometry.index ? m.geometry.index.count : m.geometry.attributes.position.count) / 3;
  const v = new THREE.Vector3(x, y - 0.12, 0).project(camera), lb = document.createElement('div'); lb.className = 'lb';
  lb.style.left = ((v.x + 1) / 2 * innerWidth) + 'px'; lb.style.top = ((1 - v.y) / 2 * innerHeight) + 'px'; lb.textContent = it.id + ' · ' + (m.geometry.index ? m.geometry.index.count / 3 : 0);
  document.body.appendChild(lb);
});
renderer.render(scene, camera);
(window as any).__goods = { tris };
