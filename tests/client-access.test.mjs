import test from 'node:test';
import assert from 'node:assert/strict';
import { createClientAccessHandler, MAX_FAILS, MAX_SAVES_PER_DAY } from '../lib/client-access-handler.js';
import { createClientAccessStore, tokenHash } from '../lib/client-access-store.js';
import { cleanDraft, newDraft } from '../src/client-site-templates.js';

function world({ admin = true } = {}) {
  let clock = Date.parse('2026-11-12T12:00:00Z');
  const store = createClientAccessStore({ token: () => '', memory: () => true });
  const published = new Map(), deploys = [], notes = [];
  const publishStore = { get: async id => published.get(id) || null, set: async (id, patch) => { const next = { ...(published.get(id) || {}), ...patch }; published.set(id, next); return next; } };
  const cloudflare = () => ({ deploy: async (project, site) => { deploys.push({ project, site }); return { project, url: `https://${project}.pages.dev`, deploymentId: 'd' + deploys.length }; } });
  const handler = createClientAccessHandler({ store, publishStore, cloudflare, authorized: async req => admin && req.headers.cookie === 'admin', sameOrigin: () => true, secret: () => 's'.repeat(40), now: () => clock, notify: async info => notes.push(info), waitUntil: p => p });
  const call = async (body, { cookie = '' } = {}) => {
    const res = { headers: {}, statusCode: 0, setHeader(k, v) { this.headers[k] = v; }, end(text) { this.body = JSON.parse(text); } };
    await handler({ method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify(body) }, res);
    return { status: res.statusCode, body: res.body };
  };
  return { store, call, deploys, notes, published, tick: ms => { clock += ms; } };
}
const asAdmin = { cookie: 'admin' };
const tokenOf = link => link.split('/meu-site/')[1];

test('dono cria acesso; cliente entra com o código, salva e o site é publicado', async () => {
  const w = world();
  assert.equal((await w.call({ action: 'admin-create', siteId: 'site-1', siteName: 'GV' })).status, 401, 'sem sessão do dono, nada');
  const made = await w.call({ action: 'admin-create', siteId: 'site-1', siteName: 'GV Barber', draft: newDraft('barbearia') }, asAdmin);
  assert.equal(made.status, 200);
  assert.match(made.body.link, /^https:\/\/www\.promisa\.online\/meu-site\/[A-Za-z0-9_-]{32}$/);
  assert.match(made.body.code, /^\d{6}$/);
  const token = tokenOf(made.body.link);
  const raw = JSON.stringify(await w.store.getRecord(tokenHash(token)));
  assert.ok(!raw.includes(token) && !raw.includes(`"${made.body.code}"`), 'token e código nunca ficam guardados em texto');

  const login = await w.call({ action: 'login', token, code: made.body.code });
  assert.equal(login.status, 200); assert.equal(login.body.draft.niche, 'barbearia');
  const draft = { ...login.body.draft, name: 'GV Barber Club', niche: 'loja', items: [{ name: '<script>x</script>', price: '50' }], logo: 'javascript:alert(1)' };
  const saved = await w.call({ action: 'save', token, session: login.body.session, draft });
  assert.equal(saved.status, 200); assert.equal(saved.body.published, true);
  const html = w.deploys[0].site.files[0].data;
  assert.ok(html.includes('GV Barber Club') && !html.includes('<script>x') && !html.includes('javascript:'), 'publica o HTML limpo');
  assert.equal((await w.store.getRecord(tokenHash(token))).draft.niche, 'barbearia', 'cliente não troca o ramo');
  assert.equal(w.notes.length, 1, 'avisa no Discord');
  const list = await w.call({ action: 'admin-list' }, asAdmin);
  assert.equal(list.body.sites['site-1'].saves, 1); assert.ok(list.body.sites['site-1'].lastSaveAt > 0);
  assert.equal((await w.call({ action: 'admin-get', siteId: 'site-1' }, asAdmin)).body.draft.name, 'GV Barber Club', 'dono puxa as edições');
});

