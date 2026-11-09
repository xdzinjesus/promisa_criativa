import { waitUntil } from '@vercel/functions';
import { createShareStore } from '../lib/share-store.js';
import { createDemoHandler } from '../lib/demo-site.js';
import { cached, readSite } from '../lib/site-cache.js';
import { events } from '../lib/discord-events.js';

const shares = createShareStore();
const findShare = cached(20_000, 30_000, () => shares.all());

export default createDemoHandler({
  findShare: async token => process.env.BLOB_READ_WRITE_TOKEN ? (await findShare()).find(item => item.token === token) || null : null,
  readSite,
  // Aviso em segundo plano (waitUntil): quem abre a demonstração não espera o Discord.
  onView: info => { waitUntil(events.demoViewed(info)); }
});
