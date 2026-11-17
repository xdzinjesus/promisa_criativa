import { createHash, timingSafeEqual } from 'node:crypto';
import { pixelStore } from '../lib/pixel-store.js';

// Rota do Pixel: SÓ LEITURA. GET /api/pixel?action=agenda com "Authorization: Bearer <PIXEL_TOKEN>".
// Devolve o envelope criptografado da agenda de entregas (o servidor não sabe ler o conteúdo).
// Sem PIXEL_TOKEN configurado na Vercel (32+ caracteres), a rota fica desligada.
const send = (res, status, body, headers = {}) => {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex');
  for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
  res.end(body === null ? '' : JSON.stringify(body));
};
export function tokenOk(header, secret) {
  if (!secret || secret.length < 32) return false;
  const a = createHash('sha256').update('Bearer ' + secret).digest(), b = createHash('sha256').update(String(header || '')).digest();
  return timingSafeEqual(a, b);
}
export function createPixelHandler({ store = pixelStore, secret = () => process.env.PIXEL_TOKEN } = {}) {
  return async function handler(req, res) {
    if (req.method !== 'GET') return send(res, 405, { error: 'Só leitura.' }, { Allow: 'GET' });
    if (!secret() || secret().length < 32) return send(res, 503, { error: 'Acesso do Pixel não configurado (PIXEL_TOKEN).' });
    if (!tokenOk(req.headers?.authorization, secret())) return send(res, 401, { error: 'Token do Pixel inválido.' });
    const url = new URL(req.url || '/', 'http://localhost');
    if ((req.query?.action || url.searchParams.get('action')) !== 'agenda') return send(res, 404, { error: 'Ação desconhecida.' });
    try {
      const envelope = await store.read();
      if (!envelope) return send(res, 404, { error: 'A agenda ainda não foi gerada. Abra o painel do Promisa uma vez para criar.' });
      const etag = '"' + createHash('sha256').update(envelope.updatedAt + envelope.iv).digest('hex').slice(0, 32) + '"';
      if (req.headers?.['if-none-match'] === etag) return send(res, 304, null, { ETag: etag });
      return send(res, 200, envelope, { ETag: etag });
    } catch { return send(res, 503, { error: 'Não consegui ler a agenda agora. Tente de novo em alguns minutos.' }); }
  };
}
export default createPixelHandler();
