/**
 * Hats, class helmets and face/neck accessories as 3D parts (vertex coloured), built on the body's head dome.
 */
import * as THREE from 'three';
import { Parts, T, cyl, cone, sphere, box, torus, slab, tube, star, capsule, radiusAt, bodyShell, prep, smoothNormals, INK, type BodyDims } from './geom';
import { RARITY_COLOR } from './appearance';

const GOLD = '#ffc94d', BONE = '#ebe2c9';
const PLATE = ['#c4cad3', '#dde3eb', '#eaeef4', '#f4f6fa', '#fff8ea'];
const RANK: Record<string, number> = { common: 0, uncommon: 1, rare: 2, epic: 3, legendary: 4 };

export interface HatCtx { d: BodyDims; c1: string; c2: string; rar?: string; style: string }

/** Known hat ids (others fall back to a generic cap). */
export const HAT_IDS = ['none', 'tuft', 'cap', 'bow', 'horns', 'crown', 'tophat', 'party', 'wizard', 'antenna', 'antenna2', 'cat', 'bunny', 'halo',
  'sprout', 'bandana', 'legion', 'laurel', 'beret', 'headphones', 'cowboy', 'chef', 'pumpkin', 'witch', 'batears', 'skull', 'reaper', 'scarehat',
  'miner', 'rhood', 'rmask', 'nhood', 'ncrown', 'phelm', 'pwing'];

