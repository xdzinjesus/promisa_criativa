import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isPrivateAddress, parseSiteUrl, resolvePublic, fetchPage, inspectHtml, parsePageSpeed, runPageSpeed,
  buildItems, scoreItems, analyzeSite, AnalyzeError
} from '../lib/diagnostico-analyze.js';
import { createDiagnosticoStore, TOKEN, INDEX, reportPath, MAX_REPORTS, TTL_MS } from '../lib/diagnostico-store.js';
import { createDiagnosticoHandler } from '../lib/diagnostico-handler.js';
import { renderReport, normalizeDemoUrl, REPORT_CSP } from '../lib/diagnostico-page.js';
import { sameOrigin } from '../api/access.js';

const publicLookup = async () => [{ address: '93.184.216.34', family: 4 }];
const NOW = Date.UTC(2026, 5, 1);

// ---------- SSRF ----------
test('endereços internos são reconhecidos (v4, v6 e mapeados)', () => {
  for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.0.10', '169.254.169.254', '100.64.0.1', '0.0.0.0', '224.0.0.1', '198.18.0.1',
    '::1', '::', 'fe80::1', 'fc00::1', 'fd12:3456::1', '::ffff:127.0.0.1', '::ffff:7f00:1', '::ffff:10.0.0.1', '::ffff:a9fe:a9fe', '64:ff9b::7f00:1', '2002:7f00:1::1', 'ff02::1', 'não-é-ip']) {
    assert.equal(isPrivateAddress(ip), true, ip);
  }
  for (const ip of ['93.184.216.34', '8.8.8.8', '172.32.0.1', '2606:2800:220:1:248:1893:25c8:1946', '::ffff:8.8.8.8', '2001:4860:4860::8888']) assert.equal(isPrivateAddress(ip), false, ip);
});

test('validação do endereço: protocolo, credenciais, portas e nomes internos', () => {
  assert.equal(parseSiteUrl('empresa.com.br').href, 'https://empresa.com.br/');
  assert.equal(parseSiteUrl('http://empresa.com.br:80/x#a').href, 'http://empresa.com.br/x');
  assert.equal(parseSiteUrl('https://empresa.com.br:443').port, '');
  for (const bad of ['', 'ftp://x.com', 'file:///etc/passwd', 'javascript:alert(1)', 'https://user:pw@x.com', 'https://x.com:8080', 'http://x.com:22',
    'localhost', 'http://localhost/', 'http://a.localhost', 'http://impressora.local', 'http://api.internal', 'http://intranet', 'http://127.0.0.1', 'http://2130706433', 'http://0x7f.1',
    'http://[::1]/', 'http://[::ffff:127.0.0.1]/', 'http://169.254.169.254/latest/meta-data', 'http://10.0.0.1', 'https://x.com\nHost: y', 'localhost:3000']) {
    assert.throws(() => parseSiteUrl(bad), AnalyzeError, bad);
  }
});

test('DNS: rejeita se QUALQUER endereço for interno', async () => {
  await assert.rejects(resolvePublic(new URL('https://x.com'), async () => [{ address: '93.184.216.34', family: 4 }, { address: '10.0.0.5', family: 4 }]), AnalyzeError);
  await assert.rejects(resolvePublic(new URL('https://x.com'), async () => [{ address: '::ffff:192.168.1.1', family: 6 }]), AnalyzeError);
  await assert.rejects(resolvePublic(new URL('https://x.com'), async () => { throw new Error('ENOTFOUND'); }), /Não encontramos/);
  assert.equal((await resolvePublic(new URL('https://x.com'), publicLookup)).length, 1);
});

