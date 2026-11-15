// Revisão visual (PLANO-SPRITES-BACKGROUNDS.md, seção 2, "Review"), sem custo: para cada pasta de
// pose do modo experimento, uma folha com cada tentativa processada sobre branco e sobre escuro,
// o alfa e recortes 2× (mãos/asas na altura do meio, cabeça/cabelo em cima).
//   npx tsx test/images-review.ts [experimentsDir]   → <pasta da pose>/review.png
import { readdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import sharp from 'sharp';

const ROOT = resolve(process.argv[2] ?? process.env.AI_IMAGE_EXPERIMENT_DIR ?? './experiments');
const TILE = 256, CROP = 256;

async function onBg(png: Buffer, bg: string) {
  const m = await sharp(png).metadata();
  return sharp({ create: { width: m.width!, height: m.height!, channels: 4, background: bg } }).composite([{ input: png }]).png().toBuffer();
}
const thumb = (b: Buffer) => sharp(b).resize(TILE, Math.round(TILE * 1.5), { fit: 'contain', background: '#888' }).png().toBuffer();

// Recorte 2× de uma região (frações da caixa do conteúdo).
async function crop2x(png: Buffer, fx: number, fy: number) {
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let x0 = info.width, y0 = info.height, x1 = 0, y1 = 0;
  for (let y = 0; y < info.height; y++) for (let x = 0; x < info.width; x++) if (data[(y * info.width + x) * 4 + 3] > 8) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  const half = CROP / 4; // 128 px de origem → 256 px
  const cx = Math.round(x0 + (x1 - x0) * fx), cy = Math.round(y0 + (y1 - y0) * fy);
  const left = Math.max(0, Math.min(info.width - half * 2, cx - half)), top = Math.max(0, Math.min(info.height - half * 2, cy - half));
  return sharp(png).extract({ left, top, width: half * 2, height: half * 2 }).resize(CROP, CROP, { kernel: 'nearest' }).png().toBuffer();
}

for (const d of (await readdir(ROOT)).filter(d => /-pose-/.test(d)).sort()) {
  const dir = join(ROOT, d);
  if (!existsSync(join(dir, 'meta.json'))) continue;
  const meta = JSON.parse(await readFile(join(dir, 'meta.json'), 'utf8'));
  const rows: Buffer[][] = [];
  for (const a of meta.attempts as any[]) {
    if (!a.processed) continue;
    const png = await readFile(join(dir, a.processed));
    const alpha = await sharp(png).extractChannel(3).toColourspace('srgb').png().toBuffer();
    const white = await onBg(png, '#ffffff'), dark = await onBg(png, '#101a2c');
    rows.push([
      await thumb(white), await thumb(dark), await thumb(alpha),
      await crop2x(white, 0.15, 0.45), await crop2x(dark, 0.85, 0.45), await crop2x(dark, 0.5, 0.08),
    ]);
  }
  if (!rows.length) continue;
  const W = TILE * 3 + CROP * 3, rowH = Math.round(TILE * 1.5) + 30;
  const labels = (meta.attempts as any[]).filter(a => a.processed).map(a => `${a.path} #${a.n} ${a.ok ? 'ok' : 'falhou: ' + (a.error ?? a.checks?.failed?.join(','))}`);
  const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${rows.length * rowH}">${labels.map((l, i) => `<text x="6" y="${i * rowH + 20}" font-family="Arial" font-size="16">${l} · branco / escuro / alfa / esq. 2× / dir. 2× / cabeça 2×</text>`).join('')}</svg>`);
  const comps = rows.flatMap((r, i) => r.map((b, j) => ({ input: b, left: j < 3 ? j * TILE : TILE * 3 + (j - 3) * CROP, top: i * rowH + 30 })));
  await sharp({ create: { width: W, height: rows.length * rowH, channels: 3, background: '#e8e8e8' } }).composite([...comps, { input: svg, left: 0, top: 0 }]).png().toFile(join(dir, 'review.png'));
  console.log(`${d}: ${rows.length} tentativa(s) → review.png`);
}
