import { validId } from '../src/data-validation.js';
import { CloudflareError, DomainError, projectNameFor, validateDomain } from './cloudflare-pages.js';
import { PublishStoreError } from './publish-store.js';
import { siteKeyFor } from './share-store.js';

// Rota de publicação (POST, só administrador): status, publish, set-domain, unpublish, list.
// Dependências injetadas para testar sem rede. A chave da Cloudflare nunca aparece nas respostas nem nos registros.
const MAX_BODY_BYTES = 8 * 1024;
export const NOT_CONFIGURED = 'A publicação ainda não foi configurada. Falta colocar a chave da Cloudflare na Vercel.';
const NOT_SYNCED = 'Sincronize o painel e tente de novo.';

async function readBody(req) {
  let raw = req.body;
  if (raw === undefined || raw === null || raw === '') {
    const chunks = []; let size = 0;
    for await (const chunk of req) { size += chunk.length; if (size > MAX_BODY_BYTES) return { tooLarge: true }; chunks.push(chunk); }
    raw = Buffer.concat(chunks).toString('utf8');
  }
  if (Buffer.isBuffer(raw)) raw = raw.toString('utf8');
  if (typeof raw === 'string') { if (Buffer.byteLength(raw) > MAX_BODY_BYTES) return { tooLarge: true }; return { value: JSON.parse(raw) }; }
  if (Buffer.byteLength(JSON.stringify(raw)) > MAX_BODY_BYTES) return { tooLarge: true };
  return { value: raw };
}

const publicEntry = entry => entry && ({
  project: entry.project, url: entry.url, domain: entry.domain || '', zoneId: entry.zoneId || '', nameServers: entry.nameServers || [],
  lastDeploymentId: entry.lastDeploymentId || '', lastPublishedAt: entry.lastPublishedAt || 0, filesHash: entry.filesHash || ''
});

export class NotSyncedError extends Error {
  constructor() { super(NOT_SYNCED); this.code = 'site-not-synced'; }
}

// Publica (ou atualiza) o site e, se vier `domain`, liga o domínio. Usado pela rota e pelo comando do Discord.
// `domain` já validado (validateDomain) ou null. Devolve o mesmo corpo que a rota responde.
export async function publishSite({ store, client, readSiteInfo, now = () => Date.now() }, siteId, domain = null, current = undefined) {
  const entry = current === undefined ? await store.get(siteId) : current;
  const found = await readSiteInfo(siteKeyFor(siteId), { fresh: true });
  if (!found?.site) throw new NotSyncedError();
  const projectName = entry?.project || projectNameFor(found.site.name, siteId);
  const result = await client.deploy(projectName, found.site, entry?.project && entry.url ? { url: entry.url } : null);
  const saved = await store.set(siteId, {
    project: result.project, url: result.url, lastDeploymentId: result.deploymentId, lastPublishedAt: now(), filesHash: found.filesHash
  });
  const out = { ...publicEntry(saved), uploaded: result.uploaded, total: result.total, siteName: String(found.site.name || '') };
  if (domain) {
    const info = await client.attachDomain(result.project, domain);
    const withDomain = await store.set(siteId, { domain: info.apex, zoneId: info.zone.id, nameServers: info.zone.nameServers });
    Object.assign(out, publicEntry(withDomain), { domainInfo: info });
  }
  return out;
}

