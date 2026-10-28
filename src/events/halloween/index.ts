/**
 * Halloween (Oct 24 – Nov 3, local time): the night fair dressed up cute and cozy, cat-themed, nothing scary.
 *
 *  - pumpkin clusters hugging door sides, stair ends and the ledge (one InstancedMesh) + carved jack-o'-lanterns with a
 *    flickering emissive face (one InstancedMesh), warm light pools on the ground under them (decals, no real lights);
 *  - paper-lantern jacks hanging from the existing garlands, whose bulbs are re-coloured orange / purple / lime;
 *  - bats flapping around lamps and over the street (one InstancedMesh, flap in the vertex shader);
 *  - ghost-cat lanterns floating above head height, turning to look at the player;
 *  - ground fog patches on flat ground (two soft planes each), cobwebs in doorway corners, a violet-tinted sky and a
 *    bigger, warmer moon.
 * Budget at q2: 9 draw calls, ≈ 0.1 ms CPU/frame. Dispose restores the scene, the garland bulbs, the sky and the moon.
 */
import * as THREE from 'three';
import type { SeasonalEvent, EventContext } from '../types';
import { inWindow, windowDistance } from '../calendar';
import { planHalloween, PUMPKIN_HALF, type PlaceCity, type Plan, type Cluster, type PumpkinSpec } from './placement';
import { pumpkinGeometry, batGeometry, ghostGeometry, groundQuad, cornerQuad, buntingGeometry } from './geo';
import { jackFaceTexture, glowTexture, fogTexture, webTexture } from './tex';
import { planHwExtras, type HwExtras } from './hwcity';
import { extrasGeometry, extrasGlows, Parts } from './hwgeo';
import { stupaGeometry, passGeometry, lanternPoints, poleFlame } from './npcgeo';
import type { NpcWorld } from './hwnpc';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { selfLit } from '../common';
import { glowPoints } from '../../world/sky';
import { groundSpec } from '../../world/ground';
import { toX, toZ, fromX, fromZ } from '../../world/coords';
import type { QualityLevel } from '../../contracts';

export const HALLOWEEN_FROM: [number, number] = [10, 24];
export const HALLOWEEN_TO: [number, number] = [11, 3];

/** What each quality level shows (clusters, hanging lanterns, bats, ghosts, fog patches, cobwebs, share of the bunting). */
export const HALLOWEEN_BUDGET: Record<QualityLevel, { clusters: number; hang: number; bats: number; ghosts: number; fog: number; webs: number; bunting: number }> = {
  0: { clusters: 16, hang: 6, bats: 6, ghosts: 3, fog: 0, webs: 4, bunting: 0 },
  1: { clusters: 24, hang: 10, bats: 10, ghosts: 4, fog: 6, webs: 8, bunting: 0.5 },
  2: { clusters: 32, hang: 14, bats: 14, ghosts: 5, fog: 14, webs: 12, bunting: 1 },
  3: { clusters: 64, hang: 18, bats: 18, ghosts: 6, fog: 16, webs: 14, bunting: 1 },
};

/**
 * «Ночь Тыквенной Луны» dress (src/features/hwcity.ts sets it before the event is (re)built): the site's extra
 * props — a cauldron by the gate, candle trios by the door pumpkins, a witch on a broom circling over the gate,
 * more bats and cobwebs high on the facades. +1 draw call (the extras are one merged mesh; flames join the halos).
 */
export const halloweenOpts: { hw: boolean; npcs: NpcWorld[] | null; npcLv: number } = { hw: false, npcs: null, npcLv: 0 };
const HW_MORE = { bats: 8, webs: 10 };

const TINTS = [[1, 1, 1], [1, 0.8, 0.62], [1, 1.14, 0.62], [0.9, 0.92, 0.82]];
const BULB_PALETTE = [[1.0, 0.5, 0.1], [0.62, 0.32, 1.0], [1.0, 0.5, 0.1], [0.62, 0.32, 1.0], [0.55, 0.95, 0.25]].map((c) => c.map((v) => v * 1.4));

/* ------------------------------------------------------------------ city adaptor */
export function placeCity(ctx: EventContext): PlaceCity {
  const L = ctx.layout, spec = groundSpec(L), w = ctx.world;
  const boxes = (w.interactables?.() ?? []).filter((i) => (i.hit as THREE.Box3).isBox3);
  const doors = L.buildings.map((b) => {
    const it = boxes.find((i) => i.id.replace(/^door:/, '') === b.id), bx = it?.hit as THREE.Box3 | undefined;
    const x = toX(b.door.x), z = toZ(b.door.y);
    return { x, z, box: (bx ? [bx.min.x, bx.max.x, bx.min.z, bx.max.z] : [x - 0.9, x + 0.9, z - 1.6, z - 0.1]) as [number, number, number, number] };
  });
  const [sx, sy] = w.spawn;
  return {
    groundAt: (X, Z) => w.groundAt(fromX(X), fromZ(Z)),
    top: (X, Z) => (w.solidTop ? w.solidTop(fromX(X), fromZ(Z)) : -Infinity),
    free: (X, Z) => L.free(fromX(X), fromZ(Z)),
    area: { x0: toX(L.area.x0), x1: toX(L.area.x1), z0: 0, z1: toZ(L.area.y1) },
    doors, stairs: spec.stairs.map((s) => [toX(s[0]), toX(s[1])] as [number, number]),
    ledgeZ: spec.hasLow ? toZ(spec.rampY0) : 1e9, spawn: { x: toX(sx), z: toZ(sy) },
  };
}

