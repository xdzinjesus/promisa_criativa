import { authStorageReady, createSession, sessionActive, revokeSession, reserveAttempt, clearAttempts } from '../lib/auth-store.js';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const lifetime = 15 * 60;
const sessionVersion = 3; // Invalida todos os cookies emitidos antes desta correção.
const publicCsp = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'";
const privateCsp = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; font-src 'self' data:; connect-src 'self' data: blob: https://*.vercel-storage.com https://vercel.com; frame-src blob:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'";

export function settings() {
  const password = process.env.ADMIN_PASSWORD;
  const secret = process.env.ADMIN_SESSION_SECRET;
  return password?.length >= 12 && secret?.length >= 32 ? { password, secret } : null;
}
function signature(value, secret) {
  return createHmac('sha256', secret).update(value).digest('base64url');
}
function equal(a, b) {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
export function session(req, config) {
  const token = String(req.headers.cookie || '').split(';').map(x => x.trim()).find(x => x.startsWith('promisa_session='))?.slice(16);
  if (!token || token.length > 512) return false;
  const [payload, signed, extra] = token.split('.');
  if (!payload || !signed || extra || !equal(signature(payload, config.secret + config.password), signed)) return false;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString());
    const now = Math.floor(Date.now() / 1000);
    return data.v === sessionVersion && Number.isInteger(data.iat) && data.iat <= now &&
      typeof data.nonce === 'string' && /^[a-f0-9]{32}$/.test(data.nonce) && Number.isInteger(data.exp) && data.exp === data.iat + lifetime && data.exp > now;
  } catch { return false; }
}
function sessionPayload(req) {
  const token = String(req.headers.cookie || '').split(';').map(x => x.trim()).find(x => x.startsWith('promisa_session='))?.slice(16);
  return token ? JSON.parse(Buffer.from(token.split('.')[0], 'base64url').toString()) : null;
}
export async function authorized(req, config) {
  return session(req, config) && await sessionActive(sessionPayload(req).nonce);
}
function cookie(req, value, age) {
  const secure = process.env.VERCEL || req.headers['x-forwarded-proto'] === 'https';
  // Cookie de sessão: não mantém o login por vários dias no navegador.
  return `promisa_session=${value}; HttpOnly; SameSite=Strict; Path=/${age <= 0 ? '; Max-Age=0' : ''}${secure ? '; Secure' : ''}`;
}
function json(res, code, value) {
  res.statusCode = code;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(value));
}
export function sameOrigin(req) {
  try {
    const origin = new URL(req.headers.origin);
    const protocol = process.env.VERCEL ? 'https:' : (req.headers['x-forwarded-proto'] === 'https' ? 'https:' : 'http:');
    return origin.origin === `${protocol}//${req.headers.host}`;
  } catch { return false; }
}
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store, max-age=0');
  res.setHeader('CDN-Cache-Control', 'no-store');
  res.setHeader('Vercel-CDN-Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Content-Security-Policy', publicCsp);
  const url = new URL(req.url, 'http://localhost');
  const view = req.query?.view || url.searchParams.get('view');
  const action = req.query?.action || url.searchParams.get('action');
  if (!['GET', 'POST'].includes(req.method)) {
    res.setHeader('Allow', 'GET, POST');
    return json(res, 405, { error: 'Método não permitido.' });
  }
  const config = settings();
  if (!config) return json(res, 503, { error: 'Configure ADMIN_PASSWORD e ADMIN_SESSION_SECRET na Vercel para habilitar o acesso.' });
  if (!authStorageReady()) return json(res, 503, { error: 'Configure o Vercel Blob privado para habilitar sessões revogáveis e proteção compartilhada do login.' });
  try {
  if (req.method === 'POST') {
    if (!sameOrigin(req)) return json(res, 403, { error: 'Origem não permitida.' });
    if (action === 'logout') {
      if (session(req, config)) await revokeSession(sessionPayload(req).nonce);
      res.setHeader('Set-Cookie', cookie(req, '', 0));
      return json(res, 200, { ok: true });
    }
    if (action !== 'login') return json(res, 404, { error: 'Operação não encontrada.' });
    if (!String(req.headers['content-type'] || '').startsWith('application/json')) return json(res, 415, { error: 'Formato inválido.' });
    const ip = String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown').split(',')[0].trim();
    let body;
    try { body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body; } catch {}
    if (typeof body?.password !== 'string' || body.password.length > 256) return json(res, 400, { error: 'Informe uma senha válida.' });
    const retryAfter = await reserveAttempt(ip);
    if (retryAfter) { res.setHeader('Retry-After', String(retryAfter)); return json(res, 429, { error: 'Muitas tentativas. Aguarde antes de tentar novamente.' }); }
    // Digests de tamanho fixo evitam comparar a senha diretamente.
    const valid = equal(signature(body.password, config.secret), signature(config.password, config.secret));
    await new Promise(resolve => setTimeout(resolve, 600));
    if (!valid) return json(res, 401, { error: 'Senha incorreta. Tente novamente.' });
    await clearAttempts(ip);
    const issued = Math.floor(Date.now() / 1000);
    const nonce = randomBytes(16).toString('hex');
    await createSession(nonce, issued + lifetime);
    const payload = Buffer.from(JSON.stringify({ v: sessionVersion, iat: issued, exp: issued + lifetime, nonce })).toString('base64url');
    res.setHeader('Set-Cookie', cookie(req, `${payload}.${signature(payload, config.secret + config.password)}`, lifetime));
    return json(res, 200, { ok: true });
  }
  const authenticated = await authorized(req, config);
  if (action === 'session') return json(res, authenticated ? 200 : 401, { authenticated });
  if (!['admin', 'catalogo', 'panel'].includes(view)) return json(res, 404, { error: 'Página não encontrada.' });
  if (!authenticated) {
    res.statusCode = 303;
    res.setHeader('Location', '/acesso.html');
    return res.end();
  }
  try {
    const html = await readFile(join(process.cwd(), 'private', view === 'panel' ? 'panel.js' : `${view}.html`), 'utf8');
    res.setHeader('Content-Security-Policy', privateCsp);
    res.setHeader('Content-Type', view === 'panel' ? 'text/javascript; charset=utf-8' : 'text/html; charset=utf-8');
    res.statusCode = 200;
    res.end(html);
  } catch {
    return json(res, 500, { error: 'Não foi possível carregar a página. Tente novamente.' });
  }
  } catch { return json(res, 503, { error: 'Não foi possível verificar o acesso seguro. Tente novamente mais tarde.' }); }
}
