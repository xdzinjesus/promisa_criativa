import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { Readable } from 'node:stream';
import { createDiscord, verifyInteraction, CHANNELS, SETUP_CHANNELS, CHANNEL_NAMES, COMMANDS, LAYOUT, slugOf, buildEmbed, buildPayload, linkRow, progressBar, inviteUrl, BOT_PERMISSIONS } from '../lib/discord.js';
import { createDiscordHandler } from '../lib/discord-handler.js';
import { createCommands } from '../lib/discord-commands.js';
import { createEvents, buildSummary, buildDashboard } from '../lib/discord-events.js';
import { createData, createdAtFromId, normalize } from '../lib/discord-data.js';
import { createBriefingHandler } from '../lib/briefing-handler.js';
import { createDemoHandler } from '../lib/demo-site.js';
import { createPublishHandler, publishSite } from '../lib/publish-handler.js';
import { RELEASES, KINDS, buildHistoryMessages, addRelease, release, postedFromFooters } from '../lib/discord-releases.js';

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
  const state = { channels: channels.map((c, i) => ({ id: 'c' + i, ...c })), posts: [], patches: [], created: [], calls: [], commands: null, nextId: 100, messages: {}, channelPatches: [], edits: [], pins: [], noHistory: false, denyOverwrites: false };
  const fetch = async (url, init = {}) => {
    const path = url.replace('https://discord.com/api/v10', '');
    const method = init.method || 'GET';
    const body = init.body ? JSON.parse(init.body) : undefined;
    state.calls.push({ method, path, auth: init.headers?.Authorization });
    const reply = (status, data) => ({ status, ok: status >= 200 && status < 300, json: async () => data });
    if (method === 'GET' && path === '/guilds/G1/channels') return failChannels ? reply(500, {}) : reply(200, state.channels);
    if (method === 'POST' && path === '/guilds/G1/channels') {
      if (body.permission_overwrites && state.denyOverwrites) return reply(403, {});
      const made = { id: 'n' + state.nextId++, ...body }; state.channels.push(made); state.created.push(body); return reply(201, made);
    }
    const bare = path.split('?')[0];
    const message = /^\/channels\/([^/]+)\/messages$/.exec(bare);
    if (method === 'GET' && message) return state.noHistory ? reply(403, {}) : reply(200, [...(state.messages[message[1]] || [])].reverse());
    if (method === 'POST' && message) {
      const id = 'm' + state.nextId++;
      state.posts.push({ channelId: message[1], body, id });
      (state.messages[message[1]] ||= []).push({ id, author: { bot: true }, embeds: body.embeds || [], components: body.components });
      return reply(200, { id });
    }
    const edit = /^\/channels\/([^/]+)\/messages\/([^/]+)$/.exec(bare);
    if (method === 'PATCH' && edit) {
      const found = (state.messages[edit[1]] || []).find(m => m.id === edit[2]);
      if (!found) return reply(404, {});
      found.embeds = body.embeds; found.components = body.components; state.edits.push({ channelId: edit[1], id: edit[2], body }); return reply(200, found);
    }
    const pin = /^\/channels\/([^/]+)\/pins\/([^/]+)$/.exec(bare);
    if (method === 'PUT' && pin) { state.pins.push(pin[2]); return reply(204, null); }
    const chan = /^\/channels\/([^/]+)$/.exec(bare);
    if (method === 'PATCH' && chan) {
      if (body.permission_overwrites && state.denyOverwrites) return reply(403, {});
      const found = state.channels.find(c => c.id === chan[1]);
      if (!found) return reply(404, {});
      Object.assign(found, body); state.channelPatches.push({ id: chan[1], body }); return reply(200, found);
    }
    if (method === 'PUT' && path === '/applications/APP1/guilds/G1/commands') { state.commands = body; return reply(200, body); }
    if (method === 'GET' && path === '/applications/APP1/guilds/G1/commands') return reply(200, state.commands || []);
    if (method === 'PATCH' && path.startsWith('/webhooks/APP1/')) { state.patches.push({ path, body }); return reply(200, {}); }
    return reply(404, {});
  };
  return { state, fetch };
}
const allChannels = () => [...LAYOUT.map(c => ({ type: 4, name: c.name, id: 'cat-' + c.slug })), ...LAYOUT.flatMap(c => c.channels.map(slug => ({ type: 0, name: CHANNEL_NAMES[slug], parent_id: 'cat-' + c.slug })))];
const channelId = (state, name) => state.channels.find(c => c.type === 0 && slugOf(c.name) === name)?.id;
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
test('slug: nomes antigos e novos (com emoji e ・) valem o mesmo canal', async () => {
  assert.equal(slugOf('novos-clientes'), 'novos-clientes');
  assert.equal(slugOf('🆕・novos-clientes'), 'novos-clientes');
  assert.equal(slugOf('☀️・resumo-do-dia'), 'resumo-do-dia');
  const w = make({ channels: [{ type: 0, name: 'alertas' }, { type: 0, name: '🩺・diagnosticos' }] });
  assert.equal(await w.discord.notify('alertas', { title: 'a' }), true);
  assert.equal(await w.discord.notify('diagnosticos', { title: 'b' }), true);
  assert.equal(w.state.posts[0].channelId, 'c0');
  assert.equal(w.state.posts[1].channelId, 'c1');
});

