import { createPublicKey, verify as cryptoVerify } from 'node:crypto';

// Integração com o Discord (avisos + comandos). Núcleo com dependências injetáveis (fetch, relógio, variáveis),
// para testar sem rede. Sem as variáveis DISCORD_* tudo vira "não faz nada" (silencioso).
// Segredos (token do bot, chave pública, token da interação) nunca vão para logs nem para mensagens.
export const API = 'https://discord.com/api/v10';
export const CATEGORY = 'PROMISA';
export const CHANNELS = ['novos-clientes', 'demonstracoes', 'diagnosticos', 'sites-no-ar', 'alertas', 'resumo-do-dia'];
export const FALLBACK_CHANNEL = 'alertas';
const TOPICS = {
  'novos-clientes': 'Briefings respondidos pelos clientes',
  demonstracoes: 'Quando alguém abre um link de demonstração',
  diagnosticos: 'Diagnósticos de site criados',
  'sites-no-ar': 'Sites publicados na internet',
  alertas: 'Avisos importantes: armazenamento, falhas e erros',
  'resumo-do-dia': 'Resumo diário das 8h'
};
export const COLORS = { brand: 0x7c3aed, ok: 0x22c55e, warn: 0xf59e0b, bad: 0xef4444 };
export const COMMANDS = [
  { name: 'diagnostico', description: 'Analisa o site de uma empresa e gera o link do diagnóstico', options: [{ type: 3, name: 'url', description: 'Endereço do site, ex.: www.empresa.com.br', required: true, max_length: 300 }] },
  { name: 'cliente', description: 'Mostra a situação de um cliente (etapa, site, demonstração, publicação)', options: [{ type: 3, name: 'nome', description: 'Nome do cliente (ou parte dele)', required: true, max_length: 100 }] },
  { name: 'demo', description: 'Cria um link de demonstração do site de um cliente', options: [
    { type: 3, name: 'nome', description: 'Nome do cliente (ou parte dele)', required: true, max_length: 100 },
    { type: 4, name: 'dias', description: 'Validade do link em dias (1 a 30, padrão 7)', required: false, min_value: 1, max_value: 30 }
  ] },
  { name: 'publicar', description: 'Publica ou atualiza o site de um cliente na internet', options: [{ type: 3, name: 'nome', description: 'Nome do cliente (ou parte dele)', required: true, max_length: 100 }] },
  { name: 'resumo', description: 'Mostra o resumo do dia agora' },
  { name: 'configurar', description: 'Cria os canais que faltam e atualiza os comandos' },
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

export function buildEmbed({ title, description, fields, url, color }, at) {
  const embed = { title: clip(title, 250), color: Number.isInteger(color) ? color : COLORS.brand, timestamp: new Date(at).toISOString(), footer: { text: 'Promisa' } };
  if (description) embed.description = clip(description, 3900);
  if (url && /^https:\/\//.test(url)) embed.url = clip(url, 500);
  if (Array.isArray(fields) && fields.length) {
    embed.fields = fields.filter(field => field && field.name && field.value).slice(0, 12).map(field => ({ name: clip(field.name, 250), value: clip(field.value, 1000), inline: Boolean(field.inline) }));
  }
  return embed;
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
  async function loadChannels({ force = false } = {}) {
    if (!force && channelCache && channelCache.expires > now()) return channelCache;
    if (!force && channelFailure > now()) return null;
    const result = await request('GET', `/guilds/${encodeURIComponent(cfg().guildId)}/channels`, undefined, { timeoutMs: force ? commandTimeoutMs : notifyTimeoutMs });
    if (!result.ok || !Array.isArray(result.data)) { channelFailure = now() + 30_000; return null; }
    const text = new Map(), categories = new Map();
    for (const channel of result.data) {
      if (!channel || typeof channel.name !== 'string' || typeof channel.id !== 'string') continue;
      if (channel.type === 0 && !text.has(channel.name)) text.set(channel.name, channel.id);
      if (channel.type === 4 && !categories.has(channel.name.toLowerCase())) categories.set(channel.name.toLowerCase(), channel.id);
    }
    channelCache = { text, categories, expires: now() + channelTtlMs };
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
    const id = channels?.text.get(channelName) || channels?.text.get(FALLBACK_CHANNEL);
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
      const embed = buildEmbed(message, now());
      if (dedupe && isDuplicate(channel + '|' + JSON.stringify({ ...embed, timestamp: 0 }))) return false;
      // Tempo total de 2,5 s (canais + envio): o aviso nunca atrasa a resposta original.
      let timer;
      const limit = new Promise(resolve => { timer = setTimeout(() => resolve(false), notifyTimeoutMs); });
      try { return await Promise.race([post(channel, { embeds: [embed] }), limit]); }
      finally { clearTimeout(timer); }
    } catch (error) { warn('notify', error); return false; }
  }

  // ---- canais: criar os que faltam ----
  async function setupChannels() {
    if (!configured()) return { ok: false, error: 'not-configured', created: [], existing: [] };
    const guild = encodeURIComponent(cfg().guildId);
    const loaded = await loadChannels({ force: true });
    if (!loaded) return { ok: false, error: 'channels-unavailable', created: [], existing: [] };
    let parent = loaded.categories.get(CATEGORY.toLowerCase());
    let categoryCreated = false;
    const missing = CHANNELS.filter(name => !loaded.text.has(name));
    const existing = CHANNELS.filter(name => loaded.text.has(name));
    if (!missing.length) return { ok: true, categoryCreated, created: [], existing };
    if (!parent) {
      const made = await request('POST', `/guilds/${guild}/channels`, { name: CATEGORY, type: 4 });
      if (!made.ok || typeof made.data?.id !== 'string') return { ok: false, error: made.status === 403 ? 'forbidden' : 'category-failed', created: [], existing };
      parent = made.data.id; categoryCreated = true;
    }
    const created = [];
    for (const name of missing) {
      const made = await request('POST', `/guilds/${guild}/channels`, { name, type: 0, parent_id: parent, topic: TOPICS[name] });
      if (made.ok) created.push(name);
      else if (made.status === 403) { channelCache = null; return { ok: false, error: 'forbidden', categoryCreated, created, existing }; }
    }
    channelCache = null;
    return { ok: created.length === missing.length, categoryCreated, created, existing, ...(created.length < missing.length ? { error: 'partial' } : {}) };
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
    const out = { configured: configured(), interactionsConfigured: interactionsConfigured(), channelsFound: [], channelsMissing: [...CHANNELS], commandsRegistered: false };
    if (!out.configured) return out;
    const loaded = await loadChannels({ force: true });
    if (loaded) { out.channelsFound = CHANNELS.filter(name => loaded.text.has(name)); out.channelsMissing = CHANNELS.filter(name => !loaded.text.has(name)); }
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
    notify, setupChannels, registerCommands, followUp, verify, status, sendTest, resetChannels: () => { channelCache = null; channelFailure = 0; }
  };
}

export const discord = createDiscord();
export const notify = (kind, message) => discord.notify(kind, message);
