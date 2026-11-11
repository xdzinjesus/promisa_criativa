
(() => {
 'use strict';
 const $ = (selector, scope = document) => scope.querySelector(selector);
 const $$ = (selector, scope = document) => [...scope.querySelectorAll(selector)];
 const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
 const fine = window.matchMedia('(hover: hover) and (pointer: fine)');
 const nav = $('.site-nav'), menu = $('#menu'), burger = $('.burger');
 const mobile = window.matchMedia('(max-width: 900px)');
 const closeMenu = (restoreFocus = false) => {
  const wasOpen = burger.getAttribute('aria-expanded') === 'true';
  menu.classList.remove('open');
  burger.setAttribute('aria-expanded', 'false');
  burger.setAttribute('aria-label', 'Abrir menu');
  if (wasOpen && restoreFocus) burger.focus();
 };
 burger.addEventListener('click', () => {
  const open = burger.getAttribute('aria-expanded') !== 'true';
  menu.classList.toggle('open', open);
  burger.setAttribute('aria-expanded', String(open));
  burger.setAttribute('aria-label', open ? 'Fechar menu' : 'Abrir menu');
 });
 document.addEventListener('keydown', event => { if (event.key === 'Escape') closeMenu(true); });
 document.addEventListener('click', event => { if (!nav.contains(event.target)) closeMenu(); });
 $$('#menu a').forEach(link => link.addEventListener('click', () => {
  closeMenu();
  const hash = link.getAttribute('href');
  if (hash && hash.startsWith('#')) {
   const target = document.getElementById(hash.slice(1));
   if (target) requestAnimationFrame(() => target.focus({ preventScroll: true }));
  }
 }));
 const watch = (query, callback) => query.addEventListener ? query.addEventListener('change', callback) : query.addListener(callback);
 watch(mobile, () => { if (!mobile.matches) closeMenu(); });
 let scrollFrame = 0;
 const updateNav = () => { nav.classList.toggle('scrolled', window.scrollY > 24); scrollFrame = 0; };
 addEventListener('scroll', () => { if (!scrollFrame) scrollFrame = requestAnimationFrame(updateNav); }, { passive: true });
 updateNav();
 // Progressive enhancement: content stays readable without JavaScript or IO.
 $$('.process-step, .why-list li, .included li').forEach((el, i) => { if (!el.style.getPropertyValue('--delay')) el.style.setProperty('--delay', (i % 4) * 70 + 'ms'); });
 const reveals = $$('.reveal');
 let observer;
 if ('IntersectionObserver' in window && !reduced.matches) {
  document.documentElement.classList.add('motion-ready');
  observer = new IntersectionObserver(entries => entries.forEach(entry => {
   if (entry.isIntersecting) { entry.target.classList.add('is-visible'); observer.unobserve(entry.target); }
  }), { threshold: .09, rootMargin: '0px 0px -20px 0px' });
  reveals.forEach(el => observer.observe(el));
 }
 // Projetos em destaque gerenciados pelo painel. Sem itens (ou com erro), a lista estática do HTML permanece.
 const projectsGrid = $('.projects-grid');
 if (projectsGrid && 'fetch' in window) {
  const VIRTUAL_W = 1280;
  const make = (tag, cls, text) => { const node = document.createElement(tag); if (cls) node.className = cls; if (text !== undefined) node.textContent = text; return node; };
  const ready = new WeakSet();
  const fitFrame = box => {
   const frame = box.firstElementChild; if (!frame) return;
   const width = box.clientWidth, height = box.clientHeight; if (!width) return;
   const scale = width / VIRTUAL_W;
   frame.style.height = Math.ceil(height / scale) + 'px';
   frame.style.transform = 'scale(' + scale.toFixed(4) + ')';
  };
  const sizer = 'ResizeObserver' in window ? new ResizeObserver(entries => entries.forEach(entry => fitFrame(entry.target))) : null;
  const loader = 'IntersectionObserver' in window ? new IntersectionObserver(entries => entries.forEach(entry => {
   if (!entry.isIntersecting) return;
   loader.unobserve(entry.target); load(entry.target);
  }), { rootMargin: '200px 0px' }) : null;
  const load = box => {
   if (ready.has(box)) return; ready.add(box);
   const frame = box.firstElementChild;
   frame.addEventListener('load', () => box.classList.add('is-loaded'), { once: true });
   frame.src = box.dataset.src;
  };
  const card = (item, index, count) => {
   const feature = index === 0 && count !== 2;
   const figure = make('figure', 'project project-preview reveal project-live' + (feature ? ' project-feature' : ''));
   figure.style.setProperty('--delay', Math.min(index, 4) * 70 + 'ms');
   const visual = make('div', 'project-visual'), win = make('div', 'preview-window');
   const chrome = make('div', 'preview-chrome'); chrome.setAttribute('aria-hidden', 'true');
   chrome.append(make('i'), make('i'), make('i'), make('span'));
   const box = make('div', 'live-frame' + (feature ? ' is-feature' : ''));
   box.dataset.src = '/projeto/' + encodeURIComponent(item.id) + '/';
   const frame = document.createElement('iframe');
   frame.setAttribute('sandbox', 'allow-scripts'); frame.setAttribute('loading', 'lazy'); frame.setAttribute('tabindex', '-1');
   frame.setAttribute('aria-hidden', 'true'); frame.setAttribute('scrolling', 'no'); frame.setAttribute('referrerpolicy', 'no-referrer');
   frame.title = item.title;
   box.append(frame); win.append(chrome, box); visual.append(win);
   const meta = make('figcaption', 'project-meta'), inner = make('div');
   inner.append(make('h3', '', item.title));
   const sub = [item.demo ? 'Site demonstrativo' : '', item.category].filter(Boolean).join(' · ');
   if (sub) inner.append(make('p', '', sub));
   meta.append(inner); figure.append(visual, meta);
   return { figure, box };
  };
  const render = items => {
   const cards = items.map((item, i) => card(item, i, items.length));
   projectsGrid.dataset.count = String(items.length);
   projectsGrid.replaceChildren(...cards.map(c => c.figure));
   cards.forEach(({ figure, box }) => {
    fitFrame(box); sizer?.observe(box);
    if (loader) loader.observe(box); else load(box);
    reveals.push(figure);
    if (observer) observer.observe(figure); else figure.classList.add('is-visible');
   });
   const note = $('.project-note');
   if (note) {
    const demos = items.filter(item => item.demo).map(item => item.title);
    const list = demos.length > 1 ? demos.slice(0, -1).join(', ') + ' e ' + demos[demos.length - 1] : demos[0];
    note.textContent = 'Prévias das páginas iniciais dos projetos.' + (demos.length ? ' ' + list + (demos.length > 1 ? ' são sites demonstrativos.' : ' é um site demonstrativo.') : '');
   }
  };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4000);
  fetch('/api/featured', { signal: controller.signal, headers: { Accept: 'application/json' } })
   .then(response => response.ok ? response.json() : null)
   .then(data => {
    const items = Array.isArray(data?.items) ? data.items.filter(item => item && typeof item.id === 'string' && typeof item.title === 'string' && item.title).slice(0, 6) : [];
    if (items.length) render(items);
   })
   .catch(() => {})
   .finally(() => clearTimeout(timer));
 }
 const art = $('#hero-art');
 let artFrame = 0, pointerX = 0, pointerY = 0;
 const resetArt = () => {
  cancelAnimationFrame(artFrame); artFrame = 0;
  art.classList.remove('pointer-active');
  ['--rx', '--ry', '--gx', '--gy'].forEach(prop => art.style.removeProperty(prop));
 };
 art.addEventListener('pointermove', event => {
  if (!fine.matches || reduced.matches || event.pointerType === 'touch') return;
  pointerX = event.clientX; pointerY = event.clientY;
  if (!artFrame) artFrame = requestAnimationFrame(() => {
   const rect = art.getBoundingClientRect();
   const x = Math.max(0, Math.min(1, (pointerX - rect.left) / rect.width));
   const y = Math.max(0, Math.min(1, (pointerY - rect.top) / rect.height));
   art.classList.add('pointer-active');
   art.style.setProperty('--rx', ((.5 - y) * 14).toFixed(2) + 'deg');
   art.style.setProperty('--ry', ((x - .5) * 20).toFixed(2) + 'deg');
   art.style.setProperty('--gx', (x * 100).toFixed(1) + '%');
   art.style.setProperty('--gy', (y * 100).toFixed(1) + '%');
   artFrame = 0;
  });
 }, { passive: true });
 art.addEventListener('pointerleave', resetArt);
 // Toque ou clique: o P afunda de leve, gira uma volta suave em 3D e solta
 // uma onda de luz. Animação feita pelo navegador (Web Animations), sem
 // reiniciar no meio: cliques durante o giro são ignorados.
 // Com "Reduzir movimento" ligado, só um brilho suave (sem giro).
 const markPop = art.querySelector('.mark-pop');
 // Espessura 3D do P: cópias da mesma imagem (já baixada) empilhadas para trás,
 // formando a lateral e o verso que aparecem durante o giro.
 const markImage = markPop && markPop.querySelector('.mark-image');
 if (markImage && !reduced.matches) {
  const depth = 16, step = fine.matches ? 1 : 1.25;
  const layers = document.createDocumentFragment();
  for (let i = depth; i >= 1; i--) {
   const layer = document.createElement('img');
   layer.src = markImage.currentSrc || markImage.src;
   layer.alt = ''; layer.setAttribute('aria-hidden', 'true'); layer.draggable = false; layer.decoding = 'async';
   layer.className = 'mark-layer' + (i === depth ? ' is-back' : '');
   layer.style.setProperty('--d', (i * step).toFixed(2) + 'px');
   layers.append(layer);
  }
  markPop.insertBefore(layers, markImage);
 }
 const markRing = art.querySelector('.mark-ring');
 const markBurst = art.querySelector('.mark-burst');
 let spinning = null;
 const press = on => art.classList.toggle('is-pressed', on);
 art.addEventListener('pointerdown', () => press(true));
 ['pointerup', 'pointercancel', 'pointerleave'].forEach(type => art.addEventListener(type, () => press(false)));
 art.addEventListener('selectstart', event => event.preventDefault());
 art.addEventListener('dragstart', event => event.preventDefault());
 const pop = () => {
  if (!markPop || typeof markPop.animate !== 'function') return;
  if (spinning) return;
  const glow = (el, frames, ms) => el && el.animate(frames, { duration: ms, easing: 'cubic-bezier(.22,1,.36,1)' });
  if (reduced.matches) {
   spinning = glow(markBurst, [{ opacity: 0 }, { opacity: .9, offset: .35 }, { opacity: 0 }], 900);
  } else {
   spinning = markPop.animate([
    { transform: 'translateY(0) rotateY(0deg) scale(1)' },
    { transform: 'translateY(-14px) rotateY(180deg) scale(1.06)', offset: .5 },
    { transform: 'translateY(0) rotateY(360deg) scale(1)' }
   ], { duration: 1200, easing: 'cubic-bezier(.65,0,.35,1)' });
   glow(markRing, [{ opacity: .9, transform: 'scale(.6)' }, { opacity: 0, transform: 'scale(1.6)' }], 1100);
   glow(markBurst, [{ opacity: 0, transform: 'scale(.85)' }, { opacity: 1, transform: 'scale(1)', offset: .3 }, { opacity: 0, transform: 'scale(1.1)' }], 1200);
  }
  if (!spinning) return;
  const done = () => { spinning = null; };
  spinning.onfinish = done; spinning.oncancel = done;
 };
 art.addEventListener('click', pop);
 let spotFrame = 0;
 $$('.spotlight').forEach(card => card.addEventListener('pointermove', event => {
  if (!fine.matches || reduced.matches || event.pointerType === 'touch' || spotFrame) return;
  const x = event.clientX, y = event.clientY;
  spotFrame = requestAnimationFrame(() => {
   const box = card.getBoundingClientRect();
   card.style.setProperty('--sx', (x - box.left) + 'px');
   card.style.setProperty('--sy', (y - box.top) + 'px');
   spotFrame = 0;
  });
 }, { passive: true }));
 watch(reduced, () => {
  resetArt();
  if (reduced.matches) {
   document.documentElement.classList.remove('motion-ready');
   observer?.disconnect(); reveals.forEach(el => el.classList.add('is-visible'));
  }
 });
 watch(fine, resetArt);
})();

// O formulário prepara a mensagem; o visitante confirma o envio no WhatsApp.
document.getElementById('quote-form')?.addEventListener('submit', event => {
 event.preventDefault();
 const form = event.currentTarget;
 const name = document.getElementById('quote-name');
 const project = document.getElementById('quote-project');
 name.value = name.value.trim(); project.value = project.value.trim();
 if (!form.reportValidity()) return;
 const message = `Olá! Meu nome é ${name.value}. Vim pelo site da Promisa.\n\nMeu projeto: ${project.value}`;
 location.assign('https://wa.me/5549933811600?text=' + encodeURIComponent(message));
});
