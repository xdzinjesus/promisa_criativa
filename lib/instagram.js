import { createHash } from 'node:crypto';

// Cliente da API oficial "Instagram API with Instagram Login" (graph.instagram.com).
// Não precisa de Página do Facebook. O token NUNCA é registrado em log, devolvido ao painel ou postado no Discord:
// as mensagens de erro daqui não carregam a URL (que leva o token) nem o corpo da resposta.
// Endereços e campos seguem a documentação pública da Meta; a versão fica numa constante só.
export const GRAPH = 'https://graph.instagram.com';
export const API_VERSION = 'v23.0';
export const REFRESH_AFTER_MS = 45 * 24 * 60 * 60 * 1000;   // renova o token com mais de ~45 dias
export const EXPIRING_AFTER_MS = 50 * 24 * 60 * 60 * 1000;  // avisa se passou disso e não conseguiu renovar
export const INSIGHT_METRICS = ['reach', 'views', 'saved', 'shares', 'total_interactions'];
const ME_FIELDS = 'user_id,username,followers_count,follows_count,media_count';
const MEDIA_FIELDS = 'id,caption,media_type,media_product_type,permalink,timestamp,like_count,comments_count,thumbnail_url';

export class InstagramError extends Error {
  constructor(code, message, { status = 0, tokenInvalid = false, tooRecent = false } = {}) {
    super(message);
    this.name = 'InstagramError';
    this.code = code; this.status = status; this.tokenInvalid = tokenInvalid; this.tooRecent = tooRecent;
  }
}

// Token inválido ou expirado: código 190 da Meta (OAuthException) ou HTTP 401.
function classify(status, body) {
  const error = body?.error;
  const code = Number(error?.code);
  const tokenInvalid = code === 190 || status === 401 || error?.type === 'OAuthException' && [102, 190].includes(code);
  const tooRecent = /24 hours|at least 24|too recent/i.test(String(error?.message || ''));
  return new InstagramError(tokenInvalid ? 'token-invalid' : status === 429 || code === 4 || code === 17 || code === 32 ? 'rate-limited' : 'api-error',
    tokenInvalid ? 'O acesso ao Instagram expirou.' : 'O Instagram não respondeu como esperado.', { status, tokenInvalid, tooRecent });
}

export function createInstagramClient({ fetch: fetchFn = (...args) => globalThis.fetch(...args), version = API_VERSION, timeoutMs = 10_000 } = {}) {
  async function call(path, params, token, { versioned = true } = {}) {
    const url = new URL(`${GRAPH}${versioned ? '/' + version : ''}${path}`);
    for (const [key, value] of Object.entries(params || {})) url.searchParams.set(key, String(value));
    url.searchParams.set('access_token', token);
    let response;
    try { response = await fetchFn(url.toString(), { method: 'GET', headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(timeoutMs) }); }
    catch { throw new InstagramError('network', 'Não consegui falar com o Instagram.'); }
    let body = null;
    try { body = await response.json(); } catch { /* corpo ilegível */ }
    if (!response.ok || body?.error) throw classify(response.status, body);
    if (!body || typeof body !== 'object') throw new InstagramError('api-error', 'Resposta inesperada do Instagram.', { status: response.status });
    return body;
  }

  const num = value => Number.isFinite(Number(value)) && value !== null && value !== '' ? Math.max(0, Math.round(Number(value))) : null;

  return {
    async me(token) {
      const body = await call('/me', { fields: ME_FIELDS }, token);
      const followers = num(body.followers_count);
      if (followers === null) throw new InstagramError('api-error', 'O Instagram não devolveu o número de seguidores.');
      return { username: String(body.username || '').slice(0, 60), followers, follows: num(body.follows_count) ?? 0, media: num(body.media_count) ?? 0 };
    },

    async media(token, limit = 25) {
      const body = await call('/me/media', { fields: MEDIA_FIELDS, limit }, token);
      return (Array.isArray(body.data) ? body.data : []).filter(item => item?.id && Number.isFinite(Date.parse(item.timestamp))).map(item => ({
        id: String(item.id),
        type: item.media_product_type === 'REELS' ? 'REELS' : item.media_type === 'CAROUSEL_ALBUM' ? 'CAROUSEL' : item.media_type === 'VIDEO' ? 'VIDEO' : 'IMAGE',
        permalink: /^https:\/\/(www\.)?instagram\.com\//.test(item.permalink || '') ? item.permalink : '',
        timestamp: new Date(item.timestamp).toISOString(),
        caption: String(item.caption || '').replace(/\s+/g, ' ').trim().slice(0, 140),
        likes: num(item.like_count) ?? 0, comments: num(item.comments_count) ?? 0
      }));
    },

    // Alcance, visualizações, salvamentos, compartilhamentos e interações de um post.
    // Cada tipo de post aceita um conjunto diferente: se o pedido completo falhar, pede uma métrica de cada vez
    // e guarda só o que veio. `skip` (Set) lembra métricas que o tipo não aceita, para não repetir o erro.
    async insights(token, id, { skip = new Set(), prefix = '' } = {}) {
      const wanted = INSIGHT_METRICS.filter(metric => !skip.has(prefix + metric));
      const out = {};
      const read = body => {
        for (const entry of Array.isArray(body.data) ? body.data : []) {
          const value = num(entry?.values?.[0]?.value ?? entry?.total_value?.value);
          if (entry?.name && value !== null) out[entry.name] = value;
        }
      };
      if (!wanted.length) return out;
      try { read(await call(`/${encodeURIComponent(id)}/insights`, { metric: wanted.join(',') }, token)); return out; }
      catch (error) { if (error.tokenInvalid || error.code === 'network' || error.code === 'rate-limited') throw error; }
      for (const metric of wanted) {
        try { read(await call(`/${encodeURIComponent(id)}/insights`, { metric }, token)); }
        catch (error) { if (error.tokenInvalid || error.code === 'network' || error.code === 'rate-limited') throw error; skip.add(prefix + metric); }
      }
      return out;
    },

    // Troca o token por um novo de 60 dias. O token precisa ter pelo menos 24 h.
    async refresh(token) {
      const body = await call('/refresh_access_token', { grant_type: 'ig_refresh_token' }, token, { versioned: false });
      if (typeof body.access_token !== 'string' || body.access_token.length < 20) throw new InstagramError('api-error', 'O Instagram não devolveu o token renovado.');
      return { token: body.access_token, expiresIn: Number(body.expires_in) || 0 };
    }
  };
}

