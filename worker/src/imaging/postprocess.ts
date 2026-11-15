// Pós-processamento dos sprites, igual nos dois caminhos (PLANO-SPRITES-BACKGROUNDS.md, seção 2):
// limpeza do alfa nativo, garbage matte, anel de contorno, verificações automáticas, alinhamento
// das poses e escolha da cor-chave pelo front. Tudo em typed arrays; sharp só para redimensionar.
import sharp from 'sharp';
import { KEY_COLORS, excessOf, sampleCorners, type KeyColorName, type RgbaImage, type RgbImage } from './keyer';

const idx = (w: number, x: number, y: number) => y * w + x;

/** Caminho nativo: alfa ≥ 250 → 255; ≤ 4 → 0; RGB = 0 onde alfa = 0. Altera no lugar. */
export function nativeAlphaCleanup(img: RgbaImage): { raisedTo255: number; zeroed: number } {
  let raisedTo255 = 0, zeroed = 0;
  const d = img.data;
  for (let i = 3; i < d.length; i += 4) {
    if (d[i] >= 250 && d[i] < 255) { d[i] = 255; raisedTo255++; }
    else if (d[i] <= 4 && d[i] > 0) { d[i] = 0; zeroed++; }
    if (d[i] === 0) d[i - 3] = d[i - 2] = d[i - 1] = 0;
  }
  return { raisedTo255, zeroed };
}

export type Box = { x0: number; y0: number; x1: number; y1: number }; // x1/y1 exclusivos
export type Component = { label: number; area: number; box: Box };

/** Componentes conexos (8-vizinhança) de uma máscara binária. labels: 0 = fora. */
export function components(mask: Uint8Array, w: number, h: number): { labels: Int32Array; comps: Component[] } {
  const labels = new Int32Array(w * h), comps: Component[] = [];
  const stack = new Int32Array(w * h);
  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || labels[start]) continue;
    const label = comps.length + 1;
    const c: Component = { label, area: 0, box: { x0: w, y0: h, x1: 0, y1: 0 } };
    let sp = 0;
    stack[sp++] = start; labels[start] = label;
    while (sp) {
      const p = stack[--sp], x = p % w, y = (p - x) / w;
      c.area++;
      if (x < c.box.x0) c.box.x0 = x; if (x >= c.box.x1) c.box.x1 = x + 1;
      if (y < c.box.y0) c.box.y0 = y; if (y >= c.box.y1) c.box.y1 = y + 1;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const q = idx(w, nx, ny);
        if (mask[q] && !labels[q]) { labels[q] = label; stack[sp++] = q; }
      }
    }
    comps.push(c);
  }
  return { labels, comps };
}

/** Dilatação quadrada de raio r (separável). */
export function dilate(mask: Uint8Array, w: number, h: number, r: number): Uint8Array {
  if (r <= 0) return mask.slice();
  const tmp = new Uint8Array(w * h), out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    let run = -1e9;
    for (let x = 0; x < w; x++) { if (mask[idx(w, x, y)]) run = x; if (x - run <= r) tmp[idx(w, x, y)] = 1; }
    run = 1e9;
    for (let x = w - 1; x >= 0; x--) { if (mask[idx(w, x, y)]) run = x; if (run - x <= r) tmp[idx(w, x, y)] = 1; }
  }
  for (let x = 0; x < w; x++) {
    let run = -1e9;
    for (let y = 0; y < h; y++) { if (tmp[idx(w, x, y)]) run = y; if (y - run <= r) out[idx(w, x, y)] = 1; }
    run = 1e9;
    for (let y = h - 1; y >= 0; y--) { if (tmp[idx(w, x, y)]) run = y; if (run - y <= r) out[idx(w, x, y)] = 1; }
  }
  return out;
}

export function alphaMask(img: RgbaImage, threshold = 128): Uint8Array {
  const n = img.width * img.height, m = new Uint8Array(n);
  for (let p = 0; p < n; p++) m[p] = img.data[p * 4 + 3] > threshold ? 1 : 0;
  return m;
}

