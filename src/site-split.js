import { encodeValue, digest } from './cloud-core.js';

// Online, cada site fica em dois registros:
//   sites:<id>      -> só os dados (nome, status, vínculo...) + filesHash
//   sitefiles:<id>  -> { id, htmlPath, files, sourceZip? } (a parte pesada)
// Localmente (IndexedDB e cópia local) o site continua inteiro.
const FILE_FIELDS = ['htmlPath', 'files', 'sourceZip'];
export const siteKey = id => 'sites:' + encodeURIComponent(String(id));
export const siteFilesKey = id => 'sitefiles:' + encodeURIComponent(String(id));
export const siteIdOf = key => decodeURIComponent(key.slice(key.indexOf(':') + 1));
export const isSiteKey = key => typeof key === 'string' && (key.startsWith('sites:') || key.startsWith('sitefiles:'));
export const pairOf = key => key.startsWith('sitefiles:') ? 'sites:' + key.slice(10) : 'sitefiles:' + key.slice(6);

export function canSplit(site) { return Boolean(site) && typeof site === 'object' && Array.isArray(site.files); }

export function splitSite(site) {
  const meta = {}, filesPart = { id: site.id };
  for (const key of Object.keys(site)) {
    if (site[key] === undefined) continue;
    if (FILE_FIELDS.includes(key)) filesPart[key] = site[key]; else meta[key] = site[key];
  }
  return { meta, filesPart };
}
// Junta metadados e arquivos no formato completo guardado no aparelho (sem filesHash).
export function mergeSite(meta, filesPart) {
  const { filesHash, ...rest } = meta;
  const merged = { ...rest, htmlPath: filesPart.htmlPath, files: filesPart.files };
  if (filesPart.sourceZip !== undefined) merged.sourceZip = filesPart.sourceZip;
  return merged;
}

// Impressão digital rápida do conteúdo (todos os textos e bytes), usada só para reaproveitar o hash
// da parte pesada quando nada mudou. Qualquer mudança de conteúdo muda a impressão.
function mixer() {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57, count = 0;
  return {
    code(c) { h1 = Math.imul(h1 ^ c, 2654435761); h2 = Math.imul(h2 ^ c, 1597334677); count++; },
    str(s) {
      let a = Math.imul(h1 ^ 0x1f1f, 2654435761), b = Math.imul(h2 ^ 0x1f1f, 1597334677);
      for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); a = Math.imul(a ^ c, 2654435761); b = Math.imul(b ^ c, 1597334677); }
      h1 = a; h2 = b; count += s.length + 1; this.code(s.length & 0xffff);
    },
    result() {
      h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
      h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
      return (h1 >>> 0).toString(16) + '.' + (h2 >>> 0).toString(16) + '.' + count;
    }
  };
}
async function mixValue(m, value, depth = 0) {
  if (depth > 40) throw new Error('Dados com estrutura excessivamente profunda.');
  if (typeof Blob !== 'undefined' && value instanceof Blob) {
    m.str('B' + value.type + ':' + value.size + ':' + (value.name ?? '') + ':' + (value.lastModified ?? ''));
    const bytes = new Uint8Array(await value.arrayBuffer());
    for (let i = 0; i < bytes.length; i++) m.code(bytes[i]);
  } else if (Array.isArray(value)) { m.str('[' + value.length); for (const item of value) await mixValue(m, item, depth + 1); }
  else if (value && typeof value === 'object') {
    m.str('{');
    for (const key of Object.keys(value).sort()) if (value[key] !== undefined) { m.str(key); await mixValue(m, value[key], depth + 1); }
  } else if (typeof value === 'string') { m.code(115); m.str(value); }
  else m.str(typeof value + ':' + String(value));
}
export async function filesFingerprint(filesPart) {
  const m = mixer();
  await mixValue(m, filesPart);
  return m.result();
}
const filesText = async filesPart => JSON.stringify({ version: 1, value: await encodeValue(filesPart) });

// Produz as duas entradas online de um site. `memo` (Map id -> { fingerprint, hash }) evita recodificar
// e recalcular o hash de vários MB a cada verificação quando os arquivos não mudaram.
export async function buildSiteEntries(site, memo = new Map()) {
  const { meta, filesPart } = splitSite(site);
  const id = String(site.id), fingerprint = await filesFingerprint(filesPart);
  let hash = memo.get(id)?.fingerprint === fingerprint ? memo.get(id).hash : null;
  if (!hash) { hash = await digest(await filesText(filesPart)); memo.set(id, { fingerprint, hash }); }
  const metaText = JSON.stringify({ version: 1, value: await encodeValue({ ...meta, filesHash: hash }) });
  const metaHash = await digest(metaText);
  return {
    files: {
      key: siteFilesKey(id), hash, plainHash: hash, isDefault: false, site,
      // O texto grande só é refeito quando o arquivo realmente vai ser enviado; confere o hash antes.
      async load() {
        const text = await filesText(filesPart);
        if (await digest(text) !== hash) { memo.delete(id); throw new Error('Os arquivos do site mudaram durante o envio. Sincronize de novo.'); }
        return text;
      }
    },
    meta: { key: siteKey(id), text: metaText, hash: metaHash, plainHash: metaHash, isDefault: false, site }
  };
}

