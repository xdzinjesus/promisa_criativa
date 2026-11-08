import { randomBytes, createHmac, timingSafeEqual } from 'node:crypto';
import * as blob from '@vercel/blob';
import { isBlobError, readWithEtag } from './blob-utils.js';
import { MIN_DURATION_MS, MAX_DURATION_MS } from './share-store.js';
import { validId } from '../src/data-validation.js';

// Formulário de briefing: o cliente abre um link com código aleatório e responde uma vez.
// O índice e as respostas ficam no Blob privado; só as APIs do servidor leem e gravam.
//
// Proteção da cota do Blob: o código é ASSINADO (HMAC) e carrega a data de criação e a de
// validade. A rota pública confere a assinatura e a validade sem tocar no Blob, então códigos
// inventados, vencidos ou já apagados nunca geram leitura.
export const BRIEFINGS = 'promisa/v1/briefings.json';
export const ANSWERS_PREFIX = 'promisa/v1/briefing-answers/';
export const answersPath = token => ANSWERS_PREFIX + token + '.json';
// 24 bytes: criação (4, segundos) + validade (4, segundos) + aleatório (10) + assinatura (6).
export const TOKEN = /^[A-Za-z0-9_-]{32}$/;
const KEEP_MS = 60 * 24 * 60 * 60 * 1000;
const MAX_ITEMS = 1000;
const TAG_BYTES = 6;

export class BriefingError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const tagFor = (secret, payload) => createHmac('sha256', 'promisa-briefing-token-v1:' + secret).update(payload).digest().subarray(0, TAG_BYTES);

export function newToken(secret, createdAt, expiresAt) {
  if (!secret) throw new BriefingError(503, 'O formulário não está configurado no servidor.');
  const payload = Buffer.alloc(18);
  payload.writeUInt32BE(Math.floor(createdAt / 1000), 0);
  payload.writeUInt32BE(Math.floor(expiresAt / 1000), 4);
  randomBytes(10).copy(payload, 8);
  return Buffer.concat([payload, tagFor(secret, payload)]).toString('base64url');
}

// Confere a assinatura. Devolve { createdAt, expiresAt } (ms) ou null. Não acessa o Blob.
export function readToken(secret, token) {
  if (!secret || typeof token !== 'string' || !TOKEN.test(token)) return null;
  const raw = Buffer.from(token, 'base64url');
  if (raw.length !== 24) return null;
  const payload = raw.subarray(0, 18), tag = raw.subarray(18);
  if (!timingSafeEqual(tag, tagFor(secret, payload))) return null;
  return { createdAt: payload.readUInt32BE(0) * 1000, expiresAt: payload.readUInt32BE(4) * 1000 };
}

// answered > revoked > expired > open
export function briefingState(item, now = Date.now()) {
  if (!item) return 'missing';
  if (item.answeredAt) return 'answered';
  if (item.revokedAt) return 'revoked';
  return item.expiresAt <= now ? 'expired' : 'open';
}

// Limpa links sem resposta que expiraram/foram desativados há mais de 60 dias. Respostas ficam.
// Acima do limite, descarta primeiro os mais antigos SEM resposta.
export function pruneBriefings(items, now = Date.now()) {
  const kept = items.filter(item => item.answeredAt || !((item.revokedAt && Date.parse(item.revokedAt) < now - KEEP_MS) || item.expiresAt < now - KEEP_MS));
  let extra = kept.length - MAX_ITEMS;
  if (extra <= 0) return kept;
  const drop = new Set();
  for (const item of kept) if (extra > 0 && !item.answeredAt) { drop.add(item); extra--; }
  return kept.filter(item => !drop.has(item)).slice(-MAX_ITEMS);
}

const conflictError = error => isBlobError(error, 'BlobPreconditionFailedError') || /already exists|precondition/i.test(error?.message || '');

