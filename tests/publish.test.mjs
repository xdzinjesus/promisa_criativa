import test from 'node:test';
import assert from 'node:assert/strict';
import { blake3 } from '@noble/hashes/blake3.js';
import {
  fileHash, hashBase64, projectNameFor, validProjectName, validateDomain, DomainError, prepareFiles,
  createCloudflare, CloudflareError, configured, MAX_FILE_BYTES, DEFAULT_HEADERS_FILE
} from '../lib/cloudflare-pages.js';
import { createPublishStore, INDEX, MAX_ITEMS } from '../lib/publish-store.js';
import { createPublishHandler, NOT_CONFIGURED } from '../lib/publish-handler.js';
import { sameOrigin } from '../api/access.js';

const TOKEN = 'cf-secret-token-ZZZ-0123456789';
const ACCOUNT = 'a'.repeat(32);
const NOW = Date.UTC(2026, 5, 1);
const b64 = text => Buffer.from(text).toString('base64');

// ---------- Hash ----------
test('hash: BLAKE3 correto e igual ao algoritmo do wrangler (base64 + extensão, 32 hex)', () => {
  // Vetor oficial do BLAKE3 para entrada vazia.
  assert.equal(Buffer.from(blake3(new Uint8Array())).toString('hex'), 'af1349b9f5f9a1a6a0404dea36dcc9499bcb25c9adc112b7cc9a93cae41f3262');
  // Arquivo vazio sem extensão: blake3('') cortado em 32 caracteres.
  assert.equal(fileHash(Buffer.alloc(0), 'LICENSE'), 'af1349b9f5f9a1a6a0404dea36dcc949');
  // Com conteúdo: blake3(base64 + extensão).
  const body = Buffer.from('<h1>Olá</h1>');
  const expected = Buffer.from(blake3(new TextEncoder().encode(body.toString('base64') + 'html'))).toString('hex').slice(0, 32);
  assert.equal(fileHash(body, 'index.html'), expected);
  assert.equal(fileHash(body, 'pasta/index.html'), expected);
  assert.equal(hashBase64(body.toString('base64'), 'html'), expected);
  assert.notEqual(fileHash(body, 'index.htm'), expected); // a extensão entra no hash
  assert.equal(expected.length, 32);
});

// ---------- Nomes ----------
test('nome do projeto: minúsculas, hífens, até 58 caracteres e sufixo do id', () => {
  assert.equal(projectNameFor('Chico Móveis', 'ab12'), 'promisa-chico-moveis-ab12');
  assert.equal(projectNameFor('Site da Promisa', 'x-9z8y7w'), 'promisa-site-da-promisa-9z8y'.replace('9z8y', '8y7w'));
  const long = projectNameFor('A'.repeat(200), 'abcdef1234');
  assert.ok(long.length <= 58 && validProjectName(long), long);
  assert.ok(validProjectName(projectNameFor('!!!', '1')));
  assert.equal(validProjectName('Maiúscula'), false);
  assert.equal(validProjectName('-x'), false);
});

// ---------- Domínio ----------
test('domínio: normaliza (www, https, maiúsculas, IDN) e rejeita lixo', () => {
  assert.deepEqual(validateDomain('ChicoMoveis.com.br'), { apex: 'chicomoveis.com.br', www: 'www.chicomoveis.com.br' });
  assert.deepEqual(validateDomain('www.chicomoveis.com.br'), { apex: 'chicomoveis.com.br', www: 'www.chicomoveis.com.br' });
  assert.deepEqual(validateDomain(' https://WWW.Exemplo.com/pagina?x=1 '), { apex: 'exemplo.com', www: 'www.exemplo.com' });
  assert.equal(validateDomain('móveis-são.com.br').apex, 'xn--mveis-so-xza7m.com.br');
  for (const bad of ['', '   ', 'semponto', '127.0.0.1', '10.0.0.1', '2130706433', '[::1]', 'a b.com', 'user@x.com', 'x.com:8080', 'x..com', '-x.com', 'x-.com', 'localhost',
    'promisa.online', 'www.promisa.online', 'loja.promisa.online', 'meu.vercel.app', 'x.pages.dev', 'x.workers.dev', 'a.local', 'x.123', 'x.c', 'a.com\nb.com', 'https://', null, 5, {}, 'a'.repeat(250) + '.com', ('a'.repeat(64)) + '.com']) {
    assert.throws(() => validateDomain(bad), DomainError, String(bad));
  }
});

