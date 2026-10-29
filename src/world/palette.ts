/** Per-style colour palettes of the city (mirrors the site's flat cartoon palette: thick dark outline, warm fills). */
export interface Pal {
  line: string; wall: string; wallD: string; roof: string; roof2: string; plaster: string; stone: string; timber: string;
  ground: string; ground2: string; groundL: string; lowA: string; lowB: string; mortar: string; lowMortar: string;
  glass: string; sign: string; signTx: string; wood: string; woodD: string; woodL: string; water: string; waterD: string;
  flag: string; brick: string; brickL: string; brickD: string; joint: string; leaf: string; leafD: string; metal: string;
  backHouse: string; backRoof: string; hill: string; fog: string; tent: string; tent2: string; awnings: string[];
  sky: string;
  /** Natural rock of the mine outcrop (site cityart.js): base, light, dark. */
  rock: string; rockL: string; rockD: string;
  /** Quarter theme (site cityart.js PAL flags, 28.10 «art/styles-city-legend»): bone horns on every roof ridge end. */
  horns?: boolean;
  /** «Котельный квартал»: the water is lava (glowing), a warm glow over the quarter. */
  hell?: boolean;
  /** Backdrop behind the quarter: 'cliffs' = basalt cliffs with lavafalls and boiler chimneys (cherts); default = houses + hills. */
  back?: string;
  /** Horn colour. */
  hornC?: string;
}

const CATS: Pal = {
  line: '#2b1d18', wall: '#3a2f5e', wallD: '#2a2350', roof: '#8a5a8e', roof2: '#b0628e', plaster: '#f2d4a8', stone: '#a9503c',
  timber: '#6e4a2f', ground: '#c8664a', ground2: '#8f3f2c', groundL: '#e08a68', lowA: '#b45a40', lowB: '#c46a4c', mortar: '#8f3f2c',
  lowMortar: '#7a3426', glass: '#ffd76a', sign: '#6a2a5a', signTx: '#ffcf4a', wood: '#a8754f', woodD: '#6e4a2f', woodL: '#d9a066',
  water: '#7fc8ff', waterD: '#3a6aa8', flag: '#ff8fa3', brick: '#a9503c', brickL: '#b85e48', brickD: '#984634', joint: '#7a3426',
  leaf: '#5a9a4a', leafD: '#3e7436', metal: '#2a2440', backHouse: '#24224a', backRoof: '#1e1c40', hill: '#2a2552', fog: '#3a2f6e',
  tent: '#c271ae', tent2: '#f5d9e9', awnings: ['#b79be0', '#7fb0e8', '#5fbfa8', '#e0605a', '#ffcf4a'],
  sky: 'linear-gradient(#0f0d2a 0%, #1d1a4a 40%, #3a2f6e 75%, #5a3a7a 100%)',
  rock: '#8a6a5a', rockL: '#a8887a', rockD: '#5e4638',
};
const LEGION: Pal = {
  ...CATS, line: '#15122e', roof: '#a3122a', roof2: '#b5533c', plaster: '#ead9b8', stone: '#8b8796', timber: '#6b4423',
  ground: '#46435a', ground2: '#33303f', groundL: '#625e78', lowA: '#3a374b', lowB: '#403d52', mortar: '#33303f', lowMortar: '#2c2a3a',
  sign: '#7a0f1d', signTx: '#ffc94d', wood: '#a0703a', woodD: '#6b4423', brick: '#5a5768', brickL: '#65627a', brickD: '#4e4b60',
  joint: '#3e3b50', leaf: '#2f5a46', leafD: '#1f4032', water: '#4ab0ff', waterD: '#2a6fb0', flag: '#ffc94d', tent: '#a3122a', tent2: '#ead9b8',
  sky: 'linear-gradient(#0d0b22, #2b2150)', fog: '#2b2150',
  rock: '#7a7484', rockL: '#9a94a6', rockD: '#57505e',
};
const MONKEYS: Pal = {
  ...CATS, line: '#2a1a12', roof: '#3f8f3a', roof2: '#56a843', plaster: '#e2b678', stone: '#9a6a3c', timber: '#7a5230',
  ground: '#c99a5e', ground2: '#8a5a32', groundL: '#e2b678', lowA: '#b98a52', lowB: '#ad7e48', mortar: '#7a5230', lowMortar: '#7a5230',
  sign: '#7a4a1a', signTx: '#ffe39a', wood: '#c99a5e', woodD: '#8a5a32', brick: '#9a6a3c', brickL: '#a87648', brickD: '#8a5e34',
  joint: '#6e4a2f', leaf: '#3f8f3a', leafD: '#2f7a36', water: '#6ad0e0', waterD: '#2a8a9a', flag: '#ffd84a', tent: '#e8892a', tent2: '#ffe39a',
  sky: 'linear-gradient(#241a4e 0%, #4a2f72 34%, #9a4f7a 66%, #f0905a 100%)', fog: '#6a3f6e',
  rock: '#8a7a5a', rockL: '#a89a72', rockD: '#5e5236',
};
/*
 * Since 28.10 (site cityart.js «art/styles-city-legend») every channel style has its own quarter: PAL[style] (exported as
 * LGCityArt.PAL), the paving / wall tables of its kit (kitOf: pave, paves.low, walls.brick) and the lower-street table
 * LOWX[style] (ground, retaining wall, rock of the mine). The four styles below mirror those tables (derived: quarter
 * paving → ground, lower paving → lowA/lowB, brick wall → brick, LOWX.rock → rock); at runtime sitePalette() lays the
 * page's own LGCityArt.PAL[style] over them, so a later colour tweak on the site follows without a release.
 */
