import test from 'node:test';
import assert from 'node:assert/strict';
import { createBriefingStore, TOKEN, answersPath, BRIEFINGS, newToken, readToken } from '../lib/briefing-store.js';
import { createBriefingHandler, createRateLimiter, MIN_FILL_MS } from '../lib/briefing-handler.js';
import { sameOrigin } from '../api/access.js';
import { BRIEFING_QUESTIONS, validateAnswers, answersToText } from '../src/briefing-questions.js';

function memoryBlob() {
  const objects = new Map(); let revision = 0; const ops = [];
  const conflict = () => Object.assign(new Error('Precondition failed: ETag mismatch.'), { name: 'BlobPreconditionFailedError' });
  return {
    objects, ops,
    async get(path) { ops.push('get ' + path); const o = objects.get(path); return o ? { stream: new Blob([o.text]).stream(), blob: { etag: 'cdn-' + o.etag, size: o.text.length } } : null; },
    async head(path) { ops.push('head ' + path); const o = objects.get(path); if (!o) throw Object.assign(new Error('Not found'), { name: 'BlobNotFoundError' }); return { etag: o.etag }; },
    async put(path, text, options) {
      ops.push('put ' + path);
      const current = objects.get(path);
      if (options.ifMatch ? current?.etag !== options.ifMatch : current && !options.allowOverwrite) throw conflict();
      const etag = 'e' + (++revision); objects.set(path, { text, etag }); return { etag };
    },
    async del(paths) { for (const path of [paths].flat()) { ops.push('del ' + path); objects.delete(path); } },
    token: () => 'test-token'
  };
}
const full = () => ({
  q1: 'Padaria Doce Pão, alimentação', q2: 'Pães e bolos', q3: { selected: ['Famílias', 'Jovens'], other: 'Turistas' },
  q4: 'Receitas da casa', q5: { selected: ['Atrair novos clientes'], other: '' }, q6: { selected: ['Galeria de fotos'], other: '' },
  q7: { selected: ['Moderno e minimalista'], other: '' }, q8: 'Temos o logo', q9: 'WhatsApp 49 99999-9999', q10: ''
});
const DAY = 864e5;

test('perguntas: 10 perguntas, só a última é opcional', () => {
  assert.equal(BRIEFING_QUESTIONS.length, 10);
  assert.deepEqual(BRIEFING_QUESTIONS.filter(q => !q.required).map(q => q.id), ['q10']);
});

test('validação aceita respostas completas e limpa caracteres de controle', () => {
  const input = full(); input.q1 = '  Padaria\u0000 Doce Pão  ';
  const result = validateAnswers(input);
  assert.equal(result.ok, true);
  assert.equal(result.answers.q1, 'Padaria Doce Pão');
  assert.deepEqual(result.answers.q3, { selected: ['Famílias', 'Jovens'], other: 'Turistas' });
  assert.match(answersToText(result.answers), /1\. Qual é o nome/);
});

test('validação recusa faltas, opção desconhecida, textos grandes e campos extras', () => {
  const bad = patch => validateAnswers({ ...full(), ...patch });
  assert.equal(bad({ q2: '   ' }).ok, false);
  assert.equal(bad({ q2: undefined }).field, 'q2');
  assert.equal(bad({ q3: { selected: [], other: '' } }).field, 'q3');
  assert.equal(bad({ q3: { selected: [], other: 'Só outro' } }).ok, true);
  assert.equal(bad({ q3: { selected: ['Marcianos'], other: '' } }).ok, false);
  assert.equal(bad({ q7: { selected: ['Moderno e minimalista', 'Elegante e sofisticado'], other: '' } }).ok, false);
  assert.equal(bad({ q7: { selected: ['Moderno e minimalista'], other: 'x' } }).ok, false);
  assert.equal(bad({ q1: 'a'.repeat(3001) }).ok, false);
  assert.equal(bad({ q5: { selected: [], other: 'a'.repeat(301) } }).ok, false);
  assert.equal(bad({ q1: { evil: true } }).ok, false);
  assert.equal(bad({ q10: undefined }).ok, true);
  assert.equal(validateAnswers({ ...full(), extra: 'x' }).ok, false);
  assert.equal(validateAnswers(null).ok, false);
});

