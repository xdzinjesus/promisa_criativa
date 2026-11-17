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
const TOTAL_BUDGET_MS = 55_000; // a função da Vercel tem 60 s no total (vercel.json)
// Arquivos que o wrangler nunca envia como arquivos do site (_headers/_redirects vão como campos; o resto é ignorado).
const IGNORED = path => path === '_worker.js' || path === '_routes.json' || path.startsWith('functions/') || /(^|\/)(\.DS_Store|node_modules)(\/|$)/.test(path);
const SPECIAL_FILES = new Set(['_headers', '_redirects']); // vão como campos do envio, não no manifesto
export const DEFAULT_HEADERS_FILE = '/*\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: strict-origin-when-cross-origin\n';

export class CloudflareError extends Error {
  constructor(status, message, { code = '', detail = '' } = {}) { super(message); this.status = status; this.code = code; this.detail = detail; }
}

// ---------- Hash dos arquivos (idêntico ao do wrangler) ----------
// Conferido no código do wrangler 4.158 (deploy-helpers/src/deploy/helpers/hash.ts):
// blake3(base64(conteúdo) + extensão sem o ponto) em hexadecimal, 32 primeiros caracteres.
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
    if (IGNORED(path)) continue; // código de servidor e arquivos de sistema não são publicados (igual ao wrangler)
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

