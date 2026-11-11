import { dayKey, monthKey, followersDelta, projectFollowers, projectionText, clientsProgress, countInstagramLeads, addDays, validDay, formatInt, formatSigned, formatDayShort, formatDayLong, STATUS_LABEL, weekdayOf } from './instagram-math.js';
import { interactions, engagementRate, score, byFormat, byWeekday, cadence, dailyGains, tips, WEEKDAYS_SHORT } from './instagram-insights.js';

// Aba "📈 Instagram" do painel. Só createElement/textContent (nada de innerHTML) e fala só com /api/instagram.
// O painel principal chama window.promisaInstagram.mount(...) ao abrir a aba e .leadsChanged(...) ao salvar.
// Para o servidor/Discord sobem só os NÚMEROS do mês (contatos e clientes vindos do Instagram), nunca dados de clientes.
const DOCS = 'https://github.com/xdzinjesus/promisa_criativa/blob/main/docs/INSTAGRAM.md';
const TYPE_LABEL = { REELS: 'Reels', CAROUSEL: 'Carrossel', VIDEO: 'Vídeo', IMAGE: 'Post' };
const COUNT_KEY = 'promisa_ig_counts_v1';
const MONTHS = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
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
  const bar = el('div', null, { className: 'prog ig-prog', role: 'progressbar' });
  bar.setAttribute('aria-valuemin', '0'); bar.setAttribute('aria-valuemax', '100'); bar.setAttribute('aria-valuenow', String(percent)); bar.setAttribute('aria-label', label);
  const fill = el('i'); fill.style.width = Math.max(0, Math.min(100, percent)) + '%'; bar.append(fill);
  return bar;
}
const toneOf = value => value > 0 ? 'ig-up' : value < 0 ? 'ig-down' : 'ig-flat';
function kpi(icon, title, value, note, tone = '') {
  const card = el('div', null, { className: 'card kpi ig-kpi' });
  const head = el('small'); head.append(el('span', icon, { className: 'ig-kpi-ico', ariaHidden: 'true' }), document.createTextNode(title));
  card.append(head, el('b', value), el('span', note || '', { className: 'ig-note ' + tone }));
  return card;
}
function section(id, title, hint) {
  const card = el('section', null, { className: 'card ig-card', id });
  const head = el('div', null, { className: 'ig-head' });
  head.append(el('h3', title));
  if (hint) head.append(el('span', hint, { className: 'ig-hint' }));
  card.append(head);
  return card;
}
const deltaNote = d => d ? `${formatSigned(d.value)}${d.partial ? ` (${d.days} ${d.days === 1 ? 'dia' : 'dias'})` : ''}` : '—';
const pct = value => value == null ? '—' : String(value).replace('.', ',') + '%';
let chartSeq = 0;