// ---------- Arquivos ----------
const site = (files, htmlPath = 'index.html', extra = {}) => ({ id: 'ab12', name: 'Chico Móveis', htmlPath, files: files.map(([path, data, type]) => ({ path, data, type: type || '' })), ...extra });

test('arquivos: raiz = pasta da página principal, index.html mapeado e _headers padrão', () => {
  const a = prepareFiles(site([['index.html', '<p>oi</p>'], ['css/a.css', 'body{}'], ['_headers', '/x\n  A: b\n'], ['_worker.js', 'x']]));
  assert.deepEqual(a.assets.map(x => x.urlPath).sort(), ['/css/a.css', '/index.html']);
  assert.equal(a.special._headers.toString(), '/x\n  A: b\n');
  assert.equal(a.special._worker, undefined);
  const b = prepareFiles(site([['loja/inicio.html', '<p>oi</p>'], ['loja/img/a.png', 'data:image/png;base64,AAAA'], ['outra/x.txt', 'fora']], 'loja/inicio.html'));
  assert.deepEqual(b.assets.map(x => x.urlPath).sort(), ['/img/a.png', '/index.html', '/inicio.html']);
  assert.equal(b.special._headers.toString(), DEFAULT_HEADERS_FILE);
  assert.match(DEFAULT_HEADERS_FILE, /nosniff/);
  assert.match(DEFAULT_HEADERS_FILE, /strict-origin-when-cross-origin/);
});

test('arquivos: recusa caminhos inseguros, arquivo > 25 MB, total grande e site incompleto', () => {
  for (const path of ['../x.html', '.env', 'a/.git/config', '/abs.html', 'a\\b.html', 'chave.pem']) {
    assert.throws(() => prepareFiles(site([['index.html', 'x'], [path, 'x']])), CloudflareError, path);
  }
  assert.throws(() => prepareFiles(site([['index.html', 'x'], ['big.bin', 'data:application/octet-stream;base64,' + Buffer.alloc(MAX_FILE_BYTES + 1).toString('base64')]])), /25 MB/);
  assert.throws(() => prepareFiles(site([['index.html', 'x']], 'outro.html')), /principal/);
  assert.throws(() => prepareFiles({ files: [] }), CloudflareError);
  assert.throws(() => prepareFiles(site(Array.from({ length: 1100 }, (_, i) => [`f${i}.txt`, 'x']).concat([['index.html', 'x']]))), /arquivos demais/);
});

