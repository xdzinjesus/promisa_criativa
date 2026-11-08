import test from 'node:test';
import assert from 'node:assert/strict';
import { createFeaturedStore, cleanFeaturedItems, publicItems, FEATURED } from '../lib/featured-store.js';
import { createDemoHandler } from '../lib/demo-site.js';
import { PROJECT_VARIANT } from '../api/featured.js';
import { validateRecord, validId } from '../src/data-validation.js';

function memoryBlob() {
  const objects = new Map(); let gets = 0;
  return {
    objects, gets: () => gets,
    async get(path) { gets++; const o = objects.get(path); return o ? { stream: new Blob([o]).stream(), blob: { size: o.length } } : null; },
    async put(path, text) { objects.set(path, text); return {}; }
  };
}
const item = (siteKey, order, extra = {}) => ({ siteKey, title: 'T' + order, category: 'C', order, demo: false, ...extra });

test('publish grava ordenado, mantém o código por site e list lê de volta', async () => {
  const mem = memoryBlob(); let n = 0;
  const store = createFeaturedStore({ ...mem, token: () => 't', newId: () => 'id' + (++n) });
  assert.deepEqual(await store.list(), []);
  const first = await store.publish([item('sites:b', 2), item('sites:a', 1)]);
  assert.deepEqual(first.map(i => [i.siteKey, i.id]), [['sites:a', 'id2'], ['sites:b', 'id1']]);
  const again = await store.publish([item('sites:a', 2, { title: 'Novo' }), item('sites:c', 1)]);
  assert.equal(again.find(i => i.siteKey === 'sites:a').id, 'id2');
  assert.equal(again[0].siteKey, 'sites:c');
  assert.equal(JSON.parse(mem.objects.get(FEATURED)).version, 1);
  assert.deepEqual((await store.list()).map(i => i.siteKey), ['sites:c', 'sites:a']);
  await assert.rejects(store.publish(Array.from({ length: 7 }, (_, i) => item('sites:' + i, 1))));
});

test('validação da API: máximo 6, campos e duplicados', () => {
  const ok = { siteId: 's1', title: ' Kaetano ', category: 'Tatuagem', order: 1, demo: true };
  assert.deepEqual(cleanFeaturedItems([ok], validId), [{ siteId: 's1', title: 'Kaetano', category: 'Tatuagem', order: 1, demo: true }]);
  assert.deepEqual(cleanFeaturedItems([], validId), []);
  const bad = x => assert.throws(() => cleanFeaturedItems(x, validId));
  bad(Array.from({ length: 7 }, (_, i) => ({ ...ok, siteId: 's' + i })));
  bad([ok, ok]); bad([{ ...ok, siteId: '../x' }]); bad([{ ...ok, title: '' }]); bad([{ ...ok, title: 'x'.repeat(61) }]);
  bad([{ ...ok, category: 'x'.repeat(61) }]); bad([{ ...ok, order: 0 }]); bad([{ ...ok, order: 7 }]); bad([{ ...ok, order: 1.5 }]); bad([{ ...ok, demo: 'sim' }]); bad('x');
});

test('lista pública não expõe siteKey nem outros dados', () => {
  const out = publicItems([{ id: 'abc', siteKey: 'sites:secreto', title: 'T', category: 'C', order: 1, demo: 1 }]);
  assert.deepEqual(out, [{ id: 'abc', title: 'T', category: 'C', demo: true }]);
  assert.ok(!JSON.stringify(out).includes('secreto'));
});

test('site salvo valida o campo featured', () => {
  const site = { id: 's1', htmlPath: 'index.html', files: [{ path: 'index.html', type: 'text/html', data: 'x' }] };
  const featured = { on: true, title: 'A', category: 'B', order: 2, demo: false };
  assert.equal(validateRecord('sites', { ...site, featured }).featured.order, 2);
  for (const f of [{ ...featured, order: 9 }, { ...featured, on: 1 }, { ...featured, title: 'x'.repeat(61) }, 'x', null]) assert.throws(() => validateRecord('sites', { ...site, featured: f }));
});

test('rota /projeto resolve o código, aplica sandbox e só deixa a própria página incorporar', async () => {
  const id = 'A'.repeat(22); let reads = 0, finds = 0;
  const handler = createDemoHandler({
    findShare: async v => { finds++; return v === id ? { siteKey: 'sites:a', expiresAt: 8.64e15 } : null; },
    readSite: async key => { reads++; return key === 'sites:a' ? { htmlPath: 'index.html', files: [{ path: 'index.html', type: 'text/html', data: '<html><head></head><body>Oi</body></html>' }] } : null; },
    variant: PROJECT_VARIANT
  });
  const call = (token, path = '') => { const res = { statusCode: 200, headers: {}, setHeader(k, v) { this.headers[k.toLowerCase()] = v; }, end(b) { this.body = b; } }; return handler({ method: 'GET', url: '/x', query: { token, path } }, res).then(() => res); };
  const ok = await call(id);
  assert.equal(ok.statusCode, 200);
  assert.match(ok.body.toString(), /<base href="\/projeto\/A{22}\/">/);
  assert.equal(ok.headers['content-security-policy'], "sandbox allow-scripts; frame-ancestors 'self'");
  assert.equal(ok.headers['x-frame-options'], 'SAMEORIGIN');
  assert.match(ok.headers['x-robots-tag'], /noindex/);
  assert.equal(ok.headers['referrer-policy'], 'no-referrer');
  assert.match(ok.headers['vercel-cdn-cache-control'], /max-age=600/);
  const missing = await call('B'.repeat(22)); assert.equal(missing.statusCode, 404);
  const malformed = await call('curto'); assert.equal(malformed.statusCode, 404);
  assert.equal(finds, 2); assert.equal(reads, 1);
});
