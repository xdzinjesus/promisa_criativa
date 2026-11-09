import * as blob from '@vercel/blob';
import { readManifest as defaultReadManifest } from './cloud-store.js';

// Leitura enxuta dos dados do painel para os comandos e o resumo do Discord.
// Custo no Vercel Blob (leituras simples): manifesto = 1 por consulta (guardado 30 s nesta instância);
// cada cadastro/site lido = 1. Os comandos de cliente leem no máximo MAX_READS registros e param cedo
// quando os cadastros estão criptografados (cofre). O resumo diário NÃO lê registros (só o manifesto).
export const MAX_READS = 150;
const CHUNK = 10;
const MAX_RECORD_BYTES = 2 * 1024 * 1024;

export const normalize = value => String(value ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

// Os cadastros criam o id com Date.now() em base 36 (8 primeiras letras): dá para saber quando o cadastro foi criado sem ler nada.
export function createdAtFromId(id) {
  const match = /^([0-9a-z]{8})[0-9a-z]{0,6}$/.exec(String(id));
  if (!match) return 0;
  const time = parseInt(match[1], 36);
  return time > Date.UTC(2020, 0, 1) && time < Date.UTC(2100, 0, 1) ? time : 0;
}

export function createData({ readManifest = defaultReadManifest, get = blob.get, token = () => process.env.BLOB_READ_WRITE_TOKEN, now = () => Date.now(), ttlMs = 30_000 } = {}) {
  let cachedManifest = null, cachedDirectory = null;

  async function manifest() {
    if (cachedManifest && cachedManifest.expires > now()) return cachedManifest.value;
    const result = await readManifest();
    cachedManifest = { value: result?.manifest || null, expires: now() + ttlMs };
    return cachedManifest.value;
  }

  // { state: 'ok', value } | { state: 'sealed' } (criptografado) | { state: 'missing' } | { state: 'big' }
  async function readRecord(key, m) {
    const record = (m || await manifest())?.records?.[key];
    if (!record?.hash || !record.path) return { state: 'missing' };
    let result;
    try { result = await get(record.path, { token: token(), access: 'private', useCache: false }); } catch { return { state: 'missing' }; }
    if (!result?.stream) return { state: 'missing' };
    if (result.blob?.size > MAX_RECORD_BYTES) { await result.stream.cancel?.().catch?.(() => {}); return { state: 'big' }; }
    try {
      const data = await new Response(result.stream).json();
      if (data?.version === 2) return { state: 'sealed' };
      if (data?.version === 1 && data.value && typeof data.value === 'object') return { state: 'ok', value: data.value };
    } catch { /* registro ilegível */ }
    return { state: 'missing' };
  }

  async function readMany(keys, m, { stopWhenSealed = false } = {}) {
    const items = []; let sealed = 0, reads = 0;
    const list = keys.slice(0, MAX_READS);
    for (let index = 0; index < list.length; index += CHUNK) {
      const batch = list.slice(index, index + CHUNK);
      const results = await Promise.all(batch.map(key => readRecord(key, m)));
      reads += batch.length;
      results.forEach((result, position) => {
        if (result.state === 'ok') items.push({ key: batch[position], value: result.value });
        else if (result.state === 'sealed') sealed++;
      });
      if (stopWhenSealed && sealed === reads) break; // cofre ligado: o resto também está criptografado
    }
    return { items, sealed, truncated: keys.length > MAX_READS };
  }

  const keysWith = (m, prefix) => Object.entries(m.records).filter(([key, record]) => key.startsWith(prefix) && record?.hash && record.path).map(([key]) => key);

  // Cadastros (sales:) e sites (sites:) legíveis. Guardado por ttlMs.
  async function directory() {
    if (cachedDirectory && cachedDirectory.expires > now()) return cachedDirectory.value;
    const m = await manifest();
    if (!m) return { empty: true, leads: [], sites: [], sealed: false, truncated: false };
    const [sales, sites] = await Promise.all([readMany(keysWith(m, 'sales:'), m, { stopWhenSealed: true }), readMany(keysWith(m, 'sites:'), m)]);
    const value = {
      empty: false, sealed: sales.sealed > 0 && sales.items.length === 0,
      truncated: sales.truncated || sites.truncated,
      leads: sales.items.map(item => item.value), sites: sites.items.map(item => item.value)
    };
    cachedDirectory = { value, expires: now() + ttlMs };
    return value;
  }

  // Quem combina com o nome digitado: { sealed, truncated, matches: [{ lead|null, sites: [site...] }] } (sites do mais novo para o mais antigo).
  async function findTargets(query) {
    const q = normalize(query);
    const dir = await directory();
    const out = { sealed: dir.sealed, truncated: dir.truncated, empty: dir.empty, matches: [] };
    if (!q || dir.empty) return out;
    const byUpdate = (a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''));
    const clientSites = lead => dir.sites.filter(site => (site.siteType || 'cliente') === 'cliente' && String(site.leadId ?? '') === String(lead.id)).sort(byUpdate);
    for (const lead of dir.leads) if (normalize(lead.client).includes(q)) out.matches.push({ lead, sites: clientSites(lead) });
    if (!out.matches.length) {
      // Sem cadastro legível (ou sem coincidência): procura pelo nome do site.
      for (const site of dir.sites) if (normalize(site.name).includes(q)) out.matches.push({ lead: null, sites: [site] });
    }
    return out;
  }

  // Nome do site (para os avisos). Uma leitura do registro, só quando há aviso a enviar.
  async function siteName(siteKey) {
    try { const record = await readRecord(siteKey); return record.state === 'ok' && typeof record.value.name === 'string' ? record.value.name : ''; } catch { return ''; }
  }

  return { manifest, readRecord, directory, findTargets, siteName, reset: () => { cachedManifest = null; cachedDirectory = null; } };
}
