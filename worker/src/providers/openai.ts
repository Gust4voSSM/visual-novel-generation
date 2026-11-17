import { ImagePipeline, type ImageApi, type ImageCall, type ImageCallResult } from '../imaging/pipeline';
import type { AiProvider, BackgroundBrief, ChatInput, ChatResult, CompleteInput, GeneratedImage, ImageRef, ImageRequest, OptionInput, Proposal, ProposalProgress, SceneInput, StorySnapshot, SuggestedScene } from './types';
import { BG_ENHANCER, BG_SCHEMA, COAUTHOR, historyMessages, OPTION_SCHEMA, PROPOSE_TOOL, SCENE_SCHEMA, storyBrief, systemPrompt, TEXT_RULES, TEXT_SCHEMA } from '../prompts';
import { buildProposal, cleanSpeech, speechProblem, type ProposeArgs } from '../proposal';
import { partialJsonString, proposalProgress, sseEvents } from '../stream';
import { clip } from '../util';

// ---------- OpenAI ----------
const OPENAI_URL = 'https://api.openai.com/v1';
// gpt-6-luna com raciocínio low: na comparação com os pedidos reais do chat (gpt-5-mini, gpt-5.4-mini/nano,
// gpt-5.5), foi o mais rápido (1º texto em ~1 s, resposta em ~3 s) com propostas válidas e boa qualidade.
const CHAT_MODEL = process.env.OPENAI_CHAT_MODEL ?? 'gpt-6-luna';
const REASONING_EFFORT = process.env.OPENAI_REASONING_EFFORT ?? (/^(gpt-[56]|o\d)/.test(CHAT_MODEL) ? 'low' : undefined);
const IMAGE_MODEL = process.env.OPENAI_IMAGE_MODEL ?? 'gpt-image-2.5-flare';
const IMAGE_QUALITY = process.env.OPENAI_IMAGE_QUALITY ?? 'medium'; // low | medium | high

// Preço por 1M de tokens (US$) para o custo no modo experimento. Sem os três, o custo fica null
// e o meta.json guarda só o usage da resposta.
const IMAGE_PRICE = ['OPENAI_IMAGE_PRICE_TEXT_IN', 'OPENAI_IMAGE_PRICE_IMAGE_IN', 'OPENAI_IMAGE_PRICE_IMAGE_OUT'].map(k => Number(process.env[k]));

/** Chamadas a /images/generations e /images/edits (multipart, várias imagens de referência). */
export class OpenAiImageApi implements ImageApi {
  readonly model = IMAGE_MODEL;
  constructor(private readonly key: string) {}

  async call(c: ImageCall, signal: AbortSignal): Promise<ImageCallResult> {
    const fields: Record<string, string> = {
      model: c.model ?? this.model, prompt: c.prompt, n: '1', size: c.size, quality: c.quality, background: c.background, output_format: 'png',
    };
    let init: RequestInit;
    if (c.endpoint === 'generations') {
      init = { body: JSON.stringify({ ...fields, n: 1 }), headers: { Authorization: `Bearer ${this.key}`, 'Content-Type': 'application/json' } };
    } else {
      const form = new FormData();
      for (const [k, v] of Object.entries(fields)) form.append(k, v);
      for (const img of c.images ?? []) form.append('image[]', new Blob([img.bytes as Uint8Array<ArrayBuffer>], { type: 'image/png' }), img.name);
      init = { body: form, headers: { Authorization: `Bearer ${this.key}` } };
    }
    const t0 = performance.now();
    let res: Response;
    try {
      res = await fetch(`${OPENAI_URL}/images/${c.endpoint}`, { method: 'POST', signal, ...init });
    } catch (e) {
      if (signal.aborted) throw new Error('TIMEOUT');
      console.error('openai: falha de rede (imagem)', e);
      throw new Error('AI_PROVIDER_ERROR');
    }
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      console.error(`openai /images/${c.endpoint}: HTTP ${res.status}`, clip(body, 400));
      throw Object.assign(new Error('AI_PROVIDER_ERROR'), { status: res.status, body });
    }
    const json = await res.json();
    const b64 = json.data?.[0]?.b64_json;
    if (!b64) { console.error('openai: resposta de imagem sem dados'); throw new Error('AI_PROVIDER_ERROR'); }
    return { bytes: Buffer.from(b64, 'base64'), model: c.model ?? this.model, ms: Math.round(performance.now() - t0), usage: json.usage, costUsd: imageCost(json.usage) };
  }
}

