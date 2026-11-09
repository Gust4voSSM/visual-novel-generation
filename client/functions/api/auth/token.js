// POST /api/auth/token: ID token novo (1 h) a partir do refresh token do cookie.
// 401 = sem sessão; o cliente manda para /login.
import { RT_COOKIE, clearCookie, googleToken, json, readCookie, rtCookie, sameOrigin, seal, unseal } from '../../../lib/oauth.js';

export async function onRequestPost({ request, env }) {
  if (!sameOrigin(request, env)) return json({ error: 'FORBIDDEN' }, 403);
  const sealed = readCookie(request, RT_COOKIE);
  const rt = sealed && (await unseal(env, sealed));
  if (!rt) return json({ error: 'NO_SESSION' }, 401, sealed ? { 'Set-Cookie': clearCookie(RT_COOKIE) } : {});
  const { ok, body } = await googleToken(env, { grant_type: 'refresh_token', refresh_token: rt });
  // invalid_grant: acesso revogado na conta Google ou refresh token expirado.
  if (!ok || !body.id_token) {
    if (body.error === 'invalid_grant') return json({ error: 'NO_SESSION' }, 401, { 'Set-Cookie': clearCookie(RT_COOKIE) });
    return json({ error: 'GOOGLE_ERROR' }, 502);
  }
  // O Google raramente troca o refresh token; se trocar, o cookie acompanha.
  const headers = body.refresh_token ? { 'Set-Cookie': rtCookie(await seal(env, body.refresh_token)) } : {};
  return json({ id_token: body.id_token, expires_in: body.expires_in }, 200, headers);
}
