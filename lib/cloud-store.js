import { validateEntry } from '../src/data-validation.js';
import { isEncryptedKey, isSealedRecord } from '../src/vault.js';
import { randomUUID, createHash } from 'node:crypto';
import { get, put, issueSignedToken, presignUrl } from '@vercel/blob';
import { isBlobError, readWithEtag } from './blob-utils.js';

export const PREFIX = 'promisa/v1/';
export const MANIFEST = PREFIX + 'manifest.json';
export const MAX_OBJECT_BYTES = 200 * 1024 * 1024;
export const MAX_RECORDS = 5000;
export const validKey = key => typeof key === 'string' && /^(sales|exp|projects|bank|products|settings|sites|sitefiles|attachments):[A-Za-z0-9%_.~-]{1,180}$/.test(key);
export const validPath = path => typeof path === 'string' && /^promisa\/v1\/objects\/[a-f0-9-]{36}\.json$/.test(path);
export const validHash = hash => hash === null || typeof hash === 'string' && /^[a-f0-9]{64}$/.test(hash);

export class CloudError extends Error {
  constructor(status, message, details = {}) { super(message); this.status = status; this.details = details; }
}
function options() { return { token: process.env.BLOB_READ_WRITE_TOKEN }; }
export const configured = () => Boolean(process.env.BLOB_READ_WRITE_TOKEN);
// Leituras simples (verificação periódica, links de demonstração) gastam 1 operação do Blob.
// A ETag para gravação condicional exige head() antes e depois (3 operações): só ao salvar.
export async function readManifest({ withEtag = false } = {}) {
  try {
    let result, etag = null;
    if (withEtag) {
      const read = await readWithEtag(MANIFEST, options());
      if (!read) return null;
      ({ result, etag } = read);
    } else {
      result = await get(MANIFEST, { ...options(), access: 'private', useCache: false });
      if (!result) return null;
    }
    if (!result.stream || result.blob.size > 3 * 1024 * 1024) throw new Error('Índice de armazenamento inválido.');
    const manifest = await new Response(result.stream).json();
    if (manifest.version !== 1 || typeof manifest.workspace !== 'string' || !manifest.records || Array.isArray(manifest.records)) throw new Error('Índice de armazenamento incompatível.');
    return { manifest, etag };
  } catch (error) {
    if (isBlobError(error, 'BlobNotFoundError')) return null;
    throw error;
  }
}
export async function loadManifest({ withEtag = false } = {}) {
  const existing = await readManifest({ withEtag });
  if (existing) return existing;
  const initial = { version: 1, workspace: randomUUID(), records: {} };
  try {
    const result = await put(MANIFEST, JSON.stringify(initial), { ...options(), access: 'private', addRandomSuffix: false, allowOverwrite: false, contentType: 'application/json', cacheControlMaxAge: 60 });
    return { manifest: initial, etag: result.etag };
  } catch (error) {
    // Dois aparelhos podem abrir o armazenamento vazio ao mesmo tempo.
    const created = await readManifest({ withEtag });
    if (created) return created;
    throw error;
  }
}
export function validateOperations(operations) {
  if (!Array.isArray(operations) || operations.length > 20) throw new CloudError(400, 'Lista de alterações inválida.');
  const keys = new Set();
  for (const op of operations) {
    if (!op || !validKey(op.key) || !validHash(op.baseHash) || !validHash(op.hash) || (op.hash !== null && !validPath(op.path)) || keys.has(op.key)) throw new CloudError(400, 'Alteração inválida.');
    keys.add(op.key);
  }
}
export function mergeOperations(manifest, operations) {
  const records = { ...manifest.records }, retired = { ...manifest.retired };
  const conflicts = operations.filter(op => {
    const current = records[op.key]?.hash ?? null;
    return current !== op.baseHash && current !== op.hash;
  }).map(op => op.key);
  if (conflicts.length) throw new CloudError(409, 'Há alterações feitas em outro aparelho. Sincronize antes de continuar.', { conflicts });
  for (const op of operations) {
    if ((records[op.key]?.hash ?? null) === op.hash) continue;
    const previous = records[op.key];
    if (previous?.hash && previous.path && previous.path !== op.path) retired[previous.path] = new Date().toISOString();
    if (op.hash !== null) delete retired[op.path];
    records[op.key] = { hash: op.hash, path: op.hash === null ? null : op.path, updatedAt: new Date().toISOString() };
  }
  if (Object.values(records).filter(record => record.hash !== null).length > MAX_RECORDS) throw new CloudError(413, 'O catálogo atingiu o limite de 5.000 registros.');
  return { ...manifest, records, ...(Object.keys(retired).length ? { retired } : {}) };
}
export async function commitOperations(operations) {
  validateOperations(operations);
  for (let attempt = 0; attempt < 4; attempt++) {
    const { manifest, etag } = await loadManifest({ withEtag: true });
    if ((manifest.maintenanceUntil || 0) > Date.now()) throw new CloudError(503, 'Manutenção do armazenamento em andamento. Tente novamente em alguns minutos.');
    const filesHashes = new Map();
    for (const op of operations) if (op.hash !== null) { const info = await verifyObject(op); if (info?.filesHash) filesHashes.set(op.key, info.filesHash); }
    const next = mergeOperations(manifest, operations);
    checkSitePairs(next.records, filesHashes);
    if (Buffer.byteLength(JSON.stringify(next)) > 3 * 1024 * 1024) throw new CloudError(413, 'O histórico atingiu o limite seguro do índice. Contate o suporte antes de continuar.');
    try {
      await put(MANIFEST, JSON.stringify(next), { ...options(), access: 'private', addRandomSuffix: false, allowOverwrite: true, ifMatch: etag, contentType: 'application/json', cacheControlMaxAge: 60 });
      return next;
    } catch (error) {
      if (!isBlobError(error, 'BlobPreconditionFailedError')) throw error;
    }
  }
  throw new CloudError(409, 'Outro aparelho está salvando. Tente sincronizar novamente.');
}
export async function signedRead(path) {
  if (!validPath(path)) throw new CloudError(400, 'Arquivo inválido.');
  const signed = await issueSignedToken({ ...options(), pathname: path, operations: ['get'], validUntil: Date.now() + 15 * 60 * 1000 });
  return presignUrl(signed, { operation: 'get', pathname: path, access: 'private' });
}

