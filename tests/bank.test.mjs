import test from 'node:test';
import assert from 'node:assert/strict';
import { parseOFX, parseCSV, parseStatement, parseMoney, parseDate, mergeImport, categorize, keywordOf, applyRule, summary, matchSale, toCSV, validateBankMonth } from '../src/bank.js';
import { validateEntry, validateState } from '../src/data-validation.js';

const OFX = `OFXHEADER:100
DATA:OFXSGML
<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><CURDEF>BRL<BANKACCTFROM><BANKID>0341<ACCTID>123456-7</BANKACCTFROM>
<BANKTRANLIST><DTSTART>20261101<DTEND>20261130
<STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20261103120000[-3:BRT]<TRNAMT>1500,00<FITID>A1<MEMO>PIX RECEBIDO JOAO SILVA
<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20261105<TRNAMT>-89.90<FITID>A2<MEMO>VERCEL INC
<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20261105<TRNAMT>-12.50<FITID>A3<MEMO>TARIFA PACOTE SERVICOS
<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20261020<TRNAMT>-300.00<FITID>A4<MEMO>DAS SIMPLES NACIONAL
</BANKTRANLIST><LEDGERBAL><BALAMT>2097,60<DTASOF>20261130</LEDGERBAL></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`;

test('lê valores e datas nos formatos dos bancos', () => {
  assert.equal(parseMoney('1.234,56'), 1234.56); assert.equal(parseMoney('R$ -12,30'), -12.3); assert.equal(parseMoney('(12,30)'), -12.3);
  assert.equal(parseMoney('-1234.5'), -1234.5); assert.equal(parseMoney('45,00 D'), -45); assert.ok(Number.isNaN(parseMoney('abc')));
  assert.equal(parseDate('03/11/2026'), '2026-11-03'); assert.equal(parseDate('20261103120000[-3:BRT]'), '2026-11-03'); assert.equal(parseDate('3/1/26'), '2026-01-03'); assert.equal(parseDate('31/02/2026'), '');
});

test('OFX (SGML): lançamentos, conta, saldo e categorias automáticas', () => {
  const r = parseOFX(OFX);
  assert.equal(r.account, 'Itaú · conta 3456-7'); assert.equal(r.balance, 2097.6); assert.equal(r.tx.length, 4);
  assert.deepEqual(r.tx.map(t => [t.d, t.v]), [['2026-11-03', 1500], ['2026-11-05', -89.9], ['2026-11-05', -12.5], ['2026-10-20', -300]]);
  const { months, added } = mergeImport([], r, {}, Date.parse('2026-11-30'));
  assert.equal(added, 4); assert.deepEqual(months.map(m => m.id), ['2026-11', '2026-10']);
  const cats = Object.fromEntries(months.flatMap(m => m.tx).map(t => [t.desc, t.cat]));
  assert.equal(cats['PIX RECEBIDO JOAO SILVA'], 'Recebimentos'); assert.equal(cats['VERCEL INC'], 'Ferramentas e hospedagem');
  assert.equal(cats['TARIFA PACOTE SERVICOS'], 'Tarifas bancárias'); assert.equal(cats['DAS SIMPLES NACIONAL'], 'Impostos');
  for (const m of months) assert.doesNotThrow(() => validateEntry('bank:' + m.id, m));
  // Importar de novo não duplica
  const again = mergeImport(months, parseOFX(OFX));
  assert.equal(again.added, 0); assert.equal(again.dup, 4);
});

