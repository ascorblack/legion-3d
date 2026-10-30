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
import { getTexture, setTexAnisotropy, setTexQuality, disposeTextures, cloneTex, type TexKind } from './tex';
import { surfaceDetail, configureSurface, setSurfaceQuality, type SurfaceOpts } from './tex/surface';
import { PropKit, PROP_KINDS, disposePropKit, type PropKind } from './props';
import { PoolLights, type PoolOpts } from './lightPools';
import { createMotes } from './motes';
import { createFoliage, windPatch } from './foliage';
import { scatterFoliage, plantRects } from './scatter';
import { patchWater, WATER_T } from './water';
import { toZ as _toZ } from './coords';
import { campOf, type CampLayout } from './camp';
import { campThemeOf } from './camp-themes';
import { villageOf, villageGround, VK } from './village';
import type { SitePals } from './palette';

/** The city palette of a layout: its style + the page's own quarter colours (layout.sitePals, read by the site adapter). */
export const layoutPalette = (L: CityLayout) => paletteOf(L.styleId, (L as CityLayout & { sitePals?: SitePals }).sitePals);

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
      bulbs.push(a.x, a.y - 0.05, a.z, 0.13, c.r * 1.3, c.g * 1.3, c.b * 1.3);   // small crisp bulbs (0.2 m read as lens bokeh)
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

/**
 * The city's materials (one per batch key). Textures follow the quality level (tex/ setTexQuality); every tiled
 * material gets the surface-detail shader (tex/surface.ts: macro variation, per-element per-tile tint, grime from the
 * ground, moss, wet patches, anti-tiling of organic kinds). Style tints come from the vertex colours and the palette
 * colours passed to the coloured kinds (paving, grass, soil, water / lava).
 */