test('armazenamento: cria, lista e desativa com escrita condicional', async () => {
  let clock = 1_000_000;
  const store = createBriefingStore({ ...memoryBlob(), now: () => clock, cacheMs: 0 });
  const one = await store.create('lead1', clock + 30 * DAY);
  const two = await store.create('lead1', clock + DAY);
  assert.match(one.token, TOKEN);
  assert.notEqual(one.token, two.token);
  await assert.rejects(store.create('lead1', clock + 1000), { status: 400 });
  await assert.rejects(store.create('a/b', clock + DAY), { status: 400 });
  assert.deepEqual((await store.list()).map(i => i.state), ['open', 'open']);
  await store.revoke(one.token);
  await assert.rejects(store.revoke('x'.repeat(22)), { status: 400 });
  await assert.rejects(store.revoke('x'.repeat(32)), { status: 404 });
  assert.deepEqual((await store.list()).map(i => i.state), ['revoked', 'open']);
  clock += 2 * DAY;
  assert.equal((await store.list())[1].state, 'expired');
});

test('armazenamento: duas criações ao mesmo tempo não perdem registros (CAS)', async () => {
  const mem = memoryBlob(), store = createBriefingStore({ ...mem, now: () => 1_000_000, cacheMs: 0 });
  await store.create('seed', 1_000_000 + DAY);
  await Promise.all([store.create('a', 1_000_000 + DAY), store.create('b', 1_000_000 + DAY), store.create('c', 1_000_000 + DAY)]);
  assert.equal((await store.list()).length, 4);
});

test('resposta é gravada uma única vez; a segunda tentativa dá 409', async () => {
  const mem = memoryBlob(), store = createBriefingStore({ ...mem, now: () => 1_000_000, cacheMs: 0 });
  const item = await store.create('lead1', 1_000_000 + DAY);
  const { answers } = validateAnswers(full());
  await assert.rejects(store.getAnswers(item.token), { status: 404 });
  assert.deepEqual(await store.submit(item.token, answers), { ok: true });
  await assert.rejects(store.submit(item.token, answers), { status: 409, message: 'Este formulário já foi respondido.' });
  const saved = await store.getAnswers(item.token);
  assert.equal(saved.answers.q1, 'Padaria Doce Pão, alimentação');
  assert.equal(saved.leadId, 'lead1');
  assert.equal((await store.list())[0].state, 'answered');
  // desativar um formulário já respondido não o apaga
  await store.revoke(item.token);
  assert.equal((await store.list())[0].state, 'answered');
});

test('envio recusado para código vencido, desativado ou inexistente', async () => {
  let clock = 1_000_000;
  const store = createBriefingStore({ ...memoryBlob(), now: () => clock, cacheMs: 0 });
  const a = await store.create('l', clock + DAY), b = await store.create('l', clock + DAY);
  await store.revoke(b.token);
  const { answers } = validateAnswers(full());
  await assert.rejects(store.submit(b.token, answers), { status: 404 });
  await assert.rejects(store.submit('Z'.repeat(32), answers), { status: 404 });
  clock += 2 * DAY;
  await assert.rejects(store.submit(a.token, answers), { status: 404 });
});

test('envio que parou no meio é recuperado na tentativa seguinte', async () => {
  const mem = memoryBlob(), store = createBriefingStore({ ...mem, now: () => 1_000_000, cacheMs: 0 });
  const item = await store.create('l', 1_000_000 + DAY);
  mem.objects.set(answersPath(item.token), { text: '{}', etag: 'x' }); // respostas já existem, índice não marcou
  await assert.rejects(store.submit(item.token, validateAnswers(full()).answers), { status: 409 });
  assert.equal((await store.list())[0].state, 'answered');
});

