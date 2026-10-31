/**
 * World3DExt pieces of the city (src/contracts/ext.ts): door interactables with 3D hit boxes and the top-down map image.
 */
import * as THREE from 'three';
import type { CityLayout } from '../contracts';
import type { Interactable } from '../contracts/ext';
import { toX, toZ } from './coords';
import { entranceZ, modelOf, BUILDING_XF } from './buildings';

/**
 * One interactable per site building: a Box3 over the door opening (from the entrance plane 0.45 m into the building
 * to 0.3 m in front of it, ground → lintel). 'soon' buildings: the box also covers the sign / scaffold board above
 * the door and the label says so. use() → onDoor(id) (the game opens the room / the site's screen).
 */
export function doorInteractables(L: CityLayout, groundAt: (x: number, y: number) => number, onDoor: () => ((id: string) => void) | undefined): Interactable[] {
  return L.buildings.map((b) => {
    const m = modelOf(b), sc = BUILDING_XF.get(b)?.s ?? 1, hw = (m.door?.hw ?? 0.7) * sc, h = (m.door?.h ?? 2.3) * sc;   // a building lower down the street is drawn bigger
    const x = toX(b.door.x), zE = entranceZ(b), g = groundAt(b.door.x, b.door.y);
    const top = g + (b.soon ? Math.max(h, 3.4) : h);
    const hit = new THREE.Box3(new THREE.Vector3(x - hw, g, zE - 0.45), new THREE.Vector3(x + hw, top, zE + 0.3));
    // 30.10 «Тюрьма и клетка»: nobody enters — the house, the cage and the prisoners in it all open the site's Jail window
    if (b.jail || b.id === 'jail') {
      hit.min.x = toX(b.hit[0]) + 0.1; hit.max.x = toX(b.hit[1]);
      hit.max.y = g + 2.3; hit.max.z = toZ(b.hit[3]) + 0.3;
      return { id: 'door:' + b.id, label: `${b.title}: кто в клетке`, icon: b.icon, hit, reach: 3.0, use: () => { onDoor()?.(b.id); } };
    }
    // the door point itself must be within proximity reach even if it is far in front of the facade
    const dz = toZ(b.door.y) - (zE + 0.3);
    const it: Interactable = {
      id: 'door:' + b.id,
      label: b.soon ? `${b.title} — скоро` : `Войти: ${b.title}`,
      icon: b.icon,
      hit,
      reach: Math.max(3.0, 2.2 + Math.max(0, dz)),
      use: () => { onDoor()?.(b.id); },
    };
    return it;
  });
}

export interface MapImage { url: string; width: number; height: number; x0: number; z0: number; x1: number; z1: number }

/**
 * Orthographic top-down render of the city root (sky, stars, moon, glow sprites, far silhouettes and fog hidden,
 * bright neutral light so roofs and paving read like a map). North (the facades, −Z) is up; x grows to the right.
 * Bounds are world metres; 1 image px = 1 / pxPerMetre m. Rendered into a WebGLRenderTarget, read back, flipped,
 * encoded to a WebP (PNG fallback) data URL.
 */
export async function renderMapImage(renderer: THREE.WebGLRenderer, root: THREE.Object3D, L: CityLayout, pxPerMetre = 12): Promise<MapImage> {
  const x0 = toX(L.area.x0) - 2.5, x1 = toX(L.area.x1) + 2.5, z0 = -8, z1 = toZ(L.area.y1) + 2.2;
  const maxTex = Math.min(4096, renderer.capabilities?.maxTextureSize || 4096);
  const ppm = Math.max(2, Math.min(pxPerMetre, maxTex / (x1 - x0), maxTex / (z1 - z0)));
  const W = Math.round((x1 - x0) * ppm), H = Math.round((z1 - z0) * ppm);
  const cam = new THREE.OrthographicCamera(x0, x1, -z0, -z1, 1, 200);
  cam.position.set(0, 80, 0); cam.up.set(0, 0, -1); cam.lookAt(0, 0, 0); cam.updateMatrixWorld(); cam.updateProjectionMatrix();

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#1c1838');
  const parent = root.parent, hidden: THREE.Object3D[] = [];
  root.traverse((o) => {
    const n = o.name || '';
    const hide = n.startsWith('sky:') || n.startsWith('fx:') || n === 'city:back' || (o as THREE.Sprite).isSprite || (o as THREE.Light).isLight;
    if (hide && o.visible) { o.visible = false; hidden.push(o); }
  });
  const hemi = new THREE.HemisphereLight('#fff6e8', '#9a8aa8', 3.6);
  const sun = new THREE.DirectionalLight('#fff2dc', 3.0); sun.position.set(-20, 60, -25); sun.target.position.set(0, 0, 0);
  const amb = new THREE.AmbientLight('#ffffff', 0.9);
  scene.add(hemi, sun, sun.target, amb, root);
  const rt = new THREE.WebGLRenderTarget(W, H, { samples: 4, colorSpace: THREE.SRGBColorSpace });
  const prevRT = renderer.getRenderTarget(), prevTM = renderer.toneMapping, prevShadow = renderer.shadowMap.autoUpdate;
  const buf = new Uint8Array(W * H * 4);
  try {
    renderer.shadowMap.autoUpdate = false;
    renderer.setRenderTarget(rt);
    renderer.clear();
    renderer.render(scene, cam);
    renderer.readRenderTargetPixels(rt, 0, 0, W, H, buf);
  } finally {
    renderer.setRenderTarget(prevRT); renderer.toneMapping = prevTM; renderer.shadowMap.autoUpdate = prevShadow;
    scene.remove(root);
    if (parent) parent.add(root);
    for (const o of hidden) o.visible = true;
    rt.dispose(); hemi.dispose(); sun.dispose(); amb.dispose();
  }
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d')!;
  const img = g.createImageData(W, H);
  for (let y = 0; y < H; y++) img.data.set(buf.subarray((H - 1 - y) * W * 4, (H - y) * W * 4), y * W * 4);   // GL rows are bottom-up
  g.putImageData(img, 0, 0);
  let url = c.toDataURL('image/webp', 0.9);
  if (!url.startsWith('data:image/webp')) url = c.toDataURL('image/png');
  return { url, width: W, height: H, x0, z0, x1, z1 };
}
