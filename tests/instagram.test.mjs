import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { createInstagramClient, createTokenManager, fingerprint, InstagramError, REFRESH_AFTER_MS, EXPIRING_AFTER_MS, GRAPH, API_VERSION } from '../lib/instagram.js';
import { createInstagramStore, normalizeHistory, emptyHistory, MAX_DAILY, MAX_POSTS, HISTORY, TOKEN_PATH } from '../lib/instagram-store.js';
import { createInstagramService, mergeSync, mergeFailure } from '../lib/instagram-sync.js';
import { createInstagramHandler, cleanGoals, cleanCount } from '../lib/instagram-handler.js';
import { buildInstagramEmbed, buildInstagramSummaryField, buildWeeklyEmbed, isMonday } from '../lib/instagram-report.js';
import { createEvents, buildDashboard, buildSummary } from '../lib/discord-events.js';
import { createDiscordHandler, boundedInstagramCron } from '../lib/discord-handler.js';
import { buildPayload } from '../lib/discord.js';
import { validateRecord, validateState } from '../src/data-validation.js';
import { projectFollowers, projectionText, followersDelta, clientsProgress, countInstagramLeads, leadMonth, dayKey, ORIGENS } from '../src/instagram-math.js';

const NOW = Date.UTC(2026, 10, 9, 12, 0, 0); // segunda-feira, 09/11/2026 09:00 em São Paulo
const DAY = 86_400_000;
const TOKEN = 'IGAA-SECRET-TOKEN-' + 'x'.repeat(60);
const NEW_TOKEN = 'IGAA-REFRESHED-TOKEN-' + 'y'.repeat(60);
const ENV = { INSTAGRAM_TOKEN: TOKEN };

// ---------- Instagram falso ----------
function fakeInstagram({ followers = 1000, media = null, failInsights = () => false, failMe = null, refresh = null } = {}) {
  const calls = [];
  const posts = media || [
    { id: 'm1', caption: 'Primeiro  post\ncom   quebra', media_type: 'VIDEO', media_product_type: 'REELS', permalink: 'https://www.instagram.com/reel/AAA/', timestamp: new Date(NOW - 2 * DAY).toISOString(), like_count: 30, comments_count: 4 },
    { id: 'm2', caption: 'Carrossel', media_type: 'CAROUSEL_ALBUM', media_product_type: 'FEED', permalink: 'https://www.instagram.com/p/BBB/', timestamp: new Date(NOW - 5 * DAY).toISOString(), like_count: 12, comments_count: 1 },
    { id: 'm3', caption: 'Antigo', media_type: 'IMAGE', media_product_type: 'FEED', permalink: 'https://www.instagram.com/p/CCC/', timestamp: new Date(NOW - 80 * DAY).toISOString(), like_count: 3, comments_count: 0 }
  ];
  const fetch = async (url, init = {}) => {
    const u = new URL(url);
    calls.push({ url, path: u.pathname, params: Object.fromEntries(u.searchParams), method: init.method });
    const reply = (status, data) => ({ status, ok: status >= 200 && status < 300, json: async () => data });
    const token = u.searchParams.get('access_token');
    if (u.pathname === '/refresh_access_token') {
      if (refresh === 'recent') return reply(400, { error: { message: 'Token must be at least 24 hours old to refresh', code: 100 } });
      if (refresh === 'invalid') return reply(400, { error: { message: 'Error validating access token', type: 'OAuthException', code: 190 } });
      return reply(200, { access_token: NEW_TOKEN, token_type: 'bearer', expires_in: 5184000 });
    }
    if (failMe || ![TOKEN, NEW_TOKEN].includes(token)) return reply(400, { error: { message: 'Invalid OAuth access token.', type: 'OAuthException', code: 190 } });
    if (u.pathname === `/${API_VERSION}/me`) return reply(200, { user_id: '1', username: 'promisa.digital', followers_count: followers, follows_count: 50, media_count: 12 });
    if (u.pathname === `/${API_VERSION}/me/media`) return reply(200, { data: posts });
    const insight = /^\/v[\d.]+\/([^/]+)\/insights$/.exec(u.pathname);
    if (insight) {
      const metrics = u.searchParams.get('metric').split(',');
      if (failInsights(insight[1], metrics)) return reply(400, { error: { message: 'metric not supported', code: 100 } });
      return reply(200, { data: metrics.map(name => ({ name, period: 'lifetime', values: [{ value: { reach: 500, views: 900, saved: 7, shares: 3, total_interactions: 44 }[name] }] })) });
    }
    return reply(404, {});
  };
  return { fetch, calls };
}

// ---------- Blob falso (com ETag, para provar o ifMatch) ----------
function fakeBlob() {
  const files = new Map(), puts = [];
  let version = 0;
  const notFound = () => Object.assign(new Error('not found'), { name: 'BlobNotFoundError' });
  return {
    files, puts,
    head: async path => { const f = files.get(path); if (!f) throw notFound(); return { etag: f.etag }; },
    get: async (path, opts) => { const f = files.get(path); if (!f) throw notFound(); assert.equal(opts.access, 'private'); return { stream: Readable.toWeb(Readable.from([Buffer.from(f.body)])), blob: { size: f.body.length } }; },
    put: async (path, body, opts) => {
      puts.push({ path, body, opts });
      assert.equal(opts.access, 'private');
      const f = files.get(path);
      if (f && !opts.allowOverwrite) throw new Error('already exists');
      if (f && opts.ifMatch && opts.ifMatch !== f.etag) throw new Error('precondition failed');
      files.set(path, { body, etag: 'e' + (++version) });
      return { pathname: path };
    }
  };
}
const memoryStore = () => createInstagramStore({ memory: () => true, token: () => '' });
const quietLog = () => { const lines = []; return { lines, error: (...a) => lines.push(a.join(' ')), warn: (...a) => lines.push(a.join(' ')), log: (...a) => lines.push(a.join(' ')) }; };

// ---------- req/res ----------
function request({ method = 'POST', headers = { 'content-type': 'application/json' }, body } = {}) {
  const req = Readable.from(body === undefined ? [] : [Buffer.from(typeof body === 'string' ? body : JSON.stringify(body))]);
  Object.assign(req, { method, headers, url: '/api/instagram' });
  return req;
}
function response() {
  const res = { headers: {}, statusCode: 200, body: '', setHeader(k, v) { this.headers[k.toLowerCase()] = v; }, end(text) { this.body = text ?? ''; } };
  Object.defineProperty(res, 'json', { get() { return this.body ? JSON.parse(this.body) : null; } });
  return res;
}
async function call(handler, req) { const res = response(); await handler(req, res); return res; }