export function createCloudflare({ token, accountId, fetch: fetchImpl = globalThis.fetch, timeoutMs = REQUEST_TIMEOUT_MS, retryDelayMs = 400, budgetMs = TOTAL_BUDGET_MS }) {
  if (!token || !/^[a-f0-9]{32}$/i.test(accountId || '')) throw new CloudflareError(503, 'A publicação ainda não foi configurada. Falta colocar a chave da Cloudflare na Vercel.', { code: 'cloudflare-not-configured' });
  const scrub = text => String(text || '').split(token).join('***').slice(0, 300);
  const acc = `/accounts/${accountId}`;
  // Prazo total: o cliente é criado a cada pedido, então nenhuma chamada passa do tempo da função.
  const deadline = Date.now() + budgetMs;

  // `retry`: pedidos que podem ser repetidos sem efeito colateral (GET e os envios de arquivos por hash, como no wrangler).
  async function call(method, path, { body, jwt, form, allow = [], retry = method === 'GET' } = {}) {
    const headers = { Authorization: `Bearer ${jwt || token}` };
    let payload;
    if (form) payload = form;
    else if (body !== undefined) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
    let response, data;
    for (let attempt = 0; attempt < 2; attempt++) {
      const remaining = deadline - Date.now();
      try {
        if (remaining < 1000) { const error = new Error('prazo'); error.name = 'TimeoutError'; throw error; }
        response = await fetchImpl(API_BASE + path, { method, headers, body: payload, signal: AbortSignal.timeout(Math.min(timeoutMs, remaining)), redirect: 'error' });
      } catch (error) {
        if (error?.name === 'TimeoutError' || error?.name === 'AbortError') throw new CloudflareError(504, 'A Cloudflare demorou demais para responder. Tente de novo.', { code: 'timeout', detail: `${method} ${path.replace(/[a-f0-9]{32}/g, '…')}` });
        throw new CloudflareError(502, 'Não foi possível falar com a Cloudflare agora. Tente de novo em instantes.', { code: 'network' });
      }
      if (response.status === 429 || response.status >= 500) { if (attempt === 0 && retry) { await sleep(retryDelayMs); continue; } }
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

  const notFound = error => error instanceof CloudflareError && (error.code === '8000007' || error.status === 404);
  // Igual ao wrangler: consulta o projeto; se não existe (8000007), cria com { name, production_branch }.
  async function ensureProject(name) {
    if (!validProjectName(name)) throw new CloudflareError(400, 'Nome de projeto inválido.', { code: 'project-name' });
    try { return await call('GET', `${acc}/pages/projects/${name}`); }
    catch (error) { if (!notFound(error)) throw error; }
    const created = await call('POST', `${acc}/pages/projects`, { body: { name, production_branch: 'main' }, allow: [8000002] });
    if (!allowed(created)) return created;
    return call('GET', `${acc}/pages/projects/${name}`); // criado ao mesmo tempo por outro pedido
  }

  async function upload(jwt, files) {
    // files: [{ hash, base64, type, size }]
    const hashes = files.map(file => file.hash);
    const missing = new Set(await call('POST', '/pages/assets/check-missing', { jwt, body: { hashes }, retry: true }) || []);
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
        await call('POST', '/pages/assets/upload', { jwt, retry: true, body: bucket.map(file => ({ key: file.hash, value: file.base64, metadata: { contentType: file.type }, base64: true })) });
      }
    };
    await Promise.all(Array.from({ length: Math.min(3, buckets.length) }, worker));
    // Como no wrangler, uma falha aqui só deixa o próximo envio mais lento: não impede a publicação.
    await call('POST', '/pages/assets/upsert-hashes', { jwt, body: { hashes }, retry: true }).catch(() => null);
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
        if (!known || !notFound(error)) throw error;
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
      // A zona vem antes: a Cloudflare só aceita o domínio raiz num projeto Pages quando a zona está na conta.
      let zones = await call('GET', `/zones?name=${encodeURIComponent(apex)}&account.id=${accountId}`);
      let zone = Array.isArray(zones) ? zones[0] : null, createdZone = false;
      if (!zone) { zone = await call('POST', '/zones', { body: { name: apex, account: { id: accountId }, type: 'full' } }); createdZone = true; }
      if (!/^[a-f0-9]{32}$/i.test(String(zone?.id || ''))) throw new CloudflareError(502, 'A Cloudflare não devolveu os dados do domínio. Tente de novo.', { code: 'zone-invalid' });
      let moved = [], bindError = null;
      try { moved = await this.ensureDomainsOnProject(projectName, [apex, www]); } catch (error) { if (!(error instanceof CloudflareError) || error.status !== 409) throw error; bindError = error; }
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
      const info = {
        apex, www, zone: { id: zone.id, status: String(zone.status || 'pending'), nameServers: Array.isArray(zone.name_servers) ? zone.name_servers.map(String) : [], created: createdZone },
        records: result, existingRecords: createdZone ? importedOthers : [], domains, moved
      };
      // O resto ficou pronto (zona e DNS): devolve junto com o erro, para o painel guardar o domínio e o "Verificar agora" tentar de novo.
      if (bindError && ['domain-elsewhere', 'domain-missing'].includes(bindError.code)) {
        try { info.bridge = await this.proxyDomain(projectName, zone.id, [apex, www]); return info; }
        catch (error) { bindError.message += ` (O plano B, a ponte, também falhou: ${error.message}${error.detail ? ' · ' + error.detail : ''})`; }
      }
      if (bindError) throw Object.assign(bindError, { info });
      return info;
    },

    // ---------- Ponte (plano B) ----------
    // Quando a Cloudflare se recusa a ligar o domínio ao site (cadastro preso fora desta conta), um Worker pequeno
    // no próprio domínio entrega o site do endereço <projeto>.pages.dev. As visitas não percebem diferença.
    bridgeScript: projectName => `promisa-ponte-${projectName}`.slice(0, 63),
    async bridgeRoutes(zoneId, projectName) {
      const list = await call('GET', `/zones/${zoneId}/workers/routes`);
      return (Array.isArray(list) ? list : []).filter(r => r.script === this.bridgeScript(projectName));
    },
    async proxyDomain(projectName, zoneId, names) {
      if (!/^[a-f0-9]{32}$/i.test(String(zoneId || ''))) throw new CloudflareError(400, 'Domínio sem zona na Cloudflare.', { code: 'zone-invalid' });
      const script = this.bridgeScript(projectName), host = `${projectName}.pages.dev`;
      const code = `const HOST=${JSON.stringify(host)};
export default{async fetch(request){
const original=new URL(request.url),target=new URL(request.url);target.hostname=HOST;target.protocol='https:';target.port='';
const response=await fetch(new Request(target,request),{redirect:'manual'});
const location=response.headers.get('location');
if(!location)return response;
const next=new URL(location,target);if(next.hostname!==HOST)return response;
next.hostname=original.hostname;const headers=new Headers(response.headers);headers.set('location',next.toString());
return new Response(response.body,{status:response.status,statusText:response.statusText,headers});}};`;
      const form = new FormData();
      form.append('metadata', new Blob([JSON.stringify({ main_module: 'ponte.js', compatibility_date: '2024-09-23' })], { type: 'application/json' }));
      form.append('ponte.js', new Blob([code], { type: 'application/javascript+module' }), 'ponte.js');
      await call('PUT', `${acc}/workers/scripts/${script}`, { form });
      const have = new Set((await this.bridgeRoutes(zoneId, projectName)).map(r => r.pattern));
      for (const name of names) {
        const pattern = `${name}/*`;
        if (!have.has(pattern)) await call('POST', `/zones/${zoneId}/workers/routes`, { body: { pattern, script }, allow: [10020] });
      }
      return { script, routes: names.map(name => `${name}/*`) };
    },
    async removeBridge(projectName, zoneId) {
      if (!/^[a-f0-9]{32}$/i.test(String(zoneId || ''))) return;
      for (const r of await this.bridgeRoutes(zoneId, projectName)) await call('DELETE', `/zones/${zoneId}/workers/routes/${r.id}`, { allow: [10007] });
      await call('DELETE', `${acc}/workers/scripts/${this.bridgeScript(projectName)}`, { allow: [10007] });
    },

    // Garante que o domínio ficou MESMO neste projeto. A Cloudflare responde "já existe/em uso" também quando ele está
    // preso em OUTRO projeto (ex.: uma publicação antiga do mesmo cliente): aí as visitas dão erro 522.
    // Projetos criados pelo painel (promisa-…) têm o domínio movido sozinho; de outros, só avisamos.
    async ensureDomainsOnProject(projectName, names) {
      const said = {}; // o que a Cloudflare respondeu para cada nome (para mostrar o motivo exato)
      const add = name => call('POST', `${acc}/pages/projects/${projectName}/domains`, { body: { name }, allow: [8000018, 8000002, 8000026] })
        .then(r => { if (r && typeof r === 'object' && '__allowed' in r) said[name] = 'código ' + r.__allowed; return r; })
        .catch(error => { if (/already|exists|in use/i.test(error.detail || '')) { said[name] = error.detail; return null; } throw error; });
      for (const name of names) await add(name);
      const mine = new Set((await this.projectDomains(projectName)).map(d => d.name.toLowerCase()));
      const moved = [];
      const missing = names.filter(name => !mine.has(name));
      if (!missing.length) return moved;
      const projects = [];
      // Lista paginada no tamanho padrão da Cloudflare (pedir páginas maiores é recusado).
      const seen = new Set();
      for (let page = 1; page <= 30; page++) {
        const list = await call('GET', `${acc}/pages/projects?page=${page}`);
        if (!Array.isArray(list) || !list.length) break;
        const fresh = list.filter(p => p?.name && !seen.has(p.name));
        if (!fresh.length) break;
        for (const p of fresh) { seen.add(p.name); projects.push(p); }
      }
      // A lista nem sempre traz os domínios de cada projeto: nesse caso, pergunta projeto por projeto.
      const domainsOf = async p => Array.isArray(p?.domains) && p.domains.length ? p.domains.map(d => String(d).toLowerCase()) : (await this.projectDomains(p.name).catch(() => [])).map(d => d.name.toLowerCase());
      const holderOf = async name => { for (const p of projects) if (p?.name && p.name !== projectName && (await domainsOf(p)).includes(name)) return p; return null; };
      // Domínio preso num Worker (Workers → Custom Domains) também impede ligar ao site.
      const workerOf = async name => { const list = await call('GET', `${acc}/workers/domains?hostname=${encodeURIComponent(name)}`).catch(() => null); return Array.isArray(list) ? list.find(d => String(d.hostname).toLowerCase() === name) : null; };
      for (const name of missing) {
        const holder = await holderOf(name);
        if (!holder) {
          // Código 8000018 = "já adicionado a ESTE projeto", mas não aparece na lista e nenhum outro projeto tem:
          // cadastro travado pela metade. Correção: remove do próprio projeto e adiciona de novo.
          if (said[name] === 'código 8000018') {
            await call('DELETE', `${acc}/pages/projects/${projectName}/domains/${encodeURIComponent(name)}`, { allow: [8000007, 8000021] });
            await call('POST', `${acc}/pages/projects/${projectName}/domains`, { body: { name }, allow: [8000018] });
            if ((await this.projectDomains(projectName)).some(d => d.name.toLowerCase() === name)) { moved.push({ name, from: projectName, reset: true }); continue; }
          }
          const worker = await workerOf(name);
          if (worker) throw new CloudflareError(409, `${name} está ligado ao Worker "${worker.service || 'sem nome'}" na sua Cloudflare. Em Workers & Pages → ${worker.service || 'o Worker'} → Settings → Domains & Routes, remova ${name} e toque em "Verificar agora".`, { code: 'domain-on-worker' });
          if (said[name] === 'código 8000018') throw new CloudflareError(409, `A Cloudflare diz que ${name} já está em uso, mas ele não está em nenhum site desta conta. Normalmente ele está ligado a um site em OUTRA conta da Cloudflare (uma conta antiga, ou de quem fez o site antes), ou há uma regra de "Access" (Zero Trust) nele. Para ver o motivo exato: dash.cloudflare.com → Workers & Pages → ${projectName} → Custom domains → "Set up a custom domain" → digite ${name}.`, { code: 'domain-elsewhere', detail: said[name] });
          throw new CloudflareError(409, `A Cloudflare não ligou ${name} a este site.${said[name] ? ' Resposta da Cloudflare: ' + said[name] + '.' : ''} Tente "Verificar agora" de novo em alguns minutos.`, { code: 'domain-missing', detail: said[name] || '' });
        }
        if (!/^promisa-/.test(holder.name)) throw new CloudflareError(409, `${name} está ligado a outro projeto na sua Cloudflare (${holder.name}), que não foi criado pelo painel. Em Workers & Pages → ${holder.name} → Custom domains, remova o domínio e tente de novo.`, { code: 'domain-other-project' });
        await call('DELETE', `${acc}/pages/projects/${holder.name}/domains/${encodeURIComponent(name)}`, { allow: [8000007] });
        await call('POST', `${acc}/pages/projects/${projectName}/domains`, { body: { name } });
        moved.push({ name, from: holder.name });
      }
      return moved;
    }
  };
}