test('índice antigo sem resposta é limpo, mas respostas ficam', async () => {
  let clock = 1_000_000;
  const store = createBriefingStore({ ...memoryBlob(), now: () => clock, cacheMs: 0 });
  const old = await store.create('l', clock + DAY), kept = await store.create('l', clock + DAY);
  await store.submit(kept.token, validateAnswers(full()).answers);
  clock += 70 * DAY;
  await store.create('l', clock + DAY);
  assert.deepEqual((await store.list()).map(i => i.token).includes(old.token), false);
  assert.equal((await store.list()).some(i => i.token === kept.token), true);
});

// ---- rota pública ----
function setup({ now = () => 10_000_000, allow } = {}) {
  const mem = memoryBlob(), store = createBriefingStore({ ...mem, now, cacheMs: 0 });
  const handler = createBriefingHandler({ find: t => store.find(t), submit: (t, a) => store.submit(t, a), sameOrigin, now, allow });
  return { mem, store, handler };
}
function call(handler, { method = 'GET', query = {}, body, headers = {} } = {}) {
  const res = { statusCode: 200, headers: {}, setHeader(k, v) { this.headers[k.toLowerCase()] = v; }, end(text) { this.text = text; } };
  const req = { method, query, body, url: '/api/briefing', headers: { host: 'site.test', origin: 'http://site.test', 'content-type': 'application/json', ...headers }, socket: {} };
  return handler(req, res).then(() => ({ ...res, json: res.text ? JSON.parse(res.text) : null }));
}
const post = (token, extra = {}) => ({ method: 'POST', body: { token, answers: full(), website: '', startedAt: 10_000_000 - MIN_FILL_MS - 1000, ...extra } });

test('rota: código com formato inválido não lê o Blob', async () => {
  const { mem, handler } = setup();
  const res = await call(handler, { query: { token: '../../etc/passwd' } });
  assert.equal(res.json.state, 'missing');
  assert.equal((await call(handler, post('curto'))).statusCode, 400);
  assert.deepEqual(mem.ops, []);
  assert.equal(res.headers['cache-control'], 'no-store');
  assert.equal(res.headers['x-robots-tag'], 'noindex, nofollow');
  assert.equal(res.headers['referrer-policy'], 'no-referrer');
});

test('rota: estados aberto, respondido, vencido e inexistente (sem dados pessoais)', async () => {
  let clock = 10_000_000;
  const { store, handler } = setup({ now: () => clock });
  const item = await store.create('lead-secreto', clock + DAY);
  let res = await call(handler, { query: { token: item.token } });
  assert.deepEqual(Object.keys(res.json).sort(), ['serverTime', 'state']);
  assert.equal(res.json.state, 'open');
  assert.equal((await call(handler, { query: { token: 'A'.repeat(22) } })).json.state, 'missing');
  assert.equal((await call(handler, post(item.token))).json.ok, true);
  assert.equal((await call(handler, { query: { token: item.token } })).json.state, 'answered');
  const second = await call(handler, post(item.token));
  assert.equal(second.statusCode, 409);
  const other = await store.create('lead2', clock + DAY);
  clock += 2 * DAY;
  assert.equal((await call(handler, { query: { token: other.token } })).json.state, 'expired');
  assert.equal((await call(handler, post(other.token, { startedAt: clock - 5000 }))).statusCode, 404);
});

