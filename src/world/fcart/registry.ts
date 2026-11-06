/**
 * Asset-faithful models of the new fair (fc-art.js, window.LGFairCatsArt) and Town Kit towns (tk-art.js).
 *
 * Every 3D model here is built FROM one site asset (an SVG the site draws for a building / house / prop) and is pinned
 * to that asset by a fingerprint: the hash of the normalised SVG the site's own draw() produces for it
 * (src/world/fcart/fingerprint.ts, scripts/fcart-fp.mjs writes src/data/fcart-fp.json).
 *   - at build time the world asks `fcModel(ref)`; when the live asset's fingerprint differs from the one the model was
 *     made for, the model is still used (better than nothing) but the mismatch is reported (l3d:drift / debug panel) and
 *     scripts/drift.mjs names the asset, so a new version of the model can be made;
 *   - `ref` is the site's prop ref from draw(): a building id ('hall', 'jail', …), 'house:<roof>' / 'house:tavern',
 *     or an item kind 'i:<kind>' (tree, blossom, pine, lamp, well, …).
 * Model files live next to this one (one file per asset group) and call registerFcModel at import;
 * src/world/fcart/index.ts imports them all.
 */
import type * as THREE from 'three';
import type { Ctx } from '../kit';

/** Where a model must stand: the site's own rects (px of the fair map) and the base height (m). */
export interface FcPlace {
  /** the asset's drawn box [x0, y0, x1, y1] (px) — width/height proportions of the model come from here */
  vis: readonly [number, number, number, number];
  /** walk footprint [x0, y0, x1, y1] (px); the model's front edge stands on foot[3] */
  foot: readonly [number, number, number, number];
  /** door point (px) for buildings, else the item point */
  door?: { x: number; y: number };
  /** ground height (m) at the base */
  base: number;
  /** extra site data (item fields, building level / build state, roof colour …) */
  data?: Record<string, unknown>;
}

export interface FcModel {
  /** site ref (see above) */
  ref: string;
  /** fingerprint of the site asset this model was made from (src/data/fcart-fp.json at the time) */
  fp: string;
  /** short human note on what the asset looks like, for the drift report */
  note?: string;
  /** builds the model into the batched world (k.b / k.inst); returns nothing — colliders stay the site's obstacles */
  build(k: Ctx, p: FcPlace): void;
}

const MODELS = new Map<string, FcModel>();
export function registerFcModel(m: FcModel): void { MODELS.set(m.ref, m); }
export function fcModel(ref: string): FcModel | undefined { return MODELS.get(ref); }
export function fcModels(): FcModel[] { return [...MODELS.values()]; }
export type { THREE };
