import { authStorageReady, createSession, sessionActive, revokeSession, reserveAttempt, clearAttempts } from '../lib/auth-store.js';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { generateRegistrationOptions, verifyRegistrationResponse, generateAuthenticationOptions, verifyAuthenticationResponse } from '@simplewebauthn/server';
import { passkeyStore, PasskeyError, MAX_PASSKEYS } from '../lib/passkey-store.js';
import { signChallenge, readChallenge, createUsedChallenges, challengeCookie } from '../lib/passkey-challenge.js';

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
// Compara a senha informada com a do painel (digests de tamanho fixo, tempo constante).
export function passwordMatches(candidate, config) {
  return typeof candidate === 'string' && equal(signature(candidate, config.secret), signature(config.password, config.secret));
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

// Cria a sessão (revogável) e define o cookie assinado. Usado pela senha e pela chave de acesso.
async function issueSession(req, res, config) {
  const issued = Math.floor(Date.now() / 1000);
  const nonce = randomBytes(16).toString('hex');
  await createSession(nonce, issued + lifetime);
  const payload = Buffer.from(JSON.stringify({ v: sessionVersion, iat: issued, exp: issued + lifetime, nonce })).toString('base64url');
  setCookie(res, cookie(req, `${payload}.${signature(payload, config.secret + config.password)}`, lifetime));
}
// Acrescenta um cookie sem apagar os já definidos.
function setCookie(res, value) {
  const current = res.getHeader?.('Set-Cookie');
  res.setHeader('Set-Cookie', current ? [].concat(current, value) : value);
}

// ---- Chaves de acesso (WebAuthn) ----
// Dependências trocáveis nos testes.
export const passkeyDeps = { store: passkeyStore, generateRegistrationOptions, verifyRegistrationResponse, generateAuthenticationOptions, verifyAuthenticationResponse, used: createUsedChallenges() };
const passkeyActions = ['passkey-register-options', 'passkey-register-verify', 'passkey-auth-options', 'passkey-auth-verify', 'passkey-list', 'passkey-delete'];
const optionsHits = new Map();
const failureMessage = 'Não foi possível confirmar a chave de acesso.';
function hostName(req) { return String(req.headers.host || '').replace(/:\d+$/, '').toLowerCase(); }
export function relyingParty(req) {
  const name = hostName(req);
  const local = name === 'localhost' || name === '127.0.0.1';
  const rpID = local ? 'localhost' : name.replace(/^www\./, '');
  const protocol = process.env.VERCEL || req.headers['x-forwarded-proto'] === 'https' ? 'https:' : 'http:';
  const origins = local ? [`${protocol}//${req.headers.host}`] : [`https://${rpID}`, `https://www.${rpID}`];
  return { rpID, origins };
}
function userId(config) { return new Uint8Array(createHmac('sha256', config.secret).update('promisa-passkey-user').digest()); }
function isSecure(req) { return Boolean(process.env.VERCEL || req.headers['x-forwarded-proto'] === 'https'); }
function clearChallenge(req, res) { setCookie(res, challengeCookie('', { secure: isSecure(req), clear: true })); }
function takeChallenge(req, res, type, config) {
  const found = readChallenge(req.headers.cookie, type, config.secret);
  clearChallenge(req, res);
  return found && passkeyDeps.used.consume(found.challenge, found.exp) ? found.challenge : null;
}
async function failPasskey(res) {
  await new Promise(resolve => setTimeout(resolve, 600));
  return json(res, 401, { error: failureMessage });
}
async function passkeyRequest(req, res, config, action, body, ip) {
  const store = passkeyDeps.store;
  if (['passkey-register-options', 'passkey-register-verify', 'passkey-list', 'passkey-delete'].includes(action) && !await authorized(req, config)) {
    return json(res, 401, { error: 'Entre novamente para gerenciar as chaves de acesso.' });
  }
  try {
    if (action === 'passkey-list') {
      return json(res, 200, { items: (await store.list()).map(({ id, name, createdAt, lastUsedAt, deviceType }) => ({ id, name, createdAt, lastUsedAt, deviceType })) });
    }
    if (action === 'passkey-delete') {
      if (typeof body?.id !== 'string' || !body.id || body.id.length > 1024) return json(res, 400, { error: 'Chave inválida.' });
      return json(res, 200, await store.remove(body.id));
    }
    const { rpID, origins } = relyingParty(req);
    if (action === 'passkey-register-options') {
      const existing = await store.list();
      if (existing.length >= MAX_PASSKEYS) return json(res, 409, { error: `Limite de ${MAX_PASSKEYS} chaves atingido. Remova uma antes de adicionar outra.` });
      const options = await passkeyDeps.generateRegistrationOptions({
        rpName: 'Promisa Criação Digital', rpID, userID: userId(config), userName: 'admin', userDisplayName: 'Promisa · Administrador',
        attestationType: 'none', excludeCredentials: existing.map(item => ({ id: item.id, transports: item.transports })),
        authenticatorSelection: { residentKey: 'required', userVerification: 'required' }
      });
      setCookie(res, challengeCookie(signChallenge({ challenge: options.challenge, type: 'reg' }, config.secret), { secure: isSecure(req) }));
      return json(res, 200, options);
    }
    if (action === 'passkey-register-verify') {
      const name = typeof body?.name === 'string' ? body.name.trim() : 'Dispositivo';
      if (name.length > 40) return json(res, 400, { error: 'Use um nome com até 40 letras.' });
      const challenge = takeChallenge(req, res, 'reg', config);
      if (!challenge || !body?.response || typeof body.response !== 'object') return json(res, 400, { error: 'O pedido expirou. Tente ativar de novo.' });
      let info;
      try {
        const result = await passkeyDeps.verifyRegistrationResponse({ response: body.response, expectedChallenge: challenge, expectedOrigin: origins, expectedRPID: rpID, requireUserVerification: true });
        if (!result?.verified) throw new Error();
        info = result.registrationInfo;
      } catch { return json(res, 400, { error: 'Não foi possível ativar a chave neste aparelho.' }); }
      const now = new Date().toISOString();
      await store.add({
        id: info.credential.id, publicKey: Buffer.from(info.credential.publicKey).toString('base64url'), counter: info.credential.counter,
        transports: info.credential.transports || [], deviceType: info.credentialDeviceType, backedUp: Boolean(info.credentialBackedUp),
        name: name || 'Dispositivo', createdAt: now, lastUsedAt: null
      });
      return json(res, 200, { ok: true });
    }
    if (action === 'passkey-auth-options') {
      const now = Date.now(), hit = optionsHits.get(ip);
      for (const [key, value] of optionsHits) if (value.reset <= now) optionsHits.delete(key);
      const current = hit && hit.reset > now ? hit : { count: 0, reset: now + 10 * 60 * 1000 };
      if (optionsHits.size < 10000) optionsHits.set(ip, { ...current, count: current.count + 1 });
      if (current.count >= 30) { res.setHeader('Retry-After', String(Math.ceil((current.reset - now) / 1000))); return json(res, 429, { error: 'Muitas tentativas. Aguarde antes de tentar novamente.' }); }
      const options = await passkeyDeps.generateAuthenticationOptions({ rpID, userVerification: 'required', allowCredentials: [] });
      setCookie(res, challengeCookie(signChallenge({ challenge: options.challenge, type: 'auth' }, config.secret), { secure: isSecure(req) }));
      return json(res, 200, options);
    }
    // passkey-auth-verify
    const retryAfter = await reserveAttempt('pk:' + ip);
    if (retryAfter) { res.setHeader('Retry-After', String(retryAfter)); return json(res, 429, { error: 'Muitas tentativas. Aguarde antes de tentar novamente.' }); }
    const challenge = takeChallenge(req, res, 'auth', config);
    const id = body?.response?.id;
    const credential = challenge && typeof id === 'string' && id.length <= 1024 ? await store.find(id) : null;
    if (!credential) return await failPasskey(res);
    let result;
    try {
      result = await passkeyDeps.verifyAuthenticationResponse({
        response: body.response, expectedChallenge: challenge, expectedOrigin: origins, expectedRPID: rpID, requireUserVerification: true,
        credential: { id: credential.id, publicKey: new Uint8Array(Buffer.from(credential.publicKey, 'base64url')), counter: credential.counter, transports: credential.transports }
      });
    } catch { return await failPasskey(res); }
    if (!result?.verified) return await failPasskey(res);
    // Falha ao registrar o uso não deve impedir um login já confirmado.
    try { await store.touch(credential.id, { counter: result.authenticationInfo.newCounter, lastUsedAt: new Date().toISOString() }); } catch {}
    await clearAttempts('pk:' + ip);
    await issueSession(req, res, config);
    return json(res, 200, { ok: true });
  } catch (error) {
    if (error instanceof PasskeyError) return json(res, error.status, { error: error.message });
    throw error;
  }
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
  try {
    // Clearing an unusable cookie must not depend on configuring a new login.
    // A valid session still has to be revoked durably before reporting logout success.
    if (req.method === 'POST' && !sameOrigin(req)) return json(res, 403, { error: 'Origem não permitida.' });
    if (req.method === 'POST' && action === 'logout') {
      if (config && authStorageReady() && session(req, config)) await revokeSession(sessionPayload(req).nonce);
      res.setHeader('Set-Cookie', cookie(req, '', 0));
      return json(res, 200, { ok: true });
    }
    if (!config) return json(res, 503, {
      code: 'AUTH_CONFIGURATION_REQUIRED',
      error: 'Confira na Vercel: ADMIN_PASSWORD deve ter pelo menos 12 caracteres e ADMIN_SESSION_SECRET, pelo menos 32. Salve as variáveis em Production e faça um novo deploy.'
    });
    if (!authStorageReady()) return json(res, 503, {
      code: 'AUTH_STORAGE_REQUIRED',
      error: 'Configure BLOB_READ_WRITE_TOKEN de um Vercel Blob privado em Production e faça um novo deploy para habilitar o acesso.'
    });
    if (req.method === 'POST') {
    if (action !== 'login' && !passkeyActions.includes(action)) return json(res, 404, { error: 'Operação não encontrada.' });
    if (!String(req.headers['content-type'] || '').startsWith('application/json')) return json(res, 415, { error: 'Formato inválido.' });
    // Na Vercel, x-real-ip/x-vercel-forwarded-for são definidos pela plataforma (não pelo visitante).
    const ip = String(req.headers['x-real-ip'] || req.headers['x-vercel-forwarded-for'] || req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown').split(',')[0].trim();
    let body;
    try { body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body; } catch {}
    if (action !== 'login') return await passkeyRequest(req, res, config, action, body, ip);
    if (typeof body?.password !== 'string' || body.password.length > 256) return json(res, 400, { error: 'Informe uma senha válida.' });
    const retryAfter = await reserveAttempt(ip);
    if (retryAfter) { res.setHeader('Retry-After', String(retryAfter)); return json(res, 429, { error: 'Muitas tentativas. Aguarde antes de tentar novamente.' }); }
    // Digests de tamanho fixo evitam comparar a senha diretamente.
    const valid = equal(signature(body.password, config.secret), signature(config.password, config.secret));
    await new Promise(resolve => setTimeout(resolve, 600));
    if (!valid) return json(res, 401, { error: 'Senha incorreta. Tente novamente.' });
    await clearAttempts(ip);
    await issueSession(req, res, config);
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
  } catch { return json(res, 503, { code: 'AUTH_STORAGE_UNAVAILABLE', error: 'Não foi possível acessar o armazenamento de sessões. Confira se o Vercel Blob é privado, se BLOB_READ_WRITE_TOKEN está válido e conectado a este projeto e tente novamente.' }); }
}