// ================= cliente da API =================
test('cliente: lê perfil e posts (tipos, legenda curta, link só do Instagram) usando graph.instagram.com e o token só na consulta', async () => {
  const fake = fakeInstagram();
  const client = createInstagramClient({ fetch: fake.fetch });
  const me = await client.me(TOKEN);
  assert.deepEqual(me, { username: 'promisa.digital', followers: 1000, follows: 50, media: 12 });
  const media = await client.media(TOKEN);
  assert.equal(media.length, 3);
  assert.equal(media[0].type, 'REELS'); assert.equal(media[1].type, 'CAROUSEL'); assert.equal(media[2].type, 'IMAGE');
  assert.equal(media[0].caption, 'Primeiro post com quebra');
  assert.ok(fake.calls.every(c => c.url.startsWith(GRAPH + '/')));
  assert.match(fake.calls[0].params.fields, /followers_count/);
  assert.match(fake.calls[1].params.fields, /media_product_type/);
  assert.equal(fake.calls[1].params.limit, '25');
  const odd = await createInstagramClient({ fetch: async () => ({ status: 200, ok: true, json: async () => ({ data: [{ id: '9', timestamp: new Date(NOW).toISOString(), permalink: 'https://evil.test/x', caption: 'x'.repeat(500) }, { id: 'sem-data' }] }) }) }).media(TOKEN);
  assert.equal(odd.length, 1); assert.equal(odd[0].permalink, ''); assert.equal(odd[0].caption.length, 140);
});

test('cliente: erro de token vira tokenInvalid e a mensagem nunca carrega o token nem a URL', async () => {
  const client = createInstagramClient({ fetch: fakeInstagram().fetch });
  await assert.rejects(client.me('token-errado-123'), error => {
    assert.ok(error instanceof InstagramError); assert.equal(error.tokenInvalid, true); assert.equal(error.code, 'token-invalid');
    assert.doesNotMatch(error.message + JSON.stringify(error) + error.stack, /token-errado-123|graph\.instagram|access_token/);
    return true;
  });
  const down = createInstagramClient({ fetch: async () => { throw new Error('connect ECONNREFUSED ' + TOKEN); } });
  await assert.rejects(down.me(TOKEN), error => { assert.equal(error.code, 'network'); assert.doesNotMatch(error.message, /IGAA/); return true; });
  const limited = createInstagramClient({ fetch: async () => ({ status: 429, ok: false, json: async () => ({}) }) });
  await assert.rejects(limited.me(TOKEN), error => error.code === 'rate-limited');
});

test('insights: pedido completo; se a métrica não vale para o tipo, pede uma por vez, guarda só o que veio e lembra o que falhou', async () => {
  const fake = fakeInstagram({ failInsights: (id, metrics) => metrics.length > 1 || metrics[0] === 'views' });
  const client = createInstagramClient({ fetch: fake.fetch });
  const skip = new Set();
  const first = await client.insights(TOKEN, 'm1', { skip, prefix: 'REELS:' });
  assert.deepEqual(first, { reach: 500, saved: 7, shares: 3, total_interactions: 44 });
  assert.ok(skip.has('REELS:views'));
  const before = fake.calls.length;
  await client.insights(TOKEN, 'm9', { skip, prefix: 'REELS:' });
  assert.ok(!fake.calls.slice(before).some(c => c.params.metric === 'views'), 'não repete a métrica recusada');
  const ok = await createInstagramClient({ fetch: fakeInstagram().fetch }).insights(TOKEN, 'm1');
  assert.deepEqual(Object.keys(ok).sort(), ['reach', 'saved', 'shares', 'total_interactions', 'views']);
  // token inválido não é "métrica recusada": sobe o erro
  await assert.rejects(createInstagramClient({ fetch: fakeInstagram().fetch }).insights('ruim', 'm1'), e => e.tokenInvalid);
});

// ================= renovação do token =================
test('token: sem cópia renovada tenta renovar e guarda no Blob privado; com menos de 45 dias não chama a Meta', async () => {
  const fake = fakeInstagram(), blob = fakeBlob();
  const store = createInstagramStore({ get: blob.get, head: blob.head, put: blob.put, token: () => 'blob-rw', memory: () => false });
  let now = NOW;
  const manager = createTokenManager({ client: createInstagramClient({ fetch: fake.fetch }), store, env: ENV, now: () => now });
  assert.equal(manager.configured(), true);
  const first = await manager.ensure();
  assert.deepEqual([first.token, first.refreshed], [NEW_TOKEN, true]);
  assert.equal(fake.calls.filter(c => c.path === '/refresh_access_token').length, 1);
  const saved = JSON.parse(blob.files.get(TOKEN_PATH).body);
  assert.deepEqual(Object.keys(saved).sort(), ['envFp', 'refreshedAt', 'token']);
  assert.equal(saved.token, NEW_TOKEN); assert.equal(saved.refreshedAt, NOW); assert.equal(saved.envFp, fingerprint(TOKEN));
  assert.equal(blob.puts.at(-1).opts.access, 'private');
  // 44 dias depois: usa o token guardado, sem chamar a Meta
  now = NOW + 44 * DAY;
  const again = await manager.ensure();
  assert.deepEqual([again.token, again.refreshed], [NEW_TOKEN, false]);
  assert.equal(fake.calls.filter(c => c.path === '/refresh_access_token').length, 1);
  // 46 dias depois: renova de novo e regrava
  now = NOW + 46 * DAY;
  assert.equal((await manager.ensure()).refreshed, true);
  assert.equal(JSON.parse(blob.files.get(TOKEN_PATH).body).refreshedAt, now);
  assert.equal(fake.calls.filter(c => c.path === '/refresh_access_token').length, 2);
  assert.ok(REFRESH_AFTER_MS === 45 * DAY && EXPIRING_AFTER_MS === 50 * DAY);
});

test('token: variável trocada na Vercel vale mais que a cópia antiga do Blob; token com menos de 24 h segue com o atual', async () => {
  const blob = fakeBlob();
  const store = createInstagramStore({ get: blob.get, head: blob.head, put: blob.put, token: () => 'blob-rw', memory: () => false });
  await store.writeToken({ token: 'IGAA-OLD-BLOB-' + 'z'.repeat(40), refreshedAt: NOW - DAY, envFp: fingerprint('IGAA-OTHER-ENV-' + 'w'.repeat(40)) });
  const fake = fakeInstagram({ refresh: 'recent' });
  const manager = createTokenManager({ client: createInstagramClient({ fetch: fake.fetch }), store, env: ENV, now: () => NOW });
  const result = await manager.ensure();
  assert.equal(result.token, TOKEN, 'a variável nova vence');
  assert.equal(result.refreshed, false);
  assert.equal(result.expiring, false);
  assert.equal(createTokenManager({ client: {}, store, env: {} }).configured(), false);
  assert.equal(await createTokenManager({ client: {}, store, env: {} }).ensure(), null);
});

test('token: cópia velha que não renova avisa "expiring"; token recusado sobe o erro', async () => {
  const blob = fakeBlob();
  const store = createInstagramStore({ get: blob.get, head: blob.head, put: blob.put, token: () => 'blob-rw', memory: () => false });
  await store.writeToken({ token: TOKEN, refreshedAt: NOW - 52 * DAY, envFp: fingerprint(TOKEN) });
  const flaky = createInstagramClient({ fetch: async () => ({ status: 500, ok: false, json: async () => ({}) }) });
  const result = await createTokenManager({ client: flaky, store, env: ENV, now: () => NOW }).ensure();
  assert.deepEqual([result.token, result.refreshed, result.expiring], [TOKEN, false, true]);
  const invalid = createInstagramClient({ fetch: fakeInstagram({ refresh: 'invalid' }).fetch });
  await assert.rejects(createTokenManager({ client: invalid, store, env: ENV, now: () => NOW }).ensure(), e => e.tokenInvalid);
});

