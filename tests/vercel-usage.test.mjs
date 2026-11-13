import test from 'node:test';
import assert from 'node:assert/strict';
import { vercelUsage, summarize, parseJsonl } from '../lib/vercel-usage.js';

const row = (ServiceName, ConsumedQuantity, ConsumedUnit, BilledCost = 0, ChargeCategory = 'Usage') => ({ ServiceName, ConsumedQuantity, ConsumedUnit, BilledCost, ChargeCategory });

test('soma os dias por serviço e compara com o limite grátis', () => {
  const s = summarize([row('Blob Simple Operations', 3000, 'Operations'), row('Blob Simple Operations', 2800, 'Operations'), row('Blob Advanced Operations', 860, 'Operations'), row('Fluid Active CPU', 0.12, 'Hours'), row('Algo Novo', 5, 'Units'), { ChargeCategory: 'Credit', BilledCost: -1 }]);
  const blob = s.items.find(x => x.name === 'Blob Simple Operations');
  assert.equal(blob.quantity, 5800); assert.equal(blob.limit, 10000); assert.equal(blob.pct, 58);
  assert.equal(s.items.find(x => x.name === 'Blob Advanced Operations').pct, 43);
  assert.equal(s.items.find(x => x.name === 'Algo Novo').limit, null, 'serviço sem limite conhecido aparece sem barra');
  assert.equal(s.items[0].name, 'Blob Simple Operations', 'mais perto do limite primeiro');
  assert.equal(s.cost, -1);
  assert.equal(parseJsonl('{"a":1}\n\nlixo\n{"b":2}').length, 2);
});

test('consulta a Vercel com a chave só no servidor; sem chave, avisa', async () => {
  assert.deepEqual(await vercelUsage({ env: {} }), { configured: false });
  let called;
  const fetchFn = async (url, opts) => { called = { url: String(url), auth: opts.headers.Authorization }; return new Response(JSON.stringify(row('Function Invocations', 4700, 'Invocations')) + '\n', { status: 200 }); };
  const r = await vercelUsage({ env: { VERCEL_API_TOKEN: 'tok', VERCEL_TEAM_SLUG: 'meu-time' }, now: Date.parse('2026-11-13T12:00:00Z'), fetchFn });
  assert.match(called.url, /^https:\/\/api\.vercel\.com\/v1\/billing\/charges\?from=2026-10-15T00%3A00%3A00\.000Z&to=2026-11-14T00%3A00%3A00\.000Z&slug=meu-time$/);
  assert.equal(called.auth, 'Bearer tok');
  assert.equal(r.items[0].quantity, 4700); assert.ok(!JSON.stringify(r).includes('tok'), 'a chave nunca volta na resposta');
  const denied = await vercelUsage({ env: { VERCEL_API_TOKEN: 'x' }, fetchFn: async () => new Response('', { status: 403 }) });
  assert.match(denied.error, /recusou a chave/);
});
