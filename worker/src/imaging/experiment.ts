// Modo experimento (PLANO-SPRITES-BACKGROUNDS.md, seção 4): com AI_IMAGE_EXPERIMENT=1, cada pedido
// de imagem grava numa pasta própria as imagens brutas e processadas e um meta.json com prompt,
// referências, modelo, tamanho, qualidade, caminho, cor-chave, tempo, custo, verificações,
// novas tentativas e fallbacks.
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

export const EXPERIMENT = process.env.AI_IMAGE_EXPERIMENT === '1';
const ROOT = resolve(process.env.AI_IMAGE_EXPERIMENT_DIR ?? './experiments');

export class ExperimentLog {
  readonly dir: string;
  private meta: Record<string, unknown>;
  private files = 0;
  private saving: Promise<unknown>[] = [];
  constructor(kind: string, label: string, base: Record<string, unknown> = {}) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const slug = label.toLowerCase().normalize('NFD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'x';
    this.dir = join(ROOT, `${stamp}-${kind}-${slug}-${crypto.randomUUID().slice(0, 6)}`);
    this.meta = { kind, label, startedAt: new Date().toISOString(), ...base, attempts: [] };
  }
  set(k: string, v: unknown) { this.meta[k] = v; }
  attempt(a: Record<string, unknown>) { (this.meta.attempts as unknown[]).push(a); }
  /** Grava um arquivo (só no modo experimento) e devolve o nome relativo. */
  file(name: string, bytes: Uint8Array | string): string {
    const file = `${String(++this.files).padStart(2, '0')}-${name}`;
    if (EXPERIMENT) this.saving.push(mkdir(this.dir, { recursive: true }).then(() => writeFile(join(this.dir, file), bytes)));
    return file;
  }
  async finish(extra: Record<string, unknown> = {}) {
    Object.assign(this.meta, extra, { finishedAt: new Date().toISOString() });
    if (!EXPERIMENT) return;
    await Promise.all(this.saving);
    await mkdir(this.dir, { recursive: true });
    await writeFile(join(this.dir, 'meta.json'), JSON.stringify(this.meta, null, 2));
  }
}
