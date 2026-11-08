import { safeFilePath } from '../src/data-validation.js';
import { shareState, TOKEN } from './share-store.js';

// Serve o site de UM cliente a partir de um link de demonstração.
// Isolamento: só os arquivos do site apontado pelo código são acessíveis, e a resposta
// usa CSP "sandbox" (origem opaca): scripts do site não leem cookies, não chamam a API
// do painel e não acessam nada além do próprio site.
// Sem allow-same-origin (origem opaca) e sem allow-popups-to-escape-sandbox: janelas abertas
// pelo site continuam isoladas.
export const DEMO_CSP = "sandbox allow-scripts allow-forms allow-popups allow-modals allow-downloads; frame-ancestors 'none'";
export class DemoTooLargeError extends Error {}
const MESSAGE_CSP = "default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
const TYPES = {
  html: 'text/html', htm: 'text/html', css: 'text/css', js: 'text/javascript', mjs: 'text/javascript', json: 'application/json', txt: 'text/plain', xml: 'application/xml',
  svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', avif: 'image/avif', ico: 'image/x-icon',
  woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf', otf: 'font/otf', mp4: 'video/mp4', webm: 'video/webm', mp3: 'audio/mpeg', pdf: 'application/pdf', webmanifest: 'application/manifest+json'
};
const SAFE_TYPE = /^[a-z0-9.+-]+\/[a-z0-9.+-]+$/i;

function contentType(path, declared) {
  const ext = /\.([a-z0-9]+)$/i.exec(path)?.[1]?.toLowerCase();
  let type = TYPES[ext] || (SAFE_TYPE.test(declared || '') ? declared.toLowerCase() : 'application/octet-stream');
  if (/^text\/|javascript|json|xml|svg/.test(type)) type += '; charset=utf-8';
  return type;
}

export function decodeFile(data) {
  if (typeof data !== 'string') return Buffer.alloc(0);
  if (data.startsWith('data:')) {
    const comma = data.indexOf(',');
    const meta = data.slice(5, comma), body = data.slice(comma + 1);
    return /;base64$/i.test(meta) ? Buffer.from(body, 'base64') : Buffer.from(decodeURIComponent(body), 'utf8');
  }
  return Buffer.from(data, 'utf8');
}

// Resolve o caminho pedido (já decodificado) dentro do site, sem nunca sair dele.
export function resolveFile(site, rawPath) {
  const files = new Map((site.files || []).map(file => [String(file.path).toLowerCase(), file]));
  const path = String(rawPath || '').replace(/^\/+/, '');
  if (!path) return files.get(String(site.htmlPath).toLowerCase()) || null;
  const candidates = path.endsWith('/') ? [path + 'index.html'] : [path, path + '/index.html', path + '.html'];
  for (const candidate of candidates) {
    if (!safeFilePath(candidate)) continue;
    const file = files.get(candidate.toLowerCase());
    if (file) return file;
  }
  return null;
}

function message(res, status, title, text, head) {
  const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${title}</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#09080e;color:#f3f1f8;font-family:system-ui,-apple-system,'Segoe UI',sans-serif;padding:24px}main{max-width:440px;text-align:center;border:1px solid #ffffff1f;border-radius:20px;padding:36px 28px;background:#131019}h1{font-size:1.4rem;margin:0 0 10px}p{color:#aaa3b9;line-height:1.6;margin:0 0 22px}a{display:inline-block;padding:12px 20px;border-radius:12px;background:#7c3aed;color:#fff;text-decoration:none;font-weight:600}</style></head><body><main><h1>${title}</h1><p>${text}</p><a href="https://wa.me/5549933811600" rel="noopener noreferrer">Falar com a Promisa</a></main></body></html>`;
  res.statusCode = status;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Content-Security-Policy', MESSAGE_CSP);
  res.setHeader('Cache-Control', 'no-store');
  res.end(head ? undefined : html);
}

// `variant` adapta a mesma entrega para outro uso (ex.: prévias dos projetos em destaque).
export function createDemoHandler({ findShare, readSite, now = () => Date.now(), variant = {} }) {
  const prefix = variant.prefix || '/demo';
  const csp = variant.csp || DEMO_CSP;
  const cacheControl = variant.cacheControl || 'public, max-age=10';
  const cdnCache = variant.cdnCache || 'max-age=60';
  return async function demoHandler(req, res) {
    res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    const head = req.method === 'HEAD';
    if (!['GET', 'HEAD'].includes(req.method)) { res.statusCode = 405; return res.end(); }
    const url = new URL(req.url || '/', 'http://localhost');
    const first = value => Array.isArray(value) ? value[0] : value;
    const token = String(first(req.query?.token) ?? url.searchParams.get('token') ?? '');
    const rawPath = String(first(req.query?.path) ?? url.searchParams.get('path') ?? '');
    const unavailable = () => message(res, 404, 'Link indisponível', 'Este link de demonstração não existe ou foi desativado.', head);
    if (!TOKEN.test(token)) return unavailable();
    try {
      const share = await findShare(token);
      const state = shareState(share, now());
      if (state === 'expired') return message(res, 410, 'Demonstração expirada', 'O prazo deste link de demonstração terminou. Peça um novo link para continuar vendo o site.', head);
      if (state !== 'active') return unavailable();
      const site = await readSite(share.siteKey);
      if (!site) return unavailable();
      // Página principal dentro de uma pasta: redireciona para que os caminhos relativos funcionem.
      if (!rawPath.replace(/^\/+/, '') && String(site.htmlPath).includes('/')) {
        res.statusCode = 302;
        res.setHeader('Location', `${prefix}/${token}/` + String(site.htmlPath).split('/').map(encodeURIComponent).join('/'));
        res.setHeader('Cache-Control', 'no-store');
        return res.end();
      }
      const file = resolveFile(site, rawPath);
      if (!file) return message(res, 404, 'Página não encontrada', 'Esta página não faz parte do site em demonstração.', head);
      let body = decodeFile(file.data);
      const type = contentType(file.path, file.type);
      // Na raiz sem "/" final, garante que caminhos relativos apontem para dentro do site.
      if (type.startsWith('text/html') && !String(rawPath).replace(/^\/+/, '')) {
        const html = body.toString('utf8');
        if (!/<base\s/i.test(html)) body = Buffer.from(html.replace(/<head(\s[^>]*)?>/i, match => `${match}<base href="${prefix}/${token}/">`), 'utf8');
      }
      res.statusCode = 200;
      res.setHeader('Content-Type', type);
      res.setHeader('Content-Security-Policy', csp);
      for (const [key, value] of Object.entries(variant.headers || {})) res.setHeader(key, value);
      // CDN guarda por 60 s (acessos repetidos não chegam ao armazenamento); navegador por 10 s.
      res.setHeader('Cache-Control', cacheControl);
      res.setHeader('Vercel-CDN-Cache-Control', cdnCache);
      res.setHeader('Content-Length', body.length);
      return res.end(head ? undefined : body);
    } catch (error) {
      if (error instanceof DemoTooLargeError) return message(res, 413, 'Site grande demais para demonstração', 'Este site é grande demais para ser exibido por link. Fale com a Promisa para receber outra forma de visualização.', head);
      console.error('[demo]', error?.constructor?.name || error?.name, error?.message);
      return message(res, 503, 'Demonstração indisponível no momento', 'Não foi possível carregar o site agora. Tente novamente em alguns minutos.', head);
    }
  };
}
