// Provedores de IA do worker (seção 2.6): mock e OpenAI. A chave da OpenAI vem de
// worker/.env.openai e só este processo a lê.
import type { KeyColorName } from './imaging/keyer';
import { ImagePipeline, type ImageApi, type ImageCall, type ImageCallResult, type Unit } from './imaging/pipeline';

export type StoryScene = {
  id: string; title: string; x: number; y: number; text: string; next: string; bg: string;
  chars: string; kind: string; speaker: string; // chars: JSON [{c, s}], como na tabela scene
};
export type StoryChoice = { id: string; sceneId: string; label: string; target: string; position: number };
export type StorySnapshot = { title: string; startScene: string; scenes: StoryScene[]; choices: StoryChoice[] };

export type AiContext = {
  characters: { id: string; name: string; desc?: string; sprites: { id: string; name: string; desc?: string }[] }[];
  backgrounds: { id: string; name: string; desc?: string }[];
};

// Mesmo formato de operações do apply_operations (seção 2.3).
export type Op =
  | { op: 'upsert_scene'; scene: Record<string, unknown> & { id: string } }
  | { op: 'delete_scene'; id: string }
  | { op: 'upsert_choice'; choice: Record<string, unknown> & { id: string } }
  | { op: 'delete_choice'; id: string };
// created: ids das cenas que a proposta cria; as outras cenas em upsert_scene já existem e são alteradas.
// backgrounds: backgrounds novos que o agente pede; o cliente dispara a geração ao aceitar, com o
// prompt já escrito pelo agente (o worker pula a melhoria de prompt).
export type NewBackground = { id: string; name: string; desc: string; prompt: string; time: string; mood: string };
export type Proposal = { summary: string[]; ops: Op[]; created: string[]; backgrounds?: NewBackground[] };

// history: a conversa anterior desta história, mais antiga primeiro; as propostas vêm resumidas no texto.
export type ChatTurn = { role: 'user' | 'assistant'; content: string };
export type ChatInput = { message: string; context: AiContext; history?: ChatTurn[] };
// thoughts: resumo do raciocínio do modelo, quando o provedor tem (vai junto no resultado do pedido).
export type ChatResult = { content: string; proposals: Proposal[]; thoughts?: string };
// Proposta ainda chegando do modelo: o que já dá para ler dela, para o cliente mostrar o andamento.
export type ProposalProgress = { attempt: number; criar: string[]; alterar: string[]; remover: string[]; ligar: number };
// Pedidos de imagem (PLANO-SPRITES-BACKGROUNDS.md, seção 5). 'sprite' é a geração única antiga.
// Charsheet: 'reference' front (só texto) e side (edit com o front); 'pose' é edit com front + side,
// pelos ids das referências (bytes carregados pelo worker). Backgrounds: base e variantes (edit da base).
export type ImageRef = { id: string; bytes?: Uint8Array };
export type PoseRefs = { sheetId: string; front: ImageRef; side: ImageRef; keyColor: KeyColorName | null; unit?: Unit };
export type ImageRequest =
  | { kind: 'sprite'; prompt: string; hint: string }
  | { kind: 'background'; prompt: string; hint: string; time?: string; mood?: string }
  | { kind: 'background-variant'; base: ImageRef; variant: string; hint: string }
  | { kind: 'reference'; reference: 'front' | 'side'; design: string; front?: ImageRef; hint: string }
  | { kind: 'pose'; design: string; pose: string; hint: string; refs: PoseRefs; compare?: boolean };
// meta: o que o pipeline mediu (unidade e cor-chave do front, caminho e verificações da pose).
// base: background antes do recorte para o palco, para as variantes.
export type GeneratedImage = { bytes?: Uint8Array; contentType?: string; placeholderKey?: string; meta?: Record<string, unknown>; base?: Uint8Array };

// Cena sugerida para uma saída (Shift ao arrastar um fio): mesmo formato da procedure suggest_scene.
export type SceneInput = { sourceSceneId: string; choiceId: string; instruction: string; context: AiContext };
export type SuggestedScene = {
  title: string; background_id: string; characters: { character_id: string; sprite_id: string }[];
  text_kind: 'narration' | 'dialogue'; speaker_character_id: string; body: string; action_label: string;
};
export type CompleteInput = { sceneId: string; text: string; textKind: string; speakerName: string; instruction: string };
// Rótulo de uma ação nova (Shift em "+ ação"): só o texto da opção, sem criar cena.
export type OptionInput = { sceneId: string; choiceId: string; context: AiContext };

export interface AiProvider {
  readonly name: string;
  /** Confere credenciais antes de assumir pedidos; lança AI_KEY_INVALID se forem recusadas. */
  verify?(): Promise<void>;
  /** Resposta do chat em streaming: chama onText a cada pedaço, devolve a mensagem final e as propostas. */
  chat(
    input: ChatInput, story: StorySnapshot, onText: (t: string) => void, signal: AbortSignal,
    onThought?: (t: string) => void, onProgress?: (p: ProposalProgress) => void,
  ): Promise<ChatResult>;
  image(req: ImageRequest, signal: AbortSignal): Promise<GeneratedImage>;
  scene(input: SceneInput, story: StorySnapshot, signal: AbortSignal): Promise<SuggestedScene>;
  complete(input: CompleteInput, story: StorySnapshot, signal: AbortSignal): Promise<{ text: string }>;
  option(input: OptionInput, story: StorySnapshot, signal: AbortSignal): Promise<{ label: string }>;
  /** Reescreve a descrição livre do autor como um prompt de background consistente (em inglês). */
  enhanceBackground(input: { name: string; desc: string }, signal: AbortSignal): Promise<BackgroundBrief>;
}

// Prompt melhorado de background: cena (só o lugar, sem estilo), hora do dia e clima.
export type BackgroundBrief = { scene: string; time: string; mood: string };

export function createProvider(name: string | undefined): AiProvider | null {
  if (name === 'mock') return new MockProvider();
  if (name === 'openai') {
    const key = process.env.OPENAI_API_KEY;
    if (!key) { console.error('AI_PROVIDER=openai sem OPENAI_API_KEY (veja worker/.env.openai).'); process.exit(1); }
    // Imagens ficam no mock até a organização ser verificada (gpt-image-1); AI_IMAGE_PROVIDER=openai liga.
    return new OpenAiProvider(key, process.env.AI_IMAGE_PROVIDER === 'openai' ? null : new MockProvider());
  }
  // 'google': integração pendente.
  return null;
}

// ---------- mock ----------
const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((res, rej) => {
    if (signal.aborted) return rej(new Error('TIMEOUT'));
    const t = setTimeout(res, ms);
    signal.addEventListener('abort', () => { clearTimeout(t); rej(new Error('TIMEOUT')); }, { once: true });
  });
const pick = <T>(a: T[]): T => a[Math.floor(Math.random() * a.length)];
const norm = (s: string) => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const newId = (p: string) => p + crypto.randomUUID().replace(/-/g, '').slice(0, 12);