/** Adds the hat; returns the extra height above the body top (for nameplate anchoring). */
export function addHat(p: Parts, id: string, k: HatCtx): number {
  const d = k.d, top = d.top, flat = d.shape === 'box';
  const hr = radiusAt(d, top - (flat ? 0.02 : 0.09));   // head radius at the hat line
  const hy = top - (flat ? 0.0 : 0.035);                  // where a hat sits
  const rk = RANK[k.rar || 'common'] || 0, rc = k.rar && k.rar !== 'common' ? RARITY_COLOR[k.rar] : null;
  const dz = d.depth;
  const brimOval = (r: number) => [1, 1, dz] as [number, number, number];
  // the site draws hats on a head of half-width hw = 22 units: u converts its units to metres on this head
  const u = hr / 22;
  // a point on the front of an ellipsoid (rx, ry, rz) centred at (0, cy, 0); front = −Z, the site's +x = our −x
  const onFront = (x: number, y: number, rx: number, ry: number, rz: number, cy: number, lift = 0.004): [number, number, number] =>
    [-x, cy + y, -Math.sqrt(Math.max(0, 1 - (x / rx) ** 2 - (y / ry) ** 2)) * rz - lift];
  switch (id) {
    case 'none': return 0;
    case 'tuft':
      for (const [a, l] of [[-0.5, 0.11], [0, 0.13], [0.5, 0.1]] as const) p.add(cone(0.02, l, 6), k.c1, T(Math.sin(a) * 0.03, top + l / 2 - 0.01, 0, 0, 0, -a));
      return 0.1;
    case 'bow':
      for (const s of [-1, 1]) p.add(cone(0.05, 0.1, 4), k.c2, T(s * 0.055, hy + 0.03, -0.02, 0, 0, s * Math.PI / 2, [1, 1, 0.5]));
      p.add(sphere(0.03, 8, 6), k.c2, T(0, hy + 0.03, -0.02));
      return 0.06;
    case 'horns':
      for (const s of [-1, 1]) p.add(tube([[s * hr * 0.5, hy - 0.02, 0], [s * hr * 0.62, hy + 0.06, 0], [s * hr * 0.5, hy + 0.15, 0]], 0.03, 8, 6, 0.85), '#e8455c');
      return 0.14;
    case 'crown': {
      const r = Math.min(hr * 0.75, 0.15);
      p.add(cyl(r, r, 0.06, 14, true), GOLD, T(0, hy + 0.03, 0));
      for (let i = 0; i < 5; i++) { const a = (i / 5) * Math.PI * 2; p.add(cone(0.028, 0.08, 4), GOLD, T(Math.sin(a) * r, hy + 0.09, -Math.cos(a) * r)); p.add(sphere(0.014, 6, 4), '#e8455c', T(Math.sin(a) * r * 1.02, hy + 0.035, -Math.cos(a) * r * 1.02)); }
      return 0.13;
    }
    case 'tophat':
      p.add(cyl(hr * 1.15, hr * 1.15, 0.018, 18), '#2a2440', T(0, hy, 0, 0, 0, 0, brimOval(1)));
      p.add(cyl(hr * 0.68, hr * 0.68, 0.26, 16), '#2a2440', T(0, hy + 0.13, 0));
      p.add(cyl(hr * 0.69, hr * 0.69, 0.05, 16, true), k.c2, T(0, hy + 0.04, 0));
      return 0.27;
    case 'party':
      p.add(cone(hr * 0.6, 0.3, 14), k.c2, T(0, hy + 0.14, 0, 0, 0, 0.12));
      p.add(sphere(0.035, 8, 6), '#ffffff', T(-0.035, hy + 0.3, 0));
      p.add(torus(hr * 0.42, 0.012, 4, 14), '#ffffff', T(-0.012, hy + 0.08, 0, Math.PI / 2 + 0.0, 0, 0.12));
      return 0.32;
    case 'wizard': case 'witch': {
      const c = id === 'witch' ? '#3a2a55' : '#4b3bb8';
      p.add(cyl(hr * 1.35, hr * 1.35, 0.02, 20), c, T(0, hy, 0, 0, 0, 0, brimOval(1)));
      p.add(tube([[0, hy, 0], [0.01, hy + 0.17, 0], [0.06, hy + 0.32, 0.02], [0.13, hy + 0.36, 0.05]], hr * 0.62, 14, 12, 0.95), c);
      p.add(star(0.045, 0.012), GOLD, T(0, hy + 0.12, -hr * 0.45, 0.2));
      return 0.36;
    }
    case 'antenna': case 'antenna2': {
      const xs = id === 'antenna' ? [0] : [-0.06, 0.06];
      for (const x of xs) {
        p.add(tube([[x, top - 0.02, 0], [x * 1.4 - 0.03, top + 0.1, 0], [x * 2 + 0.03, top + 0.2, 0]], 0.009, 8, 5), INK);
        p.add(sphere(0.04, 10, 8), k.c2, T(x * 2 + 0.03, top + 0.22, 0));
      }
      return 0.26;
    }
    case 'batears':
      // hwHats batears: two long dark-violet bat ears splayed out past the head with a ragged inner edge and a pink stripe
      for (const s of [-1, 1]) {
        const x0 = hr * 0.35, x1 = hr + 12 * u, pts: [number, number][] = [[x0, -6 * u], [x1, 26 * u], [x1 - 4 * u, 14 * u], [x1 - 10 * u, 13 * u], [x1 - 12 * u, 4 * u], [hr * 0.8, -2 * u]];
        p.add(slab(pts.map(([x, y]) => [s * x, y] as [number, number]), 0.035), '#3a2e4a', T(0, hy, -0.01, 0, s * 0.25, 0));
        p.add(tube([[s * (x0 + 3 * u), hy - 2 * u, -0.03], [s * (x1 - 3 * u), hy + 18 * u, -0.03 - s * s * 0.01]], 1.5 * u, 4, 4), '#ff8fa3');
      }
      return 0.3;
    case 'cat':
      for (const s of [-1, 1]) p.add(cone(0.065, 0.15, 4), k.c1, T(s * hr * 0.62, hy + 0.05, 0, 0, Math.PI / 4, s * -0.3, [1, 1, 0.45]));
      return 0.14;
    case 'bunny':
      for (const s of [-1, 1]) {
        p.add(capsule(0.04, 0.2, 4, 10), k.c1, T(s * 0.065, hy + 0.15, 0.01, 0, 0, s * -0.15, [1, 1, 0.55]));
        p.add(capsule(0.022, 0.16, 4, 8), '#ff9fb2', T(s * 0.067, hy + 0.15, -0.012, 0, 0, s * -0.15, [1, 1, 0.4]));
      }
      return 0.3;
    case 'halo':
      p.add(torus(0.12, 0.018, 6, 24), '#ffe27a', T(0, top + 0.1, 0, Math.PI / 2));
      return 0.13;
    case 'sprout':
      p.add(cyl(0.008, 0.008, 0.12, 5), '#3f8f3a', T(0, top + 0.05, 0));
      for (const s of [-1, 1]) p.add(sphere(0.05, 8, 6), '#6fdc6f', T(s * 0.05, top + 0.12, 0, 0, 0, s * 0.6, [1, 0.45, 0.6]));
      return 0.16;
    case 'bandana':
      p.add(sphere(hr * 1.04, 18, 8, ), '#e8455c', T(0, hy - 0.05, 0, 0, 0, 0, [1, 0.62, dz * 1.04]));
      p.add(cone(0.04, 0.09, 4), '#e8455c', T(hr * 0.5, hy - 0.04, hr * dz * 0.85, 0.5, 0, -0.8));
      p.add(sphere(0.016, 6, 4), '#ffffff', T(-hr * 0.4, hy + 0.0, -hr * dz * 0.85));
      return 0.04;
    case 'legion': {
      p.add(new THREE.SphereGeometry(hr * 1.1, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2), '#d9b04a', T(0, hy - 0.06, 0, 0, 0, 0, [1, 1.05, dz * 1.08]));
      p.add(slab([[-0.14, 0], [-0.1, 0.12], [0, 0.16], [0.1, 0.12], [0.14, 0]], 0.05, 0.01), '#e8455c', T(0, hy + hr * 0.95 - 0.07, 0, 0, Math.PI / 2, 0));
      p.add(box(hr * 2.1, 0.03, 0.03), '#b8892a', T(0, hy - 0.05, -hr * dz * 0.95));
      return 0.24;
    }
    case 'laurel':
      for (let i = 0; i < 14; i++) {
        const a = -2.4 + (i / 13) * 4.8, s = a > 0 ? 1 : -1;
        p.add(sphere(0.035, 6, 4), i % 2 ? '#8fd16a' : '#b6e38f', T(Math.sin(a) * hr * 1.0, hy - 0.02 + Math.abs(a) * 0.01, Math.cos(a) * hr * dz * 1.0, 0, a, s * 0.6, [0.5, 1, 0.3]));
      }
      return 0.04;
    case 'beret':
      p.add(sphere(hr * 1.1, 16, 8), k.c2, T(-0.03, hy + 0.01, 0, 0, 0, 0.15, [1, 0.28, dz * 1.1]));
      p.add(cyl(0.008, 0.008, 0.04, 5), INK, T(-0.02, hy + 0.06, 0));
      return 0.07;
    case 'headphones': {
      p.add(torus(hr * 1.08, 0.022, 6, 20, Math.PI), '#2a2440', T(0, d.eyeY - 0.02, 0));
      const er = radiusAt(d, d.eyeY);
      for (const s of [-1, 1]) p.add(cyl(0.065, 0.065, 0.06, 14), k.c2, T(s * (er + 0.02), d.eyeY - 0.02, 0, 0, 0, Math.PI / 2));
      return 0.05;
    }
    case 'cowboy':
      p.add(cyl(hr * 1.7, hr * 1.5, 0.02, 20), '#8a5a2b', T(0, hy + 0.01, 0, 0, 0, 0, brimOval(1)));
      p.add(sphere(hr * 0.75, 14, 8), '#a0703a', T(0, hy + 0.04, 0, 0, 0, 0, [1, 1.05, 0.85]));
      p.add(cyl(hr * 0.74, hr * 0.74, 0.03, 14, true), '#e8455c', T(0, hy + 0.04, 0, 0, 0, 0, [1, 1, 0.85]));
      return 0.17;
    case 'chef':
      p.add(cyl(hr * 0.68, hr * 0.68, 0.12, 16), '#ffffff', T(0, hy + 0.06, 0));
      p.add(sphere(hr * 0.85, 14, 8), '#ffffff', T(0, hy + 0.17, 0, 0, 0, 0, [1, 0.7, 1]));
      return 0.25;
    case 'pumpkin': {
      // hwHats pumpkin: a wide flat jack-o'-lantern (rx = hw + 7, ry = 15) with rust ribs, yellow triangle eyes and a
      // jagged grin, a curled green stem with a leaf
      const rx = 29 * u, ry = 15 * u, rz = 29 * u * dz, cy = hy + 6 * u;
      p.add(sphere(1, 18, 10), '#ff7a1a', T(0, cy, 0, 0, 0, 0, [rx, ry, rz]));
      for (const x of [-0.45, 0, 0.45]) p.add(tube([-0.85, -0.45, 0, 0.45, 0.85].map((y) => onFront(x * rx * (1 - Math.abs(y) * 0.25), y * ry, rx, ry, rz, cy, 0.0)), 1.3 * u, 8, 4), '#c4520e');
      for (const sx of [-7, 7]) p.add(slab([[-5 * u, -3.5 * u], [5 * u, -3.5 * u], [0, 3.5 * u]], 0.01), '#ffd34d', T(...onFront(sx * u, 2 * u, rx, ry, rz, cy)));
      p.add(slab([[-11 * u, 0], [-8 * u, -3 * u], [-5 * u, -1 * u], [-2 * u, -4 * u], [1 * u, -1 * u], [4 * u, -4 * u], [7 * u, -1 * u], [11 * u, 0], [0, -6 * u]], 0.01), '#ffd34d', T(...onFront(0, -4 * u, rx, ry, rz, cy, 0.002)));
      p.add(tube([[2 * u, cy + ry - 2 * u, 0], [1 * u, cy + ry + 6 * u, 0], [-5 * u, cy + ry + 10 * u, 0]], 2.5 * u, 6, 5), '#4e7a2e');
      p.add(sphere(5 * u, 8, 5), '#6fae3a', T(-9 * u, cy + ry + 9 * u, 0, 0, 0, 0.4, [1.4, 0.5, 0.5]));
      return ry * 2 + 10 * u;
    }
    case 'skull': {
      // hwHats skull: a tall bone cap rising 24 units over the head with big round ink sockets, a triangle nose and a crack
      const rx = hr + 5 * u, ry = 30 * u, rz = (hr + 5 * u) * dz, cy = hy - 6 * u;
      p.add(new THREE.SphereGeometry(1, 18, 10, 0, Math.PI * 2, 0, Math.PI * 0.56), '#efe6d2', T(0, cy, 0, 0, 0, 0, [rx, ry, rz]));
      for (const sx of [-8, 8]) p.add(sphere(5.8 * u, 12, 8), INK, T(...onFront(sx * u, 7 * u, rx, ry, rz, cy, 0), 0, 0, 0, [1, 1.1, 0.4]));
      p.add(slab([[-2.2 * u, 0], [2.2 * u, 0], [0, 4.4 * u]], 0.01), INK, T(...onFront(0, -1.5 * u, rx, ry, rz, cy, 0.0)));
      p.add(tube([onFront(-13 * u, 17 * u, rx, ry, rz, cy, 0.002), onFront(-10 * u, 14 * u, rx, ry, rz, cy, 0.002), onFront(-11 * u, 10 * u, rx, ry, rz, cy, 0.002)], 1 * u, 4, 4), '#bdb2a0');
      return 24 * u;
    }
    case 'scarehat':
      p.add(cyl(hr * 1.6, hr * 1.6, 0.02, 12), '#b9945a', T(0, hy, 0, 0, 0, 0.08, brimOval(1)));
      p.add(cone(hr * 0.8, 0.22, 10), '#c9a46a', T(0, hy + 0.1, 0, 0, 0, 0.08));
      return 0.22;
    case 'miner': {
      p.add(new THREE.SphereGeometry(hr * 1.12, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2), '#ffcf3a', T(0, hy - 0.06, 0, 0, 0, 0, [1, 0.95, dz * 1.12]));
      p.add(cyl(hr * 1.3, hr * 1.3, 0.016, 18), '#f2b82a', T(0, hy - 0.06, 0, 0, 0, 0, brimOval(1)));
      p.add(box(0.03, 0.03, hr * 2.1 * dz), '#e0a91f', T(0, hy - 0.06 + hr * 0.95, 0, 0, 0, 0));
      p.add(cyl(0.05, 0.05, 0.04, 12), '#8e8e98', T(0, hy + 0.01, -hr * dz * 1.08, Math.PI / 2 - 0.3));
      p.add(cyl(0.038, 0.038, 0.045, 12), '#fff6c0', T(0, hy + 0.012, -hr * dz * 1.1, Math.PI / 2 - 0.3));
      return 0.08;
    }
    case 'rhood': case 'rmask': case 'nhood': case 'reaper': {
      const col = id === 'nhood' ? ['#3b3644', '#2a2633', '#221c33', '#1d1230', '#140a1c'][rk] : id === 'reaper' ? '#1e1a26' : ['#5a4e44', '#3e3530', '#2e2a2c', '#241f2c', '#1d1824'][rk];
      // classHat hood: a shell over the back/top of the head that frames the whole face (opening ≈ 150°), rising over
      // the head (rhood: a curled tip to the side; nhood: a tall pointed gothic arch with a skull mark), a light rim
      const er = radiusAt(d, d.eyeY), tall = id === 'nhood' ? 34 * u : 22 * u;
      // SphereGeometry: z = sin(phi)·sin(theta) — keep phi around +π/2 (the back), the face (phi = 1.5π) open
      const g = new THREE.SphereGeometry(1, 20, 12, Math.PI * 0.5 - Math.PI * 0.6, Math.PI * 1.2, 0, Math.PI * 0.64);
      const sy = (d.top - d.eyeY) + tall * 0.55, cy = d.eyeY - 0.02;
      p.add(g, col, T(0, cy, 0, 0, 0, 0, [er * 1.16, sy, er * dz * 1.16]));
      const rimR = er * 1.12;
      p.add(torus(1, 0.012 / rimR, 4, 22, Math.PI * 1.1), rc || (id === 'nhood' ? BONE : '#8a7460'), T(0, cy, -er * dz * 0.36, 0, 0, -Math.PI * 0.05, [rimR, sy * 0.96, 1]));
      if (id === 'nhood') p.add(cone(er * 0.42, tall * 0.7, 10), col, T(0, cy + sy * 0.92, 0.01, 0, 0, 0, [1, 1, dz]));
      else p.add(tube([[0, cy + sy * 0.96, 0.0], [-6 * u, cy + sy + 4 * u, 0.0], [-14 * u, cy + sy + 2 * u, 0.0], [-16 * u, cy + sy - 5 * u, 0.0]], 3 * u, 8, 6, 0.4), col);
      if (id === 'nhood' && rk >= 1) {
        const zf = -radiusAt(d, d.top - 0.04) * dz * 1.2 - 0.01;
        p.add(sphere(5.2 * u, 10, 8), BONE, T(0, d.top + 2 * u, zf, 0, 0, 0, [1, 1, 0.5]));
        p.add(box(5 * u, 3 * u, 3 * u), BONE, T(0, d.top - 3 * u, zf));
        for (const sx of [-2, 2]) p.add(sphere(1.5 * u, 6, 4), rk >= 3 ? '#9fe8ff' : INK, T(sx * u, d.top + 2 * u, zf - 2.4 * u));
      }
      if (id === 'rmask') p.add(new THREE.SphereGeometry(radiusAt(d, d.mouthY) * 1.04, 16, 6, 0, Math.PI * 2, Math.PI * 0.42, Math.PI * 0.2), ['#6a2a2a', '#7a2a2a', '#1c1a22', '#d8d2c6', '#2a1f38'][rk], T(0, d.mouthY + 0.07, 0, 0, 0, 0, [1, 1, dz]));
      return 0.12;
    }
    case 'ncrown': {
      // classHat ncrown: a bone band round the head with five bone spikes across the front (the middle short, the
      // next pair tallest), a rarity stripe and a skull mark in the middle
      const r = hr * 1.02, by = hy - 2 * u;
      p.add(cyl(r, r, 9 * u, 18, true), BONE, T(0, by, 0, 0, 0, 0, [1, 1, dz]));
      p.add(cyl(r * 0.98, r * 0.98, 9 * u, 18, true), '#5a5048', T(0, by, 0, 0, 0, 0, [1, 1, dz]));
      if (rc) p.add(torus(r + 0.003, 1.2 * u, 3, 22), rc, T(0, by - 1 * u, 0, Math.PI / 2, 0, 0, [1, dz, 1]));
      for (const i of [-2, -1, 0, 1, 2]) { const a = i * 0.42, h = ((i === 0 ? 8 : Math.abs(i) === 1 ? 15 : 11) + rk * 1.5) * u + 5 * u;
        p.add(cone(4.5 * u, h, 4), BONE, T(-Math.sin(a) * r, by + 4 * u + h / 2, -Math.cos(a) * r * dz, 0, Math.PI / 4, 0, [1, 1, 0.5])); }
      const zf = -r * dz - 0.014;
      p.add(sphere(7 * u, 10, 8), BONE, T(0, by + 1 * u, zf, 0, 0, 0, [1, 1, 0.45]));
      p.add(box(6 * u, 3.4 * u, 3 * u), BONE, T(0, by - 5 * u, zf));
      for (const sx of [-2.4, 2.4]) p.add(sphere(1.8 * u, 6, 4), rk >= 3 ? '#9fe8ff' : INK, T(sx * u, by + 1.5 * u, zf - 2.6 * u));
      return 24 * u;
    }
    case 'phelm': case 'pwing': {
      const steel = PLATE[rk], gd = rk ? '#e8b923' : '#b89a52';
      // classHat phelm / pwing: a white dome helm down over the sides of the head (cheek guards), a gold brow band,
      // a gold cross (phelm) or a gold sun (pwing) on the front; pwing: two white feather wings, a halo from epic up
      const rx = hr + 5.5 * u, ry = 26 * u, rz = rx * dz, cy = hy - 7 * u;
      p.add(new THREE.SphereGeometry(1, 20, 10, 0, Math.PI * 2, 0, Math.PI * 0.62), steel, T(0, cy, 0, 0, 0, 0, [rx, ry, rz]));
      p.add(new THREE.SphereGeometry(1, 20, 4, Math.PI * 0.62, Math.PI * 0.76, Math.PI * 0.62, Math.PI * 0.14), steel, T(0, cy, 0, 0, Math.PI, 0, [rx, ry, rz]));
      p.add(torus(1, 1.3 / rx * u, 4, 24, Math.PI), gd, T(0, cy + 9 * u, 0, Math.PI / 2, 0, Math.PI, [rx * 0.985, rz * 0.985, 1]));
      if (id === 'phelm') {
        p.add(tube([onFront(0, 25 * u, rx, ry, rz, cy, 1.5 * u), onFront(0, 17 * u, rx, ry, rz, cy, 1.5 * u), onFront(0, 8 * u, rx, ry, rz, cy, 1.5 * u)], 2 * u, 6, 4), gd);
        p.add(tube([onFront(-7 * u, 18 * u, rx, ry, rz, cy, 1.5 * u), onFront(0, 18.6 * u, rx, ry, rz, cy, 1.5 * u), onFront(7 * u, 18 * u, rx, ry, rz, cy, 1.5 * u)], 2 * u, 6, 4), gd);
      } else {
        const c = onFront(0, 18 * u, rx, ry, rz, cy, 2 * u);
        p.add(cyl(4.5 * u, 4.5 * u, 0.008, 14), gd, T(c[0], c[1], c[2], Math.PI / 2 - 0.5, 0, 0));
        for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; p.add(box(1.6 * u, 3 * u, 0.006), gd, T(c[0] + Math.cos(a) * 7.2 * u, c[1] + Math.sin(a) * 7.2 * u * 0.88, c[2] + 0.004, -0.5, 0, a - Math.PI / 2)); }
        for (const s of [-1, 1]) {
          const w: [number, number][] = [[0, 0], [4, 9], [14, 20], [26, 30], [22, 18], [32, 22], [26, 10], [34, 8], [22, 0], [10, -4]];
          p.add(slab(w.map(([x, y]) => [s * x * u, y * u] as [number, number]), 0.035, 0.004), '#ffffff', T(s * (rx - 2 * u), cy + 8 * u, 0.02, 0, s * 0.35, 0));
        }
        if (rk >= 3) p.add(torus(15 * u, 1.8 * u, 4, 20), '#ffe27a', T(0, cy + ry + 9 * u, 0, Math.PI / 2, 0, 0, [1, 0.5, 1]));
      }
      return ry - 7 * u;
    }
    case 'cap': default: {
      p.add(new THREE.SphereGeometry(hr * 1.06, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2), k.c2, T(0, hy - 0.04, 0, 0, 0, 0, [1, 0.8, dz * 1.06]));
      p.add(cyl(hr * 0.8, hr * 0.8, 0.014, 16, false), k.c2, T(0, hy - 0.035, -hr * dz * 0.72, 0.12, 0, 0, [1, 1, 0.75]));
      p.add(sphere(0.022, 6, 4), '#ffffff', T(0, hy - 0.04 + hr * 0.8, 0));
      return 0.1;
    }
  }
}

