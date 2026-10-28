/**
 * «Шатёр» (wardrobe looks): a round striped tent, a curtained booth per wardrobe category (stock.booths — shape, colour,
 * eyes, mouth, blush, hat, accessory, aura) with a mannequin wearing YOUR look plus the booth's sample (try-on), and the
 * amulets (stock.amulets, coins) on the velvet table in the middle. Looks are points-only on stream; owned ones are worn
 * with /api/wear (like the site's tent).
 */
import * as THREE from 'three';
import type { RoomBase } from '../common/base';
import { hitBox, inward, ONE_SIDED } from '../common/kit';
import { stringLights, potPlant, stool, candle, painting, dot } from '../common/decor';
import { GEO } from '../../world/batch';
import type { TentStock, Booth, BoothSample } from '../common/stock';
import { sampleOwned, sampleWorn } from '../common/stock';
import { stripeColors } from '../../world/kit';
import { createAvatarKit, appearanceFrom } from '../../avatar';
import type { Avatar } from '../../contracts/modules';
import type { Look } from '../../contracts';
import { faceTo } from '../common/npc';
import { chertsTentGold, tentTheme, batWingRing } from './style';

const RAD = 5.6, WALL = 2.8, APEX = 6.4;
const _d = new THREE.Vector3(), _p = new THREE.Vector3(), _s = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0), _q = new THREE.Quaternion(), _m = new THREE.Matrix4();
/** Half-size of the lawn square around the tent the TP camera may back into. */
const OUT = RAD + 2.6;
/** Mannequin LOD switch distances (m): LOD0 within LOD_NEAR, back to LOD1 beyond LOD_FAR. */
const LOD_NEAR = 4.6, LOD_FAR = 5.2;

