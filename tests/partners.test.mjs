import { test } from 'node:test';
import assert from 'node:assert/strict';
import { accessFor, cleanModules, MODULE_IDS } from '../src/partner-modules.js';
import { createPartnerStore, createPartnerActions, passwordOk } from '../lib/partner-store.js';
import accessHandler, { who } from '../api/access.js';
import cloudHandler from '../api/cloud.js';

process.env.ADMIN_PASSWORD = 'test-only-password';
process.env.ADMIN_SESSION_SECRET = 'test-only-session-secret-of-at-least-32-characters';
let ip = 0;
const reqOf = ({ method = 'GET', query = {}, body, cookie }) => ({ method, query, body, url: '/api/x', socket: { remoteAddress: `p-${++ip}` }, headers: { host: 'localhost:4173', origin: 'http://localhost:4173', 'content-type': 'application/json', ...(cookie ? { cookie } : {}) } });
const resOf = () => ({ statusCode: 200, headers: {}, setHeader(k, v) { this.headers[k.toLowerCase()] = v; }, getHeader(k) { return this.headers[k.toLowerCase()]; }, end(c = '') { this.content = c; } });
async function call(handler, opts) { const res = resOf(); await handler(reqOf(opts), res); let json = null; try { json = JSON.parse(res.content); } catch {} return { status: res.statusCode, json, res }; }
const cookieOf = r => [].concat(r.res.headers['set-cookie']).find(c => c.startsWith('promisa_session=')).split(';')[0];

test('módulos: cada um libera só os seus dados; o que é do dono nunca entra', () => {
  const a = accessFor(['bank', 'notes', 'inventado']);
  assert.deepEqual(a.modules, ['bank', 'notes']);
  assert.equal(a.allowKey('bank:2026-11'), true); assert.equal(a.allowKey('settings:bankRules'), true); assert.equal(a.allowKey('settings:prospectNotes'), true);
  assert.equal(a.allowKey('sales:1'), false); assert.equal(a.allowKey('settings:plan'), false); assert.equal(a.allowKey('products:p1'), false);
  assert.equal(a.allowKey('settings:%E0'), false); assert.equal(a.allowKey('nada'), false);
  assert.equal(accessFor(['mySites']).api('publish'), true); assert.equal(accessFor(['bank']).api('publish'), false);
  assert.ok(!MODULE_IDS.includes('backup') && !MODULE_IDS.includes('partners'));
  assert.deepEqual(cleanModules(['dash', 'dash', 'x']), ['dash']);
});

test('cadastro: senha embaralhada, usuário único, pausar e mudar cortam as sessões', async () => {
  const revoked = [];
  const p = createPartnerActions({ store: createPartnerStore({ token: () => '', memory: () => true }), revoke: async n => revoked.push(n) });
  await assert.rejects(p.create({ name: 'João', user: 'João Silva', password: '12345678', modules: ['clients'] }), /Usuário/);
  await assert.rejects(p.create({ name: 'João', user: 'joao', password: 'curta', modules: ['clients'] }), /8 caracteres/);
  await assert.rejects(p.create({ name: 'João', user: 'joao', password: 'senha-forte', modules: [] }), /módulo/);
  const j = await p.create({ name: 'João', user: 'Joao', password: 'senha-forte', modules: ['clients', 'backup'] });
  assert.deepEqual(j.modules, ['clients']); assert.equal(j.user, 'joao'); assert.ok(!('hash' in j) && !('salt' in j));
  await assert.rejects(p.create({ name: 'Outro', user: 'joao', password: 'senha-forte', modules: ['clients'] }), /Já existe/);
  assert.equal(await p.login('joao', 'errada', 'n'.repeat(32)), null);
  assert.equal((await p.login('JOAO', 'senha-forte', 'a'.repeat(32))).id, j.id);
  await p.update(j.id, { modules: ['bank'] });
  assert.deepEqual(revoked, ['a'.repeat(32)], 'mudar os módulos corta a sessão aberta');
  await p.update(j.id, { active: false });
  assert.equal(await p.login('joao', 'senha-forte', 'b'.repeat(32)), null, 'pausado não entra');
  await p.update(j.id, { active: true, password: 'outra-senha' });
  assert.equal(await p.login('joao', 'senha-forte', 'c'.repeat(32)), null); assert.ok(await p.login('joao', 'outra-senha', 'd'.repeat(32)));
  await p.remove(j.id); assert.equal((await p.list()).length, 0);
  assert.equal(passwordOk({ salt: '00', hash: '' }, 'x'), false);
});

