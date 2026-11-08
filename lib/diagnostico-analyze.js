import dns from 'node:dns/promises';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import zlib from 'node:zlib';

// Diagnóstico grátis do site de um lead.
// Segurança (SSRF): só http/https nas portas 80/443, nunca endereços internos. O nome é resolvido
// aqui, TODOS os endereços precisam ser públicos, e a conexão usa exatamente os endereços
// conferidos (sem segunda consulta de DNS). Cada redirecionamento é conferido de novo.
export class AnalyzeError extends Error {
  constructor(message) { super(message); this.status = 400; }
}

export const MAX_HTML_BYTES = 2 * 1024 * 1024;
export const MAX_REDIRECTS = 5;
export const FETCH_TIMEOUT_MS = 10_000;
export const PAGESPEED_TIMEOUT_MS = 45_000;
const PAGESPEED_URL = 'https://www.googleapis.com/pagespeedonline/v5/runPagespeed';
const BLOCKED_SUFFIXES = ['.local', '.localhost', '.internal', '.localdomain', '.lan', '.home.arpa', '.intranet', '.corp', '.private'];

// ---------- endereços ----------
function privateV4(parts) {
  const [a, b, c] = parts;
  return a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 0 && (c === 0 || c === 2)) ||
    (a === 192 && b === 168) || (a === 192 && b === 88 && c === 99) || (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51 && c === 100) || (a === 203 && b === 0 && c === 113);
}

function parseV6(text) {
  let value = text.toLowerCase().split('%')[0];
  const tail = /(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(value);
  if (tail) {
    const n = tail.slice(1).map(Number);
    if (n.some(x => x > 255)) return null;
    value = value.slice(0, tail.index) + ((n[0] << 8) | n[1]).toString(16) + ':' + ((n[2] << 8) | n[3]).toString(16);
  }
  const halves = value.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const rest = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const missing = 8 - head.length - rest.length;
  if (halves.length === 1 ? missing !== 0 : missing < 1) return null;
  const groups = [...head, ...Array(halves.length === 2 ? missing : 0).fill('0'), ...rest].map(group => /^[0-9a-f]{1,4}$/.test(group) ? parseInt(group, 16) : NaN);
  return groups.length === 8 && groups.every(Number.isInteger) ? groups : null;
}
const v4From = (high, low) => [high >> 8, high & 255, low >> 8, low & 255];

// true = endereço interno/reservado (ou inválido): nunca deve ser acessado.
export function isPrivateAddress(address) {
  let text = String(address || '').trim().replace(/^\[|\]$/g, '');
  if (net.isIPv4(text)) return privateV4(text.split('.').map(Number));
  if (!net.isIPv6(text)) return true;
  const g = parseV6(text);
  if (!g) return true;
  if (g.every(x => x === 0)) return true; // ::
  const first5Zero = g.slice(0, 5).every(x => x === 0);
  if (first5Zero && g[5] === 0xffff) return privateV4(v4From(g[6], g[7])); // ::ffff:a.b.c.d
  if (g.slice(0, 4).every(x => x === 0) && g[4] === 0xffff && g[5] === 0) return true; // ::ffff:0:a.b.c.d (SIIT)
  if (g.slice(0, 6).every(x => x === 0)) return true; // ::1 e ::a.b.c.d
  if (g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every(x => x === 0)) return privateV4(v4From(g[6], g[7])); // NAT64
  if (g[0] === 0x64 && g[1] === 0xff9b && g[2] === 1) return true; // NAT64 de uso local (64:ff9b:1::/48)
  if (g[0] === 0x2002) return privateV4(v4From(g[1], g[2])); // 6to4
  if (g[0] === 0x2001 && g[1] === 0) return true; // Teredo
  return (g[0] & 0xfe00) === 0xfc00 || (g[0] & 0xffc0) === 0xfe80 || (g[0] & 0xffc0) === 0xfec0 ||
    (g[0] & 0xff00) === 0xff00 || (g[0] === 0x2001 && g[1] === 0xdb8) || (g[0] === 0x100 && g[1] === 0 && g[2] === 0 && g[3] === 0);
}

// ---------- endereço do site ----------
// Aceita "empresa.com.br" (acrescenta https://). Devolve um objeto URL já limpo.
export function parseSiteUrl(input) {
  let text = String(input ?? '').trim();
  if (!text || text.length > 2000 || /[\u0000-\u001f\s]/.test(text)) throw new AnalyzeError('Informe o endereço do site, por exemplo: www.empresa.com.br');
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) {
    if (/^[a-z][a-z0-9+.-]*:/i.test(text) && !/^[^/]*:\d+(\/|$)/.test(text)) throw new AnalyzeError('Use um endereço que comece com http:// ou https://.');
    text = 'https://' + text;
  }
  let url;
  try { url = new URL(text); } catch { throw new AnalyzeError('Esse endereço de site não parece correto.'); }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new AnalyzeError('Use um endereço que comece com http:// ou https://.');
  if (url.username || url.password) throw new AnalyzeError('O endereço não pode ter usuário ou senha.');
  if (url.port && url.port !== '80' && url.port !== '443') throw new AnalyzeError('Só é possível analisar sites nas portas comuns (80 e 443).');
  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  if (!host) throw new AnalyzeError('Esse endereço de site não parece correto.');
  const literal = host.replace(/^\[|\]$/g, '');
  if (net.isIP(literal)) {
    if (isPrivateAddress(literal)) throw new AnalyzeError('Esse endereço é interno e não pode ser analisado.');
  } else {
    if (host === 'localhost' || BLOCKED_SUFFIXES.some(suffix => host.endsWith(suffix)) || !host.includes('.')) throw new AnalyzeError('Esse endereço é interno e não pode ser analisado.');
  }
  url.hash = '';
  return url;
}

