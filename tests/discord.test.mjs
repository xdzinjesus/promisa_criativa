import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { Readable } from 'node:stream';
import { createDiscord, verifyInteraction, CHANNELS, COMMANDS } from '../lib/discord.js';
import { createDiscordHandler } from '../lib/discord-handler.js';
import { createCommands } from '../lib/discord-commands.js';
import { createEvents, buildSummary } from '../lib/discord-events.js';
import { createData, createdAtFromId, normalize } from '../lib/discord-data.js';
import { createBriefingHandler } from '../lib/briefing-handler.js';
import { createDemoHandler } from '../lib/demo-site.js';
import { createPublishHandler, publishSite } from '../lib/publish-handler.js';

const NOW = Date.UTC(2026, 10, 9, 12, 0, 0);
const BOT = 'SECRET-BOT-TOKEN-abcdef123456';
const ITOKEN = 'interaction-token-' + 'x'.repeat(60);
const { publicKey, privateKey } = generateKeyPairSync('ed25519');
const PUBLIC_HEX = publicKey.export({ type: 'spki', format: 'der' }).subarray(-32).toString('hex');
const ENV = { DISCORD_BOT_TOKEN: BOT, DISCORD_APP_ID: 'APP1', DISCORD_PUBLIC_KEY: PUBLIC_HEX, DISCORD_GUILD_ID: 'G1', DISCORD_OWNER_ID: 'OWNER' };
const signed = (body, at = NOW) => {
  const timestamp = String(Math.floor(at / 1000));
  return { timestamp, signature: sign(null, Buffer.from(timestamp + body), privateKey).toString('hex') };
};

// ---------- Discord falso ----------
function fakeDiscord({ channels = [], failChannels = false } = {}) {
  const state = { channels: channels.map((c, i) => ({ id: 'c' + i, ...c })), posts: [], patches: [], created: [], calls: [], commands: null, nextId: 100 };
  const fetch = async (url, init = {}) => {
    const path = url.replace('https://discord.com/api/v10', '');
    const method = init.method || 'GET';
    const body = init.body ? JSON.parse(init.body) : undefined;
    state.calls.push({ method, path, auth: init.headers?.Authorization });
    const reply = (status, data) => ({ status, ok: status >= 200 && status < 300, json: async () => data });
    if (method === 'GET' && path === '/guilds/G1/channels') return failChannels ? reply(500, {}) : reply(200, state.channels);
    if (method === 'POST' && path === '/guilds/G1/channels') {
      const made = { id: 'n' + state.nextId++, ...body }; state.channels.push(made); state.created.push(body); return reply(201, made);
    }
    const message = /^\/channels\/([^/]+)\/messages$/.exec(path);
    if (method === 'POST' && message) { state.posts.push({ channelId: message[1], body }); return reply(200, { id: 'm1' }); }
    if (method === 'PUT' && path === '/applications/APP1/guilds/G1/commands') { state.commands = body; return reply(200, body); }
    if (method === 'GET' && path === '/applications/APP1/guilds/G1/commands') return reply(200, state.commands || []);
    if (method === 'PATCH' && path.startsWith('/webhooks/APP1/')) { state.patches.push({ path, body }); return reply(200, {}); }
    return reply(404, {});
  };
  return { state, fetch };
}
const allChannels = () => [{ type: 4, name: 'PROMISA' }, ...CHANNELS.map(name => ({ type: 0, name }))];
const channelId = (state, name) => state.channels.find(c => c.name === name)?.id;
const make = (opts = {}, env = ENV) => {
  const fake = fakeDiscord(opts);
  const logs = [];
  const clock = { now: NOW };
  const discord = createDiscord({ fetch: fake.fetch, now: () => clock.now, env, log: { error: (...args) => logs.push(args) }, sleep: async () => {} });
  return { ...fake, discord, logs, clock };
};

// ---------- req/res ----------
function request({ method = 'POST', headers = {}, body = '', query, url = '/api/discord' } = {}) {
  const req = Readable.from(body === '' ? [] : [Buffer.from(body)]);
  Object.assign(req, { method, headers, url, query });
  return req;
}
function response() {
  const res = { headers: {}, statusCode: 200, body: '', setHeader(k, v) { this.headers[k.toLowerCase()] = v; }, end(text) { this.body = text ?? ''; this.ended = true; } };
  Object.defineProperty(res, 'json', { get() { return this.body ? JSON.parse(this.body) : null; } });
  return res;
}
async function call(handler, req) { const res = response(); await handler(req, res); return res; }

function interactionRequest(payload, { at = NOW, tamper = false } = {}) {
  const body = JSON.stringify(payload);
  const { signature, timestamp } = signed(body, at);
  return request({ headers: { 'x-signature-ed25519': signature, 'x-signature-timestamp': timestamp, 'content-type': 'application/json' }, body: tamper ? body.replace('ajuda', 'resumo') : body });
}
const slash = (name, options = [], extra = {}) => ({ type: 2, token: ITOKEN, guild_id: 'G1', member: { user: { id: 'OWNER' } }, data: { name, options }, ...extra });

