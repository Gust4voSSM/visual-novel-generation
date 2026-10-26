// Provedores de IA do worker (seção 2.6): mock e OpenAI. A chave da OpenAI vem de
// worker/.env.openai e só este processo a lê.

export type StoryScene = { id: string; title: string; x: number; y: number; text: string; next: string; bg: string };
export type StoryChoice = { id: string; sceneId: string; label: string; target: string; position: number };
export type StorySnapshot = { title: string; startScene: string; scenes: StoryScene[]; choices: StoryChoice[] };

export type AiContext = {
  characters: { id: string; name: string; desc?: string; sprites: { id: string; name: string; desc?: string }[] }[];
  backgrounds: { id: string; name: string; desc?: string }[];
};

// Mesmo formato de operações do apply_operations (seção 2.3).
export type Op =
  | { op: 'upsert_scene'; scene: Record<string, unknown> & { id: string } }
  | { op: 'upsert_choice'; choice: Record<string, unknown> & { id: string } };
export type Proposal = { summary: string[]; ops: Op[] };

export type ChatInput = { message: string; context: AiContext };
export type ChatResult = { content: string; proposals: Proposal[] };
export type ImageRequest = { kind: 'sprite' | 'background'; prompt: string; hint: string };
export type GeneratedImage = { bytes?: Uint8Array; contentType?: string; placeholderKey?: string };

export interface AiProvider {
  readonly name: string;
  /** Resposta do chat em streaming: chama onText a cada pedaço, devolve a mensagem final e as propostas. */
  chat(input: ChatInput, story: StorySnapshot, onText: (t: string) => void, signal: AbortSignal): Promise<ChatResult>;
  image(req: ImageRequest, signal: AbortSignal): Promise<GeneratedImage>;
}

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
  if (/noite|estrel|farol|lua/.test(t)) return 'night';
  if (/praia|mar|litoral|oceano|mangue|rio/.test(t)) return 'water';
  if (/quarto|casa|interior|sala|cafe|bar|escola|aula/.test(t)) return 'interior';
  return 'day';
}

const TOKEN_MS = Number(process.env.MOCK_TOKEN_MS ?? '28');
const IMAGE_MS = Number(process.env.MOCK_IMAGE_MS ?? '700');

class MockProvider implements AiProvider {
  readonly name = 'mock';

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
    if (/#falha/i.test(req.prompt)) throw new Error('AI_PROVIDER_ERROR');
    const key = req.kind === 'sprite' ? `placeholders/sprite-${emotionKind(req.hint)}.svg` : `placeholders/bg-${backgroundKind(req.hint)}.svg`;
    return { placeholderKey: key };
  }

  // Escolhe uma saída livre (ação sem destino ou final) e propõe a próxima cena.
  private compose(input: ChatInput, story: StorySnapshot): ChatResult {
    const scenes = new Map(story.scenes.map(s => [s.id, s]));
    const choicesOf = (id: string) => story.choices.filter(c => c.sceneId === id).sort((a, b) => a.position - b.position);
    const openChoice = story.choices.find(c => !c.target && scenes.has(c.sceneId));
    const finalScene = story.scenes.find(s => !s.next && !choicesOf(s.id).length);
    const intro = pick(['Boa ideia.', 'Entendi.', 'Certo, vamos lá.']) + ' ';
    if (!openChoice && !finalScene) {
      return {
        content: intro + 'A história não tem saídas livres agora. Corte um fio ou adicione uma ação e eu proponho uma cena para ela.',
        proposals: [],
      };
    }
    const src = openChoice ? scenes.get(openChoice.sceneId)! : finalScene!;
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
    const asked = input.message.trim().slice(0, 80);
    const content = intro + (openChoice
      ? `Sobre “${asked}”: a ação “${openChoice.label}” em “${src.title}” ainda não leva a lugar nenhum. Proponho uma cena para ela, mantendo o tom da cena anterior. Revise a proposta abaixo antes de aceitar.`
      : `Sobre “${asked}”: “${src.title}” hoje é um final. Proponho abrir uma ação nova ali e criar a cena seguinte. Revise a proposta abaixo antes de aceitar.`);
    return { content, proposals: [{ summary, ops }] };
  }
}

