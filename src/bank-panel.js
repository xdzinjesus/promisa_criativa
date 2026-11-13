// Aba "🏦 Extratos" do painel: importar extrato (OFX/CSV), ver entradas e saídas por mês e por categoria.
// Os dados ficam no estado do painel (S.bank, 1 registro por mês) e sincronizam como o resto (criptografados se o cofre estiver ligado).
import { CATEGORIES, NEUTRAL, PERIODS, cleanName, parseStatement, mergeImport, summary, categorize, keywordOf, applyRule, matchSale, toCSV, dashboard } from './bank.js';
import { renderDashboard } from './bank-dashboard.js';

const el = (tag, text, props = {}) => Object.assign(document.createElement(tag), text == null ? {} : { textContent: text }, props);
const R = n => (+n || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const MES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const monthName = id => `${MES[+id.slice(5) - 1]}/${id.slice(0, 4)}`;
const ui = { group: '', view: 'dash', period: 'mes', month: '', acc: '', kind: '', cat: '', q: '', note: '' };
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });

const state = () => window.promisaAdapter?.getState?.();
function months() { const s = state(); if (s && !Array.isArray(s.bank)) s.bank = []; return s?.bank || []; }
function rules() { const s = state(); return s?.bankRules && typeof s.bankRules === 'object' ? s.bankRules : {}; }
function persist() {
  const s = state(); if (!s) return;
  s.bank = months().filter(m => m.tx?.length);
  window.promisaAdapter.setState(s);
  window.promisaCloud?.changed();
}

async function importFiles(files, account, root) {
  const s = state(); if (!s) return;
  const notes = []; let total = 0, dup = 0;
  for (const file of files) {
    if (file.size > 15 * 1024 * 1024) { notes.push(`⚠️ ${file.name}: arquivo grande demais (máx. 15 MB).`); continue; }
    try {
      const buffer = await file.arrayBuffer();
      let text = new TextDecoder('utf-8').decode(buffer);
      if (text.includes('�')) text = new TextDecoder('windows-1252').decode(buffer); // bancos antigos (Itaú, BB, Caixa) usam esse formato
      const parsed = parseStatement(file.name, text, account);
      const out = mergeImport(months(), parsed, rules());
      s.bank = out.months; total += out.added; dup += out.dup;
      notes.push(`✅ ${file.name}: ${out.added} lançamento(s) novo(s)${out.dup ? `, ${out.dup} já estavam aqui` : ''}${out.full ? `, ${out.full} ignorados (limite do mês)` : ''}.`);
      if (out.added && !ui.month) ui.month = parsed.tx.map(t => t.d.slice(0, 7)).sort().pop();
    } catch (error) { notes.push(`⚠️ ${file.name}: ${error.message}`); }
  }
  persist();
  ui.note = notes.join('\n');
  draw(root);
}

function bars(list) {
  const box = el('div', null, { className: 'bank-bars' });
  const mx = Math.max(1, ...list.map(m => Math.max(m.s.entradas, m.s.saidas)));
  for (const m of list) {
    const col = el('div', null, { className: 'bank-bar', title: `${monthName(m.id)}: entradas ${R(m.s.entradas)} · saídas ${R(m.s.saidas)}` });
    const pair = el('div', null, { className: 'bank-pair' });
    pair.append(el('span', null, { className: 'in', style: `height:${(m.s.entradas / mx * 90).toFixed(1)}px` }), el('span', null, { className: 'out', style: `height:${(m.s.saidas / mx * 90).toFixed(1)}px` }));
    col.append(pair, el('small', monthName(m.id)));
    box.append(col);
  }
  return box;
}

