import test from 'node:test';
import assert from 'node:assert/strict';
import { createPixelHandler, tokenOk } from '../api/pixel.js';
import { createPixelStore, AGENDA_PATH, CACHE_MS } from '../lib/pixel-store.js';
import { loginNext } from '../api/access.js';
import { sealAgenda, newPixelKey } from '../src/agenda.js';
import { validateSetting, validateRecord } from '../src/data-validation.js';

const SECRET = 'p'.repeat(40);
function res() { const r = { headers: {}, statusCode: 0, body: '', setHeader(k, v) { this.headers[k.toLowerCase()] = v; }, end(b) { this.body = b || ''; } }; return r; }
const call = async (handler, { method = 'GET', auth = 'Bearer ' + SECRET, action = 'agenda', etag } = {}) => {
  const r = res(); await handler({ method, url: '/api/pixel?action=' + action, query: { action }, headers: { authorization: auth, ...(etag ? { 'if-none-match': etag } : {}) } }, r); return r;
};

test('rota do Pixel: só GET, exige o token, desligada sem PIXEL_TOKEN', async () => {
  const store = { read: async () => null };
  assert.equal((await call(createPixelHandler({ store, secret: () => '' }))).statusCode, 503);
  const h = createPixelHandler({ store, secret: () => SECRET });
  assert.equal((await call(h, { method: 'POST' })).statusCode, 405);
  assert.equal((await call(h, { auth: 'Bearer errado' })).statusCode, 401);
  assert.equal((await call(h, { auth: '' })).statusCode, 401);
  assert.equal((await call(h, { action: 'tudo' })).statusCode, 404);
  assert.match((await call(h)).body, /ainda não foi gerada/);
  assert.equal(tokenOk('Bearer curto', 'curto'), false, 'segredo curto nunca vale');
});

test('rota do Pixel: devolve o envelope criptografado com ETag e responde 304 sem mudança', async () => {
  const envelope = await sealAgenda({ version: 1, items: [] }, newPixelKey(), '2026-11-17T17:00:00.000Z');
  const h = createPixelHandler({ store: { read: async () => envelope }, secret: () => SECRET });
  const first = await call(h);
  assert.equal(first.statusCode, 200); assert.deepEqual(JSON.parse(first.body), envelope); assert.ok(first.headers.etag);
  assert.equal(first.headers['cache-control'], 'no-store');
  assert.equal((await call(h, { etag: first.headers.etag })).statusCode, 304);
});

test('armazenamento da agenda: lê o Blob no máximo 1 vez a cada 5 min e rejeita envelope inválido', async () => {
  let reads = 0, puts = 0, t = 0;
  const envelope = await sealAgenda({ version: 1, items: [] }, newPixelKey(), '2026-11-17T17:00:00.000Z');
  const store = createPixelStore({ token: () => 'tok', now: () => t,
    get: async path => { reads++; assert.equal(path, AGENDA_PATH); return { stream: new Response(JSON.stringify(envelope)).body }; },
    put: async (path, body, opts) => { puts++; assert.equal(opts.access, 'private'); assert.equal(opts.addRandomSuffix, false); } });
  await store.read(); await store.read(); assert.equal(reads, 1);
  t += CACHE_MS + 1; await store.read(); assert.equal(reads, 2);
  await assert.rejects(store.write({ v: 1 }), /inválida/); assert.equal(puts, 0);
  await store.write(envelope); assert.equal(puts, 1); await store.read(); assert.equal(reads, 2, 'depois de gravar, lê da memória');
});

test('login volta para a ficha pedida; só aceita /admin com cliente válido', () => {
  assert.equal(loginNext('admin', { url: '/api/access?view=admin&tab=clients&cliente=abc123&aba=entregas', query: { view: 'admin', tab: 'clients', cliente: 'abc123', aba: 'entregas' } }), '?next=' + encodeURIComponent('/admin?tab=clients&cliente=abc123&aba=entregas'));
  assert.equal(loginNext('admin', { url: '/x', query: { cliente: 'a b<script>' } }), '');
  assert.equal(loginNext('catalogo', { url: '/x', query: { cliente: 'abc' } }), '');
  assert.equal(loginNext('admin', { url: '/x', query: { cliente: 'abc', aba: 'https://mal' } }), '?next=' + encodeURIComponent('/admin?tab=clients&cliente=abc'));
});

test('validação: prazo AAAA-MM-DD e chave do Pixel', () => {
  assert.equal(validateRecord('sales', { id: 'x', client: 'A', prazo: '2026-11-20' }).prazo, '2026-11-20');
  assert.throws(() => validateRecord('sales', { id: 'x', client: 'A', prazo: '20/11/2026' }), /Prazo/);
  assert.equal(validateSetting('pixelKey', newPixelKey()).length, 44);
  assert.throws(() => validateSetting('pixelKey', 'abc'), /Pixel/);
});
