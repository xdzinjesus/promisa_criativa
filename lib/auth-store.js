import { createHmac } from 'node:crypto';
import * as blob from '@vercel/blob';
import { isBlobError, readWithEtag } from './blob-utils.js';

export function createAuthStore({ get = blob.get, head = blob.head, put = blob.put, del = blob.del, token: readToken = () => process.env.BLOB_READ_WRITE_TOKEN, secret = () => process.env.ADMIN_SESSION_SECRET, production = () => Boolean(process.env.VERCEL) } = {}) {

const memory = new Map();
const prefix = 'promisa/auth/v1/';
const token = readToken;
function authStorageReady() { return !production() || Boolean(token()); }
function pathFor(key) { return prefix + (key.startsWith('session:') ? 'sessions/' : 'attempts/') + createHmac('sha256', secret()).update(key).digest('hex') + '.json'; }
async function read(key, { withEtag = false } = {}) {
  if (!token()) {
    const entry = memory.get(key);
    if (entry && entry.value.expires <= Date.now()) { memory.delete(key); return null; }
    return entry || null;
  }
  try {
    let result, etag = null;
    if (withEtag) {
      const read = await readWithEtag(pathFor(key), { token: token() }, { get, head });
      if (!read) return null;
      ({ result, etag } = read);
    } else {
      result = await get(pathFor(key), { token: token(), access: 'private', useCache: false });
      if (!result) return null;
    }
    if (result.blob.size > 8192) throw new Error('Estado de autenticação inválido.');
    return { value: await new Response(result.stream).json(), etag };
  } catch (error) { if (isBlobError(error, 'BlobNotFoundError')) return null; throw error; }
}
async function write(key, value, previous) {
  if (!token()) { memory.set(key, { value }); return; }
  await put(pathFor(key), JSON.stringify(value), {
    token: token(), access: 'private', contentType: 'application/json', addRandomSuffix: false,
    allowOverwrite: Boolean(previous), ...(previous ? { ifMatch: previous.etag } : {}), cacheControlMaxAge: 60
  });
}
async function createSession(nonce, expires) {
  await write('session:' + nonce, { expires: expires * 1000 }, null);
}
// Economia da cota do Blob: sessões válidas ficam lembradas por 60 s nesta instância
// (cada chamada do painel conferia o Blob). Sair apaga o lembrete na hora nesta instância.
const activeCache = new Map();
const ACTIVE_TTL = 60_000;
async function sessionActive(nonce) {
  if (!authStorageReady()) return false;
  const hit = activeCache.get(nonce), now = Date.now();
  if (hit && hit.until > now && hit.expires > now) return true;
  const entry = await read('session:' + nonce);
  const ok = Boolean(entry && entry.value.expires > now);
  if (ok) {
    if (activeCache.size > 500) activeCache.clear();
    activeCache.set(nonce, { until: now + ACTIVE_TTL, expires: entry.value.expires });
  } else activeCache.delete(nonce);
  return ok;
}
async function revokeSession(nonce) {
  activeCache.delete(nonce);
  if (!token()) { memory.delete('session:' + nonce); return; }
  await del(pathFor('session:' + nonce), { token: token() });
}
async function reserveAttempt(ip) {
  const key = 'attempt:' + ip;
  if (!token()) {
    const now = Date.now();
    for (const [name, item] of memory) if (item.value.expires <= now) memory.delete(name);
    if (memory.size > 10000) return 60;
    const current = memory.get(key)?.value || { count: 0, expires: now + 15 * 60 * 1000 };
    if (current.count >= 5) return Math.max(1, Math.ceil((current.expires - now) / 1000));
    memory.set(key, { value: { ...current, count: current.count + 1 } }); return 0;
  }
  // Compare-and-swap keeps the limit consistent across Vercel instances.
  for (let retry = 0; retry < 5; retry++) {
    const entry = await read(key, { withEtag: true }), now = Date.now();
    const current = entry && entry.value.expires > now ? entry.value : { count: 0, expires: now + 15 * 60 * 1000 };
    if (current.count >= 5) return Math.max(1, Math.ceil((current.expires - now) / 1000));
    try { await write(key, { ...current, count: current.count + 1 }, entry); return 0; }
    catch (error) { if (!isBlobError(error, 'BlobPreconditionFailedError') && !isBlobError(error, 'BlobPathnameAlreadyExistsError') && !/already exists/i.test(error?.message || '')) throw error; }
  }
  return 60; // Fail closed during contention.
}
async function clearAttempts(ip) {
  if (!token()) memory.delete('attempt:' + ip);
  else await del(pathFor('attempt:' + ip), { token: token() });
}

return { authStorageReady, createSession, sessionActive, revokeSession, reserveAttempt, clearAttempts };
}
export const { authStorageReady, createSession, sessionActive, revokeSession, reserveAttempt, clearAttempts } = createAuthStore();
