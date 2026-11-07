import { get } from '@vercel/blob';
import { readManifest } from '../lib/cloud-store.js';
import { createShareStore } from '../lib/share-store.js';
import { createDemoHandler } from '../lib/demo-site.js';

const shares = createShareStore();
const MAX_CACHE_CHARS = 120 * 1024 * 1024;
const sites = new Map(); // hash do registro -> { site, size }
let cachedChars = 0;

function remember(hash, site, size) {
  if (size > MAX_CACHE_CHARS) return;
  while (cachedChars + size > MAX_CACHE_CHARS && sites.size) {
    const [oldest, entry] = sites.entries().next().value;
    sites.delete(oldest); cachedChars -= entry.size;
  }
  sites.set(hash, { site, size }); cachedChars += size;
}

// Cada página da demonstração pede vários arquivos; o índice é reaproveitado por 20 s
// para não gastar uma operação do Blob por imagem (cota do plano Hobby).
let manifestCache = null;
async function currentManifest() {
  if (manifestCache && manifestCache.expires > Date.now()) return manifestCache.value;
  const value = await readManifest();
  manifestCache = { value, expires: Date.now() + 20_000 };
  return value;
}

async function readSite(siteKey) {
  if (!process.env.BLOB_READ_WRITE_TOKEN) return null;
  const current = await currentManifest();
  const record = current?.manifest.records[siteKey];
  if (!record?.hash || !record.path) return null;
  const hit = sites.get(record.hash);
  if (hit) return hit.site;
  const result = await get(record.path, { token: process.env.BLOB_READ_WRITE_TOKEN, access: 'private', useCache: false });
  if (!result?.stream) return null;
  const text = await new Response(result.stream).text();
  const data = JSON.parse(text);
  const site = data?.version === 1 ? data.value : null;
  if (!site || !Array.isArray(site.files)) return null;
  remember(record.hash, site, text.length);
  return site;
}

export default createDemoHandler({
  findShare: token => process.env.BLOB_READ_WRITE_TOKEN ? shares.find(token) : null,
  readSite
});
