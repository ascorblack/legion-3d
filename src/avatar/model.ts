/**
 * Character model builder: one skinned, vertex-coloured geometry per appearance key (shared by every avatar
 * that looks the same), a face decal patch, and the aura effect. Bones are created per avatar.
 *
 * Model space: feet on y = 0, the character LOOKS TOWARDS −Z, its right hand is at +X.
 */
import * as THREE from 'three';
import type { Appearance } from '../contracts';
import { RARITY_COLOR, nickExtras, jhash } from './appearance';
import { chTraits, chDims, chHatDims, chBodyColor, addHorns, addWings, addTail, addHoof, addBatEars, addGoatee, addWispFlames, addShell, addBodyMarks, addChertsHat, CH_INK, type ChDims } from './cherts';
import { setDetail, Parts, T, mul, bodyDims, bodyShell, radiusAt, sectionXZ, col, sphere, cyl, cone, capsule, torus, star, slab, tube, INK, type BodyDims, type Skin } from './geom';
import { addHat, addAccessories } from './hats';
import { addWeapon, addShield, weaponHold, bladeSpan, BOW_STRING } from './gear';

/** Third-person forward tilt of the weapon hand (rx; default −0.65 = tip up-forward). */
const TP_TILT: Record<string, number> = { censer: 0, bow: -0.12, staff: -0.25, crook: -0.25, skullstaff: -0.25, spear: -0.9, pitchfork: -0.9, grimoire: -0.2 };
import { addArmor, armorBase, SHROUD, W_CLOTH, RANK } from './armor';

/** wrist: the weapon paw (child of armR, at the paw); the held weapon is skinned to it so it can turn on its own (bow draw). */
/** bowString: the bow string (child of wrist, at the string centre); collapsed while the TP draw overlay shows a pulled string. */
export const enum B { root = 0, body = 1, armL = 2, armR = 3, legL = 4, legR = 5, tail1 = 6, tail2 = 7, cape1 = 8, cape2 = 9, wrist = 10, bowString = 11 }
export const BONE_COUNT = 12;
export const BONE_PARENT = [-1, 0, 1, 1, 0, 0, 1, 6, 1, 8, 3, 10];

export interface Rig {
  /** Rest positions of the bones in model space. */
  rest: THREE.Vector3[];
  /** Local hand points (in arm bone space) */
  handL: THREE.Vector3; handR: THREE.Vector3;
}

export interface ModelData {
  key: string;
  geo: THREE.BufferGeometry;          // skinned (skinIndex/skinWeight)
  mid: THREE.BufferGeometry;          // LOD 1: same rig, ~half the segments
  low: THREE.BufferGeometry;          // LOD 2: static low mesh (no skin)
  rig: Rig;
  dims: BodyDims;
  headTop: number;                    // m, incl. hat
  faceKey: string;
  hasLegs: boolean; hasTail: boolean; hasCape: boolean;
  /** Wings (cherts): skinned to the cape1 bone when there is no cape, so the avatar can flap them (scale.x). */
  wings?: boolean;
  radius: number;
  refs: number;
  /** Swing trail (src/combat): the striking edge in MODEL space (bind pose) and the bone it hangs on; null = none. */
  blade: { bone: number; a: THREE.Vector3; b: THREE.Vector3 } | null;
  /** Bow (TP draw overlay): string ends and the grip in MODEL space (bind pose); null = no bow. */
  bow: { top: THREE.Vector3; bottom: THREE.Vector3; grip: THREE.Vector3 } | null;
}

const W_GEM: Record<string, string> = { gold: '#ffd76a', sparks: '#fff0a8', halo: '#ffe27a', shadow: '#a24bff', frost: '#8fd4ff', plain: '#d9a441' };
const STRIPE_MUL = 0.72;

/** Hat actually drawn: own look hat; when none, the worn helmet (class hats, miner…). */
export function hatOf(app: Appearance): { id: string; rar?: string } {
  const h = app.look.hat || 'none';
  if (h !== 'none') return { id: h };
  if (app.gear.h) return { id: app.gear.h, rar: app.gear.hr };
  return { id: 'none' };
}