/* ------------------------------------------------------------------ accessories on the face / neck */
/**
 * Face/neck accessories are CONFORMED to the outermost surface in front of the character: every vertex of a part
 * built around the plane z = 0 is pushed to `surfZ(x, y) - lift`, so frames, lenses, a mustache or a tie follow the
 * curve of the face of any body shape (bean/box/ball/tall/ghost/cone/egg) and never sink into it. `lift` is the
 * clearance measured along the surface normal (slopes are compensated). The surface includes the armour shell.
 */
export interface AccCtx {
  d: BodyDims; accColor: string; cyc: boolean;
  /** Eye style (face decal), sets the size of glasses/shades. */
  eyes?: string;
  /** Armour shell over the body: [yA, yB] with radial offset (m). */
  shell?: { yA: number; yB: number; off: number } | null;
}

/** Face decal metrics (must match face.ts drawFace: chibi eyes are scaled ×1.3 around the eye line). */
export function eyeLayout(d: BodyDims, eyes: string | undefined): { x: number; y: number; r: number; ry: number; one: boolean } {
  const K = 0.0113, s = 1.3;
  const R: Record<string, [number, number]> = {
    big: [7, 7], wide: [7, 7], stars: [6.4, 6.4], happy: [5, 3.5], sleepy: [5, 3.5], slit: [7, 6], void: [5.5, 6.5], jack: [6, 5], dots: [4, 4.9],
  };
  if (eyes === 'cyclops') return { x: 0, y: d.eyeY + 2 * K * s, r: 9.5 * K * s, ry: 9.5 * K * s, one: true };
  const [rx, ry] = R[eyes || 'dots'] || R.dots;
  return { x: (d.narrow ? 9.5 : 11.5) * K, y: d.eyeY, r: rx * K * s, ry: ry * K * s, one: false };
}

