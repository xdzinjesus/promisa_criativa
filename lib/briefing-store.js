import { randomBytes } from 'node:crypto';
import * as blob from '@vercel/blob';
import { isBlobError, readWithEtag } from './blob-utils.js';
import { TOKEN, MIN_DURATION_MS, MAX_DURATION_MS } from './share-store.js';
import { validId } from '../src/data-validation.js';

// Formulário de briefing: o cliente abre um link com código aleatório de 128 bits e responde uma vez.
// O índice e as respostas ficam no Blob privado; só as APIs do servidor leem e gravam.
export const BRIEFINGS = 'promisa/v1/briefings.json';
export const ANSWERS_PREFIX = 'promisa/v1/briefing-answers/';
export const answersPath = token => ANSWERS_PREFIX + token + '.json';
export { TOKEN };
const KEEP_MS = 60 * 24 * 60 * 60 * 1000;
const MAX_ITEMS = 1000;

export class BriefingError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
export const newToken = () => randomBytes(16).toString('base64url');

// answered > revoked > expired > open
export function briefingState(item, now = Date.now()) {
  if (!item) return 'missing';
  if (item.answeredAt) return 'answered';
  if (item.revokedAt) return 'revoked';
  return item.expiresAt <= now ? 'expired' : 'open';
}

// Limpa links sem resposta que expiraram/foram desativados há mais de 60 dias. Respostas ficam.
export function pruneBriefings(items, now = Date.now()) {
  return items
    .filter(item => item.answeredAt || !((item.revokedAt && Date.parse(item.revokedAt) < now - KEEP_MS) || item.expiresAt < now - KEEP_MS))
    .slice(-MAX_ITEMS);
}

const conflictError = error => isBlobError(error, 'BlobPreconditionFailedError') || /already exists|precondition/i.test(error?.message || '');

export function createBriefingStore({ get = blob.get, head = blob.head, put = blob.put, token = () => process.env.BLOB_READ_WRITE_TOKEN, now = () => Date.now(), cacheMs = 20_000 } = {}) {
  const options = () => ({ token: token() });
  let cache = null;

  async function load() {
    const read = await readWithEtag(BRIEFINGS, options(), { get, head });
    if (!read) return { index: { version: 1, items: [] }, etag: null };
    if (read.result.blob?.size > 2 * 1024 * 1024) throw new Error('Índice de formulários inválido.');
    const index = await new Response(read.result.stream).json();
    if (index?.version !== 1 || !Array.isArray(index.items)) throw new Error('Índice de formulários inválido.');
    return { index, etag: read.etag };
  }

  async function update(change) {
    for (let attempt = 0; attempt < 4; attempt++) {
      const { index, etag } = await load();
      const { items, result } = change(index.items.map(item => ({ ...item })));
      const next = { version: 1, items: pruneBriefings(items, now()) };
      try {
        await put(BRIEFINGS, JSON.stringify(next), {
          ...options(), access: 'private', contentType: 'application/json', addRandomSuffix: false,
          ...(etag ? { allowOverwrite: true, ifMatch: etag } : { allowOverwrite: false }), cacheControlMaxAge: 60
        });
        cache = null;
        return result;
      } catch (error) {
        if (!conflictError(error)) throw error;
      }
    }
    throw new BriefingError(409, 'Outra alteração estava em andamento. Tente novamente.');
  }

  const publicItem = (item, at) => ({ token: item.token, leadId: item.leadId, createdAt: item.createdAt, expiresAt: item.expiresAt, answeredAt: item.answeredAt || null, state: briefingState(item, at) });

  return {
    async create(leadId, expiresAt) {
      if (!validId(leadId)) throw new BriefingError(400, 'Cliente inválido.');
      const at = now();
      if (!Number.isSafeInteger(expiresAt) || expiresAt < at + MIN_DURATION_MS || expiresAt > at + MAX_DURATION_MS) {
        throw new BriefingError(400, 'Escolha uma validade entre 5 minutos e 1 ano.');
      }
      const item = { token: newToken(), leadId: String(leadId), createdAt: at, expiresAt };
      return update(items => ({ items: [...items, item], result: item }));
    },
    async list() {
      const at = now();
      const { index } = await load();
      return index.items.map(item => publicItem(item, at));
    },
    async revoke(tokenValue) {
      if (!TOKEN.test(String(tokenValue))) throw new BriefingError(400, 'Link inválido.');
      return update(items => {
        const item = items.find(entry => entry.token === tokenValue);
        if (!item) throw new BriefingError(404, 'Link não encontrado.');
        if (!item.answeredAt) item.revokedAt = new Date(now()).toISOString();
        return { items, result: { ok: true } };
      });
    },
    async getAnswers(tokenValue) {
      if (!TOKEN.test(String(tokenValue))) throw new BriefingError(400, 'Link inválido.');
      const result = await get(answersPath(tokenValue), { ...options(), access: 'private', useCache: false });
      if (!result?.stream) throw new BriefingError(404, 'Este formulário ainda não foi respondido.');
      if (result.blob?.size > 256 * 1024) { await result.stream.cancel().catch(() => {}); throw new Error('Respostas inválidas.'); }
      const data = await new Response(result.stream).json();
      if (data?.version !== 1 || data.token !== tokenValue) throw new Error('Respostas inválidas.');
      return { answers: data.answers, answeredAt: data.answeredAt, leadId: data.leadId };
    },
    // Leitura pública do índice: uma operação, sem ETag.
    async all() {
      const result = await get(BRIEFINGS, { ...options(), access: 'private', useCache: false });
      if (!result?.stream) return [];
      const index = await new Response(result.stream).json();
      return index?.version === 1 && Array.isArray(index.items) ? index.items : [];
    },
    async find(tokenValue) {
      if (!TOKEN.test(String(tokenValue))) return null;
      if (!cache || cache.expires < now()) cache = { items: await this.all(), expires: now() + cacheMs };
      return cache.items.find(item => item.token === tokenValue) || null;
    },
    // Grava as respostas (uma vez por código) e marca o formulário como respondido.
    // `answers` já deve estar validada.
    async submit(tokenValue, answers) {
      if (!TOKEN.test(String(tokenValue))) throw new BriefingError(400, 'Link inválido.');
      const { index } = await load(); // leitura nova: confirma o estado antes de gravar
      const item = index.items.find(entry => entry.token === tokenValue);
      const state = briefingState(item, now());
      if (state === 'answered') throw new BriefingError(409, 'Este formulário já foi respondido.');
      if (state !== 'open') throw new BriefingError(404, 'Este link não está mais disponível.');
      const answeredAt = new Date(now()).toISOString();
      const markAnswered = () => update(items => {
        const entry = items.find(candidate => candidate.token === tokenValue);
        if (!entry) throw new BriefingError(404, 'Este link não está mais disponível.');
        if (!entry.answeredAt) entry.answeredAt = answeredAt;
        return { items, result: true };
      });
      try {
        await put(answersPath(tokenValue), JSON.stringify({ version: 1, token: tokenValue, leadId: item.leadId, answeredAt, answers }), {
          ...options(), access: 'private', contentType: 'application/json', addRandomSuffix: false, allowOverwrite: false
        });
      } catch (error) {
        if (!conflictError(error)) throw error;
        await markAnswered().catch(() => {}); // recupera um envio anterior que parou no meio
        throw new BriefingError(409, 'Este formulário já foi respondido.');
      }
      await markAnswered();
      return { ok: true };
    }
  };
}
