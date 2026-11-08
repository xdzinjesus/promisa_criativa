import { createFeaturedStore } from '../lib/featured-store.js';
import { createDemoHandler } from '../lib/demo-site.js';
import { cached, readSite } from '../lib/site-cache.js';

// Rota pública: lista dos projetos em destaque e prévia (somente leitura) de cada site.
const store = createFeaturedStore();
const items = cached(60_000, 30_000, () => store.list());
const FAR = 8.64e15;

// Só a nossa página inicial pode incorporar a prévia; sem formulários, janelas ou downloads.
export const PROJECT_VARIANT = {
  prefix: '/projeto',
  csp: "sandbox allow-scripts; frame-ancestors 'self'",
  cacheControl: 'public, max-age=60',
  cdnCache: 'max-age=600',
  headers: { 'X-Frame-Options': 'SAMEORIGIN' }
};
export const projectHandler = createDemoHandler({
  findShare: async id => {
    if (!process.env.BLOB_READ_WRITE_TOKEN) return null;
    const item = (await items()).find(entry => entry.id === id);
    return item ? { siteKey: item.siteKey, expiresAt: FAR } : null;
  },
  readSite,
  variant: PROJECT_VARIANT
});

function json(res, status, body, cache) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', cache || 'no-store');
  if (cache) res.setHeader('Vercel-CDN-Cache-Control', 'max-age=300');
  res.end(JSON.stringify(body));
}

export default async function handler(req, res) {
  const url = new URL(req.url || '/', 'http://localhost');
  const first = value => Array.isArray(value) ? value[0] : value;
  if ((first(req.query?.mode) ?? url.searchParams.get('mode')) === 'site') {
    req.query = { ...req.query, token: String(first(req.query?.id) ?? url.searchParams.get('id') ?? '') };
    return projectHandler(req, res);
  }
  if (!['GET', 'HEAD'].includes(req.method)) { res.setHeader('Allow', 'GET, HEAD'); return json(res, 405, { error: 'Método não permitido.' }); }
  if (!process.env.BLOB_READ_WRITE_TOKEN) return json(res, 200, { items: [] }, 'public, max-age=60');
  try {
    const list = await items();
    return json(res, 200, { items: list.map(({ id, title, category, demo }) => ({ id, title, category, demo: Boolean(demo) })) }, 'public, max-age=60');
  } catch (error) {
    console.error('[featured]', error?.constructor?.name || error?.name, error?.message);
    return json(res, 503, { error: 'Indisponível.' });
  }
}