export function emotionKind(text: string): string {
  const t = norm(text);
  if (/feliz|alegr|sorri|content|ri(nd|s)/.test(t)) return 'happy';
  if (/trist|chor|melanc|desanim/.test(t)) return 'sad';
  if (/surpre|choc|espant|assust/.test(t)) return 'surprised';
  if (/brav|raiv|irrit|zang|furi/.test(t)) return 'angry';
  if (/vergonh|timid|corad|envergonh/.test(t)) return 'shy';
  if (/pensat|duvid|descon|curios/.test(t)) return 'thinking';
  return 'neutral';
}

export function backgroundKind(text: string): string {
  const t = norm(text);
  if (/noite|estrel|farol|lua|night/.test(t)) return 'night';
  if (/praia|mar|litoral|oceano|mangue|rio/.test(t)) return 'water';
  if (/quarto|casa|interior|sala|cafe|bar|escola|aula/.test(t)) return 'interior';
  return 'day';
}

const TOKEN_MS = Number(process.env.MOCK_TOKEN_MS ?? '28');
const IMAGE_MS = Number(process.env.MOCK_IMAGE_MS ?? '700');

class MockProvider implements AiProvider {
  readonly name = 'mock';

  async enhanceBackground(input: { name: string; desc: string }, signal: AbortSignal): Promise<BackgroundBrief> {
    await sleep(200, signal);
    const k = backgroundKind(input.name + ' ' + input.desc);
    return { scene: `${input.name}. ${input.desc}`.trim(), time: k === 'night' ? 'night' : '', mood: '' };
  }

  async chat(input: ChatInput, story: StorySnapshot, onText: (t: string) => void, signal: AbortSignal): Promise<ChatResult> {
    const fail = /#falha/i.test(input.message);
    const { content, proposals } = this.compose(input, story);
    // Streaming palavra a palavra, como um provedor real com stream: true.
    const tokens = content.match(/\S+\s*/g) ?? [];
    for (let i = 0; i < tokens.length; i++) {
      await sleep(TOKEN_MS * (0.5 + Math.random()), signal);
      if (fail && i === Math.floor(tokens.length / 2)) throw new Error('AI_PROVIDER_ERROR');
      onText(tokens[i]);
    }
    return { content, proposals };
  }