export type MatteLog = { kept: Component[]; removed: Component[]; removedAlphaPixels: number; dilate: number };

/**
 * Garbage matte: componentes de alfa > 128; fica o maior e os que passam da área mínima com o
 * centro dentro da caixa do maior. A máscara mantida é dilatada `dilatePx` e multiplica o alfa.
 */
export function garbageMatte(img: RgbaImage, opts: { minAreaFrac?: number; minAreaPx?: number; dilatePx?: number } = {}): MatteLog {
  const { width: w, height: h } = img;
  const minAreaFrac = opts.minAreaFrac ?? 0.002, minAreaPx = opts.minAreaPx ?? 150, r = opts.dilatePx ?? 4;
  const { labels, comps } = components(alphaMask(img), w, h);
  if (!comps.length) return { kept: [], removed: [], removedAlphaPixels: 0, dilate: r };
  const main = comps.reduce((a, b) => (b.area > a.area ? b : a));
  const minArea = Math.max(minAreaPx, main.area * minAreaFrac);
  const inside = (c: Component) => {
    const cx = (c.box.x0 + c.box.x1) / 2, cy = (c.box.y0 + c.box.y1) / 2;
    return cx >= main.box.x0 && cx < main.box.x1 && cy >= main.box.y0 && cy < main.box.y1;
  };
  const keepLabel = new Uint8Array(comps.length + 1), kept: Component[] = [], removed: Component[] = [];
  for (const c of comps) {
    if (c === main || (c.area >= minArea && inside(c))) { keepLabel[c.label] = 1; kept.push(c); } else removed.push(c);
  }
  const keepMask = new Uint8Array(w * h);
  for (let p = 0; p < keepMask.length; p++) keepMask[p] = labels[p] && keepLabel[labels[p]] ? 1 : 0;
  const allowed = dilate(keepMask, w, h, r);
  let removedAlphaPixels = 0;
  for (let p = 0; p < allowed.length; p++) {
    if (allowed[p] || !img.data[p * 4 + 3]) continue;
    removedAlphaPixels++;
    img.data[p * 4] = img.data[p * 4 + 1] = img.data[p * 4 + 2] = img.data[p * 4 + 3] = 0;
  }
  return { kept, removed, removedAlphaPixels, dilate: r };
}

export type RingLayer = { layer: number; pixels: number; visible: number; halo: number; keyTint: number; hiddenHalo: number };
export type OutlineReport = { layers: RingLayer[]; width: number };

export const OUTLINE_LAYER_FRAC = 0.3;
const lightNeutral = (r: number, g: number, b: number) => { const lo = Math.min(r, g, b); return lo >= 150 && Math.max(r, g, b) - lo <= 40; };

/**
 * Anel de 1 a `maxLayer` px fora da borda (alfa > 128). Em cada camada: pixels visíveis (alfa ≥ 16),
 * halo claro e neutro (cinza/branco, o defeito relatado no caminho nativo), resto da cor-chave e,
 * se vier `raw` (saída nativa antes da limpeza), halo escondido: RGB cinza/branco sob alfa < 16,
 * que aparece quando a imagem é redimensionada sem pré-multiplicar.
 * width = camadas em que halo + resto da chave + halo escondido passam de OUTLINE_LAYER_FRAC dos pixels.
 */