test('código errado: bloqueia após 5 tentativas; sessão vence; acesso cortado', async () => {
  const w = world();
  const made = await w.call({ action: 'admin-create', siteId: 'site-2', siteName: 'Kaetano', draft: newDraft('loja') }, asAdmin);
  const token = tokenOf(made.body.link), wrong = made.body.code === '000000' ? '111111' : '000000';
  for (let i = 1; i < MAX_FAILS; i++) assert.equal((await w.call({ action: 'login', token, code: wrong })).status, 401);
  assert.equal((await w.call({ action: 'login', token, code: wrong })).status, 401);
  assert.equal((await w.call({ action: 'login', token, code: made.body.code })).status, 429, 'bloqueado mesmo com o código certo');
  w.tick(16 * 60 * 1000);
  const login = await w.call({ action: 'login', token, code: made.body.code });
  assert.equal(login.status, 200, 'libera depois de 15 min');
  assert.equal((await w.call({ action: 'save', token, session: login.body.session.replace(/.$/, c => c === 'A' ? 'B' : 'A'), draft: login.body.draft })).status, 401, 'sessão adulterada');
  w.tick(3 * 60 * 60 * 1000);
  assert.equal((await w.call({ action: 'save', token, session: login.body.session, draft: login.body.draft })).body.code, 'session', 'sessão de 2 h vence');
  assert.equal((await w.call({ action: 'admin-revoke', siteId: 'site-2' }, asAdmin)).status, 200);
  assert.equal((await w.call({ action: 'login', token, code: made.body.code })).status, 404, 'cortado: link para de funcionar');
  const again = await w.call({ action: 'admin-create', siteId: 'site-2', siteName: 'Kaetano' }, asAdmin);
  assert.notEqual(tokenOf(again.body.link), token);
  assert.equal((await w.call({ action: 'login', token: tokenOf(again.body.link), code: again.body.code })).status, 200, 'novo link funciona');
  assert.equal((await w.call({ action: 'login', token: 'x'.repeat(32), code: '123456' })).status, 404);
  assert.equal((await w.call({ action: 'login', token: '../etc', code: '123456' })).status, 404);
});

test('limite de salvamentos por dia e rascunho limpo', async () => {
  const w = world();
  const made = await w.call({ action: 'admin-create', siteId: 'site-3', siteName: 'RG', draft: newDraft('oficina') }, asAdmin);
  const token = tokenOf(made.body.link);
  const { body: { session, draft } } = await w.call({ action: 'login', token, code: made.body.code });
  for (let i = 0; i < MAX_SAVES_PER_DAY; i++) assert.equal((await w.call({ action: 'save', token, session, draft })).status, 200);
  assert.equal((await w.call({ action: 'save', token, session, draft })).status, 429);
  const clean = cleanDraft({ niche: 'restaurante', name: 'x'.repeat(500), gallery: Array(20).fill('data:image/png;base64,AAAA'), items: Array(50).fill({ name: 'a' }), extra: 'ignorado', palette: 99 });
  assert.equal(clean.name.length, 60); assert.equal(clean.gallery.length, 8); assert.equal(clean.items.length, 15, 'plano Profissional: 15 itens'); assert.equal(clean.palette, 0); assert.ok(!('extra' in clean));
  const premium = cleanDraft({ plan: 'premium', items: Array(50).fill({ name: 'a' }), gallery: Array(20).fill('data:image/png;base64,AAAA') });
  assert.equal(premium.items.length, 30); assert.equal(premium.gallery.length, 12);
  const locked = cleanDraft({ plan: 'premium', niche: 'loja', items: Array(50).fill({ name: 'a' }) }, { niche: 'oficina', plan: 'essencial' });
  assert.equal(locked.plan, 'essencial'); assert.equal(locked.niche, 'oficina'); assert.equal(locked.items.length, 6, 'cliente não sobe de plano sozinho');
});

