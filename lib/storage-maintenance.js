import { randomUUID } from 'node:crypto';
import { get, put, list, del } from '@vercel/blob';
import { loadManifest, MANIFEST, PREFIX } from './cloud-store.js';

export const RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
export function removableObjects(blobs, manifest, now = Date.now()) {
  const referenced = new Set(Object.values(manifest.records).filter(record => record.hash).map(record => record.path));
  return blobs.filter(blob => blob.pathname.startsWith(PREFIX + 'objects/') && !referenced.has(blob.pathname) && Math.max(new Date(blob.uploadedAt).getTime(), Date.parse(manifest.retired?.[blob.pathname] || '') || 0) < now - RETENTION_MS);
}
export async function maintainStorage({ apply = false } = {}) {
  const options = { token: process.env.BLOB_READ_WRITE_TOKEN };
  if (!options.token) throw new Error('Vercel Blob privado não configurado.');
  let current = await loadManifest();
  if ((current.manifest.maintenanceUntil || 0) > Date.now()) throw new Error('Já há uma manutenção em andamento.');
  const owner = randomUUID();
  if (apply) {
    const lock = { ...current.manifest, maintenanceOwner: owner, maintenanceUntil: Date.now() + 120_000 };
    const result = await put(MANIFEST, JSON.stringify(lock), { ...options, access: 'private', contentType: 'application/json', addRandomSuffix: false, allowOverwrite: true, ifMatch: current.etag, cacheControlMaxAge: 60 });
    current = { manifest: lock, etag: result.etag };
  }
  const deadline = Date.now() + 40_000;
  let cursor, eligible = 0, removed = 0;
  const deleted = new Set();
  try {
    do {
      if (Date.now() > deadline) break;
      const page = await list({ ...options, prefix: PREFIX + 'objects/', limit: 100, cursor });
      const candidates = removableObjects(page.blobs, current.manifest);
      eligible += candidates.length;
      if (apply && candidates.length) {
        // Check the lease before each deletion batch; commits honor the same manifest lease.
        const latest = await loadManifest();
        if (latest.manifest.maintenanceOwner !== owner || latest.manifest.maintenanceUntil < Date.now() + 30_000) throw new Error('A manutenção perdeu a autorização temporária.');
        await del(candidates.map(blob => blob.url), options); removed += candidates.length; for (const candidate of candidates) deleted.add(candidate.pathname);
      }
      cursor = page.hasMore ? page.cursor : undefined;
    } while (cursor);
    if (Date.now() < deadline) {
      const sessions = await list({ ...options, prefix: 'promisa/auth/v1/sessions/', limit: 100 });
      const expired = sessions.blobs.filter(blob => new Date(blob.uploadedAt).getTime() < Date.now() - 60 * 60 * 1000);
      if (apply && expired.length) await del(expired.map(blob => blob.url), options);
    }
    if (Date.now() < deadline) {
      const attempts = await list({ ...options, prefix: 'promisa/auth/v1/attempts/', limit: 100 });
      for (const item of attempts.blobs) {
        if (Date.now() > deadline) break;
        const result = await get(item.pathname, { ...options, access: 'private', useCache: false });
        if (!result?.stream || result.blob.size > 8192) continue;
        const value = await new Response(result.stream).json();
        if (apply && value.expires < Date.now()) {
          try { await del(item.url, { ...options, ifMatch: result.blob.etag }); }
          catch (error) { if (error.name !== 'BlobPreconditionFailedError') throw error; }
        }
      }
    }
    return { apply, eligible, removed, more: Boolean(cursor), retentionDays: 7 };
  } finally {
    if (apply) {
      const latest = await loadManifest();
      if (latest.manifest.maintenanceOwner === owner) {
        const { maintenanceUntil, maintenanceOwner, ...manifest } = latest.manifest;
        if (manifest.retired) for (const path of deleted) delete manifest.retired[path];
        await put(MANIFEST, JSON.stringify(manifest), { ...options, access: 'private', contentType: 'application/json', addRandomSuffix: false, allowOverwrite: true, ifMatch: latest.etag, cacheControlMaxAge: 60 });
      }
    }
  }
}