// ---------- assinatura ----------
test('assinatura Ed25519: aceita a correta; recusa corpo alterado, chave errada, lixo e horário antigo/futuro', () => {
  const body = '{"type":1}';
  const { signature, timestamp } = signed(body);
  assert.equal(verifyInteraction(body, signature, timestamp, PUBLIC_HEX, NOW), true);
  assert.equal(verifyInteraction(Buffer.from(body), signature, timestamp, PUBLIC_HEX, NOW), true);
  assert.equal(verifyInteraction('{"type":2}', signature, timestamp, PUBLIC_HEX, NOW), false);
  const other = generateKeyPairSync('ed25519').publicKey.export({ type: 'spki', format: 'der' }).subarray(-32).toString('hex');
  assert.equal(verifyInteraction(body, signature, timestamp, other, NOW), false);
  assert.equal(verifyInteraction(body, 'zz', timestamp, PUBLIC_HEX, NOW), false);
  assert.equal(verifyInteraction(body, signature, 'abc', PUBLIC_HEX, NOW), false);
  assert.equal(verifyInteraction(body, signature, timestamp, 'curta', NOW), false);
  assert.equal(verifyInteraction(null, signature, timestamp, PUBLIC_HEX, NOW), false);
  const old = signed(body, NOW - 6 * 60_000);
  assert.equal(verifyInteraction(body, old.signature, old.timestamp, PUBLIC_HEX, NOW), false, 'mais de 5 min');
  const recent = signed(body, NOW - 4 * 60_000);
  assert.equal(verifyInteraction(body, recent.signature, recent.timestamp, PUBLIC_HEX, NOW), true);
  const future = signed(body, NOW + 6 * 60_000);
  assert.equal(verifyInteraction(body, future.signature, future.timestamp, PUBLIC_HEX, NOW), false);
});

// ---------- avisos ----------
test('notify: sem as variáveis não faz nada e nunca chama a rede', async () => {
  const w = make({}, {});
  assert.equal(await w.discord.notify('alertas', { title: 'x' }), false);
  assert.equal(w.state.calls.length, 0);
  const partial = make({}, { DISCORD_BOT_TOKEN: BOT });
  assert.equal(await partial.discord.notify('alertas', { title: 'x' }), false);
  assert.equal(partial.state.calls.length, 0);
});

test('notify: manda cada tipo para o canal certo, com Bot token e sem menções', async () => {
  const w = make({ channels: allChannels() });
  for (const name of CHANNELS) assert.equal(await w.discord.notify(name, { title: 'Olá ' + name, description: 'oi' }), true, name);
  assert.equal(w.state.posts.length, CHANNELS.length);
  for (const name of CHANNELS) {
    const post = w.state.posts.find(p => p.body.embeds[0].title === 'Olá ' + name);
    assert.equal(post.channelId, channelId(w.state, name));
    assert.deepEqual(post.body.allowed_mentions, { parse: [] });
  }
  assert.ok(w.state.calls.filter(c => c.path.endsWith('/messages')).every(c => c.auth === `Bot ${BOT}`));
  assert.equal(w.state.calls.filter(c => c.path === '/guilds/G1/channels' && c.method === 'GET').length, 1, 'canais em cache');
});

test('notify: canal ausente cai em #alertas; sem #alertas, ignora em silêncio; tipo desconhecido vai a #alertas', async () => {
  const w = make({ channels: [{ type: 0, name: 'alertas' }] });
  assert.equal(await w.discord.notify('sites-no-ar', { title: 'a' }), true);
  assert.equal(w.state.posts[0].channelId, channelId(w.state, 'alertas'));
  assert.equal(await w.discord.notify('qualquer-coisa', { title: 'b' }), true);
  assert.equal(w.state.posts[1].channelId, channelId(w.state, 'alertas'));
  const none = make({ channels: [{ type: 0, name: 'geral' }] });
  assert.equal(await none.discord.notify('sites-no-ar', { title: 'a' }), false);
  assert.equal(none.state.posts.length, 0);
});

test('notify: nunca lança (rede caindo, resposta ruim) e não repete a mesma mensagem em 60 s', async () => {
  const broken = createDiscord({ fetch: async () => { throw new Error('rede caiu ' + BOT); }, env: ENV, log: { error() {} }, now: () => NOW });
  await assert.doesNotReject(broken.notify('alertas', { title: 'x' }));
  assert.equal(await broken.notify('alertas', { title: 'y' }), false);
  const w = make({ channels: allChannels() });
  assert.equal(await w.discord.notify('alertas', { title: 'repetida', description: 'igual' }), true);
  assert.equal(await w.discord.notify('alertas', { title: 'repetida', description: 'igual' }), false);
  assert.equal(w.state.posts.length, 1);
  w.clock.now += 61_000;
  assert.equal(await w.discord.notify('alertas', { title: 'repetida', description: 'igual' }), true);
  assert.equal(w.state.posts.length, 2);
  assert.equal(await w.discord.notify('alertas', { title: 'repetida', description: 'outra' }), true, 'texto diferente passa');
});

test('notify: respeita 429 (retry_after) uma única vez e tem limite de 2,5 s', async () => {
  let posts = 0, slept = 0;
  const fetch = async (url, init = {}) => {
    const reply = (status, data) => ({ status, ok: status < 300, json: async () => data });
    if (url.endsWith('/channels') && init.method === 'GET') return reply(200, [{ id: 'c1', type: 0, name: 'alertas' }]);
    posts++;
    return posts === 1 ? reply(429, { retry_after: 0.5 }) : reply(200, {});
  };
  const d = createDiscord({ fetch, env: ENV, now: () => NOW, log: { error() {} }, sleep: async ms => { slept += ms; } });
  assert.equal(await d.notify('alertas', { title: 'x' }), true);
  assert.equal(posts, 2);
  assert.equal(slept, 500);
  let always = 0;
  const d2 = createDiscord({ fetch: async (url, init = {}) => url.endsWith('/channels') && init.method === 'GET' ? { status: 200, ok: true, json: async () => [{ id: 'c1', type: 0, name: 'alertas' }] } : (always++, { status: 429, ok: false, json: async () => ({ retry_after: 0.1 }) }), env: ENV, now: () => NOW, log: { error() {} }, sleep: async () => {} });
  assert.equal(await d2.notify('alertas', { title: 'y' }), false);
  assert.equal(always, 2, 'uma nova tentativa só');
  const slow = createDiscord({ fetch: () => new Promise(() => {}), env: ENV, log: { error() {} }, notifyTimeoutMs: 40 });
  const started = Date.now();
  assert.equal(await slow.notify('alertas', { title: 'z' }), false);
  assert.ok(Date.now() - started < 1000);
});

