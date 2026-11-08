
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
 // Toque ou clique: o P gira em 3D com um pulinho e solta uma onda de luz.
 art.addEventListener('pointerdown', () => {
  if (reduced.matches) return;
  art.classList.remove('is-popping');
  void art.offsetWidth;
  art.classList.add('is-popping');
 });
 art.addEventListener('animationend', event => { if (event.animationName === 'mark-pop') art.classList.remove('is-popping'); });
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
