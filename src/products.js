// Produtos físicos (ex.: placas NFC de Instagram e de avaliação do Google): estoque, compras, vendas, custo e lucro.
// Módulo puro (sem DOM). Cada produto é 1 registro, com o histórico de movimentos dentro dele.

export const MOVE_TYPES = ['in', 'out', 'adj']; // in = comprei/recebi · out = vendi · adj = ajuste (perda, brinde, contagem)
export const MAX_MOVES = 5000;
// Fotos: até 3 por produto, já reduzidas no navegador (JPEG/WebP/PNG em data URL, até ~220 KB cada).
export const MAX_IMAGES = 3, MAX_IMAGE_CHARS = 300_000;
export const validImage = i => typeof i === 'string' && i.length <= MAX_IMAGE_CHARS && /^data:image\/(jpeg|webp|png);base64,[A-Za-z0-9+/]+={0,2}$/.test(i);
const DAY = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const round = n => Math.round(n * 100) / 100;
const clean = (text, max) => String(text ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

// Os 2 produtos de hoje, para começar com 1 toque (custo vem das compras lançadas).
export const STARTERS = [
  { name: 'Placa NFC Instagram (acrílico)', emoji: '📸', kind: 'instagram', price: 0, minStock: 3 },
  { name: 'Placa NFC Avaliação Google (acrílico)', emoji: '⭐', kind: 'google', price: 0, minStock: 3 },
];
export const KINDS = { instagram: 'Instagram', google: 'Avaliação no Google', outro: 'Outro' };

// Situação de um produto a partir do histórico.
export function stats(product) {
  let inQty = 0, inCost = 0, outQty = 0, revenue = 0, adj = 0, pending = 0;
  for (const m of product?.moves || []) {
    if (m.type === 'in') { inQty += m.qty; inCost += m.total || 0; }
    else if (m.type === 'out') { outQty += m.qty; revenue += m.total || 0; if (!m.paid) pending += m.total || 0; }
    else adj += m.qty;
  }
  const unitCost = inQty ? inCost / inQty : 0, stock = inQty - outQty + adj, cogs = outQty * unitCost;
  return { stock, inQty, outQty, unitCost: round(unitCost), revenue: round(revenue), cogs: round(cogs), profit: round(revenue - cogs), pending: round(pending),
    margin: revenue ? Math.round((revenue - cogs) / revenue * 100) : null, low: stock <= (product?.minStock ?? 0) };
}
// Resumo de vários produtos num período (vendas do mês etc.).
export function periodStats(products, from = '', to = '') {
  let units = 0, revenue = 0, cogs = 0, pending = 0, sales = 0;
  for (const p of products || []) {
    const { unitCost } = stats(p);
    for (const m of p.moves || []) {
      if (m.type !== 'out' || (from && m.d < from) || (to && m.d > to)) continue;
      units += m.qty; revenue += m.total || 0; cogs += m.qty * unitCost; sales++; if (!m.paid) pending += m.total || 0;
    }
  }
  return { units, sales, revenue: round(revenue), cogs: round(cogs), profit: round(revenue - cogs), pending: round(pending) };
}
export function monthly(products, months = 6, today) {
  const [y, m] = today.slice(0, 7).split('-').map(Number), out = [];
  for (let i = months - 1; i >= 0; i--) {
    const t = new Date(Date.UTC(y, m - 1 - i, 1)), id = t.toISOString().slice(0, 7);
    out.push({ id, ...periodStats(products, id + '-01', id + '-31') });
  }
  return out;
}
// Lista de todas as vendas (mais recentes primeiro), com o produto.
export function allSales(products) {
  return (products || []).flatMap(p => (p.moves || []).filter(m => m.type === 'out').map(m => ({ ...m, productId: p.id, productName: p.name, emoji: p.emoji })))
    .sort((a, b) => a.d < b.d ? 1 : a.d > b.d ? -1 : 0);
}

// Link para gravar na placa (NFC) ou colocar no QR: perfil do Instagram ou página de avaliação do Google.
export function plateLink(kind, raw) {
  const v = clean(raw, 500);
  if (!v) return '';
  if (/^https:\/\/[^\s]+$/i.test(v)) return v;
  if (kind === 'instagram') { const user = v.replace(/^@/, '').replace(/^(www\.)?instagram\.com\//i, '').replace(/[/?#].*$/, ''); return /^[\w.]{1,30}$/.test(user) ? `https://instagram.com/${user}` : ''; }
  if (kind === 'google') return /^[\w-]{10,200}$/.test(v) ? `https://search.google.com/local/writereview?placeid=${v}` : '';
  return '';
}

export function newMove(type, { d, qty, total = 0, client = '', link = '', paid = true, note = '', saleId = '' }, id) {
  const q = Math.trunc(Number(qty));
  return { id, type, d, qty: type === 'adj' ? q : Math.abs(q), total: round(Math.max(0, Number(total) || 0)), ...(client ? { client: clean(client, 120) } : {}), ...(link ? { link: clean(link, 500) } : {}), ...(type === 'out' ? { paid: Boolean(paid) } : {}), ...(note ? { note: clean(note, 300) } : {}), ...(saleId && /^[\w.~-]{1,180}$/.test(String(saleId)) ? { saleId: String(saleId) } : {}) };
}

// Validação do registro (usada também pelo servidor de sincronização).
export function validateProduct(value) {
  const keys = ['id', 'name', 'emoji', 'kind', 'price', 'minStock', 'supplier', 'notes', 'moves', 'createdAt', 'updatedAt', 'archived', 'images'];
  if (value.images !== undefined && (!Array.isArray(value.images) || value.images.length > MAX_IMAGES || value.images.some(i => !validImage(i)))) throw new Error('Fotos do produto inválidas.');
  if (Object.keys(value).some(k => !keys.includes(k))) throw new Error('Campo inesperado no produto.');
  if (typeof value.name !== 'string' || !value.name.trim() || value.name.length > 80) throw new Error('Nome do produto inválido.');
  if (value.emoji !== undefined && (typeof value.emoji !== 'string' || value.emoji.length > 8)) throw new Error('Ícone do produto inválido.');
  if (value.kind !== undefined && !Object.hasOwn(KINDS, value.kind)) throw new Error('Tipo do produto inválido.');
  if (typeof value.price !== 'number' || !Number.isFinite(value.price) || value.price < 0 || value.price > 1e7) throw new Error('Preço inválido.');
  if (!Number.isInteger(value.minStock) || value.minStock < 0 || value.minStock > 1e6) throw new Error('Estoque mínimo inválido.');
  for (const k of ['supplier', 'notes']) if (value[k] !== undefined && (typeof value[k] !== 'string' || value[k].length > 500)) throw new Error('Campo do produto inválido.');
  if (value.archived !== undefined && typeof value.archived !== 'boolean') throw new Error('Campo do produto inválido.');
  if (!Array.isArray(value.moves) || value.moves.length > MAX_MOVES) throw new Error('Movimentos do produto inválidos.');
  const ids = new Set();
  for (const m of value.moves) {
    if (!m || typeof m !== 'object' || Array.isArray(m)) throw new Error('Movimento inválido.');
    if (Object.keys(m).some(k => !['id', 'type', 'd', 'qty', 'total', 'client', 'link', 'paid', 'note', 'saleId'].includes(k))) throw new Error('Campo inesperado no movimento.');
    if (typeof m.id !== 'string' || !/^[\w.-]{1,60}$/.test(m.id) || ids.has(m.id)) throw new Error('Identificador de movimento inválido.');
    ids.add(m.id);
    if (!MOVE_TYPES.includes(m.type) || !DAY.test(m.d)) throw new Error('Tipo ou data do movimento inválido.');
    if (!Number.isInteger(m.qty) || m.qty === 0 || Math.abs(m.qty) > 1e6 || (m.type !== 'adj' && m.qty < 0)) throw new Error('Quantidade inválida.');
    if (typeof m.total !== 'number' || !Number.isFinite(m.total) || m.total < 0 || m.total > 1e9) throw new Error('Valor do movimento inválido.');
    if (m.link !== undefined && (typeof m.link !== 'string' || m.link.length > 500 || !/^https:\/\//i.test(m.link))) throw new Error('Link inválido.');
    for (const k of ['client', 'note']) if (m[k] !== undefined && (typeof m[k] !== 'string' || m[k].length > 300)) throw new Error('Campo do movimento inválido.');
    if (m.paid !== undefined && typeof m.paid !== 'boolean') throw new Error('Situação de pagamento inválida.');
    if (m.saleId !== undefined && (typeof m.saleId !== 'string' || !/^[\w.~-]{1,180}$/.test(m.saleId))) throw new Error('Cliente do movimento inválido.');
  }
  return value;
}