export function outlineRing(img: RgbaImage, keyColor: KeyColorName | null, maxLayer = 4, raw?: RgbaImage): OutlineReport {
  const { width: w, height: h, data } = img;
  let inner = alphaMask(img);
  const layers: RingLayer[] = [];
  for (let k = 1; k <= maxLayer; k++) {
    const outer = dilate(inner, w, h, 1);
    const L: RingLayer = { layer: k, pixels: 0, visible: 0, halo: 0, keyTint: 0, hiddenHalo: 0 };
    for (let p = 0; p < outer.length; p++) {
      if (!outer[p] || inner[p]) continue;
      L.pixels++;
      const a = data[p * 4 + 3];
      if (a < 16) {
        if (raw && raw.data[p * 4 + 3] < 16 && lightNeutral(raw.data[p * 4], raw.data[p * 4 + 1], raw.data[p * 4 + 2])) L.hiddenHalo++;
        continue;
      }
      L.visible++;
      const r = data[p * 4], g = data[p * 4 + 1], b = data[p * 4 + 2];
      if (lightNeutral(r, g, b)) L.halo++;
      else if (keyColor && excessOf(keyColor, r, g, b) >= 24) L.keyTint++;
    }
    layers.push(L);
    inner = outer;
  }
  // A 1ª camada sempre tem a borda suave do próprio personagem, então não se exige sequência.
  const width = layers.filter(L => L.pixels && (L.halo + L.keyTint + L.hiddenHalo) / L.pixels > OUTLINE_LAYER_FRAC).length;
  return { layers, width };
}

/** Buracos: regiões fora da máscara que não se ligam à borda da imagem (4-vizinhança). */
export function holes(img: RgbaImage): { count: number; largest: number; total: number; largestFracOfSubject: number } {
  const { width: w, height: h } = img;
  const mask = alphaMask(img), outside = new Uint8Array(w * h), stack: number[] = [];
  const seed = (x: number, y: number) => { const p = idx(w, x, y); if (!mask[p] && !outside[p]) { outside[p] = 1; stack.push(p); } };
  for (let x = 0; x < w; x++) { seed(x, 0); seed(x, h - 1); }
  for (let y = 0; y < h; y++) { seed(0, y); seed(w - 1, y); }
  while (stack.length) {
    const p = stack.pop()!, x = p % w, y = (p - x) / w;
    if (x > 0) seed(x - 1, y); if (x < w - 1) seed(x + 1, y); if (y > 0) seed(x, y - 1); if (y < h - 1) seed(x, y + 1);
  }
  const holeMask = new Uint8Array(w * h);
  let subject = 0;
  for (let p = 0; p < holeMask.length; p++) { holeMask[p] = !mask[p] && !outside[p] ? 1 : 0; subject += mask[p]; }
  const { comps } = components(holeMask, w, h);
  const largest = comps.reduce((m, c) => Math.max(m, c.area), 0);
  return { count: comps.length, largest, total: comps.reduce((s, c) => s + c.area, 0), largestFracOfSubject: subject ? largest / subject : 0 };
}

export type CheckLimits = { cornerMaxAlpha: number; areaMin: number; areaMax: number; holeMaxFrac: number; outlineMaxWidth: number };
export const DEFAULT_LIMITS: CheckLimits = { cornerMaxAlpha: 4, areaMin: 0.04, areaMax: 0.7, holeMaxFrac: 0.04, outlineMaxWidth: 1 };

export type CheckReport = {
  ok: boolean; failed: string[];
  corners: { maxAlpha: number; ok: boolean };
  area: { frac: number; ok: boolean };
  holes: ReturnType<typeof holes> & { ok: boolean };
  outline: OutlineReport & { ok: boolean };
};

export function runChecks(img: RgbaImage, keyColor: KeyColorName | null, limits: CheckLimits = DEFAULT_LIMITS, raw?: RgbaImage): CheckReport {
  const { width: w, height: h, data } = img, s = 16;
  let maxAlpha = 0;
  for (const [ox, oy] of [[0, 0], [w - s, 0], [0, h - s], [w - s, h - s]])
    for (let y = oy; y < oy + s; y++) for (let x = ox; x < ox + s; x++) maxAlpha = Math.max(maxAlpha, data[idx(w, x, y) * 4 + 3]);
  let filled = 0;
  for (let p = 0; p < w * h; p++) if (data[p * 4 + 3] > 128) filled++;
  const frac = filled / (w * h);
  const hl = holes(img), ol = outlineRing(img, keyColor, 4, raw);
  const r: CheckReport = {
    ok: true, failed: [],
    corners: { maxAlpha, ok: maxAlpha <= limits.cornerMaxAlpha },
    area: { frac, ok: frac >= limits.areaMin && frac <= limits.areaMax },
    holes: { ...hl, ok: hl.largestFracOfSubject <= limits.holeMaxFrac },
    outline: { ...ol, ok: ol.width <= limits.outlineMaxWidth },
  };
  for (const k of ['corners', 'area', 'holes', 'outline'] as const) if (!r[k].ok) r.failed.push(k);
  r.ok = !r.failed.length;
  return r;
}

