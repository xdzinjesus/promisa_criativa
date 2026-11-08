import * as blob from '@vercel/blob';
import { isBlobError, readWithEtag } from './blob-utils.js';

// Chaves de acesso (Face ID / digital) do administrador.
// Ficam num Blob privado; só a API autenticada altera. Só guardamos a chave PÚBLICA.
export const PASSKEYS = 'promisa/auth/v1/passkeys.json';
export const MAX_PASSKEYS = 10;

export class PasskeyError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

export function createPasskeyStore({ get = blob.get, head = blob.head, put = blob.put, token = () => process.env.BLOB_READ_WRITE_TOKEN } = {}) {
  const options = () => ({ token: token() });
  let memory = { version: 1, items: [] };

  async function load() {
    if (!token()) return { index: structuredClone(memory), etag: null };
    const read = await readWithEtag(PASSKEYS, options(), { get, head });
    if (!read) return { index: { version: 1, items: [] }, etag: null };
    if (read.result.blob?.size > 256 * 1024) throw new Error('Cadastro de chaves inválido.');
    const index = await new Response(read.result.stream).json();
    if (index?.version !== 1 || !Array.isArray(index.items)) throw new Error('Cadastro de chaves inválido.');
    return { index, etag: read.etag };
  }

  // Leitura, alteração e gravação com ETag (compare-and-swap), repetindo em caso de conflito.
  async function update(change) {
    for (let attempt = 0; attempt < 5; attempt++) {
      const { index, etag } = await load();
      const { items, result } = change(index.items.map(item => ({ ...item })));
      const next = { version: 1, items };
      if (!token()) { memory = next; return result; }
      try {
        await put(PASSKEYS, JSON.stringify(next), {
          ...options(), access: 'private', contentType: 'application/json', addRandomSuffix: false,
          ...(etag ? { allowOverwrite: true, ifMatch: etag } : { allowOverwrite: false }), cacheControlMaxAge: 60
        });
        return result;
      } catch (error) {
        const conflict = isBlobError(error, 'BlobPreconditionFailedError') || isBlobError(error, 'BlobPathnameAlreadyExistsError') || /already exists|precondition/i.test(error?.message || '');
        if (!conflict) throw error;
      }
    }
    throw new PasskeyError(409, 'Outra alteração estava em andamento. Tente novamente.');
  }

  return {
    async list() { return (await load()).index.items; },
    async find(id) { return (await load()).index.items.find(item => item.id === id) || null; },
    async add(item) {
      return update(items => {
        if (items.length >= MAX_PASSKEYS) throw new PasskeyError(409, `Limite de ${MAX_PASSKEYS} chaves atingido. Remova uma antes de adicionar outra.`);
        if (items.some(entry => entry.id === item.id)) throw new PasskeyError(409, 'Esta chave já está cadastrada.');
        return { items: [...items, item], result: { ok: true } };
      });
    },
    async remove(id) {
      return update(items => {
        if (!items.some(entry => entry.id === id)) throw new PasskeyError(404, 'Chave não encontrada.');
        return { items: items.filter(entry => entry.id !== id), result: { ok: true } };
      });
    },
    async touch(id, { counter, lastUsedAt }) {
      return update(items => {
        const item = items.find(entry => entry.id === id);
        if (item) { item.counter = counter; item.lastUsedAt = lastUsedAt; }
        return { items, result: { ok: Boolean(item) } };
      });
    }
  };
}
export const passkeyStore = createPasskeyStore();