// ---------- Cloudflare falsa ----------
function fakeCloudflare({ existingProject = false, already = new Set(), zones = [], records = [], failAt } = {}) {
  const log = [];
  const state = { stored: new Set(already), projects: new Map(existingProject ? [[existingProject, { name: existingProject, subdomain: existingProject + '.pages.dev' }]] : []), zones: [...zones], records: [...records], domains: [] };
  const ok = result => new Response(JSON.stringify({ success: true, errors: [], result }), { status: 200, headers: { 'content-type': 'application/json' } });
  const err = (status, code, message) => new Response(JSON.stringify({ success: false, errors: [{ code, message }], result: null }), { status, headers: { 'content-type': 'application/json' } });
  async function fetchImpl(url, init = {}) {
    const u = new URL(url); const path = u.pathname.replace('/client/v4', ''); const method = init.method || 'GET';
    const auth = init.headers?.Authorization;
    const entry = { method, path, query: Object.fromEntries(u.searchParams), auth, body: typeof init.body === 'string' ? JSON.parse(init.body) : init.body };
    log.push(entry);
    if (failAt && failAt(entry)) return err(500, 7000, 'boom');
    let m;
    if (method === 'POST' && path === `/accounts/${ACCOUNT}/pages/projects`) {
      if (state.projects.has(entry.body.name)) return err(409, 8000002, 'A project with this name already exists');
      const project = { name: entry.body.name, subdomain: entry.body.name + '.pages.dev' }; state.projects.set(project.name, project); return ok(project);
    }
    if (method === 'GET' && (m = new RegExp(`^/accounts/${ACCOUNT}/pages/projects/([^/]+)$`).exec(path))) return state.projects.has(m[1]) ? ok(state.projects.get(m[1])) : err(404, 8000007, 'not found');
    if (method === 'DELETE' && (m = new RegExp(`^/accounts/${ACCOUNT}/pages/projects/([^/]+)$`).exec(path))) { if (!state.projects.delete(m[1])) return err(404, 8000007, 'not found'); return ok(null); }
    if (path.endsWith('/upload-token')) return ok({ jwt: 'JWT-ABC' });
    if (path === '/pages/assets/check-missing') { assert.equal(auth, 'Bearer JWT-ABC'); return ok(entry.body.hashes.filter(h => !state.stored.has(h))); }
    if (path === '/pages/assets/upload') { assert.equal(auth, 'Bearer JWT-ABC'); for (const item of entry.body) state.stored.add(item.key); return ok({ successful_key_count: entry.body.length }); }
    if (path === '/pages/assets/upsert-hashes') return ok(null);
    if (method === 'POST' && path.endsWith('/deployments')) { entry.form = init.body; return ok({ id: 'dep-1', url: 'https://dep-1.x.pages.dev' }); }
    if (method === 'POST' && path.endsWith('/domains')) { state.domains.push(entry.body.name); return ok({ name: entry.body.name }); }
    if (method === 'GET' && path.endsWith('/domains')) return ok(state.domains.map(name => ({ name, status: 'pending', verification_data: { status: 'pending' }, validation_data: { status: 'initializing' } })));
    if (method === 'GET' && path === '/zones') return ok(state.zones.filter(z => z.name === u.searchParams.get('name')));
    if (method === 'POST' && path === '/zones') { const zone = { id: 'c'.repeat(32), name: entry.body.name, status: 'pending', name_servers: ['ada.ns.cloudflare.com', 'bob.ns.cloudflare.com'] }; state.zones.push(zone); return ok(zone); }
    if (method === 'GET' && (m = /^\/zones\/([a-z0-9]+)$/.exec(path))) return ok(state.zones.find(z => z.id === m[1]) || null);
    if (method === 'GET' && path.endsWith('/dns_records')) return ok(state.records);
    if (method === 'POST' && path.endsWith('/dns_records')) { state.records.push({ id: 'r' + state.records.length, ...entry.body }); return ok(entry.body); }
    if (method === 'PATCH' && (m = /\/dns_records\/(\w+)$/.exec(path))) { Object.assign(state.records.find(r => r.id === m[1]), entry.body); return ok(entry.body); }
    if (method === 'DELETE') throw new Error('nunca deve apagar: ' + path);
    return err(404, 7003, 'rota desconhecida ' + method + ' ' + path);
  }
  return { fetch: fetchImpl, log, state };
}
const client = fake => createCloudflare({ token: TOKEN, accountId: ACCOUNT, fetch: fake.fetch, retryDelayMs: 0 });
const sample = () => site([['index.html', '<h1>oi</h1>'], ['css/a.css', 'body{}'], ['img/a.png', 'data:image/png;base64,iVBORw0KGgo='], ['img/b.png', 'data:image/png;base64,iVBORw0KGgo=']]);