export function buildTent(R: RoomBase, st: TentStock | null): void {
  const K = R.kit, P = R.pal;
  // per art style (cherts: «Гардероб демона-франта» — black velvet and gold, red curtains, a bat-wing valance)
  const Th = tentTheme(R.env.styleId), ch = !!Th.cherts;
  const C1 = Th.c1, C2 = Th.c2, VELVET = Th.velvet, VELVET_D = Th.velvetD, GOLDC = Th.gold;
  // gold: polished metal in the cherts wardrobe (the site's gold rims, rivets, studs), painted wood elsewhere
  const GM = ch ? 'metal' as const : 'wood' as const;
  R.bg = Th.bg; R.fogFar = 40;
  K.bounds = { x0: -RAD, x1: RAD, z0: -RAD, z1: RAD };
  K.circle = { x: 0, z: 0, r: RAD - 0.15 };
  // floor, and the night lawn around the tent: the TP camera may back out through the canvas (seen from inside only)
  K.box(ch ? 'stone' : 'wood', Th.floor, -RAD - 0.3, RAD + 0.3, -0.1, 0, -RAD - 0.3, RAD + 0.3);
  K.box('paving', P.ground, -OUT - 1, OUT + 1, -0.14, -0.04, -OUT - 1, OUT + 1);
  // the fair around the tent (seen only by the TP camera outside the canvas): lamp posts with pools of light, bushes,
  // a festoon from post to post, guy ropes and pegs
  for (let i = 0; i < 8; i++) {
    const a = (i + 0.5) / 8 * Math.PI * 2, r = RAD + 1.7, x = Math.sin(a) * r, z = Math.cos(a) * r;
    if (i % 2 === 0) { K.prop('lamp', x, -0.04, z, -a, 1.0, { solid: false }); K.glow(x, 2.85, z, 1.3, '#ffcf6a', 0.9); K.splash(x, 0.0, z, 3.0, 3.0, '#ffcf6a', 0.3, 0, -Math.PI / 2); }
    else K.prop('bush', x, -0.04, z, a, 1.1, { solid: false });
    const a2 = (i + 1.5) / 8 * Math.PI * 2;
    if (i % 2 === 0) stringLights(K, x, 2.7, z, Math.sin(a2 + Math.PI / 8) * r, 2.7, Math.cos(a2 + Math.PI / 8) * r, 8, undefined, 0.4, 0.5);
    const ga = i / 8 * Math.PI * 2 + 0.2, gx = Math.sin(ga), gz = Math.cos(ga);
    _d.set(gx * 1.8, -(WALL - 0.1), gz * 1.8); const L = _d.length(); _q.setFromUnitVectors(_up, _d.normalize());
    K.geo('back', GEO.box, _m.compose(_p.set(gx * (RAD + 0.9), (WALL - 0.1) / 2, gz * (RAD + 0.9)), _q, _s.set(0.02, L, 0.02)), '#e8dcc8');
    K.cyl('wood', '#8a5a2b', gx * (RAD + 1.8), -0.04, gz * (RAD + 1.8), 0.04, 0.2, 8);
  }
  for (const [x0, x1, z0, z1] of [[-OUT - 1, OUT + 1, -OUT - 1, -OUT], [-OUT - 1, OUT + 1, OUT, OUT + 1], [-OUT - 1, -OUT, -OUT, OUT], [OUT, OUT + 1, -OUT, OUT]]) K.camBoxes.push(x0, x1, -1, 9, z0, z1);
  K.camBoxes.push(-OUT - 1, OUT + 1, APEX - 0.6, APEX + 1, -OUT - 1, OUT + 1);
  K.vestibule = OUT - RAD;
  K.geo('canvas', new THREE.CylinderGeometry(3.2, 3.2, 0.02, 40), new THREE.Matrix4().makeTranslation(0, 0.01, 0), Th.rug);
  K.geo('canvas', new THREE.CylinderGeometry(2.9, 2.9, 0.02, 40), new THREE.Matrix4().makeTranslation(0, 0.02, 0), VELVET);
  // striped canvas wall with a door gap at +Z, roof cone
  const gap = 0.32;
  const wallG = inward(stripeColors(new THREE.CylinderGeometry(RAD, RAD, WALL, 48, 1, true, gap / 2 + Math.PI, Math.PI * 2 - gap).rotateY(Math.PI), C1, C2, 24));
  K.geo(ONE_SIDED, wallG, new THREE.Matrix4().makeTranslation(0, WALL / 2, 0), null, 1.5); wallG.dispose();
  const roofG = stripeColors(new THREE.ConeGeometry(RAD + 0.25, APEX - WALL, 48, 1, true), C1, C2, 24);
  K.geo('canvas', roofG, new THREE.Matrix4().makeTranslation(0, WALL + (APEX - WALL) / 2, 0), null, 1.5); roofG.dispose();
  // scalloped valance + gold ring at the wall top
  K.geo('wood', new THREE.TorusGeometry(RAD - 0.05, 0.06, 6, 64).rotateX(Math.PI / 2), new THREE.Matrix4().makeTranslation(0, WALL, 0), GOLDC);
  if (ch) {
    batWingRing(R, RAD, WALL - 0.02, 40, gap, ['#1a0a10', VELVET_D]);
    chertsTentGold(R, RAD, WALL, gap, GOLDC);
  }
  else for (let i = 0; i < 40; i++) { const a = (i / 40) * Math.PI * 2; if (Math.abs(Math.atan2(Math.sin(a), Math.cos(a))) < gap) continue; K.ball('canvas', i % 2 ? C1 : C2, Math.sin(a) * (RAD - 0.12), WALL - 0.12, Math.cos(a) * (RAD - 0.12), 0.2, 0.55); }
  // centre: round velvet table + pole to the apex
  K.cyl(GM, ch ? '#1a0610' : P.woodD, 0, 0, 0, 0.95, 0.82, 16); K.cyl('canvas', VELVET, 0, 0.82, 0, 1.0, 0.08, 16); K.geo('canvas', new THREE.CylinderGeometry(1.06, 1.06, 0.18, 24, 1, true), new THREE.Matrix4().makeTranslation(0, 0.78, 0), GOLDC);
  K.cyl(GM, GOLDC, 0, 0.9, 0, 0.07, APEX - 0.9, 12);
  K.ball('emit', '#ffcf6a', 0, APEX - 0.6, 0, 0.18); K.light(0, APEX - 1.4, 0, '#ffc07a', 7, 11, 1.8);
  K.solid(-0.98, 0.98, -0.98, 0.98, 0.9);
  // amulets on cushions around the table
  const am = (st && st.amulets) || [];
  am.slice(0, 8).forEach((it, i, a) => {
    const ang = Math.PI + (i - (a.length - 1) / 2) * 0.62, r = 0.72, x = Math.sin(ang) * r, z = Math.cos(ang) * r;
    K.box('canvas', VELVET_D, x - 0.11, x + 0.11, 0.9, 0.95, z - 0.11, z + 0.11);
    R.good(it, 'tent', { x, y: 0.95, z, ry: ang, fit: 0.24, fitH: true }, [Math.sin(ang) * 1.04, 0.86, Math.cos(ang) * 1.04, ang, -0.35]);
  });
  // garlands from the pole to the wall
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2 + 0.2;
    for (let j = 1; j < 9; j++) {
      const t = j / 9, x = Math.sin(a) * RAD * 0.92 * t, z = Math.cos(a) * RAD * 0.92 * t, y = (APEX - 1.0) * (1 - t) + (WALL - 0.1) * t - Math.sin(t * Math.PI) * 0.35;
      dot(K, x, y, z, 0.05, Th.dots[(j + k) % 4]); if (j % 2) K.glow(x, y, z, 0.35, Th.dots[0], 0.6);
    }
  }
  // booths
  const booths = ((st && st.booths) || []).slice(0, 9);
  const n = booths.length;
  const kit = createAvatarKit();
  const mannequins: { av: Avatar; ph: number; base: number; x: number; z: number; lod: 0 | 1 }[] = [];
  const hero = R.env.store.hero;
  const baseLook = (): Look => ({ ...((hero && ((hero.wardrobe && hero.wardrobe.cur) || hero.look)) || {}) } as Look);
  const lookWith = (b: Booth, s: BoothSample): Look => {
    const L = baseLook() as any, sl = (s.look || {}) as any;
    // nothing may hide the sample: no glasses over the eyes booth's eyes, no moustache over the mouth booth's mouth
    const hide = b.key === 'eyes' ? ['glasses', 'shades', 'monocle'] : b.key === 'mouth' ? ['mustache', 'fangs'] : null;
    if (hide && Array.isArray(L.acc)) L.acc = L.acc.filter((a: string) => !hide.includes(a));
    if (b.key === 'acc') L.acc = [s.id]; else if (b.key === 'blush') L.blush = !!sl.blush; else Object.assign(L, sl.hasOwnProperty(b.key) ? { [b.key]: sl[b.key] } : { [b.key]: s.id });
    return L;
  };
  const span = Math.PI * 2 - 1.4;   // keep the door sector free
  booths.forEach((b, i) => {
    const ang = Math.PI + (n === 1 ? 0 : (i - (n - 1) / 2) * (span / Math.max(n - 1, 1))), r = RAD - 0.7;
    // `face` = the booth's front for planes (signs, tags, backdrop: 0 faces +Z) → towards the centre;
    // the mannequin uses the avatar convention (0 looks to −Z): looking at the centre is `ang` itself
    const cx = Math.sin(ang) * r, cz = Math.cos(ang) * r, face = ang + Math.PI, look = ang;
    const tx = Math.cos(ang), tz = -Math.sin(ang);   // tangent
    const bw = 1.3;
    // posts, arch, curtains, platform
    for (const sd of [-1, 1]) {
      const px = cx + tx * sd * bw / 2, pz = cz + tz * sd * bw / 2;
      K.cyl(GM, GOLDC, px, 0, pz, 0.05, 2.45, 8);
      K.ball(GM, GOLDC, px, 2.5, pz, 0.08);
      const curt = new THREE.CylinderGeometry(0.16, 0.24, 2.3, 8, 1, false);
      K.geo('canvas', curt, new THREE.Matrix4().compose(new THREE.Vector3(px - Math.sin(ang) * 0.12 + tx * sd * -0.05, 1.18, pz - Math.cos(ang) * 0.12 + tz * sd * -0.05), new THREE.Quaternion(), new THREE.Vector3(1, 1, 0.6)), sd < 0 ? VELVET : VELVET_D); curt.dispose();
    }
    K.rbox(GM, GOLDC, cx, 2.45, cz, bw + 0.1, 0.08, 0.08, face);
    K.rbox('canvas', VELVET, cx + Math.sin(ang) * 0.35, 1.25, cz + Math.cos(ang) * 0.35, bw - 0.1, 2.4, 0.04, face);
    K.geo('wood', new THREE.CylinderGeometry(0.5, 0.55, 0.12, 20), new THREE.Matrix4().makeTranslation(cx, 0.06, cz), Th.base);
    K.sign(`${b.icon ? '' : ''}${b.title || b.key}`, cx - Math.sin(ang) * 0.02, 2.72, cz - Math.cos(ang) * 0.02, 1.2, face, ch ? { ...Th.sign, rim: GOLDC } : Th.sign);
    K.solid(cx - 0.6, cx + 0.6, cz - 0.6, cz + 0.6, Infinity, false);
    R.addTag({ name: b.title || b.key, rarity: b.key === 'aura' ? 'legendary' : 'epic', text: `${(+(b.price || 0)).toLocaleString('ru-RU')} б.` }, [cx - Math.sin(ang) * 0.62 + tx * 0.45, 0.95, cz - Math.cos(ang) * 0.62 + tz * 0.45, face, -0.2]);
    // mannequin: your look + the first sample (or the one you wear)
    const samples = b.samples || [];
    let av: Avatar | null = null;
    const appFor = (s: BoothSample | undefined) => appearanceFrom('mannequin-' + b.key, { name: b.title || b.key, look: s ? lookWith(b, s) : baseLook(), gear: {} }, R.env.styleId);
    // the booth's sample must SHOW on the mannequin: what you wear, else the first sample that looks different from the
    // bare mannequin (the first sample is often the default eyes / mouth — a booth of the default face says nothing)
    const bare = JSON.stringify((appFor(undefined).look as any)[b.key]);
    const differs = (s: BoothSample) => JSON.stringify((appFor(s).look as any)[b.key]) !== bare;
    let cur = samples.find((s) => sampleWorn(hero, b, s)) || samples.find((s) => !sampleOwned(hero, b, s) && differs(s)) || samples.find(differs) || samples[0];
    try {
      av = kit.create(appFor(cur));
      av.setLod(1);
      av.root.position.set(cx, 0.12, cz); av.root.rotation.y = look;
      R.root.add(av.root);
      mannequins.push({ av, ph: i * 1.7, base: look, x: cx, z: cz, lod: 1 });
      R.figures.push({ name: 'манекен ' + (b.title || b.key), x: cx, z: cz, face: look });
      R.combatFigure(av, cx, 0.12, cz, b.key);   // «Драки с котиками»: it can be knocked off its stand (src/combat/room.ts)
    } catch (e) { console.warn('[l3d rooms] mannequin', b.key, e); }
    const hit = hitBox(cx, 1.2, cz, 1.2, 2.4, 1.2, 'room:hit:booth:' + b.key);
    R.interact({
      id: 'room:booth:' + b.key, label: `Примерить: ${b.title || b.key}`, icon: b.icon || '🪞', hit, reach: 4.5, proximity: false,
      use: () => {
        const card = R.ensureCard();
        if (!cur) return;
        card.openSample(b, cur, (s) => { cur = s; if (av) { av.setAppearance(appFor(s)); const m = mannequins.find((q) => q.av === av); av.setLod(m ? m.lod : 0); av.play('cheer'); } });
      },
    });
  });
  // full detail (LOD0: face, outline, accessories) for the mannequins near you, LOD1 for the far side (hysteresis)
  R.onUpdate((dt, t) => {
    const p = R.env.player();
    for (const m of mannequins) {
      const d2 = (p.x - m.x) * (p.x - m.x) + (p.z - m.z) * (p.z - m.z);
      const want: 0 | 1 = d2 < (m.lod === 0 ? LOD_FAR * LOD_FAR : LOD_NEAR * LOD_NEAR) ? 0 : 1;
      if (want !== m.lod) { m.lod = want; m.av.setLod(want); }
      m.av.root.rotation.y = m.base + Math.sin(t * 0.5 + m.ph) * 0.3; m.av.update(dt, t, 0);
    }
  });
  R.onDispose(() => { for (const m of mannequins) m.av.dispose(); });
  // poufs and floor candles around the table, a clothes rail and hat boxes, plants by the door
  for (const [a, c] of (ch ? [[1.9, GOLDC], [2.75, '#2a0a14'], [-2.75, '#c8102e'], [-1.9, '#2a0a14']] : [[1.9, GOLDC], [2.75, '#7fd6e6'], [-2.75, '#ff8fa3'], [-1.9, '#b9a2ff']]) as [number, string][]) stool(K, Math.sin(a) * 2.3, Math.cos(a) * 2.3, c, 0.36, 0.26, false);
  for (let i = 0; i < 6; i++) { const a = i * 1.047 + 0.5; candle(K, Math.sin(a) * 1.25, 0, Math.cos(a) * 1.25, 0.22 + (i % 2) * 0.1, i % 2 === 0); }
  const rx = 2.25, rz = 2.8;
  K.cyl(GM, GOLDC, rx - 0.6, 0, rz, 0.03, 1.7, 8); K.cyl(GM, GOLDC, rx + 0.6, 0, rz, 0.03, 1.7, 8);
  K.box('metal', GOLDC, rx - 0.62, rx + 0.62, 1.66, 1.7, rz - 0.02, rz + 0.02);
  (ch ? ['#c8102e', '#2a1a22', GOLDC, '#7a1a2a', '#3a3346', '#ff9a2a'] : ['#a3122a', '#3a6aa8', GOLDC, '#5a9a4a', '#ff8fa3', '#b9a2ff']).forEach((c, i) => { const x = rx - 0.45 + i * 0.18; K.box('canvas', c, x - 0.07, x + 0.07, 0.9, 1.62, rz - 0.18, rz + 0.18); K.box('metal', '#3a3040', x - 0.005, x + 0.005, 1.62, 1.68, rz - 0.005, rz + 0.005); });
  K.solid(rx - 0.65, rx + 0.65, rz - 0.25, rz + 0.25, Infinity, false);
  for (let i = 0; i < 3; i++) { const hx = -3.05 + (i % 2) * 0.12, hz = 2.0 + (i % 2) * 0.1; K.cyl('canvas', (ch ? ['#2a0a14', '#c8102e', '#2a0a14'] : ['#ff8fa3', '#7fd6e6', GOLDC])[i], hx, i * 0.3, hz, 0.24 - i * 0.04, 0.3, 16); K.cyl('canvas', ch ? GOLDC : '#fff3dc', hx, i * 0.3 + 0.27, hz, 0.25 - i * 0.04, 0.04, 16); }
  K.solid(-3.35, -2.75, 1.7, 2.35, 0.9);
  potPlant(K, -1.1, 0, RAD - 0.55, 1.1, ch ? '#ff5a1a' : '#ff8fa3'); potPlant(K, 1.1, 0, RAD - 0.55, 1.1, GOLDC);
  K.solid(-1.3, -0.9, RAD - 0.75, RAD - 0.35, 0.6); K.solid(0.9, 1.3, RAD - 0.75, RAD - 0.35, 0.6);
  // hat stands and gift boxes on the floor ring
  for (const [a, c] of (ch ? [[Math.PI, '#c8102e'], [Math.PI + 0.9, '#2a1a22'], [Math.PI - 0.9, '#7a3ab3']] : [[Math.PI, '#a3122a'], [Math.PI + 0.9, '#3a6aa8'], [Math.PI - 0.9, '#5a2a4a']]) as [number, string][]) {
    const x = Math.sin(a) * 3.4, z = Math.cos(a) * 3.4;
    K.cyl(GM, GOLDC, x, 0, z, 0.2, 0.04, 12); K.cyl(GM, GOLDC, x, 0, z, 0.03, 1.6, 8);
    K.cyl('canvas', c, x, 1.6, z, 0.16, 0.05, 12); K.cyl('canvas', c, x, 1.64, z, 0.1, 0.18, 12); K.cyl('canvas', GOLDC, x, 1.66, z, 0.105, 0.04, 12);
    for (const [dx, dz, hc] of (ch ? [[0.16, 0, '#2a0a14'], [-0.16, 0, '#c8102e']] : [[0.16, 0, '#ff8fa3'], [-0.16, 0, '#7fd6e6']]) as [number, number, string][]) { K.box(GM, GOLDC, x, x + dx, 1.25, 1.27, z - 0.01, z + 0.01); K.cone('canvas', hc, x + dx, 1.08, z + dz, 0.09, 0.2); }
    K.solid(x - 0.22, x + 0.22, z - 0.22, z + 0.22, Infinity, false);
  }
  { const x = -3.3, z = 0.9, gb = ch ? ['#2a0a14', '#c8102e', GOLDC] : ['#ff8fa3', '#7fd6e6', '#fff3dc']; K.box('canvas', gb[0], x - 0.25, x + 0.25, 0, 0.4, z - 0.25, z + 0.25); K.box('canvas', GOLDC, x - 0.04, x + 0.04, 0, 0.41, z - 0.26, z + 0.26); K.box('canvas', gb[1], x - 0.15, x + 0.15, 0.4, 0.64, z - 0.15, z + 0.15); K.box('canvas', gb[2], x - 0.03, x + 0.03, 0.4, 0.65, z - 0.16, z + 0.16); K.ball('canvas', GOLDC, x, 0.68, z, 0.06); K.solid(x - 0.27, x + 0.27, z - 0.27, z + 0.27, 0.7); }
  void painting;
  // mirror by the door + keeper
  const mx = -2.2, mz = 3.6;
  K.rbox(GM, GOLDC, mx, 1.2, mz, 0.9, 2.0, 0.1, 2.5); K.rbox('glass', '#cfe7ff', mx + 0.02, 1.2, mz + 0.02, 0.75, 1.8, 0.02, 2.5);
  K.solid(mx - 0.4, mx + 0.4, mz - 0.4, mz + 0.4, Infinity, false);
  if (Th.keeper) R.npc({ seed: 'франт', name: Th.keeper.name, x: 1.7, z: 1.6, face: faceTo(1.7, 1.6, 0, 1.6), look: Th.keeper.look, hello: Th.keeper.hello, lines: Th.keeper.lines, emote: { anim: 'cheer', every: 12 } });
  else R.npc({ seed: 'франт', name: 'Франт', x: 1.7, z: 1.6, face: faceTo(1.7, 1.6, 0, 1.6),   // across the aisle: towards both the door and the tent centre
    look: { hat: 'tophat', acc: ['monocle', 'bowtie'], shape: 'tall', color: '#ffe27a' },
    hello: ['Добро пожаловать в Будуар! Примерочные свободны.', 'О, какие усы! Проходите, подберём что-нибудь эдакое.', 'Выбирай кабинку — примерим прямо на манекене!'],
    lines: ['Румянец — к лицу всем.', 'Аура — это навсегда. Почти.', 'Шляпа делает кота.'], emote: { anim: 'cheer', every: 12 } });
  K.lantern(-2.4, 2.4, 1.5, WALL + 0.8, Th.lamps[0], true);
  K.lantern(2.4, 2.4, -1.8, WALL + 1.0, Th.lamps[1], true);
  if (ch) K.sign(Th.title!, 0, WALL + 0.35, -RAD + 0.25, 2.6, 0, { bg: Th.sign.bg, fg: Th.sign.fg, rim: GOLDC });
  // door at +Z
  R.exitDoor(0, 1.8, 2.3, { style: 'curtain', z: RAD - 0.1 });
  R.spawn = { x: 0, z: RAD - 1.0, face: 0 };
}
