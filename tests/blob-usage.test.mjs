import test from 'node:test';
import assert from 'node:assert/strict';
import { blobUsage, groupBlobs, MAX_PAGES } from '../lib/blob-usage.js';

const manifest = { records: { 'sales:1': { path: 'promisa/v1/objects/aaa.json' }, 'sitefiles:2': { path: 'promisa/v1/objects/bbb.json' }, 'sales:3': { path: null } }, retired: { 'promisa/v1/objects/old.json': '2026-11-01' } };

test('Blob: agrupa por tipo de dado, separa versões antigas e arquivos soltos', () => {
  const r = groupBlobs([
    { pathname: 'promisa/v1/objects/aaa.json', size: 100 }, { pathname: 'promisa/v1/objects/bbb.json', size: 5000 },
    { pathname: 'promisa/v1/objects/old.json', size: 300 }, { pathname: 'promisa/v1/objects/zzz.json', size: 50 },
    { pathname: 'promisa/v1/manifest.json', size: 10 }, { pathname: 'promisa/discord/v1/site-backups/x.json', size: 20 }, { pathname: 'outra/coisa', size: 1 }
  ], manifest);
  assert.equal(r.count, 7); assert.equal(r.bytes, 5481);
  const by = Object.fromEntries(r.groups.map(g => [g.label, g.bytes]));
  assert.equal(by['Arquivos dos sites'], 5000); assert.equal(by['Clientes'], 100);
  assert.equal(by['Versões antigas (limpeza automática)'], 300); assert.equal(by['Arquivos soltos (sem uso)'], 50);
  assert.equal(by['Índice e chaves do painel'], 10); assert.equal(by['Backups do Discord'], 20); assert.equal(by['Outros'], 1);
  assert.equal(r.groups[0].label, 'Arquivos dos sites', 'maior primeiro');
});

test('Blob: lista página por página com limite, e sem chave avisa', async () => {
  assert.deepEqual(await blobUsage({ token: '' }), { configured: false });
  let calls = 0;
  const list = async ({ cursor }) => { calls++; return { blobs: [{ pathname: 'promisa/v1/objects/aaa.json', size: 1 }], hasMore: true, cursor: 'c' + calls, ...(cursor ? {} : {}) }; };
  const r = await blobUsage({ token: 't', list, manifest: async () => ({ manifest }) });
  assert.equal(calls, MAX_PAGES); assert.equal(r.truncated, true); assert.equal(r.count, MAX_PAGES);
  const one = await blobUsage({ token: 't', list: async () => ({ blobs: [], hasMore: false }), manifest: async () => { throw new Error('x'); } });
  assert.equal(one.count, 0); assert.equal(one.truncated, false);
});
