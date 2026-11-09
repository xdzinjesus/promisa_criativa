import { createPublicKey, verify as cryptoVerify } from 'node:crypto';
import { HISTORY_HEADER, HISTORY_MARK, buildHistoryMessages, pendingReleases, postedFromFooters } from './discord-releases.js';

// Integração com o Discord (avisos + comandos). Núcleo com dependências injetáveis (fetch, relógio, variáveis),
// para testar sem rede. Sem as variáveis DISCORD_* tudo vira "não faz nada" (silencioso).
// Segredos (token do bot, chave pública, token da interação) nunca vão para logs nem para mensagens.
export const API = 'https://discord.com/api/v10';
export const CATEGORY = 'PROMISA'; // categoria antiga (nunca é apagada)
export const LEGACY_CATEGORY = CATEGORY;
// Organização do servidor: categorias e canais (nomes com emoji e "・"). A chave lógica (slug) é o nome sem o prefixo.
export const LAYOUT = [
  { slug: 'painel', name: '📊 PAINEL', channels: ['dashboard', 'resumo-do-dia'] },
  { slug: 'clientes', name: '💼 CLIENTES', channels: ['novos-clientes', 'demonstracoes', 'diagnosticos'] },
  { slug: 'sites', name: '🌐 SITES', channels: ['sites-em-criacao', 'sites-no-ar'] },
  { slug: 'sistema', name: '⚙️ SISTEMA', channels: ['alertas', 'central', 'historico', 'github'] }
];
export const CHANNELS = ['dashboard', 'resumo-do-dia', 'novos-clientes', 'demonstracoes', 'diagnosticos', 'sites-no-ar', 'alertas', 'central', 'historico'];
// Canais criados/organizados no setup. O robô da Promisa não escreve em 'github' (webhook do GitHub) nem em
// 'sites-em-criacao' (usado pelo robô separado do Codex, que gera sites de clientes).
export const SETUP_CHANNELS = [...CHANNELS, 'github', 'sites-em-criacao'];
export const FALLBACK_CHANNEL = 'alertas';
const DEFS = {
  dashboard: { name: '📊・dashboard', readOnly: true, topic: 'Visão geral do negócio, atualizada pelo robô. Só leitura.' },
  'resumo-do-dia': { name: '☀️・resumo-do-dia', readOnly: true, topic: 'Resumo diário das 8h' },
  'novos-clientes': { name: '🆕・novos-clientes', topic: 'Briefings respondidos pelos clientes' },
  demonstracoes: { name: '👀・demonstracoes', topic: 'Quando alguém abre um link de demonstração' },
  diagnosticos: { name: '🩺・diagnosticos', topic: 'Diagnósticos de site criados' },
  'sites-no-ar': { name: '🚀・sites-no-ar', topic: 'Sites publicados na internet' },
  alertas: { name: '🚨・alertas', topic: 'Avisos importantes: armazenamento, falhas e erros' },
  'sites-em-criacao': { name: '🏗️・sites-em-criacao', topic: 'Sites de clientes sendo criados pelo Codex. Os arquivos são validados pelo Claude e anexados no painel.' },
  github: { name: '💻・github', topic: 'Atualizações do código e das publicações (GitHub)' },
  central: { name: '🎛️・central', topic: 'Painel de botões do dono: diagnóstico, demonstração, publicar e mais' },
  historico: { name: '📜・historico', readOnly: true, topic: 'Histórico de tudo que já foi feito no sistema. Só leitura.' }
};
// Nomes antigos que valem o mesmo canal (o setup renomeia, nunca duplica).
const ALIASES = { central: ['comandos'] };
export const CHANNEL_NAMES = Object.fromEntries(SETUP_CHANNELS.map(slug => [slug, DEFS[slug].name]));
export const COLORS = { brand: 0x7c3aed, ok: 0x22c55e, warn: 0xf59e0b, bad: 0xef4444, info: 0x3b82f6 };
// Permissões do robô: Ver canais 1024 + Enviar 2048 + Gerenciar canais 16 + Links 16384 + Histórico 65536 + Gerenciar mensagens 8192.
export const BOT_PERMISSIONS = 93200;
export const inviteUrl = appId => `https://discord.com/oauth2/authorize?client_id=${encodeURIComponent(appId)}&permissions=${BOT_PERMISSIONS}&scope=bot+applications.commands`;
export const ICON_URL = 'https://www.promisa.online/assets/icon-192.png';
export const FOOTER = 'Promisa Criação Digital';
export const DASH_MARK = 'dashboard · atualizado';
export const CENTRAL_MARK = 'central · painel';
// Botões da central (custom_id sempre começa com "pc:"). Linha 1 e linha 2.
export const CENTRAL_ROWS = [
  [['pc:diag', '🩺 Novo diagnóstico'], ['pc:demo', '🔗 Criar demonstração'], ['pc:pub', '🚀 Publicar site']],
  [['pc:cli', '👤 Ver cliente'], ['pc:dash', '📊 Atualizar dashboard'], ['pc:resumo', '☀️ Resumo agora']]
];
export const CENTRAL_MESSAGE = {
  title: '🎛️ Central da Promisa — toque num botão',
  description: 'Tudo aqui é só para o dono e as respostas aparecem só para você.\n\n🩺 **Novo diagnóstico**: analisa o site de uma empresa\n🔗 **Criar demonstração**: link para o cliente ver o site (7 dias)\n🚀 **Publicar site**: coloca o site do cliente na internet\n👤 **Ver cliente**: etapa, plano, site e links\n📊 **Atualizar dashboard**: atualiza o canal #dashboard\n☀️ **Resumo agora**: o resumo do dia na hora',
  footer: `${FOOTER} · ${CENTRAL_MARK}`
};
export const centralPayload = at => {
  const payload = buildPayload({ ...CENTRAL_MESSAGE, color: COLORS.brand, thumbnail: ICON_URL }, at);
  return { ...payload, components: CENTRAL_ROWS.map((row, index) => ({ type: 1, components: row.map(([custom_id, label]) => ({ type: 2, style: index === 0 ? 1 : 2, label, custom_id })) })) };
};
export const HELP_LINES = [
  '`/diagnostico url:` analisa o site de uma empresa e gera o link do relatório',
  '`/cliente nome:` mostra etapa, plano, site, demonstração e publicação',
  '`/demo nome: dias:` cria um link de demonstração (1 a 30 dias, padrão 7)',
  '`/publicar nome:` publica ou atualiza o site do cliente na internet',
  '`/resumo` mostra o resumo do dia agora',
  '`/dashboard` atualiza o painel do canal #dashboard agora',
  '`/configurar` organiza os canais e atualiza os comandos',
  '`/ajuda` mostra esta lista'
];
const WELCOME = {
  dashboard: { title: '👋 Bem-vindo ao Painel', description: 'Aqui fica **uma única mensagem** com o resumo do negócio. O robô a atualiza sozinho (todo dia e quando algo importante acontece). Para atualizar na hora, use `/dashboard`.' },
  'resumo-do-dia': { title: '👋 Bem-vindo ao Resumo do dia', description: 'Todo dia de manhã chega aqui o movimento das últimas 24 horas: clientes, demonstrações, diagnósticos e sites.' },
  'novos-clientes': { title: '👋 Bem-vindo a Novos clientes', description: 'Cada briefing respondido por um cliente aparece aqui, sem dados pessoais. Os detalhes ficam no painel.' },
  demonstracoes: { title: '👋 Bem-vindo a Demonstrações', description: 'Quando alguém abre um link de demonstração, o robô avisa aqui.' },
  diagnosticos: { title: '👋 Bem-vindo a Diagnósticos', description: 'Todo diagnóstico de site criado aparece aqui com a nota e o link do relatório.' },
  'sites-no-ar': { title: '👋 Bem-vindo a Sites no ar', description: 'Avisos de sites publicados ou domínios ligados.' },
  alertas: { title: '👋 Bem-vindo a Alertas', description: 'Avisos importantes: armazenamento quase cheio, falhas ao publicar e erros das rotinas automáticas.' },
  'sites-em-criacao': { title: '👋 Bem-vindo a Sites em criação', description: 'Aqui o robô do **Codex** entrega os sites de clientes que você pediu (HTML ou ZIP).\n\n**Fluxo:** 1) o Codex cria · 2) você manda o arquivo para o **Claude** validar · 3) anexa no cliente pelo painel · 4) envia a demonstração.' },
  github: { title: '👋 Bem-vindo ao GitHub', description: 'Aqui chegam os avisos do GitHub: mudanças no código, aprovações e publicações na Vercel.' },
  central: { title: '👋 Bem-vindo à Central', description: 'Aqui fica o **painel de botões** da Promisa: é só tocar, sem digitar nada (só o dono consegue). Se preferir, também dá para digitar `/`:\n' + HELP_LINES.join('\n') },
  historico: { title: '👋 Bem-vindo ao Histórico', description: 'Aqui fica o histórico de tudo que já foi feito no sistema.' }
};
// "🆕・novos-clientes" e "novos-clientes" valem o mesmo canal.
export const slugOf = name => { const text = String(name ?? '').toLowerCase(); const at = text.indexOf('・'); return (at >= 0 ? text.slice(at + 1) : text).trim(); };
const categorySlug = name => String(name ?? '').toLowerCase().replace(/^[^\p{L}\p{N}]+/u, '').trim();
export const COMMANDS = [
  { name: 'diagnostico', description: 'Analisa o site de uma empresa e gera o link do diagnóstico', options: [{ type: 3, name: 'url', description: 'Endereço do site, ex.: www.empresa.com.br', required: true, max_length: 300 }] },
  { name: 'cliente', description: 'Mostra a situação de um cliente (etapa, site, demonstração, publicação)', options: [{ type: 3, name: 'nome', description: 'Nome do cliente (ou parte dele)', required: true, max_length: 100 }] },
  { name: 'demo', description: 'Cria um link de demonstração do site de um cliente', options: [
    { type: 3, name: 'nome', description: 'Nome do cliente (ou parte dele)', required: true, max_length: 100 },
    { type: 4, name: 'dias', description: 'Validade do link em dias (1 a 30, padrão 7)', required: false, min_value: 1, max_value: 30 }
  ] },
  { name: 'publicar', description: 'Publica ou atualiza o site de um cliente na internet', options: [{ type: 3, name: 'nome', description: 'Nome do cliente (ou parte dele)', required: true, max_length: 100 }] },
  { name: 'resumo', description: 'Mostra o resumo do dia agora' },
  { name: 'dashboard', description: 'Atualiza o painel do canal #dashboard agora' },
  { name: 'configurar', description: 'Organiza os canais do servidor e atualiza os comandos' },
  { name: 'ajuda', description: 'Lista os comandos disponíveis' }
].map(command => ({ ...command, dm_permission: false }));