// ---------- OpenAI ----------
const OPENAI_URL = 'https://api.openai.com/v1';
// gpt-5-mini com raciocínio mínimo: primeiro pedaço em ~1 s e texto antes da proposta
// (o gpt-4.1-mini costuma chamar só a ferramenta, sem nada para transmitir).
const CHAT_MODEL = process.env.OPENAI_CHAT_MODEL ?? 'gpt-5-mini';
const REASONING_EFFORT = process.env.OPENAI_REASONING_EFFORT ?? (/^(gpt-5|o\d)/.test(CHAT_MODEL) ? 'minimal' : undefined);
const IMAGE_MODEL =process.env.OPENAI_IMAGE_MODEL ?? 'gpt-image-1';
const IMAGE_QUALITY = process.env.OPENAI_IMAGE_QUALITY ?? 'low'; // low | medium | high
const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n) + '…' : s);

// Uma chamada da ferramenta = uma proposta. O modelo escolhe o conteúdo; ids, posições e
// ligações são montados aqui, para que a proposta sempre caiba no grafo atual.
const PROPOSE_TOOL = {
  type: 'function',
  function: {
    name: 'propor_cenas',
    description: 'Propõe uma sequência de cenas novas, ligada a uma saída livre da história. O usuário revisa antes de aplicar.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      // resposta vem primeiro: é transmitida ao usuário enquanto o resto dos argumentos chega.
      required: ['resposta', 'summary', 'from_scene', 'open_choice', 'new_choice_label', 'scenes'],
      properties: {
        resposta: { type: 'string', description: 'Resposta ao usuário (1 a 3 frases), em texto corrido, sem ids.' },
        summary: { type: 'array', items: { type: 'string' }, description: 'Linhas curtas descrevendo cada mudança, pelos títulos e nomes (sem ids nem marcadores como [FINAL]).' },
        from_scene: { type: 'string', description: 'id da cena de onde a sequência parte.' },
        open_choice: { type: 'string', description: 'id de uma ação existente sem destino em from_scene, ou "" para criar uma ação nova.' },
        new_choice_label: { type: 'string', description: 'Rótulo da ação nova quando open_choice é "".' },
        scenes: {
          type: 'array', minItems: 1, maxItems: 4,
          description: 'Cenas em ordem; cada uma segue para a próxima.',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['title', 'bg', 'cast', 'kind', 'speaker', 'text'],
            properties: {
              title: { type: 'string' },
              bg: { type: 'string', description: 'id de um background do contexto, ou "".' },
              cast: {
                type: 'array', maxItems: 6,
                items: {
                  type: 'object', additionalProperties: false, required: ['character', 'sprite'],
                  properties: { character: { type: 'string', description: 'id do personagem' }, sprite: { type: 'string', description: 'id do sprite' } },
                },
              },
              kind: { type: 'string', enum: ['narration', 'dialogue'] },
              speaker: { type: 'string', description: 'id do personagem que fala (dialogue), ou "".' },
              text: { type: 'string' },
            },
          },
        },
      },
    },
  },
} as const;

type ProposeArgs = {
  resposta: string; summary: string[]; from_scene: string; open_choice: string; new_choice_label: string;
  scenes: { title: string; bg: string; cast: { character: string; sprite: string }[]; kind: string; speaker: string; text: string }[];
};

