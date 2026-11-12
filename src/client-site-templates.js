// Modelos de site por ramo de atividade e o gerador do HTML (demonstração do "Painel do cliente").
// Puro: sem DOM, sem rede. Tudo que vem do formulário é escapado; só aceita imagens data:image em base64.

export const NICHES = {
  barbearia: {
    label: 'Barbearia', icon: '💈', items: 'Serviços', cta: 'Agendar horário',
    palettes: [['#c8a35a', '#1a1714'], ['#d9480f', '#16110e'], ['#3b82f6', '#0f172a'], ['#16a34a', '#0d1512']],
    defaults: {
      name: 'Barbearia Navalha', slogan: 'Corte clássico, atendimento de primeira.',
      about: 'Mais de 10 anos cuidando do visual dos homens da cidade. Ambiente climatizado, café por conta da casa e profissionais experientes.',
      items: [{ name: 'Corte masculino', price: '45', desc: 'Tesoura ou máquina, com lavagem.' }, { name: 'Barba completa', price: '35', desc: 'Toalha quente e navalha.' }, { name: 'Corte + barba', price: '70', desc: 'O combo mais pedido.' }, { name: 'Pigmentação', price: '30', desc: 'Disfarça falhas na barba.' }],
      hours: 'Seg a Sex: 9h às 20h\nSábado: 8h às 17h', promo: 'Terça do combo: corte + barba por R$ 60!'
    }
  },
  restaurante: {
    label: 'Restaurante', icon: '🍽️', items: 'Cardápio', cta: 'Fazer pedido',
    palettes: [['#e8590c', '#fff8f1'], ['#c92a2a', '#fffaf5'], ['#2f9e44', '#f6fbf4'], ['#9c36b5', '#fcf7ff']],
    defaults: {
      name: 'Sabor da Casa', slogan: 'Comida caseira feita com carinho todos os dias.',
      about: 'Buffet livre no almoço e pratos à la carte à noite. Ingredientes frescos de produtores da região.',
      items: [{ name: 'Buffet livre', price: '39,90', desc: 'Almoço de segunda a sábado.' }, { name: 'Marmita grande', price: '24', desc: 'Arroz, feijão, 2 carnes e salada.' }, { name: 'Prato executivo', price: '32', desc: 'Filé, arroz, fritas e salada.' }, { name: 'Sobremesa do dia', price: '9', desc: 'Pergunte ao garçom.' }],
      hours: 'Almoço: 11h às 14h30\nJantar: 18h às 22h (qui a sáb)', promo: 'Entrega grátis no centro para pedidos acima de R$ 50.'
    }
  },
  oficina: {
    label: 'Oficina / Pneus', icon: '🔧', items: 'Serviços', cta: 'Pedir orçamento',
    palettes: [['#f59f00', '#111315'], ['#e03131', '#121212'], ['#1c7ed6', '#0e1621'], ['#37b24d', '#101511']],
    defaults: {
      name: 'Auto Center Rota', slogan: 'Seu carro em boas mãos, com preço justo.',
      about: 'Pneus, alinhamento, balanceamento e mecânica em geral. Orçamento sem compromisso e garantia em todos os serviços.',
      items: [{ name: 'Alinhamento', price: '60', desc: 'Com laudo computadorizado.' }, { name: 'Balanceamento (4 rodas)', price: '50', desc: 'Inclui válvulas.' }, { name: 'Troca de óleo', price: 'a partir de 120', desc: 'Óleo e filtro.' }, { name: 'Pneus novos', price: 'consulte', desc: 'Trabalhamos com as melhores marcas.' }],
      hours: 'Seg a Sex: 7h30 às 18h\nSábado: 7h30 às 12h', promo: 'Na compra de 4 pneus, alinhamento grátis.'
    }
  },
  estetica: {
    label: 'Salão / Estética', icon: '💅', items: 'Serviços', cta: 'Agendar horário',
    palettes: [['#d6336c', '#fff7fa'], ['#ae3ec9', '#fdf7ff'], ['#c2884a', '#fffaf3'], ['#0ca678', '#f4fcf9']],
    defaults: {
      name: 'Studio Bella', slogan: 'Realce a sua beleza natural.',
      about: 'Cabelo, unhas, sobrancelhas e estética facial em um espaço pensado para o seu bem-estar.',
      items: [{ name: 'Escova', price: '50', desc: 'Lisa ou modelada.' }, { name: 'Manicure e pedicure', price: '55', desc: 'Esmaltação comum.' }, { name: 'Design de sobrancelha', price: '35', desc: 'Com henna: R$ 45.' }, { name: 'Limpeza de pele', price: '120', desc: 'Profunda, com extração.' }],
      hours: 'Ter a Sex: 9h às 19h\nSábado: 8h às 16h', promo: 'Mês do cuidado: 15% de desconto na limpeza de pele.'
    }
  },
  loja: {
    label: 'Loja', icon: '🛍️', items: 'Produtos', cta: 'Comprar pelo WhatsApp',
    palettes: [['#7048e8', '#f8f7ff'], ['#1098ad', '#f3fbfc'], ['#f76707', '#fff9f3'], ['#212529', '#f8f9fa']],
    defaults: {
      name: 'Loja Ponto Certo', slogan: 'Moda e acessórios com o seu estilo.',
      about: 'Roupas femininas e masculinas, calçados e acessórios. Novidades toda semana e entrega na cidade.',
      items: [{ name: 'Camiseta básica', price: '59,90', desc: 'Algodão, várias cores.' }, { name: 'Calça jeans', price: '149,90', desc: 'Modelagem confortável.' }, { name: 'Tênis casual', price: '199,90', desc: 'Do 34 ao 44.' }, { name: 'Bolsa transversal', price: '89,90', desc: 'Couro sintético.' }],
      hours: 'Seg a Sex: 9h às 18h30\nSábado: 9h às 13h', promo: 'Frete grátis na cidade em compras acima de R$ 150.'
    }
  }
};

