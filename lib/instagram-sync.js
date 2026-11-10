import { createInstagramClient, createTokenManager, InstagramError } from './instagram.js';
import { createInstagramStore, MAX_DAILY, MAX_POSTS } from './instagram-store.js';
import { dayKey, DAY_MS } from '../src/instagram-math.js';

// Atualização do Instagram: 1 chamada "me" + 1 lista de posts + métricas dos posts dos últimos 30 dias (no máximo 25),
// e uma única gravação no histórico. Nunca lança erro por falha do Instagram: devolve { ok:false, code }.
export const INSIGHT_DAYS = 30, MAX_INSIGHT_POSTS = 25, BATCH = 5;
export const MANUAL_GAP_MS = 10 * 60_000;
export const BUDGET_MS = 25_000; // cabe no cron (60 s) junto com o resumo do Discord

const FIELD = { reach: 'reach', views: 'views', saved: 'saved', shares: 'shares', total_interactions: 'interactions' };

// Junta o que veio do Instagram ao histórico (puro). Um registro por dia (BRT): a mesma data é atualizada.
export function mergeSync(history, { me, media, insights = {}, at }) {
  const today = dayKey(at), stamp = new Date(at).toISOString();
  const daily = history.daily.filter(item => item.date !== today);
  daily.push({ date: today, followers: me.followers, media: me.media });
  daily.sort((a, b) => a.date.localeCompare(b.date));
  const byId = new Map(history.posts.map(post => [post.id, post]));
  for (const item of media) {
    const old = byId.get(item.id) || {};
    const post = { ...old, ...item, updatedAt: stamp };
    for (const [metric, value] of Object.entries(insights[item.id] || {})) if (FIELD[metric]) post[FIELD[metric]] = value;
    byId.set(item.id, post);
  }
  const posts = [...byId.values()].sort((a, b) => b.timestamp.localeCompare(a.timestamp)).slice(0, MAX_POSTS);
  return {
    ...history, account: me, daily: daily.slice(-MAX_DAILY), posts,
    lastSync: stamp, lastError: null, failStreak: 0, lastFailDay: ''
  };
}

export function mergeFailure(history, { code, at, detail = '' }) {
  const today = dayKey(at);
  return {
    ...history,
    lastError: { at: new Date(at).toISOString(), code, message: code === 'token-invalid' ? 'O acesso ao Instagram expirou.' : code === 'rate-limited' ? 'O Instagram pediu para esperar um pouco.' : 'Não foi possível atualizar agora.', ...(detail ? { detail: String(detail).slice(0, 200) } : {}) },
    failStreak: history.lastFailDay === today ? history.failStreak : history.failStreak + 1, lastFailDay: today
  };
}

export function createInstagramService({
  store = createInstagramStore(), client = createInstagramClient(), env = process.env, now = () => Date.now(), log = console,
  tokens = createTokenManager({ client, store, env, now })
} = {}) {
  let running = null;

  async function run({ manual = false } = {}) {
    const started = now();
    let token, expiring = false;
    try {
      const ensured = await tokens.ensure();
      if (!ensured) return { ok: false, code: 'not-configured' };
      token = ensured.token; expiring = ensured.expiring;
      const me = await client.me(token);
      const media = await client.media(token, 25);
      const since = started - INSIGHT_DAYS * DAY_MS;
      const targets = media.filter(item => Date.parse(item.timestamp) >= since).slice(0, MAX_INSIGHT_POSTS);
      const insights = {}, skip = new Set();
      for (let index = 0; index < targets.length && now() - started < BUDGET_MS; index += BATCH) {
        // Cada lote roda em paralelo; o que um tipo de post não aceita é lembrado para os próximos.
        await Promise.all(targets.slice(index, index + BATCH).map(async item => {
          try { insights[item.id] = await client.insights(token, item.id, { skip, prefix: item.type + ':', stop: () => now() - started >= BUDGET_MS }); }
          catch (error) { if (error.tokenInvalid) throw error; /* só as métricas deste post ficam de fora */ }
        }));
      }
      const history = await store.update(current => ({ ...mergeSync(current, { me, media, insights, at: started }), ...(manual ? { lastManualAt: started } : {}) }));
      return { ok: true, history, expiring };
    } catch (error) {
      const code = error instanceof InstagramError ? error.code : 'error';
      if (!(error instanceof InstagramError)) log.error?.('[instagram] sync', error?.name || 'erro');
      let history = null;
      try { history = await store.update(current => ({ ...mergeFailure(current, { code, at: started, detail: error instanceof InstagramError ? error.detail : '' }), ...(manual ? { lastManualAt: started } : {}) })); } catch { /* sem Blob */ }
      return { ok: false, code, tokenInvalid: code === 'token-invalid', expiring, history, detail: error instanceof InstagramError ? (error.detail || error.message) : String(error?.name || 'erro') };
    }
  }

  return {
    configured: () => tokens.configured(),
    read: () => store.read(),
    store,
    // Duas chamadas ao mesmo tempo (ex.: cron e botão) dividem a mesma execução.
    sync: opts => running ??= run(opts).finally(() => { running = null; })
  };
}

export const instagramService = createInstagramService();
