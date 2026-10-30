/**
 * Пасхалка «!идея бум» (owner request 2026-10-27). When the player HIMSELF types exactly «!идея бум» into a chat
 * field we control (the docked city chat, the fallback panel, the «⛏ Шахта» tab), the line is swallowed locally —
 * NEVER sent («!идея …» is a real stream-bot command; sending it would spam the streamer's suggestions) — and a
 * cartoon mega explosion goes off at the hero: the screen dims, a cartoon bomb appears by the hero and its fuse sputters (0.6 s), then BOOM — a flash,
 * shockwaves, fireball and smoke mushroom, confetti and stars, a short strong camera shake — and every cat within
 * 15 m (street players, shopkeepers in the 3D shops, miners in the mine) is tossed outwards spinning and gets up as
 * usual (CombatSystem.blast → ragdolls). The hero is fine (laughs). Others' chat lines never trigger it.
 *
 * Cooldown 20 s. prefers-reduced-motion: no shake, no flash, half the particles. Setting: Настройки → Забавы →
 * «Пасхалка „!идея бум“» (off = the line is still swallowed, nothing explodes). Client-only, nobody else sees it.
 * Cost: one DOM overlay (idle = hidden), a 4-mesh cartoon bomb for the 0.6 s fuse, particles in the shared fun Fx (one draw call + rings), ≤ 14 ragdolls for
 * a few seconds.
 */
import type { CombatSystem } from '../combat';
import type { AvatarSocial } from '../avatar/avatar';
import * as THREE from 'three';
import { BOOM, BoomCooldown, BoomShow, makeBomb } from '../combat/boom';
import { acquireFunFx } from '../combat/funfx';
import { TpPeek } from '../emotes/tp';
import { registerChatCommand } from '../ui/chat';
import { funToggle, reducedMotion, sfx } from '../social/toggle';
import { coreFeature } from './types';
import { setHtml } from '../core/html';

const KEY = 'l3d.fun.boom';
/** The command: exactly «!идея бум» (any case, extra spaces and trailing «!» forgiven). */
export const BOOM_CMD = /^!\s*идея\s+бум!*$/iu;

const CSS = `:host{all:initial}
.dim{position:fixed;inset:0;z-index:35;pointer-events:none;opacity:0;background:radial-gradient(circle at 50% 55%,#1d162000 18%,#1d1620d9 78%)}
.fl{position:fixed;inset:0;z-index:36;pointer-events:none;opacity:0;background:radial-gradient(circle at 50% 55%,#fffaf0 0,#ffe7b0 45%,#ffb36acc 100%)}`;

