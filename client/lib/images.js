// Imagens do elenco (uploads e geradas pelo worker) num KV ligado ao projeto do Pages.
// Binding: IMAGES (Pages → Settings → Bindings → KV namespace). Cada imagem é uma chave
// img/<32 hex>.<ext> com o tipo nos metadados; o banco guarda só essa chave (image_key).
// Variáveis: WORKER_SECRET (o worker envia com Authorization: Bearer) e, só local,
// UPLOAD_DEV_ANON=1 para aceitar envios sem login (como o AUTH_DEV_ANON do módulo).
import { RT_COOKIE, readCookie, sameOrigin, unseal } from './oauth.js';

export const MAX_BYTES = 8 * 1024 * 1024;
export const TYPES = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };
export const KEY_RE = /^img\/[0-9a-f]{32}\.(?:png|jpg|webp)$/;

// Confere a assinatura dos formatos aceitos: o Content-Type sozinho vem de quem envia.
export function sniff(bytes) {
  const b = bytes.subarray(0, 12);
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'image/webp';
  return null;
}

function same(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

// 'worker' | 'user' | null. Pessoas: mesma origem e sessão de login válida (o cookie do refresh token).
export async function uploader(request, env) {
  const auth = request.headers.get('Authorization') || '';
  if (auth.startsWith('Bearer ')) return env.WORKER_SECRET && same(auth.slice(7), env.WORKER_SECRET) ? 'worker' : null;
  // Só local, sem login (o Vite repassa com outra origem): aceita qualquer envio.
  if (env.UPLOAD_DEV_ANON === '1') return 'user';
  if (!sameOrigin(request, env)) return null;
  const sealed = readCookie(request, RT_COOKIE);
  return sealed && (await unseal(env, sealed)) ? 'user' : null;
}

export const newKey = type => {
  const hex = [...crypto.getRandomValues(new Uint8Array(16))].map(x => x.toString(16).padStart(2, '0')).join('');
  return `img/${hex}.${TYPES[type]}`;
};
