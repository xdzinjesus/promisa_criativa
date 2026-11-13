// Aba "📦 Produtos físicos": estoque, compras, vendas (com o link gravado em cada placa), custo, lucro e quem falta pagar.
// Dados no estado do painel (S.products, 1 registro por produto), sincronizados e criptografados como o resto.
import { STARTERS, KINDS, stats, periodStats, monthly, allSales, plateLink, newMove } from './products.js';

const el = (tag, text, props = {}) => Object.assign(document.createElement(tag), text == null ? {} : { textContent: text }, props);
const R = n => (+n || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const MES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const br = d => d.split('-').reverse().join('/');
const ui = { open: '', filter: 'all' };

const state = () => window.promisaAdapter?.getState?.();
function products() { const s = state(); if (s && !Array.isArray(s.products)) s.products = []; return s?.products || []; }
function persist(root) {
  const s = state(); if (!s) return;
  for (const p of s.products) p.updatedAt = p.updatedAt || new Date().toISOString();
  window.promisaAdapter.setState(s); window.promisaCloud?.changed(); draw(root);
}
const touch = p => { p.updatedAt = new Date().toISOString(); };

// Formulário simples: campos → objeto
function form(fields, submitLabel, onSubmit) {
  const f = el('form', null, { className: 'pr-form' });
  const inputs = {};
  for (const [name, label, props = {}] of fields) {
    const lab = el('label'); lab.append(el('small', label));
    const input = props.options ? el('select') : el(props.type === 'textarea' ? 'textarea' : 'input', null, props.type === 'textarea' ? {} : { type: props.type || 'text' });
    if (props.options) for (const [v, t] of props.options) input.append(el('option', t, { value: v }));
    Object.assign(input, { name, ...Object.fromEntries(Object.entries(props).filter(([k]) => !['options', 'type'].includes(k))) });
    if (props.type === 'checkbox') { lab.className = 'pr-check'; lab.replaceChildren(input, el('span', label)); }
    else lab.append(input);
    inputs[name] = input; f.append(lab);
  }
  f.append(el('button', submitLabel, { type: 'submit' }));
  f.addEventListener('submit', e => { e.preventDefault(); const v = {}; for (const [k, i] of Object.entries(inputs)) v[k] = i.type === 'checkbox' ? i.checked : i.value; onSubmit(v, f); });
  return { f, inputs };
}

function copy(text, button) {
  navigator.clipboard?.writeText(text).then(() => { const t = button.textContent; button.textContent = 'Copiado ✓'; setTimeout(() => { button.textContent = t; }, 1500); }).catch(() => prompt('Copie:', text));
}

function productCard(p, root) {
  const s = stats(p);
  const card = el('div', null, { className: 'card pr-card' + (s.low ? ' is-low' : '') });
  const head = el('div', null, { className: 'pr-head' });
  const title = el('div'); title.append(el('b', `${p.emoji || '📦'} ${p.name}`), el('br'), el('small', `${KINDS[p.kind] || 'Outro'} · preço de venda ${p.price ? R(p.price) : 'não definido'}`, { className: 'sub' }));
  const stock = el('div', null, { className: 'pr-stock' }); stock.append(el('b', String(s.stock)), el('small', s.low ? '⚠️ estoque baixo' : 'em estoque'));
  head.append(title, stock); card.append(head);
  const nums = el('div', null, { className: 'pr-nums' });
  for (const [l, v] of [['Custo por unidade', s.unitCost ? R(s.unitCost) : '—'], ['Vendidas', String(s.outQty)], ['Faturado', R(s.revenue)], ['Lucro', R(s.profit) + (s.margin !== null ? ` (${s.margin}%)` : '')], ['A receber', R(s.pending)]]) {
    const n = el('div'); n.append(el('small', l), el('b', v)); nums.append(n);
  }
  card.append(nums);
  const bar = el('div', null, { className: 'pr-actions' });
  const panels = el('div');
  const toggle = (key, build) => { const b = el('button', key, { type: 'button', className: ui.open === p.id + key ? '' : 'sec' }); b.addEventListener('click', () => { ui.open = ui.open === p.id + key ? '' : p.id + key; draw(root); }); bar.append(b); if (ui.open === p.id + key) panels.append(build()); };

  toggle('💰 Vendi', () => {
    const box = el('div', null, { className: 'pr-panel' });
    const linkHint = p.kind === 'instagram' ? '@ do Instagram do cliente (ou link)' : p.kind === 'google' ? 'Place ID do Google (ou link de avaliação)' : 'Link (opcional)';
    const { f, inputs } = form([
      ['client', 'Cliente', { placeholder: 'Ex.: Barbearia Navalha', required: true, maxLength: 120 }],
      ['qty', 'Quantidade', { type: 'number', min: 1, step: 1, value: 1, required: true }],
      ['total', 'Valor total (R$)', { type: 'number', min: 0, step: '0.01', value: p.price || '', required: true }],
      ['d', 'Data', { type: 'date', value: today(), required: true }],
      ['link', linkHint, { placeholder: p.kind === 'instagram' ? '@barbearianavalha' : p.kind === 'google' ? 'ChIJ… ou https://g.page/r/…/review' : 'https://…' }],
      ['paid', 'Já recebi o pagamento', { type: 'checkbox', checked: true }],
    ], 'Registrar venda', v => {
      const link = plateLink(p.kind, v.link);
      if (v.link && !link) { alert('Esse link não parece certo. Para Instagram, digite o @; para Google, cole o link de avaliação (começa com https://).'); return; }
      if (Number(v.qty) > s.stock && !confirm(`O estoque é ${s.stock}. Registrar mesmo assim?`)) return;
      p.moves.push(newMove('out', { ...v, link }, uid())); touch(p); ui.open = ''; persist(root);
    });
    inputs.qty.addEventListener('input', () => { if (p.price) inputs.total.value = (p.price * (Number(inputs.qty.value) || 0)).toFixed(2); });
    box.append(f);
    if (p.kind === 'google') box.append(el('p', 'Para achar o link de avaliação: no Google, busque a empresa → "Pedir avaliações" (no Perfil da Empresa) → copie o link. Ou use o Place ID.', { className: 'sub' }));
    return box;
  });
  toggle('➕ Comprei / chegou', () => {
    const box = el('div', null, { className: 'pr-panel' });
    const { f } = form([
      ['qty', 'Quantidade que chegou', { type: 'number', min: 1, step: 1, value: 10, required: true }],
      ['total', 'Quanto paguei no total (R$, com frete)', { type: 'number', min: 0, step: '0.01', required: true, placeholder: 'Ex.: 149,00' }],
      ['d', 'Data', { type: 'date', value: today(), required: true }],
      ['note', 'Onde comprei (opcional)', { placeholder: 'Ex.: Mercado Livre', maxLength: 300 }],
    ], 'Registrar compra', v => { p.moves.push(newMove('in', v, uid())); touch(p); ui.open = ''; persist(root); });
    box.append(f, el('p', 'O custo por unidade é calculado sozinho (total ÷ quantidade, média de todas as compras).', { className: 'sub' }));
    return box;
  });
  toggle('🔧 Ajustar estoque', () => {
    const box = el('div', null, { className: 'pr-panel' });
    const { f } = form([
      ['qty', 'Quantas unidades a mais (+) ou a menos (−)', { type: 'number', step: 1, required: true, placeholder: 'Ex.: -1 (quebrou)' }],
      ['note', 'Motivo', { placeholder: 'Ex.: brinde, quebrou, contagem', maxLength: 300, required: true }],
      ['d', 'Data', { type: 'date', value: today(), required: true }],
    ], 'Salvar ajuste', v => { if (!Math.trunc(Number(v.qty))) return; p.moves.push(newMove('adj', v, uid())); touch(p); ui.open = ''; persist(root); });
    box.append(f); return box;
  });
  toggle('⚙️ Editar', () => {
    const box = el('div', null, { className: 'pr-panel' });
    const { f } = form([
      ['name', 'Nome', { value: p.name, required: true, maxLength: 80 }],
      ['emoji', 'Ícone', { value: p.emoji || '📦', maxLength: 8 }],
      ['kind', 'Tipo', { options: Object.entries(KINDS) }],
      ['price', 'Preço de venda por unidade (R$)', { type: 'number', min: 0, step: '0.01', value: p.price || '' }],
      ['minStock', 'Avisar quando o estoque chegar em', { type: 'number', min: 0, step: 1, value: p.minStock }],
      ['supplier', 'Fornecedor / link de recompra', { value: p.supplier || '', maxLength: 500 }],
    ], 'Salvar', v => {
      Object.assign(p, { name: v.name.trim().slice(0, 80), emoji: v.emoji.slice(0, 8) || '📦', kind: v.kind, price: Math.max(0, Number(v.price) || 0), minStock: Math.max(0, Math.trunc(Number(v.minStock) || 0)), supplier: v.supplier.trim().slice(0, 500) });
      touch(p); ui.open = ''; persist(root);
    });
    f.querySelector('select').value = p.kind || 'outro';
    const del = el('button', '🗑️ Apagar produto', { type: 'button', className: 'sec' });
    del.addEventListener('click', () => { if (!confirm(`Apagar "${p.name}" e todo o histórico dele?`)) return; const st = state(); st.products = st.products.filter(x => x.id !== p.id); persist(root); });
    box.append(f, del); return box;
  });
  card.append(bar, panels);
  if (p.supplier) { const a = /^https:\/\//i.test(p.supplier) ? el('a', '🛒 Comprar de novo', { href: p.supplier, target: '_blank', rel: 'noopener noreferrer' }) : el('small', '🛒 ' + p.supplier, { className: 'sub' }); card.append(a); }
  return card;
}

function salesList(list, root) {
  const card = el('div', null, { className: 'card' });
  const head = el('div', null, { className: 'pr-head' });
  head.append(el('b', '🧾 Vendas'));
  const sel = el('select', null, { ariaLabel: 'Filtrar vendas' });
  for (const [v, t] of [['all', 'Todas'], ['pending', 'Falta receber'], ['month', 'Este mês']]) sel.append(el('option', t, { value: v, selected: ui.filter === v }));
  sel.addEventListener('change', () => { ui.filter = sel.value; draw(root); });
  head.append(sel); card.append(head);
  const month = today().slice(0, 7);
  const shown = list.filter(m => ui.filter === 'pending' ? !m.paid : ui.filter === 'month' ? m.d.startsWith(month) : true);
  if (!shown.length) { card.append(el('p', 'Nenhuma venda aqui ainda.', { className: 'sub' })); return card; }
  for (const m of shown.slice(0, 200)) {
    const row = el('div', null, { className: 'item pr-sale' });
    const left = el('div');
    left.append(el('span', `${m.emoji || '📦'} ${m.client || 'Cliente'} · ${m.qty} un.`), el('br'), el('small', `${br(m.d)} · ${m.productName}`, { className: 'sub' }));
    if (m.link) {
      const b = el('button', '🔗 Copiar link da placa', { type: 'button', className: 'sec pr-mini', title: m.link });
      b.addEventListener('click', () => copy(m.link, b)); left.append(el('br'), b);
    }
    const right = el('div', null, { className: 'pr-right' });
    right.append(el('b', R(m.total), { className: m.paid ? 'pos' : 'warn' }));
    const pay = el('button', m.paid ? '✅ Pago' : '⏳ Marcar pago', { type: 'button', className: 'sec pr-mini' });
    pay.addEventListener('click', () => { const p = products().find(x => x.id === m.productId), mv = p?.moves.find(x => x.id === m.id); if (!mv) return; mv.paid = !mv.paid; touch(p); persist(root); });
    const del = el('button', '✕', { type: 'button', className: 'sec pr-mini', title: 'Apagar esta venda', ariaLabel: 'Apagar esta venda' });
    del.addEventListener('click', () => { if (!confirm('Apagar esta venda? O estoque volta.')) return; const p = products().find(x => x.id === m.productId); if (!p) return; p.moves = p.moves.filter(x => x.id !== m.id); touch(p); persist(root); });
    right.append(pay, del);
    row.append(left, right); card.append(row);
  }
  return card;
}

function draw(root) {
  if (!root?.isConnected) return;
  const list = products(), t = today(), month = t.slice(0, 7);
  root.replaceChildren();
  if (!list.length) {
    const c = el('div', null, { className: 'card' });
    c.append(el('b', 'Comece pelos seus produtos'), el('p', 'Crie as suas 2 placas (Instagram e avaliação do Google) com 1 toque. Depois é só lançar o que comprou e o que vendeu.', { className: 'sub' }));
    const b = el('button', '✨ Criar Placa Instagram e Placa Google', { type: 'button' });
    b.addEventListener('click', () => { const s = state(); s.products = STARTERS.map(x => ({ id: 'p' + uid(), ...x, moves: [], createdAt: new Date().toISOString() })); persist(root); });
    c.append(b); root.append(c);
  }
  if (list.length) {
    const m = periodStats(list, month + '-01', month + '-31'), all = periodStats(list);
    const stockTotal = list.reduce((n, p) => n + stats(p).stock, 0), low = list.filter(p => stats(p).low);
    const kpis = el('div', null, { className: 'grid pr-kpis' });
    for (const [l, v, sub, cls] of [['Em estoque', String(stockTotal), low.length ? `⚠️ ${low.length} produto(s) acabando` : 'unidades no total', ''], ['Vendidas este mês', String(m.units), `${m.sales} venda(s)`, ''], ['Faturado este mês', R(m.revenue), `lucro ${R(m.profit)}`, 'pos'], ['A receber', R(all.pending), 'vendas ainda não pagas', all.pending ? 'warn' : '']]) {
      const k = el('div', null, { className: 'card kpi' }); k.append(el('small', l), el('b', v, { className: cls }), el('small', sub)); kpis.append(k);
    }
    root.append(kpis);
    const grid = el('div', null, { className: 'grid pr-grid' });
    for (const p of list) grid.append(productCard(p, root));
    root.append(grid);
    // Últimos 6 meses
    const months = monthly(list, 6, t), mx = Math.max(1, ...months.map(x => x.revenue));
    const hist = el('div', null, { className: 'card' }); hist.append(el('b', 'Últimos 6 meses'));
    for (const x of months) {
      const row = el('div', null, { className: 'pr-month' });
      const name = `${MES[+x.id.slice(5) - 1]}/${x.id.slice(2, 4)}`;
      const track = el('div', null, { className: 'bd-track' }); track.append(el('i', null, { style: `width:${(x.revenue / mx * 100).toFixed(1)}%` }));
      row.append(el('span', name), track, el('small', `${x.units} un. · ${R(x.revenue)} · lucro ${R(x.profit)}`));
      hist.append(row);
    }
    const sales = allSales(list);
    root.append(salesList(sales, root), hist);
    const add = el('button', '➕ Novo produto', { type: 'button', className: 'sec' });
    add.addEventListener('click', () => { const name = (prompt('Nome do produto:') || '').trim(); if (!name) return; const s = state(); s.products.push({ id: 'p' + uid(), name: name.slice(0, 80), emoji: '📦', kind: 'outro', price: 0, minStock: 0, moves: [], createdAt: new Date().toISOString() }); persist(root); });
    root.append(add);
  }
  const help = el('details', null, { className: 'card pr-help' });
  help.append(el('summary', 'Como gravar o link na placa NFC?'));
  for (const step of ['1) No celular, instale o app gratuito "NFC Tools" (iPhone ou Android).', '2) Abra → Escrever → Adicionar um registro → URL / URI.', '3) Cole o link (botão "🔗 Copiar link da placa" na venda) → OK → Escrever.', '4) Encoste o celular na placa até aparecer "Concluído". Teste aproximando outro celular.', 'O QR Code impresso nas placas "dinâmicas" é configurado no site do vendedor da placa; se ele permitir, use o mesmo link.']) help.append(el('p', step, { className: 'sub' }));
  root.append(help);
}

export function mount(root) { if (root) draw(root); }
if (typeof window !== 'undefined') window.promisaProducts = { mount };
