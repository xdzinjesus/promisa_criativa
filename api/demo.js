import { get } from '@vercel/blob';
import { readManifest } from '../lib/cloud-store.js';
import { createShareStore } from '../lib/share-store.js';
import { createDemoHandler, DemoTooLargeError } from '../lib/demo-site.js';

// Proteção da cota do Vercel Blob (plano Hobby): leituras compartilhadas entre
// requisições simultâneas, resultados reaproveitados por alguns segundos e pausa
// após falhas, para que acessos repetidos ao link não consumam operações.
const shares = createShareStore();
const MAX_DEMO_BYTES = 60 * 1024 * 1024;
const MAX_CACHE_CHARS = 120 * 1024 * 1024;
const sites = new Map(); // hash do registro -> { site, size }
const pending = new Map();
let cachedChars = 0;

function once(key, load) {
  if (pending.has(key)) return pending.get(key);
  const promise = load().finally(() => pending.delete(key));
  pending.set(key, promise);
  return promise;
}

function cached(ttl, errorTtl, load) {
  let entry = null;
  return () => {
    if (entry && entry.expires > Date.now()) return entry.error ? Promise.reject(entry.error) : Promise.resolve(entry.value);
    return once(load, async () => {
      try { const value = await load(); entry = { value, expires: Date.now() + ttl }; return value; }
      catch (error) { entry = { error, expires: Date.now() + errorTtl }; throw error; }
    });
  };
}

const currentManifest = cached(60_000, 30_000, () => readManifest());

function remember(hash, site, size) {
  if (size > MAX_CACHE_CHARS) return;
  while (cachedChars + size > MAX_CACHE_CHARS && sites.size) {
    const [oldest, entry] = sites.entries().next().value;
    sites.delete(oldest); cachedChars -= entry.size;
  }
  sites.set(hash, { site, size }); cachedChars += size;
}

async function loadSite(record) {
  const result = await get(record.path, { token: process.env.BLOB_READ_WRITE_TOKEN, access: 'private', useCache: false });
  if (!result?.stream) return null;
  if (result.blob?.size > MAX_DEMO_BYTES) { await result.stream.cancel().catch(() => {}); throw new DemoTooLargeError(); }
  const text = await new Response(result.stream).text();
  const data = JSON.parse(text);
  const site = data?.version === 1 ? data.value : null;
  if (!site || !Array.isArray(site.files)) return null;
  remember(record.hash, site, text.length);
  return site;
}

async function readSite(siteKey) {
  if (!process.env.BLOB_READ_WRITE_TOKEN) return null;
  const current = await currentManifest();
  const record = current?.manifest.records[siteKey];
  if (!record?.hash || !record.path) return null;
  const hit = sites.get(record.hash);
  if (hit) return hit.site;
  return once('site:' + record.hash, () => loadSite(record));
}

const findShare = cached(20_000, 30_000, () => shares.all());

export default createDemoHandler({
  findShare: async token => process.env.BLOB_READ_WRITE_TOKEN ? (await findShare()).find(item => item.token === token) || null : null,
  readSite
});
