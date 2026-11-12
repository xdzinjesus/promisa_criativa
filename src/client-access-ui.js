// Controle do dono sobre o "Meu site" dos clientes (só no painel, com a sessão do dono).
// mountControl: aba "🔐 Acessos dos clientes" (criar acesso, plano, abrir no editor, renovar, cortar).
const el = (tag, text, props = {}) => Object.assign(document.createElement(tag), text == null ? {} : { textContent: text }, props);
const when = ms => ms ? new Date(ms).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' }) : '—';

export async function accessApi(action, extra = {}) {
  const response = await fetch('/api/meu-site', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', cache: 'no-store', body: JSON.stringify({ action, ...extra }) });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || 'Não foi possível concluir.');
  return body;
}

async function copy(text, button) {
  try { await navigator.clipboard.writeText(text); const old = button.textContent; button.textContent = 'Copiado ✓'; setTimeout(() => { button.textContent = old; }, 1500); }
  catch { prompt('Copie:', text); }
}

// Mostra o link e o código UMA vez (o código não fica guardado em lugar nenhum de forma legível).
export function credentialsCard({ link, code, siteName, phone = '' }) {
  const box = el('div', null, { className: 'ca-cred', role: 'status' });
  const row = (label, value) => { const r = el('div', null, { className: 'ca-row' }); const input = el('input', null, { value, readOnly: true, ariaLabel: label }); const b = el('button', 'Copiar', { type: 'button', className: 'sec' }); b.addEventListener('click', () => copy(value, b)); r.append(el('span', label), input, b); return r; };
  const digits = String(phone || '').replace(/\D/g, '');
  const text = `Olá! Aqui está o acesso para você editar o site ${siteName ? 'da ' + siteName + ' ' : ''}sozinho:\n\n🔗 ${link}\n🔑 Código: ${code}\n\nAbra o link, digite o código e pronto. Qualquer dúvida, é só chamar a Promisa.`;
  const wa = el('a', '📲 Enviar no WhatsApp', { href: `https://wa.me/${digits.length >= 10 ? (digits.length <= 11 ? '55' + digits : digits) : ''}?text=${encodeURIComponent(text)}`, target: '_blank', rel: 'noopener noreferrer', className: 'ca-wa' });
  box.append(el('b', '✅ Acesso criado. Anote o código: ele aparece só agora.'), row('Link', link), row('Código', code), wa);
  return box;
}

// Aba de controle interno: criar acessos, mudar plano, abrir no editor, renovar e cortar (1 leitura do Blob ao abrir).
const EDITOR_KEY = 'promisa_client_editor_v1';
const editorDraft = () => { try { const d = JSON.parse(localStorage.getItem(EDITOR_KEY) || 'null'); return d && typeof d === 'object' && d.niche ? d : null; } catch { return null; } };

export function mountControl(root, { niches = {}, plans = {} } = {}) {
  if (!root) return;
  const select = (options, value, label) => { const s = el('select', null, { ariaLabel: label }); for (const [k, text] of options) s.append(el('option', text, { value: k, selected: k === value })); return s; };
  const planOptions = Object.entries(plans).map(([k, p]) => [k, `${p.icon} ${p.label}`]);

  function createForm() {
    const card = el('form', null, { className: 'card ca-new' });
    const local = editorDraft();
    const name = el('input', null, { placeholder: 'Nome do negócio (ex.: Barbearia do Zé)', maxLength: 60, required: true, value: local?.name || '' });
    const niche = select(Object.entries(niches).map(([k, n]) => [k, `${n.icon} ${n.label}`]), local?.niche || 'barbearia', 'Ramo');
    const plan = select(planOptions, local?.plan || 'profissional', 'Plano');
    const phone = el('input', null, { placeholder: 'WhatsApp do cliente (para enviar o acesso)', type: 'tel', maxLength: 20, value: local?.whatsapp && local.whatsapp !== '49999999999' ? local.whatsapp : '' });
    const useLocal = el('input', null, { type: 'checkbox', checked: Boolean(local) });
    const useWrap = el('label', null, { className: 'ce-check' }); useWrap.append(useLocal, el('span', local ? `Começar com o site montado no 🧩 Painel do cliente ("${local.name || 'sem nome'}")` : 'Nenhum site montado no Painel do cliente: o cliente começa do modelo do ramo'));
    useLocal.disabled = !local;
    const go = el('button', '🔑 Dar acesso', { type: 'submit' });
    const out = el('div');
    const row = (label, input) => { const w = el('label', null, { className: 'ce-field' }); w.append(el('span', label), input); return w; };
    card.append(el('h2', '➕ Dar acesso a um cliente', { style: 'margin:0' }), el('p', 'O cliente recebe um link e um código para editar só o site dele, dentro do plano que você escolher.', { className: 'sub', style: 'margin:0' }), row('Nome do negócio', name), el('div', null, { className: 'ca-two' }), row('WhatsApp do cliente', phone), useWrap, go, out);
    card.querySelector('.ca-two').append(row('Ramo', niche), row('Plano', plan));
    card.addEventListener('submit', async event => {
      event.preventDefault();
      if (!name.value.trim()) { name.focus(); return; }
      go.disabled = true; out.replaceChildren();
      try {
        const base = useLocal.checked && local ? { ...local, niche: niche.value, plan: plan.value, name: name.value.trim() } : null;
        if (base && JSON.stringify(base).length > 4_000_000) throw new Error('As fotos do rascunho estão pesadas demais. Remova algumas no Painel do cliente.');
        const result = await accessApi('admin-create', { siteId: base?.siteId || undefined, siteName: name.value.trim(), niche: niche.value, plan: plan.value, whatsapp: phone.value, ...(base ? { draft: base } : {}) });
        await draw();
        root.prepend(credentialsCard({ ...result, siteName: name.value.trim(), phone: phone.value }));
      } catch (error) { out.append(el('p', '⚠️ ' + error.message, { className: 'ca-msg' })); go.disabled = false; }
    });
    return card;
  }

  async function draw() {
    root.replaceChildren(el('p', 'Carregando…', { className: 'sub' }));
    let sites;
    try { sites = (await accessApi('admin-list')).sites || {}; } catch (error) { root.replaceChildren(el('p', '⚠️ ' + error.message, { className: 'sub' })); return; }
    const entries = Object.entries(sites).sort(([, a], [, b]) => Number(a.revoked) - Number(b.revoked) || (b.lastSaveAt || b.createdAt) - (a.lastSaveAt || a.createdAt));
    const active = entries.filter(([, a]) => !a.revoked).length;
    const head = el('div', null, { className: 'grid ca-kpis' });
    for (const [label, value] of [['Clientes com acesso', active], ['Acessos cortados', entries.length - active], ['Salvamentos (total)', entries.reduce((s, [, a]) => s + (a.saves || 0), 0)]]) { const k = el('div', null, { className: 'card kpi' }); k.append(el('small', label), el('b', String(value))); head.append(k); }
    root.replaceChildren(head, createForm());
    if (!entries.length) return;
    const list = el('div', null, { className: 'ca-list' });
    list.append(el('h2', 'Clientes com acesso', { style: 'margin:8px 0 0' }));
    for (const [siteId, a] of entries) {
      const card = el('div', null, { className: 'card ca-item' + (a.revoked ? ' is-off' : '') });
      const info = el('div');
      const n = niches[a.niche];
      info.append(el('b', `${a.revoked ? '⛔' : '🟢'} ${a.siteName || 'Site'}${n ? ' · ' + n.icon + ' ' + n.label : ''}`), el('small', `Acesso desde ${when(a.createdAt)} · última edição: ${when(a.lastSaveAt)} · ${a.saves || 0} salvamento(s)`));
      if (a.url) info.append(el('a', a.url, { href: a.url, target: '_blank', rel: 'noopener noreferrer', className: 'ca-url' }));
      const bar = el('div', null, { className: 'ca-actions' });
      const planSel = select(planOptions, a.plan || 'profissional', 'Plano do cliente');
      planSel.addEventListener('change', async () => {
        const label = plans[planSel.value]?.label || planSel.value;
        if (!confirm(`Mudar ${a.siteName} para o plano ${label}? Vale na próxima vez que o cliente salvar.`)) { planSel.value = a.plan || 'profissional'; return; }
        planSel.disabled = true;
        try { await accessApi('admin-plan', { siteId, plan: planSel.value }); a.plan = planSel.value; } catch (error) { alert(error.message); planSel.value = a.plan || 'profissional'; }
        planSel.disabled = false;
      });
      const openEditor = el('button', '✏️ Abrir no Painel do cliente', { type: 'button', className: 'sec' });
      openEditor.addEventListener('click', async () => {
        if (editorDraft() && !confirm('Isso troca o rascunho que está no Painel do cliente pela versão deste cliente. Continuar?')) return;
        openEditor.disabled = true;
        try { const data = await accessApi('admin-get', { siteId }); if (!data.draft) throw new Error('Sem rascunho salvo.'); localStorage.setItem(EDITOR_KEY, JSON.stringify({ ...data.draft, siteId })); location.href = '/admin?tab=clientPanel'; }
        catch (error) { alert(error.message === 'Sem rascunho salvo.' ? error.message : 'Não foi possível abrir: ' + error.message); openEditor.disabled = false; }
      });
      const renew = el('button', a.revoked ? '🔑 Liberar de novo' : '🔄 Novo link e código', { type: 'button', className: 'sec' });
      renew.addEventListener('click', async () => {
        if (!confirm(a.revoked ? 'Liberar o acesso de novo com link e código novos?' : 'Gerar link e código novos? O antigo para de funcionar.')) return;
        renew.disabled = true;
        try { const result = await accessApi('admin-create', { siteId, siteName: a.siteName }); await draw(); root.prepend(credentialsCard({ ...result, siteName: a.siteName })); }
        catch (error) { alert(error.message); renew.disabled = false; }
      });
      bar.append(planSel, openEditor, renew);
      if (!a.revoked) {
        const cut = el('button', '⛔ Cortar acesso', { type: 'button', className: 'sec ca-danger' });
        cut.addEventListener('click', async () => { if (!confirm(`Cortar o acesso de ${a.siteName}? O site continua no ar.`)) return; cut.disabled = true; try { await accessApi('admin-revoke', { siteId }); await draw(); } catch (error) { alert(error.message); cut.disabled = false; } });
        bar.append(cut);
      }
      card.append(info, bar);
      list.append(card);
    }
    root.append(list);
  }
  draw();
}