test('redirecionamento para endereço interno é recusado em qualquer salto', async () => {
  const request = async url => url.hostname === 'a.com'
    ? { status: 302, headers: { location: 'http://169.254.169.254/latest' }, body: '', bytes: 0 }
    : { status: 200, headers: { 'content-type': 'text/html' }, body: '<html></html>', bytes: 13 };
  await assert.rejects(fetchPage('https://a.com', { lookup: publicLookup, request }), AnalyzeError);
  const viaDns = async host => host === 'evil.com' ? [{ address: '127.0.0.1', family: 4 }] : [{ address: '93.184.216.34', family: 4 }];
  const request2 = async () => ({ status: 301, headers: { location: 'https://evil.com/' }, body: '', bytes: 0 });
  await assert.rejects(fetchPage('https://a.com', { lookup: viaDns, request: request2 }), AnalyzeError);
  const request3 = async () => ({ status: 301, headers: { location: 'ftp://a.com/' }, body: '', bytes: 0 });
  await assert.rejects(fetchPage('https://a.com', { lookup: publicLookup, request: request3 }), AnalyzeError);
});

test('muitos redirecionamentos e erros HTTP são recusados; seguir redirecionamento público funciona', async () => {
  const loop = async () => ({ status: 302, headers: { location: '/mais' }, body: '', bytes: 0 });
  await assert.rejects(fetchPage('https://a.com', { lookup: publicLookup, request: loop }), /redireciona demais/);
  await assert.rejects(fetchPage('https://a.com', { lookup: publicLookup, request: async () => ({ status: 500, headers: {}, body: '', bytes: 0 }) }), /erro \(500\)/);
  await assert.rejects(fetchPage('https://a.com', { lookup: publicLookup, request: async () => ({ status: 200, headers: { 'content-type': 'image/png' }, body: '', bytes: 0 }) }), /não é uma página/);
  const hops = [];
  const request = async url => { hops.push(url.href); return hops.length === 1 ? { status: 301, headers: { location: 'https://www.a.com/home' }, body: '', bytes: 0 } : { status: 200, headers: { 'content-type': 'text/html' }, body: '<title>Oi</title>', bytes: 17, truncated: false }; };
  const page = await fetchPage('http://a.com', { lookup: publicLookup, request });
  assert.equal(page.finalUrl.href, 'https://www.a.com/home');
  assert.deepEqual(hops, ['http://a.com/', 'https://www.a.com/home']);
});

// ---------- HTML ----------
const GOOD = `<!doctype html><html><head><title>Padaria Doce Pão — pães e bolos em Chapecó</title>
<meta name="viewport" content="width=device-width, initial-scale=1"><meta name="description" content="Pães artesanais, bolos e salgados feitos todos os dias em Chapecó. Encomende pelo WhatsApp.">
<meta property="og:image" content="https://x.com/og.jpg"><link rel="icon" href="/f.ico"></head>
<body><h1>Padaria</h1><a href="https://wa.me/5549999999999">WhatsApp</a><a href="tel:+554933334444">Ligar</a>
<a href="https://www.instagram.com/padaria">Insta</a><iframe src="https://www.google.com/maps/embed?pb=1"></iframe><footer>&copy; 2026 Padaria</footer>
<!-- <a href="https://wa.me/1">comentado</a> --></body></html>`;
const BAD = '<html><head><title>x</title></head><body><p>Bem-vindo</p><footer>Copyright © 2015</footer></body></html>';

test('checagens de HTML em página completa e em página fraca', () => {
  const good = inspectHtml(GOOD, { now: NOW });
  assert.deepEqual({ ...good, title: undefined, description: undefined }, {
    title: undefined, description: undefined, hasViewport: true, responsiveViewport: true, hasH1: true, whatsapp: true, phone: true, map: true,
    instagram: true, ogImage: true, favicon: true, year: 2026
  });
  assert.match(good.title, /^Padaria Doce Pão/);
  const bad = inspectHtml(BAD, { now: NOW });
  assert.equal(bad.whatsapp, false); assert.equal(bad.map, false); assert.equal(bad.hasViewport, false); assert.equal(bad.hasH1, false); assert.equal(bad.year, 2015);
  assert.equal(inspectHtml('<!-- <a href="https://wa.me/1"> -->').whatsapp, false);
  assert.equal(inspectHtml('<script>var a="<a href=\'https://wa.me/1\'>"</script>').whatsapp, false);
});

