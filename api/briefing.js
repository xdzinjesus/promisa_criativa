import { createBriefingStore } from '../lib/briefing-store.js';
import { createBriefingHandler } from '../lib/briefing-handler.js';
import { sameOrigin } from './access.js';

// Proteção da cota do Vercel Blob (ver lib/briefing-store.js): códigos assinados com validade,
// conferidos sem acessar o Blob; o índice é lido uma vez por vez, reaproveitado e com pausa
// após falhas; códigos respondidos/apagados ficam lembrados nesta instância.
const store = createBriefingStore();

export default createBriefingHandler({
  configured: () => Boolean(process.env.BLOB_READ_WRITE_TOKEN),
  sameOrigin,
  find: token => store.find(token),
  submit: (token, answers) => store.submit(token, answers)
});