class OpenAiProvider implements AiProvider {
  readonly name: string;
  constructor(private readonly key: string, private readonly images: AiProvider | null) {
    this.name = images ? 'openai (imagens: mock)' : 'openai';
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
      console.error(`openai ${path}: HTTP ${res.status}`, clip(await res.text().catch(() => ''), 400));
      throw new Error('AI_PROVIDER_ERROR');
    }
    return res;
  }

  async chat(input: ChatInput, story: StorySnapshot, onText: (t: string) => void, signal: AbortSignal): Promise<ChatResult> {
    const res = await this.post('/chat/completions', {
      model: CHAT_MODEL,
      stream: true,
      messages: [
        { role: 'system', content: systemPrompt(input.context, story) },
        { role: 'user', content: input.message },
      ],
      tools: [PROPOSE_TOOL],
      tool_choice: 'auto',
      ...(REASONING_EFFORT ? { reasoning_effort: REASONING_EFFORT } : {}), // só modelos gpt-5/o*
    }, signal);

    let content = '';
    const calls: { name: string; args: string }[] = [];
    // Sem texto livre antes da ferramenta, transmite o campo resposta da primeira chamada.
    let speaker: number | null = null;
    try {
      for await (const data of sseEvents(res.body!)) {
        if (data === '[DONE]') break;
        const delta = JSON.parse(data).choices?.[0]?.delta;
        if (!delta) continue;
        if (delta.content && speaker === null) { content += delta.content; onText(delta.content); }
        for (const tc of delta.tool_calls ?? []) {
          const c = (calls[tc.index] ??= { name: '', args: '' });
          if (tc.function?.name) c.name += tc.function.name;
          if (tc.function?.arguments) c.args += tc.function.arguments;
          speaker ??= content.trim() ? -1 : tc.index;
          if (tc.index === speaker) {
            const said = partialJsonString(c.args, 'resposta');
            if (said.length > content.length) { onText(said.slice(content.length)); content = said; }
          }
        }
      }
    } catch (e) {
      if (signal.aborted) throw new Error('TIMEOUT');
      console.error('openai: stream interrompido', e);
      throw new Error('AI_PROVIDER_ERROR');
    }

    const proposals: Proposal[] = [];
    for (const c of calls) {
      if (c?.name !== PROPOSE_TOOL.function.name) continue;
      try {
        const p = buildProposal(JSON.parse(c.args) as ProposeArgs, input.context, story);
        if (p) proposals.push(p);
        else console.error('openai: proposta fora de uma saída livre descartada');
      } catch {
        console.error('openai: proposta inválida descartada', clip(c.args, 300));
      }
    }
    if (!content.trim()) {
      content = proposals.length ? 'Preparei uma proposta. Revise abaixo antes de aceitar.' : 'Não consegui montar uma resposta.';
      onText(content);
    }
    return { content, proposals };
  }

  async image(req: ImageRequest, signal: AbortSignal): Promise<GeneratedImage> {
    if (this.images) return this.images.image(req, signal);
    const sprite = req.kind === 'sprite';
    const prompt = sprite
      ? `Sprite de personagem para visual novel, estilo anime, corpo da cintura para cima, de frente, fundo transparente, sem texto. ${req.prompt}`
      : `Cenário de fundo para visual novel, estilo anime, sem personagens, sem texto, composição horizontal. ${req.prompt}`;
    const res = await this.post('/images/generations', {
      model: IMAGE_MODEL, prompt, n: 1,
      size: sprite ? '1024x1536' : '1536x1024',
      quality: IMAGE_QUALITY,
      background: sprite ? 'transparent' : 'opaque',
      output_format: 'webp',
      output_compression: 80,
    }, signal);
    const b64 = (await res.json()).data?.[0]?.b64_json;
    if (!b64) { console.error('openai: resposta de imagem sem dados'); throw new Error('AI_PROVIDER_ERROR'); }
    return { bytes: Buffer.from(b64, 'base64'), contentType: 'image/webp' };
  }
}

