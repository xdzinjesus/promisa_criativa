import { NICHES, newDraft, renderSite, safeImage } from './client-site-templates.js';

// Aba "🧩 Painel do cliente" (demonstração): o que o cliente veria no painel dele.
// Escolhe o ramo, edita campos guiados e vê o site mudar na hora. O rascunho fica só neste aparelho
// (localStorage): nenhuma leitura ou gravação no Blob. "Salvar como site" usa o mesmo cadastro de sites do painel.
const DRAFT_KEY = 'promisa_client_editor_v1';
const el = (tag, text, props = {}) => Object.assign(document.createElement(tag), text == null ? {} : { textContent: text }, props);

function load() { try { const saved = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null'); if (saved && NICHES[saved.niche]) return { ...newDraft(saved.niche), ...saved }; } catch { /* sem rascunho */ } return newDraft('barbearia'); }
function save(draft) { try { localStorage.setItem(DRAFT_KEY, JSON.stringify(draft)); return true; } catch { return false; } }

// Reduz a foto para no máximo `max` px e JPEG ~82% (cabe no rascunho e deixa o site leve).
function shrink(file, max = 1400) {
  return new Promise((resolve, reject) => {
    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) { reject(new Error('Use foto JPG, PNG ou WEBP.')); return; }
    const url = URL.createObjectURL(file), img = new Image();
    img.onload = () => {
      const scale = Math.min(1, max / Math.max(img.width, img.height));
      const canvas = Object.assign(document.createElement('canvas'), { width: Math.round(img.width * scale), height: Math.round(img.height * scale) });
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL('image/jpeg', 0.82));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Não consegui abrir a foto.')); };
    img.src = url;
  });
}

function mount(root) {
  if (!root) return;
  let draft = load(), device = 'mobile', timer = 0;
  const status = el('p', '', { className: 'ce-status', role: 'status' });
  const frame = el('iframe', null, { className: 'ce-frame', title: 'Prévia do site do cliente' });
  frame.setAttribute('sandbox', 'allow-popups allow-popups-to-escape-sandbox');
  frame.referrerPolicy = 'no-referrer';
  const refresh = (now = false) => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      frame.srcdoc = renderSite(draft);
      status.textContent = save(draft) ? 'Rascunho salvo neste aparelho.' : '⚠️ Fotos demais para guardar o rascunho. O site continua funcionando; salve como site para não perder.';
    }, now ? 0 : 250);
  };
  const set = (key, value) => { draft[key] = value; refresh(); };

  // ---- formulário ----
  const form = el('div', null, { className: 'ce-form' });
  const group = (title, ...children) => { const box = el('fieldset', null, { className: 'ce-group' }); box.append(el('legend', title), ...children); return box; };
  const field = (label, key, { area = false, type = 'text', placeholder = '', max = 200 } = {}) => {
    const wrap = el('label', null, { className: 'ce-field' });
    const input = el(area ? 'textarea' : 'input', null, { value: draft[key] ?? '', placeholder, maxLength: max, ...(area ? { rows: 3 } : { type }) });
    input.addEventListener('input', () => set(key, input.value));
    wrap.append(el('span', label), input);
    return wrap;
  };

  function draw() {
    form.replaceChildren();
    const niche = NICHES[draft.niche];
    // ramo
    const niches = el('div', null, { className: 'ce-niches' });
    for (const [key, def] of Object.entries(NICHES)) {
      const b = el('button', `${def.icon} ${def.label}`, { type: 'button', className: 'ce-chip' });
      b.setAttribute('aria-pressed', String(draft.niche === key));
      b.addEventListener('click', () => {
        if (draft.niche === key) return;
        if (!confirm(`Trocar para o modelo "${def.label}"? Os textos voltam ao exemplo do ramo (as fotos ficam).`)) return;
        draft = { ...newDraft(key), logo: draft.logo, cover: draft.cover, gallery: draft.gallery, whatsapp: draft.whatsapp, instagram: draft.instagram, address: draft.address };
        draw(); refresh(true);
      });
      niches.append(b);
    }
    // cores
    const colors = el('div', null, { className: 'ce-colors' });
    niche.palettes.forEach(([p, bg], i) => {
      const b = el('button', null, { type: 'button', className: 'ce-color', ariaLabel: `Cores ${i + 1}` });
      b.style.background = `linear-gradient(135deg,${p} 50%,${bg} 50%)`;
      b.setAttribute('aria-pressed', String(draft.palette === i));
      b.addEventListener('click', () => { draft.palette = i; draw(); refresh(true); });
      colors.append(b);
    });
    // itens
    const list = el('div', null, { className: 'ce-items' });
    draft.items.forEach((item, i) => {
      const row = el('div', null, { className: 'ce-item' });
      const name = el('input', null, { value: item.name, placeholder: 'Nome', maxLength: 60, ariaLabel: 'Nome' });
      const price = el('input', null, { value: item.price, placeholder: 'Preço (ex.: 45)', maxLength: 30, ariaLabel: 'Preço', className: 'ce-price' });
      const desc = el('input', null, { value: item.desc, placeholder: 'Descrição curta', maxLength: 120, ariaLabel: 'Descrição', className: 'ce-desc' });
      const del = el('button', '✕', { type: 'button', className: 'ce-del', ariaLabel: 'Remover ' + (item.name || 'item') });
      name.addEventListener('input', () => { item.name = name.value; refresh(); });
      price.addEventListener('input', () => { item.price = price.value; refresh(); });
      desc.addEventListener('input', () => { item.desc = desc.value; refresh(); });
      const move = (dir) => { const j = i + dir; if (j < 0 || j >= draft.items.length) return; [draft.items[i], draft.items[j]] = [draft.items[j], draft.items[i]]; draw(); refresh(true); };
      const up = el('button', '↑', { type: 'button', className: 'ce-mv', ariaLabel: 'Subir' }); up.addEventListener('click', () => move(-1));
      del.addEventListener('click', () => { draft.items.splice(i, 1); draw(); refresh(true); });
      row.append(name, price, up, del, desc);
      list.append(row);
    });
    const add = el('button', `＋ Adicionar ${niche.items.toLowerCase().replace(/s$/, '')}`, { type: 'button', className: 'sec ce-add' });
    add.disabled = draft.items.length >= 30;
    add.addEventListener('click', () => { draft.items.push({ name: '', price: '', desc: '' }); draw(); refresh(true); list.lastElementChild?.querySelector('input')?.focus(); });
    // fotos
    const photo = (label, key, multiple = false) => {
      const wrap = el('div', null, { className: 'ce-photo' });
      const input = el('input', null, { type: 'file', accept: 'image/jpeg,image/png,image/webp', multiple, hidden: true });
      const pick = el('button', multiple ? '＋ Fotos' : (draft[key] ? 'Trocar' : 'Escolher'), { type: 'button', className: 'sec' });
      pick.addEventListener('click', () => input.click());
      input.addEventListener('change', async () => {
        try {
          const files = [...input.files].slice(0, multiple ? 8 - draft.gallery.length : 1);
          const shots = []; for (const file of files) shots.push(await shrink(file, key === 'logo' ? 400 : 1400));
          if (multiple) draft.gallery = [...draft.gallery, ...shots].slice(0, 8); else draft[key] = shots[0] || '';
          draw(); refresh(true);
        } catch (error) { status.textContent = '⚠️ ' + error.message; }
      });
      const thumbs = el('div', null, { className: 'ce-thumbs' });
      const srcs = multiple ? draft.gallery : (draft[key] ? [draft[key]] : []);
      srcs.forEach((src, i) => {
        const t = el('button', null, { type: 'button', className: 'ce-thumb', title: 'Remover foto', ariaLabel: 'Remover foto' });
        const safe = safeImage(src); if (safe) t.style.backgroundImage = `url("${safe}")`;
        t.addEventListener('click', () => { if (multiple) draft.gallery.splice(i, 1); else draft[key] = ''; draw(); refresh(true); });
        thumbs.append(t);
      });
      wrap.append(el('span', label), thumbs, pick, input);
      return wrap;
    };
    const perks = el('div', null, { className: 'ce-perks' });
    draft.highlights = Array.from({ length: 3 }, (_, i) => draft.highlights?.[i] ?? '');
    draft.highlights.forEach((text, i) => {
      const input = el('input', null, { value: text, placeholder: `Destaque ${i + 1} (ex.: Estacionamento grátis)`, maxLength: 50, ariaLabel: `Destaque ${i + 1}` });
      input.addEventListener('input', () => { draft.highlights[i] = input.value; refresh(); });
      perks.append(input);
    });
    const promo = el('label', null, { className: 'ce-check' });
    const promoOn = el('input', null, { type: 'checkbox', checked: draft.showPromo });
    promoOn.addEventListener('change', () => set('showPromo', promoOn.checked));
    promo.append(promoOn, el('span', 'Mostrar faixa de promoção no topo'));

    form.append(
      group('1. Ramo do negócio', niches),
      group('2. Identidade', field('Nome do negócio', 'name', { max: 60 }), field('Frase de destaque', 'slogan', { max: 120 }), el('span', 'Cores', { className: 'ce-label' }), colors, photo('Logo', 'logo'), photo('Foto de capa', 'cover')),
      group('3. Destaques do negócio', perks),
      group('4. ' + niche.items, list, add),
      group('5. Promoção', promo, field('Texto da promoção', 'promo', { max: 120 })),
      group('6. Sobre e fotos', field('Sobre o negócio', 'about', { area: true, max: 600 }), photo('Galeria (até 8)', 'gallery', true)),
      group('7. Contato', field('WhatsApp (com DDD)', 'whatsapp', { type: 'tel', placeholder: '49 99999-9999', max: 20 }), field('Instagram', 'instagram', { placeholder: '@seunegocio', max: 60 }), field('Endereço', 'address', { max: 160 }), field('Horários (um por linha)', 'hours', { area: true, max: 300 }))
    );
  }

  // ---- topo, prévia e ações ----
  const head = el('div', null, { className: 'card ce-intro' });
  head.append(el('b', '🧩 Esta é a tela que o seu cliente teria no painel dele.'), el('p', 'Ele escolhe o modelo do ramo, troca textos, preços, fotos e contatos, e o site muda na hora. O design fica protegido: ele não consegue "quebrar" o visual.', { className: 'sub' }));
  const devices = el('div', null, { className: 'ce-devices' });
  for (const [key, label] of [['mobile', '📱 Celular'], ['desktop', '🖥️ Computador']]) {
    const b = el('button', label, { type: 'button', className: 'ce-chip' });
    b.setAttribute('aria-pressed', String(device === key));
    b.addEventListener('click', () => { device = key; preview.dataset.device = key; devices.querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', String(x === b))); });
    devices.append(b);
  }
  const preview = el('div', null, { className: 'ce-preview' }); preview.dataset.device = device;
  const screen = el('div', null, { className: 'ce-screen' }); screen.append(frame);
  const actions = el('div', null, { className: 'ce-actions' });
  const saveSite = el('button', '💾 Salvar como site de cliente', { type: 'button', id: 'ceSave' });
  const download = el('button', '⬇️ Baixar HTML', { type: 'button', className: 'sec' });
  const reset = el('button', '↺ Recomeçar', { type: 'button', className: 'sec' });
  saveSite.addEventListener('click', async () => {
    if (typeof window.promisaSaveGeneratedSite !== 'function') { status.textContent = '⚠️ Abra o painel completo para salvar.'; return; }
    saveSite.disabled = true;
    try { await window.promisaSaveGeneratedSite(draft.name || NICHES[draft.niche].label, renderSite(draft)); status.textContent = '✅ Salvo em Clientes → Sites sem cliente. De lá dá para gerar link de demonstração e publicar.'; }
    catch (error) { status.textContent = '⚠️ Não foi possível salvar: ' + (error.message || 'erro'); }
    saveSite.disabled = false;
  });
  download.addEventListener('click', () => {
    const url = URL.createObjectURL(new Blob([renderSite(draft)], { type: 'text/html' }));
    const a = el('a', null, { href: url, download: (draft.name || 'site').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w]+/g, '-').toLowerCase() + '.html' });
    document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 5000);
  });
  reset.addEventListener('click', () => { if (!confirm('Apagar o rascunho e voltar ao exemplo do ramo?')) return; draft = newDraft(draft.niche); draw(); refresh(true); });
  actions.append(saveSite, download, reset);
  preview.append(devices, screen, actions, status);

  const layout = el('div', null, { className: 'ce-layout' });
  layout.append(form, preview);
  root.replaceChildren(head, layout);
  draw(); refresh(true);
}

window.promisaClientEditor = { mount };