/** «Овощи» — ОГОРОДНЫЙ КВАРТАЛ: plank houses under green tiles, potato cobbles, a picket fence with sunflowers. */
const VEGGIES: Pal = {
  ...LEGION, line: '#2b2118', wall: '#8a5a2b', wallD: '#6a4420', roof: '#4f9a3a', roof2: '#e8892a', plaster: '#fff3dc', stone: '#a89070', timber: '#8a5a2b',
  ground: '#a8865a', ground2: '#6e5236', groundL: '#d8b88a', mortar: '#5e4630', lowA: '#9a7a50', lowB: '#a8885c', lowMortar: '#584228',
  glass: '#ffe08a', sign: '#3f7a2a', signTx: '#fff0a8', wood: '#c8894a', woodD: '#8a5a2b', woodL: '#e8b070', water: '#5ac0ff', waterD: '#2a6fb0', flag: '#e8455c',
  brick: '#a87a50', brickL: '#b88a5e', brickD: '#986a44', joint: '#6a4a2a', leaf: '#4caf50', leafD: '#2f7a35', metal: '#4a3a2a',
  tent: '#4f9a3a', tent2: '#fff3dc', awnings: ['#4f9a3a', '#e8892a', '#e8455c', '#ffd84a', '#c8894a'],
  rock: '#9a8a70', rockL: '#b8a88a', rockD: '#6a5a44', back: 'garden',
};
/** «Черти» — КОТЕЛЬНЫЙ КВАРТАЛ над лавой: cast-iron houses on rivets, roofs the colour of baked blood with horns, basalt
 *  cliffs with lavafalls and boiler chimneys behind the quarter, lava in the canal. */