export default coreFeature({
  id: 'boom',
  order: 28,   // after combat (25) and emotes (27): the shake goes on top of the camera of this frame
  setup(ctx) {
    const { engine } = ctx;
    const tg = funToggle(KEY, 'Пасхалка «!идея бум»', 'Напиши в чат «!идея бум» — бабах! В чат сайта это не уходит. Видишь только ты', 70);
    const reduced = reducedMotion();
    const fun = acquireFunFx({ scene: ctx.scene, camera: ctx.camera, onFrame: ctx.onFrame, viewHeight: () => engine.renderer.domElement.height || 720 });
    const show = new BoomShow(), cd = new BoomCooldown(), peek = new TpPeek(ctx);
    const bomb = makeBomb(); ctx.scene.add(bomb.root);
    const _p = new THREE.Vector3();
    let now = 0, shakeT = -1, flashT = -1, fuseOn = false;
    let dimA = -1, flA = -1;

    const host = document.createElement('div'); host.className = 'l3d-boom';
    const sh = host.attachShadow({ mode: 'open' });
    setHtml(sh, `<style>${CSS}</style><div class="dim"></div><div class="fl"></div>`);
    const dim = sh.querySelector('.dim') as HTMLElement, fl = sh.querySelector('.fl') as HTMLElement;
    ctx.uiRoot.appendChild(host);
    const setDim = (a: number) => { a = Math.round(a * 100) / 100; if (a !== dimA) { dimA = a; dim.style.opacity = String(a); } };
    const setFl = (a: number) => { a = Math.round(a * 100) / 100; if (a !== flA) { flA = a; fl.style.opacity = String(a); } };

    const sys = () => ctx.dev.combat as CombatSystem | undefined;
    const me = () => ctx.meAv as typeof ctx.meAv & Partial<AvatarSocial>;

    function trigger(): boolean {
      if (!tg.on) { ctx.ui.toast('Пасхалка выключена (Настройки → Забавы). В чат ничего не ушло'); return false; }
      if (ctx.state.classic) return false;
      if (show.active) return false;
      if (!cd.use(now)) { ctx.ui.toast(`Бум перезаряжается… ещё ${cd.left(now)} с`); return false; }
      const f = ctx.feet, ctl = ctx.controller();
      show.start(f.x, f.y, f.z, ctl.ground, ctx.state.inRoom ? 2.4 : 30, engine.quality, reduced);
      sfx('fun.fuse', { x: f.x, y: f.y + 1, z: f.z });
      // the bomb sits beside the hero, on the camera's side so it is seen in third person
      const cam = ctx.camera.position;
      let dx = cam.x - f.x, dz = cam.z - f.z; const dl = Math.hypot(dx, dz) || 1; dx /= dl; dz /= dl;
      bomb.root.position.set(f.x + dx * 0.55 - dz * 0.45, ctl.ground + 0.42, f.z + dz * 0.55 + dx * 0.45);
      bomb.root.rotation.set(0, Math.atan2(dx, dz), 0);
      bomb.root.visible = true;
      me().setMood?.('surprised', BOOM.fuse + 0.3);
      peek.start(BOOM.fuse + 3.2);
      try { window.dispatchEvent(new CustomEvent('l3d:boom', { detail: { phase: 'fuse', x: f.x, y: f.y, z: f.z } })); } catch { /* */ }
      return true;
    }
    const offCmd = registerChatCommand(BOOM_CMD, () => { trigger(); });

    function bang() {
      const f = ctx.feet;
      const n = sys()?.blast(f.x, f.y, f.z, BOOM.radius, BOOM.front) ?? 0;
      sfx('fun.boom', { x: f.x, y: f.y + 1, z: f.z });
      if (n > 2) setTimeout(() => sfx('combat.hit', { x: f.x, y: f.y + 1, z: f.z }), 260);
      const av = me();
      av.setMood?.('laugh', 2.6);
      av.play('jump');
      setTimeout(() => av.play('laugh'), 650);
      if (!reduced) shakeT = 0;
      flashT = 0;
      try { window.dispatchEvent(new CustomEvent('l3d:boom', { detail: { phase: 'bang', x: f.x, y: f.y, z: f.z, hit: n } })); } catch { /* */ }
    }

    const offFrame = ctx.onFrame((dt) => {
      now += dt;
      peek.update(dt);
      if (!show.active && shakeT < 0 && flashT < 0) { if (dimA !== 0) setDim(0); return; }
      if (bomb.root.visible) {
        // a cartoon throb, the spark at the fuse tip
        const u = Math.min(1, show.t / BOOM.fuse), sc = 1.4 * (1 + 0.12 * u * Math.abs(Math.sin(show.t * 18)));
        bomb.root.scale.setScalar(sc);
        bomb.root.updateMatrixWorld();
        show.spark.copy(_p.copy(bomb.tip).applyMatrix4(bomb.root.matrixWorld));
      }
      if (show.update(fun.fx, dt)) { bomb.root.visible = false; bang(); }
      if (!show.active) bomb.root.visible = false;
      // the fuse: the hero glows brighter and brighter, pulsing (white flash overlay of the avatar)
      const av = ctx.meAv as typeof ctx.meAv & { setFlash?(a: number): void };
      if (show.active && show.t < BOOM.fuse) { const u = show.t / BOOM.fuse; av.setFlash?.((0.25 + 0.5 * u) * (0.6 + 0.4 * Math.sin(show.t * 40))); fuseOn = true; }
      else if (fuseOn) { fuseOn = false; av.setFlash?.(0); }
      // the screen dims during the fuse and clears after the bang
      const t = show.t;
      if (show.active) setDim(t < BOOM.fuse ? Math.min(1, t / BOOM.fuse * 1.6) * 0.8 : Math.max(0, 0.75 - (t - BOOM.fuse) * 2.2));
      else setDim(0);
      if (flashT >= 0) {
        flashT += dt;
        const a = reduced ? Math.max(0, 0.25 - flashT) : flashT < 0.05 ? flashT / 0.05 * 0.9 : Math.max(0, 0.9 * (1 - (flashT - 0.05) / 0.35));
        setFl(a);
        if (flashT > 0.5) { flashT = -1; setFl(0); }
      }
      if (shakeT >= 0) {
        shakeT += dt;
        const k = Math.max(0, 1 - shakeT / BOOM.shakeLen);
        if (k <= 0) shakeT = -1;
        else {
          const a = BOOM.shake * k * k, cam = ctx.camera;
          cam.rotation.x += Math.sin(shakeT * 61) * a;
          cam.rotation.y += Math.sin(shakeT * 47 + 2) * a * 0.6;
          cam.rotation.z += Math.sin(shakeT * 53 + 1) * a * 0.8;
          cam.position.y += Math.sin(shakeT * 70) * a * 2;
          cam.updateMatrixWorld();
        }
      }
    });

    ctx.dev.boom = { trigger, show, cd, cmd: BOOM_CMD };
    return () => {
      offFrame(); offCmd(); tg.dispose(); peek.end(); fun.release(); host.remove(); bomb.dispose();
      delete ctx.dev.boom;
    };
  },
});