test('resultado: itens, status e nota geral', () => {
  const page = { finalUrl: new URL('https://x.com/'), bytes: 20_000, truncated: false };
  const best = buildItems({ page, html: inspectHtml(GOOD, { now: NOW }), psi: { ok: true, performance: 95, seo: 100, lcpSeconds: 1.2 }, httpsRedirect: true, now: NOW });
  assert.ok(best.every(item => item.status === 'bom'), JSON.stringify(best.filter(i => i.status !== 'bom')));
  assert.equal(scoreItems(best), 10);
  const worst = buildItems({ page: { finalUrl: new URL('http://x.com/'), bytes: 3_000_000, truncated: true }, html: inspectHtml(BAD, { now: NOW }), psi: { ok: true, performance: 20, seo: 60, lcpSeconds: 7.3 }, httpsRedirect: null, now: NOW });
  const by = id => worst.find(item => item.id === id);
  assert.equal(by('velocidade').status, 'ruim'); assert.match(by('velocidade').text, /7,3 s/);
  assert.equal(by('seguranca').status, 'ruim'); assert.equal(by('celular').status, 'ruim'); assert.equal(by('whatsapp').status, 'ruim');
  assert.equal(by('atualizado').status, 'atencao'); assert.equal(by('peso').status, 'ruim');
  assert.ok(scoreItems(worst) < 3);
  const noSpeed = buildItems({ page, html: inspectHtml(GOOD, { now: NOW }), psi: { ok: false }, httpsRedirect: true, now: NOW });
  assert.equal(noSpeed.find(item => item.id === 'velocidade').status, 'desconhecido');
  assert.match(noSpeed.find(item => item.id === 'velocidade').text, /não pôde ser medida/);
  assert.equal(scoreItems(noSpeed), 10); // item desconhecido não pesa
});

// ---------- PageSpeed ----------
const psiBody = { lighthouseResult: { categories: { performance: { score: 0.43 }, accessibility: { score: 0.9 }, seo: { score: 0.8 }, 'best-practices': { score: 1 } }, audits: { 'largest-contentful-paint': { numericValue: 6840 } } } };

test('PageSpeed: leitura da resposta, chave, e falhas viram "não medido"', async () => {
  assert.deepEqual(parsePageSpeed(psiBody), { ok: true, performance: 43, accessibility: 90, seo: 80, bestPractices: 100, lcpSeconds: 6.8 });
  assert.equal(parsePageSpeed({}).ok, false);
  let called;
  const ok = await runPageSpeed('https://x.com/', { key: 'K', fetchFn: async (url, init) => { called = url; assert.ok(init.signal); return { ok: true, json: async () => psiBody }; } });
  assert.equal(ok.performance, 43);
  assert.match(called, /^https:\/\/www\.googleapis\.com\/pagespeedonline\/v5\/runPagespeed\?/);
  assert.match(called, /strategy=mobile/); assert.match(called, /locale=pt_BR/); assert.match(called, /key=K/); assert.equal((called.match(/category=/g) || []).length, 4);
  assert.equal((await runPageSpeed('https://x.com/', { key: '', fetchFn: async url => { assert.doesNotMatch(url, /key=/); return { ok: false, status: 429 }; } })).reason, 'limit');
  assert.equal((await runPageSpeed('https://x.com/', { fetchFn: async () => { throw new Error('rede'); } })).ok, false);
  assert.equal((await runPageSpeed('https://x.com/', { timeoutMs: 20, fetchFn: (url, init) => new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(new Error('abort')))) })).ok, false);
});

