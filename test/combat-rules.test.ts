import { describe, it, expect } from 'vitest';
import { attackKind, isHoly, Cooldowns, SPECS, gate, type GateInput } from '../src/combat/rules';
import { segCapsule, inCone } from '../src/combat/sweep';
import { TP_TRACKS, TP_CONTACT, TP_VALUES, FAMILY_TRACK, sampleTrack, trackLen, easeK } from '../src/avatar/attacks';

const OK: GateInput = { enabled: true, locked: true, gameplay: true, menu: false, modals: 0, photo: false, typing: false, stage: false, busy: false, room: null, aimed: false };

describe('attack kinds', () => {
  it('maps weapons and roles', () => {
    expect(attackKind('sword')).toBe('slash');
    expect(attackKind('dagger')).toBe('slash');
    expect(attackKind('hammer')).toBe('smash');
    expect(attackKind('holymace', 'paladin')).toBe('smash');
    expect(attackKind('spear')).toBe('thrust');
    expect(attackKind('pitchfork')).toBe('thrust');
    expect(attackKind('bow')).toBe('bow');
    expect(attackKind(undefined)).toBe('slap');
    expect(attackKind('censer')).toBe('holy');
    expect(attackKind('skullstaff')).toBe('summon');
    expect(attackKind('grimoire')).toBe('summon');
    expect(attackKind('staff')).toBe('orb');
    expect(attackKind('staff', 'necromancer')).toBe('summon');
    expect(attackKind('grimoire', 'mage')).toBe('orb');
    expect(attackKind('crook', 'priest')).toBe('holy');
    expect(attackKind('totally-new-weapon')).toBe('slash');   // unknown looks swing like a blade
    expect(isHoly('holymace')).toBe(true);
    expect(isHoly('sword', 'legionary')).toBe(false);
  });
  it('strikes land inside the swing animation and cooldowns cover the view-model swing', () => {
    // the FP view-model swing cooldown is 0.75 × its track length (same lengths as the TP tracks)
    for (const k of ['slash', 'smash', 'thrust', 'slap'] as const) {
      const name = FAMILY_TRACK[k === 'slash' ? 'blade' : k === 'smash' ? 'heavy' : k === 'thrust' ? 'spear' : 'none'];
      const track = TP_TRACKS[name];
      expect(SPECS[k].cooldown).toBeGreaterThanOrEqual(trackLen(track) * 0.75 - 1e-9);
      // the hit lands on the contact key of the animation
      expect(Math.abs(SPECS[k].strikeAt - TP_CONTACT[name])).toBeLessThan(0.011);
      // anticipation: a held wind-up of 80–120 ms right before the strike (the contact key's predecessor chain)
      const ci = track.findIndex((key) => Math.abs(key[0] - TP_CONTACT[name]) < 1e-6);
      expect(ci).toBeGreaterThan(2);
      // walk back over the fast strike segments (ease in / linear) to the end of the hold
      let h = ci; while (h > 0 && (track[h][13] === 1 || track[h][13] === 3)) h--;
      const holdEnd = track[h], windEnd = track[h - 1];
      expect(holdEnd[0] - windEnd[0]).toBeGreaterThanOrEqual(0.08 - 1e-9);
      expect(holdEnd[0] - windEnd[0]).toBeLessThanOrEqual(0.12 + 1e-9);
      // the swing trail covers the strike
      expect(SPECS[k].trail[0]).toBeLessThan(SPECS[k].strikeAt);
      expect(SPECS[k].trail[1]).toBeGreaterThan(SPECS[k].strikeAt);
    }
  });
});

describe('cooldowns', () => {
  it('blocks spam and frees after the cooldown', () => {
    const c = new Cooldowns();
    expect(c.use('slash', 0)).toBe(true);
    expect(c.use('slash', 0.1)).toBe(false);
    expect(c.ready('slash', SPECS.slash.cooldown - 0.01)).toBe(false);
    expect(c.use('slash', SPECS.slash.cooldown)).toBe(true);
    expect(c.use('summon', 1)).toBe(true);
    expect(c.left('summon', 2)).toBeCloseTo(SPECS.summon.cooldown - 1);
    // kinds are independent
    expect(c.use('bow', 1)).toBe(true);
    c.reset();
    expect(c.ready('summon', 1)).toBe(true);
  });
  it('10 clicks per second give at most ~2 slashes per second', () => {
    const c = new Cooldowns();
    let n = 0;
    for (let t = 0; t < 5; t += 0.1) if (c.use('slash', t)) n++;
    expect(n).toBeLessThanOrEqual(Math.ceil(5 / SPECS.slash.cooldown));
  });
});

