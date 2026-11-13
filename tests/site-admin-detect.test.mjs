import test from 'node:test';
import assert from 'node:assert/strict';
import { detectAdmin, editEntry } from '../lib/site-admin-detect.js';
import { injectSiteData } from '../lib/site-data.js';

const f = (path, data) => ({ path, data });

test('detecta área que salva gerando index.html novo (padrão do site do padel)', () => {
  const html = `<html><body><script type="application/json" id="dados">{"a":1}</script><script>
    function rota(){ if (location.hash === '#admin') abrir(); }
    const url = URL.createObjectURL(new Blob([h])); </script><input type="password"></body></html>`;
  const d = detectAdmin([f('index.html', html)]);
  assert.equal(d.ok, true); assert.equal(d.entry, '#admin'); assert.deepEqual(d.saves, ['download']); assert.deepEqual(d.blocks, ['dados']);
});

test('detecta área no navegador (localStorage), com hash próprio ou página admin.html', () => {
  const d = detectAdmin([f('index.html', '<a href="#painel-dono">x</a>'), f('app.js', "window.addEventListener('hashchange',()=>{ if(location.hash=='#painel-dono') show() }); localStorage.setItem('menu', x)")]);
  assert.equal(d.ok, true); assert.equal(d.entry, '#painel-dono'); assert.deepEqual(d.saves, ['storage']);
  const p = detectAdmin([f('index.html', '<p>oi</p>'), f('admin.html', '<input type="password"><script>localStorage.x=1</script>')]);
  assert.equal(p.entry, '/admin.html'); assert.equal(p.ok, true);
});

test('sem área, servidor próprio ou IndexedDB: não liga sozinho', () => {
  const none = detectAdmin([f('index.html', '<h1>Barbearia</h1><script>localStorage.tema="escuro"</script>')]);
  assert.equal(none.hasAdmin, false); assert.equal(none.ok, false); assert.equal(editEntry(none), '#promisa-admin');
  assert.equal(detectAdmin([f('index.html', '<input type="password"><script>firebase.initializeApp({}); localStorage.a=1</script>')]).ok, false);
  const idb = detectAdmin([f('index.html', '<input type="password"><script>indexedDB.open("x")</script>')]);
  assert.equal(idb.ok, false); assert.equal(idb.unsupported, true);
});

test('o modo edição publicado já sabe o endereço da área administrativa', () => {
  const site = { htmlPath: 'index.html', files: [f('index.html', "<html><head></head><body><script>if(location.hash==='#adm')x();localStorage.a=1</script></body></html>")] };
  const html = injectSiteData(site, { siteId: 's', api: 'x' }).files[0].data;
  assert.match(html, /"admin":"#adm"/);
});

test('detecta bloco com aspas simples e atributos em outra ordem', () => {
  const d = detectAdmin([f('index.html', "<script id='dados' type='application/json'>{}</script><script>if(location.hash==='#admin')a();URL.createObjectURL(b)</script>")]);
  assert.deepEqual(d.blocks, ['dados']); assert.equal(d.ok, true);
});

test('endereço da página admin conta a partir da pasta publicada (ZIP com pasta)', () => {
  const files = [f('bundle/index.html', '<p>oi</p>'), f('bundle/admin.html', '<input type="password"><script>localStorage.a=1</script>')];
  assert.equal(detectAdmin(files, { root: 'bundle/' }).entry, '/admin.html');
  const html = injectSiteData({ htmlPath: 'bundle/index.html', files }, { siteId: 's', api: 'x' }).files[0].data;
  assert.match(html, /"admin":"\/admin\.html"/);
});
