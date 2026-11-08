import test from 'node:test';
import assert from 'node:assert/strict';
import { planSync, persistKeysSafely } from '../src/cloud-core.js';

const rec = (hash, plainHash = hash) => ({ hash, plainHash });
const remote = hash => ({ hash });

test('sem proteção: casos típicos iguais ao comportamento antigo', () => {
  const baseline = { a: 'h1', b: 'h1', c: 'h1', d: 'h1' };
  const local = { a: rec('h1'), b: rec('h2'), c: rec('h1'), d: rec('h2'), e: rec('h9') };
  const online = { a: remote('h1'), b: remote('h1'), c: remote('h3'), d: remote('h3') };
  const plan = planSync(local, baseline, online);
  assert.deepEqual(plan.matches, ['a']);
  assert.deepEqual(plan.operations.map(o => o.key).sort(), ['b', 'e']);
  assert.deepEqual(plan.downloads, ['c']);
  assert.deepEqual(plan.conflicts, ['d']);
  // com baselinePlain igual ao baseline o resultado não muda
  const withPlain = planSync(local, baseline, online, { ...baseline });
  assert.deepEqual(withPlain, plan);
});

test('migração: texto igual e remoto inalterado envia a versão cifrada', () => {
  const plan = planSync({ x: rec('cifrado', 'plano') }, { x: 'plano' }, { x: remote('plano') }, { x: 'plano' });
  assert.deepEqual(plan.operations, [{ key: 'x', baseHash: 'plano', hash: 'cifrado' }]);
  assert.equal(plan.conflicts.length + plan.downloads.length, 0);
});

test('texto igual e remoto mudou em outro aparelho baixa sem conflito', () => {
  const plan = planSync({ x: rec('cifrado', 'plano') }, { x: 'plano' }, { x: remote('outro') }, { x: 'plano' });
  assert.deepEqual(plan.downloads, ['x']);
  assert.equal(plan.conflicts.length + plan.operations.length, 0);
});

test('texto mudou aqui e remoto mudou: conflito', () => {
  const plan = planSync({ x: rec('cifrado2', 'plano2') }, { x: 'plano' }, { x: remote('outro') }, { x: 'plano' });
  assert.deepEqual(plan.conflicts, ['x']);
});

test('texto mudou aqui e remoto inalterado: envia', () => {
  const plan = planSync({ x: rec('cifrado2', 'plano2') }, { x: 'plano' }, { x: remote('plano') }, { x: 'plano' });
  assert.equal(plan.operations.length, 1);
});

test('sem baselinePlain: comportamento antigo (conflito)', () => {
  const args = [{ x: rec('cifrado', 'plano') }, { x: 'plano' }, { x: remote('outro') }];
  assert.deepEqual(planSync(...args).conflicts, ['x']);
  assert.deepEqual(planSync(...args, {}).conflicts, ['x']);
  assert.deepEqual(planSync(...args, null).conflicts, ['x']);
});

test('registro apagado aqui continua contando como alteração local', () => {
  const plan = planSync({}, { x: 'plano' }, { x: remote('outro') }, { x: 'plano' });
  assert.deepEqual(plan.conflicts, ['x']);
});

test('persistKeysSafely não lança quando o armazenamento falha', async () => {
  assert.equal(await persistKeysSafely(async () => { throw new Error('idb'); }, {}), false);
  assert.equal(await persistKeysSafely(async () => {}, {}), true);
});