/** Caixa do conteúdo (alfa > threshold). null se vazio. */
export function contentBox(img: RgbaImage, threshold = 8): Box | null {
  const { width: w, height: h, data } = img;
  const b: Box = { x0: w, y0: h, x1: 0, y1: 0 };
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (data[idx(w, x, y) * 4 + 3] > threshold) {
    if (x < b.x0) b.x0 = x; if (x >= b.x1) b.x1 = x + 1; if (y < b.y0) b.y0 = y; if (y >= b.y1) b.y1 = y + 1;
  }
  return b.x1 > b.x0 ? b : null;
}

/** Personagem num fundo sólido (charsheet): maior componente a mais de `dist` da cor dos cantos. */
export function solidSubject(img: RgbImage, dist = 48): { mask: Uint8Array; box: Box; area: number; background: [number, number, number] } {
  const { width: w, height: h, data } = img;
  const bg = sampleCorners(img).background;
  const m = new Uint8Array(w * h);
  for (let p = 0; p < m.length; p++) {
    const dr = data[p * 3] - bg[0], dg = data[p * 3 + 1] - bg[1], db = data[p * 3 + 2] - bg[2];
    m[p] = dr * dr + dg * dg + db * db > dist * dist ? 1 : 0;
  }
  const { labels, comps } = components(m, w, h);
  if (!comps.length) throw new Error('charsheet sem personagem');
  const main = comps.reduce((a, b) => (b.area > a.area ? b : a));
  // Mantém o maior e os pedaços grandes dentro da caixa dele (ex.: cauda separada pelo contorno).
  const keep = new Set(comps.filter(c => c === main || (c.area > main.area * 0.002 &&
    (c.box.x0 + c.box.x1) / 2 >= main.box.x0 && (c.box.x0 + c.box.x1) / 2 < main.box.x1 &&
    (c.box.y0 + c.box.y1) / 2 >= main.box.y0 && (c.box.y0 + c.box.y1) / 2 < main.box.y1)).map(c => c.label));
  const box: Box = { x0: w, y0: h, x1: 0, y1: 0 };
  let area = 0;
  for (let p = 0; p < m.length; p++) {
    m[p] = labels[p] && keep.has(labels[p]) ? 1 : 0;
    if (!m[p]) continue;
    area++;
    const x = p % w, y = (p - x) / w;
    if (x < box.x0) box.x0 = x; if (x >= box.x1) box.x1 = x + 1; if (y < box.y0) box.y0 = y; if (y >= box.y1) box.y1 = y + 1;
  }
  return { mask: m, box, area, background: bg };
}

export type KeyChoice = {
  color: KeyColorName | null; // null: todas colidem → caminho nativo para este personagem
  scores: Record<KeyColorName, number>; // fração dos pixels do personagem perto de cada cor
  threshold: number; limit: number;
};

/**
 * Colisão de cor-chave pelos pixels opacos do front: fração com excesso da candidata acima de
 * `threshold` (lá o keyer já começaria a deixar o pixel transparente). Fica a menor; se todas
 * passam de `limit`, nenhuma.
 */