test('dono cria acesso do zero (ramo + plano), muda o plano e o cliente não volta atrás', async () => {
  const w = world();
  const made = await w.call({ action: 'admin-create', siteName: 'Clínica Sorriso', niche: 'odontologia', plan: 'essencial', whatsapp: '(49) 98888-7777' }, asAdmin);
  assert.equal(made.status, 200);
  const list = (await w.call({ action: 'admin-list' }, asAdmin)).body.sites;
  const [siteId, entry] = Object.entries(list)[0];
  assert.match(siteId, /^cli-[a-f0-9]{12}$/); assert.equal(entry.niche, 'odontologia'); assert.equal(entry.plan, 'essencial');
  const token = tokenOf(made.body.link);
  let login = await w.call({ action: 'login', token, code: made.body.code });
  assert.equal(login.body.draft.name, 'Clínica Sorriso'); assert.equal(login.body.draft.whatsapp, '(49) 98888-7777');
  assert.equal((await w.call({ action: 'admin-plan', siteId, plan: 'ouro' }, asAdmin)).status, 400);
  assert.equal((await w.call({ action: 'admin-plan', siteId, plan: 'premium' }, asAdmin)).status, 200);
  assert.equal((await w.call({ action: 'admin-list' }, asAdmin)).body.sites[siteId].plan, 'premium');
  login = await w.call({ action: 'login', token, code: made.body.code });
  const saved = await w.call({ action: 'save', token, session: login.body.session, draft: { ...login.body.draft, plan: 'essencial', customColor: '#FF0000', customBg: 'red; x', items: [{ name: 'Implante', photo: 'data:image/jpeg;base64,AAAA' }, { name: 'X', photo: 'https://evil/x.png' }] } });
  assert.equal(saved.status, 200);
  const rec = await w.store.getRecord(tokenHash(token));
  assert.equal(rec.draft.plan, 'premium', 'cliente não rebaixa nem sobe o plano');
  assert.equal(rec.draft.customColor, '#ff0000'); assert.equal(rec.draft.customBg, '', 'cor inválida é descartada');
  assert.equal(rec.draft.items[0].photo, 'data:image/jpeg;base64,AAAA'); assert.equal(rec.draft.items[1].photo, '');
  assert.ok(w.deploys.at(-1).site.files[0].data.includes('--p:#ff0000'), 'cor livre vai para o site');
});


// Blob falso com ETag e ifMatch de verdade, e uma pausa em cada chamada para os pedidos se intercalarem.
function fakeBlob() {
  const files = new Map(); let version = 0;
  const tick = () => new Promise(r => setTimeout(r, Math.random() * 4));
  class BlobNotFoundError extends Error {} class BlobPreconditionFailedError extends Error {}
  return {
    head: async path => { await tick(); const f = files.get(path); if (!f) throw new BlobNotFoundError('not found'); return { etag: f.etag }; },
    get: async path => { await tick(); const f = files.get(path); if (!f) throw new BlobNotFoundError('not found'); return { stream: new Response(f.body).body, blob: { size: f.body.length } }; },
    put: async (path, body, opts) => {
      await tick(); const f = files.get(path);
      if (opts.ifMatch && (!f || f.etag !== opts.ifMatch)) throw new BlobPreconditionFailedError('precondition failed');
      if (!opts.ifMatch && f && opts.allowOverwrite === false) throw new BlobPreconditionFailedError('already exists');
      files.set(path, { body, etag: 'e' + (++version) });
    }
  };
}
function blobWorld({ deployGate = null } = {}) {
  const blob = fakeBlob(), clock = { now: Date.parse('2026-11-12T12:00:00Z') };
  const store = createClientAccessStore({ ...blob, token: () => 'tok', memory: () => false });
  const deploys = [];
  const cloudflare = () => ({ deploy: async (project, site) => { if (deployGate) await deployGate(); deploys.push(project); return { project, url: `https://${project}.pages.dev`, deploymentId: 'd' }; } });
  const publishStore = { get: async () => null, set: async () => ({}) };
  const handler = createClientAccessHandler({ store, publishStore, cloudflare, authorized: async req => req.headers.cookie === 'admin', sameOrigin: () => true, secret: () => 's'.repeat(40), now: () => clock.now });
  const call = async (body, cookie = '') => { const res = { statusCode: 0, setHeader() {}, end(t) { this.body = JSON.parse(t); } }; await handler({ method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify(body) }, res); return { status: res.statusCode, body: res.body }; };
  return { store, call, deploys };
}

