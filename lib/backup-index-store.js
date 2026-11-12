import * as blob from '@vercel/blob';
import { isBlobError, readWithEtag } from './blob-utils.js';

// Lista do que já foi enviado ao canal 🗄️・backup-sites do Discord: { siteId: { h: hashDoConteúdo, at } }.
// Vale para todos os aparelhos, para nunca mandar o mesmo site (com o mesmo conteúdo) duas vezes.
// Custo: 1 leitura quando o painel tem site alterado para conferir e 1 gravação por site enviado.
export const INDEX_PATH = 'promisa/discord/v1/site-backups.json';
const MAX_BYTES = 256 * 1024, MAX_SITES = 3000;
export const validSiteId = id => typeof id === 'string' && /^[\w:.-]{1,100}$/.test(id);
export const validHash = h => typeof h === 'string' && /^[a-f0-9]{16,64}$/.test(h);

export function normalizeIndex(raw) {
  const sites = {};
  const entries = Object.entries(raw?.sites && typeof raw.sites === 'object' ? raw.sites : {})
    .filter(([id, item]) => validSiteId(id) && validHash(item?.h))
    .sort(([, a], [, b]) => String(b.at || '').localeCompare(String(a.at || '')))
    .slice(0, MAX_SITES);
  for (const [id, item] of entries) sites[id] = { h: item.h, at: String(item.at || '').slice(0, 40) };
  return { version: 1, sites };
}

const conflict = error => isBlobError(error, 'BlobPreconditionFailedError') || /already exists|precondition/i.test(error?.message || '');

export function createBackupIndexStore({
  get = blob.get, head = blob.head, put = blob.put,
  token = () => process.env.BLOB_READ_WRITE_TOKEN,
  memory = () => !token() && !process.env.VERCEL,
  now = () => Date.now()
} = {}) {
  const options = () => ({ token: token() });
  let mem = normalizeIndex(null);
  const parse = async result => {
    if (result.blob?.size > MAX_BYTES) { await result.stream?.cancel?.().catch?.(() => {}); return normalizeIndex(null); }
    return normalizeIndex(await new Response(result.stream).json().catch(() => null));
  };
  return {
    async read() {
      if (memory()) return structuredClone(mem);
      if (!token()) return normalizeIndex(null);
      let result;
      try { result = await get(INDEX_PATH, { ...options(), access: 'private', useCache: false }); }
      catch (error) { if (isBlobError(error, 'BlobNotFoundError')) return normalizeIndex(null); throw error; }
      return result?.stream ? parse(result) : normalizeIndex(null);
    },
    // Marca sites como enviados (com ifMatch: se outro aparelho gravou no meio, lê de novo e junta).
    async mark(items) {
      const valid = (items || []).filter(item => validSiteId(item?.id) && validHash(item?.h)).slice(0, 50);
      if (!valid.length) return 0;
      const apply = index => { const at = new Date(now()).toISOString(); for (const item of valid) index.sites[item.id] = { h: item.h, at }; return normalizeIndex(index); };
      if (memory()) { mem = apply(mem); return valid.length; }
      if (!token()) return 0;
      for (let attempt = 0; attempt < 4; attempt++) {
        const read = await readWithEtag(INDEX_PATH, options(), { get, head });
        const next = apply(read ? await parse(read.result) : normalizeIndex(null));
        try {
          await put(INDEX_PATH, JSON.stringify(next), { ...options(), access: 'private', contentType: 'application/json', addRandomSuffix: false, ...(read ? { allowOverwrite: true, ifMatch: read.etag } : { allowOverwrite: false }), cacheControlMaxAge: 60 });
          return valid.length;
        } catch (error) { if (!conflict(error)) throw error; }
      }
      throw new Error('Outra gravação estava em andamento.');
    }
  };
}