test('setup: cria categorias e canais, move/renomeia os antigos, não apaga nada e repetir não cria nada', async () => {
  const w = make({ channels: [{ type: 4, name: 'PROMISA', id: 'old' }, { type: 0, name: 'alertas', parent_id: 'old' }, { type: 0, name: 'diagnosticos', parent_id: 'old' }, { type: 0, name: 'geral' }] });
  const result = await w.discord.setupChannels();
  assert.equal(result.ok, true);
  assert.deepEqual(result.categoriesCreated, LAYOUT.map(c => c.name));
  assert.deepEqual(result.created.sort(), SETUP_CHANNELS.filter(name => !['alertas', 'diagnosticos'].includes(name)).sort());
  assert.deepEqual(result.moved.sort(), ['alertas', 'diagnosticos']);
  assert.equal(result.legacyCategoryEmpty, true);
  assert.equal(w.state.created.filter(c => c.type === 4).length, 4);
  const cat = name => w.state.channels.find(c => c.type === 4 && c.name === name).id;
  assert.equal(w.state.channels.find(c => c.name === '🚨・alertas').parent_id, cat('⚙️ SISTEMA'));
  assert.equal(w.state.channels.find(c => c.name === '🩺・diagnosticos').parent_id, cat('💼 CLIENTES'));
  assert.ok(w.state.channels.some(c => c.name === '💻・github'));
  assert.ok(w.state.channels.some(c => c.name === 'geral') && w.state.channels.some(c => c.name === 'PROMISA'), 'nada apagado');
  assert.ok(w.state.calls.every(c => c.method !== 'DELETE'));
  const dashboard = w.state.created.find(c => c.name === '📊・dashboard');
  assert.equal(dashboard.permission_overwrites.find(o => o.id === 'G1').deny, '2048');
  assert.equal(dashboard.permission_overwrites.find(o => o.id === 'APP1').type, 1);
  const before = w.state.calls.length;
  w.discord.resetChannels();
  const again = await w.discord.setupChannels();
  assert.deepEqual(again.created, []); assert.deepEqual(again.moved, []);
  const writes = w.state.calls.slice(before).filter(c => c.method !== 'GET' && !/\/(messages|pins)/.test(c.path));
  assert.deepEqual(writes, [], 'segunda rodada não cria nem altera canais');
  const existing = make({ channels: allChannels() });
  assert.deepEqual((await existing.discord.setupChannels()).created, []);
  assert.equal(existing.state.created.length, 0);
});

test('setup: boas-vindas aparecem uma vez só (e são fixadas); sem permissão de travar, o canal é criado mesmo assim', async () => {
  const w = make({ channels: allChannels() });
  w.state.channels = w.state.channels.filter(c => !/github|dashboard/.test(c.name));
  w.state.denyOverwrites = true;
  const first = await w.discord.setupChannels();
  assert.equal(first.ok, true);
  assert.ok(w.state.channels.some(c => c.name === '📊・dashboard'), 'criado sem travar');
  const isWelcome = p => /^(👋|🧠 Como ligar)/.test(String(p.body.embeds?.[0]?.title));
  const welcomes = w.state.posts.filter(isWelcome).length;
  assert.equal(welcomes, SETUP_CHANNELS.length);
  assert.equal(w.state.pins.length, welcomes + 1, 'boas-vindas + painel da central');
  assert.match(w.state.posts.find(p => p.body.embeds[0].title.includes('Central')).body.embeds[0].description, /\/diagnostico/);
  assert.ok(w.state.posts.some(p => /avisos do GitHub/.test(p.body.embeds[0].description)));
  const guide = w.state.posts.find(p => String(p.body.embeds?.[0]?.title).startsWith('🧠 Como ligar'));
  assert.ok(guide, 'guia do canal claude-code');
  assert.ok(guide.body.components?.[0]?.components?.some(c => c.style === 5 && /LIGAR-AGENTE\.md$/.test(c.url)), 'botão para o guia completo');
  assert.ok(!/token\s*[:=]\s*\S{20,}/i.test(guide.body.embeds[0].description));
  assert.ok(w.state.posts.some(p => /histórico de tudo que já foi feito no sistema/.test(p.body.embeds[0].description)));
  const total = w.state.posts.length;
  w.discord.resetChannels();
  await w.discord.setupChannels();
  assert.equal(w.state.posts.length, total, 'não duplica (nem histórico, nem painel)');
  const blind = make({ channels: allChannels() }); blind.state.noHistory = true;
  await blind.discord.setupChannels();
  assert.equal(blind.state.posts.length, 0, 'sem histórico não arrisca duplicar');
});

