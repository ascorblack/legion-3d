/**
 * World module: builds the real-3D city from a CityLayout.
 *   buildCity(layout, { quality, renderer, art? }) → World3D
 * Static architecture is merged per material and x-chunk (few draw calls, frustum-culled by chunk); repeated props are
 * instanced (src/world/props kit, placeholder kinds as fallback); lamps are emissive + additive glow points with a
 * handful of real point lights near the camera at quality ≥ 2; moon shadows only at quality 3.
 */
import * as THREE from 'three';
import type { CityLayout, QualityLevel, World3D } from '../contracts';
import type { BuildCity } from '../contracts/modules';
import type { World3DExt, Interactable } from '../contracts/ext';
import { SolidMap, collectSolids, makeSolidTop } from './solid';
import { doorInteractables, renderMapImage, type MapImage } from './worldExt';
import { toX, toZ, fromX, fromZ } from './coords';
import { Batch, type BatchKey } from './batch';
import { groundSpec, makeGroundAt } from './ground';
import { paletteOf, parseGradient } from './palette';
import { SignAtlas, rng, dotTexture, moonTexture } from './textures';
import { Instancer } from './instancer';
import { registerProtoProps, LAMP_HEAD_Y } from './protoProps';
import { type Ctx, shade } from './kit';
import { buildStatic } from './static';
import { skyDome, stars, glowPoints } from './sky';
import { getTexture, setTexAnisotropy, disposeTextures } from './tex';
import { PropKit, PROP_KINDS, disposePropKit, type PropKind } from './props';
import { PoolLights } from './lightPools';
import { campOf, type CampLayout } from './camp';

export { createSvgArt } from './svgArt';
export { groundSpec, makeGroundAt } from './ground';

const MAX_LIGHTS = 6;
const BULB_COLS = ['#ffcf4a', '#ff8fa3', '#5fbfa8', '#7fb0e8', '#b79be0', '#f0903a', '#8fe07a'].map((c) => new THREE.Color(c));

/** String lights: sagging cables as one LineSegments + bulbs as one additive Points draw (0 triangles). */
function buildGarlands(spans: THREE.Vector3[][], glowTex: THREE.Texture): THREE.Group {
  const lines: number[] = [], bulbs: number[] = [];
  const a = new THREE.Vector3(), b = new THREE.Vector3();
  const at = (p: THREE.Vector3, q: THREE.Vector3, t: number, sag: number, out: THREE.Vector3) => { out.lerpVectors(p, q, t); out.y -= 4 * sag * t * (1 - t); return out; };
  let ci = 0;
  for (const span of spans) for (let i = 0; i + 1 < span.length; i++) {
    const p = span[i], q = span[i + 1], len = p.distanceTo(q), sag = len * 0.12, N = 12;
    for (let s = 0; s < N; s++) { at(p, q, s / N, sag, a); at(p, q, (s + 1) / N, sag, b); lines.push(a.x, a.y, a.z, b.x, b.y, b.z); }
    const n = Math.max(1, Math.floor(len / 0.4));
    for (let s = 0; s < n; s++) {
      at(p, q, (s + 0.5) / n, sag, a); const c = BULB_COLS[ci++ % BULB_COLS.length];
      bulbs.push(a.x, a.y - 0.05, a.z, 0.2, c.r * 1.4, c.g * 1.4, c.b * 1.4);
    }
  }
  const g = new THREE.Group(); g.name = 'world:garlands';
  const lg = new THREE.BufferGeometry(); lg.setAttribute('position', new THREE.Float32BufferAttribute(lines, 3));
  const cable = new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: '#2a2440' })); cable.name = 'fx:cable';
  g.add(cable);
  g.add(glowPoints(bulbs, 7, glowTex, { flicker: 0.05, intensity: 1.0 }));
  g.children[1].name = 'fx:bulbs';
  return g;
}

