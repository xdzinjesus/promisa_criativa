import { TOKEN, briefingState, BriefingError } from './briefing-store.js';
import { validateAnswers } from '../src/briefing-questions.js';

// Rota pública do formulário de briefing. Dependências injetadas para testar sem rede.
// 6 textos de 3000 caracteres acentuados (2 bytes cada) + opções cabem com folga.
export const MAX_BODY_BYTES = 64 * 1024;
export const MIN_FILL_MS = 3000;
const RATE_LIMIT = 5, RATE_WINDOW_MS = 10 * 60 * 1000, MAX_IPS = 5000;

export function createRateLimiter({ limit = RATE_LIMIT, windowMs = RATE_WINDOW_MS, now = () => Date.now() } = {}) {
  const hits = new Map();
  return key => {
    const at = now();
    if (hits.size > MAX_IPS) for (const [ip, times] of hits) if (!times.some(time => time > at - windowMs)) hits.delete(ip);
    if (hits.size > MAX_IPS) hits.clear();
    const recent = (hits.get(key) || []).filter(time => time > at - windowMs);
    if (recent.length >= limit) { hits.set(key, recent); return false; }
    recent.push(at); hits.set(key, recent);
    return true;
  };
}

const clientIp = req => String(req.headers?.['x-real-ip'] || req.headers?.['x-vercel-forwarded-for'] || req.headers?.['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown').split(',')[0].trim();

async function readBody(req) {
  if (req.body !== undefined && req.body !== null && req.body !== '') {
    if (typeof req.body === 'string') {
      if (Buffer.byteLength(req.body) > MAX_BODY_BYTES) return { tooLarge: true };
      return { value: JSON.parse(req.body) };
    }
    if (Buffer.isBuffer(req.body)) {
      if (req.body.length > MAX_BODY_BYTES) return { tooLarge: true };
      return { value: JSON.parse(req.body.toString('utf8')) };
    }
    if (Buffer.byteLength(JSON.stringify(req.body)) > MAX_BODY_BYTES) return { tooLarge: true };
    return { value: req.body };
  }
  const chunks = []; let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) return { tooLarge: true };
    chunks.push(chunk);
  }
  return { value: JSON.parse(Buffer.concat(chunks).toString('utf8')) };
}

export function createBriefingHandler({ find, submit, sameOrigin, configured = () => true, now = () => Date.now(), allow = createRateLimiter({ now }) }) {
  return async function handler(req, res) {
    const send = (status, body) => { res.statusCode = status; res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.end(JSON.stringify(body)); };
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Vercel-CDN-Cache-Control', 'no-store');
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
    try {
      if (req.method === 'GET') {
        const token = req.query?.token ?? new URL(req.url || '/', 'http://localhost').searchParams.get('token');
        if (typeof token !== 'string' || !TOKEN.test(token) || !configured()) return send(200, { state: 'missing', serverTime: now() });
        const state = briefingState(await find(token), now());
        return send(200, { state: state === 'open' || state === 'answered' ? state : state === 'missing' ? 'missing' : 'expired', serverTime: now() });
      }
      if (req.method !== 'POST') { res.setHeader('Allow', 'GET, POST'); return send(405, { error: 'Método não permitido.' }); }
      if (!sameOrigin(req)) return send(403, { error: 'Origem não permitida.' });
      if (!String(req.headers?.['content-type'] || '').toLowerCase().startsWith('application/json')) return send(415, { error: 'Formato inválido.' });
      if (!allow(clientIp(req))) { res.setHeader('Retry-After', '600'); return send(429, { error: 'Muitas tentativas. Aguarde alguns minutos e tente de novo.' }); }
      const declared = Number(req.headers?.['content-length']);
      if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return send(413, { error: 'Respostas muito grandes.' });
      let body;
      try { const read = await readBody(req); if (read.tooLarge) return send(413, { error: 'Respostas muito grandes.' }); body = read.value; }
      catch { return send(400, { error: 'Dados inválidos.' }); }
      if (!body || typeof body !== 'object' || Array.isArray(body)) return send(400, { error: 'Dados inválidos.' });
      if (typeof body.token !== 'string' || !TOKEN.test(body.token)) return send(400, { error: 'Este link não está correto. Peça um novo link à Promisa.' });
      if (typeof body.website !== 'string' || body.website !== '') return send(400, { error: 'Não foi possível enviar. Tente novamente.' });
      const startedAt = body.startedAt, at = now();
      if (!Number.isFinite(startedAt) || startedAt > at + 5000 || at - startedAt < MIN_FILL_MS) return send(400, { error: 'Aguarde alguns segundos e envie de novo.' });
      const checked = validateAnswers(body.answers);
      if (!checked.ok) return send(400, { error: checked.error, field: checked.field });
      if (!configured()) return send(503, { error: 'O formulário está indisponível agora. Fale com a Promisa pelo WhatsApp.' });
      const state = briefingState(await find(body.token), at);
      if (state === 'answered') return send(409, { error: 'Este formulário já foi respondido.' });
      if (state !== 'open') return send(404, { error: 'Este link não está mais disponível. Fale com a Promisa pelo WhatsApp.' });
      await submit(body.token, checked.answers);
      return send(200, { ok: true });
    } catch (error) {
      if (error instanceof BriefingError) return send(error.status, { error: error.message });
      console.error('[briefing]', req.method, error?.constructor?.name || error?.name, error?.message);
      return send(502, { error: 'Não foi possível salvar agora. Tente novamente em instantes.' });
    }
  };
}
