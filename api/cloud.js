import { handleUpload } from '@vercel/blob/client';
import { settings, who, sameOrigin, passwordMatches } from './access.js';
import { accessFor } from '../src/partner-modules.js';
import { reserveAttempt, clearAttempts } from '../lib/auth-store.js';
import { createVaultStore, validateKeyring } from '../lib/vault-store.js';
import { isBlobError } from '../lib/blob-utils.js';
import { createShareStore, siteKeyFor } from '../lib/share-store.js';
import { createFeaturedStore, cleanFeaturedItems } from '../lib/featured-store.js';
import { createBriefingStore } from '../lib/briefing-store.js';
import { validId } from '../src/data-validation.js';
import { vercelUsage } from '../lib/vercel-usage.js';
import { configured, loadManifest, commitOperations, signedRead, validKey, validPath, MAX_OBJECT_BYTES } from '../lib/cloud-store.js';

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}
const STORAGE_ERRORS = {
  BlobAccessError: 'O token do Vercel Blob não tem acesso a este armazenamento. Em Vercel > Storage, reconecte o Blob privado ao projeto e faça um novo deploy.',
  BlobStoreNotFoundError: 'O armazenamento Vercel Blob configurado não existe mais. Conecte um Blob privado ao projeto e faça um novo deploy.',
  BlobStoreSuspendedError: 'O armazenamento Vercel Blob está suspenso. Verifique o plano e a cobrança na Vercel.',
  BlobServiceRateLimited: 'O Vercel Blob recebeu muitas solicitações. Aguarde um minuto e sincronize de novo.',
  BlobServiceNotAvailable: 'O Vercel Blob está temporariamente indisponível. Tente sincronizar em alguns minutos.',
  BlobRequestAbortedError: 'A conexão com o armazenamento foi interrompida. Tente sincronizar de novo.'
};
function storageErrorMessage(error) {
  const kind = Object.keys(STORAGE_ERRORS).find(name => isBlobError(error, name));
  if (kind) return STORAGE_ERRORS[kind];
  if (/^Índice de armazenamento/.test(error?.message || '')) return error.message;
  return 'Não foi possível acessar o armazenamento online. Verifique a conexão e a configuração do Vercel Blob privado.';
}
const shares = createShareStore();
const briefings = createBriefingStore();
const featured = createFeaturedStore();
const vault = createVaultStore();
const clientIp = req => String(req.headers['x-real-ip'] || req.headers['x-vercel-forwarded-for'] || req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown').split(',')[0].trim();
// Confirma a senha do painel antes de mexer na chave do cofre (com limite de tentativas).
// Responde sozinho e devolve false quando a senha não é aceita.
async function verifyPassword(req, res, body, config) {
  if (typeof body?.password !== 'string' || !body.password || body.password.length > 256) { json(res, 400, { error: 'Informe uma senha válida.' }); return false; }
  const ip = 'vault:' + clientIp(req);
  const retryAfter = await reserveAttempt(ip);
  if (retryAfter) { res.setHeader('Retry-After', String(retryAfter)); json(res, 429, { error: 'Muitas tentativas. Aguarde antes de tentar novamente.' }); return false; }
  const valid = passwordMatches(body.password, config);
  if (!valid) {
    await new Promise(resolve => setTimeout(resolve, 600));
    json(res, 401, { error: 'Senha incorreta.', code: 'WRONG_PASSWORD' });
    return false;
  }
  await clearAttempts(ip);
  return true;
}
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('Vercel-CDN-Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  const config = settings();
  try {
  const user = config ? await who(req, config) : null;
  if (!user) return json(res, 401, { error: 'Sua sessão terminou. Entre novamente.' });
  // Sócio: só os dados e ações dos módulos liberados pelo dono. Dono: tudo.
  const access = user.owner ? null : accessFor(user.modules);
  const deny = () => json(res, 403, { error: 'Seu acesso não inclui esta parte do painel. Peça ao dono para liberar.' });
  if (!['GET', 'POST'].includes(req.method)) return json(res, 405, { error: 'Método não permitido.' });
  if (req.method === 'POST' && !sameOrigin(req)) return json(res, 403, { error: 'Origem não permitida.' });
  const url = new URL(req.url, 'http://localhost');
  const action = req.query?.action || url.searchParams.get('action');
  // Uso da conta na Vercel (só leitura; não usa o armazenamento).
  if (req.method === 'GET' && action === 'vercel-usage') {
    if (access) return deny();
    try { return json(res, 200, await vercelUsage()); } catch { return json(res, 200, { configured: true, error: 'Não consegui falar com a Vercel agora. Tente de novo em alguns minutos.' }); }
  }
  // Sócio: confere a permissão antes de qualquer coisa (o dono passa direto).
  if (access && req.method === 'POST') {
    let body = null;
    try { body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body; } catch { return json(res, 400, { error: 'Dados inválidos.' }); }
    if (/^vault-/.test(action)) return deny();
    const need = { 'share-list': 'share', 'share-create': 'share', 'share-create-many': 'share', 'share-revoke': 'share', 'featured-publish': 'featured' }[action] || (/^briefing-/.test(action) ? 'briefing' : null);
    if (need && !access.api(need)) return deny();
    if (action === 'commit' && (!Array.isArray(body?.operations) || body.operations.some(op => !access.allowKey(op?.key)))) return deny();
    if (action === 'read' && !access.allowKey(body?.key)) return deny();
  }
  // A conferência da senha não usa o armazenamento (o limite de tentativas tem reserva em memória).
  if (!configured() && !(req.method === 'POST' && action === 'vault-verify')) return json(res, 503, { error: 'Conecte um Vercel Blob privado ao projeto e configure BLOB_READ_WRITE_TOKEN para ativar o armazenamento online.', code: 'STORAGE_NOT_CONFIGURED' });
    if (req.method === 'GET' && action === 'manifest') {
      const { manifest } = await loadManifest();
      if (!access) return json(res, 200, manifest);
      return json(res, 200, { ...manifest, history: undefined, records: Object.fromEntries(Object.entries(manifest.records || {}).filter(([key]) => access.allowKey(key))) });
    }
    // Histórico de quem fez o quê (só o dono): últimas 300 alterações.
    if (req.method === 'GET' && action === 'history') {
      if (access) return deny();
      const { manifest } = await loadManifest();
      return json(res, 200, { history: Array.isArray(manifest.history) ? manifest.history : [] });
    }
    if (req.method === 'GET' && action === 'vault') {
      const keyring = await vault.get();
      // Com a criptografia ligada, a chave é do dono: o sócio não sincroniza (os dados ficam só no aparelho dele).
      if (access && keyring) return json(res, 403, { error: 'A criptografia dos dados está ligada: o acesso de sócio funciona só neste aparelho, sem sincronizar.', code: 'VAULT_OWNER_ONLY' });
      return json(res, 200, { keyring });
    }
    if (req.method === 'POST') {
      if (!String(req.headers['content-type'] || '').startsWith('application/json')) return json(res, 415, { error: 'Formato inválido.' });
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
      if (action === 'vault-verify') return await verifyPassword(req, res, body, config) ? json(res, 200, { ok: true }) : undefined;
      if (action === 'vault-create' || action === 'vault-replace') {
        if (!await verifyPassword(req, res, body, config)) return;
        if (action === 'vault-create') { await vault.create(validateKeyring(body.keyring)); return json(res, 200, { ok: true }); }
        await vault.replace(validateKeyring(body.previous), validateKeyring(body.keyring));
        return json(res, 200, { ok: true });
      }
      if (action === 'upload') {
        // A chave principal nunca é enviada ao navegador; o SDK gera uma autorização restrita.
        const result = await handleUpload({
          token: process.env.BLOB_READ_WRITE_TOKEN,
          request: req,
          body,
          onBeforeGenerateToken: async pathname => {
            if (!validPath(pathname)) throw new Error('Caminho de upload inválido.');
            return { allowedContentTypes: ['application/json'], maximumSizeInBytes: MAX_OBJECT_BYTES, validUntil: Date.now() + 60 * 60 * 1000, addRandomSuffix: false, allowOverwrite: false };
          }
        });
        return json(res, 200, result);
      }
      if (action === 'commit') {
        const by = user.owner ? { id: 'owner' } : { id: user.id, name: user.name };
        const next = await commitOperations(body?.operations, by);
        // O histórico é só do dono: o sócio recebe o índice sem ele (e só com os registros liberados).
        return json(res, 200, access ? { ...next, history: undefined, records: Object.fromEntries(Object.entries(next.records || {}).filter(([key]) => access.allowKey(key))) } : next);
      }
      // Links de demonstração: criar, listar e desativar (somente com a sessão administrativa).
      if (action === 'share-list' || action === 'share-create') {
        if (!validId(body?.siteId)) return json(res, 400, { error: 'Site inválido.' });
        if (action === 'share-list') return json(res, 200, { shares: await shares.list(body.siteId) });
        const { manifest } = await loadManifest();
        if (!manifest.records[siteKeyFor(body.siteId)]?.hash) return json(res, 409, { error: 'Este site ainda não está salvo online. Aguarde o indicador "Salvo online" e tente de novo.' });
        const share = await shares.create(body.siteId, body.expiresAt);
        return json(res, 200, { token: share.token, createdAt: share.createdAt, expiresAt: share.expiresAt, state: 'active' });
      }
      if (action === 'share-create-many') {
        const items = body?.items;
        if (!Array.isArray(items) || items.length < 1 || items.length > 50) return json(res, 400, { error: 'Informe de 1 a 50 sites.' });
        if (items.some(item => !validId(item?.siteId))) return json(res, 400, { error: 'Site inválido.' });
        const { manifest } = await loadManifest();
        const ok = [], skipped = [];
        for (const item of items) {
          if (manifest.records[siteKeyFor(item.siteId)]?.hash) ok.push(item);
          else skipped.push({ siteId: item.siteId, reason: 'Site ainda não salvo online' });
        }
        const created = ok.length ? await shares.createMany(ok.map(item => ({ siteId: item.siteId, expiresAt: item.expiresAt }))) : [];
        return json(res, 200, { shares: created.map((share, i) => ({ siteId: ok[i].siteId, token: share.token, expiresAt: share.expiresAt })), skipped });
      }
      // Projetos em destaque da página inicial (de 0 a 6; o site precisa já estar salvo online).
      if (action === 'featured-publish') {
        const items = cleanFeaturedItems(body?.items, validId);
        const { manifest } = await loadManifest();
        const ok = [], skipped = [];
        for (const item of items) {
          if (manifest.records[siteKeyFor(item.siteId)]?.hash) ok.push({ ...item, siteKey: siteKeyFor(item.siteId) });
          else skipped.push({ siteId: item.siteId, reason: 'Site ainda não salvo online' });
        }
        const published = await featured.publish(ok);
        return json(res, 200, { published: published.length, skipped });
      }
      if (action === 'share-revoke') return json(res, 200, await shares.revoke(body?.token));
      // Formulário de briefing do cliente: criar link, listar, ver respostas e desativar.
      if (action === 'briefing-create') {
        if (!validId(body?.leadId)) return json(res, 400, { error: 'Cliente inválido.' });
        const expiresAt = body.expiresAt === undefined ? Date.now() + 30 * 24 * 60 * 60 * 1000 : body.expiresAt;
        const item = await briefings.create(body.leadId, expiresAt);
        return json(res, 200, { token: item.token, expiresAt: item.expiresAt });
      }
      if (action === 'briefing-list') return json(res, 200, { items: await briefings.list() });
      if (action === 'briefing-get') return json(res, 200, await briefings.getAnswers(body?.token));
      if (action === 'briefing-revoke') return json(res, 200, await briefings.revoke(body?.token));
      // LGPD: apaga respostas e links do formulário de um cliente.
      if (action === 'briefing-delete-lead') return json(res, 200, await briefings.deleteLead(body?.leadId));
      if (action === 'read') {
        if (!validKey(body?.key)) return json(res, 400, { error: 'Registro inválido.' });
        const { manifest } = await loadManifest();
        const record = manifest.records[body.key];
        if (!record?.hash) return json(res, 404, { error: 'Arquivo não encontrado.' });
        return json(res, 200, { ...await signedRead(record.path), hash: record.hash });
      }
    }
    return json(res, 404, { error: 'Operação não encontrada.' });
  } catch (error) {
    if (error instanceof SyntaxError) return json(res, 400, { error: 'Dados inválidos.' });
    if (error.status) return json(res, error.status, { error: error.message, ...error.details });
    // Registra a causa nos logs da Vercel (nunca o token) e devolve um motivo específico ao painel.
    console.error('[cloud]', req.query?.action || req.method, error?.constructor?.name || error?.name, error?.message);
    return json(res, 502, { error: storageErrorMessage(error) });
  }
}
