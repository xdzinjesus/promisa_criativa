import test from 'node:test';
import assert from 'node:assert/strict';
import { createShareStore, siteKeyFor, TOKEN } from '../lib/share-store.js';
import { createDemoHandler, resolveFile, decodeFile, DEMO_CSP } from '../lib/demo-site.js';

function memoryBlob() {
  const objects = new Map(); let revision = 0;
  const conflict = () => Object.assign(new Error('Precondition failed: ETag mismatch.'), { name: 'BlobPreconditionFailedError' });
  return {
    objects,
    async get(path) { const o = objects.get(path); return o ? { stream: new Blob([o.text]).stream(), blob: { etag: 'cdn-' + o.etag, size: o.text.length } } : null; },
    async head(path) { const o = objects.get(path); if (!o) throw Object.assign(new Error('Not found'), { name: 'BlobNotFoundError' }); return { etag: o.etag }; },
    async put(path, text, options) {
      const current = objects.get(path);
      if (options.ifMatch ? current?.etag !== options.ifMatch : current && !options.allowOverwrite) throw conflict();
      const etag = 'e' + (++revision); objects.set(path, { text, etag }); return { etag };
    },
    token: () => 'test-token'
  };
}

const siteA = { id: 'a1', htmlPath: 'index.html', files: [
  { path: 'index.html', type: 'text/html', data: '<!doctype html><html><head><title>A</title></head><body><img src="img/logo.png"></body></html>' },
  { path: 'css/style.css', type: 'text/css', data: 'body{color:red}' },
  { path: 'img/logo.png', type: 'image/png', data: 'data:image/png;base64,iVBORw0KGgo=' },
  { path: 'sobre/index.html', type: 'text/html', data: '<html><head></head><body>Sobre</body></html>' }
] };
const siteB = { id: 'b2', htmlPath: 'index.html', files: [{ path: 'index.html', type: 'text/html', data: '<html><body>Segredo do cliente B</body></html>' }] };

function call(handler, token, path = '', method = 'GET') {
  const res = { statusCode: 200, headers: {}, setHeader(k, v) { this.headers[k.toLowerCase()] = v; }, end(body) { this.body = body; } };
  return handler({ method, url: '/api/demo', query: { token, path } }, res).then(() => res);
}

test('cria, lista e desativa links; código tem 128 bits e não se repete', async () => {
  let clock = 1_000_000;
  const store = createShareStore({ ...memoryBlob(), now: () => clock, cacheMs: 0 });
  const one = await store.create('a1', clock + 7 * 864e5);
  const two = await store.create('a1', clock + 864e5);
  assert.match(one.token, TOKEN);
  assert.notEqual(one.token, two.token);
  assert.equal((await store.list('a1')).length, 2);
  assert.equal((await store.list('b2')).length, 0);
  await store.revoke(one.token);
  assert.deepEqual((await store.list('a1')).map(s => s.token), [two.token]);
  assert.equal((await store.find(one.token)).revokedAt !== undefined, true);
  clock += 2 * 864e5;
  assert.equal((await store.list('a1'))[0].state, 'expired');
});

test('validade fora do intervalo permitido é recusada', async () => {
  const store = createShareStore({ ...memoryBlob(), now: () => 0 });
  await assert.rejects(store.create('a1', 60_000), /entre 5 minutos e 1 ano/);
  await assert.rejects(store.create('a1', 400 * 864e5), /entre 5 minutos e 1 ano/);
  await assert.rejects(store.create('a1', 'amanhã'), /entre 5 minutos e 1 ano/);
});

test('gravações concorrentes não perdem links (ETag da API, não da CDN)', async () => {
  const store = createShareStore({ ...memoryBlob(), now: () => 0, cacheMs: 0 });
  const created = await Promise.all([1, 2, 3].map(() => store.create('a1', 864e5)));
  const listed = (await store.list('a1')).map(s => s.token).sort();
  assert.deepEqual(listed, created.map(s => s.token).sort());
});