const SPKI_ED25519 = Buffer.from('302a300506032b6570032100', 'hex');
const MAX_SKEW_MS = 5 * 60 * 1000;
const keyCache = new Map();
function publicKeyObject(hex) {
  if (keyCache.has(hex)) return keyCache.get(hex);
  const key = createPublicKey({ key: Buffer.concat([SPKI_ED25519, Buffer.from(hex, 'hex')]), format: 'der', type: 'spki' });
  if (keyCache.size > 8) keyCache.clear();
  keyCache.set(hex, key);
  return key;
}
// Confere a assinatura Ed25519 do Discord: assina (timestamp + corpo bruto). Recusa pedidos com mais de 5 minutos.
export function verifyInteraction(rawBody, signature, timestamp, publicKeyHex, nowMs = Date.now()) {
  try {
    if (typeof signature !== 'string' || !/^[0-9a-f]{128}$/i.test(signature)) return false;
    if (typeof publicKeyHex !== 'string' || !/^[0-9a-f]{64}$/i.test(publicKeyHex)) return false;
    if (typeof timestamp !== 'string' || !/^\d{1,12}$/.test(timestamp)) return false;
    if (Math.abs(nowMs - Number(timestamp) * 1000) > MAX_SKEW_MS) return false;
    const body = Buffer.isBuffer(rawBody) ? rawBody : typeof rawBody === 'string' ? Buffer.from(rawBody, 'utf8') : null;
    if (!body) return false;
    return cryptoVerify(null, Buffer.concat([Buffer.from(timestamp, 'utf8'), body]), publicKeyObject(publicKeyHex.toLowerCase()), Buffer.from(signature, 'hex'));
  } catch { return false; }
}

