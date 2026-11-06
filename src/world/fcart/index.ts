/**
 * Every asset-faithful model of the new fair / Town Kit towns (registry.ts): importing this module registers them all.
 * src/world/faircats.ts asks fcModel(ref) at build time and falls back to its own generic models when none is there.
 */
import './civic';
import './shops';
import './houses';

export { fcModel, fcModels, registerFcModel, type FcModel, type FcPlace } from './registry';
