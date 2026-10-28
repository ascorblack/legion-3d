/**
 * The debug-mode feature (src/features/debug-mode.ts): with the switch off (the default) nothing is registered — no key,
 * no Esc-menu item, no frame hook, no controller — only the switch row itself; switching it on registers F10, the menu
 * items and one frame hook; switching it off again removes every one of them.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { createRegistries } from '../src/core/registries';
import { pauseItems, settingRow, writeRow } from '../src/ui/settings-ext';

// a minimal browser surface for the feature (node test environment)
const et = new EventTarget();
const mem = new Map<string, string>();
beforeAll(() => {
  const g = globalThis as any;
  g.window = g;
  g.addEventListener = et.addEventListener.bind(et);
  g.removeEventListener = et.removeEventListener.bind(et);
  g.dispatchEvent = et.dispatchEvent.bind(et);
  g.localStorage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => { mem.set(k, String(v)); }, removeItem: (k: string) => { mem.delete(k); }, key: (i: number) => [...mem.keys()][i] ?? null, get length() { return mem.size; } };
});

function fakeCtx() {
  const frames: unknown[] = [];
  const canvas = new EventTarget();
  const ctx: any = {
    registries: createRegistries(), dev: {} as Record<string, unknown>,
    onFrame(fn: unknown) { frames.push(fn); return () => { const i = frames.indexOf(fn); if (i >= 0) frames.splice(i, 1); }; },
    engine: { renderer: { domElement: canvas } }, store: { me: null, hero: null, walkers: new Map(), on: () => () => {} },
    me: { x: 0, y: 0 }, rig: { yaw: 0, pitch: 0 }, state: { inRoom: false, mode: 'fp', menu: null }, rooms: { current: null }, site: {},
    uiRoot: null, kit: null, scene: null, quality: () => 2, input: {}, ui: { toast() {}, open() {} },
  };
  return { ctx, frames };
}

describe('debug mode feature', () => {
  it('off by default: only the switch row exists', async () => {
    const { default: feature, DEBUG_SETTING } = await import('../src/features/debug-mode');
    const { ctx, frames } = fakeCtx();
    const dispose = (await feature.setup(ctx)) as () => void;
    const row = settingRow(DEBUG_SETTING)!;
    expect(row).toBeTruthy();
    expect(row.group).toBe('Отладка');
    expect(ctx.registries.keys.ids().filter((k: string) => k.startsWith('debug.'))).toEqual([]);
    expect(pauseItems().filter((p) => p.id.startsWith('debug'))).toEqual([]);
    expect(frames.length).toBe(0);
    expect(ctx.dev.debugMode).toBeUndefined();

    // on → F10, «🐞 Отладка» in the Esc menu, one frame hook, the controller
    writeRow(row, 'on');
    expect(ctx.registries.keys.get('debug.panel')?.code).toBe('F10');
    expect(pauseItems().map((p) => p.id)).toContain('debug');
    expect(pauseItems().map((p) => p.id)).not.toContain('debug-back');   // only while inside a debug space
    expect(frames.length).toBe(1);
    expect(ctx.dev.debugMode).toBeTruthy();

    // off again → all gone
    writeRow(row, 'off');
    expect(ctx.registries.keys.ids().filter((k: string) => k.startsWith('debug.'))).toEqual([]);
    expect(pauseItems().filter((p) => p.id.startsWith('debug'))).toEqual([]);
    expect(frames.length).toBe(0);
    expect(ctx.dev.debugMode).toBeUndefined();

    dispose();
    expect(settingRow(DEBUG_SETTING)).toBeUndefined();
  });
});
