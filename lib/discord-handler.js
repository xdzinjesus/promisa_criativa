import { timingSafeEqual } from 'node:crypto';

// Rota /api/discord.
//  - POST do Discord (assinado, cabeçalho x-signature-ed25519): comandos de barra.
//  - POST do painel (sessão de administrador): status, setup, register, test.
//  - GET ?cron=summary (Vercel Cron, com CRON_SECRET): resumo diário.
// Dependências injetadas para testar sem rede.
const MAX_BODY_BYTES = 64 * 1024;
const EPHEMERAL = 64;
export const NOT_CONFIGURED = 'O Discord ainda não foi configurado. Faltam as variáveis DISCORD_* na Vercel.';

// Lê o fluxo por eventos ('data'/'end'). Na Vercel, o runtime (@vercel/node) já consumiu o fluxo antes do handler
// (req.readableEnded = true) e o "repõe" trocando req.read/req.on por uma cópia: `for await` NÃO enxerga essa
// cópia (volta vazio), mas os eventos sim. Assim a assinatura é conferida nos bytes originais.
function collect(req) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0, settled = false;
    const finish = value => { if (!settled) { settled = true; resolve(value); } };
    req.on('data', chunk => {
      if (settled) return;
      size += chunk.length;
      if (size > MAX_BODY_BYTES) return finish({ tooLarge: true });
      chunks.push(Buffer.from(chunk));
    });
    req.on('end', () => finish({ raw: Buffer.concat(chunks) }));
    req.on('error', error => { if (!settled) { settled = true; reject(error); } });
  });
}

// parsedFallback: só para o painel. Para a assinatura do Discord, um objeto já interpretado (req.body) NUNCA
// serve: JSON.stringify dele não reproduz os bytes assinados.
async function readRaw(req, { parsedFallback = false } = {}) {
  if (Buffer.isBuffer(req.rawBody)) return req.rawBody.length > MAX_BODY_BYTES ? { tooLarge: true } : { raw: req.rawBody };
  const restored = Object.hasOwn(req, 'read') && Object.hasOwn(req, 'on'); // cópia reposta pelo runtime da Vercel
  if (typeof req.on === 'function' && (!req.readableEnded || restored)) {
    const read = await collect(req);
    if (read.tooLarge || read.raw.length) return read;
  }
  const body = req.body;
  if (typeof body === 'string') return Buffer.byteLength(body) > MAX_BODY_BYTES ? { tooLarge: true } : { raw: Buffer.from(body, 'utf8') };
  if (Buffer.isBuffer(body)) return body.length > MAX_BODY_BYTES ? { tooLarge: true } : { raw: body };
  if (parsedFallback && body && typeof body === 'object') return { raw: Buffer.from(JSON.stringify(body), 'utf8') };
  return { raw: Buffer.alloc(0) };
}

const header = (req, name) => { const value = req.headers?.[name]; return Array.isArray(value) ? value[0] : value; };

