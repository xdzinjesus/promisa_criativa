import { createHmac, randomBytes, randomInt, scryptSync, timingSafeEqual } from 'node:crypto';
import { tokenHash } from './client-access-store.js';
import { cleanDraft, renderSite, newDraft, NICHES, PLANS } from '../src/client-site-templates.js';
import { projectNameFor } from './cloudflare-pages.js';

// /api/meu-site: o cliente edita SÓ o site dele; o dono controla tudo.
//  Cliente (link secreto + código de 6 números): login, load, save (salva e publica na Cloudflare).
//  Dono (sessão do painel): admin-create, admin-list, admin-get, admin-plan, admin-niche, admin-revoke.
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

export function createClientAccessHandler({ siteData = null, store, publishStore = null, cloudflare = () => null, authorized, sameOrigin, secret = () => process.env.ADMIN_SESSION_SECRET, base = () => 'https://www.promisa.online', now = () => Date.now(), notify = null, waitUntil = () => {} }) {
  const sign = (hash, exp) => createHmac('sha256', String(secret() || '')).update(`meu-site:${hash}:${exp}`).digest('base64url');
  const session = hash => { const exp = now() + SESSION_MS; return `${exp}.${sign(hash, exp)}`; };
  const sessionOk = (hash, value) => {
    const [exp, mac] = String(value || '').split('.');
    if (!secret() || !/^\d{10,16}$/.test(exp || '') || Number(exp) < now()) return false;
    const want = Buffer.from(sign(hash, Number(exp))), got = Buffer.from(String(mac || ''));
    return want.length === got.length && timingSafeEqual(want, got);
  };
  const summary = (record, hash) => ({ hash, siteName: record.siteName, niche: record.draft?.niche || '', plan: record.draft?.plan || '', allowNiche: Boolean(record.allowNiche), createdAt: record.createdAt, revoked: Boolean(record.revoked), lastSaveAt: record.lastSaveAt || 0, saves: record.totalSaves || 0, url: record.url || '' });

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

  // Ramo travado, a menos que o dono tenha liberado "o cliente escolhe o ramo" para este acesso.
  const lockedNiche = r => r?.allowNiche ? undefined : r?.draft?.niche;
  return async function handler(req, res) {
    const json = (status, body) => { res.statusCode = status; res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.setHeader('Cache-Control', 'private, no-store'); res.setHeader('X-Robots-Tag', 'noindex'); res.end(JSON.stringify(body)); };
    try {
      // "Dados ao vivo": o próprio site do cliente (outro endereço) publica com a senha do site. Só essa ação aceita
      // outra origem (CORS aberto, sem cookies); todas as outras exigem a mesma origem do painel.
      const cors = () => { res.setHeader('Access-Control-Allow-Origin', '*'); res.setHeader('Access-Control-Allow-Methods', 'POST'); res.setHeader('Access-Control-Allow-Headers', 'Content-Type'); res.setHeader('Access-Control-Max-Age', '86400'); };
      if (req.method === 'OPTIONS') { cors(); res.statusCode = 204; return res.end(); }
      if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return json(405, { error: 'Método não permitido.' }); }
      if (!String(req.headers?.['content-type'] || '').toLowerCase().startsWith('application/json')) return json(415, { error: 'Formato inválido.' });
      const read = await readBody(req);
      if (read.tooLarge) return json(413, { error: 'Fotos grandes demais. Use menos fotos ou fotos menores.' });
      if (read.bad || !read.value || typeof read.value !== 'object' || Array.isArray(read.value)) return json(400, { error: 'Dados inválidos.' });
      const body = read.value, action = String(body.action || '');
      if (action === 'site-data-save') {
        cors();
        if (!siteData) return json(503, { error: 'Indisponível.' });
        const [status, out] = await siteData.publicSave(body);
        return json(status, out);
      }
      if (!sameOrigin(req)) return json(403, { error: 'Origem não permitida.' });
      if (action.startsWith('admin-data-')) {
        if (!await authorized(req)) return json(401, { error: 'Sua sessão terminou. Entre novamente.' });
        if (!siteData) return json(503, { error: 'Indisponível.' });
        const [status, out] = await siteData.admin(action, body);
        return json(status, out);
      }

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
        if (action === 'admin-niche') {
          if (!current) return json(404, { error: 'Este site não tem acesso de cliente.' });
          const allow = body.allow === true;
          const done = await store.updateRecord(current.hash, r => r ? { ...r, allowNiche: allow } : null);
          if (!done.changed) return json(404, { error: 'Acesso não encontrado.' });
          await store.updateIndex(idx => { if (idx.sites[body.siteId]) idx.sites[body.siteId] = { ...idx.sites[body.siteId], allowNiche: allow }; return idx; });
          return json(200, { ok: true });
        }
        if (action === 'admin-plan') {
          if (!current) return json(404, { error: 'Este site não tem acesso de cliente.' });
          if (!PLANS[body.plan]) return json(400, { error: 'Plano inválido.' });
          const done = await store.updateRecord(current.hash, r => r ? { ...r, draft: { ...r.draft, plan: body.plan } } : null);
          if (!done.changed) return json(404, { error: 'Acesso não encontrado.' });
          await store.updateIndex(idx => { if (idx.sites[body.siteId]) idx.sites[body.siteId] = { ...idx.sites[body.siteId], plan: body.plan }; return idx; });
          return json(200, { ok: true });
        }
        if (action === 'admin-revoke') {
          if (!current) return json(404, { error: 'Este site não tem acesso de cliente.' });
          await store.updateRecord(current.hash, r => r ? { ...r, revoked: true, revokedAt: now() } : null);
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
          if (previous) await store.updateRecord(current.hash, r => r ? { ...r, revoked: true, revokedAt: now() } : null);
          const token = randomBytes(24).toString('base64url'), code = String(randomInt(0, 1_000_000)).padStart(6, '0'), salt = randomBytes(16).toString('hex'), hash = tokenHash(token);
          const record = { version: 1, siteId: body.siteId, siteName, salt, codeHash: hashCode(code, salt), createdAt: now(), allowNiche: body.allowNiche === undefined ? Boolean(previous?.allowNiche) : body.allowNiche === true, revoked: false, fails: 0, lockUntil: 0, draft, lastSaveAt: 0, totalSaves: previous?.totalSaves || 0, saves: { day: '', count: 0 }, url: previous?.url || '' };
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
      const BUSY = 'Muitos pedidos ao mesmo tempo. Espere alguns segundos e tente de novo.';
      // Toda mudança no acesso usa gravação com trava de versão (updateRecord): pedidos simultâneos não se atropelam,
      // não furam o bloqueio nem a cota, e um acesso cortado no meio de um salvamento continua cortado.
      const guarded = async change => { try { return await store.updateRecord(hash, change); } catch (error) { if (error?.code === 'busy') return { busy: true }; throw error; } };

      if (action === 'login') {
        // 1) Reserva a tentativa ANTES de conferir o código (conta mesmo com vários pedidos ao mesmo tempo).
        const at = now();
        const reserved = await guarded(r => {
          if (!r || r.revoked || r.lockUntil > at) return null;
          const fails = (r.lockUntil && r.lockUntil <= at ? 0 : r.fails || 0) + 1;
          return { ...r, fails, lockUntil: fails >= MAX_FAILS ? at + LOCK_MS : 0 };
        });
        if (reserved.busy) return json(429, { error: BUSY });
        const record = reserved.record;
        if (!record || record.revoked) return json(404, { error: GENERIC });
        if (!reserved.changed) return json(429, { error: `Muitas tentativas. Tente de novo em ${Math.max(1, Math.ceil((record.lockUntil - at) / 60000))} min.` });
        // 2) Confere o código.
        if (!/^\d{6}$/.test(String(body.code || '')) || !sameHex(hashCode(body.code, record.salt), record.codeHash)) {
          return json(401, { error: record.lockUntil > at ? 'Muitas tentativas. Tente de novo em 15 min.' : `Código incorreto. Restam ${MAX_FAILS - record.fails} tentativas.` });
        }
        // 3) Acertou: zera o contador (sem reativar um acesso cortado no meio do caminho).
        const cleared = await guarded(r => r && !r.revoked ? { ...r, fails: 0, lockUntil: 0 } : null);
        if (cleared.busy) return json(429, { error: BUSY });
        if (!cleared.changed) return json(404, { error: GENERIC });
        const ok = cleared.record;
        return json(200, { ok: true, session: session(hash), siteName: ok.siteName, draft: ok.draft, allowNiche: Boolean(ok.allowNiche), url: ok.url || '', lastSaveAt: ok.lastSaveAt || 0 });
      }

      // save
      if (!sessionOk(hash, body.session)) return json(401, { error: 'Sua sessão terminou. Digite o código de novo.', code: 'session' });
      if (!String(body.draft?.name || '').trim()) return json(422, { error: 'Preencha o nome do negócio.' });
      // Reserva o salvamento na cota do dia ANTES de publicar.
      const today = dayOf(now());
      const quota = await guarded(r => {
        if (!r || r.revoked) return null;
        const count = r.saves?.day === today ? r.saves.count : 0;
        return count >= MAX_SAVES_PER_DAY ? null : { ...r, saves: { day: today, count: count + 1 } };
      });
      if (quota.busy) return json(429, { error: BUSY });
      const record = quota.record;
      if (!record || record.revoked) return json(404, { error: GENERIC });
      if (!quota.changed) return json(429, { error: 'Limite de salvamentos de hoje atingido. Tente amanhã.' });
      const draft = cleanDraft(body.draft, { niche: lockedNiche(record), plan: record.draft?.plan }); // cliente não troca o plano; o ramo só se o dono liberou
      const html = renderSite(draft);
      let out = { published: false };
      try { out = await publish(record, html); }
      catch (error) {
        const kept = await guarded(r => r && !r.revoked ? { ...r, draft: cleanDraft(draft, { niche: lockedNiche(r), plan: r.draft?.plan }) } : null); // plano/ramo atuais (o dono pode ter trocado no meio)
        const saved = Boolean(kept.changed);
        return json(502, { error: saved ? 'Salvei suas alterações, mas não consegui publicar agora. Tente de novo em alguns minutos.' : 'Não consegui publicar nem guardar agora. Suas alterações continuam na tela: tente "Salvar e publicar" de novo em alguns minutos.', saved });
      }
      const at = now();
      const finished = await guarded(r => r && !r.revoked ? { ...r, draft: cleanDraft(draft, { niche: lockedNiche(r), plan: r.draft?.plan }), lastSaveAt: at, totalSaves: (r.totalSaves || 0) + 1, url: out.url || r.url || '' } : null);
      // Só confirma se o rascunho foi mesmo guardado (muito movimento = pede para tentar de novo, sem mentir).
      if (finished.busy) return json(503, { error: 'Seu site foi publicado, mas não consegui guardar as alterações no editor. Suas alterações continuam na tela: toque em "Salvar e publicar" de novo.', published: out.published, saved: false });
      if (!finished.changed) return json(404, { error: GENERIC });
      const next = finished.record;
      if (finished.changed) {
        await store.updateIndex(idx => { if (idx.sites[record.siteId]?.hash === hash) idx.sites[record.siteId] = summary(next, hash); return idx; });
        if (notify) waitUntil(Promise.resolve().then(() => notify({ name: draft.name, url: next.url })).catch(() => {}));
      }
      return json(200, { ok: true, published: out.published, url: out.url || record.url || '', lastSaveAt: at });
    } catch (error) {
      try { console.error('[meu-site]', error?.name || 'erro'); } catch { /* sem log */ }
      return json(error?.status === 503 ? 503 : 500, { error: 'Não foi possível concluir agora. Tente novamente.' });
    }
  };
}