// Gráfico de área (SVG inline, sem biblioteca) com dica ao passar o dedo/mouse.
function chart(daily, days, today) {
  const since = addDays(today, -days + 1);
  const points = daily.filter(item => item.date >= since && item.date <= today);
  const box = el('div', null, { className: 'ig-chart' });
  if (points.length < 2) { box.append(el('p', 'O gráfico aparece quando houver pelo menos 2 dias de histórico.', { className: 'sub' })); return box; }
  const W = 640, H = 200, P = 10;
  const min = Math.min(...points.map(p => p.followers)), max = Math.max(...points.map(p => p.followers));
  const pad = Math.max(2, Math.round((max - min) * .15)), lo = min - pad, span = Math.max(1, max + pad - lo);
  const t0 = Date.parse(points[0].date), t1 = Date.parse(points.at(-1).date), tspan = Math.max(1, t1 - t0);
  const xy = p => [P + (Date.parse(p.date) - t0) / tspan * (W - 2 * P), H - P - (p.followers - lo) / span * (H - 2 * P)];
  const coords = points.map(xy);
  const gid = 'igfill' + (++chartSeq);
  const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, width: '100%', preserveAspectRatio: 'none', role: 'img', 'aria-label': `Seguidores de ${formatDayShort(points[0].date)} a ${formatDayShort(points.at(-1).date)}: de ${points[0].followers} para ${points.at(-1).followers}` });
  const defs = svgEl('defs'), grad = svgEl('linearGradient', { id: gid, x1: 0, y1: 0, x2: 0, y2: 1 });
  grad.append(svgEl('stop', { offset: '0%', 'stop-color': '#9c6aff', 'stop-opacity': .45 }), svgEl('stop', { offset: '100%', 'stop-color': '#9c6aff', 'stop-opacity': 0 }));
  defs.append(grad); svg.append(defs);
  for (const f of [.25, .5, .75]) svg.append(svgEl('line', { x1: 0, x2: W, y1: (H * f).toFixed(1), y2: (H * f).toFixed(1), class: 'ig-grid', 'vector-effect': 'non-scaling-stroke' }));
  const line = coords.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  svg.append(svgEl('path', { d: `M${coords[0][0].toFixed(1)},${H} L${line.replaceAll(' ', ' L')} L${coords.at(-1)[0].toFixed(1)},${H} Z`, fill: `url(#${gid})` }));
  svg.append(svgEl('polyline', { points: line, fill: 'none', stroke: 'var(--ac)', 'stroke-width': 2.4, 'stroke-linejoin': 'round', 'stroke-linecap': 'round', 'vector-effect': 'non-scaling-stroke' }));
  const plot = el('div', null, { className: 'ig-plot' });
  const guide = el('i', null, { className: 'ig-guide' }), dot = el('i', null, { className: 'ig-dot' }), tip = el('div', null, { className: 'ig-tip', role: 'status' });
  const place = index => {
    const [x, y] = coords[index], p = points[index], prev = points[index - 1];
    const left = x / W * 100, top = y / H * 100;
    guide.style.left = dot.style.left = left + '%'; dot.style.top = top + '%';
    tip.replaceChildren(el('b', formatInt(p.followers)), el('span', ` · ${formatDayShort(p.date)}${prev ? ` · ${formatSigned(p.followers - prev.followers)}` : ''}`));
    tip.style.left = Math.min(82, Math.max(18, left)) + '%';
  };
  place(points.length - 1);
  plot.append(svg, guide, dot, tip);
  plot.addEventListener('pointermove', event => {
    const rect = plot.getBoundingClientRect();
    const rel = (event.clientX - rect.left) / rect.width * W;
    let best = 0; coords.forEach(([x], i) => { if (Math.abs(x - rel) < Math.abs(coords[best][0] - rel)) best = i; });
    plot.classList.add('is-hover'); place(best);
  });
  plot.addEventListener('pointerleave', () => { plot.classList.remove('is-hover'); place(points.length - 1); });
  const axis = el('div', null, { className: 'ig-axis' });
  axis.append(el('span', formatDayShort(points[0].date)), el('span', `mín. ${formatInt(min)} · máx. ${formatInt(max)}`), el('span', formatDayShort(points.at(-1).date)));
  box.append(plot, axis);
  const gains = dailyGains(daily, today, days);
  if (gains.length >= 2) {
    const top = Math.max(1, ...gains.map(g => Math.abs(g.gain)));
    const bars = el('div', null, { className: 'ig-gains', ariaLabel: 'Seguidores ganhos por dia' });
    for (const g of gains) {
      const bar = el('i', null, { className: g.gain < 0 ? 'neg' : '', title: `${formatDayShort(g.date)}: ${formatSigned(g.gain)}` });
      bar.style.height = Math.max(6, Math.abs(g.gain) / top * 100) + '%';
      bars.append(bar);
    }
    const total = gains.reduce((sum, g) => sum + g.gain, 0);
    const caption = el('p', null, { className: 'ig-hint' });
    caption.append(document.createTextNode('Ganho por dia · total no período: '), el('b', formatSigned(total), { className: toneOf(total) }));
    box.append(bars, caption);
  }
  return box;
}

const TYPE_ICON = { REELS: '🎬', CAROUSEL: '🗂️', VIDEO: '🎥', IMAGE: '🖼️' };
function postRow(post, followers) {
  const row = el('div', null, { className: 'item ig-post' });
  const thumb = el('span', TYPE_ICON[post.type] || '🖼️', { className: 'ig-thumb ig-t-' + String(post.type || 'IMAGE').toLowerCase(), ariaHidden: 'true' });
  const body = el('div', null, { className: 'ig-post-body' });
  const when = formatDayShort(dayKey(Date.parse(post.timestamp)));
  const title = el('div', null, { className: 'ig-post-title' });
  title.append(el('span', TYPE_LABEL[post.type] || 'Post', { className: 'ig-badge' }), el('small', `${WEEKDAYS_SHORT[weekdayOf(Date.parse(post.timestamp))]} · ${when}`));
  body.append(title);
  if (post.caption) body.append(el('p', post.caption.length > 90 ? post.caption.slice(0, 89) + '…' : post.caption, { className: 'ig-caption' }));
  const chips = el('div', null, { className: 'ig-metrics' });
  const metric = (icon, value, label) => { if (value == null) return; const chip = el('span', `${icon} ${formatInt(value)}`, { title: label }); chip.setAttribute('aria-label', `${label}: ${formatInt(value)}`); chips.append(chip); };
  metric('❤️', post.likes, 'Curtidas'); metric('💬', post.comments, 'Comentários'); metric('👁', post.views, 'Visualizações'); metric('📡', post.reach, 'Alcance'); metric('🔖', post.saved || null, 'Salvamentos'); metric('↗️', post.shares || null, 'Compartilhamentos');
  body.append(chips);
  const side = el('div', null, { className: 'ig-post-side' });
  const rate = engagementRate(post, followers);
  if (rate != null) side.append(el('span', pct(rate), { className: 'ig-rate', title: 'Taxa de engajamento: interações ÷ alcance (ou ÷ seguidores)' }));
  if (post.permalink) side.append(el('a', 'Abrir ↗', { href: post.permalink, target: '_blank', rel: 'noopener noreferrer', className: 'ig-open' }));
  row.append(thumb, body, side);
  return row;
}

