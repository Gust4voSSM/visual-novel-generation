// Prompts e esquemas enviados ao modelo: instruções do chat, ferramenta propor_mudancas e o resumo da história.
import type { AiContext, ChatTurn, StorySnapshot } from './providers/types';
import { parseCast } from './proposal';
import { clip } from './util';

// Conversa anterior que vai ao modelo, das mais recentes para trás, até este total de caracteres.
const HISTORY_CHARS = Number(process.env.OPENAI_HISTORY_CHARS ?? '40000') || 40000;

export function historyMessages(history: ChatTurn[] | undefined): ChatTurn[] {
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
// Regras do prompt de background, as mesmas na melhoria do fluxo manual (BG_ENHANCER) e no campo prompt
// de novos_backgrounds do agente. Estilo e restrições fixas ficam no template do pipeline.
const BG_SCENE_RULES = `One English paragraph (60-120 words) describing ONLY the place: setting, architecture or terrain, key objects, materials,
colour palette, depth (foreground / midground / background layers) and where the light comes from. Concrete visual nouns, no story events.
Keep everything the author asked for and invent only plausible details that fit it. Keep the lower-centre ground open and uncluttered.
Do NOT mention art style, medium, artists, camera brands, resolution or quality tags (the style is added separately).
Never include people, characters, animals in focus, text, signs with writing, logos or UI.`;
const BG_TIME_RULE = 'one of "day", "sunset", "night", "interior", "water", or "" if not implied';
const BG_MOOD_RULE = 'a few English words for the atmosphere (e.g. "calm, nostalgic"), or ""';
const BG_PROMPT_RULES = `Image prompt. ${BG_SCENE_RULES}
The scenes tell you what the place is and when; describe the place itself, not what happens there.
To match a related background in the list (its "imagem" line), reuse its materials, palette and light, not its layout.`;
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

export const PROPOSE_TOOL = {
  type: 'function',
  function: {
    name: 'propor_mudancas',
    description: 'Propõe mudanças na história: criar personagens (com imagens geradas), criar, alterar e remover cenas, e ligar ou remover ações. Sem limite de quantidade. O usuário revisa tudo antes de aplicar.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      // resposta vem primeiro: é transmitida ao usuário enquanto o resto dos argumentos chega.
      required: ['resposta', 'summary', 'novos_backgrounds', 'criar', 'alterar', 'remover', 'ligar', 'remover_acoes'],
      properties: {
        resposta: { type: 'string', description: 'Resposta ao usuário (1 a 3 frases), em texto corrido, sem ids.' },
        summary: { type: 'array', items: { type: 'string' }, description: 'Linhas curtas descrevendo cada mudança, pelos títulos e nomes (sem ids nem marcadores como [FINAL]).' },
        personagens: {
          type: 'array',
          description: 'Personagens novos, gerados por IA depois que o usuário aceitar (charsheet e uma imagem por pose). Só quando o pedido precisa de alguém que não está no elenco. Sempre numa chamada separada, sem mudanças de cena: com personagens, deixe criar, alterar, remover, ligar, remover_acoes e novos_backgrounds vazios. ref é um apelido curto e único (ex.: "p1").',
          items: {
            type: 'object', additionalProperties: false, required: ['ref', 'name', 'desc', 'poses'],
            properties: {
              ref: { type: 'string' },
              name: { type: 'string', description: 'Nome do personagem.' },
              desc: { type: 'string', description: 'Design visual fixo, em inglês, seguindo as regras de personagens das instruções.' },
              poses: {
                type: 'array', minItems: 1, maxItems: 12,
                items: {
                  type: 'object', additionalProperties: false, required: ['ref', 'name', 'desc'],
                  properties: {
                    ref: { type: 'string' },
                    name: { type: 'string', description: 'Nome curto da pose/emoção, em português (ex.: "Falando").' },
                    desc: { type: 'string', description: 'A pose, em inglês: expressão + um gesto simples (ex.: "thinking, one hand touching the chin, eyes looking up").' },
                  },
                },
              },
            },
          },
        },
        continuar: {
          type: 'string',
          description: 'Só com personagens: o que ainda falta fazer do pedido depois que o usuário aceitar os personagens (ex.: "criar a cena em que Rafa chega à praia e fala com Lia"), em uma ou duas frases; "" se nada. É reenviado a você automaticamente, com os personagens novos no elenco.',
        },
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
              time: { type: 'string', enum: ['day', 'sunset', 'night', 'interior', 'water', ''], description: BG_TIME_RULE },
              mood: { type: 'string', description: BG_MOOD_RULE },
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

// Formato do texto de uma cena, igual em todos os prompts que escrevem texto.
// Regras para criar personagens, tiradas dos experimentos de imagem (GPT Image + Qwen/ComfyUI, chroma key;
// output/peca-chroma-key e worker/IMAGENS-EXPERIMENTO.md). desc e as poses vão quase literais para os
// prompts do charsheet e das poses (imaging/pipeline.ts).
const CHARACTER_RULES = `Personagens novos (campo personagens):
- Crie um personagem só quando o pedido precisa de alguém que não está no elenco, ou quando o usuário pede. Nunca
  recrie quem já existe. Personagens novos vão sempre numa chamada própria de propor_mudancas, sem nenhuma mudança
  de cena. Se o pedido também envolve cenas com o personagem, não as proponha agora: escreva em continuar o que
  falta fazer. Quando o usuário aceitar, você recebe uma mensagem "(Personagens aceitos: ...)" com o elenco novo
  (as poses aparecem já, ainda gerando) e então propõe as cenas. Na resposta, diga que as cenas vêm depois.
- As imagens são geradas a partir de desc e de cada pose: escreva os dois em inglês, como descrição visual concreta.
- desc é o design fixo, repetido igual em todas as imagens do personagem. Descreva só o que se vê, de corpo inteiro:
  tipo de corpo e idade aparente, cabelo (cor, comprimento, penteado), rosto e olhos, roupa peça por peça com cores
  nomeadas, calçados e acessórios. Seja específico e consistente (ex.: "navy blue blazer with gold buttons", não
  "roupa elegante"). Sem personalidade, história, cenário, iluminação, estilo de arte, fundo ou pose: isso o
  sistema já define. 2 a 5 frases.
- Cabelo como forma e cor, do jeito que se desenha num sprite de VN: penteado e silhueta, comprimento, franja,
  mechas grandes ou topete marcantes e a cor (ex.: "spiky dark brown hair swept back, a few large locks over the
  forehead"). Não descreva fios, textura ou brilho do cabelo.
- Evite palavras de textura e desgaste que puxam para o realista: weathered, rugged, gritty, grizzled, worn, rough
  skin, pores, detailed, realistic. Marcas que definem o personagem podem entrar, ditas de forma simples (ex.:
  "wrinkles around the eyes" num idoso, "a scar across the left cheek"); barba só se for parte do visual, e então
  como forma ("short full beard"), não "stubble".
- Evite no design materiais transparentes ou translúcidos (vidro, véus, rendas finas, fumaça, brilhos soltos) e
  partes soltas longe do corpo: o recorte do fundo funciona melhor com silhueta opaca e contorno bem definido.
  Qualquer paleta serve: a cor do fundo para o recorte é escolhida automaticamente.
- Poses: uma por emoção que as cenas vão usar; comece com 3 a 4 (ex.: neutro, falando, pensando e uma emoção da
  história). Cada pose = expressão + UM gesto simples de conversa, com os dois pés no chão e as mãos visíveis (ex.:
  "speaking, one hand raised palm up at chest height, mouth open, friendly smile"). A silhueta precisa ser bem
  diferente da posição neutra em pé (braços para baixo, olhando para a frente), senão a pose sai igual à
  referência; mas não descreva vários ajustes de quadril, joelho, ombros e braços, que deixam a pose estranha.
  Sem pernas levantadas, saltos, corridas, objetos grandes nas mãos ou outros personagens na mesma pose.
- As imagens levam alguns minutos e aparecem sozinhas depois que o usuário aceita; não prometa imagens prontas.`;

export const TEXT_RULES = `Formato do texto de cada cena:
- fala (dialogue): o texto é SÓ o que quem fala diz, em primeira pessoa, como aparece no balão do jogo. Sem o nome
  de quem fala, sem aspas ou travessão, sem "diz", "sussurra" etc., sem gestos, reações ou ambiente.
- narração (narration): descreve ambiente, ações e reações. Não coloque falas de personagens dentro da narração.
- Uma cena tem um texto só. Para gesto + fala, crie uma cena de narração e outra de fala em seguida; para dois
  personagens falando, uma cena de fala para cada um. Ao reescrever uma cena de fala, mantenha só a fala, ou mude
  o tipo para narração.
- Para dar gestos ou ambiente a uma cena de fala que já existe, crie a narração ANTES dela: religue para a narração
  nova o que levava à fala e ligue a narração à fala (choice "next"). As ações da cena de fala ficam onde estão.`;

export const COAUTHOR = 'Você é um coautor de visual novels dentro de um editor colaborativo. Escreva em português e mantenha o tom e a continuidade da história.';

export const SCENE_SCHEMA = {
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
export const TEXT_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['mode', 'text'],
  properties: { mode: { type: 'string', enum: ['continue', 'rewrite'] }, text: { type: 'string' } },
};
export const BG_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['scene', 'time', 'mood'],
  properties: { scene: { type: 'string' }, time: { type: 'string' }, mood: { type: 'string' } },
};
// O estilo e as restrições fixas (sem pessoas, chão livre etc.) ficam no template do pipeline;
// aqui só o lugar, descrito de forma concreta, para que todo background saia no mesmo estilo anime.
export const BG_ENHANCER = `You write image prompts for background art of an anime visual novel. The author gives a name and a short description, often in Portuguese.
Return JSON:
- scene: ${BG_SCENE_RULES.replace(/\n/g, '\n  ')}
- time: ${BG_TIME_RULE}.
- mood: ${BG_MOOD_RULE}.`;
export const OPTION_SCHEMA = { type: 'object', additionalProperties: false, required: ['label'], properties: { label: { type: 'string' } } };

export function systemPrompt(ctx: AiContext, story: StorySnapshot): string {
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
${CHARACTER_RULES}
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
export function storyBrief(ctx: AiContext, story: StorySnapshot): string {
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
  // Prompt de cada background (o que a imagem mostra), para decidir se serve e combinar backgrounds vizinhos.
  // Inteiro (~150 tokens) até 12 backgrounds; acima disso, só o começo.
  const room = ctx.backgrounds.length > 12 ? 300 : 1200;
  const bgs = ctx.backgrounds.map(b =>
    `- ${b.id} "${b.name}"${b.desc ? ': ' + clip(b.desc, 400) : ''}${b.prompt ? '\n  imagem: ' + clip(b.prompt, room) : ''}`).join('\n');
  return `História "${story.title}":
${scenes || '(vazia)'}

Personagens:
${chars || '(nenhum)'}

Backgrounds:
${bgs || '(nenhum)'}`;
}
