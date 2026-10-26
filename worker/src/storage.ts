// Onde as imagens geradas ficam. No deploy: Cloudflare R2 com nome aleatório (seção 2.7).
// No mock, o provedor devolve um placeholder estático que o cliente serve de /placeholders.
// Localmente, imagens reais vão para client/public/generated (servidas pelo Vite).
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { GeneratedImage } from './providers';

export interface ImageStore {
  /** Grava a imagem e devolve o image_key (caminho relativo à base pública de imagens). */
  put(img: GeneratedImage): Promise<string>;
}

const DIR = resolve(process.env.IMAGE_DIR ?? '../client/public/generated');
const EXT: Record<string, string> = { 'image/webp': 'webp', 'image/png': 'png', 'image/jpeg': 'jpg' };

export function createStore(): ImageStore {
  return {
    async put(img) {
      if (img.placeholderKey) return img.placeholderKey;
      if (!img.bytes) throw new Error('STORAGE_EMPTY');
      // R2 (upload) entra no deploy; aqui, um arquivo com nome aleatório no disco.
      const name = `${crypto.randomUUID().replace(/-/g, '')}.${EXT[img.contentType ?? ''] ?? 'png'}`;
      await mkdir(DIR, { recursive: true });
      await writeFile(join(DIR, name), img.bytes);
      return `generated/${name}`;
    },
  };
}
