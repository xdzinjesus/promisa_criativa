import { test } from 'node:test';
import assert from 'node:assert/strict';
import handler, { passkeyDeps, relyingParty } from '../api/access.js';
import { createPasskeyStore, MAX_PASSKEYS } from '../lib/passkey-store.js';
import { signChallenge, readChallenge, createUsedChallenges } from '../lib/passkey-challenge.js';

process.env.ADMIN_PASSWORD = 'test-only-password';
process.env.ADMIN_SESSION_SECRET = 'test-only-session-secret-of-at-least-32-characters';
const secret = process.env.ADMIN_SESSION_SECRET;
let ip = 0;
async function call({ method = 'POST', query = {}, body, headers = {}, address } = {}) {
  const req = { method, query, body, url: '/api/access', socket: { remoteAddress: address || `pk-${++ip}` }, headers: { host: 'localhost:4173', origin: 'http://localhost:4173', 'content-type': 'application/json', ...headers } };
  const res = { statusCode: 200, headers: {}, getHeader(k) { return this.headers[k.toLowerCase()]; }, setHeader(k, v) { this.headers[k.toLowerCase()] = v; }, end(content = '') { this.content = content; } };
  await handler(req, res);
  return res;
}
const cookiesOf = res => [].concat(res.headers['set-cookie'] || []).map(c => c.split(';')[0]).join('; ');
async function login() {
  const res = await call({ query: { action: 'login' }, body: { password: process.env.ADMIN_PASSWORD } });
  assert.equal(res.statusCode, 200);
  return cookiesOf(res);
}
const sample = (n, extra = {}) => ({ id: `id-${n}`, publicKey: 'AAAA', counter: 0, transports: ['internal'], deviceType: 'multiDevice', backedUp: true, name: `K${n}`, createdAt: 'x', lastUsedAt: null, ...extra });

test('store: add, find, touch, remove and the 10-key limit (memory)', async () => {
  const store = createPasskeyStore({ token: () => '' });
  for (let i = 0; i < MAX_PASSKEYS; i++) await store.add(sample(i));
  await assert.rejects(store.add(sample(99)), /Limite/);
  const small = createPasskeyStore({ token: () => '' });
  await small.add(sample(0));
  await assert.rejects(small.add(sample(0)), /já está/);
  await store.touch('id-3', { counter: 7, lastUsedAt: 'now' });
  assert.deepEqual((({ counter, lastUsedAt }) => ({ counter, lastUsedAt }))(await store.find('id-3')), { counter: 7, lastUsedAt: 'now' });
  await store.remove('id-3');
  assert.equal(await store.find('id-3'), null);
  await assert.rejects(store.remove('id-3'), /não encontrada/);
  assert.equal((await store.list()).length, MAX_PASSKEYS - 1);
});

test('store: Blob writes use ETag and retry on conflict', async () => {
  let data = null, etag = 0, conflicts = 1;
  const puts = [];
  const fake = {
    token: () => 'tok',
    head: async () => { if (!data) { const e = new Error('nf'); e.name = 'BlobNotFoundError'; throw e; } return { etag: String(etag) }; },
    get: async () => data ? { blob: { size: data.length }, stream: new Response(data).body } : null,
    put: async (path, body, opts) => {
      puts.push(opts);
      if (conflicts-- > 0) { const e = new Error('precondition failed'); e.name = 'BlobPreconditionFailedError'; throw e; }
      if (data && opts.ifMatch !== String(etag)) throw Object.assign(new Error('precondition'), { name: 'BlobPreconditionFailedError' });
      data = body; etag++;
    }
  };
  const store = createPasskeyStore(fake);
  await store.add(sample(1));
  assert.equal(puts.length, 2); // 1 conflito + 1 sucesso
  assert.equal(puts[0].access, 'private');
  assert.equal(puts[0].allowOverwrite, false);
  await store.add(sample(2));
  assert.equal(puts.at(-1).ifMatch, '1');
  assert.equal(JSON.parse(data).items.length, 2);
});

