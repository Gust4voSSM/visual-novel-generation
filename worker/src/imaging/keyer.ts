// Recorte por cor-chave (PLANO-SPRITES-BACKGROUNDS.md, seção 2, "Node keyer").
// Porte de output/imagegen/macaw-magenta-key-study/key_magenta.py (amostragem nos cantos,
// alfa pelo eixo de excesso, recuperação de cor) e do keyer por distância à tela de
// output/imagegen/macaw-green-key-study/analyze.py. A conta segue o numpy em float32
// (Math.fround) e np.rint (arredonda meio para par), para bater com o Python em ±1.
// Sem despill amplo: ele altera cores reais do personagem.
import sharp from 'sharp';

export type Rgb = [number, number, number];
/** Imagem RGB em float32, como np.array(img).astype(np.float32). */
export type RgbImage = { width: number; height: number; data: Float32Array };
/** RGBA 8 bits, linha a linha. */
export type RgbaImage = { width: number; height: number; data: Uint8ClampedArray };

export type KeyColorName = 'magenta' | 'green' | 'blue' | 'cyan';
export const KEY_COLORS: Record<KeyColorName, { hex: string; rgb: Rgb; key: number[]; other: number[] }> = {
  magenta: { hex: '#FF00FF', rgb: [255, 0, 255], key: [0, 2], other: [1] },
  green: { hex: '#00FF00', rgb: [0, 255, 0], key: [1], other: [0, 2] },
  blue: { hex: '#0000FF', rgb: [0, 0, 255], key: [2], other: [0, 1] },
  cyan: { hex: '#00FFFF', rgb: [0, 255, 255], key: [1, 2], other: [0] },
};

const f = Math.fround;

/** np.rint: arredonda para o inteiro mais próximo, empate para par. */
export function rint(x: number): number {
  const r = Math.round(x);
  return Math.abs(x % 1) === 0.5 && r % 2 !== 0 ? r - 1 : r;
}

export async function decodeRgb(input: Buffer | Uint8Array | string): Promise<RgbImage> {
  // removeAlpha descarta o canal alfa sem compor, como PIL convert('RGB').
  const { data, info } = await sharp(input).removeAlpha().toColourspace('srgb').raw().toBuffer({ resolveWithObject: true });
  if (info.channels !== 3) throw new Error(`decodeRgb: ${info.channels} canais`);
  const out = new Float32Array(data.length);
  for (let i = 0; i < data.length; i++) out[i] = data[i];
  return { width: info.width, height: info.height, data: out };
}

export async function decodeRgba(input: Buffer | Uint8Array | string): Promise<RgbaImage> {
  const { data, info } = await sharp(input).ensureAlpha().toColourspace('srgb').raw().toBuffer({ resolveWithObject: true });
  return { width: info.width, height: info.height, data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.length) };
}

export async function encodePng(img: RgbaImage): Promise<Buffer> {
  return sharp(Buffer.from(img.data.buffer, img.data.byteOffset, img.data.length), { raw: { width: img.width, height: img.height, channels: 4 } })
    .png({ compressionLevel: 9 }).toBuffer();
}

/** np.median de valores float32 (média float32 dos dois do meio quando a contagem é par). */
function median(values: Float32Array | number[]): number {
  const a = Float32Array.from(values).sort();
  const n = a.length, m = n >> 1;
  return n % 2 ? a[m] : f(f(a[m - 1] + a[m]) / 2);
}

function patch(img: RgbImage, x0: number, y0: number, size: number, ch: number): Float32Array {
  const out = new Float32Array(size * size);
  let k = 0;
  for (let y = y0; y < y0 + size; y++) for (let x = x0; x < x0 + size; x++) out[k++] = img.data[(y * img.width + x) * 3 + ch];
  return out;
}

const dist3 = (a: ArrayLike<number>, b: ArrayLike<number>) =>
  f(Math.sqrt(f(f(f(f(a[0] - b[0]) ** 2) + f(f(a[1] - b[1]) ** 2)) + f(f(a[2] - b[2]) ** 2))));

export type CornerSample = { medians: Rgb[]; background: Rgb; maxDeviation: number };

/** Quatro cantos 32×32, mediana de cada um e mediana das medianas (key_magenta.py). */
export function sampleCorners(img: RgbImage, size = 32): CornerSample {
  const { width: w, height: h } = img;
  const origins = [[0, 0], [w - size, 0], [0, h - size], [w - size, h - size]];
  const medians = origins.map(([x, y]) => [0, 1, 2].map(ch => median(patch(img, x, y, size, ch))) as Rgb);
  const background = [0, 1, 2].map(ch => median(medians.map(m => m[ch]))) as Rgb;
  const maxDeviation = Math.max(...medians.map(m => dist3(m, background)));
  return { medians, background, maxDeviation };
}