// cloudflare: () => cliente | null (null = sem configuração). readSiteInfo(siteKey, { fresh }) -> { site, filesHash } | null.
// onPublished/onFailed (opcionais): avisos, como o do Discord. Nunca podem quebrar a resposta.
export function createPublishHandler({ store, cloudflare, readSiteInfo, authorized, sameOrigin, now = () => Date.now(), onPublished = null, onFailed = null }) {
  const tell = async (hook, data) => { try { await hook?.(data); } catch { /* aviso é opcional */ } };
  return async function handler(req, res) {
    const json = (status, body) => {
      res.statusCode = status;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Cache-Control', 'private, no-store');
      res.setHeader('Vercel-CDN-Cache-Control', 'no-store');
      res.setHeader('X-Robots-Tag', 'noindex, nofollow');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
      res.end(JSON.stringify(body));
    };
    let failedAction = '';
    try {
      if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return json(405, { error: 'Método não permitido.' }); }
      if (!await authorized(req)) return json(401, { error: 'Sua sessão terminou. Entre novamente.' });
      if (!sameOrigin(req)) return json(403, { error: 'Origem não permitida.' });
      if (!String(req.headers?.['content-type'] || '').toLowerCase().startsWith('application/json')) return json(415, { error: 'Formato inválido.' });
      let body;
      try { const read = await readBody(req); if (read.tooLarge) return json(413, { error: 'Pedido grande demais.' }); body = read.value; }
      catch { return json(400, { error: 'Dados inválidos.' }); }
      if (!body || typeof body !== 'object' || Array.isArray(body)) return json(400, { error: 'Dados inválidos.' });

      const action = body.action;
      failedAction = typeof action === 'string' ? action : '';
      if (!['list', 'status', 'publish', 'set-domain', 'unpublish'].includes(action)) return json(400, { error: 'Ação desconhecida.' });
      const client = cloudflare();
      const notConfigured = () => json(503, { error: NOT_CONFIGURED, code: 'cloudflare-not-configured' });

      if (action === 'list') {
        const items = await store.list();
        return json(200, { configured: Boolean(client), items: Object.fromEntries(Object.entries(items).map(([id, entry]) => [id, publicEntry(entry)])) });
      }

      if (!validId(body.siteId) || ['__proto__', 'constructor', 'prototype'].includes(String(body.siteId))) return json(400, { error: 'Site inválido.' });
      const siteId = String(body.siteId);
      if (!client) return notConfigured();
      const entry = await store.get(siteId);

      if (action === 'status') {
        if (!entry) return json(200, { published: false });
        const out = { published: true, ...publicEntry(entry), live: null, liveError: '', outdated: false, currentFilesHash: '' };
        try {
          const [domains, zone] = await Promise.all([
            entry.domain ? client.projectDomains(entry.project) : [],
            entry.zoneId ? client.zoneStatus(entry.zoneId) : null
          ]);
          out.live = { domains, zone };
        } catch (error) { out.liveError = error instanceof CloudflareError ? error.message : 'Não foi possível consultar a Cloudflare agora.'; }
        try {
          const info = await readSiteInfo(siteKeyFor(siteId));
          if (info) { out.currentFilesHash = info.filesHash; out.outdated = Boolean(entry.filesHash) && entry.filesHash !== info.filesHash; }
        } catch { /* sem a comparação, o painel só não mostra o aviso */ }
        return json(200, out);
      }

      if (action === 'unpublish') {
        if (!entry) return json(200, { ok: true });
        await client.deleteProject(entry.project);
        await store.remove(siteId);
        return json(200, { ok: true });
      }

      if (action === 'set-domain') {
        if (!entry) return json(409, { error: 'Publique o site primeiro e depois ligue o domínio.' });
        let domain;
        try { domain = validateDomain(body.domain); } catch (error) { if (error instanceof DomainError) return json(400, { error: error.message }); throw error; }
        const info = await client.attachDomain(entry.project, domain);
        const saved = await store.set(siteId, { domain: info.apex, zoneId: info.zone.id, nameServers: info.zone.nameServers });
        await tell(onPublished, { action: 'set-domain', siteId, name: '', url: saved.url, domain: saved.domain });
        return json(200, { ...publicEntry(saved), domainInfo: info });
      }

      // publish
      let domain = null;
      if (body.domain !== undefined && body.domain !== null && body.domain !== '') {
        try { domain = validateDomain(body.domain); } catch (error) { if (error instanceof DomainError) return json(400, { error: error.message }); throw error; }
      }
      let out;
      try { out = await publishSite({ store, client, readSiteInfo, now }, siteId, domain, entry); }
      catch (error) { if (error instanceof NotSyncedError) return json(409, { error: NOT_SYNCED, code: 'site-not-synced' }); throw error; }
      await tell(onPublished, { action: 'publish', siteId, name: out.siteName, url: out.url, domain: out.domain, uploaded: out.uploaded });
      delete out.siteName;
      return json(200, out);
    } catch (error) {
      if (req.method === 'POST' && ['publish', 'set-domain'].includes(failedAction)) await tell(onFailed, { action: failedAction, code: error?.code || '', status: error?.status || 0, kind: error?.constructor?.name || 'Error' });
      if (error instanceof CloudflareError) {
        const status = error.code === 'cloudflare-not-configured' ? 503 : error.status === 422 ? 422 : error.status === 400 ? 400 : error.status === 504 ? 504 : 502;
        return json(status, { error: error.message, code: error.code, detail: error.detail });
      }
      if (error instanceof PublishStoreError) return json(error.status, { error: error.message });
      console.error('[publish]', req.method, error?.constructor?.name || error?.name);
      return json(502, { error: 'Não foi possível concluir agora. Tente novamente em instantes.' });
    }
  };
}