test('challenge cookie: valid, expired, wrong type, tampered, other secret', () => {
  const now = Date.now();
  const value = signChallenge({ challenge: 'abc', type: 'auth', now }, secret);
  const header = `x=1; promisa_webauthn=${value}`;
  assert.equal(readChallenge(header, 'auth', secret, now).challenge, 'abc');
  assert.equal(readChallenge(header, 'reg', secret, now), null);
  assert.equal(readChallenge(header, 'auth', secret, now + 301_000), null);
  assert.equal(readChallenge(header, 'auth', secret + 'x', now), null);
  const [payload, sig] = value.split('.');
  const forged = Buffer.from(JSON.stringify({ c: 'evil', t: 'auth', exp: Math.floor(now / 1000) + 300 })).toString('base64url');
  assert.equal(readChallenge(`promisa_webauthn=${forged}.${sig}`, 'auth', secret, now), null);
  assert.equal(readChallenge(`promisa_webauthn=${payload}.${sig.slice(0, -2)}AA`, 'auth', secret, now), null);
  assert.equal(readChallenge('', 'auth', secret, now), null);
  const used = createUsedChallenges();
  assert.equal(used.consume('abc', Math.floor(now / 1000) + 300, now), true);
  assert.equal(used.consume('abc', Math.floor(now / 1000) + 300, now), false);
});

test('relying party: www and apex share promisa.online; localhost in dev', () => {
  assert.deepEqual(relyingParty({ headers: { host: 'www.promisa.online' } }).rpID, 'promisa.online');
  assert.deepEqual(relyingParty({ headers: { host: 'promisa.online' } }).origins, ['https://promisa.online', 'https://www.promisa.online']);
  assert.equal(relyingParty({ headers: { host: 'localhost:4193' } }).rpID, 'localhost');
});

test('api: session-only endpoints return 401 without a session', async () => {
  for (const action of ['passkey-register-options', 'passkey-register-verify', 'passkey-list', 'passkey-delete']) {
    const res = await call({ query: { action }, body: {} });
    assert.equal(res.statusCode, 401, action);
  }
});

test('api: same-origin, method and content type are enforced', async () => {
  const cross = await call({ query: { action: 'passkey-auth-options' }, body: {}, headers: { origin: 'https://other.example' } });
  assert.equal(cross.statusCode, 403);
  const type = await call({ query: { action: 'passkey-auth-options' }, body: '{}', headers: { 'content-type': 'text/plain' } });
  assert.equal(type.statusCode, 415);
  const get = await call({ method: 'PUT', query: { action: 'passkey-auth-options' } });
  assert.equal(get.statusCode, 405);
});

test('api: auth-verify with an invalid response is 401, reserves attempts and sets no session', async () => {
  const address = 'pk-limit';
  const options = await call({ query: { action: 'passkey-auth-options' }, body: {}, address });
  assert.equal(options.statusCode, 200);
  assert.match(options.headers['set-cookie'], /promisa_webauthn=.*HttpOnly; SameSite=Strict; Path=\/api\/access; Max-Age=300/);
  const cookie = cookiesOf(options);
  const bad = await call({ query: { action: 'passkey-auth-verify' }, body: { response: { id: 'nope' } }, headers: { cookie }, address });
  assert.equal(bad.statusCode, 401);
  assert.equal(JSON.parse(bad.content).error, 'Não foi possível confirmar a chave de acesso.');
  assert.ok(!/promisa_session=[^;]+\./.test(String(bad.headers['set-cookie'])));
  for (let i = 0; i < 4; i++) await call({ query: { action: 'passkey-auth-verify' }, body: { response: { id: 'nope' } }, address });
  const blocked = await call({ query: { action: 'passkey-auth-verify' }, body: { response: { id: 'nope' } }, address });
  assert.equal(blocked.statusCode, 429);
});

