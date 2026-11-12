import { createHmac, randomBytes, randomInt, scryptSync, timingSafeEqual } from 'node:crypto';
import { tokenHash } from './client-access-store.js';
import { cleanDraft, renderSite, newDraft, NICHES, PLANS } from '../src/client-site-templates.js';
import { projectNameFor } from './cloudflare-pages.js';

// /api/meu-site: o cliente edita SÓ o site dele; o dono controla tudo.
//  Cliente (link secreto + código de 6 números): login, load, save (salva e publica na Cloudflare).
//  Dono (sessão do painel): admin-create, admin-list, admin-get, admin-plan, admin-revoke.
// Segurança: token de 192 bits só como hash no Blob; código com scrypt + sal; 5 erros = 15 min bloqueado;
// sessão do cliente assinada (HMAC) por 2 h; limite de salvamentos por dia; rascunho limpo no servidor.
export const MAX_BODY_BYTES = 4_200_000; // abaixo do limite de 4,5 MB da Vercel
export const SESSION_MS = 2 * 60 * 60 * 1000, LOCK_MS = 15 * 60 * 1000, MAX_FAILS = 5, MAX_SAVES_PER_DAY = 30;
const GENERIC = 'Este link não é válido ou foi desativado. Fale com a Promisa.';
const validToken = token => typeof token === 'string' && /^[A-Za-z0-9_-]{32}$/.test(token);
const validSiteId = id => typeof id === 'string' && /^[\w:.-]{1,100}$/.test(id);
const dayOf = ms => new Date(ms).toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
export const hashCode = (code, salt) => scryptSync(String(code), Buffer.from(salt, 'hex'), 32).toString('hex');
const sameHex = (a, b) => { const x = Buffer.from(String(a), 'hex'), y = Buffer.from(String(b), 'hex'); return x.length === y.length && x.length > 0 && timingSafeEqual(x, y); };

async function readBody(req) {
  let raw = req.body;
  if (raw === undefined || raw === null || raw === '') {
    const chunks = []; let size = 0;
    for await (const chunk of req) { size += chunk.length; if (size > MAX_BODY_BYTES) return { tooLarge: true }; chunks.push(chunk); }
    raw = Buffer.concat(chunks).toString('utf8');
  }
  if (Buffer.isBuffer(raw)) raw = raw.toString('utf8');
  if (typeof raw === 'string') { if (Buffer.byteLength(raw) > MAX_BODY_BYTES) return { tooLarge: true }; try { return { value: JSON.parse(raw || '{}') }; } catch { return { bad: true }; } }
  return { value: raw };
}

