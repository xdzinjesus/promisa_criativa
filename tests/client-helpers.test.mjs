import test from 'node:test';
import assert from 'node:assert/strict';
import { formatPhoneBR, whatsappLink, formatBRL, followUpMessage, nextClientAction, needsAction, clientSummary, isActiveStage } from '../src/client-helpers.js';

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse('2026-11-10T12:00:00Z');

test('formatPhoneBR aplica a máscara brasileira com ou sem 55', () => {
  assert.equal(formatPhoneBR('49988240164'), '(49) 98824-0164');
  assert.equal(formatPhoneBR('5549988240164'), '(49) 98824-0164');
  assert.equal(formatPhoneBR('4934426343'), '(49) 3442-6343');
  assert.equal(formatPhoneBR('+55 (49) 3442-6343'), '(49) 3442-6343');
  assert.equal(formatPhoneBR(' 12345 '), '12345');
  assert.equal(formatPhoneBR('+1 415 555 0100 22'), '+1 415 555 0100 22');
  assert.equal(formatPhoneBR(''), '');
  assert.equal(formatPhoneBR(null), '');
});

test('whatsappLink segue a regra do painel e codifica a mensagem', () => {
  assert.equal(whatsappLink('49 98824-0164'), 'https://wa.me/5549988240164');
  assert.equal(whatsappLink('5549988240164'), 'https://wa.me/5549988240164');
  assert.equal(whatsappLink(''), '');
  assert.equal(whatsappLink('49988240164', 'Oi & tchau'), 'https://wa.me/5549988240164?text=Oi%20%26%20tchau');
});

test('formatBRL usa reais sem centavos', () => {
  assert.equal(formatBRL(1800).replace(/\s/g, ' '), 'R$ 1.800');
  assert.equal(formatBRL('abc').replace(/\s/g, ' '), 'R$ 0');
});

test('followUpMessage inclui nome e link quando existem', () => {
  assert.equal(followUpMessage({ client: 'Padaria', demoUrl: 'https://x.test/demo/a/' }), 'Oi, Padaria! Conseguiu ver a demonstração do seu site? https://x.test/demo/a/');
  assert.equal(followUpMessage({}), 'Oi! Conseguiu ver a demonstração do seu site?');
});

test('nextClientAction respeita a ordem de prioridade', () => {
  const base = { id: 'a1', client: 'Loja', contact: '49988240164' };
  const key = (lead, ctx) => nextClientAction(lead, { now: NOW, ...ctx })?.key ?? null;
  assert.equal(key({ ...base, stage: 'Perdido' }, { stage: 'Perdido', siteId: 's' }), null);
  assert.equal(key({ ...base, stage: 'Fechado', paid: false }, { stage: 'Fechado' }), 'pay');
  assert.equal(key({ ...base, stage: 'Fechado', paid: true }, { stage: 'Fechado', entrega: { total: 8, complete: false } }), 'entregas');
  assert.equal(key({ ...base, stage: 'Fechado', paid: true }, { stage: 'Fechado', entrega: { total: 8, complete: true } }), 'attach');
  assert.equal(key({ ...base, stage: 'Novo' }, { stage: 'Novo' }), 'attach');
  assert.equal(key({ ...base, stage: 'Novo' }, { stage: 'Novo', siteId: 's', demoReady: true }), 'demo');
  assert.equal(key({ ...base, contact: '', stage: 'Novo' }, { stage: 'Novo', siteId: 's' }), 'phone');
  const sentOld = new Date(NOW - 3 * DAY).toISOString(), sentNew = new Date(NOW - DAY).toISOString();
  assert.equal(key({ ...base, stage: 'Em contato', demoSentAt: sentOld }, { stage: 'Em contato', siteId: 's', demoReady: true }), 'followup');
  assert.equal(key({ ...base, stage: 'Em contato', demoSentAt: sentNew }, { stage: 'Em contato', siteId: 's', demoReady: true }), 'view');
  assert.equal(key({ ...base, stage: 'Fechado', paid: true, demoSentAt: sentOld }, { stage: 'Fechado', siteId: 's', demoReady: true }), 'view');
});

test('nextClientAction devolve o clique e os argumentos certos', () => {
  const lead = { id: 'x"1', client: 'Ana', contact: '49988240164', stage: 'Novo', demoUrl: 'https://x.test/demo/t/', demoSentAt: new Date(NOW - 5 * DAY).toISOString() };
  assert.deepEqual(nextClientAction({ ...lead, demoSentAt: undefined }, { stage: 'Novo' }), { key: 'attach', label: '＋ Anexar site', click: 'openClientSheet', args: ['x"1', 'site'] });
  assert.deepEqual(nextClientAction({ ...lead, stage: 'Fechado' }, { stage: 'Fechado' }), { key: 'pay', label: '💰 Marcar como pago', click: 'pay', args: ['x"1'] });
  assert.deepEqual(nextClientAction(lead, { stage: 'Novo', siteId: 'site9', demoReady: true, now: NOW - 6 * DAY }), { key: 'view', label: '👁 Ver site', click: 'openClientSite', args: ['site9'] });
  const follow = nextClientAction(lead, { stage: 'Novo', siteId: 'site9', demoReady: true, now: NOW });
  assert.equal(follow.key, 'followup');
  assert.match(follow.href, /^https:\/\/wa\.me\/5549988240164\?text=Oi%2C%20Ana!/);
  assert.equal(nextClientAction(null), null);
});

test('needsAction só conta passos que pedem uma atitude', () => {
  for (const key of ['pay', 'attach', 'demo', 'phone', 'followup']) assert.equal(needsAction({ key }), true);
  for (const key of ['view', 'entregas']) assert.equal(needsAction({ key }), false);
  assert.equal(needsAction(null), false);
});

test('clientSummary soma negociação, a receber e quem precisa de ação', () => {
  const leads = [
    { stage: 'Novo', value: 1000 }, { stage: 'Proposta enviada', value: '800' },
    { stage: 'Fechado', value: 1800, paid: false }, { stage: 'Fechado', value: 500, paid: true },
    { stage: 'Perdido', value: 9999 }
  ];
  const actions = new Map([[leads[0], { key: 'attach' }], [leads[2], { key: 'pay' }], [leads[3], { key: 'view' }]]);
  assert.deepEqual(clientSummary(leads, l => l.stage, l => actions.get(l)), { negotiation: 1800, receivable: 1800, needAction: 2 });
  assert.deepEqual(clientSummary(null), { negotiation: 0, receivable: 0, needAction: 0 });
  assert.equal(isActiveStage('Em contato'), true);
  assert.equal(isActiveStage('Fechado'), false);
});