// ---------- canais e comandos registrados ----------
test('setup: cria a categoria e só os canais que faltam; repetir não cria nada', async () => {
  const w = make({ channels: [{ type: 0, name: 'alertas' }, { type: 0, name: 'diagnosticos' }] });
  const result = await w.discord.setupChannels();
  assert.equal(result.ok, true);
  assert.equal(result.categoryCreated, true);
  assert.deepEqual(result.created.sort(), CHANNELS.filter(name => !['alertas', 'diagnosticos'].includes(name)).sort());
  assert.equal(w.state.created.filter(c => c.type === 4).length, 1);
  const category = w.state.channels.find(c => c.type === 4);
  assert.ok(w.state.created.filter(c => c.type === 0).every(c => c.parent_id === category.id));
  assert.equal(w.state.created.length, 1 + 4);
  const again = await w.discord.setupChannels();
  assert.deepEqual(again.created, []);
  assert.equal(w.state.created.length, 5);
  const existing = make({ channels: allChannels() });
  assert.deepEqual((await existing.discord.setupChannels()).created, []);
  assert.equal(existing.state.created.length, 0);
});

test('setup sem permissão devolve erro claro e register envia os 7 comandos', async () => {
  const denied = createDiscord({ fetch: async (url, init = {}) => init.method === 'POST' ? { status: 403, ok: false, json: async () => ({}) } : { status: 200, ok: true, json: async () => [] }, env: ENV, log: { error() {} } });
  assert.equal((await denied.setupChannels()).error, 'forbidden');
  const w = make();
  const registered = await w.discord.registerCommands();
  assert.equal(registered.ok, true);
  assert.deepEqual(w.state.commands.map(c => c.name).sort(), ['ajuda', 'cliente', 'configurar', 'demo', 'diagnostico', 'publicar', 'resumo']);
  assert.equal(COMMANDS.find(c => c.name === 'demo').options[1].max_value, 30);
  const status = await make({ channels: allChannels() }).discord.status();
  assert.deepEqual(status.channelsFound.sort(), [...CHANNELS].sort());
  assert.equal(status.commandsRegistered, false);
});

// ---------- dados (cadastros criptografados) ----------
test('dados: id do cadastro revela a data; busca ignora acentos; cofre ligado não gasta leituras à toa', async () => {
  assert.equal(normalize('  Padaria  JOSÉ '), 'padaria jose');
  const id = NOW.toString(36) + 'abc';
  assert.equal(createdAtFromId(id), parseInt(NOW.toString(36).slice(0, 8), 36));
  assert.equal(createdAtFromId('abc'), 0);
  let reads = 0;
  const records = {};
  for (let i = 0; i < 40; i++) records['sales:s' + i] = { hash: 'h', path: 'p/sales' + i };
  records['sites:a1'] = { hash: 'h', path: 'p/site-a1' };
  const files = { 'p/site-a1': { version: 1, value: { id: 'a1', name: 'Padaria do José', leadId: 'x' } } };
  const get = async path => { reads++; const data = files[path] || { version: 2, vault: 'v', data: 'x', iv: 'y' }; return { stream: new Response(JSON.stringify(data)).body, blob: { size: 50 } }; };
  const data = createData({ readManifest: async () => ({ manifest: { version: 1, records } }), get, token: () => 't', now: () => NOW });
  const found = await data.findTargets('jose');
  assert.equal(found.sealed, true);
  assert.equal(found.matches.length, 1);
  assert.equal(found.matches[0].lead, null);
  assert.equal(found.matches[0].sites[0].name, 'Padaria do José');
  assert.ok(reads <= 10 + 1, `leituras: ${reads}`); // 1 bloco de cadastros (parou ao ver tudo criptografado) + 1 site
});

