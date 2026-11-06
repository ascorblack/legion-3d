/**
 * Новый год (Dec 20 – Jan 10, local time; the window wraps the year): the night fair as a warm winter postcard.
 *
 *  - snow caps on every roof, ledge, sill, awning and wall top: grown from the city's own up-facing faces (one merged
 *    mesh, self-lit a little so it reads at night);
 *  - soft snow drifts hugging wall feet and railings (one instanced decal), a frosty tint on the paving;
 *  - the garland bulbs re-coloured warm multicolour;
 *  - a decorated fir tree on the most open spot near the spawn (the square): snowy tiers, baubles, gifts, a glowing
 *    star, a spiral of twinkling lights and a warm light pool (no real lights);
 *  - gentle falling snow (one Points, fewer flakes at q0–1, off with prefers-reduced-motion);
 *  - «Снежки» (snowball.ts): G throws a soft snowball (client-side only).
 * Draw calls at q2: caps, drifts, tree, star, tree lights, light pool, snowfall + balls, splats, puff (only while
 * thrown) = 7–10. Dispose restores the bulbs and the paving colours and removes everything.
 */
import * as THREE from 'three';
import type { SeasonalEvent, EventContext } from '../types';
import type { QualityLevel } from '../../contracts';
import { inWindow, windowDistance } from '../calendar';
import { glowPoints } from '../../world/sky';
import { DN_U } from '../../world/dnUniforms';
import { placeCity, garland, recolourBulbs, selfLit, staticMeshes, tintColor, reducedMotion, pointScale, glowTexture, groundQuad } from '../common';
import { planNewYear, snowCoverMesh, type NewYearPlan } from './placement';
import { firTreeGeometry, starGeometry, treeLights, snowCapGeometry, TREE_RADIUS } from './geo';
import { driftTexture, snowCoverTexture } from './tex';
import { snowfall, SNOW_BOX } from './snowfall';
import { setupSnowballs, type Snowballs } from './snowball';

export const NEWYEAR_FROM: [number, number] = [12, 20];
export const NEWYEAR_TO: [number, number] = [1, 10];

/** Per quality: falling flakes, drifts, tree lights. */
export const NEWYEAR_BUDGET: Record<QualityLevel, { flakes: number; drifts: number; lights: number }> = {
  0: { flakes: 250, drifts: 24, lights: 24 },
  1: { flakes: 650, drifts: 48, lights: 40 },
  2: { flakes: 1400, drifts: 80, lights: 64 },
  3: { flakes: 2400, drifts: 120, lights: 64 },
};

/** Warm multicolour garland: red, gold, green, blue, pink, warm white. */
const BULBS = [[1.0, 0.28, 0.2], [1.0, 0.72, 0.25], [0.35, 0.95, 0.4], [0.4, 0.62, 1.0], [1.0, 0.45, 0.75], [1.0, 0.85, 0.6]];
/** Static meshes that never get snow (glass, lamps, signs, water, the paving itself). */
const NO_SNOW = new Set(['city:glass', 'city:emit', 'city:glow', 'city:sign', 'city:water', 'city:dark', 'city:paving', 'city:lowPaving']);

export interface NewYearInfo { plan: NewYearPlan; snow: Snowballs | null; capTris: number }

function setup(ctx: EventContext): () => void {
  const undo: (() => void)[] = [];
  try { return build(ctx, undo); } catch (e) { for (const u of undo.reverse()) u(); throw e; }
}

