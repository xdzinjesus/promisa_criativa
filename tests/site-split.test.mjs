import test from 'node:test';
import assert from 'node:assert/strict';
import { planSync, decodeValue, digest } from '../src/cloud-core.js';
import { buildSiteEntries, splitSite, mergeSite, resolveSiteDownloads, batchOperations, withSitePairs, conflictLabels, filesFingerprint, legacySiteHash, legacyBaselineHints, deferSitePairs } from '../src/site-split.js';
import { validateEntry } from '../src/data-validation.js';
import { validateStoredRecord, validKey, verifyObject, checkSitePairs } from '../lib/cloud-store.js';
import { pickSiteRecord } from '../lib/site-cache.js';
import { isEncryptedKey } from '../src/vault.js';

const site = (extra = {}) => ({
  id: 's1', siteType: 'cliente', name: 'Padaria', status: 'Em edição', leadId: 'l1', clientName: 'Ana', slug: 'ana',
  createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', htmlPath: 'index.html',
  files: [{ path: 'index.html', type: 'text/html', size: 5, data: '<html>' }, { path: 'a.css', type: 'text/css', size: 3, data: 'a{}' }], ...extra
});
const parse = text => JSON.parse(text).value;

test('captura gera dois registros e filesHash casa com o hash dos arquivos', async () => {
  const pair = await buildSiteEntries(site());
  assert.equal(pair.files.key, 'sitefiles:s1');
  assert.equal(pair.meta.key, 'sites:s1');
  const filesText = await pair.files.load();
  assert.equal(await digest(filesText), pair.files.hash);
  const meta = parse(pair.meta.text);
  assert.equal(meta.filesHash, pair.files.hash);
  assert.equal(meta.files, undefined); assert.equal(meta.htmlPath, undefined);
  assert.equal(meta.name, 'Padaria');
  const files = parse(filesText);
  assert.deepEqual(Object.keys(files).sort(), ['files', 'htmlPath', 'id']);
  assert.ok(Buffer.byteLength(pair.meta.text) < 1000);
  // Os dois passam na validação do servidor
  validateStoredRecord('sites:s1', JSON.parse(pair.meta.text));
  validateStoredRecord('sitefiles:s1', JSON.parse(filesText));
});

test('mudar só os dados altera só sites:; mudar arquivos altera os dois', async () => {
  const memo = new Map();
  const a = await buildSiteEntries(site(), memo);
  const b = await buildSiteEntries(site({ status: 'Entregue', updatedAt: '2026-02-01T00:00:00.000Z' }), memo);
  assert.equal(a.files.hash, b.files.hash);
  assert.notEqual(a.meta.hash, b.meta.hash);
  const changed = site(); changed.files = [{ ...changed.files[0], data: '<html>2' }, changed.files[1]];
  const c = await buildSiteEntries(changed, memo);
  assert.notEqual(c.files.hash, a.files.hash);
  assert.notEqual(c.meta.hash, a.meta.hash);
});

test('memoização reaproveita o hash e recalcula se qualquer byte muda', async () => {
  const memo = new Map();
  const a = await buildSiteEntries(site(), memo);
  const fp = memo.get('s1').fingerprint;
  assert.equal((await buildSiteEntries(site(), memo)).files.hash, a.files.hash);
  // mesma data de atualização e mesmo tamanho, conteúdo diferente
  const sneaky = site(); sneaky.files[1].data = 'b{}';
  assert.notEqual(await filesFingerprint(splitSite(sneaky).filesPart), fp);
  const b = await buildSiteEntries(sneaky, memo);
  assert.notEqual(b.files.hash, a.files.hash);
  // bytes do ZIP original também contam
  const z1 = site({ sourceZip: { name: 'x.zip', blob: new Blob([new Uint8Array([1, 2, 3])]) } });
  const z2 = site({ sourceZip: { name: 'x.zip', blob: new Blob([new Uint8Array([1, 2, 4])]) } });
  assert.notEqual((await buildSiteEntries(z1, new Map())).files.hash, (await buildSiteEntries(z2, new Map())).files.hash);
  const zipPair = await buildSiteEntries(z1, new Map());
  validateStoredRecord('sitefiles:s1', JSON.parse(await zipPair.files.load()));
});