test('publicar: cria projeto, envia só o que falta, registra hashes e cria a publicação', async () => {
  const fake = fakeCloudflare();
  const cf = client(fake);
  const hashOf = (text, path) => fileHash(Buffer.from(text), path);
  fake.state.stored.add(hashOf('body{}', 'a.css')); // já existe na Cloudflare
  const result = await cf.deploy('promisa-chico-moveis-ab12', sample());
  assert.equal(result.url, 'https://promisa-chico-moveis-ab12.pages.dev');
  assert.equal(result.deploymentId, 'dep-1');
  const paths = fake.log.map(e => `${e.method} ${e.path}`);
  assert.deepEqual(paths.slice(0, 2), [`POST /accounts/${ACCOUNT}/pages/projects`, `GET /accounts/${ACCOUNT}/pages/projects/promisa-chico-moveis-ab12/upload-token`]);
  assert.equal(fake.log[0].auth, `Bearer ${TOKEN}`);
  assert.equal(fake.log[0].body.production_branch, 'main');
  const check = fake.log.find(e => e.path === '/pages/assets/check-missing');
  assert.equal(check.auth, 'Bearer JWT-ABC');
  assert.equal(check.body.hashes.length, 3); // as duas imagens iguais contam uma vez
  const uploads = fake.log.filter(e => e.path === '/pages/assets/upload').flatMap(e => e.body);
  assert.equal(uploads.length, 2); // o css já existia
  assert.ok(uploads.every(item => item.base64 === true && item.metadata.contentType && typeof item.value === 'string'));
  assert.ok(uploads.some(item => item.metadata.contentType === 'image/png'));
  assert.ok(!uploads.some(item => item.key === hashOf('body{}', 'a.css')));
  const upsert = fake.log.find(e => e.path === '/pages/assets/upsert-hashes');
  assert.equal(upsert.body.hashes.length, 3);
  const deployment = fake.log.at(-1);
  assert.equal(deployment.path, `/accounts/${ACCOUNT}/pages/projects/promisa-chico-moveis-ab12/deployments`);
  assert.ok(deployment.form instanceof FormData);
  const manifest = JSON.parse(deployment.form.get('manifest'));
  assert.deepEqual(Object.keys(manifest).sort(), ['/css/a.css', '/img/a.png', '/img/b.png', '/index.html']);
  assert.equal(manifest['/index.html'], hashOf('<h1>oi</h1>', 'index.html'));
  assert.equal(deployment.form.get('branch'), 'main');
  assert.match(await deployment.form.get('_headers').text(), /nosniff/);
  assert.ok(Object.keys(manifest).every(p => p.startsWith('/') && !p.includes('..')));
  assert.ok(!JSON.stringify(manifest).includes('_headers'));
});

test('publicar: projeto que já existe é reaproveitado; página principal com outro nome vira /index.html', async () => {
  const fake = fakeCloudflare({ existingProject: 'meu-proj' });
  await client(fake).deploy('meu-proj', site([['home.html', '<p>x</p>']], 'home.html'));
  assert.ok(fake.log.some(e => e.method === 'GET' && e.path.endsWith('/pages/projects/meu-proj')));
  const manifest = JSON.parse(fake.log.at(-1).form.get('manifest'));
  assert.deepEqual(Object.keys(manifest).sort(), ['/home.html', '/index.html']);
  assert.equal(manifest['/home.html'], manifest['/index.html']);
});

test('publicar: arquivos grandes são divididos em lotes de até ~10 MB', async () => {
  const fake = fakeCloudflare();
  const files = [['index.html', 'x']];
  for (let i = 0; i < 4; i++) files.push([`v${i}.bin`, 'data:application/octet-stream;base64,' + Buffer.alloc(4 * 1024 * 1024, i + 1).toString('base64')]);
  await client(fake).deploy('proj-grande', site(files));
  const uploads = fake.log.filter(e => e.path === '/pages/assets/upload');
  assert.ok(uploads.length >= 2);
  for (const upload of uploads) assert.ok(upload.body.reduce((n, item) => n + item.value.length, 0) <= 11 * 1024 * 1024 + 8);
});

