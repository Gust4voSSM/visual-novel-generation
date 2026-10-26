// Onde as imagens geradas ficam. No deploy: Cloudflare R2 com nome aleatório (seção 2.7).
// No mock, o provedor devolve um placeholder estático que o cliente serve de /placeholders.
import type { GeneratedImage } from './providers';

export interface ImageStore {
  /** Grava a imagem e devolve o image_key (caminho relativo à base pública de imagens). */
  put(img: GeneratedImage): Promise<string>;
}

export function createStore(): ImageStore {
  return {
    async put(img) {
      if (img.placeholderKey) return img.placeholderKey;
      // R2 (compressão WebP ≤ 500 KB + upload) entra junto com o provedor real.
      throw new Error('STORAGE_NOT_CONFIGURED');
    },
  };
}
