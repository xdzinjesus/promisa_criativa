import { assertSafeTree } from './data-validation.js';
// Funções puras compartilhadas pelos testes e pelo sincronizador do navegador.
export function planSync(local, baseline, remote, baselinePlain = null) {
  const operations = [], downloads = [], conflicts = [], matches = [];
  for (const key of new Set([...Object.keys(local), ...Object.keys(baseline), ...Object.keys(remote)])) {
    const base = baseline[key] ?? null;
    const online = remote[key]?.hash ?? null;
    let here = local[key]?.hash ?? null;
    const firstVisit = !Object.hasOwn(baseline, key);
    // Um celular novo começa com os campos padrão, não com uma edição do usuário.
    if (firstVisit && online && local[key]?.isDefault) here = base;
    if (firstVisit && remote[key] && !online && here) { conflicts.push(key); continue; }
    if (here === online) { matches.push(key); continue; }
    // Com proteção ativa o hash local é do texto cifrado; o texto original é que diz se houve edição aqui.
    const plain = local[key]?.plainHash ?? null;
    const plainUnchanged = plain !== null && baselinePlain && Object.hasOwn(baselinePlain, key) && baselinePlain[key] === plain;
    const localChanged = here !== base && !plainUnchanged;
    if (localChanged && online !== base) { conflicts.push(key); continue; }
    if (localChanged) operations.push({ key, baseHash: base, hash: here });
    else if (online !== base) downloads.push(key);
    else if (here !== base) operations.push({ key, baseHash: base, hash: here }); // migração: mesmo conteúdo, nova forma (cifrada)
  }
  return { operations, downloads, conflicts, matches };
}
// Guarda as chaves no aparelho sem derrubar a ativação se o armazenamento local falhar.
export async function persistKeysSafely(save, keys) {
  try { await save(keys); return true; } catch { return false; }
}
export async function encodeValue(value, depth = 0) {
  if (depth === 0) assertSafeTree(value);
  if (value instanceof Blob) {
    const bytes = new Uint8Array(await value.arrayBuffer());
    let binary = '';
    for (let i = 0; i < bytes.length; i += 32768) binary += String.fromCharCode(...bytes.subarray(i, i + 32768));
    return { __promisaBlob: 1, type: value.type, base64: btoa(binary) };
  }
  if (Array.isArray(value)) return Promise.all(value.map(item => encodeValue(item, depth + 1)));
  if (value && typeof value === 'object') {
    const output = {};
    for (const key of Object.keys(value).sort()) if (value[key] !== undefined) output[key] = await encodeValue(value[key], depth + 1);
    return output;
  }
  return value;
}
export function decodeValue(value, depth = 0) {
  if (depth === 0) assertSafeTree(value);
  if (value?.__promisaBlob === 1 && typeof value.base64 === 'string') return new Blob([Uint8Array.from(atob(value.base64), c => c.charCodeAt(0))], { type: String(value.type || '') });
  if (Array.isArray(value)) return value.map(item => decodeValue(item, depth + 1));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, decodeValue(item, depth + 1)]));
  return value;
}
export async function digest(text) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('');
}
