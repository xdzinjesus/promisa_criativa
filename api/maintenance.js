import { timingSafeEqual } from 'node:crypto';
import { maintainStorage } from '../lib/storage-maintenance.js';
import { events } from '../lib/discord-events.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('X-Robots-Tag', 'noindex');
  if (req.method !== 'GET') { res.statusCode = 405; return res.end('{}'); }
  const secret = process.env.CRON_SECRET;
  if (!secret || secret.length < 32) { res.statusCode = 503; return res.end(JSON.stringify({ error: 'Manutenção automática não configurada.' })); }
  const expected = Buffer.from('Bearer ' + secret), provided = Buffer.from(String(req.headers.authorization || ''));
  if (expected.length !== provided.length || !timingSafeEqual(expected, provided)) { res.statusCode = 401; return res.end('{}'); }
  try {
    const result = await maintainStorage({ apply: true });
    await events.maintenanceDone(result); // alerta no Discord se o armazenamento passar de 70% ou se removeu arquivos
    res.statusCode = 200; res.end(JSON.stringify(result));
  } catch {
    await events.cronFailed('manutenção do armazenamento');
    res.statusCode = 503; res.end(JSON.stringify({ error: 'Não foi possível concluir a manutenção. Tente novamente.' }));
  }
}
