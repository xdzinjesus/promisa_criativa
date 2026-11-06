import { randomUUID } from 'node:crypto';
import { get, put, head, issueSignedToken, presignUrl } from '@vercel/blob';

export const PREFIX = 'promisa/v1/';
export const MANIFEST = PREFIX + 'manifest.json';
export const MAX_OBJECT_BYTES = 200 * 1024 * 1024;
export const MAX_RECORDS = 5000;
export const validKey = key => typeof key === 'string' && /^(sales|exp|projects|settings|sites|attachments):[A-Za-z0-9%_.~-]{1,180}$/.test(key);
export const validPath = path => typeof path === 'string' && /^promisa\/v1\/objects\/[a-f0-9-]{36}\.json$/.test(path);
export const validHash = hash => hash === null || typeof hash === 'string' && /^[a-f0-9]{64}$/.test(hash);

export class CloudError extends Error {
  constructor(status, message, details = {}) { super(message); this.status = status; this.details = details; }
}
function options() { return { token: process.env.BLOB_READ_WRITE_TOKEN }; }
export const configured = () => Boolean(process.env.BLOB_READ_WRITE_TOKEN);
async function readManifest() {
  try {
    const result = await get(MANIFEST, { ...options(), access: 'private', useCache: false });
    if (!result) return null;
    if (!result.stream || result.blob.size > 3 * 1024 * 1024) throw new Error('Índice de armazenamento inválido.');
    const manifest = await new Response(result.stream).json();
    if (manifest.version !== 1 || typeof manifest.workspace !== 'string' || !manifest.records || Array.isArray(manifest.records)) throw new Error('Índice de armazenamento incompatível.');
    return { manifest, etag: result.blob.etag };
  } catch (error) {
    if (error.name === 'BlobNotFoundError') return null;
    throw error;
  }
}
export async function loadManifest() {
  const existing = await readManifest();
  if (existing) return existing;
  const initial = { version: 1, workspace: randomUUID(), records: {} };
  try {
    const result = await put(MANIFEST, JSON.stringify(initial), { ...options(), access: 'private', addRandomSuffix: false, allowOverwrite: false, contentType: 'application/json', cacheControlMaxAge: 60 });
    return { manifest: initial, etag: result.etag };
  } catch (error) {
    // Dois aparelhos podem abrir o armazenamento vazio ao mesmo tempo.
    const created = await readManifest();
    if (created) return created;
    throw error;
  }
}
export function validateOperations(operations) {
  if (!Array.isArray(operations) || operations.length > MAX_RECORDS) throw new CloudError(400, 'Lista de alterações inválida.');
  const keys = new Set();
  for (const op of operations) {
    if (!op || !validKey(op.key) || !validHash(op.baseHash) || !validHash(op.hash) || (op.hash !== null && !validPath(op.path)) || keys.has(op.key)) throw new CloudError(400, 'Alteração inválida.');
    keys.add(op.key);
  }
}
export function mergeOperations(manifest, operations) {
  const records = { ...manifest.records };
  const conflicts = operations.filter(op => {
    const current = records[op.key]?.hash ?? null;
    return current !== op.baseHash && current !== op.hash;
  }).map(op => op.key);
  if (conflicts.length) throw new CloudError(409, 'Há alterações feitas em outro aparelho. Sincronize antes de continuar.', { conflicts });
  for (const op of operations) {
    if ((records[op.key]?.hash ?? null) === op.hash) continue;
    records[op.key] = { hash: op.hash, path: op.hash === null ? null : op.path, updatedAt: new Date().toISOString() };
  }
  if (Object.keys(records).length > MAX_RECORDS) throw new CloudError(413, 'O catálogo atingiu o limite de 5.000 registros.');
  return { ...manifest, records };
}
export async function commitOperations(operations) {
  validateOperations(operations);
  // Só associa arquivos realmente presentes no armazenamento privado.
  const files = operations.filter(op => op.hash !== null);
  for (let i = 0; i < files.length; i += 4) {
    await Promise.all(files.slice(i, i + 4).map(async op => {
      const object = await head(op.path, options());
      if (!object.url.includes('.private.blob.vercel-storage.com/') || object.size > MAX_OBJECT_BYTES || object.contentType !== 'application/json') throw new CloudError(400, 'Arquivo online inválido.');
    }));
  }
  for (let attempt = 0; attempt < 4; attempt++) {
    const { manifest, etag } = await loadManifest();
    const next = mergeOperations(manifest, operations);
    try {
      await put(MANIFEST, JSON.stringify(next), { ...options(), access: 'private', addRandomSuffix: false, allowOverwrite: true, ifMatch: etag, contentType: 'application/json', cacheControlMaxAge: 60 });
      return next;
    } catch (error) {
      if (error.name !== 'BlobPreconditionFailedError') throw error;
    }
  }
  throw new CloudError(409, 'Outro aparelho está salvando. Tente sincronizar novamente.');
}
export async function signedRead(path) {
  if (!validPath(path)) throw new CloudError(400, 'Arquivo inválido.');
  const signed = await issueSignedToken({ ...options(), pathname: path, operations: ['get'], validUntil: Date.now() + 15 * 60 * 1000 });
  return presignUrl(signed, { operation: 'get', pathname: path, access: 'private' });
}
