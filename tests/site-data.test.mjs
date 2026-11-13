import test from 'node:test';
import assert from 'node:assert/strict';
import { injectSiteData, cleanChanges, mergeKeys, createSiteDataStore, createSiteDataActions, withSiteData, MAX_FAILS, MAX_SAVES_PER_DAY, SHIM } from '../lib/site-data.js';

const site = () => ({ name: 'Padel', htmlPath: 'index.html', files: [{ path: 'index.html', type: 'text/html', data: '<!doctype html><html><head><title>x</title></head><body><script src="app.js"></script></body></html>' }, { path: 'app.js', data: 'localStorage.getItem("cardapio")' }, { path: 'sobre.html', data: '<html><head></head><body></body></html>' }] });

test('injeção: dados e script no topo de cada página, sem duplicar e sem quebrar o HTML', () => {
  const out = injectSiteData(site(), { siteId: 'site-1', keys: { cardapio: '</script><script>alert(1)</script>' }, api: 'https://www.promisa.online/api/meu-site' });
  const html = out.files.find(f => f.path === 'index.html').data;
  assert.match(html, /<head><script>window\.__PROMISA_DADOS__=/);
  assert.ok(!html.includes('</script><script>alert(1)'), '</script> dentro dos dados é neutralizado');
  assert.ok(html.includes('\\u003c/script>'));
  assert.ok(out.files.find(f => f.path === 'sobre.html').data.includes('promisa-dados.js'), 'todas as páginas');
  assert.equal(out.files.filter(f => f.path === 'promisa-dados.js').length, 1);
  assert.equal(out.files.find(f => f.path === 'app.js').data, site().files[1].data, 'resto intacto');
  const twice = injectSiteData(out, { siteId: 'site-1', keys: { a: '1' }, api: 'x' });
  const h2 = twice.files.find(f => f.path === 'index.html').data;
  assert.equal((h2.match(/__PROMISA_DADOS__=/g) || []).length, 1, 'publicar de novo não duplica');
  assert.equal(twice.files.filter(f => f.path === 'promisa-dados.js').length, 1);
  assert.ok(SHIM.length > 500);
});

test('alterações: só chaves válidas, null apaga, promisa_ é reservado', () => {
  assert.deepEqual(cleanChanges({ a: '1', b: null, promisa_x: '2', c: 3, ['x'.repeat(300)]: '4' }), { a: '1', b: null });
  assert.equal(cleanChanges([1]), null);
  assert.deepEqual(mergeKeys({ a: '0', b: '1' }, { a: '2', b: null, c: '3' }), { a: '2', c: '3' });
});

function world() {
  let clock = Date.parse('2026-11-13T12:00:00Z');
  const store = createSiteDataStore({ token: () => '', memory: () => true });
  const published = [];
  const actions = createSiteDataActions({ store, publish: async id => { published.push(id); return { published: true }; }, now: () => clock });
  return { store, actions, published, tick: ms => { clock += ms; } };
}

