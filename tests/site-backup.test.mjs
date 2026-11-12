import test from 'node:test';
import assert from 'node:assert/strict';
import { fingerprint, splitParts, changedSites, safeName, formatSize, PART_BYTES } from '../src/site-backup.js';
import { createDiscord } from '../lib/discord.js';

test('backup dos sites: só envia o que mudou', () => {
  const a = { id: 'a', name: 'GV Barber', updatedAt: '2026-11-01', files: [{ path: 'index.html', data: '<h1>oi</h1>' }] };
  const b = { id: 'b', name: 'Kaetano', updatedAt: '2026-11-02', files: [] };
  const done = { a: fingerprint(a) };
  assert.deepEqual(changedSites([a, b], done).map(s => s.id), ['b']);
  const edited = { ...a, updatedAt: '2026-11-12' };
  assert.deepEqual(changedSites([edited, b], { a: fingerprint(a), b: fingerprint(b) }).map(s => s.id), ['a']);
  assert.notEqual(fingerprint(a), fingerprint({ ...a, files: [{ path: 'index.html', data: '<h1>oi!</h1>' }] }));
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