// ================= histórico e atualização =================
test('mergeSync: um registro por dia (o mesmo dia é atualizado), legenda curta, métricas só nos posts recentes', () => {
  const me = { username: 'promisa.digital', followers: 1000, follows: 50, media: 12 };
  const media = [{ id: 'a', type: 'REELS', permalink: 'https://www.instagram.com/reel/A/', timestamp: new Date(NOW - DAY).toISOString(), caption: 'x', likes: 5, comments: 1 }];
  let h = mergeSync(emptyHistory(), { me, media, insights: { a: { reach: 10, views: 20, saved: 1, shares: 2, total_interactions: 8 } }, at: NOW });
  assert.equal(h.daily.length, 1); assert.deepEqual(h.daily[0], { date: '2026-11-09', followers: 1000, media: 12 });
  assert.deepEqual([h.posts[0].reach, h.posts[0].views, h.posts[0].interactions], [10, 20, 8]);
  h = mergeSync(h, { me: { ...me, followers: 1010 }, media, insights: {}, at: NOW + 3 * 3_600_000 });
  assert.equal(h.daily.length, 1, 'mesmo dia'); assert.equal(h.daily[0].followers, 1010);
  assert.equal(h.posts[0].views, 20, 'não apaga métrica antiga quando a nova não veio');
  h = mergeSync(h, { me: { ...me, followers: 1020 }, media, insights: {}, at: NOW + DAY });
  assert.deepEqual(h.daily.map(d => d.date), ['2026-11-09', '2026-11-10']);
  // fuso de São Paulo: 02:00 UTC ainda é o dia anterior
  const late = mergeSync(emptyHistory(), { me, media: [], at: Date.UTC(2026, 10, 10, 2, 0, 0) });
  assert.equal(late.daily[0].date, '2026-11-09');
});

test('limites: 400 dias de histórico, 60 posts, só o formato conhecido é aceito', () => {
  const me = { username: 'u', followers: 1, follows: 0, media: 0 };
  let h = emptyHistory();
  for (let i = 0; i < 405; i++) h = normalizeHistory(mergeSync(h, { me: { ...me, followers: i }, media: [], at: Date.UTC(2025, 0, 1, 12) + i * DAY }));
  assert.equal(h.daily.length, MAX_DAILY);
  assert.equal(h.daily.at(-1).followers, 404);
  const many = Array.from({ length: 90 }, (_, i) => ({ id: 'p' + i, type: 'IMAGE', permalink: '', timestamp: new Date(NOW - i * DAY).toISOString(), caption: '', likes: i, comments: 0 }));
  const withPosts = normalizeHistory(mergeSync(emptyHistory(), { me, media: many, at: NOW }));
  assert.equal(withPosts.posts.length, MAX_POSTS);
  assert.equal(withPosts.posts[0].id, 'p0');
  assert.deepEqual(normalizeHistory({ version: 2, daily: [1] }), emptyHistory());
  const dirty = normalizeHistory({ version: 1, token: 'segredo', daily: [{ date: 'x', followers: 1 }, { date: '2026-11-01', followers: 3, extra: 1 }], goals: { followers: { target: -4, deadline: '2026-13-01' }, clientsPerMonth: { target: 5 } }, clientsByMonth: { '2026-11': { leads: 3, clients: 1, nome: 'Maria' }, ruim: { leads: 1, clients: 1 } } });
  assert.deepEqual(dirty.daily, [{ date: '2026-11-01', followers: 3, media: 0 }]);
  assert.deepEqual(dirty.goals, { followers: null, clientsPerMonth: { target: 5 } });
  assert.deepEqual(Object.keys(dirty.clientsByMonth), ['2026-11']);
  assert.equal(JSON.stringify(dirty).includes('segredo'), false);
  assert.equal(JSON.stringify(dirty).includes('Maria'), false);
});

test('armazenamento no Blob: grava privado com ifMatch, tenta de novo se houve conflito e lê token à parte', async () => {
  const blob = fakeBlob();
  const store = createInstagramStore({ get: blob.get, head: blob.head, put: blob.put, token: () => 'blob-rw', memory: () => false });
  assert.deepEqual(await store.read(), emptyHistory());
  await store.update(h => ({ ...h, lastSync: 'a' }));
  assert.equal(blob.puts[0].opts.allowOverwrite, false);
  let conflicts = 1;
  const realPut = blob.put;
  const flaky = createInstagramStore({ get: blob.get, head: blob.head, token: () => 'blob-rw', memory: () => false, put: async (...args) => { if (conflicts-- > 0) throw new Error('precondition failed'); return realPut(...args); } });
  const saved = await flaky.update(h => ({ ...h, lastSync: 'b' }));
  assert.equal(saved.lastSync, 'b');
  assert.ok(blob.puts.at(-1).opts.ifMatch, 'usa ifMatch');
  assert.ok(blob.puts.every(p => p.opts.access === 'private'));
  assert.equal(blob.files.has(HISTORY), true);
  assert.equal(await store.readToken(), null);
  await assert.rejects(createInstagramStore({ token: () => '', memory: () => false }).read(), e => e.status === 503);
});

test('atualização: 1 perfil + 1 lista + métricas dos posts dos últimos 30 dias; grava uma vez; sem token vazado em log', async () => {
  const fake = fakeInstagram(), log = quietLog(), store = memoryStore();
  const service = createInstagramService({ store, client: createInstagramClient({ fetch: fake.fetch }), env: ENV, now: () => NOW, log });
  let writes = 0; const update = store.update; store.update = async change => (writes++, update(change));
  const result = await service.sync();
  assert.equal(result.ok, true);
  const paths = fake.calls.map(c => c.path.replace(/^\/v[\d.]+/, ''));
  assert.equal(paths.filter(p => p === '/me').length, 1);
  assert.equal(paths.filter(p => p === '/me/media').length, 1);
  assert.equal(paths.filter(p => /insights$/.test(p)).length, 2, 'só os 2 posts dos últimos 30 dias (o de 80 dias fica de fora)');
  assert.equal(writes, 1);
  assert.equal(result.history.account.followers, 1000);
  assert.equal(result.history.posts.length, 3);
  assert.equal(result.history.posts.find(p => p.id === 'm1').views, 900);
  assert.equal(result.history.posts.find(p => p.id === 'm3').views, undefined);
  assert.equal(JSON.stringify(result).includes('IGAA'), false);
  assert.equal(log.lines.join('\n').includes('IGAA'), false);
  assert.equal(service.configured(), true);
});