test('erros da Cloudflare viram mensagens amigáveis, sem a chave', async () => {
  const fake = fakeCloudflare({ failAt: e => e.path.endsWith('/upload-token') });
  await assert.rejects(client(fake).deploy('proj', sample()), error => {
    assert.ok(error instanceof CloudflareError);
    assert.match(error.message, /Cloudflare/);
    assert.equal(error.code, '7000');
    assert.ok(!JSON.stringify([error.message, error.detail, error.code]).includes(TOKEN));
    return true;
  });
  const denied = { fetch: async () => new Response(JSON.stringify({ success: false, errors: [{ code: 10000, message: `Authentication error ${TOKEN}` }] }), { status: 403 }) };
  await assert.rejects(client(denied).ensureProject('proj'), error => { assert.match(error.message, /chave/); assert.ok(!error.detail.includes(TOKEN)); return true; });
  const hang = { fetch: (url, init) => new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(Object.assign(new Error('t'), { name: 'TimeoutError' })))) };
  const keepAlive = setTimeout(() => {}, 5000); // o timer do AbortSignal.timeout não mantém o processo vivo
  await assert.rejects(createCloudflare({ token: TOKEN, accountId: ACCOUNT, fetch: hang.fetch, timeoutMs: 20 }).ensureProject('proj'), /demorou demais/);
  clearTimeout(keepAlive);
  assert.throws(() => createCloudflare({ token: '', accountId: ACCOUNT }), /ainda não foi configurada/);
  assert.equal(configured({}), false);
  assert.equal(configured({ CLOUDFLARE_API_TOKEN: 'x', CLOUDFLARE_ACCOUNT_ID: ACCOUNT }), true);
});

// ---------- Domínio na Cloudflare ----------
test('ligar domínio: adiciona raiz e www ao projeto, cria a zona e os CNAME proxied', async () => {
  const fake = fakeCloudflare();
  const info = await client(fake).attachDomain('proj-a', 'www.ChicoMoveis.com.br');
  assert.deepEqual(fake.state.domains.sort(), ['chicomoveis.com.br', 'www.chicomoveis.com.br']);
  assert.equal(info.zone.created, true);
  assert.equal(info.zone.status, 'pending');
  assert.deepEqual(info.zone.nameServers, ['ada.ns.cloudflare.com', 'bob.ns.cloudflare.com']);
  const create = fake.log.find(e => e.method === 'POST' && e.path === '/zones');
  assert.deepEqual(create.body, { name: 'chicomoveis.com.br', account: { id: ACCOUNT }, type: 'full' });
  const cnames = fake.state.records.filter(r => r.type === 'CNAME');
  assert.deepEqual(cnames.map(r => [r.name, r.content, r.proxied]), [['chicomoveis.com.br', 'proj-a.pages.dev', true], ['www.chicomoveis.com.br', 'proj-a.pages.dev', true]]);
  assert.deepEqual(info.records.created, ['chicomoveis.com.br', 'www.chicomoveis.com.br']);
  assert.equal(info.domains.length, 2);
});

test('ligar domínio: zona existente, atualiza CNAME antigo e NÃO apaga A/AAAA em conflito', async () => {
  const zone = { id: 'b'.repeat(32), name: 'loja.com.br', status: 'active', name_servers: ['x.ns.cloudflare.com', 'y.ns.cloudflare.com'] };
  const fake = fakeCloudflare({ zones: [zone], records: [
    { id: 'r1', type: 'A', name: 'loja.com.br', content: '1.2.3.4', proxied: false },
    { id: 'r2', type: 'CNAME', name: 'www.loja.com.br', content: 'antigo.exemplo.com', proxied: false },
    { id: 'r3', type: 'MX', name: 'loja.com.br', content: 'mail.loja.com.br' }
  ] });
  const info = await client(fake).attachDomain('proj-b', 'loja.com.br');
  assert.equal(info.zone.created, false);
  assert.equal(fake.log.some(e => e.method === 'POST' && e.path === '/zones'), false);
  assert.deepEqual(info.records.conflicts, [{ type: 'A', name: 'loja.com.br', content: '1.2.3.4' }]);
  assert.deepEqual(info.records.updated, ['www.loja.com.br']);
  assert.equal(fake.log.some(e => e.method === 'DELETE'), false);
  assert.ok(fake.state.records.some(r => r.id === 'r1' && r.type === 'A')); // continua lá
  assert.equal(fake.state.records.find(r => r.id === 'r2').content, 'proj-b.pages.dev');
  assert.equal(fake.state.records.find(r => r.id === 'r2').proxied, true);
  assert.equal(fake.state.records.some(r => r.type === 'CNAME' && r.name === 'loja.com.br'), false); // não cria CNAME onde há A
});