  async image(req: ImageRequest, signal: AbortSignal): Promise<GeneratedImage> {
    await sleep(IMAGE_MS * (0.6 + Math.random() * 0.8), signal);
    if (/#falha/i.test(('prompt' in req ? req.prompt : '') + ' ' + req.hint)) throw new Error('AI_PROVIDER_ERROR');
    const key = req.kind === 'sprite' || req.kind === 'pose' || req.kind === 'reference'
      ? `placeholders/sprite-${emotionKind(req.hint)}.svg`
      : `placeholders/bg-${backgroundKind(req.kind === 'background-variant' ? req.variant : req.hint)}.svg`;
    return { placeholderKey: key };
  }

  async scene(input: SceneInput, story: StorySnapshot, signal: AbortSignal): Promise<SuggestedScene> {
    await sleep(400 + Math.random() * 400, signal);
    if (/#falha/i.test(input.instruction)) throw new Error('AI_PROVIDER_ERROR');
    const src = story.scenes.find(s => s.id === input.sourceSceneId);
    const label = story.choices.find(c => c.id === input.choiceId)?.label ?? '';
    const cx = input.context;
    const tense = /tens|medo|susp|briga/.test(norm(input.instruction)) || Math.random() < 0.5;
    const pool = cx.characters.filter(c => c.sprites.length);
    const cast = [...pool].sort(() => Math.random() - 0.5).slice(0, Math.min(pool.length, 1 + Math.floor(Math.random() * 3)));
    const bg = src?.bg && cx.backgrounds.some(b => b.id === src.bg) && Math.random() < 0.5 ? src.bg : cx.backgrounds.length ? pick(cx.backgrounds).id : '';
    const bgName = cx.backgrounds.find(b => b.id === bg)?.name ?? '';
    const dialogue = cast.length > 0 && Math.random() < 0.7;
    const speaker = dialogue ? pick(cast) : null;
    const want = tense ? ['surpre', 'brav', 'trist', 'pensat'] : ['feliz', 'sorri', 'neutro'];
    const sprite = (c: (typeof cast)[number]) => (c.sprites.find(s => want.some(w => norm(s.name + ' ' + (s.desc ?? '')).includes(w))) ?? pick(c.sprites)).id;
    const lines = tense
      ? ['Você também ouviu isso? Veio de perto do farol.', 'Não era pra ninguém saber disso… quem te contou?', 'Espera. Tem alguma coisa errada aqui.']
      : ['Que bom que você veio. Eu estava te esperando.', 'Vamos, antes que escureça de vez.', 'Lembra quando a gente vinha aqui todo fim de tarde?'];
    const narr = [
      `${bgName ? bgName + '.' : 'O lugar está quieto.'} O vento traz cheiro de sal e algo que ninguém sabe nomear.`,
      `Por um instante, tudo fica em silêncio. ${label ? `A decisão de “${label}” pesa no ar.` : ''}`.trim(),
    ];
    return {
      title: label || (speaker ? 'Conversa com ' + speaker.name : 'Silêncio'),
      background_id: bg,
      characters: cast.map(c => ({ character_id: c.id, sprite_id: sprite(c) })),
      text_kind: dialogue ? 'dialogue' : 'narration',
      speaker_character_id: speaker?.id ?? '',
      body: dialogue ? pick(lines) : pick(narr),
      action_label: pick(['Seguir o barulho', 'Ficar e conversar', 'Voltar para a vila', 'Investigar sozinha']),
    };
  }

  async complete(input: CompleteInput, _story: StorySnapshot, signal: AbortSignal): Promise<{ text: string }> {
    await sleep(400 + Math.random() * 400, signal);
    if (/#falha/i.test(input.instruction)) throw new Error('AI_PROVIDER_ERROR');
    const tense = /tens|medo|susp/.test(norm(input.instruction));
    const add = input.textKind === 'dialogue'
      ? pick(tense ? [' …Não olha agora, mas tem alguém atrás de você.', ' Fala baixo. As paredes daqui escutam.'] : [' …E dessa vez eu não vou fugir.', ` Confia em mim${input.speakerName ? ', é a ' + input.speakerName + ' falando' : ''}.`])
      : pick(tense ? [' Um estalo seco ecoa nas pedras, e a luz treme.', ' Algo se move na água escura, rápido demais.'] : [' Uma gaivota corta o céu e some atrás das pedras.', ' O cheiro de café fresco chega da vila.']);
    return { text: (input.text.trimEnd() + add).trimStart() };
  }

  async option(input: OptionInput, story: StorySnapshot, signal: AbortSignal): Promise<{ label: string }> {
    await sleep(300 + Math.random() * 300, signal);
    const taken = new Set(story.choices.filter(c => c.sceneId === input.sceneId).map(c => norm(c.label)));
    const free = ['Seguir o barulho', 'Ficar e conversar', 'Voltar para a vila', 'Investigar sozinha', 'Esperar o amanhecer', 'Pedir ajuda'].filter(l => !taken.has(norm(l)));
    return { label: pick(free.length ? free : ['Tentar outra coisa']) };
  }

  // "remover/apagar" propõe remover um final; "alterar/reescrever" reescreve o texto de uma cena;
  // o resto escolhe uma saída livre (ação sem destino ou final) e propõe a próxima cena.
  private compose(input: ChatInput, story: StorySnapshot): ChatResult {
    const scenes = new Map(story.scenes.map(s => [s.id, s]));
    const choicesOf = (id: string) => story.choices.filter(c => c.sceneId === id).sort((a, b) => a.position - b.position);
    const openChoice = story.choices.find(c => !c.target && scenes.has(c.sceneId));
    const finalScene = story.scenes.find(s => !s.next && !choicesOf(s.id).length);
    const intro = pick(['Boa ideia.', 'Entendi.', 'Certo, vamos lá.']) + ' ';
    const asked = norm(input.message);
    const others = story.scenes.filter(s => s.id !== story.startScene);
    if (/remov|apag|exclu|delet/.test(asked) && others.length) {
      const victim = others.find(s => !s.next && !choicesOf(s.id).length) ?? others[others.length - 1];
      const p = buildProposal({ resposta: '', remover: [victim.id] }, input.context, story);
      if (typeof p !== 'string')
        return { content: intro + `Proponho remover “${victim.title}”. O que levava até ela fica sem destino. Revise no canvas antes de aceitar.`, proposals: [p] };
    }
    if (/alter|mud|reescrev|edit|troc/.test(asked) && story.scenes.length) {
      const target = others[others.length - 1] ?? story.scenes[0];
      const text = pick(['O silêncio pesa mais do que qualquer palavra. Ninguém se move.', 'A chuva começa fina, e logo apaga as luzes da vila.', 'Algo mudou aqui desde a última vez, e todo mundo finge não ver.']);
      const p = buildProposal({ resposta: '', alterar: [{ id: target.id, kind: 'narration', text }] }, input.context, story);
      if (typeof p !== 'string')
        return { content: intro + `Proponho reescrever o texto de “${target.title}” como narração. Revise no canvas antes de aceitar.`, proposals: [p] };
    }
    if (!openChoice && !finalScene) {
      return {
        content: intro + 'A história não tem saídas livres agora. Corte um fio ou adicione uma ação e eu proponho uma cena para ela.',
        proposals: [],
      };
    }
    const src = openChoice ? scenes.get(openChoice.sceneId)! : finalScene!;
    // "crie 4 cenas": uma sequência a partir da saída livre, montada como a ferramenta da OpenAI.
    const many = Number(/(\d+)\s*cenas/.exec(asked)?.[1] ?? 0);
    if (many > 1) {
      const pool = input.context.characters.filter(c => c.sprites.length);
      const criar = Array.from({ length: many }, (_, i) => {
        const who = pool.length ? pick(pool) : null;
        return {
          ref: 'n' + i, title: `Parte ${i + 1}`, bg: input.context.backgrounds[i % Math.max(1, input.context.backgrounds.length)]?.id ?? '',
          cast: who ? [{ character: who.id, sprite: who.sprites[0].id }] : [], kind: who ? 'dialogue' : 'narration', speaker: who?.id ?? '',
          text: pick(['A maré sobe devagar.', 'Ninguém responde.', 'Você ouviu isso?', 'O farol pisca uma vez.']),
        };
      });
      const ligar = [
        { from: src.id, choice: openChoice ? openChoice.id : 'next', label: '', to: 'n0' },
        ...criar.slice(1).map((_, i) => ({ from: 'n' + i, choice: 'next', label: '', to: 'n' + (i + 1) })),
      ];
      const p = buildProposal({ resposta: '', criar, ligar }, input.context, story);
      if (typeof p !== 'string') return { content: intro + `Proponho ${many} cenas seguidas a partir de “${src.title}”. Revise no canvas antes de aceitar.`, proposals: [p] };
    }
    const pool = input.context.characters.filter(c => c.sprites.length);
    const cast = [...pool].sort(() => Math.random() - 0.5).slice(0, Math.min(pool.length, 1 + Math.floor(Math.random() * 2)));
    const bg = src.bg && input.context.backgrounds.some(b => b.id === src.bg) ? src.bg : input.context.backgrounds[0]?.id ?? '';
    const dialogue = cast.length > 0 && Math.random() < 0.7;
    const speaker = dialogue ? pick(cast) : null;
    const text = dialogue
      ? pick(['Você sentiu isso? O chão tremeu de leve.', 'Se a gente for agora, ninguém vai perceber.', 'Eu sei o que aconteceu naquela noite.'])
      : pick(['A maré sobe devagar, apagando as pegadas na areia.', 'Uma luz fraca acende e apaga lá no alto do farol.']);
    const label = openChoice ? openChoice.label : pick(['Seguir o barulho', 'Esperar o amanhecer', 'Voltar para a vila']);
    const title = openChoice && openChoice.label ? openChoice.label : speaker ? 'Conversa com ' + speaker.name : 'Silêncio';
    const sceneId = newId('s');
    const ops: Op[] = [];
    let choiceId = openChoice?.id ?? '';
    if (!openChoice) {
      choiceId = newId('ch');
      ops.push({ op: 'upsert_choice', choice: { id: choiceId, sceneId: src.id, label, target: '', position: 0 } });
    }
    ops.push({
      op: 'upsert_scene',
      scene: {
        id: sceneId, title, x: Math.round(src.x + 380), y: Math.round(src.y + 40), bg,
        chars: JSON.stringify(cast.map(c => ({ c: c.id, s: c.sprites[Math.floor(Math.random() * c.sprites.length)].id }))),
        kind: dialogue ? 'dialogue' : 'narration', speaker: speaker?.id ?? '', text, next: '', ai: '',
      },
    });
    ops.push({ op: 'upsert_choice', choice: { id: choiceId, target: sceneId } });
    const summary = [
      ...(openChoice ? [] : [`Criar ação “${label}” em “${src.title}”`]),
      `Criar cena “${title}”`,
      `Personagens: ${cast.length ? cast.map(c => c.name).join(', ') : 'nenhum'}`,
      dialogue ? `Fala de ${speaker!.name}: “${text}”` : `Narração: “${text}”`,
      'Ligar a saída à nova cena',
    ];
    const topic = input.message.trim().slice(0, 80);
    const content = intro + (openChoice
      ? `Sobre “${topic}”: a ação “${openChoice.label}” em “${src.title}” ainda não leva a lugar nenhum. Proponho uma cena para ela, mantendo o tom da cena anterior. Revise a proposta abaixo antes de aceitar.`
      : `Sobre “${topic}”: “${src.title}” hoje é um final. Proponho abrir uma ação nova ali e criar a cena seguinte. Revise a proposta abaixo antes de aceitar.`);
    return { content, proposals: [{ summary, ops, created: [sceneId] }] };
  }
}

// ---------- OpenAI ----------
const OPENAI_URL = 'https://api.openai.com/v1';
// gpt-6-luna com raciocínio low: na comparação com os pedidos reais do chat (gpt-5-mini, gpt-5.4-mini/nano,
// gpt-5.5), foi o mais rápido (1º texto em ~1 s, resposta em ~3 s) com propostas válidas e boa qualidade.
const CHAT_MODEL = process.env.OPENAI_CHAT_MODEL ?? 'gpt-6-luna';
const REASONING_EFFORT = process.env.OPENAI_REASONING_EFFORT ?? (/^(gpt-[56]|o\d)/.test(CHAT_MODEL) ? 'low' : undefined);
const IMAGE_MODEL = process.env.OPENAI_IMAGE_MODEL ?? 'gpt-image-2.6-flare';
const IMAGE_QUALITY = process.env.OPENAI_IMAGE_QUALITY ?? 'medium'; // low | medium | high
const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n) + '…' : s);
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
// Conversa anterior que vai ao modelo, das mais recentes para trás, até este total de caracteres.
const HISTORY_CHARS = Number(process.env.OPENAI_HISTORY_CHARS ?? '40000') || 40000;

function historyMessages(history: ChatTurn[] | undefined): ChatTurn[] {
  const out: ChatTurn[] = [];
  let left = HISTORY_CHARS;
  for (const t of [...(Array.isArray(history) ? history : [])].reverse()) {
    if (t?.role !== 'user' && t?.role !== 'assistant') continue;
    const content = String(t.content ?? '');
    if (!content.trim()) continue;
    if (content.length > left) break;
    left -= content.length;
    out.unshift({ role: t.role, content });
  }
  return out;
}

// Uma chamada da ferramenta = uma proposta. O modelo escolhe o conteúdo e as ligações; ids e
// operações são montados aqui e o grafo resultante é conferido, para a proposta caber no grafo atual.
// O que o BG_ENHANCER pede no fluxo manual; aqui o próprio agente escreve o prompt.
const BG_PROMPT_RULES = 'Prompt da imagem, em inglês: um parágrafo (60 a 120 palavras) só sobre o lugar: ambiente, arquitetura ou terreno, objetos, materiais, paleta, profundidade (primeiro plano, meio, fundo) e de onde vem a luz. Deixe livre o chão no centro de baixo, onde ficam os sprites. Sem estilo de arte, artistas ou tags de qualidade (o estilo é aplicado depois). Nunca pessoas, personagens, animais em destaque, texto, placas com escrita, logos ou UI.';
const CAST_SCHEMA = {
  type: 'array', maxItems: 6, description: 'Elenco em cena (no máximo 6, sem repetir personagem).',
  items: {
    type: 'object', additionalProperties: false, required: ['character', 'sprite'],
    properties: { character: { type: 'string', description: 'id do personagem' }, sprite: { type: 'string', description: 'id do sprite' } },
  },
} as const;
const SCENE_PROPS = {
  title: { type: 'string' },
  bg: { type: 'string', description: 'id de um background do contexto, ref de um item de novos_backgrounds, ou "" para nenhum.' },
  cast: CAST_SCHEMA,
  kind: { type: 'string', enum: ['narration', 'dialogue'] },
  speaker: { type: 'string', description: 'id do personagem que fala (dialogue), ou "".' },
  text: { type: 'string', description: 'dialogue: só a fala, em primeira pessoa, sem nome, aspas nem narração. narration: ambiente e ações, sem falas.' },
} as const;

const PROPOSE_TOOL = {
  type: 'function',
  function: {
    name: 'propor_mudancas',
    description: 'Propõe mudanças na história: criar, alterar e remover cenas, e ligar ou remover ações. Sem limite de quantidade. O usuário revisa tudo antes de aplicar.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      // resposta vem primeiro: é transmitida ao usuário enquanto o resto dos argumentos chega.
      required: ['resposta', 'summary', 'novos_backgrounds', 'criar', 'alterar', 'remover', 'ligar', 'remover_acoes'],
      properties: {
        resposta: { type: 'string', description: 'Resposta ao usuário (1 a 3 frases), em texto corrido, sem ids.' },
        summary: { type: 'array', items: { type: 'string' }, description: 'Linhas curtas descrevendo cada mudança, pelos títulos e nomes (sem ids nem marcadores como [FINAL]).' },
        novos_backgrounds: {
          type: 'array', maxItems: 4,
          description: 'Backgrounds novos, gerados por IA quando o usuário aceita. Só quando nenhum background da lista serve. ref é um apelido curto e único (ex.: "b1") para usar no bg das cenas.',
          items: {
            type: 'object', additionalProperties: false, required: ['ref', 'nome', 'descricao', 'prompt', 'time', 'mood'],
            properties: {
              ref: { type: 'string' },
              nome: { type: 'string', description: 'Nome curto em português (ex.: "Sala de aula").' },
              descricao: { type: 'string', description: 'Uma frase em português sobre o lugar, mostrada ao autor.' },
              prompt: { type: 'string', description: BG_PROMPT_RULES },
              time: { type: 'string', enum: ['day', 'sunset', 'night', 'interior', 'water', ''] },
              mood: { type: 'string', description: 'Poucas palavras em inglês sobre a atmosfera (ex.: "calm, nostalgic"), ou "".' },
            },
          },
        },
        criar: {
          type: 'array',
          description: 'Cenas novas. ref é um apelido curto e único (ex.: "n1") para usar em ligar.',
          items: { type: 'object', additionalProperties: false, required: ['ref', 'title', 'bg', 'cast', 'kind', 'speaker', 'text'], properties: { ref: { type: 'string' }, ...SCENE_PROPS } },
        },
        alterar: {
          type: 'array',
          description: 'Cenas existentes a alterar. Envie só os campos que mudam; cast substitui o elenco inteiro.',
          items: { type: 'object', additionalProperties: false, required: ['id'], properties: { id: { type: 'string', description: 'id da cena existente' }, ...SCENE_PROPS } },
        },
        remover: { type: 'array', items: { type: 'string' }, description: 'ids de cenas existentes a remover.' },
        ligar: {
          type: 'array',
          description: 'Ligações, aplicadas em ordem depois de criar e alterar.',
          items: {
            type: 'object', additionalProperties: false, required: ['from', 'choice', 'label', 'to'],
            properties: {
              from: { type: 'string', description: 'id ou ref da cena de origem.' },
              choice: { type: 'string', description: '"next" para a saída única; id de uma ação existente de from; ou "" para criar uma ação nova em from.' },
              label: { type: 'string', description: 'Rótulo da ação nova, ou novo rótulo da ação existente ("" mantém o atual).' },
              to: { type: 'string', description: 'id ou ref da cena de destino, ou "" para deixar sem destino.' },
            },
          },
        },
        remover_acoes: { type: 'array', items: { type: 'string' }, description: 'ids de ações existentes a remover.' },
      },
    },
  },
} as const;