export function createClientAccessHandler({ store, publishStore = null, cloudflare = () => null, authorized, sameOrigin, secret = () => process.env.ADMIN_SESSION_SECRET, base = () => 'https://www.promisa.online', now = () => Date.now(), notify = null, waitUntil = () => {} }) {
  const sign = (hash, exp) => createHmac('sha256', String(secret() || '')).update(`meu-site:${hash}:${exp}`).digest('base64url');
  const session = hash => { const exp = now() + SESSION_MS; return `${exp}.${sign(hash, exp)}`; };
  const sessionOk = (hash, value) => {
    const [exp, mac] = String(value || '').split('.');
    if (!secret() || !/^\d{10,16}$/.test(exp || '') || Number(exp) < now()) return false;
    const want = Buffer.from(sign(hash, Number(exp))), got = Buffer.from(String(mac || ''));
    return want.length === got.length && timingSafeEqual(want, got);
  };
  const summary = (record, hash) => ({ hash, siteName: record.siteName, niche: record.draft?.niche || '', plan: record.draft?.plan || '', createdAt: record.createdAt, revoked: Boolean(record.revoked), lastSaveAt: record.lastSaveAt || 0, saves: record.totalSaves || 0, url: record.url || '' });

  // Publica o HTML do cliente no mesmo projeto da Cloudflare que o dono usa para esse site.
  async function publish(record, html) {
    const client = cloudflare();
    if (!client || !publishStore) return { published: false };
    const entry = await publishStore.get(record.siteId).catch(() => null);
    const project = entry?.project || projectNameFor(record.siteName, record.siteId);
    const site = { name: record.siteName, htmlPath: 'index.html', files: [{ path: 'index.html', type: 'text/html', data: html }] };
    const result = await client.deploy(project, site, entry?.project && entry.url ? { url: entry.url } : null);
    await publishStore.set(record.siteId, { project: result.project, url: result.url, lastDeploymentId: result.deploymentId, lastPublishedAt: now() });
    return { published: true, url: entry?.domain ? `https://${entry.domain}` : result.url };
  }

  return async function handler(req, res) {
    const json = (status, body) => { res.statusCode = status; res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.setHeader('Cache-Control', 'private, no-store'); res.setHeader('X-Robots-Tag', 'noindex'); res.end(JSON.stringify(body)); };
    try {
      if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return json(405, { error: 'Método não permitido.' }); }
      if (!sameOrigin(req)) return json(403, { error: 'Origem não permitida.' });
      if (!String(req.headers?.['content-type'] || '').toLowerCase().startsWith('application/json')) return json(415, { error: 'Formato inválido.' });
      const read = await readBody(req);
      if (read.tooLarge) return json(413, { error: 'Fotos grandes demais. Use menos fotos ou fotos menores.' });
      if (read.bad || !read.value || typeof read.value !== 'object' || Array.isArray(read.value)) return json(400, { error: 'Dados inválidos.' });
      const body = read.value, action = String(body.action || '');

      // ---------- dono ----------
      if (action.startsWith('admin-')) {
        if (!await authorized(req)) return json(401, { error: 'Sua sessão terminou. Entre novamente.' });
        if (!secret()) return json(503, { error: 'Falta ADMIN_SESSION_SECRET na Vercel.' });
        if (action === 'admin-list') return json(200, { ok: true, sites: (await store.readIndex()).sites });
        if (action === 'admin-create' && body.siteId === undefined) body.siteId = 'cli-' + randomBytes(6).toString('hex'); // acesso criado do zero (sem site no cadastro)
        if (!validSiteId(body.siteId)) return json(400, { error: 'Site inválido.' });
        const index = await store.readIndex(), current = index.sites[body.siteId];
        if (action === 'admin-get') {
          const record = current ? await store.getRecord(current.hash) : null;
          return json(200, { ok: true, access: current || null, draft: record?.draft || null });
        }
        if (action === 'admin-plan') {
          if (!current) return json(404, { error: 'Este site não tem acesso de cliente.' });
          if (!PLANS[body.plan]) return json(400, { error: 'Plano inválido.' });
          const record = await store.getRecord(current.hash);
          if (!record) return json(404, { error: 'Acesso não encontrado.' });
          const next = { ...record, draft: { ...record.draft, plan: body.plan } };
          await store.putRecord(current.hash, next);
          await store.updateIndex(idx => { if (idx.sites[body.siteId]) idx.sites[body.siteId] = { ...idx.sites[body.siteId], plan: body.plan }; return idx; });
          return json(200, { ok: true });
        }
        if (action === 'admin-revoke') {
          if (!current) return json(404, { error: 'Este site não tem acesso de cliente.' });
          const record = await store.getRecord(current.hash);
          if (record) await store.putRecord(current.hash, { ...record, revoked: true, revokedAt: now() });
          await store.updateIndex(idx => { if (idx.sites[body.siteId]) idx.sites[body.siteId] = { ...idx.sites[body.siteId], revoked: true }; return idx; });
          return json(200, { ok: true });
        }
        if (action === 'admin-create') {
          const siteName = String(body.siteName || 'Site').slice(0, 80);
          // Começa do rascunho que o dono mandou ou, se já havia acesso, do que o cliente já editou.
          const previous = current ? await store.getRecord(current.hash) : null;
          // Rascunho: o que o dono mandou, ou o que o cliente já editou, ou o modelo do ramo/plano escolhido.
          const fresh = { ...newDraft(NICHES[body.niche] ? body.niche : 'barbearia', PLANS[body.plan] ? body.plan : 'profissional'), name: siteName, ...(String(body.whatsapp || '').replace(/\D/g, '').length >= 10 ? { whatsapp: String(body.whatsapp).slice(0, 20) } : {}) };
          const draft = cleanDraft(body.draft && typeof body.draft === 'object' ? body.draft : previous?.draft || fresh);
          if (previous) await store.putRecord(current.hash, { ...previous, revoked: true, revokedAt: now() });
          const token = randomBytes(24).toString('base64url'), code = String(randomInt(0, 1_000_000)).padStart(6, '0'), salt = randomBytes(16).toString('hex'), hash = tokenHash(token);
          const record = { version: 1, siteId: body.siteId, siteName, salt, codeHash: hashCode(code, salt), createdAt: now(), revoked: false, fails: 0, lockUntil: 0, draft, lastSaveAt: 0, totalSaves: previous?.totalSaves || 0, saves: { day: '', count: 0 }, url: previous?.url || '' };
          await store.putRecord(hash, record);
          await store.updateIndex(idx => { idx.sites[body.siteId] = summary(record, hash); return idx; });
          return json(200, { ok: true, link: `${base()}/meu-site/${token}`, code });
        }
        return json(400, { error: 'Ação desconhecida.' });
      }

      // ---------- cliente ----------
      if (!['login', 'save'].includes(action)) return json(400, { error: 'Ação desconhecida.' });
      if (!validToken(body.token)) return json(404, { error: GENERIC });
      const hash = tokenHash(body.token);
      const record = await store.getRecord(hash);
      if (!record || record.revoked) return json(404, { error: GENERIC });

      if (action === 'login') {
        if (record.lockUntil > now()) return json(429, { error: `Muitas tentativas. Tente de novo em ${Math.ceil((record.lockUntil - now()) / 60000)} min.` });
        if (!/^\d{6}$/.test(String(body.code || '')) || !sameHex(hashCode(body.code, record.salt), record.codeHash)) {
          const fails = (record.fails || 0) + 1;
          await store.putRecord(hash, { ...record, fails: fails >= MAX_FAILS ? 0 : fails, lockUntil: fails >= MAX_FAILS ? now() + LOCK_MS : 0 });
          return json(401, { error: fails >= MAX_FAILS ? 'Muitas tentativas. Tente de novo em 15 min.' : `Código incorreto. Restam ${MAX_FAILS - fails} tentativas.` });
        }
        if (record.fails) await store.putRecord(hash, { ...record, fails: 0, lockUntil: 0 });
        return json(200, { ok: true, session: session(hash), siteName: record.siteName, draft: record.draft, url: record.url || '', lastSaveAt: record.lastSaveAt || 0 });
      }

      // save
      if (!sessionOk(hash, body.session)) return json(401, { error: 'Sua sessão terminou. Digite o código de novo.', code: 'session' });
      const today = dayOf(now()), count = record.saves?.day === today ? record.saves.count : 0;
      if (count >= MAX_SAVES_PER_DAY) return json(429, { error: 'Limite de salvamentos de hoje atingido. Tente amanhã.' });
      const draft = cleanDraft(body.draft, { niche: record.draft?.niche, plan: record.draft?.plan }); // cliente não troca ramo nem plano
      if (!draft.name.trim()) return json(422, { error: 'Preencha o nome do negócio.' });
      const html = renderSite(draft);
      let out = { published: false };
      try { out = await publish(record, html); }
      catch (error) {
        await store.putRecord(hash, { ...record, draft, saves: { day: today, count: count + 1 } });
        return json(502, { error: 'Salvei suas alterações, mas não consegui publicar agora. Tente de novo em alguns minutos.', saved: true });
      }
      const next = { ...record, draft, lastSaveAt: now(), totalSaves: (record.totalSaves || 0) + 1, saves: { day: today, count: count + 1 }, url: out.url || record.url || '' };
      await store.putRecord(hash, next);
      await store.updateIndex(idx => { if (idx.sites[record.siteId]?.hash === hash) idx.sites[record.siteId] = summary(next, hash); return idx; });
      if (notify) waitUntil(Promise.resolve().then(() => notify({ name: draft.name, url: next.url })).catch(() => {}));
      return json(200, { ok: true, published: out.published, url: next.url, lastSaveAt: next.lastSaveAt });
    } catch (error) {
      try { console.error('[meu-site]', error?.name || 'erro'); } catch { /* sem log */ }
      return json(error?.status === 503 ? 503 : 500, { error: 'Não foi possível concluir agora. Tente novamente.' });
    }
  };
}
