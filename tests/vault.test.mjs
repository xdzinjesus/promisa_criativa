import test from 'node:test';
import assert from 'node:assert/strict';
import { createKeyring, unlockKeyring, rewrapKeyring, seal, open, isEncryptedKey, ENCRYPTED_KINDS } from '../src/vault.js';
import { createVaultStore, validateKeyring, KEYRING } from '../lib/vault-store.js';
import { validateStoredRecord } from '../lib/cloud-store.js';
import cloudHandler from '../api/cloud.js';
import accessHandler from '../api/access.js';

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
const v1 = JSON.stringify({ version: 1, value: { id: 'x', nome: 'Cliente ção' } });

test('cria e destrava o cofre; senha errada falha com WRONG_KEY', async () => {
  const { keyring, keys } = await createKeyring('senha-do-painel');
  assert.equal(keyring.version, 1);
  assert.equal(keyring.kdf.iterations, 600000);
  validateKeyring(keyring);
  const again = await unlockKeyring(keyring, 'senha-do-painel');
  assert.equal(again.id, keys.id);
  assert.equal(await open(again, 'sales:1', await seal(keys, 'sales:1', v1)), v1);
  await assert.rejects(unlockKeyring(keyring, 'outra-senha'), { code: 'WRONG_KEY' });
});

test('seal é determinístico, depende da chave do registro e abre de volta', async () => {
  const { keys } = await createKeyring('abc');
  const a = await seal(keys, 'sales:1', v1);
  assert.equal(a, await seal(keys, 'sales:1', v1));
  assert.notEqual(a, await seal(keys, 'sales:2', v1));
  assert.notEqual(a, await seal(keys, 'sales:1', v1 + ' '));
  assert.ok(!a.includes('Cliente'));
  assert.equal(JSON.parse(a).version, 2);
  assert.equal(await open(keys, 'sales:1', a), v1);
  await assert.rejects(open(keys, 'sales:2', a));
});

test('registro adulterado ou de outro cofre não abre', async () => {
  const { keys } = await createKeyring('abc'), other = (await createKeyring('abc')).keys;
  const parsed = JSON.parse(await seal(keys, 'exp:1', v1));
  const flip = text => (text[0] === 'A' ? 'B' : 'A') + text.slice(1);
  await assert.rejects(open(keys, 'exp:1', JSON.stringify({ ...parsed, data: flip(parsed.data) })));
  await assert.rejects(open(keys, 'exp:1', JSON.stringify({ ...parsed, iv: flip(parsed.iv) })));
  await assert.rejects(open(keys, 'exp:1', JSON.stringify({ ...parsed, vault: 'outro' })));
  await assert.rejects(open(other, 'exp:1', JSON.stringify(parsed)));
  await assert.rejects(open(keys, 'exp:1', 'não é json'));
});

test('troca de senha mantém a chave mestra', async () => {
  const { keyring, keys } = await createKeyring('antiga');
  const sealedText = await seal(keys, 'projects:1', v1);
  const next = await rewrapKeyring(keyring, 'antiga', 'nova');
  assert.equal(next.keyring.id, keyring.id);
  assert.notEqual(next.keyring.kdf.salt, keyring.kdf.salt);
  validateKeyring(next.keyring);
  const unlocked = await unlockKeyring(next.keyring, 'nova');
  assert.equal(await open(unlocked, 'projects:1', sealedText), v1);
  assert.equal(await open(next.keys, 'projects:1', sealedText), v1);
  await assert.rejects(unlockKeyring(next.keyring, 'antiga'), { code: 'WRONG_KEY' });
  await assert.rejects(rewrapKeyring(keyring, 'errada', 'nova'), { code: 'WRONG_KEY' });
});

test('tipos protegidos', () => {
  assert.deepEqual(ENCRYPTED_KINDS, ['sales', 'exp', 'projects', 'bank', 'products', 'settings', 'attachments']);
  for (const key of ['sales:a', 'exp:a', 'projects:a', 'bank:2026-11', 'products:p1', 'settings:a', 'attachments:a']) assert.equal(isEncryptedKey(key), true);
  for (const key of ['sites:x', 'sitesx', '', 'sales', undefined]) assert.equal(isEncryptedKey(key), false);
});

test('armazenamento da chave: cria uma vez, lê, troca só com a versão anterior correta', async () => {
  const blob = memoryBlob(), store = createVaultStore(blob);
  assert.equal(await store.get(), null);
  const { keyring } = await createKeyring('p1');
  await store.create(keyring);
  await assert.rejects(store.create(keyring), { status: 409 });
  assert.deepEqual(await store.get(), keyring);
  const { keyring: next } = await rewrapKeyring(keyring, 'p1', 'p2');
  const { keyring: stranger } = await createKeyring('p1');
  await assert.rejects(store.replace(stranger, next), { status: 400 }); // id diferente
  await assert.rejects(store.replace({ ...keyring, createdAt: 'outro' }, { ...next, createdAt: 'outro' }), { status: 409 }); // anterior não confere
  await store.replace(keyring, next);
  assert.deepEqual(await store.get(), next);
  await assert.rejects(store.replace(keyring, next), { status: 409 }); // já trocada
  assert.ok(blob.objects.has(KEYRING));
});