/* ------------------------------------------------------------------ world hooks (reversible) */
interface Hooks { bulbs: THREE.Points | null; cable: THREE.LineSegments | null; lamps: THREE.Vector3[]; restore: () => void; tick(): void }

/** Find the garland bulbs, lamp heads, sky dome and moon in the world root; re-colour / tint them; undo in restore(). */
export function hookWorld(ctx: EventContext): Hooks {
  const root = ctx.world.root, undo: (() => void)[] = [];
  const bulbs = (root.getObjectByName('fx:bulbs') as THREE.Points | undefined) ?? null;
  const cable = (root.getObjectByName('fx:cable') as THREE.LineSegments | undefined) ?? null;
  if (bulbs) {
    const a = bulbs.geometry.getAttribute('color') as THREE.BufferAttribute, orig = a.array.slice();
    for (let i = 0; i < a.count; i++) { const c = BULB_PALETTE[(i * 7 + (i >> 2)) % BULB_PALETTE.length]; a.setXYZ(i, c[0], c[1], c[2]); }
    a.needsUpdate = true;
    undo.push(() => { (a.array as Float32Array).set(orig as Float32Array); a.needsUpdate = true; });
  }
  // lamp heads = the big glow points (size 1.7) above 2 m
  const lamps: THREE.Vector3[] = [];
  root.traverse((o) => {
    const p = o as THREE.Points;
    if (!p.isPoints || o.name !== 'fx:glow') return;
    const pos = p.geometry.getAttribute('position'), size = p.geometry.getAttribute('size');
    if (!size) return;
    for (let i = 0; i < pos.count; i++) if (Math.abs(size.getX(i) - 1.7) < 0.01 && pos.getY(i) > 2) lamps.push(new THREE.Vector3(pos.getX(i), pos.getY(i), pos.getZ(i)));
  });
  // sky dome + moon + fog tint (the fog / background objects are attached on the world's first update → lazily)
  const dome = root.getObjectByName('sky:dome') as THREE.Mesh | undefined;
  const violet = new THREE.Color('#6b2fa5'), pink = new THREE.Color('#d070c8');
  const tintCol = (c: THREE.Color, k: number, to = violet) => { const o = c.clone(); c.lerp(to, k); return () => c.copy(o); };
  const du = (dome?.material as THREE.ShaderMaterial | undefined)?.uniforms;
  if (du) {
    undo.push(tintCol(du.c1.value, 0.16), tintCol(du.c2.value, 0.2), tintCol(du.c3.value, 0.22), tintCol(du.hz.value, 0.2, pink));
    undo.push(tintCol(du.c0.value, 0.1));
  }
  let moon: THREE.Sprite | undefined;
  root.traverse((o) => { if ((o as THREE.Sprite).isSprite && o.renderOrder === -8) moon = o as THREE.Sprite; });
  if (moon) {
    const m = moon, s0 = m.scale.clone(), c0 = (m.material as THREE.SpriteMaterial).color.clone();
    m.scale.multiplyScalar(1.5); (m.material as THREE.SpriteMaterial).color.setRGB(1, 0.86, 0.66);
    undo.push(() => { m.scale.copy(s0); (m.material as THREE.SpriteMaterial).color.copy(c0); });
  }
  let sceneTinted = false;
  const tick = () => {
    if (sceneTinted || !ctx.scene.fog || !ctx.scene.background) return;
    sceneTinted = true;
    const fog = ctx.scene.fog as THREE.Fog, bg = ctx.scene.background as THREE.Color;
    if (fog.color) undo.push(tintCol(fog.color, 0.2, pink));
    if (bg.isColor) undo.push(tintCol(bg, 0.1));
  };
  return { bulbs, cable, lamps, tick, restore: () => { for (const u of undo.reverse()) u(); undo.length = 0; } };
}

/* ------------------------------------------------------------------ the event */
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3(), _e = new THREE.Euler(0, 0, 0, 'YXZ'), _c = new THREE.Color();

export interface HalloweenInfo { plan: Plan; draws: number; tris: number }

function setup(ctx: EventContext): () => void {
  const hooks = hookWorld(ctx);
  try { return build(ctx, hooks); } catch (e) { hooks.restore(); throw e; }   // a failed setup leaves the world as it was
}

