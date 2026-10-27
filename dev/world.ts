/**
 * Dev page for the 3D city (src/world). Fixture layout, orbit / free-fly camera.
 * URL options:
 *   ?cam=x,y        first-person camera (eye height) at px point (x, y) looking at the facades (−Z)
 *   &yaw=deg        turn the FP camera (0 = facades, 90 = left, 180 = towards the canal)
 *   &pitch=deg      look up/down
 *   &tp=1           third-person-ish view (behind and above the point)
 *   &q=0..3         quality (default 2)
 *   &map=1          show world.mapImage() (top-down map) over the view
 * HUD: solidTop (jumping) under the camera, door interactable count.
 *   (art: buildCity takes opts.art but the real-3D city does not use it for facades)
 * Keys: WASD/arrows fly (Shift = fast), Q/E down/up; mouse = orbit.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { fixtureLayout, campFixtureLayout } from './fixtures';
import { buildCity } from '../src/world';
import { toX, toZ, fromX, fromZ, EYE } from '../src/world/coords';
import type { QualityLevel } from '../src/contracts';

const qs = new URLSearchParams(location.search);
const hud = document.getElementById('hud')!;
const app = document.getElementById('app')!;

(async () => {
  const q = Math.max(0, Math.min(3, +(qs.get('q') ?? 2))) as QualityLevel;
  const renderer = new THREE.WebGLRenderer({ antialias: q >= 3 });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
  renderer.setSize(innerWidth, innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.AgXToneMapping;
  renderer.shadowMap.enabled = q >= 3;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  app.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(72, innerWidth / innerHeight, 0.05, 400);
  camera.rotation.order = 'YXZ';

  const layout = qs.get('town') === 'camp' ? campFixtureLayout() : fixtureLayout();
  const t0 = performance.now();
  const world = await buildCity(layout, { quality: q, renderer });
  const buildMs = performance.now() - t0;
  scene.add(world.root);

  let controls: OrbitControls | null = null;
  const cam = qs.get('cam');
  if (cam) {
    const [x, y] = cam.split(',').map(Number);
    const g = world.groundAt(x, y);
    const yaw = (+(qs.get('yaw') ?? 0)) * Math.PI / 180, pitch = (+(qs.get('pitch') ?? 4)) * Math.PI / 180;
    camera.position.set(toX(x), g + EYE, toZ(y));
    camera.rotation.set(pitch, yaw, 0);
    if (qs.get('tp')) {
      const back = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw)).multiplyScalar(3.2);
      camera.position.add(back).add(new THREE.Vector3(0.6 * Math.cos(yaw), 0.9, -0.6 * Math.sin(yaw)));
      camera.rotation.set(pitch - 0.12, yaw, 0);
    }
  } else {
    const [sx, sy] = world.spawn;
    camera.position.set(toX(sx), 9, toZ(sy) + 16);
    controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(toX(sx), 1.5, toZ(sy) - 2);
    controls.update();
  }

  const keys = new Set<string>();
  addEventListener('keydown', (e) => keys.add(e.code));
  addEventListener('keyup', (e) => keys.delete(e.code));
  addEventListener('resize', () => { renderer.setSize(innerWidth, innerHeight); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); });

  const fwd = new THREE.Vector3(), right = new THREE.Vector3();
  let last = performance.now(), t = 0, fps = 60, frames = 0;
  // THREE + layout exposed for the visibility sweep (.local/w4-sweep.mjs: reachable viewpoints → contact sheets)
  (window as any).__world = { world, camera, renderer, scene, THREE, layout };
  /** Triangle / draw-call breakdown by mesh name (for perf work). */
  (window as any).__worldStats = () => {
    const by: Record<string, [number, number]> = {}; let tris = 0, calls = 0;
    world.root.traverse((o: any) => {
      if (!o.geometry || !o.visible) return;
      const g = o.geometry as THREE.BufferGeometry;
      const n = (g.index ? g.index.count : g.attributes.position.count) / 3 * (o.isInstancedMesh ? o.count : 1);
      const key = String(o.name).split(':').slice(0, 2).join(':');
      (by[key] ||= [0, 0]); by[key][0] += o.isPoints ? 0 : n; by[key][1]++; tris += o.isPoints ? 0 : n; calls++;
    });
    return { tris: Math.round(tris), calls, by: Object.fromEntries(Object.entries(by).sort((a, b) => b[1][0] - a[1][0]).map(([k, v]) => [k, [Math.round(v[0]), v[1]]])) };
  };
  function frame(now: number): void {
    const dt = Math.min(0.1, (now - last) / 1000); last = now; t += dt;
    fps += (1 / Math.max(dt, 1e-3) - fps) * 0.05;
    const sp = (keys.has('ShiftLeft') ? 18 : 6) * dt;
    camera.getWorldDirection(fwd); right.crossVectors(fwd, camera.up).normalize();
    const mv = new THREE.Vector3();
    if (keys.has('KeyW') || keys.has('ArrowUp')) mv.add(fwd);
    if (keys.has('KeyS') || keys.has('ArrowDown')) mv.sub(fwd);
    if (keys.has('KeyD') || keys.has('ArrowRight')) mv.add(right);
    if (keys.has('KeyA') || keys.has('ArrowLeft')) mv.sub(right);
    if (keys.has('KeyE')) mv.y += 1;
    if (keys.has('KeyQ')) mv.y -= 1;
    if (mv.lengthSq()) { mv.normalize().multiplyScalar(sp); camera.position.add(mv); controls?.target.add(mv); }
    controls?.update();
    world.update(dt, t, camera);
    renderer.render(scene, camera);
    if (++frames % 15 === 1) {
      const i = renderer.info.render;
      hud.textContent = `world dev · q${q} · build ${buildMs.toFixed(0)} ms\nfps ${fps.toFixed(0)} · calls ${i.calls} · tris ${(i.triangles / 1000).toFixed(0)}k\n` +
        `cam ${camera.position.x.toFixed(1)}, ${camera.position.y.toFixed(1)}, ${camera.position.z.toFixed(1)}` +
        ` · solidTop ${world.solidTop(fromX(camera.position.x), fromZ(camera.position.z)).toFixed(2)} · doors ${world.interactables().length}`;
    }
    if (!(cam && qs.get('still')) || frames < 3) requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  (window as any).__ready = true;
  if (qs.get('map')) {
    const m = await world.mapImage(renderer, { pxPerMetre: +(qs.get('ppm') ?? 12) });
    const img = document.createElement('img');
    img.src = m.url; img.title = `${m.width}×${m.height} px · x ${m.x0}…${m.x1} m · z ${m.z0}…${m.z1} m`;
    img.style.cssText = 'position:fixed;left:8px;bottom:8px;max-width:70vw;border:2px solid #fff6;border-radius:6px';
    document.body.appendChild(img);
  }
})().catch((e) => { hud.textContent = 'error: ' + (e?.stack || e); console.error(e); });