test('atualização: duas chamadas ao mesmo tempo dividem a execução; token inválido registra falha e conta dias seguidos', async () => {
  const fake = fakeInstagram(), store = memoryStore();
  let now = NOW;
  const service = createInstagramService({ store, client: createInstagramClient({ fetch: fake.fetch }), env: ENV, now: () => now, log: quietLog() });
  const [a, b] = await Promise.all([service.sync(), service.sync()]);
  assert.equal(a, b);
  assert.equal(fake.calls.filter(c => c.path.endsWith('/me')).length, 1);
  const broken = createInstagramService({ store, client: createInstagramClient({ fetch: fakeInstagram({ failMe: true }).fetch }), env: ENV, now: () => now, log: quietLog() });
  let r = await broken.sync();
  assert.deepEqual([r.ok, r.code, r.tokenInvalid], [false, 'token-invalid', true]);
  assert.equal(r.history.failStreak, 1);
  r = await broken.sync();
  assert.equal(r.history.failStreak, 1, 'no mesmo dia conta uma vez');
  now += DAY;
  r = await broken.sync();
  assert.equal(r.history.failStreak, 2);
  assert.equal(r.history.lastError.code, 'token-invalid');
  assert.equal(r.history.account.followers, 1000, 'dados antigos continuam');
  now += DAY;
  assert.equal((await service.sync()).history.failStreak, 0, 'sucesso zera');
  assert.equal((await createInstagramService({ store, env: {} }).sync()).code, 'not-configured');
});

// ================= contas das metas =================
const series = (start, ...followers) => followers.map((f, i) => ({ date: new Date(Date.parse(start + 'T12:00:00Z') + i * DAY).toISOString().slice(0, 10), followers: f, media: 0 }));

test('meta de seguidores: no ritmo, abaixo do ritmo, batida, sem crescimento e poucos dados', () => {
  const daily = series('2026-10-27', ...Array.from({ length: 14 }, (_, i) => 1000 + i * 10)); // 27/10 .. 09/11: +10 por dia
  const today = '2026-11-09';
  const on = projectFollowers({ daily, goal: { target: 1330, deadline: '2026-12-31' }, today });
  assert.equal(on.status, 'on-pace'); assert.equal(on.current, 1130); assert.equal(on.perDayActual, 10); assert.equal(on.etaDate, '2026-11-29'); assert.equal(on.remaining, 200);
  assert.match(projectionText(on), /No ritmo atual você chega a 1\.330 em 29\/11 — precisa de \+3,8\/dia, está fazendo \+10\/dia/);
  const behind = projectFollowers({ daily, goal: { target: 2000, deadline: '2026-12-18' }, today });
  assert.equal(behind.status, 'behind'); assert.equal(behind.etaDate, '2027-02-04');
  assert.match(projectionText(behind), /só em 04\/02\/2027 \(depois do prazo\) — precisa de \+22,\d\/dia, está fazendo \+10\/dia/);
  assert.equal(behind.percent, 56);
  const done = projectFollowers({ daily, goal: { target: 1130, deadline: '2026-12-18' }, today });
  assert.deepEqual([done.status, done.percent, done.remaining], ['achieved', 100, 0]);
  assert.match(projectionText(done), /🎉 Meta batida/);
  const flat = projectFollowers({ daily: series('2026-10-27', ...Array(14).fill(1000)), goal: { target: 1100, deadline: '2026-12-18' }, today });
  assert.equal(flat.status, 'behind'); assert.equal(flat.etaDate, null); assert.match(projectionText(flat), /Sem crescimento/);
  const falling = projectFollowers({ daily: series('2026-10-27', ...Array.from({ length: 14 }, (_, i) => 1000 - i * 3)), goal: { target: 1100, deadline: '2026-12-18' }, today });
  assert.equal(falling.status, 'behind'); assert.ok(falling.perDayActual < 0); assert.match(projectionText(falling), /−3\/dia/);
  assert.equal(projectFollowers({ daily: series('2026-11-09', 1000), goal: { target: 1100, deadline: '2026-12-18' }, today }).status, 'nodata');
  assert.equal(projectFollowers({ daily, goal: null, today }).status, 'none');
  assert.equal(projectFollowers({ daily: [], goal: { target: 10, deadline: '2026-12-18' }, today }).status, 'nodata');
  const late = projectFollowers({ daily, goal: { target: 2000, deadline: '2026-11-01' }, today });
  assert.equal(late.status, 'behind'); assert.equal(late.perDayNeeded, null); assert.match(projectionText(late), /prazo .* já passou/);
  // janela de 14 dias: um salto antigo não distorce a tendência
  const jump = series('2026-09-01', 100, ...Array(60).fill(0).map((_, i) => i < 30 ? 500 : 500 + (i - 30)));
  assert.ok(projectFollowers({ daily: jump, goal: { target: 9999, deadline: '2026-12-31' }, today: '2026-10-31' }).perDayActual <= 1.01);
});

test('variação de seguidores e progresso de clientes', () => {
  const daily = series('2026-10-01', ...Array.from({ length: 40 }, (_, i) => 100 + i * 2)); // até 2026-11-09
  assert.deepEqual(followersDelta(daily, '2026-11-09', 7), { value: 14, days: 7, partial: false });
  assert.deepEqual(followersDelta(daily, '2026-11-09', 30), { value: 60, days: 30, partial: false });
  assert.deepEqual(followersDelta(daily.slice(-3), '2026-11-09', 7), { value: 4, days: 2, partial: true });
  assert.equal(followersDelta(daily.slice(-1), '2026-11-09', 7), null);
  assert.deepEqual(clientsProgress({ goal: { target: 4 }, counts: { leads: 6, clients: 1 } }), { target: 4, clients: 1, leads: 6, percent: 25, status: 'open' });
  assert.equal(clientsProgress({ goal: { target: 2 }, counts: { leads: 6, clients: 3 } }).status, 'achieved');
  assert.equal(clientsProgress({ goal: { target: 2 }, counts: { leads: 6, clients: 3 } }).percent, 100);
  assert.equal(clientsProgress({ goal: null, counts: null }).percent, 0);
});

test('clientes do Instagram no mês: conta pela origem e pela data de criação (id), e fecha pela etapa', () => {
  const id = (ms, tail = 'ab') => ms.toString(36) + tail;
  const leads = [
    { id: id(NOW - DAY), origem: 'instagram', stage: 'Fechado' },
    { id: id(NOW - 2 * DAY), origem: 'instagram', stage: 'Novo' },
    { id: id(NOW - 3 * DAY), origem: 'google', stage: 'Fechado' },
    { id: id(NOW - 40 * DAY), origem: 'instagram', stage: 'Fechado' },
    { id: 'legado', date: '2026-11-03', origem: 'instagram', stage: 'Em contato' },
    { id: 'sem-origem', date: '2026-11-03', stage: 'Fechado' }
  ];
  assert.deepEqual(countInstagramLeads(leads, '2026-11'), { leads: 3, clients: 1 });
  assert.equal(leadMonth(leads[3]), '2026-09');
  assert.equal(leadMonth({ id: 'x' }), '');
  assert.deepEqual(countInstagramLeads(null, '2026-11'), { leads: 0, clients: 0 });
});

// ================= rota do painel =================
function apiWorld({ authorized = true, origin = true, env = ENV, fake = fakeInstagram(), now = { t: NOW } } = {}) {
  const store = memoryStore();
  const service = createInstagramService({ store, client: createInstagramClient({ fetch: fake.fetch }), env, now: () => now.t, log: quietLog() });
  const changed = [], synced = [];
  const handler = createInstagramHandler({ service, authorized: async () => authorized, sameOrigin: () => origin, onChanged: () => changed.push(1), onSynced: r => synced.push(r), now: () => now.t, log: quietLog() });
  return { handler, store, service, changed, synced, fake, now };
}
const post = (w, body, extra = {}) => call(w.handler, request({ body, ...extra }));