test('corrida 1: 20 códigos errados ao mesmo tempo não furam o bloqueio de 5 tentativas', async () => {
  const w = blobWorld();
  const made = await w.call({ action: 'admin-create', siteName: 'Teste', niche: 'loja', plan: 'essencial' }, 'admin');
  const token = tokenOf(made.body.link), wrong = made.body.code === '000000' ? '111111' : '000000';
  const results = await Promise.all(Array.from({ length: 20 }, () => w.call({ action: 'login', token, code: wrong })));
  const checked = results.filter(r => r.status === 401).length;
  assert.ok(checked <= MAX_FAILS, `no máximo ${MAX_FAILS} códigos conferidos (foram ${checked})`);
  assert.ok(results.every(r => [401, 429].includes(r.status)), JSON.stringify(results.map(r => r.status)));
  const rec = await w.store.getRecord(tokenHash(token));
  assert.ok(rec.lockUntil > 0, 'ficou bloqueado');
  assert.equal((await w.call({ action: 'login', token, code: made.body.code })).status, 429, 'nem o código certo entra durante o bloqueio');
});

test('corrida 2: cortar o acesso durante uma publicação não é desfeito quando ela termina', async () => {
  let release; const gate = new Promise(r => { release = r; });
  const w = blobWorld({ deployGate: () => gate });
  const made = await w.call({ action: 'admin-create', siteName: 'Teste', niche: 'loja', plan: 'essencial' }, 'admin');
  const token = tokenOf(made.body.link);
  const login = await w.call({ action: 'login', token, code: made.body.code });
  const saving = w.call({ action: 'save', token, session: login.body.session, draft: login.body.draft });
  await new Promise(r => setTimeout(r, 60));
  const siteId = Object.keys((await w.call({ action: 'admin-list' }, 'admin')).body.sites)[0];
  assert.equal((await w.call({ action: 'admin-revoke', siteId }, 'admin')).status, 200);
  release();
  await saving;
  assert.equal((await w.store.getRecord(tokenHash(token))).revoked, true, 'continua cortado');
  assert.equal((await w.call({ action: 'login', token, code: made.body.code })).status, 404, 'link antigo não volta a funcionar');
});

test('corrida 3: vários salvamentos ao mesmo tempo não passam do limite do dia', async () => {
  const w = blobWorld();
  const made = await w.call({ action: 'admin-create', siteName: 'Teste', niche: 'loja', plan: 'essencial' }, 'admin');
  const token = tokenOf(made.body.link), hash = tokenHash(token);
  const login = await w.call({ action: 'login', token, code: made.body.code });
  await w.store.updateRecord(hash, r => ({ ...r, saves: { day: '2026-11-12', count: MAX_SAVES_PER_DAY - 1 } }));
  const results = await Promise.all(Array.from({ length: 10 }, () => w.call({ action: 'save', token, session: login.body.session, draft: login.body.draft })));
  assert.equal(results.filter(r => r.status === 200).length, 1, 'só 1 salvamento cabia na cota');
  assert.equal(w.deploys.length, 1, 'só 1 publicação na Cloudflare');
  assert.equal((await w.store.getRecord(hash)).saves.count, MAX_SAVES_PER_DAY);
});

