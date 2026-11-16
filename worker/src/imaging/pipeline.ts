// Pipeline de sprites e backgrounds (PLANO-SPRITES-BACKGROUNDS.md, seções 2, 3 e 5).
// Charsheet: front (generations, só texto) → side (edits com o front) → poses (edits com front + side).
// O charsheet nunca passa pelo keyer: front e side usam o mesmo fundo sólido (CHARSHEET_BACKGROUND).
// Poses: caminho com cor-chave (fundo opaco + keyer em Node) ou nativo (background: "transparent"),
// pós-processamento igual nos dois, verificação, nova tentativa e troca de caminho.
import sharp from 'sharp';
import { decodeRgb, decodeRgba, encodePng, keyImage, KeyError, KEY_COLORS, type KeyColorName, type RgbaImage } from './keyer';
import { alignPose, chooseKeyColor, garbageMatte, nativeAlphaCleanup, runChecks, solidSubject, type CheckReport, type KeyChoice } from './postprocess';
import { ExperimentLog } from './experiment';

export type SpritePath = 'keyed' | 'native';
export type ImageCall = {
  endpoint: 'generations' | 'edits';
  prompt: string; size: string; quality: string; background: 'opaque' | 'transparent';
  images?: { name: string; bytes: Uint8Array }[];
  model?: string; // sem ele, o modelo padrão da ImageApi
};
export type ImageCallResult = { bytes: Uint8Array; model: string; ms: number; usage?: unknown; costUsd: number | null };
/** A chamada à API de imagens. Na OpenAI, OpenAiImageApi; nos testes, uma falsa sem custo. */
export interface ImageApi { readonly model: string; call(c: ImageCall, signal: AbortSignal): Promise<ImageCallResult> }

// ---------- configuração ----------
const env = process.env;
/** Fundo do charsheet: o mesmo nos dois (front e side). Preto, como no experimento. */
export const CHARSHEET_BACKGROUND = env.AI_CHARSHEET_BACKGROUND ?? 'black';
export const PRIMARY_PATH: SpritePath = env.AI_SPRITE_PATH === 'native' ? 'native' : 'keyed';
export const COMPARE_PATHS = env.AI_IMAGE_COMPARE_PATHS === '1';
// Modelo do caminho nativo (background: "transparent"). O gpt-image-2 recusa transparência com
// HTTP 400 "Transparent background is not supported for this model" (visto em 2026-11-14).
export const NATIVE_MODEL = env.OPENAI_IMAGE_MODEL_NATIVE ?? '';
export const IMAGE_QUALITY = env.OPENAI_IMAGE_QUALITY ?? 'medium';
export const ART_STYLE = env.AI_ART_STYLE ?? 'Clean stylized 2D anime visual novel art, crisp dark linework, flat cel shading, consistent proportions.';
const SPRITE_SIZE = '1024x1536', BG_SIZE = '1536x1024';
// Palco do player: 16:9 (client/index.html, .stage e .play .pic com aspect-ratio:16/9; o fundo usa object-fit:cover).
export const STAGE_ASPECT = 16 / 9;
const KEY_LIMIT = Number(env.AI_KEY_COLLISION_LIMIT ?? '0.02');

