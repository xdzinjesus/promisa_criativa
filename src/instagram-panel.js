import { dayKey, monthKey, followersDelta, projectFollowers, projectionText, clientsProgress, countInstagramLeads, addDays, validDay, formatInt, formatSigned, formatDayShort, formatDayLong, STATUS_LABEL } from './instagram-math.js';

// Aba "📈 Instagram" do painel. Só createElement/textContent (nada de innerHTML) e fala só com /api/instagram.
// O painel principal chama window.promisaInstagram.mount(...) ao abrir a aba e .leadsChanged(...) ao salvar.
// Para o servidor/Discord sobem só os NÚMEROS do mês (contatos e clientes vindos do Instagram), nunca dados de clientes.
const DOCS = 'https://github.com/xdzinjesus/promisa_criativa/blob/main/docs/INSTAGRAM.md';
const TYPE_LABEL = { REELS: 'Reels', CAROUSEL: 'Carrossel', VIDEO: 'Vídeo', IMAGE: 'Post' };
const COUNT_KEY = 'promisa_ig_counts_v1';
const el = (tag, text, props = {}) => Object.assign(document.createElement(tag), text == null ? {} : { textContent: text }, props);
const svgEl = (tag, attrs = {}) => { const node = document.createElementNS('http://www.w3.org/2000/svg', tag); for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value)); return node; };

async function api(action, extra = {}) {
  const response = await fetch('/api/instagram', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', cache: 'no-store', body: JSON.stringify({ action, ...extra }) });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(result.error || 'Não foi possível concluir. Tente novamente.'), { status: response.status, result });
  return result;
}
const friendly = error => error?.message === 'Failed to fetch' ? 'Sem conexão. Tente novamente.' : (error?.message || 'Não foi possível concluir.');

const isClosed = lead => lead?.stage === 'Fechado';
export const monthCounts = leads => countInstagramLeads(leads, monthKey(Date.now()), isClosed);

// ---- envio dos números do mês (só quando mudam) ----
let pushTimer = null;
function leadsChanged(leads) {
  clearTimeout(pushTimer);
  pushTimer = setTimeout(async () => {
    try {
      const month = monthKey(Date.now()), counts = countInstagramLeads(leads, month, isClosed);
      let last = null;
      try { last = JSON.parse(localStorage.getItem(COUNT_KEY) || 'null'); } catch { /* sem armazenamento local */ }
      const same = last && last.month === month && last.leads === counts.leads && last.clients === counts.clients;
      if (same || (!last && counts.leads === 0)) return;
      await api('clients-count', { month, leads: counts.leads, clients: counts.clients });
      try { localStorage.setItem(COUNT_KEY, JSON.stringify({ month, ...counts })); } catch { /* ok */ }
    } catch { /* tenta de novo na próxima alteração */ }
  }, 2000);
}

// ---- peças de tela ----
function progress(percent, label) {
  const bar = el('div', null, { className: 'prog', role: 'progressbar' });
  bar.setAttribute('aria-valuemin', '0'); bar.setAttribute('aria-valuemax', '100'); bar.setAttribute('aria-valuenow', String(percent)); bar.setAttribute('aria-label', label);
  const fill = el('i'); fill.style.width = percent + '%'; bar.append(fill);
  return bar;
}
function kpi(title, value, note) {
  const card = el('div', null, { className: 'card kpi' });
  const extra = el('span', note || '');
  extra.style.cssText = 'display:block;font-size:12px;color:var(--mut)';
  card.append(el('small', title), el('b', value), extra);
  return card;
}
const deltaNote = d => d ? `${formatSigned(d.value)}${d.partial ? ` (${d.days} ${d.days === 1 ? 'dia' : 'dias'})` : ''}` : '—';

// Gráfico de linha simples (SVG inline, sem biblioteca).
function chart(daily, days, today) {
  const since = addDays(today, -days + 1);
  const points = daily.filter(item => item.date >= since && item.date <= today);
  const box = el('div', null, { className: 'ig-chart' });
  if (points.length < 2) { box.append(el('p', 'O gráfico aparece quando houver pelo menos 2 dias de histórico.', { className: 'sub' })); return box; }
  const W = 320, H = 120, P = 6;
  const min = Math.min(...points.map(p => p.followers)), max = Math.max(...points.map(p => p.followers)), span = Math.max(1, max - min);
  const t0 = Date.parse(points[0].date), t1 = Date.parse(points.at(-1).date), tspan = Math.max(1, t1 - t0);
  const xy = p => [P + (Date.parse(p.date) - t0) / tspan * (W - 2 * P), H - P - (p.followers - min) / span * (H - 2 * P)];
  const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, width: '100%', role: 'img', 'aria-label': `Seguidores de ${formatDayShort(points[0].date)} a ${formatDayShort(points.at(-1).date)}: de ${points[0].followers} para ${points.at(-1).followers}` });
  svg.style.display = 'block'; svg.style.height = 'auto';
  svg.append(svgEl('polyline', { points: points.map(p => xy(p).map(n => n.toFixed(1)).join(',')).join(' '), fill: 'none', stroke: 'currentColor', 'stroke-width': 2.2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }));
  const [lx, ly] = xy(points.at(-1));
  svg.append(svgEl('circle', { cx: lx.toFixed(1), cy: ly.toFixed(1), r: 3.5, fill: 'currentColor' }));
  svg.style.color = 'var(--ac)';
  const legend = el('p', `${formatDayShort(points[0].date)} · ${formatInt(points[0].followers)}  →  ${formatDayShort(points.at(-1).date)} · ${formatInt(points.at(-1).followers)}`, { className: 'sub' });
  legend.style.margin = '6px 0 0';
  box.append(svg, legend);
  return box;
}