const CHERTS: Pal = {
  ...LEGION, line: '#2a0d14', wall: '#2e2228', wallD: '#241a1e', roof: '#6a1020', roof2: '#3a3346', plaster: '#4a4458', stone: '#3a3346', timber: '#2a2236',
  ground: '#3a2c30', ground2: '#24181c', groundL: '#5e484e', mortar: '#140a0c', lowA: '#33262a', lowB: '#3c2e33', lowMortar: '#120809',
  glass: '#ffb347', sign: '#2a0d14', signTx: '#ffc83d', wood: '#6a3a2a', woodD: '#3a1e16', woodL: '#8a5038', water: '#ff7a1a', waterD: '#a8200e', flag: '#ffc83d',
  brick: '#3a2a30', brickL: '#46343a', brickD: '#2e2026', joint: '#5a1a14', leaf: '#3a2a30', leafD: '#2a1e22', metal: '#3a3346',
  backHouse: '#1e1014', backRoof: '#2a0d14', hill: '#2a1418', fog: '#5a1418', tent: '#6a1020', tent2: '#4a4458', awnings: ['#6a1020', '#3a3346', '#ff5a1a', '#ffc83d', '#4a4458'],
  sky: 'linear-gradient(#0e0306 0%, #2a0a10 45%, #5a1418 80%, #8a2a1a 100%)',
  rock: '#4a3a40', rockL: '#6a5258', rockD: '#2a1e22', horns: true, hell: true, back: 'cliffs', hornC: '#e8d8b8',
};
/** «42 Братухи» — РАЙОН БРАТУХ: neon, chrome, rose gold, tiles. */
const BROTHERS: Pal = {
  ...LEGION, line: '#1c1022', wall: '#2a1a3a', wallD: '#1e1230', roof: '#ff5fa2', roof2: '#4a3a5a', plaster: '#3a2a4a', stone: '#5a4a6a', timber: '#ffc83d',
  ground: '#3a2e4e', ground2: '#241a34', groundL: '#5a4a72', mortar: '#1c1022', lowA: '#33284a', lowB: '#2a2040', lowMortar: '#160c1c',
  glass: '#5ad1ff', sign: '#1c1022', signTx: '#ff5fa2', wood: '#8a5a3a', woodD: '#5a3a2a', woodL: '#b07a52', water: '#5ad1ff', waterD: '#2a5ab0', flag: '#ffc83d',
  brick: '#4a3a5a', brickL: '#56466a', brickD: '#3e2e4e', joint: '#241a34', leaf: '#3aa86a', leafD: '#2a7a4a', metal: '#1c1022',
  tent: '#ff5fa2', tent2: '#3a2a4a', awnings: ['#ff5fa2', '#5ad1ff', '#ffc83d', '#b06bff', '#4a3a5a'],
  rock: '#5a4a6a', rockL: '#7a6a8a', rockD: '#3a2e4e', back: 'city',
};
/** «Уга-Буги» — СТОЙБИЩЕ: stone huts under hides with tusks, a cave cliff behind. */
const UGABUGI: Pal = {
  ...LEGION, line: '#2a1a12', wall: '#5e584e', wallD: '#4a453d', roof: '#c9955a', roof2: '#8a5a2a', plaster: '#b8b0a2', stone: '#8a8478', timber: '#8a5a2a',
  ground: '#b8a078', ground2: '#7a6244', groundL: '#d8c8a0', mortar: '#6a5236', lowA: '#a8906a', lowB: '#98805c', lowMortar: '#5e4830',
  glass: '#ffd27a', sign: '#5a3a1e', signTx: '#f3e6c8', wood: '#a8743a', woodD: '#6a4420', woodL: '#c9955a', water: '#5ab8c8', waterD: '#2a6a7a', flag: '#e8402a',
  brick: '#8a8478', brickL: '#9a9488', brickD: '#7a7468', joint: '#5e584e', leaf: '#5a9a3a', leafD: '#3a7a2a', metal: '#4a3a2a',
  tent: '#c9955a', tent2: '#f3e6c8', awnings: ['#c9955a', '#8a5a2a', '#e8402a', '#ffd27a', '#5e584e'],
  rock: '#8a8478', rockL: '#a8a092', rockD: '#5e584e', horns: true, hornC: '#f3e6c8', back: 'cave',
};
const BY_STYLE: Record<string, Pal> = { cats: CATS, legion: LEGION, monkeys: MONKEYS, veggies: VEGGIES, cherts: CHERTS, '42brothers': BROTHERS, ugabugi: UGABUGI };
/** Styles whose palette here is hand-tuned for the 3D lighting (the site's table is not laid over them). */
const TUNED = new Set(['cats', 'legion', 'monkeys']);

