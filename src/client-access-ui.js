// Controle do dono sobre o "Meu site" dos clientes (só no painel, com a sessão do dono).
// accessBox: cartão "🔑 Acesso do cliente" no editor. mountControl: aba "🔐 Acessos dos clientes".
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

export function accessBox({ getDraft, ensureSaved, useDraft }) {
  const box = el('section', null, { className: 'ca-box', ariaLabel: 'Acesso do cliente' });
  const body = el('div');
  box.append(el('h3', '🔑 Acesso do cliente'), body);
  const msg = text => { const p = el('p', text, { className: 'ca-msg' }); body.append(p); return p; };
  async function create(button) {
    button.disabled = true;
    try {
      const siteId = await ensureSaved();
      const draft = getDraft();
      if (JSON.stringify(draft).length > 4_000_000) throw new Error('Fotos pesadas demais para criar o acesso. Remova algumas fotos e tente de novo.');
      const result = await accessApi('admin-create', { siteId, siteName: draft.name, draft });
      await load(); body.prepend(credentialsCard({ ...result, siteName: draft.name, phone: draft.whatsapp }));
    } catch (error) { msg('⚠️ ' + error.message); button.disabled = false; }
  }
  async function load() {
    body.replaceChildren(el('p', 'Carregando…', { className: 'ca-msg' }));
    const siteId = getDraft().siteId;
    if (!siteId) {
      const go = el('button', '🔑 Dar acesso ao cliente', { type: 'button' }); go.addEventListener('click', () => create(go));
      body.replaceChildren(el('p', 'O cliente recebe um link e um código de 6 números para editar só este site. Você controla tudo e pode cortar quando quiser.', { className: 'ca-msg' }), go);
      return;
    }
    let data;
    try { data = await accessApi('admin-get', { siteId }); } catch (error) { body.replaceChildren(); msg('⚠️ ' + error.message); return; }
    body.replaceChildren();
    const a = data.access;
    if (!a || a.revoked) {
      msg(a?.revoked ? '⛔ Acesso cortado. O cliente não consegue mais editar (o site continua no ar).' : 'Este site ainda não tem acesso de cliente.');
      const go = el('button', a?.revoked ? '🔑 Dar acesso de novo' : '🔑 Dar acesso ao cliente', { type: 'button' }); go.addEventListener('click', () => create(go));
      body.append(go); return;
    }
    msg(`🟢 Acesso ativo desde ${when(a.createdAt)} · última edição do cliente: ${when(a.lastSaveAt)} · ${a.saves || 0} salvamento(s).`);
    const bar = el('div', null, { className: 'ca-actions' });
    const pull = el('button', '⬇️ Trazer edições do cliente', { type: 'button', className: 'sec', disabled: !data.draft || !a.lastSaveAt });
    pull.addEventListener('click', () => { if (confirm('Trocar o rascunho deste editor pela versão que o cliente salvou?')) useDraft(data.draft); });
    const renew = el('button', '🔄 Novo link e código', { type: 'button', className: 'sec' });
    renew.addEventListener('click', () => { if (confirm('Gerar link e código novos? O link antigo para de funcionar.')) create(renew); });
    const cut = el('button', '⛔ Cortar acesso', { type: 'button', className: 'sec ca-danger' });
    cut.addEventListener('click', async () => { if (!confirm('Cortar o acesso deste cliente? O site continua no ar; ele só não consegue mais editar.')) return; cut.disabled = true; try { await accessApi('admin-revoke', { siteId }); await load(); } catch (error) { msg('⚠️ ' + error.message); cut.disabled = false; } });
    bar.append(pull, renew, cut);
    body.append(bar);
  }
  load();
  return box;
}

// Aba de controle interno: todos os acessos de clientes (1 leitura do Blob ao abrir).
export function mountControl(root) {
  if (!root) return;
  const draw = async () => {
    root.replaceChildren(el('p', 'Carregando…', { className: 'sub' }));
    let sites;
    try { sites = (await accessApi('admin-list')).sites || {}; } catch (error) { root.replaceChildren(el('p', '⚠️ ' + error.message, { className: 'sub' })); return; }
    const entries = Object.entries(sites).sort(([, a], [, b]) => Number(a.revoked) - Number(b.revoked) || (b.lastSaveAt || b.createdAt) - (a.lastSaveAt || a.createdAt));
    const active = entries.filter(([, a]) => !a.revoked).length;
    const head = el('div', null, { className: 'grid ca-kpis' });
    for (const [label, value] of [['Clientes com acesso', active], ['Acessos cortados', entries.length - active], ['Salvamentos (total)', entries.reduce((s, [, a]) => s + (a.saves || 0), 0)]]) { const k = el('div', null, { className: 'card kpi' }); k.append(el('small', label), el('b', String(value))); head.append(k); }
    root.replaceChildren(head);
    if (!entries.length) { root.append(el('div', 'Nenhum cliente com acesso ainda. Para dar acesso: Mais → 🧩 Painel do cliente → monte o site → "🔑 Dar acesso ao cliente".', { className: 'card' })); return; }
    const list = el('div', null, { className: 'ca-list' });
    for (const [siteId, a] of entries) {
      const card = el('div', null, { className: 'card ca-item' + (a.revoked ? ' is-off' : '') });
      const info = el('div');
      info.append(el('b', `${a.revoked ? '⛔' : '🟢'} ${a.siteName || 'Site'}`), el('small', `Acesso desde ${when(a.createdAt)} · última edição: ${when(a.lastSaveAt)} · ${a.saves || 0} salvamento(s)`));
      if (a.url) info.append(el('a', a.url, { href: a.url, target: '_blank', rel: 'noopener noreferrer', className: 'ca-url' }));
      const bar = el('div', null, { className: 'ca-actions' });
      const renew = el('button', a.revoked ? '🔑 Liberar de novo' : '🔄 Novo link e código', { type: 'button', className: 'sec' });
      renew.addEventListener('click', async () => {
        if (!confirm(a.revoked ? 'Liberar o acesso de novo com link e código novos?' : 'Gerar link e código novos? O antigo para de funcionar.')) return;
        renew.disabled = true;
        try { const result = await accessApi('admin-create', { siteId, siteName: a.siteName }); await draw(); root.prepend(credentialsCard({ ...result, siteName: a.siteName })); }
        catch (error) { alert(error.message); renew.disabled = false; }
      });
      bar.append(renew);
      if (!a.revoked) {
        const cut = el('button', '⛔ Cortar acesso', { type: 'button', className: 'sec ca-danger' });
        cut.addEventListener('click', async () => { if (!confirm(`Cortar o acesso de ${a.siteName}? O site continua no ar.`)) return; cut.disabled = true; try { await accessApi('admin-revoke', { siteId }); await draw(); } catch (error) { alert(error.message); cut.disabled = false; } });
        bar.append(cut);
      }
      card.append(info, bar);
      list.append(card);
    }
    root.append(list, el('p', 'Para trazer as edições de um cliente para o seu painel: Mais → 🧩 Painel do cliente → abra o mesmo site → "⬇️ Trazer edições do cliente".', { className: 'sub' }));
  };
  draw();
}

if (typeof window !== 'undefined') window.promisaClientAccess = { mountControl };