/**
 * The face decal key of an appearance on a model: eyes, mouth, blush, iris, style, narrow, ghost. Per AVATAR, not per
 * model — models are shared by geometry (mouth / blush are not in modelKey), so the face must come from the look itself.
 */
export function faceKeyOf(app: Appearance, d: BodyDims): string {
  const l = app.look, ex = nickExtras(app.login, app.styleId);
  return [l.eyes, l.mouth, l.blush ? 1 : 0, ex.iris, app.styleId, d.narrow ? 1 : 0, app.ghost ? 1 : 0].join('|');
}

export function modelKey(app: Appearance): string {
  const l = app.look, g = app.gear, ex = nickExtras(app.login, app.styleId), hat = hatOf(app);
  // cherts: the imp's width (site floor(r·n) units) and its per-nick horns / tail / beard are part of the geometry
  const chk = app.styleId === 'cherts' ? (() => { const t = chTraits(jhash(app.login)); return [Math.floor(ex.w01 * 120), t.horn, t.hornCol, t.tip, t.tshape, +t.belly, +t.goatee].join(','); })() : '';
  // eyes shape geometry too (glasses frames round the eyes, the low mesh's eye dots: one for the cyclops)
  return [app.styleId, l.shape, Math.round(ex.w01 * 4), chk, ex.pat, l.eyes || '', l.color, l.color2, hat.id, hat.rar || '', (l.acc || []).slice().sort().join('+'),
    l.accColor, l.capeColor, g.a || '', g.ar || '', g.am || '', g.w || '', g.wr || '', g.s || '', g.sr || '', g.t || '', g.tr || '', app.ghost ? 1 : 0].join('|');
}

const cache = new Map<string, ModelData>();
export function getModel(app: Appearance): ModelData {
  const key = modelKey(app);
  let m = cache.get(key);
  if (!m) {
    m = buildModel(app, key);
    setDetail(0.5);
    try { const m2 = buildModel(app, key); m.mid = m2.geo; m2.low.dispose(); } finally { setDetail(1); }
    cache.set(key, m);
  }
  m.refs++;
  return m;
}
export function releaseModel(m: ModelData) {
  m.refs--;
  if (m.refs <= 0 && cache.size > 64) {   // keep a warm cache; evict only when large
    cache.delete(m.key); m.geo.dispose(); m.mid.dispose(); m.low.dispose();
  }
}

/* ------------------------------------------------------------------ build */

