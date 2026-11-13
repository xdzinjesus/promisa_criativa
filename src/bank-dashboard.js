// Dashboard dos extratos: indicadores, entradas x saídas por mês, resultado acumulado, categorias e maiores gastos.
// Gráficos em SVG desenhados aqui mesmo (sem bibliotecas), com dica ao passar o dedo/mouse.
const NS = 'http://www.w3.org/2000/svg';
const el = (tag, text, props = {}) => Object.assign(document.createElement(tag), text == null ? {} : { textContent: text }, props);
const svg = (tag, attrs = {}) => { const n = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v); return n; };
const R = n => (+n || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const Rk = n => Math.abs(n) >= 1000 ? (n / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + ' mil' : Math.round(n).toLocaleString('pt-BR');
const MES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const mes = id => `${MES[+id.slice(5, 7) - 1]}/${id.slice(2, 4)}`;
const dia = d => d.split('-').reverse().slice(0, 2).join('/');

// Dica flutuante dentro do cartão do gráfico.
function tooltip(card) {
  const tip = el('div', null, { className: 'bd-tip', role: 'status' }); tip.hidden = true; card.append(tip);
  return {
    show(lines, x, y) {
      tip.replaceChildren(...lines.map((l, i) => i ? el('div', l) : el('b', l)));
      tip.hidden = false;
      const w = card.clientWidth, tw = tip.offsetWidth;
      tip.style.left = Math.max(4, Math.min(w - tw - 4, x - tw / 2)) + 'px'; tip.style.top = Math.max(4, y - tip.offsetHeight - 10) + 'px';
    },
    hide() { tip.hidden = true; },
  };
}
const pos = (card, e) => { const r = card.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };

function kpi(label, value, sub, delta, goodWhenUp) {
  const k = el('div', null, { className: 'card kpi bd-kpi' });
  k.append(el('small', label), el('b', value));
  if (delta !== null && delta !== undefined) {
    const up = delta > 0, good = delta === 0 ? null : up === goodWhenUp;
    k.append(el('small', `${up ? '▲' : delta < 0 ? '▼' : '='} ${Math.abs(delta).toLocaleString('pt-BR')}% vs período anterior`, { className: 'bd-delta ' + (good === null ? '' : good ? 'is-good' : 'is-bad') }));
  } else k.append(el('small', sub));
  return k;
}

// Entradas x saídas por mês (barras lado a lado, mesma escala).
function monthBars(series) {
  const card = el('div', null, { className: 'card bd-chart' });
  card.append(el('b', 'Entradas x saídas por mês'));
  const legend = el('div', null, { className: 'bd-legend' });
  legend.append(el('span', 'Entradas', { className: 'in' }), el('span', 'Saídas', { className: 'out' }));
  card.append(legend);
  const W = 640, H = 220, L = 46, B = 24, T = 8, max = Math.max(1, ...series.flatMap(s => [s.entradas, s.saidas]));
  const s = svg('svg', { viewBox: `0 0 ${W} ${H}`, class: 'bd-svg', role: 'img', 'aria-label': 'Gráfico de entradas e saídas por mês' });
  for (let i = 0; i <= 3; i++) { const y = T + (H - B - T) * (1 - i / 3); s.append(svg('line', { x1: L, x2: W, y1: y, y2: y, class: 'bd-grid' })); const t = svg('text', { x: L - 6, y: y + 4, class: 'bd-axis', 'text-anchor': 'end' }); t.textContent = Rk(max * i / 3); s.append(t); }
  const slot = (W - L) / series.length, bw = Math.max(3, Math.min(22, slot / 2 - 4));
  const tip = tooltip(card);
  series.forEach((m, i) => {
    const cx = L + slot * i + slot / 2;
    for (const [val, cls, dx] of [[m.entradas, 'in', -bw / 2 - 1], [m.saidas, 'out', bw / 2 + 1]]) {
      const h = Math.max(val ? 2 : 0, (H - B - T) * val / max), x = cx + dx - bw / 2, y = H - B - h;
      if (h) s.append(svg('path', { d: `M${x},${H - B}V${y + Math.min(4, h)}q0,-${Math.min(4, h)} ${Math.min(4, bw / 2)},-${Math.min(4, h)}H${x + bw - Math.min(4, bw / 2)}q${Math.min(4, bw / 2)},0 ${Math.min(4, bw / 2)},${Math.min(4, h)}V${H - B}Z`, class: 'bd-bar ' + cls }));
    }
    if (series.length <= 12 || i % Math.ceil(series.length / 12) === 0) { const t = svg('text', { x: cx, y: H - 6, class: 'bd-axis', 'text-anchor': 'middle' }); t.textContent = mes(m.id); s.append(t); }
    const hit = svg('rect', { x: L + slot * i, y: T, width: slot, height: H - B - T, class: 'bd-hit' });
    hit.addEventListener('pointermove', e => { const [x, y] = pos(card, e); tip.show([mes(m.id), `Entradas: ${R(m.entradas)}`, `Saídas: ${R(m.saidas)}`, `Resultado: ${R(m.resultado)}`], x, y); });
    hit.addEventListener('pointerleave', () => tip.hide());
    s.append(hit);
  });
  card.append(s);
  return card;
}

// Resultado acumulado no período (linha com área; acima de zero = sobrou dinheiro).
function balanceLine(points) {
  const card = el('div', null, { className: 'card bd-chart' });
  card.append(el('b', 'Quanto sobrou ao longo do período'), el('small', ' resultado acumulado (entradas − saídas)', { className: 'sub' }));
  if (points.length < 2) { card.append(el('p', 'Poucos lançamentos para desenhar a linha.', { className: 'sub' })); return card; }
  const W = 640, H = 200, L = 52, B = 22, T = 10;
  const vals = points.map(p => p.v), lo = Math.min(0, ...vals), hi = Math.max(0, ...vals), span = hi - lo || 1;
  const t0 = Date.parse(points[0].d), t1 = Date.parse(points.at(-1).d), tspan = t1 - t0 || 1;
  const X = d => L + (W - L - 6) * (Date.parse(d) - t0) / tspan, Y = v => T + (H - B - T) * (hi - v) / span;
  const s = svg('svg', { viewBox: `0 0 ${W} ${H}`, class: 'bd-svg', role: 'img', 'aria-label': 'Linha do resultado acumulado' });
  for (const v of [lo, (lo + hi) / 2, hi]) { s.append(svg('line', { x1: L, x2: W, y1: Y(v), y2: Y(v), class: 'bd-grid' })); const t = svg('text', { x: L - 6, y: Y(v) + 4, class: 'bd-axis', 'text-anchor': 'end' }); t.textContent = Rk(v); s.append(t); }
  s.append(svg('line', { x1: L, x2: W, y1: Y(0), y2: Y(0), class: 'bd-zero' }));
  const line = points.map((p, i) => `${i ? 'L' : 'M'}${X(p.d).toFixed(1)},${Y(p.v).toFixed(1)}`).join('');
  const last = points.at(-1).v >= 0 ? 'in' : 'out';
  s.append(svg('path', { d: `${line}L${X(points.at(-1).d).toFixed(1)},${Y(0)}L${X(points[0].d).toFixed(1)},${Y(0)}Z`, class: 'bd-area ' + last }), svg('path', { d: line, class: 'bd-line ' + last }));
  for (const p of [points[0], points.at(-1)]) { const t = svg('text', { x: X(p.d), y: H - 5, class: 'bd-axis', 'text-anchor': p === points[0] ? 'start' : 'end' }); t.textContent = dia(p.d); s.append(t); }
  const cross = svg('line', { y1: T, y2: H - B, class: 'bd-cross', visibility: 'hidden' }), dot = svg('circle', { r: 5, class: 'bd-dot ' + last, visibility: 'hidden' });
  s.append(cross, dot);
  const tip = tooltip(card), hit = svg('rect', { x: L, y: T, width: W - L, height: H - B - T, class: 'bd-hit' });
  hit.addEventListener('pointermove', e => {
    const box = s.getBoundingClientRect(), vx = (e.clientX - box.left) / box.width * W;
    let best = points[0]; for (const p of points) if (Math.abs(X(p.d) - vx) < Math.abs(X(best.d) - vx)) best = p;
    cross.setAttribute('x1', X(best.d)); cross.setAttribute('x2', X(best.d)); cross.setAttribute('visibility', 'visible');
    dot.setAttribute('cx', X(best.d)); dot.setAttribute('cy', Y(best.v)); dot.setAttribute('visibility', 'visible');
    const [x, y] = pos(card, e); tip.show([dia(best.d), `Acumulado: ${R(best.v)}`], x, y);
  });
  hit.addEventListener('pointerleave', () => { tip.hide(); cross.setAttribute('visibility', 'hidden'); dot.setAttribute('visibility', 'hidden'); });
  s.append(hit); card.append(s);
  return card;
}

// Lista com barras horizontais (uma cor só: tamanho = valor).
function barList(title, items, { empty, onPick, label = x => x.cat, detail = () => '' }) {
  const card = el('div', null, { className: 'card' });
  card.append(el('b', title));
  if (!items.length) { card.append(el('p', empty, { className: 'sub' })); return card; }
  const max = Math.max(...items.map(x => x.total)), total = items.reduce((t, x) => t + x.total, 0);
  for (const x of items) {
    const row = el(onPick ? 'button' : 'div', null, { className: 'bd-row', ...(onPick ? { type: 'button', title: 'Ver estes lançamentos' } : {}) });
    const top = el('div', null, { className: 'bd-row-top' });
    top.append(el('span', label(x)), el('b', R(x.total)));
    const bar = el('div', null, { className: 'bd-track' }); bar.append(el('i', null, { style: `width:${Math.max(2, x.total / max * 100).toFixed(1)}%` }));
    row.append(top, bar, el('small', `${Math.round(x.total / total * 100)}% ${detail(x)}`.trim()));
    if (onPick) row.addEventListener('click', () => onPick(x));
    card.append(row);
  }
  return card;
}

export function renderDashboard(root, d, { onCategory, onSearch } = {}) {
  const s = d.summary;
  const kpis = el('div', null, { className: 'grid bank-kpis' });
  kpis.append(
    kpi('Entradas', R(s.entradas), 'dinheiro que entrou', d.delta.entradas, true),
    kpi('Saídas', R(s.saidas), 'dinheiro que saiu', d.delta.saidas, false),
    kpi('Resultado', R(s.resultado), s.resultado >= 0 ? 'sobrou no período' : 'faltou no período', null),
    kpi('Gasto médio por dia', R(d.gastoPorDia), `${s.count} lançamento(s)`, null));
  if (s.neutros) root.append(el('p', `ℹ️ ${s.neutros} movimento(s) ficaram fora das contas: guardar/resgatar dinheiro (RDB, caixinhas), Pix pago com o cartão de crédito e transferências entre suas próprias contas. Eles aparecem em Lançamentos.`, { className: 'sub bd-note' }));
  kpis.children[2].querySelector('b').className = s.resultado >= 0 ? 'pos' : 'neg';
  root.append(kpis);
  if (!s.count) { root.append(el('div', 'Nenhum lançamento neste período. Escolha outro período ou importe o extrato.', { className: 'card sub' })); return; }
  const charts = el('div', null, { className: 'grid bank-grid' });
  if (d.series.length > 1) charts.append(monthBars(d.series));
  charts.append(balanceLine(d.saldo));
  root.append(charts);
  const lists = el('div', null, { className: 'grid bank-grid' });
  lists.append(
    barList('Gastos por categoria', d.categorias, { empty: 'Nenhuma saída no período.', onPick: x => onCategory?.(x.cat) }),
    barList('Onde você mais gastou', d.topSaidas, { empty: 'Nenhuma saída no período.', label: x => x.label, detail: x => `· ${x.count}x`, onPick: x => onSearch?.(x.key) }),
    barList('De onde mais entrou dinheiro', d.topEntradas, { empty: 'Nenhuma entrada no período.', label: x => x.label, detail: x => `· ${x.count}x`, onPick: x => onSearch?.(x.key) }));
  root.append(lists);
}
