import { extname } from 'node:path';
import { blake3 } from '@noble/hashes/blake3.js';
import { safeFilePath } from '../src/data-validation.js';
import { decodeFile } from './demo-site.js';

// Publicação de sites na Cloudflare Pages ("Direct Upload", o mesmo caminho do `wrangler pages deploy`)
// e ligação do domínio do cliente. A chave (token) só é lida aqui e NUNCA é devolvida nem registrada.
export const API_BASE = 'https://api.cloudflare.com/client/v4';
export const MAX_FILE_BYTES = 25 * 1024 * 1024;
export const MAX_TOTAL_BYTES = 100 * 1024 * 1024;
export const MAX_FILES = 1000;
const BUCKET_BYTES = 10 * 1024 * 1024;
const BUCKET_FILES = 500;
const REQUEST_TIMEOUT_MS = 30_000;
const SPECIAL_FILES = new Set(['_headers', '_redirects']); // vão como campos do envio, não no manifesto
export const DEFAULT_HEADERS_FILE = '/*\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: strict-origin-when-cross-origin\n';

export class CloudflareError extends Error {
  constructor(status, message, { code = '', detail = '' } = {}) { super(message); this.status = status; this.code = code; this.detail = detail; }
}

// ---------- Hash dos arquivos (idêntico ao do wrangler) ----------
// wrangler (packages/deploy-helpers hashFile): blake3(base64(conteúdo) + extensão sem o ponto) em hexadecimal, 32 primeiros caracteres.
export function fileHash(bytes, path) {
  const base64 = Buffer.from(bytes).toString('base64');
  const extension = extname(path).slice(1);
  return hashBase64(base64, extension);
}
export function hashBase64(base64, extension) {
  return Buffer.from(blake3(new TextEncoder().encode(base64 + extension))).toString('hex').slice(0, 32);
}

