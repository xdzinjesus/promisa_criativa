import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planSync, encodeValue, decodeValue, digest } from '../src/cloud-core.js';
import { validateOperations, mergeOperations, validPath, CloudError } from '../lib/cloud-store.js';
import cloudHandler from '../api/cloud.js';
import accessHandler from '../api/access.js';

const A = 'a'.repeat(64), B = 'b'.repeat(64), C = 'c'.repeat(64);
const path = 'promisa/v1/objects/12345678-1234-1234-1234-123456789abc.json';
test('PC uploads an attachment and a new phone downloads the same record', () => {
  const pc = planSync({ 'attachments:zip1': { hash: A } }, {}, {});
  assert.deepEqual(pc.operations, [{ key: 'attachments:zip1', baseHash: null, hash: A }]);
  const phone = planSync({}, {}, { 'attachments:zip1': { hash: A, path } });
  assert.deepEqual(phone.downloads, ['attachments:zip1']);
  assert.equal(phone.operations.length, 0);
});
test('new phone defaults do not overwrite the saved business information', () => {
  const plan = planSync({ 'settings:plan': { hash: B, isDefault: true } }, {}, { 'settings:plan': { hash: A, path } });
  assert.deepEqual(plan.downloads, ['settings:plan']);
  assert.equal(plan.conflicts.length, 0);
});
test('independent PC and phone changes merge without losing records', () => {
  const original = { version: 1, records: { 'sites:one': { hash: A, path } } };
  const pc = mergeOperations(original, [{ key: 'sites:one', baseHash: A, hash: B, path }]);
  const phone = mergeOperations(pc, [{ key: 'projects:two', baseHash: null, hash: C, path }]);
  assert.equal(phone.records['sites:one'].hash, B);
  assert.equal(phone.records['projects:two'].hash, C);
});
test('editing the same record on two devices reports a conflict', () => {
  const plan = planSync({ 'sites:one': { hash: B } }, { 'sites:one': A }, { 'sites:one': { hash: C, path } });
  assert.deepEqual(plan.conflicts, ['sites:one']);
  assert.throws(() => mergeOperations({ records: { 'sites:one': { hash: C, path } } }, [{ key: 'sites:one', baseHash: A, hash: B, path }]), error => error instanceof CloudError && error.status === 409);
});
test('deletions propagate and old devices cannot silently resurrect removed records', () => {
  const removed = { 'sites:one': { hash: null, path: null } };
  assert.deepEqual(planSync({ 'sites:one': { hash: A } }, { 'sites:one': A }, removed).downloads, ['sites:one']);
  assert.deepEqual(planSync({ 'sites:one': { hash: A } }, {}, removed).conflicts, ['sites:one']);
});
test('ZIP and HTML bytes survive cloud encoding and download unchanged', async () => {
  const bytes = new Uint8Array([80, 75, 3, 4, 0, 255, 128, 10]);
  const value = { id: 'zip1', sourceZip: { name: 'original.zip', blob: new Blob([bytes], { type: 'application/zip' }) }, files: [{ path: 'index.html', data: '<h1>Olá, celular!</h1>' }] };
  const serialized = JSON.stringify(await encodeValue(value));
  const decoded = decodeValue(JSON.parse(serialized));
  assert.deepEqual(new Uint8Array(await decoded.sourceZip.blob.arrayBuffer()), bytes);
  assert.equal(decoded.sourceZip.blob.type, 'application/zip');
  assert.equal(decoded.files[0].data, value.files[0].data);
  assert.equal(await digest(serialized), await digest(JSON.stringify(await encodeValue(decoded))));
});
test('large project files are encoded intact without going through the function body', async () => {
  const bytes = new Uint8Array(5 * 1024 * 1024 + 7); bytes[bytes.length - 1] = 241;
  const result = decodeValue(await encodeValue({ blob: new Blob([bytes], { type: 'application/zip' }) }));
  assert.equal(result.blob.size, bytes.length);
  assert.equal(new Uint8Array(await result.blob.slice(-1).arrayBuffer())[0], 241);
});
test('commit validates record identities, hashes and object locations', () => {
  assert.equal(validPath(path), true);
  assert.equal(validPath('../manifest.json'), false);
  assert.throws(() => validateOperations([{ key: '__proto__', hash: A, baseHash: null, path }]));
  assert.throws(() => validateOperations([{ key: 'sites:one', hash: A, baseHash: null, path: 'https://other.example/file' }]));
  assert.throws(() => validateOperations([{ key: 'sites:one', hash: 'bad', baseHash: null, path }]));
});
test('cloud API requires login and reports missing storage without pretending to save', async () => {
  process.env.ADMIN_PASSWORD = 'cloud-test-password';
  process.env.ADMIN_SESSION_SECRET = 'cloud-test-session-secret-more-than-32-characters';
  delete process.env.BLOB_READ_WRITE_TOKEN;
  function response() { return { statusCode: 200, headers: {}, setHeader(key, value) { this.headers[key] = value; }, end(body) { this.body = body; } }; }
  const req = { method: 'GET', url: '/api/cloud?action=manifest', query: { action: 'manifest' }, headers: { host: 'localhost:4173' } };
  const denied = response(); await cloudHandler(req, denied); assert.equal(denied.statusCode, 401);
  const login = response();
  await accessHandler({ method: 'POST', url: '/api/access', query: { action: 'login' }, headers: { host: 'localhost:4173', origin: 'http://localhost:4173', 'content-type': 'application/json' }, body: { password: process.env.ADMIN_PASSWORD } }, login);
  req.headers.cookie = login.headers['Set-Cookie'].split(';')[0];
  const missing = response(); await cloudHandler(req, missing);
  assert.equal(missing.statusCode, 503);
  assert.equal(JSON.parse(missing.body).code, 'STORAGE_NOT_CONFIGURED');
  req.method = 'POST'; req.headers.origin = 'https://other.example';
  const csrf = response(); await cloudHandler(req, csrf); assert.equal(csrf.statusCode, 403);
});
