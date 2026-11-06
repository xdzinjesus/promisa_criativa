// Funções puras compartilhadas pelos testes e pelo sincronizador do navegador.
export function planSync(local, baseline, remote) {
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
    if (here !== base && online !== base) { conflicts.push(key); continue; }
    if (here !== base) operations.push({ key, baseHash: base, hash: here });
    else if (online !== base) downloads.push(key);
  }
  return { operations, downloads, conflicts, matches };
}
export async function encodeValue(value) {
  if (value instanceof Blob) {
    const bytes = new Uint8Array(await value.arrayBuffer());
    let binary = '';
    for (let i = 0; i < bytes.length; i += 32768) binary += String.fromCharCode(...bytes.subarray(i, i + 32768));
    return { __promisaBlob: 1, type: value.type, base64: btoa(binary) };
  }
  if (Array.isArray(value)) return Promise.all(value.map(encodeValue));
  if (value && typeof value === 'object') {
    const output = {};
    for (const key of Object.keys(value).sort()) if (value[key] !== undefined) output[key] = await encodeValue(value[key]);
    return output;
  }
  return value;
}
export function decodeValue(value) {
  if (value?.__promisaBlob === 1 && typeof value.base64 === 'string') return new Blob([Uint8Array.from(atob(value.base64), c => c.charCodeAt(0))], { type: String(value.type || '') });
  if (Array.isArray(value)) return value.map(decodeValue);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, decodeValue(item)]));
  return value;
}
export async function digest(text) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('');
}
