import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import handler from '../api/access.js';

process.env.ADMIN_PASSWORD = 'test-only-password';
process.env.ADMIN_SESSION_SECRET = 'test-only-session-secret-of-at-least-32-characters';
let ip = 0;
async function call({ method = 'GET', query = {}, body, headers = {} } = {}) {
  const req = { method, query, body, url: '/api/access', socket: { remoteAddress: `test-${++ip}` }, headers: { host: 'localhost:4173', origin: 'http://localhost:4173', 'content-type': 'application/json', ...headers } };
  const res = { statusCode: 200, headers: {}, setHeader(k, v) { this.headers[k.toLowerCase()] = v; }, end(content = '') { this.content = content; } };
  await handler(req, res);
  return res;
}
async function login() {
  const response = await call({ method: 'POST', query: { action: 'login' }, body: { password: process.env.ADMIN_PASSWORD } });
  assert.equal(response.statusCode, 200);
  return response.headers['set-cookie'].split(';')[0];
}
test('private pages redirect without a session and never return the template', async () => {
  for (const view of ['admin', 'catalogo']) {
    const response = await call({ query: { view } });
    assert.equal(response.statusCode, 303);
    assert.equal(response.headers.location, '/acesso.html');
    assert.equal(response.content, '');
    assert.match(response.headers['cache-control'], /no-store/);
  }
});
test('incorrect password is rejected', async () => {
  const response = await call({ method: 'POST', query: { action: 'login' }, body: { password: 'wrong' } });
  assert.equal(response.statusCode, 401);
  assert.equal(response.headers['set-cookie'], undefined);
});
test('login permits both destinations with an HttpOnly session', async () => {
  const cookie = await login();
  for (const view of ['admin', 'catalogo']) {
    const response = await call({ query: { view }, headers: { cookie } });
    assert.equal(response.statusCode, 200);
    assert.match(response.headers['content-type'], /text\/html/);
    assert.match(response.content, /Catálogo dos meus projetos/);
    assert.ok(!response.content.includes(process.env.ADMIN_PASSWORD));
  }
  const response = await call({ method: 'POST', query: { action: 'login' }, body: { password: process.env.ADMIN_PASSWORD } });
  assert.match(response.headers['set-cookie'], /HttpOnly; SameSite=Strict/);
});
test('tampered tokens and cross-origin submissions are rejected', async () => {
  const cookie = await login();
  const tampered = await call({ query: { action: 'session' }, headers: { cookie: cookie + 'tamper' } });
  assert.equal(tampered.statusCode, 401);
  const response = await call({ method: 'POST', query: { action: 'login' }, body: { password: process.env.ADMIN_PASSWORD }, headers: { origin: 'https://other.example' } });
  assert.equal(response.statusCode, 403);
});
test('logout expires the browser cookie', async () => {
  const response = await call({ method: 'POST', query: { action: 'logout' } });
  assert.equal(response.statusCode, 200);
  assert.match(response.headers['set-cookie'], /Max-Age=0/);
});
test('repeated incorrect passwords are rate limited per instance', async () => {
  const headers = { 'x-forwarded-for': 'test-limited-ip' };
  for (let i = 0; i < 5; i++) {
    const response = await call({ method: 'POST', query: { action: 'login' }, body: { password: 'wrong' }, headers });
    assert.equal(response.statusCode, 401);
  }
  const response = await call({ method: 'POST', query: { action: 'login' }, body: { password: process.env.ADMIN_PASSWORD }, headers });
  assert.equal(response.statusCode, 429);
  assert.ok(Number(response.headers['retry-after']) > 0);
});
test('production cookie is Secure and missing configuration fails closed', async () => {
  const previousVercel = process.env.VERCEL;
  process.env.VERCEL = '1';
  try {
    const response = await call({ method: 'POST', query: { action: 'login' }, headers: { origin: 'https://localhost:4173' }, body: { password: process.env.ADMIN_PASSWORD } });
    assert.match(response.headers['set-cookie'], /; Secure/);
  } finally {
    if (previousVercel === undefined) delete process.env.VERCEL; else process.env.VERCEL = previousVercel;
  }
  const secret = process.env.ADMIN_SESSION_SECRET;
  delete process.env.ADMIN_SESSION_SECRET;
  try { assert.equal((await call({ query: { view: 'admin' } })).statusCode, 503); }
  finally { process.env.ADMIN_SESSION_SECRET = secret; }
});
test('build excludes private pages and credentials', async () => {
  const files = await readdir('public', { recursive: true });
  assert.ok(!files.some(name => /(^|[\\/])private([\\/]|$)|\.env|admin\.html|catalogo\.html/.test(name)));
  const html = await readFile('public/index.html', 'utf8');
  assert.match(html, /class="admin-footer-link" href="\/acesso.html">Área administrativa/);
  assert.ok(files.includes('acesso.html'));
});
