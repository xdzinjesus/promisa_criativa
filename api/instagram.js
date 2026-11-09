import { createInstagramHandler } from '../lib/instagram-handler.js';
import { instagramService } from '../lib/instagram-sync.js';
import { events } from '../lib/discord-events.js';
import { settings, authorized, sameOrigin } from './access.js';

// Instagram: ações do painel (status, sync, goals, clients-count). Variável na Vercel: INSTAGRAM_TOKEN.
// O token nunca é devolvido ao painel. Avisos no Discord saem em segundo plano e nunca quebram a resposta.
export default createInstagramHandler({
  service: instagramService,
  authorized: async req => { const admin = settings(); return Boolean(admin) && Boolean(await authorized(req, admin)); },
  sameOrigin,
  onChanged: () => events.dashboardSoon(),
  onSynced: result => events.instagramSynced(result)
});
