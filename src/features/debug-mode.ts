/**
 * «Режим отладки» (Settings → Отладка, off by default): for testers and the curious. While the switch is off nothing
 * of it exists — no key, no Esc-menu item, no DOM, no frame hook (only the switch row itself). When on:
 *   F10 / Esc menu «🐞 Отладка» — the debug panel (src/debug: test dimension, expedition scenes, overlays, tools,
 *   site contract, bus log, bug report); while in a debug space the Esc menu also has «Вернуться в город».
 * Everything is client-only: nothing is sent to the site (src/debug/index.ts).
 */
import { registerSettingRow, registerPauseItem, settingValue } from '../ui/settings-ext';
import { DebugMode } from '../debug';
import { coreFeature } from './types';

export const DEBUG_SETTING = 'l3d.debug';

export default coreFeature({
  id: 'debug-mode',
  order: 130,   // after the camera, the expedition view and the other features: its frame hook may own the camera
  setup(ctx) {
    const offRow = registerSettingRow({
      key: DEBUG_SETTING, label: 'Режим отладки', group: 'Отладка', order: 10,
      sub: 'Для тестеров: F10 — панель: тестовое измерение, сцены похода, счётчики, сетка. Всё только у тебя, на сайт ничего не уходит',
      kind: 'seg', options: [['off', 'Выкл'], ['on', 'Вкл']], def: 'off',
    });
    let dbg: DebugMode | null = null;
    let offs: (() => void)[] = [];
    const on = () => {
      if (dbg) return;
      const d = new DebugMode(ctx);
      dbg = d;
      ctx.dev.debugMode = d;
      offs = [
        ctx.registries.keys.register('debug.panel', { code: 'F10', label: 'Панель отладки', when: 'always', run: (_c, e) => { e?.preventDefault?.(); d.togglePanel(); return true; } }),
        // while the panel is open the game's input only passes menu keys: F10 closes it from here (and the browser's F10 menu stays shut)
        (() => { const k = (e: KeyboardEvent) => { if (e.code === 'F10' && d.panelOpen) { e.preventDefault(); e.stopPropagation(); d.showPanel(false); } }; window.addEventListener('keydown', k, true); return () => window.removeEventListener('keydown', k, true); })(),
        registerPauseItem({ id: 'debug', label: '🐞 Отладка', key: 'F10', order: 90, run: () => setTimeout(() => d.showPanel(true), 0) }),
        registerPauseItem({ id: 'debug-back', label: '🏙️ Вернуться в город', order: 91, enabled: () => d.inside, run: () => setTimeout(() => d.exitAll(), 0) }),
        registerPauseItem({ id: 'debug-dim', label: '🌀 Назад в измерение', order: 92, enabled: () => d.inside && !!d.dim && d.where() !== 'dim', run: () => setTimeout(() => { if (d.scenes.active) d.closeScene(true); else d.backToDim(); }, 0) }),
        ctx.onFrame((dt, t) => d.frame(dt, t)),
      ];
    };
    const off = () => {
      if (!dbg) return;
      for (const o of offs.reverse()) { try { o(); } catch { /* */ } }
      offs = [];
      try { dbg.dispose(); } catch (e) { console.error('[l3d] debug mode dispose', e); }
      dbg = null; delete ctx.dev.debugMode;
    };
    const sync = () => { if (settingValue<string>(DEBUG_SETTING, 'off') === 'on') on(); else off(); };
    const onSet = (e: Event) => { const k = (e as CustomEvent).detail?.key; if (!k || k === DEBUG_SETTING) sync(); };
    window.addEventListener('l3d:settings', onSet);
    sync();
    return () => { window.removeEventListener('l3d:settings', onSet); off(); offRow(); };
  },
});
