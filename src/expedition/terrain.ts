/**
 * Procedural low-poly terrain per biome: sky dome with sun / clouds / moon, layered distant ridges, rolling ground with a
 * path (travel) or a clearing (arenas) and a detailed ground shader, rock / stone shells for tunnels, caverns, gorges and
 * halls, water with fresnel, landmarks (falls, barrow + stone circle, gate, bridge, causeway), clustered instanced
 * vegetation with contact shadows, glow halos and light shafts. The ground and the props repeat along x with period P, so
 * the travel scene scrolls the whole terrain (`scroll(offset)`) for an endless road without rebuilding anything.
 * Budget: ≤ ~22 draw calls, ≤ ~60k triangles per biome (q2).
 */
import * as THREE from 'three';
import type { BiomeId } from './adapter';
import { propGeo, GB, T, type PropKind } from './art';
import type { ExpMats } from './mats';
import { tunnelGeo, chamberGeo, ridgeGeo, hash2, blobShadowMesh, rowPoints, type ShellCfg } from './biome-art';
import { DN, tickDayNight } from '../world/daynight';

export const P = 48;           // repeat period along x (m)
const SPAN = 1.5 * P;          // ground spans x ∈ [−SPAN, SPAN]
const ZW = 36;                 // props / action half-depth (m)