// ---------- prompts ----------
export function frontPrompt(design: string): string {
  return `Create a single FRONT VIEW character reference image, full body, neutral standing pose facing the camera, arms slightly away from the body. ${design} ${ART_STYLE} Plain solid ${CHARSHEET_BACKGROUND} background. Entire character from top of head to feet visible with generous margin. One character, one view only, no labels, no text, no ground shadow. Portrait canvas.`;
}
export function sidePrompt(design: string): string {
  return `${design} ${ART_STYLE} Full body, standing straight, left side profile view, neutral calm expression, visual novel character reference, plain solid ${CHARSHEET_BACKGROUND} background, soft even studio lighting, consistent character design. The attached image is the front identity reference ONLY. Generate ONE SINGLE character in ONE SINGLE strict side profile view, facing toward the left edge of the image. Preserve exactly the character design, colours, clothing and accessories from the reference. The full body from top of head to soles must be visible, centered on a portrait canvas. Same plain solid ${CHARSHEET_BACKGROUND} background as the reference. This output is a separate side-view reference image. Do not show a front view, multiple characters, multiple views, panels, comparison, collage, contact sheet or turnaround sheet. One character, one side view only. No labels, no text, no ground shadow.`;
}
export function backgroundSentence(path: SpritePath, key?: KeyColorName): string {
  if (path === 'native') return 'Transparent background, also in gaps between limbs, hair and fingers. No scenery, no floor shadow, no text.';
  const k = KEY_COLORS[key!];
  return `Background: perfectly flat bright chroma ${key} ${k.hex} throughout, also in gaps between limbs, hair and fingers. Keep the character's own colours. No scenery, no floor shadow, no text, no gradients or texture in background. Output opaque RGB.`;
}
export function posePrompt(design: string, pose: string, path: SpritePath, key?: KeyColorName): string {
  return `Use Image 1 as the front character reference and Image 2 as the side character reference. Generate the same character in one new full-body pose: ${pose}. Preserve the reference's exact colours, clothing, face, proportions and illustration style. ${design} ${ART_STYLE} The silhouette must be clearly different from the reference standing pose: a simple conversational gesture, both feet on the ground. Entire character, hands, feet and hair visible with generous margin. Single character, single pose, portrait canvas. ${backgroundSentence(path, key)}`;
}
const LIGHTING: Record<string, string> = {
  day: 'bright daylight', sunset: 'warm sunset light with long soft shadows', night: 'night, moonlight and practical lights', rain: 'overcast rainy weather with wet surfaces and falling rain',
  interior: 'soft interior lighting', water: 'bright daylight reflecting on the water',
};
export function backgroundPrompt(location: string, time = '', mood = ''): string {
  return `Background art for a visual novel. Location: ${location}.${time ? ` Time of day: ${LIGHTING[time] ?? time}.` : ''}${mood ? ` Mood: ${mood}.` : ''} ${ART_STYLE} No people, no characters, no text, no signs with writing, no watermark. Eye-level camera. Leave an open floor area in the lower-centre third of the image where characters can stand. No strong foreground objects covering the lower edge. Landscape composition.`;
}
export function variantPrompt(variant: string): string {
  return `Same place, same composition, same camera and objects; change only the lighting to ${LIGHTING[variant] ?? variant}. No people, no characters, no text. Keep the open floor area in the lower-centre third.`;
}

// ---------- tipos do charsheet ----------
export type Unit = { height: number; feetY: number; canvasWidth: number; canvasHeight: number };
export type FrontMeta = { unit: Unit; keyChoice: KeyChoice; charsheetBackground: string };
export type SheetRefs = { sheetId: string; front: { id: string; bytes: Uint8Array }; side: { id: string; bytes: Uint8Array }; keyColor: KeyColorName | null; unit: Unit };

type Out = { bytes: Uint8Array; contentType: string; meta: Record<string, unknown> };

const callInfo = (c: ImageCall, model: string) => ({ endpoint: c.endpoint, model, size: c.size, quality: c.quality, background: c.background, prompt: c.prompt, references: c.images?.map(i => i.name) ?? [] });

export class ImagePipeline {
  constructor(private readonly api: ImageApi, private readonly log = (...a: unknown[]) => console.log('[imagens]', ...a)) {}

  /** Front: só texto. Mede a altura do personagem (unidade das poses) e escolhe a cor-chave. */
  async front(design: string, signal: AbortSignal): Promise<Out & { meta: FrontMeta & Record<string, unknown> }> {
    const ex = new ExperimentLog('front', design);
    const call: ImageCall = { endpoint: 'generations', prompt: frontPrompt(design), size: SPRITE_SIZE, quality: IMAGE_QUALITY, background: 'opaque' };
    const r = await this.api.call(call, signal);
    const raw = ex.file('front.png', r.bytes);
    const rgb = await decodeRgb(r.bytes);
    const subj = solidSubject(rgb);
    const unit: Unit = { height: subj.box.y1 - subj.box.y0, feetY: subj.box.y1, canvasWidth: rgb.width, canvasHeight: rgb.height };
    const keyChoice = chooseKeyColor(rgb, { limit: KEY_LIMIT });
    this.log(`front: ${r.ms} ms, altura ${unit.height}px, cor-chave ${keyChoice.color ?? 'nenhuma (nativo)'}`, keyChoice.scores);
    ex.attempt({ ...callInfo(call, r.model), ms: r.ms, usage: r.usage, costUsd: r.costUsd, raw });
    await ex.finish({ keyChoice, unit, charsheetBackground: CHARSHEET_BACKGROUND, subjectBox: subj.box, sampledBackground: subj.background });
    return { bytes: r.bytes, contentType: 'image/png', meta: { unit, keyChoice, charsheetBackground: CHARSHEET_BACKGROUND, model: r.model, ms: r.ms, costUsd: r.costUsd } };
  }