describe('input gate', () => {
  it('allows the plain street and the mine', () => {
    expect(gate(OK)).toBeNull();
    expect(gate({ ...OK, room: 'mine3d' })).toBeNull();
  });
  it('refuses everything else, interactables first-class', () => {
    expect(gate({ ...OK, enabled: false })).toBe('off');
    expect(gate({ ...OK, aimed: true })).toBeNull();   // clicks never interact: LMB swings even on doors / goods / stones
    expect(gate({ ...OK, room: 'shop3d' })).toBeNull();   // 3D shops fight too (goods under the crosshair keep LMB)
    expect(gate({ ...OK, room: 'hybrid' })).toBe('room');
    expect(gate({ ...OK, stage: true })).toBe('scene');
    expect(gate({ ...OK, busy: true })).toBe('loading');
    expect(gate({ ...OK, photo: true })).toBe('photo');
    expect(gate({ ...OK, menu: true })).toBe('menu');
    expect(gate({ ...OK, modals: 1 })).toBe('menu');
    expect(gate({ ...OK, typing: true })).toBe('typing');
    expect(gate({ ...OK, locked: false })).toBe('unlocked');
    expect(gate({ ...OK, gameplay: false })).toBe('paused');
  });
});

describe('sweeps', () => {
  it('segment vs capsule', () => {
    // straight through a 1.2 m tall cat at the origin
    expect(segCapsule(-1, 0.6, 0, 1, 0.6, 0, 0, 0, 0, 0.3, 1.2)).toBeCloseTo(0.35, 1);
    expect(segCapsule(-1, 2, 0, 1, 2, 0, 0, 0, 0, 0.3, 1.2)).toBe(-1);       // over the head
    expect(segCapsule(-1, 0.6, 1, 1, 0.6, 1, 0, 0, 0, 0.3, 1.2)).toBe(-1);   // beside it
    expect(segCapsule(0, 0.6, 0, 1, 0.6, 0, 0, 0, 0, 0.3, 1.2)).toBe(0);     // starts inside
  });
  it('melee cone', () => {
    // yaw 0 looks to −Z
    expect(inCone(0, 0, 0, 0, -1.5, 0.3, 1.8, 0.9)).toBeCloseTo(1.5);
    expect(inCone(0, 0, 0, 0, 1.5, 0.3, 1.8, 0.9)).toBe(-1);                // behind
    expect(inCone(0, 0, 0, 0, -2.5, 0.3, 1.8, 0.9)).toBe(-1);               // too far
    expect(inCone(0, 0, Math.PI / 2, -1.5, 0, 0.3, 1.8, 0.9)).toBeCloseTo(1.5);   // yaw π/2 looks to −X
  });
});

describe('TP attack tracks', () => {
  it('start and end exactly at the base pose (no pop)', () => {
    const base = [0.25, 0, 0.22, -0.1, 0, -0.22, 0, 0, 0, 0, 0, 0], out = new Array(TP_VALUES).fill(0);
    for (const k in TP_TRACKS) {
      const tr = TP_TRACKS[k];
      sampleTrack(tr, 0, base, out);
      for (let i = 0; i < TP_VALUES; i++) expect(out[i]).toBeCloseTo(base[i]);
      expect(sampleTrack(tr, trackLen(tr) - 1e-4, base, out)).toBe(true);
      for (let i = 0; i < TP_VALUES; i++) expect(out[i]).toBeCloseTo(base[i], 2);
      expect(sampleTrack(tr, trackLen(tr) + 0.01, base, out)).toBe(false);
    }
  });
});

describe('easing', () => {
  it('every ease starts at 0 and ends at 1; strike (in) is slow then fast, wind-up (out) the opposite', () => {
    for (const e of [0, 1, 2, 3, 4]) { expect(easeK(e, 0)).toBeCloseTo(0); expect(easeK(e, 1)).toBeCloseTo(1); }
    expect(easeK(1, 0.5)).toBeLessThan(0.2);
    expect(easeK(2, 0.5)).toBeGreaterThan(0.8);
    expect(Math.max(...[0.6, 0.7, 0.8, 0.9].map((x) => easeK(4, x)))).toBeGreaterThan(1);   // back-out overshoots
  });
});