/** Front surface z (negative) of the body at height y and lateral x, with an extra radial offset. */
export function frontZ(d: BodyDims, x: number, y: number, off = 0): number {
  const r = radiusAt(d, y) + off;
  if (r <= 1e-4) return 0;
  const sx = Math.min(0.985, Math.abs(x) / r);
  return -r * d.depth * Math.pow(Math.max(0, 1 - Math.pow(sx, d.n)), 1 / d.n);
}

/** Outermost front surface (body, face decal, armour shell) at (x, y). */
export function surfZ(k: AccCtx, x: number, y: number): number {
  let off = 0.0035;   // face decal sits 3.5 mm above the body
  const sh = k.shell;
  if (sh && y >= sh.yA - 0.01 && y <= sh.yB + 0.012) off = Math.max(off, sh.off + 0.003);
  return frontZ(k.d, x, y, off);
}

/** Push every vertex of `g` (built around z = 0, back towards +z) onto the face surface; recomputes normals. */
export function conform(g: THREE.BufferGeometry, k: AccCtx, lift: number, m?: THREE.Matrix4): THREE.BufferGeometry {
  if (m) g.applyMatrix4(m);
  const p = g.attributes.position as THREE.BufferAttribute, h = 0.004;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z0 = surfZ(k, x, y);
    // slope compensation: clearance along the normal = lift → along z it is lift·√(1+|∇z|²) (capped)
    const gx = (surfZ(k, x + h, y) - surfZ(k, x - h, y)) / (2 * h), gy = (surfZ(k, x, y + h) - surfZ(k, x, y - h)) / (2 * h);
    const sl = Math.min(2.2, Math.sqrt(1 + gx * gx + gy * gy));
    p.setZ(i, p.getZ(i) + z0 - lift * sl);
  }
  p.needsUpdate = true;
  // extruded slabs (non-indexed after prep: identity index) keep flat faces; tubes/tori get welded smooth normals
  if (g.type === 'ExtrudeGeometry' || g.type === 'BoxGeometry') { g.deleteAttribute('normal'); g.computeVertexNormals(); } else smoothNormals(g);
  return g;
}

