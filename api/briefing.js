import { createBriefingStore } from '../lib/briefing-store.js';
import { createBriefingHandler } from '../lib/briefing-handler.js';
import { sameOrigin } from './access.js';

// Proteção da cota do Vercel Blob: o índice é lido uma vez por vez (leituras simultâneas
// compartilham a mesma busca), reaproveitado por 20 s e há pausa após falhas, para que
// códigos aleatórios não gerem uma operação no Blob por visita.
const store = createBriefingStore();
let entry = null, pending = null;
function index() {
  if (entry && entry.expires > Date.now()) return entry.error ? Promise.reject(entry.error) : Promise.resolve(entry.value);
  if (pending) return pending;
  pending = store.all()
    .then(value => { entry = { value, expires: Date.now() + 20_000 }; return value; })
    .catch(error => { entry = { error, expires: Date.now() + 30_000 }; throw error; })
    .finally(() => { pending = null; });
  return pending;
}

export default createBriefingHandler({
  configured: () => Boolean(process.env.BLOB_READ_WRITE_TOKEN),
  sameOrigin,
  find: async token => (await index()).find(item => item.token === token) || null,
  submit: async (token, answers) => { const result = await store.submit(token, answers); entry = null; return result; }
});
