import { authStorageReady, createSession, sessionActive, revokeSession, reserveAttempt, clearAttempts } from '../lib/auth-store.js';
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { generateRegistrationOptions, verifyRegistrationResponse, generateAuthenticationOptions, verifyAuthenticationResponse } from '@simplewebauthn/server';
import { passkeyStore, PasskeyError, MAX_PASSKEYS } from '../lib/passkey-store.js';
import { signChallenge, readChallenge, createUsedChallenges, challengeCookie } from '../lib/passkey-challenge.js';
import { createPartnerStore, createPartnerActions } from '../lib/partner-store.js';
import { cleanModules, accessFor } from '../src/partner-modules.js';

const partners = createPartnerActions({ store: createPartnerStore(), revoke: nonce => revokeSession(nonce) });
export const partnerActions = partners; // trocável nos testes

const lifetime = 15 * 60;
const sessionVersion = 3; // Invalida todos os cookies emitidos antes desta correção.
const publicCsp = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'";
const privateCsp = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; font-src 'self' data:; connect-src 'self' data: blob: https://*.vercel-storage.com https://vercel.com https://discord.com; frame-src blob:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'";

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
    const partnerOk = data.u === undefined || (typeof data.u === 'string' && /^u[a-f0-9]{12}$/.test(data.u) && Array.isArray(data.m) && data.m.length <= 20 && cleanModules(data.m).length === data.m.length);
    return data.v === sessionVersion && Number.isInteger(data.iat) && data.iat <= now && partnerOk &&
      typeof data.nonce === 'string' && /^[a-f0-9]{32}$/.test(data.nonce) && Number.isInteger(data.exp) && data.exp === data.iat + lifetime && data.exp > now;
  } catch { return false; }
}
function sessionPayload(req) {
  const token = String(req.headers.cookie || '').split(';').map(x => x.trim()).find(x => x.startsWith('promisa_session='))?.slice(16);
  return token ? JSON.parse(Buffer.from(token.split('.')[0], 'base64url').toString()) : null;
}
// Só o DONO. Todas as rotas que não conhecem sócios continuam exigindo o dono.
export async function authorized(req, config) {
  return session(req, config) && sessionPayload(req).u === undefined && await sessionActive(sessionPayload(req).nonce);
}
// Dono, ou sócio com o módulo que usa esta parte do servidor (ex.: 'publish', 'instagram').
export async function allowedFor(req, config, api) {
  const user = await who(req, config);
  return Boolean(user?.owner || (user?.partner && accessFor(user.modules).api(api)));
}
// Quem está logado: { owner: true } | { partner: true, id, name, modules } | null. Os módulos vêm do cookie assinado
// (sem leitura extra); mudar ou pausar o sócio corta as sessões dele na hora.
export async function who(req, config) {
  if (!config || !session(req, config)) return null;
  const data = sessionPayload(req);
  if (!await sessionActive(data.nonce)) return null;
  return data.u === undefined ? { owner: true } : { partner: true, id: data.u, name: typeof data.n === 'string' ? data.n.slice(0, 60) : '', modules: cleanModules(data.m) };
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
async function issueSession(req, res, config, partner = null, nonce = randomBytes(16).toString('hex')) {
  const issued = Math.floor(Date.now() / 1000);
  await createSession(nonce, issued + lifetime);
  const extra = partner ? { u: partner.id, m: cleanModules(partner.modules), n: String(partner.name || '').slice(0, 60) } : {};
  const payload = Buffer.from(JSON.stringify({ v: sessionVersion, iat: issued, exp: issued + lifetime, nonce, ...extra })).toString('base64url');
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
const partnerAdminActions = ['partner-list', 'partner-create', 'partner-update', 'partner-delete'];
const passkeyActions = ['passkey-register-options', 'passkey-register-verify', 'passkey-auth-options', 'passkey-auth-verify', 'passkey-list', 'passkey-delete'];
const failureMessage = 'Não foi possível confirmar a chave de acesso.';
const tooMany = 'Muitas tentativas. Aguarde antes de tentar novamente.';
// Endereços oficiais. Prévias (*.vercel.app) só usam chaves se listadas em PASSKEY_HOSTS.
const PRODUCTION_HOSTS = ['promisa.online', 'www.promisa.online'];
function hostOf(value) {
  try { return value ? new URL(String(value).includes('://') ? value : `https://${value}`).hostname.toLowerCase() : ''; } catch { return ''; }
}
function passkeyHosts() {
  const explicit = String(process.env.PASSKEY_HOSTS || '').split(',').map(hostOf).filter(Boolean);
  // Em prévias da Vercel, só os endereços liberados explicitamente.
  if (process.env.VERCEL && process.env.VERCEL_ENV && process.env.VERCEL_ENV !== 'production') return new Set(explicit);
  return new Set([...PRODUCTION_HOSTS, hostOf(process.env.SITE_URL), hostOf(process.env.VERCEL_PROJECT_PRODUCTION_URL), ...explicit].filter(Boolean));
}
// rpID e origens aceitas vêm de uma lista fixa; o cabeçalho Host só escolhe entre elas.
// Devolve null quando o endereço não está liberado para chaves de acesso.
export function relyingParty(req) {
  const raw = String(req.headers.host || '').toLowerCase();
  if (!process.env.VERCEL && /^localhost(:\d{1,5})?$/.test(raw)) {
    const protocol = req.headers['x-forwarded-proto'] === 'https' ? 'https:' : 'http:';
    return { rpID: 'localhost', origins: [`${protocol}//${raw}`] };
  }
  const hosts = passkeyHosts();
  if (!/^[a-z0-9.-]+$/.test(raw) || !hosts.has(raw)) return null;
  const rpID = raw.replace(/^www\./, '');
  const origins = [...hosts].filter(host => host === rpID || host === `www.${rpID}`).map(host => `https://${host}`);
  return { rpID, origins };
}
// Limite em memória (por instância), antes de qualquer acesso ao Blob.
function memoryLimiter(perKey, total, windowMs = 10 * 60 * 1000) {
  const hits = new Map();
  let global = { count: 0, reset: 0 };
  return key => {
    const now = Date.now();
    if (global.reset <= now) global = { count: 0, reset: now + windowMs };
    for (const [name, value] of hits) if (value.reset <= now) hits.delete(name);
    const current = hits.get(key)?.reset > now ? hits.get(key) : { count: 0, reset: now + windowMs };
    if (current.count >= perKey) return Math.ceil((current.reset - now) / 1000);
    if (global.count >= total || hits.size >= 10000) return Math.ceil((global.reset - now) / 1000);
    hits.set(key, { ...current, count: current.count + 1 });
    global.count++;
    return 0;
  };
}
export const passkeyLimits = { options: memoryLimiter(30, 600), verify: memoryLimiter(10, 120) };
function userId(config) { return new Uint8Array(createHmac('sha256', config.secret).update('promisa-passkey-user').digest()); }
function isSecure(req) { return Boolean(process.env.VERCEL || req.headers['x-forwarded-proto'] === 'https'); }
function clearChallenge(req, res) { setCookie(res, challengeCookie('', { secure: isSecure(req), clear: true })); }
function takeChallenge(req, res, type, config) {
  const found = readChallenge(req.headers.cookie, type, config.secret);
  clearChallenge(req, res);
  return found && passkeyDeps.used.consume(found.challenge, found.exp) ? found : null;
}
function limited(res, retryAfter) {
  res.setHeader('Retry-After', String(retryAfter));
  return json(res, 429, { error: tooMany });
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
    const rp = relyingParty(req);
    if (!rp) return json(res, 403, { error: 'Face ID / chave de acesso só funciona no endereço oficial do site. Use a senha.' });
    const { rpID, origins } = rp;
    if (action === 'passkey-register-options') {
      // Uma sessão roubada não basta para cadastrar um aparelho novo: pede a senha de novo.
      if (typeof body?.password !== 'string' || !body.password || body.password.length > 256) return json(res, 400, { error: 'Digite a senha do painel para ativar.' });
      const retryAfter = await reserveAttempt(ip);
      if (retryAfter) return limited(res, retryAfter);
      if (!passwordMatches(body.password, config)) {
        await new Promise(resolve => setTimeout(resolve, 600));
        return json(res, 403, { error: 'Senha incorreta. Tente novamente.' });
      }
      await clearAttempts(ip);
      const existing = await store.list();
      if (existing.length >= MAX_PASSKEYS) return json(res, 409, { error: `Limite de ${MAX_PASSKEYS} chaves atingido. Remova uma antes de adicionar outra.` });
      const options = await passkeyDeps.generateRegistrationOptions({
        rpName: 'Promisa Criação Digital', rpID, userID: userId(config), userName: 'admin', userDisplayName: 'Promisa · Administrador',
        attestationType: 'none', excludeCredentials: existing.map(item => ({ id: item.id, transports: item.transports })),
        authenticatorSelection: { residentKey: 'required', userVerification: 'required' }
      });
      const session = sessionPayload(req).nonce;
      setCookie(res, challengeCookie(signChallenge({ challenge: options.challenge, type: 'reg', session }, config.secret), { secure: isSecure(req) }));
      return json(res, 200, options);
    }
    if (action === 'passkey-register-verify') {
      const name = typeof body?.name === 'string' ? body.name.trim() : 'Dispositivo';
      if (name.length > 40) return json(res, 400, { error: 'Use um nome com até 40 letras.' });
      const found = takeChallenge(req, res, 'reg', config);
      // O desafio precisa ter sido pedido (com a senha) por esta mesma sessão.
      if (!found || found.session !== sessionPayload(req).nonce || !body?.response || typeof body.response !== 'object') return json(res, 400, { error: 'O pedido expirou. Tente ativar de novo.' });
      let info;
      try {
        const result = await passkeyDeps.verifyRegistrationResponse({ response: body.response, expectedChallenge: found.challenge, expectedOrigin: origins, expectedRPID: rpID, requireUserVerification: true });
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
      // Sem acesso ao Blob: limite em memória e desafio num cookie assinado.
      const retryAfter = passkeyLimits.options(ip);
      if (retryAfter) return limited(res, retryAfter);
      const options = await passkeyDeps.generateAuthenticationOptions({ rpID, userVerification: 'required', allowCredentials: [] });
      setCookie(res, challengeCookie(signChallenge({ challenge: options.challenge, type: 'auth' }, config.secret), { secure: isSecure(req) }));
      return json(res, 200, options);
    }
    // passkey-auth-verify: checagens sem Blob primeiro (limite em memória e desafio assinado).
    const quick = passkeyLimits.verify(ip);
    if (quick) return limited(res, quick);
    const found = takeChallenge(req, res, 'auth', config);
    const id = body?.response?.id;
    if (!found || typeof id !== 'string' || !id || id.length > 1024) return await failPasskey(res);
    const handle = body.response.response?.userHandle;
    if (handle != null && handle !== Buffer.from(userId(config)).toString('base64url')) return await failPasskey(res);
    const retryAfter = await reserveAttempt('pk:' + ip);
    if (retryAfter) return limited(res, retryAfter);
    const credential = await store.find(id);
    if (!credential) return await failPasskey(res);
    let result;
    try {
      result = await passkeyDeps.verifyAuthenticationResponse({
        response: body.response, expectedChallenge: found.challenge, expectedOrigin: origins, expectedRPID: rpID, requireUserVerification: true,
        credential: { id: credential.id, publicKey: new Uint8Array(Buffer.from(credential.publicKey, 'base64url')), counter: credential.counter, transports: credential.transports }
      });
    } catch { return await failPasskey(res); }
    if (!result?.verified) return await failPasskey(res);
    // Grava o uso de forma atômica; recusa a mesma resposta reenviada a outra instância.
    const used = { hash: createHash('sha256').update(found.challenge).digest('base64url').slice(0, 22), until: found.exp * 1000 };
    try {
      const touched = await store.touch(credential.id, { counter: result.authenticationInfo.newCounter, lastUsedAt: new Date().toISOString(), used });
      if (!touched?.ok) return await failPasskey(res);
    } catch (error) {
      if (error instanceof PasskeyError && error.status === 401) return await failPasskey(res);
      throw error;
    }
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
    if (action !== 'login' && !passkeyActions.includes(action) && !partnerAdminActions.includes(action)) return json(res, 404, { error: 'Operação não encontrada.' });
    if (!String(req.headers['content-type'] || '').startsWith('application/json')) return json(res, 415, { error: 'Formato inválido.' });
    // Na Vercel, x-real-ip/x-vercel-forwarded-for são definidos pela plataforma (não pelo visitante).
    const ip = String(req.headers['x-real-ip'] || req.headers['x-vercel-forwarded-for'] || req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown').split(',')[0].trim();
    let body;
    try { body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body; } catch {}
    if (partnerAdminActions.includes(action)) {
      // Só o dono cria, muda ou apaga sócios.
      if (!await authorized(req, config)) return json(res, 401, { error: 'Só o dono do painel pode mexer nos sócios.' });
      try {
        if (action === 'partner-list') return json(res, 200, { partners: await partners.list() });
        if (action === 'partner-create') return json(res, 200, { partner: await partners.create(body || {}) });
        if (action === 'partner-update') return json(res, 200, { partner: await partners.update(String(body?.id || ''), { name: body?.name, modules: body?.modules, active: body?.active, password: body?.password }) });
        if (action === 'partner-delete') return json(res, 200, await partners.remove(String(body?.id || '')));
      } catch (error) { if (error.status) return json(res, error.status, { error: error.message }); throw error; }
    }
    if (action !== 'login') return await passkeyRequest(req, res, config, action, body, ip);
    if (body?.user !== undefined) {
      // Entrada do sócio: usuário + senha, com o mesmo limite de tentativas do dono.
      if (typeof body.user !== 'string' || body.user.length > 60 || typeof body?.password !== 'string' || body.password.length > 256) return json(res, 400, { error: 'Informe usuário e senha.' });
      const retry = await reserveAttempt(ip);
      if (retry) { res.setHeader('Retry-After', String(retry)); return json(res, 429, { error: 'Muitas tentativas. Aguarde antes de tentar novamente.' }); }
      const nonce = randomBytes(16).toString('hex');
      const partner = await partners.login(body.user, body.password, nonce);
      await new Promise(resolve => setTimeout(resolve, 600));
      if (!partner) return json(res, 401, { error: 'Usuário ou senha incorretos (ou acesso pausado pelo dono).' });
      await clearAttempts(ip);
      await issueSession(req, res, config, partner, nonce);
      return json(res, 200, { ok: true });
    }
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
  const user = await who(req, config), authenticated = Boolean(user);
  if (action === 'session') return json(res, authenticated ? 200 : 401, { authenticated, role: user?.owner ? 'owner' : user ? 'partner' : null, ...(user?.partner ? { name: user.name, modules: user.modules } : {}) });
  if (!['admin', 'catalogo', 'panel'].includes(view)) return json(res, 404, { error: 'Página não encontrada.' });
  if (view === 'catalogo' && user?.partner && !user.modules.includes('mySites')) { res.statusCode = 303; res.setHeader('Location', '/admin'); return res.end(); }
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