test('rota: recusa honeypot preenchido, envio rápido demais e respostas ruins', async () => {
  const { store, handler, mem } = setup();
  const item = await store.create('l', 10_000_000 + DAY);
  const puts = () => mem.ops.filter(o => o.startsWith('put promisa/v1/briefing-answers')).length;
  assert.equal((await call(handler, post(item.token, { website: 'http://spam' }))).statusCode, 400);
  const fast = await call(handler, post(item.token, { startedAt: 10_000_000 - 500 }));
  assert.equal(fast.statusCode, 400);
  assert.match(fast.json.error, /segundos/);
  assert.equal((await call(handler, post(item.token, { startedAt: undefined }))).statusCode, 400);
  const missing = await call(handler, post(item.token, { answers: { ...full(), q2: '' } }));
  assert.equal(missing.statusCode, 400);
  assert.equal(missing.json.field, 'q2');
  assert.equal((await call(handler, post(item.token, { answers: { ...full(), q7: { selected: ['Inventada'], other: '' } } }))).statusCode, 400);
  assert.equal(puts(), 0);
});

test('rota: recusa origem diferente, formato errado e corpo grande', async () => {
  const { store, handler } = setup();
  const item = await store.create('l', 10_000_000 + DAY);
  assert.equal((await call(handler, { ...post(item.token), headers: { origin: 'http://evil.test' } })).statusCode, 403);
  assert.equal((await call(handler, { ...post(item.token), headers: { origin: undefined } })).statusCode, 403);
  assert.equal((await call(handler, { ...post(item.token), headers: { 'content-type': 'text/plain' } })).statusCode, 415);
  assert.equal((await call(handler, post(item.token, { answers: { ...full(), q1: 'x'.repeat(70_000) } }))).statusCode, 413);
  assert.equal((await call(handler, { method: 'PUT' })).statusCode, 405);
});

test('rota: limite de 5 envios por IP em 10 minutos', async () => {
  let clock = 10_000_000;
  const { store, handler } = setup({ now: () => clock, allow: createRateLimiter({ now: () => clock }) });
  const item = await store.create('l', clock + DAY);
  const bad = post(item.token, { website: 'x' });
  for (let i = 0; i < 5; i++) assert.equal((await call(handler, bad)).statusCode, 400);
  const blocked = await call(handler, post(item.token));
  assert.equal(blocked.statusCode, 429);
  assert.equal(blocked.headers['retry-after'], '600');
  clock += 11 * 60 * 1000;
  assert.equal((await call(handler, post(item.token, { startedAt: clock - 5000 }))).json.ok, true);
});

test('índice público fica em um único caminho de Blob', () => {
  assert.equal(BRIEFINGS, 'promisa/v1/briefings.json');
});

test('código assinado: guarda validade, recusa assinatura falsa e outro segredo', () => {
  const token = newToken('s1', 1_000_000_000, 2_000_000_000);
  assert.match(token, TOKEN);
  assert.deepEqual(readToken('s1', token), { createdAt: 1_000_000_000, expiresAt: 2_000_000_000 });
  assert.equal(readToken('s2', token), null);
  const flipped = token.slice(0, 5) + (token[5] === 'A' ? 'B' : 'A') + token.slice(6);
  assert.equal(readToken('s1', flipped), null);
  assert.equal(readToken('', token), null);
  assert.equal(readToken('s1', 'A'.repeat(32)), null);
});

test('rota: códigos inventados, vencidos ou apagados não leem o Blob', async () => {
  let clock = 10_000_000;
  const mem = memoryBlob(), store = createBriefingStore({ ...mem, now: () => clock });
  const handler = createBriefingHandler({ find: t => store.find(t), submit: (t, a) => store.submit(t, a), sameOrigin, now: () => clock });
  const item = await store.create('lead1', clock + DAY);
  const forged = newToken('outro-segredo', clock, clock + DAY);
  clock += 120_000;
  mem.ops.length = 0;
  // primeira visita ao código real: uma leitura; as seguintes usam a cópia
  for (let i = 0; i < 5; i++) assert.equal((await call(handler, { query: { token: item.token } })).json.state, 'open');
  assert.equal(mem.ops.length, 1);
  for (let i = 0; i < 20; i++) assert.equal((await call(handler, { query: { token: forged } })).json.state, 'missing');
  assert.equal((await call(handler, post(forged, { startedAt: clock - 5000 }))).statusCode, 404);
  assert.equal(mem.ops.length, 1);
  // apagado (LGPD): assinado e dentro da validade, mas a cópia é mais nova que o código
  await store.deleteLead('lead1');
  mem.ops.length = 0;
  for (let i = 0; i < 10; i++) assert.equal((await call(handler, { query: { token: item.token } })).json.state, 'missing');
  assert.deepEqual(mem.ops, []);
  // vencido: decidido pelo próprio código, sem leitura
  const later = await store.create('lead2', clock + 10 * 60_000);
  clock += DAY;
  mem.ops.length = 0;
  assert.equal((await call(handler, { query: { token: later.token } })).json.state, 'expired');
  assert.deepEqual(mem.ops, []);
});