export const fingerprint = token => createHash('sha256').update(String(token)).digest('hex').slice(0, 16);

// Guarda e renova o token. Fonte inicial: variável INSTAGRAM_TOKEN da Vercel. O token renovado fica no Blob privado
// (promisa/instagram/v1/token.json) e vale enquanto a variável não for trocada (se o dono colocar um token novo na
// Vercel, a impressão digital muda e o token novo passa a valer).
export function createTokenManager({ client, store, env = process.env, now = () => Date.now() } = {}) {
  const envToken = () => String(env.INSTAGRAM_TOKEN || '').trim();
  const configured = () => envToken().length > 0;

  async function resolve() {
    const fromEnv = envToken();
    if (!fromEnv) return null;
    let saved = null;
    try { saved = await store.readToken(); } catch { /* sem Blob: usa a variável */ }
    if (saved && typeof saved.token === 'string' && saved.token && saved.envFp === fingerprint(fromEnv)) return { token: saved.token, refreshedAt: Number(saved.refreshedAt) || 0, envToken: fromEnv, fromBlob: true };
    return { token: fromEnv, refreshedAt: 0, envToken: fromEnv, fromBlob: false };
  }

  // Renova se o token (do Blob) tem mais de 45 dias, ou se ainda nunca foi renovado por aqui.
  // Devolve { token, refreshed, expiring }. Falha de renovação não derruba a atualização (a menos que o token seja inválido).
  async function ensure() {
    const current = await resolve();
    if (!current) return null;
    const age = current.refreshedAt ? now() - current.refreshedAt : Infinity;
    if (age < REFRESH_AFTER_MS) return { token: current.token, refreshed: false, expiring: false };
    try {
      const fresh = await client.refresh(current.token);
      try { await store.writeToken({ token: fresh.token, refreshedAt: now(), envFp: fingerprint(current.envToken) }); } catch { /* usa o novo token nesta execução */ }
      return { token: fresh.token, refreshed: true, expiring: false };
    } catch (error) {
      if (error.tokenInvalid) throw error;
      // Menos de 24 h de vida (tooRecent) ou erro passageiro: segue com o token atual e tenta de novo no próximo ciclo.
      return { token: current.token, refreshed: false, expiring: Boolean(current.refreshedAt) && age >= EXPIRING_AFTER_MS && !error.tooRecent };
    }
  }

  return { configured, ensure };
}