test('ligar domínio: domínio já adicionado ao projeto é tolerado', async () => {
  const fake = fakeCloudflare();
  const original = fake.fetch;
  const cf = createCloudflare({ token: TOKEN, accountId: ACCOUNT, retryDelayMs: 0, fetch: async (url, init = {}) => {
    if (init.method === 'POST' && new URL(url).pathname.endsWith('/domains')) return new Response(JSON.stringify({ success: false, errors: [{ code: 8000018, message: 'Domain already added to this project' }] }), { status: 409 });
    return original(url, init);
  } });
  const info = await cf.attachDomain('proj-c', 'ja.com.br');
  assert.equal(info.zone.nameServers.length, 2);
});

// ---------- Armazenamento ----------
function memoryBlob() {
  const objects = new Map(); let revision = 0;
  const conflict = () => Object.assign(new Error('Precondition failed'), { name: 'BlobPreconditionFailedError' });
  return {
    objects,
    async get(path) { const o = objects.get(path); return o ? { stream: new Blob([o.text]).stream(), blob: { etag: 'cdn' + o.etag, size: o.text.length } } : null; },
    async head(path) { const o = objects.get(path); if (!o) throw Object.assign(new Error('Not found'), { name: 'BlobNotFoundError' }); return { etag: o.etag }; },
    async put(path, text, options) {
      const current = objects.get(path);
      if (options.ifMatch ? current?.etag !== options.ifMatch : current && !options.allowOverwrite) throw conflict();
      objects.set(path, { text, etag: 'e' + (++revision) }); return {};
    }
  };
}
const makeStore = (extra = {}) => { const blob = memoryBlob(); return { blob, store: createPublishStore({ ...blob, token: () => 'tok', ...extra }) }; };
const entry = (patch = {}) => ({ project: 'promisa-x-ab12', url: 'https://promisa-x-ab12.pages.dev', lastDeploymentId: 'd1', lastPublishedAt: NOW, filesHash: 'f'.repeat(64), ...patch });

test('armazenamento: grava, lê, mescla, lista e remove no índice privado', async () => {
  const { store, blob } = makeStore();
  assert.equal(await store.get('s1'), null);
  await store.set('s1', entry());
  await store.set('s2', entry({ project: 'promisa-y-cd34' }));
  await store.set('s1', { domain: 'x.com.br', nameServers: ['a.ns', 'b.ns'], zoneId: 'z1', lixo: 'ignorado' });
  const one = await store.get('s1');
  assert.equal(one.domain, 'x.com.br'); assert.equal(one.project, 'promisa-x-ab12'); assert.equal(one.lixo, undefined);
  assert.deepEqual(Object.keys(await store.list()).sort(), ['s1', 's2']);
  assert.equal(JSON.parse(blob.objects.get(INDEX).text).version, 1);
  await store.remove('s1');
  assert.equal(await store.get('s1'), null);
  assert.deepEqual(Object.keys(await store.list()), ['s2']);
});

test('armazenamento: escritas simultâneas não se perdem (CAS com novas tentativas)', async () => {
  const { store } = makeStore();
  await Promise.all(Array.from({ length: 3 }, (_, i) => store.set('s' + i, entry({ project: 'p' + i }))));
  assert.equal(Object.keys(await store.list()).length, 3);
});

test('armazenamento: chaves perigosas, limite e modo desenvolvimento em memória', async () => {
  const { store } = makeStore();
  for (const key of ['__proto__', 'constructor', 'prototype']) await assert.rejects(store.set(key, entry()), /inválido/);
  const dev = createPublishStore({ token: () => '', memory: () => true });
  await dev.set('a', entry()); assert.equal((await dev.get('a')).project, 'promisa-x-ab12');
  await dev.remove('a'); assert.equal(await dev.get('a'), null);
  assert.equal(MAX_ITEMS, 500);
  const prod = createPublishStore({ token: () => '', memory: () => false });
  await assert.rejects(prod.list(), /Blob/);
});

