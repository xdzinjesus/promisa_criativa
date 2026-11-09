import { dayKey, monthKey, validDay, validMonth, addDays } from '../src/instagram-math.js';
import { MANUAL_GAP_MS } from './instagram-sync.js';
import { InstagramStoreError, MAX_MONTHS } from './instagram-store.js';

// Rota /api/instagram: ações do painel (sessão de administrador). Sempre POST com JSON:
//  status        -> histórico (sem token) + se o Instagram está conectado
//  sync          -> atualiza agora (no máximo 1 a cada 10 min)
//  goals         -> metas { followers: { target, deadline } | null, clientsPerMonth: { target } | null }
//  clients-count -> { month, leads, clients }: só números agregados (nenhum dado de cliente)
// Dependências injetadas para testar sem rede.
const MAX_BODY_BYTES = 4 * 1024;
export const NOT_CONFIGURED = 'O Instagram ainda não foi conectado. Falta colocar INSTAGRAM_TOKEN na Vercel.';
const int = (value, min, max) => Number.isSafeInteger(value) && value >= min && value <= max;
const plain = value => value && typeof value === 'object' && !Array.isArray(value);
const onlyKeys = (value, keys) => Object.keys(value).every(key => keys.includes(key));

async function readBody(req) {
  let raw = req.body;
  if (raw === undefined || raw === null || raw === '') {
    const chunks = []; let size = 0;
    for await (const chunk of req) { size += chunk.length; if (size > MAX_BODY_BYTES) return { tooLarge: true }; chunks.push(chunk); }
    raw = Buffer.concat(chunks).toString('utf8');
  }
  if (Buffer.isBuffer(raw)) raw = raw.toString('utf8');
  if (typeof raw === 'string') { if (Buffer.byteLength(raw) > MAX_BODY_BYTES) return { tooLarge: true }; return { value: JSON.parse(raw || '{}') }; }
  if (Buffer.byteLength(JSON.stringify(raw)) > MAX_BODY_BYTES) return { tooLarge: true };
  return { value: raw };
}

// Devolve { value } com as metas limpas ou { error }.
export function cleanGoals(input, today) {
  if (!plain(input) || !onlyKeys(input, ['action', 'followers', 'clientsPerMonth'])) return { error: 'Metas inválidas.' };
  if (input.followers === undefined && input.clientsPerMonth === undefined) return { error: 'Informe pelo menos uma meta.' };
  const value = {};
  if (input.followers !== undefined) {
    if (input.followers === null) value.followers = null;
    else {
      const f = input.followers;
      if (!plain(f) || !onlyKeys(f, ['target', 'deadline'])) return { error: 'Meta de seguidores inválida.' };
      if (!int(f.target, 1, 100_000_000)) return { error: 'A meta de seguidores deve ser um número inteiro de 1 a 100.000.000.' };
      if (!validDay(f.deadline)) return { error: 'Data limite inválida.' };
      if (f.deadline < today) return { error: 'A data limite não pode ser no passado.' };
      if (f.deadline > addDays(today, 365 * 10)) return { error: 'A data limite está longe demais.' };
      value.followers = { target: f.target, deadline: f.deadline };
    }
  }
  if (input.clientsPerMonth !== undefined) {
    if (input.clientsPerMonth === null) value.clientsPerMonth = null;
    else {
      const c = input.clientsPerMonth;
      if (!plain(c) || !onlyKeys(c, ['target'])) return { error: 'Meta de clientes inválida.' };
      if (!int(c.target, 0, 1000)) return { error: 'A meta de clientes por mês deve ser um número inteiro de 0 a 1.000.' };
      value.clientsPerMonth = { target: c.target };
    }
  }
  return { value };
}

export function cleanCount(input, at) {
  if (!plain(input) || !onlyKeys(input, ['action', 'month', 'leads', 'clients'])) return { error: 'Contagem inválida.' };
  if (!validMonth(input.month)) return { error: 'Mês inválido.' };
  const current = monthKey(at), min = monthKey(at - 24 * 31 * 86_400_000);
  if (input.month > current || input.month < min) return { error: 'Mês fora do período aceito.' };
  if (!int(input.leads, 0, 100_000) || !int(input.clients, 0, 100_000) || input.clients > input.leads) return { error: 'Números inválidos.' };
  return { value: { month: input.month, leads: input.leads, clients: input.clients } };
}