// ---------- Nomes ----------
const strip = text => String(text || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
// Ex.: promisa-chico-moveis-ab12 (minúsculas, números e hífens; até 58 caracteres).
export function projectNameFor(name, siteId) {
  const suffix = (strip(siteId).replace(/-/g, '').slice(-4) || Math.random().toString(36).slice(2, 6)).padStart(4, '0');
  const base = strip(name).replace(/^promisa-/, '').slice(0, 58 - 'promisa-'.length - 1 - suffix.length).replace(/-+$/, '') || 'site';
  return `promisa-${base}-${suffix}`;
}
export const validProjectName = name => typeof name === 'string' && name.length <= 58 && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(name);

// ---------- Domínio do cliente ----------
export class DomainError extends Error {}
const BLOCKED = [/(^|\.)promisa\.online$/, /(^|\.)vercel\.(app|com|sh|dev)$/, /(^|\.)pages\.dev$/, /(^|\.)workers\.dev$/, /(^|\.)cloudflare\.com$/, /(^|\.)(localhost|local|internal|invalid|test|example|lan|home|corp)$/];
const LABEL = /^(?:xn--)?[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
// Aceita com ou sem "www." (e com https://, barra final...). Devolve { apex, www } em minúsculas, IDN em punycode.
export function validateDomain(input) {
  const fail = () => new DomainError('Esse endereço não parece um domínio válido. Use algo como chicomoveis.com.br');
  if (typeof input !== 'string') throw fail();
  let text = input.trim().toLowerCase();
  if (!text || text.length > 300) throw fail();
  text = text.replace(/^[a-z][a-z0-9+.-]*:\/\//, '').replace(/[/?#].*$/, '').replace(/\.$/, '');
  if (!text || /[\s@:\\%]/.test(text)) throw fail();
  let host;
  try { host = new URL('http://' + text).hostname; } catch { throw fail(); }
  if (host.endsWith('.')) host = host.slice(0, -1);
  if (!host || host.length > 253) throw fail();
  const labels = host.split('.');
  if (labels.length < 2 || !labels.every(label => LABEL.test(label))) throw fail();
  const tld = labels[labels.length - 1];
  if (/^\d+$/.test(tld) || !/^(?:xn--[a-z0-9-]+|[a-z]{2,63})$/.test(tld)) throw fail();
  if (BLOCKED.some(rule => rule.test(host))) throw new DomainError('Esse endereço não pode ser usado aqui. Informe o domínio próprio do cliente.');
  const apex = host.startsWith('www.') ? host.slice(4) : host;
  if (apex.split('.').length < 2) throw fail();
  return { apex, www: 'www.' + apex };
}

// ---------- Arquivos do site ----------
const TYPES = {
  html: 'text/html', htm: 'text/html', css: 'text/css', js: 'text/javascript', mjs: 'text/javascript', json: 'application/json', txt: 'text/plain', xml: 'application/xml',
  svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', avif: 'image/avif', ico: 'image/x-icon',
  woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf', otf: 'font/otf', mp4: 'video/mp4', webm: 'video/webm', mp3: 'audio/mpeg', pdf: 'application/pdf', webmanifest: 'application/manifest+json'
};
const SAFE_TYPE = /^[a-z0-9.+-]+\/[a-z0-9.+-]+$/i;
const typeFor = (path, declared) => TYPES[extname(path).slice(1).toLowerCase()] || (SAFE_TYPE.test(declared || '') ? declared.toLowerCase() : 'application/octet-stream');

// Prepara os arquivos para envio. A pasta da página principal vira a raiz do site (os links relativos continuam certos);
// se a página principal não se chama index.html, ela também é servida em "/" e "/index.html".
export function prepareFiles(site) {
  const fail = message => new CloudflareError(422, message, { code: 'site-invalid' });
  if (!site || !Array.isArray(site.files) || !site.files.length || !safeFilePath(site.htmlPath)) throw fail('Os arquivos deste site não estão completos. Sincronize o painel e tente de novo.');
  if (site.files.length > MAX_FILES + 10) throw fail(`O site tem arquivos demais (limite: ${MAX_FILES}).`);
  const slash = site.htmlPath.lastIndexOf('/');
  const root = slash === -1 ? '' : site.htmlPath.slice(0, slash + 1);
  const entries = new Map();
  let total = 0;
  for (const file of site.files) {
    if (!file || !safeFilePath(file.path)) throw fail('Um dos arquivos tem nome inseguro e não pode ser publicado.');
    if (!file.path.startsWith(root)) continue;
    const path = file.path.slice(root.length);
    if (!path || entries.has(path.toLowerCase())) continue;
    const bytes = decodeFile(file.data);
    if (bytes.length > MAX_FILE_BYTES) throw fail(`O arquivo "${path.slice(0, 80)}" passa de 25 MB, que é o limite da Cloudflare. Reduza o tamanho dele.`);
    total += bytes.length;
    if (total > MAX_TOTAL_BYTES) throw fail('O site passa de 100 MB. Reduza o tamanho dos arquivos (principalmente imagens e vídeos).');
    if (path === '_worker.js' || path.startsWith('functions/')) continue; // código de servidor não é publicado
    entries.set(path.toLowerCase(), { path, bytes, type: typeFor(path, file.type) });
  }
  const htmlName = site.htmlPath.slice(root.length);
  if (!entries.has(htmlName.toLowerCase())) throw fail('A página principal do site não foi encontrada.');
  const special = {};
  const assets = [];
  for (const entry of entries.values()) {
    if (SPECIAL_FILES.has(entry.path)) special[entry.path] = entry.bytes;
    else assets.push(entry);
  }
  if (!assets.length) throw fail('O site não tem arquivos para publicar.');
  if (assets.length > MAX_FILES) throw fail(`O site tem arquivos demais (limite: ${MAX_FILES}).`);
  if (!special._headers) special._headers = Buffer.from(DEFAULT_HEADERS_FILE);
  const main = assets.find(entry => entry.path.toLowerCase() === htmlName.toLowerCase());
  const hasIndex = assets.some(entry => entry.path.toLowerCase() === 'index.html');
  const manifestPaths = assets.map(entry => ({ ...entry, urlPath: '/' + entry.path }));
  if (!hasIndex) manifestPaths.push({ ...main, urlPath: '/index.html' });
  return { assets: manifestPaths, special, totalBytes: total };
}

// ---------- Mensagens amigáveis ----------
const FRIENDLY = [
  [[10000, 9109, 9106, 9107], 'A chave da Cloudflare não foi aceita ou não tem permissão. Peça para conferir a chave na Vercel.'],
  [[8000007], 'O projeto não foi encontrado na Cloudflare.'],
  [[8000002], 'Já existe um projeto com esse nome na Cloudflare.'],
  [[8000009, 8000010], 'A Cloudflare recusou os arquivos do site. Confira se não há arquivos grandes demais.'],
  [[1061, 1049, 1003, 1097], 'Esse domínio já está em uso na Cloudflare ou não pode ser adicionado. Confirme se o endereço está certo.'],
  [[1105, 1116], 'Esse domínio não pode ser adicionado agora. Confirme se é o domínio principal do cliente (ex.: chicomoveis.com.br).'],
  [[8000018, 8000027], 'Esse domínio não pôde ser ligado ao site. Confirme o endereço e tente de novo.'],
  [[8000028], 'O projeto tem publicações demais para ser apagado automaticamente.']
];
function friendly(status, code) {
  const hit = FRIENDLY.find(([codes]) => codes.includes(Number(code)));
  if (hit) return hit[1];
  if (status === 401 || status === 403) return 'A chave da Cloudflare não foi aceita ou não tem permissão. Peça para conferir a chave na Vercel.';
  if (status === 429) return 'A Cloudflare pediu para aguardar um pouco. Tente de novo em alguns minutos.';
  if (status >= 500) return 'A Cloudflare está com problemas agora. Tente de novo em alguns minutos.';
  return 'A Cloudflare não aceitou o pedido. Tente de novo em instantes.';
}

// ---------- Cliente da API ----------
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
export const configured = (env = process.env) => Boolean(env.CLOUDFLARE_API_TOKEN && env.CLOUDFLARE_ACCOUNT_ID && /^[a-f0-9]{32}$/i.test(env.CLOUDFLARE_ACCOUNT_ID));

export function createCloudflare({ token, accountId, fetch: fetchImpl = globalThis.fetch, timeoutMs = REQUEST_TIMEOUT_MS, retryDelayMs = 400 }) {
  if (!token || !/^[a-f0-9]{32}$/i.test(accountId || '')) throw new CloudflareError(503, 'A publicação ainda não foi configurada. Falta colocar a chave da Cloudflare na Vercel.', { code: 'cloudflare-not-configured' });
  const scrub = text => String(text || '').split(token).join('***').slice(0, 300);
  const acc = `/accounts/${accountId}`;

  async function call(method, path, { body, jwt, form, allow = [] } = {}) {
    const headers = { Authorization: `Bearer ${jwt || token}` };
    let payload;
    if (form) payload = form;
    else if (body !== undefined) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
    let response, data;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        response = await fetchImpl(API_BASE + path, { method, headers, body: payload, signal: AbortSignal.timeout(timeoutMs), redirect: 'error' });
      } catch (error) {
        if (error?.name === 'TimeoutError' || error?.name === 'AbortError') throw new CloudflareError(504, 'A Cloudflare demorou demais para responder. Tente de novo.', { code: 'timeout', detail: `${method} ${path.replace(/[a-f0-9]{32}/g, '…')}` });
        throw new CloudflareError(502, 'Não foi possível falar com a Cloudflare agora. Tente de novo em instantes.', { code: 'network' });
      }
      if (response.status === 429 || response.status >= 502 && response.status <= 504) { if (attempt === 0 && method === 'GET') { await sleep(retryDelayMs); continue; } }
      break;
    }
    data = await response.json().catch(() => null);
    if (response.ok && data?.success !== false) return data?.result ?? null;
    const first = data?.errors?.[0] || {};
    const code = first.code ?? '';
    if (allow.includes(Number(code))) return { __allowed: Number(code) };
    throw new CloudflareError(response.status === 401 || response.status === 403 ? 502 : response.status === 404 ? 404 : 502, friendly(response.status, code), {
      code: String(code || response.status), detail: scrub(`HTTP ${response.status}${code ? ' · ' + code : ''}${first.message ? ' · ' + first.message : ''}`)
    });
  }
  const allowed = value => value && typeof value === 'object' && '__allowed' in value;

  async function ensureProject(name) {
    if (!validProjectName(name)) throw new CloudflareError(400, 'Nome de projeto inválido.', { code: 'project-name' });
    const created = await call('POST', `${acc}/pages/projects`, { body: { name, production_branch: 'main' }, allow: [8000002] });
    if (!allowed(created)) return created;
    return call('GET', `${acc}/pages/projects/${name}`);
  }

  async function upload(jwt, files) {
    // files: [{ hash, base64, type, size }]
    const hashes = files.map(file => file.hash);
    const missing = new Set(await call('POST', '/pages/assets/check-missing', { jwt, body: { hashes } }) || []);
    const pending = files.filter(file => missing.has(file.hash));
    const buckets = []; let current = [], bytes = 0;
    for (const file of pending) {
      if (current.length && (bytes + file.base64.length > BUCKET_BYTES || current.length >= BUCKET_FILES)) { buckets.push(current); current = []; bytes = 0; }
      current.push(file); bytes += file.base64.length;
    }
    if (current.length) buckets.push(current);
    let next = 0;
    const worker = async () => {
      while (next < buckets.length) {
        const bucket = buckets[next++];
        await call('POST', '/pages/assets/upload', { jwt, body: bucket.map(file => ({ key: file.hash, value: file.base64, metadata: { contentType: file.type }, base64: true })) });
      }
    };
    await Promise.all(Array.from({ length: Math.min(3, buckets.length) }, worker));
    await call('POST', '/pages/assets/upsert-hashes', { jwt, body: { hashes } });
    return { uploaded: pending.length, total: files.length };
  }

  return {
    ensureProject,

    // Envia o site e cria a publicação de produção. Devolve { project, subdomain, url, deploymentId, uploaded, total }.
    // `known`: { url } de uma publicação anterior; o projeto já existe e não é criado de novo (se foi apagado lá, é recriado).
    async deploy(projectName, site, known = null) {
      const prepared = prepareFiles(site);
      let project = known ? { subdomain: known.url ? new URL(known.url).hostname : '' } : await ensureProject(projectName);
      let tokenInfo;
      try { tokenInfo = await call('GET', `${acc}/pages/projects/${projectName}/upload-token`); }
      catch (error) {
        if (!known || error.status !== 404) throw error;
        project = await ensureProject(projectName);
        tokenInfo = await call('GET', `${acc}/pages/projects/${projectName}/upload-token`);
      }
      const jwt = tokenInfo?.jwt;
      if (!jwt) throw new CloudflareError(502, 'A Cloudflare não liberou o envio dos arquivos. Tente de novo.', { code: 'no-upload-token' });
      const byHash = new Map(), manifest = {};
      for (const asset of prepared.assets) {
        const base64 = asset.bytes.toString('base64');
        const hash = hashBase64(base64, extname(asset.path).slice(1));
        manifest[asset.urlPath] = hash;
        if (!byHash.has(hash)) byHash.set(hash, { hash, base64, type: asset.type, size: asset.bytes.length });
      }
      const stats = await upload(jwt, [...byHash.values()]);
      const form = new FormData();
      form.append('manifest', JSON.stringify(manifest));
      form.append('branch', 'main');
      for (const [name, bytes] of Object.entries(prepared.special)) form.append(name, new File([bytes], name, { type: 'text/plain' }));
      const deployment = await call('POST', `${acc}/pages/projects/${projectName}/deployments`, { form });
      const subdomain = typeof project?.subdomain === 'string' && /^[a-z0-9.-]+\.pages\.dev$/.test(project.subdomain) ? project.subdomain : `${projectName}.pages.dev`;
      return { project: projectName, subdomain, url: `https://${subdomain}`, deploymentId: String(deployment?.id || ''), uploaded: stats.uploaded, total: stats.total };
    },

    async deleteProject(name) {
      if (!validProjectName(name)) throw new CloudflareError(400, 'Nome de projeto inválido.', { code: 'project-name' });
      await call('DELETE', `${acc}/pages/projects/${name}`, { allow: [8000007] });
      return { ok: true };
    },

    async projectDomains(name) {
      const list = await call('GET', `${acc}/pages/projects/${name}/domains`);
      return (Array.isArray(list) ? list : []).map(item => ({
        name: String(item.name || ''), status: String(item.status || ''),
        verification: String(item.verification_data?.status || ''), validation: String(item.validation_data?.status || ''),
        error: item.verification_data?.error_message || item.validation_data?.error_message ? 'Ainda verificando o certificado.' : ''
      }));
    },

    async zoneStatus(zoneId) {
      if (!/^[a-f0-9]{32}$/i.test(String(zoneId || ''))) return null;
      const zone = await call('GET', `/zones/${zoneId}`);
      return { id: zone.id, status: String(zone.status || ''), nameServers: Array.isArray(zone.name_servers) ? zone.name_servers.map(String) : [] };
    },

    // Liga o domínio (raiz e www) ao projeto, garante a zona e os registros CNAME.
    // Nunca apaga registros existentes: A/AAAA no mesmo nome são só avisados.
    async attachDomain(projectName, domain) {
      const { apex, www } = typeof domain === 'string' ? validateDomain(domain) : domain;
      for (const name of [apex, www]) await call('POST', `${acc}/pages/projects/${projectName}/domains`, { body: { name }, allow: [8000018, 8000002, 8000026] }).catch(error => {
        if (/already|exists|in use/i.test(error.detail || '')) return; // domínio já estava ligado
        throw error;
      });
      let zones = await call('GET', `/zones?name=${encodeURIComponent(apex)}&account.id=${accountId}`);
      let zone = Array.isArray(zones) ? zones[0] : null, createdZone = false;
      if (!zone) { zone = await call('POST', '/zones', { body: { name: apex, account: { id: accountId }, type: 'full' } }); createdZone = true; }
      const target = `${projectName}.pages.dev`;
      const existing = await call('GET', `/zones/${zone.id}/dns_records?per_page=100`);
      const records = Array.isArray(existing) ? existing : [];
      const result = { created: [], updated: [], unchanged: [], conflicts: [] };
      for (const name of [apex, www]) {
        const here = records.filter(record => String(record.name).toLowerCase() === name);
        const blockers = here.filter(record => record.type === 'A' || record.type === 'AAAA');
        const cname = here.find(record => record.type === 'CNAME');
        if (blockers.length) { for (const record of blockers) result.conflicts.push({ type: record.type, name, content: String(record.content || '') }); continue; }
        if (cname) {
          if (String(cname.content).toLowerCase() === target && cname.proxied === true) { result.unchanged.push(name); continue; }
          await call('PATCH', `/zones/${zone.id}/dns_records/${cname.id}`, { body: { type: 'CNAME', name, content: target, proxied: true, ttl: 1 } });
          result.updated.push(name); continue;
        }
        await call('POST', `/zones/${zone.id}/dns_records`, { body: { type: 'CNAME', name, content: target, proxied: true, ttl: 1 } });
        result.created.push(name);
      }
      const domains = await this.projectDomains(projectName).catch(() => []);
      const importedOthers = records.filter(record => !['CNAME', 'A', 'AAAA'].includes(record.type) || ![apex, www].includes(String(record.name).toLowerCase()))
        .slice(0, 30).map(record => ({ type: String(record.type), name: String(record.name), content: String(record.content || '').slice(0, 120) }));
      return {
        apex, www, zone: { id: zone.id, status: String(zone.status || 'pending'), nameServers: Array.isArray(zone.name_servers) ? zone.name_servers.map(String) : [], created: createdZone },
        records: result, existingRecords: createdZone ? importedOthers : [], domains
      };
    }
  };
}
