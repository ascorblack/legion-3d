/**
 * «Update available» notice for installs from GitHub (Chrome zip / Firefox .xpi). The page cannot reach the network
 * (CSP) and has no chrome.* — notify.js (isolated world) relays {current, store, latest, url} from the background worker
 * as window.postMessage data. We validate it, then show a toast once per version and a row in the pause menu.
 * Store installs (store=true) update themselves: the setting row turns into a note and nothing is shown.
 */
import type { Feature } from '../contracts/ext';
import { registerPauseItem, registerSettingRow, settingValue } from '../ui/settings-ext';
import { mountUpdateToast, type UpdateToast } from '../ui/update-toast';
import { CHECK_KEY, isNewer, readPageMessage, dismissedFor, type UpdateInfo } from '../update/core';

export const DISMISSED_KEY = 'l3d.update.dismissed';
const LABEL = 'Проверять обновления (GitHub)';

const update: Feature = {
  id: 'update', order: 106,
  setup(ctx) {
    const seg = () => registerSettingRow({ key: CHECK_KEY, label: LABEL, sub: 'Раз в 12 часов расширение читает номер последней версии на GitHub; ничего о вас не отправляется', group: 'Прочее', order: 30, kind: 'seg', options: [['1', 'Вкл'], ['0', 'Выкл']], def: '1' });
    const note = () => registerSettingRow({ key: CHECK_KEY, label: LABEL, group: 'Прочее', order: 30, kind: 'info', text: () => 'обновляется через магазин' });
    // the row appears only once notify.js answered: store builds ship without the update check (no relay, no row)
    let offRow: () => void = () => {}; let rowed = false;
    let available: { latest: string; url: string } | null = null;
    let toast: UpdateToast | undefined;
    let store = false;
    const on = () => !store && settingValue<string>(CHECK_KEY, '1') !== '0';

    const hideToast = () => { toast?.dispose(); toast = undefined; };
    const dismiss = (latest: string) => { toast = undefined; try { localStorage.setItem(DISMISSED_KEY, latest); } catch { /* private mode */ } };
    const apply = (info: UpdateInfo) => {
      if (info.store && !store) { store = true; offRow(); offRow = note(); rowed = true; available = null; hideToast(); return; }
      if (!store && !rowed) { offRow = seg(); rowed = true; }
      if (store) return;
      if (info.off || !on() || !info.latest || !info.url || !isNewer(info.latest, info.current)) { available = null; hideToast(); return; }
      available = { latest: info.latest, url: info.url };
      let stored: string | null = null;
      try { stored = localStorage.getItem(DISMISSED_KEY); } catch { /* */ }
      if (!toast && !dismissedFor(stored, info.latest)) {
        const canvas = ctx.engine.renderer.domElement, rn = canvas.getRootNode();
        const root = (rn instanceof ShadowRoot ? rn : document.body) as unknown as HTMLElement;
        const latest = info.latest;
        toast = mountUpdateToast(root, latest, info.url, () => dismiss(latest));
      }
    };
    const onMsg = (e: MessageEvent) => { const info = readPageMessage(e, window, location.origin); if (info) apply(info); };
    const ask = () => { try { window.postMessage({ __l3d: 'update-ask' }, location.origin); } catch { /* */ } };
    const onSettings = (e: Event) => {
      if ((e as CustomEvent).detail?.key !== CHECK_KEY) return;
      if (on()) ask(); else { available = null; hideToast(); }
    };
    window.addEventListener('message', onMsg);
    window.addEventListener('l3d:settings', onSettings);

    const offPause = registerPauseItem({
      id: 'update', order: 5, get label() { return `⬆ Обновление ${available?.latest ?? ''}`; },
      enabled: () => !!available && on(),
      run: () => { const u = available?.url; if (u) setTimeout(() => window.open(u, '_blank', 'noopener,noreferrer'), 0); },
    });
    ask();
    return () => {
      window.removeEventListener('message', onMsg); window.removeEventListener('l3d:settings', onSettings);
      hideToast(); offPause(); offRow();
    };
  },
};
export default update;