function buildModel(app: Appearance, key: string): ModelData {
  const l = app.look, g = app.gear, style = String(app.styleId || 'legion');
  const ex = nickExtras(app.login, app.styleId);
  const ch = style === 'cherts', tr = ch ? chTraits(jhash(app.login)) : null;
  const d: BodyDims = ch ? chDims(String(l.shape), ex.w01) : bodyDims(String(l.shape), Math.round(ex.w01 * 4) / 4);
  const cd = ch ? (d as ChDims) : null;
  const cat = style === 'cats', monkey = style === 'monkeys' || style === 'ugabugi';
  const c1 = l.color || '#f2a65a', c2 = l.color2 || '#4aa3ff';
  const C1 = col(c1), C2 = col(c2);
  const p = new Parts();
  const tmp = new THREE.Color(), light = new THREE.Color('#ffffff');
  const pat = cat ? ex.pat : 0;

  /* ---- bones (rest) ---- */
  const neckY = d.mouthY - 0.105;
  const sx = radiusAt(d, d.armY) * 0.97;
  const legX = Math.min(radiusAt(d, d.y0 + 0.08) * 0.5, 0.13);
  const backZ = radiusAt(d, d.y0 + 0.15) * d.depth;
  const rest: THREE.Vector3[] = [
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(0, d.y0, 0),
    new THREE.Vector3(-sx, d.armY, 0), new THREE.Vector3(sx, d.armY, 0),
    new THREE.Vector3(-legX, d.y0 + 0.04, 0), new THREE.Vector3(legX, d.y0 + 0.04, 0),
    new THREE.Vector3(0, d.y0 + 0.13, backZ * 0.9), new THREE.Vector3(0, d.y0 + 0.36, backZ * 0.9 + 0.17),
    new THREE.Vector3(0, neckY, radiusAt(d, neckY) * d.depth * 0.9), new THREE.Vector3(0, (neckY + 0.02) / 2, radiusAt(d, neckY) * d.depth + 0.12),
  ];

  /* ---- body ---- */
  p.bone = B.body;
  const ghostShape = d.shape === 'ghost';
  p.add(bodyShell(d, {
    yA: d.y0, yB: d.top, segs: 32, rings: 24,
    yWarp: ghostShape ? (th, y, t) => (t === 0 ? y - (ch ? 0.05 * (0.5 + 0.5 * Math.cos(th * 6)) : 0.035 * (0.5 + 0.5 * Math.cos(th * 4))) : y) : undefined,
    color: cd && tr ? chBodyColor(cd, tr, c1) : (th, y, t, out) => {
      out.copy(C1);
      const front = Math.cos(th);
      if ((pat === 2 || pat === 4) && front > 0.45 && y < d.armY - 0.02 && y > d.y0 + 0.04) out.lerp(light, 0.5);
      if ((pat === 1 || pat === 4) && front < 0.3) { const s = Math.sin((y - d.y0) * 55); if (s > 0.55) out.multiplyScalar(STRIPE_MUL); }
      if (pat === 1 || pat === 4) { if (y > d.top - 0.07 && Math.abs(Math.sin(th)) < 0.12 && Math.abs(th) < 1) out.multiplyScalar(STRIPE_MUL); }
      if (pat === 3 && th < -0.25 && th > -0.95 && Math.abs(y - d.eyeY) < 0.07) out.multiplyScalar(STRIPE_MUL);
      if (t < 0.03 && !ghostShape) out.multiplyScalar(0.92);
    },
  }));
  if (!ghostShape) p.add(new THREE.CircleGeometry(radiusAt(d, d.y0 + 0.004), 24), c1, T(0, d.y0 + 0.001, 0, Math.PI / 2, 0, 0, [1, d.depth, 1]));
  else p.add(new THREE.CircleGeometry(radiusAt(d, d.y0 + 0.004), 24), tmp.copy(C1).multiplyScalar(0.8), T(0, d.y0 - 0.01, 0, Math.PI / 2, 0, 0, [1, d.depth, 1]));

  /* ---- ears ---- */
  const hat = hatOf(app);
  const earY = d.top - (d.shape === 'box' ? 0.0 : 0.05);
  const er = radiusAt(d, earY);
  if (cat) {
    for (const s of [-1, 1]) {
      const m = T(s * er * 0.66, earY + 0.07, 0, 0, Math.PI / 4, s * -0.3, [1, 1, 0.5]);
      p.add(cone(0.088, 0.18, 4), c1, m);
      p.add(cone(0.058, 0.125, 4), '#ff8fa3', T(s * er * 0.64, earY + 0.06, -0.025, 0, Math.PI / 4, s * -0.3, [1, 1, 0.3]));
    }
  } else if (monkey) {
    const ey = d.eyeY + 0.01, r = radiusAt(d, ey);
    for (const s of [-1, 1]) {
      p.add(sphere(0.075, 12, 8), c1, T(s * (r + 0.035), ey, 0.0, 0, 0, 0, [0.45, 1, 1]));
      p.add(sphere(0.052, 10, 6), '#ffe4c4', T(s * (r + 0.05), ey, -0.008, 0, 0, 0, [0.3, 1, 1]));
    }
  }
  /* ---- cherts: horns, bat ears, the fire spirit's flame top, goat beard, the hatchling's shell ---- */
  let hornTop = 0;
  if (cd && tr) {
    hornTop = addHorns(p, cd, tr, B.body);
    if (cd.kind === 'bat') addBatEars(p, cd, c1, B.body);
    if (cd.kind === 'wisp') addWispFlames(p, cd, c1, B.body);
    if (tr.goatee) addGoatee(p, cd, c1, B.body);
    if (cd.kind === 'hatch') addShell(p, cd, B.root);
    addBodyMarks(p, cd, tr, c1, B.body);
  }

  /* ---- armor ---- */
  const rk = RANK[g.ar || 'common'] || 0, rc = g.ar && g.ar !== 'common' ? RARITY_COLOR[g.ar] : null;
  let armorShell: { yA: number; yB: number; off: number } | null = null;
  if (g.a) armorShell = addArmor(p, d, g.a, g.ar, g.am, { yB: neckY, sx, ghost: ghostShape, boneL: B.armL, boneR: B.armR });
  // amulet
  if (g.t) {
    const gy = neckY - 0.06, zf = -radiusAt(d, gy) * d.depth - 0.018;
    p.add(new THREE.OctahedronGeometry(0.026, 0), W_GEM[g.t] || W_GEM.plain, T(0, gy, zf, 0, 0, 0, [1, 1.3, 0.6]));
    p.add(torus(radiusAt(d, neckY) * 0.95, 0.005, 3, 18), '#d9a441', T(0, neckY + 0.005, 0, Math.PI / 2 + 0.25, 0, 0, [1, d.depth, 1]));
  }

  /* ---- hat & accessories ---- */
  const acc = (l.acc || []).map(String);
  const hatH = (cd && !hat.rar ? addChertsHat(p, hat.id, chHatDims(cd), c2) : null) ?? addHat(p, hat.id, { d: cd ? chHatDims(cd) : d, c1, c2, rar: hat.rar, style });
  addAccessories(p, acc, { d, accColor: l.accColor || c2, cyc: l.eyes === 'cyclops', eyes: String(l.eyes || 'dots'), shell: armorShell });

  /* ---- arms & paws ---- */
  const armLen = d.shape === 'ball' ? 0.15 : 0.175;
  const handL = new THREE.Vector3(-0.085, -armLen, -0.03), handR = new THREE.Vector3(0.085, -armLen, -0.03);
  rest.push(new THREE.Vector3().copy(rest[B.armR]).add(handR));   // B.wrist
  rest.push(rest[B.wrist].clone());                                // B.bowString (moved to the string centre below)
  const sleeve = g.a && g.a !== 'robe' && g.a !== 'shroud' ? null : g.a ? (g.a === 'robe' ? W_CLOTH[g.ar || 'common'] : SHROUD[rk]) : null;
  for (const s of [-1, 1]) {
    const bone = s < 0 ? B.armL : B.armR, r = rest[bone], hand = s < 0 ? handL : handR;
    p.bone = bone;
    const lim = tube([[r.x - s * 0.02, r.y + 0.01, r.z], [r.x + s * 0.06, r.y - armLen * 0.45, r.z - 0.015], [r.x + hand.x, r.y + hand.y + 0.035, r.z + hand.z]], 0.032, 8, 7);
    p.add(lim, sleeve || c1);
    p.add(sphere(0.05, 12, 8), c1, T(r.x + hand.x, r.y + hand.y, r.z + hand.z, 0, 0, 0, [1, 0.95, 1]));
    if (cat) for (const k of [-1, 1]) p.add(sphere(0.012, 5, 4), '#ff8fa3', T(r.x + hand.x + k * 0.016, r.y + hand.y - 0.03, r.z + hand.z - 0.035));
    if (ch) for (const k of [-1, 0, 1]) p.add(cone(0.007, 0.022, 4), CH_INK, T(r.x + hand.x + k * 0.02, r.y + hand.y - 0.012, r.z + hand.z - 0.05, -1.2, 0, k * 0.3));   // claws
  }
  /* ---- weapon & shield ---- */
  let blade: ModelData['blade'] = null;
  let bow: ModelData['bow'] = null;
  if (g.w) {
    const r = rest[B.armR];
    // hand pose (tip up-forward; staffs nearly upright; spears levelled forward; bow upright; censer hanging), then the
    // canonical hold (gear.ts weaponHold: edge / head forward, bow string and grimoire cover towards the holder)
    const w = g.w, tilt = TP_TILT[w] ?? -0.65;
    const m = new THREE.Matrix4().multiplyMatrices(T(r.x + handR.x, r.y + handR.y, r.z + handR.z, tilt, 0, w === 'censer' ? 0 : -0.15), weaponHold(w));
    p.bone = B.wrist;
    addWeapon(p, w, g.wr, m, false, w === 'bow' ? B.bowString : undefined);
    if (w === 'bow') {
      const sc = BOW_STRING;
      rest[B.bowString].set((sc.top[0] + sc.bottom[0]) / 2, (sc.top[1] + sc.bottom[1]) / 2, (sc.top[2] + sc.bottom[2]) / 2).applyMatrix4(m);
      bow = {
        top: new THREE.Vector3(...sc.top).applyMatrix4(m), bottom: new THREE.Vector3(...sc.bottom).applyMatrix4(m),
        grip: new THREE.Vector3(...sc.grip).applyMatrix4(m),
      };
    }
    const span = bladeSpan(w);
    if (span) blade = { bone: B.wrist, a: new THREE.Vector3(0, span[0], 0).applyMatrix4(m), b: new THREE.Vector3(0, span[1], 0).applyMatrix4(m) };
  } else {
    // bare paw (slap): a short streak along the forearm through the paw
    const r = rest[B.armR], dir = handR.clone().normalize();
    const hand = new THREE.Vector3().copy(r).add(handR);
    blade = { bone: B.armR, a: hand.clone().addScaledVector(dir, -0.05), b: hand.clone().addScaledVector(dir, 0.07) };
  }
  if (g.s) {
    const r = rest[B.armL];
    p.bone = B.armL;
    // held on the forearm, facing front-left; kept forward of the body sides so it never cuts through a cape
    addShield(p, g.s, g.sr, T(r.x + handL.x - 0.045, r.y + handL.y + 0.06, r.z + handL.z - 0.075, 0, 0.45, 0.05));
  }

  /* ---- legs ---- */
  const hasLegs = !ghostShape && !(cd && cd.kind === 'hatch');
  if (hasLegs) {
    for (const s of [-1, 1]) {
      const bone = s < 0 ? B.legL : B.legR, r = rest[bone];
      p.bone = bone;
      p.add(cyl(0.048, 0.052, r.y - 0.02, 8), c1, T(r.x, (r.y + 0.02) / 2, r.z));
      if (ch) addHoof(p, r.x, r.z, bone);
      else p.add(sphere(0.064, 12, 8), c1, T(r.x, 0.038, r.z - 0.028, 0, 0, 0, [1, 0.62, 1.38]));
      if (cat) for (const k of [-1, 0, 1]) p.add(sphere(0.012, 5, 4), '#ff8fa3', T(r.x + k * 0.022, 0.012, r.z - 0.09));
    }
  }

  /* ---- capes (computed first: the tail routes around a cape) ---- */
  // vampcape (Halloween, doodle.js): black cape with a red lining, high pointed collar, gold clasps
  const vamp = acc.includes('vampcape') && !acc.includes('cape');
  const capeCol = acc.includes('cape') ? (l.capeColor || '#c0182b') : vamp ? '#1c1424' : acc.includes('pioneer') ? '#35507a' : null;
  const hasCape = !!capeCol;
  const hasTail = cat || monkey || ch;
  if (cd) {   // the imp's tail leaves the lower back (the hatchling's: just above its shell)
    const ty = cd.kind === 'hatch' ? cd.y0 + cd.H * 0.4 : Math.max(d.y0 + 0.07, 0.15);
    rest[B.tail1].set(0, ty, radiusAt(d, ty) * d.depth * 0.88 + (cd.kind === 'hatch' ? 0.03 : 0));
  }
  const t0 = rest[B.tail1], t1 = rest[B.tail2];
  const tailBack = hasCape ? 0.07 : 0;   // with a cape the tail rises a little further back, clear of the cloth

  /* ---- tail ---- */
  if (cd && tr) {
    const tb = addTail(p, cd, tr, c1, t0, tailBack, B.tail1, B.tail2);
    t1.copy(tb.tail2);
    // a soft joint where the tail leaves the body
    const jz = radiusAt(d, t0.y) * d.depth;
    p.add(sphere(0.034, 10, 7), c1, T(0, t0.y + 0.005, jz - 0.012, 0, 0, 0, [1, 1, 0.8]), B.body);
  } else if (hasTail) {
    const tr = monkey ? 0.032 : 0.042, taper = 0.14;
    const zb = t0.z + tailBack;
    const pts: [number, number, number][] = monkey
      ? [[0, t0.y + 0.01, t0.z - 0.09], [0, t0.y, t0.z + 0.02], [0.02, t0.y - 0.01, zb + 0.12], [0.05, t0.y + 0.1, zb + 0.25], [0.05, t0.y + 0.3, zb + 0.26], [0.04, t0.y + 0.38, zb + 0.15], [0.03, t0.y + 0.3, zb + 0.1]]
      : [[0, t0.y + 0.01, t0.z - 0.09], [0, t0.y, t0.z + 0.02], [0.03, t0.y + 0.015, zb + 0.12], [0.06, t0.y + 0.15, zb + 0.2], [0.06, t0.y + 0.3, zb + 0.16], [0.09, t0.y + 0.36, zb + 0.2]];
    const skin: Skin = (_x, y, z) => {
      if (z < t0.z - 0.01) return [B.tail1, B.tail1, 1];
      const w = Math.min(1, Math.max(0, (y - t0.y) / (t1.y - t0.y))); return [B.tail1, B.tail2, 1 - w];
    };
    const tg = tube(pts, tr, 22, 9, taper);
    const tipC = new THREE.Color().copy(C1);
    if (pat === 1 || pat === 4) {
      const perRing = tg.attributes.position.count / ((tg as THREE.TubeGeometry).parameters.tubularSegments + 1);
      const cAttr = new Float32Array(tg.attributes.position.count * 3), stripe = new THREE.Color().copy(C1).multiplyScalar(STRIPE_MUL);
      const rings = (tg as THREE.TubeGeometry).parameters.tubularSegments + 1;
      for (let i = 0; i < tg.attributes.position.count; i++) {
        const ring = Math.floor(i / perRing), t = ring / (rings - 1);
        // stripes only on the visible part (outside the body), 3 rings dark / 3 light, last ring = tip colour
        const c = t > 0.25 && Math.floor(ring / 3) % 2 === 1 ? stripe : C1;
        cAttr[i * 3] = c.r; cAttr[i * 3 + 1] = c.g; cAttr[i * 3 + 2] = c.b;
        if (ring === rings - 1) tipC.copy(c);
      }
      tg.setAttribute('color', new THREE.BufferAttribute(cAttr, 3));
      p.add(tg, undefined, undefined, skin);
    } else p.add(tg, c1, undefined, skin);
    // rounded tip (the tube is open) and a soft joint where the tail leaves the body (static, on the body bone)
    const e = pts[pts.length - 1];
    p.add(sphere(tr * (1 - taper), 10, 7), tipC, T(e[0], e[1], e[2]), skin);
    const jy = t0.y + 0.005, jz = radiusAt(d, jy) * d.depth;
    p.add(sphere(tr * 1.35, 12, 8), c1, T(0, jy, jz - 0.012, 0, 0, 0, [1, 1, 0.8]), B.body);
  }

  /* ---- cape: two layers (outer colour, darker lining) + a rim, so it has thickness and never z-fights ---- */
  if (capeCol) {
    const pioneer = !acc.includes('cape') && !vamp;
    const yTop = neckY + 0.02, yBot = hasTail ? t0.y + 0.1 : 0.06;
    const armorOff = g.a ? 0.014 : 0;
    const TH = 0.014;                     // cloth thickness
    const segs = 16, rings = 12;
    const thA = Math.PI / 2 + 0.45, thB = Math.PI * 1.5 - 0.45;   // the back, through θ = π (+Z); sides left free for arms/shield
    const rArm = radiusAt(d, d.armY) * 0.95;
    const pt = { x: 0, z: 0 };
    const capePt = (i: number, j: number, inset: number, out: number[]) => {
      const t = j / rings, y = yTop + (yBot - yTop) * t;
      const a = thA + ((thB - thA) * i) / segs;
      // hugs the body (and armour) at the top, flares a little towards the hem; never closer than the shoulders
      const r = Math.max(radiusAt(d, Math.max(y, d.y0 + 0.02)), rArm * (0.9 + 0.1 * t)) * (1 + 0.1 * t) + 0.026 + armorOff - inset;
      sectionXZ(d, r, a, pt);
      const spread = 1 + t * 0.22 * (pioneer ? 1.1 : 1);
      const hem = t === 1 && pioneer ? 0.02 * Math.cos(i * 1.4) : 0;
      out.push(pt.x * spread, y + hem, pt.z + t * 0.05);
    };
    const grid = (inset: number, flip: boolean) => {
      const pos: number[] = [], idx: number[] = [];
      for (let j = 0; j <= rings; j++) for (let i = 0; i <= segs; i++) capePt(i, j, inset, pos);
      for (let j = 0; j < rings; j++) for (let i = 0; i < segs; i++) {
        const a = j * (segs + 1) + i, b = a + 1, c = a + segs + 1, e = c + 1;
        if (flip) idx.push(a, c, b, b, c, e); else idx.push(a, b, c, b, e, c);
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setIndex(idx); geo.computeVertexNormals();
      return geo;
    };
    // rim: a strip joining outer and inner along both sides and the hem
    const rim = () => {
      const pos: number[] = [], idx: number[] = [];
      const edge: [number, number][] = [];
      for (let j = 0; j <= rings; j++) edge.push([0, j]);
      for (let i = 1; i <= segs; i++) edge.push([i, rings]);
      for (let j = rings - 1; j >= 0; j--) edge.push([segs, j]);
      for (const [i, j] of edge) { capePt(i, j, 0, pos); capePt(i, j, TH, pos); }
      for (let k = 0; k < edge.length - 1; k++) { const a = k * 2, b = a + 1, c = a + 2, e = a + 3; idx.push(a, b, c, b, e, c); }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setIndex(idx); geo.computeVertexNormals();
      return geo;
    };
    const skin: Skin = (_x, y) => { const w = Math.min(1, Math.max(0, (yTop - y) / (yTop - yBot))); return [B.cape1, B.cape2, 1 - Math.min(1, w * 1.3)]; };
    const outerC = col(capeCol), innerC = vamp ? col('#b0182a') : new THREE.Color().copy(pioneer ? col('#9fc4ea') : outerC).multiplyScalar(pioneer ? 0.85 : 0.68);
    const rimC = new THREE.Color().copy(outerC).multiplyScalar(0.8);
    const outer = grid(0, false), inner = grid(TH, true), edge = rim();
    // the rim is a thin strip seen from both sides: add it with both windings (cheap, no orientation guesswork)
    const edge2 = edge.clone(); { const ix = Array.from(edge2.index!.array); for (let q = 0; q < ix.length; q += 3) { const t = ix[q + 1]; ix[q + 1] = ix[q + 2]; ix[q + 2] = t; } edge2.setIndex(ix); edge2.computeVertexNormals(); }
    p.add(outer, outerC, undefined, skin);
    p.add(inner, innerC, undefined, skin);
    p.add(edge, rimC, undefined, skin);
    p.add(edge2, rimC, undefined, skin);
    // collar: a rolled edge along the top of the cape, wrapping to the front, with clasps
    const cpts: [number, number, number][] = [];
    const rc = radiusAt(d, yTop) + 0.02 + armorOff;
    for (let i = 0; i <= 12; i++) { const a = Math.PI / 2 - 0.35 + ((Math.PI + 0.7) * i) / 12; sectionXZ(d, rc, a, pt); cpts.push([pt.x, yTop + 0.004, pt.z]); }
    p.add(tube(cpts, 0.016, 24, 6), pioneer ? '#cfe8ff' : vamp ? '#1c1424' : '#ffc94d', undefined, B.body);
    if (vamp) {
      // the high collar: two pointed panels standing up behind the head (red inside, black outside)
      for (const s of [-1, 1]) {
        // the body (= head) widens above the neck: stand the panels just outside it, flaring out and back
        const yc = yTop + 0.09, a = Math.PI + s * 0.8; sectionXZ(d, Math.max(rc, radiusAt(d, yc)) + 0.03, a, pt);
        const panel = (k2: number, c: string) => p.add(cone(0.1, 0.26, 3), c, T(pt.x * k2, yc, pt.z * k2, 0.35, s * 0.6, -s * 0.45, [1, 1, 0.22]), B.body);
        panel(1.03, '#1c1424'); panel(0.99, '#b0182a');
      }
    }
    for (const s of [-1, 1]) {
      const a = s > 0 ? Math.PI / 2 - 0.35 : -(Math.PI / 2 - 0.35); sectionXZ(d, rc + 0.01, a, pt);
      if (pioneer) p.add(star(0.03, 0.012), '#ffd36b', T(pt.x, yTop - 0.005, pt.z, 0, s * 0.9, 0), B.body);
      else p.add(sphere(0.026, 10, 7), '#ffc94d', T(pt.x, yTop, pt.z, 0, 0, 0, [1, 1, 0.7]), B.body);
    }
  }

  /* ---- cherts wings: behind the body and the arms; on the cape1 bone (flapped by the avatar) unless a cape uses it ---- */
  if (cd) addWings(p, cd, c1, hasCape ? B.body : B.cape1);

  const geo = p.build(true);
  geo.computeBoundingSphere();

  /* ---- LOD2: static low mesh ---- */
  const q = new Parts();
  q.add(bodyShell(d, { yA: d.y0, yB: d.top, segs: 12, rings: 8, color: (_t, _y, _tt, out) => out.copy(C1) }));
  if (hasLegs) for (const s of [-1, 1]) q.add(sphere(0.07, 6, 4), c1, T(s * legX, 0.05, -0.02, 0, 0, 0, [1, 0.8, 1.3]));
  for (const s of [-1, 1]) q.add(sphere(0.055, 6, 4), c1, T(s * (sx + 0.05), d.armY - armLen, -0.02));
  if (cat) for (const s of [-1, 1]) q.add(cone(0.075, 0.16, 4), c1, T(s * er * 0.66, earY + 0.06, 0, 0, Math.PI / 4, s * -0.32, [1, 1, 0.5]));
  if (hat.id !== 'none' && hatH > 0.05) q.add(cyl(radiusAt(d, d.top - 0.08) * 0.8, radiusAt(d, d.top - 0.08) * 0.9, Math.min(0.2, hatH), 8), hat.id === 'miner' ? '#ffcf3a' : c2, T(0, d.top - 0.02 + Math.min(0.2, hatH) / 2, 0));
  if (g.a) q.add(bodyShell(d, { yA: Math.max(d.y0, neckY - 0.42), yB: neckY, segs: 12, rings: 3, off: 0.01, color: (_t, _y, _tt, out) => out.set(armorBase(g.a === 'lorica' && g.am === 'light' ? 'light' : g.a!, g.ar)) }));
  if (capeCol) q.add(cyl(0.2, 0.32, neckY, 8, true), capeCol, T(0, neckY / 2, 0.08, 0, 0, 0, [1, 1, 0.5]));
  // eyes (two dark dots) and the tail keep the far silhouette readable
  { const ez = -radiusAt(d, d.eyeY) * d.depth * 0.97, exx = d.ex * 1.25;
    for (const s of l.eyes === 'cyclops' ? [0] : [-1, 1]) q.add(sphere(0.034, 5, 3), app.ghost ? '#1d2a4a' : INK, T(s * exx, d.eyeY, ez + 0.01, 0, 0, 0, [1, 1.15, 0.5])); }
  if (cd && tr) {
    addWings(q, cd, c1, 0, true);
    for (const s of [-1, 1]) q.add(cone(0.04, 0.12, 5), tr.hornCol, T(s * Math.max(8, cd.hwU * 0.55) * 0.012, d.top - 0.03, 0, 0, 0, -s * 0.4));
    addTail(q, cd, tr, c1, rest[B.tail1], 0, 0, 0, true);
  } else if (hasTail) { const t0 = rest[B.tail1]; q.add(tube([[0, t0.y, t0.z - 0.03], [0.04, t0.y + 0.08, t0.z + 0.17], [0.07, t0.y + 0.32, t0.z + 0.17]], monkey ? 0.032 : 0.042, 4, 4), c1); }
  const low = q.build(false);
  low.computeBoundingSphere();

  const faceKey = faceKeyOf(app, d);   // of the first appearance built: avatars use faceKeyOf(their own app)
  return {
    key, geo, mid: geo, low, rig: { rest, handL, handR }, dims: d, headTop: Math.max(d.top + Math.max(0, hatH) + (cat && hatH < 0.12 ? 0.1 : 0), hornTop),
    faceKey, hasLegs, hasTail, hasCape, wings: ch, radius: Math.max(0.9, geo.boundingSphere!.radius + 0.4), refs: 0, blade, bow,
  };
}

export function clearModelCache() { for (const m of cache.values()) { m.geo.dispose(); m.mid.dispose(); m.low.dispose(); } cache.clear(); }
void slab; void capsule;
