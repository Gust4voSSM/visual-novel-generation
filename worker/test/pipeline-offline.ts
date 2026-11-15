// Teste do pipeline de imagens sem custo: uma ImageApi falsa devolve imagens já existentes do
// experimento (front/side no preto, poses em verde e magenta) e uma "nativa" sintética com os
// defeitos relatados no fórum (alfa 253 no opaco, contorno cinza de 2 px).
//   npx tsx test/pipeline-offline.ts <output/imagegen>
// Com AI_IMAGE_EXPERIMENT=1 AI_IMAGE_EXPERIMENT_DIR=<pasta>, grava os arquivos do modo experimento.
import { join } from 'node:path';
import { readFile } from 'node:fs/promises';
import sharp from 'sharp';
import { decodeRgba, encodePng, type RgbaImage } from '../src/imaging/keyer';
import { alphaMask, dilate } from '../src/imaging/postprocess';
import { fitToStage, ImagePipeline, type ImageApi, type ImageCall, type SheetRefs } from '../src/imaging/pipeline';

const IMG = process.argv[2];
if (!IMG) { console.error('uso: tsx test/pipeline-offline.ts <output/imagegen>'); process.exit(2); }
let pass = 0, fail = 0;
const ok = (cond: unknown, msg: string) => { if (cond) pass++; else fail++; console.log(`  ${cond ? 'ok   ' : 'FALHA'} ${msg}`); };
const read = (p: string) => readFile(join(IMG, p));

// Nativo sintético: sprite recortado + alfa 253 no opaco + contorno cinza de `halo` px fora da
// borda: a 1ª camada semitransparente (alfa 90), as outras só no RGB, sob alfa 0 (escondido).
async function fakeNative(rgbaFile: string, halo: number): Promise<Uint8Array> {
  const img: RgbaImage = await decodeRgba(await read(rgbaFile));
  const m = alphaMask(img), ring1 = dilate(m, img.width, img.height, 1), ring = dilate(m, img.width, img.height, halo);
  for (let p = 0; p < m.length; p++) {
    const i = p * 4;
    if (img.data[i + 3] === 255) img.data[i + 3] = 253;
    if (!halo || !ring[p] || m[p] || img.data[i + 3] >= 16) continue;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = 205;
    img.data[i + 3] = ring1[p] ? 90 : 0;
  }
  return encodePng(img);
}

function fakeApi(c: { front: string; side: string; keyed: Record<string, string>; native: () => Promise<Uint8Array> }) {
  const calls: ImageCall[] = [];
  const api: ImageApi = {
    model: 'fake',
    async call(call) {
      calls.push(call);
      let bytes: Uint8Array;
      if (call.endpoint === 'generations') bytes = call.size === '1536x1024' ? await sharp({ create: { width: 1536, height: 1024, channels: 3, background: '#557799' } }).png().toBuffer() : await read(c.front);
      else if (/side profile/.test(call.prompt)) bytes = await read(c.side);
      else if (call.background === 'transparent') bytes = await c.native();
      else if (call.images?.[0]?.name === 'base.png') bytes = call.images[0].bytes;
      else {
        const hex = /#[0-9A-F]{6}/.exec(call.prompt)?.[0] ?? '';
        bytes = await read(c.keyed[hex] ?? Object.values(c.keyed)[0]);
      }
      return { bytes, model: 'fake', ms: 1, usage: { input_tokens: 0, output_tokens: 0 }, costUsd: 0 };
    },
  };
  return { api, calls };
}

const sig = new AbortController().signal;
const quiet = () => {};

async function sheetFor(p: ImagePipeline, design: string): Promise<SheetRefs & { scores: unknown }> {
  const front = await p.front(design, sig);
  const side = await p.side(design, { id: 'front', bytes: front.bytes }, sig);
  return { sheetId: 'test', front: { id: 'front', bytes: front.bytes }, side: { id: 'side', bytes: side.bytes }, keyColor: front.meta.keyChoice.color, unit: front.meta.unit, scores: front.meta.keyChoice.scores };
}