export function newDraft(niche = 'barbearia') {
  const def = NICHES[niche] || NICHES.barbearia;
  return {
    version: 1, niche: NICHES[niche] ? niche : 'barbearia', palette: 0, dark: isDarkBg(def.palettes[0][1]),
    ...structuredClone(def.defaults), whatsapp: '49999999999', instagram: '', address: 'Rua Principal, 100 - Centro, Concórdia/SC',
    showPromo: true, logo: '', cover: '', gallery: []
  };
}

export const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
export const safeImage = src => typeof src === 'string' && /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(src) && src.length < 3_000_000 ? src : '';
export const phoneDigits = value => { const d = String(value || '').replace(/\D/g, ''); return d.length >= 10 && d.length <= 11 ? '55' + d : d.length >= 12 && d.length <= 13 ? d : ''; };
export const igHandle = value => String(value || '').trim().replace(/^@/, '').replace(/^https?:\/\/(www\.)?instagram\.com\//i, '').replace(/[/?#].*$/, '').replace(/[^\w.]/g, '').slice(0, 30);
export const priceText = value => { const v = String(value || '').trim(); if (!v) return ''; return /^\d+([.,]\d{1,2})?$/.test(v) ? 'R$ ' + v : v; };
function isDarkBg(hex) { const n = parseInt(String(hex).slice(1), 16); const r = n >> 16 & 255, g = n >> 8 & 255, b = n & 255; return (r * 299 + g * 587 + b * 114) / 1000 < 128; }

export function renderSite(draft) {
  const niche = NICHES[draft.niche] || NICHES.barbearia;
  const [primary, bg] = niche.palettes[draft.palette] || niche.palettes[0];
  const dark = isDarkBg(bg);
  const fg = dark ? '#f4f1ec' : '#1d1b18', muted = dark ? '#b9b2a6' : '#5f5a52', card = dark ? 'rgba(255,255,255,.05)' : '#ffffff', line = dark ? 'rgba(255,255,255,.1)' : 'rgba(0,0,0,.08)';
  const phone = phoneDigits(draft.whatsapp), ig = igHandle(draft.instagram);
  const wa = phone ? `https://wa.me/${phone}?text=${encodeURIComponent(`Olá! Vi o site da ${draft.name || niche.label} e gostaria de mais informações.`)}` : '';
  const logo = safeImage(draft.logo), cover = safeImage(draft.cover), gallery = (draft.gallery || []).map(safeImage).filter(Boolean).slice(0, 8);
  const items = (draft.items || []).filter(item => String(item?.name || '').trim()).slice(0, 30);
  const hours = String(draft.hours || '').split('\n').map(line => line.trim()).filter(Boolean).slice(0, 10);
  const maps = draft.address ? 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(draft.address) : '';
  const btn = (label, cls = 'btn') => wa ? `<a class="${cls}" href="${esc(wa)}" target="_blank" rel="noopener">${esc(label)}</a>` : '';
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(draft.name || niche.label)}</title><meta name="description" content="${esc(draft.slogan || '')}">
<style>
:root{--p:${primary};--bg:${bg};--fg:${fg};--mut:${muted};--card:${card};--line:${line}}
*{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;background:var(--bg);color:var(--fg);line-height:1.55}
img{max-width:100%;display:block}a{color:inherit}.wrap{width:min(1080px,100% - 32px);margin-inline:auto}
.promo{background:var(--p);color:#fff;text-align:center;font-weight:600;font-size:14px;padding:9px 16px}
header.top{position:sticky;top:0;z-index:5;background:color-mix(in srgb,var(--bg) 88%,transparent);backdrop-filter:blur(10px);border-bottom:1px solid var(--line)}
.top .wrap{display:flex;align-items:center;justify-content:space-between;gap:12px;min-height:64px}.brand{display:flex;align-items:center;gap:10px;font-weight:800;font-size:18px;text-decoration:none}
.brand img,.brand span{width:40px;height:40px;border-radius:50%;object-fit:cover;background:var(--p);display:grid;place-items:center;color:#fff;font-size:20px}
nav a{text-decoration:none;color:var(--mut);font-weight:600;font-size:14px;margin-left:18px}nav a:hover{color:var(--p)}
.hero{position:relative;min-height:min(78vh,620px);display:grid;align-items:end;overflow:hidden;color:#fff;background:linear-gradient(135deg,var(--p),#000)}
.hero>img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}.hero:after{content:"";position:absolute;inset:0;background:linear-gradient(180deg,rgba(0,0,0,.1),rgba(0,0,0,.72))}
.hero .wrap{position:relative;z-index:1;padding:80px 0 56px}.hero h1{font-size:clamp(36px,7vw,68px);line-height:1.02;margin:0 0 14px;letter-spacing:-.03em}.hero p{font-size:clamp(17px,2.4vw,21px);max-width:620px;margin:0 0 26px;opacity:.92}
.btn{display:inline-flex;align-items:center;gap:8px;background:var(--p);color:#fff;text-decoration:none;font-weight:700;padding:14px 24px;border-radius:999px;box-shadow:0 10px 30px color-mix(in srgb,var(--p) 45%,transparent);transition:transform .2s}.btn:hover{transform:translateY(-2px)}
section{padding:72px 0}h2{font-size:clamp(26px,4vw,38px);margin:0 0 8px;letter-spacing:-.02em}.lead{color:var(--mut);margin:0 0 32px;max-width:640px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:16px}
.item{background:var(--card);border:1px solid var(--line);border-radius:18px;padding:20px;display:grid;gap:6px}.item b{font-size:17px}.item .price{color:var(--p);font-weight:800;font-size:20px}.item p{margin:0;color:var(--mut);font-size:14px}
.about{display:grid;grid-template-columns:1.2fr 1fr;gap:32px;align-items:center}.about p{font-size:18px;color:var(--mut)}
.gallery{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:10px}.gallery img{aspect-ratio:1;object-fit:cover;border-radius:14px;width:100%}
.info{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:16px}.info .item ul{margin:0;padding-left:18px;color:var(--mut)}
footer{border-top:1px solid var(--line);padding:28px 0;color:var(--mut);font-size:13px;text-align:center}
.wa-float{position:fixed;right:18px;bottom:18px;width:58px;height:58px;border-radius:50%;background:#25d366;display:grid;place-items:center;box-shadow:0 10px 30px rgba(0,0,0,.3);z-index:9}
.wa-float svg{width:30px;height:30px;fill:#fff}
@media(max-width:720px){nav{display:none}.about{grid-template-columns:1fr}section{padding:52px 0}}
</style></head><body>
${draft.showPromo && draft.promo ? `<div class="promo">${esc(draft.promo)}</div>` : ''}
<header class="top"><div class="wrap"><a class="brand" href="#inicio">${logo ? `<img src="${logo}" alt="">` : `<span aria-hidden="true">${niche.icon}</span>`}${esc(draft.name)}</a><nav><a href="#itens">${esc(niche.items)}</a><a href="#sobre">Sobre</a><a href="#contato">Contato</a></nav></div></header>
<main>
<section class="hero" id="inicio">${cover ? `<img src="${cover}" alt="">` : ''}<div class="wrap"><h1>${esc(draft.name)}</h1><p>${esc(draft.slogan)}</p>${btn(niche.cta)}</div></section>
${items.length ? `<section id="itens"><div class="wrap"><h2>${esc(niche.items)}</h2><p class="lead">Confira o que preparamos para você.</p><div class="grid">${items.map(item => `<article class="item"><b>${esc(item.name)}</b>${item.price ? `<span class="price">${esc(priceText(item.price))}</span>` : ''}${item.desc ? `<p>${esc(item.desc)}</p>` : ''}</article>`).join('')}</div></div></section>` : ''}
${draft.about ? `<section id="sobre"><div class="wrap about"><div><h2>Sobre nós</h2><p>${esc(draft.about)}</p>${btn('Fale com a gente')}</div>${gallery[0] ? `<img src="${gallery[0]}" alt="" style="border-radius:22px;aspect-ratio:4/3;object-fit:cover;width:100%">` : ''}</div></section>` : ''}
${gallery.length > 1 ? `<section id="fotos"><div class="wrap"><h2>Fotos</h2><p class="lead">Um pouco do nosso dia a dia.</p><div class="gallery">${gallery.slice(1).map(src => `<img src="${src}" alt="" loading="lazy">`).join('')}</div></div></section>` : ''}
<section id="contato"><div class="wrap"><h2>Venha nos visitar</h2><p class="lead">Estamos esperando por você.</p><div class="info">
${hours.length ? `<div class="item"><b>🕒 Horários</b><ul>${hours.map(h => `<li>${esc(h)}</li>`).join('')}</ul></div>` : ''}
${draft.address ? `<div class="item"><b>📍 Endereço</b><p>${esc(draft.address)}</p>${maps ? `<p><a href="${esc(maps)}" target="_blank" rel="noopener">Ver no mapa →</a></p>` : ''}</div>` : ''}
<div class="item"><b>💬 Contato</b>${phone ? `<p><a href="${esc(wa)}" target="_blank" rel="noopener">WhatsApp</a></p>` : ''}${ig ? `<p><a href="https://instagram.com/${esc(ig)}" target="_blank" rel="noopener">@${esc(ig)}</a></p>` : ''}</div>
</div></div></section>
</main>
<footer><div class="wrap">© ${new Date().getFullYear()} ${esc(draft.name)} · Site feito pela <a href="https://www.promisa.online" target="_blank" rel="noopener">Promisa</a></div></footer>
${wa ? `<a class="wa-float" href="${esc(wa)}" target="_blank" rel="noopener" aria-label="Falar no WhatsApp"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2zm5.3 14.1c-.2.6-1.3 1.2-1.8 1.2-.5.1-1 .2-3.3-.7-2.8-1.1-4.5-3.9-4.7-4.1-.1-.2-1.1-1.5-1.1-2.8s.7-2 1-2.3c.2-.3.5-.3.7-.3h.5c.2 0 .4 0 .6.5l.8 2c.1.2.1.4 0 .5l-.4.6-.4.4c-.1.2-.3.3-.1.6.2.3.8 1.3 1.7 2.1 1.2 1 2.1 1.4 2.4 1.5.3.1.5.1.7-.1l.9-1.1c.2-.3.4-.2.6-.1l2 .9c.3.1.5.2.5.3.1.2.1.7-.1 1.3z"/></svg></a>` : ''}
</body></html>`;
}
