import * as blob from '@vercel/blob';
import { isBlobError, readWithEtag } from './blob-utils.js';
import { validDay, validMonth } from '../src/instagram-math.js';

// Histórico do Instagram (promisa/instagram/v1/history.json) e token renovado (promisa/instagram/v1/token.json),
// ambos no Blob PRIVADO. O token nunca sai daqui: o painel e o Discord só recebem o histórico.
export const PREFIX = 'promisa/instagram/v1/';
export const HISTORY = PREFIX + 'history.json';
export const TOKEN_PATH = PREFIX + 'token.json';
export const MAX_DAILY = 400, MAX_POSTS = 60, MAX_MONTHS = 24;
const MAX_BYTES = 512 * 1024;

export class InstagramStoreError extends Error { constructor(status, message) { super(message); this.status = status; } }

const int = (value, min, max) => Number.isSafeInteger(value) && value >= min && value <= max;
const optInt = value => Number.isFinite(value) && value >= 0 ? Math.round(value) : undefined;

export const emptyHistory = () => ({
  version: 1, account: null, daily: [], posts: [], goals: { followers: null, clientsPerMonth: null }, clientsByMonth: {},
  alerts: {}, failStreak: 0, lastFailDay: '', lastWeekly: '', lastManualAt: 0, lastSync: null, lastError: null
});