export async function verifyObject(op, read = get) {
 const result = await read(op.path, { ...options(), access: 'private', useCache: false });
 if (!result?.stream || result.blob.size > MAX_OBJECT_BYTES || result.blob.contentType !== 'application/json' || !new URL(result.blob.url).hostname.endsWith('.private.blob.vercel-storage.com')) throw new CloudError(400, 'Arquivo online inválido.');
 const reader = result.stream.getReader(), chunks = []; let bytes = 0;
 const hash = createHash('sha256');
 try { while (true) { const { done, value } = await reader.read(); if (done) break; bytes += value.byteLength; if (bytes > MAX_OBJECT_BYTES) throw new CloudError(413, 'Arquivo muito grande.'); hash.update(value); chunks.push(Buffer.from(value)); } }
 finally { await reader.cancel().catch(() => {}); }
 if (hash.digest('hex') !== op.hash) throw new CloudError(400, 'O conteúdo do arquivo não corresponde ao hash informado.');
 let data;
 try { data = JSON.parse(Buffer.concat(chunks).toString('utf8')); validateStoredRecord(op.key, data); }
 catch { throw new CloudError(400, 'Formato ou identificação do registro inválido.'); }
 return { filesHash: op.key.startsWith('sites:') && typeof data?.value?.filesHash === 'string' ? data.value.filesHash : null };
}
// Um registro sites:<id> só com dados precisa apontar para o sitefiles:<id> salvo no mesmo índice;
// caso contrário /demo, /projeto e outros aparelhos ficariam sem os arquivos certos.
export function checkSitePairs(records, filesHashes) {
  for (const [key, filesHash] of filesHashes) {
    if (records['sitefiles:' + key.slice(6)]?.hash !== filesHash) throw new CloudError(409, 'Os arquivos deste site não acompanham os dados enviados. Sincronize novamente.');
  }
}
// Versão 1: texto legível, validado. Versão 2: registro criptografado (conteúdo opaco),
// permitido somente para os tipos protegidos (nunca para sites, lidos pela rota /demo).
export function validateStoredRecord(key, data) {
  if (data?.version === 1) {
    if (!Object.hasOwn(data, 'value')) throw new Error('Formato inválido.');
    validateEntry(key, data.value, { encoded: true });
    return 1;
  }
  if (data?.version === 2 && isEncryptedKey(key) && isSealedRecord(data)) return 2;
  throw new Error('Formato inválido.');
}