// Mesma ferramenta no formato da API Responses (sem o envelope "function"). strict: false porque
// alterar aceita campos opcionais; a validação fica no buildProposal, com correção pelo modelo.
const THOUGHT_BREAK = '\u0000'; // stream → chat: começa um parágrafo do resumo
const RESPONSES_TOOL = { type: 'function', ...PROPOSE_TOOL.function, strict: false } as const;

type BgArgs = { ref: string; nome?: string; descricao?: string; prompt?: string; time?: string; mood?: string };
type SceneArgs = { title?: string; bg?: string; cast?: { character: string; sprite: string }[]; kind?: string; speaker?: string; text?: string };
export type ProposeArgs = {
  resposta: string; summary?: string[];
  novos_backgrounds?: BgArgs[];
  criar?: (SceneArgs & { ref: string })[];
  alterar?: (SceneArgs & { id: string })[];
  remover?: string[];
  ligar?: { from: string; choice: string; label: string; to: string }[];
  remover_acoes?: string[];
};

class OpenAiProvider implements AiProvider {
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

// Formato do texto de uma cena, igual em todos os prompts que escrevem texto.
const TEXT_RULES = `Formato do texto de cada cena:
- fala (dialogue): o texto é SÓ o que quem fala diz, em primeira pessoa, como aparece no balão do jogo. Sem o nome
  de quem fala, sem aspas ou travessão, sem "diz", "sussurra" etc., sem gestos, reações ou ambiente.
- narração (narration): descreve ambiente, ações e reações. Não coloque falas de personagens dentro da narração.
- Uma cena tem um texto só. Para gesto + fala, crie uma cena de narração e outra de fala em seguida; para dois
  personagens falando, uma cena de fala para cada um. Ao reescrever uma cena de fala, mantenha só a fala, ou mude
  o tipo para narração.
- Para dar gestos ou ambiente a uma cena de fala que já existe, crie a narração ANTES dela: religue para a narração
  nova o que levava à fala e ligue a narração à fala (choice "next"). As ações da cena de fala ficam onde estão.`;

// Aspas ou travessão em volta da fala inteira: só tira os sinais.
export function cleanSpeech(text: string): string {
  let t = text.trim();
  const m = /^[“"«]([^”"»]*)[”"»]$/.exec(t);
  if (m) t = m[1].trim();
  return t.replace(/^[—–-]\s+/, '');
}

// Narração dentro de uma fala: o nome de quem fala no texto, ou bastante texto fora das aspas.
export function speechProblem(text: string, speakerName: string): string | null {
  const esc = speakerName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (speakerName && new RegExp(`(^|[^\\p{L}])${esc}([^\\p{L}]|$)`, 'iu').test(text)) return `o texto cita "${speakerName}", então narra em vez de ser só a fala`;
  const outside = text.replace(/[“"«][^”"»]*[”"»]/g, '');
  if (outside !== text && outside.replace(/[^\p{L}]/gu, '').length >= 20) return 'tem narração fora das aspas';
  return null;
}

const COAUTHOR = 'Você é um coautor de visual novels dentro de um editor colaborativo. Escreva em português e mantenha o tom e a continuidade da história.';

const SCENE_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['title', 'background_id', 'characters', 'text_kind', 'speaker_character_id', 'body', 'action_label'],
  properties: {
    title: { type: 'string' },
    background_id: { type: 'string', description: 'id de um background, ou "".' },
    characters: {
      type: 'array',
      items: { type: 'object', additionalProperties: false, required: ['character_id', 'sprite_id'], properties: { character_id: { type: 'string' }, sprite_id: { type: 'string' } } },
    },
    text_kind: { type: 'string', enum: ['narration', 'dialogue'] },
    speaker_character_id: { type: 'string', description: 'id de quem fala (dialogue), ou "".' },
    body: { type: 'string', description: 'dialogue: só a fala, em primeira pessoa, sem nome, aspas nem narração. narration: ambiente e ações, sem falas.' },
    action_label: { type: 'string' },
  },
};
const TEXT_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['mode', 'text'],
  properties: { mode: { type: 'string', enum: ['continue', 'rewrite'] }, text: { type: 'string' } },
};
const BG_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['scene', 'time', 'mood'],
  properties: { scene: { type: 'string' }, time: { type: 'string' }, mood: { type: 'string' } },
};
// O estilo e as restrições fixas (sem pessoas, chão livre etc.) ficam no template do pipeline;
// aqui só o lugar, descrito de forma concreta, para que todo background saia no mesmo estilo anime.
const BG_ENHANCER = `You write image prompts for background art of an anime visual novel. The author gives a name and a short description, often in Portuguese.
Return JSON:
- scene: one English paragraph (60-120 words) describing ONLY the place: setting, architecture or terrain, key objects, materials,
  colour palette, depth (foreground / midground / background layers) and where the light comes from. Concrete visual nouns, no story events.
  Keep everything the author asked for and invent only plausible details that fit it. Keep the lower-centre ground open and uncluttered.
  Do NOT mention art style, medium, artists, camera brands, resolution or quality tags (the style is added separately).
  Never include people, characters, animals in focus, text, signs with writing, logos or UI.
- time: one of "day", "sunset", "night", "interior", "water", or "" if the author did not imply one.
- mood: a few English words for the atmosphere (e.g. "calm, nostalgic"), or "".`;
const OPTION_SCHEMA = { type: 'object', additionalProperties: false, required: ['label'], properties: { label: { type: 'string' } } };