// ---------- comandos (rota) ----------
function commandWorld({ vault = false } = {}) {
  const w = make({ channels: allChannels() });
  w.published = {};
  const lead = { id: 'L1', client: 'Padaria da Ana', stage: 'Fechado', paid: true, entrega: { plano: 'profissional' } };
  const site = { id: 'S1', name: 'Site Padaria', leadId: 'L1', siteType: 'cliente', status: 'Pronto', updatedAt: '2026-11-01' };
  const manifest = { version: 1, records: { 'sales:L1': { hash: 'h', path: 'p' }, 'sites:S1': { hash: 'h', path: 'p2' } } };
  w.createdShares = []; w.diagCreated = []; w.deployed = [];
  const data = {
    manifest: async () => manifest,
    siteName: async () => 'Site Padaria',
    findTargets: async query => {
      if (normalize(query).includes('vazio')) return { matches: [], sealed: false, truncated: false };
      if (vault) return normalize('site padaria').includes(normalize(query)) ? { sealed: true, truncated: false, matches: [{ lead: null, sites: [site] }] } : { sealed: true, truncated: false, matches: [] };
      return normalize('padaria da ana').includes(normalize(query)) ? { sealed: false, truncated: false, matches: [{ lead, sites: [site] }] } : { sealed: false, truncated: false, matches: [] };
    }
  };
  const shares = {
    all: async () => [{ token: 'T'.repeat(22), siteKey: 'sites:S1', createdAt: NOW - 1000, expiresAt: NOW + 86_400_000 }],
    create: async (siteId, expiresAt) => { const share = { token: 'N'.repeat(22), siteKey: 'sites:' + siteId, createdAt: NOW, expiresAt }; w.createdShares.push(share); return share; }
  };
  const diagnosticos = {
    list: async () => [{ token: 'D'.repeat(22), host: 'padaria.com.br', leadId: 'L1', score: 6.5, createdAt: NOW - 3600_000 }],
    create: async report => { const full = { token: 'R'.repeat(22), expiresAt: NOW + 90 * 86_400_000, ...report }; w.diagCreated.push(full); return full; }
  };
  const publishedStore = {
    list: async () => w.published,
    get: async id => w.published[id] || null,
    set: async (id, patch) => (w.published[id] = { ...(w.published[id] || {}), ...patch })
  };
  const cloudflareClient = { deploy: async (project) => { w.deployed.push(project); return { project, url: 'https://' + project + '.pages.dev', deploymentId: 'dep1', uploaded: 3, total: 5 }; } };
  const events = createEvents({ discord: w.discord, data, shares, diagnosticos, publishedStore, now: () => w.clock.now, base: () => 'https://www.promisa.online' });
  const commands = createCommands({
    discord: w.discord, data, events, shares, diagnosticos, publishedStore, now: () => w.clock.now, base: () => 'https://www.promisa.online',
    analyze: async url => { if (url === 'bad') { const { AnalyzeError } = await import('../lib/diagnostico-analyze.js'); throw new AnalyzeError('Esse endereço de site não parece correto.'); } return { siteUrl: 'https://padaria.com.br/', host: 'padaria.com.br', score: 7.2, items: [], psi: null, info: {} }; },
    cloudflare: () => cloudflareClient,
    readSiteInfo: async () => ({ site: { name: 'Site Padaria', files: [] }, filesHash: 'f'.repeat(64) }),
    publishSite
  });
  const pending = [];
  w.handler = createDiscordHandler({ discord: w.discord, commands, events, waitUntil: p => pending.push(p), env: { CRON_SECRET: 'c'.repeat(40) }, log: { error() {} }, authorized: async req => req.headers.cookie === 'ok', sameOrigin: () => true });
  w.run = async (name, options, extra) => {
    const res = await call(w.handler, interactionRequest(slash(name, options, extra)));
    await Promise.all(pending.splice(0));
    return res;
  };
  w.lastPatch = () => w.state.patches.at(-1)?.body;
  return w;
}

test('rota: PING vira PONG; assinatura ruim, corpo alterado e horário antigo dão 401', async () => {
  const w = commandWorld();
  const pong = await call(w.handler, interactionRequest({ type: 1 }));
  assert.equal(pong.statusCode, 200);
  assert.deepEqual(pong.json, { type: 1 });
  assert.equal((await call(w.handler, interactionRequest(slash('ajuda'), { tamper: true }))).statusCode, 401);
  assert.equal((await call(w.handler, interactionRequest(slash('ajuda'), { at: NOW - 10 * 60_000 }))).statusCode, 401);
  const noSig = await call(w.handler, request({ headers: { 'x-signature-ed25519': '', 'x-signature-timestamp': '' }, body: '{"type":1}' }));
  assert.equal(noSig.statusCode, 401);
  const off = commandWorld();
  const unconfigured = createDiscordHandler({ discord: createDiscord({ env: {}, fetch: off.fetch }), commands: {}, events: {}, authorized: async () => false, sameOrigin: () => true, log: { error() {} } });
  assert.equal((await call(unconfigured, interactionRequest({ type: 1 }))).statusCode, 503);
});

test('rota: só o dono, só no servidor certo (resposta só para ele)', async () => {
  const w = commandWorld();
  const stranger = await w.run('resumo', [], { member: { user: { id: 'OUTRA' } } });
  assert.equal(stranger.json.type, 4);
  assert.equal(stranger.json.data.flags, 64);
  assert.match(stranger.json.data.content, /Só o dono pode usar este comando/);
  const dm = await w.run('resumo', [], { member: undefined, user: { id: 'OUTRA' } });
  assert.match(dm.json.data.content, /Só o dono/);
  const guild = await w.run('resumo', [], { guild_id: 'OUTRO' });
  assert.match(guild.json.data.content, /só funciona no servidor/);
  const noGuild = await w.run('resumo', [], { guild_id: undefined });
  assert.match(noGuild.json.data.content, /só funciona no servidor/);
  assert.equal(w.state.patches.length, 0, 'nada executado');
  assert.equal(w.state.calls.filter(c => c.path.includes('/messages')).length, 0);
  const owner = await w.run('ajuda', [], { member: undefined, user: { id: 'OWNER' } });
  assert.match(owner.json.data.content, /\/diagnostico/);
});

