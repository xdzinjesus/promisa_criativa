// Extratos bancários: leitura de arquivos OFX/CSV, categorias e resumos. Módulo puro (sem DOM): roda no navegador e nos testes.
// Os lançamentos ficam agrupados por mês (1 registro por mês), para a sincronização online gastar pouco.

export const CATEGORIES = ['Recebimentos', 'Vendas no cartão', 'Transferências recebidas', 'Outras entradas', 'Impostos', 'Tarifas bancárias', 'Anúncios', 'Ferramentas e hospedagem', 'Fornecedores', 'Salários e pró-labore', 'Fatura do cartão', 'Transferências enviadas', 'Pessoal', 'Outras saídas'];
export const INCOME = new Set(['Recebimentos', 'Vendas no cartão', 'Transferências recebidas', 'Outras entradas']);
export const MAX_TX_PER_MONTH = 3000;
export const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const DAY = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

const clean = (text, max = 300) => String(text ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
export const norm = text => clean(text).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

// "1.234,56" · "-1234.56" · "R$ -12,30" · "(12,30)" · "12,30 D" → número com sinal
export function parseMoney(raw) {
  let s = String(raw ?? '').trim();
  if (!s) return NaN;
  const bare = s.replace(/R\$|\s/g, '');
  const negative = /^\(.*\)$/.test(bare) || /^-|-$|D$/i.test(bare);
  s = bare.replace(/[()]/g, '').replace(/[CD]$/i, '').replace(/^\+/, '').replace(/^-|-$/g, '');
  if (/,\d{1,2}$/.test(s)) s = s.replace(/\./g, '').replace(',', '.');
  else s = s.replace(/,/g, '');
  const n = Number(s);
  if (!Number.isFinite(n)) return NaN;
  return Math.round((negative ? -n : n) * 100) / 100;
}
// "03/11/2026" · "2026-11-03" · "20261103..." (OFX) · "03/11/26" → "2026-11-03"
export function parseDate(raw) {
  const s = String(raw ?? '').trim();
  let m = /^(\d{4})(\d{2})(\d{2})/.exec(s) || /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  let out = m ? `${m[1]}-${m[2]}-${m[3]}` : '';
  if (!out && (m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/.exec(s))) out = `${m[3].length === 2 ? '20' + m[3] : m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  if (!DAY.test(out)) return '';
  const t = new Date(out + 'T12:00:00Z');
  return t.toISOString().slice(0, 10) === out ? out : ''; // 31/02 não existe
}

// Identificador estável: o FITID do banco (OFX) ou um resumo de data + valor + descrição + ordem no dia.
function hash(text) { let h = 2166136261; for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36); }
// Código do banco usado como está quando já é seguro; senão vira um resumo do código inteiro (nada é cortado ou removido).
const fitKey = f => /^[\w.-]{1,90}$/.test(f) ? f : 'x' + hash(f) + hash('~' + f) + f.length.toString(36);
const safeId = text => String(text).replace(/[^\w.:-]/g, '').slice(0, 120);
function withIds(list, account, { byAccount = true } = {}) {
  const seen = new Map();
  return list.map(t => {
    const base = `${t.d}|${t.v}|${norm(t.desc)}`, n = (seen.get(base) || 0) + 1; seen.set(base, n);
    const id = t.fitid ? `o:${hash(account)}:${fitKey(t.fitid)}` : safeId(`h:${byAccount ? hash(account) : 'csv'}:${hash(base + '|' + n)}`);
    const { fitid, ...rest } = t;
    return { ...rest, id };
  });
}

// Código do banco (OFX) → nome que aparece no painel.
export const BANKS = { 260: 'Nubank', 77: 'Inter', 341: 'Itaú', 1: 'Banco do Brasil', 104: 'Caixa', 237: 'Bradesco', 33: 'Santander', 336: 'C6 Bank', 323: 'Mercado Pago', 756: 'Sicoob', 748: 'Sicredi', 290: 'PagBank', 380: 'PicPay', 212: 'Banco Original', 655: 'Neon', 403: 'Cora', 197: 'Stone', 208: 'BTG', 422: 'Safra' };
// OFX (Itaú, BB, Caixa, Bradesco, Santander, Inter, Nubank, C6, Sicoob…): SGML sem fechamento ou XML.
export function parseOFX(text) {
  const src = String(text || '');
  if (!/<OFX>/i.test(src) || !/<STMTTRN>/i.test(src)) throw new Error('Este arquivo não parece um extrato OFX.');
  const tag = (block, name) => { const m = new RegExp(`<${name}>([^<\\r\\n]*)`, 'i').exec(block); return m ? m[1].trim() : ''; };
  const bank = tag(src, 'BANKID') || tag(src, 'ORG'), acct = tag(src, 'ACCTID');
  const account = clean([bank && (BANKS[bank.replace(/^0+/, '')] || 'Banco ' + bank), acct && 'conta ' + acct.slice(-6)].filter(Boolean).join(' · '), 60) || 'Conta';
  const list = [];
  for (const m of src.matchAll(/<STMTTRN>([\s\S]*?)(?=<\/STMTTRN>|<STMTTRN>|<\/BANKTRANLIST>)/gi)) {
    const b = m[1], d = parseDate(tag(b, 'DTPOSTED')), v = parseMoney(tag(b, 'TRNAMT'));
    if (!d || !Number.isFinite(v)) continue;
    const desc = clean([tag(b, 'NAME'), tag(b, 'MEMO')].filter((x, i, a) => x && a.indexOf(x) === i).join(' — ')) || clean(tag(b, 'TRNTYPE')) || 'Lançamento';
    list.push({ d, v, desc, fitid: tag(b, 'FITID') });
  }
  const balance = parseMoney(tag(src.split(/<LEDGERBAL>/i)[1] || '', 'BALAMT'));
  return { account, tx: withIds(list, account), balance: Number.isFinite(balance) ? balance : null };
}

// CSV: acha sozinho as colunas de data, descrição e valor (ou crédito/débito). Separador ; , ou tab.
function splitCsvLine(line, sep) {
  const out = []; let cur = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) { if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c; }
    else if (c === '"') q = true; else if (c === sep) { out.push(cur); cur = ''; } else cur += c;
  }
  out.push(cur); return out.map(s => s.trim());
}
export function parseCSV(text, account = '') {
  const lines = String(text || '').replace(/^﻿/, '').split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) throw new Error('O arquivo CSV está vazio.');
  const head = lines.slice(0, 15);
  const sep = [';', '\t', ','].map(s => [s, head.reduce((t, l) => t + splitCsvLine(l, s).length, 0)]).sort((a, b) => b[1] - a[1])[0][0];
  const find = (cols, re) => cols.findIndex(c => re.test(norm(c)));
  const first = (cols, list) => { for (const re of list) { const i = find(cols, re); if (i >= 0) return i; } return -1; }; // em ordem de preferência ("Descrição" antes de "Identificador")
  let hi = -1, col = {};
  for (let i = 0; i < head.length; i++) {
    const cols = splitCsvLine(lines[i], sep);
    const c = { id: find(cols, /^identificador$/), d: find(cols, /^(data|date|dt)\b|data (do )?lanc|data mov/), desc: first(cols, [/descri/, /historico/, /title|titulo|estabelecimento|detalhe|memo/, /lancamento/]), v: find(cols, /^valor|amount|^value|valor \(r\$\)|quantia/), cr: find(cols, /credito|entrada/), db: find(cols, /debito|saida/) };
    if (c.d >= 0 && (c.v >= 0 || (c.cr >= 0 && c.db >= 0))) { hi = i; col = c; col.names = cols.map(norm).join(','); break; }
  }
  if (hi < 0) throw new Error('Não achei as colunas de data e valor neste CSV. Prefira o arquivo OFX do banco.');
  // Nubank: conta = "Data,Valor,Identificador,Descrição"; fatura do cartão = "date,title,amount" (compras vêm positivas).
  const nuConta = col.names === 'data,valor,identificador,descricao', nuCartao = col.names === 'date,title,amount';
  const list = [];
  for (const line of lines.slice(hi + 1)) {
    const cols = splitCsvLine(line, sep), d = parseDate(cols[col.d]);
    if (!d) continue;
    let v = col.v >= 0 ? parseMoney(cols[col.v]) : NaN;
    if (!Number.isFinite(v)) { const cr = parseMoney(cols[col.cr]), db = parseMoney(cols[col.db]); v = Number.isFinite(cr) && cr ? Math.abs(cr) : Number.isFinite(db) && db ? -Math.abs(db) : NaN; }
    if (!Number.isFinite(v) || v === 0) continue;
    const desc = clean(col.desc >= 0 ? cols[col.desc] : '') || 'Lançamento';
    if (nuCartao) { if (/^pagamento recebido/.test(norm(desc))) continue; v = -v; } // pagar a fatura já aparece no extrato da conta
    if (/^saldo\b/i.test(norm(desc))) continue; // linhas de saldo do dia não são lançamentos
    list.push({ d, v, desc, fitid: col.id >= 0 && /^[\w-]{8,80}$/.test(cols[col.id] || '') ? cols[col.id] : '' });
  }
  if (!list.length) throw new Error('Não encontrei lançamentos neste CSV.');
  const acc = clean(account, 60) || (nuConta ? 'Nubank' : nuCartao ? 'Nubank cartão' : 'Conta');
  // O nome da conta não entra no identificador: importar o mesmo período com outro nome não duplica.
  return { account: acc, tx: withIds(list, nuConta ? 'nubank' : nuCartao ? 'nubank-cartao' : acc, { byAccount: false }), balance: null, kind: nuConta ? 'nubank' : nuCartao ? 'nubank-cartao' : 'csv' };
}
export function parseStatement(name, text, account) {
  if (/\.ofx$/i.test(name) || /<OFX>/i.test(text)) { const r = parseOFX(text); if (account) { r.account = clean(account, 60); } return r; }
  return parseCSV(text, account);
}

// Categorias: primeiro as regras que você criou (palavra → categoria), depois as automáticas.
const AUTO = [
  [/tarifa|iof\b|juros|anuidade|cesta de servicos|manutencao de conta|encargo/, 'Tarifas bancárias', 'out'],
  [/\bdarf\b|\bdas\b|simples nacional|\binss\b|imposto|receita federal|\biss\b|\bgps\b|sefaz|prefeitura/, 'Impostos', 'out'],
  [/facebk|facebook|meta ads|meta platforms|instagram|google ads|googleads|tiktok ads|linkedin ads/, 'Anúncios', 'out'],
  [/vercel|cloudflare|hostinger|hostgator|locaweb|registro\.?br|godaddy|github|google (one|workspace|cloud|storage)|canva|adobe|openai|chatgpt|anthropic|claude|notion|figma|microsoft|spotify|apple\.com|icloud|zoom|dropbox|wix|shopify|nuvemshop/, 'Ferramentas e hospedagem', 'out'],
  [/salario|pro-?labore|folha/, 'Salários e pró-labore', 'out'],
  [/pagamento de fatura|fatura (do )?cartao|pagto fatura|pgto fatura/, 'Fatura do cartão', 'out'],
  [/cielo|stone|rede\b|getnet|pagseguro|pagbank|mercado ?pago|sumup|infinitepay|ton\b|vendas? (no )?cartao|antecipacao/, 'Vendas no cartão', 'in'],
  [/pix recebido|pix - recebido|recebimento|transf(erencia)?\.? recebida|ted recebida|doc recebido|deposito|credito em conta|boleto recebido|liquidacao de boleto/, 'Recebimentos', 'in'],
  [/pix enviado|pix - enviado|transf(erencia)?\.? (enviada|realizada)|ted enviada|doc enviado|pagamento de boleto|pagto|pagamento/, 'Transferências enviadas', 'out'],
];
export function categorize(desc, v, rules = {}) {
  const text = norm(desc);
  for (const [word, cat] of Object.entries(rules || {})) if (word && text.includes(word) && CATEGORIES.includes(cat)) return cat;
  for (const [re, cat, side] of AUTO) if (re.test(text) && (side === 'in' ? v > 0 : v < 0)) return cat;
  if (v > 0 && /pix|transf|ted|doc/.test(text)) return 'Transferências recebidas';
  return v > 0 ? 'Outras entradas' : 'Outras saídas';
}
// Nome "limpo" do lançamento: tira o começo padrão dos bancos ("Transferência recebida pelo Pix - ", "Compra no débito - "…).
const PREFIX = /^(transferencias? (recebidas?|enviadas?)( pelo pix)?|pix (recebido|enviado)|compra no debito( via nupay)?|compra no credito|pagamento de boleto efetuado|pagamento efetuado|pagamento de|debito automatico|ted (recebida|enviada)|doc (recebido|enviado))\s*[-–:]\s*/;
export function cleanName(desc) {
  const text = clean(desc), n = norm(text), m = PREFIX.exec(n);
  return m ? text.slice(m[0].length).trim() || text : text;
}
// Palavra-chave para "sempre que aparecer…" e para agrupar: o nome limpo, sem números, datas e códigos.
export function keywordOf(desc) {
  return norm(cleanName(desc)).replace(/\d[\d./:-]*/g, ' ').replace(/[^\p{L}\s&.-]/gu, ' ').replace(/\b(pix|ted|doc|enviado|enviada|recebido|recebida|transferencia|pagamento|compra|debito|credito|pelo|pela|de|da|do|para|em|no|na)\b/g, ' ').split(/\s+/).filter(w => /[\p{L}\d]/u.test(w)).slice(0, 3).join(' ').slice(0, 60); // só palavras de verdade (sem "-" solto)
}

// Junta um extrato novo aos meses guardados, sem repetir lançamentos. months: [{ id:'2026-11', month, tx:[…] }]
export function mergeImport(months, parsed, rules = {}, now = Date.now()) {
  const byMonth = new Map((months || []).map(m => [m.id, { ...m, tx: [...(m.tx || [])] }]));
  let added = 0, dup = 0, full = 0;
  const known = new Set();
  for (const m of byMonth.values()) for (const t of m.tx) known.add(t.id);
  for (const t of parsed.tx) {
    if (known.has(t.id)) { dup++; continue; }
    const id = t.d.slice(0, 7);
    const m = byMonth.get(id) || { id, month: id, tx: [] };
    if (m.tx.length >= MAX_TX_PER_MONTH) { full++; continue; }
    m.tx.push({ id: t.id, d: t.d, desc: t.desc, v: t.v, cat: categorize(t.desc, t.v, rules), acc: parsed.account });
    m.updatedAt = new Date(now).toISOString(); byMonth.set(id, m); known.add(t.id); added++;
  }
  for (const m of byMonth.values()) m.tx.sort((a, b) => a.d < b.d ? 1 : a.d > b.d ? -1 : 0);
  return { months: [...byMonth.values()].sort((a, b) => a.id < b.id ? 1 : -1), added, dup, full };
}
// Aplica uma regra nova a todos os lançamentos que combinam (devolve quantos mudaram).
export function applyRule(months, word, cat) {
  let changed = 0; const w = norm(word);
  if (!w || !CATEGORIES.includes(cat)) return 0;
  for (const m of months || []) for (const t of m.tx || []) if (norm(t.desc).includes(w) && t.cat !== cat) { t.cat = cat; changed++; }
  return changed;
}

export function summary(tx = []) {
  let entradas = 0, saidas = 0; const cats = new Map();
  for (const t of tx) {
    if (t.v > 0) entradas += t.v; else saidas += -t.v;
    cats.set(t.cat, (cats.get(t.cat) || 0) + t.v);
  }
  const round = n => Math.round(n * 100) / 100;
  return { entradas: round(entradas), saidas: round(saidas), resultado: round(entradas - saidas), count: tx.length,
    porCategoria: [...cats.entries()].map(([cat, total]) => ({ cat, total: round(total) })).sort((a, b) => Math.abs(b.total) - Math.abs(a.total)) };
}
// Recebimento que bate com uma venda fechada e ainda não paga (mesmo valor, até 60 dias depois da venda).
export function matchSale(t, sales = []) {
  if (!(t.v > 0) || t.saleId) return null;
  return sales.find(s => !s.paid && s.stage === 'Fechado' && Math.abs((+s.value || 0) - t.v) < 0.01 && (!s.date || (s.date <= t.d && (Date.parse(t.d) - Date.parse(s.date)) / 864e5 <= 60))) || null;
}
const csvCell = v => /[;"\n]/.test(String(v)) ? '"' + String(v).replace(/"/g, '""') + '"' : String(v);
export function toCSV(tx = []) {
  return '﻿Data;Descrição;Conta;Categoria;Valor\n' + tx.map(t => [t.d.split('-').reverse().join('/'), t.desc, t.acc || '', t.cat, t.v.toFixed(2).replace('.', ',')].map(csvCell).join(';')).join('\n');
}

// Validação do registro mensal (usada também pelo servidor de sincronização).
export function validateBankMonth(value) {
  if (!MONTH.test(value.id) || (value.month !== undefined && value.month !== value.id)) throw new Error('Mês do extrato inválido.');
  if (!Array.isArray(value.tx) || value.tx.length > MAX_TX_PER_MONTH) throw new Error('Lançamentos do extrato inválidos.');
  const ids = new Set();
  for (const t of value.tx) {
    if (!t || typeof t !== 'object' || Array.isArray(t)) throw new Error('Lançamento inválido.');
    if (Object.keys(t).some(k => !['id', 'd', 'desc', 'v', 'cat', 'acc', 'note', 'saleId'].includes(k))) throw new Error('Campo inesperado no lançamento.');
    if (typeof t.id !== 'string' || !/^[\w.:-]{1,120}$/.test(t.id) || ids.has(t.id)) throw new Error('Identificador de lançamento inválido.');
    ids.add(t.id);
    if (!DAY.test(t.d) || t.d.slice(0, 7) !== value.id) throw new Error('Data de lançamento inválida.');
    if (typeof t.v !== 'number' || !Number.isFinite(t.v) || Math.abs(t.v) > 1e10) throw new Error('Valor de lançamento inválido.');
    if (typeof t.desc !== 'string' || t.desc.length > 300 || !CATEGORIES.includes(t.cat)) throw new Error('Descrição ou categoria inválida.');
    for (const k of ['acc', 'note', 'saleId']) if (t[k] !== undefined && (typeof t[k] !== 'string' || t[k].length > (k === 'note' ? 500 : 180))) throw new Error('Campo do lançamento inválido.');
  }
  if (value.updatedAt !== undefined && (typeof value.updatedAt !== 'string' || value.updatedAt.length > 40)) throw new Error('Data de atualização inválida.');
  if (Object.keys(value).some(k => !['id', 'month', 'tx', 'updatedAt'].includes(k))) throw new Error('Campo inesperado no extrato.');
  return value;
}
export function validateBankRules(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length > 500) throw new Error('Regras do extrato inválidas.');
  for (const [word, cat] of Object.entries(value)) if (!word || word.length > 60 || !CATEGORIES.includes(cat)) throw new Error('Regra do extrato inválida.');
  return value;
}

// ---------- Dashboard ----------
export const PERIODS = [['mes', 'Este mês'], ['mespassado', 'Mês passado'], ['3m', 'Últimos 3 meses'], ['6m', 'Últimos 6 meses'], ['12m', 'Últimos 12 meses'], ['ano', 'Este ano'], ['tudo', 'Tudo']];
const ymd = d => d.toISOString().slice(0, 10);
const addMonths = (y, m, n) => { const t = new Date(Date.UTC(y, m - 1 + n, 1)); return [t.getUTCFullYear(), t.getUTCMonth() + 1]; };
const first = (y, m) => `${y}-${String(m).padStart(2, '0')}-01`;
const lastDay = (y, m) => ymd(new Date(Date.UTC(y, m, 0)));
// Intervalo do período escolhido e o período anterior de mesmo tamanho (para comparar).
export function periodRange(kind, today, oldest = '') {
  const [y, m] = today.slice(0, 7).split('-').map(Number);
  let from, to, months;
  if (kind === 'mespassado') { const [a, b] = addMonths(y, m, -1); from = first(a, b); to = lastDay(a, b); months = 1; }
  else if (/^(3|6|12)m$/.test(kind)) { months = parseInt(kind, 10); const [a, b] = addMonths(y, m, 1 - months); from = first(a, b); to = lastDay(y, m); }
  else if (kind === 'ano') { from = `${y}-01-01`; to = `${y}-12-31`; months = m; }
  else if (kind === 'tudo') { from = oldest || first(y, m); to = lastDay(y, m); const [oy, om] = from.slice(0, 7).split('-').map(Number); months = (y - oy) * 12 + m - om + 1; }
  else { from = first(y, m); to = lastDay(y, m); months = 1; }
  // Período anterior do mesmo tamanho; se o período atual ainda não acabou, compara só até o mesmo dia (ex.: 1 a 13 com 1 a 13).
  const shift = (date, n) => { const [a, b, c] = date.split('-').map(Number), [ny, nm] = addMonths(a, b, n), end = Number(lastDay(ny, nm).slice(8)); return `${ny}-${String(nm).padStart(2, '0')}-${String(Math.min(c, end)).padStart(2, '0')}`; };
  const until = to > today ? today : to, back = kind === 'ano' ? 12 : months;
  return { from, to, prevFrom: kind === 'tudo' ? '' : shift(from, -back), prevTo: kind === 'tudo' ? '' : to > today ? shift(until, -back) : shift(from, -1).slice(0, 8) + lastDay(...shift(from, -1).slice(0, 7).split('-').map(Number)).slice(8), months };
}
export function txBetween(months, from, to, acc = '') {
  const out = [];
  for (const m of months || []) {
    if (from && m.id < from.slice(0, 7) || to && m.id > to.slice(0, 7)) continue;
    for (const t of m.tx || []) if ((!from || t.d >= from) && (!to || t.d <= to) && (!acc || (t.acc || 'Conta') === acc)) out.push(t);
  }
  return out.sort((a, b) => a.d < b.d ? -1 : a.d > b.d ? 1 : 0);
}
// Variação em % contra o período anterior (null quando não dá para comparar).
export const change = (now, before) => before > 0 ? Math.round((now - before) / before * 1000) / 10 : null;
export function monthlySeries(tx, from, to) {
  const list = [];
  let [y, m] = from.slice(0, 7).split('-').map(Number);
  const end = to.slice(0, 7);
  for (let guard = 0; guard < 240; guard++) { const id = `${y}-${String(m).padStart(2, '0')}`; if (id > end) break; list.push({ id, entradas: 0, saidas: 0 }); [y, m] = addMonths(y, m, 1); }
  const by = new Map(list.map(x => [x.id, x]));
  for (const t of tx) { const x = by.get(t.d.slice(0, 7)); if (!x) continue; if (t.v > 0) x.entradas += t.v; else x.saidas -= t.v; }
  for (const x of list) { x.entradas = Math.round(x.entradas * 100) / 100; x.saidas = Math.round(x.saidas * 100) / 100; x.resultado = Math.round((x.entradas - x.saidas) * 100) / 100; }
  return list;
}
// Resultado acumulado dia a dia (quanto sobrou desde o começo do período).
export function cumulative(tx) {
  const days = new Map();
  for (const t of tx) days.set(t.d, (days.get(t.d) || 0) + t.v);
  let acc = 0;
  return [...days.entries()].sort((a, b) => a[0] < b[0] ? -1 : 1).map(([d, v]) => { acc = Math.round((acc + v) * 100) / 100; return { d, v: acc }; });
}
// Maiores destinos (saídas) ou origens (entradas), agrupando descrições parecidas.
export function topGroups(tx, side = 'out', n = 5) {
  const groups = new Map();
  for (const t of tx) {
    if (side === 'out' ? t.v >= 0 : t.v <= 0) continue;
    const key = keywordOf(t.desc) || norm(t.desc).slice(0, 40);
    const g = groups.get(key) || { key, label: cleanName(t.desc), total: 0, count: 0 };
    g.total += Math.abs(t.v); g.count++; groups.set(key, g);
  }
  return [...groups.values()].map(g => ({ ...g, total: Math.round(g.total * 100) / 100 })).sort((a, b) => b.total - a.total).slice(0, n);
}
export function dashboard(months, { period = 'mes', acc = '', today }) {
  const oldest = (months || []).map(m => m.id).sort()[0];
  const r = periodRange(period, today, oldest ? oldest + '-01' : '');
  const tx = txBetween(months, r.from, r.to, acc), prev = r.prevFrom ? txBetween(months, r.prevFrom, r.prevTo, acc) : [];
  const s = summary(tx), p = summary(prev);
  const days = Math.max(1, Math.round((Math.min(Date.parse(r.to), Date.parse(today)) - Date.parse(r.from)) / 864e5) + 1);
  return {
    range: r, tx, summary: s, previous: prev.length ? p : null,
    delta: { entradas: prev.length ? change(s.entradas, p.entradas) : null, saidas: prev.length ? change(s.saidas, p.saidas) : null },
    gastoPorDia: Math.round(s.saidas / days * 100) / 100,
    series: monthlySeries(tx, r.from, r.to), saldo: cumulative(tx),
    categorias: s.porCategoria.filter(c => c.total < 0).map(c => ({ cat: c.cat, total: -c.total })),
    topSaidas: topGroups(tx, 'out'), topEntradas: topGroups(tx, 'in'),
  };
}
