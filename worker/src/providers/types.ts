import type { KeyColorName } from '../imaging/keyer';
import type { Unit } from '../imaging/pipeline';

export type StoryScene = {
  id: string; title: string; x: number; y: number; text: string; next: string; bg: string;
  chars: string; kind: string; speaker: string; // chars: JSON [{c, s}], como na tabela scene
};
export type StoryChoice = { id: string; sceneId: string; label: string; target: string; position: number };
export type StorySnapshot = { title: string; startScene: string; scenes: StoryScene[]; choices: StoryChoice[] };

export type AiContext = {
  characters: { id: string; name: string; desc?: string; sprites: { id: string; name: string; desc?: string }[] }[];
  backgrounds: { id: string; name: string; desc?: string; prompt?: string }[]; // prompt: o da imagem, em inglês
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
// characters: personagens novos que o cliente manda gerar (generate_character) antes de aplicar ops;
// as cenas em ops já podem usar os ids deles e das poses.
export type NewCharacter = { id: string; name: string; desc: string; color: string; poses: { id: string; name: string; desc: string }[] };
// continuar: o resto do pedido, que o cliente reenvia ao agente quando os personagens forem aceitos.
export type Proposal = { summary: string[]; ops: Op[]; created: string[]; characters?: NewCharacter[]; continuar?: string; backgrounds?: NewBackground[] };

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