test('corrida 4: trocar o plano durante uma publicação não é desfeito quando ela termina', async () => {
  let release; const gate = new Promise(r => { release = r; });
  const w = blobWorld({ deployGate: () => gate });
  const made = await w.call({ action: 'admin-create', siteName: 'Teste', niche: 'loja', plan: 'premium' }, 'admin');
  const token = tokenOf(made.body.link);
  const login = await w.call({ action: 'login', token, code: made.body.code });
  const saving = w.call({ action: 'save', token, session: login.body.session, draft: login.body.draft });
  await new Promise(r => setTimeout(r, 60));
  const siteId = Object.keys((await w.call({ action: 'admin-list' }, 'admin')).body.sites)[0];
  assert.equal((await w.call({ action: 'admin-plan', siteId, plan: 'essencial' }, 'admin')).status, 200);
  release();
  assert.equal((await saving).status, 200);
  assert.equal((await w.store.getRecord(tokenHash(token))).draft.plan, 'essencial', 'o plano novo continua valendo');
  assert.equal((await w.call({ action: 'admin-list' }, 'admin')).body.sites[siteId].plan, 'essencial', 'a lista também');
});

test('ramo livre: só quando o dono libera o cliente pode trocar o ramo', async () => {
  const w = world();
  const locked = await w.call({ action: 'admin-create', siteName: 'Travado', niche: 'barbearia', plan: 'premium' }, asAdmin);
  const free = await w.call({ action: 'admin-create', siteName: 'Livre', niche: 'barbearia', plan: 'premium', allowNiche: true }, asAdmin);
  const save = async made => {
    const token = tokenOf(made.body.link);
    const login = await w.call({ action: 'login', token, code: made.body.code });
    await w.call({ action: 'save', token, session: login.body.session, draft: { ...login.body.draft, niche: 'restaurante' } });
    return { token, login, rec: await w.store.getRecord(tokenHash(token)) };
  };
  const a = await save(locked), b = await save(free);
  assert.equal(a.login.body.allowNiche, false); assert.equal(a.rec.draft.niche, 'barbearia', 'travado continua no ramo');
  assert.equal(b.login.body.allowNiche, true); assert.equal(b.rec.draft.niche, 'restaurante', 'liberado troca o ramo');
  const sites = (await w.call({ action: 'admin-list' }, asAdmin)).body.sites;
  const lockedId = Object.keys(sites).find(id => sites[id].siteName === 'Travado');
  assert.equal(sites[lockedId].allowNiche, false);
  assert.equal((await w.call({ action: 'admin-niche', siteId: lockedId, allow: true }, asAdmin)).status, 200);
  assert.equal((await w.call({ action: 'admin-list' }, asAdmin)).body.sites[lockedId].allowNiche, true);
  const relog = await w.call({ action: 'login', token: a.token, code: locked.body.code });
  await w.call({ action: 'save', token: a.token, session: relog.body.session, draft: { ...relog.body.draft, niche: 'oficina' } });
  assert.equal((await w.store.getRecord(tokenHash(a.token))).draft.niche, 'oficina', 'depois de liberado, troca');
  assert.equal((await w.call({ action: 'admin-niche', siteId: lockedId, allow: true })).status, 401, 'só o dono');
});

test('salvamento só confirma "pronto" se o rascunho foi guardado (apontado pelo Codex)', async () => {
  const w = world();
  const made = await w.call({ action: 'admin-create', siteName: 'Teste', niche: 'loja', plan: 'essencial' }, asAdmin);
  const token = tokenOf(made.body.link);
  const login = await w.call({ action: 'login', token, code: made.body.code });
  const real = w.store.updateRecord.bind(w.store); let calls = 0;
  w.store.updateRecord = async (hash, change) => { calls++; if (calls === 2) throw Object.assign(new Error('busy'), { code: 'busy' }); return real(hash, change); };
  const res = await w.call({ action: 'save', token, session: login.body.session, draft: { ...login.body.draft, name: 'Nome Novo' } });
  assert.equal(res.status, 503); assert.equal(res.body.saved, false); assert.notEqual(res.body.ok, true);
  w.store.updateRecord = real;
  assert.notEqual((await w.store.getRecord(tokenHash(token))).draft.name, 'Nome Novo', 'de fato não guardou, e o cliente foi avisado');
});