  /** Side: edit com o front. */
  async side(design: string, front: { id: string; bytes: Uint8Array }, signal: AbortSignal): Promise<Out> {
    const ex = new ExperimentLog('side', design, { frontRef: front.id });
    const call: ImageCall = { endpoint: 'edits', prompt: sidePrompt(design), size: SPRITE_SIZE, quality: IMAGE_QUALITY, background: 'opaque', images: [{ name: 'front.png', bytes: front.bytes }] };
    const r = await this.api.call(call, signal);
    const raw = ex.file('side.png', r.bytes);
    ex.attempt({ ...callInfo(call, r.model), ms: r.ms, usage: r.usage, costUsd: r.costUsd, raw });
    await ex.finish();
    this.log(`side: ${r.ms} ms`);
    return { bytes: r.bytes, contentType: 'image/png', meta: { model: r.model, ms: r.ms, costUsd: r.costUsd } };
  }

  /** Uma tentativa num caminho: geração, recorte/limpeza, garbage matte e verificações. */
  private async attempt(design: string, pose: string, path: SpritePath, sheet: SheetRefs, ex: ExperimentLog, n: number, signal: AbortSignal) {
    const key = path === 'keyed' ? sheet.keyColor! : undefined;
    const call: ImageCall = {
      endpoint: 'edits', prompt: posePrompt(design, pose, path, key), size: SPRITE_SIZE, quality: IMAGE_QUALITY,
      background: path === 'keyed' ? 'opaque' : 'transparent',
      images: [{ name: 'front.png', bytes: sheet.front.bytes }, { name: 'side.png', bytes: sheet.side.bytes }],
      ...(path === 'native' && NATIVE_MODEL ? { model: NATIVE_MODEL } : {}),
    };
    const t0 = performance.now();
    let r: ImageCallResult;
    try {
      r = await this.api.call(call, signal);
    } catch (e) {
      // Tempo esgotado encerra o pedido; erro da API conta como tentativa falha deste caminho.
      // 4xx (ex.: "Transparent background is not supported for this model") não adianta repetir.
      if (signal.aborted || /TIMEOUT/.test(String((e as Error).message))) throw e;
      const status = (e as { status?: number }).status;
      let detail = '';
      try { detail = JSON.parse((e as { body?: string }).body ?? '').error?.message ?? ''; } catch {}
      const error = `api:${status ?? 'rede'}${detail ? ' ' + detail : ''}`;
      ex.attempt({ n, path, ok: false, error, ...callInfo(call, call.model ?? this.api.model), totalMs: Math.round(performance.now() - t0) });
      this.log(`pose ${path}#${n}: falhou ${error}`);
      return { rgba: null, ok: false, checks: null, error, costUsd: 0, ms: 0, failedCount: 99, fatal: status != null && status >= 400 && status < 500 };
    }
    const raw = ex.file(`${path}-${n}-raw.png`, r.bytes);
    let rgba: RgbaImage | null = null, rawRgba: RgbaImage | undefined, keyInfo: Record<string, unknown> | undefined, cleanup: unknown, error: string | undefined;
    try {
      if (path === 'keyed') {
        const k = keyImage(await decodeRgb(r.bytes), key!);
        rgba = k.rgba;
        keyInfo = { color: k.color, background: k.background, screenExcess: k.screenExcess, cornerMedians: k.corners.medians, cornerMaxDeviation: k.corners.maxDeviation };
      } else {
        rgba = await decodeRgba(r.bytes);
        rawRgba = { ...rgba, data: rgba.data.slice() };
        cleanup = nativeAlphaCleanup(rgba);
      }
    } catch (e) {
      error = e instanceof KeyError ? `key:${e.code}` : String((e as Error).message ?? e);
      if (e instanceof KeyError) keyInfo = { color: key, error: e.message };
      else throw e;
    }
    const matte = rgba ? garbageMatte(rgba) : null;
    const checks: CheckReport | null = rgba ? runChecks(rgba, path === 'keyed' ? key! : null, undefined, rawRgba) : null;
    const ok = !!checks?.ok;
    const processed = rgba ? ex.file(`${path}-${n}-processed.png`, await encodePng(rgba)) : undefined;
    const rec = {
      n, path, ok, error, ...callInfo(call, r.model), apiMs: r.ms, totalMs: Math.round(performance.now() - t0), usage: r.usage, costUsd: r.costUsd,
      raw, processed, key: keyInfo, nativeCleanup: cleanup,
      matte: matte && { removed: matte.removed, removedAlphaPixels: matte.removedAlphaPixels, keptComponents: matte.kept.length },
      checks,
    };
    ex.attempt(rec);
    if (matte?.removed.length) this.log(`pose ${path}#${n}: garbage matte removeu ${matte.removed.length} pedaço(s), ${matte.removedAlphaPixels} px`, matte.removed.map(c => ({ area: c.area, box: c.box })));
    this.log(`pose ${path}#${n}: ${ok ? 'ok' : 'falhou ' + (error ?? checks?.failed.join(','))} (${r.ms} ms)`);
    return { rgba, ok, checks, error, costUsd: r.costUsd, ms: r.ms, failedCount: error ? 99 : checks?.failed.length ?? 99, fatal: false };
  }