console.log('\nmacaw (fundo preto; verde colide com as faixas das asas)');
{
  const f = fakeApi({
    front: 'macaw-green-key-study/front.png', side: 'macaw-green-key-study/side.png',
    keyed: { '#FF00FF': 'macaw-magenta-key-study/pose-magenta.png', '#00FF00': 'macaw-green-key-study/pose-green.png' },
    native: () => fakeNative('macaw-magenta-key-study/pose-recovered-rgba.png', 2),
  });
  const p = new ImagePipeline(f.api, quiet);
  const sheet = await sheetFor(p, 'macaw');
  console.log('    pontuação de colisão:', JSON.stringify(sheet.scores), '→', sheet.keyColor);
  ok(sheet.keyColor && sheet.keyColor !== 'green', `cor-chave não é verde (${sheet.keyColor})`);
  ok(f.calls[0].endpoint === 'generations' && !f.calls[0].images, 'front: generations, só texto');
  ok(f.calls[1].endpoint === 'edits' && f.calls[1].images?.length === 1 && /black background/.test(f.calls[1].prompt) && /black background/.test(f.calls[0].prompt), 'side: edit com o front, mesmo fundo preto');
  // Força magenta (o caso do experimento) para ter uma pose em cor-chave que existe.
  sheet.keyColor = 'magenta';
  const n0 = f.calls.length;
  const r = await p.pose('macaw', 'cheerful greeting', sheet, sig, { primary: 'keyed', compare: false });
  ok(r.meta.path === 'keyed' && r.meta.accepted === true && r.meta.generations === 1, `keyed magenta aceito na 1ª (${JSON.stringify(r.meta.perPath)})`);
  const poseCall = f.calls[n0];
  ok(poseCall.endpoint === 'edits' && poseCall.images?.map(i => i.name).join() === 'front.png,side.png' && poseCall.background === 'opaque' && /#FF00FF/.test(poseCall.prompt), 'pose: edit com front + side, opaco, magenta no prompt');
  const out = await sharp(r.bytes).metadata();
  ok(out.width === sheet.unit.canvasWidth && out.height === sheet.unit.canvasHeight && out.hasAlpha, `pose alinhada na tela do front (${out.width}×${out.height}, escala ${(r.meta.alignment as any).scale.toFixed(3)})`);

  // Nativo primário com contorno de 2 px: falha, tenta de novo, troca para keyed.
  const n1 = f.calls.length;
  const r2 = await p.pose('macaw', 'cheerful greeting', sheet, sig, { primary: 'native', compare: false });
  ok(r2.meta.path === 'keyed' && r2.meta.fellBack === true && f.calls.length - n1 === 3, `nativo com contorno → 2 tentativas → keyed (${f.calls.length - n1} gerações)`);

  // Comparação: os dois caminhos, cada um com até 2 tentativas, sem troca.
  const r3 = await p.pose('macaw', 'cheerful greeting', sheet, sig, { primary: 'keyed', compare: true });
  ok(r3.meta.path === 'keyed' && (r3.meta.perPath as any).native?.attempts === 2 && (r3.meta.perPath as any).keyed?.attempts === 1, `comparação: keyed 1 tentativa, nativo 2 (${JSON.stringify(r3.meta.perPath)})`);

  // Modelo que recusa transparência (gpt-image-2 em 2026-11-14): HTTP 400 no nativo vira
  // tentativa falha sem repetir, e a pose sai pelo keyed em vez de derrubar o personagem.
  {
    const reject: ImageApi = {
      model: 'fake', async call(call, s) {
        if (call.background === 'transparent') throw Object.assign(new Error('AI_PROVIDER_ERROR'), { status: 400, body: JSON.stringify({ error: { message: 'Transparent background is not supported for this model.' } }) });
        return f.api.call(call, s);
      },
    };
    const p400 = new ImagePipeline(reject, quiet);
    const r5 = await p400.pose('macaw', 'cheerful greeting', { ...sheet, keyColor: 'magenta' }, sig, { primary: 'native', compare: false });
    ok(r5.meta.path === 'keyed' && r5.meta.fellBack === true && (r5.meta.perPath as any).native.attempts === 1, `nativo recusado (400) → 1 tentativa, sem repetir → keyed (${JSON.stringify(r5.meta.perPath)})`);
    const r6 = await p400.pose('macaw', 'cheerful greeting', { ...sheet, keyColor: 'magenta' }, sig, { primary: 'keyed', compare: true });
    ok(r6.meta.path === 'keyed' && r6.meta.accepted === true, 'comparação com nativo recusado: o personagem sai, pelo keyed');
  }

  // Cor errada no fundo (pedido ciano, veio magenta): o keyer recusa e troca de caminho.
  sheet.keyColor = 'cyan';
  const r4 = await p.pose('macaw', 'cheerful greeting', sheet, sig, { primary: 'keyed', compare: false });
  ok(r4.meta.path === 'native' && r4.meta.accepted === false, `fundo errado → keyed recusado → nativo (aceito: ${r4.meta.accepted}, fica o de menos falhas)`);
}

console.log('\nmoça de cabelo prateado (verde, sem colisão grande)');
{
  const f = fakeApi({
    front: 'gpt-charsheets-original-prompts/front.png', side: 'gpt-charsheets-original-prompts/side.png',
    keyed: { '#00FF00': 'gpt-green-key-study/speaking-green.png' },
    native: () => fakeNative('gpt-green-key-study/speaking-rgba.png', 0),
  });
  const p = new ImagePipeline(f.api, quiet);
  const sheet = await sheetFor(p, 'girl');
  console.log('    pontuação de colisão:', JSON.stringify(sheet.scores), '→', sheet.keyColor);
  ok(sheet.keyColor !== null, `há cor-chave (${sheet.keyColor})`);
  sheet.keyColor = 'green';
  const r = await p.pose('girl', 'speaking', sheet, sig, { primary: 'keyed', compare: false });
  ok(r.meta.path === 'keyed' && r.meta.accepted === true, `keyed verde aceito (${JSON.stringify(r.meta.perPath)})`);
  const r2 = await p.pose('girl', 'speaking', sheet, sig, { primary: 'native', compare: false });
  ok(r2.meta.path === 'native' && r2.meta.accepted === true, 'nativo sem contorno (alfa 253 → 255) aceito');
}

console.log('\nbackground');
{
  const f = fakeApi({ front: '', side: '', keyed: {}, native: async () => new Uint8Array() });
  const p = new ImagePipeline(f.api, quiet);
  const base = await p.background('beach village', 'day', 'calm', sig);
  const m = await sharp(base.bytes).metadata();
  ok(m.width === 1536 && m.height === 864, `base 1536×1024 → palco ${m.width}×${m.height}`);
  ok(/No people/.test(f.calls[0].prompt) && /lower-centre third/.test(f.calls[0].prompt) && f.calls[0].background === 'opaque' && f.calls[0].size === '1536x1024', 'prompt com as restrições fixas; 1536×1024 opaco');
  await p.variant({ id: 'base', bytes: base.base }, 'night', sig);
  ok(f.calls[1].endpoint === 'edits' && f.calls[1].images?.[0].name === 'base.png' && /change only the lighting/.test(f.calls[1].prompt), 'variante: edit da base, só a luz');
  const fit = await fitToStage(await sharp({ create: { width: 1024, height: 1024, channels: 3, background: '#000' } }).png().toBuffer());
  ok(fit.info.width === 1024 && fit.info.height === 576, 'quadrado → 1024×576');
}

console.log(`\n${pass} ok, ${fail} falhas`);
process.exit(fail ? 1 : 0);
