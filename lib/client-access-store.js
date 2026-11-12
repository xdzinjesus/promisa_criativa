import * as blob from '@vercel/blob';
import { createHash } from 'node:crypto';
import { isBlobError, readWithEtag } from './blob-utils.js';

// Acessos dos clientes ao "Meu site" (editor do próprio site), no Blob PRIVADO.
//  - promisa/client-access/v1/a/<sha256 do token>.json : um acesso (código embaralhado, rascunho, contadores).
//  - promisa/client-access/v1/index.json               : lista do dono { siteId: resumo } (1 leitura para a aba de controle).
// O token do link nunca é guardado: só o hash dele. O código de 6 números é guardado com scrypt + sal.
export const PREFIX = 'promisa/client-access/v1/';
export const INDEX_PATH = PREFIX + 'index.json';
const MAX_RECORD_BYTES = 6 * 1024 * 1024, MAX_INDEX_BYTES = 512 * 1024;
export const tokenHash = token => createHash('sha256').update(String(token)).digest('hex');
const recordPath = hash => `${PREFIX}a/${hash}.json`;
const conflict = error => isBlobError(error, 'BlobPreconditionFailedError') || /already exists|precondition/i.test(error?.message || '');

export function createClientAccessStore({
  get = blob.get, head = blob.head, put = blob.put,
  token = () => process.env.BLOB_READ_WRITE_TOKEN,
  memory = () => !token() && !process.env.VERCEL
} = {}) {
  const options = () => ({ token: token() });
  const mem = new Map();
  const ensure = () => { if (!memory() && !token()) throw Object.assign(new Error('Armazenamento online não configurado.'), { status: 503 }); };

  async function readJson(path, max) {
    if (memory()) return mem.has(path) ? structuredClone(mem.get(path)) : null;
    let result;
    try { result = await get(path, { ...options(), access: 'private', useCache: false }); }
    catch (error) { if (isBlobError(error, 'BlobNotFoundError')) return null; throw error; }
    if (!result?.stream) return null;
    if (result.blob?.size > max) { await result.stream.cancel?.().catch?.(() => {}); return null; }
    return new Response(result.stream).json().catch(() => null);
  }
  async function writeJson(path, value) {
    if (memory()) { mem.set(path, structuredClone(value)); return; }
    await put(path, JSON.stringify(value), { ...options(), access: 'private', contentType: 'application/json', addRandomSuffix: false, allowOverwrite: true, cacheControlMaxAge: 0 });
  }

  return {
    async getRecord(hash) { ensure(); return /^[a-f0-9]{64}$/.test(hash) ? readJson(recordPath(hash), MAX_RECORD_BYTES) : null; },
    async putRecord(hash, record) { ensure(); if (!/^[a-f0-9]{64}$/.test(hash)) throw new Error('hash inválido'); await writeJson(recordPath(hash), record); },
    // Lê, aplica `change(atual)` e grava só se ninguém gravou no meio (ifMatch). `change` devolve o novo registro
    // ou null para não gravar nada. Devolve { record, changed }. Sem conseguir depois de várias tentativas: erro "busy".
    async updateRecord(hash, change) {
      ensure();
      if (!/^[a-f0-9]{64}$/.test(hash)) throw new Error('hash inválido');
      const path = recordPath(hash);
      if (memory()) {
        const current = mem.has(path) ? structuredClone(mem.get(path)) : null;
        const next = change(current);
        if (!next) return { record: current, changed: false };
        mem.set(path, structuredClone(next));
        return { record: structuredClone(next), changed: true };
      }
      for (let attempt = 0; attempt < 6; attempt++) {
        let read;
        try { read = await readWithEtag(path, options(), { get, head }); }
        catch (error) { if (/mudou durante a leitura/.test(error?.message || '')) continue; throw error; } // muito movimento: tenta de novo
        if (read?.result?.blob?.size > MAX_RECORD_BYTES) throw new Error('Registro grande demais.');
        const current = read ? await new Response(read.result.stream).json().catch(() => null) : null;
        const next = change(current ? structuredClone(current) : null);
        if (!next) return { record: current, changed: false };
        try {
          await put(path, JSON.stringify(next), { ...options(), access: 'private', contentType: 'application/json', addRandomSuffix: false, ...(read ? { allowOverwrite: true, ifMatch: read.etag } : { allowOverwrite: false }), cacheControlMaxAge: 0 });
          return { record: next, changed: true };
        } catch (error) { if (!conflict(error)) throw error; }
      }
      throw Object.assign(new Error('Muitos pedidos ao mesmo tempo.'), { code: 'busy' });
    },
    async readIndex() { ensure(); const data = await readJson(INDEX_PATH, MAX_INDEX_BYTES); return data && typeof data.sites === 'object' && data.sites ? data : { version: 1, sites: {} }; },
    // Altera a lista com ifMatch (dois salvamentos ao mesmo tempo não se apagam).
    async updateIndex(change) {
      ensure();
      if (memory()) { const next = change(structuredClone(mem.get(INDEX_PATH) || { version: 1, sites: {} })); mem.set(INDEX_PATH, next); return structuredClone(next); }
      for (let attempt = 0; attempt < 4; attempt++) {
        const read = await readWithEtag(INDEX_PATH, options(), { get, head });
        const current = read ? await new Response(read.result.stream).json().catch(() => null) : null;
        const next = change(current && typeof current.sites === 'object' && current.sites ? current : { version: 1, sites: {} });
        try {
          await put(INDEX_PATH, JSON.stringify(next), { ...options(), access: 'private', contentType: 'application/json', addRandomSuffix: false, ...(read ? { allowOverwrite: true, ifMatch: read.etag } : { allowOverwrite: false }), cacheControlMaxAge: 0 });
          return next;
        } catch (error) { if (!conflict(error)) throw error; }
      }
      throw new Error('Outra gravação estava em andamento. Tente de novo.');
    }
  };
}