test('analyzeSite: junta tudo e salva mesmo se o PageSpeed falhar', async () => {
  const request = async url => url.protocol === 'http:'
    ? { status: 301, headers: { location: 'https://www.padaria.com.br/' }, body: '', bytes: 0 }
    : { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' }, body: GOOD, bytes: Buffer.byteLength(GOOD), truncated: false };
  const result = await analyzeSite('https://www.padaria.com.br/?utm=1', { lookup: publicLookup, request, fetchFn: async () => { throw new Error('offline'); }, now: NOW });
  assert.equal(result.host, 'padaria.com.br');
  assert.equal(result.siteUrl, 'https://www.padaria.com.br/');
  assert.equal(result.psi, null);
  assert.equal(result.items.find(item => item.id === 'velocidade').status, 'desconhecido');
  assert.equal(result.items.find(item => item.id === 'seguranca').status, 'bom');
  assert.ok(result.score > 8);
});

// ---------- Blob em memória ----------
function memoryBlob() {
  const objects = new Map(); let revision = 0;
  const conflict = () => Object.assign(new Error('Precondition failed'), { name: 'BlobPreconditionFailedError' });
  return {
    objects,
    async get(path) { const o = objects.get(path); return o ? { stream: new Blob([o.text]).stream(), blob: { etag: 'cdn' + o.etag, size: o.text.length } } : null; },
    async head(path) { const o = objects.get(path); if (!o) throw Object.assign(new Error('Not found'), { name: 'BlobNotFoundError' }); return { etag: o.etag }; },
    async put(path, text, options) {
      const current = objects.get(path);
      if (options.ifMatch ? current?.etag !== options.ifMatch : current && !options.allowOverwrite) throw conflict();
      objects.set(path, { text, etag: 'e' + (++revision) }); return {};
    },
    async del(paths) { for (const path of [paths].flat()) objects.delete(path); }
  };
}
const sample = (patch = {}) => ({
  siteUrl: 'https://x.com/', host: 'x.com', score: 7.5, items: [{ id: 'a', label: 'A', status: 'bom', text: 'ok' }, { id: 'b', label: 'B', status: 'ruim', text: 'ruim' }],
  psi: null, info: {}, leadId: 'L1', leadName: 'Cliente', demoUrl: '', ...patch
});
function makeStore(extra = {}) {
  let clock = NOW; const blob = memoryBlob();
  const store = createDiagnosticoStore({ ...blob, token: () => 'tok', now: () => clock, ...extra });
  return { store, blob, advance: ms => { clock += ms; } };
}

test('armazenamento: criar, ler, listar, apagar', async () => {
  const { store, blob } = makeStore();
  const report = await store.create(sample());
  assert.match(report.token, TOKEN);
  assert.ok(blob.objects.has(reportPath(report.token)) && blob.objects.has(INDEX));
  assert.equal((await store.find(report.token)).state, 'ok');
  assert.equal((await store.find('A'.repeat(22))).state, 'missing');
  assert.equal((await store.find('../etc')).state, 'missing');
  const list = await store.list();
  assert.equal(list.length, 1); assert.equal(list[0].counts.ruim, 1); assert.equal(list[0].leadId, 'L1');
  assert.ok(!('items' in list[0]));
  await store.remove(report.token);
  assert.equal((await store.list()).length, 0);
  assert.equal(blob.objects.has(reportPath(report.token)), false);
  assert.equal((await store.find(report.token)).state, 'missing');
  await assert.rejects(store.remove(report.token), /não encontrado/);
  await assert.rejects(store.remove('zz'), /inválido/);
});

test('armazenamento: expira em 90 dias e limpa expirados na criação', async () => {
  const { store, blob, advance } = makeStore({ cacheMs: 0, missMs: 0 });
  const old = await store.create(sample());
  advance(TTL_MS - 1000);
  assert.equal((await store.find(old.token)).state, 'ok');
  advance(2000);
  assert.equal((await store.find(old.token)).state, 'expired');
  assert.equal((await store.list()).length, 0);
  const fresh = await store.create(sample());
  assert.equal(blob.objects.has(reportPath(old.token)), false);
  assert.equal((await store.list())[0].token, fresh.token);
});

test('armazenamento: no máximo 200 relatórios', async () => {
  const { store, blob } = makeStore();
  const seed = Array.from({ length: MAX_REPORTS }, (_, i) => ({ token: String(i).padStart(22, 'a'), expiresAt: NOW + 1e9, createdAt: NOW, score: 5, counts: {} }));
  blob.objects.set(INDEX, { text: JSON.stringify({ version: 1, items: seed }), etag: 'e0' });
  await assert.rejects(store.create(sample()), error => error.status === 409 && /200/.test(error.message));
  assert.equal([...blob.objects.keys()].filter(key => key !== INDEX).length, 0); // nada sobra
});

test('armazenamento em memória só fora da Vercel; sem token na Vercel dá erro claro', async () => {
  const dev = createDiagnosticoStore({ token: () => '', memory: () => true });
  const report = await dev.create(sample());
  assert.equal((await dev.find(report.token)).state, 'ok');
  assert.equal((await dev.list()).length, 1);
  const prod = createDiagnosticoStore({ token: () => '', memory: () => false });
  await assert.rejects(prod.create(sample()), error => error.status === 503);
  assert.equal((await prod.find(report.token)).state, 'missing');
});

// ---------- API ----------
function call(handler, { method = 'GET', url = '/api/diagnostico', query, headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const res = { statusCode: 200, headers: {}, setHeader(k, v) { this.headers[k.toLowerCase()] = v; }, end(text) { resolve({ status: this.statusCode, headers: this.headers, text: text ?? '' }); } };
    handler({ method, url, query, headers: { host: 'www.promisa.online', 'x-forwarded-proto': 'https', origin: 'https://www.promisa.online', 'content-type': 'application/json', ...headers }, body }, res).catch(reject);
  });
}
function api({ logged = true, analyzeImpl, maxCreatesPerHour } = {}) {
  const { store } = makeStore();
  const analyze = analyzeImpl || (async () => sample({ items: [{ id: 'google', label: '🔎 Google', status: 'ruim', text: 'Título: "<script>alert(1)</script>"' }] }));
  const handler = createDiagnosticoHandler({ store, analyze, authorized: async () => logged, sameOrigin, now: () => NOW, maxCreatesPerHour });
  return { handler, store };
}
const create = (extra = {}) => ({ method: 'POST', body: { action: 'create', url: 'x.com', ...extra } });

