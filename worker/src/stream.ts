// Leitura do streaming da OpenAI: eventos SSE e JSON parcial dos argumentos da ferramenta.
import type { ProposalProgress, StorySnapshot } from './providers/types';
import type { ProposeArgs } from './proposal';

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
export function partialJsonString(json: string, field: string): string {
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
export async function* sseEvents(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
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