export function createDiscordHandler({ discord, commands, events, authorized, sameOrigin, waitUntil = () => {}, env = process.env, log = console }) {
  // Proteção extra contra repetição (além da janela de 5 min da assinatura): a mesma interação só roda uma vez
  // nesta instância. O Discord nunca reenvia uma interação; um reenvio só viria de quem capturou o pedido.
  const seen = new Map();
  const replayed = id => {
    if (typeof id !== 'string' || !id) return false;
    const at = Date.now();
    if (seen.size > 500) for (const [key, time] of seen) if (time <= at - 10 * 60_000) seen.delete(key);
    if (seen.size > 2000) seen.clear();
    if (seen.has(id)) return true;
    seen.set(id, at);
    return false;
  };
  return async function handler(req, res) {
    const json = (status, body) => {
      res.statusCode = status;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Cache-Control', 'private, no-store');
      res.setHeader('Vercel-CDN-Cache-Control', 'no-store');
      res.setHeader('X-Robots-Tag', 'noindex, nofollow');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
      res.end(JSON.stringify(body));
    };
    const message = (content, extra = {}) => json(200, { type: 4, data: { content, flags: EPHEMERAL, allowed_mentions: { parse: [] }, ...extra } });
    try {
      // ---- resumo diário (cron) ----
      if (req.method === 'GET') {
        const url = new URL(req.url || '/', 'http://localhost');
        const cron = Array.isArray(req.query?.cron) ? req.query.cron[0] : req.query?.cron ?? url.searchParams.get('cron');
        if (cron !== 'summary') return json(404, {});
        const secret = env.CRON_SECRET;
        if (!secret || secret.length < 32) return json(503, { error: 'Rotina automática não configurada.' });
        const expected = Buffer.from('Bearer ' + secret), provided = Buffer.from(String(req.headers?.authorization || ''));
        if (expected.length !== provided.length || !timingSafeEqual(expected, provided)) return json(401, {});
        if (!discord.configured()) return json(200, { skipped: true });
        try {
          const sent = await discord.notify('resumo-do-dia', await events.summary(), { dedupe: false });
          return json(200, { ok: true, sent });
        } catch (error) {
          log.error?.('[discord] resumo', error?.name || 'erro');
          await events.cronFailed('resumo diário');
          return json(503, { error: 'Não foi possível montar o resumo.' });
        }
      }
      if (req.method !== 'POST') { res.setHeader('Allow', 'GET, POST'); return json(405, { error: 'Método não permitido.' }); }

      // ---- comandos do Discord ----
      if (header(req, 'x-signature-ed25519') !== undefined) {
        if (!discord.interactionsConfigured()) return json(503, {});
        const read = await readRaw(req);
        if (read.tooLarge) return json(413, {});
        if (!discord.verify(read.raw, String(header(req, 'x-signature-ed25519') || ''), String(header(req, 'x-signature-timestamp') || ''))) return json(401, { error: 'Assinatura inválida.' });
        let interaction;
        try { interaction = JSON.parse(read.raw.toString('utf8')); } catch { return json(400, {}); }
        if (!interaction || typeof interaction !== 'object') return json(400, {});
        if (interaction.type === 1) return json(200, { type: 1 });
        if (interaction.type !== 2) return message('🤔 Esse tipo de interação não é suportado.');
        if (replayed(interaction.id)) return message('🔁 Este comando já foi recebido.');
        if (String(interaction.guild_id || '') !== discord.guildId()) return message('🔒 Este comando só funciona no servidor da Promisa.');
        const userId = String(interaction.member?.user?.id ?? interaction.user?.id ?? '');
        if (!userId || userId !== discord.ownerId()) return message('🔒 Só o dono pode usar este comando.');
        const planned = commands.plan(interaction);
        if (planned.quick) return message(planned.quick.content, planned.quick.embeds ? { embeds: planned.quick.embeds } : {});
        const interactionToken = typeof interaction.token === 'string' ? interaction.token : '';
        // 1) "recebi" em até 3 s (mensagem "pensando…" só para o dono); 2) o trabalho segue em segundo plano
        // (waitUntil mantém a função viva até terminar, no limite de 60 s) e 3) edita a mensagem com o resultado.
        const job = (async () => {
          let payload;
          try { payload = await planned.work(); } catch { payload = { content: '❌ Não consegui concluir agora. Tente de novo em instantes.' }; }
          await discord.followUp(interactionToken, payload);
        })().catch(() => {});
        try { waitUntil(job); } catch { /* fora da Vercel o trabalho segue sozinho */ }
        return json(200, { type: 5, data: { flags: EPHEMERAL } });
      }

      // ---- ações do painel (sessão de administrador) ----
      if (!await authorized(req)) return json(401, { error: 'Sua sessão terminou. Entre novamente.' });
      if (!sameOrigin(req)) return json(403, { error: 'Origem não permitida.' });
      if (!String(req.headers?.['content-type'] || '').toLowerCase().startsWith('application/json')) return json(415, { error: 'Formato inválido.' });
      const read = await readRaw(req, { parsedFallback: true });
      if (read.tooLarge) return json(413, { error: 'Pedido grande demais.' });
      let body;
      try { body = JSON.parse(read.raw.toString('utf8') || '{}'); } catch { return json(400, { error: 'Dados inválidos.' }); }
      if (!body || typeof body !== 'object' || Array.isArray(body)) return json(400, { error: 'Dados inválidos.' });
      const action = body.action;
      if (!['status', 'setup', 'register', 'test'].includes(action)) return json(400, { error: 'Ação desconhecida.' });
      if (action === 'status') return json(200, await discord.status());
      if (!discord.configured()) return json(503, { error: NOT_CONFIGURED, code: 'discord-not-configured' });
      if (action === 'test') return json(200, { ok: await discord.sendTest() });
      if (action === 'register') return json(200, await discord.registerCommands());
      const channels = await discord.setupChannels();
      const commandsResult = await discord.registerCommands();
      return json(200, { ok: channels.ok, channels, commands: commandsResult });
    } catch (error) {
      log.error?.('[discord]', req.method, error?.name || error?.constructor?.name || 'erro');
      return json(502, { error: 'Não foi possível concluir agora. Tente novamente em instantes.' });
    }
  };
}
