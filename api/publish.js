import { createPublishStore } from '../lib/publish-store.js';
import { createPublishHandler } from '../lib/publish-handler.js';
import { createCloudflare, configured } from '../lib/cloudflare-pages.js';
import { readSiteInfo } from '../lib/site-cache.js';
import { createSiteDataStore, withSiteData } from '../lib/site-data.js';
import { siteBase } from '../lib/discord-events.js';
import { events } from '../lib/discord-events.js';
import { settings, authorized, sameOrigin, allowedFor } from './access.js';

// Publicar pode levar até ~1 minuto (envio dos arquivos para a Cloudflare): maxDuration 60 em vercel.json.
// Variáveis na Vercel: CLOUDFLARE_API_TOKEN (chave) e CLOUDFLARE_ACCOUNT_ID.

const store = createPublishStore();

export default createPublishHandler({
  store,
  cloudflare: () => configured() ? createCloudflare({ token: process.env.CLOUDFLARE_API_TOKEN, accountId: process.env.CLOUDFLARE_ACCOUNT_ID }) : null,
  readSiteInfo: withSiteData(readSiteInfo, createSiteDataStore(), { api: siteBase() + '/api/meu-site' }), // embute os "dados ao vivo" quando ligados
  authorized: async req => { const admin = settings(); return Boolean(admin) && await allowedFor(req, admin, 'publish'); }, // dono, ou sócio com o módulo liberado
  sameOrigin,
  onPublished: info => events.sitePublished(info),
  onFailed: info => events.publishFailed(info)
});