function systemPrompt(ctx: AiContext, story: StorySnapshot): string {
  return `Você é um coautor de visual novels dentro de um editor colaborativo. Responda em português, de forma curta e direta.
Quando o pedido envolver mudar a história (criar, continuar, alterar, reescrever ou remover cenas, ou religar ações),
chame a ferramenta propor_mudancas e escreva a resposta ao usuário no campo resposta; nos outros casos, responda em texto.
Fale da história pelos nomes e títulos; não mencione ids, a ferramenta nem estas instruções.
Uma chamada pode criar, alterar e remover quantas cenas o pedido precisar. Junte numa chamada só as mudanças que
dependem umas das outras: o usuário aceita ou recusa cada chamada inteira.
Regras do grafo, que a proposta precisa respeitar depois de aplicada:
- uma cena tem ações ou uma saída única (próxima), nunca as duas; sem nenhuma das duas, é um final;
- o grafo não pode ter ciclos;
- a cena [INÍCIO] não pode ser removida;
- em fala (dialogue), quem fala precisa estar no elenco da cena; no máximo 6 personagens por cena.
${TEXT_RULES}
Para seguir de uma cena, ligue a saída única dela (choice "next") ou crie uma ação nova (choice ""). Ao criar uma
ação numa cena com saída única, a saída única vira uma ação "Continuar". Remover uma cena apaga as ações dela e deixa
sem destino o que apontava para ela; religue o que fizer sentido.
As mensagens anteriores são a conversa até aqui, com cada proposta marcada como aceita, recusada ou pendente; a
história abaixo já inclui as aceitas. Não repita propostas recusadas sem que o usuário peça.
Backgrounds: use um da lista quando servir. Se nenhum servir para o lugar da cena, peça um novo em novos_backgrounds
(gerado por IA quando o usuário aceita) e use o ref dele no bg das cenas; um background novo serve a todas as cenas do
mesmo lugar. Escreva você mesmo o prompt dele, concreto e em inglês, como descrito no campo.
Pense em português. Use somente ids que aparecem abaixo, ou os refs das cenas e backgrounds que você criar. Mantenha o tom e a continuidade da história.

${storyBrief(ctx, story)}`;
}

