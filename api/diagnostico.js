import { createDiagnosticoStore } from '../lib/diagnostico-store.js';
import { createDiagnosticoHandler } from '../lib/diagnostico-handler.js';
import { analyzeSite } from '../lib/diagnostico-analyze.js';
import { events } from '../lib/discord-events.js';
import { settings, authorized, sameOrigin, allowedFor } from './access.js';

// A análise pode levar até ~50 s (teste de velocidade do Google): maxDuration 60 em vercel.json.

const store = createDiagnosticoStore();

export default createDiagnosticoHandler({
  store,
  analyze: url => analyzeSite(url),
  authorized: async req => { const admin = settings(); return Boolean(admin) && await allowedFor(req, admin, 'diagnostico'); }, // dono, ou sócio com o módulo liberado
  sameOrigin,
  onCreated: report => events.diagnosticoCreated(report)
});
