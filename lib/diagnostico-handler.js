import { AnalyzeError } from './diagnostico-analyze.js';
import { DiagnosticoError, TOKEN } from './diagnostico-store.js';
import { REPORT_CSP, renderReport, messagePage, normalizeDemoUrl } from './diagnostico-page.js';

// Rota do diagnóstico. POST (painel, com sessão): criar/listar/apagar.
// GET /diagnostico/<código> (público): página do relatório.
// Dependências injetadas para testar sem rede.
const MAX_BODY_BYTES = 8 * 1024;
const CREATES_PER_HOUR = 30;
const MISS_LIMIT = 60, MISS_WINDOW_MS = 10 * 60 * 1000;

const first = value => Array.isArray(value) ? value[0] : value;
const clientIp = req => String(req.headers?.['x-real-ip'] || req.headers?.['x-vercel-forwarded-for'] || req.headers?.['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown').split(',')[0].trim();
const cleanText = (value, max) => typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max) : '';

async function readBody(req) {
  let raw = req.body;
  if (raw === undefined || raw === null || raw === '') {
    const chunks = []; let size = 0;
    for await (const chunk of req) { size += chunk.length; if (size > MAX_BODY_BYTES) return { tooLarge: true }; chunks.push(chunk); }
    raw = Buffer.concat(chunks).toString('utf8');
  }
  if (Buffer.isBuffer(raw)) raw = raw.toString('utf8');
  if (typeof raw === 'string') { if (Buffer.byteLength(raw) > MAX_BODY_BYTES) return { tooLarge: true }; return { value: JSON.parse(raw) }; }
  if (Buffer.byteLength(JSON.stringify(raw)) > MAX_BODY_BYTES) return { tooLarge: true };
  return { value: raw };
}

export function createDiagnosticoHandler({ store, analyze, authorized, sameOrigin, now = () => Date.now(), maxCreatesPerHour = CREATES_PER_HOUR }) {
  const creates = [];
  const misses = new Map();
  const missCount = ip => (misses.get(ip) || []).filter(time => time > now() - MISS_WINDOW_MS).length;
  const addMiss = ip => {
    if (misses.size > 5000) misses.clear();
    misses.set(ip, [...(misses.get(ip) || []).filter(time => time > now() - MISS_WINDOW_MS), now()]);
  };

  return async function handler(req, res) {
    const html = (status, body, cache = 'no-store') => {
      res.statusCode = status;
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Content-Security-Policy', REPORT_CSP);
      res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive');
      res.setHeader('Referrer-Policy', 'no-referrer');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      if (cache === 'no-store') { res.setHeader('Cache-Control', 'no-store'); res.setHeader('Vercel-CDN-Cache-Control', 'no-store'); }
      else { res.setHeader('Cache-Control', 'public, max-age=60'); res.setHeader('Vercel-CDN-Cache-Control', 'max-age=300'); }
      res.end(req.method === 'HEAD' ? undefined : body);
    };
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
      if (req.method === 'GET' || req.method === 'HEAD') {
        const url = new URL(req.url || '/', 'http://localhost');
        const token = String(first(req.query?.token) ?? url.searchParams.get('token') ?? '');
        if (!TOKEN.test(token)) return html(404, messagePage('Link indisponível', 'Este diagnóstico não existe ou foi apagado.'), 'public');
        const ip = clientIp(req);
        if (missCount(ip) >= MISS_LIMIT) { res.setHeader('Retry-After', '600'); return html(429, messagePage('Muitas tentativas', 'Aguarde alguns minutos e tente de novo.')); }
        const found = await store.find(token);
        if (found.state === 'ok') return html(200, renderReport(found.report), 'public');
        if (found.state === 'expired') return html(410, messagePage('Diagnóstico expirado', 'O prazo deste diagnóstico terminou. Fale com a Promisa para receber uma análise atualizada.'), 'public');
        addMiss(ip);
        return html(404, messagePage('Link indisponível', 'Este diagnóstico não existe ou foi apagado.'), 'public');
      }

      if (req.method !== 'POST') { res.setHeader('Allow', 'GET, HEAD, POST'); return json(405, { error: 'Método não permitido.' }); }
      if (!await authorized(req)) return json(401, { error: 'Sua sessão terminou. Entre novamente.' });
      if (!sameOrigin(req)) return json(403, { error: 'Origem não permitida.' });
      if (!String(req.headers?.['content-type'] || '').toLowerCase().startsWith('application/json')) return json(415, { error: 'Formato inválido.' });
      let body;
      try { const read = await readBody(req); if (read.tooLarge) return json(413, { error: 'Pedido grande demais.' }); body = read.value; }
      catch { return json(400, { error: 'Dados inválidos.' }); }
      if (!body || typeof body !== 'object' || Array.isArray(body)) return json(400, { error: 'Dados inválidos.' });

      if (body.action === 'list') {
        const leadId = typeof body.leadId === 'string' || typeof body.leadId === 'number' ? String(body.leadId) : '';
        const items = await store.list();
        return json(200, { items: leadId ? items.filter(item => item.leadId === leadId) : items });
      }
      if (body.action === 'delete') {
        if (typeof body.token !== 'string' || !TOKEN.test(body.token)) return json(400, { error: 'Link inválido.' });
        return json(200, await store.remove(body.token));
      }
      if (body.action !== 'create') return json(400, { error: 'Ação desconhecida.' });

      const demoUrl = normalizeDemoUrl(body.demoUrl);
      if (demoUrl === null) return json(400, { error: 'O link da demonstração precisa ser um link /demo/ da Promisa.' });
      if (typeof body.url !== 'string' || !body.url.trim()) return json(400, { error: 'Informe o endereço do site, por exemplo: www.empresa.com.br' });
      const at = now();
      while (creates.length && creates[0] <= at - 3600_000) creates.shift();
      if (creates.length >= maxCreatesPerHour) { res.setHeader('Retry-After', '600'); return json(429, { error: 'Muitos diagnósticos nesta hora. Aguarde um pouco e tente de novo.' }); }
      creates.push(at);
      let result;
      try { result = await analyze(body.url); }
      catch (error) {
        if (error instanceof AnalyzeError) return json(error.status || 400, { error: error.message });
        console.error('[diagnostico] analyze', error?.constructor?.name || error?.name);
        return json(502, { error: 'Não foi possível analisar o site agora. Tente de novo em instantes.' });
      }
      const leadId = body.leadId === undefined || body.leadId === null ? '' : cleanText(String(body.leadId), 80);
      const report = await store.create({ ...result, leadId, leadName: cleanText(body.leadName, 120), demoUrl });
      const proto = process.env.VERCEL || req.headers?.['x-forwarded-proto'] === 'https' ? 'https' : 'http';
      return json(200, {
        token: report.token, url: `${proto}://${req.headers?.host}/diagnostico/${report.token}`,
        score: report.score, items: report.items.map(({ id, label, status }) => ({ id, label, status })), expiresAt: report.expiresAt
      });
    } catch (error) {
      if (error instanceof DiagnosticoError) return json(error.status, { error: error.message });
      console.error('[diagnostico]', req.method, error?.constructor?.name || error?.name);
      if (req.method === 'GET' || req.method === 'HEAD') return html(503, messagePage('Diagnóstico indisponível', 'Não foi possível carregar agora. Tente novamente em alguns minutos.'));
      return json(502, { error: 'Não foi possível concluir agora. Tente novamente em instantes.' });
    }
  };
}
