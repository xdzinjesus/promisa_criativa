import { handleUpload } from '@vercel/blob/client';
import { settings, authorized, sameOrigin } from './access.js';
import { isBlobError } from '../lib/blob-utils.js';
import { createShareStore, siteKeyFor } from '../lib/share-store.js';
import { validId } from '../src/data-validation.js';
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
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('Vercel-CDN-Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  const config = settings();
  try {
  if (!config || !await authorized(req, config)) return json(res, 401, { error: 'Sua sessão terminou. Entre novamente.' });
  if (!['GET', 'POST'].includes(req.method)) return json(res, 405, { error: 'Método não permitido.' });
  if (req.method === 'POST' && !sameOrigin(req)) return json(res, 403, { error: 'Origem não permitida.' });
  if (!configured()) return json(res, 503, { error: 'Conecte um Vercel Blob privado ao projeto e configure BLOB_READ_WRITE_TOKEN para ativar o armazenamento online.', code: 'STORAGE_NOT_CONFIGURED' });
  const url = new URL(req.url, 'http://localhost');
  const action = req.query?.action || url.searchParams.get('action');
    if (req.method === 'GET' && action === 'manifest') return json(res, 200, (await loadManifest()).manifest);
    if (req.method === 'POST') {
      if (!String(req.headers['content-type'] || '').startsWith('application/json')) return json(res, 415, { error: 'Formato inválido.' });
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
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
      if (action === 'commit') return json(res, 200, await commitOperations(body?.operations));
      // Links de demonstração: criar, listar e desativar (somente com a sessão administrativa).
      if (action === 'share-list' || action === 'share-create') {
        if (!validId(body?.siteId)) return json(res, 400, { error: 'Site inválido.' });
        if (action === 'share-list') return json(res, 200, { shares: await shares.list(body.siteId) });
        const { manifest } = await loadManifest();
        if (!manifest.records[siteKeyFor(body.siteId)]?.hash) return json(res, 409, { error: 'Este site ainda não está salvo online. Aguarde o indicador "Salvo online" e tente de novo.' });
        const share = await shares.create(body.siteId, body.expiresAt);
        return json(res, 200, { token: share.token, createdAt: share.createdAt, expiresAt: share.expiresAt, state: 'active' });
      }
      if (action === 'share-revoke') return json(res, 200, await shares.revoke(body?.token));
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
    return json(res, 502, { error: storageErrorMessage(error), cause: String(error?.constructor?.name || error?.name || 'Error').slice(0, 60) });
  }
}