/** Site quarter palettes (LGCityArt.PAL, copied as plain colour strings by the site adapter), by style id. */
export type SitePals = Record<string, Record<string, string | boolean>>;
const HEX = /^#[0-9a-fA-F]{3,8}$/;
/** PAL fields of the site that map 1:1 onto ours (its `ink` is our dark `line`; its `line` is the outline of the 2D art). */
const SITE_KEYS = ['wall', 'wallD', 'roof', 'roof2', 'plaster', 'stone', 'timber', 'glass', 'sign', 'signTx', 'wood', 'woodD', 'woodL', 'water', 'waterD', 'flag'] as const;

/** Copy the colour fields of the site's LGCityArt.PAL (hostile / odd values are dropped). Browser and node. */
export function readSitePals(PAL: unknown): SitePals | undefined {
  if (!PAL || typeof PAL !== 'object') return undefined;
  const out: SitePals = {};
  try {
    for (const [st, v] of Object.entries(PAL as Record<string, any>)) {
      if (!/^[\w-]{1,30}$/.test(st) || !v || typeof v !== 'object') continue;
      const o: Record<string, string | boolean> = {};
      for (const key of [...SITE_KEYS, 'ink', 'sky', 'back']) { const c = v[key]; if (typeof c === 'string' && (HEX.test(c) || (key === 'sky' && /^linear-gradient\([#\w\s%,.()]+\)$/.test(c)) || (key === 'back' && /^\w{1,16}$/.test(c)))) o[key] = c; }
      for (const key of ['horns', 'hell', 'iron']) if (v[key] === true) o[key] = true;
      out[st] = o;
    }
  } catch { return undefined; }
  return out;
}

/**
 * The city palette of a style: our table (mirror of the site's), with the page's own quarter colours laid over it for
 * the styles that are not hand-tuned (veggies, cherts, 42brothers, ugabugi and any new one: a style unknown here
 * starts from Legion's quarter, as the site does with `PAL[style] || PAL.legion`).
 */
export function paletteOf(style: string, site?: SitePals | null): Pal {
  const base = BY_STYLE[style] ?? (site?.[style] ? LEGION : CATS);
  const S = site?.[style];
  if (!S || TUNED.has(style)) return base;
  const out: Pal = { ...base };
  for (const key of SITE_KEYS) { const c = S[key]; if (typeof c === 'string') (out as any)[key] = c; }
  if (typeof S.ink === 'string') out.line = S.ink;
  if (typeof S.sky === 'string') out.sky = S.sky;
  if (S.horns === true) out.horns = true;
  if (S.hell === true) { out.hell = true; out.back = out.back || 'cliffs'; }
  if (typeof S.back === 'string') out.back = S.back;
  return out;
}

/** Parse 'linear-gradient(#a 0%, #b 40%, …)' → stops [{c, p}] (p 0..1). Missing % are spread evenly. */
export function parseGradient(css: string | undefined): { c: string; p: number }[] {
  const out: { c: string; p: number }[] = [];
  if (css) {
    const re = /(#[0-9a-fA-F]{3,8}|rgba?\([^)]*\)|hsla?\([^)]*\))\s*(\d+(?:\.\d+)?%)?/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(css))) out.push({ c: m[1], p: m[2] ? parseFloat(m[2]) / 100 : NaN });
  }
  if (out.length < 2) return [{ c: '#0f0d2a', p: 0 }, { c: '#5a3a7a', p: 1 }];
  out.forEach((s, i) => { if (isNaN(s.p)) s.p = i / (out.length - 1); });
  return out;
}