test('api: full flow with mocked WebAuthn verification; list hides public keys', async () => {
  const original = { ...passkeyDeps };
  Object.assign(passkeyDeps, {
    store: createPasskeyStore({ token: () => '' }), used: createUsedChallenges(),
    verifyRegistrationResponse: async ({ expectedChallenge, expectedRPID, requireUserVerification }) => {
      assert.equal(expectedRPID, 'localhost'); assert.equal(requireUserVerification, true);
      return { verified: true, registrationInfo: { credential: { id: 'cred-1', publicKey: new Uint8Array([1, 2, 3]), counter: 0, transports: ['internal'] }, credentialDeviceType: 'multiDevice', credentialBackedUp: true } };
    },
    verifyAuthenticationResponse: async ({ credential, expectedChallenge, requireUserVerification }) => {
      assert.equal(credential.id, 'cred-1'); assert.equal(requireUserVerification, true); assert.ok(expectedChallenge);
      return { verified: true, authenticationInfo: { newCounter: 5 } };
    }
  });
  try {
    const session = await login();
    const regOptions = await call({ query: { action: 'passkey-register-options' }, body: {}, headers: { cookie: session } });
    assert.equal(regOptions.statusCode, 200);
    const parsed = JSON.parse(regOptions.content);
    assert.equal(parsed.rp.id, 'localhost'); assert.equal(parsed.authenticatorSelection.residentKey, 'required'); assert.equal(parsed.authenticatorSelection.userVerification, 'required');
    assert.equal(parsed.attestation, 'none');
    const longName = await call({ query: { action: 'passkey-register-verify' }, body: { response: {}, name: 'x'.repeat(41) }, headers: { cookie: session } });
    assert.equal(longName.statusCode, 400);
    const noChallenge = await call({ query: { action: 'passkey-register-verify' }, body: { response: { id: 'x' }, name: 'iPhone' }, headers: { cookie: session } });
    assert.equal(noChallenge.statusCode, 400);
    const ok = await call({ query: { action: 'passkey-register-verify' }, body: { response: { id: 'cred-1' }, name: 'iPhone' }, headers: { cookie: `${session}; ${cookiesOf(regOptions)}` } });
    assert.equal(ok.statusCode, 200);
    // Reuso do mesmo desafio é recusado.
    const replay = await call({ query: { action: 'passkey-register-verify' }, body: { response: { id: 'cred-1' }, name: 'iPhone' }, headers: { cookie: `${session}; ${cookiesOf(regOptions)}` } });
    assert.equal(replay.statusCode, 400);
    const list = await call({ query: { action: 'passkey-list' }, body: {}, headers: { cookie: session } });
    const items = JSON.parse(list.content).items;
    assert.equal(items.length, 1);
    assert.ok(!list.content.includes('publicKey') && !list.content.includes('AQID'));
    assert.deepEqual(Object.keys(items[0]).sort(), ['createdAt', 'deviceType', 'id', 'lastUsedAt', 'name']);

    const authOptions = await call({ query: { action: 'passkey-auth-options' }, body: {} });
    const verified = await call({ query: { action: 'passkey-auth-verify' }, body: { response: { id: 'cred-1' } }, headers: { cookie: cookiesOf(authOptions) } });
    assert.equal(verified.statusCode, 200);
    const cookies = [].concat(verified.headers['set-cookie']);
    const sessionCookie = cookies.find(c => c.startsWith('promisa_session='));
    assert.match(sessionCookie, /HttpOnly; SameSite=Strict; Path=\//);
    const check = await call({ method: 'GET', query: { action: 'session' }, headers: { cookie: sessionCookie.split(';')[0] } });
    assert.equal(check.statusCode, 200);
    assert.equal((await passkeyDeps.store.find('cred-1')).counter, 5);
    // Desafio do tipo errado (registro) não serve para entrar.
    const wrong = await call({ query: { action: 'passkey-auth-verify' }, body: { response: { id: 'cred-1' } }, headers: { cookie: cookiesOf(regOptions) } });
    assert.equal(wrong.statusCode, 401);

    const removed = await call({ query: { action: 'passkey-delete' }, body: { id: 'cred-1' }, headers: { cookie: session } });
    assert.equal(removed.statusCode, 200);
    assert.equal(JSON.parse((await call({ query: { action: 'passkey-list' }, body: {}, headers: { cookie: session } })).content).items.length, 0);
  } finally { Object.assign(passkeyDeps, original); }
});