function makeMaterials(L: CityLayout, signs: SignAtlas): Record<BatchKey, THREE.Material> {
  const P = paletteOf(L.styleId), camp = !!campOf(L);
  const std = (kind: Parameters<typeof getTexture>[0], o: { rough?: number; ns?: number; colors?: string[]; neutral?: boolean; seed?: number; side?: THREE.Side; size?: number } = {}) => {
    const t = getTexture(kind, { neutral: o.neutral ?? true, colors: o.colors, seed: o.seed, size: o.size });
    const m = new THREE.MeshStandardMaterial({
      vertexColors: true, map: t.map, normalMap: t.normalMap ?? null, roughnessMap: t.roughnessMap ?? null,
      roughness: o.rough ?? 0.9, metalness: 0, side: o.side ?? THREE.FrontSide,
    });
    if (t.normalMap) m.normalScale.setScalar(o.ns ?? 0.8);
    return m;
  };
  const emit = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: true });
  emit.color.setScalar(1.3);
  const signMat = new THREE.MeshStandardMaterial({ map: signs.texture, emissiveMap: signs.texture, emissive: new THREE.Color('#ffffff'), emissiveIntensity: 0.45, roughness: 0.7, transparent: false, alphaTest: 0.5 });
  const water = getTexture('water', { colors: [P.water, P.waterD, '#dff4ff'] });
  const wMap = water.map.clone(); wMap.needsUpdate = true;
  const wNor = water.normalMap ? water.normalMap.clone() : null; if (wNor) wNor.needsUpdate = true;
  const waterMat = new THREE.MeshStandardMaterial({ map: wMap, normalMap: wNor, roughness: 0.15, metalness: 0.1, emissive: new THREE.Color(P.waterD), emissiveIntensity: 0.45, vertexColors: true });
  const mats: Record<BatchKey, THREE.Material> = {
    brick: std('brick', { rough: 0.95 }),
    plaster: std('plaster', { rough: 0.95, ns: 0.5 }),
    wood: std('wood', { rough: 0.85, ns: 0.6 }),
    roof: std(L.styleId === 'cats' ? 'slate' : 'roofTiles', { rough: 0.9, ns: 1.1 }),
    stone: std('stone', { rough: 0.95 }),
    rock: std('rock', { rough: 1, ns: 0.7 }),
    metal: Object.assign(std('metal', { rough: 0.6, ns: 0.4 }), { metalness: 0.35 }),
    canvas: std('canvas', { colors: ['#ffffff', '#f2f2f2'], rough: 0.95, ns: 0.4, side: THREE.DoubleSide }),
    // the camp: 'paving' = night grass, 'lowPaving' = trodden soil of the trails
    paving: camp ? std('grass', { neutral: false, colors: ['#3a5c40', '#31503a', '#4a6e4c'], rough: 1, ns: 0.35 })
      : std('cobble', { neutral: false, colors: [P.ground, shade(P.ground, 0.08), P.mortar, P.groundL], rough: 1, ns: 0.7, size: 1024 }),
    lowPaving: camp ? std('soil', { neutral: false, colors: ['#5a4232', '#45311f', '#6e5240'], rough: 1, ns: 0.7, seed: 3 })
      : std('cobble', { neutral: false, colors: [P.lowA, P.lowB, P.lowMortar, P.groundL], rough: 1, ns: 0.7, seed: 3, size: 1024 }),
    leaf: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 }),
    flat: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, side: THREE.DoubleSide }),
    dark: new THREE.MeshBasicMaterial({ color: '#100d17' }),
    glass: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.15, metalness: 0.4 }),
    back: new THREE.MeshLambertMaterial({ vertexColors: true }),
    emit, glow: emit, sign: signMat, water: waterMat,
  };
  // darker street: the lamp pools (lightPools.ts) carry the light, the paving no longer reads as a bright busy sheet
  (mats.paving as THREE.MeshStandardMaterial).color.setScalar(0.9);
  (mats.lowPaving as THREE.MeshStandardMaterial).color.setScalar(0.9);
  for (const [k, m] of Object.entries(mats)) m.name = 'city:' + k;
  return mats;
}

