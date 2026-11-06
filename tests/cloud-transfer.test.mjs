import { test } from 'node:test';
import assert from 'node:assert/strict';
import { uploadRecord } from '../src/cloud-transfer.js';
import { readFile } from 'node:fs/promises';

test('uploads that never respond are aborted and release the caller for retry', async () => {
  let signal;
  await assert.rejects(uploadRecord('file.json', new Blob(['{}']), () => {}, {
    idleMs: 20,
    uploadImpl: async (path, blob, options) => { signal = options.abortSignal; return new Promise(() => {}); }
  }), /sem resposta/);
  assert.equal(signal.aborted, true);
});
test('client uses server-issued upload constraints and preserves multipart for large files', async () => {
  const result = await uploadRecord('file.json', new Blob([new Uint8Array(5 * 1024 * 1024)]), () => {}, {
    uploadImpl: async (path, blob, options) => {
      assert.equal(options.multipart, true);
      assert.equal(Object.hasOwn(options, 'addRandomSuffix'), false);
      assert.equal(Object.hasOwn(options, 'allowOverwrite'), false);
      return { pathname: path };
    }
  });
  assert.equal(result.pathname, 'file.json');
});
test('the browser CSP permits the API actually used by the installed Blob SDK', async () => {
  const source = await readFile(new URL('../api/access.js', import.meta.url), 'utf8');
  const bundle = await readFile(new URL('../public/assets/cloud.js', import.meta.url), 'utf8');
  const endpoint = /https:\/\/vercel\.com\/api\/blob/.exec(bundle)?.[0];
  assert.ok(endpoint, 'SDK upload endpoint must be present in the browser bundle');
  const policy = /const privateCsp = "([^"]+)"/.exec(source)[1];
  const connections = policy.split(';').find(part => part.trim().startsWith('connect-src')).trim().split(/\s+/).slice(1);
  assert.ok(connections.includes(new URL(endpoint).origin));
  assert.ok(!connections.includes('*'));
});