function build(ctx: EventContext, hooks: Hooks): () => void {
  const city = placeCity(ctx);
  const hw = halloweenOpts.hw;
  // «Ночь Тыквенной Луны» NPCs (site hwnpc.js, only with the hw dress on the Fair): their bases stay clear of pumpkins / candles
  const npcs = hw && ctx.layout.id === 'fair' && halloweenOpts.npcs?.length ? halloweenOpts.npcs : null;
  if (npcs) {
    const free0 = city.free;
    city.free = (X, Z) => free0(X, Z) && !npcs.some((n) => n.base.some(([cx, cz, rx, rz]) => ((X - cx) / (rx + 0.35)) ** 2 + ((Z - cz) / (rz + 0.35)) ** 2 <= 1));
  }
  const plan = planHalloween(city);
  const L = ctx.layout;
  const upper = L.buildings.filter((b) => !b.soon && b.door.y < 1100 && b.hit[3] <= 1000 && b.id !== 'board' && b.id !== 'anvil');
  const gateB = L.buildings.find((b) => b.id === 'gate');
  const extras: HwExtras | null = hw ? planHwExtras(city, plan, gateB ? { x: toX(gateB.door.x), z: toZ(gateB.door.y) } : null, upper.map((b) => [toX(b.hit[0]), toX(b.hit[1])] as [number, number])) : null;
  const extraGlow = extras ? extrasGlows(extras) : [];
  const group = new THREE.Group(); group.name = 'event:halloween';
  const disposables: { dispose(): void }[] = [];
  const own = <T extends { dispose(): void }>(o: T) => (disposables.push(o), o);
  const offs: (() => void)[] = [];

  /* ---- shared textures */
  const faceTex = own(jackFaceTexture()), glowTex = own(glowTexture(64, 2)), fogTex = own(fogTexture(128)), webTex = own(webTexture(128));

  /* ---- pumpkins + jack-o'-lanterns (2 draws) */
  const pumpGeo = own(pumpkinGeometry());
  const pumpMat = own(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, emissive: new THREE.Color(1, 0.33, 0.05), emissiveIntensity: 0.85 }));
  const jackMat = own(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, emissive: new THREE.Color(1, 1, 1), emissiveMap: faceTex, emissiveIntensity: 2.0 }));
  const MAXP = plan.clusters.reduce((a, c) => a + c.items.length, 0) + plan.clusters.length + HALLOWEEN_BUDGET[3].hang + plan.lanterns.length + 2;
  const plain = new THREE.InstancedMesh(pumpGeo, pumpMat, Math.max(1, MAXP)); plain.name = 'halloween:pumpkins';
  const jacks = new THREE.InstancedMesh(pumpGeo, jackMat, Math.max(1, MAXP)); jacks.name = 'halloween:jacks';
  for (const m of [plain, jacks]) { m.castShadow = false; m.receiveShadow = false; m.frustumCulled = false; m.count = 0; group.add(m); }
  plain.setColorAt(0, _c.setRGB(1, 1, 1)); jacks.setColorAt(0, _c.setRGB(1, 1, 1));

  /* ---- light pools under jacks (1 draw) */
  const poolGeo = own(groundQuad());
  const poolMat = own(new THREE.MeshBasicMaterial({ map: glowTex, color: new THREE.Color(1, 0.55, 0.16), transparent: true, opacity: 0.55, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }));
  const pools = new THREE.InstancedMesh(poolGeo, poolMat, MAXP); pools.name = 'halloween:pools'; pools.count = 0; pools.renderOrder = 2; pools.frustumCulled = false;
  group.add(pools);

  /* ---- contact shadows under ground pumpkins (1 draw; same recipe as the city's blobs) */
  const blobMat = own(new THREE.MeshBasicMaterial({ map: glowTex, color: 0x000000, transparent: true, opacity: 0.8, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }));
  const blobs = new THREE.InstancedMesh(poolGeo, blobMat, MAXP); blobs.name = 'halloween:blobs'; blobs.count = 0; blobs.renderOrder = 1; blobs.frustumCulled = false;
  group.add(blobs);

  /* ---- bunting along the garland cables (1 draw) */
  const cableLine = hooks.cable;
  const buntGeo = own(buntingGeometry(cableLine ? (cableLine.geometry.getAttribute('position').array as ArrayLike<number>) : []));
  const buntMat = own(new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide }));
  const buntU = { uTime: { value: 0 } };
  buntMat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = buntU.uTime;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float aHang;\nuniform float uTime;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        transformed += aHang * 0.05 * vec3(sin(uTime * 1.9 + position.x * 2.3 + position.z), 0.0, cos(uTime * 1.5 + position.x + position.z * 2.1));`);
  };
  const bunting = new THREE.Mesh(buntGeo, buntMat); bunting.name = 'halloween:bunting'; bunting.frustumCulled = false; group.add(bunting);

  /* ---- hanging lanterns on the garlands: jack instances + strings + halos */
  const hangPts: THREE.Vector3[] = [];
  if (hooks.bulbs) {
    const pos = hooks.bulbs.geometry.getAttribute('position');
    const order = Array.from({ length: pos.count }, (_, i) => i);
    let s = 12345; const rr = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
    for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(rr() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
    for (const i of order) {
      if (hangPts.length >= HALLOWEEN_BUDGET[3].hang) break;
      _p.set(pos.getX(i), pos.getY(i), pos.getZ(i));
      if (_p.y < 2.2 || hangPts.some((h) => h.distanceTo(_p) < 3.0)) continue;
      hangPts.push(_p.clone());
    }
  }
  const NS = hangPts.length + plan.lanterns.length;
  const stringGeo = own(new THREE.BufferGeometry());
  stringGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(Math.max(1, NS) * 12), 3));
  const stringMat = own(new THREE.LineBasicMaterial({ color: '#241a3a' }));
  const strings = new THREE.LineSegments(stringGeo, stringMat); strings.name = 'halloween:strings'; strings.frustumCulled = false; group.add(strings);

  /* ---- halos (additive glow points; flicker per point in the world's glow shader). Capacity = every jack + lantern. */
  const passNpc = npcs?.find((n) => n.id === 'hwpass') ?? null;
  const lampPts = passNpc ? lanternPoints(passNpc, city.groundAt(passNpc.x, passNpc.z)) : [];
  const MAXH = plan.clusters.reduce((a, c) => a + c.items.filter((i) => i.kind).length, 0) + HALLOWEEN_BUDGET[3].hang + plan.lanterns.length + plan.ghosts.length + extraGlow.length / 7 + lampPts.length + 1;
  const haloPts = glowPoints(new Array(Math.max(1, MAXH) * 7).fill(0).map((_, i) => (i % 7 === 3 ? 0.01 : 0)), 7, glowTex, { flicker: 0.16, intensity: 0.6 });
  haloPts.name = 'halloween:halos'; haloPts.frustumCulled = false; group.add(haloPts); own(haloPts.geometry); own(haloPts.material as THREE.Material);
  const hPos = haloPts.geometry.getAttribute('position') as THREE.BufferAttribute, hSize = haloPts.geometry.getAttribute('size') as THREE.BufferAttribute, hCol = haloPts.geometry.getAttribute('color') as THREE.BufferAttribute;
  let haloN = 0, haloFixed = 0;
  const halo = (x: number, y: number, z: number, size: number, r = 1, g = 0.55, b = 0.16) => { hPos.setXYZ(haloN, x, y, z); hSize.setX(haloN, size); hCol.setXYZ(haloN, r, g, b); haloN++; };

  /* ---- bats (1 draw) */
  const batGeo = own(batGeometry());
  const batMat = own(new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide }));
  const batU = { uTime: { value: 0 } };
  batMat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = batU.uTime;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform float uTime;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        float bph = float(gl_InstanceID) * 1.913;
        float flap = sin(uTime * (13.0 + mod(bph, 3.0)) + bph);
        float wing = smoothstep(0.05, 0.34, abs(position.x));
        transformed.y += wing * flap * 0.2 + wing * 0.03;
        transformed.x *= 1.0 - 0.12 * wing * (flap * 0.5 + 0.5);`);
  };
  const MAXB = HALLOWEEN_BUDGET[3].bats + (extras ? HW_MORE.bats : 0);
  const bats = new THREE.InstancedMesh(batGeo, batMat, MAXB); bats.name = 'halloween:bats'; bats.frustumCulled = false; group.add(bats);
  interface Bat { cx: number; cy: number; cz: number; rx: number; rz: number; a0: number; w: number; bob: number; ph: number; s: number }
  const batList: Bat[] = [];
  {
    let s = 777; const rr = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
    const lampPick = hooks.lamps.filter((_, i) => i % 3 === 0).slice(0, 8);
    for (const l of lampPick) {
      const n = batList.length < 6 ? 2 : 1;
      for (let k = 0; k < n; k++) batList.push({ cx: l.x, cy: l.y + 0.8 + rr() * 1.6, cz: l.z, rx: 1.4 + rr() * 1.6, rz: 1.2 + rr() * 1.4, a0: rr() * 6.28, w: (0.9 + rr() * 0.7) * (rr() < 0.5 ? 1 : -1), bob: 0.3 + rr() * 0.3, ph: rr() * 6.28, s: 1.25 + rr() * 0.4 });
    }
    const [ax, az] = [toX(city.area.x1) * 0.5, 2.6];
    for (let k = batList.length; k < MAXB; k++) {
      batList.push({ cx: ax * (0.25 + 1.5 * rr()), cy: 5.5 + rr() * 3, cz: az + rr() * 4, rx: 5 + rr() * 9, rz: 1.6 + rr() * 2.5, a0: rr() * 6.28, w: (0.18 + rr() * 0.12) * (rr() < 0.5 ? 1 : -1), bob: 0.4 + rr() * 0.4, ph: rr() * 6.28, s: 1.4 + rr() * 0.5 });
    }
    batList.length = HALLOWEEN_BUDGET[3].bats;
    if (extras) {   // a flock over the gate, around the witch (cityhw.js: bats in the sky over the gate)
      const W = extras.witch;
      for (let k = 0; k < HW_MORE.bats; k++) batList.unshift({ cx: W.cx + (rr() - 0.5) * 6, cy: W.cy - 1.5 + rr() * 2, cz: W.cz + (rr() - 0.5) * 2, rx: 2 + rr() * 3, rz: 1 + rr() * 1.5, a0: rr() * 6.28, w: (0.5 + rr() * 0.5) * (rr() < 0.5 ? 1 : -1), bob: 0.3 + rr() * 0.4, ph: rr() * 6.28, s: 1.5 + rr() * 0.4 });
    }
  }

  /* ---- ghost cats (1 draw) */
  const ghostGeo = own(ghostGeometry());
  const ghostMat = own(new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.92 }));
  ghostMat.color.setScalar(1.5);
  const ghosts = new THREE.InstancedMesh(ghostGeo, ghostMat, Math.max(1, plan.ghosts.length)); ghosts.name = 'halloween:ghosts'; ghosts.frustumCulled = false; ghosts.renderOrder = 3; group.add(ghosts);

  /* ---- ground fog (1 draw): two planes per patch */
  const fogGeo = own(groundQuad());
  const fogMat = own(new THREE.MeshBasicMaterial({ map: fogTex, color: new THREE.Color('#b9a2ea'), transparent: true, opacity: 0.3, depthWrite: false }));
  fogMat.onBeforeCompile = (sh) => {   // fade near the eye (never a hard cut at the camera) and far away
    sh.fragmentShader = sh.fragmentShader.replace('#include <fog_fragment>', `#include <fog_fragment>
      gl_FragColor.a *= smoothstep(1.0, 3.5, vFogDepth) * (1.0 - smoothstep(34.0, 62.0, vFogDepth));`);
  };
  const fogMesh = new THREE.InstancedMesh(fogGeo, fogMat, Math.max(2, plan.fog.length * 2)); fogMesh.name = 'halloween:fog'; fogMesh.frustumCulled = false; fogMesh.renderOrder = 4; group.add(fogMesh);

  /* ---- cobwebs (1 draw) */
  const webGeo = own(cornerQuad());
  const webMat = own(new THREE.MeshBasicMaterial({ map: webTex, transparent: true, depthWrite: false, side: THREE.DoubleSide, opacity: 0.85,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
  const MAXW = HALLOWEEN_BUDGET[3].webs + (extras ? HW_MORE.webs : 0);
  const webs = new THREE.InstancedMesh(webGeo, webMat, MAXW); webs.name = 'halloween:webs'; webs.count = 0; webs.frustumCulled = false; webs.renderOrder = 3; group.add(webs);
  const webQueue: { x: number; z: number; side: number; i: number; hs?: number[] }[] = city.doors.map((d, i) => ({ d, b: ctx.layout.buildings[i] })).filter(({ b }) => !b.soon && b.door.y < 1100 && b.id !== 'board' && b.id !== 'anvil' && !(hw && b.id === 'gate')).flatMap(({ d }, i) => [{ x: d.x - 0.95, z: d.z, side: 1, i }, { x: d.x + 0.95, z: d.z, side: -1, i }]);
  if (extras) extras.webs.forEach((w, i) => webQueue.push({ x: w.x, z: w.z, side: w.side, i, hs: [4.4, 3.8, 3.3] }));
  let webN = 0, webCursor = 0;
  const ray = new THREE.Raycaster(), rayO = new THREE.Vector3(), rayD = new THREE.Vector3(0, 0, -1), up = new THREE.Vector3(0, 1, 0), nrm = new THREE.Vector3(), tx = new THREE.Vector3(), ty = new THREE.Vector3();
  const statics = (ctx.world.root.getObjectByName('world:static')?.children ?? []) as THREE.Mesh[];
  const WEB_HEIGHTS = [3.2, 2.75, 2.3], NO_WEB = new Set(['city:sign', 'city:glass', 'city:emit', 'city:glow', 'city:water', 'city:dark']);
  const tryWeb = (w: { x: number; z: number; side: number; i: number; hs?: number[] }) => {
    if (webN >= MAXW) return;
    const g = ctx.groundAt(w.x, w.z);
    for (const h of w.hs ?? WEB_HEIGHTS) {
      rayO.set(w.x, g + h + (w.i % 3) * 0.05, w.z + 1.8); ray.set(rayO, rayD); ray.far = 4.2;
      const hit = ray.intersectObjects(statics, false)[0];
      if (!hit || !hit.face || NO_WEB.has(hit.object.name)) continue;
      nrm.copy(hit.face.normal).transformDirection(hit.object.matrixWorld);
      if (nrm.z < 0.85) continue;
      tx.crossVectors(up, nrm).normalize(); ty.crossVectors(nrm, tx);
      const size = 0.55 + (w.i % 3) * 0.08;
      _m.makeBasis(tx.multiplyScalar(size * w.side), ty.multiplyScalar(size), nrm);
      _m.setPosition(hit.point.x + nrm.x * 0.012, hit.point.y + nrm.y * 0.012, hit.point.z + nrm.z * 0.012);
      webs.setMatrixAt(webN++, _m); webs.instanceMatrix.needsUpdate = true;
      return;
    }
  };

  /* ---- «Ночь Тыквенной Луны» extras: cauldron, candles, the flying witch (1 draw) */
  const flyU = { uTime: { value: 0 }, uFlyC: { value: new THREE.Vector3() }, uFlyR: { value: 6 }, uFlyW: { value: 0.32 }, uLv: { value: 0 }, uBob: { value: 1 } };
  flyU.uBob.value = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 1;
  let extrasMesh: THREE.Mesh | null = null;
  if (extras) {
    let geo = extrasGeometry(extras);
    if (npcs) {   // the NPCs join the extras mesh: +0 draw calls (aFly codes: 2 mortar bob, 3 ghost bob, 10 + i lantern i)
      const p = new Parts();
      for (const n of npcs) (n.id === 'hwshop' ? stupaGeometry : passGeometry)(p, n, city.groundAt(n.x, n.z));
      const ng = p.build();
      const merged = mergeGeometries([geo, ng], false);
      if (merged) { geo.dispose(); ng.dispose(); geo = merged; geo.computeBoundingSphere(); } else ng.dispose();
    }
    own(geo);
    const mat = own(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75 }));
    flyU.uFlyC.value.set(extras.witch.cx, extras.witch.cy, extras.witch.cz); flyU.uFlyR.value = extras.witch.r;
    mat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, flyU);
      const fly = `if (aFly > 0.5 && aFly < 1.5) {
          float fa = uTime * uFlyW, ca = cos(fa), sa = sin(fa);
          vec3 ft = vec3(-sa, 0.0, ca), fz = vec3(-ca, 0.0, -sa);
          float bank = 0.25;
          vec3 l = vec3(LV.x, LV.y * cos(bank) - LV.z * sin(bank), LV.y * sin(bank) + LV.z * cos(bank));
          LV = l.x * ft + vec3(0.0, l.y, 0.0) + l.z * fz OFS;
        }`;
      const bob = `if (aFly > 1.5 && aFly < 3.5) { float bk = aFly < 2.5 ? 0.035 : 0.06; transformed.y += uBob * bk * sin(uTime * (aFly < 2.5 ? 1.7 : 1.15) + aFly); }`;
      const lamp = `if (aFly > 10.5) { float lit = step(aFly - 10.0, uLv + 0.5); vColor.rgb = mix(vec3(0.13, 0.12, 0.17), vColor.rgb, lit); }`;
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float aFly;\nuniform float uTime; uniform vec3 uFlyC; uniform float uFlyR; uniform float uFlyW; uniform float uLv; uniform float uBob;')
        .replace('#include <color_vertex>', '#include <color_vertex>\n' + lamp)
        .replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\n' + fly.replace(/LV/g, 'objectNormal').replace('OFS', ''))
        .replace('#include <begin_vertex>', '#include <begin_vertex>\n' + fly.replace(/LV/g, 'transformed').replace('OFS', '+ uFlyC + uFlyR * vec3(ca, 0.0, sa) + vec3(0.0, 0.35 * sin(uTime * 1.3), 0.0)') + '\n' + bob);
    };
    selfLit(mat, 0.3);
    mat.customProgramCacheKey = () => 'l3d-hw-extras';
    extrasMesh = new THREE.Mesh(geo, mat); extrasMesh.name = 'halloween:hw-extras'; extrasMesh.frustumCulled = false;
    group.add(extrasMesh);
  }

  /* ---- placement of instances for the current quality */
  let lampHalo0 = 0, lampLv = -1;
  const syncLamps = () => {
    const lv = Math.max(0, Math.min(20, halloweenOpts.npcLv | 0));
    flyU.uLv.value = lv;
    if (lv === lampLv || !lampPts.length) return;
    lampLv = lv;
    for (let i = 0; i < lampPts.length; i++) hSize.setX(lampHalo0 + i, i < lv ? 0.75 : 0);
    hSize.needsUpdate = true;
  };
  let q = ctx.quality(), batN = 0, ghostN = 0, fogN = 0, webLimit = 0, hangN = 0, clustersN = 0;
  const writeInstances = () => {
    const B = HALLOWEEN_BUDGET[q];
    let np = 0, nj = 0, nl = 0, nb = 0;
    const put = (it: PumpkinSpec) => {
      _e.set(0, it.yaw, 0); _q.setFromEuler(_e); _p.set(it.x, it.y, it.z); _s.setScalar(it.r);
      _m.compose(_p, _q, _s);
      const t = TINTS[it.tint % TINTS.length];
      if (it.kind) { jacks.setMatrixAt(nj, _m); jacks.setColorAt(nj, _c.setRGB(t[0], t[1], t[2])); nj++; }
      else { plain.setMatrixAt(np, _m); plain.setColorAt(np, _c.setRGB(t[0], t[1], t[2])); np++; }
    };
    const cl = plan.clusters.slice(0, B.clusters); clustersN = cl.length;
    haloN = 0;
    for (const c of cl) for (const it of c.items) {
      put(it);
      if (!it.kind && it === c.items[0] && !c.items.some((o) => o.kind)) {   // a plain cluster still gets a faint warm patch
        _p.set(it.x, city.groundAt(it.x, it.z) + 0.022, it.z); _s.set(0.85, 1, 0.85); _q.identity(); _m.compose(_p, _q, _s); pools.setMatrixAt(nl++, _m);
      }
      if (it.y < it.r * 2 + city.groundAt(it.x, it.z)) {   // on the ground (not the stacked ones)
        const R = it.r * 1.6; _p.set(it.x, city.groundAt(it.x, it.z) + 0.012, it.z); _s.set(R, 1, R); _q.identity(); _m.compose(_p, _q, _s); blobs.setMatrixAt(nb++, _m);
      }
      if (it.kind) {
        const f = it.kind === 2 ? -1 : 1;
        halo(it.x + Math.sin(it.yaw) * f * it.r * 0.5, it.y + it.r * 0.1, it.z + Math.cos(it.yaw) * f * it.r * 0.5, 1.3 + it.r * 3.2);
        const gy = it.y - it.r * PUMPKIN_HALF, R = Math.min(1.35, 0.8 + it.r * 1.6);
        _p.set(it.x, gy + 0.022, it.z); _s.set(R, 1, R); _q.identity(); _m.compose(_p, _q, _s); pools.setMatrixAt(nl++, _m);
      }
    }
    hangN = Math.min(B.hang, hangPts.length);
    for (let i = 0; i < hangN; i++) {
      const h = hangPts[i], r = 0.19;
      put({ x: h.x, y: h.y - 0.46, z: h.z, r, yaw: (i % 2 ? 1 : -1) * (0.6 + (i % 3) * 0.3) + Math.PI * (i % 2), kind: (i % 2 ? 1 : 2), tint: 0 });
      const a = stringGeo.getAttribute('position') as THREE.BufferAttribute;
      a.setXYZ(i * 2, h.x, h.y - 0.05, h.z); a.setXYZ(i * 2 + 1, h.x, h.y - 0.46 + r * 0.85, h.z); a.needsUpdate = true;
      halo(h.x, h.y - 0.46, h.z, 1.0);
    }
    // wall lanterns beside the doors: a bracket arm out of the facade, a short chain, the lantern
    const nWall = Math.min(Math.round(plan.lanterns.length * (B.hang / HALLOWEEN_BUDGET[3].hang)), plan.lanterns.length);
    { const a = stringGeo.getAttribute('position') as THREE.BufferAttribute; let sv = hangN * 2;
      for (let i = 0; i < nWall; i++) {
        const w = plan.lanterns[i], r = 0.17;
        put({ x: w.x, y: w.y, z: w.z, r, yaw: w.yaw + (i % 2 ? 0 : Math.PI), kind: i % 2 ? 1 : 2, tint: 0 });
        a.setXYZ(sv++, w.x, w.y + 0.5, w.wallZ); a.setXYZ(sv++, w.x, w.y + 0.5, w.z);
        a.setXYZ(sv++, w.x, w.y + 0.5, w.z); a.setXYZ(sv++, w.x, w.y + r * 0.8, w.z);
        halo(w.x, w.y, w.z, 1.1);
      }
      a.needsUpdate = true; strings.visible = sv > 0; stringGeo.setDrawRange(0, sv); }
    plain.count = np; jacks.count = nj; pools.count = nl; blobs.count = nb; blobs.instanceMatrix.needsUpdate = true;
    for (const m of [plain, jacks]) { m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; }
    pools.instanceMatrix.needsUpdate = true;
    { const cum = buntGeo.userData.cum as number[]; const n = cum.length - 1; buntGeo.setDrawRange(0, cum[Math.floor(n * B.bunting)] ?? 0); bunting.visible = B.bunting > 0 && n > 0; }
    batN = Math.min(B.bats + (extras ? HW_MORE.bats : 0), MAXB, batList.length); bats.count = batN; bats.visible = batN > 0;
    ghostN = Math.min(B.ghosts, plan.ghosts.length); ghosts.count = ghostN; ghosts.visible = ghostN > 0;
    fogN = Math.min(B.fog, plan.fog.length); fogMesh.count = fogN * 2; fogMesh.visible = fogN > 0;
    webLimit = B.webs + (extras ? HW_MORE.webs : 0); webs.count = Math.min(webN, webLimit);
    for (let i = 0; i + 6 < extraGlow.length; i += 7) halo(extraGlow[i], extraGlow[i + 1], extraGlow[i + 2], extraGlow[i + 3], extraGlow[i + 4], extraGlow[i + 5], extraGlow[i + 6]);
    lampHalo0 = haloN; lampLv = -1;
    for (const l of lampPts) halo(l.x, l.y, l.z + 0.03, 0, 1, 0.6, 0.2);   // sizes by the pass level (syncLamps)
    if (passNpc) { const f = poleFlame(passNpc, city.groundAt(passNpc.x, passNpc.z)); halo(f.x, f.y, f.z, 0.9, 1, 0.62, 0.22); }
    haloFixed = haloN;
    for (let i = 0; i < Math.min(B.ghosts, plan.ghosts.length); i++) halo(plan.ghosts[i].x, plan.ghosts[i].y + 0.3, plan.ghosts[i].z, 2.0, 0.55, 0.45, 1.0);
    haloPts.geometry.setDrawRange(0, haloN); hPos.needsUpdate = hSize.needsUpdate = hCol.needsUpdate = true;
    haloPts.geometry.computeBoundingSphere();
  };
  writeInstances();
  syncLamps();
  offs.push(ctx.onQuality((nq) => { q = nq; writeInstances(); }));

  /* ---- per frame */
  const cam = ctx.camera.position;
  let tAcc = 0;
  const hu = (haloPts.material as THREE.ShaderMaterial).uniforms;
  offs.push(ctx.onFrame((dt, t) => {
    hooks.tick();
    // webs: a couple of rays per frame after setup, so the toggle never hitches
    if (webCursor < webQueue.length) { tryWeb(webQueue[webCursor++]); webs.count = Math.min(webN, webLimit); }
    tAcc += dt;
    // flicker: candle-ish, shared
    jackMat.emissiveIntensity = 1.95 + 0.34 * Math.sin(t * 9.1) * Math.sin(t * 2.7 + 1) + 0.1 * Math.sin(t * 23.0);
    poolMat.opacity = 0.52 + 0.06 * Math.sin(t * 8.3) * Math.sin(t * 2.1);
    fogMat.opacity = 0.27 + 0.04 * Math.sin(t * 0.3);
    batU.uTime.value = t; buntU.uTime.value = t; flyU.uTime.value = t;
    if (lampPts.length && (halloweenOpts.npcLv | 0) !== lampLv) syncLamps();
    hu.uTime.value = t;
    if (ctx.renderer) { const h = ctx.renderer.domElement.height || 720; hu.uScale.value = h / (2 * Math.tan((ctx.camera.fov * Math.PI / 180) / 2)); }
    // bats
    for (let i = 0; i < batN; i++) {
      const b = batList[i], a = b.a0 + b.w * t, sa = Math.sin(a), ca = Math.cos(a);
      const x = b.cx + b.rx * ca, z = b.cz + b.rz * sa, y = b.cy + b.bob * Math.sin(t * 2.3 + b.ph) + 0.2 * Math.sin(2 * a);
      const vx = -b.rx * sa * Math.sign(b.w), vz = b.rz * ca * Math.sign(b.w);
      _e.set(0.12 * Math.sin(t * 2.3 + b.ph), Math.atan2(-vx, -vz), -0.4 * Math.sign(b.w) * Math.min(1, b.rz / b.rx * 2 + 0.3), 'YXZ'); _q.setFromEuler(_e);
      _p.set(x, y, z); _s.setScalar(b.s); _m.compose(_p, _q, _s); bats.setMatrixAt(i, _m);
    }
    if (batN) bats.instanceMatrix.needsUpdate = true;
    // ghosts: drift in small loops and look at the player
    for (let i = 0; i < ghostN; i++) {
      const g = plan.ghosts[i], ph = g.phase;
      const x = g.x + Math.cos(t * 0.35 + ph) * g.r * 0.6, z = g.z + Math.sin(t * 0.27 + ph) * g.r * 0.35, y = g.y + 0.12 * Math.sin(t * 1.15 + ph) + 0.05 * Math.sin(t * 2.9 + ph);
      const yaw = Math.atan2(cam.x - x, cam.z - z);
      hPos.setXYZ(haloFixed + i, x, y + 0.3, z);
      _e.set(0.05 * Math.sin(t * 0.9 + ph), yaw, 0.06 * Math.sin(t * 0.7 + ph), 'YXZ'); _q.setFromEuler(_e);
      _p.set(x, y, z); _s.setScalar(1.3); _m.compose(_p, _q, _s); ghosts.setMatrixAt(i, _m);
    }
    if (ghostN) { ghosts.instanceMatrix.needsUpdate = true; hPos.needsUpdate = true; }
    // fog drifts: slow turning and breathing
    for (let i = 0; i < fogN; i++) {
      const f = plan.fog[i];
      for (let k = 0; k < 2; k++) {
        const rot = (k ? f.rot2 : f.rot) + t * (k ? -0.012 : 0.017), br = 1 + 0.06 * Math.sin(t * 0.21 + i * 1.3 + k);
        _e.set(0, rot, 0); _q.setFromEuler(_e); _p.set(f.x, f.y + (k ? 0.36 : 0.14), f.z); _s.set(f.r * br * (k ? 0.8 : 1), 1, f.r * br * (k ? 1 : 0.85)); _m.compose(_p, _q, _s);
        fogMesh.setMatrixAt(i * 2 + k, _m);
      }
    }
    if (fogN) fogMesh.instanceMatrix.needsUpdate = true;
    void tAcc;
  }));

  ctx.group.add(group);
  group.userData.halloween = { plan, draws: 0, extras, npcs: npcs?.map((n) => n.id) ?? [], lampLv: () => flyU.uLv.value } as unknown as HalloweenInfo;

  return () => {
    for (const u of offs.reverse()) u();
    group.removeFromParent();
    plain.dispose(); jacks.dispose(); pools.dispose(); blobs.dispose(); bats.dispose(); ghosts.dispose(); fogMesh.dispose(); webs.dispose();
    for (const d of disposables) d.dispose();
    hooks.restore();
  };
}

const halloween: SeasonalEvent = {
  id: 'halloween',
  title: 'Хэллоуин',
  greeting: '🎃 С Хэллоуином! Город украшен — отключить можно в настройках («События»).',
  active: (d) => inWindow(d, HALLOWEEN_FROM, HALLOWEEN_TO),
  distance: (d) => windowDistance(d, HALLOWEEN_FROM, HALLOWEEN_TO),
  setup,
};
export default halloween;
export { setup as setupHalloween };
export type { Cluster };