export function createBriefingStore({
  get = blob.get, head = blob.head, put = blob.put, del = blob.del,
  token = () => process.env.BLOB_READ_WRITE_TOKEN,
  secret = () => process.env.BRIEFING_SECRET || token(),
  now = () => Date.now(),
  cacheMs = 15 * 60_000, retryMs = 5_000, errorMs = 30_000, skewMs = 60_000
} = {}) {
  const options = () => ({ token: token() });

  async function load() {
    const read = await readWithEtag(BRIEFINGS, options(), { get, head });
    if (!read) return { index: { version: 1, items: [] }, etag: null };
    if (read.result.blob?.size > 2 * 1024 * 1024) { await read.result.stream?.cancel?.().catch?.(() => {}); throw new Error('Índice de formulários inválido.'); }
    const index = await new Response(read.result.stream).json();
    if (index?.version !== 1 || !Array.isArray(index.items)) throw new Error('Índice de formulários inválido.');
    return { index, etag: read.etag };
  }

  async function update(change, preloaded = null) {
    for (let attempt = 0; attempt < 4; attempt++) {
      const { index, etag } = attempt === 0 && preloaded ? preloaded : await load();
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

  // ---- leitura pública (rota sem login) ----
  // Uma leitura por vez (leituras simultâneas compartilham a mesma busca), cópia reaproveitada,
  // pausa após falha e lembrança local de códigos respondidos/indisponíveis.
  let cache = null, pending = null, failure = null;
  const local = new Map(); // token -> 'answered' | 'gone'
  const remember = (tokenValue, state) => {
    if (local.size >= 5000) local.delete(local.keys().next().value);
    local.set(tokenValue, state);
  };
  async function all() {
    const result = await get(BRIEFINGS, { ...options(), access: 'private', useCache: false });
    if (!result?.stream) return [];
    if (result.blob?.size > 2 * 1024 * 1024) { await result.stream.cancel?.().catch?.(() => {}); throw new Error('Índice de formulários inválido.'); }
    const index = await new Response(result.stream).json();
    return index?.version === 1 && Array.isArray(index.items) ? index.items : [];
  }
  function refresh() {
    if (pending) return pending;
    if (failure && failure.until > now()) return Promise.reject(failure.error);
    const startedAt = now();
    pending = all()
      .then(items => { cache = { items, startedAt }; failure = null; return cache; })
      .catch(error => { failure = { error, until: now() + errorMs }; throw error; })
      .finally(() => { pending = null; });
    return pending;
  }
  const verify = tokenValue => readToken(secret(), tokenValue);

  return {
    verify,
    async create(leadId, expiresAt) {
      if (!validId(leadId)) throw new BriefingError(400, 'Cliente inválido.');
      const at = now();
      if (!Number.isSafeInteger(expiresAt) || expiresAt < at + MIN_DURATION_MS || expiresAt > at + MAX_DURATION_MS) {
        throw new BriefingError(400, 'Escolha uma validade entre 5 minutos e 1 ano.');
      }
      const tokenValue = newToken(secret(), at, expiresAt);
      const item = { token: tokenValue, leadId: String(leadId), createdAt: at, expiresAt: Math.floor(expiresAt / 1000) * 1000 };
      return update(items => ({ items: [...items, item], result: item }));
    },
    async list() {
      const at = now();
      // Uma única leitura (sem ETag): o painel só exibe.
      return (await all()).map(item => ({ token: item.token, leadId: item.leadId, createdAt: item.createdAt, expiresAt: item.expiresAt, answeredAt: item.answeredAt || null, state: briefingState(item, at) }));
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
    // LGPD: apaga as respostas e os links de um cliente. Apagar no Blob não consome cota.
    async deleteLead(leadId) {
      if (!validId(leadId)) throw new BriefingError(400, 'Cliente inválido.');
      const id = String(leadId);
      const { index, etag } = await load();
      const tokens = index.items.filter(item => String(item.leadId) === id).map(item => item.token).filter(value => TOKEN.test(String(value)));
      if (!tokens.length) return { ok: true, removed: 0 };
      // Primeiro as respostas: se o índice falhar depois, basta repetir.
      await del(tokens.map(answersPath), options());
      const removed = await update(items => {
        const rest = items.filter(item => String(item.leadId) !== id);
        return { items: rest, result: items.length - rest.length };
      }, { index, etag });
      for (const value of tokens) remember(value, 'gone');
      return { ok: true, removed };
    },
    // Busca pública: devolve o item do índice ou null. Só lê o Blob para códigos assinados,
    // dentro da validade, quando a cópia guardada é antiga ou anterior à criação do código.
    async find(tokenValue) {
      const meta = verify(tokenValue);
      if (!meta) return null;
      const at = now();
      if (meta.expiresAt <= at) return { token: tokenValue, createdAt: meta.createdAt, expiresAt: meta.expiresAt };
      const known = local.get(tokenValue);
      if (known === 'gone') return null;
      if (known === 'answered') return { token: tokenValue, createdAt: meta.createdAt, expiresAt: meta.expiresAt, answeredAt: true };
      const lookup = current => current.items.find(item => item.token === tokenValue) || null;
      if (cache && at - cache.startedAt < cacheMs) {
        const item = lookup(cache);
        if (item) return item;
        // A cópia foi lida depois da criação do código: ele não existe mais (apagado/limpo).
        if (cache.startedAt >= meta.createdAt + skewMs) return null;
        if (at - cache.startedAt < retryMs) return null;
      }
      return lookup(await refresh());
    },
    // Grava as respostas (uma vez por código) e marca o formulário como respondido.
    // `answers` já deve estar validada.
    async submit(tokenValue, answers) {
      if (!TOKEN.test(String(tokenValue))) throw new BriefingError(400, 'Link inválido.');
      if (local.get(tokenValue) === 'busy') throw new BriefingError(429, 'Seu envio já está em andamento. Aguarde alguns segundos.');
      const previous = local.get(tokenValue);
      local.set(tokenValue, 'busy');
      let outcome = previous;
      try {
        const loaded = await load(); // leitura nova: confirma o estado antes de gravar
        const item = loaded.index.items.find(entry => entry.token === tokenValue);
        const state = briefingState(item, now());
        if (state === 'answered') { outcome = 'answered'; throw new BriefingError(409, 'Este formulário já foi respondido.'); }
        if (state !== 'open') { outcome = 'gone'; throw new BriefingError(404, 'Este link não está mais disponível.'); }
        const answeredAt = new Date(now()).toISOString();
        const markAnswered = preloaded => update(items => {
          const entry = items.find(candidate => candidate.token === tokenValue);
          if (!entry) throw new BriefingError(404, 'Este link não está mais disponível.');
          if (!entry.answeredAt) entry.answeredAt = answeredAt;
          return { items, result: true };
        }, preloaded);
        try {
          await put(answersPath(tokenValue), JSON.stringify({ version: 1, token: tokenValue, leadId: item.leadId, answeredAt, answers }), {
            ...options(), access: 'private', contentType: 'application/json', addRandomSuffix: false, allowOverwrite: false
          });
        } catch (error) {
          if (!conflictError(error)) throw error;
          // Recupera um envio anterior que parou no meio. Se o índice falhar de novo, não
          // lembra localmente: a próxima tentativa refaz a recuperação.
          if (await markAnswered().then(() => true, () => false)) outcome = 'answered';
          throw new BriefingError(409, 'Este formulário já foi respondido.');
        }
        await markAnswered(loaded);
        outcome = 'answered';
        return { ok: true };
      } finally {
        if (outcome) remember(tokenValue, outcome); else local.delete(tokenValue);
      }
    }
  };
}