/** Kit kinds used as-is: unique "hero" props (few instances). Repeated props use the cheap placeholder kinds (tri budget). */
const HERO_KINDS = new Set<string>(['fountain', 'well', 'statue', 'dummy', 'signpost', 'cart', 'noticeBoard', 'chest']);
const KIT_KINDS = new Set<string>(PROP_KINDS.filter((k) => HERO_KINDS.has(k)));

/** buildCity options: the contract's + an optional door handler (also settable later: world.onDoor = fn). */
export type CityOpts = Parameters<BuildCity>[1] & { onDoor?: (id: string) => void };
/** What buildCity returns: World3D + World3DExt (+ the door handler slot). */
export type CityWorld = World3D & World3DExt & {
  /** Called by the door interactables' use() with the building id. */
  onDoor?: (id: string) => void;
  mapImage(renderer: THREE.WebGLRenderer, opts?: { pxPerMetre?: number }): Promise<MapImage>;
};

export { SUPPORTED_BUILDINGS } from './supported';
export { BUILDING_MODELS } from './buildings';

export const buildCity = async (layout: CityLayout, opts: CityOpts): Promise<CityWorld> => {
  const L = layout;
  const P = paletteOf(L.styleId);
  const root = new THREE.Group(); root.name = 'world';
  const renderer = opts.renderer;
  const maxAniso = renderer?.capabilities?.getMaxAnisotropy?.() ?? 4;
  setTexAnisotropy(Math.min(8, maxAniso));

  const spec = groundSpec(L);
  const groundAt = makeGroundAt(spec);
  const signs = new SignAtlas(P);
  const inst = new Instancer();
  registerProtoProps(inst, P);
  const batch = new Batch(14); batch.maxChunk = Math.max(1, Math.floor(toX(L.W) / 14));
  const k: Ctx = {
    b: batch, pal: P, signs, inst, glows: [], lights: [], bulbs: [], wires: [], rnd: rng(1234), quality: opts.quality,
    lowH: spec.lowH, wallZ: spec.hasLow ? toZ(spec.wallY) : 0, colliders: [], pools: [], solids: [],
  };

  // ------------------------------------------------ fonts for signs (best effort, never blocks for long)
  try {
    const f = (document as any).fonts;
    if (f?.load) await Promise.race([Promise.all([f.load("60px 'Russo One'"), f.load("60px 'Dela Gothic One'")]), new Promise((r) => setTimeout(r, 400))]);
  } catch { /* fallback fonts */ }

  // ------------------------------------------------ terrain, backdrop, buildings, fillers, props (static.ts)
  const lampHead = LAMP_HEAD_Y;
  const placed = buildStatic(k, L, spec, groundAt, lampHead);
  const glowsBeforeLamps = k.glows.length;
  for (let i = 0; i < placed.lampHeads.length; i += 3) {
    k.glows.push(placed.lampHeads[i], placed.lampHeads[i + 1], placed.lampHeads[i + 2], 1.7, 1, 0.78, 0.42);
    k.lights.push(placed.lampHeads[i], placed.lampHeads[i + 1], placed.lampHeads[i + 2]);
  }

  // ------------------------------------------------ materials + meshes
  const mats = makeMaterials(L, signs);
  const CAST = new Set<BatchKey>(['brick', 'plaster', 'wood', 'roof', 'stone', 'canvas', 'metal', 'rock']);
  // fake light pools / AO / macro variation / moon rim on every lit material (city + prop kit)
  const poolCand: number[] = [];
  for (let i = 0; i + 6 < k.glows.length; i += 7) {
    const s = k.glows[i + 3], lamp = i >= glowsBeforeLamps;   // street lamps: wide strong pools; windows/braziers: small soft ones
    if (s < 0.9 && !lamp) continue;
    poolCand.push(k.glows[i], k.glows[i + 1], k.glows[i + 2], lamp ? 7.5 : Math.min(4.2, 1.6 + s * 1.3), k.glows[i + 4], k.glows[i + 5], k.glows[i + 6], lamp ? 1.1 : 0.45);
  }
  for (const v of k.pools ?? []) poolCand.push(v);
  const pools = new PoolLights(poolCand, k.wallZ || 1e6, spec.lowH);
  const POOL_OPTS: Partial<Record<BatchKey, { vary?: number; ao?: number; gain?: number; rim?: number; gao?: number; dim?: number }>> = {
    paving: { vary: 0.3, ao: 0, gain: 1.2, rim: 0.05, gao: 0.6, dim: 0.4 }, lowPaving: { vary: 0.3, ao: 0, gain: 1.2, rim: 0.05, gao: 0.6, dim: 0.4 },
    brick: { vary: 0.14 }, plaster: { vary: 0.12 }, rock: { vary: 0.16, ao: 0.35 }, wood: { vary: 0.12 }, stone: { vary: 0.16 }, roof: { vary: 0.18, ao: 0, rim: 0.3 },
    metal: { vary: 0.05, ao: 0.2 }, canvas: { vary: 0.06, ao: 0.2 }, leaf: { vary: 0.2, ao: 0.2, rim: 0.3 }, flat: { vary: 0.08, ao: 0.3 },
  };
  for (const [key, o] of Object.entries(POOL_OPTS)) pools.patch(mats[key as BatchKey], o);
  for (const key of ['paint', 'wood', 'stone', 'metal', 'cloth', 'roof'] as const) {
    try { pools.patch(PropKit.material(key), { vary: 0.06, ao: 0.25 }); } catch { /* kit without that material */ }
  }
  const statics = k.b.build(mats, { castShadow: (m) => CAST.has(m), receiveShadow: (m) => m !== 'back' && m !== 'emit' && m !== 'sign' });
  const city = new THREE.Group(); city.name = 'world:static';
  for (const m of statics) city.add(m);
  root.add(city);

  // coarse camera colliders: one invisible merged box mesh (raycast target for the TP camera)
  const colGeo = (() => {
    const c = k.colliders, n = Math.floor(c.length / 6), pos: number[] = [], idx: number[] = [];
    for (let i = 0; i < n; i++) {
      const [x0, x1, y0, y1, z0, z1] = c.slice(i * 6, i * 6 + 6), o = i * 8;
      for (let v = 0; v < 8; v++) pos.push(v & 1 ? x1 : x0, v & 2 ? y1 : y0, v & 4 ? z1 : z0);
      for (const f of [[0, 2, 3, 1], [4, 5, 7, 6], [0, 1, 5, 4], [2, 6, 7, 3], [0, 4, 6, 2], [1, 3, 7, 5]]) idx.push(o + f[0], o + f[1], o + f[2], o + f[0], o + f[2], o + f[3]);
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx);
    g.computeBoundingSphere(); g.computeBoundingBox();
    return g;
  })();
  const colMat = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
  const colliders = new THREE.Mesh(colGeo, colMat);
  colliders.name = 'world:colliders'; colliders.visible = false; colliders.userData.cameraCollider = true;
  colliders.matrixAutoUpdate = false; colliders.updateMatrix();
  root.add(colliders);

  const props = new THREE.Group(); props.name = 'world:props';
  const kitGroups: THREE.Object3D[] = [];
  for (const [kind, list] of inst.placed) {
    if (!KIT_KINDS.has(kind)) continue;
    try {
      const variantKinds = kind === 'tree';
      const g = PropKit.instanced(kind as PropKind, list.map((p) => ({ x: p.x, y: p.y, z: p.z, rotY: p.rotY, scale: p.scale })), variantKinds ? { variant: 0 } : {});
      props.add(g); kitGroups.push(g);
    } catch (e) { console.warn('[world] prop kit failed for', kind, e); }
  }
  // contact blob shadows under every placed prop (one instanced quad draw, multiply-darkening radial texture)
  const BLOB_R: Record<string, number> = { lamp: 0.55, bench: 0.9, barrel: 0.5, crate: 0.55, bed: 1.1, tree: 1.5, bush: 0.8, mast: 0.4,
    fountain: 1.9, well: 1.5, statue: 1.2, dummy: 0.6, signpost: 0.5, cart: 1.4, noticeBoard: 1.0, chest: 0.6, planter: 0.6, stall: 1.8 };
  let blobN = 0;
  for (const [kind, list] of inst.placed) if (BLOB_R[kind]) blobN += list.length;
  const blobGeo = new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2);
  const blobMat = new THREE.MeshBasicMaterial({ map: getTexture('glow').map, color: '#000000', transparent: true, opacity: 0.7, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, fog: true });
  blobMat.name = 'city:blob';
  const blobs = new THREE.InstancedMesh(blobGeo, blobMat, Math.max(1, blobN));
  blobs.name = 'world:blobs'; blobs.renderOrder = 1;
  {
    const bm = new THREE.Matrix4(); let i = 0;
    for (const [kind, list] of inst.placed) {
      const r = BLOB_R[kind]; if (!r) continue;
      for (const p of list) { const s = r * (p.scale || 1); bm.makeScale(s, 1, s).setPosition(p.x, groundAt(fromX(p.x), fromZ(p.z)) + 0.015, p.z); blobs.setMatrixAt(i++, bm); }
    }
    blobs.count = i; blobs.instanceMatrix.needsUpdate = true; blobs.computeBoundingSphere();
  }
  props.add(blobs);
  const usedKit = new Set(kitGroups.map((g) => g.name.replace('props:', '')));
  for (const m of inst.build(mats as unknown as Record<string, THREE.Material>, (kind) => !usedKit.has(kind))) props.add(m);
  // garlands
  const garland = buildGarlands(placed.garlands, getTexture('glow').map);
  props.add(garland);
  root.add(props);

  // ------------------------------------------------ glows, sky, lights
  const dot = dotTexture();
  const glowTex = getTexture('glow').map;
  const glows = glowPoints(k.glows, 7, glowTex, { flicker: 0.1, intensity: 0.55 });   // halos stay under the bloom threshold
  root.add(glows);

  const sky = skyDome(L.sky || P.sky);
  root.add(sky);
  const starPts = stars(opts.quality >= 1 ? 900 : 350, dot);
  root.add(starPts);
  const moonTex = moonTexture();
  const moon = new THREE.Sprite(new THREE.SpriteMaterial({ map: moonTex, depthWrite: false, fog: false, transparent: true }));
  moon.scale.setScalar(46); moon.renderOrder = -8;
  const moonDir = new THREE.Vector3(-0.45, 0.55, -0.7).normalize();
  root.add(moon);

  const grad = parseGradient(L.sky || P.sky);
  const horizon = new THREE.Color(grad[grad.length - 1].c), zenith = new THREE.Color(grad[0].c);
  // fog = the sky's (brightened) horizon band, so distant structures fade into the glow, nearer ones silhouette
  const fogCol = (sky.userData.horizon as THREE.Color | undefined)?.clone() ?? horizon.clone();
  const fog = new THREE.Fog(fogCol, 34, 260);

  // the camp has only the fire, torches and tent lanterns (no street lamps): a little more moonlight on the meadow
  const campLit = !!campOf(L);
  const hemi = new THREE.HemisphereLight(new THREE.Color('#8f9cff'), new THREE.Color('#4a2c30'), campLit ? 1.45 : 1.15);
  root.add(hemi);
  const amb = new THREE.AmbientLight(new THREE.Color('#5a5490'), campLit ? 0.42 : 0.3);
  root.add(amb);
  const sun = new THREE.DirectionalLight(new THREE.Color('#bcc8ff'), 1.7);
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -22; sun.shadow.camera.right = 22; sun.shadow.camera.top = 22; sun.shadow.camera.bottom = -22;
  sun.shadow.camera.near = 1; sun.shadow.camera.far = 120;
  sun.shadow.bias = -0.0006; sun.shadow.normalBias = 0.03;
  root.add(sun); root.add(sun.target);

  const lights: THREE.PointLight[] = [];
  for (let i = 0; i < MAX_LIGHTS; i++) {
    const l = new THREE.PointLight(new THREE.Color('#ffb062'), 0, 9, 1.6);
    l.castShadow = false; lights.push(l); root.add(l);
  }
  const candN = Math.floor(k.lights.length / 3);
  const cand = Float32Array.from(k.lights);
  const best = new Int32Array(MAX_LIGHTS);
  const bestD = new Float32Array(MAX_LIGHTS);

  // ------------------------------------------------ doors
  const doors = L.buildings.map((b) => ({
    id: b.id, title: b.title, icon: b.icon, soon: !!b.soon,
    pos: new THREE.Vector3(toX(b.door.x), groundAt(b.door.x, b.door.y), toZ(b.door.y)),
  }));

  // ------------------------------------------------ quality
  let q: QualityLevel = opts.quality;
  function setQuality(nq: QualityLevel): void {
    q = nq;
    const shadows = q >= 3;
    sun.castShadow = shadows;
    for (const m of statics) { m.castShadow = shadows && CAST.has(m.name.slice(5) as BatchKey); }
    props.traverse((o) => {
      if (!(o as THREE.Mesh).isMesh) return;
      if (o.userData.cast0 === undefined) o.userData.cast0 = o.castShadow;
      o.castShadow = shadows && !!o.userData.cast0;
    });
    for (let i = 0; i < MAX_LIGHTS; i++) lights[i].visible = q >= 2 && i < (q >= 3 ? MAX_LIGHTS : 4);
    starPts.geometry.setDrawRange(0, q >= 1 ? 900 : 350);
    glows.visible = true;
    pools.setCount(q === 0 ? 8 : q === 1 ? 12 : 16);
    (fog as THREE.Fog).far = q === 0 ? 120 : 230;
    garland.visible = q >= 1;
  }
  setQuality(q);

  // ------------------------------------------------ per frame
  const _cp = new THREE.Vector3(), _cd = new THREE.Vector3();
  let sceneHooked = false, lightTimer = 0;
  const bulbMat = (garland.children[1] as THREE.Points).material as THREE.ShaderMaterial;
  const glowMat = glows.material as THREE.ShaderMaterial, starMat = starPts.material as THREE.ShaderMaterial;
  const waterMat = (k as unknown as { _w?: THREE.MeshStandardMaterial })._w || (statics.find((m) => m.name === 'city:water')?.material as THREE.MeshStandardMaterial | undefined);
  function update(dt: number, t: number, camera: THREE.Camera): void {
    if (!sceneHooked) {
      let s: THREE.Object3D = root; while (s.parent) s = s.parent;
      if ((s as THREE.Scene).isScene) { (s as THREE.Scene).fog = fog; (s as THREE.Scene).background = zenith; sceneHooked = true; }
    }
    camera.getWorldPosition(_cp);
    camera.getWorldDirection(_cd);
    pools.update(_cp.x, _cp.z, _cd.x, _cd.z, dt);
    sky.position.copy(_cp); starPts.position.copy(_cp);
    moon.position.set(_cp.x + moonDir.x * 240, _cp.y + moonDir.y * 240, _cp.z + moonDir.z * 240);
    glowMat.uniforms.uTime.value = t; starMat.uniforms.uTime.value = t; bulbMat.uniforms.uTime.value = t;
    const ph = (camera as THREE.PerspectiveCamera).isPerspectiveCamera ? (camera as THREE.PerspectiveCamera) : null;
    if (ph && renderer) {
      const hpx = renderer.domElement.height || 720;
      glowMat.uniforms.uScale.value = bulbMat.uniforms.uScale.value = hpx / (2 * Math.tan((ph.fov * Math.PI / 180) / 2));
      starMat.uniforms.uPx.value = Math.max(1, hpx / 720);
    }
    if (waterMat && waterMat.map) {
      waterMat.map.offset.set(t * 0.03, t * 0.012);
      if (waterMat.normalMap) waterMat.normalMap.offset.set(-t * 0.02, t * 0.025);
    }
    // moonlight follows the camera so the shadow frustum covers what we see
    sun.position.set(_cp.x + moonDir.x * 50, moonDir.y * 50, _cp.z + moonDir.z * 50);
    sun.target.position.set(_cp.x, 0, _cp.z - 3);
    // nearest point lights (every 0.25 s)
    lightTimer -= dt;
    if (q >= 2 && lightTimer <= 0 && candN) {
      lightTimer = 0.25;
      const n = q >= 3 ? MAX_LIGHTS : 4;
      for (let i = 0; i < n; i++) { best[i] = -1; bestD[i] = 1e9; }
      for (let c = 0; c < candN; c++) {
        const dx = cand[c * 3] - _cp.x, dz = cand[c * 3 + 2] - _cp.z, d = dx * dx + dz * dz;
        if (d >= bestD[n - 1]) continue;
        let j = n - 1;
        while (j > 0 && bestD[j - 1] > d) { bestD[j] = bestD[j - 1]; best[j] = best[j - 1]; j--; }
        bestD[j] = d; best[j] = c;
      }
      for (let i = 0; i < n; i++) {
        const l = lights[i], c = best[i];
        if (c < 0) { l.intensity = 0; continue; }
        l.position.set(cand[c * 3], cand[c * 3 + 1], cand[c * 3 + 2]);
        l.intensity = 1.6;
      }
    }
    if (q >= 2) for (let i = 0; i < MAX_LIGHTS; i++) { const l = lights[i]; if (l.intensity > 0) l.intensity = 1.5 + 0.2 * Math.sin(t * 7 + i * 1.7) * Math.sin(t * 2.1 + i); }
  }

  function dispose(): void {
    root.removeFromParent();
    root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry && !kitGroups.some((g) => g === o.parent)) m.geometry.dispose();
    });
    for (const g of kitGroups) PropKit.disposeObject(g);
    garland.traverse((o) => { const m = o as THREE.Mesh; m.geometry?.dispose(); (m.material as THREE.Material | undefined)?.dispose(); });
    for (const m of Object.values(mats)) m.dispose();
    colMat.dispose(); blobMat.dispose();
    (sky.material as THREE.Material).dispose(); starMat.dispose(); glowMat.dispose(); (moon.material as THREE.Material).dispose();
    signs.texture.dispose(); dot.dispose(); moonTex.dispose();
    const wm = mats.water as THREE.MeshStandardMaterial; wm.map?.dispose(); wm.normalMap?.dispose();
    inst.dispose();
    disposePropKit();
    disposeTextures();
    sun.dispose(); hemi.dispose(); amb.dispose(); for (const l of lights) l.dispose();
  }

  // ------------------------------------------------ jumping (solid tops), door interactables, map image
  const solidMap = new SolidMap(collectSolids(L, spec, k.solids ?? [], inst));
  const solidTop = makeSolidTop(L, solidMap);
  let inter: Interactable[] | null = null;
  const mapCache = new Map<number, Promise<MapImage>>();
  const world: CityWorld = {
    root, groundAt, doors, spawn: (L as CampLayout).spawn ? [...(L as CampLayout).spawn!] as [number, number] : L.id === 'fair' ? [L.QW + 660, 1010] : L.nearest((L.area.x0 + L.area.x1) / 2, (L.area.y0 + L.area.y1) / 2), update, setQuality, dispose, solidTop,
    onDoor: opts.onDoor,
    interactables: () => (inter ||= doorInteractables(L, groundAt, () => world.onDoor)),
    mapImage(r, o = {}) {
      const ppm = o.pxPerMetre ?? 12;
      let p = mapCache.get(ppm);
      if (!p) { p = renderMapImage(r, root, L, ppm); mapCache.set(ppm, p); p.catch(() => mapCache.delete(ppm)); }
      return p;
    },
  };
  return world;
};
// the contract's signature (game.ts passes the plain options)
export const buildCityContract: BuildCity = buildCity;
