import test from 'node:test';
import assert from 'node:assert/strict';
import { agendaSource, applyToday, buildAgenda, dueStatus, dueLabel, todayIn, agendaHash, newPixelKey, validPixelKey, sealAgenda, openAgenda, validEnvelope } from '../src/agenda.js';
import { deliveryProgress, deliveryItems } from '../src/delivery-checklist.js';

const progress = e => deliveryProgress(e);
const missing = e => deliveryItems(e.plano).filter(i => !Object.hasOwn(e.feitos || {}, i.id)).map(i => i.label);
const allDone = Object.fromEntries(deliveryItems('essencial').map(i => [i.id, '2026-11-01']));
const leads = [
  { id: 'a', client: 'Atrasado', stage: 'Fechado', prazo: '2026-11-15', entrega: { plano: 'essencial', feitos: {} } },
  { id: 'b', client: 'Hoje', stage: 'Em contato', prazo: '2026-11-17' },
  { id: 'c', client: 'Semana', stage: 'Fechado', prazo: '2026-11-24' },
  { id: 'd', client: 'Longe', stage: 'Fechado', prazo: '2026-12-30' },
  { id: 'e', client: 'Entregue', stage: 'Fechado', prazo: '2026-11-17', entrega: { plano: 'essencial', feitos: allDone } },
  { id: 'f', client: 'Perdido', stage: 'Perdido', prazo: '2026-11-17' },
  { id: 'g', client: 'Lixeira', stage: 'Fechado', prazo: '2026-11-17', trashedAt: '2026-11-16T10:00:00Z' },
  { id: 'h', client: 'Sem prazo', stage: 'Fechado' },
  { id: 'i', client: 'Novo sem prazo', stage: 'Novo' },
];
const projects = [{ id: 'p1', title: 'Portfólio', status: 'Em andamento', dueDate: '2026-11-17' }, { id: 'p2', title: 'Feito', status: 'Concluído', dueDate: '2026-11-17' }];

test('regra: atrasada, vence hoje, próximos 7 dias; fora da janela não entra', () => {
  assert.equal(dueStatus('2026-11-16', '2026-11-17'), 'atrasada');
  assert.equal(dueStatus('2026-11-17', '2026-11-17'), 'vence-hoje');
  assert.equal(dueStatus('2026-11-24', '2026-11-17'), 'proximos');
  assert.equal(dueStatus('2026-11-25', '2026-11-17'), null);
  assert.equal(dueStatus('lixo', '2026-11-17'), null);
  assert.equal(dueLabel('2026-11-15', '2026-11-17'), 'Atrasada há 2 dias');
  assert.equal(dueLabel('2026-11-18', '2026-11-17'), 'Vence amanhã');
  assert.equal(dueLabel('2026-12-30', '2026-11-17'), 'Prazo 30/12');
  assert.equal(todayIn(new Date('2026-11-18T02:00:00Z')), '2026-11-17', 'depois das 21h de Brasília ainda é o mesmo dia');
});

test('agenda: ignora entregue, perdido e lixeira; conta sem prazo; ordena e monta link da ficha', () => {
  const ag = buildAgenda({ leads, projects, today: '2026-11-17', base: 'https://promisa.online', progress, missing });
  assert.deepEqual(ag.items.map(i => [i.id, i.status]), [['a', 'atrasada'], ['b', 'vence-hoje'], ['p1', 'vence-hoje'], ['c', 'proximos']]);
  assert.deepEqual(ag.counts, { atrasada: 1, 'vence-hoje': 2, proximos: 1, 'sem-prazo': 1 });
  const a = ag.items[0];
  assert.equal(a.url, 'https://promisa.online/admin?tab=clients&cliente=a&aba=entregas');
  assert.equal(a.total, deliveryItems('essencial').length); assert.equal(a.missing.length, 5);
  assert.equal(ag.timezone, 'America/Sao_Paulo'); assert.equal(ag.today, '2026-11-17');
});

test('fonte da agenda não muda com o dia (só grava no Blob quando um prazo ou entrega muda)', async () => {
  const src = agendaSource({ leads, projects, progress, missing });
  assert.ok(!('today' in src)); assert.ok(src.items.every(i => !('status' in i)));
  assert.equal(src.items.length, 5, 'inclui o prazo distante: o Pixel decide pela data');
  const h1 = await agendaHash(src), h2 = await agendaHash(agendaSource({ leads, projects, progress, missing }));
  assert.equal(h1, h2);
  assert.notEqual(h1, await agendaHash(agendaSource({ leads: [...leads, { id: 'z', client: 'Novo', stage: 'Novo', prazo: '2026-11-20' }], projects, progress, missing })));
  assert.deepEqual(applyToday(src, '2026-11-18').counts, { atrasada: 3, 'vence-hoje': 0, proximos: 1, 'sem-prazo': 1 });
});

test('envelope do Pixel: só abre com a chave certa e tem formato fixo', async () => {
  const key = newPixelKey(); assert.ok(validPixelKey(key)); assert.ok(!validPixelKey('curta'));
  const src = agendaSource({ leads, projects, progress, missing });
  const env = await sealAgenda(src, key, '2026-11-17T17:00:00.000Z');
  assert.ok(validEnvelope(env)); assert.ok(!JSON.stringify(env).includes('Atrasado'), 'nome do cliente não aparece em texto');
  const back = await openAgenda(env, key);
  assert.equal(back.items[0].title, 'Atrasado'); assert.equal(back.updatedAt, '2026-11-17T17:00:00.000Z');
  await assert.rejects(openAgenda(env, newPixelKey()));
  assert.ok(!validEnvelope({ ...env, extra: 1 })); assert.ok(!validEnvelope({ ...env, alg: 'none' }));
});