export function chooseKeyColor(front: RgbImage, opts: { threshold?: number; limit?: number; candidates?: KeyColorName[] } = {}): KeyChoice {
  const threshold = opts.threshold ?? 32, limit = opts.limit ?? 0.02;
  const candidates = opts.candidates ?? (Object.keys(KEY_COLORS) as KeyColorName[]);
  const { mask, area } = solidSubject(front);
  const scores = {} as Record<KeyColorName, number>;
  for (const c of candidates) {
    let near = 0;
    for (let p = 0; p < mask.length; p++) if (mask[p] && excessOf(c, front.data[p * 3], front.data[p * 3 + 1], front.data[p * 3 + 2]) > threshold) near++;
    scores[c] = area ? near / area : 1;
  }
  const best = candidates.reduce((a, b) => (scores[b] < scores[a] ? b : a));
  return { color: scores[best] <= limit ? best : null, scores, threshold, limit };
}

export type AlignInfo = { box: Box; scale: number; rawScale: number; feetY: number; centerX: number; canvas: { width: number; height: number }; clippedPixels: number };

/**
 * Alinhamento das poses: recorta o conteúdo e põe na mesma tela, com a mesma linha dos pés.
 * A altura do personagem no front é a unidade: a pose é escalada para ter essa altura, com a
 * mudança limitada a ±maxScaleChange (braço erguido não deve encolher o corpo). O centro
 * horizontal vem dos 15% de baixo do conteúdo (pés), não da caixa inteira.
 */
export async function alignPose(img: RgbaImage, unit: { height: number; feetY: number; canvasWidth: number; canvasHeight: number }, maxScaleChange = 0.15): Promise<{ image: RgbaImage; info: AlignInfo }> {
  const box = contentBox(img);
  if (!box) throw new Error('pose vazia');
  const bh = box.y1 - box.y0, bw = box.x1 - box.x0;
  const rawScale = unit.height / bh;
  const scale = Math.min(1 + maxScaleChange, Math.max(1 - maxScaleChange, rawScale));
  let sx = 0, sn = 0;
  for (let y = Math.floor(box.y1 - bh * 0.15); y < box.y1; y++) for (let x = box.x0; x < box.x1; x++) {
    const a = img.data[(y * img.width + x) * 4 + 3];
    if (a > 128) { sx += x; sn++; }
  }
  const footX = sn ? sx / sn : (box.x0 + box.x1) / 2;
  const crop = await sharp(Buffer.from(img.data.buffer, img.data.byteOffset, img.data.length), { raw: { width: img.width, height: img.height, channels: 4 } })
    .extract({ left: box.x0, top: box.y0, width: bw, height: bh }).raw().toBuffer();
  const tw = Math.max(1, Math.round(bw * scale)), th = Math.max(1, Math.round(bh * scale));
  const scaled = scale === 1 ? crop : await sharp(crop, { raw: { width: bw, height: bh, channels: 4 } }).resize(tw, th, { kernel: 'lanczos3', fit: 'fill' }).raw().toBuffer();
  const W = unit.canvasWidth, H = unit.canvasHeight, out = new Uint8ClampedArray(W * H * 4);
  const left = Math.round(W / 2 - (footX - box.x0) * scale), top = Math.round(unit.feetY - th);
  let clippedPixels = 0; // conteúdo que ficou fora da tela (pose mais larga ou alta que o front)
  for (let y = 0; y < th; y++) {
    const oy = top + y;
    for (let x = 0; x < tw; x++) {
      const ox = left + x;
      const si = (y * tw + x) * 4, di = (oy * W + ox) * 4;
      if (!scaled[si + 3]) continue;
      if (oy < 0 || oy >= H || ox < 0 || ox >= W) { clippedPixels++; continue; }
      out[di] = scaled[si]; out[di + 1] = scaled[si + 1]; out[di + 2] = scaled[si + 2]; out[di + 3] = scaled[si + 3];
    }
  }
  return { image: { width: W, height: H, data: out }, info: { box, scale, rawScale, feetY: unit.feetY, centerX: W / 2, canvas: { width: W, height: H }, clippedPixels } };
}
