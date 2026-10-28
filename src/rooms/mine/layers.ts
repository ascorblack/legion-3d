/**
 * Depth layers of the mine (port of the site's mine-biome.js THEMES, 28.10): every 5 floors the cave changes —
 * 12 layers from «Корневые норы» (1–5) to «Сердце горы» (61+). The nature of the mine (biome) tints the layer exactly
 * like the site (BIO tint, share k). Pure data + colour maths: no THREE, no DOM (used by art.ts and hud.ts, tested in
 * test/mine-layers.test.ts).
 */

export interface MineLayer {
  id: string; from: number; name: string; to: string;
  wall: string; wallL: string; floor: string; floorL: string;
  /** Light colour of the layer's lamps (site lc). */
  lc: string;
  rock: [string, string, string]; hard: [string, string, string];
}

export const LAYERS12: readonly MineLayer[] = [
  { id: 'roots', from: 1, name: 'Корневые норы', to: 'в Корневые норы', wall: '#5c4330', wallL: '#7a5c40', floor: '#7c6046', floorL: '#927354', lc: '#ffd27a', rock: ['#a08a72', '#c0aa90', '#73624f'], hard: ['#7e7468', '#9c9284', '#57504a'] },
  { id: 'clay', from: 6, name: 'Глиняные штольни', to: 'в Глиняные штольни', wall: '#6a3a28', wallL: '#88523a', floor: '#845236', floorL: '#9a6444', lc: '#ffc86a', rock: ['#b07a5a', '#cc9a78', '#7e5038'], hard: ['#8e624a', '#aa7e64', '#62402e'] },
  { id: 'stone', from: 11, name: 'Каменные выработки', to: 'в Каменные выработки', wall: '#45444f', wallL: '#5e5d6a', floor: '#5a5862', floorL: '#6c6a74', lc: '#ffcf7a', rock: ['#8e8c94', '#b0aeb8', '#62606a'], hard: ['#666874', '#848694', '#45464f'] },
  { id: 'granite', from: 16, name: 'Гранитные глубины', to: 'в Гранитные глубины', wall: '#27252f', wallL: '#3a3746', floor: '#45414e', floorL: '#555060', lc: '#9ae0ff', rock: ['#6a6878', '#8a88a0', '#46445a'], hard: ['#4e4c5e', '#666480', '#302e40'] },
  { id: 'grotto', from: 21, name: 'Грибные гроты', to: 'в Грибные гроты', wall: '#152029', wallL: '#22323d', floor: '#2b3a40', floorL: '#36494f', lc: '#5ff0c8', rock: ['#5a7078', '#7a96a0', '#3a4c54'], hard: ['#465a62', '#5e7a84', '#2a3a42'] },
  { id: 'abyss', from: 26, name: 'Пылающая бездна', to: 'в Пылающую бездну', wall: '#140b10', wallL: '#26141c', floor: '#2c1c22', floorL: '#3a252c', lc: '#ff7a2a', rock: ['#4e3a40', '#6e5258', '#2e2026'], hard: ['#3e2a32', '#583c46', '#20141a'] },
  { id: 'crystal', from: 31, name: 'Кристальные пещеры', to: 'в Кристальные пещеры', wall: '#161226', wallL: '#262040', floor: '#2a2440', floorL: '#38305a', lc: '#c8a0ff', rock: ['#5a5076', '#7e72a4', '#38304e'], hard: ['#463c66', '#62568c', '#28223e'] },
  { id: 'lake', from: 36, name: 'Подземное озеро', to: 'к Подземному озеру', wall: '#0e1a22', wallL: '#1a2c38', floor: '#1e2c34', floorL: '#2a3a44', lc: '#a8e0ff', rock: ['#4a626e', '#6a8694', '#2e3e48'], hard: ['#3a525e', '#52707e', '#22323a'] },
  { id: 'dwarf', from: 41, name: 'Руины гномов', to: 'в Руины гномов', wall: '#1a1614', wallL: '#2c2622', floor: '#2e2824', floorL: '#3c342e', lc: '#ffc860', rock: ['#6a5e54', '#8c7e70', '#443a32'], hard: ['#54483e', '#706254', '#342c24'] },
  { id: 'fossil', from: 46, name: 'Окаменевший лес', to: 'в Окаменевший лес', wall: '#171912', wallL: '#282b20', floor: '#2a2c22', floorL: '#383a2e', lc: '#ffb040', rock: ['#5e5c4a', '#7e7c66', '#3c3a2e'], hard: ['#4a4a3a', '#666650', '#2e2e22'] },
  { id: 'mirror', from: 51, name: 'Самоцветные залы', to: 'в Самоцветные залы', wall: '#14121e', wallL: '#262238', floor: '#2a2638', floorL: '#38324a', lc: '#fff0d8', rock: ['#56506e', '#7a7298', '#363048'], hard: ['#443e5e', '#5e587e', '#2a263c'] },
  { id: 'heart', from: 61, name: 'Сердце горы', to: 'в Сердце горы', wall: '#120c0a', wallL: '#22160f', floor: '#281a14', floorL: '#36241a', lc: '#ff9a4a', rock: ['#5a3e34', '#7a5446', '#38241e'], hard: ['#48302a', '#64423a', '#2c1a16'] },
];

