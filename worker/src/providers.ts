// Provedores de IA do worker (seção 2.6). Só o mock está implementado: a integração
// real entra trocando createProvider() quando houver chave, sem mudar o resto do worker.

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
  // 'openai' | 'google': integração pendente (chaves ainda não disponíveis).
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