test('/ajuda responde na hora; comandos longos respondem "pensando" (tipo 5, só para o dono) e depois editam a mensagem', async () => {
  const w = commandWorld();
  const help = await w.run('ajuda');
  assert.equal(help.json.type, 4);
  for (const name of ['diagnostico', 'cliente', 'demo', 'publicar', 'resumo', 'configurar', 'ajuda']) assert.ok(help.json.data.content.includes('/' + name), name);
  const res = await w.run('resumo');
  assert.deepEqual(res.json, { type: 5, data: { flags: 64 } });
  assert.ok(res.ended);
  assert.equal(w.state.patches.length, 1);
  assert.ok(w.state.patches[0].path.endsWith('/messages/@original'));
  assert.match(w.lastPatch().embeds[0].title, /Resumo de/);
  assert.deepEqual(w.lastPatch().allowed_mentions, { parse: [] });
});

test('/diagnostico: analisa, guarda, responde com nota e link e avisa #diagnosticos', async () => {
  const w = commandWorld();
  await w.run('diagnostico', [{ name: 'url', value: 'www.padaria.com.br' }]);
  assert.equal(w.diagCreated.length, 1);
  const reply = w.lastPatch().embeds[0];
  assert.match(reply.title, /padaria\.com\.br: nota 7,2\/10/);
  assert.match(reply.description, /https:\/\/www\.promisa\.online\/diagnostico\/R{22}/);
  const post = w.state.posts.find(p => p.channelId === channelId(w.state, 'diagnosticos'));
  assert.match(post.body.embeds[0].title, /Diagnóstico de padaria\.com\.br: nota 7,2\/10/);
  await w.run('diagnostico', [{ name: 'url', value: 'bad' }]);
  assert.match(w.lastPatch().content, /não parece correto/);
});

test('/cliente: mostra etapa, plano, site, demonstração, publicação e diagnóstico; avisa quando não acha', async () => {
  const w = commandWorld();
  w.published.S1 = { url: 'https://x.pages.dev', domain: 'padaria.com.br' };
  await w.run('cliente', [{ name: 'nome', value: 'ANA' }]);
  const field = w.lastPatch().embeds[0].fields[0];
  assert.match(field.name, /Padaria da Ana/);
  assert.match(field.value, /Fechado/);
  assert.match(field.value, /Profissional/);
  assert.match(field.value, /Site Padaria/);
  assert.match(field.value, /\/demo\/T{22}/);
  assert.match(field.value, /https:\/\/padaria\.com\.br/);
  assert.match(field.value, /nota 6,5/);
  assert.doesNotMatch(JSON.stringify(w.lastPatch()), /contact|telefone|cpf/i);
  await w.run('cliente', [{ name: 'nome', value: 'vazio' }]);
  assert.match(w.lastPatch().content, /Não encontrei/);
});

test('/cliente com cadastros criptografados explica o cofre e procura pelo nome do site', async () => {
  const w = commandWorld({ vault: true });
  await w.run('cliente', [{ name: 'nome', value: 'site padaria' }]);
  assert.match(w.lastPatch().embeds[0].description, /criptografia/);
  assert.match(w.lastPatch().embeds[0].fields[0].name, /Site Padaria/);
  await w.run('cliente', [{ name: 'nome', value: 'ninguem' }]);
  assert.match(w.lastPatch().content, /criptografia/);
});

test('/demo: cria o link pelo mesmo armazenamento de links (padrão 7 dias, 1 a 30)', async () => {
  const w = commandWorld();
  await w.run('demo', [{ name: 'nome', value: 'padaria' }]);
  assert.equal(w.createdShares.length, 1);
  assert.equal(w.createdShares[0].siteKey, 'sites:S1');
  assert.equal(w.createdShares[0].expiresAt, NOW + 7 * 86_400_000);
  assert.match(w.lastPatch().embeds[0].description, /https:\/\/www\.promisa\.online\/demo\/N{22}/);
  await w.run('demo', [{ name: 'nome', value: 'padaria' }, { name: 'dias', value: 30 }]);
  assert.equal(w.createdShares[1].expiresAt, NOW + 30 * 86_400_000);
  await w.run('demo', [{ name: 'nome', value: 'padaria' }, { name: 'dias', value: 99 }]);
  assert.equal(w.createdShares[2].expiresAt, NOW + 30 * 86_400_000, 'limita a 30');
  await w.run('demo', [{ name: 'nome', value: 'vazio' }]);
  assert.equal(w.createdShares.length, 3);
  assert.match(w.lastPatch().content, /Não encontrei/);
});

test('/publicar: publica pelo mesmo código da rota, responde com o endereço e avisa #sites-no-ar', async () => {
  const w = commandWorld();
  await w.run('publicar', [{ name: 'nome', value: 'padaria' }]);
  assert.equal(w.deployed.length, 1);
  assert.match(w.lastPatch().embeds[0].description, /https:\/\/promisa-site-padaria-.*\.pages\.dev/);
  assert.equal(w.published.S1.lastDeploymentId, 'dep1');
  const post = w.state.posts.find(p => p.channelId === channelId(w.state, 'sites-no-ar'));
  assert.match(post.body.embeds[0].title, /Site Padaria publicado/);
});

