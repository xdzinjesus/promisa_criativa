import test from 'node:test';
import assert from 'node:assert/strict';
import { stats, periodStats, monthly, allSales, plateLink, newMove, validateProduct, STARTERS } from '../src/products.js';
import { validateEntry, validateState } from '../src/data-validation.js';

const placa = () => ({ id: 'p1', ...STARTERS[0], price: 49.9, minStock: 3, moves: [
  newMove('in', { d: '2026-11-01', qty: 10, total: 149 }, 'm1'),
  newMove('out', { d: '2026-11-05', qty: 2, total: 99.8, client: 'Barbearia', link: plateLink('instagram', '@barbearia.navalha'), paid: true }, 'm2'),
  newMove('out', { d: '2026-11-10', qty: 1, total: 49.9, client: 'Salão', paid: false }, 'm3'),
  newMove('adj', { d: '2026-11-11', qty: -1, note: 'quebrou' }, 'm4'),
] });

test('estoque, custo médio, lucro e a receber', () => {
  const s = stats(placa());
  assert.equal(s.stock, 6); assert.equal(s.unitCost, 14.9); assert.equal(s.outQty, 3);
  assert.equal(s.revenue, 149.7); assert.equal(s.cogs, 44.7); assert.equal(s.profit, 105); assert.equal(s.margin, 70);
  assert.equal(s.pending, 49.9); assert.equal(s.low, false);
  const p = placa(); p.moves.push(newMove('out', { d: '2026-11-12', qty: 3, total: 149.7 }, 'm5'));
  assert.equal(stats(p).stock, 3); assert.equal(stats(p).low, true, 'avisa no estoque mínimo');
});

test('resumo do mês, últimos meses e lista de vendas', () => {
  const list = [placa()];
  assert.deepEqual(periodStats(list, '2026-11-01', '2026-11-31'), { units: 3, sales: 2, revenue: 149.7, cogs: 44.7, profit: 105, pending: 49.9 });
  const m = monthly(list, 3, '2026-11-13'); assert.deepEqual(m.map(x => x.id), ['2026-09', '2026-10', '2026-11']); assert.equal(m[2].units, 3);
  const s = allSales(list); assert.equal(s[0].id, 'm3'); assert.equal(s[1].link, 'https://instagram.com/barbearia.navalha');
});

test('links para gravar na placa', () => {
  assert.equal(plateLink('instagram', '@loja.x'), 'https://instagram.com/loja.x');
  assert.equal(plateLink('instagram', 'instagram.com/loja_x/'), 'https://instagram.com/loja_x');
  assert.equal(plateLink('google', 'ChIJN1t_tDeuEmsRUsoyG83frY4'), 'https://search.google.com/local/writereview?placeid=ChIJN1t_tDeuEmsRUsoyG83frY4');
  assert.equal(plateLink('google', 'https://g.page/r/abc/review'), 'https://g.page/r/abc/review');
  assert.equal(plateLink('instagram', 'nome com espaço'), '');
  assert.equal(plateLink('google', 'javascript:alert(1)'), '');
});

test('validação do produto e sincronização', async () => {
  assert.doesNotThrow(() => validateEntry('products:p1', placa()));
  assert.throws(() => validateProduct({ ...placa(), extra: 1 }), /inesperado/);
  assert.throws(() => validateProduct({ ...placa(), moves: [{ ...placa().moves[0], qty: -5 }] }), /Quantidade/);
  assert.throws(() => validateProduct({ ...placa(), moves: [{ ...placa().moves[1], link: 'http://x' }] }), /Link/);
  assert.equal(validateState({ sales: [], exp: [], products: [placa()] }).products.length, 1);
  const { validKey } = await import('../lib/cloud-store.js');
  assert.equal(validKey('products:p1'), true);
});

test('fotos do produto: até 3, só imagem em data URL dentro do limite', async () => {
  const { MAX_IMAGES } = await import('../src/products.js');
  const img = 'data:image/jpeg;base64,' + 'A'.repeat(1000);
  assert.doesNotThrow(() => validateProduct({ ...placa(), images: [img, img] }));
  assert.throws(() => validateProduct({ ...placa(), images: Array(MAX_IMAGES + 1).fill(img) }), /Fotos/);
  assert.throws(() => validateProduct({ ...placa(), images: ['data:image/svg+xml;base64,AAAA'] }), /Fotos/, 'SVG não (pode ter código)');
  assert.throws(() => validateProduct({ ...placa(), images: ['https://site.com/x.jpg'] }), /Fotos/);
  assert.throws(() => validateProduct({ ...placa(), images: ['data:image/jpeg;base64,' + 'A'.repeat(300_001)] }), /Fotos/);
});
