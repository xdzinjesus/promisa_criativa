// Extratos bancários: leitura de arquivos OFX/CSV, categorias e resumos. Módulo puro (sem DOM): roda no navegador e nos testes.
// Os lançamentos ficam agrupados por mês (1 registro por mês), para a sincronização online gastar pouco.

export const CATEGORIES = ['Recebimentos', 'Vendas no cartão', 'Transferências recebidas', 'Outras entradas', 'Impostos', 'Tarifas bancárias', 'Anúncios', 'Ferramentas e hospedagem', 'Fornecedores', 'Salários e pró-labore', 'Transferências enviadas', 'Pessoal', 'Outras saídas'];
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
const safeId = text => String(text).replace(/[^\w.:-]/g, '').slice(0, 120);
function withIds(list, account) {
  const seen = new Map();
  return list.map(t => {
    const base = `${t.d}|${t.v}|${norm(t.desc)}`, n = (seen.get(base) || 0) + 1; seen.set(base, n);
    const id = t.fitid ? safeId(`o:${hash(account)}:${t.fitid}`) : safeId(`h:${hash(account)}:${hash(base + '|' + n)}`);
    const { fitid, ...rest } = t;
    return { ...rest, id };
  });
}

// OFX (Itaú, BB, Caixa, Bradesco, Santander, Inter, Nubank, C6, Sicoob…): SGML sem fechamento ou XML.
export function parseOFX(text) {
  const src = String(text || '');
  if (!/<OFX>/i.test(src) || !/<STMTTRN>/i.test(src)) throw new Error('Este arquivo não parece um extrato OFX.');
  const tag = (block, name) => { const m = new RegExp(`<${name}>([^<\\r\\n]*)`, 'i').exec(block); return m ? m[1].trim() : ''; };
  const bank = tag(src, 'BANKID') || tag(src, 'ORG'), acct = tag(src, 'ACCTID');
  const account = clean([bank && 'Banco ' + bank, acct && 'conta ' + acct.slice(-6)].filter(Boolean).join(' · '), 60) || 'Conta';
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
export function parseCSV(text, account = 'Conta') {
  const lines = String(text || '').replace(/^﻿/, '').split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) throw new Error('O arquivo CSV está vazio.');
  const head = lines.slice(0, 15);
  const sep = [';', '\t', ','].map(s => [s, head.reduce((t, l) => t + splitCsvLine(l, s).length, 0)]).sort((a, b) => b[1] - a[1])[0][0];
  const find = (cols, re) => cols.findIndex(c => re.test(norm(c)));
  const first = (cols, list) => { for (const re of list) { const i = find(cols, re); if (i >= 0) return i; } return -1; }; // em ordem de preferência ("Descrição" antes de "Identificador")
  let hi = -1, col = {};
  for (let i = 0; i < head.length; i++) {
    const cols = splitCsvLine(lines[i], sep);
    const c = { d: find(cols, /^(data|date|dt)\b|data (do )?lanc|data mov/), desc: first(cols, [/descri/, /historico/, /title|titulo|estabelecimento|detalhe|memo/, /lancamento/]), v: find(cols, /^valor|amount|^value|valor \(r\$\)|quantia/), cr: find(cols, /credito|entrada/), db: find(cols, /debito|saida/) };
    if (c.d >= 0 && (c.v >= 0 || (c.cr >= 0 && c.db >= 0))) { hi = i; col = c; break; }
  }
  if (hi < 0) throw new Error('Não achei as colunas de data e valor neste CSV. Prefira o arquivo OFX do banco.');
  const list = [];
  for (const line of lines.slice(hi + 1)) {
    const cols = splitCsvLine(line, sep), d = parseDate(cols[col.d]);
    if (!d) continue;
    let v = col.v >= 0 ? parseMoney(cols[col.v]) : NaN;
    if (!Number.isFinite(v)) { const cr = parseMoney(cols[col.cr]), db = parseMoney(cols[col.db]); v = Number.isFinite(cr) && cr ? Math.abs(cr) : Number.isFinite(db) && db ? -Math.abs(db) : NaN; }
    if (!Number.isFinite(v) || v === 0) continue;
    const desc = clean(col.desc >= 0 ? cols[col.desc] : '') || 'Lançamento';
    if (/^saldo\b/i.test(norm(desc))) continue; // linhas de saldo do dia não são lançamentos
    list.push({ d, v, desc });
  }
  if (!list.length) throw new Error('Não encontrei lançamentos neste CSV.');
  const acc = clean(account, 60) || 'Conta';
  return { account: acc, tx: withIds(list, acc), balance: null };
}
export function parseStatement(name, text, account) {
  if (/\.ofx$/i.test(name) || /<OFX>/i.test(text)) { const r = parseOFX(text); if (account) { r.account = clean(account, 60); } return r; }
  return parseCSV(text, account || clean(String(name).replace(/\.[^.]+$/, ''), 60));
}

// Categorias: primeiro as regras que você criou (palavra → categoria), depois as automáticas.
const AUTO = [
  [/tarifa|iof\b|juros|anuidade|cesta de servicos|manutencao de conta|encargo/, 'Tarifas bancárias', 'out'],
  [/\bdarf\b|\bdas\b|simples nacional|\binss\b|imposto|receita federal|\biss\b|\bgps\b|sefaz|prefeitura/, 'Impostos', 'out'],
  [/facebk|facebook|meta ads|meta platforms|instagram|google ads|googleads|tiktok ads|linkedin ads/, 'Anúncios', 'out'],
  [/vercel|cloudflare|hostinger|hostgator|locaweb|registro\.?br|godaddy|github|google (one|workspace|cloud|storage)|canva|adobe|openai|chatgpt|anthropic|claude|notion|figma|microsoft|spotify|apple\.com|icloud|zoom|dropbox|wix|shopify|nuvemshop/, 'Ferramentas e hospedagem', 'out'],
  [/salario|pro-?labore|folha/, 'Salários e pró-labore', 'out'],
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
// Palavra-chave sugerida para "sempre que aparecer…": a descrição sem números, datas e códigos.
export function keywordOf(desc) {
  return norm(desc).replace(/\d[\d./:-]*/g, ' ').replace(/[^\p{L}\s&.-]/gu, ' ').replace(/\b(pix|ted|doc|enviado|recebido|transferencia|pagamento|compra|debito|credito|de|da|do|para|em|no|na)\b/g, ' ').split(/\s+/).filter(w => /[\p{L}\d]/u.test(w)).slice(0, 3).join(' ').slice(0, 60); // só palavras de verdade (sem "-" solto)
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
