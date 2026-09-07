// Cloudflare Worker: serves the built app from ./dist behind a cookie session.
// Auth today: a single username/password from env vars. Swap `checkCredentials`
// and the /login route for an OIDC flow later; everything else stays the same.

interface Env {
  ASSETS: { fetch(request: Request): Promise<Response> };
  AUTH_USER: string;
  AUTH_PASS: string;
  SESSION_SECRET: string;
  SESSION_DAYS?: string;
}

const COOKIE = 'fto_session';

const enc = new TextEncoder();

async function hmac(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(data));
  return b64url(new Uint8Array(sig));
}

function b64url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}

async function makeSession(env: Env, user: string): Promise<string> {
  const days = Number(env.SESSION_DAYS ?? '30');
  const exp = Date.now() + days * 86400e3;
  const payload = `${user}.${exp}`;
  return `${payload}.${await hmac(env.SESSION_SECRET, payload)}`;
}

async function verifySession(env: Env, token: string | undefined): Promise<string | null> {
  if (!token) return null;
  const i = token.lastIndexOf('.');
  if (i < 0) return null;
  const payload = token.slice(0, i);
  const sig = token.slice(i + 1);
  if (!timingSafeEqual(sig, await hmac(env.SESSION_SECRET, payload))) return null;
  const [user, expStr] = payload.split('.');
  if (!user || Number(expStr) < Date.now()) return null;
  return user;
}

function getCookie(req: Request, name: string): string | undefined {
  const raw = req.headers.get('Cookie') ?? '';
  for (const part of raw.split(/;\s*/)) {
    const [k, ...v] = part.split('=');
    if (k === name) return v.join('=');
  }
  return undefined;
}

function checkCredentials(env: Env, user: string, pass: string): boolean {
  return timingSafeEqual(user, env.AUTH_USER) && timingSafeEqual(pass, env.AUTH_PASS);
}

function loginPage(error = ''): Response {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>Sign in · Five Three One</title>
<meta name="theme-color" content="#14161b">
<style>
:root{color-scheme:dark light}
body{margin:0;min-height:100vh;display:grid;place-items:center;background:#14161b;color:#e8e6df;font:17px/1.4 -apple-system,'Segoe UI',system-ui,sans-serif}
@media (prefers-color-scheme:light){body{background:#f3f2ee;color:#1b1d22}}
form{width:min(360px,90vw);display:flex;flex-direction:column;gap:12px}
h1{font-size:34px;line-height:1;margin:0 0 6px;text-transform:uppercase;letter-spacing:.01em;font-family:'Arial Narrow','Helvetica Neue',sans-serif}
label{font-size:12.5px;text-transform:uppercase;letter-spacing:.08em;font-weight:600;opacity:.7}
input{width:100%;box-sizing:border-box;min-height:48px;padding:10px 12px;border-radius:10px;border:1px solid #2f3440;background:#262a34;color:inherit;font:inherit}
@media (prefers-color-scheme:light){input{border-color:#d7d6cf;background:#fff}}
button{min-height:52px;border:0;border-radius:10px;background:#4d8be6;color:#0d1117;font:600 18px/1 inherit;text-transform:uppercase;letter-spacing:.04em;cursor:pointer}
.err{color:#e2574c;font-weight:600}
</style></head><body>
<form method="post" action="/login">
  <h1>Five Three One</h1>
  ${error ? `<div class="err">${error}</div>` : ''}
  <div><label for="u">Username</label><input id="u" name="username" autocomplete="username" autocapitalize="none" required></div>
  <div><label for="p">Password</label><input id="p" name="password" type="password" autocomplete="current-password" required></div>
  <button type="submit">Sign in</button>
</form></body></html>`;
  return new Response(html, { status: error ? 401 : 200, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const secure = url.protocol === 'https:';
    const cookieAttrs = `Path=/; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`;

    if (url.pathname === '/login') {
      if (request.method === 'GET') return loginPage();
      if (request.method === 'POST') {
        const form = await request.formData();
        const user = String(form.get('username') ?? '');
        const pass = String(form.get('password') ?? '');
        if (!checkCredentials(env, user, pass)) return loginPage('Wrong username or password.');
        const days = Number(env.SESSION_DAYS ?? '30');
        const token = await makeSession(env, user);
        return new Response(null, {
          status: 303,
          headers: { Location: '/', 'Set-Cookie': `${COOKIE}=${token}; Max-Age=${days * 86400}; ${cookieAttrs}` },
        });
      }
      return new Response('Method not allowed', { status: 405 });
    }
    if (url.pathname === '/logout') {
      return new Response(null, { status: 303, headers: { Location: '/login', 'Set-Cookie': `${COOKIE}=; Max-Age=0; ${cookieAttrs}` } });
    }

    const user = await verifySession(env, getCookie(request, COOKIE));
    if (!user) {
      // The service worker and manifest fetch without credentials prompts; send them to login too,
      // but as a JSON 401 for non-navigation requests so the app can react.
      const isNav = request.headers.get('Sec-Fetch-Mode') === 'navigate' || request.headers.get('Accept')?.includes('text/html');
      if (isNav) return new Response(null, { status: 302, headers: { Location: '/login', 'Cache-Control': 'no-store' } });
      return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
    }

    if (url.pathname === '/whoami') {
      return new Response(JSON.stringify({ user }), { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
    }

    const res = await env.ASSETS.fetch(request);
    const headers = new Headers(res.headers);
    headers.set('X-Frame-Options', 'DENY');
    headers.set('Referrer-Policy', 'same-origin');
    if (url.pathname.endsWith('/sw.js')) headers.set('Cache-Control', 'no-cache');
    return new Response(res.body, { status: res.status, headers });
  },
};
