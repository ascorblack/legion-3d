/**
 * Canvas text in 3D: name plates, signboards, the telegraph word (drawn on a canvas — never DOM text, the streamer's
 * rule: the word must not be copyable), floating combat text. Each label = one sprite / plane = one draw call, so the
 * scene keeps a small pool. Redraw only when the text changes (no per-frame canvas work).
 */
import * as THREE from 'three';

export type LabelStyle = 'name' | 'me' | 'sign' | 'word' | 'float' | 'banner' | 'num' | 'warn' | 'loot';
const FONT = "'Golos Text','Nunito','Segoe UI',sans-serif";
const HEAD = "'Russo One','Dela Gothic One','Golos Text',sans-serif";

export class Label {
  readonly canvas: HTMLCanvasElement;
  readonly tex: THREE.CanvasTexture;
  readonly obj: THREE.Sprite | THREE.Mesh;
  private ctx: CanvasRenderingContext2D | null;
  private key = '';
  /** world height of the label (m) for width 1 aspect */
  constructor(readonly style: LabelStyle, readonly w = 512, readonly h = 128, readonly height = 0.45, plane = false) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = w; this.canvas.height = h;
    this.ctx = this.canvas.getContext('2d');
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.tex.anisotropy = 2;
    const top = style === 'word' || style === 'float' || style === 'warn' || style === 'me';
    if (plane) {
      const m = new THREE.MeshBasicMaterial({ map: this.tex, transparent: true, depthWrite: false, side: THREE.DoubleSide, toneMapped: false });
      this.obj = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), m);
    } else {
      const m = new THREE.SpriteMaterial({ map: this.tex, transparent: true, depthWrite: false, depthTest: !top, toneMapped: false });
      this.obj = new THREE.Sprite(m);
      this.obj.renderOrder = top ? 20 : 10;
    }
    this.obj.scale.set(height * (w / h), height, 1);
  }
  get material(): THREE.SpriteMaterial | THREE.MeshBasicMaterial { return (this.obj as THREE.Sprite).material as THREE.SpriteMaterial; }
  /** Draw text (main line + optional small caption). Cheap no-op when unchanged. */
  set(text: string, sub = '', color = ''): this {
    const key = text + '\u0001' + sub + '\u0001' + color;
    if (key === this.key) return this;
    this.key = key;
    const c = this.ctx;
    if (!c) return this;
    const { w, h } = this;
    c.clearRect(0, 0, w, h);
    c.textAlign = 'center'; c.textBaseline = 'middle'; c.lineJoin = 'round';
    switch (this.style) {
      case 'name': case 'me': {
        const me = this.style === 'me';
        c.font = `800 ${Math.round(h * 0.42)}px ${FONT}`;
        const tw = Math.min(w - 8, c.measureText(text).width + h * 0.5);
        rr(c, (w - tw) / 2, h * 0.14, tw, h * 0.72, h * 0.3);
        c.fillStyle = me ? 'rgba(255,201,77,.95)' : 'rgba(24,16,44,.72)'; c.fill();
        if (me) { c.lineWidth = 4; c.strokeStyle = '#3a2410'; c.stroke(); }
        c.fillStyle = me ? '#2a1606' : color || '#fff6e0';
        c.fillText(text, w / 2, h * 0.52, w - 20);
        break;
      }
      case 'sign': {
        c.font = `800 ${Math.round(h * 0.34)}px ${FONT}`;
        c.fillStyle = '#3a2410'; c.fillText(text, w / 2, sub ? h * 0.36 : h / 2, w - 16);
        if (sub) { c.font = `700 ${Math.round(h * 0.27)}px ${FONT}`; c.fillStyle = color || '#7a3a10'; c.fillText(sub, w / 2, h * 0.74, w - 16); }
        break;
      }
      case 'banner': {
        c.fillStyle = '#c0182b'; c.fillRect(0, 0, w, h);
        c.fillStyle = '#ffc94d'; c.fillRect(0, 0, w, h * 0.06); c.fillRect(0, h * 0.94, w, h * 0.06);
        c.font = `400 ${Math.round(h * 0.2)}px ${HEAD}`; c.fillStyle = '#ffe9a8'; c.fillText(text, w / 2, h * 0.3, w - 20);
        c.font = `800 ${Math.round(h * 0.34)}px ${FONT}`; c.fillStyle = '#ffffff'; c.fillText(sub, w / 2, h * 0.66, w - 20);
        break;
      }
      case 'word': case 'warn': {
        const warn = this.style === 'warn';
        c.font = `900 ${Math.round(h * 0.5)}px ${HEAD}`;
        c.shadowColor = warn ? '#ff2a4a' : '#ff6a2a'; c.shadowBlur = h * 0.18;
        c.lineWidth = h * 0.09; c.strokeStyle = warn ? '#3a0612' : '#3a1606';
        c.strokeText(text, w / 2, h * 0.42, w - 30);
        c.fillStyle = warn ? '#ffd0d8' : color || '#ffe27a';
        c.fillText(text, w / 2, h * 0.42, w - 30);
        c.shadowBlur = 0;
        if (sub) { c.font = `800 ${Math.round(h * 0.2)}px ${FONT}`; c.lineWidth = h * 0.05; c.strokeStyle = '#1a0e2a'; c.strokeText(sub, w / 2, h * 0.84, w - 30); c.fillStyle = '#ffffff'; c.fillText(sub, w / 2, h * 0.84, w - 30); }
        break;
      }
      case 'float': {
        c.font = `900 ${Math.round(h * 0.58)}px ${FONT}`;
        c.lineWidth = h * 0.12; c.strokeStyle = '#1a0e2a'; c.strokeText(text, w / 2, h / 2, w - 10);
        c.fillStyle = color || '#ffffff'; c.fillText(text, w / 2, h / 2, w - 10);
        break;
      }
      case 'num': {
        c.beginPath(); c.arc(w / 2, h / 2, h * 0.44, 0, Math.PI * 2);
        c.fillStyle = color || 'rgba(24,16,44,.85)'; c.fill(); c.lineWidth = h * 0.07; c.strokeStyle = '#ffc94d'; c.stroke();
        c.font = `900 ${Math.round(h * 0.56)}px ${FONT}`; c.fillStyle = '#ffffff'; c.fillText(text, w / 2, h * 0.54);
        break;
      }
      case 'loot': {
        c.font = `800 ${Math.round(h * 0.36)}px ${FONT}`;
        const tw = Math.min(w - 8, c.measureText(text).width + h * 0.6);
        rr(c, (w - tw) / 2, h * 0.06, tw, h * 0.56, h * 0.2);
        c.fillStyle = 'rgba(24,16,44,.85)'; c.fill(); c.lineWidth = Math.max(4, h * 0.022); c.strokeStyle = color || '#ffc94d'; c.stroke();
        c.fillStyle = color || '#ffe9a8'; c.fillText(text, w / 2, h * 0.35, w - 24);
        if (sub) { c.font = `800 ${Math.round(h * 0.28)}px ${FONT}`; const sw = Math.min(w - 8, c.measureText(sub).width + h * 0.3); rr(c, (w - sw) / 2, h * 0.66, sw, h * 0.32, h * 0.12); c.fillStyle = 'rgba(24,16,44,.62)'; c.fill(); c.lineWidth = Math.max(6, h * 0.034); c.strokeStyle = '#1a0e2a'; c.strokeText(sub, w / 2, h * 0.82, w - 20); c.fillStyle = '#ffffff'; c.fillText(sub, w / 2, h * 0.82, w - 20); }
        break;
      }
    }
    this.tex.needsUpdate = true;
    return this;
  }
  dispose(): void {
    this.tex.dispose();
    (this.obj.material as THREE.Material).dispose();
    if (this.obj instanceof THREE.Mesh) this.obj.geometry.dispose();
    this.obj.removeFromParent();
  }
}