test('CSV do Nubank (vírgula) e do Inter (ponto e vírgula, linhas antes do cabeçalho)', () => {
  const nu = parseCSV('Data,Valor,Identificador,Descrição\n03/11/2026,250.00,abc,Transferência recebida pelo Pix - MARIA\n04/11/2026,-49.90,def,Compra no débito - CANVA\n04/11/2026,-49.90,ghi,Compra no débito - CANVA', 'Nubank PJ');
  assert.equal(nu.tx.length, 3); assert.equal(nu.account, 'Nubank PJ');
  assert.equal(nu.tx[0].desc, 'Transferência recebida pelo Pix - MARIA', 'usa a coluna Descrição, não o Identificador');
  assert.notEqual(nu.tx[1].id, nu.tx[2].id, 'duas compras iguais no mesmo dia continuam sendo duas');
  const inter = parseCSV('Extrato Conta Corrente\nConta ;12345\nPeríodo ;01/11/2026 a 30/11/2026\n\nData Lançamento;Histórico;Descrição;Valor;Saldo\n05/11/2026;Pix recebido;Cliente X;1.200,00;3.000,00\n06/11/2026;Pagamento efetuado;Boleto Luz;-180,35;2.819,65\n06/11/2026;Saldo do dia;;0;2.819,65');
  assert.deepEqual(inter.tx.map(t => t.v), [1200, -180.35]);
  const deb = parseCSV('Data;Histórico;Crédito;Débito\n01/11/2026;Depósito;100,00;\n02/11/2026;Tarifa;;5,00');
  assert.deepEqual(deb.tx.map(t => t.v), [100, -5]);
  assert.throws(() => parseCSV('a;b\n1;2'), /colunas/);
  assert.equal(parseStatement('extrato.ofx', OFX).tx.length, 4);
});

test('regras do dono, resumo do mês, conciliação com venda e planilha', () => {
  const { months } = mergeImport([], parseCSV('Data;Descrição;Valor\n03/11/2026;PIX ENVIADO ACADEMIA FIT 123;-120,00\n10/11/2026;PIX RECEBIDO MARIA;800,00\n12/11/2026;PIX ENVIADO ACADEMIA FIT 999;-120,00', 'Conta'));
  assert.equal(keywordOf('PIX ENVIADO ACADEMIA FIT 123'), 'academia fit');
  assert.equal(keywordOf('Pix enviado - ACADEMIA FIT 123'), 'academia fit');
  assert.equal(applyRule(months, 'academia fit', 'Pessoal'), 2);
  assert.equal(categorize('Pix enviado Academia Fit 555', -120, { 'academia fit': 'Pessoal' }), 'Pessoal');
  const s = summary(months[0].tx);
  assert.equal(s.entradas, 800); assert.equal(s.saidas, 240); assert.equal(s.resultado, 560);
  assert.deepEqual(s.porCategoria.find(c => c.cat === 'Pessoal'), { cat: 'Pessoal', total: -240 });
  const sales = [{ id: 'v1', client: 'Maria', value: 800, stage: 'Fechado', paid: false, date: '2026-11-01' }, { id: 'v2', value: 800, stage: 'Proposta enviada', paid: false }];
  const rec = months[0].tx.find(t => t.v > 0);
  assert.equal(matchSale(rec, sales).id, 'v1'); assert.equal(matchSale(rec, [{ ...sales[0], paid: true }]), null);
  assert.match(toCSV(months[0].tx), /^﻿Data;Descrição;Conta;Categoria;Valor\n12\/11\/2026;PIX ENVIADO ACADEMIA FIT 999;Conta;Pessoal;-120,00/);
});

test('validação: mês, campos e regras', () => {
  const ok = { id: '2026-11', month: '2026-11', tx: [{ id: 'h:x', d: '2026-11-03', desc: 'X', v: -1, cat: 'Outras saídas', acc: 'C' }] };
  assert.doesNotThrow(() => validateBankMonth(structuredClone(ok)));
  assert.throws(() => validateBankMonth({ ...ok, tx: [{ ...ok.tx[0], d: '2026-10-03' }] }), /Data/);
  assert.throws(() => validateBankMonth({ ...ok, tx: [{ ...ok.tx[0], cat: 'Inventada' }] }), /categoria/);
  assert.throws(() => validateBankMonth({ ...ok, tx: [{ ...ok.tx[0], extra: 1 }] }), /inesperado/);
  assert.throws(() => validateEntry('bank:2026-13', { ...ok, id: '2026-13' }));
  const state = validateState({ sales: [], exp: [], bank: [ok], bankRules: { academia: 'Pessoal' } });
  assert.equal(state.bank.length, 1);
  assert.throws(() => validateState({ sales: [], exp: [], bankRules: { x: 'Inventada' } }), /Regra/);
});

