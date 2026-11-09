import * as blob from '@vercel/blob';
import { isBlobError, readWithEtag } from './blob-utils.js';

// Sites publicados na Cloudflare Pages. Um único índice privado no Blob (promisa/publish/v1/index.json):
// { version: 1, items: { [siteId]: { project, url, domain, zoneId, nameServers, lastDeploymentId, lastPublishedAt, filesHash } } }
// Gravação com ETag (CAS) e novas tentativas, como nos diagnósticos.
export const INDEX = 'promisa/publish/v1/index.json';
export const MAX_ITEMS = 500;
const MAX_INDEX_BYTES = 1024 * 1024;

export class PublishStoreError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const conflictError = error => isBlobError(error, 'BlobPreconditionFailedError') || /already exists|precondition/i.test(error?.message || '');
const FORBIDDEN = new Set(['__proto__', 'constructor', 'prototype']);
const text = (value, max) => typeof value === 'string' ? value.slice(0, max) : '';

// Guarda só os campos conhecidos, com tamanhos limitados.
export function cleanEntry(entry) {
  return {
    project: text(entry.project, 80), url: text(entry.url, 200), domain: text(entry.domain, 253), zoneId: text(entry.zoneId, 64),
    nameServers: Array.isArray(entry.nameServers) ? entry.nameServers.slice(0, 4).map(item => text(String(item), 100)) : [],
    lastDeploymentId: text(entry.lastDeploymentId, 80), lastPublishedAt: Number.isFinite(entry.lastPublishedAt) ? entry.lastPublishedAt : 0,
    filesHash: text(entry.filesHash, 64)
  };
}

export function createPublishStore({
  get = blob.get, head = blob.head, put = blob.put,
  token = () => process.env.BLOB_READ_WRITE_TOKEN,
  memory = () => !token() && !process.env.VERCEL
} = {}) {
  const options = () => ({ token: token() });
  const mem = { items: {} };
  const checkKey = siteId => { if (typeof siteId !== 'string' || FORBIDDEN.has(siteId)) throw new PublishStoreError(400, 'Site inválido.'); };
  const ensureConfigured = () => {
    if (!memory() && !token()) throw new PublishStoreError(503, 'Conecte um Vercel Blob privado ao projeto para guardar os sites publicados.');
  };

  async function load() {
    const read = await readWithEtag(INDEX, options(), { get, head });
    if (!read) return { items: {}, etag: null };
    if (read.result.blob?.size > MAX_INDEX_BYTES) { await read.result.stream?.cancel?.().catch?.(() => {}); throw new Error('Índice de publicações inválido.'); }
    const data = await new Response(read.result.stream).json();
    if (data?.version !== 1 || !data.items || typeof data.items !== 'object' || Array.isArray(data.items)) throw new Error('Índice de publicações inválido.');
    return { items: data.items, etag: read.etag };
  }

  async function update(change) {
    for (let attempt = 0; attempt < 4; attempt++) {
      const { items, etag } = await load();
      const next = change({ ...items });
      try {
        await put(INDEX, JSON.stringify({ version: 1, items: next }), {
          ...options(), access: 'private', contentType: 'application/json', addRandomSuffix: false,
          ...(etag ? { allowOverwrite: true, ifMatch: etag } : { allowOverwrite: false }), cacheControlMaxAge: 60
        });
        return next;
      } catch (error) { if (!conflictError(error)) throw error; }
    }
    throw new PublishStoreError(409, 'Outra alteração estava em andamento. Tente novamente.');
  }

  const tooMany = () => new PublishStoreError(409, `Já existem ${MAX_ITEMS} sites publicados. Tire algum do ar antes de publicar outro.`);

  return {
    async get(siteId) {
      checkKey(siteId); ensureConfigured();
      const items = memory() ? mem.items : (await load()).items;
      return Object.hasOwn(items, siteId) ? items[siteId] : null;
    },
    async list() {
      ensureConfigured();
      return memory() ? { ...mem.items } : (await load()).items;
    },
    // `patch` é mesclado ao registro existente.
    async set(siteId, patch) {
      checkKey(siteId); ensureConfigured();
      const apply = items => {
        const merged = cleanEntry({ ...(Object.hasOwn(items, siteId) ? items[siteId] : {}), ...patch });
        if (!Object.hasOwn(items, siteId) && Object.keys(items).length >= MAX_ITEMS) throw tooMany();
        items[siteId] = merged; return items;
      };
      if (memory()) { apply(mem.items); return mem.items[siteId]; }
      return (await update(apply))[siteId];
    },
    async remove(siteId) {
      checkKey(siteId); ensureConfigured();
      const apply = items => { delete items[siteId]; return items; };
      if (memory()) { apply(mem.items); return { ok: true }; }
      await update(apply);
      return { ok: true };
    }
  };
}
