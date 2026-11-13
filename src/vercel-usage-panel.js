// Cartão "☁️ Uso da Vercel (últimos 30 dias)" na tela Início: mesmos números do painel da Vercel, com os limites do plano grátis.
// Guarda a última leitura por 30 minutos neste aparelho para não consultar a Vercel a cada visita.
const el = (tag, text, props = {}) => Object.assign(document.createElement(tag), text == null ? {} : { textContent: text }, props);
const CACHE = 'promisa_vercel_usage', TTL = 30 * 60 * 1000;
const fmt = (n, unit) => {
  const u = String(unit || '').toLowerCase();
  if (/gb|byte/.test(u)) return `${n.toLocaleString('pt-BR', { maximumFractionDigits: 2 })} GB`;
  if (/hour|^h$|hora/.test(u)) { const h = Math.floor(n), m = Math.round((n - h) * 60); return h ? `${h}h ${m}m` : `${m}m`; }
  return n >= 1000 ? (n / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + ' mil' : n.toLocaleString('pt-BR', { maximumFractionDigits: 2 });
};
const fmtLimit = (n, unit) => /gb|byte/i.test(unit) ? `${n} GB` : /hour|^h$/i.test(unit) ? `${n}h` : n >= 1e6 ? `${n / 1e6} mi` : n >= 1000 ? `${n / 1000} mil` : String(n);

async function load(force) {
  if (!force) { try { const c = JSON.parse(localStorage.getItem(CACHE) || 'null'); if (c && Date.now() - c.at < TTL) return c.data; } catch { /* ignora */ } }
  const r = await fetch('/api/cloud?action=vercel-usage', { credentials: 'same-origin', cache: 'no-store' });
  const data = await r.json().catch(() => ({ error: 'Resposta inválida.' }));
  if (!r.ok) throw new Error(data.error || 'Não foi possível consultar.');
  try { if (!data.error && data.configured) localStorage.setItem(CACHE, JSON.stringify({ at: Date.now(), data })); } catch { /* ignora */ }
  return data;
}

export async function mount(root, force = false) {
  if (!root) return;
  root.className = 'card vu-card';
  root.replaceChildren(el('b', '☁️ Uso da Vercel · últimos 30 dias'), el('p', 'Carregando…', { className: 'sub' }));
  let d;
  try { d = await load(force); } catch (error) { d = { configured: true, error: error.message }; }
  if (!root.isConnected) return;
  const head = el('div', null, { className: 'vu-head' });
  head.append(el('b', '☁️ Uso da Vercel · últimos 30 dias'));
  const refresh = el('button', '🔄', { type: 'button', className: 'sec vu-refresh', title: 'Atualizar agora', ariaLabel: 'Atualizar uso da Vercel' });
  refresh.addEventListener('click', () => mount(root, true));
  head.append(refresh); root.replaceChildren(head);
  if (!d.configured) {
    root.append(el('p', 'Para ver aqui o mesmo uso do painel da Vercel, falta a chave de acesso (VERCEL_API_TOKEN). O passo a passo está no chat do Claude e em docs/HOSPEDAGEM.md.', { className: 'sub' }));
    return;
  }
  if (d.error) { root.append(el('p', '⚠️ ' + d.error, { className: 'pub-warn' })); return; }
  if (!d.items?.length) { root.append(el('p', 'A Vercel não devolveu dados de uso para este período. No plano grátis (Hobby) a consulta pode vir vazia; veja direto em vercel.com → Usage.', { className: 'sub' })); return; }
  const list = el('div', null, { className: 'vu-list' });
  for (const x of d.items) {
    const row = el('div', null, { className: 'vu-row' + (x.pct >= 90 ? ' is-red' : x.pct >= 70 ? ' is-warn' : '') });
    const top = el('div', null, { className: 'vu-top' });
    top.append(el('span', x.name), el('b', x.limit ? `${fmt(x.quantity, x.unit)} / ${fmtLimit(x.limit, x.unit)}` : fmt(x.quantity, x.unit)));
    row.append(top);
    if (x.limit) { const t = el('div', null, { className: 'vu-track', role: 'img', ariaLabel: `${x.pct}% do limite` }); t.append(el('i', null, { style: `width:${Math.min(100, x.pct)}%` })); row.append(t, el('small', `${x.pct.toLocaleString('pt-BR')}% do limite grátis${x.pct >= 90 ? ' · ⚠️ quase no limite' : ''}`)); }
    list.append(row);
  }
  root.append(list);
  if (d.cost) root.append(el('p', `Custo no período: US$ ${d.cost.toFixed(2)}`, { className: 'sub' }));
  root.append(el('p', 'No plano grátis, passar do limite pode pausar o projeto até o mês virar. Os números chegam com algumas horas de atraso.', { className: 'sub vu-note' }));
}
if (typeof window !== 'undefined') window.promisaVercelUsage = { mount };