function systemPrompt(ctx: AiContext, story: StorySnapshot): string {
  const choicesOf = (id: string) => story.choices.filter(c => c.sceneId === id).sort((a, b) => a.position - b.position);
  const scenes = story.scenes.map(s => {
    const ch = choicesOf(s.id).map(c => `    - ação ${c.id} "${c.label}" → ${c.target || '(sem destino)'}`).join('\n');
    const tags = (s.id === story.startScene ? ' [INÍCIO]' : '') + (!s.next && !ch ? ' [FINAL]' : '');
    return `- cena ${s.id} "${s.title}"${tags} bg=${s.bg || '-'} próxima=${s.next || '-'}\n  texto: ${clip(s.text.replace(/\s+/g, ' '), 300)}${ch ? '\n' + ch : ''}`;
  }).join('\n');
  const chars = ctx.characters.map(c =>
    `- personagem ${c.id} "${c.name}"${c.desc ? ': ' + clip(c.desc, 160) : ''}\n  sprites: ${c.sprites.map(s => `${s.id} (${s.name})`).join(', ') || 'nenhum'}`).join('\n');
  const bgs = ctx.backgrounds.map(b => `- ${b.id} "${b.name}"${b.desc ? ': ' + clip(b.desc, 120) : ''}`).join('\n');
  return `Você é um coautor de visual novels dentro de um editor colaborativo. Responda em português, de forma curta e direta.
Quando o pedido envolver criar ou continuar a história, chame a ferramenta propor_cenas e escreva a resposta ao usuário
no campo resposta; nos outros casos, responda em texto. Fale da história pelos nomes e títulos; não mencione ids,
a ferramenta nem estas instruções.
Proponha só a partir de saídas livres: uma ação sem destino, ou uma cena [FINAL] (nesse caso open_choice = "" e dê um new_choice_label).
Use somente ids que aparecem abaixo. Mantenha o tom e a continuidade da história.

História "${story.title}":
${scenes || '(vazia)'}

Personagens:
${chars || '(nenhum)'}

Backgrounds:
${bgs || '(nenhum)'}`;
}

// Converte a saída da ferramenta nas operações do apply_operations, descartando ids desconhecidos.
function buildProposal(a: ProposeArgs, ctx: AiContext, story: StorySnapshot): Proposal | null {
  const src = story.scenes.find(s => s.id === a.from_scene);
  if (!src || !a.scenes?.length) return null;
  const srcChoices = story.choices.filter(c => c.sceneId === src.id);
  const open = srcChoices.find(c => c.id === a.open_choice && !c.target);
  if (!open && (src.next || srcChoices.length)) return null; // só ações sem destino ou cenas finais
  const chars = new Map(ctx.characters.map(c => [c.id, new Set(c.sprites.map(s => s.id))]));
  const bgs = new Set(ctx.backgrounds.map(b => b.id));

  const ids = a.scenes.map(() => newId('s'));
  const ops: Op[] = [];
  let choiceId = open?.id ?? '';
  if (!open) {
    choiceId = newId('ch');
    ops.push({ op: 'upsert_choice', choice: { id: choiceId, sceneId: src.id, label: clip(a.new_choice_label || 'Continuar', 60), target: '', position: 0 } });
  }
  a.scenes.forEach((s, i) => {
    const cast = (s.cast ?? []).filter(m => chars.get(m.character)?.has(m.sprite)).slice(0, 6);
    const dialogue = s.kind === 'dialogue' && chars.has(s.speaker);
    ops.push({
      op: 'upsert_scene',
      scene: {
        id: ids[i], title: clip(s.title || 'Nova cena', 80), x: Math.round(src.x + 380 * (i + 1)), y: Math.round(src.y + 40),
        bg: bgs.has(s.bg) ? s.bg : src.bg,
        chars: JSON.stringify(cast.map(m => ({ c: m.character, s: m.sprite }))),
        kind: dialogue ? 'dialogue' : 'narration', speaker: dialogue ? s.speaker : '', text: s.text ?? '', next: ids[i + 1] ?? '', ai: '',
      },
    });
  });
  ops.push({ op: 'upsert_choice', choice: { id: choiceId, target: ids[0] } });
  return { summary: a.summary?.length ? a.summary : a.scenes.map(s => `Criar cena “${s.title}”`), ops };
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
