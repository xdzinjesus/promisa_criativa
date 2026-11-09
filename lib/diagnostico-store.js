import { randomBytes } from 'node:crypto';
import * as blob from '@vercel/blob';
import { isBlobError, readWithEtag } from './blob-utils.js';

// Relatórios do "Diagnóstico grátis". Cada relatório é um arquivo privado no Blob
// (promisa/diagnostics/v1/<código>.json); um índice pequeno guarda o resumo para a lista do painel.
// O link público carrega só um código aleatório de 128 bits.
export const PREFIX = 'promisa/diagnostics/v1/';
export const INDEX = PREFIX + 'index.json';
export const TOKEN = /^[A-Za-z0-9_-]{22}$/;
export const reportPath = token => PREFIX + token + '.json';
export const TTL_MS = 90 * 24 * 60 * 60 * 1000;
export const MAX_REPORTS = 200;
const MAX_REPORT_BYTES = 256 * 1024;

export class DiagnosticoError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
export const newToken = () => randomBytes(16).toString('base64url');

const summary = report => ({
  token: report.token, siteUrl: report.siteUrl, host: report.host, leadId: report.leadId || '', leadName: report.leadName || '',
  createdAt: report.createdAt, expiresAt: report.expiresAt, score: report.score,
  counts: { bom: 0, atencao: 0, ruim: 0, ...Object.fromEntries(['bom', 'atencao', 'ruim'].map(status => [status, report.items.filter(item => item.status === status).length])) },
  hasDemo: Boolean(report.demoUrl)
});
const conflictError = error => isBlobError(error, 'BlobPreconditionFailedError') || /already exists|precondition/i.test(error?.message || '');