test('login do sócio: só os módulos dele, nada do dono, e o acesso cai quando o dono muda algo', async () => {
  const owner = cookieOf(await call(accessHandler, { method: 'POST', query: { action: 'login' }, body: { password: process.env.ADMIN_PASSWORD } }));
  const created = await call(accessHandler, { method: 'POST', query: { action: 'partner-create' }, body: { name: 'Sócio', user: 'socio', password: 'senha-do-socio', modules: ['bank', 'products'] }, cookie: owner });
  assert.equal(created.status, 200, JSON.stringify(created.json));
  assert.equal((await call(accessHandler, { method: 'POST', query: { action: 'login' }, body: { user: 'socio', password: 'errada' } })).status, 401);
  const partner = cookieOf(await call(accessHandler, { method: 'POST', query: { action: 'login' }, body: { user: 'socio', password: 'senha-do-socio' } }));
  const s = await call(accessHandler, { query: { action: 'session' }, cookie: partner });
  assert.deepEqual([s.json.role, s.json.modules], ['partner', ['bank', 'products']]);
  assert.equal((await call(accessHandler, { query: { view: 'admin' }, cookie: partner })).status, 200, 'abre o painel');
  assert.equal((await call(accessHandler, { query: { view: 'catalogo' }, cookie: partner })).status, 303, 'catálogo só com Meus sites');
  assert.equal((await call(accessHandler, { method: 'POST', query: { action: 'partner-list' }, body: {}, cookie: partner })).status, 401, 'sócio não mexe em sócios');
  assert.equal((await call(accessHandler, { method: 'POST', query: { action: 'passkey-list' }, body: {}, cookie: partner })).status, 401, 'nem em Face ID');
  // servidor de dados
  assert.equal((await call(cloudHandler, { query: { action: 'vercel-usage' }, cookie: partner })).status, 403);
  assert.equal((await call(cloudHandler, { method: 'POST', query: { action: 'commit' }, body: { operations: [{ key: 'sales:1', baseHash: null, hash: 'a'.repeat(64) }] }, cookie: partner })).status, 403, 'não grava clientes');
  assert.equal((await call(cloudHandler, { method: 'POST', query: { action: 'read' }, body: { key: 'settings:plan' }, cookie: partner })).status, 403, 'não lê o plano');
  assert.equal((await call(cloudHandler, { method: 'POST', query: { action: 'share-list' }, body: { siteId: 'x' }, cookie: partner })).status, 403);
  assert.equal((await call(cloudHandler, { method: 'POST', query: { action: 'vault-verify' }, body: { password: 'x' }, cookie: partner })).status, 403);
  assert.notEqual((await call(cloudHandler, { method: 'POST', query: { action: 'commit' }, body: { operations: [{ key: 'bank:2026-11', baseHash: null, hash: 'a'.repeat(64) }] }, cookie: partner })).status, 403, 'grava extratos (liberado)');
  // dono muda os módulos: a sessão do sócio cai na hora
  const id = created.json.partner.id;
  assert.equal((await call(accessHandler, { method: 'POST', query: { action: 'partner-update' }, body: { id, modules: ['bank'] }, cookie: owner })).status, 200);
  assert.equal((await call(accessHandler, { query: { action: 'session' }, cookie: partner })).status, 401);
  // o dono continua com tudo
  assert.equal((await call(accessHandler, { query: { action: 'session' }, cookie: owner })).json.role, 'owner');
  assert.deepEqual(await who(reqOf({ cookie: owner }), { password: process.env.ADMIN_PASSWORD, secret: process.env.ADMIN_SESSION_SECRET }), { owner: true });
});
