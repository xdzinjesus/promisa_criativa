// Modelos de site por ramo de atividade e o gerador do HTML (demonstração do "Painel do cliente").
// Puro: sem DOM, sem rede, sem scripts no site gerado. Tudo que vem do formulário é escapado;
// só aceita imagens data:image (jpg/png/webp) em base64. Fontes do sistema (carregam na hora, sem CDN).

const SERIF = '"Playfair Display",Georgia,"Times New Roman",serif';
const SANS = 'system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif';
const CONDENSED = '"Bebas Neue",Impact,Haettenschweiler,"Arial Narrow Bold","Franklin Gothic Bold",sans-serif';
const ELEGANT = '"Cormorant Garamond","Didot","Bodoni MT",Georgia,serif';

export const NICHES = {
  barbearia: {
    label: 'Barbearia', icon: '💈', items: 'Serviços', cta: 'Agendar horário', kicker: 'Barbearia clássica',
    look: { head: SERIF, body: SANS, layout: 'list', radius: '6px', upper: true, pattern: 'pole' },
    palettes: [['#c8a35a', '#14110e'], ['#d9480f', '#141010'], ['#4c8dff', '#0c111c'], ['#22b573', '#0c1310']],
    defaults: {
      name: 'Barbearia Navalha', slogan: 'Corte clássico, barba na navalha e aquele atendimento de primeira.',
      about: 'Mais de 10 anos cuidando do visual dos homens da cidade. Ambiente climatizado, café por conta da casa e profissionais que entendem do assunto.',
      items: [{ name: 'Corte masculino', price: '45', desc: 'Tesoura ou máquina, com lavagem e finalização.' }, { name: 'Barba completa', price: '35', desc: 'Toalha quente, navalha e hidratação.' }, { name: 'Corte + barba', price: '70', desc: 'O combo mais pedido da casa.' }, { name: 'Pigmentação', price: '30', desc: 'Disfarça falhas e realça o desenho.' }, { name: 'Sobrancelha', price: '15', desc: 'Na navalha ou pinça.' }],
      highlights: ['Ambiente climatizado', 'Café e cerveja gelada', 'Pagamento no Pix e cartão'],
      hours: 'Seg a Sex: 9h às 20h\nSábado: 8h às 17h', promo: 'Terça do combo: corte + barba por R$ 60!'
    }
  },
  restaurante: {
    label: 'Restaurante', icon: '🍽️', items: 'Cardápio', cta: 'Fazer pedido', kicker: 'Comida de verdade',
    look: { head: SERIF, body: SANS, layout: 'menu', radius: '18px', upper: false, pattern: 'dots' },
    palettes: [['#e8590c', '#fff8f1'], ['#c92a2a', '#fffaf5'], ['#2f9e44', '#f6fbf4'], ['#9c36b5', '#fcf7ff']],
    defaults: {
      name: 'Sabor da Casa', slogan: 'Comida caseira, feita com carinho todos os dias.',
      about: 'Buffet livre no almoço e pratos à la carte à noite. Ingredientes frescos de produtores da região e aquele tempero de vó.',
      items: [{ name: 'Buffet livre', price: '39,90', desc: 'Almoço de segunda a sábado, com sobremesa.' }, { name: 'Marmita grande', price: '24', desc: 'Arroz, feijão, 2 carnes e salada.' }, { name: 'Prato executivo', price: '32', desc: 'Filé grelhado, arroz, fritas e salada.' }, { name: 'Parmegiana para 2', price: '79', desc: 'Com arroz e fritas.' }, { name: 'Sobremesa do dia', price: '9', desc: 'Pergunte ao garçom.' }],
      highlights: ['Entrega na cidade', 'Ingredientes da região', 'Espaço kids'],
      hours: 'Almoço: 11h às 14h30\nJantar: 18h às 22h (qui a sáb)', promo: 'Entrega grátis no centro para pedidos acima de R$ 50.'
    }
  },
  oficina: {
    label: 'Oficina / Pneus', icon: '🔧', items: 'Serviços', cta: 'Pedir orçamento', kicker: 'Centro automotivo',
    look: { head: CONDENSED, body: SANS, layout: 'cards', radius: '4px', upper: true, pattern: 'hazard' },
    palettes: [['#f59f00', '#101214'], ['#e03131', '#111111'], ['#1c7ed6', '#0d141e'], ['#37b24d', '#0f1410']],
    defaults: {
      name: 'Auto Center Rota', slogan: 'Seu carro em boas mãos, com preço justo e garantia.',
      about: 'Pneus, alinhamento, balanceamento e mecânica em geral. Orçamento sem compromisso, peças de qualidade e garantia em todos os serviços.',
      items: [{ name: 'Alinhamento 3D', price: '60', desc: 'Com laudo computadorizado.' }, { name: 'Balanceamento', price: '50', desc: 'As 4 rodas, com válvulas.' }, { name: 'Troca de óleo', price: 'a partir de 120', desc: 'Óleo e filtro inclusos.' }, { name: 'Pneus novos', price: 'consulte', desc: 'Trabalhamos com as melhores marcas.' }, { name: 'Freios', price: 'consulte', desc: 'Pastilhas, discos e fluido.' }],
      highlights: ['Garantia em todos os serviços', 'Orçamento sem compromisso', 'Parcelamos no cartão'],
      hours: 'Seg a Sex: 7h30 às 18h\nSábado: 7h30 às 12h', promo: 'Na compra de 4 pneus, o alinhamento é por nossa conta.'
    }
  },
  estetica: {
    label: 'Salão / Estética', icon: '💅', items: 'Serviços', cta: 'Agendar horário', kicker: 'Beleza e bem-estar',
    look: { head: ELEGANT, body: SANS, layout: 'soft', radius: '28px', upper: false, pattern: 'blobs' },
    palettes: [['#d6336c', '#fff7fa'], ['#ae3ec9', '#fdf7ff'], ['#b07a3b', '#fffaf3'], ['#0ca678', '#f4fcf9']],
    defaults: {
      name: 'Studio Bella', slogan: 'Realce a sua beleza natural, no seu tempo.',
      about: 'Cabelo, unhas, sobrancelhas e estética facial em um espaço pensado para o seu bem-estar. Produtos de qualidade e atendimento com hora marcada.',
      items: [{ name: 'Escova', price: '50', desc: 'Lisa ou modelada.' }, { name: 'Manicure e pedicure', price: '55', desc: 'Esmaltação comum ou em gel.' }, { name: 'Design de sobrancelha', price: '35', desc: 'Com henna: R$ 45.' }, { name: 'Limpeza de pele', price: '120', desc: 'Profunda, com extração e máscara.' }, { name: 'Coloração', price: 'a partir de 90', desc: 'Raiz ou cabelo todo.' }],
      highlights: ['Hora marcada, sem espera', 'Produtos profissionais', 'Ambiente acolhedor'],
      hours: 'Ter a Sex: 9h às 19h\nSábado: 8h às 16h', promo: 'Mês do cuidado: 15% de desconto na limpeza de pele.'
    }
  },
  loja: {
    label: 'Loja', icon: '🛍️', items: 'Produtos', cta: 'Comprar pelo WhatsApp', kicker: 'Novidades toda semana',
    look: { head: SANS, body: SANS, layout: 'products', radius: '20px', upper: false, pattern: 'grid' },
    palettes: [['#7048e8', '#f8f7ff'], ['#1098ad', '#f3fbfc'], ['#f76707', '#fff9f3'], ['#212529', '#f8f9fa']],
    defaults: {
      name: 'Loja Ponto Certo', slogan: 'Moda e acessórios com o seu estilo, sem sair de casa.',
      about: 'Roupas femininas e masculinas, calçados e acessórios. Novidades toda semana, troca fácil e entrega na cidade.',
      items: [{ name: 'Camiseta básica', price: '59,90', desc: 'Algodão, várias cores.' }, { name: 'Calça jeans', price: '149,90', desc: 'Modelagem confortável.' }, { name: 'Tênis casual', price: '199,90', desc: 'Do 34 ao 44.' }, { name: 'Bolsa transversal', price: '89,90', desc: 'Couro sintético.' }, { name: 'Boné aba curva', price: '69,90', desc: 'Ajuste traseiro.' }, { name: 'Óculos de sol', price: '79,90', desc: 'Proteção UV400.' }],
      highlights: ['Entrega na cidade', 'Troca fácil em 7 dias', 'Até 3x sem juros'],
      hours: 'Seg a Sex: 9h às 18h30\nSábado: 9h às 13h', promo: 'Frete grátis na cidade em compras acima de R$ 150.'
    }
  }
};

