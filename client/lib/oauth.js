// Login Google pelas Pages Functions (fluxo authorization code + PKCE).
// O refresh token fica num cookie HttpOnly, cifrado com SESSION_KEY; o navegador só recebe
// ID tokens de 1 h, pedidos a /api/auth/token, e os guarda na memória.
// Variáveis (Pages → Settings → Variables; local em client/.env.local, sem prefixo VITE_):
//   GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, SESSION_KEY (32 bytes em base64),
//   APP_ORIGIN (opcional: origem pública quando há proxy na frente, ex. o Vite local)

export const RT_COOKIE = '__Host-rt';
export const OAUTH_COOKIE = '__Host-oauth';
const RT_MAX_AGE = 180 * 24 * 3600;

export const origin = (request, env) => env.APP_ORIGIN || new URL(request.url).origin;
export const callbackUrl = (request, env) => origin(request, env) + '/api/auth/callback';

// Só caminhos do próprio app: evita redirecionar para outro site depois do login.
export const safeNext = p => (typeof p === 'string' && /^\/(?!\/)[\w\-/]*$/.test(p) ? p : '/home');

export function readCookie(request, name) {
  for (const part of (request.headers.get('Cookie') || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return null;
}

export function setCookie(name, value, { maxAge, sameSite = 'Strict' }) {
  return `${name}=${value}; Path=/; Secure; HttpOnly; SameSite=${sameSite}; Max-Age=${maxAge}`;
}
export const rtCookie = sealed => setCookie(RT_COOKIE, sealed, { maxAge: RT_MAX_AGE });
export const clearCookie = name => setCookie(name, '', { maxAge: 0 });

const b64url = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64url = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
export const randomToken = (n = 32) => b64url(crypto.getRandomValues(new Uint8Array(n)));
export const pkceChallenge = async verifier => b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
export const encodeNext = next => b64url(new TextEncoder().encode(next));
export const decodeNext = s => { try { return safeNext(new TextDecoder().decode(unb64url(s))); } catch { return '/home'; } };

// AES-GCM: o cookie não expõe o refresh token nem aceita um forjado.
async function key(env) {
  if (!env.SESSION_KEY) throw new Error('SESSION_KEY ausente');
  return crypto.subtle.importKey('raw', unb64url(env.SESSION_KEY.replace(/=+$/, '')), 'AES-GCM', false, ['encrypt', 'decrypt']);
}
export async function seal(env, text) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await key(env), new TextEncoder().encode(text));
  return b64url(iv) + '.' + b64url(ct);
}
export async function unseal(env, sealed) {
  try {
    const [iv, ct] = sealed.split('.');
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64url(iv) }, await key(env), unb64url(ct));
    return new TextDecoder().decode(pt);
  } catch { return null; }
}

export async function googleToken(env, params) {
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET, ...params }),
  });
  const body = await r.json().catch(() => ({}));
  return { ok: r.ok, body };
}

export const revoke = token =>
  fetch('https://oauth2.googleapis.com/revoke', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ token }),
  }).catch(() => {});

export const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers } });

export function redirect(location, cookies = []) {
  const h = new Headers({ Location: location, 'Cache-Control': 'no-store' });
  for (const c of cookies) h.append('Set-Cookie', c);
  return new Response(null, { status: 302, headers: h });
}

// POST só do próprio site: com cookie SameSite=Strict isso já vale, aqui fica explícito.
export const sameOrigin = (request, env) => request.headers.get('Origin') === origin(request, env);