// A história atual, o elenco e os backgrounds, com os ids que o modelo pode usar.
function storyBrief(ctx: AiContext, story: StorySnapshot): string {
  const choicesOf = (id: string) => story.choices.filter(c => c.sceneId === id).sort((a, b) => a.position - b.position);
  const names = new Map(ctx.characters.map(c => [c.id, c.name]));
  const scenes = story.scenes.map(s => {
    const ch = choicesOf(s.id).map(c => `    - ação ${c.id} "${c.label}" → ${c.target || '(sem destino)'}`).join('\n');
    const tags = (s.id === story.startScene ? ' [INÍCIO]' : '') + (!s.next && !ch ? ' [FINAL]' : '');
    const cast = parseCast(s.chars).map(m => `${m.c}/${m.s}`).join(', ') || '-';
    const voice = s.kind === 'dialogue' ? `fala de ${s.speaker}${names.has(s.speaker) ? ` (${names.get(s.speaker)})` : ''}` : 'narração';
    return `- cena ${s.id} "${s.title}"${tags} bg=${s.bg || '-'} elenco=${cast} próxima=${s.next || '-'}\n  ${voice}: ${clip(s.text.replace(/\s+/g, ' '), 800)}${ch ? '\n' + ch : ''}`;
  }).join('\n');
  const chars = ctx.characters.map(c =>
    `- personagem ${c.id} "${c.name}"${c.desc ? ': ' + clip(c.desc, 160) : ''}\n  sprites: ${c.sprites.map(s => `${s.id} (${s.name})`).join(', ') || 'nenhum'}`).join('\n');
  const bgs = ctx.backgrounds.map(b => `- ${b.id} "${b.name}"${b.desc ? ': ' + clip(b.desc, 120) : ''}`).join('\n');
  return `História "${story.title}":
${scenes || '(vazia)'}

Personagens:
${chars || '(nenhum)'}

Backgrounds:
${bgs || '(nenhum)'}`;
}

function parseCast(chars: string): { c: string; s: string }[] {
  try { const v = JSON.parse(chars || '[]'); return Array.isArray(v) ? v : []; } catch { return []; }
}

type WScene = Omit<StoryScene, 'id'>;
type WChoice = Omit<StoryChoice, 'id'>;
const SCENE_KEYS = ['title', 'x', 'y', 'bg', 'chars', 'kind', 'speaker', 'text', 'next'] as const;
const CHOICE_KEYS = ['sceneId', 'label', 'target', 'position'] as const;

// Mesmas regras do validate do módulo; devolve o problema em palavras, ou null.
export function graphProblem(start: string, scenes: Map<string, WScene>, choices: Map<string, WChoice>): string | null {
  if (!scenes.has(start)) return 'a cena inicial seria removida';
  const outs = new Map<string, string[]>();
  for (const id of scenes.keys()) outs.set(id, []);
  for (const c of choices.values()) {
    if (!scenes.has(c.sceneId)) return 'uma ação ficaria sem cena';
    if (c.target) {
      if (!scenes.has(c.target)) return 'uma ação apontaria para uma cena que não existe';
      outs.get(c.sceneId)!.push(c.target);
    }
  }
  for (const [id, s] of scenes) {
    const title = `“${s.title}” (${id})`;
    if (s.next) {
      if ([...choices.values()].some(c => c.sceneId === id)) return `${title} teria ações e saída única ao mesmo tempo`;
      if (!scenes.has(s.next)) return `${title} seguiria para uma cena que não existe`;
      outs.get(id)!.push(s.next);
    }
    const cast = parseCast(s.chars);
    if (cast.length > 6) return `${title} teria mais de 6 personagens`;
    if (new Set(cast.map(m => m.c)).size !== cast.length) return `${title} teria um personagem repetido`;
    if (s.kind === 'dialogue' && !cast.some(m => m.c === s.speaker)) return `quem fala em ${title} não estaria na cena`;
  }
  const color = new Map<string, number>();
  const visit = (id: string): boolean => {
    color.set(id, 1);
    for (const n of outs.get(id)!) {
      const k = color.get(n) ?? 0;
      if (k === 1 || (k === 0 && visit(n))) return true;
    }
    color.set(id, 2);
    return false;
  };
  for (const id of outs.keys()) if (!color.get(id) && visit(id)) return 'as ligações formariam um ciclo';
  return null;
}