// Resolve o nome e exige que TODOS os endereços sejam públicos.
export async function resolvePublic(url, lookup = dns.lookup) {
  const host = url.hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (net.isIP(host)) {
    if (isPrivateAddress(host)) throw new AnalyzeError('Esse endereço é interno e não pode ser analisado.');
    return [{ address: host, family: net.isIPv6(host) ? 6 : 4 }];
  }
  let list;
  try { list = await lookup(host, { all: true, verbatim: true }); }
  catch { throw new AnalyzeError('Não encontramos esse site. Confira se o endereço está certo.'); }
  const addresses = (Array.isArray(list) ? list : [list]).filter(item => item?.address);
  if (!addresses.length) throw new AnalyzeError('Não encontramos esse site. Confira se o endereço está certo.');
  if (addresses.some(item => isPrivateAddress(item.address))) throw new AnalyzeError('Esse endereço é interno e não pode ser analisado.');
  return addresses.map(item => ({ address: item.address, family: item.family || (net.isIPv6(item.address) ? 6 : 4) }));
}

// ---------- requisição real (conecta só nos endereços conferidos) ----------
export function httpRequest(url, { addresses, timeoutMs = FETCH_TIMEOUT_MS, maxBytes = MAX_HTML_BYTES, userAgent = 'PromisaDiagnostico/1.0 (+https://www.promisa.online)' }) {
  return new Promise((resolve, reject) => {
    const client = url.protocol === 'https:' ? https : http;
    let settled = false;
    const done = (fn, value) => { if (settled) return; settled = true; clearTimeout(timer); fn(value); };
    const lookup = (hostname, options, callback) => {
      const cb = typeof options === 'function' ? options : callback;
      const pick = addresses[0];
      if (options && typeof options === 'object' && options.all) cb(null, [{ address: pick.address, family: pick.family }]);
      else cb(null, pick.address, pick.family);
    };
    const request = client.request(url, {
      method: 'GET', lookup, timeout: timeoutMs, rejectUnauthorized: true,
      headers: { 'user-agent': userAgent, accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5', 'accept-language': 'pt-BR,pt;q=0.9', 'accept-encoding': 'gzip, deflate, br' }
    }, response => {
      const status = response.statusCode || 0;
      const headers = response.headers;
      if (status >= 300 && status < 400 && headers.location) { response.resume(); return done(resolve, { status, headers, body: '', bytes: 0, truncated: false }); }
      const type = String(headers['content-type'] || '');
      if (type && !/html|xml|text\/plain/i.test(type)) { request.destroy(); return done(resolve, { status, headers, body: '', bytes: 0, truncated: false }); }
      const encoding = String(headers['content-encoding'] || '').toLowerCase();
      let stream = response;
      if (encoding === 'gzip' || encoding === 'x-gzip') stream = response.pipe(zlib.createGunzip());
      else if (encoding === 'deflate') stream = response.pipe(zlib.createInflate());
      else if (encoding === 'br') stream = response.pipe(zlib.createBrotliDecompress());
      const chunks = []; let size = 0, truncated = false;
      stream.on('data', chunk => {
        if (truncated) return;
        const room = maxBytes - size;
        if (chunk.length >= room) { chunks.push(chunk.subarray(0, room)); size += room; truncated = true; request.destroy(); done(resolve, finish()); return; }
        chunks.push(chunk); size += chunk.length;
      });
      const finish = () => ({ status, headers, body: Buffer.concat(chunks).toString('utf8'), bytes: size, truncated });
      stream.on('end', () => done(resolve, finish()));
      stream.on('error', () => done(truncated ? resolve : reject, truncated ? finish() : new AnalyzeError('Não foi possível ler o site agora.')));
      response.on('error', () => done(truncated ? resolve : reject, truncated ? finish() : new AnalyzeError('Não foi possível ler o site agora.')));
    });
    const timer = setTimeout(() => { request.destroy(); done(reject, new AnalyzeError('O site demorou demais para responder.')); }, timeoutMs + 1000);
    request.on('timeout', () => { request.destroy(); done(reject, new AnalyzeError('O site demorou demais para responder.')); });
    request.on('error', () => done(reject, new AnalyzeError('Não foi possível abrir o site. Confira o endereço ou tente mais tarde.')));
    request.end();
  });
}

// Busca a página seguindo redirecionamentos manualmente (cada salto é conferido).
export async function fetchPage(inputUrl, { lookup = dns.lookup, request = httpRequest, maxRedirects = MAX_REDIRECTS } = {}) {
  let url = parseSiteUrl(inputUrl);
  const chain = [];
  for (let hop = 0; hop <= maxRedirects; hop++) {
    const addresses = await resolvePublic(url, lookup);
    const response = await request(url, { addresses, timeoutMs: FETCH_TIMEOUT_MS, maxBytes: MAX_HTML_BYTES });
    chain.push(url.href);
    if (response.status >= 300 && response.status < 400 && response.headers?.location) {
      let next;
      try { next = new URL(String(response.headers.location), url); } catch { throw new AnalyzeError('O site tem um redirecionamento inválido.'); }
      url = parseSiteUrl(next.href); // revalida protocolo, porta e nome a cada salto
      continue;
    }
    if (response.status >= 400) throw new AnalyzeError(`O site respondeu com erro (${response.status}). Confira se o endereço abre no navegador.`);
    const type = String(response.headers?.['content-type'] || '');
    if (type && !/html|xml|text\/plain/i.test(type)) throw new AnalyzeError('Esse endereço não é uma página de site.');
    return { finalUrl: url, body: response.body, bytes: response.bytes, truncated: response.truncated, chain };
  }
  throw new AnalyzeError('O site redireciona demais (mais de 5 vezes).');
}

// ---------- leitura do HTML ----------
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', copy: '©' };
const decodeEntities = text => text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (all, name) => {
  if (name[0] === '#') { const code = name[1].toLowerCase() === 'x' ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10); return code > 0 && code < 0x110000 ? String.fromCodePoint(code) : ''; }
  return ENTITIES[name.toLowerCase()] ?? all;
});
const clean = (text, max) => decodeEntities(String(text || '')).replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

