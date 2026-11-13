// Barra do topo do painel (tema SaaS azul): caminho da página, busca rápida (Ctrl/⌘ + K) e botão "+ Novo".
// Só navega clicando nos próprios botões do menu (data-click="go"); não lê nem grava dados.
const el = (tag, text, props = {}) => Object.assign(document.createElement(tag), text == null ? {} : { textContent: text }, props);

// Abas do menu: { id, label, icon(html do próprio painel), button }
function tabs() {
  const seen = new Map();
  for (const button of document.querySelectorAll('#nav button[data-click="go"], #navMore button[data-click="go"]')) {
    let id = '';
    try { id = JSON.parse(button.getAttribute('data-click-args') || '[]')[0] || ''; } catch { /* ignora */ }
    if (!id || seen.has(id)) continue;
    const label = button.querySelector('span:not(.em)')?.textContent?.trim() || button.textContent.trim();
    seen.set(id, { id, label, icon: button.querySelector('.em')?.innerHTML || '', button });
  }
  return [...seen.values()];
}
const go = id => tabs().find(t => t.id === id)?.button.click();
const waitFor = (selector, ms = 2500) => new Promise(resolve => {
  const start = Date.now();
  (function check() { const found = document.querySelector(selector); if (found || Date.now() - start > ms) resolve(found); else requestAnimationFrame(check); })();
});

const ACTIONS = [
  { tab: 'clients', label: 'Novo cliente', icon: '👤', hint: 'Clientes', run: async () => { go('clients'); (await waitFor('[data-click="toggleClientForm"]'))?.click(); } },
  { tab: 'clientPanel', label: 'Montar site no Painel do cliente', icon: '🧩', hint: 'Sites', run: () => go('clientPanel') },
  { tab: 'products', label: 'Registrar venda de produto (placas)', icon: '📦', hint: 'Produtos', run: () => go('products') },
  { tab: 'bank', label: 'Importar extrato bancário', icon: '🏦', hint: 'Financeiro', run: () => go('bank') },
  { tab: 'clientAccess', label: 'Dar acesso a um cliente', icon: '🔑', hint: 'Acessos', run: async () => { go('clientAccess'); (await waitFor('.ca-new input'))?.focus(); } },
];

// ---- busca rápida ----
let open = null;
function palette(mode = 'all') {
  if (open) open.close();
  const overlay = el('div', null, { className: 'pc-overlay', role: 'dialog', ariaLabel: 'Busca rápida', ariaModal: 'true' });
  const box = el('div', null, { className: 'pc-box' });
  const input = el('input', null, { type: 'search', placeholder: mode === 'new' ? 'O que você quer criar?' : 'Ir para… (digite: clientes, instagram, backup…)', ariaLabel: 'Buscar', autocomplete: 'off' });
  const list = el('div', null, { className: 'pc-list', role: 'listbox' });
  box.append(input, list); overlay.append(box);
  let items = [], index = 0;
  // Toda forma de fechar passa por aqui: tira a janela e para de escutar o teclado.
  const close = () => { overlay.remove(); document.removeEventListener('keydown', onKey, true); if (open?.overlay === overlay) open = null; };
  const run = item => { close(); item?.run(); };
  const norm = text => String(text).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  function draw() {
    const q = norm(input.value.trim());
    const pages = mode === 'new' ? [] : tabs().map(t => ({ label: t.label, icon: t.icon, hint: 'Página', run: () => t.button.click(), html: true }));
    const open = new Set(tabs().map(t => t.id)); // sócio: só ações das abas liberadas
    const all = [...ACTIONS.filter(a => !a.tab || open.has(a.tab)), ...pages];
    items = all.filter(item => !q || norm(item.label + ' ' + item.hint).includes(q));
    index = Math.min(index, Math.max(0, items.length - 1));
    list.replaceChildren();
    if (!items.length) { list.append(el('p', 'Nada encontrado.', { className: 'pc-group' })); return; }
    let group = '';
    items.forEach((item, i) => {
      const g = item.hint === 'Página' ? 'Páginas' : 'Ações rápidas';
      if (g !== group) { group = g; list.append(el('div', g, { className: 'pc-group' })); }
      const row = el('button', null, { type: 'button', className: 'pc-item' + (i === index ? ' is-on' : ''), role: 'option' });
      const icon = el('span', null, { className: 'em' });
      if (item.html) icon.innerHTML = item.icon; else icon.textContent = item.icon; // ícone vem do próprio menu do painel
      row.append(icon, el('span', item.label), el('small', item.hint));
      row.addEventListener('click', () => run(item));
      row.addEventListener('mousemove', () => { if (index !== i) { index = i; draw(); } });
      list.append(row);
    });
    list.querySelector('.is-on')?.scrollIntoView({ block: 'nearest' });
  }
  function onKey(event) {
    if (event.key === 'Escape') { event.preventDefault(); close(); }
    else if (!overlay.contains(event.target) && event.target !== document.body) return;
    // As setas redesenham a lista: o foco volta para o campo, e o Enter abre o item destacado.
    else if (event.key === 'ArrowDown') { event.preventDefault(); index = Math.min(items.length - 1, index + 1); draw(); input.focus(); }
    else if (event.key === 'ArrowUp') { event.preventDefault(); index = Math.max(0, index - 1); draw(); input.focus(); }
    else if (event.key === 'Enter' && event.target === input) { event.preventDefault(); run(items[index]); } // num resultado focado (Tab), o Enter abre aquele botão
  }
  input.addEventListener('input', () => { index = 0; draw(); });
  overlay.addEventListener('click', event => { if (event.target === overlay) close(); });
  document.addEventListener('keydown', onKey, true);
  document.body.append(overlay); open = { overlay, close };
  draw(); input.focus();
}

// ---- barra do topo ----
function mountTopbar() {
  const bar = document.querySelector('.topbar');
  if (!bar || bar.querySelector('.pc-crumbs')) return;
  const crumbs = el('div', null, { className: 'pc-crumbs', role: 'navigation', ariaLabel: 'Você está em' });
  const here = el('b', 'Início');
  crumbs.append(el('span', 'Painel'), el('i', '›'), here);
  const isMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
  const search = el('button', null, { type: 'button', className: 'pc-search', ariaLabel: 'Busca rápida' });
  search.append(el('span', '🔍', { className: 'pc-ico' }), el('span', 'Buscar páginas e ações…', { className: 'pc-txt' }), el('kbd', isMac ? '⌘K' : 'Ctrl K'));
  search.addEventListener('click', () => palette('all'));
  const create = el('button', '＋ Novo', { type: 'button', className: 'pc-new' });
  create.addEventListener('click', () => palette('new'));
  const brand = bar.querySelector('.tb-brand');
  brand ? brand.after(crumbs) : bar.prepend(crumbs);
  const menu = bar.querySelector('.tb-menu');
  menu ? menu.before(search, create) : bar.append(search, create);
  // Atualiza o caminho quando a página muda (título h1 da página).
  const app = document.getElementById('app');
  const sync = () => { const h1 = app?.querySelector('h1'); if (h1) here.textContent = h1.textContent.replace(/^[^\p{L}\p{N}]+/u, '').trim(); };
  if (app) new MutationObserver(sync).observe(app, { childList: true });
  sync();
}

document.addEventListener('keydown', event => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); open ? open.close() : palette('all'); }
});
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mountTopbar); else mountTopbar();
