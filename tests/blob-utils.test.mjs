import test from 'node:test';
import assert from 'node:assert/strict';
import { BlobPreconditionFailedError, BlobNotFoundError } from '@vercel/blob';
import { isBlobError, readWithEtag } from '../lib/blob-utils.js';

const stream = () => new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode('{"ok":true}')); c.close(); } });

test('erros reais do Vercel Blob são reconhecidos pela classe, embora o name seja "Error"', () => {
  const error = new BlobPreconditionFailedError();
  assert.equal(error.name, 'Error'); // causa do bug: comparar error.name nunca funcionava
  assert.ok(isBlobError(error, 'BlobPreconditionFailedError'));
  assert.ok(!isBlobError(error, 'BlobNotFoundError'));
  assert.ok(isBlobError(new BlobNotFoundError(), 'BlobNotFoundError'));
  assert.ok(!isBlobError(new Error('x'), 'BlobPreconditionFailedError'));
});

test('a ETag usada em ifMatch vem de head(), não do cabeçalho da CDN em get()', async () => {
  const get = async () => ({ stream: stream(), blob: { etag: '"cdn-etag"', size: 11 } });
  const head = async () => ({ etag: '"api-etag"' });
  const read = await readWithEtag('promisa/v1/manifest.json', {}, { get, head });
  assert.equal(read.etag, '"api-etag"');
  assert.deepEqual(await new Response(read.result.stream).json(), { ok: true });
});

test('se o arquivo muda durante a leitura, lê de novo para não misturar versões', async () => {
  const etags = ['"v1"', '"v2"', '"v2"', '"v2"'];
  let gets = 0;
  const head = async () => ({ etag: etags.shift() });
  const get = async () => { gets++; return { stream: stream(), blob: { size: 11 } }; };
  const read = await readWithEtag('a.json', {}, { get, head });
  assert.equal(read.etag, '"v2"');
  assert.equal(gets, 2);
});

test('arquivo inexistente devolve null em vez de erro', async () => {
  const head = async () => { throw new BlobNotFoundError(); };
  assert.equal(await readWithEtag('a.json', {}, { get: async () => assert.fail('não deve ler'), head }), null);
});
