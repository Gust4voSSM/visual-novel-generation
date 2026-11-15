// POST /api/upload: corpo = bytes da imagem (PNG, JPEG ou WebP, até 8 MB).
// Devolve {key}; quem enviou grava a chave no banco (o editor por apply_operations, o worker
// no resultado do pedido). A chave é aleatória e a imagem é pública para quem tiver o link.
import { json } from '../../lib/oauth.js';
import { MAX_BYTES, newKey, sniff, uploader } from '../../lib/images.js';

export async function onRequestPost({ request, env }) {
  if (!env.IMAGES) return json({ error: 'NO_STORAGE' }, 503);
  const who = await uploader(request, env);
  if (!who) return json({ error: 'FORBIDDEN' }, 403);
  const len = Number(request.headers.get('Content-Length') || '0');
  if (len > MAX_BYTES) return json({ error: 'TOO_LARGE' }, 413);
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (!bytes.length) return json({ error: 'EMPTY' }, 400);
  if (bytes.length > MAX_BYTES) return json({ error: 'TOO_LARGE' }, 413);
  const type = sniff(bytes);
  if (!type) return json({ error: 'UNSUPPORTED_TYPE' }, 415);
  const key = newKey(type);
  await env.IMAGES.put(key, bytes, { metadata: { type, by: who } });
  return json({ key }, 201);
}
