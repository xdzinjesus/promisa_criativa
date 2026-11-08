import * as blob from '@vercel/blob';
import { isBlobError, readWithEtag } from './blob-utils.js';

// Chave do cofre (a chave mestra já embrulhada pela senha). Só a API autenticada grava.
export const KEYRING = 'promisa/v1/keyring.json';

export class VaultStoreError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const B64 = /^[A-Za-z0-9+/]+={0,2}$/;
function bytesOf(value, length) {
  if (typeof value !== 'string' || !B64.test(value) || value.length % 4) return false;
  const bytes = Buffer.from(value, 'base64');
  return bytes.toString('base64') === value && bytes.length === length;
}
const plain = value => value && typeof value === 'object' && !Array.isArray(value);
const sameKeys = (value, keys) => Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const invalid = () => new VaultStoreError(400, 'Chave de proteção inválida.');

// Valida o formato e devolve uma cópia na ordem canônica de campos.
export function validateKeyring(k) {
  if (!plain(k) || !sameKeys(k, ['version', 'id', 'kdf', 'wrapped', 'createdAt'])) throw invalid();
  const { kdf, wrapped } = k;
  if (k.version !== 1 || typeof k.id !== 'string' || !/^[A-Za-z0-9-]{1,64}$/.test(k.id) || typeof k.createdAt !== 'string' || !k.createdAt || k.createdAt.length > 40) throw invalid();
  if (!plain(kdf) || !sameKeys(kdf, ['name', 'hash', 'iterations', 'salt']) || kdf.name !== 'PBKDF2' || kdf.hash !== 'SHA-256' || !Number.isInteger(kdf.iterations) || kdf.iterations < 100_000 || kdf.iterations > 5_000_000 || !bytesOf(kdf.salt, 16)) throw invalid();
  if (!plain(wrapped) || !sameKeys(wrapped, ['iv', 'data']) || !bytesOf(wrapped.iv, 12) || !bytesOf(wrapped.data, 48)) throw invalid();
  return { version: 1, id: k.id, kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations: kdf.iterations, salt: kdf.salt }, wrapped: { iv: wrapped.iv, data: wrapped.data }, createdAt: k.createdAt };
}

export function createVaultStore({ get = blob.get, head = blob.head, put = blob.put, token = () => process.env.BLOB_READ_WRITE_TOKEN } = {}) {
  const options = () => ({ token: token() });
  const putOptions = extra => ({ ...options(), access: 'private', contentType: 'application/json', addRandomSuffix: false, cacheControlMaxAge: 60, ...extra });
  const conflict = error => isBlobError(error, 'BlobPreconditionFailedError') || isBlobError(error, 'BlobPathnameAlreadyExistsError') || /already exists|precondition/i.test(error?.message || '');
  async function parse(result) {
    if (result.blob?.size > 16 * 1024) throw new Error('Chave de proteção inválida.');
    return validateKeyring(await new Response(result.stream).json());
  }
  return {
    async get() {
      try {
        const result = await get(KEYRING, { ...options(), access: 'private', useCache: false });
        return result?.stream ? await parse(result) : null;
      } catch (error) {
        if (isBlobError(error, 'BlobNotFoundError')) return null;
        throw error;
      }
    },
    async create(keyring) {
      const value = validateKeyring(keyring);
      try { await put(KEYRING, JSON.stringify(value), putOptions({ allowOverwrite: false })); }
      catch (error) {
        if (conflict(error)) throw new VaultStoreError(409, 'A proteção dos dados online já está ativada.');
        throw error;
      }
    },
    async replace(previous, next) {
      const before = validateKeyring(previous), after = validateKeyring(next);
      if (after.id !== before.id) throw invalid();
      const read = await readWithEtag(KEYRING, options(), { get, head });
      const stale = new VaultStoreError(409, 'A chave de proteção mudou em outro aparelho. Recarregue a página e tente de novo.');
      if (!read) throw stale;
      let stored;
      try { stored = JSON.stringify(await parse(read.result)); } catch { throw stale; }
      if (stored !== JSON.stringify(before)) throw stale;
      try { await put(KEYRING, JSON.stringify(after), putOptions({ allowOverwrite: true, ifMatch: read.etag })); }
      catch (error) { if (conflict(error)) throw stale; throw error; }
    }
  };
}