test('load recusa enviar se os arquivos mudaram depois do hash', async () => {
  const s = site();
  const pair = await buildSiteEntries(s, new Map());
  s.files[0].data = 'mudou';
  await assert.rejects(pair.files.load());
});

test('mesmos dados geram o mesmo hash em dois aparelhos', async () => {
  const x = await buildSiteEntries(site(), new Map()), y = await buildSiteEntries(structuredClone(site()), new Map());
  assert.equal(x.meta.hash, y.meta.hash); assert.equal(x.files.hash, y.files.hash);
});

// Simulação de download
async function remoteOf(s) {
  const pair = await buildSiteEntries(s, new Map());
  const records = { [pair.meta.key]: { hash: pair.meta.hash, path: 'm' }, [pair.files.key]: { hash: pair.files.hash, path: 'f' } };
  const store = { [pair.meta.key]: decodeValue(parse(pair.meta.text)), [pair.files.key]: decodeValue(parse(await pair.files.load())) };
  return { pair, records, store };
}
const fetcher = (store, calls = []) => async key => { calls.push(key); return store[key]; };

test('mudança só nos dados mantém os arquivos locais, sem baixar sitefiles', async () => {
  const local = site();
  const remote = await remoteOf(site({ status: 'Entregue', updatedAt: '2026-02-01T00:00:00.000Z' }));
  const localPair = await buildSiteEntries(local, new Map());
  const calls = [];
  const out = await resolveSiteDownloads(new Map([['sites:s1', remote.store['sites:s1']]]), remote.records, () => ({ site: local, filesHash: localPair.files.hash }), fetcher(remote.store, calls));
  assert.equal(calls.length, 0);
  assert.equal(out.get('sites:s1').status, 'Entregue');
  assert.deepEqual(out.get('sites:s1').files, local.files);
  assert.equal(out.get('sites:s1').filesHash, undefined);
  validateEntry('sites:s1', out.get('sites:s1'));
});

test('mudança só nos arquivos mantém os dados locais', async () => {
  const local = site({ status: 'Local' });
  const newFiles = site(); newFiles.files[0].data = '<html>novo';
  const remote = await remoteOf(newFiles);
  const out = await resolveSiteDownloads(new Map([['sitefiles:s1', remote.store['sitefiles:s1']]]), remote.records, () => ({ site: local, filesHash: 'x' }), fetcher(remote.store));
  assert.equal(out.get('sites:s1').status, 'Local');
  assert.equal(out.get('sites:s1').files[0].data, '<html>novo');
  assert.equal(out.has('sitefiles:s1'), false);
});

test('aparelho novo baixa os dois e recebe o site completo; baixa sitefiles se faltar', async () => {
  const remote = await remoteOf(site({ sourceZip: { name: 'a.zip', blob: new Blob([new Uint8Array([9, 8])]) } }));
  const both = await resolveSiteDownloads(new Map([['sites:s1', remote.store['sites:s1']], ['sitefiles:s1', remote.store['sitefiles:s1']]]), remote.records, () => null, fetcher(remote.store));
  assert.equal(both.get('sites:s1').name, 'Padaria');
  assert.ok(both.get('sites:s1').sourceZip.blob instanceof Blob);
  validateEntry('sites:s1', both.get('sites:s1'));
  const calls = [];
  const only = await resolveSiteDownloads(new Map([['sites:s1', remote.store['sites:s1']]]), remote.records, () => null, fetcher(remote.store, calls));
  assert.deepEqual(calls, ['sitefiles:s1']);
  assert.equal(only.get('sites:s1').files.length, 2);
  // sitefiles ausente online: erro, nada é gravado
  await assert.rejects(resolveSiteDownloads(new Map([['sites:s1', remote.store['sites:s1']]]), { 'sites:s1': remote.records['sites:s1'] }, () => null, fetcher({})));
  // hash diferente (índice mudou no meio): erro
  await assert.rejects(resolveSiteDownloads(new Map([['sites:s1', remote.store['sites:s1']]]), { ...remote.records, 'sitefiles:s1': { hash: 'b'.repeat(64), path: 'f' } }, () => null, fetcher(remote.store)));
});

