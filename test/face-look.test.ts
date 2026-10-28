import { describe, it, expect, vi } from 'vitest';
import { appearanceFrom, CATALOG } from '../src/avatar/appearance';
import { getModel, releaseModel, faceKeyOf, modelKey } from '../src/avatar/model';
import { nearFace, FACE_EYES, FACE_MOUTHS, EYES_NEAR } from '../src/avatar/face';

// owner report 28.10: «в магазах (а мб и у персов) не меняются глаза и рот» — models are cached by geometry, so the
// face must come from each avatar's own look, not from the first look the shared model was built with
describe('eyes / mouth reach the face', () => {
  const app = (lk: Record<string, unknown>, st = 'cats') => appearanceFrom('mannequin-eyes', { lk: { shape: 'bean', color: '#ffb27a', ...lk } }, st);

  it('a different eyes / mouth / blush gives a different face key on the same shared model', () => {
    for (const st of ['cats', 'legion', 'cherts']) {
      const a = app({ eyes: 'dots', mouth: 'open', blush: false }, st), b = app({ eyes: 'stars', mouth: 'open', blush: false }, st), c = app({ eyes: 'stars', mouth: 'tongue', blush: false }, st), d = app({ eyes: 'stars', mouth: 'tongue', blush: true }, st);
      const ma = getModel(a), mc = getModel(c);
      expect(modelKey(c)).toBe(modelKey(d));        // mouth / blush are no geometry: one shared model
      const keys = [faceKeyOf(a, ma.dims), faceKeyOf(b, ma.dims), faceKeyOf(c, mc.dims), faceKeyOf(d, mc.dims)];
      expect(new Set(keys).size).toBe(4);
      expect(faceKeyOf(c, mc.dims).split('|').slice(0, 2)).toEqual(['stars', 'tongue']);
      releaseModel(ma); releaseModel(mc);
    }
  });
  it('eyes are part of the model key (glasses frames and the low mesh follow the eyes)', () => {
    expect(modelKey(app({ eyes: 'cyclops' }))).not.toBe(modelKey(app({ eyes: 'dots' })));
  });
  it('every catalog eye / mouth is drawn as itself; unknown ids map to the nearest, never silently to the default', () => {
    for (const e of CATALOG.eyes) expect(FACE_EYES.has(e)).toBe(true);
    for (const m of CATALOG.mouths) expect(FACE_MOUTHS.has(m)).toBe(true);
    for (const e of ['jack', 'void', 'sleepy', 'wide', 'slit']) expect(FACE_EYES.has(e)).toBe(true);
    const f = { eyes: 'heart', mouth: 'smirk', blush: false, iris: 0, style: 'cats', narrow: false, ghost: false };
    expect(nearFace(f)).toMatchObject({ eyes: 'love', mouth: 'grin' });
    for (const [id, near] of Object.entries(EYES_NEAR)) { expect(FACE_EYES.has(near)).toBe(true); expect(FACE_EYES.has(id)).toBe(false); }
    expect(nearFace({ ...f, eyes: 'sly', style: 'cherts' }).eyes).toBe('sly');   // the imps draw it themselves
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(nearFace({ ...f, eyes: 'zzz-new' }).eyes).toBe('dots');
    expect(warn).toHaveBeenCalled(); warn.mockRestore();
  });
});
