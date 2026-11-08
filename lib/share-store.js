import { randomBytes } from 'node:crypto';
import * as blob from '@vercel/blob';
import { isBlobError, readWithEtag } from './blob-utils.js';

// Links de demonstração de sites de clientes.
// O índice fica no Blob privado; só a API autenticada o altera. O link público
// carrega apenas um código aleatório de 128 bits que aponta para UM site.
export const SHARES = 'promisa/v1/shares.json';
export const TOKEN = /^[A-Za-z0-9_-]{22}$/;
export const MIN_DURATION_MS = 5 * 60 * 1000;
export const MAX_DURATION_MS = 366 * 24 * 60 * 60 * 1000;
const KEEP_EXPIRED_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_SHARES = 1000;

export class ShareError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
export const siteKeyFor = siteId => 'sites:' + encodeURIComponent(String(siteId));
export const newToken = () => randomBytes(16).toString('base64url');

export function shareState(share, now = Date.now()) {
  if (!share) return 'missing';
  if (share.revokedAt) return 'revoked';
  return share.expiresAt <= now ? 'expired' : 'active';
}

// Remove registros antigos para o índice não crescer sem limite.
export function pruneShares(shares, now = Date.now()) {
  return shares
    .filter(item => !(item.revokedAt && Date.parse(item.revokedAt) < now - KEEP_EXPIRED_MS) && !(item.expiresAt < now - KEEP_EXPIRED_MS))
    .slice(-MAX_SHARES);
}

export function createShareStore({ get = blob.get, head = blob.head, put = blob.put, token = () => process.env.BLOB_READ_WRITE_TOKEN, now = () => Date.now(), cacheMs = 20_000 } = {}) {
  const options = () => ({ token: token() });
  let cache = null;

  async function load() {
    const read = await readWithEtag(SHARES, options(), { get, head });
    if (!read) return { index: { version: 1, shares: [] }, etag: null };
    if (read.result.blob?.size > 2 * 1024 * 1024) throw new Error('Índice de links inválido.');
    const index = await new Response(read.result.stream).json();
    if (index?.version !== 1 || !Array.isArray(index.shares)) throw new Error('Índice de links inválido.');
    return { index, etag: read.etag };
  }

  async function update(change) {
    for (let attempt = 0; attempt < 4; attempt++) {
      const { index, etag } = await load();
      const { shares, result } = change(index.shares.map(item => ({ ...item })));
      const next = { version: 1, shares: pruneShares(shares, now()) };
      try {
        await put(SHARES, JSON.stringify(next), {
          ...options(), access: 'private', contentType: 'application/json', addRandomSuffix: false,
          ...(etag ? { allowOverwrite: true, ifMatch: etag } : { allowOverwrite: false }), cacheControlMaxAge: 60
        });
        cache = null;
        return result;
      } catch (error) {
        const conflict = isBlobError(error, 'BlobPreconditionFailedError') || /already exists|precondition/i.test(error?.message || '');
        if (!conflict) throw error;
      }
    }
    throw new ShareError(409, 'Outra alteração de links estava em andamento. Tente novamente.');
  }

  return {
    async list(siteId) {
      const key = siteKeyFor(siteId), at = now();
      const { index } = await load();
      return index.shares.filter(item => item.siteKey === key && !item.revokedAt)
        .map(item => ({ token: item.token, createdAt: item.createdAt, expiresAt: item.expiresAt, state: shareState(item, at) }));
    },
    async create(siteId, expiresAt) {
      const at = now();
      if (!Number.isSafeInteger(expiresAt) || expiresAt < at + MIN_DURATION_MS || expiresAt > at + MAX_DURATION_MS) {
        throw new ShareError(400, 'Escolha uma validade entre 5 minutos e 1 ano.');
      }
      const share = { token: newToken(), siteKey: siteKeyFor(siteId), createdAt: at, expiresAt };
      return update(shares => ({ shares: [...shares, share], result: share }));
    },
    async createMany(items) {
      if (!Array.isArray(items) || items.length < 1 || items.length > 50) throw new ShareError(400, 'Informe de 1 a 50 links.');
      const at = now();
      for (const item of items) {
        const expiresAt = item?.expiresAt;
        if (!Number.isSafeInteger(expiresAt) || expiresAt < at + MIN_DURATION_MS || expiresAt > at + MAX_DURATION_MS) {
          throw new ShareError(400, 'Escolha uma validade entre 5 minutos e 1 ano.');
        }
      }
      const created = items.map(item => ({ token: newToken(), siteKey: siteKeyFor(item.siteId), createdAt: at, expiresAt: item.expiresAt }));
      return update(shares => ({ shares: [...shares, ...created], result: created }));
    },
    async revoke(tokenValue) {
      if (!TOKEN.test(String(tokenValue))) throw new ShareError(400, 'Link inválido.');
      return update(shares => {
        const item = shares.find(entry => entry.token === tokenValue);
        if (!item) throw new ShareError(404, 'Link não encontrado.');
        item.revokedAt = new Date(now()).toISOString();
        return { shares, result: { ok: true } };
      });
    },
    // Leitura pública: uma operação, sem ETag.
    async all() {
      const result = await get(SHARES, { ...options(), access: 'private', useCache: false });
      if (!result?.stream) return [];
      const index = await new Response(result.stream).json();
      return index?.version === 1 && Array.isArray(index.shares) ? index.shares : [];
    },
    // Busca com cache curto (desativar leva até cacheMs para valer).
    async find(tokenValue) {
      if (!TOKEN.test(String(tokenValue))) return null;
      if (!cache || cache.expires < now()) cache = { shares: await this.all(), expires: now() + cacheMs };
      return cache.shares.find(item => item.token === tokenValue) || null;
    }
  };
}