test('registro antigo completo ainda é aceito e a próxima sincronização migra', async () => {
  const legacy = site();
  validateStoredRecord('sites:s1', { version: 1, value: JSON.parse(JSON.stringify(legacy)) });
  const out = await resolveSiteDownloads(new Map([['sites:s1', legacy]]), { 'sites:s1': { hash: 'a'.repeat(64), path: 'p' } }, () => null, async () => { throw new Error('não deveria baixar'); });
  assert.deepEqual(out.get('sites:s1'), legacy);
  // planejamento: remoto antigo igual ao baseline; local gera novo formato -> envia os dois, sem conflito
  const pair = await buildSiteEntries(legacy, new Map());
  const old = 'c'.repeat(64);
  const plan = planSync({ 'sites:s1': pair.meta, 'sitefiles:s1': pair.files }, { 'sites:s1': old }, { 'sites:s1': { hash: old } }, { 'sites:s1': old });
  assert.deepEqual(plan.conflicts, []);
  assert.deepEqual(plan.operations.map(o => o.key).sort(), ['sitefiles:s1', 'sites:s1']);
  // depois da migração, outro aparelho com o mesmo conteúdo só confere (sem novo envio)
  const settled = planSync({ 'sites:s1': pair.meta, 'sitefiles:s1': pair.files }, { 'sites:s1': old }, { 'sites:s1': { hash: pair.meta.hash }, 'sitefiles:s1': { hash: pair.files.hash } }, { 'sites:s1': old });
  assert.deepEqual(settled.operations, []); assert.deepEqual(settled.conflicts, []);
});

test('apagar um site apaga os dois registros e o apagado online remove o local', async () => {
  const pair = await buildSiteEntries(site(), new Map());
  const baseline = { 'sites:s1': pair.meta.hash, 'sitefiles:s1': pair.files.hash };
  const online = { 'sites:s1': { hash: pair.meta.hash }, 'sitefiles:s1': { hash: pair.files.hash } };
  const plan = planSync({}, baseline, online);
  assert.deepEqual(plan.operations.map(o => [o.key, o.hash]).sort(), [['sitefiles:s1', null], ['sites:s1', null]]);
  const batches = batchOperations(plan.operations);
  assert.equal(batches.length, 1); assert.equal(batches[0][0].key, 'sitefiles:s1');
  const removed = planSync({ 'sites:s1': pair.meta, 'sitefiles:s1': pair.files }, baseline, { 'sites:s1': { hash: null }, 'sitefiles:s1': { hash: null } });
  assert.deepEqual(removed.downloads.sort(), ['sitefiles:s1', 'sites:s1']);
  const out = await resolveSiteDownloads(new Map([['sites:s1', undefined], ['sitefiles:s1', undefined]]), {}, () => ({ site: site(), filesHash: pair.files.hash }), fetcher({}));
  assert.deepEqual([...out], [['sites:s1', undefined]]);
});

test('lotes nunca separam o par e respeitam o limite de 20', () => {
  const ops = [];
  for (let i = 0; i < 15; i++) ops.push({ key: 'sites:' + i }, { key: 'sitefiles:' + i });
  const batches = batchOperations(ops);
  assert.ok(batches.every(b => b.length <= 20));
  assert.equal(batches.flat().length, 30);
  for (const b of batches) for (const op of b) if (op.key.startsWith('sites:')) assert.ok(b.some(o => o.key === 'sitefiles:' + op.key.slice(6)));
});