type Ridge = { kind: 'hills' | 'peaks' | 'mesa' | 'dunes' | 'pines'; far: string; near: string; h: number; snow?: boolean };
export interface BiomeSpec {
  sky: [string, string, string]; fog: string; fogNear: number; fogFar: number; stars: number;
  ground: [string, string]; path: string; amp: number;
  hemi: [string, string, number]; sun: [string, number];
  props: [PropKind, number, number, 1?][];   // kind, palette, count per tile; 4th = 1: foreground dressing (camera side, low / at the edges)
  water: 'none' | 'river' | 'falls' | 'bridge' | 'swamp';
  walls: 'none' | 'gorge' | 'cave';
  /** label of the place for the HUD («Курган») */
  ru: string;
  /** sky sun direction (also the rim-light direction), sun strength 0..1.5, sun colour */
  sunDir: [number, number, number]; sunI: number; sunCol: string;
  cloud: number; cloudCol: string;
  rim: string; rimK: number;
  /** ground shader: 0 grass, 1 tiles, 2 sand, 3 snow, 4 rock, 5 mud; patch tints (linear multipliers) */
  mode: number; tA: [number, number, number]; tB: [number, number, number];
  /** speck colour (blossoms, pebbles, glints) and its amount in the ground detail */
  spk: [string, number];
  ridge: Ridge | null;
  /** how far the land rolls up beyond the action (m of height) */
  far: number;
  /** shell kind for enclosed / canyon biomes */
  shell?: 'cave' | 'mine' | 'dungeon' | 'gorge';
  /** a moon disc in the day sky at sunDir (moonlit biomes keep their own palette instead of the generic night) */
  moon?: number;
  /** motes drifting over the ground: count at q2, rgb (embers, wisps, fireflies) */
  fly?: [number, number, number, number];
  /** ground mist: big soft low glows, count at q2 + colour (q0: none) */
  mist?: [number, string];
}
const DAY: [string, string, string] = ['#2a74e6', '#86c4ff', '#dcefff'];
/** An open-sky daytime biome (its own palette is a day): follows the user's clock (src/world/daynight.ts). */
export const clockable = (S: BiomeSpec) => (!S.shell || S.shell === 'gorge') && !S.moon && S.stars === 0 && S.walls !== 'cave';
/** Is it night by the user's clock for this biome (a terrain built now should be a night build)? */
export function clockNight(biome: BiomeId): boolean {
  const S = BIOMES[biome] || BIOMES.meadow;
  if (!clockable(S)) return false;
  tickDayNight();
  return DN.night > 0.5;
}
const WARM: [number, number, number] = [1.1, 1.04, 0.84], LUSH: [number, number, number] = [0.86, 1.0, 0.9], NEUT: [number, number, number] = [1, 1, 1];
export const BIOMES: Record<BiomeId, BiomeSpec> = {
  meadow: { ru: 'Луг', sky: DAY, fog: '#cfe8f4', fogNear: 34, fogFar: 95, stars: 0, ground: ['#4a9e36', '#6cb844'], path: '#d8b87a', amp: 0.8, hemi: ['#fff6e8', '#7a8a5a', 2.6], sun: ['#fff2dc', 2.4],
    props: [['pebbles', 0, 40], ['tree', 0, 9], ['tree', 1, 6], ['birch', 0, 4], ['bush', 0, 12], ['berry', 0, 3], ['rock', 0, 6], ['grass', 0, 150], ['grass', 1, 90], ['flower', 0, 22], ['flower', 1, 18], ['flower', 3, 10], ['fence', 0, 3], ['stump', 0, 2], ['moss', 0, 4]],
    water: 'none', walls: 'none', sunDir: [-0.4, 0.34, -0.85], sunI: 1, sunCol: '#fff0d0', cloud: 0.5, cloudCol: '#ffffff', rim: '#c8e0ff', rimK: 0.3, mode: 0, tA: WARM, tB: LUSH, spk: ['#fff2b0', 0.9],
    ridge: { kind: 'hills', far: '#6a9ac0', near: '#5a9a68', h: 16 }, far: 4.5 },
  forest: { ru: 'Лес', sky: ['#3a82d0', '#9ccce8', '#d0ecf0'], fog: '#a4cdb6', fogNear: 22, fogFar: 80, stars: 0, ground: ['#4a9a4a', '#62b05a'], path: '#b8986a', amp: 1.0, hemi: ['#f0f8e0', '#4a6a3a', 2.4], sun: ['#fff2d0', 2.0],
    props: [['pebbles', 3, 30], ['pine', 0, 14], ['pine', 1, 8], ['tree', 3, 8], ['tree', 0, 6], ['birch', 1, 4], ['bush', 1, 10], ['fern', 0, 28], ['fern', 1, 16], ['mushroom', 0, 10], ['mushroom', 1, 6], ['grass', 3, 120], ['grass', 0, 70], ['rock', 2, 6], ['boulder', 0, 3], ['fallen', 0, 3], ['stump', 0, 3], ['moss', 0, 6]],
    water: 'none', walls: 'none', sunDir: [-0.5, 0.36, -0.78], sunI: 0.7, sunCol: '#fff0c0', cloud: 0.3, cloudCol: '#ffffff', rim: '#b0e0c8', rimK: 0.28, mode: 0, tA: [0.92, 1.02, 0.84], tB: [0.74, 0.92, 0.8], spk: ['#2c6a3a', 0.55],
    ridge: { kind: 'pines', far: '#3a6a6a', near: '#2a5a48', h: 14 }, far: 5 },
  river: { ru: 'Река', sky: DAY, fog: '#cfe8f4', fogNear: 34, fogFar: 95, stars: 0, ground: ['#6cc04a', '#8ad060'], path: '#d8c08a', amp: 0.6, hemi: ['#fff6e8', '#6a8a7a', 2.6], sun: ['#fff2dc', 2.4],
    props: [['pebbles', 2, 50], ['tree', 0, 6], ['willow', 0, 3], ['birch', 0, 4], ['bush', 0, 10], ['reed', 0, 36], ['cattail', 0, 22], ['lily', 1, 14], ['rock', 3, 10], ['grass', 0, 150], ['grass', 1, 80], ['flower', 2, 20], ['flower', 1, 16], ['moss', 0, 4]],
    water: 'river', walls: 'none', sunDir: [-0.35, 0.3, -0.88], sunI: 1, sunCol: '#fff0d0', cloud: 0.5, cloudCol: '#ffffff', rim: '#c8e8ff', rimK: 0.3, mode: 0, tA: WARM, tB: LUSH, spk: ['#fffbd0', 0.8],
    ridge: { kind: 'hills', far: '#6a9ac0', near: '#5a9a6a', h: 15 }, far: 3.5 },
  falls: { ru: 'Водопад', sky: DAY, fog: '#d0e8f4', fogNear: 30, fogFar: 90, stars: 0, ground: ['#5ab04a', '#80c85e'], path: '#d0b88a', amp: 0.7, hemi: ['#fff6e8', '#5a8a8a', 2.6], sun: ['#fff2dc', 2.3],
    props: [['pebbles', 0, 50], ['tree', 3, 6], ['pine', 0, 6], ['birch', 0, 3], ['reed', 0, 24], ['cattail', 0, 12], ['rock', 0, 12], ['boulder', 1, 3], ['grass', 0, 150], ['fern', 0, 16], ['flower', 2, 18], ['flower', 3, 10], ['moss', 0, 6]],
    water: 'falls', walls: 'none', sunDir: [0.3, 0.3, -0.9], sunI: 0.8, sunCol: '#fff6e0', cloud: 0.4, cloudCol: '#ffffff', rim: '#c0e8ff', rimK: 0.3, mode: 0, tA: LUSH, tB: [0.8, 1.0, 0.92], spk: ['#fff6d8', 0.7],
    ridge: { kind: 'peaks', far: '#7a8ab0', near: '#5a8a78', h: 22 }, far: 6 },
  bridge: { ru: 'Старый мост', sky: ['#4a7ad0', '#e8c0a8', '#f2cfb4'], fog: '#d8bcb2', fogNear: 34, fogFar: 100, stars: 0, ground: ['#7ab84a', '#a0c860'], path: '#c8a878', amp: 0.7, hemi: ['#ffeedd', '#7a6a5a', 2.5], sun: ['#ffd0a0', 2.4],
    props: [['pebbles', 1, 40], ['tree', 2, 7], ['willow', 0, 2], ['dead', 0, 3], ['bush', 2, 10], ['reed', 0, 20], ['cattail', 0, 10], ['rock', 1, 10], ['grass', 2, 150], ['grass', 0, 70], ['flower', 1, 16], ['flower', 0, 10], ['fence', 0, 3], ['stump', 0, 2]],
    water: 'bridge', walls: 'none', sunDir: [0.35, 0.16, -0.92], sunI: 1.3, sunCol: '#ffc888', cloud: 0.55, cloudCol: '#ffd8c0', rim: '#ffd0a0', rimK: 0.45, mode: 0, tA: [1.12, 1.0, 0.8], tB: [0.92, 0.98, 0.78], spk: ['#fff0b0', 0.7],
    ridge: { kind: 'hills', far: '#b08aa8', near: '#8a8a70', h: 16 }, far: 3.5 },
  mound: { ru: 'Курган', sky: ['#4a6ab8', '#aebcd8', '#dfe6ec'], fog: '#c0ccd8', fogNear: 26, fogFar: 88, stars: 0, ground: ['#5a9a40', '#7cb454'], path: '#c0a878', amp: 1.2, hemi: ['#fff8ec', '#5a6a4a', 2.6], sun: ['#fff0dc', 2.4],
    props: [['pebbles', 0, 50], ['dead', 0, 6], ['tree', 2, 6], ['bush', 3, 10], ['pine', 0, 5], ['rock', 2, 8], ['boulder', 2, 3], ['tomb', 0, 6], ['tomb', 1, 5], ['bones', 0, 3], ['grass', 2, 140], ['grass', 3, 70], ['flower', 3, 10], ['moss', 0, 6], ['stump', 0, 2]],
    water: 'none', walls: 'none', sunDir: [-0.3, 0.26, -0.92], sunI: 0.65, sunCol: '#fff0dc', cloud: 0.62, cloudCol: '#dfe4ee', rim: '#b8c8e8', rimK: 0.3, mode: 0, tA: [0.96, 1.0, 0.84], tB: [0.8, 0.94, 0.86], spk: ['#d8d4c0', 0.55],
    ridge: { kind: 'hills', far: '#7888a8', near: '#5a8060', h: 18 }, far: 5 },
  gorge: { ru: 'Ущелье', sky: ['#3470c4', '#b4c4dc', '#d6c8c4'], fog: '#a88e8c', fogNear: 30, fogFar: 100, stars: 0, ground: ['#6a4238', '#84584a'], path: '#523830', amp: 0.5, hemi: ['#fff0e0', '#7a5046', 2.4], sun: ['#ffe0b8', 2.4],
    props: [['pebbles', 1, 24], ['pebbles', 2, 12], ['dry', 0, 14], ['shrub', 1, 10], ['boulder', 1, 5], ['boulder', 3, 3], ['rock', 1, 12], ['rock', 3, 7], ['slab', 0, 7], ['slab', 1, 5], ['sandrock', 0, 6], ['scree', 0, 14], ['scree', 2, 7], ['dead', 0, 4], ['grass', 2, 24], ['cactus', 0, 3], ['agave', 0, 6], ['ribs', 0, 1], ['bones', 0, 2], ['tumble', 0, 3],
      ['scree', 0, 12, 1], ['scree', 2, 6, 1], ['shrub', 1, 8, 1], ['dry', 0, 10, 1], ['slab', 1, 3, 1], ['sandrock', 0, 3, 1], ['bones', 0, 2, 1], ['agave', 0, 3, 1]],
    water: 'none', walls: 'gorge', shell: 'gorge', sunDir: [0.1, 0.5, -0.86], sunI: 0.5, sunCol: '#ffe8b8', cloud: 0, cloudCol: '#ffffff', rim: '#cfe8ff', rimK: 0.9, mode: 2, tA: [1.0, 0.94, 0.9], tB: [0.88, 0.86, 0.86], spk: ['#a46a4c', 0.6],
    ridge: null, far: 0 },
  mine: { ru: 'Шахта', sky: ['#1a1424', '#2a2034', '#3a2e40'], fog: '#2a2034', fogNear: 10, fogFar: 46, stars: 0, ground: ['#5e5a68', '#757080'], path: '#7a7468', amp: 0.3, hemi: ['#ffd8a8', '#3a2a2a', 2.0], sun: ['#ffcf8a', 1.6],
    props: [['pebbles', 1, 70], ['support', 0, 6], ['stalag', 0, 12], ['crystal', 3, 8], ['crystal', 0, 4], ['rock', 2, 14], ['boulder', 3, 3], ['barrel', 0, 4], ['crate', 0, 4], ['torch', 0, 6]],
    water: 'none', walls: 'cave', shell: 'mine', sunDir: [-0.3, 0.5, -0.8], sunI: 0, sunCol: '#ffd89a', cloud: 0, cloudCol: '#ffffff', rim: '#ffb870', rimK: 0.45, mode: 4, tA: [0.96, 0.97, 1.06], tB: [0.86, 0.86, 0.94], spk: ['#b89870', 0.7],
    ridge: null, far: 0 },
  cave: { ru: 'Пещера', sky: ['#120e22', '#1e1834', '#2a2240'], fog: '#1e1834', fogNear: 9, fogFar: 44, stars: 0, ground: ['#5c586e', '#716d86'], path: '#7e7890', amp: 0.4, hemi: ['#b8c8ff', '#2a2034', 2.0], sun: ['#a8c0ff', 1.4],
    props: [['pebbles', 3, 70], ['stalag', 1, 14], ['crystal', 0, 14], ['crystal', 1, 8], ['crystal', 2, 4], ['mushroom', 3, 16], ['mushroom', 2, 8], ['rock', 2, 14], ['boulder', 2, 3], ['moss', 0, 3]],
    water: 'none', walls: 'cave', shell: 'cave', sunDir: [-0.3, 0.5, -0.8], sunI: 0, sunCol: '#a8c0ff', cloud: 0, cloudCol: '#ffffff', rim: '#6ea0ff', rimK: 0.55, mode: 4, tA: [1.0, 0.98, 1.06], tB: [0.84, 0.84, 0.94], spk: ['#9a98c0', 0.6],
    ridge: null, far: 0 },
  dungeon: { ru: 'Данж', sky: ['#120e1a', '#241c30', '#32283e'], fog: '#2a2236', fogNear: 14, fogFar: 56, stars: 0, ground: ['#545068', '#6c6882'], path: '#6e6a84', amp: 0.05, hemi: ['#ffd8b0', '#2a2030', 2.0], sun: ['#ffc88a', 1.4],
    props: [['pebbles', 3, 50], ['pillar', 0, 8], ['pillar', 1, 4], ['brazier', 0, 6], ['torch', 0, 8], ['barrel', 0, 4], ['crate', 0, 4], ['bones', 0, 3], ['rock', 2, 6]],
    water: 'none', walls: 'cave', shell: 'dungeon', sunDir: [-0.3, 0.5, -0.8], sunI: 0, sunCol: '#ffc88a', cloud: 0, cloudCol: '#ffffff', rim: '#ff9a60', rimK: 0.4, mode: 1, tA: [1.06, 1.0, 1.0], tB: [0.9, 0.9, 1.0], spk: ['#a8a0b8', 0.7],
    ridge: null, far: 0 },
  gate: { ru: 'Врата башни', sky: ['#2c2c78', '#b8709a', '#e898a4'], fog: '#b88aa4', fogNear: 32, fogFar: 98, stars: 0.35, ground: ['#6c9c60', '#86b070'], path: '#a89c8a', amp: 0.8, hemi: ['#ffe0e8', '#5a4a6a', 2.4], sun: ['#ffb890', 2.2],
    props: [['pebbles', 0, 40], ['pillar', 0, 5], ['stone', 0, 4], ['ruin', 0, 2], ['tree', 2, 5], ['pine', 0, 4], ['rock', 2, 8], ['grass', 2, 130], ['flower', 0, 12], ['brazier', 0, 4], ['torch', 0, 6], ['bush', 3, 8]],
    water: 'none', walls: 'none', sunDir: [0.3, 0.1, -0.95], sunI: 1.4, sunCol: '#ffb078', cloud: 0.5, cloudCol: '#ffb8b0', rim: '#ffa8c0', rimK: 0.45, mode: 0, tA: [1.0, 0.96, 0.96], tB: [0.84, 0.92, 0.98], spk: ['#ffd8e0', 0.6],
    ridge: { kind: 'peaks', far: '#7a5a98', near: '#5a4a78', h: 24 }, far: 6 },
  swamp: { ru: 'Болото', sky: ['#486a6c', '#8aa89a', '#a8c0a4'], fog: '#8aa696', fogNear: 18, fogFar: 74, stars: 0, ground: ['#5a7a46', '#6e9058'], path: '#8a7650', amp: 0.4, hemi: ['#e8f0d8', '#3a4a3a', 2.2], sun: ['#e8f0c8', 1.8],
    props: [['pebbles', 1, 30], ['dead', 0, 10], ['willow', 0, 4], ['reed', 0, 44], ['cattail', 0, 24], ['lily', 0, 26], ['lily', 1, 12], ['mushroom', 2, 12], ['grass', 3, 110], ['fern', 1, 14], ['moss', 0, 10], ['stump', 0, 3], ['fallen', 0, 3]],
    water: 'swamp', walls: 'none', sunDir: [-0.2, 0.3, -0.93], sunI: 0.35, sunCol: '#e8f0c0', cloud: 0.8, cloudCol: '#b8c8b0', rim: '#a8e0b0', rimK: 0.32, mode: 5, tA: [0.9, 1.0, 0.8], tB: [0.74, 0.86, 0.76], spk: ['#8ab060', 0.5],
    ridge: { kind: 'hills', far: '#6a8878', near: '#4a6a50', h: 12 }, far: 1.8 },
  snow: { ru: 'Тайга', sky: ['#3a78c8', '#a8c8ea', '#d0e0f0'], fog: '#c0d2e6', fogNear: 30, fogFar: 96, stars: 0, ground: ['#b8cce4', '#dce8f8'], path: '#a0b0cc', amp: 1.0, hemi: ['#f0f4ff', '#8a9ab8', 2.6], sun: ['#fff4e8', 2.2],
    props: [['snowtuft', 0, 60], ['pebbles', 3, 30], ['snowpine', 0, 20], ['snowpine', 0, 8], ['rock', 2, 10], ['boulder', 2, 3], ['dead', 0, 4], ['drift', 0, 14], ['ice', 0, 8], ['bush', 1, 4]],
    water: 'none', walls: 'none', sunDir: [-0.4, 0.22, -0.89], sunI: 0.9, sunCol: '#fff0d8', cloud: 0.4, cloudCol: '#ffffff', rim: '#bcd8ff', rimK: 0.45, mode: 3, tA: [0.96, 0.99, 1.04], tB: [0.84, 0.9, 1.0], spk: ['#a8c0e8', 0.4],
    ridge: { kind: 'peaks', far: '#8aa4cc', near: '#7890b8', h: 26, snow: true }, far: 7 },
  desert: { ru: 'Пустыня', sky: ['#2f7ad8', '#a8cce8', '#e8dcc4'], fog: '#d6cbb6', fogNear: 36, fogFar: 118, stars: 0, ground: ['#86503a', '#a4684a'], path: '#6e4430', amp: 1.1, hemi: ['#fff6e6', '#9a6446', 2.6], sun: ['#fff0d0', 2.6],
    props: [['pebbles', 2, 18], ['dry', 1, 30], ['shrub', 0, 18], ['shrub', 1, 8], ['cactus', 0, 6], ['agave', 0, 10], ['rock', 3, 10], ['sandrock', 0, 9], ['sandrock', 1, 6], ['scree', 0, 10], ['scree', 1, 5], ['boulder', 3, 4], ['ruin', 1, 1], ['dead', 0, 4], ['spire', 0, 2], ['ribs', 0, 2], ['bones', 0, 2], ['tumble', 0, 3], ['grass', 2, 20],
      ['scree', 0, 10, 1], ['scree', 1, 5, 1], ['shrub', 0, 9, 1], ['shrub', 1, 5, 1], ['dry', 1, 12, 1], ['bones', 0, 2, 1], ['ribs', 0, 1, 1], ['sandrock', 0, 3, 1], ['sandrock', 1, 2, 1], ['cactus', 0, 2, 1], ['agave', 0, 3, 1]],
    water: 'none', walls: 'none', sunDir: [-0.3, 0.42, -0.86], sunI: 1.3, sunCol: '#fff0c8', cloud: 0.15, cloudCol: '#fff8ec', rim: '#cfe8ff', rimK: 0.9, mode: 2, tA: [1.0, 0.94, 0.86], tB: [0.88, 0.84, 0.82], spk: ['#c48a54', 0.6],
    ridge: { kind: 'mesa', far: '#b0806c', near: '#a8644a', h: 22 }, far: 6.5 },
  // 31.10 (live main channel): the Halloween expedition map. Pumpkin field — Halloween dusk (violet sky, an orange sun on the
  // horizon), jack-o'-lanterns and ember motes; graveyard — moonlit night with ground mist and grave lights.
  pumpkin: { ru: 'Тыквенное поле', sky: ['#22164a', '#8a3a78', '#ff9452'], fog: '#5e4466', fogNear: 36, fogFar: 104, stars: 0.55, ground: ['#3e5226', '#56662c'], path: '#6a4c36', amp: 0.35, hemi: ['#ffd0a0', '#4a2a4a', 2.5], sun: ['#ffa060', 2.4],
    props: [['pebbles', 1, 14], ['grass', 2, 56], ['grass', 3, 40], ['vine', 0, 5], ['pumpkin', 0, 5], ['pumpkin', 1, 4], ['pumpkin', 2, 5], ['corn', 0, 6], ['scarecrow', 0, 1], ['dead', 0, 3], ['tree', 2, 4], ['bush', 3, 6], ['fence', 1, 5], ['stump', 0, 2],
      ['pumpkin', 0, 4, 1], ['pumpkin', 1, 4, 1], ['pumpkin', 2, 6, 1], ['vine', 0, 3, 1]],
    water: 'none', walls: 'none', sunDir: [0.35, 0.07, -0.93], sunI: 1.5, sunCol: '#ff7a2a', cloud: 0.45, cloudCol: '#c86a8a', rim: '#ff8a4a', rimK: 0.55, mode: 0, tA: [1.02, 0.96, 0.82], tB: [0.8, 0.84, 0.74], spk: ['#c8702a', 0.35],
    ridge: { kind: 'hills', far: '#5a3a6a', near: '#3e3448', h: 12 }, far: 3, fly: [14, 1.0, 0.42, 0.08] },
  graveyard: { ru: 'Кладбище', sky: ['#0e1030', '#2c2c5a', '#5a5478'], fog: '#3a3c62', fogNear: 20, fogFar: 76, stars: 0.9, ground: ['#34503a', '#4a6446'], path: '#6a6458', amp: 0.5, hemi: ['#a8b4ff', '#2a2840', 2.8], sun: ['#c0c8ff', 2.0],
    props: [['pebbles', 3, 34], ['grass', 3, 90], ['grass', 2, 30], ['tomb', 0, 9], ['tomb', 1, 7], ['cross', 0, 10], ['cross', 1, 9], ['dead', 0, 10], ['lantern', 0, 6], ['bush', 3, 6], ['moss', 0, 6], ['bones', 0, 2], ['stump', 0, 2], ['rock', 2, 4],
      ['cross', 1, 3, 1], ['tomb', 1, 2, 1], ['bones', 0, 2, 1]],
    water: 'none', walls: 'none', sunDir: [-0.42, 0.2, -0.88], sunI: 0, sunCol: '#dfe4ff', cloud: 0.35, cloudCol: '#5a5a8a', rim: '#8aa0ff', rimK: 0.6, mode: 0, tA: [0.82, 0.9, 1.0], tB: [0.7, 0.8, 0.9], spk: ['#8a8aa8', 0.4],
    ridge: { kind: 'pines', far: '#262a48', near: '#1c2236', h: 12 }, far: 3, moon: 1, fly: [18, 0.45, 1.0, 0.75], mist: [30, '#5a6488'] },
  ruins: { ru: 'Руины', sky: ['#3a78d0', '#a8c8e4', '#f0dcc0'], fog: '#d0d0c4', fogNear: 40, fogFar: 112, stars: 0, ground: ['#5a9a40', '#80b050'], path: '#c8b48a', amp: 0.8, hemi: ['#fff4e0', '#6a6a4a', 2.6], sun: ['#ffe8c0', 2.4],
    props: [['pebbles', 2, 36], ['grass', 0, 120], ['grass', 2, 40], ['flower', 1, 12], ['flower', 3, 8], ['fern', 0, 10], ['moss', 0, 8], ['bush', 1, 8], ['tree', 0, 4], ['birch', 0, 2], ['column', 0, 6], ['column', 1, 4], ['column', 2, 4], ['wall', 0, 4], ['wall', 1, 3], ['rubble', 0, 8],
      ['rubble', 0, 4, 1], ['column', 1, 1, 1]],
    water: 'none', walls: 'none', sunDir: [0.4, 0.25, -0.88], sunI: 1.1, sunCol: '#ffd8a0', cloud: 0.45, cloudCol: '#ffffff', rim: '#ffe0b0', rimK: 0.35, mode: 0, tA: WARM, tB: [0.86, 0.94, 0.8], spk: ['#e8dcc0', 0.6],
    ridge: { kind: 'hills', far: '#8a9ab8', near: '#6a8a60', h: 15 }, far: 4 },
  mill: { ru: 'Мельница', sky: ['#3a74d0', '#a8cce8', '#ffe2b0'], fog: '#e8c8a8', fogNear: 34, fogFar: 105, stars: 0, ground: ['#7aa840', '#a8c050'], path: '#c8a070', amp: 0.45, hemi: ['#fff0d8', '#7a6a4a', 2.6], sun: ['#ffd8a0', 2.5],
    props: [['pebbles', 1, 30], ['grass', 0, 90], ['grass', 2, 40], ['wheat', 0, 8], ['wheat', 1, 6], ['flower', 1, 12], ['flower', 0, 8], ['hay', 0, 5], ['fence', 0, 5], ['tree', 0, 3], ['bush', 0, 6], ['scarecrow', 1, 1], ['barrel', 0, 2], ['crate', 0, 2],
      ['wheat', 0, 6, 1], ['hay', 0, 1, 1]],
    water: 'none', walls: 'none', sunDir: [0.3, 0.18, -0.93], sunI: 1.25, sunCol: '#ffc070', cloud: 0.35, cloudCol: '#ffffff', rim: '#ffd090', rimK: 0.45, mode: 0, tA: [1.12, 1.04, 0.8], tB: [0.96, 0.98, 0.78], spk: ['#ffe890', 0.7],
    ridge: { kind: 'hills', far: '#a88aa0', near: '#8a9a60', h: 13 }, far: 3 },
  deadtree: { ru: 'Сухое дерево', sky: ['#2a2448', '#7a5a7a', '#d8a080'], fog: '#7a5e72', fogNear: 30, fogFar: 96, stars: 0.3, ground: ['#5e5236', '#7a6a44'], path: '#9a8060', amp: 0.7, hemi: ['#ffd8c8', '#4a3a3a', 2.5], sun: ['#ffb890', 2.2],
    props: [['pebbles', 1, 30], ['dry', 0, 26], ['grass', 2, 30], ['shrub', 0, 10], ['dead', 0, 3], ['rock', 1, 8], ['boulder', 1, 2], ['scree', 1, 10], ['bones', 0, 3], ['stump', 0, 3], ['tumble', 0, 3], ['fence', 1, 2],
      ['dry', 0, 10, 1], ['scree', 1, 6, 1], ['bones', 0, 1, 1]],
    water: 'none', walls: 'none', sunDir: [-0.25, 0.12, -0.96], sunI: 1.2, sunCol: '#ff9a6a', cloud: 0.6, cloudCol: '#b08090', rim: '#ffa080', rimK: 0.5, mode: 0, tA: [0.98, 0.9, 0.82], tB: [0.84, 0.8, 0.78], spk: ['#a89070', 0.35],
    ridge: { kind: 'hills', far: '#5a4a6a', near: '#5a4a48', h: 14 }, far: 4, fly: [10, 0.6, 0.85, 1.0], mist: [10, '#6a5070'] },
  village: { ru: 'Заброшенная деревня', sky: ['#3a4a6a', '#8a9aa8', '#c8c0b0'], fog: '#9aa0a0', fogNear: 22, fogFar: 82, stars: 0, ground: ['#4a7a3a', '#62904a'], path: '#8a7a5a', amp: 0.6, hemi: ['#f0f0e0', '#4a4a3a', 2.5], sun: ['#ffe8d0', 2.1],
    props: [['pebbles', 0, 30], ['grass', 3, 120], ['grass', 0, 50], ['fern', 0, 16], ['bush', 3, 9], ['bush', 1, 5], ['tree', 3, 3], ['dead', 0, 3], ['fence', 1, 8], ['moss', 0, 8], ['stump', 0, 3], ['barrel', 0, 3], ['crate', 0, 3], ['fallen', 0, 2], ['flower', 3, 8],
      ['fence', 1, 3, 1], ['grass', 3, 20, 1], ['bush', 3, 3, 1], ['fern', 0, 6, 1], ['fallen', 0, 1, 1]],
    water: 'none', walls: 'none', sunDir: [-0.35, 0.22, -0.9], sunI: 0.6, sunCol: '#ffe0c0', cloud: 0.75, cloudCol: '#c0c4c8', rim: '#c8d0e0', rimK: 0.3, mode: 0, tA: [0.92, 1.0, 0.84], tB: [0.76, 0.88, 0.78], spk: ['#8a9a60', 0.5],
    ridge: { kind: 'pines', far: '#4a5a6a', near: '#3a5048', h: 13 }, far: 4 },
};

