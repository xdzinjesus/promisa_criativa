import { waitUntil } from '@vercel/functions';
import { discord } from '../lib/discord.js';
import { events, siteBase } from '../lib/discord-events.js';
import { createData } from '../lib/discord-data.js';
import { createCommands } from '../lib/discord-commands.js';
import { createDiscordHandler } from '../lib/discord-handler.js';
import { createShareStore } from '../lib/share-store.js';
import { createDiagnosticoStore } from '../lib/diagnostico-store.js';
import { createPublishStore } from '../lib/publish-store.js';
import { publishSite } from '../lib/publish-handler.js';
import { analyzeSite } from '../lib/diagnostico-analyze.js';
import { createCloudflare, configured as cloudflareConfigured } from '../lib/cloudflare-pages.js';
import { readSiteInfo } from '../lib/site-cache.js';
import { settings, authorized, sameOrigin } from './access.js';

// Discord: Interactions Endpoint URL = https://www.promisa.online/api/discord (comandos de barra),
// painel (ações status/setup/register/test) e o resumo diário (cron, GET ?cron=summary).
// Os comandos respondem "pensando…" em até 3 s e terminam o trabalho em segundo plano com waitUntil
// (maxDuration 60 em vercel.json). Variáveis na Vercel: DISCORD_BOT_TOKEN, DISCORD_APP_ID, DISCORD_PUBLIC_KEY,
// DISCORD_GUILD_ID, DISCORD_OWNER_ID (todas opcionais: sem elas nada acontece).
const shares = createShareStore();
const diagnosticos = createDiagnosticoStore();
const publishedStore = createPublishStore();
const data = createData();

const commands = createCommands({
  discord, data, events, shares, diagnosticos, publishedStore,
  analyze: url => analyzeSite(url),
  cloudflare: () => cloudflareConfigured() ? createCloudflare({ token: process.env.CLOUDFLARE_API_TOKEN, accountId: process.env.CLOUDFLARE_ACCOUNT_ID }) : null,
  readSiteInfo, publishSite, base: () => siteBase()
});

export default createDiscordHandler({
  discord, commands, events, waitUntil,
  authorized: async req => { const admin = settings(); return Boolean(admin) && Boolean(await authorized(req, admin)); },
  sameOrigin
});
