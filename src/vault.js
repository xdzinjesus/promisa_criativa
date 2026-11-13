// Cofre: criptografia dos registros online com a Web Crypto (navegador e Node 22).
// Módulo puro: sem DOM, sem IndexedDB, sem Buffer.
const encoder = new TextEncoder(), decoder = new TextDecoder();
const AAD = encoder.encode('promisa-vault-v1');
const MIN_ITERATIONS = 100_000, MAX_ITERATIONS = 5_000_000, ITERATIONS = 600_000;

export const ENCRYPTED_KINDS = ['sales', 'exp', 'projects', 'bank', 'products', 'settings', 'attachments'];
export const isEncryptedKey = recordKey => typeof recordKey === 'string' && ENCRYPTED_KINDS.includes(recordKey.slice(0, Math.max(0, recordKey.indexOf(':'))));

export class VaultError extends Error {
  constructor(code, message) { super(message); this.name = 'VaultError'; this.code = code; }
}
const subtle = () => globalThis.crypto.subtle;
const random = length => globalThis.crypto.getRandomValues(new Uint8Array(length));

export function bytesToBase64(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 32768) binary += String.fromCharCode(...bytes.subarray(i, i + 32768));
  return btoa(binary);
}
export function base64ToBytes(text) {
  if (typeof text !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(text) || text.length % 4) throw new VaultError('INVALID', 'Dado criptografado inválido.');
  const binary = atob(text), bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function passwordKey(password, salt, iterations) {
  const base = await subtle().importKey('raw', encoder.encode(String(password)), 'PBKDF2', false, ['deriveKey']);
  return subtle().deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
export async function deriveKeys(master, id) {
  const base = await subtle().importKey('raw', master, 'HKDF', false, ['deriveKey']);
  const salt = new Uint8Array(32);
  const encKey = await subtle().deriveKey({ name: 'HKDF', hash: 'SHA-256', salt, info: encoder.encode('promisa-vault-v1/enc') }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  const ivKey = await subtle().deriveKey({ name: 'HKDF', hash: 'SHA-256', salt, info: encoder.encode('promisa-vault-v1/iv') }, base, { name: 'HMAC', hash: 'SHA-256', length: 256 }, false, ['sign']);
  return { id, encKey, ivKey };
}
async function wrap(master, password, id, createdAt) {
  const salt = random(16), iv = random(12);
  const kek = await passwordKey(password, salt, ITERATIONS);
  const data = new Uint8Array(await subtle().encrypt({ name: 'AES-GCM', iv, additionalData: AAD }, kek, master));
  return { version: 1, id, kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations: ITERATIONS, salt: bytesToBase64(salt) }, wrapped: { iv: bytesToBase64(iv), data: bytesToBase64(data) }, createdAt };
}
async function unwrap(keyring, password) {
  const kdf = keyring?.kdf, wrapped = keyring?.wrapped;
  if (keyring?.version !== 1 || typeof keyring.id !== 'string' || kdf?.name !== 'PBKDF2' || kdf.hash !== 'SHA-256' || !Number.isInteger(kdf.iterations) || kdf.iterations < MIN_ITERATIONS || kdf.iterations > MAX_ITERATIONS) throw new VaultError('INVALID_KEYRING', 'Chave de proteção inválida.');
  const salt = base64ToBytes(kdf.salt), iv = base64ToBytes(wrapped?.iv), data = base64ToBytes(wrapped?.data);
  if (salt.length !== 16 || iv.length !== 12 || data.length !== 48) throw new VaultError('INVALID_KEYRING', 'Chave de proteção inválida.');
  const kek = await passwordKey(password, salt, kdf.iterations);
  try { return new Uint8Array(await subtle().decrypt({ name: 'AES-GCM', iv, additionalData: AAD }, kek, data)); }
  catch { throw new VaultError('WRONG_KEY', 'Senha incorreta para a chave de proteção.'); }
}
export async function createKeyring(password) {
  const master = random(32), id = globalThis.crypto.randomUUID();
  const keyring = await wrap(master, password, id, new Date().toISOString());
  return { keyring, keys: await deriveKeys(master, id) };
}
export async function unlockKeyring(keyring, password) {
  return deriveKeys(await unwrap(keyring, password), keyring.id);
}
// Troca a senha que protege a chave mestra, mantendo a mesma chave mestra e o mesmo id.
export async function rewrapKeyring(keyring, oldPassword, newPassword) {
  const master = await unwrap(keyring, oldPassword);
  const next = await wrap(master, newPassword, keyring.id, keyring.createdAt);
  return { keyring: next, keys: await deriveKeys(master, keyring.id) };
}

export async function seal(keys, recordKey, textV1) {
  const mac = await subtle().sign('HMAC', keys.ivKey, encoder.encode(recordKey + '\n' + textV1));
  const iv = new Uint8Array(mac).slice(0, 12);
  const data = new Uint8Array(await subtle().encrypt({ name: 'AES-GCM', iv, additionalData: encoder.encode(recordKey) }, keys.encKey, encoder.encode(textV1)));
  return JSON.stringify({ version: 2, vault: keys.id, iv: bytesToBase64(iv), data: bytesToBase64(data) });
}
// Formato do registro cifrado (sem conteúdo legível): usado também pelo servidor.
export function isSealedRecord(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data) || data.version !== 2) return false;
  if (typeof data.vault !== 'string' || !data.vault || data.vault.length > 64 || typeof data.data !== 'string' || typeof data.iv !== 'string') return false;
  try { return base64ToBytes(data.iv).length === 12 && base64ToBytes(data.data).length >= 16; } catch { return false; }
}
export async function open(keys, recordKey, textV2) {
  let data;
  try { data = JSON.parse(textV2); } catch { throw new VaultError('INVALID', 'Registro criptografado inválido.'); }
  if (!isSealedRecord(data)) throw new VaultError('INVALID', 'Registro criptografado inválido.');
  if (data.vault !== keys.id) throw new VaultError('WRONG_VAULT', 'Registro protegido por outra chave.');
  try {
    const plain = await subtle().decrypt({ name: 'AES-GCM', iv: base64ToBytes(data.iv), additionalData: encoder.encode(recordKey) }, keys.encKey, base64ToBytes(data.data));
    return decoder.decode(plain);
  } catch { throw new VaultError('DECRYPT_FAILED', 'Não foi possível descriptografar o registro.'); }
}