function rr(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  c.beginPath(); c.moveTo(x + r, y); c.lineTo(x + w - r, y); c.quadraticCurveTo(x + w, y, x + w, y + r); c.lineTo(x + w, y + h - r);
  c.quadraticCurveTo(x + w, y + h, x + w - r, y + h); c.lineTo(x + r, y + h); c.quadraticCurveTo(x, y + h, x, y + h - r); c.lineTo(x, y + r);
  c.quadraticCurveTo(x, y, x + r, y); c.closePath();
}

/** Floating combat text: a fixed pool of sprites that rise and fade. */
export class FloatText {
  readonly root = new THREE.Group();
  private pool: { l: Label; t: number; life: number; x: number; y: number; z: number; vy: number }[] = [];
  private next = 0;
  constructor(n = 8) {
    this.root.name = 'exp-float';
    for (let i = 0; i < n; i++) { const l = new Label('float', 256, 96, 0.5); l.obj.visible = false; this.root.add(l.obj); this.pool.push({ l, t: 0, life: 0, x: 0, y: 0, z: 0, vy: 0 }); }
  }
  spawn(text: string, color: string, x: number, y: number, z: number, size = 0.5, life = 1.3): void {
    const p = this.pool[this.next]; this.next = (this.next + 1) % this.pool.length;
    p.l.set(text, '', color); p.t = 0; p.life = life; p.x = x; p.y = y; p.z = z; p.vy = 0.9;
    p.l.obj.scale.set(size * (256 / 96), size, 1);
    p.l.obj.visible = true;
  }
  update(dt: number): void {
    for (const p of this.pool) {
      if (!p.l.obj.visible) continue;
      p.t += dt;
      if (p.t >= p.life) { p.l.obj.visible = false; continue; }
      const k = p.t / p.life;
      p.y += p.vy * dt; p.vy *= 1 - dt * 1.5;
      p.l.obj.position.set(p.x, p.y, p.z);
      (p.l.obj.material as THREE.SpriteMaterial).opacity = Math.min(1, (1 - k) * 3, k * 12);
    }
  }
  clear(): void { for (const p of this.pool) p.l.obj.visible = false; }
  dispose(): void { for (const p of this.pool) p.l.dispose(); this.pool = []; }
}