function rng(seed: number) { let a = seed >>> 0 || 1; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const K = (2 * Math.PI) / P;

export type TerrainMode = 'path' | 'clearing';
const TALL = new Set<PropKind>(['tree', 'pine', 'snowpine', 'birch', 'willow', 'cliff', 'mound', 'pillar', 'spire', 'support', 'ruin', 'boulder', 'menhir', 'dolmen', 'dead',
  'scarecrow', 'corn', 'column', 'wall', 'hut']);
/** small ground props (scaled 0.8–1.5, may come close to the road) */
const SMALL = new Set<PropKind>(['scree', 'shrub', 'ribs', 'grass', 'pebbles', 'dry', 'snowtuft', 'flower', 'lily', 'fern', 'moss', 'mushroom', 'agave', 'pumpkin', 'vine', 'wheat']);
/** set dressing that may frame the arena a little closer than the 13 m of the rest (ruins, graves, village debris) */
const NEAR = new Set<PropKind>(['column', 'wall', 'rubble', 'cross', 'tomb', 'lantern', 'barrel', 'crate']);
/** props that turn their front (+z) to the camera, ± a little (faces, doors, inscriptions) */
const FACING = new Set<PropKind>(['scarecrow', 'cross', 'lantern', 'hut']);
const GROVE = new Set<PropKind>(['tree', 'pine', 'snowpine', 'birch', 'willow', 'bush', 'berry', 'fern', 'mushroom', 'moss', 'stump', 'fallen', 'boulder']);
const SHADOW_R: Partial<Record<PropKind, number>> = { tree: 1.15, pine: 1.0, snowpine: 1.0, birch: 0.8, willow: 1.4, bush: 0.65, berry: 0.55, rock: 0.62, boulder: 1.3, pillar: 0.55, dead: 0.5, stone: 0.5, menhir: 0.6, cactus: 0.4, ruin: 1.8, spire: 1.7,
  fallen: 0.9, sandrock: 0.85, arch: 2.6, slab: 0.8, stump: 0.45, tomb: 0.5, barrel: 0.45, crate: 0.5, mushroom: 0.28, drift: 0.9, ice: 0.5, agave: 0.5, dolmen: 1.5, brazier: 0.4,
  pumpkin: 0.42, corn: 0.55, scarecrow: 0.45, cross: 0.35, lantern: 0.25, column: 0.6, wall: 1.5, rubble: 0.7, hay: 0.8, hut: 2.3 };
const GLOW: Partial<Record<PropKind, (pal: number) => [number, number, number, number, number, number, number]>> = {   // y, size, r, g, b, flicker, speed
  torch: () => [1.72, 2.6, 1.0, 0.55, 0.2, 0.22, 9], brazier: () => [1.5, 3.4, 1.0, 0.55, 0.18, 0.2, 8], support: () => [2.62, 2.2, 1.0, 0.7, 0.3, 0.1, 5],
  crystal: (pal) => [0.55, 2.4, ...([[0.25, 0.8, 1.0], [1.0, 0.3, 0.9], [0.4, 1.0, 0.4], [1.0, 0.8, 0.3]][pal % 4] as [number, number, number]), 0.12, 2.2],
  pumpkin: (pal) => (pal % 3 === 2 ? [0.42, 2.6, 1.0, 0.5, 0.1, 0.28, 7] : [0, 0, 0, 0, 0, 0, 0]), lantern: () => [0.96, 1.9, 1.0, 0.72, 0.32, 0.2, 6],
  mushroom: (pal) => (pal >= 2 ? [0.3, 1.0, ...([[0.6, 0.3, 1.0], [0.2, 0.9, 0.8]][pal - 2] as [number, number, number]).map((v) => v * 0.8) as [number, number, number], 0.2, 1.5] : [0, 0, 0, 0, 0, 0, 0]),
};

export class Terrain {
  readonly root = new THREE.Group();
  readonly spec: BiomeSpec;
  private scrollRoot = new THREE.Group();
  private disposables: { dispose(): void }[] = [];
  private hemi: THREE.HemisphereLight;
  private sun: THREE.DirectionalLight;
  private rimL: THREE.DirectionalLight;
  private fill: THREE.PointLight | null = null;
  private waterMesh: THREE.Mesh | null = null;
  private night = false;
  /** colour of kicked-up dust (ground tone, lightened) */
  readonly dust = new THREE.Color();
  private q: number;
  private halos: number[] = [];   // x,y,z,size,r,g,b,flicker,speed
  private shadowList: number[] = [];   // x,z,radius
  private beams: THREE.InstancedMesh | null = null;
  /** windmill sails (mill): turned about each hub's facing axis in update() */
  private sails: { im: THREE.InstancedMesh; hubs: Float32Array; yaw: THREE.Quaternion[]; sc: number[]; speed: number } | null = null;
  private readonly _m4 = new THREE.Matrix4(); private readonly _q4 = new THREE.Quaternion(); private readonly _q5 = new THREE.Quaternion(); private readonly _v4 = new THREE.Vector3(); private readonly _s4 = new THREE.Vector3();
  /** a river along x behind the action (river, falls, the bridge arena) */
  private get parallel(): boolean { const w = this.spec.water; return w === 'river' || w === 'falls' || (w === 'bridge' && this.mode === 'clearing'); }
  private get closed(): boolean { return !!this.spec.shell && this.spec.shell !== 'gorge'; }

  constructor(private mats: ExpMats, readonly biome: BiomeId, readonly mode: TerrainMode, o: { night?: boolean; seed?: number; quality?: number } = {}) {
    this.spec = BIOMES[biome] || BIOMES.meadow;
    this.root.name = `exp-terrain-${biome}-${mode}`;
    this.night = !!o.night;
    this.q = o.quality ?? 2;
    const S = this.spec;
    this.dust.set(S.path).lerp(new THREE.Color('#ffffff'), 0.25);
    this.root.add(this.scrollRoot);
    // sky dome
    const sky = new THREE.Mesh(new THREE.SphereGeometry(150, 32, 16), mats.sky);
    sky.frustumCulled = false; sky.renderOrder = -10; sky.name = 'exp-sky';
    this.disposables.push(sky.geometry);
    this.root.add(sky);
    // lights: key (front-left, high), rim (from the sky sun / moon behind the action), fill (hemisphere)
    this.hemi = new THREE.HemisphereLight(S.hemi[0], S.hemi[1], S.hemi[2] * (S.walls === 'cave' ? 0.8 : 0.62));
    this.sun = new THREE.DirectionalLight(S.sun[0], S.sun[1] * 1.4);
    this.sun.position.set(-12, 30, 18); this.sun.target.position.set(0, 0, 0);
    this.rimL = new THREE.DirectionalLight(S.sunCol, 0.9);
    this.rimL.position.set(S.sunDir[0] * 30, Math.max(8, S.sunDir[1] * 30 + 6), S.sunDir[2] * 30); this.rimL.target.position.set(0, 0, 0);
    this.root.add(this.hemi, this.sun, this.sun.target, this.rimL, this.rimL.target);
    if (this.night || S.walls === 'cave') {
      this.fill = new THREE.PointLight(this.night ? '#ff9a4a' : S.shell === 'cave' ? '#9ab0ff' : '#ffcf8a', this.night ? 30 : 22, 24, 1.6);
      this.fill.position.set(0, 2.4, 0);
      this.root.add(this.fill);
      if (S.walls === 'cave' && !this.night) {   // a second, weaker lamp on the left: the walls on that side no longer sink to black
        const f2 = new THREE.PointLight(S.shell === 'cave' ? '#8aa0ff' : '#ffb87a', 20, 24, 1.6);
        f2.position.set(-10.5, 3, 1.5); this.root.add(f2);
      }
    }
    const seed = o.seed ?? 7;
    this.ground(seed);
    this.enclosure(seed);
    this.ridges(seed);
    this.water();
    this.landmarks(seed);
    this.props(seed);
    this.shadowMesh();
    this.haloMesh(seed);
    this.shafts(seed);
  }

  /**
   * The day / night cycle (src/world/daynight.ts): an open-sky daytime biome follows the user's clock — its own palette
   * by day, the generic night (the rest-stop look) at night, a warm tint at dawn / dusk. Biomes with their own fixed
   * mood (moonlit graveyard, the Halloween dusk, starry gate / dead tree, caves, mines, dungeons) and the rest-stop night
   * are not cycled.
   */
  get clocked(): boolean { return !this.night && clockable(this.spec); }
  private dnV = -1;
  private sceneRef: THREE.Scene | null = null;
  private ownFog: THREE.Fog | null = null;
  private ownBg: THREE.Color | null = null;
  private readonly _ca = new THREE.Color();
  private readonly _cb = new THREE.Color();
  private readonly _tw = new THREE.Color();
  private static readonly NIGHT = { top: new THREE.Color('#0a0a26'), mid: new THREE.Color('#241e4c'), low: new THREE.Color('#4a3a5c'), cloud: new THREE.Color('#4a4a7a'),
    sun: new THREE.Color('#c8d0ff'), fog: new THREE.Color('#2a2450'), hemi: new THREE.Color('#8a9aff'), key: new THREE.Color('#a8b0ff'), rimL: new THREE.Color('#8aa0ff'),
    rim: new THREE.Color('#7a8cff'), water: new THREE.Color('#3a3a6a'), dawn: new THREE.Color('#ffb890'), dusk: new THREE.Color('#ff9a62') };
  /** Night amount 0…1 and twilight 0…1 of this terrain now. */
  private dnK(): [number, number] {
    if (this.night) return [1, 0];
    if (!this.clocked) return [0, 0];
    // a day-built terrain only dims towards the dusk (its ridges / ground are baked by day); the full night is a night
    // build (clockNight at the set change) with the tuned rest-stop look
    return [Math.min(0.4, DN.night * 0.5 + 0.3 * DN.tw), DN.tw];
  }
  /** a := lerp(day, night, k), then towards the twilight colour by w */
  private lc(out: THREE.Color, day: string | THREE.Color, night: THREE.Color, k: number, w = 0): THREE.Color {
    if (typeof day === 'string') out.set(day); else out.copy(day);
    out.lerp(night, k);
    if (w > 0) out.lerp(this._tw, w);
    return out;
  }

  /** Colours for scene.background / fog, the sky + material uniforms (applied by the scene every set change). */
  apply(scene: THREE.Scene): void {
    this.sceneRef = scene;
    if (this.clocked) tickDayNight();
    this.dnV = DN.version;
    this.ownBg = new THREE.Color(); this.ownFog = new THREE.Fog(this.ownBg.getHex(), 10, 100);
    scene.background = this.ownBg; scene.fog = this.ownFog;
    this.applyLook();
  }
  /** Re-apply when the day / night state changed (called by update; mutates only this terrain's own fog / background). */
  private applyLook(): void {
    const S = this.spec, m = this.mats.sky.uniforms, NI = Terrain.NIGHT, [k, tw] = this.dnK();
    this._tw.copy(NI.dusk).lerp(NI.dawn, this.clocked ? DN.am : 0);
    this.lc(m.uTop.value, S.sky[0], NI.top, k, tw * 0.1); this.lc(m.uMid.value, S.sky[1], NI.mid, k, tw * 0.25); this.lc(m.uLow.value, S.sky[2], NI.low, k, tw * 0.5);
    m.uStars.value = S.stars + (1 - S.stars) * k * k; m.uSun.value = S.sunI * (1 - k); m.uMoon.value = (S.moon ?? 0) + (1 - (S.moon ?? 0)) * k * k;
    m.uCloud.value = S.cloud + (0.25 - S.cloud) * k; this.lc(m.uCloudCol.value, S.cloudCol, NI.cloud, k, tw * 0.35); this.lc(m.uSunCol.value, S.sunCol, NI.sun, k, tw * 0.5);
    m.uSunDir.value.set(S.sunDir[0], S.sunDir[1], S.sunDir[2]).normalize();
    if (this.ownBg && this.ownFog) {
      this.lc(this.ownFog.color, S.fog, NI.fog, k, tw * 0.3); this.ownBg.copy(this.ownFog.color);
      this.ownFog.near = S.fogNear + (14 - S.fogNear) * k; this.ownFog.far = S.fogFar + (62 - S.fogFar) * k;
    }
    const hemiI0 = S.hemi[2] * (S.walls === 'cave' ? 0.8 : 0.62);
    this.hemi.intensity = hemiI0 + (0.9 - hemiI0) * k; this.lc(this.hemi.color, S.hemi[0], NI.hemi, k, tw * 0.25);
    this.sun.intensity = S.sun[1] * 1.4 + (0.5 - S.sun[1] * 1.4) * k; this.lc(this.sun.color, S.sun[0], NI.key, k, tw * 0.45);
    this.lc(this.rimL.color, S.sunCol, NI.rimL, k, tw * 0.3);
    const rimI0 = S.walls === 'cave' ? 0.7 : 0.5 + 0.6 * Math.min(1.3, S.sunI);
    this.rimL.intensity = rimI0 + (1.2 - rimI0) * k;
    // rim colour of the cel material, ground tints, water
    this.lc(this.mats.rim.value, S.rim, NI.rim, k).multiplyScalar(S.rimK + (0.5 - S.rimK) * k);
    const gu = this.mats.groundU;
    gu.uMode.value = S.mode; gu.uSpk.value.set(S.spk[0]); gu.uSpkAmt.value = S.spk[1]; gu.uArena.value = this.mode === 'clearing' ? 1 : 0; gu.uCloudSh.value = S.shell ? 0 : S.cloud * 0.34 * (1 - k); gu.uDetail.value = this.q <= 0 ? 0.5 : 1;
    // a clocked night has no campfire fill and day-baked ridges / ground: darken them by the night amount instead
    const ck = this.clocked ? k : 0;
    gu.uTA.value.setRGB(S.tA[0], S.tA[1], S.tA[2]).multiplyScalar((1 - 0.1 * k) * (1 - 0.3 * ck)); gu.uTB.value.setRGB(S.tB[0], S.tB[1], S.tB[2]).multiplyScalar((1 - 0.2 * k) * (1 - 0.3 * ck));
    this.mats.ridge.color.setScalar(1 - 0.5 * ck);
    const w = this.mats.water.uniforms, W = S.water;
    this.lc(w.uSky.value, S.sky[1], NI.water, k); this.lc(w.uSunCol.value, S.sunCol, NI.sun, k); w.uSunDir.value.set(S.sunDir[0], S.sunDir[1], S.sunDir[2]).normalize();
    if (W === 'swamp') { w.uShallow.value.set('#5a7a48'); w.uDeep.value.set('#2a3e30'); w.uOpacity.value = 0.94; w.uFoam.value = 0; w.uScum.value = 1; w.uFlow.value = 0.03; }
    else {
      const warm = W === 'bridge';
      w.uShallow.value.set(warm ? '#5cb4cc' : '#40c0e4'); w.uDeep.value.set(warm ? '#256a94' : W === 'falls' ? '#1a74b8' : '#1f6aaa'); w.uOpacity.value = 0.9;
      w.uFoam.value = W === 'bridge' && this.mode === 'path' ? 0 : 1; w.uScum.value = 0; w.uFlow.value = 0.45;
    }
    if (k > 0) { w.uShallow.value.multiplyScalar(1 - 0.65 * k); w.uDeep.value.multiplyScalar(1 - 0.7 * k); }
    const bm = this.mats.beam.uniforms.uCol.value;
    if (S.shell === 'gorge') bm.set(0.05, 0.04, 0.02); else if (S.shell === 'cave') bm.set(0.1, 0.14, 0.3); else if (this.biome === 'forest') bm.set(0.15, 0.14, 0.07); else bm.set(0.16, 0.14, 0.08);
    if (this.clocked && k > 0) bm.multiplyScalar(1 - k);   // no sun shafts at night (the rest-stop night keeps its own)
  }

  /** Ground height (m). Periodic in x; flat where the action is. */
  heightAt(x: number, z: number): number {
    const S = this.spec;
    let h = S.amp * (0.9 * Math.sin(K * x + 0.7) * Math.sin(z * 0.21 + 1.3) + 0.55 * Math.sin(2 * K * x + 2.1) * Math.cos(z * 0.37) + 0.3 * Math.sin(5 * K * x + z * 0.5));
    const az = Math.abs(z);
    let flat: number;
    if (this.mode === 'path') flat = smooth(3, 8, az);
    else { const r = Math.hypot(x, z * 1.15); flat = smooth(10, 18, r); }
    h *= flat;
    if (S.far) {
      const f = smooth(this.mode === 'path' ? 20 : 24, 62, az);
      h += f * S.far * (0.55 + 0.45 * Math.sin(K * 2 * x + z * 0.06 + 1.1) + 0.28 * Math.sin(K * 5 * x - z * 0.04) + 0.2 * Math.sin(K * 3 * x + 0.5));
      if (S.mode === 2 && !S.shell) h += f * 1.4 * Math.abs(Math.sin(K * 4 * x + z * 0.12));   // dune crests
    }
    if (S.walls === 'cave') h += Math.max(0, az - (this.mode === 'path' ? 9 : 12)) * 0.32;
    if (S.walls === 'gorge') h += Math.max(0, az - (this.mode === 'path' ? 8 : 12)) * 0.6;
    if (this.parallel && z < -6 && z > -15) h = Math.min(h, -0.7 * smooth(-6, -8, z) * smooth(-15, -13, z) + h * (1 - smooth(-6, -8, z) * smooth(-15, -13, z)));
    if (S.water === 'bridge' && this.mode === 'path') { const xm = mod(x - 14, P); const d = Math.min(xm, P - xm); h -= 1.6 * (1 - smooth(3, 5.5, d)); }
    if (S.water === 'falls') { const d = Math.hypot((x - 6) / 1.05, (z + 19.4) / 0.8); h = Math.min(h, -0.55 + 0.9 * smooth(4.8, 8.6, d)); }
    if (S.water === 'swamp') {
      const pool = Math.sin(K * 3 * x + z * 0.4) * Math.sin(K * 2 * x - z * 0.31 + 1) + 0.4 * Math.sin(K * 5 * x + z * 0.7);
      const keep = this.mode === 'path' ? smooth(2.2, 4.5, az) : smooth(8, 12, Math.hypot(x, z * 1.15));
      h -= smooth(0.12, 0.5, pool) * 0.85 * keep;
    }
    return h;
  }
  /** Water surface at (x, z) or −Infinity. */
  waterAt(x: number, z: number): number {
    const S = this.spec;
    if (this.parallel && z < -7 && z > -14) return -0.25;
    if (S.water === 'bridge' && this.mode === 'path') { const xm = mod(x - 14, P); if (Math.min(xm, P - xm) < 3.5) return -0.6; }
    if (S.water === 'falls' && Math.hypot((x - 6) / 1.05, (z + 19.4) / 0.8) < 6.0) return -0.2;
    if (S.water === 'swamp' && this.heightAt(x, z) < -0.2) return -0.18;
    return -Infinity;
  }

  private ground(seed: number) {
    const S = this.spec;
    const NX = 72;
    const zs: number[] = [];
    const zMax = this.closed || S.shell === 'gorge' ? 26 : 100;
    for (let z = -30; z <= 30.01; ) { zs.push(z); z += Math.abs(z) < 12 ? 1.5 : 2.5; }
    for (const e of [36, 44, 54, 66, 80, 100]) if (e <= zMax) { zs.unshift(-e); zs.push(e); }
    if (zMax < 30) { while (zs[0] < -zMax) zs.shift(); while (zs[zs.length - 1] > zMax) zs.pop(); }
    const NZ = zs.length;
    const n = (NX + 1) * NZ;
    const pos = new Float32Array(n * 3), col = new Float32Array(n * 3), mask = new Float32Array(n);
    const c0 = new THREE.Color(S.ground[0]), c1 = new THREE.Color(S.ground[1]), cp = new THREE.Color(S.path), c = new THREE.Color();
    const sand = new THREE.Color(S.water === 'swamp' ? '#5a5238' : '#c8b088'), rock = new THREE.Color(S.walls === 'cave' ? '#3a3448' : '#a8886a'), mud = new THREE.Color('#4a4030');
    const hsl = { h: 0, s: 0, l: 0 };
    let k = 0;
    for (let j = 0; j < NZ; j++) for (let i = 0; i <= NX; i++, k++) {
      const x = -SPAN + (i / NX) * SPAN * 2, z = zs[j];
      const h = this.heightAt(x, z);
      pos[k * 3] = x; pos[k * 3 + 1] = h; pos[k * 3 + 2] = z;
      const ii = mod(i, 24), nn = 0.5 + 0.5 * Math.sin(K * 7 * x + Math.sin(z * 0.7) * 2) * Math.sin(z * 1.1 + K * 3 * x);
      c.copy(c0).lerp(c1, nn * 0.8 + hash2(ii, j, seed) * 0.2);
      let pathK: number;
      if (this.mode === 'path') pathK = 1 - smooth(1.7, 2.7, Math.abs(z + Math.sin(x * K * 2) * 0.4));
      else pathK = (1 - smooth(6.5, 11, Math.hypot(x, z * 1.2))) * 0.62;
      if (S.walls === 'cave' || S.walls === 'gorge') pathK *= 0.75;
      c.lerp(cp, pathK);
      const wet = this.waterAt(x, z) > -Infinity || h < -0.3;
      if (wet) c.lerp(S.water === 'swamp' ? mud : sand, S.water === 'swamp' ? 0.75 : 0.6);
      else if (S.water === 'swamp' && h < 0.05) c.lerp(mud, 0.45);
      if (S.water === 'river' || S.water === 'falls' || (S.water === 'bridge' && this.mode === 'clearing')) { const bd = Math.abs(z + 10.5); if (bd > 4.2 && bd < 6) c.lerp(sand, 0.35 * smooth(6, 4.2, bd)); }
      if ((S.walls === 'gorge' || S.walls === 'cave') && h > 1.2) c.lerp(rock, Math.min(1, (h - 1.2) / 2.5));
      c.getHSL(hsl); c.setHSL(hsl.h, Math.min(1, hsl.s * 1.35), hsl.l * 0.95);
      col[k * 3] = c.r; col[k * 3 + 1] = c.g; col[k * 3 + 2] = c.b;
      mask[k] = pathK;
    }
    const idx: number[] = [];
    for (let j = 0; j < NZ - 1; j++) for (let i = 0; i < NX; i++) {
      const a = j * (NX + 1) + i, b = a + 1, d = a + NX + 1, e = d + 1;
      idx.push(a, d, b, b, d, e);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setAttribute('aMask', new THREE.BufferAttribute(mask, 1));
    g.setIndex(idx);
    g.computeVertexNormals();
    g.computeBoundingSphere();
    const mesh = new THREE.Mesh(g, this.mats.ground);
    mesh.name = 'exp-ground'; mesh.frustumCulled = false;
    this.disposables.push(g);
    this.scrollRoot.add(mesh);
  }

  /** Rock / stone shells: tunnels along the road, round chambers for arenas, canyon walls. */
  private enclosure(seed: number) {
    const S = this.spec;
    if (!S.shell) return;
    const cfgs: Record<string, ShellCfg> = {
      cave: { kind: 'cave', base: '#4a4262', hi: '#7a6e9c', band: '#2e2a48', ceil: '#2a2442', W: 15, H: 8.5, seed },
      mine: { kind: 'mine', base: '#6a5648', hi: '#9a8268', band: '#4a3a30', ceil: '#3e3030', W: 14, H: 7.5, seed },
      dungeon: { kind: 'dungeon', base: '#6a6478', hi: '#9a94aa', band: '#4a4458', ceil: '#52485e', W: 9.5, H: 9, seed },
      gorge: { kind: 'gorge', base: '#7e3e3c', hi: '#c47a5c', band: '#4a2434', ceil: '#9a6a62', W: 11, H: 15, seed },
    };
    const cfg = cfgs[S.shell];
    const seg = this.q <= 0 ? 3 : 2;
    let geo: THREE.BufferGeometry;
    if (this.mode === 'path') geo = tunnelGeo(cfg, SPAN * 2, seg);
    else geo = chamberGeo(cfg, cfg.kind === 'dungeon' ? 15.5 : cfg.kind === 'gorge' ? 18 : 18.5);
    const m = new THREE.Mesh(geo, this.mats.tint);
    m.name = 'exp-shell'; m.frustumCulled = false;
    this.disposables.push(geo);
    (this.mode === 'path' ? this.scrollRoot : this.root).add(m);
  }

  /** Two rings of distant hills / peaks / mesas, hazed toward the fog colour. */
  private ridges(seed: number) {
    const R = this.spec.ridge;
    if (!R || this.night && false) return;
    const fog = this.night ? '#2a2450' : this.spec.fog;
    const segs = this.q <= 0 ? 90 : 160;
    const mk = (r: number, base: number, amp: number, colr: string, haze: number, s: number) => {
      const peak = new THREE.Color(colr).lerp(new THREE.Color('#ffffff'), R.snow ? 0.15 : 0.25);
      const g = ridgeGeo({ kind: R.kind, r, base, amp, far: colr, peak: '#' + peak.getHexString(), fog, haze, seed: s + (seed % 7), snow: R.snow, segs });
      const m = new THREE.Mesh(g, this.mats.ridge);
      m.renderOrder = -9; m.frustumCulled = false; m.name = 'exp-ridge';
      this.disposables.push(g);
      this.root.add(m);
    };
    const night = this.night ? 0.55 : 0;
    const dim = (c: string) => this.night ? '#' + new THREE.Color(c).multiplyScalar(0.35 + night * 0).getHexString() : c;
    mk(128, 2, R.h * 1.0, dim(R.far), 0.42, 1);
    mk(100, 0, R.h * 0.62, dim(R.near), 0.2, 4);
  }

  private water() {
    const S = this.spec;
    if (S.water === 'none') return;
    if (this.parallel || S.water === 'swamp') {
      const geo = S.water === 'swamp' ? new THREE.PlaneGeometry(SPAN * 2, ZW * 2) : new THREE.PlaneGeometry(SPAN * 2, 8.5);
      geo.rotateX(-Math.PI / 2);
      const m = new THREE.Mesh(geo, this.mats.water);
      m.position.set(0, S.water === 'swamp' ? -0.18 : -0.25, S.water === 'swamp' ? 0 : -10.5);
      m.name = 'exp-water'; m.renderOrder = 1;
      this.disposables.push(geo); this.scrollRoot.add(m); this.waterMesh = m;
    }
    if (S.water === 'bridge') {
      const geo = new THREE.PlaneGeometry(7.5, this.mode === 'path' ? ZW * 2 : 0.01); geo.rotateX(-Math.PI / 2);
      const water = new THREE.InstancedMesh(geo, this.mats.water, 4);
      const b = new GB();
      for (let i = 0; i < 11; i++) b.add(new THREE.BoxGeometry(0.78, 0.14, 3.5), i % 2 ? '#a07848' : '#8a6a40', T(-4.4 + i * 0.88, 0 + Math.sin(i * 0.3) * 0.0, 0, 0, 0, Math.sin(i * 1.7) * 0.03));
      for (const sd of [-1, 1]) {
        b.add(new THREE.BoxGeometry(9.4, 0.14, 0.14), '#7a5436', T(0, 0.9, sd * 1.7)); b.add(new THREE.BoxGeometry(9.4, 0.1, 0.1), '#7a5436', T(0, 0.45, sd * 1.7));
        for (let i = 0; i < 7; i++) b.add(new THREE.BoxGeometry(0.16, 1.15, 0.16), '#6a4a30', T(-4.5 + i * 1.5, 0.45, sd * 1.7));
        b.add(new THREE.BoxGeometry(0.4, 0.2, 0.4), '#5a3e28', T(-4.6, 1.3, sd * 1.7)); b.add(new THREE.BoxGeometry(0.4, 0.2, 0.4), '#5a3e28', T(4.6, 1.3, sd * 1.7));
        b.add(new THREE.CylinderGeometry(0.14, 0.17, 2.2, 6), '#5a3e28', T(-4.6, -0.5, sd * 1.7)); b.add(new THREE.CylinderGeometry(0.14, 0.17, 2.2, 6), '#5a3e28', T(4.6, -0.5, sd * 1.7));
      }
      for (const sd of [-0.9, 0.9]) b.add(new THREE.BoxGeometry(9.2, 0.2, 0.2), '#5a4028', T(0, -0.16, sd));
      const bridge = new THREE.InstancedMesh(b.build(), this.mats.tint, 4);
      const m = new THREE.Matrix4();
      if (this.mode === 'path') for (let k = 0; k < 4; k++) {
        const x = 14 + (k - 2) * P;
        m.makeTranslation(x, -0.6, 0); water.setMatrixAt(k, m);
        m.makeTranslation(x, -0.02, 0); bridge.setMatrixAt(k, m);
        for (const sd of [-1, 1]) for (const ex of [-4.6, 4.6]) this.halos.push(x + ex, 1.55, sd * 1.7, 1.5, 1.0, 0.7, 0.3, 0.1, 4);
      } else {
        water.count = 0; bridge.count = 1;
        m.makeRotationY(Math.PI / 2).setPosition(0, 0.05, -10.5); bridge.setMatrixAt(0, m);
        for (const sd of [-1, 1]) for (const ex of [-4.6, 4.6]) this.halos.push(sd * 1.7 * 1, 1.55, -10.5 - ex * sd * 1, 1.5, 1.0, 0.7, 0.3, 0.1, 4);
      }
      water.frustumCulled = false; bridge.frustumCulled = false; water.renderOrder = 1;
      this.disposables.push(geo, bridge.geometry, water, bridge);
      this.scrollRoot.add(water, bridge);
    }
  }

  /** Per-biome set dressing that is not scattered: the falls, the barrow + stone circle, the tower gate, the swamp causeway, the mine rails. */
  private landmarks(seed: number) {
    const S = this.spec, R = rng(seed * 7 + 3);
    const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, ry = 0, sc = 1, parent: THREE.Object3D = this.root, name = 'exp-landmark') => {
      const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.rotation.y = ry; m.scale.setScalar(sc); m.name = name; m.frustumCulled = false;
      this.disposables.push(geo); parent.add(m); return m;
    };
    const inst = (geo: THREE.BufferGeometry, mats: THREE.Matrix4[], parent: THREE.Object3D) => {
      const im = new THREE.InstancedMesh(geo, this.mats.tint, mats.length);
      mats.forEach((m, i) => im.setMatrixAt(i, m)); im.frustumCulled = false; im.name = 'exp-landmark';
      this.disposables.push(im); parent.add(im); return im;
    };
    if (S.water === 'falls') {
      const b = new GB();
      const rockA = ['#5e5870', '#a8a2bc'], rockB = ['#524c64', '#8e88a4'], warm = ['#6a5a58', '#b4a498'];
      const mass = (r: number, x: number, y: number, z: number, sx: number, sy: number, sz: number, c: string[], ry = 0.3) => b.addG(new THREE.DodecahedronGeometry(r, 0), c[0], c[1], T(x, y, z, 0.2, ry, 0.1, [sx, sy, sz]), 0, 16);
      mass(7.5, 2.5, 8, -33, 2.0, 1.5, 0.9, rockB, 0.1);                 // back wall behind the water
      mass(8, -13, 6, -28, 1.5, 1.4, 0.9, rockA); mass(8, 18, 5.5, -28, 1.4, 1.3, 0.9, warm, 0.6);
      mass(5, -5.8, 4, -23.5, 1.0, 1.5, 0.8, rockB, 0.7); mass(5, 9.8, 3.5, -23.5, 1.0, 1.3, 0.8, rockA, 0.2);
      mass(3.2, 2.5, 12.2, -27, 1.4, 0.45, 1.0, warm, 0.2);                // the lip the water leaves
      mass(3, -9.5, 1, -20, 1.4, 0.9, 1.0, rockA); mass(3, 14, 1, -20, 1.4, 0.9, 1.0, rockB);
      b.addG(new THREE.DodecahedronGeometry(7, 0), '#4f9a3a', '#88d058', T(-12, 13.2, -28, 0.1, 0.3, 0, [1.7, 0.35, 1.0]), 12, 14.5);
      b.addG(new THREE.DodecahedronGeometry(6, 0), '#4f9a3a', '#88d058', T(16, 12.2, -28, 0.1, 0.3, 0, [1.6, 0.35, 1.0]), 11, 13.5);
      b.addG(new THREE.DodecahedronGeometry(5, 0), '#4f9a3a', '#88d058', T(2.5, 17.6, -33, 0.1, 0.3, 0, [1.8, 0.3, 1.0]), 16, 18.5);
      for (let i = 0; i < 11; i++) { const a = -2.8 + i * 0.56; b.addG(new THREE.DodecahedronGeometry(0.5 + hash2(i, 1, seed) * 0.55, 0), '#4a4658', '#a8a2bc', T(2.5 + Math.sin(a) * 5.2, 0.05, -22.2 + Math.cos(a) * 1.6, 0.3, i, 0, [1.2, 0.7, 1]), 0, 0.9); }
      add(b.build(), this.mats.tint, 3.5, -0.3, 3);
      const fg = new THREE.PlaneGeometry(5.6, 12.4, 1, 1);
      const fm = new THREE.Mesh(fg, this.mats.fall); fm.position.set(6, 6.3, -22.6); fm.name = 'exp-fall'; fm.frustumCulled = false; fm.renderOrder = 2;
      this.disposables.push(fg); this.root.add(fm);
      const pg = new THREE.CircleGeometry(6.4, 28); pg.rotateX(-Math.PI / 2);
      const pm = new THREE.Mesh(pg, this.mats.pool); pm.position.set(6, -0.2, -19.4); pm.scale.set(1.05, 1, 0.8); pm.name = 'exp-pool'; pm.renderOrder = 1;
      this.disposables.push(pg); this.root.add(pm);
      this.halos.push(6, 0.9, -21, 7, 0.16, 0.22, 0.28, 0.12, 1.2);
      this.halos.push(6, 0.7, -21.6, 3.6, 0.26, 0.32, 0.36, 0.15, 1.7);   // spray at the foot + a pale veil on the sheet
    }
    if (S.water === 'swamp' && this.mode === 'path') {
      // plank causeway on the road
      const g = new GB();
      g.add(new THREE.BoxGeometry(1.0, 0.1, 2.6), '#6a5236', T(0, 0.04, 0)); g.add(new THREE.BoxGeometry(0.1, 0.14, 2.7), '#4a3826', T(-0.5, 0.06, 0)); g.add(new THREE.BoxGeometry(0.1, 0.14, 2.7), '#4a3826', T(0.5, 0.06, 0));
      const ms: THREE.Matrix4[] = [];
      for (let i = -66; i <= 66; i++) { const x = i * 1.08, zc = Math.sin(x * K * 2) * 0.4; if (hash2(i, 3, seed) > 0.96) continue; ms.push(T(x, this.heightAt(x, zc) + 0.02, zc, 0, (hash2(i, 5, seed) - 0.5) * 0.12, (hash2(i, 7, seed) - 0.5) * 0.04)); }
      inst(g.build(), ms, this.scrollRoot);
    }
    if (S.shell === 'mine' && this.mode === 'path') {
      // rails + sleepers along the road
      const g = new GB();
      g.add(new THREE.BoxGeometry(0.2, 0.08, 2.0), '#5a4028', T(0, 0.03, 0));
      g.add(new THREE.BoxGeometry(1.1, 0.06, 0.07), '#b8b0b8', T(0, 0.1, -0.35)); g.add(new THREE.BoxGeometry(1.1, 0.06, 0.07), '#b8b0b8', T(0, 0.1, 0.35));
      const g2 = new GB(); g2.add(new THREE.BoxGeometry(1.1, 0.06, 0.07), '#b8b0b8', T(0, 0.1, -0.35)); g2.add(new THREE.BoxGeometry(1.1, 0.06, 0.07), '#b8b0b8', T(0, 0.1, 0.35));
      const ms: THREE.Matrix4[] = [];
      const rz = (x: number) => Math.sin(x * K * 2) * 0.4;
      for (let x = -SPAN; x <= SPAN; x += 1.1) ms.push(T(x, this.heightAt(x, rz(x)) + 0.01, rz(x), 0, Math.atan2(rz(x + 0.5) - rz(x - 0.5), 1) * -1, 0));
      inst(g.build(), ms, this.scrollRoot);
      void g2;
    }
    if (S.shell === 'mine' && this.mode === 'clearing') {
      const g = new GB();
      for (const sd of [-1, 1]) { g.add(new THREE.BoxGeometry(0.3, 5.5, 0.3), '#7a5a36', T(sd * 7, 2.7, -12)); }
      g.add(new THREE.BoxGeometry(15, 0.4, 0.4), '#6a4a2c', T(0, 5.5, -12));
      for (const sd of [-1, 1]) this.halos.push(sd * 7, 4.8, -11.6, 3.0, 1.0, 0.6, 0.25, 0.2, 6);
      add(g.build(), this.mats.tint, 0, 0, 0);
    }
    if (this.biome === 'mound') {
      const barrow = propGeo('mound', 0);
      if (this.mode === 'clearing') {
        add(barrow, this.mats.tint, -3, -0.4, -23, Math.PI, 3.3);
        this.halos.push(-3, 1.7, -23 + 3.55 * 3.3 * 0 + 11.0, 3.4, 0.5, 0.7, 1.0, 0.18, 2.4);
        // ring of standing stones around the back of the arena
        const ms: THREE.Matrix4[] = [], gm = propGeo('menhir', 0);
        for (let i = 0; i < 10; i++) {
          const th = Math.PI * (0.12 + 0.76 * (i / 9)) + Math.PI, r = 17.5 + hash2(i, 2, seed) * 1.6;
          const x = Math.cos(th) * r, z = Math.sin(th) * r * 0.9;
          ms.push(T(x, this.heightAt(x, z) - 0.2, z, 0, th * 3, (hash2(i, 4, seed) - 0.5) * 0.14, 0.9 + hash2(i, 6, seed) * 0.8));
          this.shadowList.push(x + 0.3, z - 0.2, 0.7);
        }
        inst(gm, ms, this.root);
        add(propGeo('dolmen', 0), this.mats.tint, 14, this.heightAt(14, -10) - 0.1, -10, -0.5, 1.5);
        add(propGeo('dolmen', 0), this.mats.tint, -15, this.heightAt(-15, -9) - 0.1, -9, 0.6, 1.3);
      } else {
        // an avenue of standing stones along the road + a barrow in the distance (every tile)
        const ms: THREE.Matrix4[] = [], gm = propGeo('menhir', 1);
        for (let i = -12; i <= 12; i++) for (const sd of [-1, 1]) {
          if (hash2(i, sd, seed) < 0.3) continue;
          const x = i * 5.5 + hash2(i, 9, seed) * 1.2, z = sd * (7.5 + hash2(i, 11, seed) * 1.5);
          ms.push(T(x, this.heightAt(x, z) - 0.2, z, 0, hash2(i, 13, seed) * 6, (hash2(i, 4, seed) - 0.5) * 0.12, 0.7 + hash2(i, 6, seed) * 0.7));
          this.shadowList.push(x + 0.3, z - 0.2, 0.7);
        }
        inst(gm, ms, this.scrollRoot);
        const bm: THREE.Matrix4[] = [];
        for (let k = -1; k <= 1; k++) bm.push(T(-14 + k * P, -0.4, -27, 0, Math.PI, 0, 3.4));
        inst(barrow, bm, this.scrollRoot);
        for (let k = -1; k <= 1; k++) this.halos.push(-14 + k * P, 1.7, -27 + 11.8, 3.4, 0.5, 0.7, 1.0, 0.18, 2.4);
        const dm: THREE.Matrix4[] = [];
        for (let k = -1; k <= 1; k++) dm.push(T(10 + k * P, this.heightAt(10, -15) - 0.1, -15, 0.3, 0, 0, 1.4));
        inst(propGeo('dolmen', 0), dm, this.scrollRoot);
      }
    }
    if (this.biome === 'desert') {
      // wind-carved arches standing behind the action
      const a0 = propGeo('arch', 0), a1 = propGeo('arch', 1);
      if (this.mode === 'clearing') {
        add(a0, this.mats.tint, -19, this.heightAt(-19, -23) - 0.2, -23, 0.5, 1.5); add(a1, this.mats.tint, 24, this.heightAt(24, -30) - 0.2, -30, -0.3, 1.9);
        this.shadowList.push(-19, -23, 3.4, 24, -30, 4);
      } else {
        const m0: THREE.Matrix4[] = [], m1: THREE.Matrix4[] = [];
        for (let k = -1; k <= 1; k++) {
          m0.push(T(-11 + k * P, this.heightAt(-11, -19) - 0.2, -19, 0, 0.3, 0, 1.4)); m1.push(T(22 + k * P, this.heightAt(22, -28) - 0.2, -28, 0, -0.3, 0, 1.8));
          this.shadowList.push(-11 + k * P, -19, 3.2, 22 + k * P, -28, 3.8);
        }
        inst(a0, m0, this.scrollRoot); inst(a1, m1, this.scrollRoot);
      }
    }
    if (this.biome === 'gate') {
      const gb = new GB();
      const stone = ['#6a6078', '#aaa0b8'], dark = ['#4a4258', '#7a7090'];
      const tower = (x: number, h: number) => {
        gb.addG(new THREE.CylinderGeometry(2.1, 2.5, h, 10), stone[0], stone[1], T(x, h / 2 - 0.3, 0), 0, h);
        gb.addG(new THREE.CylinderGeometry(2.6, 2.2, 0.7, 10), dark[0], dark[1], T(x, h + 0.1, 0), h - 0.3, h + 0.5);
        for (let i = 0; i < 8; i++) { const a = i / 8 * Math.PI * 2; gb.add(new THREE.BoxGeometry(0.7, 0.8, 0.7), '#8a809c', T(x + Math.cos(a) * 2.3, h + 0.9, Math.sin(a) * 2.3, 0, -a, 0)); }
        gb.addG(new THREE.ConeGeometry(2.4, 3.2, 10), '#7a2a4a', '#c85a7a', T(x, h + 2.7, 0), h + 1.1, h + 4.3);
        for (let i = 0; i < 3; i++) gb.add(new THREE.BoxGeometry(0.35, 0.7, 0.2), '#14101c', T(x + (i - 1) * 0.0, 3 + i * 3.3, 2.15 - Math.abs(i - 1) * 0.05));
      };
      tower(-5.4, 11); tower(5.4, 11);
      gb.addG(new THREE.BoxGeometry(12.4, 3.4, 2.4), stone[0], stone[1], T(0, 8.7, 0), 7, 10.4);
      gb.add(new THREE.BoxGeometry(12.6, 0.5, 2.7), '#7e748f', T(0, 10.55, 0));
      for (let i = 0; i < 7; i++) gb.add(new THREE.BoxGeometry(1.1, 0.8, 0.8), '#8a809c', T(-5.4 + i * 1.8, 11.2, 0.9));
      // arch opening: dark slab + glowing rune ring
      gb.add(new THREE.BoxGeometry(5.2, 6.4, 0.5), '#0e0a16', T(0, 3.0, -0.2));
      gb.add(new THREE.CylinderGeometry(2.6, 2.6, 0.5, 14, 1, false, 0, Math.PI), '#0e0a16', T(0, 6.2, -0.2, Math.PI / 2, 0, 0));
      for (const sd of [-1, 1]) gb.addG(new THREE.BoxGeometry(0.7, 6.4, 0.9), stone[0], stone[1], T(sd * 3.1, 3.0, 0.1), 0, 6.4);
      gb.add(new THREE.BoxGeometry(6.9, 0.6, 0.9), '#8a809c', T(0, 6.4, 0.1)); gb.add(new THREE.BoxGeometry(3.4, 0.9, 0.9), '#9a90ac', T(0, 6.9, 0.1));
      const ring = new GB();
      ring.add(new THREE.TorusGeometry(1.7, 0.09, 6, 28), '#8affea', T(0, 4.2, 0.22)); ring.add(new THREE.TorusGeometry(1.2, 0.06, 6, 24), '#c88aff', T(0, 4.2, 0.22));
      for (let i = 0; i < 8; i++) { const a = i / 8 * Math.PI * 2; ring.add(new THREE.BoxGeometry(0.12, 0.3, 0.05), '#8affea', T(Math.cos(a) * 1.45, 4.2 + Math.sin(a) * 1.45, 0.22, 0, 0, a)); }
      const place = (px: number, pz: number, ry: number, parent: THREE.Object3D) => {
        const gg = add(gb.build(), this.mats.tint, px, 0, pz, ry, 1, parent);
        const rg = add(ring.build(), this.mats.glow, px, 0, pz, ry, 1, parent, 'exp-gate-rune');
        void gg; void rg;
      };
      // build twice (builders are consumed by build()): rebuild lazily for path copies
      if (this.mode === 'clearing') {
        place(0, -24, 0, this.root);
        this.halos.push(0, 4.2, -23.6, 6, 0.4, 1.0, 0.9, 0.15, 2.0, -9, 2.2, -21, 2.4, 1.0, 0.6, 0.25, 0.2, 8, 9, 2.2, -21, 2.4, 1.0, 0.6, 0.25, 0.2, 8);
        for (const sd of [-1, 1]) { const g2 = new GB(); g2.add(new THREE.CylinderGeometry(0.4, 0.5, 1.0, 8), '#4a3c42', T(0, 0.5, 0)); g2.add(new THREE.ConeGeometry(0.36, 0.7, 7), '#ff8a1a', T(0, 1.4, 0)); add(g2.build(), this.mats.tint, sd * 9, 0, -21); }
      } else {
        const bb = gb.build(), rb = ring.build();
        this.disposables.push(rb);
        for (let k = -1; k <= 1; k++) {
          const m = new THREE.Mesh(bb, this.mats.tint); m.position.set(14 + k * P, 0, -16); m.frustumCulled = false; m.name = 'exp-gate'; this.scrollRoot.add(m);
          const rm = new THREE.Mesh(rb, this.mats.glow); rm.position.set(14 + k * P, 0, -16); rm.name = 'exp-gate-rune'; this.scrollRoot.add(rm);
          this.halos.push(14 + k * P, 4.2, -15.6, 6, 0.4, 1.0, 0.9, 0.15, 2.0);
          for (const sd of [-1, 1]) this.halos.push(14 + k * P + sd * 9, 2.2, -13, 2.4, 1.0, 0.6, 0.25, 0.2, 8);
          this.shadowList.push(14 + k * P - 5.4, -15.6, 2.8, 14 + k * P + 5.4, -15.6, 2.8);
        }
        this.disposables.push(bb);
      }
    }
    /* ---- 31.10 biomes: planted rows and set pieces (always behind the action: |z| > 6 on the road, outside the arena) ---- */
    const path = this.mode === 'path';
    const qk = [0.45, 0.75, 1, 1.25][Math.max(0, Math.min(3, this.q))];
    const face = (x: number, z: number) => Math.atan2(-x, -z);   // turn a +z front toward the arena centre
    const field = (kind: PropKind, pal: number, zs: number[], step: number, keep: number, sc: [number, number], shadow = 0) => {
      const pts = rowPoints(zs, step, Math.min(1, keep * qk), seed * 3 + pal * 13 + zs.length);
      const ms: THREE.Matrix4[] = [];
      for (let i = 0; i < pts.length; i += 3) for (const dx of [-P, 0, P]) {
        const x = pts[i] + dx, z = pts[i + 1], r = pts[i + 2];
        if (x < -SPAN || x > SPAN || (!path && Math.hypot(x, z * 1.15) < 16)) continue;
        const s = sc[0] + (sc[1] - sc[0]) * r;
        ms.push(T(x, this.heightAt(x, z) - 0.04, z, 0, r * 6.283, 0, s));
        if (shadow && this.q > 0) this.shadowList.push(x, z, shadow * s);
      }
      if (ms.length) inst(propGeo(kind, pal), ms, this.scrollRoot);
    };
    /** set pieces: [x, z, ry, scale] — on the road every period (k = −1..1), in the arena once */
    const piece = (geo: THREE.BufferGeometry, at: readonly (readonly [number, number, number, number])[], shadow = 0, sink = 0.1) => {
      const ms: THREE.Matrix4[] = [];
      for (const [x0, z, ry, sc] of at) for (const k of path ? [-1, 0, 1] : [0]) {
        const x = x0 + k * P;
        ms.push(T(x, this.heightAt(x, z) - sink, z, 0, ry, 0, sc));
        if (shadow) this.shadowList.push(x, z, shadow * sc);
      }
      if (ms.length) inst(geo, ms, path ? this.scrollRoot : this.root);
      return ms;
    };
    const fwd = (x: number, z: number, ry: number, d: number): [number, number] => [x + Math.sin(ry) * d, z + Math.cos(ry) * d];
    if (this.biome === 'pumpkin') {
      const zs = path ? [-5.6, -8.2, -10.8, -13.4, -16] : [-14, -16.6, -19.2, -21.8, -24.4];
      // tilled ridges under the rows (6 m pieces follow the ground), then vines and pumpkins on them
      const fm: THREE.Matrix4[] = [];
      for (const z of zs) for (let x = -SPAN + 3; x < SPAN; x += 6) { if (!path && Math.hypot(x, z * 1.15) < 16) continue; fm.push(T(x, this.heightAt(x, z) - 0.02, z, 0, 0, Math.atan2(this.heightAt(x + 3, z) - this.heightAt(x - 3, z), 6))); }
      if (fm.length) inst(propGeo('furrow', 0), fm, this.scrollRoot);
      field('vine', 0, zs.map((z) => z + 0.35), 3.0, 0.3, [0.9, 1.3]);
      field('pumpkin', 0, zs, 2.6, 0.38, [0.85, 1.35], 0.42);
      field('pumpkin', 1, zs.map((z) => z - 0.4), 3.4, 0.3, [0.9, 1.3]);
      const sx: [number, number, number, number][] = path ? [[-4, -7, 0.65, 1.5], [20, -9.5, 0.5, 1.35]] : [[-13, -15.5, face(-13, -15.5), 1.5], [14.5, -19, face(14.5, -19), 1.35]];
      piece(propGeo('scarecrow', 0), sx, 0.5, 0.05);
      const cx: [number, number, number, number][] = path ? [[15, -9.5, 0.4, 1.1], [19, -10.5, 1.3, 0.95]] : [[16, -14, 0.3, 1.1], [19.5, -12.2, 1.4, 0.95]];
      piece(propGeo('corn', 0), cx, 0.55, 0.05);
    }
    if (this.biome === 'graveyard') {
      const fence = propGeo('ironfence', 0), ms: THREE.Matrix4[] = [];
      if (path) {
        for (let i = -30; i <= 30; i++) {
          const x = i * 2.4; if (Math.abs(x) > SPAN) continue;
          if (hash2(mod(i, 20), 3, seed) < 0.16) continue;   // fallen sections (periodic: 20 sections per period)
          ms.push(T(x, this.heightAt(x, -6.9) - 0.06, -6.9, 0, 0, (hash2(mod(i, 20), 5, seed) - 0.5) * 0.06));
        }
      } else {
        const R0 = 17.6, dt = 2.4 / R0;
        for (let t = Math.PI + 0.3; t < 2 * Math.PI - 0.3; t += dt) {
          const x = Math.cos(t) * R0, z = Math.sin(t) * R0 * 0.92, tx = -Math.sin(t), tz = Math.cos(t) * 0.92;
          if (hash2(Math.round(t * 10), 3, seed) < 0.14) continue;
          ms.push(T(x, this.heightAt(x, z) - 0.06, z, 0, Math.atan2(-tz, tx), (hash2(Math.round(t * 10), 5, seed) - 0.5) * 0.06));
        }
      }
      if (ms.length) inst(fence, ms, this.scrollRoot);
      const at: [number, number, number, number][] = path ? [[-12, -17, 0.15, 1]] : [[7, -25.5, face(7, -25.5), 1.1]];
      piece(propGeo('crypt', 0), at, 3.0);
      for (const [x0, z0, ry, sc] of at) for (const k of path ? [-1, 0, 1] : [0]) {
        const [hx, hz] = fwd(x0 + k * P, z0, ry, 1.75 * sc);
        this.halos.push(hx, 3.05 * sc, hz, 1.8, 0.55, 0.4, 1.0, 0.15, 1.6);
      }
    }
    if (this.biome === 'ruins') {
      const at: [number, number, number, number][] = path ? [[-9, -13.5, 0.35, 1.15]] : [[2, -21, face(2, -21), 1.35], [-19, -9, face(-19, -9), 1.1]];
      const ms = piece(propGeo('colonnade', 0), at, 0, 0.15);
      // the old paved way / the paved floor of the arena: worn flagstones with gaps and grass between
      const fl: THREE.Matrix4[] = [];
      if (path) for (let i = 0; i < 40; i++) for (const z of [-1.2, 0, 1.2]) {
        const x = -P / 2 + (i + 0.5) * (P / 40); if (hash2(i, z * 3 + 7, seed) < 0.22) continue;
        for (const dx of [-P, 0, P]) { const xx = x + dx; if (Math.abs(xx) > SPAN) continue; const zc = z + Math.sin(xx * K * 2) * 0.4; fl.push(T(xx, this.heightAt(xx, zc) + 0.015, zc, 0, (hash2(i, z, seed) - 0.5) * 0.3, 0, 0.9 + hash2(i, z + 9, seed) * 0.25)); }
      }
      else for (let rr = 8.5; rr < 15; rr += 1.25) for (let a = 0, na = Math.max(6, Math.round(rr * 2 * Math.PI / 1.25)); a < na; a++) {
        const th = (a + (rr % 2) * 0.5) / na * Math.PI * 2, x = Math.cos(th) * rr, z = Math.sin(th) * rr * 0.87;
        if (hash2(a, Math.round(rr * 4), seed) < 0.16 + rr * 0.025) continue;
        fl.push(T(x, this.heightAt(x, z) + 0.015, z, 0, th + (hash2(a, rr, seed) - 0.5) * 0.3, 0, 0.9 + hash2(a, rr + 3, seed) * 0.25));
      }
      if (fl.length) inst(propGeo('flagstone', 0), fl, this.scrollRoot).name = 'exp-paving';
      for (const m of ms) { const p = new THREE.Vector3().setFromMatrixPosition(m); for (const dx of [-4, 0, 4]) this.shadowList.push(p.x + dx, p.z, 2.4); }
    }
    if (this.biome === 'mill') {
      const zs = path ? [-6.4, -7.6, -8.8, -10.0, -11.2, -12.4] : [-14.5, -15.7, -16.9, -18.1, -19.3];
      field('wheat', 0, zs, 1.2, 0.8, [0.9, 1.25]);
      const at: [number, number, number, number][] = path ? [[-6, -19, 0.45, 1.0]] : [[-12, -24, face(-12, -24), 1.2]];
      const ms = piece(propGeo('windmill', 0), at, 2.4, 0.15);
      piece(propGeo('hay', 0), path ? [[-1.5, -14.2, 0.3, 1], [0.2, -15.6, 1.2, 0.9]] : [[-7.5, -21, 0.4, 1], [-6, -22.6, 1.3, 0.9]], 0.8, 0.02);
      // a rail fence between the road and the field (a few rails missing)
      const fz = path ? -5.0 : 0, fm: THREE.Matrix4[] = [];
      if (path) for (let i = 0; i < 26; i++) { if (hash2(i, 41, seed) < 0.28) continue; const x = -P / 2 + (i + 0.5) * (P / 26); for (const dx of [-P, 0, P]) { const xx = x + dx; if (Math.abs(xx) > SPAN) continue; fm.push(T(xx, this.heightAt(xx, fz) - 0.03, fz, 0, 0, (hash2(i, 43, seed) - 0.5) * 0.06)); } }
      if (fm.length) inst(propGeo('fence', 0), fm, this.scrollRoot);
      const hubs = new Float32Array(ms.length * 3), yaw: THREE.Quaternion[] = [], sc: number[] = [];
      ms.forEach((m, i) => {
        const p = new THREE.Vector3().setFromMatrixPosition(m), a = at[Math.floor(i / (path ? 3 : 1))];
        const [hx, hz] = fwd(p.x, p.z, a[2], 1.72 * a[3]);
        hubs[i * 3] = hx; hubs[i * 3 + 1] = p.y + 6.75 * a[3]; hubs[i * 3 + 2] = hz;
        yaw.push(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), a[2])); sc.push(a[3]);
      });
      const im = new THREE.InstancedMesh(propGeo('sails', 0), this.mats.tint, ms.length);
      im.frustumCulled = false; im.name = 'exp-sails';
      this.disposables.push(im); (path ? this.scrollRoot : this.root).add(im);
      const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
      this.sails = { im, hubs, yaw, sc, speed: reduce ? 0.12 : 0.55 };
      this.update(0);
    }
    if (this.biome === 'deadtree') {
      const at: [number, number, number, number][] = path ? [[-4, -11, 0.5, 1.3]] : [[-5, -19.5, face(-5, -19.5), 1.6]];
      piece(propGeo('bigtree', 0), at, 3.2, 0.2);
      for (const [x0, z0, ry, sc] of at) for (const k of path ? [-1, 0, 1] : [0]) {
        const [hx, hz] = fwd(x0 + k * P, z0, ry, 0.8 * sc);
        this.halos.push(hx, 1.86 * sc, hz, 0.7 * sc, 0.4, 0.8, 0.35, 0.3, 1.1);
      }
    }
    if (this.biome === 'village') {
      const huts: [number, number, number, number, number][] = path
        ? [[-15, -12.5, 0.25, 1, 0], [1, -17.5, -0.12, 1.1, 1], [16, -11.5, -0.35, 1, 2], [27, -19, 0.2, 1.05, 0]]
        : [[-15, -13, 0, 1.35, 0], [-3, -20.5, 0, 1.4, 1], [11.5, -18.5, 0, 1.35, 0], [19, -7.5, 0, 1.3, 2], [-21, -3, 0, 1.2, 1]];
      for (let pal = 0; pal < 3; pal++) piece(propGeo('hut', pal), huts.filter((h) => h[4] === pal).map(([x, z, ry, s]) => [x, z, path ? ry : face(x, z), s] as const), 2.3, 0.08);
      piece(propGeo('well', 0), path ? [[-5.5, -9.2, 0.4, 1.1]] : [[5, -14, face(5, -14), 1.25]], 0.9, 0.05);
    }
    void R;
  }

  private props(seed: number) {
    const S = this.spec, R = rng(seed * 31 + 5);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
    const qk = [0.45, 0.75, 1, 1.25][Math.max(0, Math.min(3, this.q))];
    // groves: shared centres, so trees, bushes, ferns and mushrooms gather into stands with clearings between
    const groves: [number, number][] = [];
    const ng = 9;
    for (let i = 0; i < ng; i++) groves.push([R() * P, (R() * 2 - 1) * (ZW - 6)]);
    const patches: [number, number][] = [];
    for (let i = 0; i < 14; i++) patches.push([R() * P, (R() * 2 - 1) * (ZW - 2)]);
    const gauss = () => (R() + R() + R() - 1.5) * 2;
    // one instanced draw per kind + palette: foreground / second entries of the same model share it
    const groups = new Map<string, { kind: PropKind; pal: number; ents: [number, boolean][] }>();
    for (const [kind, pal, count0, fgF] of S.props) { const key = kind + ':' + pal; const g = groups.get(key) || { kind, pal, ents: [] }; g.ents.push([count0, !!fgF]); groups.set(key, g); }
    for (const { kind, pal, ents } of groups.values()) {
      const big = kind === 'mound' || kind === 'cliff';
      const small = SMALL.has(kind);
      const facing = FACING.has(kind) || (kind === 'pumpkin' && pal % 3 === 2);
      const pts: number[] = [];
      for (const [count0, fg] of ents) {
      const count = pts.length / 3 + Math.round(count0 * qk * (kind === 'grass' ? (this.q <= 1 ? 0.5 : 1) : 1) * (fg && this.mode === 'clearing' ? 1.35 : 1));
      let tries = 0;
      const clustered = fg ? 0 : GROVE.has(kind) ? 0.72 : kind === 'flower' || kind === 'grass' || kind === 'reed' || kind === 'cattail' || kind === 'crystal' || kind === 'stalag' ? 0.6 : 0;
      const rad = GROVE.has(kind) ? 5.5 : kind === 'flower' ? 2.2 : kind === 'grass' ? 4.5 : 3;
      while (pts.length / 3 < count && tries++ < count * 30) {
        let x: number, z: number;
        if (clustered && R() < clustered) {
          const cs = GROVE.has(kind) ? groves : patches, c = cs[Math.floor(R() * cs.length)];
          x = mod(c[0] + gauss() * rad, P) - P / 2; z = c[1] + gauss() * rad * 0.8;
          if (Math.abs(z) > ZW - 2) continue;
        } else { x = R() * P - P / 2; if (fg && this.mode === 'clearing') x = (R() * 2 - 1) * 17; z = fg ? (this.mode === 'path' ? 3.2 + R() * 8.5 : 5.5 + R() * 8) : (R() * 2 - 1) * (ZW - 2); }
        const az = Math.abs(z);
        const minZ = fg ? 3.2 : small ? 2.6 : big ? 9 : kind === 'pillar' || kind === 'brazier' ? 7 : 5;
        if (this.mode === 'path' && az < minZ) continue;
        if (this.mode === 'clearing' && Math.hypot(x, z * 1.15) < (small ? 8 : big ? 17 : fg ? 9 : NEAR.has(kind) ? 11.5 : 13)) continue;
        if (fg && !small && kind !== 'bones' && kind !== 'tumble' && Math.abs(this.mode === 'path' ? z : x) < (this.mode === 'path' ? 6.5 : 7)) continue;   // tall foreground dressing only at the frame edges
        if (!fg && TALL.has(kind) && z > 2.5 && z < 20 && Math.abs(x) < (this.mode === 'path' ? P : 18)) continue;   // camera side stays clear
        if (!fg && !small && !TALL.has(kind) && z > 4 && z < 10 && Math.abs(x) < (this.mode === 'path' ? P : 12) && kind !== 'rock') continue;
        if (S.shell === 'gorge' && kind === 'cliff' && az < 9) continue;
        if (S.walls === 'cave' && (kind === 'stalag' || kind === 'support' || kind === 'boulder') && az < 6) continue;
        if (S.shell === 'dungeon' && (kind === 'pillar' || kind === 'brazier') && (az < 6.5 || az > 8.2)) continue;
        if (S.shell === 'dungeon' && this.mode === 'clearing' && (kind === 'pillar' || kind === 'brazier')) { const rr = Math.hypot(x, z * 1.1); if (rr < 12.5 || rr > 14.5) continue; }
        if (S.shell === 'dungeon' && az > 12) continue;
        const wa = this.waterAt(x, z);
        const wetOk = kind === 'reed' || kind === 'lily' || kind === 'cattail';
        if (wa > -Infinity && !wetOk) continue;
        if (kind === 'lily' && wa === -Infinity) continue;
        if ((kind === 'reed' || kind === 'cattail') && S.water !== 'swamp' && !(z < -5.5 && z > -8) && !(z < -13 && z > -16) && wa === -Infinity) continue;
        if (S.water === 'swamp' && this.mode === 'path' && az < 2.2 && kind !== 'grass') continue;
        if (kind === 'support' && this.mode === 'path') { pts.push(x, 0, R()); continue; }
        if (kind === 'support' && this.mode === 'clearing') continue;
        pts.push(x, z, R());
      }
      }
      const n = pts.length / 3;
      if (!n) continue;
      const geo = propGeo(kind, pal);
      const inst = new THREE.InstancedMesh(geo, this.mats.tint, n * 3);
      let k = 0;
      const gl = GLOW[kind]?.(pal);
      const glowOn = gl && gl[1] > 0;
      const sr = SHADOW_R[kind];
      for (let i = 0; i < n; i++) {
        const x = pts[i * 3], z = pts[i * 3 + 1], r = pts[i * 3 + 2];
        const sc = (small ? 0.8 + r * 0.7 : 0.75 + r * 0.6) * (big ? 1 + r * 0.5 : 1) * (kind === 'tree' || kind === 'pine' || kind === 'snowpine' ? 1.1 : 1);
        q.setFromAxisAngle(up, kind === 'support' ? 0 : facing ? (this.mode === 'path' ? 0.7 : 0) + (r - 0.5) * 1.0 : r * 6.283);
        s.set(sc, sc * (kind === 'tree' || kind === 'pine' || kind === 'snowpine' ? 0.85 + r * 0.5 : 1), sc);
        for (const dx of [-P, 0, P]) {
          const xx = x + dx;
          if (xx < -SPAN || xx > SPAN) continue;
          const y = kind === 'lily' ? this.waterAt(xx, z) + 0.03 : kind === 'support' && this.mode === 'path' ? 0 : this.heightAt(xx, z) - (kind === 'stone' || kind === 'rock' || kind === 'pillar' || kind === 'boulder' || kind === 'tomb' ? 0.18 : kind === 'cliff' ? 0.6 : 0.04);
          p.set(xx, y, z); m.compose(p, q, s); inst.setMatrixAt(k++, m);
          if (sr && (this.q > 0 || sr > 0.9)) this.shadowList.push(xx, z, sr * sc);
          if (glowOn && this.halos.length < 9 * 190) this.halos.push(xx, y + gl![0] * s.y, z, gl![1] * sc, gl![2], gl![3], gl![4], gl![5], gl![6]);
        }
      }
      inst.count = k;
      inst.frustumCulled = false;
      inst.name = 'exp-prop-' + kind;
      this.disposables.push(inst);
      this.scrollRoot.add(inst);
    }
  }

  /** Soft contact shadows under trees, rocks, ruins… (one instanced draw, the decal shader). */
  private shadowMesh() {
    const L = this.shadowList;
    const n = L.length / 3;
    if (!n) return;
    const dark = this.night ? 0.5 : this.spec.shell ? 0.5 : 0.6;
    const items: number[] = [];
    for (let i = 0; i < n; i++) { const x = L[i * 3], z = L[i * 3 + 1], r = L[i * 3 + 2]; items.push(x + r * 0.55, this.heightAt(x, z) + 0.05, z - r * 0.35, r * 1.35, r, dark); }
    const im = blobShadowMesh(this.mats.decal, items);
    this.disposables.push(im.geometry, im);
    this.scrollRoot.add(im);
  }

  /** Glow halos: torches, braziers, crystals, lanterns, fireflies (one instanced additive draw). */
  private haloMesh(seed: number) {
    const R = rng(seed * 13 + 1), S = this.spec;
    const fly = (this.night ? 40 : S.fly ? S.fly[0] : this.biome === 'forest' ? 16 : this.biome === 'swamp' ? 26 : S.shell === 'cave' ? 14 : 0) * (this.q <= 0 ? 0 : this.q === 1 ? 0.6 : 1);
    for (let i = 0; i < fly; i++) {
      const x = R() * P - P / 2, z = (R() * 2 - 1) * 14;
      if (this.mode === 'clearing' && Math.hypot(x, z) < 4) continue;
      const sw = S.water === 'swamp';
      const col = S.fly && !this.night ? [S.fly[1], S.fly[2], S.fly[3]] : S.shell === 'cave' ? [0.5, 0.7, 1.0] : sw ? [0.6, 1.0, 0.5] : [1.0, 0.9, 0.4];
      for (const dx of [-P, 0, P]) this.halos.push(x + dx, this.heightAt(x + dx, z) + 0.5 + R() * 1.8, z, 0.35 + R() * 0.2, col[0] * 1.2, col[1] * 1.2, col[2] * 1.2, 0.6, 1.5 + R() * 2);
    }
    // ground mist (graveyard, dead tree): wide low glows; a negative flicker marks them for the soft, coreless halo shading
    if (S.mist && this.q > 0) {
      const mc = new THREE.Color(S.mist[1]), nm = Math.round(S.mist[0] * (this.q === 1 ? 0.6 : 1));
      for (let i = 0; i < nm; i++) {
        const x = R() * P - P / 2, z = (R() * 2 - 1) * 22, sz = 3.5 + R() * 3;
        if (this.mode === 'clearing' && Math.hypot(x, z) < 7) continue;
        if (this.mode === 'path' && Math.abs(z) < 2.5) continue;
        for (const dx of [-P, 0, P]) this.halos.push(x + dx, this.heightAt(x + dx, z) + 0.25 + R() * 0.3, z, sz, mc.r, mc.g, mc.b, -0.08, 0.25 + R() * 0.3);
      }
    }
    const H = this.halos, n = Math.min(H.length / 9, 330);
    if (!n) return;
    const g = new THREE.PlaneGeometry(2, 2);
    const col = new Float32Array(n * 4), pp = new Float32Array(n * 2);
    const im = new THREE.InstancedMesh(g, this.mats.halo, n);
    const m = new THREE.Matrix4();
    for (let i = 0; i < n; i++) {
      const o = i * 9;
      m.makeScale(H[o + 3], H[o + 3], H[o + 3]).setPosition(H[o], H[o + 1], H[o + 2]); im.setMatrixAt(i, m);
      col[i * 4] = H[o + 4] * 0.9; col[i * 4 + 1] = H[o + 5] * 0.9; col[i * 4 + 2] = H[o + 6] * 0.9; col[i * 4 + 3] = H[o + 7];
      pp[i * 2] = H[o + 8]; pp[i * 2 + 1] = (i * 1.7) % 6.28;
    }
    g.setAttribute('iCol', new THREE.InstancedBufferAttribute(col, 4)); g.setAttribute('iP', new THREE.InstancedBufferAttribute(pp, 2));
    im.frustumCulled = false; im.renderOrder = 3; im.name = 'exp-halos';
    this.disposables.push(g, im);
    this.scrollRoot.add(im);
  }

  /** Light shafts (forest canopy, canyon, cave crystals): crossed additive planes. */
  private shafts(seed: number) {
    const S = this.spec;
    if (this.night || this.q <= 0) return;
    const forest = this.biome === 'forest', gorge = S.shell === 'gorge', cave = S.shell === 'cave';
    if (!(forest || gorge || cave || this.biome === 'mound' && false)) return;
    const R = rng(seed * 5 + 9);
    const n = forest ? 7 : gorge ? 3 : 4;
    const g = new THREE.PlaneGeometry(1, 1);
    const im = new THREE.InstancedMesh(g, this.mats.beam, n * 2 * 3);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), p = new THREE.Vector3(), sc = new THREE.Vector3();
    let k = 0;
    for (let i = 0; i < n; i++) {
      const x = R() * P - P / 2, z = this.mode === 'path' ? (R() < 0.5 ? -1 : 1) * (4 + R() * 7) : -6 - R() * 8;
      const w = forest ? 2.2 + R() * 1.6 : gorge ? 3 + R() * 2 : 1.8 + R() * 1.2, h = forest ? 12 : gorge ? 18 : 9;
      for (const dx of [-P, 0, P]) {
        for (let c = 0; c < 2; c++) {
          e.set(0, c * Math.PI / 2 + 0.4, 0.28 + (c ? 0.03 : 0)); q.setFromEuler(e);
          p.set(x + dx, h * 0.45, z); sc.set(w, h, 1); m.compose(p, q, sc); im.setMatrixAt(k++, m);
        }
      }
    }
    im.count = k; im.frustumCulled = false; im.renderOrder = 4; im.name = 'exp-shafts';
    this.disposables.push(g, im);
    this.beams = im;
    (this.mode === 'path' ? this.scrollRoot : this.root).add(im);
  }

  /** Travel: shift the endless terrain (offset in metres walked). */
  scroll(offset: number): void { this.scrollRoot.position.x = -mod(offset, P); }

  update(t: number): void {
    if (this.clocked && this.sceneRef && this.ownFog && this.sceneRef.fog === this.ownFog) {   // the user's clock moved on
      tickDayNight();
      if (DN.version !== this.dnV) { this.dnV = DN.version; this.applyLook(); }
    }
    const W = this.sails;
    if (W) {
      for (let i = 0; i < W.sc.length; i++) {
        this._q5.setFromAxisAngle(ZAX, t * W.speed + i * 0.7); this._q4.multiplyQuaternions(W.yaw[i], this._q5);
        this._v4.set(W.hubs[i * 3], W.hubs[i * 3 + 1], W.hubs[i * 3 + 2]); this._s4.setScalar(W.sc[i]);
        this._m4.compose(this._v4, this._q4, this._s4); W.im.setMatrixAt(i, this._m4);
      }
      W.im.instanceMatrix.needsUpdate = true;
    }
    if (this.fill) this.fill.intensity = (this.night ? 30 : 22) * (0.9 + 0.1 * Math.sin(t * 9) * Math.sin(t * 5.3));
    if (this.waterMesh) this.waterMesh.position.y = (this.spec.water === 'swamp' ? -0.18 : -0.25) + Math.sin(t * 1.2) * 0.02;
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
    this.disposables = []; this.sails = null;
    this.root.removeFromParent();
  }
}

const mod = (a: number, b: number) => ((a % b) + b) % b;
const ZAX = new THREE.Vector3(0, 0, 1);
function smooth(a: number, b: number, x: number): number { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); }
