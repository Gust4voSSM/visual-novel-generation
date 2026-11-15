// GET /img/<32 hex>.<ext>: a imagem guardada no KV. As chaves nunca mudam de conteúdo, então a
// resposta é imutável e fica no cache da borda (menos leituras do KV, que têm limite diário).
import { KEY_RE } from '../../lib/images.js';

export async function onRequestGet({ request, env, params, waitUntil }) {
  const key = `img/${params.name}`;
  if (!KEY_RE.test(key) || !env.IMAGES) return new Response('not found', { status: 404 });
  const cache = caches.default;
  const hit = await cache.match(request);
  if (hit) return hit;
  const { value, metadata } = await env.IMAGES.getWithMetadata(key, { type: 'arrayBuffer' });
  if (!value) return new Response('not found', { status: 404, headers: { 'Cache-Control': 'no-store' } });
  const res = new Response(value, {
    headers: {
      'Content-Type': metadata?.type || 'application/octet-stream',
      'Cache-Control': 'public, max-age=31536000, immutable',
      'X-Content-Type-Options': 'nosniff',
    },
  });
  waitUntil(cache.put(request, res.clone()));
  return res;
}