// Aceita só o formato conhecido (descarta o resto) e aplica os limites.
export function normalizeHistory(raw) {
  const base = emptyHistory();
  if (!raw || typeof raw !== 'object' || raw.version !== 1) return base;
  const text = (value, max) => typeof value === 'string' ? value.slice(0, max) : '';
  const account = raw.account && typeof raw.account === 'object' ? { username: text(raw.account.username, 60), followers: optInt(raw.account.followers) ?? 0, follows: optInt(raw.account.follows) ?? 0, media: optInt(raw.account.media) ?? 0 } : null;
  const daily = (Array.isArray(raw.daily) ? raw.daily : []).filter(item => validDay(item?.date) && Number.isFinite(item.followers)).map(item => ({ date: item.date, followers: Math.round(item.followers), media: optInt(item.media) ?? 0 }))
    .sort((a, b) => a.date.localeCompare(b.date)).slice(-MAX_DAILY);
  const posts = (Array.isArray(raw.posts) ? raw.posts : []).filter(item => item && typeof item.id === 'string' && item.id && Number.isFinite(Date.parse(item.timestamp))).map(item => {
    const post = { id: item.id.slice(0, 64), type: ['REELS', 'CAROUSEL', 'VIDEO', 'IMAGE'].includes(item.type) ? item.type : 'IMAGE', permalink: /^https:\/\/(www\.)?instagram\.com\//.test(item.permalink || '') ? item.permalink : '', timestamp: new Date(item.timestamp).toISOString(), caption: text(item.caption, 140), likes: optInt(item.likes) ?? 0, comments: optInt(item.comments) ?? 0, updatedAt: text(item.updatedAt, 40) };
    for (const key of ['reach', 'views', 'saved', 'shares', 'interactions']) if (optInt(item[key]) !== undefined) post[key] = optInt(item[key]);
    return post;
  }).sort((a, b) => b.timestamp.localeCompare(a.timestamp)).slice(0, MAX_POSTS);
  const goals = { followers: null, clientsPerMonth: null };
  const f = raw.goals?.followers;
  if (f && int(f.target, 1, 1e8) && validDay(f.deadline)) goals.followers = { target: f.target, deadline: f.deadline };
  const c = raw.goals?.clientsPerMonth;
  if (c && int(c.target, 0, 1000)) goals.clientsPerMonth = { target: c.target };
  const clientsByMonth = {};
  for (const month of Object.keys(raw.clientsByMonth || {}).filter(validMonth).sort().slice(-MAX_MONTHS)) {
    const item = raw.clientsByMonth[month];
    if (int(item?.leads, 0, 100000) && int(item?.clients, 0, 100000)) clientsByMonth[month] = { leads: item.leads, clients: item.clients, updatedAt: text(item.updatedAt, 40) };
  }
  const alerts = {};
  for (const key of ['token', 'sync', 'expiring']) if (validDay(raw.alerts?.[key])) alerts[key] = raw.alerts[key];
  const lastError = raw.lastError && typeof raw.lastError === 'object' ? { at: text(raw.lastError.at, 40), code: text(raw.lastError.code, 40), message: text(raw.lastError.message, 200), ...(raw.lastError.detail ? { detail: text(raw.lastError.detail, 200) } : {}) } : null;
  return {
    ...base, account, daily, posts, goals, clientsByMonth, alerts,
    failStreak: int(raw.failStreak, 0, 1000) ? raw.failStreak : 0, lastFailDay: validDay(raw.lastFailDay) ? raw.lastFailDay : '',
    lastWeekly: validDay(raw.lastWeekly) ? raw.lastWeekly : '', lastManualAt: Number.isFinite(raw.lastManualAt) ? raw.lastManualAt : 0,
    lastSync: typeof raw.lastSync === 'string' ? raw.lastSync.slice(0, 40) : null, lastError
  };
}

const conflictError = error => isBlobError(error, 'BlobPreconditionFailedError') || /already exists|precondition/i.test(error?.message || '');

// Em desenvolvimento (sem token do Blob e fora da Vercel), guarda em memória.
export function createInstagramStore({
  get = blob.get, head = blob.head, put = blob.put,
  token = () => process.env.BLOB_READ_WRITE_TOKEN,
  memory = () => !token() && !process.env.VERCEL
} = {}) {
  const options = () => ({ token: token() });
  const mem = { history: null, token: null };
  const ensureConfigured = () => { if (!memory() && !token()) throw new InstagramStoreError(503, 'Conecte um Vercel Blob privado ao projeto para guardar o histórico do Instagram.'); };

  async function parse(read) {
    if (read.result.blob?.size > MAX_BYTES) { await read.result.stream?.cancel?.().catch?.(() => {}); throw new Error('Histórico do Instagram inválido.'); }
    return normalizeHistory(await new Response(read.result.stream).json());
  }

  return {
    // Leitura simples (1 leitura no Blob), para painel e Discord.
    async read() {
      ensureConfigured();
      if (memory()) return structuredClone(mem.history || emptyHistory());
      let result;
      try { result = await get(HISTORY, { ...options(), access: 'private', useCache: false }); }
      catch (error) { if (isBlobError(error, 'BlobNotFoundError')) return emptyHistory(); throw error; }
      if (!result?.stream) return emptyHistory();
      return parse({ result });
    },

    // Lê, aplica `change(history)` e grava com ifMatch (se alguém gravou no meio, tenta de novo).
    async update(change) {
      ensureConfigured();
      if (memory()) {
        const next = normalizeHistory(await change(structuredClone(mem.history || emptyHistory())));
        mem.history = next;
        return structuredClone(next);
      }
      for (let attempt = 0; attempt < 4; attempt++) {
        const read = await readWithEtag(HISTORY, options(), { get, head });
        const current = read ? await parse(read) : emptyHistory();
        const next = normalizeHistory(await change(current));
        const body = JSON.stringify(next);
        if (Buffer.byteLength(body) > MAX_BYTES) throw new InstagramStoreError(413, 'Histórico do Instagram grande demais.');
        try {
          await put(HISTORY, body, { ...options(), access: 'private', contentType: 'application/json', addRandomSuffix: false, ...(read ? { allowOverwrite: true, ifMatch: read.etag } : { allowOverwrite: false }), cacheControlMaxAge: 60 });
          return next;
        } catch (error) { if (!conflictError(error)) throw error; }
      }
      throw new InstagramStoreError(409, 'Outra atualização estava em andamento. Tente novamente.');
    },

    async readToken() {
      ensureConfigured();
      if (memory()) return mem.token ? { ...mem.token } : null;
      let result;
      try { result = await get(TOKEN_PATH, { ...options(), access: 'private', useCache: false }); }
      catch (error) { if (isBlobError(error, 'BlobNotFoundError')) return null; throw error; }
      if (!result?.stream) return null;
      if (result.blob?.size > 4096) { await result.stream.cancel?.().catch?.(() => {}); return null; }
      const data = await new Response(result.stream).json();
      return data && typeof data.token === 'string' && typeof data.envFp === 'string' && Number.isFinite(data.refreshedAt) ? { token: data.token, refreshedAt: data.refreshedAt, envFp: data.envFp } : null;
    },

    async writeToken({ token: value, refreshedAt, envFp }) {
      ensureConfigured();
      if (memory()) { mem.token = { token: value, refreshedAt, envFp }; return; }
      await put(TOKEN_PATH, JSON.stringify({ token: value, refreshedAt, envFp }), { ...options(), access: 'private', contentType: 'application/json', addRandomSuffix: false, allowOverwrite: true, cacheControlMaxAge: 0 });
    }
  };
}