function build(ctx: EventContext, undo: (() => void)[]): () => void {
  const group = new THREE.Group(); group.name = 'event:newyear';
  const own: { dispose(): void }[] = [];
  const offs: (() => void)[] = [];
  const reduced = ctx.game?.reducedMotion ?? reducedMotion();

  /* ---- world hooks: garland colours, frosty paving */
  undo.push(recolourBulbs(garland(ctx).bulbs, BULBS));
  const frost = new THREE.Color(1.22, 1.28, 1.42), tinted = new Set<THREE.Material>();
  for (const m of staticMeshes(ctx)) {
    if (m.name !== 'city:paving' && m.name !== 'city:lowPaving') continue;
    const mat = m.material as THREE.MeshStandardMaterial;
    if (!mat?.color || tinted.has(mat)) continue;
    tinted.add(mat); undo.push(tintColor(mat.color, frost, 0.55));
  }

  /* ---- snow caps (1 draw) */
  const capSrc = staticMeshes(ctx).filter((m) => !NO_SNOW.has(m.name));
  const capGeo = snowCapGeometry(capSrc, ctx.groundAt);
  const capMat = selfLit(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 }), 0.38); own.push(capMat);
  let caps: THREE.Mesh | null = null;
  if (capGeo) { own.push(capGeo); caps = new THREE.Mesh(capGeo, capMat); caps.name = 'newyear:caps'; caps.matrixAutoUpdate = false; group.add(caps); }

  /* ---- placement */
  const city = placeCity(ctx);
  const plan = planNewYear(city);

  /* ---- patchy snow cover on the flat street (1 draw) */
  const cov = snowCoverMesh(city);
  const covGeo = new THREE.BufferGeometry(); own.push(covGeo);
  covGeo.setAttribute('position', new THREE.BufferAttribute(cov.position, 3)); covGeo.setAttribute('uv', new THREE.BufferAttribute(cov.uv, 2));
  covGeo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(cov.position.length).map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
  covGeo.computeBoundingSphere();
  const covTex = snowCoverTexture(); own.push(covTex);
  const covMat = new THREE.MeshStandardMaterial({ map: covTex, transparent: true, depthWrite: false, roughness: 0.9, emissive: new THREE.Color('#b8c4ff'), emissiveIntensity: 0.22,
    polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }); own.push(covMat);
  const cover = new THREE.Mesh(covGeo, covMat); cover.name = 'newyear:cover'; cover.renderOrder = 1; cover.matrixAutoUpdate = false; group.add(cover);

  /* ---- drifts (1 draw; four shapes in one texture, picked per instance) */
  const driftTex = driftTexture(); own.push(driftTex);
  const driftGeo = groundQuad(); own.push(driftGeo);
  const MAXD = NEWYEAR_BUDGET[3].drifts + 1;
  const aVar = new THREE.InstancedBufferAttribute(new Float32Array(MAXD), 1); driftGeo.setAttribute('aVar', aVar);
  const driftMat = new THREE.MeshStandardMaterial({ map: driftTex, transparent: true, depthWrite: false, roughness: 1, emissive: new THREE.Color('#cdd6ff'), emissiveIntensity: 0.5,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  driftMat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float aVar;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\n#ifdef USE_MAP\nvMapUv.x = (vMapUv.x + aVar) * 0.25;\n#endif');
  };
  driftMat.customProgramCacheKey = () => 'l3d-drift';
  own.push(driftMat);
  const drifts = new THREE.InstancedMesh(driftGeo, driftMat, MAXD); drifts.name = 'newyear:drifts'; drifts.count = 0; drifts.frustumCulled = false; drifts.renderOrder = 1;
  group.add(drifts);

  /* ---- the tree: body, star, lights, light pool */
  let tree: THREE.Mesh | null = null, star: THREE.Mesh | null = null, lights: THREE.Points | null = null, pool: THREE.Mesh | null = null;
  const glowTex = glowTexture(64, 2); own.push(glowTex);
  const lightData = treeLights(NEWYEAR_BUDGET[3].lights);
  if (plan.tree) {
    const T = plan.tree;
    const treeGeo = firTreeGeometry(); own.push(treeGeo);
    const treeMat = selfLit(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75 }), 0.32); own.push(treeMat);
    tree = new THREE.Mesh(treeGeo, treeMat); tree.name = 'newyear:tree'; tree.position.set(T.x, T.y, T.z); tree.rotation.y = 0.4; group.add(tree);
    const starGeo = starGeometry(); own.push(starGeo);
    const starMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.5, 1.2, 0.45) }); own.push(starMat);
    star = new THREE.Mesh(starGeo, starMat); star.name = 'newyear:star'; star.position.copy(tree.position); group.add(star);
    const world = [T.x, T.y + 3.08, T.z, 1.1, 0.9, 0.75, 0.35];   // the star's own halo first, then the spiral
    for (let i = 0; i < lightData.length; i += 7) world.push(lightData[i] + T.x, lightData[i + 1] + T.y, lightData[i + 2] + T.z, lightData[i + 3], lightData[i + 4], lightData[i + 5], lightData[i + 6]);
    lights = glowPoints(world, 7, glowTex, { flicker: 0.35, intensity: 0.9, lit: DN_U.lit, litMin: 0.4 }); lights.name = 'newyear:lights'; lights.frustumCulled = false;
    own.push(lights.geometry, lights.material as THREE.Material); group.add(lights);
    const poolGeo = groundQuad(); own.push(poolGeo);
    const poolMat = new THREE.MeshBasicMaterial({ map: glowTex, color: new THREE.Color(1, 0.72, 0.38), transparent: true, opacity: 0.5, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }); own.push(poolMat);
    pool = new THREE.Mesh(poolGeo, poolMat); pool.name = 'newyear:pool'; pool.position.set(T.x, T.y + 0.02, T.z); pool.scale.set(2.8, 1, 2.8); pool.renderOrder = 2; group.add(pool);
  }

  /* ---- falling snow (1 draw) */
  const flakes = snowfall(NEWYEAR_BUDGET[3].flakes); own.push(flakes.geometry, flakes.material as THREE.Material);
  const fu = (flakes.material as THREE.ShaderMaterial).uniforms;
  group.add(flakes);

  /* ---- quality */
  let q = ctx.quality();
  const apply = () => {
    const B = NEWYEAR_BUDGET[q], m = new THREE.Matrix4(), s = new THREE.Vector3(), p = new THREE.Vector3(), r = new THREE.Quaternion();
    let n = 0;
    if (plan.tree) {   // a broad drift round the tree foot first
      p.set(plan.tree.x, plan.tree.y + 0.012, plan.tree.z); s.set(TREE_RADIUS + 0.3, 1, TREE_RADIUS + 0.2); r.identity();
      m.compose(p, r, s); drifts.setMatrixAt(n, m); aVar.setX(n++, 1);
    }
    for (const d of plan.drifts.slice(0, B.drifts)) {
      p.set(d.x, d.y + 0.008, d.z); s.set(d.r, 1, d.r * 0.85); r.setFromAxisAngle(new THREE.Vector3(0, 1, 0), d.rot);
      m.compose(p, r, s); drifts.setMatrixAt(n, m); aVar.setX(n++, d.variant);
    }
    drifts.count = n; drifts.instanceMatrix.needsUpdate = true; aVar.needsUpdate = true;
    flakes.geometry.setDrawRange(0, B.flakes); flakes.visible = !reduced && B.flakes > 0;
    if (lights) lights.geometry.setDrawRange(0, 1 + Math.min(B.lights, lightData.length / 7));   // point 0 = the star's halo
  };
  apply();
  offs.push(ctx.onQuality((nq) => { q = nq; apply(); }));

  /* ---- snowballs */
  const snow = setupSnowballs(ctx, group);

  /* ---- per frame */
  const cam = ctx.camera.position, lu = lights ? (lights.material as THREE.ShaderMaterial).uniforms : null;
  offs.push(ctx.onFrame((_dt, t) => {
    fu.uTime.value = t; fu.uCam.value.copy(cam); fu.uScale.value = pointScale(ctx);
    if (lu) { lu.uTime.value = reduced ? 0 : t; lu.uScale.value = fu.uScale.value; }
    if (star && !reduced) star.rotation.y = t * 0.6;
  }));

  ctx.group.add(group);
  group.userData.newyear = { plan, snow, capTris: capGeo ? capGeo.getAttribute('position').count / 3 : 0 } satisfies NewYearInfo;

  return () => {
    for (const u of offs.reverse()) u();
    snow.dispose();
    group.removeFromParent();
    drifts.dispose();
    for (const o of own) o.dispose();
    for (const u of undo.reverse()) u();
    undo.length = 0;
  };
}

const newyear: SeasonalEvent = {
  id: 'newyear',
  title: 'Новый год',
  short: 'Новый год',
  greeting: '🎄 С Новым годом! Город в снегу. G — бросить снежок (видишь только ты). Отключить: Настройки → События',
  active: (d) => inWindow(d, NEWYEAR_FROM, NEWYEAR_TO),
  distance: (d) => windowDistance(d, NEWYEAR_FROM, NEWYEAR_TO),
  setup,
};
export default newyear;
export { setup as setupNewYear, SNOW_BOX };