test('setup sem permissão devolve erro claro e register envia os 8 comandos', async () => {
  const denied = createDiscord({ fetch: async (url, init = {}) => init.method === 'POST' ? { status: 403, ok: false, json: async () => ({}) } : { status: 200, ok: true, json: async () => [] }, env: ENV, log: { error() {} } });
  assert.equal((await denied.setupChannels()).error, 'forbidden');
  const w = make();
  const registered = await w.discord.registerCommands();
  assert.equal(registered.ok, true);
  assert.deepEqual(w.state.commands.map(c => c.name).sort(), ['ajuda', 'cliente', 'configurar', 'dashboard', 'demo', 'diagnostico', 'publicar', 'resumo']);
  assert.equal(COMMANDS.find(c => c.name === 'demo').options[1].max_value, 30);
  const status = await make({ channels: allChannels() }).discord.status();
  assert.deepEqual(status.channelsFound.sort(), [...SETUP_CHANNELS].sort());
  assert.equal(status.commandsRegistered, false);
  assert.equal(status.appId, 'APP1'); assert.equal(status.permissions, 536964112);
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
  assert.match(reply.title, /padaria\.com\.br: nota 🟡 7,2\/10/);
  assert.match(reply.description, /https:\/\/www\.promisa\.online\/diagnostico\/R{22}/);
  const post = w.state.posts.find(p => p.channelId === channelId(w.state, 'diagnosticos'));
  assert.match(post.body.embeds[0].title, /Diagnóstico de padaria\.com\.br/);
  assert.equal(post.body.embeds[0].fields[0].value, '🟡 7,2/10');
  assert.equal(post.body.components[0].components[0].label, 'Ver diagnóstico');
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
  assert.equal(w.state.created.filter(c => c.type === 0).length, SETUP_CHANNELS.length - 1);
  assert.match(w.state.patches[0].body.content, /Criei os canais/);
  assert.match(w.state.patches[0].body.content, /Reorganizei/);
  assert.match(w.state.patches[0].body.content, /Comandos atualizados \(8\)/);
  assert.match(w.state.patches[0].body.content, /30 atualizações no #historico/);
  assert.match(w.state.patches[0].body.content, /Painel de botões criado no #central/);
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
  assert.deepEqual(status.json.channelsFound.sort(), [...SETUP_CHANNELS].sort());
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
  assert.equal(w.state.posts.length, 2, 'resumo + dashboard');
  assert.equal(w.state.posts[0].channelId, channelId(w.state, 'resumo-do-dia'));
  assert.equal(w.state.posts[1].channelId, channelId(w.state, 'dashboard'));
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
  assert.equal(w.state.posts[0].body.components[0].components[0].url, `https://www.promisa.online/demo/${TOKEN}`);
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

// ---------- runtime da Vercel ----------
// Reproduz o @vercel/node (serverless-functions/helpers): lê o fluxo antes do handler, repõe uma cópia em
// req.read/req.on e cria req.body já interpretado. `for await` não vê a cópia; JSON.stringify(req.body) muda os bytes.
async function vercelLikeRequest(rawText, headers) {
  const { PassThrough } = await import('node:stream');
  const req = Readable.from([Buffer.from(rawText)]);
  for await (const chunk of req) void chunk; // o runtime consome o fluxo
  const copy = new PassThrough();
  const on = copy.on.bind(copy), originalOn = req.on.bind(req);
  req.read = copy.read.bind(copy);
  req.on = req.addListener = (name, cb) => (name === 'data' || name === 'end' ? on(name, cb) : originalOn(name, cb));
  copy.write(Buffer.from(rawText)); copy.end();
  Object.defineProperty(req, 'body', { get: () => JSON.parse(rawText) });
  return Object.assign(req, { method: 'POST', headers, url: '/api/discord' });
}

test('rota na Vercel: assinatura conferida nos bytes originais mesmo com o fluxo já lido pelo runtime', async () => {
  const w = commandWorld();
  const raw = '{"type": 1, "nota": "café \\u00e9"}'; // espaços e escapes: JSON.stringify(req.body) daria outros bytes
  assert.notEqual(JSON.stringify(JSON.parse(raw)), raw);
  const { signature, timestamp } = signed(raw);
  const req = await vercelLikeRequest(raw, { 'x-signature-ed25519': signature, 'x-signature-timestamp': timestamp, 'content-type': 'application/json' });
  assert.equal(req.readableEnded, true);
  const res = await call(w.handler, req);
  assert.equal(res.statusCode, 200, res.body);
  assert.deepEqual(res.json, { type: 1 });
  // Corpo trocado pelo objeto interpretado nunca passa na assinatura.
  const forged = Readable.from([]);
  for await (const chunk of forged) void chunk;
  Object.assign(forged, { method: 'POST', url: '/api/discord', body: JSON.parse(raw), headers: { 'x-signature-ed25519': signature, 'x-signature-timestamp': timestamp, 'content-type': 'application/json' } });
  assert.equal((await call(w.handler, forged)).statusCode, 401);
});

test('rota: a mesma interação (mesmo id) só roda uma vez; waitUntil recebe o trabalho antes da resposta', async () => {
  const w = commandWorld();
  const order = [];
  const res = response();
  const end = res.end.bind(res);
  res.end = text => { order.push('end'); end(text); };
  const pending = [];
  const handler = createDiscordHandler({ discord: w.discord, commands: { plan: () => ({ work: async () => ({ content: 'ok' }) }) }, events: {}, waitUntil: p => { order.push('waitUntil'); pending.push(p); }, authorized: async () => false, sameOrigin: () => true, log: { error() {} } });
  const payload = slash('resumo', [], { id: '123456789' });
  await handler(interactionRequest(payload), res);
  await Promise.all(pending);
  assert.deepEqual(order, ['waitUntil', 'end']);
  assert.equal(w.state.patches.length, 1);
  const again = await call(handler, interactionRequest(payload));
  assert.match(again.json.data.content, /já foi recebido/);
  assert.equal(again.json.data.flags, 64);
  await Promise.all(pending);
  assert.equal(w.state.patches.length, 1, 'repetição não executa de novo');
});

test('rota: waitUntil que falha não derruba a resposta nem gera rejeição solta', async () => {
  const w = commandWorld();
  const handler = createDiscordHandler({ discord: w.discord, commands: { plan: () => ({ work: async () => { throw new Error('x'); } }) }, events: {}, waitUntil: () => { throw new TypeError('sem contexto'); }, authorized: async () => false, sameOrigin: () => true, log: { error() {} } });
  const res = await call(handler, interactionRequest(slash('resumo')));
  assert.deepEqual(res.json, { type: 5, data: { flags: 64 } });
  await new Promise(resolve => setImmediate(resolve));
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.match(w.lastPatch().content, /Não consegui concluir/);
});

// ---------- dashboard ----------
const sampleData = () => ({
  manifest: { records: { ['sales:' + NOW.toString(36) + 'ab']: { hash: 'h' }, ['sales:' + (NOW - 30 * 86_400_000).toString(36) + 'ab']: { hash: 'h' } } },
  shares: [{ token: 'a', siteKey: 'sites:s1', createdAt: NOW - 1000, expiresAt: NOW + 2 * 86_400_000 }, { token: 'b', siteKey: 'sites:s2', createdAt: NOW - 1000, expiresAt: NOW + 20 * 86_400_000 }],
  diagnosticos: [{ token: 'T'.repeat(22), host: 'padaria.com.br', score: 7.4, createdAt: NOW - 1000 }, { token: 'U'.repeat(22), host: 'loja.com', score: 3, createdAt: NOW - 40 * 86_400_000 }],
  published: { s1: { url: 'https://s1.pages.dev', domain: 'padaria.com.br', lastPublishedAt: NOW - 1000 } }
});
function dashWorld({ read = sampleData } = {}) {
  const w = make({ channels: allChannels() });
  let reads = 0;
  const events = createEvents({
    discord: w.discord, now: () => w.clock.now, base: () => 'https://www.promisa.online', waitUntil: p => (w.pending ||= []).push(p),
    data: { manifest: async () => (reads++, read().manifest), siteName: async () => (reads++, 'Site S2') },
    shares: { all: async () => (reads++, read().shares) }, diagnosticos: { list: async () => (reads++, read().diagnosticos) }, publishedStore: { list: async () => (reads++, read().published) }
  });
  w.events = events; w.reads = () => reads;
  return w;
}
const dashPosts = w => w.state.posts.filter(p => p.channelId === channelId(w.state, 'dashboard'));

test('dashboard: KPIs, listas e botões a partir de dados baratos; limites do Discord respeitados', () => {
  const dash = buildDashboard({ ...sampleData(), names: { 'sites:s2': 'Site S2' }, at: NOW, base: 'https://www.promisa.online' });
  const payload = buildPayload(dash, NOW);
  const kpi = Object.fromEntries(payload.embeds[0].fields.map(f => [f.name, f.value]));
  assert.equal(kpi['👥 Clientes'], '**2**'); assert.equal(kpi['🆕 Novos (7 dias)'], '**1**');
  assert.equal(kpi['🌐 Sites no ar'], '**1**'); assert.equal(kpi['👀 Demos ativas'], '**2**'); assert.equal(kpi['🩺 Diagnósticos (30 dias)'], '**1**');
  assert.match(payload.embeds[0].description, /<t:\d+:R>/);
  const lists = Object.fromEntries(payload.embeds[1].fields.map(f => [f.name, f.value]));
  assert.match(lists['🚀 Últimos sites publicados'], /\[padaria\.com\.br\]\(https:\/\/padaria\.com\.br\)/);
  assert.match(lists['🩺 Últimos diagnósticos'], /🟡 \[padaria\.com\.br\].*7,4\/10/);
  assert.match(lists['⏳ Demos que vencem em breve'], /Site.*faltam 2 dias/);
  assert.doesNotMatch(lists['⏳ Demos que vencem em breve'], /Site S2/, 'só vence em 20 dias');
  assert.match(payload.embeds.at(-1).footer.text, /dashboard · atualizado/);
  assert.deepEqual(payload.components[0].components.map(c => [c.type, c.style, c.label]), [[2, 5, 'Abrir painel'], [2, 5, 'Abrir site da Promisa']]);
  assert.ok(payload.components[0].components.every(c => c.url.startsWith('https://')));
  assert.ok(buildDashboard({ manifest: null, shares: null, diagnosticos: null, published: null, at: NOW }).embeds[0].fields.every(f => /indisponível/.test(f.value)));
});

test('embeds: respeitam os limites do Discord e botões só aceitam https', () => {
  const huge = 'x'.repeat(9000);
  const embed = buildEmbed({ title: huge, description: huge, footer: huge, fields: Array.from({ length: 40 }, (_, i) => ({ name: huge, value: huge, inline: true })) }, NOW);
  const total = embed.title.length + embed.description.length + embed.footer.text.length + embed.author.name.length + embed.fields.reduce((n, f) => n + f.name.length + f.value.length, 0);
  assert.ok(embed.title.length <= 256 && embed.description.length <= 4096 && embed.fields.length <= 25 && total <= 6000);
  assert.ok(embed.fields.every(f => f.name.length <= 256 && f.value.length <= 1024));
  assert.equal(embed.author.name, 'Promisa · Central'); assert.match(embed.author.icon_url, /icon-192\.png$/); assert.equal(embed.footer.text.length <= 2048, true);
  const many = buildPayload({ embeds: [{ title: 'a', description: huge }, { title: 'b', description: huge }, { title: 'c', description: huge }] }, NOW);
  assert.ok(many.embeds.reduce((n, e) => n + e.title.length + e.description.length + e.footer.text.length + e.author.name.length, 0) <= 6000);
  assert.deepEqual(linkRow([{ label: 'Abrir', url: 'https://a.test/x' }, { label: 'Ruim', url: 'javascript:alert(1)' }, { label: 'Http', url: 'http://a.test' }]), { type: 1, components: [{ type: 2, style: 5, label: 'Abrir', url: 'https://a.test/x' }] });
  assert.equal(linkRow([{ label: 'x', url: 'http://a.test' }]), null);
  assert.equal(progressBar(32), '▰▰▰▱▱▱▱▱▱▱ 32%');
  assert.equal(inviteUrl('APP1'), 'https://discord.com/oauth2/authorize?client_id=APP1&permissions=536964112&scope=bot+applications.commands');
  assert.equal(BOT_PERMISSIONS, 1024 + 2048 + 16 + 16384 + 65536 + 8192 + 536870912);
});

test('dashboard: primeira vez cria e fixa; a segunda EDITA a mesma mensagem (inclusive em outra instância)', async () => {
  const w = dashWorld();
  assert.equal(await w.events.refreshDashboard({}), true);
  assert.equal(dashPosts(w).length, 1);
  assert.equal(w.state.pins.length, 1);
  const id = dashPosts(w)[0].id;
  assert.equal(await w.events.refreshDashboard({}), true);
  assert.equal(dashPosts(w).length, 1, 'não cria outra');
  assert.equal(w.state.edits.at(-1).id, id);
  const other = createDiscord({ fetch: w.fetch, now: () => NOW, env: ENV, log: { error() {} }, sleep: async () => {} });
  const events2 = createEvents({ discord: other, data: { manifest: async () => sampleData().manifest, siteName: async () => '' }, shares: { all: async () => [] }, diagnosticos: { list: async () => [] }, publishedStore: { list: async () => ({}) }, now: () => NOW });
  await events2.refreshDashboard({});
  assert.equal(dashPosts(w).length, 1, 'acha a mensagem pelo marcador no rodapé');
  assert.equal(w.state.edits.length, 2);
  assert.ok(w.reads() <= 8 * 2 + 4, 'poucas leituras do Blob');
});

test('dashboard: custo por atualização é de no máximo 7 leituras e sem "ler histórico" não cria mensagens soltas', async () => {
  const w = dashWorld();
  await w.events.refreshDashboard({});
  assert.ok(w.reads() <= 7, 'leituras: ' + w.reads());
  const blind = dashWorld(); blind.state.noHistory = true;
  assert.equal(await blind.events.refreshDashboard({}), false);
  assert.equal(dashPosts(blind).length, 0);
});

test('dashboard por evento: no máximo 1 a cada 60 min e 6 por dia (UTC); forçado (comando/cron) não conta', async () => {
  const w = dashWorld();
  assert.equal(w.events.dashboardSoon(), true);
  assert.equal(w.events.dashboardSoon(), false, 'dentro de 60 min');
  w.clock.now += 59 * 60_000;
  assert.equal(w.events.dashboardSoon(), false);
  await Promise.all(w.pending.splice(0));
  assert.equal(dashPosts(w).length, 1);
  let fired = 1;
  for (let i = 0; i < 8; i++) { w.clock.now += 61 * 60_000; if (new Date(w.clock.now).getUTCDate() !== 9) break; if (w.events.dashboardSoon()) fired++; }
  assert.ok(fired <= 6, 'teto diário: ' + fired);
  const day = new Date(w.clock.now).toISOString().slice(0, 10);
  assert.ok(day >= '2026-11-09');
  w.clock.now = Date.UTC(2026, 10, 10, 1, 0, 0);
  assert.equal(w.events.dashboardSoon(), true, 'novo dia UTC');
  await Promise.all(w.pending.splice(0));
  assert.equal(await w.events.refreshDashboard({}), true, 'forçado ignora o limite');
});

test('dashboard por evento: diagnóstico criado agenda a atualização por waitUntil, só uma vez por hora', async () => {
  const w = dashWorld();
  await w.events.diagnosticoCreated({ token: 'R'.repeat(22), host: 'a.com', score: 8.5, siteUrl: 'https://a.com/' });
  await w.events.sitePublished({ action: 'publish', name: 'X', url: 'https://x.pages.dev' });
  assert.equal(w.pending.length, 1);
  await Promise.all(w.pending);
  assert.equal(dashPosts(w).length, 1);
  const post = w.state.posts.find(p => p.channelId === channelId(w.state, 'diagnosticos'));
  assert.deepEqual(post.body.components[0].components.map(c => c.label), ['Ver diagnóstico', 'Abrir site']);
});

test('cron: resumo e dashboard usam UM conjunto de leituras (4 + nomes), sem ler duas vezes', async () => {
  const w = dashWorld();
  const handler = createDiscordHandler({ discord: w.discord, commands: {}, events: w.events, authorized: async () => false, sameOrigin: () => true, env: { CRON_SECRET: 'c'.repeat(40) }, log: { error() {} } });
  const res = await call(handler, request({ method: 'GET', headers: { authorization: 'Bearer ' + 'c'.repeat(40) }, query: { cron: 'summary' } }));
  assert.equal(res.json.dashboard, true);
  assert.ok(w.reads() <= 5, 'leituras: ' + w.reads());
  assert.equal(w.state.posts.length, 2);
});

test('/dashboard: só o dono; atualiza na hora; ação do painel também', async () => {
  const w = commandWorld();
  const res = await call(w.handler, interactionRequest(slash('dashboard', [], { member: { user: { id: 'INTRUSO' } } })));
  assert.match(res.json.data.content, /Só o dono/);
  assert.equal(w.state.posts.filter(p => p.channelId === channelId(w.state, 'dashboard')).length, 0);
  await w.run('dashboard');
  assert.match(w.lastPatch().content, /Dashboard atualizado/);
  assert.equal(w.state.posts.filter(p => p.channelId === channelId(w.state, 'dashboard')).length, 1);
  const panel = await call(w.handler, request({ headers: { cookie: 'ok', 'content-type': 'application/json' }, body: JSON.stringify({ action: 'dashboard' }) }));
  assert.equal(panel.json.ok, true);
  assert.equal(w.state.edits.length, 1, 'segunda vez edita');
});

// ---------- histórico de atualizações ----------
const historyOf = w => w.state.posts.filter(p => p.channelId === channelId(w.state, 'historico'));
const footersOf = posts => posts.flatMap(p => p.body.embeds.map(e => e.footer.text));

test('histórico: agrupa por dia (Brasília), do mais antigo ao mais novo, dentro dos limites do Discord', () => {
  const messages = buildHistoryMessages(RELEASES);
  const embeds = messages.flatMap(m => m.embeds);
  assert.deepEqual(embeds.map(e => /(\d\d\/\d\d)/.exec(e.title)[1]), ['07/11', '08/11', '08/11', '09/11', '11/11', '12/11']);
  assert.match(embeds[2].title, /continuação/);
  assert.equal(RELEASES.length, 30);
  assert.deepEqual(embeds.flatMap(e => e.numbers), RELEASES.map(r => r.n), 'ordem e nenhuma faltando');
  for (const m of messages) {
    assert.ok(m.embeds.length <= 10);
    assert.ok(m.embeds.reduce((sum, e) => sum + e.title.length + e.description.length + e.footer.length + 17, 0) <= 6000);
    for (const e of m.embeds) assert.ok(e.description.length <= 4096 && e.footer.length <= 200);
  }
  assert.match(embeds[0].description, /\[#4\]\(https:\/\/github\.com\/xdzinjesus\/promisa_criativa\/pull\/4\)/);
  assert.match(embeds[0].description, /^✨/);
  assert.ok(RELEASES.every(r => r.why.length > 10 && KINDS[r.kind]));
  const many = Array.from({ length: 300 }, (_, i) => ({ n: 1000 + i, at: new Date(Date.UTC(2026, 0, 1 + i, 15)).toISOString(), kind: 'novidade', t: 'T' + i, why: 'x'.repeat(200) }));
  const split = buildHistoryMessages(many);
  assert.ok(split.length > 1 && split.every(m => m.embeds.length <= 10));
  const next = addRelease(RELEASES, release(46, '2026-11-13T12:00:00Z', 'correcao', 'Teste', 'Algo foi consertado.'), release(45, '2026-11-13T12:00:00Z', 'novidade', 'dup', 'dup'));
  assert.equal(next.length, 31); assert.equal(next.at(-1).n, 46);
  assert.deepEqual([...postedFromFooters(['histórico · #3 #10', 'Promisa · #7', 'histórico · início'])], [3, 10]);
});

test('setup: posta o histórico uma vez e depois só as novidades (sem duplicar)', async () => {
  const w = make({ channels: allChannels() });
  const first = await w.discord.setupChannels();
  assert.equal(first.historyPosted, 30);
  const posts = historyOf(w);
  assert.equal(posts.filter(p => p.body.embeds[0].title === '📜 Histórico de atualizações da Promisa').length, 1);
  assert.equal(posts.at(-1).body.embeds.at(-1).title.includes('12/11'), true);
  const noted = footersOf(posts).join(' ').match(/#\d+/g).map(x => Number(x.slice(1)));
  assert.deepEqual(noted, RELEASES.map(r => r.n));
  assert.ok(w.state.calls.some(c => c.path.endsWith('/messages?limit=50')));
  const count = posts.length;
  w.discord.resetChannels();
  const again = await w.discord.setupChannels();
  assert.equal(again.historyPosted, 0);
  assert.equal(historyOf(w).length, count);
  const channel = channelId(w.state, 'historico');
  let erased = 0;
  for (const m of w.state.messages[channel]) for (const e of m.embeds) if (/#44/.test(e.footer.text)) { erased += (e.footer.text.match(/#\d+/g) || []).length; e.footer = { text: 'histórico · apagado' }; }
  w.discord.resetChannels();
  assert.ok(erased >= 1);
  assert.equal((await w.discord.setupChannels()).historyPosted, erased, 'reposta só as que sumiram');
  assert.equal(historyOf(w).length, count + 1);
  assert.match(footersOf(historyOf(w).slice(-1)).join(), /histórico · .*#44/);
  const blind = make({ channels: allChannels() }); blind.state.noHistory = true;
  await blind.discord.setupChannels();
  assert.equal(historyOf(blind).length, 0);
});

test('histórico: canal #historico é criado só leitura para @everyone, na categoria SISTEMA', async () => {
  const w = make({ channels: allChannels().filter(c => !/historico/.test(c.name)) });
  await w.discord.setupChannels();
  const made = w.state.created.find(c => c.name === '📜・historico');
  assert.equal(made.permission_overwrites.find(o => o.id === 'G1').deny, '2048');
  assert.equal(made.parent_id, w.state.channels.find(c => c.type === 4 && c.name === '⚙️ SISTEMA').id);
});

// ---------- central (painel de botões) ----------
test('setup: #comandos antigo é renomeado para #central (sem duplicar) e o painel é criado e depois editado', async () => {
  const w = make({ channels: [{ type: 4, name: '⚙️ SISTEMA', id: 'cat-sistema' }, { type: 0, name: '🤖・comandos', parent_id: 'cat-sistema', id: 'cmd' }] });
  const result = await w.discord.setupChannels();
  assert.ok(result.moved.includes('central'));
  assert.ok(!result.created.includes('central'));
  assert.equal(w.state.channels.filter(c => slugOf(c.name) === 'central').length, 1);
  assert.equal(w.state.channels.find(c => c.id === 'cmd').name, '🎛️・central');
  assert.ok(!w.state.channels.some(c => slugOf(c.name) === 'comandos'));
  const panels = w.state.posts.filter(p => p.channelId === 'cmd' && p.body.components?.length);
  assert.equal(panels.length, 1);
  const body = panels[0].body;
  assert.equal(body.embeds[0].title, '🎛️ Central da Promisa — toque num botão');
  assert.match(body.embeds[0].footer.text, /central · painel/);
  assert.equal(body.components.length, 2);
  assert.deepEqual(body.components.map(r => r.components.map(b => b.custom_id)), [['pc:diag', 'pc:demo', 'pc:pub'], ['pc:cli', 'pc:dash', 'pc:resumo']]);
  assert.deepEqual(body.components.flatMap(r => r.components.map(b => b.label)), ['🩺 Novo diagnóstico', '🔗 Criar demonstração', '🚀 Publicar site', '👤 Ver cliente', '📊 Atualizar dashboard', '☀️ Resumo agora']);
  assert.equal(result.centralCreated, true);
  w.discord.resetChannels();
  const again = await w.discord.setupChannels();
  assert.equal(again.centralCreated, false);
  assert.equal(w.state.posts.filter(p => p.channelId === 'cmd' && p.body.components?.length).length, 1, 'não duplica');
  assert.ok(w.state.edits.some(e => e.channelId === 'cmd' && e.body.components?.length === 2), 'editou no lugar');
  const old = make({ channels: [{ type: 0, name: 'comandos' }] });
  assert.equal(await old.discord.notify('central', { title: 'oi' }), true);
});

// ---------- botões da central ----------
const ownerComponent = (data, extra = {}, type = 3) => ({ type, id: 'I' + Math.random().toString(36).slice(2), token: ITOKEN, guild_id: 'G1', member: { user: { id: 'OWNER' } }, data, ...extra });
function centralWorld({ sites = 30 } = {}) {
  const w = commandWorld();
  const records = {};
  for (let i = 0; i < sites; i++) records['sites:S' + i] = { hash: 'h', path: 'p' + i, updatedAt: new Date(Date.UTC(2026, 10, 1, i)).toISOString() };
  w.reads = [];
  const data = createData({
    readManifest: async () => ({ manifest: { version: 1, records } }),
    get: async path => { w.reads.push(path); const n = path.slice(1); return { stream: new Response(JSON.stringify({ version: 1, value: n === '1' ? { id: 'S1', name: 'Site Padaria', leadId: 'L1' } : { id: 'S' + n, name: 'Site ' + n } })).body, blob: { size: 50 } }; },
    token: () => 't', now: () => NOW
  });
  const events = createEvents({ discord: w.discord, data, shares: { all: async () => [] }, diagnosticos: { list: async () => [] }, publishedStore: { list: async () => ({}) }, now: () => NOW, base: () => 'https://www.promisa.online' });
  const commands = createCommands({
    discord: w.discord, data, events, shares: { all: async () => [], create: async (siteId, expiresAt) => { const share = { token: 'N'.repeat(22), siteKey: 'sites:' + siteId, createdAt: NOW, expiresAt }; w.createdShares.push(share); return share; } },
    diagnosticos: { list: async () => [], create: async report => { const full = { token: 'R'.repeat(22), expiresAt: NOW + 86_400_000, ...report }; w.diagCreated.push(full); return full; } },
    publishedStore: { list: async () => w.published, get: async id => w.published[id] || null, set: async (id, patch) => (w.published[id] = { ...(w.published[id] || {}), ...patch }) },
    now: () => NOW, base: () => 'https://www.promisa.online',
    analyze: async url => ({ siteUrl: 'https://padaria.com.br/', host: String(url).replace(/^www\./, ''), score: 7.2, items: [], psi: null, info: {} }),
    cloudflare: () => ({ deploy: async project => { w.deployed.push(project); return { project, url: 'https://' + project + '.pages.dev', deploymentId: 'dep1', uploaded: 3, total: 5 }; } }),
    readSiteInfo: async () => ({ site: { name: 'Site Padaria', files: [] }, filesHash: 'f'.repeat(64) }), publishSite
  });
  const pending = [];
  w.handler = createDiscordHandler({ discord: w.discord, commands, events, waitUntil: p => pending.push(p), env: {}, log: { error() {} }, authorized: async () => false, sameOrigin: () => true });
  w.press = async (payload, opts) => { const res = await call(w.handler, interactionRequest(payload, opts)); await Promise.all(pending.splice(0)); return res; };
  return w;
}

test('botões: sem assinatura, de outra pessoa ou de outro servidor nada acontece', async () => {
  const w = centralWorld();
  const button = ownerComponent({ custom_id: 'pc:resumo', component_type: 2 });
  const signedBody = JSON.stringify(button), { signature, timestamp } = signed(signedBody);
  const altered = await call(w.handler, request({ headers: { 'x-signature-ed25519': signature, 'x-signature-timestamp': timestamp }, body: signedBody.replace('pc:resumo', 'pc:pub') }));
  assert.equal(altered.statusCode, 401);
  assert.equal((await call(w.handler, interactionRequest(ownerComponent({ custom_id: 'pc:resumo', component_type: 2 }), { at: NOW - 10 * 60_000 }))).statusCode, 401);
  assert.equal((await call(w.handler, request({ headers: { 'x-signature-ed25519': 'a'.repeat(128), 'x-signature-timestamp': String(Math.floor(NOW / 1000)) }, body: JSON.stringify(button) }))).statusCode, 401);
  for (const [custom_id, type] of [['pc:diag', 3], ['pc:pub', 3], ['pc:diagmodal', 5]]) {
    const stranger = await w.press(ownerComponent({ custom_id, component_type: 2 }, { member: { user: { id: 'OUTRA' } } }, type));
    assert.equal(stranger.json.type, 4); assert.equal(stranger.json.data.flags, 64);
    assert.equal(stranger.json.data.content, '🔒 Só o dono pode usar.');
  }
  const select = await w.press(ownerComponent({ custom_id: 'pc:pub:sel', component_type: 3, values: ['S1'] }, { member: { user: { id: 'OUTRA' } } }));
  assert.equal(select.json.data.content, '🔒 Só o dono pode usar.');
  const wrong = await w.press(ownerComponent({ custom_id: 'pc:pub', component_type: 2 }, { guild_id: 'OUTRO' }));
  assert.match(wrong.json.data.content, /só funciona no servidor/);
  const modalWrong = await w.press(ownerComponent({ custom_id: 'pc:diagmodal', components: [] }, { guild_id: 'OUTRO' }, 5));
  assert.match(modalWrong.json.data.content, /só funciona no servidor/);
  assert.equal(w.state.patches.length, 0); assert.equal(w.deployed.length, 0); assert.equal(w.diagCreated.length, 0); assert.equal(w.reads.length, 0);
  const id = 'repetida';
  assert.equal((await w.press(ownerComponent({ custom_id: 'pc:diag', component_type: 2 }, { id }))).json.type, 9);
  assert.match((await w.press(ownerComponent({ custom_id: 'pc:diag', component_type: 2 }, { id }))).json.data.content, /já foi recebido/);
});

test('pc:diag abre o formulário; ao enviar, roda o diagnóstico e responde só para o dono', async () => {
  const w = centralWorld();
  const modal = await w.press(ownerComponent({ custom_id: 'pc:diag', component_type: 2 }));
  assert.equal(modal.json.type, 9);
  assert.equal(modal.json.data.custom_id, 'pc:diagmodal');
  const input = modal.json.data.components[0].components[0];
  assert.deepEqual([input.type, input.style, input.required, input.max_length, input.label, input.placeholder], [4, 1, true, 300, 'Endereço do site', 'ex.: padaria.com.br']);
  assert.equal(w.reads.length, 0, 'abrir o formulário não lê o Blob');
  const submit = await w.press(ownerComponent({ custom_id: 'pc:diagmodal', components: [{ type: 1, components: [{ type: 4, custom_id: 'url', value: 'www.padaria.com.br' }] }] }, {}, 5));
  assert.deepEqual(submit.json, { type: 5, data: { flags: 64 } });
  assert.equal(w.diagCreated.length, 1);
  assert.match(w.lastPatch().embeds[0].title, /Diagnóstico de padaria\.com\.br/);
  assert.equal(w.lastPatch().components[0].components[0].label, 'Ver diagnóstico');
  assert.ok(w.state.posts.some(p => p.channelId === channelId(w.state, 'diagnosticos')), 'aviso normal no canal');
  const empty = await w.press(ownerComponent({ custom_id: 'pc:diagmodal', components: [] }, {}, 5));
  assert.equal(empty.json.type, 5);
  assert.match(w.lastPatch().content, /Informe o endereço/);
  const unknown = await w.press(ownerComponent({ custom_id: 'pc:outro', components: [] }, {}, 5));
  assert.match(unknown.json.data.content, /não é mais válido/);
});

test('pc:pub lista no máximo 25 sites (mais recentes primeiro) e escolher um publica', async () => {
  const w = centralWorld({ sites: 30 });
  const res = await w.press(ownerComponent({ custom_id: 'pc:pub', component_type: 2 }));
  assert.deepEqual(res.json, { type: 5, data: { flags: 64 } });
  assert.ok(w.reads.length <= 25, `leituras: ${w.reads.length}`);
  const select = w.lastPatch().components[0].components[0];
  assert.equal(select.type, 3); assert.equal(select.custom_id, 'pc:pub:sel');
  assert.equal(select.options.length, 25);
  assert.equal(select.options[0].value, 'S29', 'mais recente primeiro');
  assert.ok(select.options.every(o => o.label && o.label.length <= 100 && o.value.length <= 100));
  w.reads.length = 0;
  const pick = await w.press(ownerComponent({ custom_id: 'pc:pub:sel', component_type: 3, values: ['S1'] }));
  assert.deepEqual(pick.json, { type: 5, data: { flags: 64 } });
  assert.equal(w.deployed.length, 1);
  assert.match(w.lastPatch().embeds[0].description, /pages\.dev/);
  assert.equal(w.published.S1.lastDeploymentId, 'dep1');
  assert.ok(w.state.posts.some(p => p.channelId === channelId(w.state, 'sites-no-ar')), 'aviso normal no canal');
  assert.ok(w.reads.length <= 2, `leituras ao escolher: ${w.reads.length}`);
});

test('botões demo e cliente: seletor de sites e resultado; lista vazia é tratada', async () => {
  const w = centralWorld({ sites: 3 });
  await w.press(ownerComponent({ custom_id: 'pc:demo', component_type: 2 }));
  const demoSelect = w.lastPatch().components[0].components[0];
  assert.equal(demoSelect.custom_id, 'pc:demo:sel'); assert.match(demoSelect.placeholder, /7 dias/);
  await w.press(ownerComponent({ custom_id: 'pc:demo:sel', component_type: 3, values: ['S1'] }));
  assert.equal(w.createdShares.length, 1);
  assert.equal(w.createdShares[0].expiresAt, NOW + 7 * 86_400_000);
  assert.match(w.lastPatch().embeds[0].description, /\/demo\/N{22}/);
  await w.press(ownerComponent({ custom_id: 'pc:cli', component_type: 2 }));
  assert.equal(w.lastPatch().components[0].components[0].custom_id, 'pc:cli:sel');
  await w.press(ownerComponent({ custom_id: 'pc:cli:sel', component_type: 3, values: ['S1'] }));
  assert.match(w.lastPatch().embeds[0].fields[0].name, /Site Padaria/);
  const none = centralWorld({ sites: 0 });
  await none.press(ownerComponent({ custom_id: 'pc:pub', component_type: 2 }));
  assert.match(none.lastPatch().content, /Ainda não há sites/);
});

test('botões: ids reservados ou inválidos são recusados sem tocar em nada', async () => {
  const w = centralWorld();
  for (const value of ['__proto__', 'constructor', 'prototype', '../x', 'a b', '', 'x'.repeat(200)]) {
    const res = await w.press(ownerComponent({ custom_id: 'pc:pub:sel', component_type: 3, values: [value] }));
    assert.equal(res.json.type, 4, JSON.stringify(value));
    assert.match(res.json.data.content, /Site inválido/);
  }
  for (const values of [[], ['S1', 'S2'], 'S1', [5]]) {
    const res = await w.press(ownerComponent({ custom_id: 'pc:pub:sel', component_type: 3, values }));
    assert.equal(res.json.type, 4);
  }
  const other = await w.press(ownerComponent({ custom_id: 'pc:xyz:sel', component_type: 3, values: ['S1'] }));
  assert.match(other.json.data.content, /não é mais válido/);
  assert.equal(w.deployed.length, 0); assert.equal(w.createdShares.length, 0); assert.equal(w.reads.length, 0);
});

test('botões dashboard e resumo respondem só para o dono', async () => {
  const w = centralWorld();
  const dash = await w.press(ownerComponent({ custom_id: 'pc:dash', component_type: 2 }));
  assert.deepEqual(dash.json, { type: 5, data: { flags: 64 } });
  assert.match(w.lastPatch().content, /Dashboard atualizado/);
  assert.ok(w.state.posts.some(p => p.channelId === channelId(w.state, 'dashboard')));
  await w.press(ownerComponent({ custom_id: 'pc:resumo', component_type: 2 }));
  assert.match(w.lastPatch().embeds[0].title, /Resumo de/);
});

test('/ajuda aponta primeiro para os botões do #central', async () => {
  const w = commandWorld();
  const help = await w.run('ajuda');
  assert.ok(help.json.data.content.indexOf('#central') < help.json.data.content.indexOf('/diagnostico'));
});