test('dados ao vivo: dono liga, cliente publica com a senha, site é republicado com os dados', async () => {
  const w = world();
  assert.equal((await w.actions.publicSave({ siteId: 'site-1', password: 'ABCD-EFGH', changes: { a: '1' } }))[0], 404, 'desligado: nada');
  const [, on] = await w.actions.admin('admin-data-enable', { siteId: 'site-1' });
  assert.match(on.password, /^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
  const raw = JSON.stringify(await w.store.get('site-1'));
  assert.ok(!raw.includes(on.password), 'senha nunca guardada em texto');
  const [status, body] = await w.actions.publicSave({ siteId: 'site-1', password: on.password.toLowerCase(), changes: { cardapio: 'Feijoada', velho: null } });
  assert.equal(status, 200); assert.equal(body.published, true); assert.deepEqual(w.published, ['site-1']);
  assert.deepEqual((await w.store.get('site-1')).keys, { cardapio: 'Feijoada' });
  const [, st] = await w.actions.admin('admin-data-status', { siteId: 'site-1' });
  assert.equal(st.enabled, true); assert.equal(st.keys, 1);
  const read = withSiteData(async () => ({ site: site(), filesHash: 'h' }), w.store, { api: 'https://x/api' });
  const info = await read('sites:site-1');
  assert.ok(info.site.files[0].data.includes('Feijoada'), 'publicação do dono embute os dados');
  assert.equal(info.filesHash, 'h');
  await w.actions.admin('admin-data-disable', { siteId: 'site-1' });
  assert.equal((await w.actions.publicSave({ siteId: 'site-1', password: on.password, changes: { a: '1' } }))[0], 404, 'desligado: cliente não publica');
  assert.ok((await read('sites:site-1')).site.files[0].data.includes('Feijoada'), 'dados já publicados continuam no site');
});

test('dados ao vivo: senha errada bloqueia em 5 tentativas; limite por dia; nova senha invalida a antiga', async () => {
  const w = world();
  const [, on] = await w.actions.admin('admin-data-enable', { siteId: 's' });
  for (let i = 0; i < MAX_FAILS; i++) assert.equal((await w.actions.publicSave({ siteId: 's', password: 'ERRADA-00', changes: { a: '1' } }))[0], 401);
  assert.equal((await w.actions.publicSave({ siteId: 's', password: on.password, changes: { a: '1' } }))[0], 429, 'bloqueado');
  w.tick(16 * 60 * 1000);
  assert.equal((await w.actions.publicSave({ siteId: 's', password: on.password, changes: { a: '1' } }))[0], 200);
  await w.store.update('s', r => ({ ...r, saves: { day: '2026-11-13', count: MAX_SAVES_PER_DAY } }));
  assert.equal((await w.actions.publicSave({ siteId: 's', password: on.password, changes: { a: '2' } }))[0], 429, 'limite do dia');
  const [, renewed] = await w.actions.admin('admin-data-enable', { siteId: 's' });
  assert.notEqual(renewed.password, on.password);
  w.tick(24 * 60 * 60 * 1000);
  assert.equal((await w.actions.publicSave({ siteId: 's', password: on.password, changes: { a: '3' } }))[0], 401, 'senha antiga não vale');
  assert.equal((await w.store.get('s')).keys.a, '1', 'dados mantidos ao gerar nova senha');
});

test('dados ao vivo: site que salva gerando um index.html novo (bloco <script type="application/json" id="dados">)', async () => {
  const page = '<!doctype html><html><head></head><body><script type="application/json" id="dados">{"quadras":["A"]}</script><script>const re=/<script type="application\\/json" id="dados">/;</script></body></html>';
  const padel = () => ({ name: 'Padel', htmlPath: 'index.html', files: [{ path: 'index.html', type: 'text/html', data: page }] });
  const w = world();
  const [, on] = await w.actions.admin('admin-data-enable', { siteId: 'p' });
  assert.equal((await w.actions.publicSave({ siteId: 'p', password: on.password, embedded: { dados: 'não é json' } }))[0], 400, 'bloco precisa ser JSON');
  assert.equal((await w.actions.publicSave({ siteId: 'p', password: on.password, embedded: { 'a b': '{}' } }))[0], 400, 'nome do bloco limpo');
  assert.equal((await w.actions.publicSave({ siteId: 'p', password: on.password, embedded: { dados: '{"quadras":["A","B"],"x":"</script><b>"}' } }))[0], 200);
  const [, st] = await w.actions.admin('admin-data-status', { siteId: 'p' });
  assert.equal(st.keys, 1);
  const read = withSiteData(async () => ({ site: padel(), filesHash: 'h' }), w.store, { api: 'https://x/api' });
  const html = (await read('sites:p')).site.files[0].data;
  assert.ok(html.includes('<script type="application/json" id="dados">{"quadras":["A","B"],"x":"\\u003c/script>\\u003cb>"}</script>'), 'bloco trocado e protegido');
  assert.ok(html.includes('const re=/<script type="application\\/json" id="dados">/;'), 'código do site intacto');
  assert.equal(injectSiteData({ files: [{ path: 'index.html', data: html }] }, { siteId: 'p', embedded: { dados: '{"quadras":[]}' }, api: 'x' }).files[0].data.match(/__PROMISA_DADOS__=/g).length, 1, 'sem duplicar');
});

test('revisão: lote grande demais dá erro, aspas simples no bloco, chaves apagadas chegam aos visitantes, falha de leitura interrompe', async () => {
  const w = world();
  const [, on] = await w.actions.admin('admin-data-enable', { siteId: 'r' });
  const many = Object.fromEntries(Array.from({ length: 501 }, (_, i) => ['k' + i, 'v']));
  assert.equal((await w.actions.publicSave({ siteId: 'r', password: on.password, changes: many }))[0], 400, 'não descarta em silêncio');
  assert.equal((await w.actions.publicSave({ siteId: 'r', password: on.password, embedded: { a: '1', b: '1', c: '1', d: '1', e: '1', f: '1' } }))[0], 400);
  await w.actions.publicSave({ siteId: 'r', password: on.password, changes: { menu: 'x', velho: 'y' } });
  await w.actions.publicSave({ siteId: 'r', password: on.password, changes: { velho: null }, embedded: { dados: '{"n":2}' } });
  assert.deepEqual((await w.store.get('r')).removed, ['velho']);
  const page = "<html><head></head><body><script id='dados' type='application/json'>{\"n\":1}</script></body></html>";
  const read = withSiteData(async () => ({ site: { htmlPath: 'index.html', files: [{ path: 'index.html', data: page }] } }), w.store, { api: 'x' });
  const html = (await read('sites:r')).site.files[0].data;
  assert.ok(html.includes(`<script id='dados' type='application/json'>{"n":2}</script>`), 'aspas simples trocadas');
  assert.match(html, /"removed":\["velho"\]/);
  await w.actions.publicSave({ siteId: 'r', password: on.password, changes: { velho: 'de volta' } });
  assert.deepEqual((await w.store.get('r')).removed, [], 'chave recriada sai da lista');
  const broken = withSiteData(async () => ({ site: { files: [] } }), { get: async () => { throw new Error('blob fora'); } }, { api: 'x' });
  await assert.rejects(broken('sites:r'), /blob fora/);
});

test('revisão 2: nova senha mantém as chaves apagadas; falha ao consultar a publicação vira erro', async () => {
  const w = world();
  const [, on] = await w.actions.admin('admin-data-enable', { siteId: 'q' });
  await w.actions.publicSave({ siteId: 'q', password: on.password, changes: { promo: null } });
  await w.actions.admin('admin-data-enable', { siteId: 'q' });
  assert.deepEqual((await w.store.get('q')).removed, ['promo']);
  const store = createSiteDataStore({ token: () => '', memory: () => true });
  const actions = createSiteDataActions({ store, publish: async () => { throw new Error('consulta falhou'); } });
  const [, p] = await actions.admin('admin-data-enable', { siteId: 'z' });
  const [status, body] = await actions.publicSave({ siteId: 'z', password: p.password, changes: { a: '1' } });
  assert.equal(status, 502); assert.equal(body.saved, true);
});