function draw(root) {
  if (!root?.isConnected) return;
  const all = months(), s = state();
  root.replaceChildren();
  // Importar
  const imp = el(all.length ? 'details' : 'div', null, { className: 'card bank-import', open: Boolean(ui.note) });
  imp.append(all.length ? el('summary', '📥 Importar extrato (OFX ou CSV)') : el('b', '📥 Importar extrato'), el('p', 'No app ou site do seu banco, baixe o extrato em OFX (melhor) ou CSV e escolha o arquivo aqui. Pode escolher vários de uma vez. Lançamentos repetidos são ignorados.', { className: 'sub' }));
  const row = el('div', null, { className: 'row' });
  const acc = el('input', null, { placeholder: 'Nome da conta (opcional, ex.: Nubank PJ)', ariaLabel: 'Nome da conta', maxLength: 60 });
  const file = el('input', null, { type: 'file', accept: '.ofx,.csv,.txt', multiple: true, ariaLabel: 'Arquivo do extrato' });
  file.addEventListener('change', () => { if (file.files?.length) importFiles([...file.files], acc.value.trim(), root); });
  row.append(acc, file); imp.append(row);
  const how = el('details'); how.append(el('summary', 'Como baixar o extrato no meu banco?'));
  for (const [bank, path] of [['Nubank (conta)', 'No app, toque na área da Conta → procure "Exportar extrato" (ou digite "extrato" na busca do app) → escolha o período e o formato OFX ou CSV → o arquivo chega no seu e-mail. Baixe e escolha aqui.'], ['Nubank (cartão)', 'No app, toque em Cartão de crédito → Faturas → escolha a fatura → Exportar fatura (CSV). O painel acerta os sinais sozinho e ignora o pagamento da fatura, que já aparece na conta.'], ['Inter', 'App → Extrato → Exportar (ícone de compartilhar) → OFX ou CSV.'], ['Itaú', 'Internet Banking → Extrato → "Salvar em" → OFX (Money).'], ['Banco do Brasil', 'Internet Banking → Conta corrente → Extrato → "Salvar como" OFX.'], ['Caixa', 'Internet Banking → Extrato → Exportar → OFX.'], ['Bradesco / Santander / C6 / Mercado Pago', 'Procure "Extrato" → "Exportar" ou "Baixar" → OFX (ou CSV / Excel salvo como CSV).']]) how.append(el('p', `${bank}: ${path}`, { className: 'sub' }));
  imp.append(how);
  if (ui.note) imp.append(el('pre', ui.note, { className: 'bank-note' }));
  root.append(imp);
  if (!all.length) { root.append(el('div', 'Nenhum extrato ainda. Importe o primeiro arquivo acima.', { className: 'card sub' })); return; }

  if (!all.some(m => m.id === ui.month)) ui.month = all[0].id;
  const accounts = [...new Set(all.flatMap(m => m.tx.map(t => t.acc || 'Conta')))];
  if (ui.acc && !accounts.includes(ui.acc)) ui.acc = '';
  const byAcc = t => !ui.acc || (t.acc || 'Conta') === ui.acc;
  const sel = (label, value, options, on) => { const x = el('select', null, { ariaLabel: label }); for (const [v, t] of options) x.append(el('option', t, { value: v, selected: v === value })); x.addEventListener('change', () => on(x.value)); return x; };
  // Abas: Dashboard | Lançamentos
  const tabs = el('div', null, { className: 'bank-tabs', role: 'tablist' });
  for (const [id, label] of [['dash', '📊 Dashboard'], ['list', '📄 Lançamentos']]) {
    const b = el('button', label, { type: 'button', role: 'tab', className: ui.view === id ? 'on' : '', ariaSelected: String(ui.view === id) });
    b.addEventListener('click', () => { ui.view = id; draw(root); }); tabs.append(b);
  }
  root.append(tabs);
  if (ui.view === 'dash') {
    const top = el('div', null, { className: 'row bank-top' });
    top.append(sel('Período', ui.period, PERIODS, v => { ui.period = v; draw(root); }));
    if (accounts.length > 1) top.append(sel('Conta', ui.acc, [['', 'Todas as contas'], ...accounts.map(a => [a, a])], v => { ui.acc = v; draw(root); }));
    root.append(top);
    const box = el('div', null, { className: 'bank-dash' }); root.append(box);
    renderDashboard(box, dashboard(all, { period: ui.period, acc: ui.acc, today: today() }), {
      onCategory: cat => { ui.view = 'list'; ui.cat = cat; ui.q = ''; ui.group = ''; draw(root); },
      onSearch: (key, label) => { ui.view = 'list'; ui.group = key; ui.groupLabel = label; ui.q = ''; ui.cat = ''; draw(root); },
    });
    return;
  }
  // Filtros do topo
  const top = el('div', null, { className: 'row bank-top' });
  top.append(sel('Mês', ui.month, all.map(m => [m.id, monthName(m.id)]), v => { ui.month = v; draw(root); }));
  if (accounts.length > 1) top.append(sel('Conta', ui.acc, [['', 'Todas as contas'], ...accounts.map(a => [a, a])], v => { ui.acc = v; draw(root); }));
  root.append(top);

  const month = all.find(m => m.id === ui.month), tx = month.tx.filter(byAcc), sm = summary(tx);
  const kpis = el('div', null, { className: 'grid bank-kpis' });
  for (const [label, value, cls, sub] of [['Entradas', sm.entradas, 'pos', 'dinheiro que entrou'], ['Saídas', sm.saidas, 'neg', 'dinheiro que saiu'], ['Resultado do mês', sm.resultado, sm.resultado >= 0 ? 'pos' : 'neg', `${sm.count} lançamento(s)`]]) {
    const k = el('div', null, { className: 'card kpi' }); k.append(el('small', label), el('b', R(value), { className: cls }), el('small', sub)); kpis.append(k);
  }
  root.append(kpis);

  // Últimos 6 meses + para onde foi o dinheiro
  const grid = el('div', null, { className: 'grid bank-grid' });
  const last = all.slice(0, 6).reverse().map(m => ({ id: m.id, s: summary(m.tx.filter(byAcc)) }));
  const c1 = el('div', null, { className: 'card' }); c1.append(el('b', 'Últimos meses'), el('small', ' 🟩 entradas · 🟥 saídas'), bars(last)); grid.append(c1);
  const c2 = el('div', null, { className: 'card' }); c2.append(el('b', 'Para onde foi o dinheiro'));
  const outs = sm.gastosPorCategoria.map(c => ({ cat: c.cat, total: -c.total })), mxOut = Math.max(1, ...outs.map(c => -c.total));
  if (!outs.length) c2.append(el('p', 'Nenhuma saída neste mês.', { className: 'sub' }));
  for (const c of outs.slice(0, 8)) {
    const line = el('button', null, { type: 'button', className: 'bank-cat', title: 'Filtrar por esta categoria' });
    line.append(el('span', c.cat), el('b', R(-c.total)), el('i', null, { style: `width:${(-c.total / mxOut * 100).toFixed(1)}%` }));
    line.addEventListener('click', () => { ui.cat = c.cat; draw(root); });
    c2.append(line);
  }
  grid.append(c2); root.append(grid);

  // Lista de lançamentos
  const list = el('div', null, { className: 'card' });
  const fil = el('div', null, { className: 'row bank-filters' });
  const q = el('input', null, { type: 'search', placeholder: 'Buscar (ex.: pix, cliente, mercado)', value: ui.q, ariaLabel: 'Buscar lançamento' });
  q.addEventListener('input', () => { ui.q = q.value; drawRows(); });
  // Filtro vindo do dashboard ("Onde você mais gastou"): usa a mesma chave de agrupamento, não um texto solto.
  let chip = null;
  if (ui.group) {
    chip = el('button', `✕ ${ui.groupLabel || ui.group}`, { type: 'button', className: 'sec bank-chip', title: 'Tirar este filtro' });
    chip.addEventListener('click', () => { ui.group = ''; chip.remove(); drawRows(); });
  }
  if (chip) fil.append(chip);
  fil.append(q,
    sel('Tipo', ui.kind, [['', 'Entradas e saídas'], ['in', 'Só entradas'], ['out', 'Só saídas']], v => { ui.kind = v; drawRows(); }),
    sel('Categoria', ui.cat, [['', 'Todas as categorias'], ...CATEGORIES.map(c => [c, c])], v => { ui.cat = v; drawRows(); }));
  const actions = el('div', null, { className: 'bank-actions' });
  const exp = el('button', '⬇️ Baixar planilha do mês', { type: 'button', className: 'sec' });
  exp.addEventListener('click', () => { const a = el('a', null, { href: URL.createObjectURL(new Blob([toCSV(visible())], { type: 'text/csv;charset=utf-8' })), download: `extrato-${ui.month}.csv` }); document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 5000); });
  const del = el('button', '🗑️ Apagar este mês', { type: 'button', className: 'sec' });
  del.addEventListener('click', () => { if (!confirm(`Apagar todos os lançamentos de ${monthName(ui.month)}${ui.acc ? ' da conta ' + ui.acc : ''}? Dá para importar de novo depois.`)) return; month.tx = month.tx.filter(t => !byAcc(t)); persist(); ui.month = ''; draw(root); });
  actions.append(exp, del);
  const rows = el('div', null, { className: 'bank-rows' });
  list.append(el('b', `Lançamentos de ${monthName(ui.month)}`), fil, rows, actions);
  root.append(list);

  function visible() {
    const w = ui.q.trim().toLowerCase();
    return tx.filter(t => (!ui.group || keywordOf(t.desc) === ui.group) && (!ui.kind || (ui.kind === 'in' ? t.v > 0 : t.v < 0)) && (!ui.cat || t.cat === ui.cat) && (!w || `${t.desc} ${t.cat} ${t.note || ''}`.toLowerCase().includes(w)));
  }
  function drawRows() {
    rows.replaceChildren();
    const shown = visible();
    if (!shown.length) { rows.append(el('p', 'Nenhum lançamento com esses filtros.', { className: 'sub' })); return; }
    for (const t of shown.slice(0, 400)) {
      const item = el('div', null, { className: 'item bank-item' });
      const left = el('div');
      left.append(el('span', cleanName(t.desc), { title: t.desc }), el('br'), el('small', `${t.d.split('-').reverse().join('/')}${accounts.length > 1 ? ' · ' + (t.acc || 'Conta') : ''}`));
      const sale = matchSale(t, s.sales || []);
      if (sale) {
        const b = el('button', `✅ É o pagamento de ${sale.client || 'cliente'}? Marcar pago`, { type: 'button', className: 'sec bank-match' });
        b.addEventListener('click', () => { sale.paid = true; t.saleId = String(sale.id); persist(); window.promisaAdapter?.refresh?.(); });
        left.append(el('br'), b);
      }
      const right = el('div', null, { className: 'bank-right' });
      const cat = el('select', null, { ariaLabel: 'Categoria de ' + t.desc });
      for (const c of CATEGORIES) cat.append(el('option', c, { value: c, selected: c === t.cat }));
      cat.addEventListener('change', () => {
        t.cat = cat.value;
        const word = keywordOf(t.desc);
        if (word && confirm(`Sempre que aparecer "${word}", usar "${cat.value}"?`)) {
          s.bankRules = { ...rules(), [word]: cat.value };
          applyRule(months(), word, cat.value);
        }
        persist(); draw(root);
      });
      right.append(el('b', R(t.v), { className: NEUTRAL.has(t.cat) ? 'bank-neutral' : t.v >= 0 ? 'pos' : 'neg', title: NEUTRAL.has(t.cat) ? 'Fora dos totais' : '' }), cat);
      if (NEUTRAL.has(t.cat)) right.append(el('small', 'fora dos totais', { className: 'sub' }));
      item.append(left, right); rows.append(item);
    }
    if (shown.length > 400) rows.append(el('p', `Mostrando 400 de ${shown.length}. Use a busca ou os filtros para achar o resto.`, { className: 'sub' }));
  }
  drawRows();
}

export function mount(root) {
  if (!root) return;
  ui.note = '';
  draw(root);
}
// Para testes e para recategorizar quando você muda uma regra.
export const _internal = { categorize };
if (typeof window !== 'undefined') window.promisaBank = { mount };
