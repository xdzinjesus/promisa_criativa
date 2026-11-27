/* =========================================================
   Promisa Criativa — interações e movimento
   Dependências locais: GSAP 3.13 + ScrollTrigger, Lenis 1.3.4
   ========================================================= */
(() => {
  'use strict';

  /* ---------- Configuração editável ---------- */
  // Canal CONFIRMADO: número publicado em promisa.online.
  const WHATSAPP = '5549933811600';
  const WA_URL = `https://wa.me/${WHATSAPP}`;

  // Regra comercial do configurador "Monte seu projeto".
  // Planos, páginas, rodadas e artes conferem com promisa.online. Valores: sob consulta.
  const PLANNER = {
    segmentos: {
      arte:        { label: 'Tatuagem e arte', brand: 'SEU ESTÚDIO',     kicker: 'Tatuagem · ilustração', title: 'Traço pesado. Atitude de sobra.',               cta: 'Agendar pelo WhatsApp', bg: '#14092a', accent: '#a46bff' },
      loja:        { label: 'Loja',            brand: 'SUA LOJA',        kicker: 'Vitrine online',        title: 'A vitrine da sua loja, aberta 24h.',             cta: 'Ver produtos',          bg: '#0d3b3a', accent: '#f5a524' },
      restaurante: { label: 'Restaurante',     brand: 'SEU RESTAURANTE', kicker: 'Cardápio · delivery',   title: 'O sabor que a cidade comenta.',                  cta: 'Pedir pelo WhatsApp',   bg: '#2b0f0a', accent: '#ff7a3d' },
      beleza:      { label: 'Beleza',          brand: 'SEU SALÃO',       kicker: 'Cabelo · estética',     title: 'Sua melhor versão começa aqui.',                 cta: 'Agendar horário',       bg: '#2a0a24', accent: '#ff4fa3' },
      saude:       { label: 'Saúde',           brand: 'SUA CLÍNICA',     kicker: 'Cuidado · bem-estar',   title: 'Cuidado que começa no primeiro clique.',         cta: 'Marcar consulta',       bg: '#0b2540', accent: '#5cc8ff' },
      servicos:    { label: 'Serviços',        brand: 'SUA EMPRESA',     kicker: 'Orçamento rápido',      title: 'Serviço caprichado, orçamento sem enrolação.',   cta: 'Pedir orçamento',       bg: '#1a1a1a', accent: '#ffd23f' },
      outro:       { label: 'Outro',           brand: 'SUA MARCA',       kicker: 'Presença digital',      title: 'Sua marca, com a presença que merece.',          cta: 'Falar no WhatsApp',     bg: '#09080e', accent: '#9c6aff' }
    },
    objetivos: {
      google:     { label: 'Aparecer no Google e passar confiança', plano: 'essencial' },
      pedidos:    { label: 'Receber pedidos e orçamentos pelo site', plano: 'profissional' },
      referencia: { label: 'Virar referência do segmento na região', plano: 'premium' }
    },
    logos: { sim: 'Já tenho logo', modernizar: 'Tenho logo, mas quero modernizar', nao: 'Ainda não tenho logo' },
    planos: {
      essencial:    { nome: 'Essencial',    paginas: 1,  paginasTxt: '1',      ajustes: 2, artes: 0,  motivo: 'Você quer aparecer no Google e passar confiança logo. O Essencial entrega uma página única e rápida, com WhatsApp, Instagram e mapa.' },
      profissional: { nome: 'Profissional', paginas: 5,  paginasTxt: 'até 5',  ajustes: 3, artes: 0,  motivo: 'Você quer receber pedidos pelo site. O Profissional traz até 5 páginas, catálogo e formulário de orçamento direto no WhatsApp.' },
      premium:      { nome: 'Premium',      paginas: 10, paginasTxt: 'até 10', ajustes: 5, artes: 15, motivo: 'Você quer ser a referência da região. O Premium junta marca, site com animações premium, Google e Instagram na mesma direção.' }
    },
    max: { paginas: 10, ajustes: 5, artes: 15 },
    padrao: { segmento: 'arte', objetivo: 'pedidos', logo: 'sim' }
  };

  /* ---------- Utilidades ---------- */
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const html = document.documentElement;
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const fine = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  const G = window.gsap;
  const ST = window.ScrollTrigger;
  const ok = !!(G && ST);
  const pad2 = n => String(n).padStart(2, '0');
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const store = {
    get(k) { try { return JSON.parse(window.sessionStorage.getItem(k)); } catch (e) { return null; } },
    set(k, v) { try { window.sessionStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* armazenamento indisponível */ } },
    del(k) { try { window.sessionStorage.removeItem(k); } catch (e) { /* idem */ } }
  };
  const set = (el, vars) => { if (!el) return; if (ok) G.set(el, vars); };
  const onVisible = (el, cb, margin = '0px') => {
    if (!el || !('IntersectionObserver' in window)) { cb(true); return; }
    new IntersectionObserver(entries => entries.forEach(e => cb(e.isIntersecting)), { rootMargin: margin }).observe(el);
  };

  if (ok) G.registerPlugin(ST);

  /* ---------- Links do WhatsApp com mensagem ---------- */
  $$('[data-wa]').forEach(a => { a.href = `${WA_URL}?text=${encodeURIComponent(a.dataset.wa)}`; });

  /* ---------- Rolagem suave (Lenis) ---------- */
  let lenis = null;
  let velocity = 0;
  if (ok && !reduce && window.Lenis) {
    lenis = new window.Lenis({ lerp: 0.1, smoothWheel: true, wheelMultiplier: 1 });
    lenis.on('scroll', e => { velocity = e.velocity || 0; ST.update(); });
    G.ticker.add(t => lenis.raf(t * 1000));
    G.ticker.lagSmoothing(0);
  } else {
    let lastY = window.scrollY;
    window.addEventListener('scroll', () => { velocity = window.scrollY - lastY; lastY = window.scrollY; }, { passive: true });
  }
  if (ok) G.ticker.add(() => { velocity *= 0.92; });

  const scrollToEl = el => {
    if (!el) return;
    if (lenis) lenis.scrollTo(el, { offset: -84, duration: 1.25 });
    else el.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
  };

  /* ---------- Menu ---------- */
  const nav = $('[data-nav]');
  const menu = $('[data-menu]');
  const toggle = $('[data-menu-toggle]');
  const toggleLabel = $('[data-menu-label]');
  let menuOpen = false;
  let lastFocus = null;

  function openMenu() {
    menuOpen = true;
    lastFocus = document.activeElement;
    menu.hidden = false;
    nav.classList.add('is-open');
    toggle.setAttribute('aria-expanded', 'true');
    toggleLabel.textContent = 'Fechar menu';
    html.classList.add('menu-open');
    if (lenis) lenis.stop();
    if (ok && !reduce) {
      G.fromTo(menu, { clipPath: 'circle(0% at 50% 0%)' }, { clipPath: 'circle(150% at 50% 0%)', duration: 0.8, ease: 'expo.out' });
      G.fromTo($$('.menu__list li, .menu__aside > *', menu), { y: 36, opacity: 0 }, { y: 0, opacity: 1, duration: 0.7, stagger: 0.04, ease: 'power3.out', delay: 0.08 });
    }
    const first = $('.menu__list a', menu);
    if (first) first.focus({ preventScroll: true });
  }
  function closeMenu(restoreFocus = true) {
    if (!menuOpen) return;
    menuOpen = false;
    nav.classList.remove('is-open');
    toggle.setAttribute('aria-expanded', 'false');
    toggleLabel.textContent = 'Abrir menu';
    html.classList.remove('menu-open');
    if (lenis) lenis.start();
    const done = () => { menu.hidden = true; };
    if (ok && !reduce) G.to(menu, { clipPath: 'circle(0% at 50% 0%)', duration: 0.5, ease: 'expo.in', onComplete: done });
    else done();
    if (restoreFocus && lastFocus) lastFocus.focus({ preventScroll: true });
  }
  toggle.addEventListener('click', () => (menuOpen ? closeMenu() : openMenu()));
  document.addEventListener('keydown', e => {
    if (!menuOpen) return;
    if (e.key === 'Escape') { e.preventDefault(); closeMenu(); return; }
    if (e.key === 'Tab') {
      const items = [toggle, ...$$('a, button', menu)].filter(el => el.offsetParent !== null);
      const i = items.indexOf(document.activeElement);
      if (e.shiftKey && (i <= 0)) { e.preventDefault(); items[items.length - 1].focus(); }
      else if (!e.shiftKey && i === items.length - 1) { e.preventDefault(); items[0].focus(); }
    }
  });

  /* ---------- Âncoras internas ---------- */
  document.addEventListener('click', e => {
    const a = e.target.closest('a[href^="#"]');
    if (!a) return;
    const id = a.getAttribute('href');
    if (id.length < 2) return;
    const target = document.getElementById(id.slice(1));
    if (!target) return;
    e.preventDefault();
    const wasOpen = menuOpen;
    closeMenu(false);
    const go = () => {
      scrollToEl(target);
      if (history.replaceState) history.replaceState(null, '', id);
      if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
      target.focus({ preventScroll: true });
    };
    if (wasOpen && ok && !reduce) setTimeout(go, 220); else go();
  });

  /* ---------- Divisão de palavras para revelação ---------- */
  function split(el) {
    const units = [];
    const walk = node => {
      Array.from(node.childNodes).forEach(child => {
        if (child.nodeType === 3) {
          const text = child.textContent;
          if (!text.trim()) { child.textContent = /\s/.test(text) ? ' ' : ''; return; }
          const inStrike = !!(child.parentElement && child.parentElement.closest('.strike'));
          const parts = text.split(/(\s+)/).filter(Boolean);
          const frag = document.createDocumentFragment();
          parts.forEach((p, i) => {
            if (/^\s+$/.test(p)) { frag.appendChild(document.createTextNode(inStrike ? '​' : ' ')); return; }
            const w = document.createElement('span'); w.className = 'w';
            const wi = document.createElement('span'); wi.className = 'wi';
            const next = parts[i + 1];
            wi.textContent = inStrike && next && /^\s+$/.test(next) ? p + ' ' : p;
            w.appendChild(wi); frag.appendChild(w); units.push(w);
          });
          child.replaceWith(frag);
        } else if (child.nodeType === 1) {
          if (child.matches('.hl, .shape, .stk, [data-unit]')) {
            const w = document.createElement('span'); w.className = 'w w--unit';
            const wi = document.createElement('span'); wi.className = 'wi';
            child.replaceWith(w); wi.appendChild(child); w.appendChild(wi); units.push(w);
          } else if (!child.matches('svg, img, br')) {
            walk(child);
          }
        }
      });
    };
    walk(el);
    $$('.strike', el).forEach(s => $$('.w', s).forEach((w, i) => w.style.setProperty('--i', i)));
    el.classList.add('is-split');
    return units;
  }

  const splitEls = $$('[data-split]');
  if (ok && !reduce) {
    html.classList.add('split-on');
    splitEls.forEach(el => {
      split(el);
      G.set($$('.wi', el), { yPercent: 118, rotate: 3 });
    });
  } else {
    splitEls.forEach(el => el.classList.add('is-split'));
    $$('.strike').forEach(s => s.classList.add('is-struck'));
  }

  function revealSplit(el, delay = 0) {
    const wis = $$('.wi', el);
    const hls = $$('.hl', el);
    const tl = G.timeline({ delay });
    tl.to(wis, { yPercent: 0, rotate: 0, duration: 1, ease: 'expo.out', stagger: 0.035 });
    if (hls.length) tl.fromTo(hls, { scale: 0.72, rotate: -5 }, { scale: 1, rotate: 0, duration: 0.7, ease: 'back.out(2.6)', stagger: 0.08 }, '-=0.75');
    tl.call(() => { $$('.strike', el).forEach(s => s.classList.add('is-struck')); el.classList.add('is-in'); }, null, '-=0.4');
    return tl;
  }

  /* ---------- Entrada (cortina + hero) ---------- */
  const curtain = $('.curtain');
  function heroIn() {
    const title = $('#hero-title');
    const tl = G.timeline();
    tl.add(revealSplit(title), 0)
      .fromTo('.hero__title .shape', { scale: 0, rotate: -120 }, { scale: 1, rotate: 0, duration: 0.9, ease: 'back.out(2)', stagger: 0.12 }, 0.25)
      .fromTo('[data-hero-tag]', { y: -40, opacity: 0, rotate: -20 }, { y: 0, opacity: 1, rotate: 0, duration: 0.9, ease: 'back.out(2.2)', stagger: 0.12 }, 0.5)
      .fromTo('[data-seal]', { scale: 0.4, rotate: -140, opacity: 0 }, { scale: 1, rotate: 0, opacity: 1, duration: 1.3, ease: 'back.out(1.5)' }, 0.35)
      .fromTo('[data-hero-fade]', { y: 26, opacity: 0 }, { y: 0, opacity: 1, duration: 0.9, ease: 'power3.out', stagger: 0.1 }, 0.6)
      .fromTo('.hero__marquee', { opacity: 0 }, { opacity: 1, duration: 1 }, 0.8);
    return tl;
  }
  function startIntro() {
    if (!ok || reduce) { if (curtain) curtain.remove(); return; }
    G.set(['[data-hero-tag]', '[data-seal]', '[data-hero-fade]', '.hero__marquee'], { opacity: 0 });
    const tl = G.timeline({ delay: 0.1 });
    tl.to('.curtain__inner', { scale: 0.86, opacity: 0, duration: 0.45, ease: 'power2.in' })
      .to(curtain, { yPercent: -100, duration: 0.95, ease: 'expo.inOut', onComplete: () => curtain && curtain.remove() }, '-=0.05')
      .add(heroIn(), '-=0.55');
  }
  const fontsReady = document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve();
  Promise.race([fontsReady, new Promise(r => setTimeout(r, 1400))]).then(() => {
    startIntro();
    if (ok) ST.refresh();
    if (location.hash && location.hash.length > 1) {
      const t = document.getElementById(location.hash.slice(1));
      if (t) setTimeout(() => scrollToEl(t), reduce ? 0 : 900);
    }
  });

  if (!ok) {
    // Sem GSAP: conteúdo completo e estático.
    $$('[data-split]').forEach(el => el.classList.add('is-split'));
  }

  /* ---------- Revelações por rolagem ---------- */
  if (ok && !reduce) {
    splitEls.forEach(el => {
      if (el.dataset.split === 'hero') return;
      ST.create({ trigger: el, start: 'top 88%', once: true, onEnter: () => revealSplit(el) });
    });
    G.set('[data-reveal]', { opacity: 0, y: 34 });
    ST.batch('[data-reveal]', {
      start: 'top 90%', once: true,
      onEnter: els => G.to(els, { opacity: 1, y: 0, duration: 0.9, ease: 'power3.out', stagger: 0.08, overwrite: 'auto' })
    });

    // Contadores
    $$('[data-count]').forEach(el => {
      const end = +el.dataset.count; const p = +el.dataset.pad || 0; const o = { v: 0 };
      el.textContent = String(0).padStart(p, '0');
      ST.create({ trigger: el, start: 'top 92%', once: true, onEnter: () => G.to(o, { v: end, duration: 1.4, ease: 'power2.out', onUpdate: () => { el.textContent = String(Math.round(o.v)).padStart(p, '0'); } }) });
    });

    // Asterisco que gira com a rolagem
    $$('[data-spin-scroll]').forEach(el => G.to(el, { rotate: 300, ease: 'none', scrollTrigger: { trigger: el.closest('section'), start: 'top bottom', end: 'bottom top', scrub: true } }));

    // Paralaxe das figurinhas do CTA final
    $$('[data-parallax]').forEach(el => G.to(el, { y: () => +el.dataset.parallax * 220, ease: 'none', scrollTrigger: { trigger: el.closest('section'), start: 'top bottom', end: 'bottom top', scrub: true } }));

    // Linha ondulada desenhada pela rolagem
    const sq = $('[data-squiggle-clip]');
    if (sq) G.fromTo(sq, { attr: { width: 0 } }, { attr: { width: 1440 }, ease: 'none', scrollTrigger: { trigger: '.planner', start: 'top 95%', end: 'top 35%', scrub: 0.6 } });
  }

  /* ---------- Cartas das promessas quebradas ---------- */
  if (ok && !reduce) {
    const mm = G.matchMedia();
    const deal = $('[data-deal]');
    const cards = $$('.pcard', deal);
    const stamp = $('[data-deal-stamp]');
    const rots = [-16, 11, -9, 13, -12];
    const xs = [-30, 18, -6, -16, 26];

    mm.add('(min-width: 1024px) and (min-height: 700px)', () => {
      const tl = G.timeline({
        scrollTrigger: { trigger: deal, start: 'top 18%', end: '+=1500', pin: true, scrub: 0.7, anticipatePin: 1 }
      });
      cards.forEach((c, i) => {
        tl.fromTo(c, { y: () => window.innerHeight * 0.95, xPercent: xs[i], rotate: rots[i] }, { y: 0, xPercent: 0, rotate: 0, ease: 'power3.out', duration: 1 }, i * 0.7);
      });
      tl.fromTo(stamp, { scale: 0, rotate: -40, opacity: 0 }, { scale: 1, rotate: 0, opacity: 1, ease: 'back.out(3)', duration: 0.6 });
      tl.to({}, { duration: 0.4 });
    });
    mm.add('(max-width: 1023px), (max-height: 699px)', () => {
      cards.forEach((c, i) => {
        G.fromTo(c, { x: i % 2 ? 60 : -60, rotate: i % 2 ? 6 : -6, opacity: 0 }, { x: 0, rotate: 0, opacity: 1, duration: 0.9, ease: 'back.out(1.6)', scrollTrigger: { trigger: c, start: 'top 90%', once: true } });
      });
      G.fromTo(stamp, { scale: 0, opacity: 0 }, { scale: 1, opacity: 1, ease: 'back.out(3)', duration: 0.6, scrollTrigger: { trigger: stamp, start: 'top 92%', once: true } });
    });

    // Cartões empilhados do "Dois caminhos"
    mm.add('(min-width: 1024px) and (min-height: 760px)', () => {
      const [c1, c2] = $$('[data-stack-card]');
      if (!c1 || !c2) return;
      const shade = $('.stack-card__shade', c1);
      const st = { trigger: c2, start: 'top bottom', end: 'top 30%', scrub: true };
      G.fromTo(c1, { scale: 1 }, { scale: 0.92, ease: 'none', scrollTrigger: st });
      if (shade) G.fromTo(shade, { opacity: 0 }, { opacity: 0.5, ease: 'none', scrollTrigger: { ...st } });
    });
  }

  /* ---------- Marquees (velocidade reage à rolagem) ---------- */
  $$('[data-marquee]').forEach(m => {
    const track = $('.marquee__track', m);
    const group = $('.marquee__group', m);
    if (!track || !group) return;
    const copies = Math.max(2, Math.ceil((window.innerWidth * 2.2) / Math.max(group.offsetWidth, 1)));
    for (let i = 0; i < copies; i++) { const c = group.cloneNode(true); c.setAttribute('aria-hidden', 'true'); track.appendChild(c); }
    if (!ok || reduce) return;
    const speed = parseFloat(m.dataset.speed || '1');
    const baseDir = parseFloat(m.dataset.dir || '1');
    let dir = 1; let x = 0; let visible = true;
    onVisible(m, v => { visible = v; }, '100px');
    G.ticker.add(() => {
      if (!visible) return;
      if (velocity > 0.5) dir = 1; else if (velocity < -0.5) dir = -1;
      const gw = group.offsetWidth || 1;
      x -= (0.55 * speed + Math.min(Math.abs(velocity) * 0.28, 16)) * dir * baseDir;
      if (x <= -gw) x += gw;
      if (x > 0) x -= gw;
      track.style.transform = `translate3d(${x}px,0,0)`;
    });
  });

  /* ---------- Selo giratório do hero ---------- */
  const sealSpin = $('.seal__spin');
  if (sealSpin && ok && !reduce) {
    let rot = 0;
    G.ticker.add(() => { rot += 0.12 + Math.min(Math.abs(velocity) * 0.06, 3); sealSpin.setAttribute('transform', `rotate(${rot % 360} 150 150)`); });
  }

  /* ---------- Olhos que seguem o cursor ---------- */
  const eyeSets = $$('[data-eyes], .mascot__eyes').map(svg => {
    const vb = svg.viewBox.baseVal;
    const pupils = $$('.pupil', svg).map(p => ({ el: p, cx: +p.getAttribute('cx'), cy: +p.getAttribute('cy') }));
    const shines = $$('.pupil-shine', svg).map(p => ({ el: p, cx: +p.getAttribute('cx'), cy: +p.getAttribute('cy') }));
    return { svg, vb, pupils, shines };
  });
  function lookAt(px, py) {
    eyeSets.forEach(({ svg, vb, pupils, shines }) => {
      const r = svg.getBoundingClientRect();
      if (r.width === 0) return;
      const k = vb.width / r.width;
      pupils.forEach((p, i) => {
        const ex = r.left + (p.cx / vb.width) * r.width;
        const ey = r.top + (p.cy / vb.height) * r.height;
        const a = Math.atan2(py - ey, px - ex);
        const d = Math.min(7, Math.hypot(px - ex, py - ey) * k / 14);
        const dx = Math.cos(a) * d; const dy = Math.sin(a) * d;
        p.el.setAttribute('cx', (p.cx + dx).toFixed(2)); p.el.setAttribute('cy', (p.cy + dy).toFixed(2));
        if (shines[i]) { shines[i].el.setAttribute('cx', (shines[i].cx + dx).toFixed(2)); shines[i].el.setAttribute('cy', (shines[i].cy + dy).toFixed(2)); }
      });
    });
  }
  if (eyeSets.length) {
    if (fine) {
      let raf = 0; let mx = 0; let my = 0;
      window.addEventListener('pointermove', e => { mx = e.clientX; my = e.clientY; if (!raf) raf = requestAnimationFrame(() => { raf = 0; lookAt(mx, my); }); }, { passive: true });
    } else if (!reduce) {
      setInterval(() => lookAt(Math.random() * window.innerWidth, Math.random() * window.innerHeight), 2200);
    }
  }

  /* ---------- Navegador do Caminho 01 (temas em loop) ---------- */
  (function browserLoop() {
    const screen = $('[data-browser-screen]');
    if (!screen) return;
    const themes = [
      { brand: 'KAETANO INK', kicker: 'Tatuagem · ilustração', title: 'Traço pesado. Atitude de sobra.', bg: '#14092a', accent: '#a46bff' },
      { brand: 'SIDI PESCA', kicker: 'Pesca · aquarismo · camping', title: 'Prepare sua próxima aventura.', bg: '#0d3b3a', accent: '#f5a524' },
      { brand: 'ESPAÇO DIVAS', kicker: 'Salão de beleza', title: 'Sua melhor versão começa aqui.', bg: '#2a0a24', accent: '#ff4fa3' }
    ];
    const brand = $('[data-browser-brand]'); const kicker = $('[data-browser-kicker]'); const title = $('[data-browser-title]');
    let i = 0; let timer = null;
    const apply = t => {
      screen.style.setProperty('--mb-bg', t.bg); screen.style.setProperty('--mb-accent', t.accent);
      brand.textContent = t.brand; kicker.textContent = t.kicker; title.textContent = t.title;
    };
    const next = () => {
      i = (i + 1) % themes.length;
      if (ok) {
        G.timeline()
          .to([kicker, title], { y: -14, opacity: 0, duration: 0.3, ease: 'power2.in', stagger: 0.04 })
          .call(() => apply(themes[i]))
          .fromTo([kicker, title], { y: 16, opacity: 0 }, { y: 0, opacity: 1, duration: 0.6, ease: 'expo.out', stagger: 0.06 });
      } else apply(themes[i]);
    };
    if (reduce) return;
    onVisible(screen, v => { if (v && !timer) timer = setInterval(next, 3400); else if (!v && timer) { clearInterval(timer); timer = null; } });
  })();

  /* ---------- Nuvem do "telefone sem fio" ---------- */
  (function chaos() {
    const box = $('[data-chaos]');
    if (!box) return;
    const syms = ['g-flower', 'g-spark', 'g-asterisk', 'g-x'];
    const colors = ['#bcb8c6', '#a9a4b5', '#d0cdd8', '#8d879a'];
    let s = 11; const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 34; i++) {
      const a = rnd() * Math.PI * 2; const rad = 24 + rnd() * 24;
      const el = document.createElement('span');
      el.className = 'chaos__bit';
      el.style.left = `${50 + Math.cos(a) * rad}%`; el.style.top = `${50 + Math.sin(a) * rad}%`;
      el.style.setProperty('--s', `${10 + Math.round(rnd() * 10)}px`);
      el.style.setProperty('--c', colors[i % colors.length]);
      el.style.setProperty('--d', `${2 + rnd() * 2.5}s`);
      el.style.setProperty('--jx', `${Math.round((rnd() - 0.5) * 14)}px`);
      el.style.setProperty('--jy', `${Math.round((rnd() - 0.5) * 14)}px`);
      el.style.setProperty('--jr', `${Math.round((rnd() - 0.5) * 120)}deg`);
      el.style.animationDelay = `${-rnd() * 4}s`;
      el.innerHTML = `<svg><use href="#${syms[i % syms.length]}"/></svg>`;
      box.appendChild(el);
    }
  })();

  /* ---------- Monte seu projeto (interação-assinatura) ---------- */
  (function planner() {
    const root = $('[data-planner]');
    if (!root) return;
    const form = $('form', root);
    const out = k => $(`[data-out="${k}"]`, root);
    const draft = $('[data-draft]', root);
    const draftText = $('#planner-draft');
    const draftOpen = $('[data-draft-open]', root);
    const draftStatus = $('[data-draft-status]', root);
    const phoneScreen = $('.phone__screen', root);
    const KEY = 'promisa-planner';
    const defaultNote = draftStatus.textContent;

    const getState = () => {
      const fd = new FormData(form);
      return {
        segmento: fd.get('segmento') || PLANNER.padrao.segmento,
        objetivo: fd.get('objetivo') || PLANNER.padrao.objetivo,
        logo: fd.get('logo') || PLANNER.padrao.logo,
        nome: (fd.get('nome') || '').toString().trim().replace(/\s+/g, ' ').slice(0, 40)
      };
    };
    const setRadio = (name, value) => { const r = form.querySelector(`input[name="${name}"][value="${value}"]`); if (r) r.checked = true; };

    function compose(st) {
      const seg = PLANNER.segmentos[st.segmento];
      const obj = PLANNER.objetivos[st.objetivo];
      const plano = PLANNER.planos[obj.plano];
      const extra = st.logo !== 'sim' && obj.plano !== 'premium';
      const lines = [
        'Olá! Vim pelo site da Promisa e montei meu projeto:',
        `• Nome: ${st.nome || '(não informado)'}`,
        `• Negócio: ${seg.label}`,
        `• Objetivo: ${obj.label}`,
        `• Logo: ${PLANNER.logos[st.logo]}`,
        `• Plano sugerido: ${plano.nome}${extra ? ' + Logo e Identidade Visual' : ''}`,
        'Pode me mandar valores e condições?'
      ];
      return lines.join('\n');
    }

    function render(animate = true) {
      const st = getState();
      const seg = PLANNER.segmentos[st.segmento];
      const obj = PLANNER.objetivos[st.objetivo];
      const plano = PLANNER.planos[obj.plano];
      out('hello').textContent = st.nome ? `Pronto, ${st.nome}.` : 'Pronto.';
      const nameChanged = out('plano').textContent !== plano.nome;
      out('plano').textContent = plano.nome;
      out('motivo').textContent = plano.motivo;
      const extra = out('extra');
      if (st.logo !== 'sim') {
        extra.hidden = false;
        extra.textContent = obj.plano === 'premium'
          ? 'O Premium já inclui a criação ou modernização do logo.'
          : 'Como a sua marca ainda precisa de logo, dá para incluir Logo e Identidade Visual à parte, ou ir de Premium, que já inclui.';
      } else { extra.hidden = true; extra.textContent = ''; }
      out('paginas').textContent = plano.paginasTxt;
      out('ajustes').textContent = `até ${plano.ajustes}`;
      out('artes').textContent = plano.artes ? `${plano.artes} artes` : '—';
      $$('[data-bar]', root).forEach(b => {
        const k = b.dataset.bar; b.style.setProperty('--w', `${(plano[k] / PLANNER.max[k]) * 100}%`);
      });
      // Prévia ilustrativa
      phoneScreen.style.setProperty('--pv-bg', seg.bg);
      phoneScreen.style.setProperty('--pv-accent', seg.accent);
      out('pv-brand').textContent = seg.brand;
      out('pv-kicker').textContent = seg.kicker;
      out('pv-title').textContent = seg.title;
      out('pv-cta').textContent = seg.cta;
      if (!draft.hidden) updateDraft();
      store.set(KEY, { segmento: st.segmento, objetivo: st.objetivo, logo: st.logo });
      if (animate && ok && !reduce) {
        if (nameChanged) G.fromTo(out('plano'), { scale: 0.6, rotate: -6 }, { scale: 1, rotate: 0, duration: 0.7, ease: 'back.out(3)' });
        G.fromTo($$('.phone__kicker, .phone__title, .phone__btn', root), { y: 12, opacity: 0 }, { y: 0, opacity: 1, duration: 0.55, ease: 'expo.out', stagger: 0.05, overwrite: 'auto' });
      }
    }
    function updateDraft() {
      const msg = compose(getState());
      draftText.value = msg;
      draftOpen.href = `${WA_URL}?text=${encodeURIComponent(msg)}`;
    }

    // Restaura escolhas anteriores (somente opções, nunca o nome)
    const saved = store.get(KEY);
    if (saved && typeof saved === 'object') {
      if (PLANNER.segmentos[saved.segmento]) setRadio('segmento', saved.segmento);
      if (PLANNER.objetivos[saved.objetivo]) setRadio('objetivo', saved.objetivo);
      if (PLANNER.logos[saved.logo]) setRadio('logo', saved.logo);
    }
    render(false);

    form.addEventListener('change', () => render(true));
    let nameTimer = 0;
    $('#planner-nome').addEventListener('input', () => { clearTimeout(nameTimer); nameTimer = setTimeout(() => render(false), 120); });

    $('[data-planner-send]', root).addEventListener('click', () => {
      updateDraft();
      const wasHidden = draft.hidden;
      draft.hidden = false;
      draftStatus.textContent = defaultNote;
      if (wasHidden && ok && !reduce) G.fromTo(draft, { y: 16, opacity: 0 }, { y: 0, opacity: 1, duration: 0.6, ease: 'expo.out' });
      draftText.focus({ preventScroll: true });
      const r = draft.getBoundingClientRect();
      if (r.bottom > window.innerHeight || r.top < 0) scrollToEl(draft);
    });
    $('[data-draft-copy]', root).addEventListener('click', async () => {
      const msg = draftText.value;
      let copied = false;
      try { await navigator.clipboard.writeText(msg); copied = true; } catch (e) {
        try { draftText.select(); copied = document.execCommand('copy'); } catch (err) { copied = false; }
      }
      draftStatus.textContent = copied ? 'Mensagem copiada. Agora é só colar no WhatsApp: +55 (49) 93381-1600.' : 'Não deu para copiar automaticamente. Selecione o texto acima e copie.';
    });
    $('[data-planner-reset]', root).addEventListener('click', () => {
      setRadio('segmento', PLANNER.padrao.segmento); setRadio('objetivo', PLANNER.padrao.objetivo); setRadio('logo', PLANNER.padrao.logo);
      $('#planner-nome').value = '';
      draft.hidden = true;
      store.del(KEY);
      render(true);
    });
  })();

  /* ---------- Pílulas de segmentos ---------- */
  (function pile() {
    const pills = $$('[data-pile] .pill');
    const rots = [-8, 5, -3, 7, -6, 3, -9, 6, -4, 8, -7, 4, -5, 9, -2, 6];
    pills.forEach((p, i) => p.style.setProperty('--r', `${rots[i % rots.length]}deg`));
    if (!ok || reduce || !pills.length) return;
    G.set(pills, { y: -260, opacity: 0 });
    ST.create({
      trigger: '[data-pile]', start: 'top 85%', once: true,
      onEnter: () => G.to(pills, { y: 0, opacity: 1, duration: 1.1, ease: 'bounce.out', stagger: { each: 0.05, from: 'random' } })
    });
  })();

  /* ---------- Raio Anti-Template ---------- */
  (function ray() {
    const stage = $('[data-ray]');
    if (!stage) return;
    const btn = $('[data-zap]'); const reset = $('[data-zap-reset]'); const label = $('[data-zap-label]');
    const target = $('[data-ray-target]'); const tag = $('[data-target-tag]');
    const word = $('[data-zap-word]'); const beams = $$('[data-beam]'); const flash = $('[data-flash]');
    const steps = $$('.ray__steps li'); const gun = $('[data-gun]'); const muzzle = $('#ray-muzzle');
    const status = $('[data-zap-status]');
    let busy = false;
    const setStep = n => steps.forEach(li => li.classList.toggle('is-on', +li.dataset.step <= n));
    const toVB = (x, y) => { const r = stage.getBoundingClientRect(); return [((x - r.left) / r.width) * 600, ((y - r.top) / r.height) * 600]; };
    const backToTemplate = () => {
      target.classList.remove('is-alive'); tag.textContent = 'Site genérico'; setStep(0);
      label.textContent = 'Disparar o raio'; reset.hidden = true; status.textContent = 'O site voltou a ser genérico.';
    };
    const done = () => {
      label.textContent = 'Disparar de novo'; reset.hidden = false;
      status.textContent = 'Pronto: o site genérico ganhou vida.';
    };
    function fire() {
      if (busy) return;
      busy = true;
      if (target.classList.contains('is-alive')) target.classList.remove('is-alive');
      tag.textContent = 'Site genérico';
      const m = muzzle.getBoundingClientRect();
      const t = target.getBoundingClientRect();
      const [mx, my] = toVB(m.left + m.width / 2, m.top + m.height / 2);
      const [tx, ty] = toVB(t.left + t.width * 0.2, t.top + t.height * 0.8);
      beams.forEach(b => { b.setAttribute('x1', mx); b.setAttribute('y1', my); b.setAttribute('x2', tx); b.setAttribute('y2', ty); });
      flash.setAttribute('cx', mx); flash.setAttribute('cy', my);
      if (!ok || reduce) {
        setStep(3); target.classList.add('is-alive'); tag.textContent = 'Site Promisa'; done(); busy = false; return;
      }
      const len = Math.hypot(tx - mx, ty - my);
      G.timeline({ onComplete: () => { busy = false; } })
        .call(() => setStep(1))
        .to(target, { scale: 1.04, duration: 0.16, ease: 'power2.out' })
        .to(target, { scale: 1, duration: 0.14 })
        .call(() => setStep(2))
        .to(gun, { x: -18, duration: 0.07, ease: 'power2.out' })
        .to(gun, { x: 0, duration: 0.5, ease: 'elastic.out(1, .4)' })
        .fromTo(flash, { attr: { r: 6 }, opacity: 1 }, { attr: { r: 36 }, opacity: 0, duration: 0.4, ease: 'power2.out' }, '<-0.05')
        .fromTo(beams, { strokeDasharray: len, strokeDashoffset: len, opacity: 1 }, { strokeDashoffset: 0, duration: 0.22, ease: 'power2.in' }, '<')
        .fromTo('.ray__burst', { scale: 1 }, { scale: 1.07, duration: 0.12, yoyo: true, repeat: 1, transformOrigin: '50% 50%' }, '<')
        .fromTo(word, { scale: 0.2, opacity: 0, rotate: -40 }, { scale: 1, opacity: 1, rotate: -12, ease: 'back.out(3)', duration: 0.5 })
        .fromTo(target, { x: 0 }, { x: 7, duration: 0.05, repeat: 5, yoyo: true, ease: 'none' }, '<')
        .call(() => { target.classList.add('is-alive'); tag.textContent = 'Site Promisa'; setStep(3); })
        .fromTo('.mini--after > *', { y: 14, opacity: 0 }, { y: 0, opacity: 1, stagger: 0.06, duration: 0.5, ease: 'back.out(2)' })
        .to(beams, { opacity: 0, duration: 0.35 }, '<')
        .call(done, null, '<0.15')
        .to(word, { opacity: 0, scale: 0.85, duration: 0.4, delay: 0.35 });
    }
    btn.addEventListener('click', fire);
    gun.addEventListener('click', fire);
    reset.addEventListener('click', () => { if (!busy) backToTemplate(); btn.focus(); });
  })();

  /* ---------- Planos: mostrar todos os itens ---------- */
  (function plans() {
    const wrap = $('[data-plans]'); const btn = $('[data-plans-toggle]'); const lbl = $('[data-plans-toggle-label]');
    if (!wrap || !btn) return;
    btn.addEventListener('click', () => {
      const exp = wrap.classList.toggle('is-expanded');
      btn.setAttribute('aria-expanded', String(exp));
      lbl.textContent = exp ? 'Mostrar menos' : 'Ver todos os 20 itens';
      if (exp && ok && !reduce) G.fromTo($$('li[data-more]', wrap), { opacity: 0, x: -10 }, { opacity: 1, x: 0, duration: 0.4, stagger: 0.012, ease: 'power2.out' });
      if (ok) ST.refresh();
    });
  })();

  /* ---------- Baralho de projetos ---------- */
  function deckInit() {
    const deck = $('[data-deck]');
    if (!deck) return;
    const cards = $$('[data-deck-card]', deck);
    const idx = $('[data-deck-index]');
    $('[data-deck-total]').textContent = pad2(cards.length);
    let order = cards.map((_, i) => i);
    let busy = false;
    const posVars = pos => ({ x: pos * 16, y: pos * 9, rotate: pos === 0 ? -2 : pos * 4, scale: 1 - pos * 0.05, opacity: pos > 3 ? 0 : 1 });
    const apply = (c, v, animate) => {
      if (ok && animate && !reduce) G.to(c, { ...v, duration: 0.6, ease: 'power3.out', overwrite: 'auto' });
      else if (ok) G.set(c, v);
      else { c.style.transform = `translate(${v.x}px,${v.y}px) rotate(${v.rotate}deg) scale(${v.scale})`; c.style.opacity = v.opacity; }
    };
    function layout(animate = true) {
      order.forEach((ci, pos) => {
        const c = cards[ci];
        c.style.zIndex = String(cards.length - pos);
        apply(c, posVars(pos), animate);
        const top = pos === 0;
        c.setAttribute('aria-hidden', String(!top));
        c.inert = !top;
      });
      idx.textContent = pad2(order[0] + 1);
    }
    function next(dir = 1) {
      if (busy) return;
      const c = cards[order[0]];
      const finish = () => {
        order.push(order.shift());
        if (ok) G.set(c, { ...posVars(cards.length - 1), opacity: 0 });
        layout(true);
        busy = false;
      };
      if (ok && !reduce) {
        busy = true;
        G.to(c, { x: dir * Math.min(window.innerWidth * 0.7, 560), rotate: dir * 24, opacity: 0, duration: 0.42, ease: 'power2.in', onComplete: finish });
      } else finish();
    }
    function prev() {
      if (busy) return;
      order.unshift(order.pop());
      const c = cards[order[0]];
      if (ok && !reduce) G.set(c, { x: -Math.min(window.innerWidth * 0.7, 560), rotate: -24, opacity: 0 });
      layout(true);
    }
    layout(false);
    $('[data-deck-next]').addEventListener('click', () => next(1));
    $('[data-deck-prev]').addEventListener('click', prev);
    deck.addEventListener('keydown', e => {
      if (e.key === 'ArrowRight') { e.preventDefault(); next(1); }
      if (e.key === 'ArrowLeft') { e.preventDefault(); prev(); }
    });
    // Arrastar
    let drag = null;
    deck.addEventListener('pointerdown', e => {
      const c = cards[order[0]];
      if (busy || !c.contains(e.target) || e.target.closest('a, button')) return;
      drag = { c, x0: e.clientX, dx: 0, t: performance.now(), id: e.pointerId };
      try { c.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    });
    deck.addEventListener('pointermove', e => {
      if (!drag || e.pointerId !== drag.id) return;
      drag.dx = e.clientX - drag.x0;
      if (ok) G.set(drag.c, { x: drag.dx, rotate: -2 + drag.dx * 0.06 });
    });
    const end = e => {
      if (!drag || (e && e.pointerId !== drag.id)) return;
      const { c, dx, t } = drag; drag = null;
      const v = dx / Math.max(performance.now() - t, 1);
      if (Math.abs(dx) > 110 || (Math.abs(v) > 0.65 && Math.abs(dx) > 30)) next(Math.sign(dx) || 1);
      else if (ok) G.to(c, { x: 0, rotate: -2, duration: 0.8, ease: 'elastic.out(1, .5)' });
    };
    deck.addEventListener('pointerup', end);
    deck.addEventListener('pointercancel', end);
  }

  /* ---------- Projetos em destaque (marcados com a estrela no painel da Promisa) ----------
     Entram na frente do baralho como prévia ao vivo de /projeto/<id>/. Sem resposta em 2,5 s,
     o baralho começa só com os projetos fixos. */
  function featuredCard(item) {
    const art = document.createElement('article');
    art.className = 'deck-card deck-card--live'; art.setAttribute('data-deck-card', '');
    const fig = document.createElement('figure'); fig.className = 'deck-card__shot';
    const box = document.createElement('div'); box.className = 'deck-live';
    const frame = document.createElement('iframe');
    frame.src = '/projeto/' + encodeURIComponent(item.id) + '/';
    frame.title = 'Prévia do site ' + item.title;
    frame.setAttribute('sandbox', 'allow-scripts'); frame.setAttribute('loading', 'lazy'); frame.setAttribute('tabindex', '-1');
    frame.setAttribute('scrolling', 'no'); frame.setAttribute('referrerpolicy', 'no-referrer'); frame.setAttribute('aria-hidden', 'true');
    box.append(frame); fig.append(box);
    const body = document.createElement('div'); body.className = 'deck-card__body';
    const chip = document.createElement('span'); chip.className = item.demo ? 'chip' : 'chip chip--purple'; chip.textContent = item.demo ? 'Site demonstrativo' : 'Projeto real';
    const h = document.createElement('h3'); h.textContent = item.title;
    body.append(chip, h);
    if (item.category) { const para = document.createElement('p'); para.textContent = item.category; body.append(para); }
    art.append(fig, body);
    return art;
  }
  function fitLive(box) { const f = box.firstElementChild; if (f) f.style.setProperty('--s', (box.clientWidth / 1440).toFixed(4)); }
  function loadFeatured() {
    const deck = $('[data-deck]');
    if (!deck || !window.fetch) return Promise.resolve();
    const ctrl = 'AbortController' in window ? new AbortController() : null;
    const timer = setTimeout(() => ctrl && ctrl.abort(), 2500);
    return fetch('/api/featured', { headers: { Accept: 'application/json' }, signal: ctrl ? ctrl.signal : undefined })
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        const items = Array.isArray(data && data.items) ? data.items.filter(i => i && typeof i.id === 'string' && typeof i.title === 'string' && i.title.trim()).slice(0, 6) : [];
        if (!items.length) return;
        const norm = t => String(t).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
        const names = new Set(items.map(i => norm(i.title)));
        // Projeto fixo com o mesmo nome sai do baralho: fica só a prévia ao vivo.
        $$('[data-deck-card]', deck).forEach(c => { const h = c.querySelector('h3'); if (h && names.has(norm(h.textContent))) deck.removeChild(c); });
        const first = $('[data-deck-card]', deck);
        const cards = items.map(featuredCard);
        cards.forEach(c => deck.insertBefore(c, first || null));
        const boxes = cards.map(c => c.querySelector('.deck-live'));
        boxes.forEach(fitLive);
        if ('ResizeObserver' in window) { const ro = new ResizeObserver(es => es.forEach(e => fitLive(e.target))); boxes.forEach(x => ro.observe(x)); }
      })
      .catch(() => {})
      .finally(() => clearTimeout(timer));
  }
  loadFeatured().then(deckInit, deckInit);

  /* ---------- Carrossel de prévias (reels) ---------- */
  (function reels() {
    const root = $('[data-reels]');
    if (!root) return;
    const items = $$('[data-reel]', root);
    const n = items.length;
    const idx = $('[data-reels-index]'); const title = $('[data-reels-title]'); const tags = $('[data-reels-tags]');
    $('[data-reels-total]').textContent = pad2(n);
    let cur = 0;
    function render(animate = true) {
      items.forEach((el, i) => {
        let off = i - cur;
        if (off > n / 2) off -= n;
        if (off < -n / 2) off += n;
        const a = Math.abs(off);
        const v = { xPercent: off * 82, scale: a ? 0.8 : 1, rotate: off * 7, opacity: a > 1 ? 0 : a ? 0.5 : 1 };
        el.style.zIndex = String(10 - a);
        if (ok && animate && !reduce) G.to(el, { ...v, duration: 0.7, ease: 'power3.out', overwrite: 'auto' });
        else if (ok) G.set(el, v);
        el.classList.toggle('is-active', i === cur);
        el.setAttribute('aria-hidden', String(i !== cur));
      });
      idx.textContent = pad2(cur + 1);
      title.textContent = items[cur].dataset.title;
      tags.textContent = items[cur].dataset.tags;
    }
    const go = d => { cur = (cur + d + n) % n; render(true); };
    $('[data-reels-prev]', root).addEventListener('click', () => go(-1));
    $('[data-reels-next]', root).addEventListener('click', () => go(1));
    items.forEach((el, i) => el.addEventListener('click', () => { if (i !== cur) { cur = i; render(true); } }));
    let sx = null;
    const stage = $('.reels__stage', root);
    stage.addEventListener('pointerdown', e => { sx = e.clientX; });
    stage.addEventListener('pointerup', e => { if (sx === null) return; const dx = e.clientX - sx; sx = null; if (Math.abs(dx) > 50) go(dx < 0 ? 1 : -1); });
    render(false);
  })();

  /* ---------- Piscina de figurinhas (física 2D simples) ---------- */
  (function pit() {
    const box = $('[data-pit]'); const floor = $('[data-pit-floor]'); const play = $('[data-pit-play]');
    if (!box || !floor || !play) return;
    const KINDS = ['s-wrench', 's-mug', 's-bolt', 's-cursor', 's-heart', 's-pencil', 's-smile', 's-star', 's-palette', 's-phone', 's-orbit', 'img', 'motto:Sem template', 'motto:Bora!', 'motto:Do zero', 's-star', 's-heart', 'img', 's-smile', 'motto:Criar é esporte', 's-bolt', 's-cursor', 's-palette', 's-mug'];
    const MAX = 60;
    let bodies = []; let W = 0; let H = 0; let running = false; let last = 0; let calm = 0; let drag = null; let visible = false; let k = 0;
    const measure = () => { W = floor.clientWidth; H = floor.clientHeight; };
    measure();
    window.addEventListener('resize', () => { measure(); bodies.forEach(b => { b.x = clamp(b.x, b.r, W - b.r); b.y = Math.min(b.y, H - b.r); }); wake(); });
    onVisible(box, v => { visible = v; if (v) wake(); });

    function make(kind, i) {
      const small = W < 600;
      const r = (small ? 24 : 32) + Math.random() * (small ? 12 : 20);
      const el = document.createElement('div');
      el.className = 'pit-body';
      el.style.width = el.style.height = `${r * 2}px`;
      if (kind === 'img') el.innerHTML = '<img src="assets/novo/img/promisa-simbolo.webp" alt="" draggable="false">';
      else if (kind.indexOf('motto:') === 0) { el.classList.add('pit-body--motto'); el.textContent = kind.slice(6); }
      else el.innerHTML = `<svg><use href="#${kind}"/></svg>`;
      floor.appendChild(el);
      return { el, r, x: r + Math.random() * Math.max(W - 2 * r, 1), y: -r - Math.random() * H * 0.6 - i * 16, vx: (Math.random() - 0.5) * 260, vy: 0, a: Math.random() * 360, va: (Math.random() - 0.5) * 220 };
    }
    function step(dt) {
      const g = 2100; const rest = 0.36;
      for (const b of bodies) {
        if (drag && drag.b === b) continue;
        b.vy += g * dt; b.x += b.vx * dt; b.y += b.vy * dt; b.a += b.va * dt;
        b.vx *= 0.995; b.va *= 0.985;
        if (b.y + b.r > H) { b.y = H - b.r; b.vy *= -rest; b.vx *= 0.86; b.va *= 0.8; if (Math.abs(b.vy) < 40) b.vy = 0; }
        if (b.x - b.r < 0) { b.x = b.r; b.vx = Math.abs(b.vx) * rest; }
        if (b.x + b.r > W) { b.x = W - b.r; b.vx = -Math.abs(b.vx) * rest; }
      }
      for (let i = 0; i < bodies.length; i++) {
        for (let j = i + 1; j < bodies.length; j++) {
          const a = bodies[i]; const c = bodies[j];
          const dx = c.x - a.x; const dy = c.y - a.y; const min = a.r + c.r;
          if (Math.abs(dx) > min || Math.abs(dy) > min) continue;
          const d = Math.hypot(dx, dy) || 0.001;
          if (d >= min) continue;
          const nx = dx / d; const ny = dy / d; const ov = min - d;
          const aFix = drag && drag.b === a; const cFix = drag && drag.b === c;
          const wa = aFix ? 0 : (cFix ? 1 : 0.5); const wc = cFix ? 0 : (aFix ? 1 : 0.5);
          a.x -= nx * ov * wa; a.y -= ny * ov * wa; c.x += nx * ov * wc; c.y += ny * ov * wc;
          const vn = (c.vx - a.vx) * nx + (c.vy - a.vy) * ny;
          if (vn < 0) {
            const imp = -(1 + rest) * vn / 2;
            if (!aFix) { a.vx -= imp * nx; a.vy -= imp * ny; a.va += vn * 0.15; }
            if (!cFix) { c.vx += imp * nx; c.vy += imp * ny; c.va -= vn * 0.15; }
          }
        }
      }
    }
    function render() { for (const b of bodies) b.el.style.transform = `translate3d(${(b.x - b.r).toFixed(1)}px,${(b.y - b.r).toFixed(1)}px,0) rotate(${b.a.toFixed(1)}deg)`; }
    function loop(t) {
      if (!running) return;
      const dt = Math.min(0.033, (t - (last || t)) / 1000); last = t;
      for (let s = 0; s < 4; s++) step(dt / 4);
      render();
      const energy = bodies.reduce((m, b) => Math.max(m, Math.abs(b.vx) + Math.abs(b.vy)), 0);
      calm = energy < 14 && !drag ? calm + 1 : 0;
      if ((calm > 45 || !visible) && !drag) { running = false; last = 0; return; }
      requestAnimationFrame(loop);
    }
    function wake() { if (!running && bodies.length && (visible || drag)) { running = true; calm = 0; last = 0; requestAnimationFrame(loop); } }
    function settleInstantly() { for (let s = 0; s < 900; s++) step(1 / 120); render(); }

    play.addEventListener('click', () => {
      if (bodies.length >= MAX) {
        bodies.forEach(b => { b.vy = -700 - Math.random() * 600; b.vx = (Math.random() - 0.5) * 500; b.va = (Math.random() - 0.5) * 600; });
      } else {
        const count = W < 600 ? 10 : 16;
        for (let i = 0; i < count && bodies.length < MAX; i++) bodies.push(make(KINDS[(k++) % KINDS.length], i));
      }
      if (reduce) { settleInstantly(); return; }
      wake();
    });

    floor.addEventListener('pointerdown', e => {
      const el = e.target.closest('.pit-body');
      if (!el) return;
      const b = bodies.find(x => x.el === el);
      if (!b) return;
      const r = floor.getBoundingClientRect();
      drag = { b, ox: e.clientX - r.left - b.x, oy: e.clientY - r.top - b.y, lx: e.clientX, ly: e.clientY, lt: performance.now(), vx: 0, vy: 0, id: e.pointerId };
      b.vx = b.vy = 0;
      try { el.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
      wake();
    });
    floor.addEventListener('pointermove', e => {
      if (!drag || e.pointerId !== drag.id) return;
      const r = floor.getBoundingClientRect(); const now = performance.now(); const dt = Math.max(now - drag.lt, 1) / 1000;
      drag.vx = (e.clientX - drag.lx) / dt; drag.vy = (e.clientY - drag.ly) / dt;
      drag.lx = e.clientX; drag.ly = e.clientY; drag.lt = now;
      const b = drag.b;
      b.x = clamp(e.clientX - r.left - drag.ox, b.r, W - b.r);
      b.y = clamp(e.clientY - r.top - drag.oy, b.r, H - b.r);
      if (reduce) render();
    });
    const release = e => {
      if (!drag || (e && e.pointerId !== drag.id)) return;
      drag.b.vx = clamp(drag.vx, -2200, 2200); drag.b.vy = clamp(drag.vy, -2200, 2200);
      drag = null;
      if (reduce) settleInstantly(); else wake();
    };
    floor.addEventListener('pointerup', release);
    floor.addEventListener('pointercancel', release);
  })();

  /* ---------- Voltar ao topo + progresso ---------- */
  (function totop() {
    const el = $('[data-totop]'); const ring = $('[data-totop-progress]');
    if (!el) return;
    const C = 144.5;
    let raf = 0;
    const upd = () => {
      raf = 0;
      const max = document.documentElement.scrollHeight - window.innerHeight;
      const p = max > 0 ? clamp(window.scrollY / max, 0, 1) : 0;
      ring.style.strokeDashoffset = String(C * (1 - p));
      el.classList.toggle('is-on', window.scrollY > window.innerHeight * 0.8);
    };
    window.addEventListener('scroll', () => { if (!raf) raf = requestAnimationFrame(upd); }, { passive: true });
    upd();
  })();

  /* ---------- Cursor personalizado + botões magnéticos ---------- */
  if (fine) {
    const cur = $('[data-cursor-el]'); const lbl = $('[data-cursor-label]');
    html.classList.add('has-cursor');
    let x = -100; let y = -100; let raf = 0;
    const paint = () => { raf = 0; cur.style.transform = `translate3d(${x}px,${y}px,0)`; };
    window.addEventListener('pointermove', e => {
      if (e.pointerType !== 'mouse') return;
      x = e.clientX; y = e.clientY; cur.classList.add('is-visible');
      if (!raf) raf = requestAnimationFrame(paint);
    }, { passive: true });
    document.addEventListener('pointerover', e => {
      const t = e.target;
      const textField = t.closest('input[type="text"], textarea');
      cur.classList.toggle('is-visible', !textField);
      const hot = t.closest('a, button, label, .deck-card, .pit-body, .gun, .reel, [data-cursor]');
      cur.classList.toggle('is-hover', !!hot);
      const host = t.closest('[data-cursor]');
      const text = host ? host.dataset.cursor : (t.closest('.pit-body') ? 'Arraste' : (t.closest('.gun') ? 'Disparar' : ''));
      lbl.textContent = text;
      cur.classList.toggle('has-label', !!text);
    });
    document.documentElement.addEventListener('mouseleave', () => cur.classList.remove('is-visible'));

    if (ok && !reduce) {
      $$('[data-magnetic]').forEach(el => {
        const xTo = G.quickTo(el, 'x', { duration: 0.6, ease: 'elastic.out(1, .45)' });
        const yTo = G.quickTo(el, 'y', { duration: 0.6, ease: 'elastic.out(1, .45)' });
        el.addEventListener('pointermove', e => {
          const r = el.getBoundingClientRect();
          xTo((e.clientX - (r.left + r.width / 2)) * 0.22);
          yTo((e.clientY - (r.top + r.height / 2)) * 0.3);
        });
        el.addEventListener('pointerleave', () => { xTo(0); yTo(0); });
      });
    }
  }

  /* ---------- Atualiza posições depois que tudo carrega ---------- */
  window.addEventListener('load', () => { if (ok) ST.refresh(); });
})();

(() => {
  let opener;
  document.addEventListener('click', event => {
    const trigger = event.target.closest('[data-person]');
    if (trigger) {
      const dialog = document.getElementById('person-' + trigger.dataset.person);
      if (!dialog || dialog.open) return;
      opener = trigger;
      dialog.showModal();
      dialog.querySelector('button').focus();
    }
    const close = event.target.closest('.person-dialog__close');
    if (close) close.closest('dialog').close();
  });
  document.querySelectorAll('.person-dialog').forEach(dialog => {
    dialog.addEventListener('click', event => {
      const bounds = dialog.getBoundingClientRect();
      if (event.target === dialog && (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom)) dialog.close();
    });
    dialog.addEventListener('close', () => { if (opener?.isConnected) opener.focus({ preventScroll: true }); });
  });
})();
