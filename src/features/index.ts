/**
 * The feature list. A feature is one file exporting a Feature ({ id, order, setup(ctx) }); add a mechanic by adding
 * a file and ONE line here. Lower `order` runs first, and per-frame hooks (ctx.onFrame) run in the same order.
 * Content modules (rooms, item models, menus…) register their registry entries from a feature too.
 */
import type { Feature } from '../contracts/ext';
import type { Unsub } from '../contracts';
import type { CoreContext } from '../core/context';
import type { CoreFeature } from './types';
import settings from './settings';
import menus from './menus';
import camera from './camera';
import crowd from './crowd';
import labels from './labels';
import doors from './doors';
import controls from './controls';
import rooms from './rooms';
import contentRooms from './content-rooms';
import overlay from './overlay';
import classic from './classic';
import quest from './quest';
import debug from './debug';
import itemModels from './item-models';
import sound from './sound';
import photo from './photo';
import whatsnew from './whatsnew';
import seasonal from './seasonal';
import combat from './combat';
import expedition from './expedition';
import stars from './stars';
import boats from './boats';
import landmarks from './landmarks';
import pawprints from './pawprints';
import showcase from './showcase';
import snapshot from './snapshot';
import netstatus from './netstatus';
import qualityInfo from './quality-info';
import mood from './mood';
import bench from './bench';
import cheer from './cheer';
import cheersFx from './cheers-fx';
import flight from './flight';
import emotes from './emotes';
import boom from './boom';
import closeguard from './closeguard';
import update from './update';

export const FEATURES: (Feature | CoreFeature)[] = [
  settings, itemModels, menus, camera, crowd, labels, doors, controls, rooms, contentRooms, overlay, classic, quest, photo, debug, whatsnew, seasonal, sound,
  combat,
  expedition,
  showcase,
  snapshot,
  netstatus,
  qualityInfo,
  mood, bench, cheer, cheersFx,
  stars, boats, landmarks, pawprints,
  flight, emotes, boom,
  closeguard,
  update,
];

/** Run every feature's setup in order. A failing feature is logged and skipped (the game still starts). */
export async function runFeatures(ctx: CoreContext, list: (Feature | CoreFeature)[] = FEATURES): Promise<Unsub> {
  const offs: Unsub[] = [];
  const sorted = list.map((f, i) => ({ f, i })).sort((a, b) => (a.f.order ?? 100) - (b.f.order ?? 100) || a.i - b.i);
  for (const { f } of sorted) {
    try {
      const r = await (f as CoreFeature).setup(ctx);
      if (typeof r === 'function') offs.push(r);
    } catch (e) {
      console.error(`[l3d] feature "${f.id}" failed`, e);
    }
  }
  return () => { for (const u of offs.reverse()) { try { u(); } catch { /* */ } } };
}