// Converte a saída da ferramenta nas operações do apply_operations: aplica as mudanças numa cópia
// do grafo, confere ids e regras e emite só a diferença. Quando a proposta não cabe no grafo,
// devolve os problemas em texto, com os ids, para o modelo corrigir (veja OpenAiProvider.chat).
export function buildProposal(a: ProposeArgs, ctx: AiContext, story: StorySnapshot): Proposal | string {
  const sprites = new Map(ctx.characters.map(c => [c.id, c.sprites.map(s => s.id)]));
  const bgs = new Set(ctx.backgrounds.map(b => b.id));
  const bgRefs = new Map<string, string>();
  const newBgs: NewBackground[] = [];
  const orig = {
    scenes: new Map(story.scenes.map(({ id, ...s }) => [id, s])),
    choices: new Map(story.choices.map(({ id, ...c }) => [id, c])),
  };
  const scenes = new Map([...orig.scenes].map(([k, v]) => [k, { ...v }]));
  const choices = new Map([...orig.choices].map(([k, v]) => [k, { ...v }]));
  const refs = new Map<string, string>();
  const created: string[] = [];
  const errs: string[] = [];
  const resolve = (k: string) => refs.get(k) ?? (scenes.has(k) ? k : '');
  const castJson = (cast: SceneArgs['cast'], where: string) => {
    const seen = new Set<string>();
    const ok = (cast ?? []).filter(m => {
      if (!sprites.has(m.character)) { errs.push(`${where}: personagem "${m.character}" não existe`); return false; }
      if (!sprites.get(m.character)!.includes(m.sprite)) { errs.push(`${where}: sprite "${m.sprite}" não é do personagem "${m.character}"`); return false; }
      if (seen.has(m.character)) { errs.push(`${where}: personagem "${m.character}" repetido no elenco`); return false; }
      seen.add(m.character);
      return true;
    });
    if (ok.length > 6) errs.push(`${where}: mais de 6 personagens no elenco`);
    return JSON.stringify(ok.map(m => ({ c: m.character, s: m.sprite })));
  };
  const checkBg = (raw: string, where: string) => {
    const bg = bgRefs.get(raw) ?? raw;
    if (bg && !bgs.has(bg)) errs.push(`${where}: background "${raw}" não existe (use um id da lista, um ref de novos_backgrounds, ou "")`);
    return bgs.has(bg) ? bg : '';
  };
  for (const b of a.novos_backgrounds ?? []) {
    const where = `novos_backgrounds "${b.ref || b.nome}"`;
    const prompt = String(b.prompt ?? '').trim(), name = String(b.nome ?? '').trim();
    if (!b.ref) { errs.push(`${where}: falta o ref`); continue; }
    if (bgRefs.has(b.ref) || bgs.has(b.ref)) { errs.push(`${where}: ref "${b.ref}" repetido ou igual a um id existente`); continue; }
    if (!name) errs.push(`${where}: falta o nome`);
    if (prompt.split(/\s+/).length < 20) errs.push(`${where}: o prompt precisa descrever o lugar em inglês (60 a 120 palavras)`);
    const id = newId('b');
    bgRefs.set(b.ref, id);
    bgs.add(id);
    const time = ['day', 'sunset', 'night', 'interior', 'water'].includes(String(b.time)) ? String(b.time) : '';
    newBgs.push({ id, name: clip(name || 'Background', 80), desc: clip(String(b.descricao ?? '').trim(), 400), prompt: clip(prompt, 1200), time, mood: clip(String(b.mood ?? '').trim(), 120) });
  }
  // Fala de alguém fora do elenco: entra no elenco com o primeiro sprite, se couber.
  const fixVoice = (s: WScene, where: string) => {
    if (s.kind !== 'dialogue') { s.kind = 'narration'; s.speaker = ''; return; }
    if (!sprites.has(s.speaker)) { errs.push(`${where}: kind "dialogue" precisa de speaker com o id de um personagem (veio "${s.speaker}")`); return; }
    const cast = parseCast(s.chars);
    if (cast.some(m => m.c === s.speaker)) return;
    const first = sprites.get(s.speaker)![0];
    if (first && cast.length < 6) s.chars = JSON.stringify([...cast, { c: s.speaker, s: first }]);
    else errs.push(`${where}: quem fala ("${s.speaker}") precisa estar no elenco`);
  };
  const names = new Map(ctx.characters.map(c => [c.id, c.name]));
  const checkSpeech = (s: WScene, where: string) => {
    if (s.kind !== 'dialogue') return;
    s.text = cleanSpeech(s.text);
    const name = names.get(s.speaker) ?? '';
    const why = speechProblem(s.text, name);
    if (why) errs.push(`${where}: é uma fala de ${name || s.speaker} (kind "dialogue"), mas ${why}. Em fala, text é só o que ${name || 'o personagem'} diz; ponha gestos e ambiente numa cena de narração separada (antes ou depois), ou mude kind para "narration"`);
  };
  const right = Math.max(0, ...story.scenes.map(s => s.x)); // o cliente reposiciona as cenas novas

  for (const n of a.criar ?? []) {
    const where = `criar "${n.ref || n.title}"`;
    if (!n.ref) errs.push(`${where}: falta o ref`);
    else if (refs.has(n.ref) || scenes.has(n.ref)) errs.push(`${where}: ref "${n.ref}" repetido ou igual a um id existente`);
    const id = newId('s');
    if (n.ref && !refs.has(n.ref)) refs.set(n.ref, id);
    created.push(id);
    const s: WScene = {
      title: clip(n.title || 'Nova cena', 80), x: Math.round(right + 380 * created.length), y: 0,
      bg: checkBg(n.bg ?? '', where), chars: castJson(n.cast, where), kind: n.kind ?? 'narration',
      speaker: n.speaker ?? '', text: n.text ?? '', next: '',
    };
    fixVoice(s, where);
    checkSpeech(s, where);
    scenes.set(id, s);
  }
  for (const u of a.alterar ?? []) {
    const where = `alterar "${u.id}"`;
    const s = orig.scenes.has(u.id) ? scenes.get(u.id) : undefined;
    if (!s) { errs.push(`${where}: cena não existe (alterar só aceita ids de cenas existentes)`); continue; }
    if (u.title) s.title = clip(u.title, 80);
    if (u.bg !== undefined) s.bg = checkBg(u.bg, where);
    if (u.cast) s.chars = castJson(u.cast, where);
    if (u.kind === 'narration' || u.kind === 'dialogue') s.kind = u.kind;
    if (u.speaker) s.speaker = u.speaker;
    if (typeof u.text === 'string') s.text = u.text;
    fixVoice(s, where);
    checkSpeech(s, where);
  }
  for (const id of a.remover_acoes ?? []) {
    if (!choices.delete(id)) errs.push(`remover_acoes: ação "${id}" não existe`);
  }
  for (const l of a.ligar ?? []) {
    const where = `ligar ${l.from} → ${l.to || '""'}`;
    const from = resolve(l.from), to = l.to ? resolve(l.to) : '';
    const src = from ? scenes.get(from) : undefined;
    if (!src) { errs.push(`${where}: cena de origem "${l.from}" não existe`); continue; }
    if (l.to && !to) { errs.push(`${where}: cena de destino "${l.to}" não existe`); continue; }
    const own = [...choices.entries()].filter(([, c]) => c.sceneId === from);
    if (l.choice === 'next') {
      if (own.length === 1 && !l.label) own[0][1].target = to; // "próxima" de uma cena com uma ação só
      else if (!own.length) src.next = to;
      else errs.push(`${where}: a cena tem ações, então não tem saída única; use o id de uma das ações (${own.map(([cid]) => cid).join(', ')}) ou "" para criar outra`);
      continue;
    }
    if (l.choice) {
      const c = choices.get(l.choice);
      if (!c || c.sceneId !== from) { errs.push(`${where}: ação "${l.choice}" não existe em "${l.from}"`); continue; }
      c.target = to;
      if (l.label) c.label = clip(l.label, 60);
      continue;
    }
    // Ação nova, como no editor: a saída única da cena vira a primeira ação.
    let pos = Math.max(-1, ...own.map(([, c]) => c.position)) + 1;
    if (!own.length && src.next) {
      choices.set(newId('ch'), { sceneId: from, label: 'Continuar', target: src.next, position: pos++ });
      src.next = '';
    }
    choices.set(newId('ch'), { sceneId: from, label: clip(l.label || 'Continuar', 60), target: to, position: pos });
  }
  const removed = new Set<string>();
  for (const k of a.remover ?? []) {
    const id = resolve(k);
    if (!id) { errs.push(`remover: cena "${k}" não existe`); continue; }
    if (id === story.startScene) { errs.push(`remover: "${k}" é a cena [INÍCIO] e não pode ser removida`); continue; }
    scenes.delete(id);
    removed.add(id);
    for (const [cid, c] of choices) if (c.sceneId === id) choices.delete(cid); else if (c.target === id) c.target = '';
    for (const s of scenes.values()) if (s.next === id) s.next = '';
  }
  if (errs.length) return errs.join('; ');

  const problem = graphProblem(story.startScene, scenes, choices);
  if (problem) return problem;

  // Só a diferença, na ordem do cliente: cenas, ações, ações apagadas, cenas apagadas.
  const ops: Op[] = [];
  const isNew = new Set(created.filter(id => scenes.has(id)));
  for (const [id, s] of scenes) {
    const o = orig.scenes.get(id);
    if (isNew.has(id)) { ops.push({ op: 'upsert_scene', scene: { id, ...s, ai: '' } }); continue; }
    const ch: Record<string, unknown> = {};
    // delete_scene já zera os destinos que apontavam para a cena removida.
    for (const k of SCENE_KEYS) if (o && s[k] !== o[k] && !(k === 'next' && !s.next && removed.has(o.next))) ch[k] = s[k];
    if (Object.keys(ch).length) ops.push({ op: 'upsert_scene', scene: { id, ...ch } });
  }
  for (const [id, c] of choices) {
    const o = orig.choices.get(id);
    if (!o) { ops.push({ op: 'upsert_choice', choice: { id, ...c } }); continue; }
    const ch: Record<string, unknown> = {};
    for (const k of CHOICE_KEYS) if (c[k] !== o[k] && !(k === 'target' && !c.target && removed.has(o.target))) ch[k] = c[k];
    if (Object.keys(ch).length) ops.push({ op: 'upsert_choice', choice: { id, ...ch } });
  }
  for (const [id, c] of orig.choices) if (!choices.has(id) && !removed.has(c.sceneId)) ops.push({ op: 'delete_choice', id });
  for (const id of removed) if (orig.scenes.has(id)) ops.push({ op: 'delete_scene', id });
  if (!ops.length) return 'a proposta não mudava nada';
  const used = new Set([...scenes.values()].map(s => s.bg));
  const unused = newBgs.filter(b => !used.has(b.id));
  if (unused.length) return unused.map(b => `novos_backgrounds "${b.name}": nenhuma cena usa este background; ponha o ref dele no bg de alguma cena ou tire-o`).join('; ');

  const title = (id: string) => `“${orig.scenes.get(id)?.title ?? scenes.get(id)?.title ?? ''}”`;
  const summary = a.summary?.length ? a.summary : [
    ...[...isNew].map(id => `Criar cena ${title(id)}`),
    ...(a.alterar ?? []).filter(u => orig.scenes.has(u.id) && !removed.has(u.id)).map(u => `Alterar ${title(u.id)}`),
    ...[...removed].filter(id => orig.scenes.has(id)).map(id => `Remover ${title(id)}`),
  ];
  if (!summary.length) summary.push('Religar ações');
  summary.unshift(...newBgs.map(b => `Gerar background “${b.name}”`));
  return { summary, ops, created: [...isNew], ...(newBgs.length ? { backgrounds: newBgs } : {}) };
}

