import { get } from '@vercel/blob';
import { readManifest } from './cloud-store.js';
import { DemoTooLargeError } from './demo-site.js';

// Proteção da cota do Vercel Blob (plano Hobby): leituras compartilhadas entre
// requisições simultâneas, resultados reaproveitados por alguns segundos e pausa
// após falhas, para que acessos repetidos não consumam operações.
const MAX_DEMO_BYTES = 60 * 1024 * 1024;
const MAX_CACHE_CHARS = 120 * 1024 * 1024;
const sites = new Map(); // hash do registro -> { site, size }
const pending = new Map();
let cachedChars = 0;

export function once(key, load) {
  if (pending.has(key)) return pending.get(key);
  const promise = load().finally(() => pending.delete(key));
  pending.set(key, promise);
  return promise;
}

export function cached(ttl, errorTtl, load) {
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

// Novo formato: os arquivos ficam em sitefiles:<id> (o registro sites:<id> só garante que o site existe).
// Sem o registro de arquivos, usa o registro antigo completo.
export function pickSiteRecord(records, siteKey) {
  const meta = records?.[siteKey];
  if (!meta?.hash || !meta.path) return null;
  const files = typeof siteKey === 'string' && siteKey.startsWith('sites:') ? records['sitefiles:' + siteKey.slice(6)] : null;
  return files?.hash && files.path ? files : meta;
}

// `fresh`: ignora o índice guardado por 60 s (usado ao publicar, para pegar a versão mais nova).
// Devolve { site, filesHash } (filesHash = identificação dos arquivos no armazenamento online).
export async function readSiteInfo(siteKey, { fresh = false } = {}) {
  if (!process.env.BLOB_READ_WRITE_TOKEN) return null;
  const current = fresh ? await readManifest() : await currentManifest();
  const record = pickSiteRecord(current?.manifest.records, siteKey);
  if (!record) return null;
  const hit = sites.get(record.hash);
  const site = hit ? hit.site : await once('site:' + record.hash, () => loadSite(record));
  return site ? { site, filesHash: record.hash } : null;
}

export async function readSite(siteKey) {
  return (await readSiteInfo(siteKey))?.site ?? null;
}