// Em desenvolvimento (sem token do Blob e fora da Vercel), guarda em memória.
export function createDiagnosticoStore({
  get = blob.get, head = blob.head, put = blob.put, del = blob.del,
  token = () => process.env.BLOB_READ_WRITE_TOKEN,
  memory = () => !token() && !process.env.VERCEL,
  now = () => Date.now(), cacheMs = 60_000, missMs = 30_000, indexRefreshMs = 10_000
} = {}) {
  const options = () => ({ token: token() });
  const mem = { index: [], reports: new Map() };
  const cache = new Map(); // token -> { value, expires } (value null = não existe)
  const remember = (key, value, ms) => {
    if (cache.size >= 500) cache.delete(cache.keys().next().value);
    cache.set(key, { value, expires: now() + ms });
  };
  // Códigos existentes (do índice), para que links inventados não gerem leituras no Blob:
  // um código desconhecido só faz o índice ser relido no máximo a cada indexRefreshMs.
  let known = null, knownPending = null;
  const setKnown = items => { known = { tokens: new Set(items.map(item => item.token)), at: now() }; };
  const refreshKnown = () => knownPending ??= loadIndex().then(({ items }) => setKnown(items)).finally(() => { knownPending = null; });
  const ensureConfigured = () => {
    if (!memory() && !token()) throw new DiagnosticoError(503, 'Conecte um Vercel Blob privado ao projeto para guardar os diagnósticos.');
  };

  async function loadIndex() {
    const read = await readWithEtag(INDEX, options(), { get, head });
    if (!read) return { items: [], etag: null };
    if (read.result.blob?.size > 1024 * 1024) { await read.result.stream?.cancel?.().catch?.(() => {}); throw new Error('Índice de diagnósticos inválido.'); }
    const data = await new Response(read.result.stream).json();
    if (data?.version !== 1 || !Array.isArray(data.items)) throw new Error('Índice de diagnósticos inválido.');
    return { items: data.items, etag: read.etag };
  }

  async function updateIndex(change) {
    for (let attempt = 0; attempt < 4; attempt++) {
      const { items, etag } = await loadIndex();
      const next = change(items.map(item => ({ ...item })));
      try {
        await put(INDEX, JSON.stringify({ version: 1, items: next.items }), {
          ...options(), access: 'private', contentType: 'application/json', addRandomSuffix: false,
          ...(etag ? { allowOverwrite: true, ifMatch: etag } : { allowOverwrite: false }), cacheControlMaxAge: 60
        });
        setKnown(next.items);
        return next;
      } catch (error) { if (!conflictError(error)) throw error; }
    }
    throw new DiagnosticoError(409, 'Outra alteração estava em andamento. Tente novamente.');
  }

  const expired = (item, at) => item.expiresAt <= at;

  return {
    async create(data) {
      ensureConfigured();
      const at = now();
      const report = { version: 1, token: newToken(), createdAt: at, expiresAt: at + TTL_MS, ...data };
      const body = JSON.stringify(report);
      if (Buffer.byteLength(body) > MAX_REPORT_BYTES) throw new DiagnosticoError(413, 'Relatório grande demais.');
      const tooMany = new DiagnosticoError(409, `Você já tem ${MAX_REPORTS} diagnósticos guardados. Apague alguns antigos para criar outro.`);
      if (memory()) {
        mem.index = mem.index.filter(item => !expired(item, at));
        if (mem.index.length >= MAX_REPORTS) throw tooMany;
        mem.reports.set(report.token, report); mem.index.push(summary(report));
        return report;
      }
      await put(reportPath(report.token), body, { ...options(), access: 'private', contentType: 'application/json', addRandomSuffix: false, allowOverwrite: false, cacheControlMaxAge: 60 });
      const dropped = [];
      try {
        await updateIndex(items => {
          const alive = items.filter(item => { const keep = !expired(item, at); if (!keep) dropped.push(item.token); return keep; });
          if (alive.length >= MAX_REPORTS) { dropped.length = 0; throw tooMany; }
          return { items: [...alive, summary(report)] };
        });
      } catch (error) {
        await del(reportPath(report.token), options()).catch(() => {});
        throw error;
      }
      if (dropped.length) await del(dropped.map(reportPath), options()).catch(() => {});
      return report;
    },

    async list() {
      ensureConfigured();
      const at = now();
      const items = memory() ? mem.index : (await loadIndex()).items;
      return items.filter(item => !expired(item, at)).sort((a, b) => b.createdAt - a.createdAt);
    },

    async remove(tokenValue) {
      ensureConfigured();
      if (!TOKEN.test(String(tokenValue))) throw new DiagnosticoError(400, 'Link inválido.');
      cache.delete(tokenValue);
      if (memory()) {
        if (!mem.index.some(item => item.token === tokenValue)) throw new DiagnosticoError(404, 'Diagnóstico não encontrado.');
        mem.index = mem.index.filter(item => item.token !== tokenValue); mem.reports.delete(tokenValue);
        return { ok: true };
      }
      let found = false;
      await updateIndex(items => { found = items.some(item => item.token === tokenValue); return { items: items.filter(item => item.token !== tokenValue) }; });
      if (!found) throw new DiagnosticoError(404, 'Diagnóstico não encontrado.');
      await del(reportPath(tokenValue), options()).catch(() => {});
      return { ok: true };
    },

    // Leitura pública. Devolve { state: 'ok' | 'expired' | 'missing', report }.
    async find(tokenValue) {
      if (!TOKEN.test(String(tokenValue))) return { state: 'missing' };
      const at = now();
      const hit = cache.get(tokenValue);
      let report;
      if (hit && hit.expires > at) report = hit.value;
      else {
        report = null;
        if (memory()) report = mem.reports.get(tokenValue) || null;
        else if (token()) {
          if (!known || (!known.tokens.has(tokenValue) && now() - known.at >= indexRefreshMs)) await refreshKnown();
        }
        if (!memory() && token() && known?.tokens.has(tokenValue)) {
          const result = await get(reportPath(tokenValue), { ...options(), access: 'private', useCache: false }).catch(error => {
            if (isBlobError(error, 'BlobNotFoundError')) return null;
            throw error;
          });
          if (result?.stream) {
            if (result.blob?.size > MAX_REPORT_BYTES * 2) { await result.stream.cancel?.().catch?.(() => {}); }
            else {
              const data = await new Response(result.stream).json();
              if (data?.version === 1 && data.token === tokenValue && Array.isArray(data.items)) report = data;
            }
          }
        }
        if (report || known?.tokens.has(tokenValue)) remember(tokenValue, report, report ? cacheMs : missMs); // códigos inventados não ocupam o cache
      }
      if (!report) return { state: 'missing' };
      return report.expiresAt <= at ? { state: 'expired' } : { state: 'ok', report };
    }
  };
}