// Chaves de um mesmo site são resolvidas juntas: acrescenta a chave irmã e remove repetições.
export function withSitePairs(keys) {
  const out = new Set();
  for (const key of keys) { out.add(key); if (isSiteKey(key)) out.add(pairOf(key)); }
  return [...out];
}
export function conflictLabels(keys) {
  const set = new Set(keys), labels = [];
  for (const key of keys) {
    if (key.startsWith('sitefiles:')) { if (!set.has('sites:' + key.slice(10))) labels.push('sites:' + key.slice(10) + ' (arquivos do site)'); }
    else labels.push(key);
  }
  return labels;
}

// Agrupa as operações em lotes de até `size`, mantendo os dois registros de um site no mesmo lote
// (arquivos antes dos dados) para que o índice online nunca aponte para um par inconsistente.
export function batchOperations(operations, size = 20) {
  const groups = [], byId = new Map();
  for (const op of operations) {
    if (isSiteKey(op.key)) {
      const id = op.key.slice(op.key.indexOf(':') + 1);
      if (byId.has(id)) { byId.get(id).push(op); continue; }
      const group = [op]; byId.set(id, group); groups.push(group);
    } else groups.push([op]);
  }
  for (const group of groups) group.sort((a, b) => (b.key.startsWith('sitefiles:') ? 1 : 0) - (a.key.startsWith('sitefiles:') ? 1 : 0));
  const batches = [];
  let current = [];
  for (const group of groups) {
    if (current.length && current.length + group.length > size) { batches.push(current); current = []; }
    current.push(...group);
  }
  if (current.length) batches.push(current);
  return batches;
}

// Converte o que foi baixado (dados e/ou arquivos) em sites completos para o aparelho.
// incoming: Map chave -> valor | undefined (apagado). records: índice online.
// getLocal(id) -> { site, filesHash } | null. fetchFiles(key, hash) -> parte de arquivos.
export async function resolveSiteDownloads(incoming, records, getLocal, fetchFiles) {
  const out = new Map(), ids = new Set();
  for (const [key, value] of incoming) {
    if (isSiteKey(key)) ids.add(key.slice(key.indexOf(':') + 1)); else out.set(key, value);
  }
  for (const encoded of ids) {
    const id = decodeURIComponent(encoded), sKey = siteKey(id), fKey = siteFilesKey(id);
    if (incoming.has(sKey) && incoming.get(sKey) === undefined) { out.set(sKey, undefined); continue; }
    const local = getLocal(id);
    if (!incoming.has(sKey)) {
      // Só os arquivos mudaram online: conserva os dados deste aparelho.
      const files = incoming.get(fKey);
      if (files === undefined || !local) continue;
      out.set(sKey, mergeSite(splitSite(local.site).meta, files));
      continue;
    }
    const meta = incoming.get(sKey);
    if (!Object.hasOwn(meta, 'filesHash')) { out.set(sKey, meta); continue; } // registro antigo, completo
    const fail = () => new Error('Os dados online mudaram durante a leitura. Clique em Sincronizar agora.');
    let files;
    if (incoming.has(fKey)) {
      files = incoming.get(fKey);
      if (!files || records[fKey]?.hash !== meta.filesHash) throw fail();
    } else if (local && local.filesHash === meta.filesHash) files = splitSite(local.site).filesPart;
    else {
      const record = records[fKey];
      if (!record?.hash || record.hash !== meta.filesHash) throw record?.hash ? fail() : new Error('Os arquivos deste site não foram encontrados online.');
      files = await fetchFiles(fKey, record.hash);
    }
    out.set(sKey, mergeSite(meta, files));
  }
  return out;
}

// Hash do registro antigo (site inteiro num só registro), igual ao que versões anteriores enviavam.
export async function legacySiteHash(site) {
  return digest(JSON.stringify({ version: 1, value: await encodeValue(site) }));
}

// Migração: aparelhos que sincronizaram antes da separação guardam como base o hash do registro antigo
// (sites:<id> inteiro) e nada para sitefiles:<id>. Se o site deste aparelho continua igual a essa base,
// ele não foi editado aqui: informa isso ao planejamento para que mudanças feitas online sejam baixadas
// (e não tratadas como conflito, o que poderia levar a escolher a versão antiga e perder trabalho).
// Devolve cópias de baseline/baselinePlain só para o planejamento; nada é gravado.
// memo (Map hash dos dados -> hash antigo) evita recalcular a cada verificação.
export async function legacyBaselineHints(local, baseline, baselinePlain, remote, memo = new Map(), hashOf = legacySiteHash) {
  const base = { ...baseline }, plain = { ...(baselinePlain || {}) };
  for (const [key, entry] of Object.entries(local)) {
    if (!key.startsWith('sites:') || !entry?.site) continue;
    const fKey = pairOf(key), files = local[fKey];
    if (!files || !Object.hasOwn(baseline, key) || !baseline[key] || Object.hasOwn(baseline, fKey)) continue;
    let legacy = memo.get(entry.hash);
    if (!legacy) { legacy = await hashOf(entry.site); memo.set(entry.hash, legacy); }
    if (legacy !== baseline[key]) continue; // editado neste aparelho desde a última sincronização
    plain[key] = entry.plainHash;
    if (remote?.[fKey]) base[fKey] = files.hash;
  }
  return { baseline: base, baselinePlain: plain };
}

// Enquanto um registro do site é baixado, não envia o registro irmão no mesmo ciclo: o envio usaria a
// versão antiga deste aparelho junto da nova baixada. O próximo ciclo envia o par já consistente.
export function deferSitePairs(plan) {
  const downloads = new Set(plan.downloads);
  const operations = plan.operations.filter(op => !(isSiteKey(op.key) && downloads.has(pairOf(op.key))));
  return { ...plan, operations, deferred: plan.operations.length - operations.length };
}