// ---------- API ----------
function call(handler, { method = 'POST', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const res = { statusCode: 200, headers: {}, setHeader(k, v) { this.headers[k.toLowerCase()] = v; }, end(text) { resolve({ status: this.statusCode, headers: this.headers, text: text ?? '', json: text ? JSON.parse(text) : null }); } };
    handler({ method, url: '/api/publish', headers: { host: 'www.promisa.online', 'x-forwarded-proto': 'https', origin: 'https://www.promisa.online', 'content-type': 'application/json', ...headers }, body }, res).catch(reject);
  });
}
function api({ logged = true, configuredCf = true, found = { site: sample(), filesHash: '1'.repeat(64) }, fake = fakeCloudflare() } = {}) {
  const { store } = makeStore();
  const reads = [];
  const handler = createPublishHandler({
    store, now: () => NOW, authorized: async () => logged, sameOrigin,
    cloudflare: () => configuredCf ? client(fake) : null,
    readSiteInfo: async (key, options) => { reads.push([key, options]); return typeof found === 'function' ? found() : found; }
  });
  return { handler, store, fake, reads };
}

test('API: 401 sem sessão, 403 de outra origem, 405, 415 e ação desconhecida', async () => {
  assert.equal((await call(api({ logged: false }).handler, { body: { action: 'list' } })).status, 401);
  assert.equal((await call(api().handler, { body: { action: 'list' }, headers: { origin: 'https://evil.example' } })).status, 403);
  assert.equal((await call(api().handler, { body: { action: 'list' }, headers: { origin: undefined } })).status, 403);
  assert.equal((await call(api().handler, { body: { action: 'list' }, headers: { 'content-type': 'text/plain' } })).status, 415);
  assert.equal((await call(api().handler, { method: 'GET' })).status, 405);
  assert.equal((await call(api().handler, { body: { action: 'x' } })).status, 400);
  assert.equal((await call(api().handler, { body: { action: 'publish', siteId: '../x' } })).status, 400);
  assert.equal((await call(api().handler, { body: { action: 'publish', siteId: '__proto__' } })).status, 400);
  assert.equal((await call(api().handler, { body: ['x'] })).status, 400);
});

test('API: 503 cloudflare-not-configured com mensagem amigável (e list continua funcionando)', async () => {
  const a = api({ configuredCf: false });
  for (const body of [{ action: 'status', siteId: 's1' }, { action: 'publish', siteId: 's1' }, { action: 'set-domain', siteId: 's1', domain: 'x.com.br' }, { action: 'unpublish', siteId: 's1' }]) {
    const r = await call(a.handler, { body });
    assert.equal(r.status, 503, body.action);
    assert.equal(r.json.code, 'cloudflare-not-configured');
    assert.equal(r.json.error, NOT_CONFIGURED);
  }
  const list = await call(a.handler, { body: { action: 'list' } });
  assert.equal(list.status, 200); assert.equal(list.json.configured, false);
});

test('API: 409 quando o site ainda não está salvo online', async () => {
  const a = api({ found: null });
  const r = await call(a.handler, { body: { action: 'publish', siteId: 's1' } });
  assert.equal(r.status, 409);
  assert.match(r.json.error, /Sincronize o painel/);
  assert.equal(a.fake.log.length, 0); // nada foi enviado à Cloudflare
  assert.equal(a.reads[0][0], 'sites:s1'); assert.equal(a.reads[0][1].fresh, true);
});