test('rota: exige sessão (401), mesma origem (403) e JSON (415); só aceita POST', async () => {
  assert.equal((await post(apiWorld({ authorized: false }), { action: 'status' })).statusCode, 401);
  assert.equal((await post(apiWorld({ origin: false }), { action: 'status' })).statusCode, 403);
  assert.equal((await post(apiWorld(), { action: 'status' }, { headers: { 'content-type': 'text/plain' } })).statusCode, 415);
  const get = await call(apiWorld().handler, request({ method: 'GET' }));
  assert.equal(get.statusCode, 405); assert.equal(get.headers.allow, 'POST');
  assert.equal((await post(apiWorld(), '{nao json')).statusCode, 400);
  assert.equal((await post(apiWorld(), [1])).statusCode, 400);
  assert.equal((await post(apiWorld(), { action: 'apagar-tudo' })).statusCode, 400);
  assert.equal((await post(apiWorld(), { action: 'goals', lixo: 'x'.repeat(6000) })).statusCode, 413);
  const res = await post(apiWorld(), { action: 'status' });
  assert.equal(res.headers['cache-control'], 'private, no-store');
  assert.equal(res.headers['x-content-type-options'], 'nosniff');
});

test('rota status: devolve o histórico sem token e diz se o Instagram está conectado', async () => {
  const w = apiWorld();
  await w.service.sync();
  const res = await post(w, { action: 'status' });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json.configured, true);
  assert.equal(res.json.history.account.username, 'promisa.digital');
  assert.equal(res.body.includes('IGAA'), false);
  assert.equal(res.body.includes('access_token'), false);
  assert.equal(res.json.today, '2026-11-09');
  const off = await post(apiWorld({ env: {} }), { action: 'status' });
  assert.equal(off.json.configured, false);
});

test('rota sync: botão "Atualizar agora" atualiza e só deixa de novo depois de 10 minutos; sem token responde 503', async () => {
  const w = apiWorld();
  const first = await post(w, { action: 'sync' });
  assert.equal(first.statusCode, 200); assert.equal(first.json.history.account.followers, 1000);
  assert.equal(w.synced.length, 1); assert.equal(w.changed.length, 1);
  const calls = w.fake.calls.length;
  w.now.t += 5 * 60_000;
  const early = await post(w, { action: 'sync' });
  assert.equal(early.statusCode, 429); assert.equal(early.json.code, 'too-soon'); assert.ok(Number(early.headers['retry-after']) > 0);
  assert.equal(w.fake.calls.length, calls, 'não chamou o Instagram');
  w.now.t += 6 * 60_000;
  assert.equal((await post(w, { action: 'sync' })).statusCode, 200);
  // o limite vale também depois de reiniciar a função (fica gravado no histórico)
  const other = apiWorld({ now: w.now }); other.store.update = w.store.update.bind(w.store);
  const second = createInstagramHandler({ service: { ...w.service, configured: () => true }, authorized: async () => true, sameOrigin: () => true, now: () => w.now.t, log: quietLog() });
  assert.equal((await call(second, request({ body: { action: 'sync' } }))).statusCode, 429);
  const off = await post(apiWorld({ env: {} }), { action: 'sync' });
  assert.equal(off.statusCode, 503); assert.equal(off.json.code, 'not-configured');
  const bad = apiWorld({ fake: fakeInstagram({ failMe: true }) });
  const failed = await post(bad, { action: 'sync' });
  assert.equal(failed.statusCode, 502); assert.equal(failed.json.code, 'token-invalid'); assert.match(failed.json.error, /expirou/);
  assert.equal(bad.synced.length, 1, 'o aviso do Discord é chamado também na falha');
});

test('rota goals: valida com rigor e grava no histórico (o Discord enxerga)', async () => {
  const w = apiWorld();
  const ok = await post(w, { action: 'goals', followers: { target: 2000, deadline: '2026-12-18' }, clientsPerMonth: { target: 5 } });
  assert.equal(ok.statusCode, 200);
  assert.deepEqual((await w.store.read()).goals, { followers: { target: 2000, deadline: '2026-12-18' }, clientsPerMonth: { target: 5 } });
  assert.equal(w.changed.length, 1);
  await post(w, { action: 'goals', clientsPerMonth: null });
  assert.deepEqual((await w.store.read()).goals, { followers: { target: 2000, deadline: '2026-12-18' }, clientsPerMonth: null });
  const bads = [
    { followers: { target: 0, deadline: '2026-12-18' } }, { followers: { target: 1.5, deadline: '2026-12-18' } }, { followers: { target: '2000', deadline: '2026-12-18' } },
    { followers: { target: 100_000_001, deadline: '2026-12-18' } }, { followers: { target: 10, deadline: '2026-02-30' } }, { followers: { target: 10, deadline: '18/12/2026' } },
    { followers: { target: 10, deadline: '2026-11-08' } }, { followers: { target: 10, deadline: '2100-01-01' } }, { followers: { target: 10 } }, { followers: { target: 10, deadline: '2026-12-18', extra: 1 } },
    { clientsPerMonth: { target: -1 } }, { clientsPerMonth: { target: 1001 } }, { clientsPerMonth: { target: 2.5 } }, { clientsPerMonth: 5 }, { clientsPerMonth: { target: 1, nome: 'x' } }, {}, { followers: 'x' }, { outra: 1 }
  ];
  for (const bad of bads) assert.equal((await post(w, { action: 'goals', ...bad })).statusCode, 400, JSON.stringify(bad));
  assert.deepEqual((await w.store.read()).goals.followers, { target: 2000, deadline: '2026-12-18' }, 'nada inválido foi gravado');
  assert.ok(cleanGoals({ action: 'goals', followers: { target: 1, deadline: '2026-11-09' }, clientsPerMonth: { target: 0 } }, '2026-11-09').value);
});

test('rota clients-count: guarda só os números do mês (contatos e clientes), nada de dados pessoais', async () => {
  const w = apiWorld();
  const ok = await post(w, { action: 'clients-count', month: '2026-11', leads: 6, clients: 2 });
  assert.equal(ok.statusCode, 200);
  assert.deepEqual(Object.keys((await w.store.read()).clientsByMonth['2026-11']).sort(), ['clients', 'leads', 'updatedAt']);
  assert.deepEqual((await w.store.read()).clientsByMonth['2026-11'].leads, 6);
  const writes = w.changed.length;
  await post(w, { action: 'clients-count', month: '2026-11', leads: 6, clients: 2 });
  assert.equal((await w.store.read()).clientsByMonth['2026-11'].updatedAt, ok.json.clientsByMonth['2026-11'].updatedAt, 'igual: não regrava');
  assert.equal(w.changed.length, writes + 1);
  const bads = [
    { month: '2026-11', leads: 6, clients: 2, nome: 'Maria da Padaria' }, { month: '2026-11', leads: 6, clients: 2, lista: [{ client: 'Maria', contact: '11999999999' }] },
    { month: '2026-13', leads: 1, clients: 0 }, { month: '2026-11-01', leads: 1, clients: 0 }, { month: '2027-01', leads: 1, clients: 0 }, { month: '2020-01', leads: 1, clients: 0 },
    { month: '2026-11', leads: 2, clients: 3 }, { month: '2026-11', leads: -1, clients: 0 }, { month: '2026-11', leads: 1.5, clients: 0 }, { month: '2026-11', leads: '3', clients: 0 }, { month: '2026-11', leads: 1e6, clients: 0 }
  ];
  for (const bad of bads) assert.equal((await post(w, { action: 'clients-count', ...bad })).statusCode, 400, JSON.stringify(bad));
  assert.equal(JSON.stringify(await w.store.read()).includes('Maria'), false);
  assert.ok(cleanCount({ action: 'clients-count', month: '2026-10', leads: 0, clients: 0 }, NOW).value);
});

