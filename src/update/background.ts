/** Service worker (Chrome) / event page (Firefox). Bootstrap only: the logic lives in worker.ts. */
import { createUpdateWorker } from './worker';
import { STATE_KEY, type UpdateState } from './core';

const worker = createUpdateWorker({
  manifest: () => chrome.runtime.getManifest() as { version: string; update_url?: unknown },
  load: async () => ((await chrome.storage.local.get(STATE_KEY))[STATE_KEY] as UpdateState | undefined) ?? {},
  save: async (s) => { await chrome.storage.local.set({ [STATE_KEY]: s }); },
  fetch: (...a) => fetch(...a),
  now: () => Date.now(),
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id) return false;
  return worker.onMessage(msg, sendResponse);
});
chrome.runtime.onStartup.addListener(() => { void worker.startup(); });
