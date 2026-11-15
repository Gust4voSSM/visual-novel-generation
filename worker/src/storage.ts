// Onde as imagens geradas ficam.
// - IMAGE_API_URL definido (deploy, e local com `npm run dev:api` no client): POST /api/upload das
//   Pages Functions, que guarda no KV (binding IMAGES) e devolve image_key img/<hex>.<ext>. O
//   worker se identifica com WORKER_SECRET, a mesma variável configurada no projeto do Pages.
// - Sem IMAGE_API_URL: arquivo em client/public/generated (servido pelo Vite), para os testes.
// No mock, o provedor devolve um placeholder estático que o cliente serve de /placeholders.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { GeneratedImage } from './providers';
import type { KeyChoice } from './imaging/postprocess';
import type { Unit } from './imaging/pipeline';

export interface ImageStore {
  /** Grava a imagem e devolve o image_key (caminho relativo à base pública de imagens). */
  put(img: GeneratedImage): Promise<string>;
  /** Bytes de uma imagem gravada por put; null para placeholders. */
  get(key: string): Promise<Uint8Array | null>;
}

const DIR = resolve(process.env.IMAGE_DIR ?? '../client/public/generated');
const EXT: Record<string, string> = { 'image/webp': 'webp', 'image/png': 'png', 'image/jpeg': 'jpg' };

const API = (process.env.IMAGE_API_URL ?? '').replace(/\/+$/, '');
const KV_KEY = /^img\/[0-9a-f]{32}\.(?:webp|png|jpg)$/;

function diskStore(): ImageStore {
  return {
    async put(img) {
      if (img.placeholderKey) return img.placeholderKey;
      if (!img.bytes) throw new Error('STORAGE_EMPTY');
      const name = `${crypto.randomUUID().replace(/-/g, '')}.${EXT[img.contentType ?? ''] ?? 'png'}`;
      await mkdir(DIR, { recursive: true });
      await writeFile(join(DIR, name), img.bytes);
      return `generated/${name}`;
    },
    async get(key) {
      const m = /^generated\/([0-9a-f]{32}\.(?:webp|png|jpg))$/.exec(key);
      return m ? readFile(join(DIR, m[1])) : null;
    },
  };
}

function apiStore(): ImageStore {
  const disk = diskStore();
  const secret = process.env.WORKER_SECRET ?? '';
  return {
    async put(img) {
      if (img.placeholderKey) return img.placeholderKey;
      if (!img.bytes) throw new Error('STORAGE_EMPTY');
      const r = await fetch(`${API}/api/upload`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${secret}`, 'Content-Type': img.contentType ?? 'image/png' },
        body: Buffer.from(img.bytes),
      });
      const body = (await r.json().catch(() => ({}))) as { key?: string; error?: string };
      if (!r.ok || !body.key || !KV_KEY.test(body.key)) throw new Error(`STORAGE_ERROR:${r.status} ${body.error ?? ''}`.trim());
      return body.key;
    },
    async get(key) {
      if (!KV_KEY.test(key)) return disk.get(key); // generated/… de antes do KV
      const r = await fetch(`${API}/${key}`);
      if (r.status === 404) return null;
      if (!r.ok) throw new Error(`STORAGE_ERROR:${r.status}`);
      return new Uint8Array(await r.arrayBuffer());
    },
  };
}

export function createStore(): ImageStore {
  return API ? apiStore() : diskStore();
}

// Charsheet de um personagem (seção 5): referências front e side, cor-chave escolhida e a altura
// do front (unidade das poses). Guardado pelo worker; o pedido de personagem pode reusar por sheet_id.
export type CharSheet = {
  id: string; design: string; front: string; side: string;
  keyColor: KeyChoice['color']; keyScores: KeyChoice['scores'] | null; unit: Unit | null; createdAt: string;
};

const SHEETS = resolve(process.env.AI_SHEET_DIR ?? './charsheets');

export const sheets = {
  async save(s: CharSheet) {
    await mkdir(SHEETS, { recursive: true });
    await writeFile(join(SHEETS, `${s.id}.json`), JSON.stringify(s, null, 2));
  },
  async get(id: string): Promise<CharSheet | null> {
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) return null;
    try { return JSON.parse(await readFile(join(SHEETS, `${id}.json`), 'utf8')); } catch { return null; }
  },
};