test('sincronização online aceita o registro mensal do extrato', async () => {
  const { validKey } = await import('../lib/cloud-store.js');
  assert.equal(validKey('bank:2026-11'), true);
  assert.equal(validKey('banco:2026-11'), false);
});

test('dashboard: período, comparação justa, séries, maiores gastos e Nubank', async () => {
  const { periodRange, dashboard, cleanName, keywordOf: kw } = await import('../src/bank.js');
  assert.deepEqual(periodRange('mes', '2026-11-13'), { from: '2026-11-01', to: '2026-11-30', prevFrom: '2026-10-01', prevTo: '2026-10-13', months: 1 });
  assert.deepEqual(periodRange('mespassado', '2026-11-13'), { from: '2026-10-01', to: '2026-10-31', prevFrom: '2026-09-01', prevTo: '2026-09-30', months: 1 });
  const r3 = periodRange('3m', '2026-03-31'); assert.equal(r3.from, '2026-01-01'); assert.equal(r3.prevFrom, '2025-10-01');
  const ano = periodRange('ano', '2026-11-13'); assert.equal(ano.prevFrom, '2025-01-01'); assert.equal(ano.prevTo, '2025-11-13');
  assert.equal(cleanName('Transferência recebida pelo Pix - CLIENTE ANA'), 'CLIENTE ANA');
  assert.equal(kw('Transferência recebida pelo Pix - CLIENTE ANA'), 'cliente ana');
  assert.notEqual(kw('Transferência recebida pelo Pix - CLIENTE ANA'), kw('Transferência recebida pelo Pix - CLIENTE BRUNO'));
  const conta = parseCSV('Data,Valor,Identificador,Descrição\n02/10/2026,500.00,6512aa00-1,Transferência recebida pelo Pix - CLIENTE ANA\n03/11/2026,1000.00,6512aa00-2,Transferência recebida pelo Pix - CLIENTE ANA\n05/11/2026,-200.00,6512aa00-3,Pagamento de fatura\n20/11/2026,-50.00,6512aa00-4,Compra no débito - CANVA');
  assert.equal(conta.account, 'Nubank'); assert.equal(conta.tx[0].id.startsWith('o:'), true, 'usa o Identificador do Nubank');
  const cartao = parseCSV('date,title,amount\n2026-11-02,Ifood,58.90\n2026-11-06,Pagamento recebido,-500.00');
  assert.equal(cartao.account, 'Nubank cartão'); assert.deepEqual(cartao.tx.map(t => t.v), [-58.9], 'compras viram saídas; pagamento da fatura é ignorado');
  let { months } = mergeImport([], conta); ({ months } = mergeImport(months, cartao));
  const d = dashboard(months, { period: 'mes', today: '2026-11-13' });
  assert.equal(d.summary.entradas, 1000); assert.equal(d.summary.saidas, 308.9, 'o mês inteiro que já está no extrato');
  assert.equal(d.delta.entradas, 100, 'comparado com 1 a 13/10');
  assert.deepEqual(d.series.map(s => s.id), ['2026-11']);
  assert.equal(d.topEntradas[0].label, 'CLIENTE ANA');
  assert.equal(d.categorias.find(c => c.cat === 'Fatura do cartão').total, 200);
  const all = dashboard(months, { period: 'tudo', today: '2026-11-13' });
  assert.deepEqual(all.series.map(s => s.id), ['2026-10', '2026-11']); assert.equal(all.saldo.at(-1).v, 1191.1);
});