  /** Até duas tentativas num caminho (a primeira e uma nova tentativa). */
  private async tryPath(design: string, pose: string, path: SpritePath, sheet: SheetRefs, ex: ExperimentLog, counter: { n: number }, signal: AbortSignal) {
    const tries = [];
    for (let i = 0; i < 2; i++) {
      const a = await this.attempt(design, pose, path, sheet, ex, ++counter.n, signal);
      tries.push(a);
      if (a.ok || a.fatal) break;
    }
    return tries;
  }

  /**
   * Pose: caminho principal (até 2 tentativas) e, se falhar, o outro (até 2). Sem cor-chave
   * possível, só o nativo. compare: roda os dois caminhos inteiros (sem troca) para o experimento.
   */
  async pose(design: string, pose: string, sheet: SheetRefs, signal: AbortSignal, opts: { compare?: boolean; primary?: SpritePath } = {}): Promise<Out> {
    const compare = opts.compare ?? COMPARE_PATHS;
    const primary: SpritePath = sheet.keyColor ? opts.primary ?? PRIMARY_PATH : 'native';
    const other: SpritePath = primary === 'keyed' ? 'native' : 'keyed';
    const paths: SpritePath[] = sheet.keyColor ? [primary, other] : ['native'];
    const ex = new ExperimentLog('pose', pose, { sheetId: sheet.sheetId, references: { front: sheet.front.id, side: sheet.side.id }, keyColor: sheet.keyColor, primary, compare });
    const t0 = performance.now();
    try {
      return await this.poseLogged(design, pose, sheet, signal, ex, compare, primary, paths, t0);
    } catch (e) {
      // O meta.json fica gravado também quando o pedido aborta.
      await ex.finish({ accepted: false, error: String((e as Error).message ?? e), totalMs: Math.round(performance.now() - t0) }).catch(() => {});
      throw e;
    }
  }