/** Nature tint of the layer (site BIO: colour and its share k; walls k, floor 0.8k, stones 0.7k). */
export const BIO_TINT: Record<string, [string, number]> = {
  meadow: ['#a8b84a', 0.16], forest: ['#3e6e34', 0.18], taiga: ['#3e6a74', 0.16], ice: ['#9ac8f0', 0.24], swamp: ['#4e6a3a', 0.2],
  blight: ['#7a3e9a', 0.22], coast: ['#2e8aa8', 0.16], desert: ['#d8a050', 0.22], ruin: ['#a8a090', 0.12], ash: ['#a02a10', 0.2], mount: ['#8a8a9a', 0],
};

/** Index of the layer of floor n (site themeIx). */
export function layerIx(n: number): number {
  let k = 0; const f = +n || 1;
  for (let i = 0; i < LAYERS12.length; i++) if (f >= LAYERS12[i].from) k = i;
  return k;
}
export const layerOf = (n: number): MineLayer => LAYERS12[layerIx(n)];
/** Floors of a layer for captions: «26–30», the last one «61 и глубже» (site span). */
export function layerSpan(L: MineLayer): string {
  const i = LAYERS12.indexOf(L), nx = LAYERS12[i + 1];
  return nx ? `${L.from}–${nx.from - 1}` : `${L.from} и глубже`;
}
/** Banner text when the mine goes down into a new layer; '' when the layer did not change (or the first view). */
export function layerBanner(prevN: number | null, n: number): string {
  if (prevN == null || !(n > prevN) || layerIx(prevN) === layerIx(n)) return '';
  const L = layerOf(n);
  return `Шахта спустилась ${L.to} (этажи ${layerSpan(L)})`;
}

const hx = (c: string): [number, number, number] => { const v = parseInt(c.slice(1), 16); return [v >> 16, (v >> 8) & 255, v & 255]; };
/** Mix of colours a and b (k = share of b), as the site's mix(). */
export function mixHex(a: string, b: string, k: number): string {
  const A = hx(a), B = hx(b);
  return '#' + A.map((v, i) => Math.round(v + (B[i] - v) * k).toString(16).padStart(2, '0')).join('');
}

export interface TintedLayer extends MineLayer { biome: string }
/** The layer of floor n tinted by the mine's nature (site themeOf). */
export function themeOf(n: number, biome: string): TintedLayer {
  const T = layerOf(n), [tint, k] = BIO_TINT[biome] || BIO_TINT.mount;
  const t = (c: string, kk = k) => (kk ? mixHex(c, tint, kk) : c);
  return {
    ...T, biome,
    wall: t(T.wall), wallL: t(T.wallL), floor: t(T.floor, k * 0.8), floorL: t(T.floorL, k * 0.8),
    rock: T.rock.map((c) => t(c, k * 0.7)) as [string, string, string], hard: T.hard.map((c) => t(c, k * 0.7)) as [string, string, string],
  };
}
