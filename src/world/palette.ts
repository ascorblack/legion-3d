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
const VEGGIES: Pal = { ...LEGION, roof: '#4f9a3a', roof2: '#e8892a', plaster: '#f1e6c8', sign: '#3f7a2a', signTx: '#fff0a8', flag: '#e8455c', leaf: '#3f7a3a' };

export function paletteOf(style: string): Pal {
  return style === 'cats' ? CATS : style === 'monkeys' ? MONKEYS : style === 'veggies' ? VEGGIES : style === 'legion' || style === 'cherts' ? LEGION : CATS;   // cherts: the site uses Legion's fair
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