  private async poseLogged(design: string, pose: string, sheet: SheetRefs, signal: AbortSignal, ex: ExperimentLog, compare: boolean, primary: SpritePath, paths: SpritePath[], t0: number): Promise<Out> {
    const counter = { n: 0 };
    const byPath: Partial<Record<SpritePath, Awaited<ReturnType<ImagePipeline['tryPath']>>>> = {};
    for (const p of paths) {
      byPath[p] = await this.tryPath(design, pose, p, sheet, ex, counter, signal);
      if (!compare && byPath[p]!.at(-1)!.ok) break;
    }
    const all = paths.flatMap(p => byPath[p] ?? []);
    const okFirst = paths.map(p => byPath[p]?.find(a => a.ok)).find(Boolean);
    const chosen = okFirst ?? all.filter(a => a.rgba).sort((a, b) => a.failedCount - b.failedCount)[0];
    if (!chosen?.rgba) { await ex.finish({ accepted: false, totalMs: Math.round(performance.now() - t0) }); throw new Error('AI_INVALID_OUTPUT'); }
    const chosenPath = paths.find(p => byPath[p]?.includes(chosen))!;
    const aligned = await alignPose(chosen.rgba, sheet.unit);
    if (aligned.info.clippedPixels) this.log(`pose "${pose}": alinhamento cortou ${aligned.info.clippedPixels} px fora da tela`);
    const bytes = await encodePng(aligned.image);
    const final = ex.file('final.png', bytes);
    const costs = all.map(a => a.costUsd);
    const summary = {
      accepted: !!okFirst, path: chosenPath, fellBack: chosenPath !== primary,
      retries: Object.fromEntries(paths.map(p => [p, Math.max(0, (byPath[p]?.length ?? 0) - 1)])),
      perPath: Object.fromEntries(paths.filter(p => byPath[p]).map(p => [p, { attempts: byPath[p]!.length, ok: byPath[p]!.some(a => a.ok) }])),
      alignment: aligned.info, final, generations: all.length,
      totalMs: Math.round(performance.now() - t0), costUsd: costs.every(c => c != null) ? costs.reduce((s, c) => s! + c!, 0) : null,
    };
    if (!okFirst) this.log(`pose "${pose}": nenhuma tentativa passou nas verificações; fica a com menos falhas (${chosenPath})`);
    await ex.finish(summary);
    return { bytes, contentType: 'image/png', meta: summary };
  }

  /** Background base: 1536×1024 opaco, encaixado no palco 16:9. */
  async background(location: string, time: string, mood: string, signal: AbortSignal): Promise<Out & { base: Uint8Array }> {
    const ex = new ExperimentLog('background', location);
    const call: ImageCall = { endpoint: 'generations', prompt: backgroundPrompt(location, time, mood), size: BG_SIZE, quality: IMAGE_QUALITY, background: 'opaque' };
    return this.finishBackground(call, ex, signal);
  }

  /** Variante: edit da base (mesma composição, só a luz muda). */
  async variant(base: { id: string; bytes: Uint8Array }, variant: string, signal: AbortSignal): Promise<Out & { base: Uint8Array }> {
    const ex = new ExperimentLog('bg-variant', variant, { baseRef: base.id });
    const call: ImageCall = { endpoint: 'edits', prompt: variantPrompt(variant), size: BG_SIZE, quality: IMAGE_QUALITY, background: 'opaque', images: [{ name: 'base.png', bytes: base.bytes }] };
    return this.finishBackground(call, ex, signal);
  }

  private async finishBackground(call: ImageCall, ex: ExperimentLog, signal: AbortSignal) {
    const r = await this.api.call(call, signal);
    const raw = ex.file('raw.png', r.bytes);
    const fit = await fitToStage(r.bytes);
    const out = ex.file('stage.webp', fit.bytes);
    ex.attempt({ ...callInfo(call, r.model), ms: r.ms, usage: r.usage, costUsd: r.costUsd, raw, processed: out, fit: fit.info });
    await ex.finish();
    this.log(`background (${call.endpoint}): ${r.ms} ms → ${fit.info.width}×${fit.info.height}`);
    return { bytes: fit.bytes, contentType: 'image/webp', base: r.bytes, meta: { model: r.model, ms: r.ms, costUsd: r.costUsd, fit: fit.info } };
  }
}

/** Recorte central para o aspecto do palco (1536×1024 → 1536×864). */
export async function fitToStage(bytes: Uint8Array, aspect = STAGE_ASPECT): Promise<{ bytes: Uint8Array; info: { width: number; height: number; left: number; top: number } }> {
  const img = sharp(bytes);
  const { width = 0, height = 0 } = await img.metadata();
  let w = width, h = Math.round(width / aspect);
  if (h > height) { h = height; w = Math.round(height * aspect); }
  const left = Math.floor((width - w) / 2), top = Math.floor((height - h) / 2);
  const out = await img.extract({ left, top, width: w, height: h }).webp({ quality: 88 }).toBuffer();
  return { bytes: out, info: { width: w, height: h, left, top } };
}