function makeMaterials(L: CityLayout, signs: SignAtlas): Record<BatchKey, THREE.Material> {
  const P = layoutPalette(L), camp = !!campOf(L), CT = camp ? campThemeOf(L.styleId) : null;
  const V = villageOf(L), VG = V ? villageGround(V.biome) : null;   // a hand village: the biome's grass and road soil
  const std = (kind: TexKind, o: { rough?: number; ns?: number; colors?: string[]; neutral?: boolean; seed?: number; side?: THREE.Side; size?: number; sd?: SurfaceOpts } = {}) => {
    const t = getTexture(kind, { neutral: o.neutral ?? true, colors: o.colors, seed: o.seed, size: o.size });
    const m = new THREE.MeshStandardMaterial({
      vertexColors: true, map: t.map, normalMap: t.normalMap ?? null, roughnessMap: t.roughnessMap ?? null,
      roughness: o.rough ?? 0.9, metalness: 0, side: o.side ?? THREE.FrontSide,
    });
    if (t.normalMap) m.normalScale.setScalar(o.ns ?? 0.8);
    if (o.sd) surfaceDetail(m, { ...o.sd, ids: t.ids ? o.sd.ids : 0, antiTile: t.organic && o.sd.antiTile !== false });
    return m;
  };
  const emit = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: true });
  emit.color.setScalar(1.3);
  const signMat = new THREE.MeshStandardMaterial({ map: signs.texture, emissiveMap: signs.texture, emissive: new THREE.Color('#ffffff'), emissiveIntensity: 0.45, roughness: 0.7, transparent: false, alphaTest: 0.5 });
  // the cherts quarter (P.hell): the canal / ponds are lava — crust plates with glowing cracks (emissive map)
  const water = P.hell ? getTexture('lava', { colors: [P.rockD, shade(P.rockD, -0.35), P.water, '#ffd84a'] }) : getTexture('water', { colors: [P.water, P.waterD, '#dff4ff'] });
  const wMap = cloneTex(water.map), wNor = water.normalMap ? cloneTex(water.normalMap) : null, wEm = water.emissiveMap ? cloneTex(water.emissiveMap) : null;
  const waterMat = new THREE.MeshStandardMaterial({ map: wMap, normalMap: wNor, roughness: P.hell ? 0.85 : 0.15, metalness: P.hell ? 0 : 0.1, vertexColors: true,
    emissive: new THREE.Color(P.hell ? '#ffffff' : P.waterD), emissiveMap: wEm, emissiveIntensity: P.hell ? 1.7 : 0.45 });
  if (P.hell) waterMat.roughnessMap = water.roughnessMap ?? null;
  const soot = !!P.hell;
  // grime / moss by mood: soot and ash in the boiler quarter, earthy dirt and green moss elsewhere
  const wall = { macro: 0.2, hue: 0.14, ids: 0.2, dirt: 0.75, dirtH: 1.0, moss: soot ? 0.1 : 0.35 };
  const mats: Record<BatchKey, THREE.Material> = {
    brick: std('brick', { rough: 0.95, sd: wall }),
    plaster: std('plaster', { rough: 0.95, ns: 0.6, sd: { ...wall, dirt: 0.55, dirtH: 1.2, moss: soot ? 0.05 : 0.15 } }),
    wood: std('wood', { rough: 0.85, ns: 0.7, sd: { macro: 0.1, hue: 0.06, ids: 0.14, dirt: 0.55, dirtH: 0.8, moss: soot ? 0 : 0.15 } }),
    roof: std(L.styleId === 'cats' ? 'slate' : 'roofTiles', { rough: 0.9, ns: 1.1, sd: { macro: 0.16, hue: 0.1, ids: 0.18, moss: soot ? 0.15 : 0.45 } }),
    stone: std('stone', { rough: 0.95, ns: 0.9, sd: { ...wall, moss: soot ? 0.1 : 0.45 } }),
    rock: std(P.hell ? 'basalt' : 'rock', { rough: 1, ns: 0.8, sd: { macro: 0.16, hue: 0.1, ids: 0.1, moss: soot ? 0 : 0.25 } }),
    metal: Object.assign(std('metal', { rough: 0.6, ns: 0.45, sd: { macro: 0.06, hue: 0.04, dirt: 0.25, dirtH: 0.6, roughVar: 0.3 } }), { metalness: 0.35 }),
    canvas: std('canvas', { colors: ['#ffffff', '#f2f2f2'], rough: 0.95, ns: 0.9, side: THREE.DoubleSide, sd: { macro: 0.12, hue: 0.1, dirt: 0.5, dirtH: 0.7 } }),
    // the camp / villages: 'paving' = night grass, 'lowPaving' = trodden dirt of the trails and roads
    paving: camp || VG ? std('grass', { neutral: false, colors: VG ? VG[0] : CT ? [...CT.grass] : ['#3a5c40', '#31503a', '#4a6e4c'], rough: 1, ns: 0.5, sd: { macro: 0.22, hue: 0.16 } })
      : std('cobble', { neutral: false, colors: [P.ground, shade(P.ground, 0.08), P.mortar, P.groundL], rough: 1, ns: 0.7, size: 1024, sd: { macro: 0.16, hue: 0.12, ids: 0.14, moss: soot ? 0 : 0.1, roughVar: 0.15 } }),
    lowPaving: camp || VG ? std('path', { neutral: false, colors: VG ? VG[1] : CT ? [...CT.soil] : ['#5a4232', '#45311f', '#6e5240'], rough: 1, ns: 0.8, seed: 3, sd: { macro: 0.18, hue: 0.12 } })
      : std('cobble', { neutral: false, colors: [P.lowA, P.lowB, P.lowMortar, P.groundL], rough: 1, ns: 0.7, seed: 3, size: 1024, sd: { macro: 0.16, hue: 0.12, ids: 0.14, moss: soot ? 0 : 0.15, roughVar: 0.15 } }),
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

/** Texture quality, anisotropy and the surface shader's ground model for one city (before any texture is requested). */
function setupSurfaces(q: number, maxAniso: number, wallZ: number, lowH: number, P: ReturnType<typeof layoutPalette>): void {
  setTexQuality(q);
  setTexAnisotropy(q >= 2 ? Math.min(16, maxAniso) : q === 1 ? Math.min(4, maxAniso) : 2);
  configureSurface({ wallZ, lowH, quality: q, dirt: P.hell ? '#4a3c3c' : '#6a5440', moss: P.hell ? '#3a302e' : '#4f6a34' });
}

/** The prop kit's shared materials get the surface detail too (no moss: the kit is also used indoors). */
function detailPropKit(): void {
  const o: Record<string, SurfaceOpts> = { wood: { macro: 0.07, dirt: 0.25, dirtH: 0.5 }, stone: { macro: 0.1, ids: 0.1, dirt: 0.3, dirtH: 0.6 },
    metal: { macro: 0.05, roughVar: 0.3 }, cloth: { macro: 0.06, dirt: 0.25, dirtH: 0.5 }, roof: { macro: 0.12, ids: 0.1 } };
  for (const [key, so] of Object.entries(o)) {
    try { const m = PropKit.material(key as Parameters<typeof PropKit.material>[0]) as THREE.MeshStandardMaterial; surfaceDetail(m, { ...so, ids: m.roughnessMap ? so.ids : 0 }); } catch { /* kit without that material */ }
  }
}

const mixHex = (a: string, b: string, t: number) => '#' + new THREE.Color(a).lerp(new THREE.Color(b), t).getHexString();

/** Kit kinds used as-is: unique "hero" props (few instances). Repeated props use the cheap placeholder kinds (tri budget). */
const HERO_KINDS = new Set<string>(['fountain', 'well', 'statue', 'dummy', 'signpost', 'cart', 'noticeBoard', 'chest']);
const KIT_KINDS = new Set<string>(PROP_KINDS.filter((k) => HERO_KINDS.has(k)));
type PropTransformList = { x: number; y: number; z: number; rotY: number; scale: number }[];

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
  const P = layoutPalette(L);
  const root = new THREE.Group(); root.name = 'world';
  const renderer = opts.renderer;
  const maxAniso = renderer?.capabilities?.getMaxAnisotropy?.() ?? 4;

  const spec = groundSpec(L);
  setupSurfaces(opts.quality, maxAniso, spec.hasLow ? toZ(spec.wallY) || 1e6 : 1e6, spec.lowH, P);
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
    poolCand.push(k.glows[i], k.glows[i + 1], k.glows[i + 2], lamp ? 5.2 : Math.min(3.4, 1.3 + s * 1.05), k.glows[i + 4], k.glows[i + 5], k.glows[i + 6], lamp ? 1.3 : 0.9);
  }
  for (const v of k.pools ?? []) poolCand.push(v);
  const pools = new PoolLights(poolCand, k.wallZ || 1e6, spec.lowH);
  const POOL_OPTS: Partial<Record<BatchKey, PoolOpts>> = {
    paving: { vary: 0.3, ao: 0, gain: 1.5, rim: 0.05, gao: 0.6, dim: 0.34 }, lowPaving: { vary: 0.3, ao: 0, gain: 1.5, rim: 0.05, gao: 0.6, dim: 0.34 },
    brick: { vary: 0.14 }, plaster: { vary: 0.12 }, rock: { vary: 0.16, ao: 0.35 }, wood: { vary: 0.12 }, stone: { vary: 0.16 }, roof: { vary: 0.18, ao: 0, rim: 0.3 },
    metal: { vary: 0.05, ao: 0.2 }, canvas: { vary: 0.06, ao: 0.2 }, leaf: { vary: 0.2, ao: 0.2, rim: 0.3 }, flat: { vary: 0.08, ao: 0.3 },
  };
  windPatch(mats.leaf, 0.03, 0.9);
  if (!P.hell) pools.patch(mats.water, { vary: 0, ao: 0, gain: 1.6, rim: 0 });   // lamps shimmer on the canal / ponds   // trees / bushes / beds sway above the trunk
  for (const [key, o] of Object.entries(POOL_OPTS)) pools.patch(mats[key as BatchKey], o);
  for (const key of ['paint', 'wood', 'stone', 'metal', 'cloth', 'roof'] as const) {
    try { pools.patch(PropKit.material(key), { vary: 0.06, ao: 0.25 }); } catch { /* kit without that material */ }
  }
  detailPropKit();
  // solids of the whole town (jumping + where foliage may grow)
  const solidMap = new SolidMap(collectSolids(L, spec, k.solids ?? [], inst));
  const VGc = villageOf(L) ? villageGround(villageOf(L)!.biome) : null;
  const foliage = createFoliage([...scatterFoliage(k, L, spec, groundAt, (X, Z) => solidMap.top(X, Z)), ...plantRects(k.plant ?? [])], P.hell
    ? { base: '#2a1418', tip: '#7a3a26' }
    : VGc ? { base: shade(VGc[0][0], 0.04), tip: mixHex(VGc[0][2], '#c8d878', 0.4) } : { base: mixHex(shade(P.leafD, -0.15), '#34401c', 0.35), tip: mixHex(P.leaf, '#b0c860', 0.42) });
  root.add(foliage.group);
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
  // hero props: merged per material and per ~18 m stretch of the street (≈ 8 draw calls per stretch instead of 4–7 per
  // kind; a stretch out of view is still culled as a whole)
  const usedKit = new Set<string>();
  {
    const heroes: { kind: PropKind; x: number; y: number; z: number; rotY: number; scale: number }[] = [];
    for (const [kind, list] of inst.placed) if (KIT_KINDS.has(kind)) for (const p of list) heroes.push({ kind: kind as PropKind, x: p.x, y: p.y, z: p.z, rotY: p.rotY, scale: p.scale });
    heroes.sort((a, b) => a.x - b.x);
    for (let i = 0; i < heroes.length;) {
      let j = i; while (j < heroes.length && heroes[j].x - heroes[i].x < 18) j++;
      const byKind = new Map<PropKind, PropTransformList>();
      for (const h of heroes.slice(i, j)) { let a = byKind.get(h.kind); if (!a) byKind.set(h.kind, (a = [])); a.push(h); }
      try {
        const g = PropKit.merged([...byKind].map(([kind, list]) => ({ kind, list })));
        props.add(g);
        for (const kd of byKind.keys()) usedKit.add(kd);
      } catch (e) { console.warn('[world] prop kit merge failed', e); }
      i = j;
    }
  }
  // contact blob shadows under every placed prop (one instanced quad draw, multiply-darkening radial texture)
  const BLOB_R: Record<string, number> = { lamp: 0.55, bench: 0.9, barrel: 0.5, crate: 0.55, bed: 1.1, tree: 1.5, bush: 0.8, mast: 0.4,
    fountain: 1.9, well: 1.5, statue: 1.2, dummy: 0.6, signpost: 0.5, cart: 1.4, noticeBoard: 1.0, chest: 0.6, planter: 0.6, stall: 1.8 };
  let blobN = 0;
  const blobR = (kind: string) => BLOB_R[kind.replace(/^v:/, '')];
  for (const [kind, list] of inst.placed) if (blobR(kind)) blobN += list.length;
  const xb = k.blobs ?? [];
  blobN += Math.floor(xb.length / 5);
  const blobGeo = new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2);
  const blobMat = new THREE.MeshBasicMaterial({ map: getTexture('glow').map, color: '#000000', transparent: true, opacity: 0.7, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, fog: true });
  blobMat.name = 'city:blob';
  const blobs = new THREE.InstancedMesh(blobGeo, blobMat, Math.max(1, blobN));
  blobs.name = 'world:blobs'; blobs.renderOrder = 1;
  {
    const bm = new THREE.Matrix4(); let i = 0;
    for (const [kind, list] of inst.placed) {
      const r = blobR(kind); if (!r) continue;
      for (const p of list) { const s = r * (p.scale || 1); bm.makeScale(s, 1, s).setPosition(p.x, groundAt(fromX(p.x), fromZ(p.z)) + 0.015, p.z); blobs.setMatrixAt(i++, bm); }
    }
    for (let j = 0; j + 4 < xb.length; j += 5) { bm.makeScale(xb[j + 3], 1, xb[j + 4]).setPosition(xb[j], xb[j + 1] + 0.015, xb[j + 2]); blobs.setMatrixAt(i++, bm); }
    blobs.count = i; blobs.instanceMatrix.needsUpdate = true; blobs.computeBoundingSphere();
  }
  props.add(blobs);
  // warm light spill on the ground under every low light (street lamps, wall lanterns, open doors, lit ground-floor
  // windows, braziers): one additive instanced draw of soft radial quads — the pools read as light on the cobbles
  // whatever the paving's albedo (the shader pools above only scale the albedo)
  const spill = (() => {
    const m4 = new THREE.Matrix4(), col = new THREE.Color(), list: number[] = [];
    for (let i = 0; i + 6 < k.glows.length; i += 7) {
      const x = k.glows[i], y = k.glows[i + 1], z = k.glows[i + 2], s = k.glows[i + 3], lamp = i >= glowsBeforeLamps;
      const g = groundAt(fromX(x), fromZ(z));
      if (y - g > 3.3 || y - g < -0.2 || (!lamp && s < 0.7)) continue;
      let r = lamp ? 2.7 : Math.min(1.9, 0.6 + s * 0.7);
      const a = lamp ? 1.25 : Math.min(1.0, 0.35 + s * 0.3);
      if (spec.canal) {   // never over the canal (the water / lava has its own look; a pool on lava blew it out)
        const c0 = _toZ(spec.canal[0]) - 0.35, c1 = _toZ(spec.canal[1]) + 0.35;
        const dz = z < c0 ? c0 - z : z > c1 ? z - c1 : 0;
        r = Math.min(r, Math.max(0.6, dz + 0.25));
        if (dz === 0) continue;
      }
      list.push(x, g + 0.02, z + (lamp ? 0 : 0.5), r, k.glows[i + 4] * a, k.glows[i + 5] * a, k.glows[i + 6] * a);
    }
    const n = Math.floor(list.length / 7);
    const geo = new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2);
    // a tight warm core with a long soft skirt (not the glow sprite's broad haze: overlapping hazes lit the whole street)
    const mat = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog]),
      vertexShader: /* glsl */`varying vec2 vUv; varying vec3 vC;
        #include <fog_pars_vertex>
        void main(){ vUv = uv * 2.0 - 1.0; vC = instanceColor; vec4 mvPosition = modelViewMatrix * instanceMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
        }`,
      fragmentShader: /* glsl */`varying vec2 vUv; varying vec3 vC;
        #include <fog_pars_fragment>
        void main(){ float d = dot(vUv, vUv); float a = pow(max(0.0, 1.0 - d), 3.0) * 0.8 + exp(-d * 18.0) * 0.45;
          gl_FragColor = vec4(vC * a, 1.0);
          #include <fog_fragment>
        }`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: true,
      polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3,
    });
    mat.name = 'city:spill';
    const im = new THREE.InstancedMesh(geo, mat, Math.max(1, n));
    im.name = 'world:spill'; im.renderOrder = 2;
    for (let j = 0; j < n; j++) {
      const o = j * 7;
      im.setMatrixAt(j, m4.makeScale(list[o + 3], 1, list[o + 3]).setPosition(list[o], list[o + 1], list[o + 2]));
      im.setColorAt(j, col.setRGB(list[o + 4], list[o + 5], list[o + 6]));
    }
    im.count = n; im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true;
    im.computeBoundingSphere();
    return im;
  })();
  props.add(spill);
  for (const [of, as] of Object.entries(VK)) inst.alias(as, of);   // village props: same look, own footprint solids
  for (const m of inst.build(mats as unknown as Record<string, THREE.Material>, (kind) => !usedKit.has(kind))) props.add(m);
  // garlands
  const garland = buildGarlands(placed.garlands, getTexture('glow').map);
  props.add(garland);
  root.add(props);

  // ------------------------------------------------ glows, sky, lights
  const dot = dotTexture();
  const glowTex = getTexture('glow').map;
  // floating motes round the camera: fireflies over grass (camp, villages), warm dust in the paved city (motes.ts)
  const motes = createMotes(campOf(L) || villageOf(L) ? 'fireflies' : 'dust', glowTex);
  root.add(motes.points);
  const glows = glowPoints(k.glows, 7, glowTex, { flicker: 0.1, intensity: 0.55, near: 2.6 });   // halos stay under the bloom threshold; a lamp right at the eye fades instead of filling the view
  root.add(glows);

  const CTh = campOf(L) ? campThemeOf(L.styleId) : null;   // a per-style camp has its own sky and light mood
  // a themed quarter with its own mood (cherts: crimson «hell» sky) keeps it over the fair's CSS sky
  const skyCss = CTh?.sky || (P.hell ? P.sky : L.sky) || P.sky;
  const sky = skyDome(skyCss);
  root.add(sky);
  const starPts = stars(opts.quality >= 1 ? 900 : 350, dot);
  root.add(starPts);
  const moonTex = moonTexture();
  const moon = new THREE.Sprite(new THREE.SpriteMaterial({ map: moonTex, depthWrite: false, fog: false, transparent: true }));
  moon.scale.setScalar(46); moon.renderOrder = -8;
  const moonDir = new THREE.Vector3(-0.45, 0.55, -0.7).normalize();
  root.add(moon);

  const grad = parseGradient(skyCss);
  {   // water / lava shading: sky reflection + moon glint + bank foam, or the cherts' breathing lava crust
    const wm = mats.water as THREE.MeshStandardMaterial;
    const g0 = parseGradient(skyCss);
    patchWater(wm, { zenith: new THREE.Color(g0[0].c), horizon: (sky.userData.horizon as THREE.Color | undefined)?.clone() ?? new THREE.Color(g0[g0.length - 1].c),
      moonDir: new THREE.Vector3(-0.45, 0.55, -0.7), c0: spec.canal ? _toZ(spec.canal[0]) : NaN, c1: spec.canal ? _toZ(spec.canal[1]) : NaN, lava: !!P.hell });
  }
  const horizon = new THREE.Color(grad[grad.length - 1].c), zenith = new THREE.Color(grad[0].c);
  // fog = the sky's (brightened) horizon band, so distant structures fade into the glow, nearer ones silhouette
  const fogCol = (sky.userData.horizon as THREE.Color | undefined)?.clone() ?? horizon.clone();
  if (P.hell) fogCol.lerp(new THREE.Color('#2a0a10'), 0.55);   // cherts: a smoky dark-red haze (the cliffs and lavafalls read through it)
  const fog = new THREE.Fog(fogCol, 34, 260);

  // the camp has only the fire, torches and tent lanterns (no street lamps): a little more moonlight on the meadow
  const campLit = !!campOf(L);
  const hemi = new THREE.HemisphereLight(new THREE.Color(CTh ? CTh.hemi[0] : '#8f9cff'), new THREE.Color(CTh ? CTh.hemi[1] : '#4a2c30'), campLit ? 1.45 : 1.15);
  root.add(hemi);
  const amb = new THREE.AmbientLight(new THREE.Color(CTh ? CTh.ambient : '#5a5490'), campLit ? 0.42 : 0.3);
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
    setSurfaceQuality(q);
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
    motes.setQuality(q);
    foliage.setQuality(q);
    sun.shadow.radius = q >= 3 ? 2.5 : 1;   // soft moon shadows (vogel-disk PCF) at the top level
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
    motes.update(t, _cp);
    foliage.update(t, _cp);
    const ph = (camera as THREE.PerspectiveCamera).isPerspectiveCamera ? (camera as THREE.PerspectiveCamera) : null;
    if (ph && renderer) {
      const hpx = renderer.domElement.height || 720;
      glowMat.uniforms.uScale.value = bulbMat.uniforms.uScale.value = hpx / (2 * Math.tan((ph.fov * Math.PI / 180) / 2));
      starMat.uniforms.uPx.value = Math.max(1, hpx / 720);
    }
    WATER_T.value = t;
    if (waterMat && waterMat.map) {
      waterMat.map.offset.set(t * 0.03, t * 0.012);
      if (waterMat.normalMap) waterMat.normalMap.offset.set(-t * 0.02, t * 0.025);
      if (waterMat.emissiveMap) waterMat.emissiveMap.offset.copy(waterMat.map.offset);
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
    colMat.dispose(); blobMat.dispose(); (spill.material as THREE.Material).dispose(); motes.dispose(); foliage.dispose();
    (sky.material as THREE.Material).dispose(); starMat.dispose(); glowMat.dispose(); (moon.material as THREE.Material).dispose();
    signs.texture.dispose(); dot.dispose(); moonTex.dispose();
    const wm = mats.water as THREE.MeshStandardMaterial; wm.map?.dispose(); wm.normalMap?.dispose();
    inst.dispose();
    disposePropKit();
    disposeTextures();
    sun.dispose(); hemi.dispose(); amb.dispose(); for (const l of lights) l.dispose();
  }

  // ------------------------------------------------ jumping (solid tops), door interactables, map image
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
