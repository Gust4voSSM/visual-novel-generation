// POST /api/auth/logout: revoga o refresh token no Google e apaga o cookie.
import { RT_COOKIE, clearCookie, json, readCookie, revoke, sameOrigin, unseal } from '../../../lib/oauth.js';

export async function onRequestPost({ request, env }) {
  if (!sameOrigin(request, env)) return json({ error: 'FORBIDDEN' }, 403);
  const sealed = readCookie(request, RT_COOKIE);
  const rt = sealed && (await unseal(env, sealed));
  if (rt) await revoke(rt);
  return json({ ok: true }, 200, { 'Set-Cookie': clearCookie(RT_COOKIE) });
}