function parseTags(html, names) {
  const tags = [];
  const tagRe = new RegExp(`<(${names.join('|')})\\b([^>]*)>`, 'gi');
  let match;
  while ((match = tagRe.exec(html)) && tags.length < 20_000) {
    const attrs = {};
    const attrRe = /([^\s"'<>\/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
    let attr;
    while ((attr = attrRe.exec(match[2]))) attrs[attr[1].toLowerCase()] ??= attr[2] ?? attr[3] ?? attr[4] ?? '';
    tags.push({ name: match[1].toLowerCase(), attrs });
  }
  return tags;
}

export function inspectHtml(html, { now = Date.now() } = {}) {
  const source = String(html || '').replace(/<!--[\s\S]*?-->/g, ' ');
  const visible = source.replace(/<(script|style|noscript)\b[\s\S]*?<\/\1\s*>/gi, ' ');
  const tags = parseTags(visible, ['a', 'area', 'meta', 'link', 'iframe']);
  const meta = (key, value) => tags.find(tag => tag.name === 'meta' && String(tag.attrs[key] || '').toLowerCase() === value);
  const links = tags.filter(tag => tag.name === 'a' || tag.name === 'area').map(tag => String(tag.attrs.href || '').trim());
  const embeds = tags.filter(tag => tag.name === 'iframe').map(tag => String(tag.attrs.src || tag.attrs['data-src'] || '').trim());
  const urlHost = value => { try { return new URL(value, 'https://x.invalid/').hostname.toLowerCase(); } catch { return ''; } };
  const hostIs = (value, ...names) => { const host = urlHost(value); return names.some(name => host === name || host.endsWith('.' + name)); };
  const titleMatch = /<title\b[^>]*>([\s\S]*?)<\/title\s*>/i.exec(visible);
  const title = clean(titleMatch?.[1], 200);
  const description = clean(meta('name', 'description')?.attrs.content, 400);
  const viewport = String(meta('name', 'viewport')?.attrs.content || '').toLowerCase();
  const ogImage = String(meta('property', 'og:image')?.attrs.content || meta('name', 'og:image')?.attrs.content || '').trim();
  const text = decodeEntities(visible.replace(/<[^>]*>/g, ' '));
  const years = [...text.matchAll(/(?:©|copyright|\(c\))\s*(?:\d{4}\s*[-–—]\s*)?((?:19|20)\d{2})\b/gi)].map(item => Number(item[1])).filter(year => year <= new Date(now).getFullYear() + 1);
  return {
    title, description,
    hasViewport: Boolean(viewport), responsiveViewport: /width\s*=\s*device-width/.test(viewport),
    hasH1: /<h1\b/i.test(visible),
    whatsapp: links.some(href => /^(https?:)?\/\/(wa\.me|api\.whatsapp\.com|web\.whatsapp\.com|chat\.whatsapp\.com|wa\.link)\b/i.test(href) || /^whatsapp:/i.test(href)),
    phone: links.some(href => /^tel:/i.test(href)),
    map: [...links, ...embeds].some(href => (hostIs(href, 'google.com', 'google.com.br') && /\/maps/i.test(href)) || /^(https?:)?\/\/maps\.google\./i.test(href) || hostIs(href, 'maps.app.goo.gl') || (hostIs(href, 'goo.gl') && /\/maps/i.test(href)) || hostIs(href, 'openstreetmap.org')),
    instagram: links.some(href => hostIs(href, 'instagram.com')),
    ogImage: Boolean(ogImage),
    favicon: tags.some(tag => tag.name === 'link' && /(^|\s)(shortcut\s+)?icon(\s|$)|apple-touch-icon/i.test(String(tag.attrs.rel || ''))),
    year: years.length ? Math.max(...years) : null
  };
}

// ---------- PageSpeed ----------
export async function runPageSpeed(url, { fetchFn = globalThis.fetch, key = process.env.PAGESPEED_API_KEY, timeoutMs = PAGESPEED_TIMEOUT_MS } = {}) {
  const params = new URLSearchParams({ url, strategy: 'mobile', locale: 'pt_BR' });
  for (const category of ['performance', 'accessibility', 'seo', 'best-practices']) params.append('category', category);
  if (key) params.set('key', key);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchFn(`${PAGESPEED_URL}?${params}`, { signal: controller.signal, headers: { accept: 'application/json' } });
    if (!response.ok) return { ok: false, reason: response.status === 429 ? 'limit' : 'error' };
    return parsePageSpeed(await response.json());
  } catch { return { ok: false, reason: 'error' }; }
  finally { clearTimeout(timer); }
}

export function parsePageSpeed(data) {
  const result = data?.lighthouseResult;
  const score = key => { const value = result?.categories?.[key]?.score; return Number.isFinite(value) ? Math.round(value * 100) : null; };
  const performance = score('performance');
  if (performance === null) return { ok: false, reason: 'error' };
  const lcp = result?.audits?.['largest-contentful-paint']?.numericValue;
  return {
    ok: true, performance, accessibility: score('accessibility'), seo: score('seo'), bestPractices: score('best-practices'),
    lcpSeconds: Number.isFinite(lcp) && lcp > 0 ? Math.round(lcp / 100) / 10 : null
  };
}

// ---------- resultado em linguagem simples ----------
const WEIGHTS = { velocidade: 3, seguranca: 2, celular: 2, whatsapp: 2, google: 2, mapa: 1, compartilhar: 1, telefone: 1, instagram: 0.5, atualizado: 0.5, peso: 0.5, icone: 0.25 };
const VALUE = { bom: 1, atencao: 0.5, ruim: 0 };
const seconds = value => String(value).replace('.', ',');
const kb = bytes => bytes >= 1024 * 1024 ? `${seconds((bytes / 1048576).toFixed(1))} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;

export function buildItems({ page, html, psi, httpsRedirect, now = Date.now() }) {
  const items = [];
  const add = (id, label, status, text) => items.push({ id, label, status, text });
  if (psi?.ok) {
    const lcp = psi.lcpSeconds !== null ? ` A parte principal da página aparece em cerca de ${seconds(psi.lcpSeconds)} s no celular.` : '';
    if (psi.performance >= 90) add('velocidade', '⚡ Velocidade no celular', 'bom', `Rápido: nota ${psi.performance} de 100 no teste do Google.${lcp}`);
    else if (psi.performance >= 50) add('velocidade', '⚡ Velocidade no celular', 'atencao', `Pode melhorar: nota ${psi.performance} de 100 no teste do Google.${lcp} Visitantes com internet fraca podem desistir de esperar.`);
    else add('velocidade', '⚡ Velocidade no celular', 'ruim', `Lento: nota ${psi.performance} de 100 no teste do Google.${lcp} Muitos visitantes saem de sites que demoram.`);
  } else {
    add('velocidade', '⚡ Velocidade no celular', 'desconhecido', 'A velocidade não pôde ser medida agora. Os outros itens abaixo foram analisados normalmente.');
  }
  const secure = page.finalUrl.protocol === 'https:';
  add('seguranca', '🔒 Cadeado de segurança', secure ? (httpsRedirect === false ? 'atencao' : 'bom') : 'ruim',
    secure ? (httpsRedirect === false ? 'O site tem cadeado, mas quem digita o endereço sem "https" cai numa versão sem proteção.' : 'O site abre com cadeado (https). Isso passa confiança e ajuda no Google.')
      : 'O site abre sem cadeado. Os navegadores avisam "site não seguro", e isso afasta clientes.');
  add('celular', '📱 Funciona no celular', html.responsiveViewport ? 'bom' : html.hasViewport ? 'atencao' : 'ruim',
    html.responsiveViewport ? 'A página se ajusta à tela do celular.' : html.hasViewport ? 'A página tem uma configuração de celular, mas ela não ajusta a largura da tela.' : 'Não encontramos a configuração para celular. O site pode aparecer minúsculo ou cortado no telefone.');
  add('whatsapp', '💬 Botão do WhatsApp', html.whatsapp ? 'bom' : 'ruim',
    html.whatsapp ? 'Encontramos um link para chamar no WhatsApp.' : 'Não encontramos um botão ou link do WhatsApp na página. Quem quer comprar precisa procurar o contato.');
  if (html.phone) add('telefone', '📞 Toque para ligar', 'bom', 'O telefone pode ser tocado para ligar direto do celular.');
  else add('telefone', '📞 Toque para ligar', 'atencao', 'Não encontramos um telefone que ligue com um toque no celular.');
  const seoGood = [html.title.length >= 10 && html.title.length <= 70, html.description.length >= 50 && html.description.length <= 170, html.hasH1].filter(Boolean).length;
  const googleParts = [];
  googleParts.push(html.title ? `Título: "${html.title.slice(0, 120)}"${html.title.length > 70 ? ' (muito longo, o Google corta)' : html.title.length < 10 ? ' (muito curto)' : ''}.` : 'Sem título da página.');
  googleParts.push(html.description ? (html.description.length >= 50 && html.description.length <= 170 ? 'Tem descrição para aparecer na busca.' : 'Tem descrição, mas fora do tamanho ideal para a busca.') : 'Sem descrição para aparecer na busca.');
  googleParts.push(html.hasH1 ? 'Tem um título principal na página.' : 'Falta um título principal na página.');
  if (psi?.ok && psi.seo !== null) googleParts.push(`Nota do Google para buscas: ${psi.seo} de 100.`);
  add('google', '🔎 Pronto para o Google', seoGood === 3 ? 'bom' : seoGood === 2 ? 'atencao' : 'ruim', googleParts.join(' '));
  add('mapa', '📍 Mapa / endereço', html.map ? 'bom' : 'atencao',
    html.map ? 'Encontramos um mapa ou link de localização.' : 'Não encontramos um mapa. Clientes da região gostam de ver como chegar.');
  add('instagram', '📸 Instagram', html.instagram ? 'bom' : 'atencao',
    html.instagram ? 'O site leva para o Instagram da empresa.' : 'Não encontramos link para o Instagram.');
  add('compartilhar', '🖼️ Aparência ao compartilhar no WhatsApp', html.ogImage ? 'bom' : 'atencao',
    html.ogImage ? 'Ao enviar o link no WhatsApp, aparece uma imagem de apresentação.' : 'Ao enviar o link no WhatsApp, não aparece imagem de apresentação. O link fica sem graça.');
  add('icone', '⭐ Ícone na aba do navegador', html.favicon ? 'bom' : 'atencao',
    html.favicon ? 'O site tem ícone próprio.' : 'Não encontramos o ícone do site na aba do navegador.');
  const bytes = page.bytes;
  add('peso', '📦 Tamanho da página', bytes < 300 * 1024 ? 'bom' : bytes < 1024 * 1024 ? 'atencao' : 'ruim',
    page.truncated ? 'O código da página tem mais de 2 MB, o que é muito pesado.' : `O código da página tem ${kb(bytes)}.`);
  const currentYear = new Date(now).getFullYear();
  if (html.year) {
    add('atualizado', '🗓️ Parece atualizado', html.year >= currentYear - 2 ? 'bom' : 'atencao',
      html.year >= currentYear - 2 ? `O rodapé indica ${html.year}.` : `O rodapé ainda mostra ${html.year}: o site parece desatualizado.`);
  }
  return items;
}

export function scoreItems(items) {
  let total = 0, got = 0;
  for (const item of items) {
    if (!(item.status in VALUE)) continue;
    const weight = WEIGHTS[item.id] ?? 1;
    total += weight; got += weight * VALUE[item.status];
  }
  return total ? Math.round((got / total) * 100) / 10 : 0;
}

// Confere, em paralelo ao restante, se http:// leva para https:// (nunca falha o diagnóstico).
async function checkHttpsRedirect(finalUrl, { lookup, request }) {
  if (finalUrl.protocol !== 'https:') return null;
  try {
    const target = new URL(finalUrl.href); target.protocol = 'http:'; target.port = '';
    const url = parseSiteUrl(target.href);
    const response = await request(url, { addresses: await resolvePublic(url, lookup), timeoutMs: 6000, maxBytes: 1 });
    if (response.status >= 300 && response.status < 400) return /^https:\/\//i.test(String(response.headers?.location || ''));
    return response.status < 400 ? false : null;
  } catch { return null; }
}

export async function analyzeSite(input, { lookup = dns.lookup, request = httpRequest, fetchFn = globalThis.fetch, pagespeedKey = process.env.PAGESPEED_API_KEY, now = Date.now() } = {}) {
  const page = await fetchPage(input, { lookup, request });
  const [psi, httpsRedirect] = await Promise.all([
    runPageSpeed(page.finalUrl.href, { fetchFn, key: pagespeedKey }),
    checkHttpsRedirect(page.finalUrl, { lookup, request })
  ]);
  const html = inspectHtml(page.body, { now });
  const items = buildItems({ page, html, psi, httpsRedirect, now });
  const shown = new URL(page.finalUrl.origin + page.finalUrl.pathname);
  return {
    siteUrl: shown.href, host: page.finalUrl.hostname.replace(/^www\./, ''),
    score: scoreItems(items), items,
    psi: psi.ok ? { performance: psi.performance, accessibility: psi.accessibility, seo: psi.seo, bestPractices: psi.bestPractices, lcpSeconds: psi.lcpSeconds } : null,
    info: { title: html.title.slice(0, 200), description: html.description.slice(0, 400), htmlBytes: page.bytes, truncated: page.truncated, httpsRedirect, year: html.year }
  };
}