test('API: POST exige sessão (401), mesma origem (403) e JSON (415)', async () => {
  assert.equal((await call(api({ logged: false }).handler, create())).status, 401);
  assert.equal((await call(api().handler, { ...create(), headers: { origin: 'https://evil.example' } })).status, 403);
  assert.equal((await call(api().handler, { ...create(), headers: { origin: undefined } })).status, 403);
  assert.equal((await call(api().handler, { ...create(), headers: { 'content-type': 'text/plain' } })).status, 415);
  assert.equal((await call(api().handler, { method: 'PUT' })).status, 405);
  assert.equal((await call(api().handler, { method: 'POST', body: { action: 'x' } })).status, 400);
});

test('API: demoUrl só aceita link /demo/ da Promisa', async () => {
  const TOKEN22 = 'abcdefghijklmnopqrstuv';
  for (const bad of ['https://evil.com/demo/' + TOKEN22, 'javascript:alert(1)', '/demo/curto', 'http://www.promisa.online/demo/' + TOKEN22, 'https://www.promisa.online/demo/' + TOKEN22 + '/../x', 'https://www.promisa.online.evil.com/demo/' + TOKEN22, 5]) {
    assert.equal((await call(api().handler, create({ demoUrl: bad }))).status, 400, String(bad));
  }
  assert.equal(normalizeDemoUrl('https://www.promisa.online/demo/' + TOKEN22), '/demo/' + TOKEN22 + '/');
  assert.equal(normalizeDemoUrl('/demo/' + TOKEN22 + '/'), '/demo/' + TOKEN22 + '/');
  assert.equal(normalizeDemoUrl(''), '');
  const ok = await call(api().handler, create({ demoUrl: '/demo/' + TOKEN22 }));
  assert.equal(ok.status, 200);
});

