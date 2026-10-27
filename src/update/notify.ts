/**
 * Isolated-world content script (the game scripts run in MAIN, where chrome.* does not exist). It relays between
 * the page and the background worker: asks the worker for {current, store, latest, url} and posts that plain data
 * to the page. The page never receives anything executable.
 */
import { CHECK_KEY, QUERY_TYPE, sanitizeInfo, isAskMessage } from './core';

let pending = false;
function enabled(): boolean { try { return localStorage.getItem(CHECK_KEY) !== '0'; } catch { return true; } }
function ask(): void {
  if (pending) return;
  pending = true;
  try {
    chrome.runtime.sendMessage({ type: QUERY_TYPE, enabled: enabled() }, (reply: unknown) => {
      pending = false;
      if (chrome.runtime.lastError) return;
      const info = sanitizeInfo(reply);
      if (info) window.postMessage({ __l3d: 'update', ...info }, location.origin);
    });
  } catch { pending = false; /* extension context gone (reloaded): nothing to do */ }
}
window.addEventListener('message', (e) => { if (e.source === window && e.origin === location.origin && isAskMessage(e.data)) ask(); });
ask();