test('o link serve só o site dele, com isolamento e sem indexação', async () => {
  const shares = { tokA: { token: 'A'.repeat(22), siteKey: siteKeyFor('a1'), expiresAt: Date.now() + 864e5 } };
  const handler = createDemoHandler({
    findShare: async token => Object.values(shares).find(s => s.token === token) || null,
    readSite: async key => ({ [siteKeyFor('a1')]: siteA, [siteKeyFor('b2')]: siteB })[key] || null
  });
  const token = 'A'.repeat(22);
  const home = await call(handler, token, '');
  assert.equal(home.statusCode, 200);
  assert.equal(home.headers['content-security-policy'], DEMO_CSP);
  assert.match(DEMO_CSP, /^sandbox /);
  assert.doesNotMatch(DEMO_CSP, /allow-same-origin/);
  assert.equal(home.headers['referrer-policy'], 'no-referrer');
  assert.match(home.headers['x-robots-tag'], /noindex/);
  assert.match(home.body.toString(), new RegExp(`<base href="/demo/${token}/">`));
  const css = await call(handler, token, 'css/style.css');
  assert.equal(css.headers['content-type'], 'text/css; charset=utf-8');
  const img = await call(handler, token, 'img/logo.png');
  assert.equal(img.headers['content-type'], 'image/png');
  assert.deepEqual([...img.body.subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47]);
  assert.equal((await call(handler, token, 'sobre/')).statusCode, 200);
  assert.equal((await call(handler, token, 'sobre')).statusCode, 200);
  // Nada fora do site: caminhos de fuga, arquivos inexistentes e o site de outro cliente.
  for (const path of ['../index.html', '../../api/cloud.js', '..%2F..%2Fapi%2Fcloud.js', '%2e%2e/x', '/etc/passwd', '.env', 'b2/index.html', 'nao-existe.html']) {
    const res = await call(handler, token, path);
    assert.equal(res.statusCode, 404, path);
    assert.doesNotMatch(String(res.body), /Segredo do cliente B/);
  }
});

test('código inválido, desativado ou expirado não mostra o site', async () => {
  const now = Date.now();
  const list = [
    { token: 'R'.repeat(22), siteKey: siteKeyFor('a1'), expiresAt: now + 864e5, revokedAt: new Date().toISOString() },
    { token: 'E'.repeat(22), siteKey: siteKeyFor('a1'), expiresAt: now - 1 }
  ];
  const handler = createDemoHandler({ findShare: async token => list.find(s => s.token === token) || null, readSite: async () => siteA });
  for (const token of ['curto', 'A'.repeat(22), 'R'.repeat(22), '<script>'.padEnd(22, 'x')]) {
    const res = await call(handler, token);
    assert.equal(res.statusCode, 404, token);
    assert.doesNotMatch(String(res.body), /<title>A<\/title>/);
  }
  const expired = await call(handler, 'E'.repeat(22));
  assert.equal(expired.statusCode, 410);
  assert.match(expired.body, /expirada/);
  assert.equal((await call(handler, 'A'.repeat(22), '', 'POST')).statusCode, 405);
});

test('resolução de arquivos e decodificação', () => {
  assert.equal(resolveFile(siteA, 'CSS/Style.css')?.path, 'css/style.css');
  assert.equal(resolveFile(siteA, '%zz'), null);
  assert.equal(resolveFile({ htmlPath: 'a.html', files: [{ path: '100%.png', data: '' }] }, '100%.png')?.path, '100%.png');
  assert.equal(decodeFile('data:text/plain,ol%C3%A1').toString(), 'olá');
  assert.equal(decodeFile('texto').toString(), 'texto');
});

test('página principal em subpasta redireciona; abuso de cache e limites', async () => {
  const site = { htmlPath: 'pages/index.html', files: [{ path: 'pages/index.html', type: 'text/html', data: '<html><head></head></html>' }] };
  const share = { token: 'S'.repeat(22), siteKey: 'sites:x', expiresAt: Date.now() + 864e5 };
  const handler = createDemoHandler({ findShare: async () => share, readSite: async () => site });
  const root = await call(handler, share.token, '');
  assert.equal(root.statusCode, 302);
  assert.equal(root.headers.location, `/demo/${share.token}/pages/index.html`);
  const page = await call(handler, share.token, 'pages/index.html');
  assert.equal(page.statusCode, 200);
  assert.equal(page.headers['vercel-cdn-cache-control'], 'max-age=60');
  assert.doesNotMatch(DEMO_CSP, /allow-popups-to-escape-sandbox/);
  const arrays = await call(createDemoHandler({ findShare: async () => share, readSite: async () => site }), [share.token, 'x'], ['pages/index.html']);
  assert.equal(arrays.statusCode, 200);
});
