import type { AiProvider, BackgroundBrief, ChatInput, ChatResult, CompleteInput, GeneratedImage, ImageRequest, Op, OptionInput, SceneInput, StorySnapshot, SuggestedScene } from './types';
import { buildProposal } from '../proposal';
import { newId, norm } from '../util';

// ---------- mock ----------
const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((res, rej) => {
    if (signal.aborted) return rej(new Error('TIMEOUT'));
    const t = setTimeout(res, ms);
    signal.addEventListener('abort', () => { clearTimeout(t); rej(new Error('TIMEOUT')); }, { once: true });
  });
const pick = <T>(a: T[]): T => a[Math.floor(Math.random() * a.length)];

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

export class MockProvider implements AiProvider {
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