// JSON cortado no meio (argumentos da ferramenta chegando aos pedaços): fecha o que estiver aberto
// e descarta a chave ou o escape incompleto do fim. null se ainda não der para ler.
export function parsePartialJson(src: string): any {
  const stack: string[] = [];
  let inStr = false, esc = false;
  for (const ch of src) {
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === '{') stack.push('}');
    else if (ch === '[') stack.push(']');
    else if (ch === '}' || ch === ']') stack.pop();
  }
  let t = src;
  if (inStr) t = t.replace(/\\(u[0-9a-fA-F]{0,3})?$/, '') + '"';
  const close = stack.reverse().join('');
  const tries = [
    t.replace(/[\s,:]*$/, ''),
    t.replace(/,?\s*"(?:[^"\\]|\\.)*"\s*:?\s*$/, ''), // chave sem valor no fim
    t.replace(/,?\s*"(?:[^"\\]|\\.)*"\s*:\s*"(?:[^"\\]|\\.)*"$/, ''), // par chave/valor cortado
  ];
  for (const x of tries) {
    try { return JSON.parse(x + close); } catch { /* tenta a próxima */ }
  }
  return null;
}

// O que já dá para mostrar da proposta parcial: títulos das cenas novas e das cenas existentes tocadas.
export function proposalProgress(args: string, story: StorySnapshot, attempt: number): ProposalProgress | null {
  const a = parsePartialJson(args) as Partial<ProposeArgs> | null;
  if (!a || typeof a !== 'object') return null;
  const title = (id: unknown) => story.scenes.find(s => s.id === id)?.title ?? '';
  const list = (v: unknown) => (Array.isArray(v) ? v : []);
  return {
    attempt,
    criar: list(a.criar).map(n => String(n?.title ?? '')).filter(Boolean),
    alterar: list(a.alterar).map(u => title(u?.id)).filter(Boolean),
    remover: list(a.remover).map(title).filter(Boolean),
    ligar: list(a.ligar).length,
  };
}

// Valor (talvez ainda incompleto) de um campo string num JSON que está chegando aos pedaços.
function partialJsonString(json: string, field: string): string {
  const m = new RegExp(`"${field}"\\s*:\\s*"`).exec(json);
  if (!m) return '';
  let out = '';
  for (let i = m.index + m[0].length; i < json.length; i++) {
    const ch = json[i];
    if (ch === '"') break;
    if (ch !== '\\') { out += ch; continue; }
    const esc = json[i + 1];
    if (esc === undefined) break; // escape cortado no fim do pedaço
    if (esc === 'u') {
      const hex = json.slice(i + 2, i + 6);
      if (!/^[0-9a-fA-F]{4}$/.test(hex)) break;
      out += String.fromCharCode(parseInt(hex, 16));
      i += 5;
    } else {
      out += ({ n: '\n', t: '\t', r: '\r', b: '\b', f: '\f' } as Record<string, string>)[esc] ?? esc;
      i++;
    }
  }
  return out;
}

// Linhas "data: ..." de uma resposta em Server-Sent Events.
async function* sseEvents(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const dec = new TextDecoder();
  let buf = '';
  for await (const part of body as unknown as AsyncIterable<Uint8Array>) {
    buf += dec.decode(part, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (line.startsWith('data:')) yield line.slice(5).trim();
    }
  }
}