test('API: criar, listar, abrir pelo link público e apagar', async () => {
  const { handler } = api();
  const created = await call(handler, create({ leadId: 'L9', leadName: 'Padaria', demoUrl: '/demo/abcdefghijklmnopqrstuv' }));
  assert.equal(created.status, 200);
  const data = JSON.parse(created.text);
  assert.match(data.token, TOKEN); assert.equal(data.url, 'https://www.promisa.online/diagnostico/' + data.token);
  assert.equal(created.headers['cache-control'], 'private, no-store');
  const list = JSON.parse((await call(handler, { method: 'POST', body: { action: 'list', leadId: 'L9' } })).text);
  assert.equal(list.items.length, 1); assert.equal(list.items[0].leadName, 'Padaria');
  assert.equal(JSON.parse((await call(handler, { method: 'POST', body: { action: 'list', leadId: 'outro' } })).text).items.length, 0);
  const page = await call(handler, { url: `/diagnostico/${data.token}`, query: { token: data.token } });
  assert.equal(page.status, 200);
  assert.match(page.text, /Diagnóstico gratuito do site/);
  assert.match(page.text, /href="\/demo\/abcdefghijklmnopqrstuv\/"/);
  assert.match(page.text, /https:\/\/wa\.me\/5549933811600/);
  assert.equal((await call(handler, { method: 'POST', body: { action: 'delete', token: data.token } })).status, 200);
  assert.equal((await call(handler, { url: '/x', query: { token: data.token } })).status, 404);
  assert.equal((await call(handler, { method: 'POST', body: { action: 'delete', token: 'curto' } })).status, 400);
  assert.equal((await call(api({ logged: false }).handler, { method: 'POST', body: { action: 'delete', token: data.token } })).status, 401);
});

test('API: link público desconhecido é 404 amigável, com CSP e sem indexação', async () => {
  const { handler } = api();
  for (const token of ['A'.repeat(22), 'curto', '']) {
    const res = await call(handler, { query: { token } });
    assert.equal(res.status, 404);
    assert.match(res.text, /Link indisponível/); assert.match(res.text, /Falar com a Promisa/);
    assert.equal(res.headers['content-security-policy'], REPORT_CSP);
    assert.equal(res.headers['x-robots-tag'], 'noindex, nofollow, noarchive');
  }
});