test('rota: código respondido fica lembrado e não gera nova leitura', async () => {
  let clock = 10_000_000;
  const mem = memoryBlob(), store = createBriefingStore({ ...mem, now: () => clock });
  const handler = createBriefingHandler({ find: t => store.find(t), submit: (t, a) => store.submit(t, a), sameOrigin, now: () => clock, allow: () => true });
  const item = await store.create('l', clock + DAY);
  clock += 120_000;
  assert.equal((await call(handler, post(item.token, { startedAt: clock - 5000 }))).json.ok, true);
  mem.ops.length = 0;
  for (let i = 0; i < 10; i++) assert.equal((await call(handler, post(item.token, { startedAt: clock - 5000 }))).statusCode, 409);
  assert.equal((await call(handler, { query: { token: item.token } })).json.state, 'answered');
  assert.deepEqual(mem.ops, []);
});

test('dois envios simultâneos: só um grava, o outro é recusado', async () => {
  const mem = memoryBlob(), store = createBriefingStore({ ...mem, now: () => 1_000_000, cacheMs: 0 });
  const item = await store.create('l', 1_000_000 + DAY);
  const { answers } = validateAnswers(full());
  const results = await Promise.allSettled([store.submit(item.token, answers), store.submit(item.token, { ...answers, q1: 'outra' })]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.ok([409, 429].includes(results.find(r => r.status === 'rejected').reason.status));
  assert.equal((await store.getAnswers(item.token)).answers.q1, 'Padaria Doce Pão, alimentação');
  // em instâncias diferentes (sem memória compartilhada) a gravação condicional decide
  const other = createBriefingStore({ ...mem, now: () => 1_000_000, cacheMs: 0 });
  await assert.rejects(other.submit(item.token, answers), { status: 409 });
});

test('LGPD: excluir dados do cliente apaga respostas e links só dele', async () => {
  const mem = memoryBlob(), store = createBriefingStore({ ...mem, now: () => 1_000_000, cacheMs: 0 });
  const a1 = await store.create('alvo', 1_000_000 + DAY), a2 = await store.create('alvo', 1_000_000 + DAY), keep = await store.create('outro', 1_000_000 + DAY);
  const { answers } = validateAnswers(full());
  await store.submit(a1.token, answers);
  await store.submit(keep.token, answers);
  assert.deepEqual(await store.deleteLead('alvo'), { ok: true, removed: 2 });
  assert.equal(mem.objects.has(answersPath(a1.token)), false);
  assert.equal(mem.objects.has(answersPath(keep.token)), true);
  assert.deepEqual((await store.list()).map(i => i.leadId), ['outro']);
  await assert.rejects(store.getAnswers(a1.token), { status: 404 });
  assert.equal(await store.find(a2.token), null);
  assert.deepEqual(await store.deleteLead('alvo'), { ok: true, removed: 0 });
  await assert.rejects(store.deleteLead('../x'), { status: 400 });
});

test('validação remove controles de direção do texto', () => {
  const result = validateAnswers({ ...full(), q1: 'abc\u202Eevil\u2066x', q3: { selected: [], other: 'a\nb\u202Ec' } });
  assert.equal(result.answers.q1, 'abcevilx');
  assert.equal(result.answers.q3.other, 'abc');
});
