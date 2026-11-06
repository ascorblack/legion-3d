/**
 * The user-clock day / night cycle (src/world/daynight.ts, wired in src/world/index.ts, the expedition terrain and
 * src/features/daynight.ts): sun geometry, continuous phases, overrides, the night = the old look, the q0 path, and no
 * allocations in the per-frame update.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import * as THREE from 'three';
import { stubDom } from './dom-stub';
import {
  DN, DN_U, OLD_MOON, sunVector, stateAtMinutes, stateOfPreset, derive, tickDayNight, resetDayNight, setTodMode, setTodForce, holdNight,
  todSource, parseTod, parseTodMode, solarMinutes, skyStops, type DnState,
} from '../src/world/daynight';
import { todFromSearch } from '../src/features/daynight';
import { FC_MOOD } from '../src/world/faircats';

const mkState = (): DnState => ({ sun: new THREE.Vector3(), moon: new THREE.Vector3(), key: new THREE.Vector3(), sunAlt: 0, night: 0, tw: 0, day: 0, am: 0,
  lit: 0, stars: 0, moonVis: 0, sunVis: 0, flies: 0, sunK: 0, moonK: 0, source: '', minutes: 0, version: 0 });
const NOV6 = 309, JUN21 = 171, MAR20 = 78;

describe('sun geometry (50°N, local solar time)', () => {
  const v = new THREE.Vector3();
  it('noon is high in the south (−z), midnight below the horizon', () => {
    for (const doy of [NOV6, JUN21, MAR20]) {
      const a = sunVector(12 * 60, doy, v);
      expect(v.z, `doy ${doy}`).toBeLessThan(-0.3);           // south = −z
      expect(Math.abs(v.x), `doy ${doy}`).toBeLessThan(1e-6);   // on the meridian
      expect(a).toBeGreaterThan(15);
      expect(sunVector(0, doy, v)).toBeLessThan(-10);
    }
    expect(sunVector(12 * 60, JUN21, v)).toBeCloseTo(63.4, 0);  // 90 − 50 + 23.4
    expect(sunVector(12 * 60, 355, v)).toBeCloseTo(16.6, 0);    // 90 − 50 − 23.4
  });
  it('sunrise in the east (−x), sunset in the west (+x); a summer day is longer than a winter one', () => {
    const a6 = sunVector(6 * 60, MAR20, v);
    expect(Math.abs(a6)).toBeLessThan(2);
    expect(v.x).toBeLessThan(-0.95);
    sunVector(18 * 60, MAR20, v);
    expect(v.x).toBeGreaterThan(0.95);
    const dayLen = (doy: number) => { let n = 0; for (let m = 0; m < 1440; m += 5) if (sunVector(m, doy, v) > 0) n += 5; return n / 60; };
    expect(dayLen(JUN21)).toBeGreaterThan(15.5);
    expect(dayLen(355)).toBeLessThan(8.5);
  });
  it('the moon is the antisolar point; solar minutes drop the daylight-saving shift', () => {
    const s = stateAtMinutes(23 * 60, NOV6, mkState());
    expect(s.moon.clone().add(s.sun).length()).toBeLessThan(1e-9);
    expect(s.moon.y).toBeGreaterThan(0.5);
    const d = new Date(2026, 10, 6, 14, 30);
    expect(solarMinutes(d)).toBeCloseTo(14 * 60 + 30 - (Math.max(new Date(2026, 0, 1).getTimezoneOffset(), new Date(2026, 6, 1).getTimezoneOffset()) - d.getTimezoneOffset()), 6);
  });
});

describe('phases', () => {
  it('weights sum to 1 and change continuously through a whole day (summer and winter)', () => {
    for (const doy of [NOV6, JUN21]) {
      const a = mkState(), b = mkState();
      stateAtMinutes(0, doy, a);
      let maxStep = 0, sawDay = false, sawTw = false;
      for (let m = 1; m <= 1440 * 4; m++) {
        stateAtMinutes(m / 4, doy, b);
        expect(b.night + b.tw + b.day).toBeCloseTo(1, 9);
        for (const k of ['night', 'tw', 'day', 'lit', 'stars', 'moonVis', 'sunVis', 'flies', 'sunK', 'moonK'] as const) maxStep = Math.max(maxStep, Math.abs(b[k] - a[k]));
        maxStep = Math.max(maxStep, b.key.distanceTo(a.key) * (b.sunK + b.moonK > 0.05 ? 1 : 0));   // the key may swap only while it is dark
        sawDay ||= b.day > 0.99; sawTw ||= b.tw > 0.95;
        stateAtMinutes(m / 4, doy, a);
      }
      expect(maxStep, `doy ${doy}`).toBeLessThan(0.03);   // per 15 s of clock
      expect(sawDay && sawTw).toBe(true);
    }
  });
  it('lamps are on at dusk and night, off by day; dawn and dusk are told apart', () => {
    const s = mkState();
    expect(stateAtMinutes(12 * 60, NOV6, s).lit).toBe(0);
    expect(stateAtMinutes(23 * 60, NOV6, s).lit).toBe(1);
    expect(stateAtMinutes(23 * 60, NOV6, s).stars).toBe(1);
    stateAtMinutes(16 * 60 + 30, NOV6, s); expect(s.tw).toBeGreaterThan(0.5); expect(s.lit).toBeGreaterThan(0.5); expect(s.am).toBe(0);
    stateAtMinutes(7 * 60 + 25, NOV6, s); expect(s.tw).toBeGreaterThan(0.5); expect(s.am).toBe(1);
  });
  it('the key light keeps a sane elevation (low sun ≥ 12°, moon ≥ 28°)', () => {
    const s = mkState();
    s.sun.set(1, Math.sin(2 * Math.PI / 180), 0).normalize(); derive(s, 0);
    expect(Math.asin(s.key.y) * 180 / Math.PI).toBeCloseTo(12, 3);
    s.sun.set(0.3, -0.2, 0.9).normalize(); derive(s, 0);   // moon 11.5° up
    expect(Math.asin(s.key.y) * 180 / Math.PI).toBeCloseTo(28, 3);
  });
});

describe('overrides', () => {
  beforeEach(() => resetDayNight());
  afterEach(() => resetDayNight());
  it('setting modes, a forced time, a held night — strongest first', () => {
    setTodMode('day'); expect(DN.day).toBe(1); expect(DN.lit).toBe(0); expect(todSource()).toBe('day');
    setTodMode('sunset'); expect(DN.tw).toBeGreaterThan(0.9); expect(DN.sun.x).toBeGreaterThan(0.5);
    setTodMode('night'); expect(DN.night).toBe(1); expect(DN.moon.distanceTo(OLD_MOON)).toBeLessThan(1e-9);
    setTodForce(12 * 60); expect(todSource()).toBe('force'); expect(DN.day).toBeGreaterThan(0.5);
    const rel = holdNight('halloween'); expect(todSource()).toBe('hold'); expect(DN.night).toBe(1); expect(DN_U.lit.value).toBe(1);
    rel(); expect(todSource()).toBe('force'); expect(DN_U.lit.value).toBe(0);
    setTodForce(null); expect(todSource()).toBe('night');
  });
  it('version bumps only on a visible change; the tick is throttled', () => {
    setTodMode('day'); const v = DN.version;
    expect(tickDayNight(Date.now() + 10_000)).toBe(false);
    expect(DN.version).toBe(v);
    setTodMode('night'); expect(DN.version).toBe(v + 1);
  });
  it('parses ?tod= and the setting', () => {
    expect(parseTod('06:30')).toBe(390); expect(parseTod('23')).toBe(1380); expect(parseTod('25:00')).toBeNull(); expect(parseTod('x')).toBeNull();
    expect(parseTodMode('sunset')).toBe('sunset'); expect(parseTodMode('???')).toBe('clock');
    expect(todFromSearch('?fc=1&tod=18:30')).toEqual({ minutes: 1110, mode: null });
    expect(todFromSearch('?tod=night')).toEqual({ minutes: null, mode: 'night' });
    expect(todFromSearch('?fc=1')).toEqual({ minutes: null, mode: null });
  });
});

describe('the city', () => {
  beforeAll(() => stubDom());
  beforeEach(() => resetDayNight());
  afterEach(() => resetDayNight());

  const look = (w: { root: THREE.Object3D }) => {
    const sky = w.root.getObjectByName('sky:dome') as THREE.Mesh, U = (sky.material as THREE.ShaderMaterial).uniforms;
    let hemi!: THREE.HemisphereLight, sun!: THREE.DirectionalLight, amb!: THREE.AmbientLight;
    w.root.traverse((o: any) => { if (o.isHemisphereLight) hemi = o; if (o.isDirectionalLight) sun = o; if (o.isAmbientLight) amb = o; });
    return { U, hemi, sun, amb, snap: () => [0, 1, 2, 3].map((i) => (U['c' + i].value as THREE.Color).getHex()).concat((U.hz.value as THREE.Color).getHex(), hemi.color.getHex(), hemi.groundColor.getHex(), sun.color.getHex(), amb.color.getHex(),
      Math.round(hemi.intensity * 1e4), Math.round(sun.intensity * 1e4), Math.round(amb.intensity * 1e4)) };
  };

  it('night is the old look (build values), day the site mood; back to night restores it exactly', async () => {
    const { fixtureLayout } = await import('../dev/fixtures');
    const { buildCity } = await import('../src/world');
    setTodMode('night');
    const L = fixtureLayout();
    const w = await buildCity(L, { quality: 2 } as never);
    const k = look(w);
    const old = skyStops(L.sky);
    expect((k.U.c0.value as THREE.Color).getHex()).toBe(old.c[0].getHex());
    expect((k.U.hz.value as THREE.Color).getHex()).toBe(old.hz.getHex());
    expect(k.hemi.color.getHexString()).toBe('8f9cff'); expect(k.hemi.intensity).toBeCloseTo(1.15, 6);
    expect(k.sun.color.getHexString()).toBe('bcc8ff'); expect(k.sun.intensity).toBeCloseTo(1.7, 6);
    const night = k.snap();
    setTodMode('day');
    expect(k.snap()).not.toEqual(night);
    expect(k.hemi.intensity).toBeGreaterThan(2);
    expect(DN_U.lit.value).toBe(0);
    setTodMode('sunset'); setTodMode('night');
    expect(k.snap()).toEqual(night);
    w.dispose();
  });

  it('the cats fair at day = the tuned fixed daytime mood (faircats.ts FC_MOOD); stars and moon fade by phase', async () => {
    const { fairCatsFixtureLayout } = await import('../dev/fixtures');
    const { buildCity } = await import('../src/world');
    setTodMode('day');
    const w = await buildCity(fairCatsFixtureLayout({}), { quality: 2 } as never);
    const k = look(w);
    const want = skyStops(FC_MOOD.sky);
    expect((k.U.c0.value as THREE.Color).getHex()).toBe(want.c[0].getHex());
    expect((k.U.c3.value as THREE.Color).getHex()).toBe(want.c[3].getHex());
    expect(k.hemi.color.getHexString()).toBe(FC_MOOD.hemi[0].slice(1)); expect(k.hemi.intensity).toBeCloseTo(FC_MOOD.hemiI, 6);
    expect(k.amb.intensity).toBeCloseTo(FC_MOOD.ambI, 6); expect(k.sun.intensity).toBeCloseTo(FC_MOOD.sunI, 6);
    const moon = w.root.children.find((o) => (o as THREE.Sprite).isSprite && o.renderOrder === -8) as THREE.Sprite;
    expect(moon.visible).toBe(false); expect(DN_U.stars.value).toBe(0);
    setTodMode('night');
    expect(moon.visible).toBe(true); expect((moon.material as THREE.SpriteMaterial).opacity).toBe(1); expect(DN_U.stars.value).toBe(1);
    w.dispose();
  });

  it('q0 path: builds and updates by day and night (no shadows, no point lights, few stars)', async () => {
    const { campFixtureLayout } = await import('../dev/fixtures');
    const { buildCity } = await import('../src/world');
    setTodForce(12 * 60);
    const w = await buildCity(campFixtureLayout('cats', false), { quality: 0 } as never);
    const cam = new THREE.PerspectiveCamera(70, 16 / 9, 0.1, 500); cam.position.set(10, 1.2, 5); cam.updateMatrixWorld();
    const scene = new THREE.Scene(); scene.add(w.root, cam);
    for (let i = 0; i < 5; i++) w.update(0.016, i * 0.016, cam);
    let sun!: THREE.DirectionalLight; const pl: THREE.PointLight[] = [];
    w.root.traverse((o: any) => { if (o.isDirectionalLight) sun = o; if (o.isPointLight) pl.push(o); });
    expect(sun.castShadow).toBe(false); expect(pl.every((l) => !l.visible)).toBe(true);
    expect(sun.position.clone().sub(cam.position).normalize().dot(DN.key)).toBeGreaterThan(0.9);   // the key follows the sun
    expect((w.root.getObjectByName('sky:stars') as THREE.Points).geometry.drawRange.count).toBe(350);
    expect(scene.fog).toBeTruthy();
    expect((scene.fog as THREE.Fog).color.getHex()).toBe(((w.root.getObjectByName('sky:dome') as THREE.Mesh).material as THREE.ShaderMaterial).uniforms.hz.value.getHex());
    setTodForce(23 * 60);
    for (let i = 0; i < 3; i++) w.update(0.016, 1 + i * 0.016, cam);
    expect(DN_U.lit.value).toBe(1);
    w.dispose();
  });

  it('per-frame update allocates nothing (no clone / new colour or vector), applies cheaply', async () => {
    const { fixtureLayout } = await import('../dev/fixtures');
    const { buildCity } = await import('../src/world');
    const w = await buildCity(fixtureLayout(), { quality: 2 } as never);
    const cam = new THREE.PerspectiveCamera(70, 16 / 9, 0.1, 500); cam.position.set(10, 1.2, 5); cam.updateMatrixWorld();
    const scene = new THREE.Scene(); scene.add(w.root, cam);
    w.update(0.016, 0, cam);
    const spies = [vi.spyOn(THREE.Color.prototype, 'clone'), vi.spyOn(THREE.Vector3.prototype, 'clone'), vi.spyOn(THREE.Color.prototype, 'setStyle'), vi.spyOn(THREE.Vector4.prototype, 'clone')];
    const calls = () => spies.reduce((n, s) => n + s.mock.calls.length, 0);
    // a moving clock: every frame a new forced minute → a full apply each frame (the worst case)
    const t0 = performance.now();
    for (let i = 0; i < 400; i++) { setTodForce(600 + i * 2); w.update(0.016, i * 0.016, cam); }
    const per = (performance.now() - t0) / 400;
    expect(calls()).toBe(0);
    // the steady state (no change): just the throttled check
    const t1 = performance.now();
    for (let i = 0; i < 2000; i++) tickDayNight();
    const steady = (performance.now() - t1) / 2000;
    for (const s of spies) s.mockRestore();
    console.log(`[daynight] world.update with a full day/night apply: ${per.toFixed(3)} ms/frame; steady tick ${(steady * 1000).toFixed(2)} µs`);
    expect(steady).toBeLessThan(0.02);
    w.dispose();
  });
});

describe('the expedition terrain', () => {
  beforeEach(() => resetDayNight());
  afterEach(() => resetDayNight());
  it('open daytime biomes follow the clock; fixed-mood biomes and the rest night do not', async () => {
    const { Terrain, clockNight } = await import('../src/expedition/terrain');
    const { ExpMats } = await import('../src/expedition/mats');
    const { disposeArt } = await import('../src/expedition/art');
    const mats = new ExpMats(), scene = new THREE.Scene();
    setTodForce(12 * 60);
    const m = new Terrain(mats, 'meadow', 'path', { seed: 3, quality: 2 });
    expect(m.clocked).toBe(true); expect(clockNight('meadow')).toBe(false);
    m.apply(scene); const sunDay = mats.sky.uniforms.uSun.value;
    setTodForce(16 * 60 + 30); m.update(1);
    expect(mats.sky.uniforms.uSun.value).toBeLessThan(sunDay);   // dims towards the dusk in place
    const fog = scene.fog;
    m.update(2); expect(scene.fog).toBe(fog);                    // no new fog object per update
    setTodForce(23 * 60);
    expect(clockNight('meadow')).toBe(true); expect(clockNight('graveyard')).toBe(false); expect(clockNight('cave')).toBe(false);
    const g = new Terrain(mats, 'graveyard', 'path', { seed: 3, quality: 2 });
    expect(g.clocked).toBe(false);
    m.dispose(); g.dispose(); mats.dispose(); disposeArt();
  });
});

describe('presets', () => {
  it('day sits where the fixed daytime mood was tuned; night puts the moon where it always was', () => {
    const s = mkState();
    stateOfPreset('day', s); expect(s.sun.distanceTo(OLD_MOON)).toBeLessThan(1e-9); expect(s.day).toBe(1);
    stateOfPreset('night', s); expect(s.moon.distanceTo(OLD_MOON)).toBeLessThan(1e-9); expect(s.key.distanceTo(OLD_MOON)).toBeLessThan(1e-9);
  });
});