function hbars(rows) {
  const wrap = el('div', null, { className: 'ig-hbars' });
  const top = Math.max(1, ...rows.map(r => r.value || 0));
  for (const r of rows) {
    const line = el('div', null, { className: 'ig-hbar' + (r.best ? ' is-best' : '') });
    const track = el('span', null, { className: 'ig-track' }), fill = el('i'); fill.style.width = Math.max(3, (r.value || 0) / top * 100) + '%'; track.append(fill);
    line.append(el('b', r.label), track, el('small', r.note));
    wrap.append(line);
  }
  return wrap;
}
function vbars(rows) {
  const wrap = el('div', null, { className: 'ig-vbars' });
  const top = Math.max(1, ...rows.map(r => r.value || 0));
  for (const r of rows) {
    const col = el('div', null, { className: 'ig-vbar' + (r.best ? ' is-best' : '') + (r.value == null ? ' is-empty' : ''), title: r.title || '' });
    const bar = el('i'); bar.style.height = (r.value == null ? 4 : Math.max(8, r.value / top * 100)) + '%';
    const slot = el('span', null, { className: 'ig-vslot' }); slot.append(bar);
    col.append(el('small', r.value == null ? '' : formatInt(r.value), { className: 'ig-vval' }), slot, el('b', r.label));
    wrap.append(col);
  }
  return wrap;
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
  const state = { history: null, configured: true, nextSyncAt: 0, days: 30, sort: 'recent', message: '', bad: false, loading: true, busy: false };

  function draw() {
    root.replaceChildren();
    root.classList.add('ig-root');
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

    if (h.lastError) root.append(Object.assign(el('p', `⚠️ A última atualização falhou: ${h.lastError.message}${h.lastError.detail ? ' — Detalhe: ' + h.lastError.detail : ''}`, { className: 'sub ig-alert' })));

    const posts = h.posts || [];
    const followers = h.account.followers;

    // perfil
    const profile = el('section', null, { className: 'card ig-profile', id: 'ig-profile' });
    const avatar = el('span', (h.account.username || 'p').slice(0, 1).toUpperCase(), { className: 'ig-avatar', ariaHidden: 'true' });
    const who = el('div', null, { className: 'ig-who' });
    const handle = el('a', '@' + h.account.username, { href: 'https://www.instagram.com/' + encodeURIComponent(h.account.username) + '/', target: '_blank', rel: 'noopener noreferrer', className: 'ig-handle' });
    const synced = h.lastSync ? new Date(h.lastSync).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' }) : 'nunca';
    who.append(handle, el('small', h.lastError ? '⚠️ Última atualização com falha' : `● Atualizado em ${synced}`, { className: h.lastError ? 'ig-status warn' : 'ig-status ok' }));
    const stats = el('div', null, { className: 'ig-stats' });
    for (const [value, label] of [[h.account.followers, 'seguidores'], [h.account.follows, 'seguindo'], [h.account.media, 'posts']]) { const s = el('div'); s.append(el('b', formatInt(value)), el('span', label)); stats.append(s); }
    profile.append(avatar, who, stats);
    root.append(profile);

    // cartões
    const d7 = followersDelta(h.daily, today, 7), d30 = followersDelta(h.daily, today, 30);
    const month = monthKey(Date.now());
    const monthPosts = posts.filter(post => monthKey(Date.parse(post.timestamp)) === month).length;
    const since = Date.now() - 30 * 86_400_000;
    const reels = posts.filter(post => post.type === 'REELS' && Date.parse(post.timestamp) >= since && (post.views ?? post.reach) != null);
    const avg = reels.length ? Math.round(reels.reduce((sum, post) => sum + (post.views ?? post.reach), 0) / reels.length) : null;
    const rates = posts.slice(0, 10).map(post => engagementRate(post, followers)).filter(v => v != null);
    const avgRate = rates.length ? Math.round(rates.reduce((a, b) => a + b, 0) / rates.length * 10) / 10 : null;
    const cad = cadence(posts, today);
    const local = monthCounts(leads());
    const counts = { leads: local.leads, clients: local.clients };
    const grid = el('div', null, { className: 'grid ig-kpis', id: 'ig-kpis' });
    grid.append(
      kpi('👥', 'Seguidores', formatInt(followers), [`7 dias: ${deltaNote(d7)}`, d30 ? `30 dias: ${deltaNote(d30)}` : ''].filter(Boolean).join(' · '), toneOf(d7?.value || 0)),
      kpi('💜', 'Engajamento médio', pct(avgRate), rates.length ? `nos últimos ${rates.length} posts` : 'sem posts ainda', avgRate == null ? '' : avgRate >= 3 ? 'ig-up' : avgRate < 1 ? 'ig-down' : 'ig-flat'),
      kpi('🎬', 'Média dos Reels', avg === null ? '—' : formatInt(avg), reels.length ? `visualizações · ${reels.length} ${reels.length === 1 ? 'Reel' : 'Reels'} em 30 dias` : 'sem Reels em 30 dias'),
      kpi('🗓️', 'Posts no mês', String(monthPosts), cad.daysSince == null ? 'nenhum post ainda' : `${String(cad.perWeek).replace('.', ',')}/semana · último há ${cad.daysSince} ${cad.daysSince === 1 ? 'dia' : 'dias'}`, cad.daysSince != null && cad.daysSince >= 5 ? 'ig-down' : ''),
      kpi('🤝', 'Clientes do Instagram', `${counts.clients} de ${counts.leads}`, 'neste mês: contatos → clientes')
    );
    root.append(grid);

    // dicas automáticas
    const list = tips({ posts, daily: h.daily, followers, today });
    if (list.length) {
      const tipsCard = section('ig-tips', '💡 O que os números dizem', 'dicas automáticas');
      const ul = el('ul', null, { className: 'ig-tips' });
      for (const t of list) { const li = el('li', null, { className: 'ig-tip-' + t.tone }); li.append(el('span', t.icon, { ariaHidden: 'true' }), el('p', t.text)); ul.append(li); }
      tipsCard.append(ul);
      root.append(tipsCard);
    }

    // gráfico
    const chartCard = section('ig-chart-card', '📈 Crescimento de seguidores');
    const chips = el('div', null, { className: 'fchips' });
    for (const days of [7, 30, 90]) {
      const chip = el('button', `${days} dias`, { type: 'button', className: 'fchip' });
      chip.setAttribute('aria-pressed', String(state.days === days));
      chip.addEventListener('click', () => { state.days = days; draw(); });
      chips.append(chip);
    }
    chartCard.append(chips, chart(h.daily, state.days, today));
    root.append(chartCard);

    // metas
    const goalsRow = el('div', null, { className: 'ig-two' });
    const p = projectFollowers({ daily: h.daily, goal: h.goals?.followers, today });
    const goalCard = section('ig-goal-followers', '🎯 Meta de seguidores');
    if (p.status === 'none') goalCard.append(el('p', 'Você ainda não definiu uma meta. Toque em "Editar metas".', { className: 'sub' }));
    else {
      const big = el('div', null, { className: 'ig-goal-big' });
      big.append(el('b', `${p.percent}%`), el('small', ` ${formatInt(p.current)} de ${formatInt(p.target)} até ${formatDayLong(p.deadline)} · ${STATUS_LABEL[p.status]}`));
      goalCard.append(big, progress(p.percent, 'Progresso da meta de seguidores'), el('p', projectionText(p), { className: 'sub ig-small' }));
    }
    const cp = clientsProgress({ goal: h.goals?.clientsPerMonth, counts });
    const clientsCard = section('ig-goal-clients', '🤝 Clientes vindos do Instagram');
    if (!cp.target) clientsCard.append(el('p', `${cp.leads} ${cp.leads === 1 ? 'contato' : 'contatos'} → ${cp.clients} ${cp.clients === 1 ? 'cliente' : 'clientes'} neste mês. Defina uma meta mensal em "Editar metas".`, { className: 'sub' }));
    else {
      const big = el('div', null, { className: 'ig-goal-big' });
      big.append(el('b', `${cp.clients}/${cp.target}`), el('small', ` · ${cp.leads} ${cp.leads === 1 ? 'contato' : 'contatos'} no mês${cp.status === 'achieved' ? ' · 🎉 meta batida' : ''}`));
      clientsCard.append(big, progress(cp.percent, 'Progresso da meta de clientes'));
    }
    const months = Object.entries({ ...(h.clientsByMonth || {}), [month]: counts }).sort(([a], [b]) => a.localeCompare(b)).slice(-6);
    if (months.length >= 2) {
      const best = Math.max(...months.map(([, v]) => v.clients));
      clientsCard.append(vbars(months.map(([m, v]) => ({ label: MONTHS[Number(m.slice(5, 7)) - 1], value: v.clients, best: v.clients === best && best > 0, title: `${v.leads} contatos → ${v.clients} clientes` }))));
    }
    clientsCard.append(el('p', 'Para contar, escolha "Instagram" em "Como conheceu a Promisa?" no cadastro do cliente.', { className: 'sub ig-small' }));
    goalsRow.append(goalCard, clientsCard);
    root.append(goalsRow);

    // formatos e melhor dia
    if (posts.length >= 2) {
      const row = el('div', null, { className: 'ig-two' });
      const formats = byFormat(posts);
      const fCard = section('ig-formats', '🎬 Qual formato engaja mais', 'média de interações por post');
      fCard.append(hbars(formats.map((f, i) => ({ label: f.label, value: f.avgInteractions, best: i === 0 && formats.length > 1, note: `${formatInt(f.avgInteractions)} · ${f.count} ${f.count === 1 ? 'post' : 'posts'}` }))));
      const week = byWeekday(posts);
      const bestDay = Math.max(...week.map(w => w.avg ?? 0));
      const wCard = section('ig-weekdays', '📅 Melhor dia para postar', 'média de interações');
      wCard.append(vbars(week.map(w => ({ label: w.label, value: w.avg, best: w.avg != null && w.avg === bestDay && bestDay > 0, title: w.count ? `${w.count} ${w.count === 1 ? 'post' : 'posts'}` : 'sem posts' }))));
      row.append(fCard, wCard);
      root.append(row);
    }

    // destaques
    const ranked = [...posts].filter(post => interactions(post) > 0).sort((a, b) => score(b) - score(a)).slice(0, 3);
    if (ranked.length) {
      const topCard = section('ig-top', '🏆 Posts campeões', 'os que mais renderam');
      const podium = el('div', null, { className: 'ig-podium' });
      ranked.forEach((post, i) => {
        const item = el(post.permalink ? 'a' : 'div', null, { className: 'ig-top-item', ...(post.permalink ? { href: post.permalink, target: '_blank', rel: 'noopener noreferrer' } : {}) });
        item.append(el('span', ['🥇', '🥈', '🥉'][i], { className: 'ig-medal', ariaHidden: 'true' }), el('b', `${TYPE_LABEL[post.type] || 'Post'} · ${formatDayShort(dayKey(Date.parse(post.timestamp)))}`), el('p', post.caption ? (post.caption.length > 70 ? post.caption.slice(0, 69) + '…' : post.caption) : 'Sem legenda'), el('small', `${formatInt(interactions(post))} interações${(post.views ?? post.reach) != null ? ` · ${formatInt(post.views ?? post.reach)} ${post.views != null ? 'views' : 'alcance'}` : ''}`));
        podium.append(item);
      });
      topCard.append(podium);
      root.append(topCard);
    }

    // posts
    const postsCard = section('ig-posts', '📸 Últimos posts');
    const sorts = el('div', null, { className: 'fchips' });
    for (const [key, label] of [['recent', 'Mais recentes'], ['engagement', 'Mais engajamento'], ['views', 'Mais vistos']]) {
      const chip = el('button', label, { type: 'button', className: 'fchip' });
      chip.setAttribute('aria-pressed', String(state.sort === key));
      chip.addEventListener('click', () => { state.sort = key; draw(); });
      sorts.append(chip);
    }
    if (posts.length > 1) postsCard.append(sorts);
    if (!posts.length) postsCard.append(el('p', 'Nenhum post encontrado ainda.', { className: 'sub' }));
    const sorted = state.sort === 'engagement' ? [...posts].sort((a, b) => (engagementRate(b, followers) ?? -1) - (engagementRate(a, followers) ?? -1))
      : state.sort === 'views' ? [...posts].sort((a, b) => (b.views ?? b.reach ?? -1) - (a.views ?? a.reach ?? -1)) : posts;
    for (const post of sorted.slice(0, 12)) postsCard.append(postRow(post, followers));
    root.append(postsCard);

    root.append(el('p', `Última atualização: ${synced} · @${h.account.username} · O painel atualiza sozinho uma vez por dia.`, { className: 'sub ig-small' }));
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
