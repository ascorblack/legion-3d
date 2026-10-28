/**
 * Debug mode spaces (src/debug/space.ts): entering the test dimension and leaving it restores the city space, the
 * position and the facing, and not a single go() reaches the site — checked with the real go sender
 * (src/flight/sendpoint.ts) wired the way src/net/site.ts wires it, and a host that behaves like the game core
 * (setSpace(null) re-sends the street position through site.moveTo).
 */
import { describe, it, expect } from 'vitest';
import { DebugSpace } from '../src/debug/space';
import { createGoSender } from '../src/flight/sendpoint';
import type { RoomScene } from '../src/contracts/ext';

function rig() {
  const gos: [number, number][] = [];
  let t = 0;
  const sender = createGoSender({ go: (x, y) => gos.push([x, y]), map: () => null, now: () => t, setTimer: () => 1, clearTimer: () => {}, minMs: 0 });
  const site = { pauseMoves: (on: boolean) => sender.pause(on), moveTo: (x: number, y: number) => sender.move(x, y) };
  const spaces: (RoomScene | null)[] = [];
  const host = {
    me: { x: 2460, y: 1010 }, rig: { yaw: 0.7, pitch: -0.05 }, state: { inRoom: false, mode: 'fp' }, rooms: { current: null as string | null, busy: false }, site,
    setSpace(sc: RoomScene | null, back?: { x: number; y: number; face: number }) {
      spaces.push(sc);
      if (sc) { host.state.inRoom = true; (sc.root as any).parent = {}; return; }
      host.state.inRoom = false;
      if (back) { host.me.x = back.x; host.me.y = back.y; host.rig.yaw = back.face; }
      site.moveTo(host.me.x, host.me.y);   // like src/content/game.ts setSpace(null)
    },
  };
  const tick = (ms: number) => { t += ms; };
  return { host, gos, spaces, site, tick };
}
const scene = (): RoomScene => ({ root: { parent: null } as any, free: () => true, groundAt: () => 0, spawn: { x: 0, z: 0, face: 0 }, update() {}, dispose() {} });

describe('debug space', () => {
  it('enter → walk → leave: back at the same point and facing, no go() sent', () => {
    const { host, gos, spaces, site, tick } = rig();
    const sp = new DebugSpace(host);
    expect(sp.enter(scene(), 'dim')).toBe(true);
    expect(host.state.inRoom).toBe(true);
    // the game would not call moveTo inside a room, but even a stray one (a throttled pending point) is dropped
    for (let i = 0; i < 10; i++) { tick(600); site.moveTo(3000 + i * 50, 1200); }
    host.rig.yaw = 2.5; host.rig.pitch = 0.4;            // looked around inside
    const sub = scene();
    expect(sp.enter(sub, 'room')).toBe(true);           // a shop from a portal: same origin kept
    expect(sp.owner).toBe('room');
    tick(600);
    const o = sp.leave();
    expect(o).toEqual({ x: 2460, y: 1010, face: 0.7, pitch: -0.05, mode: 'fp' });
    expect(spaces[spaces.length - 1]).toBeNull();
    expect(host.me).toEqual({ x: 2460, y: 1010 });
    expect(host.rig.yaw).toBe(0.7); expect(host.rig.pitch).toBe(-0.05);
    expect(host.state.inRoom).toBe(false);
    expect(gos).toEqual([]);                             // nothing reached LGCity.go
    expect(sp.active).toBe(false);
    // and the sender works again afterwards
    tick(600); site.moveTo(2600, 1010);
    expect(gos).toEqual([[2600, 1010]]);
  });
  it('refuses while a real room or the expedition view is open', () => {
    const { host } = rig();
    const sp = new DebugSpace(host);
    host.rooms.current = 'forge';
    expect(sp.blocked()).toMatch(/здания/);
    expect(sp.enter(scene(), 'dim')).toBe(false);
    host.rooms.current = null; host.state.inRoom = true;
    expect(sp.enter(scene(), 'dim')).toBe(false);
  });
  it('a space taken over by someone else is noticed and dropped without swapping back', () => {
    const { host, spaces, gos } = rig();
    const sp = new DebugSpace(host);
    const sc = scene(); sp.enter(sc, 'dim');
    (sc.root as any).parent = null;                      // e.g. the expedition feature swapped its scene in
    expect(sp.lost()).toBe(true);
    const n = spaces.length;
    sp.drop();
    expect(spaces.length).toBe(n);                       // no setSpace(null) from us
    expect(sp.active).toBe(false);
    expect(gos).toEqual([]);
  });
});