function postRow(post) {
  const row = el('div', null, { className: 'item ig-post' });
  const left = el('div');
  const when = formatDayShort(dayKey(Date.parse(post.timestamp)));
  left.append(el('b', `${TYPE_LABEL[post.type] || 'Post'} · ${when}`));
  if (post.caption) left.append(el('br'), el('small', post.caption.length > 60 ? post.caption.slice(0, 59) + '…' : post.caption));
  const metrics = [`❤️ ${formatInt(post.likes)}`, `💬 ${formatInt(post.comments)}`];
  if (post.views != null) metrics.push(`👁 ${formatInt(post.views)} views`);
  if (post.reach != null) metrics.push(`📡 ${formatInt(post.reach)} alcance`);
  if (post.saved != null) metrics.push(`🔖 ${formatInt(post.saved)}`);
  left.append(el('br'), el('small', metrics.join(' · ')));
  row.append(left);
  if (post.permalink) row.append(el('a', 'Abrir', { href: post.permalink, target: '_blank', rel: 'noopener noreferrer', className: 'ig-open' }));
  return row;
}

// ---- janela "Editar metas" ----
function goalsDialog(history, onSaved) {
  const dialog = el('dialog', null, { className: 'sheet' });
  dialog.setAttribute('aria-label', 'Metas do Instagram');
  const head = el('div', null, { className: 'sheet-head' });
  const close = el('button', '✕', { type: 'button', className: 'sec sheet-x', ariaLabel: 'Fechar' });
  head.append(el('h2', 'Metas do Instagram'), close);
  const body = el('div', null, { className: 'sheet-body' });
  const field = (label, props) => { const wrap = el('label', null, { className: 'sf' }); const input = el('input', null, props); wrap.append(el('span', label), input); return [wrap, input]; };
  const f = history.goals?.followers, c = history.goals?.clientsPerMonth;
  const [targetWrap, target] = field('Meta de seguidores', { type: 'number', inputMode: 'numeric', min: '1', max: '100000000', step: '1', value: f ? String(f.target) : '', placeholder: 'Ex.: 2000' });
  const [deadlineWrap, deadline] = field('Até quando', { type: 'date', value: f?.deadline || '', min: dayKey(Date.now()) });
  const [clientsWrap, clients] = field('Clientes vindos do Instagram por mês', { type: 'number', inputMode: 'numeric', min: '0', max: '1000', step: '1', value: c ? String(c.target) : '', placeholder: 'Ex.: 5' });
  const msg = el('p', '', { role: 'status', className: 'sub' });
  const save = el('button', 'Salvar metas', { type: 'button', className: 'wide' });
  body.append(targetWrap, deadlineWrap, clientsWrap, el('p', 'Deixe em branco para não ter essa meta.', { className: 'sub' }), msg, save);
  dialog.append(head, body);
  close.addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', event => { if (event.target === dialog) dialog.close(); });
  dialog.addEventListener('close', () => dialog.remove());
  save.addEventListener('click', async () => {
    const payload = {};
    const t = target.value.trim(), d = deadline.value.trim();
    if (t || d) {
      if (!/^\d+$/.test(t) || Number(t) < 1) { msg.textContent = 'Digite a meta de seguidores (número inteiro).'; return; }
      if (!validDay(d)) { msg.textContent = 'Escolha a data limite.'; return; }
      payload.followers = { target: Number(t), deadline: d };
    } else payload.followers = null;
    const cl = clients.value.trim();
    if (cl) {
      if (!/^\d+$/.test(cl)) { msg.textContent = 'Digite um número inteiro de clientes por mês.'; return; }
      payload.clientsPerMonth = { target: Number(cl) };
    } else payload.clientsPerMonth = null;
    save.disabled = true; msg.textContent = 'Salvando…';
    try { await api('goals', payload); dialog.close(); onSaved(); }
    catch (error) { msg.textContent = friendly(error); save.disabled = false; }
  });
  document.body.append(dialog);
  dialog.showModal();
}