export function newDraft(niche = 'barbearia') {
  const key = NICHES[niche] ? niche : 'barbearia';
  return {
    version: 2, niche: key, palette: 0,
    ...structuredClone(NICHES[key].defaults), whatsapp: '49999999999', instagram: '', address: 'Rua Principal, 100 - Centro, Concórdia/SC',
    showPromo: true, logo: '', cover: '', gallery: []
  };
}

export const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
export const safeImage = src => typeof src === 'string' && /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(src) && src.length < 3_000_000 ? src : '';
export const phoneDigits = value => { const d = String(value || '').replace(/\D/g, ''); return d.length >= 10 && d.length <= 11 ? '55' + d : d.length >= 12 && d.length <= 13 ? d : ''; };
export const igHandle = value => String(value || '').trim().replace(/^@/, '').replace(/^https?:\/\/(www\.)?instagram\.com\//i, '').replace(/[/?#].*$/, '').replace(/[^\w.]/g, '').slice(0, 30);
export const priceText = value => { const v = String(value || '').trim(); if (!v) return ''; return /^\d+([.,]\d{1,2})?$/.test(v) ? 'R$ ' + v : v; };
const rgb = hex => { const n = parseInt(String(hex).slice(1), 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; };
const isDarkBg = hex => { const [r, g, b] = rgb(hex); return (r * 299 + g * 587 + b * 114) / 1000 < 128; };
const alpha = (hex, a) => `rgba(${rgb(hex).join(',')},${a})`;

// Texturas de fundo do topo, uma por ramo (só CSS).
function pattern(kind, p) {
  if (kind === 'pole') return `repeating-linear-gradient(-45deg,${alpha(p, .10)} 0 14px,transparent 14px 34px),radial-gradient(ellipse at 80% 0%,${alpha(p, .35)},transparent 60%),linear-gradient(160deg,#1d1914,#0b0907)`;
  if (kind === 'hazard') return `linear-gradient(115deg,transparent 62%,${alpha(p, .16)} 62% 64%,transparent 64% 67%,${alpha(p, .16)} 67% 69%,transparent 69%),radial-gradient(ellipse at 15% 100%,${alpha(p, .35)},transparent 55%),linear-gradient(160deg,#1a1d21,#08090a)`;
  if (kind === 'dots') return `radial-gradient(${alpha(p, .22)} 1.5px,transparent 1.6px) 0 0/22px 22px,radial-gradient(ellipse at 90% 10%,${alpha(p, .45)},transparent 55%),linear-gradient(150deg,#2b1a10,#120a06)`;
  if (kind === 'blobs') return `radial-gradient(circle at 15% 25%,${alpha(p, .45)},transparent 40%),radial-gradient(circle at 85% 70%,${alpha(p, .35)},transparent 42%),linear-gradient(135deg,#2a1622,#140b12)`;
  return `linear-gradient(${alpha('#ffffff', .05)} 1px,transparent 1px) 0 0/40px 40px,linear-gradient(90deg,${alpha('#ffffff', .05)} 1px,transparent 1px) 0 0/40px 40px,radial-gradient(ellipse at 70% 20%,${alpha(p, .55)},transparent 60%),linear-gradient(150deg,#16141f,#08070c)`;
}

const ICONS = ['✦', '✦', '✦'];
const WA_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2zm5.3 14.1c-.2.6-1.3 1.2-1.8 1.2-.5.1-1 .2-3.3-.7-2.8-1.1-4.5-3.9-4.7-4.1-.1-.2-1.1-1.5-1.1-2.8s.7-2 1-2.3c.2-.3.5-.3.7-.3h.5c.2 0 .4 0 .6.5l.8 2c.1.2.1.4 0 .5l-.4.6-.4.4c-.1.2-.3.3-.1.6.2.3.8 1.3 1.7 2.1 1.2 1 2.1 1.4 2.4 1.5.3.1.5.1.7-.1l.9-1.1c.2-.3.4-.2.6-.1l2 .9c.3.1.5.2.5.3.1.2.1.7-.1 1.3z"/></svg>';
const IG_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 2h10a5 5 0 0 1 5 5v10a5 5 0 0 1-5 5H7a5 5 0 0 1-5-5V7a5 5 0 0 1 5-5zm0 2a3 3 0 0 0-3 3v10a3 3 0 0 0 3 3h10a3 3 0 0 0 3-3V7a3 3 0 0 0-3-3H7zm5 3.5a4.5 4.5 0 1 1 0 9 4.5 4.5 0 0 1 0-9zm0 2a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5zM17.5 6a1 1 0 1 1 0 2 1 1 0 0 1 0-2z"/></svg>';
const PIN_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2a7 7 0 0 1 7 7c0 5-7 13-7 13S5 14 5 9a7 7 0 0 1 7-7zm0 4.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z"/></svg>';

export function renderSite(draft) {
  const niche = NICHES[draft.niche] || NICHES.barbearia, look = niche.look;
  const [p, bg] = niche.palettes[draft.palette] || niche.palettes[0];
  const dark = isDarkBg(bg);
  const fg = dark ? '#f5f1ea' : '#1c1915', mut = dark ? '#b8b0a3' : '#615a50', card = dark ? 'rgba(255,255,255,.045)' : '#ffffff', line = dark ? 'rgba(255,255,255,.09)' : 'rgba(20,10,0,.08)';
  const phone = phoneDigits(draft.whatsapp), ig = igHandle(draft.instagram);
  const waFor = text => phone ? `https://wa.me/${phone}?text=${encodeURIComponent(text)}` : '';
  const wa = waFor(`Olá! Vi o site da ${draft.name || niche.label} e gostaria de mais informações.`);
  const logo = safeImage(draft.logo), cover = safeImage(draft.cover), gallery = (draft.gallery || []).map(safeImage).filter(Boolean).slice(0, 8);
  const items = (draft.items || []).filter(item => String(item?.name || '').trim()).slice(0, 30);
  const highlights = (draft.highlights || []).map(h => String(h || '').trim()).filter(Boolean).slice(0, 3);
  const hours = String(draft.hours || '').split('\n').map(line => line.trim()).filter(Boolean).slice(0, 10);
  const maps = draft.address ? 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(draft.address) : '';
  const link = (href, label, cls) => href ? `<a class="${cls}" href="${esc(href)}" target="_blank" rel="noopener">${label}</a>` : '';
  const name = esc(draft.name || niche.label);
  const itemAction = item => phone ? link(waFor(`Olá! Tenho interesse em: ${item.name}.`), look.layout === 'products' ? 'Quero este' : niche.cta.split(' ')[0] === 'Agendar' ? 'Agendar' : 'Pedir', 'mini') : '';

  let itemsHtml = '';
  if (look.layout === 'menu') itemsHtml = `<div class="menu">${items.map(item => `<div class="dish"><div class="dish-top"><b>${esc(item.name)}</b><i aria-hidden="true"></i>${item.price ? `<span class="price">${esc(priceText(item.price))}</span>` : ''}</div>${item.desc ? `<p>${esc(item.desc)}</p>` : ''}</div>`).join('')}</div>`;
  else if (look.layout === 'list') itemsHtml = `<div class="plist">${items.map((item, i) => `<div class="prow"><span class="num">${String(i + 1).padStart(2, '0')}</span><div><b>${esc(item.name)}</b>${item.desc ? `<p>${esc(item.desc)}</p>` : ''}</div>${item.price ? `<span class="price">${esc(priceText(item.price))}</span>` : '<span></span>'}${itemAction(item)}</div>`).join('')}</div>`;
  else if (look.layout === 'products') itemsHtml = `<div class="grid products">${items.map((item, i) => `<article class="card product"><div class="thumb" style="--h:${(i * 47) % 360}deg">${gallery[i + 1] ? `<img src="${gallery[i + 1]}" alt="" loading="lazy">` : `<span aria-hidden="true">${esc(String(item.name).trim().charAt(0).toUpperCase())}</span>`}</div><b>${esc(item.name)}</b>${item.desc ? `<p>${esc(item.desc)}</p>` : ''}<div class="buy">${item.price ? `<span class="price">${esc(priceText(item.price))}</span>` : ''}${itemAction(item)}</div></article>`).join('')}</div>`;
  else itemsHtml = `<div class="grid">${items.map((item, i) => `<article class="card svc">${look.layout === 'cards' ? `<span class="tag">${String(i + 1).padStart(2, '0')}</span>` : `<span class="dot" aria-hidden="true"></span>`}<b>${esc(item.name)}</b>${item.desc ? `<p>${esc(item.desc)}</p>` : ''}<div class="buy">${item.price ? `<span class="price">${esc(priceText(item.price))}</span>` : ''}${itemAction(item)}</div></article>`).join('')}</div>`;

  const up = look.upper ? 'text-transform:uppercase;letter-spacing:.02em;' : '';
  const css = `
:root{--p:${p};--p2:${alpha(p, .14)};--bg:${bg};--fg:${fg};--mut:${mut};--card:${card};--line:${line};--r:${look.radius};--head:${look.head};--body:${look.body}}
*{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;font-family:var(--body);background:var(--bg);color:var(--fg);line-height:1.6;-webkit-font-smoothing:antialiased}
img{max-width:100%;display:block}a{color:inherit}.wrap{width:min(1120px,100% - 40px);margin-inline:auto}
h1,h2,h3{font-family:var(--head);line-height:1.05;margin:0;${up}}
.promo{background:var(--p);color:#fff;text-align:center;font-weight:700;font-size:14px;padding:10px 16px;letter-spacing:.01em}
.top{position:absolute;left:0;right:0;z-index:5;color:#fff}.top .wrap{display:flex;align-items:center;justify-content:space-between;gap:12px;min-height:76px}
.brand{display:flex;align-items:center;gap:12px;font-family:var(--head);font-weight:700;font-size:20px;text-decoration:none;${up}}
.brand img,.brand .mark{width:46px;height:46px;border-radius:50%;object-fit:cover;background:var(--p);display:grid;place-items:center;font-size:22px;box-shadow:0 0 0 3px rgba(255,255,255,.18)}
.top nav{display:flex;align-items:center;gap:26px}.top nav a{text-decoration:none;font-weight:600;font-size:14px;opacity:.85}.top nav a:hover{opacity:1}
.top nav .pill{background:rgba(255,255,255,.12);border:1px solid rgba(255,255,255,.22);padding:9px 16px;border-radius:999px;opacity:1;backdrop-filter:blur(8px)}
.hero{position:relative;min-height:min(92vh,760px);display:grid;align-items:center;overflow:hidden;color:#fff;background:${pattern(look.pattern, p)}}
.hero>img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;animation:zoom 18s ease-out both}
.hero.has-img:after{content:"";position:absolute;inset:0;background:linear-gradient(100deg,rgba(0,0,0,.82) 0%,rgba(0,0,0,.55) 50%,rgba(0,0,0,.2) 100%)}
.hero .wrap{position:relative;z-index:1;padding:130px 0 90px}
.kicker{display:inline-flex;align-items:center;gap:10px;font-size:13px;font-weight:700;letter-spacing:.16em;text-transform:uppercase;color:var(--p);margin-bottom:18px}.kicker:before{content:"";width:34px;height:2px;background:var(--p)}
.hero h1{font-size:clamp(46px,9vw,104px);max-width:12ch;letter-spacing:-.025em;text-wrap:balance}
.hero p{font-size:clamp(17px,2.2vw,22px);max-width:560px;margin:22px 0 34px;opacity:.9}
.ctas{display:flex;flex-wrap:wrap;gap:12px}
.btn{display:inline-flex;align-items:center;gap:10px;background:var(--p);color:#fff;text-decoration:none;font-weight:800;padding:16px 28px;border-radius:var(--r);box-shadow:0 14px 34px ${alpha(p, .45)};transition:transform .25s,box-shadow .25s;${up}font-size:15px}
.btn:hover{transform:translateY(-3px);box-shadow:0 20px 44px ${alpha(p, .55)}}.btn svg{width:20px;height:20px;fill:currentColor}
.ghost{display:inline-flex;align-items:center;padding:16px 26px;border-radius:var(--r);border:1.5px solid rgba(255,255,255,.35);color:#fff;text-decoration:none;font-weight:700;font-size:15px;${up}transition:background .25s}.ghost:hover{background:rgba(255,255,255,.1)}
.perks{position:relative;z-index:2;margin-top:-46px}.perks .wrap{display:grid;grid-template-columns:repeat(3,1fr);gap:0;background:${dark ? '#1b1813' : '#fff'};border:1px solid var(--line);border-radius:var(--r);box-shadow:0 24px 60px rgba(0,0,0,${dark ? '.45' : '.12'});overflow:hidden}
.perk{display:flex;align-items:center;gap:14px;padding:22px 24px;font-weight:700}.perk+.perk{border-left:1px solid var(--line)}.perk i{font-style:normal;width:38px;height:38px;flex:none;border-radius:50%;display:grid;place-items:center;background:var(--p2);color:var(--p);font-size:15px}
section{padding:96px 0}.head{display:flex;align-items:end;justify-content:space-between;gap:20px;margin-bottom:40px;flex-wrap:wrap}
.eyebrow{display:block;color:var(--p);font-weight:800;font-size:13px;letter-spacing:.16em;text-transform:uppercase;margin-bottom:10px}
h2{font-size:clamp(34px,5vw,58px);letter-spacing:-.02em}.lead{color:var(--mut);margin:0;max-width:440px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:18px}
.card{background:var(--card);border:1px solid var(--line);border-radius:var(--r);padding:26px;display:flex;flex-direction:column;gap:8px;transition:transform .3s,border-color .3s,box-shadow .3s}
.card:hover{transform:translateY(-4px);border-color:${alpha(p, .5)};box-shadow:0 22px 50px rgba(0,0,0,${dark ? '.4' : '.1'})}
.card b{font-size:19px;font-family:var(--head);${up}}.card p{margin:0;color:var(--mut);font-size:15px;flex:1}
.tag{font-family:var(--head);font-size:42px;line-height:1;color:var(--p);opacity:.9}.dot{width:44px;height:44px;border-radius:50%;background:radial-gradient(circle at 30% 30%,#fff8,transparent 60%),var(--p);margin-bottom:6px}
.buy{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-top:10px}
.price{font-family:var(--head);color:var(--p);font-weight:800;font-size:24px;white-space:nowrap}
.mini{font-size:13px;font-weight:800;text-decoration:none;padding:8px 14px;border-radius:999px;background:var(--p2);color:var(--p);white-space:nowrap;transition:background .2s,color .2s}.mini:hover{background:var(--p);color:#fff}
.plist{border-top:1px solid var(--line)}.prow{display:grid;grid-template-columns:56px 1fr auto auto;align-items:center;gap:18px;padding:24px 4px;border-bottom:1px solid var(--line);transition:background .25s,padding .25s}
.prow:hover{background:var(--p2);padding-inline:16px}.prow .num{font-family:var(--head);color:var(--p);font-size:22px}.prow b{font-family:var(--head);font-size:clamp(20px,2.6vw,26px);${up}}.prow p{margin:2px 0 0;color:var(--mut);font-size:15px}
.menu{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,420px),1fr));gap:8px 56px;background:var(--card);border:1px solid var(--line);border-radius:var(--r);padding:clamp(26px,5vw,56px)}
.dish{padding:16px 0;border-bottom:1px dashed var(--line)}.dish-top{display:flex;align-items:baseline;gap:10px}.dish-top b{font-family:var(--head);font-size:21px;font-style:italic}.dish-top i{flex:1;border-bottom:2px dotted ${alpha(p, .45)};transform:translateY(-5px)}.dish p{margin:4px 0 0;color:var(--mut);font-size:15px}
.thumb{aspect-ratio:1;border-radius:calc(var(--r) - 6px);overflow:hidden;margin:-8px -8px 10px;display:grid;place-items:center;background:linear-gradient(135deg,hsl(var(--h),70%,${dark ? '30%' : '88%'}),${alpha(p, .45)})}
.thumb img{width:100%;height:100%;object-fit:cover;transition:transform .5s}.product:hover .thumb img{transform:scale(1.06)}.thumb span{font-family:var(--head);font-size:64px;font-weight:800;color:${dark ? '#fff' : alpha(p, .9)};opacity:.8}
.about{display:grid;grid-template-columns:1.1fr 1fr;gap:56px;align-items:center}.about p{font-size:19px;color:var(--mut);margin:20px 0 28px}
.about .photo{position:relative}.about .photo img{border-radius:var(--r);aspect-ratio:4/5;object-fit:cover;width:100%}.about .photo:before{content:"";position:absolute;inset:18px -18px -18px 18px;border:2px solid var(--p);border-radius:var(--r);z-index:-1}
.about .photo.empty{aspect-ratio:4/5;border-radius:var(--r);background:${pattern(look.pattern, p)};display:grid;place-content:center;justify-items:center;gap:14px;color:#fff;text-align:center}.photo.empty span{font-size:clamp(84px,12vw,140px);line-height:1;filter:drop-shadow(0 18px 30px rgba(0,0,0,.45))}.photo.empty small{font-weight:800;letter-spacing:.2em;text-transform:uppercase;font-size:12px;opacity:.75}
.gallery{display:grid;grid-template-columns:repeat(4,1fr);grid-auto-rows:220px;gap:12px}.gallery img{width:100%;height:100%;object-fit:cover;border-radius:calc(var(--r) * .7);transition:transform .4s,filter .4s}.gallery img:hover{transform:scale(1.03);filter:saturate(1.15)}
.gallery img:nth-child(5n+1){grid-column:span 2;grid-row:span 2}
.band{background:${pattern(look.pattern, p)};color:#fff;border-radius:var(--r);padding:clamp(36px,6vw,72px);display:flex;align-items:center;justify-content:space-between;gap:28px;flex-wrap:wrap}.band h2{font-size:clamp(30px,4.4vw,52px);max-width:16ch}
.info{display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:18px}.info .card b{display:flex;align-items:center;gap:10px}.info ul{list-style:none;margin:0;padding:0;color:var(--mut)}.info li{padding:6px 0;border-bottom:1px dashed var(--line)}.info li:last-child{border:0}
.info a{color:var(--p);font-weight:700;text-decoration:none}
footer{padding:44px 0;border-top:1px solid var(--line);color:var(--mut);font-size:14px}footer .wrap{display:flex;justify-content:space-between;gap:18px;flex-wrap:wrap;align-items:center}
.social{display:flex;gap:10px}.social a{width:42px;height:42px;border-radius:50%;display:grid;place-items:center;background:var(--p2);color:var(--p);transition:background .2s,color .2s}.social a:hover{background:var(--p);color:#fff}.social svg{width:20px;height:20px;fill:currentColor}
.wa-float{position:fixed;right:20px;bottom:20px;width:62px;height:62px;border-radius:50%;background:#25d366;display:grid;place-items:center;box-shadow:0 12px 32px rgba(0,0,0,.35);z-index:9;animation:pulse 2.6s ease-in-out infinite}.wa-float svg{width:32px;height:32px;fill:#fff}
.rise{animation:rise .9s cubic-bezier(.2,.75,.25,1) both}.d1{animation-delay:.1s}.d2{animation-delay:.22s}.d3{animation-delay:.34s}
@keyframes rise{from{opacity:0;transform:translateY(26px)}to{opacity:1;transform:none}}
@keyframes zoom{from{transform:scale(1.12)}to{transform:scale(1)}}
@keyframes pulse{0%,100%{box-shadow:0 12px 32px rgba(0,0,0,.35),0 0 0 0 rgba(37,211,102,.5)}50%{box-shadow:0 12px 32px rgba(0,0,0,.35),0 0 0 14px rgba(37,211,102,0)}}
@media(max-width:820px){.top nav a:not(.pill){display:none}.perks .wrap{grid-template-columns:1fr}.perk+.perk{border-left:0;border-top:1px solid var(--line)}.about{grid-template-columns:1fr;gap:40px}.about .photo:before{inset:12px -10px -12px 10px}
.gallery{grid-template-columns:repeat(2,1fr);grid-auto-rows:150px}.prow{grid-template-columns:40px 1fr auto;gap:12px}.prow .mini{grid-column:2/-1;justify-self:start}.products{grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.product{padding:12px}.product .thumb{margin:-4px -4px 8px}.product b{font-size:15px}.product p{font-size:13px}.product .buy{flex-direction:column;align-items:flex-start;gap:8px}.product .price{font-size:19px}.about .photo.empty{aspect-ratio:4/3}section{padding:68px 0}.hero .wrap{padding:118px 0 92px}}
@media(prefers-reduced-motion:reduce){*,*:before,*:after{animation:none!important;transition:none!important}}`;

  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${name}</title><meta name="description" content="${esc(draft.slogan || '')}"><meta name="theme-color" content="${p}"><style>${css}</style></head><body>
${draft.showPromo && draft.promo ? `<div class="promo">${esc(draft.promo)}</div>` : ''}
<div style="position:relative">
<header class="top"><div class="wrap"><a class="brand" href="#inicio">${logo ? `<img src="${logo}" alt="">` : `<span class="mark" aria-hidden="true">${niche.icon}</span>`}<span>${name}</span></a><nav><a href="#itens">${esc(niche.items)}</a><a href="#sobre">Sobre</a><a href="#contato">Contato</a>${link(wa, 'WhatsApp', 'pill')}</nav></div></header>
<section class="hero${cover ? ' has-img' : ''}" id="inicio">${cover ? `<img src="${cover}" alt="">` : ''}<div class="wrap"><span class="kicker rise">${esc(niche.kicker)}</span><h1 class="rise d1">${name}</h1><p class="rise d2">${esc(draft.slogan)}</p><div class="ctas rise d3">${link(wa, WA_SVG + esc(niche.cta), 'btn')}<a class="ghost" href="#itens">Ver ${esc(niche.items.toLowerCase())}</a></div></div></section>
</div>
${highlights.length ? `<div class="perks"><div class="wrap">${highlights.map((h, i) => `<div class="perk"><i aria-hidden="true">${ICONS[i]}</i>${esc(h)}</div>`).join('')}</div></div>` : ''}
<main>
${items.length ? `<section id="itens"><div class="wrap"><div class="head"><div><span class="eyebrow">${esc(niche.items)}</span><h2>${look.layout === 'menu' ? 'Nosso cardápio' : look.layout === 'products' ? 'Destaques da loja' : 'O que fazemos'}</h2></div><p class="lead">${look.layout === 'products' ? 'Gostou de algo? Toque em "Quero este" e fale direto com a gente.' : 'Preços claros, sem surpresa. Escolha e fale com a gente pelo WhatsApp.'}</p></div>${itemsHtml}</div></section>` : ''}
${draft.about ? `<section id="sobre"><div class="wrap about"><div><span class="eyebrow">Sobre nós</span><h2>${name}</h2><p>${esc(draft.about)}</p>${link(wa, WA_SVG + 'Fale com a gente', 'btn')}</div>${gallery[0] ? `<div class="photo"><img src="${gallery[0]}" alt="" loading="lazy"></div>` : `<div class="photo empty" aria-hidden="true"><span>${niche.icon}</span><small>${esc(niche.kicker)}</small></div>`}</div></section>` : ''}
${gallery.length > 1 && look.layout !== 'products' ? `<section id="fotos" style="padding-top:0"><div class="wrap"><div class="head"><div><span class="eyebrow">Galeria</span><h2>Nosso dia a dia</h2></div></div><div class="gallery">${gallery.slice(1).map(src => `<img src="${src}" alt="" loading="lazy">`).join('')}</div></div></section>` : ''}
${wa ? `<section style="padding-top:0"><div class="wrap"><div class="band"><h2>${esc(niche.cta === 'Agendar horário' ? 'Bora marcar seu horário?' : niche.cta === 'Pedir orçamento' ? 'Precisa de um orçamento?' : niche.cta === 'Fazer pedido' ? 'Bateu a fome?' : 'Gostou de alguma coisa?')}</h2>${link(wa, WA_SVG + esc(niche.cta), 'btn')}</div></div></section>` : ''}
<section id="contato" style="padding-top:0"><div class="wrap"><div class="head"><div><span class="eyebrow">Contato</span><h2>Venha nos visitar</h2></div></div><div class="info">
${hours.length ? `<div class="card"><b>🕒 Horários</b><ul>${hours.map(h => `<li>${esc(h)}</li>`).join('')}</ul></div>` : ''}
${draft.address ? `<div class="card"><b>📍 Endereço</b><p>${esc(draft.address)}</p>${maps ? `<a href="${esc(maps)}" target="_blank" rel="noopener">Ver no mapa →</a>` : ''}</div>` : ''}
${phone || ig ? `<div class="card"><b>💬 Fale com a gente</b>${phone ? `<p>WhatsApp: ${esc(String(draft.whatsapp).trim())}</p>` : ''}${ig ? `<p>Instagram: @${esc(ig)}</p>` : ''}${link(wa, 'Chamar no WhatsApp →', '')}</div>` : ''}
</div></div></section>
</main>
<footer><div class="wrap"><span>© ${new Date().getFullYear()} ${name} · Site feito pela <a href="https://www.promisa.online" target="_blank" rel="noopener">Promisa</a></span><div class="social">${wa ? `<a href="${esc(wa)}" target="_blank" rel="noopener" aria-label="WhatsApp">${WA_SVG}</a>` : ''}${ig ? `<a href="https://instagram.com/${esc(ig)}" target="_blank" rel="noopener" aria-label="Instagram">${IG_SVG}</a>` : ''}${maps ? `<a href="${esc(maps)}" target="_blank" rel="noopener" aria-label="Mapa">${PIN_SVG}</a>` : ''}</div></div></footer>
${wa ? `<a class="wa-float" href="${esc(wa)}" target="_blank" rel="noopener" aria-label="Falar no WhatsApp">${WA_SVG}</a>` : ''}
</body></html>`;
}