export function createInstagramHandler({ service, authorized, sameOrigin, onChanged = () => {}, onSynced = async () => {}, now = () => Date.now(), log = console }) {
  let lastManual = 0;
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
    try {
      if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return json(405, { error: 'Método não permitido.' }); }
      if (!await authorized(req)) return json(401, { error: 'Sua sessão terminou. Entre novamente.' });
      if (!sameOrigin(req)) return json(403, { error: 'Origem não permitida.' });
      if (!String(req.headers?.['content-type'] || '').toLowerCase().startsWith('application/json')) return json(415, { error: 'Formato inválido.' });
      let read;
      try { read = await readBody(req); } catch { return json(400, { error: 'Dados inválidos.' }); }
      if (read.tooLarge) return json(413, { error: 'Pedido grande demais.' });
      const body = read.value;
      if (!plain(body)) return json(400, { error: 'Dados inválidos.' });
      const at = now(), today = dayKey(at);
      const configured = service.configured();

      if (body.action === 'status') {
        if (!onlyKeys(body, ['action'])) return json(400, { error: 'Dados inválidos.' });
        const history = await service.read();
        return json(200, { configured, today, history, nextSyncAt: Math.max(history.lastManualAt, lastManual) + MANUAL_GAP_MS });
      }
      if (body.action === 'goals') {
        const clean = cleanGoals(body, today);
        if (clean.error) return json(400, { error: clean.error });
        const history = await service.store.update(current => ({ ...current, goals: { ...current.goals, ...clean.value } }));
        onChanged();
        return json(200, { ok: true, goals: history.goals });
      }
      if (body.action === 'clients-count') {
        const clean = cleanCount(body, at);
        if (clean.error) return json(400, { error: clean.error });
        const { month, leads, clients } = clean.value;
        const history = await service.store.update(current => {
          const same = current.clientsByMonth[month];
          if (same && same.leads === leads && same.clients === clients) return current;
          const months = { ...current.clientsByMonth, [month]: { leads, clients, updatedAt: new Date(at).toISOString() } };
          return { ...current, clientsByMonth: Object.fromEntries(Object.keys(months).sort().slice(-MAX_MONTHS).map(key => [key, months[key]])) };
        });
        onChanged();
        return json(200, { ok: true, clientsByMonth: history.clientsByMonth });
      }
      if (body.action === 'sync') {
        if (!onlyKeys(body, ['action'])) return json(400, { error: 'Dados inválidos.' });
        if (!configured) return json(503, { error: NOT_CONFIGURED, code: 'not-configured' });
        let wait = lastManual + MANUAL_GAP_MS - at;
        if (wait <= 0) { const history = await service.read(); wait = history.lastManualAt + MANUAL_GAP_MS - at; }
        if (wait > 0) { res.setHeader('Retry-After', String(Math.ceil(wait / 1000))); return json(429, { error: `Aguarde ${Math.ceil(wait / 60_000)} min para atualizar de novo.`, code: 'too-soon', retryAfter: Math.ceil(wait / 1000) }); }
        lastManual = at;
        const result = await service.sync({ manual: true });
        try { await onSynced(result); } catch { /* o aviso nunca quebra a resposta */ }
        if (!result.ok) {
          const message = result.code === 'token-invalid' ? 'O acesso ao Instagram expirou: gere um token novo e coloque em INSTAGRAM_TOKEN na Vercel.'
            : result.code === 'rate-limited' ? 'O Instagram pediu para esperar um pouco. Tente de novo mais tarde.' : 'Não consegui atualizar agora. Tente de novo em instantes.';
          return json(502, { error: message, code: result.code, history: result.history || undefined });
        }
        onChanged();
        return json(200, { ok: true, configured, today, history: result.history, nextSyncAt: at + MANUAL_GAP_MS });
      }
      return json(400, { error: 'Ação desconhecida.' });
    } catch (error) {
      if (error instanceof InstagramStoreError) return json(error.status, { error: error.message });
      log.error?.('[instagram]', error?.name || error?.constructor?.name || 'erro');
      return json(502, { error: 'Não foi possível concluir agora. Tente novamente em instantes.' });
    }
  };
}