// ================= Discord =================
function history(overrides = {}) {
  const daily = series('2026-10-27', ...Array.from({ length: 14 }, (_, i) => 1000 + i * 10));
  return normalizeHistory({
    version: 1, account: { username: 'promisa.digital', followers: 1130, follows: 50, media: 12 }, daily,
    posts: [
      { id: 'm1', type: 'REELS', permalink: 'https://www.instagram.com/reel/AAA/', timestamp: new Date(NOW - 2 * DAY).toISOString(), caption: 'Reel', likes: 30, comments: 4, views: 900, reach: 500 },
      { id: 'm2', type: 'CAROUSEL', permalink: 'https://www.instagram.com/p/BBB/', timestamp: new Date(NOW - 5 * DAY).toISOString(), caption: 'Car', likes: 12, comments: 1, views: 300 },
      { id: 'm3', type: 'IMAGE', permalink: 'https://www.instagram.com/p/CCC/', timestamp: new Date(NOW - 20 * DAY).toISOString(), caption: 'Antigo', likes: 90, comments: 9, views: 5000 }
    ],
    goals: { followers: { target: 2000, deadline: '2026-12-18' }, clientsPerMonth: { target: 5 } },
    clientsByMonth: { '2026-11': { leads: 6, clients: 2 } }, lastSync: new Date(NOW).toISOString(), ...overrides
  });
}
const flat = embed => embed.fields.map(f => `${f.name}\n${f.value}`).join('\n');

test('Discord dashboard: quadro 📈 Instagram com seguidores (+7d), meta com barra e status, clientes do mês e último post', () => {
  const embed = buildInstagramEmbed(history(), NOW);
  const text = flat(embed);
  assert.equal(embed.title, '📈 Instagram');
  assert.match(text, /👥 Seguidores\n\*\*1\.130\*\*\n7 dias: \+70 em 7 dias/);
  assert.match(text, /🎯 Meta de seguidores\n▰+▱*.*\n1\.130 de 2\.000 até 18\/12 · ⚠️ Abaixo do ritmo/);
  assert.match(text, /🤝 Clientes do Instagram \(mês\)\n.*40%\n2 de 5 no mês\n6 contatos → 2 clientes/);
  assert.match(text, /📸 Último post\n\[Reels de 07\/11\]\(https:\/\/www\.instagram\.com\/reel\/AAA\/\)\n❤️ 30 · 💬 4 · 👁 900/);
  const dash = buildDashboard({ manifest: null, shares: null, diagnosticos: null, published: null, instagram: history(), at: NOW });
  assert.equal(dash.embeds.length, 3);
  assert.equal(dash.embeds[1].title, '📈 Instagram');
  assert.match(dash.embeds.at(-1).footer, /dashboard · atualizado/, 'o marcador continua no último quadro');
  const payload = buildPayload(dash, NOW);
  assert.ok(payload.embeds.every(e => (e.fields || []).every(f => f.value.length <= 1024)));
  assert.ok(payload.embeds.reduce((n, e) => n + (e.title?.length || 0) + (e.description?.length || 0) + (e.footer?.text.length || 0) + (e.author?.name.length || 0) + (e.fields || []).reduce((m, f) => m + f.name.length + f.value.length, 0), 0) <= 6000);
  assert.equal(JSON.stringify(dash).includes('IGAA'), false);
});

test('Discord dashboard e resumo: sem Instagram conectado (ou sem dados) nada aparece', () => {
  for (const none of [undefined, null, emptyHistory(), { ...emptyHistory(), account: { username: 'x', followers: 1 } }]) {
    assert.equal(buildInstagramEmbed(none, NOW), null);
    assert.equal(buildInstagramSummaryField(none, NOW), null);
    assert.equal(buildWeeklyEmbed(none, NOW), null);
    const dash = buildDashboard({ manifest: null, shares: null, diagnosticos: null, published: null, instagram: none, at: NOW });
    assert.equal(dash.embeds.length, 2);
    assert.ok(dash.embeds.every(e => !/Instagram/.test(e.title)));
    assert.equal(buildSummary({ manifest: null, shares: null, diagnosticos: null, published: null, instagram: none, at: NOW }).fields.length, 4);
  }
  const noGoals = buildInstagramEmbed(history({ goals: { followers: null, clientsPerMonth: null }, clientsByMonth: {} }), NOW);
  assert.ok(!/Meta de seguidores|Clientes do Instagram/.test(flat(noGoals)));
});

test('Discord resumo do dia: variação de seguidores e situação da meta; semana de segunda-feira com melhor post', () => {
  const field = buildInstagramSummaryField(history(), NOW);
  assert.equal(field.name, '📈 Instagram');
  assert.match(field.value, /\*\*1\.130\*\* seguidores \(\+10 desde ontem\)\nMeta 2\.000: ⚠️ Abaixo do ritmo/);
  const summary = buildSummary({ manifest: null, shares: null, diagnosticos: null, published: null, instagram: history(), at: NOW });
  assert.equal(summary.fields.at(-1).name, '📈 Instagram');
  assert.equal(isMonday(NOW), true); assert.equal(isMonday(NOW + DAY), false);
  const weekly = buildWeeklyEmbed(history(), NOW);
  assert.equal(weekly.title, '📈 Semana no Instagram');
  const text = flat(weekly);
  assert.match(text, /\+70 na semana/);
  assert.match(text, /📝 Posts na semana\n\*\*2\*\*/);
  assert.match(text, /🏆 Melhor post\n\[Reels de 07\/11\].*\n👁 900 visualizações/, 'o post de 20 dias, mesmo com mais views, fica fora da semana');
  assert.match(text, /No ritmo atual você chega|só em/);
  const done = buildInstagramSummaryField(history({ goals: { followers: { target: 1100, deadline: '2026-12-18' }, clientsPerMonth: null } }), NOW);
  assert.match(done.value, /🎉 Meta batida/);
});

function eventsWorld({ env = ENV, fake = fakeInstagram(), clock = { now: NOW }, notifyOk = true } = {}) {
  const store = memoryStore();
  const service = createInstagramService({ store, client: createInstagramClient({ fetch: fake.fetch }), env, now: () => clock.now, log: quietLog() });
  const notes = [], dashboards = [], jobs = [];
  const discord = {
    configured: () => true,
    notify: async (kind, message, opts) => { notes.push({ kind, message, opts }); return notifyOk; },
    upsertDashboard: async payload => { dashboards.push(payload); return { ok: true }; }
  };
  const events = createEvents({
    discord, now: () => clock.now, base: () => 'https://www.promisa.online', waitUntil: p => jobs.push(p), instagram: service,
    data: { manifest: async () => ({ records: {} }), siteName: async () => '' }, shares: { all: async () => [] }, diagnosticos: { list: async () => [] }, publishedStore: { list: async () => ({}) }
  });
  return { events, service, store, notes, dashboards, jobs, clock, fake, discord };
}