test('/publicar com erro avisa #alertas e responde de forma amigável sem detalhes técnicos', async () => {
  const w = commandWorld();
  const failing = createCommands({
    discord: w.discord, data: { findTargets: async () => ({ sealed: false, matches: [{ lead: { id: 'L1', client: 'Padaria' }, sites: [{ id: 'S1', name: 'Site' }] }] }) }, events: createEvents({ discord: w.discord, data: {}, shares: {}, diagnosticos: {}, publishedStore: {}, now: () => NOW }),
    shares: {}, diagnosticos: {}, publishedStore: { get: async () => null, set: async () => ({}) }, cloudflare: () => ({ deploy: async () => { throw new Error('token ' + BOT); } }),
    readSiteInfo: async () => ({ site: { name: 'S', files: [] }, filesHash: 'f'.repeat(64) }), publishSite, now: () => NOW, log: { error() {} }
  });
  const plan = failing.plan(slash('publicar', [{ name: 'nome', value: 'padaria' }]));
  const out = await plan.work();
  assert.match(out.content, /Não consegui concluir/);
  assert.doesNotMatch(out.content, new RegExp(BOT));
  const alert = w.state.posts.find(p => p.channelId === channelId(w.state, 'alertas'));
  assert.match(alert.body.embeds[0].title, /Não consegui publicar/);
  assert.doesNotMatch(JSON.stringify(alert.body), new RegExp(BOT));
});

test('/configurar cria canais que faltam, registra comandos e responde', async () => {
  const w = make({ channels: [{ type: 0, name: 'alertas' }] });
  const events = { summary: async () => ({}) };
  const commands = createCommands({ discord: w.discord, data: {}, events, shares: {}, diagnosticos: {}, publishedStore: {}, now: () => NOW });
  const pending = [];
  const handler = createDiscordHandler({ discord: w.discord, commands, events, waitUntil: p => pending.push(p), authorized: async () => false, sameOrigin: () => true, log: { error() {} } });
  const res = await call(handler, interactionRequest(slash('configurar')));
  assert.equal(res.json.type, 5);
  await Promise.all(pending);
  assert.equal(w.state.created.filter(c => c.type === 0).length, 5);
  assert.match(w.state.patches[0].body.content, /Criei os canais/);
  assert.match(w.state.patches[0].body.content, /Comandos atualizados \(7\)/);
});

test('trabalho que falha vira mensagem amigável (nunca fica "pensando" para sempre)', async () => {
  const w = commandWorld();
  w.handler = createDiscordHandler({ discord: w.discord, commands: { plan: () => ({ work: async () => { throw new Error(BOT); } }) }, events: {}, waitUntil: p => (w.job = p), authorized: async () => false, sameOrigin: () => true, log: { error() {} } });
  await call(w.handler, interactionRequest(slash('resumo')));
  await w.job;
  assert.match(w.lastPatch().content, /Não consegui concluir/);
});

// ---------- ações do painel ----------
test('painel: exige sessão, mesma origem e JSON; status/setup/register/test funcionam', async () => {
  const w = commandWorld();
  const panel = (action, headers = { cookie: 'ok', 'content-type': 'application/json' }) => call(w.handler, request({ headers, body: JSON.stringify({ action }) }));
  assert.equal((await panel('status', { 'content-type': 'application/json' })).statusCode, 401);
  assert.equal((await panel('status', { cookie: 'ok' })).statusCode, 415);
  const origin = createDiscordHandler({ discord: w.discord, commands: {}, events: {}, authorized: async () => true, sameOrigin: () => false, log: { error() {} } });
  assert.equal((await call(origin, request({ headers: { 'content-type': 'application/json' }, body: '{"action":"status"}' }))).statusCode, 403);
  assert.equal((await panel('apagar-tudo')).statusCode, 400);
  const status = await panel('status');
  assert.equal(status.json.configured, true);
  assert.deepEqual(status.json.channelsFound.sort(), [...CHANNELS].sort());
  assert.equal((await panel('register')).json.ok, true);
  assert.equal((await panel('setup')).json.ok, true);
  const test = await panel('test');
  assert.equal(test.json.ok, true);
  assert.match(w.state.posts.at(-1).body.embeds[0].title, /teste/);
  const unconfigured = createDiscordHandler({ discord: createDiscord({ env: {}, fetch: w.fetch }), commands: {}, events: {}, authorized: async () => true, sameOrigin: () => true, log: { error() {} } });
  const send = action => call(unconfigured, request({ headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action }) }));
  assert.equal((await send('status')).json.configured, false);
  assert.equal((await send('setup')).statusCode, 503);
});

// ---------- resumo diário (cron) ----------
test('cron do resumo: exige CRON_SECRET igual ao da manutenção e só então posta em #resumo-do-dia', async () => {
  const w = commandWorld();
  const get = headers => call(w.handler, request({ method: 'GET', headers, query: { cron: 'summary' }, url: '/api/discord?cron=summary' }));
  assert.equal((await get({})).statusCode, 401);
  assert.equal((await get({ authorization: 'Bearer errado' })).statusCode, 401);
  assert.equal(w.state.posts.length, 0);
  const noSecret = createDiscordHandler({ discord: w.discord, commands: {}, events: {}, authorized: async () => false, sameOrigin: () => true, env: {}, log: { error() {} } });
  assert.equal((await call(noSecret, request({ method: 'GET', headers: { authorization: 'Bearer x' }, query: { cron: 'summary' } }))).statusCode, 503);
  const short = createDiscordHandler({ discord: w.discord, commands: {}, events: {}, authorized: async () => false, sameOrigin: () => true, env: { CRON_SECRET: 'curto' }, log: { error() {} } });
  assert.equal((await call(short, request({ method: 'GET', headers: { authorization: 'Bearer curto' }, query: { cron: 'summary' } }))).statusCode, 503);
  const ok = await get({ authorization: 'Bearer ' + 'c'.repeat(40) });
  assert.equal(ok.statusCode, 200);
  assert.equal(w.state.posts.length, 1);
  assert.equal(w.state.posts[0].channelId, channelId(w.state, 'resumo-do-dia'));
  assert.equal((await call(w.handler, request({ method: 'GET', headers: { authorization: 'Bearer ' + 'c'.repeat(40) }, query: {} }))).statusCode, 404);
});