/** Mediana da borda de 8 px (key() de gpt-green-key-study/analyze.py; os cantos contam duas vezes). */
export function sampleBorder(img: RgbImage, band = 8): Rgb {
  const { width: w, height: h, data } = img;
  const n = 2 * band * w + 2 * band * h;
  const ch3 = [new Float32Array(n), new Float32Array(n), new Float32Array(n)];
  let k = 0;
  const push = (x: number, y: number) => { const i = (y * w + x) * 3; ch3[0][k] = data[i]; ch3[1][k] = data[i + 1]; ch3[2][k] = data[i + 2]; k++; };
  for (let y = 0; y < band; y++) for (let x = 0; x < w; x++) push(x, y);
  for (let y = h - band; y < h; y++) for (let x = 0; x < w; x++) push(x, y);
  for (let y = 0; y < h; y++) for (let x = 0; x < band; x++) push(x, y);
  for (let y = 0; y < h; y++) for (let x = w - band; x < w; x++) push(x, y);
  return ch3.map(median) as Rgb;
}

/** excesso = min(canais da chave) − max(demais canais); para magenta, min(R−G, B−G). */
export function excessOf(color: KeyColorName, r: number, g: number, b: number): number {
  const c = [r, g, b], k = KEY_COLORS[color];
  return f(Math.min(...k.key.map(i => c[i])) - Math.max(...k.other.map(i => c[i])));
}

/** alfa = 1 − clip((excesso − 8)/(excesso_da_tela − 16), 0, 1). */
export function excessAlpha(img: RgbImage, color: KeyColorName, bg: Rgb): { alpha: Float32Array; screenExcess: number } {
  const screenExcess = excessOf(color, bg[0], bg[1], bg[2]);
  const denom = f(screenExcess - 16);
  const n = img.width * img.height, alpha = new Float32Array(n), d = img.data;
  for (let p = 0; p < n; p++) {
    const e = excessOf(color, d[p * 3], d[p * 3 + 1], d[p * 3 + 2]);
    const t = f(f(e - 8) / denom);
    alpha[p] = f(1 - Math.min(1, Math.max(0, t)));
  }
  return { alpha, screenExcess };
}

/** Distância euclidiana à cor da tela: transparente até 8, opaco a partir de 80. */
export function distanceAlpha(img: RgbImage, bg: Rgb, near = 8, far = 80): Float32Array {
  const n = img.width * img.height, alpha = new Float32Array(n), d = img.data;
  const span = far - near;
  for (let p = 0; p < n; p++) {
    const dist = dist3([d[p * 3], d[p * 3 + 1], d[p * 3 + 2]], bg);
    alpha[p] = Math.min(1, Math.max(0, f(f(dist - near) / span)));
  }
  return alpha;
}

/** RGBA final. recover: F = (C − (1 − α)·Bg)/α, recortado; RGB = 0 onde α = 0. */
export function compose(img: RgbImage, alpha: Float32Array, bg: Rgb, recover: boolean): RgbaImage {
  const n = img.width * img.height, out = new Uint8ClampedArray(n * 4), d = img.data;
  const minA = f(1 / 255);
  for (let p = 0; p < n; p++) {
    const a = alpha[p], a8 = rint(f(a * 255));
    out[p * 4 + 3] = a8;
    if (a8 === 0) continue;
    for (let ch = 0; ch < 3; ch++) {
      let v = d[p * 3 + ch];
      if (recover) v = Math.min(255, Math.max(0, f(f(v - f(f(1 - a) * bg[ch])) / Math.max(a, minA))));
      out[p * 4 + ch] = rint(v);
    }
  }
  return { width: img.width, height: img.height, data: out };
}

export type KeyResult = {
  rgba: RgbaImage; color: KeyColorName; background: Rgb; screenExcess: number;
  corners: CornerSample; method: 'excess' | 'distance';
};

export const MIN_SCREEN_EXCESS = 100; // gpt-green: 100; key_magenta: 120. Um limite só para as quatro cores.
export const MAX_CORNER_DEVIATION = 20;

export class KeyError extends Error {
  constructor(readonly code: 'CORNERS_DISAGREE' | 'WEAK_SCREEN', msg: string) { super(msg); }
}

/** Caminho principal: cantos → alfa pelo excesso da cor-chave → recuperação de cor. */
export function keyImage(img: RgbImage, color: KeyColorName, method: 'excess' | 'distance' = 'excess'): KeyResult {
  const corners = sampleCorners(img);
  if (corners.maxDeviation > MAX_CORNER_DEVIATION) throw new KeyError('CORNERS_DISAGREE', `cantos discordam (${corners.maxDeviation.toFixed(1)})`);
  const bg = corners.background;
  const screenExcess = excessOf(color, ...bg);
  if (screenExcess < MIN_SCREEN_EXCESS) throw new KeyError('WEAK_SCREEN', `fundo não é ${color} forte (excesso ${screenExcess})`);
  const alpha = method === 'excess' ? excessAlpha(img, color, bg).alpha : distanceAlpha(img, bg);
  return { rgba: compose(img, alpha, bg, true), color, background: bg, screenExcess, corners, method };
}