/** Charsheet, poses e variantes de background pelo pipeline (seção 2 e 3 do plano). */
export async function pipelineImage(p: ImagePipeline, req: Exclude<ImageRequest, { kind: 'sprite' | 'background' }>, signal: AbortSignal): Promise<GeneratedImage> {
  const need = (r: ImageRef | undefined, what: string) => {
    if (!r?.bytes) { console.error(`imagem: referência ${what} sem bytes (${r?.id ?? 'ausente'})`); throw new Error('INVALID_INPUT'); }
    return { id: r.id, bytes: r.bytes };
  };
  if (req.kind === 'reference') return req.reference === 'front' ? p.front(req.design, signal) : p.side(req.design, need(req.front, 'front'), signal);
  if (req.kind === 'background-variant') return p.variant(need(req.base, 'base'), req.variant, signal);
  if (!req.refs.unit) { console.error('imagem: pose sem a unidade do front'); throw new Error('INVALID_INPUT'); }
  return p.pose(req.design, req.pose, {
    sheetId: req.refs.sheetId, front: need(req.refs.front, 'front'), side: need(req.refs.side, 'side'), keyColor: req.refs.keyColor, unit: req.refs.unit,
  }, signal, { compare: req.compare });
}

function imageCost(u: any): number | null {
  if (!u || IMAGE_PRICE.some(p => !Number.isFinite(p))) return null;
  const d = u.input_tokens_details ?? {};
  const text = d.text_tokens ?? 0, image = d.image_tokens ?? Math.max(0, (u.input_tokens ?? 0) - text);
  return (text * IMAGE_PRICE[0] + image * IMAGE_PRICE[1] + (u.output_tokens ?? 0) * IMAGE_PRICE[2]) / 1e6;
}

// Tentativas por mensagem do chat quando a proposta vem inválida (a primeira + correções).
const CHAT_ATTEMPTS = Math.max(1, Number(process.env.OPENAI_CHAT_ATTEMPTS ?? '3') || 3);

// Mesma ferramenta no formato da API Responses (sem o envelope "function"). strict: false porque
// alterar aceita campos opcionais; a validação fica no buildProposal, com correção pelo modelo.
const THOUGHT_BREAK = '\u0000'; // stream → chat: começa um parágrafo do resumo
const RESPONSES_TOOL = { type: 'function', ...PROPOSE_TOOL.function, strict: false } as const;

export class OpenAiProvider implements AiProvider {
  readonly name: string;
  private summaries = true; // desliga sozinho se a organização não puder receber o resumo do raciocínio
  private readonly pipeline: ImagePipeline;
  constructor(private readonly key: string, private readonly images: AiProvider | null) {
    this.name = images ? 'openai (imagens: mock)' : `openai (imagens: ${IMAGE_MODEL})`;
    this.pipeline = new ImagePipeline(new OpenAiImageApi(key));
  }