const clip = (value, max) => { const text = String(value ?? ''); return text.length > max ? text.slice(0, max - 1) + '…' : text; };
// Hora de Brasília para as mensagens.
export const formatBrt = ms => new Date(ms).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' });

export const progressBar = (percent, size = 10) => {
  const pct = Math.max(0, Math.min(100, Math.round(Number(percent) || 0)));
  const filled = Math.round(pct / 100 * size);
  return '▰'.repeat(filled) + '▱'.repeat(size - filled) + ` ${pct}%`;
};
export const gradeDot = score => (Number(score) >= 8 ? '🟢' : Number(score) >= 5 ? '🟡' : '🔴');
export const gradeText = score => `${gradeDot(score)} ${(Number.isFinite(Number(score)) ? Number(score) : 0).toFixed(1).replace('.', ',')}/10`;

// Limites do Discord: título 256, descrição 4096, 25 campos, nome 256, valor 1024, rodapé 2048, total 6000 (por mensagem).
export function buildEmbed({ title, description, fields, url, color, thumbnail, footer }, at, budget = 5800) {
  const embed = {
    author: { name: 'Promisa · Central', icon_url: ICON_URL },
    title: clip(title, 250), color: Number.isInteger(color) ? color : COLORS.brand,
    timestamp: new Date(at).toISOString(), footer: { text: clip(footer || FOOTER, 200) }
  };
  if (description) embed.description = clip(description, 4000);
  if (url && /^https:\/\//.test(url)) embed.url = clip(url, 500);
  if (typeof thumbnail === 'string' && /^https:\/\//.test(thumbnail)) embed.thumbnail = { url: clip(thumbnail, 500) };
  if (Array.isArray(fields) && fields.length) {
    embed.fields = fields.filter(field => field && field.name && field.value).slice(0, 25).map(field => ({ name: clip(field.name, 250), value: clip(field.value, 1000), inline: Boolean(field.inline) }));
  }
  const size = () => embed.title.length + (embed.description?.length || 0) + embed.footer.text.length + embed.author.name.length + (embed.fields || []).reduce((sum, field) => sum + field.name.length + field.value.length, 0);
  while (embed.fields?.length && size() > budget) embed.fields.pop();
  if (size() > budget && embed.description) embed.description = clip(embed.description, Math.max(1, embed.description.length - (size() - budget)));
  return embed;
}
// Botões de link (type 2, style 5): { label, url } → uma linha de componentes. Só endereços https.
export function linkRow(buttons) {
  const list = (Array.isArray(buttons) ? buttons : []).filter(button => button && button.label && typeof button.url === 'string' && /^https:\/\//.test(button.url)).slice(0, 5);
  return list.length ? { type: 1, components: list.map(button => ({ type: 2, style: 5, label: clip(button.label, 80), url: clip(button.url, 500) })) } : null;
}
// Mensagem completa: { embeds, components }. `message.embeds` (lista) ou a própria mensagem; `message.buttons` vira botões de link.
export function buildPayload(message, at) {
  const list = Array.isArray(message.embeds) ? message.embeds.slice(0, 10) : [message];
  const budget = Math.floor(5800 / Math.max(1, list.length));
  const row = linkRow(message.buttons);
  return { embeds: list.map(item => buildEmbed(item, at, budget)), components: row ? [row] : [] };
}

export function createDiscord({ fetch: fetchFn = (...args) => globalThis.fetch(...args), now = () => Date.now(), env = process.env, log = console, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)), notifyTimeoutMs = 2500, commandTimeoutMs = 10_000, channelTtlMs = 10 * 60_000, dedupeMs = 60_000 } = {}) {
  const cfg = () => ({
    token: String(env.DISCORD_BOT_TOKEN || '').trim(), appId: String(env.DISCORD_APP_ID || '').trim(), publicKey: String(env.DISCORD_PUBLIC_KEY || '').trim(),
    guildId: String(env.DISCORD_GUILD_ID || '').trim(), ownerId: String(env.DISCORD_OWNER_ID || '').trim()
  });
  const configured = () => { const c = cfg(); return Boolean(c.token && c.guildId); };
  const interactionsConfigured = () => { const c = cfg(); return Boolean(c.token && c.guildId && c.appId && c.publicKey && c.ownerId); };
  // Só o nome do erro vai para o log: nunca token, endereços ou conteúdo.
  const warn = (where, error) => { try { log.error?.('[discord]', where, error?.name || error?.constructor?.name || 'erro'); } catch { /* sem log */ } };

  // Chamada à API REST. Nunca lança. Respeita 429 (retry_after) uma única vez, dentro do tempo total.
  async function request(method, path, body, { timeoutMs = commandTimeoutMs, auth = true } = {}) {
    const c = cfg();
    if (auth && !c.token) return { ok: false, status: 0, data: null };
    const deadline = now() + timeoutMs;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      for (let attempt = 0; attempt < 2; attempt++) {
        const response = await fetchFn(API + path, {
          method, signal: controller.signal,
          headers: { ...(auth ? { Authorization: `Bot ${c.token}` } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), 'User-Agent': 'DiscordBot (https://www.promisa.online, 1.0)' },
          body: body === undefined ? undefined : JSON.stringify(body)
        });
        const data = await response.json().catch(() => null);
        if (response.status === 429 && attempt === 0) {
          const wait = Math.ceil((Number(data?.retry_after) || 1) * 1000);
          if (now() + wait >= deadline) return { ok: false, status: 429, data: null };
          await sleep(wait);
          continue;
        }
        return { ok: response.ok, status: response.status, data };
      }
      return { ok: false, status: 429, data: null };
    } catch (error) { warn(method, error); return { ok: false, status: 0, data: null }; }
    finally { clearTimeout(timer); }
  }

  // ---- canais (procurados pelo nome, guardados 10 minutos) ----
  let channelCache = null, channelFailure = 0;
  let lastLoadStatus = 0;
  async function loadChannels({ force = false } = {}) {
    if (!force && channelCache && channelCache.expires > now()) return channelCache;
    if (!force && channelFailure > now()) return null;
    const result = await request('GET', `/guilds/${encodeURIComponent(cfg().guildId)}/channels`, undefined, { timeoutMs: force ? commandTimeoutMs : notifyTimeoutMs });
    if (!result.ok || !Array.isArray(result.data)) { channelFailure = now() + 30_000; lastLoadStatus = result.status; return null; }
    const text = new Map(), categories = new Map(), all = [];
    for (const channel of result.data) {
      if (!channel || typeof channel.name !== 'string' || typeof channel.id !== 'string') continue;
      all.push({ id: channel.id, type: channel.type, parent_id: channel.parent_id || null });
      const slug = slugOf(channel.name);
      if (channel.type === 0 && !text.has(slug)) text.set(slug, { id: channel.id, name: channel.name, parent_id: channel.parent_id || null, topic: channel.topic || '', overwrites: Array.isArray(channel.permission_overwrites) ? channel.permission_overwrites : [] });
      if (channel.type === 4 && !categories.has(categorySlug(channel.name))) categories.set(categorySlug(channel.name), { id: channel.id, name: channel.name });
    }
    for (const [slug, olds] of Object.entries(ALIASES)) {
      if (text.has(slug)) continue;
      const old = olds.find(name => text.has(name));
      if (old) text.set(slug, text.get(old)); // nome antigo vale o mesmo canal; o setup renomeia
    }
    channelCache = { text, categories, all, expires: now() + channelTtlMs };
    channelFailure = 0;
    return channelCache;
  }

  // ---- avisos ----
  const recent = new Map();
  const isDuplicate = key => {
    const at = now();
    if (recent.size > 200) for (const [name, time] of recent) if (time <= at - dedupeMs) recent.delete(name);
    if (recent.size > 400) recent.clear();
    if ((recent.get(key) || 0) > at - dedupeMs) return true;
    recent.set(key, at);
    return false;
  };
  async function post(channelName, payload, { timeoutMs = notifyTimeoutMs } = {}) {
    const channels = await loadChannels();
    const id = (channels?.text.get(channelName) || channels?.text.get(FALLBACK_CHANNEL))?.id;
    if (!id) return false;
    const result = await request('POST', `/channels/${encodeURIComponent(id)}/messages`, { allowed_mentions: { parse: [] }, ...payload }, { timeoutMs });
    if (!result.ok && (result.status === 404 || result.status === 403)) channelCache = null; // canal apagado/renomeado: procura de novo
    return result.ok;
  }
  // kind = nome do canal ('novos-clientes', 'demonstracoes', ...). Tipo desconhecido vai para 'alertas'.
  async function notify(kind, message, { dedupe = true } = {}) {
    try {
      if (!configured() || !message) return false;
      const channel = CHANNELS.includes(kind) ? kind : FALLBACK_CHANNEL;
      const payload = buildPayload(message, now());
      if (dedupe && isDuplicate(channel + '|' + JSON.stringify({ ...payload.embeds[0], timestamp: 0 }))) return false;
      // Tempo total de 2,5 s (canais + envio): o aviso nunca atrasa a resposta original.
      let timer;
      const limit = new Promise(resolve => { timer = setTimeout(() => resolve(false), notifyTimeoutMs); });
      try { return await Promise.race([post(channel, payload), limit]); }
      finally { clearTimeout(timer); }
    } catch (error) { warn('notify', error); return false; }
  }

  // ---- canais: organizar (criar, mover e renomear; nunca apaga nada) ----
  const everyoneDenied = (overwrites, guildId) => overwrites.some(item => item?.id === guildId && item.type === 0 && (BigInt(item.deny || 0) & 2048n) !== 0n);
  function readOnlyOverwrites(current = []) {
    const c = cfg();
    const previous = current.find(item => item?.id === c.guildId && item.type === 0);
    const others = current.filter(item => item && !(item.id === c.guildId && item.type === 0) && !(c.appId && item.id === c.appId && item.type === 1));
    const list = [...others, { id: c.guildId, type: 0, allow: String(previous?.allow || '0'), deny: String(BigInt(previous?.deny || 0) | 2048n) }];
    // O robô precisa continuar podendo escrever onde @everyone não pode.
    if (c.appId) list.push({ id: c.appId, type: 1, allow: String(BOT_PERMISSIONS - 16), deny: '0' });
    return list;
  }

  async function ensureWelcomes(loaded) {
    let posted = 0;
    if (!loaded) return posted;
    for (const slug of SETUP_CHANNELS) {
      const channel = loaded.text.get(slug);
      if (!channel) continue;
      const history = await request('GET', `/channels/${encodeURIComponent(channel.id)}/messages?limit=20`);
      if (!history.ok || !Array.isArray(history.data)) continue; // sem "Ler histórico": melhor não repetir
      const welcome = WELCOME[slug];
      if (history.data.some(item => item?.author?.bot && Array.isArray(item.embeds) && item.embeds.some(e => e?.title === welcome.title))) continue;
      const sent = await request('POST', `/channels/${encodeURIComponent(channel.id)}/messages`, { allowed_mentions: { parse: [] }, ...buildPayload({ title: welcome.title, description: welcome.description, color: COLORS.brand }, now()) });
      if (!sent.ok) continue;
      posted++;
      if (typeof sent.data?.id === 'string') await request('PUT', `/channels/${encodeURIComponent(channel.id)}/pins/${encodeURIComponent(sent.data.id)}`); // 403 é ignorado
    }
    return posted;
  }

  // Histórico de atualizações: posta uma vez e depois só as novas (reconhece pelo rodapé "histórico · #n").
  // Custo: 1 leitura de mensagens (50) + as postagens necessárias. Nenhuma leitura no Blob.
  async function ensureHistory(loaded) {
    const channel = loaded?.text.get('historico');
    if (!channel) return 0;
    const base = `/channels/${encodeURIComponent(channel.id)}/messages`;
    const history = await request('GET', `${base}?limit=50`);
    if (!history.ok || !Array.isArray(history.data)) return 0; // sem "Ler histórico": melhor não repetir
    const footers = history.data.filter(item => item?.author?.bot).flatMap(item => (Array.isArray(item.embeds) ? item.embeds : []).map(embed => embed?.footer?.text || ''));
    const pending = pendingReleases(postedFromFooters(footers));
    if (!pending.length) return 0;
    const send = async embeds => (await request('POST', base, { allowed_mentions: { parse: [] }, embeds: embeds.map(embed => buildEmbed({ ...embed, color: COLORS.brand }, now(), 5800)), components: [] })).ok;
    if (!footers.some(text => text.startsWith(HISTORY_MARK)) && !await send([{ ...HISTORY_HEADER, footer: `${HISTORY_MARK} · início` }])) return 0;
    let count = 0;
    for (const message of buildHistoryMessages(pending)) {
      if (!await send(message.embeds)) break;
      count += message.embeds.reduce((sum, embed) => sum + embed.numbers.length, 0);
    }
    return count;
  }

  // Painel de botões: uma mensagem que é editada no lugar (achada pelo rodapé "central · painel").
  async function upsertCentral(loaded) {
    try {
      if (!configured()) return { ok: false, error: 'not-configured' };
      loaded = loaded || await loadChannels({ force: !channelCache || channelCache.expires <= now() });
      const channel = loaded?.text.get('central');
      if (!channel) return { ok: false, error: 'no-channel' };
      const body = { allowed_mentions: { parse: [] }, ...centralPayload(now()) };
      const base = `/channels/${encodeURIComponent(channel.id)}/messages`;
      const history = await request('GET', `${base}?limit=20`);
      if (!history.ok || !Array.isArray(history.data)) return { ok: false, error: 'history' };
      const mine = history.data.find(item => item?.author?.bot && Array.isArray(item.embeds) && item.embeds.some(embed => String(embed?.footer?.text || '').includes(CENTRAL_MARK)));
      if (mine && typeof mine.id === 'string') {
        const edited = await request('PATCH', `${base}/${encodeURIComponent(mine.id)}`, body);
        return { ok: edited.ok, edited: true, ...(edited.ok ? {} : { error: 'failed' }) };
      }
      const sent = await request('POST', base, body);
      if (!sent.ok || typeof sent.data?.id !== 'string') return { ok: false, error: 'failed' };
      await request('PUT', `/channels/${encodeURIComponent(channel.id)}/pins/${encodeURIComponent(sent.data.id)}`); // 403 é ignorado
      return { ok: true, created: true };
    } catch (error) { warn('central', error); return { ok: false, error: 'failed' }; }
  }

  async function setupChannels() {
    if (!configured()) return { ok: false, error: 'not-configured', created: [], moved: [], existing: [] };
    const guild = encodeURIComponent(cfg().guildId);
    const loaded = await loadChannels({ force: true });
    if (!loaded) return { ok: false, error: 'channels-unavailable', status: lastLoadStatus, created: [], moved: [], existing: [] };
    const created = [], moved = [], existing = [], categoriesCreated = [], movedIds = new Set();
    let partial = false;
    const stop = (error, status) => { channelCache = null; return { ok: false, error, status, categoryCreated: categoriesCreated.length > 0, categoriesCreated, created, moved, existing }; };
    const parents = new Map();
    for (const [index, category] of LAYOUT.entries()) {
      let found = loaded.categories.get(category.slug);
      if (!found) {
        const made = await request('POST', `/guilds/${guild}/channels`, { name: category.name, type: 4, position: index });
        if (!made.ok || typeof made.data?.id !== 'string') return stop(made.status === 403 ? 'forbidden' : 'category-failed', made.status);
        found = { id: made.data.id }; categoriesCreated.push(category.name);
      }
      parents.set(category.slug, found.id);
    }
    for (const category of LAYOUT) {
      for (const [position, slug] of category.channels.entries()) {
        const def = DEFS[slug], parent = parents.get(category.slug), current = loaded.text.get(slug);
        if (!current) {
          const body = { name: def.name, type: 0, parent_id: parent, topic: def.topic, position };
          let made = await request('POST', `/guilds/${guild}/channels`, def.readOnly ? { ...body, permission_overwrites: readOnlyOverwrites() } : body);
          if (!made.ok && def.readOnly) made = await request('POST', `/guilds/${guild}/channels`, body); // sem permissão para travar: cria assim mesmo
          if (made.ok) created.push(slug);
          else if (made.status === 403) return stop('forbidden', 403);
          else partial = true;
          continue;
        }
        existing.push(slug);
        if (current.name !== def.name || current.parent_id !== parent) {
          const done = await request('PATCH', `/channels/${encodeURIComponent(current.id)}`, { name: def.name, parent_id: parent, topic: def.topic, position });
          if (done.ok) { moved.push(slug); movedIds.add(current.id); }
          else if (done.status === 403) return stop('forbidden', 403);
          else partial = true;
        }
        if (def.readOnly && !everyoneDenied(current.overwrites, cfg().guildId)) {
          await request('PATCH', `/channels/${encodeURIComponent(current.id)}`, { permission_overwrites: readOnlyOverwrites(current.overwrites) }); // falha é ignorada
        }
      }
    }
    const legacy = loaded.categories.get(categorySlug(LEGACY_CATEGORY));
    const legacyCategoryEmpty = Boolean(legacy) && !loaded.all.some(item => item.parent_id === legacy.id && !movedIds.has(item.id));
    channelCache = null;
    const fresh = await loadChannels({ force: true });
    const welcome = await ensureWelcomes(fresh).catch(() => 0);
    const historyPosted = await ensureHistory(fresh).catch(() => 0);
    const central = await upsertCentral(fresh);
    return { ok: !partial, categoryCreated: categoriesCreated.length > 0, categoriesCreated, created, moved, existing, legacyCategoryEmpty, welcomePosted: welcome, historyPosted, centralPosted: Boolean(central.ok), centralCreated: Boolean(central.created), ...(partial ? { error: 'partial' } : {}) };
  }

  // ---- dashboard: uma mensagem que é editada no lugar ----
  let dashboardMessageId = '';
  async function upsertDashboard(message) {
    try {
      if (!configured() || !message) return { ok: false, error: 'not-configured' };
      const loaded = await loadChannels({ force: !channelCache || channelCache.expires <= now() });
      const channel = loaded?.text.get('dashboard');
      if (!channel) return { ok: false, error: 'no-channel' };
      const body = { allowed_mentions: { parse: [] }, ...buildPayload(message, now()) };
      const base = `/channels/${encodeURIComponent(channel.id)}/messages`;
      if (dashboardMessageId) {
        const edited = await request('PATCH', `${base}/${encodeURIComponent(dashboardMessageId)}`, body);
        if (edited.ok) return { ok: true, edited: true };
        if (edited.status !== 404) return { ok: false, error: 'failed' };
        dashboardMessageId = '';
      }
      const history = await request('GET', `${base}?limit=20`);
      if (!history.ok || !Array.isArray(history.data)) return { ok: false, error: 'history' }; // falta "Ler histórico de mensagens"
      const mine = history.data.find(item => item?.author?.bot && Array.isArray(item.embeds) && item.embeds.some(e => String(e?.footer?.text || '').includes(DASH_MARK)));
      if (mine && typeof mine.id === 'string') {
        const edited = await request('PATCH', `${base}/${encodeURIComponent(mine.id)}`, body);
        if (edited.ok) dashboardMessageId = mine.id;
        return { ok: edited.ok, edited: true, ...(edited.ok ? {} : { error: 'failed' }) };
      }
      const sent = await request('POST', base, body);
      if (!sent.ok || typeof sent.data?.id !== 'string') return { ok: false, error: 'failed' };
      dashboardMessageId = sent.data.id;
      await request('PUT', `/channels/${encodeURIComponent(channel.id)}/pins/${encodeURIComponent(sent.data.id)}`); // 403 é ignorado
      return { ok: true, created: true };
    } catch (error) { warn('dashboard', error); return { ok: false, error: 'failed' }; }
  }

  // ---- comandos ----
  async function registerCommands() {
    const c = cfg();
    if (!interactionsConfigured()) return { ok: false, error: 'not-configured', count: 0 };
    const result = await request('PUT', `/applications/${encodeURIComponent(c.appId)}/guilds/${encodeURIComponent(c.guildId)}/commands`, COMMANDS);
    return { ok: result.ok, count: result.ok && Array.isArray(result.data) ? result.data.length : 0, ...(result.ok ? {} : { error: result.status === 401 || result.status === 403 ? 'forbidden' : 'failed' }) };
  }
  // Resposta tardia a uma interação já reconhecida (editar a mensagem "pensando…").
  async function followUp(interactionToken, content) {
    const c = cfg();
    if (!c.appId || typeof interactionToken !== 'string' || !/^[\w-]{20,500}$/.test(interactionToken)) return false;
    const payload = typeof content === 'string' ? { content: clip(content, 1900) } : content;
    const result = await request('PATCH', `/webhooks/${encodeURIComponent(c.appId)}/${interactionToken}/messages/@original`, { allowed_mentions: { parse: [] }, ...payload }, { auth: false });
    return result.ok;
  }
  const verify = (rawBody, signature, timestamp) => verifyInteraction(rawBody, signature, timestamp, cfg().publicKey, now());

  async function status() {
    const c = cfg();
    const out = { configured: configured(), interactionsConfigured: interactionsConfigured(), appId: c.appId, permissions: BOT_PERMISSIONS, channelsFound: [], channelsMissing: [...SETUP_CHANNELS], commandsRegistered: false, legacyCategoryEmpty: false };
    if (!out.configured) return out;
    const loaded = await loadChannels({ force: true });
    if (loaded) { const legacy = loaded.categories.get(categorySlug(LEGACY_CATEGORY)); out.legacyCategoryEmpty = Boolean(legacy) && !loaded.all.some(item => item.parent_id === legacy.id); out.channelsFound = SETUP_CHANNELS.filter(name => loaded.text.has(name)); out.channelsMissing = SETUP_CHANNELS.filter(name => !loaded.text.has(name)); }
    else out.error = 'channels-unavailable';
    if (out.interactionsConfigured) {
      const result = await request('GET', `/applications/${encodeURIComponent(c.appId)}/guilds/${encodeURIComponent(c.guildId)}/commands`);
      out.commandsRegistered = result.ok && Array.isArray(result.data) && COMMANDS.every(command => result.data.some(item => item?.name === command.name));
    }
    return out;
  }
  // Mensagem de teste (sem a trava de repetição). Vai para #alertas.
  const sendTest = () => notify('alertas', { title: '🔔 Mensagem de teste', description: `Tudo certo! O painel conseguiu falar com o Discord às ${formatBrt(now())}.`, color: COLORS.ok }, { dedupe: false });

  return {
    configured, interactionsConfigured, ownerId: () => cfg().ownerId, guildId: () => cfg().guildId,
    notify, setupChannels, upsertDashboard, upsertCentral, registerCommands, followUp, verify, status, sendTest, resetChannels: () => { channelCache = null; channelFailure = 0; }
  };
}

export const discord = createDiscord();
export const notify = (kind, message) => discord.notify(kind, message);