// ---- tela ----
function mount(root, { leads = () => [] } = {}) {
  if (!root) return;
  const state = { history: null, configured: true, nextSyncAt: 0, days: 30, message: '', bad: false, loading: true, busy: false };

  function draw() {
    root.replaceChildren();
    const today = dayKey(Date.now());
    const h = state.history;
    const bar = el('div', null, { className: 'sheet-grid' });
    const refresh = el('button', state.busy ? 'Atualizando…' : '🔄 Atualizar agora', { type: 'button', id: 'ig-sync' });
    refresh.disabled = state.busy || !state.configured;
    const goals = el('button', '🎯 Editar metas', { type: 'button', className: 'sec', id: 'ig-goals' });
    goals.disabled = !h;
    bar.append(refresh, goals);
    root.append(bar);
    if (state.message) { const note = el('p', state.message, { role: 'status', className: 'sub' }); note.style.color = state.bad ? 'var(--red)' : 'var(--grn)'; note.style.marginTop = '10px'; root.append(note); }
    refresh.addEventListener('click', sync);
    goals.addEventListener('click', () => goalsDialog(h, load));

    if (state.loading && !h) { root.append(el('p', 'Carregando…', { className: 'sub' })); return; }
    if (!state.configured) {
      const card = el('div', null, { className: 'card', id: 'ig-setup' });
      const steps = el('ol');
      for (const text of ['Gere o token do Instagram no site da Meta (passo a passo no guia abaixo).', 'Na Vercel, coloque esse token na variável INSTAGRAM_TOKEN.', 'Faça um novo deploy (ou espere o próximo) e volte aqui para tocar em "Atualizar agora".']) steps.append(el('li', text));
      const guide = el('a', 'Abrir o guia passo a passo (docs/INSTAGRAM.md)', { href: DOCS, target: '_blank', rel: 'noopener noreferrer' });
      const vercel = el('a', 'Abrir as variáveis da Vercel', { href: 'https://vercel.com/alexandremachadofabris-3928s-projects/promisa_criativa/settings/environment-variables', target: '_blank', rel: 'noopener noreferrer' });
      const gap = el('p'); gap.append(guide, document.createTextNode(' · '), vercel);
      card.append(el('h2', 'Falta conectar o Instagram', { style: 'margin-top:0' }), el('p', 'Coloque INSTAGRAM_TOKEN na Vercel para o painel puxar seus números sozinho.'), steps, gap);
      root.append(card);
      return;
    }
    if (!h?.account) { root.append(el('p', 'Ainda não há dados. Toque em "Atualizar agora" para buscar.', { className: 'sub' })); return; }

    if (h.lastError) root.append(Object.assign(el('p', `⚠️ A última atualização falhou: ${h.lastError.message}`, { className: 'sub' }), { style: 'color:var(--amb)' }));

    // cartões
    const d7 = followersDelta(h.daily, today, 7), d30 = followersDelta(h.daily, today, 30);
    const month = monthKey(Date.now());
    const monthPosts = (h.posts || []).filter(post => monthKey(Date.parse(post.timestamp)) === month).length;
    const since = Date.now() - 30 * 86_400_000;
    const reels = (h.posts || []).filter(post => post.type === 'REELS' && Date.parse(post.timestamp) >= since && (post.views ?? post.reach) != null);
    const avg = reels.length ? Math.round(reels.reduce((sum, post) => sum + (post.views ?? post.reach), 0) / reels.length) : null;
    const local = monthCounts(leads());
    const counts = { leads: local.leads, clients: local.clients };
    const grid = el('div', null, { className: 'grid', id: 'ig-kpis' });
    grid.style.gridTemplateColumns = 'repeat(auto-fit,minmax(150px,1fr))';
    grid.style.marginBottom = '12px';
    grid.append(
      kpi('Seguidores', formatInt(h.account.followers), [`7 dias: ${deltaNote(d7)}`, d30 ? `30 dias: ${deltaNote(d30)}` : ''].filter(Boolean).join(' · ')),
      kpi('Posts no mês', String(monthPosts), 'publicados neste mês'),
      kpi('Média dos Reels', avg === null ? '—' : formatInt(avg), reels.length ? `visualizações · ${reels.length} ${reels.length === 1 ? 'Reel' : 'Reels'} em 30 dias` : 'sem Reels em 30 dias'),
      kpi('Clientes do Instagram', `${counts.clients} de ${counts.leads}`, 'neste mês: contatos → clientes')
    );
    root.append(grid);

    // meta de seguidores
    const p = projectFollowers({ daily: h.daily, goal: h.goals?.followers, today });
    const goalCard = el('div', null, { className: 'card', id: 'ig-goal-followers' });
    goalCard.append(el('b', '🎯 Meta de seguidores'));
    if (p.status === 'none') goalCard.append(el('p', 'Você ainda não definiu uma meta. Toque em "Editar metas".', { className: 'sub' }));
    else {
      goalCard.append(el('small', ` ${formatInt(p.current)} de ${formatInt(p.target)} até ${formatDayLong(p.deadline)} · ${STATUS_LABEL[p.status]}`), progress(p.percent, 'Progresso da meta de seguidores'), el('p', projectionText(p), { className: 'sub', style: 'margin:10px 0 0' }));
    }
    root.append(goalCard);

    // meta de clientes
    const cp = clientsProgress({ goal: h.goals?.clientsPerMonth, counts });
    const clientsCard = el('div', null, { className: 'card', id: 'ig-goal-clients' });
    clientsCard.append(el('b', '🤝 Clientes vindos do Instagram (mês)'));
    if (!cp.target) clientsCard.append(el('p', `${cp.leads} ${cp.leads === 1 ? 'contato' : 'contatos'} → ${cp.clients} ${cp.clients === 1 ? 'cliente' : 'clientes'} neste mês. Defina uma meta mensal em "Editar metas".`, { className: 'sub' }));
    else clientsCard.append(el('small', ` ${cp.clients} de ${cp.target} · ${cp.leads} ${cp.leads === 1 ? 'contato' : 'contatos'} no mês${cp.status === 'achieved' ? ' · 🎉 meta batida' : ''}`), progress(cp.percent, 'Progresso da meta de clientes'));
    clientsCard.append(el('p', 'Para contar, escolha "Instagram" em "Como conheceu a Promisa?" no cadastro do cliente.', { className: 'sub', style: 'margin:10px 0 0' }));
    root.append(clientsCard);

    // gráfico
    const chartCard = el('div', null, { className: 'card', id: 'ig-chart-card' });
    const chips = el('div', null, { className: 'fchips' });
    for (const days of [30, 90]) {
      const chip = el('button', `${days} dias`, { type: 'button', className: 'fchip' });
      chip.setAttribute('aria-pressed', String(state.days === days));
      chip.addEventListener('click', () => { state.days = days; draw(); });
      chips.append(chip);
    }
    chartCard.append(el('b', '📈 Seguidores'), chips, chart(h.daily, state.days, today));
    root.append(chartCard);

    // posts
    const postsCard = el('div', null, { className: 'card', id: 'ig-posts' });
    postsCard.append(el('b', '📸 Últimos posts'));
    if (!h.posts?.length) postsCard.append(el('p', 'Nenhum post encontrado ainda.', { className: 'sub' }));
    for (const post of (h.posts || []).slice(0, 10)) postsCard.append(postRow(post));
    root.append(postsCard);

    const foot = el('p', `Última atualização: ${h.lastSync ? new Date(h.lastSync).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' }) : 'nunca'} · @${h.account.username}`, { className: 'sub' });
    root.append(foot);
  }

  async function load() {
    state.loading = true;
    try {
      const result = await api('status');
      state.history = result.history; state.configured = Boolean(result.configured); state.nextSyncAt = result.nextSyncAt || 0;
    } catch (error) { state.message = friendly(error); state.bad = true; }
    state.loading = false;
    draw();
    leadsChanged(leads());
  }

  async function sync() {
    if (state.busy) return;
    state.busy = true; state.message = ''; draw();
    try {
      const result = await api('sync');
      state.history = result.history; state.nextSyncAt = result.nextSyncAt || 0;
      state.message = 'Pronto! Números atualizados.'; state.bad = false;
    } catch (error) {
      state.message = friendly(error); state.bad = true;
      if (error.result?.history) state.history = error.result.history;
      if (error.result?.code === 'not-configured') state.configured = false;
    }
    state.busy = false; draw();
  }

  load();
}

window.promisaInstagram = { mount, leadsChanged, monthCounts };