test('cron: atualiza o Instagram, posta a semana na segunda e o dashboard/resumo usam o mesmo histórico (sem ler de novo)', async () => {
  const w = eventsWorld();
  await w.store.update(h => ({ ...h, goals: { followers: { target: 2000, deadline: '2026-12-18' }, clientsPerMonth: { target: 5 } }, daily: series('2026-10-27', ...Array.from({ length: 13 }, (_, i) => 1000 + i * 10)) }));
  let reads = 0; const read = w.store.read; w.store.read = async () => (reads++, read());
  const handler = createDiscordHandler({ discord: w.discord, commands: {}, events: w.events, authorized: async () => false, sameOrigin: () => true, env: { CRON_SECRET: 'c'.repeat(40) }, log: quietLog() });
  const req = Readable.from([]); Object.assign(req, { method: 'GET', headers: { authorization: 'Bearer ' + 'c'.repeat(40) }, query: { cron: 'summary' }, url: '/api/discord?cron=summary' });
  const res = await call(handler, req);
  assert.equal(res.statusCode, 200);
  assert.equal(reads, 0, 'o histórico da atualização é reaproveitado');
  const kinds = w.notes.map(n => n.kind);
  assert.deepEqual(kinds, ['resumo-do-dia', 'resumo-do-dia'], 'semana + resumo');
  assert.equal(w.notes[0].message.title, '📈 Semana no Instagram');
  assert.ok(w.notes[1].message.fields.some(f => f.name === '📈 Instagram'));
  assert.equal(w.dashboards.length, 1);
  assert.ok(w.dashboards[0].embeds.some(e => e.title === '📈 Instagram'));
  assert.equal((await w.store.read()).lastWeekly, '2026-11-09');
  // segunda atualização no mesmo dia: não repete a semana
  w.notes.length = 0;
  await w.events.instagramCron();
  assert.equal(w.notes.length, 0);
  // outro dia da semana: sem resumo semanal
  const tue = eventsWorld({ clock: { now: NOW + DAY } });
  await tue.events.instagramCron();
  assert.equal(tue.notes.filter(n => n.message.title === '📈 Semana no Instagram').length, 0);
  // sem INSTAGRAM_TOKEN: nada acontece, nenhuma chamada
  const off = eventsWorld({ env: {} });
  assert.equal(await off.events.instagramCron(), undefined);
  assert.equal(off.fake.calls.length, 0);
  assert.equal((await off.events.readData()).instagram, null);
  assert.equal(off.notes.length, 0);
});

test('dashboard por evento: lê o histórico só se o Instagram está conectado', async () => {
  const w = eventsWorld();
  await w.service.sync();
  assert.equal(await w.events.refreshDashboard({}), true);
  assert.ok(w.dashboards.at(-1).embeds.some(e => e.title === '📈 Instagram'));
  const off = eventsWorld({ env: {} });
  assert.equal(await off.events.refreshDashboard({}), true);
  assert.ok(off.dashboards.at(-1).embeds.every(e => e.title !== '📈 Instagram'));
});

test('alertas: acesso expirado (1 vez por dia), 2 dias sem atualizar e token perto de vencer; nunca com token', async () => {
  const w = eventsWorld({ fake: fakeInstagram({ failMe: true }) });
  await w.events.instagramCron();
  const alerts = () => w.notes.filter(n => n.kind === 'alertas');
  assert.equal(alerts().length, 1);
  assert.equal(alerts()[0].message.title, '🔑 O acesso ao Instagram expirou: gere um token novo');
  await w.events.instagramCron();
  assert.equal(alerts().length, 1, 'no mesmo dia, só um aviso');
  w.clock.now += DAY;
  await w.events.instagramCron();
  assert.equal(alerts().length, 2, 'no dia seguinte, de novo');
  assert.equal(JSON.stringify(w.notes).includes('IGAA'), false);
  // falha que não é de token, 2 dias seguidos
  const flaky = eventsWorld({ fake: { fetch: async () => ({ status: 500, ok: false, json: async () => ({}) }), calls: [] } });
  await flaky.events.instagramCron();
  assert.equal(flaky.notes.filter(n => n.kind === 'alertas').length, 0, 'primeiro dia: ainda não avisa');
  flaky.clock.now += DAY;
  await flaky.events.instagramCron();
  const sync = flaky.notes.filter(n => n.kind === 'alertas');
  assert.equal(sync.length, 1); assert.match(sync[0].message.title, /não atualiza há 2 dias/);
  // token perto de vencer
  const expiring = eventsWorld();
  assert.equal(await expiring.events.instagramSynced({ ok: true, expiring: true, history: emptyHistory() }), true);
  assert.match(expiring.notes[0].message.title, /perto de vencer/);
  assert.equal(await expiring.events.instagramSynced({ ok: true, history: emptyHistory() }), false);
  // Discord fora do ar não quebra a rotina
  const down = eventsWorld({ fake: fakeInstagram({ failMe: true }), notifyOk: false });
  await assert.doesNotReject(down.events.instagramCron());
});

// ================= validação de cadastros =================
test('validação: origem aceita só os valores combinados (cadastros antigos sem origem continuam válidos)', () => {
  assert.deepEqual(ORIGENS, ['instagram', 'indicacao', 'google', 'whatsapp', 'site', 'outro']);
  for (const origem of ORIGENS) assert.equal(validateRecord('sales', { id: 'a1', client: 'Ana', origem }).origem, origem);
  assert.equal(validateRecord('sales', { id: 'a1', client: 'Ana', origem: '' }).origem, '');
  assert.equal('origem' in validateRecord('sales', { id: 'a1', client: 'Ana' }), false);
  for (const bad of ['Instagram', 'facebook', 'tiktok', 5, null, [], {}, 'instagram ']) assert.throws(() => validateRecord('sales', { id: 'a1', client: 'Ana', origem: bad }), /Origem/);
  const state = validateState({ sales: [{ id: 'a1', client: 'Ana', origem: 'instagram' }, { id: 'a2', client: 'Beto' }], exp: [] });
  assert.equal(state.sales[0].origem, 'instagram');
  assert.throws(() => validateState({ sales: [{ id: 'a1', client: 'Ana', origem: 'x' }], exp: [] }));
});

test('dayKey usa o fuso de São Paulo', () => {
  assert.equal(dayKey(Date.UTC(2026, 10, 9, 2, 59)), '2026-11-08');
  assert.equal(dayKey(Date.UTC(2026, 10, 9, 3, 0)), '2026-11-09');
});

