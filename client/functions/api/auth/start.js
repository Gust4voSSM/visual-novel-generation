// GET /api/auth/start?next=/s/<id>[&consent=1]: manda para o consentimento do Google.
import { OAUTH_COOKIE, callbackUrl, encodeNext, pkceChallenge, randomToken, redirect, safeNext, setCookie } from '../../../lib/oauth.js';

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const next = safeNext(url.searchParams.get('next'));
  const consent = url.searchParams.get('consent') === '1';
  const state = randomToken(), verifier = randomToken();
  const auth = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  auth.search = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    redirect_uri: callbackUrl(request, env),
    response_type: 'code',
    scope: 'openid email profile',
    access_type: 'offline', // pede o refresh token
    // O Google só manda refresh token no consentimento; o callback volta com consent=1 se faltar.
    prompt: consent ? 'consent' : 'select_account',
    state,
    code_challenge: await pkceChallenge(verifier),
    code_challenge_method: 'S256',
    include_granted_scopes: 'true',
  });
  // Lax: o cookie precisa voltar na navegação vinda do Google.
  const cookie = setCookie(OAUTH_COOKIE, `${state}.${verifier}.${encodeNext(next)}.${consent ? 1 : 0}`, { maxAge: 600, sameSite: 'Lax' });
  return redirect(auth.toString(), [cookie]);
}
