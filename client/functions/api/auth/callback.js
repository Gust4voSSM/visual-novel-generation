// GET /api/auth/callback?code&state: troca o código por tokens e guarda o refresh token no cookie.
import { OAUTH_COOKIE, callbackUrl, clearCookie, decodeNext, googleToken, readCookie, redirect, rtCookie, seal } from '../../../lib/oauth.js';

const fail = code => redirect('/login?error=' + code, [clearCookie(OAUTH_COOKIE)]);

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  if (url.searchParams.get('error')) return fail(url.searchParams.get('error') === 'access_denied' ? 'denied' : 'google');
  const [state, verifier, nextEnc, consent] = (readCookie(request, OAUTH_COOKIE) || '').split('.');
  if (!state || state !== url.searchParams.get('state')) return fail('state');
  const next = decodeNext(nextEnc);

  const { ok, body } = await googleToken(env, {
    grant_type: 'authorization_code',
    code: url.searchParams.get('code') || '',
    code_verifier: verifier,
    redirect_uri: callbackUrl(request, env),
  });
  if (!ok || !body.id_token) return fail('exchange');
  // Conta que já tinha autorizado o app em outro aparelho: sem refresh token. Pede o consentimento uma vez.
  if (!body.refresh_token) {
    if (consent === '1') return fail('no_refresh');
    return redirect('/api/auth/start?consent=1&next=' + encodeURIComponent(next), [clearCookie(OAUTH_COOKIE)]);
  }
  return redirect(next, [clearCookie(OAUTH_COOKIE), rtCookie(await seal(env, body.refresh_token))]);
}