test('resumo: conta clientes novos pelo id, demonstrações, diagnósticos e sites sem abrir nenhum cadastro', () => {
  const fresh = NOW.toString(36) + 'ab', old = (NOW - 3 * 86_400_000).toString(36) + 'ab';
  const manifest = { records: { ['sales:' + fresh]: { hash: 'h' }, ['sales:' + old]: { hash: 'h' }, 'sales:apagado': { hash: null }, 'sites:s1': { hash: 'h' }, 'settings:plan': { hash: 'h' } } };
  const shares = [{ token: 'a', siteKey: 'sites:s1', createdAt: NOW - 1000, expiresAt: NOW + 1e6 }, { token: 'b', siteKey: 'sites:s1', createdAt: NOW - 9 * 86_400_000, expiresAt: NOW - 1000 }];
  const diagnosticos = [{ createdAt: NOW - 1000, score: 6 }, { createdAt: NOW - 2000, score: 8 }, { createdAt: NOW - 5 * 86_400_000, score: 1 }];
  const published = { s1: { lastPublishedAt: NOW - 1000 }, s2: { lastPublishedAt: NOW - 9 * 86_400_000 } };
  const summary = buildSummary({ manifest, shares, diagnosticos, published, at: NOW });
  const text = Object.fromEntries(summary.fields.map(f => [f.name, f.value]));
  assert.match(text['👥 Clientes'], /1 novo nas últimas 24 h\n2 no total/);
  assert.match(text['🔗 Demonstrações'], /1 criada.*\n1 ativa/);
  assert.match(text['🩺 Diagnósticos'], /2 novos.*nota média 7,0/);
  assert.match(text['🌐 Sites no ar'], /1 publicado ou atualizado.*\n2 no ar/);
  const partial = buildSummary({ manifest: null, shares: null, diagnosticos: null, published: null, at: NOW });
  assert.ok(partial.fields.every(f => /indisponível/.test(f.value)));
});

// ---------- ganchos nas rotas existentes ----------
test('briefing: aviso sai depois de salvar, sem dados pessoais, e falha no aviso não quebra o envio', async () => {
  const w = make({ channels: allChannels() });
  const events = createEvents({ discord: w.discord, data: {}, shares: {}, diagnosticos: {}, publishedStore: {}, now: () => NOW });
  const { BRIEFING_QUESTIONS } = await import('../src/briefing-questions.js');
  const answers = {};
  for (const q of BRIEFING_QUESTIONS) answers[q.id] = q.type === 'text' ? `Resposta ${q.id} Padaria da Ana, padaria` : { selected: [q.options[0]], other: '' };
  answers.q9 = 'WhatsApp 49 99999-0000 CPF 123.456.789-00';
  const TOKEN = 'a'.repeat(32);
  const ok = createBriefingHandler({
    find: async () => ({ token: TOKEN, expiresAt: NOW + 1e9, createdAt: NOW - 1e6, leadId: 'x' }), submit: async () => ({ ok: true }), sameOrigin: () => true, now: () => NOW,
    allow: () => true, onSubmitted: a => events.briefingSubmitted(a)
  });
  const post = body => call(ok, request({ headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }));
  const res = await post({ token: TOKEN, website: '', startedAt: NOW - 60_000, answers });
  assert.equal(res.statusCode, 200, res.body);
  const sent = w.state.posts[0];
  assert.equal(sent.channelId, channelId(w.state, 'novos-clientes'));
  assert.match(sent.body.embeds[0].title, /respondeu o briefing/);
  assert.doesNotMatch(JSON.stringify(sent.body), /99999|123\.456|CPF/);
  assert.equal(sent.body.embeds[0].url, 'https://www.promisa.online/admin');
  const broken = createBriefingHandler({ find: async () => ({ token: TOKEN, expiresAt: NOW + 1e9, createdAt: NOW - 1e6, leadId: 'x' }), submit: async () => ({ ok: true }), sameOrigin: () => true, now: () => NOW, allow: () => true, onSubmitted: () => { throw new Error('x'); } });
  assert.equal((await call(broken, request({ headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: TOKEN, website: '', startedAt: NOW - 60_000, answers }) }))).statusCode, 200);
});

test('demonstração: avisa só ao abrir a página principal (não arquivos), uma vez por código a cada 30 min', async () => {
  const w = make({ channels: allChannels() });
  const data = { siteName: async () => 'Site da Ana' };
  const events = createEvents({ discord: w.discord, data, shares: {}, diagnosticos: {}, publishedStore: {}, now: () => w.clock.now });
  const TOKEN = 'A'.repeat(22);
  const site = { name: '', htmlPath: 'index.html', files: [{ path: 'index.html', data: '<html><head></head><body>oi</body></html>' }, { path: 'a.css', data: 'body{}', type: 'text/css' }] };
  const handler = createDemoHandler({ findShare: async () => ({ token: TOKEN, siteKey: 'sites:S1', expiresAt: NOW + 1e9 }), readSite: async () => site, now: () => w.clock.now, onView: info => events.demoViewed(info) });
  const view = path => call(handler, request({ method: 'GET', query: { token: TOKEN, path }, url: `/api/demo?token=${TOKEN}` }));
  assert.equal((await view('a.css')).statusCode, 200);
  assert.equal(w.state.posts.length, 0, 'arquivo de apoio não avisa');
  assert.equal((await view('')).statusCode, 200);
  assert.equal(w.state.posts.length, 1);
  assert.match(w.state.posts[0].body.embeds[0].title, /Alguém abriu a demonstração de Site da Ana/);
  assert.equal(w.state.posts[0].channelId, channelId(w.state, 'demonstracoes'));
  assert.doesNotMatch(JSON.stringify(w.state.posts[0].body), new RegExp(TOKEN));
  await view('');
  assert.equal(w.state.posts.length, 1, 'dedupe de 30 min');
  w.clock.now += 31 * 60_000;
  await view('');
  assert.equal(w.state.posts.length, 2);
});

