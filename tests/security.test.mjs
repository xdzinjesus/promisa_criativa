import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateEntry, validateState, safeFilePath } from '../src/data-validation.js';
import { mergeOperations, verifyObject } from '../lib/cloud-store.js';
import { removableObjects, RETENTION_MS } from '../lib/storage-maintenance.js';
import { reserveAttempt, createAuthStore } from '../lib/auth-store.js';
import { encodeValue, decodeValue, digest } from '../src/cloud-core.js';

test('import validation rejects executable IDs, mismatched IDs, prototype keys and credential files', () => {
  assert.throws(() => validateEntry('projects:safe', { id: "');alert(1);//" }));
  assert.throws(() => validateEntry('projects:safe', { id: 'other' }));
  assert.throws(() => validateState(JSON.parse('{"sales":[],"exp":[],"__proto__":{}}')));
  assert.throws(() => validateEntry('settings:constructor', {}));
  for (const path of ['../index.html', '.env.local', '.git/config', 'secrets/key.pem']) assert.equal(safeFilePath(path), false);
  assert.equal(safeFilePath('assets/site.css'), true);
});
test('serialized cloud records validate content identity and binary envelope', async () => {
  const value = { id: 'file1', name: 'index.html', blob: new Blob(['<h1>Olá</h1>'], { type: 'text/html' }) };
  const encoded = await encodeValue(value);
  validateEntry('attachments:file1', encoded, { encoded: true });
  assert.throws(() => validateEntry('attachments:other', encoded, { encoded: true }));
  assert.equal(await decodeValue(encoded).blob.text(), '<h1>Olá</h1>');
});

test('server rejects a wrong digest or internal ID before accepting a cloud object', async () => {
  const text = JSON.stringify({ version: 1, value: { id: 'one', title: 'Valid project' } });
  const hash = await digest(text);
  const read = async () => ({ stream: new Blob([text]).stream(), blob: { size: text.length, contentType: 'application/json', url: 'https://test.private.blob.vercel-storage.com/object.json' } });
  await verifyObject({ key: 'projects:one', path: 'object.json', hash }, read);
  await assert.rejects(verifyObject({ key: 'projects:one', path: 'object.json', hash: '0'.repeat(64) }, read), error => error.status === 400);
  await assert.rejects(verifyObject({ key: 'projects:two', path: 'object.json', hash }, read), error => error.status === 400);
});
test('deleted records do not consume active limit and retired paths receive a recovery window', () => {
  const path = 'promisa/v1/objects/12345678-1234-1234-1234-123456789abc.json';
  const records = Object.fromEntries(Array.from({ length: 5000 }, (_, i) => ['projects:' + i, { hash: null, path: null }]));
  const next = mergeOperations({ records }, [{ key: 'projects:new', baseHash: null, hash: 'a'.repeat(64), path }]);
  assert.equal(next.records['projects:new'].hash, 'a'.repeat(64));
  const removed = mergeOperations(next, [{ key: 'projects:new', baseHash: 'a'.repeat(64), hash: null, path: null }]);
  const now = Date.now(), blobs = [{ pathname: path, uploadedAt: new Date(now - 30 * RETENTION_MS) }];
  assert.equal(removableObjects(blobs, next, now).length, 0);
  assert.equal(removableObjects(blobs, removed, now).length, 0);
  assert.equal(removableObjects(blobs, removed, now + RETENTION_MS + 1000).length, 1);
});
test('parallel local login attempts cannot bypass the five-attempt limit', async () => {
  delete process.env.BLOB_READ_WRITE_TOKEN;
  const attempts = await Promise.all(Array.from({ length: 10 }, () => reserveAttempt('parallel-test')));
  assert.equal(attempts.filter(value => value === 0).length, 5);
});

test('two production instances share attempt limits and session revocation with conditional writes', async () => {
  const objects = new Map(); let revision = 0;
  const conflict = () => Object.assign(new Error('Conflict'), { name: 'BlobPreconditionFailedError' });
  const transport = {
    token: () => 'test-only-transport', secret: () => 'test-only-auth-store-secret', production: () => true,
    async get(path) {
      const object = objects.get(path); await Promise.resolve();
      return object ? { stream: new Blob([object.text]).stream(), blob: { etag: object.etag, size: object.text.length } } : null;
    },
    async head(path) {
      const object = objects.get(path); await Promise.resolve();
      if (!object) throw Object.assign(new Error('Not found'), { name: 'BlobNotFoundError' });
      return { etag: object.etag };
    },
    async put(path, text, options) {
      const current = objects.get(path);
      if (options.ifMatch ? current?.etag !== options.ifMatch : current && !options.allowOverwrite) throw conflict();
      const etag = String(++revision); objects.set(path, { text, etag }); return { etag };
    },
    async del(path) { objects.delete(path); }
  };
  const one = createAuthStore(transport), two = createAuthStore(transport);
  const attempts = await Promise.all(Array.from({ length: 10 }, (_, index) => (index % 2 ? one : two).reserveAttempt('same-ip')));
  assert.equal(attempts.filter(value => value === 0).length, 5);
  await one.createSession('nonce', Math.floor(Date.now() / 1000) + 900);
  assert.equal(await two.sessionActive('nonce'), true);
  await two.revokeSession('nonce');
  assert.equal(await one.sessionActive('nonce'), false);
  for (const path of objects.keys()) assert.ok(!path.includes('same-ip'));
});
