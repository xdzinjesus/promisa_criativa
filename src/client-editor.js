import { NICHES, PLANS, SECTION_LABELS, HERO_LABELS, newDraft, renderSite, safeImage } from './client-site-templates.js';
import { accessBox } from './client-access-ui.js';

// Aba "🧩 Painel do cliente" (demonstração): o que o cliente veria no painel dele.
// Escolhe o ramo, edita campos guiados e vê o site mudar na hora. O rascunho fica só neste aparelho
// (localStorage): nenhuma leitura ou gravação no Blob. "Salvar como site" usa o mesmo cadastro de sites do painel.
const DRAFT_KEY = 'promisa_client_editor_v1', OPEN_KEY = 'promisa_client_editor_open';
const el = (tag, text, props = {}) => Object.assign(document.createElement(tag), text == null ? {} : { textContent: text }, props);

function load() { try { const saved = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null'); if (saved && NICHES[saved.niche]) return { ...newDraft(saved.niche, saved.plan), ...saved, plan: PLANS[saved.plan] ? saved.plan : 'premium' }; } catch { /* sem rascunho */ } return newDraft('barbearia'); }
function save(draft) { try { localStorage.setItem(DRAFT_KEY, JSON.stringify(draft)); return true; } catch { return false; } }

// Reduz a foto para no máximo `max` px e JPEG ~82% (cabe no rascunho e deixa o site leve).
function shrink(file, max = 1400, quality = 0.78) {
  return new Promise((resolve, reject) => {
    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) { reject(new Error('Use foto JPG, PNG ou WEBP.')); return; }
    const url = URL.createObjectURL(file), img = new Image();
    img.onload = () => {
      const scale = Math.min(1, max / Math.max(img.width, img.height));
      const canvas = Object.assign(document.createElement('canvas'), { width: Math.round(img.width * scale), height: Math.round(img.height * scale) });
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL('image/jpeg', quality));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Não consegui abrir a foto.')); };
    img.src = url;
  });
}

// opts.client = { draft, siteName, onSave(draft) } → modo do cliente ("Meu site"): sem trocar ramo, sem rascunho local,
// só "Salvar e publicar". Sem opts → modo do dono (painel), com publicação e controle de acesso.
export function mount(root, opts = {}) {
  if (!root) return;
  const client = opts.client || null;
  let draft = client ? { ...newDraft(client.draft?.niche, client.draft?.plan), ...client.draft } : load(), device = 'mobile', timer = 0, dirty = false;
  const status = el('p', '', { className: 'ce-status', role: 'status' });
  const frame = el('iframe', null, { className: 'ce-frame', title: 'Prévia do site do cliente' });
  frame.setAttribute('sandbox', 'allow-popups allow-popups-to-escape-sandbox');
  frame.referrerPolicy = 'no-referrer';
  const refresh = (now = false) => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      frame.srcdoc = renderSite(draft);
      if (client) { if (dirty) status.textContent = 'Você tem alterações ainda não publicadas.'; return; }
      status.textContent = save(draft) ? 'Rascunho salvo neste aparelho.' : '⚠️ Fotos demais para guardar o rascunho. O site continua funcionando; salve como site para não perder.';
    }, now ? 0 : 250);
  };
  const set = (key, value) => { draft[key] = value; dirty = true; refresh(); };

  // ---- formulário ----
  const form = el('div', null, { className: 'ce-form' });
  // Blocos que abrem e fecham (lembra quais ficaram abertos neste aparelho).
  let open; try { open = new Set(JSON.parse(localStorage.getItem(OPEN_KEY) || 'null') || ['ramo', 'identidade']); } catch { open = new Set(['ramo', 'identidade']); }
  const group = (key, title, ...children) => {
    const box = el('details', null, { className: 'ce-group', open: open.has(key) });
    const summary = el('summary', title);
    box.addEventListener('toggle', () => { box.open ? open.add(key) : open.delete(key); try { localStorage.setItem(OPEN_KEY, JSON.stringify([...open])); } catch { /* ok */ } });
    const body = el('div', null, { className: 'ce-group-body' }); body.append(...children);
    box.append(summary, body);
    return box;
  };
  const field = (label, key, { area = false, type = 'text', placeholder = '', max = 200 } = {}) => {
    const wrap = el('label', null, { className: 'ce-field' });
    const input = el(area ? 'textarea' : 'input', null, { value: draft[key] ?? '', placeholder, maxLength: max, ...(area ? { rows: 3 } : { type }) });
    input.addEventListener('input', () => set(key, input.value));
    wrap.append(el('span', label), input);
    return wrap;
  };

  function draw() {
    form.replaceChildren();
    const niche = NICHES[draft.niche], plan = PLANS[draft.plan] || PLANS.profissional;
    const rerender = () => { draw(); refresh(true); dirty = true; };
    const chips = (options, current, onPick) => {
      const box = el('div', null, { className: 'ce-niches' });
      for (const [key, label] of options) {
        const b = el('button', label, { type: 'button', className: 'ce-chip' });
        b.setAttribute('aria-pressed', String(current === key));
        b.addEventListener('click', () => { if (current !== key) onPick(key); });
        box.append(b);
      }
      return box;
    };
    // ramo e plano (só o dono)
    const niches = chips(Object.entries(NICHES).map(([k, d]) => [k, `${d.icon} ${d.label}`]), draft.niche, key => {
      if (!confirm(`Trocar para o modelo "${NICHES[key].label}"? Os textos voltam ao exemplo do ramo (fotos e contatos ficam).`)) return;
      draft = { ...newDraft(key, draft.plan), logo: draft.logo, cover: draft.cover, gallery: draft.gallery, whatsapp: draft.whatsapp, instagram: draft.instagram, address: draft.address, team: draft.team, testimonials: draft.testimonials, siteId: draft.siteId };
      rerender();
    });
    const plans = chips(Object.entries(PLANS).map(([k, p]) => [k, `${p.icon} ${p.label}`]), draft.plan, key => { draft.plan = key; rerender(); });
    const planInfo = el('p', `${plan.icon} ${plan.label}: até ${plan.items} ${niche.items.toLowerCase()}, ${plan.gallery} fotos na galeria, ${plan.palettes} combinações de cores${plan.sections.length > 1 ? ', seções: ' + plan.sections.map(s => SECTION_LABELS[s]).join(', ') : ''}.`, { className: 'ce-hint' });
    // cores e estilo do topo
    const colors = el('div', null, { className: 'ce-colors' });
    niche.palettes.slice(0, plan.palettes).forEach(([p, bg], i) => {
      const b = el('button', null, { type: 'button', className: 'ce-color', ariaLabel: `Cores ${i + 1}` });
      b.style.background = `linear-gradient(135deg,${p} 50%,${bg} 50%)`;
      b.setAttribute('aria-pressed', String(draft.palette === i));
      b.addEventListener('click', () => { draft.palette = i; rerender(); });
      colors.append(b);
    });
    const heroStyles = plan.heroStyles.length > 1 ? chips(plan.heroStyles.map(k => [k, HERO_LABELS[k]]), plan.heroStyles.includes(draft.heroStyle) ? draft.heroStyle : 'full', key => { draft.heroStyle = key; rerender(); }) : null;
    // fotos
    const photo = (label, key, max = 1) => {
      const multiple = max > 1;
      const wrap = el('div', null, { className: 'ce-photo' });
      const input = el('input', null, { type: 'file', accept: 'image/jpeg,image/png,image/webp', multiple, hidden: true });
      const current = multiple ? (draft[key] || []).slice(0, max) : (draft[key] ? [draft[key]] : []);
      const pick = el('button', multiple ? `＋ Fotos (${current.length}/${max})` : (draft[key] ? 'Trocar' : 'Escolher'), { type: 'button', className: 'sec', disabled: multiple && current.length >= max });
      pick.addEventListener('click', () => input.click());
      input.addEventListener('change', async () => {
        try {
          const files = [...input.files].slice(0, multiple ? max - current.length : 1);
          const shots = []; for (const file of files) shots.push(await shrink(file, key === 'logo' ? 400 : key === 'cover' ? 1400 : 1000, key === 'cover' ? 0.8 : 0.74));
          if (multiple) draft[key] = [...current, ...shots].slice(0, max); else draft[key] = shots[0] || '';
          rerender();
        } catch (error) { status.textContent = '⚠️ ' + error.message; }
      });
      const thumbs = el('div', null, { className: 'ce-thumbs' });
      current.forEach((src, i) => {
        const tb = el('button', null, { type: 'button', className: 'ce-thumb', title: 'Remover foto', ariaLabel: 'Remover foto' });
        const safe = safeImage(src); if (safe) tb.style.backgroundImage = `url("${safe}")`;
        tb.addEventListener('click', () => { if (multiple) draft[key].splice(i, 1); else draft[key] = ''; rerender(); });
        thumbs.append(tb);
      });
      if (multiple && (draft[key] || []).length > max) thumbs.append(el('small', `+${draft[key].length - max} escondida(s) neste plano`, { className: 'ce-hint' }));
      wrap.append(el('span', label), thumbs, pick, input);
      return wrap;
    };
    // lista genérica (itens, perguntas, depoimentos, equipe): campos + subir + remover + adicionar
    const listEditor = (key, fields, max, addLabel, { fixed = false, photoKey = '' } = {}) => {
      const box = el('div', null, { className: 'ce-items' });
      draft[key] = Array.isArray(draft[key]) ? draft[key] : [];
      if (fixed) while (draft[key].length < max) draft[key].push(Object.fromEntries(fields.map(f => [f.k, ''])));
      draft[key].slice(0, max).forEach((row, i) => {
        const line = el('div', null, { className: 'ce-item' });
        line.style.gridTemplateColumns = [...fields.filter(f => !f.wide).map(f => f.small ? 'minmax(70px,110px)' : 'minmax(0,1fr)'), ...Array((photoKey ? 1 : 0) + (fixed ? 0 : 2)).fill('36px')].join(' ') || '1fr';
        for (const f of fields) {
          const input = el(f.area ? 'textarea' : 'input', null, { value: row[f.k] ?? '', placeholder: f.ph, maxLength: f.max, ariaLabel: f.ph, className: f.wide ? 'ce-desc' : f.small ? 'ce-price' : '', ...(f.area ? { rows: 2 } : {}) });
          input.addEventListener('input', () => { row[f.k] = input.value; dirty = true; refresh(); });
          line.append(input);
        }
        if (photoKey) {
          const pick = el('button', row[photoKey] ? '🖼️' : '📷', { type: 'button', className: 'ce-mv', ariaLabel: row[photoKey] ? 'Trocar ou remover foto' : 'Adicionar foto', title: row[photoKey] ? 'Trocar ou remover foto' : 'Adicionar foto' });
          const file = el('input', null, { type: 'file', accept: 'image/jpeg,image/png,image/webp', hidden: true });
          pick.addEventListener('click', () => { if (row[photoKey] && confirm('Remover esta foto? (Cancelar = escolher outra)')) { row[photoKey] = ''; rerender(); return; } file.click(); });
          file.addEventListener('change', async () => { try { row[photoKey] = await shrink(file.files[0], 360, 0.8); rerender(); } catch (error) { status.textContent = '⚠️ ' + error.message; } });
          line.append(pick, file);
        }
        if (!fixed) {
          const upBtn = el('button', '↑', { type: 'button', className: 'ce-mv', ariaLabel: 'Subir' });
          upBtn.addEventListener('click', () => { if (i > 0) { [draft[key][i - 1], draft[key][i]] = [draft[key][i], draft[key][i - 1]]; rerender(); } });
          const del = el('button', '✕', { type: 'button', className: 'ce-del', ariaLabel: 'Remover' });
          del.addEventListener('click', () => { draft[key].splice(i, 1); rerender(); });
          line.append(upBtn, del);
        }
        box.append(line);
      });
      if (draft[key].length > max) box.append(el('p', `⚠️ ${draft[key].length - max} item(ns) a mais ficam escondidos neste plano (aparecem de novo num plano maior).`, { className: 'ce-hint' }));
      if (!fixed) {
        const add = el('button', `＋ ${addLabel} (${Math.min(draft[key].length, max)}/${max})`, { type: 'button', className: 'sec ce-add', disabled: draft[key].length >= max });
        add.addEventListener('click', () => { draft[key].push(Object.fromEntries(fields.map(f => [f.k, '']))); rerender(); box.querySelector('.ce-item:last-of-type input, .ce-item:last-of-type textarea')?.focus(); });
        box.append(add);
      }
      return box;
    };
    const check = (label, on, onChange) => { const w = el('label', null, { className: 'ce-check' }); const c = el('input', null, { type: 'checkbox', checked: on }); c.addEventListener('change', () => onChange(c.checked)); w.append(c, el('span', label)); return w; };
    const perks = el('div', null, { className: 'ce-perks' });
    draft.highlights = Array.from({ length: 3 }, (_, i) => draft.highlights?.[i] ?? '');
    draft.highlights.forEach((text, i) => {
      const input = el('input', null, { value: text, placeholder: `Destaque ${i + 1} (ex.: Estacionamento grátis)`, maxLength: 50, ariaLabel: `Destaque ${i + 1}` });
      input.addEventListener('input', () => { draft.highlights[i] = input.value; dirty = true; refresh(); });
      perks.append(input);
    });
    const has = key => plan.sections.includes(key);
    const itemFields = [{ k: 'name', ph: 'Nome', max: 60 }, ...(niche.noPrices ? [] : [{ k: 'price', ph: 'Preço (ex.: 45)', max: 30, small: true }]), { k: 'desc', ph: 'Descrição curta', max: 120, wide: true }];
    const sections = el('div', null, { className: 'ce-perks' });
    for (const key of plan.sections) sections.append(check(`Mostrar "${SECTION_LABELS[key]}"`, !draft.hide?.[key], on => { draft.hide = { ...(draft.hide || {}), [key]: !on }; rerender(); }));

    form.append(
      ...(client ? [] : [group('ramo', '🧭 Ramo e plano', el('span', 'Ramo de atividade', { className: 'ce-label' }), niches, el('span', 'Plano do cliente', { className: 'ce-label' }), plans, planInfo)]),
      group('identidade', '🎨 Identidade e visual', field('Nome do negócio', 'name', { max: 60 }), field('Frase de destaque', 'slogan', { max: 120 }), field('Texto do botão principal', 'ctaLabel', { max: 30, placeholder: niche.cta }), el('span', 'Cores', { className: 'ce-label' }), colors, ...(heroStyles ? [el('span', 'Estilo do topo', { className: 'ce-label' }), heroStyles] : []), photo('Logo', 'logo'), photo('Foto de capa', 'cover')),
      ...(plan.highlights ? [group('destaques', '✦ Destaques do negócio', perks)] : []),
      group('itens', `📋 ${niche.items}`, ...(niche.noPrices ? [el('p', 'Odontologia: pelas regras do CFO, o site não mostra preços nem promoções.', { className: 'ce-hint' })] : []), listEditor('items', itemFields, plan.items, 'Adicionar')),
      ...(plan.promo && !niche.noPromo ? [group('promo', '🏷️ Promoção', check('Mostrar faixa de promoção no topo', draft.showPromo, on => set('showPromo', on)), field('Texto da promoção', 'promo', { max: 120 }))] : []),
      group('sobre', '📖 Sobre e fotos', field('Sobre o negócio', 'about', { area: true, max: 600 }), photo(`Galeria`, 'gallery', plan.gallery)),
      ...(has('steps') ? [group('steps', '🪜 Como funciona (3 passos)', listEditor('steps', [{ k: 'title', ph: 'Passo', max: 50 }, { k: 'text', ph: 'Explicação curta', max: 140, wide: true }], 3, '', { fixed: true }))] : []),
      ...(has('stats') ? [group('stats', '🔢 Números do negócio', listEditor('stats', [{ k: 'value', ph: 'Número (ex.: 10+)', max: 12, small: true }, { k: 'label', ph: 'O que significa', max: 40 }], 4, '', { fixed: true }))] : []),
      ...(has('team') ? [group('team', '👥 Equipe', listEditor('team', [{ k: 'name', ph: 'Nome', max: 50 }, { k: 'role', ph: 'Função', max: 50 }], 8, 'Adicionar pessoa', { photoKey: 'photo' }))] : []),
      ...(has('testimonials') ? [group('depo', '💬 Depoimentos', el('p', 'Use só depoimentos reais de clientes (com autorização).', { className: 'ce-hint' }), listEditor('testimonials', [{ k: 'name', ph: 'Nome do cliente', max: 50 }, { k: 'text', ph: 'O que ele disse', max: 300, wide: true, area: true }], 8, 'Adicionar depoimento'))] : []),
      ...(has('faq') ? [group('faq', '❓ Perguntas frequentes', listEditor('faq', [{ k: 'q', ph: 'Pergunta', max: 120, wide: true }, { k: 'a', ph: 'Resposta', max: 400, wide: true, area: true }], 10, 'Adicionar pergunta'))] : []),
      ...(plan.sections.length > 1 ? [group('secoes', '👁️ Mostrar ou esconder seções', sections)] : []),
      group('contato', '📞 Contato', field('WhatsApp (com DDD)', 'whatsapp', { type: 'tel', placeholder: '49 99999-9999', max: 20 }), field('Instagram', 'instagram', { placeholder: '@seunegocio', max: 60 }), field('Endereço', 'address', { max: 160 }), field('Horários (um por linha)', 'hours', { area: true, max: 300 }), ...(niche.responsible ? [field('Responsável técnico e CRO (obrigatório)', 'responsible', { max: 100, placeholder: 'Dr(a). Nome · CRO-SC 00000' })] : []))
    );
  }

  // ---- topo, prévia e ações ----
  const head = el('div', null, { className: 'card ce-intro' });
  if (client) head.append(el('b', `👋 Aqui você edita o site ${client.siteName ? 'de ' + client.siteName : ''} · plano ${(PLANS[draft.plan] || PLANS.profissional).icon} ${(PLANS[draft.plan] || PLANS.profissional).label}`), el('p', 'Troque textos, preços, fotos e contatos e veja o site mudar na hora. Quando terminar, toque em "Salvar e publicar".', { className: 'sub' }));
  else head.append(el('b', '🧩 Esta é a tela que o seu cliente teria no painel dele.'), el('p', 'Ele troca textos, preços, fotos e contatos, e o site muda na hora. O design fica protegido: ele não consegue "quebrar" o visual. Para dar acesso a ele, use "🔑 Acesso do cliente" (embaixo da prévia).', { className: 'sub' }));
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
  const saveSite = el('button', '💾 Salvar site', { type: 'button', id: 'ceSave', className: 'sec' });
  const publish = el('button', '🚀 Publicar na Cloudflare', { type: 'button', id: 'cePublish' });
  const download = el('button', '⬇️ Baixar HTML', { type: 'button', className: 'sec' });
  const reset = el('button', '↺ Recomeçar', { type: 'button', className: 'sec' });
  // Salva (ou atualiza o mesmo site, se já foi salvo antes) no cadastro de sites do painel.
  async function store() {
    if (typeof window.promisaSaveGeneratedSite !== 'function') throw new Error('Abra o painel completo para salvar.');
    const result = await window.promisaSaveGeneratedSite(draft.name || NICHES[draft.niche].label, renderSite(draft), draft.siteId || '');
    draft.siteId = result.id; save(draft);
    return result;
  }
  saveSite.addEventListener('click', async () => {
    saveSite.disabled = true;
    try { const { updated } = await store(); status.textContent = updated ? '✅ Site atualizado no cadastro. Se ele já estiver no ar, toque em "🚀 Publicar na Cloudflare" → "Atualizar site".' : '✅ Salvo em Clientes → Sites sem cliente. De lá dá para gerar link de demonstração.'; }
    catch (error) { status.textContent = '⚠️ Não foi possível salvar: ' + (error.message || 'erro'); }
    saveSite.disabled = false;
  });
  publish.addEventListener('click', async () => {
    if (typeof window.promisaOpenPublish !== 'function') { status.textContent = '⚠️ Abra o painel completo para publicar.'; return; }
    publish.disabled = true;
    try { await store(); status.textContent = 'Site salvo. Abrindo a publicação…'; await window.promisaOpenPublish(draft.siteId); }
    catch (error) { status.textContent = '⚠️ Não foi possível publicar: ' + (error.message || 'erro'); }
    publish.disabled = false;
  });
  download.addEventListener('click', () => {
    const url = URL.createObjectURL(new Blob([renderSite(draft)], { type: 'text/html' }));
    const a = el('a', null, { href: url, download: (draft.name || 'site').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w]+/g, '-').toLowerCase() + '.html' });
    document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 5000);
  });
  reset.addEventListener('click', () => { if (!confirm('Apagar o rascunho e voltar ao exemplo do ramo? (O site já salvo no cadastro continua lá.)')) return; draft = newDraft(draft.niche); draw(); refresh(true); });
  if (client) {
    const go = el('button', '💾 Salvar e publicar', { type: 'button', id: 'ceClientSave' });
    go.addEventListener('click', async () => {
      go.disabled = true; const old = go.textContent; go.textContent = 'Publicando… (até 1 minuto)';
      try { if (JSON.stringify(draft).length > 4_000_000) throw new Error('As fotos ficaram pesadas demais para enviar. Remova algumas fotos da galeria ou da equipe e tente de novo.'); const result = await client.onSave(draft); dirty = false; status.textContent = '✅ Pronto! Seu site foi atualizado.' + (result?.url ? ' ' + result.url : ''); }
      catch (error) { status.textContent = '⚠️ ' + (error.message || 'Não foi possível salvar.'); }
      go.disabled = false; go.textContent = old;
    });
    actions.append(go);
    window.addEventListener('beforeunload', event => { if (dirty) { event.preventDefault(); event.returnValue = ''; } });
    preview.append(devices, screen, actions, status);
  } else {
    actions.append(publish, saveSite, download, reset);
    const guide = el('a', '📘 Como funciona a hospedagem (passo a passo)', { href: 'https://github.com/xdzinjesus/promisa_criativa/blob/main/docs/HOSPEDAGEM.md', target: '_blank', rel: 'noopener noreferrer', className: 'ce-guide' });
    const access = accessBox({
      getDraft: () => draft, ensureSaved: async () => { await store(); return draft.siteId; },
      useDraft: incoming => { draft = { ...newDraft(incoming.niche), ...incoming, siteId: draft.siteId }; draw(); refresh(true); }
    });
    preview.append(devices, screen, actions, status, access, guide);
  }

  const toggles = el('div', null, { className: 'ce-toggles' });
  for (const [label, value] of [['Abrir todos', true], ['Fechar todos', false]]) { const b = el('button', label, { type: 'button', className: 'sec' }); b.addEventListener('click', () => form.querySelectorAll('details.ce-group').forEach(d => { d.open = value; })); toggles.append(b); }
  const formCol = el('div', null, { className: 'ce-formcol' }); formCol.append(toggles, form);
  const layout = el('div', null, { className: 'ce-layout' });
  layout.append(formCol, preview);
  root.replaceChildren(head, layout);
  draw(); refresh(true);
}

if (typeof window !== 'undefined') window.promisaClientEditor = { mount };