// ---------- revisão: regras conferidas na documentação oficial e casos de borda ----------
test('API: versão atual da Graph API do Instagram (v27.0) e renovação sem versão no caminho', async () => {
  assert.equal(API_VERSION, 'v27.0');
  const fake = fakeInstagram();
  const client = createInstagramClient({ fetch: fake.fetch });
  await client.me(TOKEN);
  await client.refresh(TOKEN);
  assert.equal(new URL(fake.calls[0].url).origin, 'https://graph.instagram.com');
  assert.equal(fake.calls[0].path, '/v27.0/me');
  assert.equal(fake.calls[1].path, '/refresh_access_token');
  assert.equal(fake.calls[1].params.grant_type, 'ig_refresh_token');
});

test('insights: erro do post inteiro (não de métrica) não marca métricas como recusadas e para cedo', async () => {
  const calls = [];
  const fetch = async url => {
    const u = new URL(url); calls.push(u.searchParams.get('metric'));
    return { status: 400, ok: false, json: async () => ({ error: { message: '(#10) Media Posted Before Business Account Conversion', code: 10 } }) };
  };
  const skip = new Set();
  const out = await createInstagramClient({ fetch }).insights(TOKEN, 'old', { skip, prefix: 'IMAGE:' });
  assert.deepEqual(out, {});
  assert.equal(skip.size, 0, 'outros posts do mesmo tipo continuam pedindo as métricas');
  assert.equal(calls.length, 2, 'pedido completo + 1 tentativa, depois desiste');
});

test('insights: stop() interrompe as tentativas uma a uma quando o tempo acaba', async () => {
  const fake = fakeInstagram({ failInsights: (id, metrics) => metrics.length > 1 });
  const out = await createInstagramClient({ fetch: fake.fetch }).insights(TOKEN, 'm1', { stop: () => true });
  assert.deepEqual(out, {});
  assert.equal(fake.calls.length, 1);
});

test('cron: Instagram demorado ou com erro não segura o resumo do Discord; roda mesmo sem Discord configurado', async () => {
  assert.equal(await boundedInstagramCron({ instagramCron: () => new Promise(() => {}) }, 20), undefined);
  assert.equal(await boundedInstagramCron({ instagramCron: async () => { throw new Error('x'); } }, 1000), undefined);
  assert.equal(await boundedInstagramCron({ instagramCron: () => { throw new Error('sync'); } }, 1000), undefined);
  assert.equal(await boundedInstagramCron({}, 1000), undefined);
  const history = { daily: [] };
  assert.equal(await boundedInstagramCron({ instagramCron: async () => history }, 1000), history);

  let ran = 0, notified = 0;
  const discord = { configured: () => false, notify: async () => { notified++; return true; } };
  const events = { instagramCron: async () => { ran++; return null; }, summary: async () => ({ title: 'x' }), cronFailed: async () => {} };
  const handler = createDiscordHandler({ discord, commands: {}, events, authorized: async () => false, sameOrigin: () => true, env: { CRON_SECRET: 'c'.repeat(40) }, log: quietLog() });
  const req = Readable.from([]); Object.assign(req, { method: 'GET', headers: { authorization: 'Bearer ' + 'c'.repeat(40) }, query: { cron: 'summary' }, url: '/api/discord?cron=summary' });
  const res = await call(handler, req);
  assert.equal(res.statusCode, 200);
  assert.equal(ran, 1, 'o histórico diário de seguidores não depende do Discord');
  assert.equal(notified, 0);

  // Instagram travado: o resumo sai mesmo assim
  const notes = [];
  const slow = { instagramCron: () => new Promise(() => {}), readData: async opts => ({ ...opts }), summary: async shared => ({ title: 'resumo', shared }), cronFailed: async () => {} };
  const okDiscord = { configured: () => true, notify: async (kind, message) => { notes.push(message); return true; } };
  const h2 = createDiscordHandler({ discord: okDiscord, commands: {}, events: slow, authorized: async () => false, sameOrigin: () => true, env: { CRON_SECRET: 'c'.repeat(40) }, log: quietLog(), instagramCronMs: 20 });
  const req2 = Readable.from([]); Object.assign(req2, { method: 'GET', headers: { authorization: 'Bearer ' + 'c'.repeat(40) }, query: { cron: 'summary' }, url: '/api/discord?cron=summary' });
  const res2 = await call(h2, req2);
  assert.equal(res2.statusCode, 200);
  assert.equal(notes[0].title, 'resumo');
  assert.equal(notes[0].shared.instagram, undefined, 'sem histórico pronto: o resumo relê do Blob');
});

test('meta: prazo hoje ainda conta (1 dia), prazo vencido não', () => {
  const today = '2026-11-09';
  const daily = series('2026-10-27', ...Array.from({ length: 14 }, (_, i) => 1000 + i * 10));
  const p = projectFollowers({ daily, goal: { target: 1200, deadline: today }, today });
  assert.equal(p.daysLeft, 0);
  assert.equal(p.perDayNeeded, p.remaining);
  assert.doesNotMatch(projectionText(p), /já passou/);
  const late = projectFollowers({ daily, goal: { target: 1200, deadline: '2026-11-08' }, today });
  assert.equal(late.perDayNeeded, null);
  assert.match(projectionText(late), /já passou/);
});

test('token do Facebook (login unificado): usa graph.facebook.com, acha a conta do Instagram e não tenta renovar', async () => {
  const { createInstagramClient, createTokenManager, isFacebookToken, safeDetail } = await import('../lib/instagram.js');
  const calls = [];
  const fake = async url => {
    const u = new URL(url); calls.push(u.host + u.pathname);
    const json = body => ({ ok: true, status: 200, json: async () => body });
    if (u.pathname.endsWith('/me') && u.searchParams.get('fields') === 'id,followers_count') return json({ id: '111' });
    if (u.pathname.endsWith('/me/accounts')) return json({ data: [{ id: 'p1', instagram_business_account: { id: '17841400000000' } }] });
    if (u.pathname.endsWith('/17841400000000')) return json({ id: '17841400000000', username: 'promisa', followers_count: 1200, follows_count: 10, media_count: 40 });
    if (u.pathname.endsWith('/17841400000000/media')) return json({ data: [{ id: 'm1', media_type: 'IMAGE', timestamp: '2026-11-01T10:00:00+0000', like_count: 3 }] });
    return { ok: false, status: 400, json: async () => ({ error: { code: 100, message: 'x' } }) };
  };
  const token = 'EA' + 'x'.repeat(60);
  assert.equal(isFacebookToken(token), true);
  assert.equal(isFacebookToken('IGAA' + 'x'.repeat(40)), false);
  const client = createInstagramClient({ fetch: fake });
  const me = await client.me(token);
  assert.equal(me.followers, 1200);
  const media = await client.media(token);
  assert.equal(media.length, 1);
  assert.ok(calls.every(c => c.startsWith('graph.facebook.com')));
  let refreshed = false;
  const manager = createTokenManager({ client: { refresh: async () => { refreshed = true; } }, store: { readToken: async () => null, writeToken: async () => {} }, env: { INSTAGRAM_TOKEN: token } });
  const ensured = await manager.ensure();
  assert.equal(ensured.token, token); assert.equal(refreshed, false);
  const detail = safeDetail({ code: 190, message: 'Invalid OAuth access token - Cannot parse access_token EAAabcdefghijklmnopqrstuvwxyz0123 https://x.y/z' });
  assert.ok(!/EAAabc/.test(detail) && !/https:/.test(detail) && /190/.test(detail));
});