/** Rounded lens outline (aviator-ish when squash < 1) as an extruded slab. */
function lens(rx: number, ry: number, depth: number, flatTop = 0): THREE.BufferGeometry {
  const pts: [number, number][] = [];
  for (let i = 0; i < 20; i++) {
    const a = (i / 20) * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
    pts.push([c * rx, s > 0 ? s * ry * (1 - flatTop) : s * ry]);
  }
  return slab(pts, depth);
}

export function addAccessories(p: Parts, acc: string[], k: AccCtx): void {
  const d = k.d, my = d.mouthY;
  const has = (a: string) => acc.includes(a);
  const neckY = my - 0.085;
  const rN = radiusAt(d, neckY);
  const E = eyeLayout(d, k.cyc ? 'cyclops' : k.eyes);
  const shellOff = k.shell && neckY <= k.shell.yB + 0.012 ? k.shell.off + 0.003 : 0;
  if (has('scarf')) {
    // a puffy band hugging the neck line (bodyShell follows the shape), plus a hanging end
    const yA = neckY - 0.05, yB = neckY + 0.045, ac = new THREE.Color(k.accColor), dk = ac.clone().multiplyScalar(0.8);
    p.add(bodyShell(d, {
      yA, yB, segs: 28, rings: 6,
      scale: (y) => { const t = (y - yA) / (yB - yA); return 1 + (shellOff + 0.006 + 0.03 * Math.sin(Math.PI * t)) / Math.max(0.05, radiusAt(d, y)); },
      color: (_th, _y, t, out) => { out.copy(Math.abs(t - 0.5) > 0.36 ? dk : ac); },
    }));
    const x = rN * 0.42;
    p.add(conform(prep(capsule(0.034, 0.16, 4, 8), k.accColor), k, 0.016, T(x, neckY - 0.13, 0, 0, 0, 0.14, [1, 1, 0.45])));
    for (let i = 0; i < 3; i++) p.add(conform(prep(box(0.012, 0.03, 0.01), dk), k, 0.022, T(x - 0.022 + i * 0.022 + 0.035 * 0.14, neckY - 0.235, 0, 0, 0, 0.14)));
  }
  if (has('bowtie')) {
    const y = neckY + 0.005;
    for (const s of [-1, 1]) p.add(conform(prep(cone(0.045, 0.085, 4), k.accColor), k, 0.022, T(s * 0.044, y, 0, 0, 0, s * Math.PI / 2, [1, 1, 0.45])));
    p.add(conform(prep(sphere(0.022, 8, 6), INK), k, 0.026, T(0, y, 0, 0, 0, 0, [1, 1, 0.6])));
  } else if (has('tie')) {
    p.add(conform(prep(box(0.05, 0.036, 0.02), k.accColor), k, 0.012, T(0, neckY, 0)));
    p.add(conform(prep(slab([[-0.022, 0], [0.022, 0], [0.04, -0.2], [0, -0.25], [-0.04, -0.2]], 0.012), k.accColor), k, 0.008, T(0, neckY - 0.016, 0)));
  }
  if (has('glasses')) {
    // round frames around the decal eyes (radius from the eye style, never overlapping in the middle)
    const R = E.one ? Math.min(0.16, E.r + 0.014) : Math.min(E.x - 0.014, Math.max(E.r, E.ry) + 0.014), tube_ = 0.009;
    const xs = E.one ? [0] : [-E.x, E.x];
    for (const x of xs) p.add(conform(prep(torus(R, tube_, 6, 28), INK), k, tube_ + 0.007, T(x, E.y, 0)));
    if (!E.one) {
      const gap = 2 * (E.x - R);
      p.add(conform(prep(cyl(0.0065, 0.0065, gap + 0.01, 5), INK), k, 0.0145, T(0, E.y + R * 0.3, 0, 0, 0, Math.PI / 2)));
      // temples: short arms running back over the cheeks
      for (const s of [-1, 1]) p.add(conform(prep(cyl(0.006, 0.006, 0.07, 5), INK), k, 0.012, T(s * (E.x + R + 0.03), E.y + R * 0.15, 0, 0, 0, Math.PI / 2 + s * 0.1)));
    }
  }
  if (has('shades')) {
    const rx = E.one ? Math.min(0.17, E.r + 0.02) : Math.min(E.x - 0.008, Math.max(E.r, 0.075) + 0.012), ry = Math.max(E.ry, 0.06) * 0.85;
    const xs = E.one ? [0] : [-E.x, E.x];
    for (const x of xs) {
      p.add(conform(prep(lens(rx, ry, 0.008, 0.35), '#15122e'), k, 0.012, T(x, E.y, 0)));
      p.add(conform(prep(box(rx * 0.55, 0.012, 0.004), '#8aa0c0'), k, 0.018, T(x + rx * 0.25, E.y + ry * 0.35, 0, 0, 0, -0.35)));
    }
    if (!E.one) p.add(conform(prep(box(2 * (E.x - rx) + 0.03, 0.014, 0.008), '#15122e'), k, 0.012, T(0, E.y + ry * 0.4, 0)));
    for (const s of [-1, 1]) p.add(conform(prep(cyl(0.007, 0.007, 0.07, 5), '#15122e'), k, 0.01, T(s * ((E.one ? 0 : E.x) + rx + 0.03), E.y + ry * 0.4, 0, 0, 0, Math.PI / 2)));
  } else if (has('monocle')) {
    const x = E.one ? 0 : -E.x, R = E.one ? Math.min(0.16, E.r + 0.014) : Math.min(E.x - 0.01, Math.max(E.r, E.ry) + 0.014);
    p.add(conform(prep(torus(R, 0.01, 6, 28), GOLD), k, 0.017, T(x, E.y, 0)));
    const a = -2.4, x0 = x + Math.cos(a) * R, y0 = E.y + Math.sin(a) * R;
    p.add(conform(prep(tube([[x0, y0, 0], [x0 - 0.035, y0 - 0.08, 0], [x0 - 0.02, y0 - 0.17, 0]], 0.0045, 10, 4), GOLD), k, 0.008));
  }
  if (has('mustache')) {
    const y = my + 0.004;
    for (const s of [-1, 1]) p.add(conform(prep(tube([[s * 0.004, y, 0], [s * 0.05, y - 0.014, 0], [s * 0.1, y + 0.004, 0], [s * 0.12, y + 0.035, 0]], 0.017, 12, 6, 0.7), '#3a2410'), k, 0.018));
  }
  if (has('fangs')) for (const s of [-1, 1]) p.add(conform(prep(cone(0.008, 0.026, 5), '#ffffff'), k, 0.009, T(s * 0.025, my - 0.035, 0, Math.PI, 0, 0, [1, 1, 0.6])));
  // Halloween accessories (doodle.js, 26.10)
  if (has('bolts')) for (const s of [-1, 1]) {
    // Frankenstein neck bolts: a grey bolt sticking out of each side of the neck, a hex nut at its end
    const r = radiusAt(d, neckY) + shellOff;
    p.add(prep(cyl(0.022, 0.022, 0.09, 8), '#9aa3ad', T(s * (r + 0.02), neckY + 0.01, 0, 0, 0, Math.PI / 2)));
    p.add(prep(cyl(0.036, 0.036, 0.03, 6), '#c8ccd3', T(s * (r + 0.07), neckY + 0.01, 0, 0, 0, Math.PI / 2)));
  }
  if (has('cobweb')) {
    // a cobweb on the shoulder (front, character's right): 5 spokes + 3 sagging arcs + a little black spider
    const x0 = -rN * 0.62, y0 = neckY - 0.03, W = '#efe6ff';
    const spoke = (a: number, R: number): [number, number, number] => [x0 + Math.cos(a) * R, y0 - Math.sin(a) * R, 0];
    const angs = [-0.17, 0.26, 0.7, 1.13, 1.57].map((a) => a + Math.PI);   // fanning down-left over the shoulder
    for (const a of angs) p.add(conform(prep(tube([spoke(a, 0), spoke(a, 0.07), spoke(a, 0.14)], 0.0032, 6, 3), W), k, 0.012));
    for (const R of [0.05, 0.095, 0.135]) {
      const pts: [number, number, number][] = [];
      for (let q = 0; q < angs.length; q++) { pts.push(spoke(angs[q], R)); if (q + 1 < angs.length) pts.push(spoke((angs[q] + angs[q + 1]) / 2, R * 0.86)); }
      p.add(conform(prep(tube(pts, 0.0028, 18, 3), W), k, 0.012));
    }
    const sp = spoke(angs[2], 0.1);
    p.add(conform(prep(sphere(0.026, 8, 6), '#1c1424', T(sp[0], sp[1], 0, 0, 0, 0, [1, 1, 0.6])), k, 0.02));
    for (const s of [-1, 1]) for (const dy of [-0.008, 0.008]) p.add(conform(prep(box(0.034, 0.004, 0.004), '#1c1424', T(sp[0] + s * 0.026, sp[1] + dy, 0, 0, 0, s * dy * 30)), k, 0.016));
  }
  if (has('candybag')) {
    // a jack-o'-lantern candy bucket held at the side: ribbed orange pumpkin, carved face, handle, candies on top
    const y = neckY - 0.33, r = radiusAt(d, y) + shellOff, X = r + 0.1, Z = -0.06;
    const O = '#ff7a1a';
    for (const q of [-1, 0, 1]) p.add(prep(sphere(0.085, 12, 9), q ? '#f06a12' : O, T(X + q * 0.032, y, Z, 0, 0, 0, [0.62, 0.82, 0.9])));
    p.add(prep(torus(0.07, 0.006, 6, 18, Math.PI), INK, T(X, y + 0.045, Z, 0, Math.PI / 2, 0)));
    for (const s of [-1, 1]) p.add(prep(cone(0.012, 0.022, 3), '#2a1a12', T(X + s * 0.026, y + 0.015, Z - 0.08, -Math.PI / 2, 0, 0)));
    p.add(prep(box(0.05, 0.01, 0.006), '#2a1a12', T(X, y - 0.022, Z - 0.081)));
    for (const [cx, cz, c] of [[-0.02, 0, '#ff5a8a'], [0.015, -0.01, '#7fd6e6'], [0.0, 0.02, '#ffd34d']] as const) p.add(prep(sphere(0.016, 8, 6), c, T(X + cx, y + 0.068, Z + cz)));
  }
}
