// Cartão "Uso da Vercel (últimos 30 dias)" na tela Início + monitor do armazenamento (Blob).
// Plano grátis: compara com os limites grátis. Plano Pro: mostra quanto do crédito de US$ 20 já foi usado.
// Guarda a última leitura por 30 minutos neste aparelho para não consultar a Vercel a cada visita.
const el = (tag, text, props = {}) => Object.assign(document.createElement(tag), text == null ? {} : { textContent: text }, props);
const CACHE = 'promisa_vercel_usage', BLOB_CACHE = 'promisa_blob_usage', TTL = 30 * 60 * 1000, BLOB_TTL = 5 * 60 * 1000;
const fmt = (n, unit) => {
  const u = String(unit || '').toLowerCase();
  if (/gb|byte/.test(u)) return `${n.toLocaleString('pt-BR', { maximumFractionDigits: 2 })} GB`;
  if (/hour|^h$|hora/.test(u)) { const h = Math.floor(n), m = Math.round((n - h) * 60); return h ? `${h}h ${m}m` : `${m}m`; }
  return n >= 1000 ? (n / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + ' mil' : n.toLocaleString('pt-BR', { maximumFractionDigits: 2 });
};
const fmtLimit = (n, unit) => /gb|byte/i.test(unit) ? `${n} GB` : /hour|^h$/i.test(unit) ? `${n}h` : n >= 1e6 ? `${n / 1e6} mi` : n >= 1000 ? `${n / 1000} mil` : String(n);
const usd = n => 'US$ ' + n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const bytes = n => n >= 1024 ** 3 ? (n / 1024 ** 3).toLocaleString('pt-BR', { maximumFractionDigits: 2 }) + ' GB' : n >= 1024 ** 2 ? (n / 1024 ** 2).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + ' MB' : n >= 1024 ? Math.round(n / 1024) + ' KB' : n + ' B';
const SVG = p => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`;
const ICON_CLOUD = SVG('<path d="M17.5 19H9a7 7 0 1 1 6.7-9h1.8a4.5 4.5 0 0 1 0 9z"/>');
const ICON_DB = SVG('<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/>');
const ICON_REFRESH = SVG('<path d="M21 12a9 9 0 0 1-15.5 6.3L3 16M3 12a9 9 0 0 1 15.5-6.3L21 8M21 3v5h-5M3 21v-5h5"/>');

async function get(action, cacheKey, force) {
  if (!force) { try { const c = JSON.parse(localStorage.getItem(cacheKey) || 'null'); if (c && Date.now() - c.at < (cacheKey === BLOB_CACHE ? BLOB_TTL : TTL)) return c.data; } catch { /* ignora */ } }
  const r = await fetch('/api/cloud?action=' + action, { credentials: 'same-origin', cache: 'no-store' });
  const data = await r.json().catch(() => ({ error: 'Resposta inválida.' }));
  if (!r.ok) throw new Error(data.error || 'Não foi possível consultar.');
  try { if (!data.error && data.configured) localStorage.setItem(cacheKey, JSON.stringify({ at: Date.now(), data })); } catch { /* ignora */ }
  return data;
}
const head = (icon, title, onRefresh, label) => {
  const h = el('div', null, { className: 'vu-head' });
  const t = el('b'); t.innerHTML = `<span class="vu-ico">${icon}</span>`; t.append(title);
  const b = el('button', null, { type: 'button', className: 'sec vu-refresh', title: label, ariaLabel: label }); b.innerHTML = ICON_REFRESH;
  b.addEventListener('click', onRefresh); h.append(t, b); return h;
};
const bar = (pct, cls = '') => { const t = el('div', null, { className: 'vu-track ' + cls, role: 'img', ariaLabel: `${pct}%` }); t.append(el('i', null, { style: `width:${Math.max(0, Math.min(100, pct))}%` })); return t; };

function usageRows(items, paid) {
  const list = el('div', null, { className: 'vu-list' });
  for (const x of items) {
    const row = el('div', null, { className: 'vu-row' + (x.pct >= 90 ? ' is-red' : x.pct >= 70 ? ' is-warn' : '') });
    const top = el('div', null, { className: 'vu-top' });
    top.append(el('span', x.name), el('b', x.limit ? `${fmt(x.quantity, x.unit)} / ${fmtLimit(x.limit, x.unit)}` : fmt(x.quantity, x.unit) + (paid && x.cost ? ' · ' + usd(x.cost) : '')));
    row.append(top);
    if (x.limit) row.append(bar(x.pct), el('small', `${x.pct.toLocaleString('pt-BR')}% do limite grátis${x.pct >= 90 ? ' · quase no limite' : ''}`));
    list.append(row);
  }
  return list;
}

export async function mount(root, force = false) {
  if (!root) return;
  root.className = 'vu-wrap';
  const card = el('div', null, { className: 'card vu-card' }), blobCard = el('div', null, { className: 'card vu-card vu-blob' });
  root.replaceChildren(card, blobCard);
  card.append(el('b', 'Uso da Vercel · últimos 30 dias'), el('p', 'Carregando…', { className: 'sub' }));
  mountBlob(blobCard, false);
  let d;
  try { d = await get('vercel-usage', CACHE, force); } catch (error) { d = { configured: true, error: error.message }; }
  if (!card.isConnected) return;
  card.replaceChildren(head(ICON_CLOUD, 'Uso da Vercel · últimos 30 dias', () => mount(root, true), 'Atualizar uso da Vercel'));
  if (!d.configured) { card.append(el('p', 'Para ver aqui o mesmo uso do painel da Vercel, falta a chave de acesso (VERCEL_API_TOKEN). O passo a passo está em docs/HOSPEDAGEM.md.', { className: 'sub' })); return; }
  if (d.pending) { card.append(el('span', `Plano ${d.plan === 'pro' ? 'Pro' : 'Enterprise'}`, { className: 'vu-plan' }), el('p', d.error, { className: 'sub vu-pending' })); return; }
  if (d.error) { card.append(el('p', d.error, { className: 'pub-warn' })); return; }
  const paid = d.plan && d.plan !== 'hobby';
  if (paid) {
    const credit = d.credit || 20, pct = Math.round((d.cost || 0) / credit * 1000) / 10;
    const box = el('div', null, { className: 'vu-credit' + (pct >= 100 ? ' is-red' : pct >= 75 ? ' is-warn' : '') });
    box.append(el('span', `Plano ${d.plan === 'pro' ? 'Pro' : 'Enterprise'}`, { className: 'vu-plan' }));
    const top = el('div', null, { className: 'vu-top' }); top.append(el('span', 'Crédito do mês usado'), el('b', `${usd(d.cost || 0)} de ${usd(credit)}`));
    box.append(top, bar(pct), el('small', pct >= 100 ? `Passou do crédito: o excedente (${usd((d.cost || 0) - credit)}) entra na fatura.` : `${pct.toLocaleString('pt-BR')}% usado · sobram ${usd(credit - (d.cost || 0))} de crédito`));
    card.append(box);
  }
  if (!d.items?.length) { card.append(el('p', 'A Vercel não devolveu dados de uso para este período. Veja direto em vercel.com → Usage.', { className: 'sub' })); return; }
  const blobItems = d.items.filter(x => x.blob), other = d.items.filter(x => !x.blob);
  if (blobItems.length) { card.append(el('p', 'Armazenamento (Blob)', { className: 'vu-sec' }), usageRows(blobItems, paid)); }
  if (other.length) {
    const more = el('details', null, { className: 'vu-more' }); more.append(el('summary', `Outros serviços (${other.length})`), usageRows(other, paid));
    if (!paid) more.open = true;
    card.append(more);
  }
  card.append(el('p', paid ? 'No Pro nada trava: o que passar do crédito é cobrado à parte. Os números chegam com algumas horas de atraso.' : 'No plano grátis, passar do limite pode pausar o projeto até o mês virar. Os números chegam com algumas horas de atraso.', { className: 'sub vu-note' }));
}

// Monitor do Blob: tamanho real guardado e o que ocupa mais. Contar custa poucas operações, então é guardado por 30 min.
async function mountBlob(card, force) {
  card.replaceChildren(head(ICON_DB, 'Armazenamento (Blob)', () => mountBlob(card, true), 'Contar o armazenamento agora'), el('p', 'Contando os arquivos…', { className: 'sub' }));
  let d;
  try { d = await get('blob-usage', BLOB_CACHE, force); } catch (error) { d = { configured: true, error: error.message }; }
  if (!card.isConnected) return;
  card.replaceChildren(head(ICON_DB, 'Armazenamento (Blob)', () => mountBlob(card, true), 'Contar o armazenamento agora'));
  if (!d.configured) { card.append(el('p', 'O armazenamento online não está ligado neste ambiente.', { className: 'sub' })); return; }
  if (d.error) { card.append(el('p', d.error, { className: 'pub-warn' })); return; }
  const total = el('div', null, { className: 'vu-blob-total' });
  total.append(el('b', bytes(d.bytes)), el('small', `${d.count.toLocaleString('pt-BR')} arquivo(s)${d.truncated ? ' (contagem parcial)' : ''}`));
  card.append(total);
  const max = Math.max(1, ...d.groups.map(g => g.bytes)), list = el('div', null, { className: 'vu-list vu-groups' });
  for (const g of d.groups) {
    const row = el('div', null, { className: 'vu-row' + (/soltos/.test(g.label) ? ' is-warn' : '') });
    const top = el('div', null, { className: 'vu-top' }); top.append(el('span', g.label), el('b', `${bytes(g.bytes)} · ${g.count}`));
    row.append(top, bar(g.bytes / max * 100)); list.append(row);
  }
  card.append(list);
  if (d.cleanable > 0) {
    const free = el('button', `Liberar espaço agora (${bytes(d.cleanable)})`, { type: 'button', className: 'sec vu-free' });
    free.addEventListener('click', async () => {
      const ask = window.promisaAsk || (o => Promise.resolve(confirm(o.text)));
      if (!await ask({ title: 'Liberar espaço agora?', text: `Apaga de vez ${bytes(d.cleanable)} de arquivos já excluídos e cópias que nada usa. Depois disso eles não podem ser recuperados. Seus clientes, sites e dados atuais não são afetados.`, ok: 'Liberar espaço', danger: true })) return;
      free.disabled = true; free.textContent = 'Liberando…';
      try {
        const r = await fetch('/api/cloud?action=storage-cleanup', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: '{}' });
        const res = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(res.error || 'Não consegui liberar agora.');
        try { localStorage.removeItem(BLOB_CACHE); } catch { /* ignora */ }
        await mountBlob(card, true);
        card.append(el('p', res.removed ? `Pronto: ${bytes(res.freedBytes || 0)} liberados (${res.removed} arquivo(s)).${res.more ? ' Ainda falta um pouco: toque de novo.' : ''}` : 'Nada para apagar ainda: o que foi excluído há menos de 10 minutos fica guardado por segurança. Tente daqui a pouco.', { className: 'pub-ok' }));
      } catch (error) { free.disabled = false; free.textContent = `Liberar espaço agora (${bytes(d.cleanable)})`; card.append(el('p', error.message, { className: 'pub-warn' })); }
    });
    card.append(free);
  }
  const loose = d.cleanable > 0;
  card.append(el('p', `Contado agora há pouco (${new Date(d.at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}).${loose ? ' "Excluídos" e "arquivos soltos" já não são usados: somem sozinhos em até 3 dias, ou na hora pelo botão acima.' : ''}`, { className: 'sub vu-note' }));
}
if (typeof window !== 'undefined') window.promisaVercelUsage = { mount };
