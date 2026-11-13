import { waitUntil } from '@vercel/functions';
import { createClientAccessStore } from '../lib/client-access-store.js';
import { createClientAccessHandler } from '../lib/client-access-handler.js';
import { createPublishStore } from '../lib/publish-store.js';
import { createCloudflare, configured } from '../lib/cloudflare-pages.js';
import { notify } from '../lib/discord.js';
import { siteBase } from '../lib/discord-events.js';
import { settings, authorized, sameOrigin } from './access.js';
import { readSiteInfo } from '../lib/site-cache.js';
import { publishSite } from '../lib/publish-handler.js';
import { createSiteDataStore, createSiteDataActions, withSiteData } from '../lib/site-data.js';

// "Meu site": o cliente edita só o site dele (link secreto + código) e o dono controla os acessos pelo painel.
// Publicar leva até ~1 minuto (maxDuration 60 em vercel.json). Guia: docs/HOSPEDAGEM.md.
const publishStore = createPublishStore();
const cloudflare = () => configured() ? createCloudflare({ token: process.env.CLOUDFLARE_API_TOKEN, accountId: process.env.CLOUDFLARE_ACCOUNT_ID }) : null;
// "Dados ao vivo" (sites feitos à mão com área administrativa): ao publicar, os dados vão embutidos no HTML.
const dataStore = createSiteDataStore();
const readWithData = withSiteData(readSiteInfo, dataStore, { api: siteBase() + '/api/meu-site' });
const siteData = createSiteDataActions({
  store: dataStore,
  // Só republica sites que já estão publicados (o dono publica pela 1ª vez no painel).
  publish: async siteId => {
    const client = cloudflare(), entry = await publishStore.get(siteId); // falha na consulta vira erro: o cliente mantém as alterações e tenta de novo
    if (!client || !entry?.project) return { published: false };
    await publishSite({ store: publishStore, client, readSiteInfo: readWithData }, siteId, null, entry);
    return { published: true };
  }
});

export default createClientAccessHandler({
  siteData,
  store: createClientAccessStore(),
  publishStore,
  cloudflare,
  authorized: async req => { const admin = settings(); return Boolean(admin) && Boolean(await authorized(req, admin)); },
  sameOrigin,
  base: () => siteBase(),
  waitUntil,
  notify: ({ name, url }) => notify('sites-no-ar', { title: '✏️ Cliente atualizou o site', description: `**${String(name).slice(0, 80)}** salvou alterações pelo "Meu site".${url ? `\n${url}` : ''}` })
});