  private async post(path: string, body: unknown, signal: AbortSignal): Promise<Response> {
    let res: Response;
    try {
      res = await fetch(OPENAI_URL + path, {
        method: 'POST', signal,
        headers: { Authorization: `Bearer ${this.key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    } catch (e) {
      if (signal.aborted) throw new Error('TIMEOUT');
      console.error('openai: falha de rede', e);
      throw new Error('AI_PROVIDER_ERROR');
    }
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      console.error(`openai ${path}: HTTP ${res.status}`, clip(body, 400));
      if (res.status === 401) throw new Error('AI_KEY_INVALID');
      throw Object.assign(new Error('AI_PROVIDER_ERROR'), { status: res.status, body });
    }
    return res;
  }

  // Confere a chave antes de assumir pedidos (GET /models não gasta tokens). Chave recusada derruba
  // o worker com uma mensagem clara, em vez de cada pedido falhar com um erro genérico.
  async verify(): Promise<void> {
    let res: Response;
    try {
      res = await fetch(OPENAI_URL + '/models', { headers: { Authorization: `Bearer ${this.key}` }, signal: AbortSignal.timeout(15_000) });
    } catch (e) {
      console.warn('openai: não deu para conferir a chave agora (rede); seguindo', String(e).slice(0, 120));
      return;
    }
    if (res.status === 401) throw new Error('AI_KEY_INVALID');
    if (!res.ok) console.warn(`openai: conferência da chave respondeu HTTP ${res.status}; seguindo`);
  }

  // Uma ida ao modelo pela API Responses, em streaming. onText recebe o texto livre ou, sem ele, o
  // campo resposta da primeira chamada da ferramenta; null não transmite nada (tentativas de correção).
  // onThought recebe o resumo do raciocínio enquanto o modelo pensa.
  private async stream(
    req: { input: unknown[]; previous?: string; forceTool: boolean },
    onText: ((t: string) => void) | null, onThought: (t: string) => void, signal: AbortSignal,
    onArgs: (args: string, done: boolean) => void,
  ) {
    const body = (summary: boolean) => ({
      model: CHAT_MODEL,
      stream: true,
      input: req.input,
      ...(req.previous ? { previous_response_id: req.previous } : {}),
      tools: [RESPONSES_TOOL],
      tool_choice: req.forceTool ? { type: 'function', name: RESPONSES_TOOL.name } : 'auto',
      // só modelos gpt-5/o*; o resumo pode ser recusado para organizações não verificadas
      ...(REASONING_EFFORT ? { reasoning: { effort: REASONING_EFFORT, ...(summary ? { summary: 'auto' } : {}) } } : {}),
    });
    let res: Response;
    try {
      res = await this.post('/responses', body(this.summaries), signal);
    } catch (e) {
      const err = e as { status?: number; body?: string };
      if (!this.summaries || err.status !== 400 || !/summar|verif/i.test(err.body ?? '')) throw e;
      console.error('openai: resumo do raciocínio indisponível para esta organização; seguindo sem ele');
      this.summaries = false;
      res = await this.post('/responses', body(false), signal);
    }

    let id = '', content = '';
    const usage = { input: 0, output: 0, reasoning: 0 };
    const calls = new Map<number, { id: string; name: string; args: string }>();
    let speaker: number | null = null;
    try {
      for await (const data of sseEvents(res.body!)) {
        const ev = JSON.parse(data);
        switch (ev.type) {
          case 'response.created': id = ev.response.id; break;
          case 'response.reasoning_summary_part.added': onThought(THOUGHT_BREAK); break;
          case 'response.reasoning_summary_text.delta': onThought(ev.delta); break;
          case 'response.output_text.delta':
            if (speaker === null) { content += ev.delta; onText?.(ev.delta); }
            break;
          case 'response.output_item.added':
            if (ev.item?.type === 'function_call') {
              calls.set(ev.output_index, { id: ev.item.call_id, name: ev.item.name, args: '' });
              speaker ??= content.trim() ? -1 : ev.output_index;
            }
            break;
          case 'response.function_call_arguments.delta': {
            const c = calls.get(ev.output_index);
            if (!c) break;
            c.args += ev.delta;
            if (c.name === RESPONSES_TOOL.name) onArgs(c.args, false);
            if (ev.output_index === speaker) {
              const said = partialJsonString(c.args, 'resposta');
              if (said.length > content.length) { onText?.(said.slice(content.length)); content = said; }
            }
            break;
          }
          case 'response.output_item.done':
            if (ev.item?.type === 'function_call' && calls.has(ev.output_index)) {
              const c = calls.get(ev.output_index)!;
              c.args = ev.item.arguments;
              if (c.name === RESPONSES_TOOL.name) onArgs(c.args, true);
            }
            break;
          case 'response.completed':
            usage.input = ev.response?.usage?.input_tokens ?? 0;
            usage.output = ev.response?.usage?.output_tokens ?? 0;
            usage.reasoning = ev.response?.usage?.output_tokens_details?.reasoning_tokens ?? 0;
            break;
          case 'response.failed': case 'response.incomplete': case 'error':
            console.error('openai: resposta interrompida', clip(JSON.stringify(ev.response?.error ?? ev.response?.incomplete_details ?? ev), 400));
            throw new Error('AI_PROVIDER_ERROR');
        }
      }
    } catch (e) {
      if (signal.aborted) throw new Error('TIMEOUT');
      if ((e as Error).message === 'AI_PROVIDER_ERROR') throw e;
      console.error('openai: stream interrompido', e);
      throw new Error('AI_PROVIDER_ERROR');
    }
    return { id, content, calls: [...calls.entries()].sort((a, b) => a[0] - b[0]).map(([, c]) => c), usage };
  }

  async chat(
    input: ChatInput, story: StorySnapshot, onText: (t: string) => void, signal: AbortSignal,
    onThought?: (t: string) => void, onProgress?: (p: ProposalProgress) => void,
  ): Promise<ChatResult> {
    let thoughts = '';
    let attempt = 1, lastAt = 0;
    // Ler o JSON parcial a cada pedaço custa O(n); a cada 200 ms basta para a tela.
    const progress = (args: string, done: boolean) => {
      if (!onProgress || (!done && performance.now() - lastAt < 200)) return;
      lastAt = performance.now();
      const p = proposalProgress(args, story, attempt);
      if (p) onProgress(p);
    };
    const think = (t: string) => {
      if (t === THOUGHT_BREAK) t = thoughts && !thoughts.endsWith('\n\n') ? '\n\n' : ''; // parágrafo novo do resumo
      if (!t) return;
      thoughts += t;
      onThought?.(t);
    };
    let req: { input: unknown[]; previous?: string; forceTool: boolean } = {
      input: [
        { role: 'system', content: systemPrompt(input.context, story) },
        ...historyMessages(input.history),
        { role: 'user', content: input.message },
      ],
      forceTool: false,
    };
    let content = '';
    const proposals: Proposal[] = [];
    let problems: string[] = [];
    const spent = { input: 0, output: 0, reasoning: 0 };
    // Proposta inválida volta ao modelo como resultado da ferramenta, com os erros, para ele corrigir.
    // A correção continua a mesma resposta (previous_response_id), com o raciocínio anterior.
    for (; attempt <= CHAT_ATTEMPTS; attempt++) {
      const retry = attempt > 1;
      if (retry) onProgress?.({ attempt, criar: [], alterar: [], remover: [], ligar: 0 });
      if (retry) think(`${thoughts ? '\n\n' : ''}**Corrigindo a proposta (tentativa ${attempt} de ${CHAT_ATTEMPTS})**\n\n${problems.join('\n')}`);
      const r = await this.stream(req, retry ? null : onText, think, signal, progress);
      for (const k of ['input', 'output', 'reasoning'] as const) spent[k] += r.usage[k];
      if (!retry) content = r.content;
      const own = r.calls.filter(c => c.name === RESPONSES_TOOL.name);
      problems = [];
      const results = own.map(c => {
        let args: ProposeArgs;
        try { args = JSON.parse(c.args) as ProposeArgs; } catch (e) {
          return `os argumentos não são um JSON válido (${String((e as Error).message).slice(0, 120)})`;
        }
        const p = buildProposal(args, input.context, story);
        if (typeof p !== 'string') proposals.push(p);
        return p;
      });
      results.forEach(p => { if (typeof p === 'string') problems.push(p); });
      if (!problems.length) break;
      console.error(`openai: proposta inválida (tentativa ${attempt}/${CHAT_ATTEMPTS}):`, clip(problems.join(' | '), 600));
      req = {
        previous: r.id, forceTool: true,
        input: r.calls.map(c => {
          const p = c.name === RESPONSES_TOOL.name ? results[own.indexOf(c)] : 'Ferramenta desconhecida.';
          return {
            type: 'function_call_output', call_id: c.id,
            output: typeof p === 'string'
              ? `Proposta inválida, não foi mostrada ao usuário. Problemas: ${p}. Corrija e chame propor_mudancas de novo com a proposta inteira corrigida.`
              : 'Proposta válida, já mostrada ao usuário. Não a repita.',
          };
        }),
      };
    }
    console.log(`openai: ${CHAT_MODEL}/${REASONING_EFFORT ?? '-'} · ${attempt > CHAT_ATTEMPTS ? CHAT_ATTEMPTS : attempt} tentativa(s) · tokens entrada ${spent.input}, saída ${spent.output} (raciocínio ${spent.reasoning})`);
    if (!content.trim() && !problems.length) {
      content = proposals.length ? 'Preparei uma proposta. Revise abaixo antes de aceitar.' : 'Não consegui montar uma resposta.';
      onText(content);
    }
    // Esgotadas as tentativas: a resposta pode já ter anunciado a proposta, então avisa.
    if (problems.length) {
      const note = `${content.trim() ? '\n\n' : ''}(Não consegui montar uma proposta válida depois de ${CHAT_ATTEMPTS} tentativas. Peça de novo, talvez com mais detalhes.)`;
      content += note;
      onText(note);
    }
    return { content, proposals, ...(thoughts ? { thoughts } : {}) };
  }

  async image(req: ImageRequest, signal: AbortSignal): Promise<GeneratedImage> {
    if (this.images) return this.images.image(req, signal);
    if (req.kind !== 'sprite' && req.kind !== 'background') return pipelineImage(this.pipeline, req, signal);
    if (req.kind === 'background') return this.pipeline.background(req.prompt, req.time ?? '', req.mood ?? '', signal);
    // Geração única antiga (sem charsheet), mantida para pedidos 'sprite'.
    const prompt = `Sprite de personagem para visual novel, estilo anime, corpo da cintura para cima, de frente, fundo transparente, sem texto. ${req.prompt}`;
    const res = await this.post('/images/generations', {
      model: IMAGE_MODEL, prompt, n: 1,
      size: '1024x1536',
      quality: IMAGE_QUALITY,
      background: 'transparent',
      output_format: 'webp',
      output_compression: 80,
    }, signal);
    const b64 = (await res.json()).data?.[0]?.b64_json;
    if (!b64) { console.error('openai: resposta de imagem sem dados'); throw new Error('AI_PROVIDER_ERROR'); }
    return { bytes: Buffer.from(b64, 'base64'), contentType: 'image/webp' };
  }

  // Resposta única em JSON (sem streaming), validada pelo esquema da OpenAI.
  private async json<T>(name: string, schema: object, system: string, user: string, signal: AbortSignal): Promise<T> {
    const res = await this.post('/chat/completions', {
      model: CHAT_MODEL,
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
      response_format: { type: 'json_schema', json_schema: { name, strict: true, schema } },
      ...(REASONING_EFFORT ? { reasoning_effort: REASONING_EFFORT } : {}),
    }, signal);
    const raw = (await res.json()).choices?.[0]?.message?.content;
    try { return JSON.parse(raw) as T; } catch {
      console.error(`openai ${name}: resposta sem JSON`, clip(String(raw), 300));
      throw new Error('AI_INVALID_OUTPUT');
    }
  }

  async enhanceBackground(input: { name: string; desc: string }, signal: AbortSignal): Promise<BackgroundBrief> {
    const out = await this.json<BackgroundBrief>('background', BG_SCHEMA, BG_ENHANCER,
      `Name: ${clip(input.name, 80)}\nDescription: ${clip(input.desc, 1500) || '(none)'}`, signal);
    const scene = String(out.scene ?? '').trim();
    if (!scene) throw new Error('AI_INVALID_OUTPUT');
    return { scene: clip(scene, 1200), time: clip(String(out.time ?? '').trim(), 60), mood: clip(String(out.mood ?? '').trim(), 120) };
  }

  async scene(input: SceneInput, story: StorySnapshot, signal: AbortSignal): Promise<SuggestedScene> {
    const src = story.scenes.find(s => s.id === input.sourceSceneId);
    if (!src) throw new Error('NOT_FOUND');
    const ch = story.choices.find(c => c.id === input.choiceId);
    const exit = ch ? `a ação "${ch.label || '(ainda sem rótulo)'}" da cena "${src.title}"` : `a saída única da cena "${src.title}"`;
    const out = await this.json<SuggestedScene>('cena_sugerida', SCENE_SCHEMA, `${COAUTHOR}
Escreva uma única cena nova, curta, que continua a história. Use somente ids que aparecem abaixo.
Personagens só entram com um sprite deles; em dialogue, quem fala precisa estar na cena. body tem 1 a 3 frases.
${TEXT_RULES}
action_label é um rótulo curto (até 6 palavras) para a ação que leva a esta cena.

${storyBrief(input.context, story)}`, `A cena nova vem depois de ${exit}.${input.instruction ? ` Instrução: ${input.instruction}` : ''}`, signal);
    // Descarta o que não existe no contexto em vez de recusar a cena inteira.
    const chars = new Map(input.context.characters.map(c => [c.id, new Set(c.sprites.map(s => s.id))]));
    const seen = new Set<string>();
    const cast = (out.characters ?? []).filter(m => chars.get(m.character_id)?.has(m.sprite_id) && !seen.has(m.character_id) && seen.add(m.character_id)).slice(0, 6);
    const dialogue = out.text_kind === 'dialogue' && cast.some(m => m.character_id === out.speaker_character_id);
    return {
      title: clip(out.title || 'Nova cena', 80),
      background_id: input.context.backgrounds.some(b => b.id === out.background_id) ? out.background_id : '',
      characters: cast,
      text_kind: dialogue ? 'dialogue' : 'narration',
      speaker_character_id: dialogue ? out.speaker_character_id : '',
      // Fala com narração dentro: o texto serve como narração (sem laço de correção nesta chamada).
      ...(dialogue && speechProblem(cleanSpeech(out.body ?? ''), input.context.characters.find(c => c.id === out.speaker_character_id)?.name ?? '')
        ? { text_kind: 'narration' as const, speaker_character_id: '' } : {}),
      body: dialogue ? cleanSpeech(out.body ?? '') : out.body ?? '',
      action_label: clip(out.action_label || 'Continuar', 60),
    };
  }

  async complete(input: CompleteInput, story: StorySnapshot, signal: AbortSignal): Promise<{ text: string }> {
    const sc = story.scenes.find(s => s.id === input.sceneId);
    const who = input.textKind === 'dialogue' ? `uma fala de ${input.speakerName || 'um personagem'}` : 'uma narração';
    const out = await this.json<{ mode: 'continue' | 'rewrite'; text: string }>('texto', TEXT_SCHEMA, `${COAUTHOR}
Você ajuda a escrever o texto de uma cena. Sem instrução, ou quando a instrução pede para continuar, use mode "continue"
e escreva só o trecho novo (1 a 2 frases) que vem depois do texto atual. Quando a instrução pede para mudar o texto
(ex.: deixar mais tenso, encurtar), use mode "rewrite" e devolva o texto inteiro reescrito.
${input.textKind === 'dialogue' ? `É uma fala de ${input.speakerName || 'um personagem'}: escreva só o que ele diz, em primeira pessoa, sem o nome,
sem aspas ou travessão, sem gestos nem narração.` : 'É uma narração: ambiente, ações e reações, sem falas de personagens.'}

${storyBrief({ characters: [], backgrounds: [] }, story)}`,
    `Cena "${sc?.title ?? ''}", ${who}.\nTexto atual: ${input.text || '(vazio)'}${input.instruction ? `\nInstrução: ${input.instruction}` : ''}`, signal);
    const raw = String(out.text ?? '').trim();
    const text = input.textKind === 'dialogue' ? cleanSpeech(raw) : raw;
    if (!text) throw new Error('AI_INVALID_OUTPUT');
    return { text: out.mode === 'rewrite' || !input.text.trim() ? text : input.text.trimEnd() + ' ' + text };
  }

  async option(input: OptionInput, story: StorySnapshot, signal: AbortSignal): Promise<{ label: string }> {
    const sc = story.scenes.find(s => s.id === input.sceneId);
    if (!sc) throw new Error('NOT_FOUND');
    const others = story.choices.filter(c => c.sceneId === sc.id && c.id !== input.choiceId && c.label).map(c => `"${c.label}"`);
    const out = await this.json<{ label: string }>('acao', OPTION_SCHEMA, `${COAUTHOR}
Sugira uma ação nova que o jogador pode escolher ao fim de uma cena: um rótulo curto (até 6 palavras), no imperativo
ou infinitivo, diferente das ações que a cena já tem e coerente com o que acabou de acontecer.

${storyBrief(input.context, story)}`, `Cena "${sc.title}": ${clip(sc.text, 600) || '(sem texto)'}\nAções que já existem: ${others.join(', ') || 'nenhuma'}`, signal);
    const label = clip(String(out.label ?? '').trim(), 60);
    if (!label) throw new Error('AI_INVALID_OUTPUT');
    return { label };
  }
}