test('validação: metadados com filesHash, sitefiles e rejeições', () => {
  const h = 'a'.repeat(64);
  validateEntry('sites:s1', { id: 's1', name: 'x', filesHash: h }, { encoded: true });
  assert.throws(() => validateEntry('sites:s1', { id: 's1', name: 'x', filesHash: 'zz' }));
  assert.throws(() => validateEntry('sites:s1', { id: 's1', filesHash: h, files: [] }));
  assert.throws(() => validateEntry('sites:s1', { id: 's1', name: 'x' }));
  validateEntry('sites:s1', site()); // antigo completo
  const part = { id: 's1', htmlPath: 'index.html', files: [{ path: 'index.html', type: 'text/html', data: 'x' }] };
  validateEntry('sitefiles:s1', part);
  for (const bad of [
    { ...part, htmlPath: '../x.html', files: [{ path: '../x.html', data: 'x' }] },
    { ...part, files: [{ path: '.env', data: 'x' }, ...part.files] },
    { ...part, htmlPath: 'other.html' },
    { ...part, name: 'extra' },
    { id: 's2', ...{ htmlPath: part.htmlPath, files: part.files } }
  ]) assert.throws(() => validateEntry('sitefiles:s1', bad));
  assert.ok(validKey('sitefiles:abc'));
  assert.equal(isEncryptedKey('sitefiles:abc'), false);
  assert.throws(() => validateStoredRecord('sitefiles:s1', { version: 2, vault: 'v', iv: 'AAAAAAAAAAAAAAAA', data: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' }));
});

test('leitor do servidor usa sitefiles e cai no registro antigo', () => {
  const records = { 'sites:a': { hash: 'h1', path: 'p1' }, 'sitefiles:a': { hash: 'h2', path: 'p2' }, 'sites:b': { hash: 'h3', path: 'p3' }, 'sites:c': { hash: null, path: null }, 'sitefiles:c': { hash: 'h4', path: 'p4' } };
  assert.equal(pickSiteRecord(records, 'sites:a').path, 'p2');
  assert.equal(pickSiteRecord(records, 'sites:b').path, 'p3');
  assert.equal(pickSiteRecord(records, 'sites:c'), null);
  assert.equal(pickSiteRecord(records, 'sites:zzz'), null);
});

test('conflitos de sitefiles são resolvidos junto com o site', () => {
  assert.deepEqual(withSitePairs(['sites:a']).sort(), ['sitefiles:a', 'sites:a']);
  assert.deepEqual(conflictLabels(['sitefiles:a', 'sites:a', 'sales:1']), ['sites:a', 'sales:1']);
  assert.deepEqual(conflictLabels(['sitefiles:a']), ['sites:a (arquivos do site)']);
});

test('split e merge são inversos', () => {
  const s = site({ sourceZip: { name: 'a.zip', blob: new Blob(['x']) } });
  const { meta, filesPart } = splitSite(s);
  assert.deepEqual(mergeSite({ ...meta, filesHash: 'x' }, filesPart), s);
});

// Aparelho que sincronizou antes da separação: baseline = hash do registro antigo completo.
async function legacyDevice(localSite, baseSite = localSite) {
  const pair = await buildSiteEntries(localSite, new Map());
  const old = await legacySiteHash(baseSite);
  return { pair, old, local: { 'sites:s1': pair.meta, 'sitefiles:s1': pair.files }, baseline: { 'sites:s1': old }, plain: { 'sites:s1': old } };
}
const plan = async (dev, remote) => {
  const hints = await legacyBaselineHints(dev.local, dev.baseline, dev.plain, remote);
  return deferSitePairs(planSync(dev.local, hints.baseline, remote, hints.baselinePlain));
};

test('migração: aparelho antigo sem edição baixa a mudança feita online (sem conflito)', async () => {
  const dev = await legacyDevice(site());
  const remote = await remoteOf(site({ status: 'Entregue' }));
  const p = await plan(dev, remote.records);
  assert.deepEqual(p.conflicts, []);
  assert.deepEqual(p.downloads, ['sites:s1']);
  assert.deepEqual(p.operations, []);
  const out = await resolveSiteDownloads(new Map([['sites:s1', remote.store['sites:s1']]]), remote.records, () => ({ site: site(), filesHash: dev.pair.files.hash }), fetcher({}));
  assert.equal(out.get('sites:s1').status, 'Entregue');
  // arquivos mudados online também são baixados, sem conflito
  const changed = site(); changed.files[0].data = '<html>novo';
  const r2 = await remoteOf(changed);
  const p2 = await plan(dev, r2.records);
  assert.deepEqual(p2.conflicts, []); assert.deepEqual(p2.downloads.sort(), ['sitefiles:s1', 'sites:s1']);
  // site apagado online: remove localmente, sem conflito
  const p3 = await plan(dev, { 'sites:s1': { hash: null }, 'sitefiles:s1': { hash: null } });
  assert.deepEqual(p3.conflicts, []); assert.deepEqual(p3.downloads.sort(), ['sitefiles:s1', 'sites:s1']);
});

test('migração: remoto antigo intacto envia os dois; edição local real continua sendo conflito', async () => {
  const dev = await legacyDevice(site());
  const p = await plan(dev, { 'sites:s1': { hash: dev.old } });
  assert.deepEqual(p.conflicts, []);
  assert.deepEqual(p.operations.map(o => o.key).sort(), ['sitefiles:s1', 'sites:s1']);
  assert.equal(p.operations.find(o => o.key === 'sites:s1').baseHash, dev.old);
  const edited = await legacyDevice(site({ status: 'Editado aqui' }), site());
  const remote = await remoteOf(site({ status: 'Entregue' }));
  const c = await plan(edited, remote.records);
  assert.deepEqual(c.conflicts, ['sites:s1']);
});

test('migração: remoto antigo alterado por versão antiga baixa os dados e adia o envio dos arquivos velhos', async () => {
  const dev = await legacyDevice(site());
  const p = await plan(dev, { 'sites:s1': { hash: 'd'.repeat(64) } });
  assert.deepEqual(p.conflicts, []);
  assert.deepEqual(p.downloads, ['sites:s1']);
  assert.deepEqual(p.operations, []);
  assert.equal(p.deferred, 1);
});

test('servidor recusa dados de site sem os arquivos correspondentes', async () => {
  const pair = await buildSiteEntries(site(), new Map());
  const text = pair.meta.text;
  const read = async () => ({ stream: new Blob([text]).stream(), blob: { size: text.length, contentType: 'application/json', url: 'https://t.private.blob.vercel-storage.com/o.json' } });
  const info = await verifyObject({ key: 'sites:s1', path: 'o.json', hash: pair.meta.hash }, read);
  assert.equal(info.filesHash, pair.files.hash);
  const hashes = new Map([['sites:s1', info.filesHash]]);
  checkSitePairs({ 'sites:s1': { hash: pair.meta.hash }, 'sitefiles:s1': { hash: pair.files.hash } }, hashes);
  assert.throws(() => checkSitePairs({ 'sites:s1': { hash: pair.meta.hash } }, hashes), e => e.status === 409);
  assert.throws(() => checkSitePairs({ 'sites:s1': { hash: pair.meta.hash }, 'sitefiles:s1': { hash: 'e'.repeat(64) } }, hashes), e => e.status === 409);
  // registro antigo completo não exige par
  const legacyText = JSON.stringify({ version: 1, value: JSON.parse(JSON.stringify(site())) });
  const r2 = async () => ({ stream: new Blob([legacyText]).stream(), blob: { size: legacyText.length, contentType: 'application/json', url: 'https://t.private.blob.vercel-storage.com/o.json' } });
  assert.equal((await verifyObject({ key: 'sites:s1', path: 'o.json', hash: await digest(legacyText) }, r2)).filesHash, null);
});
