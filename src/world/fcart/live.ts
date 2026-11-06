/**
 * Runtime half of the asset fingerprints (fingerprint.ts): when the page has the site's town art
 * (window.LGFairCatsArt for the fair, window.LGTownKitArt + LGTownKitTowns[id] for a Town Kit town), the fingerprints
 * of the LIVE assets are computed once, idle, after the 3D town was built, and every model that was built from an
 * older picture (its registered fp ≠ the live one) is reported through the drift log (src/core/drift.ts →
 * console + 'l3d:drift' + the F3 panel): «модель <ref> сделана по старой картинке сайта». The model is still used.
 * Only refs a model was actually built for are compared; without any model built nothing is computed at all.
 */
import { artSamples, fingerprints, type ArtKit, type FpTable } from './fingerprint';
import { reportDrift } from '../../core/drift';

export const staleText = (ref: string): string => `модель ${ref} сделана по старой картинке сайта`;

/** Which town's art to fingerprint: the cats fair or a Town Kit town (its id; levels / builds as the 3D uses them). */
export type ArtTown = { kind: 'fc' } | { kind: 'tk'; id: string; levels?: Record<string, number>; building?: Record<string, unknown> };

/** Models built in the current town: ref → the fp they were made for. faircats.ts notes them as it builds. */
const used = new Map<string, string>();
export function noteFcModel(ref: string, fp: string): void { used.set(ref, fp); }
export function usedFcModels(): ReadonlyMap<string, string> { return used; }
export function clearFcModels(): void { used.clear(); }

const cache = new Map<string, FpTable | null>();
/** Live fingerprints of the page's art for a town (cached per town; null when the art is missing or throws). */
export function liveArtFingerprints(win: any, town: ArtTown): FpTable | null {
  const key = town.kind === 'fc' ? 'fc' : 'tk:' + town.id;
  if (cache.has(key)) return cache.get(key)!;
  let out: FpTable | null = null, tried = false;
  try {
    const kit: ArtKit | null = win?.LGTownKitArt ?? null;
    if (town.kind === 'fc') {
      const A = win?.LGFairCatsArt, F = win?.LGFairCats;
      if (A && typeof A.draw === 'function' && F) { tried = true; out = fingerprints(artSamples(A.draw({}), F, kit, {})); }
    } else {
      const T = win?.LGTownKitTowns?.[town.id], M = win?.LGTownKitMap, K = win?.LGTownKitArt;
      if (T && M && K && typeof K.drawTown === 'function' && typeof M.layoutOf === 'function') {
        tried = true;
        const o = { levels: town.levels, building: town.building, now: Date.now() };
        out = fingerprints(artSamples(K.drawTown(T, o), M.layoutOf(T), kit, o, 'tk:'));
      }
    }
  } catch { out = null; }
  if (tried) cache.set(key, out);   // art not on the page (yet): asked again next time
  return out;
}

/** Models whose asset changed: [{ ref, model fp, live fp }] (a ref the live art no longer draws counts as changed). */
export function staleModels(live: FpTable, models: ReadonlyMap<string, string>, prefix = ''): { ref: string; fp: string; live: string | null }[] {
  const out: { ref: string; fp: string; live: string | null }[] = [];
  for (const [ref, fp] of models) {
    const row = live[prefix + ref] ?? live[ref];
    if (!row || row.fp !== fp) out.push({ ref, fp, live: row?.fp ?? null });
  }
  return out;
}

/** Compare now and report (once per ref per page). Returns the stale refs. */
export function checkFcModels(win: any, town: ArtTown): string[] {
  if (!used.size) return [];
  const live = liveArtFingerprints(win, town);
  if (!live) return [];
  const st = staleModels(live, used, town.kind === 'tk' ? 'tk:' : '');
  for (const s of st) reportDrift('asset', staleText(s.ref), { ref: s.ref, model: s.fp, live: s.live, town: town.kind === 'fc' ? 'fairc' : town.id });
  return st.map((s) => s.ref);
}

/** After the town is built: check once, when the page is idle (draw() of the whole map takes ≈ 0.1–0.2 s). */
export function scheduleFcArtCheck(town: ArtTown): void {
  if (typeof window === 'undefined' || !used.size) return;
  const w = window as any, run = () => { try { checkFcModels(w, town); } catch { /* art changed shape: the contract check says so */ } };
  if (typeof w.requestIdleCallback === 'function') w.requestIdleCallback(run, { timeout: 8000 }); else setTimeout(run, 4000);
}

/** Tests only. */
export function _resetFcLive(): void { cache.clear(); used.clear(); }