test('API: o relatório escapa texto vindo do site analisado e traz os cabeçalhos de segurança', async () => {
  const { handler } = api();
  const { token } = JSON.parse((await call(handler, create())).text);
  const res = await call(handler, { query: { token } });
  assert.equal(res.status, 200);
  assert.doesNotMatch(res.text, /<script>alert/);
  assert.match(res.text, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.equal(res.headers['content-security-policy'], "default-src 'none'; style-src 'unsafe-inline'; img-src data: https:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'");
  assert.equal(res.headers['referrer-policy'], 'no-referrer');
  assert.equal(res.headers['x-robots-tag'], 'noindex, nofollow, noarchive');
  assert.equal(res.headers['cache-control'], 'public, max-age=60');
  assert.equal(res.headers['vercel-cdn-cache-control'], 'max-age=300');
  assert.doesNotMatch(res.text, /<script/i);
});

test('relatório: escapa título, host e demoUrl malicioso gravado', () => {
  const html = renderReport({ host: '"><img src=x onerror=alert(1)>', createdAt: NOW, score: 3, demoUrl: 'javascript:alert(1)', items: [{ id: 'a', label: '<b>x</b>', status: 'ruim', text: '<img src=x onerror=alert(1)>' }] });
  assert.doesNotMatch(html, /<img src=x/); assert.doesNotMatch(html, /javascript:/); assert.doesNotMatch(html, /<b>x/);
});

test('API: erros da análise viram mensagens claras e o limite por hora vale', async () => {
  const refused = api({ analyzeImpl: async () => { throw new AnalyzeError('Esse endereço é interno e não pode ser analisado.'); } });
  const res = await call(refused.handler, create({ url: 'http://127.0.0.1' }));
  assert.equal(res.status, 400); assert.match(JSON.parse(res.text).error, /interno/);
  const broken = api({ analyzeImpl: async () => { throw new TypeError('segredo interno'); } });
  const r2 = await call(broken.handler, create());
  assert.equal(r2.status, 502); assert.doesNotMatch(r2.text, /segredo/);
  const limited = api({ maxCreatesPerHour: 2 });
  assert.equal((await call(limited.handler, create())).status, 200);
  assert.equal((await call(limited.handler, create())).status, 200);
  assert.equal((await call(limited.handler, create())).status, 429);
  assert.equal((await call(api().handler, create({ url: '' }))).status, 400);
});

// ---------- requisição real (servidor local; httpRequest não valida, quem valida é fetchPage) ----------
test('httpRequest: usa o endereço conferido, lê gzip, corta em 2 MB e não segue redirecionamento', async () => {
  const http = await import('node:http'), zlib = await import('node:zlib');
  const seen = [];
  const server = http.createServer((req, res) => {
    seen.push(req.headers.host);
    if (req.url === '/gz') { res.writeHead(200, { 'content-type': 'text/html', 'content-encoding': 'gzip' }); return res.end(zlib.gzipSync('<title>Olá</title>')); }
    if (req.url === '/big') { res.writeHead(200, { 'content-type': 'text/html' }); return res.end('x'.repeat(3 * 1024 * 1024)); }
    res.writeHead(302, { location: 'http://10.0.0.1/' }); res.end();
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const { httpRequest } = await import('../lib/diagnostico-analyze.js');
  try {
    const url = path => new URL(`http://nome-falso.example:${server.address().port}${path}`);
    const addresses = [{ address: '127.0.0.1', family: 4 }];
    const gz = await httpRequest(url('/gz'), { addresses });
    assert.equal(gz.body, '<title>Olá</title>'); assert.equal(gz.truncated, false);
    assert.match(seen[0], /^nome-falso\.example/);
    const big = await httpRequest(url('/big'), { addresses });
    assert.equal(big.truncated, true); assert.equal(big.bytes, 2 * 1024 * 1024);
    const redirect = await httpRequest(url('/r'), { addresses });
    assert.equal(redirect.status, 302); assert.equal(redirect.body, '');
  } finally { server.close(); server.closeAllConnections?.(); }
});

test('segurança: códigos inventados não geram leituras do relatório no Blob', async () => {
  const { store, blob } = makeStore();
  const report = await store.create(sample());
  let gets = 0; const original = blob.get;
  const counted = createDiagnosticoStore({ ...blob, get: async (...a) => { gets++; return original(...a); }, token: () => 'tok', now: () => NOW });
  for (let i = 0; i < 50; i++) assert.equal((await counted.find(String(i).padStart(22, 'Z'))).state, 'missing');
  assert.equal(gets, 1); // só o índice, uma vez
  assert.equal((await counted.find(report.token)).state, 'ok');
});

test('segurança: endereços IPv6 especiais bloqueados', () => {
  for (const address of ['::ffff:0:127.0.0.1', '64:ff9b:1::a00:1', '192.88.99.1']) assert.equal(isPrivateAddress(address), true, address);
  assert.equal(isPrivateAddress('2606:4700::1111'), false);
});