test('publicação: aviso em #sites-no-ar no sucesso e em #alertas no erro, sem atrapalhar a resposta', async () => {
  const w = make({ channels: allChannels() });
  const events = createEvents({ discord: w.discord, data: {}, shares: {}, diagnosticos: {}, publishedStore: {}, now: () => NOW });
  const items = {};
  const store = { get: async id => items[id] || null, set: async (id, patch) => (items[id] = { ...(items[id] || {}), ...patch }), list: async () => items };
  let fail = false;
  const client = { deploy: async project => { if (fail) throw Object.assign(new Error('boom ' + BOT), { code: 'x' }); return { project, url: 'https://p.pages.dev', deploymentId: 'd', uploaded: 1, total: 1 }; } };
  const handler = createPublishHandler({
    store, cloudflare: () => client, readSiteInfo: async () => ({ site: { name: 'Site Ana', files: [] }, filesHash: 'f'.repeat(64) }),
    authorized: async () => true, sameOrigin: () => true, onPublished: i => events.sitePublished(i), onFailed: i => events.publishFailed(i)
  });
  const publish = () => call(handler, request({ headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'publish', siteId: 'S1' }) }));
  const ok = await publish();
  assert.equal(ok.statusCode, 200);
  assert.ok(!('siteName' in ok.json), 'campo interno não vaza para o painel');
  assert.match(w.state.posts[0].body.embeds[0].title, /Site Ana publicado/);
  assert.equal(w.state.posts[0].channelId, channelId(w.state, 'sites-no-ar'));
  fail = true;
  const bad = await publish();
  assert.equal(bad.statusCode, 502);
  const alert = w.state.posts.find(p => p.channelId === channelId(w.state, 'alertas'));
  assert.match(alert.body.embeds[0].title, /Não consegui publicar/);
  assert.doesNotMatch(JSON.stringify(alert.body), new RegExp(BOT));
});

test('manutenção: alerta em #alertas só com ≥70% (amarelo) ou ≥90% (vermelho) ou arquivos removidos', async () => {
  const w = make({ channels: allChannels() });
  const events = createEvents({ discord: w.discord, data: {}, shares: {}, diagnosticos: {}, publishedStore: {}, now: () => w.clock.now });
  const GB = 1024 * 1024 * 1024;
  assert.equal(await events.maintenanceDone({ objectBytes: 0.5 * GB, removed: 0 }), false);
  assert.equal(w.state.posts.length, 0);
  await events.maintenanceDone({ objectBytes: 0.75 * GB, removed: 0 });
  assert.equal(w.state.posts[0].body.embeds[0].color, 0xf59e0b);
  assert.match(w.state.posts[0].body.embeds[0].description, /75%/);
  await events.maintenanceDone({ objectBytes: 0.95 * GB, removed: 3 });
  assert.equal(w.state.posts[1].body.embeds[0].color, 0xef4444);
  assert.match(w.state.posts[1].body.embeds[0].description, /removidos: 3/);
  await events.maintenanceDone({ objectBytes: 0.1 * GB, removed: 2 });
  assert.match(w.state.posts[2].body.embeds[0].title, /Manutenção/);
  await events.cronFailed('manutenção');
  assert.match(w.state.posts[3].body.embeds[0].title, /Falha na rotina/);
  assert.equal(w.state.posts.every(p => p.channelId === channelId(w.state, 'alertas')), true);
});

// ---------- segredos fora dos logs ----------
test('segredos: token do bot, token da interação e chave pública nunca aparecem em logs', async () => {
  const logs = [];
  const log = { error: (...args) => logs.push(args), warn: (...args) => logs.push(args), log: (...args) => logs.push(args) };
  const boom = async () => { throw new Error(`falha ${BOT} ${ITOKEN} ${PUBLIC_HEX}`); };
  const d = createDiscord({ fetch: boom, env: ENV, log, now: () => NOW });
  await d.notify('alertas', { title: 'x' });
  await d.setupChannels();
  await d.registerCommands();
  await d.status();
  await d.followUp(ITOKEN, 'oi');
  const spy = [];
  const original = console.error;
  console.error = (...args) => spy.push(args);
  try {
    const w = commandWorld();
    const handler = createDiscordHandler({ discord: w.discord, commands: { plan: () => { throw new Error(BOT + ITOKEN); } }, events: {}, authorized: async () => false, sameOrigin: () => true });
    await call(handler, interactionRequest(slash('resumo')));
  } finally { console.error = original; }
  const text = JSON.stringify([logs, spy]);
  assert.ok(logs.length > 0, 'houve registro de erro');
  for (const secret of [BOT, ITOKEN, PUBLIC_HEX, 'discord.com/api']) assert.ok(!text.includes(secret), 'vazou: ' + secret.slice(0, 10));
});
