import test from 'node:test';
import assert from 'node:assert/strict';
import { contentHash, pendingSites, splitParts, safeName, formatSize, PART_BYTES } from '../src/site-backup.js';
import { createDiscord } from '../lib/discord.js';
import { createBackupIndexStore, normalizeIndex } from '../lib/backup-index-store.js';

test('backup dos sites: identifica pelo conteúdo e nunca repete', async () => {
  const a = { id: 'a', name: 'GV Barber', files: [{ path: 'index.html', data: '<h1>oi</h1>' }, { path: 'css/s.css', data: 'h1{}' }] };
  const b = { id: 'b', name: 'Kaetano', files: [{ path: 'index.html', data: '<p>k</p>' }] };
  const ha = await contentHash(a), hb = await contentHash(b);
  assert.match(ha, /^[a-f0-9]{32}$/);
  assert.equal(ha, await contentHash({ ...a, name: 'Outro nome', updatedAt: 'x', files: [...a.files].reverse() }), 'nome, data e ordem não mudam a impressão digital');
  assert.notEqual(ha, await contentHash({ ...a, files: [{ path: 'index.html', data: '<h1>oi!</h1>' }, a.files[1]] }));
  assert.notEqual(ha, await contentHash({ ...a, sourceZip: { blob: new Blob(['zip']) } }));
  const hashed = [{ site: a, hash: ha }, { site: b, hash: hb }];
  assert.deepEqual(pendingSites(hashed, {}).map(x => x.site.id), ['a', 'b']);
  assert.deepEqual(pendingSites(hashed, { a: ha }).map(x => x.site.id), ['b'], 'este aparelho já enviou');
  assert.deepEqual(pendingSites(hashed, {}, { b: { h: hb, at: '2026-11-12' } }).map(x => x.site.id), ['a'], 'outro aparelho já enviou');
  assert.deepEqual(pendingSites(hashed, { a: 'velho' }, { b: { h: hb } }).map(x => x.site.id), ['a'], 'conteúdo mudou: envia de novo');
});

test('lista de backups enviados: valida, junta e limita', async () => {
  const store = createBackupIndexStore({ token: () => '', memory: () => true, now: () => Date.parse('2026-11-12T10:00:00Z') });
  assert.deepEqual((await store.read()).sites, {});
  assert.equal(await store.mark([{ id: 'site-1', h: 'a'.repeat(32) }, { id: 'bad id!', h: 'a'.repeat(32) }, { id: 'site-2', h: 'xyz' }]), 1);
  assert.deepEqual((await store.read()).sites, { 'site-1': { h: 'a'.repeat(32), at: '2026-11-12T10:00:00.000Z' } });
  await store.mark([{ id: 'site-2', h: 'b'.repeat(32) }]);
  assert.deepEqual(Object.keys((await store.read()).sites).sort(), ['site-1', 'site-2']);
  assert.deepEqual(normalizeIndex({ sites: { x: { h: 'zz' }, y: { h: 'c'.repeat(20), at: 1 } } }).sites, { y: { h: 'c'.repeat(20), at: '1' } });
});

test('backup dos sites: divide arquivos grandes e nomes seguros', () => {
  assert.deepEqual(splitParts(1000), [{ start: 0, end: 1000 }]);
  const parts = splitParts(PART_BYTES * 2 + 5);
  assert.equal(parts.length, 3);
  assert.equal(parts.at(-1).end, PART_BYTES * 2 + 5);
  assert.ok(parts.every(p => p.end - p.start <= PART_BYTES));
  assert.equal(safeName('Pão & Café São João!'), 'Pao-Cafe-Sao-Joao');
  assert.equal(formatSize(2 * 1048576), '2 MB');
});

function fakeApi({ webhooks = [], deny = false } = {}) {
  const calls = [];
  const fetch = async (url, init = {}) => {
    const path = url.replace('https://discord.com/api/v10', '');
    calls.push({ method: init.method || 'GET', path });
    const reply = (status, data) => ({ status, ok: status < 300, json: async () => data });
    if (path === '/guilds/G1/channels') return reply(200, [{ id: 'bk', type: 0, name: '🗄️・backup-sites' }]);
    if (path === '/channels/bk/webhooks') {
      if (deny) return reply(403, {});
      if ((init.method || 'GET') === 'GET') return reply(200, webhooks);
      return reply(200, { id: '123456789', token: 'tok_' + 'x'.repeat(40), name: 'Promisa Backup' });
    }
    return reply(404, {});
  };
  return { fetch, calls };
}
const ENV = { DISCORD_BOT_TOKEN: 'BOT', DISCORD_GUILD_ID: 'G1' };

test('webhook do backup: reaproveita, cria ou explica a permissão que falta', async () => {
  let api = fakeApi({ webhooks: [{ id: '987654321', token: 't'.repeat(40), name: 'Promisa Backup' }] });
  let d = createDiscord({ fetch: api.fetch, env: ENV, log: { error() {} } });
  assert.deepEqual(await d.backupWebhook(), { ok: true, url: 'https://discord.com/api/webhooks/987654321/' + 't'.repeat(40) });
  assert.ok(!api.calls.some(c => c.method === 'POST'), 'não cria outro se já existe');

  api = fakeApi();
  d = createDiscord({ fetch: api.fetch, env: ENV, log: { error() {} } });
  assert.equal((await d.backupWebhook()).ok, true);
  assert.ok(api.calls.some(c => c.method === 'POST' && c.path === '/channels/bk/webhooks'));

  api = fakeApi({ deny: true });
  d = createDiscord({ fetch: api.fetch, env: ENV, log: { error() {} } });
  assert.deepEqual(await d.backupWebhook(), { ok: false, reason: 'permission' });

  const manual = 'https://discord.com/api/webhooks/111111/' + 'm'.repeat(30);
  d = createDiscord({ fetch: async () => { throw new Error('não deveria chamar'); }, env: { DISCORD_BACKUP_WEBHOOK_URL: manual }, log: { error() {} } });
  assert.deepEqual(await d.backupWebhook(), { ok: true, url: manual });
  d = createDiscord({ fetch: async () => { throw new Error('x'); }, env: { DISCORD_BACKUP_WEBHOOK_URL: 'https://evil.example/api/webhooks/1/abc' }, log: { error() {} } });
  assert.equal((await d.backupWebhook()).ok, false, 'endereço estranho é ignorado');
});
