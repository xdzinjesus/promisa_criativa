import { waitUntil } from '@vercel/functions';
import { createClientAccessStore } from '../lib/client-access-store.js';
import { createClientAccessHandler } from '../lib/client-access-handler.js';
import { createPublishStore } from '../lib/publish-store.js';
import { createCloudflare, configured } from '../lib/cloudflare-pages.js';
import { notify } from '../lib/discord.js';
import { siteBase } from '../lib/discord-events.js';
import { settings, authorized, sameOrigin } from './access.js';

// "Meu site": o cliente edita só o site dele (link secreto + código) e o dono controla os acessos pelo painel.
// Publicar leva até ~1 minuto (maxDuration 60 em vercel.json). Guia: docs/HOSPEDAGEM.md.
export default createClientAccessHandler({
  store: createClientAccessStore(),
  publishStore: createPublishStore(),
  cloudflare: () => configured() ? createCloudflare({ token: process.env.CLOUDFLARE_API_TOKEN, accountId: process.env.CLOUDFLARE_ACCOUNT_ID }) : null,
  authorized: async req => { const admin = settings(); return Boolean(admin) && Boolean(await authorized(req, admin)); },
  sameOrigin,
  base: () => siteBase(),
  waitUntil,
  notify: ({ name, url }) => notify('sites-no-ar', { title: '✏️ Cliente atualizou o site', description: `**${String(name).slice(0, 80)}** salvou alterações pelo "Meu site".${url ? `\n${url}` : ''}` })
});
