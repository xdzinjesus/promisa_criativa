// Guarda as chaves do cofre neste navegador (IndexedDB). As chaves não são exportáveis.
const DB = 'promisa-vault', STORE = 'keys', SLOT = 'current';
function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('Feche as outras abas do painel e tente novamente.'));
  });
}
async function run(mode, action) {
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const request = action(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(request?.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error('Não foi possível guardar a chave.'));
    });
  } finally { db.close(); }
}
export async function saveKeys({ id, encKey, ivKey }) { await run('readwrite', store => store.put({ id, encKey, ivKey }, SLOT)); }
export async function loadKeys() {
  const keys = await run('readonly', store => store.get(SLOT));
  return keys?.id && keys.encKey && keys.ivKey ? keys : null;
}
export async function clearKeys() { await run('readwrite', store => store.delete(SLOT)); }
