// Provedores de IA do worker (seção 2.6): mock e OpenAI. A chave da OpenAI vem de
// worker/.env.openai e só este processo a lê.
import type { AiProvider } from './types';
import { MockProvider } from './mock';
import { OpenAiProvider } from './openai';

export * from './types';
export { backgroundKind, emotionKind } from './mock';
export { OpenAiImageApi, pipelineImage } from './openai';
export { buildProposal, cleanSpeech, graphProblem, speechProblem, type ProposeArgs } from '../proposal';
export { parsePartialJson, proposalProgress } from '../stream';

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