test('API: publicar, status, mudanças não publicadas, domínio, lista e tirar do ar', async () => {
  let current = { site: sample(), filesHash: '1'.repeat(64) };
  const a = api({ found: () => current });
  const pub = await call(a.handler, { body: { action: 'publish', siteId: 'ab12' } });
  assert.equal(pub.status, 200);
  assert.match(pub.json.url, /^https:\/\/promisa-chico-moveis-ab12\.pages\.dev$/);
  assert.equal(pub.json.filesHash, '1'.repeat(64));
  assert.equal(pub.json.lastPublishedAt, NOW);

  let st = await call(a.handler, { body: { action: 'status', siteId: 'ab12' } });
  assert.equal(st.json.published, true); assert.equal(st.json.outdated, false);
  current = { site: sample(), filesHash: '2'.repeat(64) };
  st = await call(a.handler, { body: { action: 'status', siteId: 'ab12' } });
  assert.equal(st.json.outdated, true);

  // republicar reaproveita o projeto
  const again = await call(a.handler, { body: { action: 'publish', siteId: 'ab12' } });
  assert.equal(again.json.url, pub.json.url);
  assert.equal(a.fake.log.filter(e => e.method === 'POST' && e.path === `/accounts/${ACCOUNT}/pages/projects`).length, 1);

  const bad = await call(a.handler, { body: { action: 'set-domain', siteId: 'ab12', domain: 'promisa.online' } });
  assert.equal(bad.status, 400);
  const dom = await call(a.handler, { body: { action: 'set-domain', siteId: 'ab12', domain: 'chicomoveis.com.br' } });
  assert.equal(dom.status, 200);
  assert.equal(dom.json.domain, 'chicomoveis.com.br');
  assert.deepEqual(dom.json.nameServers, ['ada.ns.cloudflare.com', 'bob.ns.cloudflare.com']);
  assert.equal(dom.json.domainInfo.zone.status, 'pending');
  st = await call(a.handler, { body: { action: 'status', siteId: 'ab12' } });
  assert.equal(st.json.live.zone.status, 'pending');
  assert.equal(st.json.live.domains.length, 2);

  const list = await call(a.handler, { body: { action: 'list' } });
  assert.deepEqual(Object.keys(list.json.items), ['ab12']);

  const off = await call(a.handler, { body: { action: 'unpublish', siteId: 'ab12' } });
  assert.equal(off.status, 200);
  assert.equal(a.fake.state.projects.size, 0);
  assert.equal(a.fake.log.some(e => e.method === 'DELETE' && e.path.includes('/zones')), false); // zonas nunca são apagadas
  assert.equal((await call(a.handler, { body: { action: 'status', siteId: 'ab12' } })).json.published, false);
  assert.equal((await call(a.handler, { body: { action: 'set-domain', siteId: 'ab12', domain: 'x.com.br' } })).status, 409);
});

test('API: publish com domínio inválido não envia nada; domínio válido liga em seguida', async () => {
  const a = api();
  assert.equal((await call(a.handler, { body: { action: 'publish', siteId: 's1', domain: '10.0.0.1' } })).status, 400);
  assert.equal(a.fake.log.length, 0);
  const ok = await call(a.handler, { body: { action: 'publish', siteId: 's1', domain: 'novo.com.br' } });
  assert.equal(ok.status, 200); assert.equal(ok.json.domain, 'novo.com.br');
});

test('API: a chave da Cloudflare nunca aparece em respostas nem em logs de erro', async () => {
  const logs = [];
  const original = console.error; console.error = (...args) => logs.push(args.join(' '));
  try {
    const leaky = new Response(JSON.stringify({ success: false, errors: [{ code: 10000, message: `Authentication error: ${TOKEN}` }] }), { status: 403 });
    const { store } = makeStore();
    const handler = createPublishHandler({
      store, authorized: async () => true, sameOrigin, now: () => NOW,
      cloudflare: () => createCloudflare({ token: TOKEN, accountId: ACCOUNT, fetch: async () => leaky.clone() }),
      readSiteInfo: async () => ({ site: sample(), filesHash: '1'.repeat(64) })
    });
    const r = await call(handler, { body: { action: 'publish', siteId: 's1' } });
    assert.equal(r.status, 502);
    assert.ok(!r.text.includes(TOKEN));
    assert.ok(!JSON.stringify(r.headers).includes(TOKEN));
    // erro inesperado: só o nome da classe é registrado
    const boom = createPublishHandler({ store, authorized: async () => true, sameOrigin, cloudflare: () => client(fakeCloudflare()), readSiteInfo: async () => { throw new Error('segredo ' + TOKEN); } });
    const r2 = await call(boom, { body: { action: 'publish', siteId: 's1' } });
    assert.equal(r2.status, 502); assert.ok(!r2.text.includes(TOKEN));
  } finally { console.error = original; }
  assert.ok(!logs.join('\n').includes(TOKEN));
});
