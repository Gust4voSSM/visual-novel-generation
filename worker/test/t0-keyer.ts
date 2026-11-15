// T0 (PLANO-SPRITES-BACKGROUNDS.md, seção 4): fidelidade do keyer em Node contra o Python, nas
// imagens já existentes. Sem chamadas à OpenAI.
//   python -I <scratch>/t0_ref.py <output/imagegen> <pyDir>     (gera as saídas do Python)
//   npx tsx test/t0-keyer.ts <output/imagegen> <pyDir> [nodeOutDir]
// Passa se todo canal de todo pixel difere no máximo 1 (RGBA).
import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  compose, decodeRgb, decodeRgba, distanceAlpha, encodePng, excessAlpha, keyImage, sampleBorder,
  type RgbaImage, type RgbImage,
} from '../src/imaging/keyer';

const [IMG, PY, OUT] = process.argv.slice(2);
if (!IMG || !PY) { console.error('uso: tsx test/t0-keyer.ts <output/imagegen> <pyDir> [nodeOutDir]'); process.exit(2); }

type Diff = { max: number; over1: number; differing: number; pixels: number };
function diff(a: RgbaImage, b: RgbaImage): Diff {
  if (a.width !== b.width || a.height !== b.height) throw new Error('tamanhos diferentes');
  let max = 0, over1 = 0, differing = 0;
  for (let i = 0; i < a.data.length; i++) {
    const d = Math.abs(a.data[i] - b.data[i]);
    if (d > max) max = d;
    if (d > 1) over1++;
    if (d) differing++;
  }
  return { max, over1, differing, pixels: a.width * a.height };
}

// Despill do key() do gpt-green: só para comparar com aquela saída; o keyer de produção não usa.
function despillForParity(img: RgbaImage, alpha: Float32Array) {
  for (let p = 0; p < alpha.length; p++) {
    if (!(alpha[p] > 0 && alpha[p] < 1)) continue;
    const i = p * 4;
    img.data[i + 1] = Math.min(img.data[i + 1], Math.max(img.data[i], img.data[i + 2]));
  }
}

const rows: { case: string; d: Diff; vsEvidence?: Diff }[] = [];
async function check(name: string, node: RgbaImage, pyFile: string, evidence?: string) {
  const py = await decodeRgba(join(PY, pyFile));
  const row: (typeof rows)[number] = { case: name, d: diff(node, py) };
  if (evidence && existsSync(evidence)) row.vsEvidence = diff(py, await decodeRgba(evidence));
  rows.push(row);
  if (OUT) { await mkdir(OUT, { recursive: true }); await writeFile(join(OUT, pyFile), await encodePng(node)); }
}

// Decodificação: sharp e PIL têm de ler os mesmos pixels antes de qualquer conta.
async function decodeParity(path: string, img: RgbImage) {
  const { execFileSync } = await import('node:child_process');
  const py = execFileSync('python', ['-I', '-c',
    'import sys,hashlib,numpy as np;from PIL import Image;print(hashlib.sha256(np.array(Image.open(sys.argv[1]).convert("RGB")).tobytes()).hexdigest())', path]).toString().trim();
  const { createHash } = await import('node:crypto');
  const node = createHash('sha256').update(Uint8Array.from(img.data)).digest('hex');
  return py === node;
}

const t0 = performance.now();
const magentaPath = join(IMG, 'macaw-magenta-key-study/pose-magenta.png');
const mag = await decodeRgb(magentaPath);
const decodeOk = [await decodeParity(magentaPath, mag)];
const mk = keyImage(mag, 'magenta');
const ea = excessAlpha(mag, 'magenta', mk.background).alpha;
const ME = join(IMG, 'macaw-magenta-key-study');
await check('magenta recovered (corners + excess + unmix)', mk.rgba, 'magenta-recovered.png', join(ME, 'pose-recovered-rgba.png'));
await check('magenta raw-alpha (no unmix)', compose(mag, ea, mk.background, false), 'magenta-raw-alpha.png', join(ME, 'pose-raw-alpha-rgba.png'));
await check('magenta distance (corners + distance + unmix)', compose(mag, distanceAlpha(mag, mk.background), mk.background, true), 'magenta-distance.png', join(ME, 'pose-distance-rgba.png'));

const greens: Record<string, string> = {
  speaking: 'gpt-green-key-study/speaking-green.png', listening: 'gpt-green-key-study/listening-green.png',
  thinking: 'gpt-green-key-study/thinking-green.png', macaw: 'macaw-green-key-study/pose-green.png',
};
const evid: Record<string, [string, string]> = {
  speaking: ['gpt-green-key-study/speaking-rgba.png', ''], listening: ['gpt-green-key-study/listening-rgba.png', ''],
  thinking: ['gpt-green-key-study/thinking-rgba.png', ''], macaw: ['macaw-green-key-study/pose-soft-rgba.png', 'macaw-green-key-study/pose-distance-rgba.png'],
};
for (const [pose, rel] of Object.entries(greens)) {
  const img = await decodeRgb(join(IMG, rel));
  decodeOk.push(await decodeParity(join(IMG, rel), img));
  const screen = sampleBorder(img);
  const { alpha } = excessAlpha(img, 'green', screen);
  const soft = compose(img, alpha, screen, true);
  despillForParity(soft, alpha);
  await check(`${pose}: gpt-green key() soft (border + excess + unmix + despill)`, soft, `soft-${pose}.png`, join(IMG, evid[pose][0]));
  await check(`${pose}: screen distance (macaw-green analyze.py)`, compose(img, distanceAlpha(img, screen), screen, true), `distance-${pose}.png`, evid[pose][1] ? join(IMG, evid[pose][1]) : undefined);
  await check(`${pose}: production keyer, green (corners + excess + unmix)`, keyImage(img, 'green').rgba, `cornerexcess-${pose}.png`);
}

const fmt = (d?: Diff) => d ? `max ${d.max}, >1: ${d.over1}, ≠: ${d.differing}` : '—';
console.log(`decodificação sharp = PIL: ${decodeOk.every(Boolean) ? 'sim' : 'NÃO'} (${decodeOk.length} imagens)\n`);
console.log('caso | Node vs Python (por canal) | Python (scratch) vs arquivo de evidência');
for (const r of rows) console.log(`${r.case} | ${fmt(r.d)} | ${fmt(r.vsEvidence)}`);
const pass = decodeOk.every(Boolean) && rows.every(r => r.d.max <= 1);
console.log(`\nT0 ${pass ? 'PASSOU' : 'FALHOU'} (${rows.length} casos, ${Math.round(performance.now() - t0)} ms)`);
process.exit(pass ? 0 : 1);