test('esquema da chave é estrito', async () => {
  const { keyring } = await createKeyring('p');
  const store = createVaultStore(memoryBlob());
  const bad = [
    null, [], { ...keyring, extra: 1 }, { ...keyring, version: 2 }, { ...keyring, id: 'a'.repeat(65) }, { ...keyring, id: '../x' },
    { ...keyring, createdAt: 5 }, { ...keyring, kdf: { ...keyring.kdf, iterations: 99_999 } }, { ...keyring, kdf: { ...keyring.kdf, iterations: 5_000_001 } },
    { ...keyring, kdf: { ...keyring.kdf, iterations: 1.5 } }, { ...keyring, kdf: { ...keyring.kdf, salt: 'AAAA' } },
    { ...keyring, kdf: { ...keyring.kdf, hash: 'SHA-1' } }, { ...keyring, wrapped: { ...keyring.wrapped, iv: 'AAAA' } },
    { ...keyring, wrapped: { ...keyring.wrapped, data: keyring.wrapped.data.slice(4) } }, { ...keyring, wrapped: { ...keyring.wrapped, data: '!'.repeat(64) } },
    { ...keyring, wrapped: { ...keyring.wrapped, extra: 1 } }
  ];
  for (const value of bad) { assert.throws(() => validateKeyring(value), { status: 400 }); await assert.rejects(store.create(value), { status: 400 }); }
});

test('servidor aceita registro v2 só para tipos protegidos', async () => {
  const { keys } = await createKeyring('p');
  const v2 = JSON.parse(await seal(keys, 'sales:1', v1));
  assert.equal(validateStoredRecord('sales:1', v2), 2);
  assert.equal(validateStoredRecord('attachments:1', v2), 2);
  assert.throws(() => validateStoredRecord('sites:x', v2));
  assert.throws(() => validateStoredRecord('sales:1', { ...v2, iv: 'AAAA' }));
  assert.throws(() => validateStoredRecord('sales:1', { ...v2, data: 5 }));
  assert.throws(() => validateStoredRecord('sales:1', { ...v2, vault: 'x'.repeat(65) }));
  assert.throws(() => validateStoredRecord('sales:1', { ...v2, data: '' }));
  assert.throws(() => validateStoredRecord('sales:1', { version: 3 }));
  assert.throws(() => validateStoredRecord('sales:1', null));
  // Versão 1 continua igual.
  assert.equal(validateStoredRecord('sales:1', { version: 1, value: { id: '1', name: 'x' } }), 1);
  assert.throws(() => validateStoredRecord('sales:1', { version: 1 }));
  assert.throws(() => validateStoredRecord('sales:1', { version: 1, value: { id: '2' } }));
});

test('API: vault-verify recusa senha errada e aceita a certa', async () => {
  process.env.ADMIN_PASSWORD = 'vault-test-password';
  process.env.ADMIN_SESSION_SECRET = 'vault-test-session-secret-more-than-32-characters';
  delete process.env.BLOB_READ_WRITE_TOKEN; delete process.env.VERCEL;
  const response = () => ({ statusCode: 200, headers: {}, setHeader(key, value) { this.headers[key] = value; }, end(body) { this.body = body; } });
  const headers = { host: 'localhost:4173', origin: 'http://localhost:4173', 'content-type': 'application/json' };
  const login = response();
  await accessHandler({ method: 'POST', url: '/api/access', query: { action: 'login' }, headers, body: { password: process.env.ADMIN_PASSWORD } }, login);
  const cookie = login.headers['Set-Cookie'].split(';')[0];
  const verify = async password => {
    const res = response();
    await cloudHandler({ method: 'POST', url: '/api/cloud?action=vault-verify', query: { action: 'vault-verify' }, headers: { ...headers, cookie }, body: { password } }, res);
    return res;
  };
  const semSessao = response();
  await cloudHandler({ method: 'POST', url: '/api/cloud?action=vault-verify', query: { action: 'vault-verify' }, headers, body: { password: process.env.ADMIN_PASSWORD } }, semSessao);
  assert.equal(semSessao.statusCode, 401);
  const ok = await verify(process.env.ADMIN_PASSWORD);
  assert.equal(ok.statusCode, 200); assert.deepEqual(JSON.parse(ok.body), { ok: true });
  const bad = await verify('senha-errada-123');
  assert.equal(bad.statusCode, 401); assert.equal(JSON.parse(bad.body).code, 'WRONG_PASSWORD');
  assert.equal((await verify(5)).statusCode, 400);
  assert.equal((await verify('x'.repeat(257))).statusCode, 400);
  for (let i = 0; i < 4; i++) await verify('senha-errada-123');
  const limited = await verify('senha-errada-123');
  assert.equal(limited.statusCode, 429);
  assert.ok(!limited.body.includes('senha-errada-123'));
  // As outras ações do cofre continuam exigindo o armazenamento configurado.
  const res = response();
  await cloudHandler({ method: 'GET', url: '/api/cloud?action=vault', query: { action: 'vault' }, headers: { ...headers, cookie } }, res);
  assert.equal(res.statusCode, 503);
});
